/*
 * Çizici: sahne ilkellerini tuvale çizer.
 *  - model uzayı ve sayfa düzenleri (görünüm pencereleri kırpılarak model uzayı içeri çizilir)
 *  - tema tablosu (koyu / açık / blueprint / sepya / yüksek kontrast), arka plan geçersiz kılma
 *  - görünürlük süzgeçleri (yazı, tarama, ölçü, nokta, resim, öznitelik, blok, çizgi tipi)
 *  - renk modu (nesne / katman paleti / tek renk), çizgi kalınlıkları, en az kalınlık, soldurma
 *  - ızgara (model uzayı), karşılaştırma modunda renk geçersiz kılma
 *  - uzamsal indeks ile görünür ilkel seçimi, kaydırırken sadeleştirme
 */
import { S, visibleRect } from './state.js';
import { FG } from './scene.js';
import { drawBasemap } from './tiles.js';

/** Tema tablosu (§A.2). `dark` arayüz/foreground türetimi, `minLw` en az çizgi kalınlığı (px). */
export const THEMES = {
  dark: { id: 'dark', bg: '#1c2129', fg: '#f2f4f7', grid: '#2c3a4b', paper: '#242b35', dark: true, minLw: 1 },
  light: { id: 'light', bg: '#ffffff', fg: '#111111', grid: '#d9dee5', paper: '#f4f5f7', dark: false, minLw: 1 },
  blueprint: { id: 'blueprint', bg: '#0b2a5b', fg: '#dfe9ff', grid: '#1f4a8a', paper: '#123a74', dark: true, minLw: 1, forceMono: true },
  sepia: { id: 'sepia', bg: '#f3e9d2', fg: '#3a2a14', grid: '#d9c9a5', paper: '#eadfc4', dark: false, minLw: 1 },
  hicontrast: { id: 'hicontrast', bg: '#ffffff', fg: '#000000', grid: '#bbbbbb', paper: '#f0f0f0', dark: false, minLw: 1.5, clampAci: true },
};
/** Etkin tema nesnesi ('system' çözümlenir) */
export function theme() {
  const id = S.theme === 'system' ? (S.dark ? 'dark' : 'light') : S.theme;
  return THEMES[id] || THEMES.dark;
}
/** css renk → göreli parlaklık (0..1) */
export function luminance(css) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(css).trim());
  if (!m) return S.dark ? 0 : 1;
  const v = parseInt(m[1], 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}
export const bgColor = () => S.bgOverride || theme().bg;
export const fgColor = () => S.bgOverride ? (luminance(S.bgOverride) > 0.5 ? '#111111' : '#f2f4f7') : theme().fg;
export const gridColor = () => theme().grid;
export const rgbCss = (c, fg) => c === FG ? fg : '#' + (c & 0xffffff).toString(16).padStart(6, '0');

// Renk önbelleği: tam sayı renk → css (yüksek kontrastta parlaklık kısıtlaması uygulanmış). Tema değişince sıfırlanır.
const colCache = new Map();
let colCacheKey = '';
function entityCss(c, fg) {
  if (c === FG) return fg;
  let s = colCache.get(c);
  if (s !== undefined) return s;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  if (theme().clampAci) {
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum > 0.6) { const k = 0.6 / lum; s = '#' + ((Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k)).toString(16).padStart(6, '0'); }
  }
  if (s === undefined) s = '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  colCache.set(c, s);
  return s;
}
/** Katman paleti: altın-açı HSL; ad → renk (S.layerPalette önbellek) */
export function layerPalette(name) {
  let s = S.layerPalette.get(name);
  if (s) return s;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const idx = S.layerPalette.size;
  const hue = ((idx * 137.508) + (h % 360) * 0.25) % 360;
  s = `hsl(${hue.toFixed(1)} 70% ${S.dark ? 62 : 42}%)`;
  S.layerPalette.set(name, s);
  return s;
}

