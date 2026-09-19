/*
 * EXCEL FORMÜL MOTORU — FİNANS
 *
 * KAPSAM. Yıllık ödeme ailesi (PMT, PV, FV, NPER, RATE, IPMT, PPMT, CUMIPMT, CUMPRINC, ISPMT),
 * nakit akışı ölçütleri (NPV, IRR, XNPV, XIRR, MIRR, FVSCHEDULE, PDURATION, RRI), faiz çevrimi
 * (EFFECT, NOMINAL), kesirli fiyat (DOLLARDE, DOLLARFR), amortisman (SLN, SYD, DB, DDB, VDB,
 * AMORDEGRC, AMORLINC), iskontolu kâğıtlar (DISC, INTRATE, RECEIVED, PRICEDISC, YIELDDISC,
 * PRICEMAT, YIELDMAT, TBILL*), kuponlu tahvil (PRICE, YIELD, DURATION, MDURATION, ACCRINT,
 * ACCRINTM, COUP* ailesi) ve tek dönemi düzensiz tahviller (ODDFPRICE, ODDFYIELD, ODDLPRICE,
 * ODDLYIELD).
 *
 * ORTAK TUZAK 1 — İŞARET. Nakit ÇIKIŞI negatiftir. PMT(0,05/12; 60; 10000) NEGATİF çıkar; kredi
 * anaparası pozitif girildiği için taksit borçlunun cebinden çıkar. Pozitif döndüren bir PMT
 * bütün aileyi (IPMT, PPMT, CUMIPMT, NPER, RATE) Excel'in tersine çevirir.
 *
 * ORTAK TUZAK 2 — r = 0. Ailenin ortak denklemi
 *     pv*(1+r)^n + pmt*(1+r*tip)*((1+r)^n - 1)/r + fv = 0
 * faiz sıfırken sıfıra bölünür. Sıfır faiz gerçek bir durumdur (faizsiz taksit), hata değil:
 * her işlevde ayrı dal olarak ele alınır ve denklem pv + pmt*n + fv = 0'a iner.
 *
 * ORTAK TUZAK 3 — KAPALI ÇÖZÜM YOK. RATE, IRR, XIRR, YIELD, ODDFYIELD denklemleri cebirsel
 * olarak çözülemez. Önce Newton denenir, yakınsamazsa işaret değiştiren aralık taranıp ikiye
 * bölmeye düşülür, o da tutmazsa #NUM!. "tahmin" (guess) argümanı bunun içindir.
 *
 * ORTAK TUZAK 4 — GÜN SAYMA TEMELİ. Tahvil ailesinin tamamı temel argümanına bağlıdır:
 *   0 = 30/360 ABD (NASD) · 1 = gerçek/gerçek · 2 = gerçek/360 · 3 = gerçek/365 · 4 = 30/360 Avrupa
 * Tarihler ayrı bir tür değil, Excel seri sayısıdır; gün alanları seriParca ile okunur.
 * Temel 0'ın Şubat sonu kuralı ile temel 1'in "ortalama yıl uzunluğu" kuralı burada yazılıdır;
 * ikisi de şaşırtıcıdır ama Excel'in kendi davranışıdır.
 *
 * ORTAK TUZAK 5 — COUPDAYBS + COUPDAYSNC her zaman COUPDAYS ETMEZ. Temel 2'de kupon dönemi
 * 180 gün sayılırken (360/sıklık) dönem başı ve dönem sonu GERÇEK günle ölçülür. Bakışımsızlık
 * Excel'in kendisindendir; "düzeltmek" tahvil fiyatını Excel'den ayırır.
 */

import {
  ERR, hata, num, duzle, kontrol, seriParca, tarihSeri, kaydetHepsi,
} from './xlfn.js';

// =================================================================================
// Ortak yardımcılar
// =================================================================================

/** Seçimlik argüman: verilmemiş (undefined) ya da boş (null) ise varsayılanına düşer */
const sec = (v, vars) => (v == null ? vars : v);
/** Excel tarih argümanını tamsayıya indirir: seri sayının kesri (saat) gün saymaya girmez */
const gunu = (v) => Math.floor(v);
/** İkilik gösterimin artığını atar: 0,30000000000000004 → 0,3 */
const temiz = (v) => (typeof v === 'number' && isFinite(v) && v !== 0 ? Number(v.toPrecision(15)) : v);
/** Yarımı SIFIRDAN UZAĞA yuvarlar (Excel; Math.round -2,5'i -2 yapardı) */
const yuvarla = (v) => (v < 0 ? -Math.round(-v) : Math.round(v));

/**
 * Sayısal argümanlı işlev sarmalayıcısı. Her argümanı sayıya çevirir, çevrilemeyende hatayı
 * yayar; verilmeyen argüman undefined, boş bırakılan null olarak geçer (ikisi de sec() ile
 * varsayılana düşer, çünkü `== null` her ikisini de yakalar).
 */
const sayisal = (f) => (a, ctx, d) => {
  const s = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v == null) { s[i] = v === null ? null : undefined; continue; }
    const n = num(v);
    if (hata(n)) return n;
    s[i] = n;
  }
  return f(s, ctx, d);
};

