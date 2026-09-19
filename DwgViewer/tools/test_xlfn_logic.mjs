// Excel formül motoru — MANTIK ve BİLGİ sınaması.
// Playwright kullanmaz; depo kökünden "node tools/test_xlfn_logic.mjs" ile koşar.
import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_logic.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// --------------------------------------------------------------------------------
// Sahte bağlam
//   A1 = 1        B1 = "metin"   C1 = DOĞRU    D1 = (boş)
//   A2 = 0        B2 = ""        C2 = YANLIŞ   D2 = #DIV/0!
//   A3 = 2        B3 = 4         C3 = 6        D3 = 8
//   A4 = (boş)    B4 = 3         C4 = (boş)    D4 = 5
// A1 bir formül hücresidir (ISFORMULA sınaması için).
// --------------------------------------------------------------------------------
const SAYFA = {
  S1: [
    [1, 'metin', true, null],
    [0, '', false, X.ERR.DIV0],
    [2, 4, 6, 8],
    [null, 3, null, 5],
  ],
  Sayfa2: [[10], [20]],
};
const FORMUL = { 'S1|0|0': '=1+1' };

const ctx = {
  sayfa: 'S1',
  hucre: { r: 2, c: 1 },   // geçerli hücre B3
  oku: (s, r, c) => { const t = SAYFA[s || 'S1']; if (!t || !t[r]) return null; const v = t[r][c]; return v === undefined ? null : v; },
  boyut: (s) => { const t = SAYFA[s || 'S1'] || []; return { r: t.length, c: t.length ? t[0].length : 0 }; },
  formul: (s, r, c) => FORMUL[(s || 'S1') + '|' + r + '|' + c] || null,
  sayfalar: () => ['S1', 'Sayfa2', 'Sayfa3'],
  genislik: (s, c) => (c === 0 ? 8.43 : 12),
  dosya: () => 'C:\\kitap.xlsx',
  bilgi: (t) => (t === 'release' ? '16.0' : undefined),
  simdi: () => 46000.5,
  rastgele: () => 0.5,
};
// Kancasız bağlam: CELL / INFO / SHEET / ISFORMULA burada bilgi uydurmamalı.
const ctxYalin = { sayfa: 'S1', oku: ctx.oku, boyut: ctx.boyut };

const h = (f) => X.hesapla(f, ctx);
const hy = (f) => X.hesapla(f, ctxYalin);
const gor = (v) => (X.hata(v) ? v.e : JSON.stringify(v));
const yak = (v, b) => typeof v === 'number' && Math.abs(v - b) <= 1e-9 * Math.max(1, Math.abs(b));

function dz(v, b) {
  if (!Array.isArray(v) || v.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    if (!Array.isArray(v[i]) || v[i].length !== b[i].length) return false;
    for (let j = 0; j < b[i].length; j++) {
      const x = v[i][j], y = b[i][j];
      if (typeof y === 'string' && y[0] === '#') { if (!X.hata(x) || x.e !== y) return false; }
      else if (typeof y === 'number') { if (!yak(x, y)) return false; }
      else if (x !== y) return false;
    }
  }
  return true;
}
/** eşit: sayıda tolerans, ötekinde birebir */
const es = (ad, f, b) => { const v = h(f); ok(ad + ' · ' + f, typeof b === 'number' ? yak(v, b) : v === b, '→ ' + gor(v)); };
const hat = (ad, f, kod) => { const v = h(f); ok(ad + ' · ' + f, X.hata(v) && v.e === kod, '→ ' + gor(v)); };
const dizi = (ad, f, b) => { const v = h(f); ok(ad + ' · ' + f, dz(v, b), '→ ' + gor(v)); };

