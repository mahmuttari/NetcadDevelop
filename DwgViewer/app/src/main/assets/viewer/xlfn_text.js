/*
 * EXCEL FORMÜL MOTORU — METİN İŞLEVLERİ
 *
 * KAPSAM. Birleştirme (CONCAT, CONCATENATE, TEXTJOIN), parça alma (LEFT, RIGHT, MID),
 * ölçme ve harf düzeni (LEN, LOWER, UPPER, PROPER, TRIM, CLEAN, REPT), arama ve değiştirme
 * (FIND, SEARCH, REPLACE, SUBSTITUTE, EXACT), sayı ile metin arasındaki geçişler (VALUE,
 * NUMBERVALUE, T, TEXT, FIXED, DOLLAR), karakter kodları (CHAR, CODE, UNICHAR, UNICODE),
 * çift baytlı dil işlevleri (ASC, JIS, DBCS, PHONETIC), yeni metin ailesi (TEXTBEFORE,
 * TEXTAFTER, TEXTSPLIT, ARRAYTOTEXT, VALUETOTEXT, ENCODEURL) ve düzenli ifade ailesi
 * (REGEXTEST, REGEXEXTRACT, REGEXREPLACE).
 *
 * ORTAK TUZAK 1 — FIND ile SEARCH AYNI İŞLEV DEĞİLDİR. FIND büyük/küçük harf DUYAR ve jokeri
 * düz karakter sayar; SEARCH duymaz ve * ? ~ jokerlerini tanır. İkisi de bulamadığında #N/A
 * değil #VALUE! verir — bulunamamak burada "veri yok" değil "geçersiz istek" sayılır.
 *
 * ORTAK TUZAK 2 — HARF ÇEVRİMİ YEREL AYARA BAKMAZ. Excel UPPER("i") için Türkçe kipte bile
 * "I" yazar, "İ" yazmaz. Bu yüzden hiçbir yerde toLocaleUpperCase('tr') kullanılmaz; düz
 * toUpperCase / toLowerCase kullanılır (iki küçük düzeltmeyle, bkz. buyuk / kucuk).
 *
 * ORTAK TUZAK 3 — B'Lİ SÜRÜMLER. LEFTB, RIGHTB, MIDB, LENB, REPLACEB, FINDB, SEARCHB çift
 * baytlı diller (Japonca, Çince, Korece) için bayt sayar. Tek baytlı bir ortamda davranışları
 * tekiyle birebir aynıdır; bu yüzden aynı gövdeyi paylaşırlar. Ayrı bir gövde yazmak, olmayan
 * bir farkı varmış gibi göstermek olurdu.
 *
 * ORTAK TUZAK 4 — HÜCRE SINIRI. Bir hücre en çok 32.767 karakter taşır; birleştirme sonucu
 * bunu aşarsa Excel #VALUE! verir. CONCAT, CONCATENATE, TEXTJOIN ve REPT bu sınırı sınar.
 *
 * ORTAK TUZAK 5 — KARAKTER KODLARI ANSI'DİR, UNICODE DEĞİL. CHAR / CODE 1-255 arasında
 * çalışır ve 128-159 aralığı Windows-1252 tablosundan gelir (CHAR(128) = "€"). Tam Unicode
 * isteyen UNICHAR / UNICODE kullanır. Kod sayfası yerel ayara göre değişebilir (Türkçe kipte
 * 1254); burada en yaygın olan 1252 alınmıştır.
 *
 * AYRAÇLAR. FIXED, DOLLAR ve TEXT'in yedek biçimleyicisi ondalık ayracı '.', binlik ayracı ','
 * ve para simgesi '$' kabul eder. Çalışma kitabının yerel ayarı varsa ctx.ayirac
 * ({ ondalik, binlik }) ve ctx.para ile verilir; TEXT ayrıca ctx.bicim varsa bütün işi ona
 * bırakır (asıl sayı biçimi yorumlayıcısı xlfmt.js'tedir, bu modül ona BAĞIMLI DEĞİLDİR).
 */

import {
  ERR, hata, ilkHata, num, str, bool, metinSayi, mat, duzle, tarihSeri, seriParca, seriSaat,
  kaydetHepsi,
} from './xlfn.js';

// =================================================================================
// Ortak yardımcılar
// =================================================================================

/** Bir hücrenin taşıyabileceği en çok karakter; aşılırsa Excel #VALUE! verir */
const SINIR = 32767;

/** Yayılırken dizinin (i,j) hücresi; tek satırlık / tek sütunluk dizi tekrarlanır */
function hucre(M, i, j) {
  const sat = M.length === 1 ? M[0] : M[i];
  if (!sat) return ERR.NA;
  const v = sat.length === 1 ? sat[0] : sat[j];
  return v === undefined ? ERR.NA : v;
}

/** Dizi yayılımı: argümanlardan biri dizi ise sonuç eleman eleman üretilir (UPPER(A1:A3) taşar) */
function yayN(args, f) {
  if (!args.some(Array.isArray)) return f(args);
  const M = args.map((a) => (Array.isArray(a) ? mat(a) : null));
  let nr = 1, nc = 1;
  for (const m of M) if (m) { nr = Math.max(nr, m.length); nc = Math.max(nc, ...m.map((s) => s.length)); }
  const o = [];
  for (let i = 0; i < nr; i++) {
    const sat = [];
    for (let j = 0; j < nc; j++) sat.push(f(args.map((a, k) => (M[k] ? hucre(M[k], i, j) : a))));
    o.push(sat);
  }
  return o;
}

