/*
 * EXCEL FORMÜL MOTORU — TARİH ve SAAT.
 *
 * Excel'in Tarih/Saat kategorisinin tamamı (25 işlev) ile LibreOffice Calc'ın aynı
 * kategoriye giren beş işlevi. Tarih ayrı bir tür DEĞİLDİR: her şey çekirdeğin seri
 * sayısıdır (1899-12-30 = 0), saat o sayının ondalık kesridir.
 *
 * ORTAK TUZAK — 1900 ARTIK YIL HATASI. Lotus 1-2-3 ile uyum için Excel 1900'ü artık yıl
 * sayar: seri 60, gerçekte var olmayan 1900-02-29'dur. Seri 0'ın da adı vardır: "1900-01-00"
 * (YEAR(0)=1900, MONTH(0)=1, DAY(0)=0). Çekirdeğin seriTarih'i bu iki günü gerçek takvime
 * göre çözer, tarihSeri'nin eşiği ise bir gün kayar (1900-02-28'e 59 yerine 60 verir).
 * Çekirdek başka kategorilerle ORTAK zemin olduğundan dokunulmaz; iki anomali burada,
 * parcala() ve ayBasi() içinde kapatılır. Modülün bütün işlevleri yalnız bu ikisini
 * kullanır, böylece DATE ile DAY birbirini tutar.
 *
 * İKİNCİ TUZAK — HAFTA GÜNÜ. Hafta günü seri sayıdan aritmetikle bulunur (seri 1 = Pazar),
 * takvimden değil. 1900-01-01 gerçekte Pazartesiydi ama Excel'in takviminde Pazardır;
 * Date nesnesinin gününe bakılsaydı 1900 Ocak-Şubat'ında bütün hafta günleri kayardı.
 *
 * ÜÇÜNCÜ TUZAK — MANTIK DEĞERİ TARİH DEĞİLDİR. DAY(TRUE) Excel'de #VALUE! verir, 1900-01-01
 * değil. Sayı gibi görünen METİN ise çevrilir: DAY("45000") çalışır.
 */
import {
  ERR, hata, ilkHata, num, str, bool, duzle, metinSayi,
  seriParca, seriSaat, tarihSeri, kaydetHepsi,
} from './xlfn.js';

// En büyük geçerli seri: 9999-12-31. Excel bunun dışını #NUM! sayar.
const ENBUYUK = 2958465;
const sinirla = (n) => (hata(n) ? n : n < 0 || n > ENBUYUK ? ERR.NUM : n);

// ---------------------------------------------------------------------------------
// Takvim — çekirdeğin üstüne 1900 yamaları
// ---------------------------------------------------------------------------------
/** (yıl, ay) ayının 1'inin seri sayısı. Ayın 1'i hiçbir zaman 1900-02-28 olmadığı için
 *  çekirdeğin kayan eşiği burada devreye girmez; bütün gün sayımı seri uzayında yapılır. */
function ayBasi(yil, ay) {
  /*
   * tarihSeri 0–1899 arası yılı 1900'e EKLER (DATE'in kendi kuralı), bu yüzden 1900
   * öncesine düşen bir ay için doğrudan çağrılamaz. Gregoryen takvim 400 yılda bir
   * yinelendiğinden (146097 gün) o yıllar ileri kaydırılıp fark geri alınır; 1900-03-01
   * öncesi Excel serisi gerçek gün sayısının bir eksiği olduğundan ayrıca 1 düşülür.
   */
  let y = yil, d = 0;
  while (y < 1900) { y += 400; d += 146097; }
  const k = tarihSeri(y, ay, 1);
  if (hata(k)) return k;
  return d ? k - d - 1 : k;
}
/** (yıl, ay, gün) → seri. Ay taşması yıla çevrilir, gün seri uzayında eklenir; böylece
 *  Excel'in sahte 1900-02-29'u kendiliğinden hesaba katılır. Yıl GERÇEK yıldır —
 *  DATE'in "0–1899 ise 1900 ekle" kuralı çağırana aittir. */
