/*
 * EXCEL FORMÜL MOTORU — İSTATİSTİK İŞLEVLERİ
 *
 * KAPSAM. Betimleyici istatistik (AVERAGE, MEDIAN, STDEV, SKEW, KURT …), sıra istatistikleri
 * (LARGE, RANK, PERCENTILE, QUARTILE), iki değişkenli çözümleme (CORREL, SLOPE, LINEST, TREND),
 * sürekli ve kesikli olasılık dağılımları (NORM, T, F, CHISQ, GAMMA, BETA, BINOM, POISSON …) ve
 * kuram sınamaları (T.TEST, F.TEST, CHISQ.TEST, Z.TEST).
 *
 * ORTAK TUZAK 1 — ARALIK ile DOĞRUDAN YAZILAN ARGÜMAN AYNI DEĞİLDİR.
 * AVERAGE(A1;1) ile A1="3" iken sonuç 1'dir (aralıktaki metin ATLANIR), ama AVERAGE("3";1) = 2'dir
 * (doğrudan yazılan metin ÇEVRİLİR). Aynı ayrım mantık değerleri için de geçerlidir. Bu dosyada
 * ayrımı `aralikMi()` yapar: değerlendirilmiş argümanın dizi olup olmadığına VE ayrıştırma
 * ağacındaki düğümün başvuru olup olmadığına bakar; böylece tek hücrelik başvuru da (dizi
 * değildir ama aralıktır) doğru sınıflanır.
 *
 * ORTAK TUZAK 2 — ESKİ ADLAR YENİ ADLARIN TAKMA ADI DEĞİLDİR.
 * CHIDIST sağ kuyruk verir, CHISQ.DIST sol kuyruk; TINV iki kuyrukludur, T.INV sol kuyrukludur;
 * FINV sağ kuyruk, F.INV sol kuyruk; QUARTILE.EXC ile QUARTILE.INC ayrı formüllerdir. Her eski ad
 * burada KENDİ tanımıyla kaydedilir; körlemesine eşleme sessiz yanlış sonuç üretirdi.
 *
 * ORTAK TUZAK 3 — BOŞ HÜCRE (null) SIFIR DEĞİLDİR.
 * COUNT boşu saymaz, AVERAGE boşu paydaya katmaz. A'lı sürümler (AVERAGEA, MAXA, STDEVA …) boşu
 * yine atlar ama METNİ sıfır sayar — bu iki kural karıştırılmaya çok müsaittir.
 *
 * SAYISAL ÇEKİRDEK. Bütün sürekli dağılımlar üç çekirdek işlevden türer: Lanczos yaklaşımıyla
 * gammaLn, sürekli kesirle düzenlenmiş eksik gama (gamaP / gamaQ) ve eksik beta (betaI). Ters
 * işlevler ikiye bölme ile 1e-15 bağıl duyarlığa kadar çözülür; normal dağılımın tersi ayrıca
 * Halley iyileştirmesi görür. Tek bir çekirdek doğru olduğunda on beş işlev birden doğrulanır.
 */

import { ERR, hata, num, metinSayi, mat, duzle, olcut, kaydetHepsi } from './xlfn.js';

// =================================================================================
// Argüman toplama
// =================================================================================

/** Düz liste (boşlar korunur) */
const duz = (v) => (Array.isArray(v) ? duzle([v]) : [v]);

/**
 * i. argüman ARALIK mı? Değerlendirilmiş değer dizi ise kesin aralıktır; tek hücrelik başvuru
 * dizi değildir, onu ancak ayrıştırma ağacı ele verir.
 */
function aralikMi(dugum, i, deger) {
  if (Array.isArray(deger)) return true;
  let d = dugum && dugum.args && dugum.args[i];
  while (d && d.t === 'par') d = d.v;
  if (!d) return false;
  if (d.t === 'ref' || d.t === 'name') return true;
  return d.t === 'iki' && (d.op === ':' || d.op === ' ');
}

/**
 * Toplama ailesinin ortak süzgeci.
 *   kip 0 : AVERAGE / MAX / STDEV … — aralıktaki metin ve mantık atlanır
 *   kip 1 : AVERAGEA / MAXA / STDEVA … — aralıktaki metin 0, mantık 0/1 sayılır
 * Hata bulursa fırlatır; çağıran çerçeve (xlfn.cagir) yakalayıp değer olarak döndürür.
 */
function sayiTopla(args, dugum, kip) {
  const o = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const aralik = aralikMi(dugum, i, a);
    for (const v of duz(a)) {
      if (hata(v)) throw v;
      if (v == null) continue;
      if (typeof v === 'number') { o.push(v); continue; }
      if (typeof v === 'boolean') { if (!aralik || kip === 1) o.push(v ? 1 : 0); continue; }
      if (aralik) { if (kip === 1) o.push(0); continue; }
      const n = metinSayi(v);
      if (isNaN(n)) throw ERR.VALUE;
      o.push(n);
    }
  }
  return o;
}

/** Dizi argümanı → sayı listesi (dizinin içindeki metin/mantık/boş atlanır, hata yayılır) */
function dizi(v) {
  if (!Array.isArray(v)) {
    if (v == null) return [];
    const n = num(v);
    if (hata(n)) throw n;
    return [n];
  }
  const o = [];
  for (const x of duzle([v])) {
    if (hata(x)) throw x;
    if (typeof x === 'number') o.push(x);
  }
  return o;
}

/** Sayıya zorlar, hatayı fırlatır */
function sy(v) { const x = num(v); if (hata(x)) throw x; return x; }
/** Mantığa zorlar (varsayılanlı) */
function mn(v, varsayilan) {
  if (v == null) return varsayilan;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (hata(v)) throw v;
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  throw ERR.VALUE;
}
/*
 * Zorunlu "birikimli" bayrağı. Excel'de BOŞ bırakılan zorunlu argüman 0 demektir, 0 da YANLIŞ'tır:
 * =NORM.DIST(42;40;1,5;) yoğunluğu verir, dağılımı değil. Seçimlik bayraklar (LINEST'in const'u
 * gibi) bunu kullanmaz, kendi varsayılanlarıyla mn() çağırır.
 */
const birikimli = (v) => mn(v, false);
const tam = (x) => Math.trunc(x);
const artan = (a) => a.slice().sort((x, y) => x - y);
const topl = (a) => a.reduce((x, y) => x + y, 0);
const ort = (a) => topl(a) / a.length;
const sonlu = (v) => (isFinite(v) ? v : ERR.NUM);

/** İki diziyi konum konum eşler; sayı olmayan çiftleri atar (CORREL, SLOPE … kuralı) */
function ciftle(ay, ax) {
  const A = duz(ay), B = duz(ax);
  if (A.length !== B.length) throw ERR.NA;
  const Y = [], X = [];
  for (let i = 0; i < A.length; i++) {
    const u = A[i], v = B[i];
    if (hata(u)) throw u;
    if (hata(v)) throw v;
    if (typeof u !== 'number' || typeof v !== 'number') continue;
    Y.push(u); X.push(v);
  }
  return { Y, X };
}

// =================================================================================
// Sayısal çekirdek — gama, beta, normal
// =================================================================================

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
const LN_2PI_YARIM = 0.9189385332046728;   // ln(2π)/2

/** ln|Γ(x)| — Lanczos (g = 7, n = 9); x < 0,5 için yansıma bağıntısı */
function gammaLn(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - gammaLn(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < 8; i++) a += LANCZOS[i] / (z + i + 1);
  const t = z + 7.5;
  return LN_2PI_YARIM + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Γ(x) — sıfır ve negatif tam sayılarda kutup vardır */
function gammaFn(x) {
  if (x <= 0 && x === Math.round(x)) throw ERR.NUM;
  // Küçük tam sayılarda çarpım TAM sonuç verir; exp(gammaLn) 24 yerine 23,99999999999996 döndürür.
  if (x === Math.round(x) && x > 0 && x <= 171) { let t = 1; for (let i = 2; i < x; i++) t *= i; return t; }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * Math.exp(gammaLn(1 - x)));
  return Math.exp(gammaLn(x));
}

/** ln C(n, k) — büyük n'de taşmasın diye logaritmadan */
const lnBirlesim = (n, k) => gammaLn(n + 1) - gammaLn(k + 1) - gammaLn(n - k + 1);
/** C(n, k) tam sayı olarak; 2^53'ü aşacaksa null (o zaman logaritmalı yol kullanılır) */
function birlesimTam(n, k) {
  if (n > 1030 || k < 0 || k > n || n !== Math.round(n) || k !== Math.round(k)) return null;
  if (k > n - k) k = n - k;
  let r = 1;
  for (let i = 1; i <= k; i++) { r = r * (n - k + i) / i; if (r > 9e15) return null; }
  return Math.round(r);
}