function dashOf(prim, ltypes, scale, ltK) {
  if (!prim.lt) return null;
  const lt = ltypes[prim.lt];
  if (!lt) return null;
  const k = (prim.lts || 1) * (ltK || 1);   // ltK: görünüm penceresinde PSLTSCALE (kâğıt birimi) çarpanı
  const total = lt.len * k;
  if (total * scale < 4) return null;
  const arr = [];
  let expectDash = true;
  for (const el of lt.pat) {
    const len = Math.abs(el) * k;
    const isDash = el > 0, isDot = el === 0;
    if (isDot) { if (!expectDash) arr.push(0); arr.push(1.5 / scale); expectDash = false; continue; }
    if (isDash !== expectDash) arr.push(0);
    arr.push(len);
    expectDash = !isDash;
  }
  if (arr.length % 2) arr.push(0);
  return arr.length ? arr : null;
}

export function tracePath(c, ops) {
  for (let j = 0, m = ops.length; j < m; j++) {
    const o = ops[j];
    switch (o[0]) {
      case 0: c.moveTo(o[1], o[2]); break;
      case 1: c.lineTo(o[1], o[2]); break;
      case 2: c.arc(o[1], o[2], o[3], o[4], o[5], false); break;
      case -2: c.arc(o[1], o[2], o[3], o[4], o[5], true); break;
      case 3: c.ellipse(o[1], o[2], o[3], o[4], o[5], o[6], o[7], false); break;
      default: break;
    }
  }
}

function drawText(c, p, fg, col) {
  c.save();
  c.translate(p.x, p.y);
  c.rotate(p.rot);
  const s = p.h / 10;
  c.scale(s * p.ws * (p.mx ? -1 : 1), -s * (p.my ? -1 : 1));
  if (p.obl) c.transform(1, 0, Math.tan(-p.obl), 1, 0, 0);
  c.font = '10px ' + (p.font || 'sans-serif');
  c.fillStyle = col;
  c.textAlign = p.ha === 1 ? 'center' : p.ha === 2 ? 'right' : 'left';
  const n = p.lines.length, lh = 16.67 * (p.spacing || 1);
  let y0;
  if (p.va === 3) { c.textBaseline = 'top'; y0 = 0; }
  else if (p.va === 2) { c.textBaseline = 'middle'; y0 = -((n - 1) * lh) / 2; }
  else { c.textBaseline = 'alphabetic'; y0 = -(n - 1) * lh; }
  for (let i = 0; i < n; i++) c.fillText(p.lines[i], 0, y0 + i * lh);
  c.restore();
}

const DIM_TYPES = { DIMENSION: 1, ARC_DIMENSION: 1, LARGE_RADIAL_DIMENSION: 1 };
const isHatch = (p) => p.et === 'HATCH' || (p.fill && p.et === 'SOLID');
const isDim = (p) => DIM_TYPES[p.et] === 1 || (p.info != null && p.info.t === 'DIMENSION');
/** Görünürlük süzgeçleri (katman hariç): display.primVisible bunun üstüne katmanı ekler */
export function passFilters(p) {
  if (p.tri) return false;                       // katı model üçgenleri yalnız 3B'de
  const sh = S.show;
  switch (p.k) {
    case 1: if (!sh.text) return false; if (!sh.attrib && (p.et === 'ATTRIB' || p.et === 'ATTDEF')) return false; break;
    case 2: if (!sh.point) return false; break;
    case 3: if (!sh.image) return false; break;
    case 4: return false;
    default: if (!sh.hatch && isHatch(p)) return false; break;
  }
  if (!sh.dim && isDim(p)) return false;
  if (!sh.block && p.info != null && p.info.t === 'INSERT') return false;
  return true;
}
/** Kaydırırken sadeleştirme etkin mi */
export const fastPanActive = () => S.gestureActive && (S.fastPan === 'auto' ? S.prims.length > 50000 : !!S.fastPan);

