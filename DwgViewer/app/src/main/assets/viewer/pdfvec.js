/*
 * pdfvec.js — KATMANLI VEKTÖR PDF yazıcısı. AutoCAD'in "DWG to PDF.pc3" çizicisinin karşılığıdır.
 *
 * Mevcut PDF çıktısı sayfayı JPEG olarak gömer: büyütünce bulanıklaşır, içinden yazı seçilemez,
 * katman yoktur. Buradaki yazıcı sahnenin İLKELLERİNİ doğrudan PDF yol işleçlerine çevirir:
 *
 *   · çizgi / yay / elips  →  PDF yolu (yaylar kübik Bézier'e bölünür, 90°'den küçük parçalar)
 *   · dolgu ve tarama      →  tek-çift (even-odd) dolgu, gerekirse saydamlık (ExtGState /ca)
 *   · yazı                 →  GERÇEK PDF yazısı (seçilebilir, aranabilir, ölçeklenebilir)
 *   · resim                →  DCTDecode (JPEG) XObject
 *   · KATMAN               →  PDF "optional content group" (OCG): okuyucu katmanı açıp kapatır
 *
 * KATMAN SIRASI BOZULMAZ. Katmana göre gruplamak kolay olurdu ama çizim sırasını değiştirirdi:
 * bir katmandaki dolgu, başka katmandaki çizgiyi örterdi. Bunun yerine ilkeller EKRANDAKİ SIRAYLA
 * yazılır ve katman değiştiği yerde açık olan işaretli içerik bloğu kapatılıp yenisi açılır
 * (/OC /ocN BDC … EMC). AutoCAD de böyle yapar.
 *
 * YAZI VE KODLAMA. PDF'in 14 temel yazı tipinden Helvetica kullanılır; hiçbir yazı tipi gömülmez
 * (dosya küçük kalır, her okuyucuda açılır). Kodlama SABİT DEĞİLDİR: çizimde geçen karakterler
 * görüldükçe 32'den başlayarak kod alır ve belgenin sonunda /Differences dizisi olarak yazılır.
 * Böylece Türkçe (ğ Ğ ş Ş ı İ), Lehçe, Çekçe, Romence harfler gerçek harf olarak gider. Adobe glif
 * adı bilinmeyen karakter (Kiril, Yunan, CJK) '?' olur ve SAYILIR — çağıran bunu kullanıcıya söyler.
 *
 * ÖLÇÜ BİRİMİ. PDF'in kullanıcı birimi 1/72 inçtir (nokta). Dünya koordinatları JS'te (64 bit)
 * noktaya çevrilir, PDF'e dönüşüm matrisi konmaz: böylece çizgi kalınlığı ve kesik çizgi deseni
 * ölçekten etkilenmez, kalınlık kâğıtta gerçekten yazıldığı kadar (1/100 mm) çıkar.
 */

export const PT = 72 / 25.4;          // mm → nokta
const TAU = Math.PI * 2;

/* ---- sayı ve dize biçimleme ------------------------------------------------------- */
/** PDF sayısı: 3 ondalık, gereksiz sıfırlar atılır, üstel gösterim YOK (PDF kabul etmez) */
export function sy(v) {
  if (!isFinite(v)) return '0';
  if (Math.abs(v) < 5e-4) return '0';
  const s = v.toFixed(3);
  return s.indexOf('.') < 0 ? s : s.replace(/0+$/, '').replace(/\.$/, '');
}
/** PDF metin dizesi (yalnız ASCII; künye ve başlık için) */
const pdfStr = (s) => '(' + String(s == null ? '' : s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, (c) => {
  const n = c.charCodeAt(0);
  return n < 256 ? '\\' + n.toString(8).padStart(3, '0') : '?';
}) + ')';
/** UTF-16BE onaltılık dize — katman adları gibi her dilde doğru görünmesi gereken alanlar için */
function hex16(s) {
  let o = 'FEFF';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (c > 0xffff) { const v = c - 0x10000; o += (0xd800 + (v >> 10)).toString(16).padStart(4, '0').toUpperCase() + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0').toUpperCase(); }
    else o += c.toString(16).padStart(4, '0').toUpperCase();
  }
  return '<' + o + '>';
}

/* ---- Helvetica glif adları ve genişlikleri ----------------------------------------- */
/*
 * Glif adları Adobe Glyph List'tendir; Helvetica'nın yerine konan yazı tipleri (Arial, Liberation
 * Sans, Nimbus Sans) bu adların tamamını taşır. Genişlikler Helvetica.afm'den alınmıştır; vurgulu
 * harfler Helvetica'da taban harfle AYNI genişliktedir (vurgu ilerlemeyi değiştirmez), o yüzden
 * tablo yalnız taban harfleri tutar ve vurgulu harf tabanına düşer. Tek istisna 'ı' (dotlessi):
 * Helvetica'da 278'dir, 'i' ise 222 — Türkçe metinde sık geçtiği için ayrıca yazılmıştır.
 */
const ASCII_AD = ('space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash '
  + 'zero one two three four five six seven eight nine colon semicolon less equal greater question at '
  + 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave '
  + 'a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde').split(' ');

/** Latin-1 ek bölgesi (0xA0-0xFF) Adobe adları */
const L1_AD = ('space exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot hyphen registered macron '
  + 'degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown '
  + 'Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis '
  + 'Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls '
  + 'agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis '
  + 'eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis').split(' ');