/** Düzenlenmiş eksik gama P(a,x), seri açılım (x küçükken hızlı yakınsar) */
function gamaSeri(a, x) {
  let ap = a, terim = 1 / a, top = terim;
  for (let i = 0; i < 2000; i++) {
    ap += 1; terim *= x / ap; top += terim;
    if (Math.abs(terim) < Math.abs(top) * 1e-17) break;
  }
  return top * Math.exp(-x + a * Math.log(x) - gammaLn(a));
}
/** Düzenlenmiş eksik gama Q(a,x), sürekli kesir (x büyükken seri yerine bu kullanılır) */
function gamaKesir(a, x) {
  const KUCUK = 1e-300;
  let b = x + 1 - a, c = 1 / KUCUK, d = 1 / b, h = d;
  for (let i = 1; i <= 2000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < KUCUK) d = KUCUK;
    c = b + an / c; if (Math.abs(c) < KUCUK) c = KUCUK;
    d = 1 / d;
    const carp = d * c; h *= carp;
    if (Math.abs(carp - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h;
}
const gamaP = (a, x) => (x <= 0 ? 0 : x < a + 1 ? gamaSeri(a, x) : 1 - gamaKesir(a, x));
const gamaQ = (a, x) => (x <= 0 ? 1 : x < a + 1 ? 1 - gamaSeri(a, x) : gamaKesir(a, x));

/** gamaP(a, x) = p denklemini x için çözer (ikiye bölme; üst sınır ikiye katlayarak bulunur) */
function gamaTers(p, a) {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let ust = Math.max(1, a);
  while (gamaP(a, ust) < p && ust < 1e300) ust *= 2;
  let alt = 0;
  for (let i = 0; i < 300; i++) {
    const o = alt + (ust - alt) / 2;
    if (o === alt || o === ust) break;
    if (gamaP(a, o) < p) alt = o; else ust = o;
    if (ust - alt < 1e-15 * Math.max(1, ust)) break;
  }
  return alt + (ust - alt) / 2;
}

/** Eksik beta için Lentz sürekli kesri */
function betaKesir(a, b, x) {
  const KUCUK = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < KUCUK) d = KUCUK;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < KUCUK) d = KUCUK;
    c = 1 + aa / c; if (Math.abs(c) < KUCUK) c = KUCUK;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < KUCUK) d = KUCUK;
    c = 1 + aa / c; if (Math.abs(c) < KUCUK) c = KUCUK;
    d = 1 / d;
    const carp = d * c; h *= carp;
    if (Math.abs(carp - 1) < 1e-16) break;
  }
  return h;
}
/** Düzenlenmiş eksik beta I_x(a,b) */
function betaI(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const on = Math.exp(gammaLn(a + b) - gammaLn(a) - gammaLn(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? on * betaKesir(a, b, x) / a : 1 - on * betaKesir(b, a, 1 - x) / b;
}
/** I_x(a,b) = p denklemini x için çözer; [0,1] kapalı olduğundan ikiye bölme yeter */
function betaTers(p, a, b) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let alt = 0, ust = 1;
  for (let i = 0; i < 200; i++) {
    const o = (alt + ust) / 2;
    if (o === alt || o === ust) break;
    if (betaI(a, b, o) < p) alt = o; else ust = o;
    if (ust - alt < 1e-16) break;
  }
  return (alt + ust) / 2;
}

const KOK2PI = Math.sqrt(2 * Math.PI);
const normPdf = (z) => Math.exp(-z * z / 2) / KOK2PI;
/*
 * Φ(z). Sol kuyruk doğrudan 1 - 0,5·Q ile hesaplansaydı z çok negatifken anlamlı hane kalmazdı;
 * bu yüzden işarete göre daima KÜÇÜK olan kuyruk (gamaQ) kullanılır. gamaQ(1/2, z²/2) = erfc(|z|/√2).
 */
function normCdf(z) {
  const t = z * z / 2;
  return z >= 0 ? 1 - 0.5 * gamaQ(0.5, t) : 0.5 * gamaQ(0.5, t);
}
const AKL_A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const AKL_B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const AKL_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const AKL_D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
/** Φ⁻¹(p) — Acklam rasyonel yaklaşımı (≈1e-9) + Halley iyileştirmesi (≈1e-15) */
function normTers(p) {
  let z;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    z = (((((AKL_C[0] * q + AKL_C[1]) * q + AKL_C[2]) * q + AKL_C[3]) * q + AKL_C[4]) * q + AKL_C[5]) /
        ((((AKL_D[0] * q + AKL_D[1]) * q + AKL_D[2]) * q + AKL_D[3]) * q + 1);
  } else if (p <= 0.97575) {
    const q = p - 0.5, r = q * q;
    z = (((((AKL_A[0] * r + AKL_A[1]) * r + AKL_A[2]) * r + AKL_A[3]) * r + AKL_A[4]) * r + AKL_A[5]) * q /
        (((((AKL_B[0] * r + AKL_B[1]) * r + AKL_B[2]) * r + AKL_B[3]) * r + AKL_B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    z = -(((((AKL_C[0] * q + AKL_C[1]) * q + AKL_C[2]) * q + AKL_C[3]) * q + AKL_C[4]) * q + AKL_C[5]) /
        ((((AKL_D[0] * q + AKL_D[1]) * q + AKL_D[2]) * q + AKL_D[3]) * q + 1);
  }
  for (let i = 0; i < 3; i++) {
    const yg = normPdf(z);
    if (yg === 0) break;
    const u = (normCdf(z) - p) / yg;
    z -= u / (1 + z * u / 2);
  }
  return z;
}

// t, F, ki-kare — hepsi eksik beta / eksik gamadan türer
function tCdf(t, df) {
  const yari = betaI(df / 2, 0.5, df / (df + t * t)) / 2;
  return t >= 0 ? 1 - yari : yari;
}
const tPdf = (t, df) => Math.exp(gammaLn((df + 1) / 2) - gammaLn(df / 2)) / Math.sqrt(df * Math.PI) * Math.pow(1 + t * t / df, -(df + 1) / 2);
/** İki kuyruklu t olasılığı: P(|T| > t) = I_{df/(df+t²)}(df/2, 1/2) — kapalı biçim, kök aramaya gerek yok */
const tIkiKuyruk = (t, df) => betaI(df / 2, 0.5, df / (df + t * t));
/** Sol kuyruk tersi; iki kuyruklu olasılık üzerinden BETA.INV ile çözülür */
function tTers(p, df) {
  if (p === 0.5) return 0;
  const cift = p < 0.5 ? 2 * p : 2 * (1 - p);
  const x = betaTers(cift, df / 2, 0.5);
  if (x <= 0) return p < 0.5 ? -Infinity : Infinity;
  const t = Math.sqrt(df * (1 - x) / x);
  return p < 0.5 ? -t : t;
}

const fCdf = (f, d1, d2) => (f <= 0 ? 0 : betaI(d1 / 2, d2 / 2, d1 * f / (d1 * f + d2)));
function fPdf(f, d1, d2) {
  if (f < 0) return 0;
  if (f === 0) return d1 > 2 ? 0 : d1 === 2 ? 1 : Infinity;
  const lg = gammaLn((d1 + d2) / 2) - gammaLn(d1 / 2) - gammaLn(d2 / 2);
  return Math.exp(lg + (d1 / 2) * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(f) - ((d1 + d2) / 2) * Math.log(1 + d1 * f / d2));
}
function fTers(p, d1, d2) {
  const x = betaTers(p, d1 / 2, d2 / 2);
  if (x >= 1) return Infinity;
  return d2 * x / (d1 * (1 - x));
}

const chiCdf = (x, df) => (x <= 0 ? 0 : gamaP(df / 2, x / 2));
function chiPdf(x, df) {
  if (x < 0) return 0;
  if (x === 0) return df === 2 ? 0.5 : df < 2 ? Infinity : 0;
  return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - gammaLn(df / 2) - (df / 2) * Math.LN2);
}
const chiTers = (p, df) => 2 * gamaTers(p, df / 2);

// =================================================================================
// Betimleyici istatistik
// =================================================================================

function varyans(a, orneklem) {
  const n = a.length;
  const payda = orneklem ? n - 1 : n;
  if (payda < 1) throw ERR.DIV0;
  const m = ort(a);
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return s / payda;
}

kaydetHepsi({
  AVERAGE: { en: 1, ek: -1, fn: (a, c, d) => { const s = sayiTopla(a, d, 0); return s.length ? ort(s) : ERR.DIV0; } },
  AVERAGEA: { en: 1, ek: -1, fn: (a, c, d) => { const s = sayiTopla(a, d, 1); return s.length ? ort(s) : ERR.DIV0; } },
  MAX: { en: 1, ek: -1, fn: (a, c, d) => { const s = sayiTopla(a, d, 0); return s.length ? Math.max(...s) : 0; } },
  MAXA: { en: 1, ek: -1, fn: (a, c, d) => { const s = sayiTopla(a, d, 1); return s.length ? Math.max(...s) : 0; } },
  MIN: { en: 1, ek: -1, fn: (a, c, d) => { const s = sayiTopla(a, d, 0); return s.length ? Math.min(...s) : 0; } },
  MINA: { en: 1, ek: -1, fn: (a, c, d) => { const s = sayiTopla(a, d, 1); return s.length ? Math.min(...s) : 0; } },
  MEDIAN: {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = artan(sayiTopla(a, d, 0));
      if (!s.length) return ERR.NUM;
      const y = s.length >> 1;
      return s.length % 2 ? s[y] : (s[y - 1] + s[y]) / 2;
    },
  },
  VAR: { en: 1, ek: -1, fn: (a, c, d) => varyans(sayiTopla(a, d, 0), true) },
  'VAR.S': { en: 1, ek: -1, fn: (a, c, d) => varyans(sayiTopla(a, d, 0), true) },
  VARP: { en: 1, ek: -1, fn: (a, c, d) => varyans(sayiTopla(a, d, 0), false) },
  'VAR.P': { en: 1, ek: -1, fn: (a, c, d) => varyans(sayiTopla(a, d, 0), false) },
  VARA: { en: 1, ek: -1, fn: (a, c, d) => varyans(sayiTopla(a, d, 1), true) },
  VARPA: { en: 1, ek: -1, fn: (a, c, d) => varyans(sayiTopla(a, d, 1), false) },
  STDEV: { en: 1, ek: -1, fn: (a, c, d) => Math.sqrt(varyans(sayiTopla(a, d, 0), true)) },
  'STDEV.S': { en: 1, ek: -1, fn: (a, c, d) => Math.sqrt(varyans(sayiTopla(a, d, 0), true)) },
  STDEVP: { en: 1, ek: -1, fn: (a, c, d) => Math.sqrt(varyans(sayiTopla(a, d, 0), false)) },
  'STDEV.P': { en: 1, ek: -1, fn: (a, c, d) => Math.sqrt(varyans(sayiTopla(a, d, 0), false)) },
  STDEVA: { en: 1, ek: -1, fn: (a, c, d) => Math.sqrt(varyans(sayiTopla(a, d, 1), true)) },
  STDEVPA: { en: 1, ek: -1, fn: (a, c, d) => Math.sqrt(varyans(sayiTopla(a, d, 1), false)) },
  DEVSQ: {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = sayiTopla(a, d, 0);
      if (!s.length) return ERR.NUM;
      const m = ort(s);
      return topl(s.map(x => (x - m) * (x - m)));
    },
  },
  AVEDEV: {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = sayiTopla(a, d, 0);
      if (!s.length) return ERR.NUM;
      const m = ort(s);
      return ort(s.map(x => Math.abs(x - m)));
    },
  },
  GEOMEAN: {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = sayiTopla(a, d, 0);
      if (!s.length) return ERR.NUM;
      let l = 0;
      for (const x of s) { if (x <= 0) return ERR.NUM; l += Math.log(x); }
      return Math.exp(l / s.length);
    },
  },
  HARMEAN: {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = sayiTopla(a, d, 0);
      if (!s.length) return ERR.NUM;
      let t = 0;
      for (const x of s) { if (x <= 0) return ERR.NUM; t += 1 / x; }
      return s.length / t;
    },
  },
  SKEW: {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = sayiTopla(a, d, 0), n = s.length;
      if (n < 3) return ERR.DIV0;
      const m = ort(s), ss = Math.sqrt(varyans(s, true));
      if (ss === 0) return ERR.DIV0;
      return n / ((n - 1) * (n - 2)) * topl(s.map(x => Math.pow((x - m) / ss, 3)));
    },
  },
  'SKEW.P': {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = sayiTopla(a, d, 0), n = s.length;
      if (n < 3) return ERR.DIV0;
      const m = ort(s), ss = Math.sqrt(varyans(s, false));
      if (ss === 0) return ERR.DIV0;
      return topl(s.map(x => Math.pow((x - m) / ss, 3))) / n;
    },
  },
  KURT: {
    en: 1, ek: -1,
    fn: (a, c, d) => {
      const s = sayiTopla(a, d, 0), n = s.length;
      if (n < 4) return ERR.DIV0;
      const m = ort(s), ss = Math.sqrt(varyans(s, true));
      if (ss === 0) return ERR.DIV0;
      const t = topl(s.map(x => Math.pow((x - m) / ss, 4)));
      return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * t - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
    },
  },
  TRIMMEAN: {
    en: 2, ek: 2,
    fn: (a) => {
      const s = artan(dizi(a[0])), p = sy(a[1]);
      if (p < 0 || p > 1) return ERR.NUM;
      const n = s.length;
      if (!n) return ERR.NUM;
      // Dışarıda bırakılacak nokta sayısı 2'nin katına AŞAĞI yuvarlanır (iki uçtan eşit atılır).
      const k = Math.floor(n * p / 2);
      const kalan = s.slice(k, n - k);
      return kalan.length ? ort(kalan) : ERR.NUM;
    },
  },
});

