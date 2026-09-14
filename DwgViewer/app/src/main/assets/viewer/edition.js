/*
 * Yetki basamakları (abonelik / lisans kodu) ve reklam zamanlaması. Yetki ÇALIŞMA ZAMANINDA belirlenir.
 *
 * DÖRT BASAMAK, sırası bağlayıcı:  free < adfree < premium < super
 *   free     reklamlı; görüntüleme, ölçü, katman, arama, GPS, PNG
 *   adfree   reklam yok; çizim ve düzenleme YOK
 *   premium  + 2B çizim ve düzenleme, katman/renk, geri al, notlar, ölçekli PDF, DXF kaydetme,
 *              yeni dosya oluşturma, belge düzenleme (Word/Excel/PDF/CSV/metin)
 *   super    + 3B çizim ve düzenleme, kot atama, kot/eğim profili, karşılaştırma, delta kaydı, Drive'a yükleme
 * Kullanıcı birden çok abonelik taşıyabilir; geçerli basamak en yüksek olandır (Java tarafı hesaplar).
 *
 *  - tier(): Android.edition() varsa o (her çağrıda okunur, önbelleğe alınır), yoksa önbellek (onEdition ile
 *    yenilenir), yoksa window.__edition (sınama), yoksa 'super' (tarayıcıda geliştirme kolaylığı).
 *  - FEATURE_TIER: özellik kimliği → gereken en düşük basamak. Kimlikler şerit karoları, sekmeler, menü
 *    eylemleri ve araç karolarıyla aynıdır; TEK kaynak burasıdır. Listede olmayan her özellik free'dir.
 *  - has(id): basamak yetiyor mu? (kutu açmaz — arayüz kurarken kullanılır)
 *  - gate(id): yetiyorsa true; yetmiyorsa yükseltme kutusu (askConfirm) açar ve false döner. Kutu
 *    onaylanırsa paket paneli açılır. Yetmeyen özellik arayüzde zaten görünmez; gate dolaylı yollara
 *    (klavye kısayolu, eski ayar, dwgApp üzerinden çağrı) karşı emniyettir.
 *  - noAds(): basamak free değilse reklam gösterilmez.
 *  - onEdition(tier, reason): Java (Play doğrulaması, satın alma, geri yükleme, lisans, iptal) her değişimde
 *    çağırır: önbellek yenilenir, applyEdition(), şerit yeniden kurulur, reklam zamanlayıcısı durur / başlar.
 *    reason: purchased | restored | license | cancelled | pending | error:<mesaj> | revoked | none
 *  - openProPanel(): #proPanel alt sayfası — üç paket kartı, her birinde aylık ve yıllık fiyat
 *    (Android.proInfo().prices), satın alma (Android.buyPro(tier, plan)), geri yükleme, lisans kodu.
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
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const A = () => window.Android || null;
export const AD_INTERVAL_MS = 300000;   // 5 dakika
export const AD_TICK_MS = 15000;        // denetim sıklığı
let api = null;
let cur = null;       // son bilinen basamak; köprü okunduğunda ve onEdition ile yenilenir
let applied = null;   // applyEdition ile arayüze en son işlenen basamak (değişim tespiti: şerit yeniden kurulsun mu?)

/** Basamaklar, düşükten yükseğe. Sıra bağlayıcıdır: dizideki konum yetki gücüdür. */
export const TIERS = ['free', 'adfree', 'premium', 'super'];
/** Ücretli paketler (panelde bu sırayla kart olarak çizilir) */
export const PAID_TIERS = ['adfree', 'premium', 'super'];
/** Abonelik dönemleri */
export const PLANS = ['monthly', 'yearly'];
export const rank = (t) => { const i = TIERS.indexOf(String(t)); return i < 0 ? 0 : i; };

/** Köprüden geçerli basamak ya da '' */
function bridgeEdition() {
  try { const a = A(); if (a && typeof a.edition === 'function') { const e = String(a.edition() || ''); if (TIERS.includes(e)) return e; } } catch (_) { /* eski köprü */ }
  return '';
}
/** Geçerli basamak — köprü > önbellek (onEdition) > window.__edition > 'super' (tarayıcı) */
export function tier() {
  const b = bridgeEdition();
  if (b) { cur = b; return b; }
  if (cur) return cur;
  return TIERS.includes(window.__edition) ? window.__edition : 'super';
}
/** Eski ad; basamak sistemine geçişte çağrı yerleri korunsun diye durur */
export const edition = tier;
/** Reklam yalnız hiçbir paketi olmayana gösterilir */
export const noAds = () => rank(tier()) > 0;
export const isFree = () => tier() === 'free';