function seriYap(yil, ay, gun) {
  const t = yil * 12 + (ay - 1);
  const yy = Math.floor(t / 12), aa = t - yy * 12 + 1;
  const b = ayBasi(yy, aa);
  return hata(b) ? b : b + (gun - 1);
}
/** Seri → { y, ay, gun }. Excel'in iki 1900 tuhaflığı burada kapanır. */
function parcala(s) {
  const g = Math.floor(s);
  if (g === 0) return { y: 1900, ay: 1, gun: 0 };    // "1900-01-00"
  if (g === 60) return { y: 1900, ay: 2, gun: 29 };  // var olmayan gün
  const p = seriParca(g);
  return { y: p.y, ay: p.ay, gun: p.gun };
}
/** Bir ayın gün sayısı. 1900 Şubat'ı Excel takviminde 29 çeker; fark buradan da tutarlı gelir. */
function ayGunSayisi(y, ay) {
  const a = seriYap(y, ay, 1), b = seriYap(y, ay + 1, 1);
  return hata(a) ? a : hata(b) ? b : b - a;
}
const artikMi = (y) => ayGunSayisi(y, 2) === 29;
/** Hafta günü, 0 = Pazar … 6 = Cumartesi. Seri 1 Pazardır (Excel'in kabulü). */
function gunIndeksi(s) {
  const k = ((Math.floor(s) % 7) + 7) % 7;
  return (k + 6) % 7;
}
/** Hafta günü, 0 = Pazartesi … 6 = Pazar (.INTL maskeleri bu sırayı kullanır). */
const pztIndeks = (s) => (gunIndeksi(s) + 6) % 7;

