/*
 * EXCEL FORMÜL MOTORU — MÜHENDİSLİK ve VERİTABANI
 *
 * KAPSAM. Sayı tabanı çevirimi (DEC2BIN … HEX2OCT), bit işlemleri (BITAND, BITLSHIFT …),
 * eşik işlevleri (DELTA, GESTEP), hata işlevi ailesi (ERF, ERFC ve .PRECISE eşleri), Bessel
 * işlevleri (I, J, K, Y), birim çevirimi (CONVERT), karmaşık sayı ailesi (COMPLEX, IM*) ve
 * veritabanı ailesi (DSUM, DGET, DVARP …).
 *
 * ORTAK TUZAK 1 — TABAN ÇEVİRİMİNİN GENİŞLİĞİ SABİTTİR. DEC2BIN 10 ikilik basamak (−512..511),
 * DEC2OCT 10 sekizlik basamak (30 bit), DEC2HEX 10 onaltılık basamak (40 bit) ile çalışır.
 * Negatif sayı İKİYE TÜMLEYEN yazılır ve alan genişliğini TAMAMEN doldurur: DEC2BIN(−1) =
 * "1111111111". Bu yüzden negatifte `yer` (places) argümanı yok sayılır — 10 basamaktan azına
 * sığdırmak zaten olanaksızdır. Aynı bakışım BIN2DEC'te de vardır: 10 karakterlik bir ikilik
 * dizgenin ilk basamağı İŞARET bitidir, "1111111111" 1023 değil −1'dir.
 *
 * ORTAK TUZAK 2 — CONVERT'te SICAKLIK ÖTELEMELİDİR. Öteki bütün aileler oranla çevrilir
 * (1 ft = 0,3048 m), sıcaklık ise öteleme ister: 0 °C = 273,15 K, 32 °F = 0 °C. Oran gibi
 * çevrilirse 0 °C, 0 °F olur. Ayrıca CONVERT'te birim adları BÜYÜK/KÜÇÜK HARFE DUYARLIDIR:
 * "Pica" 1/72 inç (punto), "pica" 1/6 inçtir; "g" gram, "G" giga önekidir.
 *
 * ORTAK TUZAK 3 — KARMAŞIK SAYI METİNDİR. Bütün IM* işlevleri "3+4i" gibi bir METİN alır,
 * metin döndürür. Sanal birim harfi ('i' ya da 'j') sonuca TAŞINIR ve iki farklı harf
 * karıştırılamaz. Tek başına "i" 1i, "-i" ise −1i demektir; katsayısı yoktur.
 *
 * ORTAK TUZAK 4 — VERİTABANI ÖLÇÜT ARALIĞININ MANTIĞI. Ölçüt aralığının ilk satırı BAŞLIKTIR;
 * altındaki her satır bir ölçüt kümesidir. AYNI SATIRDAKİ koşullar VE ile, AYRI SATIRLAR VEYA
 * ile bağlanır. Tamamen boş bir ölçüt satırı hiçbir koşul koymaz, yani BÜTÜN kayıtları eşler —
 * bu, boş bırakılmış bir satır yüzünden toplamın birden bütün tabloyu kapsamasının nedenidir.
 * İkinci incelik: D* ailesinde düz metin ölçütü BAŞTAN eşleşmedir; "Ka" ölçütü "Kanatlı"yı da
 * eşler. Tam eşleşme için ="Ka" yazılır. COUNTIF'in tam eşleşmesiyle karıştırılmamalıdır.
 */

import {
  ERR, hata, num, str, mat, duzle, olcut, jokerRe, metinSayi, sayiMetin,
  yay, kontrol, basvuruDeger, kaydetHepsi,
} from './xlfn.js';

// =================================================================================
// Ortak yardımcılar
// =================================================================================

const GAMMA = 0.5772156649015328606;   // Euler-Mascheroni
const tamMi = (x) => Math.abs(x - Math.round(x)) < 1e-9;
/*
 * İkilik gösterimin artığını atar: 0,0001 / 0,000001 makinede 100,00000000000001'dir.
 * Excel'in kendi duyarlığı da 15 anlamlı hanedir, dolayısıyla bu bir gizleme değil, ikilik
 * bölmenin kalıntısını atıp ondalık karara dönmektir (xlfn_math.js ile aynı ölçüt).
 */
const temiz = (v) => (typeof v === 'number' && isFinite(v) && v !== 0 ? Number(v.toPrecision(15)) : v);
/** Seçimlik sayı argümanı: boşsa varsayılan, hatalıysa hata */
const secSayi = (v, vars) => (v == null ? vars : num(v));
/** Bir düğümün ilk skaler değeri (dizi geldiyse ilk hücre) */
const ilk = (v) => (Array.isArray(v) ? (duzle([v])[0] ?? null) : v);

// =================================================================================
// Sayı tabanı çevirimi
// =================================================================================
/*
 * Her hedef tabanın kendi alan genişliği ve işaret biti vardır. Tablo tek yerde durur ki
 * BIN2OCT gibi çapraz çevirimler de aynı sınırları kullansın.
 *   bit  : alanın bit genişliği (ikilik 10, sekizlik 30, onaltılık 40)
 *   bas  : basamak sayısı (üçünde de 10)
 */
const TABAN = {
  2:  { bas: 10, bit: 10, re: /^[01]+$/ },
  8:  { bas: 10, bit: 30, re: /^[0-7]+$/ },
  16: { bas: 10, bit: 40, re: /^[0-9A-Fa-f]+$/ },
};
const ikiUzeri = (n) => Math.pow(2, n);

/** Ondalık sayıyı verilen tabanda Excel'in alan genişliğiyle yazar */
function tabanaYaz(deger, taban, yer) {
  const t = TABAN[taban];
  const sinir = ikiUzeri(t.bit - 1);
  if (deger < -sinir || deger > sinir - 1) return ERR.NUM;
  if (deger < 0) {
    // Negatifte ikiye tümleyen alanı tamamen doldurur; `yer` yok sayılır.
    const s = (deger + ikiUzeri(t.bit)).toString(taban).toUpperCase();
    return s.padStart(t.bas, '0');
  }
  const s = deger.toString(taban).toUpperCase();
  if (yer == null) return s;
  if (yer < s.length || yer > t.bas) return ERR.NUM;
  return s.padStart(yer, '0');
}

/** Verilen tabandaki metni ondalığa çevirir (ilk basamak işaret bitidir) */
function tabandanOku(v, taban) {
  const t = TABAN[taban];
  v = ilk(v);
  if (v == null) return 0;
  if (hata(v)) return v;
  if (typeof v === 'boolean') return ERR.VALUE;
  const s = String(typeof v === 'number' ? sayiMetin(v) : v).trim();
  if (s === '') return 0;
  if (s.length > t.bas || !t.re.test(s)) return ERR.NUM;
  const n = parseInt(s, taban);
  const sinir = ikiUzeri(t.bit - 1);
  return n >= sinir ? n - ikiUzeri(t.bit) : n;
}

