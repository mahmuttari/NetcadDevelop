/*
 * xlfn_date.js sınaması — Excel TARİH ve SAAT işlevleri.
 * Playwright yok, düz node: 'node tools/test_xlfn_date.mjs'.
 *
 * Bütün denetimler formül METNİNDEN geçer (X.hesapla), böylece sözcükleyici ve
 * ayrıştırıcı da yolun içinde kalır. Zaman sabittir: sahte ctx.simdi hep aynı seriyi
 * verir, yoksa TODAY / NOW sınaması yarın kırılırdı.
 */
import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_date.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// 2026-09-19 14:30:45 — sabit "şimdi"
const SIMDI = 46284 + (14 * 3600 + 30 * 60 + 45) / 86400;

// Sahte sayfa: A1..A4 tarih serileri, C1..C3 tatil aralığı, E1 metin, E2 boş
const HUCRE = new Map([
  ['0,0', 46284],        // A1 = 2026-09-19
  ['1,0', 46023],        // A2 = 2026-01-01
  ['2,0', null],         // A3 = boş
  ['3,0', '2026-09-19'], // A4 = metin tarih
  ['0,2', 46286],        // C1 = 2026-09-21 (Pazartesi)
  ['1,2', 46287],        // C2 = 2026-09-22
  ['2,2', null],         // C3 = boş
  ['0,4', 46284.5],      // E1 = 2026-09-19 12:00
]);
const ctx = {
  sayfa: 'Sayfa1',
  hucre: { r: 0, c: 0 },
  oku: (sh, r, c) => { const v = HUCRE.get(r + ',' + c); return v === undefined ? null : v; },
  boyut: () => ({ r: 10, c: 8 }),
  simdi: () => SIMDI,
  rastgele: () => 0.5,
};
const h = (f) => X.hesapla(f, ctx);
const hs = (f) => X.hesapla(f, {});   // saatsiz bağlam

const es = (ad, f, bek) => ok(ad, h(f) === bek, '→ ' + JSON.stringify(h(f)) + ' (beklenen ' + JSON.stringify(bek) + ')');
const yak = (ad, f, bek, tol = 1e-10) => { const v = h(f); ok(ad, typeof v === 'number' && Math.abs(v - bek) <= tol, '→ ' + JSON.stringify(v) + ' (beklenen ~' + bek + ')'); };
const hat = (ad, f, kod) => { const v = h(f); ok(ad, X.hata(v) && v.e === kod, '→ ' + JSON.stringify(v) + ' (beklenen ' + kod + ')'); };

// --------------------------------------------------------------------- DATE
es('DATE temel', 'DATE(2026,9,19)', 46284);
es('DATE 1900-01-01 = 1', 'DATE(1900,1,1)', 1);
es('DATE 1900-02-28 = 59', 'DATE(1900,2,28)', 59);
es('DATE sahte 1900-02-29 = 60', 'DATE(1900,2,29)', 60);
es('DATE 1900-03-01 = 61', 'DATE(1900,3,1)', 61);
es('DATE 1900-01-00 = 0', 'DATE(1900,1,0)', 0);
es('DATE üst sınır 9999-12-31', 'DATE(9999,12,31)', 2958465);
es('DATE artık gün 2024-02-29', 'DATE(2024,2,29)', 45351);
es('DATE ay taşması', 'DATE(2026,14,1)', 46419);
es('DATE ay taşması = DATE(2027,2,1)', 'DATE(2026,14,1)-DATE(2027,2,1)', 0);
es('DATE ay 0 bir önceki aralık', 'DATE(2026,0,1)-DATE(2025,12,1)', 0);
es('DATE gün taşması', 'DATE(2026,1,32)-DATE(2026,2,1)', 0);
es('DATE gün 0 = önceki ayın sonu', 'DATE(2026,3,0)-DATE(2026,2,28)', 0);
es('DATE iki haneli yıl 1900e eklenir', 'DATE(26,1,1)-DATE(1926,1,1)', 0);
es('DATE 1899 de 1900e eklenir', 'DATE(1899,1,1)-DATE(3799,1,1)', 0);
es('DATE kesirli argüman kırpılır', 'DATE(2026.9,9.9,19.9)', 46284);
hat('DATE eksi sonuç #NUM!', 'DATE(1900,1,-1)', '#NUM!');
hat('DATE yıl 10000 #NUM!', 'DATE(10000,1,1)', '#NUM!');
hat('DATE eksi yıl #NUM!', 'DATE(-1,1,1)', '#NUM!');
hat('DATE çevrilemeyen metin #VALUE!', 'DATE("abc",1,1)', '#VALUE!');
hat('DATE eksik argüman #VALUE!', 'DATE(2026,1)', '#VALUE!');
es('DATE sayı metni çevrilir', 'DATE("2026","9","19")', 46284);

