/*
 * TARAMANIN AutoCAD GİDİŞ-DÖNÜŞÜ (v7.93).
 *
 * "AutoCAD ile bu dosya açılırsa o tarama aynı şartlarla düzenlenebilmeli" kuralının sınaması.
 * Kendi DXF yazıcımızın çıktısı, kendi DXF okuyucumuzla geri okunur ve grup grup denetlenir:
 * desen adı, ölçek, açı, tanım satırları, ada (island) bayrakları, yay sınırının BULGE ile
 * taşınması, ada kipi (75), desen türü (76), çift (77), piksel boyu (47), tohum noktaları (98)
 * ve geçiş (gradient) tanımı. Ayrıca desen ÇİZGİLERİ dosyaya ayrıca yazılmamalıdır (yazılsaydı
 * AutoCAD'de hem desen hem zikzak polyline görünürdü) ve bloğa / panoya alınıp geri konan tarama
 * tarama olarak kalmalıdır.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_tarama_dxf.mjs [çıktı] [örnekler]
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
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });

/*
 * Sayfa içi yardımcı: verilen varlıkları ilkele çevirir, DXF yazar ve KENDİ okuyucumuzla geri okur.
 * Böylece "yazdığımızı okuyabiliyor muyuz" değil, "AutoCAD'in beklediği grupları yazıyor muyuz"
 * sorusu sınanır: okuyucu DXF kodlarını adlandırılmış alanlara çevirir.
 */
const turla = (ents, o) => ev(async ([es, opt]) => {
  const A = window.dwgApp;
  const E = await import('./edit.js');
  const D = await import('./dxf.js');
  const prims = [];
  for (const e of es) { const p = E.entToPrim(e, A.state.layers); if (p) prims.push(p); }
  const metin = E.writeDxf(prims, A.state.layers, { ltypes: A.state.ltypes, blocks: A.state.blocks });
  const bayt = new TextEncoder().encode(metin);
  const db = D.parseDxf(bayt, {});
  const hepsi = db.entities || [];
  const say = {};
  for (const q of hepsi) say[q.type] = (say[q.type] || 0) + 1;
  const h = hepsi.find(q => q.type === 'HATCH') || null;
  return {
    say, prims: prims.length,
    metin: (opt && opt.metin) ? metin : null,
    hatch: h ? {
      pattern: h.patternName, solid: h.solidFill, assoc: h.associativity, style: h.hatchStyle, ptype: h.patternType,
      angle: h.patternAngle, scale: h.patternScale, dbl: h.patternDouble, pix: h.pixelSize, elev: h.elevation,
      defs: (h.definitionLines || []).length,
      def0: h.definitionLines && h.definitionLines[0] ? { a: h.definitionLines[0].angle, ofs: [h.definitionLines[0].offset.x, h.definitionLines[0].offset.y], dash: h.definitionLines[0].dashLengths.length } : null,
      seeds: (h.seedPoints || []).map(q => [q.x, q.y]),
      grad: h.gradientFlag ? { one: h.gradientColorFlag, name: h.gradientName, rot: h.gradientRotation, tint: h.colorTint } : null,
      loops: (h.boundaryPaths || []).map(b => ({ flag: b.boundaryPathTypeFlag, bulge: !!b.hasBulge, closed: !!b.isClosed, n: (b.vertices || []).length, b: (b.vertices || []).map(v => v.bulge) })),
    } : null,
  };
}, [ents, o || null]);

const kare = (x0, y0, x1, y1) => [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]];

