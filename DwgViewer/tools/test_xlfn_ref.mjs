// Excel formül motoru — ARAMA, BAŞVURU ve DİNAMİK DİZİ sınaması.
// Playwright kullanmaz; depo kökünden "node tools/test_xlfn_ref.mjs" ile koşar.
import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_ref.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// --------------------------------------------------------------------------------
// Sahte bağlam
// --------------------------------------------------------------------------------
//        A(0)      B(1)  C(2)   D(3)   E(4)
// 1 (r0) 'Ad'      'Kod' 'Fiyat' 'Say' 'Grup'
// 2 (r1) 'Elma'    10    2,5     3     'A'
// 3 (r2) 'Armut'   20    4       boş   'B'
// 4 (r3) 'Kiraz'   30    7,5     5     'A'
// 5 (r4) 'Muz'     40    1,5     2     'B'
// 6 (r5) boş       50    0       9     'A'
const SAYFA = {
  S1: [
    ['Ad', 'Kod', 'Fiyat', 'Say', 'Grup'],
    ['Elma', 10, 2.5, 3, 'A'],
    ['Armut', 20, 4, null, 'B'],
    ['Kiraz', 30, 7.5, 5, 'A'],
    ['Muz', 40, 1.5, 2, 'B'],
    [null, 50, 0, 9, 'A'],
  ],
  Sayfa2: [[5], [10], [15], [20]],
};
const FORMUL = { 'S1|1|2': '2*B2', 'S1|2|2': '=B3*2' };
const ADLAR = { KODLAR: { sayfa: 'S1', r1: 1, c1: 1, r2: 5, c2: 1 } };

const ctx = {
  sayfa: 'S1',
  hucre: { r: 2, c: 1 },              // C3 değil B3: ROW() = 3, COLUMN() = 2
  oku: (s, r, c) => { const t = SAYFA[s || 'S1']; if (!t || !t[r]) return null; const v = t[r][c]; return v === undefined ? null : v; },
  boyut: (s) => { const t = SAYFA[s || 'S1'] || []; return { r: t.length, c: t.length ? t[0].length : 0 }; },
  ad: (i) => ADLAR[String(i).toUpperCase()],
  formul: (s, r, c) => FORMUL[(s || 'S1') + '|' + r + '|' + c] || null,
  simdi: () => 46000.5,
  rastgele: () => 0.5,
};

/*
 * SUM matematik modülünün işidir; bu sınama yalnız çekirdeğe ve kendi modülüne dayansın diye
 * toplama yerel bir işlevle yapılır. Başvuru döndüren işlevlerin DEĞER bağlamında da
 * çalıştığını göstermenin tek yolu onları böyle bir işleve argüman vermektir.
 */
X.kaydet('TOPLA', { en: 1, ek: -1, fn: (a) => X.duzle(a).reduce((t, v) => t + (typeof v === 'number' ? v : 0), 0) });

const h = (f) => X.hesapla(f, ctx);
const hataMi = (v, kod) => X.hata(v) && v.e === kod;
const gor = (v) => (X.hata(v) ? v.e : JSON.stringify(v));
/** Başvuru döndüren işlev 1x1 dizi verir; skaler beklenen yerde içi okunur */
const d1 = (v) => (Array.isArray(v) ? v.flat()[0] : v);
function es(a, b) {
  if (X.hata(a) || X.hata(b)) return X.hata(a) && X.hata(b) && a.e === b.e;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => es(x, b[i]));
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  return a === b;
}
const NA = X.ERR.NA;

// ================================================================================
// VLOOKUP
// ================================================================================
ok('VLOOKUP tam eşleşme', h('=VLOOKUP("Kiraz",A2:C6,3,FALSE)') === 7.5, gor(h('=VLOOKUP("Kiraz",A2:C6,3,FALSE)')));
ok('VLOOKUP ikinci sütun', h('=VLOOKUP("Armut",A2:C6,2,FALSE)') === 20);
ok('VLOOKUP büyük/küçük harf duymaz', h('=VLOOKUP("elma",A2:C6,3,FALSE)') === 2.5);
ok('VLOOKUP bulunamadı → #N/A', hataMi(h('=VLOOKUP("Yok",A2:C6,2,FALSE)'), '#N/A'));
ok('VLOOKUP tam eşleşmede joker', h('=VLOOKUP("Ki*",A2:C6,1,FALSE)') === 'Kiraz');
ok('VLOOKUP joker ? tek karakter', h('=VLOOKUP("M?z",A2:C6,3,FALSE)') === 1.5);
ok('VLOOKUP yaklaşık: küçük-eşitlerin en büyüğü', h('=VLOOKUP(25,B2:C6,2)') === 4);
ok('VLOOKUP yaklaşık: tam değer', h('=VLOOKUP(40,B2:C6,2)') === 1.5);
ok('VLOOKUP yaklaşık: hepsi büyükse #N/A', hataMi(h('=VLOOKUP(5,B2:C6,2)'), '#N/A'));
ok('VLOOKUP yaklaşık: son satırın üstü', h('=VLOOKUP(500,B2:C6,2)') === 0);
ok('VLOOKUP sütun 0 → #VALUE!', hataMi(h('=VLOOKUP(10,B2:C6,0)'), '#VALUE!'));
ok('VLOOKUP sütun taşması → #REF!', hataMi(h('=VLOOKUP(10,B2:C6,5)'), '#REF!'));
ok('VLOOKUP boş bırakılmış 4. argüman TAM eşleşmedir', hataMi(h('=VLOOKUP(25,B2:C6,2,)'), '#N/A'));
ok('VLOOKUP eksik argüman → #VALUE!', hataMi(h('=VLOOKUP(1,B2:C6)'), '#VALUE!'));
ok('VLOOKUP aranan değer hatası yayılır', hataMi(h('=VLOOKUP(1/0,B2:C6,2)'), '#DIV/0!'));
ok('VLOOKUP dizi sabitiyle', h('=VLOOKUP("b",{"a",1;"b",2},2,FALSE)') === 2);

