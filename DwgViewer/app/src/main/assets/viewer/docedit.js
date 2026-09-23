/*
 * Word düzenleme (Pro): görünümdeki belgeyi yerinde düzenleme ve DOCX olarak yazma.
 *
 *  Düzenleme akış görünümünde yapılır: docs.js'in ürettiği bloklar (.docx-page içeriği) contenteditable olur.
 *  Kullanıcı metni değiştirir, paragraf ekler ya da siler, kalın / italik / altı çizili uygular, hizalar,
 *  bul-değiştir çalıştırır. "Kaydet" denince düzenlenmiş HTML, OOXML'e çevrilip DOCX paketi olarak yazılır.
 *
 *  Kaynak biçim ne olursa olsun (DOCX, Word 97-2003 .doc, RTF, Word HTML, MHTML) çıktı DOCX'tir; çünkü
 *  elimizdeki tek yazıcı OOXML yazıcısıdır. Kullanıcıya bu açıkça söylenir. Özgün dosya değişmez.
 *
 *  Paket kendi elimizle kurulur: ZIP yazıcısı (deflate-raw varsa sıkıştırır, yoksa saklar), [Content_Types].xml,
 *  _rels/.rels, word/document.xml, word/_rels/document.xml.rels, word/styles.xml ve varsa word/media/*.
 *  Ek kütüphane kullanılmaz.
 */
import { t } from './i18n.js';

const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const xesc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const enc = new TextEncoder();
const twip = (pt) => Math.round(pt * 20);
const emu = (pt) => Math.round(pt * 12700);
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
/** CSS uzunluğu → punto */
function lenPt(v) {
  if (!v) return 0;
  const m = /^\s*(-?[\d.]+)\s*(pt|px|cm|mm|in|em)?\s*$/.exec(v); if (!m) return 0;
  const n = +m[1], u = (m[2] || 'px').toLowerCase();
  return u === 'pt' ? n : u === 'px' ? n * 0.75 : u === 'cm' ? n * 28.3465 : u === 'mm' ? n * 2.83465 : u === 'in' ? n * 72 : u === 'em' ? n * 11 : n;
}
/*
 * Adlı CSS renkleri: Word'ün 15 vurgu adı (okuyucu w:highlight'ı adla basar) + tarayıcının
 * sık ürettiği birkaç ad. Ad çözülemeyince kaynak belgeden gelen vurgu kayıtta sessizce
 * düşüyordu; artık RRGGBB'ye çevrilip w:shd olarak geri yazılır.
 */
const RENK_ADI = { yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', aqua: '00FFFF', magenta: 'FF00FF', fuchsia: 'FF00FF',
  blue: '0000FF', red: 'FF0000', darkblue: '00008B', navy: '000080', darkcyan: '008B8B', teal: '008080',
  darkgreen: '006400', darkmagenta: '8B008B', purple: '800080', darkred: '8B0000', maroon: '800000',
  darkyellow: '808000', olive: '808000', gray: '808080', grey: '808080', darkgray: 'A9A9A9', darkgrey: 'A9A9A9',
  lightgray: 'D3D3D3', lightgrey: 'D3D3D3', silver: 'C0C0C0', black: '000000', white: 'FFFFFF', orange: 'FFA500', lime: '00FF00' };
