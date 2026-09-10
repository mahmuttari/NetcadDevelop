import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/')('playwright');
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const port = 8904, out = process.argv[2], S = process.argv[3];
const log = (...a) => { const s = a.join(' '); fs.appendFileSync(`${out}/log3.txt`, s + '\n'); console.log(s); };
fs.writeFileSync(`${out}/log3.txt`, '');
const srv = spawn(process.execPath, ['/home/user/NetcadDevelop/DwgViewer/tools/serve.mjs', String(port)], { stdio: 'inherit' });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() !== 'log') log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => log(`[pageerror] ${e.message}`));
let nextPrompt = 'deneme notu';
page.on('dialog', async d => { log('dialog', d.type(), d.message().slice(0, 60)); await d.accept(nextPrompt); });
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForSelector('#btnOpen2');
const load = async (f) => { await page.setInputFiles('#fileInput', f); await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 120000 }); await page.waitForTimeout(300); await page.evaluate(() => document.getElementById('toast').hidden = true); };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const zoom = async (bb) => { await page.evaluate((bb) => window.dwgApp.zoomExtents(bb), bb); await page.waitForTimeout(200); };
const tapWorld = async (x, y) => { const s = await page.evaluate(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(250); };
const step = process.argv[4] || 'all';
await load(`${S}/example_2000.dwg`); log('loaded');
if (step === 'all' || step === 'profile') {
  await zoom([200, 500, 700, 900]);
  await page.evaluate(() => window.dwgApp.setMode('profile')); log('profile mode');
  nextPrompt = '52.40'; await tapWorld(372, 728); log('tap1');
  nextPrompt = '51.90'; await tapWorld(449, 621); log('tap2');
  log('profile', (await page.locator('#measureBody').innerText()).replace(/\n/g, ' | ')); await page.evaluate(() => window.dwgApp.setMode('view'));
}
if (step === 'all' || step === 'pdf') {
  const dlP = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#btnMore'); await page.click('[data-act="pdf"]'); await page.fill('#pScale', '500'); await page.click('#pGo'); log('pdf clicked');
  const dl = await dlP; const pdfPath = `${out}/test.pdf`; await dl.saveAs(pdfPath); log('pdf', fs.readFileSync(pdfPath).subarray(0, 8).toString(), fs.statSync(pdfPath).size, 'bytes');
}
if (step === 'all' || step === 'compare') {
  await page.evaluate(() => document.getElementById('toast').hidden = true);
  const fc = page.waitForEvent('filechooser', { timeout: 30000 }); await page.click('#btnMore'); await page.click('[data-act="compare"]'); const chooser = await fc; await chooser.setFiles(`${S}/example_2018.dwg`); log('compare file set');
  await page.waitForFunction(() => window.dwgApp.state.compare, null, { timeout: 60000 }); await page.waitForTimeout(300); await zoom([-3000, -1500, 12500, 13000]); await shot('n_compare');
  log('compare', JSON.stringify(await page.evaluate(() => window.dwgApp.state.compare.stats)));
  await page.evaluate(() => { window.dwgApp.state.compare = null; window.dwgApp.onBack(); window.dwgApp.render(); });
}
if (step === 'all' || step === 'dxf') {
  await load(`${S}/test_tr.dxf`); log('dxf', await page.evaluate(() => JSON.stringify({ v: window.dwgApp.state.version, u: window.dwgApp.state.units, n: window.dwgApp.state.prims.length, layers: [...window.dwgApp.state.layers.values()].map(l => l.name + ':' + l.visible) })));
  await page.evaluate(() => { for (const l of window.dwgApp.state.layers.values()) l.visible = true; window.dwgApp.state.lw = true; window.dwgApp.render(); }); await zoom([80, 70, 560, 200]); await shot('n_dxf');
  await page.click('#btnMore'); await page.click('[data-act="settings"]'); await page.selectOption('#sCrs', 'ITRF96_TM30'); await page.selectOption('#sUnit', '1'); await page.fill('#sDx', '-494800'); await page.fill('#sDy', '-4514400'); await page.click('#sSave'); log('settings saved');
  await page.evaluate(() => { window.dwgApp.state.gps.on = true; window.dwgApp.onLocation(40.7654, 29.9408, 12, 45, 0); }); await page.waitForTimeout(200);
  log('gps drawing', await page.evaluate(() => JSON.stringify(window.dwgApp.state.geo.toDrawing(29.9408, 40.7654))));
  await tapWorld(200, 120); log('status', await page.locator('#stCoord').innerText());
  await shot('n_gps');
}
log('done');
await browser.close(); srv.kill();