// ================================================================================
// HLOOKUP
// ================================================================================
ok('HLOOKUP tam eşleşme', h('=HLOOKUP(2,{1,2,3;"a","b","c"},2,FALSE)') === 'b');
ok('HLOOKUP yaklaşık', h('=HLOOKUP(2.5,{1,2,3;"a","b","c"},2)') === 'b');
ok('HLOOKUP bulunamadı → #N/A', hataMi(h('=HLOOKUP(9,{1,2,3;"a","b","c"},2,FALSE)'), '#N/A'));
ok('HLOOKUP satır taşması → #REF!', hataMi(h('=HLOOKUP(1,{1,2,3;"a","b","c"},3,FALSE)'), '#REF!'));
ok('HLOOKUP satır 0 → #VALUE!', hataMi(h('=HLOOKUP(1,{1,2,3;"a","b","c"},0)'), '#VALUE!'));
ok('HLOOKUP sayfadan yatay arama', h('=HLOOKUP("Fiyat",A1:E2,2,FALSE)') === 2.5);
ok('HLOOKUP jokerli', h('=HLOOKUP("Fi*",A1:E2,2,FALSE)') === 2.5);

// ================================================================================
// LOOKUP
// ================================================================================
ok('LOOKUP vektör biçimi', h('=LOOKUP(25,B2:B6,A2:A6)') === 'Armut');
ok('LOOKUP sonuç vektörsüz', h('=LOOKUP(30,B2:B6)') === 30);
ok('LOOKUP altında kalırsa #N/A', hataMi(h('=LOOKUP(5,B2:B6)'), '#N/A'));
ok('LOOKUP dizi biçimi (geniş dizi: ilk satırda arar, son satırı verir)', h('=LOOKUP(2,{1,2,3;"a","b","c"})') === 'b');
ok('LOOKUP dizi biçimi (uzun dizi: ilk sütunda arar, son sütunu verir)', h('=LOOKUP(20,B2:C6)') === 4, gor(h('=LOOKUP(20,B2:C6)')));
ok('LOOKUP hataları ATLAR: 1/(koşul) kalıbı', h('=LOOKUP(2,1/(A2:A6="Kiraz"),C2:C6)') === 7.5, gor(h('=LOOKUP(2,1/(A2:A6="Kiraz"),C2:C6)')));
ok('LOOKUP kalıbı SON eşleşmeyi verir', h('=LOOKUP(2,1/(E2:E6="A"),C2:C6)') === 0, gor(h('=LOOKUP(2,1/(E2:E6="A"),C2:C6)')));
ok('LOOKUP aranan değer hatası yayılır', hataMi(h('=LOOKUP(1/0,B2:B6)'), '#DIV/0!'));
ok('LOOKUP metinde', h('=LOOKUP("Elma",{"Armut";"Elma";"Kiraz"},{1;2;3})') === 2);

// ================================================================================
// XLOOKUP
// ================================================================================
ok('XLOOKUP tam eşleşme', h('=XLOOKUP("Muz",A2:A6,C2:C6)') === 1.5);
ok('XLOOKUP bulunamadı → #N/A', hataMi(h('=XLOOKUP("Yok",A2:A6,C2:C6)'), '#N/A'));
ok('XLOOKUP bulunamadı → 4. argüman', h('=XLOOKUP("Yok",A2:A6,C2:C6,"-")') === '-');
ok('XLOOKUP eşleşme kipi -1 (küçük-eşit)', h('=XLOOKUP(25,B2:B6,A2:A6,,-1)') === 'Armut');
ok('XLOOKUP eşleşme kipi 1 (büyük-eşit)', h('=XLOOKUP(25,B2:B6,A2:A6,,1)') === 'Kiraz');
ok('XLOOKUP ikili arama (arama kipi 2)', h('=XLOOKUP(30,B2:B6,A2:A6,,0,2)') === 'Kiraz');
ok('XLOOKUP joker (eşleşme kipi 2)', h('=XLOOKUP("K*",A2:A6,C2:C6,,2)') === 7.5);
ok('XLOOKUP joker kipi kapalıyken yıldız harfidir', hataMi(h('=XLOOKUP("K*",A2:A6,C2:C6)'), '#N/A'));
ok('XLOOKUP sondan arar (arama kipi -1)', h('=XLOOKUP("A",E2:E6,C2:C6,,0,-1)') === 0);
ok('XLOOKUP baştan arar (varsayılan)', h('=XLOOKUP("A",E2:E6,C2:C6)') === 2.5);
ok('XLOOKUP çok sütunlu sonuç satır verir', es(h('=XLOOKUP("Elma",A2:A6,B2:C6)'), [[10, 2.5]]), gor(h('=XLOOKUP("Elma",A2:A6,B2:C6)')));
ok('XLOOKUP boy uyuşmazlığı → #VALUE!', hataMi(h('=XLOOKUP("Elma",A2:A6,B2:B7)'), '#VALUE!'));
ok('XLOOKUP geçersiz eşleşme kipi → #VALUE!', hataMi(h('=XLOOKUP("Elma",A2:A6,C2:C6,,5)'), '#VALUE!'));
ok('XLOOKUP geçersiz arama kipi → #VALUE!', hataMi(h('=XLOOKUP("Elma",A2:A6,C2:C6,,0,3)'), '#VALUE!'));
ok('XLOOKUP yatay dizi', h('=XLOOKUP(2,{1,2,3},{"a","b","c"})') === 'b');
ok('XLOOKUP boş hücre bulur', h('=XLOOKUP(20,B2:B6,D2:D6)') === null);

