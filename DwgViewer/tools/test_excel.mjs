// Excel biçimleri — gerçek görüntüleyicide uçtan uca sınama.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_excel.mjs [çıktı]
//
// Burada sınanan, DOM gerektiren yoldur: xlsx (formül, sayı biçimi, paylaşılan formül,
// birleştirme), xlsb (ikili), ods, Excel 2003 XML ve ".xls" adıyla kaydedilmiş HTML
// tablosu. DOM istemeyen katman (biçim tanıma, sayı ayrıştırma, CSV, hesap, BIFF8)
// tools/test_xlbook.mjs içinde Playwright'siz koşar.
//
// Dosyaların hepsi burada üretilir: depoya ikili örnek konmaz.
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const { out } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;

// ---- küçük ZIP yazıcı (store + deflate, CRC32) ----
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files) {
  const parts = [], cds = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name, 'utf8'), raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = zlib.deflateRawSync(raw); const useDef = comp.length < raw.length; const body = useDef ? comp : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(useDef ? 8 : 0, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, body);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(useDef ? 8 : 0, 10); cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(off, 42);
    cds.push(cd, nb);
    off += lh.length + nb.length + body.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(files.length, 8); eo.writeUInt16LE(files.length, 10); eo.writeUInt32LE(cdBuf.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, eo]);
}
const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

// ---------------------------------------------------------------------------------
// 1. xlsx: önbelleksiz formül, sayı biçimi, paylaşılan formül, birleştirme, tanımlı ad
// ---------------------------------------------------------------------------------
/*
 * Bu dosya bilerek "openpyxl gibi" yazıldı: formül hücrelerinde <v> YOKTUR. Excel'in
 * kaydettiği bir dosyada değer de bulunur; burada bulunmaması, motorun gerçekten
 * hesapladığını kanıtlar. B2:B4 paylaşılan formüldür — metin yalnız B2'de durur.
 */
const sheet1 = `<worksheet xmlns="${SML}"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2"><v>120</v></c><c r="B2"><f t="shared" ref="B2:B4" si="0">A2*2</f></c><c r="C2" s="1"><v>45923</v></c><c r="D2" s="2"><v>0.18</v></c></row>
<row r="3"><c r="A3"><v>50</v></c><c r="B3"><f t="shared" si="0"/></c><c r="C3" s="3"><v>1234.5</v></c><c r="D3"><f>SUM(A2:A4)</f></c></row>
<row r="4"><c r="A4"><v>7</v></c><c r="B4"><f t="shared" si="0"/></c><c r="C4"><f>ORAN</f></c><c r="D4"><f>Fiyat!A1*2</f></c></row>
<row r="5"><c r="A5" t="s"><v>4</v></c></row>
</sheetData><mergeCells count="1"><mergeCell ref="A5:D5"/></mergeCells></worksheet>`;
const sheet2 = `<worksheet xmlns="${SML}"><sheetData><row r="1"><c r="A1"><v>15</v></c></row></sheetData></worksheet>`;
const styles = `<styleSheet xmlns="${SML}"><numFmts count="1"><numFmt numFmtId="166" formatCode="#,##0.00 &quot;TL&quot;"/></numFmts>`
  + `<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="9"/><xf numFmtId="166"/></cellXfs></styleSheet>`;