/** Sayıya çevirip TAM SAYIYA KESER: LEFT("abcdef";2,7) = "ab" — Excel yuvarlamaz, atar */
function tam(v) {
  const n = num(v);
  return hata(n) ? n : Math.trunc(n);
}

/** Seçimlik argüman: hiç verilmemişse varsayılanına düşer (boş verilmişse null kalır) */
const sec = (a, i, vars) => (a.length > i ? a[i] : vars);

/** Sonuç hücreye sığıyor mu? */
const sigar = (s) => (s.length > SINIR ? ERR.VALUE : s);

const ayrac = (ctx) => {
  const a = ctx && ctx.ayirac;
  return { ondalik: (a && a.ondalik) || '.', binlik: a && a.binlik != null ? a.binlik : ',' };
};
const paraSimgesi = (ctx) => (ctx && typeof ctx.para === 'string' ? ctx.para : '$');

/*
 * SABİT HANELİ ONDALIK METİN, yarımı SIFIRDAN UZAĞA yuvarlayarak.
 * toFixed doğrudan kullanılamaz: 1,005 ikilik gösterimde 1,00499999…'dur ve (1.005).toFixed(2)
 * "1.00" verir, Excel ise "1.01". Bu yüzden yuvarlama sayının en kısa ondalık gösterimi
 * üzerinde hane hane yapılır — sonucu güzelleştirmek için değil, ikilik artığı atıp Excel'in
 * ondalık kararına dönmek için.
 */
function sabit(n, hane) {
  if (!isFinite(n) || Math.abs(n) >= 1e21) return String(n);
  const eksi = n < 0;
  let s = Math.abs(n).toString();
  if (s.includes('e')) s = Math.abs(n).toFixed(Math.max(0, Math.min(100, hane + 2)));
  const nokta = s.indexOf('.');
  let t = nokta < 0 ? s : s.slice(0, nokta);
  let o = nokta < 0 ? '' : s.slice(nokta + 1);
  if (o.length > hane) {
    const kesilen = o.charCodeAt(hane);
    o = o.slice(0, hane);
    if (kesilen >= 53) {   // '5' ve üstü: sıfırdan uzağa
      const d = (t + o).split('');
      let i = d.length - 1;
      for (;;) {
        if (i < 0) { d.unshift('1'); break; }
        if (d[i] === '9') { d[i] = '0'; i--; continue; }
        d[i] = String(Number(d[i]) + 1); break;
      }
      const j = d.length - o.length;
      t = d.slice(0, j).join('');
      o = d.slice(j).join('');
    }
  } else o = o.padEnd(hane, '0');
  return (eksi ? '-' : '') + (t || '0') + (hane > 0 ? '.' + o : '');
}

/** Binlik ayracını tam sayı kısmına serpiştirir */
const binlikle = (t, ay) => (ay.binlik ? t.replace(/\B(?=(\d{3})+(?!\d))/g, ay.binlik) : t);

/**
 * FIXED / DOLLAR / TEXT'in ortak sayı biçimleyicisi.
 * Negatif hane ondalık noktanın SOLUNU yuvarlar: FIXED(1234,567;-2) = "1,200".
 */
function sayiBicim(n, hane, binlikVar, ay) {
  if (!isFinite(n)) return ERR.NUM;
  if (hane > 127 || hane < -127) return ERR.VALUE;   // Excel'in kendi sınırı
  let x = n, h = hane;
  if (h < 0) { const p = Math.pow(10, -h); x = Number(sabit(x / p, 0)) * p; h = 0; }
  let s = sabit(x, h);
  const eksi = s.startsWith('-');
  if (eksi) s = s.slice(1);
  const nokta = s.indexOf('.');
  let t = nokta < 0 ? s : s.slice(0, nokta);
  const o = nokta < 0 ? '' : s.slice(nokta + 1);
  if (binlikVar) t = binlikle(t, ay);
  // İşaret, yuvarlama sıfıra indirse bile GİRDİNİN işaretinden gelir: TEXT(-0,4;"0") = "-0".
  return (eksi ? '-' : '') + t + (o ? ay.ondalik + o : '');
}

// =================================================================================
// Birleştirme
// =================================================================================

/*
 * CONCAT ile CONCATENATE'in farkı ARALIK davranışıdır: CONCAT bir aralığı satır önceliğiyle
 * DÜZLER ve hepsini uç uca ekler; CONCATENATE ise dizi argümanını eleman eleman YAYAR
 * (=CONCATENATE(A1:A3;"x") üç hücreye taşar). Eski Excel'de ikincisi örtük kesişim yapardı,
 * dinamik dizilerle birlikte yayılıma döndü.
 */
const birlestir = {
  CONCAT: {
    en: 1, ek: 255,
    fn: (a) => {
      let s = '';
      for (const v of duzle(a)) s += str(v);
      return sigar(s);
    },
  },
  CONCATENATE: {
    en: 1, ek: 255,
    fn: (a) => yayN(a, (x) => {
      let s = '';
      for (const v of x) { const t = str(v); if (hata(t)) return t; s += t; }
      return sigar(s);
    }),
  },
  /*
   * TEXTJOIN(ayraç; boşları_atla; metin1; …). Ayraç bir DİZİ olabilir: o zaman ayraçlar
   * sırayla DÖNÜŞÜMLÜ kullanılır. "Boş", hem boş hücre hem de "" demektir.
   */
  TEXTJOIN: {
    en: 3, ek: 255,
    fn: (a) => {
      const ayraclar = duzle([a[0]]).map((v) => str(v));
      const h = ilkHata(...ayraclar);
      if (h) return h;
      if (!ayraclar.length) ayraclar.push('');
      const bosAtla = bool(a[1]);
      if (hata(bosAtla)) return bosAtla;
      const parca = [];
      for (const v of duzle(a.slice(2))) {
        const t = str(v);
        if (hata(t)) return t;
        if (bosAtla && t === '') continue;
        parca.push(t);
      }
      let s = '';
      for (let i = 0; i < parca.length; i++) {
        if (i) s += ayraclar[(i - 1) % ayraclar.length];
        s += parca[i];
      }
      return sigar(s);
    },
  },
};