// ================================================================================
// MATCH
// ================================================================================
ok('MATCH tam (0)', h('=MATCH("Kiraz",A2:A6,0)') === 3);
ok('MATCH tam: joker', h('=MATCH("K*",A2:A6,0)') === 3);
ok('MATCH artan (1)', h('=MATCH(25,B2:B6,1)') === 2);
ok('MATCH varsayılan tür 1', h('=MATCH(25,B2:B6)') === 2);
ok('MATCH artan: altında kalırsa #N/A', hataMi(h('=MATCH(5,B2:B6,1)'), '#N/A'));
ok('MATCH azalan (-1)', h('=MATCH(25,{50,40,30,20,10},-1)') === 3);
ok('MATCH azalan: üstünde kalırsa #N/A', hataMi(h('=MATCH(60,{50,40,30,20,10},-1)'), '#N/A'));
ok('MATCH bulunamadı → #N/A', hataMi(h('=MATCH("Yok",A2:A6,0)'), '#N/A'));
ok('MATCH boş bırakılmış tür 0 sayılır (yaklaşık olsa 2 verirdi)', hataMi(h('=MATCH(25,B2:B6,)'), '#N/A'));
ok('MATCH tür uyuşmalı: 1 ile DOĞRU eşleşmez', h('=MATCH(TRUE,{1,TRUE},0)') === 2);
ok('MATCH sayı metinle eşleşmez', hataMi(h('=MATCH(1,{"1","2"},0)'), '#N/A'));
ok('MATCH yatay aralıkta', h('=MATCH("Say",A1:E1,0)') === 4);

// ================================================================================
// XMATCH
// ================================================================================
ok('XMATCH varsayılan tam eşleşme', h('=XMATCH("Muz",A2:A6)') === 4);
ok('XMATCH küçük-eşit (-1)', h('=XMATCH(25,B2:B6,-1)') === 2);
ok('XMATCH büyük-eşit (1)', h('=XMATCH(25,B2:B6,1)') === 3);
ok('XMATCH joker (2)', h('=XMATCH("K*",A2:A6,2)') === 3);
ok('XMATCH ikili arama (2)', h('=XMATCH(30,B2:B6,0,2)') === 3);
ok('XMATCH ikili azalan (-2)', h('=XMATCH(30,{50,40,30,20,10},0,-2)') === 3);
ok('XMATCH sondan arama (-1)', h('=XMATCH("A",E2:E6,0,-1)') === 5);
ok('XMATCH baştan arama', h('=XMATCH("A",E2:E6)') === 1);
ok('XMATCH bulunamadı → #N/A', hataMi(h('=XMATCH("Yok",A2:A6)'), '#N/A'));
ok('XMATCH geçersiz kip → #VALUE!', hataMi(h('=XMATCH(1,B2:B6,3)'), '#VALUE!'));
ok('XMATCH sırasız veride küçük-eşit', h('=XMATCH(35,{10,50,30,40,20},-1)') === 3);
ok('XMATCH sırasız veride büyük-eşit', h('=XMATCH(35,{10,50,30,40,20},1)') === 4);

