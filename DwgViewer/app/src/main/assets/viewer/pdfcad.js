/*
 * PDF → CAD: bir PDF sayfasının VEKTÖR içeriğini çizim varlıklarına (ent) çevirir.
 *
 * Amaç: elinde yalnız PDF olan kullanıcının plandaki çizgileri ölçebilmesi, seçebilmesi ve
 * düzenleyebilmesi. Sayfa RESİM olarak değil, gerçek yol ve yazı olarak okunur.
 *
 * Nasıl çalışır:
 *   1. Belge pdf-lib ile açılır (pdfedit.js'teki loadPdfLib; kitaplık iki yerde ayrı yüklenmesin).
 *   2. Sayfanın içerik akışları (Contents) ham olarak alınır ve çözülür.
 *   3. Akış PDF sözdizimine göre parçalanır (sayı, ad, dizge, dizi, sözlük, işleç).
 *   4. İşleçler yorumlanır: grafik durumu (q Q cm w), yol (m l c v y re h), yol bitişi
 *      (S s f F f* B B* b b* n), yazı (BT ET Tf Td TD Tm T* TL Tj TJ ' ") ve Form XObject (Do).
 *   5. Her nokta o andaki CTM ile çarpılır, sonuç doğrudan çizim biriminde çıkar.
 *
 * NEDEN böyle:
 *
 * · Çözme sırası DecompressionStream('deflate') → ('deflate-raw') → pdf-lib'in kendi çözücüsü.
 *   Tarayıcının kendi çözücüsü hızlıdır ve bellek kopyalamaz; 'deflate' zlib başlıklı akışı,
 *   'deflate-raw' başlıksız (bozuk üretici) akışı çözer. Üçüncü basamak eski Android WebView
 *   için gerekli: DecompressionStream Chromium 103'ten önce yoktur, pdf-lib ise pako'yu
 *   paketinde taşır ve LZW ile PNG öngörücüsünü de bilir. Böylece eski cihazda da içerik gelir.
 *
 * · Ölçek ve öteleme taban CTM'ye gömülür: base = [s,0,0,s, ox - llx*s, oy - lly*s]. Böylece
 *   döngü içinde ikinci bir dönüşüm yapılmaz, her nokta tek çarpımla çizim birimine iner.
 *   MediaBox köşesi çıkarılır ki sol alt köşesi (0,0)'a otursun. PDF'te y YUKARI olduğu için
 *   y ekseni çevrilmez — çizim de y yukarıdır.
 *
 * · Sayfanın /Rotate açısı UYGULANIR (0/90/180/270). Okuyucunun gördüğü yön ile çizime düşen
 *   yön ayrışmasın diye; döndürme taban CTM'ye çarpılır, sonuç yine tek çarpımdır.
 *
 * · Bezier düzleştirme ADAPTİFTİR. Kontrol noktalarının kirişe uzaklığı d ölçülür; kübik eğriyi
 *   n doğru parçasıyla yaklaştırmanın hatası ~ d/n² olduğundan n = ceil(sqrt(d/tol)) alınır ve
 *   2..64 arasına kısılır. tol verilmezse sabit 16 parçaya düşülür. Sabit bölme, düz bir eğride
 *   gereksiz 16 nokta, kocaman bir eğride yetersiz 16 nokta üretirdi.
 *
 * · Renk 256 (katmandan) bırakılır. PDF rengi RGB/CMYK/gri sürekli uzaydadır; ACI paletine
 *   yuvarlamak 256 renge zorlar ve çizimi kirletir. G g RG rg K k işleçleri yalnız yığından
 *   düşürülür; kullanıcı katman rengini kendi seçer.
 *
 * · Metin GLYPH GENİŞLİĞİ HESAPLANMAZ. Font ölçüleri (Widths, gömülü font tabloları) okunmadan
 *   ilerleme miktarı uydurma olurdu; art arda konumlandırılmamış Tj'ler üst üste biner.
 *   Bu bilinçli bir eksiktir, limits'te yazılıdır.
 *
 * ÇEVİREMEDİKLERİ (dürüstlük notu — bunlar eksiktir, taklit edilmez):
 *   · Gömülü resimler (Image XObject, satır içi BI…EI): yalnız sayılır (stats.images), çizilmez.
 *   · Kırpma yolları (W W*): yalnız sayılır (stats.clips); geometri kırpılmaz, kırpılmış bir yol
 *     tamamıyla gelir. Sayfa dışına taşan çizgi görülebilir.
 *   · Saydamlık, karışım kipi, yumuşak maske (gs / ExtGState) ve gölgelendirme (sh) yok sayılır.
 *   · Renk çevrilmez; her varlık opts.color (öntanımlı 256, katmandan) ile çıkar.
 *   · Çift yönlü dolgu kuralı (f ile f*) ayrılmaz; delikli dolgular dolu görünebilir.
 *   · Dolgu+çizgi işleçleri (B B* b b*) yalnız DOLGU üretir, ayrıca kontur çizilmez.
 *   · Type0 / Identity-H fontlu yazılar ATLANIR (CMap çözülmeden karakter kodu bilinmez).
 *     Type3 fontlar da yalnız kod olarak okunur, glif çizimleri (CharProcs) yorumlanmaz.
 *     Tek baytlık fontlarda WinAnsi varsayılır; Differences ile yeniden kodlanmış özel
 *     fontlarda (CAD sembol fontları) harfler yanlış çıkar.
 *   · Yazı ilerlemesi hesaplanmaz (bkz. yukarıda); ayrıca Tc, Tw, Tz ve TJ kerningi yok sayılır.
 *   · Font adları bütün kaynak sözlüklerinde tek havuzda tutulur; iki ayrı Form XObject aynı
 *     /F1 adını farklı fonta bağlarsa ilk görülen kazanır.
 *   · LZW ve PNG öngörücülü akışlar yalnız pdf-lib basamağıyla çözülür; o da yoksa akış atlanır.
 *   · Şifreli PDF'lerde akış içeriği çözülemez (ignoreEncryption yalnız belgeyi açar).
 *   · İşaretli içerik (BDC/EMC) ve isteğe bağlı katmanlar (OCG) düzleştirilir; PDF katmanı
 *     çizim katmanına dönüşmez, hepsi opts.layer'a yazılır.
 *
 * · Bozuk girdi ne çökertir ne de belleği doldurur: bütün lookup'lar try içindedir, çözücüler
 *   düz JS dizisi değil BÜYÜYEN TİPLİ TAMPON kullanır (düz dizi bayt başına ~10 bayt tutar,
 *   18 MB'lık bir akış küçük cihazın yığınını taşırırdı) ve tarayıcı dizge/ad/işleç uzunluğunu
 *   sınırlar — sınır aşılınca tarama sürer, yalnız biriktirme durur, böylece konum kaymaz.
 *
 * · q/Q yığını sınırlıdır ama sınır aşılınca DİP ATILMAZ: aşan q'lar sayılır, karşılığındaki
 *   Q'lar sayaçtan düşülür. Dip atılsaydı derin yuvalanmada kapanış Q'ları yanlış duruma döner,
 *   o noktadan sonraki bütün geometri kayardı.
 *
 * Hiçbir işlev istisna fırlatmaz: okunamayan belge null, okunamayan parça atlanır ve
 * stats.skipped artar. Modülde kullanıcıya gösterilecek metin yoktur (i18n çağıranın işi).
 *
 * NOT (çağıranı ilgilendirir): çok alt yollu yollar 'PATH' varlığı olarak çıkar; edit.js'teki
 * entToPrim'de bugün 'PATH' dalı YOKTUR ve bu varlıklar sessizce düşer. Dal eklenene dek çok
 * alt yollu PDF yolları sahnede görünmez.
 */
