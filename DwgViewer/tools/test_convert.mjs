// Dönüştürücüler (v7.29): OBJ/STL dışa aktarma, tablo çıkarma, 3B geometrik ölçüm ve PDF→CAD.
// PDF örneği sınama içinde pdf-lib ile ÜRETİLİR: içine ne koyduğumuzu bildiğimiz için çıktı
// birebir sınanabilir (üç çizgi + bir dikdörtgen → aynı sayıda ve aynı yerde nesne).
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_convert.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
await page.evaluate(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });

// ---- 1. OBJ / STL ---------------------------------------------------------------------------------
const ex = await page.evaluate(async () => {
  const E = await import('./export3d.js');
  const G = await import('./geom.js');
  const m = G.extrudeMesh([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], 5, true, true);
  const prim = { k: 5, vtx: m.vtx, idx: m.idx, seg: m.seg, bb: m.bb, zmin: m.zmin, zmax: m.zmax, lay: 'KAT1', face: true, info: { t: 'MESH' }, et: 'MESH' };
  const face = { k: 0, face: true, closed: true, lay: 'KAT2', ops: [[0, 0, 0, 0], [1, 1, 0, 0], [1, 0, 1, 0]], bb: [0, 0, 1, 1], info: { t: '3DFACE' }, et: '3DFACE' };
  const st = E.meshStats([prim, face]);
  const obj = E.objText([prim, face], { name: 'sinama', byLayer: true });
  const stl = E.stlBinary([prim, face], { name: 'sinama' });
  const stla = E.stlText([prim, face], {});
  const dv = stl ? new DataView(stl.buffer, stl.byteOffset, stl.byteLength) : null;
  return {
    bodies: st.bodies, tris: st.tris, verts: st.verts,
    v: (obj.match(/^v /gm) || []).length, f: (obj.match(/^f /gm) || []).length, g: (obj.match(/^g /gm) || []).length,
    stlLen: stl ? stl.length : -1, stlTri: dv ? dv.getUint32(80, true) : -1,
    solid: /^solid/.test(stla), endsolid: /endsolid/.test(stla),
    facets: (stla.match(/facet normal/g) || []).length,
    tooBig: E.objText([prim], { maxTris: 3 }),
    none: E.objText([{ k: 1, lines: ['x'] }], {}),
  };
});
ok('1a iki gövde sayıldı', ex.bodies === 2, String(ex.bodies));
ok('1b 13 üçgen (12 ağ + 1 yüz)', ex.tris === 13, String(ex.tris));
ok('1c OBJ f satırı üçgen sayısıyla aynı', ex.f === 13, String(ex.f));
ok('1d OBJ v satırı köşe sayısıyla aynı', ex.v === ex.verts, `${ex.v} / ${ex.verts}`);
ok('1e katmana göre iki grup', ex.g === 2, String(ex.g));
ok('1f ikili STL boyu 84 + 50×üçgen', ex.stlLen === 84 + 50 * 13, String(ex.stlLen));
ok('1g STL başlığındaki üçgen sayısı doğru', ex.stlTri === 13, String(ex.stlTri));
ok('1h ASCII STL solid/endsolid ile sarılı', ex.solid === true && ex.endsolid === true);
ok('1i ASCII STL yüz sayısı 13', ex.facets === 13, String(ex.facets));
ok('1j üçgen sınırı aşılınca null', ex.tooBig === null, String(ex.tooBig));
ok('1k 3B gövde yoksa null', ex.none === null, String(ex.none));

