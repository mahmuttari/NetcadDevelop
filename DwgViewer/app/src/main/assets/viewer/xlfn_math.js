/*
 * EXCEL FORMÜL MOTORU — MATEMATİK ve TRİGONOMETRİ
 *
 * KAPSAM. Toplama ailesi (SUM, SUMIF(S), SUMPRODUCT, SUMSQ, SUMX2MY2 …), yuvarlama ailesi
 * (ROUND, CEILING/FLOOR ve .MATH/.PRECISE sürümleri, MROUND, EVEN, ODD), bölme artığı
 * (MOD, QUOTIENT, GCD, LCM), üs ve logaritma, çarpanlar ve kombinatorik, trigonometri ve
 * hiperbolikler (ters ve karşılıklı oranlarla birlikte), sayı tabanları ve Romen rakamları,
 * özet işlevleri (SUBTOTAL, AGGREGATE) ve matris işlevleri (MMULT, MINVERSE, MDETERM, MUNIT,
 * TRANSPOSE, SEQUENCE, RANDARRAY).
 *
 * ORTAK TUZAK 1 — KAYAN NOKTA. Excel ondalık düşünür, JavaScript ikilik. 2,675 * 100 makinede
 * 267,49999999999997'dir; naif bir ROUND 2,67 verir, Excel 2,68. Aynı şekilde 2,5 / 0,1 = 25
 * değil 25,000000000000004'tür ve CEILING'i bir adım kaydırır. Bu yüzden "kaç adım" hesapları
 * ile yuvarlama sonuçları `temiz()` (15 anlamlı hane) üzerinden geçer. Bu bir gizleme değil,
 * ikilik gösterimin artığını atıp Excel'in ondalık kararına dönmektir.
 *
 * ORTAK TUZAK 2 — YÖN. ROUND yarımı SIFIRDAN UZAĞA atar: 2,5 → 3 ve -2,5 → -3. JS'in
 * Math.round'u -2,5'i -2 yapar (yarımı +∞'a atar). Bankacı yuvarlaması hiçbir yerde yoktur.
 *
 * ORTAK TUZAK 3 — ARALIK ile DOĞRUDAN YAZILAN ARGÜMAN AYNI DEĞİLDİR. Aralıktaki metin ve
 * mantık değerleri ATLANIR, doğrudan yazılan argüman ÇEVRİLİR: SUM("3";1) = 4 ama A1 = "3"
 * iken SUM(A1;1) = 1. Tek hücrelik başvuru skaler döndüğü için ayrım değerden anlaşılmaz;
 * `basvuruMu()` ayrıştırma ağacındaki düğüme de bakar.
 *
 * ORTAK TUZAK 4 — SIFIR ANLAMLILIK. FLOOR(x;0) #DIV/0! verir, CEILING(x;0) ise 0. Bu
 * bakışımsızlık Excel'in kendisindendir, buradaki bir dalgınlık değildir.
 */

import {
  ERR, hata, ilkHata, num, str, mat, duzle, olcut, yay, kontrol,
  degerlendir, degerlendirBasvuru, kaydetHepsi,
} from './xlfn.js';

// =================================================================================
// Ortak yardımcılar
// =================================================================================

/** İkilik gösterimin artığını atar: 267,49999999999997 → 267,5 · 1200,0000000000002 → 1200 */
const temiz = (v) => (typeof v === 'number' && isFinite(v) && v !== 0 ? Number(v.toPrecision(15)) : v);
/** Adım sayısı: bölmenin artığı yuvarlamayı bir adım kaydırmasın diye temizlenir */
const bolum = (a, b) => temiz(a / b);
/** Yarımı SIFIRDAN UZAĞA (Excel). Math.round tek başına -2,5'i -2 yapardı. */
const yarimUzak = (v) => (v < 0 ? -Math.round(-v) : Math.round(v));
/** Sıfırdan UZAĞA tam sayı (ROUNDUP) */
const uzaga = (v) => (v < 0 ? Math.floor(v) : Math.ceil(v));
/** Seçimlik argüman: verilmemişse (ya da boşsa) varsayılanına düşer */
const sec = (v, vars) => (v == null ? vars : num(v));

/** Tek argümanlı sayısal işlev; dizi geldiğinde eleman eleman uygulanır (Excel dizi yayılımı) */
const say1 = (f) => (a) => yay(a[0], null, (v) => { const x = num(v); return hata(x) ? x : kontrol(f(x)); });
/** İki argümanlı sayısal işlev; iki dizi eleman eleman eşlenir */
const say2 = (f) => (a) => yay(a[0], a[1], (u, v) => {
  const x = num(u); if (hata(x)) return x;
  const y = num(v); if (hata(y)) return y;
  return kontrol(f(x, y));
});

/*
 * Argüman ARALIK mı? Değerlendirilmiş değer dizi ise elbette aralıktır; ama tek hücrelik bir
 * başvuru skaler döner ve değerine bakarak ayırt edilemez. O yüzden ayrıştırma ağacındaki
 * düğüme de bakılır: ref, ad, kesişim, birleşim ve iki nokta işleci aralıktır.
 */
function basvuruMu(d) {
  if (!d) return false;
  if (d.t === 'ref' || d.t === 'name' || d.t === 'birlesim') return true;
  if (d.t === 'par') return basvuruMu(d.v);
  if (d.t === 'iki') return d.op === ':' || d.op === ' ';
  return false;
}

/** Toplama ailesinin sayı süzgeci (bkz. ORTAK TUZAK 3). Hata bulursa hatayı döndürür. */
function toplamSayilari(args, dugum, bas = 0) {
  const o = [];
  for (let i = bas; i < args.length; i++) {
    const v = args[i];
    if (Array.isArray(v) || basvuruMu(dugum && dugum.args && dugum.args[i])) {
      for (const x of duzle([v])) {
        if (typeof x === 'number') o.push(x);
        else if (hata(x)) return x;
      }
      continue;
    }
    if (v == null) continue;                 // atlanmış argüman toplamı etkilemez
    const n = num(v);
    if (hata(n)) return n;
    o.push(n);
  }
  return o;
}

