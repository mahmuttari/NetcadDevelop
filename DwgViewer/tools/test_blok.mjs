/*
 * v7.72 — blok tablosu: BLOCK (taban noktası, bloğa çevir), INSERT (ölçek, dönüş, öznitelik sorusu, MINSERT), paylaşılan info
 * (taşıma sonrası matris), BEDIT (oturum, kaydet → bütün yerleştirmeler değişir), REFEDIT (yerinde, arka plan solgun), ATTDEF /
 * ATTRIB / BATTMAN eşitleme, EXPLODE (işaret kalkar), KOPYALA (tek tanıtıcı), RENAME / BLOCKREPLACE / PURGE, NCOPY, DXF'te
 * BLOCKS / INSERT / ATTRIB, günlük yeniden oynatma (dosya yeniden açılınca tablo kurulur), Bloklar paneli, Özellikler paleti.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_blok.mjs [çıktı] [örnekler]
 */
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
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const tapWorld = async (x, y) => { await bekle(110); await temizle(); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(420); };
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(200); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, step: T.step, selecting: T.selecting, text: document.getElementById('cmdText').textContent.trim(), sel: window.dwgApp.editor.sel.size }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const prims = () => ev(() => window.dwgApp.state.prims.map(p => ({ key: p.key, k: p.k, et: p.et, lay: p.lay, ai: p.ai, x: p.x, y: p.y, lines: p.lines, bb: p.bb, h: p.info && p.info.h, t: p.info && p.info.t, name: p.info && p.info.name, blk: !!(p.info && p.info.blk), ix: p.info && p.info.x, iy: p.info && p.info.y, rot: p.info && p.info.rot, sx: p.info && p.info.sx, sy: p.info && p.info.sy, attrs: p.info && p.info.attrs, ops: p.ops ? p.ops.map(o => o.slice()) : null })));
const blocks = () => ev(() => [...window.dwgApp.state.blocks.values()].map(d => ({ name: d.name, base: d.base, n: d.ents.length, types: d.ents.map(e => e.type), dyn: d.dyn ? d.dyn.params.length : 0 })));
const komut = async (s) => { await page.fill('#cmdInput', s); await bekle(100); await page.click('#cmdEnter'); await bekle(250); };
const bitir = async () => { await page.click('#cmdBtns [data-cmd="finish"]'); await bekle(250); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor, S = window.dwgApp.state; const n0 = S.prims.length; const NID = () => 'T' + Math.random().toString(36).slice(2, 10); E.runCmd({ op: 'add', ents: es.map(e => ({ ...e, id: e.id || NID(), layer: e.layer || '0', color: e.color == null ? 256 : e.color })) }); return S.prims.slice(n0).map(p => p.key); }, ents);
const secKeys = (keys) => ev((ks) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (ks.includes(p.key)) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, keys);
const secH = (h) => ev((hh) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (p.k !== 4 && p.info && p.info.h === hh) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, h);
const grup = (h) => ev((hh) => window.dwgApp.state.prims.filter(p => p.info && p.info.h === hh).map(p => ({ key: p.key, k: p.k, et: p.et, ai: p.ai, lines: p.lines, x: p.x, y: p.y, ops: p.ops ? p.ops.map(o => o.slice()) : null, x0: p.bb[0], y0: p.bb[1], x1: p.bb[2], y1: p.bb[3] })), h);
const bosNokta = () => ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });
const runCmd = (cmd) => ev((c) => window.dwgApp.editor.runCmd(c), cmd);
const undo = () => ev(() => { window.dwgApp.editor.act('undo'); });

await page.click('#toolbar [data-tab="edit"]');
const [X0, Y0] = await bosNokta();
await zoom([X0 - 50, Y0 - 50, X0 + 450, Y0 + 350]);

