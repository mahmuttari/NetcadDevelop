// Excel formül motoru — METİN sınaması.
// Playwright kullanmaz; depo kökünden "node tools/test_xlfn_text.mjs" ile koşar.
import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_text.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// --------------------------------------------------------------------------------
// Sahte bağlam: tek sayfa, boş hücreler ve karışık türler
// --------------------------------------------------------------------------------
const SAYFA = {
  S1: [
    ['ab', 'CD', 1, null],
    ['x', 3, true, 'e f'],
    [null, '  bol   bosluk  ', 'İstanbul', '3'],
  ],
};
const ctx = {
  sayfa: 'S1',
  hucre: { r: 0, c: 0 },
  oku: (s, r, c) => { const t = SAYFA[s || 'S1']; if (!t || !t[r]) return null; const v = t[r][c]; return v === undefined ? null : v; },
  boyut: (s) => { const t = SAYFA[s || 'S1'] || []; return { r: t.length, c: t.length ? t[0].length : 0 }; },
  simdi: () => 46000.5,
  rastgele: () => 0.5,
};
// Yerel ayraçlı ikinci bağlam: FIXED / DOLLAR / TEXT yedeği bunları kullanmalı.
const ctxTR = { ...ctx, ayirac: { ondalik: ',', binlik: '.' }, para: '₺' };
// ctx.bicim varsa TEXT bütün işi ona bırakır (asıl yorumlayıcı xlfmt.js'tedir).
const ctxBicim = { ...ctx, bicim: (v, kod) => '«' + String(kod) + ':' + String(v) + '»' };

const h = (f, c) => X.hesapla(f, c || ctx);
const hataMi = (v, kod) => X.hata(v) && v.e === kod;
const ayni = (v, b) => JSON.stringify(v) === JSON.stringify(b);
const yak = (v, b, t = 1e-9) => typeof v === 'number' && Math.abs(v - b) <= t * Math.max(1, Math.abs(b));

// ================================================================================
// Birleştirme
// ================================================================================
ok('CONCAT düz', h('=CONCAT("a","b","c")') === 'abc');
ok('CONCAT sayı ve mantık metne çevrilir', h('=CONCAT(1,TRUE)') === '1TRUE');
ok('CONCAT aralığı satır önceliğiyle düzler', h('=CONCAT(A1:B2)') === 'abCDx3');
ok('CONCAT boş hücreyi boş metin sayar', h('=CONCAT(A1:D1)') === 'abCD1');
ok('CONCAT hatayı yayar', hataMi(h('=CONCAT("a",#REF!)'), '#REF!'));
ok('CONCAT argümansız #VALUE!', hataMi(h('=CONCAT()'), '#VALUE!'));
ok('CONCATENATE düz', h('=CONCATENATE("a",1,"b")') === 'a1b');
ok('CONCATENATE dizi argümanında YAYILIR (CONCAT düzlerdi)', ayni(h('=CONCATENATE("x",A1:A2)'), [['xab'], ['xx']]));
ok('TEXTJOIN boşları atlar', h('=TEXTJOIN("-",TRUE,"a","","b")') === 'a-b');
ok('TEXTJOIN boşları atlamaz', h('=TEXTJOIN("-",FALSE,"a","","b")') === 'a--b');
ok('TEXTJOIN ayraç dizisi dönüşümlü kullanılır', h('=TEXTJOIN({"-","+"},TRUE,"a","b","c")') === 'a-b+c');
ok('TEXTJOIN aralıkta boş hücre atlanır', h('=TEXTJOIN(",",TRUE,A1:D1)') === 'ab,CD,1');
ok('TEXTJOIN aralıkta boş hücre yerinde durur', h('=TEXTJOIN(",",FALSE,A1:D1)') === 'ab,CD,1,');
ok('TEXTJOIN eksik argüman #VALUE!', hataMi(h('=TEXTJOIN("-",TRUE)'), '#VALUE!'));

