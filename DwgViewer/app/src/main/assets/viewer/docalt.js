/*
 * ".doc" uzantısıyla dolaşan öteki biçimler — kamu sistemlerinin (EKAP vb.) "Word'e aktar" çıktıları çoğu zaman OLE değildir:
 *  - RTF ({\rtf1 …): rtfToHtml — kendi çözümleyicimiz (gruplar, denetim sözcükleri, \ansicpg kod sayfası, \'hh ve \uN,
 *    karakter / paragraf biçimi, renk tablosu, listeler (\listtext / \pntext), tablolar (\trowd \cellx \cell \row),
 *    alanlar (HYPERLINK), resimler (\pict \jpegblip \pngblip), sayfa boyutu (\paperw …), sayfa sonu).
 *  - Word HTML (<html … class="MsoNormal">) ve MHTML (MIME çok parçalı web arşivi): htmlToParts — DOMParser ile
 *    temizlenir (script / style / iframe / olay öznitelikleri atılır, satır içi stil korunur), @page kuralından sayfa boyutu,
 *    MHTML'deki resimler cid: / Content-Location ile data: URL'ye bağlanır.
 *  Hepsi docs.js docxToHtml ile aynı şekli döner: { parts, html, width, page, warnings }.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = (v) => Math.round(v * 10) / 10;
const A4 = () => ({ width: 595, height: 842, margins: { top: 72, right: 72, bottom: 72, left: 72 } });
const NBSP = String.fromCharCode(160), BOM = String.fromCharCode(0xFEFF), NUL = String.fromCharCode(0);
const latin1 = new TextDecoder('latin1');
const head = (u8, n) => latin1.decode(u8.subarray(0, Math.min(n, u8.length)));
/** İlk baytlardan biçim: ole | zip | rtf | mhtml | html | text | unknown */
export function sniffDoc(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length >= 8 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) return 'ole';
  if (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4B && (u8[2] === 3 || u8[2] === 5 || u8[2] === 7)) return 'zip';
  let s = head(u8, 4096);
  if ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF)) s = new TextDecoder(u8[0] === 0xFF ? 'utf-16le' : 'utf-16be').decode(u8.subarray(0, Math.min(8192, u8.length)));
  const t = s.split(BOM).join('').split(NUL).join('').replace(/^\s+/, '');
  if (/^\{\\rtf/i.test(t)) return 'rtf';
  if (/^(MIME-Version:|From:|Subject:|Content-Type:\s*multipart)/i.test(t) && /multipart|boundary=/i.test(t)) return 'mhtml';
  if (/^<(!doctype|html|\?xml|head|body|meta|div|p|table|font|span|title|h\d)\b/i.test(t) || /<html[\s>]/i.test(t) || /<body[\s>]/i.test(t)) return 'html';
  let printable = 0; const n = Math.min(u8.length, 2048); for (let i = 0; i < n; i++) { const c = u8[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) printable++; }
  return n && printable / n > 0.95 ? 'text' : 'unknown';
}
export const sniffHint = (buf) => { const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return Array.from(u8.subarray(0, 8), b => (b < 16 ? '0' : '') + b.toString(16).toUpperCase()).join(' '); };