// ---------------------------------------------------------------------------------
// 1 · BLOCK: seçim + taban noktası + ad → tanım; seçim bloğa çevrilir (aynı görünüm, tek tanıtıcı, ortak info, işaret)
// ---------------------------------------------------------------------------------
let H1 = null;
{
  const keys = await ekle([
    { type: 'LINE', pts: [[X0, Y0, 0], [X0 + 100, Y0, 0]] },
    { type: 'LINE', pts: [[X0 + 100, Y0, 0], [X0 + 100, Y0 + 60, 0]] },
    { type: 'CIRCLE', pts: [[X0 + 50, Y0 + 30, 0]], r: 20 },
  ]);
  const n0 = await count();
  await secKeys(keys);
  await arac('t:block');
  const d0 = await durum();
  ok('1a BLOCK: seçim hazır → taban noktası istenir (adım 1)', d0.active === 'block' && d0.step === 1 && !d0.selecting, J(d0));
  await queueAnswers(page, { name: 'KAPI', mode: 'convert', lib: false });
  await tapWorld(X0, Y0);
  await bekle(300);
  const bl = await blocks();
  ok('1b tanım tabloya girdi: KAPI, taban dokunulan nokta, 3 varlık', bl.length === 1 && bl[0].name === 'KAPI' && yak(bl[0].base[0], X0, 1e-3) && yak(bl[0].base[1], Y0, 1e-3) && bl[0].n === 3, J(bl));
  const P = (await prims()).filter(p => p.name === 'KAPI');
  H1 = P.length ? P[0].h : null;
  const geo = P.filter(p => p.k !== 4), mark = P.filter(p => p.k === 4);
  ok('1c seçim yerleştirmeye döndü: 3 geometri ilkeli + 1 ekleme noktası işareti, hepsi aynı tanıtıcıda, info.blk', geo.length === 3 && mark.length === 1 && P.every(p => p.h === H1 && p.t === 'INSERT' && p.blk), J(P.map(p => [p.key, p.k, p.t])));
  ok('1d eski ilkeller kalmadı; ilkel sayısı 3 + 1 işaret', (await count()) === n0 + 1 && !(await prims()).some(p => keys.includes(p.key)), String(await count()));
  const ln = geo.find(p => p.ops && p.ops.length === 2 && p.ops[1][0] === 1);
  ok('1e geometri birebir yerinde (çizgi X0..X0+100), ekleme noktası taban, ölçek 1, dönüş 0', ln && yak(ln.ops[0][1], X0, 1e-6) && yak(ln.ops[1][1], X0 + 100, 1e-6) && yak(P[0].ix, X0, 1e-3) && yak(P[0].iy, Y0, 1e-3) && yak(P[0].sx, 1) && yak(P[0].sy, 1) && yak(P[0].rot, 0), J([ln && ln.ops, P[0].ix, P[0].sx]));
  ok('1f yerleştirme seçili kaldı (3 ilkel)', (await durum()).sel === 3, String((await durum()).sel));
  await shot('blok_1');
  await iptal();
}

// ---------------------------------------------------------------------------------
// 2 · INSERT: form (blok, ölçek 2, dönüş 90) + ekleme noktası → dönmüş ve ölçeklenmiş yerleştirme; matris ayrışımı
// ---------------------------------------------------------------------------------
let H2 = null;
{
  await queueAnswers(page, { name: 'KAPI', scale: 2, rot: 90, explode: false, cols: 1, rows: 1, dx: 0, dy: 0 });
  await arac('t:insert');
  await bekle(300);
  const d0 = await durum();
  ok('2a INSERT: form cevaplanınca ekleme noktası istenir (adım 1)', d0.active === 'insert' && d0.step === 1, J(d0));
  const n0 = await count();
  await tapWorld(X0 + 250, Y0);
  const P = (await prims()).filter(p => p.name === 'KAPI' && p.h !== H1);
  H2 = P.length ? P[0].h : null;
  ok('2b yeni yerleştirme: 3 geometri + işaret, ekleme noktası (X0+250, Y0), ölçek 2 / 2, dönüş 90°', (await count()) === n0 + 4 && P.length === 4 && yak(P[0].ix, X0 + 250, 1e-3) && yak(P[0].iy, Y0, 1e-3) && yak(P[0].sx, 2, 1e-9) && yak(P[0].sy, 2, 1e-9) && yak(P[0].rot, Math.PI / 2, 1e-9), J(P.map(p => [p.ix, p.iy, p.sx, p.sy, p.rot])));
  // tanımdaki (X0..X0+100, Y0) çizgisi tabana göre (0..100, 0): 2 kat ve 90° → ekleme noktasından yukarı 200 birim
  const ln = P.find(p => p.k !== 4 && p.ops && p.ops.length === 2 && p.ops[1][0] === 1 && yak(p.ops[0][1], X0 + 250, 1e-3));
  ok('2c çizgi tabandan 90° dönmüş ve 2 kat: (X0+250, Y0) → (X0+250, Y0+200)', ln && yak(ln.ops[1][1], X0 + 250, 1e-3) && yak(ln.ops[1][2], Y0 + 200, 1e-3), J(ln && ln.ops));
  ok('2d araç tek yerleştirmeyle biter (AutoCAD INSERT)', !(await durum()).active, J(await durum()));
  ok('2e ileti "Blok eklendi · KAPI"', /Blok eklendi|Block inserted/.test(await toast()) && /KAPI/.test(await toast()), await toast());
  await shot('blok_2');
}

