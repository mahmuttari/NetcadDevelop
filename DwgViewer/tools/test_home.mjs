// Ana ekran (home.js), bulut (cloud.js: WebDAV köprü taklidi) ve belge kipi (body.docmode) sınaması.
//  1) Tarayıcı, Ücretsiz: dört sekme ve alt gezinme, Dosya › Yerel içinde Cihaz gezgini (folderInput → satırlar → DWG açılır, ana ekran
//     gizlenir, şerit görünür), Diğer › Ana ekran, Bulut kartları (Google Drive · WebDAV · Sunucu), Araçlar ızgarası (PRO rozetleri,
//     Pro paneli, "Önce bir çizim açın"), belge kipi (PDF: şerit / durum çubuğu / üst çubuk çizim düğmeleri gizli, menüde yalnız genel
//     eylemler), belge kapanınca çizim varken şerit geri gelir.
//  2) Sahte Android köprüsü, Pro: belge kapanınca çizim yokken ana ekran; WebDAV hesap formu (wdSave), gezgin (wd list), indirme
//     (wd download → openRegistered → PdfRenderer yolu), hesap kaldırma (wdRemove); Araçlar'da rozet yok.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_home.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];
const hook = (page) => {
  page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });   // pdfpage_* taklit ortamda 404
  onDialog(page, async d => { await d.dismiss(); });
};
const sampleFiles = fs.readdirSync(SM).filter(f => !f.startsWith('.'));
const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>`;
fs.writeFileSync(path.join(out, 'test.pdf'), pdf);
const GENERAL = ['drive', 'server', 'qr', 'settings', 'about', 'pro', 'home'];
/** görünür ölçüler: display none ise 0 */
const shellState = () => ({
  home: !document.getElementById('home').hidden, homemode: document.body.classList.contains('homemode'), docmode: document.body.classList.contains('docmode'),
  top: getComputedStyle(document.getElementById('topbar')).display, tb: document.getElementById('toolbar').getBoundingClientRect().height, tbDisp: getComputedStyle(document.getElementById('toolbar')).display,
  st: document.getElementById('statusbar').getBoundingClientRect().height, tabs: getComputedStyle(document.getElementById('layoutTabs')).display,
  btns: ['btnSearch', 'btnExtents', 'btnLayers', 'btnMeasure'].map(id => getComputedStyle(document.getElementById(id)).display), open: getComputedStyle(document.getElementById('btnOpen')).display, more: getComputedStyle(document.getElementById('btnMore')).display,
  hasDoc: window.dwgApp.state.hasDoc, docView: !document.getElementById('docView').hidden,
});
const menuVisible = () => [...document.querySelectorAll('#moreMenu [data-act]')].filter(b => !b.hidden && b.offsetParent !== null).map(b => b.dataset.act).sort();

// ---------------------------------------------------------------------------------
// 1) Tarayıcı, Ücretsiz sürüm
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  await ctx.addInitScript(() => { window.__edition = 'free'; });
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const toastText = () => ev(() => { const el = document.getElementById('toast'); return el.hidden ? '' : el.querySelector('.tx').textContent; });
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
  // ana ekran açılışta
  {
    const r = await ev(shellState);
    ok('1a açılışta ana ekran: body.homemode, üst çubuk / şerit / durum çubuğu gizli', r.home && r.homemode && r.top === 'none' && r.tbDisp === 'none' && r.st === 0 && !r.hasDoc, JSON.stringify(r));
    const n = await ev(() => ({ nav: document.querySelectorAll('#homeNav [data-home-tab]').length, on: document.querySelector('#homeNav [data-home-tab].on')?.dataset.homeTab, ev: !document.getElementById('homeEv').hidden, ids: ['btnOpen2', 'fileInput', 'recentList', 'recentWrap', 'proLine', 'btnServer', 'btnQr', 'btnDrive', 'recentAll'].every(id => !!document.getElementById(id)), proLine: !document.getElementById('proLine').hidden, h: Math.min(...[...document.querySelectorAll('#homeNav button')].map(b => b.getBoundingClientRect().height)) }));
    ok('1b alt gezinme 4 öğe, Ev etkin, Ev kimlikleri korunmuş, ücretsizde Pro satırı', n.nav === 4 && n.on === 'ev' && n.ev && n.ids && n.proLine && n.h >= 48, JSON.stringify(n));
    await shot('home_ev');
    ok('1c #btnOpen2 → Dosya Aç merkezi', await (async () => { await page.click('#btnOpen2'); await page.waitForTimeout(80); const r2 = await ev(() => !document.getElementById('openPanel').hidden); await ev(() => window.dwgApp.onBack()); return r2; })());
  }
  // Dosya › Yerel: gömülü Cihaz gezgini
  await page.click('#homeNav [data-home-tab="files"]'); await page.waitForTimeout(80);
  {
    const r = await ev(() => ({ page: !document.getElementById('homeFiles').hidden, seg: document.querySelector('#filesSeg [data-fseg].on')?.dataset.fseg, add: !!document.querySelector('#filesDevice [data-open="addroot"]'), search: !!document.querySelector('#filesDevice .open-msearch'), tab: localStorage.getItem('home:tab'), mounted: window.dwgApp.open.isMounted(), panel: document.getElementById('openPanel').hidden }));
    ok('1d Dosya › Yerel: Cihaz gezgini gömülü (Klasör ekle, arama), sekme hatırlanır, #openPanel kapalı', r.page && r.seg === 'local' && r.add && r.search && r.tab === 'files' && r.mounted && r.panel, JSON.stringify(r));
    await page.setInputFiles('#folderInput', SM);
    await page.waitForFunction((n) => document.querySelectorAll('#filesDevice [data-open-entry]').length >= n, sampleFiles.length, { timeout: 10000 });
    const r2 = await ev(() => ({ crumb: document.querySelector('#filesDevice [data-open-crumb="-1"]')?.textContent.trim(), n: document.querySelectorAll('#filesDevice [data-open-entry]').length, h: Math.min(...[...document.querySelectorAll('#filesDevice .open-item')].map(e => e.getBoundingClientRect().height)) }));
    ok('1e klasör yüklendi: kırıntı + satırlar (48 px)', r2.crumb === 'samples' && r2.n === sampleFiles.length && r2.h >= 48, JSON.stringify(r2));
    await shot('home_dosya_yerel');
    await page.fill('#filesDevice .open-msearch', 'pface');
    await page.waitForFunction(() => /pface/.test(document.querySelector('#filesDevice .muted')?.textContent || ''), null, { timeout: 5000 });
    ok('1f gömülü arama', await ev(() => [...document.querySelectorAll('#filesDevice [data-open-entry]')].every(r => /pface/i.test(r.dataset.name))));
    await page.fill('#filesDevice .open-msearch', '');
    await page.waitForFunction((n) => document.querySelectorAll('#filesDevice [data-open-entry]').length === n, sampleFiles.length, { timeout: 5000 });
  }
  // panelin (Son sekmesi) araması gömülü Cihaz görünümüne sızmaz ve cihaz taraması başlatmaz
  await page.click('#homeNav [data-home-tab="ev"]'); await page.click('#btnOpen2'); await page.waitForTimeout(80);
  await page.click('#openPanel [data-open-tab="recent"]'); await page.fill('#openSearch', 'zzz'); await page.waitForTimeout(400);
  {
    const r = await ev((n) => ({ panelTab: document.querySelector('#openPanel [data-open-tab].on')?.dataset.openTab, mq: document.querySelector('#filesDevice .open-msearch')?.value, mn: document.querySelectorAll('#filesDevice [data-open-entry]').length, msearch: /zzz/.test(document.getElementById('filesDevice').textContent), n }), sampleFiles.length);
    ok('1f2 panel Son araması gömülü Cihaz listesine sızmaz (sorgu boş, liste tam, tarama yok)', r.panelTab === 'recent' && r.mq === '' && r.mn === r.n && !r.msearch, JSON.stringify(r));
  }
  await page.fill('#openSearch', ''); await page.waitForTimeout(300); await ev(() => window.dwgApp.onBack());
  await page.click('#homeNav [data-home-tab="files"]'); await page.waitForTimeout(60);
  // Dosya › Bulut kartları (tarayıcı)
  await page.click('#filesSeg [data-fseg="cloud"]'); await page.waitForTimeout(80);
  {
    const r = await ev(() => ({ drive: document.querySelector('#filesCloud [data-cloud-svc="drive"] [data-cloud="drive-in"]')?.textContent.trim(), wd: !!document.querySelector('#filesCloud [data-cloud-svc="webdav-add"] [data-cloud="wd-add"]'), srv: !!document.querySelector('#filesCloud [data-cloud-svc="server"]'), none: !document.querySelector('#filesCloud [data-cloud-svc="dropbox"], #filesCloud [data-cloud-svc="onedrive"], #filesCloud [data-cloud-svc="box"]'), cards: document.querySelectorAll('#filesCloud .cloud-card').length, h: Math.min(...[...document.querySelectorAll('#filesCloud .cloud-card')].map(c => c.getBoundingClientRect().height)) }));
    ok('1g Bulut kartları: Google Drive "Oturum aç", WebDAV, Sunucu dizini; Dropbox/OneDrive/Box yok', r.drive === 'Oturum aç' && r.wd && r.srv && r.none && r.cards === 3 && r.h >= 56, JSON.stringify(r));
    await page.click('#filesCloud [data-cloud="wd-add"]'); await page.waitForTimeout(80);
    ok('1h tarayıcıda WebDAV → "Android uygulamasında" açıklaması, form açılmaz', /Android/.test(await toastText()) && await ev(() => document.getElementById('docPanel').hidden));
    await page.click('#filesCloud [data-cloud="server"]'); await page.waitForTimeout(80);
    ok('1i Sunucu dizini → sunucu kutusu', await ev(() => !document.getElementById('docPanel').hidden && !!document.getElementById('srvUrl')));
    await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(50);
  }
  // Bulut sekmesi: hizmet yok
  await page.click('#homeNav [data-home-tab="cloud"]'); await page.waitForTimeout(80);
  ok('1j Bulut sekmesi: hesap yok açıklaması + Dosya › Bulut bağlantısı', await ev(() => !document.getElementById('homeCloud').hidden && !!document.querySelector('#cloudBody .cloud-empty') && !!document.querySelector('#cloudBody [data-cloud="gofiles"]')));
  await shot('home_bulut');
  await page.click('#cloudBody [data-cloud="gofiles"]'); await page.waitForTimeout(80);
  ok('1k bağlantı → Dosya › Bulut', await ev(() => !document.getElementById('homeFiles').hidden && document.querySelector('#filesSeg [data-fseg="cloud"]').classList.contains('on')));
  // Araçlar
  await page.click('#homeNav [data-home-tab="tools"]'); await page.waitForTimeout(80);
  {
    const r = await ev(() => { const g = document.getElementById('toolsGrid'); const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length; const tools = [...g.querySelectorAll('[data-tool]')]; return { cols, n: tools.length, badges: tools.filter(b => b.querySelector('.pro-badge')).map(b => b.dataset.tool).sort(), colored: tools.every(b => /tool-c[1-8]/.test(b.querySelector('.tool-ic').className)), ic: tools.every(b => b.querySelector('.tool-ic svg.ic use')), lb: tools.every(b => b.querySelector('.lb').textContent.trim().length > 0) }; });
    ok('1l Araçlar: 4 sütun, 19 araç, renkli simgeler, ad; ücretsizde 6 PRO rozeti', r.cols === 4 && r.n === 19 && r.colored && r.ic && r.lb && JSON.stringify(r.badges) === JSON.stringify(['compare', 'notes', 'pdf', 'profile', 'savedelta', 'savedxf']), JSON.stringify(r));
    await shot('home_araclar');
    await page.click('#toolsGrid [data-tool="measure"]'); await page.waitForTimeout(80);
    ok('1m çizim gerektiren araç, belge yokken → "Önce bir … açın"', /Önce bir/.test(await toastText()) && await ev(() => !document.getElementById('home').hidden));
    await page.click('#toolsGrid [data-tool="pdf"]'); await page.waitForTimeout(80);
    ok('1n Pro aracı (ücretsiz) → Pro paneli', await ev(() => !document.getElementById('proPanel').hidden));
    await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(50);
    ok('1o geri: Pro paneli kapandı, ana ekran duruyor', await ev(() => document.getElementById('proPanel').hidden && !document.getElementById('home').hidden));
    await page.click('#toolsGrid [data-tool="settings"]'); await page.waitForTimeout(100);
    ok('1p Ayarlar aracı belge gerektirmez', await ev(() => !document.getElementById('docPanel').hidden && !!document.getElementById('sSave')));
    await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(50);
  }
  // geri tuşu: Araçlar → Ev → (uygulama)
  {
    const b1 = await ev(() => window.dwgApp.onBack());
    const b2 = await ev(() => window.dwgApp.onBack());
    ok('1q geri: sekme Ev değilse Ev\'e (true), Ev\'de false', b1 === true && b2 === false && await ev(() => document.querySelector('#homeNav [data-home-tab].on').dataset.homeTab === 'ev'));
  }
  // Dosya › Yerel'den DWG aç → ana ekran gizlenir, şerit görünür
  await page.click('#homeNav [data-home-tab="files"]'); await page.click('#filesSeg [data-fseg="local"]'); await page.waitForTimeout(80);
  await page.waitForFunction(() => !!document.querySelector('#filesDevice [data-open-entry][data-name="example_2000.dwg"]'), null, { timeout: 5000 });
  await page.click('#filesDevice [data-open-entry][data-name="example_2000.dwg"]');
  await page.waitForFunction(() => window.dwgApp.state.hasDoc && window.dwgApp.state.fileName === 'example_2000.dwg' && document.getElementById('loading').hidden, null, { timeout: 120000 }); await page.waitForTimeout(400);
  await ev(() => { document.getElementById('toast').hidden = true; });
  {
    const r = await ev(shellState);
    ok('1r DWG açıldı: ana ekran gizli, homemode yok, üst çubuk ve şerit görünür, durum çubuğu var', r.hasDoc && !r.home && !r.homemode && r.top !== 'none' && r.tb > 50 && r.st > 30 && !r.docmode, JSON.stringify(r));
    ok('1s gömme kaldırıldı (unmount)', await ev(() => !window.dwgApp.open.isMounted() && document.getElementById('filesDevice').innerHTML === ''));
  }
  // Diğer › Ana ekran
  await page.click('#btnMore'); await page.waitForTimeout(80);
  ok('1t çizim açıkken menüde "Ana ekran" görünür', await ev(() => { const b = document.querySelector('#moreMenu [data-act="home"]'); return !!b && !b.hidden && b.offsetParent !== null; }));
  await page.click('#moreMenu [data-act="home"]'); await page.waitForTimeout(100);
  {
    const r = await ev(shellState);
    ok('1u Ana ekran: home görünür, şerit gizli, çizim bellekte (hasDoc)', r.home && r.homemode && r.tbDisp === 'none' && r.top === 'none' && r.hasDoc, JSON.stringify(r));
    ok('1v Ev: Son dosyalar ızgarasında açılan dosya', await ev(() => !document.getElementById('recentWrap').hidden && !!document.querySelector('#recentList .item[data-name="example_2000.dwg"]')));
    // Araçlar: çizim varken araç çizime döner
    await page.click('#homeNav [data-home-tab="tools"]'); await page.waitForTimeout(60);
    await page.click('#toolsGrid [data-tool="layers"]'); await page.waitForTimeout(150);
    ok('1w Araçlar › Katmanlar (çizim varken): ana ekran kapanır, katman paneli açılır', await ev(() => document.getElementById('home').hidden && !document.getElementById('layerPanel').hidden));
    await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(60);
    await ev(() => window.dwgApp.goHome()); await page.waitForTimeout(60);
    await page.click('#homeNav [data-home-tab="ev"]'); await page.waitForTimeout(60);
    await page.click('#recentList .item[data-name="example_2000.dwg"]');
    await page.waitForFunction(() => window.dwgApp.state.hasDoc && document.getElementById('loading').hidden && document.getElementById('home').hidden, null, { timeout: 120000 }); await page.waitForTimeout(300);
    ok('1x Son\'dan dokununca çizim yeniden yüklenir, ana ekran gizlenir', await ev(() => window.dwgApp.state.fileName === 'example_2000.dwg' && !document.body.classList.contains('homemode')));
    await ev(() => { document.getElementById('toast').hidden = true; });
  }
  // belge kipi: PDF (çizim bellekte)
  await ev(() => window.dwgApp.setMode('measure'));
  await page.setInputFiles('#fileInput', path.join(out, 'test.pdf')); await page.waitForTimeout(400);
  {
    const r = await ev(shellState);
    ok('1y PDF açık: docmode; şerit / durum çubuğu / sayfa sekmeleri / üst çubuk çizim düğmeleri gizli; Aç ve Diğer görünür', r.docView && r.docmode && !r.home && r.tbDisp === 'none' && r.tb === 0 && r.st === 0 && r.tabs === 'none' && r.btns.every(d => d === 'none') && r.open !== 'none' && r.more !== 'none', JSON.stringify(r));
    ok('1z belge kipine girerken ölçü / komut çubuğu / paneller kapanır', await ev(() => window.dwgApp.state.mode === 'view' && document.getElementById('measurePanel').hidden && document.getElementById('cmdBar').hidden && document.getElementById('notesBar').hidden));
    ok('1aa belge görünümünün kendi şeridi duruyor', await ev(() => !!document.querySelector('#docView .doc-head [data-doc="close"]') && !!document.querySelector('#docContent embed.doc-embed')));
    await shot('docmode_pdf');
    await page.click('#btnMore'); await page.waitForTimeout(80);
    const vis = await ev(menuVisible);
    ok('1ab Diğer menüsünde yalnız genel eylemler (drive, server, qr, settings, about, pro, home)', JSON.stringify(vis) === JSON.stringify(GENERAL.slice().sort()), vis.join(','));
    await ev(() => window.dwgApp.onBack());
    await ev(() => window.dwgApp.docs.close()); await page.waitForTimeout(150);
    const r2 = await ev(shellState);
    ok('1ac belge kapanınca (çizim varken) şerit, durum çubuğu ve düğmeler geri gelir; ana ekran açılmaz', !r2.docView && !r2.docmode && !r2.home && r2.tb > 50 && r2.st > 30 && r2.btns.every(d => d !== 'none') && r2.hasDoc, JSON.stringify(r2));
    await page.click('#btnMore'); await page.waitForTimeout(80);
    const vis2 = await ev(menuVisible);
    ok('1ad çizimde menü çizim eylemlerini yeniden gösterir (info, layouts, png…), Pro eylemleri ücretsizde gizli', ['info', 'layouts', 'png', 'gps', 'basemap', 'views', 'display', 'home'].every(a => vis2.includes(a)) && !['notes', 'profile', 'compare', 'pdf'].some(a => vis2.includes(a)), vis2.join(','));
    await ev(() => window.dwgApp.onBack());
  }
  // yatay düzen: alt gezinme altta, gövde kaydırılabilir
  await ev(() => window.dwgApp.goHome()); await page.waitForTimeout(60);
  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(300);
  {
    const r = await ev(() => { const n = document.getElementById('homeNav').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(); return { bottom: Math.abs(n.bottom - a.bottom) < 2, w: Math.round(n.width), aw: Math.round(a.width), tb: getComputedStyle(document.getElementById('toolbar')).display }; });
    ok('1ae yatayda alt gezinme tam genişlik altta, şerit gizli', r.bottom && r.w === r.aw && r.tb === 'none', JSON.stringify(r));
  }
  await page.setViewportSize({ width: 412, height: 915 }); await page.waitForTimeout(200);
  // i18n: İngilizce
  await ev(async () => { const i = await import('./i18n.js'); i.setLang('en'); i.applyI18n(); window.dispatchEvent(new CustomEvent('dwg:lang')); }); await page.waitForTimeout(80);
  {
    const r = await ev(() => ({ nav: [...document.querySelectorAll('#homeNav [data-home-tab] span')].map(s => s.textContent.trim()), raw: /(^|\s)(home|tool|webdav|cloud)[A-Z]\w*/.test(document.getElementById('home').innerText) }));
    ok('1af İngilizce alt gezinme, ham anahtar yok', JSON.stringify(r.nav) === JSON.stringify(['Home', 'Files', 'Cloud', 'Tools']) && !r.raw, JSON.stringify(r));
  }
  // gömülü Cihaz gezgini dil değişince yenilenir (arama yer tutucusu dâhil)
  await page.click('#homeNav [data-home-tab="files"]'); await page.click('#filesSeg [data-fseg="local"]'); await page.waitForTimeout(60);
  const phEn = await ev(() => document.querySelector('#filesDevice .open-msearch')?.placeholder);
  await ev(async () => { const i = await import('./i18n.js'); i.setLang('tr'); i.applyI18n(); window.dispatchEvent(new CustomEvent('dwg:lang')); }); await page.waitForTimeout(60);
  const phTr = await ev(() => document.querySelector('#filesDevice .open-msearch')?.placeholder);
  ok('1af2 gömülü arama yer tutucusu dille değişir (EN → TR)', phEn === 'Search files…' && phTr === 'Dosya ara…', phEn + ' / ' + phTr);
  ok('1ag tarayıcı bölümü: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
  await ctx.close();
}

// ---------------------------------------------------------------------------------
// 2) Sahte Android köprüsü (Pro): belge kipi çizim yokken, WebDAV
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  await ctx.addInitScript(() => {
    const calls = (window.__calls = []);
    const accs = (window.__wd = []);
    const tree = { '/': [{ name: 'Projeler', path: '/Projeler/', dir: true, size: 0, time: 0, mime: '' }, { name: 'plan.pdf', path: '/plan.pdf', dir: false, size: 1234, time: 1700000000000, mime: 'application/pdf' }], '/Projeler/': [{ name: 'kesit.dwg', path: '/Projeler/kesit.dwg', dir: false, size: 5000, time: 1700000100000, mime: 'application/acad' }] };
    const later = (fn) => setTimeout(fn, 20);
    window.Android = {
      wdAccounts: () => JSON.stringify(accs.map(a => ({ id: a.id, name: a.name, url: a.url, user: a.user }))),
      wdSave: (json) => { const o = JSON.parse(json); calls.push(['wdSave', o]); if (/fail/.test(o.url)) return ''; if (!o.id) o.id = 'wd' + (accs.length + 1); const i = accs.findIndex(a => a.id === o.id); if (i >= 0) accs[i] = o; else accs.push(o); return o.id; },
      wdRemove: (id) => { calls.push(['wdRemove', id]); const i = accs.findIndex(a => a.id === id); if (i >= 0) accs.splice(i, 1); },
      wd: (reqId, op, argsJson) => { const a = JSON.parse(argsJson); calls.push(['wd', op, a]); later(() => {
        if (op === 'test') window.dwgApp.onWebDav(reqId, /bad/.test(a.url) ? false : true, /bad/.test(a.url) ? 'Kullanıcı adı ya da parola hatalı' : { ok: true });
        else if (op === 'list') window.dwgApp.onWebDav(reqId, true, JSON.stringify({ items: tree[a.path] || [] }));
        else if (op === 'download') window.dwgApp.onWebDav(reqId, true, { id: 'f_1', name: a.name, size: 1234, ext: 'pdf' });
        else window.dwgApp.onWebDav(reqId, false, 'bilinmeyen işlem');
      }); },
      docOpen: () => JSON.stringify({ id: 'f_1', name: 'plan.pdf', size: 1234, ext: 'pdf' }), pdfInfo: () => JSON.stringify({ pages: 3, sizes: [[595, 842], [595, 842], [842, 595]] }), pdfClose: () => {},
      arcList: () => '[]', arcExtract: () => '{}', docShare: () => {}, docKeep: () => 'dl_x', gAccount: () => '', gConfigured: () => true,
      getPendingFile: () => '', getRecent: () => '[]', pickFile: (p, m) => { calls.push(['pickFile', p, m]); },
      loadText: (k) => localStorage.getItem(k) || '', saveText: (k, v) => localStorage.setItem(k, v),
    };
  });
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  const last = (name) => ev((n) => window.__calls.filter(c => c[0] === n).pop() || null, name);
  const toastText = () => ev(() => { const el = document.getElementById('toast'); return el.hidden ? '' : el.querySelector('.tx').textContent; });
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
  // belge kipi çizim yokken → kapanınca ana ekran
  await page.setInputFiles('#fileInput', path.join(out, 'test.pdf')); await page.waitForTimeout(400);
  {
    const r = await ev(shellState);
    ok('2a çizim yokken PDF: docmode, ana ekran gizli, şerit gizli', r.docView && r.docmode && !r.home && !r.homemode && r.tbDisp === 'none' && !r.hasDoc, JSON.stringify(r));
    await page.click('#btnMore'); await page.waitForTimeout(60);
    const vis = await ev(menuVisible);
    ok('2b Pro + belge kipi: menüde pro yok, yalnız genel eylemler', JSON.stringify(vis) === JSON.stringify(['about', 'drive', 'home', 'qr', 'server', 'settings']), vis.join(','));
    await ev(() => window.dwgApp.onBack());
    await page.click('#docView [data-doc="close"]'); await page.waitForTimeout(150);
    const r2 = await ev(shellState);
    ok('2c belge kapanınca çizim yokken ana ekran', !r2.docView && !r2.docmode && r2.home && r2.homemode && r2.tbDisp === 'none', JSON.stringify(r2));
  }
  // Araçlar: Pro'da rozet yok, "Pro" aracı yok
  await page.click('#homeNav [data-home-tab="tools"]'); await page.waitForTimeout(60);
  ok('2d Pro: PRO rozeti yok, Pro aracı listelenmez (18 araç)', await ev(() => document.querySelectorAll('#toolsGrid .pro-badge').length === 0 && document.querySelectorAll('#toolsGrid [data-tool]').length === 18 && !document.querySelector('#toolsGrid [data-tool="pro"]')));
  // WebDAV hesabı
  await page.click('#homeNav [data-home-tab="files"]'); await page.click('#filesSeg [data-fseg="cloud"]'); await page.waitForTimeout(60);
  await page.click('#filesCloud [data-cloud="wd-add"]'); await page.waitForTimeout(80);
  ok('2e WebDAV formu: adres, kullanıcı, parola, ad, sına, kaydet', await ev(() => !!document.getElementById('wdForm') && ['wdUrl', 'wdUser', 'wdPass', 'wdName', 'wdTest', 'wdSave'].every(id => !!document.getElementById(id)) && document.getElementById('wdPass').type === 'password'));
  await page.click('#wdTest'); await page.waitForTimeout(60);
  ok('2f adres / kullanıcı boşken sınama köprüye gitmez', /gerekli/.test(await toastText()) && await ev(() => !window.__calls.some(c => c[0] === 'wd')));
  await page.fill('#wdUrl', 'https://bad.example.com/dav/'); await page.fill('#wdUser', 'ali'); await page.fill('#wdPass', 'gizli');
  await page.click('#wdTest'); await page.waitForTimeout(150);
  ok('2g sınama başarısız → hata uyarısı (401 iletisi)', /parola hatalı/.test(await toastText()) && JSON.stringify((await last('wd')).slice(1)) === JSON.stringify(['test', { url: 'https://bad.example.com/dav/', user: 'ali', pass: 'gizli' }]), await toastText());
  await page.fill('#wdUrl', 'https://bulut.example.com/remote.php/dav/files/ali/');
  await page.click('#wdTest'); await page.waitForTimeout(150);
  ok('2h sınama başarılı', /başarılı/.test(await toastText()));
  // Java kaydedemedi (wdSave "" döner; Toast'u Java verir): form açık kalır, kart yok, başarı bildirilmez
  await page.fill('#wdUrl', 'https://fail.example.com/remote.php/dav/files/ali/'); await page.fill('#wdName', 'Nextcloud');
  await page.click('#wdSave'); await page.waitForTimeout(100);
  {
    const r = await ev(() => ({ form: !!document.getElementById('wdForm') && !document.getElementById('docPanel').hidden, card: !!document.querySelector('#filesCloud [data-cloud-svc="webdav"]'), pass: document.getElementById('wdPass').value }));
    ok('2h2 wdSave "" (kayıt hatası) → form açık, parola duruyor, kart yok, "kaydedilemedi"', r.form && !r.card && r.pass === 'gizli' && /kaydedilemedi/.test(await toastText()) && !/kaydedildi\b/.test(await toastText()), JSON.stringify(r) + ' ' + await toastText());
  }
  await page.fill('#wdUrl', 'https://bulut.example.com/remote.php/dav/files/ali/');
  await page.click('#wdSave'); await page.waitForTimeout(100);
  {
    const s = await last('wdSave');
    const r = await ev(() => ({ panel: document.getElementById('docPanel').hidden, card: !!document.querySelector('#filesCloud [data-cloud-svc="webdav"][data-wd-id="wd1"]'), name: document.querySelector('#filesCloud [data-cloud-svc="webdav"] b')?.textContent, open: !!document.querySelector('#filesCloud [data-cloud="wd-open"][data-id="wd1"]'), add: document.querySelector('#filesCloud [data-cloud="wd-add"]')?.textContent.trim() }));
    ok('2i Kaydet → wdSave({name,url,user,pass}) → kart: ad + Aç + Çıkış; "Hesap ekle"', s && s[1].name === 'Nextcloud' && s[1].user === 'ali' && s[1].pass === 'gizli' && /remote\.php/.test(s[1].url) && r.panel && r.card && r.name === 'Nextcloud' && r.open && r.add === 'Hesap ekle' && /kaydedildi/.test(await toastText()), JSON.stringify(r));
  }
  // gezgin: Aç → Bulut sekmesi, liste
  await page.click('#filesCloud [data-cloud="wd-open"][data-id="wd1"]');
  await page.waitForFunction(() => document.querySelectorAll('#cloudBody .wd-item').length === 2, null, { timeout: 5000 });
  {
    const r = await ev(() => ({ tab: document.querySelector('#homeNav [data-home-tab].on')?.dataset.homeTab, chip: !!document.querySelector('#cloudBody [data-cloud="wd-sel"].on'), first: document.querySelector('#cloudBody .wd-item')?.dataset.name, icons: [...document.querySelectorAll('#cloudBody .wd-item svg.ic use')].map(u => u.getAttribute('href')), crumbs: document.querySelectorAll('#cloudBody [data-cloud="crumb"]').length }));
    ok('2j Bulut sekmesi: wd list("/") → klasör önce, tür simgeleri, kırıntı', r.tab === 'cloud' && r.chip && r.first === 'Projeler' && r.icons.includes('#i-open') && r.icons.includes('#i-pdf') && r.crumbs === 1 && JSON.stringify((await last('wd')).slice(1)) === JSON.stringify(['list', { id: 'wd1', path: '/' }]), JSON.stringify(r));
    await page.screenshot({ path: `${out}/home_bulut_webdav.png` });
  }
  await page.click('#cloudBody .wd-item[data-dir="1"]');
  await page.waitForFunction(() => document.querySelectorAll('#cloudBody [data-cloud="crumb"]').length === 2 && document.querySelectorAll('#cloudBody .wd-item').length === 1, null, { timeout: 5000 });
  ok('2k klasöre gir: wd list("/Projeler/"), kırıntı 2', JSON.stringify((await last('wd')).slice(1)) === JSON.stringify(['list', { id: 'wd1', path: '/Projeler/' }]) && await ev(() => document.querySelector('#cloudBody .wd-item').dataset.name === 'kesit.dwg'));
  await page.click('#cloudBody [data-cloud="crumb"][data-path="/"]');
  await page.waitForFunction(() => document.querySelectorAll('#cloudBody .wd-item').length === 2, null, { timeout: 5000 });
  await page.click('#cloudBody .wd-item[data-name="plan.pdf"]'); await page.waitForTimeout(400);
  {
    const r = { ...(await ev(shellState)), ...(await ev(() => ({ pages: document.querySelectorAll('#docContent .pdf-page').length, name: document.getElementById('docName').textContent }))) };
    ok('2l dosyaya dokun → wd download → openRegistered (PdfRenderer yolu): belge açık, ana ekran gizli', JSON.stringify((await last('wd')).slice(1)) === JSON.stringify(['download', { id: 'wd1', path: '/plan.pdf', name: 'plan.pdf' }]) && r.docView && r.docmode && !r.home && r.pages === 3 && r.name === 'plan.pdf' && r.tbDisp === 'none', JSON.stringify(r));
  }
  await ev(() => window.dwgApp.docs.close()); await page.waitForTimeout(150);
  ok('2m belge kapanınca ana ekran (Bulut sekmesi hatırlanır)', await ev(() => !document.getElementById('home').hidden && document.querySelector('#homeNav [data-home-tab].on')?.dataset.homeTab === 'cloud'));
  // hesabı kaldır
  await page.click('#homeNav [data-home-tab="files"]'); await page.waitForTimeout(60);
  await queueAnswers(page, true);
  await page.click('#filesCloud [data-cloud="wd-remove"][data-id="wd1"]'); await page.waitForTimeout(100);
  ok('2n Çıkış → wdRemove(id); kart kalkar, Bulut sekmesi boş açıklamaya döner', JSON.stringify(await last('wdRemove')) === JSON.stringify(['wdRemove', 'wd1']) && await ev(() => !document.querySelector('#filesCloud [data-cloud-svc="webdav"]') && document.querySelector('#filesCloud [data-cloud="wd-add"]').textContent.trim() === 'Oturum aç'));
  await page.click('#homeNav [data-home-tab="cloud"]'); await page.waitForTimeout(60);
  ok('2o Bulut sekmesi: hesap yok', await ev(() => !!document.querySelector('#cloudBody .cloud-empty')));
  ok('2p köprü bölümü: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
  await ctx.close();
}
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
