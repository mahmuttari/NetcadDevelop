/*
 * v7.71 — DİNAMİK OKUMA: çizim yaparken taban noktadan (ilk dokunulan nokta) imlece uzaklık ve açı, imleç etiketinde
 * ("↔ 360,56 ∠ 33,69°") ve lastik bantla; taban yokken yalnız koordinat; ölçüm kipinde önceki noktadan.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_okuma.mjs [çıktı] [örnekler]
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
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const kalem = (type, x, y, buttons = 0) => ev(([t, x, y, b]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: b ? 0 : -1, buttons: b, pressure: b ? 0.5 : 0 })); }, [type, x, y, buttons]);
const gez = async (wx, wy, ms = 220) => { const s = await scr(wx, wy); await kalem('pointermove', s[0], s[1]); await bekle(ms); return s; };
const dokun = async (wx, wy) => { const s = await scr(wx, wy); await kalem('pointerdown', s[0], s[1], 1); await bekle(60); await kalem('pointerup', s[0], s[1], 0); await bekle(420); };
const okuma = () => ev(() => window.dwgApp.__hoverLabel());

await zoom([0, 0, 900, 700]);
await page.click('#toolbar [data-tab="draw"]'); await arac('t:line');
await gez(500, 400);
const r0 = await okuma();
ok('1 taban nokta yokken etiket yalnız koordinat: "500 ; 400", uzaklık / açı yok', r0 && /^500(,00)? ; 400(,00)?$/.test(r0.text.trim()) && r0.base === null && r0.L == null, J(r0));
await dokun(200, 200);
await gez(500, 400);
const r1 = await okuma();
ok('2 ilk noktadan sonra: "↔ 360,56 ∠ 33,69°" — uzaklık 360,555, açı 33,69°', r1 && yak(r1.L, 360.5551275, 1e-3) && yak(r1.deg, 33.69, 0.01) && /↔ 360[,.]5/.test(r1.text) && /∠ 33[,.]69°/.test(r1.text) && r1.base && yak(r1.base[0], 200, 1e-6), J(r1));
await page.screenshot({ path: `${out}/okuma.png` });
await gez(200, 600);
const r2 = await okuma();
ok('3 düşey yukarı: uzaklık 400, açı 90°', r2 && yak(r2.L, 400, 1e-3) && yak(r2.deg, 90, 0.01), J(r2));
await gez(50, 200);
const r3 = await okuma();
ok('4 sola: açı 180°; sol alta 225°', r3 && yak(r3.L, 150, 1e-3) && yak(r3.deg, 180, 0.01), J(r3));
await gez(100, 100);
const r4 = await okuma();
ok('5 sol alta: 225°, uzaklık 141,42', r4 && yak(r4.deg, 225, 0.01) && yak(r4.L, 141.4213562, 1e-3), J(r4));
await dokun(500, 400);
await gez(500, 700);
const r5 = await okuma();
ok('6 ikinci nokta girilince taban ona geçer (500,400): 300 ∠ 90°', r5 && r5.base && yak(r5.base[0], 500, 1e-6) && yak(r5.L, 300, 1e-3) && yak(r5.deg, 90, 0.01), J(r5));
await iptal();
await gez(500, 700);
const r6 = await okuma();
ok('7 araç bitince okuma kalmaz', !r6 || (r6.base === null && r6.L == null), J(r6));
// ölçüm kipi: önceki ölçüm noktasından
await ev(() => window.dwgApp.setMode('measure')); await bekle(150);
await dokun(100, 100);
await gez(400, 100);
const r7 = await okuma();
ok('8 ölçüm kipinde önceki noktadan: 300 ∠ 0°', r7 && r7.base && yak(r7.base[0], 100, 1e-6) && yak(r7.L, 300, 1e-3) && yak(r7.deg, 0, 0.01), J(r7));
await ev(() => window.dwgApp.setMode('view')); await bekle(100);
ok('X sayfa hatası yok', errors.length === 0, J(errors.slice(0, 3)));
await browser.close(); await srv.kill();
C.summary(); C.exit();
