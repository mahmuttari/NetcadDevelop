/*
 * Pro yetkisi (uygulama içi satın alma / lisans kodu) ve reklam zamanlaması. Tek uygulama; yetki ÇALIŞMA ZAMANINDA belirlenir.
 *
 *  - edition(): Android.edition() varsa o ('pro' | 'free'; her çağrıda okunur ve önbelleğe alınır), yoksa önbellek (onEdition ile
 *    yenilenir), yoksa window.__edition (sınama), yoksa 'pro'.
 *  - onEdition(ed, reason): Java (Play doğrulaması, satın alma, geri yükleme, lisans, iptal) her yetki değişiminde çağırır:
 *    önbellek yenilenir, applyEdition(), şerit yeniden kurulur (api.rebuildToolbar), reklam zamanlayıcısı durur / başlar, uyarı basılır.
 *    reason: purchased | restored | license | cancelled | pending | error:<mesaj> | revoked | none
 *  - PRO_ONLY: yalnız Pro'da bulunan özellik kimlikleri (şerit karoları, sekmeler, menü eylemleri, Drive'a yükleme).
 *    Ücretsizde bu özellikler arayüzde HİÇ görünmez (rowGroups / tabList / applyEdition); gate() yalnız dolaylı
 *    yollara (komut satırı, klavye kısayolu, eski ayar, dwgApp üzerinden çağrı) karşı emniyettir.
 *  - gate(id): Pro'da ya da PRO_ONLY değilse true; aksi hâlde yükseltme kutusu (askConfirm) açar ve false döner.
 *    Kutu onaylanırsa Pro paneli açılır.
 *  - openProPanel(): #proPanel alt sayfası — özellik listesi, fiyat (Android.proInfo().price), Satın al (Android.buyPro),
 *    Satın alımı geri yükle (Android.restorePro), Lisans kodu gir (Android.activateLicense; licenseEnabled ise).
 *    Pro iken kaynak bilgisi (Google Play / Lisans: ad, bitiş); tarayıcıda (Android yok) yalnız açıklama.
 *  - Reklam (yalnız edition() === 'free' && Android.showAd): her belge açılışında showAd('open'); belge açıkken ve
 *    sayfa görünürken son gösterimden 5 dakika sonra showAd('interval'); denetim 15 s'de bir. lastAd, istek
 *    gönderildiğinde de onAd(reason, true) geldiğinde de ileri alınır (arka arkaya istek olmasın).
 *    Java tarafı ayrıca iki gösterim arasında en az 60 s taban koruması uygular; Pro'da showAd hemen onAd(reason, false) döner.
 *  - Sınama kancası: __ads = { tick(nowMs), state() } — tick verilen zamana göre karar verir.
 */
import { S } from './state.js';
import { t } from './i18n.js';
import { askConfirm, askText } from './dialog.js';

const $ = (id) => document.getElementById(id);
const A = () => window.Android || null;
export const AD_INTERVAL_MS = 300000;   // 5 dakika
export const AD_TICK_MS = 15000;        // denetim sıklığı
let api = null;
let cur = null;       // son bilinen yetki ('pro' | 'free'); köprü okunduğunda ve onEdition ile yenilenir
let applied = null;   // applyEdition ile arayüze en son işlenen yetki (değişim tespiti: şerit yeniden kurulsun mu?)

/** Köprüden geçerli değer ('pro' | 'free') ya da '' */
function bridgeEdition() {
  try { const a = A(); if (a && typeof a.edition === 'function') { const e = String(a.edition() || ''); if (e === 'free' || e === 'pro') return e; } } catch (_) { /* eski köprü */ }
  return '';
}
/** 'pro' | 'free' — köprü > önbellek (onEdition) > window.__edition > 'pro' */
export function edition() {
  const b = bridgeEdition();
  if (b) { cur = b; return b; }
  if (cur) return cur;
  return window.__edition === 'free' ? 'free' : 'pro';
}
export const isPro = () => edition() === 'pro';
export const isFree = () => edition() === 'free';

