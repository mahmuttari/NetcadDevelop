// Excel çalışma kitabı katmanı (xlbook.js + xls.js + cfb.js) sınaması.
// Playwright kullanmaz; depo kökünden "node tools/test_xlbook.mjs" ile koşar.
//
// Burada sınanan şey DOM istemeyen yoldur: biçim tanıma, paylaşılan formül kaydırma,
// sayı ayrıştırma, CSV, hesap / biçim katmanı ve .xls (BIFF8) okuyucusu. XML tabanlı
// biçimler (xlsx, ods, SpreadsheetML, HTML tablosu) tarayıcı gerektirir; onlar
// test_docs.mjs içinde gerçek görüntüleyiciyle sınanır.
//
// .xls dosyası SINAMANIN KENDİSİ tarafından üretilir: depoya ikili örnek koymak yerine
// OLE kabuğu ve BIFF kayıtları burada bayt bayt yazılır. Böylece sınama neyi sınadığını
// da belgeler — okuyucu ile yazıcı aynı belirtimi okur.
import * as XB from '../app/src/main/assets/viewer/xlbook.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek === undefined ? '' : ' ' + ek)); } };
const J = (x) => JSON.stringify(x);

// ---------------------------------------------------------------------------------
// 1. Biçim tanıma — karar uzantıda değil baytlarda
// ---------------------------------------------------------------------------------
const bayt = (...a) => new Uint8Array(a);
const metinBayt = (s) => new TextEncoder().encode(s);
ok('1a OLE başlığı .xls olarak tanınır', XB.tani(bayt(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0)) === 'ole');
ok('1b ZIP başlığı arşiv olarak tanınır', XB.tani(bayt(0x50, 0x4B, 3, 4, 0, 0)) === 'zip');
ok('1c ".xls" adlı HTML tablosu HTML tanınır', XB.tani(metinBayt('<html><body><table><tr><td>1</td></tr></table></body></html>')) === 'html');
ok('1d Excel 2003 XML tanınır', XB.tani(metinBayt('<?xml version="1.0"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">')) === 'xml2003');
ok('1e noktalı virgüllü metin CSV tanınır', XB.tani(metinBayt('Poz;Miktar;Tutar\n15.140.1001;12,5;1.234,56\n')) === 'csv');
ok('1f çöp baytlar tanınmaz', XB.tani(bayt(0, 1, 2, 3, 0xFF, 0xFE, 7, 0, 0, 0)) === 'bilinmiyor');
ok('1g zip içeriğinden xlsx ayırt edilir', XB.zipBicimi([{ name: 'xl/workbook.xml' }, { name: '[Content_Types].xml' }]) === 'xlsx');
ok('1h zip içeriğinden ods ayırt edilir', XB.zipBicimi([{ name: 'content.xml' }, { name: 'mimetype' }]) === 'ods');
ok('1i zip içeriğinden xlsb ayırt edilir', XB.zipBicimi([{ name: 'xl/workbook.bin' }, { name: 'xl/worksheets/sheet1.bin' }]) === 'xlsb');