const ARTIK = (y) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
const AY_GUN = (y, ay) => [31, ARTIK(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][ay - 1];

/** Tarihe ay ekler; ayın günü hedef ayda yoksa ay sonuna KIRPILIR (31 Ocak + 1 ay = 28 Şubat) */
function ayEkle(seri, k) {
  const p = seriParca(seri);
  let y = p.y, ay = p.ay + k;
  y += Math.floor((ay - 1) / 12);
  ay = ((ay - 1) % 12 + 12) % 12 + 1;
  return tarihSeri(y, ay, Math.min(p.gun, AY_GUN(y, ay)));
}

// ---------------------------------------------------------------------------------
// Gün sayma temelleri
// ---------------------------------------------------------------------------------
/**
 * 30/360 ABD (NASD) — temel 0. Şubat sonu kuralı buranın en şaşırtıcı yeridir: ilk tarih
 * Şubat'ın son günüyse 30 sayılır, iki tarih de Şubat sonuysa ikincisi de 30 sayılır. Bu kural
 * olmadan 28 Şubat - 31 Ağustos arası 183 gün çıkar, Excel'de 180'dir.
 */
function gun360ABD(t1, t2) {
  const a = seriParca(t1), b = seriParca(t2);
  let g1 = a.gun, g2 = b.gun;
  const subatSonu = (p) => p.ay === 2 && p.gun === AY_GUN(p.y, 2);
  if (subatSonu(a) && subatSonu(b)) g2 = 30;
  if (subatSonu(a)) g1 = 30;
  if (g2 === 31 && g1 >= 30) g2 = 30;
  if (g1 === 31) g1 = 30;
  return (b.y - a.y) * 360 + (b.ay - a.ay) * 30 + (g2 - g1);
}
/** 30/360 Avrupa — temel 4: 31 her zaman 30'a iner, Şubat kuralı YOKTUR */
function gun360AVR(t1, t2) {
  const a = seriParca(t1), b = seriParca(t2);
  return (b.y - a.y) * 360 + (b.ay - a.ay) * 30 + (Math.min(b.gun, 30) - Math.min(a.gun, 30));
}
/** İki tarih arasındaki gün sayısı, temele göre */
function gunSay(t1, t2, temel) {
  if (temel === 0) return gun360ABD(t1, t2);
  if (temel === 4) return gun360AVR(t1, t2);
  return t2 - t1;
}
/**
 * Temel 1'in (gerçek/gerçek) yıl uzunluğu. Aralık bir yıldan kısaysa 365 ya da 366 (29 Şubat
 * aralığa düşüyorsa); uzunsa kapsanan takvim yıllarının ORTALAMA uzunluğu kullanılır. Ortalama
 * kuralı Excel'in kendi seçimidir: çok yıllık aralıkta gün başına tek bir yıl uzunluğu gerekir.
 */
function gercekYilGun(t1, t2) {
  const a = seriParca(t1), b = seriParca(t2);
  const kisa = a.y === b.y || (a.y + 1 === b.y && (a.ay > b.ay || (a.ay === b.ay && a.gun >= b.gun)));
  if (!kisa) return (tarihSeri(b.y + 1, 1, 1) - tarihSeri(a.y, 1, 1)) / (b.y - a.y + 1);
  if (a.y === b.y) return ARTIK(a.y) ? 366 : 365;
  for (const y of [a.y, b.y]) {
    if (!ARTIK(y)) continue;
    const s = tarihSeri(y, 2, 29);
    if (s >= t1 && s <= t2) return 366;
  }
  return 365;
}
/** Temelin yıl uzunluğu (gün) */
function yilGun(t1, t2, temel) {
  if (temel === 3) return 365;
  if (temel === 1) return gercekYilGun(t1, t2);
  return 360;
}
/** İki tarih arasındaki süre, YIL cinsinden (Excel'in YEARFRAC'i ile aynı kural) */
const yilKesri = (t1, t2, temel) => gunSay(t1, t2, temel) / yilGun(t1, t2, temel);
/** Temel geçerli mi (0-4) */
const temelGecerli = (t) => Number.isFinite(t) && t >= 0 && t <= 4;
/** Kupon sıklığı yalnız 1, 2, 4 olabilir */
const siklikGecerli = (f) => f === 1 || f === 2 || f === 4;

// ---------------------------------------------------------------------------------
// Sayısal kök bulucu
// ---------------------------------------------------------------------------------
/**
 * Önce Newton (türev sayısal alınır: her denklem için elle türev yazmak hem uzun hem hataya
 * açıktır), yakınsamazsa alt sınırdan üst sınıra doğru işaret değiştiren bir aralık taranıp
 * ikiye bölme. Alt sınır varsayılan olarak -1'in hemen üstüdür: (1+r)^n ifadesi r <= -1'de
 * tanımsızdır.
 */
function coz(f, tahmin, alt = -0.9999999, ust = 1e7) {
  const newton = (x0) => {
    let x = x0;
    if (!isFinite(x) || x <= alt) x = 0.1;
    for (let i = 0; i < 100; i++) {
      const y = f(x);
      if (!isFinite(y)) return null;
      if (y === 0) return x;
      const h = Math.max(1e-8, Math.abs(x) * 1e-8);
      const y2 = f(x + h);
      if (!isFinite(y2)) return null;
      const egim = (y2 - y) / h;
      if (!isFinite(egim) || egim === 0) return null;
      let z = x - y / egim;
      if (!isFinite(z)) return null;
      if (z <= alt) z = (x + alt) / 2;
      if (z >= ust) z = (x + ust) / 2;
      const adim = Math.abs(z - x);
      x = z;
      if (adim < 1e-13 * Math.max(1, Math.abs(x))) return isFinite(f(x)) ? x : null;
    }
    return null;
  };
  const n = newton(tahmin);
  if (n != null) return n;
  // Newton tutmadı: kaba tarama ile işaret değişimi aranır
  const nokta = [];
  for (let k = 0; k <= 200; k++) nokta.push(alt + (ust - alt) * Math.pow(k / 200, 6));
  let a = null, b = null, fa = 0;
  let onceX = null, onceY = null;
  for (const x of nokta) {
    const y = f(x);
    if (!isFinite(y)) { onceX = null; continue; }
    if (y === 0) return x;
    if (onceX != null && ((onceY < 0 && y > 0) || (onceY > 0 && y < 0))) { a = onceX; b = x; fa = onceY; break; }
    onceX = x; onceY = y;
  }
  if (a == null) return null;
  for (let i = 0; i < 300; i++) {
    const m = (a + b) / 2, fm = f(m);
    if (!isFinite(fm)) return null;
    if (fm === 0 || (b - a) < 1e-15 * Math.max(1, Math.abs(m))) return m;
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

// =================================================================================
// Yıllık ödeme (annüite) çekirdeği — bütün aile bu üç satırdan türer
// =================================================================================
const buyume = (r, n) => Math.pow(1 + r, n);
/** pmt'nin denklemdeki katsayısı: (1+r*tip) * ((1+r)^n - 1)/r · r = 0'da n */
const pmtKat = (r, n, tip) => (r === 0 ? n : (1 + r * tip) * (buyume(r, n) - 1) / r);
/** Denklemin sol yanı; kök arayan işlevler (RATE) bunu sıfırlar */
const annu = (r, n, pmt, pv, fv, tip) => (r === 0 ? pv + pmt * n + fv : pv * buyume(r, n) + pmt * pmtKat(r, n, tip) + fv);

function fnPMT(r, n, pv, fv, tip) {
  if (n === 0) return ERR.NUM;
  if (r === 0) return -(pv + fv) / n;
  return -(pv * buyume(r, n) + fv) / pmtKat(r, n, tip);
}
function fnFV(r, n, pmt, pv, tip) {
  if (r === 0) return -(pv + pmt * n);
  return -(pv * buyume(r, n) + pmt * pmtKat(r, n, tip));
}
function fnPV(r, n, pmt, fv, tip) {
  if (r === 0) return -(fv + pmt * n);
  return -(fv + pmt * pmtKat(r, n, tip)) / buyume(r, n);
}
/**
 * Dönem faizi. type = 1'de ilk dönemin faizi SIFIRDIR (ödeme dönem başında yapıldığı için
 * ilk dönemde henüz işlemiş faiz yoktur); sonraki dönemlerde dönem başı ödemesi bakiyeden
 * düşüldükten SONRA faiz işler — FV(...per-2...) - pmt farkı bunu verir.
 */
function fnIPMT(r, per, n, pv, fv, tip) {
  if (per < 1 || per > n) return ERR.NUM;
  const pmt = fnPMT(r, n, pv, fv, tip);
  if (hata(pmt)) return pmt;
  if (tip === 1) return per === 1 ? 0 : (fnFV(r, per - 2, pmt, pv, 1) - pmt) * r;
  return fnFV(r, per - 1, pmt, pv, 0) * r;
}

kaydetHepsi({
  // -------------------------------------------------------------------------------
  // Yıllık ödeme ailesi
  // -------------------------------------------------------------------------------
  PMT: {
    en: 3, ek: 5, fn: sayisal((s) => {
      const r = s[0], n = s[1], pv = s[2], fv = sec(s[3], 0), tip = sec(s[4], 0) ? 1 : 0;
      return kontrol(fnPMT(r, n, pv, fv, tip));
    }),
  },
  PV: {
    en: 3, ek: 5, fn: sayisal((s) => {
      const r = s[0], n = s[1], pmt = s[2], fv = sec(s[3], 0), tip = sec(s[4], 0) ? 1 : 0;
      return kontrol(fnPV(r, n, pmt, fv, tip));
    }),
  },
  FV: {
    en: 3, ek: 5, fn: sayisal((s) => {
      const r = s[0], n = s[1], pmt = s[2], pv = sec(s[3], 0), tip = sec(s[4], 0) ? 1 : 0;
      return kontrol(fnFV(r, n, pmt, pv, tip));
    }),
  },
  NPER: {
    en: 3, ek: 5, fn: sayisal((s) => {
      const r = s[0], pmt = s[1], pv = s[2], fv = sec(s[3], 0), tip = sec(s[4], 0) ? 1 : 0;
      if (r === 0) return pmt === 0 ? ERR.NUM : kontrol(-(pv + fv) / pmt);
      // (1+r)^n * (pv + z) = z - fv  →  n = ln((z-fv)/(pv+z)) / ln(1+r)
      const z = pmt * (1 + r * tip) / r;
      const pay = z - fv, payda = pv + z;
      if (payda === 0 || !isFinite(pay / payda) || pay / payda <= 0) return ERR.NUM;
      return kontrol(Math.log(pay / payda) / Math.log(1 + r));
    }),
  },
  RATE: {
    en: 3, ek: 6, fn: sayisal((s) => {
      const n = s[0], pmt = s[1], pv = s[2], fv = sec(s[3], 0), tip = sec(s[4], 0) ? 1 : 0;
      const tahmin = sec(s[5], 0.1);
      if (n <= 0) return ERR.NUM;
      const r = coz((x) => annu(x, n, pmt, pv, fv, tip), tahmin);
      return r == null ? ERR.NUM : kontrol(temiz(r));
    }),
  },
  IPMT: {
    en: 4, ek: 6, fn: sayisal((s) => {
      const r = s[0], per = s[1], n = s[2], pv = s[3], fv = sec(s[4], 0), tip = sec(s[5], 0) ? 1 : 0;
      return kontrol(fnIPMT(r, per, n, pv, fv, tip));
    }),
  },
  PPMT: {
    en: 4, ek: 6, fn: sayisal((s) => {
      const r = s[0], per = s[1], n = s[2], pv = s[3], fv = sec(s[4], 0), tip = sec(s[5], 0) ? 1 : 0;
      const ipmt = fnIPMT(r, per, n, pv, fv, tip);
      if (hata(ipmt)) return ipmt;
      const pmt = fnPMT(r, n, pv, fv, tip);
      if (hata(pmt)) return pmt;
      return kontrol(pmt - ipmt);
    }),
  },
  /*
   * ISPMT ailenin dışındadır: anapara DOĞRUSAL ödenir (her dönem pv/nper), faiz de kalan
   * anapara üzerinden hesaplanır. Bu yüzden PMT ile tutarlı değildir, olması da beklenmez.
   */
  ISPMT: {
    en: 4, ek: 4, fn: sayisal((s) => {
      const r = s[0], per = s[1], n = s[2], pv = s[3];
      if (n === 0) return ERR.DIV0;
      return kontrol(pv * r * (per / n - 1));
    }),
  },
  CUMIPMT: {
    en: 6, ek: 6, fn: sayisal((s) => {
      const r = s[0], n = s[1], pv = s[2];
      const bas = Math.trunc(s[3]), son = Math.trunc(s[4]), tip = s[5];
      if (r <= 0 || n <= 0 || pv <= 0) return ERR.NUM;
      if (bas < 1 || son < 1 || bas > son || son > n) return ERR.NUM;
      if (tip !== 0 && tip !== 1) return ERR.NUM;
      let t = 0;
      for (let p = bas; p <= son; p++) {
        const v = fnIPMT(r, p, n, pv, 0, tip);
        if (hata(v)) return v;
        t += v;
      }
      return kontrol(t);
    }),
  },
  CUMPRINC: {
    en: 6, ek: 6, fn: sayisal((s) => {
      const r = s[0], n = s[1], pv = s[2];
      const bas = Math.trunc(s[3]), son = Math.trunc(s[4]), tip = s[5];
      if (r <= 0 || n <= 0 || pv <= 0) return ERR.NUM;
      if (bas < 1 || son < 1 || bas > son || son > n) return ERR.NUM;
      if (tip !== 0 && tip !== 1) return ERR.NUM;
      const pmt = fnPMT(r, n, pv, 0, tip);
      if (hata(pmt)) return pmt;
      let t = 0;
      for (let p = bas; p <= son; p++) {
        const v = fnIPMT(r, p, n, pv, 0, tip);
        if (hata(v)) return v;
        t += pmt - v;
      }
      return kontrol(t);
    }),
  },
});

// =================================================================================
// Nakit akışı ölçütleri
// =================================================================================
/**
 * Nakit akışı süzgeci. ARALIKTAN gelen metin, mantık ve BOŞ hücre atlanır — atlanan hücre
 * dönemi de kaydırır, Excel öyle yapar; DOĞRUDAN yazılan argüman ise sayıya çevrilir.
 * Ayrım dizi olup olmamasından gelir: çok hücreli başvuru dizi, sabit skalerdir.
 */
function nakit(args) {
  const o = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of duzle([a])) {
        if (hata(v)) return v;
        if (typeof v === 'number') o.push(v);
      }
    } else if (a != null) {
      const x = num(a);
      if (hata(x)) return x;
      o.push(x);
    }
  }
  return o;
}
/** Excel'in NPV'si: İLK değer bir dönem İSKONTO EDİLİR (t = 1'den başlar) */
const npvTopla = (r, v) => { let t = 0; for (let i = 0; i < v.length; i++) t += v[i] / Math.pow(1 + r, i + 1); return t; };
/** IRR'nin sıfırladığı toplam: ilk değer t = 0'da, iskontosuz */
const irrTopla = (r, v) => { let t = 0; for (let i = 0; i < v.length; i++) t += v[i] / Math.pow(1 + r, i); return t; };