/** Latin-1 dışı, mühendislik çizimlerinde geçen harf ve işaretler */
const EK_AD = {
  // Türkçe
  0x011e: 'Gbreve', 0x011f: 'gbreve', 0x0130: 'Idotaccent', 0x0131: 'dotlessi', 0x015e: 'Scedilla', 0x015f: 'scedilla',
  // Lehçe
  0x0104: 'Aogonek', 0x0105: 'aogonek', 0x0106: 'Cacute', 0x0107: 'cacute', 0x0118: 'Eogonek', 0x0119: 'eogonek',
  0x0141: 'Lslash', 0x0142: 'lslash', 0x0143: 'Nacute', 0x0144: 'nacute', 0x015a: 'Sacute', 0x015b: 'sacute',
  0x0179: 'Zacute', 0x017a: 'zacute', 0x017b: 'Zdotaccent', 0x017c: 'zdotaccent',
  // Çekçe · Slovakça · Hırvatça
  0x010c: 'Ccaron', 0x010d: 'ccaron', 0x010e: 'Dcaron', 0x010f: 'dcaron', 0x011a: 'Ecaron', 0x011b: 'ecaron',
  0x0139: 'Lacute', 0x013a: 'lacute', 0x013d: 'Lcaron', 0x013e: 'lcaron', 0x0147: 'Ncaron', 0x0148: 'ncaron',
  0x0154: 'Racute', 0x0155: 'racute', 0x0158: 'Rcaron', 0x0159: 'rcaron', 0x0160: 'Scaron', 0x0161: 'scaron',
  0x0164: 'Tcaron', 0x0165: 'tcaron', 0x016e: 'Uring', 0x016f: 'uring', 0x017d: 'Zcaron', 0x017e: 'zcaron',
  // Macarca · Baltık · Romence
  0x0150: 'Ohungarumlaut', 0x0151: 'ohungarumlaut', 0x0170: 'Uhungarumlaut', 0x0171: 'uhungarumlaut',
  0x0100: 'Amacron', 0x0101: 'amacron', 0x0112: 'Emacron', 0x0113: 'emacron', 0x012a: 'Imacron', 0x012b: 'imacron',
  0x016a: 'Umacron', 0x016b: 'umacron', 0x0102: 'Abreve', 0x0103: 'abreve',
  0x0218: 'Scommaaccent', 0x0219: 'scommaaccent', 0x021a: 'Tcommaaccent', 0x021b: 'tcommaaccent',
  0x0162: 'Tcommaaccent', 0x0163: 'tcommaaccent',
  // noktalama ve mühendislik işaretleri
  0x2013: 'endash', 0x2014: 'emdash', 0x2018: 'quoteleft', 0x2019: 'quoteright', 0x201a: 'quotesinglbase',
  0x201c: 'quotedblleft', 0x201d: 'quotedblright', 0x201e: 'quotedblbase', 0x2020: 'dagger', 0x2021: 'daggerdbl',
  0x2022: 'bullet', 0x2026: 'ellipsis', 0x2030: 'perthousand', 0x2039: 'guilsinglleft', 0x203a: 'guilsinglright',
  0x20ac: 'Euro', 0x2122: 'trademark', 0x0152: 'OE', 0x0153: 'oe', 0x0178: 'Ydieresis', 0x0192: 'florin',
  0x2044: 'fraction', 0x2212: 'minus', 0x2264: 'lessequal', 0x2265: 'greaterequal', 0x2260: 'notequal',
  0x00b0: 'degree', 0x00d8: 'Oslash', 0x00f8: 'oslash', 0x2300: 'Oslash',
};

/** kod noktası → Adobe glif adı (yoksa null) */
function glifAdi(c) {
  if (c >= 32 && c <= 126) return ASCII_AD[c - 32];
  if (c >= 0xa0 && c <= 0xff) return L1_AD[c - 0xa0];
  return EK_AD[c] || null;
}

/* Helvetica ilerleme genişlikleri (1/1000 em) — ASCII kesin, vurgulular taban harfe düşer */
const W_ASCII = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
/** Latin-1 ve Latin-B harflerini taban ASCII harfine indirger (genişlik için) */
const TABAN = { Á: 'A', À: 'A', Â: 'A', Ã: 'A', Ä: 'A', Å: 'A', Ā: 'A', Ă: 'A', Ą: 'A', Æ: 'AE', Ç: 'C', Ć: 'C', Č: 'C',
  Ď: 'D', Ð: 'D', É: 'E', È: 'E', Ê: 'E', Ë: 'E', Ē: 'E', Ě: 'E', Ę: 'E', Ğ: 'G', Í: 'I', Ì: 'I', Î: 'I', Ï: 'I', Ī: 'I', İ: 'I',
  Ĺ: 'L', Ľ: 'L', Ł: 'L', Ñ: 'N', Ń: 'N', Ň: 'N', Ó: 'O', Ò: 'O', Ô: 'O', Õ: 'O', Ö: 'O', Ø: 'O', Ő: 'O', Œ: 'OE',
  Ŕ: 'R', Ř: 'R', Ś: 'S', Š: 'S', Ş: 'S', Ș: 'S', Ť: 'T', Ţ: 'T', Ț: 'T', Ú: 'U', Ù: 'U', Û: 'U', Ü: 'U', Ū: 'U', Ů: 'U', Ű: 'U',
  Ý: 'Y', Ÿ: 'Y', Ź: 'Z', Ż: 'Z', Ž: 'Z', Þ: 'P',
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', ā: 'a', ă: 'a', ą: 'a', æ: 'ae', ç: 'c', ć: 'c', č: 'c',
  ď: 'd', ð: 'o', é: 'e', è: 'e', ê: 'e', ë: 'e', ē: 'e', ě: 'e', ę: 'e', ğ: 'g', í: 'i', ì: 'i', î: 'i', ï: 'i', ī: 'i',
  ĺ: 'l', ľ: 'l', ł: 'l', ñ: 'n', ń: 'n', ň: 'n', ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o', ő: 'o', œ: 'oe',
  ŕ: 'r', ř: 'r', ś: 's', š: 's', ş: 's', ș: 's', ť: 't', ţ: 't', ț: 't', ú: 'u', ù: 'u', û: 'u', ü: 'u', ū: 'u', ů: 'u', ű: 'u',
  ý: 'y', ÿ: 'y', ź: 'z', ż: 'z', ž: 'z', þ: 'p', ß: 'B', µ: 'u' };
