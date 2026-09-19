/*
 * EXCEL FORMÜL MOTORU — MANTIK ve BİLGİ
 *
 * KAPSAM. Koşul aileleri (IF, IFS, SWITCH, IFERROR, IFNA), mantık işleçleri (AND, OR, NOT,
 * XOR, TRUE, FALSE), ad ve işlev değeri (LET, LAMBDA) ile onların üstüne kurulu dizi
 * biçimlendiricileri (BYROW, BYCOL, MAP, REDUCE, SCAN, MAKEARRAY), IS ailesinin tamamı
 * (ISBLANK … ISOMITTED) ve hücre/ortam bilgisi (N, NA, TYPE, ERROR.TYPE, CELL, INFO,
 * SHEET, SHEETS).
 *
 * ORTAK TUZAK 1 — TEMBELLİK. Bu kategorinin varlık nedeni, HESAPLANMAYAN daldır.
 * IF(A1=0;"";1/A1) yazan kişi sıfıra bölmekten kaçınmak ister; dallar önceden hesaplanırsa
 * formül #DIV/0! verir ve IF'in anlamı kalmaz. IF, IFS, SWITCH, IFERROR, IFNA, LET ve LAMBDA
 * bu yüzden `ham: true` ile kaydedilir: argümanlar değer olarak değil AST olarak gelir,
 * gövde hangi dalı isterse onu degerlendir() ile hesaplar.
 *
 * ORTAK TUZAK 2 — BOŞ HÜCRE İLE SIFIR AYNI ŞEY DEĞİLDİR, AMA HER İŞLEVDE AYNI DAVRANMAZ.
 * IF boş dalı 0 yapar (IF(DOĞRU;;1) = 0), IFERROR ise belgelenmiş bir aykırılıkla boşu BOŞ
 * METİN sayar. ISBLANK yalnız gerçekten boş hücrede DOĞRUdur — "" içeren hücre boş değildir.
 * AND/OR/XOR aralıktaki boşu ve metni hiç saymaz; hiç mantık değeri kalmazsa #VALUE! verir.
 *
 * ORTAK TUZAK 3 — IS AİLESİ HATAYI YAYMAZ. ISERROR(1/0) sorusunun cevabı DOĞRUdur, #DIV/0!
 * değil; bu yüzden aile `hatasiz: true` ile kaydedilir ve hatayı olduğu gibi alır. ISERR
 * ile ISERROR arasındaki tek fark #N/A'dır: ISERR onu saymaz, ISERROR sayar.
 *
 * ORTAK TUZAK 4 — UYDURMA YOK. CELL ve INFO bilgiyi çalışma kitabından ve ortamdan alır.
 * ctx hangi kancayı veriyorsa (oku, formul, genislik, dosya, sayfalar, bilgi) o bilgi gerçek
 * değerle karşılanır; vermediği bilgi #VALUE! ile geri çevrilir. Makul bir varsayılan
 * döndürmek, kullanıcının doğru sandığı yanlış bir sayı üretmek demektir.
 *
 * LAMBDA NASIL TEMSİL EDİLİR. Çağrılabilir değer { lambda: true, par: [...], govde: dugum,
 * ctx } nesnesidir; tanımlandığı andaki ctx'i kapatır (kapanış), böylece LET içinde tanımlanan
 * adları gövdesinde görür. Ad çözümü ctx'i DEĞİŞTİRMEZ: adKatmani() kopya bir ctx üretip
 * yalnız `ad` kancasını zincirler — özgün ctx'e dokunmak, dış formülün adlarını bozardı.
 * Çekirdeğin ayrıştırıcısında LAMBDA(x;x+1)(5) biçiminde doğrudan çağrı sözdizimi YOKTUR;
 * lambda değeri ancak MAP / BYROW / REDUCE / SCAN / MAKEARRAY üzerinden ya da LET adıyla
 * kullanılır.
 */

import {
  ERR, hata, num, str, bool, mat, duzle, karsilastir, sutunAd, yay,
  degerlendir, kaydetHepsi,
} from './xlfn.js';

// =================================================================================
// Ortak yardımcılar
// =================================================================================

/** Değer bir başvuru nesnesi mi? (bas: [...] ile gelen argümanlar ya ref ya düz değerdir) */
const basvuruMu = (v) => !!(v && typeof v === 'object' && !Array.isArray(v) && ('r1' in v || 'alanlar' in v));
/** Değer bir LAMBDA mı? */
const lambdaMi = (v) => !!(v && typeof v === 'object' && !Array.isArray(v) && v.lambda === true);