kaydetHepsi({
  NPV: {
    en: 2, ek: 255, fn: (a) => {
      const r = num(a[0]);
      if (hata(r)) return r;
      if (r === -1) return ERR.DIV0;
      const v = nakit(a.slice(1));
      if (hata(v)) return v;
      return kontrol(npvTopla(r, v));
    },
  },
  IRR: {
    en: 1, ek: 2, fn: (a) => {
      const v = nakit([a[0]]);
      if (hata(v)) return v;
      const tahmin = a[1] == null ? 0.1 : num(a[1]);
      if (hata(tahmin)) return tahmin;
      if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) return ERR.NUM;
      const r = coz((x) => irrTopla(x, v), tahmin);
      return r == null ? ERR.NUM : kontrol(temiz(r));
    },
  },
  MIRR: {
    en: 3, ek: 3, fn: (a) => {
      const v = nakit([a[0]]);
      if (hata(v)) return v;
      const fr = num(a[1]), rr = num(a[2]);
      if (hata(fr)) return fr;
      if (hata(rr)) return rr;
      const n = v.length;
      if (n < 2 || !v.some((x) => x > 0) || !v.some((x) => x < 0)) return ERR.DIV0;
      /*
       * Olumlu akışlar yeniden yatırım oranıyla dönem sonuna TAŞINIR, olumsuz akışlar finansman
       * oranıyla başa İSKONTO EDİLİR. İki NPV de Excel'in NPV'si olduğu için ikisinde de fazladan
       * bir (1+oran) çarpanı vardır; oranı bölümde birbirini götürür — bu yüzden payda (1+fr)
       * ile çarpılır, pay (1+rr)^n ile.
       */
      const arti = v.map((x) => (x > 0 ? x : 0));
      const eksi = v.map((x) => (x < 0 ? x : 0));
      const pay = -npvTopla(rr, arti) * Math.pow(1 + rr, n);
      const payda = npvTopla(fr, eksi) * (1 + fr);
      if (payda === 0) return ERR.DIV0;
      return kontrol(temiz(Math.pow(pay / payda, 1 / (n - 1)) - 1));
    },
  },
  XNPV: {
    en: 3, ek: 3, fn: (a) => {
      const r = num(a[0]);
      if (hata(r)) return r;
      const v = duzle([a[1]]), t = duzle([a[2]]);
      if (v.length !== t.length || !v.length) return ERR.NUM;
      const d0 = gunu(num(t[0]));
      let s = 0;
      for (let i = 0; i < v.length; i++) {
        const x = num(v[i]), g = num(t[i]);
        if (hata(x)) return x;
        if (hata(g)) return g;
        const gi = gunu(g);
        if (gi < d0) return ERR.NUM;
        // XNPV her zaman 365 günlük yıl kullanır; temel argümanı yoktur
        s += x / Math.pow(1 + r, (gi - d0) / 365);
      }
      return kontrol(s);
    },
  },
  XIRR: {
    en: 2, ek: 3, fn: (a) => {
      const v = duzle([a[0]]), t = duzle([a[1]]);
      if (v.length !== t.length || !v.length) return ERR.NUM;
      const tahmin = a[2] == null ? 0.1 : num(a[2]);
      if (hata(tahmin)) return tahmin;
      const say = [], gunler = [];
      for (let i = 0; i < v.length; i++) {
        const x = num(v[i]), g = num(t[i]);
        if (hata(x)) return x;
        if (hata(g)) return g;
        say.push(x); gunler.push(gunu(g));
      }
      const d0 = gunler[0];
      if (gunler.some((g) => g < d0)) return ERR.NUM;
      if (!say.some((x) => x > 0) || !say.some((x) => x < 0)) return ERR.NUM;
      const f = (r) => { let s = 0; for (let i = 0; i < say.length; i++) s += say[i] / Math.pow(1 + r, (gunler[i] - d0) / 365); return s; };
      const r = coz(f, tahmin);
      return r == null ? ERR.NUM : kontrol(temiz(r));
    },
  },
  FVSCHEDULE: {
    en: 2, ek: 2, fn: (a) => {
      const p = num(a[0]);
      if (hata(p)) return p;
      let t = p;
      for (const v of duzle([a[1]])) {
        if (hata(v)) return v;
        const x = num(v);   // boş hücre 0 faiz demektir, atlanmaz
        if (hata(x)) return x;
        t *= 1 + x;
      }
      return kontrol(t);
    },
  },
  PDURATION: {
    en: 3, ek: 3, fn: sayisal((s) => {
      const [r, pv, fv] = s;
      if (r <= 0 || pv <= 0 || fv <= 0) return ERR.NUM;
      return kontrol((Math.log(fv) - Math.log(pv)) / Math.log(1 + r));
    }),
  },
  RRI: {
    en: 3, ek: 3, fn: sayisal((s) => {
      const [n, pv, fv] = s;
      if (n <= 0 || pv === 0) return ERR.NUM;
      const oran = fv / pv;
      if (oran < 0) return ERR.NUM;
      return kontrol(temiz(Math.pow(oran, 1 / n) - 1));
    }),
  },
  EFFECT: {
    en: 2, ek: 2, fn: sayisal((s) => {
      const nom = s[0], d = Math.trunc(s[1]);
      if (nom <= 0 || d < 1) return ERR.NUM;
      return kontrol(temiz(Math.pow(1 + nom / d, d) - 1));
    }),
  },
  NOMINAL: {
    en: 2, ek: 2, fn: sayisal((s) => {
      const ef = s[0], d = Math.trunc(s[1]);
      if (ef <= 0 || d < 1) return ERR.NUM;
      return kontrol(temiz((Math.pow(ef + 1, 1 / d) - 1) * d));
    }),
  },
  /*
   * DOLLARDE / DOLLARFR — kesirli fiyat gösterimi (tahvil piyasası: 1.02 = 1 + 2/16).
   * Kesirli kısmın ÖLÇEĞİ paydanın basamak sayısından gelir: 10^ceil(log10(payda)). Payda 16
   * iki basamaklıdır, bu yüzden ",02" okunurken 100 ile çarpılıp 16'ya bölünür.
   */
  DOLLARDE: {
    en: 2, ek: 2, fn: sayisal((s) => {
      const d = s[0], f = Math.trunc(s[1]);
      if (f < 0) return ERR.NUM;
      if (f === 0) return ERR.DIV0;
      const isaret = d < 0 ? -1 : 1, m = Math.abs(d);
      const tamKisim = Math.trunc(m);
      const kesir = m - tamKisim;
      const olcek = Math.pow(10, Math.ceil(Math.log10(f)));
      return kontrol(temiz(isaret * (tamKisim + kesir * olcek / f)));
    }),
  },
  DOLLARFR: {
    en: 2, ek: 2, fn: sayisal((s) => {
      const d = s[0], f = Math.trunc(s[1]);
      if (f < 0) return ERR.NUM;
      if (f === 0) return ERR.DIV0;
      const isaret = d < 0 ? -1 : 1, m = Math.abs(d);
      const tamKisim = Math.trunc(m);
      const kesir = m - tamKisim;
      const olcek = Math.pow(10, Math.ceil(Math.log10(f)));
      return kontrol(temiz(isaret * (tamKisim + kesir * f / olcek)));
    }),
  },
});

