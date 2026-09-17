/*
 * v7.70 — NESNE YAKALAMA İZLEMEDE UZANTI YOLLARI (AutoCAD Extension / EXT): edinilen nokta bir çizginin ucuysa o çizginin
 * doğrultusu (uçtan dışarı) yoldur, yayın ucuysa çemberi yoldur. Açılı çizginin uzantısı, iki uzantının kesişimi, uzantı ×
 * çember kesişimi, uzantının gerçek bir nesneyi kestiği nokta (genişletilmiş kesişim, INT ile) ve EXT kipine bağlılık.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_izleme2.mjs [çıktı] [örnekler]
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

const bekle = (ms = 150) => page.waitForTimeout(ms);
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); window.dwgApp.__trackClear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const track = () => ev(() => window.dwgApp.__track());
const kalem = (type, x, y, buttons = 0) => ev(([t, x, y, b]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: b ? 0 : -1, buttons: b, pressure: b ? 0.5 : 0 })); }, [type, x, y, buttons]);
const gez = async (wx, wy, ms = 220) => { const s = await scr(wx, wy); await kalem('pointermove', s[0], s[1]); await bekle(ms); return s; };
const dokun = async (wx, wy) => { const s = await scr(wx, wy); await kalem('pointerdown', s[0], s[1], 1); await bekle(60); await kalem('pointerup', s[0], s[1], 0); await bekle(420); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e) => ({ layer: '0', color: 256, ...e })) }); window.dwgApp.requestRender(); }, ents);
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, ops: p.ops.map(o => o.slice()) }; });
const modes = () => ev(() => [...window.dwgApp.state.snapModes].sort().join(','));

// ---------------------------------------------------------------------------------
// 0 · Saf modül: doğrultu yolları, iki uzantının kesişimi, çember yolu, doğru × çember, EXT kapalıyken yok
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const T = await import('./otrack.js');
    const deg1 = Math.atan2(150, 200) * 180 / Math.PI;                         // (100,100) → (300,250): 36,87°
    let L = T.toggle([], [300, 250], 'end', { dirs: [deg1], arcs: [] }).list;
    const ext = T.align(L, [503, 398], 10, T.angles(false), null, { ext: true });
    const kapali = T.align(L, [503, 398], 10, T.angles(false), null, { ext: false });
    const geri = T.align(L, [200, 175], 10, T.angles(false), null, { ext: true });   // parçanın kendi üstü: uzantı yalnız dışa doğru
    const L2 = T.toggle(L, [400, 300], 'end', { dirs: [135], arcs: [] }).list;     // (600,100) → (400,300) doğrultusu
    const kes = T.align(L2, [386, 314], 10, T.angles(false), null, { ext: true });
    const L3 = T.toggle([], [800, 500], 'end', { dirs: [], arcs: [{ c: [700, 500], r: 100 }] }).list;
    const cem = T.align(L3, [786, 452], 10, T.angles(false), null, { ext: true });
    const L4 = T.toggle(L3, [650, 420], 'end', { dirs: [0], arcs: [] }).list;
    const dc = T.align(L4, [759, 421], 10, T.angles(false), null, { ext: true });
    return { dirs: L[0].dirs, ext, kapali, geri, kes, cem, dc };
  });
  ok('0a edinilen nokta doğrultusunu taşır (36,87°); açılı uzantı: imleç (503,398) → doğrultu üstüne izdüşüm, EXT yolu', yak(r.dirs[0], 36.8698976, 1e-6) && r.ext && r.ext.paths[0].ext === true && yak(r.ext.p[0] - 300, (r.ext.p[1] - 250) * 200 / 150, 1e-9) && yak(r.ext.paths[0].deg, 36.8698976, 1e-6), J(r.ext));
  ok('0b EXT kipi kapalıyken uzantı yolu yok (yalnız dik yollar, onlar da uzak) → null', r.kapali === null, J(r.kapali));
  ok('0c uzantı yalnız uçtan dışarı: parçanın kendi üstündeki imleç yol vermez', r.geri === null, J(r.geri));
  ok('0d iki açılı uzantının kesişimi: (385,71, 314,29), iki EXT yolu', r.kes && r.kes.cross && yak(r.kes.p[0], 385.7142857, 1e-6) && yak(r.kes.p[1], 314.2857143, 1e-6) && r.kes.paths.length === 2 && r.kes.paths.every(p => p.ext), J(r.kes));
  ok('0e yayın ucu: çember yolu — imleç (786,452) çembere ışınsal oturur (r = 100), açı yok', r.cem && !r.cem.cross && yak(Math.hypot(r.cem.p[0] - 700, r.cem.p[1] - 500), 100, 1e-9) && r.cem.paths[0].arc && r.cem.paths[0].deg === null, J(r.cem));
  ok('0f doğrultu × çember kesişimi: y = 420 uzantısı çemberi (760,420)\'de keser', r.dc && r.dc.cross && yak(r.dc.p[0], 760, 1e-9) && yak(r.dc.p[1], 420, 1e-9), J(r.dc));
}

// ---------------------------------------------------------------------------------
// 1 · Uygulama: açılı çizgiler, edinme doğrultuyu bulur, gezinen kalem uzantıya / kesişime oturur, dokunuş oraya çizer
// ---------------------------------------------------------------------------------
{
  await ekle([
    { id: 'iz_1', type: 'LINE', pts: [[100, 100, 0], [300, 250, 0]] },
    { id: 'iz_2', type: 'LINE', pts: [[700, 100, 0], [500, 300, 0]] },   // kesişim (442,86, 357,14): uçlardan açıklık kadar uzak, uç yakalaması yolu bastırmaz
    { id: 'iz_3', type: 'LINE', pts: [[600, 0, 0], [600, 600, 0]] },
    { id: 'iz_a', type: 'ARC', pts: [[700, 500, 0]], r: 100, a0: 0, a1: Math.PI / 2 },
    { id: 'iz_4', type: 'LINE', pts: [[600, 420, 0], [650, 420, 0]] },
  ]);
  await zoom([0, 0, 900, 700]);
  ok('1a varsayılan kipler EXT içerir (AutoCAD OSMODE 4133 gibi)', /(^|,)ext(,|$)/.test(await modes()), await modes());
  await page.click('#toolbar [data-tab="draw"]'); await arac('t:line');
  await ev(() => window.dwgApp.__trackAdd(300, 250, 'end'));
  const t1 = await track();
  ok('1b edinilen uç, çizginin doğrultusunu taşır (36,87°)', t1.pts.length === 1 && t1.pts[0].dirs.length === 1 && yak(t1.pts[0].dirs[0], 36.8698976, 1e-4), J(t1.pts));
  await gez(503, 398);
  const h1 = (await track()).hover;
  ok('1c gezinen kalem açılı uzantıya oturur: nokta doğrultu üstünde, EXT yolu, ipucu "EXT … < 37°"', h1 && h1.ext[0] === true && yak(h1.p[0] - 300, (h1.p[1] - 250) * 200 / 150, 1e-6) && /EXT/.test(h1.text) && /37°/.test(h1.text), J(h1));
  await page.screenshot({ path: `${out}/uzanti.png` });
  await ev(() => window.dwgApp.__trackAdd(500, 300, 'end'));
  await gez(444, 356);
  const h2 = (await track()).hover;
  ok('1d iki açılı çizginin doğrultuları kesişiyor: (442,86, 357,14), iki EXT yolu', h2 && h2.cross && h2.n === 2 && h2.ext.every(Boolean) && yak(h2.p[0], 442.8571429, 1e-6) && yak(h2.p[1], 357.1428571, 1e-6), J(h2));
  await page.screenshot({ path: `${out}/uzanti_kesisim.png` });
  await dokun(100, 500);
  await ev(() => { window.dwgApp.__trackAdd(300, 250, 'end'); window.dwgApp.__trackAdd(500, 300, 'end'); });   // dokunuş iz noktalarını temizler (AutoCAD); yeniden edin
  await gez(444, 356);
  await dokun(444, 356);
  const p = await sonPrim();
  ok('1e dokunuş kesişime TAM oturur: çizginin ucu (442,857143, 357,142857)', yak(p.ops[1][1], 442.8571429, 1e-6) && yak(p.ops[1][2], 357.1428571, 1e-6), J(p.ops));
  await iptal(); await arac('t:line');
  // genişletilmiş kesişim: uzantının gerçek bir nesneyi (düşey çizgi x = 450) kestiği nokta
  await ev(() => window.dwgApp.__trackAdd(300, 250, 'end'));
  await gez(602, 473);
  const h3 = (await track()).hover;
  ok('1f uzantı gerçek bir çizgiyi kesiyor (x = 600): (600, 475), "× INT"', h3 && h3.cross && h3.obj && yak(h3.p[0], 600, 1e-6) && yak(h3.p[1], 475, 1e-6) && /× INT/.test(h3.text), J(h3));
  // yay: ucu edinilince çemberi yoldur; doğrultu × çember
  await iptal(); await arac('t:line');
  await ev(() => window.dwgApp.__trackAdd(800, 500, 'end'));
  const t4 = await track();
  ok('1g yayın ucu edinilince çemberi (merkez (700,500), r 100) yol olur', t4.pts[0].arcs.length === 1 && yak(t4.pts[0].arcs[0].r, 100, 1e-6) && yak(t4.pts[0].arcs[0].c[0], 700, 1e-6), J(t4.pts[0]));
  await gez(786, 452);
  const h4 = (await track()).hover;
  ok('1h kalem çemberin devamına oturur (r = 100), yol çember', h4 && h4.arc[0] === true && yak(Math.hypot(h4.p[0] - 700, h4.p[1] - 500), 100, 1e-6), J(h4));
  await ev(() => window.dwgApp.__trackAdd(650, 420, 'end'));
  await gez(759, 421);
  const h5 = (await track()).hover;
  ok('1i yatay çizginin uzantısı çemberi (760,420)\'de keser', h5 && h5.cross && yak(h5.p[0], 760, 1e-6) && yak(h5.p[1], 420, 1e-6), J(h5));
  await page.screenshot({ path: `${out}/uzanti_cember.png` });
  // EXT kapalı: uzantı yolu yok
  await iptal(); await arac('t:line');
  await ev(() => window.dwgApp.osnap.setModes(['end', 'int']));
  await ev(() => window.dwgApp.__trackAdd(300, 250, 'end'));
  await gez(503, 398);
  const h6 = (await track()).hover;
  ok('1j EXT kipi kapalıyken açılı uzantı yolu yok (AutoCAD: uzantı EXT yakalamasına bağlı)', h6 === null, J(h6));
  await ev(() => window.dwgApp.osnap.setModes(window.dwgApp.osnap.DEFAULT_MODES));
  await gez(503, 398);
  ok('1k varsayılan kipler geri gelince uzantı yolu yeniden var', (await track()).hover !== null);
  await iptal();
}

ok('X sayfa hatası yok', errors.length === 0, J(errors.slice(0, 3)));
await browser.close(); await srv.kill();
C.summary(); C.exit();
