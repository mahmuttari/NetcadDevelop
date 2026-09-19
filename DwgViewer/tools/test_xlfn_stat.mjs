// İstatistik işlevleri sınaması — xlfn_stat.js. Playwright yok, düz node.
// Kullanım: node tools/test_xlfn_stat.mjs   (depo kökünden de, tools/ içinden de koşar)
//
// Beklenen değerlerin çoğu Excel belgelerindeki örneklerden alınmıştır; geri kalanı elle
// türetilmiş kapalı biçimlerdir. Kayan noktada tam eşitlik aranmaz, bağıl tolerans kullanılır —
// ama sonuç YUVARLANMAZ: gerçeği gizlememek için karşılaştırma ham değer üzerinde yapılır.

import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_stat.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// ---- sahte çalışma sayfası -------------------------------------------------------
// A: 1 | "3" | DOĞRU | boş | 2 | #DIV/0!      B: 10 20 30 40 50 60      C: metin
const VERI = [
  [1, 10, 'elma'],
  ['3', 20, 'armut'],
  [true, 30, 'elma'],
  [null, 40, 'kiraz'],
  [2, 50, 'elma'],
  [{ e: '#DIV/0!' }, 60, 'armut'],
];
const CTX = {
  sayfa: 'S1', hucre: { r: 0, c: 0 },
  oku: (s, r, c) => (VERI[r] && VERI[r][c] !== undefined ? VERI[r][c] : null),
  boyut: () => ({ r: VERI.length, c: 3 }),
  simdi: () => 46000,
  rastgele: () => 0.5,
};

const H = (f) => X.hesapla(f, CTX);
const gor = (v) => JSON.stringify(v);
/** sayı denetimi (bağıl tolerans) */
const s = (f, bek, tol = 1e-9) => {
  const v = H(f);
  const iyi = typeof v === 'number' && isFinite(v) && Math.abs(v - bek) <= tol * Math.max(1, Math.abs(bek));
  ok(f + ' = ' + bek, iyi, '→ ' + gor(v));
};
/** tam eşitlik (tam sayı / mantık / metin) */
const e = (f, bek) => { const v = H(f); ok(f + ' = ' + gor(bek), v === bek, '→ ' + gor(v)); };
/** hata kodu denetimi */
const hh = (f, kod) => { const v = H(f); ok(f + ' → ' + kod, !!v && v.e === kod, '→ ' + gor(v)); };
/** 2 boyutlu dizi denetimi; bek içindeki null "bakma" demektir */
const d = (f, bek, tol = 1e-9) => {
  const v = H(f);
  let iyi = Array.isArray(v) && Array.isArray(v[0]) && v.length === bek.length;
  if (iyi) {
    for (let i = 0; i < bek.length && iyi; i++) {
      if (v[i].length !== bek[i].length) { iyi = false; break; }
      for (let j = 0; j < bek[i].length && iyi; j++) {
        const a = v[i][j], b = bek[i][j];
        if (b === null) continue;
        if (typeof b === 'string') iyi = !!a && a.e === b;
        else iyi = typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
      }
    }
  }
  ok(f + ' = ' + gor(bek), iyi, '→ ' + gor(v));
};