/** DEC2xxx gövdesi: sayıyı kırpar, `yer` argümanını doğrular */
function dec2(a, taban) {
  const x = num(a[0]);
  if (hata(x)) return x;
  const d = Math.trunc(x);
  let yer = null;
  if (a[1] != null) {
    const p = num(a[1]);
    if (hata(p)) return p;
    yer = Math.trunc(p);
    if (yer < 0) return ERR.NUM;
  }
  return tabanaYaz(d, taban, yer);
}
/** xxx2yyy gövdesi: kaynaktan oku, hedefe yaz */
function cevir(a, kaynak, hedef) {
  const d = tabandanOku(a[0], kaynak);
  if (hata(d)) return d;
  let yer = null;
  if (a[1] != null) {
    const p = num(a[1]);
    if (hata(p)) return p;
    yer = Math.trunc(p);
    if (yer < 0) return ERR.NUM;
  }
  return tabanaYaz(d, hedef, yer);
}

// =================================================================================
// Bit işlemleri — 48 bit
// =================================================================================
/*
 * JavaScript'in &, |, ^ işleçleri işlenenlerini 32 bitlik tam sayıya indirir; Excel'in bit
 * ailesi ise 48 bit çalışır (2^48−1 = 281.474.976.710.655). 32 bitle yazılsaydı BITAND'in
 * 2^32 üstündeki her sonucu sessizce yanlış çıkardı. Bu yüzden BigInt kullanılır.
 */
const BIT_TAVAN = 281474976710655;   // 2^48 − 1
function bitSayi(v) {
  const x = num(v);
  if (hata(x)) return x;
  if (x < 0 || x > BIT_TAVAN || !tamMi(x)) return ERR.NUM;
  return Math.round(x);
}
const bitIkili = (f) => (a) => {
  const x = bitSayi(a[0]); if (hata(x)) return x;
  const y = bitSayi(a[1]); if (hata(y)) return y;
  return Number(f(BigInt(x), BigInt(y)));
};
function bitKaydir(a, yon) {
  const x = bitSayi(a[0]); if (hata(x)) return x;
  const s = num(a[1]); if (hata(s)) return s;
  if (!tamMi(s) || Math.abs(s) > 53) return ERR.NUM;
  let k = Math.round(s) * yon;
  const b = BigInt(x);
  const r = k >= 0 ? (b << BigInt(k)) : (b >> BigInt(-k));
  const v = Number(r);
  // Sonuç 48 bitlik alandan taşarsa Excel #NUM! verir: bit ailesi 48 bitliktir.
  return v > BIT_TAVAN ? ERR.NUM : v;
}

// =================================================================================
// Hata işlevi — erf / erfc
// =================================================================================
/*
 * İki ayrı yöntem kullanılır, çünkü tek bir açılım her iki uçta da duyarlı değildir:
 *  |x| < 2 : bütün terimleri ARTI olan seri. Alternatifli Maclaurin açılımı büyük x'te
 *            birbirini götüren terimler ürettiğinden burada e^{-x²} çarpanlı biçim seçildi.
 *  |x| ≥ 2 : sürekli kesir (değişik Lentz). erfc doğrudan buradan gelir; 1−erf üzerinden
 *            gidilseydi 1'e yakın bir sayıdan çıkarma yapılır, anlamlı hane yitirilirdi.
 */
function erfcKesir(x) {
  const kucuk = 1e-300;
  let f = kucuk, C = f, D = 0;
  for (let n = 1; n <= 1000; n++) {
    const a = n === 1 ? 1 : (n - 1) / 2;
    D = x + a * D; if (D === 0) D = kucuk;
    C = x + a / C; if (C === 0) C = kucuk;
    D = 1 / D;
    const d = C * D;
    f *= d;
    if (Math.abs(d - 1) < 1e-17) break;
  }
  return Math.exp(-x * x) / Math.sqrt(Math.PI) * f;
}
function erf(x) {
  if (x === 0) return 0;
  const ax = Math.abs(x);
  if (ax > 6) return x > 0 ? 1 : -1;   // erfc(6) ≈ 2e-17, çift duyarlıkta 1'den ayrılmaz
  if (ax < 2) {
    const x2 = x * x;
    let t = 1, s = 1;
    for (let n = 1; n < 300; n++) { t *= (2 * x2) / (2 * n + 1); s += t; if (t < 1e-18 * s) break; }
    return (2 * x * Math.exp(-x2) / Math.sqrt(Math.PI)) * s;
  }
  const e = erfcKesir(ax);
  return x > 0 ? 1 - e : e - 1;
}
function erfc(x) {
  if (x >= 1.5) return erfcKesir(x);
  if (x <= -1.5) return 2 - erfcKesir(-x);
  return 1 - erf(x);
}

// =================================================================================
// Bessel işlevleri
// =================================================================================

/** I_n(x) — bütün terimler artı, iptal yok; seri her x için yeter */
function besselI(x, n) {
  const u = x / 2;
  let t = Math.pow(u, n);
  for (let k = 2; k <= n; k++) t /= k;
  if (!isFinite(t)) return ERR.NUM;
  let s = t;
  const u2 = u * u;
  for (let k = 1; k < 3000; k++) {
    t *= u2 / (k * (n + k));
    s += t;
    if (Math.abs(t) < 1e-19 * Math.abs(s)) break;
  }
  return s;
}
/** J_n(x) küçük x için doğrudan seri */
function jSeri(x, n) {
  const u = x / 2;
  let t = Math.pow(u, n);
  for (let k = 2; k <= n; k++) t /= k;
  let s = t;
  const u2 = u * u;
  for (let k = 1; k < 3000; k++) {
    t *= -u2 / (k * (n + k));
    s += t;
    if (Math.abs(t) < 1e-19 * Math.abs(s)) break;
  }
  return s;
}
/*
 * Büyük x'te alternatifli seri iptalden dolayı hane yitirir (x = 20'de yedi hane). Miller'in
 * AŞAĞI yinelemesi bunu ortadan kaldırır: yüksek bir dereceden başlanıp aşağı inilir ve sonuç
 * J_0 + 2(J_2 + J_4 + …) = 1 özdeşliğiyle ölçeklenir. Aşağı yön kararlıdır, yukarı yön değil.
 */