// ---------------------------------------------------------------------------------
// 3 · Taşıma / kopyalama ortak info'yu korur: matris ve x-y güncel; kopya TEK tanıtıcı; geri alma
// ---------------------------------------------------------------------------------
{
  const keys = (await grup(H2)).map(p => p.key);
  await runCmd({ op: 'xform', keys, m: [1, 0, 0, 1, 10, 20], dz: 0 });
  const P = await grup(H2);
  const info = (await prims()).find(p => p.h === H2);
  ok('3a taşınan yerleştirmenin bilgisi güncel: ekleme noktası (+10, +20), dönüş ve ölçek aynı; bütün ilkeller aynı info', yak(info.ix, X0 + 260, 1e-3) && yak(info.iy, Y0 + 20, 1e-3) && yak(info.sx, 2, 1e-9) && yak(info.rot, Math.PI / 2, 1e-9) && P.length === 4, J([info.ix, info.iy, info.sx, info.rot]));
  const same = await ev((h) => { const g = window.dwgApp.state.prims.filter(p => p.info && p.info.h === h); return g.every(p => p.info === g[0].info); }, H2);
  ok('3b taşıma sonrası info nesnesi PAYLAŞILIYOR (tek nesne)', same, String(same));
  const geoKeys = (await grup(H2)).filter(p => p.k !== 4).map(p => p.key);
  const newKeys = geoKeys.map((_, i) => 'K' + i);
  await runCmd({ op: 'copy', keys: geoKeys, newKeys, m: [1, 0, 0, 1, 0, 150], dz: 0 });
  const kop = (await prims()).filter(p => newKeys.includes(p.key));
  ok('3c kopya: 3 ilkel, TEK yeni tanıtıcı (ilk yeni anahtar), ortak info, ekleme noktası +150', kop.length === 3 && kop.every(p => p.h === 'K0') && yak(kop[0].iy, Y0 + 170, 1e-3) && kop[0].blk, J(kop.map(p => [p.key, p.h, p.iy])));
  await undo();
  ok('3d geri alma kopyayı kaldırır', !(await prims()).some(p => p.h === 'K0'), '');
  await undo();
  const back = (await prims()).find(p => p.h === H2);
  ok('3e ikinci geri alma taşımayı geri alır (ekleme noktası eski yerinde)', yak(back.ix, X0 + 250, 1e-3) && yak(back.iy, Y0, 1e-3), J([back.ix, back.iy]));
}

