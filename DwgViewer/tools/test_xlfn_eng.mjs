// Excel formül motoru — MÜHENDİSLİK ve VERİTABANI sınaması.
// Playwright kullanmaz; depo kökünden "node tools/test_xlfn_eng.mjs" ile koşar.
import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_eng.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// --------------------------------------------------------------------------------
// Sahte bağlam — A:D veritabanı, F:O ölçüt blokları
// --------------------------------------------------------------------------------
/*
 * "Elma" ile "Elmacık" bilerek yan yana duruyor: D* ailesinde düz metin ölçütü BAŞTAN
 * eşleşmedir, dolayısıyla "Elma" ölçütü "Elmacık"ı da toplar; ="Elma" ise toplamaz.
 * İki sonucun ayrışması bu kuralın sınamasıdır.
 */
const B = null;
const TABLO = [
  ['Ağaç', 'Boy', 'Yaş', 'Verim', B, 'Ağaç', 'Boy', 'Boy', B, 'Ağaç', 'Ağaç', 'Yaş', 'Ağaç', 'Yok', 'Yaş'],
  ['Elma', 18, 20, 14, B, 'Elma', '>10', '<16', B, 'Kiraz', '="Elma"', '>=15', 'Ce*', 'x', '>100'],
  ['Armut', 12, 12, 10, B, 'Armut', B, B, B, B, B, B, B, B, B],
  ['Kiraz', 13, 14, 9, B, B, B, B, B, B, B, B, B, B, B],
  ['Elma', 14, 15, 10, B, B, B, B, B, B, B, B, B, B, B],
  ['Armut', 9, 8, 8, B, B, B, B, B, B, B, B, B, B, B],
  ['Elma', 8, 9, 6, B, B, B, B, B, B, B, B, B, B, B],
  ['Ceviz', B, 30, B, B, B, B, B, B, B, B, B, B, B, B],
  ['Elma', 'yok', 11, 12, B, B, B, B, B, B, B, B, B, B, B],
  ['Elmacık', 20, 25, 30, B, B, B, B, B, B, B, B, B, B, B],
];
const ctx = {
  sayfa: 'S1',
  hucre: { r: 0, c: 0 },
  oku: (s, r, c) => { const t = TABLO[r]; if (!t) return null; const v = t[c]; return v === undefined ? null : v; },
  boyut: () => ({ r: TABLO.length, c: TABLO[0].length }),
  simdi: () => 46000.5,
  rastgele: () => 0.5,
};

const h = (f) => X.hesapla(f, ctx);
const yak = (v, b, t = 1e-9) => typeof v === 'number' && Math.abs(v - b) <= t * Math.max(1, Math.abs(b));
const hataMi = (v, kod) => X.hata(v) && v.e === kod;
const gor = (v) => (X.hata(v) ? v.e : JSON.stringify(v));
/** sayı beklentisi */
const S = (f, b, t) => { const v = h(f); ok(f + ' = ' + b, yak(v, b, t), '→ ' + gor(v)); };
/** metin / mantık beklentisi (tam eşitlik) */
const M = (f, b) => { const v = h(f); ok(f + ' = ' + JSON.stringify(b), v === b, '→ ' + gor(v)); };
/** hata beklentisi */
const H = (f, kod) => { const v = h(f); ok(f + ' = ' + kod, hataMi(v, kod), '→ ' + gor(v)); };

