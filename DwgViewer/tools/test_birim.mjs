// Çizim birimi (v8.9.7): birim yalnız belirliyse yazılır — dosyanın INSUNITS'i ya da kullanıcı seçimi;
// "Birimsiz" seçilince uzunluk etiketlerinde birim çıkmaz, ölçek çipi (1:N) birim seçimini de sunar.
import path from 'node:path';
import { startServer, launchBrowser, openFile, noUpdate, checker, samplesDir, PHONE } from './harness.mjs';

const C = checker(), ok = C.ok;
const errors = [];
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
await page.goto(srv.url + 'index.html');
await page.waitForFunction(() => window.dwgApp && window.dwgApp.state, null, { timeout: 30000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (_) { /* yok */ } });
await openFile(page, path.join(samplesDir, 'MARFEN_YUZER_TERFI_2D.dwg'), { settle: 500 });

const st = () => page.evaluate(() => ({ units: window.dwgApp.state.units, dosya: window.dwgApp.state.unitsDosya, u2m: window.dwgApp.state.unitToM, chip: document.getElementById('stScale').textContent }));
let s = await st();
console.log('dosya birimi:', JSON.stringify(s));
ok('A1 dosyanın INSUNITS birimi "Çizimden" seçimiyle yazılır', s.units === s.dosya);

// ölçek çipi: birim çipleri
await page.click('#stScale');
await page.waitForSelector('#docBody [data-unit="none"]', { timeout: 5000 });
const chips = await page.$$eval('#docBody [data-unit]', els => els.map(e => e.dataset.unit + (e.classList.contains('on') ? '*' : '')));
ok('A2 ölçek çipi birim seçeneklerini gösterir (Çizimden seçili)', chips.includes('auto*') && chips.includes('none') && chips.includes('1'), chips.join(' '));

await page.click('#docBody [data-unit="none"]');
await page.waitForTimeout(250);
s = await st();
ok('B1 Birimsiz: birim yazısı yok, ölçek kapalı', s.units === '' && !(s.u2m > 0), JSON.stringify(s));
ok('B2 Birimsiz: ölçek çipi "1:N" yazmaz', !/^1:/.test(s.chip), s.chip);
ok('B3 "1 px = …" değerinin yanında birim yok', !/[a-zµ]/i.test(s.chip.split('=')[1] || 'x'), s.chip);

await page.click('#docBody [data-unit="1"]');
await page.waitForTimeout(250);
s = await st();
ok('C1 m seçilince birim "m" ve ölçek 1:N', s.units === 'm' && s.u2m === 1 && /^1:/.test(s.chip), JSON.stringify(s));

// seçim dosyaya özel kalıcı: yeniden açınca korunur
await page.evaluate(() => document.getElementById('docPanel') && (document.getElementById('docPanel').hidden = true));
await openFile(page, path.join(samplesDir, 'MARFEN_YUZER_TERFI_2D.dwg'), { settle: 500 });
s = await st();
ok('C2 seçim dosyaya özel saklanır (yeniden açınca m)', s.units === 'm', JSON.stringify(s));

ok('D1 sayfa hatası yok', errors.length === 0, errors.join(' | '));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
