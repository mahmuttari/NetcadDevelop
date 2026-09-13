/*
 * PDF düzenleme (Pro): açıklama katmanı ve sayfa işlemleri.
 *
 *  Özgün PDF'e hiç dokunulmaz. Kullanıcının çizdikleri ayrı bir modelde tutulur, "Kaydet" denince pdf-lib ile
 *  yeni bir PDF üretilir ve "farklı kaydet" yoluyla paylaşılır.
 *
 *  Araçlar: kalem (serbest çizim ve imza), vurgu (yarı saydam kalın iz), metin kutusu, damga (tarihli onay
 *  kutusu), silgi (dokunulan açıklamayı siler). Sayfa işlemleri: sola / sağa döndürme, sayfayı silme ve geri
 *  alma. Geri al bütün işlemleri kapsar.
 *
 *  Koordinatlar PDF kullanıcı uzayında (sol alt köken, y yukarı, punto) ve sayfanın DÖNDÜRÜLMEMİŞ hâline göre
 *  tutulur; ekranda gösterilen çerçeve döndürülmüşse dönüşüm toPdf / toView ile yapılır. Böylece kullanıcı
 *  sayfayı çevirip çizse bile açıklama, çıktıda doğru yere düşer.
 *
 *  Metin rasterlenir: pdf-lib'in gömülü 14 standart yazı tipi WinAnsi kodlamasındadır ve Türkçe İ ı Ğ ğ Ş ş
 *  harflerini taşımaz. Yazı tipi gömmek fontkit ve ek bir font dosyası ister; onun yerine metin kutusu canvas'ta
 *  çizilip PNG olarak gömülür. Çizgiler vektör kalır.
 */
import { t } from './i18n.js';
import { isPro, gate } from './edition.js';

const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = () => window.Android;
const SVGNS = 'http://www.w3.org/2000/svg';
const PT = 96 / 72;   // pt → CSS piksel

export const COLORS = ['#d92b2b', '#1b62d6', '#128a4a', '#e8a300', '#111111'];
export const PEN_W = [1, 2, 4, 8];
const HI_W = 14;      // vurgu kalınlığı (pt)
const HI_ALPHA = 0.35;

/** pdf-lib yalnız düzenleme açılınca yüklenir (525 KB); açılış süresini etkilemesin */
let libPromise = null;
export function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (libPromise) return libPromise;
  libPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'lib/pdf-lib.min.js';
    s.onload = () => window.PDFLib ? res(window.PDFLib) : rej(new Error('pdf-lib yüklendi ama PDFLib yok'));
    s.onerror = () => { libPromise = null; rej(new Error(tt('editLibFail', 'PDF düzenleme kitaplığı yüklenemedi'))); };
    document.head.appendChild(s);
  });
  return libPromise;
}

// ---------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------
/**
 * Belgeyi pdf-lib ile okur ve düzenleme durumunu kurar.
 * pages[i] = { src (özgün sayfa sırası), w, h (döndürülmemiş punto), rot0 (özgün açı), rot (geçerli açı), del }
 */