// ================================================================================
// 1 · Sayı tabanı çevirimi
// ================================================================================
M('=DEC2BIN(9)', '1001');
M('=DEC2BIN(0)', '0');
M('=DEC2BIN(0,4)', '0000');
M('=DEC2BIN(100,8)', '01100100');
M('=DEC2BIN(511)', '111111111');
M('=DEC2BIN(-1)', '1111111111');            // ikiye tümleyen alanı doldurur
M('=DEC2BIN(-100)', '1110011100');
M('=DEC2BIN(-512)', '1000000000');
M('=DEC2BIN(-100,3)', '1110011100');        // negatifte `yer` yok sayılır
M('=DEC2BIN(9.9)', '1001');                 // kesir kırpılır
H('=DEC2BIN(512)', '#NUM!');
H('=DEC2BIN(-513)', '#NUM!');
H('=DEC2BIN(2,1)', '#NUM!');                // yer, gereken basamaktan az
H('=DEC2BIN(2,-1)', '#NUM!');
H('=DEC2BIN(2,11)', '#NUM!');               // alan en çok 10 basamak
H('=DEC2BIN("abc")', '#VALUE!');
M('=DEC2OCT(58)', '72');
M('=DEC2OCT(58,3)', '072');
M('=DEC2OCT(-100)', '7777777634');
H('=DEC2OCT(536870912)', '#NUM!');
M('=DEC2HEX(100)', '64');
M('=DEC2HEX(28,4)', '001C');
M('=DEC2HEX(-54)', 'FFFFFFFFCA');
M('=DEC2HEX(255)', 'FF');
H('=DEC2HEX(549755813888)', '#NUM!');
S('=BIN2DEC(1100100)', 100);
S('=BIN2DEC(1111111111)', -1);              // 10 karakterde ilk basamak İŞARET bitidir
S('=BIN2DEC(111111111)', 511);
S('=BIN2DEC(1000000000)', -512);
S('=BIN2DEC("")', 0);
H('=BIN2DEC(2)', '#NUM!');
H('=BIN2DEC(11111111111)', '#NUM!');        // 11 karakter
M('=BIN2OCT(1001)', '11');
M('=BIN2OCT(1001,3)', '011');
M('=BIN2OCT(1111111111)', '7777777777');
M('=BIN2HEX(11111011,4)', '00FB');
M('=BIN2HEX(1111111111)', 'FFFFFFFFFF');
S('=OCT2DEC(54)', 44);
S('=OCT2DEC(7777777533)', -165);
H('=OCT2DEC(8)', '#NUM!');
M('=OCT2BIN(3,3)', '011');
M('=OCT2BIN(7777777000)', '1000000000');
H('=OCT2BIN(1000)', '#NUM!');               // 512, ikilik alana sığmaz
M('=OCT2HEX(100,4)', '0040');
S('=HEX2DEC("A5")', 165);
S('=HEX2DEC("FFFFFFFFFF")', -1);
S('=HEX2DEC("3DA408B9")', 1034160313);
S('=HEX2DEC("a5")', 165);                   // küçük harf de geçerli
H('=HEX2DEC("XY")', '#NUM!');
M('=HEX2BIN("F",8)', '00001111');
M('=HEX2BIN("B7")', '10110111');
H('=HEX2BIN("FFF")', '#NUM!');
M('=HEX2OCT("F",3)', '017');
M('=HEX2OCT("FFFFFFFF00")', '7777777400');

// ================================================================================
// 2 · Bit işlemleri
// ================================================================================
S('=BITAND(13,25)', 9);
S('=BITAND(23,10)', 2);
S('=BITOR(23,10)', 31);
S('=BITXOR(5,3)', 6);
S('=BITLSHIFT(4,2)', 16);
S('=BITLSHIFT(4,-2)', 1);                   // negatif kaydırma ters yöne gider
S('=BITRSHIFT(13,2)', 3);
S('=BITRSHIFT(13,-2)', 52);
S('=BITAND(281474976710655,281474976710655)', 281474976710655);
S('=BITXOR(140737488355328,1)', 140737488355329);   // 32 biti aşan alan
H('=BITAND(-1,1)', '#NUM!');
H('=BITAND(1.5,1)', '#NUM!');
H('=BITOR(281474976710656,1)', '#NUM!');
H('=BITLSHIFT(1,54)', '#NUM!');
H('=BITRSHIFT(1,-54)', '#NUM!');
H('=BITAND("x",1)', '#VALUE!');

// ================================================================================
// 3 · Eşik işlevleri
// ================================================================================
S('=DELTA(5,4)', 0);
S('=DELTA(5,5)', 1);
S('=DELTA(0.5,0)', 0);
S('=DELTA(0)', 1);                          // ikinci argüman verilmezse 0
S('=GESTEP(5,4)', 1);
S('=GESTEP(5,5)', 1);                       // eşitlik de "eşik üstü" sayılır
S('=GESTEP(-4,-5)', 1);
S('=GESTEP(-1)', 0);
H('=DELTA("x")', '#VALUE!');