// ================================================================================
// INDEX
// ================================================================================
ok('INDEX satır/sütun', d1(h('=INDEX(A2:C6,3,1)')) === 'Kiraz');
ok('INDEX sonucu 1x1 DİZİdir (başvuru künyesi taşır)', es(h('=INDEX(A2:C6,3,1)'), [['Kiraz']]));
ok('INDEX satır 0 → tüm sütun', h('=TOPLA(INDEX(A2:C6,0,2))') === 150);
ok('INDEX sütun 0 → tüm satır', h('=TOPLA(INDEX(A2:C6,2,0))') === 24);
ok('INDEX başvuru döndürür: INDEX(..):INDEX(..)', h('=TOPLA(INDEX(B2:B6,2):INDEX(B2:B6,4))') === 90, gor(h('=TOPLA(INDEX(B2:B6,2):INDEX(B2:B6,4))')));
ok('INDEX satır taşması → #REF!', hataMi(h('=INDEX(B2:B6,9)'), '#REF!'));
ok('INDEX negatif dizin → #VALUE!', hataMi(h('=INDEX(B2:B6,-1)'), '#VALUE!'));
ok('INDEX sütun taşması → #REF!', hataMi(h('=INDEX(A2:C6,1,4)'), '#REF!'));
ok('INDEX tek satırlık dizide tek dizin SÜTUNdur', h('=INDEX({1,2,3},2)') === 2);
ok('INDEX tek sütunlu dizide tek dizin satırdır', h('=INDEX({1;2;3},2)') === 2);
ok('INDEX iki boyutlu dizi sabiti', h('=INDEX({1,2;3,4},2,2)') === 4);
ok('INDEX kesirli dizin kesilir', d1(h('=INDEX(B2:B6,2.9)')) === 20);
ok('INDEX alan seçimi (4. argüman)', h('=TOPLA(INDEX((A2:A6,B2:B6),0,1,2))') === 150, gor(h('=TOPLA(INDEX((A2:A6,B2:B6),0,1,2))')));
ok('INDEX geçersiz alan → #REF!', hataMi(h('=INDEX((A2:A6,B2:B6),1,1,3)'), '#REF!'));
ok('INDEX satır sayısı korunur', h('=ROWS(INDEX(A2:C6,0,1))') === 5);
ok('INDEX sütun sayısı korunur', h('=COLUMNS(INDEX(A2:C6,1,0))') === 3);
ok('INDEX dizin hatası yayılır', hataMi(h('=INDEX(B2:B6,1/0)'), '#DIV/0!'));
ok('INDEX hücredeki hatayı olduğu gibi verir', hataMi(d1(h('=INDEX({1,#DIV/0!},2)')), '#DIV/0!'), gor(h('=INDEX({1,#DIV/0!},2)')));
ok('INDEX boş hücre boş döner', d1(h('=INDEX(D2:D6,2)')) === null);

// ================================================================================
// OFFSET
// ================================================================================
ok('OFFSET tek hücre', d1(h('=OFFSET(A1,1,1)')) === 10);
ok('OFFSET DEĞER bağlamında çalışır', h('=TOPLA(OFFSET(A1,1,1,5,1))') === 150);
ok('OFFSET yüksekliği/genişliği', h('=TOPLA(OFFSET(C2,0,0,3,1))') === 14);
ok('OFFSET negatif yükseklik yukarı açılır', h('=TOPLA(OFFSET(B6,0,0,-2,1))') === 90, gor(h('=TOPLA(OFFSET(B6,0,0,-2,1))')));
ok('OFFSET negatif genişlik sola açılır', h('=TOPLA(OFFSET(C2,0,0,1,-2))') === 12.5, gor(h('=TOPLA(OFFSET(C2,0,0,1,-2))')));
ok('OFFSET pencere boyu verilmezse çıpadan alınır', h('=TOPLA(OFFSET(A1:B2,1,1))') === 36.5, gor(h('=TOPLA(OFFSET(A1:B2,1,1))')));
ok('OFFSET sayfa dışına taşarsa #REF!', hataMi(h('=OFFSET(A1,-1,0)'), '#REF!'));
ok('OFFSET sıfır yükseklik → #REF!', hataMi(h('=OFFSET(A1,0,0,0,1)'), '#REF!'));
ok('OFFSET sıfır genişlik → #REF!', hataMi(h('=OFFSET(A1,0,0,1,0)'), '#REF!'));
ok('OFFSET başvuru olmayanı kaydırmaz → #VALUE!', hataMi(h('=OFFSET({1,2},1,1)'), '#VALUE!'));
ok('OFFSET satır sayısı', h('=ROWS(OFFSET(A1,0,0,3,2))') === 3);
ok('OFFSET sütun sayısı', h('=COLUMNS(OFFSET(A1,0,0,3,2))') === 2);
ok('OFFSET boş bırakılmış kaydırma 0 sayılır', d1(h('=OFFSET(B2,,)')) === 10);
ok('OFFSET kaydırma hatası yayılır', hataMi(h('=OFFSET(A1,1/0,0)'), '#DIV/0!'));
ok('OFFSET başvuru döndürür: OFFSET(..):OFFSET(..)', h('=TOPLA(OFFSET(B2,0,0):OFFSET(B2,2,0))') === 60, gor(h('=TOPLA(OFFSET(B2,0,0):OFFSET(B2,2,0))')));

// ================================================================================
// INDIRECT
// ================================================================================
ok('INDIRECT A1 yazımı', d1(h('=INDIRECT("B2")')) === 10);
ok('INDIRECT aralık', h('=TOPLA(INDIRECT("B2:B6"))') === 150);
ok('INDIRECT mutlak imleri', h('=TOPLA(INDIRECT("$B$2:$B$3"))') === 30);
ok('INDIRECT başka sayfa', h('=TOPLA(INDIRECT("Sayfa2!A1:A4"))') === 50);
ok('INDIRECT tanımlı ad', h('=TOPLA(INDIRECT("Kodlar"))') === 150);
ok('INDIRECT tanınmayan ad → #REF!', hataMi(h('=INDIRECT("YokBoyleAd")'), '#REF!'));
ok('INDIRECT bozuk metin → #REF!', hataMi(h('=INDIRECT("bozuk!!")'), '#REF!'));
ok('INDIRECT işlev metni başvuru değildir → #REF!', hataMi(h('=INDIRECT("SUM(B2)")'), '#REF!'));
ok('INDIRECT boş metin → #REF!', hataMi(h('=INDIRECT("")'), '#REF!'));
ok('INDIRECT R1C1 mutlak', d1(h('=INDIRECT("R2C2",FALSE)')) === 10);
ok('INDIRECT R1C1 aralık', h('=TOPLA(INDIRECT("R2C2:R6C2",FALSE))') === 150);
ok('INDIRECT R1C1 göreli (hücre B3)', d1(h('=INDIRECT("R[-1]C",FALSE)')) === 10);
ok('INDIRECT R1C1 yalnız C geçerli sütundur', d1(h('=INDIRECT("R1C",FALSE)')) === 'Kod');
ok('INDIRECT R1C1 sayfa dışı → #REF!', hataMi(h('=INDIRECT("R0C1",FALSE)'), '#REF!'));
ok('INDIRECT R1C1 A1 kipinde okunmaz', hataMi(h('=INDIRECT("R2C2")'), '#REF!'));
ok('INDIRECT başvuru döndürür (ROWS ile)', h('=ROWS(INDIRECT("A1:C3"))') === 3);