// =================================================================================
// Sayma ve ölçütlü toplamlar
// =================================================================================

kaydetHepsi({
  COUNT: {
    en: 1, ek: -1, hatasiz: true,
    fn: (a, c, d) => {
      let n = 0;
      for (let i = 0; i < a.length; i++) {
        const aralik = aralikMi(d, i, a[i]);
        for (const v of duz(a[i])) {
          if (v == null || hata(v)) continue;   // COUNT hatayı SAYMAZ ve yaymaz
          if (typeof v === 'number') { n++; continue; }
          if (typeof v === 'boolean') { if (!aralik) n++; continue; }
          if (!aralik && !isNaN(metinSayi(v))) n++;
        }
      }
      return n;
    },
  },
  COUNTA: {
    en: 1, ek: -1, hatasiz: true,
    // Boş olmayan her şeyi sayar: hata değerleri ve formülden gelen "" DAHİL.
    fn: (a) => { let n = 0; for (const x of a) for (const v of duz(x)) if (v != null) n++; return n; },
  },
  COUNTBLANK: {
    en: 1, ek: 1, hatasiz: true,
    fn: (a) => { let n = 0; for (const v of duz(a[0])) if (v == null || v === '') n++; return n; },
  },
  COUNTIF: {
    en: 2, ek: 2, hatasiz: true,
    fn: (a) => {
      if (hata(a[1])) return a[1];
      const f = olcut(Array.isArray(a[1]) ? duz(a[1])[0] : a[1]);
      let n = 0;
      for (const v of duz(a[0])) if (!hata(v) && f(v)) n++;
      return n;
    },
  },
  COUNTIFS: {
    en: 2, ek: -1, hatasiz: true,
    fn: (a) => {
      if (a.length % 2) return ERR.VALUE;
      const c = ciftAyikla(a, 0);
      if (hata(c)) return c;
      return olcutSay(c);
    },
  },
  AVERAGEIF: {
    en: 2, ek: 3, hatasiz: true,
    fn: (a) => {
      if (hata(a[1])) return a[1];
      const r = duz(a[0]), f = olcut(Array.isArray(a[1]) ? duz(a[1])[0] : a[1]);
      const t = a.length > 2 && a[2] != null ? duz(a[2]) : r;
      let s = 0, n = 0;
      for (let i = 0; i < r.length; i++) {
        if (hata(r[i]) || !f(r[i])) continue;
        const v = t[i];
        if (hata(v)) return v;
        if (typeof v === 'number') { s += v; n++; }
      }
      return n ? s / n : ERR.DIV0;
    },
  },
  AVERAGEIFS: {
    en: 3, ek: -1, hatasiz: true,
    fn: (a) => {
      if (a.length % 2 === 0) return ERR.VALUE;
      const c = ciftAyikla(a, 1);
      if (hata(c)) return c;
      const t = duz(a[0]);
      let s = 0, n = 0;
      for (const i of olcutDizin(c, t.length)) {
        const v = t[i];
        if (hata(v)) return v;
        if (typeof v === 'number') { s += v; n++; }
      }
      return n ? s / n : ERR.DIV0;
    },
  },
  MAXIFS: { en: 3, ek: -1, hatasiz: true, fn: (a) => ucIf(a, true) },
  MINIFS: { en: 3, ek: -1, hatasiz: true, fn: (a) => ucIf(a, false) },
});

/** [aralık, ölçüt] çiftlerini bas'tan başlayarak ayıklar */
function ciftAyikla(a, bas) {
  const o = [];
  for (let i = bas; i + 1 < a.length; i += 2) {
    if (hata(a[i + 1])) return a[i + 1];
    o.push([duz(a[i]), olcut(Array.isArray(a[i + 1]) ? duz(a[i + 1])[0] : a[i + 1])]);
  }
  return o;
}
/** Bütün ölçütleri sağlayan konumların dizini */
function olcutDizin(ciftler, uzunluk) {
  const n = uzunluk != null ? uzunluk : (ciftler[0] ? ciftler[0][0].length : 0);
  const o = [];
  for (let i = 0; i < n; i++) {
    let uydu = true;
    for (const [liste, f] of ciftler) {
      const v = liste[i] === undefined ? null : liste[i];
      if (hata(v) || !f(v)) { uydu = false; break; }
    }
    if (uydu) o.push(i);
  }
  return o;
}
const olcutSay = (ciftler) => olcutDizin(ciftler).length;