// ================================================================================
// 4 · Hata işlevi
// ================================================================================
S('=ERF(0)', 0);
S('=ERF(0.745)', 0.7079289200957377, 1e-13);
S('=ERF(1)', 0.8427007929497149, 1e-13);
S('=ERF(2)', 0.9953222650189527, 1e-13);
S('=ERF(-1)', -0.8427007929497149, 1e-13);  // Excel 2010'dan bu yana negatif de geçerli
S('=ERF(1,2)', 0.15262147206923772, 1e-12);
S('=ERF.PRECISE(1)', 0.8427007929497149, 1e-13);
S('=ERFC(0)', 1);
S('=ERFC(1)', 0.15729920705028513, 1e-13);
S('=ERFC(2)', 0.004677734981047266, 1e-13);
S('=ERFC(3)', 2.2090496998585441e-5, 1e-13);
S('=ERFC(5)', 1.5374597944280351e-12, 1e-12);
S('=ERFC(-1)', 1.8427007929497149, 1e-13);
S('=ERFC.PRECISE(1)', 0.15729920705028513, 1e-13);
ok('ERF(x) + ERFC(x) = 1', yak(h('=ERF(1.7)') + h('=ERFC(1.7)'), 1, 1e-14));
H('=ERF("x")', '#VALUE!');

// ================================================================================
// 5 · Bessel
// ================================================================================
S('=BESSELI(1,0)', 1.2660658777520084, 1e-13);
S('=BESSELI(1,1)', 0.5651591039924851, 1e-13);
S('=BESSELI(1.5,1)', 0.9816664285779074, 1e-13);
S('=BESSELI(2,0)', 2.2795853023360673, 1e-13);
S('=BESSELI(0,0)', 1);
S('=BESSELI(0,1)', 0);
S('=BESSELJ(0,0)', 1);
S('=BESSELJ(1,0)', 0.7651976865579666, 1e-13);
S('=BESSELJ(1,1)', 0.4400505857449335, 1e-13);
S('=BESSELJ(1.9,2)', 0.3299257276923871, 1e-12);
S('=BESSELJ(5,0)', -0.1775967713143383, 1e-12);
S('=BESSELJ(20,0)', 0.1670246643405831, 1e-11);   // Miller aşağı yinelemesi
S('=BESSELJ(-1,1)', -0.4400505857449335, 1e-13);  // J_n(-x) = (-1)^n J_n(x)
S('=BESSELK(1,0)', 0.4210244382407083, 1e-13);
S('=BESSELK(1,1)', 0.6019072301972346, 1e-13);
S('=BESSELK(1.5,1)', 0.2773878004568438, 1e-13);
S('=BESSELK(2,0)', 0.1138938727495334, 1e-12);    // seri / sürekli kesir sınırı
S('=BESSELK(5,1)', 0.004044613445452164, 1e-12);
S('=BESSELY(1,0)', 0.0882569642156770, 1e-12);
S('=BESSELY(1,1)', -0.7812128213002887, 1e-13);
S('=BESSELY(2,0)', 0.5103756726497451, 1e-13);
S('=BESSELY(2.5,1)', 0.1459181379667858, 1e-12);
H('=BESSELJ(1,-1)', '#NUM!');
H('=BESSELK(0,1)', '#NUM!');                // K ve Y sıfırda tekildir
H('=BESSELY(0,0)', '#NUM!');
H('=BESSELY(-1,0)', '#NUM!');
H('=BESSELI("x",0)', '#VALUE!');
// Bağımsız özdeşlik denetimleri (yaklaşımın kendisinden bağımsız doğrular)
ok('Wronski J1·Y0 − J0·Y1 = 2/(πx), x=3',
  yak(h('=BESSELJ(3,1)') * h('=BESSELY(3,0)') - h('=BESSELJ(3,0)') * h('=BESSELY(3,1)'), 2 / (Math.PI * 3), 1e-12));
ok('Wronski, x=15 (asimptotik bölge)',
  yak(h('=BESSELJ(15,1)') * h('=BESSELY(15,0)') - h('=BESSELJ(15,0)') * h('=BESSELY(15,1)'), 2 / (Math.PI * 15), 1e-11));
ok('J yinelemesi J0(5)+J2(5) = (2/5)·J1(5)',
  yak(h('=BESSELJ(5,0)') + h('=BESSELJ(5,2)'), (2 / 5) * h('=BESSELJ(5,1)'), 1e-11));
ok('I yinelemesi I0(3)−I2(3) = (2/3)·I1(3)',
  yak(h('=BESSELI(3,0)') - h('=BESSELI(3,2)'), (2 / 3) * h('=BESSELI(3,1)'), 1e-12));