// ---------------------------------------------------------------------------------
// 2. Paylaşılan formül kaydırma — xlsx'te formül metni yalnız ilk hücrede durur
// ---------------------------------------------------------------------------------
ok('2a satır kaydırma: A2*B2 → A5*B5', XB.kaydirFormul('A2*B2', 3, 0) === 'A5*B5', XB.kaydirFormul('A2*B2', 3, 0));
ok('2b sütun kaydırma: A2 → C2', XB.kaydirFormul('A2', 0, 2) === 'C2', XB.kaydirFormul('A2', 0, 2));
ok('2c $ ile sabitlenen kaydırılmaz', XB.kaydirFormul('$A$1+A1', 2, 1) === '$A$1+B3', XB.kaydirFormul('$A$1+A1', 2, 1));
ok('2d yarı sabit: $A1 satırı kayar, sütunu kalır', XB.kaydirFormul('$A1', 4, 3) === '$A5', XB.kaydirFormul('$A1', 4, 3));
ok('2e tırnak içindeki metne dokunulmaz', XB.kaydirFormul('IF(A1="A1 sütunu",A1,0)', 1, 0) === 'IF(A2="A1 sütunu",A2,0)', XB.kaydirFormul('IF(A1="A1 sütunu",A1,0)', 1, 0));
ok('2f işlev adının içindeki örüntü başvuru sayılmaz (LOG10)', XB.kaydirFormul('LOG10(A1)', 1, 0) === 'LOG10(A2)', XB.kaydirFormul('LOG10(A1)', 1, 0));
ok('2g tek tırnaklı sayfa adı bozulmaz', XB.kaydirFormul("'Ocak 2026'!A1+B1", 1, 0) === "'Ocak 2026'!A2+B2", XB.kaydirFormul("'Ocak 2026'!A1+B1", 1, 0));
ok('2h sayfa nitelemeli başvuru da kayar', XB.kaydirFormul('Sayfa2!C3', 2, 0) === 'Sayfa2!C5', XB.kaydirFormul('Sayfa2!C3', 2, 0));
ok('2i hata değeri korunur', XB.kaydirFormul('#REF!+A1', 1, 0) === '#REF!+A2', XB.kaydirFormul('#REF!+A1', 1, 0));
ok('2j sayfadan taşan kaydırma #REF! olur', XB.kaydirFormul('A1', -5, 0) === '#REF!', XB.kaydirFormul('A1', -5, 0));
ok('2k kaydırma yoksa metin aynen döner', XB.kaydirFormul('SUM(A1:A9)', 0, 0) === 'SUM(A1:A9)');
ok('2l aralık iki ucuyla kayar', XB.kaydirFormul('SUM(A1:A9)', 1, 0) === 'SUM(A2:A10)', XB.kaydirFormul('SUM(A1:A9)', 1, 0));

// ---------------------------------------------------------------------------------
// 3. Sayı ayrıştırma — "1.234,56" mı "1,234.56" mı
// ---------------------------------------------------------------------------------
ok('3a Türk yazımı: 1.234,56 → 1234,56', XB.sayiMi('1.234,56') === 1234.56, J(XB.sayiMi('1.234,56')));
ok('3b İngiliz yazımı: 1,234.56 → 1234,56', XB.sayiMi('1,234.56') === 1234.56, J(XB.sayiMi('1,234.56')));
ok('3c tek ayraç + üç hane binliktir: 1.234 → 1234', XB.sayiMi('1.234') === 1234, J(XB.sayiMi('1.234')));
ok('3d tek ayraç + bir hane ondalıktır: 1,5 → 1,5', XB.sayiMi('1,5') === 1.5, J(XB.sayiMi('1,5')));
ok('3e parantez eksi demektir', XB.sayiMi('(1.234,50)') === -1234.5, J(XB.sayiMi('(1.234,50)')));
ok('3f yüzde yüze bölünür', XB.sayiMi('12%') === 0.12, J(XB.sayiMi('12%')));
ok('3g metin sayı değildir', XB.sayiMi('15.140.1001 poz') === null, J(XB.sayiMi('15.140.1001 poz')));
ok('3h boş metin sayı değildir', XB.sayiMi('') === null);
ok('3i ÇŞB poz numarası SAYI DEĞİLDİR (son öbek dört hane)', XB.sayiMi('15.140.1001') === null, J(XB.sayiMi('15.140.1001')));
ok('3j üç öbekli gerçek binlik okunur', XB.sayiMi('1.234.567') === 1234567, J(XB.sayiMi('1.234.567')));
ok('3k iki ondalık ayracı sayı değildir', XB.sayiMi('1,2,3') === null, J(XB.sayiMi('1,2,3')));
ok('3l binlik öbeği bozuksa sayı değildir', XB.sayiMi('1.23.456') === null, J(XB.sayiMi('1.23.456')));
ok('3m eksi işaretli ondalık', XB.sayiMi('-0,75') === -0.75, J(XB.sayiMi('-0,75')));
ok('3n tam sayı', XB.sayiMi('42') === 42, J(XB.sayiMi('42')));

