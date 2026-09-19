// EXCEL SAYI BİÇİMİ (app/src/main/assets/viewer/xlfmt.js).
// Bir xlsx'te hücrenin DEĞERİ ile GÖRÜNÜŞÜ ayrı yerlerde durur: değer <v>'de sayıdır, görünüşü
// styles.xml'deki biçim kodundan gelir. Bu sınama kod yorumlayıcısını denetler — dört bölümlü
// kod, koşullar, para simgesi, yer tutucular, binlik / ölçekleme, yüzde, kesir, bilimsel,
// tarih-saat imleri ve geçen süre.
// Kullanım: node tools/test_xlfmt.mjs
import { bicimle, genel, bolumler, yuvarlaMetin, tarihBicimi, YERLESIK, TARIH_ID } from '../app/src/main/assets/viewer/xlfmt.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek !== undefined ? '  ' + JSON.stringify(ek) : '')); } };
const B = (v, kod, ayar) => bicimle(v, kod, ayar).metin;
const es = (ad, v, kod, bek, ayar) => { const c = B(v, kod, ayar); ok(ad + '  [' + kod + ']  ' + v + ' → ' + JSON.stringify(bek), c === bek, c); };

console.log('--- 1 · genel görünüm');
es('1a', 1234.5, 'General', '1234,5');
es('1b', 0, 'General', '0');
es('1c', -0.25, 'General', '-0,25');
es('1d büyük sayı bilimseldir', 1.23e12, 'General', '1,23E+12');
es('1e küçük sayı bilimseldir', 0.0000123, 'General', '1,23E-05');
es('1f boş kod = genel', 5, '', '5');
ok('1g genel() doğrudan', genel(1000) === '1000' && genel(0.5) === '0,5', [genel(1000), genel(0.5)]);

console.log('--- 2 · yer tutucular');
es('2a sıfır doldurur', 12, '000', '012');
es('2b diyez doldurmaz', 12, '###', '12');
es('2c ondalık zorunlu', 1.5, '0.000', '1,500');
es('2d ondalık gereksiz sıfırı atar', 1.5, '0.###', '1,5');
es('2e soru işareti eksik haneyi BOŞLUKLA doldurur', 1.5, '0.0??', '1,5  ');
es('2e2 anlamlı hane boşluğa dönüşmez', 1.504, '0.0??', '1,504');
es('2f tam kısım sıfırsa # yazmaz', 0.5, '#.00', ',50');
es('2g tam kısım sıfırsa 0 yazar', 0.5, '0.00', '0,50');

console.log('--- 3 · binlik ayracı ve ölçekleme');
es('3a binlik', 1234567, '#,##0', '1.234.567');
es('3b binlik + ondalık', 1234.5, '#,##0.00', '1.234,50');
es('3c sondaki virgül bine böler', 1234567, '#,##0,', '1.235');
es('3d iki virgül milyona böler', 1234567, '#,##0,, "M"', '1 M');
es('3e ayraçlar ayarla değişir', 1234.5, '#,##0.00', '1,234.50', { binlik: ',', ondalik: '.' });

console.log('--- 4 · yüzde, bilimsel, kesir');
es('4a yüzde', 0.1234, '0%', '12%');
es('4b yüzde ondalıklı', 0.1234, '0.00%', '12,34%');
es('4c bilimsel', 1234.5, '0.00E+00', '1,23E+03');
es('4d bilimsel eksi üs', 0.000123, '0.00E+00', '1,23E-04');
es('4e mühendislik (üç haneli mantis)', 12345, '##0.0E+0', '12,3E+3');
es('4f kesir', 2.25, '# ?/?', '2 1/4');
es('4g kesir tam kısım sıfır', 0.5, '# ?/?', ' 1/2');
ok('4h kesir sadeleşmiş en iyi yaklaşım (0,3333 → 1/3, 33/99 değil)', B(0.3333, '# ??/??').replace(/\s+/g, '') === '1/3', B(0.3333, '# ??/??'));
ok('4h2 payda SAĞDAN doldurulur (hizalama)', B(0.3333, '# ??/??').endsWith('3 '), B(0.3333, '# ??/??'));
es('4i sabit payda', 0.25, '# ?/16', ' 4/16');

console.log('--- 5 · bölümler (pozitif;negatif;sıfır;metin)');
es('5a negatif kendi bölümüne', -1234.5, '#,##0.00;(#,##0.00)', '(1.234,50)');
es('5b sıfır bölümü', 0, '#,##0.00;(#,##0.00);"-"', '-');
es('5c metin bölümü', 'abc', '0;0;0;"[" @ "]"', '[ abc ]');
es('5d metin bölümü yoksa metin olduğu gibi', 'abc', '#,##0', 'abc');
es('5e tek bölüm negatife de uyar, eksi korunur', -12.5, '0.0', '-12,5');
ok('5f bolumler tırnak içindeki ; ayraç saymaz', bolumler('"a;b";0').length === 2, bolumler('"a;b";0'));
ok('5g bolumler köşeli parantez içindekini korur', bolumler('[$-41F]0;0').length === 2);