import { mul, det, segDist } from './geom.js';
import { loadPdfLib } from './pdfedit.js';

// ---------------------------------------------------------------------------------
// Sözdizimi tarayıcısı
// ---------------------------------------------------------------------------------
/* Belirteç türleri: 1 sayı · 2 ad (/Ad) · 3 dizge · 4 dizi · 5 işleç · 6 sözlük (atlanır) · 0 son */
const T_NUM = 1, T_NAME = 2, T_STR = 3, T_ARR = 4, T_OP = 5, T_DICT = 6, T_EOF = 0;

const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 0 || c === 12;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const hexVal = (c) => (c >= 48 && c <= 57) ? c - 48 : (c >= 97 && c <= 102) ? c - 87 : (c >= 65 && c <= 70) ? c - 55 : -1;

/* Bir dizgenin ya da çözülmüş akışın en çok kaç baytı tutulur. Kapanmamış bir parantez ya da
   ikili çöp, tarayıcıyı akışın sonuna kadar sürükler; sınır olmadan tek bozuk bayt bütün akışı
   belleğe kopyalatır. Sınır aşılınca TARAMA SÜRER (konum kaymasın), yalnız biriktirme durur. */
const MAX_STR = 1 << 22;                                // 4 MB — gerçek bir dizge bunun yanına yaklaşmaz
const MAX_TOKEN = 127;                                  // ad ve işleç uzunluğu (PDF sınırı 127)

/**
 * Büyüyen bayt tamponu. Çözücüler düz JS dizisiyle yazılırsa bayt başına ~10 bayt yer tutar;
 * 10 MB'lık bir akış küçük cihazın yığınını taşırır. Tipli tamponda bayt bayttır, iki katına
 * çıkarak büyür ve sonunda tam boyuna kırpılır.
 */
function sink(cap) {
  let b = new Uint8Array(cap > 16 ? cap : 16), n = 0;
  const grow = (need) => {
    let m = b.length;
    while (m < need) m *= 2;
    const t = new Uint8Array(m); t.set(b.subarray(0, n)); b = t;
  };
  return {
    put(v) { if (n === b.length) grow(n + 1); b[n++] = v; },
    put4(a, c, d, e) { if (n + 4 > b.length) grow(n + 4); b[n++] = a; b[n++] = c; b[n++] = d; b[n++] = e; },
    fill(v, k) { if (n + k > b.length) grow(n + k); for (let i = 0; i < k; i++) b[n++] = v; },
    get size() { return n; },
    take() { return n === b.length ? b : b.slice(0, n); },
  };
}

/**
 * Akış üzerinde ilerleyen tarayıcı. Belirteç nesnesi PAYLAŞILIR (tk): büyük akışta belirteç
 * başına nesne tahsisi yapılmasın diye. Değeri okuyan hemen kullanır, saklamaz.
 */
