/*
 * Yeni belge oluşturma: boş bir dosya üretilir, cihaza yazılır ve normal açma yolundan açılır.
 *
 * Tasarım: burada yalnız "boş dosyanın baytları" üretilir; açma, görüntüleme ve düzenleme mevcut
 * yollardan yürür. Böylece yeni bir DXF çizim düzenleyicisine, yeni bir DOCX Word düzenleyicisine,
 * yeni bir PDF açıklama düzenleyicisine hiçbir ek kod olmadan düşer.
 *
 * Android'de bayt dizisi saveBytes ile "downloads" klasörüne yazılıp openDownload ile açılır: dosya
 * kalıcı olur ve PDF, PdfRenderer yolundan (kimlikli) açılır. Tarayıcıda Blob doğrudan açılır.
 */
import { t } from './i18n.js';
import { zipWrite, htmlToDocx } from './docedit.js';
import { loadPdfLib } from './pdfedit.js';

const enc = new TextEncoder();
/** Dosya adı tabanları ASCII'dir: Android saveBytes adı [A-Za-z0-9._-] dışına çıkmayacak biçimde temizler. */
export const NEW_KINDS = [
  { id: 'dxf', ext: 'dxf', base: 'drawing', icon: 'i-pline', i18n: 'newDrawing' },
  { id: 'docx', ext: 'docx', base: 'document', icon: 'i-text', i18n: 'newWord' },
  { id: 'xlsx', ext: 'xlsx', base: 'sheet', icon: 'i-grid', i18n: 'newSheet' },
  { id: 'pdf', ext: 'pdf', base: 'document', icon: 'i-pdf', i18n: 'newPdf' },
  { id: 'txt', ext: 'txt', base: 'notes', icon: 'i-text', i18n: 'newText' },
  { id: 'csv', ext: 'csv', base: 'table', icon: 'i-grid', i18n: 'newCsv' },
];
export const kindOfNew = (id) => NEW_KINDS.find(k => k.id === id) || null;

/** Boş çizim: AC1009 (R12) başlık, 0 katmanı, boş ENTITIES. Uzam 0-100 m verilir ki ilk görünüm makul olsun. */
const DXF_EMPTY = ['0', 'SECTION', '2', 'HEADER',
  '9', '$ACADVER', '1', 'AC1009',
  '9', '$INSUNITS', '70', '6',
  '9', '$EXTMIN', '10', '0.0', '20', '0.0', '30', '0.0',
  '9', '$EXTMAX', '10', '100.0', '20', '100.0', '30', '0.0',
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'TABLES',
  '0', 'TABLE', '2', 'LAYER', '70', '1',
  '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS',
  '0', 'ENDTAB', '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES', '0', 'ENDSEC',
  '0', 'EOF', ''].join('\r\n');

const XL_ROWS = 30, XL_COLS = 8;   // boş sayfada görünen ızgara; satır ve sütun düzenleyiciden çoğaltılır
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const xEsc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * rows: string[][] → en küçük XLSX paketi. Değerler satır içi dizge (inlineStr) yazılır: paylaşılan dizge
 * tablosu gerekmez, dosya tek geçişte kurulur. Sayıya benzeyen hücreler de dizge kalır — hücrede yazılan
 * ne ise dosyada o durur, Excel'in yerel ayara göre yeniden yorumlaması beklenmez.
 *
 * Boş hücre de yazılır (<c r="B3"/>): ızgaranın eni hücre başvurularından okunur, tamamı boş bir sayfada
 * hiç <c> yazılmazsa dosya sütunsuz görünür ve yeni çalışma sayfası tek sütuna iner.
 */