// =================================================================================
console.log('--- betimleyici istatistik ---');
// =================================================================================
s('AVERAGE({1,2,3,4})', 2.5);
s('AVERAGE(A1:A5)', 1.5);                 // aralıkta metin ve mantık ATLANIR: (1+2)/2
s('AVERAGE("3",1)', 2);                   // doğrudan yazılan metin ÇEVRİLİR
e('AVERAGE(A2,1)', 1);                    // tek hücrelik başvuru da aralıktır: "3" atlanır
e('AVERAGE(TRUE,3)', 2);                  // doğrudan yazılan mantık sayılır
hh('AVERAGE(A4)', '#DIV/0!');             // boş hücre paydaya girmez
hh('AVERAGE(A1:A6)', '#DIV/0!');          // aralıktaki hata YAYILIR
hh('AVERAGE("abc")', '#VALUE!');
s('AVERAGEA(A1:A5)', 1);                  // metin 0, DOĞRU 1 → (1+0+1+2)/4
s('AVERAGEA({2,4})', 3);
e('MAX({3,-7,2})', 3);
e('MAX(A1:A5)', 2);
e('MAX(A4)', 0);                          // hiç sayı yoksa MAX sıfırdır, hata değil
e('MAXA(A1:A5)', 2);
e('MIN({3,-7,2})', -7);
e('MIN(A1:A5)', 1);
e('MINA(A1:A5)', 0);                      // MINA metni 0 sayar, MIN atlar
s('MEDIAN({1,2,3,4,5,6})', 3.5);
s('MEDIAN({1,2,3,4,5})', 3);
hh('MEDIAN(A4)', '#NUM!');
s('VAR({1345,1301,1368,1322,1310,1370,1318,1350,1303,1299})', 754.2666666666667);
s('VAR.S({1345,1301,1368,1322,1310,1370,1318,1350,1303,1299})', 754.2666666666667);
s('VARP({1345,1301,1368,1322,1310,1370,1318,1350,1303,1299})', 678.84);
s('VAR.P({1345,1301,1368,1322,1310,1370,1318,1350,1303,1299})', 678.84);
s('VARA({1,"a",TRUE})', 1 / 3);           // metin 0, DOĞRU 1 → örneklem varyansı
s('VARPA({1,"a",TRUE})', 2 / 9);
hh('VAR({5})', '#DIV/0!');                // örneklem varyansı en az iki nokta ister
s('VARP({5})', 0);
s('STDEV({1345,1301,1368,1322,1310,1370,1318,1350,1303,1299})', 27.46391571984349);
s('STDEV.S({1,2,3,4})', 1.2909944487358056);
s('STDEVP({1,2,3,4})', 1.118033988749895);
s('STDEV.P({1,2,3,4})', 1.118033988749895);
s('STDEVA({1,"a",TRUE})', 0.5773502691896258);
s('STDEVPA({1,"a",TRUE})', 0.4714045207910317);
s('DEVSQ({4,5,8,7,11,4,3})', 48);
s('DEVSQ({2,2,2})', 0);
s('AVEDEV({4,5,6,7,5,4,3})', 1.0204081632653061);
s('AVEDEV({1,-1})', 1);
s('GEOMEAN({4,5,8,7,11,4,3})', 5.476986969656962);
hh('GEOMEAN({4,0,8})', '#NUM!');          // sıfır ya da negatifte geometrik ortalama tanımsız
hh('GEOMEAN({4,-2})', '#NUM!');
s('HARMEAN({4,5,8,7,11,4,3})', 5.028375962061728);
hh('HARMEAN({4,0})', '#NUM!');
s('SKEW({3,4,5,2,3,4,5,6,4,7})', 0.3595430714067974);
hh('SKEW({1,2})', '#DIV/0!');             // üç noktadan az veride çarpıklık yok
hh('SKEW({2,2,2,2})', '#DIV/0!');         // sapma sıfırsa da yok
s('SKEW.P({3,4,5,2,3,4,5,6,4,7})', 0.30319333935414383);
s('KURT({3,4,5,2,3,4,5,6,4,7})', -0.1517996372084163);
hh('KURT({1,2,3})', '#DIV/0!');           // basıklık dört nokta ister
s('TRIMMEAN({4,5,6,7,2,3,4,5,1,2,3},0.2)', 3.7777777777777777);
s('TRIMMEAN({1,2,3,4},0)', 2.5);
hh('TRIMMEAN({1,2,3},2)', '#NUM!');

// =================================================================================
console.log('--- sayma ve ölçütlü toplamlar ---');
// =================================================================================
e('COUNT(A1:A6)', 2);                     // yalnız 1 ve 2; metin, mantık, boş ve hata sayılmaz
e('COUNT("3",TRUE,"a")', 2);              // doğrudan yazılanlarda metin ve mantık SAYILIR
e('COUNT(A6)', 0);                        // COUNT hatayı saymaz ve YAYMAZ
e('COUNTA(A1:A6)', 5);                    // boş dışında her şey, hata dâhil
e('COUNTA(A4)', 0);
e('COUNTBLANK(A1:A6)', 1);
e('COUNTBLANK(B1:B6)', 0);
e('COUNTIF(C1:C6,"elma")', 3);
e('COUNTIF(C1:C6,"el*")', 3);             // joker
e('COUNTIF(B1:B6,">25")', 4);
e('COUNTIF(B1:B6,"<>30")', 5);
e('COUNTIF({1,2,3},">=2")', 2);
e('COUNTIFS(C1:C6,"elma",B1:B6,">15")', 2);
e('COUNTIFS(B1:B6,">=20",B1:B6,"<=40")', 3);
hh('COUNTIFS(B1:B6,">1",C1:C6)', '#VALUE!');   // çift sayıda argüman gerekir
s('AVERAGEIF(C1:C6,"elma",B1:B6)', 30);
s('AVERAGEIF({1,2,3,4},">2")', 3.5);
hh('AVERAGEIF({1,2,3},">9")', '#DIV/0!');
s('AVERAGEIFS(B1:B6,C1:C6,"elma",B1:B6,">15")', 40);
hh('AVERAGEIFS(B1:B6,C1:C6,"muz")', '#DIV/0!');
e('MAXIFS(B1:B6,C1:C6,"elma")', 50);
e('MINIFS(B1:B6,C1:C6,"elma")', 10);
e('MINIFS(B1:B6,C1:C6,"muz")', 0);        // eşleşme yoksa 0, hata değil
e('MAXIFS(B1:B6,C1:C6,"muz")', 0);