// ================================================================================
// IF
// ================================================================================
es('IF doğru dal', 'IF(TRUE,1,2)', 1);
es('IF yanlış dal', 'IF(FALSE,1,2)', 2);
es('IF karşılaştırma', 'IF(1>2,"a","b")', 'b');
es('IF üçüncü argüman yazılmamış → YANLIŞ', 'IF(FALSE,1)', false);
es('IF boş dal 0 verir', 'IF(TRUE,,5)', 0);
es('IF boş hücreye başvuran dal 0 verir', 'IF(TRUE,D1,5)', 0);
es('IF boş hücre koşulu YANLIŞtır', 'IF(D1,1,2)', 2);
es('IF sayısal koşul: 0 dışı DOĞRU', 'IF(A3,1,2)', 1);
es('IF TEMBEL: yanlış dal hesaplanmaz', 'IF(A2=0,"sıfır",1/A2)', 'sıfır');
es('IF tembellik ters yönde', 'IF(A1=0,1/A1,"var")', 'var');
hat('IF metin koşulu #VALUE!', 'IF("x",1,2)', '#VALUE!');
hat('IF hatalı koşul yayılır', 'IF(1/0,1,2)', '#DIV/0!');
hat('IF tek argüman #VALUE!', 'IF(1)', '#VALUE!');
hat('IF dört argüman #VALUE!', 'IF(1,2,3,4)', '#VALUE!');
dizi('IF dizi koşulda yayılır', 'IF({TRUE,FALSE},1,2)', [[1, 2]]);
dizi('IF dizi koşul + dizi dal', 'IF({TRUE,FALSE},{10,20},{30,40})', [[10, 40]]);

// ================================================================================
// IFS
// ================================================================================
es('IFS ikinci koşul tutar', 'IFS(FALSE,1,TRUE,2)', 2);
es('IFS ilk tutan kazanır', 'IFS(TRUE,"a",TRUE,"b")', 'a');
es('IFS TEMBEL', 'IFS(A2=0,"sıfır",TRUE,1/A2)', 'sıfır');
hat('IFS hiçbiri tutmazsa #N/A', 'IFS(FALSE,1,FALSE,2)', '#N/A');
hat('IFS eşi olmayan koşul #N/A', 'IFS(FALSE,1,TRUE)', '#N/A');
hat('IFS hata yayılır', 'IFS(1/0,1)', '#DIV/0!');
hat('IFS metin koşul #VALUE!', 'IFS("x",1)', '#VALUE!');
hat('IFS tek argüman #VALUE!', 'IFS(TRUE)', '#VALUE!');

// ================================================================================
// SWITCH
// ================================================================================
es('SWITCH eşleşme', 'SWITCH(2,1,"a",2,"b",3,"c")', 'b');
es('SWITCH varsayılan', 'SWITCH(9,1,"a",2,"b","yok")', 'yok');
es('SWITCH metin eşleşmesi harf duymaz', 'SWITCH("A","a","tuttu","olmadı")', 'tuttu');
es('SWITCH TEMBEL varsayılan', 'SWITCH(A2,0,"sıfır",1/A2)', 'sıfır');
es('SWITCH boş sonuç 0 olur', 'SWITCH(1,1,,"x")', 0);
hat('SWITCH eşleşme yok, varsayılan yok → #N/A', 'SWITCH(9,1,"a",2,"b")', '#N/A');
hat('SWITCH hatalı ifade yayılır', 'SWITCH(1/0,1,"a","d")', '#DIV/0!');
hat('SWITCH iki argüman #VALUE!', 'SWITCH(1,1)', '#VALUE!');

// ================================================================================
// IFERROR / IFNA
// ================================================================================
es('IFERROR hatayı yakalar', 'IFERROR(1/0,"x")', 'x');
es('IFERROR hatasız değeri geçirir', 'IFERROR(5,"x")', 5);
es('IFERROR #N/A da hatadır', 'IFERROR(NA(),"x")', 'x');
es('IFERROR hücre değeri', 'IFERROR(A1,"x")', 1);
es('IFERROR boş hücre BOŞ METİN verir', 'IFERROR(D1,"x")', '');
es('IFNA yalnız #N/A yakalar', 'IFNA(NA(),"x")', 'x');
es('IFNA hatasız değeri geçirir', 'IFNA(7,"x")', 7);
hat('IFNA öteki hatayı geçirir', 'IFNA(1/0,"x")', '#DIV/0!');
hat('IFERROR yedek dalın kendisi hatalıysa', 'IFERROR(1/0,NA())', '#N/A');
hat('IFERROR tek argüman #VALUE!', 'IFERROR(1)', '#VALUE!');
dizi('IFERROR dizide eleman eleman', 'IFERROR({1,2}/{1,0},0)', [[1, 0]]);

