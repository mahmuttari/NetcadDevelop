// Excel formül motoru — MATEMATİK ve TRİGONOMETRİ sınaması.
// Playwright kullanmaz; depo kökünden "node tools/test_xlfn_math.mjs" ile koşar.
import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_math.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// --------------------------------------------------------------------------------
// Sahte bağlam: iki sayfa, gizli satır ve formül okuma yeteneği
// --------------------------------------------------------------------------------
const SAYFA = {
  S1: [
    [1, '3', true, null],
    [2, null, 4, 5],
    [-5, 10, 'x', 7],
    [3, 6, 9, 2],
    [8, 4, 1, 6],
    [10, 2, 5, 3],
  ],
  Sayfa2: [[5], [10], [15], [20]],
};
// Sayfa2!A3 kendisi bir SUBTOTAL'dir: dıştaki SUBTOTAL onu saymamalı.
const FORMUL = { 'Sayfa2|2|0': '=SUBTOTAL(9,A1:A2)' };
// Sayfa2'nin 4. satırı gizli: 109 onu atlar, 9 atlamaz.
const GIZLI = { 'Sayfa2|3': true };

const ctx = {
  sayfa: 'S1',
  hucre: { r: 0, c: 0 },
  oku: (s, r, c) => { const t = SAYFA[s || 'S1']; if (!t || !t[r]) return null; const v = t[r][c]; return v === undefined ? null : v; },
  boyut: (s) => { const t = SAYFA[s || 'S1'] || []; return { r: t.length, c: t.length ? t[0].length : 0 }; },
  formul: (s, r, c) => FORMUL[(s || 'S1') + '|' + r + '|' + c] || null,
  gizliSatir: (s, r) => !!GIZLI[(s || 'S1') + '|' + r],
  simdi: () => 46000.5,
  rastgele: () => 0.5,
};

const h = (f) => X.hesapla(f, ctx);
const yak = (v, b, t = 1e-9) => typeof v === 'number' && Math.abs(v - b) <= t * Math.max(1, Math.abs(b));
const hataMi = (v, kod) => X.hata(v) && v.e === kod;
const gor = (v) => (X.hata(v) ? v.e : JSON.stringify(v));
function dz(v, b, t = 1e-9) {
  if (!Array.isArray(v) || v.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (!Array.isArray(v[i]) || v[i].length !== b[i].length) return false;
    for (let j = 0; j < b[i].length; j++) {
      const x = v[i][j], y = b[i][j];
      if (typeof y === 'number') { if (!yak(x, y, t)) return false; } else if (x !== y) return false;
    }
  }
  return true;
}
/** sayı beklentisi */
const S = (f, b, t) => { const v = h(f); ok(f + ' = ' + b, yak(v, b, t), '→ ' + gor(v)); };
/** metin / mantık beklentisi */
const M = (f, b) => { const v = h(f); ok(f + ' = ' + JSON.stringify(b), v === b, '→ ' + gor(v)); };
/** hata beklentisi */
const H = (f, kod) => { const v = h(f); ok(f + ' = ' + kod, hataMi(v, kod), '→ ' + gor(v)); };
/** dizi beklentisi */
const D = (f, b) => { const v = h(f); ok(f + ' = ' + JSON.stringify(b), dz(v, b), '→ ' + gor(v)); };