// --------------------------------------------------------------------- TIME
yak('TIME öğlen', 'TIME(12,0,0)', 0.5);
yak('TIME 14:30:45', 'TIME(14,30,45)', 0.6046875);
es('TIME gece yarısı', 'TIME(0,0,0)', 0);
yak('TIME 24 saat sarar', 'TIME(27,0,0)', 0.125);
yak('TIME dakika taşar', 'TIME(0,90,0)', 0.0625);
yak('TIME saniye taşar', 'TIME(0,0,3600)', 1 / 24);
hat('TIME eksi saat #NUM!', 'TIME(-1,0,0)', '#NUM!');
hat('TIME 32768 #NUM!', 'TIME(32768,0,0)', '#NUM!');
es('TIME kesirli kırpılır', 'TIME(12.9,0,0)', 0.5);

// ----------------------------------------------------------------- TODAY/NOW
es('TODAY sabit saatten', 'TODAY()', 46284);
yak('NOW sabit saatten', 'NOW()', SIMDI);
es('TODAY tam sayıdır', 'NOW()-TODAY()>0', true);
ok('TODAY saatsiz bağlamda #VALUE!', X.hata(hs('TODAY()')) && hs('TODAY()').e === '#VALUE!', '→ ' + JSON.stringify(hs('TODAY()')));
ok('NOW saatsiz bağlamda #VALUE!', X.hata(hs('NOW()')) && hs('NOW()').e === '#VALUE!', '→ ' + JSON.stringify(hs('NOW()')));
hat('TODAY argüman almaz', 'TODAY(1)', '#VALUE!');

// --------------------------------------------------------- DAY / MONTH / YEAR
es('DAY', 'DAY(46284)', 19);
es('MONTH', 'MONTH(46284)', 9);
es('YEAR', 'YEAR(46284)', 2026);
es('DAY seri 0 = 0', 'DAY(0)', 0);
es('MONTH seri 0 = 1', 'MONTH(0)', 1);
es('YEAR seri 0 = 1900', 'YEAR(0)', 1900);
es('DAY sahte 29 Şubat', 'DAY(60)', 29);
es('MONTH sahte 29 Şubat', 'MONTH(60)', 2);
es('DAY 1900-02-28', 'DAY(59)', 28);
es('DAY 1900-03-01', 'DAY(61)', 1);
es('YEAR boş hücre 1900', 'YEAR(A3)', 1900);
es('YEAR metin tarihten', 'YEAR("2026-09-19")', 2026);
es('MONTH sayı metninden', 'MONTH("46284")', 9);
es('DAY hücreden', 'DAY(A1)', 19);
es('DAY metin hücresinden', 'DAY(A4)', 19);
es('DAY kesir yok sayılır', 'DAY(46284.99)', 19);
hat('DAY mantık değeri #VALUE!', 'DAY(TRUE)', '#VALUE!');
hat('DAY eksi seri #NUM!', 'DAY(-1)', '#NUM!');
hat('YEAR tanınmayan metin #VALUE!', 'YEAR("pazartesi")', '#VALUE!');