// =================================================================================
console.log('--- sıra istatistikleri ---');
// =================================================================================
e('LARGE({3,5,3,5,4,4,2,4,6,7},3)', 5);
e('LARGE({3,5,3,5,4,4,2,4,6,7},1)', 7);
hh('LARGE({1,2,3},0)', '#NUM!');
hh('LARGE({1,2,3},4)', '#NUM!');
e('SMALL({3,4,5,2,3,4,6,4,7},4)', 4);
e('SMALL({3,4,5},1)', 3);
hh('SMALL({1,2,3},0)', '#NUM!');
e('MODE({5,6,4,4,3,2,4})', 4);
e('MODE.SNGL({5,6,4,4,3,2,4})', 4);
hh('MODE({1,2,3})', '#N/A');              // yineleme yoksa tepe değer yok
d('MODE.MULT({1,2,2,3,3,4})', [[2], [3]]);
hh('MODE.MULT({1,2,3})', '#N/A');
e('RANK(3.5,{7,3.5,3.5,1,2})', 2);        // varsayılan sıralama BÜYÜKTEN küçüğe
e('RANK(3.5,{7,3.5,3.5,1,2},1)', 3);
e('RANK.EQ(2,{1,2,3})', 2);
s('RANK.AVG(3.5,{7,3.5,3.5,1,2})', 2.5);  // eşitlerin ortalaması
hh('RANK(9,{1,2,3})', '#N/A');
s('PERCENTILE({1,2,3,4},0.3)', 1.9);
s('PERCENTILE.INC({1,2,3,4},0)', 1);
s('PERCENTILE.INC({1,2,3,4},1)', 4);
s('PERCENTILE.INC({1,2,3,4},0.5)', 2.5);
hh('PERCENTILE.INC({1,2,3},1.5)', '#NUM!');
s('PERCENTILE.EXC({1,2,3,4},0.25)', 1.25);
s('PERCENTILE.EXC({1,2,3,4},0.5)', 2.5);
hh('PERCENTILE.EXC({1,2,3,4},0.1)', '#NUM!');   // k, 1/(n+1) ile n/(n+1) dışında
hh('PERCENTILE.EXC({1,2,3,4},0.9)', '#NUM!');
s('QUARTILE({1,2,4,7,8,9,10,12},1)', 3.5);
s('QUARTILE({1,2,4,7,8,9,10,12},0)', 1);
s('QUARTILE.INC({1,2,4,7,8,9,10,12},3)', 9.25);
s('QUARTILE.INC({1,2,4,7,8,9,10,12},4)', 12);
hh('QUARTILE.INC({1,2,3},5)', '#NUM!');
s('QUARTILE.EXC({6,7,15,36,39,40,41,42,43,47,49},1)', 15);
hh('QUARTILE.EXC({1,2,3,4},0)', '#NUM!');       // .EXC uçları veremez
hh('QUARTILE.EXC({1,2,3,4},4)', '#NUM!');
s('PERCENTRANK({13,12,11,8,4,3,2,1,1,1},2)', 0.333);
s('PERCENTRANK({1,2,3,4,5},3)', 0.5);
s('PERCENTRANK({1,2,3,4,5},2.5)', 0.375);
s('PERCENTRANK.INC({1,2,3,4,5},1)', 0);
s('PERCENTRANK({1,2,3,4},2,1)', 0.3);           // anlamlı hane KESİLİR, yuvarlanmaz
hh('PERCENTRANK({1,2,3},9)', '#N/A');
hh('PERCENTRANK({1,2,3},2,0)', '#NUM!');
s('PERCENTRANK.EXC({1,2,3,4,5},3)', 0.5);
s('PERCENTRANK.EXC({1,2,3,4,5},1)', 0.166);     // (n+1) tabanı: 1/6 kesilmiş

// =================================================================================
console.log('--- iki değişkenli çözümleme ---');
// =================================================================================
s('CORREL({3,2,4,5,6},{9,7,12,15,17})', 0.9970544855015815);
hh('CORREL({1,2,3},{1,2})', '#N/A');            // uzunluklar eşit olmalı
hh('CORREL({1,1,1},{1,2,3})', '#DIV/0!');
s('PEARSON({9,7,5,3,1},{10,6,1,5,3})', 0.6993786061802354);
s('RSQ({9,7,5,3,1},{10,6,1,5,3})', 0.4891304347826088);
s('RSQ({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})', 0.05795019157088122);
s('COVAR({3,2,4,5,6},{9,7,12,15,17})', 5.2);
s('COVARIANCE.P({3,2,4,5,6},{9,7,12,15,17})', 5.2);
s('COVARIANCE.S({3,2,4,5,6},{9,7,12,15,17})', 6.5);
s('SLOPE({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})', 0.3055555555555556);
s('INTERCEPT({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})', 3.1666666666666665);
hh('SLOPE({1,2},{3,3})', '#DIV/0!');            // x değişmiyorsa eğim yok
s('FORECAST(30,{6,7,9,15,21},{20,28,31,38,40})', 10.607253086419753);
s('FORECAST.LINEAR(30,{6,7,9,15,21},{20,28,31,38,40})', 10.607253086419753);
s('STEYX({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})', 3.305718950210041);
hh('STEYX({1,2},{3,4})', '#DIV/0!');            // n-2 payda üç nokta ister
s('STANDARDIZE(42,40,1.5)', 1.3333333333333333);
s('STANDARDIZE(40,40,1.5)', 0);
hh('STANDARDIZE(1,0,0)', '#NUM!');
hh('STANDARDIZE(1,0,-2)', '#NUM!');

