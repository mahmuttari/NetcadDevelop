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
  ['layeredit', 'premium'],              // katmanın kendisini düzenleme ve silme
  // --- notlar, çıktı, kaydetme
  ['notes', 'premium'], ['pdf', 'premium'], ['savedxf', 'premium'],
  // --- belge tarafı
  ['docEdit', 'premium'], ['new', 'premium'],
  // --- 3B çizim ve düzenleme (yalnız Super)
  ['t:pline3d', 'super'], ['t:face3d', 'super'], ['t:setz', 'super'],
  ['3:move', 'super'], ['3:setz', 'super'], ['3:del', 'super'], ['3:pline', 'super'],
  /*
   * Mühendislik eklentileri. Kot/eğim profili ve yalnız değişenleri DXF olarak teslim etme
   * Super'de kalır — rakipte bu ikisinin hiçbir kademede karşılığı yoktur, Super'i ayıran şey
   * budur. Karşılaştırma, Drive'a yükleme ve yanal alan Premium'a indirildi: rakip bunları
   * Premium'da veriyor ve aynı parayı ödeyen kullanıcının bizde daha azını alması doğru değil.
   */
  ['profile', 'super'], ['savedelta', 'super'],
  ['compare', 'premium'], ['driveUpload', 'premium'], ['area3d', 'premium'],
  ['driveShare', 'premium'], ['webdavWrite', 'premium'],
  // --- ölçülendirme ve açıklama (2B çizim: Premium)
  ['t:dim', 'premium'], ['t:dimh', 'premium'], ['t:dimv', 'premium'], ['t:dimr', 'premium'], ['t:dimd', 'premium'], ['t:dima', 'premium'],
  ['t:leader', 'premium'], ['t:cloud', 'premium'], ['t:balloon', 'premium'], ['t:hatch', 'premium'], ['markdim', 'premium'],
  ['hatchpat', 'premium'],               // desen seçici: taramayla aynı basamak
  // --- 2B düzenleme eklentileri
  ['t:array', 'premium'], ['t:explode', 'premium'], ['t:textsize', 'premium'], ['t:attr', 'premium'], ['findrep', 'premium'],
  ['blocklib', 'premium'], ['copyclip', 'premium'], ['pasteclip', 'premium'],
  // --- 2B çıktı eklentileri
  ['textout', 'premium'], ['tableout', 'premium'],
  // --- 3B üretim (Super) · PDF→CAD ve toplu işlem Premium'a indirildi (rakip ikisini de Premium'da veriyor)
  ['t:thick', 'super'], ['3:geo', 'super'], ['3:note', 'super'], ['mesh3d', 'super'],
  ['target3', 'super'],                  // 3B yüzey hedefi: ışın-üçgen kesişimi
  ['batch', 'premium'], ['pdfcad', 'premium'],
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
    if (o.source === 'play' || o.source === 'license' || o.source === 'owner') info.source = o.source;
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
    if (await askConfirm(msg, { ok: t('goPro') })) openProPanel(needed);
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
// Kilit rozeti — kilitli özellik GİZLENMEZ, işaretlenir. Tek kaynak burasıdır.
//   lockAttr(id)          → ' data-need="premium"' ya da ''        (denetimin kendisine)
//   lockBadge(id, kind)   → rozet + okunur metin, kilitli değilse ''  (kind: 'bar' | 'pill')
//   lockBadgeFor(n, kind) → basamağı doğrudan verilen rozet          (türetilmiş sekme rozeti)
//   lockText(id)          → "Premium paketinde bulunur." ya da ''    (aria-label ekleri)
//   lockMark(el, id, k)   → yeniden çizilmeyen bir DOM öğesini damgalar / temizler
//   syncLockText(root)    → dil değişiminde okunur metinleri ve aria-label'ları tazeler
// Rozet SÜSTÜR (aria-hidden); bilgiyi kardeş .lk-vh metni taşır. Rozet <span>'dir, <button>
// değildir: "görünür her düğme >= 40x40 px" kuralı bozulmasın diye.
// ---------------------------------------------------------------------------------
const lockSentence = (n) => tt('tierOnly', '%s paketinde bulunur.').replace('%s', tierName(n));