// ------------------------------------------------------ HOUR / MINUTE / SECOND
es('HOUR', 'HOUR(0.5)', 12);
es('MINUTE', 'MINUTE(TIME(14,30,45))', 30);
es('SECOND', 'SECOND(TIME(14,30,45))', 45);
es('HOUR tarih+saat', 'HOUR(46284+TIME(14,30,45))', 14);
es('HOUR tam gün 0', 'HOUR(46284)', 0);
es('MINUTE tam gün 0', 'MINUTE(46284)', 0);
es('SECOND tam gün 0', 'SECOND(46284)', 0);
es('HOUR metinden', 'HOUR("18:45")', 18);
es('MINUTE metinden', 'MINUTE("18:45")', 45);
es('HOUR hücreden', 'HOUR(E1)', 12);
hat('HOUR eksi #NUM!', 'HOUR(-0.5)', '#NUM!');

// ------------------------------------------------------------------- WEEKDAY
es('WEEKDAY 1 = Cumartesi', 'WEEKDAY(46284)', 7);
es('WEEKDAY seri 1 Pazar', 'WEEKDAY(1)', 1);
es('WEEKDAY seri 0 Cumartesi', 'WEEKDAY(0)', 7);
es('WEEKDAY dizge 2', 'WEEKDAY(46284,2)', 6);
es('WEEKDAY dizge 3 sıfır tabanlı', 'WEEKDAY(46284,3)', 5);
es('WEEKDAY dizge 3 Pazartesi = 0', 'WEEKDAY(46286,3)', 0);
es('WEEKDAY dizge 11 Pazartesi = 1', 'WEEKDAY(46286,11)', 1);
es('WEEKDAY dizge 11 Pazar = 7', 'WEEKDAY(46285,11)', 7);
es('WEEKDAY dizge 12 Salı = 1', 'WEEKDAY(46287,12)', 1);
es('WEEKDAY dizge 16 Cumartesi = 1', 'WEEKDAY(46284,16)', 1);
es('WEEKDAY dizge 17 = dizge 1', 'WEEKDAY(46284,17)-WEEKDAY(46284,1)', 0);
hat('WEEKDAY dizge 0 #NUM!', 'WEEKDAY(46284,0)', '#NUM!');
hat('WEEKDAY dizge 4 #NUM!', 'WEEKDAY(46284,4)', '#NUM!');
hat('WEEKDAY dizge 18 #NUM!', 'WEEKDAY(46284,18)', '#NUM!');
hat('WEEKDAY boş dizge argümanı #NUM!', 'WEEKDAY(46284,)', '#NUM!');

// ------------------------------------------------------------------- WEEKNUM
es('WEEKNUM 1 Ocak hep 1. hafta', 'WEEKNUM(DATE(2026,1,1))', 1);
es('WEEKNUM Pazar yeni hafta', 'WEEKNUM(DATE(2026,1,4))', 2);
es('WEEKNUM dizge 2 Pazar hâlâ 1', 'WEEKNUM(DATE(2026,1,4),2)', 1);
es('WEEKNUM dizge 2 Pazartesi 2', 'WEEKNUM(DATE(2026,1,5),2)', 2);
es('WEEKNUM dizge 11 = dizge 2', 'WEEKNUM(DATE(2026,6,15),11)-WEEKNUM(DATE(2026,6,15),2)', 0);
es('WEEKNUM eylül', 'WEEKNUM(DATE(2026,9,19))', 38);
es('WEEKNUM dizge 21 ISO', 'WEEKNUM(DATE(2021,1,1),21)', 53);
es('WEEKNUM 21 = ISOWEEKNUM', 'WEEKNUM(DATE(2026,9,19),21)-ISOWEEKNUM(DATE(2026,9,19))', 0);
hat('WEEKNUM dizge 3 #NUM!', 'WEEKNUM(DATE(2026,1,1),3)', '#NUM!');
hat('WEEKNUM dizge 22 #NUM!', 'WEEKNUM(DATE(2026,1,1),22)', '#NUM!');