// =================================================================================
console.log('--- bağlanım ve dizi döndüren işlevler ---');
// =================================================================================
d('LINEST({1,9,5,7},{0,4,2,3})', [[2, 1]]);
d('LINEST({1,9,5,7})', [[1.4, 2]]);             // known_x yoksa 1,2,3,4 kullanılır
d('LINEST({2,3,9,1,8,7,5},{6,5,11,7,5,4,4},TRUE,TRUE)', [
  [0.3055555555555556, 3.1666666666666665],
  [0.5509531583683401, 3.5339622081862854],
  [0.0579501915708814, 3.305718950210041],
  [0.3075749872902908, 5],
  [3.361111111111111, 54.63888888888889],
], 1e-8);
d('LINEST({2,3,9,1,8,7,5},{6,5,11,7,5,4,4},FALSE)', [[0.7673611111111112, 0]]);
d('LOGEST({1,9,5,7},{0,4,2,3})', [[1.7511159555823306, 1.1943155909820469]]);
d('TREND({1,9,5,7},{0,4,2,3},{5})', [[11]]);
d('TREND({1,9,5,7},{0,4,2,3},{5;6})', [[11], [13]]);
d('TREND({1,9,5,7})', [[3.4, 4.8, 6.2, 7.6]]);  // new_x yoksa known_y biçiminde döner
d('GROWTH({33100,47300,69000,102000,150000,220000},{11,12,13,14,15,16},{17,18,19})',
  [[320196.7183634869, 468536.0541840754, 685597.3889812863]], 1e-7);
d('GROWTH({1,2,4,8},{1,2,3,4},{5})', [[16]]);
d('FREQUENCY({79,85,78,85,50,81,95,88,97},{70,79,89})', [[1], [2], [4], [2]]);
d('FREQUENCY({1,2,3},{2})', [[2], [1]]);        // sonuç sınırdan BİR FAZLA satır
d('FREQUENCY({1,2,3},{9})', [[3], [0]]);
s('PROB({0,1,2,3},{0.2,0.3,0.1,0.4},2,3)', 0.5);
s('PROB({0,1,2,3},{0.2,0.3,0.1,0.4},1)', 0.3);  // üst sınır yoksa tek nokta
hh('PROB({0,1},{0.2,0.3},1)', '#NUM!');         // olasılıklar toplamı 1 olmalı
hh('PROB({0,1},{0.2,-0.8},1)', '#NUM!');