// ---------------------------------------------------------------------------------
// 4. CSV — ayraç seçilir, tırnak korunur
// ---------------------------------------------------------------------------------
ok('4a noktalı virgül seçilir (Türkçe Excel)', XB.csvAyrac('a;b;c\n1;2;3\n') === ';');
ok('4b virgül seçilir (İngilizce)', XB.csvAyrac('a,b,c\n1,2,3\n') === ',');
ok('4c sekme seçilir', XB.csvAyrac('a\tb\tc\n1\t2\t3\n') === '\t');
ok('4d tırnak içindeki ayraç sayılmaz', XB.csvAyrac('"a;b;c;d;e";x\n"f;g;h;i;j";y\n') === ',' || XB.csvAyrac('"a;b;c;d;e";x\n"f;g;h;i;j";y\n') === ';');
const cs = XB.csvSatirlar('ad;not\n"Yılmaz; Ali";5\n', ';');
ok('4e tırnak içindeki ayraç alanı bölmez', cs.length === 2 && cs[1][0] === 'Yılmaz; Ali' && cs[1][1] === '5', J(cs));
const cs2 = XB.csvSatirlar('a;b\r\n1;2\r\n', ';');
ok('4f CRLF satır sonu', cs2.length === 2 && cs2[1][1] === '2', J(cs2));
const cs3 = XB.csvSatirlar('"çift ""tırnak""";x\n', ';');
ok('4g iki tırnak bir tırnaktır', cs3[0][0] === 'çift "tırnak"', J(cs3));

// ---------------------------------------------------------------------------------
// 5. CSV → kitap → görünüm (uçtan uca, DOM'suz)
// ---------------------------------------------------------------------------------
{
  const kitap = await XB.kitapOku({ bytes: metinBayt('Poz;Miktar;Tutar\n15.140.1001;12,5;1.234,56\n'), ad: 'kesif.csv' });
  const h = XB.hazirla(kitap);
  const s = h.sayfalar[0];
  ok('5a CSV kitap biçimi', kitap.bicim === 'csv');
  ok('5b üç sütun, iki satır', s.sutun === 3 && s.satir === 2, J({ s: s.sutun, r: s.satir }));
  ok('5c poz numarası METİN kalır (sayıya çevrilmez)', s.ham[1][0] === '15.140.1001', J(s.ham[1][0]));
  ok('5d miktar sayıya çevrilir', s.ham[1][1] === 12.5, J(s.ham[1][1]));
  ok('5e tutar binlik ayracıyla okunur', s.ham[1][2] === 1234.56, J(s.ham[1][2]));
  ok('5f sayı sağa, metin sola hizalanır', s.hiza[1] === 'lrr', J(s.hiza[1]));
}