/** Kilitli denetime yazılacak öznitelik; kilitli değilse boş dize (öznitelik hiç basılmaz) */
export const lockAttr = (id) => has(id) ? '' : ` data-need="${need(id)}"`;

/** Basamağı doğrudan verilen rozet gövdesi. kind: 'bar' (dar yüzey) | 'pill' (yer olan yüzey) */
export function lockBadgeFor(n, kind = 'bar') {
  if (!n || n === 'free') return '';
  const mark = kind === 'pill'
    ? `<span class="lk lk-pill" data-tier="${n}" aria-hidden="true"><span data-i18n="tier_${n}">${esc(tierName(n))}</span></span>`
    : `<span class="lk lk-bar" data-tier="${n}" aria-hidden="true"></span>`;
  return mark + `<span class="vh lk-vh" data-tier="${n}">${esc(lockSentence(n))}</span>`;
}
/** Kilitliyse rozet, değilse boş dize */
export const lockBadge = (id, kind = 'bar') => has(id) ? '' : lockBadgeFor(need(id), kind);
/** Simge-yalnız düğmelerin aria-label ekleri için tam cümle; kilitli değilse '' */
export const lockText = (id) => has(id) ? '' : lockSentence(need(id));

/**
 * Yeniden çizilmeyen bir öğeyi (Drive düğmesi, belge Düzenle, bilgi çipi, #btnNew2, menü satırı)
 * yetki durumuna göre damgalar. Değişiklik yoksa hiçbir şey yapmaz (refreshMenu sık çağrılır).
 */
export function lockMark(el, id, kind = 'bar') {
  if (!el) return;
  const want = has(id) ? '' : need(id);
  if ((el.dataset.need || '') === want) return;
  el.querySelectorAll(':scope > .lk, :scope > .lk-vh').forEach(n => n.remove());
  if (want) { el.dataset.need = want; el.insertAdjacentHTML('beforeend', lockBadgeFor(want, kind)); }
  else delete el.dataset.need;
}

/**
 * Dil değişiminde (dwg:lang) ve yetki değişiminde çağrılır.
 * Görünen hap data-i18n taşıdığı için applyI18n onu zaten tazeler; burada
 *  (a) %s taşıdığı için data-i18n ile taşınamayan .lk-vh cümlesi,
 *  (b) içeriği aria-label ile EZİLEN simge-yalnız düğmelerin erişilebilir adı tazelenir.
 */
export function syncLockText(root = document) {
  root.querySelectorAll('.lk-vh[data-tier]').forEach(el => { el.textContent = lockSentence(el.dataset.tier); });
  const aria = (sel, key, id) => root.querySelectorAll(sel).forEach(b => {
    const base = t(key), x = lockText(id);
    b.setAttribute('aria-label', x ? base + ' — ' + x : base);
  });
  aria('[data-drive="upload"]', 'driveUpload', 'driveUpload');
  aria('[data-doc="drive"]', 'driveUpload', 'driveUpload');
}

/** Sekme kimlikleri özellik değildir: yetenek dökümü ve sayaçlar bunları saymaz */
const TAB_FEATURES = new Set(['draw', 'edit']);
/** tl_* karşılığı olmayan dört kimliğin var olan anahtarları */
const FEAT_KEY = { docEdit: 'docEdit', new: 'newFile', driveUpload: 'driveUpload', area3d: 'surfArea' };
/** FEATURE_TIER'dan TÜRETİLEN tam yetenek dökümü: [{ id, tier, label }] — elle liste yazılmaz.
 *  (Kart içindeki tanıtım maddelerini üreten featureList(x) ile karıştırılmamalı: o tierFeat_* okur.) */
export function capabilityList() {
  const out = [];
  for (const [id, x] of FEATURE_TIER) {
    if (TAB_FEATURES.has(id)) continue;
    const k = FEAT_KEY[id] || ('tl_' + id);
    const lb = t(k);
    out.push({ id, tier: x, label: lb === k ? id : lb });
  }
  return out;
}
/** from basamağından x basamağına geçilince açılan özellik sayısı (0 ise sayaç çizilmez) */
export const unlockCount = (x, from = tier()) =>
  capabilityList().filter(f => rank(f.tier) > rank(from) && rank(f.tier) <= rank(x)).length;