// ---------------------------------------------------------------- ISOWEEKNUM
es('ISOWEEKNUM perşembe kuralı', 'ISOWEEKNUM(DATE(2026,1,1))', 1);
es('ISOWEEKNUM önceki yılın pazartesisi', 'ISOWEEKNUM(DATE(2025,12,29))', 1);
es('ISOWEEKNUM 53. hafta', 'ISOWEEKNUM(DATE(2021,1,1))', 53);
es('ISOWEEKNUM eylül', 'ISOWEEKNUM(DATE(2026,9,19))', 38);
es('ISOWEEKNUM yıl sonu', 'ISOWEEKNUM(DATE(2026,12,31))', 53);
hat('ISOWEEKNUM eksi #NUM!', 'ISOWEEKNUM(-1)', '#NUM!');

// ------------------------------------------------------------ EDATE / EOMONTH
es('EDATE bir ay ileri', 'EDATE(DATE(2026,1,15),1)-DATE(2026,2,15)', 0);
es('EDATE ay sonu kırpılır', 'EDATE(DATE(2026,1,31),1)-DATE(2026,2,28)', 0);
es('EDATE artık yıla kırpma', 'EDATE(DATE(2024,1,31),1)-DATE(2024,2,29)', 0);
es('EDATE geri', 'EDATE(DATE(2026,3,31),-1)-DATE(2026,2,28)', 0);
es('EDATE sıfır ay', 'EDATE(DATE(2026,9,19),0)-DATE(2026,9,19)', 0);
es('EDATE yıl aşımı', 'EDATE(DATE(2026,12,15),2)-DATE(2027,2,15)', 0);
hat('EDATE 1900 öncesi #NUM!', 'EDATE(DATE(1900,1,15),-12)', '#NUM!');
es('EOMONTH aynı ay', 'EOMONTH(DATE(2026,1,15),0)-DATE(2026,1,31)', 0);
es('EOMONTH şubat', 'EOMONTH(DATE(2026,2,3),0)-DATE(2026,2,28)', 0);
es('EOMONTH artık şubat', 'EOMONTH(DATE(2024,2,3),0)-DATE(2024,2,29)', 0);
es('EOMONTH önceki ay', 'EOMONTH(DATE(2026,1,31),-1)-DATE(2025,12,31)', 0);
es('EOMONTH ileri', 'EOMONTH(DATE(2026,9,19),3)-DATE(2026,12,31)', 0);

// ---------------------------------------------------------------------- DAYS
es('DAYS basit', 'DAYS(DATE(2026,9,19),DATE(2026,9,1))', 18);
es('DAYS ters eksi', 'DAYS(DATE(2026,9,1),DATE(2026,9,19))', -18);
es('DAYS metin tarihlerle', 'DAYS("2026-09-19","2026-09-18")', 1);
es('DAYS kesir kırpılır', 'DAYS(46284.9,46283.2)', 1);
es('DAYS aynı gün 0', 'DAYS(A1,A1)', 0);

// ------------------------------------------------------------------- DAYS360
es('DAYS360 ABD ay sonu 1ine taşınır', 'DAYS360(DATE(2026,1,1),DATE(2026,3,31))', 90);
es('DAYS360 Avrupa 31 → 30', 'DAYS360(DATE(2026,1,1),DATE(2026,3,31),TRUE)', 89);
es('DAYS360 ABD şubat sonu 30 sayılır', 'DAYS360(DATE(2026,2,28),DATE(2026,3,31))', 30);
es('DAYS360 Avrupa şubat sonu olduğu gibi', 'DAYS360(DATE(2026,2,28),DATE(2026,3,31),TRUE)', 32);
es('DAYS360 bir yıl', 'DAYS360(DATE(2026,1,1),DATE(2027,1,1))', 360);
es('DAYS360 aynı gün', 'DAYS360(DATE(2026,9,19),DATE(2026,9,19))', 0);
es('DAYS360 ters eksi', 'DAYS360(DATE(2026,3,1),DATE(2026,1,1))', -60);
es('DAYS360 ABD başlangıç 31', 'DAYS360(DATE(2026,1,31),DATE(2026,3,31))', 60);
es('DAYS360 Avrupa başlangıç 31', 'DAYS360(DATE(2026,1,31),DATE(2026,3,31),TRUE)', 60);
es('DAYS360 artık şubat ABD', 'DAYS360(DATE(2024,2,29),DATE(2024,3,31))', 30);

