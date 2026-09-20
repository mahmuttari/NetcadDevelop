/*
 * dgn.js — MicroStation DGN (Intergraph Standard File Format, ISFF) okuyucu.
 *
 * Dosya, DXF ve DWG yollarıyla AYNI "DwgDatabase" nesnesini üretir (bkz. dxf.js:73-77);
 * böylece SceneBuilder, düzenleyici, DXF yazıcısı ve bütün araçlar DGN'i başka hiçbir
 * yerde tanımak zorunda kalmadan çalışır.
 *
 * BİÇİM. DGN'in iki kuşağı vardır ve ikisinin ortak yanı yalnız uzantıdır:
 *
 *   V7 (MicroStation 95 / SE / J, ISFF)  Kabuğu yoktur: dosya baştan sona "eleman"
 *       dizisidir. Her eleman 4 baytlık bir başlıkla başlar, başlıktaki söz sayısı
 *       elemanın boyunu verir, 0xFFFF dosya sonunu işaretler. Bu kuşak açık olarak
 *       belgelenmiştir ve burada TAM olarak okunur.
 *
 *   V8 (MicroStation V8 / XM / CONNECT)  Bir OLE bileşik dosyasıdır (CFB); model verisi
 *       iç depolardaki akışlarda, açık olmayan bir kodlamayla durur. Açık bir belirtimi
 *       yoktur — GDAL'in DGNv8 sürücüsü bile kapalı kaynak ODA/Teigha kitaplığına
 *       dayanır. Burada TANINIR ve kullanıcıya "V8'i MicroStation'dan V7 olarak ya da
 *       DWG/DXF olarak dışa aktarın" diyen açık bir ileti verilir; sessizce boş çizim
 *       açılmaz.
 *
 * SAYI KURULUŞU. DGN'in 32 bitlik tamsayısı ne küçük ne büyük uçludur: YÜKSEK SÖZ ÖNCE
 * yazılır, her sözün kendi içi küçük uçludur (b2 b3 b0 b1). 64 bitlik gerçel sayılar ise
 * VAX/Intergraph F biçimindedir, IEEE 754 değildir; `vaxCift` onları çevirir. İkisi de
 * GDAL'in dgnlib'i (MIT) ile satır satır karşılaştırılarak doğrulanmıştır.
 *
 * KOORDİNAT. Elemanlarda koordinat "UOR" (unit of resolution) tamsayısıdır; ana birime
 * TCB'deki iki çarpanla inilir:  nokta = UOR / (altBirimBasinaUor * anaBirimBasinaAltBirim)
 * eksi küresel başlangıç. `donustur` bunu yapar.
 *
 * RENK. DGN'de renk 0-255 arası bir indistir; karşılığı dosyanın KENDİ renk tablosundadır
 * (tür 5, seviye 1). Tablo varsa her varlığa gerçek renk (`color`) yazılır ve ekranda birebir
 * MicroStation'daki renk çıkar. Tablo yoksa indis olduğu gibi ACI sayılır — renkler ayrışık
 * kalır ama tonları MicroStation'ınkiyle aynı olmayabilir; 0 her zaman ön plan rengidir.
 *
 * BİLEŞİK ELEMANLAR DÜZLEŞTİRİLİR. Hücre (2), yazı düğümü (7), karmaşık zincir (12),
 * karmaşık şekil (14), yüzey (18) ve katı (19) başlıkları kendileri çizilmez; onları
 * izleyen ve "karmaşık" bitini taşıyan üyeler MUTLAK koordinat taşıdığı için doğrudan
 * çizilir. Sonuç aynıdır, kurgu çok daha basittir.
 */

const TAU = Math.PI * 2, D2R = Math.PI / 180;

/* ---- eleman türleri ---------------------------------------------------------------- */
const T_CELL_LIB = 1, T_CELL = 2, T_LINE = 3, T_LINE_STRING = 4, T_GROUP_DATA = 5, T_SHAPE = 6,
  T_TEXT_NODE = 7, T_TCB = 9, T_LEVEL_SYM = 10, T_CURVE = 11, T_CHAIN = 12, T_CSHAPE = 14,
  T_ELLIPSE = 15, T_ARC = 16, T_TEXT = 17, T_SURFACE = 18, T_SOLID = 19, T_BSPLINE_POLE = 21,
  T_POINT_STRING = 22, T_CONE = 23, T_BSPLINE_SURF = 24, T_BSPLINE_BOUND = 25, T_BSPLINE_KNOT = 26,
  T_BSPLINE_CURVE = 27, T_BSPLINE_WEIGHT = 28, T_DIMENSION = 33, T_SHARED_DEFN = 34,
  T_SHARED_ELEM = 35, T_TAG_VALUE = 37, T_APPLICATION = 66;

