/*
 * v7.72 — harici referans (XATTACH / XCLIP / XBIND / boşalt-yeniden yükle / ayır / solgunluk): DXF dosyası bayt olarak
 * eklenir (form: ad, ekleme noktası, ölçek, dönüş), ilkeller 'X<ad>#n' anahtarı ve p.xref damgasıyla model uzayına girer,
 * katmanlar "ad|katman" önekiyle; kırpma dikdörtgeni ilkelleri budar ve yeniden yüklemede korunur; XBIND tanım + yerleştirme
 * yapar; DXF çıktısında oturumluk referans ilkelleri yazılmaz.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_xref.mjs [çıktı] [örnekler]
 */
import fs from 'node:fs';
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers, askLog } from './harness.mjs';

const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
const J = JSON.stringify, yak = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes([]); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const count = () => ev(() => window.dwgApp.state.prims.length);
const xrefs = () => ev(() => window.dwgApp.__xrefs());
const xprims = (name) => ev((n) => window.dwgApp.state.prims.filter(p => p.xref === n).map(p => ({ key: p.key, k: p.k, lay: p.lay, bb: p.bb, lines: p.lines })), name);
const bosNokta = () => ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });
const b64 = fs.readFileSync(`${SM}/test_tr.dxf`).toString('base64');
const attach = async (name, x, y, scale, rot, answers) => {
  await queueAnswers(page, answers === undefined ? { name, x, y, scale, rot } : answers);
  return ev(([b, nm]) => { const u = Uint8Array.from(atob(b), c => c.charCodeAt(0)); return window.dwgApp.__xattach(u.buffer, nm); }, [b64, name + '.dxf']);
};
const panel = async () => { await ev(() => { document.getElementById('toast').hidden = true; window.dwgApp.action('xrefs'); }); await bekle(250); return ev(() => ({ open: !document.getElementById('docPanel').hidden, rows: [...document.querySelectorAll('#docBody .blk-row')].map(r => ({ name: r.querySelector('b').textContent, btns: [...r.querySelectorAll('[data-xa]')].map(b => b.dataset.xa) })), top: [...document.querySelectorAll('#docBody > .btns [data-xa], #docBody .btns [data-xa]')].map(b => b.dataset.xa) })); };
const tikla = async (xa, i = 0) => { await page.locator('#docBody .blk-row').nth(i).locator(`[data-xa="${xa}"]`).click(); await bekle(400); };

await page.click('#toolbar [data-tab="edit"]');
const [X0, Y0] = await bosNokta();
const n0 = await count();

