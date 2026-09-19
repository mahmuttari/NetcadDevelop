/*
 * EXCEL FORMÜL MOTORU — ARAMA, BAŞVURU ve DİNAMİK DİZİLER
 *
 * KAPSAM. Arama ailesi (VLOOKUP, HLOOKUP, LOOKUP, XLOOKUP, MATCH, XMATCH), başvuru ailesi
 * (INDEX, OFFSET, INDIRECT, ROW, ROWS, COLUMN, COLUMNS, AREAS, ADDRESS, CHOOSE, HYPERLINK,
 * FORMULATEXT) ve dinamik dizi ailesi (UNIQUE, SORT, SORTBY, FILTER, HSTACK, VSTACK, TAKE,
 * DROP, EXPAND, TOROW, TOCOL, WRAPROWS, WRAPCOLS, CHOOSECOLS, CHOOSEROWS).
 * TRANSPOSE ile SEQUENCE bu dosyada DEĞİLDİR: ikisi de matematik modülünün matris bölümünde.
 *
 * ORTAK TUZAK 1 — BAŞVURU DÖNDÜREN İŞLEV İKİ BAĞLAMDA BİRDEN YAŞAR. INDEX, OFFSET ve INDIRECT
 * değer değil BAŞVURU üretir; hem SUM(OFFSET(...)) hem de INDEX(A:A;2):INDEX(A:A;5) çalışmak
 * zorundadır. Çekirdek bir işlevin hangi bağlamda çağrıldığını söylemez, döndürülen tek nesne
 * iki işi de görmelidir. Çözüm: hücre değerleriyle dolu 2 boyutlu DİZİ döndürülür ve o diziye
 * başvuru künyesi (sayfa, r1, c1, r2, c2) GİZLİ alan olarak iliştirilir. Değer bağlamında
 * sıradan bir dizidir (toplanır, karşılaştırılır, yayılır); başvuru bağlamında
 * degerlendirBasvuru 'r1' alanını görüp aynı nesneyi başvuru sayar. Bunun görünür bedeli
 * şudur: tek hücrelik sonuç 1x1 dizi olarak döner. num / str / bool / yay bu diziyi zaten
 * skaler gibi okur, ama gösterim katmanı 1x1 diziyi tek değer saymayı bilmelidir.
 *
 * ORTAK TUZAK 2 — YAKLAŞIK EŞLEŞME VERİNİN SIRALI OLDUĞUNU VARSAYAR. VLOOKUP / HLOOKUP'ın
 * dördüncü argümanı verilmemişse DOĞRU'dur: aranandan küçük ya da eşit olan EN BÜYÜK değer
 * bulunur ve bunun için ikili arama yapılır. Sıralı olmayan veride sonuç Excel'de de yanlıştır;
 * motor bunu "düzeltmeye" kalkmaz, Excel ne veriyorsa onu verir. Karışık türlü sütunlarda
 * yalnız aranan değerle AYNI TÜRDEN hücreler dizinlenir (metin, mantık, boş ve hata hücreleri
 * sayısal aramada atlanır) — yoksa tek bir metin hücresi ikili aramanın sırasını bozardı.
 *
 * ORTAK TUZAK 3 — BOŞ BIRAKILMIŞ ARGÜMAN İKİ TÜRLÜDÜR. Eski işlevlerde virgülle boş bırakılan
 * argüman SIFIR/YANLIŞ'tır: VLOOKUP(x;t;2;) tam eşleşme yapar, MATCH(x;a;) de öyle. Yeni
 * dinamik dizi işlevlerinde (SORT, XLOOKUP, TAKE …) aynı boşluk "verilmedi" demektir ve
 * varsayılana düşer: SORT(a;;-1) birinci sütuna göre azalan sıralar. Bu ayrım Excel'in
 * kendisindendir; burada eski işlevler `eskiMantik` / `eskiTamsayi`, yenileri `sec` kullanır.
 *
 * ORTAK TUZAK 4 — DİNAMİK DİZİDE BOŞ HÜCRE. Excel'in dinamik dizileri boş hücreyi taşıyamaz,
 * SORT / FILTER / UNIQUE çıktısında boş hücre 0 görünür. Motorun değer sözleşmesinde boş ayrı
 * bir türdür (null) ve burada korunur; buna karşılık SIRALAMA karsilastir ile yapıldığı için
 * boş hücre sayılarla 0 gibi, metinlerle "" gibi karşılaştırılır. Sıra Excel'le aynı çıkar,
 * yalnız hücre 0 yerine boş görünür.
 */

import {
  ERR, hata, num, str, bool, mat, duzle, karsilastir, jokerRe, sutunAd,
  ayristir, degerlendir, degerlendirBasvuru, kaydetHepsi,
} from './xlfn.js';

// =================================================================================
// Ortak yardımcılar
// =================================================================================

/** 1x1 diziyi skalere indirir: skaler bekleyen argümanlar (aranan değer, sayı, mantık) için */
const tek = (v) => { if (!Array.isArray(v)) return v; const f = v.flat(); return f.length ? f[0] : null; };
/** Yeni işlevlerin seçimlik argümanı: boş bırakılmışsa varsayılan (bkz. ORTAK TUZAK 3) */
const sec = (v, vars) => (v == null ? vars : v);
/*
 * Eski işlevlerin seçimlik argümanı. VERİLMEMİŞSE varsayılan, virgülle BOŞ BIRAKILMIŞSA
 * 0 / YANLIŞ (bkz. ORTAK TUZAK 3): VLOOKUP(x;t;2;) tam eşleşme yapar. Boşu varsayılana
 * çevirmek bu iki durumu birbirine karıştırırdı.
 */