// =================================================================================
// Amortisman
// =================================================================================
/**
 * DDB'nin ham çekirdeği (doğrulama yapmaz; VDB de bunu kullanır). Dönem KESİRLİ olabilir:
 * değer sürekli (1-oran)^dönem eğrisiyle izlenir. Amortisman hurda değerin ALTINA İNMEZ —
 * son dönemlerde kesilen tutar budur, oran değişmez.
 */
function ddbHam(maliyet, hurda, omur, donem, carpan) {
  let oran = carpan / omur, eski;
  if (oran >= 1) { oran = 1; eski = donem === 1 ? maliyet : 0; } else eski = maliyet * Math.pow(1 - oran, donem - 1);
  const yeni = maliyet * Math.pow(1 - oran, donem);
  const d = yeni < hurda ? eski - hurda : eski - yeni;
  return d < 0 ? 0 : d;
}
/**
 * VDB'nin çekirdeği: 1. dönemden ceil(donem)'e kadar azalan bakiye, ama kalan amortismanın
 * doğrusal payı azalan bakiyeyi GEÇTİĞİ anda doğrusala geçilir ve BİR DAHA geri dönülmez
 * (Excel'in "switch to straight line" davranışı). Son dönem kesirliyse orantılanır.
 */
function vdbCekirdek(maliyet, hurda, omur, omurKalan, donem, carpan) {
  let toplam = 0, dogrusal = 0, artikDogrusal = false;
  const sinir = Math.ceil(donem);
  const amorte = maliyet - hurda;
  for (let i = 1; i <= sinir; i++) {
    let t;
    if (!artikDogrusal) {
      t = ddbHam(maliyet, hurda, omur, i, carpan);
      dogrusal = (amorte - toplam) / (omurKalan - (i - 1));
      if (dogrusal > t) { t = dogrusal; artikDogrusal = true; }
    } else t = dogrusal;
    if (i === sinir) t *= donem + 1 - sinir;
    toplam += t;
  }
  return toplam;
}