ok('K yinelemesi K2(2)−K0(2) = K1(2)',
  yak(h('=BESSELK(2,2)') - h('=BESSELK(2,0)'), h('=BESSELK(2,1)'), 1e-12));
ok('Y yinelemesi Y0(4)+Y2(4) = (2/4)·Y1(4)',
  yak(h('=BESSELY(4,0)') + h('=BESSELY(4,2)'), (2 / 4) * h('=BESSELY(4,1)'), 1e-11));

// ================================================================================
// 6 · CONVERT
// ================================================================================
S('=CONVERT(1,"lbm","kg")', 0.45359237, 1e-14);
S('=CONVERT(1,"kg","lbm")', 2.2046226218487757, 1e-12);
S('=CONVERT(1,"stone","lbm")', 14);
S('=CONVERT(1,"uk_ton","lbm")', 2240);
S('=CONVERT(1,"mi","ft")', 5280, 1e-12);
S('=CONVERT(1,"m","km")', 0.001, 1e-14);
S('=CONVERT(1,"nm","ang")', 10, 1e-12);
S('=CONVERT(1,"ly","m")', 9460730472580800);
S('=CONVERT(1,"Pica","pica")', 1 / 12, 1e-14);   // BÜYÜK/küçük harf ayrı birimdir
S('=CONVERT(1,"day","hr")', 24);
S('=CONVERT(1,"yr","day")', 365.25, 1e-13);
S('=CONVERT(1,"atm","Pa")', 101325);
S('=CONVERT(1,"N","dyn")', 100000, 1e-12);
S('=CONVERT(1,"BTU","J")', 1055.05585262, 1e-13);
S('=CONVERT(1,"HP","W")', 745.69987158227, 1e-12);
S('=CONVERT(1,"T","ga")', 10000, 1e-12);
S('=CONVERT(1,"gal","l")', 3.785411784, 1e-14);
S('=CONVERT(1,"m3","l")', 1000, 1e-12);
S('=CONVERT(1,"m3","cm3")', 1000000, 1e-12);     // önek KÜPTEN girer
S('=CONVERT(1,"cm2","mm2")', 100, 1e-12);
S('=CONVERT(1,"m2","ft2")', 10.7639104167097, 1e-12);
S('=CONVERT(1,"ha","m2")', 10000);
S('=CONVERT(1,"Gbit","bit")', 1e9);
S('=CONVERT(1,"kibyte","byte")', 1024);          // ikili önek yalnız bit / byte'a uygulanır
S('=CONVERT(1,"Mibyte","byte")', 1048576);
S('=CONVERT(1,"kn","m/s")', 0.5144444444444445, 1e-13);
S('=CONVERT(1,"mph","m/s")', 0.44704, 1e-14);
S('=CONVERT(68,"F","C")', 20, 1e-12);            // ÖTELEMELİ çevirim
S('=CONVERT(100,"C","F")', 212, 1e-12);
S('=CONVERT(0,"C","K")', 273.15, 1e-13);
S('=CONVERT(32,"F","K")', 273.15, 1e-13);
S('=CONVERT(80,"Reau","C")', 100, 1e-12);
S('=CONVERT(491.67,"Rank","C")', 0, 1e-9);
H('=CONVERT(2.5,"ft","sec")', '#N/A');           // aileler ayrı
H('=CONVERT(1,"XYZ","m")', '#N/A');
H('=CONVERT(1,"KG","g")', '#N/A');               // birim adı harf duyarlıdır
H('=CONVERT("x","m","km")', '#VALUE!');

