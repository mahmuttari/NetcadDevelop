// Paket sayfasının ekran görüntüsü (her tema için bir kare). Tasarımı gözle görmek içindir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_pro.mjs [çıktı]
import { args, startServer, launchBrowser, onDialog, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
const { out } = args(import.meta.url);
fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 1800 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
// Play köprüsü taklidi: üç pakette de aylık ve yıllık fiyat olsun ki tasarruf rozeti çıksın
await page.evaluate(() => {
  window.Android = {
    edition: () => 'free',
    proInfo: () => JSON.stringify({ edition: 'free', source: 'none', name: '', exp: 0, plan: '', billingReady: true, licenseEnabled: true,
      prices: { adfree: { monthly: '₺39,99', yearly: '₺299,99' }, premium: { monthly: '₺249,99', yearly: '₺1.699,99' }, super: { monthly: '₺399,99', yearly: '₺2.199,99' } } }),
    buyPro() {}, restorePro() {}, activateLicense: () => false, showAd() {}, versionCode: () => 52,
  };
});
for (const th of ['dark', 'light', 'blueprint', 'sepia', 'hicontrast']) {
  await page.evaluate((t) => { document.body.dataset.theme = t; window.dwgApp.openProPanel(); }, th);
  await page.waitForTimeout(250);
  await page.locator('#proPanel').screenshot({ path: `${out}/pro_${th}.png` });
  console.log('yazıldı', `${out}/pro_${th}.png`);
}
// yazı ölçeği büyütülmüş ve eldiven kipi
await page.evaluate(() => { document.body.dataset.theme = 'dark'; document.getElementById('app').style.setProperty('--fs', '1.3'); window.dwgApp.openProPanel(); });
await page.waitForTimeout(250);
await page.locator('#proPanel').screenshot({ path: `${out}/pro_buyuk_yazi.png` });
console.log('yazıldı', `${out}/pro_buyuk_yazi.png`);
await browser.close(); srv.kill();