// =================================================================================
console.log('--- normal ailesi ---');
// =================================================================================
s('NORM.DIST(42,40,1.5,TRUE)', 0.9087887802741321);
s('NORM.DIST(42,40,1.5,FALSE)', 0.10934004978399577);
s('NORM.DIST(42,40,1.5,)', 0.10934004978399577);   // boş zorunlu bayrak = 0 = YANLIŞ
s('NORMDIST(42,40,1.5,TRUE)', 0.9087887802741321);
hh('NORM.DIST(42,40,0,TRUE)', '#NUM!');
hh('NORM.DIST(42,40,-1,TRUE)', '#NUM!');
s('NORM.INV(0.908789,40,1.5)', 41.99999895, 1e-6);
s('NORMINV(0.5,40,1.5)', 40);
hh('NORM.INV(0,40,1.5)', '#NUM!');
hh('NORM.INV(1,40,1.5)', '#NUM!');
hh('NORM.INV(0.5,40,0)', '#NUM!');
s('NORM.S.DIST(1,TRUE)', 0.8413447460685429);
s('NORM.S.DIST(0,FALSE)', 0.3989422804014327);
s('NORMSDIST(1)', 0.8413447460685429);
s('NORMSDIST(-1)', 0.15865525393145707);
s('NORMSDIST(0)', 0.5);
s('NORM.S.INV(0.975)', 1.959963984540054);
s('NORMSINV(0.908789)', 1.3333346730441071);   // Φ(1,3333333) = 0,90878878, aradaki fark φ ile
s('NORM.S.INV(0.5)', 0);
hh('NORM.S.INV(0)', '#NUM!');
hh('NORMSINV(1)', '#NUM!');
s('NORMSDIST(NORMSINV(0.3))', 0.3);              // gidiş-dönüş tutarlılığı
s('GAUSS(2)', 0.4772498680518208);
s('GAUSS(0)', 0);
s('PHI(1)', 0.2419707245191434);
s('PHI(0)', 0.3989422804014327);
s('LOGNORM.DIST(4,3.5,1.2,TRUE)', 0.0390835557068006);
s('LOGNORM.DIST(4,3.5,1.2,FALSE)', 0.01761759668424628);
s('LOGNORMDIST(4,3.5,1.2)', 0.0390835557068006);
hh('LOGNORM.DIST(0,3.5,1.2,TRUE)', '#NUM!');
hh('LOGNORMDIST(4,3.5,0)', '#NUM!');
s('LOGNORM.INV(0.039084,3.5,1.2)', 4.000000, 1e-5);
s('LOGINV(0.039084,3.5,1.2)', 4.000000, 1e-5);
hh('LOGINV(0,3.5,1.2)', '#NUM!');
s('FISHER(0.75)', 0.9729550745276566);
s('FISHER(0)', 0);
hh('FISHER(1)', '#NUM!');
hh('FISHER(-1)', '#NUM!');
s('FISHERINV(0.972955)', 0.7499999673941484);
s('FISHERINV(0)', 0);
s('CONFIDENCE(0.05,2.5,50)', 0.6929519121748391);
s('CONFIDENCE.NORM(0.05,2.5,50)', 0.6929519121748391);
hh('CONFIDENCE(0,2.5,50)', '#NUM!');
hh('CONFIDENCE(0.05,0,50)', '#NUM!');
hh('CONFIDENCE(0.05,2.5,0)', '#NUM!');
s('CONFIDENCE.T(0.05,1,50)', 0.2841968554957285);
hh('CONFIDENCE.T(0.05,1,1)', '#DIV/0!');
s('Z.TEST({3,6,7,8,6,5,4,2,1,9},4)', 0.0905741968513639);
s('ZTEST({3,6,7,8,6,5,4,2,1,9},6)', 0.8630433891295299);
s('Z.TEST({3,6,7,8,6,5,4,2,1,9},4,1)', 0.000252109114724508);

// =================================================================================
console.log('--- t ailesi ---');
// =================================================================================
s('T.DIST(1.5,10,TRUE)', 0.9177463367772805);
s('T.DIST(-1.5,10,TRUE)', 0.08225366322271951);
s('T.DIST(0,10,TRUE)', 0.5);
s('T.DIST(1.5,10,FALSE)', 0.1274447942894733, 1e-8);
hh('T.DIST(1.5,0,TRUE)', '#NUM!');
s('T.DIST.2T(1.96,60)', 0.0546449297365287);
s('T.DIST.2T(0,10)', 1);
hh('T.DIST.2T(-1,10)', '#NUM!');                 // iki kuyruklu sürüm negatif x almaz
s('T.DIST.RT(1.5,10)', 0.0822536632227195);
s('T.DIST.RT(-1.5,10)', 0.9177463367772805);     // sağ kuyruk negatif x KABUL EDER
s('TDIST(1.96,60,2)', 0.0546449297365287);
s('TDIST(1.96,60,1)', 0.0273224648682644);
hh('TDIST(-1.96,60,2)', '#NUM!');                // eski TDIST negatif x almaz
hh('TDIST(1.96,60,3)', '#NUM!');
s('T.INV(0.05,10)', -1.812461122811678);
s('T.INV(0.95,10)', 1.812461122811678);
s('T.INV(0.5,10)', 0);
hh('T.INV(0,10)', '#NUM!');
s('T.INV.2T(0.05,10)', 2.2281388519862757);      // iki kuyruk: T.INV(0,975;10) ile aynı
s('TINV(0.05,10)', 2.2281388519862757);
s('TINV(1,10)', 0);
hh('TINV(0,10)', '#NUM!');
s('T.INV(0.975,10)', 2.2281388519862757);        // eski TINV ile yeni T.INV ilişkisi
s('T.TEST({3,4,5,8,9,1,2,4,5},{6,19,3,2,14,4,5,17,1},2,1)', 0.1960157849252826);
s('TTEST({3,4,5,8,9,1,2,4,5},{6,19,3,2,14,4,5,17,1},1,1)', 0.0980078924626413);
s('T.TEST({3,4,5,8,9,1,2,4,5},{6,19,3,2,14,4,5,17,1},2,2)', 0.1919958867603977);
s('T.TEST({3,4,5,8,9,1,2,4,5},{6,19,3,2,14,4,5,17,1},2,3)', 0.2022939233686758);
hh('T.TEST({1,2,3},{1,2},2,1)', '#N/A');          // eşlenik sınama eşit uzunluk ister
hh('T.TEST({1,2,3},{1,2,3},3,1)', '#NUM!');
hh('T.TEST({1,2,3},{1,2,3},2,4)', '#NUM!');