const topla = (l) => l.reduce((a, b) => a + b, 0);
const sayisalSuz = (l) => l.filter((v) => typeof v === 'number');

// =================================================================================
// Toplama ailesi
// =================================================================================

kaydetHepsi({
  SUM: { en: 1, ek: -1, fn: (a, ctx, d) => { const l = toplamSayilari(a, d); return hata(l) ? l : kontrol(topla(l)); } },
  SUMSQ: { en: 1, ek: -1, fn: (a, ctx, d) => { const l = toplamSayilari(a, d); return hata(l) ? l : kontrol(topla(l.map((x) => x * x))); } },
  // Hiç sayı yoksa PRODUCT 1 değil 0 verir — boş aralıkla çarpım 1'e dönmez.
  PRODUCT: { en: 1, ek: -1, fn: (a, ctx, d) => { const l = toplamSayilari(a, d); if (hata(l)) return l; return l.length ? kontrol(l.reduce((x, y) => x * y, 1)) : 0; } },

  SUMIF: {
    en: 2, ek: 3,
    fn: (a) => {
      const R = mat(a[0]);
      const S = a.length > 2 && a[2] !== undefined ? mat(a[2]) : R;
      const uyar = olcut(a[1]);
      let t = 0;
      for (let i = 0; i < R.length; i++) {
        for (let j = 0; j < R[i].length; j++) {
          const v = R[i][j];
          if (!uyar(v === undefined ? null : v)) continue;
          // Toplam aralığı ölçüt aralığının BİÇİMİNE göre hizalanır: sol üst köşeden sayılır.
          const s = (S[i] || [])[j];
          if (typeof s === 'number') t += s;
        }
      }
      return kontrol(t);
    },
  },

  SUMIFS: {
    en: 3, ek: -1,
    fn: (a) => {
      if (a.length % 2 === 0) return ERR.VALUE;   // toplam aralığı + (aralık, ölçüt) çiftleri
      const S = mat(a[0]);
      const ck = [];
      for (let i = 1; i < a.length; i += 2) ck.push([mat(a[i]), olcut(a[i + 1])]);
      let t = 0;
      for (let i = 0; i < S.length; i++) {
        for (let j = 0; j < S[i].length; j++) {
          let uygun = true;
          for (const [R, f] of ck) { const v = (R[i] || [])[j]; if (!f(v === undefined ? null : v)) { uygun = false; break; } }
          if (!uygun) continue;
          const s = S[i][j];
          if (typeof s === 'number') t += s;
        }
      }
      return kontrol(t);
    },
  },

  /*
   * SUMPRODUCT sayı OLMAYAN her şeyi 0 sayar — mantık değerleri de dahil. "(A1:A9>2)*1" deyiminin
   * varlık sebebi budur: çarpma DOĞRU'yu 1'e çevirir, SUMPRODUCT kendi başına çevirmez.
   */
  SUMPRODUCT: {
    en: 1, ek: -1,
    fn: (a) => {
      const M = a.map((v) => mat(v === undefined ? null : v));
      const nr = M[0].length, nc = Math.max(...M[0].map((s) => s.length));
      for (const m of M) if (m.length !== nr || Math.max(...m.map((s) => s.length)) !== nc) return ERR.VALUE;
      let t = 0;
      for (let i = 0; i < nr; i++) {
        for (let j = 0; j < nc; j++) {
          let p = 1;
          for (const m of M) { const v = (m[i] || [])[j]; p *= typeof v === 'number' ? v : 0; }
          t += p;
        }
      }
      return kontrol(t);
    },
  },
});

/** İki diziyi konum konum eşler; sayı olmayan eşler atlanır, uzunluklar tutmazsa #N/A */
function ciftler(x, y) {
  const a = duzle([x]), b = duzle([y]);
  if (a.length !== b.length) return ERR.NA;
  const o = [];
  for (let i = 0; i < a.length; i++) if (typeof a[i] === 'number' && typeof b[i] === 'number') o.push([a[i], b[i]]);
  return o;
}
const ciftToplam = (f) => (a) => { const c = ciftler(a[0], a[1]); return hata(c) ? c : kontrol(topla(c.map(([x, y]) => f(x, y)))); };

kaydetHepsi({
  SUMX2MY2: { en: 2, ek: 2, fn: ciftToplam((x, y) => x * x - y * y) },
  SUMX2PY2: { en: 2, ek: 2, fn: ciftToplam((x, y) => x * x + y * y) },
  SUMXMY2: { en: 2, ek: 2, fn: ciftToplam((x, y) => (x - y) * (x - y)) },
});

// =================================================================================
// İşaret, tam sayı, yuvarlama
// =================================================================================

/** x'i 10^d ölçeğine taşır, `f` ile tam sayıya indirir, geri taşır */
function olcekli(x, d, f) {
  const p = Math.pow(10, Math.abs(d));
  if (!isFinite(p)) return d > 0 ? x : 0;
  const v = temiz(d >= 0 ? x * p : x / p);
  const r = f(v);
  return temiz(d >= 0 ? r / p : r * p);
}