const xlsx = makeZip([
  ['[Content_Types].xml', '<Types/>'],
  ['xl/workbook.xml', `<workbook xmlns="${SML}" xmlns:r="${RNS}"><sheets><sheet name="Metraj" sheetId="1" r:id="rId1"/><sheet name="Fiyat" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="ORAN">Fiyat!$A$1</definedName></definedNames></workbook>`],
  ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>`],
  ['xl/sharedStrings.xml', `<sst xmlns="${SML}"><si><t>Miktar</t></si><si><t>İki katı</t></si><si><t>Tarih</t></si><si><t>Oran</t></si><si><t>Toplam satırı</t></si></sst>`],
  ['xl/styles.xml', styles],
  ['xl/worksheets/sheet1.xml', sheet1],
  ['xl/worksheets/sheet2.xml', sheet2],
]);
fs.writeFileSync(path.join(out, 'metraj_formul.xlsx'), xlsx);

// ---------------------------------------------------------------------------------
// 2. ODS
// ---------------------------------------------------------------------------------
const odsContent = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet>
<table:table table:name="Hakedis">
<table:table-row><table:table-cell office:value-type="string"><text:p>Kalem</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Tutar</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Boru</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="1500.25"><text:p>1500,25</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Kazı</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="2500"><text:p>2500</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Toplam</text:p></table:table-cell><table:table-cell table:formula="of:=SUM([.B2:.B3])"><text:p/></table:table-cell></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`;
fs.writeFileSync(path.join(out, 'hakedis.ods'), makeZip([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'], ['content.xml', odsContent]]));

// ---------------------------------------------------------------------------------
// 3. Excel 2003 XML — uzantısı .xls ama içeriği XML
// ---------------------------------------------------------------------------------
const sml2003 = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Etut">
<Table>
<Row><Cell><Data ss:Type="String">Debi</Data></Cell><Cell><Data ss:Type="Number">42.5</Data></Cell></Row>
<Row><Cell ss:Index="2"><Data ss:Type="Number">17.5</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Toplam</Data></Cell><Cell ss:Formula="=R[-2]C+R[-1]C"><Data ss:Type="Number">60</Data></Cell></Row>
</Table></Worksheet></Workbook>`;
fs.writeFileSync(path.join(out, 'etut_2003.xls'), sml2003);

// ---------------------------------------------------------------------------------
// 4. ".xls" adıyla kaydedilmiş HTML tablosu (kurum yazılımı çıktısı)
// ---------------------------------------------------------------------------------
const htmlXls = `<html><head><meta charset="utf-8"></head><body>
<table border="1">
<tr><th colspan="2">İSU Abone Listesi</th></tr>
<tr><td>Abone</td><td>Tüketim</td></tr>
<tr><td>12345</td><td>1.234,50</td></tr>
<tr><td>67890</td><td>987,25</td></tr>
</table></body></html>`;
fs.writeFileSync(path.join(out, 'abone.xls'), htmlXls);

// ---------------------------------------------------------------------------------
// 5. xlsb — ikili parçalar
// ---------------------------------------------------------------------------------
/* BIFF12 kayıt yazıcısı: değişken uzunluklu kimlik ve boy */
function brt(id, gov) {
  const idB = id < 0x80 ? [id] : [(id & 0x7F) | 0x80, id >> 7];
  const boy = []; let n = gov.length;
  do { let x = n & 0x7F; n >>= 7; if (n) x |= 0x80; boy.push(x); } while (n);
  return Buffer.concat([Buffer.from(idB), Buffer.from(boy), Buffer.from(gov)]);
}
const u32b = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };
const u16b = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF, 0); return b; };
const wstr = (s) => Buffer.concat([u32b(s.length), Buffer.from(s, 'utf16le')]);
const f64b = (x) => { const b = Buffer.alloc(8); b.writeDoubleLE(x, 0); return b; };
const hucreBas = (c, ixf) => Buffer.concat([u32b(c), u32b(ixf & 0xFFFFFF)]);
const xlsbSheet = Buffer.concat([
  brt(0x0000, Buffer.concat([u32b(0), Buffer.alloc(12)])),                                  // BrtRowHdr r=0
  brt(0x0007, Buffer.concat([hucreBas(0, 0), u32b(0)])),                                     // A1 = SST[0]
  brt(0x0007, Buffer.concat([hucreBas(1, 0), u32b(1)])),                                     // B1 = SST[1]
  brt(0x0000, Buffer.concat([u32b(1), Buffer.alloc(12)])),                                  // satır 2
  brt(0x0005, Buffer.concat([hucreBas(0, 0), f64b(3200.75)])),                               // A2 sayı
  brt(0x0002, Buffer.concat([hucreBas(1, 0), u32b((250 << 2) | 2)])),                        // B2 RK tam sayı 250
  brt(0x0000, Buffer.concat([u32b(2), Buffer.alloc(12)])),                                  // satır 3
  brt(0x0009, Buffer.concat([hucreBas(0, 0), f64b(3450.75), u16b(0), u32b(0)])),             // A3 formül, önbellekli
  brt(0x00B0, Buffer.concat([u32b(3), u32b(3), u32b(0), u32b(1)])),                          // A4:B4 birleşik
]);
const xlsbSst = Buffer.concat([
  brt(0x009F, Buffer.concat([u32b(2), u32b(2)])),
  brt(0x0013, Buffer.concat([Buffer.from([0]), wstr('Kalem')])),
  brt(0x0013, Buffer.concat([Buffer.from([0]), wstr('Adet')])),
]);
const xlsbWb = brt(0x009C, Buffer.concat([u32b(0), u32b(1), wstr('rId1'), wstr('Ikili')]));
const xlsb = makeZip([
  ['[Content_Types].xml', '<Types/>'],
  ['xl/workbook.bin', xlsbWb],
  ['xl/_rels/workbook.bin.rels', `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.bin"/></Relationships>`],
  ['xl/sharedStrings.bin', xlsbSst],
  ['xl/worksheets/sheet1.bin', xlsbSheet],
]);
fs.writeFileSync(path.join(out, 'ikili.xlsb'), xlsb);

// ---------------------------------------------------------------------------------
// Tarayıcı
// ---------------------------------------------------------------------------------
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.accept(); });
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2');

const ac = async (dosya, bekle = 600) => { await page.setInputFiles('#fileInput', path.join(out, dosya)); await page.waitForTimeout(bekle); };
/** Etkin sayfadaki hücre metni (0 tabanlı satır / sütun; başlık satırı ve sütunu atlanır) */
const H = (r, c) => ev(([rr, cc]) => {
  const tr = document.querySelectorAll('.xlsx-tbl tr')[rr + 1];
  if (!tr) return null;
  const td = tr.querySelectorAll('td')[cc];
  return td ? td.textContent : null;
}, [r, c]);
const tabloMetni = () => ev(() => (document.querySelector('.xlsx-tbl') || {}).textContent || '');

// ---- 1. xlsx: hesap ve biçim ----
await ac('metraj_formul.xlsx');
ok('1a xlsx açıldı, iki sayfa sekmesi var', await ev(() => !document.getElementById('docView').hidden && document.querySelectorAll('#docTools [data-sheet]').length === 2), await tabloMetni().then(s => s.slice(0, 60)));
ok('1b önbelleksiz formül hesaplandı (A2*2 = 240)', (await H(1, 1)) === '240', await H(1, 1));
ok('1c paylaşılan formül kaydırıldı (A3*2 = 100)', (await H(2, 1)) === '100', await H(2, 1));
ok('1d paylaşılan formül üçüncü satırda da doğru (A4*2 = 14)', (await H(3, 1)) === '14', await H(3, 1));
ok('1e aralık toplamı (SUM(A2:A4) = 177)', (await H(2, 3)) === '177', await H(2, 3));
ok('1f sayfalar arası başvuru (Fiyat!A1*2 = 30)', (await H(3, 3)) === '30', await H(3, 3));
ok('1g tanımlı ad çözüldü (ORAN = 15)', (await H(3, 2)) === '15', await H(3, 2));
ok('1h tarih biçimi uygulandı (45923 → 23.09.2025)', (await H(1, 2)) === '23.09.2025', await H(1, 2));
ok('1i yüzde biçimi uygulandı (0,18 → %18)', (await H(1, 3)) === '18%', await H(1, 3));
ok('1j özel para biçimi uygulandı', (await H(2, 2)) === '1.234,50 TL', await H(2, 2));
{
  const hz = await ev(() => [...document.querySelectorAll('.xlsx-tbl tr')].slice(1).map(tr => [...tr.querySelectorAll('td')].map(td => td.className || '-').join(',')));
  ok('1k sayı sağa hizalı (num), metin sola (sınıfsız)', hz[0] === '-,-,-,-' && hz[1] === 'num,num,num,num' && hz[2] === 'num,num,num,num' && hz[4] === '-', JSON.stringify(hz));
}
ok('1l birleştirilmiş hücre colspan taşır', await ev(() => !!document.querySelector('.xlsx-tbl td[colspan="4"]')));
await shot('excel_xlsx');
// ikinci sayfaya geç
await page.click('#docTools [data-sheet="1"]'); await page.waitForTimeout(250);
ok('1m ikinci sayfa açılıyor', (await H(0, 0)) === '15', await H(0, 0));

// ---- 2. ODS ----
await ac('hakedis.ods');
ok('2a ods açıldı', await ev(() => !!document.querySelector('.xlsx-tbl')));
ok('2b ods metin hücresi', (await H(1, 0)) === 'Boru', await H(1, 0));
ok('2c ods sayı hücresi (biçimsiz genel görünüm)', (await H(1, 1)) === '1500,25', await H(1, 1));
ok('2d ods formülü hesaplandı (SUM(B2:B3) = 4000,25)', (await H(3, 1)) === '4000,25', await H(3, 1));
await shot('excel_ods');

// ---- 3. Excel 2003 XML (.xls uzantılı) ----
await ac('etut_2003.xls');
ok('3a 2003 XML açıldı', await ev(() => !!document.querySelector('.xlsx-tbl')));
ok('3b sayfa adı okundu', await ev(() => (document.querySelector('#docTools [data-sheet="0"]') || {}).textContent === 'Etut'));
ok('3c ss:Index atlaması korunur (ikinci satır B sütununda)', (await H(1, 0)) === '' && (await H(1, 1)) === '17,5', JSON.stringify([await H(1, 0), await H(1, 1)]));
ok('3d R1C1 formülü çözüldü ve önbellekli sonuç yazıldı', (await H(2, 1)) === '60', await H(2, 1));
await shot('excel_2003');

// ---- 4. HTML tablosu ".xls" adıyla ----
await ac('abone.xls');
ok('4a HTML tablosu Excel gibi açıldı', await ev(() => !!document.querySelector('.xlsx-tbl')));
ok('4b başlık birleştirmesi korundu', await ev(() => !!document.querySelector('.xlsx-tbl td[colspan="2"]')));
ok('4c Türk yazımı sayı okundu', (await H(2, 1)) === '1234,5', await H(2, 1));
ok('4d abone numarası metin kalmadı, sayı oldu (beş hane, ayraçsız)', (await H(2, 0)) === '12345', await H(2, 0));
await shot('excel_html');

// ---- 5. xlsb ----
await ac('ikili.xlsb');
ok('5a xlsb açıldı', await ev(() => !!document.querySelector('.xlsx-tbl')));
ok('5b paylaşılan dizge okundu', (await H(0, 0)) === 'Kalem' && (await H(0, 1)) === 'Adet', JSON.stringify([await H(0, 0), await H(0, 1)]));
ok('5c çift duyarlı sayı', (await H(1, 0)) === '3200,75', await H(1, 0));
ok('5d RK tam sayı', (await H(1, 1)) === '250', await H(1, 1));
ok('5e formülün önbellekli sonucu', (await H(2, 0)) === '3450,75', await H(2, 0));
ok('5f sayfa adı BrtBundleSh kaydından', await ev(() => (document.querySelector('#docTools [data-sheet="0"]') || {}).textContent === 'Ikili'));
await shot('excel_xlsb');

// ---- 6. tanınmayan dosya: açık hata, sessiz boş ekran değil ----
fs.writeFileSync(path.join(out, 'bozuk.xlsx'), Buffer.from([0x50, 0x4B, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]));
await ac('bozuk.xlsx', 500);
ok('6a bozuk dosya hata kartı gösterir', await ev(() => /açılamadı|failed|Fail/i.test(document.getElementById('docContent').textContent || '')), await ev(() => (document.getElementById('docContent').textContent || '').slice(0, 80)));

ok('7a sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

C.summary(errors);
await browser.close(); srv.kill();
C.exit();