/*
 * Argümanın kendisi ARALIK mı? Tek hücrelik bir başvuru skaler döner ve değerine bakarak
 * aralık olduğu anlaşılmaz; AND/OR/XOR'un "aralıktaki metni atla, doğrudan yazılanı çevir"
 * kuralı ise tam bu ayrıma dayanır. O yüzden ayrıştırma ağacındaki düğüme bakılır.
 */
function dugumBasvuru(d) {
  if (!d) return false;
  if (d.t === 'ref' || d.t === 'name' || d.t === 'birlesim') return true;
  if (d.t === 'par') return dugumBasvuru(d.v);
  if (d.t === 'iki') return d.op === ':' || d.op === ' ';
  return false;
}

/** Yayılımda eksik kalan öğe: tek satır/sütun yinelenir, gerçekten yoksa #N/A */
const oge = (M, i, j) => {
  const sat = M.length === 1 ? M[0] : M[i];
  if (!sat) return ERR.NA;
  const v = sat.length === 1 ? sat[0] : sat[j];
  return v === undefined ? ERR.NA : v;
};
/** Çekirdeğin yay()'ı iki değerlidir; IF üç değerle (koşul + iki dal) yayılır */
function yayCok(degerler, f) {
  if (!degerler.some(Array.isArray)) return f(degerler);
  const M = degerler.map(mat);
  let nr = 1, nc = 1;
  for (let i = 0; i < degerler.length; i++) {
    if (!Array.isArray(degerler[i])) continue;
    nr = Math.max(nr, M[i].length);
    for (const s of M[i]) nc = Math.max(nc, s.length);
  }
  const o = [];
  for (let r = 0; r < nr; r++) {
    const sat = [];
    for (let c = 0; c < nc; c++) sat.push(f(degerler.map((v, i) => (Array.isArray(v) ? oge(M[i], r, c) : v))));
    o.push(sat);
  }
  return o;
}

/** Ragged dizi sonu: satırda o sütun yoksa boş hücre sayılır */
const M_oge = (M, r, c) => { const s = M[r]; const v = s ? s[c] : undefined; return v === undefined ? null : v; };

/*
 * Tembel dal. Verilmemiş dal ile BOŞ dal ayrı şeylerdir: IF(YANLIŞ;1) hiç üçüncü argüman
 * almadığı için YANLIŞ döner (çağıran yerde ele alınır), IF(DOĞRU;;1) ise boş argümanı
 * 0 yapar. Boş HÜCREYE başvuran dal da aynı kurala tabidir: IF(DOĞRU;A1) = 0.
 */
const dal = (d, ctx) => { const v = degerlendir(d, ctx); return v == null ? 0 : v; };

// =================================================================================
// Ad katmanı ve LAMBDA çağrısı
// =================================================================================

/** LAMBDA'da karşılığı verilmemiş parametrenin işareti (ISOMITTED bunu arar) */
const ATLANDI = { atlandi: true };

/**
 * ctx'in KOPYASINI üretip ad çözümüne yerel bir katman takar. Özgün ctx değiştirilseydi
 * LET'ten çıkıldıktan sonra da adlar görünür kalır, iç içe LET'ler birbirini ezerdi.
 */
function adKatmani(ctx, tablo) {
  const ust = ctx.ad;
  return {
    ...ctx,
    ad: (isim) => {
      const k = String(isim).toUpperCase();
      if (k in tablo) return tablo[k];
      return ust ? ust(isim) : undefined;
    },
  };
}

/*
 * Parametre ve LET adı ayrıştırma ağacında 'name' düğümü olmalıdır. "x1" gibi hücre adresine
 * benzeyen bir dizge sözcükleyicide 'ref' olur — Excel de böyle bir adı reddeder, burada da
 * #VALUE! olur.
 */
const adCoz = (d) => (d && d.t === 'name' ? String(d.v).toUpperCase() : null);

// Lambda gövdeleri MAP / REDUCE içinden iç içe geçebilir; taban durumu bulamayan bir zincir
// yığını taşırmadan #NUM! ile durur (Excel de özyineleme sınırında #NUM! verir).
let derinlik = 0;
const ENCOK_DERINLIK = 256;

