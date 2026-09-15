// Aşamalı 'cad' açılış görselinin yüzde yüzde görüntüsü.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_cadload.mjs [çıktı]
import { args, startServer, launchBrowser, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
const { out } = args(import.meta.url);
const YUZDE = (process.env.YUZDE || '3,18,28,38,46,58,68,80,90,96,100').split(',').map(Number);
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
const parcalar = [];
for (const tema of TEMA) {
  await page.evaluate((x) => document.body.setAttribute('data-theme', x), tema);
  for (const p of YUZDE) {
    await page.evaluate((v) => {
      const el = document.getElementById('loading'); el.hidden = false;
      window.dwgApp.__cadLoad(v, 'Proje.dwg · 18,4 MB · 412.905 nesne');
    }, p);
    await page.waitForTimeout(260);
    await page.screenshot({ path: `${out}/${tema}_${String(p).padStart(3, '0')}.png` });
    parcalar.push([tema, p]);
  }
}
const html = `<body style="margin:0;background:#1a1a1a;display:grid;grid-template-columns:repeat(6,1fr);gap:3px;padding:3px">
${parcalar.map(([tm, p]) => `<figure style="margin:0;position:relative"><img src="${tm}_${String(p).padStart(3, '0')}.png" style="width:100%;display:block">
<figcaption style="position:absolute;left:5px;top:3px;font:12px system-ui;color:#46cdf2;background:#0009;padding:1px 5px;border-radius:4px">${tm} %${p}</figcaption></figure>`).join('')}</body>`;
fs.writeFileSync(out + '/serit.html', html);
await page.goto('file://' + out + '/serit.html');
await page.setViewportSize({ width: 1500, height: 1000 });
await page.waitForTimeout(500);
await page.screenshot({ path: out + '/serit.png', fullPage: true });
console.log('kareler: ' + out);
await browser.close(); srv.kill();