function scanner(buf) {
  const n = buf.length;
  let p = 0;
  const tk = { k: T_EOF, num: 0, name: '', str: null, arr: null, op: '' };

  const skipWs = () => {
    while (p < n) {
      const c = buf[p];
      if (isWs(c)) { p++; continue; }
      if (c === 37) { while (p < n && buf[p] !== 10 && buf[p] !== 13) p++; continue; }   // % yorum satırı
      break;
    }
  };
  const readName = () => {
    p++;
    let s = '';
    while (p < n) {
      const c = buf[p];
      if (isWs(c) || isDelim(c)) break;
      if (c === 35 && p + 2 < n) {                       // #xx onaltılık kaçış
        const h = hexVal(buf[p + 1]), l = hexVal(buf[p + 2]);
        if (h >= 0 && l >= 0) { if (s.length < MAX_TOKEN) s += String.fromCharCode(h * 16 + l); p += 3; continue; }
      }
      if (s.length < MAX_TOKEN) s += String.fromCharCode(c);
      p++;
    }
    return s;
  };
  /** ( … ) iç içe parantezli dizge; collect=false ise yalnız atlanır (sözlük içi) */
  const readLit = (collect) => {
    p++;
    let depth = 1;
    const out = collect ? sink(32) : null;
    const put = (v) => { if (out && out.size < MAX_STR) out.put(v); };
    while (p < n) {
      const c = buf[p++];
      if (c === 92) {                                     // ters bölü kaçışı
        const e = buf[p++];
        if (e === 110) put(10);
        else if (e === 114) put(13);
        else if (e === 116) put(9);
        else if (e === 98) put(8);
        else if (e === 102) put(12);
        else if (e >= 48 && e <= 55) {                    // \ooo sekizlik
          let v = e - 48, k = 0;
          while (k < 2 && p < n && buf[p] >= 48 && buf[p] <= 55) { v = v * 8 + (buf[p] - 48); p++; k++; }
          put(v & 255);
        } else if (e === 10) { /* satır devamı */ }
        else if (e === 13) { if (buf[p] === 10) p++; }
        else put(e);
        continue;
      }
      if (c === 40) { depth++; put(c); continue; }
      if (c === 41) { depth--; if (!depth) break; put(c); continue; }
      put(c);
    }
    return out ? out.take() : null;
  };
  const readHex = () => {                                 // < … > onaltılık dizge
    p++;
    const out = sink(32);
    let hi = -1;
    while (p < n) {
      const c = buf[p++];
      if (c === 62) break;
      const d = hexVal(c);
      if (d < 0) continue;
      if (hi < 0) hi = d; else { if (out.size < MAX_STR) out.put(hi * 16 + d); hi = -1; }
    }
    if (hi >= 0 && out.size < MAX_STR) out.put(hi * 16);  // tek hane kalırsa sıfırla tamamlanır
    return out.take();
  };
  const skipDict = () => {                                // << … >> içeriği bize gerekmez, atlanır
    p += 2;
    let depth = 1;
    while (p < n && depth > 0) {
      const c = buf[p];
      if (c === 60 && buf[p + 1] === 60) { depth++; p += 2; continue; }
      if (c === 62 && buf[p + 1] === 62) { depth--; p += 2; continue; }
      if (c === 40) { readLit(false); continue; }
      p++;
    }
  };
  const readNum = () => {
    let s = '';
    while (p < n) {
      const c = buf[p];
      if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) { s += String.fromCharCode(c); p++; continue; }
      break;
    }
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : 0;                    // ".5.3" gibi bozuk sayı: sıfır, akış kaymaz
  };

  /** Bir belirteç okur ve paylaşılan tk'yı doldurur */
  function next() {
    for (;;) {
      skipWs();
      if (p >= n) { tk.k = T_EOF; return tk; }
      const c = buf[p];
      if (c === 47) { tk.k = T_NAME; tk.name = readName(); return tk; }
      if (c === 40) { tk.k = T_STR; tk.str = readLit(true); return tk; }
      if (c === 60) {
        if (buf[p + 1] === 60) { skipDict(); tk.k = T_DICT; return tk; }
        tk.k = T_STR; tk.str = readHex(); return tk;
      }
      if (c === 91) {                                     // [ … ] — TJ dizisi
        p++;
        const a = [];
        let guard = 0;
        while (p < n && guard++ < 100000) {
          skipWs();
          if (p >= n) break;
          if (buf[p] === 93) { p++; break; }
          const t = next();
          if (t.k === T_NUM) a.push(t.num);
          else if (t.k === T_STR) a.push(t.str);
          else if (t.k === T_EOF) break;
        }
        tk.k = T_ARR; tk.arr = a; return tk;
      }
      if (c === 93 || c === 123 || c === 125 || c === 41 || c === 62) { p++; continue; }   // başıboş ayraç
      if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) { tk.k = T_NUM; tk.num = readNum(); return tk; }
      let s = '';
      while (p < n) {
        const q = buf[p];
        if (isWs(q) || isDelim(q)) break;
        if (s.length < MAX_TOKEN) s += String.fromCharCode(q);   // ikili çöpte işleç adı şişmesin
        p++;
      }
      if (!s) { p++; continue; }
      tk.k = T_OP; tk.op = s;
      return tk;
    }
  }

  /** BI … ID <ikili> EI satır içi resmini atlar (ikili gövde tarayıcıyı bozmasın) */
  function skipInlineImage() {
    while (p < n - 1) {                                   // ID işlecini bul
      if (buf[p] === 73 && buf[p + 1] === 68 && (p + 2 >= n || isWs(buf[p + 2]) || isDelim(buf[p + 2]))) { p += 3; break; }
      p++;
    }
    while (p < n - 1) {                                   // ardından boşlukla ayrılmış EI
      if (buf[p] === 69 && buf[p + 1] === 73 && (p === 0 || isWs(buf[p - 1])) && (p + 2 >= n || isWs(buf[p + 2]) || isDelim(buf[p + 2]))) { p += 2; return; }
      p++;
    }
    p = n;
  }

  return { next, skipInlineImage };
}

