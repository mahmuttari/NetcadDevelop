/*
 * GERİ AL / YİNELE HAFIZASI: 10 geri · 10 ileri (kullanıcı kararı) ve durum çubuğundaki her sekmede
 * görünen geri al / yinele düğmeleri (kalan adım rozetli, adım yoksa devre dışı).
 *
 * Sınananlar: 12 komuttan sonra geri alma yığını 10'da kalır ama günlük 12'dir (düşen adım kalıcıdır,
 * DXF'e yazılır); 10 geri alındıktan sonra yinele yığını 10'dur; yeni komut yineleyi siler; durum
 * çubuğu düğmeleri geri alır / yineler ve rozetleri yazar; dosya yeniden açılınca günlük yeniden
 * uygulanır ve yine yalnız son 10 adım geri alınabilir; Ctrl+Z / Ctrl+Y (masaüstü) aynı yığını kullanır.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_geri_al.mjs
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, samplesDir } from './harness.mjs';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message.slice(0, 200)); });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${samplesDir}/example_2000.dwg`, { settle: 400 });
await ev(() => { localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); document.getElementById('toast').hidden = true; });
const J = JSON.stringify, bekle = (ms = 150) => page.waitForTimeout(ms);
const yigin = () => ev(() => { const d = window.dwgApp.editor.doc; return { u: d.undoStack.length, r: d.redoStack.length, log: d.log.length, katman: window.dwgApp.state.layers.size }; });
const dugme = () => ev(() => ['undo', 'redo'].map(k => { const b = document.querySelector(`#stQuick [data-quick="${k}"]`); const ct = b.querySelector('.st-ct'); return { dis: b.disabled, ct: ct.hidden ? '' : ct.textContent }; }));
const komut = (i) => ev((n) => window.dwgApp.editor.runCmd({ op: 'layer', name: 'GA_' + n, color: -1 }), i);

{
  const d0 = await yigin();
  const b0 = await dugme();
  ok('1 başlangıç: yığınlar boş, iki düğme devre dışı ve rozetsiz', d0.u === 0 && d0.r === 0 && b0[0].dis && b0[1].dis && b0[0].ct === '' && b0[1].ct === '', J({ d0, b0 }));
  for (let i = 1; i <= 12; i++) await komut(i);
  const d1 = await yigin(), b1 = await dugme();
  ok('2 12 komut: geri alma yığını 10 ile SINIRLI, günlük 12 (düşen 2 adım kalıcı), 12 katman var', d1.u === 10 && d1.log === 12 && d1.katman === d0.katman + 12, J(d1));
  ok('3 rozet "10", geri al açık, yinele kapalı', b1[0].ct === '10' && !b1[0].dis && b1[1].dis, J(b1));
  const depth = await ev(async () => (await import('./edit.js')).UNDO_DEPTH);
  ok('4 UNDO_DEPTH = 10 dışa açık', depth === 10, String(depth));
  for (let i = 0; i < 10; i++) await ev(() => window.dwgApp.editor.act('undo'));
  await bekle();
  const d2 = await yigin(), b2 = await dugme();
  ok('5 10 geri: yığın 0, yinele 10, GA_3…GA_12 gitti, GA_1 ve GA_2 KALDI (hafıza dışı)', d2.u === 0 && d2.r === 10 && d2.katman === d0.katman + 2 && (await ev(() => window.dwgApp.state.layers.has('GA_2') && !window.dwgApp.state.layers.has('GA_3'))), J(d2));
  ok('6 düğmeler: geri al kapalı, yinele "10"', b2[0].dis && b2[0].ct === '' && !b2[1].dis && b2[1].ct === '10', J(b2));
  const daha = await ev(() => window.dwgApp.editor.doc.undo());
  ok('7 on birinci geri alma yok (false döner)', daha === false);
  await page.click('#stQuick [data-quick="redo"]'); await bekle();
  await page.click('#stQuick [data-quick="redo"]'); await bekle();
  const d3 = await yigin(), b3 = await dugme();
  ok('8 durum çubuğu "yinele" iki kez: geri 2, ileri 8, GA_4 geri geldi', d3.u === 2 && d3.r === 8 && (await ev(() => window.dwgApp.state.layers.has('GA_4'))) && b3[0].ct === '2' && b3[1].ct === '8', J({ d3, b3 }));
  await page.click('#stQuick [data-quick="undo"]'); await bekle();
  ok('9 durum çubuğu "geri al": geri 1, ileri 9', J(await yigin()).includes('"u":1,"r":9'), J(await yigin()));
  await komut(99);
  const d4 = await yigin();
  ok('10 yeni komut yinele yığınını siler', d4.r === 0 && d4.u === 2, J(d4));
  await page.screenshot({ path: `${out}/geri_al_rozet.png` });
}
{
  // yeniden açılış: günlük yeniden uygulanır, yine yalnız son 10 adım geri alınabilir
  const once = await ev(() => window.dwgApp.editor.doc.log.length);
  await page.reload(); await page.waitForSelector('#btnOpen2'); await bekle(200);
  await openFile(page, `${samplesDir}/example_2000.dwg`, { settle: 400 });
  const d5 = await yigin(), b5 = await dugme();
  ok('11 yeniden açılış: günlük ' + once + ' komut yeniden uygulandı, geri alınabilir adım en çok 10, rozet yazıyor', d5.log === once && d5.u === Math.min(10, once) && b5[0].ct === String(Math.min(10, once)), J({ once, d5, b5 }));
  await ev(() => { localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });
}
{
  // Ctrl+Z / Ctrl+Y masaüstü kısayolları aynı yığını kullanır
  await ev(() => { window.dwgApp.state.desk.mouse = true; });
  const u0 = (await yigin()).u;
  await page.keyboard.press('Control+z'); await bekle(250);
  const u1 = (await yigin()).u;
  await page.keyboard.press('Control+y'); await bekle(250);
  ok('12 Ctrl+Z bir adım geri alır, Ctrl+Y yineler', u1 === u0 - 1 && (await yigin()).u === u0, `${u0} → ${u1} → ${(await yigin()).u}`);
}
{
  const sek = await ev(() => ['view', 'draw', 'edit'].map(id => { window.dwgApp.editor.openTab(id); const b = document.querySelector('#stQuick [data-quick="undo"]'); const r = b.getBoundingClientRect(); return r.width >= 36 && r.height >= 36; }));
  ok('13 geri al düğmesi her sekmede durum çubuğunda görünür (≥ 36 px)', sek.every(Boolean), J(sek));
}
ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