// ---------------------------------------------------------------------------------
// Metin → seri çözümlemesi
// ---------------------------------------------------------------------------------
const SAAT_RE = /(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:[.,]\d+)?))?\s*(am|pm)?/i;
/** İki haneli yıl: 0–29 → 2000'ler, 30–99 → 1900'ler (Excel'in eşiği). */
const yilTamamla = (y) => (y >= 100 ? y : y <= 29 ? 2000 + y : 1900 + y);
function gunKur(y, ay, gun) {
  if (ay < 1 || ay > 12) return null;
  const son = ayGunSayisi(y, ay);
  if (hata(son) || gun < 1 || gun > son) return null;
  const n = seriYap(y, ay, gun);
  return hata(n) || n < 0 || n > ENBUYUK ? null : n;
}
function tarihCoz(t) {
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return gunKur(+m[1], +m[2], +m[3]);
  // Nokta ayracı her yerde gün.ay.yıl demektir; karışıklık yok.
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(t);
  if (m) return gunKur(yilTamamla(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(t);
  if (m) {
    // Eğik çizgi ABD sırasıdır (ay/gün/yıl); ilk alan 12'yi aşıyorsa gün olarak okunur,
    // yoksa 19/09/2026 gibi yaygın bir yazım hepten reddedilirdi.
    let ay = +m[1], gun = +m[2];
    if (ay > 12 && gun <= 12) { const x = ay; ay = gun; gun = x; }
    return gunKur(yilTamamla(+m[3]), ay, gun);
  }
  return null;
}
/** Metni seri sayıya çözer. Dönüş: null (tanınmadı) ya da { s, tarihVar, saatVar }. */
function metinCoz(ham) {
  let t = String(ham).trim();
  if (t === '') return null;
  let kesir = 0, saatVar = false;
  const m = SAAT_RE.exec(t);
  if (m) {
    let sa = +m[1];
    const dk = +m[2], sn = m[3] ? parseFloat(String(m[3]).replace(',', '.')) : 0;
    const ip = m[4] ? m[4].toLowerCase() : '';
    if (ip) {
      if (sa < 1 || sa > 12) return null;
      if (ip === 'pm' && sa !== 12) sa += 12;
      if (ip === 'am' && sa === 12) sa = 0;
    }
    if (dk > 59 || sn >= 60) return null;
    const top = (sa * 3600 + dk * 60 + sn) / 86400;
    kesir = top - Math.floor(top);   // 25:00 gibi taşan saat güne sarar
    saatVar = true;
    t = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).trim().replace(/[tT]$/, '').trim();
  }
  if (t === '') return saatVar ? { s: kesir, tarihVar: false, saatVar: true } : null;
  const g = tarihCoz(t);
  if (g == null) return null;
  return { s: g + kesir, tarihVar: true, saatVar };
}
/** Tarih argümanını seri sayıya çevirir. Boş hücre = 0, mantık = #VALUE!, eksi = #NUM!. */
function tarih(v) {
  if (hata(v)) return v;
  if (Array.isArray(v)) { const f = duzle([v]); return tarih(f.length ? f[0] : null); }
  if (v == null) return 0;
  if (typeof v === 'number') return !isFinite(v) ? ERR.NUM : v < 0 ? ERR.NUM : v;
  if (typeof v === 'boolean') return ERR.VALUE;
  const n = metinSayi(v);
  if (!isNaN(n)) return n < 0 ? ERR.NUM : n;
  const d = metinCoz(String(v));
  return d == null ? ERR.VALUE : d.s;
}

// ---------------------------------------------------------------------------------
// 360 günlük yıl — DAYS360 ve YEARFRAC'ın 0 / 4 temelleri
// ---------------------------------------------------------------------------------
function gun360(bas, bit, avrupa) {
  const p = parcala(bas), q = parcala(bit);
  let g1 = p.gun, g2 = q.gun, a2 = q.ay;
  if (avrupa) {
    // Avrupa yöntemi yalnız 31'i 30 yapar; ayın son günü kavramı yoktur.
    if (g1 === 31) g1 = 30;
    if (g2 === 31) g2 = 30;
  } else {
    /*
     * ABD (NASD) yönteminde ölçüt 31 değil AYIN SON GÜNÜDÜR — şubat dahil. Bitiş de ayın
     * son günüyse ve başlangıç 30'dan küçükse bitiş 30'a indirilmez, sonraki ayın 1'ine
     * TAŞINIR; iki durum 30 günlük ay kabulünde bir gün farkeder.
     */
    const s1 = ayGunSayisi(p.y, p.ay), s2 = ayGunSayisi(q.y, q.ay);
    if (hata(s1)) return s1;
    if (hata(s2)) return s2;
    if (g1 === s1) g1 = 30;
    if (g2 === s2) { if (g1 < 30) { g2 = 1; a2 += 1; } else g2 = 30; }
  }
  return 360 * (q.y - p.y) + 30 * (a2 - p.ay) + (g2 - g1);
}

// ---------------------------------------------------------------------------------
// İş günü — hafta sonu maskesi ve tatil kümesi
// ---------------------------------------------------------------------------------
/** Hafta sonu argümanı → 7 elemanlı maske, 0 = Pazartesi … 6 = Pazar. */
function haftaSonu(v) {
  const m = [false, false, false, false, false, false, false];
  if (typeof v === 'string') {
    // Yedi karakterlik 0/1 maskesi Pazartesiyle başlar. Uzunluk ya da karakter yanlışsa
    // Excel #VALUE! verir — sayı argümanının #NUM!'undan farklıdır.
    if (!/^[01]{7}$/.test(v)) return ERR.VALUE;
    for (let i = 0; i < 7; i++) if (v[i] === '1') m[i] = true;
    return m;
  }
  const n = num(v);
  if (hata(n)) return n;
  const k = Math.trunc(n);
  if (k >= 1 && k <= 7) { m[(k + 4) % 7] = true; m[(k + 5) % 7] = true; return m; }
  if (k >= 11 && k <= 17) { m[(k - 12 + 7) % 7] = true; return m; }
  return ERR.NUM;
}
/** Tatil argümanı → seri sayı kümesi. Boş hücreler atlanır, mantık değeri #VALUE! verir. */
function tatiller(v) {
  const k = new Set();
  if (v == null) return k;
  for (const x of duzle([v])) {
    if (x == null) continue;
    if (hata(x)) return x;
    const n = tarih(x);
    if (hata(n)) return n;
    k.add(Math.floor(n));
  }
  return k;
}
function isGunSay(bas, bit, maske, tat) {
  let a = Math.floor(bas), z = Math.floor(bit), isaret = 1;
  if (a > z) { const t = a; a = z; z = t; isaret = -1; }   // ters sıra eksi sayı verir
  const hs = maske.reduce((s, x) => s + (x ? 1 : 0), 0);
  if (hs === 7) return 0;
  const toplam = z - a + 1;
  let n = Math.floor(toplam / 7) * (7 - hs);
  for (let d = z - (toplam % 7) + 1; d <= z; d++) if (!maske[pztIndeks(d)]) n++;
  for (const t of tat) if (t >= a && t <= z && !maske[pztIndeks(t)]) n--;
  return isaret * n;
}
function isGunEkle(bas, gun, maske, tat) {
  // Her günü hafta sonu ilan edilmiş bir takvimde ilerlenecek gün kalmaz; Excel #VALUE! verir.
  if (maske.every(Boolean)) return ERR.VALUE;
  let s = Math.floor(bas), n = Math.trunc(gun);
  const adim = n < 0 ? -1 : 1;
  n = Math.abs(n);
  while (n > 0) {
    s += adim;
    if (s < 0 || s > ENBUYUK) return ERR.NUM;
    if (maske[pztIndeks(s)] || tat.has(s)) continue;
    n--;
  }
  return s;
}

// ---------------------------------------------------------------------------------
// ISO hafta
// ---------------------------------------------------------------------------------
function isoHafta(s) {
  const g = Math.floor(s);
  const pzt = ((gunIndeksi(g) + 6) % 7) + 1;   // Pazartesi = 1 … Pazar = 7
  const per = g + (4 - pzt);                   // ISO haftası KENDİ PERŞEMBESİNİN yılına aittir
  const ocak = seriYap(parcala(per).y, 1, 1);
  return hata(ocak) ? ocak : Math.floor((per - ocak) / 7) + 1;
}

// ---------------------------------------------------------------------------------
// İşlev kaydı
// ---------------------------------------------------------------------------------
const HAFTA_BAS = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 };