// ---------------------------------------------------------------------------------
// Pro paneli (#proPanel)
// ---------------------------------------------------------------------------------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dateText = (epochSec) => { try { return new Date(epochSec * 1000).toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'tr-TR'); } catch (_) { return String(epochSec); } };
/** Paketin özellik satırları: "tierFeat_<basamak>" anahtarı, satırlar "|" ile ayrılır.
 * Her satırın önünde onay imi durur; im, kartın kendi renk belirtecini (--t) alır. */
function featureList(x) {
  const raw = String(t('tierFeat_' + x));
  const li = raw.split('|').map(v => v.trim()).filter(Boolean)
    .map(v => `<li><svg class="fic" aria-hidden="true"><use href="#i-check"/></svg><span>${esc(v)}</span></li>`).join('');
  return `<ul class="pro-features">${li}</ul>`;
}
/**
 * Biçimli fiyat metninden sayı çıkarır ("₺1.699,99" → 1699.99, "$4.99" → 4.99, "¥1,200" → 1200).
 * Ondalık ayracı SONDAKİ bir ya da iki basamak kuralıyla bulunur; binlik ayracı ne olursa olsun atılır.
 * Play'in biçimi ülkeye göre değiştiği için ayrıştırılamayan fiyatta NaN döner ve tasarruf rozeti çıkmaz.
 */
export function priceNum(str) {
  const raw = String(str == null ? '' : str).replace(/[^\d.,]/g, '');
  if (!raw) return NaN;
  const m = raw.match(/[.,](\d{1,2})$/);
  const v = m
    ? Number(raw.slice(0, raw.length - m[0].length).replace(/[.,]/g, '') + '.' + m[1])
    : Number(raw.replace(/[.,]/g, ''));
  return isFinite(v) ? v : NaN;
}
/** Yıllık aboneliğin aylığa göre tasarruf oranı (0-1) ya da NaN */
export function savingOf(info, x) {
  const mo = priceNum(priceOf(info, x, 'monthly')), yr = priceNum(priceOf(info, x, 'yearly'));
  if (!(mo > 0) || !(yr > 0)) return NaN;
  const s = 1 - yr / (12 * mo);
  return s > 0.05 && s < 0.95 ? s : NaN;
}
/** Basamağın kimlik simgesi (kart başlığındaki yuvarlak rozette) */
const TIER_ICON = { adfree: 'i-noads', premium: 'i-pen', super: 'i-cube' };
/** Bir paket kartı: ad, özellikler, aylık + yıllık fiyat düğmeleri */
function tierCard(x, info, curTier) {
  const owned = curTier === x;
  const lower = rank(curTier) > rank(x);        // daha üst pakete sahip: bu kart bilgi amaçlı kalır
  const popular = x === 'premium' && !owned && !lower;
  const cls = 'tier-card t-' + x + (owned ? ' owned' : '') + (lower ? ' dim' : '') + (popular ? ' pop' : '');
  const save = savingOf(info, x);
  let h = `<div class="${cls}" data-tier="${x}">`;
  h += `<span class="tier-strip" aria-hidden="true"></span>`;
  if (popular) h += `<span class="tier-ribbon">${esc(tt('tierPopular', 'En çok seçilen'))}</span>`;
  h += `<div class="tier-head">`
    + `<span class="tier-ic" aria-hidden="true"><svg class="ic"><use href="#${TIER_ICON[x] || 'i-star'}"/></svg></span>`
    + `<span class="tier-name">${esc(tierName(x))}</span>`
    + (owned ? `<span class="tier-badge">${esc(tt('tierActive', 'Etkin'))}</span>` : '') + `</div>`;
  // Kaç özellik açıyor: aşağıdaki "Tüm yetenekler" dökümündeki satır sayısıyla BİREBİR aynıdır
  // (pazarlama sayısı değil, okuyucunun sayabileceği sayı).
  { const n = unlockCount(x, curTier); if (n) h += `<span class="tier-count">${esc(tt('tierUnlocks', '%s özellik açar').replace('%s', String(n)))}</span>`; }
  // Büyük okuma: aylık fiyat. Yoksa (Play hazır değil / tarayıcı) satır hiç çizilmez —
  // boş bir fiyat kutusu, fiyatı gizlenmiş gibi durur.
  const mo = priceOf(info, x, 'monthly');
  if (mo && !owned && !lower) h += `<div class="tier-price"><b>${esc(mo)}</b><span>${esc(tt('perMonth', '/ay'))}</span></div>`;
  h += featureList(x);
  if (!owned && !lower && info.android) {
    h += `<div class="tier-buy">`;
    for (const plan of PLANS) {
      const price = priceOf(info, x, plan);
      const label = plan === 'yearly' ? tt('planYearly', 'Yıllık') : tt('planMonthly', 'Aylık');
      const pill = plan === 'yearly' && save > 0
        ? ` <i class="save" aria-label="${esc(tt('tierSave', 'yıllıkta tasarruf'))}">\u2212%${Math.round(save * 100)}</i>` : '';
      h += `<button type="button" class="btn${plan === 'yearly' ? ' primary' : ''}" data-pro="buy" data-tier="${x}" data-plan="${plan}"${info.billingReady ? '' : ' disabled'}>`
        + `<span class="pl">${esc(label)}${pill}</span><span class="pr">${price ? esc(price) : esc(tt('proPriceNA', '—'))}</span></button>`;
    }
    h += `</div>`;
  }
  return h + `</div>`;
}
/** Paket panelinin altındaki tam yetenek dökümü. Liste ELLE YAZILMAZ: FEATURE_TIER'dan türetilir,
 *  böylece yeni bir özellik eklendiğinde kendiliğinden kapsanır. Adlar var olan tl_* anahtarlarından gelir. */