function jMiller(x, n) {
  const ax = Math.abs(x);
  const m = 2 * Math.ceil((n + ax + 10 * Math.sqrt(n + ax) + 40) / 2);
  let jp = 0, j = 1e-290, top = 0, son = 0, cift = false;
  for (let k = m; k > 0; k--) {
    const jm = (2 * k / ax) * j - jp;
    jp = j; j = jm;
    if (Math.abs(j) > 1e250) { j *= 1e-250; jp *= 1e-250; top *= 1e-250; son *= 1e-250; }
    if (cift) top += j;
    cift = !cift;
    if (k === n) son = jp;
  }
  return (n === 0 ? j : son) / (2 * top - j);
}
function besselJ(x, n) {
  const ax = Math.abs(x);
  const v = ax < 4 ? jSeri(ax, n) : jMiller(ax, n);
  // J_n(−x) = (−1)^n J_n(x)
  return x < 0 && n % 2 ? -v : v;
}
/** Y_0 ve Y_1 — küçük x serisi (ψ işlevi seriye gömülü, bu yüzden Y_1'de γ AYRICA eklenmez) */
function y01Seri(x) {
  const u = x * x / 4, lg = Math.log(x / 2);
  let t = 1, s0 = 0, H = 0;
  for (let k = 1; k < 300; k++) {
    t *= u / (k * k); H += 1 / k;
    const d = (k % 2 ? 1 : -1) * H * t;
    s0 += d;
    if (k > 3 && Math.abs(d) < 1e-19 * Math.abs(s0)) break;
  }
  const Y0 = (2 / Math.PI) * ((lg + GAMMA) * besselJ(x, 0) + s0);
  let p1 = -GAMMA, p2 = 1 - GAMMA, f = 1, S = 0;
  for (let k = 0; k < 400; k++) {
    const d = (p1 + p2) * f;
    S += d;
    if (k > 3 && Math.abs(d) < 1e-19 * Math.abs(S)) break;
    p1 += 1 / (k + 1); p2 += 1 / (k + 2);
    f *= -u / ((k + 1) * (k + 2));
  }
  const Y1 = (2 / Math.PI) * (lg * besselJ(x, 1) - 1 / x) - (x / (2 * Math.PI)) * S;
  return [Y0, Y1];
}
/** Hankel asimptotik açılımı (x > 11): seri en küçük terimde kesilir */
function hankel(x, n) {
  const mu = 4 * n * n;
  let P = 1, Q = 0, t = 1, onceki = Infinity;
  for (let k = 1; k <= 80; k++) {
    t *= (mu - (2 * k - 1) * (2 * k - 1)) / (k * 8 * x);
    const a = Math.abs(t);
    if (a > onceki) break;
    onceki = a;
    if (k % 2 === 0) P += (k % 4 === 0 ? 1 : -1) * t;
    else Q += (k % 4 === 1 ? 1 : -1) * t;
    if (a < 1e-19) break;
  }
  const ki = x - (n / 2 + 0.25) * Math.PI, c = Math.sqrt(2 / (Math.PI * x));
  return [c * (P * Math.cos(ki) - Q * Math.sin(ki)), c * (P * Math.sin(ki) + Q * Math.cos(ki))];
}
function besselY(x, n) {
  let y0, y1;
  if (x > 11) { y0 = hankel(x, 0)[1]; y1 = hankel(x, 1)[1]; }
  else { const p = y01Seri(x); y0 = p[0]; y1 = p[1]; }
  if (n === 0) return y0;
  let a = y0, b = y1;
  // Y'de YUKARI yineleme kararlıdır (J'nin tersine): Y_{n+1} = (2n/x) Y_n − Y_{n−1}
  for (let k = 1; k < n; k++) { const c = (2 * k / x) * b - a; a = b; b = c; }
  return n === 1 ? y1 : b;
}
/** K_0 ve K_1 — x < 2 seri, x ≥ 2 Temme sürekli kesri */
function k01Seri(x) {
  const u = x * x / 4, lg = Math.log(x / 2);
  let t = 1, s0 = 0, H = 0;
  for (let k = 1; k < 300; k++) {
    t *= u / (k * k); H += 1 / k;
    s0 += H * t;
    if (k > 3 && H * t < 1e-19 * s0) break;
  }
  const K0 = -(lg + GAMMA) * besselI(x, 0) + s0;
  let p1 = -GAMMA, p2 = 1 - GAMMA, f = 1, S = 0;
  for (let k = 0; k < 400; k++) {
    const d = (p1 + p2) * f;
    S += d;
    if (k > 3 && Math.abs(d) < 1e-19 * Math.abs(S)) break;
    p1 += 1 / (k + 1); p2 += 1 / (k + 2);
    f *= u / ((k + 1) * (k + 2));
  }
  const K1 = 1 / x + lg * besselI(x, 1) - (x / 4) * S;
  return [K0, K1];
}
function k01Kesir(x) {
  let b = 2 * (1 + x), d = 1 / b, h = d, delh = d, q1 = 0, q2 = 1;
  const a1 = 0.25;
  let q = a1, c = a1, a = -a1, s = 1 + q * delh;
  for (let i = 2; i <= 10000; i++) {
    a -= 2 * (i - 1);
    c = -a * c / i;
    const qn = (q1 - b * q2) / a;
    q1 = q2; q2 = qn; q += c * qn;
    b += 2;
    d = 1 / (b + a * d);
    delh = (b * d - 1) * delh;
    h += delh;
    const dels = q * delh;
    s += dels;
    if (Math.abs(dels / s) < 1e-17) break;
  }
  h = a1 * h;
  const k0 = Math.sqrt(Math.PI / (2 * x)) * Math.exp(-x) / s;
  return [k0, k0 * (x + 0.5 - h) / x];
}
function besselK(x, n) {
  const p = x < 2 ? k01Seri(x) : k01Kesir(x);
  if (n === 0) return p[0];
  let a = p[0], b = p[1];
  // K'de de YUKARI yineleme kararlıdır: K_{n+1} = (2n/x) K_n + K_{n−1}
  for (let k = 1; k < n; k++) { const c = (2 * k / x) * b + a; a = b; b = c; }
  return b;
}
/** BESSEL* ailesinin ortak argüman denetimi */
function besselArg(a) {
  const x = num(a[0]); if (hata(x)) return x;
  const n = num(a[1]); if (hata(n)) return n;
  const d = Math.trunc(n);
  if (d < 0) return ERR.NUM;
  return [x, d];
}

// =================================================================================
// Karmaşık sayılar — metin girer, metin çıkar
// =================================================================================
/*
 * Ayrıştırıcı el yazımıdır, tek bir düzenli ifade değil: "−3.5e-2i" içindeki 'e-2' üstel bir
 * parçadır, sanal kısmı başlatan bir işaret DEĞİLDİR. Gerçek ile sanalı ayıran işaret, sondan
 * başlayarak aranan ve ÖNÜNDE 'e' BULUNMAYAN ilk +/- işaretidir.
 */