/** Yalnız Pro'da bulunan özellikler: sekmeler, karolar, menü eylemleri, Drive'a yükleme */
export const PRO_ONLY = new Set([
  'draw', 'edit',                                                                     // sekmeler
  't:line', 't:pline', 't:rect', 't:circle', 't:arc3', 't:point', 't:text', 't:pline3d', 't:face3d',   // çizim
  't:select', 't:move', 't:copy', 't:rotate', 't:scale', 't:mirror', 't:offset', 't:del', 't:setz', 't:edittext',   // düzenleme
  '3:move', '3:setz', '3:del', '3:pline',                                             // 3B düzenleme / 3B çizim
  'props', 'layer', 'color', 'profile', 'notes', 'savedxf', 'savedelta', 'pdf', 'compare', 'undo', 'redo',   // karolar / menü
  'docEdit',                                                                          // PDF ve Word düzenleme (belge görünümü)
  'driveUpload',                                                                      // Drive'a yükleme (belge eylemi, Drive paneli, toast eylemi)
]);

/** Android.proInfo() → {edition, source, name, exp, price, billingReady, licenseEnabled}; köprü yoksa boş bilgi */
export function proInfo() {
  const info = { edition: edition(), source: 'none', name: '', exp: 0, price: '', billingReady: false, licenseEnabled: false, android: false };
  const a = A(); if (!a) return info;
  info.android = true;
  if (typeof a.proInfo !== 'function') return info;
  try {
    const o = JSON.parse(String(a.proInfo() || '{}')) || {};
    if (o.edition === 'pro' || o.edition === 'free') info.edition = o.edition;
    if (o.source === 'play' || o.source === 'license') info.source = o.source;
    info.name = String(o.name || ''); info.exp = Number(o.exp) || 0; info.price = String(o.price || '');
    info.billingReady = !!o.billingReady; info.licenseEnabled = !!o.licenseEnabled;
  } catch (e) { console.warn('proInfo', e); }
  return info;
}

let asking = false;
async function upgradeDialog() {
  if (asking) return;   // aynı anda tek kutu
  asking = true;
  try { if (await askConfirm(t('proOnly') + ' ' + t('proAsk'), { ok: t('goPro') })) openProPanel(); }
  finally { asking = false; }
}
/** Özellik kapısı: Pro'da hep true; Ücretsizde PRO_ONLY ise yükseltme kutusu açılır ve false döner */
export function gate(id) {
  if (isPro()) return true;
  if (!PRO_ONLY.has(String(id))) return true;
  void upgradeDialog();
  return false;
}