// ================================================================================
// 7 · Karmaşık sayılar
// ================================================================================
M('=COMPLEX(3,4)', '3+4i');
M('=COMPLEX(3,4,"j")', '3+4j');
M('=COMPLEX(0,1)', 'i');                    // katsayısı 1 olan sanal birim yalın yazılır
M('=COMPLEX(0,-1)', '-i');
M('=COMPLEX(3,-1)', '3-i');
M('=COMPLEX(3,1)', '3+i');
M('=COMPLEX(3,0)', '3');
M('=COMPLEX(0,0)', '0');
M('=COMPLEX(-2.5,-3.5)', '-2.5-3.5i');
H('=COMPLEX(1,1,"I")', '#VALUE!');          // yalnız küçük harf
H('=COMPLEX(1,1,"k")', '#VALUE!');
S('=IMABS("5+12i")', 13);
S('=IMABS("3+4i")', 5);
S('=IMAGINARY("3+4i")', 4);
S('=IMAGINARY("i")', 1);
S('=IMAGINARY("-i")', -1);
S('=IMAGINARY("6")', 0);
S('=IMAGINARY("-3.5e-2i")', -0.035, 1e-14); // 'e-2' üstel parçadır, işaret ayracı değil
S('=IMREAL("6-9i")', 6);
S('=IMREAL("-3.5e2+1i")', -350, 1e-13);
S('=IMREAL("i")', 0);
S('=IMARGUMENT("3+4i")', 0.9272952180016122, 1e-13);
H('=IMARGUMENT("0")', '#DIV/0!');
M('=IMCONJUGATE("3+4i")', '3-4i');
M('=IMCONJUGATE("3-4j")', '3+4j');
M('=IMSUM("3+4i","5-3i")', '8+i');
M('=IMSUM("1","2")', '3');
M('=IMSUM("3+4j","5")', '8+4j');            // sanal birim harfi taşınır
M('=IMSUB("13+4j","5+3j")', '8+j');
M('=IMSUB("5","3")', '2');
M('=IMPRODUCT("3+4i","5-3i")', '27+11i');
M('=IMPRODUCT("1+2i","30+2i")', '26+62i');
M('=IMDIV("-238+240i","10+24i")', '5+12i');
M('=IMPOWER("2+3i",3)', '-46+9.00000000000001i');   // Excel'in kendi çıktısı da böyledir
M('=IMSQRT("1+i")', '1.09868411346781+0.455089860562227i');
M('=IMEXP("1+i")', '1.46869393991589+2.28735528717884i');
M('=IMLN("3+4i")', '1.6094379124341+0.927295218001612i');
M('=IMLOG10("3+4i")', '0.698970004336019+0.402719196273373i');
M('=IMLOG2("3+4i")', '2.32192809488736+1.33780421245098i');
M('=IMSIN("3+4i")', '3.85373803791938-27.0168132580039i');
M('=IMCOS("1+i")', '0.833730025131149-0.988897705762865i');
M('=IMSINH("4+3i")', '-27.0168132580039+3.85373803791938i');
M('=IMCOSH("4+3i")', '-27.0349456030742+3.85115333481178i');
H('=IMSUM("1+i","1+j")', '#VALUE!');        // iki ayrı sanal birim harfi karıştırılamaz
H('=IMREAL("abc")', '#NUM!');
H('=IMABS("3+4k")', '#NUM!');
H('=IMDIV("1","0")', '#NUM!');
H('=IMLN("0")', '#NUM!');
H('=IMLOG10("0")', '#NUM!');
H('=IMLOG2("0")', '#NUM!');
H('=IMCSC("0")', '#NUM!');
H('=IMCOT("0")', '#NUM!');
H('=IMCSCH("0")', '#NUM!');
H('=IMPOWER("0",-1)', '#NUM!');
M('=IMPOWER("0",2)', '0');
// Karmaşık işlevlerin özdeşlik denetimleri
/*
 * IMSQRT("-4") TAM "2i" DEĞİLDİR. Kök kutupsal biçimden alınır ve cos(π/2) makinede sıfır
 * değil 6,12e-17'dir; gerçek kısımda 1,22464679914735E-16 kalır. Excel de aynısını verir
 * (IMPOWER("2+3i";3) = "-46+9,00000000000001i" ile aynı nedenle) — düzeltilecek bir kusur
 * değil, Excel'le birebir örtüşmedir.
 */
M('=IMSQRT("-4")', '1.22464679914735E-16+2i');
M('=IMEXP(IMLN("3+4i"))', '3+4i');
ok('IMPRODUCT(z, IMCONJUGATE(z)) gerçeldir', h('=IMPRODUCT("3+4i","3-4i")') === '25');
ok('IMSEC = 1/IMCOS',
  yak(X.num(h('=IMREAL(IMSEC("4+3i"))')), -0.065294027857947, 1e-12));
ok('IMCSC("4+3i") gerçel kısmı',
  yak(X.num(h('=IMREAL(IMCSC("4+3i"))')), -0.0754898329158637, 1e-12));