function ucIf(a, enBuyuk) {
  if (a.length % 2 === 0) return ERR.VALUE;
  const c = ciftAyikla(a, 1);
  if (hata(c)) return c;
  const t = duz(a[0]);
  let s = null;
  for (const i of olcutDizin(c, t.length)) {
    const v = t[i];
    if (hata(v)) return v;
    if (typeof v !== 'number') continue;
    if (s == null || (enBuyuk ? v > s : v < s)) s = v;
  }
  return s == null ? 0 : s;   // eşleşme yoksa Excel 0 verir, hata değil
}

// =================================================================================
// Sıra istatistikleri
// =================================================================================

/** PERCENTILE.INC: doğrusal aradeğerleme, konum k·(n-1) */
function yuzdelikInc(s, k) {
  const n = s.length;
  if (!n) return ERR.NUM;
  if (k < 0 || k > 1) return ERR.NUM;
  if (n === 1) return s[0];
  const yer = k * (n - 1);
  const i = Math.floor(yer), f = yer - i;
  return f === 0 ? s[i] : s[i] + f * (s[i + 1] - s[i]);
}
/** PERCENTILE.EXC: konum k·(n+1); 1 ile n arasında değilse Excel #NUM! verir */
function yuzdelikExc(s, k) {
  const n = s.length;
  if (!n) return ERR.NUM;
  const yer = k * (n + 1);
  if (yer < 1 || yer > n) return ERR.NUM;
  const i = Math.floor(yer), f = yer - i;
  if (i >= n) return s[n - 1];
  return f === 0 ? s[i - 1] : s[i - 1] + f * (s[i] - s[i - 1]);
}
/** PERCENTRANK: disla=false → (n-1) tabanlı, disla=true → (n+1) tabanlı */
function yuzdeSira(s, x, disla) {
  const n = s.length;
  if (!n) return ERR.NUM;
  if (x < s[0] || x > s[n - 1]) return ERR.NA;
  const pay = disla ? n + 1 : n - 1;
  if (pay === 0) return 1;
  const tam0 = s.indexOf(x);   // yinelenen değerde İLK konum esas alınır
  if (tam0 >= 0) return disla ? (tam0 + 1) / pay : tam0 / pay;
  let j = 0;
  while (j < n - 1 && s[j + 1] < x) j++;
  const t = (x - s[j]) / (s[j + 1] - s[j]);
  return disla ? (j + 1 + t) / pay : (j + t) / pay;
}
/** Excel sonucu anlamlı hane sayısına YUVARLAMAZ, KESER */
const kes = (v, hane) => {
  const c = Math.pow(10, hane);
  const x = v * c, y = Math.round(x);
  // 0,7 · 1000 kayan noktada 699,9999999999999'dur; ham kesme 0,699 verirdi.
  return (Math.abs(x - y) < 1e-9 ? y : Math.trunc(x)) / c;
};

kaydetHepsi({
  LARGE: {
    en: 2, ek: 2,
    fn: (a) => {
      const s = artan(dizi(a[0])), k = tam(sy(a[1]));
      if (!s.length || k < 1 || k > s.length) return ERR.NUM;
      return s[s.length - k];
    },
  },
  SMALL: {
    en: 2, ek: 2,
    fn: (a) => {
      const s = artan(dizi(a[0])), k = tam(sy(a[1]));
      if (!s.length || k < 1 || k > s.length) return ERR.NUM;
      return s[k - 1];
    },
  },
  MODE: { en: 1, ek: -1, fn: (a, c, d) => kip(sayiTopla(a, d, 0), false) },
  'MODE.SNGL': { en: 1, ek: -1, fn: (a, c, d) => kip(sayiTopla(a, d, 0), false) },
  'MODE.MULT': { en: 1, ek: -1, fn: (a, c, d) => kip(sayiTopla(a, d, 0), true) },
  RANK: { en: 2, ek: 3, fn: (a) => sira(a, false) },
  'RANK.EQ': { en: 2, ek: 3, fn: (a) => sira(a, false) },
  'RANK.AVG': { en: 2, ek: 3, fn: (a) => sira(a, true) },
  PERCENTILE: { en: 2, ek: 2, fn: (a) => yuzdelikInc(artan(dizi(a[0])), sy(a[1])) },
  'PERCENTILE.INC': { en: 2, ek: 2, fn: (a) => yuzdelikInc(artan(dizi(a[0])), sy(a[1])) },
  'PERCENTILE.EXC': { en: 2, ek: 2, fn: (a) => yuzdelikExc(artan(dizi(a[0])), sy(a[1])) },
  QUARTILE: { en: 2, ek: 2, fn: (a) => dortteBir(a, false) },
  'QUARTILE.INC': { en: 2, ek: 2, fn: (a) => dortteBir(a, false) },
  'QUARTILE.EXC': { en: 2, ek: 2, fn: (a) => dortteBir(a, true) },
  PERCENTRANK: { en: 2, ek: 3, fn: (a) => yuzdeSiraIslev(a, false) },
  'PERCENTRANK.INC': { en: 2, ek: 3, fn: (a) => yuzdeSiraIslev(a, false) },
  'PERCENTRANK.EXC': { en: 2, ek: 3, fn: (a) => yuzdeSiraIslev(a, true) },
});

function kip(s, coklu) {
  const sayac = new Map();
  for (const x of s) sayac.set(x, (sayac.get(x) || 0) + 1);
  let enCok = 0;
  for (const v of sayac.values()) if (v > enCok) enCok = v;
  if (enCok < 2) return ERR.NA;
  const o = [];
  for (const [k, v] of sayac) if (v === enCok) o.push(k);
  return coluIle(o, coklu);
}
const coluIle = (o, coklu) => (coklu ? o.map(x => [x]) : o[0]);

function sira(a, ortala) {
  const x = sy(a[0]), s = dizi(a[1]);
  const kucuktenBuyuge = a.length > 2 && a[2] != null ? sy(a[2]) !== 0 : false;
  if (!s.length) return ERR.NA;
  let kucuk = 0, buyuk = 0, esit = 0;
  for (const v of s) { if (v < x) kucuk++; else if (v > x) buyuk++; else esit++; }
  if (!esit) return ERR.NA;
  const r = kucuktenBuyuge ? kucuk + 1 : buyuk + 1;
  // RANK.AVG eşitlerin kapladığı aralığın ORTASINI verir: r, r+1 … r+esit-1 ortalaması.
  return ortala ? r + (esit - 1) / 2 : r;
}

function dortteBir(a, disla) {
  const s = artan(dizi(a[0])), q = tam(sy(a[1]));
  if (disla) {
    if (q < 1 || q > 3) return ERR.NUM;   // .EXC uçları veremez: 0 ve 4 tanımsızdır
    return yuzdelikExc(s, q / 4);
  }
  if (q < 0 || q > 4) return ERR.NUM;
  return yuzdelikInc(s, q / 4);
}

function yuzdeSiraIslev(a, disla) {
  const s = artan(dizi(a[0])), x = sy(a[1]);
  const hane = a.length > 2 && a[2] != null ? tam(sy(a[2])) : 3;
  if (hane < 1) return ERR.NUM;
  const v = yuzdeSira(s, x, disla);
  return hata(v) ? v : kes(v, hane);
}

// =================================================================================
// İki değişkenli çözümleme
// =================================================================================