// ================================================================================
// Parça alma
// ================================================================================
ok('LEFT varsayılan 1 karakter', h('=LEFT("abcdef")') === 'a');
ok('LEFT n karakter', h('=LEFT("abcdef",3)') === 'abc');
ok('LEFT ondalığı keser (yuvarlamaz)', h('=LEFT("abcdef",2.7)') === 'ab');
ok('LEFT uzunluğu aşan n bütün metni verir', h('=LEFT("abc",10)') === 'abc');
ok('LEFT sıfır boş metin', h('=LEFT("abc",0)') === '');
ok('LEFT negatif n #VALUE!', hataMi(h('=LEFT("abc",-1)'), '#VALUE!'));
ok('LEFT sayıyı metne çevirir', h('=LEFT(12345,2)') === '12');
ok('LEFTB tek baytlı ortamda LEFT ile aynı', h('=LEFTB("abcdef",3)') === 'abc');
ok('RIGHT n karakter', h('=RIGHT("abcdef",2)') === 'ef');
ok('RIGHT varsayılan 1 karakter', h('=RIGHT("abc")') === 'c');
ok('RIGHT sıfır boş metin', h('=RIGHT("abc",0)') === '');
ok('RIGHT uzunluğu aşan n bütün metni verir', h('=RIGHT("abc",10)') === 'abc');
ok('RIGHT negatif n #VALUE!', hataMi(h('=RIGHT("abc",-2)'), '#VALUE!'));
ok('RIGHTB tek baytlı ortamda RIGHT ile aynı', h('=RIGHTB("abcdef",2)') === 'ef');
ok('MID ortadan alır', h('=MID("abcdef",2,3)') === 'bcd');
ok('MID başlangıç 0 #VALUE!', hataMi(h('=MID("abcdef",0,2)'), '#VALUE!'));
ok('MID metin dışından başlarsa boş', h('=MID("abcdef",10,2)') === '');
ok('MID negatif uzunluk #VALUE!', hataMi(h('=MID("abcdef",2,-1)'), '#VALUE!'));
ok('MID iki ondalığı da keser', h('=MID("abcdef",2.9,3.9)') === 'bcd');
ok('MID eksik argüman #VALUE!', hataMi(h('=MID("abcdef",2)'), '#VALUE!'));
ok('MIDB tek baytlı ortamda MID ile aynı', h('=MIDB("abcdef",2,3)') === 'bcd');

// ================================================================================
// Ölçme ve harf düzeni
// ================================================================================
ok('LEN metin', h('=LEN("abc")') === 3);
ok('LEN boş metin 0', h('=LEN("")') === 0);
ok('LEN boş hücre 0', h('=LEN(D1)') === 0);
ok('LEN mantık değerinin adını sayar', h('=LEN(TRUE)') === 4);
ok('LEN sayıyı metne çevirip sayar', h('=LEN(12.5)') === 4);
ok('LENB tek baytlı ortamda LEN ile aynı', h('=LENB("abc")') === 3);
ok('UPPER yerel ayara bakmaz: i → I', h('=UPPER("istanbul")') === 'ISTANBUL');
ok('UPPER noktasız ı → I', h('=UPPER("ı")') === 'I');
ok('UPPER ß korunur (ANSI büyüğü yok)', h('=UPPER("straße")') === 'STRAßE');
ok('LOWER İ tek karakterlik i verir', h('=LOWER("İSTANBUL")') === 'istanbul');
ok('LOWER düz', h('=LOWER("ABC dE")') === 'abc de');
ok('LOWER hücreden', h('=LOWER(C3)') === 'istanbul');
ok('PROPER kesmeden sonrasını büyütür', h('=PROPER("o\'brien")') === 'O\'Brien');
ok('PROPER her sözcüğü büyütür', h('=PROPER("this is a TITLE")') === 'This Is A Title');
ok('PROPER rakamdan sonrasını da büyütür', h('=PROPER("2nd place")') === '2Nd Place');
ok('PROPER tireden sonrasını büyütür', h('=PROPER("ahmet-can")') === 'Ahmet-Can');
ok('TRIM baştaki ve sondaki boşluğu atar, içtekini teke indirir', h('=TRIM("  a   b  ")') === 'a b');
ok('TRIM sekmeye dokunmaz', h('=TRIM("a\tb")') === 'a\tb');
ok('TRIM yalnız boşluktan oluşan metni boşaltır', h('=TRIM("   ")') === '');
ok('TRIM hücreden', h('=TRIM(B3)') === 'bol bosluk');
ok('CLEAN denetim karakterini atar', h('=CLEAN("a"&CHAR(7)&"b")') === 'ab');
ok('CLEAN sekmeyi atar (TRIM atmazdı)', h('=CLEAN("a\tb")') === 'ab');
ok('CLEAN boşluğa dokunmaz', h('=CLEAN("a b")') === 'a b');
ok('REPT yineler', h('=REPT("ab",3)') === 'ababab');
ok('REPT sıfır kez boş metin', h('=REPT("a",0)') === '');
ok('REPT negatif #VALUE!', hataMi(h('=REPT("a",-1)'), '#VALUE!'));
ok('REPT ondalığı keser', h('=REPT("a",2.9)') === 'aa');
ok('REPT 32767 sınırını aşarsa #VALUE!', hataMi(h('=REPT("ab",20000)'), '#VALUE!'));