const eskiMantik = (a, i, vars) => (i >= a.length ? vars : bool(a[i]));
const eskiTamsayi = (a, i, vars) => { if (i >= a.length) return vars; const n = num(tek(a[i])); return hata(n) ? n : Math.trunc(n); };
/** Tam sayıya indirger (Excel kesirli dizini keser); hata olduğu gibi döner */
function tamsayi(v, vars) {
  if (v == null) return vars;
  const n = num(tek(v));
  return hata(n) ? n : Math.trunc(n);
}
/** Mantığa indirger; hata olduğu gibi döner */
const mantik = (v, vars) => (v == null ? vars : bool(v));

const sutunSay = (M) => (M.length ? Math.max(...M.map((s) => s.length)) : 0);
/** Düzensiz (dişli) diziyi dikdörtgene tamamlar: eksik hücre boş sayılır */
function duzelt(M) {
  const nc = Math.max(1, sutunSay(M));
  return (M.length ? M : [[]]).map((s) => Array.from({ length: nc }, (_, j) => (s[j] === undefined ? null : s[j])));
}
const cevir = (M) => (M.length ? M[0].map((_, j) => M.map((s) => (s[j] === undefined ? null : s[j]))) : []);
/** 1x1 sonucu skalere indirir: dinamik dizi işlevleri tek hücreye sığdığında değer döndürür */
const indir = (M) => (M.length === 1 && M[0].length === 1 ? M[0][0] : M);

/** Başvuru künyesi: hem çıplak başvurudan hem de künye iliştirilmiş diziden okunur */
function refBilgi(x) {
  if (!x || typeof x !== 'object' || typeof x.r1 !== 'number') return null;
  return { sayfa: x.sayfa == null ? null : x.sayfa, r1: x.r1, c1: x.c1, r2: x.r2, c2: x.c2 };
}
/** Birleşim (A1:A3;C1:C3) alanları — yalnız AREAS ve INDEX'in alan argümanı için anlamlı */
const alanlar = (x) => (x && typeof x === 'object' && Array.isArray(x.alanlar) ? x.alanlar : null);

/** Diziye başvuru künyesini gizli alan olarak iliştirir (bkz. ORTAK TUZAK 1) */
function refIsaretle(dizi, ref) {
  for (const k of ['sayfa', 'r1', 'c1', 'r2', 'c2']) {
    Object.defineProperty(dizi, k, { value: ref[k], enumerable: false, configurable: true, writable: true });
  }
  return dizi;
}
/** Başvuruyu hücre değerleriyle doldurup künyeli dizi olarak döndürür */
function refDizi(ref, ctx) {
  const say = (ref.r2 - ref.r1 + 1) * (ref.c2 - ref.c1 + 1);
  // Koruma: sınırsız başvuru (ctx.boyut yokken A:A gibi) gerçekleştirilirse arayüz kilitlenir.
  if (say > 2000000) return ERR.NUM;
  const oku = ctx.oku || (() => null);
  const o = [];
  for (let r = ref.r1; r <= ref.r2; r++) {
    const sat = [];
    for (let c = ref.c1; c <= ref.c2; c++) { const v = oku(ref.sayfa, r, c); sat.push(v === undefined ? null : v); }
    o.push(sat);
  }
  return refIsaretle(o, ref);
}
/*
 * Dizi argümanı. Yeniden biçimleyen işlevlerde (SORT, VSTACK, TAKE …) dizinin İÇİNDEKİ hata
 * bir hücre değeridir, sonucu bozmaz; argümanın KENDİSİ hataysa yayılır. Yayma FIRLATARAK
 * yapılır: çekirdeğin cagir'ı gövdeyi try/catch içinde çağırır ve yakaladığı hata nesnesini
 * olduğu gibi döndürür — bu yol tam da bunun için oradadır.
 */
const dizArg = (v) => { if (hata(v)) throw v; return duzelt(mat(v === undefined ? null : v)); };

// =================================================================================
// Arama çekirdeği
// =================================================================================

/* Tür sınıfı: yaklaşık aramada yalnız aynı sınıftan hücreler dizinlenir (bkz. ORTAK TUZAK 2) */
const turSinif = (v) => (v == null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 4);

/** Tam eşleşme: türler de eşleşmeli — MATCH(1;{DOĞRU};0) Excel'de #N/A verir */
function esitMi(v, hedef) {
  // Boş hücre ile boş metin çekirdekte eşittir; MATCH("";A:A;0) ilk boş satırı böyle bulur.
  if (hedef == null || hedef === '') return v == null || v === '';
  if (v == null) return false;
  if (turSinif(v) !== turSinif(hedef)) return false;
  return karsilastir(v, hedef) === 0;
}
/** Ölçüt metninde gerçekten joker var mı? (~* kaçırılmış yıldızdır, joker değildir) */
function jokerli(hedef) {
  if (typeof hedef !== 'string') return null;
  return /[*?]/.test(hedef.replace(/~[*?~]/g, '')) ? jokerRe(hedef) : null;
}
/** Doğrusal tam eşleşme taraması; geri=true sondan başa arar */
function tamAra(liste, hedef, joker, geri) {
  const re = joker ? jokerli(hedef) : null;
  const n = liste.length;
  for (let s = 0; s < n; s++) {
    const i = geri ? n - 1 - s : s;
    const v = liste[i];
    if (re) { if (typeof v === 'string' && re.test(v)) return i; }
    else if (esitMi(v, hedef)) return i;
  }
  return -1;
}
/*
 * İkili arama. yon = +1 artan sıralı liste, -1 azalan sıralı liste.
 * kip = 0 yalnız tam eşleşme · -1 küçük-eşitlerin en büyüğü · +1 büyük-eşitlerin en küçüğü.
 * Yinelenen değerlerde Excel'in seçtiği uç alınır: küçük-eşit ararken SON, büyük-eşit ararken
 * İLK eşleşme.
 */