// ---------------------------------------------------------------------------------
// 4 · BEDIT: oturum (tanım uzayı, ana belge dokunulmaz), çizgi ekle, kaydet → İKİ yerleştirme de 4 parça; geri alma tek adım
// ---------------------------------------------------------------------------------
{
  const nAna = await count();
  const ok0 = await ev(() => window.dwgApp.editor.beditStart('KAPI', {}));
  await bekle(300);
  const st = await ev(() => ({ b: window.dwgApp.editor.bedit(), n: window.dwgApp.state.prims.length, keys: window.dwgApp.state.prims.map(p => p.key), bar: !!document.getElementById('beditBar') && !document.getElementById('beditBar').hidden, mode: document.getElementById('stMode').textContent }));
  ok('4a BEDIT oturumu açıldı: 3 tanım ilkeli (B0, B1, B2), çubuk görünür, durum çipi "BEDIT · KAPI"', ok0 && st.b && st.b.kind === 'bedit' && st.b.name === 'KAPI' && st.n === 3 && st.keys.join(',') === 'B0,B1,B2' && st.bar && /BEDIT/.test(st.mode), J(st));
  await shot('blok_bedit');
  await ekle([{ type: 'LINE', pts: [[X0, Y0, 0], [X0, Y0 + 60, 0]] }]);
  ok('4b oturumda çizgi eklendi (4 ilkel); ana belge günlüğüne yazılmadı', (await count()) === 4 && (await ev(() => JSON.parse(localStorage.getItem('edits:' + window.dwgApp.state.fileKey) || '[]').filter(c => c.op === 'add' && c.ents.some(e => e.type === 'LINE' && !e.id.startsWith('T'))).length)) === 0, String(await count()));
  await ev(() => window.dwgApp.editor.beditSave());
  await bekle(400);
  const bl = await blocks();
  const g1 = await grup(H1), g2 = await grup(H2);
  ok('4c kaydet: tanım 4 varlık; iki yerleştirme de 4 geometri + işaret (eşitlendi); ana belge ilkel sayısı +2', bl[0].n === 4 && g1.length === 5 && g2.length === 5 && (await count()) === nAna + 2 && !(await ev(() => window.dwgApp.editor.bedit())), J({ n: bl[0].n, g1: g1.length, g2: g2.length, c: await count(), nAna }));
  const ln2 = g2.find(p => p.k !== 4 && p.ops && yak(p.ops[0][1], X0 + 250, 1e-3) && yak(p.ops[0][2], Y0, 1e-3) && yak(p.ops[1][1], X0 + 130, 1e-3));
  ok('4d yeni çizgi ikinci yerleştirmede 2 kat ve 90° dönmüş: (X0+250,Y0) → (X0+130,Y0)', !!ln2, J(g2.filter(p => p.k !== 4).map(p => p.ops && p.ops.map(o => o.slice(0, 3)))));
  ok('4e ileti "KAPI kaydedildi"', /KAPI/.test(await toast()) && /kaydedildi|saved/.test(await toast()), await toast());
  await undo();
  ok('4f geri alma (tek adım): tanım 3 varlığa, yerleştirmeler 3 geometriye döner', (await blocks())[0].n === 3 && (await grup(H1)).length === 4 && (await grup(H2)).length === 4, J([(await blocks())[0].n, (await grup(H1)).length]));
  await ev(() => window.dwgApp.editor.act('redo'));
  ok('4g yinele: 4 varlık, yerleştirmeler 5 ilkel', (await blocks())[0].n === 4 && (await grup(H2)).length === 5, '');
}

// ---------------------------------------------------------------------------------
// 5 · REFEDIT: yerinde oturum (dünya koordinatı, arka plan solgun), bir parça sil, kaydet → tanım 3, öteki yerleştirme de değişir
// ---------------------------------------------------------------------------------
{
  const ok0 = await ev((h) => window.dwgApp.editor.beditStart('KAPI', { h, inplace: true }), H2);
  await bekle(300);
  const st = await ev(() => ({ b: window.dwgApp.editor.bedit(), n: window.dwgApp.state.prims.length, backdrop: !!(window.dwgApp.state.backdrop && window.dwgApp.state.backdrop.prims.length), bd: window.dwgApp.state.backdrop ? window.dwgApp.state.backdrop.prims.length : 0, first: window.dwgApp.state.prims[0] && window.dwgApp.state.prims[0].ops ? window.dwgApp.state.prims[0].ops[0].slice(1, 3) : null }));
  ok('5a REFEDIT: 4 ilkel dünya koordinatında (ilk çizgi X0+250 noktasından başlar), arka plan solgun küme dolu', ok0 && st.b && st.b.kind === 'refedit' && st.n === 4 && st.backdrop && st.first && yak(st.first[0], X0 + 250, 1e-3), J(st));
  await shot('blok_refedit');
  await runCmd({ op: 'delete', keys: ['B3'] });
  await ev(() => window.dwgApp.editor.beditSave());
  await bekle(400);
  ok('5b kaydet: tanım 3 varlık, birinci yerleştirme de 3 geometri + işaret; arka plan kalktı', (await blocks())[0].n === 3 && (await grup(H1)).length === 4 && (await grup(H2)).length === 4 && !(await ev(() => window.dwgApp.state.backdrop)), J([(await blocks())[0].n, (await grup(H1)).length]));
  const g2 = await grup(H2);
  const ln = g2.find(p => p.k !== 4 && p.ops && p.ops.length === 2 && p.ops[1][0] === 1 && yak(p.ops[0][1], X0 + 250, 1e-3) && yak(p.ops[1][2], Y0 + 200, 1e-3));
  ok('5c yerinde düzenlenen yerleştirme yerinde kaldı (çizgi (X0+250,Y0)→(X0+250,Y0+200))', !!ln, J(g2.map(p => p.ops && p.ops.map(o => o.slice(0, 3)))));
}