// ---------------------------------------------------------------------------------
// 6. Hesap ve biçim katmanı
// ---------------------------------------------------------------------------------
const H = (v, f, b) => ({ v: v === undefined ? null : v, f: f || null, b: b == null ? null : b });
function kitapKur(sayfalar, adlar = {}) {
  return {
    bicim: 'sınama',
    sayfalar: sayfalar.map(s => {
      const h = []; let satir = 0, sutun = 0;
      s.h.forEach((sat, r) => sat.forEach((x, c) => { if (!x) return; (h[r] || (h[r] = []))[c] = x; if (r + 1 > satir) satir = r + 1; if (c + 1 > sutun) sutun = c + 1; }));
      return { ad: s.ad, h, satir, sutun, birlesim: s.birlesim || [] };
    }),
    adlar: new Map(Object.entries(adlar).map(([a, b]) => [a.toUpperCase(), b])),
    tarih1904: false, uyarilar: [],
  };
}
{
  // <v> YOK: değer yalnız formülden gelebilir — motorun asıl var oluş sebebi
  const kitap = kitapKur([{ ad: 'Sayfa1', h: [[H(2), H(3)], [H(null, 'A1*B1'), H(null, 'SUM(A1:B1)')]] }]);
  const s = XB.hazirla(kitap).sayfalar[0];
  ok('6a önbellekli değer yokken formül hesaplanır', s.ham[1][0] === 6, J(s.ham[1][0]));
  ok('6b aralık toplamı', s.ham[1][1] === 5, J(s.ham[1][1]));
}
{
  // <v> VAR: Excel'in kendi sonucu kullanılır, yeniden hesaplanmaz
  const kitap = kitapKur([{ ad: 'S', h: [[H(2), H(3)], [H(99, 'A1*B1')]] }]);
  const s = XB.hazirla(kitap).sayfalar[0];
  ok('6c önbellekli değer yeğlenir', s.ham[1][0] === 99, J(s.ham[1][0]));
}
{
  const kitap = kitapKur([
    { ad: 'Ocak', h: [[H(10)]] },
    { ad: 'Özet', h: [[H(null, "Ocak!A1*2")]] },
  ]);
  const s = XB.hazirla(kitap).sayfalar[1];
  ok('6d sayfalar arası başvuru', s.ham[0][0] === 20, J(s.ham[0][0]));
}
{
  const kitap = kitapKur([{ ad: 'S', h: [[H(5)], [H(null, 'KDV*A1')]] }], { KDV: '0.2' });
  const s = XB.hazirla(kitap).sayfalar[0];
  ok('6e tanımlı ad (sabit değer)', Math.abs(s.ham[1][0] - 1) < 1e-9, J(s.ham[1][0]));
}
{
  const kitap = kitapKur([{ ad: 'S', h: [[H(1), H(2), H(3)], [H(null, 'SUM(ARALIK)')]] }], { ARALIK: 'S!$A$1:$C$1' });
  const s = XB.hazirla(kitap).sayfalar[0];
  ok('6f tanımlı ad (aralık)', s.ham[1][0] === 6, J(s.ham[1][0]));
}
{
  const kitap = kitapKur([{ ad: 'S', h: [[H(null, 'A2')], [H(null, 'A1')]] }]);
  const hz = XB.hazirla(kitap);
  ok('6g döngüsel başvuru 0 verir, çökmez', hz.sayfalar[0].ham[0][0] === 0, J(hz.sayfalar[0].ham[0][0]));
  ok('6h döngü uyarı listesine yazılır', hz.uyarilar.some(u => /Döngüsel/.test(u)), J(hz.uyarilar));
}
{
  const kitap = kitapKur([{ ad: 'S', h: [[H(null, 'YOKBOYLEBIRSEY(1)')], [H(null, '1/0')]] }]);
  const s = XB.hazirla(kitap).sayfalar[0];
  ok('6i bilinmeyen işlev #NAME? verir', s.cells[0][0] === '#NAME?', J(s.cells[0][0]));
  ok('6j sıfıra bölme #DIV/0! verir', s.cells[1][0] === '#DIV/0!', J(s.cells[1][0]));
  ok('6k hata ortaya hizalanır', s.hiza[1][0] === 'c', J(s.hiza[1]));
}
{
  // Biçim: değer ile görünüş ayrı
  const kitap = kitapKur([{
    ad: 'S',
    h: [[H(45923, null, 'dd.mm.yyyy'), H(0.18, null, '0%'), H(1234.5, null, '#,##0.00'), H(true), H(0.5, null, 'h:mm')]],
  }]);
  const s = XB.hazirla(kitap).sayfalar[0];
  ok('6l tarih seri sayısı tarih olarak yazılır', s.cells[0][0] === '23.09.2025', J(s.cells[0][0]));
  ok('6m yüzde 100 katı gösterilir', s.cells[0][1] === '18%', J(s.cells[0][1]));
  ok('6n binlik ayracı ve iki hane', s.cells[0][2] === '1.234,50', J(s.cells[0][2]));
  ok('6o mantık değeri DOĞRU yazılır', s.cells[0][3] === 'DOĞRU', J(s.cells[0][3]));
  ok('6p yarım gün 12:00', s.cells[0][4] === '12:00', J(s.cells[0][4]));
  ok('6r ham değer bozulmaz (biçim yalnız görünüş)', s.ham[0][0] === 45923 && s.ham[0][1] === 0.18, J(s.ham[0]));
}
{
  // NOW / TODAY dışarıdan beslenir ki sınama yinelenebilir olsun
  const kitap = kitapKur([{ ad: 'S', h: [[H(null, 'TODAY()')]] }]);
  const s = XB.hazirla(kitap, { simdi: () => 45923.75 }).sayfalar[0];
  ok('6s TODAY dış saatten gelir ve gün tam sayıya iner', s.ham[0][0] === 45923, J(s.ham[0][0]));
}

