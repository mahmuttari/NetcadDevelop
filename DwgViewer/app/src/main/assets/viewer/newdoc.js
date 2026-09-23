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
export function xlsxXml(rows, o = {}) {
  /*
   * v8.8: yazıcı artık üç katman tanır (hepsi isteğe bağlı — verilmezse eski davranış):
   *   o.ham       ham değerler (sayı sayı olarak, mantık mantık olarak yazılır)
   *   o.formuller seyrek formül dizisi — <f> + önbellek değeri <v> yazılır; Excel açılışta
   *               yeniden hesaplasın diye workbook'a calcPr fullCalcOnLoad konur (xlsxBook)
   *   o.stil      (ri, ci) → cellXfs indeksi (0 = biçimsiz); dolgu boş hücrede de korunur
   */
  const stil = typeof o.stil === 'function' ? o.stil : null;
  const sayiYaz = (n) => String(n);   // JS'in üstel yazımını (1e-7) Excel de okur
  const body = rows.map((cells, ri) => {
    const hamSat = o.ham ? (o.ham[ri] || []) : null;
    const fSat = o.formuller ? o.formuller[ri] : null;
    const enCok = Math.max((cells || []).length, hamSat ? hamSat.length : 0, fSat ? fSat.length : 0);
    let cs = '';
    for (let ci = 0; ci < enCok; ci++) {
      const ref = colName(ci) + (ri + 1);
      const sN = stil ? stil(ri, ci) : 0;
      const sA = sN ? ` s="${sN}"` : '';
      const f = fSat ? fSat[ci] : null;
      const raw = hamSat ? hamSat[ci] : undefined;
      const v = (cells || [])[ci];
      if (f) {
        // önbellek değeri: sayı düz <v>, metin t="str", mantık t="b"; hata/boşta <v> yazılmaz
        let tA = '', vX = '';
        if (typeof raw === 'number' && isFinite(raw)) vX = `<v>${sayiYaz(raw)}</v>`;
        else if (typeof raw === 'boolean') { tA = ' t="b"'; vX = `<v>${raw ? 1 : 0}</v>`; }
        else if (typeof raw === 'string') { tA = ' t="str"'; vX = `<v>${xEsc(raw)}</v>`; }
        cs += `<c r="${ref}"${sA}${tA}><f>${xEsc(f)}</f>${vX}</c>`;
        continue;
      }
      if (typeof raw === 'number' && isFinite(raw)) { cs += `<c r="${ref}"${sA}><v>${sayiYaz(raw)}</v></c>`; continue; }
      if (typeof raw === 'boolean') { cs += `<c r="${ref}"${sA} t="b"><v>${raw ? 1 : 0}</v></c>`; continue; }
      const metin = raw != null && typeof raw !== 'object' ? String(raw) : (v == null ? '' : String(v));
      cs += metin === ''
        ? `<c r="${ref}"${sA}/>`
        : `<c r="${ref}"${sA} t="inlineStr"><is><t xml:space="preserve">${xEsc(metin)}</t></is></c>`;
    }
    return `<row r="${ri + 1}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
/*
 * Hücre stillerinden styles.xml kurar (v8.8). Excel'in dosyayı açması için fills'in ilk iki
 * kaydı none ve gray125, cellXfs'in 0. kaydı varsayılan olmak ZORUNDADIR; kalanı kullanılan
 * (kalın, italik, yazı rengi, dolgu) birleşimlerinden türetilir. indexOf her birleşime tek
 * cellXf verir; hiç stil kullanılmazsa parça yine yazılır (paket listesi belgeden belgeye
 * değişmesin), Excel kullanılmayan stil tablosunu sorun etmez.
 */
export function stilTablosu() {
  const hex = (x) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(x || '').trim()); return m ? m[1].toUpperCase() : ''; };
  const fontlar = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>'];
  const dolgular = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const fontIdx = new Map([['|', 0]]), dolguIdx = new Map([['', 0]]), xfIdx = new Map([['0:0', 0]]);
  const indexOf = (st) => {
    if (!st || (!st.b && !st.i && !hex(st.renk) && !hex(st.dolgu))) return 0;
    const fKey = (st.b ? 'b' : '') + (st.i ? 'i' : '') + '|' + hex(st.renk);
    let fi = fontIdx.get(fKey);
    if (fi == null) {
      fi = fontlar.length;
      fontlar.push(`<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}<sz val="11"/>${hex(st.renk) ? `<color rgb="FF${hex(st.renk)}"/>` : '<color theme="1"/>'}<name val="Calibri"/></font>`);
      fontIdx.set(fKey, fi);
    }
    const dKey = hex(st.dolgu);
    let di = dolguIdx.get(dKey);
    if (di == null) {
      di = dolgular.length;
      dolgular.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${dKey}"/><bgColor indexed="64"/></patternFill></fill>`);
      dolguIdx.set(dKey, di);
    }
    const xKey = fi + ':' + di;
    let xi = xfIdx.get(xKey);
    if (xi == null) {
      xi = xfs.length;
      xfs.push(`<xf numFmtId="0" fontId="${fi}" fillId="${di}" borderId="0" xfId="0"${fi ? ' applyFont="1"' : ''}${di ? ' applyFill="1"' : ''}/>`);
      xfIdx.set(xKey, xi);
    }
    return xi;
  };
  const xml = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fontlar.length}">${fontlar.join('')}</fonts><fills count="${dolgular.length}">${dolgular.join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs></styleSheet>`;
  return { indexOf, xml };
}
/**
 * Çok sayfalı XLSX: sheets = [{ name, rows }]. Sayfa sırası ve adları korunur; her sayfa kendi
 * worksheet parçasına yazılır ve workbook.xml.rels ile bağlanır.
 */
export function xlsxBook(sheets) {
  const list = (sheets && sheets.length ? sheets : [{ name: 'Sayfa1', rows: [] }]).slice(0, 200);
  const stiller = stilTablosu();
  const parts = list.map((s, i) => ({ i: i + 1, name: String(s.name || ('Sayfa' + (i + 1))), rows: s.rows || [], ham: s.ham || null, formuller: s.formuller || null, stil: s.stiller ? ((r, c) => stiller.indexOf(s.stiller[r + ',' + c])) : null }));
  // Sayfa XML'leri styles.xml'den ÖNCE kurulur: indexOf kullanılan birleşimleri o sırada toplar
  const sayfaXml = parts.map(p => xlsxXml(p.rows, { ham: p.ham, formuller: p.formuller, stil: p.stil }));
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${parts.map(p => `<Override PartName="/xl/worksheets/sheet${p.i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  // calcPr fullCalcOnLoad: formül önbelleği bizim hesabımızdır; Excel açılışta kendisi doğrulasın
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${parts.map(p => `<sheet name="${xEsc(p.name).slice(0, 31)}" sheetId="${p.i}" r:id="rId${p.i}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`;
  const nStil = parts.length + 1;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${parts.map(p => `<Relationship Id="rId${p.i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${p.i}.xml"/>`).join('')}<Relationship Id="rId${nStil}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zipWrite([
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/workbook.xml', data: enc.encode(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/styles.xml', data: enc.encode(stiller.xml()) },
    ...parts.map((p, i) => ({ name: `xl/worksheets/sheet${p.i}.xml`, data: enc.encode(sayfaXml[i]) })),
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