// ---------------------------------------------------------------------------------
// 6 · ATTDEF → BLOCK → INSERT öznitelik sorusu → ATTRIB yazısı (ai), öznitelik düzenleme ortak info'ya işler; BATTMAN eşitleme
// ---------------------------------------------------------------------------------
let H3 = null;
{
  await queueAnswers(page, { tag: 'no', prompt: 'Numara', text: '1', h: 8, rot: 0, invisible: false, constant: false });
  await arac('t:attdef');
  await tapWorld(X0 + 20, Y0 + 250);
  const ad = (await prims()).filter(p => p.et === 'ATTDEF');
  ok('6a ATTDEF: etiket büyük harf (NO), öntanımlı değer yazı olarak görünür, konum dokunulan nokta', ad.length === 1 && ad[0].lines.join('') === '1' && yak(ad[0].x, X0 + 20, 1e-3) && yak(ad[0].y, Y0 + 250, 1e-3), J(ad));
  await iptal();
  const [kL] = await ekle([{ type: 'LINE', pts: [[X0, Y0 + 240, 0], [X0 + 60, Y0 + 240, 0]] }]);
  await secKeys([kL, ad[0].key]);
  await arac('t:block');
  await queueAnswers(page, { name: 'ETIKET', mode: 'convert', lib: false });
  await tapWorld(X0, Y0 + 240);
  await bekle(300);
  const bl = await blocks();
  const et = bl.find(b => b.name === 'ETIKET');
  const P = (await prims()).filter(p => p.name === 'ETIKET');
  H3 = P.length ? P[0].h : null;
  const att = P.find(p => p.et === 'ATTRIB');
  ok('6b ETIKET tanımı: LINE + ATTDEF; yerleştirmede öznitelik [NO, 1], ATTRIB yazısı "1" (ai 0)', et && et.types.includes('ATTDEF') && P.length === 3 && att && att.ai === 0 && att.lines.join('') === '1' && P[0].attrs && P[0].attrs[0][0] === 'NO' && P[0].attrs[0][1] === '1', J({ et, attrs: P[0] && P[0].attrs, att: att && [att.ai, att.lines] }));
  await iptal();
  // INSERT: öznitelik formu ekleme noktasından sonra sorulur
  await queueAnswers(page, { name: 'ETIKET', scale: 1, rot: 0, explode: false, cols: 1, rows: 1, dx: 0, dy: 0 }, { a0: '42' });
  await arac('t:insert');
  await bekle(250);
  await tapWorld(X0 + 200, Y0 + 240);
  const log = await askLog(page);
  const P2 = (await prims()).filter(p => p.name === 'ETIKET' && p.h !== H3);
  const att2 = P2.find(p => p.et === 'ATTRIB');
  ok('6c INSERT: öznitelik formu soruldu (Numara), değer 42 ATTRIB yazısı ve info.attrs oldu', log.some(l => l.type === 'form' && /ETIKET/.test(l.label)) && att2 && att2.lines.join('') === '42' && P2[0].attrs[0][1] === '42', J({ log: log.slice(-2), att2: att2 && att2.lines, attrs: P2[0] && P2[0].attrs }));
  // öznitelik düzenleme (attrib op): ortak info her ilkelde güncel
  await runCmd({ op: 'attrib', h: H3, items: [{ i: 0, value: '7' }] });
  const g = await grup(H3);
  const infos = await ev((h) => window.dwgApp.state.prims.filter(p => p.info && p.info.h === h).map(p => p.info.attrs[0][1]), H3);
  ok('6d öznitelik değişince ATTRIB yazısı "7", bütün ilkellerin info.attrs aynı', g.find(p => p.et === 'ATTRIB').lines.join('') === '7' && infos.every(v => v === '7') && infos.length === 3, J(infos));
  // BATTMAN: etiket NO → NUMARA, öntanımlı 9; eşitleme değeri korur (etiket eşleşmez → öntanımlı)
  await queueAnswers(page, { name: 'ETIKET' }, { tag0: 'NUMARA', prompt0: 'Numara', def0: '9', inv0: false, con0: false, del0: false });
  await arac('battman');
  await bekle(400);
  const bl2 = await blocks();
  const g3 = await grup(H3);
  ok('6e BATTMAN: tanımdaki etiket NUMARA; yerleştirmeler eşitlendi, eski etiketle eşleşmeyen değer öntanımlıya (9) döner', bl2.find(b => b.name === 'ETIKET').n === 2 && (await ev((h) => window.dwgApp.state.prims.find(p => p.info && p.info.h === h).info.attrs, H3))[0].join('=') === 'NUMARA=9' && g3.find(p => p.et === 'ATTRIB').lines.join('') === '9', J(await ev((h) => window.dwgApp.state.prims.find(p => p.info && p.info.h === h).info.attrs, H3)));
  await shot('blok_attr');
}