function esYonlu(Y, X) {
  const n = Y.length;
  if (n < 1) throw ERR.DIV0;
  const my = ort(Y), mx = ort(X);
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const dx = X[i] - mx, dy = Y[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  return { n, my, mx, sxx, syy, sxy };
}

kaydetHepsi({
  CORREL: { en: 2, ek: 2, fn: (a) => iliski(a) },
  PEARSON: { en: 2, ek: 2, fn: (a) => iliski(a) },
  RSQ: { en: 2, ek: 2, fn: (a) => { const r = iliski(a); return hata(r) ? r : r * r; } },
  COVAR: { en: 2, ek: 2, fn: (a) => ortakDegisim(a, false) },
  'COVARIANCE.P': { en: 2, ek: 2, fn: (a) => ortakDegisim(a, false) },
  'COVARIANCE.S': { en: 2, ek: 2, fn: (a) => ortakDegisim(a, true) },
  SLOPE: {
    en: 2, ek: 2,
    fn: (a) => { const { Y, X } = ciftle(a[0], a[1]); const s = esYonlu(Y, X); return s.n < 2 || s.sxx === 0 ? ERR.DIV0 : s.sxy / s.sxx; },
  },
  INTERCEPT: {
    en: 2, ek: 2,
    fn: (a) => { const { Y, X } = ciftle(a[0], a[1]); const s = esYonlu(Y, X); return s.n < 2 || s.sxx === 0 ? ERR.DIV0 : s.my - s.sxy / s.sxx * s.mx; },
  },
  FORECAST: { en: 3, ek: 3, fn: (a) => kestir(a) },
  'FORECAST.LINEAR': { en: 3, ek: 3, fn: (a) => kestir(a) },
  STEYX: {
    en: 2, ek: 2,
    fn: (a) => {
      const { Y, X } = ciftle(a[0], a[1]);
      const s = esYonlu(Y, X);
      if (s.n < 3) return ERR.DIV0;
      if (s.sxx === 0) return ERR.DIV0;
      return Math.sqrt((s.syy - s.sxy * s.sxy / s.sxx) / (s.n - 2));
    },
  },
  STANDARDIZE: {
    en: 3, ek: 3,
    fn: (a) => { const x = sy(a[0]), m = sy(a[1]), ss = sy(a[2]); return ss <= 0 ? ERR.NUM : (x - m) / ss; },
  },
});

function iliski(a) {
  const { Y, X } = ciftle(a[0], a[1]);
  const s = esYonlu(Y, X);
  if (s.n < 2) return ERR.DIV0;
  const p = Math.sqrt(s.sxx * s.syy);
  return p === 0 ? ERR.DIV0 : s.sxy / p;
}
function ortakDegisim(a, orneklem) {
  const { Y, X } = ciftle(a[0], a[1]);
  const s = esYonlu(Y, X);
  const payda = orneklem ? s.n - 1 : s.n;
  return payda < 1 ? ERR.DIV0 : s.sxy / payda;
}
function kestir(a) {
  const x = sy(a[0]);
  const { Y, X } = ciftle(a[1], a[2]);
  const s = esYonlu(Y, X);
  if (s.n < 1 || s.sxx === 0) return ERR.DIV0;
  const m = s.sxy / s.sxx;
  return s.my + m * (x - s.mx);
}

// =================================================================================
// Doğrusal / üstel bağlanım — LINEST, LOGEST, TREND, GROWTH
// =================================================================================

/**
 * Normal denklemlerle en küçük kareler. X: gözlem başına bir satır.
 * [A | I | g] üzerinde Gauss-Jordan uygulanır; aynı geçişte hem katsayılar hem de ters matris
 * çıkar — standart hatalar (LINEST'in 2. satırı) ters matrisin köşegeninden gelir.
 */
function ekk(Y, X, sabit) {
  const n = Y.length, k = X[0].length, p = k + (sabit ? 1 : 0);
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const g = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const r = sabit ? [1].concat(X[i]) : X[i];
    for (let u = 0; u < p; u++) { g[u] += r[u] * Y[i]; for (let v = 0; v < p; v++) A[u][v] += r[u] * r[v]; }
  }
  const G = 2 * p + 1;
  const M = A.map((r, i) => r.concat(Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)), [g[i]]));
  for (let c = 0; c < p; c++) {
    let mx = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[mx][c])) mx = r;
    if (Math.abs(M[mx][c]) < 1e-300) return null;
    const tt = M[c]; M[c] = M[mx]; M[mx] = tt;
    const pv = M[c][c];
    for (let q = 0; q < G; q++) M[c][q] /= pv;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let q = 0; q < G; q++) M[r][q] -= f * M[c][q];
    }
  }
  const b = M.map(r => r[G - 1]);
  const ters = M.map(r => r.slice(p, 2 * p));
  const egim = sabit ? b.slice(1) : b.slice();
  return { kesme: sabit ? b[0] : 0, egim, ters, p, k, sabit, n };
}

/** known_y / known_x argümanlarını gözlem dizisine çevirir */
function bagimlanimVeri(ay, ax) {
  const Ym = mat(ay);
  const Y = [];
  for (const sat of Ym) for (const v of sat) { if (hata(v)) throw v; if (v == null) continue; const q = num(v); if (hata(q)) throw q; Y.push(q); }
  const n = Y.length;
  if (!n) throw ERR.VALUE;
  let X;
  if (ax == null) {
    X = Array.from({ length: n }, (_, i) => [i + 1]);   // known_x yoksa 1,2,3 … kullanılır
  } else {
    const Xm = mat(ax);
    const sat = Xm.length, sut = Xm[0].length;
    let G;
    if (sat === n) G = Xm.map(r => r.slice());
    else if (sut === n) G = Array.from({ length: n }, (_, i) => Xm.map(r => r[i]));
    else throw ERR.REF;
    X = G.map(r => r.map(v => { if (hata(v)) throw v; const q = num(v); if (hata(q)) throw q; return q; }));
  }
  if (X.length !== n) throw ERR.REF;
  return { Y, X };
}

function linestCekirdek(a, log) {
  const sabit = a.length > 2 && a[2] != null ? mn(a[2], true) : true;
  const istat = a.length > 3 && a[3] != null ? mn(a[3], false) : false;
  let { Y, X } = bagimlanimVeri(a[0], a.length > 1 ? a[1] : null);
  if (log) { for (const y of Y) if (y <= 0) return ERR.NUM; Y = Y.map(Math.log); }
  const m = ekk(Y, X, sabit);
  if (!m) return ERR.NUM;
  const k = m.k, n = m.n;
  // 1. satır: katsayılar TERS sırada (mk … m1, b) — Excel'in yerleşimi budur
  const ust = m.egim.slice().reverse().concat([m.kesme]);
  const cevir = (v) => (log ? Math.exp(v) : v);
  if (!istat) return [ust.map(cevir)];
  let ssKalan = 0, ssTop = 0;
  const my = ort(Y);
  for (let i = 0; i < n; i++) {
    let t = m.kesme;
    for (let j = 0; j < k; j++) t += m.egim[j] * X[i][j];
    ssKalan += (Y[i] - t) * (Y[i] - t);
    ssTop += sabit ? (Y[i] - my) * (Y[i] - my) : Y[i] * Y[i];
  }
  const sd = n - m.p;
  const ssBag = ssTop - ssKalan;
  const seY = sd > 0 ? Math.sqrt(ssKalan / sd) : ERR.NA;
  const r2 = ssTop === 0 ? 1 : ssBag / ssTop;
  const F = sd > 0 && ssKalan > 0 && k > 0 ? (ssBag / k) / (ssKalan / sd) : ERR.NA;
  const se = [];
  for (let j = 0; j < m.p; j++) se.push(hata(seY) ? ERR.NA : seY * Math.sqrt(Math.abs(m.ters[j][j])));
  const seEgim = sabit ? se.slice(1) : se.slice();
  const seKesme = sabit ? se[0] : ERR.NA;   // sabit yokken kesme kestirilmez, Excel #N/A basar
  const ikinci = seEgim.slice().reverse().concat([seKesme]);
  const genislik = k + 1;
  const bosSatir = (ilk, ikinciDeger) => {
    const r = new Array(genislik).fill(ERR.NA);
    r[0] = ilk; if (genislik > 1) r[1] = ikinciDeger;
    return r;
  };
  return [
    ust.map(cevir), ikinci,
    bosSatir(r2, seY), bosSatir(F, sd), bosSatir(ssBag, ssKalan),
  ];
}

kaydetHepsi({
  LINEST: { en: 1, ek: 4, fn: (a) => linestCekirdek(a, false) },
  LOGEST: { en: 1, ek: 4, fn: (a) => linestCekirdek(a, true) },
  TREND: { en: 1, ek: 4, fn: (a) => egilim(a, false) },
  GROWTH: { en: 1, ek: 4, fn: (a) => egilim(a, true) },
  FREQUENCY: {
    en: 2, ek: 2,
    fn: (a) => {
      const veri = dizi(a[0]);
      const sinir = artan(dizi(a[1]));
      const say = new Array(sinir.length + 1).fill(0);   // sonuç HER ZAMAN sınır sayısından bir fazladır
      for (const v of veri) {
        let i = 0;
        while (i < sinir.length && v > sinir[i]) i++;
        say[i]++;
      }
      return say.map(x => [x]);
    },
  },
  PROB: {
    en: 3, ek: 4,
    fn: (a) => {
      const x = dizi(a[0]), p = dizi(a[1]);
      if (x.length !== p.length || !x.length) return ERR.NA;
      let t = 0;
      for (const v of p) { if (v <= 0 || v > 1) return ERR.NUM; t += v; }
      if (Math.abs(t - 1) > 1e-9) return ERR.NUM;
      const alt = sy(a[2]);
      const ust = a.length > 3 && a[3] != null ? sy(a[3]) : alt;
      let s = 0;
      for (let i = 0; i < x.length; i++) if (x[i] >= alt && x[i] <= ust) s += p[i];
      return s;
    },
  },
});