// ---- 2. Tablo çıkarma ------------------------------------------------------------------------------
const tb = await page.evaluate(async () => {
  const T = await import('./tablex.js');
  // 3 satır × 2 sütunluk ızgara: yatay çizgiler y=0,10,20,30 · düşey çizgiler x=0,50,100
  const seg = (x1, y1, x2, y2) => ({ k: 0, closed: false, bb: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)], ops: [[0, x1, y1, 0], [1, x2, y2, 0]], lay: '0', info: { t: 'LINE' }, et: 'LINE' });
  const txt = (x, y, s) => ({ k: 1, x, y, z: 0, h: 3, rot: 0, lines: [s], bb: [x - 1, y - 1, x + 1, y + 1], lay: '0', info: { t: 'TEXT' }, et: 'TEXT' });
  const prims = [];
  for (const y of [0, 10, 20, 30]) prims.push(seg(0, y, 100, y));
  for (const x of [0, 50, 100]) prims.push(seg(x, 0, x, 30));
  prims.push(txt(10, 25, 'Poz'), txt(60, 25, 'Miktar'));
  prims.push(txt(10, 15, 'Kazı'), txt(60, 15, '120'));
  prims.push(txt(10, 5, 'Dolgu'), txt(60, 5, '85'));
  const r = T.extractTable(prims, [-5, -5, 105, 35], {});
  const csv = r ? T.tableCsv(r.rows, ';') : '';
  const none = T.extractTable([txt(0, 0, 'a')], [-5, -5, 5, 5], {});
  return { nx: r ? r.nx : -1, ny: r ? r.ny : -1, rows: r ? r.rows : null, csv, none };
});
ok('2a ızgara 3 satır × 2 sütun', tb.ny === 3 && tb.nx === 2, `${tb.ny}×${tb.nx}`);
ok('2b ilk satır başlık', tb.rows && tb.rows[0].join('|') === 'Poz|Miktar', JSON.stringify(tb.rows && tb.rows[0]));
ok('2c ikinci satır Kazı 120', tb.rows && tb.rows[1].join('|') === 'Kazı|120', JSON.stringify(tb.rows && tb.rows[1]));
ok('2d üçüncü satır Dolgu 85', tb.rows && tb.rows[2].join('|') === 'Dolgu|85', JSON.stringify(tb.rows && tb.rows[2]));
ok('2e CSV noktalı virgülle ayrılmış', tb.csv.split('\r\n')[0] === 'Poz;Miktar', JSON.stringify(tb.csv.split('\r\n')[0]));
ok('2f ızgara yoksa null', tb.none === null, String(tb.none));

