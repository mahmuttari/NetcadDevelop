// Ölçülendirme, açıklama ve yeni düzenleme işlemleri (v7.29).
// Saf hesap (üçgenleme, kalınlık ağı, bulut yayları, 3B ölçüm çekirdeği, dizi dönüşümleri) doğrudan
// çağrılır; araç ve işlem tarafı gerçek çizim üzerinde sürülür.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_annot.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
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

// ---- 1. Üçgenleme -------------------------------------------------------------------------------
const tri = await page.evaluate(async () => {
  const g = await import('./geom.js');
  const sq = g.triangulate([[0, 0], [10, 0], [10, 10], [0, 10]]);
  const area = (pts, t) => t.reduce((a, [i, j, k]) => a + Math.abs((pts[j][0] - pts[i][0]) * (pts[k][1] - pts[i][1]) - (pts[j][1] - pts[i][1]) * (pts[k][0] - pts[i][0])) / 2, 0);
  const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
  const tL = g.triangulate(L);
  const cw = g.triangulate([[0, 0], [0, 10], [10, 10], [10, 0]]);        // saat yönü verilse de çalışmalı
  return { nsq: sq.length, asq: area([[0, 0], [10, 0], [10, 10], [0, 10]], sq), nL: tL.length, aL: area(L, tL), ncw: cw.length, deg: g.triangulate([[0, 0], [1, 1]]).length };
});
ok('1a kare iki üçgene ayrıldı', tri.nsq === 2, String(tri.nsq));
ok('1b kare alanı korunuyor (100)', near(tri.asq, 100, 1e-6), String(tri.asq));
ok('1c L çokgeni dört üçgen', tri.nL === 4, String(tri.nL));
ok('1d L alanı korunuyor (300)', near(tri.aL, 300, 1e-6), String(tri.aL));
ok('1e saat yönü çokgen de ayrılıyor', tri.ncw === 2, String(tri.ncw));
ok('1f iki noktalı "çokgen" boş döner', tri.deg === 0, String(tri.deg));

// ---- 2. Kalınlık (extrusion) ağı ------------------------------------------------------------------
const ex = await page.evaluate(async () => {
  const g = await import('./geom.js');
  const m = g.extrudeMesh([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], 5, true, true);
  const mm = g.meshMetrics(m.vtx, m.idx);
  const open = g.extrudeMesh([[0, 0, 0], [10, 0, 0]], 5, false, false);
  return { verts: m.vtx.length / 3, tris: m.idx.length / 3, segs: m.seg.length / 6, zmin: m.zmin, zmax: m.zmax, bb: Array.from(m.bb), vol: mm.volume, total: mm.total, lateral: mm.lateral, openTris: open ? open.idx.length / 3 : -1, nul: g.extrudeMesh([[0, 0, 0]], 5) };
});
ok('2a köşe sayısı 8 (alt + üst halka)', ex.verts === 8, String(ex.verts));
ok('2b üçgen sayısı 12 (8 yan + 4 kapak)', ex.tris === 12, String(ex.tris));
ok('2c kenar sayısı 12', ex.segs === 12, String(ex.segs));
ok('2d yükseklik aralığı 0-5', ex.zmin === 0 && ex.zmax === 5, JSON.stringify([ex.zmin, ex.zmax]));
ok('2e hacim 500', near(ex.vol, 500, 1e-3), String(ex.vol));
ok('2f toplam yüzey 400 (2×100 kapak + 4×50 yan)', near(ex.total, 400, 1e-3), String(ex.total));
ok('2g yanal alan 200', near(ex.lateral, 200, 1e-3), String(ex.lateral));
ok('2h açık profil yalnız iki üçgen verir', ex.openTris === 2, String(ex.openTris));
ok('2i tek noktalı profil null', ex.nul === null, String(ex.nul));

// ---- 3. Revizyon bulutu -------------------------------------------------------------------------
const cl = await page.evaluate(async () => {
  const g = await import('./geom.js');
  const ops = g.cloudOps([[0, 0], [100, 0], [100, 100], [0, 100]], 10, true);
  const bb = g.opsBBox(ops);
  const arcs = ops.filter(o => o[0] === 2 || o[0] === -2).length;
  return { n: ops.length, first: ops[0][0], arcs, bb: Array.from(bb), nul: g.cloudOps([[0, 0]], 5) };
});
ok('3a yol moveto ile başlıyor', cl.first === 0, String(cl.first));
ok('3b yay üretildi', cl.arcs >= 8, String(cl.arcs));
ok('3c yaylar dışa kabarıyor (sınır kutusu büyüdü)', cl.bb[0] < -1 && cl.bb[2] > 101, JSON.stringify(cl.bb));
ok('3d tek nokta null', cl.nul === null, String(cl.nul));