// ================================================================================
// Arama ve değiştirme
// ================================================================================
ok('REPLACE konuma göre değiştirir', h('=REPLACE("abcdef",2,3,"X")') === 'aXef');
ok('REPLACE başlangıç 0 #VALUE!', hataMi(h('=REPLACE("abcdef",0,1,"X")'), '#VALUE!'));
ok('REPLACE metin sonuna ekler', h('=REPLACE("abc",4,0,"d")') === 'abcd');
ok('REPLACE sıfır uzunluk araya sokar', h('=REPLACE("abcdef",2,0,"X")') === 'aXbcdef');
ok('REPLACE negatif uzunluk #VALUE!', hataMi(h('=REPLACE("abc",2,-1,"X")'), '#VALUE!'));
ok('REPLACEB tek baytlı ortamda REPLACE ile aynı', h('=REPLACEB("abcdef",2,3,"X")') === 'aXef');
ok('SUBSTITUTE hepsini değiştirir', h('=SUBSTITUTE("a-b-c","-","+")') === 'a+b+c');
ok('SUBSTITUTE yalnız n\'inci geçişi değiştirir', h('=SUBSTITUTE("a-b-c","-","+",2)') === 'a-b+c');
ok('SUBSTITUTE olmayan geçiş numarası metni değiştirmez', h('=SUBSTITUTE("a-b-c","-","+",5)') === 'a-b-c');
ok('SUBSTITUTE boş eski metin hiçbir şeyi değiştirmez', h('=SUBSTITUTE("abc","","x")') === 'abc');
ok('SUBSTITUTE büyük/küçük harf duyar', h('=SUBSTITUTE("AaA","a","z")') === 'AzA');
ok('SUBSTITUTE boş yeni metin siler', h('=SUBSTITUTE("a-b","-","")') === 'ab');
ok('SUBSTITUTE geçiş numarası 0 #VALUE!', hataMi(h('=SUBSTITUTE("a-b","-","+",0)'), '#VALUE!'));
ok('FIND konum verir', h('=FIND("b","abcabc")') === 2);
ok('FIND başlangıçtan sonrasını arar', h('=FIND("b","abcabc",3)') === 5);
ok('FIND büyük/küçük harf duyar', hataMi(h('=FIND("B","abc")'), '#VALUE!'));
ok('FIND bulamazsa #VALUE! (#N/A değil)', hataMi(h('=FIND("z","abc")'), '#VALUE!'));
ok('FIND başlangıç 0 #VALUE!', hataMi(h('=FIND("a","abc",0)'), '#VALUE!'));
ok('FIND başlangıç metnin ötesinde #VALUE!', hataMi(h('=FIND("a","abc",5)'), '#VALUE!'));
ok('FIND joker TANIMAZ: * düz karakterdir', h('=FIND("*","a*b")') === 2);
ok('FIND boş aranan metin başlangıcı verir', h('=FIND("","abc")') === 1);
ok('FIND sayıyı metne çevirir', h('=FIND(1,"a1b")') === 2);
ok('FINDB tek baytlı ortamda FIND ile aynı', h('=FINDB("b","ab")') === 2);
ok('SEARCH harf duymaz', h('=SEARCH("B","abc")') === 2);
ok('SEARCH yıldız jokerini tanır', h('=SEARCH("b*c","abXc")') === 2);
ok('SEARCH soru işareti jokerini tanır', h('=SEARCH("?c","abc")') === 2);
ok('SEARCH ~ ile joker kaçışı', h('=SEARCH("~*","a*b")') === 2);
ok('SEARCH bulamazsa #VALUE!', hataMi(h('=SEARCH("z","abc")'), '#VALUE!'));
ok('SEARCH başlangıçtan sonrasını arar', h('=SEARCH("a","abcabc",2)') === 4);
ok('SEARCHB tek baytlı ortamda SEARCH ile aynı', h('=SEARCHB("C","abc")') === 3);
ok('EXACT eşit metin', h('=EXACT("abc","abc")') === true);
ok('EXACT harf duyar', h('=EXACT("abc","ABC")') === false);
ok('EXACT sayıyı metne çevirir', h('=EXACT(1,"1")') === true);
ok('EXACT boş hücre boş metne eşittir', h('=EXACT("",A3)') === true);

