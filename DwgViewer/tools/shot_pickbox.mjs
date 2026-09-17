// Pickbox imlecinin ekran görüntüleri (v7.57 / v7.58): nesne isteminde küçük kare (+ fare gezinmesinde
// nesne vurgusu), nokta isteminde artı imleç ve yakalama işareti. Kare küçük olduğu için imlecin
// çevresi kırpılarak da basılır.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_pickbox.mjs [çıktı] [örnekler]
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
await ev(() => { document.getElementById('toast').hidden = true; window.dwgApp.osnap.setModes(['end', 'mid', 'int']); });
await page.click('#toolbar [data-tab="edit"]');
await ev(() => {
  const E = window.dwgApp.editor;
  E.doc.run({ op: 'add', ents: [
    { type: 'LWPOLYLINE', pts: [[200, 220, 0], [600, 220, 0], [600, 520, 0], [200, 520, 0]], closed: true, id: 'pb_0', layer: '0', color: 4 },
    { type: 'CIRCLE', pts: [[760, 370, 0]], r: 100, id: 'pb_1', layer: '0', color: 4 },
    { type: 'LINE', pts: [[150, 640, 0], [850, 690, 0]], id: 'pb_2', layer: '0', color: 4 },
  ] });
  window.dwgApp.requestRender();
});
await ev(() => window.dwgApp.zoomExtents([100, 150, 900, 760])); await page.waitForTimeout(300);
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const vpb = await page.locator('#viewport').boundingBox();
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); E.act(a); }, id); await page.waitForTimeout(180); };
const ciz = async () => { await ev(() => window.dwgApp.requestRender()); await page.waitForTimeout(200); };
/** İmlecin çevresinden kırpılmış görüntü (kare 24 px; tam ekranda göze çarpmaz) */
const yakin = async (ad, s, r = 90) => page.screenshot({ path: `${out}/${ad}.png`, clip: { x: vpb.x + s[0] - r, y: vpb.y + s[1] - r, width: r * 2, height: r * 2 } });

// 1) Nesne istemi (Seç aracı): imleç küçük kare, yakalama işareti yok
await arac('t:select');
const a = await scr(200, 220);                                  // dikdörtgenin sol üst köşesi: yakalama olsaydı işaret çıkardı
await ev((p) => { window.dwgApp.state.lastPoint = [p[0], p[1]]; }, [200, 220]);
await ciz();
await page.screenshot({ path: `${out}/pickbox_1_nesne_istemi.png` });
await yakin('pickbox_2_kare_yakin', a);

// 2) Fare gezinmesi: kare + karenin altındaki nesnenin kesik çizgiyle vurgulanması
await page.mouse.move(vpb.x + a[0] + 2, vpb.y + a[1] + 2); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/pickbox_3_vurgu.png` });
await yakin('pickbox_4_vurgu_yakin', a, 130);

// 3) Nokta istemi (çizgi aracı): artı imleç ve yakalama işareti geri gelir
await arac('t:line');
await page.mouse.move(vpb.x + a[0] + 2, vpb.y + a[1] + 2); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/pickbox_5_nokta_istemi.png` });
await yakin('pickbox_6_arti_yakin', a, 130);
await page.mouse.move(vpb.x + vpb.width - 4, vpb.y + vpb.height - 4); await page.waitForTimeout(200);   // fare kenara: gezinen imleç kalksın
// 4) Parmakla nişan alma (v7.58): çizgi aracında uzun basış, parmak dikdörtgenin köşesine sürüklenir; büyüteç üstte
const dokun = (type, x, y) => ev(([t, x, y]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerup' ? 0 : 1 })); }, [type, x, y]);
await ev(() => { document.getElementById('toast').hidden = true; });
const k = await scr(600, 520);                                    // dikdörtgenin sağ üst köşesi
await dokun('pointerdown', k[0] + 40, k[1] + 60); await page.waitForTimeout(720);
await dokun('pointermove', k[0] + 20, k[1] + 30); await dokun('pointermove', k[0] + 4, k[1] + 5); await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/pickbox_7_nisan_buyutec.png` });
await dokun('pointerup', k[0] + 4, k[1] + 5); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/pickbox_8_nisan_sonuc.png` });
// 5) Nesne isteminde nişan: Seç aracı, parmak dairenin üstünde — büyüteçte kare ve nesne adı
await arac('t:select');
const m = await scr(760, 470);                                    // dairenin tepe noktası
// Seç aracında boş yerden basış örtük pencereyi başlatır; nişan almak için parmak NESNENİN üstüne basar
await dokun('pointerdown', m[0], m[1] + 2); await page.waitForTimeout(720);
await dokun('pointermove', m[0] - 8, m[1] + 6); await dokun('pointermove', m[0] - 14, m[1] + 12); await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/pickbox_9_nisan_nesne.png` });
await dokun('pointerup', m[0], m[1] + 2); await page.waitForTimeout(300);

for (const f of fs.readdirSync(out)) console.log('yazıldı', `${out}/${f}`);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
process.exit(0);   // sunucunun açık bağlantıları döngüyü canlı tutar; sınamalar da böyle çıkar