// ---- 4. 3B ölçüm çekirdeği ------------------------------------------------------------------------
const m3 = await page.evaluate(async () => {
  const g = await import('./geom.js');
  const pl = g.planeFrom3([0, 0, 0], [1, 0, 0], [0, 1, 0]);              // z = 0 düzlemi
  return {
    ptline: g.pointLine3([0, 5, 0], [0, 0, 0], [10, 0, 0]).dist,          // 5
    ptlineT: g.pointLine3([5, 5, 0], [0, 0, 0], [10, 0, 0]).t,            // 0,5
    plane: pl ? pl.n[2] : null,
    ptplane: g.pointPlane3([3, 4, 7], pl).dist,                           // 7
    signed: g.pointPlane3([0, 0, -2], pl).signed,                         // -2
    skew: g.lineLine3([0, 0, 0], [1, 0, 0], [0, 0, 4], [0, 1, 4]).dist,   // 4 (çapraz)
    skewAng: g.lineLine3([0, 0, 0], [1, 0, 0], [0, 0, 4], [0, 1, 4]).angle, // 90
    par: g.lineLine3([0, 0, 0], [1, 0, 0], [0, 3, 0], [1, 3, 0]),         // paralel, 3
    lp: g.linePlane3([0, 0, 5], [0, 0, -5], pl),                          // kesişir, (0,0,0)
    lppar: g.linePlane3([0, 0, 5], [1, 0, 5], pl).dist,                   // 5
    pp: g.planePlane3(pl, g.planeFrom3([0, 0, 9], [1, 0, 9], [0, 1, 9])), // paralel, 9
    ang: g.planePlane3(pl, g.planeFrom3([0, 0, 0], [0, 1, 0], [0, 0, 1])).angle,  // 90
    bad: g.planeFrom3([0, 0, 0], [1, 0, 0], [2, 0, 0]),                   // doğrusal → null
  };
});
ok('4a nokta-doğru uzaklığı 5', near(m3.ptline, 5, 1e-9), String(m3.ptline));
ok('4b dik ayak oranı 0,5', near(m3.ptlineT, 0.5, 1e-9), String(m3.ptlineT));
ok('4c z=0 düzleminin normali +z', near(Math.abs(m3.plane), 1, 1e-9), String(m3.plane));
ok('4d nokta-düzlem uzaklığı 7', near(m3.ptplane, 7, 1e-9), String(m3.ptplane));
ok('4e işaretli uzaklık -2', near(m3.signed, -2, 1e-9), String(m3.signed));
ok('4f çapraz doğrular arası 4', near(m3.skew, 4, 1e-9), String(m3.skew));
ok('4g çapraz doğrular arası açı 90°', near(m3.skewAng, 90, 1e-6), String(m3.skewAng));
ok('4h paralel doğrular: bayrak ve uzaklık 3', m3.par.parallel === true && near(m3.par.dist, 3, 1e-9), JSON.stringify(m3.par));
ok('4i doğru-düzlem kesişimi orijinde', m3.lp.parallel === false && near(m3.lp.dist, 0, 1e-9) && near(m3.lp.at[2], 0, 1e-9), JSON.stringify(m3.lp));
ok('4j düzleme paralel doğru uzaklığı 5', near(m3.lppar, 5, 1e-9), String(m3.lppar));
ok('4k paralel düzlemler arası 9', m3.pp.parallel === true && near(m3.pp.dist, 9, 1e-9), JSON.stringify(m3.pp));
ok('4l dik düzlemler arası açı 90°', near(m3.ang, 90, 1e-6), String(m3.ang));
ok('4m doğrusal üç nokta düzlem vermez', m3.bad === null, String(m3.bad));