// ================================================================================
// AND / OR / XOR / NOT / TRUE / FALSE
// ================================================================================
es('AND hepsi doğru', 'AND(TRUE,TRUE)', true);
es('AND biri yanlış', 'AND(TRUE,FALSE)', false);
es('AND sayılar 0 dışı', 'AND(1,2,3)', true);
es('AND sıfır yanlıştır', 'AND(1,0)', false);
es('AND aralıkta metin atlanır', 'AND(A1:C1)', true);
es('AND aralıkta boş atlanır', 'AND(A1:D1)', true);
es('AND aralıkta sıfır yanlıştır', 'AND(A2:C2)', false);
es('AND doğrudan metin çevrilir', 'AND("TRUE")', true);
es('OR hepsi yanlış', 'OR(FALSE,FALSE)', false);
es('OR biri doğru', 'OR(FALSE,TRUE)', true);
es('OR aralık', 'OR(A2:C2)', false);
es('XOR tek sayıda DOĞRU', 'XOR(TRUE,FALSE)', true);
es('XOR çift sayıda DOĞRU', 'XOR(TRUE,TRUE)', false);
es('XOR üç DOĞRU tek sayıdır', 'XOR(TRUE,TRUE,TRUE)', true);
es('XOR sayılarla parite', 'XOR(1,0,1,1)', true);
hat('AND aralıkta mantık değeri yoksa #VALUE!', 'AND(B1)', '#VALUE!');
hat('AND yalnız boş hücre #VALUE!', 'AND(D1)', '#VALUE!');
hat('AND çevrilemeyen metin #VALUE!', 'AND("x")', '#VALUE!');
hat('AND argümansız #VALUE!', 'AND()', '#VALUE!');
hat('AND hata yayılır', 'AND(1/0,TRUE)', '#DIV/0!');
hat('OR aralıktaki hata yayılır', 'OR(A2:D2)', '#DIV/0!');
es('NOT DOĞRU', 'NOT(TRUE)', false);
es('NOT sıfır', 'NOT(0)', true);
es('NOT boş hücre', 'NOT(D1)', true);
hat('NOT metin #VALUE!', 'NOT("x")', '#VALUE!');
hat('NOT argümansız #VALUE!', 'NOT()', '#VALUE!');
dizi('NOT dizide yayılır', 'NOT({TRUE,FALSE})', [[false, true]]);
es('TRUE()', 'TRUE()', true);
es('FALSE()', 'FALSE()', false);
es('TRUE işleçte 1 gibi', 'TRUE()+1', 2);
hat('TRUE argüman almaz', 'TRUE(1)', '#VALUE!');

// ================================================================================
// LET
// ================================================================================
es('LET tek ad', 'LET(x,5,x*2)', 10);
es('LET ikinci ad birinciyi görür', 'LET(x,5,y,x+1,x*y)', 30);
es('LET iç içe', 'LET(a,2,LET(b,3,a*b))', 6);
es('LET hücre değeri bağlar', 'LET(v,A3,v+B3)', 6);
es('LET hesap adı kullanmayabilir', 'LET(x,5,4)', 4);
es('LET adı dışarı SIZMAZ', 'LET(x,5,x)+IFERROR(x,100)', 105);
hat('LET çift argüman #VALUE!', 'LET(x,5,y,6)', '#VALUE!');
hat('LET ad yerine sayı #VALUE!', 'LET(5,5,1)', '#VALUE!');
hat('LET iki argüman #VALUE!', 'LET(x,5)', '#VALUE!');
hat('LET adına bağlı hata kullanılınca yayılır', 'LET(x,1/0,x+1)', '#DIV/0!');

