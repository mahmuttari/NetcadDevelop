// 'cad' bekleme görselinin dondurulmuş kareleri — gözle bakmak için.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_snake.mjs [çıktı]
import { args, startServer, launchBrowser, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
const { out } = args(import.meta.url);
const DUR = 6000;
const KARE = (process.env.KARE || '0,6,12,18,26,34,42,50,53,58,64,70,74,78,82,86,90,94,98').split(',').map(Number);
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 720 } });
await noUpdate(ctx);
const page = await ctx.newPage();
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await page.evaluate(() => { const el = document.getElementById('loading'); el.className = 'modal load-cad'; el.hidden = false; });
await page.waitForTimeout(120);
fs.mkdirSync(out, { recursive: true });
const art = page.locator('#loading .loadart');
for (const p of KARE) {
  await page.evaluate((ms) => {
    document.querySelectorAll('#loading .la-cad, #loading .la-cad *')
      .forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }));
  }, Math.round(DUR * p / 100));
  await art.screenshot({ path: `${out}/k${String(p).padStart(2, '0')}.png` });
}
// şerit: bütün kareleri tek görselde
const html = `<body style="margin:0;background:#161c25;display:grid;grid-template-columns:repeat(${Math.min(5, KARE.length)},1fr);gap:4px;padding:4px">
  ${KARE.map(p => `<figure style="margin:0;position:relative"><img src="k${String(p).padStart(2, '0')}.png" style="width:100%;display:block">
  <figcaption style="position:absolute;left:5px;top:3px;font:12px system-ui;color:#f5b342">%${p}</figcaption></figure>`).join('')}</body>`;
fs.writeFileSync(`${out}/serit.html`, html);
await page.goto('file://' + out + '/serit.html');
await page.setViewportSize({ width: 1100, height: 900 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/serit.png`, fullPage: true });
console.log('kareler: ' + out);
await browser.close(); srv.kill();