console.log('--- 6 · koşullar ve renk');
es('6a koşul sağlanır', 1500, '[>=1000]#,##0" bin";0', '1.500 bin');
es('6b koşul sağlanmaz, son bölüme düşer', 500, '[>=1000]#,##0" bin";0', '500');
ok('6c renk ayrı döner, metne karışmaz', bicimle(-5, '0;[Red]-0').renk === '#b91c1c' && bicimle(-5, '0;[Red]-0').metin === '-5', bicimle(-5, '0;[Red]-0'));
ok('6d renksiz kodda renk yok', bicimle(5, '0').renk === null);

console.log('--- 7 · metin, kaçış, para');
es('7a önde sabit metin', 1234.5, '"TL "#,##0.00', 'TL 1.234,50');
es('7b arkada sabit metin', 1234.5, '#,##0.00" TL"', '1.234,50 TL');
es('7c ters bölü kaçışı', 5, '0\\ "adet"', '5 adet');
es('7d para imi', 1234.5, '[$₺-41F]#,##0.00', '₺1.234,50');
es('7e alt çizgi boşluk bırakır', 5, '0_)', '5 ');
es('7f yıldız dolgusu HTML\'de atlanır', 5, '*-0', '5');

console.log('--- 8 · tarih ve saat');
es('8a gün.ay.yıl', 45919, 'dd.mm.yyyy', '19.09.2025');
es('8b tek haneli', 45919, 'd.m.yyyy', '19.9.2025');
es('8c iki haneli yıl', 45919, 'dd.mm.yy', '19.09.25');
es('8d uzun ay', 45919, 'd mmmm yyyy', '19 Eylül 2025');
es('8e kısa ay', 45919, 'dd-mmm-yy', '19-Eyl-25');
es('8f ayın baş harfi', 45919, 'mmmmm', 'E');
es('8g uzun gün adı', 45919, 'dddd', 'Cuma');
es('8h kısa gün adı', 45919, 'ddd', 'Cum');
es('8i saat', 0.75, 'hh:mm:ss', '18:00:00');
es('8j 12 saat + AM/PM', 0.5, 'h:mm AM/PM', '12:00 PM');
es('8k sabah', 0.25, 'h:mm AM/PM', '6:00 AM');
es('8l tarih ve saat birlikte', 45919.75, 'dd.mm.yyyy hh:mm', '19.09.2025 18:00');
es('8m dakika mı ay mı: saatten sonra DAKİKA', 45919.5, 'h:mm', '12:00');
es('8n dakika mı ay mı: saniyeden önce DAKİKA', 0.5213773148, 'mm:ss', '30:47');
es('8o geçen süre gün taşmaz', 1.5, '[h]:mm', '36:00');
es('8p geçen dakika', 0.5, '[mm]', '720');
ok('8q tarihBicimi ayırt eder', tarihBicimi('dd.mm.yyyy') === true && tarihBicimi('#,##0.00') === false);
ok('8r yerleşik kimlikler', YERLESIK[14] === 'mm-dd-yy' && TARIH_ID.has(14) && !TARIH_ID.has(4));

console.log('--- 9 · yuvarlama (Excel yarımı SIFIRDAN UZAĞA yuvarlar)');
es('9a yarım yukarı', 2.5, '0', '3');
es('9b negatif yarım aşağı (sıfırdan uzağa)', -2.5, '0', '-3');
es('9c ikilik sapmaya düşmez: 1,005', 1.005, '0.00', '1,01');
es('9d 2,675', 2.675, '0.00', '2,68');
es('9e büyük sayıda hane kaybı yok', 123456789.987, '#,##0.00', '123.456.789,99');
ok('9f yuvarlaMetin doğrudan', yuvarlaMetin(1.005, 2) === '1.01' && yuvarlaMetin(-1.005, 2) === '-1.01', [yuvarlaMetin(1.005, 2), yuvarlaMetin(-1.005, 2)]);
ok('9g yuvarlaMetin tam sayı', yuvarlaMetin(2.5, 0) === '3' && yuvarlaMetin(3.5, 0) === '4');

console.log('--- 10 · sayı olmayan değerler');
ok('10a boş', bicimle(null, '#,##0').metin === '');
ok('10b hata değeri olduğu gibi yazılır ve kırmızıdır', bicimle({ e: '#DIV/0!' }, '0').metin === '#DIV/0!' && bicimle({ e: '#DIV/0!' }, '0').renk === '#b91c1c');
ok('10c mantık', bicimle(true, 'General').metin === 'DOĞRU' && bicimle(false, 'General').metin === 'YANLIŞ');
ok('10d metin sola, sayı sağa hizalanır', bicimle('a', 'General').hiza === 'l' && bicimle(1, 'General').hiza === 'r');

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
