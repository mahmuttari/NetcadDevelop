/*
 * CAD dışı belgeler: PDF, Word (.docx ve .doc), Excel (bütün biçimler), ZIP / RAR arşivleri, resim ve metin.
 *
 *  - Android'de PDF sayfaları PdfRenderer ile çizilir (/file/pdfpage_<id>_<sayfa>_<genişlik>);
 *    tarayıcıda yerleşik PDF görüntüleyici (embed) kullanılır.
 *  - ZIP: tarayıcıda DecompressionStream'li yerleşik okuyucu, Android'de arcList/arcExtract
 *    (RAR 2/3/4 junrar ile, RAR5 kendi saf Java çözücümüzle — Rar5.java).
 *  - Arşiv ÇIKARMA arsiv.js'tedir: araç çubuğunda "Tümünü çıkar" / "Bu klasörü çıkar", her satırda
 *    kendi çıkarma düğmesi (klasörde bütün alt ağaç). Hedef İndirilenler/DWGViewer/<arşiv adı>/…;
 *    Android'de baytlar JS'e uğramadan Java'dan MediaStore'a akar (köprü arcSave).
 *  - DOCX: OOXML → HTML (paragraf, başlık, liste, tablo, resim, köprü).
 *  - Excel: xlbook.js okur ve hesaplar — xlsx / xlsm, xlsb (ikili), xls (BIFF8/5, cfb.js), ods,
 *    Excel 2003 XML, ".xls" adıyla kaydedilmiş HTML tablosu ve CSV. Biçim uzantıdan değil baytlardan
 *    tanınır. Değeri olmayan formüller hesaplanır (xlfn.js), sayı biçimi uygulanır (xlfmt.js).
 *  - DOC (Word 97-2003, MS-DOC ikili): doc.js docToHtml aynı HTML şeklini üretir; Word görünümü ortaktır. ".doc" uzantılı
 *    RTF / Word HTML / MHTML / DOCX / düz metin içerik baytlardan tanınır (docalt.js sniffDoc) ve uygun yolla açılır.
 *    Word iki kiple görülür: Sayfa (yazdırma önizleme — belgedeki sayfa boyutu ve kenar boşluklarıyla sayfalanmış) ve Akış.
 *  - Arşivden çıkan DWG/DXF çizim olarak açılır; diğerleri belge görünümünde (iç içe arşiv desteklenir).
 *  - .ppt / .pptx / .rtf / .odt gibi biçimler için Google Drive ile PDF'e dönüştürme önerilir (drive.js).
 */
import { fmt, store, numLocale, sepOf } from './state.js';
import { t } from './i18n.js';
import { CP857, decodeCp } from './codepage.js';
import { lockAttr, lockBadge, lockText } from './edition.js';
import { docToHtml } from './doc.js';
import { sniffDoc, sniffHint, rtfToHtml, htmlToParts, mhtmlParts, decodeHtmlBytes } from './docalt.js';
import * as PdfEdit from './pdfedit.js';
import * as DocEdit from './docedit.js';
import * as Arsiv from './arsiv.js';
import { askText, askConfirm, askForm } from './dialog.js';
import { xlsxBook, csvText } from './newdoc.js';
import * as XB from './xlbook.js';
import { hesapla as xlHesapla } from './xlfn.js';
import { bicimle } from './xlfmt.js';
import { skelDoc, skelThumb } from './skel.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = () => window.Android;
let api = null;
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };

export const KIND = {
  cad: ['dwg', 'dxf', 'dgn'], pdf: ['pdf'], docx: ['docx', 'docm', 'dotx'], doc: ['doc', 'dot'], xlsx: ['xlsx', 'xlsm', 'xltx', 'xltm', 'xlsb', 'xls', 'xlt', 'xlw', 'ods', 'fods', 'sxc'], office: ['rtf', 'odt', 'ppt', 'pptx', 'odp'],
  zip: ['zip', 'jar', 'kmz', 'cbz'], rar: ['rar', 'cbr'], image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'], text: ['txt', 'csv', 'json', 'xml', 'md', 'log', 'ini', 'gpx', 'kml', 'prj', 'asc', 'ncn', 'nct', 'gml', 'geojson'],
};
export function kindOf(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  for (const k of Object.keys(KIND)) if (KIND[k].includes(ext)) return k;
  return 'other';
}
export const isCad = (name) => kindOf(name) === 'cad';
/** Word görünümünü (sayfa / akış, yakınlaştırma, iki parmak) paylaşan türler */
const isWord = (k) => k === 'docx' || k === 'doc';
const KIND_ICON = { cad: 'i-pline', pdf: 'i-pdf', docx: 'i-text', doc: 'i-text', xlsx: 'i-grid', office: 'i-text', zip: 'i-layers', rar: 'i-layers', image: 'i-image', text: 'i-text', other: 'i-info', folder: 'i-open' };
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
export const iconFor = (name, isDir) => ICON(isDir ? 'i-open' : KIND_ICON[kindOf(name)] || 'i-info');
const fmtSize = (n) => n == null || !(n >= 0) ? '' : n < 1024 ? n + ' B' : n < 1048576 ? fmt(n / 1024, 1) + ' KB' : fmt(n / 1048576, 2) + ' MB';

// ---------------------------------------------------------------------------------
// ZIP okuyucu (tarayıcı) — merkezi dizin + deflate-raw
// ---------------------------------------------------------------------------------
class ZipReader {
  constructor(buf) { this.buf = buf; this.dv = new DataView(buf); this.u8 = new Uint8Array(buf); this.entries = this._dir(); }
  _dir() {
    const dv = this.dv, n = this.u8.length;
    let eocd = -1;
    for (let i = n - 22; i >= Math.max(0, n - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('ZIP dizini bulunamadı');
    let count = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    // ZIP64
    if (count === 0xffff || off === 0xffffffff) {
      for (let i = eocd - 20; i >= Math.max(0, eocd - 100); i--) if (dv.getUint32(i, true) === 0x07064b50) { const z64 = Number(dv.getBigUint64(i + 8, true)); count = Number(dv.getBigUint64(z64 + 32, true)); off = Number(dv.getBigUint64(z64 + 48, true)); break; }
    }
    const out = [], td = new TextDecoder('utf-8');
    let p = off;
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), time = dv.getUint16(p + 12, true), date = dv.getUint16(p + 14, true);
      let csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      let loff = dv.getUint32(p + 42, true);
      const nameBytes = this.u8.subarray(p + 46, p + 46 + nlen);
      const name = (flags & 0x800) ? td.decode(nameBytes) : decodeCp(nameBytes, CP857);   // UTF-8 bayrağı yoksa ad OEM kod sayfasındadır (Türkçe Windows: CP857)
      // zip64 ek alanı
      let q = p + 46 + nlen; const qe = q + elen;
      while (q + 4 <= qe) { const id = dv.getUint16(q, true), l = dv.getUint16(q + 2, true); if (id === 1) { let r = q + 4; if (size === 0xffffffff) { size = Number(dv.getBigUint64(r, true)); r += 8; } if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(r, true)); r += 8; } if (loff === 0xffffffff) loff = Number(dv.getBigUint64(r, true)); } q += 4 + l; }
      const d = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
      out.push({ name, size, csize, method, loff, dir: name.endsWith('/'), time: d.getTime(), enc: !!(flags & 1) });
      p += 46 + nlen + elen + clen;
    }
    return out;
  }
  async read(name) {
    const e = this.entries.find(x => x.name === name); if (!e) throw new Error('girdi yok: ' + name);
    if (e.enc) throw new Error('Şifreli ZIP desteklenmiyor');
    const dv = this.dv, p = e.loff;
    if (dv.getUint32(p, true) !== 0x04034b50) throw new Error('bozuk yerel başlık');
    const nlen = dv.getUint16(p + 26, true), elen = dv.getUint16(p + 28, true);
    const start = p + 30 + nlen + elen;
    const data = this.u8.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice().buffer;
    if (e.method !== 8) throw new Error('desteklenmeyen sıkıştırma: ' + e.method);
    if (typeof DecompressionStream !== 'function') throw new Error('Bu tarayıcı deflate açamıyor');
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(data); w.close();
    return new Response(ds.readable).arrayBuffer();
  }
}
/** Ortak arşiv arayüzü: tarayıcıda ZipReader, Android'de arcList/arcExtract (ZIP + RAR) */
async function openArchive(src) {
  if (src.androidId && A() && A().arcList) {
    const r = JSON.parse(A().arcList(src.androidId) || '[]');
    if (r.error) throw new Error(r.error);
    return {
      entries: r, native: true, id: src.androidId,
      async extract(name) { const x = JSON.parse(A().arcExtract(src.androidId, name) || '{}'); if (x.error) throw new Error(x.error); return x; },   // {id,name,size,ext}
      async read(name) { const x = await this.extract(name); const res = await fetch('/file/' + x.id, { cache: 'no-store' }); return res.arrayBuffer(); },
      async url(name) { const x = await this.extract(name); return '/file/' + x.id; },
    };
  }
  if (src.bytes) {
    const z = new ZipReader(src.bytes);
    return { entries: z.entries, native: false, async read(name) { return z.read(name); }, async url(name) { const b = await z.read(name); return URL.createObjectURL(new Blob([b], { type: mimeFor(name) })); } };
  }
  throw new Error('arşiv kaynağı yok');
}
function mimeFor(name) { const k = kindOf(name), e = name.toLowerCase().split('.').pop(); return k === 'image' ? (e === 'svg' ? 'image/svg+xml' : e === 'jpg' ? 'image/jpeg' : 'image/' + e) : k === 'pdf' ? 'application/pdf' : 'application/octet-stream'; }

