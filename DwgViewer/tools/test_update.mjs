// Play uygulama içi güncelleme köprüsü (v8.9.6): checkUpdate Android'de Play'e sorar, GitHub'a gitmez;
// onUpdate durumları (none / ready / error) doğru kullanıcı tepkisini verir.
import { playwright, startServer, launchBrowser, PHONE } from './harness.mjs';

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
const errors = []; let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const netHits = [];
ctx.on('request', r => { if (/github|version\.json/.test(r.url())) netHits.push(r.url()); });
await ctx.addInitScript(() => {
  window.__up = { checks: [], completes: 0, urls: [] };
  window.Android = {
    edition: () => 'free', proInfo: () => JSON.stringify({ edition: 'free', source: 'none', prices: {}, billingReady: true, licenseEnabled: false }),
    adsAvailable: () => false, showAd() {}, openUrl: (u) => window.__up.urls.push(u),
    appVersion: () => '8.9.6', versionCode: () => '138', getPendingFile: () => '', getRecent: () => '[]', pickFile() {},
    checkPlayUpdate: (m) => window.__up.checks.push(m), completePlayUpdate: () => { window.__up.completes++; }, openStore() {},
  };
});
setTimeout(() => { console.log('ZAMAN AŞIMI'); process.exit(2); }, 120000);
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
await page.goto(srv.url + 'index.html');
await page.waitForFunction(() => window.dwgApp && window.dwgApp.onUpdate, null, { timeout: 30000 });
await page.waitForTimeout(4600);   // açılıştaki otomatik denetim (4 s)
let up = await page.evaluate(() => window.__up);
ok(up.checks.length === 1 && up.checks[0] === false, 'açılışta Play denetimi otomatik (manual=false) çağrıldı');
ok(netHits.length === 0, 'GitHub / version.json isteği yok: ' + netHits.join(', '));

// otomatik denetimde "none" sessiz kalır
await page.evaluate(() => window.dwgApp.onUpdate('none'));
ok(!(await page.locator('#toast').isVisible()), 'otomatik denetimde güncel sürüm sessiz');

// indirildi: onay penceresi, Evet → completePlayUpdate
await page.evaluate(() => { window.dwgApp.onUpdate('ready'); });
await page.waitForTimeout(400);
const txt = await page.evaluate(() => document.body.innerText);
ok(/Güncelleme indirildi/.test(txt), 'indirme bitince yeniden başlatma soruluyor');
const yes = page.getByRole('button', { name: /^(Tamam|Evet|OK)$/i }).first();
if (await yes.count()) await yes.click();
await page.waitForTimeout(300);
up = await page.evaluate(() => window.__up);
ok(up.completes === 1, 'onayda completePlayUpdate çağrıldı');

// ikinci "ready" (onResume) yeniden sormaz
await page.evaluate(() => { window.dwgApp.onUpdate('ready'); });
await page.waitForTimeout(300);
ok(!/Güncelleme indirildi/.test(await page.evaluate(() => document.body.innerText)), 'onResume ile gelen ikinci ready yeniden sormuyor');

ok(errors.length === 0, 'sayfa hatası yok ' + errors.join(' | '));
console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
await browser.close(); srv.kill();
process.exit(fail ? 1 : 0);