// --------------------------------------------------------------------------------
// Toplama ailesi
// --------------------------------------------------------------------------------
S('=SUM(1,2,3)', 6);
S('=SUM("3",1)', 4);                  // doğrudan yazılan metin ÇEVRİLİR
S('=SUM({1,"3",TRUE})', 1);           // dizi içindeki metin ve mantık ATLANIR
S('=SUM(A1:C1)', 1);                  // aralıkta 1, "3", DOĞRU → yalnız 1
S('=SUM(B1,1)', 1);                   // B1 = "3" başvurudur, atlanır
S('=SUM(C1,1)', 1);                   // C1 = DOĞRU başvurudur, atlanır
S('=SUM(TRUE,1)', 2);                 // doğrudan yazılan mantık çevrilir
S('=SUM(A1:A6)', 19);
S('=SUM(1,,2)', 3);
S('=SUM(A1:A6,B1:B6)', 41);
H('=SUM()', '#VALUE!');
H('=SUM("abc",1)', '#VALUE!');
S('=SUMSQ(3,4)', 25);
S('=SUMSQ({1,2,3})', 14);
S('=PRODUCT(2,3,4)', 24);
S('=PRODUCT(B1:B2)', 0);              // aralıkta hiç sayı yoksa 0
S('=PRODUCT(A1:A6)', 1 * 2 * -5 * 3 * 8 * 10);
S('=SUMIF(A1:A6,">2")', 21);
S('=SUMIF(A1:A6,">2",D1:D6)', 11);
S('=SUMIF({1,2,3},"<>2")', 4);
S('=SUMIF({1,2,3},2)', 2);
S('=SUMIF({"elma","armut","ela"},"e*")', 0);
S('=SUMIF({"elma","armut","ela"},"e*",{1,2,4})', 5);
S('=SUMIFS(A1:A6,A1:A6,">0",D1:D6,">1")', 23);
S('=SUMIFS({1,2,3,4},{1,2,3,4},">1",{5,5,6,6},6)', 7);
H('=SUMIFS({1,2},{1,2},">1",{1,2})', '#VALUE!');
S('=SUMPRODUCT({1,2,3},{4,5,6})', 32);
S('=SUMPRODUCT({1,2,3})', 6);
S('=SUMPRODUCT({1,TRUE,"2"})', 1);    // sayı olmayan her şey 0 sayılır
H('=SUMPRODUCT({1,2},{1,2,3})', '#VALUE!');
S('=SUMX2MY2({2,3},{1,2})', 8);
S('=SUMX2PY2({2,3},{1,2})', 18);
S('=SUMXMY2({2,3},{1,2})', 2);
H('=SUMX2MY2({1,2},{1})', '#N/A');
S('=SUMXMY2({1,"a",3},{1,2,5})', 4);  // eşlerden biri sayı değilse çift atlanır

// --------------------------------------------------------------------------------
// İşaret, tam sayı, kesme
// --------------------------------------------------------------------------------
S('=ABS(-5)', 5);
S('=ABS(0)', 0);
H('=ABS("abc")', '#VALUE!');
H('=ABS()', '#VALUE!');
H('=ABS(1,2)', '#VALUE!');
D('=ABS({-1,2,-3})', [[1, 2, 3]]);
S('=SIGN(-3)', -1);
S('=SIGN(0)', 0);
S('=SIGN(2.5)', 1);
S('=INT(8.9)', 8);
S('=INT(-8.9)', -9);                  // INT AŞAĞI yuvarlar
S('=TRUNC(-8.9)', -8);                // TRUNC SIFIRA doğru keser
S('=TRUNC(8.567,2)', 8.56);
S('=TRUNC(123,-1)', 120);

// --------------------------------------------------------------------------------
// Yuvarlama
// --------------------------------------------------------------------------------
S('=ROUND(2.5,0)', 3);
S('=ROUND(-2.5,0)', -3);              // yarım SIFIRDAN UZAĞA
S('=ROUND(2.675,2)', 2.68);           // ikilik artık 2,67'ye düşürmemeli
S('=ROUND(1234.5678,-2)', 1200);
S('=ROUND(0.5,0)', 1);
S('=ROUND(-0.5,0)', -1);
H('=ROUND(2.5)', '#VALUE!');
S('=ROUNDUP(3.14159,3)', 3.142);
S('=ROUNDUP(-3.2,0)', -4);
S('=ROUNDDOWN(3.14159,3)', 3.141);
S('=ROUNDDOWN(-3.9,0)', -3);
S('=MROUND(10,3)', 9);
S('=MROUND(-10,-3)', -9);
S('=MROUND(1.3,0.2)', 1.4);
S('=MROUND(5,0)', 0);
H('=MROUND(5,-2)', '#NUM!');
H('=MROUND(-5,2)', '#NUM!');