// ---------------------------------------------------------------------------------
// 7. .xls (BIFF8) — OLE kabuğu ve kayıtlar burada üretilir
// ---------------------------------------------------------------------------------
/* --- küçük BIFF yazıcı --- */
const parcalar = [];
const yaz16 = (n) => bayt(n & 255, (n >> 8) & 255);
const yaz32 = (n) => bayt(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
const birlestir = (list) => { const n = list.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(n); let p = 0; for (const x of list) { o.set(x, p); p += x.length; } return o; };
const kayit = (id, gov) => birlestir([yaz16(id), yaz16(gov.length), gov]);
const uzunMetin = (s) => { const b = metinBayt(s); const ascii = [...s].every(c => c.charCodeAt(0) < 128); return ascii ? birlestir([yaz16(s.length), bayt(0), b]) : birlestir([yaz16(s.length), bayt(1), new Uint8Array(new Uint16Array([...s].map(c => c.charCodeAt(0))).buffer)]); };
const kisaMetin = (s) => { const ascii = [...s].every(c => c.charCodeAt(0) < 128); return ascii ? birlestir([bayt(s.length, 0), metinBayt(s)]) : birlestir([bayt(s.length, 1), new Uint8Array(new Uint16Array([...s].map(c => c.charCodeAt(0))).buffer)]); };
const cift8 = (x) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); return b; };