// ================================================================================
// LAMBDA ve dizi biçimlendiricileri
// ================================================================================
const lam = h('LAMBDA(x,x+1)');
ok('LAMBDA çağrılabilir değer döndürür', !X.hata(lam) && lam && lam.lambda === true && lam.par.length === 1, '→ ' + gor(lam));
hat('LAMBDA parametresi ad olmalı', 'LAMBDA(5,5)', '#VALUE!');
hat('LAMBDA argümansız #VALUE!', 'LAMBDA()', '#VALUE!');

dizi('MAP tek dizi', 'LET(f,LAMBDA(x,x*2),MAP({1,2,3},f))', [[2, 4, 6]]);
dizi('MAP iki dizi eşlenir', 'MAP({1,2},{10,20},LAMBDA(a,b,a+b))', [[11, 22]]);
dizi('MAP hata öğesi yerinde kalır', 'MAP({1,0},LAMBDA(x,1/x))', [[1, '#DIV/0!']]);
dizi('MAP iki satır', 'MAP({1,2;3,4},LAMBDA(x,x*x))', [[1, 4], [9, 16]]);
hat('MAP boyut uyuşmazlığı #VALUE!', 'MAP({1,2},{10,20,30},LAMBDA(a,b,a+b))', '#VALUE!');
hat('MAP lambda olmayan son argüman #VALUE!', 'MAP({1,2},5)', '#VALUE!');
hat('MAP tek argüman #VALUE!', 'MAP({1,2})', '#VALUE!');

dizi('BYROW sütun vektörü verir', 'BYROW({1,2;3,4},LAMBDA(r,REDUCE(0,r,LAMBDA(a,b,a+b))))', [[3], [7]]);
dizi('BYCOL satır vektörü verir', 'BYCOL({1,2;3,4},LAMBDA(c,REDUCE(0,c,LAMBDA(a,b,a+b))))', [[4, 6]]);
dizi('BYROW dizi döndüren lambda #CALC!', 'BYROW({1,2;3,4},LAMBDA(r,r*2))', [['#CALC!'], ['#CALC!']]);
dizi('BYROW hücre aralığıyla', 'BYROW(A3:B4,LAMBDA(r,REDUCE(0,r,LAMBDA(a,b,a+b))))', [[6], [3]]);
hat('BYROW lambda değilse #VALUE!', 'BYROW({1,2},7)', '#VALUE!');
hat('BYCOL tek argüman #VALUE!', 'BYCOL({1,2})', '#VALUE!');

es('REDUCE toplar', 'REDUCE(0,{1,2,3,4},LAMBDA(a,b,a+b))', 10);
es('REDUCE çarpar', 'REDUCE(1,{2,3},LAMBDA(a,b,a*b))', 6);
es('REDUCE başlangıç boş bırakılabilir', 'REDUCE(,{1,2},LAMBDA(a,b,a+b))', 3);
es('REDUCE iki boyutlu dizi satır öncelikli', 'REDUCE(0,{1,2;3,4},LAMBDA(a,b,a*10+b))', 1234);
hat('REDUCE lambda değilse #VALUE!', 'REDUCE(0,{1,2},3)', '#VALUE!');
hat('REDUCE iki argüman #VALUE!', 'REDUCE(0,{1,2})', '#VALUE!');
dizi('SCAN ara toplamları verir', 'SCAN(0,{1,2,3},LAMBDA(a,b,a+b))', [[1, 3, 6]]);
dizi('SCAN dizinin biçimini korur', 'SCAN(0,{1,2;3,4},LAMBDA(a,b,a+b))', [[1, 3], [6, 10]]);
dizi('MAKEARRAY 1 tabanlı satır/sütun', 'MAKEARRAY(2,3,LAMBDA(r,c,r*10+c))', [[11, 12, 13], [21, 22, 23]]);
dizi('MAKEARRAY kesirli boyut kırpılır', 'MAKEARRAY(1.9,1,LAMBDA(r,c,r))', [[1]]);
hat('MAKEARRAY sıfır satır #VALUE!', 'MAKEARRAY(0,2,LAMBDA(r,c,1))', '#VALUE!');
hat('MAKEARRAY lambda değilse #VALUE!', 'MAKEARRAY(2,2,5)', '#VALUE!');
hat('MAKEARRAY metin boyut #VALUE!', 'MAKEARRAY("x",2,LAMBDA(r,c,1))', '#VALUE!');