kaydetHepsi({
  SLN: {
    en: 3, ek: 3, fn: sayisal((s) => {
      const [c, h, n] = s;
      if (n === 0) return ERR.DIV0;
      return kontrol((c - h) / n);
    }),
  },
  SYD: {
    en: 4, ek: 4, fn: sayisal((s) => {
      const [c, h, n, p] = s;
      if (n <= 0) return ERR.NUM;
      if (p <= 0 || p > n) return ERR.NUM;
      return kontrol((c - h) * (n - p + 1) * 2 / (n * (n + 1)));
    }),
  },
  /*
   * DB — sabit oranlı azalan bakiye. Oran ÜÇ ONDALIĞA yuvarlanır (Excel'in kendi kuralı; bu
   * yuvarlama olmadan sonuçlar kuruş kuruş kayar) ve ilk yıl `ay` kadar, life+1. dönem ise
   * yılın kalan (12-ay) ayı kadar işletilir.
   */
  DB: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const c = s[0], h = s[1], n = s[2], p = Math.trunc(s[3]), ay = Math.trunc(sec(s[4], 12));
      if (c < 0 || h < 0 || n <= 0 || p <= 0) return ERR.NUM;
      if (ay < 1 || ay > 12) return ERR.NUM;
      if (p > n + 1) return ERR.NUM;
      if (c === 0) return 0;
      const oran = yuvarla((1 - Math.pow(h / c, 1 / n)) * 1000) / 1000;
      let toplam = c * oran * ay / 12;
      if (p === 1) return kontrol(toplam);
      for (let i = 2; i <= n; i++) {
        const d = (c - toplam) * oran;
        if (i === p) return kontrol(d);
        toplam += d;
      }
      return kontrol((c - toplam) * oran * (12 - ay) / 12);
    }),
  },
  DDB: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const c = s[0], h = s[1], n = s[2], p = s[3], f = sec(s[4], 2);
      if (c < 0 || h < 0 || n <= 0 || p < 1 || p > n || f <= 0) return ERR.NUM;
      return kontrol(ddbHam(c, h, n, p, f));
    }),
  },
  VDB: {
    en: 5, ek: 7, fn: sayisal((s) => {
      const c = s[0], h = s[1], n = s[2];
      let bas = s[3], son = s[4];
      const f = sec(s[5], 2);
      const gecisYok = !!sec(s[6], 0);
      if (c < 0 || h < 0 || n <= 0 || bas < 0 || son < bas || son > n || f <= 0) return ERR.NUM;
      if (gecisYok) {
        // Doğrusala geçiş kapalı: her dönemin azalan bakiyesi, iki uçta orantılı
        const iBas = Math.floor(bas), iSon = Math.ceil(son);
        let t = 0;
        for (let i = iBas + 1; i <= iSon; i++) {
          let d = ddbHam(c, h, n, i, f);
          if (i === iBas + 1) d *= Math.min(son, iBas + 1) - bas;
          else if (i === iSon) d *= son + 1 - iSon;
          t += d;
        }
        return kontrol(t);
      }
      const kalanMaliyet = c - vdbCekirdek(c, h, n, n, bas, f);
      return kontrol(vdbCekirdek(kalanMaliyet, h, n, n - bas, son - bas, f));
    }),
  },
  /*
   * AMORDEGRC / AMORLINC — Fransız muhasebe amortismanı. AMORDEGRC'de katsayı ÖMÜRDEN türer
   * (1/oran): 3 yıldan kısa 1 · 3-5 yıl 1,5 · 5-6 yıl 2 · daha uzunu 2,5. Tutarlar her dönemde
   * TAM BİRİME yuvarlanır (Fransız usulü) ve son iki dönemde kalan %50-%50 bölünür.
   */
  AMORDEGRC: {
    en: 6, ek: 7, fn: sayisal((s) => {
      const c = s[0], alim = gunu(s[1]), ilk = gunu(s[2]), hurda = s[3];
      const donem = Math.trunc(s[4]);
      let oran = s[5];
      const temel = Math.trunc(sec(s[6], 0));
      if (!temelGecerli(temel) || oran <= 0 || c <= 0 || hurda < 0 || hurda > c || donem < 0) return ERR.NUM;
      if (alim > ilk) return ERR.NUM;
      const omur = 1 / oran;
      const katsayi = omur < 3 ? 1 : omur < 5 ? 1.5 : omur <= 6 ? 2 : 2.5;
      oran *= katsayi;
      let maliyet = c;
      let tutar = yuvarla(yilKesri(alim, ilk, temel) * oran * maliyet);
      maliyet -= tutar;
      let kalan = maliyet - hurda;
      for (let n = 0; n < donem; n++) {
        tutar = yuvarla(oran * maliyet);
        kalan -= tutar;
        if (kalan < 0) tutar = donem - n <= 1 ? yuvarla(maliyet * 0.5) : 0;
        maliyet -= tutar;
      }
      return kontrol(tutar);
    }),
  },
  AMORLINC: {
    en: 6, ek: 7, fn: sayisal((s) => {
      const c = s[0], alim = gunu(s[1]), ilk = gunu(s[2]), hurda = s[3];
      const donem = Math.trunc(s[4]), oran = s[5];
      const temel = Math.trunc(sec(s[6], 0));
      if (!temelGecerli(temel) || oran <= 0 || c <= 0 || hurda < 0 || hurda > c || donem < 0) return ERR.NUM;
      if (alim > ilk) return ERR.NUM;
      const donemTutar = c * oran;
      const ilkTutar = yilKesri(alim, ilk, temel) * oran * c;
      if (donem === 0) return kontrol(ilkTutar);
      const tamDonem = Math.trunc((c - hurda - ilkTutar) / donemTutar);
      if (donem <= tamDonem) return kontrol(donemTutar);
      if (donem === tamDonem + 1) return kontrol(c - hurda - donemTutar * tamDonem - ilkTutar);
      return 0;
    }),
  },
});