// ---------------------------------------------------------------------------------
// Akış çözme
// ---------------------------------------------------------------------------------
/** WinAnsi 0x80-0x9F aralığı Latin-1'den ayrılır; kalan aralıklar birebir aynıdır */
const WINANSI_HI = [8364, 0, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 0, 381, 0,
  0, 8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 0, 382, 376];

/** Tek baytlık kodlamada bayt dizisi → metin (WinAnsi/Latin-1) */
function bytesToText(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x80 && c <= 0x9f) { const u = WINANSI_HI[c - 0x80]; s += u ? String.fromCharCode(u) : ''; continue; }
    if (c < 32 && c !== 9 && c !== 10) continue;          // basılmayan denetim baytı atılır
    s += String.fromCharCode(c);
  }
  return s;
}

/** Tarayıcının çözücüsü; biçim desteklenmiyorsa null (istisna fırlatmaz) */
async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') return null;
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const ds = new DecompressionStream(fmt);
      const body = new Response(bytes).body;
      if (!body) return null;
      const buf = await new Response(body.pipeThrough(ds)).arrayBuffer();
      const u = new Uint8Array(buf);
      if (u.length) return u;
    } catch (e) { /* sonraki biçimi dene */ }
  }
  return null;
}

function asciiHexDecode(b) {
  const out = sink((b.length >> 1) + 2);                  // çıkış girdinin en çok yarısı: tek seferde ayrılır
  let hi = -1;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 62) break;
    const d = hexVal(c);
    if (d < 0) continue;
    if (hi < 0) hi = d; else { out.put(hi * 16 + d); hi = -1; }
  }
  if (hi >= 0) out.put(hi * 16);
  return out.take();
}
function ascii85Decode(b) {
  const out = sink(((b.length * 4 / 5) | 0) + 8);
  const t = new Uint32Array(5);
  let k = 0, i = 0;
  if (b[0] === 60 && b[1] === 126) i = 2;                 // <~ önek
  for (; i < b.length; i++) {
    const c = b[i];
    if (isWs(c)) continue;
    if (c === 126) break;                                 // ~> sonek
    if (c === 122 && k === 0) { out.put4(0, 0, 0, 0); continue; }
    if (c < 33 || c > 117) return null;
    t[k++] = c - 33;
    if (k === 5) {
      let v = 0;
      for (let j = 0; j < 5; j++) v = v * 85 + t[j];
      out.put4((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      k = 0;
    }
  }
  if (k > 1) {
    let v = 0;
    for (let j = 0; j < 5; j++) v = v * 85 + (j < k ? t[j] : 84);
    const q = [(v / 16777216) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    for (let j = 0; j < k - 1; j++) out.put(q[j]);
  }
  return out.take();
}
function runLengthDecode(b) {
  const out = sink(b.length * 2 + 16);                    // oran belirsizdir (bir bayt 128 bayta açılabilir): tampon büyür
  let i = 0;
  while (i < b.length) {
    const L = b[i++];
    if (L === 128) break;
    if (L < 128) { for (let j = 0; j <= L && i < b.length; j++) out.put(b[i++]); continue; }
    const v = b[i++];
    out.fill(v, 257 - L);
  }
  return out.take();
}

/**
 * Bir sözlükteki /Filter değerini ad dizisine indirger. Bozuk bir nesne ağacında lookup istisna
 * atabilir; o durumda tanınmayan bir ad döndürülür, böylece akış pdf-lib'in çözücüsüne düşer.
 */
function filterNames(lib, dict) {
  try {
    const f = dict ? dict.lookup(lib.PDFName.of('Filter')) : null;
    if (!f) return [];
    const nm = (o) => (o && typeof o.asString === 'function') ? o.asString().replace(/^\//, '') : '';
    if (f instanceof lib.PDFArray) {
      const a = [];
      for (let i = 0; i < f.size(); i++) a.push(nm(f.lookup(i)));
      return a;
    }
    return [nm(f)];
  } catch (e) { return ['?']; }
}
/** DecodeParms'ta öngörücü var mı? Varsa kendi çözücümüz yetmez, pdf-lib'e düşülür */
function hasPredictor(lib, dict) {
  try {
    const dp = dict ? dict.lookup(lib.PDFName.of('DecodeParms')) : null;
    const one = (d) => {
      if (!d || typeof d.lookup !== 'function') return false;
      const pr = d.lookup(lib.PDFName.of('Predictor'));
      return !!(pr && typeof pr.asNumber === 'function' && pr.asNumber() > 1);
    };
    if (dp instanceof lib.PDFArray) {
      for (let i = 0; i < dp.size(); i++) if (one(dp.lookup(i))) return true;
      return false;
    }
    return one(dp);
  } catch (e) { return true; }                            // okunamayan parametre: güvenli yol pdf-lib
}

/**
 * Ham akışı çözer. Sıra: kendi çözücümüz (DecompressionStream + ASCII/RunLength) →
 * pdf-lib'in kendi çözücüsü (pako; LZW ve PNG öngörücüsünü de bilir). İkisi de olmazsa null.
 */
async function decodeStream(lib, raw) {
  let data = null;
  try { data = raw.contents; } catch (e) { return null; }
  if (!data || !data.length) return null;
  const fs = filterNames(lib, raw.dict);
  if (!fs.length) return data;
  let ok = !hasPredictor(lib, raw.dict);
  if (ok) {
    for (const f of fs) {
      if (f === 'FlateDecode' || f === 'Fl') { data = await inflate(data); }
      else if (f === 'ASCIIHexDecode' || f === 'AHx') { data = asciiHexDecode(data); }
      else if (f === 'ASCII85Decode' || f === 'A85') { data = ascii85Decode(data); }
      else if (f === 'RunLengthDecode' || f === 'RL') { data = runLengthDecode(data); }
      else if (f === 'Crypt') { /* kimlik süzgeci: dokunma */ }
      else { ok = false; break; }                          // LZW, DCT, JPX: bize göre değil
      if (!data || !data.length) { ok = false; break; }
    }
  }
  if (ok && data && data.length) return data;
  try {
    const st = lib.decodePDFRawStream(raw);
    const u = st && typeof st.decode === 'function' ? st.decode() : null;
    return u && u.length ? u : null;
  } catch (e) { return null; }
}

/** Sayfanın (ya da Form XObject'in) bütün içerik akışlarını çözüp aralarına boşluk koyarak birleştirir */
async function contentBytes(lib, contents) {
  const raws = [];
  try {
    const push = (o) => { if (o instanceof lib.PDFRawStream) raws.push(o); };
    if (contents instanceof lib.PDFArray) {
      for (let i = 0; i < contents.size(); i++) push(contents.lookup(i));
    } else push(contents);
  } catch (e) { /* çözülebilen akışlarla devam edilir */ }
  if (!raws.length) return { data: null, failed: 0, tried: 0 };
  const parts = [];
  let total = 0, failed = 0;
  for (const r of raws) {
    const d = await decodeStream(lib, r);
    if (!d) { failed++; continue; }
    parts.push(d);
    total += d.length + 1;
  }
  if (!parts.length) return { data: null, failed, tried: raws.length };
  const out = new Uint8Array(total);
  let at = 0;
  for (const d of parts) { out.set(d, at); at += d.length; out[at++] = 10; }   // akışlar boşlukla ayrılır
  return { data: out, failed, tried: raws.length };
}

// ---------------------------------------------------------------------------------
// Yol yardımcıları
// ---------------------------------------------------------------------------------
/** Kübik bezier'i adaptif böler; noktalar P'ye düz (x,y,x,y…) olarak eklenir */
function bezier(P, x0, y0, x1, y1, x2, y2, x3, y3, tol) {
  const d = Math.max(segDist(x1, y1, x0, y0, x3, y3), segDist(x2, y2, x0, y0, x3, y3));
  let n = tol > 0 ? Math.ceil(Math.sqrt(d / tol)) : 16;
  if (!(n >= 2)) n = 2;
  if (n > 64) n = 64;
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    P.push(a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3);
  }
}
/** Düz sayı dizisini ent noktalarına çevirir; aynı noktanın tekrarı atılır */
function toPts(f) {
  const out = [];
  for (let i = 0; i + 1 < f.length; i += 2) {
    const x = f[i], y = f[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-9 && Math.abs(last[1] - y) < 1e-9) continue;
    out.push([x, y, 0]);
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Yorumlayıcı
// ---------------------------------------------------------------------------------
/**
 * Bir içerik akışını yorumlar ve ent'leri C.ents'e yazar.
 *   C  { lib, ents, fonts, seen, opt, stats }  — çalışma bağlamı
 *   m0 bu akışın giriş CTM'si
 *   res kaynak sözlüğü (Font, XObject); yoksa null
 */
async function runStream(C, buf, m0, res, depth) {
  const sc = scanner(buf);
  const opt = C.opt;
  const nums = new Float64Array(40);
  let nn = 0;
  let sname = '', sstr = null, sarr = null;

  let gm = m0.slice();
  let lw = 1;
  const gstack = [];
  let qskip = 0;            // sınırın ötesindeki q sayısı; Q'lar dengeli kalsın diye sayılır

  let subs = [], cur = null, cx = 0, cy = 0, sx = 0, sy = 0;   // yol; cx,cy geçerli nokta (çizim biriminde)
  let pendingClip = false;

  // yazı durumu
  let tm = null, tlm = null, tl = 0, tfs = 0, trise = 0, tmode = 0, tfont = '';

  const P = (x, y) => [gm[0] * x + gm[2] * y + gm[4], gm[1] * x + gm[3] * y + gm[5]];
  const clear = () => { nn = 0; sname = ''; sstr = null; sarr = null; };
  const full = () => C.ents.length >= opt.maxEnts;

  const startSub = (x, y) => { cur = { f: [x, y], closed: false }; subs.push(cur); sx = cx = x; sy = cy = y; };

  /** Biriken alt yolları ent'e çevirir */
  const emit = (fill, stroke) => {
    const good = [];
    for (const s of subs) {
      const pts = toPts(s.f);
      if (pts.length < 2) { if (s.f.length) C.stats.skipped++; continue; }   // tek nokta: nokta çizimi, atlanır
      if (fill && pts.length < 3) { C.stats.skipped++; continue; }
      good.push({ pts, closed: s.closed || fill });
    }
    if (!good.length) return;
    if (full()) { C.stats.skipped += good.length; return; }
    const w = stroke && !fill ? lw * Math.sqrt(Math.abs(det(gm))) : 0;
    if (good.length === 1) {
      const g = good[0];
      if (fill) C.ents.push({ type: 'HATCH', pts: g.pts, layer: opt.layer, color: opt.color, pattern: 'SOLID' });
      else if (g.pts.length === 2 && !g.closed) C.ents.push({ type: 'LINE', pts: g.pts, layer: opt.layer, color: opt.color, width: w });
      else C.ents.push({ type: 'LWPOLYLINE', pts: g.pts, closed: g.closed, layer: opt.layer, color: opt.color, width: w });
      C.stats.paths++;
      return;
    }
    const ops = [];                                        // çok alt yollu: ham yol (PATH)
    for (const g of good) {
      ops.push([0, g.pts[0][0], g.pts[0][1], 0]);
      for (let i = 1; i < g.pts.length; i++) ops.push([1, g.pts[i][0], g.pts[i][1], 0]);
      if (g.closed) ops.push([1, g.pts[0][0], g.pts[0][1], 0]);   // PATH'te alt yol başına kapalılık yok, kiriş eklenir
    }
    C.ents.push({ type: 'PATH', ops, closed: false, fill: !!fill, width: w, layer: opt.layer, color: opt.color });
    C.stats.paths++;
  };
  const endPath = (fill, stroke, close) => {
    if (close && cur) cur.closed = true;
    if (fill || stroke) emit(fill, stroke);
    else if (subs.length && !pendingClip) C.stats.skipped++;   // n: yalnız yol bitirir, hiçbir şey çizmez
    subs = []; cur = null; pendingClip = false;
  };

  /** Geçerli yazı gösterme matrisinden TEXT varlığı üretir */
  const showText = (bytes) => {
    if (!opt.text || !bytes || !bytes.length) return;
    if (!tm) { C.stats.skipped++; return; }                 // BT dışında Tj: sayılır, sessizce yitmesin
    if (tmode === 3 || tmode === 7) return;                 // görünmez metin (tarama katmanı): çizime girmez
    const fi = C.fonts.get(tfont);
    if (fi && fi.wide) { C.stats.skipped++; return; }       // Type0/Identity-H: CMap olmadan çözülemez
    const s = bytesToText(bytes);
    if (!s.trim()) return;
    if (full()) { C.stats.skipped++; return; }
    const M = mul(gm, tm);
    const h = tfs * Math.hypot(M[2], M[3]);
    const x = M[0] * 0 + M[2] * trise + M[4], y = M[1] * 0 + M[3] * trise + M[5];   // Ts yükseltmesi yazı uzayında uygulanır
    if (!(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) { C.stats.skipped++; return; }
    C.ents.push({ type: 'TEXT', pts: [[x, y, 0]], text: s, h, rot: Math.atan2(M[1], M[0]), ha: 0, va: 0, layer: opt.layer, color: opt.color });
    C.stats.texts++;
  };
  const nextLine = (tx, ty) => { tlm = mul(tlm, [1, 0, 0, 1, tx, ty]); tm = tlm.slice(); };

  let guard = 0;
  for (;;) {
    if (guard++ > 20000000) break;                          // bozuk akışta sonsuz döngü kalkanı
    const t = sc.next();
    if (t.k === T_EOF) break;
    if (t.k === T_NUM) { if (nn < nums.length) nums[nn++] = t.num; continue; }
    if (t.k === T_NAME) { sname = t.name; continue; }
    if (t.k === T_STR) { sstr = t.str; continue; }
    if (t.k === T_ARR) { sarr = t.arr; continue; }
    if (t.k === T_DICT) continue;
    C.stats.ops++;
    const op = t.op;
    switch (op) {
      // --- grafik durumu ---
      /* Yığın sınırı aşılınca DİBİ ATILAMAZ: atılırsa açılış Q'ları yanlış duruma döner ve o
         noktadan sonraki bütün geometri kayar. Sınırın ötesindeki q'lar sayılır, karşılığındaki
         Q'lar da sayaçtan düşülür; böylece derinlik ne olursa olsun eşleşme bozulmaz. */
      case 'q': if (gstack.length < 512) gstack.push([gm.slice(), lw]); else qskip++; break;
      case 'Q': if (qskip > 0) qskip--; else { const s = gstack.pop(); if (s) { gm = s[0]; lw = s[1]; } } break;
      case 'cm': if (nn >= 6) gm = mul(gm, [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]]); break;
      case 'w': if (nn >= 1) lw = nums[0]; break;
      case 'W': case 'W*': pendingClip = true; C.stats.clips++; break;

      // --- yol kurma ---
      case 'm': if (nn >= 2) { const q = P(nums[0], nums[1]); startSub(q[0], q[1]); } break;
      case 'l': if (nn >= 2) { const q = P(nums[0], nums[1]); if (!cur) startSub(q[0], q[1]); else { cur.f.push(q[0], q[1]); cx = q[0]; cy = q[1]; } } break;
      case 'c': if (nn >= 6 && cur) { const a = P(nums[0], nums[1]), b = P(nums[2], nums[3]), e = P(nums[4], nums[5]); bezier(cur.f, cx, cy, a[0], a[1], b[0], b[1], e[0], e[1], opt.tol); cx = e[0]; cy = e[1]; } break;
      case 'v': if (nn >= 4 && cur) { const b = P(nums[0], nums[1]), e = P(nums[2], nums[3]); bezier(cur.f, cx, cy, cx, cy, b[0], b[1], e[0], e[1], opt.tol); cx = e[0]; cy = e[1]; } break;
      case 'y': if (nn >= 4 && cur) { const a = P(nums[0], nums[1]), e = P(nums[2], nums[3]); bezier(cur.f, cx, cy, a[0], a[1], e[0], e[1], e[0], e[1], opt.tol); cx = e[0]; cy = e[1]; } break;
      case 'h': if (cur) { cur.closed = true; cx = sx; cy = sy; } break;
      case 're': if (nn >= 4) {
        const a = P(nums[0], nums[1]), b = P(nums[0] + nums[2], nums[1]), c = P(nums[0] + nums[2], nums[1] + nums[3]), d = P(nums[0], nums[1] + nums[3]);
        cur = { f: [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], closed: true };
        subs.push(cur);
        sx = cx = a[0]; sy = cy = a[1];
      } break;

      // --- yol bitişi ---
      case 'S': endPath(false, true, false); break;
      case 's': endPath(false, true, true); break;
      case 'f': case 'F': case 'f*': endPath(true, false, false); break;
      case 'B': case 'B*': endPath(true, true, false); break;
      case 'b': case 'b*': endPath(true, true, true); break;
      case 'n': endPath(false, false, false); break;

      // --- yazı ---
      case 'BT': tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); trise = 0; break;
      case 'ET': tm = null; tlm = null; break;
      case 'Tf': tfont = sname; if (nn >= 1) tfs = nums[0]; break;
      case 'TL': if (nn >= 1) tl = nums[0]; break;
      case 'Ts': if (nn >= 1) trise = nums[0]; break;
      case 'Tr': if (nn >= 1) tmode = nums[0] | 0; break;
      case 'Td': if (nn >= 2 && tlm) nextLine(nums[0], nums[1]); break;
      case 'TD': if (nn >= 2 && tlm) { tl = -nums[1]; nextLine(nums[0], nums[1]); } break;
      case 'Tm': if (nn >= 6) { tm = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]]; tlm = tm.slice(); } break;
      case 'T*': if (tlm) nextLine(0, -tl); break;
      case 'Tj': showText(sstr); break;
      case "'": if (tlm) nextLine(0, -tl); showText(sstr); break;
      case '"': if (tlm) nextLine(0, -tl); showText(sstr); break;
      case 'TJ': if (sarr) {
        const b = [];
        for (const it of sarr) if (typeof it !== 'number') for (let i = 0; i < it.length; i++) b.push(it[i]);
        showText(b);                                        // aradaki kerning sayıları yok sayılır (bkz. limits)
      } break;

      // --- dış nesne ---
      case 'Do': if (sname && depth < 6) await doXObject(C, sname, res, gm, depth); else if (sname) C.stats.skipped++; break;
      case 'BI': sc.skipInlineImage(); C.stats.images++; break;
      case 'sh': C.stats.skipped++; break;                  // gölgelendirme: geometrisi yok

      default: break;                                       // gs, d, j, J, M, i, ri, cs, sc, scn, BDC, EMC, d0, d1, renk işleçleri…
    }
    clear();
  }
  if (subs.length) { C.stats.skipped += subs.length; }      // yol bitiş işleci gelmeden akış bitti
}

/** Form XObject'i çözer ve kendi matrisiyle özyinelemeli yorumlar; resim XObject'i sayılır, çevrilmez */
async function doXObject(C, name, res, gm, depth) {
  const lib = C.lib;
  try {
    const xo = res ? res.lookup(lib.PDFName.of('XObject')) : null;
    const st = xo && typeof xo.lookup === 'function' ? xo.lookup(lib.PDFName.of(name)) : null;
    if (!(st instanceof lib.PDFRawStream)) { C.stats.skipped++; return; }
    const sub = st.dict.lookup(lib.PDFName.of('Subtype'));
    const sn = sub && typeof sub.asString === 'function' ? sub.asString() : '';
    if (sn !== '/Form') { C.stats.images++; return; }
    if (C.seen.has(st)) { C.stats.skipped++; return; }      // özyineleyen form: bir kez girilir
    const data = await decodeStream(lib, st);
    if (!data) { C.stats.skipped++; return; }
    let m = gm;
    const mx = st.dict.lookup(lib.PDFName.of('Matrix'));
    if (mx instanceof lib.PDFArray && mx.size() >= 6) {
      const v = [];
      for (let i = 0; i < 6; i++) { const o = mx.lookup(i); v.push(o && typeof o.asNumber === 'function' ? o.asNumber() : (i === 0 || i === 3 ? 1 : 0)); }
      m = mul(gm, v);
    }
    const own = st.dict.lookup(lib.PDFName.of('Resources'));
    const r2 = own && typeof own.lookup === 'function' ? own : res;
    C.seen.add(st);
    collectFonts(C, r2);
    await runStream(C, data, m, r2, depth + 1);
    C.seen.delete(st);
  } catch (e) { C.stats.skipped++; }
}

/** Kaynak sözlüğündeki fontları tarar: yalnız "iki baytlık mı" bilgisi tutulur */
function collectFonts(C, res) {
  const lib = C.lib;
  try {
    const fd = res ? res.lookup(lib.PDFName.of('Font')) : null;
    if (!fd || typeof fd.keys !== 'function') return;
    for (const k of fd.keys()) {
      const nm = k.asString().replace(/^\//, '');
      if (C.fonts.has(nm)) continue;
      const f = fd.lookup(k);
      const sub = f && typeof f.lookup === 'function' ? f.lookup(lib.PDFName.of('Subtype')) : null;
      const sn = sub && typeof sub.asString === 'function' ? sub.asString() : '';
      C.fonts.set(nm, { wide: sn === '/Type0' });
    }
  } catch (e) { /* fontsuz da metin okunur, yalnız Type0 ayıklanamaz */ }
}

// ---------------------------------------------------------------------------------
// Dışa açılan yüzey
// ---------------------------------------------------------------------------------
/** Sayfa sayısı; okunamazsa 0 */
export async function pdfPageCount(bytes) {
  try {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount() || 0;
  } catch (e) { return 0; }
}

/**
 * MediaBox → [llx, lly, w, h]; okunamazsa A4.
 * Köşeler TERS sırada yazılmış olabilir ([0 842 595 0] gibi); pdf-lib genişliği x2-x1 olarak
 * verdiği için böyle bir kutuda genişlik eksi çıkar. Kutu normalleştirilir: köşe iki değerin
 * küçüğü, ölçü mutlak değeri. Aksi hâlde geçerli bir sayfa A4 sanılır ve ölçek yanlış olur.
 */
function pageBox(lib, node) {
  try {
    const mb = node.MediaBox() || node.getInheritableAttribute(lib.PDFName.of('MediaBox'));
    const r = mb && typeof mb.asRectangle === 'function' ? mb.asRectangle() : null;
    if (r) {
      const x = Math.min(r.x, r.x + r.width), y = Math.min(r.y, r.y + r.height);
      const w = Math.abs(r.width), h = Math.abs(r.height);
      if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) return [x, y, w, h];
    }
  } catch (e) { /* aşağıdaki öntanıma düşülür */ }
  return [0, 0, 595.28, 841.89];
}

/**
 * Sayfanın vektör içeriğini ent listesine çevirir.
 *   bytes      PDF baytları (Uint8Array / ArrayBuffer)
 *   pageIndex  0 tabanlı sayfa sırası
 *   opts       { scale=1, ox=0, oy=0, layer='0', color=256, text=true, maxEnts=60000, tol=0.05*scale }
 * Dönüş { ents, page:{w,h}, stats:{paths,texts,skipped,ops,images,clips,inflate} } ya da null.
 *
 * NOT: içerik hiç çözülemediğinde null DÖNMEZ; ents boş, stats.inflate false gelir. Böylece
 * çağıran "sayfa boş" ile "çözücü yok" durumunu ayırabilir — null bu bilgiyi taşıyamazdı.
 * null yalnız belge ya da sayfa hiç açılamadığında döner.
 */
export async function pdfToEnts(bytes, pageIndex, opts = {}) {
  let lib, doc, page;
  try {
    lib = await loadPdfLib();
    doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    page = doc.getPages()[pageIndex | 0];
  } catch (e) { return null; }
  if (!page) return null;

  const scale = opts.scale > 0 ? opts.scale : 1;
  const opt = {
    layer: opts.layer == null ? '0' : opts.layer,
    color: opts.color == null ? 256 : opts.color,
    text: opts.text !== false,
    maxEnts: opts.maxEnts > 0 ? opts.maxEnts : 60000,
    tol: opts.tol > 0 ? opts.tol : scale * 0.05,
  };
  const ox = opts.ox || 0, oy = opts.oy || 0;

  const node = page.node;
  const [llx, lly, pw, ph] = pageBox(lib, node);
  let rot = 0;
  try { rot = ((page.getRotation().angle % 360) + 360) % 360; } catch (e) { rot = 0; }
  rot = rot - (rot % 90);

  // taban CTM: MediaBox köşesini sıfırla → sayfa dönüşü → ölçek ve öteleme
  let base = [1, 0, 0, 1, -llx, -lly];
  if (rot === 90) base = mul([0, -1, 1, 0, 0, pw], base);
  else if (rot === 180) base = mul([-1, 0, 0, -1, pw, ph], base);
  else if (rot === 270) base = mul([0, 1, -1, 0, ph, 0], base);
  base = mul([scale, 0, 0, scale, ox, oy], base);
  const vw = (rot % 180 ? ph : pw) * scale, vh = (rot % 180 ? pw : ph) * scale;

  const C = {
    lib, ents: [], fonts: new Map(), seen: new Set(), opt,
    stats: { paths: 0, texts: 0, skipped: 0, ops: 0, images: 0, clips: 0, inflate: true },
  };

  let res = null;
  try { res = node.Resources() || null; } catch (e) { res = null; }
  collectFonts(C, res);

  let contents = null;
  try { contents = node.Contents(); } catch (e) { contents = null; }
  // Bozuk bir nesne ağacında akış toplama da patlayabilir; sonuç nesnesi yine de döner (istisna yok)
  let data = null, failed = 0, tried = 0;
  try { ({ data, failed, tried } = await contentBytes(lib, contents)); }
  catch (e) { data = null; failed = 1; tried = 1; }
  C.stats.skipped += failed;
  if (!data) {
    if (tried) C.stats.inflate = false;   // akış vardı ama çözülemedi; akış hiç yoksa sayfa gerçekten boştur
    return { ents: [], page: { w: vw, h: vh }, stats: C.stats };
  }
  try { await runStream(C, data, base, res, 0); }
  catch (e) { C.stats.skipped++; }                          // yorumlama yarıda kalsa da eldeki ent'ler verilir
  if (C.ents.length > opt.maxEnts) C.ents.length = opt.maxEnts;
  return { ents: C.ents, page: { w: vw, h: vh }, stats: C.stats };
}
