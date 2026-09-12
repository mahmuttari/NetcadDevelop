/*
 * Sürüm çeşidi (Ücretsiz / Pro) ve reklam zamanlaması.
 *
 *  - edition(): Android.edition() varsa o ('pro' | 'free'), yoksa window.__edition (sınama), yoksa 'pro'.
 *  - PRO_ONLY: yalnız Pro'da bulunan özellik kimlikleri (şerit karoları, sekmeler, menü eylemleri, Drive'a yükleme).
 *    Ücretsizde bu özellikler arayüzde HİÇ görünmez (rowGroups / tabList / applyEdition); gate() yalnız dolaylı
 *    yollara (komut satırı, klavye kısayolu, eski ayar, dwgApp üzerinden çağrı) karşı emniyettir.
 *  - gate(id): Pro'da ya da PRO_ONLY değilse true; aksi hâlde yükseltme kutusu (askConfirm) açar ve false döner.
 *    Kutu onaylanırsa Pro APK bağlantısı açılır (Android.openUrl / window.open).
 *  - Reklam (yalnız edition() === 'free' && Android.showAd): her belge açılışında showAd('open'); belge açıkken ve
 *    sayfa görünürken son gösterimden 5 dakika sonra showAd('interval'); denetim 15 s'de bir. lastAd, istek
 *    gönderildiğinde de onAd(reason, true) geldiğinde de ileri alınır (arka arkaya istek olmasın).
 *    Java tarafı ayrıca iki gösterim arasında en az 60 s taban koruması uygular.
 *  - Sınama kancası: __ads = { tick(nowMs), state() } — tick verilen zamana göre karar verir.
 */
import { S } from './state.js';
import { t } from './i18n.js';
import { askConfirm } from './dialog.js';

const $ = (id) => document.getElementById(id);
const A = () => window.Android || null;
export const DEFAULT_PRO_URL = 'https://github.com/mahmuttari/NetcadDevelop/raw/main/DwgViewer/release/DwgGoruntuleyici.apk';
export const AD_INTERVAL_MS = 300000;   // 5 dakika
export const AD_TICK_MS = 15000;        // denetim sıklığı
let api = null;

/** 'pro' | 'free' */
export function edition() {
  try { const a = A(); if (a && typeof a.edition === 'function') { const e = String(a.edition() || ''); if (e === 'free' || e === 'pro') return e; } } catch (_) { /* eski köprü */ }
  const w = window.__edition;
  return w === 'free' ? 'free' : 'pro';
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
  'driveUpload',                                                                      // Drive'a yükleme (belge eylemi, Drive paneli, toast eylemi)
]);

/** Pro APK bağlantısı: Android.proUrl() (BuildConfig.PRO_URL), yoksa varsayılan */
export function proUrl() {
  try { const a = A(); if (a && typeof a.proUrl === 'function') { const u = String(a.proUrl() || '').trim(); if (u) return u; } } catch (_) { /* eski köprü */ }
  return DEFAULT_PRO_URL;
}
/** Pro sürüm bağlantısını açar */
export function goPro() {
  const u = proUrl();
  try {
    const a = A();
    if (a && typeof a.openUrl === 'function') { a.openUrl(u); return true; }
    const w = window.open(u, '_blank');
    if (w) return true;
  } catch (e) { console.warn(e); }
  if (api && api.toast) api.toast(t('proOpenFail') + ': ' + u, { type: 'warn', ms: 6000 });
  return false;
}
let asking = false;
async function upgradeDialog() {
  if (asking) return;   // aynı anda tek kutu
  asking = true;
  try { if (await askConfirm(t('proOnly') + ' ' + t('proAsk'), { ok: t('goPro') })) goPro(); }
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
  document.body.classList.toggle('edition-free', !pro); document.body.classList.toggle('edition-pro', pro);
  document.querySelectorAll('#moreMenu [data-act]').forEach(b => { const k = b.dataset.act; if (k === 'pro') b.hidden = pro; else if (PRO_ONLY.has(k)) b.hidden = !pro; });
  const pl = $('proLine'); if (pl) pl.hidden = pro;
  // karşılama metni sürüme göre (applyI18n dil değişiminde data-i18n anahtarını yeniden okur)
  const w = document.querySelector('#empty [data-i18n="welcomeText"], #empty [data-i18n="welcomeTextFree"]'); if (w) { w.dataset.i18n = pro ? 'welcomeText' : 'welcomeTextFree'; w.textContent = t(w.dataset.i18n); }
  document.querySelectorAll('[data-drive="upload"]').forEach(b => { b.hidden = !pro; });
}
/** app.js bağlar: api { toast } */
export function initEdition(a) {
  api = a || null;
  applyEdition();
  const b = $('btnGoPro'); if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => goPro()); }
  start();
}