const SAYI_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function karmasik(v) {
  if (v == null) return { re: 0, im: 0, s: '' };
  if (hata(v)) return v;
  if (typeof v === 'number') return { re: v, im: 0, s: '' };
  if (typeof v === 'boolean') return ERR.VALUE;
  const t = String(v).trim();
  if (t === '') return { re: 0, im: 0, s: '' };
  const son = t[t.length - 1];
  if (son !== 'i' && son !== 'j') {
    return SAYI_RE.test(t) ? { re: Number(t), im: 0, s: '' } : ERR.NUM;
  }
  const g = t.slice(0, -1);
  let bol = -1;
  for (let k = g.length - 1; k > 0; k--) {
    const c = g[k];
    if ((c === '+' || c === '-') && g[k - 1] !== 'e' && g[k - 1] !== 'E') { bol = k; break; }
  }
  const reS = bol > 0 ? g.slice(0, bol) : '';
  const imS = bol > 0 ? g.slice(bol) : g;
  let re = 0;
  if (reS !== '') { if (!SAYI_RE.test(reS)) return ERR.NUM; re = Number(reS); }
  let im;
  // Katsayısız sanal birim: "i" = 1i, "-i" = −1i
  if (imS === '' || imS === '+') im = 1;
  else if (imS === '-') im = -1;
  else { if (!SAYI_RE.test(imS)) return ERR.NUM; im = Number(imS); }
  return { re, im, s: son };
}
/** İki karmaşık sayının sanal birim harfi uyuşmalıdır; biri boşsa ötekininki alınır */
function harf(...z) {
  let s = '';
  for (const c of z) {
    if (!c.s) continue;
    if (s && s !== c.s) return ERR.VALUE;
    s = c.s;
  }
  return s || 'i';
}
function karmasikMetin(re, im, s) {
  if (!isFinite(re) || !isFinite(im)) return ERR.NUM;
  if (re === 0) re = 0;    // −0 normalleştirilir, yoksa "-0" basılır
  if (im === 0) im = 0;
  if (im === 0) return sayiMetin(re);
  const ims = im === 1 ? '' : im === -1 ? '-' : sayiMetin(im);
  if (re === 0) return ims + s;
  return sayiMetin(re) + (im < 0 ? '' : '+') + ims + s;
}
/** Tek argümanlı karmaşık işlev; dizi geldiğinde eleman eleman uygulanır */
const km1 = (f) => (a) => yay(a[0], null, (v) => {
  const z = karmasik(v);
  if (hata(z)) return z;
  return f(z);
});
/** İki argümanlı karmaşık işlev */
const km2 = (f) => (a) => {
  const x = karmasik(ilk(a[0])); if (hata(x)) return x;
  const y = karmasik(ilk(a[1])); if (hata(y)) return y;
  const s = harf(x, y); if (hata(s)) return s;
  return f(x, y, s);
};
const cAbs = (z) => Math.hypot(z.re, z.im);
const cLn = (z) => ({ re: Math.log(cAbs(z)), im: Math.atan2(z.im, z.re) });
const cCarp = (x, y) => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re });
function cBol(x, y) {
  const d = y.re * y.re + y.im * y.im;
  if (d === 0) return ERR.NUM;
  return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d };
}
const cSin = (z) => ({ re: Math.sin(z.re) * Math.cosh(z.im), im: Math.cos(z.re) * Math.sinh(z.im) });
const cCos = (z) => ({ re: Math.cos(z.re) * Math.cosh(z.im), im: -Math.sin(z.re) * Math.sinh(z.im) });
const cSinh = (z) => ({ re: Math.sinh(z.re) * Math.cos(z.im), im: Math.cosh(z.re) * Math.sin(z.im) });
const cCosh = (z) => ({ re: Math.cosh(z.re) * Math.cos(z.im), im: Math.sinh(z.re) * Math.sin(z.im) });
const cBir = { re: 1, im: 0 };
/** Payı 1 olan oranlar (SEC, CSC, COT …): payda sıfırsa Excel #NUM! verir */
function cTers(pay, payda, s) {
  const r = cBol(pay, payda);
  return hata(r) ? r : karmasikMetin(r.re, r.im, s);
}

// =================================================================================
// CONVERT — birim çevirimi
// =================================================================================
/*
 * Birim adları BÜYÜK/KÜÇÜK HARFE DUYARLIDIR ve önce TAM ad aranır, ancak sonra önek soyulur.
 * Sıra böyle olmasaydı "mi" (mil) mili+i, "Pa" (paskal) peta+a diye okunurdu.
 * `us` alanı önekin KUVVETİDİR: "cm3" santimetreküptür, öneki üçüncü kuvvetten girer.
 */