/**
 * İlkelleri çizer. c dünya dönüşümünde; scale = dünya→css px; rect = görünür dünya dikdörtgeni
 * opt: { layers, ltypes, fg, bg, colorOf(p) → css | null(atla), tree, frozen (pencerede dondurulmuş katman adları), ltK (çizgi tipi çarpanı) }
 */
export function drawPrims(c, prims, scale, rect, opt) {
  const [vx0, vy0, vx1, vy1] = rect;
  const th = theme();
  const fast = fastPanActive();
  const minPx = 0.35 / scale;
  const thinPx = fast ? 0.75 : Math.max(S.minLw, th.minLw);
  const thin = (S.smooth ? thinPx : 1 / S.dpr) / scale; // yumuşatma kapalıyken tam 1 fiziksel px
  const { layers, ltypes, fg, bg, frozen, ltK } = opt;
  const lwOn = S.lw, lwK = S.lwScale / 100 / scale; // 1/100 mm → dünya birimi (px cinsinden kalınlık / scale)
  const sh = S.show, ltOn = sh.ltype;
  const mode = th.forceMono ? 'mono' : S.colorMode;
  const monoCol = mode === 'mono' ? (th.forceMono || S.monoColor === 'fg' ? fg : S.monoColor === 'accent' ? '#f5b342' : (S.monoColor || fg)) : null;
  const fadeOn = S.fade.on, fadeA = 1 - (S.fade.pct || 70) / 100, curLayer = S.curLayerName;
  const hatchA = S.hatchAlpha;
  const pStyle = S.pointStyle, pPx = (S.glove && S.pointPx === 3 ? 6 : S.pointPx) || 3;
  c.lineCap = 'butt'; c.lineJoin = S.smooth ? 'round' : 'miter';
  let curKey = null, open = false, curAlpha = 1;
  const flush = () => { if (open) { c.stroke(); open = false; } };
  let list = null;
  if (opt.tree) {
    const ext = S.ext;
    const visArea = (vx1 - vx0) * (vy1 - vy0), extArea = ext ? (ext[2] - ext[0]) * (ext[3] - ext[1]) : Infinity;
    if (visArea < extArea * 0.35) list = opt.tree.collect(vx0, vy0, vx1, vy1);
  }
  const n = list ? list.length : prims.length;
  for (let ii = 0; ii < n; ii++) {
    const p = list ? prims[list[ii]] : prims[ii];
    const bb = p.bb;
    if (bb[2] < vx0 || bb[0] > vx1 || bb[3] < vy0 || bb[1] > vy1) continue;
    if (p.k === 4) continue;
    const L = layers.get(p.lay);
    if (L && !L.visible) continue;
    if (frozen && frozen.has(p.lay)) continue;
    if (!passFilters(p)) continue;
    let col = opt.colorOf ? opt.colorOf(p) : (monoCol || (mode === 'layer' ? layerPalette(p.lay) : entityCss(p.col, fg)));
    if (col === null) continue;
    let alpha = 1;
    if (L && (L.faded || L.locked)) alpha = fadeA;
    else if (fadeOn && p.lay !== curLayer) alpha = fadeA;
    if (p.k === 0) {
      if (!p.fill && (bb[2] - bb[0]) < minPx && (bb[3] - bb[1]) < minPx) continue;
      if (p.bg) col = bg;
      if (p.fill) {
        if (fast && isHatch(p)) continue;
        flush(); curKey = null;
        c.globalAlpha = p.alpha * alpha * (isHatch(p) ? hatchA : 1); c.fillStyle = col;
        c.beginPath(); tracePath(c, p.ops); c.closePath(); c.fill('evenodd');
        c.globalAlpha = curAlpha;
        continue;
      }
      let w = p.w > thin ? p.w : thin;
      if (lwOn && !(p.w > thin)) { const lw = (p.lw != null && p.lw >= 0 ? p.lw : 25) * lwK; if (lw > w) w = lw; }   // 0,00 mm en ince kalır
      const dash = ltOn ? dashOf(p, ltypes, scale, ltK) : null;
      const key = col + '|' + w + '|' + (dash ? p.lt + '@' + p.lts : '') + '|' + alpha;
      if (key !== curKey) {
        flush();
        c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []);
        if (alpha !== curAlpha) { c.globalAlpha = alpha; curAlpha = alpha; }
        c.beginPath(); open = true; curKey = key;
      } else if (!open) { c.beginPath(); open = true; }
      tracePath(c, p.ops);
      if (p.closed) c.closePath();
    } else if (p.k === 1) {
      if (fast) continue;
      if (p.h * scale < S.minTextPx) continue;
      flush(); curKey = null;
      if (alpha !== curAlpha) { c.globalAlpha = alpha; curAlpha = alpha; }
      drawText(c, p, fg, col);
    } else if (p.k === 2) {
      flush(); curKey = null;
      if (alpha !== curAlpha) { c.globalAlpha = alpha; curAlpha = alpha; }
      const s = pPx / scale;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = thin; c.setLineDash([]);
      c.beginPath();
      if (pStyle === 'x') { c.moveTo(p.x - s, p.y - s); c.lineTo(p.x + s, p.y + s); c.moveTo(p.x + s, p.y - s); c.lineTo(p.x - s, p.y + s); c.stroke(); }
      else if (pStyle === 'o') { c.arc(p.x, p.y, s, 0, 6.2832); c.stroke(); }
      else if (pStyle === 'dot') { c.arc(p.x, p.y, s * 0.6, 0, 6.2832); c.fill(); }
      else { c.moveTo(p.x - s, p.y); c.lineTo(p.x + s, p.y); c.moveTo(p.x, p.y - s); c.lineTo(p.x, p.y + s); c.stroke(); }
    } else if (p.k === 3) {
      if (fast) continue;
      flush(); curKey = null;
      if (alpha !== curAlpha) { c.globalAlpha = alpha; curAlpha = alpha; }
      const im = S.images.get(p.img);
      const q = p.quad;
      if (im && im.ok) {
        c.save();
        // resim px (0..pw, 0..ph; y aşağı) → dünya: sol alt q[0], sağ alt q[1], sol üst q[3]
        const a = (q[1][0] - q[0][0]) / p.pw, b = (q[1][1] - q[0][1]) / p.pw;
        const cc = (q[3][0] - q[0][0]) / p.ph, d = (q[3][1] - q[0][1]) / p.ph;
        c.transform(a, b, cc, d, q[0][0], q[0][1]);
        c.transform(1, 0, 0, -1, 0, p.ph);
        c.drawImage(im.img, 0, 0, p.pw, p.ph);
        c.restore();
      } else {
        c.strokeStyle = col; c.lineWidth = thin; c.setLineDash([4 / scale, 4 / scale]);
        c.beginPath(); c.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) c.lineTo(q[i][0], q[i][1]); c.closePath(); c.stroke();
        c.beginPath(); c.moveTo(q[0][0], q[0][1]); c.lineTo(q[2][0], q[2][1]); c.moveTo(q[1][0], q[1][1]); c.lineTo(q[3][0], q[3][1]); c.stroke();
        c.setLineDash([]);
      }
    }
  }
  flush();
  c.setLineDash([]);
  c.globalAlpha = 1;
}