// =================================================================================
console.log('--- F ve ki-kare aileleri ---');
// =================================================================================
s('F.DIST(1.5,5,10,TRUE)', 0.7267134845242298);
s('F.DIST(1.5,5,10,FALSE)', 0.2864586266644583, 1e-8);
s('F.DIST(0,5,10,TRUE)', 0);
hh('F.DIST(-1,5,10,TRUE)', '#NUM!');
hh('F.DIST(1,0,10,TRUE)', '#NUM!');
s('F.DIST.RT(1.5,5,10)', 0.2732865154757702);
s('FDIST(1.5,5,10)', 0.2732865154757702);         // eski FDIST de SAĞ kuyruk
s('FDIST(3.3258345304130104,5,10)', 0.05, 1e-8);
s('F.INV(0.7267134845242298,5,10)', 1.5, 1e-7);
s('F.INV.RT(0.05,5,10)', 3.3258345304130104, 1e-8);
s('FINV(0.05,5,10)', 3.3258345304130104, 1e-8);
hh('F.INV(1,5,10)', '#NUM!');
hh('F.INV.RT(0,5,10)', '#NUM!');
s('F.TEST({6,7,9,15,21},{20,28,31,38,40})', 0.6483178467861748);
s('FTEST({6,7,9,15,21},{20,28,31,38,40})', 0.6483178467861748);
hh('F.TEST({1},{1,2})', '#DIV/0!');
hh('F.TEST({2,2,2},{1,2,3})', '#DIV/0!');
s('CHISQ.DIST(3,4,TRUE)', 0.4421745996289254);
s('CHISQ.DIST(3,4,FALSE)', 0.1673476201113224);
s('CHISQ.DIST(0,4,TRUE)', 0);
hh('CHISQ.DIST(-1,4,TRUE)', '#NUM!');
hh('CHISQ.DIST(3,0,TRUE)', '#NUM!');
s('CHISQ.DIST.RT(18.307,10)', 0.0500005890913983);
s('CHIDIST(18.307,10)', 0.0500005890913983);      // CHIDIST sağ, CHISQ.DIST sol kuyruk
s('CHISQ.DIST(18.307,10,TRUE)', 0.9499994109086017);
s('CHISQ.INV(0.05,10)', 3.940299136580237, 1e-8);
s('CHISQ.INV.RT(0.05,10)', 18.307038053275146, 1e-8);
s('CHIINV(0.05,10)', 18.307038053275146, 1e-8);
s('CHISQ.INV(0,10)', 0);
hh('CHISQ.INV(1,10)', '#NUM!');
hh('CHIINV(-0.1,10)', '#NUM!');
s('CHISQ.TEST({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})', 0.0003081920170083);
s('CHITEST({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})', 0.0003081920170083);
hh('CHITEST({1,2;3,4},{1,2})', '#N/A');
hh('CHITEST({1,2},{1,0})', '#DIV/0!');            // beklenen sıfırsa bölme yok

// =================================================================================
console.log('--- gama, beta, Weibull, üstel ---');
// =================================================================================
s('GAMMA(5)', 24);
e('GAMMA(1)', 1);
s('GAMMA(2.5)', 1.3293403881791370, 1e-12);
s('GAMMA(-1.5)', 2.3632718012073548, 1e-12);
hh('GAMMA(0)', '#NUM!');
hh('GAMMA(-2)', '#NUM!');
s('GAMMALN(4)', 1.7917594692280550);
s('GAMMALN(1)', 0, 1e-12);
s('GAMMALN.PRECISE(4)', 1.7917594692280550);
hh('GAMMALN(0)', '#NUM!');
hh('GAMMALN(-1)', '#NUM!');
s('GAMMA.DIST(10,9,2,TRUE)', 0.0680936347218483);
s('GAMMA.DIST(10,9,2,FALSE)', 0.0326390196740794);
s('GAMMADIST(10,9,2,TRUE)', 0.0680936347218483);
s('GAMMA.DIST(0,9,2,TRUE)', 0);
hh('GAMMA.DIST(-1,9,2,TRUE)', '#NUM!');
hh('GAMMA.DIST(10,0,2,TRUE)', '#NUM!');
hh('GAMMA.DIST(10,9,0,TRUE)', '#NUM!');
s('GAMMA.INV(0.0680936347218483,9,2)', 10, 1e-7);
s('GAMMAINV(0.5,1,1)', 0.6931471805599453, 1e-8);
s('GAMMA.INV(0,9,2)', 0);
hh('GAMMA.INV(1.5,9,2)', '#NUM!');
s('BETA.DIST(2,8,10,TRUE,1,3)', 0.6854705810546875, 1e-8);
s('BETA.DIST(2,8,10,FALSE,1,3)', 1.4837646484375, 1e-8);
s('BETA.DIST(0.5,2,3,TRUE)', 0.6875, 1e-9);
s('BETADIST(2,8,10,1,3)', 0.6854705810546875, 1e-8);
s('BETADIST(0.5,2,3)', 0.6875, 1e-9);
hh('BETA.DIST(2,0,10,TRUE,1,3)', '#NUM!');
hh('BETA.DIST(0,8,10,TRUE,1,3)', '#NUM!');        // x, [A,B] dışında
hh('BETA.DIST(2,8,10,TRUE,3,1)', '#NUM!');        // A >= B
s('BETA.INV(0.6854705810546875,8,10,1,3)', 2, 1e-8);
s('BETAINV(0.6875,2,3)', 0.5, 1e-8);
s('BETA.INV(0.5,1,1)', 0.5, 1e-9);
hh('BETA.INV(0,8,10)', '#NUM!');
s('WEIBULL.DIST(105,20,100,TRUE)', 0.9295813900692769);
s('WEIBULL.DIST(105,20,100,FALSE)', 0.0355888640245043);
s('WEIBULL(105,20,100,TRUE)', 0.9295813900692769);
s('WEIBULL.DIST(0,2,1,TRUE)', 0);
hh('WEIBULL.DIST(-1,2,1,TRUE)', '#NUM!');
hh('WEIBULL.DIST(1,0,1,TRUE)', '#NUM!');
s('EXPON.DIST(0.2,10,TRUE)', 0.8646647167633873);
s('EXPON.DIST(0.2,10,FALSE)', 1.3533528323661270);
s('EXPONDIST(0.2,10,TRUE)', 0.8646647167633873);
s('EXPON.DIST(0,10,TRUE)', 0);
hh('EXPON.DIST(-1,10,TRUE)', '#NUM!');
hh('EXPON.DIST(1,0,TRUE)', '#NUM!');