// ---- 5. Ölçülendirme üreticileri --------------------------------------------------------------------
const an = await page.evaluate(async () => {
  const a = await import('./annot.js');
  const o = { h: 2.5, layer: '0', color: 256, gid: 'G1', label: '100' };
  const lin = a.dimLinear('aligned', [0, 0, 0], [100, 0, 0], [0, 20, 0], o);
  const hor = a.dimLinear('horizontal', [0, 0, 0], [100, 40, 0], [0, -20, 0], o);
  const ver = a.dimLinear('vertical', [0, 0, 0], [100, 40, 0], [130, 0, 0], o);
  const rad = a.dimRadial('radius', [0, 0, 0], 50, [50, 0, 0], { ...o, label: 'R 50' });
  const dia = a.dimRadial('diameter', [0, 0, 0], 50, [50, 0, 0], { ...o, label: '⌀ 100' });
  const ang = a.dimAngular([0, 0, 0], [10, 0, 0], [0, 10, 0], o);
  const led = a.leaderEnts([[0, 0, 0], [10, 10, 0]], 'not', o);
  const bal = a.balloonEnts([0, 0, 0], '7', o);
  const cld = a.cloudEnt([[0, 0], [10, 0], [10, 10]], 2, o);
  const types = (r) => (r ? r.ents || r : []).map(e => e.type).join(',');
  return {
    lin: lin.measure, linT: types(lin.ents), gid: lin.ents.every(e => e.gid === 'G1'), itype: lin.ents.every(e => e.itype === 'DIMENSION'),
    hor: hor.measure, ver: ver.measure, rad: rad.measure, dia: dia.measure, radT: types(rad.ents), diaT: types(dia.ents),
    ang: ang.measure, angArc: !!(ang.ents[0].arcs && ang.ents[0].arcs.length),
    ledT: types(led.ents), balT: types(bal), cldT: types(cld),
    txt: lin.ents.find(e => e.type === 'TEXT').text,
    deg: a.dimLinear('aligned', [0, 0, 0], [0, 0, 0], [0, 5, 0], o),
    rect: a.arrayItems('rect', { nx: 3, ny: 2, dx: 10, dy: 20 }),
    polar: a.arrayItems('polar', { n: 4, total: 360, rotate: true, center: [0, 0] }),
    polarNo: a.arrayItems('polar', { n: 4, total: 360, rotate: false, center: [0, 0], base: [10, 0] }),
  };
});
ok('5a eğik ölçü 100', near(an.lin, 100, 1e-9), String(an.lin));
ok('5b parçalar: çizgiler + iki ok + yazı', an.linT === 'DIMENSION,SOLID,SOLID,TEXT', an.linT);
ok('5c bütün parçalar aynı grup kimliğinde', an.gid === true);
ok('5d bütün parçalar DIMENSION damgalı (ölçü süzgeci hepsini gizler)', an.itype === true);
ok('5e yatay ölçü 100, düşey ölçü 40', near(an.hor, 100, 1e-9) && near(an.ver, 40, 1e-9), `${an.hor} / ${an.ver}`);
ok('5f yarıçap 50, çap 100', near(an.rad, 50, 1e-9) && near(an.dia, 100, 1e-9), `${an.rad} / ${an.dia}`);
ok('5g yarıçapta tek ok, çapta iki ok', an.radT === 'DIMENSION,SOLID,TEXT' && an.diaT === 'DIMENSION,SOLID,SOLID,TEXT', `${an.radT} | ${an.diaT}`);
ok('5h açı 90°, yay üretildi', near(an.ang, 90, 1e-9) && an.angArc === true, String(an.ang));
ok('5i lider: çizgi + ok + yazı', an.ledT === 'DIMENSION,SOLID,TEXT', an.ledT);
ok('5j balon: daire + yazı', an.balT === 'CIRCLE,TEXT', an.balT);
ok('5k bulut tek CLOUD varlığı', an.cldT === 'CLOUD', an.cldT);
ok('5l ölçü metni etikete eşit', an.txt === '100', an.txt);
ok('5m sıfır uzunlukta ölçü null', an.deg === null, String(an.deg));
ok('5n dikdörtgen dizi 3×2 → 5 yeni kopya', an.rect.length === 5, String(an.rect.length));
ok('5o dizi ilk kopyayı atlıyor (0,0 yok)', !an.rect.some(i => i.m[4] === 0 && i.m[5] === 0), JSON.stringify(an.rect[0]));
ok('5p kutupsal 4 kopya → 3 yeni', an.polar.length === 3, String(an.polar.length));
ok('5q kutupsal 90° adım (cos=0, sin=1)', near(an.polar[0].m[0], 0, 1e-9) && near(an.polar[0].m[1], 1, 1e-9), JSON.stringify(an.polar[0].m.slice(0, 2)));
ok('5r dönmeyen kutupsal dizide matris yalnız öteleme', an.polarNo.every(i => i.m[0] === 1 && i.m[1] === 0 && i.m[2] === 0 && i.m[3] === 1), JSON.stringify(an.polarNo[0].m));