const TUR_ADI = {
  1: 'CELL_LIBRARY', 2: 'CELL_HEADER', 3: 'LINE', 4: 'LINE_STRING', 5: 'GROUP_DATA', 6: 'SHAPE',
  7: 'TEXT_NODE', 8: 'DIGITIZER_SETUP', 9: 'TCB', 10: 'LEVEL_SYMBOLOGY', 11: 'CURVE',
  12: 'COMPLEX_CHAIN', 14: 'COMPLEX_SHAPE', 15: 'ELLIPSE', 16: 'ARC', 17: 'TEXT',
  18: 'SURFACE', 19: 'SOLID', 21: 'BSPLINE_POLE', 22: 'POINT_STRING', 23: 'CONE',
  24: 'BSPLINE_SURFACE', 25: 'BSPLINE_BOUNDARY', 26: 'BSPLINE_KNOT', 27: 'BSPLINE_CURVE',
  28: 'BSPLINE_WEIGHT', 33: 'DIMENSION', 34: 'SHARED_CELL_DEFN', 35: 'SHARED_CELL',
  37: 'TAG_VALUE', 66: 'APPLICATION_ELEM',
};

/** Kendisi çizilmeyen, üyeleri düzleştirilen başlıklar */
const KAPSAYICI = new Set([T_CELL, T_TEXT_NODE, T_CHAIN, T_CSHAPE, T_SURFACE, T_SOLID]);
/** Üyeleri de çizilmeyen başlıklar: paylaşılan hücre TANIMI dosyanın kendi köşesinde durur
 *  (örneği başka yere yerleşir), B-spline YÜZEYİNİN kutupları ise yüzey değil kontrol ağıdır. */
const ATLANAN_KAPSAYICI = new Set([T_SHARED_DEFN, T_BSPLINE_SURF]);

/** Görüntü başlığı (renk / stil / kalınlık / seviye) taşımayan türler — GDAL DGNElemTypeHasDispHdr */
const BASLIKSIZ = new Set([0, T_TCB, T_CELL_LIB, T_LEVEL_SYM, 32, 44, 48, 49, 50, 51, 57, 60, 61, 62, 63]);

const DGNPF_ATTRIBUTES = 0x0800;
const DGNLT_SHAPE_FILL = 0x0041;

/* ---- ikili okuyucular -------------------------------------------------------------- */
/** DGN 32 bit tamsayı: yüksek söz önce, her söz küçük uçlu (dgnlibp.h DGN_INT32) */
const i32 = (b, o) => ((b[o + 2] | (b[o + 3] << 8) | (b[o] << 16) | (b[o + 1] << 24)) | 0);
const u16 = (b, o) => (b[o] | (b[o + 1] << 8));
const i16 = (b, o) => (((b[o] | (b[o + 1] << 8)) << 16) >> 16);

const _tmp = new DataView(new ArrayBuffer(8));
/**
 * VAX/Intergraph F_floating (64 bit) → IEEE 754 double. GDAL CPLVaxToIEEEDouble ile birebir:
 * sözler yer değiştirir, üs 129 tabanından 1023 tabanına taşınır, mantis üç bit sağa kayar.
 */
function vaxCift(b, o) {
  const hi0 = ((b[o + 2] | (b[o + 3] << 8) | (b[o] << 16) | (b[o + 1] << 24)) >>> 0);
  const lo0 = ((b[o + 6] | (b[o + 7] << 8) | (b[o + 4] << 16) | (b[o + 5] << 24)) >>> 0);
  const isaret = hi0 & 0x80000000;
  let us = (hi0 >>> 23) & 0xff;
  if (us) us = us - 129 + 1023;
  const yuvarla = lo0 & 7;
  let lo = (((lo0 >>> 3) & 0x1fffffff) | (hi0 << 29)) >>> 0;
  if (yuvarla) lo = (lo | 1) >>> 0;
  const hi = (((hi0 >>> 3) & 0x000fffff) | (us << 20) | isaret) >>> 0;
  _tmp.setUint32(0, lo, true); _tmp.setUint32(4, hi, true);
  return _tmp.getFloat64(0, true);
}

/* ---- biçim tanıma ------------------------------------------------------------------ */
const CFB_IMZA = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** 'v7' · 'v8' · null — bayta bakar, dosya adına değil */
export function dgnKind(u8) {
  if (!u8 || u8.length < 8) return null;
  let cfb = true;
  for (let i = 0; i < 8; i++) if (u8[i] !== CFB_IMZA[i]) { cfb = false; break; }
  if (cfb) return dgnV8mi(u8) ? 'v8' : null;
  // ISFF: ilk eleman TCB'dir (tür 9) — 2B'de 0x08, 3B'de 0xC8; hücre kitaplığında 08 05 17 00
  if (u8[0] === 0x08 && u8[1] === 0x05 && u8[2] === 0x17 && u8[3] === 0x00) return 'v7';
  if ((u8[0] === 0x08 || u8[0] === 0xc8) && u8[1] === 0x09 && u8[2] === 0xfe && u8[3] === 0x02) return 'v7';
  return null;
}

export function isDgn(u8) { return dgnKind(u8) !== null; }