/**
 * Özellik → gereken en düşük basamak. TEK KAYNAK: şerit karoları, sekmeler, menü eylemleri, araç karoları
 * ve belge düğmeleri hep buraya bakar. Burada olmayan her özellik ücretsizdir.
 *
 * Ayrım: premium = tam 2B + ofis; super = 3B ve mühendislik eklentileri.
 */
export const FEATURE_TIER = new Map([
  // --- sekmeler
  ['draw', 'premium'], ['edit', 'premium'],
  // --- 2B çizim
  ['t:line', 'premium'], ['t:pline', 'premium'], ['t:rect', 'premium'], ['t:circle', 'premium'],
  ['t:arc3', 'premium'], ['t:point', 'premium'], ['t:text', 'premium'],
  // --- 2B düzenleme
  ['t:select', 'premium'], ['t:move', 'premium'], ['t:copy', 'premium'], ['t:rotate', 'premium'],
  ['t:scale', 'premium'], ['t:mirror', 'premium'], ['t:offset', 'premium'], ['t:del', 'premium'], ['t:edittext', 'premium'],
  // --- özellikler, katman, renk, geri alma
  ['props', 'premium'], ['layer', 'premium'], ['color', 'premium'], ['undo', 'premium'], ['redo', 'premium'],
  // --- notlar, çıktı, kaydetme
  ['notes', 'premium'], ['pdf', 'premium'], ['savedxf', 'premium'],
  // --- belge tarafı
  ['docEdit', 'premium'], ['new', 'premium'],
  // --- 3B çizim ve düzenleme (yalnız Super)
  ['t:pline3d', 'super'], ['t:face3d', 'super'], ['t:setz', 'super'],
  ['3:move', 'super'], ['3:setz', 'super'], ['3:del', 'super'], ['3:pline', 'super'],
  // --- mühendislik eklentileri (yalnız Super)
  ['profile', 'super'], ['compare', 'super'], ['savedelta', 'super'], ['driveUpload', 'super'], ['area3d', 'super'],
  // --- 2B çıktı eklentileri
  ['textout', 'premium'],
]);

/** Özelliğin istediği basamak ('free' kısıtsız demektir) */
export const need = (id) => FEATURE_TIER.get(String(id)) || 'free';
/** Basamak yetiyor mu? (kutu açmaz) */
export const has = (id) => rank(tier()) >= rank(need(id));
/** Geriye dönük ad: "çizim ve düzenleme açık mı" anlamında kullanılıyordu */
export const isPro = () => has('t:line');

/** Android.proInfo() → {edition, source, name, exp, plan, prices, billingReady, licenseEnabled}; köprü yoksa boş bilgi */
export function proInfo() {
  const info = { edition: tier(), source: 'none', name: '', exp: 0, plan: '', prices: {}, billingReady: false, licenseEnabled: false, android: false };
  const a = A(); if (!a) return info;
  info.android = true;
  if (typeof a.proInfo !== 'function') return info;
  try {
    const o = JSON.parse(String(a.proInfo() || '{}')) || {};
    if (TIERS.includes(o.edition)) info.edition = o.edition;
    if (o.source === 'play' || o.source === 'license') info.source = o.source;
    info.name = String(o.name || ''); info.exp = Number(o.exp) || 0; info.plan = String(o.plan || '');
    if (o.prices && typeof o.prices === 'object') info.prices = o.prices;
    info.billingReady = !!o.billingReady; info.licenseEnabled = !!o.licenseEnabled;
  } catch (e) { console.warn('proInfo', e); }
  return info;
}
/** Basamağın Play'den gelen biçimli fiyatı ("₺299,99") ya da '' */
export function priceOf(info, t, plan) { const p = info && info.prices && info.prices[t]; return p && p[plan] ? String(p[plan]) : ''; }