// ------------------------------------------------------------------ YEARFRAC
yak('YEARFRAC temel 0 (30/360 ABD)', 'YEARFRAC(DATE(2026,1,1),DATE(2026,7,1))', 0.5);
yak('YEARFRAC temel 1 gerçek/gerçek', 'YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),1)', 181 / 365);
yak('YEARFRAC temel 1 artık yıl', 'YEARFRAC(DATE(2024,1,1),DATE(2024,7,1),1)', 182 / 366);
yak('YEARFRAC temel 1 tam artık yıl', 'YEARFRAC(DATE(2024,1,1),DATE(2025,1,1),1)', 1);
yak('YEARFRAC temel 1 tam normal yıl', 'YEARFRAC(DATE(2023,1,1),DATE(2024,1,1),1)', 1);
yak('YEARFRAC temel 1 çok yıllı ortalama', 'YEARFRAC(DATE(2020,1,1),DATE(2026,1,1),1)', 2192 / (2557 / 7));
yak('YEARFRAC temel 2 gerçek/360', 'YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),2)', 181 / 360);
yak('YEARFRAC temel 3 gerçek/365', 'YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),3)', 181 / 365);
yak('YEARFRAC temel 4 (30/360 Avrupa)', 'YEARFRAC(DATE(2026,1,1),DATE(2026,3,31),4)', 89 / 360);
yak('YEARFRAC sıra önemsiz', 'YEARFRAC(DATE(2026,7,1),DATE(2026,1,1),1)', 181 / 365);
es('YEARFRAC aynı gün 0', 'YEARFRAC(DATE(2026,1,1),DATE(2026,1,1),1)', 0);
hat('YEARFRAC temel 5 #NUM!', 'YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),5)', '#NUM!');
hat('YEARFRAC eksi temel #NUM!', 'YEARFRAC(DATE(2026,1,1),DATE(2026,7,1),-1)', '#NUM!');