// ================================================================================
// ISOMITTED
// ================================================================================
dizi('ISOMITTED verilmemiş parametre', 'LET(f,LAMBDA(x,y,IF(ISOMITTED(y),x,x+y)),MAP({1,2},f))', [[1, 2]]);
dizi('ISOMITTED verilen parametre', 'LET(f,LAMBDA(x,y,IF(ISOMITTED(y),x*10,x+y)),MAP({1,2},{5,6},f))', [[6, 8]]);
es('ISOMITTED sıradan argümanda YANLIŞ', 'ISOMITTED(A1)', false);
es('ISOMITTED boş hücre atlanmış değildir', 'ISOMITTED(D1)', false);
hat('ISOMITTED argümansız #VALUE!', 'ISOMITTED()', '#VALUE!');

// ================================================================================
// IS ailesi
// ================================================================================
es('ISBLANK boş hücre', 'ISBLANK(D1)', true);
es('ISBLANK boş METİN boş değildir', 'ISBLANK(B2)', false);
es('ISBLANK dolu hücre', 'ISBLANK(A1)', false);
es('ISBLANK doğrudan ""', 'ISBLANK("")', false);
es('ISERROR hata', 'ISERROR(1/0)', true);
es('ISERROR #N/A da hatadır', 'ISERROR(NA())', true);
es('ISERROR sayı', 'ISERROR(1)', false);
es('ISERROR hücredeki hata', 'ISERROR(D2)', true);
es('ISERR #N/A sayılmaz', 'ISERR(NA())', false);
es('ISERR öteki hata', 'ISERR(1/0)', true);
es('ISERR sayı', 'ISERR(5)', false);
es('ISNA #N/A', 'ISNA(NA())', true);
es('ISNA başka hata', 'ISNA(1/0)', false);
es('ISNA hücredeki #DIV/0!', 'ISNA(D2)', false);
es('ISLOGICAL DOĞRU', 'ISLOGICAL(TRUE)', true);
es('ISLOGICAL sayı', 'ISLOGICAL(1)', false);
es('ISLOGICAL hücredeki mantık', 'ISLOGICAL(C1)', true);
es('ISNUMBER sayı', 'ISNUMBER(1)', true);
es('ISNUMBER sayı metni', 'ISNUMBER("1")', false);
es('ISNUMBER boş hücre', 'ISNUMBER(D1)', false);
es('ISTEXT metin', 'ISTEXT("a")', true);
es('ISTEXT sayı', 'ISTEXT(1)', false);
es('ISTEXT boş metin hücresi', 'ISTEXT(B2)', true);
es('ISNONTEXT sayı', 'ISNONTEXT(1)', true);
es('ISNONTEXT metin', 'ISNONTEXT("a")', false);
es('ISNONTEXT boş hücre', 'ISNONTEXT(D1)', true);
es('ISNONTEXT hata', 'ISNONTEXT(1/0)', true);
es('ISREF tek hücre', 'ISREF(A1)', true);
es('ISREF aralık', 'ISREF(A1:B2)', true);
es('ISREF sayı', 'ISREF(1)', false);
es('ISREF metin', 'ISREF("A1")', false);
es('ISREF bozuk başvuru da başvurudur', 'ISREF(#REF!)', true);
es('ISEVEN çift', 'ISEVEN(2)', true);
es('ISEVEN tek', 'ISEVEN(3)', false);
es('ISEVEN sıfır', 'ISEVEN(0)', true);
es('ISEVEN negatif kesir sıfıra kırpılır', 'ISEVEN(-2.5)', true);
es('ISEVEN boş hücre sıfırdır', 'ISEVEN(D1)', true);
es('ISODD tek', 'ISODD(3)', true);
es('ISODD negatif tek', 'ISODD(-3)', true);
es('ISODD kesir kırpılır', 'ISODD(2.9)', false);
hat('ISEVEN metin #VALUE!', 'ISEVEN("x")', '#VALUE!');
hat('ISEVEN mantık değeri sayı değildir', 'ISEVEN(TRUE)', '#VALUE!');
hat('ISODD hata yayılır', 'ISODD(1/0)', '#DIV/0!');
es('ISFORMULA formül hücresi', 'ISFORMULA(A1)', true);
es('ISFORMULA sabit hücre', 'ISFORMULA(A3)', false);
hat('ISFORMULA başvuru olmayan argüman #VALUE!', 'ISFORMULA(1)', '#VALUE!');
dizi('ISFORMULA aralıkta yayılır', 'ISFORMULA(A1:B1)', [[true, false]]);
dizi('ISBLANK aralıkta yayılır', 'ISBLANK(C4:D4)', [[true, false]]);
dizi('ISNUMBER aralıkta yayılır', 'ISNUMBER(A1:C1)', [[true, false, false]]);

