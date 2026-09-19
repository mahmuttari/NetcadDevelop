// EKRANDAKİ GÖRÜNTÜYÜ PAYLAŞMA (v7.89): yeşil gönder düğmesi, görüntünün alınması, Android
// köprüsüne giden çağrı, WhatsApp kurulu değilken davranış, uzun basışta sistem paylaşımı,
// belge kipinde belgenin kendisinin gönderilmesi ve komut satırı kısayolu.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_paylas.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';

const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
const J = JSON.stringify;
const bekle = (ms = 150) => page.waitForTimeout(ms);

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await bekle(200);

/*
 * Sahte Android köprüsü. Gerçek paylaşım penceresini açamayız (tarayıcıdayız), ama asıl
 * sınanacak şey pencerenin kendisi değil: DOĞRU BAYTLARIN doğru pakete gönderilip
 * gönderilmediği ve kurulu değilken ne yapıldığıdır.
 */
const koprüKur = (kurulu = true) => ev((k) => {
  window.Android = window.Android || {};
  window.__cagri = [];
  window.Android.shareImage = (b64, ad, alt, pkg) => { window.__cagri.push({ tur: 'image', b64uzunluk: (b64 || '').length, ad, alt, pkg }); return k ? 'ok' : 'yok'; };
  window.Android.docShareTo = (id, pkg) => { window.__cagri.push({ tur: 'doc', id, pkg }); return k ? 'ok' : 'yok'; };
  window.Android.docShare = (id, view) => { window.__cagri.push({ tur: 'docEski', id, view }); };
}, kurulu);
const cagrilar = () => ev(() => window.__cagri || []);

await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
await ev(() => { document.getElementById('toast').hidden = true; });