kaydetHepsi({
  DATE: {
    en: 3, ek: 3,
    fn: (a) => {
      const y = num(a[0]), ay = num(a[1]), g = num(a[2]);
      const h = ilkHata(y, ay, g);
      if (h) return h;
      let yl = Math.trunc(y);
      if (yl < 0 || yl > 9999) return ERR.NUM;
      // 0–1899 arası yıl 1900'e EKLENİR: DATE(26;1;1) 1926'dır, 2026 değil.
      if (yl < 1900) yl += 1900;
      return sinirla(seriYap(yl, Math.trunc(ay), Math.trunc(g)));
    },
  },
  TIME: {
    en: 3, ek: 3,
    fn: (a) => {
      const sa = num(a[0]), dk = num(a[1]), sn = num(a[2]);
      const h = ilkHata(sa, dk, sn);
      if (h) return h;
      const s = Math.trunc(sa), d = Math.trunc(dk), n = Math.trunc(sn);
      if (s < 0 || d < 0 || n < 0 || s > 32767 || d > 32767 || n > 32767) return ERR.NUM;
      // Toplam 24 saati aşarsa gün atlanmaz, sarılır: TIME(27;0;0) = 0,125 (03:00).
      return ((s * 3600 + d * 60 + n) % 86400) / 86400;
    },
  },
  /*
   * Saat motorun DIŞINDAN gelir (ctx.simdi). Bağlam saat vermiyorsa Date.now()'a düşülmez:
   * o zaman aynı dosya her açılışta başka değer verir, sınama yinelenemez ve hücrenin
   * kayıtlı değeriyle hesaplanan değer sessizce ayrışır. Saat yoksa #VALUE! dürüst cevaptır.
   */
  TODAY: { en: 0, ek: 0, fn: (a, ctx) => (ctx && ctx.simdi ? Math.floor(ctx.simdi()) : ERR.VALUE) },
  NOW: { en: 0, ek: 0, fn: (a, ctx) => (ctx && ctx.simdi ? ctx.simdi() : ERR.VALUE) },

  DAY: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); return hata(s) ? s : parcala(s).gun; } },
  MONTH: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); return hata(s) ? s : parcala(s).ay; } },
  YEAR: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); return hata(s) ? s : parcala(s).y; } },
  HOUR: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); return hata(s) ? s : seriSaat(s).sa; } },
  MINUTE: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); return hata(s) ? s : seriSaat(s).dk; } },
  SECOND: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); return hata(s) ? s : seriSaat(s).sn; } },

  WEEKDAY: {
    en: 1, ek: 2,
    fn: (a) => {
      const s = tarih(a[0]);
      if (hata(s)) return s;
      const t = a.length < 2 ? 1 : num(a[1]);
      if (hata(t)) return t;
      const tt = Math.trunc(t), g = gunIndeksi(s);
      if (tt === 1) return g + 1;
      if (tt === 2) return ((g + 6) % 7) + 1;
      if (tt === 3) return (g + 6) % 7;   // 3 numaralı dizge 0 TABANLIDIR: Pazartesi = 0
      if (tt >= 11 && tt <= 17) { const b = (tt - 10) % 7; return ((g - b + 7) % 7) + 1; }
      return ERR.NUM;
    },
  },
  WEEKNUM: {
    en: 1, ek: 2,
    fn: (a) => {
      const s = tarih(a[0]);
      if (hata(s)) return s;
      const t = a.length < 2 ? 1 : num(a[1]);
      if (hata(t)) return t;
      const tt = Math.trunc(t);
      if (tt === 21) return isoHafta(s);   // 21 ISO'dur, ISOWEEKNUM ile aynı sayıyı verir
      const bas = HAFTA_BAS[tt];
      if (bas == null) return ERR.NUM;
      const g = Math.floor(s);
      const ocak = seriYap(parcala(g).y, 1, 1);
      if (hata(ocak)) return ocak;
      // 1. hafta, 1 Ocak'ı içeren haftadır; kaç gün önce başladığı hafta başına bağlıdır.
      const kayma = (gunIndeksi(ocak) - bas + 7) % 7;
      return Math.floor((g - ocak + kayma) / 7) + 1;
    },
  },
  ISOWEEKNUM: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); return hata(s) ? s : isoHafta(s); } },

  EDATE: {
    en: 2, ek: 2,
    fn: (a) => {
      const s = tarih(a[0]);
      if (hata(s)) return s;
      const m = num(a[1]);
      if (hata(m)) return m;
      return ayKaydir(s, Math.trunc(m), false);
    },
  },
  EOMONTH: {
    en: 2, ek: 2,
    fn: (a) => {
      const s = tarih(a[0]);
      if (hata(s)) return s;
      const m = num(a[1]);
      if (hata(m)) return m;
      return ayKaydir(s, Math.trunc(m), true);
    },
  },
  DAYS: {
    en: 2, ek: 2,
    fn: (a) => {
      const b = tarih(a[0]), s = tarih(a[1]);   // DAYS(bitiş; başlangıç) — sıra terstir
      const h = ilkHata(b, s);
      return h || Math.trunc(b) - Math.trunc(s);
    },
  },
  DAYS360: {
    en: 2, ek: 3,
    fn: (a) => {
      const b = tarih(a[0]), s = tarih(a[1]);
      const h = ilkHata(b, s);
      if (h) return h;
      const y = a.length < 3 ? false : bool(a[2]);
      if (hata(y)) return y;
      return gun360(Math.floor(b), Math.floor(s), y);
    },
  },
});