kaydetHepsi({
  ABS: { en: 1, ek: 1, fn: say1((x) => Math.abs(x)) },
  SIGN: { en: 1, ek: 1, fn: say1((x) => (x > 0 ? 1 : x < 0 ? -1 : 0)) },
  // INT AŞAĞI yuvarlar (-8,9 → -9), TRUNC SIFIRA doğru keser (-8,9 → -8). Karıştırılmasın.
  INT: { en: 1, ek: 1, fn: say1((x) => Math.floor(x)) },
  TRUNC: { en: 1, ek: 2, fn: say2((x, d) => olcekli(x, Math.trunc(d), Math.trunc)) },
  ROUND: { en: 2, ek: 2, fn: say2((x, d) => olcekli(x, Math.trunc(d), yarimUzak)) },
  ROUNDUP: { en: 2, ek: 2, fn: say2((x, d) => olcekli(x, Math.trunc(d), uzaga)) },
  ROUNDDOWN: { en: 2, ek: 2, fn: say2((x, d) => olcekli(x, Math.trunc(d), Math.trunc)) },
  MROUND: {
    en: 2, ek: 2,
    fn: say2((x, m) => {
      if (m === 0) return 0;
      if ((x > 0 && m < 0) || (x < 0 && m > 0)) return ERR.NUM;   // işaretler ayrıksa tanımsız
      return temiz(yarimUzak(bolum(x, m)) * m);
    }),
  },

  /*
   * Eski CEILING / FLOOR ile .MATH sürümleri NEGATİF sayıda ayrı yönlere gider:
   *   CEILING(-2,5;2) = -2  (sıfıra doğru)      CEILING.MATH(-2,5;2) = -2  (+∞'a doğru — aynı)
   *   CEILING(-2,5;-2) = -4 (sıfırdan uzağa)    CEILING.MATH(-2,5;2;-1) = -4
   *   FLOOR(-2,5;2) = -4                        FLOOR.MATH(-2,5;2) = -4
   *   FLOOR(-2,5;-2) = -2                       FLOOR.MATH(-2,5;2;-1) = -2
   * Eskilerde YÖNÜ anlamlılığın İŞARETİ belirler ve pozitif sayı + negatif anlamlılık #NUM!'dur;
   * .MATH ailesinde anlamlılığın işareti yok sayılır, yönü ayrı bir "kip" argümanı verir.
   */
  CEILING: {
    en: 2, ek: 2,
    fn: say2((x, s) => {
      if (s === 0) return 0;                  // FLOOR burada #DIV/0! verir; bakışımsızlık Excel'in
      if (x > 0 && s < 0) return ERR.NUM;
      return temiz(Math.ceil(bolum(x, s)) * s);
    }),
  },
  FLOOR: {
    en: 2, ek: 2,
    fn: say2((x, s) => {
      if (s === 0) return ERR.DIV0;
      if (x > 0 && s < 0) return ERR.NUM;
      return temiz(Math.floor(bolum(x, s)) * s);
    }),
  },
});

const matCeil = (x, s, kip) => {
  const a = Math.abs(s);                      // .MATH ailesinde anlamlılığın işareti yok sayılır
  if (a === 0) return 0;
  const q = bolum(x, a);
  return temiz((x < 0 && kip ? Math.floor(q) : Math.ceil(q)) * a);
};
const matFloor = (x, s, kip) => {
  const a = Math.abs(s);
  if (a === 0) return 0;
  const q = bolum(x, a);
  return temiz((x < 0 && kip ? Math.ceil(q) : Math.floor(q)) * a);
};
const matSarma = (f) => (a) => {
  const x = num(a[0]); if (hata(x)) return x;
  const s = sec(a[1], 1); if (hata(s)) return s;
  const k = sec(a[2], 0); if (hata(k)) return k;
  return kontrol(f(x, s, k));
};

kaydetHepsi({
  'CEILING.MATH': { en: 1, ek: 3, fn: matSarma(matCeil) },
  'FLOOR.MATH': { en: 1, ek: 3, fn: matSarma(matFloor) },
  // .PRECISE ve ISO.CEILING kipsizdir: yön her zaman +∞ (CEILING) ya da -∞ (FLOOR).
  'CEILING.PRECISE': { en: 1, ek: 2, fn: (a) => matSarma(matCeil)([a[0], a[1], 0]) },
  'ISO.CEILING': { en: 1, ek: 2, fn: (a) => matSarma(matCeil)([a[0], a[1], 0]) },
  'FLOOR.PRECISE': { en: 1, ek: 2, fn: (a) => matSarma(matFloor)([a[0], a[1], 0]) },

  EVEN: { en: 1, ek: 1, fn: say1((x) => (x < 0 ? -1 : 1) * Math.ceil(Math.abs(x) / 2) * 2) },
  ODD: { en: 1, ek: 1, fn: say1((x) => (x < 0 ? -1 : 1) * (Math.ceil((Math.abs(x) + 1) / 2) * 2 - 1)) },
});

// =================================================================================
// Bölme artığı, ortak bölen ve kat
// =================================================================================

kaydetHepsi({
  /*
   * MOD sonucun işaretini BÖLENDEN alır: MOD(-3;2) = 1, MOD(3;-2) = -1. JS'in % işleci işareti
   * BÖLÜNENDEN alır ve -1 verir. Bu, bu kategoride en sık yapılan hatadır; bu yüzden % değil
   * x - b*floor(x/b) kullanılır.
   */
  MOD: { en: 2, ek: 2, fn: say2((x, b) => (b === 0 ? ERR.DIV0 : temiz(x - b * Math.floor(bolum(x, b))))) },
  // QUOTIENT ise sadece böler ve SIFIRA doğru keser: QUOTIENT(-10;3) = -3, MOD(-10;3) = 2.
  QUOTIENT: { en: 2, ek: 2, fn: say2((x, b) => (b === 0 ? ERR.DIV0 : Math.trunc(bolum(x, b)))) },
});

const ikd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
/** GCD / LCM argümanlarını toplar: tam sayıya kesilir, negatif olan tanımsızdır */
function tamListe(args) {
  const o = [];
  for (const v of duzle(args)) {
    if (v == null) { o.push(0); continue; }
    const n = num(v);
    if (hata(n)) return n;
    if (n < 0) return ERR.NUM;
    if (n >= 2 ** 53) return ERR.NUM;
    o.push(Math.trunc(n));
  }
  return o;
}