// ================================================================================
// N / NA / TYPE / ERROR.TYPE
// ================================================================================
es('N sayı', 'N(5)', 5);
es('N DOĞRU', 'N(TRUE)', 1);
es('N YANLIŞ', 'N(FALSE)', 0);
es('N metin sıfırdır', 'N("a")', 0);
es('N sayı görünümlü metin de sıfırdır', 'N("5")', 0);
es('N boş hücre', 'N(D1)', 0);
hat('N hatayı geçirir', 'N(NA())', '#N/A');
hat('N #DIV/0! geçirir', 'N(1/0)', '#DIV/0!');
hat('NA() #N/A verir', 'NA()', '#N/A');
hat('NA argüman almaz', 'NA(1)', '#VALUE!');
es('TYPE sayı', 'TYPE(1)', 1);
es('TYPE metin', 'TYPE("a")', 2);
es('TYPE mantık', 'TYPE(TRUE)', 4);
es('TYPE hata', 'TYPE(NA())', 16);
es('TYPE dizi', 'TYPE({1,2})', 64);
es('TYPE boş hücre sayı sayılır', 'TYPE(D1)', 1);
es('TYPE hücredeki hata', 'TYPE(D2)', 16);
es('ERROR.TYPE #NULL!', 'ERROR.TYPE(#NULL!)', 1);
es('ERROR.TYPE #DIV/0!', 'ERROR.TYPE(1/0)', 2);
es('ERROR.TYPE #VALUE!', 'ERROR.TYPE("x"+1)', 3);
es('ERROR.TYPE #REF!', 'ERROR.TYPE(#REF!)', 4);
es('ERROR.TYPE #NAME?', 'ERROR.TYPE(#NAME?)', 5);
es('ERROR.TYPE #NUM!', 'ERROR.TYPE(#NUM!)', 6);
es('ERROR.TYPE #N/A', 'ERROR.TYPE(NA())', 7);
hat('ERROR.TYPE hatasız değer #N/A', 'ERROR.TYPE(1)', '#N/A');

// ================================================================================
// CELL / INFO / SHEET / SHEETS
// ================================================================================
es('CELL row', 'CELL("row",A5)', 5);
es('CELL col', 'CELL("col",C2)', 3);
es('CELL address', 'CELL("address",B3)', '$B$3');
es('CELL aralıkta sol üst hücre', 'CELL("row",B3:D9)', 3);
es('CELL contents', 'CELL("contents",A1)', 1);
es('CELL contents boş hücre 0', 'CELL("contents",D1)', 0);
es('CELL type boş', 'CELL("type",D1)', 'b');
es('CELL type etiket', 'CELL("type",B1)', 'l');
es('CELL type boş metin de etikettir', 'CELL("type",B2)', 'l');
es('CELL type değer', 'CELL("type",A1)', 'v');
es('CELL width yuvarlanır', 'CELL("width",A1)', 8);
es('CELL başvurusuz çağrı geçerli hücreyi gösterir', 'CELL("row")', 3);
es('CELL başvurusuz col', 'CELL("col")', 2);
es('CELL filename', 'CELL("filename")', 'C:\\kitap.xlsx');
es('CELL tür adı harf duymaz', 'CELL("ROW",A5)', 5);
hat('CELL bilinmeyen tür #VALUE!', 'CELL("format",A1)', '#VALUE!');
hat('CELL başvuru olmayan argüman #VALUE!', 'CELL("row",5)', '#VALUE!');
es('INFO ortamdan gelen değer', 'INFO("release")', '16.0');
hat('INFO verilmeyen bilgi uydurulmaz', 'INFO("system")', '#VALUE!');
hat('INFO bilinmeyen tür #VALUE!', 'INFO("yok")', '#VALUE!');
es('SHEET geçerli sayfa', 'SHEET()', 1);
es('SHEET başka sayfaya başvuru', 'SHEET(Sayfa2!A1)', 2);
es('SHEET sayfa adıyla', 'SHEET("Sayfa2")', 2);
es('SHEET aynı sayfaya başvuru', 'SHEET(A1)', 1);
hat('SHEET olmayan sayfa #N/A', 'SHEET("Yok")', '#N/A');
es('SHEETS kitaptaki sayfa sayısı', 'SHEETS()', 3);
es('SHEETS başvuru tek sayfadadır', 'SHEETS(A1:B2)', 1);
hat('SHEETS başvuru olmayan argüman #VALUE!', 'SHEETS(1)', '#VALUE!');