// ---- 6. Yeni düzenleme işlemleri (gerçek çizim üzerinde) ----------------------------------------------
const ops = await page.evaluate(async () => {
  const app = window.dwgApp, ed = app.editor, S = app.state;
  const n0 = S.prims.length;
  // iki yazı ve bir kare ekle
  ed.addEnts([
    { type: 'TEXT', pts: [[0, 0, 0]], text: 'BETON C25', h: 10 },
    { type: 'TEXT', pts: [[0, 50, 0]], text: 'beton c30', h: 10 },
    { type: 'LWPOLYLINE', pts: [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]], closed: true },
  ]);
  const added = S.prims.slice(-3);
  const texts = added.filter(p => p.k === 1);
  const rect = added.find(p => p.k === 0);
  const r = {};
  r.n1 = S.prims.length - n0;
  // yazı yüksekliği
  ed.runCmd({ op: 'textheight', keys: texts.map(p => p.key), h: 25 });
  r.h = texts.map(p => p.h);
  // dizi
  ed.runCmd({ op: 'array', keys: [rect.key], items: [{ m: [1, 0, 0, 1, 200, 0], dz: 0, newKeys: ['ARR1'] }, { m: [1, 0, 0, 1, 400, 0], dz: 0, newKeys: ['ARR2'] }] });
  r.arr = S.prims.filter(p => p.key === 'ARR1' || p.key === 'ARR2').length;
  // ayrı ayrı metin
  ed.runCmd({ op: 'settexts', items: texts.map((p, i) => ({ key: p.key, text: 'YENİ ' + i })) });
  r.txt = texts.map(p => p.lines.join(''));
  // kalınlık: EXTRUDE varlığı ağ ilkeli üretir
  ed.addEnts([{ type: 'EXTRUDE', pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], h: 4, closed: true, cap: true }]);
  const mesh = S.prims[S.prims.length - 1];
  r.mesh = mesh.k === 5 ? mesh.idx.length / 3 : -1;
  // tarama varlığı dolu ilkel üretir
  ed.addEnts([{ type: 'HATCH', pts: [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]] }]);
  const hat = S.prims[S.prims.length - 1];
  r.hatch = !!(hat.fill && hat.et === 'HATCH');
  // bulut varlığı yay üretir
  ed.addEnts([{ type: 'CLOUD', pts: [[0, 0, 0], [50, 0, 0], [50, 50, 0]], r: 6 }]);
  const cl2 = S.prims[S.prims.length - 1];
  r.cloud = cl2.ops.filter(o => o[0] === 2 || o[0] === -2).length;
  // geri al zinciri
  const before = S.prims.length;
  ed.doc.undo(); ed.doc.undo(); ed.doc.undo();
  r.undone = before - S.prims.length;
  ed.doc.redo(); ed.doc.redo(); ed.doc.redo();
  r.redone = S.prims.length - (before - r.undone);
  return r;
});
ok('6a üç varlık eklendi', ops.n1 === 3, String(ops.n1));
ok('6b yazı yüksekliği 25 oldu', ops.h.every(h => h === 25), JSON.stringify(ops.h));
ok('6c dizi iki kopya üretti', ops.arr === 2, String(ops.arr));
ok('6d her yazıya ayrı metin yazıldı', ops.txt.join('|') === 'YENİ 0|YENİ 1', ops.txt.join('|'));
ok('6e kalınlık 12 üçgenlik ağ üretti', ops.mesh === 12, String(ops.mesh));
ok('6f tarama dolu ilkel', ops.hatch === true);
ok('6g bulut yayları üretildi', ops.cloud >= 3, String(ops.cloud));
ok('6h üç geri alma üç ilkel düşürdü', ops.undone === 3, String(ops.undone));
ok('6i üç yineleme geri getirdi', ops.redone === 3, String(ops.redone));

// ---- 7. Bul-değiştir ------------------------------------------------------------------------------
const fr = await page.evaluate(() => {
  const app = window.dwgApp;
  const R = app.__fr;
  return {
    plain: R.replace('beton beton', 'beton', 'BETON', false, false),
    caseOn: R.replace('Beton beton', 'beton', 'X', true, false),
    tr: R.replace('IŞIK ışık İzmir izmir', 'ışık', 'X', false, false),
    trI: R.replace('id ID İd', 'ID', 'X', false, false),   // büyük I → i: Latin metinde ID ile id aynı sözcük
    word: R.replace('betonarme beton', 'beton', 'X', false, true),
    empty: R.replace('abc', '', 'X', false, false),
    scan: (() => { const r = R.scan('YENİ', 'ESKİ', { scope: 'text' }); return { hits: r.hits, n: r.texts.length }; })(),
  };
});
ok('7a düz değiştirme iki eşleşme', fr.plain.n === 2 && fr.plain.out === 'BETON BETON', JSON.stringify(fr.plain));
ok('7b harf duyarlı tek eşleşme', fr.caseOn.n === 1 && fr.caseOn.out === 'Beton X', JSON.stringify(fr.caseOn));
ok('7c Türkçe I/ı duyarsız eşleşme (IŞIK ve ışık)', fr.tr.n === 2, JSON.stringify(fr.tr));
ok('7c2 Latin büyük I harf duyarsızda i ile eşleşir (ID → id, İd)', fr.trI.n === 3 && fr.trI.out === 'X X X', JSON.stringify(fr.trI));
ok('7d tam sözcük "betonarme"yi atlıyor', fr.word.n === 1 && fr.word.out === 'betonarme X', JSON.stringify(fr.word));
ok('7e boş arama hiçbir şey değiştirmez', fr.empty.n === 0 && fr.empty.out === 'abc', JSON.stringify(fr.empty));
ok('7f tarama çizimdeki yazıları buluyor', fr.scan.hits >= 2, JSON.stringify(fr.scan));