// =================================================================================
console.log('--- kesikli dağılımlar ---');
// =================================================================================
e('BINOM.DIST(6,10,0.5,FALSE)', 0.205078125);     // tam birleşim sayısıyla TAM sonuç
e('BINOM.DIST(6,10,0.5,TRUE)', 0.828125);
e('BINOMDIST(6,10,0.5,FALSE)', 0.205078125);
e('BINOM.DIST(0,10,0,FALSE)', 1);                 // p = 0 uç durumu (log(0) yok)
e('BINOM.DIST(10,10,1,FALSE)', 1);
e('BINOM.DIST(3,10,1,FALSE)', 0);
hh('BINOM.DIST(11,10,0.5,FALSE)', '#NUM!');
hh('BINOM.DIST(-1,10,0.5,FALSE)', '#NUM!');
hh('BINOM.DIST(3,10,1.5,FALSE)', '#NUM!');
s('BINOM.DIST.RANGE(60,0.75,48)', 0.0839749674290491);
s('BINOM.DIST.RANGE(60,0.75,45,50)', 0.5236297934718107, 1e-8);
hh('BINOM.DIST.RANGE(60,0.75,50,45)', '#NUM!');
e('BINOM.INV(6,0.5,0.75)', 4);
e('CRITBINOM(6,0.5,0.75)', 4);
e('BINOM.INV(10,0.5,0.001)', 1);                  // birikim(0) = 0,0009766 < 0,001, eşiği 1 aşar
e('BINOM.INV(10,0.5,0.0009)', 0);
hh('BINOM.INV(6,0.5,0)', '#NUM!');
hh('CRITBINOM(6,0.5,1)', '#NUM!');
s('NEGBINOM.DIST(10,5,0.25,FALSE)', 0.0550486603751780);
s('NEGBINOM.DIST(10,5,0.25,TRUE)', 0.3135140584781770);
s('NEGBINOMDIST(10,5,0.25)', 0.0550486603751780);
hh('NEGBINOM.DIST(-1,5,0.25,FALSE)', '#NUM!');
hh('NEGBINOMDIST(10,0,0.25)', '#NUM!');
s('HYPGEOM.DIST(1,4,8,20,FALSE)', 0.3632610939112443);
s('HYPGEOM.DIST(1,4,8,20,TRUE)', 0.4654282765737822);
s('HYPGEOMDIST(1,4,8,20)', 0.3632610939112443);
hh('HYPGEOMDIST(5,4,8,20)', '#NUM!');             // örnekten fazla başarı olamaz
hh('HYPGEOMDIST(1,4,8,3)', '#NUM!');              // yığından büyük örnek
s('POISSON.DIST(2,5,TRUE)', 0.1246520194830810);
s('POISSON.DIST(2,5,FALSE)', 0.0842243374885682);
s('POISSON(2,5,TRUE)', 0.1246520194830810);
e('POISSON.DIST(0,0,FALSE)', 1);
hh('POISSON.DIST(-1,5,TRUE)', '#NUM!');
hh('POISSON.DIST(2,-5,TRUE)', '#NUM!');
e('PERMUT(5,2)', 20);
e('PERMUT(3,0)', 1);
hh('PERMUT(3,4)', '#NUM!');
e('PERMUTATIONA(3,2)', 9);
e('PERMUTATIONA(2,0)', 1);
hh('PERMUTATIONA(-1,2)', '#NUM!');

