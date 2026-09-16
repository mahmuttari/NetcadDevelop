/*
 * BULUT YAZMA — Drive paylaşım bağlantısı ve WebDAV/Nextcloud yazma.
 *
 * Rakip (DWG FastView) bulut depolamayı Premium'da veriyor; bizde Drive'a yükleme vardı ama
 * yüklenen dosya için PAYLAŞIM BAĞLANTISI üretilemiyordu (GoogleDrive.java yalnız webViewLink
 * okuyordu, permissions POST'u yoktu) ve WebDAV tek yönlüydü (yalnız okuma).
 *
 * Burada sınanan, ağ değil SÖZLEŞMEdir: köprü çağrılarının adı ve argümanları, kademe kapıları,
 * çakışma akışı (çakışma hata değil SORUdur) ve arayüzün doğru düğmeleri göstermesi. Gerçek
 * sunucuya bağlanılmaz; köprü sahte bir nesneyle değiştirilir ve çağrılar kaydedilir.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_bulut_yazma.mjs
 */
import { args, startServer, launchBrowser, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';

args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message.slice(0, 200)); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
try { await page.click('#tourSkip', { timeout: 3000 }); } catch (_) { /* tur yok */ }
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- A) Kademe: iki yeni kimlik Premium kapısında ------------------------------------------
{
  const r = await ev(async () => {
    const Ed = await import('./edition.js');
    const m = {}; for (const [id, x] of Ed.FEATURE_TIER) m[id] = x;
    return { share: m.driveShare, write: m.webdavWrite, upload: m.driveUpload };
  });
  ok('A1 driveShare Premium kapısında', r.share === 'premium', String(r.share));
  ok('A2 webdavWrite Premium kapısında', r.write === 'premium', String(r.write));
  ok('A3 yükleme ile paylaşım aynı basamakta (aynı iş akışının devamı)', r.share === r.upload, `${r.share} / ${r.upload}`);
}

// ---- B) Drive paylaşımı: köprü çağrısının adı ve argümanları --------------------------------
{
  const r = await ev(async () => {
    const D = await import('./drive.js');
    const cagri = [];
    window.Android = {
      gDrive: (reqId, op, argsJson) => {
        const a = JSON.parse(argsJson || '{}');
        cagri.push({ op, a });
        const yanit = op === 'share'
          ? { permissionId: 'perm1', type: a.type, role: a.role, id: a.id, name: 'pafta.dwg', link: 'https://drive.google.com/file/d/X/view' }
          : op === 'permissions' ? { permissions: [{ id: 'own', type: 'user', role: 'owner', displayName: 'Sahip' }, { id: 'perm1', type: 'anyone', role: 'reader' }] } : {};
        setTimeout(() => window.dwgApp.onDrive(reqId, true, JSON.stringify(yanit)), 0);
      },
      copy: () => {},
    };
    // "bağlantısı olan herkes" + yalnız görüntüleme; uyarı kutusuna evet
    window.dwgApp.__queue = null;
    return { cagri, D: !!D.shareDialog };
  });
  ok('B1 shareDialog dışa verilmiş', r.D === true);
}
{
  await queueAnswers(page, { who: 'anyone', role: 'reader', email: '' }, true);   // ikinci yanıt: 'herkes' uyarı kutusuna evet
  const r = await ev(async () => {
    const D = await import('./drive.js');
    const cagri = [];
    window.Android = {
      gDrive: (reqId, op, argsJson) => {
        cagri.push({ op, a: JSON.parse(argsJson || '{}') });
        setTimeout(() => window.dwgApp.onDrive(reqId, true, JSON.stringify({ permissionId: 'perm1', link: 'https://drive.google.com/file/d/X/view', name: 'pafta.dwg' })), 0);
      },
      copy: () => {},
    };
    await D.shareDialog({ id: 'F1', name: 'pafta.dwg', link: '' });
    await new Promise(r2 => setTimeout(r2, 250));
    return { cagri, panel: !document.getElementById('docPanel').hidden, metin: (document.getElementById('docBody') || {}).textContent || '' };
  });
  const sh = r.cagri.find(c => c.op === 'share');
  ok('B2 "Paylaş" köprüye share çağrısı gönderiyor', !!sh, JSON.stringify(r.cagri.map(c => c.op)));
  ok('B3 argümanlar doğru: dosya kimliği, tür ve yetki', sh && sh.a.id === 'F1' && sh.a.type === 'anyone' && sh.a.role === 'reader', JSON.stringify(sh && sh.a));
  ok('B4 "herkes" seçiminde bildirim e-postası istenmiyor', sh && sh.a.notify === false, JSON.stringify(sh && sh.a.notify));
  ok('B5 sonuç panelinde paylaşım bağlantısı görünüyor', /drive\.google\.com/.test(r.metin), r.metin.slice(0, 140));
}
// E-posta boşken "belirli kişi" seçilirse istek GÖNDERİLMEZ
{
  await queueAnswers(page, { who: 'user', role: 'reader', email: '' });
  const r = await ev(async () => {
    const D = await import('./drive.js');
    const cagri = [];
    window.Android = { gDrive: (reqId, op, aj) => { cagri.push(op); setTimeout(() => window.dwgApp.onDrive(reqId, true, '{}'), 0); }, copy: () => {} };
    await D.shareDialog({ id: 'F1', name: 'pafta.dwg', link: '' });
    await new Promise(r2 => setTimeout(r2, 200));
    return cagri;
  });
  ok('B6 e-posta boşken paylaşım isteği gönderilmiyor', r.length === 0, JSON.stringify(r));
}

