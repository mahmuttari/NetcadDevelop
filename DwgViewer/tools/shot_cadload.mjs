// 'cad' açılış anlatısının döngü kareleri (9 s) + aşama metinlerinin gerçek ilerlemeyle değişimi.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_cadload.mjs [çıktı]
import { args, startServer, launchBrowser, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
const { out } = args(import.meta.url);
const DUR = 9000;
const KARE = (process.env.KARE || '1,8,16,26,33,40,48,55,64,70,76,82,90,95').split(',').map(Number);
const TEMA = (process.env.TEMA || 'dark').split(',');
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 780 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
fs.mkdirSync(out, { recursive: true });
await page.evaluate(() => { document.getElementById('loading').hidden = false; window.dwgApp.__cadLoad(46, 'Proje.dwg · 18,4 MB · 412.905 nesne'); });
const art = page.locator('#loading .loadart');
const par = [];
for (const tema of TEMA) {
  await page.evaluate((x) => document.body.setAttribute('data-theme', x), tema);
  await page.waitForTimeout(120);
  for (const p of KARE) {
    await page.evaluate((ms) => document.querySelectorAll('#loading .la-cad, #loading .la-cad *')
      .forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; })), Math.round(DUR * p / 100));
    await page.waitForTimeout(60);
    await art.screenshot({ path: `${out}/${tema}_${String(p).padStart(3, '0')}.png` });
    par.push([tema, p]);
  }
}
const html = `<body style="margin:0;background:#161c25;display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:4px">
${par.map(([tm, p]) => `<figure style="margin:0;position:relative"><img src="${tm}_${String(p).padStart(3, '0')}.png" style="width:100%;display:block">
<figcaption style="position:absolute;left:5px;top:3px;font:12px system-ui;color:#46cdf2">%${p}</figcaption></figure>`).join('')}</body>`;
fs.writeFileSync(out + '/serit.html', html);
await page.goto('file://' + out + '/serit.html');
await page.setViewportSize({ width: 1500, height: 900 });
await page.waitForTimeout(400);
await page.screenshot({ path: out + '/serit.png', fullPage: true });
console.log('kareler: ' + out);
await browser.close(); srv.kill();