// ---------------------------------------------------------------------------------
// 7 · EXPLODE: parçalar bağımsız, işaret kalkar; NCOPY: içten kopya; RENAME / BLOCKREPLACE / PURGE; Bloklar paneli
// ---------------------------------------------------------------------------------
{
  const n0 = await count();
  await arac('t:explode');
  const g = await grup(H2);
  const ln = g.find(p => p.k !== 4 && p.ops);
  await tapWorld((ln.ops[0][1] + ln.ops[1][1]) / 2, (ln.ops[0][2] + ln.ops[1][2]) / 2);
  const after = (await prims()).filter(p => p.h === H2);
  ok('7a EXPLODE: yerleştirme parçalandı, ekleme noktası işareti kalktı, parçalar blok bağı taşımaz', after.length === 0 && (await count()) === n0 - 1 && !(await prims()).some(p => p.k === 4 && p.h === H2), J({ n: after.length, c: await count() }));
  await iptal();
  // NCOPY
  const g1 = await grup(H1);
  const c0 = await count();
  await arac('t:ncopy');
  const l1 = g1.find(p => p.k !== 4 && p.ops && p.ops.length === 2 && p.ops[1][0] === 1);
  await tapWorld((l1.ops[0][1] + l1.ops[1][1]) / 2, (l1.ops[0][2] + l1.ops[1][2]) / 2);
  const son = (await prims()).slice(-1)[0];
  ok('7b NCOPY: blok içindeki çizginin bağımsız kopyası çizime girdi (aynı yer, blok bağı yok)', (await count()) === c0 + 1 && son.t !== 'INSERT' && son.ops && yak(son.ops[0][1], l1.ops[0][1], 1e-6) && yak(son.ops[1][2], l1.ops[1][2], 1e-6), J([son.t, son.ops]));
  await iptal();
  // RENAME (op)
  await runCmd({ op: 'blockrename', name: 'KAPI', newName: 'PENCERE' });
  ok('7c RENAME: tanım adı PENCERE, yerleştirmenin info.name da', (await blocks()).some(b => b.name === 'PENCERE') && (await prims()).find(p => p.h === H1).name === 'PENCERE', J((await blocks()).map(b => b.name)));
  // BLOCKREPLACE: ETIKET yerleştirmeleri PENCERE olur
  const nEt = (await prims()).filter(p => p.name === 'ETIKET' && p.k !== 4).length;
  await runCmd({ op: 'blockreplace', from: 'ETIKET', to: 'PENCERE' });
  const pen = (await prims()).filter(p => p.name === 'PENCERE' && p.k !== 4).length;
  ok('7d BLOCKREPLACE: ETIKET yerleştirmeleri PENCERE geometrisi aldı (2 yerleştirme × 3 = 6 + eski 3)', nEt === 4 && pen === 9 && !(await prims()).some(p => p.name === 'ETIKET'), J({ nEt, pen }));
  await undo();
  ok('7e geri alma: ETIKET yerleştirmeleri geri', (await prims()).filter(p => p.name === 'ETIKET' && p.k !== 4).length === 4, '');
  // PURGE: kullanılmayan tanım — önce ETIKET yerleştirmelerini sil
  const etKeys = (await prims()).filter(p => p.name === 'ETIKET').map(p => p.key);
  await runCmd({ op: 'delete', keys: etKeys });
  await queueAnswers(page, { blocks: true, layers: false });
  await arac('purge');
  await bekle(300);
  ok('7f PURGE: kullanılmayan ETIKET tanımı silindi, PENCERE (kullanılıyor) kaldı', (await blocks()).map(b => b.name).join(',') === 'PENCERE', J((await blocks()).map(b => b.name)));
  // Bloklar paneli
  await arac('blocks');
  const panel = await ev(() => ({ open: !document.getElementById('docPanel').hidden, title: document.getElementById('docTitle').textContent, rows: [...document.querySelectorAll('#docBody .blk-row .blk-name b')].map(b => b.textContent), btns: [...document.querySelectorAll('#docBody [data-bk]')].map(b => b.dataset.bk) }));
  ok('7g Bloklar paneli: PENCERE satırı; Ekle / Düzenle / Yeniden adlandır / Değiştir / Kütüphaneye / WBLOCK düğmeleri', panel.open && /Bloklar|Blocks/.test(panel.title) && panel.rows.includes('PENCERE') && ['insert', 'edit', 'ren', 'repl', 'tolib', 'wblock', 'new', 'ins', 'purge'].every(x => panel.btns.includes(x)), J(panel));
  await shot('blok_panel');
  await ev(() => window.dwgApp.onBack());
}

