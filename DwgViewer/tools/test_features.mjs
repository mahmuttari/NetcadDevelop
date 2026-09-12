// Özellik sınaması (example_2000.dwg): profil, PDF çıktısı, karşılaştırma, Türkçe DXF, koordinat sistemi ayarı ve GPS işaretçisi.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_features.mjs [çıktı] [örnekler] [profile|pdf|compare|dxf|all]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers, askLog } from './harness.mjs';
import fs from 'node:fs';
const { out, samples: S, rest } = args(import.meta.url);
const step = rest[0] || 'all';
const srv = await startServer();
const C = checker(), ok = C.ok;
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [], dialogs = [];
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
let nextPrompt = 'deneme notu';
onDialog(page, async d => { dialogs.push(d.type() + ':' + d.message().slice(0, 60)); await d.accept(nextPrompt); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
const load = async (f) => { await openFile(page, f, { settle: 300 }); await page.evaluate(() => document.getElementById('toast').hidden = true); };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const zoom = async (bb) => { await page.evaluate((bb) => window.dwgApp.zoomExtents(bb), bb); await page.waitForTimeout(200); };
const tapWorld = async (x, y) => { const s = await page.evaluate(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(250); };
await load(`${S}/example_2000.dwg`);
ok('0 example_2000.dwg yüklendi (339 ilkel)', await page.evaluate(() => window.dwgApp.state.hasDoc && window.dwgApp.state.prims.length === 339), String(await page.evaluate(() => window.dwgApp.state.prims.length)));   // 337 + MULTILEADER ok başı + desenli HATCH'in LOD dolgusu
if (step === 'all' || step === 'profile') {
  await zoom([200, 500, 700, 900]);
  await page.evaluate(() => window.dwgApp.setMode('profile'));
  ok('1a profil kipi', await page.evaluate(() => window.dwgApp.state.mode === 'profile' && !document.getElementById('measurePanel').hidden));
  await queueAnswers(page, '52.40'); await tapWorld(372, 728);
  await queueAnswers(page, '51.90'); await tapWorld(449, 621);
  const p = (await page.locator('#measureBody').innerText()).replace(/\n/g, ' | ');
  { const asks = await askLog(page); ok('1b iki kot istendi (giriş kutusu)', asks.filter(a => a.type === 'text' && /kotunu girin/.test(a.label)).length === 2, JSON.stringify(asks)); }
  ok('1c profil: kotlar 52,4 / 51,9 (elle), Δh -0,5 m', p.includes('Kot 52,4 m (elle)') && p.includes('Kot 51,9 m (elle)') && p.includes('Δh -0,5 m'), p.slice(0, 160));
  ok('1d profil: uzunluk 0,14 m ve toplam satırı', /L 0,14 m/.test(p) && /Toplam \| 0,14 m/.test(p), p.slice(160, 320));
  await page.evaluate(() => window.dwgApp.setMode('view'));
}
if (step === 'all' || step === 'pdf') {
  const dlP = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#btnMore'); await page.click('[data-act="pdf"]'); await page.fill('#pScale', '500'); await page.click('#pGo');
  const dl = await dlP; const pdfPath = `${out}/test.pdf`; await dl.saveAs(pdfPath);
  const buf = fs.readFileSync(pdfPath), head = buf.subarray(0, 8).toString('latin1'), txt = buf.toString('latin1');
  ok('2a PDF başlığı %PDF-1.4', head.startsWith('%PDF-1.4'), head);
  ok('2b PDF tek sayfa, A3 yatay (1190.55×841.89 pt), JPEG gömülü, > 20 KB', (txt.match(/\/Type \/Page\b/g) || []).length === 1 && /\/MediaBox \[0 0 1190\.55 841\.89\]/.test(txt) && /\/DCTDecode/.test(txt) && txt.includes('%%EOF') && buf.length > 20000, buf.length + ' bayt');
}
if (step === 'all' || step === 'compare') {
  await page.evaluate(() => document.getElementById('toast').hidden = true);
  const fc = page.waitForEvent('filechooser', { timeout: 30000 }); await page.click('#btnMore'); await page.click('[data-act="compare"]'); const chooser = await fc; await chooser.setFiles(`${S}/example_2018.dwg`);
  await page.waitForFunction(() => window.dwgApp.state.compare, null, { timeout: 60000 }); await page.waitForTimeout(300); await zoom([-3000, -1500, 12500, 13000]); await shot('n_compare');
  const st = await page.evaluate(() => window.dwgApp.state.compare.stats);
  ok('3 karşılaştırma 2000 ↔ 2018: 39 çıkan, 1 eklenen, 290 ortak', st.removed === 39 && st.added === 1 && st.common === 290, JSON.stringify(st));   // MULTILEADER çizgisi ve ok başı iki sürümde de eşleşir
  await page.evaluate(() => { window.dwgApp.state.compare = null; window.dwgApp.onBack(); window.dwgApp.render(); });
}
if (step === 'all' || step === 'dxf') {
  await load(`${S}/test_tr.dxf`);
  const d = await page.evaluate(() => ({ v: window.dwgApp.state.version, u: window.dwgApp.state.units, n: window.dwgApp.state.prims.length, layers: [...window.dwgApp.state.layers.values()].map(l => l.name + ':' + l.visible) }));
  ok('4a DXF: sürüm "DXF AutoCAD 2000", birim m, 18 ilkel', d.v === 'DXF AutoCAD 2000' && d.u === 'm' && d.n === 18, JSON.stringify(d));   // 13 + bloksuz DIMENSION: 2 uzatma, 1 ölçü çizgisi, 2 ok
  ok('4b DXF katmanları: 0 açık, ICMESUYU ve KANAL kapalı', d.layers.join(',') === '0:true,ICMESUYU:false,KANAL:false', d.layers.join(','));
  await page.evaluate(() => { for (const l of window.dwgApp.state.layers.values()) l.visible = true; window.dwgApp.state.lw = true; window.dwgApp.render(); }); await zoom([80, 70, 560, 200]); await shot('n_dxf');
  await page.click('#btnMore'); await page.click('[data-act="settings"]'); await page.selectOption('#sCrs', 'ITRF96_TM30'); await page.selectOption('#sUnit', '1'); await page.fill('#sDx', '-494800'); await page.fill('#sDy', '-4514400'); await page.click('#sSave');
  ok('4c koordinat ayarı kaydedildi (ITRF96 TM30)', await page.evaluate(() => !!window.dwgApp.state.geo));
  await page.evaluate(() => { window.dwgApp.state.gps.on = true; window.dwgApp.onLocation(40.7654, 29.9408, 12, 45, 0); }); await page.waitForTimeout(200);
  const g = await page.evaluate(() => window.dwgApp.state.geo.toDrawing(29.9408, 40.7654));
  ok('4d GPS → çizim koordinatı ≈ (201,578; 122,262)', near(g[0], 201.578, 0.01) && near(g[1], 122.262, 0.01), JSON.stringify(g));
  await tapWorld(200, 120);
  const st = await page.locator('#stCoord').innerText();
  ok('4e durum çubuğu: X/Y ve φ/λ', /X: 200 Y: 120/.test(st) && /φ 40\.7653\d* λ 29\.9407\d*/.test(st), st);
  await shot('n_gps');
}
ok('5 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
