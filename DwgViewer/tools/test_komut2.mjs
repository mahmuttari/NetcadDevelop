/*
 * v7.67 — sık kullanılan AutoCAD komutlarının eksikleri: POLYGON, DIVIDE / MEASURE, JOIN, MATCHPROP, STRETCH,
 * BOUNDARY, SELECTSIMILAR, CUTCLIP, HIDEOBJECTS / ISOLATEOBJECTS / UNISOLATEOBJECTS ve ZOOM seçenekleri (Z W / P / E / O / 2X).
 * Hepsi tarayıcıda, gerçek dokunuş ve komut satırıyla sınanır; sonuç çizimden (prims) okunur.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_komut2.mjs [çıktı] [örnekler]
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
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const tapWorld = async (x, y) => { await bekle(110); await temizle(); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(380); };
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const aktif = () => ev(() => window.dwgApp.editor.tools.active);
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, step: T.step, selecting: T.selecting, mode: T.selMode, sides: T.sides, text: document.getElementById('cmdText').textContent.trim(), sel: window.dwgApp.editor.sel.size }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, k: p.k, closed: !!p.closed, lay: p.lay, ci: p.info ? p.info.ci : null, ops: p.ops ? p.ops.map(o => o.slice()) : null, x: p.x, y: p.y, bb: p.bb }; });
const primOf = (key) => ev((k) => { const p = window.dwgApp.state.prims.find(q => q.key === k); return p ? { key: p.key, k: p.k, closed: !!p.closed, lay: p.lay, ci: p.info ? p.info.ci : null, lt: p.lt || '', ops: p.ops ? p.ops.map(o => o.slice()) : null, x: p.x, y: p.y } : null; }, key);
const yaz = async (v) => { await page.fill('#cmdInput', v); await bekle(100); };
const enter = async () => { await page.click('#cmdEnter'); await bekle(220); };
const komut = async (s) => { await yaz(s); await enter(); };
const bitir = async () => { await page.click('#cmdBtns [data-cmd="finish"]'); await bekle(250); };
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
/** Sentetik dokunma sürüklemesi (ekran koordinatı): seçim penceresi / kesen pencere */
const drag = async (pts) => {
  await ev((pts) => {
    const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
    const mk = (type, p) => new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    vp.dispatchEvent(mk('pointerdown', pts[0]));
    for (const p of pts.slice(1)) vp.dispatchEvent(mk('pointermove', p));
    vp.dispatchEvent(mk('pointerup', pts[pts.length - 1]));
  }, pts);
  await bekle(300);
};
/** Doğrudan çizime varlık ekler (sınama düzeneği): anahtarları döner */
const ekle = (ents) => ev((es) => {
  const E = window.dwgApp.editor, S = window.dwgApp.state;
  const n0 = S.prims.length;
  const NID = () => 'T' + Math.random().toString(36).slice(2, 10);
  E.runCmd({ op: 'add', ents: es.map(e => ({ ...e, id: e.id || NID(), layer: e.layer || '0', color: e.color == null ? 256 : e.color })) });
  return S.prims.slice(n0).map(p => p.key);
}, ents);
const secKeys = (keys) => ev((ks) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (ks.includes(p.key)) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, keys);
const katman = (name, color) => ev(([n, c]) => window.dwgApp.editor.runCmd({ op: 'layer', name: n, color: c }), [name, color]);
/** Çizimin tamamen dışında, boş bir dünya noktası (kapalı alan araması için) */
const bosNokta = () => ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });
const uzunluk = (ops) => { let L = 0; for (let i = 1; i < ops.length; i++) L += Math.hypot(ops[i][1] - ops[i - 1][1], ops[i][2] - ops[i - 1][2]); return L; };

await page.click('#toolbar [data-tab="draw"]');
await zoom([0, 0, 800, 600]);
const N0 = await count();