const ONEK = {
  Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2,
  da: 1e1, e: 1e1, d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6,
  n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
};
const IKILI_ONEK = {
  Yi: Math.pow(2, 80), Zi: Math.pow(2, 70), Ei: Math.pow(2, 60), Pi: Math.pow(2, 50),
  Ti: Math.pow(2, 40), Gi: Math.pow(2, 30), Mi: Math.pow(2, 20), ki: Math.pow(2, 10),
};
const FT = 0.3048, IN = 0.0254, LB = 453.59237, MIL = 1609.344, LY = 9460730472580800;
/** aile · k = taban birime çarpan · on = önek alır mı ('m' ondalık, 'b' ondalık+ikili) · us = önek kuvveti */
const BIRIM = {
  // --- kütle (taban: gram) ---
  g: { a: 'kutle', k: 1, on: 'm' },
  sg: { a: 'kutle', k: 14593.9029372064 },
  lbm: { a: 'kutle', k: LB },
  u: { a: 'kutle', k: 1.66053906660e-24, on: 'm' },
  ozm: { a: 'kutle', k: LB / 16 },
  grain: { a: 'kutle', k: LB / 7000 },
  cwt: { a: 'kutle', k: LB * 100 }, shweight: { a: 'kutle', k: LB * 100 },
  uk_cwt: { a: 'kutle', k: LB * 112 }, lcwt: { a: 'kutle', k: LB * 112 }, hweight: { a: 'kutle', k: LB * 112 },
  stone: { a: 'kutle', k: LB * 14 },
  ton: { a: 'kutle', k: LB * 2000 },
  uk_ton: { a: 'kutle', k: LB * 2240 }, LTON: { a: 'kutle', k: LB * 2240 }, brton: { a: 'kutle', k: LB * 2240 },
  // --- uzaklık (taban: metre) ---
  m: { a: 'uzak', k: 1, on: 'm' },
  mi: { a: 'uzak', k: MIL },
  Nmi: { a: 'uzak', k: 1852 },
  in: { a: 'uzak', k: IN },
  ft: { a: 'uzak', k: FT },
  yd: { a: 'uzak', k: 0.9144 },
  ang: { a: 'uzak', k: 1e-10 },
  ell: { a: 'uzak', k: 1.143 },
  ly: { a: 'uzak', k: LY },
  parsec: { a: 'uzak', k: 3.0856775814913673e16 }, pc: { a: 'uzak', k: 3.0856775814913673e16 },
  Picapt: { a: 'uzak', k: IN / 72 }, Pica: { a: 'uzak', k: IN / 72 },
  pica: { a: 'uzak', k: IN / 6 },
  survey_mi: { a: 'uzak', k: 5280 * 1200 / 3937 },
  // --- zaman (taban: saniye) ---
  yr: { a: 'zaman', k: 31557600 },
  day: { a: 'zaman', k: 86400 }, d: { a: 'zaman', k: 86400 },
  hr: { a: 'zaman', k: 3600 },
  mn: { a: 'zaman', k: 60 }, min: { a: 'zaman', k: 60 },
  sec: { a: 'zaman', k: 1, on: 'm' }, s: { a: 'zaman', k: 1, on: 'm' },
  // --- basınç (taban: paskal) ---
  Pa: { a: 'basinc', k: 1, on: 'm' }, p: { a: 'basinc', k: 1, on: 'm' },
  atm: { a: 'basinc', k: 101325, on: 'm' }, at: { a: 'basinc', k: 101325, on: 'm' },
  mmHg: { a: 'basinc', k: 133.322, on: 'm' },
  psi: { a: 'basinc', k: 6894.757293168361 },
  Torr: { a: 'basinc', k: 101325 / 760 },
  // --- kuvvet (taban: newton) ---
  N: { a: 'kuvvet', k: 1, on: 'm' },
  dyn: { a: 'kuvvet', k: 1e-5, on: 'm' }, dy: { a: 'kuvvet', k: 1e-5, on: 'm' },
  lbf: { a: 'kuvvet', k: 4.4482216152605 },
  pond: { a: 'kuvvet', k: 0.00980665, on: 'm' },
  // --- enerji (taban: joule) ---
  J: { a: 'enerji', k: 1, on: 'm' },
  e: { a: 'enerji', k: 1e-7, on: 'm' },
  c: { a: 'enerji', k: 4.184, on: 'm' },
  cal: { a: 'enerji', k: 4.1868, on: 'm' },
  eV: { a: 'enerji', k: 1.602176634e-19, on: 'm' }, ev: { a: 'enerji', k: 1.602176634e-19, on: 'm' },
  HPh: { a: 'enerji', k: 2684519.537696172792 }, hh: { a: 'enerji', k: 2684519.537696172792 },
  Wh: { a: 'enerji', k: 3600, on: 'm' }, wh: { a: 'enerji', k: 3600, on: 'm' },
  flb: { a: 'enerji', k: 1.3558179483314004 },
  BTU: { a: 'enerji', k: 1055.05585262 }, btu: { a: 'enerji', k: 1055.05585262 },
  // --- güç (taban: watt) ---
  HP: { a: 'guc', k: 745.69987158227022 }, h: { a: 'guc', k: 745.69987158227022 },
  PS: { a: 'guc', k: 735.49875 },
  W: { a: 'guc', k: 1, on: 'm' }, w: { a: 'guc', k: 1, on: 'm' },
  // --- manyetizma (taban: tesla) ---
  T: { a: 'manyetik', k: 1, on: 'm' },
  ga: { a: 'manyetik', k: 1e-4, on: 'm' },
  // --- sıcaklık: ÖTELEMELİ, ayrıca ele alınır ---
  C: { a: 'sicaklik' }, cel: { a: 'sicaklik' },
  F: { a: 'sicaklik' }, fah: { a: 'sicaklik' },
  K: { a: 'sicaklik' }, kel: { a: 'sicaklik' },
  Rank: { a: 'sicaklik' }, Reau: { a: 'sicaklik' },
  // --- hacim (taban: litre) ---
  l: { a: 'hacim', k: 1, on: 'm' }, L: { a: 'hacim', k: 1, on: 'm' }, lt: { a: 'hacim', k: 1, on: 'm' },
  tsp: { a: 'hacim', k: 4.92892159375e-3 },
  tspm: { a: 'hacim', k: 5e-3 },
  tbs: { a: 'hacim', k: 14.78676478125e-3 },
  oz: { a: 'hacim', k: 29.5735295625e-3 },
  cup: { a: 'hacim', k: 236.5882365e-3 },
  pt: { a: 'hacim', k: 473.176473e-3 }, us_pt: { a: 'hacim', k: 473.176473e-3 },
  uk_pt: { a: 'hacim', k: 568.26125e-3 },
  qt: { a: 'hacim', k: 946.352946e-3 },
  uk_qt: { a: 'hacim', k: 1136.5225e-3 },
  gal: { a: 'hacim', k: 3.785411784 },
  uk_gal: { a: 'hacim', k: 4.54609 },
  barrel: { a: 'hacim', k: 3.785411784 * 42 },
  bushel: { a: 'hacim', k: 35.23907016688 },
  'in3': { a: 'hacim', k: IN * IN * IN * 1000 }, 'in^3': { a: 'hacim', k: IN * IN * IN * 1000 },
  'ft3': { a: 'hacim', k: FT * FT * FT * 1000 }, 'ft^3': { a: 'hacim', k: FT * FT * FT * 1000 },
  'yd3': { a: 'hacim', k: 0.9144 * 0.9144 * 0.9144 * 1000 }, 'yd^3': { a: 'hacim', k: 0.9144 * 0.9144 * 0.9144 * 1000 },
  'mi3': { a: 'hacim', k: MIL * MIL * MIL * 1000 }, 'mi^3': { a: 'hacim', k: MIL * MIL * MIL * 1000 },
  'Nmi3': { a: 'hacim', k: 1852 * 1852 * 1852 * 1000 }, 'Nmi^3': { a: 'hacim', k: 1852 * 1852 * 1852 * 1000 },
  'ly3': { a: 'hacim', k: LY * LY * LY * 1000 }, 'ly^3': { a: 'hacim', k: LY * LY * LY * 1000 },
  'ang3': { a: 'hacim', k: 1e-27 }, 'ang^3': { a: 'hacim', k: 1e-27 },
  'Picapt3': { a: 'hacim', k: Math.pow(IN / 72, 3) * 1000 }, 'Picapt^3': { a: 'hacim', k: Math.pow(IN / 72, 3) * 1000 },
  'Pica3': { a: 'hacim', k: Math.pow(IN / 72, 3) * 1000 }, 'Pica^3': { a: 'hacim', k: Math.pow(IN / 72, 3) * 1000 },
  'm3': { a: 'hacim', k: 1000, on: 'm', us: 3 }, 'm^3': { a: 'hacim', k: 1000, on: 'm', us: 3 },
  MTON: { a: 'hacim', k: FT * FT * FT * 1000 * 40 },
  GRT: { a: 'hacim', k: FT * FT * FT * 1000 * 100 }, regton: { a: 'hacim', k: FT * FT * FT * 1000 * 100 },
  // --- alan (taban: metrekare) ---
  'm2': { a: 'alan', k: 1, on: 'm', us: 2 }, 'm^2': { a: 'alan', k: 1, on: 'm', us: 2 },
  'mi2': { a: 'alan', k: MIL * MIL }, 'mi^2': { a: 'alan', k: MIL * MIL },
  'Nmi2': { a: 'alan', k: 1852 * 1852 }, 'Nmi^2': { a: 'alan', k: 1852 * 1852 },
  'in2': { a: 'alan', k: IN * IN }, 'in^2': { a: 'alan', k: IN * IN },
  'ft2': { a: 'alan', k: FT * FT }, 'ft^2': { a: 'alan', k: FT * FT },
  'yd2': { a: 'alan', k: 0.9144 * 0.9144 }, 'yd^2': { a: 'alan', k: 0.9144 * 0.9144 },
  'ang2': { a: 'alan', k: 1e-20 }, 'ang^2': { a: 'alan', k: 1e-20 },
  'Picapt2': { a: 'alan', k: Math.pow(IN / 72, 2) }, 'Picapt^2': { a: 'alan', k: Math.pow(IN / 72, 2) },
  'Pica2': { a: 'alan', k: Math.pow(IN / 72, 2) }, 'Pica^2': { a: 'alan', k: Math.pow(IN / 72, 2) },
  'ly2': { a: 'alan', k: LY * LY }, 'ly^2': { a: 'alan', k: LY * LY },
  Morgen: { a: 'alan', k: 2500 },
  uk_acre: { a: 'alan', k: 4046.8564224 },
  us_acre: { a: 'alan', k: 4046.87260987425 },
  ha: { a: 'alan', k: 10000 },
  ar: { a: 'alan', k: 100, on: 'm' },
  // --- bilgi (taban: bit) ---
  bit: { a: 'bilgi', k: 1, on: 'b' },
  byte: { a: 'bilgi', k: 8, on: 'b' },
  // --- hız (taban: m/s) ---
  'm/s': { a: 'hiz', k: 1, on: 'm' }, 'm/sec': { a: 'hiz', k: 1, on: 'm' },
  'm/h': { a: 'hiz', k: 1 / 3600, on: 'm' }, 'm/hr': { a: 'hiz', k: 1 / 3600, on: 'm' },
  mph: { a: 'hiz', k: MIL / 3600 },
  kn: { a: 'hiz', k: 1852 / 3600 },
  admkn: { a: 'hiz', k: 1853.184 / 3600 },
};
/** Birim adını { aile, çarpan } olarak çözer; tanınmazsa null */
function birimCoz(ad) {
  const tam = BIRIM[ad];
  if (tam) return { a: tam.a, k: tam.k };
  for (const uz of [2, 1]) {
    if (ad.length <= uz) continue;
    const on = ad.slice(0, uz), kalan = ad.slice(uz);
    const b = BIRIM[kalan];
    if (!b || !b.on) continue;
    let c = null;
    if (uz === 2 && IKILI_ONEK[on] != null && b.on === 'b') c = IKILI_ONEK[on];
    else if (ONEK[on] != null) c = ONEK[on];
    if (c == null) continue;
    // Math.pow ikilik artık bırakır ((1e-2)^3 = 1,0000000000000002e-6); 15 anlamlı haneye
    // çekmek bunu atar, yoksa CONVERT(1;"m3";"cm3") 999999,9999999998 verir.
    const kat = Number(Math.pow(c, b.us || 1).toPrecision(15));
    return { a: b.a, k: b.k * kat };
  }
  return null;
}
/*
 * Ara eksen KELVİN DEĞİL CELSIUS'tur. Kelvin üzerinden gidilseydi CONVERT(68;"F";"C") önce
 * 293,15000000000003 K bulur, sonra 273,15 çıkarıp 20,000000000000057 verirdi: iki ötelemenin
 * ikilik artığı üst üste biner. Celsius ekseninde F ↔ C tek adımdır ve (68−32)·5/9 tam 20'dir.
 */