kaydetHepsi({
  GCD: { en: 1, ek: -1, fn: (a) => { const l = tamListe(a); return hata(l) ? l : l.reduce(ikd, 0); } },
  LCM: {
    en: 1, ek: -1,
    fn: (a) => {
      const l = tamListe(a);
      if (hata(l)) return l;
      let r = 1;
      for (const n of l) {
        if (n === 0) return 0;                 // sıfırın katı yoktur; Excel 0 verir
        r = (r / ikd(r, n)) * n;
        if (r >= 2 ** 53) return ERR.NUM;
      }
      return r;
    },
  },
});

// =================================================================================
// Üs, kök, logaritma
// =================================================================================

kaydetHepsi({
  POWER: {
    en: 2, ek: 2,
    fn: say2((x, y) => {
      if (x === 0 && y < 0) return ERR.DIV0;
      const v = Math.pow(x, y);
      return isNaN(v) ? ERR.NUM : v;           // negatif taban + kesirli üs tanımsızdır
    }),
  },
  SQRT: { en: 1, ek: 1, fn: say1((x) => (x < 0 ? ERR.NUM : Math.sqrt(x))) },
  SQRTPI: { en: 1, ek: 1, fn: say1((x) => (x < 0 ? ERR.NUM : Math.sqrt(x * Math.PI))) },
  EXP: { en: 1, ek: 1, fn: say1((x) => Math.exp(x)) },
  LN: { en: 1, ek: 1, fn: say1((x) => (x <= 0 ? ERR.NUM : Math.log(x))) },
  LOG10: { en: 1, ek: 1, fn: say1((x) => (x <= 0 ? ERR.NUM : Math.log10(x))) },
  LOG: {
    en: 1, ek: 2,
    fn: (a) => {
      const x = num(a[0]); if (hata(x)) return x;
      const t = sec(a[1], 10); if (hata(t)) return t;
      if (x <= 0 || t < 0) return ERR.NUM;
      if (t === 1) return ERR.DIV0;            // ln(1) = 0 paydaya düşer
      if (t === 0) return ERR.NUM;
      return kontrol(temiz(Math.log(x) / Math.log(t)));
    },
  },
});

// =================================================================================
// Çarpanlar ve kombinatorik
// =================================================================================

function carpinim(n) {
  if (n < 0) return ERR.NUM;
  let r = 1;
  for (let i = 2; i <= n; i++) { r *= i; if (!isFinite(r)) return ERR.NUM; }
  return r;
}
/** C(n;k) — doğrudan çarpınım oranı taşma yapar, bu yüzden adım adım bölünür */
function kombin(n, k) {
  if (k > n - k) k = n - k;
  let r = 1;
  for (let i = 1; i <= k; i++) { r = (r * (n - k + i)) / i; if (!isFinite(r)) return ERR.NUM; }
  return Math.round(r);
}

kaydetHepsi({
  FACT: { en: 1, ek: 1, fn: say1((x) => carpinim(Math.trunc(x))) },
  FACTDOUBLE: {
    en: 1, ek: 1,
    fn: say1((x) => {
      const n = Math.trunc(x);
      if (n < 0) return ERR.NUM;               // (-1)!! matematikte 1'dir ama Excel #NUM! der
      let r = 1;
      for (let i = n; i > 1; i -= 2) { r *= i; if (!isFinite(r)) return ERR.NUM; }
      return r;
    }),
  },
  COMBIN: {
    en: 2, ek: 2,
    fn: say2((x, y) => {
      const n = Math.trunc(x), k = Math.trunc(y);
      if (n < 0 || k < 0 || k > n) return ERR.NUM;
      return kombin(n, k);
    }),
  },
  // COMBINA yinelemeli seçimdir: n türden k adet seçmek = C(n+k-1; k).
  COMBINA: {
    en: 2, ek: 2,
    fn: say2((x, y) => {
      const n = Math.trunc(x), k = Math.trunc(y);
      if (n < 0 || k < 0) return ERR.NUM;
      if (n === 0) return k === 0 ? 1 : ERR.NUM;
      return kombin(n + k - 1, k);
    }),
  },
  PERMUT: {
    en: 2, ek: 2,
    fn: say2((x, y) => {
      const n = Math.trunc(x), k = Math.trunc(y);
      if (n < 0 || k < 0 || k > n) return ERR.NUM;
      let r = 1;
      for (let i = 0; i < k; i++) { r *= n - i; if (!isFinite(r)) return ERR.NUM; }
      return r;
    }),
  },
  PERMUTATIONA: {
    en: 2, ek: 2,
    fn: say2((x, y) => {
      const n = Math.trunc(x), k = Math.trunc(y);
      if (n < 0 || k < 0) return ERR.NUM;
      return Math.pow(n, k);                   // yinelemeye izin verildiğinde n^k
    }),
  },
  MULTINOMIAL: {
    en: 1, ek: -1,
    fn: (a) => {
      const l = duzle(a);
      let t = 0, r = 1;
      for (const v of l) {
        if (v == null) continue;
        const x = num(v); if (hata(x)) return x;
        const n = Math.trunc(x);
        if (n < 0) return ERR.NUM;
        t += n;
        // (t)! / (t-n)! / n! çarpanlarına bölerek ilerlemek taşmayı önler
        const c = kombin(t, n); if (hata(c)) return c;
        r *= c;
        if (!isFinite(r)) return ERR.NUM;
      }
      return r;
    },
  },
});

// =================================================================================
// Sabit ve rastgelelik
// =================================================================================

// Zaman ve rastgelelik motorun DIŞINDAN gelir; ctx vermezse sonuç 0'dır (yinelenebilir kalır).
const zar = (ctx) => (ctx && ctx.rastgele ? ctx.rastgele() : 0);

