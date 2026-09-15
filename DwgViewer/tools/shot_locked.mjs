// Kilitli (paket yetmeyen) özelliklerin görünümü: dört basamakta şerit sekmeleri, ana ekran
// Araçlar ızgarası ve "Diğer" menüsü. Tasarımı gözle görmek içindir; sınama değildir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_locked.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const { out, samples: SM } = args(import.meta.url);
fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launchBrowser();

const PRICES = {
  adfree: { monthly: '₺39,99', yearly: '₺299,99' },
  premium: { monthly: '₺249,99', yearly: '₺1.699,99' },
  super: { monthly: '₺399,99', yearly: '₺2.199,99' },
};
/** Sahte köprü: basamak dışarıdan window.__setEd ile değiştirilir (test_edition.mjs kalıbı) */
const fakeBridge = (prices) => {
  let ed = 'free';
  window.Android = {
    edition: () => ed,
    proInfo: () => JSON.stringify({ edition: ed, source: ed === 'free' ? 'none' : 'play', name: '', exp: 0, plan: 'monthly', prices, billingReady: true, licenseEnabled: true }),
    buyPro() {}, restorePro() {}, activateLicense: () => false,
    adsAvailable: () => false, showAd() {}, versionCode: () => '53', appVersion: () => '7.30',
    getPendingFile: () => '', getRecent: () => '[]',
  };
  window.__setEd = (e) => { ed = e; window.dwgApp.onEdition(e, 'restored'); };
};

const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
await ctx.addInitScript(fakeBridge, PRICES);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await page.evaluate(() => { localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload();
await page.waitForSelector('#btnOpen2');

// Ana ekran Araçlar ızgarası (çizim açılmadan önce)
for (const ed of ['free', 'adfree', 'premium', 'super']) {
  await page.evaluate((e) => { window.__setEd(e); window.dwgApp.home.show(); window.dwgApp.home.setTab('tools', true); }, ed);
  await page.waitForTimeout(250);
  const grid = page.locator('#toolsGrid');
  if (await grid.count()) { await grid.screenshot({ path: `${out}/tools_${ed}.png` }); console.log('yazıldı', `tools_${ed}.png`); }
}
await page.evaluate(() => { window.__setEd('free'); });

// Çizim aç: şerit ve Diğer menüsü ancak belge varken anlamlı
await openFile(page, path.join(SM, 'example_2018.dwg'), { settle: 600 });

const TABS = ['view', 'measure', 'draw', 'annot', 'edit', '3d'];
for (const ed of ['free', 'adfree', 'premium', 'super']) {
  await page.evaluate((e) => window.__setEd(e), ed);
  await page.waitForTimeout(300);
  const shown = await page.evaluate(() => [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab));
  console.log(ed, 'sekmeler:', shown.join(' '));
  await page.locator('#toolbar').screenshot({ path: `${out}/tabs_${ed}.png` });
  for (const tb of TABS) {
    if (!shown.includes(tb)) continue;
    await page.evaluate((x) => {
      const tbEl = document.getElementById('toolbar');
      const b = tbEl.querySelector(`[data-tab="${x}"]`);
      if (b && !b.classList.contains('active')) b.click();
      if (tbEl.classList.contains('collapsed')) { const c = tbEl.querySelector('.tb-collapse'); if (c) c.click(); }
    }, tb);
    await page.waitForTimeout(200);
    await page.locator('#toolbar').screenshot({ path: `${out}/row_${ed}_${tb}.png` });
  }
  console.log('yazıldı', `row_${ed}_*.png`);
  // Diğer menüsü
  await page.evaluate(() => { const m = document.getElementById('moreMenu'); if (m) m.hidden = false; });
  await page.waitForTimeout(150);
  await page.locator('#moreMenu').screenshot({ path: `${out}/menu_${ed}.png` });
  await page.evaluate(() => { const m = document.getElementById('moreMenu'); if (m) m.hidden = true; });
  console.log('yazıldı', `menu_${ed}.png`);
}
await browser.close();
srv.kill();