// =================================================================================
// Parça alma — LEFT / RIGHT / MID (ve bayt sayan ikizleri)
// =================================================================================

const solGovde = (a) => yayN([a[0], sec(a, 1, 1)], (x) => {
  const s = str(x[0]); if (hata(s)) return s;
  const n = tam(x[1]); if (hata(n)) return n;
  if (n < 0) return ERR.VALUE;
  return s.slice(0, n);
});
const sagGovde = (a) => yayN([a[0], sec(a, 1, 1)], (x) => {
  const s = str(x[0]); if (hata(s)) return s;
  const n = tam(x[1]); if (hata(n)) return n;
  if (n < 0) return ERR.VALUE;
  return n === 0 ? '' : s.slice(Math.max(0, s.length - n));
});
const ortaGovde = (a) => yayN([a[0], a[1], a[2]], (x) => {
  const s = str(x[0]); if (hata(s)) return s;
  const b = tam(x[1]); if (hata(b)) return b;
  const n = tam(x[2]); if (hata(n)) return n;
  if (b < 1 || n < 0) return ERR.VALUE;
  return s.slice(b - 1, b - 1 + n);
});

const parcaAl = {
  LEFT: { en: 1, ek: 2, fn: solGovde },
  LEFTB: { en: 1, ek: 2, fn: solGovde },
  RIGHT: { en: 1, ek: 2, fn: sagGovde },
  RIGHTB: { en: 1, ek: 2, fn: sagGovde },
  MID: { en: 3, ek: 3, fn: ortaGovde },
  MIDB: { en: 3, ek: 3, fn: ortaGovde },
};

// =================================================================================
// Ölçme ve harf düzeni
// =================================================================================

/*
 * 'İ' (U+0130) JS'te küçültülünce İKİ karakter olur: 'i' + birleşen nokta (U+0307). Excel tek
 * karakterlik 'i' yazar, o yüzden önce elle çevrilir.
 */
const kucuk = (s) => s.replace(/İ/g, 'i').toLowerCase();
/*
 * 'ß'nin ANSI'de büyük karşılığı yoktur; Excel onu olduğu gibi bırakır, JS ise "SS" yapar.
 * Bu yüzden ß içermeyen parçalar büyütülür, ß korunur. Yerel ayar burada da devrede DEĞİLDİR:
 * 'i' → 'I' olur, 'İ' olmaz.
 */
const buyuk = (s) => s.replace(/[^ß]+/g, (p) => p.toUpperCase());

/** PROPER: harf OLMAYAN her karakterden sonraki harf büyür — "o'brien" → "O'Brien" */
function ozelAdYap(s) {
  let o = '', oncekiHarf = false;
  for (const c of kucuk(s)) {
    const harfMi = /\p{L}/u.test(c);
    o += harfMi && !oncekiHarf ? buyuk(c) : c;
    oncekiHarf = harfMi;
  }
  return o;
}

const tekMetin = (f) => (a) => yayN([a[0]], (x) => {
  const s = str(x[0]);
  return hata(s) ? s : f(s);
});