ok('IMTAN = IMSIN/IMCOS',
  yak(X.num(h('=IMREAL(IMTAN("4+3i"))')), 0.00490825806749599, 1e-11));
ok('IMCOT("4+3i") sanal kısmı',
  yak(X.num(h('=IMAGINARY(IMCOT("4+3i"))')), -0.999266927805902, 1e-12));
ok('IMSECH("4+3i") gerçel kısmı',
  yak(X.num(h('=IMREAL(IMSECH("4+3i"))')), -0.0362534969158689, 1e-12));
ok('IMCSCH("4+3i") sanal kısmı',
  yak(X.num(h('=IMAGINARY(IMCSCH("4+3i"))')), -0.0051744731840194, 1e-11));
ok('IMCOSH² − IMSINH² = 1',
  yak(X.num(h('=IMREAL(IMSUB(IMPRODUCT(IMCOSH("1+2i"),IMCOSH("1+2i")),IMPRODUCT(IMSINH("1+2i"),IMSINH("1+2i"))))')), 1, 1e-12));

// ================================================================================
// 8 · Veritabanı ailesi
// ================================================================================
S('=DSUM(A1:D10,"Verim",F1:F2)', 72);          // "Elma" BAŞTAN eşleşir: Elmacık da girer
S('=DSUM(A1:D10,"Verim",K1:K2)', 42);          // ="Elma" TAM eşleşir: Elmacık girmez
S('=DSUM(A1:D10,4,F1:F2)', 72);                // alan sıra numarasıyla
S('=DSUM(A1:D10,D1,F1:F2)', 72);               // alan başlık hücresine başvuruyla
S('=DSUM(A1:D10,"verim",F1:F2)', 72);          // alan adı harf duymaz
S('=DSUM(A1:D10,"Verim",F1:F4)', 99);          // boş ölçüt satırı BÜTÜN kayıtları eşler
S('=DSUM(A1:D10,"Verim",F1:H2)', 10);          // aynı satır: VE
S('=DSUM(A1:D10,"Verim",F1:F3)', 90);          // ayrı satırlar: VEYA
S('=DSUM(A1:D10,"Verim",L1:L2)', 54);          // sayısal ölçüt
S('=DSUM(A1:D10,"Verim",M1:M2)', 0);           // joker ölçüt, alanı boş tek kayıt
S('=DSUM(A1:D10,"Verim",O1:O2)', 0);           // eşleşme yok
S('=DSUM(A1:D10,"Ağaç",F1:F2)', 0);            // metin alanının toplamı sıfırdır
S('=DCOUNT(A1:D10,"Yaş",F1:F2)', 5);
S('=DCOUNT(A1:D10,"Boy",F1:F2)', 4);           // "yok" metindir, sayılmaz
S('=DCOUNT(A1:D10,,F1:F2)', 5);                // alan atlanınca KAYIT sayısı
S('=DCOUNT(A1:D10,"Verim",L1:L2)', 3);         // boş hücre sayılmaz
S('=DCOUNT(A1:D10,"Verim",O1:O2)', 0);
S('=DCOUNTA(A1:D10,"Boy",F1:F2)', 5);
S('=DCOUNTA(A1:D10,"Verim",L1:L2)', 3);
S('=DCOUNTA(A1:D10,,F1:F2)', 5);
S('=DCOUNTA(A1:D10,"Ağaç",F1:F4)', 9);
S('=DAVERAGE(A1:D10,"Yaş",F1:F2)', 16);
S('=DAVERAGE(A1:D10,"Verim",L1:L2)', 18);      // boş hücre PAYDAYA katılmaz
H('=DAVERAGE(A1:D10,"Verim",O1:O2)', '#DIV/0!');
S('=DMAX(A1:D10,"Verim",F1:F3)', 30);
S('=DMIN(A1:D10,"Verim",F1:F3)', 6);
S('=DMAX(A1:D10,"Boy",L1:L2)', 20);
S('=DMIN(A1:D10,"Boy",L1:L2)', 14);
S('=DMAX(A1:D10,"Verim",O1:O2)', 0);
S('=DPRODUCT(A1:D10,"Verim",F1:F2)', 302400);
S('=DPRODUCT(A1:D10,"Verim",O1:O2)', 0);
S('=DGET(A1:D10,"Verim",J1:J2)', 9);
S('=DGET(A1:D10,"Boy",J1:J2)', 13);
S('=DGET(A1:D10,D1,J1:J2)', 9);
S('=DGET(A1:D10,"Yaş",M1:M2)', 30);
S('=DGET(A1:D10,"Verim",F1:H2)', 10);
H('=DGET(A1:D10,"Verim",F1:F2)', '#NUM!');     // birden çok eşleşme
H('=DGET(A1:D10,"Verim",O1:O2)', '#VALUE!');   // eşleşme yok
S('=DVAR(A1:D10,"Verim",F1:F3)', 63.8095238095238, 1e-12);
S('=DVARP(A1:D10,"Verim",F1:F3)', 54.69387755102041, 1e-12);
S('=DSTDEV(A1:D10,"Verim",F1:F3)', 7.988086367179802, 1e-12);
S('=DSTDEVP(A1:D10,"Verim",F1:F3)', 7.395530917454162, 1e-12);
H('=DSTDEV(A1:D10,"Verim",J1:J2)', '#DIV/0!'); // örneklem sapması en az iki değer ister
S('=DSTDEVP(A1:D10,"Verim",J1:J2)', 0);
H('=DVAR(A1:D10,"Verim",O1:O2)', '#DIV/0!');
H('=DSUM(A1:D10,"Yok Böyle",F1:F2)', '#VALUE!');
H('=DSUM(A1:D10,9,F1:F2)', '#VALUE!');         // alan sırası aralık dışı
H('=DSUM(A1:D10,"Verim",N1:N2)', '#VALUE!');   // ölçüt başlığı veritabanında yok
S('=DCOUNT(A1:D10,"Verim",F1:F1)', 0);         // ölçüt aralığında veri satırı yok
H('=DGET(A1:D10,,J1:J2)', '#VALUE!');          // DGET alan ister