// =================================================================================
// Kupon takvimi
// =================================================================================
/*
 * Kupon tarihleri VADEDEN GERİYE üretilir, ihraçtan ileriye değil: vadenin ayın kaçı olduğu
 * korunur, hedef ayda o gün yoksa ay sonuna kırpılır (31 Ağustos vadeli altı aylık kâğıdın
 * kuponu 28/29 Şubat'a düşer). İleriye üretilse kırpılan gün bir daha geri gelmezdi.
 */
/** Ödeme gününe eşit ya da ondan küçük son kupon tarihi */
function kuponOnceki(odeme, vade, siklik) {
  const adim = 12 / siklik;
  let n = 0, t = vade;
  while (t > odeme) { n++; t = ayEkle(vade, -n * adim); }
  return t;
}
/** Ödeme gününden sonraki ilk kupon tarihi */
function kuponSonraki(odeme, vade, siklik) {
  const adim = 12 / siklik;
  let n = 0, t = vade;
  while (t > odeme) { n++; const o = ayEkle(vade, -n * adim); if (o <= odeme) break; t = o; }
  return t;
}
/** Ödeme günü ile vade arasında kalan kupon sayısı (ay farkından; gün sayısı yuvarlamaz) */
function kuponSayisi(odeme, vade, siklik) {
  const a = seriParca(kuponOnceki(odeme, vade, siklik)), b = seriParca(vade);
  return Math.round(((b.y - a.y) * 12 + (b.ay - a.ay)) / (12 / siklik));
}
/** Kupon döneminin gün sayısı: temel 1'de gerçek, ötekilerde yılın temel uzunluğu / sıklık */
function kuponGun(odeme, vade, siklik, temel) {
  if (temel === 1) return kuponSonraki(odeme, vade, siklik) - kuponOnceki(odeme, vade, siklik);
  return (temel === 3 ? 365 : 360) / siklik;
}
/** Dönem başından ödeme gününe geçen gün */
const kuponGunBS = (odeme, vade, siklik, temel) => gunSay(kuponOnceki(odeme, vade, siklik), odeme, temel);
/**
 * Ödeme gününden sonraki kupona kalan gün. Temel 0 ve 4'te dönem uzunluğundan çıkarılır,
 * ötekilerde GERÇEK gün sayılır — bu yüzden temel 2'de BS + NC dönem uzunluğunu tutmaz.
 */
function kuponGunNC(odeme, vade, siklik, temel) {
  if (temel === 0 || temel === 4) return kuponGun(odeme, vade, siklik, temel) - kuponGunBS(odeme, vade, siklik, temel);
  return gunSay(odeme, kuponSonraki(odeme, vade, siklik), temel);
}
/** Tahvil ailesinin ortak denetimi */
function tahvilDenet(odeme, vade, siklik, temel) {
  if (!siklikGecerli(siklik)) return ERR.NUM;
  if (!temelGecerli(temel)) return ERR.NUM;
  if (odeme >= vade) return ERR.NUM;
  return null;
}

/**
 * Kuponlu tahvilin temiz fiyatı (100 birim nominal). Son kupon dönemindeyken (N = 1) Excel
 * BİLEŞİK değil BASİT faiz kullanır — para piyasası geleneği; bileşik yazılırsa son dönemde
 * fiyat kuruş kuruş kayar.
 */
function tahvilFiyat(odeme, vade, kupon, getiri, itfa, siklik, temel) {
  const N = kuponSayisi(odeme, vade, siklik);
  const E = kuponGun(odeme, vade, siklik, temel);
  const A = kuponGunBS(odeme, vade, siklik, temel);
  const DSC = kuponGunNC(odeme, vade, siklik, temel);
  const k = 100 * kupon / siklik;
  if (N === 1) return (itfa + k) / (1 + (DSC / E) * getiri / siklik) - k * A / E;
  const y = 1 + getiri / siklik;
  let p = itfa / Math.pow(y, N - 1 + DSC / E);
  for (let i = 1; i <= N; i++) p += k / Math.pow(y, i - 1 + DSC / E);
  return p - k * A / E;
}

kaydetHepsi({
  COUPPCD: {
    en: 3, ek: 4, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), f = Math.trunc(s[2]), t = Math.trunc(sec(s[3], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      return kuponOnceki(o, v, f);
    }),
  },
  COUPNCD: {
    en: 3, ek: 4, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), f = Math.trunc(s[2]), t = Math.trunc(sec(s[3], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      return kuponSonraki(o, v, f);
    }),
  },
  COUPNUM: {
    en: 3, ek: 4, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), f = Math.trunc(s[2]), t = Math.trunc(sec(s[3], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      return kuponSayisi(o, v, f);
    }),
  },
  COUPDAYS: {
    en: 3, ek: 4, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), f = Math.trunc(s[2]), t = Math.trunc(sec(s[3], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      return kuponGun(o, v, f, t);
    }),
  },
  COUPDAYBS: {
    en: 3, ek: 4, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), f = Math.trunc(s[2]), t = Math.trunc(sec(s[3], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      return kuponGunBS(o, v, f, t);
    }),
  },
  COUPDAYSNC: {
    en: 3, ek: 4, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), f = Math.trunc(s[2]), t = Math.trunc(sec(s[3], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      return kuponGunNC(o, v, f, t);
    }),
  },

  // -------------------------------------------------------------------------------
  // Kuponlu tahvil
  // -------------------------------------------------------------------------------
  PRICE: {
    en: 6, ek: 7, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), kupon = s[2], getiri = s[3], itfa = s[4];
      const f = Math.trunc(s[5]), t = Math.trunc(sec(s[6], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (kupon < 0 || getiri < 0 || itfa <= 0) return ERR.NUM;
      return kontrol(tahvilFiyat(o, v, kupon, getiri, itfa, f, t));
    }),
  },
  YIELD: {
    en: 6, ek: 7, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), kupon = s[2], fiyat = s[3], itfa = s[4];
      const f = Math.trunc(s[5]), t = Math.trunc(sec(s[6], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (kupon < 0 || fiyat <= 0 || itfa <= 0) return ERR.NUM;
      const r = coz((y) => tahvilFiyat(o, v, kupon, y, itfa, f, t) - fiyat, 0.05);
      return r == null ? ERR.NUM : kontrol(temiz(r));
    }),
  },
  /*
   * DURATION — Macaulay süresi. Ödeme günü kupon tarihine denk gelmediğinde bütün üsler
   * kesirli kaydırılır (fark = yıl kesri * sıklık - kupon sayısı); bu kaydırma olmadan
   * dönem içinde alınan tahvilin süresi bir tam dönem yanlış çıkar.
   */
  DURATION: {
    en: 5, ek: 6, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), kupon = s[2], getiri = s[3];
      const f = Math.trunc(s[4]), t = Math.trunc(sec(s[5], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (kupon < 0 || getiri < 0) return ERR.NUM;
      return kontrol(sureHesap(o, v, kupon, getiri, f, t));
    }),
  },
  MDURATION: {
    en: 5, ek: 6, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), kupon = s[2], getiri = s[3];
      const f = Math.trunc(s[4]), t = Math.trunc(sec(s[5], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (kupon < 0 || getiri < 0) return ERR.NUM;
      return kontrol(sureHesap(o, v, kupon, getiri, f, t) / (1 + getiri / f));
    }),
  },
  ACCRINT: {
    en: 6, ek: 8, fn: sayisal((s) => {
      const ihrac = gunu(s[0]), ilkFaiz = gunu(s[1]), odeme = gunu(s[2]);
      const oran = s[3], nominal = sec(s[4], 1000), f = Math.trunc(s[5]);
      const t = Math.trunc(sec(s[6], 0));
      const yontem = s[7] == null ? true : s[7] !== 0;
      if (!siklikGecerli(f) || !temelGecerli(t)) return ERR.NUM;
      if (oran <= 0 || nominal <= 0 || ihrac >= odeme) return ERR.NUM;
      // yontem = YANLIŞ ise faiz ilk kupon tarihinden itibaren işler, ihraçtan değil
      const bas = !yontem && odeme > ilkFaiz ? ilkFaiz : ihrac;
      return kontrol(nominal * oran * yilKesri(bas, odeme, t));
    }),
  },
  ACCRINTM: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const ihrac = gunu(s[0]), odeme = gunu(s[1]), oran = s[2];
      const nominal = sec(s[3], 1000), t = Math.trunc(sec(s[4], 0));
      if (!temelGecerli(t)) return ERR.NUM;
      if (oran <= 0 || nominal <= 0 || ihrac >= odeme) return ERR.NUM;
      return kontrol(nominal * oran * yilKesri(ihrac, odeme, t));
    }),
  },
});