// ================================================================================
// ROW · COLUMN · ROWS · COLUMNS
// ================================================================================
ok('ROW() geçerli satır', h('=ROW()') === 3);
ok('COLUMN() geçerli sütun', h('=COLUMN()') === 2);
ok('ROW(başvuru)', h('=ROW(B4)') === 4);
ok('COLUMN(başvuru)', h('=COLUMN(C1)') === 3);
ok('ROW(aralık) dizi verir', es(h('=ROW(A2:A4)'), [[2], [3], [4]]), gor(h('=ROW(A2:A4)')));
ok('COLUMN(aralık) dizi verir', es(h('=COLUMN(A1:C1)'), [[1, 2, 3]]), gor(h('=COLUMN(A1:C1)')));
ok('ROW dizisi toplanabilir', h('=TOPLA(ROW(A2:A4))') === 9);
ok('ROW(2 boyutlu) satır vektörü verir', es(h('=ROW(A2:C3)'), [[2], [3]]));
ok('COLUMN(2 boyutlu) sütun vektörü verir', es(h('=COLUMN(A2:C3)'), [[1, 2, 3]]));
ok('ROW başvuru olmayanda #VALUE!', hataMi(h('=ROW("x")'), '#VALUE!'));
ok('COLUMN başvuru olmayanda #VALUE!', hataMi(h('=COLUMN(5)'), '#VALUE!'));
ok('ROWS(aralık)', h('=ROWS(A1:C5)') === 5);
ok('COLUMNS(aralık)', h('=COLUMNS(A1:C5)') === 3);
ok('ROWS(tek hücre)', h('=ROWS(B2)') === 1);
ok('COLUMNS(tek hücre)', h('=COLUMNS(B2)') === 1);
ok('ROWS(dizi sabiti)', h('=ROWS({1,2;3,4})') === 2);
ok('COLUMNS(dizi sabiti)', h('=COLUMNS({1,2;3,4})') === 2);
ok('ROWS(tam sütun) dolu alanla sınırlıdır', h('=ROWS(A:A)') === 6);
ok('COLUMNS(tam satır) dolu alanla sınırlıdır', h('=COLUMNS(1:1)') === 5);
ok('ROWS() argümansız → #VALUE!', hataMi(h('=ROWS()'), '#VALUE!'));

// ================================================================================
// CHOOSE · CHOOSECOLS · CHOOSEROWS · AREAS
// ================================================================================
ok('CHOOSE seçer', h('=CHOOSE(2,"a","b","c")') === 'b');
ok('CHOOSE TEMBELdir: seçilmeyen argüman değerlendirilmez', h('=CHOOSE(1,"a",1/0)') === 'a');
ok('CHOOSE dizin taşması → #VALUE!', hataMi(h('=CHOOSE(4,"a","b")'), '#VALUE!'));
ok('CHOOSE dizin 0 → #VALUE!', hataMi(h('=CHOOSE(0,"a")'), '#VALUE!'));
ok('CHOOSE kesirli dizin kesilir', h('=CHOOSE(2.9,"a","b")') === 'b');
ok('CHOOSE dizin hatası yayılır', hataMi(h('=CHOOSE(1/0,"a")'), '#DIV/0!'));
ok('CHOOSE aralık seçebilir', h('=TOPLA(CHOOSE(2,A2:A6,B2:B6))') === 150);
ok('CHOOSECOLS sütun seçer', es(h('=CHOOSECOLS({1,2,3;4,5,6},3,1)'), [[3, 1], [6, 4]]), gor(h('=CHOOSECOLS({1,2,3;4,5,6},3,1)')));
ok('CHOOSECOLS negatif dizin sondan sayar', es(h('=CHOOSECOLS({1,2,3;4,5,6},-1)'), [[3], [6]]));
ok('CHOOSECOLS taşma → #VALUE!', hataMi(h('=CHOOSECOLS({1,2,3},4)'), '#VALUE!'));
ok('CHOOSECOLS sıfır → #VALUE!', hataMi(h('=CHOOSECOLS({1,2,3},0)'), '#VALUE!'));
ok('CHOOSEROWS satır seçer, yineleyebilir', es(h('=CHOOSEROWS({1,2;3,4;5,6},2,2)'), [[3, 4], [3, 4]]));
ok('CHOOSEROWS negatif dizin', es(h('=CHOOSEROWS({1,2;3,4;5,6},-1)'), [[5, 6]]));
ok('CHOOSEROWS taşma → #VALUE!', hataMi(h('=CHOOSEROWS({1;2;3},4)'), '#VALUE!'));
ok('CHOOSEROWS sayfadan', h('=TOPLA(CHOOSEROWS(A2:C6,1))') === 12.5);
ok('AREAS tek alan', h('=AREAS(A1:B2)') === 1);
ok('AREAS tek hücre', h('=AREAS(B2)') === 1);
ok('AREAS birleşim', h('=AREAS((A1:A3,C1:C3))') === 2);
ok('AREAS üç alan', h('=AREAS((A1:A3,C1:C3,E1))') === 3);