// ================================================================================
// Sayı ile metin arasındaki geçişler
// ================================================================================
ok('VALUE düz sayı', h('=VALUE("123")') === 123);
ok('VALUE ondalık', yak(h('=VALUE("1.5")'), 1.5));
ok('VALUE baştaki ve sondaki boşluğu atar', h('=VALUE(" 12 ")') === 12);
ok('VALUE yüzde', yak(h('=VALUE("50%")'), 0.5));
ok('VALUE para simgesi ve binlik ayracı', yak(h('=VALUE("$1,234.50")'), 1234.5));
ok('VALUE muhasebe parantezi negatiftir', h('=VALUE("(5)")') === -5);
ok('VALUE sayı olmayan metin #VALUE!', hataMi(h('=VALUE("abc")'), '#VALUE!'));
ok('VALUE boş METİN #VALUE!', hataMi(h('=VALUE("")'), '#VALUE!'));
ok('VALUE boş HÜCRE 0 (boş metinle aynı değil)', h('=VALUE(A3)') === 0);
ok('VALUE mantık değerini çevirmez', hataMi(h('=VALUE(TRUE)'), '#VALUE!'));
ok('VALUE ISO tarihi seri sayıya çevirir', h('=VALUE("2024-01-01")') === 45292);
ok('VALUE saati gün kesrine çevirir', yak(h('=VALUE("12:00")'), 0.5));
ok('NUMBERVALUE ayraçlar elle verilir', yak(h('=NUMBERVALUE("2.500,27",",",".")'), 2500.27));
ok('NUMBERVALUE varsayılan ayraçlar', yak(h('=NUMBERVALUE("1,234.5")'), 1234.5));
ok('NUMBERVALUE sondaki % 100\'e böler', yak(h('=NUMBERVALUE("9%")'), 0.09));
ok('NUMBERVALUE iki % iki kez böler', yak(h('=NUMBERVALUE("9%%")'), 0.0009));
ok('NUMBERVALUE boş metin 0', h('=NUMBERVALUE("")') === 0);
ok('NUMBERVALUE iki ondalık ayracı #VALUE!', hataMi(h('=NUMBERVALUE("1.2.3")'), '#VALUE!'));
ok('NUMBERVALUE aynı iki ayraç #VALUE!', hataMi(h('=NUMBERVALUE("1,5",",",",")'), '#VALUE!'));
ok('NUMBERVALUE içteki boşluklar atılır', h('=NUMBERVALUE("3 4 5")') === 345);
ok('NUMBERVALUE binlik ayracı ondalıktan sonra olamaz', hataMi(h('=NUMBERVALUE("1.2,3",".",",")'), '#VALUE!'));
ok('T metni geçirir', h('=T("abc")') === 'abc');
ok('T sayı için boş metin', h('=T(5)') === '');
ok('T mantık için boş metin', h('=T(TRUE)') === '');
ok('T boş hücre için boş metin', h('=T(A3)') === '');
ok('DOLLAR varsayılan iki hane', h('=DOLLAR(1234.567)') === '$1,234.57');
ok('DOLLAR negatifi paranteze alır', h('=DOLLAR(-1234.567)') === '($1,234.57)');
ok('DOLLAR negatif hane sola yuvarlar', h('=DOLLAR(1234.567,-2)') === '$1,200');
ok('DOLLAR yarımı sıfırdan uzağa atar', h('=DOLLAR(0.5,0)') === '$1');
ok('DOLLAR yerel ayraç ve simge bağlamdan gelir', h('=DOLLAR(1234.567,2)', ctxTR) === '₺1.234,57');
ok('FIXED tek hane', h('=FIXED(1234.567,1)') === '1,234.6');
ok('FIXED binlik ayracı kapatılabilir', h('=FIXED(1234.567,1,TRUE)') === '1234.6');
ok('FIXED varsayılan iki hane', h('=FIXED(1234.567)') === '1,234.57');
ok('FIXED negatif sayı eksi işaretiyle', h('=FIXED(-1234.567,2)') === '-1,234.57');
ok('FIXED negatif hane sola yuvarlar', h('=FIXED(1234.567,-2)') === '1,200');
ok('FIXED 1,005 ikilik tuzağına düşmez', h('=FIXED(1.005,2)') === '1.01');
ok('FIXED yerel ayraçlar bağlamdan gelir', h('=FIXED(1234.567,2)', ctxTR) === '1.234,57');
ok('TEXT binlikli iki hane', h('=TEXT(1234.567,"#,##0.00")') === '1,234.57');
ok('TEXT yarımı sıfırdan uzağa atar', h('=TEXT(0.285,"0.00")') === '0.29');
ok('TEXT tam sayı kodu', h('=TEXT(1234.6,"0")') === '1235');
ok('TEXT binliksiz binlikli ayrımı', h('=TEXT(1234.5,"#,##0")') === '1,235');
ok('TEXT yüzde', h('=TEXT(0.5,"0%")') === '50%');
ok('TEXT iki haneli yüzde', h('=TEXT(0.1234,"0.00%")') === '12.34%');
ok('TEXT ISO tarih kodu', h('=TEXT(45292,"yyyy-mm-dd")') === '2024-01-01');
ok('TEXT Türkçe tarih kodu', h('=TEXT(45292.5,"gg/aa/yyyy")') === '01/01/2024');
ok('TEXT İngilizce tarih kodu', h('=TEXT(45292,"dd/mm/yyyy")') === '01/01/2024');
ok('TEXT saat kodu', h('=TEXT(0.75,"ss:dd:ss")') === '18:00:00');
ok('TEXT General', h('=TEXT(5.25,"General")') === '5.25');
ok('TEXT sayı olmayan metni biçimlemeden geçirir', h('=TEXT("abc","0.00")') === 'abc');
ok('TEXT mantık değerini adıyla yazar', h('=TEXT(TRUE,"0")') === 'TRUE');
ok('TEXT negatif sayı', h('=TEXT(-0.5,"0")') === '-1');
ok('TEXT tanınmayan kod yedekte General gibi davranır', h('=TEXT(5,"[$-41F]dddd")') === '5');
ok('TEXT yerel ayraçlar bağlamdan gelir', h('=TEXT(1234.5,"#,##0.00")', ctxTR) === '1.234,50');
ok('TEXT ctx.bicim varsa işi ona bırakır', h('=TEXT(5,"0.00")', ctxBicim) === '«0.00:5»');
ok('TEXT eksik argüman #VALUE!', hataMi(h('=TEXT(5)'), '#VALUE!'));