export function xlsxXml(rows) {
  const body = rows.map((cells, ri) => {
    const cs = (cells || []).map((v, ci) => (v == null || v === '')
      ? `<c r="${colName(ci)}${ri + 1}"/>`
      : `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${xEsc(v)}</t></is></c>`).join('');
    return `<row r="${ri + 1}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
/**
 * Çok sayfalı XLSX: sheets = [{ name, rows }]. Sayfa sırası ve adları korunur; her sayfa kendi
 * worksheet parçasına yazılır ve workbook.xml.rels ile bağlanır.
 */
export function xlsxBook(sheets) {
  const list = (sheets && sheets.length ? sheets : [{ name: 'Sayfa1', rows: [] }]).slice(0, 200);
  const parts = list.map((s, i) => ({ i: i + 1, name: String(s.name || ('Sayfa' + (i + 1))), rows: s.rows || [] }));
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${parts.map(p => `<Override PartName="/xl/worksheets/sheet${p.i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${parts.map(p => `<sheet name="${xEsc(p.name).slice(0, 31)}" sheetId="${p.i}" r:id="rId${p.i}"/>`).join('')}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.map(p => `<Relationship Id="rId${p.i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${p.i}.xml"/>`).join('')}</Relationships>`;
  return zipWrite([
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    ...parts.map(p => ({ name: `xl/worksheets/sheet${p.i}.xml`, data: enc.encode(xlsxXml(p.rows)) })),
  ]);
}
export function xlsxBytes(rows, sheetName = 'Sayfa1') { return xlsxBook([{ name: sheetName, rows }]); }
/** Satırları CSV'ye çevirir: ayraç noktalı virgül (Türkçe Excel'in beklediği), tırnak ikilenir */
export function csvText(rows, sep = ';') {
  return rows.map(r => (r || []).map(v => { const s = String(v == null ? '' : v); return /["\n\r;,\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(sep)).join('\r\n') + '\r\n';
}

async function emptyDocx() {
  const root = document.createElement('div');
  root.innerHTML = '<p><br></p>';
  return htmlToDocx(root, null);   // A4, 72 pt kenar (htmlToDocx varsayılanı)
}
async function emptyPdf() {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);   // A4
  return doc.save({ useObjectStreams: false });
}

/** Seçilen türün boş içeriğini üretir (Uint8Array) */
export async function newBytes(id) {
  const k = kindOfNew(id); if (!k) throw new Error('bilinmeyen tür: ' + id);
  if (id === 'dxf') return enc.encode(DXF_EMPTY);
  if (id === 'docx') return emptyDocx();
  if (id === 'pdf') return emptyPdf();
  if (id === 'xlsx') return xlsxBytes(Array.from({ length: XL_ROWS }, () => Array.from({ length: XL_COLS }, () => '')));
  if (id === 'csv') return enc.encode(csvText(Array.from({ length: XL_ROWS }, () => Array.from({ length: XL_COLS }, () => ''))));
  return enc.encode('');   // txt
}
/** Öntanımlı ad: tür tabanı + saat damgası (aynı adın üzerine yazılmasın) */
export function defaultName(id) {
  const k = kindOfNew(id); if (!k) return 'file.txt';
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${k.base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${k.ext}`;
}
export const mimeOfNew = (id) => ({ dxf: 'image/vnd.dxf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv' }[id] || 'application/octet-stream');

const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

/**
 * Yeni dosyayı oluşturur ve açar. Android'de kalıcı olarak yazılır (Çevrimdışı listesinde görünür),
 * tarayıcıda Blob olarak açılır. api: { loadBytes, openBlob, toast }
 */
export async function createAndOpen(id, name, api) {
  const bytes = new Uint8Array(await newBytes(id));
  const A = window.Android;
  if (A && A.saveBytes && A.openDownload) {
    const fid = A.saveBytes(name, b64(bytes));
    if (fid) { A.openDownload(fid); return { name, id: fid, bytes: bytes.length }; }
  }
  const file = new File([bytes], name, { type: mimeOfNew(id) });
  await api.openBlob(file, name);
  return { name, bytes: bytes.length };
}
export const label = (id) => { const k = kindOfNew(id); return k ? t(k.i18n) : id; };