function allFeaturesHtml(curTier) {
  const rows = capabilityList();
  let h = `<div class="full lk-all"><div class="opt-title" data-i18n="allFeatures">${esc(tt('allFeatures', 'Tüm yetenekler'))}</div>`;
  for (const x of PAID_TIERS) {
    const li = rows.filter(f => f.tier === x);
    if (!li.length) continue;
    h += `<div class="lk-all-g" data-tier="${x}"><div class="lk-all-h"><i class="lk-all-d" aria-hidden="true"></i>`
      + `<b>${esc(tierName(x))}</b><small>${li.length}</small></div><ul>`
      + li.map(f => `<li${rank(curTier) >= rank(x) ? ' class="owned"' : ''}>${esc(f.label)}</li>`).join('')
      + `</ul></div>`;
  }
  return h + `</div>`;
}
function renderProPanel() {
  const body = $('proBody'); if (!body) return;
  const info = proInfo();
  const curTier = info.edition || tier();
  let html = '';
  // Başlık bandı: paket sayfasının kimliği. Sahibi olana durum, olmayana kısa tanıtım yazılır.
  if (rank(curTier) > 0) {
    const planTxt = info.plan === 'yearly' ? tt('planYearly', 'Yıllık') : info.plan === 'monthly' ? tt('planMonthly', 'Aylık') : '';
    const src = info.source === 'license'
      ? t('proSrcLicense') + (info.name ? ' — ' + info.name : '') + (info.exp ? ' (' + t('proExpires') + ' ' + dateText(info.exp) + ')' : '')
      : info.source === 'play' ? t('proSrcPlay') + (planTxt ? ' — ' + planTxt : '')
      : info.source === 'owner' ? t('proSrcOwner') + (info.name ? ' — ' + info.name : '') : '';
    html += `<div class="full pro-hero pro-status owned" data-pro-status="${esc(info.source)}" data-tier="${esc(curTier)}">`
      + `<span class="pro-hero-ic t-${esc(curTier)}" aria-hidden="true"><svg class="ic"><use href="#${TIER_ICON[curTier] || 'i-star'}"/></svg></span>`
      + `<span class="pro-hero-tx"><strong>${esc(tierName(curTier))}</strong>`
      + `<small>${src ? esc(src) : esc(t('proFeaturesIntro'))}</small></span></div>`;
  } else {
    html += `<div class="full pro-hero">`
      + `<span class="pro-hero-ic" aria-hidden="true"><svg class="ic"><use href="#i-star"/></svg></span>`
      + `<span class="pro-hero-tx"><strong>${esc(t('goPro'))}</strong><small>${esc(t('proFeaturesIntro'))}</small></span></div>`;
  }
  html += `<div class="full tier-grid">${PAID_TIERS.map(x => tierCard(x, info, curTier)).join('')}</div>`;
  html += allFeaturesHtml(curTier);
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
/** Pro alt sayfasını açar. focus verilirse o paketin kartı çerçevelenir ve ortalanır. */
export function openProPanel(focus) {
  const p = $('proPanel'); if (!p) return false;
  renderProPanel();
  p.hidden = false;   // scrollIntoView gizli ağaçta iş görmez: önce görünür yapılır
  const card = focus ? p.querySelector(`.tier-card[data-tier="${focus}"]`) : null;
  if (card) {
    p.querySelectorAll('.tier-card.focus').forEach(c => c.classList.remove('focus'));
    card.classList.add('focus');
    const soft = !document.body.classList.contains('reduce-motion');
    requestAnimationFrame(() => { try { card.scrollIntoView({ block: 'center', behavior: soft ? 'smooth' : 'auto' }); } catch (_) { card.scrollIntoView(); } });
  }
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
  // Yetkiden gizleme yok; yeniden çizilmeyen yüzeyler damgalanır. Bu blok olmadan satın alma
  // sonrası Düzenle / Drive / alan çipi rozetli kalır ve rozet YALAN söyler (docs.js ve app.js
  // 'dwg:edition' dinlemez; kod tabanındaki tek dinleyici home.js'tir).
  document.querySelectorAll('[data-drive="upload"]').forEach(b => lockMark(b, 'driveUpload', 'bar'));
  document.querySelectorAll('[data-doc="drive"]').forEach(b => lockMark(b, 'driveUpload', 'bar'));
  document.querySelectorAll('[data-doc="edit"]').forEach(b => lockMark(b, 'docEdit', 'pill'));
  { const ab = $('iaArea'); if (ab) lockMark(ab, 'area3d', 'pill'); }
  { const nb = $('btnNew2'); if (nb) lockMark(nb, 'new', 'pill'); }
  syncLockText();
  try { window.dispatchEvent(new CustomEvent('dwg:edition', { detail: { edition: applied } })); } catch (_) { /* yok */ }
}
/** Diğer menüsü eylemi yetki gereği gizli mi? ('pro' en üst pakette, kilitli eylemler yetmeyen basamakta) */
/** Diğer menüsü eylemi yetki gereği gizli mi? Kilitli eylem ARTIK GİZLENMEZ, rozetlenir;
 *  tek istisna 'pro' satırıdır: sahip olunan en üst pakette satın alma satırı gösterilmez. */
export function menuHiddenByEdition(act) {
  return String(act) === 'pro' && rank(tier()) >= rank('super');
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
  if (r === 'purchased' || r === 'restored' || r === 'license' || r === 'owner') toast(t('proActivated'), { type: 'ok' });
  else if (r === 'pending') toast(t('proPending'), { type: 'warn', ms: 5000 });
  else if (r === 'revoked') toast(t('proRevoked'), { type: 'warn' });
  else if (r === 'none') toast(t('proRestoreNone'), { type: 'warn' });
  else if (r.startsWith('error')) toast(t('error') + (r.length > 6 ? ': ' + r.slice(6) : ''), { type: 'error' });
  // cancelled ve boş neden: sessiz
  return e;
}
/** app.js bağlar: api { toast, rebuildToolbar, refreshMenu } */
let langBound = false;
export function initEdition(a) {
  api = a || null;
  // Dil değişimi: applyI18n data-i18n taşıyan hapı tazeler; %s'li kilit cümlesi ile
  // simge-yalnız düğmelerin aria-label'ı buradan tazelenir (olay applyI18n'den SONRA gelir).
  if (!langBound) { langBound = true; window.addEventListener('dwg:lang', () => syncLockText()); }
  applyEdition();
  const b = $('btnGoPro'); if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => openProPanel()); }
  const body = $('proBody'); if (body && !body.dataset.bound) { body.dataset.bound = '1'; body.addEventListener('click', (ev) => { const btn = ev.target.closest('[data-pro]'); if (btn && !btn.disabled) void proAction(btn.dataset.pro, btn); }); }
  start();
}