// ================================================================================
// Karakter kodları
// ================================================================================
ok('CHAR ASCII', h('=CHAR(65)') === 'A');
ok('CHAR 128 Windows-1252 avro işareti', h('=CHAR(128)') === '€');
ok('CHAR 0 #VALUE!', hataMi(h('=CHAR(0)'), '#VALUE!'));
ok('CHAR 256 #VALUE!', hataMi(h('=CHAR(256)'), '#VALUE!'));
ok('CHAR ondalığı keser', h('=CHAR(65.9)') === 'A');
ok('CODE ilk karakterin kodu', h('=CODE("A")') === 65);
ok('CODE yalnız ilk karaktere bakar', h('=CODE("Ab")') === 65);
ok('CODE avro işareti ANSI\'de 128', h('=CODE("€")') === 128);
ok('CODE boş metin #VALUE!', hataMi(h('=CODE("")'), '#VALUE!'));
ok('CODE ANSI dışı karakter 63 (soru işareti)', h('=CODE("😀")') === 63);
ok('CHAR ile CODE birbirinin tersi', h('=CODE(CHAR(200))') === 200);
ok('UNICHAR ASCII', h('=UNICHAR(65)') === 'A');
ok('UNICHAR Unicode kod noktası', h('=UNICHAR(8364)') === '€');
ok('UNICHAR 0 #VALUE!', hataMi(h('=UNICHAR(0)'), '#VALUE!'));
ok('UNICHAR yarım vekil karakter #N/A', hataMi(h('=UNICHAR(55296)'), '#N/A'));
ok('UNICHAR sınır üstü #VALUE!', hataMi(h('=UNICHAR(1114112)'), '#VALUE!'));
ok('UNICODE kod noktası', h('=UNICODE("A")') === 65);
ok('UNICODE vekil çiftini tek kod noktası sayar', h('=UNICODE("😀")') === 128512);
ok('UNICODE boş metin #VALUE!', hataMi(h('=UNICODE("")'), '#VALUE!'));