/** EDATE / EOMONTH ortak gövdesi: ay kaydır, günü ayın boyuna sığdır. */
function ayKaydir(s, ay, sonGun) {
  const p = parcala(Math.floor(s));
  const t = p.y * 12 + (p.ay - 1) + ay;
  const y = Math.floor(t / 12), aa = t - y * 12 + 1;
  if (y < 1900) return ERR.NUM;
  const son = ayGunSayisi(y, aa);
  if (hata(son)) return son;
  // Ayın 31'inden bir ay sonrası 30 ya da 28'dir; Excel taşırmaz, kırpar.
  return sinirla(seriYap(y, aa, sonGun ? son : Math.min(p.gun, son)));
}

kaydetHepsi({
  WORKDAY: {
    en: 2, ek: 3,
    fn: (a) => {
      const s = tarih(a[0]);
      if (hata(s)) return s;
      const g = num(a[1]);
      if (hata(g)) return g;
      const t = tatiller(a.length < 3 ? null : a[2]);
      if (hata(t)) return t;
      return sinirla(isGunEkle(s, g, haftaSonu(1), t));
    },
  },
  'WORKDAY.INTL': {
    en: 2, ek: 4,
    fn: (a) => {
      const s = tarih(a[0]);
      if (hata(s)) return s;
      const g = num(a[1]);
      if (hata(g)) return g;
      const m = haftaSonu(a.length < 3 ? 1 : a[2]);
      if (hata(m)) return m;
      const t = tatiller(a.length < 4 ? null : a[3]);
      if (hata(t)) return t;
      return sinirla(isGunEkle(s, g, m, t));
    },
  },
  NETWORKDAYS: {
    en: 2, ek: 3,
    fn: (a) => {
      const b = tarih(a[0]), s = tarih(a[1]);
      const h = ilkHata(b, s);
      if (h) return h;
      const t = tatiller(a.length < 3 ? null : a[2]);
      if (hata(t)) return t;
      return isGunSay(b, s, haftaSonu(1), t);
    },
  },
  'NETWORKDAYS.INTL': {
    en: 2, ek: 4,
    fn: (a) => {
      const b = tarih(a[0]), s = tarih(a[1]);
      const h = ilkHata(b, s);
      if (h) return h;
      const m = haftaSonu(a.length < 3 ? 1 : a[2]);
      if (hata(m)) return m;
      const t = tatiller(a.length < 4 ? null : a[3]);
      if (hata(t)) return t;
      // Yedi günün de hafta sonu olduğu maske burada hata değil, sıfırdır.
      return isGunSay(b, s, m, t);
    },
  },
  YEARFRAC: {
    en: 2, ek: 3,
    fn: (a) => {
      const b = tarih(a[0]), s = tarih(a[1]);
      const h = ilkHata(b, s);
      if (h) return h;
      const t = a.length < 3 ? 0 : num(a[2]);
      if (hata(t)) return t;
      const tt = Math.trunc(t);
      if (tt < 0 || tt > 4) return ERR.NUM;
      let x = Math.floor(b), z = Math.floor(s);
      if (x > z) { const q = x; x = z; z = q; }   // YEARFRAC sırayı umursamaz, sonuç hep artı
      if (tt === 0) return gun360(x, z, false) / 360;
      if (tt === 4) return gun360(x, z, true) / 360;
      if (tt === 2) return (z - x) / 360;
      if (tt === 3) return (z - x) / 365;
      return gercekGercek(x, z);
    },
  },
  DATEVALUE: {
    en: 1, ek: 1,
    fn: (a) => {
      // DATEVALUE yalnız METİN alır: sayı ya da mantık verilirse Excel #VALUE! der.
      if (typeof a[0] !== 'string') return ERR.VALUE;
      const m = metinCoz(a[0]);
      return m == null || !m.tarihVar ? ERR.VALUE : Math.floor(m.s);
    },
  },
  TIMEVALUE: {
    en: 1, ek: 1,
    fn: (a) => {
      if (typeof a[0] !== 'string') return ERR.VALUE;
      const m = metinCoz(a[0]);
      // Saatsiz bir tarih metni 0 verir; tanınmayan metin #VALUE!.
      return m == null ? ERR.VALUE : m.s - Math.floor(m.s);
    },
  },
  DATEDIF: {
    en: 3, ek: 3,
    fn: (a) => {
      const b = tarih(a[0]), s = tarih(a[1]);
      const h = ilkHata(b, s);
      if (h) return h;
      const br = str(a[2]);
      if (hata(br)) return br;
      const x = Math.floor(b), z = Math.floor(s);
      if (x > z) return ERR.NUM;   // DATEDIF ters aralığı kabul etmez
      const p = parcala(x), q = parcala(z);
      const ay = (q.y - p.y) * 12 + (q.ay - p.ay) - (q.gun < p.gun ? 1 : 0);
      switch (br.toUpperCase()) {
        case 'Y': return Math.floor(ay / 12);
        case 'M': return ay;
        case 'D': return z - x;
        case 'YM': return ay % 12;
        case 'MD': {
          /*
           * MD, gün farkını BİTİŞTEN ÖNCEKİ ayın boyundan ödünç alır — başlangıcın ayından
           * değil. Bu yüzden 31 Ocak → 1 Mart için -2 çıkar. Belgelenmiş (ve Microsoft'un
           * "kullanmayın" dediği) davranış budur; düzeltilmez, taklit edilir.
           */
          let d = q.gun - p.gun;
          if (d < 0) {
            const t = q.y * 12 + (q.ay - 1) - 1;
            const yy = Math.floor(t / 12), aa = t - yy * 12 + 1;
            const g = ayGunSayisi(yy, aa);
            if (hata(g)) return g;
            d += g;
          }
          return d;
        }
        case 'YD': {
          // Başlangıcın gün/ayı bitişin yılına taşınır; ileri kaçarsa bir yıl geri alınır.
          let k = seriYap(q.y, p.ay, p.gun);
          if (hata(k)) return k;
          if (k > z) { k = seriYap(q.y - 1, p.ay, p.gun); if (hata(k)) return k; }
          return z - k;
        }
        default: return ERR.NUM;
      }
    },
  },
});