// ---- C) WebDAV yazma sözleşmesi ------------------------------------------------------------
{
  const r = await ev(async () => {
    const Cl = await import('./cloud.js');
    return { upload: typeof Cl.uploadBytes, prog: typeof Cl.onProgress, wd: typeof Cl.wd };
  });
  ok('C1 cloud.js yazma yolunu dışa veriyor (uploadBytes, onProgress)',
    r.upload === 'function' && r.prog === 'function' && r.wd === 'function', JSON.stringify(r));
}
{
  // Çakışma HATA DEĞİL SORUdur: Java {exists:true} döndüğünde kullanıcıya üç seçenek sunulur
  await queueAnswers(page, { k: 'over' });
  const r = await ev(async () => {
    const Cl = await import('./cloud.js');
    const cagri = [];
    window.Android = {
      wd: (reqId, op, argsJson) => {
        const a = JSON.parse(argsJson || '{}');
        cagri.push({ op, a });
        const ilk = cagri.filter(c => c.op === 'upload').length === 1;
        const yanit = op === 'upload'
          ? (ilk && !a.overwrite ? { exists: true, path: a.path + a.name, name: a.name } : { ok: true, path: a.path + a.name, name: a.name, size: 10 })
          : { ok: true };
        setTimeout(() => window.dwgApp.onWebDav(reqId, true, JSON.stringify(yanit)), 0);
      },
      wdAccounts: () => JSON.stringify([{ id: 'a1', name: 'Kurum', url: 'https://ornek/dav/', user: 'u' }]),
    };
    window.dwgApp.goHome();
    document.querySelector('#homeNav [data-home-tab="cloud"]').click();
    await new Promise(r2 => setTimeout(r2, 150));
    Cl.openAccount({ id: 'a1', name: 'Kurum', url: 'https://ornek/dav/' });
    await new Promise(r2 => setTimeout(r2, 200));
    await Cl.uploadBytes('AAA=', 'pafta.dwg');
    await new Promise(r2 => setTimeout(r2, 300));
    return cagri;
  });
  const ups = r.filter(c => c.op === 'upload');
  ok('C2 yükleme köprüye upload çağrısı gönderiyor', ups.length >= 1, JSON.stringify(r.map(c => c.op)));
  ok('C3 ilk istek üzerine yazmayı İSTEMEZ (çakışma önce sorulur)', ups[0] && !ups[0].a.overwrite, JSON.stringify(ups[0] && ups[0].a));
  ok('C4 kullanıcı "üzerine yaz" deyince ikinci istek overwrite:true ile gidiyor',
    ups.length === 2 && ups[1].a.overwrite === true, JSON.stringify(ups.map(u => u.a.overwrite)));
  ok('C5 hedef klasör ve dosya adı argümanlarda', ups[0] && ups[0].a.path === '/' && ups[0].a.name === 'pafta.dwg', JSON.stringify(ups[0] && [ups[0].a.path, ups[0].a.name]));
}
{
  // Gezgin araç çubuğunda yükleme ve yeni klasör düğmeleri, satırlarda menü düğmesi
  // Rozet denetimi ücretsiz sürümde yapılır: tarayıcıda varsayılan basamak 'super'dır (edition.js:63)
  await ev(async () => {
    const Ed = await import('./edition.js');
    window.__edition = 'free';
    if (Ed.onEdition) Ed.onEdition('free');
    const Cl = await import('./cloud.js');
    Cl.openAccount({ id: 'a1', name: 'Kurum', url: 'https://ornek/dav/' });
  });
  await page.waitForTimeout(300);
  const r = await ev(() => ({
    up: !!document.querySelector('#cloudBody [data-cloud="wd-upload"]'),
    mk: !!document.querySelector('#cloudBody [data-cloud="wd-mkdir"]'),
    menu: document.querySelectorAll('#cloudBody .wd-item [data-cloud="menu"]').length,
    kilit: [...document.querySelectorAll('#cloudBody [data-cloud="wd-upload"],#cloudBody [data-cloud="wd-mkdir"]')].every(b => b.hasAttribute('data-need')),
  }));
  ok('C6 gezginde yükleme ve yeni klasör düğmeleri var', r.up && r.mk, JSON.stringify(r));
  ok('C7 ücretsiz sürümde iki düğme de Premium rozetli', r.kilit === true, String(r.kilit));
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