/**
 * DURATION / MDURATION ortak çekirdeği.
 * Kaydırma (fark) YIL KESRİNDEN DEĞİL kupon döneminden alınır: fark = DSC/E - 1. İkisi kâğıt
 * üzerinde aynı sayıdır, ama temel 1'in "ortalama yıl uzunluğu" kuralı yüzünden yıl kesri tam
 * kupon gününde bile 8,000 yerine 7,998 verir ve süre dördüncü hanede kayar. DSC/E kupon
 * gününde tam olarak 1'dir, dolayısıyla kaydırma sıfırdır — PRICE'ın üsleriyle de aynı olur.
 */
function sureHesap(odeme, vade, kupon, getiri, siklik, temel) {
  const N = kuponSayisi(odeme, vade, siklik);
  const k = kupon * 100 / siklik;
  const y = 1 + getiri / siklik;
  const fark = kuponGunNC(odeme, vade, siklik, temel) / kuponGun(odeme, vade, siklik, temel) - 1;
  let pay = 0, payda = 0;
  for (let i = 1; i < N; i++) {
    const us = i + fark, d = k / Math.pow(y, us);
    pay += us * d; payda += d;
  }
  const sonUs = N + fark, son = (k + 100) / Math.pow(y, sonUs);
  pay += sonUs * son; payda += son;
  return pay / payda / siklik;
}

// =================================================================================
// İskontolu kâğıtlar ve hazine bonosu
// =================================================================================
/** Kuponsuz kâğıtların ortak denetimi (kupon sıklığı yoktur) */
function iskontoDenet(odeme, vade, temel) {
  if (!temelGecerli(temel)) return ERR.NUM;
  if (odeme >= vade) return ERR.NUM;
  return null;
}

kaydetHepsi({
  DISC: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), fiyat = s[2], itfa = s[3], t = Math.trunc(sec(s[4], 0));
      const h = iskontoDenet(o, v, t); if (h) return h;
      if (fiyat <= 0 || itfa <= 0) return ERR.NUM;
      return kontrol((itfa - fiyat) / itfa / yilKesri(o, v, t));
    }),
  },
  INTRATE: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), yatirim = s[2], itfa = s[3], t = Math.trunc(sec(s[4], 0));
      const h = iskontoDenet(o, v, t); if (h) return h;
      if (yatirim <= 0 || itfa <= 0) return ERR.NUM;
      return kontrol((itfa - yatirim) / yatirim / yilKesri(o, v, t));
    }),
  },
  RECEIVED: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), yatirim = s[2], iskonto = s[3], t = Math.trunc(sec(s[4], 0));
      const h = iskontoDenet(o, v, t); if (h) return h;
      if (yatirim <= 0 || iskonto <= 0) return ERR.NUM;
      const payda = 1 - iskonto * yilKesri(o, v, t);
      if (payda === 0) return ERR.DIV0;
      return kontrol(yatirim / payda);
    }),
  },
  PRICEDISC: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), iskonto = s[2], itfa = s[3], t = Math.trunc(sec(s[4], 0));
      const h = iskontoDenet(o, v, t); if (h) return h;
      if (iskonto <= 0 || itfa <= 0) return ERR.NUM;
      return kontrol(itfa - iskonto * itfa * yilKesri(o, v, t));
    }),
  },
  YIELDDISC: {
    en: 4, ek: 5, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), fiyat = s[2], itfa = s[3], t = Math.trunc(sec(s[4], 0));
      const h = iskontoDenet(o, v, t); if (h) return h;
      if (fiyat <= 0 || itfa <= 0) return ERR.NUM;
      return kontrol((itfa - fiyat) / fiyat / yilKesri(o, v, t));
    }),
  },
  /*
   * PRICEMAT / YIELDMAT — vadesinde faiz ödeyen kâğıt: kupon yoktur, faiz ihraçtan vadeye
   * tek seferde işler. Bu yüzden ödeme gününe kadar işlemiş faiz (A) fiyattan düşülür.
   */
  PRICEMAT: {
    en: 5, ek: 6, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), ihrac = gunu(s[2]), oran = s[3], getiri = s[4];
      const t = Math.trunc(sec(s[5], 0));
      const h = iskontoDenet(o, v, t); if (h) return h;
      if (oran < 0 || getiri < 0 || ihrac >= o) return ERR.NUM;
      const A = yilKesri(ihrac, o, t), DSM = yilKesri(o, v, t), DIM = yilKesri(ihrac, v, t);
      const payda = 1 + DSM * getiri;
      if (payda === 0) return ERR.DIV0;
      return kontrol((100 + DIM * oran * 100) / payda - A * oran * 100);
    }),
  },
  YIELDMAT: {
    en: 5, ek: 6, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), ihrac = gunu(s[2]), oran = s[3], fiyat = s[4];
      const t = Math.trunc(sec(s[5], 0));
      const h = iskontoDenet(o, v, t); if (h) return h;
      if (oran < 0 || fiyat <= 0 || ihrac >= o) return ERR.NUM;
      const A = yilKesri(ihrac, o, t), DSM = yilKesri(o, v, t), DIM = yilKesri(ihrac, v, t);
      const payda = fiyat / 100 + A * oran;
      if (payda === 0 || DSM === 0) return ERR.DIV0;
      return kontrol(((1 + DIM * oran) / payda - 1) / DSM);
    }),
  },
  /*
   * Hazine bonosu ailesi her zaman GERÇEK gün / 360 çalışır (temel argümanı yoktur) ve vade
   * ödeme gününden bir yıldan uzak olamaz. TBILLEQ'in payında 365 vardır: bono getirisi
   * 360 günlük iskontodan 365 günlük tahvil eşdeğerine çevrilir.
   */
  TBILLEQ: {
    en: 3, ek: 3, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), isk = s[2];
      if (o >= v || isk <= 0 || v - o > 365) return ERR.NUM;
      const payda = 360 - isk * (v - o);
      if (payda <= 0) return ERR.NUM;
      return kontrol(365 * isk / payda);
    }),
  },
  TBILLPRICE: {
    en: 3, ek: 3, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), isk = s[2];
      if (o >= v || isk <= 0 || v - o > 365) return ERR.NUM;
      const f = 100 * (1 - isk * (v - o) / 360);
      if (f <= 0) return ERR.NUM;
      return kontrol(f);
    }),
  },
  TBILLYIELD: {
    en: 3, ek: 3, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), fiyat = s[2];
      if (o >= v || fiyat <= 0 || v - o > 365) return ERR.NUM;
      return kontrol((100 - fiyat) / fiyat * 360 / (v - o));
    }),
  },
});