// ---------------------------------------------------------------------------------
// RTF
// ---------------------------------------------------------------------------------
const CP_OF = { 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 65001: 'utf-8' };
const decoderFor = (cp) => { try { return new TextDecoder(CP_OF[cp] || 'windows-1252'); } catch (_) { return new TextDecoder('windows-1252'); } };
const SKIP_DEST = new Set(['fonttbl', 'stylesheet', 'info', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'xe', 'tc', 'generator', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'rsidtbl', 'mmathPr', 'pgdsctbl', 'listtable', 'listoverridetable', 'revtbl', 'protusertbl', 'object', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'wgrffmtfilter', 'pnseclvl', 'background', 'shp', 'shpinst', 'shprslt', 'docvar', 'userprops', 'passwordhash', 'bkmkstart', 'bkmkend', 'atnid', 'atnauthor', 'annotation', 'template', 'company', 'operator', 'title', 'subject', 'author', 'keywords', 'doccomm', 'sp', 'sn', 'sv', 'nonshppict', 'panose', 'falt', 'fname', 'nesttableprops', 'txe', 'vern', 'footnote']);
/** RTF (ArrayBuffer / Uint8Array) → HTML parçaları */
export function rtfToHtml(buf, opts = {}) {
  const tt = typeof opts.tt === 'function' ? opts.tt : (k, tr) => tr;
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const warnings = [], warn = (s) => { if (s && !warnings.includes(s)) warnings.push(s); };
  const m = /\\ansicpg(\d+)/.exec(head(u8, 512)); const cp = m ? +m[1] : 1252;
  const dec = decoderFor(cp), src = dec.decode(u8);
  const byteTbl = []; for (let i = 0; i < 256; i++) byteTbl.push(dec.decode(new Uint8Array([i])));   // \'hh → kod sayfası
  const colors = [];   // renk tablosu: ilk (boş) giriş otomatik renk → \cf0
  const page = { width: 612, height: 792, margins: { top: 72, right: 90, bottom: 72, left: 90 } };
  const CH0 = () => ({ b: 0, i: 0, ul: 0, strike: 0, fs: 24, cf: 0, sup: 0, sub: 0, caps: 0, v: 0 });
  const PA0 = () => ({ jc: 'left', li: 0, fi: 0, ri: 0, sb: 0, sa: 0, intbl: 0, pbb: 0 });
  // durum yığını: her grup karakter / paragraf biçimini ve hedef (destination) bilgisini kopyalar
  let ch = CH0(), pa = PA0(), uc = 1, skipN = 0;
  const stack = [];
  let dest = null;          // etkin hedef: 'skip' | 'colortbl' | 'pict' | 'fldinst' | 'fldrslt' | 'listtext' | null
  let starNext = false;     // \* gördük: sonraki denetim sözcüğü hedef adı
  // çıktı
  const parts = [];
  let seg = '', key = '', segStyle = '', html = '', prefix = '';   // geçerli paragraf
  const rows = []; let row = null, cellBuf = [], cellx = [], curRowCellx = [];
  const fld = { inst: '', rslt: '', depth: 0, on: false };
  const pict = { hex: '', type: '', w: 0 };
  const ltext = { txt: '' };
  const ctbl = { r: 0, g: 0, b: 0, any: false };
  const styleOf = (c) => { const st = []; if (c.b) st.push('font-weight:700'); if (c.i) st.push('font-style:italic'); const d = []; if (c.ul) d.push('underline'); if (c.strike) d.push('line-through'); if (d.length) st.push('text-decoration:' + d.join(' ')); if (c.cf > 0 && colors[c.cf]) st.push('color:' + colors[c.cf]); if (c.fs > 0) st.push('font-size:' + (c.fs / 2) + 'pt'); if (c.caps) st.push('text-transform:uppercase'); return st.join(';'); };
  const inFld = () => fld.on && dest !== 'fldinst';
  const flush = () => { if (!seg) return; let h = esc(seg); if (ch.sup) h = '<sup>' + h + '</sup>'; else if (ch.sub) h = '<sub>' + h + '</sub>'; h = segStyle ? `<span style="${segStyle}">${h}</span>` : h; if (inFld()) fld.rslt += h; else html += h; seg = ''; };
  const put = (h) => { flush(); if (inFld()) fld.rslt += h; else html += h; };
  const text = (s) => { if (!s) return; if (dest === 'listtext') { ltext.txt += s; return; } if (dest === 'fldinst') { fld.inst += s; return; } if (dest === 'pict' || dest === 'skip' || dest === 'colortbl') return; if (ch.v) return; const k = styleOf(ch) + (ch.sup ? '^' : ch.sub ? '_' : ''); if (k !== key) { flush(); key = k; segStyle = styleOf(ch); } seg += s; };
  const flushTable = () => {
    if (!rows.length) return;
    const grid = [0]; for (const r of rows) for (const x of r.xs) if (x != null && !grid.some(g => Math.abs(g - x) <= 10)) grid.push(x);
    grid.sort((a, b) => a - b); const gi = (x) => { for (let i = 0; i < grid.length; i++) if (Math.abs(grid[i] - x) <= 10) return i; return -1; };
    let h = '<table class="docx-tbl">';
    if (grid.length > 1) { h += '<colgroup>'; for (let i = 1; i < grid.length; i++) h += `<col style="width:${r1((grid[i] - grid[i - 1]) / 20)}pt">`; h += '</colgroup>'; }
    for (const r of rows) { h += '<tr>'; let prev = 0; for (let c = 0; c < r.cells.length; c++) { const x = r.xs[c]; let span = 1; if (x != null) { const a = gi(prev), b = gi(x); if (a >= 0 && b > a) span = b - a; prev = x; } h += `<td${span > 1 ? ` colspan="${span}"` : ''}>${r.cells[c] || '&nbsp;'}</td>`; } h += '</tr>'; }
    parts.push(h + '</table>'); rows.length = 0;
  };
  const endPara = (force) => {
    flush();
    if (!html && !prefix && !force) return;
    const st = []; if (pa.jc !== 'left') st.push('text-align:' + pa.jc); if (pa.li) st.push('margin-left:' + r1(pa.li / 20) + 'pt'); if (pa.fi && !prefix) st.push('text-indent:' + r1(pa.fi / 20) + 'pt'); if (pa.ri > 0) st.push('margin-right:' + r1(pa.ri / 20) + 'pt'); if (pa.sb) st.push('margin-top:' + r1(pa.sb / 20) + 'pt'); if (pa.sa) st.push('margin-bottom:' + r1(pa.sa / 20) + 'pt');
    const p = (pa.pbb ? '<div class="pagebreak"></div>' : '') + `<p${prefix ? ' class="li"' : ''}${st.length ? ` style="${st.join(';')}"` : ''}>${prefix ? `<span class="bul">${esc(prefix.trim())}</span>` : ''}${html || '&nbsp;'}</p>`;
    if (pa.intbl) cellBuf.push(p); else { flushTable(); parts.push(p); }
    html = ''; prefix = ''; pa.pbb = 0;
  };
  const endCell = () => { flush(); pa.intbl = 1; if (html || prefix) endPara(true); if (!row) row = { cells: [], xs: [] }; const k = row.cells.length; row.cells.push(cellBuf.join('')); row.xs.push(curRowCellx[k] != null ? curRowCellx[k] : null); cellBuf = []; };
  const endRow = () => { if (cellBuf.length || html) endCell(); if (row && row.cells.length) rows.push(row); row = null; cellBuf = []; };
  const endField = () => { const inst = fld.inst.trim(); let out = fld.rslt; const m2 = /^HYPERLINK\s+"?([^"\s]+)"?/i.exec(inst); if (m2 && /^(https?|ftp|mailto):/i.test(m2[1]) && out) out = `<a href="${esc(m2[1])}" target="_blank" rel="noopener">${out}</a>`; fld.on = false; fld.inst = ''; fld.rslt = ''; html += out; };
  const endPict = () => {
    let h = `<span class="muted">${esc(tt('docPicture', '[Resim]'))}</span>`;
    if ((pict.type === 'jpeg' || pict.type === 'png') && pict.hex.length > 16) {
      const hx = pict.hex, bytes = new Uint8Array(hx.length >> 1); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hx.substr(2 * i, 2), 16);
      let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
      h = `<img src="data:image/${pict.type};base64,${btoa(s)}" alt=""${pict.w > 0 ? ` style="width:${r1(pict.w / 20)}pt;max-width:100%"` : ''}>`;
    } else warn(tt('docPicOmitted', 'Bazı resimler gösterilemedi (WMF / EMF / TIFF ya da bozuk veri)'));
    pict.hex = ''; pict.type = ''; pict.w = 0; put(h);
  };
  // --- denetim sözcükleri ---
  const ctrl = (w, n, hasN) => {
    if (starNext) { starNext = false; if (!['fldinst', 'listtext', 'pntext', 'shppict'].includes(w)) { dest = 'skip'; return; } }
    if (dest === 'skip') return;
    if (dest === 'colortbl') { if (w === 'red') ctbl.r = n; else if (w === 'green') ctbl.g = n; else if (w === 'blue') ctbl.b = n; ctbl.any = true; return; }
    if (dest === 'pict') { if (w === 'jpegblip') pict.type = 'jpeg'; else if (w === 'pngblip') pict.type = 'png'; else if (w === 'picwgoal') pict.w = n; return; }
    switch (w) {
      case 'uc': uc = n; break;
      case 'u': { let code = n; if (code < 0) code += 65536; text(String.fromCharCode(code)); skipN = uc; break; }
      case 'colortbl': dest = 'colortbl'; break;
      case 'pict': dest = 'pict'; pict.hex = ''; pict.type = ''; pict.w = 0; break;
      case 'field': fld.on = true; fld.inst = ''; fld.rslt = ''; fld.depth = stack.length; break;
      case 'fldinst': dest = 'fldinst'; break;
      case 'fldrslt': dest = 'fldrslt'; break;
      case 'listtext': case 'pntext': dest = 'listtext'; ltext.txt = ''; break;
      case 'par': endPara(true); break;
      case 'sect': case 'sectd': endPara(false); break;
      case 'page': endPara(false); put('<div class="pagebreak"></div>'); break;
      case 'pagebb': pa.pbb = 1; break;
      case 'line': if (dest === 'listtext') ltext.txt += ' '; else put('<br>'); break;
      case 'tab': if (dest === 'listtext') ltext.txt += ' '; else if (dest === 'fldinst') fld.inst += ' '; else put('<span class="tab"></span>'); break;
      case 'emdash': text('—'); break; case 'endash': text('–'); break; case 'bullet': text('•'); break; case 'lquote': text('‘'); break; case 'rquote': text('’'); break; case 'ldblquote': text('“'); break; case 'rdblquote': text('”'); break; case 'emspace': case 'enspace': case 'qmspace': text(' '); break;
      case 'pard': pa = PA0(); break;
      case 'plain': ch = CH0(); break;
      case 'b': ch.b = hasN ? (n ? 1 : 0) : 1; break; case 'i': ch.i = hasN ? (n ? 1 : 0) : 1; break; case 'ul': case 'uld': case 'uldb': case 'ulw': ch.ul = hasN ? (n ? 1 : 0) : 1; break; case 'ulnone': ch.ul = 0; break;
      case 'strike': case 'striked': ch.strike = hasN ? (n ? 1 : 0) : 1; break; case 'caps': ch.caps = hasN ? (n ? 1 : 0) : 1; break; case 'v': ch.v = hasN ? (n ? 1 : 0) : 1; break;
      case 'fs': ch.fs = n; break; case 'cf': ch.cf = n; break; case 'super': ch.sup = 1; ch.sub = 0; break; case 'sub': ch.sub = 1; ch.sup = 0; break; case 'nosupersub': ch.sup = ch.sub = 0; break;
      case 'ql': pa.jc = 'left'; break; case 'qc': pa.jc = 'center'; break; case 'qr': pa.jc = 'right'; break; case 'qj': pa.jc = 'justify'; break;
      case 'li': pa.li = n; break; case 'fi': pa.fi = n; break; case 'ri': pa.ri = n; break; case 'sb': pa.sb = n; break; case 'sa': pa.sa = n; break;
      case 'intbl': pa.intbl = 1; break; case 'trowd': cellx = []; curRowCellx = cellx; break; case 'cellx': cellx.push(n); break;
      case 'cell': endCell(); break; case 'row': endRow(); break; case 'nestcell': text(' | '); break; case 'nestrow': put('<br>'); break;
      case 'paperw': page.width = n / 20; break; case 'paperh': page.height = n / 20; break; case 'margl': page.margins.left = n / 20; break; case 'margr': page.margins.right = n / 20; break; case 'margt': page.margins.top = n / 20; break; case 'margb': page.margins.bottom = n / 20; break;
      case 'landscape': if (page.width < page.height) [page.width, page.height] = [page.height, page.width]; break;
      default: if (SKIP_DEST.has(w)) dest = 'skip';
    }
  };
  // --- tarayıcı ---
  const n = src.length; let i = 0; const t0 = performance.now();
  while (i < n) {
    const c = src[i];
    if (c === '{') { stack.push({ ch: { ...ch }, pa: { ...pa }, dest, uc }); i++; continue; }
    if (c === '}') {
      const s = stack.pop(); if (!s) { i++; continue; }
      const leaving = dest;
      if (leaving === 'pict' && s.dest !== 'pict') endPict();
      if (leaving === 'listtext' && s.dest !== 'listtext') { prefix = ltext.txt; ltext.txt = ''; }
      flush();
      if (fld.on && stack.length < fld.depth) { dest = s.dest; endField(); }   // alanın kendi grubu kapandı (iç gruplar değil)
      ch = s.ch; pa = { ...s.pa, intbl: pa.intbl }; dest = s.dest; uc = s.uc; key = ''; segStyle = '';
      i++; continue;
    }
    if (c === '\\') {
      const d = src[i + 1];
      if (d === "'") { const hx = src.substr(i + 2, 2); i += 4; if (skipN > 0) { skipN--; continue; } const v = parseInt(hx, 16); if (dest === 'pict') pict.hex += hx; else if (dest !== 'colortbl' && !isNaN(v)) text(byteTbl[v]); continue; }
      if (d === '*') { starNext = true; i += 2; continue; }
      if (d === '~') { text(NBSP); i += 2; continue; } if (d === '-' || d === '_') { i += 2; continue; }
      if (d === '{' || d === '}' || d === '\\') { text(d); i += 2; continue; }
      if (d === '\n' || d === '\r') { ctrl('par', 0, false); i += 2; continue; }
      const m2 = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(src.substr(i, 40));
      if (!m2) { i += 2; continue; }
      i += m2[0].length; const w = m2[1], hasN = m2[2] != null, nn = hasN ? +m2[2] : (w === 'uc' ? 1 : 0);
      if (skipN > 0 && w !== 'u') skipN = 0;
      ctrl(w, nn, hasN);
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (dest === 'pict') { if (/[0-9a-fA-F]/.test(c)) pict.hex += c; i++; continue; }
    if (dest === 'colortbl') { if (c === ';') { colors.push(ctbl.any ? '#' + [ctbl.r, ctbl.g, ctbl.b].map(v => (v < 16 ? '0' : '') + (v & 255).toString(16).toUpperCase()).join('') : null); ctbl.r = ctbl.g = ctbl.b = 0; ctbl.any = false; } i++; continue; }
    if (skipN > 0) { skipN--; i++; continue; }
    let j = i + 1; while (j < n && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++;   // düz metin parçası
    text(src.slice(i, j)); i = j;
    if (performance.now() - t0 > 20000) { warn('RTF: süre aşıldı, belge kısaltıldı'); break; }
  }
  if (fld.on) { flush(); endField(); }
  endRow(); endPara(false); flushTable();
  if (!(page.width >= 100 && page.width <= 2000)) page.width = 612; if (!(page.height >= 100 && page.height <= 2000)) page.height = 792;
  for (const k of ['top', 'right', 'bottom', 'left']) if (!(page.margins[k] >= 0 && page.margins[k] <= 400)) page.margins[k] = 72;
  return { parts, html: parts.join(''), width: page.width + 'pt', page, warnings };
}

// ---------------------------------------------------------------------------------
// HTML / MHTML (Word "Web sayfası" ve "tek dosyalı web arşivi" çıktıları)
// ---------------------------------------------------------------------------------
const LEN_PT = (s) => { const m = /^\s*(-?[\d.]+)\s*(pt|px|cm|mm|in|pc)?\s*$/i.exec(String(s || '')); if (!m) return NaN; const v = +m[1], u = (m[2] || 'pt').toLowerCase(); return u === 'px' ? v * 0.75 : u === 'cm' ? v * 28.3465 : u === 'mm' ? v * 2.83465 : u === 'in' ? v * 72 : u === 'pc' ? v * 12 : v; };
/** HTML metnindeki @page kuralından sayfa boyutu ve kenar boşlukları */
function pageFromCss(css) {
  const page = A4(); const m = /@page\s*[\w-]*\s*\{([^}]*)\}/i.exec(css || ''); if (!m) return { page, found: false };
  const body = m[1]; const size = /size\s*:\s*([^;]+)/i.exec(body), mar = /margin\s*:\s*([^;]+)/i.exec(body);
  if (size) { const v = size[1].trim().split(/\s+/).map(LEN_PT); if (v.length >= 2 && v[0] > 100 && v[1] > 100) { page.width = r1(v[0]); page.height = r1(v[1]); } else if (/a4/i.test(size[1])) { page.width = 595.3; page.height = 841.9; } else if (/letter/i.test(size[1])) { page.width = 612; page.height = 792; } }
  if (mar) { const v = mar[1].trim().split(/\s+/).map(LEN_PT).filter(x => !isNaN(x)); if (v.length) { const [t, r, b, l] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v; page.margins = { top: r1(t), right: r1(r), bottom: r1(b), left: r1(l) }; } }
  return { page, found: true };
}
/** Bayt dizisi → metin: BOM / UTF-16, <meta charset>, yoksa UTF-8 (katı) → windows-1254 */
export function decodeHtmlBytes(u8, hint) {
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  const h = head(u8, 4096); const m = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(h); let cs = (hint || (m ? m[1] : '') || '').toLowerCase().replace(/^windows-?/, 'windows-').replace(/^cp/, 'windows-');
  if (cs === 'iso-8859-9') cs = 'windows-1254';
  if (cs && cs !== 'utf-8' && cs !== 'utf8') { try { return new TextDecoder(cs).decode(u8); } catch (_) { /* tanınmayan */ } }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (_) { return new TextDecoder('windows-1254').decode(u8); }
}
const DROP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'IFRAME', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'NOSCRIPT', 'TITLE', 'HEAD', 'BASE', 'FRAME', 'FRAMESET', 'SVG', 'MATH', 'TEMPLATE', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'MAP', 'AREA']);
/**
 * HTML → temizlenmiş parçalar (tarayıcıda DOMParser gerekir). resolve(src): resim adresi → data: URL ya da '' (MHTML parçaları)
 * Güvenlik: script / style / iframe / form … atılır, on* öznitelikleri ve javascript: adresleri silinir, satır içi stil yalnız
 * konumlandırma dışı özelliklerle korunur, dış bağlantılar target=_blank.
 */