// ---------------------------------------------------------------------------------
// 8 · DXF: BLOCK_RECORD + BLOCKS (PENCERE) + INSERT (2 kez) ; günlük yeniden oynatma: dosya yeniden açılınca tablo kurulur
// ---------------------------------------------------------------------------------
{
  const dxf = await ev(() => { const r = window.dwgApp.editor.dxfBase64(false); return r ? decodeURIComponent(escape(atob(r.b64))) : ''; });
  const cnt = (re) => (dxf.match(re) || []).length;
  ok('8a DXF: BLOCK_RECORD tablosu, BLOCKS bölümünde PENCERE tanımı (3 varlık), ENTITIES\'te INSERT', /\n2\r\nBLOCK_RECORD/.test(dxf) && /\n0\r\nBLOCK\r\n[\s\S]*?\n2\r\nPENCERE/.test(dxf) && cnt(/\n0\r\nINSERT\r\n/g) === 1 && /\n2\r\nPENCERE\r\n[\s\S]*?\n0\r\nENDBLK/.test(dxf), J({ ins: cnt(/\n0\r\nINSERT\r\n/g), blk: cnt(/\n0\r\nBLOCK\r\n/g) }));
  ok('8b INSERT ilkelleri ayrıca yazılmadı: dosyada yerleştirmenin çizgileri değil tek INSERT var (LINE sayısı = tanımdaki + serbest)', cnt(/\n0\r\nLINE\r\n/g) >= 2, String(cnt(/\n0\r\nLINE\r\n/g)));
  const logLen = await ev(() => JSON.parse(localStorage.getItem('edits:' + window.dwgApp.state.fileKey) || '[]').length);
  await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
  await bekle(300);
  const yeniden = await ev(() => ({ blocks: [...window.dwgApp.state.blocks.keys()], ins: window.dwgApp.state.prims.filter(p => p.info && p.info.blk && p.k !== 4).length, marks: window.dwgApp.state.prims.filter(p => p.k === 4 && p.info && p.info.blk).length }));
  ok('8c dosya yeniden açılınca günlük oynar: tablo (PENCERE) ve yerleştirme ilkelleri geri gelir', logLen > 0 && yeniden.blocks.includes('PENCERE') && yeniden.ins === 3 && yeniden.marks === 1, J(yeniden));
}