const SICAK_C = {
  C: (v) => v, cel: (v) => v,
  F: (v) => (v - 32) * 5 / 9, fah: (v) => (v - 32) * 5 / 9,
  K: (v) => v - 273.15, kel: (v) => v - 273.15,
  Rank: (v) => (v - 491.67) * 5 / 9,
  Reau: (v) => v * 1.25,
};
const C_SICAK = {
  C: (v) => v, cel: (v) => v,
  F: (v) => v * 9 / 5 + 32, fah: (v) => v * 9 / 5 + 32,
  K: (v) => v + 273.15, kel: (v) => v + 273.15,
  Rank: (v) => (v + 273.15) * 9 / 5,
  Reau: (v) => v * 0.8,
};

// =================================================================================
// Veritabanı ailesi — D*
// =================================================================================
const metinAnahtar = (v) => (v == null ? '' : String(v).trim().toUpperCase());

/** Tek bir ölçüt hücresini süzgeç işlevine çevirir; koşulsuzsa null */
function vtKosul(k) {
  if (k == null) return null;
  if (hata(k)) return () => false;
  if (typeof k === 'string') {
    const t = k.trim();
    if (t === '') return null;
    if (/^(<=|>=|<>|<|>)/.test(t)) return olcut(t);
    // ="Elma" biçimi TAM eşleşme ister; tırnaklar kullanıcının yazdığı biçimden gelir
    if (t[0] === '=') return olcut('=' + t.slice(1).replace(/^"([\s\S]*)"$/, '$1'));
    /*
     * Düz metin ölçütü BAŞTAN eşleşmedir (Excel'in veritabanı / süzgeç kuralı): "Ka" ölçütü
     * "Kanatlı"yı da eşler. Sona bir '*' eklemek bu kuralın tam karşılığıdır.
     */
    const re = jokerRe(t + '*');
    return (v) => typeof v === 'string' && re.test(v);
  }
  return olcut(k);
}

/** Ölçüt aralığına uyan kayıtların (veri satırlarının) sıra numaraları */
function vtKayitlar(db, olcM) {
  const basliklar = db[0] || [];
  const oBas = olcM[0] || [];
  const esle = oBas.map((b) => {
    const ad = metinAnahtar(b);
    if (ad === '') return -2;   // boş başlık: sütun yok sayılır
    const i = basliklar.findIndex((h) => metinAnahtar(h) === ad);
    return i < 0 ? -1 : i;
  });
  if (esle.some((i) => i === -1)) return ERR.VALUE;
  const gruplar = [];
  for (let r = 1; r < olcM.length; r++) {
    const kos = [];
    for (let c = 0; c < esle.length; c++) {
      if (esle[c] < 0) continue;
      const f = vtKosul(olcM[r][c]);
      if (f) kos.push([esle[c], f]);
    }
    gruplar.push(kos);   // boş grup = koşulsuz satır = bütün kayıtları eşler
  }
  const o = [];
  for (let r = 1; r < db.length; r++) {
    const sat = db[r] || [];
    // Satırlar VEYA, satır içi koşullar VE ile bağlanır.
    if (gruplar.some((g) => g.every(([c, f]) => f(sat[c] === undefined ? null : sat[c])))) o.push(r);
  }
  return o;
}

/** Alan argümanını sütun sırasına çevirir (ad, 1 tabanlı sayı ya da başlık hücresine başvuru) */
function vtAlan(alan, db, ctx) {
  const basliklar = db[0] || [];
  let v = alan;
  if (v && typeof v === 'object' && !Array.isArray(v) && !hata(v) && 'r1' in v) v = basvuruDeger(v, ctx);
  v = ilk(v);
  if (hata(v)) return v;
  if (v == null) return -1;   // DCOUNT / DCOUNTA'da alan atlanabilir
  if (typeof v === 'number') {
    const i = Math.trunc(v) - 1;
    return i >= 0 && i < basliklar.length ? i : ERR.VALUE;
  }
  const ad = metinAnahtar(v);
  const i = basliklar.findIndex((h) => metinAnahtar(h) === ad);
  if (i >= 0) return i;
  const n = metinSayi(ad);
  if (!isNaN(n)) { const j = Math.trunc(n) - 1; if (j >= 0 && j < basliklar.length) return j; }
  return ERR.VALUE;
}