// ================================================================================
// ADDRESS · HYPERLINK · FORMULATEXT
// ================================================================================
ok('ADDRESS varsayılan tam mutlak', h('=ADDRESS(2,3)') === '$C$2');
ok('ADDRESS 2: satır mutlak', h('=ADDRESS(2,3,2)') === 'C$2');
ok('ADDRESS 3: sütun mutlak', h('=ADDRESS(2,3,3)') === '$C2');
ok('ADDRESS 4: göreli', h('=ADDRESS(2,3,4)') === 'C2');
ok('ADDRESS R1C1 mutlak', h('=ADDRESS(2,3,1,FALSE)') === 'R2C3');
ok('ADDRESS R1C1 göreli köşeli ayraçlı', h('=ADDRESS(2,3,4,FALSE)') === 'R[2]C[3]');
ok('ADDRESS R1C1 karma', h('=ADDRESS(2,3,2,FALSE)') === 'R2C[3]');
ok('ADDRESS sayfa adı', h('=ADDRESS(1,1,1,TRUE,"Sayfa2")') === 'Sayfa2!$A$1');
ok('ADDRESS boşluklu sayfa adı tırnaklanır', h('=ADDRESS(1,1,1,TRUE,"Sayfa 2")') === "'Sayfa 2'!$A$1");
ok('ADDRESS 26. sütundan sonrası', h('=ADDRESS(1,27)') === '$AA$1');
ok('ADDRESS satır 0 → #VALUE!', hataMi(h('=ADDRESS(0,1)'), '#VALUE!'));
ok('ADDRESS geçersiz mutlaklık → #VALUE!', hataMi(h('=ADDRESS(1,1,5)'), '#VALUE!'));
ok('ADDRESS sütun sınırı → #VALUE!', hataMi(h('=ADDRESS(1,16385)'), '#VALUE!'));
ok('HYPERLINK görünen adı verir', h('=HYPERLINK("http://a","Bak")') === 'Bak');
ok('HYPERLINK ad yoksa adresi verir', h('=HYPERLINK("http://a")') === 'http://a');
ok('FORMULATEXT eşittir imini tamamlar', h('=FORMULATEXT(C2)') === '=2*B2');
ok('FORMULATEXT var olan eşittiri korur', h('=FORMULATEXT(C3)') === '=B3*2');
ok('FORMULATEXT formülsüz hücre → #N/A', hataMi(h('=FORMULATEXT(A1)'), '#N/A'));
ok('FORMULATEXT başvuru olmayan → #VALUE!', hataMi(h('=FORMULATEXT("x")'), '#VALUE!'));
ok('FORMULATEXT aralıkta sol üst hücreyi okur', h('=FORMULATEXT(C2:D3)') === '=2*B2');