// ---------------------------------------------------------------------------------
// 1 · Desenli tarama: ad, ölçek, açı, tanım satırları, ada kipi, ilişkisizlik
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const An = await import('./annot.js');
    const g = An.hatchEnts([[0, 0, 0], [100, 0, 0], [100, 60, 0], [0, 60, 0]], { pattern: 'ANSI31', scale: 4, angle: 30, layer: '0', color: 1, gid: 'g1' });
    return g ? { n: g.ents.length, tipler: g.ents.map(e => e.type), scale: g.scale, pattern: g.pattern } : null;
  });
  ok('1a hatchEnts iki varlık üretir: HATCH sınırı + hpart desen çizgileri', !!r && r.n === 2 && r.tipler[0] === 'HATCH' && r.tipler[1] === 'PATH', J(r));

  const t = await turla([
    { id: 'h1', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 100, 60), pattern: 'ANSI31', hscale: 4, hangle: 30, alpha: 0.18, gid: 'g1' },
  ]);
  ok('1b DXF\'te tek HATCH varlığı var, LWPOLYLINE yok', !!t.hatch && !t.say.LWPOLYLINE, J(t.say));
  ok('1c desen adı, ölçek ve açı korunur; 70 = 0 (desenli), 71 = 0 (ilişkisiz)',
    t.hatch.pattern === 'ANSI31' && yak(t.hatch.scale, 4) && yak(t.hatch.angle, Math.PI / 6, 1e-6) && t.hatch.solid === 0 && t.hatch.assoc === 0, J(t.hatch));
  ok('1d desen TANIM SATIRLARI yazılır (ad tek başına boş tarama verirdi)', t.hatch.defs >= 1 && !!t.hatch.def0 && t.hatch.def0.ofs.some(v => Math.abs(v) > 1e-9), J(t.hatch.def0));
  ok('1e ada kipi NORMAL (75 = 0) ve desen türü ÖNTANIMLI (76 = 1)', t.hatch.style === 0 && t.hatch.ptype === 1, J({ s: t.hatch.style, p: t.hatch.ptype }));
  ok('1f tek ilmek DIŞ sınır (92 = 3 = dış | çokgen), kapalı, bulge yok',
    t.hatch.loops.length === 1 && t.hatch.loops[0].flag === 3 && t.hatch.loops[0].closed && !t.hatch.loops[0].bulge && t.hatch.loops[0].n === 4, J(t.hatch.loops));
}

// ---------------------------------------------------------------------------------
// 2 · Desen ÇİZGİLERİ dosyaya ayrıca yazılmaz (hpart süzgeci)
// ---------------------------------------------------------------------------------
{
  const t = await turla([
    { id: 'h2', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 100, 60), pattern: 'ANSI31', hscale: 4, hangle: 0, alpha: 0.18, gid: 'g2', hp: 4 },
    { id: 'h2p', type: 'PATH', layer: '0', color: 1, ops: [[0, 0, 0, 0], [1, 100, 60, 0]], closed: false, fill: false, hp: 4, hpart: 1, gid: 'g2' },
  ]);
  ok('2a desen çizgileri LWPOLYLINE olarak yazılmaz; yalnız HATCH çıkar', !!t.hatch && !t.say.LWPOLYLINE && !t.say.LINE, J(t.say));
}

// ---------------------------------------------------------------------------------
// 3 · ADA (island): içteki ilmek dış sayılmaz
// ---------------------------------------------------------------------------------
{
  const ops = [
    [0, 0, 0, 0], [1, 100, 0, 0], [1, 100, 100, 0], [1, 0, 100, 0], [1, 0, 0, 0],
    [0, 30, 30, 0], [1, 70, 30, 0], [1, 70, 70, 0], [1, 30, 70, 0], [1, 30, 30, 0],
  ];
  const t = await turla([{ id: 'h3', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 100, 100), ops, pattern: 'SOLID', alpha: 1 }]);
  ok('3a iki ilmek yazıldı', !!t.hatch && t.hatch.loops.length === 2, J(t.hatch && t.hatch.loops));
  ok('3b dış ilmek 92 = 3 (dış | çokgen), İÇ ilmek 92 = 2 (yalnız çokgen)',
    t.hatch.loops[0].flag === 3 && t.hatch.loops[1].flag === 2, J(t.hatch.loops.map(l => l.flag)));
}