// ---- 8. DXF: dolu yüzeyler gerçek varlık olarak yazılıyor mu -------------------------------------------
const dxf = await page.evaluate(async () => {
  const E = await import('./edit.js');
  const S = window.dwgApp.state;
  const layers = S.layers;
  const mk = (ent) => E.entToPrim({ ...ent, id: 'T' + Math.random().toString(36).slice(2), layer: '0', color: 256 }, layers);
  const hat = mk({ type: 'HATCH', pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]] });
  const sol = mk({ type: 'SOLID', pts: [[0, 0, 0], [5, 0, 0], [0, 5, 0]] });
  const dim = mk({ type: 'DIMENSION', segs: [[[0, 0, 0], [10, 0, 0]]], measure: 10 });
  const txt = E.writeDxf([hat, sol, dim], layers, {});
  return {
    hatch: /\r\n0\r\nHATCH\r\n/.test(txt), solid: /\r\n0\r\nSOLID\r\n/.test(txt),
    paths: /\r\n91\r\n1\r\n/.test(txt), poly: /\r\n92\r\n3\r\n/.test(txt), verts: /\r\n93\r\n4\r\n/.test(txt),
    dimLine: /\r\n0\r\nLINE\r\n/.test(txt) || /\r\nLWPOLYLINE\r\n/.test(txt),
    len: txt.length,
  };
});
ok('8a HATCH varlığı yazıldı', dxf.hatch === true);
ok('8b SOLID varlığı yazıldı', dxf.solid === true);
ok('8c bir sınır yolu bildirildi', dxf.paths === true);
ok('8d yol çokgen + dış sınır (92 = 3)', dxf.poly === true);
ok('8e dört köşe yazıldı', dxf.verts === true);
ok('8f ölçü geometrisi yazıldı', dxf.dimLine === true);

// ---- 9. Yetki kademeleri --------------------------------------------------------------------------
const tiers = await page.evaluate(async () => {
  const Ed = await import('./edition.js');
  const ids = ['t:dim', 't:dimh', 't:dimv', 't:dimr', 't:dimd', 't:dima', 't:leader', 't:cloud', 't:balloon', 't:hatch', 'markdim',
    't:array', 't:explode', 't:textsize', 't:attr', 'findrep', 'blocklib', 'copyclip', 'pasteclip', 'tableout',
    't:thick', '3:geo', '3:note', 'mesh3d', 'batch', 'pdfcad', 't:fillarea'];
  const o = {}; for (const i of ids) o[i] = Ed.need(i);
  return o;
});
ok('9a ölçülendirme ve açıklama Premium', ['t:dim', 't:dimh', 't:dimv', 't:dimr', 't:dimd', 't:dima', 't:leader', 't:cloud', 't:balloon', 't:hatch', 'markdim'].every(k => tiers[k] === 'premium'), JSON.stringify(tiers));
ok('9b 2B düzenleme eklentileri Premium', ['t:array', 't:explode', 't:textsize', 't:attr', 'findrep', 'blocklib', 'copyclip', 'pasteclip', 'tableout'].every(k => tiers[k] === 'premium'));
// PDF→CAD ve toplu işlem v7.48'de Super'den Premium'a indi (rakip ikisini de Premium'da veriyor);
// 3B ÜRETİM Super'de kaldı — Super'i ayıran şey 3B'dir, dönüştürme değil.
ok('9c 3B üretim Super, dönüştürme ve toplu işlem Premium',
  ['t:thick', '3:geo', '3:note', 'mesh3d'].every(k => tiers[k] === 'super')
  && ['batch', 'pdfcad'].every(k => tiers[k] === 'premium'),
  JSON.stringify({ thick: tiers['t:thick'], mesh3d: tiers.mesh3d, batch: tiers.batch, pdfcad: tiers.pdfcad }));
ok('9d dolgu alanı ölçümü ücretsiz', tiers['t:fillarea'] === 'free', tiers['t:fillarea']);