// ================================================================================
// UNIQUE · SORT · SORTBY · FILTER
// ================================================================================
ok('UNIQUE yinelenenleri atar', es(h('=UNIQUE(E2:E6)'), [['A'], ['B']]), gor(h('=UNIQUE(E2:E6)')));
ok('UNIQUE harf duymaz', es(h('=UNIQUE({"a";"A";"b"})'), [['a'], ['b']]));
ok('UNIQUE yalnız bir kez geçenler', es(h('=UNIQUE({1;1;2},,TRUE)'), [[2]]));
ok('UNIQUE bir kez geçen yoksa #CALC!', hataMi(h('=UNIQUE(E2:E6,,TRUE)'), '#CALC!'));
ok('UNIQUE sütunca', es(h('=UNIQUE({1,1,2},TRUE)'), [[1, 2]]));
ok('UNIQUE satır bütünü karşılaştırılır', es(h('=UNIQUE({1,2;1,2;1,3})'), [[1, 2], [1, 3]]));
ok('UNIQUE satır sayısı', h('=ROWS(UNIQUE(E2:E6))') === 2);
ok('SORT artan', es(h('=SORT({3;1;2})'), [[1], [2], [3]]));
ok('SORT azalan', es(h('=SORT({3;1;2},1,-1)'), [[3], [2], [1]]));
ok('SORT boş bırakılmış dizin varsayılana düşer', es(h('=SORT({3;1;2},,-1)'), [[3], [2], [1]]));
ok('SORT ölçüt sütunu', es(h('=SORT(A2:C6,3)')[0], [null, 50, 0]), gor(h('=SORT(A2:C6,3)')));
ok('SORT boş hücre sayıca 0 gibi sıralanır', es(h('=SORT(D2:D6)'), [[null], [2], [3], [5], [9]]), gor(h('=SORT(D2:D6)')));
ok('SORT metin sıralaması', es(h('=SORT(A2:A6)'), [[null], ['Armut'], ['Elma'], ['Kiraz'], ['Muz']]));
ok('SORT sütunca', es(h('=SORT({3,1,2},1,1,TRUE)'), [[1, 2, 3]]));
ok('SORT dizin taşması → #VALUE!', hataMi(h('=SORT({3;1;2},5)'), '#VALUE!'));
ok('SORT geçersiz yön → #VALUE!', hataMi(h('=SORT({3;1;2},1,2)'), '#VALUE!'));
ok('SORT kararlıdır (eşitlerde özgün sıra)', es(h('=SORT({1,"b";1,"a"},1)'), [[1, 'b'], [1, 'a']]));
ok('SORTBY başka vektöre göre', es(h('=SORTBY({"a";"b";"c"},{3;1;2})'), [['b'], ['c'], ['a']]));
ok('SORTBY azalan', es(h('=SORTBY({"a";"b";"c"},{3;1;2},-1)'), [['a'], ['c'], ['b']]));
ok('SORTBY iki ölçüt', es(h('=SORTBY({"a";"b";"c"},{1;1;2},1,{2;1;3},1)'), [['b'], ['a'], ['c']]));
ok('SORTBY satır vektörü sütunları sıralar', es(h('=SORTBY({"a","b","c"},{3,1,2})'), [['b', 'c', 'a']]));
ok('SORTBY boy uyuşmazlığı → #VALUE!', hataMi(h('=SORTBY({"a";"b";"c"},{1;2})'), '#VALUE!'));
ok('SORTBY geçersiz yön → #VALUE!', hataMi(h('=SORTBY({"a";"b"},{1;2},3)'), '#VALUE!'));
ok('FILTER koşula uyan satırlar', es(h('=FILTER(A2:A6,B2:B6>20)'), [['Kiraz'], ['Muz'], [null]]), gor(h('=FILTER(A2:A6,B2:B6>20)')));
ok('FILTER çok sütunlu', es(h('=FILTER(A2:C6,B2:B6>35)'), [['Muz', 40, 1.5], [null, 50, 0]]));
ok('FILTER sayısal süzgeç', es(h('=FILTER(A2:A6,{1;0;1;0;1})'), [['Elma'], ['Kiraz'], [null]]));
ok('FILTER hiçbiri uymazsa #CALC!', hataMi(h('=FILTER(A2:A6,B2:B6>100)'), '#CALC!'));
ok('FILTER hiçbiri uymazsa 3. argüman', h('=FILTER(A2:C6,B2:B6>100,"yok")') === 'yok');
ok('FILTER sütun süzer', es(h('=FILTER({1,2,3},{TRUE,FALSE,TRUE})'), [[1, 3]]));
ok('FILTER boy uyuşmazlığı → #VALUE!', hataMi(h('=FILTER(A2:A6,B2:B3>1)'), '#VALUE!'));
ok('FILTER metin süzgeci → #VALUE!', hataMi(h('=FILTER(A2:A6,{"x";"y";"z";"w";"v"})'), '#VALUE!'));
ok('FILTER süzgeçteki hata yayılır', hataMi(h('=FILTER(A2:A6,1/(B2:B6>1000))'), '#DIV/0!'));

// ================================================================================
// HSTACK · VSTACK · TAKE · DROP · EXPAND
// ================================================================================
ok('HSTACK yan yana ekler', es(h('=HSTACK({1;2},{3;4})'), [[1, 3], [2, 4]]));
ok('HSTACK kısa parçayı #N/A ile doldurur', es(h('=HSTACK({1;2},{3;4;5})'), [[1, 3], [2, 4], [NA, 5]]), gor(h('=HSTACK({1;2},{3;4;5})')));
ok('HSTACK sayfa aralıkları', h('=TOPLA(HSTACK(B2:B3,B4:B5))') === 100);
ok('VSTACK alt alta ekler', es(h('=VSTACK({1,2},{3,4})'), [[1, 2], [3, 4]]));
ok('VSTACK dar parçayı #N/A ile doldurur', es(h('=VSTACK({1,2},{3})'), [[1, 2], [3, NA]]));
ok('VSTACK üç parça', es(h('=VSTACK({1},{2},{3})'), [[1], [2], [3]]));
ok('VSTACK hücredeki hatayı taşır (yaymaz)', es(h('=VSTACK({1},{#DIV/0!})'), [[1], [X.ERR.DIV0]]), gor(h('=VSTACK({1},{#DIV/0!})')));
ok('TAKE baştan satır', es(h('=TAKE({1,2;3,4;5,6},2)'), [[1, 2], [3, 4]]));
ok('TAKE sondan satır', es(h('=TAKE({1,2;3,4;5,6},-1)'), [[5, 6]]));
ok('TAKE satır ve sütun', es(h('=TAKE({1,2;3,4;5,6},2,1)'), [[1], [3]]));
ok('TAKE boş bırakılmış satır tümü demektir', es(h('=TAKE({1,2;3,4},,1)'), [[1], [3]]));
ok('TAKE sıfır → #CALC!', hataMi(h('=TAKE({1,2;3,4},0)'), '#CALC!'));
ok('DROP baştan atar', es(h('=DROP({1,2;3,4;5,6},1)'), [[3, 4], [5, 6]]));
ok('DROP sondan atar', es(h('=DROP({1,2;3,4;5,6},-2)'), [[1, 2]]));
ok('DROP sütun atar', es(h('=DROP({1,2;3,4},0,1)'), [[2], [4]]));
ok('DROP hepsini atarsa #CALC!', hataMi(h('=DROP({1,2;3,4},2)'), '#CALC!'));
ok('EXPAND varsayılan dolgu #N/A', es(h('=EXPAND({1,2},2,3)'), [[1, 2, NA], [NA, NA, NA]]));
ok('EXPAND verilen dolgu', es(h('=EXPAND({1,2},2,3,0)'), [[1, 2, 0], [0, 0, 0]]));
ok('EXPAND yalnız satır', es(h('=EXPAND({1},2,,0)'), [[1], [0]]));
ok('EXPAND küçültmez → #VALUE!', hataMi(h('=EXPAND({1,2;3,4},1,2)'), '#VALUE!'));

