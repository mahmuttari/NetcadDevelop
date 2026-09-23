/*
 * ARŞİV İŞLEMLERİ — çıkarma (ZIP / RAR) ve arşiv yapma (ZIP).
 *
 * Bu dosya yalnız işin kendisini taşır; düğmeler ve listeler docs.js (arşiv gezgini) ile open.js
 * (dosya paneli) içindedir. Böylece iki yüzey de aynı yolu kullanır ve sınamalar tarayıcıda
 * düğmeye dokunmadan koşabilir.
 *
 * ÇIKARMA
 *   Android: baytlar JS'e HİÇ uğramaz. Köprü (MainActivity.arcSave) arşivi Java'da açar, her girdiyi
 *   doğrudan İndirilenler/DWGViewer/<klasör> altına akıtır; ilerleme onArcProgress ile gelir. 200 MB'lık
 *   bir arşivi base64'e çevirip WebView'e taşımak telefonu düşürürdü.
 *   Tarayıcı: girdi docs.js'in ZIP okuyucusuyla açılır ve tek tek indirilir (tarayıcı klasör yazamaz;
 *   klasör yolu dosya adına "_" ile katılır).
 *
 * ARŞİV YAPMA
 *   docedit.js'in zipWrite'ı kullanılır (deflate-raw + CRC32) — DOCX kaydetmeyle aynı yazıcı, iki ayrı
 *   ZIP üreticisi olmaz. Girdi adları Zip-Slip'e karşı temizlenir, çakışan adlar numaralandırılır.
 *
 * GÜVENLİK
 *   guvenliYol() bozuk bir arşivin "../../başka" gibi girdilerini eler; Java tarafında altKlasor() aynı
 *   denetimi bir kez daha yapar (köprüye JS dışından da gelinebileceği varsayılır).
 */
import { t } from './i18n.js';
import { zipWrite } from './docedit.js';

const A = () => window.Android;
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };

/** Windows ve Android'de dosya adında bulunamayacak karakterler */
const YASAK = /[\\/:*?"<>|\u0000-\u001f]+/g;
/** Bellekte kurulan ZIP için üst sınır: bunun üstü telefonda çökme demektir */
export const ZIP_SINIRI = 200 * 1024 * 1024;

/** Tek bir ad parçasını dosya adı olarak güvenli yapar (Türkçe harfler korunur) */
export function guvenliAd(s, varsayilan = 'dosya') {
  let a = String(s == null ? '' : s).replace(YASAK, '_').replace(/^\.+/, '').replace(/[. ]+$/, '').trim();
  if (a.length > 120) {
    const i = a.lastIndexOf('.');
    const uz = i > 0 && a.length - i <= 8 ? a.slice(i) : '';
    a = (a.slice(0, 120 - uz.length) + uz).trim();
  }
  return a || varsayilan;
}
/** Göreli yolu güvenli yapar: '..' ve '.' parçaları ATILIR (Zip-Slip), her parça temizlenir */
export function guvenliYol(yol) {
  return String(yol == null ? '' : yol).replace(/\\/g, '/').split('/')
    .map(s => s.trim())
    .filter(s => s && s !== '.' && s !== '..')
    .map(s => guvenliAd(s, ''))
    .filter(Boolean)
    .join('/');
}
/** "proje.zip" → "proje" (çıkarma hedefi klasörü) */
export function klasorAdi(ad) { return guvenliAd(String(ad || '').replace(/\.[^.]+$/, ''), 'arsiv'); }
/** Yolun klasör kısmı ("a/b/c.dwg" → "a/b") */
export const dizinYolu = (yol) => (yol.includes('/') ? yol.slice(0, yol.lastIndexOf('/')) : '');
/** Yolun dosya adı kısmı */
export const sonAd = (yol) => String(yol || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';

const MIME = { dwg: 'image/vnd.dwg', dxf: 'image/vnd.dxf', pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'application/xml' };
export const mimeFor = (ad) => MIME[String(ad || '').toLowerCase().split('.').pop()] || 'application/octet-stream';

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + 0x8000)));
  return btoa(s);
}

/**
 * Baytları kullanıcının görebileceği depoya yazar.
 *   Android → İndirilenler/DWGViewer[/altKlasor]/<ad>
 *   Tarayıcı → indirme (klasör yazılamaz; altKlasor ada "_" ile katılır)
 * Dönüş: yazılan yerin metni ('' ise yazılamadı).
 */
export function diskeYaz(u8, ad, opts = {}) {
  const mime = opts.mime || mimeFor(ad);
  const alt = guvenliYol(opts.altKlasor || '');
  const dosya = guvenliAd(ad);
  const a = A();
  if (a && a.saveFileIn && alt) { try { return a.saveFileIn(b64(u8), dosya, mime, alt, !!opts.share) || ''; } catch (e) { console.warn(e); return ''; } }
  if (a && a.saveFile) { try { return a.saveFile(b64(u8), dosya, mime, !!opts.share) || ''; } catch (e) { console.warn(e); return ''; } }
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob([u8], { type: mime }));
  el.download = alt ? alt.replace(/\//g, '_') + '_' + dosya : dosya;
  el.rel = 'noopener';
  document.body.appendChild(el);
  el.click();
  el.remove();
  setTimeout(() => URL.revokeObjectURL(el.href), 8000);
  return el.download;
}