// ================================================================================
// Çift baytlı dil işlevleri
// ================================================================================
ok('ASC tam genişliği yarım genişliğe indirir', h('=ASC("ＡＢＣ")') === 'ABC');
ok('ASC ideografik boşluk düz boşluk olur', h('=ASC("　")') === ' ');
ok('ASC eşlemesi olmayan karaktere dokunmaz', h('=ASC("あ")') === 'あ');
ok('JIS yarım genişliği tam genişliğe çıkarır', h('=JIS("ABC")') === 'ＡＢＣ');
ok('JIS boşluk ideografik boşluk olur', h('=JIS(" ")') === '　');
ok('DBCS JIS ile aynı işlevdir', h('=DBCS("A")') === 'Ａ');
ok('ASC ile JIS birbirinin tersi', h('=ASC(JIS("a1!"))') === 'a1!');
ok('PHONETIC veri yoksa girdiyi olduğu gibi verir', h('=PHONETIC("カタカナ")') === 'カタカナ');
ok('PHONETIC hücreden okur', h('=PHONETIC(A1)') === 'ab');

// ================================================================================
// Yeni metin ailesi
// ================================================================================
ok('TEXTBEFORE ilk ayraca kadar', h('=TEXTBEFORE("a-b-c","-")') === 'a');
ok('TEXTBEFORE ikinci ayraca kadar', h('=TEXTBEFORE("a-b-c","-",2)') === 'a-b');
ok('TEXTBEFORE negatif sıra sondan sayar', h('=TEXTBEFORE("a-b-c","-",-1)') === 'a-b');
ok('TEXTBEFORE baştaki ayraç boş metin verir', h('=TEXTBEFORE("-abc","-")') === '');
ok('TEXTBEFORE bulunamazsa #N/A', hataMi(h('=TEXTBEFORE("abc","x")'), '#N/A'));
ok('TEXTBEFORE metin sonu ayraç sayılırsa tamamını verir', h('=TEXTBEFORE("abc","x",1,0,1)') === 'abc');
ok('TEXTBEFORE bulunamadı karşılığı verilebilir', h('=TEXTBEFORE("abc","x",1,0,0,"yok")') === 'yok');
ok('TEXTBEFORE varsayılan harf duyarlıdır', hataMi(h('=TEXTBEFORE("aXb","x")'), '#N/A'));
ok('TEXTBEFORE eşleme kipi 1 harf duymaz', h('=TEXTBEFORE("aXb","x",1,1)') === 'a');
ok('TEXTBEFORE sıra 0 #VALUE!', hataMi(h('=TEXTBEFORE("a-b","-",0)'), '#VALUE!'));
ok('TEXTAFTER ilk ayraçtan sonrası', h('=TEXTAFTER("a-b-c","-")') === 'b-c');
ok('TEXTAFTER negatif sıra sondan sayar', h('=TEXTAFTER("a-b-c","-",-1)') === 'c');
ok('TEXTAFTER metin sonu ayraç sayılırsa boş verir', h('=TEXTAFTER("abc","x",1,0,1)') === '');
ok('TEXTAFTER çoklu ayraç', h('=TEXTAFTER("a1b2c",{"1","2"})') === 'b2c');
ok('TEXTAFTER bulunamazsa #N/A', hataMi(h('=TEXTAFTER("abc","x")'), '#N/A'));
ok('TEXTAFTER boş metin boş verir', h('=TEXTAFTER("","-")') === '');
ok('TEXTSPLIT sütunlara böler', ayni(h('=TEXTSPLIT("a,b,c",",")'), [['a', 'b', 'c']]));
ok('TEXTSPLIT satır ve sütuna böler', ayni(h('=TEXTSPLIT("a,b;c,d",",",";")'), [['a', 'b'], ['c', 'd']]));
ok('TEXTSPLIT ardışık ayraç boş hücre bırakır', ayni(h('=TEXTSPLIT("a,,b",",")'), [['a', '', 'b']]));
ok('TEXTSPLIT boşları atlama seçeneği', ayni(h('=TEXTSPLIT("a,,b",",",,TRUE)'), [['a', 'b']]));
ok('TEXTSPLIT kısa satırı #N/A ile doldurur', ayni(h('=TEXTSPLIT("a,b;c",",",";")'), [['a', 'b'], ['c', { e: '#N/A' }]]));
ok('TEXTSPLIT dolgu değeri verilebilir', ayni(h('=TEXTSPLIT("a,b;c",",",";",FALSE,0,"-")'), [['a', 'b'], ['c', '-']]));
ok('TEXTSPLIT eşleme kipi 1 harf duymaz', ayni(h('=TEXTSPLIT("aXbxc","x",,FALSE,1)'), [['a', 'b', 'c']]));
ok('TEXTSPLIT çoklu ayraç', ayni(h('=TEXTSPLIT("a1b2c",{"1","2"})'), [['a', 'b', 'c']]));
ok('ARRAYTOTEXT kısa kip', h('=ARRAYTOTEXT({1,2;3,4})') === '1, 2, 3, 4');
ok('ARRAYTOTEXT kesin kip dizi sabiti yazar', h('=ARRAYTOTEXT({1,2;3,4},1)') === '{1,2;3,4}');
ok('ARRAYTOTEXT kesin kipte metin tırnaklanır', h('=ARRAYTOTEXT({1,"a"},1)') === '{1,"a"}');
ok('ARRAYTOTEXT aralıktan', h('=ARRAYTOTEXT(A1:B1)') === 'ab, CD');
ok('ARRAYTOTEXT geçersiz kip #VALUE!', hataMi(h('=ARRAYTOTEXT({1},2)'), '#VALUE!'));
ok('VALUETOTEXT kısa kip', h('=VALUETOTEXT("abc")') === 'abc');
ok('VALUETOTEXT kesin kipte tırnaklar', h('=VALUETOTEXT("abc",1)') === '"abc"');
ok('VALUETOTEXT sayı', h('=VALUETOTEXT(5)') === '5');
ok('VALUETOTEXT mantık', h('=VALUETOTEXT(TRUE)') === 'TRUE');
ok('VALUETOTEXT hatayı yaymaz, yazıya döker', h('=VALUETOTEXT(#N/A)') === '#N/A');
ok('ENCODEURL boşluk', h('=ENCODEURL("a b")') === 'a%20b');
ok('ENCODEURL ünlem de kodlanır', h('=ENCODEURL("a!b")') === 'a%21b');
ok('ENCODEURL UTF-8', h('=ENCODEURL("ç")') === '%C3%A7');
ok('ENCODEURL ayraçlar', h('=ENCODEURL("a/b?c=1")') === 'a%2Fb%3Fc%3D1');

