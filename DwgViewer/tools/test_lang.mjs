// Çok dilli arayüz sınaması: onbeş dilin sözlüğü tarayıcıda yüklenir mi, ekrandaki metin gerçekten
// o dile döner mi, Arapça'da belge yönü sağdan sola olur mu, cihaz dili çözümlemesi doğru mu.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_lang.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, noUpdate, checker, PHONE } from './harness.mjs';
const { out } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
/** Türkçe'ye özgü harfler: başka bir dile geçildiğinde ekranda kalmamalı */
const TRc = /[ığşĞİŞ]/;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); const t = document.getElementById('tour'); if (t) t.hidden = true; });

// ---- 1 dil kayıt defteri --------------------------------------------------------------------
const ids = await ev(async () => (await import('./i18n.js')).LANG_IDS);
ok('1a onbeş dil kayıtlı', ids.length === 15 && ids[0] === 'tr' && ids[1] === 'en' && ids.includes('ar') && ids.includes('zh'), ids.join(' '));

const norm = await ev(async () => {
  const i = await import('./i18n.js');
  return ['pt-BR', 'zh-Hant-TW', 'zh_CN', 'in-ID', 'EN-gb', 'de', 'sv-SE', 'xx', ''].map(t => t + '→' + i.normLang(t));
});
ok('1b normLang alt etiketi ve eski kodu çözer', norm.join(' ') === 'pt-BR→pt zh-Hant-TW→zh zh_CN→zh in-ID→id EN-gb→en de→de sv-SE→ xx→ →', norm.join(' '));

const res = await ev(async () => {
  const i = await import('./i18n.js');
  return { pinned: i.resolveLang('ja'), bad: i.resolveLang('sv'), auto: i.resolveLang('auto'), dev: i.deviceLang() };
});
ok('1c sabitlenmiş dil korunur, desteklenmeyen dil cihaza düşer', res.pinned === 'ja' && ids.includes(res.bad) && ids.includes(res.auto) && ids.includes(res.dev), JSON.stringify(res));

// ---- 2 her dil yüklenir ve ekrana yansır ------------------------------------------------------
/** setLang eş zamanlıdır; sözlük dosyası arkadan gelir, bu yüzden loadLang beklenir */
const use = async (id) => {
  await ev(async (id) => { const i = await import('./i18n.js'); await i.loadLang(id); i.setLang(id); i.applyI18n(); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: id } })); }, id);
  await page.waitForTimeout(60);
};
const probe = () => ev(async () => {
  const i = await import('./i18n.js');
  return {
    lang: document.documentElement.lang, dir: document.documentElement.dir,
    open: i.t('open'), settings: i.t('settings'), layers: i.t('layers'), save: i.t('save'),
    tile: i.t('tl_extents'), step: i.t('tstep_line_0'), ety: i.t('ety_CIRCLE'), preset: i.t('v3p_top'),
    dom: document.getElementById('btnOpen2') ? document.getElementById('btnOpen2').innerText : '',
  };
});
const seen = new Map();
for (const id of ids) {
  await use(id);
  const p = await probe();
  const key = [p.open, p.settings, p.layers, p.save, p.tile, p.step, p.ety, p.preset].join('|');
  ok(`2 ${id}: sözlük yüklendi ve <html lang> kuruldu`, p.lang === id && !!p.open && !!p.step && !!p.ety && !!p.preset && !/^(open|settings|tl_|tstep_|ety_|v3p_)/.test(key), JSON.stringify(p));
  if (id !== 'tr') ok(`2 ${id}: Türkçe'ye özgü harf kalmadı`, !TRc.test(key), key);
  const clash = [...seen.entries()].find(([, v]) => v === key);
  ok(`2 ${id}: sözlük başka bir dilin kopyası değil`, !clash, clash ? clash[0] : '');
  seen.set(id, key);
}

// ---- 3 sağdan sola (Arapça) -------------------------------------------------------------------
await use('ar');
const rtl = await ev(() => ({ dir: document.documentElement.dir, cls: document.documentElement.classList.contains('rtl'), fab: getComputedStyle(document.querySelector('.navfabs') || document.body).direction }));
ok('3a Arapça: dir=rtl ve rtl sınıfı', rtl.dir === 'rtl' && rtl.cls, JSON.stringify(rtl));
await shot('lang_ar');
await use('ja');
const ltr = await ev(() => ({ dir: document.documentElement.dir, cls: document.documentElement.classList.contains('rtl') }));
ok('3b başka dile dönünce yön soldan sağa', ltr.dir === 'ltr' && !ltr.cls, JSON.stringify(ltr));

// ---- 4 ayarlardaki dil listesi ----------------------------------------------------------------
await use('en');
await ev(() => window.dwgApp.showSettings ? window.dwgApp.showSettings() : document.getElementById('gSet').click());
await page.waitForTimeout(300);
const sel = await ev(() => {
  const s = document.getElementById('sLang'); if (!s) return null;
  return { n: s.options.length, first: s.options[0].value, auto: s.options[0].text, names: [...s.options].slice(1).map(o => o.text).join(',') };
});
ok('4a dil seçicide "cihaz dili" + onbeş dil var', !!sel && sel.n === 16 && sel.first === 'auto' && /Türkçe/.test(sel.names) && /العربية/.test(sel.names) && /日本語/.test(sel.names), JSON.stringify(sel));
ok('4b cihaz dili seçeneği çözülen dili yazar', !!sel && /—|—/.test(sel.auto), sel && sel.auto);
await shot('lang_settings');
await ev(() => window.dwgApp.onBack && window.dwgApp.onBack());

// ---- 5 birkaç dilde ana ekran görüntüsü --------------------------------------------------------
for (const id of ['tr', 'de', 'zh', 'hi']) { await use(id); await page.waitForTimeout(120); await shot('lang_' + id); }
await use('tr');

ok('9 konsol hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); srv.kill();
C.summary(errors);
C.exit();