// Kancasız bağlam: bilinmeyen bilgi uydurulmaz
ok('yalın bağlam · CELL("row") #VALUE! · ', X.hata(hy('CELL("row")')) && hy('CELL("row")').e === '#VALUE!', '→ ' + gor(hy('CELL("row")')));
ok('yalın bağlam · CELL("width",A1) #VALUE! · ', X.hata(hy('CELL("width",A1)')) && hy('CELL("width",A1)').e === '#VALUE!', '→ ' + gor(hy('CELL("width",A1)')));
ok('yalın bağlam · ISFORMULA(A1) #VALUE! · ', X.hata(hy('ISFORMULA(A1)')) && hy('ISFORMULA(A1)').e === '#VALUE!', '→ ' + gor(hy('ISFORMULA(A1)')));
ok('yalın bağlam · SHEET() #VALUE! · ', X.hata(hy('SHEET()')) && hy('SHEET()').e === '#VALUE!', '→ ' + gor(hy('SHEET()')));
ok('yalın bağlam · SHEETS() #VALUE! · ', X.hata(hy('SHEETS()')) && hy('SHEETS()').e === '#VALUE!', '→ ' + gor(hy('SHEETS()')));
ok('yalın bağlam · INFO("release") #VALUE! · ', X.hata(hy('INFO("release")')) && hy('INFO("release")').e === '#VALUE!', '→ ' + gor(hy('INFO("release")')));
ok('yalın bağlam · IF çalışmayı sürdürür · ', hy('IF(A1=1,"var","yok")') === 'var', '→ ' + gor(hy('IF(A1=1,"var","yok")')));

// ================================================================================
// Kayıt bütünlüğü
// ================================================================================
const ADLAR = ['IF', 'IFS', 'AND', 'OR', 'NOT', 'XOR', 'TRUE', 'FALSE', 'IFERROR', 'IFNA', 'SWITCH',
  'LET', 'LAMBDA', 'BYROW', 'BYCOL', 'MAP', 'REDUCE', 'SCAN', 'MAKEARRAY', 'ISBLANK', 'ISERR',
  'ISERROR', 'ISNA', 'ISLOGICAL', 'ISNUMBER', 'ISTEXT', 'ISNONTEXT', 'ISREF', 'ISEVEN', 'ISODD',
  'ISFORMULA', 'N', 'NA', 'TYPE', 'ERROR.TYPE', 'CELL', 'INFO', 'SHEET', 'SHEETS', 'ISOMITTED'];
ok('kırk işlevin hepsi kayıtlı (' + ADLAR.length + ')', ADLAR.every(a => X.bilinen(a)), '→ eksik: ' + ADLAR.filter(a => !X.bilinen(a)).join(', '));
hat('kaydedilmemiş ad #NAME? verir', 'ISURL("x")', '#NAME?');
es('_xlfn öneki soyulur', '_xlfn.XOR(TRUE,FALSE)', true);

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