function biffKitap() {
  // --- genel bölüm ---
  const gen = [];
  gen.push(kayit(0x0809, birlestir([yaz16(0x0600), yaz16(0x0005), yaz16(0), yaz16(0), yaz32(0), yaz32(0)])));
  gen.push(kayit(0x0042, yaz16(1252)));                                   // CODEPAGE
  gen.push(kayit(0x0022, yaz16(0)));                                      // DATEMODE (1900)
  gen.push(kayit(0x041E, birlestir([yaz16(164), uzunMetin('#,##0.00')])));  // FORMAT 164
  const xf = (ifmt) => kayit(0x00E0, birlestir([yaz16(0), yaz16(ifmt), new Uint8Array(16)]));
  gen.push(xf(0), xf(164), xf(14));                                       // XF 0 / 1 / 2
  const sstMetin = ['Poz', 'Açıklama', 'Terfi hattı'];
  const sst = birlestir([yaz32(3), yaz32(3), ...sstMetin.map(uzunMetin)]);
  gen.push(kayit(0x00FC, sst));
  // dolgu: akış 4096 baytı geçsin ki mini akışa değil ana FAT zincirine düşsün
  gen.push(kayit(0x00EF, new Uint8Array(5000)));
  const bsPos = gen.length;
  gen.push(null);                                                          // BOUNDSHEET yeri (konum sonra bilinir)
  gen.push(kayit(0x000A, new Uint8Array(0)));                              // EOF

  // --- sayfa bölümü ---
  const sh = [];
  sh.push(kayit(0x0809, birlestir([yaz16(0x0600), yaz16(0x0010), yaz16(0), yaz16(0), yaz32(0), yaz32(0)])));
  sh.push(kayit(0x00FD, birlestir([yaz16(0), yaz16(0), yaz16(0), yaz32(0)])));            // A1 = SST[0] "Poz"
  sh.push(kayit(0x00FD, birlestir([yaz16(0), yaz16(1), yaz16(0), yaz32(1)])));            // B1 = "Açıklama"
  sh.push(kayit(0x0203, birlestir([yaz16(1), yaz16(0), yaz16(1), cift8(1234.5)])));       // A2 = 1234,5 (biçim 164)
  sh.push(kayit(0x027E, birlestir([yaz16(1), yaz16(1), yaz16(0), yaz32((100 << 2) | 2)])));  // B2 = RK tam sayı 100
  sh.push(kayit(0x027E, birlestir([yaz16(1), yaz16(2), yaz16(0), yaz32((1250 << 2) | 3)]))); // C2 = RK 1250/100 = 12,5
  sh.push(kayit(0x0006, birlestir([yaz16(2), yaz16(0), yaz16(0), cift8(1334.5), yaz16(0), yaz32(0), yaz16(0)])));   // A3 = formül, önbellekli 1334,5
  sh.push(kayit(0x0205, birlestir([yaz16(2), yaz16(1), yaz16(0), bayt(7), bayt(1)])));     // B3 = #DIV/0!
  sh.push(kayit(0x0205, birlestir([yaz16(2), yaz16(2), yaz16(0), bayt(1), bayt(0)])));     // C3 = DOĞRU
  sh.push(kayit(0x00BD, birlestir([yaz16(3), yaz16(0), yaz16(0), yaz32((7 << 2) | 2), yaz16(0), yaz32((8 << 2) | 2), yaz16(2)])));  // A4,B4 = MULRK 7 ve 8
  sh.push(kayit(0x00E5, birlestir([yaz16(1), yaz16(4), yaz16(4), yaz16(0), yaz16(1)])));   // A5:B5 birleşik
  sh.push(kayit(0x000A, new Uint8Array(0)));                                               // EOF

  const genBoy = gen.filter(Boolean).reduce((a, x) => a + x.length, 0);
  const bsUzun = birlestir([yaz32(0), bayt(0, 0), kisaMetin('Kesif')]).length + 4;
  const ofs = genBoy + bsUzun;
  gen[bsPos] = kayit(0x0085, birlestir([yaz32(ofs), bayt(0, 0), kisaMetin('Kesif')]));
  return birlestir([...gen, ...sh]);
}
/* --- küçük OLE (CFB) yazıcı: 512 baytlık sektör, tek FAT, tek akış --- */
function oleYaz(akisAdi, veri) {
  const SS = 512, ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF, FATSECT = 0xFFFFFFFD;
  const nVeri = Math.ceil(veri.length / SS);
  const fatSek = 0, veriBas = 1, dirSek = veriBas + nVeri;
  const toplamSek = dirSek + 1;
  const buf = new Uint8Array(SS * (1 + toplamSek));
  const dv = new DataView(buf.buffer);
  buf.set(bayt(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1), 0);
  dv.setUint16(0x18, 0x003E, true); dv.setUint16(0x1A, 3, true); dv.setUint16(0x1C, 0xFFFE, true);
  dv.setUint16(0x1E, 9, true); dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2C, 1, true);                 // FAT sektör sayısı
  dv.setUint32(0x30, dirSek, true);            // ilk dizin sektörü
  dv.setUint32(0x38, 4096, true);              // mini akış eşiği
  dv.setUint32(0x3C, ENDOFCHAIN, true); dv.setUint32(0x40, 0, true);
  dv.setUint32(0x44, ENDOFCHAIN, true); dv.setUint32(0x48, 0, true);
  dv.setUint32(0x4C, fatSek, true);
  for (let i = 1; i < 109; i++) dv.setUint32(0x4C + 4 * i, FREESECT, true);
  // FAT
  const fatO = (fatSek + 1) * SS;
  for (let i = 0; i < SS / 4; i++) dv.setUint32(fatO + 4 * i, FREESECT, true);
  dv.setUint32(fatO + 4 * fatSek, FATSECT, true);
  for (let i = 0; i < nVeri; i++) dv.setUint32(fatO + 4 * (veriBas + i), i === nVeri - 1 ? ENDOFCHAIN : veriBas + i + 1, true);
  dv.setUint32(fatO + 4 * dirSek, ENDOFCHAIN, true);
  // veri
  buf.set(veri, (veriBas + 1) * SS - SS + SS);   // (veriBas+1)*SS
  // dizin: kök + akış
  const dirO = (dirSek + 1) * SS;
  const ad = (o, s, tur, sol, sag, cocuk, bas, boy) => {
    for (let i = 0; i < s.length; i++) dv.setUint16(o + 2 * i, s.charCodeAt(i), true);
    dv.setUint16(o + 64, (s.length + 1) * 2, true);
    buf[o + 66] = tur; buf[o + 67] = 1;
    dv.setUint32(o + 68, sol, true); dv.setUint32(o + 72, sag, true); dv.setUint32(o + 76, cocuk, true);
    dv.setUint32(o + 116, bas, true); dv.setUint32(o + 120, boy, true);
  };
  ad(dirO, 'Root Entry', 5, FREESECT, FREESECT, 1, ENDOFCHAIN, 0);
  ad(dirO + 128, akisAdi, 2, FREESECT, FREESECT, FREESECT, veriBas, veri.length);
  return buf;
}
{
  const xlsBayt = oleYaz('Workbook', biffKitap());
  const kitap = await XB.kitapOku({ bytes: xlsBayt, ad: 'kesif.xls' });
  const hz = XB.hazirla(kitap);
  const s = hz.sayfalar[0];
  ok('7a .xls OLE kabuğundan okunur', kitap.bicim === 'xls');
  ok('7b sayfa adı BOUNDSHEET kaydından', s.ad === 'Kesif', J(s.ad));
  ok('7c paylaşılan dizge (LABELSST)', s.ham[0][0] === 'Poz' && s.ham[0][1] === 'Açıklama', J(s.ham[0]));
  ok('7d NUMBER kaydı (çift duyarlı)', s.ham[1][0] === 1234.5, J(s.ham[1][0]));
  ok('7e özel biçim (FORMAT 164) uygulanır', s.cells[1][0] === '1.234,50', J(s.cells[1][0]));
  ok('7f RK tam sayı', s.ham[1][1] === 100, J(s.ham[1][1]));
  ok('7g RK yüze bölünen', s.ham[1][2] === 12.5, J(s.ham[1][2]));
  ok('7h FORMULA önbellekli sonucu', s.ham[2][0] === 1334.5, J(s.ham[2][0]));
  ok('7i BOOLERR hata', s.ham[2][1] && s.ham[2][1].e === '#DIV/0!', J(s.ham[2][1]));
  ok('7j BOOLERR mantık', s.ham[2][2] === true, J(s.ham[2][2]));
  ok('7k MULRK iki hücre birden', s.ham[3][0] === 7 && s.ham[3][1] === 8, J(s.ham[3]));
  ok('7l MERGEDCELLS birleşimi', s.birlesim.includes('A5:B5'), J(s.birlesim));
  ok('7m OLE dosyası ama Excel değilse açık hata', await (async () => { try { await XB.kitapOku({ bytes: oleYaz('WordDocument', new Uint8Array(6000)) }); return false; } catch (e) { return /Workbook akışı yok/.test(e.message); } })());
}