S('=CEILING(2.5,1)', 3);
S('=CEILING(2.5,0.1)', 2.5);
S('=CEILING(-2.5,2)', -2);            // eski CEILING negatifte sıfıra doğru
S('=CEILING(-2.5,-2)', -4);
S('=CEILING(5,0)', 0);                // FLOOR'un aksine 0 verir
H('=CEILING(2.5,-2)', '#NUM!');
S('=FLOOR(2.5,1)', 2);
S('=FLOOR(-2.5,2)', -4);
S('=FLOOR(-2.5,-2)', -2);
H('=FLOOR(5,0)', '#DIV/0!');          // CEILING ile bakışımsız
H('=FLOOR(2.5,-2)', '#NUM!');
S('=CEILING.MATH(6.7)', 7);
S('=CEILING.MATH(-5.5,2)', -4);       // varsayılan yön +sonsuz
S('=CEILING.MATH(-5.5,2,-1)', -6);    // kip verilince sıfırdan uzağa
S('=CEILING.MATH(-5.5,-2)', -4);      // anlamlılığın işareti yok sayılır
S('=CEILING.PRECISE(-4.3,1)', -4);
S('=CEILING.PRECISE(4.3)', 5);
S('=ISO.CEILING(-4.3)', -4);
S('=ISO.CEILING(4.3,2)', 6);
S('=FLOOR.MATH(6.7)', 6);
S('=FLOOR.MATH(-5.5,2)', -6);
S('=FLOOR.MATH(-5.5,2,-1)', -4);
S('=FLOOR.PRECISE(-3.2)', -4);
S('=FLOOR.PRECISE(3.7,2)', 2);

S('=EVEN(1.5)', 2);
S('=EVEN(3)', 4);
S('=EVEN(2)', 2);
S('=EVEN(0)', 0);
S('=EVEN(-1.5)', -2);
S('=ODD(1.5)', 3);
S('=ODD(3)', 3);
S('=ODD(2)', 3);
S('=ODD(0)', 1);
S('=ODD(-1.5)', -3);

// --------------------------------------------------------------------------------
// Bölme artığı
// --------------------------------------------------------------------------------
S('=MOD(3,2)', 1);
S('=MOD(-3,2)', 1);                   // işaret BÖLENDEN gelir; JS'in % işleci -1 verirdi
S('=MOD(3,-2)', -1);
S('=MOD(-3,-2)', -1);
S('=MOD(0,5)', 0);
H('=MOD(5,0)', '#DIV/0!');
S('=QUOTIENT(10,3)', 3);
S('=QUOTIENT(-10,3)', -3);            // sıfıra doğru keser
H('=QUOTIENT(5,0)', '#DIV/0!');
S('=GCD(24,36)', 12);
S('=GCD(5,0)', 5);
S('=GCD(0,0)', 0);
S('=GCD({12,18,30})', 6);
H('=GCD(-1,5)', '#NUM!');
S('=LCM(4,6)', 12);
S('=LCM(1,8,12)', 24);
S('=LCM(0,5)', 0);
H('=LCM(-2,4)', '#NUM!');

// --------------------------------------------------------------------------------
// Üs, kök, logaritma
// --------------------------------------------------------------------------------
S('=POWER(2,10)', 1024);
S('=POWER(4,0.5)', 2);
S('=POWER(0,0)', 1);
H('=POWER(0,-1)', '#DIV/0!');
H('=POWER(-8,1/3)', '#NUM!');
S('=SQRT(16)', 4);
S('=SQRT(0)', 0);
H('=SQRT(-1)', '#NUM!');
S('=SQRTPI(4)', Math.sqrt(4 * Math.PI));
H('=SQRTPI(-1)', '#NUM!');
S('=EXP(0)', 1);
S('=EXP(1)', Math.E);
H('=EXP(1000)', '#NUM!');
S('=LN(1)', 0);
S('=LN(EXP(3))', 3);
H('=LN(0)', '#NUM!');
H('=LN(-1)', '#NUM!');
S('=LOG(100)', 2);
S('=LOG(8,2)', 3);
H('=LOG(8,1)', '#DIV/0!');
H('=LOG(0,2)', '#NUM!');
/*
 * LOG10 bir zamanlar formül metniyle sınanamıyordu: sözcükleyici "LOG10" dizisini önce A1
 * başvurusu olarak deniyor (LOG sütunu, 10. satır) ve ardından '(' gelse bile ad yoluna
 * düşmüyordu — işlev hiç çağrılmadan formül bir hücreye bakıyordu. Çekirdek düzeltildi
 * (basvuruOku, ardından '(' ya da '!' geliyorsa okumayı geri alır); artık metinle sınanır.
 */