// ================================================================================
// 9 · Kayıt bütünlüğü
// ================================================================================
const ADLAR = [
  'DEC2BIN', 'DEC2OCT', 'DEC2HEX', 'BIN2DEC', 'BIN2OCT', 'BIN2HEX', 'OCT2DEC', 'OCT2BIN',
  'OCT2HEX', 'HEX2DEC', 'HEX2BIN', 'HEX2OCT', 'BITAND', 'BITOR', 'BITXOR', 'BITLSHIFT',
  'BITRSHIFT', 'DELTA', 'GESTEP', 'ERF', 'ERFC', 'ERF.PRECISE', 'ERFC.PRECISE', 'BESSELI',
  'BESSELJ', 'BESSELK', 'BESSELY', 'CONVERT', 'COMPLEX', 'IMABS', 'IMAGINARY', 'IMREAL',
  'IMARGUMENT', 'IMCONJUGATE', 'IMSUM', 'IMSUB', 'IMPRODUCT', 'IMDIV', 'IMPOWER', 'IMSQRT',
  'IMEXP', 'IMLN', 'IMLOG10', 'IMLOG2', 'IMSIN', 'IMCOS', 'IMTAN', 'IMCSC', 'IMSEC', 'IMCOT',
  'IMSINH', 'IMCOSH', 'IMSECH', 'IMCSCH', 'DSUM', 'DAVERAGE', 'DCOUNT', 'DCOUNTA', 'DGET',
  'DMAX', 'DMIN', 'DPRODUCT', 'DSTDEV', 'DSTDEVP', 'DVAR', 'DVARP',
];
ok('kapsamdaki ' + ADLAR.length + ' işlevin tamamı kayıtlı',
  ADLAR.every((a) => X.bilinen(a)), '→ eksik: ' + ADLAR.filter((a) => !X.bilinen(a)).join(', '));
ok('ağ isteyen işlevler kaydedilmedi (#NAME? verirler)',
  !X.bilinen('WEBSERVICE') && !X.bilinen('FILTERXML') && !X.bilinen('RTD'));
ok('_xlfn öneki soyuluyor (_xlfn.ERF.PRECISE)', yak(h('=_xlfn.ERF.PRECISE(1)'), 0.8427007929497149, 1e-13));
H('=BITAND(1)', '#VALUE!');                    // eksik argüman
H('=DELTA(1,2,3)', '#VALUE!');                 // fazla argüman
ok('hata argümanı yayılır', hataMi(h('=DEC2BIN(1/0)'), '#DIV/0!'));

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