/**
 * CFB kabuğunun içinde DGN var mı? Kök dizin girdi adlarında "Dgn~" öneki aranır
 * (V8 dosyalarında Dgn~H başlık akışı her zaman köktedir). cfb.js çözümleyicisi burada
 * KULLANILMAZ: yalnız tanıma için dizin sektörünü ham tarıyoruz, böylece dgn.js'in
 * V8 dalı hiçbir modüle bağlı olmadan çalışır ve bozuk dosyada da ileti verebilir.
 */
function dgnV8mi(u8) {
  // "Dgn~" UTF-16LE: 44 00 67 00 6e 00 7e 00
  const im = [0x44, 0x00, 0x67, 0x00, 0x6e, 0x00, 0x7e, 0x00];
  const son = Math.min(u8.length, 8 << 20) - im.length;   // dizin sektörü kuyrukta olabilir; 8 MB pratikte fazlasıyla yeter
  for (let i = 0; i <= son; i++) {
    if (u8[i] !== 0x44) continue;                          // ucuz ön eleme: 'D'
    let ok = true;
    for (let k = 1; k < im.length; k++) if (u8[i + k] !== im[k]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

/* ---- yardımcılar ------------------------------------------------------------------- */
/** DWG kalınlık kodu tablosu (1/100 mm) — scene.js LW_TABLE ile aynı */
const LW_TABLE = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
/**
 * DGN kalem kalınlığı (0-31) → DWG kalınlık kodu. DGN'de kalınlık birimsiz bir kalem
 * numarasıdır; yaygın dönüştürücü kabulü adım başına 0,10 mm'dir. Bulunan mm değerine
 * EN YAKIN tablo indisi yazılır (tabloda olmayan bir değer yazılırsa lwOf onu 1/100 mm
 * sanıp 0-23 aralığında yanlış yorumlar).
 */
function kalinlikKodu(w) {
  const hedef = Math.max(0, Math.min(31, w | 0)) * 10;
  let en = 0, fark = Infinity;
  for (let i = 0; i < LW_TABLE.length; i++) { const d = Math.abs(LW_TABLE[i] - hedef); if (d < fark) { fark = d; en = i; } }
  return en;
}

/**
 * DGN çizgi stili (0-7) → çizgi tipi adı. 0 süreklidir; 1-7 MicroStation'ın sabit
 * "line code"larıdır. Bunlar EKRAN desenidir, model uzayında bir uzunlukları yoktur;
 * bu yüzden desen adımı çizimin kendi büyüklüğünden türetilir (bkz. cizgiTipleri).
 */
const STIL_ADI = ['Continuous', 'DGN 1', 'DGN 2', 'DGN 3', 'DGN 4', 'DGN 5', 'DGN 6', 'DGN 7'];
/** Adım (b) cinsinden desen: pozitif çizgi, negatif boşluk, 0 nokta */
const STIL_DESEN = [
  null,
  [0, -2],                       // 1 noktalı
  [3, -3],                       // 2 orta kesikli
  [6, -3],                       // 3 uzun kesikli
  [6, -2, 0, -2],                // 4 nokta-çizgi
  [1.5, -1.5],                   // 5 kısa kesikli
  [6, -2, 0, -2, 0, -2],         // 6 çizgi-çift nokta
  [9, -2, 3, -2],                // 7 uzun kesik-kısa kesik
];

/** DGN yazı hizalaması (0-14) → DXF halign / valign ikilisi */
function hizalama(j) {
  const k = (j | 0) < 0 || (j | 0) > 14 ? 0 : (j | 0);
  const yatay = k <= 5 ? 0 : k <= 8 ? 1 : 2;              // sol · orta · sağ
  const dusey = [3, 2, 1][k % 3];                          // üst · orta · alt
  return { halign: yatay, valign: dusey };
}

let _cozucu = null, _cozucuKuruldu = false;
function metinCoz(u8, kodlama) {
  if (!_cozucuKuruldu) {
    _cozucuKuruldu = true;
    try { _cozucu = new TextDecoder(kodlama || 'windows-1254'); }
    catch (_) { try { _cozucu = new TextDecoder('latin1'); } catch (__) { _cozucu = null; } }
  }
  let s = _cozucu ? _cozucu.decode(u8) : String.fromCharCode(...u8);
  s = s.replace(/\0/g, '').replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return s;
}

/* ---- eleman gezgini ---------------------------------------------------------------- */
/**
 * Dosyayı baştan sona eleman eleman gezer. Her eleman: 4 bayt başlık + söz sayısı × 2 bayt.
 * 0xFFFF dosya sonu işaretidir. Bozuk bir boy okunursa gezinti durur (tahmin yürütülmez).
 */
function* elemanlar(u8) {
  let p = 0;
  const n = u8.length;
  while (p + 4 <= n) {
    if (u8[p] === 0xff && u8[p + 1] === 0xff) break;
    if (u8[p] === 0 && u8[p + 1] === 0 && u8[p + 2] === 0 && u8[p + 3] === 0) break;   // sıfır dolgusu: dosya bitti
    const boy = (u16(u8, p + 2) * 2) + 4;
    if (boy < 4 || p + boy > n) break;
    yield { p, boy };
    p += boy;
  }
}

/** Çekirdek başlık: seviye, tür, silinmişlik, renk, stil, kalınlık, öznitelik alanı */
function cekirdek(b) {
  const tur = b[1] & 0x7f;
  const e = {
    b, n: b.length,
    seviye: b[0] & 0x3f,
    karmasik: !!(b[0] & 0x80),
    silinmis: !!(b[1] & 0x80),
    tur,
    renk: 0, stil: 0, agirlik: 0, ozellik: 0, ozn: null,
  };
  if (b.length >= 36 && !BASLIKSIZ.has(tur)) {
    e.ozellik = u16(b, 32);
    e.stil = b[34] & 0x7;
    e.agirlik = (b[34] & 0xf8) >> 3;
    e.renk = b[35];
    if (e.ozellik & DGNPF_ATTRIBUTES) {
      const bas = u16(b, 30) * 2 + 32;
      const say = b.length - bas;
      if (say > 0 && bas >= 32 && bas + say <= b.length) e.ozn = b.subarray(bas, bas + say);
    }
  }
  return e;
}

/** Öznitelik bağlantılarını (linkage) sırayla verir */
function* baglantilar(ozn) {
  if (!ozn) return;
  let o = 0, guvenlik = 0;
  while (o + 4 <= ozn.length && guvenlik++ < 4096) {
    const dmrs = ozn[o] === 0 && (ozn[o + 1] === 0 || ozn[o + 1] === 0x80);
    let boy;
    if (dmrs) boy = 8;
    else if (ozn[o + 1] & 0x10) boy = ozn[o] * 2 + 2;
    else break;
    if (boy <= 4 || o + boy > ozn.length) break;
    yield { tur: dmrs ? 0 : u16(ozn, o + 2), veri: ozn.subarray(o, o + boy) };
    o += boy;
  }
}

/** Dolgu rengi bağlantısı (0x0041) varsa renk indisi, yoksa -1 */
function dolguRengi(ozn) {
  for (const l of baglantilar(ozn)) if (l.tur === DGNLT_SHAPE_FILL && l.veri.length >= 9) return l.veri[8];
  return -1;
}

/* ---- ana çözümleyici --------------------------------------------------------------- */
/**
 * @param bytes Uint8Array ya da ArrayBuffer
 * @param opts { onProgress(oran 0..1), kodlama }
 * @returns DwgDatabase (dxf.js/parseDxf ile aynı biçim)
 */
export function parseDgn(bytes, opts = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const kind = dgnKind(u8);
  if (kind === 'v8') {
    throw new Error('Bu bir MicroStation V8 DGN dosyası (OLE kabuklu). V8 biçiminin açık bir '
      + 'belirtimi yoktur; MicroStation\'da "Save As › MicroStation V7" ya da DWG/DXF olarak '
      + 'dışa aktarıp yeniden deneyin.');
  }
  if (kind !== 'v7') throw new Error('Bu bir DGN dosyası değil.');
  _cozucu = null; _cozucuKuruldu = false;
  const kodlama = opts.kodlama || 'windows-1254';
  const bildir = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const db = {
    header: { ACADVER: 'DGN V7', LTSCALE: 1 },
    tables: { LAYER: { entries: [] }, LTYPE: { entries: [] }, STYLE: { entries: [] }, DIMSTYLE: { entries: [] }, BLOCK_RECORD: { entries: [] }, APPID: { entries: [] }, VPORT: { entries: [] } },
    objects: { LAYOUT: [], IMAGEDEF: [], DICTIONARY: [] },
    entities: [], classes: [],
  };

  /* --- ölçek ve küresel başlangıç (TCB gelene kadar birim ölçek) --- */
  let boyut = u8[0] === 0xc8 ? 3 : 2;
  let olcek = 1, ox = 0, oy = 0, oz = 0;
  let anaBirim = '', altBirim = '';
  const donX = (v) => v * olcek - ox, donY = (v) => v * olcek - oy, donZ = (v) => v * olcek - oz;

  /* --- renk tablosu --- */
  let renkTablosu = null;   // Uint8Array(768) — varsa gerçek renk buradan

  /* --- toplananlar --- */
  const seviyeler = new Set();
  const stiller = new Set();
  const census = {};
  const desteksiz = {};
  let sayac = 0;
  const yeniH = () => (++sayac).toString(16).toUpperCase();
  const MS = 'MS';

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const genislet = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };

  const ents = db.entities;

  /** Her varlığın ortak künyesi — dxf.js readEntity ile aynı alanlar */
  function ortak(e, renkGecersiz) {
    const ci = renkGecersiz == null ? e.renk : renkGecersiz;
    const o = {
      handle: yeniH(), layer: 'Level ' + e.seviye, colorIndex: ci === 0 ? 7 : (ci >= 1 && ci <= 255 ? ci : 7),
      lineType: STIL_ADI[e.stil] || 'Continuous', lineweight: kalinlikKodu(e.agirlik), lineTypeScale: 1,
      isVisible: true, xdata: [], ownerBlockRecordSoftId: MS, isInPaperSpace: false,
    };
    if (renkTablosu && ci >= 0 && ci <= 255) o.color = (renkTablosu[ci * 3] << 16) | (renkTablosu[ci * 3 + 1] << 8) | renkTablosu[ci * 3 + 2];
    seviyeler.add(e.seviye);
    if (e.stil >= 1 && e.stil <= 7) stiller.add(e.stil);
    return o;
  }

  /* --- eleman okuyucuları --- */

  /** LINE (3): iki köşe */
  function okuCizgi(e) {
    const b = e.b, ps = boyut * 4;
    if (e.n < 36 + ps * 2) return null;
    const a = { x: donX(i32(b, 36)), y: donY(i32(b, 40)), z: boyut === 3 ? donZ(i32(b, 44)) : 0 };
    const c = boyut === 3
      ? { x: donX(i32(b, 48)), y: donY(i32(b, 52)), z: donZ(i32(b, 56)) }
      : { x: donX(i32(b, 44)), y: donY(i32(b, 48)), z: 0 };
    return [a, c];
  }

  /** LINE_STRING (4) / SHAPE (6) / CURVE (11) / BSPLINE_POLE (21): köşe dizisi */
  function okuKoseler(e) {
    const b = e.b, ps = boyut * 4;
    if (e.n < 38 + ps) return null;
    let say = u16(b, 36);
    if (say < 1) return null;
    // "delta" bağlantısı (0xA9 0x51): köşelere UOR altı kesir ekler
    let dBas = 0;
    if (e.ozn) {
      for (let i = 0; i + 3 < e.ozn.length; i++) {
        if (e.ozn[i] === 0xa9 && e.ozn[i + 1] === 0x51) { if (u16(e.ozn, i + 2) * 2 > 0) dBas = i + 6; break; }
      }
    }
    const v = [];
    const sonAlan = boyut === 3 ? 46 : 42;
    for (let i = 0; i < say && sonAlan + i * ps + 4 <= e.n; i++) {
      let x = i32(b, 38 + i * ps), y = i32(b, 42 + i * ps);
      if (dBas && dBas + i * 4 + 4 <= e.ozn.length) { x += i16(e.ozn, dBas + i * 4) / 32767; y += i16(e.ozn, dBas + i * 4 + 2) / 32767; }
      v.push({ x: donX(x), y: donY(y), z: boyut === 3 ? donZ(i32(b, 46 + i * ps)) : 0 });
    }
    return v.length ? v : null;
  }

  /** ELLIPSE (15) / ARC (16): merkez, iki yarıçap, dönme, başlangıç açısı ve süpürme (derece) */
  function okuYay(e) {
    const b = e.b, yay = e.tur === T_ARC;
    const enAz = yay ? (boyut === 3 ? 100 : 80) : (boyut === 3 ? 92 : 72);
    if (e.n < enAz) return null;
    let bas = 0, sup = 360;
    let o = 36;
    if (yay) {
      bas = i32(b, 36) / 360000;
      let s;
      if (b[41] & 0x80) s = -sozluTam(b, 40); else s = sozluTam(b, 40);
      sup = s === 0 ? 360 : s / 360000;
      o = 44;
    }
    const birincil = vaxCift(b, o) * olcek;
    const ikincil = vaxCift(b, o + 8) * olcek;
    let don = 0, cx = 0, cy = 0, cz = 0;
    if (boyut === 2) {
      don = i32(b, o + 16) / 360000;
      cx = vaxCift(b, o + 20); cy = vaxCift(b, o + 28);
    } else {
      // 3B'de yönelim dört elemanlı (quaternion) tutulur; düzlem dışı yönelim uygulanmaz
      cx = vaxCift(b, o + 32); cy = vaxCift(b, o + 40); cz = vaxCift(b, o + 48);
    }
    return { birincil: Math.abs(birincil), ikincil: Math.abs(ikincil), don, bas, sup,
      cx: donX(cx), cy: donY(cy), cz: boyut === 3 ? donZ(cz) : 0 };
  }

  /** ARC süpürme alanı: işaret biti temizlenmiş 32 bitlik büyüklük */
  function sozluTam(b, o) {
    return ((b[o + 2] | (b[o + 3] << 8) | (b[o] << 16) | ((b[o + 1] & 0x7f) << 24)) | 0);
  }

  /** TEXT (17) */
  function okuYazi(e) {
    const b = e.b;
    const bas = boyut === 2 ? 60 : 76;
    const sayAlan = boyut === 2 ? 58 : 74;
    if (e.n <= sayAlan) return null;
    const adet = b[sayAlan];
    if (!adet || bas + adet > e.n) return null;
    const boyH = i32(b, 42) * olcek * 6 / 1000;
    const boyW = i32(b, 38) * olcek * 6 / 1000;
    if (!(boyH > 0)) return null;
    let don = 0, x = 0, y = 0, z = 0;
    if (boyut === 2) { don = i32(b, 46) / 360000; x = donX(i32(b, 50)); y = donY(i32(b, 54)); }
    else { x = donX(i32(b, 62)); y = donY(i32(b, 66)); z = donZ(i32(b, 70)); }
    let ham = b.subarray(bas, bas + adet);
    // Kore'nin iki baytlık düzeni (0xFF 0xFD ön eki) — GDAL'deki deneysel dal
    if (ham.length > 2 && ham[0] === 0xff && ham[1] === 0xfd) ham = ham.subarray(2);
    const s = metinCoz(ham, kodlama).replace(/\s+$/, '');
    if (!s) return null;
    const hz = hizalama(b[37]);
    return { s, boyH, boyW, don, x, y, z, halign: hz.halign, valign: hz.valign };
  }

  /* --- eleman çevirileri --- */

  function ekleNokta(e, p) {
    ents.push({ ...ortak(e), type: 'POINT', position: p, thickness: 0 });
    genislet(p.x, p.y);
  }

  function ekleCokgen(e, v, kapali) {
    for (const p of v) genislet(p.x, p.y);
    const z0 = v[0].z || 0;
    const duz = v.every(p => Math.abs((p.z || 0) - z0) < 1e-9);
    if (duz) {
      ents.push({ ...ortak(e), type: 'LWPOLYLINE', vertices: v.map(p => ({ x: p.x, y: p.y, bulge: 0, startWidth: 0, endWidth: 0 })),
        flag: kapali ? 512 : 0, elevation: z0, constantWidth: 0 });
    } else {
      ents.push({ ...ortak(e), type: 'POLYLINE3D', vertices: v.map(p => ({ x: p.x, y: p.y, z: p.z || 0, flag: 32 })), flag: kapali ? 1 : 0 });
    }
  }

  /** Dolgu bağlantısı taşıyan kapalı şekil: önce dolgu (tarama), sonra kontur */
  function ekleDolgu(e, v) {
    const dc = dolguRengi(e.ozn);
    if (dc < 0 || v.length < 3) return;
    const t = { ...ortak(e, dc), type: 'HATCH', patternName: 'SOLID', solidFill: 1, patternType: 1,
      patternScale: 1, patternAngle: 0, hatchStyle: 0, elevation: v[0].z || 0,
      boundaryPaths: [{ vertices: v.map(p => ({ x: p.x, y: p.y, bulge: 0 })), isClosed: true, boundaryPathTypeFlag: 3, hasBulge: false }] };
    ents.push(t);
  }

  function ekleYay(e, y) {
    const daire = Math.abs(y.birincil - y.ikincil) <= Math.max(1e-9, y.birincil * 1e-9);
    const tam = Math.abs(Math.abs(y.sup) - 360) < 1e-6;
    genislet(y.cx - y.birincil, y.cy - y.birincil); genislet(y.cx + y.birincil, y.cy + y.birincil);
    if (daire && tam) {
      ents.push({ ...ortak(e), type: 'CIRCLE', center: { x: y.cx, y: y.cy, z: y.cz }, radius: y.birincil, thickness: 0 });
      return;
    }
    // ekranda saat yönünün tersine gidilir: negatif süpürmede uçlar yer değiştirir
    const a0 = (y.sup >= 0 ? y.bas : y.bas + y.sup) * D2R;
    const a1 = (y.sup >= 0 ? y.bas + y.sup : y.bas) * D2R;
    if (daire) {
      const r = y.don * D2R;
      ents.push({ ...ortak(e), type: 'ARC', center: { x: y.cx, y: y.cy, z: y.cz }, radius: y.birincil,
        startAngle: a0 + r, endAngle: a1 + r, thickness: 0 });
      return;
    }
    const cs = Math.cos(y.don * D2R), sn = Math.sin(y.don * D2R);
    ents.push({ ...ortak(e), type: 'ELLIPSE', center: { x: y.cx, y: y.cy, z: y.cz },
      majorAxisEndPoint: { x: y.birincil * cs, y: y.birincil * sn, z: 0 },
      axisRatio: y.birincil > 0 ? y.ikincil / y.birincil : 1,
      startAngle: tam ? 0 : a0, endAngle: tam ? TAU : a1 });
  }

  function ekleYazi(e, y) {
    genislet(y.x, y.y);
    const p = { x: y.x, y: y.y, z: y.z };
    ents.push({ ...ortak(e), type: 'TEXT', text: y.s, thickness: 0,
      startPoint: p, endPoint: { ...p }, textHeight: y.boyH,
      rotation: y.don * D2R, xScale: y.boyH > 0 ? (y.boyW / y.boyH) || 1 : 1, obliqueAngle: 0,
      styleName: 'STANDARD', generationFlag: 0, halign: y.halign, valign: y.valign });
  }

  /* --- B-spline birikimi --- */
  let bsp = null;
  function bsplineBaslat(e) {
    const b = e.b;
    if (e.n < 46) return;
    bsp = { e, derece: (b[40] & 0x0f) + 1, kapali: !!(b[40] & 0x80), rasyonel: !!(b[40] & 0x40),
      kutupSay: u16(b, 42), dugumSay: u16(b, 44), kutuplar: [], dugumler: [], agirliklar: [] };
  }
  function bsplineKapat() {
    if (!bsp) return;
    const s = bsp; bsp = null;
    if (s.kutuplar.length < 2) return;
    for (const p of s.kutuplar) genislet(p.x, p.y);
    const en = { ...ortak(s.e), type: 'SPLINE', degree: Math.max(1, s.derece), flag: s.kapali ? 1 : 0,
      controlPoints: s.kutuplar, fitPoints: [] };
    if (s.dugumler.length === s.kutuplar.length + s.derece + 1) en.knots = s.dugumler;
    if (s.rasyonel && s.agirliklar.length === s.kutuplar.length) {
      const enb = Math.max(...s.agirliklar);
      if (enb > 0) en.weights = s.agirliklar.map(w => w / enb);
    }
    ents.push(en);
  }
  /** BSPLINE_KNOT (26) / BSPLINE_WEIGHT (28): 2^31-1 ile bölünmüş kesirler dizisi */
  function okuKesirler(e) {
    // GDAL ile aynı hesap: öznitelik alanı eleman sonundan düşülür (özellik biti yazılmamış olsa da)
    const oznBoy = e.n - u16(e.b, 30) * 2 - 32;
    if (oznBoy < 0) return [];
    const adet = Math.floor((e.n - 36 - oznBoy) / 4);
    const a = [];
    for (let i = 0; i < adet && 36 + i * 4 + 4 <= e.n; i++) a.push(i32(e.b, 36 + i * 4) / 2147483647);
    return a;
  }

  /* --- TCB --- */
  function okuTcb(e) {
    const b = e.b;
    if (e.n < 1264) return;
    boyut = (b[1214] & 0x40) ? 3 : 2;
    const altBasina = i32(b, 1112) || 1;      // ana birim başına alt birim
    const uorBasina = i32(b, 1116) || 1;      // alt birim başına UOR
    anaBirim = String.fromCharCode(b[1120], b[1121]).trim();
    altBirim = String.fromCharCode(b[1122], b[1123]).trim();
    let gx = vaxCift(b, 1240), gy = vaxCift(b, 1248), gz = vaxCift(b, 1256);
    if (uorBasina !== 0 && altBasina !== 0) {
      gx /= (uorBasina * altBasina); gy /= (uorBasina * altBasina); gz /= (uorBasina * altBasina);
      olcek = 1 / (uorBasina * altBasina);
    }
    ox = gx; oy = gy; oz = gz;
  }

  /* --- renk tablosu --- */
  function okuRenkTablosu(e) {
    if (e.n < 806) return;
    const t = new Uint8Array(768);
    t[255 * 3] = e.b[38]; t[255 * 3 + 1] = e.b[39]; t[255 * 3 + 2] = e.b[40];
    t.set(e.b.subarray(41, 41 + 765), 0);
    renkTablosu = t;
  }

  /* ================= gezinti ================= */
  let atla = false;          // paylaşılan hücre tanımı / B-spline yüzeyi üyeleri
  let ilerleme = 0;
  const toplam = u8.length || 1;

  for (const { p, boy } of elemanlar(u8)) {
    if (bildir && (++ilerleme % 2000) === 0) bildir(Math.min(1, p / toplam));
    const e = cekirdek(u8.subarray(p, p + boy));
    if (e.silinmis) continue;

    if (!e.karmasik) {
      bsplineKapat();
      atla = ATLANAN_KAPSAYICI.has(e.tur);
      if (e.tur === T_BSPLINE_CURVE) { census.BSPLINE_CURVE = (census.BSPLINE_CURVE || 0) + 1; bsplineBaslat(e); continue; }
      if (KAPSAYICI.has(e.tur)) { census[TUR_ADI[e.tur]] = (census[TUR_ADI[e.tur]] || 0) + 1; continue; }
      if (atla) { census[TUR_ADI[e.tur] || e.tur] = (census[TUR_ADI[e.tur] || e.tur] || 0) + 1; continue; }
    } else {
      if (atla) continue;
      if (bsp) {
        if (e.tur === T_BSPLINE_POLE) { const v = okuKoseler(e); if (v) bsp.kutuplar.push(...v); continue; }
        if (e.tur === T_BSPLINE_KNOT) { bsp.dugumler.push(...okuKesirler(e)); continue; }
        if (e.tur === T_BSPLINE_WEIGHT) { bsp.agirliklar.push(...okuKesirler(e)); continue; }
        bsplineKapat();
      }
      if (KAPSAYICI.has(e.tur)) { census[TUR_ADI[e.tur]] = (census[TUR_ADI[e.tur]] || 0) + 1; continue; }
    }

    const ad = TUR_ADI[e.tur] || ('TYPE_' + e.tur);
    census[ad] = (census[ad] || 0) + 1;

    switch (e.tur) {
      case T_TCB: okuTcb(e); break;
      case T_GROUP_DATA: if (e.seviye === 1) okuRenkTablosu(e); break;
      case T_LINE: {
        const v = okuCizgi(e);
        if (!v) break;
        const [a, c] = v;
        // DGN'de tek nokta sıfır boylu bir çizgi olarak saklanır
        if (Math.abs(a.x - c.x) < 1e-12 && Math.abs(a.y - c.y) < 1e-12 && Math.abs((a.z || 0) - (c.z || 0)) < 1e-12) { ekleNokta(e, a); break; }
        genislet(a.x, a.y); genislet(c.x, c.y);
        ents.push({ ...ortak(e), type: 'LINE', startPoint: a, endPoint: c, thickness: 0 });
        break;
      }
      case T_LINE_STRING: { const v = okuKoseler(e); if (v && v.length >= 2) ekleCokgen(e, v, false); else if (v && v.length === 1) ekleNokta(e, v[0]); break; }
      case T_SHAPE: {
        const v = okuKoseler(e);
        if (!v || v.length < 2) break;
        // DGN kapalı şekli son köşeyi ilkin kopyası olarak yazar; kapalı çokgende bu satır sıfır boyludur
        if (v.length > 2 && Math.abs(v[0].x - v[v.length - 1].x) < 1e-12 && Math.abs(v[0].y - v[v.length - 1].y) < 1e-12) v.pop();
        ekleDolgu(e, v); ekleCokgen(e, v, true);
        break;
      }
      case T_CURVE: {
        const v = okuKoseler(e);
        if (!v || v.length < 2) break;
        for (const q of v) genislet(q.x, q.y);
        // DGN eğrisinin ilk iki ve son iki köşesi teğet denetimidir; eğri aradan geçer
        const fit = v.length >= 6 ? v.slice(2, -2) : v;
        if (fit.length >= 2) ents.push({ ...ortak(e), type: 'SPLINE', degree: 3, flag: 0, controlPoints: [], fitPoints: fit });
        break;
      }
      case T_ELLIPSE: case T_ARC: { const y = okuYay(e); if (y && y.birincil > 0) ekleYay(e, y); break; }
      case T_TEXT: { const y = okuYazi(e); if (y) ekleYazi(e, y); break; }
      case T_POINT_STRING: case T_CONE: case T_DIMENSION: case T_SHARED_ELEM:
      case T_BSPLINE_BOUND: case T_TAG_VALUE: case T_APPLICATION:
        desteksiz[ad] = (desteksiz[ad] || 0) + 1; break;
      default: break;
    }
  }
  bsplineKapat();
  if (bildir) bildir(1);

  /* ================= tablolar ================= */
  for (const s of [...seviyeler].sort((a, b) => a - b)) {
    db.tables.LAYER.entries.push({ name: 'Level ' + s, handle: 'L' + s, colorIndex: 7, color: undefined,
      lineType: 'Continuous', frozen: false, off: false, locked: false, lineweight: 31, plotFlag: 1 });
  }
  if (!db.tables.LAYER.entries.length) db.tables.LAYER.entries.push({ name: '0', handle: 'L0', colorIndex: 7, lineType: 'Continuous', frozen: false, off: false, locked: false, lineweight: 31, plotFlag: 1 });

  db.tables.LTYPE.entries.push(...cizgiTipleri(stiller, minX, minY, maxX, maxY));

  db.tables.BLOCK_RECORD.entries.push({ name: '*Model_Space', handle: MS, flags: 0,
    basePoint: { x: 0, y: 0, z: 0 }, layout: '', entities: ents, xrefPath: '' });

  db.header.ACADVER = 'DGN V7 · ' + (boyut === 3 ? '3B' : '2B');
  db.header.INSUNITS = birimKodu(anaBirim, altBirim);
  db.census = census;
  db.dgn = { boyut, olcek, anaBirim, altBirim, renkTablosu: !!renkTablosu, desteksiz };
  if (Object.keys(desteksiz).length) db.readWarn = Object.values(desteksiz).reduce((a, b) => a + b, 0);
  return db;
}

/**
 * MicroStation'ın 1-7 numaralı çizgi kodları EKRAN desenidir; model uzayında bir uzunlukları
 * yoktur. Görünür kalmaları için desen adımı çizimin kendi köşegeninden türetilir.
 */
function cizgiTipleri(stiller, minX, minY, maxX, maxY) {
  const out = [];
  if (!stiller.size) return out;
  const kosegen = (isFinite(minX) && isFinite(maxX) && maxX > minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const b = kosegen > 0 ? kosegen / 800 : 1;
  for (const s of [...stiller].sort((a, c) => a - c)) {
    const d = STIL_DESEN[s];
    if (!d) continue;
    const pat = d.map(v => v * b);
    out.push({ name: STIL_ADI[s], handle: 'LT' + s, description: 'DGN çizgi kodu ' + s,
      totalPatternLength: pat.reduce((a, c) => a + Math.abs(c), 0), pattern: pat.map(v => ({ elementLength: v })) });
  }
  return out;
}

/** TCB'nin iki karakterlik birim adı → DXF $INSUNITS kodu */
function birimKodu(ana, alt) {
  const k = String(ana || alt || '').trim().toLowerCase();
  return ({ mm: 4, cm: 5, dm: 14, m: 6, km: 7, in: 1, '"': 1, ft: 2, "'": 2, yd: 10, mi: 11, mil: 11 })[k] || 0;
}