const log10 = X.FN.get('LOG10').fn;
ok('LOG10(1000) = 3', log10([1000]) === 3);
ok('LOG10(1) = 0', log10([1]) === 0);
ok('LOG10(0) = #NUM!', hataMi(log10([0]), '#NUM!'));
ok('LOG10(-1) = #NUM!', hataMi(log10([-1]), '#NUM!'));
S('=LOG10(1000)', 3);
S('=LOG10(100)*2', 4);

// --------------------------------------------------------------------------------
// Çarpanlar ve kombinatorik
// --------------------------------------------------------------------------------
S('=FACT(5)', 120);
S('=FACT(0)', 1);
S('=FACT(1.9)', 1);
H('=FACT(-1)', '#NUM!');
H('=FACT(171)', '#NUM!');
S('=FACTDOUBLE(7)', 105);
S('=FACTDOUBLE(6)', 48);
S('=FACTDOUBLE(0)', 1);
S('=FACTDOUBLE(1)', 1);
H('=FACTDOUBLE(-1)', '#NUM!');
S('=COMBIN(10,3)', 120);
S('=COMBIN(5,0)', 1);
S('=COMBIN(5,5)', 1);
H('=COMBIN(3,5)', '#NUM!');
H('=COMBIN(-1,1)', '#NUM!');
S('=COMBINA(4,3)', 20);
S('=COMBINA(0,0)', 1);
H('=COMBINA(0,2)', '#NUM!');
S('=PERMUT(5,3)', 60);
S('=PERMUT(4,0)', 1);
H('=PERMUT(3,5)', '#NUM!');
S('=PERMUTATIONA(3,2)', 9);
S('=PERMUTATIONA(4,0)', 1);
S('=MULTINOMIAL(2,3,4)', 1260);
S('=MULTINOMIAL(3)', 1);
H('=MULTINOMIAL(-1,2)', '#NUM!');

// --------------------------------------------------------------------------------
// Sabit ve rastgelelik (ctx.rastgele sabitlendi: 0,5)
// --------------------------------------------------------------------------------
S('=PI()', Math.PI);
H('=PI(1)', '#VALUE!');
S('=RAND()', 0.5);
S('=RANDBETWEEN(1,10)', 6);
S('=RANDBETWEEN(-5,-5)', -5);
H('=RANDBETWEEN(5,1)', '#NUM!');
D('=RANDARRAY(2,3)', [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]]);
D('=RANDARRAY()', [[0.5]]);
D('=RANDARRAY(1,2,1,10,TRUE)', [[6, 6]]);
H('=RANDARRAY(0)', '#VALUE!');
H('=RANDARRAY(1,1,10,1)', '#VALUE!');