function egilim(a, log) {
  const sabit = a.length > 3 && a[3] != null ? mn(a[3], true) : true;
  let { Y, X } = bagimlanimVeri(a[0], a.length > 1 ? a[1] : null);
  if (log) { for (const y of Y) if (y <= 0) return ERR.NUM; Y = Y.map(Math.log); }
  const m = ekk(Y, X, sabit);
  if (!m) return ERR.NUM;
  const k = m.k;
  const hesaplaSatir = (r) => {
    let t = m.kesme;
    for (let j = 0; j < k; j++) t += m.egim[j] * r[j];
    return log ? Math.exp(t) : t;
  };
  const yeni = a.length > 2 && a[2] != null ? a[2] : null;
  if (yeni == null) {
    // new_x verilmediyse kestirim known_y'nin BİÇİMİNDE döner (yatay veri yatay sonuç verir)
    if (k === 1) { let i = 0; return mat(a[0]).map(sat => sat.map(() => hesaplaSatir(X[i++]))); }
    return X.map(r => [hesaplaSatir(r)]);
  }
  const Nm = mat(yeni);
  if (k === 1) {
    // Tek değişkende çıktı, new_x'in BİÇİMİNİ birebir korur (satır ise satır, sütun ise sütun)
    return Nm.map(sat => sat.map(v => { const q = num(v); if (hata(q)) throw q; return hesaplaSatir([q]); }));
  }
  let G;
  if (Nm[0].length === k) G = Nm;
  else if (Nm.length === k) G = Array.from({ length: Nm[0].length }, (_, i) => Nm.map(r => r[i]));
  else return ERR.REF;
  return G.map(r => [hesaplaSatir(r.map(v => { const q = num(v); if (hata(q)) throw q; return q; }))]);
}

// =================================================================================
// Normal ailesi
// =================================================================================

kaydetHepsi({
  'NORM.DIST': { en: 4, ek: 4, fn: (a) => normal(a) },
  NORMDIST: { en: 4, ek: 4, fn: (a) => normal(a) },
  'NORM.INV': { en: 3, ek: 3, fn: (a) => normalTers(a) },
  NORMINV: { en: 3, ek: 3, fn: (a) => normalTers(a) },
  'NORM.S.DIST': {
    en: 2, ek: 2,
    fn: (a) => { const z = sy(a[0]); return birikimli(a[1]) ? normCdf(z) : normPdf(z); },
  },
  NORMSDIST: { en: 1, ek: 1, fn: (a) => normCdf(sy(a[0])) },   // eski ad YALNIZ birikimlidir
  'NORM.S.INV': { en: 1, ek: 1, fn: (a) => { const p = sy(a[0]); return p <= 0 || p >= 1 ? ERR.NUM : normTers(p); } },
  NORMSINV: { en: 1, ek: 1, fn: (a) => { const p = sy(a[0]); return p <= 0 || p >= 1 ? ERR.NUM : normTers(p); } },
  GAUSS: { en: 1, ek: 1, fn: (a) => normCdf(sy(a[0])) - 0.5 },
  PHI: { en: 1, ek: 1, fn: (a) => normPdf(sy(a[0])) },
  'LOGNORM.DIST': {
    en: 4, ek: 4,
    fn: (a) => {
      const x = sy(a[0]), m = sy(a[1]), s = sy(a[2]);
      if (s <= 0 || x <= 0) return ERR.NUM;
      return birikimli(a[3]) ? normCdf((Math.log(x) - m) / s) : normPdf((Math.log(x) - m) / s) / (x * s);
    },
  },
  LOGNORMDIST: {
    en: 3, ek: 3,
    fn: (a) => { const x = sy(a[0]), m = sy(a[1]), s = sy(a[2]); return s <= 0 || x <= 0 ? ERR.NUM : normCdf((Math.log(x) - m) / s); },
  },
  'LOGNORM.INV': { en: 3, ek: 3, fn: (a) => logTers(a) },
  LOGINV: { en: 3, ek: 3, fn: (a) => logTers(a) },
  FISHER: { en: 1, ek: 1, fn: (a) => { const x = sy(a[0]); return x <= -1 || x >= 1 ? ERR.NUM : 0.5 * Math.log((1 + x) / (1 - x)); } },
  FISHERINV: { en: 1, ek: 1, fn: (a) => { const y = sy(a[0]); const e = Math.exp(2 * y); return sonlu(e) === ERR.NUM ? 1 : (e - 1) / (e + 1); } },
  CONFIDENCE: { en: 3, ek: 3, fn: (a) => guvenNorm(a) },
  'CONFIDENCE.NORM': { en: 3, ek: 3, fn: (a) => guvenNorm(a) },
  'CONFIDENCE.T': {
    en: 3, ek: 3,
    fn: (a) => {
      const al = sy(a[0]), s = sy(a[1]), n = tam(sy(a[2]));
      if (al <= 0 || al >= 1 || s <= 0 || n < 1) return ERR.NUM;
      if (n === 1) return ERR.DIV0;
      return tTers(1 - al / 2, n - 1) * s / Math.sqrt(n);
    },
  },
  'Z.TEST': { en: 2, ek: 3, fn: (a) => zSinama(a) },
  ZTEST: { en: 2, ek: 3, fn: (a) => zSinama(a) },
});

function normal(a) {
  const x = sy(a[0]), m = sy(a[1]), s = sy(a[2]);
  if (s <= 0) return ERR.NUM;
  const z = (x - m) / s;
  return birikimli(a[3]) ? normCdf(z) : normPdf(z) / s;
}
function normalTers(a) {
  const p = sy(a[0]), m = sy(a[1]), s = sy(a[2]);
  if (s <= 0) return ERR.NUM;
  if (p <= 0 || p >= 1) return ERR.NUM;
  return m + s * normTers(p);
}
function logTers(a) {
  const p = sy(a[0]), m = sy(a[1]), s = sy(a[2]);
  if (s <= 0 || p <= 0 || p >= 1) return ERR.NUM;
  return Math.exp(m + s * normTers(p));
}
function guvenNorm(a) {
  const al = sy(a[0]), s = sy(a[1]), n = tam(sy(a[2]));
  if (al <= 0 || al >= 1 || s <= 0 || n < 1) return ERR.NUM;
  return normTers(1 - al / 2) * s / Math.sqrt(n);
}
function zSinama(a) {
  const s = dizi(a[0]), x = sy(a[1]);
  const n = s.length;
  if (n < 1) return ERR.NA;
  const sigma = a.length > 2 && a[2] != null ? sy(a[2]) : Math.sqrt(varyans(s, true));
  if (sigma <= 0) return ERR.DIV0;
  return 1 - normCdf((ort(s) - x) / (sigma / Math.sqrt(n)));
}

// =================================================================================
// t ailesi
// =================================================================================

kaydetHepsi({
  'T.DIST': {
    en: 3, ek: 3,
    fn: (a) => {
      const x = sy(a[0]), df = tam(sy(a[1]));
      if (df < 1) return ERR.NUM;
      return birikimli(a[2]) ? tCdf(x, df) : tPdf(x, df);
    },
  },
  'T.DIST.2T': {
    en: 2, ek: 2,
    fn: (a) => { const x = sy(a[0]), df = tam(sy(a[1])); return x < 0 || df < 1 ? ERR.NUM : tIkiKuyruk(x, df); },
  },
  'T.DIST.RT': {
    en: 2, ek: 2,
    fn: (a) => { const x = sy(a[0]), df = tam(sy(a[1])); return df < 1 ? ERR.NUM : 1 - tCdf(x, df); },
  },
  TDIST: {
    en: 3, ek: 3,
    fn: (a) => {
      const x = sy(a[0]), df = tam(sy(a[1])), k = tam(sy(a[2]));
      if (x < 0 || df < 1 || (k !== 1 && k !== 2)) return ERR.NUM;   // eski TDIST negatif x kabul ETMEZ
      return k === 2 ? tIkiKuyruk(x, df) : tIkiKuyruk(x, df) / 2;
    },
  },
  'T.INV': {
    en: 2, ek: 2,
    fn: (a) => { const p = sy(a[0]), df = tam(sy(a[1])); return p <= 0 || p >= 1 || df < 1 ? ERR.NUM : tTers(p, df); },
  },
  'T.INV.2T': { en: 2, ek: 2, fn: (a) => tTersIki(a) },
  TINV: { en: 2, ek: 2, fn: (a) => tTersIki(a) },   // eski TINV İKİ kuyrukludur, T.INV ise sol kuyruk
  'T.TEST': { en: 4, ek: 4, fn: (a) => tSinama(a) },
  TTEST: { en: 4, ek: 4, fn: (a) => tSinama(a) },
});

function tTersIki(a) {
  const p = sy(a[0]), df = tam(sy(a[1]));
  if (p <= 0 || p > 1 || df < 1) return ERR.NUM;
  if (p === 1) return 0;
  const x = betaTers(p, df / 2, 0.5);
  if (x <= 0) return ERR.NUM;
  return Math.sqrt(df * (1 - x) / x);
}