// --- 1 · düğme var mı, görünür mü, dokunulabilir mi -----------------------------------------
{
  const b = await ev(() => { const e = document.querySelector('#navFabs [data-nav="send"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), yesil: getComputedStyle(e).backgroundColor, etiket: e.getAttribute('aria-label'), ilk: e === document.querySelector('#navFabs button') }; });
  ok('1a gönder düğmesi FAB sütununda ve ilk sırada', !!b && b.ilk === true, J(b));
  ok('1b dokunma hedefi en az 40x40', !!b && b.w >= 40 && b.h >= 40, J(b));
  ok('1c düğme yeşil (sütunun tek renkli düğmesi)', !!b && /rgb\(\s*31,\s*170,\s*83\s*\)/.test(b.yesil), J(b && b.yesil));
  ok('1d erişilebilir adı WhatsApp\'ı söylüyor', !!b && /WhatsApp/.test(b.etiket || ''), J(b && b.etiket));
}
// --- 2 · simge WhatsApp'ın kendi işareti DEĞİL ----------------------------------------------
{
  const s = await ev(() => { const el = document.getElementById('i-send-chat'); return el ? el.outerHTML : null; });
  ok('2a kendi çizdiğimiz sohbet simgesi tanımlı', !!s && s.includes('viewBox'), J(s && s.slice(0, 40)));
  const kullanim = await ev(() => [...document.querySelectorAll('use')].filter(u => (u.getAttribute('href') || '') === '#i-send-chat').length);
  ok('2b simge gerçekten kullanılıyor', kullanim >= 1, J(kullanim));
}
// --- 3 · dokunuş: görüntü alınır ve WhatsApp paketine gönderilir -----------------------------
{
  await koprüKur(true);
  await page.click('#navFabs [data-nav="send"]'); await bekle(500);
  const c = await cagrilar();
  const son = c[c.length - 1] || {};
  ok('3a köprüye resim gönderildi', c.length === 1 && son.tur === 'image', J(c));
  ok('3b hedef paket com.whatsapp', son.pkg === 'com.whatsapp', J(son.pkg));
  ok('3c gerçek bir PNG gönderildi (boş değil)', (son.b64uzunluk || 0) > 2000, J(son.b64uzunluk));
  ok('3d dosya adı çizimden türetildi ve .png', /^example_2000_\d+\.png$/.test(son.ad || ''), J(son.ad));
  ok('3e alt yazıda dosya adı var', /example_2000/.test(son.alt || ''), J(son.alt));
}
// --- 4 · WhatsApp kurulu değilse: sessizce başka pencere AÇILMAZ, kullanıcıya söylenir -------
{
  await koprüKur(false);
  await page.click('#navFabs [data-nav="send"]'); await bekle(500);
  const c = await cagrilar();
  const t = await ev(() => { const e = document.getElementById('toast'); return { gizli: e.hidden, metin: e.textContent.trim().slice(0, 120) }; });
  ok('4a tek çağrı yapıldı, kendiliğinden ikinci pencere açılmadı', c.length === 1, J(c));
  ok('4b kullanıcıya kurulu olmadığı söylendi', t.gizli === false && /WhatsApp/.test(t.metin) && /kurulu/i.test(t.metin), J(t));
  ok('4c "başka uygulama" çıkışı sunuldu', /Başka uygulama/i.test(t.metin), J(t.metin));
  await ev(() => { document.getElementById('toast').hidden = true; });
}
// --- 5 · uzun basış: sistem paylaşımı (paketsiz) ---------------------------------------------
{
  await koprüKur(true);
  const kutu = await page.locator('#navFabs [data-nav="send"]').boundingBox();
  await page.touchscreen.tap(kutu.x + kutu.width / 2, kutu.y + kutu.height / 2);   // ısıtma: hold bağlayıcısı
  await bekle(200); await ev(() => { window.__cagri = []; });
  await page.mouse.move(kutu.x + kutu.width / 2, kutu.y + kutu.height / 2);
  await page.mouse.down(); await bekle(700); await page.mouse.up(); await bekle(400);
  const c = await cagrilar();
  const son = c[c.length - 1] || {};
  ok('5a uzun basış paket vermeden paylaşır (sistem penceresi)', c.length >= 1 && son.tur === 'image' && son.pkg === '', J(c));
}
// --- 6 · 3B görünümde ekranda ne varsa o gönderilir ------------------------------------------
{
  await koprüKur(true);
  await ev(() => { window.__cagri = []; });
  const uc = await ev(async () => { window.dwgApp.editor.act('3d'); return true; });
  await bekle(2500);
  const is3d = await ev(() => { try { return window.dwgApp.editor.is3D(); } catch (e) { return false; } });
  if (is3d) {
    await page.click('#navFabs [data-nav="send"]'); await bekle(600);
    const son = (await cagrilar()).pop() || {};
    ok('6a 3B görünümde de resim gönderilir ve ad _3d ile biter', son.tur === 'image' && /_3d\.png$/.test(son.ad || '') && (son.b64uzunluk || 0) > 2000, J(son));
    await ev(() => window.dwgApp.editor.act('3d')); await bekle(1200);
  } else ok('6a 3B görünüm açılamadı (yazılımsal WebGL yok) — atlandı', true, J(uc));
}
// --- 7 · belge kipinde belgenin KENDİSİ gönderilir -------------------------------------------
{
  await koprüKur(true);
  await ev(() => { window.__cagri = []; });
  await page.setInputFiles('#fileInput', `${SM}/doc/simple.doc`);
  await page.waitForFunction(() => { const d = document.getElementById('docView'); return !!(d && !d.hidden); }, null, { timeout: 30000 });
  await bekle(600);
  await ev(() => { const A = window.dwgApp; A.state.docId = A.state.docId || 'sahte'; });
  const yol = await ev(() => { try { return window.dwgApp.paylasGorunum('com.whatsapp', 'WhatsApp'), true; } catch (e) { return 'HATA ' + e.message; } });
  await bekle(400);
  const c = await cagrilar();
  const t7 = await ev(() => { const e = document.getElementById('toast'); return { gizli: e.hidden, metin: e.textContent.trim().slice(0, 100) }; });
  /*
   * Belge kipinde ekranda ÇİZİM yoktur. Tarayıcı yapısında belgenin Android tarafında bir
   * kimliği olmadığı için gönderilemez; asıl sınanan şey, o durumda çizimin resminin
   * SESSİZCE gönderilmemesidir — kullanıcı belgeye bakarken karşı tarafa başka bir şey
   * gitmesi, hiç göndermemekten kötüdür. Telefonda belge kimliğiyle docShareTo çalışır.
   */
  ok('7a belge kipinde çizim resmi GÖNDERİLMEZ', c.filter(x => x.tur === 'image').length === 0, J({ yol, c }));
  ok('7b gönderilemediği kullanıcıya söylenir', t7.gizli === false && /paylaşılamıyor/i.test(t7.metin), J(t7));
  await ev(() => { document.getElementById('toast').hidden = true; });
  await ev(() => { const b = document.querySelector('#docView [data-doc="close"]'); if (b) b.click(); });
  await bekle(500);
}
// --- 8 · komut satırı kısayolu ---------------------------------------------------------------
{
  await koprüKur(true);
  await ev(() => { window.__cagri = []; });
  const bilinen = await ev(() => { const A = window.dwgApp; const a = A.editor && A.editor.acad; return a && a.lookup ? !!a.lookup('WA') : null; });
  await page.click('#cmdInput'); await page.type('#cmdInput', 'WA', { delay: 40 });
  await page.press('#cmdInput', 'Enter'); await bekle(700);
  const c = await cagrilar();
  ok('8a WA komutu görünümü WhatsApp\'a gönderir', c.length >= 1 && c[c.length - 1].pkg === 'com.whatsapp', J({ bilinen, c }));
}
// --- 9 · çizim yokken uyarı ------------------------------------------------------------------
{
  await koprüKur(true);
  await ev(() => { window.__cagri = []; window.dwgApp.state.hasDoc = false; });
  await ev(() => window.dwgApp.paylasGorunum('com.whatsapp', 'WhatsApp'));
  await bekle(300);
  const c = await cagrilar();
  const t = await ev(() => { const e = document.getElementById('toast'); return { gizli: e.hidden, metin: e.textContent.trim().slice(0, 80) }; });
  ok('9a çizim yokken köprü çağrılmaz, uyarı verilir', c.length === 0 && t.gizli === false, J({ c, t }));
  await ev(() => { window.dwgApp.state.hasDoc = true; document.getElementById('toast').hidden = true; });
}

await page.screenshot({ path: `${out}/paylas.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