// --------------------------------------------------------------------------------
// Trigonometri
// --------------------------------------------------------------------------------
S('=SIN(0)', 0);
S('=SIN(PI()/6)', 0.5);
S('=COS(0)', 1);
S('=TAN(0)', 0);
S('=ASIN(1)', Math.PI / 2);
H('=ASIN(2)', '#NUM!');
H('=ASIN(-1.5)', '#NUM!');
S('=ACOS(1)', 0);
S('=ACOS(0)', Math.PI / 2);
H('=ACOS(-2)', '#NUM!');
S('=ATAN(1)', Math.PI / 4);
S('=ATAN2(1,1)', Math.PI / 4);        // Excel sırası (x;y) — JS'in tersi
S('=ATAN2(-1,-1)', -2.35619449019234);
H('=ATAN2(0,0)', '#DIV/0!');
S('=SINH(0)', 0);
S('=COSH(0)', 1);
S('=TANH(0)', 0);
S('=SINH(1)', Math.sinh(1));
S('=ASINH(0)', 0);
S('=ASINH(SINH(2))', 2);
S('=ACOSH(1)', 0);
H('=ACOSH(0)', '#NUM!');
S('=ATANH(0)', 0);
S('=ATANH(0.5)', Math.atanh(0.5));
H('=ATANH(1)', '#NUM!');
H('=ATANH(-1)', '#NUM!');
S('=CSC(PI()/2)', 1);
H('=CSC(0)', '#DIV/0!');
S('=SEC(0)', 1);
S('=COT(PI()/4)', 1, 1e-12);
H('=COT(0)', '#DIV/0!');
H('=CSCH(0)', '#DIV/0!');
S('=CSCH(1)', 1 / Math.sinh(1));
S('=SECH(0)', 1);
H('=COTH(0)', '#DIV/0!');
S('=COTH(1)', 1 / Math.tanh(1));
S('=ACOT(0)', Math.PI / 2);
S('=ACOT(1)', Math.PI / 4);
S('=ACOTH(2)', Math.atanh(0.5));
H('=ACOTH(1)', '#NUM!');
H('=ACOTH(0.5)', '#NUM!');
S('=DEGREES(PI())', 180);
S('=DEGREES(PI()/2)', 90);
S('=RADIANS(180)', Math.PI);
S('=RADIANS(0)', 0);

// --------------------------------------------------------------------------------
// Romen rakamları ve sayı tabanları
// --------------------------------------------------------------------------------
M('=ROMAN(499)', 'CDXCIX');
M('=ROMAN(499,0)', 'CDXCIX');
M('=ROMAN(499,1)', 'LDVLIV');
M('=ROMAN(499,2)', 'XDIX');
M('=ROMAN(499,3)', 'VDIV');
M('=ROMAN(499,4)', 'ID');
M('=ROMAN(999,1)', 'LMVLIV');
M('=ROMAN(999,4)', 'IM');
M('=ROMAN(2013)', 'MMXIII');
M('=ROMAN(1990)', 'MCMXC');
M('=ROMAN(45,1)', 'VL');
M('=ROMAN(4)', 'IV');
M('=ROMAN(0)', '');
M('=ROMAN(3999)', 'MMMCMXCIX');
M('=ROMAN(499,TRUE)', 'CDXCIX');      // DOĞRU = klasik, YANLIŞ = en kısa
M('=ROMAN(499,FALSE)', 'ID');
H('=ROMAN(-1)', '#VALUE!');
H('=ROMAN(4000)', '#VALUE!');
H('=ROMAN(10,5)', '#VALUE!');
S('=ARABIC("LVIII")', 58);
S('=ARABIC("MCMXII")', 1912);
S('=ARABIC("")', 0);
S('=ARABIC("-IV")', -4);
S('=ARABIC("mcmxii")', 1912);
S('=ARABIC(ROMAN(1987))', 1987);
S('=ARABIC(ROMAN(3999,4))', 3999);
H('=ARABIC("XYZ")', '#VALUE!');
M('=BASE(7,2)', '111');
M('=BASE(100,16)', '64');
M('=BASE(15,2,10)', '0000001111');
M('=BASE(0,2)', '0');
H('=BASE(-1,2)', '#NUM!');
H('=BASE(5,1)', '#NUM!');
H('=BASE(5,37)', '#NUM!');
S('=DECIMAL("FF",16)', 255);
S('=DECIMAL("111",2)', 7);
S('=DECIMAL("ZZ",36)', 1295);
S('=DECIMAL("ff",16)', 255);
S('=DECIMAL(BASE(1234,7),7)', 1234);
H('=DECIMAL("12",2)', '#NUM!');
H('=DECIMAL("11",1)', '#NUM!');
S('=SERIESSUM(5,1,0,{1,2,3})', 30);
S('=SERIESSUM(2,1,1,{1,1})', 6);
S('=SERIESSUM(PI()/4,0,2,{1,-0.5,0.041666666,-0.001388888})', 0.70710321482284);