function lambdaCagir(f, degerler, ctx) {
  if (!lambdaMi(f)) return hata(f) ? f : ERR.VALUE;
  if (derinlik >= ENCOK_DERINLIK) return ERR.NUM;
  const tablo = Object.create(null);
  for (let i = 0; i < f.par.length; i++) tablo[f.par[i]] = degerler[i] === undefined ? ATLANDI : degerler[i];
  derinlik++;
  try { return degerlendir(f.govde, adKatmani(f.ctx || ctx, tablo)); } finally { derinlik--; }
}
/* Dizi biçimlendiricilerinin gözü tek değer görmek ister; iç içe dizi Excel'de #CALC!'tir. */
const tekDeger = (v) => (Array.isArray(v) ? ERR.CALC : v);

// =================================================================================
// Koşul aileleri
// =================================================================================

/** IFERROR / IFNA ortak gövdesi: yedek dal ANCAK gerekince hesaplanır */
function sapan(a, ctx, yakala) {
  const v = degerlendir(a[0], ctx);
  let yedek;
  const al = () => (yedek === undefined ? (yedek = bosMetin(degerlendir(a[1], ctx))) : yedek);
  if (Array.isArray(v)) return v.map(s => s.map(x => (yakala(x) ? al() : bosMetin(x))));
  return yakala(v) ? al() : bosMetin(v);
}
/*
 * IFERROR ve IFNA boş hücreyi BOŞ METİN sayar — IF'in boşu 0 yapmasından ayrılan, belgelenmiş
 * bir aykırılıktır. Bir sonraki okuyucu "IF ile tutarsız" diye düzeltmeye kalkmasın.
 */
const bosMetin = (v) => (v == null ? '' : v);

// =================================================================================
// AND / OR / XOR ortak girdisi
// =================================================================================

/**
 * Argümanları mantık listesine çevirir. Aralık ve dizide metin ile boş hücre ATLANIR
 * (Excel: "text or empty cells are ignored"), doğrudan yazılan argüman ÇEVRİLİR:
 * AND("TRUE") = DOĞRU ama A1 = "TRUE" iken AND(A1) mantık değeri bulamaz.
 */
function mantikDizisi(args, dugum) {
  const o = [];
  for (let i = 0; i < args.length; i++) {
    const v = args[i];
    if (hata(v)) return v;
    if (Array.isArray(v) || dugumBasvuru(dugum && dugum.args ? dugum.args[i] : null)) {
      for (const x of duzle([v])) {
        if (hata(x)) return x;
        if (x == null || typeof x === 'string') continue;
        o.push(typeof x === 'boolean' ? x : x !== 0);
      }
    } else {
      const b = bool(v);
      if (hata(b)) return b;
      o.push(b);
    }
  }
  return o;
}
/** Mantık toplayıcısı: hiç mantık değeri yoksa Excel #VALUE! verir */
const toplaMantik = (birlestir) => (a, c, d) => {
  const L = mantikDizisi(a, d);
  if (hata(L)) return L;
  return L.length ? birlestir(L) : ERR.VALUE;
};

// =================================================================================
// IS ailesi
// =================================================================================

/** Tek argümanlı IS işlevi: hata YAYILMAZ, dizide eleman eleman uygulanır */
const isFn = (f) => ({ en: 1, ek: 1, hatasiz: true, fn: (a) => yay(a[0], null, f) });

/*
 * ISEVEN / ISODD sayı ister. Mantık değeri Excel'de sayı SAYILMAZ: ISEVEN(DOĞRU) #VALUE!'dur,
 * 1 değil. Kesir sıfıra doğru kırpılır, işaret bakılmaz: ISEVEN(-2,5) = DOĞRU.
 */
const tekCift = (cift) => (a) => yay(a[0], null, (v) => {
  if (hata(v)) return v;
  if (typeof v === 'boolean') return ERR.VALUE;
  const x = num(v);
  if (hata(x)) return x;
  return (Math.abs(Math.trunc(x)) % 2 === 0) === cift;
});

// ERROR.TYPE eşlemesi. 1–8 klasik dizi, 9 ve 14 dinamik dizi çağındaki iki yeni hata.
const HATA_NO = {
  '#NULL!': 1, '#DIV/0!': 2, '#VALUE!': 3, '#REF!': 4, '#NAME?': 5,
  '#NUM!': 6, '#N/A': 7, '#GETTING_DATA': 8, '#SPILL!': 9, '#CALC!': 14,
};