// ---------------------------------------------------------------------------------
// 1 · POLYGON: kenar sayısı → merkez → köşe; boş Enter öntanımlı 6; POL kısaltması; yazılan yarıçap
// ---------------------------------------------------------------------------------
{
  await komut('polygon');
  const d0 = await durum();
  ok('1a POLYGON aracı başlar, kenar sayısını sorar, istemde <6> öntanımlı', d0.active === 'polygon' && d0.step === 0 && /<6>/.test(d0.text), J(d0));
  await komut('5');
  const d1 = await durum();
  ok('1b "5" kenar sayısı alınır, merkez sorulur', d1.sides === 5 && d1.step === 1, J(d1));
  const n0 = await count();
  await tapWorld(200, 300);
  await tapWorld(300, 300);                                    // köşe: yarıçap 100, ilk köşe 0°'de
  const p = await sonPrim();
  ok('1c merkez + köşe dokunuşu: kapalı 5 köşeli polyline, ilk köşe dokunulan noktada', (await count()) === n0 + 1 && p.k === 0 && p.closed && p.ops.length === 5 && yak(p.ops[0][1], 300, 1e-3) && yak(p.ops[0][2], 300, 1e-3), J({ n: p.ops.length, closed: p.closed, ops: p.ops.slice(0, 2) }));
  const rs = p.ops.map(o => Math.hypot(o[1] - 200, o[2] - 300));
  ok('1d bütün köşeler merkeze 100 uzakta (çembere iç teğet)', rs.every(r => yak(r, 100, 1e-3)), J(rs));
  ok('1e araç sürer, yeniden kenar sayısını sorar, öntanımlı artık <5>', (await durum()).step === 0 && /<5>/.test((await durum()).text), J(await durum()));
  await shot('polygon');
  // yazılan yarıçap: merkez dokunuş, "50" Enter
  await enter();                                              // boş Enter: son kenar sayısı (5)
  await tapWorld(500, 300);
  await komut('50');
  const q = await sonPrim();
  ok('1f boş Enter son kenar sayısını alır; yarıçap yazılınca ilk köşe 0°de (550,300)', q.ops.length === 5 && yak(q.ops[0][1], 550, 1e-3) && yak(q.ops[0][2], 300, 1e-3), J(q.ops[0]));
  await iptal();
  await komut('pol'); await komut('2');
  ok('1g kenar sayısı 2 kabul edilmez (3-1024)', /3 ile 1024|between 3 and 1024/.test(await toast()) && (await durum()).step === 0, await toast());
  await iptal();
  // dokunuş kenar sayısı yazılmadan gelirse öntanımlı kenar sayısıyla merkezdir
  await arac('t:polygon'); const nA = await count();
  await tapWorld(100, 100); await tapWorld(130, 100);
  ok('1h kenar sayısı yazılmadan dokunuş: öntanımlı kenar (son değer 5) ile merkez alınır', (await count()) === nA + 1 && (await sonPrim()).ops.length === 5, J((await sonPrim()).ops.length));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 2 · DIVIDE / MEASURE: yol üzerine POINT nesneleri
// ---------------------------------------------------------------------------------
{
  const [kL] = await ekle([{ type: 'LINE', pts: [[100, 500, 0], [400, 500, 0]] }]);
  await komut('divide');
  ok('2a DIVIDE aracı başlar, yol ister', (await aktif()) === 'divide', String(await aktif()));
  await tapWorld(250, 500);
  const d1 = await durum();
  ok('2b yola dokununca parça sayısı sorulur (adım 1)', d1.step === 1 && d1.active === 'divide', J(d1));
  const n0 = await count();
  await komut('4');
  const pts = await ev((k) => window.dwgApp.state.prims.slice(-3).map(p => [p.k, p.x, p.y]), kL);
  ok('2c 4 parça → 3 iç nokta: x = 175, 250, 325 (y 500), POINT nesnesi', (await count()) === n0 + 3 && pts.every(p => p[0] === 2 && yak(p[2], 500, 1e-6)) && yak(pts[0][1], 175, 1e-6) && yak(pts[1][1], 250, 1e-6) && yak(pts[2][1], 325, 1e-6), J(pts));
  ok('2d ileti "3 nokta yerleştirildi"', /3 nokta|3 points/.test(await toast()), await toast());
  await tapWorld(200, 500); await komut('1');
  ok('2e 1 parça kabul edilmez (en az 2)', /En az 2|At least 2/.test(await toast()) && (await count()) === n0 + 3, await toast());
  await iptal();
  // MEASURE: dokunulan uca yakın taraftan başlar
  await komut('measure');
  ok('2f MEASURE (Aralıkla) aracı başlar', (await aktif()) === 'measure', String(await aktif()));
  const n1 = await count();
  await tapWorld(380, 500);                                    // sağ uca yakın: noktalar 400'den başlar geriye
  await komut('120');
  const mp = await ev(() => window.dwgApp.state.prims.slice(-2).map(p => [p.k, p.x, p.y]));
  ok('2g aralık 120, boy 300: 2 nokta; dokunulan (sağ) uçtan başlar → x = 280, 160', (await count()) === n1 + 2 && yak(mp[0][1], 280, 1e-6) && yak(mp[1][1], 160, 1e-6), J(mp));
  await tapWorld(120, 500); await komut('120');
  const mp2 = await ev(() => window.dwgApp.state.prims.slice(-2).map(p => [p.k, p.x, p.y]));
  ok('2h sol uca yakın dokunuş: 220, 340', yak(mp2[0][1], 220, 1e-6) && yak(mp2[1][1], 340, 1e-6), J(mp2));
  await tapWorld(120, 500); await komut('500');
  ok('2i aralık yoldan uzunsa nokta konmaz, uyarı', /uzun|longer/.test(await toast()) && (await count()) === n1 + 4, await toast());
  await iptal();
  // kapalı yolda DIVIDE n nokta (başlangıç köşesi dâhil)
  await ekle([{ type: 'LWPOLYLINE', closed: true, pts: [[500, 500, 0], [600, 500, 0], [600, 600, 0], [500, 600, 0]] }]);
  await komut('div'); await tapWorld(550, 500); const n2 = await count(); await komut('4');
  const cp = await ev(() => window.dwgApp.state.prims.slice(-4).map(p => [p.x, p.y]));
  ok('2j kapalı kare, 4 parça → 4 nokta (köşelerde)', (await count()) === n2 + 4 && cp.some(p => yak(p[0], 600) && yak(p[1], 500)) && cp.some(p => yak(p[0], 500) && yak(p[1], 600)), J(cp));
  await iptal();
  await shot('divide_measure');
}

// ---------------------------------------------------------------------------------
// 3 · JOIN: uçları değen parçalar tek yol; ters yönlü parça çevrilir; kapanan zincir kapalı olur; değmeyen dışarıda kalır
// ---------------------------------------------------------------------------------
{
  const ks = await ekle([
    { type: 'LINE', pts: [[100, 50, 0], [200, 50, 0]] },
    { type: 'LINE', pts: [[200, 50, 0], [200, 150, 0]] },
    { type: 'LINE', pts: [[100, 150, 0], [200, 150, 0]] },   // ters yönlü: (100,150)→(200,150); zincire çevrilerek girer
    { type: 'LINE', pts: [[700, 50, 0], [750, 90, 0]] },     // değmeyen
  ]);
  await komut('join');
  const d0 = await durum();
  ok('3a JOIN aracı seçimle başlar', d0.active === 'join' && d0.selecting, J(d0));
  await secKeys(ks);
  const n0 = await count();
  await bitir();
  const p = await sonPrim();
  ok('3b 3 parça tek yol oldu (4 op: moveTo + 3 lineTo), değmeyen parça duruyor, prim sayısı 4 → 2', (await count()) === n0 - 2 && p.k === 0 && p.ops.length === 4 && !p.closed, J({ n: await count(), n0, ops: p.ops }));
  const sira = p.ops.map(o => [o[1], o[2]]);
  ok('3c zincir sırası: (100,50)→(200,50)→(200,150)→(100,150) — üçüncü parça ters çevrildi', yak(sira[0][0], 100) && yak(sira[0][1], 50) && yak(sira[3][0], 100) && yak(sira[3][1], 150), J(sira));
  ok('3d ileti: "3 parça tek polyline oldu · 1 parça zincire girmedi"', /3 parça|3 pieces/.test(await toast()) && /1 parça|1 piece/.test(await toast()), await toast());
  ok('3e araç kapandı, seçim boş', (await aktif()) === null && (await durum()).sel === 0, J(await durum()));
  // kapanan zincir: dört kenar → kapalı polyline (son op düşer)
  const kk = await ekle([
    { type: 'LINE', pts: [[300, 50, 0], [400, 50, 0]] }, { type: 'LINE', pts: [[400, 50, 0], [400, 150, 0]] },
    { type: 'LINE', pts: [[400, 150, 0], [300, 150, 0]] }, { type: 'LINE', pts: [[300, 150, 0], [300, 50, 0]] },
  ]);
  await komut('j'); await secKeys(kk); await bitir();
  const q = await sonPrim();
  ok('3f başa dönen zincir KAPALI polyline olur (4 op, closed)', q.closed && q.ops.length === 4, J({ closed: q.closed, n: q.ops.length }));
  // yay ters çevirme: reverseOps birim sınaması (dışa açık)
  const rv = await ev(async () => { const T = await import('./tools.js'); const ops = [[0, 0, 0, 0], [2, 50, 0, 50, Math.PI, 0, 0]]; return T.reverseOps(ops); });
  ok('3g reverseOps: yay [2,…,a0,a1] → [-2,…,a1,a0], başlangıç yayın bitiş noktası (100,0)', rv.length === 2 && rv[0][0] === 0 && yak(rv[0][1], 100, 1e-9) && rv[1][0] === -2 && yak(rv[1][4], 0) && yak(rv[1][5], Math.PI), J(rv));
  // değmeyen iki parça: uyarı, çizim değişmez
  const kn = await ekle([{ type: 'LINE', pts: [[600, 300, 0], [650, 300, 0]] }, { type: 'LINE', pts: [[700, 300, 0], [750, 300, 0]] }]);
  await komut('join'); await secKeys(kn); const n3 = await count(); await bitir();
  ok('3h uçları değmeyen parçalar: "bulunamadı" uyarısı, çizim değişmez', /bulunamadı|No two paths/.test(await toast()) && (await count()) === n3, await toast());
  await iptal();
  await shot('join');
}

// ---------------------------------------------------------------------------------
// 4 · MATCHPROP: kaynak → hedefler (katman, renk, çizgi tipi); Bitir kapatır
// ---------------------------------------------------------------------------------
{
  await katman('KAYNAK', 1);
  const [kS, kT1, kT2] = await ekle([
    { type: 'LINE', pts: [[100, 400, 0], [200, 400, 0]], layer: 'KAYNAK', color: 3 },
    { type: 'LINE', pts: [[300, 400, 0], [400, 400, 0]] },
    { type: 'CIRCLE', pts: [[500, 400, 0]], r: 30 },
  ]);
  const t1 = await primOf(kT1);
  await komut('matchprop');
  ok('4a MATCHPROP (MA) aracı başlar, kaynak ister', (await aktif()) === 'matchprop' && (await durum()).step === 0, J(await durum()));
  await tapWorld(150, 400);
  const d1 = await durum();
  ok('4b kaynağa dokununca ileti kaynağın katmanını söyler, adım 1, Bitir düğmesi var', d1.step === 1 && /KAYNAK/.test(await toast()) && await ev(() => !!document.querySelector('#cmdBtns [data-cmd="finish"]')), J({ d1, t: await toast() }));
  await tapWorld(350, 400);
  const t1b = await primOf(kT1);
  ok('4c hedef çizgi kaynağın katman ve rengini aldı (KAYNAK, renk 3)', t1.lay !== 'KAYNAK' && t1b.lay === 'KAYNAK' && t1b.ci === 3, J({ once: t1, sonra: t1b }));
  await tapWorld(530, 400);
  const t2 = await primOf(kT2);
  ok('4d ikinci hedef (daire) de aldı; araç sürer', t2.lay === 'KAYNAK' && (await aktif()) === 'matchprop', J({ t2, a: await aktif() }));
  await bitir();
  ok('4e Bitir: eşleme biter, araç kapanır', (await aktif()) === null, String(await aktif()));
  const kaynak = await primOf(kS);
  ok('4f kaynağın kendisi değişmedi', kaynak.lay === 'KAYNAK' && kaynak.ci === 3, J(kaynak));
}

// ---------------------------------------------------------------------------------
// 5 · STRETCH: kesen pencere içindeki köşe taşınır, dışındaki durur; tamamı içerde olan nesne bütün taşınır
// ---------------------------------------------------------------------------------
{
  const [kL, kC] = await ekle([
    { type: 'LINE', pts: [[100, 250, 0], [300, 250, 0]] },
    { type: 'CIRCLE', pts: [[280, 200, 0]], r: 10 },          // tamamı pencerede: bütün taşınır
  ]);
  await komut('stretch');
  const d0 = await durum();
  ok('5a STRETCH (S) aracı doğrudan pencere kipinde başlar (kesen pencere ister)', d0.active === 'stretch' && d0.selecting && d0.mode === 'box', J(d0));
  // sağdan sola kesen pencere: sağ ucu (300,250) ve daireyi sarar, sol ucu dışarıda bırakır
  const a = await scr(330, 280), b = await scr(250, 180);
  await drag([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b]);
  const d1 = await durum(), sk = await ev(() => [...window.dwgApp.editor.sel].map(p => p.key));
  ok('5b kesen pencere iki nesneyi seçti (çizgi kesiyor, daire içerde)', sk.includes(kL) && sk.includes(kC) && d1.selecting, J({ d1, sk }));
  await bitir();
  const d2 = await durum();
  ok('5c Bitir: taban noktası sorulur', !d2.selecting && d2.step === 1, J(d2));
  await tapWorld(280, 200);
  await tapWorld(330, 240);                                    // +50, +40
  const L = await primOf(kL), Cc = await primOf(kC);
  ok('5d çizginin pencere içindeki ucu (300,250)→(350,290) taşındı, dışındaki (100,250) yerinde', yak(L.ops[0][1], 100, 1e-6) && yak(L.ops[0][2], 250, 1e-6) && yak(L.ops[1][1], 350, 1e-3) && yak(L.ops[1][2], 290, 1e-3), J(L.ops));
  ok('5e tamamı pencerede olan daire bütün olarak taşındı (merkez 330,240)', Cc.ops.some(o => (o[0] === 2 || o[0] === -2) && yak(o[1], 330, 1e-3) && yak(o[2], 240, 1e-3)), J(Cc.ops));
  ok('5f araç kapandı, "Esnet uygulandı" iletisi', (await aktif()) === null && /Esnet|Stretch/.test(await toast()), await toast());
  // geri al tek adımdır (group)
  await ev(() => window.dwgApp.editor.act('undo')); await bekle(200);
  const L2 = await primOf(kL), C2 = await primOf(kC);
  ok('5g tek geri alma ikisini de eski yerine getirir', yak(L2.ops[1][1], 300, 1e-6) && C2.ops.some(o => (o[0] === 2 || o[0] === -2) && yak(o[1], 280, 1e-6)), J({ L: L2.ops[1], C: C2.ops[0] }));
  // @dx,dy ile hedef
  await komut('stretch');
  const a2 = await scr(330, 280), b2 = await scr(250, 180);
  await drag([a2, [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2], b2]);
  await bitir(); await tapWorld(280, 200); await komut('@0,-30');
  const L3 = await primOf(kL);
  ok('5h hedef @0,-30 ile: iç uç (300,220)', yak(L3.ops[1][1], 300, 1e-3) && yak(L3.ops[1][2], 220, 1e-3), J(L3.ops));
  await iptal();
  await shot('stretch');
}

// ---------------------------------------------------------------------------------
// 6 · BOUNDARY: kapalı alanın içine dokunuş → yeni kapalı polyline (geçerli katmanda)
// ---------------------------------------------------------------------------------
{
  await ekle([{ type: 'LWPOLYLINE', closed: true, pts: [[600, 100, 0], [700, 100, 0], [700, 200, 0], [600, 200, 0]] }]);
  await komut('boundary');
  ok('6a BOUNDARY (BO) aracı başlar', (await aktif()) === 'boundary', String(await aktif()));
  const n0 = await count();
  await tapWorld(650, 150);
  const p = await sonPrim();
  ok('6b karenin içine dokunuş: 4 köşeli kapalı polyline eklendi, ileti alanı söyler (10000)', (await count()) === n0 + 1 && p.k === 0 && p.closed && p.ops.length === 4 && /Sınır|Boundary/.test(await toast()) && /10[ .]?000/.test(await toast()), J({ ops: p.ops, t: await toast() }));
  ok('6c köşeler karenin köşeleri', [[600, 100], [700, 100], [700, 200], [600, 200]].every(c => p.ops.some(o => yak(o[1], c[0], 1e-6) && yak(o[2], c[1], 1e-6))), J(p.ops));
  ok('6d araç sürer', (await aktif()) === 'boundary', String(await aktif()));
  const bn = await bosNokta();
  await zoom([bn[0] - 200, bn[1] - 200, bn[0] + 200, bn[1] + 200]);
  await tapWorld(bn[0], bn[1]);
  ok('6e boş yere dokunuş: "kapalı alan bulunamadı" uyarısı, çizim değişmez', (await count()) === n0 + 1 && (await toast()).length > 0, await toast());
  await iptal();
  await zoom([0, 0, 800, 600]);
}

// ---------------------------------------------------------------------------------
// 7 · SELECTSIMILAR, HIDEOBJECTS / ISOLATEOBJECTS / UNISOLATEOBJECTS, CUTCLIP
// ---------------------------------------------------------------------------------
{
  await katman('BENZER', 2);
  const ks = await ekle([
    { type: 'CIRCLE', pts: [[100, 700, 0]], r: 20, layer: 'BENZER' },
    { type: 'CIRCLE', pts: [[200, 700, 0]], r: 20, layer: 'BENZER' },
    { type: 'CIRCLE', pts: [[300, 700, 0]], r: 20, layer: 'BENZER' },
    { type: 'LINE', pts: [[100, 760, 0], [300, 760, 0]], layer: 'BENZER' },   // aynı katman, başka tür: seçilmez
    { type: 'CIRCLE', pts: [[400, 700, 0]], r: 20 },                              // aynı tür, başka katman: seçilmez
  ]);
  await zoom([0, 0, 800, 800]);
  await secKeys([ks[0]]);
  await komut('selectsimilar');
  const s1 = await ev(() => [...window.dwgApp.editor.sel].map(p => p.key));
  ok('7a SELECTSIMILAR: aynı tür + aynı katman (3 daire) seçilir; çizgi ve öteki katman dışarıda', s1.length === 3 && ks.slice(0, 3).every(k => s1.includes(k)) && !s1.includes(ks[3]) && !s1.includes(ks[4]), J({ s1, ks }));
  ok('7b ileti "2 benzer nesne seçime eklendi"', /2 benzer|2 similar/.test(await toast()), await toast());
  // gizle
  await komut('hideobjects');
  const h = await ev(() => ({ n: window.dwgApp.state.hideObj.size, sel: window.dwgApp.editor.sel.size, iso: window.dwgApp.state.isoObj }));
  ok('7c HIDEOBJECTS: 3 nesne gizlendi, seçim boşaldı, ileti geri alma düğmesi taşır', h.n === 3 && h.sel === 0 && h.iso === null && /3 nesne gizlendi|3 objects hidden/.test(await toast()) && await ev(() => { const a = document.querySelector('#toast .act'); return !!a && !a.hidden; }), J({ h, t: await toast() }));
  const gizliPick = await ev((k) => ({ vis: window.dwgApp.editor.tools.api.visiblePrims().some(q => q.key === k), sec: window.dwgApp.editor.tools.api.selectable().some(q => q.key === k) }), ks[0]);
  ok('7d gizli nesne görünür ve seçilebilir listelerde değil (çizilmez, pencereyle seçilmez)', gizliPick.vis === false && gizliPick.sec === false, J(gizliPick));
  await arac('t:select'); await tapWorld(100, 700); const selGizli = await ev(() => window.dwgApp.editor.sel.size); await iptal();
  ok('7e gizli daireye dokunuş onu seçmez', selGizli === 0, String(selGizli));
  await komut('unisolateobjects');
  ok('7f UNISOLATEOBJECTS: hepsi geri gelir', await ev(() => window.dwgApp.state.hideObj.size === 0 && window.dwgApp.state.isoObj === null) && /Bütün nesneler|All objects/.test(await toast()), await toast());
  // izole et
  await secKeys([ks[3]]);
  await komut('isolateobjects');
  const iso = await ev(() => ({ iso: window.dwgApp.state.isoObj ? [...window.dwgApp.state.isoObj] : null, vis: window.dwgApp.editor.tools.api.visiblePrims().length }));
  ok('7g ISOLATEOBJECTS: yalnız seçili çizgi görünür kalır', iso.iso && iso.iso.length === 1 && iso.iso[0] === ks[3] && iso.vis === 1 && /1 nesne izole|1 objects isolated/.test(await toast()), J({ iso, t: await toast() }));
  await shot('isolate');
  await ev(() => window.dwgApp.editor.act('unisoobj')); await bekle(200);
  ok('7h "Hepsini göster" karosu izolasyonu kaldırır', await ev(() => window.dwgApp.state.isoObj === null && window.dwgApp.editor.tools.api.visiblePrims().length > 5));
  // yeni dosya açılınca gizleme sıfırlanır: setScene sıfırlar (durum nesnesine bakılır)
  await secKeys([ks[4]]); await komut('hideobjects');
  ok('7i ikinci gizleme birikir (1 nesne gizli)', await ev(() => window.dwgApp.state.hideObj.size === 1));
  await komut('unhide');
  ok('7j UNHIDE kısaltması geri getirir', await ev(() => window.dwgApp.state.hideObj.size === 0));
  // seçim menüsü kartları
  await secKeys([ks[0]]); await ev(() => window.dwgApp.editor.selMenu()); await bekle(200);
  const kart = await ev(() => [...document.querySelectorAll('#docBody .sel-grid .os-card span')].map(s => s.textContent.trim()));
  ok('7k seçim menüsünde Benzerini seç · Gizle · İzole et · Kes kartları var', ['Benzerini seç', 'Gizle', 'İzole et', 'Kes'].every(k => kart.includes(k)), J(kart));
  await ev(() => window.dwgApp.onBack()); await bekle(150);
  await iptal();
  // CUTCLIP: panoya kopyalar + siler
  await secKeys([ks[4]]); const n0 = await count();
  await komut('cutclip'); await bekle(400);
  const clip = await ev(() => { try { return Object.keys(localStorage).some(k => /clipboard$/.test(k) && /"ents"/.test(localStorage.getItem(k) || '')); } catch (e) { return false; } });
  ok('7l CUTCLIP: nesne silindi, ileti "Kesildi: 1 nesne panoda", pano dolu', (await count()) === n0 - 1 && /Kesildi|Cut:/.test(await toast()) && clip, J({ n: await count(), n0, t: await toast(), clip }));
  await ev(() => window.dwgApp.editor.act('undo')); await bekle(200);
  ok('7m geri al: kesilen nesne döner', (await count()) === n0, String(await count()));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 8 · ZOOM seçenekleri: Z 2X · Z 0.5X · Z E · Z O · Z P · Z W · hatalı seçenek
// ---------------------------------------------------------------------------------
{
  await zoom([0, 0, 800, 600]);
  const s0 = await ev(() => window.dwgApp.state.view.scale);
  await komut('z 2x');
  const s1 = await ev(() => window.dwgApp.state.view.scale);
  ok('8a "Z 2X" ölçeği iki katına çıkarır', yak(s1 / s0, 2, 1e-6) && (await aktif()) === null, J({ s0, s1 }));
  await komut('zoom 0.5x');
  const s2 = await ev(() => window.dwgApp.state.view.scale);
  ok('8b "ZOOM 0.5X" yarıya indirir', yak(s2 / s0, 1, 1e-6), J({ s0, s2 }));
  await komut('z p');
  const s3 = await ev(() => window.dwgApp.state.view.scale);
  ok('8c "Z P" önceki görünüme döner (ölçek yeniden 2x)', yak(s3 / s0, 2, 1e-6), J({ s0, s3 }));
  await komut('z e');
  const bb = await ev(() => { const S = window.dwgApp.state; return { scale: S.view.scale, prims: S.prims.length }; });
  ok('8d "Z E" sınırlara sığdırır (ölçek değişti, araç yok)', bb.scale !== s3 && (await aktif()) === null, J(bb));
  // Z O: seçili nesneye
  const [kO] = await ekle([{ type: 'CIRCLE', pts: [[50, 50, 0]], r: 5 }]);
  await secKeys([kO]); await komut('z o');
  const c = await ev(() => { const S = window.dwgApp.state; const s = window.dwgApp.toScreen(50, 50); return { sx: s[0], sy: s[1], W: S.W, H: S.H, scale: S.view.scale }; });
  ok('8e "Z O" seçili daireyi ekranın ortasına getirir', Math.abs(c.sx - c.W / 2) < 4 && Math.abs(c.sy - c.H / 2) < 40 && c.scale > bb.scale, J(c));
  await iptal();
  await komut('z o');
  ok('8f seçim yokken "Z O" uyarır', (await toast()).length > 0, await toast());
  await komut('z w');
  const zw = await ev(() => ({ bar: !document.getElementById('cmdBar').hidden, text: document.getElementById('cmdText').textContent }));
  ok('8g "Z W" pencere yakınlaştırmasını başlatır (istem: köşeleri sürükleyin)', zw.bar && /Pencere|Window/.test(zw.text), J(zw));
  await ev(() => window.dwgApp.onBack()); await bekle(200);
  ok('8g2 geri tuşu pencere yakınlaştırmasını iptal eder', await ev(() => document.getElementById('cmdInput').hidden === false || document.getElementById('cmdBar').hidden), await ev(() => document.getElementById('cmdText').textContent));
  await komut('z q');
  ok('8h hatalı seçenek: "ZOOM seçeneği: W, P, E, A, O ya da 2X" uyarısı', /ZOOM seçeneği|ZOOM option/.test(await toast()), await toast());
  await komut('zoom');
  ok('8i seçeneksiz ZOOM sınırlara sığdırır (eski davranış)', (await aktif()) === null, String(await aktif()));
}

// ---------------------------------------------------------------------------------
// 9 · Komut tablosu: yeni kayıtlar, kısaltmalar, sayılar
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const A = await import('./acad.js');
    const id = (n) => { const c = A.resolve(n); return c ? c.id : undefined; };
    return {
      hata: A.dogrula(), st: A.stats(),
      POLYGON: id('POLYGON'), POL: id('POL'), BOUNDARY: id('BOUNDARY'), BO: id('BO'), DIVIDE: id('DIVIDE'), DIV: id('DIV'), MEASURE: id('MEASURE'), ME: id('ME'),
      STRETCH: id('STRETCH'), S: id('S'), JOIN: id('JOIN'), J: id('J'), MATCHPROP: id('MATCHPROP'), MA: id('MA'), SELECTSIMILAR: id('SELECTSIMILAR'), QSELECT: id('QSELECT'),
      HIDEOBJECTS: id('HIDEOBJECTS'), ISOLATEOBJECTS: id('ISOLATEOBJECTS'), ISOLATE: id('ISOLATE'), UNISOLATEOBJECTS: id('UNISOLATEOBJECTS'), UNHIDE: id('UNHIDE'), CUTCLIP: id('CUTCLIP'),
      LENGTHEN: id('LENGTHEN'), LEN: id('LEN'), RENAME: id('RENAME'), REN: id('REN'), DDVPOINT: id('DDVPOINT'), VP: id('VP'), GEOMARKME: id('GEOMARKME'),
      zoomNote: (A.resolve('ZOOM') || {}).note || '',
    };
  });
  ok('9a tablo sağlıklı (dogrula boş)', Array.isArray(g.hata) && g.hata.length === 0, J(g.hata));
  ok('9b sayılar: 487 kayıt · 175 AutoCAD · 31 özgü · 281 bulunmayan · 731 ad', g.st.total === 487 && g.st.acad === 175 && g.st.ext === 31 && g.st.known === 281 && g.st.names === 731, J(g.st));
  ok('9c çizim komutları: POLYGON/POL, BOUNDARY/BO, DIVIDE/DIV, MEASURE/ME', g.POLYGON === 't:polygon' && g.POL === 't:polygon' && g.BOUNDARY === 't:boundary' && g.BO === 't:boundary' && g.DIVIDE === 't:divide' && g.DIV === 't:divide' && g.MEASURE === 't:measure' && g.ME === 't:measure', J(g));
  ok('9d düzenleme komutları: STRETCH/S, JOIN/J, MATCHPROP/MA, LENGTHEN/LEN→uzat', g.STRETCH === 't:stretch' && g.S === 't:stretch' && g.JOIN === 't:join' && g.J === 't:join' && g.MATCHPROP === 't:matchprop' && g.MA === 't:matchprop' && g.LENGTHEN === 't:extend' && g.LEN === 't:extend', J(g));
  ok('9e seçim / görünürlük: SELECTSIMILAR, QSELECT, HIDEOBJECTS, ISOLATEOBJECTS/ISOLATE, UNISOLATEOBJECTS/UNHIDE, CUTCLIP', g.SELECTSIMILAR === 'selectsimilar' && g.QSELECT === 'selectsimilar' && g.HIDEOBJECTS === 'hideobj' && g.ISOLATEOBJECTS === 'isoobj' && g.ISOLATE === 'isoobj' && g.UNISOLATEOBJECTS === 'unisoobj' && g.UNHIDE === 'unisoobj' && g.CUTCLIP === 'cutclip', J(g));
  ok('9f eş anlamlılar: RENAME/REN→katmanlar, DDVPOINT/VP→izometrik, GEOMARKME→GPS; ZOOM notu seçenekleri sayar', g.RENAME === 'layers' && g.REN === 'layers' && g.DDVPOINT === 'v:iso' && g.VP === 'v:iso' && g.GEOMARKME === 'gps' && /W|P|E/.test(g.zoomNote), J({ RENAME: g.RENAME, VP: g.VP, GEOMARKME: g.GEOMARKME, note: g.zoomNote }));
  // karolar: çizim ve düzenleme sekmelerinde yeni karolar
  const karo = await ev(() => { const acts = [...document.querySelectorAll('#toolbar [data-act]')].map(b => b.dataset.act); return ['t:polygon', 't:divide', 't:measure', 't:boundary', 't:stretch', 't:join', 't:matchprop', 'selectsimilar', 'hideobj', 'isoobj', 'unisoobj', 'cutclip'].map(a => [a, acts.includes(a)]); });
  ok('9g 12 yeni karo araç çubuğunda', karo.every(k => k[1]), J(karo.filter(k => !k[1])));
  // İngilizce arayüzde karo etiketi AutoCAD komut adı
  const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);
  await dil('en'); await bekle(200);
  const en = await ev(() => Object.fromEntries(['t:polygon', 't:stretch', 't:join', 't:matchprop', 't:divide', 't:boundary'].map(a => { const b = document.querySelector(`#toolbar [data-act="${a}"] .lb`); return [a, b ? b.textContent.trim() : null]; })));
  ok('9h İngilizce etiketler AutoCAD adları: POLYGON, STRETCH, JOIN, MATCHPROP, DIVIDE, BOUNDARY', en['t:polygon'] === 'POLYGON' && en['t:stretch'] === 'STRETCH' && en['t:join'] === 'JOIN' && en['t:matchprop'] === 'MATCHPROP' && en['t:divide'] === 'DIVIDE' && en['t:boundary'] === 'BOUNDARY', J(en));
  await dil('tr'); await bekle(150);
}

ok('X sayfa hatası yok', errors.length === 0, J(errors.slice(0, 3)));
await shot('son');
await browser.close(); await srv.kill();
C.summary(); C.exit();