// --------------------------------------------------------------------------------
// SUBTOTAL ve AGGREGATE
// --------------------------------------------------------------------------------
S('=SUBTOTAL(9,A1:A6)', 19);
S('=SUBTOTAL(1,A1:A6)', 19 / 6);
S('=SUBTOTAL(2,A1:C1)', 1);
S('=SUBTOTAL(3,A1:C1)', 3);           // COUNTA boş OLMAYANI sayar
S('=SUBTOTAL(4,A1:A6)', 10);
S('=SUBTOTAL(5,A1:A6)', -5);
S('=SUBTOTAL(6,{2,3,4})', 24);
S('=SUBTOTAL(9,{1,2},{3,4})', 10);
S('=SUBTOTAL(7,{2,4,4,4,5,5,7,9})', Math.sqrt(32 / 7));
S('=SUBTOTAL(8,{2,4,4,4,5,5,7,9})', 2);
S('=SUBTOTAL(10,{2,4,4,4,5,5,7,9})', 32 / 7);
S('=SUBTOTAL(11,{2,4,4,4,5,5,7,9})', 4);
S('=SUM(Sayfa2!A1:A4)', 50);              // düz SUM iç içe SUBTOTAL'i atlamaz
S('=SUBTOTAL(9,Sayfa2!A1:A4)', 35);       // iç içe SUBTOTAL atlanır
S('=SUBTOTAL(109,Sayfa2!A1:A4)', 15);     // + gizli satır atlanır
S('=SUBTOTAL(102,Sayfa2!A1:A4)', 2);
H('=SUBTOTAL(12,A1:A6)', '#VALUE!');  // 12 SUBTOTAL'de yok, AGGREGATE'te var
H('=SUBTOTAL(0,A1:A6)', '#VALUE!');
H('=SUBTOTAL(9)', '#VALUE!');
S('=AGGREGATE(9,6,{1,2,"#DIV/0!"})', 3);
S('=AGGREGATE(9,6,{1,2,#DIV/0!})', 3);
H('=AGGREGATE(9,4,{1,2,#DIV/0!})', '#DIV/0!');
H('=AGGREGATE(9,0,{1,2,#DIV/0!})', '#DIV/0!');
S('=AGGREGATE(14,6,{3,1,#N/A,5},2)', 3);
S('=AGGREGATE(15,6,{3,1,#N/A,5},1)', 1);
S('=AGGREGATE(12,0,{1,2,3,4})', 2.5);
S('=AGGREGATE(13,0,{1,2,2,3})', 2);
H('=AGGREGATE(13,0,{1,2,3})', '#N/A');
S('=AGGREGATE(1,0,A1:A6)', 19 / 6);
S('=AGGREGATE(9,1,Sayfa2!A1:A4)', 15);
S('=AGGREGATE(9,5,Sayfa2!A1:A4)', 30);    // gizli atlanır ama iç içe SUBTOTAL sayılır
S('=AGGREGATE(16,0,{1,2,3,4},0.5)', 2.5);
S('=AGGREGATE(17,0,{1,2,3,4},1)', 1.75);
S('=AGGREGATE(19,0,{1,2,3,4},2)', 2.5);
H('=AGGREGATE(18,0,{1,2,3,4},0.1)', '#NUM!');
H('=AGGREGATE(20,0,{1})', '#VALUE!');
H('=AGGREGATE(9,8,{1})', '#VALUE!');
H('=AGGREGATE(14,0,{1,2})', '#VALUE!');   // 14-19 k argümanı ister

