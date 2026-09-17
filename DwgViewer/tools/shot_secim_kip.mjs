// Örtük pencere / kesen seçimin ekran görüntüsü (v7.57): sürükleme ortasında mavi pencere ve yeşil kesen kutu.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_secim_kip.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
const { out, samples: SM } = args(import.meta.url);
fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
onDialog(page, async d => { await d.dismiss(); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { document.getElementById('toast').hidden = true; });
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: 'shot_' + i, layer: '0', color: 4 })) }); window.dwgApp.requestRender(); }, ents);
await page.click('#toolbar [data-tab="edit"]');
await ekle([{ type: 'LWPOLYLINE', pts: [[200, 200, 0], [600, 200, 0], [600, 500, 0], [200, 500, 0]], closed: true }, { type: 'CIRCLE', pts: [[750, 350, 0]], r: 90 }, { type: 'LINE', pts: [[150, 600, 0], [800, 650, 0]] }]);
await ev(() => window.dwgApp.zoomExtents([50, 100, 950, 750])); await page.waitForTimeout(250);
await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); E.act('t:select'); }); await page.waitForTimeout(150);
const scr = (x, y) => ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]);
const seq = (evs) => ev((evs) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); const mk = (type, q) => new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + q[0], clientY: r.top + q[1], button: 0, buttons: type === 'pointerup' ? 0 : 1 }); for (const [t, p] of evs) vp.dispatchEvent(mk(t, p)); }, evs);
// 1) soldan sağa: mavi PENCERE (sürükleme ortasında)
const a = await scr(120, 560), b = await scr(700, 150);
await seq([['pointerdown', a], ['pointermove', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]], ['pointermove', b]]);
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}/secim_1_pencere_mavi.png` });
await seq([['pointerup', b]]); await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/secim_2_pencere_sonuc.png` });
await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.say(); window.dwgApp.requestRender(); });
// 2) sağdan sola: yeşil KESEN (kesik kenar), yarım kutu
const c = await scr(850, 150), d = await scr(400, 560);
await seq([['pointerdown', c], ['pointermove', [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2]], ['pointermove', d]]);
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}/secim_3_kesen_yesil.png` });
await seq([['pointerup', d]]); await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/secim_4_kesen_sonuc.png` });
for (const f of fs.readdirSync(out)) console.log('yazıldı', `${out}/${f}`);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