// ---- 3. 3B geometrik ölçüm ---------------------------------------------------------------------------
const g3 = await page.evaluate(async () => {
  const M = await import('./measure3d.js');
  const val = (r, key) => { const row = (r.rows || []).find(x => x[0] === key); return row ? row[1] : undefined; };
  const ptline = M.compute('ptline', [[0, 5, 0], [0, 0, 0], [10, 0, 0]]);
  const ptplane = M.compute('ptplane', [[0, 0, 7], [0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  const lineline = M.compute('lineline', [[0, 0, 0], [1, 0, 0], [0, 0, 4], [0, 1, 4]]);
  const lineplane = M.compute('lineplane', [[0, 0, 5], [0, 0, -5], [0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  const planeplane = M.compute('planeplane', [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 9], [1, 0, 9], [0, 1, 9]]);
  const planeangle = M.compute('planeangle', [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const smart3 = M.compute('smartangle', [[10, 0, 0], [0, 0, 0], [0, 10, 0]]);
  const bad = M.compute('ptline', [[0, 5, 0], [0, 0, 0], [0, 0, 0]]);
  const gd = M.guides('ptline', [[0, 5, 0], [0, 0, 0], [10, 0, 0]]);
  const keys = (r) => (r ? (r.rows || []).map(x => x[0]).join(',') : '');
  return {
    needs: M.MODES.map(m => m.id + ':' + m.needs).join(' '),
    n: M.MODES.length,
    ptline: ptline ? val(ptline, 'dist3') : null, ptlineKeys: keys(ptline),
    ptplane: ptplane ? val(ptplane, 'dist3') : null,
    lineline: lineline ? val(lineline, 'dist3') : null,
    lineplane: lineplane ? val(lineplane, 'dist3') : null,
    planeplane: planeplane ? val(planeplane, 'dist3') : null,
    planeangle: planeangle ? val(planeangle, 'angle') : null,
    smart3: smart3 ? val(smart3, 'angle') : null,
    bad, guides: gd.length, step: M.stepOf('ptline', 0), need0: M.needsOf('yok'),
    kinds: ptline ? (ptline.rows || []).every(r => ['len', 'deg', 'bool', 'pt'].includes(r[2])) : false,
  };
});
ok('3a yedi ölçüm modu tanımlı', g3.n === 7, g3.needs);
ok('3b nokta-doğru uzaklığı 5', near(g3.ptline, 5, 1e-9), String(g3.ptline));
ok('3c satır anahtarları i18n anahtarı (metin değil)', /^[a-zA-Z0-9_,]+$/.test(g3.ptlineKeys), g3.ptlineKeys);
ok('3d bütün satırların birim türü tanımlı', g3.kinds === true);
ok('3e nokta-düzlem 7', near(g3.ptplane, 7, 1e-9), String(g3.ptplane));
ok('3f doğru-doğru 4', near(g3.lineline, 4, 1e-9), String(g3.lineline));
ok('3g doğru-düzlem kesişiyor (0)', near(g3.lineplane, 0, 1e-9), String(g3.lineplane));
ok('3h düzlem-düzlem 9', near(g3.planeplane, 9, 1e-9), String(g3.planeplane));
ok('3i düzlemler arası açı 90°', near(g3.planeangle, 90, 1e-6), String(g3.planeangle));
ok('3j akıllı açı (üç nokta) 90°', near(g3.smart3, 90, 1e-6), String(g3.smart3));
ok('3k dejenere girdi null', g3.bad === null, String(g3.bad));
ok('3l yardımcı çizgiler üretildi', g3.guides >= 2, String(g3.guides));
ok('3m adım anahtarı makine okunur', !!(g3.step && g3.step.part), JSON.stringify(g3.step));
ok('3n bilinmeyen mod 0 nokta ister', g3.need0 === 0, String(g3.need0));

// ---- 4. PDF → CAD ------------------------------------------------------------------------------------
const pc = await page.evaluate(async () => {
  const PE = await import('./pdfedit.js');
  const PC = await import('./pdfcad.js');
  const { PDFDocument, rgb } = await PE.loadPdfLib();
  const doc = await PDFDocument.create();
  const pg = doc.addPage([200, 100]);                       // punto
  pg.drawLine({ start: { x: 10, y: 10 }, end: { x: 110, y: 10 }, thickness: 1, color: rgb(0, 0, 0) });
  pg.drawLine({ start: { x: 10, y: 10 }, end: { x: 10, y: 60 }, thickness: 1, color: rgb(0, 0, 0) });
  pg.drawRectangle({ x: 120, y: 20, width: 40, height: 30, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  const bytes = await doc.save();
  const pages = await PC.pdfPageCount(bytes);
  const r = await PC.pdfToEnts(bytes, 0, { scale: 1, layer: 'PDF', text: false });
  const r2 = await PC.pdfToEnts(bytes, 0, { scale: 10, layer: 'PDF', text: false });
  const xs = r ? r.ents.flatMap(e => (e.pts || []).map(p => p[0])) : [];
  const xs2 = r2 ? r2.ents.flatMap(e => (e.pts || []).map(p => p[0])) : [];
  return {
    pages, n: r ? r.ents.length : -1, types: r ? [...new Set(r.ents.map(e => e.type))].sort().join(',') : '',
    w: r ? r.page.w : -1, h: r ? r.page.h : -1,
    minX: xs.length ? Math.min(...xs) : null, maxX: xs.length ? Math.max(...xs) : null,
    scaled: xs2.length ? Math.max(...xs2) : null,
    inflate: r ? r.stats.inflate : null, paths: r ? r.stats.paths : -1,
    layer: r && r.ents.length ? r.ents[0].layer : '',
    bad: await PC.pdfToEnts(new Uint8Array([1, 2, 3]), 0, {}),
  };
});
ok('4a üretilen PDF tek sayfa', pc.pages === 1, String(pc.pages));
ok('4b sayfa ölçüsü 200×100 punto', near(pc.w, 200, 0.01) && near(pc.h, 100, 0.01), `${pc.w}×${pc.h}`);
ok('4c içerik akışı çözüldü', pc.inflate === true, String(pc.inflate));
ok('4d üç yol okundu', pc.paths === 3, String(pc.paths));
ok('4e üç nesne üretildi', pc.n === 3, String(pc.n));
ok('4f türler LINE ve LWPOLYLINE', /LINE/.test(pc.types), pc.types);
ok('4g en sol nokta 10 punto', near(pc.minX, 10, 0.01), String(pc.minX));
ok('4h en sağ nokta 160 punto (dikdörtgenin sağı)', near(pc.maxX, 160, 0.01), String(pc.maxX));
ok('4i ölçek 10 uygulanınca 1600', near(pc.scaled, 1600, 0.1), String(pc.scaled));
ok('4j katman verilen ada kuruldu', pc.layer === 'PDF', pc.layer);
ok('4k bozuk baytlarda null', pc.bad === null, String(pc.bad));

// ---- 5. Blok kütüphanesi ve pano ------------------------------------------------------------------------
const bl = await page.evaluate(async () => {
  const B = await import('./blocklib.js');
  const S = window.dwgApp.state, store = { m: new Map(), get(k) { return this.m.get(k) || ''; }, set(k, v) { this.m.set(k, v); }, json(k, d) { try { const v = this.get(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } } };
  const path = { k: 0, closed: true, fill: false, w: 0, lay: '0', ops: [[0, 0, 0, 0], [1, 10, 0, 0], [2, 5, 0, 5, 0, Math.PI, 0]], bb: [0, 0, 10, 5], info: { t: 'LWPOLYLINE', ci: 256 }, et: 'LWPOLYLINE' };
  const text = { k: 1, x: 1, y: 2, z: 0, h: 3, rot: 0, lines: ['AÇIKLAMA'], ha: 0, va: 0, lay: '0', bb: [0, 0, 5, 5], info: { t: 'TEXT', ci: 3 }, et: 'TEXT' };
  const img = { k: 3, quad: [[0, 0]], bb: [0, 0, 1, 1], lay: '0', info: { t: 'IMAGE' }, et: 'IMAGE' };
  const ents = [path, text, img].map(p => B.primToEnt(p)).filter(Boolean);
  const bb = B.entsBBox(ents);
  const moved = B.moveEnts(ents, 100, 50, 0);
  const scaled = B.scaleEnts(ents, 2, 0, 0);
  const saved = B.saveBlock(store, '  Rögar  ', ents, [5, 2]);
  const list = B.listBlocks(store);
  const got = B.loadBlock(store, 'Rögar');
  const clip = B.clipWrite(store, ents, [0, 0]) && !!B.clipRead(store);
  B.deleteBlock(store, 'Rögar');
  return {
    n: ents.length, hasArc: ents[0].type === 'PATH' && ents[0].ops.some(o => o[0] === 2),
    color: ents[1].color, bb: Array.from(bb),
    movedX: moved[0].ops[1][1], origX: ents[0].ops[1][1],
    scaledH: scaled[1].h, saved, listN: list.length, name: list[0] ? list[0].name : '',
    gotN: got ? got.ents.length : -1, clip, afterDel: B.listBlocks(store).length,
    empty: B.saveBlock(store, '   ', ents, [0, 0]),
  };
});
ok('5a üç ilkelin ikisi varlığa çevrildi (resim atlandı)', bl.n === 2, String(bl.n));
ok('5b yol PATH olarak yay bilgisiyle taşındı', bl.hasArc === true);
ok('5c yazı rengi korundu (ACI 3)', bl.color === 3, String(bl.color));
ok('5d sınır kutusu hesaplandı', bl.bb.length === 4 && isFinite(bl.bb[0]), JSON.stringify(bl.bb));
ok('5e taşıma özgünü bozmuyor', bl.movedX === bl.origX + 100 && bl.origX === 10, `${bl.movedX} / ${bl.origX}`);
ok('5f ölçekleme yazı yüksekliğini de büyütüyor', bl.scaledH === 6, String(bl.scaledH));
ok('5g blok kaydedildi ve adı temizlendi', bl.saved === true && bl.name === 'Rögar', `${bl.saved} / ${bl.name}`);
ok('5h kütüphaneden geri okundu', bl.gotN === 2, String(bl.gotN));
ok('5i pano yazıldı ve okundu', bl.clip === true);
ok('5j silme çalışıyor', bl.afterDel === 0, String(bl.afterDel));
ok('5k boş ad kabul edilmiyor', bl.empty === false, String(bl.empty));

// ---- 6. YUVARLAK TUR: ilkel → varlık → ilkel ------------------------------------------------------------
// Blok kütüphanesi ve pano bu sınırı geçer. primToEnt'in ürettiği her türün entToPrim tarafından
// GERİ okunabildiği sınanmazsa, kaydetme çalışır ama yapıştırma sessizce boş gelir.
const rt = await page.evaluate(async () => {
  const B = await import('./blocklib.js');
  const E = await import('./edit.js');
  const layers = window.dwgApp.state.layers;
  const G = await import('./geom.js');
  const mesh = G.extrudeMesh([[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]], 2, true, true);
  const src = [
    { k: 0, closed: true, fill: false, w: 0, lay: '0', ops: [[0, 0, 0, 0], [1, 10, 0, 0], [2, 5, 0, 5, 0, Math.PI, 0]], bb: [0, 0, 10, 5], info: { t: 'LWPOLYLINE', ci: 256 }, et: 'LWPOLYLINE' },
    { k: 0, closed: true, fill: true, w: 0, lay: '0', ops: [[0, 0, 0, 0], [1, 5, 0, 0], [1, 5, 5, 0], [1, 0, 5, 0]], bb: [0, 0, 5, 5], info: { t: 'HATCH', ci: 256 }, et: 'HATCH' },
    { k: 1, x: 1, y: 2, z: 0, h: 3, rot: 0, lines: ['AÇIKLAMA'], ha: 0, va: 0, lay: '0', bb: [0, 0, 5, 5], info: { t: 'TEXT', ci: 3 }, et: 'TEXT' },
    { k: 2, x: 7, y: 8, z: 1, lay: '0', bb: [7, 8, 7, 8], info: { t: 'POINT', ci: 256 }, et: 'POINT' },
    { k: 5, vtx: mesh.vtx, idx: mesh.idx, seg: mesh.seg, bb: mesh.bb, zmin: mesh.zmin, zmax: mesh.zmax, lay: '0', face: true, info: { t: 'MESH', ci: 256 }, et: 'MESH' },
  ];
  const out = [];
  for (const p of src) {
    const ent = B.primToEnt(p);
    if (!ent) { out.push({ k: p.k, ent: null, back: null }); continue; }
    const back = E.entToPrim({ ...ent, id: 'R' + p.k }, layers);
    out.push({ k: p.k, type: ent.type, back: back ? back.k : null, ops: back && back.ops ? back.ops.length : 0, tris: back && back.idx ? back.idx.length / 3 : 0, fill: back ? !!back.fill : null, txt: back && back.lines ? back.lines.join('') : '' });
  }
  // JSON turundan geçirilmiş hâli de okunmalı (blok deposu JSON'dur)
  const viaJson = src.map(p => { const e = B.primToEnt(p); return e ? E.entToPrim({ ...JSON.parse(JSON.stringify(e)), id: 'J' }, layers) : null; });
  return { out, json: viaJson.map(p => (p ? p.k : null)) };
});
ok('6a yol turu: k=0 geri geldi ve yay korundu', rt.out[0].back === 0 && rt.out[0].ops === 3, JSON.stringify(rt.out[0]));
ok('6b tarama turu: dolgu bayrağı korundu', rt.out[1].back === 0 && rt.out[1].fill === true, JSON.stringify(rt.out[1]));
ok('6c yazı turu: metin korundu', rt.out[2].back === 1 && rt.out[2].txt === 'AÇIKLAMA', JSON.stringify(rt.out[2]));
ok('6d nokta turu', rt.out[3].back === 2, JSON.stringify(rt.out[3]));
ok('6e ağ turu: 12 üçgen geri geldi', rt.out[4].back === 5 && rt.out[4].tris === 12, JSON.stringify(rt.out[4]));
ok('6f JSON turundan sonra da hepsi okunuyor', rt.json.join(',') === '0,0,1,2,5', rt.json.join(','));

await page.screenshot({ path: `${out}/convert.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