// ---- 10. Araçları gerçek dokunuşla sürme -----------------------------------------------------------
const tapWorld = async (x, y) => {
  const sc = await page.evaluate(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]);
  const r = await page.locator('#viewport').boundingBox();
  await page.touchscreen.tap(r.x + sc[0], r.y + sc[1]);
  await page.waitForTimeout(220);
};
const count = () => page.evaluate(() => window.dwgApp.state.scene.layouts[0].prims.length);
await page.evaluate(() => { window.dwgApp.zoomExtents([0, 0, 2000, 2000]); });
await page.waitForTimeout(250);
const nBase = await count();
// doğrusal ölçülendirme: üç dokunuş → dört parça (çizgiler + iki ok + yazı)
await page.click('#toolbar [data-tab="annot"]');
await page.click('#toolbar [data-act="t:dim"]');
await tapWorld(200, 300); await tapWorld(700, 300); await tapWorld(200, 500);
const nDim = await count();
ok('10a doğrusal ölçülendirme dört parça ekledi', nDim === nBase + 4, `${nBase} → ${nDim}`);
const dimInfo = await page.evaluate(() => {
  const ps = window.dwgApp.state.scene.layouts[0].prims.slice(-4);
  return { types: ps.map(p => p.et).join(','), itypes: [...new Set(ps.map(p => p.info.t))].join(','), gids: new Set(ps.map(p => p.info.gid)).size, txt: (ps.find(p => p.k === 1) || {}).lines };
});
ok('10b parçalar DIMENSION damgalı ve tek grupta', dimInfo.itypes === 'DIMENSION' && dimInfo.gids === 1, JSON.stringify(dimInfo));
ok('10c ölçü metni 500 (birimiyle)', dimInfo.txt && /^500\b/.test(dimInfo.txt[0]), JSON.stringify(dimInfo.txt));
// revizyon bulutu
await page.click('#toolbar [data-act="t:cloud"]');
await tapWorld(900, 300); await tapWorld(1400, 300); await tapWorld(1400, 700);
await page.click('#cmdBtns [data-cmd="close"]').catch(() => {});
await page.waitForTimeout(200);
ok('10d revizyon bulutu eklendi', await count() === nDim + 1, String(await count()));
// numaralandırma: iki dokunuş, numara artar
await queueAnswers(page, '5');
await page.click('#toolbar [data-act="t:balloon"]');
await tapWorld(300, 900); await tapWorld(600, 900);
const balloons = await page.evaluate(() => window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'BALLOON' && p.k === 1).map(p => p.lines[0]));
ok('10e balon numaraları 5 ve 6', balloons.join(',') === '5,6', balloons.join(','));
// açıklama (lider)
await queueAnswers(page, 'Kanal ekseni');
await page.click('#toolbar [data-act="t:leader"]');
await tapWorld(1000, 1000); await tapWorld(1300, 1200);
await page.click('#cmdBtns [data-cmd="finish"]');
await page.waitForTimeout(250);
const lead = await page.evaluate(() => window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'LEADER').length);
ok('10f lider üç parça ekledi', lead === 3, String(lead));
await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
// tarama: BOŞ bir bölgeye kapalı alan çiz, içine dokun.
// Özgün çizimin dışına çıkılır: enclosingPrim EN KÜÇÜK kapalı bölgeyi seçer, çizimin kendi
// odaları araya girerse sınama kendi dikdörtgenimizi değil onları ölçerdi.
await page.evaluate(() => window.dwgApp.zoomExtents([4800, 4800, 5600, 5600]));
await page.waitForTimeout(250);
await page.click('#toolbar [data-tab="draw"]'); await page.click('#toolbar [data-act="t:rect"]');
await tapWorld(5000, 5000); await tapWorld(5400, 5400);
const nRect = await count();
await page.click('#toolbar [data-tab="annot"]'); await page.click('#toolbar [data-act="t:hatch"]');
await tapWorld(5200, 5200);
const hatched = await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims[window.dwgApp.state.scene.layouts[0].prims.length - 1]; return { et: p.et, fill: !!p.fill }; });
ok('10g kapalı alana dokunmak tarama ekledi', await count() === nRect + 1 && hatched.et === 'HATCH' && hatched.fill, JSON.stringify(hatched));
// dolgu alanı ölçümü aynı alanı okur (aynı kapalı bölgeye dokunulur)
await page.evaluate(() => { document.getElementById('docBody').innerHTML = ''; document.getElementById('toast').hidden = true; });
await page.click('#toolbar [data-tab="measure"]'); await page.click('#toolbar [data-act="t:fillarea"]');
// dikdörtgen tuvalin ORTASINA getirilir: ölçü sekmesinin şeridi daha yüksektir ve üstteki
// dünya noktası şeridin altında kalabilir; dokunuşun tuvale düştüğünden emin olalım
await page.evaluate(() => window.dwgApp.zoomExtents([4900, 4900, 5500, 5500]));
await page.waitForTimeout(250);
await tapWorld(5200, 5200);
await page.waitForFunction(() => { const el = document.getElementById('docBody'); return el && /\d/.test(el.textContent); }, null, { timeout: 8000 }).catch(() => {});
const areaTxt = await page.evaluate(() => {
  const el = document.getElementById('docBody'), ts = document.getElementById('toast');
  const ed = window.dwgApp.editor;
  return (el ? el.textContent.replace(/\s+/g, ' ') : '') + ' || toast:' + (ts && !ts.hidden ? ts.textContent : '-')
    + ' || arac:' + (ed.tools ? ed.tools.active : '?') + ' || cmd:' + (document.getElementById('cmdText') || {}).textContent
    + ' || baslik:' + (document.getElementById('docTitle') || {}).textContent;
});
ok('10h dolgu alanı 160.000 birim² okundu', /160\.000/.test(areaTxt), areaTxt.slice(0, 140));
await page.evaluate(() => { document.getElementById('docPanel').hidden = true; });   // sonuç paneli sonraki dokunuşu engellemesin
await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
// kalınlık: SEÇİM açıkça kurulur (dokunma en yakın nesneyi seçer, sınama belirli olsun)
await page.evaluate(() => {
  const app = window.dwgApp, ed = app.editor;
  const ps = app.state.scene.layouts[0].prims;
  const rect = ps.filter(p => p.k === 0 && p.closed && p.bb && p.bb[0] >= 4999 && p.bb[2] <= 5401 && p.et === 'LWPOLYLINE');
  ed.setSelection(rect.slice(-1));
});
await page.click('#toolbar [data-tab="edit"]'); await page.click('#toolbar [data-act="t:thick"]');
await page.locator('#cmdInput').fill('300');
await page.locator('#cmdInput').press('Enter');
await page.waitForTimeout(400);
const thick = await page.evaluate(() => { const ps = window.dwgApp.state.scene.layouts[0].prims; const m = ps.filter(p => p.k === 5 && p.et === 'EXTRUDE'); const L = m[m.length - 1]; return L ? { n: m.length, tris: L.idx.length / 3, dz: L.zmax - L.zmin } : null; });
ok('10i kalınlık 3B gövde üretti (12 üçgen, yükseklik 300)', !!thick && thick.tris === 12 && Math.abs(thick.dz - 300) < 1e-6, JSON.stringify(thick));
await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});