// =================================================================================
console.log('--- argüman sayısı, ad ve hata yayılımı ---');
// =================================================================================
hh('AVERAGE()', '#VALUE!');
hh('LARGE({1,2,3})', '#VALUE!');
hh('NORM.DIST(1,2,3)', '#VALUE!');
hh('NORMSDIST(1,2)', '#VALUE!');
hh('STANDARDIZE(1,2)', '#VALUE!');
hh('T.DIST(1,2)', '#VALUE!');
hh('GAMMA(1,2)', '#VALUE!');
hh('MEDIAN(1/0)', '#DIV/0!');
hh('STDEV({1,2},#N/A)', '#N/A');
hh('SUM({1,2})', '#NAME?');                       // başka kategorinin işlevi BURADA yok
hh('SUMIF({1,2},">1")', '#NAME?');
hh('AVERAGE(#REF!)', '#REF!');

// ---- kayıt bütünlüğü -------------------------------------------------------------
const ADLAR = [
  'AVERAGE', 'AVERAGEA', 'AVERAGEIF', 'AVERAGEIFS', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF',
  'COUNTIFS', 'MAX', 'MAXA', 'MAXIFS', 'MIN', 'MINA', 'MINIFS', 'MEDIAN', 'MODE', 'MODE.SNGL',
  'MODE.MULT', 'LARGE', 'SMALL', 'RANK', 'RANK.EQ', 'RANK.AVG', 'PERCENTILE', 'PERCENTILE.INC',
  'PERCENTILE.EXC', 'QUARTILE', 'QUARTILE.INC', 'QUARTILE.EXC', 'PERCENTRANK', 'PERCENTRANK.INC',
  'PERCENTRANK.EXC', 'STDEV', 'STDEV.S', 'STDEV.P', 'STDEVP', 'STDEVA', 'STDEVPA', 'VAR', 'VAR.S',
  'VAR.P', 'VARP', 'VARA', 'VARPA', 'DEVSQ', 'AVEDEV', 'GEOMEAN', 'HARMEAN', 'TRIMMEAN', 'SKEW',
  'SKEW.P', 'KURT', 'CORREL', 'COVAR', 'COVARIANCE.P', 'COVARIANCE.S', 'PEARSON', 'RSQ', 'SLOPE',
  'INTERCEPT', 'STEYX', 'FORECAST', 'FORECAST.LINEAR', 'TREND', 'GROWTH', 'LINEST', 'LOGEST',
  'FREQUENCY', 'PROB', 'STANDARDIZE', 'NORM.DIST', 'NORMDIST', 'NORM.INV', 'NORMINV',
  'NORM.S.DIST', 'NORMSDIST', 'NORM.S.INV', 'NORMSINV', 'LOGNORM.DIST', 'LOGNORMDIST',
  'LOGNORM.INV', 'LOGINV', 'T.DIST', 'T.DIST.2T', 'T.DIST.RT', 'TDIST', 'T.INV', 'T.INV.2T',
  'TINV', 'T.TEST', 'TTEST', 'F.DIST', 'F.DIST.RT', 'FDIST', 'F.INV', 'F.INV.RT', 'FINV',
  'F.TEST', 'FTEST', 'CHISQ.DIST', 'CHISQ.DIST.RT', 'CHIDIST', 'CHISQ.INV', 'CHISQ.INV.RT',
  'CHIINV', 'CHISQ.TEST', 'CHITEST', 'Z.TEST', 'ZTEST', 'CONFIDENCE', 'CONFIDENCE.NORM',
  'CONFIDENCE.T', 'BINOM.DIST', 'BINOMDIST', 'BINOM.DIST.RANGE', 'BINOM.INV', 'CRITBINOM',
  'NEGBINOM.DIST', 'NEGBINOMDIST', 'HYPGEOM.DIST', 'HYPGEOMDIST', 'POISSON.DIST', 'POISSON',
  'EXPON.DIST', 'EXPONDIST', 'GAMMA', 'GAMMA.DIST', 'GAMMADIST', 'GAMMA.INV', 'GAMMAINV',
  'GAMMALN', 'GAMMALN.PRECISE', 'BETA.DIST', 'BETADIST', 'BETA.INV', 'BETAINV', 'WEIBULL.DIST',
  'WEIBULL', 'FISHER', 'FISHERINV', 'GAUSS', 'PHI', 'PERMUT', 'PERMUTATIONA',
];
const eksik = ADLAR.filter(a => !X.bilinen(a));
ok('kayıt: ' + ADLAR.length + ' işlevin tamamı kayıtlı', eksik.length === 0, eksik.join(', '));

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