export function htmlToParts(htmlText, opts = {}) {
  const tt = typeof opts.tt === 'function' ? opts.tt : (k, tr) => tr, resolve = opts.resolve || null;
  const warnings = [], warn = (s) => { if (s && !warnings.includes(s)) warnings.push(s); };
  if (typeof DOMParser !== 'function') throw new Error('DOMParser yok');
  const css = (htmlText.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
  const { page, found } = pageFromCss(css);
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const body = doc.body; if (!body) throw new Error(tt('docNotWord', 'Word belgesi değil'));
  const picPh = () => { const s = doc.createElement('span'); s.className = 'muted'; s.textContent = tt('docPicture', '[Resim]'); return s; };
  const walk = (el) => {
    for (const c of [...el.children]) {
      if (DROP.has(c.tagName) || /^O:P$/i.test(c.tagName) && !c.textContent.trim()) { c.remove(); continue; }
      for (const a of [...c.attributes]) {
        const nm = a.name.toLowerCase(), v = a.value;
        if (nm.startsWith('on') || nm === 'id' || nm === 'name' || nm === 'lang' || nm === 'xmlns' || nm.includes(':')) { c.removeAttribute(a.name); continue; }
        if ((nm === 'href' || nm === 'src' || nm === 'background' || nm === 'action' || nm === 'formaction' || nm === 'xlink:href') && /^\s*(javascript|vbscript|data:text)/i.test(v)) { c.removeAttribute(a.name); continue; }
        if (nm === 'style') { const kept = v.split(';').filter(d => !/^\s*(position|z-index|top|left|right|bottom|mso-[\w-]+|behavior|expression|filter|clip|cursor|pointer-events|visibility)\s*:/i.test(d) && !/url\s*\(/i.test(d)).join(';'); if (kept.trim()) c.setAttribute('style', kept); else c.removeAttribute('style'); }
      }
      if (c.tagName === 'IMG') { const src = c.getAttribute('src') || ''; let ok = /^data:image\//i.test(src); if (!ok && resolve) { const r = resolve(src); if (r) { c.setAttribute('src', r); ok = true; } } if (!ok && /^https?:\/\//i.test(src)) ok = true; if (!ok) { c.replaceWith(picPh()); warn(tt('docPicOmitted', 'Bazı resimler gösterilemedi (WMF / EMF / TIFF ya da bozuk veri)')); continue; } c.removeAttribute('width'); c.style.maxWidth = '100%'; if (c.getAttribute('height') && !c.style.width) c.removeAttribute('height'); }
      if (c.tagName === 'A') { const href = c.getAttribute('href') || ''; if (/^(https?|ftp|mailto):/i.test(href)) { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); } else c.removeAttribute('href'); }
      if (c.tagName === 'TABLE') c.classList.add('docx-tbl');
      if (c.tagName === 'BR' && c.getAttribute('clear') === 'all' && /page-break-before\s*:\s*always/i.test(c.getAttribute('style') || '')) { const d = doc.createElement('div'); d.className = 'pagebreak'; c.replaceWith(d); continue; }
      if (/page-break-before\s*:\s*always/i.test(c.getAttribute('style') || '')) { const d = doc.createElement('div'); d.className = 'pagebreak'; c.before(d); }
      walk(c);
    }
  };
  walk(body);
  // Word HTML gövdesi: <div class="WordSection1"> sarmalayıcıları açılır; üst düzey bloklar parça olur
  const unwrap = (el) => { const out = []; for (const c of [...el.childNodes]) { if (c.nodeType === 3) { if (c.textContent.trim()) { const p = doc.createElement('p'); p.textContent = c.textContent; out.push(p.outerHTML); } continue; } if (c.nodeType !== 1) continue; if (c.tagName === 'DIV' && !(c.getAttribute('style') || '').trim() && !c.classList.contains('pagebreak')) { out.push(...unwrap(c)); continue; } out.push(c.outerHTML); } return out; };
  const parts = unwrap(body);
  if (!found) warn(tt('docHtmlNoPage', 'Sayfa boyutu belgede yok; A4 varsayıldı'));
  return { parts, html: parts.join(''), width: page.width + 'pt', page, warnings };
}
/** Quoted-printable / base64 gövde çözümü */
function decodeBody(s, enc) {
  enc = (enc || '').toLowerCase();
  if (enc === 'base64') { const clean = s.replace(/[^A-Za-z0-9+/=]/g, ''); try { const bin = atob(clean); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; } catch (_) { return new Uint8Array(0); } }
  if (enc === 'quoted-printable') { const t = s.replace(/=\r?\n/g, ''); const out = []; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c === 61 && i + 2 < t.length && /[0-9A-Fa-f]{2}/.test(t.substr(i + 1, 2))) { out.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; } else out.push(c & 255); } return Uint8Array.from(out); }
  const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255; return out;
}
/** MHTML → { html (metin), resolve(src) } — ilk text/html parça belge, ötekiler cid: / Content-Location ile resim */
export function mhtmlParts(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), all = latin1.decode(u8);
  const hdrEnd = all.search(/\r?\n\r?\n/); const top = hdrEnd >= 0 ? all.slice(0, hdrEnd) : all;
  const bm = /boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(top); const boundary = bm ? bm[1].trim() : null;
  const parts = boundary ? all.split('--' + boundary).slice(1).filter(p => !/^--/.test(p.trim())) : [all];
  let html = null; const files = new Map();
  for (const raw of parts) {
    const p = raw.replace(/^\r?\n/, ''); const he = p.search(/\r?\n\r?\n/); if (he < 0) continue;
    const hdr = p.slice(0, he).replace(/\r?\n[ \t]+/g, ' '), body = p.slice(he).replace(/^\r?\n\r?\n/, '');
    const ct = (/Content-Type:\s*([^;\r\n]+)/i.exec(hdr) || [])[1] || '', cs = (/charset\s*=\s*"?([\w-]+)/i.exec(hdr) || [])[1] || '';
    const enc = (/Content-Transfer-Encoding:\s*([\w-]+)/i.exec(hdr) || [])[1] || '', loc = (/Content-Location:\s*(\S+)/i.exec(hdr) || [])[1] || '', cid = (/Content-ID:\s*<?([^>\r\n]+)>?/i.exec(hdr) || [])[1] || '';
    const bytes = decodeBody(body, enc);
    if (/text\/html/i.test(ct) && html == null) { html = decodeHtmlBytes(bytes, cs); continue; }
    if (/^image\//i.test(ct)) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 0x8000))); const url = 'data:' + ct.trim() + ';base64,' + btoa(s); if (loc) files.set(loc, url); if (cid) files.set('cid:' + cid, url); }
  }
  const resolve = (src) => { if (!src) return ''; if (files.has(src)) return files.get(src); const tail = src.split('/').pop(); for (const [k, v] of files) if (k.split('/').pop() === tail) return v; return ''; };
  return { html: html || '', resolve };
}