// ----------------------------------------------------- WORKDAY / NETWORKDAYS
// 2026-09-18 Cuma · 19 Cmt · 20 Paz · 21 Pzt · 22 Sal
es('WORKDAY cumadan bir gün', 'WORKDAY(DATE(2026,9,18),1)-DATE(2026,9,21)', 0);
es('WORKDAY beş gün', 'WORKDAY(DATE(2026,9,18),5)-DATE(2026,9,25)', 0);
es('WORKDAY sıfır gün başlangıcı verir', 'WORKDAY(DATE(2026,9,19),0)-DATE(2026,9,19)', 0);
es('WORKDAY geri', 'WORKDAY(DATE(2026,9,21),-1)-DATE(2026,9,18)', 0);
es('WORKDAY tatil atlanır', 'WORKDAY(DATE(2026,9,18),1,DATE(2026,9,21))-DATE(2026,9,22)', 0);
es('WORKDAY tatil aralığından', 'WORKDAY(DATE(2026,9,18),1,C1:C3)-DATE(2026,9,23)', 0);
es('WORKDAY.INTL maske Cmt-Paz', 'WORKDAY.INTL(DATE(2026,9,18),1,"0000011")-DATE(2026,9,21)', 0);
es('WORKDAY.INTL yalnız Pazar (11)', 'WORKDAY.INTL(DATE(2026,9,18),1,11)-DATE(2026,9,19)', 0);
es('WORKDAY.INTL Cuma-Cmt (7)', 'WORKDAY.INTL(DATE(2026,9,17),1,7)-DATE(2026,9,20)', 0);
es('WORKDAY.INTL maske + tatil', 'WORKDAY.INTL(DATE(2026,9,18),1,"0000011",DATE(2026,9,21))-DATE(2026,9,22)', 0);
hat('WORKDAY.INTL kısa maske #VALUE!', 'WORKDAY.INTL(DATE(2026,9,18),1,"00011")', '#VALUE!');
hat('WORKDAY.INTL bozuk maske #VALUE!', 'WORKDAY.INTL(DATE(2026,9,18),1,"000001X")', '#VALUE!');
hat('WORKDAY.INTL hafta sonu 8 #NUM!', 'WORKDAY.INTL(DATE(2026,9,18),1,8)', '#NUM!');
hat('WORKDAY.INTL yedi gün tatil #VALUE!', 'WORKDAY.INTL(DATE(2026,9,18),1,"1111111")', '#VALUE!');
es('NETWORKDAYS eylül 2026', 'NETWORKDAYS(DATE(2026,9,1),DATE(2026,9,30))', 22);
es('NETWORKDAYS ters eksi', 'NETWORKDAYS(DATE(2026,9,30),DATE(2026,9,1))', -22);
es('NETWORKDAYS tek gün hafta içi', 'NETWORKDAYS(DATE(2026,9,21),DATE(2026,9,21))', 1);
es('NETWORKDAYS tek gün cumartesi', 'NETWORKDAYS(DATE(2026,9,19),DATE(2026,9,19))', 0);
es('NETWORKDAYS tatil düşer', 'NETWORKDAYS(DATE(2026,9,21),DATE(2026,9,25),DATE(2026,9,23))', 4);
es('NETWORKDAYS hafta sonu tatili saymaz', 'NETWORKDAYS(DATE(2026,9,21),DATE(2026,9,25),DATE(2026,9,19))', 5);
es('NETWORKDAYS tatil aralığı', 'NETWORKDAYS(DATE(2026,9,21),DATE(2026,9,25),C1:C3)', 3);
es('NETWORKDAYS.INTL yalnız Pazar', 'NETWORKDAYS.INTL(DATE(2026,9,1),DATE(2026,9,30),11)', 26);
es('NETWORKDAYS.INTL maske ile', 'NETWORKDAYS.INTL(DATE(2026,9,1),DATE(2026,9,30),"0000011")', 22);
es('NETWORKDAYS.INTL yedi gün tatil 0', 'NETWORKDAYS.INTL(DATE(2026,9,1),DATE(2026,9,30),"1111111")', 0);
es('NETWORKDAYS.INTL Cuma-Cmt', 'NETWORKDAYS.INTL(DATE(2026,9,1),DATE(2026,9,30),7)', 22);
hat('NETWORKDAYS.INTL hafta sonu 0 #NUM!', 'NETWORKDAYS.INTL(DATE(2026,9,1),DATE(2026,9,30),0)', '#NUM!');