// --------------------------------------------------------------------------------
// Matris işlevleri
// --------------------------------------------------------------------------------
D('=TRANSPOSE({1,2;3,4})', [[1, 3], [2, 4]]);
D('=TRANSPOSE({1,2,3})', [[1], [2], [3]]);
D('=TRANSPOSE(A1:A2)', [[1, 2]]);
D('=MUNIT(2)', [[1, 0], [0, 1]]);
D('=MUNIT(3.7)', [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
H('=MUNIT(0)', '#VALUE!');
D('=MMULT({1,2;3,4},{5,6;7,8})', [[19, 22], [43, 50]]);
D('=MMULT({1,2,3},{1;2;3})', [[14]]);
D('=MMULT(MUNIT(2),{5,6;7,8})', [[5, 6], [7, 8]]);
H('=MMULT({1,2},{1,2})', '#VALUE!');
H('=MMULT({1,"a";2,3},{1,2;3,4})', '#VALUE!');
S('=MDETERM({1,2;3,4})', -2);
S('=MDETERM({3})', 3);
S('=MDETERM({1,2,3;4,5,6;7,8,9})', 0);
S('=MDETERM({2,0,0;0,3,0;0,0,4})', 24);
H('=MDETERM({1,2,3})', '#VALUE!');
D('=MINVERSE({4,-1;2,0})', [[0, 0.5], [-1, 2]]);
D('=MINVERSE({2,0;0,4})', [[0.5, 0], [0, 0.25]]);
D('=MMULT({4,-1;2,0},MINVERSE({4,-1;2,0}))', [[1, 0], [0, 1]]);
H('=MINVERSE({1,1;1,1})', '#NUM!');
H('=MINVERSE({1,2,3})', '#VALUE!');
D('=SEQUENCE(2,3)', [[1, 2, 3], [4, 5, 6]]);
D('=SEQUENCE(3)', [[1], [2], [3]]);
D('=SEQUENCE(2,2,10,5)', [[10, 15], [20, 25]]);
D('=SEQUENCE(1,3,0,0.5)', [[0, 0.5, 1]]);
H('=SEQUENCE(0)', '#CALC!');
H('=SEQUENCE(-1)', '#VALUE!');

// --------------------------------------------------------------------------------
// Kayıt bütünlüğü
// --------------------------------------------------------------------------------
const ADLAR = ['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'SUMSQ', 'SUMX2MY2', 'SUMX2PY2', 'SUMXMY2', 'PRODUCT',
  'ABS', 'SIGN', 'INT', 'TRUNC', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'MROUND', 'CEILING', 'CEILING.MATH',
  'CEILING.PRECISE', 'ISO.CEILING', 'FLOOR', 'FLOOR.MATH', 'FLOOR.PRECISE', 'EVEN', 'ODD', 'MOD', 'QUOTIENT',
  'GCD', 'LCM', 'POWER', 'SQRT', 'SQRTPI', 'EXP', 'LN', 'LOG', 'LOG10', 'FACT', 'FACTDOUBLE', 'COMBIN',
  'COMBINA', 'PERMUT', 'PERMUTATIONA', 'MULTINOMIAL', 'PI', 'RAND', 'RANDBETWEEN', 'RANDARRAY', 'SIN', 'COS',
  'TAN', 'ASIN', 'ACOS', 'ATAN', 'ATAN2', 'SINH', 'COSH', 'TANH', 'ASINH', 'ACOSH', 'ATANH', 'CSC', 'SEC',
  'COT', 'CSCH', 'SECH', 'COTH', 'ACOT', 'ACOTH', 'DEGREES', 'RADIANS', 'ROMAN', 'ARABIC', 'BASE', 'DECIMAL',
  'SERIESSUM', 'SUBTOTAL', 'AGGREGATE', 'MUNIT', 'MMULT', 'MDETERM', 'MINVERSE', 'TRANSPOSE', 'SEQUENCE'];
ok('kayıt: hedefteki ' + ADLAR.length + ' işlevin hepsi tanınıyor', ADLAR.every((a) => X.bilinen(a)),
  '→ eksik: ' + ADLAR.filter((a) => !X.bilinen(a)).join(', '));
ok('_xlfn öneki soyuluyor (_xlfn.CEILING.MATH)', h('=_xlfn.CEILING.MATH(-5.5,2)') === -4);
ok('kaydedilmemiş ad #NAME? verir', hataMi(h('=BOYLEBIRSEYYOK(1)'), '#NAME?'));

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