const harfDuzeni = {
  LEN: { en: 1, ek: 1, fn: tekMetin((s) => s.length) },
  LENB: { en: 1, ek: 1, fn: tekMetin((s) => s.length) },
  LOWER: { en: 1, ek: 1, fn: tekMetin(kucuk) },
  UPPER: { en: 1, ek: 1, fn: tekMetin(buyuk) },
  PROPER: { en: 1, ek: 1, fn: tekMetin(ozelAdYap) },
  /* TRIM yalnız BOŞLUĞU (U+0020) kırpar ve içteki boşluk dizilerini TEKE indirir. Sekme ve
     satır sonu ona dokunulmaz kalır — onlar CLEAN'in işidir. */
  TRIM: { en: 1, ek: 1, fn: tekMetin((s) => s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')) },
  /* CLEAN yazdırılamayan ilk 32 ASCII denetim karakterini atar; boşluğa dokunmaz. */
  CLEAN: { en: 1, ek: 1, fn: tekMetin((s) => s.replace(/[\x00-\x1f]/g, '')) },
  REPT: {
    en: 2, ek: 2,
    fn: (a) => yayN([a[0], a[1]], (x) => {
      const s = str(x[0]); if (hata(s)) return s;
      const n = tam(x[1]); if (hata(n)) return n;
      if (n < 0) return ERR.VALUE;
      if (s.length * n > SINIR) return ERR.VALUE;
      return s.repeat(n);
    }),
  },
};

// =================================================================================
// Arama ve değiştirme
// =================================================================================

const degistirGovde = (a) => yayN([a[0], a[1], a[2], a[3]], (x) => {
  const s = str(x[0]); if (hata(s)) return s;
  const b = tam(x[1]); if (hata(b)) return b;
  const n = tam(x[2]); if (hata(n)) return n;
  const y = str(x[3]); if (hata(y)) return y;
  if (b < 1 || n < 0) return ERR.VALUE;
  return sigar(s.slice(0, b - 1) + y + s.slice(b - 1 + n));
});

/** SEARCH'ün joker dili: * her şey, ? tek karakter, ~ kaçış. Çapasızdır — konum aranır. */
function jokerParca(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '~') { const n = s[++i]; o += n == null ? '~' : n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else if (c === '*') o += '[\\s\\S]*';
    else if (c === '?') o += '[\\s\\S]';
    else o += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return o;
}

const aramaDegistirme = {
  REPLACE: { en: 4, ek: 4, fn: degistirGovde },
  REPLACEB: { en: 4, ek: 4, fn: degistirGovde },
  /*
   * SUBSTITUTE KONUMA değil METNE bakar (REPLACE'in tersi) ve n'inci geçişi değiştirir;
   * n verilmezse hepsini. Boş eski_metin hiçbir şeyi değiştirmez — sonsuz eklemeyi önler.
   */
  SUBSTITUTE: {
    en: 3, ek: 4,
    fn: (a) => yayN([a[0], a[1], a[2], sec(a, 3, null)], (x) => {
      const s = str(x[0]); if (hata(s)) return s;
      const eski = str(x[1]); if (hata(eski)) return eski;
      const yeni = str(x[2]); if (hata(yeni)) return yeni;
      if (eski === '') return s;
      let kacinci = null;
      if (x[3] != null) { kacinci = tam(x[3]); if (hata(kacinci)) return kacinci; if (kacinci < 1) return ERR.VALUE; }
      let o = '', p = 0, say = 0;
      for (;;) {
        const i = s.indexOf(eski, p);
        if (i < 0) break;
        say++;
        if (kacinci == null || say === kacinci) o += s.slice(p, i) + yeni;
        else o += s.slice(p, i + eski.length);
        p = i + eski.length;
        if (kacinci != null && say === kacinci) break;
      }
      return sigar(o + s.slice(p));
    }),
  },
  /*
   * FIND büyük/küçük harf DUYAR, joker TANIMAZ. Bulamazsa #VALUE! (hiçbir zaman #N/A).
   * Başlangıç konumu 1'den küçük ya da metnin sonundan ötede ise yine #VALUE!.
   */
  FIND: { en: 2, ek: 3, fn: (a) => bulGovde(a, true) },
  FINDB: { en: 2, ek: 3, fn: (a) => bulGovde(a, true) },
  /* SEARCH harf duymaz ve joker tanır — FIND ile tek farkı budur, en sık karıştırılan çift. */
  SEARCH: { en: 2, ek: 3, fn: (a) => bulGovde(a, false) },
  SEARCHB: { en: 2, ek: 3, fn: (a) => bulGovde(a, false) },
  /* EXACT harf duyar; sayıyı metne çevirir: EXACT(1;"1") DOĞRU'dur. */
  EXACT: {
    en: 2, ek: 2,
    fn: (a) => yayN([a[0], a[1]], (x) => {
      const p = str(x[0]); if (hata(p)) return p;
      const q = str(x[1]); if (hata(q)) return q;
      return p === q;
    }),
  },
};

function bulGovde(a, duyar) {
  return yayN([a[0], a[1], sec(a, 2, 1)], (x) => {
    const ara = str(x[0]); if (hata(ara)) return ara;
    const ic = str(x[1]); if (hata(ic)) return ic;
    const b = tam(x[2]); if (hata(b)) return b;
    if (b < 1 || b > ic.length + 1) return ERR.VALUE;
    if (duyar) {
      const i = ic.indexOf(ara, b - 1);
      return i < 0 ? ERR.VALUE : i + 1;
    }
    let re;
    try { re = new RegExp(jokerParca(ara), 'i'); } catch (e) { return ERR.VALUE; }
    const m = re.exec(ic.slice(b - 1));
    return m ? b + m.index : ERR.VALUE;
  });
}

// =================================================================================
// Sayı ile metin arasındaki geçişler
// =================================================================================

/*
 * VALUE, hücreye elle yazıldığında sayı sayılacak her metni sayıya çevirir: düz sayı, yüzde,
 * para simgesi, binlik ayracı, muhasebe parantezi, ISO tarih ve saat. Boş HÜCRE 0'dır ama boş
 * METİN ("") #VALUE! verir; mantık değeri de #VALUE! verir (Excel VALUE(DOĞRU) çevirmez).
 */
function degerCoz(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return ERR.VALUE;
  if (v == null) return 0;
  const s = String(v).trim();
  if (s === '') return ERR.VALUE;
  let n = metinSayi(s);
  if (!isNaN(n)) return n;
  let t = s.replace(/^[$€£¥₺]\s*/, '').replace(/\s*(?:TL|₺)$/i, '').trim();
  let eksi = false;
  if (/^\(.*\)$/.test(t)) { eksi = true; t = t.slice(1, -1).trim(); }   // muhasebe gösterimi: (5) = -5
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?%?$/.test(t)) t = t.replace(/,/g, '');
  n = metinSayi(t);
  if (!isNaN(n)) return eksi ? -n : n;
  const g = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (g) return tarihSeri(+g[1], +g[2], +g[3]);
  const z = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(t);
  if (z) {
    const sa = +z[1], dk = +z[2], sn = z[3] ? +z[3] : 0;
    if (dk < 60 && sn < 60) return (sa * 3600 + dk * 60 + sn) / 86400;
  }
  return ERR.VALUE;
}

/*
 * NUMBERVALUE, VALUE'nun yerel ayardan bağımsız kardeşidir: ondalık ve binlik ayracı ELLE
 * verilir. Kuralları katıdır — ondalık ayracı birden çok kez geçerse ya da binlik ayracı
 * ondalıktan SONRA görünürse #VALUE!. Sondaki her % sonucu 100'e böler ("9%%" = 0,0009).
 * Boşluklar (içtekiler de) atılır; boş metin 0 verir.
 */
function sayiDegeri(t, ond, grp) {
  let s = String(t).replace(/\s/g, '');
  if (s === '') return 0;
  if (ond === grp) return ERR.VALUE;
  let yuzde = 0;
  while (s.endsWith('%')) { yuzde++; s = s.slice(0, -1); }
  const i = s.indexOf(ond);
  if (i >= 0 && s.indexOf(ond, i + 1) >= 0) return ERR.VALUE;
  const tamKisim = i >= 0 ? s.slice(0, i) : s;
  const ondKisim = i >= 0 ? s.slice(i + 1) : '';
  if (grp && ondKisim.includes(grp)) return ERR.VALUE;
  const duz = (grp ? tamKisim.split(grp).join('') : tamKisim) + (ondKisim ? '.' + ondKisim : '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(duz)) return ERR.VALUE;
  let n = Number(duz);
  if (!isFinite(n)) return ERR.NUM;
  for (let q = 0; q < yuzde; q++) n /= 100;
  return n;
}

const ikiHane = (n) => String(n).padStart(2, '0');

/*
 * TEXT'in asıl işi sayı biçimi kodunu yorumlamaktır ve o iş xlfmt.js'e aittir: ctx.bicim
 * varsa bütün karar ona bırakılır. Yoksa AŞAĞIDAKİ KISA LİSTE karşılanır, tanınmayan kod
 * "General" gibi davranır. Yedeğin kapsamı: General · 0 · 0.00 · #,##0 · #,##0.00 · 0% ·
 * 0.00% · gg/aa/yyyy · dd/mm/yyyy · yyyy-mm-dd · ss:dd:ss.
 */
function metinBicim(v, kod, ctx) {
  if (hata(v)) return v;
  if (hata(kod)) return kod;
  // Mantık değeri biçimlenmez, adıyla yazılır: TEXT(DOĞRU;"0") = "TRUE".
  if (typeof v === 'boolean') return str(v);
  if (ctx && typeof ctx.bicim === 'function') {
    const r = ctx.bicim(v, kod);
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object' && typeof r.metin === 'string') return r.metin;
  }
  const K = String(kod).trim().toUpperCase();
  if (K === '') return '';
  if (K === 'GENERAL') return str(v);
  let d = v;
  if (typeof d === 'string') {
    const n = metinSayi(d);
    if (isNaN(n)) return d;   // sayı olmayan metin biçimlenmeden geri döner
    d = n;
  }
  const x = num(d);
  if (hata(x)) return x;
  const ay = ayrac(ctx);
  const yuz = () => Number((x * 100).toPrecision(15));
  switch (K) {
    case '0': return sayiBicim(x, 0, false, ay);
    case '0.00': return sayiBicim(x, 2, false, ay);
    case '#,##0': return sayiBicim(x, 0, true, ay);
    case '#,##0.00': return sayiBicim(x, 2, true, ay);
    case '0%': { const r = sayiBicim(yuz(), 0, false, ay); return hata(r) ? r : r + '%'; }
    case '0.00%': { const r = sayiBicim(yuz(), 2, false, ay); return hata(r) ? r : r + '%'; }
    case 'GG/AA/YYYY': case 'DD/MM/YYYY': { const p = seriParca(x); return ikiHane(p.gun) + '/' + ikiHane(p.ay) + '/' + p.y; }
    case 'YYYY-MM-DD': { const p = seriParca(x); return p.y + '-' + ikiHane(p.ay) + '-' + ikiHane(p.gun); }
    case 'SS:DD:SS': { const s = seriSaat(x); return ikiHane(s.sa) + ':' + ikiHane(s.dk) + ':' + ikiHane(s.sn); }
    default: return str(v);
  }
}

const sayiMetinGecisi = {
  VALUE: { en: 1, ek: 1, fn: (a) => yayN([a[0]], (x) => degerCoz(x[0])) },
  NUMBERVALUE: {
    en: 1, ek: 3,
    fn: (a) => yayN([a[0], sec(a, 1, null), sec(a, 2, null)], (x) => {
      const s = str(x[0]); if (hata(s)) return s;
      const o = x[1] == null ? '.' : String(str(x[1]))[0];
      const g = x[2] == null ? ',' : String(str(x[2]))[0];
      return sayiDegeri(s, o == null ? '.' : o, g == null ? '' : g);
    }),
  },
  /* T metin olmayan her şey için BOŞ METİN verir — sayıyı metne ÇEVİRMEZ. */
  T: { en: 1, ek: 1, fn: (a) => yayN([a[0]], (x) => (typeof x[0] === 'string' ? x[0] : '')) },
  TEXT: { en: 2, ek: 2, fn: (a, ctx) => yayN([a[0], a[1]], (x) => metinBicim(x[0], x[1], ctx)) },
  /* DOLLAR negatifi PARANTEZE alır (muhasebe gösterimi); FIXED eksi işareti kullanır. */
  DOLLAR: {
    en: 1, ek: 2,
    fn: (a, ctx) => yayN([a[0], sec(a, 1, 2)], (x) => {
      const n = num(x[0]); if (hata(n)) return n;
      const h = tam(x[1]); if (hata(h)) return h;
      const g = sayiBicim(Math.abs(n), h, true, ayrac(ctx));
      if (hata(g)) return g;
      const sim = paraSimgesi(ctx);
      return n < 0 ? '(' + sim + g + ')' : sim + g;
    }),
  },
  FIXED: {
    en: 1, ek: 3,
    fn: (a, ctx) => yayN([a[0], sec(a, 1, 2), sec(a, 2, false)], (x) => {
      const n = num(x[0]); if (hata(n)) return n;
      const h = tam(x[1]); if (hata(h)) return h;
      const b = bool(x[2]); if (hata(b)) return b;
      return sayiBicim(n, h, !b, ayrac(ctx));
    }),
  },
};

// =================================================================================
// Karakter kodları
// =================================================================================

/* Windows-1252'nin 128-159 aralığı: ANSI'de burada denetim karakteri değil, işaretler durur. */
const CP1252 = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026, 134: 0x2020, 135: 0x2021,
  136: 0x02c6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017d, 145: 0x2018,
  146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x02dc,
  153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153, 158: 0x017e, 159: 0x0178,
};
const CP1252_TERS = new Map(Object.keys(CP1252).map((k) => [CP1252[k], Number(k)]));

const karakterKodu = {
  CHAR: {
    en: 1, ek: 1,
    fn: (a) => yayN([a[0]], (x) => {
      const n = tam(x[0]); if (hata(n)) return n;
      if (n < 1 || n > 255) return ERR.VALUE;
      return String.fromCharCode(CP1252[n] == null ? n : CP1252[n]);
    }),
  },
  CODE: {
    en: 1, ek: 1,
    fn: (a) => yayN([a[0]], (x) => {
      const s = str(x[0]); if (hata(s)) return s;
      if (s === '') return ERR.VALUE;
      const u = s.charCodeAt(0);
      if (CP1252_TERS.has(u)) return CP1252_TERS.get(u);
      // ANSI'ye sığmayan karakter soru işaretine düşer (Excel de 63 verir).
      return u <= 255 ? u : 63;
    }),
  },
  UNICHAR: {
    en: 1, ek: 1,
    fn: (a) => yayN([a[0]], (x) => {
      const n = tam(x[0]); if (hata(n)) return n;
      if (n < 1 || n > 0x10ffff) return ERR.VALUE;
      if (n >= 0xd800 && n <= 0xdfff) return ERR.NA;   // yarım vekil karakter: Excel #N/A verir
      return String.fromCodePoint(n);
    }),
  },
  UNICODE: {
    en: 1, ek: 1,
    fn: (a) => yayN([a[0]], (x) => {
      const s = str(x[0]); if (hata(s)) return s;
      if (s === '') return ERR.VALUE;
      return s.codePointAt(0);   // vekil çifti tek kod noktası sayılır
    }),
  },
};

// =================================================================================
// Çift baytlı dil işlevleri
// =================================================================================

/*
 * ASC tam genişlikli (çift baytlı) karakterleri yarım genişliğe indirir, JIS / DBCS tersini
 * yapar. Latin harfler, rakamlar, noktalama ve boşluk için eşleme Unicode'un kendisindedir
 * (U+FF01-U+FF5E ile ASCII arasında sabit 0xFEE0 farkı, ideografik boşluk U+3000).
 * Yarım genişlikli KATAKANA tablosu elimizde yoktur; o karakterler DOKUNULMADAN geçer —
 * uydurulmuş bir eşleme yazmaktansa değiştirmemek doğrudur.
 */
const ascYap = (s) => s.replace(/[！-～　]/g, (c) => {
  const u = c.charCodeAt(0);
  return u === 0x3000 ? ' ' : String.fromCharCode(u - 0xfee0);
});
const jisYap = (s) => s.replace(/[\x20-\x7e]/g, (c) => {
  const u = c.charCodeAt(0);
  return u === 0x20 ? '　' : String.fromCharCode(u + 0xfee0);
});

const ciftBayt = {
  ASC: { en: 1, ek: 1, fn: tekMetin(ascYap) },
  JIS: { en: 1, ek: 1, fn: tekMetin(jisYap) },
  DBCS: { en: 1, ek: 1, fn: tekMetin(jisYap) },
  /*
   * PHONETIC bir hücrenin FURIGANA alanını okur. xlsx'te bu alan ayrı bir parçadır (rPh) ve
   * bu motora verilmez; veri olmadığında Excel'in kendisi de metni olduğu gibi döndürür.
   * Aralık verilirse hücreler uç uca eklenir.
   */
  PHONETIC: {
    en: 1, ek: 1,
    fn: (a) => {
      let s = '';
      for (const v of duzle([a[0]])) { const t = str(v); if (hata(t)) return t; s += t; }
      return s;
    },
  },
};

// =================================================================================
// Yeni metin ailesi — TEXTBEFORE / TEXTAFTER / TEXTSPLIT / …TOTEXT / ENCODEURL
// =================================================================================

/** Ayraç argümanı tek metin ya da dizi olabilir; boşlar atılır, UZUN olan önce denenir */
function ayracListesi(v) {
  const o = [];
  for (const x of duzle([v])) {
    if (x == null) continue;
    const s = str(x);
    if (hata(s)) return s;
    if (s !== '') o.push(s);
  }
  return o.sort((p, q) => q.length - p.length);
}

/** Metindeki bütün ayraç geçişleri, soldan sağa ve ÇAKIŞMASIZ: [{ b: başlangıç, s: uzunluk }] */
function gecisler(metin, ayr, duyar) {
  const m = duyar ? metin : metin.toUpperCase();
  const A = duyar ? ayr : ayr.map((x) => x.toUpperCase());
  const o = [];
  let i = 0;
  while (i < m.length) {
    let bulunan = null;
    for (const p of A) if (m.startsWith(p, i)) { bulunan = p; break; }
    if (bulunan) { o.push({ b: i, s: bulunan.length }); i += bulunan.length; }
    else i++;
  }
  return o;
}

/** TEXTSPLIT'in tek boyutlu bölmesi */
function bol(metin, ayr, duyar) {
  if (!ayr.length) return [metin];
  const g = gecisler(metin, ayr, duyar);
  const o = [];
  let p = 0;
  for (const x of g) { o.push(metin.slice(p, x.b)); p = x.b + x.s; }
  o.push(metin.slice(p));
  return o;
}

/*
 * TEXTBEFORE / TEXTAFTER ortak gövdesi.
 *   kacinci < 0  → sondan sayılır (-1 son geçiş)
 *   kacinci = 0  → #VALUE!
 *   sonDa = 1    → METNİN SONU da bir ayraç sayılır; böylece ayraç bulunamasa bile
 *                  TEXTBEFORE metnin tamamını, TEXTAFTER boş metni verir.
 * Bulunamazsa 'yok' argümanı döner; o da verilmemişse #N/A.
 */
function oncesiSonrasi(a, once) {
  const h = ilkHata(a[0], a[1], a[2], a[3], a[4]);
  if (h) return h;
  const metin = str(a[0]); if (hata(metin)) return metin;
  const ayr = ayracListesi(a[1]); if (hata(ayr)) return ayr;
  const kacinci = a.length > 2 && a[2] != null ? tam(a[2]) : 1; if (hata(kacinci)) return kacinci;
  const kip = a.length > 3 && a[3] != null ? tam(a[3]) : 0; if (hata(kip)) return kip;
  const sonDa = a.length > 4 && a[4] != null ? tam(a[4]) : 0; if (hata(sonDa)) return sonDa;
  const yok = a.length > 5 ? a[5] : ERR.NA;
  if (kacinci === 0) return ERR.VALUE;
  if (metin === '') return '';
  const g = gecisler(metin, ayr, kip === 0);
  if (sonDa) g.push({ b: metin.length, s: 0 });
  const i = kacinci > 0 ? kacinci - 1 : g.length + kacinci;
  if (i < 0 || i >= g.length) return yok;
  return once ? metin.slice(0, g[i].b) : metin.slice(g[i].b + g[i].s);
}

/** Dizi değerinin metin karşılığı; KESİN kipte metin tırnaklanır, hata kodu yazıyla geçer */
function ogeMetin(v, kesin) {
  if (hata(v)) return v.e;
  if (v == null) return kesin ? '""' : '';
  if (typeof v === 'string') return kesin ? '"' + v.replace(/"/g, '""') + '"' : v;
  return str(v);
}

const yeniMetin = {
  TEXTBEFORE: { en: 2, ek: 6, hatasiz: true, fn: (a) => oncesiSonrasi(a, true) },
  TEXTAFTER: { en: 2, ek: 6, hatasiz: true, fn: (a) => oncesiSonrasi(a, false) },
  /*
   * TEXTSPLIT(metin; sütun_ayracı; [satır_ayracı]; [boşları_atla]; [eşleme_kipi]; [dolgu]).
   * Önce satır ayracıyla satırlara, sonra sütun ayracıyla hücrelere bölünür; kısa kalan
   * satırlar 'dolgu' ile tamamlanır (varsayılanı #N/A, boş metin değil).
   */
  TEXTSPLIT: {
    en: 2, ek: 6, hatasiz: true,
    fn: (a) => {
      const h = ilkHata(a[0], a[1], a[2], a[3], a[4]);
      if (h) return h;
      const metin = str(a[0]); if (hata(metin)) return metin;
      const sut = ayracListesi(a[1]); if (hata(sut)) return sut;
      const sat = ayracListesi(a.length > 2 ? a[2] : null); if (hata(sat)) return sat;
      const bosAtla = a.length > 3 && a[3] != null ? bool(a[3]) : false; if (hata(bosAtla)) return bosAtla;
      const kip = a.length > 4 && a[4] != null ? tam(a[4]) : 0; if (hata(kip)) return kip;
      const dolgu = a.length > 5 ? a[5] : ERR.NA;
      if (!sut.length && !sat.length) return [[metin]];
      const duyar = kip === 0;
      let satirlar = (sat.length ? bol(metin, sat, duyar) : [metin]).map((s) => bol(s, sut, duyar));
      if (bosAtla) {
        satirlar = satirlar.map((s) => s.filter((c) => c !== '')).filter((s) => s.length);
        if (!satirlar.length) return [['']];
      }
      const en = Math.max(...satirlar.map((s) => s.length));
      return satirlar.map((s) => s.concat(new Array(en - s.length).fill(dolgu)));
    },
  },
  /*
   * ARRAYTOTEXT / VALUETOTEXT bir DEĞERİ metne SERİLEŞTİRİR; bu yüzden hata da yayılmaz,
   * kodu yazıyla görünür. Kip 0 (kısa) okunur listedir, kip 1 (kesin) Excel'in dizi sabiti
   * yazımıdır: {1,2;3,4} — virgül sütunu, noktalı virgül satırı ayırır, metin tırnaklanır.
   */
  ARRAYTOTEXT: {
    en: 1, ek: 2, hatasiz: true,
    fn: (a) => {
      if (hata(a[1])) return a[1];
      const kip = a.length > 1 && a[1] != null ? tam(a[1]) : 0;
      if (hata(kip)) return kip;
      if (kip !== 0 && kip !== 1) return ERR.VALUE;
      const M = mat(a[0]);
      if (kip === 0) return duzle([a[0]]).map((v) => ogeMetin(v, false)).join(', ');
      return '{' + M.map((s) => s.map((v) => ogeMetin(v, true)).join(',')).join(';') + '}';
    },
  },
  VALUETOTEXT: {
    en: 1, ek: 2, hatasiz: true,
    fn: (a) => {
      if (hata(a[1])) return a[1];
      const kip = a.length > 1 && a[1] != null ? tam(a[1]) : 0;
      if (hata(kip)) return kip;
      if (kip !== 0 && kip !== 1) return ERR.VALUE;
      const v = Array.isArray(a[0]) ? duzle([a[0]])[0] : a[0];
      return ogeMetin(v == null ? null : v, kip === 1);
    },
  },
  /*
   * ENCODEURL, UTF-8 yüzde kodlaması yapar. encodeURIComponent'ten farkı: Excel ! ' ( ) *
   * karakterlerini de kodlar, çünkü RFC 3986'nın "alt-delims" kümesini güvenli saymaz.
   */
  ENCODEURL: {
    en: 1, ek: 1,
    fn: tekMetin((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())),
  },
};

// =================================================================================
// Düzenli ifade ailesi (Excel 2024)
// =================================================================================

/*
 * REGEXTEST / REGEXEXTRACT / REGEXREPLACE. Excel'in kendi motoru RE2'dir; JS'in RegExp'i
 * onun üst kümesidir (geri başvuru ve ileri bakış RE2'de yoktur, burada çalışır). Ortak
 * kalıplarda sonuç aynıdır. Geçersiz kalıp #VALUE! verir.
 * Harf duyarlılığı argümanı Excel'de TERS okunur: 0 = DUYARLI (varsayılan), 1 = duyarsız.
 */
function kalipYap(k, duyarsiz, kuresel) {
  try { return new RegExp(k, (duyarsiz ? 'i' : '') + (kuresel ? 'g' : '')); } catch (e) { return ERR.VALUE; }
}

const duzenliIfade = {
  REGEXTEST: {
    en: 2, ek: 3,
    fn: (a) => yayN([a[0], a[1], sec(a, 2, 0)], (x) => {
      const s = str(x[0]); if (hata(s)) return s;
      const k = str(x[1]); if (hata(k)) return k;
      const d = tam(x[2]); if (hata(d)) return d;
      const re = kalipYap(k, d === 1, false);
      return hata(re) ? re : re.test(s);
    }),
  },
  /*
   * kip 0 = ilk eşleşme (metin) · 1 = bütün eşleşmeler (sütun dizisi) · 2 = ilk eşleşmenin
   * yakalama öbekleri (satır dizisi). Hiç eşleşme yoksa #N/A.
   */
  REGEXEXTRACT: {
    en: 2, ek: 4,
    fn: (a) => {
      const s = str(a[0]); if (hata(s)) return s;
      const k = str(a[1]); if (hata(k)) return k;
      const kip = a.length > 2 && a[2] != null ? tam(a[2]) : 0; if (hata(kip)) return kip;
      const d = a.length > 3 && a[3] != null ? tam(a[3]) : 0; if (hata(d)) return d;
      if (kip < 0 || kip > 2) return ERR.VALUE;
      const re = kalipYap(k, d === 1, kip === 1);
      if (hata(re)) return re;
      if (kip === 1) {
        const o = [...s.matchAll(re)].map((m) => [m[0]]);
        return o.length ? o : ERR.NA;
      }
      const m = re.exec(s);
      if (!m) return ERR.NA;
      if (kip === 0) return m[0];
      return m.length > 1 ? [m.slice(1).map((g) => (g === undefined ? '' : g))] : [[m[0]]];
    },
  },
  /* kaçıncı = 0 hepsi (varsayılan), n>0 n'inci, n<0 sondan n'inci */
  REGEXREPLACE: {
    en: 3, ek: 5,
    fn: (a) => {
      const s = str(a[0]); if (hata(s)) return s;
      const k = str(a[1]); if (hata(k)) return k;
      const y = str(a[2]); if (hata(y)) return y;
      const kacinci = a.length > 3 && a[3] != null ? tam(a[3]) : 0; if (hata(kacinci)) return kacinci;
      const d = a.length > 4 && a[4] != null ? tam(a[4]) : 0; if (hata(d)) return d;
      const re = kalipYap(k, d === 1, true);
      if (hata(re)) return re;
      if (kacinci === 0) return sigar(s.replace(re, y));
      const g = [...s.matchAll(re)];
      const i = kacinci > 0 ? kacinci - 1 : g.length + kacinci;
      if (i < 0 || i >= g.length) return s;
      const m = g[i];
      const tek = kalipYap(k, d === 1, false);
      if (hata(tek)) return tek;
      return sigar(s.slice(0, m.index) + m[0].replace(tek, y) + s.slice(m.index + m[0].length));
    },
  },
};

// =================================================================================
// Kayıt
// =================================================================================

kaydetHepsi({
  ...birlestir,
  ...parcaAl,
  ...harfDuzeni,
  ...aramaDegistirme,
  ...sayiMetinGecisi,
  ...karakterKodu,
  ...ciftBayt,
  ...yeniMetin,
  ...duzenliIfade,
});