// ------------------------------------------------- DATEVALUE / TIMEVALUE
es('DATEVALUE ISO', 'DATEVALUE("2026-09-19")', 46284);
es('DATEVALUE ISO eğik çizgi', 'DATEVALUE("2026/09/19")', 46284);
es('DATEVALUE ABD', 'DATEVALUE("9/19/2026")', 46284);
es('DATEVALUE gün.ay.yıl', 'DATEVALUE("19.09.2026")', 46284);
es('DATEVALUE iki haneli yıl 20xx', 'DATEVALUE("19.09.26")', 46284);
es('DATEVALUE iki haneli yıl 19xx', 'DATEVALUE("1.1.99")-DATE(1999,1,1)', 0);
es('DATEVALUE gün>12 eğik çizgide gün okunur', 'DATEVALUE("19/09/2026")', 46284);
es('DATEVALUE saat atılır', 'DATEVALUE("2026-09-19 14:30")', 46284);
es('DATEVALUE ISO 8601 T', 'DATEVALUE("2026-09-19T14:30:00")', 46284);
hat('DATEVALUE saat-only #VALUE!', 'DATEVALUE("14:30")', '#VALUE!');
hat('DATEVALUE geçersiz gün #VALUE!', 'DATEVALUE("2026-02-30")', '#VALUE!');
hat('DATEVALUE geçersiz ay #VALUE!', 'DATEVALUE("2026-13-01")', '#VALUE!');
hat('DATEVALUE anlamsız metin #VALUE!', 'DATEVALUE("dün")', '#VALUE!');
hat('DATEVALUE sayı argümanı #VALUE!', 'DATEVALUE(46284)', '#VALUE!');
es('DATEVALUE sahte 1900-02-29 kabul', 'DATEVALUE("1900-02-29")', 60);
yak('TIMEVALUE saat:dakika', 'TIMEVALUE("18:45")', (18 * 3600 + 45 * 60) / 86400);
yak('TIMEVALUE saniyeli', 'TIMEVALUE("14:30:45")', 0.6046875);
yak('TIMEVALUE PM', 'TIMEVALUE("2:30 PM")', 14.5 / 24);
yak('TIMEVALUE AM 12 gece yarısı', 'TIMEVALUE("12:00 AM")', 0);
yak('TIMEVALUE PM 12 öğlen', 'TIMEVALUE("12:00 PM")', 0.5);
yak('TIMEVALUE tarihli metinden yalnız saat', 'TIMEVALUE("2026-09-19 06:00")', 0.25);
es('TIMEVALUE saatsiz tarih 0', 'TIMEVALUE("2026-09-19")', 0);
hat('TIMEVALUE 13 PM #VALUE!', 'TIMEVALUE("13:00 PM")', '#VALUE!');
hat('TIMEVALUE 70 dakika #VALUE!', 'TIMEVALUE("10:70")', '#VALUE!');
hat('TIMEVALUE sayı argümanı #VALUE!', 'TIMEVALUE(0.5)', '#VALUE!');

// ------------------------------------------------------------------- DATEDIF
es('DATEDIF Y tam yıl', 'DATEDIF(DATE(2020,1,1),DATE(2026,1,1),"Y")', 6);
es('DATEDIF Y bir gün eksik', 'DATEDIF(DATE(2020,3,15),DATE(2026,3,14),"Y")', 5);
es('DATEDIF M', 'DATEDIF(DATE(2026,1,15),DATE(2026,7,15),"M")', 6);
es('DATEDIF M gün tamamlanmamış', 'DATEDIF(DATE(2026,1,15),DATE(2026,7,14),"M")', 5);
es('DATEDIF D', 'DATEDIF(DATE(2026,9,1),DATE(2026,9,19),"D")', 18);
es('DATEDIF YM', 'DATEDIF(DATE(2024,1,15),DATE(2026,7,20),"YM")', 6);
es('DATEDIF YM gün eksikse bir azalır', 'DATEDIF(DATE(2026,1,31),DATE(2026,3,1),"YM")', 1);
es('DATEDIF MD normal', 'DATEDIF(DATE(2026,1,15),DATE(2026,3,10),"MD")', 23);
es('DATEDIF MD Excel hatası eksi verir', 'DATEDIF(DATE(2015,1,31),DATE(2015,3,1),"MD")', -2);
es('DATEDIF MD aynı gün 0', 'DATEDIF(DATE(2026,1,15),DATE(2026,5,15),"MD")', 0);
es('DATEDIF YD aynı yıl', 'DATEDIF(DATE(2026,1,1),DATE(2026,12,31),"YD")', 364);
es('DATEDIF YD yıl aşan', 'DATEDIF(DATE(2025,12,1),DATE(2026,3,1),"YD")', 90);
es('DATEDIF birim küçük harf', 'DATEDIF(DATE(2026,1,1),DATE(2026,3,1),"m")', 2);
hat('DATEDIF ters aralık #NUM!', 'DATEDIF(DATE(2026,9,19),DATE(2026,9,1),"D")', '#NUM!');
hat('DATEDIF bilinmeyen birim #NUM!', 'DATEDIF(DATE(2026,1,1),DATE(2026,3,1),"W")', '#NUM!');