// ---------------------------------------------------------------------------------
// 4 · YAY sınırı: AutoCAD'in kendi gösterimi olan BULGE ile yazılır, kirişlenmez
// ---------------------------------------------------------------------------------
{
  // tam daire: [0, x0, y0] + [2, cx, cy, r, 0, 2pi]
  const TAU = Math.PI * 2;
  const daire = [[0, 50, 0, 0], [2, 0, 0, 50, 0, TAU, 0]];
  const t = await turla([{ id: 'h4', type: 'HATCH', layer: '0', color: 1, pts: kare(-50, -50, 50, 50), ops: daire, pattern: 'SOLID', alpha: 1 }]);
  const L = t.hatch && t.hatch.loops[0];
  ok('4a daire sınırı İKİ yarım yay olarak yazılır (tan(pi/2) sonsuzdur), bulge = 1',
    !!L && L.bulge === true && L.n === 2 && yak(L.b[0], 1, 1e-6) && yak(L.b[1], 1, 1e-6), J(L));

  // çeyrek yay + iki doğru (pasta dilimi): bulge = tan(90/4) = 0.41421356
  const dilim = [[0, 0, 0, 0], [1, 50, 0, 0], [2, 0, 0, 50, 0, Math.PI / 2, 0], [1, 0, 0, 0]];
  const t2 = await turla([{ id: 'h5', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 50, 50), ops: dilim, pattern: 'SOLID', alpha: 1 }]);
  const L2 = t2.hatch && t2.hatch.loops[0];
  // (0,0) → (50,0) düz · (50,0) → (0,50) YAY · (0,50) → (0,0) kapanış: üç köşe, yay ortadaki köşede
  ok('4b çeyrek yay bulge = tan(90°/4) = 0,414214; kapanış köşesi yinelenmez',
    !!L2 && L2.bulge === true && L2.n === 3 && yak(L2.b[0], 0, 1e-9) && yak(L2.b[1], Math.tan(Math.PI / 8), 1e-6) && yak(L2.b[2], 0, 1e-9), J(L2));

  // saat yönü yay: bulge NEGATİF
  const ters = [[0, 50, 0, 0], [-2, 0, 0, 50, 0, -Math.PI / 2, 0], [1, 0, 0, 0]];
  const t3 = await turla([{ id: 'h6', type: 'HATCH', layer: '0', color: 1, pts: kare(-50, -50, 50, 50), ops: ters, pattern: 'SOLID', alpha: 1 }]);
  const L3 = t3.hatch && t3.hatch.loops[0];
  ok('4c saat yönündeki yayın bulge değeri negatiftir', !!L3 && L3.bulge === true && L3.b.some(v => v < -1e-9), J(L3));
}

// ---------------------------------------------------------------------------------
// 5 · KÜNYE: ada kipi, desen türü, çift, piksel boyu, kot, tohum noktaları, geçiş
// ---------------------------------------------------------------------------------
{
  const hrec = { style: 1, ptype: 0, dbl: 1, pix: 0.25, elev: 12.5, seeds: [[10, 10], [20, 20]] };
  const t = await turla([{ id: 'h7', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 100, 60), pattern: 'ANSI31', hscale: 2, hangle: 0, alpha: 0.18, hrec }]);
  ok('5a ada kipi (75), desen türü (76), çift (77), piksel boyu (47) ve kot (30) aynen geri gelir',
    !!t.hatch && t.hatch.style === 1 && t.hatch.ptype === 0 && t.hatch.dbl === 1 && yak(t.hatch.pix, 0.25) && yak(t.hatch.elev, 12.5), J(t.hatch));
  ok('5b tohum noktaları (98 + 10/20) korunur', t.hatch.seeds.length === 2 && yak(t.hatch.seeds[0][0], 10) && yak(t.hatch.seeds[1][1], 20), J(t.hatch.seeds));

  const grad = { style: 0, grad: { one: 0, name: 'CYLINDER', rot: 0.5, def: 0, tint: 0.7, colors: [{ rgb: 0xff0000, value: 0 }, { rgb: 0x0000ff, value: 1 }] } };
  const tg = await turla([{ id: 'h8', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 100, 60), pattern: 'SOLID', alpha: 1, hrec: grad }]);
  ok('5c geçiş (gradient) tanımı yazılır ve geri okunur (450/452/460/462/470)',
    !!tg.hatch && !!tg.hatch.grad && tg.hatch.grad.name === 'CYLINDER' && tg.hatch.grad.one === 0 && yak(tg.hatch.grad.rot, 0.5) && yak(tg.hatch.grad.tint, 0.7), J(tg.hatch && tg.hatch.grad));
}

// ---------------------------------------------------------------------------------
// 6 · DOSYANIN KENDİ DESENİ: tablomuzda olmayan ad korunur, tanım satırları yazılır
// ---------------------------------------------------------------------------------
{
  const hdefs = [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 7 }, dashLengths: [] },
    { angle: Math.PI / 2, base: { x: 0, y: 0 }, offset: { x: 0, y: 7 }, dashLengths: [] }];
  const t = await turla([{ id: 'h9', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 100, 60), pattern: 'AR-CONC', hscale: 1, hangle: 0, alpha: 0.18, hdefs }]);
  ok('6a tablomuzda olmayan desen adıyla yazılır ve dosyanın kendi tanım satırları korunur',
    !!t.hatch && t.hatch.pattern === 'AR-CONC' && t.hatch.solid === 0 && t.hatch.defs === 2, J(t.hatch));

  const r = await ev(async () => {
    const An = await import('./annot.js');
    const hdefs2 = [{ angle: 0, base: { x: 0, y: 0 }, offset: { x: 0, y: 7 }, dashLengths: [] }];
    const g = An.hatchEnts([[0, 0, 0], [100, 0, 0], [100, 60, 0], [0, 60, 0]], { pattern: 'AR-CONC', layer: '0', color: 1, gid: 'g9', hdefs: hdefs2 });
    return g ? { pattern: g.pattern, dosya: !!g.dosyaDeseni, n: g.ents.length, dustu: !!g.dustu } : null;
  });
  ok('6b budama / yeniden üretimde dosya deseni SOLID\'e düşmez, dokusuyla yeniden çizilir',
    !!r && r.pattern === 'AR-CONC' && r.dosya === true && r.n === 2 && r.dustu === false, J(r));
}