function tSinama(a) {
  const A = dizi(a[0]), B = dizi(a[1]);
  const kuyruk = tam(sy(a[2])), tur = tam(sy(a[3]));
  if (kuyruk !== 1 && kuyruk !== 2) return ERR.NUM;
  if (tur < 1 || tur > 3) return ERR.NUM;
  let t, df;
  if (tur === 1) {
    if (A.length !== B.length) return ERR.NA;
    const fark = A.map((x, i) => x - B[i]);
    const n = fark.length;
    if (n < 2) return ERR.DIV0;
    const sd = Math.sqrt(varyans(fark, true));
    if (sd === 0) return ERR.DIV0;
    t = ort(fark) / (sd / Math.sqrt(n));
    df = n - 1;
  } else {
    const n1 = A.length, n2 = B.length;
    if (n1 < 2 || n2 < 2) return ERR.DIV0;
    const v1 = varyans(A, true), v2 = varyans(B, true);
    const m1 = ort(A), m2 = ort(B);
    if (tur === 2) {
      df = n1 + n2 - 2;
      const havuz = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
      if (havuz === 0) return ERR.DIV0;
      t = (m1 - m2) / Math.sqrt(havuz * (1 / n1 + 1 / n2));
    } else {
      const u1 = v1 / n1, u2 = v2 / n2;
      if (u1 + u2 === 0) return ERR.DIV0;
      t = (m1 - m2) / Math.sqrt(u1 + u2);
      // Welch–Satterthwaite serbestlik derecesi TAM SAYI DEĞİLDİR; yuvarlanmaz.
      df = (u1 + u2) * (u1 + u2) / (u1 * u1 / (n1 - 1) + u2 * u2 / (n2 - 1));
    }
  }
  const iki = tIkiKuyruk(Math.abs(t), df);
  return kuyruk === 2 ? iki : iki / 2;
}

// =================================================================================
// F ve ki-kare aileleri
// =================================================================================

kaydetHepsi({
  'F.DIST': {
    en: 4, ek: 4,
    fn: (a) => {
      const x = sy(a[0]), d1 = tam(sy(a[1])), d2 = tam(sy(a[2]));
      if (x < 0 || d1 < 1 || d2 < 1) return ERR.NUM;
      return birikimli(a[3]) ? fCdf(x, d1, d2) : fPdf(x, d1, d2);
    },
  },
  'F.DIST.RT': { en: 3, ek: 3, fn: (a) => fSag(a) },
  FDIST: { en: 3, ek: 3, fn: (a) => fSag(a) },   // eski FDIST de SAĞ kuyruk verir
  'F.INV': {
    en: 3, ek: 3,
    fn: (a) => { const p = sy(a[0]), d1 = tam(sy(a[1])), d2 = tam(sy(a[2])); return p < 0 || p > 1 || d1 < 1 || d2 < 1 ? ERR.NUM : sonlu(fTers(p, d1, d2)); },
  },
  'F.INV.RT': { en: 3, ek: 3, fn: (a) => fTersSag(a) },
  FINV: { en: 3, ek: 3, fn: (a) => fTersSag(a) },
  'F.TEST': { en: 2, ek: 2, fn: (a) => fSinama(a) },
  FTEST: { en: 2, ek: 2, fn: (a) => fSinama(a) },
  'CHISQ.DIST': {
    en: 3, ek: 3,
    fn: (a) => {
      const x = sy(a[0]), df = tam(sy(a[1]));
      if (x < 0 || df < 1) return ERR.NUM;
      return birikimli(a[2]) ? chiCdf(x, df) : chiPdf(x, df);
    },
  },
  'CHISQ.DIST.RT': { en: 2, ek: 2, fn: (a) => chiSag(a) },
  CHIDIST: { en: 2, ek: 2, fn: (a) => chiSag(a) },   // CHIDIST sağ kuyruk, CHISQ.DIST sol kuyruktur
  'CHISQ.INV': {
    en: 2, ek: 2,
    fn: (a) => { const p = sy(a[0]), df = tam(sy(a[1])); return p < 0 || p > 1 || df < 1 ? ERR.NUM : sonlu(chiTers(p, df)); },
  },
  'CHISQ.INV.RT': { en: 2, ek: 2, fn: (a) => chiTersSag(a) },
  CHIINV: { en: 2, ek: 2, fn: (a) => chiTersSag(a) },
  'CHISQ.TEST': { en: 2, ek: 2, fn: (a) => chiSinama(a) },
  CHITEST: { en: 2, ek: 2, fn: (a) => chiSinama(a) },
});

function fSag(a) {
  const x = sy(a[0]), d1 = tam(sy(a[1])), d2 = tam(sy(a[2]));
  return x < 0 || d1 < 1 || d2 < 1 ? ERR.NUM : 1 - fCdf(x, d1, d2);
}
function fTersSag(a) {
  const p = sy(a[0]), d1 = tam(sy(a[1])), d2 = tam(sy(a[2]));
  return p <= 0 || p > 1 || d1 < 1 || d2 < 1 ? ERR.NUM : sonlu(fTers(1 - p, d1, d2));
}
function chiSag(a) {
  const x = sy(a[0]), df = tam(sy(a[1]));
  return x < 0 || df < 1 ? ERR.NUM : 1 - chiCdf(x, df);
}
function chiTersSag(a) {
  const p = sy(a[0]), df = tam(sy(a[1]));
  return p < 0 || p > 1 || df < 1 ? ERR.NUM : sonlu(chiTers(1 - p, df));
}
function fSinama(a) {
  const A = dizi(a[0]), B = dizi(a[1]);
  if (A.length < 2 || B.length < 2) return ERR.DIV0;
  const v1 = varyans(A, true), v2 = varyans(B, true);
  if (v1 === 0 || v2 === 0) return ERR.DIV0;
  const f = v1 / v2;
  // İki kuyruklu değer: sağ kuyruğun iki katı 1'i aşarsa simetrik karşılığı (2 - p) alınır.
  let p = 2 * (1 - fCdf(f, A.length - 1, B.length - 1));
  if (p > 1) p = 2 - p;
  return p;
}
function chiSinama(a) {
  const G = mat(a[0]), B = mat(a[1]);
  const sat = G.length, sut = G[0].length;
  if (B.length !== sat || B[0].length !== sut) return ERR.NA;
  let x2 = 0, n = 0;
  for (let i = 0; i < sat; i++) {
    for (let j = 0; j < sut; j++) {
      const g = G[i][j], b = B[i][j];
      if (hata(g)) return g;
      if (hata(b)) return b;
      if (typeof g !== 'number' || typeof b !== 'number') continue;
      if (b === 0) return ERR.DIV0;
      x2 += (g - b) * (g - b) / b;
      n++;
    }
  }
  // Tek satır ya da tek sütunda serbestlik derecesi n-1'dir, (r-1)(c-1) değil.
  const df = sat === 1 || sut === 1 ? n - 1 : (sat - 1) * (sut - 1);
  if (df < 1) return ERR.NA;
  return 1 - chiCdf(x2, df);
}

// =================================================================================
// Gama / beta / Weibull / üstel
// =================================================================================

kaydetHepsi({
  GAMMA: { en: 1, ek: 1, fn: (a) => sonlu(gammaFn(sy(a[0]))) },
  GAMMALN: { en: 1, ek: 1, fn: (a) => { const x = sy(a[0]); return x <= 0 ? ERR.NUM : gammaLn(x); } },
  'GAMMALN.PRECISE': { en: 1, ek: 1, fn: (a) => { const x = sy(a[0]); return x <= 0 ? ERR.NUM : gammaLn(x); } },
  'GAMMA.DIST': { en: 4, ek: 4, fn: (a) => gamaDag(a) },
  GAMMADIST: { en: 4, ek: 4, fn: (a) => gamaDag(a) },
  'GAMMA.INV': { en: 3, ek: 3, fn: (a) => gamaDagTers(a) },
  GAMMAINV: { en: 3, ek: 3, fn: (a) => gamaDagTers(a) },
  'BETA.DIST': {
    en: 4, ek: 6,
    fn: (a) => {
      const x = sy(a[0]), al = sy(a[1]), be = sy(a[2]);
      const A = a.length > 4 && a[4] != null ? sy(a[4]) : 0;
      const B = a.length > 5 && a[5] != null ? sy(a[5]) : 1;
      return betaDag(x, al, be, birikimli(a[3]), A, B);
    },
  },
  BETADIST: {
    en: 3, ek: 5,
    fn: (a) => {
      const x = sy(a[0]), al = sy(a[1]), be = sy(a[2]);
      const A = a.length > 3 && a[3] != null ? sy(a[3]) : 0;
      const B = a.length > 4 && a[4] != null ? sy(a[4]) : 1;
      return betaDag(x, al, be, true, A, B);   // eski BETADIST YALNIZ birikimlidir
    },
  },
  'BETA.INV': { en: 3, ek: 5, fn: (a) => betaDagTers(a) },
  BETAINV: { en: 3, ek: 5, fn: (a) => betaDagTers(a) },
  'WEIBULL.DIST': { en: 4, ek: 4, fn: (a) => weibull(a) },
  WEIBULL: { en: 4, ek: 4, fn: (a) => weibull(a) },
  'EXPON.DIST': { en: 3, ek: 3, fn: (a) => ustel(a) },
  EXPONDIST: { en: 3, ek: 3, fn: (a) => ustel(a) },
});