// INFO'nun kabul ettiği tür adları; bunun dışındaki her şey #VALUE!.
const INFO_TURLERI = ['directory', 'numfile', 'origin', 'osversion', 'recalc', 'release', 'system', 'totmem', 'memavail', 'memused'];

// =================================================================================
// Kayıt
// =================================================================================

kaydetHepsi({

  // ------------------------------------------------------------------- koşul
  IF: {
    en: 2, ek: 3, ham: true,
    fn: (a, ctx) => {
      const k = degerlendir(a[0], ctx);
      if (hata(k)) return k;
      if (Array.isArray(k)) {
        // Dizi koşulda tembellik kalmaz: iki dal da hesaplanıp eleman eleman seçilir.
        const d1 = dal(a[1], ctx);
        const d2 = a.length > 2 ? dal(a[2], ctx) : false;
        return yayCok([k, d1, d2], ([x, p, q]) => { const b = bool(x); return hata(b) ? b : (b ? p : q); });
      }
      const b = bool(k);
      if (hata(b)) return b;
      if (b) return dal(a[1], ctx);
      // Üçüncü argüman hiç yazılmamışsa sonuç 0 değil YANLIŞ'tır.
      return a.length > 2 ? dal(a[2], ctx) : false;
    },
  },

  IFS: {
    en: 2, ek: 254, ham: true,
    fn: (a, ctx) => {
      for (let i = 0; i < a.length; i += 2) {
        const k = degerlendir(a[i], ctx);
        if (hata(k)) return k;
        const b = bool(Array.isArray(k) ? duzle([k])[0] : k);
        if (hata(b)) return b;
        // Eşi yazılmamış koşul DOĞRU çıkarsa Excel #N/A verir; eşleşme yoksa da #N/A.
        if (b) return i + 1 < a.length ? dal(a[i + 1], ctx) : ERR.NA;
      }
      return ERR.NA;
    },
  },

  SWITCH: {
    en: 3, ek: 254, ham: true,
    fn: (a, ctx) => {
      const ifade = degerlendir(a[0], ctx);
      if (hata(ifade)) return ifade;
      let i = 1;
      for (; i + 1 < a.length; i += 2) {
        const d = degerlendir(a[i], ctx);
        if (hata(d)) return d;
        // Eşleşme '=' işlecinin kuralıyla: metinde büyük/küçük harf ayrımı yok.
        if (karsilastir(ifade, d) === 0) return dal(a[i + 1], ctx);
      }
      return i < a.length ? dal(a[i], ctx) : ERR.NA;   // artan tek argüman varsayılandır
    },
  },

  IFERROR: { en: 2, ek: 2, ham: true, fn: (a, ctx) => sapan(a, ctx, (v) => hata(v)) },
  IFNA: { en: 2, ek: 2, ham: true, fn: (a, ctx) => sapan(a, ctx, (v) => hata(v) && v.e === ERR.NA.e) },

  // ------------------------------------------------------------------- mantık
  AND: { en: 1, ek: 255, fn: toplaMantik((L) => L.every(Boolean)) },
  OR: { en: 1, ek: 255, fn: toplaMantik((L) => L.some(Boolean)) },
  // XOR tek sayıda DOĞRU varsa DOĞRU: ikiden çok argümanda "ikisinden biri" değil, PARİTEDİR.
  XOR: { en: 1, ek: 255, fn: toplaMantik((L) => L.filter(Boolean).length % 2 === 1) },
  NOT: { en: 1, ek: 1, fn: (a) => yay(a[0], null, (v) => { const b = bool(v); return hata(b) ? b : !b; }) },
  TRUE: { en: 0, ek: 0, fn: () => true },
  FALSE: { en: 0, ek: 0, fn: () => false },

  // ------------------------------------------------------------------- ad ve işlev değeri
  LET: {
    en: 3, ek: 253, ham: true,
    fn: (a, ctx) => {
      // ad/değer çiftleri + bir hesap → argüman sayısı her zaman TEK olmalı
      if (a.length % 2 === 0) return ERR.VALUE;
      const tablo = Object.create(null);
      const ic = adKatmani(ctx, tablo);
      for (let i = 0; i + 1 < a.length; i += 2) {
        const ad = adCoz(a[i]);
        if (!ad) return ERR.VALUE;
        // Değer, kendinden ÖNCE tanımlanan adları görür (tablo sırayla dolar).
        tablo[ad] = degerlendir(a[i + 1], ic);
      }
      return degerlendir(a[a.length - 1], ic);
    },
  },

  LAMBDA: {
    en: 1, ek: 254, ham: true,
    fn: (a, ctx) => {
      const par = [];
      for (let i = 0; i + 1 < a.length; i++) {
        const ad = adCoz(a[i]);
        if (!ad) return ERR.VALUE;
        par.push(ad);
      }
      // Tanım anındaki ctx kapatılır: gövde, LET'in o noktadaki adlarını görür.
      return { lambda: true, par, govde: a[a.length - 1], ctx };
    },
  },

  BYROW: {
    en: 2, ek: 2, ham: true,
    fn: (a, ctx) => {
      const v = degerlendir(a[0], ctx); if (hata(v)) return v;
      const f = degerlendir(a[1], ctx); if (hata(f)) return f;
      if (!lambdaMi(f)) return ERR.VALUE;
      const M = mat(v);
      const nc = Math.max(...M.map(s => s.length));
      const o = [];
      for (let r = 0; r < M.length; r++) {
        const dilim = [[]];
        for (let c = 0; c < nc; c++) dilim[0].push(M_oge(M, r, c));
        o.push([tekDeger(lambdaCagir(f, [dilim], ctx))]);   // sonuç SÜTUN vektörüdür
      }
      return o;
    },
  },

  BYCOL: {
    en: 2, ek: 2, ham: true,
    fn: (a, ctx) => {
      const v = degerlendir(a[0], ctx); if (hata(v)) return v;
      const f = degerlendir(a[1], ctx); if (hata(f)) return f;
      if (!lambdaMi(f)) return ERR.VALUE;
      const M = mat(v);
      const nc = Math.max(...M.map(s => s.length));
      const sat = [];
      for (let c = 0; c < nc; c++) {
        const dilim = [];
        for (let r = 0; r < M.length; r++) dilim.push([M_oge(M, r, c)]);
        sat.push(tekDeger(lambdaCagir(f, [dilim], ctx)));
      }
      return [sat];   // sonuç SATIR vektörüdür
    },
  },

  MAP: {
    en: 2, ek: 255, ham: true,
    fn: (a, ctx) => {
      const f = degerlendir(a[a.length - 1], ctx); if (hata(f)) return f;
      if (!lambdaMi(f)) return ERR.VALUE;
      const diziler = [];
      for (let i = 0; i < a.length - 1; i++) {
        const v = degerlendir(a[i], ctx); if (hata(v)) return v;
        diziler.push(mat(v));
      }
      const nr = diziler[0].length;
      const nc = Math.max(...diziler[0].map(s => s.length));
      // Eşlenecek diziler aynı boyutta olmalı; Excel farklı boyutta #VALUE! verir.
      for (const M of diziler) if (M.length !== nr || Math.max(...M.map(s => s.length)) !== nc) return ERR.VALUE;
      const o = [];
      for (let r = 0; r < nr; r++) {
        const sat = [];
        for (let c = 0; c < nc; c++) sat.push(tekDeger(lambdaCagir(f, diziler.map(M => M_oge(M, r, c)), ctx)));
        o.push(sat);
      }
      return o;
    },
  },

  REDUCE: { en: 3, ek: 3, ham: true, fn: (a, ctx) => katla(a, ctx, false) },
  SCAN: { en: 3, ek: 3, ham: true, fn: (a, ctx) => katla(a, ctx, true) },

  MAKEARRAY: {
    en: 3, ek: 3, ham: true,
    fn: (a, ctx) => {
      const nr = num(degerlendir(a[0], ctx)); if (hata(nr)) return nr;
      const nc = num(degerlendir(a[1], ctx)); if (hata(nc)) return nc;
      const f = degerlendir(a[2], ctx); if (hata(f)) return f;
      if (!lambdaMi(f)) return ERR.VALUE;
      const R = Math.trunc(nr), C = Math.trunc(nc);
      if (R < 1 || C < 1) return ERR.VALUE;
      if (R * C > 1048576) return ERR.NUM;   // çalışma sayfası sığasını aşan dizi
      const o = [];
      for (let r = 1; r <= R; r++) {
        const sat = [];
        // Lambda'ya verilen satır/sütun 1 TABANLIDIR (dizi dizinleri değil, Excel numarası).
        for (let c = 1; c <= C; c++) sat.push(tekDeger(lambdaCagir(f, [r, c], ctx)));
        o.push(sat);
      }
      return o;
    },
  },

  // ------------------------------------------------------------------- IS ailesi
  ISBLANK: isFn((v) => v == null),
  // ISERR ile ISERROR arasındaki TEK fark #N/A'dır.
  ISERR: isFn((v) => hata(v) && v.e !== ERR.NA.e),
  ISERROR: isFn((v) => hata(v)),
  ISNA: isFn((v) => hata(v) && v.e === ERR.NA.e),
  ISLOGICAL: isFn((v) => typeof v === 'boolean'),
  ISNUMBER: isFn((v) => typeof v === 'number'),
  ISTEXT: isFn((v) => typeof v === 'string'),
  // ISNONTEXT metin OLMAYAN her şeye DOĞRU der: boş hücre, sayı, mantık ve hata dahil.
  ISNONTEXT: isFn((v) => typeof v !== 'string'),

  ISREF: {
    en: 1, ek: 1, bas: [0], hatasiz: true,
    // #REF! de bir başvurudur (bozulmuş olanı): ISREF(#REF!) Excel'de DOĞRU verir.
    fn: (a) => basvuruMu(a[0]) || (hata(a[0]) && a[0].e === ERR.REF.e),
  },

  ISEVEN: { en: 1, ek: 1, fn: tekCift(true) },
  ISODD: { en: 1, ek: 1, fn: tekCift(false) },

  ISFORMULA: {
    en: 1, ek: 1, bas: [0],
    fn: (a, ctx) => {
      const r = a[0];
      if (hata(r)) return r;
      if (!basvuruMu(r) || r.alanlar) return ERR.VALUE;
      if (r.yok) return ERR.REF;
      // Formül kaynağı olmayan bir bağlamda cevap uydurulmaz; YANLIŞ demek de bir iddiadır.
      if (!ctx.formul) return ERR.VALUE;
      const bir = (rr, cc) => !!ctx.formul(r.sayfa, rr, cc);
      if (r.r1 === r.r2 && r.c1 === r.c2) return bir(r.r1, r.c1);
      const o = [];
      for (let rr = r.r1; rr <= r.r2; rr++) {
        const sat = [];
        for (let cc = r.c1; cc <= r.c2; cc++) sat.push(bir(rr, cc));
        o.push(sat);
      }
      return o;
    },
  },

  ISOMITTED: {
    en: 1, ek: 1, ham: true, hatasiz: true,
    fn: (a, ctx) => {
      const d = a[0];
      if (!d || d.t === 'bos') return true;
      // Karşılığı verilmemiş LAMBDA parametresi ad çözümünde ATLANDI işaretine bağlanır.
      if (d.t === 'name' && ctx.ad) return ctx.ad(d.v) === ATLANDI;
      return false;
    },
  },

  // ------------------------------------------------------------------- bilgi
  N: {
    en: 1, ek: 1, hatasiz: true,
    // Sayı aynen, DOĞRU 1, YANLIŞ 0, metin ve boş 0, hata HATA olarak geri döner.
    fn: (a) => yay(a[0], null, (v) => (hata(v) ? v : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0)),
  },
  NA: { en: 0, ek: 0, fn: () => ERR.NA },

  TYPE: {
    en: 1, ek: 1, hatasiz: true,
    fn: (a) => {
      const v = a[0];
      if (Array.isArray(v)) return 64;
      if (hata(v)) return 16;
      if (typeof v === 'boolean') return 4;
      if (typeof v === 'string') return 2;
      return 1;   // sayı — ve BOŞ hücre de 1 sayılır
    },
  },

  'ERROR.TYPE': {
    en: 1, ek: 1, hatasiz: true,
    fn: (a) => {
      const v = Array.isArray(a[0]) ? duzle([a[0]])[0] : a[0];
      if (!hata(v)) return ERR.NA;   // hata olmayan değer için cevap yoktur
      const n = HATA_NO[v.e];
      return n == null ? ERR.NA : n;
    },
  },

  CELL: {
    en: 1, ek: 2, bas: [1],
    fn: (a, ctx) => {
      const t = str(a[0]);
      if (hata(t)) return t;
      let r = a[1];
      if (a.length < 2) {
        if (!ctx.hucre) return ERR.VALUE;
        r = { sayfa: ctx.sayfa || null, r1: ctx.hucre.r, c1: ctx.hucre.c, r2: ctx.hucre.r, c2: ctx.hucre.c };
      }
      if (hata(r)) return r;
      if (!basvuruMu(r) || r.alanlar) return ERR.VALUE;
      if (r.yok) return ERR.REF;
      const sr = r.r1, sc = r.c1;   // çok hücreli aralıkta SOL ÜST hücre okunur
      const oku = () => (ctx.oku ? ctx.oku(r.sayfa, sr, sc) : null);
      switch (t.toLowerCase()) {
        case 'address': return '$' + sutunAd(sc) + '$' + (sr + 1);
        case 'col': return sc + 1;
        case 'row': return sr + 1;
        case 'contents': { const v = oku(); return v == null ? 0 : v; }
        // b = boş, l = etiket (metin), v = değer. Hata içeren hücre de "v"dir.
        case 'type': { const v = oku(); return v == null ? 'b' : typeof v === 'string' ? 'l' : 'v'; }
        case 'width': {
          if (!ctx.genislik) return ERR.VALUE;
          const w = ctx.genislik(r.sayfa, sc);
          return typeof w === 'number' ? Math.round(w) : ERR.VALUE;
        }
        case 'filename': { const f = ctx.dosya ? ctx.dosya() : null; return typeof f === 'string' ? f : ERR.VALUE; }
        /*
         * format / prefix / protect / color / parentheses biçim ve koruma bilgisidir; motorun
         * değer katmanında karşılığı yoktur. Uydurmak yerine Excel'in bilinmeyen tür cevabı
         * olan #VALUE! verilir.
         */
        default: return ERR.VALUE;
      }
    },
  },

  INFO: {
    en: 1, ek: 1,
    fn: (a, ctx) => {
      const t = str(a[0]);
      if (hata(t)) return t;
      const k = t.toLowerCase();
      if (!INFO_TURLERI.includes(k)) return ERR.VALUE;
      if (ctx.bilgi) { const v = ctx.bilgi(k); if (v !== undefined && v !== null) return v; }
      return ERR.VALUE;   // ortam bilgisi verilmemişse uydurulmaz
    },
  },

  SHEET: {
    en: 0, ek: 1, bas: [0],
    fn: (a, ctx) => {
      const L = ctx.sayfalar ? ctx.sayfalar() : null;
      if (!Array.isArray(L) || !L.length) return ERR.VALUE;   // sayfa sırası bilinmeden numara verilemez
      const no = (ad) => {
        const i = L.findIndex(s => String(s).toUpperCase() === String(ad).toUpperCase());
        return i < 0 ? ERR.NA : i + 1;
      };
      // Sayfası belirtilmemiş başvuru ile argümansız çağrı geçerli sayfayı gösterir.
      const gecerli = ctx.sayfa == null ? L[0] : ctx.sayfa;
      if (a.length < 1) return no(gecerli);
      const v = a[0];
      if (hata(v)) return v;
      if (basvuruMu(v)) return no(v.sayfa == null ? gecerli : v.sayfa);
      if (Array.isArray(v)) return ERR.NA;
      return no(str(v));
    },
  },

  SHEETS: {
    en: 0, ek: 1, bas: [0],
    fn: (a, ctx) => {
      if (a.length >= 1) {
        const v = a[0];
        if (hata(v)) return v;
        if (!basvuruMu(v)) return ERR.VALUE;
        return 1;   // motorun başvuruları 3 boyutlu değildir: bir başvuru tek sayfadadır
      }
      const L = ctx.sayfalar ? ctx.sayfalar() : null;
      return Array.isArray(L) && L.length ? L.length : ERR.VALUE;
    },
  },

});

/** REDUCE ve SCAN ortak gövdesi: fark yalnız ara değerlerin saklanıp saklanmadığıdır */
function katla(a, ctx, izBirak) {
  let acc = degerlendir(a[0], ctx); if (hata(acc)) return acc;
  const v = degerlendir(a[1], ctx); if (hata(v)) return v;
  const f = degerlendir(a[2], ctx); if (hata(f)) return f;
  if (!lambdaMi(f)) return ERR.VALUE;
  const M = mat(v);
  const nc = Math.max(...M.map(s => s.length));
  const o = [];
  for (let r = 0; r < M.length; r++) {
    const sat = [];
    for (let c = 0; c < nc; c++) {
      acc = tekDeger(lambdaCagir(f, [acc, M_oge(M, r, c)], ctx));
      sat.push(acc);
    }
    o.push(sat);
  }
  return izBirak ? o : acc;
}