// ---------------------------------------------------------------------------------
// 1 · XATTACH: form → yükleme; ilkeller ekleme noktasına taşınmış, damgalı, katmanlar önekli
// ---------------------------------------------------------------------------------
{
  ok('1a başta harici referans yok', (await xrefs()).length === 0, J(await xrefs()));
  await attach('REF', X0, Y0, 1, 0);
  await bekle(800);
  const lg = await askLog(page);
  ok('1b XATTACH formu soruldu (başlık dosya adını taşır)', lg.some(l => l.type === 'form' && /XATTACH/.test(l.label) && /REF\.dxf/.test(l.label)), J(lg));
  const xr = await xrefs();
  ok('1c referans listede: REF, yüklü, eklenmiş (attached), ilkel sayısı > 0, tampon ve önbellek var', xr.length === 1 && xr[0].name === 'REF' && xr[0].loaded && xr[0].attached && xr[0].keys > 0 && xr[0].buf && xr[0].cached && !xr[0].clip, J(xr));
  const P = await xprims('REF');
  ok('1d ilkeller model uzayında: sayı = keys, anahtar XREF#n, p.xref = REF; ilkel sayısı arttı', P.length === xr[0].keys && P.every(p => /^XREF#\d+$/.test(p.key)) && (await count()) === n0 + P.length, J([P.length, P.slice(0, 3).map(p => p.key)]));
  const bb = P.reduce((a, p) => [Math.min(a[0], p.bb[0]), Math.min(a[1], p.bb[1]), Math.max(a[2], p.bb[2]), Math.max(a[3], p.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  ok('1e geometri ekleme noktasına taşındı: kutu X0..X0+1000, Y0..Y0+1000 içinde, ekleme noktasının sağında / üstünde (dosya 0..540 aralığında)', bb[0] >= X0 - 1 && bb[1] >= Y0 - 1 && bb[2] <= X0 + 1000 && bb[3] <= Y0 + 1000 && bb[2] - bb[0] > 300, J(bb.map((v, i) => v - (i % 2 ? Y0 : X0))));
  const lays = await ev(() => [...window.dwgApp.state.layers.keys()].filter(k => k.startsWith('REF|')));
  ok('1f katmanlar "REF|…" önekiyle geldi (ICMESUYU, KANAL), ilkeller o katmanlarda', lays.includes('REF|ICMESUYU') && lays.includes('REF|KANAL') && P.some(p => p.lay === 'REF|ICMESUYU'), J([lays, [...new Set(P.map(p => p.lay))]]));
  ok('1g ileti "eklendi · n ilkel"', /REF/.test(await toast()) && /eklendi|attached/i.test(await toast()), await toast());
  await ev(([x, y]) => window.dwgApp.zoomExtents([x - 20, y - 20, x + 320, y + 320]), [X0, Y0]); await bekle(300);
  await shot('xref_1');
}

// ---------------------------------------------------------------------------------
// 2 · Referans paneli: satır ve düğmeler; boşalt → ilkeller kalkar; yeniden yükle → geri (önbellekten)
// ---------------------------------------------------------------------------------
{
  const pn = await panel();
  ok('2a panel: REF satırı; Boşalt / Kırp / Bağla / Aç / Ayır düğmeleri; üstte Ekle ve Solgunluk', pn.open && pn.rows.length === 1 && pn.rows[0].name === 'REF' && ['unload', 'clip', 'bind', 'open', 'detach'].every(b => pn.rows[0].btns.includes(b)) && pn.top.includes('attach') && pn.top.includes('fade'), J(pn));
  await tikla('unload');
  const xr = await xrefs();
  ok('2b Boşalt: yüklü değil, boşaltıldı, ilkel yok (önbellek ve tampon kalır); ilkel sayısı eski hâlinde', !xr[0].loaded && xr[0].unloaded && xr[0].keys === 0 && xr[0].cached && (await count()) === n0 && (await xprims('REF')).length === 0, J([xr, await count(), n0]));
  const pn2 = await panel();
  ok('2c panelde Yeniden yükle düğmesi', pn2.rows[0].btns.includes('reload') && !pn2.rows[0].btns.includes('unload'), J(pn2));
  await tikla('reload');
  const xr2 = await xrefs();
  ok('2d Yeniden yükle: ilkeller önbellekten geri, sayı aynı', xr2[0].loaded && xr2[0].keys > 0 && (await count()) === n0 + xr2[0].keys, J([xr2, await count()]));
  await ev(() => { document.getElementById('docPanel').hidden = true; });
}

// ---------------------------------------------------------------------------------
// 3 · XCLIP dikdörtgen: ilkeller budanır (kutu pencerede), boşalt / yükle kırpmayı korur; kırpmayı kaldır
// ---------------------------------------------------------------------------------
{
  const full = (await xrefs())[0].keys;
  const rect = [X0 + 90, Y0 + 90, X0 + 160, Y0 + 160];
  const r = await ev((rc) => window.dwgApp.__xclip('REF', rc), rect);
  const xr = await xrefs();
  const P = await xprims('REF');
  ok('3a XCLIP: kırpma kaydedildi, ilkel sayısı azaldı (yalnız pencereye değenler)', r && J(xr[0].clip) === J(rect) && xr[0].keys < full && xr[0].keys > 0 && P.length === xr[0].keys, J([xr, full]));
  ok('3b bütün kalan ilkeller pencere içinde (yollar budandı; yazı / nokta konumu içeride)', P.every(p => p.k !== 0 || (p.bb[0] >= rect[0] - 1e-6 && p.bb[2] <= rect[2] + 1e-6 && p.bb[1] >= rect[1] - 1e-6 && p.bb[3] <= rect[3] + 1e-6)), J(P.map(p => [p.k, p.bb.map(v => Math.round(v * 1000) / 1000)])));
  ok('3c ileti "kırpıldı"', /kırp|clip/i.test(await toast()), await toast());
  await shot('xref_clip');
  await panel(); await tikla('unload'); await panel(); await tikla('reload');
  const xr2 = await xrefs();
  ok('3d boşalt + yeniden yükle kırpmayı korur (aynı sayı)', J(xr2[0].clip) === J(rect) && xr2[0].keys === xr[0].keys, J(xr2));
  const pn = await panel();
  ok('3e panelde "Kırpmayı kaldır" düğmesi ve "kırpılmış" notu', pn.rows[0].btns.includes('unclip'), J(pn));
  await tikla('unclip');
  const xr3 = await xrefs();
  ok('3f kırpma kaldırıldı: bütün ilkeller geri', !xr3[0].clip && xr3[0].keys === full, J(xr3));
  await ev(() => { document.getElementById('docPanel').hidden = true; });
}

// ---------------------------------------------------------------------------------
// 4 · Solgunluk anahtarı; DXF çıktısında referans ilkelleri yazılmaz
// ---------------------------------------------------------------------------------
{
  const f0 = await ev(() => window.dwgApp.state.xrefFade);
  await ev(() => window.dwgApp.editor.act('xreffade')); await bekle(200);
  const f1 = await ev(() => window.dwgApp.state.xrefFade);
  ok('4a XDWGFADECTL: 0,5 → 0 (kapalı), ileti', f0 === 0.5 && f1 === 0 && /soldur|solgun|fade/i.test(await toast()), J([f0, f1, await toast()]));
  await ev(() => window.dwgApp.editor.act('xreffade')); await bekle(200);
  ok('4b yeniden açık (0,5)', (await ev(() => window.dwgApp.state.xrefFade)) === 0.5, '');
  const dxf = await ev(() => { const r = window.dwgApp.editor.dxfBase64(false); return r ? decodeURIComponent(escape(atob(r.b64))) : ''; });
  ok('4c DXF: referansın "REF|" katmanlı varlıkları yazılmadı (oturumluk), dosya yine üretildi', dxf.length > 1000 && !/\n8\r\nREF\|/.test(dxf), J([dxf.length, (dxf.match(/\n8\r\nREF\|/g) || []).length]));
}

// ---------------------------------------------------------------------------------
// 5 · XBIND: tanım (REF) + yerleştirme; referans listeden düşer; katman adları öneki korur; geri alma
// ---------------------------------------------------------------------------------
{
  const full = (await xrefs())[0].keys;
  const r = await ev(() => window.dwgApp.__xrefBind('REF'));
  await bekle(400);
  const def = await ev(() => { const d = window.dwgApp.state.blocks.get('REF'); return d ? { n: d.ents.length, base: d.base, lays: [...new Set(d.ents.map(e => e.layer))] } : null; });
  const ins = await ev(() => window.dwgApp.state.prims.filter(p => p.info && p.info.t === 'INSERT' && p.info.name === 'REF').map(p => ({ key: p.key, k: p.k, lay: p.lay, blk: !!p.info.blk, ix: p.info.x, iy: p.info.y })));
  ok('5a XBIND: REF tanımı (bütün ilkeller, taban 0, katmanlar "REF|…" — blok içi 0 katmanı kalır), yerleştirme X0,Y0\'da; referans listeden düştü, xref damgalı ilkel kalmadı', r && def && def.n === full && def.base[0] === 0 && def.lays.some(l => l.startsWith('REF|')) && ins.length === full + 1 && ins.every(p => p.blk) && yak(ins[0].ix, X0) && yak(ins[0].iy, Y0) && (await xrefs()).length === 0 && (await xprims('REF')).length === 0, J([r, def, ins.length, ins[0]]));
  ok('5b ileti "bağlandı"', /bağland|bound/i.test(await toast()), await toast());
  const dxf = await ev(() => { const r = window.dwgApp.editor.dxfBase64(false); return r ? decodeURIComponent(escape(atob(r.b64))) : ''; });
  ok('5c DXF: artık BLOCKS\'ta REF tanımı ve INSERT var; "REF|" katmanları yazılır', /\n2\r\nREF\r\n/.test(dxf) && /\n0\r\nINSERT\r\n[\s\S]*?\n2\r\nREF\r\n/.test(dxf) && /\n8\r\nREF\|/.test(dxf), String(dxf.length));
  await ev(() => { window.dwgApp.editor.act('undo'); }); await bekle(300);
  ok('5d geri alma: tanım ve yerleştirme kalkar (referans geri gelmez — oturumluk)', !(await ev(() => window.dwgApp.state.blocks.has('REF'))) && (await ev(() => window.dwgApp.state.prims.filter(p => p.info && p.info.name === 'REF').length)) === 0, '');
}

// ---------------------------------------------------------------------------------
// 6 · İkinci ekleme (ölçek 2, dönüş 90°) → ad çakışması yok; Ayır (onaylı) → listeden ve modelden düşer; ad çakışırsa _2
// ---------------------------------------------------------------------------------
{
  await attach('REF', X0 + 500, Y0, 2, 90);
  await bekle(800);
  const xr = await xrefs();
  const P = await xprims('REF');
  const bb = P.reduce((a, p) => [Math.min(a[0], p.bb[0]), Math.min(a[1], p.bb[1]), Math.max(a[2], p.bb[2]), Math.max(a[3], p.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  ok('6a ölçek 2 + 90°: geometri ekleme noktasının SOLUNA ve yukarı açılır (x ≤ X0+500, genişlik ~2 kat)', xr.length === 1 && xr[0].name === 'REF' && bb[2] <= X0 + 500 + 1e-6 && bb[1] >= Y0 - 1e-6 && (bb[3] - bb[1]) > 300, J(bb.map((v, i) => v - (i % 2 ? Y0 : X0))));
  await attach('REF', X0, Y0 + 900, 1, 0);
  await bekle(800);
  const xr2 = await xrefs();
  ok('6b aynı adla ikinci ekleme: ad REF_2 olur, iki referans yüklü', xr2.length === 2 && xr2[1].name === 'REF_2' && xr2[1].loaded && (await xprims('REF_2')).length === xr2[1].keys, J(xr2.map(x => [x.name, x.keys])));
  const n1 = await count();
  await panel();
  await queueAnswers(page, true);      // "Ayrılsın mı?" → evet
  await tikla('detach', 1);
  const xr3 = await xrefs();
  ok('6c Ayır (onaylı): REF_2 listeden ve modelden düştü; REF kaldı', xr3.length === 1 && xr3[0].name === 'REF' && (await xprims('REF_2')).length === 0 && (await count()) === n1 - xr2[1].keys, J([xr3, await count(), n1]));
  await ev(() => { document.getElementById('docPanel').hidden = true; });
  await panel();
  await queueAnswers(page, false);     // vazgeç
  await tikla('detach', 0);
  ok('6d Ayır vazgeçilince referans kalır', (await xrefs()).length === 1, '');
  await ev(() => { document.getElementById('docPanel').hidden = true; });
  await shot('xref_6');
}

await browser.close();
await srv.kill();
C.summary(errors);
C.exit();