// ================================================================================
// Düzenli ifade ailesi
// ================================================================================
ok('REGEXTEST eşleşme var', h('=REGEXTEST("abc123","\\d+")') === true);
ok('REGEXTEST eşleşme yok', h('=REGEXTEST("abc","\\d+")') === false);
ok('REGEXTEST varsayılan harf duyarlıdır', h('=REGEXTEST("ABC","abc")') === false);
ok('REGEXTEST duyarlılık 1 harf duymaz', h('=REGEXTEST("ABC","abc",1)') === true);
ok('REGEXTEST geçersiz kalıp #VALUE!', hataMi(h('=REGEXTEST("a","[")'), '#VALUE!'));
ok('REGEXEXTRACT ilk eşleşme', h('=REGEXEXTRACT("abc123def","\\d+")') === '123');
ok('REGEXEXTRACT bütün eşleşmeler sütun dizisi', ayni(h('=REGEXEXTRACT("a1b2","\\d",1)'), [['1'], ['2']]));
ok('REGEXEXTRACT yakalama öbekleri satır dizisi', ayni(h('=REGEXEXTRACT("2026-01","(\\d+)-(\\d+)",2)'), [['2026', '01']]));
ok('REGEXEXTRACT eşleşme yoksa #N/A', hataMi(h('=REGEXEXTRACT("abc","\\d")'), '#N/A'));
ok('REGEXREPLACE varsayılan hepsini değiştirir', h('=REGEXREPLACE("a1b2","\\d","#")') === 'a#b#');
ok('REGEXREPLACE n\'inci geçişi değiştirir', h('=REGEXREPLACE("a1b2","\\d","#",1)') === 'a#b2');
ok('REGEXREPLACE negatif sıra sondan sayar', h('=REGEXREPLACE("a1b2","\\d","#",-1)') === 'a1b#');
ok('REGEXREPLACE yakalama öbeğine gönderme', h('=REGEXREPLACE("ab","(a)(b)","$2$1")') === 'ba');