// ---------------------------------------------------------------------------------
// DOCX → HTML
// ---------------------------------------------------------------------------------
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
function parseXml(buf) { const txt = new TextDecoder('utf-8').decode(buf); const doc = new DOMParser().parseFromString(txt, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('XML çözümlenemedi'); return doc; }
function relsOf(doc) { const m = new Map(); if (!doc) return m; for (const r of doc.getElementsByTagName('Relationship')) m.set(r.getAttribute('Id'), { target: r.getAttribute('Target'), mode: r.getAttribute('TargetMode'), type: r.getAttribute('Type') || '' }); return m; }
const attr = (el, name) => el ? el.getAttributeNS(W_NS, name) ?? el.getAttribute('w:' + name) : null;
const child = (el, name) => { if (!el) return null; for (const c of el.children) if (c.localName === name) return c; return null; };
const childOn = (el, name) => { const c = child(el, name); if (!c) return false; const v = attr(c, 'val'); return v == null || v === '1' || v === 'true' || v === 'on'; };
export async function docxToHtml(arc) {
  const main = parseXml(await arc.read('word/document.xml'));
  let rels = new Map(), styles = null, numbering = null;
  try { rels = relsOf(parseXml(await arc.read('word/_rels/document.xml.rels'))); } catch (_) { /* yok */ }
  try { styles = parseXml(await arc.read('word/styles.xml')); } catch (_) { /* yok */ }
  try { numbering = parseXml(await arc.read('word/numbering.xml')); } catch (_) { /* yok */ }
  // stiller: id → {name, heading, rPr}
  const styleMap = new Map();
  if (styles) for (const st of styles.getElementsByTagNameNS(W_NS, 'style')) { const id = attr(st, 'styleId'); const nm = attr(child(st, 'name'), 'val') || ''; const m = /^heading\s*(\d)/i.exec(nm) || /^başlık\s*(\d)/i.exec(nm); styleMap.set(id, { name: nm, heading: m ? Math.min(6, +m[1]) : (/^title$/i.test(nm) ? 1 : 0), based: attr(child(st, 'basedOn'), 'val') }); }
  // numaralandırma: numId → abstractNum → seviye biçimi
  const numFmt = new Map();
  if (numbering) {
    const abs = new Map();
    for (const an of numbering.getElementsByTagNameNS(W_NS, 'abstractNum')) { const lv = {}; for (const l of an.getElementsByTagNameNS(W_NS, 'lvl')) lv[attr(l, 'ilvl')] = { fmt: attr(child(l, 'numFmt'), 'val'), text: attr(child(l, 'lvlText'), 'val') }; abs.set(attr(an, 'abstractNumId'), lv); }
    for (const n of numbering.getElementsByTagNameNS(W_NS, 'num')) numFmt.set(attr(n, 'numId'), abs.get(attr(child(n, 'abstractNumId'), 'val')) || {});
  }
  const imgCache = new Map();
  const imgUrl = async (rid) => { const r = rels.get(rid); if (!r) return ''; const key = r.target; if (imgCache.has(key)) return imgCache.get(key); let url = ''; try { url = await arc.url('word/' + key.replace(/^\/?word\//, '').replace(/^\//, '')); } catch (_) { url = ''; } imgCache.set(key, url); return url; };
  const runHtml = async (r) => {
    const pr = child(r, 'rPr'); let out = '';
    for (const c of r.children) {
      const n = c.localName;
      if (n === 't') out += esc(c.textContent);
      else if (n === 'tab') out += '<span class="tab"></span>';
      else if (n === 'br') out += attr(c, 'type') === 'page' ? '<div class="pagebreak"></div>' : '<br>';
      else if (n === 'cr') out += '<br>';
      else if (n === 'sym') out += esc(String.fromCharCode(parseInt(attr(c, 'char') || '0', 16)));
      else if (n === 'drawing' || n === 'pict' || n === 'object') {
        const blip = c.getElementsByTagNameNS(A_NS, 'blip')[0]; const im = blip ? null : c.getElementsByTagName('v:imagedata')[0] || [...c.getElementsByTagName('*')].find(x => x.localName === 'imagedata');
        const rid = blip ? (blip.getAttributeNS(R_NS, 'embed') || blip.getAttribute('r:embed')) : im ? (im.getAttributeNS(R_NS, 'id') || im.getAttribute('r:id')) : null;
        if (rid) { const url = await imgUrl(rid); if (url) { let w = ''; const ext = c.getElementsByTagName('wp:extent')[0] || [...c.getElementsByTagName('*')].find(x => x.localName === 'extent'); if (ext && ext.getAttribute('cx')) w = ` style="width:${Math.round(+ext.getAttribute('cx') / 12700)}pt;max-width:100%"`; out += `<img src="${esc(url)}"${w} alt="">`; } }
      } else if (n === 'footnoteReference') out += `<sup>[${esc(attr(c, 'id'))}]</sup>`;
    }
    if (!out) return '';
    if (pr) {
      const st = [];
      if (childOn(pr, 'b')) st.push('font-weight:700'); if (childOn(pr, 'i')) st.push('font-style:italic');
      const dec = []; if (child(pr, 'u') && attr(child(pr, 'u'), 'val') !== 'none') dec.push('underline'); if (childOn(pr, 'strike') || childOn(pr, 'dstrike')) dec.push('line-through'); if (dec.length) st.push('text-decoration:' + dec.join(' '));
      const col = attr(child(pr, 'color'), 'val'); if (col && col !== 'auto' && /^[0-9a-f]{6}$/i.test(col)) st.push('color:#' + col);
      const sz = attr(child(pr, 'sz'), 'val'); if (sz) st.push('font-size:' + (+sz / 2) + 'pt');
      const hl = attr(child(pr, 'highlight'), 'val'); if (hl && hl !== 'none') st.push('background:' + hl);
      const sh = attr(child(pr, 'shd'), 'fill'); if (sh && sh !== 'auto' && /^[0-9a-f]{6}$/i.test(sh)) st.push('background:#' + sh);
      const va = attr(child(pr, 'vertAlign'), 'val'); if (va === 'superscript') out = '<sup>' + out + '</sup>'; else if (va === 'subscript') out = '<sub>' + out + '</sub>';
      const caps = childOn(pr, 'caps'); if (caps) st.push('text-transform:uppercase');
      if (st.length) out = `<span style="${st.join(';')}">${out}</span>`;
    }
    return out;
  };
  const inlineHtml = async (el) => {
    let out = '';
    for (const c of el.children) {
      const n = c.localName;
      if (n === 'r') out += await runHtml(c);
      else if (n === 'hyperlink') { const rid = c.getAttributeNS(R_NS, 'id') || c.getAttribute('r:id'); const r = rid ? rels.get(rid) : null; const inner = await inlineHtml(c); out += r && r.target ? `<a href="${esc(r.target)}" target="_blank" rel="noopener">${inner}</a>` : (attr(c, 'anchor') ? `<a href="#${esc(attr(c, 'anchor'))}">${inner}</a>` : inner); }
      else if (n === 'sdt') { const ct = child(c, 'sdtContent'); if (ct) out += await inlineHtml(ct); }
      else if (n === 'smartTag' || n === 'ins' || n === 'fldSimple' || n === 'customXml') out += await inlineHtml(c);
      else if (n === 'del') { /* silinen izlenen değişiklik */ }
      else if (n === 'bookmarkStart') { const nm = attr(c, 'name'); if (nm && nm !== '_GoBack') out += `<a id="${esc(nm)}"></a>`; }
    }
    return out;
  };
  const counters = {};
  const paraHtml = async (p) => {
    const pr = child(p, 'pPr');
    const sid = attr(child(pr, 'pStyle'), 'val'); const st = sid ? styleMap.get(sid) : null;
    let tag = 'p', cls = '', style = [];
    if (st && st.heading) tag = 'h' + st.heading; else if (/^(Title|Başlık)$/i.test((st && st.name) || '')) tag = 'h1';
    const jc = attr(child(pr, 'jc'), 'val'); if (jc === 'center' || jc === 'both' || jc === 'right') style.push('text-align:' + (jc === 'both' ? 'justify' : jc));
    const ind = child(pr, 'ind'); if (ind) { const l = attr(ind, 'left') || attr(ind, 'start'); if (l) style.push('margin-left:' + (+l / 20) + 'pt'); const fl = attr(ind, 'firstLine'); if (fl) style.push('text-indent:' + (+fl / 20) + 'pt'); }
    const sp = child(pr, 'spacing'); if (sp) { const a = attr(sp, 'after'); if (a != null) style.push('margin-bottom:' + (+a / 20) + 'pt'); const b = attr(sp, 'before'); if (b != null) style.push('margin-top:' + (+b / 20) + 'pt'); }
    const shd = attr(child(pr, 'shd'), 'fill'); if (shd && shd !== 'auto' && /^[0-9a-f]{6}$/i.test(shd)) style.push('background:#' + shd);
    let prefix = '';
    const np = child(pr, 'numPr');
    if (np) {
      const numId = attr(child(np, 'numId'), 'val'), ilvl = attr(child(np, 'ilvl'), 'val') || '0';
      const lv = (numFmt.get(numId) || {})[ilvl] || {};
      style.push('margin-left:' + (18 + 18 * +ilvl) + 'pt'); cls = 'li';
      if (lv.fmt === 'bullet' || !lv.fmt) prefix = '<span class="bul">•</span>';
      else { const key = numId + ':' + ilvl; counters[key] = (counters[key] || 0) + 1; for (const k of Object.keys(counters)) if (k.startsWith(numId + ':') && +k.split(':')[1] > +ilvl) counters[k] = 0; const n = counters[key]; const txt = lv.fmt === 'lowerLetter' ? String.fromCharCode(96 + n) : lv.fmt === 'upperLetter' ? String.fromCharCode(64 + n) : lv.fmt === 'lowerRoman' ? roman(n).toLowerCase() : lv.fmt === 'upperRoman' ? roman(n) : String(n); prefix = `<span class="bul">${esc((lv.text || '%1.').replace(/%\d/, txt))}</span>`; }
    }
    if (childOn(pr, 'pageBreakBefore')) prefix = '<div class="pagebreak"></div>' + prefix;
    const inner = await inlineHtml(p);
    return `<${tag}${cls ? ` class="${cls}"` : ''}${style.length ? ` style="${style.join(';')}"` : ''}>${prefix}${inner || '&nbsp;'}</${tag}>`;
  };
  const tableHtml = async (tbl) => {
    let out = '<table class="docx-tbl">';
    for (const tr of tbl.children) {
      if (tr.localName !== 'tr') continue;
      out += '<tr>';
      for (const tc of tr.children) {
        if (tc.localName !== 'tc') continue;
        const pr = child(tc, 'tcPr'); const span = attr(child(pr, 'gridSpan'), 'val'); const vm = child(pr, 'vMerge');
        if (vm && attr(vm, 'val') !== 'restart') continue; // birleştirilen alt hücre
        const shd = attr(child(pr, 'shd'), 'fill'); const st = shd && shd !== 'auto' && /^[0-9a-f]{6}$/i.test(shd) ? ` style="background:#${shd}"` : '';
        const w = attr(child(pr, 'tcW'), 'w'); const ws = w && attr(child(pr, 'tcW'), 'type') === 'dxa' ? ` width="${Math.round(+w / 20)}"` : '';
        out += `<td${span ? ` colspan="${span}"` : ''}${st}${ws}>` + (await blockHtml(tc)) + '</td>';
      }
      out += '</tr>';
    }
    return out + '</table>';
  };
  const blockHtml = async (el) => {
    let out = '';
    for (const c of el.children) {
      const n = c.localName;
      if (n === 'p') out += await paraHtml(c);
      else if (n === 'tbl') out += await tableHtml(c);
      else if (n === 'sdt') { const ct = child(c, 'sdtContent'); if (ct) out += await blockHtml(ct); }
      else if (n === 'sectPr') { /* bölüm ayarları */ }
      else if (n === 'customXml' || n === 'smartTag') out += await blockHtml(c);
    }
    return out;
  };
  const body = main.getElementsByTagNameNS(W_NS, 'body')[0];
  // sayfa ölçüsü (son bölümün sectPr'si; twip → pt): boyut yoksa A4 (595 × 842 pt), kenar boşluğu yoksa 1440 twip = 72 pt
  const sect = body ? child(body, 'sectPr') : null;
  const pg = sect ? child(sect, 'pgSz') : null, mg = sect ? child(sect, 'pgMar') : null;
  const tw = (el, k, def) => { const v = el ? attr(el, k) : null; const n = v == null ? NaN : +v; return isFinite(n) && n >= 0 ? n / 20 : def; };
  const page = { width: tw(pg, 'w', 595), height: tw(pg, 'h', 842), margins: { top: tw(mg, 'top', 72), right: tw(mg, 'right', 72), bottom: tw(mg, 'bottom', 72), left: tw(mg, 'left', 72) } };
  const width = pg && attr(pg, 'w') ? page.width + 'pt' : '';   // akış görünümünün en çok genişliği (uyumluluk)
  // üst düzey bloklar ayrı ayrı (parts): showDocx uzun belgeyi parça parça basar / sayfalar; html tamamı (uyumluluk)
  const parts = [];
  if (body) for (const c of body.children) { const n = c.localName; if (n === 'p') parts.push(await paraHtml(c)); else if (n === 'tbl') parts.push(await tableHtml(c)); else if (n === 'sdt' || n === 'customXml' || n === 'smartTag') { const h = await blockHtml(n === 'sdt' ? (child(c, 'sdtContent') || c) : c); if (h) parts.push(h); } }
  return { html: parts.join(''), width, parts, page };
}
const DOCX_PAGE = 3000;
function roman(n) { const v = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1], s = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I']; let o = ''; for (let i = 0; i < v.length; i++) while (n >= v[i]) { o += s[i]; n -= v[i]; } return o; }

// ---------------------------------------------------------------------------------
// XLSX → HTML (sayfa sekmeleri + tablo)
// ---------------------------------------------------------------------------------
/*
 * ÇALIŞMA KİTABI → basılabilir sayfalar. Okuma, hesap ve biçim xlbook.js'tedir (xlsx, xls,
 * ods, SpreadsheetML 2003, HTML tablosu, CSV); burada yalnız ekrana basma kalır.
 *
 * Kaynak seçimi: ZIP tabanlı biçimlerde (xlsx / ods) arşiv okuyucusu kullanılır — Android
 * tarafı arşivi kendisi açabildiğinde dosya belleğe hiç alınmaz. Arşiv açılamıyorsa dosya
 * ZIP değildir (eski .xls, HTML tablosu, CSV…); o zaman baytlardan tanınır.
 */
async function kitapAc(d) {
  let arc = null;
  try { arc = await arcFor(d); } catch (_) { arc = null; }
  if (arc) {
    const b = XB.zipBicimi(arc.entries);
    if (b === 'xlsx' || b === 'ods' || b === 'xlsb') return XB.kitapOku({ arc, ad: d.name }, { tt });
  }
  d.arc = null;
  return XB.kitapOku({ bytes: await bytesOf(d), ad: d.name }, { tt });
}
/** Hazırlanmış bir sayfayı HTML tablosuna çevirir (birleştirme, hizalama, biçim rengi) */
function sayfaGorunum(s) {
  // s.cells / s.hiza / s.renk TEMBELDİR (bkz. xlbook.hazirla): burada dokunulmaz, yalnız
  // tablo basılırken okunur. Böylece yirmi sayfalık bir kitapta bakılmayan on dokuz sayfa
  // hiç hesaplanmaz.
  const maxC = Math.max(s.sutun, 1);
  const span = new Map(), skip = new Set();
  for (const m of s.birlesim || []) {
    const [a, b] = String(m).split(':'); if (!b) continue;
    const ra = +a.replace(/\D+/g, '') - 1, ca = colIndex(a.replace(/[\d$]+/g, ''));
    const rb = +b.replace(/\D+/g, '') - 1, cb = colIndex(b.replace(/[\d$]+/g, ''));
    if (!(ra >= 0 && ca >= 0 && rb >= ra && cb >= ca)) continue;
    span.set(ra + ':' + ca, [rb - ra + 1, cb - ca + 1]);
    for (let r2 = ra; r2 <= rb; r2++) for (let c2 = ca; c2 <= cb; c2++) if (r2 !== ra || c2 !== ca) skip.add(r2 + ':' + c2);
  }
  // html: sayfanın tamamı (uyumluluk); tableHtml(upto): ilk upto satır — büyük sayfalar
  // (on binlerce satır) parça parça basılır, ana iş parçacığı kilitlenmesin.
  const tableHtml = (upto = s.satir) => {
    const rows = s.cells, hizalar = s.hiza, renkler = s.renk;
    let html = '<table class="xlsx-tbl"><tr><th></th>' + Array.from({ length: maxC }, (_, i) => `<th>${colName(i)}</th>`).join('') + '</tr>';
    const n = Math.min(upto, rows.length);
    for (let ri = 0; ri < n; ri++) {
      const cells = rows[ri] || [], hz = hizalar[ri] || '';
      html += `<tr><th>${ri + 1}</th>`;
      for (let ci = 0; ci < maxC; ci++) {
        if (skip.has(ri + ':' + ci)) continue;
        const sp = span.get(ri + ':' + ci);
        const v = cells[ci] == null ? '' : cells[ci];
        const h = hz[ci] === 'r' ? ' class="num"' : hz[ci] === 'c' ? ' class="ctr"' : '';
        const renk = renkler && renkler.get(ri + ':' + ci);
        html += `<td${sp ? ` rowspan="${sp[0]}" colspan="${sp[1]}"` : ''}${h}${renk ? ` style="color:${renk}"` : ''}>${esc(v)}</td>`;
      }
      html += '</tr>';
    }
    return html + '</table>';
  };
  return { name: s.ad, get html() { return tableHtml(); }, tableHtml, get cells() { return s.cells; }, get ham() { return s.ham; }, get formuller() { return s.formuller; }, get bicimler() { return s.bicimler; }, rows: s.satir, maxC };
}
/** Belgeyi okuyup basılabilir sayfalara çevirir (eski xlsxToHtml'in yerini alır) */
export async function xlsxSayfalar(d) {
  const kitap = await kitapAc(d);
  const hazir = XB.hazirla(kitap, { ayar: sepOf() });   // ondalık / binlik ayracı arayüz dilinden (Excel'in kendi davranışı)
  const sheets = hazir.sayfalar.map(sayfaGorunum);
  sheets.bicim = hazir.bicim;
  sheets.uyarilar = hazir.uyarilar;
  sheets.adlar = hazir.adlar;   // tanımlı adlar: düzenleyicinin ctx.ad'ı ve kayıttaki definedNames buradan
  return sheets;
}
const XLSX_PAGE = 1000;
function colIndex(letters) { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return Math.max(0, n - 1); }
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

// ---------------------------------------------------------------------------------
// Görünüm
// ---------------------------------------------------------------------------------
const stack = [];       // iç içe belgeler (arşiv › belge)
let cur = null;         // { kind, name, size, id?, bytes?, arc?, path?, pdf?, zoom }
let els = null;
export function initDocs(a) {
  api = a;
  els = { view: $('docView'), name: $('docName'), meta: $('docMeta'), acts: $('docActs'), tools: $('docTools'), body: $('docContent') };
  if (!els.view) return;
  els.view.addEventListener('click', (ev) => {
    const pe = ev.target.closest('[data-pe]'); if (pe) { onEditAction(pe); return; }
    const b = ev.target.closest('[data-doc]'); if (!b) return;
    const k = b.dataset.doc;
    if (k === 'edit') { startEdit(cur); return; }
    if (k === 'wshare') { shareTo('com.whatsapp', 'WhatsApp'); return; }
    if (k === 'close') close(); else if (k === 'back') back();
    else if (k === 'home') call(api.goHome);   // belge KAPANMAZ, ana ekran üste gelir
    else if (k === 'share') share(false); else if (k === 'open') share(true); else if (k === 'keep') keep(); else if (k === 'drive') call(api.driveUpload, cur);
    else if (k === 'convert') call(api.driveConvert, cur);
    else if (k === 'pdfprev') pdfGoto(pdfCurrent() - 1); else if (k === 'pdfnext') pdfGoto(pdfCurrent() + 1);
    else if (k === 'zin') zoomDoc(1.25); else if (k === 'zout') zoomDoc(0.8); else if (k === 'zfit') zoomDoc(0);
    else if (k === 'layout') docxSetLayout(cur && cur.layout === 'page' ? 'flow' : 'page');
    else if (k === 'wrap') { els.body.classList.toggle('nowrap'); }
  });
  els.body.addEventListener('scroll', () => { if (cur && cur.kind === 'pdf') { pdfUpdatePage(); pdfLazy(); } });
  // Araç çubuğundaki açılır seçiciler (Word: stil / yazı boyu): change tek yerden dağıtılır
  els.tools.addEventListener('change', (ev) => { const sel = ev.target.closest('[data-pe-sel]'); if (sel) onEditSelect(sel); });
  bindPinch(els.body);
}
export const isOpen = () => !!(els && els.view && !els.view.hidden);
export const current = () => cur;
/** Ana ekrandaki "kaldığınız yerden devam edin" kartı için açık belgenin adı */
export const currentName = () => (cur && cur.name) || '';
/** Android kayıtlı belge {id,name,size,ext}; CAD ise çizim olarak yüklenir */
export async function openRegistered(info, opts = {}) {
  const kind = kindOf(info.name);
  if (kind === 'cad') { if (A() && A().docOpenAsCurrent) { A().docOpenAsCurrent(info.id); return; } const buf = await (await fetch('/file/' + info.id, { cache: 'no-store' })).arrayBuffer(); await api.loadBytes(buf, info.name, info.size); return; }
  return show({ kind, name: info.name, size: info.size, id: info.id }, opts);
}
/** Geçerli (Android) dosya CAD değilse belge olarak açar */
export async function openCurrent(name, size) {
  if (!A() || !A().docOpen) return false;
  const info = JSON.parse(A().docOpen('current') || '{}');
  if (info.error) throw new Error(info.error);
  await openRegistered(info);
  return true;
}
/** Tarayıcı: File/Blob */
export async function openBlob(file, name, opts = {}) {
  name = name || file.name;
  const kind = kindOf(name);
  if (kind === 'cad') { await api.loadBytes(await file.arrayBuffer(), name, file.size); return; }
  return show({ kind, name, size: file.size, blob: file }, opts);
}
async function bytesOf(d) {
  if (d.bytes) return d.bytes;
  if (d.blob) { d.bytes = await d.blob.arrayBuffer(); return d.bytes; }
  if (d.id) { d.bytes = await (await fetch('/file/' + d.id, { cache: 'no-store' })).arrayBuffer(); return d.bytes; }
  throw new Error('belge verisi yok');
}
function urlOf(d) { if (d.id) return '/file/' + d.id; if (d.blob) { if (!d.url) d.url = URL.createObjectURL(d.blob); return d.url; } if (d.bytes) { if (!d.url) d.url = URL.createObjectURL(new Blob([d.bytes], { type: mimeFor(d.name) })); return d.url; } return ''; }

async function show(d, opts = {}) {
  if (!els || !els.view) throw new Error('belge görünümü yok');
  if (cur && !opts.replace) stack.push(cur);
  cur = d; d.zoom = d.zoom || 1;
  els.view.hidden = false; document.body.classList.add('docmode');
  // Ad satıra sarar (bkz. app.css .doc-title); üç satırı aşan absürt bir adın tamamı da
  // title özniteliğinden okunabilsin.
  els.name.textContent = d.name; els.name.title = d.name;
  els.meta.textContent = [fmtSize(d.size), kindLabel(d.kind)].filter(Boolean).join(' · ');
  els.view.querySelector('[data-doc="back"]').hidden = !stack.length;
  // Bekleme boşluğu, gelecek içeriğin biçimini gösterir: belge için sayfa iskeleti, görsel için
  // ızgaralı önizleme kartı. İskelet süstür (aria-hidden); "Yükleniyor…" yanındaki görünmez
  // metinden okunur.
  els.tools.innerHTML = ''; els.body.innerHTML = `<div class="doc-loading">${d.kind === 'image' ? skelThumb() : skelDoc()}</div>`; els.body.className = 'doc-body kind-' + d.kind; els.body.scrollTop = 0;
  renderActs(d);
  call(api.onOpen, d);
  try {
    if (d.kind === 'pdf') await showPdf(d);
    else if (isWord(d.kind)) await showDocx(d);
    else if (d.kind === 'xlsx') await showXlsx(d);
    else if (d.kind === 'zip' || d.kind === 'rar') await showArchive(d);
    else if (d.kind === 'image') showImage(d);
    else if (d.kind === 'text') await showText(d);
    else showOther(d);
  } catch (e) { console.warn(e); els.body.innerHTML = `<div class="doc-card"><strong>${esc(tt('docFail', 'Belge açılamadı'))}</strong><p>${esc(e.message || e)}</p>${otherActions(d)}</div>`; }
}
function kindLabel(k) { return { pdf: 'PDF', docx: 'Word', doc: 'Word 97-2003', xlsx: 'Excel', office: tt('docOffice', 'Ofis belgesi'), zip: 'ZIP', rar: 'RAR', image: tt('docImage', 'Resim'), text: tt('docText', 'Metin'), other: '' }[k] || ''; }
function renderActs(d) {
  const android = !!(A() && A().docShare);
  let h = '';
  if (android && d.id) h += `<button type="button" class="btn icon" data-doc="open" title="${esc(tt('docOpenWith', 'Başka uygulamayla aç'))}" aria-label="${esc(tt('docOpenWith', 'Başka uygulamayla aç'))}">${ICON('i-export')}</button>`;
  if (android && d.id) h += `<button type="button" class="btn icon wa" data-doc="wshare" title="${esc(tt('waShare', "WhatsApp'a gönder"))}" aria-label="${esc(tt('waShare', "WhatsApp'a gönder"))}">${ICON('i-send-chat')}</button>`;
  if (android && d.id) h += `<button type="button" class="btn icon" data-doc="share" title="${esc(tt('share', 'Paylaş'))}" aria-label="${esc(tt('share', 'Paylaş'))}">${ICON('i-more')}</button>`;
  if (android && d.id) h += `<button type="button" class="btn icon" data-doc="keep" title="${esc(tt('docKeep', 'Çevrimdışı sakla'))}" aria-label="${esc(tt('docKeep', 'Çevrimdışı sakla'))}">${ICON('i-save')}</button>`;
  // Köprü / oturum koşulu KALIR (tanıtılacak bir şey yoksa düğme de yok); yalnız yetki koşulu kalkar.
  // Simge-yalnız düğmede aria-label iç metni ezer: kilit cümlesi ada eklenir (syncLockText tazeler).
  if (api && api.driveAvailable && api.driveAvailable()) { const x = lockText('driveUpload'); const lab = tt('driveUpload', "Drive'a yükle") + (x ? ' — ' + x : ''); h += `<button type="button" class="btn icon" data-doc="drive"${lockAttr('driveUpload')} title="${esc(tt('driveUpload', "Drive'a yükle"))}" aria-label="${esc(lab)}">${ICON('i-drive')}${lockBadge('driveUpload', 'bar')}</button>`; }
  els.acts.innerHTML = h;
}
export function close() {
  if (!els || !els.view) return false;
  if (!isOpen()) return false;
  if (editing) { cancelEdit(); return true; }
  if (cur && cur.kind === 'pdf' && A() && A().pdfClose) try { A().pdfClose(); } catch (_) { /* yok */ }
  stack.length = 0; cur = null;
  els.view.hidden = true; document.body.classList.remove('docmode'); els.body.innerHTML = '';
  call(api.onClose);
  return true;
}
export function back() {
  if (!isOpen()) return false;
  if (editing) { cancelEdit(); return true; }
  if (!stack.length) return close();
  const prev = stack.pop();
  show(prev, { replace: true });
  return true;
}
/** Belge görünümünü gizler ama yığını korur (arşivden çizim açılınca); reopenLast ile geri gelir */
export function suspend() { if (!els || !els.view || els.view.hidden) return; els.view.hidden = true; document.body.classList.remove('docmode'); call(api.onClose); }
/** Arşive dön (CAD açıldıktan sonra) */
export function reopenLast() { const d = cur; if (d) show(d, { replace: true }); }
export function lastArchive() { const all = [...stack, cur].filter(Boolean); return all.reverse().find(d => d.kind === 'zip' || d.kind === 'rar') || null; }
function share(view) { if (cur && cur.id && A() && A().docShare) A().docShare(cur.id, !!view); }
/*
 * Açık belgeyi belirli bir uygulamaya gönderir. Belge kipinde ekranda tuval yoktur; "ekrandaki
 * görüntüyü paylaş" burada belgenin KENDİSİNİ göndermek demektir — PDF'i resme çevirip
 * göndermek, karşı tarafa okunamayan bir ekran görüntüsü bırakırdı.
 * Dönüş: true işlendi · false burada işlenemez (çağıran kendi yolunu denesin).
 */
export function shareTo(pkg, ad) {
  if (!cur || !cur.id) return false;
  if (!(A() && A().docShareTo)) { if (A() && A().docShare) { A().docShare(cur.id, false); return true; } return false; }
  const r = A().docShareTo(cur.id, pkg || '');
  if (r === 'yok') { call(api.toast, tt('shareNotInstalled', '%s bu cihazda kurulu değil').replace('%s', ad || ''), { type: 'error' }); return true; }
  return !!r;
}
function keep() { if (cur && cur.id && A() && A().docKeep) { const r = A().docKeep(cur.id); api.toast(r ? tt('docKept', 'Çevrimdışı kopya alındı (Dosya Aç › Çevrimdışı)') : tt('docKeepFail', 'Kopyalanamadı')); } }

// ---- PDF -----------------------------------------------------------------------------
async function showPdf(d) {
  if (A() && A().pdfInfo && d.id) {
    const info = JSON.parse(A().pdfInfo(d.id) || '{}');
    if (info.error) throw new Error(info.error);
    d.pdf = { pages: info.pages, sizes: info.sizes };
    els.tools.innerHTML = `<button type="button" class="btn small" data-doc="pdfprev" aria-label="${esc(tt('prevPage', 'Önceki sayfa'))}">${ICON('i-arrow-up')}</button><span class="doc-page"><input id="pdfPageIn" type="number" min="1" max="${info.pages}" value="1" inputmode="numeric"> / ${info.pages}</span><button type="button" class="btn small" data-doc="pdfnext" aria-label="${esc(tt('nextPage', 'Sonraki sayfa'))}">${ICON('i-arrow-down')}</button><span class="sp"></span><button type="button" class="btn small" data-doc="zout" aria-label="−">${ICON('i-zoom-out')}</button><button type="button" class="btn small" data-doc="zfit">${esc(tt('fitWidth', 'Sığdır'))}</button><button type="button" class="btn small" data-doc="zin" aria-label="+">${ICON('i-zoom-in')}</button>` + editBtn();
    $('pdfPageIn').addEventListener('change', (ev) => pdfGoto(+ev.target.value - 1));
    pdfLayout(d);
    return;
  }
  // tarayıcı: yerleşik görüntüleyici (düzenleme düğmesi yine çalışır; düzenleyici sayfa geometrisini pdf-lib'den alır)
  els.tools.innerHTML = editBtn();
  const url = urlOf(d);
  els.body.innerHTML = `<embed class="doc-embed" src="${esc(url)}" type="application/pdf">`;
}
function pdfLayout(d) {
  const W = els.body.clientWidth - 16, dpr = Math.min(3, window.devicePixelRatio || 1);
  const cssW = Math.max(120, Math.round(W * d.zoom));
  const px = Math.min(4096, Math.round(cssW * dpr));
  d.pdf.cssW = cssW; d.pdf.px = px;
  els.body.innerHTML = `<div class="pdf-pages" style="width:${cssW}px">` + d.pdf.sizes.map((s, i) => `<div class="pdf-page" data-i="${i}" style="width:${cssW}px;height:${Math.round(cssW * s[1] / s[0])}px"><span class="pdf-no">${i + 1}</span></div>`).join('') + '</div>';
  pdfLazy();
}
function pdfLazy() {
  if (!cur || !cur.pdf) return;
  const top = els.body.scrollTop - 800, bot = els.body.scrollTop + els.body.clientHeight + 800;
  for (const pg of els.body.querySelectorAll('.pdf-page')) {
    const y = pg.offsetTop, h = pg.offsetHeight;
    const vis = y + h > top && y < bot;
    let img = pg.querySelector('img');
    if (vis && !img) { img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = `/file/pdfpage_${cur.id}_${pg.dataset.i}_${cur.pdf.px}`; img.onload = () => pg.classList.add('ready'); pg.appendChild(img); }
    else if (!vis && img && Math.abs(y - els.body.scrollTop) > 6000) { img.remove(); pg.classList.remove('ready'); }
  }
}
function pdfCurrent() { const y = els.body.scrollTop + els.body.clientHeight * 0.35; let best = 0; els.body.querySelectorAll('.pdf-page').forEach((pg, i) => { if (pg.offsetTop <= y) best = i; }); return best; }
function pdfUpdatePage() { const inp = $('pdfPageIn'); if (inp && document.activeElement !== inp) inp.value = String(pdfCurrent() + 1); }
function pdfGoto(i) { if (!cur || !cur.pdf) return; i = Math.max(0, Math.min(cur.pdf.pages - 1, i)); const pg = els.body.querySelector(`.pdf-page[data-i="${i}"]`); if (pg) els.body.scrollTop = pg.offsetTop - 8; pdfUpdatePage(); pdfLazy(); }
function pdfZoom(f) {
  if (!cur || !cur.pdf) return;
  const page = pdfCurrent();
  cur.zoom = f === 0 ? 1 : Math.max(0.4, Math.min(5, cur.zoom * f));
  pdfLayout(cur); pdfGoto(page);
}
/** Araç satırındaki yakınlaştırma düğmeleri (zin / zout / zfit): belge türüne göre dağıtır; f = çarpan, 0 = sığdır */
function zoomDoc(f) { if (!cur) return; if (editing && editing.kind === 'grid') { xlsxZoom(f); return; } if (cur.kind === 'pdf') pdfZoom(f); else if (isWord(cur.kind)) docxZoom(f); else if (cur.kind === 'xlsx') xlsxZoom(f); }
/** iki parmakla yakınlaştırma (PDF, resim, Word): sürüklerken CSS ölçek, bırakınca kalıcı ölçek (PDF yeniden çizim, Word sayfa kipinde
 *  transform ölçeği / akış kipinde yazı yüzdesi). Tek parmak hiçbir zaman engellenmez: preventDefault yalnız iki parmak varken. */
function bindPinch(el) {
  const pts = new Map(); let d0 = 0, scale = 1, target = null;
  const can = () => cur && (cur.kind === 'pdf' || cur.kind === 'image' || isWord(cur.kind));
  const base = () => target && target.classList.contains('docx-pages') ? `scale(${cur.pzoom || 1})` : '';   // sayfa yığınının kalıcı ölçeği
  el.addEventListener('pointerdown', (ev) => { if (!can()) return; pts.set(ev.pointerId, [ev.clientX, ev.clientY]); if (pts.size === 2) { const a = [...pts.values()]; d0 = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); target = el.querySelector('.pdf-pages, .doc-img, .docx-pages, .docx-page, .xlsx-tbl'); scale = 1; } });
  el.addEventListener('pointermove', (ev) => { if (!pts.has(ev.pointerId)) return; pts.set(ev.pointerId, [ev.clientX, ev.clientY]); if (pts.size === 2 && target) { const a = [...pts.values()]; const d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); scale = Math.max(0.3, Math.min(4, d / (d0 || d))); target.style.transformOrigin = '0 0'; target.style.transform = `${base()} scale(${scale})`; ev.preventDefault(); } }, { passive: false });
  el.addEventListener('touchmove', (ev) => { if (ev.touches.length >= 2 && target) ev.preventDefault(); }, { passive: false });   // iki parmakta tarayıcı kaydırmaya geçip pointercancel üretmesin; tek parmak serbest
  const up = (ev) => { pts.delete(ev.pointerId); if (pts.size < 2 && target) { target.style.transform = base(); if (Math.abs(scale - 1) > 0.05) { if (cur.kind === 'pdf') pdfZoom(scale); else if (isWord(cur.kind)) docxZoom(scale); else if (cur.kind === 'xlsx') xlsxZoom(scale); else { cur.zoom = Math.max(0.2, Math.min(8, cur.zoom * scale)); const im = el.querySelector('.doc-img'); if (im) im.style.width = Math.round(cur.zoom * 100) + '%'; } } target = null; scale = 1; } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

// ---- DOCX / XLSX ------------------------------------------------------------------------
async function arcFor(d) {
  if (d.arc) return d.arc;
  if (d.id && A() && A().arcList) d.arc = await openArchive({ androidId: d.id });
  else d.arc = await openArchive({ bytes: await bytesOf(d) });
  return d.arc;
}
/*
 * Word görünümü iki kiplidir (store 'doc:docxLayout', varsayılan sayfa):
 *  - Sayfa (yazdırma önizleme): gri zemin üzerinde belgedeki boyut ve kenar boşluklarıyla beyaz sayfalar (.docx-sheet), altta "i / n".
 *    Sayfalama: üst düzey bloklar (parts) sırayla geçerli sayfaya eklenir ve ölçülür; blok sayfa iç yüksekliğini aşınca yeni sayfaya
 *    taşınır; tek başına sığmayan blok (büyük tablo) kendi sayfasında taşar (sayfa uzar, kırpma yok); .pagebreak → zorunlu yeni sayfa.
 *    İş requestAnimationFrame dilimlerine bölünür (~12 ms / dilim) — 3000 blok ana iş parçacığını kilitlemez; "Daha fazla" kaldığı
 *    yerden sürdürür. Yakınlaştırma: yığına transform: scale (sol üst köken) + sarmalayıcının (.docx-stack) genişlik/yüksekliği,
 *    kaydırma alanı doğru kalsın; ilk açılış genişliğe sığdırılmış ölçek.
 *  - Akış: eski tek sütun (.docx-page), yakınlaştırma yazı yüzdesi.
 */
const PT = 96 / 72;   // pt → CSS px
async function showDocx(d) {
  let r;
  if (d.kind === 'doc') {
    // içerik baytlardan tanınır: OLE (Word 97-2003) → doc.js; ZIP → DOCX; RTF / Word HTML / MHTML / düz metin → docalt.js
    const buf = await bytesOf(d), fmt = sniffDoc(buf);
    if (fmt === 'zip') { d.arc = d.arc || await openArchive({ bytes: buf }); r = await docxToHtml(d.arc); }
    else if (fmt === 'ole') r = docToHtml(buf, { tt });
    else if (fmt === 'rtf') r = rtfToHtml(buf, { tt });
    else if (fmt === 'html') r = htmlToParts(decodeHtmlBytes(new Uint8Array(buf)), { tt });
    else if (fmt === 'mhtml') { const m = mhtmlParts(buf); if (!m.html) throw new Error(tt('docNotWord', 'Word belgesi değil') + ' (MHTML)'); r = htmlToParts(m.html, { tt, resolve: m.resolve }); }
    else if (fmt === 'text') { const txt = decodeHtmlBytes(new Uint8Array(buf)); const parts = txt.split(/\r?\n/).map(l => `<p>${esc(l) || '&nbsp;'}</p>`); r = { parts, html: parts.join(''), width: '595pt', page: { width: 595, height: 842, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, warnings: [] }; }
    else throw new Error(tt('docNotWord', 'Word belgesi değil') + ' — ' + sniffHint(buf));
    d.fmt = fmt; els.meta.textContent = [fmtSize(d.size), { ole: 'Word 97-2003', zip: 'Word', rtf: 'RTF', html: 'Word HTML', mhtml: 'Word MHTML', text: tt('docText', 'Metin') }[fmt] || ''].filter(Boolean).join(' · ');
  } else r = await docxToHtml(await arcFor(d));
  d.warn = (r.warnings || []).join(' · ');
  d.docxPage = r.page;   // düzenleme çıktısındaki sayfa boyutu için
  d.layout = d.layout || (store.get('doc:docxLayout') === 'flow' ? 'flow' : 'page'); d.zoom = d.zoom || 1; d.pzoom = d.pzoom || 0;   // pzoom 0 = genişliğe sığdır
  const parts = r.parts || [r.html];
  const foot = (upto) => upto < parts.length ? `<span class="muted">${parts.length} ${esc(tt('blocksOfFirst', 'bloğun ilk'))} ${upto}</span><button type="button" class="btn small" data-more="${Math.min(parts.length, upto * 2)}">${esc(tt('loadMore', 'Daha fazla'))}</button>` : '';
  const render = (upto) => {
    els.body.classList.toggle('paged', d.layout === 'page'); docxTools(d);
    if (d.layout === 'page') { docxPaginate(d, r, parts, upto, foot); return; }
    const top = els.body.scrollTop; d.pg = null;
    els.body.innerHTML = `<div class="docx-page docx-text" style="${r.width ? 'max-width:' + r.width : ''}">${parts.slice(0, upto).join('') || `<p class="muted">${esc(tt('docEmpty', 'Belge boş'))}</p>`}</div><div class="docx-more">${foot(upto)}</div>`;
    docxApplyZoom(d); els.body.scrollTop = top;
  };
  d.docxRender = render;
  els.body.onclick = (ev) => {
    const a = ev.target.closest('a[href^="http"]'); if (a && A() && A().openUrl) { ev.preventDefault(); A().openUrl(a.href); return; }
    const b = ev.target.closest('[data-more]'); if (b) render(+b.dataset.more);
  };
  render(DOCX_PAGE);
}
function docxTools(d) {
  const page = d.layout === 'page';
  els.tools.innerHTML = `<button type="button" class="btn small" data-doc="layout" data-layout="${d.layout}" title="${esc(page ? tt('docLayoutFlow', 'Akış görünümü') : tt('docLayoutPage', 'Sayfa görünümü'))}">${ICON(page ? 'i-text' : 'i-layout')} ${esc(page ? tt('docFlow', 'Akış') : tt('docPage', 'Sayfa'))}</button><span class="sp"></span><button type="button" class="btn small" data-doc="zout" aria-label="−">${ICON('i-zoom-out')}</button><button type="button" class="btn small" data-doc="zfit">${esc(tt('fitWidth', 'Sığdır'))}</button><button type="button" class="btn small" data-doc="zin" aria-label="+">${ICON('i-zoom-in')}</button>` + (api && api.driveAvailable && api.driveAvailable() ? `<button type="button" class="btn small" data-doc="convert">${esc(tt('drivePdf', "Drive ile PDF'e çevir"))}</button>` : '') + editBtn() + (d.warn ? `<span class="muted doc-warn" title="${esc(d.warn)}">${esc(d.warn)}</span>` : '');
}
/** Kip değişimi (araç satırı düğmesi): hatırlanır, belge yeniden basılır */
function docxSetLayout(mode) { const d = cur; if (!d || !isWord(d.kind) || !d.docxRender) return; d.layout = mode; store.set('doc:docxLayout', mode); d.pg = null; els.body.scrollTop = 0; d.docxRender(DOCX_PAGE); }
/** parts[0..upto) sayfalara dilimlenir; d.pg durumu bağlıysa kaldığı yerden sürer (Daha fazla) */
function docxPaginate(d, r, parts, upto, foot) {
  let pg = d.pg;
  if (!pg || !pg.pages.isConnected) {
    const p = r.page || { width: 595, height: 842, margins: { top: 72, right: 72, bottom: 72, left: 72 } }, M = p.margins;
    els.body.innerHTML = '<div class="docx-stack"><div class="docx-pages" data-done="0"></div></div><div class="docx-more"></div>';
    pg = d.pg = { pages: els.body.querySelector('.docx-pages'), stack: els.body.querySelector('.docx-stack'), foot: els.body.querySelector('.docx-more'), W: p.width * PT, H: p.height * PT, innerH: Math.max(40, (p.height - M.top - M.bottom) * PT), pad: [M.top, M.right, M.bottom, M.left].map(v => (v * PT) + 'px').join(' '), n: 0, idx: 0, sheet: null, fresh: false, job: 0 };
    pg.pages.style.width = pg.W + 'px';
    if (!d.pzoom) d.pzoom = docxFitScale(d);
    docxApplyZoom(d);
  }
  pg.foot.innerHTML = foot(upto); pg.pages.dataset.done = '0';
  const job = ++pg.job, tpl = document.createElement('template');
  const newSheet = () => { const s = document.createElement('div'); s.className = 'docx-sheet docx-text'; s.style.cssText = `width:${pg.W}px;min-height:${pg.H}px;padding:${pg.pad}`; s.innerHTML = `<div class="docx-sheet-in" style="min-height:${pg.innerH}px"></div><span class="docx-no"></span>`; pg.pages.appendChild(s); pg.n++; pg.sheet = s.firstChild; pg.fresh = true; return pg.sheet; };
  const step = () => {
    if (cur !== d || job !== pg.job || !pg.pages.isConnected) return;
    const t0 = performance.now();
    while (pg.idx < upto && pg.idx < parts.length && performance.now() - t0 < 12) {
      tpl.innerHTML = parts[pg.idx++];
      for (let node of [...tpl.content.childNodes]) {
        if (node.nodeType === 3) { if (!node.textContent.trim()) continue; const w = document.createElement('p'); w.appendChild(node); node = w; }   // çıplak metin (sayfa sonu br'nin ardı) paragrafa sarılır
        else if (node.nodeType !== 1) continue;
        if (node.classList.contains('pagebreak')) { if (pg.sheet && !pg.fresh) pg.sheet = null; continue; }   // sonraki blok yeni sayfaya (boş sayfa üretmez)
        if (!pg.sheet) newSheet();
        pg.sheet.appendChild(node);
        if (!pg.fresh && node.offsetTop + node.offsetHeight > pg.innerH + 0.5) newSheet().appendChild(node);   // sığmadı → yeni sayfa; tek başına sığmayan blok kendi sayfasında taşar
        pg.fresh = false;
      }
    }
    pg.pages.querySelectorAll('.docx-no').forEach((e, i) => { e.textContent = (i + 1) + ' / ' + pg.n; });
    docxApplyZoom(d);
    if (pg.idx < upto && pg.idx < parts.length) requestAnimationFrame(step); else pg.pages.dataset.done = '1';
  };
  if (!pg.n && !parts.length) { newSheet().innerHTML = `<p class="muted">${esc(tt('docEmpty', 'Belge boş'))}</p>`; pg.pages.querySelector('.docx-no').textContent = '1 / 1'; docxApplyZoom(d); pg.pages.dataset.done = '1'; return; }
  step();
}
function docxFitScale(d) { const pg = d.pg; return Math.max(0.1, Math.min(6, (els.body.clientWidth - 16) / (pg ? pg.W : 1))); }
function docxApplyZoom(d) {
  if (d.layout === 'page') { const pg = d.pg; if (!pg) return; const z = d.pzoom || 1; pg.pages.style.transform = `scale(${z})`; pg.stack.style.width = Math.round(pg.W * z) + 'px'; pg.stack.style.height = Math.round(pg.pages.offsetHeight * z) + 'px'; }
  else { const el = els.body.querySelector('.docx-page'); if (el) el.style.fontSize = Math.round(100 * d.zoom) + '%'; }
}
/** f: çarpan; 0 = sığdır (sayfa kipi: genişliğe, akış: %100). Sayfa kipinde kaydırma konumu ölçekle birlikte taşınır. */
function docxZoom(f) {
  const d = cur; if (!d || !isWord(d.kind)) return;
  if (d.layout === 'page') { if (!d.pg) return; const z0 = d.pzoom || 1; d.pzoom = f === 0 ? docxFitScale(d) : Math.max(0.2, Math.min(6, z0 * f)); docxApplyZoom(d); const k = d.pzoom / z0; els.body.scrollTop = els.body.scrollTop * k; els.body.scrollLeft = els.body.scrollLeft * k; }
  else { d.zoom = f === 0 ? 1 : Math.max(0.5, Math.min(3, d.zoom * f)); docxApplyZoom(d); }
}
/**
 * Excel yakınlaştırması yazı boyuyla yapılır (ölçek dönüşümüyle değil): tablo yeniden dizilir, yazı keskin kalır
 * ve başlık satırı ile satır numarası sütunundaki position:sticky çalışmaya devam eder — dönüşüm uygulanan bir
 * atada sticky bozulur. Dolgu ve en büyük hücre genişliği CSS'te em cinsindendir, boyla birlikte ölçeklenir.
 */
const XLSX_FS = 12;   // .xlsx-tbl temel yazı boyu (app.css ile aynı olmalı)
const xlsxEls = () => ({ w: els.body.querySelector('.xlsx-wrap'), t: els.body.querySelector('.xlsx-tbl') });
function xlsxApplyZoom(d) { const { t } = xlsxEls(); if (t) t.style.fontSize = (XLSX_FS * (d.zoom || 1)).toFixed(2) + 'px'; }
/**
 * Orta düğme %100'e döner, "genişliğe sığdır" değildir: hücre genişliği yazı boyuyla doğru orantılı olduğundan
 * yirmi sütunluk bir sayfayı telefon genişliğine sığdırmak yazıyı okunmaz kılar (ölçüldü: 26 sütun için ~0,10×).
 * Daha çok sütun görmek isteyen − ile küçültür ya da iki parmakla ayarlar; düğme her zaman bilinen yere döndürür.
 */
function xlsxZoom(f) {
  const d = cur; if (!d) return;
  const { w } = xlsxEls(), z0 = d.zoom || 1;
  d.zoom = f === 0 ? 1 : Math.max(0.4, Math.min(3, z0 * f));
  xlsxApplyZoom(d);
  if (w) { const k = d.zoom / z0; w.scrollLeft = w.scrollLeft * k; w.scrollTop = w.scrollTop * k; }   // bakılan yer ekranda kalsın
}
async function showXlsx(d) {
  const sheets = await xlsxSayfalar(d);
  d.sheets = sheets; d.sheetIdx = Math.min(d.sheetIdx || 0, Math.max(0, sheets.length - 1));   // düzenleyici etkin sayfayı buradan alır
  els.tools.innerHTML = `<div class="tabs doc-tabs">${sheets.map((s, i) => `<button type="button" data-sheet="${i}" class="${i ? '' : 'active'}">${esc(s.name)}</button>`).join('')}</div><span class="sp"></span><button type="button" class="btn small" data-doc="zout" aria-label="−">${ICON('i-zoom-out')}</button><button type="button" class="btn small" data-doc="zfit">${esc(tt('zoom100', '%100'))}</button><button type="button" class="btn small" data-doc="zin" aria-label="+">${ICON('i-zoom-in')}</button>` + editBtn();
  // sayfalı basım: ilk XLSX_PAGE satır, "Daha fazla" ile katlanarak; 60k satırlık tablo ana iş parçacığını kilitlemesin
  const render = (i, upto = XLSX_PAGE) => {
    const s = sheets[i]; if (!s) { els.body.innerHTML = ''; return; }
    let html = s.tableHtml ? s.tableHtml(upto) : s.html;
    if (s.tableHtml && upto < s.rows) html += `<div class="muted">${s.rows} ${esc(tt('rowsOfFirst', 'satırın ilk'))} ${Math.min(upto, s.rows)}</div><button type="button" class="btn small" data-more="${i}" data-upto="${Math.min(s.rows, upto * 2)}">${esc(tt('loadMore', 'Daha fazla'))}</button>`;
    els.body.innerHTML = `<div class="xlsx-wrap">${html}</div>`;
    xlsxApplyZoom(d);
  };
  els.tools.querySelector('.doc-tabs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-sheet]'); if (!b) return; els.tools.querySelectorAll('[data-sheet]').forEach(x => x.classList.toggle('active', x === b)); d.sheetIdx = +b.dataset.sheet; render(d.sheetIdx); });
  // kaydırma artık .xlsx-wrap'ta: "Daha fazla" sonrası bakılan yer korunur
  els.body.onclick = (ev) => { const b = ev.target.closest('[data-more]'); if (b) { const { w } = xlsxEls(); const top = w ? w.scrollTop : 0, left = w ? w.scrollLeft : 0; render(+b.dataset.more, +b.dataset.upto); const n = xlsxEls().w; if (n) { n.scrollTop = top; n.scrollLeft = left; } } };
  render(d.sheetIdx);
  const tab = els.tools.querySelector(`[data-sheet="${d.sheetIdx}"]`); if (tab) els.tools.querySelectorAll('[data-sheet]').forEach(x => x.classList.toggle('active', x === tab));
}
// ---- arşiv -----------------------------------------------------------------------------
async function showArchive(d) {
  const arc = await arcFor(d);
  d.path = d.path || '';
  els.tools.innerHTML = `<input type="search" id="arcFilter" class="doc-search" placeholder="${esc(t('search'))}…"><span class="muted" id="arcCount"></span><span class="sp"></span>`
    + `<button type="button" class="btn small" id="arcAll">${ICON('i-download')} <span class="lbl">${esc(tt('arcExtractAll', 'Tümünü çıkar'))}</span></button>`;
  $('arcFilter').addEventListener('input', () => renderArchive(d));
  renderArchive(d);   // #arcAll'ın etiketi ve tıklaması burada kurulur (bulunulan klasöre bakar)
  els.body.onclick = async (ev) => {
    // Satırdaki çıkarma düğmesi girdiyi AÇMAZ: önce o denetlenir
    const out = ev.target.closest('[data-arc-out]');
    if (out) {
      const row = out.closest('[data-entry]'); if (!row) return;
      const yol = row.dataset.entry;
      await arsivCikar(d, row.dataset.dir === '1' ? Arsiv.klasorAltindakiler(arc.entries, yol) : [yol]);
      return;
    }
    const crumb = ev.target.closest('[data-crumb]'); if (crumb) { d.path = crumb.dataset.crumb; renderArchive(d); return; }
    const it = ev.target.closest('[data-entry]'); if (!it) return;
    const name = it.dataset.entry;
    if (it.dataset.dir === '1') { d.path = name; renderArchive(d); return; }
    await openEntry(d, name);
  };
}
/*
 * Çıkarma. Hedef klasör arşivin kendi adıdır (İndirilenler/DWGViewer/<arşiv>/…) ve arşivin iç klasör
 * yapısı olduğu gibi korunur — bir alt klasör çıkarılsa bile yol arşivin kökünden yazılır, böylece
 * aynı arşiv iki kez çıkarıldığında dosyalar aynı yere düşer.
 * İlerleme araç çubuğundaki sayaçta gösterilir: telefonun ekranını kaplayan ayrı bir kutu gerekmez.
 */
let arcBusy = false;
async function arsivCikar(d, girdiler) {
  if (arcBusy || !d || !d.arc) return;
  const hedef = (girdiler || []).filter(Boolean);
  if (!hedef.length) { call(api.toast, tt('arcNoEntry', 'Çıkarılacak dosya yok'), { type: 'warn' }); return; }
  const klasor = Arsiv.klasorAdi(d.name);
  if (hedef.length > 1 && !await askConfirm(tt('arcConfirm', '%n dosya çıkarılacak.').replace('%n', String(hedef.length)) + ' → ' + klasor)) return;
  const say = $('arcCount'), btn = $('arcAll');
  const yaz = (m) => { if (say) say.textContent = m; };
  arcBusy = true; if (btn) btn.disabled = true;
  try {
    const r = await Arsiv.cikar(d.arc, hedef, {
      klasor,
      ilerle: (done, total) => yaz(tt('arcExtracting', 'Çıkarılıyor') + '… ' + done + '/' + total),
    });
    const iyi = r.n > 0;
    const ileti = iyi
      ? tt('arcExtracted', '%n dosya çıkarıldı').replace('%n', String(r.n)) + (r.nere ? ' · ' + r.nere : '')
      : tt('arcExtractFail', 'Çıkarılamadı') + (r.hata.length ? ': ' + r.hata[0].mesaj : '');
    call(api.toast, ileti + (r.hata.length && iyi ? ' · ' + r.hata.length + ' ' + tt('arcFailed', 'başarısız') : ''), { type: iyi ? 'ok' : 'error', ms: 6000 });
  } catch (e) {
    call(api.toast, tt('arcExtractFail', 'Çıkarılamadı') + ': ' + (e.message || e), { type: 'error' });
  } finally {
    arcBusy = false; if (btn) btn.disabled = false;
    renderArchive(d);
  }
}
function renderArchive(d) {
  const arc = d.arc, q = ($('arcFilter') && $('arcFilter').value.trim().toLowerCase()) || '';
  const dirs = new Map(), files = [];
  for (const e of arc.entries) {
    const n = e.name.replace(/\\/g, '/');
    if (q) { if (!e.dir && n.toLowerCase().includes(q)) files.push({ ...e, name: n, label: n }); continue; }
    if (!n.startsWith(d.path)) continue;
    const rest = n.slice(d.path.length); if (!rest) continue;
    const i = rest.indexOf('/');
    if (i >= 0) { const dn = rest.slice(0, i); const cur2 = dirs.get(dn) || { n: 0, size: 0 }; if (!e.dir) { cur2.n++; cur2.size += e.size || 0; } dirs.set(dn, cur2); }
    else if (!e.dir) files.push({ ...e, name: n, label: rest });
  }
  files.sort((a, b) => a.label.localeCompare(b.label, 'tr'));
  const crumbs = d.path.split('/').filter(Boolean);
  let html = `<div class="doc-crumbs"><button type="button" class="chip" data-crumb="">${ICON('i-layers')} ${esc(d.name)}</button>` + crumbs.map((c, i) => `<span>›</span><button type="button" class="chip" data-crumb="${esc(crumbs.slice(0, i + 1).join('/') + '/')}">${esc(c)}</button>`).join('') + '</div><div class="list arc-list">';
  const cikarBtn = `<button type="button" class="lbtn" data-arc-out="1" title="${esc(tt('arcExtract', 'Çıkar'))}" aria-label="${esc(tt('arcExtract', 'Çıkar'))}">${ICON('i-download')}</button>`;
  for (const [dn, info] of [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'tr'))) html += `<div class="item arc-item" data-entry="${esc(d.path + dn + '/')}" data-dir="1">${ICON('i-open')}<span class="nm">${esc(dn)}</span><small>${info.n} ${esc(t('files'))} · ${fmtSize(info.size)}</small>${cikarBtn}</div>`;
  for (const f of files) html += `<div class="item arc-item" data-entry="${esc(f.name)}">${iconFor(f.name)}<span class="nm">${esc(f.label)}</span><small>${fmtSize(f.size)}${f.time ? ' · ' + new Date(f.time).toLocaleDateString(numLocale()) : ''}</small>${cikarBtn}</div>`;
  if (!dirs.size && !files.length) html += `<div class="muted">${esc(t('noResult'))}</div>`;
  els.body.innerHTML = html + '</div>';
  const total = arc.entries.filter(e => !e.dir).length;
  const c = $('arcCount'); if (c) c.textContent = total + ' ' + t('files');   // tt() İngilizcedeki 'files' değerini anahtar sanıp Türkçeye düşüyordu
  // Araç çubuğundaki düğme bulunulan yere bakar: kökte bütün arşiv, klasörde o klasör
  const b = $('arcAll');
  if (b) {
    const lbl = b.querySelector('.lbl');
    if (lbl) lbl.textContent = d.path ? tt('arcExtractDir', 'Bu klasörü çıkar') : tt('arcExtractAll', 'Tümünü çıkar');
    b.onclick = () => arsivCikar(d, Arsiv.klasorAltindakiler(arc.entries, d.path));
  }
}
async function openEntry(d, name) {
  const arc = d.arc, base = name.split('/').pop(), kind = kindOf(base);
  api.toast(tt('extracting', 'Çıkarılıyor') + ': ' + base, 1500);
  try {
    if (arc.native) {
      const info = await arc.extract(name);
      if (kind === 'cad') suspend();
      await openRegistered({ id: info.id, name: base, size: info.size }, {});
      if (kind === 'cad') { call(api.onCadFromArchive, d); }
      return;
    }
    const buf = await arc.read(name);
    if (kind === 'cad') { suspend(); await api.loadBytes(buf, base, buf.byteLength); call(api.onCadFromArchive, d); return; }
    await show({ kind, name: base, size: buf.byteLength, bytes: buf });
  } catch (e) { api.toast(tt('docFail', 'Belge açılamadı') + ': ' + (e.message || e), { type: 'error' }); }
}

// ---- resim / metin / diğer -------------------------------------------------------------
function showImage(d) {
  els.tools.innerHTML = '';
  els.body.innerHTML = `<img class="doc-img" src="${esc(urlOf(d))}" alt="" style="width:100%">`;
}
/** Tırnaklı CSV satırını alanlara böler: "a;b" tek alandır, "" kaçışlanmış tırnaktır */
function splitCsv(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
async function showText(d) {
  const buf = await bytesOf(d);
  let txt; try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { txt = new TextDecoder('windows-1254').decode(buf); }
  const ext = d.name.toLowerCase().split('.').pop();
  d.text = txt; d.csv = null;   // düzenleyici ham metni buradan alır
  els.tools.innerHTML = `<button type="button" class="btn small" data-doc="wrap">${esc(tt('wrap', 'Satır kaydır'))}</button><span class="muted">${txt.split('\n').length} ${esc(tt('lines', 'satır'))}</span>` + editBtn();
  if (ext === 'csv' || (ext === 'txt' && /^[^\n]*[;\t][^\n]*\n/.test(txt))) {
    const sep = (txt.match(/;/g) || []).length >= (txt.match(/,/g) || []).length ? ';' : (txt.includes('\t') ? '\t' : ',');
    const lines = txt.split(/\r?\n/); while (lines.length && !lines[lines.length - 1].length) lines.pop();   // yalnız sondaki boş satırlar atılır; aradaki boş satır tablonun parçasıdır
    const rows = lines.slice(0, 5000).map(l => splitCsv(l, sep));
    d.csv = { rows, sep, cut: lines.length > 5000 };   // cut: tablo kısaltıldı — ızgarada düzenlenirse kalan satırlar kaybolur
    els.body.classList.add('grid-edit');   // Excel'deki iç kaydırma ve donuk başlık düzeni CSV ızgarasında da geçerli
    els.body.innerHTML = `<div class="xlsx-wrap"><table class="xlsx-tbl">${rows.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${esc(c)}</th>` : `<td${/^[-\d.,]+$/.test(c.trim()) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
    return;
  }
  if (ext === 'json' || ext === 'geojson') { try { txt = JSON.stringify(JSON.parse(txt), null, 2); d.text = txt; } catch (_) { /* ham */ } }   // düzenleyici ekranda görüneni açar
  els.body.innerHTML = `<pre class="doc-pre">${esc(txt.length > 2_000_000 ? txt.slice(0, 2_000_000) + '\n…' : txt)}</pre>`;
}
function otherActions(d) {
  let h = '<div class="row">';
  if (api && api.driveAvailable && api.driveAvailable() && (d.kind === 'office' || d.kind === 'docx' || d.kind === 'doc' || d.kind === 'xlsx')) h += `<button type="button" class="btn primary small" data-doc="convert">${esc(tt('drivePdf', "Drive ile PDF'e çevir"))}</button>`;
  if (A() && A().docShare && d.id) h += `<button type="button" class="btn small" data-doc="open">${esc(tt('docOpenWith', 'Başka uygulamayla aç'))}</button><button type="button" class="btn small" data-doc="share">${esc(tt('share', 'Paylaş'))}</button>`;
  return h + '</div>';
}
// ---- düzenleme (Pro) ------------------------------------------------------------------
/*
 * Düzenleme tek kapıdan geçer: kind 'pdf' ise pdfedit.js açıklama katmanı, Word türlerinde docedit.js
 * contenteditable akış düzenleyicisi, Excel ve CSV'de hücre ızgarası, düz metinde metin kutusu. Hepsinde
 * özgün dosya değişmez; "Kaydet" yeni bir dosya üretip paylaşır. Düğme her basamakta görünür, ücretsizde
 * kilit rozeti taşır (bkz. editBtn); tıklama yolu gate('docEdit') ile kapılıdır.
 *
 * IZGARA DÜZENLEYİCİ (v8.8'den beri): hücre değerlerinin yanında FORMÜLLERİ (xlfn motoru canlı
 * hesaplar, dosyaya <f> yazılır), yazılan SAYILARIN sayı tipini ve düzenleyicide verilen hücre
 * biçimini (kalın/italik/renk/dolgu → styles.xml) da taşır. Satır/sütun ekleme-silme formül
 * başvurularını Excel kuralıyla kaydırır (xlbook.yapisalKaydir); başka sayfadan bu sayfaya bakan
 * formüller kaydırılMAZ (bilinen sınır). Birleşik hücreler ve sütun genişlikleri hâlâ aktarılmaz
 * (kullanıcıya kaydetmeden önce söylenir). Etkin olmayan sayfalar kaynaktaki formül ve ham
 * değerleriyle yazılır, GRID_MAX'tan sonraki satırlar da düzenlenmeden korunur.
 */
/* Bir seferde basılan en çok satır. Ölçüm (masaüstü Chromium, 26 sütun): 1.000 satır = 26.000 hücre için
   122 ms basım + 35 ms geri okuma; 2.000 satır 234 + 68 ms, 5.000 satır 441 + 213 ms. Telefon üç-beş kat
   yavaştır, bu yüzden görüntüleyicinin sayfa boyuyla (XLSX_PAGE) aynı 1.000'de tutulur; gerisi "Daha fazla". */
const GRID_MAX = 1000;
let editing = null;
const editable = (k) => k === 'pdf' || isWord(k) || k === 'xlsx' || k === 'text';
function editBtn() {
  // editable() koşulu KALIR: zip / resim gibi düzenlenemeyen türde rozetli düğme yanıltır.
  // has('docEdit') koşulu KALKAR: ücretsiz kullanıcı bugün bu yeteneğin VARLIĞINI hiç öğrenemiyordu.
  // Tıklama yolu zaten emniyetli: startEdit → PdfEdit.canEdit() → gate('docEdit').
  if (!cur || !editable(cur.kind)) return '';
  return `<span class="sp"></span><button type="button" class="btn small" data-doc="edit"${lockAttr('docEdit')}>${ICON('i-pen')} ${esc(tt('docEdit', 'Düzenle'))}${lockBadge('docEdit', 'pill')}</button>`;
}
const b64of = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + 0x8000))); return btoa(s); };
/** Üretilen dosyayı paylaşır ya da indirir */
function saveOut(u8, name, mime) {
  if (A() && A().saveFile) {
    const r = A().saveFile(b64of(u8), name, mime, true);
    api.toast(r ? tt('editSaved', 'Kaydedildi') + ': ' + r : tt('editSaveFail', 'Kaydedilemedi'), { type: r ? 'ok' : 'error', ms: 6000 });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([u8], { type: mime })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  api.toast(tt('editSaved', 'Kaydedildi'), { type: 'ok' });
}
const outName = (d, ext) => d.name.replace(/\.[^.]+$/, '') + '_' + tt('editSuffix', 'duzenlendi') + '.' + ext;

async function startEdit(d) {
  if (!d || !editable(d.kind)) return;
  if (!PdfEdit.canEdit()) return;   // Ücretsizde yükseltme kutusu açılır
  els.body.classList.remove('paged');
  try {
    if (d.kind === 'pdf') {
      const buf = await bytesOf(d);
      const st = await PdfEdit.openEdit(buf);
      const bg = (A() && A().pdfInfo && d.id) ? ((i, px) => `/file/pdfpage_${d.id}_${i}_${px}`) : (() => '');
      els.body.innerHTML = '';
      const surf = PdfEdit.mountSurface(els.body, st, { bg, onText: (def) => askText(tt('editTextLabel', 'Metin'), def || ''), onChange: () => { editing.touched = true; } });
      editing = { kind: 'pdf', d, st, surf, buf, touched: false };
      els.tools.innerHTML = PdfEdit.toolbarHtml(st);
    } else if (d.kind === 'xlsx') {
      const sh = (d.sheets || [])[d.sheetIdx || 0];
      if (!sh || !sh.cells) throw new Error(tt('editNoBody', 'Düzenlenecek içerik bulunamadı'));
      startGridEdit(d, sh, Math.max(sh.maxC || 0, 1), 'xlsx');
    } else if (d.kind === 'text' && d.csv && !d.csv.cut) {
      startGridEdit(d, d.csv.rows, d.csv.rows.reduce((m, r) => Math.max(m, r.length), 1), 'csv');
    } else if (d.kind === 'text') {
      startTextEdit(d);
    } else {
      if (d.layout !== 'flow') { d.layout = 'flow'; store.set('doc:docxLayout', 'flow'); d.pg = null; els.body.scrollTop = 0; d.docxRender(DOCX_PAGE); }
      const root = els.body.querySelector('.docx-page');
      if (!root) throw new Error(tt('editNoBody', 'Düzenlenecek içerik bulunamadı'));
      const ed = DocEdit.mountEditor(root, { onDirty: () => { if (editing) editing.touched = true; } });
      editing = { kind: 'word', d, root, ed, touched: false };
      els.tools.innerHTML = wordToolbarHtml();
    }
    document.body.classList.add('editmode');
  } catch (e) {
    console.warn(e);
    api.toast(tt('editFail', 'Düzenleme başlatılamadı') + ': ' + (e.message || e), { type: 'error', ms: 6000 });
    editing = null;
  }
}
/* ---- ızgara (Excel sayfası / CSV) ---------------------------------------------------
 * Kaynaktaki değerler kopyalanır, ilk GRID_MAX satır contenteditable hücre olarak basılır. Satır ve sütun
 * eklemek ızgarayı büyütür; kaydetme sırasında DOM'daki değerler kopyaya işlenir, kalan satırlar kaynaktan gelir.
 */
/** Hücre biçimi → satır içi stil (ızgarada canlı önizleme; dosyaya styles.xml olarak yazılır) */
const stilCss = (st) => !st ? '' : `${st.b ? 'font-weight:700;' : ''}${st.i ? 'font-style:italic;' : ''}${st.renk ? 'color:' + st.renk + ';' : ''}${st.dolgu ? 'background:' + st.dolgu + ';' : ''}`;
function gridTableHtml(rows, maxC, upto) {
  const e = editing, stiller = e && e.stiller;
  const n = Math.min(upto, rows.length);
  let h = '<table class="xlsx-tbl grid-ed"><tr><th></th>' + Array.from({ length: maxC }, (_, i) => `<th>${colName(i)}</th>`).join('') + '</tr>';
  for (let ri = 0; ri < n; ri++) {
    const cells = rows[ri] || [];
    h += `<tr><th>${ri + 1}</th>`;
    for (let ci = 0; ci < maxC; ci++) {
      const v = cells[ci] == null ? '' : String(cells[ci]);
      const css = stiller ? stilCss(stiller[ri + ',' + ci]) : '';
      h += `<td contenteditable="true" data-r="${ri}" data-c="${ci}"${css ? ` style="${css}"` : ''}>${esc(v)}</td>`;
    }
    h += '</tr>';
  }
  return h + '</table>';
}
// ---- ızgara formül motoru (v8.8) ------------------------------------------------------
const hucreTd = (r, c) => els.body.querySelector(`.grid-ed td[data-r="${r}"][data-c="${c}"]`);
const fAl = (e, r, c) => (e.formuller && e.formuller[r] ? e.formuller[r][c] : null);
function fKoy(e, r, c, f) { if (!e.formuller) e.formuller = []; if (!e.formuller[r]) e.formuller[r] = []; e.formuller[r][c] = f ? formulNormalle(f) : undefined; }
/*
 * Türkçe Excel'de argüman ayracı ';'dir; xlfn ve dosya biçimi ',' bekler. Tırnak dışındaki her
 * ';' çevrilir — yoksa =SUM(A1;A2) motorda İKİNCİ ARGÜMANI SESSİZCE DÜŞÜRÜRDÜ (inceleme bulgusu).
 */
function formulNormalle(f) {
  const s = String(f); if (!s.includes(';')) return s;
  let out = '', tirnak = false;
  for (const ch of s) { if (ch === '"') tirnak = !tirnak; out += (ch === ';' && !tirnak) ? ',' : ch; }
  return out;
}
/** Hücrenin kaynak dosyadan gelen sayı biçimi kodu ("dd.mm.yyyy" gibi) */
const bicimKodu = (e, r, c) => (e.bicimler && e.bicimler[r] ? e.bicimler[r][c] : null);
/** Hesap sonucunun ekrandaki hâli: sayı arayüz dilinin ondalığıyla, hata kendi koduyla */
function gosterim(v, kod) {
  const ay = sepOf();
  if (v == null) return '';
  if (typeof v === 'object' && v.e) return String(v.e);
  // biçim kodu olan hücre görüntüleyiciyle aynı yoldan biçimlenir (tarih seri sayısı olarak görünmesin)
  if (kod != null && (typeof v === 'number' || typeof v === 'boolean')) {
    try { return bicimle(v, kod, ay).metin; } catch (_) { /* çözülemedi: düz yazım */ }
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(10)).replace('.', ay.ondalik);
  if (typeof v === 'boolean') return numLocale() === 'tr-TR' ? (v ? 'DOĞRU' : 'YANLIŞ') : (v ? 'TRUE' : 'FALSE');
  return String(v);
}
/*
 * Bir hücrenin YENİ içeriğini modele işler. "=" ile başlayan metin formüldür (CSV kuralıyla aynı:
 * xlbook.js okuyucusu da böyle tanır); gerisi xlbook.sayiMi ile Türkçe yazımda sayı denenir —
 * "1.250,50" sayı olur, "15.140.1001" poz numarası METİN kalır. Sayı sayılan hücre dosyaya gerçek
 * sayı tipiyle yazılır (eskiden her şey inlineStr metindi).
 */
function hucreIsle(r, c, metin) {
  const e = editing; if (!e) return;
  const txt = String(metin == null ? '' : metin).replace(/\u00a0/g, ' ');
  if (!e.rows[r]) e.rows[r] = [];
  e.rows[r][c] = txt;
  if (e.from !== 'xlsx') return;
  if (txt.startsWith('=') && txt.length > 1) fKoy(e, r, c, txt.slice(1));
  else {
    fKoy(e, r, c, null);
    const n = txt === '' ? null : XB.sayiMi(txt);
    if (!e.ham[r]) e.ham[r] = [];
    e.ham[r][c] = txt === '' ? null : (n != null ? n : txt);
  }
  yenidenHesapla();
}
/*
 * Etkin sayfanın bütün formüllerini xlfn motoruyla YENİDEN hesaplar. Sonuç iki yere işlenir:
 * e.ham (dosyaya <v> önbelleği olarak yazılır) ve görünen hücre metni. Başka sayfaya başvurular
 * kaynağın hazırlanmış ham katmanından okunur (salt okunur); tanımlı adlar düzenleyicide çözülmez
 * (bilinen sınır — dosyada formül korunur, yalnız buradaki canlı değer boş kalır). Döngü xlbook'un
 * kararıyla aynı: 0.
 */
function yenidenHesapla() {
  const e = editing; if (!e || e.from !== 'xlsx' || !e.formuller || !e.formuller.length) return;
  const bellek = new Map(), zincir = new Set();
  const BUYUK = (x) => String(x == null ? '' : x).toUpperCase();   // sayfa adları Excel gibi harf düzenine duyarsız
  const basvur = (sayfa, r, c) => {
    if (sayfa && BUYUK(sayfa) !== BUYUK(e.sayfaAd)) {
      const sh = (e.d.sheets || []).find(x => BUYUK(x.name) === BUYUK(sayfa));
      if (!sh) return { e: '#BAŞV!' };
      const hv = ((sh.ham || [])[r] || [])[c];
      return hv == null ? null : hv;
    }
    const k = r + ',' + c;
    const f = fAl(e, r, c);
    if (!f) { const hv = e.ham[r] ? e.ham[r][c] : null; return hv == null ? null : hv; }
    if (bellek.has(k)) return bellek.get(k);
    if (zincir.has(k)) return 0;
    zincir.add(k);
    let v;
    try { v = xlHesapla(f, ctxFor(r, c)); } catch (_) { v = { e: '#DEĞER!' }; }
    if (Array.isArray(v)) { const m = Array.isArray(v[0]) ? v[0] : v; v = m.length ? m[0] : null; }
    // DOKUNULMAMIŞ formül hataya düştüyse (motorun bilmediği işlev, çözülmeyen ad…) dosyadan gelen
    // önbellek değeri korunur: motor eksiği kullanıcının doğru değerlerini ezmesin (inceleme bulgusu)
    if (v && typeof v === 'object' && v.e) {
      const f0 = e.f0 && e.f0[r] ? e.f0[r][c] : null;
      const v0 = e.ham0 && e.ham0[r] ? e.ham0[r][c] : null;
      if (f0 && f0 === f && v0 != null && !(typeof v0 === 'object' && v0.e)) v = v0;
    }
    zincir.delete(k);
    bellek.set(k, v);
    return v;
  };
  const ctxFor = (r, c) => ({
    sayfa: e.sayfaAd, hucre: { r, c },
    oku: (sh, rr, cc) => basvur(sh == null ? e.sayfaAd : sh, rr, cc),
    boyut: (sh) => {
      if (sh != null && String(sh).toUpperCase() !== String(e.sayfaAd).toUpperCase()) {
        const x = (e.d.sheets || []).find(q => String(q.name).toUpperCase() === String(sh).toUpperCase());
        return x ? { r: x.rows, c: x.maxC } : { r: 0, c: 0 };
      }
      return { r: e.rows.length, c: e.maxC };
    },
    ad: (isim) => XB.adDegeri(e.d.sheets ? e.d.sheets.adlar : null, isim, e.sayfaAd),
    simdi: () => XB.anlikSeri(), rastgele: Math.random,
  });
  for (let r = 0; r < e.formuller.length; r++) {
    const sat = e.formuller[r]; if (!sat) continue;
    for (let c = 0; c < sat.length; c++) {
      if (!sat[c]) continue;
      const v = basvur(e.sayfaAd, r, c);
      if (!e.ham[r]) e.ham[r] = [];
      e.ham[r][c] = v;
      const g = gosterim(v, bicimKodu(e, r, c));
      if (!e.rows[r]) e.rows[r] = [];
      e.rows[r][c] = g;
      const td = hucreTd(r, c);
      if (td && document.activeElement !== td) td.textContent = g;
    }
  }
}
/* Hücreye girilince formül METNİ görünür (Excel gibi), çıkınca değere döner. Değişmeyen hücre
   yeniden İŞLENMEZ: biçimli görüntü ("15.03.2024") ham değeri (tarih serisi) ezmesin. */
function gridFocusIn(ev) {
  const td = ev.target && ev.target.closest ? ev.target.closest('.grid-ed td[data-r]') : null;
  const e = editing; if (!td || !e || e.kind !== 'grid') return;
  e.cur = { r: +td.dataset.r, c: +td.dataset.c };
  const f = fAl(e, e.cur.r, e.cur.c);
  if (f) td.textContent = '=' + f;
  e.curText = td.textContent;
}
function gridFocusOut(ev) {
  const td = ev.target && ev.target.closest ? ev.target.closest('.grid-ed td[data-r]') : null;
  const e = editing; if (!td || !e || e.kind !== 'grid') return;
  const r = +td.dataset.r, c = +td.dataset.c, txt = td.textContent;
  const geri = () => { const f = fAl(e, r, c); if (f) td.textContent = (e.rows[r] || [])[c] || ''; };
  if (txt === e.curText) { geri(); return; }
  e.touched = true;
  hucreIsle(r, c, txt);
  geri();
}
function gridRender() {
  const e = editing; if (!e || e.kind !== 'grid') return;
  const w = els.body.querySelector('.xlsx-wrap'), top = w ? w.scrollTop : 0, left = w ? w.scrollLeft : 0;
  els.body.innerHTML = `<div class="xlsx-wrap">${gridTableHtml(e.rows, e.maxC, e.shown)}</div>`;
  xlsxApplyZoom(e.d);
  const n = els.body.querySelector('.xlsx-wrap'); if (n) { n.scrollTop = top; n.scrollLeft = left; }
}
/*
 * DOM'daki hücreleri kopyaya işler (kaydetmeden ve ızgarayı yeniden basmadan önce). Değişen hücre
 * hucreIsle ile aynı kuraldan geçer: "=" formül, Türkçe yazımda sayı gerçek sayı olur. Odaktaki
 * hücrede formül METNİ göründüğünden ("=SUM…"), o görüntü modele değer diye yazılmaz.
 */
function gridSync() {
  const e = editing; if (!e || e.kind !== 'grid') return;
  let degisti = false;
  for (const td of els.body.querySelectorAll('.grid-ed td[data-r]')) {
    const r = +td.dataset.r, c = +td.dataset.c;
    const txt = td.textContent.replace(/\u00a0/g, ' ');
    const f = fAl(e, r, c);
    if (f && txt === '=' + f) continue;
    const eski = e.rows[r] ? e.rows[r][c] : null;
    if (String(eski == null ? '' : eski) === txt) continue;
    if (!e.rows[r]) e.rows[r] = [];
    e.rows[r][c] = txt;
    if (e.from === 'xlsx') {
      if (txt.startsWith('=') && txt.length > 1) fKoy(e, r, c, txt.slice(1));
      else {
        fKoy(e, r, c, null);
        const n = txt === '' ? null : XB.sayiMi(txt);
        if (!e.ham[r]) e.ham[r] = [];
        e.ham[r][c] = txt === '' ? null : (n != null ? n : txt);
      }
      degisti = true;
    }
  }
  if (degisti) yenidenHesapla();
}
function startGridEdit(d, kaynak, maxC, from) {
  els.body.classList.add('grid-edit');
  const xl = from === 'xlsx';
  const srcRows = xl ? kaynak.cells : kaynak;
  const rows = (srcRows || []).map(r => (r || []).slice());
  if (!rows.length) rows.push([]);
  editing = {
    kind: 'grid', d, from, rows, maxC: Math.max(maxC, 1), shown: Math.min(rows.length, GRID_MAX), src: srcRows || [], touched: false,
    // v8.8: formüller değere dondurulmaz, sayılar sayı kalır, hücre biçimi styles.xml'e yazılır
    ham: xl ? (kaynak.ham || []).map(r2 => (r2 || []).slice()) : null,
    formuller: xl ? (kaynak.formuller || []).map(r2 => (r2 ? r2.map(f => (f == null ? undefined : formulNormalle(f))) : undefined)) : null,
    bicimler: xl ? (kaynak.bicimler || []).map(r2 => (r2 ? r2.slice() : undefined)) : null,
    // dosyadan yüklenen hâlin anlık görüntüsü: dokunulmamış formül motorda hataya düşerse
    // önbellek değeri buradan geri alınır (yenidenHesapla)
    ham0: xl ? (kaynak.ham || []).map(r2 => (r2 || []).slice()) : null,
    f0: xl ? (kaynak.formuller || []).map(r2 => (r2 ? r2.map(f => (f == null ? undefined : formulNormalle(f))) : undefined)) : null,
    stiller: xl ? {} : null,
    sayfaAd: xl ? kaynak.name : '',
    cur: null, curText: '',
  };
  gridRender();
  els.body.addEventListener('input', gridDirty);
  els.body.addEventListener('focusin', gridFocusIn);
  els.body.addEventListener('focusout', gridFocusOut);
  els.tools.innerHTML = gridToolbarHtml();
  if (xl) api.toast(tt('editSheetNote', 'Formüller, sayılar ve verilen hücre biçimi kaydedilen kopyada korunur; birleştirilmiş hücreler ve sütun genişlikleri aktarılmaz.'), { ms: 7000 });
}
const gridDirty = () => { if (editing) editing.touched = true; };
const HUCRE_RENK = ['#c00000', '#1f4e79', '#2e7d32', '#e65100', '#000000'];
const HUCRE_DOLGU = ['#fff2a8', '#d9ead3', '#cfe2f3', '#f4cccc', '#e0e0e0'];
function gridToolbarHtml() {
  const e = editing, more = e && e.rows.length > e.shown, xl = e && e.from === 'xlsx';
  const ic = (pe, icon, label) => `<button type="button" class="btn small" data-pe="${pe}" title="${esc(label)}" aria-label="${esc(label)}">${ICON(icon)}</button>`;
  const renkler = (pe, liste) => liste.map(c2 => `<button type="button" class="pdfe-color" data-pe="${pe}" data-color="${c2}" style="background:${c2}" aria-label="${esc(c2)}"></button>`).join('')
    + `<button type="button" class="pdfe-color grid-nofill" data-pe="${pe}" data-color="" aria-label="${esc(tt('editClearFmt', 'Biçimi temizle'))}"></button>`;
  return ic('insrow', 'i-plus', tt('editInsRow', 'Üstüne satır ekle')) + ic('delrow', 'i-minus', tt('editDelRow', 'Satırı sil'))
    + ic('inscol', 'i-next', tt('editInsCol', 'Soluna sütun ekle')) + ic('delcol', 'i-prev', tt('editDelCol', 'Sütunu sil'))
    + `<button type="button" class="btn small" data-pe="addrow">${ICON('i-plus')} ${esc(tt('editAddRow', 'Satır'))}</button>`
    + `<button type="button" class="btn small" data-pe="addcol">${ICON('i-plus')} ${esc(tt('editAddCol', 'Sütun'))}</button>`
    + (xl ? `<span class="sp"></span>` + ic('autosum', 'i-sum', tt('editSum', 'Otomatik toplam'))
      + ic('cellbold', 'i-bold', tt('editBold', 'Kalın')) + ic('cellitalic', 'i-italic', tt('editItalic', 'İtalik'))
      + `<span class="pdfe-colors">${renkler('cellcolor', HUCRE_RENK)}</span><span class="pdfe-colors">${renkler('cellfill', HUCRE_DOLGU)}</span>` : '')
    + (more ? `<button type="button" class="btn small" data-pe="gridmore">${esc(tt('loadMore', 'Daha fazla'))}</button>` : '')
    + `<span class="sp"></span><button type="button" class="btn small" data-doc="zout" aria-label="−">${ICON('i-zoom-out')}</button><button type="button" class="btn small" data-doc="zfit">${esc(tt('zoom100', '%100'))}</button><button type="button" class="btn small" data-doc="zin" aria-label="+">${ICON('i-zoom-in')}</button>`
    + `<span class="sp"></span><button type="button" class="btn small primary" data-pe="save">${esc(tt('editSave', 'Kaydet'))}</button>`
    + `<button type="button" class="btn small" data-pe="cancel">${esc(t('cancel'))}</button>`;
}
/*
 * Yapısal işlem (v8.8): satır/sütun ekleme-silme. Ekleme SEÇİLİ hücrenin üstüne/soluna yapılır
 * (Excel kuralı); seçili hücre yoksa sona. Bütün katmanlar birlikte kayar: değerler, ham katman,
 * formüller (metinleri xlbook.yapisalKaydir ile Excel kuralında düzeltilir) ve hücre biçimleri.
 */
function yapisalIslem(tur) {
  const e = editing; if (!e || e.kind !== 'grid') return;
  gridSync();
  const satirMi = tur === 'insrow' || tur === 'delrow';
  const delta = tur[0] === 'i' ? 1 : -1;
  // Seçim yoksa işlem yapılmaz: yedek olarak SON satırı almak, uzun sayfada GÖRÜNMEYEN
  // son satırı sessizce siliyordu (inceleme bulgusu) — kullanıcı hangi satıra dokunduğunu bilmeli.
  const cur = e.cur;
  if (!cur) { api.toast(tt('editPickCell', 'Önce bir hücreye dokunun'), { type: 'warn' }); return; }
  const idx = satirMi ? Math.max(0, Math.min(cur.r, e.rows.length - 1)) : Math.max(0, Math.min(cur.c, e.maxC - 1));
  if (delta < 0 && satirMi && e.rows.length <= 1) return;
  if (delta < 0 && !satirMi && e.maxC <= 1) return;
  if (satirMi) {
    if (delta > 0) { e.rows.splice(idx, 0, []); if (e.ham) e.ham.splice(idx, 0, []); if (e.formuller) e.formuller.splice(idx, 0, undefined); if (e.bicimler) e.bicimler.splice(idx, 0, undefined); }
    else { e.rows.splice(idx, 1); if (e.ham) e.ham.splice(idx, 1); if (e.formuller) e.formuller.splice(idx, 1); if (e.bicimler) e.bicimler.splice(idx, 1); }
    e.shown = Math.min(Math.max(e.shown + delta, 1), Math.max(e.rows.length, 1));
  } else {
    const kes = (dizi, bosluk) => { if (!dizi) return; for (const row of dizi) { if (!row || row.length <= idx) continue; if (delta > 0) row.splice(idx, 0, bosluk); else row.splice(idx, 1); } };
    kes(e.rows, ''); kes(e.ham, null); kes(e.formuller, undefined); kes(e.bicimler, undefined);
    e.maxC = Math.max(1, e.maxC + delta);
  }
  if (e.stiller) {
    const yeni = {};
    for (const k of Object.keys(e.stiller)) {
      let [r, c] = k.split(',').map(Number);
      const kk = satirMi ? r : c;
      if (delta < 0 && kk === idx) continue;
      if (kk >= idx) { if (satirMi) r += delta; else c += delta; }
      yeni[r + ',' + c] = e.stiller[k];
    }
    e.stiller = yeni;
  }
  if (e.formuller) for (let r = 0; r < e.formuller.length; r++) {
    const sat = e.formuller[r]; if (!sat) continue;
    for (let c = 0; c < sat.length; c++) if (sat[c]) sat[c] = XB.yapisalKaydir(sat[c], satirMi ? 'satir' : 'sutun', idx, delta);
  }
  e.touched = true; e.cur = null; e.curText = '';
  gridRender(); els.tools.innerHTML = gridToolbarHtml();
  yenidenHesapla();
}
/** Σ: seçili hücrenin üstündeki (yoksa solundaki) bitişik sayı bloğuna SUM yazar */
function otomatikToplam() {
  const e = editing; if (!e || e.from !== 'xlsx') return;
  gridSync();
  const cur = e.cur;
  if (!cur) { api.toast(tt('editPickCell', 'Önce bir hücreye dokunun'), { type: 'warn' }); return; }
  const sayili = (r, c) => { if (r < 0 || c < 0) return false; if (fAl(e, r, c)) return true; const v = e.ham[r] ? e.ham[r][c] : null; return typeof v === 'number'; };
  let f = null, r0 = cur.r;
  while (r0 > 0 && sayili(r0 - 1, cur.c)) r0--;
  if (r0 < cur.r) f = `SUM(${XB.sutunAd(cur.c)}${r0 + 1}:${XB.sutunAd(cur.c)}${cur.r})`;
  else {
    let c0 = cur.c;
    while (c0 > 0 && sayili(cur.r, c0 - 1)) c0--;
    if (c0 < cur.c) f = `SUM(${XB.sutunAd(c0)}${cur.r + 1}:${XB.sutunAd(cur.c - 1)}${cur.r + 1})`;
  }
  if (!f) { api.toast(tt('editSumNone', 'Üstte ya da solda toplanacak sayı yok'), { type: 'warn' }); return; }
  fKoy(e, cur.r, cur.c, f);
  e.touched = true;
  yenidenHesapla();
  const td = hucreTd(cur.r, cur.c);
  if (td) td.textContent = (e.rows[cur.r] || [])[cur.c] || '';
}
/** Seçili hücrenin biçimini değiştirir (kalın / italik / yazı rengi / dolgu) ve canlı uygular */
function hucreBicim(tur, deger) {
  const e = editing; if (!e || e.from !== 'xlsx') return;
  const cur = e.cur;
  if (!cur) { api.toast(tt('editPickCell', 'Önce bir hücreye dokunun'), { type: 'warn' }); return; }
  const k = cur.r + ',' + cur.c;
  const st = { ...(e.stiller[k] || {}) };
  if (tur === 'b' || tur === 'i') st[tur] = !st[tur];
  else if (!deger) { delete st.renk; delete st.dolgu; }
  else st[tur] = deger;
  if (!st.b && !st.i && !st.renk && !st.dolgu) delete e.stiller[k]; else e.stiller[k] = st;
  e.touched = true;
  const td = hucreTd(cur.r, cur.c);
  if (td) td.style.cssText = stilCss(e.stiller[k]);
}
/* ---- düz metin ---------------------------------------------------------------------- */
function startTextEdit(d) {
  els.body.classList.add('editing-text');
  if (d.csv && d.csv.cut) api.toast(tt('editCsvBig', 'Tablo görüntülemek için kısaltıldı; bütün satırlar korunsun diye metin olarak düzenleniyor.'), { ms: 7000 });
  els.body.innerHTML = `<textarea class="doc-edit-txt" spellcheck="false"></textarea>`;
  const ta = els.body.querySelector('.doc-edit-txt');
  ta.value = d.text == null ? '' : d.text;
  ta.addEventListener('input', () => { if (editing) editing.touched = true; });
  editing = { kind: 'text', d, ta, touched: false };
  els.tools.innerHTML = `<span class="muted">${esc(kindLabel('text'))}</span><span class="sp"></span>`
    + `<button type="button" class="btn small primary" data-pe="save">${esc(tt('editSave', 'Kaydet'))}</button>`
    + `<button type="button" class="btn small" data-pe="cancel">${esc(t('cancel'))}</button>`;
  setTimeout(() => { try { ta.focus(); } catch (_) { /* yok */ } }, 0);
}
/* Word yazı rengi ve vurgu paletleri: vurgu renkleri Word'ün fosforlu kalemine (RENK_ADI adları) denk düşer */
const YAZI_RENK = ['#c00000', '#1f4e79', '#2e7d32', '#e65100', '#000000'];
const YAZI_VURGU = ['#ffff00', '#00ff00', '#00ffff', '#ff00ff'];
function wordToolbarHtml() {
  const b = (c, icon, label) => `<button type="button" class="btn small" data-pe="cmd" data-cmd="${c}" title="${esc(label)}" aria-label="${esc(label)}">${ICON(icon)}</button>`;
  const ic = (pe, icon, label) => `<button type="button" class="btn small" data-pe="${pe}" title="${esc(label)}" aria-label="${esc(label)}">${ICON(icon)}</button>`;
  const renkler = (pe, liste, sil) => liste.map(c2 => `<button type="button" class="pdfe-color" data-pe="${pe}" data-color="${c2}" style="background:${c2}" aria-label="${esc(c2)}"></button>`).join('')
    + (sil ? `<button type="button" class="pdfe-color grid-nofill" data-pe="${pe}" data-color="" aria-label="${esc(tt('editClearFmt', 'Biçimi temizle'))}"></button>` : '');
  const sec = (pe, opts, label) => `<select class="doc-sel" data-pe-sel="${pe}" title="${esc(label)}" aria-label="${esc(label)}">${opts.map(([v, ad]) => `<option value="${v}">${esc(ad)}</option>`).join('')}</select>`;
  const bas = tt('editHeading', 'Başlık');
  return sec('block', [['', tt('editParaStyle', 'Paragraf biçemi')], ['P', tt('editNormal', 'Normal')], ['H1', bas + ' 1'], ['H2', bas + ' 2'], ['H3', bas + ' 3']], tt('editParaStyle', 'Paragraf biçemi'))
    + sec('size', [['', tt('editFontSize', 'Punto')], ['1', '8'], ['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '36']], tt('editFontSize', 'Punto'))
    + `<span class="sp"></span>` + b('bold', 'i-bold', tt('editBold', 'Kalın')) + b('italic', 'i-italic', tt('editItalic', 'İtalik')) + b('underline', 'i-underline', tt('editUnderline', 'Altı çizili')) + b('strikeThrough', 'i-strike', tt('editStrike', 'Üstü çizili'))
    + `<span class="pdfe-colors">${renkler('fore', YAZI_RENK, false)}</span><span class="pdfe-colors">${renkler('hilite', YAZI_VURGU, true)}</span>`
    + `<span class="sp"></span>` + b('justifyLeft', 'i-align-left', tt('editAlignL', 'Sola hizala')) + b('justifyCenter', 'i-align-center', tt('editAlignC', 'Ortala')) + b('justifyRight', 'i-align-right', tt('editAlignR', 'Sağa hizala')) + b('justifyFull', 'i-align-just', tt('editAlignJ', 'İki yana yasla'))
    + `<span class="sp"></span>` + b('insertUnorderedList', 'i-listul', tt('editListUl', 'Madde imli liste')) + b('insertOrderedList', 'i-listol', tt('editListOl', 'Numaralı liste')) + ic('table', 'i-table', tt('editTable', 'Tablo ekle'))
    + `<span class="sp"></span><button type="button" class="btn small" data-pe="find">${esc(tt('editFind', 'Bul ve değiştir'))}</button>`
    + `<button type="button" class="btn small" data-pe="undo" title="${esc(t('undo'))}" aria-label="${esc(t('undo'))}">${ICON('i-undo')}</button>`
    + ic('redo', 'i-redo', tt('editRedo', 'Yinele')) + b('removeFormat', 'i-erase', tt('editClearFmt', 'Biçimi temizle'))
    + `<span class="sp"></span><button type="button" class="btn small primary" data-pe="save">${esc(tt('editSave', 'Kaydet'))}</button>`
    + `<button type="button" class="btn small" data-pe="cancel">${esc(t('cancel'))}</button>`;
}
/** Araç çubuğundaki açılır seçimler (paragraf biçemi / punto); data-pe-sel değişim olayı buraya düşer */
function onEditSelect(sel) {
  if (!editing || !editing.ed) return;
  const k = sel.dataset.peSel, v = sel.value;
  // uygulandıktan sonra yer tutucuya dönülür: change olayı ancak değer DEĞİŞİNCE gelir,
  // sıfırlanmazsa aynı biçem (H1'den sonra tekrar H1, Normal'e dönüş) ikinci kez seçilemezdi
  if (k === 'block' && v) { editing.ed.cmd('formatBlock', '<' + v + '>'); sel.value = ''; }
  else if (k === 'size' && v) { editing.ed.cmd('fontSize', v); sel.value = ''; }
}
async function onEditAction(btn) {
  if (!editing) return;
  const k = btn.dataset.pe, st = editing.st;
  if (k === 'tool') { editing.surf.tool = btn.dataset.tool; els.tools.innerHTML = PdfEdit.toolbarHtml(st); return; }
  if (k === 'color') { st.color = btn.dataset.color; els.tools.innerHTML = PdfEdit.toolbarHtml(st); return; }
  if (k === 'width') { st.width = +btn.dataset.width; els.tools.innerHTML = PdfEdit.toolbarHtml(st); return; }
  if (k === 'rotl' || k === 'rotr') { const i = topPage(); if (i >= 0) { PdfEdit.rotatePage(st, i, k === 'rotl' ? -90 : 90); editing.touched = true; editing.surf.render(); } return; }
  if (k === 'pgup' || k === 'pgdn') {
    const i = topPage(); if (i < 0) return;
    if (PdfEdit.movePage(st, i, k === 'pgup' ? -1 : 1)) { editing.touched = true; editing.surf.render(); }
    return;
  }
  if (k === 'delpage') {
    const i = topPage(); if (i < 0) return;
    if (!(await askConfirm(tt('editDelPageAsk', 'Bu sayfa çıktıdan çıkarılsın mı?')))) return;
    if (PdfEdit.deletePage(st, i)) { editing.touched = true; editing.surf.render(); }
    else api.toast(tt('editLastPage', 'Son sayfa silinemez'), { type: 'error' });
    return;
  }
  if (k === 'addrow') {
    // Yeni satır sona eklenir. Tablonun tamamı ekrandaysa satır da görünür olur; kısaltılmış büyük bir sayfada
    // görünen aralık büyütülmez (amaç GRID_MAX'ı korumak), satır yine de dosyaya yazılır — "Daha fazla" ile görülür.
    gridSync(); const e = editing; e.rows.push([]); e.touched = true;
    if (e.shown >= e.rows.length - 1) e.shown = e.rows.length;
    gridRender(); els.tools.innerHTML = gridToolbarHtml();
    const tds = els.body.querySelectorAll(`.grid-ed td[data-r="${e.rows.length - 1}"]`);
    if (tds[0]) { tds[0].focus(); tds[0].scrollIntoView({ block: 'nearest' }); }
    return;
  }
  if (k === 'addcol') { gridSync(); const e = editing; e.maxC++; e.touched = true; gridRender(); return; }
  if (k === 'insrow' || k === 'delrow' || k === 'inscol' || k === 'delcol') { yapisalIslem(k); return; }
  if (k === 'autosum') { otomatikToplam(); return; }
  if (k === 'cellbold' || k === 'cellitalic') { hucreBicim(k === 'cellbold' ? 'b' : 'i'); return; }
  if (k === 'cellcolor' || k === 'cellfill') { hucreBicim(k === 'cellcolor' ? 'renk' : 'dolgu', btn.dataset.color); return; }
  if (k === 'gridmore') { gridSync(); const e = editing; e.shown = Math.min(e.rows.length, e.shown + GRID_MAX); gridRender(); els.tools.innerHTML = gridToolbarHtml(); return; }
  if (k === 'undo') { if (editing.kind === 'pdf') { if (PdfEdit.undo(st)) editing.surf.render(); } else if (editing.ed) editing.ed.cmd('undo'); return; }
  if (k === 'zin' || k === 'zout' || k === 'zfit') { editing.surf.zoom(k === 'zin' ? 1.25 : k === 'zout' ? 0.8 : 0); return; }
  if (k === 'cmd') { editing.ed.cmd(btn.dataset.cmd); return; }
  if (k === 'redo') { if (editing.ed) editing.ed.cmd('redo'); return; }
  if (k === 'fore') { if (editing.ed) editing.ed.cmd('foreColor', btn.dataset.color); return; }
  if (k === 'hilite') { if (editing.ed) editing.ed.cmd('hiliteColor', btn.dataset.color || 'transparent'); return; }
  if (k === 'table') {
    if (!editing.ed) return;
    const f = await askForm(tt('editTable', 'Tablo ekle'), [
      { id: 'r', label: tt('editTableRows', 'Satır sayısı'), type: 'number', value: 3 },
      { id: 'c', label: tt('editTableCols', 'Sütun sayısı'), type: 'number', value: 3 },
    ]);
    if (!f) return;
    const nr = Math.max(1, Math.min(50, Math.round(f.r || 0))), nc = Math.max(1, Math.min(12, Math.round(f.c || 0)));
    const satir = `<tr>${'<td><br></td>'.repeat(nc)}</tr>`;
    editing.ed.cmd('insertHTML', `<table>${satir.repeat(nr)}</table><p><br></p>`);
    editing.touched = true;
    return;
  }
  if (k === 'find') {
    const find = await askText(tt('editFindWhat', 'Aranacak'), '');
    if (!find) return;
    const repl = await askText(tt('editReplaceWith', 'Yerine'), '');
    if (repl == null) return;
    const n = DocEdit.replaceAll(editing.root, find, repl, false);
    if (n) editing.touched = true;
    api.toast(n ? n + ' ' + tt('editReplaced', 'yer değiştirildi') : t('noResult'), { type: n ? 'ok' : 'error' });
    return;
  }
  if (k === 'save') { await saveEdit(); return; }
  if (k === 'cancel') { await cancelEdit(); return; }
}
/** Görünümdeki etkin sayfanın model sırası; döndürme ve silme ona uygulanır (yüzey hesaplar, işaretler) */
const topPage = () => (editing && editing.surf ? editing.surf.active() : -1);
async function saveEdit() {
  if (!editing) return;
  const e = editing;
  api.toast(tt('editSaving', 'Hazırlanıyor…'), { ms: 20000 });
  try {
    if (e.kind === 'pdf') {
      const out = await PdfEdit.exportPdf(e.buf, e.st);
      saveOut(out, outName(e.d, 'pdf'), 'application/pdf');
    } else if (e.kind === 'grid') {
      gridSync();
      if (e.from === 'xlsx') {
        // Etkin sayfa düzenleyicinin katmanlarıyla (formül, ham değer, hücre ve sayı biçimi),
        // ötekiler kitaptan okunduğu hâliyle yazılır; dokunulmayan sayfaların formülleri de korunur.
        // ODS kaynaklı kitapta formüller ELENİR: söz dizimi (Sayfa.A1, ; ayracı) Excel'inkine
        // çevrilemiyor; bozuk formül yazmaktansa hesaplanmış değerler yazılır (inceleme bulgusu).
        const akt = e.d.sheetIdx || 0;
        const odsMu = !!(e.d.sheets && e.d.sheets.bicim === 'ods');
        const sheets = (e.d.sheets || []).map((sh, i) => (i === akt
          ? { name: sh.name, rows: e.rows, ham: e.ham, formuller: odsMu ? null : e.formuller, stiller: e.stiller, bicimler: e.bicimler }
          : { name: sh.name, rows: sh.cells || [], ham: sh.ham, formuller: odsMu ? null : sh.formuller, bicimler: sh.bicimler }));
        const out = await xlsxBook(sheets.length ? sheets : [{ name: 'Sayfa1', rows: e.rows, ham: e.ham, formuller: e.formuller, stiller: e.stiller, bicimler: e.bicimler }],
          { adlar: e.d.sheets ? e.d.sheets.adlar : null });
        saveOut(new Uint8Array(out), outName(e.d, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      } else {
        const ext = e.d.name.toLowerCase().split('.').pop() === 'txt' ? 'txt' : 'csv';
        saveOut(new TextEncoder().encode(csvText(e.rows, (e.d.csv && e.d.csv.sep) || ';')), outName(e.d, ext), ext === 'csv' ? 'text/csv' : 'text/plain');
      }
    } else if (e.kind === 'text') {
      const ext = e.d.name.toLowerCase().split('.').pop() || 'txt';
      saveOut(new TextEncoder().encode(e.ta.value), outName(e.d, ext), 'text/plain');
    } else {
      const out = await DocEdit.htmlToDocx(e.root, e.d.docxPage);
      saveOut(out, outName(e.d, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      if (e.d.kind === 'doc') api.toast(tt('editAsDocx', 'Belge DOCX olarak kaydedildi'), { ms: 5000 });
    }
    e.touched = false;
    await endEdit(true);
  } catch (err) {
    console.warn(err);
    api.toast(tt('editSaveFail', 'Kaydedilemedi') + ': ' + (err.message || err), { type: 'error', ms: 7000 });
  }
}
async function cancelEdit() {
  if (!editing) return;
  if (editing.touched && !(await askConfirm(tt('editDiscardAsk', 'Yapılan değişiklikler atılsın mı?')))) return;
  await endEdit(false);
}
async function endEdit(saved) {
  const e = editing; editing = null;
  document.body.classList.remove('editmode');
  if (!e) return;
  if (e.kind === 'grid') {
    els.body.removeEventListener('input', gridDirty);
    els.body.removeEventListener('focusin', gridFocusIn);
    els.body.removeEventListener('focusout', gridFocusOut);
  }
  els.body.classList.remove('editing-text');
  if (e.kind === 'word' && e.ed) e.ed.unmount();
  if (e.kind === 'pdf' && e.surf && e.surf.unmount) e.surf.unmount();
  await show(e.d, { replace: true });   // görünümü tazeden kur (düzenleme izleri kalmasın)
  if (saved) api.toast(tt('editDone', 'Düzenleme bitti'), { type: 'ok' });
}
export const isEditing = () => !!editing;

function showOther(d) {
  els.tools.innerHTML = '';
  const msg = d.kind === 'office' ? tt('docOfficeMsg', 'Bu biçim doğrudan görüntülenemiyor. Google Drive ile giriş yaptıysanız belge PDF\'e dönüştürülerek açılabilir; ya da başka bir uygulamaya gönderin.') : tt('docUnknown', 'Bu dosya türü tanınmıyor.');
  els.body.innerHTML = `<div class="doc-card">${iconFor(d.name)}<strong>${esc(d.name)}</strong><p>${esc(msg)}</p>${otherActions(d)}</div>`;
}
/** Drive dönüşümünden dönen PDF'i aynı yığında açar */
export async function openConverted(info) { await show({ kind: 'pdf', name: info.name, size: info.size, id: info.id }); }