function ikiliAra(liste, hedef, yon, kip) {
  const s = turSinif(hedef);
  let ix = [];
  for (let i = 0; i < liste.length; i++) if (turSinif(liste[i]) === s) ix.push(i);
  if (yon < 0) ix = ix.reverse();
  let lo = 0, hi = ix.length - 1, alt = -1, ust = -1, esit = -1;
  while (lo <= hi) {
    const o = (lo + hi) >> 1;
    const c = karsilastir(liste[ix[o]], hedef);
    if (c === 0) { esit = o; if (kip > 0) hi = o - 1; else lo = o + 1; continue; }
    if (c < 0) { alt = o; lo = o + 1; } else { ust = o; hi = o - 1; }
  }
  if (esit >= 0) return ix[esit];
  if (kip < 0) return alt < 0 ? -1 : ix[alt];
  if (kip > 0) return ust < 0 ? -1 : ix[ust];
  return -1;
}
/** Sırasız listede en iyi yaklaşık: kip -1 küçük-eşitlerin en büyüğü, +1 büyük-eşitlerin en küçüğü */
function enIyiAra(liste, hedef, kip, geri) {
  const s = turSinif(hedef);
  const n = liste.length;
  let iyi = -1;
  for (let a = 0; a < n; a++) {
    const i = geri ? n - 1 - a : a;
    const v = liste[i];
    if (turSinif(v) !== s) continue;
    const c = karsilastir(v, hedef);
    if (kip < 0 ? c > 0 : c < 0) continue;
    if (iyi < 0) { iyi = i; continue; }
    const d = karsilastir(v, liste[iyi]);
    if (kip < 0 ? d > 0 : d < 0) iyi = i;
  }
  return iyi;
}
/** XLOOKUP / XMATCH ortak arayıcısı: eşleşme kipi ile arama kipi AYRI argümanlardır */
function xAra(liste, hedef, kip, arama) {
  const ikili = arama === 2 || arama === -2;
  if (kip === 2) return tamAra(liste, hedef, true, arama === -1);
  if (kip === 0) return ikili ? ikiliAra(liste, hedef, arama > 0 ? 1 : -1, 0) : tamAra(liste, hedef, false, arama === -1);
  if (ikili) return ikiliAra(liste, hedef, arama > 0 ? 1 : -1, kip);
  return enIyiAra(liste, hedef, kip, arama === -1);
}