// ---- 11. Paneller ----------------------------------------------------------------------------------
// ölçümü çizime işleme
await page.evaluate(() => { const app = window.dwgApp; app.setMode('measure'); app.state.measure.length = 0; app.state.measure.push([0, 0, 0], [300, 400, 0], [0, 0, 0]); document.getElementById('btnMeasureUndo').click(); });
const nMark = await count();
await page.evaluate(() => window.dwgApp.action('markdim'));
await page.waitForTimeout(250);
const markTxt = await page.evaluate(() => { const ps = window.dwgApp.state.scene.layouts[0].prims.slice(-3); return { n: ps.length, t: (ps.find(p => p.k === 1) || {}).lines, it: [...new Set(ps.map(p => p.info.t))].join(',') }; });
ok('11a ölçüm çizime işlendi (lider + ok + yazı)', await count() === nMark + 3 && markTxt.it === 'LEADER', JSON.stringify(markTxt));
ok('11b işlenen değer 500 (birimiyle)', markTxt.t && /^500\b/.test(markTxt.t[0]), JSON.stringify(markTxt.t));
await page.evaluate(() => window.dwgApp.setMode('view'));
// pano: seç → kopyala → yapıştır
const nClip = await page.evaluate(async () => {
  const app = window.dwgApp, ed = app.editor, S = app.state;
  const rect = S.scene.layouts[0].prims.filter(p => p.k === 0 && p.ent && p.ent.type === 'LWPOLYLINE');
  ed.setSelection(rect.slice(0, 1));
  const before = S.scene.layouts[0].prims.length;
  app.action('copyclip');
  await new Promise(r => setTimeout(r, 300));
  app.action('pasteclip');
  await new Promise(r => setTimeout(r, 400));
  return { before, after: S.scene.layouts[0].prims.length, sel: ed.selection().length };
});
ok('11c panodan yapıştırma nesne ekledi', nClip.after === nClip.before + 1, JSON.stringify(nClip));
ok('11d yapıştırılan nesne seçili kaldı', nClip.sel === 1, String(nClip.sel));
// blok kütüphanesi paneli
await page.evaluate(() => window.dwgApp.action('blocklib'));
await page.waitForTimeout(300);
ok('11e blok kütüphanesi paneli açıldı', await page.evaluate(() => !document.getElementById('docPanel').hidden && !!document.getElementById('blkNew')));
await queueAnswers(page, 'Deneme bloğu');
await page.click('#blkNew');
await page.waitForTimeout(400);
const blkList = await page.evaluate(() => [...document.querySelectorAll('#docBody [data-blk]')].map(e => e.dataset.blk));
ok('11f seçimden blok kaydedildi', blkList.includes('Deneme bloğu'), JSON.stringify(blkList));
const nBlk = await count();
// Yerleştirme artık ölçek ve dönüş soruyor; varsayılanlarla (1 · 0°) geometri birebir konur.
await queueAnswers(page, {});
await page.click('#docBody [data-blk="Deneme bloğu"]');
await page.waitForTimeout(400);
ok('11g kütüphaneden blok eklendi', await count() === nBlk + 1, `${nBlk} → ${await count()}`);
const bb1 = await page.evaluate(() => { const S = window.dwgApp.state; const p = [...window.dwgApp.editor.sel][0]; return p ? p.bb.slice() : null; });
// Ölçek 2 ve 90° dönüşle aynı blok: sınır kutusu iki katına çıkmalı ve blok yine görünümün ortasında kalmalı
await page.evaluate(() => window.dwgApp.action('blocklib'));
await page.waitForTimeout(250);
await queueAnswers(page, { scale: '2', rot: '90' });
await page.click('#docBody [data-blk="Deneme bloğu"]');
await page.waitForTimeout(400);
const bb2 = await page.evaluate(() => { const p = [...window.dwgApp.editor.sel][0]; return p ? p.bb.slice() : null; });
ok('11g2 ölçek ve dönüş sorulup uygulanıyor (2× → kutu iki katı)',
  !!bb1 && !!bb2 && Math.abs(((bb2[2] - bb2[0]) + (bb2[3] - bb2[1])) - 2 * ((bb1[2] - bb1[0]) + (bb1[3] - bb1[1]))) < 1e-6,
  bb1 && bb2 ? `${(bb1[2] - bb1[0]).toFixed(2)}×${(bb1[3] - bb1[1]).toFixed(2)} → ${(bb2[2] - bb2[0]).toFixed(2)}×${(bb2[3] - bb2[1]).toFixed(2)}` : 'bb yok');