kaydetHepsi({
  PI: { en: 0, ek: 0, fn: () => Math.PI },
  RAND: { en: 0, ek: 0, fn: (a, ctx) => zar(ctx) },
  RANDBETWEEN: {
    en: 2, ek: 2,
    fn: (a, ctx) => {
      const x = num(a[0]); if (hata(x)) return x;
      const y = num(a[1]); if (hata(y)) return y;
      // Excel yalnız TAM SAYI döndürür: alt sınır yukarı, üst sınır aşağı yuvarlanır.
      const alt = Math.ceil(x), ust = Math.floor(y);
      if (alt > ust) return ERR.NUM;
      return alt + Math.floor(zar(ctx) * (ust - alt + 1));
    },
  },
  RANDARRAY: {
    en: 0, ek: 5,
    fn: (a, ctx) => {
      const sr = Math.trunc(sec(a[0], 1)), sc = Math.trunc(sec(a[1], 1));
      const en = sec(a[2], 0), us = sec(a[3], 1), tam = a[4] == null ? false : !!a[4];
      const h = ilkHata(sr, sc, en, us); if (h) return h;
      if (sr < 1 || sc < 1) return ERR.VALUE;
      if (sr > 1048576 || sc > 16384) return ERR.NUM;
      if (en > us) return ERR.VALUE;
      const o = [];
      for (let i = 0; i < sr; i++) {
        const sat = [];
        for (let j = 0; j < sc; j++) {
          const r = zar(ctx);
          sat.push(tam ? Math.floor(en + r * (Math.floor(us) - Math.ceil(en) + 1)) : en + r * (us - en));
        }
        o.push(sat);
      }
      return o;
    },
  },
});

// =================================================================================
// Trigonometri ve hiperbolikler
// =================================================================================

kaydetHepsi({
  SIN: { en: 1, ek: 1, fn: say1(Math.sin) },
  COS: { en: 1, ek: 1, fn: say1(Math.cos) },
  TAN: { en: 1, ek: 1, fn: say1(Math.tan) },
  ASIN: { en: 1, ek: 1, fn: say1((x) => (x < -1 || x > 1 ? ERR.NUM : Math.asin(x))) },
  ACOS: { en: 1, ek: 1, fn: say1((x) => (x < -1 || x > 1 ? ERR.NUM : Math.acos(x))) },
  ATAN: { en: 1, ek: 1, fn: say1(Math.atan) },
  // DİKKAT: Excel'in ATAN2'si (x; y) sırasındadır — JS'in Math.atan2(y, x) sırasının TERSİ.
  ATAN2: { en: 2, ek: 2, fn: say2((x, y) => (x === 0 && y === 0 ? ERR.DIV0 : Math.atan2(y, x))) },
  SINH: { en: 1, ek: 1, fn: say1(Math.sinh) },
  COSH: { en: 1, ek: 1, fn: say1(Math.cosh) },
  TANH: { en: 1, ek: 1, fn: say1(Math.tanh) },
  ASINH: { en: 1, ek: 1, fn: say1(Math.asinh) },
  ACOSH: { en: 1, ek: 1, fn: say1((x) => (x < 1 ? ERR.NUM : Math.acosh(x))) },
  ATANH: { en: 1, ek: 1, fn: say1((x) => (x <= -1 || x >= 1 ? ERR.NUM : Math.atanh(x))) },

  CSC: { en: 1, ek: 1, fn: say1((x) => { const s = Math.sin(x); return s === 0 ? ERR.DIV0 : 1 / s; }) },
  SEC: { en: 1, ek: 1, fn: say1((x) => { const c = Math.cos(x); return c === 0 ? ERR.DIV0 : 1 / c; }) },
  COT: { en: 1, ek: 1, fn: say1((x) => { const t = Math.tan(x); return t === 0 ? ERR.DIV0 : 1 / t; }) },
  CSCH: { en: 1, ek: 1, fn: say1((x) => { const s = Math.sinh(x); return s === 0 ? ERR.DIV0 : 1 / s; }) },
  SECH: { en: 1, ek: 1, fn: say1((x) => 1 / Math.cosh(x)) },
  COTH: { en: 1, ek: 1, fn: say1((x) => { const t = Math.tanh(x); return t === 0 ? ERR.DIV0 : 1 / t; }) },
  // ACOT'un değer kümesi (0; π)'dir — ATAN gibi negatife inmez, bu yüzden π/2 - ATAN(x).
  ACOT: { en: 1, ek: 1, fn: say1((x) => Math.PI / 2 - Math.atan(x)) },
  ACOTH: { en: 1, ek: 1, fn: say1((x) => (Math.abs(x) <= 1 ? ERR.NUM : Math.atanh(1 / x))) },

  DEGREES: { en: 1, ek: 1, fn: say1((x) => temiz((x * 180) / Math.PI)) },
  RADIANS: { en: 1, ek: 1, fn: say1((x) => (x * Math.PI) / 180) },
});

// =================================================================================
// Romen rakamları ve sayı tabanları
// =================================================================================

const R_IM = ['M', 'D', 'C', 'L', 'X', 'V', 'I'];
const R_DG = [1000, 500, 100, 50, 10, 5, 1];

/*
 * Excel'in "biçim" parametresi, çıkarma simgesinin merdivende klasik yerinden KAÇ BASAMAK daha
 * aşağı inebileceğidir. Klasik biçimde (0) bir M'den yalnız C, bir D'den yalnız C çıkarılır;
 * biçim arttıkça çıkarılan simge küçülür ve yazım kısalır:
 *   499 → CDXCIX (0) · LDVLIV (1) · XDIX (2) · VDIV (3) · ID (4)
 * Her basamakta önce düz simgeler yazılır, sonra izin verilen çıkarma belirteçlerinin UYAN EN
 * BÜYÜĞÜ seçilir; en büyüğü almazsak biçim büyüdükçe yazım uzayabilirdi (98'de XC kaybolurdu).
 */