/** CSS rengi → RRGGBB (büyük harf); çözülemezse boş */
function hex6(v) {
  if (!v) return '';
  const ad = RENK_ADI[v.trim().toLowerCase()]; if (ad) return ad;
  let m = /^#([0-9a-f]{6})$/i.exec(v.trim()); if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f]{3})$/i.exec(v.trim()); if (m) return m[1].split('').map(c => c + c).join('').toUpperCase();
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  if (m) return [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('').toUpperCase();
  return '';
}

// ---------------------------------------------------------------------------------
// ZIP yazıcısı
// ---------------------------------------------------------------------------------
const CRC = (() => { const t2 = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t2[n] = c >>> 0; } return t2; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch (_) { return null; }
}
/*
 * MS-DOS tarih / saat çifti (ZIP başlığının kendi biçimi): saniye iki birimlidir, yıl 1980'den sayılır.
 * Aralık dışındaki bir zaman 0 bırakılır — DOCX paketinde zaten zaman yoktur.
 */
export function dosTarih(ms) {
  if (!(ms > 0)) return [0, 0];
  const d = new Date(ms), y = d.getFullYear();
  if (y < 1980 || y > 2107) return [0, 0];
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}
/** entries: [{name, data:Uint8Array, time?}] → ZIP paketi (Uint8Array). Sıkıştırma yoksa saklanmış girdi yazılır. */
export async function zipWrite(entries) {
  const parts = [], cds = []; let off = 0;
  for (const e of entries) {
    const nb = enc.encode(e.name), raw = e.data;
    const comp = raw.length > 200 ? await deflateRaw(raw) : null;
    const useDef = !!comp && comp.length < raw.length;
    const body = useDef ? comp : raw, crc = crc32(raw);
    const [dt, dd] = dosTarih(e.time);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true);
    lh.setUint16(8, useDef ? 8 : 0, true); lh.setUint16(10, dt, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x800, true);
    cd.setUint16(10, useDef ? 8 : 0, true); cd.setUint16(12, dt, true); cd.setUint16(14, dd, true); cd.setUint32(16, crc, true); cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true); cd.setUint16(28, nb.length, true); cd.setUint32(42, off, true);
    cds.push(new Uint8Array(cd.buffer), nb);
    off += 30 + nb.length + body.length;
  }
  const cdLen = cds.reduce((n, a) => n + a.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, entries.length, true); eo.setUint16(10, entries.length, true);
  eo.setUint32(12, cdLen, true); eo.setUint32(16, off, true);
  const all = [...parts, ...cds, new Uint8Array(eo.buffer)];
  const total = all.reduce((n, a) => n + a.length, 0), out = new Uint8Array(total);
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ---------------------------------------------------------------------------------
// HTML → OOXML
// ---------------------------------------------------------------------------------
const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'TABLE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE']);
/** Bir öğeden miras alınan satır içi biçim */
function inlineOf(el, base) {
  const f = { ...base };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG') f.b = 1;
  if (tag === 'I' || tag === 'EM') f.i = 1;
  if (tag === 'U' || tag === 'INS') f.u = 1;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') f.strike = 1;
  if (tag === 'SUP') f.va = 'superscript';
  if (tag === 'SUB') f.va = 'subscript';
  if (tag === 'A') { f.link = el.getAttribute('href') || ''; f.u = 1; f.color = f.color || '0563C1'; }
  if (tag === 'FONT') {
    const c = hex6(el.getAttribute('color')); if (c) f.color = c;
    // execCommand('fontSize') eski usül size=1..7 üretir; HTML'in geleneksel punto merdiveni
    const sz = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 }[+el.getAttribute('size')];
    if (sz) f.size = sz;
  }
  const st = el.style;
  if (st) {
    const w = st.fontWeight; if (w && (w === 'bold' || num(w) >= 600)) f.b = 1; else if (w === 'normal') f.b = 0;
    if (st.fontStyle === 'italic') f.i = 1; else if (st.fontStyle === 'normal') f.i = 0;
    const d = st.textDecoration + ' ' + (st.textDecorationLine || '');
    if (/underline/.test(d)) f.u = 1; if (/line-through/.test(d)) f.strike = 1;
    const c = hex6(st.color); if (c) f.color = c;
    const bg = hex6(st.backgroundColor || st.background); if (bg) f.shd = bg;
    const fs = lenPt(st.fontSize); if (fs > 0) f.size = fs;
    if (st.textTransform === 'uppercase') f.caps = 1;
    if (st.fontVariant === 'small-caps' || st.fontVariantCaps === 'small-caps') f.smallCaps = 1;
  }
  return f;
}
function rPr(f) {
  const p = [];
  if (f.b) p.push('<w:b/>'); if (f.i) p.push('<w:i/>');
  if (f.u) p.push('<w:u w:val="single"/>'); if (f.strike) p.push('<w:strike/>');
  if (f.caps) p.push('<w:caps/>'); if (f.smallCaps) p.push('<w:smallCaps/>');
  if (f.color) p.push(`<w:color w:val="${f.color}"/>`);
  if (f.shd) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${f.shd}"/>`);
  if (f.size) p.push(`<w:sz w:val="${Math.round(f.size * 2)}"/><w:szCs w:val="${Math.round(f.size * 2)}"/>`);
  if (f.va) p.push(`<w:vertAlign w:val="${f.va}"/>`);
  return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : '';
}
const runXml = (f, inner) => `<w:r>${rPr(f)}${inner}</w:r>`;
const textRun = (f, s) => runXml(f, `<w:t xml:space="preserve">${xesc(s)}</w:t>`);