let asking = false;
async function upgradeDialog(needed) {
  if (asking) return;   // aynı anda tek kutu
  asking = true;
  try {
    const msg = tt('tierOnly', '%s paketinde bulunur.').replace('%s', tierName(needed)) + ' ' + t('proAsk');
    if (await askConfirm(msg, { ok: t('goPro') })) openProPanel();
  } finally { asking = false; }
}
/** Basamağın görünen adı ("Ad-Free" / "Premium" / "Super") */
export const tierName = (x) => tt('tier_' + x, x === 'adfree' ? 'Ad-Free' : x === 'premium' ? 'Premium' : x === 'super' ? 'Super' : 'Free');
/** Özellik kapısı: basamak yetiyorsa true; yetmiyorsa yükseltme kutusu açılır ve false döner */
export function gate(id) {
  if (has(id)) return true;
  void upgradeDialog(need(id));
  return false;
}

// ---------------------------------------------------------------------------------
// Pro paneli (#proPanel)
// ---------------------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateText = (epochSec) => { try { return new Date(epochSec * 1000).toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'tr-TR'); } catch (_) { return String(epochSec); } };
/** Paketin özellik satırları: "tierFeat_<basamak>" anahtarı, satırlar "|" ile ayrılır */
function featureList(x) {
  const raw = String(t('tierFeat_' + x));
  return `<ul class="pro-features">${raw.split('|').map(v => v.trim()).filter(Boolean).map(v => `<li>${esc(v)}</li>`).join('')}</ul>`;
}
/** Bir paket kartı: ad, özellikler, aylık + yıllık fiyat düğmeleri */
function tierCard(x, info, curTier) {
  const owned = curTier === x;
  const lower = rank(curTier) > rank(x);        // daha üst pakete sahip: bu kart bilgi amaçlı kalır
  const cls = 'tier-card' + (owned ? ' owned' : '') + (lower ? ' dim' : '');
  let h = `<div class="${cls}" data-tier="${x}">`;
  h += `<div class="tier-head"><span class="tier-name">${esc(tierName(x))}</span>`
    + (owned ? `<span class="tier-badge">${esc(tt('tierActive', 'Etkin'))}</span>` : '') + `</div>`;
  h += featureList(x);
  if (!owned && !lower && info.android) {
    h += `<div class="tier-buy">`;
    for (const plan of PLANS) {
      const price = priceOf(info, x, plan);
      const label = plan === 'yearly' ? tt('planYearly', 'Yıllık') : tt('planMonthly', 'Aylık');
      h += `<button type="button" class="btn${plan === 'yearly' ? ' primary' : ''}" data-pro="buy" data-tier="${x}" data-plan="${plan}"${info.billingReady ? '' : ' disabled'}>`
        + `<span class="pl">${esc(label)}</span><span class="pr">${price ? esc(price) : esc(tt('proPriceNA', '—'))}</span></button>`;
    }
    h += `</div>`;
  }
  return h + `</div>`;
}
function renderProPanel() {
  const body = $('proBody'); if (!body) return;
  const info = proInfo();
  const curTier = info.edition || tier();
  let html = '';
  if (rank(curTier) > 0) {
    const planTxt = info.plan === 'yearly' ? tt('planYearly', 'Yıllık') : info.plan === 'monthly' ? tt('planMonthly', 'Aylık') : '';
    const src = info.source === 'license'
      ? t('proSrcLicense') + (info.name ? ' — ' + info.name : '') + (info.exp ? ' (' + t('proExpires') + ' ' + dateText(info.exp) + ')' : '')
      : info.source === 'play' ? t('proSrcPlay') + (planTxt ? ' — ' + planTxt : '') : '';
    html += `<div class="full pro-status" data-pro-status="${esc(info.source)}" data-tier="${esc(curTier)}">`
      + `<strong>${esc(tierName(curTier))}</strong>${src ? ' — ' + esc(src) : ''}</div>`;
  } else {
    html += `<div class="full">${esc(t('proFeaturesIntro'))}</div>`;
  }
  html += `<div class="full tier-grid">${PAID_TIERS.map(x => tierCard(x, info, curTier)).join('')}</div>`;
  if (!info.android) {
    html += `<div class="full muted" data-pro-note="browser">${esc(t('proBrowserOnly'))}</div>`;
  } else {
    html += `<div class="full btns">`
      + `<button type="button" class="btn small" data-pro="restore"${info.billingReady ? '' : ' disabled'}>${esc(t('proRestore'))}</button>`
      + (info.licenseEnabled ? `<button type="button" class="btn small" data-pro="license">${esc(t('proLicense'))}</button>` : '')
      + `</div>`;
    if (!info.billingReady) html += `<div class="full muted" data-pro-note="billing">${esc(t('proBillingNA'))}</div>`;
  }
  body.innerHTML = html;
}
async function proAction(kind, btn) {
  const a = A(); if (!a) return;
  if (kind === 'buy') {
    if (!proInfo().billingReady || typeof a.buyPro !== 'function') { if (api && api.toast) api.toast(t('proBillingNA'), { type: 'warn' }); return; }
    const x = btn && btn.dataset.tier, plan = btn && btn.dataset.plan;
    if (!PAID_TIERS.includes(x)) return;
    try { a.buyPro(x, PLANS.includes(plan) ? plan : 'monthly'); } catch (e) { if (api && api.toast) api.toast(t('error') + ': ' + e.message, { type: 'error' }); }
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
    renderProPanel();   // Java onEdition(basamak,'license') göndermemiş olsa da panel güncel kalsın
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
const adsOn = () => { const a = A(); return !noAds() && !!(a && typeof a.showAd === 'function'); };
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
  state: () => ({ edition: tier(), adsOn: adsOn(), last: ads.last, requests: ads.requests, shown: ads.shown, timer: !!ads.timer, interval: AD_INTERVAL_MS, tickMs: AD_TICK_MS }),
};

// ---------------------------------------------------------------------------------
// Sabit arayüze uygulama: Diğer menüsü, karşılama kartı, Drive paneli
// ---------------------------------------------------------------------------------
export function applyEdition() {
  const x = tier();
  applied = x;
  const paid = rank(x) > 0;
  // body sınıfı: edition-free|adfree|premium|super, ayrıca eski CSS için edition-pro (çizim açıksa)
  for (const y of TIERS) document.body.classList.toggle('edition-' + y, x === y);
  document.body.classList.toggle('edition-pro', has('t:line'));
  // Diğer menüsü: yetki + belge kipi + belge varlığı TEK yerde birleşir (app.js refreshMenu); app.js bağlı değilse yalnız yetki kuralı
  if (api && typeof api.refreshMenu === 'function') api.refreshMenu();
  else document.querySelectorAll('#moreMenu [data-act]').forEach(b => { b.hidden = menuHiddenByEdition(b.dataset.act); });
  const pl = $('proLine'); if (pl) pl.hidden = rank(x) >= rank('super');   // en üst pakette tanıtım satırı kalkar
  // karşılama metni sürüme göre (applyI18n dil değişiminde data-i18n anahtarını yeniden okur)
  const w = document.querySelector('#home [data-i18n="welcomeText"], #home [data-i18n="welcomeTextFree"]');
  if (w) { w.dataset.i18n = paid ? 'welcomeText' : 'welcomeTextFree'; w.textContent = t(w.dataset.i18n); }
  document.querySelectorAll('[data-drive="upload"]').forEach(b => { b.hidden = !has('driveUpload'); });
  try { window.dispatchEvent(new CustomEvent('dwg:edition', { detail: { edition: applied } })); } catch (_) { /* yok */ }
}
/** Diğer menüsü eylemi yetki gereği gizli mi? ('pro' en üst pakette, kilitli eylemler yetmeyen basamakta) */
export function menuHiddenByEdition(act) {
  const a = String(act);
  if (a === 'pro') return rank(tier()) >= rank('super');
  return !has(a);
}
/** Java → yetki değişti (ya da satın alma / geri yükleme sonucu). tier: basamak; reason: bkz. dosya başı */
export function onEdition(ed, reason) {
  const e = TIERS.includes(String(ed)) ? String(ed) : 'free';
  const r = String(reason == null ? '' : reason);
  cur = e;
  const changed = applied !== e;
  applyEdition();
  if (changed && api && typeof api.rebuildToolbar === 'function') { try { api.rebuildToolbar(); } catch (err) { console.warn(err); } }
  if (noAds()) stop(); else start();
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
  const body = $('proBody'); if (body && !body.dataset.bound) { body.dataset.bound = '1'; body.addEventListener('click', (ev) => { const btn = ev.target.closest('[data-pro]'); if (btn && !btn.disabled) void proAction(btn.dataset.pro, btn); }); }
  start();
}