// ---------------------------------------------------------------------------------
// Pro paneli (#proPanel)
// ---------------------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateText = (epochSec) => { try { return new Date(epochSec * 1000).toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'tr-TR'); } catch (_) { return String(epochSec); } };
function featureList() {
  return `<ul class="pro-features">${String(t('proFeatures')).split('|').map(s => s.trim()).filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
}
function renderProPanel() {
  const body = $('proBody'); if (!body) return;
  const info = proInfo();
  const pro = isPro();
  let html = '';
  if (pro) {
    const src = info.source === 'license' ? t('proSrcLicense') + (info.name ? ' — ' + esc(info.name) : '') + (info.exp ? ' (' + t('proExpires') + ' ' + esc(dateText(info.exp)) + ')' : '') : info.source === 'play' ? t('proSrcPlay') : '';
    html += `<div class="full pro-status" data-pro-status="${esc(info.source)}"><strong>${esc(t('proActiveVia'))}${src ? ': ' + src : ''}</strong></div>`;
    html += `<div class="full">${featureList()}</div>`;
  } else {
    html += `<div class="full">${esc(t('proFeaturesIntro'))}</div>`;
    html += `<div class="full">${featureList()}</div>`;
    if (!info.android) {
      html += `<div class="full muted" data-pro-note="browser">${esc(t('proBrowserOnly'))}</div>`;
    } else {
      html += `<div class="k">${esc(t('proPrice'))}</div><div class="v" id="proPrice">${info.price ? esc(info.price) : `<span class="muted">${esc(t('proPriceNA'))}</span>`}</div>`;
      html += `<div class="full btns">`
        + `<button type="button" class="btn primary" data-pro="buy"${info.billingReady ? '' : ' disabled'}>${esc(t('proBuy'))}</button>`
        + `<button type="button" class="btn small" data-pro="restore"${info.billingReady ? '' : ' disabled'}>${esc(t('proRestore'))}</button>`
        + (info.licenseEnabled ? `<button type="button" class="btn small" data-pro="license">${esc(t('proLicense'))}</button>` : '')
        + `</div>`;
      if (!info.billingReady) html += `<div class="full muted" data-pro-note="billing">${esc(t('proBillingNA'))}</div>`;
    }
  }
  body.innerHTML = html;
}
async function proAction(kind) {
  const a = A(); if (!a) return;
  if (kind === 'buy') {
    if (!proInfo().billingReady || typeof a.buyPro !== 'function') { if (api && api.toast) api.toast(t('proBillingNA'), { type: 'warn' }); return; }
    try { a.buyPro(); } catch (e) { if (api && api.toast) api.toast(t('error') + ': ' + e.message, { type: 'error' }); }
  } else if (kind === 'restore') {
    if (typeof a.restorePro !== 'function') return;
    try { a.restorePro(); } catch (e) { if (api && api.toast) api.toast(t('error') + ': ' + e.message, { type: 'error' }); }
  } else if (kind === 'license') {
    if (typeof a.activateLicense !== 'function') return;
    const code = await askText(t('proLicensePrompt'), '', { ok: t('apply') });
    const c = String(code == null ? '' : code).trim();
    if (!c) return;
    let ok = false;
    try { ok = !!a.activateLicense(c); } catch (e) { console.warn(e); ok = false; }
    if (!ok) { if (api && api.toast) api.toast(t('licenseInvalid'), { type: 'error' }); return; }
    renderProPanel();   // Java onEdition('pro','license') göndermemiş olsa da panel güncel kalsın
  }
}
/** Pro alt sayfasını açar (içerik her açılışta yeniden kurulur) */
export function openProPanel() {
  const p = $('proPanel'); if (!p) return false;
  renderProPanel();
  p.hidden = false;
  return true;
}
export function closeProPanel() { const p = $('proPanel'); if (!p || p.hidden) return false; p.hidden = true; return true; }
export const isProPanelOpen = () => { const p = $('proPanel'); return !!p && !p.hidden; };

// ---------------------------------------------------------------------------------
// Reklam zamanlaması (yalnız Ücretsiz + Android.showAd)
// ---------------------------------------------------------------------------------
const ads = { last: 0, timer: 0, requests: 0, shown: 0 };
const adsOn = () => { const a = A(); return isFree() && !!(a && typeof a.showAd === 'function'); };
function request(reason, now) {
  if (!adsOn()) return false;
  ads.last = now; ads.requests++;
  try { A().showAd(reason); } catch (e) { console.warn(e); }
  return true;
}
/** Belge açıldı (setScene sonrası): açılış reklamı */
export function onDocOpen() { return request('open', Date.now()); }
/** Zaman denetimi: belge açık, sayfa görünür ve son gösterimden 5 dk geçtiyse 'interval' isteği; true → istek gönderildi */
export function tick(now = Date.now()) {
  if (!adsOn()) return false;
  if (!S.hasDoc) return false;
  if (document.visibilityState !== 'visible') return false;
  if (now - ads.last < AD_INTERVAL_MS) return false;
  return request('interval', now);
}
export function start() { stop(); if (!adsOn()) return; ads.timer = setInterval(() => tick(Date.now()), AD_TICK_MS); }
export function stop() { if (ads.timer) { clearInterval(ads.timer); ads.timer = 0; } }
/** Android → gösterim sonucu; gösterildiyse sayaç ileri alınır (geriye gitmez) */
export function onAd(reason, shown) { if (shown) { ads.shown++; ads.last = Math.max(ads.last, Date.now()); } }
export const __ads = {
  tick: (now) => tick(typeof now === 'number' && isFinite(now) ? now : Date.now()),
  state: () => ({ edition: edition(), adsOn: adsOn(), last: ads.last, requests: ads.requests, shown: ads.shown, timer: !!ads.timer, interval: AD_INTERVAL_MS, tickMs: AD_TICK_MS }),
};

// ---------------------------------------------------------------------------------
// Sabit arayüze uygulama: Diğer menüsü, karşılama kartı, Drive paneli
// ---------------------------------------------------------------------------------
export function applyEdition() {
  const pro = isPro();
  applied = pro ? 'pro' : 'free';
  document.body.classList.toggle('edition-free', !pro); document.body.classList.toggle('edition-pro', pro);
  // Diğer menüsü: yetki + belge kipi + belge varlığı TEK yerde birleşir (app.js refreshMenu); app.js bağlı değilse yalnız yetki kuralı
  if (api && typeof api.refreshMenu === 'function') api.refreshMenu();
  else document.querySelectorAll('#moreMenu [data-act]').forEach(b => { b.hidden = menuHiddenByEdition(b.dataset.act); });
  const pl = $('proLine'); if (pl) pl.hidden = pro;
  // karşılama metni sürüme göre (applyI18n dil değişiminde data-i18n anahtarını yeniden okur)
  const w = document.querySelector('#home [data-i18n="welcomeText"], #home [data-i18n="welcomeTextFree"]'); if (w) { w.dataset.i18n = pro ? 'welcomeText' : 'welcomeTextFree'; w.textContent = t(w.dataset.i18n); }
  document.querySelectorAll('[data-drive="upload"]').forEach(b => { b.hidden = !pro; });
  try { window.dispatchEvent(new CustomEvent('dwg:edition', { detail: { edition: applied } })); } catch (_) { /* yok */ }
}
/** Diğer menüsü eylemi yetki gereği gizli mi? ('pro' Pro'da, PRO_ONLY eylemleri Ücretsiz'de) */
export function menuHiddenByEdition(act) { const pro = isPro(); return act === 'pro' ? pro : PRO_ONLY.has(String(act)) ? !pro : false; }
/** Java → yetki değişti (ya da satın alma / geri yükleme sonucu). ed: 'pro' | 'free'; reason: bkz. dosya başı */
export function onEdition(ed, reason) {
  const e = ed === 'free' ? 'free' : 'pro';
  const r = String(reason == null ? '' : reason);
  cur = e;
  const changed = applied !== e;
  applyEdition();
  if (changed && api && typeof api.rebuildToolbar === 'function') { try { api.rebuildToolbar(); } catch (err) { console.warn(err); } }
  if (isPro()) stop(); else start();
  if (isProPanelOpen()) renderProPanel();
  const toast = (m, o) => { if (api && api.toast) api.toast(m, o); };
  if (r === 'purchased' || r === 'restored' || r === 'license') toast(t('proActivated'), { type: 'ok' });
  else if (r === 'pending') toast(t('proPending'), { type: 'warn', ms: 5000 });
  else if (r === 'revoked') toast(t('proRevoked'), { type: 'warn' });
  else if (r === 'none') toast(t('proRestoreNone'), { type: 'warn' });
  else if (r.startsWith('error')) toast(t('error') + (r.length > 6 ? ': ' + r.slice(6) : ''), { type: 'error' });
  // cancelled ve boş neden: sessiz
  return e;
}
/** app.js bağlar: api { toast, rebuildToolbar, refreshMenu } */
export function initEdition(a) {
  api = a || null;
  applyEdition();
  const b = $('btnGoPro'); if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => openProPanel()); }
  const body = $('proBody'); if (body && !body.dataset.bound) { body.dataset.bound = '1'; body.addEventListener('click', (ev) => { const btn = ev.target.closest('[data-pro]'); if (btn && !btn.disabled) void proAction(btn.dataset.pro); }); }
  start();
}