/** Karşılaştırma modu renkleri */
function compareColorOf(fg) {
  const cmp = S.compare;
  if (!cmp) return null;
  const onlyDiff = S.ui2d.compareOnlyDiff;
  return (p) => {
    const st = cmp.mark.get(p);
    if (st === 'removed') return '#ff453a';
    if (st === 'added') return '#30d158';
    if (onlyDiff) return null;
    return S.dark ? '#6b7683' : '#9aa5b1';
  };
}

// ---- ızgara ---------------------------------------------------------------------------
/** Son çizilen ızgara adımı (dünya birimi; 0 = çizilmedi). Durum çubuğu okur. */
export const gridState = { step: 0 };
export function niceStep(v) { const p = 10 ** Math.floor(Math.log10(v || 1)); const m = v / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; }
/** Görünür dikdörtgende model ızgarası; ekran uzayında çizilir (kesin piksel). Eksen başına ≤ 200 çizgi. */
export function drawGrid(c, cv) {
  gridState.step = 0;
  if (!S.grid.on || fastPanActive()) return;
  const { scale } = S.view;
  const r = visibleRect();
  const visW = r[2] - r[0], visH = r[3] - r[1];
  let step = S.grid.step === 'auto' ? niceStep(visW / 10) : Number(S.grid.step);
  if (!(step > 0) || !isFinite(step)) step = niceStep(visW / 10);
  while (step * scale < 8) step *= 2;
  while (Math.max(visW, visH) / step > 200) step *= 2;
  const nx = Math.floor(visW / step) + 2, ny = Math.floor(visH / step) + 2;
  if (nx > 402 || ny > 402) return;
  const dpr = S.dpr;
  c.save();
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.strokeStyle = gridColor(); c.fillStyle = gridColor(); c.lineWidth = 1; c.setLineDash([]);
  const ix0 = Math.floor(r[0] / step), ix1 = Math.ceil(r[2] / step), iy0 = Math.floor(r[1] / step), iy1 = Math.ceil(r[3] / step);
  const sx = (x) => S.W / 2 + (x - S.view.cx) * scale, sy = (y) => S.H / 2 - (y - S.view.cy) * scale;
  const major = S.dark ? 0.35 : 0.45, minor = S.dark ? 0.15 : 0.2;
  if (S.grid.style === 'point') {
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = Math.round(sx(ix * step)) + 0.5;
      const mx = ix % 5 === 0;
      for (let iy = iy0; iy <= iy1; iy++) {
        const my = iy % 5 === 0;
        c.globalAlpha = (mx && my) ? major * 2 : (mx || my) ? major : minor;
        const y = Math.round(sy(iy * step)) + 0.5;
        c.fillRect(x - (mx && my ? 1.5 : 1), y - (mx && my ? 1.5 : 1), mx && my ? 3 : 2, mx && my ? 3 : 2);
      }
    }
  } else {
    for (let pass = 0; pass < 2; pass++) {
      c.globalAlpha = pass ? major : minor;
      c.beginPath();
      for (let ix = ix0; ix <= ix1; ix++) { if ((ix % 5 === 0) !== !!pass) continue; const x = Math.round(sx(ix * step)) + 0.5; c.moveTo(x, 0); c.lineTo(x, S.H); }
      for (let iy = iy0; iy <= iy1; iy++) { if ((iy % 5 === 0) !== !!pass) continue; const y = Math.round(sy(iy * step)) + 0.5; c.moveTo(0, y); c.lineTo(S.W, y); }
      c.stroke();
    }
  }
  c.restore();
  gridState.step = step;
}