function gamaDag(a) {
  const x = sy(a[0]), al = sy(a[1]), be = sy(a[2]);
  if (x < 0 || al <= 0 || be <= 0) return ERR.NUM;
  if (birikimli(a[3])) return gamaP(al, x / be);
  if (x === 0) return al < 1 ? ERR.NUM : al === 1 ? 1 / be : 0;
  return Math.exp((al - 1) * Math.log(x) - x / be - gammaLn(al) - al * Math.log(be));
}
function gamaDagTers(a) {
  const p = sy(a[0]), al = sy(a[1]), be = sy(a[2]);
  if (p < 0 || p > 1 || al <= 0 || be <= 0) return ERR.NUM;
  return sonlu(be * gamaTers(p, al));
}
function betaDag(x, al, be, toplamli, A, B) {
  if (al <= 0 || be <= 0 || A >= B) return ERR.NUM;
  if (x < A || x > B) return ERR.NUM;
  const y = (x - A) / (B - A);
  if (toplamli) return betaI(al, be, y);
  if ((y === 0 && al < 1) || (y === 1 && be < 1)) return ERR.NUM;
  const lg = gammaLn(al + be) - gammaLn(al) - gammaLn(be);
  if (y === 0) return Math.exp(lg + (be - 1) * Math.log(1)) * (al === 1 ? 1 : 0) / (B - A);
  if (y === 1) return Math.exp(lg) * (be === 1 ? 1 : 0) / (B - A);
  return Math.exp(lg + (al - 1) * Math.log(y) + (be - 1) * Math.log(1 - y)) / (B - A);
}
function betaDagTers(a) {
  const p = sy(a[0]), al = sy(a[1]), be = sy(a[2]);
  const A = a.length > 3 && a[3] != null ? sy(a[3]) : 0;
  const B = a.length > 4 && a[4] != null ? sy(a[4]) : 1;
  if (p <= 0 || p > 1 || al <= 0 || be <= 0 || A >= B) return ERR.NUM;
  return A + (B - A) * betaTers(p, al, be);
}
function weibull(a) {
  const x = sy(a[0]), al = sy(a[1]), be = sy(a[2]);
  if (x < 0 || al <= 0 || be <= 0) return ERR.NUM;
  const u = Math.pow(x / be, al);
  if (birikimli(a[3])) return 1 - Math.exp(-u);
  if (x === 0) return al === 1 ? 1 / be : al < 1 ? ERR.NUM : 0;
  return al / Math.pow(be, al) * Math.pow(x, al - 1) * Math.exp(-u);
}
function ustel(a) {
  const x = sy(a[0]), l = sy(a[1]);
  if (x < 0 || l <= 0) return ERR.NUM;
  return birikimli(a[2]) ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x);
}

// =================================================================================
// Kesikli dağılımlar
// =================================================================================

/** İki terimli olasılık; p uç değerlerinde log(0) oluşmasın diye ayrı ele alınır */
function binomPmf(k, n, p) {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  // Tam birleşim sayısıyla çarpım, logaritmalı yolun 1e-16'lık gürültüsünü doğurmaz.
  const c = birlesimTam(n, k);
  if (c != null) return c * Math.pow(p, k) * Math.pow(1 - p, n - k);
  return Math.exp(lnBirlesim(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  // Küçük k'de doğrudan toplam daha duyarlı; büyük k'de düzenlenmiş eksik beta kullanılır.
  if (k <= 10000) { let s = 0; for (let i = 0; i <= k; i++) s += binomPmf(i, n, p); return Math.min(1, s); }
  return betaI(n - k, k + 1, 1 - p);
}

kaydetHepsi({
  'BINOM.DIST': { en: 4, ek: 4, fn: (a) => binom(a) },
  BINOMDIST: { en: 4, ek: 4, fn: (a) => binom(a) },
  'BINOM.DIST.RANGE': {
    en: 3, ek: 4,
    fn: (a) => {
      const n = tam(sy(a[0])), p = sy(a[1]), s1 = tam(sy(a[2]));
      const s2 = a.length > 3 && a[3] != null ? tam(sy(a[3])) : s1;
      if (n < 0 || p < 0 || p > 1 || s1 < 0 || s1 > n || s2 < s1 || s2 > n) return ERR.NUM;
      let t = 0;
      for (let i = s1; i <= s2; i++) t += binomPmf(i, n, p);
      return t;
    },
  },
  'BINOM.INV': { en: 3, ek: 3, fn: (a) => binomTers(a) },
  CRITBINOM: { en: 3, ek: 3, fn: (a) => binomTers(a) },
  'NEGBINOM.DIST': {
    en: 4, ek: 4,
    fn: (a) => {
      const f = tam(sy(a[0])), s = tam(sy(a[1])), p = sy(a[2]);
      if (f < 0 || s < 1 || p <= 0 || p > 1) return ERR.NUM;
      if (!birikimli(a[3])) return negBinomPmf(f, s, p);
      let t = 0;
      for (let i = 0; i <= f; i++) t += negBinomPmf(i, s, p);
      return Math.min(1, t);
    },
  },
  NEGBINOMDIST: {
    en: 3, ek: 3,
    fn: (a) => {
      const f = tam(sy(a[0])), s = tam(sy(a[1])), p = sy(a[2]);
      if (f < 0 || s < 1 || p <= 0 || p > 1) return ERR.NUM;
      return negBinomPmf(f, s, p);   // eski ad birikimli SEÇENEĞİ TAŞIMAZ
    },
  },
  'HYPGEOM.DIST': {
    en: 5, ek: 5,
    fn: (a) => {
      const x = tam(sy(a[0])), n = tam(sy(a[1])), M = tam(sy(a[2])), N = tam(sy(a[3]));
      const g = hipGecerli(x, n, M, N);
      if (g) return g;
      if (!birikimli(a[4])) return hipPmf(x, n, M, N);
      let t = 0;
      for (let i = Math.max(0, n - (N - M)); i <= x; i++) t += hipPmf(i, n, M, N);
      return Math.min(1, t);
    },
  },
  HYPGEOMDIST: {
    en: 4, ek: 4,
    fn: (a) => {
      const x = tam(sy(a[0])), n = tam(sy(a[1])), M = tam(sy(a[2])), N = tam(sy(a[3]));
      const g = hipGecerli(x, n, M, N);
      return g || hipPmf(x, n, M, N);
    },
  },
  'POISSON.DIST': { en: 3, ek: 3, fn: (a) => poisson(a) },
  POISSON: { en: 3, ek: 3, fn: (a) => poisson(a) },
  PERMUT: {
    en: 2, ek: 2,
    fn: (a) => {
      const n = tam(sy(a[0])), k = tam(sy(a[1]));
      if (n < 0 || k < 0 || k > n) return ERR.NUM;
      let t = 1;
      for (let i = 0; i < k; i++) t *= n - i;
      return sonlu(t);
    },
  },
  PERMUTATIONA: {
    en: 2, ek: 2,
    fn: (a) => { const n = tam(sy(a[0])), k = tam(sy(a[1])); return n < 0 || k < 0 ? ERR.NUM : sonlu(Math.pow(n, k)); },
  },
});

function binom(a) {
  const k = tam(sy(a[0])), n = tam(sy(a[1])), p = sy(a[2]);
  if (n < 0 || k < 0 || k > n || p < 0 || p > 1) return ERR.NUM;
  return birikimli(a[3]) ? binomCdf(k, n, p) : binomPmf(k, n, p);
}
function binomTers(a) {
  const n = tam(sy(a[0])), p = sy(a[1]), al = sy(a[2]);
  if (n < 0 || p < 0 || p > 1 || al <= 0 || al >= 1) return ERR.NUM;
  let t = 0;
  for (let k = 0; k <= n; k++) { t += binomPmf(k, n, p); if (t >= al) return k; }
  return n;
}
const negBinomPmf = (f, s, p) => Math.exp(lnBirlesim(f + s - 1, f) + s * Math.log(p) + f * Math.log(1 - p));
function hipGecerli(x, n, M, N) {
  if (N <= 0 || n <= 0 || n > N || M <= 0 || M > N) return ERR.NUM;
  if (x < 0 || x > n || x > M) return ERR.NUM;
  if (x < n - (N - M)) return ERR.NUM;   // örnekte en az bu kadar başarı BULUNMAK ZORUNDADIR
  return null;
}
const hipPmf = (x, n, M, N) => Math.exp(lnBirlesim(M, x) + lnBirlesim(N - M, n - x) - lnBirlesim(N, n));
function poisson(a) {
  const x = tam(sy(a[0])), m = sy(a[1]);
  if (x < 0 || m < 0) return ERR.NUM;
  if (birikimli(a[2])) return m === 0 ? 1 : gamaQ(x + 1, m);
  return Math.exp(-m + x * Math.log(m === 0 ? 1 : m) - gammaLn(x + 1)) * (m === 0 ? (x === 0 ? 1 : 0) : 1);
}
