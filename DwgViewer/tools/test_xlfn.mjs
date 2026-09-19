// EXCEL FORMÜL MOTORU — ÇEKİRDEK (app/src/main/assets/viewer/xlfn.js).
// Sözcükleyici, ayrıştırıcı, değerlendirici, tür çevirimi, hata yayılımı, ölçüt dili, dizi
// yayılımı, sayfalar arası başvuru ve tarih seri sayısı. İşlev kütüphanesi AYRI sınanır
// (test_xlfn_math / _stat / …); burada yalnız iki örnek işlev kaydedilir, çünkü sınanan şey
// işlevin kendisi değil, motorun onu nasıl çağırdığıdır.
// Kullanım: node tools/test_xlfn.mjs
import * as X from '../app/src/main/assets/viewer/xlfn.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek !== undefined ? '  ' + JSON.stringify(ek) : '')); } };
const yak = (a, b, e = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= e;

// --- sınama için iki işlev: biri olağan, biri TEMBEL (ham) ------------------------------
X.kaydet('SUM', { en: 1, ek: -1, fn: (a) => { const s = X.sayilar(a); return X.hata(s) ? s : s.reduce((p, q) => p + q, 0); } });
X.kaydet('IF', { en: 2, ek: 3, ham: true, fn: (a, ctx) => { const c = X.bool(X.degerlendir(a[0], ctx)); return X.hata(c) ? c : (c ? X.degerlendir(a[1], ctx) : (a[2] && a[2].t !== 'bos' ? X.degerlendir(a[2], ctx) : false)); } });
X.kaydet('ROW', { en: 0, ek: 1, bas: [0], fn: (a, ctx) => (a.length && a[0] && a[0].r1 != null ? a[0].r1 + 1 : (ctx.hucre ? ctx.hucre.r + 1 : X.ERR.REF)) });
X.kaydet('ISERROR', { en: 1, ek: 1, hatasiz: true, fn: (a) => X.hata(a[0]) });
X.kaydet('COUNTIF', { en: 2, ek: 2, fn: (a) => { const f = X.olcut(a[1]); return X.duzle([a[0]]).filter(f).length; } });

// --- sahte çalışma kitabı ----------------------------------------------------------------
const kitap = {
  Sayfa1: [[1, 2, 3], [4, 5, 6], [7, 8, 'elma']],
  'Ad Soyad': [[10, 20], [30, 40]],
};
const ctx = {
  sayfa: 'Sayfa1',
  hucre: { r: 5, c: 5 },
  oku: (s, r, c) => { const t = kitap[s]; if (!t) return null; const sat = t[r]; if (!sat) return null; const v = sat[c]; return v === undefined ? null : v; },
  boyut: (s) => (s === 'Ad Soyad' ? { r: 2, c: 2 } : { r: 3, c: 3 }),
  ad: (n) => (n === 'TOPLAM' ? { sayfa: 'Sayfa1', r1: 0, c1: 0, r2: 0, c2: 2 } : n === 'KDV' ? 0.2 : undefined),
  simdi: () => 45923.5,
};
const h = (f) => { const v = X.hesapla(f, ctx); return X.hata(v) ? v.e : v; };

// =========================================================================================
console.log('--- 1 · işleçler ve öncelik');
ok('1a çarpma toplamadan önce', h('1+2*3') === 7);
ok('1b parantez', h('(1+2)*3') === 9);
ok('1c üs SAĞDAN birleşir (2^3^2 = 512, 64 değil)', h('2^3^2') === 512, h('2^3^2'));
ok('1d tekli eksi üsten ÖNCE gelir: -2^2 = 4 (Excel böyle, matematik değil)', h('-2^2') === 4, h('-2^2'));
ok('1e yüzde sonektir', yak(h('10%'), 0.1));
ok('1f yüzde üsten önce: 10%^2', yak(h('10%^2'), 0.01), h('10%^2'));
ok('1g birleştirme', h('"a"&"b"&1') === 'ab1');
ok('1h karşılaştırma toplamadan sonra: 1+1=2 DOĞRU verir', h('1+1=2') === true);
ok('1i metin karşılaştırması büyük/küçük harf DUYMAZ', h('"A"="a"') === true);
ok('1j boş hücre sıfıra eşittir', h('C1=0') === false && h('Z9=0') === true, [h('C1=0'), h('Z9=0')]);
ok('1k boş hücre boş metne de eşittir', h('Z9=""') === true);

console.log('--- 2 · tür çevirimi');
ok('2a sayı metni toplanır', h('1+"2"') === 3);
ok('2b çevrilemeyen metin #VALUE!', h('1+"x"') === '#VALUE!');
ok('2c mantık sayıya çevrilir', h('TRUE+1') === 2 && h('FALSE+1') === 1);
ok('2d yüzde metni', yak(X.num('12%'), 0.12));
ok('2e sayı metne çevrilirken 15 anlamlı hane', X.str(0.1 + 0.2) === '0.3', X.str(0.1 + 0.2));
ok('2f mantığın metni TRUE/FALSE', X.str(true) === 'TRUE');
ok('2g boşun metni boş', X.str(null) === '');
ok('2h boşun sayısı sıfır', X.num(null) === 0);

console.log('--- 3 · hatalar');
ok('3a sıfıra bölme', h('1/0') === '#DIV/0!');
ok('3b tanınmayan işlev', h('FOO(1)') === '#NAME?');
ok('3c hata yayılır', h('SUM(1,1/0)') === '#DIV/0!');
ok('3d yazılı hata sabiti', h('#N/A') === '#N/A' && h('#REF!') === '#REF!');
ok('3e hatasiz işlev hatayı GÖRÜR, yaymaz', h('ISERROR(1/0)') === true);
ok('3f 0^-1 sıfıra bölmedir', h('0^-1') === '#DIV/0!');
ok('3g taşan sonuç #NUM!', h('1E308*10') === '#NUM!', h('1E308*10'));
ok('3h eksi sayının kesirli kökü #NUM!', h('(-8)^0.5') === '#NUM!', h('(-8)^0.5'));

console.log('--- 4 · başvurular');
ok('4a tek hücre', h('B2') === 5);
ok('4b aralık toplamı', h('SUM(A1:C3)') === 36);
ok('4c tek sütun aralığı ÖRTÜK KESİŞİME UĞRAMAZ', h('SUM(A1:A3)') === 12, h('SUM(A1:A3)'));
ok('4d tam sütun boyutla sınırlanır', h('SUM(A:A)') === 12);
ok('4e tam satır', h('SUM(1:1)') === 6);
ok('4f sayfa adı', h('SUM(Sayfa1!A1:B2)') === 12);
ok('4g tırnaklı sayfa adı', h("SUM('Ad Soyad'!A1:B2)") === 100, h("SUM('Ad Soyad'!A1:B2)"));
ok('4h kesişim işleci (boşluk)', h('A1:B2 B2:C3') === 5, h('A1:B2 B2:C3'));
ok('4i kesişmeyen aralıklar #REF!', h('A1:A2 C1:C2') === '#REF!', h('A1:A2 C1:C2'));
ok('4j dolar işaretleri değeri değiştirmez', h('$B$2') === 5);
ok('4k tanımlı ad (aralık)', h('SUM(TOPLAM)') === 6, h('SUM(TOPLAM)'));
ok('4l tanımlı ad (sabit)', yak(h('KDV*100'), 20));
ok('4m tanımsız ad #NAME?', h('YOKBOYLEBIRSEY') === '#NAME?');
ok('4n başvuru argümanı: ROW(B7) = 7', h('ROW(B7)') === 7, h('ROW(B7)'));
ok('4o argümansız ROW geçerli hücreyi verir', h('ROW()') === 6, h('ROW()'));
ok('4p birleşim DEĞER olarak kullanılamaz', h('(A1,B1)') === '#VALUE!', h('(A1,B1)'));

console.log('--- 5 · işlev çağrısı');
ok('5a virgül argüman ayracıdır, birleşim değil', h('SUM(1,2,3)') === 6, h('SUM(1,2,3)'));
ok('5b eksik argüman en az sayının altındaysa #VALUE!', h('IF(1)') === '#VALUE!');
ok('5c atlanan orta argüman boş gelir', h('IF(1,,9)') === null, h('IF(1,,9)'));
ok('5d TEMBEL değerlendirme: yanlış dal hesaplanmaz', h('IF(TRUE,1,1/0)') === 1, h('IF(TRUE,1,1/0)'));
ok('5e tembel dal gerçekten çalışıyor mu (ters yön)', h('IF(FALSE,1/0,2)') === 2);
ok('5f iç içe işlev', h('SUM(SUM(1,2),SUM(3,4))') === 10);
ok('5g aralıkta metin ve mantık ATLANIR', h('SUM(A1:C3)') === 36);
/*
 * 5h: Excel'de bir aralıktan ya da dizi sabitinden gelen metin toplamaya GİRMEZ. Doğrudan
 * yazılan metnin çevrilmesi (SUM("3";1) = 4) ise argümanın kaynağını bilmeyi gerektirir;
 * çekirdek şu an bunu işlevlere bildirmiyor, bu yüzden burada yalnız aralık kuralı sınanır.
 */
ok('5h dizi sabitindeki metin toplamaya girmez', h('SUM({"3",1})') === 1, h('SUM({"3",1})'));

console.log('--- 6 · dizi sabitleri ve yayılım');
ok('6a dizi sabiti', h('SUM({1,2;3,4})') === 10);
ok('6b dizi sabiti satır/sütun', JSON.stringify(X.hesapla('{1,2;3,4}', ctx)) === '[[1,2],[3,4]]', X.hesapla('{1,2;3,4}', ctx));
ok('6c skaler ile dizi yayılımı', JSON.stringify(X.hesapla('{1,2}*3', ctx)) === '[[3,6]]', X.hesapla('{1,2}*3', ctx));
ok('6d dizi ile dizi', JSON.stringify(X.hesapla('{1,2}+{10,20}', ctx)) === '[[11,22]]');
ok('6e aralık çarpımı toplanır', h('SUM(A1:C1*2)') === 12, h('SUM(A1:C1*2)'));
ok('6f dizide hata yayılır', h('SUM({1,2}/0)') === '#DIV/0!');

console.log('--- 7 · ölçüt dili (COUNTIF ailesi)');
ok('7a eşitlik', h('COUNTIF(A1:C3,5)') === 1);
ok('7b büyüktür', h('COUNTIF(A1:C3,">5")') === 3, h('COUNTIF(A1:C3,">5")'));
ok('7c metin eşleşmesi', h('COUNTIF(A1:C3,"elma")') === 1);
ok('7d joker *', h('COUNTIF(A1:C3,"el*")') === 1);
ok('7e joker ? tek karakter', h('COUNTIF(A1:C3,"elm?")') === 1);
ok('7f eşit değil', h('COUNTIF(A1:C3,"<>5")') === 8, h('COUNTIF(A1:C3,"<>5")'));
{
  const f = X.olcut('>=3');
  ok('7g ölçüt işlevi doğrudan', f(3) === true && f(2) === false);
  const t = X.olcut('~*');   // yıldızın KENDİSİ aranıyor
  ok('7h tilde kaçışı', t('*') === true && t('x') === false);
}

console.log('--- 8 · karşılaştırma sırası (Excel: sayı < metin < YANLIŞ < DOĞRU)');
ok('8a sayı metinden küçüktür', X.karsilastir(9999, 'a') < 0);
ok('8b metin mantıktan küçüktür', X.karsilastir('z', false) < 0);
ok('8c YANLIŞ DOĞRUdan küçüktür', X.karsilastir(false, true) < 0);
ok('8d metin sıralaması harf duymaz', X.karsilastir('Ab', 'aB') === 0);

console.log('--- 9 · tarih seri sayısı (1900 dizgesi, artık yıl hatası korunur)');
ok('9a 1 = 1900-01-01', X.seriTarih(1).toISOString().slice(0, 10) === '1900-01-01', X.seriTarih(1).toISOString());
ok('9b 59 = 1900-02-28', X.seriTarih(59).toISOString().slice(0, 10) === '1900-02-28');
ok('9c 61 = 1900-03-01 (60 olmayan güne ayrılmıştır)', X.seriTarih(61).toISOString().slice(0, 10) === '1900-03-01');
ok('9d tarihSeri geri döner', X.tarihSeri(2025, 9, 19) === 45919, X.tarihSeri(2025, 9, 19));
ok('9e ay taşması kabul edilir: DATE(2026;14;1) = 2027-02-01', X.seriTarih(X.tarihSeri(2026, 14, 1)).toISOString().slice(0, 10) === '2027-02-01');
ok('9f gün taşması', X.seriTarih(X.tarihSeri(2025, 1, 32)).toISOString().slice(0, 10) === '2025-02-01');
{
  const p = X.seriParca(45919), s = X.seriSaat(45919.75);
  ok('9g seriParca', p.y === 2025 && p.ay === 9 && p.gun === 19 && p.hafta === 5, p);
  ok('9h seriSaat', s.sa === 18 && s.dk === 0 && s.sn === 0, s);
}

console.log('--- 10 · sözcükleyici ve ayrıştırıcı incelikleri');
ok('10a başındaki = atılır', h('=1+1') === 2);
ok('10b tırnak içi çift tırnak kaçışı', h('"a""b"') === 'a"b');
ok('10c _xlfn öneki atılır', X.ayristir('_xlfn.CONCAT(1)').ad === 'CONCAT', X.ayristir('_xlfn.CONCAT(1)').ad);
ok('10d örtük kesişim işleci @ yok sayılır', h('@A1') === 1, h('@A1'));
ok('10e sütun adı ile A1 ayırt edilir: "A" bir addır', X.ayristir('A').t === 'name', X.ayristir('A').t);
ok('10f A:A bir başvurudur', X.ayristir('A:A').t === 'ref', X.ayristir('A:A').t);
ok('10g sütun numarası çevrimi', X.sutunNo('A') === 0 && X.sutunNo('Z') === 25 && X.sutunNo('AA') === 26 && X.sutunNo('XFD') === 16383);
ok('10h sütun adı çevrimi', X.sutunAd(0) === 'A' && X.sutunAd(26) === 'AA' && X.sutunAd(16383) === 'XFD');
ok('10i boşluk yalnız başvurular arasında işleçtir', h('SUM( 1 , 2 )') === 3, h('SUM( 1 , 2 )'));
ok('10j bozuk formül çökmez', typeof h('SUM(') === 'number' || typeof h('SUM(') === 'string', h('SUM('));
ok('10k kapanmamış tırnak çökmez', h('"abc') === 'abc', h('"abc'));
/*
 * 10l / 10m: iki sessiz tuzak. Sözcükleyici "LOG10(" öbeğini LOG sütunu + 10. satır diye okursa
 * işlev hiç çağrılmaz; "S2!A1"deki S2'yi hücre sanırsa ardından gelen '!' atlanır ve formül
 * başka bir hücreye bakar. İkisi de HATA VERMEZ, yalnız yanlış sayı üretir — en tehlikelisi budur.
 */
X.kaydet('LOG10', { en: 1, ek: 1, fn: (a) => { const x = X.num(a[0]); return X.hata(x) ? x : Math.log10(x); } });
ok('10l sayıyla biten işlev adı başvuru sanılmaz (LOG10)', h('LOG10(1000)') === 3, h('LOG10(1000)'));
ok('10l2 ayrıştırma ağacında işlevdir', X.ayristir('LOG10(1000)').t === 'fn', X.ayristir('LOG10(1000)').t);
ok('10m A1 biçimindeki SAYFA adı başvuru sanılmaz', X.ayristir('S2!A1').t === 'ref' && X.ayristir('S2!A1').v.sayfa === 'S2', JSON.stringify(X.ayristir('S2!A1')));

console.log('--- 11 · yardımcılar');
ok('11a duzle iç içe dizileri açar', JSON.stringify(X.duzle([[1, [2, 3]], 4])) === '[1,2,3,4]');
ok('11b sayilar metni atlar', JSON.stringify(X.sayilar([[1, 'a', true, null, 2]])) === '[1,2]');
ok('11c sayilar metin seçeneğiyle çevirir', JSON.stringify(X.sayilar([['3', 1]], { metin: true })) === '[3,1]');
ok('11d sayilar mantık seçeneği', JSON.stringify(X.sayilar([[true, false]], { mantik: true })) === '[1,0]');
ok('11e mat skaleri 2 boyuta çevirir', JSON.stringify(X.mat(5)) === '[[5]]');
ok('11f ilkHata iç içe dizide de bulur', X.ilkHata([[1, X.ERR.NA]]) === X.ERR.NA);
ok('11g jokerRe', X.jokerRe('a*c').test('abbbc') === true && X.jokerRe('a?c').test('abbc') === false);
ok('11h bilinen kayıtlı işlevi görür', X.bilinen('sum') === true && X.bilinen('yok') === false);

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