// =================================================================================
// İşlevler
// =================================================================================
kaydetHepsi({

  // -------------------------------------------------------------------------------
  // Arama
  // -------------------------------------------------------------------------------
  VLOOKUP: {
    en: 3, ek: 4,
    fn: (a) => {
      const hedef = tek(a[0]);
      const T = duzelt(mat(a[1] === undefined ? null : a[1]));
      const sut = tamsayi(a[2], 1); if (hata(sut)) return sut;
      if (sut < 1) return ERR.VALUE;
      if (sut > T[0].length) return ERR.REF;
      const yak = eskiMantik(a, 3, true); if (hata(yak)) return yak;
      const ilk = T.map((s) => s[0]);
      // Tam eşleşme JOKER tanır; yaklaşık eşleşme tanımaz (arananın kendisi sınır değeridir).
      const i = yak ? ikiliAra(ilk, hedef == null ? 0 : hedef, 1, -1) : tamAra(ilk, hedef, true, false);
      return i < 0 ? ERR.NA : T[i][sut - 1];
    },
  },

  HLOOKUP: {
    en: 3, ek: 4,
    fn: (a) => {
      const hedef = tek(a[0]);
      const T = duzelt(mat(a[1] === undefined ? null : a[1]));
      const sat = tamsayi(a[2], 1); if (hata(sat)) return sat;
      if (sat < 1) return ERR.VALUE;
      if (sat > T.length) return ERR.REF;
      const yak = eskiMantik(a, 3, true); if (hata(yak)) return yak;
      const i = yak ? ikiliAra(T[0], hedef == null ? 0 : hedef, 1, -1) : tamAra(T[0], hedef, true, false);
      return i < 0 ? ERR.NA : T[sat - 1][i];
    },
  },

  /*
   * LOOKUP hata YAYMAZ (hatasiz: true). Bunun nedeni ünlü LOOKUP(2;1/(koşul);sonuç) kalıbıdır:
   * 1/(YANLIŞ) = #DIV/0! olduğu için arama vektörü hatalarla doludur ve Excel bunları sessizce
   * atlar. Hata yayılsaydı kalıp hiç çalışmazdı. Aranan DEĞERİN kendisi hataysa yine yayılır.
   */
  LOOKUP: {
    en: 2, ek: 3, hatasiz: true,
    fn: (a) => {
      if (hata(a[0])) return a[0];
      const h = tek(a[0]);
      const hedef = h == null ? 0 : h;
      if (a.length >= 3) {
        const vek = duzle([a[1]]), son = duzle([a[2]]);
        const i = ikiliAra(vek, hedef, 1, -1);
        if (i < 0) return ERR.NA;
        return i < son.length ? son[i] : ERR.NA;
      }
      const M = duzelt(mat(a[1] === undefined ? null : a[1]));
      const nc = M[0].length;
      // Dizi biçimi: dizi ENİNDEN uzunsa ilk SATIRDA aranır ve SON SATIR döner; değilse sütun.
      if (nc > M.length) {
        const i = ikiliAra(M[0], hedef, 1, -1);
        return i < 0 ? ERR.NA : M[M.length - 1][i];
      }
      const i = ikiliAra(M.map((s) => s[0]), hedef, 1, -1);
      return i < 0 ? ERR.NA : M[i][nc - 1];
    },
  },

  XLOOKUP: {
    en: 3, ek: 6,
    fn: (a) => {
      const hedef = tek(a[0]);
      const A = duzelt(mat(a[1] === undefined ? null : a[1]));
      const D = duzelt(mat(a[2] === undefined ? null : a[2]));
      const kip = tamsayi(sec(a[4], null), 0); if (hata(kip)) return kip;
      const arama = tamsayi(sec(a[5], null), 1); if (hata(arama)) return arama;
      if (![0, -1, 1, 2].includes(kip) || ![1, -1, 2, -2].includes(arama)) return ERR.VALUE;
      const yatay = A.length === 1 && A[0].length > 1;
      const liste = duzle([A]);
      if ((yatay ? D[0].length : D.length) !== liste.length) return ERR.VALUE;
      const i = xAra(liste, hedef, kip, arama);
      if (i < 0) return a.length >= 4 ? a[3] : ERR.NA;
      // Dikey aramada eşleşen SATIRIN tamamı, yatay aramada eşleşen SÜTUNUN tamamı döner.
      return indir(yatay ? D.map((s) => [s[i]]) : [D[i]]);
    },
  },

  MATCH: {
    en: 2, ek: 3,
    fn: (a) => {
      const hedef = tek(a[0]);
      const liste = duzle([a[1]]);
      const t = eskiTamsayi(a, 2, 1); if (hata(t)) return t;
      const i = t === 0 ? tamAra(liste, hedef, true, false)
        : ikiliAra(liste, hedef == null ? 0 : hedef, t > 0 ? 1 : -1, t > 0 ? -1 : 1);
      return i < 0 ? ERR.NA : i + 1;
    },
  },

  XMATCH: {
    en: 2, ek: 4,
    fn: (a) => {
      const hedef = tek(a[0]);
      const liste = duzle([a[1]]);
      const kip = tamsayi(sec(a[2], null), 0); if (hata(kip)) return kip;
      const arama = tamsayi(sec(a[3], null), 1); if (hata(arama)) return arama;
      if (![0, -1, 1, 2].includes(kip) || ![1, -1, 2, -2].includes(arama)) return ERR.VALUE;
      const i = xAra(liste, hedef, kip, arama);
      return i < 0 ? ERR.NA : i + 1;
    },
  },

  // -------------------------------------------------------------------------------
  // Başvuru
  // -------------------------------------------------------------------------------
  INDEX: {
    en: 2, ek: 4, bas: [0], basDon: true,
    fn: (a, ctx) => {
      if (hata(a[0])) return a[0];
      let kaynak = a[0];
      const al = alanlar(kaynak);
      if (al) {
        const an = tamsayi(sec(a[3], null), 1); if (hata(an)) return an;
        if (an < 1 || an > al.length) return ERR.REF;
        kaynak = al[an - 1];
      } else if (a.length >= 4 && a[3] != null) {
        const an = tamsayi(a[3], 1); if (hata(an)) return an;
        if (an !== 1) return ERR.REF;   // tek alanlı başvuruda yalnız 1. alan vardır
      }
      const ref = refBilgi(kaynak);
      const M = ref ? null : duzelt(mat(kaynak === undefined ? null : kaynak));
      const nr = ref ? ref.r2 - ref.r1 + 1 : M.length;
      const nc = ref ? ref.c2 - ref.c1 + 1 : M[0].length;
      let sr = tamsayi(sec(a[1], null), 0); if (hata(sr)) return sr;
      let sc = tamsayi(sec(a[2], null), 0); if (hata(sc)) return sc;
      // Tek satırlık kaynakta ikinci dizin atlanabilir: INDEX({1,2,3};2) üçüncü değil İKİNCİ
      // sütunu verir — verilen tek dizin var olan boyuta uygulanır.
      if (a.length < 3 && nr === 1 && nc > 1) { sc = sr; sr = 0; }
      if (sr < 0 || sc < 0) return ERR.VALUE;
      if (sr > nr || sc > nc) return ERR.REF;
      // Satır ya da sütun 0 ise o boyutun TAMAMI döner: INDEX(A1:C3;0;2) B sütununun tamamıdır.
      if (ref) {
        const r1 = sr === 0 ? ref.r1 : ref.r1 + sr - 1;
        const c1 = sc === 0 ? ref.c1 : ref.c1 + sc - 1;
        return refDizi({ sayfa: ref.sayfa, r1, c1, r2: sr === 0 ? ref.r2 : r1, c2: sc === 0 ? ref.c2 : c1 }, ctx);
      }
      const sat = sr === 0 ? M.map((_, i) => i) : [sr - 1];
      const sut = sc === 0 ? M[0].map((_, j) => j) : [sc - 1];
      return indir(sat.map((i) => sut.map((j) => M[i][j])));
    },
  },

  OFFSET: {
    en: 3, ek: 5, bas: [0], basDon: true,
    fn: (a, ctx) => {
      if (hata(a[0])) return a[0];
      const ref = refBilgi(a[0]);
      if (!ref) return ERR.VALUE;   // OFFSET yalnız BAŞVURU kaydırır; dizi sabiti kaydırılamaz
      const dr = tamsayi(sec(a[1], null), 0); if (hata(dr)) return dr;
      const dc = tamsayi(sec(a[2], null), 0); if (hata(dc)) return dc;
      const h = tamsayi(sec(a[3], null), ref.r2 - ref.r1 + 1); if (hata(h)) return h;
      const w = tamsayi(sec(a[4], null), ref.c2 - ref.c1 + 1); if (hata(w)) return w;
      if (h === 0 || w === 0) return ERR.REF;
      // Yükseklik/genişlik NEGATİF olabilir: pencere çıpadan yukarı / sola doğru açılır.
      const r1 = ref.r1 + dr + (h < 0 ? h + 1 : 0), r2 = r1 + Math.abs(h) - 1;
      const c1 = ref.c1 + dc + (w < 0 ? w + 1 : 0), c2 = c1 + Math.abs(w) - 1;
      if (r1 < 0 || c1 < 0) return ERR.REF;   // sayfanın dışına taşan pencere yoktur
      return refDizi({ sayfa: ref.sayfa, r1, c1, r2, c2 }, ctx);
    },
  },

  INDIRECT: {
    en: 1, ek: 2, basDon: true,
    fn: (a, ctx) => {
      const t = str(tek(a[0])); if (hata(t)) return t;
      const a1 = mantik(sec(a[1], null), true); if (hata(a1)) return a1;
      const ref = a1 ? a1Coz(t, ctx) : r1c1Coz(t, ctx);
      if (!ref) return ERR.REF;
      return refDizi(ref, ctx);
    },
  },

  ROW: {
    en: 0, ek: 1, bas: [0],
    fn: (a, ctx) => {
      if (!a.length || a[0] == null) return ctx.hucre ? ctx.hucre.r + 1 : ERR.REF;
      if (hata(a[0])) return a[0];
      const al = alanlar(a[0]);
      const ref = refBilgi(al ? al[0] : a[0]);
      if (!ref) return ERR.VALUE;
      // Çok satırlı başvuruda ROW bir DİZİ verir: ROW(A1:A3) = {1;2;3}
      if (ref.r1 === ref.r2) return ref.r1 + 1;
      const o = [];
      for (let r = ref.r1; r <= ref.r2; r++) o.push([r + 1]);
      return o;
    },
  },

  COLUMN: {
    en: 0, ek: 1, bas: [0],
    fn: (a, ctx) => {
      if (!a.length || a[0] == null) return ctx.hucre ? ctx.hucre.c + 1 : ERR.REF;
      if (hata(a[0])) return a[0];
      const al = alanlar(a[0]);
      const ref = refBilgi(al ? al[0] : a[0]);
      if (!ref) return ERR.VALUE;
      if (ref.c1 === ref.c2) return ref.c1 + 1;
      const o = [];
      for (let c = ref.c1; c <= ref.c2; c++) o.push(c + 1);
      return [o];
    },
  },

  ROWS: {
    en: 1, ek: 1, bas: [0],
    fn: (a) => {
      if (hata(a[0])) return a[0];
      if (alanlar(a[0])) return ERR.REF;
      const ref = Array.isArray(a[0]) ? null : refBilgi(a[0]);
      if (ref) return ref.r2 - ref.r1 + 1;
      return dizArg(a[0]).length;
    },
  },

  COLUMNS: {
    en: 1, ek: 1, bas: [0],
    fn: (a) => {
      if (hata(a[0])) return a[0];
      if (alanlar(a[0])) return ERR.REF;
      const ref = Array.isArray(a[0]) ? null : refBilgi(a[0]);
      if (ref) return ref.c2 - ref.c1 + 1;
      return dizArg(a[0])[0].length;
    },
  },

  /*
   * CHOOSE tembeldir (ham: true): yalnız seçilen argüman değerlendirilir, bu yüzden
   * CHOOSE(1;5;1/0) #DIV/0! vermez. Başvuru DÖNDÜRMEZ; seçilen aralık değer dizisi olarak
   * çözülür — SUM(CHOOSE(2;A1:A3;B1:B3)) yine çalışır, ama CHOOSE(...):CHOOSE(...) çalışmaz.
   */
  CHOOSE: {
    en: 2, ek: -1, ham: true,
    fn: (a, ctx) => {
      const iv = degerlendir(a[0], ctx);
      if (hata(iv)) return iv;
      const n = num(tek(iv)); if (hata(n)) return n;
      const i = Math.trunc(n);
      if (i < 1 || i > a.length - 1) return ERR.VALUE;
      return degerlendir(a[i], ctx);
    },
  },

  CHOOSECOLS: {
    en: 2, ek: -1, hatasiz: true,
    fn: (a) => secDizin(a, false),
  },

  CHOOSEROWS: {
    en: 2, ek: -1, hatasiz: true,
    fn: (a) => secDizin(a, true),
  },

  AREAS: {
    en: 1, ek: 1, bas: [0],
    fn: (a) => {
      if (hata(a[0])) return a[0];
      const al = alanlar(a[0]);
      if (al) return al.length;
      return refBilgi(a[0]) ? 1 : ERR.VALUE;
    },
  },

  ADDRESS: {
    en: 2, ek: 5,
    fn: (a) => {
      const r = tamsayi(a[0], 1); if (hata(r)) return r;
      const c = tamsayi(a[1], 1); if (hata(c)) return c;
      const m = tamsayi(sec(a[2], null), 1); if (hata(m)) return m;
      const a1 = mantik(sec(a[3], null), true); if (hata(a1)) return a1;
      if (m < 1 || m > 4) return ERR.VALUE;
      const satMutlak = m === 1 || m === 2, sutMutlak = m === 1 || m === 3;
      let adres;
      if (a1) {
        if (r < 1 || c < 1 || r > 1048576 || c > 16384) return ERR.VALUE;
        adres = (sutMutlak ? '$' : '') + sutunAd(c - 1) + (satMutlak ? '$' : '') + r;
      } else {
        if ((satMutlak && r < 1) || (sutMutlak && c < 1)) return ERR.VALUE;
        // R1C1'de göreli bileşen KÖŞELİ AYRAÇ içinde yazılır: R[-2]C[3] "iki yukarı, üç sağa".
        adres = 'R' + (satMutlak ? r : '[' + r + ']') + 'C' + (sutMutlak ? c : '[' + c + ']');
      }
      if (a.length < 5 || a[4] == null) return adres;
      const s = str(tek(a[4])); if (hata(s)) return s;
      return (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) ? s : "'" + s.replace(/'/g, "''") + "'") + '!' + adres;
    },
  },

  /** HYPERLINK hesap tablosunda köprü kurar; DEĞER olarak görünen ad, o da yoksa adrestir. */
  HYPERLINK: {
    en: 1, ek: 2,
    fn: (a) => (a.length >= 2 ? tek(a[1]) : str(tek(a[0]))),
  },

  FORMULATEXT: {
    en: 1, ek: 1, bas: [0],
    fn: (a, ctx) => {
      if (hata(a[0])) return a[0];
      const al = alanlar(a[0]);
      const ref = refBilgi(al ? al[0] : a[0]);
      if (!ref) return ERR.VALUE;
      if (!ctx.formul) return ERR.NA;
      // Çok hücreli başvuruda SOL ÜST hücrenin formülü okunur.
      const f = ctx.formul(ref.sayfa, ref.r1, ref.c1);
      if (f == null || f === '') return ERR.NA;   // formülü olmayan hücre #N/A verir
      return String(f).startsWith('=') ? String(f) : '=' + String(f);
    },
  },

  // -------------------------------------------------------------------------------
  // Dinamik diziler
  // -------------------------------------------------------------------------------
  UNIQUE: {
    en: 1, ek: 3, hatasiz: true,
    fn: (a) => {
      const M = dizArg(a[0]);
      const sutunca = mantik(sec(a[1], null), false); if (hata(sutunca)) return sutunca;
      const birKez = mantik(sec(a[2], null), false); if (hata(birKez)) return birKez;
      const T = sutunca ? cevir(M) : M;
      const anah = T.map((s) => s.map(anahtar).join('\u0001'));
      const say = new Map();
      for (const k of anah) say.set(k, (say.get(k) || 0) + 1);
      const gorulen = new Set(), o = [];
      T.forEach((s, i) => {
        if (gorulen.has(anah[i])) return;
        gorulen.add(anah[i]);
        if (birKez && say.get(anah[i]) !== 1) return;
        o.push(s);
      });
      if (!o.length) return ERR.CALC;   // tek satır bile kalmayan sonuç hücreye yazılamaz
      return sutunca ? cevir(o) : o;
    },
  },

  SORT: {
    en: 1, ek: 4, hatasiz: true,
    fn: (a) => {
      const M = dizArg(a[0]);
      const si = tamsayi(sec(a[1], null), 1); if (hata(si)) return si;
      const yon = tamsayi(sec(a[2], null), 1); if (hata(yon)) return yon;
      const sutunca = mantik(sec(a[3], null), false); if (hata(sutunca)) return sutunca;
      if (yon !== 1 && yon !== -1) return ERR.VALUE;
      // by_col DOĞRU iken sıralanan şey SÜTUNLARdır: devrik alınıp aynı satır sıralaması koşar.
      const T = sutunca ? cevir(M) : M;
      if (si < 1 || si > T[0].length) return ERR.VALUE;
      const ix = T.map((_, i) => i);
      ix.sort((p, q) => { const c = karsilastir(T[p][si - 1], T[q][si - 1]); return c !== 0 ? c * yon : p - q; });
      const o = ix.map((i) => T[i]);
      return sutunca ? cevir(o) : o;
    },
  },

  SORTBY: {
    en: 2, ek: -1, hatasiz: true,
    fn: (a) => {
      const M = dizArg(a[0]);
      const B0 = dizArg(a[1]);
      // Ölçüt vektörü SATIR ise sıralanan şey sütunlardır; SÜTUN ise satırlar.
      const sutunca = B0.length === 1 && B0[0].length > 1;
      const T = sutunca ? cevir(M) : M;
      const anahtarlar = [];
      for (let i = 1; i < a.length; i += 2) {
        const B = duzle([a[i]]);
        if (B.length !== T.length) return ERR.VALUE;
        const yon = tamsayi(sec(a[i + 1], null), 1); if (hata(yon)) return yon;
        if (yon !== 1 && yon !== -1) return ERR.VALUE;
        anahtarlar.push({ v: B, yon });
      }
      const ix = T.map((_, i) => i);
      ix.sort((p, q) => {
        for (const k of anahtarlar) { const c = karsilastir(k.v[p], k.v[q]); if (c !== 0) return c * k.yon; }
        return p - q;   // eşit anahtarlarda özgün sıra korunur (kararlı sıralama)
      });
      const o = ix.map((i) => T[i]);
      return sutunca ? cevir(o) : o;
    },
  },

  FILTER: {
    en: 2, ek: 3, hatasiz: true,
    fn: (a) => {
      const M = dizArg(a[0]);
      const K = dizArg(a[1]);
      const nr = M.length, nc = M[0].length;
      let sutunca;
      if (K[0].length === 1 && K.length === nr) sutunca = false;
      else if (K.length === 1 && K[0].length === nc) sutunca = true;
      else return ERR.VALUE;   // süzgeç vektörü dizinin bir kenarıyla aynı boyda olmalı
      const bayrak = [];
      for (const v of duzle([K])) {
        if (hata(v)) return v;
        if (typeof v === 'string') return ERR.VALUE;   // metin süzgeç ölçütü olamaz
        bayrak.push(v == null ? false : typeof v === 'number' ? v !== 0 : !!v);
      }
      const T = sutunca ? cevir(M) : M;
      const o = T.filter((_, i) => bayrak[i]);
      if (!o.length) return a.length >= 3 ? a[2] : ERR.CALC;
      return sutunca ? cevir(o) : o;
    },
  },

  HSTACK: {
    en: 1, ek: -1, hatasiz: true,
    fn: (a) => {
      const ms = a.map(dizArg);
      const nr = Math.max(...ms.map((m) => m.length));
      const o = Array.from({ length: nr }, () => []);
      // Kısa kalan parça #N/A ile doldurulur: boşla değil, çünkü orada hiç hücre yoktur.
      for (const m of ms) for (let i = 0; i < nr; i++) for (let j = 0; j < m[0].length; j++) o[i].push(i < m.length ? m[i][j] : ERR.NA);
      return indir(o);
    },
  },

  VSTACK: {
    en: 1, ek: -1, hatasiz: true,
    fn: (a) => {
      const ms = a.map(dizArg);
      const nc = Math.max(...ms.map((m) => m[0].length));
      const o = [];
      for (const m of ms) for (const s of m) o.push(Array.from({ length: nc }, (_, j) => (j < s.length ? s[j] : ERR.NA)));
      return indir(o);
    },
  },

  TAKE: {
    en: 2, ek: 3, hatasiz: true,
    fn: (a) => {
      const M = dizArg(a[0]);
      const sr = tamsayi(sec(a[1], null), null); if (hata(sr)) return sr;
      const sc = tamsayi(sec(a[2], null), null); if (hata(sc)) return sc;
      if (sr === 0 || sc === 0) return ERR.CALC;
      const S = sr == null ? M : (sr > 0 ? M.slice(0, sr) : M.slice(Math.max(0, M.length + sr)));
      const o = S.map((s) => (sc == null ? s : (sc > 0 ? s.slice(0, sc) : s.slice(Math.max(0, s.length + sc)))));
      if (!o.length || !o[0].length) return ERR.CALC;
      return indir(o);
    },
  },

  DROP: {
    en: 2, ek: 3, hatasiz: true,
    fn: (a) => {
      const M = dizArg(a[0]);
      const sr = tamsayi(sec(a[1], null), 0); if (hata(sr)) return sr;
      const sc = tamsayi(sec(a[2], null), 0); if (hata(sc)) return sc;
      const S = sr >= 0 ? M.slice(sr) : M.slice(0, Math.max(0, M.length + sr));
      const o = S.map((s) => (sc >= 0 ? s.slice(sc) : s.slice(0, Math.max(0, s.length + sc))));
      if (!o.length || !o[0].length) return ERR.CALC;   // her şeyi atmak boş dizi bırakır
      return indir(o);
    },
  },

  EXPAND: {
    en: 2, ek: 4, hatasiz: true,
    fn: (a) => {
      const M = dizArg(a[0]);
      const nr = tamsayi(sec(a[1], null), M.length); if (hata(nr)) return nr;
      const nc = tamsayi(sec(a[2], null), M[0].length); if (hata(nc)) return nc;
      const dolgu = a.length >= 4 ? a[3] : ERR.NA;   // varsayılan dolgu #N/A'dir, boş değil
      if (nr < M.length || nc < M[0].length) return ERR.VALUE;   // EXPAND küçültmez
      if (nr < 1 || nc < 1) return ERR.VALUE;
      const o = [];
      for (let i = 0; i < nr; i++) o.push(Array.from({ length: nc }, (_, j) => (i < M.length && j < M[0].length ? M[i][j] : dolgu)));
      return indir(o);
    },
  },

  TOROW: {
    en: 1, ek: 3, hatasiz: true,
    fn: (a) => { const v = tekSira(a); return hata(v) ? v : [v]; },
  },

  TOCOL: {
    en: 1, ek: 3, hatasiz: true,
    fn: (a) => { const v = tekSira(a); return hata(v) ? v : v.map((x) => [x]); },
  },

  WRAPROWS: {
    en: 2, ek: 3, hatasiz: true,
    fn: (a) => sarmala(a, false),
  },

  WRAPCOLS: {
    en: 2, ek: 3, hatasiz: true,
    fn: (a) => sarmala(a, true),
  },

});

// =================================================================================
// İşlev gövdelerinin paylaştığı yardımcılar
// =================================================================================

/** UNIQUE'in eşitlik anahtarı. Metinde büyük/küçük harf ayrımı YOKTUR (Excel karşılaştırması
 *  harf duymaz), boş hücre ile 0 aynı sayılır (Excel dinamik dizide boşu 0 yapar). */
function anahtar(v) {
  if (hata(v)) return 'h' + v.e;
  if (v == null) return 'n0';
  if (typeof v === 'number') return 'n' + v;
  if (typeof v === 'boolean') return 'm' + v;
  return 's' + String(v).toUpperCase();
}

/** CHOOSECOLS / CHOOSEROWS ortak gövdesi: negatif dizin SONDAN sayar, sıfır ve taşma #VALUE! */
function secDizin(a, satirMi) {
  const M = dizArg(a[0]);
  const T = satirMi ? M : cevir(M);
  const n = T.length;
  const dizin = [];
  for (const v of duzle(a.slice(1))) {
    if (hata(v)) return v;
    if (v == null) continue;   // boş bırakılmış dizin atlanır
    const x = num(v); if (hata(x)) return x;
    let i = Math.trunc(x);
    if (i < 0) i = n + i + 1;
    if (i < 1 || i > n) return ERR.VALUE;
    dizin.push(i);
  }
  if (!dizin.length) return ERR.VALUE;
  const o = dizin.map((i) => T[i - 1]);
  return indir(satirMi ? o : cevir(o));
}

/** TOROW / TOCOL ortak gövdesi: taranan sıra ile atlama kuralı */
function tekSira(a) {
  const M = dizArg(a[0]);
  const atla = tamsayi(sec(a[1], null), 0); if (hata(atla)) return atla;
  const sutunca = mantik(sec(a[2], null), false); if (hata(sutunca)) return sutunca;
  if (atla < 0 || atla > 3) return ERR.VALUE;
  const T = sutunca ? cevir(M) : M;   // tarama varsayılanı SATIR SATIR, sütunca ise sütun sütun
  const o = [];
  for (const s of T) for (const v of s) {
    if ((atla === 1 || atla === 3) && v == null) continue;
    if ((atla === 2 || atla === 3) && hata(v)) continue;
    o.push(v);
  }
  return o.length ? o : ERR.CALC;
}

/** WRAPROWS / WRAPCOLS ortak gövdesi */
function sarmala(a, sutunca) {
  const M = dizArg(a[0]);
  if (M.length > 1 && M[0].length > 1) return ERR.VALUE;   // yalnız tek sıralı vektör sarılır
  const say = tamsayi(a[1], 1); if (hata(say)) return say;
  if (say < 1) return ERR.NUM;
  const dolgu = a.length >= 3 ? a[2] : ERR.NA;
  const v = duzle([M]);
  const k = Math.ceil(v.length / say);
  const o = [];
  for (let i = 0; i < k; i++) o.push(Array.from({ length: say }, (_, j) => (i * say + j < v.length ? v[i * say + j] : dolgu)));
  // WRAPCOLS aynı bölmeyi SÜTUN yönünde yapar: devrik almak yeterlidir.
  return indir(sutunca ? cevir(o) : o);
}

/** INDIRECT'in A1 yazımı: çekirdeğin ayrıştırıcısı kullanılır ($, sayfa adı, aralık hepsi orada */
function a1Coz(t, ctx) {
  const s = String(t).trim();
  if (!s || s.startsWith('=')) return null;
  let d;
  try { d = ayristir(s); } catch (e) { return null; }
  // Yalnız başvuru dilbilgisi kabul edilir: INDIRECT("SUM(A1)") bir başvuru değildir.
  if (!saltBasvuru(d)) return null;
  const r = degerlendirBasvuru(d, ctx);
  return r && typeof r.r1 === 'number' ? r : null;
}
function saltBasvuru(d) {
  if (!d) return false;
  if (d.t === 'ref' || d.t === 'name') return true;
  if (d.t === 'par') return saltBasvuru(d.v);
  if (d.t === 'iki' && (d.op === ':' || d.op === ' ')) return saltBasvuru(d.l) && saltBasvuru(d.r);
  return false;
}

const R1C1_RE = /^R(?:\[(-?\d+)\]|(\d+))?C(?:\[(-?\d+)\]|(\d+))?$/i;
/** INDIRECT'in R1C1 yazımı: R2C3 mutlak, R[-1]C[2] geçerli hücreye göre göreli, R ile C yalnız
 *  başına "aynı satır / aynı sütun" demektir. */
function r1c1Coz(t, ctx) {
  let s = String(t).trim();
  let sayfa = null;
  const u = s.lastIndexOf('!');
  if (u >= 0) {
    sayfa = s.slice(0, u).replace(/^'|'$/g, '').replace(/''/g, "'");
    s = s.slice(u + 1);
  }
  const par = s.split(':');
  if (par.length > 2) return null;
  const a = r1c1Tek(par[0], ctx);
  if (!a) return null;
  const b = par.length === 2 ? r1c1Tek(par[1], ctx) : a;
  if (!b) return null;
  return {
    sayfa: sayfa == null ? (ctx.sayfa || null) : sayfa,
    r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c),
  };
}
function r1c1Tek(s, ctx) {
  const m = R1C1_RE.exec(String(s).trim());
  if (!m) return null;
  const hr = ctx.hucre ? ctx.hucre.r : 0, hc = ctx.hucre ? ctx.hucre.c : 0;
  const r = m[1] !== undefined ? hr + Number(m[1]) : m[2] !== undefined ? Number(m[2]) - 1 : hr;
  const c = m[3] !== undefined ? hc + Number(m[3]) : m[4] !== undefined ? Number(m[4]) - 1 : hc;
  if (r < 0 || c < 0) return null;
  return { r, c };
}