function romen(n, bicim) {
  let o = '';
  for (let j = 0; j < R_DG.length; j++) {
    while (n >= R_DG[j]) { o += R_IM[j]; n -= R_DG[j]; }
    const ilk = j % 2 === 0 ? j + 2 : j + 1;                     // klasik çıkarma simgesinin sırası
    const son = Math.min(R_DG.length - 1, ilk + bicim);
    for (let k = son; k >= ilk; k--) {
      const t = R_DG[j] - R_DG[k];
      if (t > 0 && t <= n) { o += R_IM[k] + R_IM[j]; n -= t; break; }
    }
  }
  return o;
}

kaydetHepsi({
  ROMAN: {
    en: 1, ek: 2,
    fn: (a) => {
      const x = num(a[0]); if (hata(x)) return x;
      // Mantık değeri biçim numarası DEĞİLDİR: DOĞRU klasik (0), YANLIŞ en kısa (4) demektir.
      let b;
      if (a[1] === undefined || a[1] === null) b = 0;
      else if (typeof a[1] === 'boolean') b = a[1] ? 0 : 4;
      else { const t = num(a[1]); if (hata(t)) return t; b = Math.trunc(t); }
      const n = Math.trunc(x);
      if (n < 0 || n > 3999 || b < 0 || b > 4) return ERR.VALUE;
      return romen(n, b);
    },
  },
  ARABIC: {
    en: 1, ek: 1,
    fn: (a) => {
      const t = str(a[0]); if (hata(t)) return t;
      const s = t.trim().toUpperCase();
      if (s.length > 255) return ERR.VALUE;
      const eksi = s[0] === '-';
      const g = eksi ? s.slice(1) : s;
      if (g === '') return 0;
      let t2 = 0, enb = 0;
      // Sağdan sola: şimdiye dek görülen en büyük değerden küçük simge ÇIKARILIR (IX = 9).
      for (let i = g.length - 1; i >= 0; i--) {
        const p = R_IM.indexOf(g[i]);
        if (p < 0) return ERR.VALUE;
        const d = R_DG[p];
        if (d < enb) t2 -= d; else { t2 += d; enb = d; }
      }
      return eksi ? -t2 : t2;
    },
  },
  BASE: {
    en: 2, ek: 3,
    fn: (a) => {
      const x = num(a[0]); if (hata(x)) return x;
      const r = num(a[1]); if (hata(r)) return r;
      const u = sec(a[2], 0); if (hata(u)) return u;
      const N = Math.trunc(x), R = Math.trunc(r), U = Math.trunc(u);
      if (N < 0 || N >= 2 ** 53) return ERR.NUM;
      if (R < 2 || R > 36) return ERR.NUM;
      if (U < 0 || U > 255) return ERR.NUM;
      let s = N.toString(R).toUpperCase();
      while (s.length < U) s = '0' + s;
      return s;
    },
  },
  DECIMAL: {
    en: 2, ek: 2,
    fn: (a) => {
      const t = str(a[0]); if (hata(t)) return t;
      const r = num(a[1]); if (hata(r)) return r;
      const R = Math.trunc(r);
      if (R < 2 || R > 36) return ERR.NUM;
      const s = t.trim().toUpperCase();
      if (s === '') return 0;
      let v = 0;
      for (const c of s) {
        const d = parseInt(c, 36);
        if (isNaN(d) || d >= R) return ERR.NUM;
        v = v * R + d;
      }
      return v;
    },
  },
  SERIESSUM: {
    en: 4, ek: 4,
    fn: (a) => {
      const x = num(a[0]), n = num(a[1]), m = num(a[2]);
      const h = ilkHata(x, n, m); if (h) return h;
      const k = duzle([a[3]]);
      let t = 0;
      for (let i = 0; i < k.length; i++) {
        const c = num(k[i]); if (hata(c)) return c;
        t += c * Math.pow(x, n + i * m);
      }
      return kontrol(temiz(t));
    },
  },
});

// =================================================================================
// Özet işlevleri — SUBTOTAL ve AGGREGATE
// =================================================================================

/*
 * SUBTOTAL ve AGGREGATE bir işlev NUMARASI alır ve İÇ İÇE aynı türden hücreleri atlar; bu yüzden
 * argümanlar ham AST olarak alınıp başvuruya çözülür, hücrelerin FORMÜLÜNE bakılır. Gizli satır
 * bilgisi motorda yoktur: ctx.gizliSatir verilmedikçe 1-11 ile 101-111 (ve 'gizliyi yok say'
 * seçenekleri) AYNI davranır. Görüntüleyici gizliliği bildirdiğinde tek satır eklemekle çalışır.
 */