const EK_W = { 'ı': 278, '°': 400, '–': 556, '—': 1000, '’': 222, '‘': 222, '“': 333, '”': 333, '…': 1000, '€': 556,
  '±': 584, '×': 584, '÷': 584, '·': 278, '•': 350, '™': 1000, '≤': 549, '≥': 549, '≠': 549, '−': 584, '½': 834, '¼': 834, '¾': 834 };
/** bir karakterin Helvetica ilerlemesi (em kesri) */
function harfW(ch) {
  const e = EK_W[ch]; if (e != null) return e / 1000;
  let s = TABAN[ch] || ch;
  let w = 0;
  for (const c of s) { const n = c.charCodeAt(0); w += (n >= 32 && n <= 126) ? W_ASCII[n - 32] : 556; }
  return w / 1000;
}

/* ---- akış sıkıştırma --------------------------------------------------------------- */
/*
 * İçerik akışı sıkıştırma. Vektör çıktıda içerik akışı ham metindir ve büyük bir çizimde
 * onlarca megabayta çıkar; zlib ile 8-12 katı küçülür. CompressionStream her ortamda yoktur
 * (eski WebView, bazı sınama ortamları) — yoksa akış sıkıştırılmadan yazılır, PDF yine geçerlidir.
 */
async function deflate(metin) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const cs = new CompressionStream('deflate');
    const yaz = cs.writable.getWriter();
    yaz.write(new TextEncoder().encode(metin));
    yaz.close();
    const parca = [];
    const oku = cs.readable.getReader();
    for (;;) { const r = await oku.read(); if (r.done) break; parca.push(r.value); }
    let n = 0; for (const p of parca) n += p.length;
    const out = new Uint8Array(n); let o = 0; for (const p of parca) { out.set(p, o); o += p.length; }
    return out.length < metin.length ? out : null;
  } catch (_) { return null; }
}

/* ---- PDF nesne kurucusu ------------------------------------------------------------ */
class Yazici {
  constructor() {
    this.parcalar = []; this.uzunluk = 0; this.konum = []; this.sayac = 0;
    this.enc = new TextEncoder();
    this.ham('%PDF-1.5\n');
  }
  ham(v) { const b = typeof v === 'string' ? this.enc.encode(v) : v; this.parcalar.push(b); this.uzunluk += b.length; }
  /** Yeni nesne numarası ayırır; gövdesi sonra yazılabilir (ileri başvuru için) */
  ayir() { return ++this.sayac; }
  yaz(id, govde) { this.konum[id] = this.uzunluk; this.ham(id + ' 0 obj\n'); this.ham(govde); this.ham('\nendobj\n'); }
  akis(id, sozluk, veri) {
    const b = typeof veri === 'string' ? this.enc.encode(veri) : veri;
    this.konum[id] = this.uzunluk;
    this.ham(id + ' 0 obj\n<< ' + sozluk + ' /Length ' + b.length + ' >>\nstream\n');
    this.ham(b); this.ham('\nendstream\nendobj\n');
  }
  bitir(kokId, kunyeId) {
    const xrefKonum = this.uzunluk, n = this.sayac + 1;
    let x = 'xref\n0 ' + n + '\n0000000000 65535 f \n';
    for (let i = 1; i <= this.sayac; i++) x += String(this.konum[i] || 0).padStart(10, '0') + ' 00000 n \n';
    this.ham(x + 'trailer\n<< /Size ' + n + ' /Root ' + kokId + ' 0 R' + (kunyeId ? ' /Info ' + kunyeId + ' 0 R' : '') + ' >>\nstartxref\n' + xrefKonum + '\n%%EOF\n');
    const toplam = this.uzunluk, out = new Uint8Array(toplam);
    let o = 0; for (const p of this.parcalar) { out.set(p, o); o += p.length; }
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return btoa(s);
  }
}

/* ---- yay → Bézier ------------------------------------------------------------------ */
/**
 * Elips yayını kübik Bézier parçalarına böler (parça başına ≤ 90°, hata < 0,02 %).
 * Merkez C, yarı eksenler rx/ry, eksen dönmesi rot, parametrik açı a0 → a1 (yön işaretlidir).
 */
function yayBez(cx, cy, rx, ry, rot, a0, d, ekle) {
  const n = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 2)));
  const adim = d / n;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const P = (a) => { const c = Math.cos(a), s = Math.sin(a); return [cx + rx * c * cs - ry * s * sn, cy + rx * c * sn + ry * s * cs]; };
  const T = (a) => { const c = Math.cos(a), s = Math.sin(a); return [-rx * s * cs - ry * c * sn, -rx * s * sn + ry * c * cs]; };
  const alfa = (4 / 3) * Math.tan(adim / 4);
  for (let i = 0; i < n; i++) {
    const a = a0 + adim * i, b = a + adim;
    const p0 = P(a), p1 = P(b), t0 = T(a), t1 = T(b);
    ekle(p0[0] + alfa * t0[0], p0[1] + alfa * t0[1], p1[0] - alfa * t1[0], p1[1] - alfa * t1[1], p1[0], p1[1]);
  }
}

/* ---- içerik akışı ------------------------------------------------------------------ */
/** Bir sayfanın işleç dizisi; sayılar NOKTA cinsindendir (dünya→nokta dönüşümü çağıran tarafta). */
class Akis {
  constructor() { this.b = []; this.renk = null; this.kalin = null; this.kesik = null; this.saydam = null; }
  y(s) { this.b.push(s); }
  toString() { return this.b.join('\n'); }
}