/** YEARFRAC'ın 1 numaralı temeli (gerçek/gerçek). */
function gercekGercek(x, z) {
  const p = parcala(x), q = parcala(z);
  /*
   * Aralık bir takvim yılını AŞMIYORSA payda o aralığın kendi yıl boyudur; aşıyorsa
   * kapsanan yılların ORTALAMA boyu kullanılır. İki kural arasındaki sınır, incelikli
   * olan yer burasıdır: 29 Şubat aralığın içine düşüyorsa payda 366 olur.
   */
  const birYil = q.y === p.y || (q.y === p.y + 1 && (p.ay > q.ay || (p.ay === q.ay && p.gun >= q.gun)));
  if (birYil) {
    let payda = 365;
    if (p.y === q.y && artikMi(p.y)) payda = 366;
    else if (subatArasi(x, z, p.y) || subatArasi(x, z, q.y)) payda = 366;
    return (z - x) / payda;
  }
  const yilSayisi = q.y - p.y + 1;
  const ilk = seriYap(p.y, 1, 1), son = seriYap(q.y + 1, 1, 1);
  if (hata(ilk)) return ilk;
  if (hata(son)) return son;
  return (z - x) / ((son - ilk) / yilSayisi);
}
function subatArasi(x, z, y) {
  if (!artikMi(y)) return false;
  const f = seriYap(y, 2, 29);
  return !hata(f) && f >= x && f <= z;
}

