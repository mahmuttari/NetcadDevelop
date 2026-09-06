/*
 * Çizici: sahne ilkellerini tuvale çizer.
 *  - model uzayı ve sayfa düzenleri (görünüm pencereleri kırpılarak model uzayı içeri çizilir)
 *  - renk / tek renk, çizgi tipleri, çizgi kalınlıkları, yazı stilleri, resim altlıkları
 *  - karşılaştırma modunda renk geçersiz kılma (kaldırılan kırmızı, eklenen yeşil, ortak gri)
 *  - uzamsal indeks ile görünür ilkel seçimi
 */
import { S, visibleRect } from './state.js';
import { FG } from './scene.js';
import { drawBasemap } from './tiles.js';

export const rgbCss = (c, fg) => c === FG ? fg : '#' + (c & 0xffffff).toString(16).padStart(6, '0');
export const bgColor = () => S.dark ? '#1c2129' : '#ffffff';
export const fgColor = () => S.dark ? '#f2f4f7' : '#111111';

function dashOf(prim, ltypes, scale) {
  if (!prim.lt) return null;
  const lt = ltypes[prim.lt];
  if (!lt) return null;
  const k = prim.lts || 1;
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

/**
 * İlkelleri çizer. c dünya dönüşümünde; scale = dünya→css px; rect = görünür dünya dikdörtgeni
 * opt: { layers, ltypes, fg, bg, colorOf(p) → css | null(atla), tree }
 */
export function drawPrims(c, prims, scale, rect, opt) {
  const [vx0, vy0, vx1, vy1] = rect;
  const minPx = 0.35 / scale;
  const thin = 1 / scale;
  const { layers, ltypes, fg, bg } = opt;
  const lwOn = S.lw, lwK = S.lwScale / 100 / scale; // 1/100 mm → dünya birimi (px cinsinden kalınlık / scale)
  c.lineCap = 'butt'; c.lineJoin = 'round';
  let curKey = null, open = false;
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
    let col = opt.colorOf ? opt.colorOf(p) : (S.mono ? fg : rgbCss(p.col, fg));
    if (col === null) continue;
    if (p.k === 0) {
      if (!p.fill && (bb[2] - bb[0]) < minPx && (bb[3] - bb[1]) < minPx) continue;
      if (p.bg) col = bg;
      if (p.fill) {
        flush(); curKey = null;
        c.globalAlpha = p.alpha; c.fillStyle = col;
        c.beginPath(); tracePath(c, p.ops); c.closePath(); c.fill('evenodd');
        c.globalAlpha = 1;
        continue;
      }
      let w = p.w > thin ? p.w : thin;
      if (lwOn && !(p.w > thin)) { const lw = (p.lw || 25) * lwK; if (lw > w) w = lw; }
      const dash = dashOf(p, ltypes, scale);
      const key = col + '|' + w + '|' + (dash ? p.lt + '@' + p.lts : '');
      if (key !== curKey) {
        flush();
        c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash || []);
        c.beginPath(); open = true; curKey = key;
      } else if (!open) { c.beginPath(); open = true; }
      tracePath(c, p.ops);
      if (p.closed) c.closePath();
    } else if (p.k === 1) {
      if (!S.showText) continue;
      if (p.h * scale < 2.2) continue;
      flush(); curKey = null;
      drawText(c, p, fg, col);
    } else if (p.k === 2) {
      flush(); curKey = null;
      const s = 3 / scale;
      c.strokeStyle = col; c.lineWidth = thin; c.setLineDash([]);
      c.beginPath(); c.moveTo(p.x - s, p.y); c.lineTo(p.x + s, p.y); c.moveTo(p.x, p.y - s); c.lineTo(p.x, p.y + s); c.stroke();
    } else if (p.k === 3) {
      flush(); curKey = null;
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
}

/** Karşılaştırma modu renkleri */
function compareColorOf(fg) {
  const cmp = S.compare;
  if (!cmp) return null;
  return (p) => {
    const st = cmp.mark.get(p);
    if (st === 'removed') return '#ff453a';
    if (st === 'added') return '#30d158';
    return S.dark ? '#6b7683' : '#9aa5b1';
  };
}

/** Bir kareyi baştan sona çizer (arka plan + altlık + ilkeller + görünüm pencereleri) */
export function drawFrame(c, cv) {
  const bg = bgColor(), fg = fgColor();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = bg;
  c.fillRect(0, 0, cv.width, cv.height);
  if (!S.hasDoc) return;
  const { scale, cx, cy } = S.view;
  const k = scale * S.dpr;
  c.setTransform(k, 0, 0, -k, cv.width / 2 - k * cx, cv.height / 2 + k * cy);
  const rect = visibleRect();
  const layout = S.scene.layouts[S.layoutIndex];
  const model = S.scene.layouts[0];
  const opt = { layers: S.layers, ltypes: S.ltypes, fg, bg, tree: null };
  if (layout.isModel) {
    drawBasemap(c);
    const colorOf = compareColorOf(fg);
    drawPrims(c, S.prims, scale, rect, { ...opt, tree: S.tree, colorOf });
    if (S.compare) drawPrims(c, S.compare.prims, scale, rect, { ...opt, tree: S.compare.tree, colorOf: (p) => S.compare.mark.get(p) === 'added' ? '#30d158' : null });
  } else {
    // kâğıt: çerçeve
    c.fillStyle = S.dark ? '#242b35' : '#f4f5f7';
    c.fillRect(layout.ext[0], layout.ext[1], layout.ext[2] - layout.ext[0], layout.ext[3] - layout.ext[1]);
    for (const vp of layout.viewports) {
      if (!vp.on) continue;
      c.save();
      c.beginPath(); c.rect(vp.x0, vp.y0, vp.x1 - vp.x0, vp.y1 - vp.y0); c.clip();
      c.strokeStyle = S.dark ? '#3a4656' : '#c9d0d8'; c.lineWidth = 1 / scale; c.stroke();
      const mcx = (vp.x0 + vp.x1) / 2, mcy = (vp.y0 + vp.y1) / 2;
      c.translate(mcx, mcy); c.scale(vp.scale, vp.scale); if (vp.twist) c.rotate(vp.twist); c.translate(-vp.cx, -vp.cy);
      const ms = scale * vp.scale;
      const hw = (vp.x1 - vp.x0) / 2 / vp.scale, hh = (vp.y1 - vp.y0) / 2 / vp.scale;
      const rr = vp.twist ? [vp.cx - Math.hypot(hw, hh), vp.cy - Math.hypot(hw, hh), vp.cx + Math.hypot(hw, hh), vp.cy + Math.hypot(hw, hh)] : [vp.cx - hw, vp.cy - hh, vp.cx + hw, vp.cy + hh];
      drawPrims(c, model.prims, ms, rr, { ...opt, tree: S.tree });
      c.restore();
    }
    drawPrims(c, S.prims, scale, rect, opt);
  }
}

/** Belirli bir dünya dikdörtgenini verilen piksel boyutunda ayrı bir tuvale çizer (PNG/PDF için) */
export function renderRegion(bb, pxW, pxH, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = pxW; cv.height = pxH;
  const c = cv.getContext('2d');
  const save = { view: { ...S.view }, W: S.W, H: S.H, dpr: S.dpr, dark: S.dark };
  S.W = pxW; S.H = pxH; S.dpr = 1;
  if (opts.light) S.dark = false;
  S.view.scale = Math.min(pxW / (bb[2] - bb[0]), pxH / (bb[3] - bb[1]));
  S.view.cx = (bb[0] + bb[2]) / 2; S.view.cy = (bb[1] + bb[3]) / 2;
  try { drawFrame(c, cv); if (opts.overlay) opts.overlay(c, cv); }
  finally { S.view = save.view; S.W = save.W; S.H = save.H; S.dpr = save.dpr; S.dark = save.dark; }
  return cv;
}
