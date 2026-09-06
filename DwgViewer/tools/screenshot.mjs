// Görüntüleyiciyi Chromium'da açar, verilen DWG'leri yükler, ekran görüntüsü alır.
// Kullanım: node tools/screenshot.mjs <çıktı klasörü> <dwg…>
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || (process.cwd() + '/'))('playwright');
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2], files = process.argv.slice(3);
const port = 8790 + Math.floor(Math.random() * 100);
const srv = spawn(process.execPath, [path.join(here, 'serve.mjs'), String(port)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForSelector('#btnOpen2');
for (const f of files) {
  await page.setInputFiles('#fileInput', f);
  await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => { const s = window.dwgApp.state; return { prims: s.prims.length, ents: s.entityCount, layers: s.layers.size, ext: s.ext, ms: s.lastRenderMs, counts: s.counts, units: s.units, version: s.version }; });
  console.log(path.basename(f), JSON.stringify(st));
  await page.screenshot({ path: path.join(outDir, path.basename(f, '.dwg') + '.png') });
  // etkileşim sınaması: katman paneli, bilgi paneli, ölçü
  await page.click('#btnLayers'); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, path.basename(f, '.dwg') + '_layers.png') });
  await page.click('#btnLayers');
  await page.evaluate(() => window.dwgApp.onBack());
}
console.log(logs.join('\n'));
await browser.close(); srv.kill();
