// Görüntüleyiciyi Chromium'da açar, verilen DWG/DXF'leri yükler, ekran görüntüsü alır.
// Kullanım: node tools/screenshot.mjs [çıktı klasörü] <dwg…>   (çıktı verilmezse tools/out/screenshot)
import { startServer, launchBrowser, openFile, onDialog, noUpdate, outRoot } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
const isDrawing = (f) => /\.(dwg|dxf)$/i.test(f);
const outDir = argv.length && !isDrawing(argv[0]) ? path.resolve(argv[0]) : path.join(outRoot, 'screenshot');
const files = argv.length && !isDrawing(argv[0]) ? argv.slice(1) : argv;
if (!files.length) { console.error('Kullanım: node tools/screenshot.mjs [çıktı klasörü] <dwg…>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await noUpdate(ctx);
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
onDialog(page);
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
for (const f of files) {
  await openFile(page, f, { settle: 400 });
  const st = await page.evaluate(() => { const s = window.dwgApp.state; return { prims: s.prims.length, ents: s.entityCount, layers: s.layers.size, ext: s.ext, ms: s.lastRenderMs, counts: s.counts, units: s.units, version: s.version }; });
  console.log(path.basename(f), JSON.stringify(st));
  const base = path.basename(f).replace(/\.(dwg|dxf)$/i, '');
  await page.screenshot({ path: path.join(outDir, base + '.png') });
  // etkileşim sınaması: katman paneli
  await page.click('#btnLayers'); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, base + '_layers.png') });
  await page.click('#btnLayers');
  await page.evaluate(() => window.dwgApp.onBack());
}
console.log(logs.join('\n'));
await browser.close(); srv.kill();