/** Satır içi düğümleri gezip w:r dizisi üretir; ctx bağlantı ve resim ilişkilerini toplar */
function runsOf(node, f, ctx) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      const s = n.nodeValue.replace(/ /g, ' ');
      if (s) out += textRun(f, s);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (tag === 'BR') { out += '<w:r><w:br/></w:r>'; continue; }
    if (tag === 'IMG') { out += imgRun(n, ctx); continue; }
    if (n.classList && n.classList.contains('tab')) { out += '<w:r><w:tab/></w:r>'; continue; }
    if (BLOCK.has(tag)) { out += runsOf(n, f, ctx); continue; }   // düzenleme sırasında iç içe geçen bloklar
    const f2 = inlineOf(n, f);
    const inner = runsOf(n, f2, ctx);
    if (!inner) continue;
    if (f2.link && !f.link && /^(https?|ftp|mailto):/i.test(f2.link)) {
      const rid = ctx.rel(f2.link);
      out += `<w:hyperlink r:id="${rid}">${inner}</w:hyperlink>`;
    } else out += inner;
  }
  return out;
}
/** data: URL resmi paketin word/media klasörüne alır ve satır içi çizim üretir */
function imgRun(im, ctx) {
  const src = im.getAttribute('src') || '';
  const m = /^data:image\/(png|jpeg|jpg|gif|bmp);base64,([A-Za-z0-9+/=]+)$/i.exec(src);
  if (!m) return '';
  let ext = m[1].toLowerCase(); if (ext === 'jpg') ext = 'jpeg';
  if (ext === 'gif' || ext === 'bmp') return textRun({}, tt('docPicture', '[Resim]'));   // Word bu ikisini satır içi çizimde istemez
  const bin = atob(m[2]), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const { rid, name } = ctx.media(u8, ext);
  let wPt = lenPt(im.style.width) || (im.naturalWidth ? im.naturalWidth * 0.75 : 0);
  let hPt = lenPt(im.style.height) || 0;
  const nw = im.naturalWidth || 0, nh = im.naturalHeight || 0;
  if (!wPt) wPt = nw ? nw * 0.75 : 200;
  if (!hPt) hPt = nw && nh ? wPt * nh / nw : wPt * 0.75;
  const id = ctx.nextId();
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(wPt)}" cy="${emu(hPt)}"/>`
    + `<wp:docPr id="${id}" name="${xesc(name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xesc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(wPt)}" cy="${emu(hPt)}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}
const JC = { center: 'center', right: 'right', justify: 'both', left: 'left', start: 'left', end: 'right' };
/** Paragraf özellikleri: stil, hizalama, girinti, aralık */
function pPr(el, style, extra) {
  const p = [];
  if (style) p.push(`<w:pStyle w:val="${style}"/>`);
  if (extra) p.push(extra);
  const st = el.style || {};
  const ml = lenPt(st.marginLeft), ti = lenPt(st.textIndent), mr = lenPt(st.marginRight);
  if (ml || ti || mr) {
    const a = [];
    if (ml) a.push(`w:left="${twip(ml)}"`);
    if (mr > 0) a.push(`w:right="${twip(mr)}"`);
    if (ti) a.push(ti < 0 ? `w:hanging="${twip(-ti)}"` : `w:firstLine="${twip(ti)}"`);
    if (a.length) p.push(`<w:ind ${a.join(' ')}/>`);
  }
  const mt = lenPt(st.marginTop), mb = lenPt(st.marginBottom);
  if (mt || mb) p.push(`<w:spacing${mt ? ` w:before="${twip(mt)}"` : ''}${mb ? ` w:after="${twip(mb)}"` : ''}/>`);
  const jc = JC[(st.textAlign || '').toLowerCase()];
  if (jc && jc !== 'left') p.push(`<w:jc w:val="${jc}"/>`);
  return p.length ? `<w:pPr>${p.join('')}</w:pPr>` : '';
}
function paraXml(el, ctx, style, extra) {
  const base = inlineOf(el, {});
  delete base.link;
  const runs = runsOf(el, base, ctx);
  return `<w:p>${pPr(el, style, extra)}${runs}</w:p>`;
}
/*
 * GERÇEK WORD LİSTESİ (v8.8). Eskiden UL/OL yalnız ListParagraph stiline düşüyordu: madde imi /
 * numara Word'de HİÇ görünmüyordu. Artık numbering.xml yazılır ve her madde w:numPr taşır —
 * numId 1 madde imi (•), 2 numaralı; iç içe listelerde düzey (ilvl) 0-2 arasında derinlikten gelir.
 * LI içindeki alt liste HTML'de iki biçimde gelir (li > ul ya da ul > ul); ikisi de gezilir.
 */
function listXml(el, ctx, lvl) {
  const numId = el.tagName === 'OL' ? 2 : 1;
  let x = '';
  for (const ch of el.children) {
    if (ch.tagName === 'UL' || ch.tagName === 'OL') { x += listXml(ch, ctx, Math.min(2, lvl + 1)); continue; }
    if (ch.tagName !== 'LI') continue;
    const ic = [...ch.children].filter(c => c.tagName === 'UL' || c.tagName === 'OL');
    if (ic.length) {
      // maddenin kendi metni (alt liste düğümleri sayılmadan) + altındaki listeler
      const kopya = ch.cloneNode(true);
      for (const k of [...kopya.children]) if (k.tagName === 'UL' || k.tagName === 'OL') kopya.removeChild(k);
      x += paraXml(kopya, ctx, 'ListParagraph', `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
      for (const alt of ic) x += listXml(alt, ctx, Math.min(2, lvl + 1));
    } else {
      x += paraXml(ch, ctx, 'ListParagraph', `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${numId}"/></w:numPr>`);
    }
  }
  return x;
}
function tableXml(tbl, ctx) {
  const rows = [...tbl.querySelectorAll(':scope > tbody > tr, :scope > tr, :scope > thead > tr')];
  if (!rows.length) return '';
  const cols = [...tbl.querySelectorAll(':scope > colgroup > col')].map(c => lenPt(c.style.width) || 0);
  let cells = 0; for (const r of rows) cells = Math.max(cells, [...r.children].reduce((n, c) => n + (+c.getAttribute('colspan') || 1), 0));
  const grid = [];
  for (let i = 0; i < cells; i++) grid.push(twip(cols[i] || (450 / Math.max(1, cells))));
  let x = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>`
    + `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/>`
    + `<w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/>`
    + `<w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr>`
    + `<w:tblGrid>${grid.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  for (const tr of rows) {
    x += '<w:tr>';
    for (const td of [...tr.children]) {
      if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
      const cs = +td.getAttribute('colspan') || 1, rs = +td.getAttribute('rowspan') || 1;
      const pr = `<w:tcPr>${cs > 1 ? `<w:gridSpan w:val="${cs}"/>` : ''}${rs > 1 ? '<w:vMerge w:val="restart"/>' : ''}</w:tcPr>`;
      const inner = blocksXml(td, ctx) || '<w:p/>';
      x += `<w:tc>${pr}${inner}</w:tc>`;
    }
    x += '</w:tr>';
  }
  return x + '</w:tbl>';
}
/** Bir kapsayıcının blok çocuklarını OOXML'e çevirir */
function blocksXml(root, ctx) {
  let x = '';
  for (const el of root.children) {
    const tag = el.tagName;
    if (tag === 'TABLE') { x += tableXml(el, ctx); continue; }
    if (el.classList && el.classList.contains('pagebreak')) { x += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; continue; }
    if (tag === 'UL' || tag === 'OL') { x += listXml(el, ctx, 0); continue; }
    if (el.querySelector && el.querySelector('ul, ol')) {
      // execCommand listeyi paragrafın İÇİNE koyabilir (<p><ul>…</ul></p>). Liste dışı kalan satır içi
      // içerik kendi paragrafı olarak, içteki listeler gerçek Word listesi (numPr) olarak yazılır.
      const kopya = el.cloneNode(true);
      for (const l of [...kopya.querySelectorAll('ul, ol')]) l.remove();
      if (kopya.textContent.trim() || kopya.querySelector('img')) x += paraXml(kopya, ctx, /^H[1-6]$/.test(tag) ? 'Heading' + tag[1] : null);
      const disKatman = (l) => { let a = l.parentElement; while (a && a !== el) { if (a.tagName === 'UL' || a.tagName === 'OL' || a.tagName === 'LI') return false; a = a.parentElement; } return true; };
      for (const l of [...el.querySelectorAll('ul, ol')].filter(disKatman)) x += listXml(l, ctx, 0);
      continue;
    }
    if (/^H[1-6]$/.test(tag)) { x += paraXml(el, ctx, 'Heading' + tag[1]); continue; }
    if (tag === 'DIV' && el.children.length && [...el.children].some(c => BLOCK.has(c.tagName))) { x += blocksXml(el, ctx); continue; }
    if (tag === 'BR') { x += '<w:p/>'; continue; }
    x += paraXml(el, ctx, null);
  }
  // kapsayıcının doğrudan altındaki çıplak metin (contenteditable bazen üretir)
  const bare = [...root.childNodes].filter(n => n.nodeType === 3 && n.nodeValue.trim()).map(n => n.nodeValue.trim());
  for (const s of bare) x += `<w:p>${textRun({}, s)}</w:p>`;
  return x;
}

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const HEAD_SZ = [32, 26, 24, 22, 20, 18];
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="tr-TR"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
  + HEAD_SZ.map((sz, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${i}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="1F3B6E"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`).join('')
  + `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>`
  + `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`;
/*
 * Liste tanımları: abstractNum 0 = madde imi (üç düzey: • ◦ ▪), abstractNum 1 = numaralı
 * (1. / a. / i.). Girintiler Word'ün kendi varsayılanıyla aynı merdivendedir (720 twip/düzey).
 * Parça listede madde olmasa da pakete girer: Word kullanılmayan numbering'i sorun etmez ve
 * paket listesi böylece belgeden belgeye değişmez (sınamalar tam eşitlikle bakar).
 */
const NUM_LVL = (i, fmt, txt, font) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${txt}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
  + `<w:abstractNum w:abstractNumId="0">${NUM_LVL(0, 'bullet', '&#8226;')}${NUM_LVL(1, 'bullet', 'o', 'Courier New')}${NUM_LVL(2, 'bullet', '&#9642;')}</w:abstractNum>`
  + `<w:abstractNum w:abstractNumId="1">${NUM_LVL(0, 'decimal', '%1.')}${NUM_LVL(1, 'lowerLetter', '%2.')}${NUM_LVL(2, 'lowerRoman', '%3.')}</w:abstractNum>`
  + `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

/**
 * Düzenlenmiş kapsayıcıyı DOCX paketine çevirir.
 * root: blokları taşıyan öğe. page: {width,height,margins} punto (yoksa A4).
 */
export async function htmlToDocx(root, page) {
  const media = [], links = new Map();
  let relN = 1, idN = 1;
  const ctx = {
    nextId: () => ++idN,
    rel: (url) => { if (links.has(url)) return links.get(url); const id = 'rId' + (++relN + 10); links.set(url, id); return id; },
    media: (bytes, ext) => { const n = media.length + 1, name = `image${n}.${ext}`, id = 'rId' + (++relN + 10); media.push({ name, bytes, id }); return { rid: id, name }; },
  };
  const body = blocksXml(root, ctx) || '<w:p/>';
  const p = page || { width: 595, height: 842, margins: { top: 72, right: 72, bottom: 72, left: 72 } };
  const m = p.margins || { top: 72, right: 72, bottom: 72, left: 72 };
  const sect = `<w:sectPr><w:pgSz w:w="${twip(p.width)}" w:h="${twip(p.height)}"/>`
    + `<w:pgMar w:top="${twip(m.top)}" w:right="${twip(m.right)}" w:bottom="${twip(m.bottom)}" w:left="${twip(m.left)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${sect}</w:body></w:document>`;
  const relItems = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`];
  for (const [url, id] of links) relItems.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xesc(url)}" TargetMode="External"/>`);
  for (const im of media) relItems.push(`<Relationship Id="${im.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.name}"/>`);
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relItems.join('')}</Relationships>`;
  const entries = [
    { name: '[Content_Types].xml', data: enc.encode(CT) },
    { name: '_rels/.rels', data: enc.encode(RELS) },
    { name: 'word/document.xml', data: enc.encode(doc) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    { name: 'word/styles.xml', data: enc.encode(STYLES) },
    { name: 'word/numbering.xml', data: enc.encode(NUMBERING) },
    ...media.map(im => ({ name: 'word/media/' + im.name, data: im.bytes })),
  ];
  return zipWrite(entries);
}

// ---------------------------------------------------------------------------------
// Düzenleme yüzeyi
// ---------------------------------------------------------------------------------
/** Kapsayıcıyı düzenlenebilir yapar; dönen nesne komutları ve durumu taşır */
export function mountEditor(root, opts = {}) {
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('spellcheck', 'false');
  root.classList.add('doc-editing');
  let dirty = false;
  const onInput = () => { if (!dirty) { dirty = true; opts.onDirty && opts.onDirty(); } };
  root.addEventListener('input', onInput);
  // yapıştırmada biçim değil düz metin al: yabancı HTML belgeye sızmasın
  const onPaste = (ev) => {
    ev.preventDefault();
    const txt = (ev.clipboardData || window.clipboardData).getData('text/plain');
    if (txt) document.execCommand('insertText', false, txt);
  };
  root.addEventListener('paste', onPaste);
  const cmd = (name, val) => { root.focus(); try { document.execCommand(name, false, val); } catch (_) { /* desteklenmiyor */ } onInput(); };
  return {
    cmd,
    get dirty() { return dirty; },
    unmount() {
      root.removeEventListener('input', onInput); root.removeEventListener('paste', onPaste);
      root.removeAttribute('contenteditable'); root.removeAttribute('spellcheck'); root.classList.remove('doc-editing');
    },
  };
}

/** Bul ve değiştir: metin düğümlerinde arar, biçimi bozmadan değiştirir. Dönen sayı değiştirilen adet. */
export function replaceAll(root, find, repl, matchCase) {
  if (!find) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const hits = []; let n;
  const needle = matchCase ? find : find.toLocaleLowerCase('tr');
  while ((n = walker.nextNode())) {
    const hay = matchCase ? n.nodeValue : n.nodeValue.toLocaleLowerCase('tr');
    if (hay.includes(needle)) hits.push(n);
  }
  let count = 0;
  for (const node of hits) {
    let s = node.nodeValue, out = '', i = 0;
    for (;;) {
      const hay = matchCase ? s : s.toLocaleLowerCase('tr');
      const j = hay.indexOf(needle, i);
      if (j < 0) { out += s.slice(i); break; }
      out += s.slice(i, j) + repl; i = j + find.length; count++;
    }
    node.nodeValue = out;
  }
  return count;
}