/** D* ailesinin ortak gövdesi: eşleşen kayıtların alan değerlerini toplar */
function vtTopla(a, ctx) {
  const db = mat(a[0]);
  const olcM = mat(a[2]);
  if (db.length < 1 || olcM.length < 1) return ERR.VALUE;
  const alan = vtAlan(a[1], db, ctx);
  if (hata(alan)) return alan;
  const kayit = vtKayitlar(db, olcM);
  if (hata(kayit)) return kayit;
  const o = [];
  for (const r of kayit) {
    const v = alan < 0 ? true : ((db[r] || [])[alan] ?? null);
    if (hata(v)) return v;
    o.push(v);
  }
  return { alan, deger: o };
}
const vtSayilar = (d) => d.deger.filter((v) => typeof v === 'number');
/** Sayısal alan üzerinde çalışan D* işlevleri için ortak sarmalayıcı */
const vtSayisal = (f) => (a, ctx) => {
  const d = vtTopla(a, ctx);
  if (hata(d)) return d;
  return f(vtSayilar(d), d);
};
function varyans(x, orneklem) {
  const n = x.length;
  if (n < (orneklem ? 2 : 1)) return ERR.DIV0;
  const ort = x.reduce((s, v) => s + v, 0) / n;
  const kt = x.reduce((s, v) => s + (v - ort) * (v - ort), 0);
  return kt / (orneklem ? n - 1 : n);
}