const IC_RE = /\b(SUBTOTAL|AGGREGATE)\s*\(/i;

function ozetTopla(dugumler, ctx, gizliAtla, icAtla) {
  const o = [];
  const alan = (ref) => {
    for (let r = ref.r1; r <= ref.r2; r++) {
      if (gizliAtla && ctx.gizliSatir && ctx.gizliSatir(ref.sayfa, r)) continue;
      for (let c = ref.c1; c <= ref.c2; c++) {
        if (icAtla && ctx.formul) { const f = ctx.formul(ref.sayfa, r, c); if (f && IC_RE.test(f)) continue; }
        o.push(ctx.oku ? ctx.oku(ref.sayfa, r, c) : null);
      }
    }
  };
  for (const d of dugumler) {
    const ref = ctx && ctx.oku ? degerlendirBasvuru(d, ctx) : null;
    if (ref && ref.alanlar) { ref.alanlar.forEach(alan); continue; }
    if (ref && !ref.yok) { alan(ref); continue; }
    for (const x of duzle([degerlendir(d, ctx)])) o.push(x);
  }
  return o;
}

const ortalama = (s) => (s.length ? topla(s) / s.length : ERR.DIV0);
function varyans(s, ornek) {
  const n = s.length;
  if (n < (ornek ? 2 : 1)) return ERR.DIV0;
  const m = topla(s) / n;
  return topla(s.map((v) => (v - m) * (v - m))) / (ornek ? n - 1 : n);
}
const kok = (v) => (hata(v) ? v : Math.sqrt(v));
function medyan(s) {
  const d = s.slice().sort((a, b) => a - b), n = d.length;
  if (!n) return ERR.NUM;
  return n % 2 ? d[(n - 1) / 2] : (d[n / 2 - 1] + d[n / 2]) / 2;
}
function tepe(s) {
  const say = new Map();
  for (const v of s) say.set(v, (say.get(v) || 0) + 1);
  let en = 0, sonuc = ERR.NA;
  for (const v of s) { const c = say.get(v); if (c > 1 && c > en) { en = c; sonuc = v; } }
  return sonuc;                                // hiçbir değer yinelenmiyorsa #N/A
}
function nBuyuk(s, k) {
  const d = s.slice().sort((a, b) => b - a), i = Math.trunc(k);
  return !d.length || i < 1 || i > d.length ? ERR.NUM : d[i - 1];
}
function nKucuk(s, k) {
  const d = s.slice().sort((a, b) => a - b), i = Math.trunc(k);
  return !d.length || i < 1 || i > d.length ? ERR.NUM : d[i - 1];
}
function yuzdelikInc(s, p) {
  const d = s.slice().sort((a, b) => a - b), n = d.length;
  if (!n || p < 0 || p > 1) return ERR.NUM;
  const konum = (n - 1) * p, alt = Math.floor(konum);
  return alt + 1 < n ? d[alt] + (konum - alt) * (d[alt + 1] - d[alt]) : d[n - 1];
}
function yuzdelikExc(s, p) {
  const d = s.slice().sort((a, b) => a - b), n = d.length;
  if (!n) return ERR.NUM;
  const konum = p * (n + 1);
  if (konum < 1 || konum > n) return ERR.NUM;
  const alt = Math.floor(konum), kes = konum - alt;
  return alt >= n ? d[n - 1] : d[alt - 1] + kes * (d[alt] - d[alt - 1]);
}
const ceyreklik = (s, q, exc) => {
  const i = Math.trunc(q);
  if (i < 0 || i > 4) return ERR.NUM;
  return exc ? yuzdelikExc(s, i / 4) : yuzdelikInc(s, i / 4);
};

/** SUBTOTAL / AGGREGATE işlev numarası → sonuç (1-11 ortak, 12-19 yalnız AGGREGATE) */
function ozet(no, l, k) {
  const s = sayisalSuz(l);
  switch (no) {
    case 1: return ortalama(s);
    case 2: return s.length;                                   // COUNT boşu ve metni saymaz
    case 3: return l.filter((v) => v != null).length;          // COUNTA boş OLMAYANI sayar
    case 4: return s.length ? Math.max(...s) : 0;
    case 5: return s.length ? Math.min(...s) : 0;
    case 6: return s.length ? s.reduce((a, b) => a * b, 1) : 0;
    case 7: return kok(varyans(s, true));
    case 8: return kok(varyans(s, false));
    case 9: return kontrol(topla(s));
    case 10: return varyans(s, true);
    case 11: return varyans(s, false);
    case 12: return medyan(s);
    case 13: return tepe(s);
    case 14: return nBuyuk(s, k);
    case 15: return nKucuk(s, k);
    case 16: return yuzdelikInc(s, k);
    case 17: return ceyreklik(s, k, false);
    case 18: return yuzdelikExc(s, k);
    case 19: return ceyreklik(s, k, true);
    default: return ERR.VALUE;
  }
}

kaydetHepsi({
  SUBTOTAL: {
    en: 2, ek: -1, ham: true,
    fn: (a, ctx) => {
      const no = num(degerlendir(a[0], ctx)); if (hata(no)) return no;
      const k = Math.trunc(no);
      const gizliAtla = k > 100;               // 101-111 gizli satırları atlar (ctx bildirirse)
      const isl = gizliAtla ? k - 100 : k;
      if (isl < 1 || isl > 11) return ERR.VALUE;
      const l = ozetTopla(a.slice(1), ctx || {}, gizliAtla, true);
      const h = ilkHata(...l); if (h) return h;
      return ozet(isl, l);
    },
  },
  /*
   * AGGREGATE'in 2. argümanı "yok sayılacaklar"dır; bu yüzden hata argümanlarının otomatik
   * yayılmaması gerekir (ham argümanlar zaten değerlendirilmez, hatasiz bunu belgeler).
   *   0/yok: iç içe SUBTOTAL-AGGREGATE atla · 1: +gizli satır · 2: +hata · 3: +gizli +hata
   *   4: hiçbir şeyi atlama · 5: gizli · 6: hata · 7: gizli + hata
   * 14-19 numaralı işlevler (LARGE, SMALL, PERCENTILE, QUARTILE) son argüman olarak k alır.
   */
  AGGREGATE: {
    en: 2, ek: -1, ham: true, hatasiz: true,
    fn: (a, ctx) => {
      const c = ctx || {};
      const n0 = num(degerlendir(a[0], c)); if (hata(n0)) return n0;
      const s0 = num(degerlendir(a[1], c)); if (hata(s0)) return s0;
      const no = Math.trunc(n0), secenek = Math.trunc(s0);
      if (no < 1 || no > 19) return ERR.VALUE;
      if (secenek < 0 || secenek > 7) return ERR.VALUE;
      const gizliAtla = secenek === 1 || secenek === 3 || secenek === 5 || secenek === 7;
      const hataAtla = secenek === 2 || secenek === 3 || secenek === 6 || secenek === 7;
      const icAtla = secenek <= 3;
      let kalan = a.slice(2), k = null;
      if (no >= 14) {
        if (kalan.length !== 2) return ERR.VALUE;
        const kv = num(degerlendir(kalan[1], c)); if (hata(kv)) return kv;
        k = kv;
        kalan = kalan.slice(0, 1);
      }
      if (!kalan.length) return ERR.VALUE;
      let l = ozetTopla(kalan, c, gizliAtla, icAtla);
      if (hataAtla) l = l.filter((v) => !hata(v));
      else { const h = ilkHata(...l); if (h) return h; }
      return ozet(no, l, k);
    },
  },
});

// =================================================================================
// Matris işlevleri
// =================================================================================

/** Diziyi sayı matrisine çevirir; sayı olmayan tek bir hücre bile #VALUE! yapar */
function sayiMatris(v) {
  const M = mat(v === undefined ? null : v);
  const nc = Math.max(...M.map((s) => s.length));
  const o = [];
  for (const sat of M) {
    const r = [];
    for (let j = 0; j < nc; j++) {
      const x = sat[j];
      if (typeof x !== 'number') return ERR.VALUE;
      r.push(x);
    }
    o.push(r);
  }
  return o;
}

kaydetHepsi({
  TRANSPOSE: {
    en: 1, ek: 1,
    fn: (a) => {
      const M = mat(a[0] === undefined ? null : a[0]);
      const nc = Math.max(...M.map((s) => s.length));
      const o = [];
      for (let j = 0; j < nc; j++) {
        const sat = [];
        for (let i = 0; i < M.length; i++) { const v = M[i][j]; sat.push(v === undefined ? null : v); }
        o.push(sat);
      }
      return o;
    },
  },
  MUNIT: {
    en: 1, ek: 1,
    fn: (a) => {
      const x = num(a[0]); if (hata(x)) return x;
      const n = Math.trunc(x);
      if (n < 1) return ERR.VALUE;
      if (n > 1024) return ERR.NUM;
      const o = [];
      for (let i = 0; i < n; i++) { const s = []; for (let j = 0; j < n; j++) s.push(i === j ? 1 : 0); o.push(s); }
      return o;
    },
  },
  MMULT: {
    en: 2, ek: 2,
    fn: (a) => {
      const A = sayiMatris(a[0]); if (hata(A)) return A;
      const B = sayiMatris(a[1]); if (hata(B)) return B;
      const n = A[0].length;
      if (n !== B.length) return ERR.VALUE;    // A'nın sütun sayısı B'nin satır sayısına eşit olmalı
      const o = [];
      for (let i = 0; i < A.length; i++) {
        const sat = [];
        for (let j = 0; j < B[0].length; j++) {
          let t = 0;
          for (let k = 0; k < n; k++) t += A[i][k] * B[k][j];
          sat.push(temiz(t));
        }
        o.push(sat);
      }
      return o;
    },
  },
  MDETERM: {
    en: 1, ek: 1,
    fn: (a) => {
      const A = sayiMatris(a[0]); if (hata(A)) return A;
      const n = A.length;
      if (n !== A[0].length) return ERR.VALUE;
      const M = A.map((s) => s.slice());
      let det = 1;
      for (let i = 0; i < n; i++) {
        // Kısmi pivotlama: en büyük mutlak değerli satır öne alınır, aksi halde küçük
        // pivotlar hatayı büyütür ve tekil olmayan bir matris tekil görünebilir.
        let p = i;
        for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        if (M[p][i] === 0) return 0;
        if (p !== i) { const t = M[p]; M[p] = M[i]; M[i] = t; det = -det; }
        det *= M[i][i];
        for (let r = i + 1; r < n; r++) {
          const f = M[r][i] / M[i][i];
          for (let c2 = i; c2 < n; c2++) M[r][c2] -= f * M[i][c2];
        }
      }
      return kontrol(temiz(det));
    },
  },
  MINVERSE: {
    en: 1, ek: 1,
    fn: (a) => {
      const A = sayiMatris(a[0]); if (hata(A)) return A;
      const n = A.length;
      if (n !== A[0].length) return ERR.VALUE;
      const M = A.map((s, i) => s.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))));
      for (let i = 0; i < n; i++) {
        let p = i;
        for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
        if (M[p][i] === 0) return ERR.NUM;     // tekil matrisin tersi yoktur
        if (p !== i) { const t = M[p]; M[p] = M[i]; M[i] = t; }
        const d = M[i][i];
        for (let c2 = 0; c2 < 2 * n; c2++) M[i][c2] /= d;
        for (let r = 0; r < n; r++) {
          if (r === i) continue;
          const f = M[r][i];
          if (f === 0) continue;
          for (let c2 = 0; c2 < 2 * n; c2++) M[r][c2] -= f * M[i][c2];
        }
      }
      return M.map((s) => s.slice(n).map((v) => temiz(v)));
    },
  },
  SEQUENCE: {
    en: 1, ek: 4,
    fn: (a) => {
      const r0 = num(a[0]); if (hata(r0)) return r0;
      const c0 = sec(a[1], 1); if (hata(c0)) return c0;
      const b0 = sec(a[2], 1); if (hata(b0)) return b0;
      const a0 = sec(a[3], 1); if (hata(a0)) return a0;
      const sr = Math.trunc(r0), sc = Math.trunc(c0);
      if (sr < 0 || sc < 0) return ERR.VALUE;
      // Sıfır satır ya da sütun BOŞ bir dizi demektir; böyle bir sonuç hücreye sığmaz, Excel
      // bunu #CALC! ile bildirir (hesap doğru, sonuç gösterilemez).
      if (sr === 0 || sc === 0) return ERR.CALC;
      if (sr > 1048576 || sc > 16384) return ERR.NUM;
      const o = [];
      for (let i = 0; i < sr; i++) {
        const sat = [];
        for (let j = 0; j < sc; j++) sat.push(temiz(b0 + (i * sc + j) * a0));
        o.push(sat);
      }
      return o;
    },
  },
});