// ================================================================================
// Dizi yayılımı, hata yayılımı ve kayıt
// ================================================================================
ok('UPPER dizi üzerinde yayılır', ayni(h('=UPPER({"a","b"})'), [['A', 'B']]));
ok('LEFT dizi üzerinde yayılır', ayni(h('=LEFT({"abc","xyz"},1)'), [['a', 'x']]));
ok('LEN aralık üzerinde yayılır', ayni(h('=LEN(A1:B1)'), [[2, 2]]));
ok('EXACT iki diziyi eşler', ayni(h('=EXACT({"a","b"},{"a","x"})'), [[true, false]]));
ok('hata argümandan yayılır', hataMi(h('=UPPER(#DIV/0!)'), '#DIV/0!'));
ok('hata iç içe işlevden yayılır', hataMi(h('=LEN(LEFT("abc",-1))'), '#VALUE!'));
ok('çok argüman #VALUE!', hataMi(h('=LEFT("abc",1,2)'), '#VALUE!'));
ok('eksik argüman #VALUE!', hataMi(h('=LEN()'), '#VALUE!'));
ok('kaydedilmemiş ad #NAME? verir', hataMi(h('=BOYLEBIRMETINISLEVIYOK("a")'), '#NAME?'));
ok('_xlfn öneki soyuluyor (_xlfn.TEXTJOIN)', h('=_xlfn.TEXTJOIN("-",TRUE,"a","b")') === 'a-b');

const ADLAR = ['CONCAT', 'CONCATENATE', 'TEXTJOIN', 'LEFT', 'LEFTB', 'RIGHT', 'RIGHTB', 'MID', 'MIDB',
  'LEN', 'LENB', 'LOWER', 'UPPER', 'PROPER', 'TRIM', 'CLEAN', 'REPT', 'REPLACE', 'REPLACEB',
  'SUBSTITUTE', 'FIND', 'FINDB', 'SEARCH', 'SEARCHB', 'EXACT', 'VALUE', 'NUMBERVALUE', 'T', 'CHAR',
  'CODE', 'UNICHAR', 'UNICODE', 'DOLLAR', 'FIXED', 'ASC', 'JIS', 'DBCS', 'PHONETIC', 'TEXTBEFORE',
  'TEXTAFTER', 'TEXTSPLIT', 'ARRAYTOTEXT', 'VALUETOTEXT', 'ENCODEURL', 'TEXT',
  'REGEXTEST', 'REGEXEXTRACT', 'REGEXREPLACE'];
ok('kayıt: hedefteki ' + ADLAR.length + ' işlevin hepsi tanınıyor', ADLAR.every((a) => X.bilinen(a)),
  '→ eksik: ' + ADLAR.filter((a) => !X.bilinen(a)).join(', '));

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