// ------------------------------------------- LibreOffice kökenli ek işlevler
es('DAYSINMONTH şubat', 'DAYSINMONTH(DATE(2026,2,1))', 28);
es('DAYSINMONTH artık şubat', 'DAYSINMONTH(DATE(2024,2,1))', 29);
es('DAYSINMONTH ocak', 'DAYSINMONTH(DATE(2026,1,1))', 31);
es('DAYSINYEAR normal', 'DAYSINYEAR(DATE(2026,5,5))', 365);
es('DAYSINYEAR artık', 'DAYSINYEAR(DATE(2024,5,5))', 366);
es('ISLEAPYEAR artık', 'ISLEAPYEAR(DATE(2024,1,1))', 1);
es('ISLEAPYEAR değil', 'ISLEAPYEAR(DATE(2026,1,1))', 0);
es('ISLEAPYEAR 2100 değil', 'ISLEAPYEAR(DATE(2100,1,1))', 0);
es('ISLEAPYEAR 2000 artık', 'ISLEAPYEAR(DATE(2000,1,1))', 1);
es('WEEKSINYEAR 53 hafta', 'WEEKSINYEAR(DATE(2026,6,1))', 53);
es('WEEKSINYEAR 52 hafta', 'WEEKSINYEAR(DATE(2025,6,1))', 52);
es('EASTERSUNDAY 2026 = 5 Nisan', 'EASTERSUNDAY(2026)-DATE(2026,4,5)', 0);
es('EASTERSUNDAY 2024 = 31 Mart', 'EASTERSUNDAY(2024)-DATE(2024,3,31)', 0);
es('EASTERSUNDAY 2025 = 20 Nisan', 'EASTERSUNDAY(2025)-DATE(2025,4,20)', 0);
es('EASTERSUNDAY hep pazar', 'WEEKDAY(EASTERSUNDAY(2030))', 1);
hat('EASTERSUNDAY 1800 #NUM!', 'EASTERSUNDAY(1800)', '#NUM!');
es('ORG.OPENOFFICE takma adı', 'ORG.OPENOFFICE.ISLEAPYEAR(DATE(2024,1,1))', 1);

// --------------------------------------------------- bağlam, hücre, hata yayılımı
es('hücre aralığından NETWORKDAYS', 'NETWORKDAYS(A2,A1)', 187);
es('boş hücre argümanı 0 serisi', 'YEAR(A3)', 1900);
es('metin hücresi çözülür', 'MONTH(A4)', 9);
es('tarih aritmetiği', 'DATE(2026,9,19)-DATE(2026,9,12)', 7);
es('EOMONTH+1 = sonraki ayın 1i', 'EOMONTH(A1,0)+1-DATE(2026,10,1)', 0);
hat('hata argümanı yayılır', 'DAY(1/0)', '#DIV/0!');
hat('iç içe hata yayılır', 'YEAR(DATE(2026,1,1)+1/0)', '#DIV/0!');
hat('tatil aralığındaki hata yayılır', 'NETWORKDAYS(A1,A1,1/0)', '#DIV/0!');
hat('WEEKDAY hata argümanı', 'WEEKDAY(#N/A)', '#N/A');
hat('EDATE metin ay #VALUE!', 'EDATE(A1,"x")', '#VALUE!');
hat('DAYS eksik argüman #VALUE!', 'DAYS(A1)', '#VALUE!');
hat('bilinmeyen ad #NAME?', 'DATEDIFF(A1,A1,"D")', '#NAME?');

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