// ---------------------------------------------------------------------------------
// 8. yapisalKaydir (v8.8): satır/sütun ekleme-silmede formül başvurularının Excel kuralıyla kayması
//    Aralıklar BİRİM olarak işlenir: sayfa önekli aralığın iki ucu da dokunulmaz, tamamı silinen
//    aralık ters aralığa kırpılmak yerine #REF! olur; tam sütun (B:B) ve tam satır (1:1)
//    başvuruları da kendi ekseninde kayar (inceleme bulguları).
// ---------------------------------------------------------------------------------
{
  const T = [
    ['A1+B2', 'satir', 0, 1, 'A2+B3'], ['SUM(A1:A5)', 'satir', 2, 1, 'SUM(A1:A6)'],
    ['SUM(A2:A5)', 'satir', 0, 1, 'SUM(A3:A6)'], ['SUM(A1:A5)', 'satir', 2, -1, 'SUM(A1:A4)'],
    ['A3*2', 'satir', 2, -1, '#REF!*2'], ['$B$3', 'satir', 1, 1, '$B$4'],
    ['C1+D1', 'sutun', 2, 1, 'D1+E1'], ['SUM(B1:D1)', 'sutun', 2, -1, 'SUM(B1:C1)'],
    ['Sayfa2!A1+B1', 'satir', 0, 1, 'Sayfa2!A1+B2'], ['"A1 sabit"&A1', 'satir', 0, 1, '"A1 sabit"&A2'],
    ['LOG10(A1)', 'satir', 0, 1, 'LOG10(A2)'], ['#REF!+A2', 'satir', 0, 1, '#REF!+A3'],
    ['SUM(B:B)', 'sutun', 1, 1, 'SUM(C:C)'], ['SUM(B:B)', 'sutun', 0, 1, 'SUM(C:C)'],
    ['SUM(B:B)', 'sutun', 2, 1, 'SUM(B:B)'], ['SUM(B:B)', 'sutun', 1, -1, 'SUM(#REF!)'],
    ['SUM(B:D)', 'sutun', 2, -1, 'SUM(B:C)'], ['SUM(B:B)', 'satir', 0, 1, 'SUM(B:B)'],
    ['SUM(1:1)', 'satir', 0, 1, 'SUM(2:2)'], ['SUM(2:5)', 'satir', 2, -1, 'SUM(2:4)'],
    ['SUM(3:3)', 'satir', 2, -1, 'SUM(#REF!)'], ['SUM(1:1)', 'sutun', 0, 1, 'SUM(1:1)'],
    ['SUM(B2:B2)', 'satir', 1, -1, 'SUM(#REF!)'], ['SUM(B2:C2)', 'sutun', 1, -1, 'SUM(B2:B2)'],
    ['SUM(Sayfa2!A1:B5)', 'satir', 0, 1, 'SUM(Sayfa2!A1:B5)'],
    ["SUM('Veri 26'!A1:B5)", 'satir', 0, 1, "SUM('Veri 26'!A1:B5)"],
  ];
  let kalanlar = [];
  for (const [f, e, i, d, want] of T) { const got = XB.yapisalKaydir(f, e, i, d); if (got !== want) kalanlar.push(f + '→' + got + '≠' + want); }
  ok('8a yapisalKaydir ' + T.length + ' durum (hücre, aralık, tam sütun/satır, sayfa öneki, #REF!)', kalanlar.length === 0, kalanlar.join(' | '));
  ok('8b tanımlı ad çözümü (adDegeri): aralık ve düz değer', (() => {
    const adlar = new Map([['VERGI', '0,2'.replace(',', '.')], ['VERI', "'Veri 26'!$A$1:$B$4"]]);
    const a = XB.adDegeri(adlar, 'vergi', 'Sayfa1'), b = XB.adDegeri(adlar, 'Veri', 'Sayfa1');
    return a === 0.2 && b && b.sayfa === 'Veri 26' && b.r1 === 0 && b.c2 === 1 && b.r2 === 3 && XB.adDegeri(adlar, 'yok', 'S') === undefined;
  })());
}

// ---------------------------------------------------------------------------------
console.log(`\nSONUÇ: ${g} geçti, ${k} kaldı`);
process.exit(k ? 1 : 0);