let exporting = false;
/** Bir kareyi baştan sona çizer (arka plan + altlık + ızgara + ilkeller + görünüm pencereleri) */
export function drawFrame(c, cv) {
  const th = theme();
  const ck = th.id + '|' + (S.bgOverride || '');
  if (ck !== colCacheKey) { colCache.clear(); colCacheKey = ck; }
  const bg = bgColor(), fg = fgColor();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = bg;
  c.fillRect(0, 0, cv.width, cv.height);
  if (!S.hasDoc) return;
  const { scale, cx, cy } = S.view;
  const k = scale * S.dpr;
  const world = () => c.setTransform(k, 0, 0, -k, cv.width / 2 - k * cx, cv.height / 2 + k * cy);
  world();
  const rect = visibleRect();
  const layout = S.scene.layouts[S.layoutIndex];
  const model = S.scene.layouts[0];
  const opt = { layers: S.layers, ltypes: S.ltypes, fg, bg, tree: null };
  if (layout.isModel) {
    drawBasemap(c);
    if (!exporting) { drawGrid(c, cv); world(); }
    const colorOf = compareColorOf(fg);
    drawPrims(c, S.prims, scale, rect, { ...opt, tree: S.tree, colorOf });
    if (S.compare) drawPrims(c, S.compare.prims, scale, rect, { ...opt, tree: S.compare.tree, colorOf: (p) => S.compare.mark.get(p) === 'added' ? '#30d158' : null });
  } else {
    // kâğıt: çerçeve
    c.fillStyle = S.bgOverride ? bg : th.paper;
    c.fillRect(layout.ext[0], layout.ext[1], layout.ext[2] - layout.ext[0], layout.ext[3] - layout.ext[1]);
    for (const vp of layout.viewports) {
      if (!vp.on) continue;
      c.save();
      c.beginPath(); c.rect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0); c.clip();
      if (S.ui2d.vpFrames) { c.strokeStyle = S.dark ? '#3a4656' : '#c9d0d8'; c.lineWidth = 1 / scale; c.stroke(); }
      const mcx = (vp.x0 + vp.x1) / 2, mcy = (vp.y0 + vp.y1) / 2;
      c.translate(mcx, mcy); c.scale(vp.scale, vp.scale); if (vp.twist) c.rotate(vp.twist); c.translate(-vp.cx, -vp.cy);
      const ms = scale * vp.scale;
      const hw = (vp.x1 - vp.x0) / 2 / vp.scale, hh = (vp.y1 - vp.y0) / 2 / vp.scale;
      const rr = vp.twist ? [vp.cx - Math.hypot(hw, hh), vp.cy - Math.hypot(hw, hh), vp.cx + Math.hypot(hw, hh), vp.cy + Math.hypot(hw, hh)] : [vp.cx - hw, vp.cy - hh, vp.cx + hw, vp.cy + hh];
      // PSLTSCALE=1: çizgi tipi uzunlukları kâğıt biriminde sabittir; pencere başına dondurulmuş katmanlar (VIEWPORT 331) gizlenir
      const psLt = !(S.scene.header && S.scene.header.PSLTSCALE === 0), frozen = vp.frozen && vp.frozen.length ? new Set(vp.frozen) : null;
      drawPrims(c, model.prims, ms, rr, { ...opt, tree: S.tree, frozen, ltK: psLt && vp.scale > 0 ? 1 / vp.scale : 1 });
      c.restore();
    }
    drawPrims(c, S.prims, scale, rect, opt);
  }
}

/** Belirli bir dünya dikdörtgenini verilen piksel boyutunda ayrı bir tuvale çizer (PNG/PDF için; opts.light → açık tema, arka plan geçersiz kılması yok) */
export function renderRegion(bb, pxW, pxH, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = pxW; cv.height = pxH;
  const c = cv.getContext('2d');
  const save = { view: { ...S.view }, W: S.W, H: S.H, dpr: S.dpr, theme: S.theme, bgOverride: S.bgOverride, gesture: S.gestureActive };
  S.W = pxW; S.H = pxH; S.dpr = 1; S.gestureActive = false;
  if (opts.light) { S.theme = 'light'; S.bgOverride = null; }
  S.view.scale = Math.min(pxW / (bb[2] - bb[0]), pxH / (bb[3] - bb[1]));
  S.view.cx = (bb[0] + bb[2]) / 2; S.view.cy = (bb[1] + bb[3]) / 2;
  exporting = true;
  try { drawFrame(c, cv); if (opts.overlay) opts.overlay(c, cv); }
  finally { exporting = false; S.view = save.view; S.W = save.W; S.H = save.H; S.dpr = save.dpr; S.theme = save.theme; S.bgOverride = save.bgOverride; S.gestureActive = save.gesture; }
  return cv;
}