/*
 * LibreOffice Calc'ın tarih işlevleri. Excel'de yoktur ama ODS'den dönüştürülmüş
 * dosyalarda sık geçerler ve bu kategoriye girerler. Calc bunları xlsx'e yazarken
 * _xlfn.ORG.OPENOFFICE.<AD> biçimini kullanır (çekirdeğin sözcükleyicisi _xlfn. önekini
 * atar), bu yüzden her biri iki adla kaydedilir.
 */
const EK_ISLEVLER = {
  DAYSINMONTH: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); if (hata(s)) return s; const p = parcala(s); return ayGunSayisi(p.y, p.ay); } },
  DAYSINYEAR: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); if (hata(s)) return s; const y = parcala(s).y; const i = seriYap(y, 1, 1), k = seriYap(y + 1, 1, 1); return hata(i) ? i : hata(k) ? k : k - i; } },
  ISLEAPYEAR: { en: 1, ek: 1, fn: (a) => { const s = tarih(a[0]); if (hata(s)) return s; return artikMi(parcala(s).y) ? 1 : 0; } },
  WEEKSINYEAR: {
    en: 1, ek: 1,
    fn: (a) => {
      const s = tarih(a[0]);
      if (hata(s)) return s;
      // 28 Aralık her zaman yılın SON ISO haftasındadır; 52 mi 53 mü olduğunu o söyler.
      const k = seriYap(parcala(s).y, 12, 28);
      return hata(k) ? k : isoHafta(k);
    },
  },
  EASTERSUNDAY: {
    en: 1, ek: 1,
    fn: (a) => {
      const y = num(a[0]);
      if (hata(y)) return y;
      const yy = Math.trunc(y);
      if (yy < 1900 || yy > 9999) return ERR.NUM;
      // Anonim Gregoryen algoritma (Gauss'un düzeltilmiş biçimi).
      const g = yy % 19, b = Math.floor(yy / 100), c = yy % 100;
      const d = Math.floor(b / 4), e = b % 4;
      const f = Math.floor((b + 8) / 25), i = Math.floor((b - f + 1) / 3);
      const h = (19 * g + b - d - i + 15) % 30;
      const l = Math.floor(c / 4), m = c % 4;
      const n = (32 + 2 * e + 2 * l - h - m) % 7;
      const p = Math.floor((g + 11 * h + 22 * n) / 451);
      const t = h + n - 7 * p + 114;
      return sinirla(seriYap(yy, Math.floor(t / 31), (t % 31) + 1));
    },
  },
};
kaydetHepsi(EK_ISLEVLER);
kaydetHepsi(Object.fromEntries(Object.keys(EK_ISLEVLER).map(k => ['ORG.OPENOFFICE.' + k, EK_ISLEVLER[k]])));