// =================================================================================
// İlk ya da son dönemi düzensiz tahviller
// =================================================================================
/**
 * Düzensiz İLK dönemin sanal (quasi) kupon dönemlerine ayrılması. İlk kupon tarihinden GERİYE
 * doğru sanal kupon tarihleri üretilir; ihracın düştüğü dönem kısmi kalır.
 * Döndürülenler: DC = Σ(dönem payı / dönem uzunluğu) — ilk kuponun kaç tam kupona denk geldiği,
 * A = işlemiş faiz payı, Nq = ödeme gününden ilk kupona kalan TAM sanal dönem sayısı,
 * DSC / E = ödeme gününün içinde bulunduğu sanal dönemden kalan pay.
 * KISA ve UZUN ilk dönem bu ayrıştırmayla AYNI formüle girer: kısa dönemde NC = 1 olur ve
 * toplamlar tek terime iner, Excel'in iki ayrı yazdığı formül böylece tek yerde toplanır.
 */
function quasiParca(ihrac, ilkKupon, odeme, siklik, temel) {
  const adim = 12 / siklik;
  const q = [ilkKupon];
  let n = 0;
  while (q[q.length - 1] > ihrac) { n++; q.push(ayEkle(ilkKupon, -n * adim)); }
  const NC = q.length - 1;
  let DC = 0, A = 0, Nq = 0, DSC = 0, E = 0;
  for (let i = 1; i <= NC; i++) {
    const bas = q[NC - i + 1], son = q[NC - i];
    const NL = temel === 1 ? gunSay(bas, son, temel) : (temel === 3 ? 365 : 360) / siklik;
    const dcBas = Math.max(bas, ihrac);   // ihracın düştüğü sanal dönem kısmi başlar
    DC += gunSay(dcBas, son, temel) / NL;
    if (odeme >= son) { A += gunSay(dcBas, son, temel) / NL; continue; }
    if (E !== 0) continue;
    // ödeme gününün içinde bulunduğu sanal dönem: ondan sonraki dönemler TAM sayılır
    if (odeme > dcBas) A += gunSay(dcBas, odeme, temel) / NL;
    DSC = gunSay(odeme, son, temel);
    E = NL;
    Nq = NC - i;
  }
  if (E === 0) E = temel === 1 ? gunSay(q[1], q[0], temel) : (temel === 3 ? 365 : 360) / siklik;
  return { NC, DC, A, Nq, DSC, E };
}
/** Düzensiz ilk dönemli tahvilin fiyatı (100 nominal) */
function tekIlkFiyat(odeme, vade, ihrac, ilkKupon, oran, getiri, itfa, siklik, temel) {
  const p = quasiParca(ihrac, ilkKupon, odeme, siklik, temel);
  const N = kuponSayisi(ilkKupon, vade, siklik);
  const k = 100 * oran / siklik;
  const y = 1 + getiri / siklik;
  const us0 = p.Nq + p.DSC / p.E;
  let f = itfa / Math.pow(y, N + us0) + k * p.DC / Math.pow(y, us0);
  for (let j = 1; j <= N; j++) f += k / Math.pow(y, j + us0);
  return f - k * p.A;
}

kaydetHepsi({
  ODDFPRICE: {
    en: 8, ek: 9, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), ihrac = gunu(s[2]), ilkKupon = gunu(s[3]);
      const oran = s[4], getiri = s[5], itfa = s[6];
      const f = Math.trunc(s[7]), t = Math.trunc(sec(s[8], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (oran < 0 || getiri < 0 || itfa <= 0) return ERR.NUM;
      if (!(ihrac < o && o < ilkKupon && ilkKupon < v)) return ERR.NUM;
      return kontrol(tekIlkFiyat(o, v, ihrac, ilkKupon, oran, getiri, itfa, f, t));
    }),
  },
  ODDFYIELD: {
    en: 8, ek: 9, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), ihrac = gunu(s[2]), ilkKupon = gunu(s[3]);
      const oran = s[4], fiyat = s[5], itfa = s[6];
      const f = Math.trunc(s[7]), t = Math.trunc(sec(s[8], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (oran < 0 || fiyat <= 0 || itfa <= 0) return ERR.NUM;
      if (!(ihrac < o && o < ilkKupon && ilkKupon < v)) return ERR.NUM;
      const r = coz((y) => tekIlkFiyat(o, v, ihrac, ilkKupon, oran, y, itfa, f, t) - fiyat, 0.05);
      return r == null ? ERR.NUM : kontrol(temiz(r));
    }),
  },
  /*
   * Düzensiz SON dönemde kupon takvimi bozulduğu için iskonto BASİT faizle yapılır: kalan
   * süre bir kupon döneminden uzun bile olsa bileşiklendirilmez (ODDLPRICE / ODDLYIELD ikilisi
   * birbirinin tam tersidir, ikisi de aynı basit faiz kabulüne oturur).
   */
  ODDLPRICE: {
    en: 7, ek: 8, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), sonFaiz = gunu(s[2]);
      const oran = s[3], getiri = s[4], itfa = s[5];
      const f = Math.trunc(s[6]), t = Math.trunc(sec(s[7], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (oran < 0 || getiri < 0 || itfa <= 0 || sonFaiz >= o) return ERR.NUM;
      const DC = yilKesri(sonFaiz, v, t) * f;
      const DSC = yilKesri(o, v, t) * f;
      const A = yilKesri(sonFaiz, o, t) * f;
      const k = 100 * oran / f;
      return kontrol((itfa + DC * k) / (DSC * getiri / f + 1) - A * k);
    }),
  },
  ODDLYIELD: {
    en: 7, ek: 8, fn: sayisal((s) => {
      const o = gunu(s[0]), v = gunu(s[1]), sonFaiz = gunu(s[2]);
      const oran = s[3], fiyat = s[4], itfa = s[5];
      const f = Math.trunc(s[6]), t = Math.trunc(sec(s[7], 0));
      const h = tahvilDenet(o, v, f, t); if (h) return h;
      if (oran < 0 || fiyat <= 0 || itfa <= 0 || sonFaiz >= o) return ERR.NUM;
      const DC = yilKesri(sonFaiz, v, t) * f;
      const DSC = yilKesri(o, v, t) * f;
      const A = yilKesri(sonFaiz, o, t) * f;
      const k = 100 * oran / f;
      if (DSC === 0) return ERR.DIV0;
      return kontrol(((itfa + DC * k) / (fiyat + A * k) - 1) * f / DSC);
    }),
  },
});