// bul-değiştir paneli
await page.evaluate(() => window.dwgApp.action('findrep'));
await page.waitForTimeout(250);
ok('11h bul-değiştir paneli açıldı', await page.evaluate(() => !!document.getElementById('frFind') && !!document.getElementById('frGo')));
await page.locator('#frFind').fill('Teksto');
await page.locator('#frRep').fill('METIN');
await page.click('#frScanBtn');
await page.waitForTimeout(250);
const frInfo = await page.evaluate(() => document.getElementById('frInfo').textContent.replace(/\s+/g, ' ').slice(0, 80));
ok('11i tarama eşleşme sayısını gösterdi', /\d/.test(frInfo) && !/Aranacak/.test(frInfo), frInfo);
await page.click('#frGo');
await page.waitForTimeout(400);
const replaced = await page.evaluate(() => window.dwgApp.state.prims.some(p => p.k === 1 && p.lines.join(' ').includes('METIN')));
ok('11j değiştirme çizime işledi', replaced === true);
// 3B dışa aktarma paneli
await page.evaluate(() => window.dwgApp.action('mesh3d'));
await page.waitForTimeout(400);
const mx3 = await page.evaluate(() => { const b = document.getElementById('docBody'); return b ? b.textContent.replace(/\s+/g, ' ').slice(0, 200) : ''; });
ok('11k 3B dışa aktarma paneli sayıları gösteriyor', /OBJ/.test(mx3) && /STL/.test(mx3), mx3.slice(0, 100));
ok('11l biçim seçicisi üç seçenekli', await page.evaluate(() => { const s = document.getElementById('m3Fmt'); return s ? s.options.length : 0; }) === 3);
await page.evaluate(() => document.getElementById('docPanel').hidden = true);
// tablo çıkarma: örnek çizimde ızgaralı tablo yok → uyarı
await page.evaluate(() => window.dwgApp.action('tableout'));
await page.waitForTimeout(400);
const tblToast = await page.evaluate(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent : ''; });
ok('11m tablosuz çizimde uyarı veriyor', /tablo|table/i.test(tblToast), tblToast.slice(0, 60));

await page.screenshot({ path: `${out}/annot.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