// ================================================================================
// TOROW · TOCOL · WRAPROWS · WRAPCOLS
// ================================================================================
ok('TOROW satır satır tarar', es(h('=TOROW({1,2;3,4})'), [[1, 2, 3, 4]]));
ok('TOROW sütun sütun tarar', es(h('=TOROW({1,2;3,4},,TRUE)'), [[1, 3, 2, 4]]));
ok('TOROW hataları atlar (2)', es(h('=TOROW({1,#DIV/0!,3},2)'), [[1, 3]]), gor(h('=TOROW({1,#DIV/0!,3},2)')));
ok('TOCOL sütuna serer', es(h('=TOCOL({1,2;3,4})'), [[1], [2], [3], [4]]));
ok('TOCOL boşları atlar (1)', h('=ROWS(TOCOL(A2:A6,1))') === 4);
ok('TOCOL boşları tutar (0)', h('=ROWS(TOCOL(A2:A6))') === 5);
ok('TOCOL boş ve hatayı birlikte atlar (3)', es(h('=TOCOL({1,#N/A;0,3},3)'), [[1], [0], [3]]));
ok('TOCOL geçersiz atlama → #VALUE!', hataMi(h('=TOCOL({1,2},4)'), '#VALUE!'));
ok('TOCOL her şey atlanırsa #CALC!', hataMi(h('=TOCOL({#N/A,#N/A},2)'), '#CALC!'));
ok('WRAPROWS satırlara böler', es(h('=WRAPROWS({1,2,3,4},2)'), [[1, 2], [3, 4]]));
ok('WRAPROWS artanı #N/A ile doldurur', es(h('=WRAPROWS({1,2,3,4,5},2)'), [[1, 2], [3, 4], [5, NA]]));
ok('WRAPROWS verilen dolgu', es(h('=WRAPROWS({1,2,3,4,5},2,0)'), [[1, 2], [3, 4], [5, 0]]));
ok('WRAPCOLS sütunlara böler', es(h('=WRAPCOLS({1,2,3,4,5,6},3)'), [[1, 4], [2, 5], [3, 6]]));
ok('WRAPCOLS artanı doldurur', es(h('=WRAPCOLS({1,2,3,4,5},3,0)'), [[1, 4], [2, 5], [3, 0]]));
ok('WRAPROWS iki boyutlu girdi → #VALUE!', hataMi(h('=WRAPROWS({1,2;3,4},2)'), '#VALUE!'));
ok('WRAPROWS sıfır sarma → #NUM!', hataMi(h('=WRAPROWS({1,2,3},0)'), '#NUM!'));
ok('WRAPCOLS sütun vektörünü de alır', es(h('=WRAPCOLS({1;2;3;4},2)'), [[1, 3], [2, 4]]));

// ================================================================================
// Kayıt ve genel davranış
// ================================================================================
const HEDEF = ['VLOOKUP', 'HLOOKUP', 'XLOOKUP', 'LOOKUP', 'INDEX', 'MATCH', 'XMATCH', 'OFFSET',
  'INDIRECT', 'ROW', 'ROWS', 'COLUMN', 'COLUMNS', 'CHOOSE', 'CHOOSECOLS', 'CHOOSEROWS', 'AREAS',
  'ADDRESS', 'HYPERLINK', 'FORMULATEXT', 'UNIQUE', 'SORT', 'SORTBY', 'FILTER', 'HSTACK', 'VSTACK',
  'TAKE', 'DROP', 'EXPAND', 'TOROW', 'TOCOL', 'WRAPROWS', 'WRAPCOLS'];
ok('kayıt: hedefteki ' + HEDEF.length + ' işlevin hepsi tanınıyor', HEDEF.every((a) => X.bilinen(a)),
  '→ eksik: ' + HEDEF.filter((a) => !X.bilinen(a)).join(', '));
ok('başka kategorinin işi kaydedilmemiş (TRANSPOSE)', !X.bilinen('TRANSPOSE'));
ok('başka kategorinin işi kaydedilmemiş (SEQUENCE)', !X.bilinen('SEQUENCE'));
ok('kaydedilmemiş ad #NAME? verir', hataMi(h('=BOYLEBIRSEYYOK(1)'), '#NAME?'));
ok('_xlfn öneki soyuluyor', h('=_xlfn.XMATCH("Muz",A2:A6)') === 4);
ok('boş hücre ile 0 ayrı: MATCH boşu 0 sanmaz', hataMi(h('=MATCH(0,D2:D6,0)'), '#N/A'));
ok('boş hücre bulunur: MATCH("") boşu bulur', h('=MATCH("",D2:D6,0)') === 2);

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
