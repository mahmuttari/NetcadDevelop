// Ekran / Ölçü sorusunun ekran görüntüleri (v7.57). Tasarımı gözle görmek içindir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_kip.mjs [çıktı] [örnekler]
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
await ev(() => { document.getElementById('toast').hidden = true; window.dwgApp.osnap.setModes([]); });
const tapWorld = async (x, y) => { await page.waitForTimeout(110); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(380); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: 'shot_' + i, layer: '0', color: 4 })) }); window.dwgApp.requestRender(); }, ents);
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); E.act(a); }, id); await page.waitForTimeout(150); };
await page.click('#toolbar [data-tab="edit"]');
await ekle([{ type: 'LINE', pts: [[200, 200, 0], [600, 200, 0]] }, { type: 'LINE', pts: [[700, 300, 0], [700, 600, 0]] }, { type: 'LINE', pts: [[150, 450, 0], [550, 450, 0]] }]);
await ev(() => window.dwgApp.zoomExtents([100, 100, 800, 700])); await page.waitForTimeout(250);
// 1) soru: ötele
await arac('t:offset');
await page.screenshot({ path: `${out}/kip_1_soru.png` });
// 2) Ölçü: mesafe istemi (son değer ipucu yok)
await page.click('#cmdBtns [data-cmd="modevalue"]'); await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/kip_2_olcu_istemi.png` });
await ev(() => window.dwgApp.editor.tools.typed('60')); await page.waitForTimeout(150);
await tapWorld(350, 450);
await page.screenshot({ path: `${out}/kip_3_olcu_nesne_secildi.png` });
await tapWorld(350, 520); await page.waitForTimeout(150);
// 3) kavis Ekran: üçüncü adım
await arac('t:fillet');
await tapWorld(400, 200); await tapWorld(700, 500);
await page.screenshot({ path: `${out}/kip_4_kavis_ekran.png` });
const d = 80 * (Math.SQRT2 - 1);
await tapWorld(700 - d / Math.SQRT2, 200 + d / Math.SQRT2);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/kip_5_kavis_sonuc.png` });
for (const f of fs.readdirSync(out)) console.log('yazıldı', `${out}/${f}`);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