// ---------------------------------------------------------------------------------
// 7 · BLOK / PANO turu: tarama tarama olarak kalır (eskiden düz PATH'e düşüyordu)
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const A = window.dwgApp;
    const E = await import('./edit.js');
    const L = await import('./blocklib.js');
    const hrec = { style: 2, ptype: 1, dbl: 0, seeds: [[5, 5]] };
    const e0 = { id: 'hb1', type: 'HATCH', layer: '0', color: 1, pts: [[0, 0, 0], [100, 0, 0], [100, 60, 0], [0, 60, 0]], pattern: 'ANSI31', hscale: 3, hangle: 15, alpha: 0.18, gid: 'gb', hrec, hp: 3 };
    const p0 = E.entToPrim(e0, A.state.layers);
    const e1 = L.primToEnt(p0);                       // bloğa / panoya al
    const p1 = E.entToPrim({ ...e1, id: 'hb2' }, A.state.layers);   // geri koy
    return {
      tur: e1 && e1.type, et: p1 && p1.et, t: p1 && p1.info && p1.info.t,
      pattern: p1 && p1.info && p1.info.pattern, scale: p1 && p1.info && p1.info.hscale, angle: p1 && p1.info && p1.info.hangle,
      hrec: p1 && p1.info && p1.info.hrec ? p1.info.hrec.style : null, fill: !!(p1 && p1.fill),
    };
  });
  ok('7a bloğa / panoya alınan tarama HATCH türüyle gider, geri konduğunda da taramadır',
    r.tur === 'HATCH' && r.et === 'HATCH' && r.t === 'HATCH' && r.fill === true, J(r));
  ok('7b desen, ölçek, açı ve künye turdan sağ çıkar',
    r.pattern === 'ANSI31' && yak(r.scale, 3) && yak(r.angle, 15) && r.hrec === 2, J(r));

  // ve tur sonrası DXF hâlâ HATCH yazıyor
  const t = await ev(async () => {
    const A = window.dwgApp;
    const E = await import('./edit.js');
    const L = await import('./blocklib.js');
    const D = await import('./dxf.js');
    const e0 = { id: 'hb3', type: 'HATCH', layer: '0', color: 1, pts: [[0, 0, 0], [100, 0, 0], [100, 60, 0], [0, 60, 0]], pattern: 'ANSI31', hscale: 3, hangle: 15, alpha: 0.18 };
    const p1 = E.entToPrim({ ...L.primToEnt(E.entToPrim(e0, A.state.layers)), id: 'hb4' }, A.state.layers);
    const db = D.parseDxf(new TextEncoder().encode(E.writeDxf([p1], A.state.layers, { ltypes: A.state.ltypes, blocks: A.state.blocks })), {});
    const h = (db.entities || []).find(q => q.type === 'HATCH');
    return { var: !!h, pattern: h && h.patternName, defs: h ? (h.definitionLines || []).length : 0 };
  });
  ok('7c tur sonrası DXF hâlâ HATCH yazar (eskiden yalnız sınır çokgeni kalıyordu)', t.var && t.pattern === 'ANSI31' && t.defs >= 1, J(t));
}

// ---------------------------------------------------------------------------------
// 8 · Dolu (SOLID) tarama: 70 = 1, tanım satırı yok
// ---------------------------------------------------------------------------------
{
  const t = await turla([{ id: 'h10', type: 'HATCH', layer: '0', color: 1, pts: kare(0, 0, 40, 40), pattern: 'SOLID', alpha: 1 }]);
  ok('8a düz dolgu: 70 = 1 ve desen tanım satırı yazılmaz', !!t.hatch && t.hatch.solid === 1 && t.hatch.defs === 0, J(t.hatch));
  ok('8b düz dolgu DÖRTGENİ yine de HATCH olarak yazılır (SOLID varlığına düşürülmez)', !t.say.SOLID, J(t.say));
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