// ---------------------------------------------------------------------------------
// 9 · Özellikler paleti: yerleştirmede konum / dönüş / ölçek / öznitelik alanları; dönüş 45° uygulanınca matris döner
// ---------------------------------------------------------------------------------
{
  await ev(() => { window.dwgApp.osnap.setModes([]); document.getElementById('toast').hidden = true; });
  const h = await ev(() => { const p = window.dwgApp.state.prims.find(q => q.info && q.info.blk && q.k !== 4); return p ? p.info.h : null; });
  await secH(h);
  await arac('props');
  const f = await ev(() => [...document.querySelectorAll('#docBody [data-pg]')].map(e => e.dataset.pg));
  ok('9a Özellikler: yerleştirme alanları ix, iy, irot, isx, isy', ['ix', 'iy', 'irot', 'isx', 'isy'].every(k => f.includes(k)), J(f));
  await ev(() => { const e = document.querySelector('#docBody [data-pg="irot"]'); e.value = '45'; document.getElementById('pOk').click(); });
  await bekle(300);
  const info = await ev((hh) => { const p = window.dwgApp.state.prims.find(q => q.info && q.info.h === hh); return { rot: p.info.rot, sx: p.info.sx, x: p.info.x }; }, h);
  ok('9b dönüş 45° uygulandı: info.rot = 45°, ölçek ve ekleme noktası aynı', yak(info.rot, Math.PI / 4, 1e-9) && yak(info.sx, 1, 1e-9) && yak(info.x, X0, 1e-3), J(info));
  // çizgi: uç noktası düzenleme
  const [kL] = await ekle([{ type: 'LINE', pts: [[X0, Y0 + 400, 0], [X0 + 100, Y0 + 400, 0]] }]);
  await secKeys([kL]);
  await arac('props');
  const f2 = await ev(() => [...document.querySelectorAll('#docBody [data-pg]')].map(e => e.dataset.pg));
  await ev(() => { document.querySelector('#docBody [data-pg="x2"]').value = '' + (parseFloat(document.querySelector('#docBody [data-pg="x2"]').value) + 50); document.getElementById('pOk').click(); });
  await bekle(250);
  const l = (await prims()).find(p => p.key === kL);
  ok('9c çizgi alanları x1 y1 x2 y2; uç X +50 uygulandı (yeniden şekillendirme)', ['x1', 'y1', 'x2', 'y2'].every(k => f2.includes(k)) && yak(l.ops[1][1], X0 + 150, 1e-4) && yak(l.ops[1][2], Y0 + 400, 1e-4), J([f2, l.ops]));
  // yazı: içerik + yükseklik
  const [kT] = await ekle([{ type: 'TEXT', pts: [[X0, Y0 + 450, 0]], text: 'AB', h: 5 }]);
  await secKeys([kT]);
  await arac('props');
  await ev(() => { document.querySelector('#docBody [data-pg="text"]').value = 'XYZ'; document.querySelector('#docBody [data-pg="th"]').value = '9'; document.getElementById('pOk').click(); });
  await bekle(250);
  const tx = (await prims()).find(p => p.key === kT);
  ok('9d yazı alanları: içerik XYZ ve yükseklik 9 uygulandı (tek geri alma adımı)', tx.lines.join('') === 'XYZ' && yak((await ev((k) => window.dwgApp.state.prims.find(p => p.key === k).h, kT)), 9, 1e-9), J(tx.lines));
  await undo();
  const tx2 = (await prims()).find(p => p.key === kT);
  ok('9e geri alma ikisini birden geri alır (grup)', tx2.lines.join('') === 'AB', J(tx2.lines));
  await shot('blok_props');
}

await browser.close();
await srv.kill();
C.summary(errors);
C.exit();