export async function openEdit(bytes) {
  const { PDFDocument } = await loadPdfLib();
  let src;
  try { src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
  catch (e) { throw new Error(tt('editPdfFail', 'PDF çözümlenemedi') + ': ' + (e && e.message ? e.message : e)); }
  const pages = src.getPages().map((p, i) => {
    const { width, height } = p.getSize();
    const rot = ((p.getRotation().angle % 360) + 360) % 360;
    return { src: i, w: width, h: height, rot0: rot, rot, del: false };
  });
  if (!pages.length) throw new Error(tt('editPdfEmpty', 'PDF sayfası yok'));
  return { pages, ann: [], undo: [], seq: 0, tool: 'pan', color: COLORS[0], width: PEN_W[1] };   // varsayılan el aracı: parmakla kaydırma serbest
}

/** Ekranda görünen sayfa ölçüsü (punto); 90 ve 270 derecede en ile boy yer değiştirir */
export const viewSize = (pg) => (pg.rot % 180 === 0 ? { w: pg.w, h: pg.h } : { w: pg.h, h: pg.w });

/** Görünen çerçeve noktası → döndürülmemiş PDF noktası */
export function toPdf(pg, dx, dy) {
  const { w: W, h: H } = { w: pg.w, h: pg.h };
  switch (pg.rot) {
    case 90: return [dy, dx];
    case 180: return [W - dx, dy];
    case 270: return [W - dy, H - dx];
    default: return [dx, H - dy];
  }
}
/** Döndürülmemiş PDF noktası → görünen çerçeve noktası */
export function toView(pg, x, y) {
  const { w: W, h: H } = { w: pg.w, h: pg.h };
  switch (pg.rot) {
    case 90: return [y, x];
    case 180: return [W - x, y];
    case 270: return [H - y, W - x];
    default: return [x, H - y];
  }
}

const nowStamp = () => { const d = new Date(); const p = (n) => (n < 10 ? '0' : '') + n; return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; };

/** Geri alma yığınına işlem yazar */
function push(st, undo) { st.undo.push(undo); if (st.undo.length > 200) st.undo.shift(); }
export function addAnn(st, a) { a.id = ++st.seq; st.ann.push(a); push(st, () => { const i = st.ann.indexOf(a); if (i >= 0) st.ann.splice(i, 1); }); return a; }
export function removeAnn(st, id) {
  const i = st.ann.findIndex(a => a.id === id); if (i < 0) return false;
  const [a] = st.ann.splice(i, 1); push(st, () => st.ann.splice(i, 0, a)); return true;
}
export function rotatePage(st, i, deg) {
  const pg = st.pages[i], before = pg.rot;
  pg.rot = ((pg.rot + deg) % 360 + 360) % 360;
  push(st, () => { pg.rot = before; });
}
export function deletePage(st, i) {
  const pg = st.pages[i];
  if (st.pages.filter(p => !p.del).length <= 1) return false;
  pg.del = true; push(st, () => { pg.del = false; }); return true;
}
export function undo(st) { const f = st.undo.pop(); if (!f) return false; f(); return true; }
export const dirty = (st) => st.ann.length > 0 || st.pages.some(p => p.del || p.rot !== p.rot0);

// ---------------------------------------------------------------------------------
// Çıktı: pdf-lib ile yeni PDF
// ---------------------------------------------------------------------------------
const hexRgb = (lib, hex) => { const n = parseInt(hex.slice(1), 16); return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

/** Metni canvas'ta çizip PNG bayta çevirir; Türkçe harfler için gömülü yazı tipi gerekmesin diye */
function textPng(text, sizePt, color, maxWpt) {
  const SS = 3;                                   // kenar yumuşatma için üç kat
  const lines = String(text).split('\n');
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const font = (px) => `${px}px "Times New Roman", Georgia, serif`;
  g.font = font(sizePt * SS);
  const maxPx = maxWpt ? maxWpt * SS : Infinity;
  // sığmayan satırları böl
  const out = [];
  for (const ln of lines) {
    if (g.measureText(ln).width <= maxPx) { out.push(ln); continue; }
    let cur = '';
    for (const word of ln.split(/(\s+)/)) {
      if (g.measureText(cur + word).width > maxPx && cur.trim()) { out.push(cur.trimEnd()); cur = word.trimStart(); }
      else cur += word;
    }
    if (cur.trim()) out.push(cur.trimEnd());
  }
  if (!out.length) out.push('');
  const lh = sizePt * 1.3 * SS;
  const wPx = Math.max(1, Math.ceil(Math.min(maxPx, Math.max(...out.map(l => g.measureText(l).width)))));
  const hPx = Math.max(1, Math.ceil(lh * out.length));
  c.width = wPx; c.height = hPx;
  const g2 = c.getContext('2d');
  g2.font = font(sizePt * SS); g2.fillStyle = color; g2.textBaseline = 'top';
  out.forEach((l, i) => g2.fillText(l, 0, i * lh + (lh - sizePt * SS) / 2));
  const url = c.toDataURL('image/png');
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return { bytes: u8, w: wPx / SS, h: hPx / SS };
}

/**
 * Düzenlenmiş PDF'i üretir (Uint8Array). Silinen sayfalar atılır, döndürmeler uygulanır, açıklamalar
 * döndürülmemiş sayfa uzayına çizilir. Özgün belge değişmez.
 */
export async function exportPdf(bytes, st) {
  const lib = await loadPdfLib();
  const { PDFDocument, degrees } = lib;
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create();
  const keep = st.pages.filter(p => !p.del);
  const copied = await out.copyPages(src, keep.map(p => p.src));
  const pngCache = new Map();
  for (let i = 0; i < copied.length; i++) {
    const pg = keep[i], page = copied[i];
    out.addPage(page);
    page.setRotation(degrees(pg.rot));
    for (const a of st.ann) {
      if (a.page !== pg.src) continue;
      if (a.type === 'ink' || a.type === 'hi') {
        const col = hexRgb(lib, a.color), w = a.type === 'hi' ? HI_W : a.w;
        const op = a.type === 'hi' ? HI_ALPHA : 1;
        for (let k = 1; k < a.pts.length; k++) {
          const p0 = a.pts[k - 1], p1 = a.pts[k];
          page.drawLine({ start: { x: p0[0], y: p0[1] }, end: { x: p1[0], y: p1[1] }, thickness: w, color: col, opacity: op, lineCap: lib.LineCapStyle.Round });
        }
        if (a.pts.length === 1) {
          const p0 = a.pts[0];
          page.drawCircle({ x: p0[0], y: p0[1], size: w / 2, color: col, opacity: op });
        }
      } else if (a.type === 'text' || a.type === 'stamp') {
        const key = a.id + ':' + a.text + ':' + a.size + ':' + a.color;
        let img = pngCache.get(key);
        if (!img) {
          const png = textPng(a.text, a.size, a.color, a.maxw || 0);
          img = { emb: await out.embedPng(png.bytes), w: png.w, h: png.h };
          pngCache.set(key, img);
        }
        if (a.type === 'stamp') {
          const pad = 5;
          page.drawRectangle({ x: a.x - pad, y: a.y - img.h - pad, width: img.w + 2 * pad, height: img.h + 2 * pad, borderColor: hexRgb(lib, a.color), borderWidth: 1.2, color: hexRgb(lib, a.color), opacity: 0.06 });
        }
        page.drawImage(img.emb, { x: a.x, y: a.y - img.h, width: img.w, height: img.h });
      }
    }
  }
  out.setProducer('DWG OfficeZip');
  return out.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------------------------
// Görünüm: sayfa yığını + SVG açıklama katmanı
// ---------------------------------------------------------------------------------
const svg = (name, attrs) => { const e = document.createElementNS(SVGNS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

/**
 * Düzenleme yüzeyini kurar. host: sayfaların basılacağı öğe. opts.bg(pageIndexInSource, pxWidth) → arka plan
 * resmi adresi ya da boş (tarayıcıda arka plan yok, beyaz sayfa çizilir).
 */
export function mountSurface(host, st, opts = {}) {
  const bg = opts.bg || (() => '');
  const onPick = opts.onText || (async () => null);
  let scale = 1, userScale = false;   // userScale: kullanıcı yakınlaştırdıysa yeniden çizim sığdırmaya dönmez
  const surf = document.createElement('div');
  surf.className = 'pdfe-stack';
  surf.dataset.tool = st.tool;   // 'pan' iken katman tıklama almaz, sayfa parmakla kaydırılır
  host.innerHTML = ''; host.appendChild(surf);

  const fit = () => {
    const wide = Math.max(...st.pages.filter(p => !p.del).map(p => viewSize(p).w), 1);
    scale = Math.max(0.15, Math.min(4, (host.clientWidth - 24) / (wide * PT)));
  };

  function render() {
    surf.dataset.tool = st.tool;
    if (!userScale) fit();
    surf.innerHTML = '';
    const live = st.pages.filter(p => !p.del);
    live.forEach((pg) => {
      const vs = viewSize(pg), wPx = vs.w * PT * scale, hPx = vs.h * PT * scale;
      const wrap = document.createElement('div');
      wrap.className = 'pdfe-page'; wrap.dataset.page = String(pg.src);
      wrap.style.width = Math.round(wPx) + 'px'; wrap.style.height = Math.round(hPx) + 'px';
      const url = bg(pg.src, Math.min(2400, Math.round((pg.rot % 180 ? pg.h : pg.w) * PT * scale * (window.devicePixelRatio || 1))));
      if (url) {
        const im = document.createElement('img');
        im.className = 'pdfe-bg'; im.alt = ''; im.decoding = 'async'; im.src = url;
        const d = ((pg.rot - pg.rot0) % 360 + 360) % 360;   // özgün resim rot0 ile çizili; farkı CSS ile döndür
        if (d) { im.style.transform = `translate(-50%,-50%) rotate(${d}deg)`; im.style.width = (d % 180 ? hPx : wPx) + 'px'; im.style.height = (d % 180 ? wPx : hPx) + 'px'; }
        wrap.appendChild(im);
      }
      const layer = svg('svg', { class: 'pdfe-layer', viewBox: `0 0 ${vs.w} ${vs.h}`, preserveAspectRatio: 'none' });
      layer.dataset.page = String(pg.src);
      for (const a of st.ann) {
        if (a.page !== pg.src) continue;
        const el = annEl(pg, a);
        if (el) layer.appendChild(el);
      }
      wrap.appendChild(layer);
      const no = document.createElement('span');
      no.className = 'pdfe-no'; no.textContent = (live.indexOf(pg) + 1) + ' / ' + live.length;
      wrap.appendChild(no);
      surf.appendChild(wrap);
    });
    requestAnimationFrame(mark);
  }

  /** Bir açıklamayı görünen çerçevede SVG olarak çizer */
  function annEl(pg, a) {
    if (a.type === 'ink' || a.type === 'hi') {
      const w = a.type === 'hi' ? HI_W : a.w, op = a.type === 'hi' ? HI_ALPHA : 1;
      const g = svg('g', {}); g.dataset.ann = String(a.id); g.classList.add('pdfe-ann');
      if (a.pts.length > 1) {
        const pts = a.pts.map(q => toView(pg, q[0], q[1]).join(',')).join(' ');
        // saydam kalın iz: ince çizgiyi silgiyle yakalamak kolay olsun (parmakla dokunma hedefi)
        g.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(w + 12, 16), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'pdfe-hit' }));
        g.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: a.color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': op, 'pointer-events': 'none' }));
      } else {
        const [cx, cy] = toView(pg, a.pts[0][0], a.pts[0][1]);
        g.appendChild(svg('circle', { cx, cy, r: Math.max(w / 2 + 6, 8), fill: 'transparent', class: 'pdfe-hit' }));
        g.appendChild(svg('circle', { cx, cy, r: w / 2, fill: a.color, 'fill-opacity': op, 'pointer-events': 'none' }));
      }
      return g;
    }
    if (a.type === 'text' || a.type === 'stamp') {
      const g = svg('g', {}); g.dataset.ann = String(a.id); g.classList.add('pdfe-ann');
      const [vx, vy] = toView(pg, a.x, a.y);
      const rot = pg.rot === 90 ? -90 : pg.rot === 180 ? 180 : pg.rot === 270 ? 90 : 0;
      const inner = svg('text', { x: vx, y: vy, fill: a.color, 'font-size': a.size, 'font-family': '"Times New Roman", Georgia, serif' });
      if (rot) inner.setAttribute('transform', `rotate(${rot} ${vx} ${vy})`);
      const lines = String(a.text).split('\n');
      lines.forEach((ln, i) => { const ts = svg('tspan', { x: vx, dy: i ? a.size * 1.3 : 0 }); ts.textContent = ln; inner.appendChild(ts); });
      if (a.type === 'stamp') {
        const r = svg('rect', { x: vx - 5, y: vy - a.size - 3, width: a.size * 0.62 * Math.max(...lines.map(l => l.length)) + 10, height: a.size * 1.3 * lines.length + 6, fill: a.color, 'fill-opacity': 0.06, stroke: a.color, 'stroke-width': 1.2 });
        if (rot) r.setAttribute('transform', `rotate(${rot} ${vx} ${vy})`);
        g.appendChild(r);
      }
      g.appendChild(inner);
      return g;
    }
    return null;
  }

  // --- çizim ---
  let draw = null;
  const ptOf = (ev, layer) => {
    const r = layer.getBoundingClientRect(), vb = layer.viewBox.baseVal;
    return [(ev.clientX - r.left) / r.width * vb.width, (ev.clientY - r.top) / r.height * vb.height];
  };
  surf.addEventListener('pointerdown', async (ev) => {
    if (st.tool === 'pan') return;
    const layer = ev.target.closest('.pdfe-layer'); if (!layer) return;
    const pgIdx = +layer.dataset.page, pg = st.pages.find(p => p.src === pgIdx); if (!pg) return;
    if (st.tool === 'erase') {
      const hit = ev.target.closest('.pdfe-ann');
      if (hit && removeAnn(st, +hit.dataset.ann)) { render(); opts.onChange && opts.onChange(); }
      return;
    }
    const [vx, vy] = ptOf(ev, layer);
    if (st.tool === 'text' || st.tool === 'stamp') {
      const preset = st.tool === 'stamp' ? tt('editStampText', 'ONAYLANDI') + '\n' + nowStamp() : '';
      const text = st.tool === 'stamp' ? preset : await onPick(preset);
      if (!text) return;
      const [x, y] = toPdf(pg, vx, vy);
      addAnn(st, { type: st.tool, page: pgIdx, x, y, size: st.tool === 'stamp' ? 13 : Math.max(8, st.width * 5), color: st.color, text, maxw: Math.max(60, pg.w - x - 20) });
      render(); opts.onChange && opts.onChange();
      return;
    }
    ev.preventDefault();
    layer.setPointerCapture(ev.pointerId);
    const a = { type: st.tool === 'hi' ? 'hi' : 'ink', page: pgIdx, pts: [toPdf(pg, vx, vy)], w: st.width, color: st.color };
    draw = { a, pg, layer, el: null };
  });
  surf.addEventListener('pointermove', (ev) => {
    if (!draw) return;
    const [vx, vy] = ptOf(ev, draw.layer);
    const p = toPdf(draw.pg, vx, vy), last = draw.a.pts[draw.a.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.7) return;
    draw.a.pts.push(p);
    if (draw.el) draw.el.remove();
    draw.el = annEl(draw.pg, draw.a); draw.el.dataset.ann = 'draft';
    draw.layer.appendChild(draw.el);
  });
  const end = () => {
    if (!draw) return;
    const a = draw.a; if (draw.el) draw.el.remove(); draw = null;
    addAnn(st, a); render(); opts.onChange && opts.onChange();
  };
  surf.addEventListener('pointerup', end);
  surf.addEventListener('pointercancel', end);
  surf.addEventListener('touchmove', (ev) => { if (draw) ev.preventDefault(); }, { passive: false });

  /**
   * Etkin sayfa: görüş alanının üst üçte birindeki çizgiyi kaplayan sayfa; hiçbiri kaplamıyorsa o çizgiye en
   * yakın olan. Döndürme ve sayfa silme bu sayfaya uygulanır. offsetTop kullanılmaz: .pdfe-page konumlandırılmış
   * olduğu için offsetParent kapsayıcı olmayabilir ve scrollTop ile karşılaştırılamaz.
   */
  function activeWrap() {
    const wraps = [...surf.querySelectorAll('.pdfe-page')];
    if (!wraps.length) return null;
    const cr = host.getBoundingClientRect(), line = cr.top + cr.height * 0.35;
    let best = wraps[0], bestD = Infinity;
    for (const w of wraps) {
      const r = w.getBoundingClientRect();
      if (r.top <= line && r.bottom >= line) return w;
      const d = r.top > line ? r.top - line : line - r.bottom;
      if (d < bestD) { bestD = d; best = w; }
    }
    return best;
  }
  const active = () => { const w = activeWrap(); return w ? st.pages.findIndex(p => p.src === +w.dataset.page) : -1; };
  const mark = () => { const w = activeWrap(); for (const e of surf.querySelectorAll('.pdfe-page')) e.classList.toggle('on', e === w); };
  host.addEventListener('scroll', mark, { passive: true });

  render();
  return {
    render() { render(); mark(); },
    active,
    get tool() { return st.tool; },
    set tool(v) { st.tool = v; surf.dataset.tool = v; },
    zoom: (f) => {
      if (f === 0) { userScale = false; fit(); }
      else { userScale = true; scale = Math.max(0.15, Math.min(4, scale * f)); }
      render(); mark();
    },
    get scale() { return scale; },
    unmount() { host.removeEventListener('scroll', mark); },
  };
}

/** Araç satırı; kind 'pdf' */
export function toolbarHtml(st) {
  const b = (tool, icon, label) => `<button type="button" class="btn small${st.tool === tool ? ' on' : ''}" data-pe="tool" data-tool="${tool}" title="${esc(label)}" aria-label="${esc(label)}"><svg class="ic" aria-hidden="true"><use href="#${icon}"/></svg></button>`;
  const col = COLORS.map(c => `<button type="button" class="pdfe-color${st.color === c ? ' on' : ''}" data-pe="color" data-color="${c}" style="background:${c}" aria-label="${esc(c)}"></button>`).join('');
  const w = PEN_W.map(n => `<button type="button" class="pdfe-w${st.width === n ? ' on' : ''}" data-pe="width" data-width="${n}" aria-label="${n} pt"><i style="height:${n}px"></i></button>`).join('');
  const draws = st.tool === 'pen' || st.tool === 'hi' || st.tool === 'text' || st.tool === 'stamp';   // renk ve kalınlık yalnız çizim araçlarında
  return b('pan', 'i-move', tt('editPan', 'El'))
    + b('pen', 'i-pen', tt('editPen', 'Kalem')) + b('hi', 'i-hatch', tt('editHi', 'Vurgu')) + b('text', 'i-text', tt('editText', 'Metin'))
    + b('stamp', 'i-bookmark', tt('editStamp', 'Damga')) + b('erase', 'i-trash', tt('editErase', 'Silgi'))
    + (draws ? `<span class="sp"></span><span class="pdfe-colors">${col}</span>${st.tool === 'pen' || st.tool === 'hi' ? `<span class="pdfe-ws">${w}</span>` : ''}<span class="sp"></span>` : '<span class="sp"></span>')
    + `<button type="button" class="btn small" data-pe="rotl" title="${esc(tt('editRotL', 'Sola döndür'))}" aria-label="${esc(tt('editRotL', 'Sola döndür'))}"><svg class="ic" aria-hidden="true"><use href="#i-turn"/></svg></button>`
    + `<button type="button" class="btn small" data-pe="delpage">${esc(tt('editDelPage', 'Sayfayı sil'))}</button>`
    + `<button type="button" class="btn small" data-pe="undo" title="${esc(t('undo'))}" aria-label="${esc(t('undo'))}"><svg class="ic" aria-hidden="true"><use href="#i-undo"/></svg></button>`
    + `<span class="sp"></span><button type="button" class="btn small" data-pe="zout" aria-label="−"><svg class="ic" aria-hidden="true"><use href="#i-zoom-out"/></svg></button>`
    + `<button type="button" class="btn small" data-pe="zfit">${esc(tt('fitWidth', 'Sığdır'))}</button>`
    + `<button type="button" class="btn small" data-pe="zin" aria-label="+"><svg class="ic" aria-hidden="true"><use href="#i-zoom-in"/></svg></button>`
    + `<span class="sp"></span><button type="button" class="btn small primary" data-pe="save">${esc(tt('editSave', 'Kaydet'))}</button>`
    + `<button type="button" class="btn small" data-pe="cancel">${esc(t('cancel'))}</button>`;
}

export const canEdit = () => isPro() || gate('docEdit');
