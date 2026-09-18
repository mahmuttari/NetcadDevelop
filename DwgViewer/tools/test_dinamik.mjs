/*
 * v7.72 — dinamik blok: blocks.js saf işlevleri (Node'da doğrudan: hizalama matrisi, ayrışım / ters, evalDyn — doğrusal
 * taşı / esnet, döndür, çevir, nokta, görünürlük —, tutamak konumları, tutamaktan değer, kırpma, çokgen içi, genişletme,
 * öznitelikler, benimseme, iç içe derinlik koruması) + tarayıcıda blok düzenleyici akışı: BPARAMETER aracı (doğrusal +
 * görünürlük), BVSTATE, kaydet → tutamaklar, runDyn (değer / durum), Özellikler paletinde parametre alanları, geri alma,
 * dosya yeniden açılınca dinamik değer korunur.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_dinamik.mjs [çıktı] [örnekler]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers, askLog, projectRoot } from './harness.mjs';

const { out, samples: SM } = args(import.meta.url);
const C = checker(), ok = C.ok;
const J = JSON.stringify, yak = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const B = await import(pathToFileURL(path.join(projectRoot, 'app/src/main/assets/viewer/blocks.js')).href);

// ---------------------------------------------------------------------------------
// A · saf işlevler (Node)
// ---------------------------------------------------------------------------------
{
  const m1 = B.alignMatrix([[[0, 0], [10, 20]]]);
  ok('A1 tek çift: yalnız öteleme', J(m1) === J([1, 0, 0, 1, 10, 20]), J(m1));
  const m2 = B.alignMatrix([[[0, 0], [100, 0]], [[10, 0], [100, 10]]]);
  const p2 = [m2[0] * 10 + m2[2] * 0 + m2[4], m2[1] * 10 + m2[3] * 0 + m2[5]];
  ok('A2 iki çift ölçeksiz: 90° döner, 2. kaynak 2. hedefe gider (aralık eşit)', yak(p2[0], 100) && yak(p2[1], 10) && yak(Math.hypot(m2[0], m2[1]), 1), J([m2, p2]));
  const m3 = B.alignMatrix([[[0, 0], [0, 0]], [[10, 0], [0, 30]]], true);
  const p3 = [m3[0] * 10 + m3[4], m3[1] * 10 + m3[5]];
  ok('A3 ölçekli: hedef aralığı / kaynak aralığı = 3 → 2. kaynak tam 2. hedefe', yak(p3[0], 0) && yak(p3[1], 30) && yak(Math.hypot(m3[0], m3[1]), 3), J([m3, p3]));
  ok('A4 çakışık kaynak → null; boş → null', B.alignMatrix([[[1, 1], [2, 2]], [[1, 1], [5, 5]]]) === null && B.alignMatrix([]) === null, '');
  const ins = { x: 10, y: 20, rot: Math.PI / 3, sx: 2, sy: -1.5 };
  const d = B.decompose(B.insMatrix(ins));
  ok('A5 matris ayrışımı yansımalı ölçeği geri verir (x, y, rot, sx, sy)', yak(d.x, 10) && yak(d.y, 20) && yak(d.rot, Math.PI / 3) && yak(d.sx, 2) && yak(d.sy, -1.5), J(d));
  const m = B.insMatrix(ins), inv = B.invert(m), id = [m[0] * inv[0] + m[2] * inv[1], m[1] * inv[0] + m[3] * inv[1], m[0] * inv[2] + m[2] * inv[3], m[1] * inv[2] + m[3] * inv[3], m[0] * inv[4] + m[2] * inv[5] + m[4], m[1] * inv[4] + m[3] * inv[5] + m[5]];
  ok('A6 ters matris: m · m⁻¹ = birim', id.every((v, i) => yak(v, [1, 0, 0, 1, 0, 0][i])), J(id));
  ok('A7 tekil matris ters çevrilemez → null', B.invert([0, 0, 0, 0, 1, 1]) === null, '');

  const def = () => ({
    name: 'D', base: [0, 0, 0],
    ents: [
      { type: 'LINE', id: 'l', layer: '0', color: 256, pts: [[0, 0, 0], [100, 0, 0]] },
      { type: 'CIRCLE', id: 'c', layer: '0', color: 256, pts: [[50, 30, 0]], r: 10, vis: ['A'] },
      { type: 'TEXT', id: 't', layer: '0', color: 256, pts: [[0, 50, 0]], text: 'AD', h: 5, vis: ['B'] },
    ],
    dyn: { params: [] },
  });
  const seg = (e) => (e.type === 'PATH' ? [e.ops[0][1], e.ops[0][2], e.ops[1][1], e.ops[1][2]] : e.type === 'LINE' ? [e.pts[0][0], e.pts[0][1], e.pts[1][0], e.pts[1][1]] : null);
  const mrk = (e) => (e.type === 'CIRCLE' ? [e.pts[0][0], e.pts[0][1]] : e.type === 'PATH' && e.ops[1] && Math.abs(e.ops[1][0]) === 2 ? [e.ops[1][1], e.ops[1][2]] : null);   // daire merkezi
  const D1 = def(); D1.dyn.params = [{ id: 'p1', kind: 'linear', label: 'Boy', base: [0, 0], end: [100, 0], mode: 'move', def: 100, ents: [0] }];
  const e1 = B.evalDyn(D1, { p1: 150 });
  ok('A8 doğrusal TAŞI: değer 150 → çizgi +50 kayar (iki uç), daire yerinde', J(seg(e1[0])) === J([50, 0, 150, 0]) && e1[1].pts[0][0] === 50, J([seg(e1[0]), e1[1].pts]));
  const D2 = def(); D2.dyn.params = [{ id: 'p1', kind: 'linear', label: 'Boy', base: [0, 0], end: [100, 0], mode: 'stretch', frame: [90, -10, 110, 10], def: 100, ents: [0] }];
  const e2 = B.evalDyn(D2, { p1: 160 });
  ok('A9 doğrusal ESNET: çerçevedeki uç +60 kayar, öteki uç sabit', J(seg(e2[0])) === J([0, 0, 160, 0]), J(seg(e2[0])));
  ok('A10 öntanımlı değerde varlıklar aynen (kopya, özgün nesne değişmez)', J(seg(B.evalDyn(D2, {})[0])) === J([0, 0, 100, 0]) && J(seg(B.evalDyn(D2, null)[0])) === J([0, 0, 100, 0]) && D2.ents[0].pts[1][0] === 100, '');
  const D3 = def(); D3.dyn.params = [{ id: 'p1', kind: 'rot', label: 'Açı', base: [0, 0], r: 60, def: 0, ents: null }];
  const e3 = B.evalDyn(D3, { p1: 90 });
  const s3 = seg(e3[0]);
  ok('A11 DÖNDÜR 90°: çizgi (0,0)→(0,100), daire merkezi (−30, 50) (hepsi etkilenir); daire DAİRE kalır (benzerlik dönüşümü)', yak(s3[2], 0, 1e-9) && yak(s3[3], 100, 1e-9) && e3[1].type === 'CIRCLE' && yak(mrk(e3[1])[0], -30, 1e-9) && yak(mrk(e3[1])[1], 50, 1e-9) && yak(e3[1].r, 10), J([s3, e3[1]]));
  const D4 = def(); D4.dyn.params = [{ id: 'p1', kind: 'flip', label: 'Çevir', a: [50, 0], b: [50, 100], def: false, ents: [0, 1] }];
  const e4 = B.evalDyn(D4, { p1: true });
  const s4 = seg(e4[0]);
  ok('A12 ÇEVİR (x=50 ekseni): çizgi (100,0)→(0,0), daire merkezi aynı (eksende, daire kalır); yazı (ents dışı) yerinde', yak(s4[0], 100) && yak(s4[2], 0) && e4[1].type === 'CIRCLE' && yak(mrk(e4[1])[0], 50) && yak(mrk(e4[1])[1], 30) && e4[2].pts[0][0] === 0, J([s4, mrk(e4[1]), e4[2].pts]));
  const D5 = def(); D5.dyn.params = [{ id: 'p1', kind: 'point', label: 'Konum', base: [50, 30], def: [0, 0], ents: [1] }];
  const e5 = B.evalDyn(D5, { p1: [10, -5] });
  ok('A13 NOKTA: daire (10, −5) ötelendi, çizgi yerinde', yak(mrk(e5[1])[0], 60) && yak(mrk(e5[1])[1], 25) && J(seg(e5[0])) === J([0, 0, 100, 0]), J(mrk(e5[1])));
  const ne = B.xformEnts([def().ents[1]], [2, 0, 0, 1, 0, 0]);
  const sm = B.xformEnts([def().ents[1], { type: 'ARC', id: 'a', layer: '0', color: 256, pts: [[0, 0, 0]], r: 10, a0: 0, a1: Math.PI / 2 }], [0, 2, -2, 0, 5, 5]);
  ok('A13b xformEnts: eşit olmayan ölçekte daire YOL olur; 2 kat + 90° benzerlikte daire (r 20) ve yay (açılar +90°) tür korur', ne[0].type === 'PATH' && sm[0].type === 'CIRCLE' && yak(sm[0].r, 20) && sm[1].type === 'ARC' && yak(sm[1].r, 20) && yak(sm[1].a0, Math.PI / 2) && yak(sm[1].a1, Math.PI) && yak(sm[1].pts[0][0], 5) && yak(sm[1].pts[0][1], 5), J([ne[0].type, sm.map(e => [e.type, e.r, e.a0, e.a1])]));
  const D6 = def(); D6.dyn.params = [{ id: 'vis', kind: 'vis', label: 'Görünüm', states: ['A', 'B'], def: 'A' }];
  const vA = B.evalDyn(D6, {}).map(e => e.id), vB = B.evalDyn(D6, { vis: 'B' }).map(e => e.id);
  ok('A14 GÖRÜNÜRLÜK: A durumunda çizgi + daire, B durumunda çizgi + yazı (vis listesi olmayan hep görünür)', J(vA) === J(['l', 'c']) && J(vB) === J(['l', 't']), J([vA, vB]));
  const D7 = def(); D7.dyn.params = [{ id: 'p1', kind: 'linear', label: 'Boy', base: [0, 0], end: [100, 0], mode: 'move', def: 100, ents: [0] }, { id: 'vis', kind: 'vis', label: 'G', states: ['A', 'B'], def: 'A' }];
  const e7 = B.evalDyn(D7, { p1: 120, vis: 'B' });
  ok('A15 süzme EN SONDA: doğrusal parametre asıl indislere göre uygulanır, sonra görünürlük süzer', e7.length === 2 && J(seg(e7[0])) === J([20, 0, 120, 0]) && e7[1].id === 't', J(e7.map(e => e.id)));

  const T = [1, 0, 0, 1, 1000, 2000];
  const g = B.dynGrips(D7, { p1: 120 }, T);
  ok('A16 tutamaklar dünya koordinatında: doğrusal tutamak taban + 120·yön (1120, 2000), yön (1,0); görünürlük tutamağı tabanda', g.length === 2 && g[0].kind === 'linear' && yak(g[0].x, 1120) && yak(g[0].y, 2000) && yak(g[0].ux, 1) && yak(g[0].uy, 0) && g[0].value === 120 && g[1].kind === 'vis' && yak(g[1].x, 1000) && g[1].value === 'A', J(g));
  const R = B.insMatrix({ x: 0, y: 0, rot: Math.PI / 2, sx: 1, sy: 1 });
  const gR = B.dynGrips(D3, { p1: 45 }, R);
  ok('A17 90° dönmüş yerleştirmede döndürme tutamağı: 45° → tanımda (42.4, 42.4) → dünyada (−42.4, 42.4); merkez (0,0)', yak(gR[0].x, -60 * Math.SQRT1_2, 1e-9) && yak(gR[0].y, 60 * Math.SQRT1_2, 1e-9) && yak(gR[0].cx, 0) && yak(gR[0].cy, 0), J(gR));
  ok('A18 tutamaktan değer: doğrusal (dünya (1150, 2000) → 150), döndürme (90° yerleştirmede dünya (0, 10) → tanımda (10, 0) → 0°; dünya (0, −10) → 180°), nokta; görünürlük sürüklenmez (null)', B.dynValueAt(D7, D7.dyn.params[0], [1150, 2000], T) === 150 && B.dynValueAt(D3, D3.dyn.params[0], [0, 10], R) === 0 && B.dynValueAt(D3, D3.dyn.params[0], [0, -10], R) === 180 && J(B.dynValueAt(D5, D5.dyn.params[0], [1060, 2025], T)) === J([10, -5]) && B.dynValueAt(D6, D6.dyn.params[0], [0, 0], T) === null, J([B.dynValueAt(D7, D7.dyn.params[0], [1150, 2000], T), B.dynValueAt(D3, D3.dyn.params[0], [0, 10], R), B.dynValueAt(D3, D3.dyn.params[0], [0, -10], R)]));
  ok('A19 doğrusal değer eksiye düşmez (tabanın gerisinde 0)', B.dynValueAt(D7, D7.dyn.params[0], [900, 2000], T) === 0, '');

  // stretchEnts: yerleştirme ve yazı çerçevedeyse taşınır, dışarıdaysa kalmaz
  const se = B.stretchEnts([{ type: 'INSERT', id: 'i', name: 'X', x: 5, y: 5, rot: 0, sx: 1, sy: 1, layer: '0', color: 256 }, { type: 'TEXT', id: 't', pts: [[50, 50, 0]], text: 'A', h: 2, layer: '0', color: 256 }], [0, 0, 10, 10], 3, 4);
  ok('A20 stretchEnts: çerçevedeki yerleştirme (+3, +4) taşındı (matris de), dışarıdaki yazı yerinde', yak(se[0].x, 8) && yak(se[0].y, 9) && yak(se[0].m[4], 8) && se[1].pts[0][0] === 50, J(se));

  // kırpma: çizgi Liang–Barsky, dolgu Sutherland–Hodgman, yazı konumu
  const line = { k: 0, ops: [[0, -50, 5, 0], [1, 150, 5, 0]], bb: [-50, 5, 150, 5], closed: false };
  const fill = { k: 0, fill: true, ops: [[0, -20, -20, 0], [1, 60, -20, 0], [1, 60, 60, 0], [1, -20, 60, 0]], bb: [-20, -20, 60, 60], closed: true };
  const txtIn = { k: 1, x: 10, y: 10, bb: [10, 10, 30, 12], lines: ['a'] }, txtOut = { k: 1, x: 150, y: 10, bb: [150, 10, 180, 12], lines: ['b'] }, txtEdge = { k: 1, x: 95, y: 10, bb: [95, 10, 130, 12], lines: ['c'] };
  const cl = B.clipPrims([line, fill, txtIn, txtOut, txtEdge, { k: 0, ops: [[0, 500, 500, 0], [1, 600, 600, 0]], bb: [500, 500, 600, 600] }], [0, 0, 100, 100]);
  ok('A21 kırpma: çizgi (0,5)→(100,5), dolgu kutuya (0,0)-(60,60), içerideki yazı kalır, kutudan taşan ama konumu içeride olan yazı kalır, dışarıdaki yazı ve uzak çizgi atılır', cl.length === 4 && J(cl[0].ops.map(o => o.slice(1, 3))) === J([[0, 5], [100, 5]]) && cl[1].fill && cl[1].ops.length === 4 && yak(cl[1].bb[0], 0) && yak(cl[1].bb[2], 60) && cl[2] === txtIn && cl[3] === txtEdge, J(cl.map(p => p.ops || p.lines)));
  ok('A22 kırpma köşeleri ters verilse de aynı (x2 < x1)', B.clipPrims([line], [100, 100, 0, 0])[0].ops[1][1] === 100, '');
  const ip = B.insidePoly([txtIn, txtOut, line], [[0, 0], [50, 0], [50, 50], [0, 50]]);
  ok('A23 çokgen içi: yazı (10,10) içeride, (90,10) dışarıda, çokgeni kesen çizgi içeride sayılır', ip.length === 2 && ip[0] === txtIn && ip[1] === line, J(ip.map(p => p.lines || 'line')));

  // genişletme: tek info, işaret, öznitelik, görünmez öznitelik, katman 0 → yerleştirme katmanı
  const blocks = new Map();
  const ET = { name: 'ET', base: [10, 0, 0], ents: [
    { type: 'LINE', id: 'a', layer: '0', color: 0, pts: [[10, 0, 0], [110, 0, 0]] },
    { type: 'ATTDEF', id: 'b', layer: 'YAZI', color: 256, pts: [[20, 5, 0]], tag: 'NO', prompt: 'Numara', text: '1', h: 4, flags: 0 },
    { type: 'ATTDEF', id: 'c', layer: '0', color: 256, pts: [[20, 15, 0]], tag: 'GIZLI', prompt: '', text: 'x', h: 4, flags: 1 },
  ], dyn: null };
  blocks.set('ET', ET);
  const insE = { type: 'INSERT', id: 'I1', name: 'ET', layer: 'KAPAK', color: 3, x: 500, y: 500, z: 0, rot: 0, sx: 1, sy: 1, attrs: [['NO', '42']] };
  const px = B.expandInsert(insE, blocks, new Map());
  const mark = px.find(p => p.k === 4), geo = px.filter(p => p.k !== 4);
  ok('A24 genişletme: işaret + çizgi + görünür öznitelik (görünmez atlandı); hepsi aynı info, anahtar I1#…', mark && mark.key === 'I1#ins' && geo.length === 2 && px.every(p => p.info === px[0].info) && px[0].info.t === 'INSERT' && px[0].info.h === 'I1' && geo.every(p => /^I1#\d+$/.test(p.key)), J(px.map(p => [p.key, p.k, p.et, p.lay])));
  const ln = geo.find(p => p.k === 0), at = geo.find(p => p.k === 1);
  ok('A25 taban (10,0) düşülür: çizgi (500,500)→(600,500); katman 0 → KAPAK; ATTRIB yazısı "42" (ai 0), katmanı YAZI', ln && yak(ln.ops[0][1], 500) && yak(ln.ops[1][1], 600) && ln.lay === 'KAPAK' && at && at.lines.join('') === '42' && at.ai === 0 && at.et === 'ATTRIB' && at.lay === 'YAZI' && yak(at.x, 510) && yak(at.y, 505), J([ln && ln.ops, at && [at.lines, at.ai, at.lay, at.x, at.y]]));
  ok('A26 attrsFor: tanım etiketleri sırayla, verilen değer etikete göre (büyük/küçük harf), verilmeyen öntanımlı', J(B.attrsFor(ET, [['no', '7']])) === J([['NO', '7'], ['GIZLI', 'x']]) && J(B.attrsFor(ET, null)) === J([['NO', '1'], ['GIZLI', 'x']]), J(B.attrsFor(ET, [['no', '7']])));
  const bb = B.defBBox(ET);
  ok('A27 tanım sınır kutusu çizgiyi ve öznitelikleri kapsar', bb && bb[0] <= 10 && bb[2] >= 110, J(bb));
  // iç içe: kendini ekleyen blok sonsuz döngüye girmez
  const SELF = { name: 'S', base: [0, 0, 0], ents: [{ type: 'LINE', id: 'q', layer: '0', color: 256, pts: [[0, 0, 0], [1, 0, 0]] }, { type: 'INSERT', id: 'r', name: 'S', layer: '0', color: 256, x: 2, y: 0, z: 0, rot: 0, sx: 1, sy: 1 }], dyn: null };
  blocks.set('S', SELF);
  const ps = B.expandInsert({ type: 'INSERT', id: 'I2', name: 'S', layer: '0', color: 256, x: 0, y: 0, z: 0, rot: 0, sx: 1, sy: 1 }, blocks, new Map());
  ok('A28 kendini ekleyen tanım MAX_DEPTH\'te durur (sonlu ilkel, tek info)', ps.length > 2 && ps.length <= B.MAX_DEPTH + 3 && ps.every(p => p.info === ps[0].info), String(ps.length));
  // benimseme: DWG'den gelen düzleştirilmiş yerleştirme → tanım (taban 0, matris tersiyle)
  const inf = { t: 'INSERT', h: 'H9', name: 'K', x: 100, y: 50, rot: 0, sx: 2, sy: 2, m: [2, 0, 0, 2, 100, 50] };
  const ad = B.adoptFromPrims('K', [{ k: 0, ops: [[0, 100, 50, 0], [1, 300, 50, 0]], bb: [100, 50, 300, 50], lay: 'A', info: inf }]);
  ok('A29 benimseme: tanım uzayı = matrisin tersi (çizgi (0,0)→(100,0)), taban 0', ad && ad.base[0] === 0 && ad.ents.length === 1 && yak(ad.ents[0].ops[0][1], 0) && yak(ad.ents[0].ops[1][1], 100), J(ad));
  const w = B.withMatrix({ type: 'INSERT', z: 0 }, B.insMatrix({ x: 1, y: 2, rot: 0.3, sx: 1.5, sy: 1.5 }), 4);
  ok('A30 withMatrix: x, y, rot, sx, sy türetilir, m taşınır, z += dz', yak(w.x, 1) && yak(w.rot, 0.3) && yak(w.sx, 1.5) && w.z === 4 && Array.isArray(w.m), J(w));
}

// ---------------------------------------------------------------------------------
// B · tarayıcı: blok düzenleyicide parametre ekleme, görünürlük durumu, kaydet, tutamaklar, runDyn, Özellikler, geri alma, yeniden açma
// ---------------------------------------------------------------------------------
const srv = await startServer();
const browser = await launchBrowser();
const errors = [];
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);

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
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(250); };
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, step: T.step, selecting: T.selecting, text: document.getElementById('cmdText').textContent.trim(), sel: window.dwgApp.editor.sel.size }; });
const grup = (h) => ev((hh) => window.dwgApp.state.prims.filter(p => p.info && p.info.h === hh).map(p => ({ key: p.key, k: p.k, et: p.et, ops: p.ops ? p.ops.map(o => o.slice(0, 3)) : null, x: p.x, y: p.y, dyn: p.info.dyn })), h);
const secKeys = (keys) => ev((ks) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (ks.includes(p.key)) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, keys);
const secH = (h) => ev((hh) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (p.k !== 4 && p.info && p.info.h === hh) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, h);
const bosNokta = () => ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });
const runCmd = (cmd) => ev((c) => window.dwgApp.editor.runCmd(c), cmd);
const undo = async () => { await ev(() => { window.dwgApp.editor.act('undo'); }); await bekle(150); };
const bitir = async () => { await page.click('#cmdBtns [data-cmd="finish"]'); await bekle(300); };
const tanim = (name) => ev((n) => { const d = window.dwgApp.state.blocks.get(n); return d ? { n: d.ents.length, params: d.dyn ? d.dyn.params.map(p => ({ id: p.id, kind: p.kind, label: p.label, ents: p.ents, def: p.def, mode: p.mode, states: p.states })) : [], vis: d.ents.map(e => e.vis || null) } : null; }, name);

await page.click('#toolbar [data-tab="edit"]');
const [X0, Y0] = await bosNokta();
await zoom([X0 - 50, Y0 - 50, X0 + 650, Y0 + 400]);

{
  // tanım ve yerleştirme doğrudan komutla (taban X0, Y0; çizgi 100, daire)
  const okDef = await runCmd({ op: 'blockdef', name: 'KAPI', def: { name: 'KAPI', base: [X0, Y0, 0], ents: [
    { type: 'LINE', id: 'dl', layer: '0', color: 256, pts: [[X0, Y0, 0], [X0 + 100, Y0, 0]] },
    { type: 'CIRCLE', id: 'dc', layer: '0', color: 256, pts: [[X0 + 50, Y0 + 40, 0]], r: 15 },
  ], dyn: null } });
  const okIns = await runCmd({ op: 'add', ents: [{ type: 'INSERT', id: 'I1', name: 'KAPI', layer: '0', color: 256, x: X0 + 300, y: Y0, z: 0, rot: 0, sx: 1, sy: 1 }] });
  const g0 = await grup('I1');
  ok('B1 tanım + yerleştirme: 2 geometri + işaret; dinamik tutamak yok (parametre yok)', okDef && okIns && g0.length === 3 && (await ev(() => window.dwgApp.editor.dynGrips().length)) === 0, J(g0.map(p => [p.key, p.k])));
  // BPARAMETER ana belgede: form açılmadan "yalnız blok düzenleyicide" uyarısı (seçim hazır → hemen), BVSTATE de
  await secH('I1');
  await arac('t:bparam');
  ok('B2 ana belgede BPARAMETER: "yalnız blok düzenleyicide" uyarısı, araç kapandı, form sorulmadı', /düzenleyici|editor/i.test(await toast()) && !(await durum()).active && !(await askLog(page)).some(l => l.type === 'form'), J([await toast(), await durum(), await askLog(page)]));
  await secH('I1');
  await arac('t:bvstate');
  ok('B2b ana belgede BVSTATE: aynı uyarı', /düzenleyici|editor/i.test(await toast()) && !(await durum()).active, await toast());
  await iptal();
  // oturum
  const okB = await ev(() => window.dwgApp.editor.beditStart('KAPI', {}));
  await bekle(300);
  const keys0 = await ev(() => window.dwgApp.state.prims.map(p => p.key));
  ok('B3 BEDIT açıldı: B0 (çizgi), B1 (daire)', okB && keys0.join(',') === 'B0,B1', J(keys0));
  await zoom([X0 - 30, Y0 - 30, X0 + 130, Y0 + 80]);
  // doğrusal parametre (taşı): yalnız çizgi; taban (X0, Y0), uç (X0+100, Y0)
  await secKeys(['B0']);
  await queueAnswers(page, { kind: 'linear', label: 'Boy', mode: 'move', states: '' });
  await arac('t:bparam');
  const d1 = await durum();
  ok('B4 seçim hazır → form cevaplandı → parametre noktası istenir (adım 1)', d1.active === 'bparam' && d1.step === 1 && !d1.selecting, J(d1));
  await tapWorld(X0, Y0);
  const d2 = await ev(() => ({ n: window.dwgApp.editor.tools.prm ? window.dwgApp.editor.tools.prm.pts.length : -1, draft: !!window.dwgApp.editor.tools.draft }));
  ok('B5 taban alındı, uç bekleniyor (taslak çizgi)', d2.n === 1 && d2.draft, J(d2));
  await tapWorld(X0 + 100, Y0);
  const st = await ev(() => window.dwgApp.editor.bedit());
  ok('B6 uç alındı → parametre eklendi (Boy, oturumda 1 parametre), ileti, araç kapandı', st && st.params === 1 && /Boy/.test(await toast()) && !(await durum()).active, J([st, await toast()]));
  // görünürlük parametresi: seçim boş, Bitir geçer (bparam'da boş seçim = hepsi)
  await iptal();
  await queueAnswers(page, { kind: 'vis', label: 'Görünüm', mode: 'move', states: 'Kapalı; Açık' });
  await arac('t:bparam');
  await bitir();
  await bekle(300);
  ok('B7 görünürlük parametresi: nokta istemeden eklendi (2 parametre)', (await ev(() => window.dwgApp.editor.bedit())).params === 2 && !(await durum()).active, J(await ev(() => window.dwgApp.editor.bedit())));
  // parametre listesi kutusu: bar düğmesi → iki satır, sil düğmesi
  await page.click('#beditBar [data-bb="params"]'); await bekle(250);
  const rows = await ev(() => [...document.querySelectorAll('#docBody .blk-row')].map(r => r.querySelector('b').textContent));
  ok('B8 Parametreler kutusu: Boy ve Görünüm satırları', rows.join(',') === 'Boy,Görünüm', J(rows));
  await ev(() => { document.getElementById('docPanel').hidden = true; });
  // BVSTATE: daire yalnız "Açık" durumunda
  await secKeys(['B1']);
  await queueAnswers(page, { state: 'Açık' });
  await arac('t:bvstate');
  await bekle(300);
  const vis = await ev(() => window.dwgApp.state.prims.map(p => p.vis || null));
  ok('B9 BVSTATE: daire.vis = [Açık], çizgi hep görünür; ileti "1 nesne"', J(vis) === J([null, ['Açık']]) && /1/.test(await toast()), J([vis, await toast()]));
  await shot('dinamik_bedit');
  // kaydet
  await ev(() => window.dwgApp.editor.beditSave());
  await bekle(400);
  const T1 = await tanim('KAPI');
  ok('B10 kaydet: tanımda 2 parametre (doğrusal ents [0], görünürlük Kapalı/Açık), dairenin vis listesi', T1 && T1.params.length === 2 && T1.params[0].kind === 'linear' && J(T1.params[0].ents) === J([0]) && yak(T1.params[0].def, 100, 1e-3) && T1.params[1].kind === 'vis' && J(T1.params[1].states) === J(['Kapalı', 'Açık']) && J(T1.vis) === J([null, ['Açık']]), J(T1));
  const g1 = await grup('I1');
  ok('B11 yerleştirme yeniden genişledi: öntanımlı durum "Kapalı" → daire gizli (çizgi + işaret)', g1.length === 2 && g1.some(p => p.k === 4) && g1.some(p => p.k === 0), J(g1.map(p => [p.key, p.k])));
  await zoom([X0 + 250, Y0 - 50, X0 + 500, Y0 + 100]);
  await secH('I1');
  const gr = await ev(() => window.dwgApp.editor.dynGrips());
  ok('B12 seçilince dinamik tutamaklar: doğrusal (Boy = 100) + görünürlük (Kapalı)', gr.length === 2 && gr[0].kind === 'linear' && yak(gr[0].value, 100, 1e-3) && gr[1].kind === 'vis' && gr[1].value === 'Kapalı', J(gr));
  await shot('dinamik_grips');
  // değer değiştir (tutamak sürüklemesinin komutu)
  const r1 = await ev(() => window.dwgApp.editor.runDyn('I1', { p1: 150 }));
  const g2 = await grup('I1');
  const ln2 = g2.find(p => p.k === 0);
  ok('B13 runDyn Boy=150: çizgi +50 kaydı (X0+350 → X0+450), info.dyn.p1 = 150, seçim yerleştirmede kaldı', r1 && ln2 && yak(ln2.ops[0][1], X0 + 350, 1e-3) && yak(ln2.ops[1][1], X0 + 450, 1e-3) && ln2.dyn && ln2.dyn.p1 === 150 && (await durum()).sel === 1, J([ln2 && ln2.ops, ln2 && ln2.dyn]));
  const r2 = await ev(() => window.dwgApp.editor.runDyn('I1', { vis: 'Açık' }));
  const g3 = await grup('I1');
  ok('B14 runDyn Görünüm=Açık: daire göründü (2 geometri + işaret), Boy 150 korunur', r2 && g3.filter(p => p.k !== 4).length === 2 && g3[0].dyn.p1 === 150 && g3[0].dyn.vis === 'Açık', J(g3.map(p => [p.key, p.k, p.dyn])));
  const gr2 = await ev(() => window.dwgApp.editor.dynGrips());
  ok('B15 tutamaklar güncel: Boy 150 (taban + 150), Görünüm Açık', gr2[0].value === 150 && gr2[1].value === 'Açık', J(gr2));
  await undo();
  ok('B16 geri alma: daire yine gizli', (await grup('I1')).filter(p => p.k !== 4).length === 1, '');
  await undo();
  ok('B17 ikinci geri alma: Boy 100', yak((await grup('I1')).find(p => p.k === 0).ops[1][1], X0 + 400, 1e-3), '');
  // Özellikler paleti: dyn alanları
  await secH('I1');
  await arac('props');
  const f = await ev(() => [...document.querySelectorAll('#docBody [data-pg]')].map(e => [e.dataset.pg, e.tagName, e.value]));
  ok('B18 Özellikler: "dyn:p1" sayı alanı (100) ve "dyn:vis" seçim kutusu (Kapalı)', f.some(x => x[0] === 'dyn:p1' && Math.abs(parseFloat(x[2]) - 100) < 1e-3) && f.some(x => x[0] === 'dyn:vis' && x[1] === 'SELECT' && x[2] === 'Kapalı'), J(f));
  await ev(() => { document.querySelector('#docBody [data-pg="dyn:p1"]').value = '120'; document.querySelector('#docBody [data-pg="dyn:vis"]').value = 'Açık'; document.getElementById('pOk').click(); });
  await bekle(300);
  const g4 = await grup('I1');
  ok('B19 paletten Boy=120 ve Görünüm=Açık tek adımda uygulandı', g4.filter(p => p.k !== 4).length === 2 && g4[0].dyn.p1 === 120 && g4[0].dyn.vis === 'Açık', J(g4.map(p => [p.key, p.dyn])));
  await undo();
  ok('B20 tek geri alma ikisini birden alır', (await grup('I1')).filter(p => p.k !== 4).length === 1 && !((await grup('I1'))[0].dyn && (await grup('I1'))[0].dyn.p1), '');
  await ev(() => window.dwgApp.editor.runDyn('I1', { p1: 130, vis: 'Açık' }));
  // dosya yeniden açılınca: tanım + parametreler + son değer
  await openFile(page, `${SM}/example_2000.dwg`, { settle: 600 });
  const T2 = await tanim('KAPI');
  const g5 = await grup('I1');
  ok('B21 yeniden açılınca günlük oynar: 2 parametreli tanım, yerleştirme Boy 130 + daire görünür', T2 && T2.params.length === 2 && g5.filter(p => p.k !== 4).length === 2 && g5[0].dyn && g5[0].dyn.p1 === 130 && yak(g5.find(p => p.k === 0).ops[1][1], X0 + 430, 1e-3), J([T2 && T2.params.length, g5.map(p => [p.key, p.k, p.dyn])]));
  // DXF: tanım BLOCKS'ta, yerleştirme INSERT; dinamik değer uygulanmış geometri yazılmaz (INSERT tanıma başvurur)
  const dxf = await ev(() => { const r = window.dwgApp.editor.dxfBase64(false); return r ? decodeURIComponent(escape(atob(r.b64))) : ''; });
  ok('B22 DXF: KAPI tanımı ve INSERT yazıldı', /\n2\r\nKAPI\r\n/.test(dxf) && /\n0\r\nINSERT\r\n[\s\S]*?\n2\r\nKAPI\r\n/.test(dxf), String(dxf.length));
}

await browser.close();
await srv.kill();
C.summary(errors);
C.exit();