/* ---- belge ------------------------------------------------------------------------- */
/**
 * Yeni bir katmanlı vektör PDF belgesi.
 * @param kunye { baslik, uretici }
 */
export function pdfBelge(kunye = {}) {
  const w = new Yazici();
  const sayfalar = [];
  const ocg = new Map();          // katman adı → { id, ad, kaynak }
  const gs = new Map();           // alfa → kaynak adı
  const resimler = [];            // { ad, id, veri, w, h, gri }
  const kod = new Map([[' ', 32]]);   // karakter → kodlama numarası
  const kodlar = ['space'];           // numaraya göre Adobe glif adı
  const kodHarf = [' '];              // numaraya göre karakterin kendisi (ToUnicode için)
  let eksik = 0;                  // glif adı bilinmeyen karakter sayısı
  let yaziVar = false;

  /** Karakteri kodlamaya alır; kod döner (yer kalmadıysa ya da glif adı yoksa '?') */
  function kodla(ch) {
    let c = kod.get(ch);
    if (c !== undefined) return c;
    const ad = glifAdi(ch.codePointAt(0));
    if (!ad || kodlar.length >= 224) { eksik++; return kodla('?'); }
    c = 32 + kodlar.length;
    kodlar.push(ad); kodHarf.push(ch); kod.set(ch, c);
    return c;
  }
  /** Dizeyi PDF onaltılık dizesine çevirir (kodlamayı büyütür) */
  function metinHex(s) {
    let o = '';
    for (const ch of String(s)) o += kodla(ch).toString(16).padStart(2, '0').toUpperCase();
    return '<' + o + '>';
  }
  /** Dizenin Helvetica genişliği (em kesri) */
  function metinW(s) { let x = 0; for (const ch of String(s)) x += harfW(ch); return x; }

  function ocgAl(ad) {
    let o = ocg.get(ad);
    if (!o) { o = { id: w.ayir(), ad, kaynak: 'oc' + ocg.size }; ocg.set(ad, o); }
    return o;
  }
  function gsAl(a) {
    const k = a.toFixed(2);
    let n = gs.get(k);
    if (!n) { n = 'ga' + gs.size; gs.set(k, n); }
    return n;
  }
  function resimAl(anahtar, veri, pw, ph) {
    let r = resimler.find(q => q.anahtar === anahtar);
    if (!r) { r = { anahtar, ad: 'Im' + resimler.length, id: w.ayir(), veri, w: pw, h: ph }; resimler.push(r); }
    return r;
  }

  const belge = {
    metinHex, metinW, ocgAl, gsAl, resimAl,
    get eksikHarf() { return eksik; },
    get katmanSayisi() { return ocg.size; },
    yaziKullanildi() { yaziVar = true; },
    sayfaEkle(wmm, hmm) {
      const s = { wmm, hmm, akis: new Akis(), kullanilanOcg: new Set(), kullanilanGs: new Set(), kullanilanRes: new Set() };
      sayfalar.push(s);
      return s;
    },
    async bitir() {
      const kokId = w.ayir(), agacId = w.ayir(), kunyeId = w.ayir();
      const fontId = yaziVar ? w.ayir() : 0, encId = yaziVar ? w.ayir() : 0, tuId = yaziVar ? w.ayir() : 0;
      const sayfaId = sayfalar.map(() => w.ayir());
      const icerikId = sayfalar.map(() => w.ayir());

      for (let i = 0; i < sayfalar.length; i++) {
        const s = sayfalar[i];
        const kay = [];
        if (yaziVar) kay.push('/Font << /F1 ' + fontId + ' 0 R >>');
        if (s.kullanilanOcg.size) kay.push('/Properties << ' + [...s.kullanilanOcg].map(ad => '/' + ocg.get(ad).kaynak + ' ' + ocg.get(ad).id + ' 0 R').join(' ') + ' >>');
        if (s.kullanilanGs.size) kay.push('/ExtGState << ' + [...s.kullanilanGs].map(k => '/' + gs.get(k) + ' << /ca ' + k + ' /CA ' + k + ' >>').join(' ') + ' >>');
        if (s.kullanilanRes.size) kay.push('/XObject << ' + [...s.kullanilanRes].map(a => { const r = resimler.find(q => q.anahtar === a); return '/' + r.ad + ' ' + r.id + ' 0 R'; }).join(' ') + ' >>');
        kay.push('/ProcSet [/PDF /Text /ImageC]');
        w.yaz(sayfaId[i], '<< /Type /Page /Parent ' + agacId + ' 0 R /MediaBox [0 0 ' + sy(s.wmm * PT) + ' ' + sy(s.hmm * PT) + ']'
          + ' /Contents ' + icerikId[i] + ' 0 R /Resources << ' + kay.join(' ') + ' >> >>');
        const ham = String(s.akis);
        const sik = await deflate(ham);
        if (sik) w.akis(icerikId[i], '/Filter /FlateDecode', sik); else w.akis(icerikId[i], '', ham);
      }
      for (const r of resimler) {
        w.akis(r.id, '/Type /XObject /Subtype /Image /Width ' + r.w + ' /Height ' + r.h
          + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', r.veri);
      }
      for (const o of ocg.values()) w.yaz(o.id, '<< /Type /OCG /Name ' + hex16(o.ad) + ' >>');
      if (yaziVar) {
        w.yaz(encId, '<< /Type /Encoding /Differences [32 ' + kodlar.map(a => '/' + a).join(' ') + '] >>');
        /*
         * ToUnicode: PDF'in kod → Unicode sözlüğü. Glif adları Adobe listesinden olduğu için çoğu
         * okuyucu adı zaten çözer, ama garanti değildir; bu eşleme olmadan Türkçe harfler
         * kopyalandığında bozuk çıkabilir. 30 satır karşılığında yazı gerçekten ARANABİLİR olur.
         */
        const u16 = (ch) => { let o = ''; for (let i = 0; i < ch.length; i++) o += ch.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase(); return o; };
        const cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
          + '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n'
          + kodHarf.map((ch, i) => '<' + (32 + i).toString(16).padStart(2, '0').toUpperCase() + '> <' + u16(ch) + '>').reduce((acc, satir, i) => {
            if (i % 100 === 0) acc.push([]);
            acc[acc.length - 1].push(satir);
            return acc;
          }, []).map(grup => grup.length + ' beginbfchar\n' + grup.join('\n') + '\nendbfchar\n').join('')
          + 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
        w.akis(tuId, '', cmap);
        w.yaz(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ' + encId + ' 0 R /ToUnicode ' + tuId + ' 0 R >>');
      }
      w.yaz(agacId, '<< /Type /Pages /Kids [' + sayfaId.map(i => i + ' 0 R').join(' ') + '] /Count ' + sayfalar.length + ' >>');
      const ocList = [...ocg.values()];
      const ocProp = ocList.length
        ? ' /OCProperties << /OCGs [' + ocList.map(o => o.id + ' 0 R').join(' ') + ']'
          + ' /D << /Name ' + hex16('Layers') + ' /BaseState /ON /Order [' + ocList.map(o => o.id + ' 0 R').join(' ') + '] >> >>'
        : '';
      w.yaz(kokId, '<< /Type /Catalog /Pages ' + agacId + ' 0 R' + ocProp + ' >>');
      w.yaz(kunyeId, '<< /Title ' + pdfStr(kunye.baslik || '') + ' /Producer (DWG OfficeZip) /Creator (DWG OfficeZip)'
        + ' /CreationDate (D:' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + ') >>');
      return w.bitir(kokId, kunyeId);
    },
  };
  return belge;
}

/* =====================================================================================
 * İKİNCİ BÖLÜM — SAHNE İLKELLERİNİ KÂĞIDA BASMA
 * ===================================================================================*/

/*
 * Canvas'ın yazı taban çizgileri. textBaseline 'top' ve 'middle' verilen noktayı harfin
 * ÜSTÜNE ya da ORTASINA oturtur; PDF ise her zaman TABAN ÇİZGİSİNE oturtur. Aradaki fark
 * yazı tipinin çıkıntı (ascent) ve iniş (descent) ölçüleridir — Arial / Liberation Sans /
 * Helvetica ailesinde 0,905 ve 0,212 em'dir.
 */
const ASC = 0.905, DESC = 0.212;
const FG = -1;                                   // scene.js ile aynı ön plan işareti

/** ilkel renk alanı → PDF rgb üçlüsü (0..1); FG kâğıtta siyahtır */
function rgb(c) {
  if (c === FG || c == null) return [0, 0, 0];
  if (typeof c === 'string') {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return [0, 0, 0];
    c = parseInt(m[1], 16);
  }
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

/**
 * Çizgi tipi deseni → PDF kesik dizisi (nokta cinsinden). render.js dashOf'un kâğıt karşılığı:
 * ekranda "4 px'ten kısa desen düz çizilir" kuralı burada "0,4 mm'den kısa desen düz çizilir"
 * olur; nokta (sıfır uzunluklu öğe) kâğıtta 0,12 mm'lik bir tire olarak basılır.
 */
function kesikDizi(p, ltypes, k) {
  if (!p.lt) return null;
  const lt = ltypes[p.lt];
  if (!lt) return null;
  const c = (p.lts || 1);
  const toplam = lt.len * c * k;
  if (!(toplam > 1.1)) return null;                    // ≈ 0,4 mm
  const arr = [];
  let bekleTire = true;
  for (const el of lt.pat) {
    const boy = Math.abs(el) * c * k;
    const tire = el > 0, nokta = el === 0;
    if (nokta) { if (!bekleTire) arr.push(0); arr.push(0.35); bekleTire = false; continue; }
    if (tire !== bekleTire) arr.push(0);
    arr.push(boy);
    bekleTire = !tire;
  }
  if (arr.length % 2) arr.push(0);
  return arr.length ? arr : null;
}

const HATCH_ET = { HATCH: 1, SOLID: 1, TRACE: 1 };
const DIM_ET = { DIMENSION: 1, ARC_DIMENSION: 1, LARGE_RADIAL_DIMENSION: 1 };

/** render.passFilters'ın kâğıt karşılığı (aynı kurallar; 3B üçgenleri ve yerleştirme işaretleri dışarıda) */
function suzgec(p, show, hideObj, isoObj) {
  if (p.tri) return false;
  if (hideObj && hideObj.size && hideObj.has(p.key)) return false;
  if (isoObj && !isoObj.has(p.key)) return false;
  const tarama = p.et === 'HATCH' || (p.fill && p.et === 'SOLID');
  switch (p.k) {
    case 1: if (!show.text) return false; if (!show.attrib && (p.et === 'ATTRIB' || p.et === 'ATTDEF')) return false; break;
    case 2: if (!show.point) return false; break;
    case 3: if (!show.image) return false; break;
    case 4: return false;
    default: if (!show.hatch && tarama) return false; break;
  }
  if (!show.dim && (DIM_ET[p.et] === 1 || (p.info != null && p.info.t === 'DIMENSION'))) return false;
  if (!show.block && p.info != null && p.info.t === 'INSERT') return false;
  return true;
}

/**
 * İlkelleri bir sayfanın içerik akışına basar.
 *
 * @param sayfa  belge.sayfaEkle() çıktısı
 * @param belge  pdfBelge() çıktısı
 * @param o      {
 *   prims, bb,                 // basılacak ilkeller ve dünya dikdörtgeni
 *   x, y, w, h,                // kâğıttaki çizim alanı (nokta)
 *   layers, ltypes,            // Map ve sözlük (scene.js ile aynı)
 *   show, hideObj, isoObj,     // görünürlük
 *   ltOn, lwOn, lwDefault,     // çizgi tipi / kalınlık anahtarları
 *   pointStyle, hatchAlpha, hatchBack,
 *   frozen,                    // görünüm penceresinde dondurulmuş katman adları (Set | null)
 *   ltK,                       // çizgi tipi çarpanı (PSLTSCALE)
 *   renkOf,                    // (prim) => renk | null — verilmezse ilkelin kendi rengi
 *   resimJpeg,                 // (prim) => { veri:Uint8Array, w, h } | null
 *   donusum,                   // isteğe bağlı: { don(wx,wy)->[px,py], k, lin:[a,b,c,d] }
 *                              //   kâğıt düzenlerinde görünüm penceresi kendi ölçek ve
 *                              //   dönmesini taşır; öntanımlı dönüşüm bb'den kurulur
 *   kirpma,                    // false verilirse çizim alanı kırpması eklenmez
 * }
 * @returns basılan ilkel sayısı
 */
export function ilkelleriBas(sayfa, belge, o) {
  const A = sayfa.akis;
  const bb = o.bb;
  const k0 = o.w / Math.max(1e-12, bb[2] - bb[0]);
  const k = o.donusum ? o.donusum.k : k0;
  const don = o.donusum ? o.donusum.don : ((wx, wy) => [o.x + (wx - bb[0]) * k0, o.y + (wy - bb[1]) * k0]);
  const lin = o.donusum && o.donusum.lin ? o.donusum.lin : [k0, 0, 0, k0];
  const layers = o.layers, ltypes = o.ltypes || {}, show = o.show;
  const lwK = PT / 100;                               // 1/100 mm → nokta
  const lwVars = o.lwDefault == null ? 25 : o.lwDefault;
  let acikOcg = null, sonRenk = null, sonKalin = null, sonKesik = null, sonSaydam = null;

  const ocgAc = (ad) => {
    if (acikOcg === ad) return;
    if (acikOcg !== null) A.y('EMC');
    const g = belge.ocgAl(ad);
    sayfa.kullanilanOcg.add(ad);
    A.y('/OC /' + g.kaynak + ' BDC');
    acikOcg = ad;
  };
  const renkVer = (c, dolgu) => {
    const [r, g, b] = rgb(c);
    const s = sy(r) + ' ' + sy(g) + ' ' + sy(b);
    const anahtar = (dolgu ? 'f' : 's') + s;
    if (sonRenk === anahtar) return;
    A.y(s + (dolgu ? ' rg' : ' RG'));
    sonRenk = anahtar;
  };
  const kalinVer = (pt) => { const s = sy(pt); if (sonKalin !== s) { A.y(s + ' w'); sonKalin = s; } };
  const kesikVer = (d) => {
    const s = d ? '[' + d.map(sy).join(' ') + '] 0 d' : '[] 0 d';
    if (sonKesik !== s) { A.y(s); sonKesik = s; }
  };
  const saydamVer = (a) => {
    const v = a >= 0.999 ? 1 : a;
    if (sonSaydam === v) return;
    if (v === 1) { const n = belge.gsAl(1); sayfa.kullanilanGs.add('1.00'); A.y('/' + n + ' gs'); }
    else { const n = belge.gsAl(v); sayfa.kullanilanGs.add(v.toFixed(2)); A.y('/' + n + ' gs'); }
    sonSaydam = v;
  };

  /** ops dizisini PDF yol işleçlerine çevirir; son noktayı döndürür */
  function yolYaz(ops) {
    let cx = null, cy = null;
    const P = (wx, wy) => { const q = don(wx, wy); return sy(q[0]) + ' ' + sy(q[1]); };
    const git = (wx, wy) => { A.y(P(wx, wy) + ' l'); cx = wx; cy = wy; };
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op[0] === 0) { A.y(P(op[1], op[2]) + ' m'); cx = op[1]; cy = op[2]; continue; }
      if (op[0] === 1) { if (cx === null) { A.y(P(op[1], op[2]) + ' m'); cx = op[1]; cy = op[2]; } else git(op[1], op[2]); continue; }
      let ccx, ccy, rx, ry, rot, a0, a1, ileri;
      if (op[0] === 2 || op[0] === -2) { ccx = op[1]; ccy = op[2]; rx = ry = op[3]; rot = 0; a0 = op[4]; a1 = op[5]; ileri = op[0] === 2; }
      else { ccx = op[1]; ccy = op[2]; rx = op[3]; ry = op[4]; rot = op[5]; a0 = op[6]; a1 = op[7]; ileri = true; }
      let d = a1 - a0;
      if (ileri) { while (d <= 0) d += TAU; } else { while (d >= 0) d -= TAU; }
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const bx = ccx + rx * Math.cos(a0) * cs - ry * Math.sin(a0) * sn;
      const by = ccy + rx * Math.cos(a0) * sn + ry * Math.sin(a0) * cs;
      if (cx === null) { A.y(P(bx, by) + ' m'); }
      else if (Math.abs(bx - cx) > 1e-9 || Math.abs(by - cy) > 1e-9) { A.y(P(bx, by) + ' l'); }
      yayBez(ccx, ccy, rx, ry, rot, a0, d, (x1, y1, x2, y2, x3, y3) => {
        A.y(P(x1, y1) + ' ' + P(x2, y2) + ' ' + P(x3, y3) + ' c');
        cx = x3; cy = y3;
      });
    }
    return cx !== null;
  }

  /** k:1 yazı ilkeli → gerçek PDF yazısı */
  function yaziYaz(p, col) {
    const satirlar = p.lines && p.lines.length ? p.lines : (p.text ? [p.text] : null);
    if (!satirlar) return;
    belge.yaziKullanildi();
    const s = p.h / 10;
    const sx = s * (p.ws || 1) * (p.mx ? -1 : 1);
    const sy2 = -s * (p.my ? -1 : 1);
    const sk = p.obl ? Math.tan(-p.obl) : 0;
    const cs = Math.cos(p.rot || 0), sn = Math.sin(p.rot || 0);
    // yerel (yazı) uzayından dünyaya doğrusal bölüm; PDF'in y'si yukarı olduğu için v sütunu terslenir
    const a = cs * sx, b = sn * sx;
    const c = -(cs * (sx * sk) - sn * sy2), d = -(sn * (sx * sk) + cs * sy2);
    const lh = 16.67 * (p.spacing || 1);
    const n = satirlar.length;
    const y0 = p.va === 3 ? 0 : p.va === 2 ? -((n - 1) * lh) / 2 : -(n - 1) * lh;
    const bl = p.va === 3 ? ASC * 10 : p.va === 2 ? ((ASC - DESC) / 2) * 10 : 0;
    renkVer(col, true);
    A.y('BT /F1 10 Tf');
    for (let i = 0; i < n; i++) {
      const metin = satirlar[i];
      if (!metin) continue;
      const genis = belge.metinW(metin) * 10;
      const uoff = p.ha === 1 ? -genis / 2 : p.ha === 2 ? -genis : 0;
      const v = y0 + i * lh + bl;
      // yerel (uoff, v) → dünya
      const lx = sx * (uoff + v * sk), ly = sy2 * v;
      const wx = p.x + cs * lx - sn * ly, wy = p.y + sn * lx + cs * ly;
      // yerel yön vektörleri kâğıt dönüşümünün DOĞRUSAL bölümünden geçer (görünüm penceresi döndürülmüş olabilir)
      const q = don(wx, wy);
      A.y([sy(lin[0] * a + lin[2] * b), sy(lin[1] * a + lin[3] * b),
        sy(lin[0] * c + lin[2] * d), sy(lin[1] * c + lin[3] * d), sy(q[0]), sy(q[1])].join(' ') + ' Tm');
      A.y(belge.metinHex(metin) + ' Tj');
    }
    A.y('ET');
    sonRenk = null;                                   // BT/ET renk durumunu bulandırmasın
  }

  /* ---- ilkel sırası: dolgular önce (ekranla aynı kural) ---- */
  let seq = o.prims;
  if (o.hatchBack !== false) {
    const a = [], b = [];
    for (const p of seq) ((p.k === 0 && p.fill && !p.bg && HATCH_ET[p.et] === 1) ? a : b).push(p);
    if (a.length) seq = a.concat(b);
  }

  A.y('q');
  if (o.kirpma !== false) A.y(sy(o.x) + ' ' + sy(o.y) + ' ' + sy(o.w) + ' ' + sy(o.h) + ' re W n');
  A.y('0 J 1 j');                                     // düz uç + yuvarlak köşe: render.js ile aynı (lineCap 'butt')
  let sayi = 0;
  for (const p of seq) {
    const b2 = p.bb;
    if (b2 && (b2[2] < bb[0] || b2[0] > bb[2] || b2[3] < bb[1] || b2[1] > bb[3])) continue;
    if (p.k === 4) continue;
    const L = layers.get(p.lay);
    if (L && !L.visible) continue;
    if (o.plotFlag !== false && L && L.plot === false) continue;   // AutoCAD "Plot" sütunu: ekranda var, kâğıtta yok
    if (o.frozen && o.frozen.has(p.lay)) continue;
    if (!suzgec(p, show, o.hideObj, o.isoObj)) continue;
    const col = p.bg ? 0xffffff : (o.renkOf ? o.renkOf(p) : p.col);
    ocgAc(p.lay || '0');
    sayi++;
    if (p.k === 0) {
      if (p.hpFill != null) continue;                 // seyrek desen: kâğıtta desen çizgileri basılır, dolgu değil
      if (p.fill) {
        const alfa = (p.alpha == null ? 1 : p.alpha) * (HATCH_ET[p.et] === 1 && !p.bg ? (o.hatchAlpha == null ? 1 : o.hatchAlpha) : 1);
        saydamVer(alfa);
        renkVer(col, true);
        if (yolYaz(p.ops)) A.y('f*');
        continue;
      }
      saydamVer(1);
      renkVer(col, false);
      let wpt = (p.w || 0) * k;
      if (!(wpt > 0)) wpt = o.lwOn === false ? 0 : (p.lw != null && p.lw >= 0 ? p.lw : lwVars) * lwK;
      kalinVer(wpt);
      kesikVer(o.ltOn === false ? null : kesikDizi(p, ltypes, k * (o.ltK || 1)));
      if (yolYaz(p.ops)) A.y(p.closed ? 'h S' : 'S');
    } else if (p.k === 5) {
      const seg = p.seg;
      if (!seg || !seg.length) { sayi--; continue; }
      saydamVer(1); renkVer(col, false); kesikVer(null);
      let wpt = (p.w || 0) * k;
      if (!(wpt > 0)) wpt = o.lwOn === false ? 0 : (p.lw != null && p.lw >= 0 ? p.lw : lwVars) * lwK;
      kalinVer(wpt);
      for (let i = 0; i + 5 < seg.length; i += 6) {
        const q0 = don(seg[i], seg[i + 1]), q1 = don(seg[i + 3], seg[i + 4]);
        A.y(sy(q0[0]) + ' ' + sy(q0[1]) + ' m ' + sy(q1[0]) + ' ' + sy(q1[1]) + ' l');
      }
      A.y('S');
    } else if (p.k === 1) {
      saydamVer(1);
      yaziYaz(p, col);
    } else if (p.k === 2) {
      saydamVer(1); renkVer(col, false); renkVer(col, true); kesikVer(null); kalinVer(0.4);
      const qp = don(p.x, p.y), px = qp[0], py = qp[1], r = 0.9 * PT;
      const st = o.pointStyle || 'plus';
      if (st === 'x') A.y([sy(px - r), sy(py - r), 'm', sy(px + r), sy(py + r), 'l', sy(px + r), sy(py - r), 'm', sy(px - r), sy(py + r), 'l S'].join(' '));
      else if (st === 'o') { cember(A, px, py, r); A.y('S'); }
      else if (st === 'dot') { cember(A, px, py, r * 0.6); A.y('f'); }
      else A.y([sy(px - r), sy(py), 'm', sy(px + r), sy(py), 'l', sy(px), sy(py - r), 'm', sy(px), sy(py + r), 'l S'].join(' '));
    } else if (p.k === 3) {
      const im = o.resimJpeg ? o.resimJpeg(p) : null;
      if (!im) { sayi--; continue; }
      const r = belge.resimAl(p.img, im.veri, im.w, im.h);
      sayfa.kullanilanRes.add(p.img);
      const q = p.quad;
      const q0 = don(q[0][0], q[0][1]), q1 = don(q[1][0], q[1][1]), q3 = don(q[3][0], q[3][1]);
      saydamVer(1);
      A.y('q ' + [sy(q1[0] - q0[0]), sy(q1[1] - q0[1]), sy(q3[0] - q0[0]), sy(q3[1] - q0[1]), sy(q0[0]), sy(q0[1])].join(' ') + ' cm /' + r.ad + ' Do Q');
      sonRenk = sonKalin = sonKesik = null;
    }
  }
  if (acikOcg !== null) { A.y('EMC'); acikOcg = null; }
  A.y('Q');
  return sayi;
}

/** Çember (dört Bézier parçası) */
function cember(A, cx, cy, r) {
  const c = 0.5523 * r;
  A.y(sy(cx + r) + ' ' + sy(cy) + ' m');
  A.y([sy(cx + r), sy(cy + c), sy(cx + c), sy(cy + r), sy(cx), sy(cy + r)].join(' ') + ' c');
  A.y([sy(cx - c), sy(cy + r), sy(cx - r), sy(cy + c), sy(cx - r), sy(cy)].join(' ') + ' c');
  A.y([sy(cx - r), sy(cy - c), sy(cx - c), sy(cy - r), sy(cx), sy(cy - r)].join(' ') + ' c');
  A.y([sy(cx + c), sy(cy - r), sy(cx + r), sy(cy - c), sy(cx + r), sy(cy)].join(' ') + ' c');
}

/* ---- kâğıt üstü çizim yardımcıları (çerçeve, künye, kuzey oku, ölçek çubuğu) -------- */
export const kagit = {
  dikdortgen(sayfa, x, y, w, h, { doldur = false, kalin = 0.5, renk = 0 } = {}) {
    const A = sayfa.akis, [r, g, b] = rgb(renk);
    A.y('q ' + sy(r) + ' ' + sy(g) + ' ' + sy(b) + (doldur ? ' rg' : ' RG'));
    if (!doldur) A.y(sy(kalin) + ' w [] 0 d');
    A.y([sy(x), sy(y), sy(w), sy(h)].join(' ') + ' re ' + (doldur ? 'f' : 'S') + ' Q');
  },
  cizgi(sayfa, x0, y0, x1, y1, { kalin = 0.5, renk = 0 } = {}) {
    const A = sayfa.akis, [r, g, b] = rgb(renk);
    A.y('q ' + sy(r) + ' ' + sy(g) + ' ' + sy(b) + ' RG ' + sy(kalin) + ' w [] 0 d '
      + sy(x0) + ' ' + sy(y0) + ' m ' + sy(x1) + ' ' + sy(y1) + ' l S Q');
  },
  /** hiza: 0 sol · 1 orta · 2 sağ; taban çizgisi y'dedir */
  yazi(sayfa, belge, x, y, boyut, metin, { hiza = 0, renk = 0 } = {}) {
    if (metin == null || metin === '') return;
    belge.yaziKullanildi();
    const A = sayfa.akis, [r, g, b] = rgb(renk);
    const w = belge.metinW(String(metin)) * boyut;
    const x0 = hiza === 1 ? x - w / 2 : hiza === 2 ? x - w : x;
    A.y('q BT ' + sy(r) + ' ' + sy(g) + ' ' + sy(b) + ' rg /F1 ' + sy(boyut) + ' Tf '
      + sy(x0) + ' ' + sy(y) + ' Td ' + belge.metinHex(String(metin)) + ' Tj ET Q');
  },
  /** metnin kâğıttaki genişliği (nokta) */
  yaziGenislik(belge, metin, boyut) { return belge.metinW(String(metin)) * boyut; },
  /** dolu üçgen ok (kuzey işareti) */
  kuzey(sayfa, belge, cx, cy, r, harf = 'K') {   // harf: arayüz dilinde kuzeyin baş harfi (K, N, С …)
    const A = sayfa.akis;
    A.y('q 0 0 0 rg ' + sy(cx) + ' ' + sy(cy + r) + ' m ' + sy(cx + r * 0.5) + ' ' + sy(cy - r * 0.8) + ' l '
      + sy(cx) + ' ' + sy(cy - r * 0.4) + ' l ' + sy(cx - r * 0.5) + ' ' + sy(cy - r * 0.8) + ' l h f Q');
    kagit.yazi(sayfa, belge, cx, cy + r * 1.25, r * 0.85, harf, { hiza: 1 });
  },
};