// =================================================================================
// İşlev kaydı
// =================================================================================
kaydetHepsi({
  // --- sayı tabanı ---
  DEC2BIN: { en: 1, ek: 2, fn: (a) => dec2(a, 2) },
  DEC2OCT: { en: 1, ek: 2, fn: (a) => dec2(a, 8) },
  DEC2HEX: { en: 1, ek: 2, fn: (a) => dec2(a, 16) },
  BIN2DEC: { en: 1, ek: 1, fn: (a) => tabandanOku(a[0], 2) },
  BIN2OCT: { en: 1, ek: 2, fn: (a) => cevir(a, 2, 8) },
  BIN2HEX: { en: 1, ek: 2, fn: (a) => cevir(a, 2, 16) },
  OCT2DEC: { en: 1, ek: 1, fn: (a) => tabandanOku(a[0], 8) },
  OCT2BIN: { en: 1, ek: 2, fn: (a) => cevir(a, 8, 2) },
  OCT2HEX: { en: 1, ek: 2, fn: (a) => cevir(a, 8, 16) },
  HEX2DEC: { en: 1, ek: 1, fn: (a) => tabandanOku(a[0], 16) },
  HEX2BIN: { en: 1, ek: 2, fn: (a) => cevir(a, 16, 2) },
  HEX2OCT: { en: 1, ek: 2, fn: (a) => cevir(a, 16, 8) },

  // --- bit işlemleri ---
  BITAND: { en: 2, ek: 2, fn: bitIkili((x, y) => x & y) },
  BITOR: { en: 2, ek: 2, fn: bitIkili((x, y) => x | y) },
  BITXOR: { en: 2, ek: 2, fn: bitIkili((x, y) => x ^ y) },
  BITLSHIFT: { en: 2, ek: 2, fn: (a) => bitKaydir(a, 1) },
  BITRSHIFT: { en: 2, ek: 2, fn: (a) => bitKaydir(a, -1) },

  // --- eşik ---
  DELTA: { en: 1, ek: 2, fn: (a) => {
    const x = num(ilk(a[0])); if (hata(x)) return x;
    const y = secSayi(ilk(a[1]), 0); if (hata(y)) return y;
    return x === y ? 1 : 0;
  } },
  GESTEP: { en: 1, ek: 2, fn: (a) => {
    const x = num(ilk(a[0])); if (hata(x)) return x;
    const y = secSayi(ilk(a[1]), 0); if (hata(y)) return y;
    return x >= y ? 1 : 0;
  } },

  // --- hata işlevi ---
  ERF: { en: 1, ek: 2, fn: (a) => {
    const alt = num(ilk(a[0])); if (hata(alt)) return alt;
    if (a[1] == null) return kontrol(erf(alt));
    const ust = num(ilk(a[1])); if (hata(ust)) return ust;
    return kontrol(erf(ust) - erf(alt));
  } },
  ERFC: { en: 1, ek: 1, fn: (a) => { const x = num(ilk(a[0])); return hata(x) ? x : kontrol(erfc(x)); } },
  'ERF.PRECISE': { en: 1, ek: 1, fn: (a) => { const x = num(ilk(a[0])); return hata(x) ? x : kontrol(erf(x)); } },
  'ERFC.PRECISE': { en: 1, ek: 1, fn: (a) => { const x = num(ilk(a[0])); return hata(x) ? x : kontrol(erfc(x)); } },

  // --- Bessel ---
  BESSELI: { en: 2, ek: 2, fn: (a) => { const p = besselArg(a); return hata(p) ? p : kontrol(besselI(p[0], p[1])); } },
  BESSELJ: { en: 2, ek: 2, fn: (a) => { const p = besselArg(a); return hata(p) ? p : kontrol(besselJ(p[0], p[1])); } },
  // K ve Y başlangıçta tekildir ve negatif eksende tanımsızdır: x ≤ 0 → #NUM!
  BESSELK: { en: 2, ek: 2, fn: (a) => { const p = besselArg(a); if (hata(p)) return p; return p[0] <= 0 ? ERR.NUM : kontrol(besselK(p[0], p[1])); } },
  BESSELY: { en: 2, ek: 2, fn: (a) => { const p = besselArg(a); if (hata(p)) return p; return p[0] <= 0 ? ERR.NUM : kontrol(besselY(p[0], p[1])); } },

  // --- birim çevirimi ---
  CONVERT: { en: 3, ek: 3, fn: (a) => {
    const x = num(ilk(a[0])); if (hata(x)) return x;
    const b1 = str(ilk(a[1])); if (hata(b1)) return b1;
    const b2 = str(ilk(a[2])); if (hata(b2)) return b2;
    if (SICAK_C[b1] && SICAK_C[b2]) return kontrol(C_SICAK[b2](SICAK_C[b1](x)));
    const c1 = birimCoz(b1), c2 = birimCoz(b2);
    if (!c1 || !c2 || c1.a !== c2.a || c1.a === 'sicaklik') return ERR.NA;
    return kontrol(temiz(x * c1.k / c2.k));
  } },

  // --- karmaşık sayılar ---
  COMPLEX: { en: 2, ek: 3, fn: (a) => {
    const re = num(ilk(a[0])); if (hata(re)) return re;
    const im = num(ilk(a[1])); if (hata(im)) return im;
    let s = 'i';
    if (a[2] != null) {
      const t = str(ilk(a[2])); if (hata(t)) return t;
      // Excel yalnız küçük harf kabul eder; "I" ya da "J" #VALUE! verir.
      if (t !== 'i' && t !== 'j') return ERR.VALUE;
      s = t;
    }
    return karmasikMetin(re, im, s);
  } },
  IMABS: { en: 1, ek: 1, fn: km1((z) => kontrol(cAbs(z))) },
  IMAGINARY: { en: 1, ek: 1, fn: km1((z) => z.im) },
  IMREAL: { en: 1, ek: 1, fn: km1((z) => z.re) },
  IMARGUMENT: { en: 1, ek: 1, fn: km1((z) => (z.re === 0 && z.im === 0 ? ERR.DIV0 : Math.atan2(z.im, z.re))) },
  IMCONJUGATE: { en: 1, ek: 1, fn: km1((z) => karmasikMetin(z.re, -z.im, z.s || 'i')) },
  IMSUM: { en: 1, ek: -1, fn: (a) => {
    let re = 0, im = 0, s = '';
    for (const v of duzle(a)) {
      if (v == null) continue;
      const z = karmasik(v); if (hata(z)) return z;
      if (z.s) { if (s && s !== z.s) return ERR.VALUE; s = z.s; }
      re += z.re; im += z.im;
    }
    return karmasikMetin(re, im, s || 'i');
  } },
  IMPRODUCT: { en: 1, ek: -1, fn: (a) => {
    let w = { re: 1, im: 0 }, s = '';
    for (const v of duzle(a)) {
      if (v == null) continue;
      const z = karmasik(v); if (hata(z)) return z;
      if (z.s) { if (s && s !== z.s) return ERR.VALUE; s = z.s; }
      w = cCarp(w, z);
    }
    return karmasikMetin(w.re, w.im, s || 'i');
  } },
  IMSUB: { en: 2, ek: 2, fn: km2((x, y, s) => karmasikMetin(x.re - y.re, x.im - y.im, s)) },
  IMDIV: { en: 2, ek: 2, fn: km2((x, y, s) => { const r = cBol(x, y); return hata(r) ? r : karmasikMetin(r.re, r.im, s); }) },
  IMPOWER: { en: 2, ek: 2, fn: (a) => {
    const z = karmasik(ilk(a[0])); if (hata(z)) return z;
    const n = num(ilk(a[1])); if (hata(n)) return n;
    const s = z.s || 'i', r = cAbs(z);
    if (r === 0) return n > 0 ? karmasikMetin(0, 0, s) : ERR.NUM;
    const th = Math.atan2(z.im, z.re), rn = Math.pow(r, n), an = n * th;
    return karmasikMetin(rn * Math.cos(an), rn * Math.sin(an), s);
  } },
  IMSQRT: { en: 1, ek: 1, fn: km1((z) => {
    const r = Math.sqrt(cAbs(z)), th = Math.atan2(z.im, z.re) / 2;
    return karmasikMetin(r * Math.cos(th), r * Math.sin(th), z.s || 'i');
  }) },
  IMEXP: { en: 1, ek: 1, fn: km1((z) => {
    const e = Math.exp(z.re);
    return karmasikMetin(e * Math.cos(z.im), e * Math.sin(z.im), z.s || 'i');
  }) },
  IMLN: { en: 1, ek: 1, fn: km1((z) => {
    if (z.re === 0 && z.im === 0) return ERR.NUM;
    const l = cLn(z); return karmasikMetin(l.re, l.im, z.s || 'i');
  }) },
  IMLOG10: { en: 1, ek: 1, fn: km1((z) => {
    if (z.re === 0 && z.im === 0) return ERR.NUM;
    const l = cLn(z); return karmasikMetin(l.re / Math.LN10, l.im / Math.LN10, z.s || 'i');
  }) },
  IMLOG2: { en: 1, ek: 1, fn: km1((z) => {
    if (z.re === 0 && z.im === 0) return ERR.NUM;
    const l = cLn(z); return karmasikMetin(l.re / Math.LN2, l.im / Math.LN2, z.s || 'i');
  }) },
  IMSIN: { en: 1, ek: 1, fn: km1((z) => { const w = cSin(z); return karmasikMetin(w.re, w.im, z.s || 'i'); }) },
  IMCOS: { en: 1, ek: 1, fn: km1((z) => { const w = cCos(z); return karmasikMetin(w.re, w.im, z.s || 'i'); }) },
  IMTAN: { en: 1, ek: 1, fn: km1((z) => cTers(cSin(z), cCos(z), z.s || 'i')) },
  IMCOT: { en: 1, ek: 1, fn: km1((z) => cTers(cCos(z), cSin(z), z.s || 'i')) },
  IMSEC: { en: 1, ek: 1, fn: km1((z) => cTers(cBir, cCos(z), z.s || 'i')) },
  IMCSC: { en: 1, ek: 1, fn: km1((z) => cTers(cBir, cSin(z), z.s || 'i')) },
  IMSINH: { en: 1, ek: 1, fn: km1((z) => { const w = cSinh(z); return karmasikMetin(w.re, w.im, z.s || 'i'); }) },
  IMCOSH: { en: 1, ek: 1, fn: km1((z) => { const w = cCosh(z); return karmasikMetin(w.re, w.im, z.s || 'i'); }) },
  IMSECH: { en: 1, ek: 1, fn: km1((z) => cTers(cBir, cCosh(z), z.s || 'i')) },
  IMCSCH: { en: 1, ek: 1, fn: km1((z) => cTers(cBir, cSinh(z), z.s || 'i')) },

  // --- veritabanı ---
  DSUM: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => x.reduce((s, v) => s + v, 0)) },
  DPRODUCT: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => (x.length ? x.reduce((s, v) => s * v, 1) : 0)) },
  DAVERAGE: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : ERR.DIV0)) },
  DMAX: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => (x.length ? Math.max(...x) : 0)) },
  DMIN: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => (x.length ? Math.min(...x) : 0)) },
  DVAR: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => varyans(x, true)) },
  DVARP: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => varyans(x, false)) },
  DSTDEV: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => { const v = varyans(x, true); return hata(v) ? v : Math.sqrt(v); }) },
  DSTDEVP: { en: 3, ek: 3, bas: [1], fn: vtSayisal((x) => { const v = varyans(x, false); return hata(v) ? v : Math.sqrt(v); }) },
  DCOUNT: { en: 3, ek: 3, bas: [1], fn: (a, ctx) => {
    const d = vtTopla(a, ctx); if (hata(d)) return d;
    // Alan atlanmışsa Excel EŞLEŞEN KAYIT sayısını verir, sayısal hücre sayısını değil.
    return d.alan < 0 ? d.deger.length : vtSayilar(d).length;
  } },
  DCOUNTA: { en: 3, ek: 3, bas: [1], fn: (a, ctx) => {
    const d = vtTopla(a, ctx); if (hata(d)) return d;
    return d.alan < 0 ? d.deger.length : d.deger.filter((v) => v != null && v !== '').length;
  } },
  DGET: { en: 3, ek: 3, bas: [1], fn: (a, ctx) => {
    const d = vtTopla(a, ctx); if (hata(d)) return d;
    if (d.alan < 0) return ERR.VALUE;
    if (d.deger.length === 0) return ERR.VALUE;   // eşleşme yok
    if (d.deger.length > 1) return ERR.NUM;       // birden çok eşleşme
    return d.deger[0];
  } },
});

/*
 * KAYDEDİLMEYENLER. WEBSERVICE, FILTERXML ve RTD ağ ya da canlı veri kaynağı ister.
 * Bu uygulama çevrimdışı bir görüntüleyicidir; sessizce yanlış (ya da eski) bir değer
 * döndürmektense kaydedilmemeleri, dolayısıyla #NAME? vermeleri yeğdir.
 */