// ---- Android köprüsünün eşzamansız yanıtı ------------------------------------------------
const bekleyen = new Map();
let sira = 0;
/** MainActivity.arcSave sonucu */
export function onArc(reqId, ok, json) {
  const p = bekleyen.get(reqId); if (!p) return;
  bekleyen.delete(reqId);
  let o = json;
  if (typeof o === 'string' && ok) { try { o = JSON.parse(o); } catch (_) { o = {}; } }
  if (ok) p.resolve(o || {}); else p.reject(new Error(typeof json === 'string' ? json : JSON.stringify(json)));
}
/** MainActivity.arcSave ilerlemesi */
export function onArcProgress(reqId, done, total, ad) {
  const p = bekleyen.get(reqId);
  if (p && p.ilerle) { try { p.ilerle(done, total, ad || ''); } catch (e) { console.warn(e); } }
}
function arcSaveNative(id, girdiler, klasor, ilerle) {
  return new Promise((resolve, reject) => {
    const reqId = 'a' + (++sira);
    bekleyen.set(reqId, { resolve, reject, ilerle });
    try { A().arcSave(reqId, id, JSON.stringify(girdiler), klasor); }
    catch (e) { bekleyen.delete(reqId); reject(e); }
  });
}

/**
 * Arşiv girdilerini diske çıkarır.
 *   arc      docs.js openArchive() nesnesi ({ id?, native, entries, read })
 *   girdiler çıkarılacak girdi adları (boş dizi: arşivin tamamı)
 *   opts     { klasor: hedef alt klasör, ilerle(done,total,ad) }
 * Dönüş: { n, atlanan, hata: [{ad,mesaj}], nere }
 */
export async function cikar(arc, girdiler, opts = {}) {
  const klasor = guvenliYol(opts.klasor || '');
  const ilerle = typeof opts.ilerle === 'function' ? opts.ilerle : null;
  const liste = (girdiler || []).filter(Boolean);
  if (arc && arc.id && A() && A().arcSave) {
    const r = await arcSaveNative(arc.id, liste, klasor, ilerle);
    return { n: Number(r.n) || 0, atlanan: Number(r.atlanan) || 0, hata: Array.isArray(r.hata) ? r.hata : [], nere: r.where || '' };
  }
  // Tarayıcı: girdi girdi oku ve indir
  const hedef = liste.length ? liste : (arc.entries || []).filter(e => !e.dir).map(e => e.name);
  const out = { n: 0, atlanan: 0, hata: [], nere: '' };
  for (let i = 0; i < hedef.length; i++) {
    const ad = hedef[i];
    if (ilerle) ilerle(i, hedef.length, ad);
    try {
      const buf = await arc.read(ad);
      const rel = guvenliYol(ad);
      if (!rel) { out.atlanan++; continue; }
      const dizin = dizinYolu(rel);
      const nere = diskeYaz(new Uint8Array(buf), sonAd(rel), { altKlasor: klasor ? (dizin ? klasor + '/' + dizin : klasor) : dizin });
      if (nere) { out.n++; out.nere = nere; } else out.atlanan++;
    } catch (e) { out.hata.push({ ad, mesaj: e && e.message ? e.message : String(e) }); }
  }
  if (ilerle) ilerle(hedef.length, hedef.length, '');
  return out;
}

/**
 * ZIP kurar. girdiler: [{ name, data:Uint8Array, time? }]
 * Adlar temizlenir; aynı ada düşen girdiler "ad (2).uzantı" olarak numaralanır.
 */
export async function zipYap(girdiler) {
  const gorulen = new Map(), temiz = [];
  let toplam = 0;
  for (const g of girdiler || []) {
    if (!g || !g.data) continue;
    toplam += g.data.length;
    if (toplam > ZIP_SINIRI) throw new Error(tt('arcTooBig', 'Seçim çok büyük; en çok 200 MB sıkıştırılabilir.'));
    let ad = guvenliYol(g.name) || 'dosya';
    const k = ad.toLocaleLowerCase('tr');
    if (gorulen.has(k)) {
      const n = gorulen.get(k) + 1;
      gorulen.set(k, n);
      const i = ad.lastIndexOf('.');
      ad = i > 0 ? ad.slice(0, i) + ' (' + n + ')' + ad.slice(i) : ad + ' (' + n + ')';
    } else gorulen.set(k, 1);
    temiz.push({ name: ad, data: g.data, time: g.time || 0 });
  }
  if (!temiz.length) throw new Error(tt('arcNoEntry', 'Çıkarılacak dosya yok'));
  return zipWrite(temiz);
}

/** Bir arşiv girdisi listesinden verilen klasörün altındaki dosya adlarını verir */
export function klasorAltindakiler(entries, yol) {
  const p = yol ? (yol.endsWith('/') ? yol : yol + '/') : '';
  return (entries || []).filter(e => !e.dir && String(e.name).replace(/\\/g, '/').startsWith(p)).map(e => String(e.name).replace(/\\/g, '/'));
}
