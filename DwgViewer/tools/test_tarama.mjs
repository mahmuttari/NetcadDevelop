/*
 * v7.70 — TARAMA / SINIR / DOLGU ALANI: ayrı çizgilerden oluşan kapalı alan bulunur (AutoCAD BOUNDARY / HATCH iç nokta;
 * kesişimlerde bölünmüş düzlemsel çizgenin noktayı içeren en küçük yüzü, sarkan uçlar atılır) ve desen seçicide her
 * desenin önizlemesi kartta görünür.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_tarama.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';

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
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const tapWorld = async (x, y) => { await bekle(110); await temizle(); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(420); };
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const count = () => ev(() => window.dwgApp.state.prims.length);
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, k: p.k, fill: !!p.fill, closed: !!p.closed, et: p.et, ops: p.ops ? p.ops.map(o => o.slice()) : null }; });
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e) => ({ layer: '0', color: 256, ...e })) }); window.dwgApp.requestRender(); }, ents);
const bosNokta = () => ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });

// ---------------------------------------------------------------------------------
// 0 · Saf modül: traceBoundary — üçgen üç ayrı çizgiden, kesen çizgi en küçük yüzü verir, sarkan uç atılır, dışarısı null
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const G = await import('./geom.js');
    const L = (x0, y0, x1, y1) => ({ k: 0, ops: [[0, x0, y0, 0], [1, x1, y1, 0]], bb: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], closed: false });
    const tri = [L(100, 100, 400, 100), L(400, 100, 400, 400), L(400, 400, 100, 100)];
    const a = G.traceBoundary(tri, 300, 150);
    const dis = G.traceBoundary(tri, 50, 50);
    const kesen = tri.concat([L(100, 250, 500, 250), L(300, 120, 300, 20)]);   // kesen yatay çizgi + sarkan düşey çizgi
    const b = G.traceBoundary(kesen, 350, 200);
    const ust = G.traceBoundary(kesen, 380, 300);
    const acik = G.traceBoundary([L(100, 100, 400, 100), L(400, 100, 400, 400)], 300, 150);
    return { a, dis, b, ust, acik };
  });
  ok('0a üç ayrı çizgiden üçgen: 3 köşe, alan 45.000, saat yönünün tersi', r.a && r.a.pts.length === 3 && yak(r.a.area, 45000, 1e-6), J(r.a));
  ok('0b dışarıdaki nokta → null; açık (iki kenar) → null', r.dis === null && r.acik === null, J({ dis: r.dis, acik: r.acik }));
  ok('0c kesen çizgi: noktayı içeren EN KÜÇÜK yüz (yamuk, 4 köşe, alan 33.750); sarkan çizgi sınıra girmez', r.b && r.b.pts.length === 4 && yak(r.b.area, 33750, 1e-6), J(r.b));
  ok('0d üstteki yüz: üçgen (250,250)-(400,250)-(400,400), alan 11.250', r.ust && r.ust.pts.length === 3 && yak(r.ust.area, 11250, 1e-6), J(r.ust));
}

// ---------------------------------------------------------------------------------
// 1 · Uygulama: Tarama, Sınır ve Dolgu alanı üç ayrı çizgiden oluşan üçgeni görür
// ---------------------------------------------------------------------------------
{
  const bn = await bosNokta();
  const X = bn[0], Y = bn[1];
  await ekle([
    { id: 'tr_1', type: 'LINE', pts: [[X, Y, 0], [X + 300, Y, 0]] },
    { id: 'tr_2', type: 'LINE', pts: [[X + 300, Y, 0], [X + 300, Y + 300, 0]] },
    { id: 'tr_3', type: 'LINE', pts: [[X + 300, Y + 300, 0], [X, Y, 0]] },
  ]);
  await zoom([X - 100, Y - 100, X + 400, Y + 400]);
  await page.click('#toolbar [data-tab="draw"]');
  await arac('t:hatch');
  const n0 = await count();
  await tapWorld(X + 200, Y + 50);
  const h = await sonPrim();
  ok('1a Tarama: üç çizginin içine dokununca dolgu eklendi ("Kapalı alan bulunamadı" yok)', (await count()) === n0 + 1 && h.fill === true && !/bulunamadı/.test(await toast()), J({ n: await count(), n0, h: { fill: h.fill, et: h.et }, t: await toast() }));
  await page.screenshot({ path: `${out}/tarama_ucgen.png` });
  await iptal();
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150);
  await arac('t:boundary');
  await tapWorld(X + 200, Y + 50);
  const b = await sonPrim();
  const kose = [[X, Y], [X + 300, Y], [X + 300, Y + 300]];
  ok('1b Sınır: üç köşeli kapalı polyline, köşeler çizgilerin uçları', (await count()) === n0 + 1 && b.closed && b.ops.length === 3 && kose.every(c => b.ops.some(o => yak(o[1], c[0], 1e-6) && yak(o[2], c[1], 1e-6))), J(b.ops));
  await iptal();
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150);
  // kesen çizgi: en küçük yüz
  await ekle([{ id: 'tr_4', type: 'LINE', pts: [[X - 50, Y + 150, 0], [X + 350, Y + 150, 0]] }]);
  await arac('t:boundary');
  await tapWorld(X + 250, Y + 80);
  const b2 = await sonPrim();
  ok('1c kesen çizgiyle bölünen alan: dokunulan alt yamuk (4 köşe), sınır (150,150) ve (300,150) kesişimlerinden geçer', b2.closed && b2.ops.length === 4 && b2.ops.some(o => yak(o[1], X + 150, 1e-6) && yak(o[2], Y + 150, 1e-6)) && b2.ops.some(o => yak(o[1], X + 300, 1e-6) && yak(o[2], Y + 150, 1e-6)), J(b2.ops));
  await iptal();
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150);
  // dışarıdaki dokunuş yine uyarır
  await arac('t:hatch');
  const n1 = await count();
  await tapWorld(X - 80, Y - 80);
  ok('1d dışarıya dokunuş: "Kapalı alan bulunamadı", dolgu eklenmez', /bulunamadı/.test(await toast()) && (await count()) === n1, await toast());
  await iptal();
  // Dolgu alanı ölçümü de aynı izi kullanır: sonuç paneli alanı söyler (45.000)
  await page.click('#toolbar [data-tab="measure"]');
  await arac('t:fillarea');
  await tapWorld(X + 200, Y + 50);
  const res = await ev(() => ({ acik: !document.getElementById('docPanel').hidden, txt: document.getElementById('docBody').textContent.replace(/\s+/g, ' ') }));
  ok('1e Dolgu alanı da aynı izi kullanır: kesen çizgiyle bölünmüş alt yamuk 33.750, 4 köşe', res.acik && /33[ .]?750/.test(res.txt) && /Köşe\s*4/.test(res.txt), res.txt.slice(0, 200));
  await ev(() => window.dwgApp.onBack()); await bekle(150);   // sonuç paneli kapanır (desen seçicinin üstünü örtmesin)
  await iptal();
}

// ---------------------------------------------------------------------------------
// 2 · Desen seçici: kartlı liste, her desenin SVG önizlemesi, dokunuş seçer, Tamam deseni uygular
// ---------------------------------------------------------------------------------
{
  await page.click('#toolbar [data-tab="draw"]');
  await ev(() => window.dwgApp.editor.act('hatchpat')); await bekle(400);
  const g = await ev(async () => {
    const G = await import('./geom.js');
    const cells = [...document.querySelectorAll('#askField .ask-grid .ask-cell')];
    return {
      acik: !document.getElementById('askDlg') || true,
      n: cells.length, adet: Object.keys(G.HATCH_PATTERNS).length,
      svg: cells.every(c => c.querySelector('svg')),
      ansi31: (() => { const c = cells.find(x => x.dataset.v === 'ANSI31'); return c ? c.querySelectorAll('svg line').length : -1; })(),
      solid: (() => { const c = cells.find(x => x.dataset.v === 'SOLID'); return c ? !!c.querySelector('svg rect[fill="currentColor"]') : false; })(),
      on: (document.querySelector('#askField .ask-cell.on') || {}).dataset ? document.querySelector('#askField .ask-cell.on').dataset.v : null,
      etiket: cells.map(c => c.querySelector('span').textContent),
    };
  });
  ok('2a desen seçici: her desen için bir kart (SOLID dâhil), hepsinde SVG önizleme', g.n === g.adet && g.n >= 10 && g.svg, J({ n: g.n, adet: g.adet, svg: g.svg }));
  ok('2b ANSI31 kartında çizgiler (≥ 3), SOLID kartı dolu kare; geçerli desen (SOLID) vurgulu', g.ansi31 >= 3 && g.solid && g.on === 'SOLID', J({ ansi31: g.ansi31, solid: g.solid, on: g.on }));
  ok('2c kart adları: SOLID Türkçe ad, ötekiler desen adı (ANSI31 …)', g.etiket.includes('ANSI31') && g.etiket.includes('NET') && !g.etiket.includes('SOLID'), J(g.etiket));
  await page.screenshot({ path: `${out}/desen_secici.png` });
  await ev(() => document.querySelector('#askField .ask-cell[data-v="ANSI31"]').click()); await bekle(100);
  const on2 = await ev(() => document.querySelector('#askField .ask-cell.on').dataset.v);
  ok('2d karta dokunuş onu seçer (ANSI31 vurgulu)', on2 === 'ANSI31', on2);
  await page.click('#askOk'); await bekle(300);
  const cur = await ev(() => window.dwgApp.editor.tools.api.hatchPattern());
  ok('2e Tamam: geçerli desen ANSI31, ileti desen adını söyler', cur.name === 'ANSI31' && /ANSI31/.test(await toast()), J({ cur, t: await toast() }));
  // seçilen desenle tarama: üç çizgiden üçgen desen çizgileriyle dolar
  const bn = await bosNokta(); const X = bn[0], Y = bn[1];
  await ekle([{ id: 'tr_a', type: 'LINE', pts: [[X, Y, 0], [X + 200, Y, 0]] }, { id: 'tr_b', type: 'LINE', pts: [[X + 200, Y, 0], [X + 200, Y + 200, 0]] }, { id: 'tr_c', type: 'LINE', pts: [[X + 200, Y + 200, 0], [X, Y, 0]] }]);
  await zoom([X - 50, Y - 50, X + 250, Y + 250]);
  await arac('t:hatch'); const n0 = await count();
  await tapWorld(X + 150, Y + 40);
  const eklenen = await ev((n) => window.dwgApp.state.prims.slice(n).map(p => ({ et: p.et, fill: !!p.fill, nOps: p.ops ? p.ops.length : 0 })), n0);
  ok('2f ANSI31 ile tarama: desen çizgileri eklendi', eklenen.length >= 1 && eklenen.some(p => p.nOps >= 4), J(eklenen));
  await page.screenshot({ path: `${out}/tarama_ansi31.png` });
  await iptal();
  await ev(() => { window.dwgApp.editor.act('hatchpat'); }); await bekle(300);
  await ev(() => document.querySelector('#askField .ask-cell[data-v="SOLID"]').click()); await page.click('#askOk'); await bekle(200);
}

// ---------------------------------------------------------------------------------
// D · Seçilen desenle tarama, tek nesne olarak; desen Özellikler'den değiştirilebilir
// ---------------------------------------------------------------------------------
{
  await iptal();
  // D1 · Tarama aracı çalışırken komut çubuğunda Desen düğmesi ve istemde geçerli desen
  const d1 = await ev(async () => {
    const E = window.dwgApp.editor;
    E.act('t:hatch');
    await new Promise(r => setTimeout(r, 200));
    return { istem: (document.getElementById('cmdText') || {}).textContent || '',
      btns: [...document.querySelectorAll('#cmdBtns [data-cmd]')].map(b => b.dataset.cmd) };
  });
  ok('D1 Tarama komutunda "Desen" düğmesi var, istem geçerli deseni yazar', d1.btns.includes('hatchpat') && /Düz dolgu|Solid/.test(d1.istem), J(d1));

  // D2 · Düğmeden ANSI31 ×200 seçilir, istem anında güncellenir
  const d2 = await ev(async () => {
    document.querySelector('#cmdBtns [data-cmd="hatchpat"]').click();
    await new Promise(r => setTimeout(r, 350));
    const k = [...document.querySelectorAll('#askField .ask-cell')].find(x => x.dataset.v === 'ANSI31');
    if (!k) return { kartYok: true };
    k.click();
    document.getElementById('askF_scale').value = '200';
    document.getElementById('askOk').click();
    await new Promise(r => setTimeout(r, 350));
    return { desen: window.dwgApp.editor.curPattern, istem: (document.getElementById('cmdText') || {}).textContent || '' };
  });
  ok('D2 komut çubuğundan seçilen desen ve ölçek isteme yansır', d2.desen && d2.desen.name === 'ANSI31' && d2.desen.scale === 200 && /ANSI31/.test(d2.istem), J(d2));

  // D3 · Kapalı alana tarama: SEÇİLEN desenle üretilir ve iki parça TEK grup olur
  const d3 = await ev(async () => {
    const A = window.dwgApp, E = A.editor, S = A.state;
    const x0 = 1000, y0 = 1000, w = 400;
    E.doc.run({ op: 'add', ents: [{ id: 'TRM_RECT', type: 'LWPOLYLINE', layer: '0', color: 256, closed: true,
      pts: [[x0, y0, 0], [x0 + w, y0, 0], [x0 + w, y0 + w, 0], [x0, y0 + w, 0]] }] });
    A.requestRender();
    await new Promise(r => setTimeout(r, 150));
    const once = S.prims.length;
    E.act('t:hatch');
    await new Promise(r => setTimeout(r, 150));
    await E.tools.regionTap([x0 + w / 2, y0 + w / 2, 0]);
    await new Promise(r => setTimeout(r, 350));
    const yeni = S.prims.slice(once);
    return { n: yeni.length, turler: yeni.map(p => p.et || ('k' + p.k)),
      desen: [...new Set(yeni.map(p => p.info && p.info.pattern).filter(Boolean))],
      olcek: [...new Set(yeni.map(p => p.info && p.info.hscale).filter(v => v != null))],
      grup: [...new Set(yeni.map(p => p.info && p.info.gid).filter(Boolean))].length };
  });
  ok('D3 tarama SEÇİLEN desenle üretilir (ANSI31 ×200), sınır + desen çizgileri', d3.n === 2 && J(d3.turler) === J(['HATCH', 'PATH']) && J(d3.desen) === J(['ANSI31']) && J(d3.olcek) === J([200]), J(d3));
  ok('D3b iki parça TEK grup kimliği taşır (birlikte seçilir, birlikte silinir)', d3.grup === 1, J(d3));

  // D4 · Özellikler: desen / ölçek / açı alanları var ve uygulanınca tarama yeniden üretilir
  const d4 = await ev(async () => {
    const A = window.dwgApp, E = A.editor, S = A.state;
    const h = [...S.prims].reverse().find(p => (p.info && p.info.t) === 'HATCH' || p.et === 'HATCH');
    if (!h) return { taramaYok: true };
    E.sel.clear(); E.sel.add(h);
    E.act('props');
    await new Promise(r => setTimeout(r, 400));
    const alanlar = [...document.querySelectorAll('#docBody [data-pg]')].map(i => i.dataset.pg);
    const sel = document.querySelector('#docBody [data-pg="hpat"]');
    if (!sel) return { alanlar, desenAlaniYok: true };
    const oncekiN = S.prims.length;
    sel.value = 'ANSI37';
    document.querySelector('#docBody [data-pg="hsc"]').value = '300';
    document.querySelector('#docBody [data-pg="hang"]').value = '15';
    document.getElementById('pOk').click();
    await new Promise(r => setTimeout(r, 400));
    const son = [...S.prims].reverse().find(p => (p.info && p.info.t) === 'HATCH' || p.et === 'HATCH');
    return { alanlar, oncekiN, sonN: S.prims.length,
      desen: son && son.info && son.info.pattern, olcek: son && son.info && son.info.hscale, aci: son && son.info && son.info.hangle };
  });
  ok('D4 Özellikler taramada desen / ölçek / açı alanlarını gösterir', J(d4.alanlar) === J(['hpat', 'hsc', 'hang']), J(d4));
  ok('D4b desen değişikliği uygulanır: tarama yeni desen, ölçek ve açıyla yeniden üretilir', d4.desen === 'ANSI37' && d4.olcek === 300 && d4.aci === 15, J(d4));

  // D5 · Deseni geri SOLID'e çevirmek de çalışır (dolu tarama da düzenlenebilir)
  const d5 = await ev(async () => {
    const A = window.dwgApp, E = A.editor, S = A.state;
    const h = [...S.prims].reverse().find(p => (p.info && p.info.t) === 'HATCH' || p.et === 'HATCH');
    E.sel.clear(); E.sel.add(h);
    E.act('props');
    await new Promise(r => setTimeout(r, 400));
    const sel = document.querySelector('#docBody [data-pg="hpat"]');
    if (!sel) return { alanYok: true };
    sel.value = 'SOLID';
    document.getElementById('pOk').click();
    await new Promise(r => setTimeout(r, 400));
    const son = [...S.prims].reverse().find(p => (p.info && p.info.t) === 'HATCH' || p.et === 'HATCH');
    return { desen: son && son.info && son.info.pattern, dolu: !!(son && son.fill) };
  });
  ok('D5 desenli tarama SOLID\'e çevrilebilir (dolgu olur)', d5.desen === 'SOLID' && d5.dolu === true, J(d5));

  await ev(() => { window.dwgApp.editor.act('hatchpat'); }); await bekle(300);
  await ev(() => document.querySelector('#askField .ask-cell[data-v="SOLID"]').click()); await page.click('#askOk'); await bekle(200);
  await iptal();
}

ok('X sayfa hatası yok', errors.length === 0, J(errors.slice(0, 3)));
await browser.close(); await srv.kill();
C.summary(); C.exit();
