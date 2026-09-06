/*
 * DWG Görüntüleyici – çizim çekirdeği.
 *
 * Akış:  dosya baytları → LibreDWG (WebAssembly) → DwgDatabase (JS nesnesi)
 *        → SceneBuilder: bloklar açılır, her varlık dünya koordinatında bir
 *          "ilkel"e (yol / yazı / nokta) çevrilir
 *        → render(): tuvale çizim (görünüm dönüşümü + katman süzgeci)
 *
 * İlkel türleri:
 *   k=0 yol   : ops = [[0,x,y] moveTo, [1,x,y] lineTo, [2,cx,cy,r,a0,a1] yay (saat yönü tersi),
 *                      [-2,cx,cy,r,a0,a1] yay (saat yönü), [3,cx,cy,rx,ry,rot,a0,a1] elips];
 *               closed, fill, alpha, w (dünya birimi genişlik), bg (arka plan rengiyle dolgu = maske)
 *   k=1 yazı  : x,y,h,rot,lines[],ha,va,ws
 *   k=2 nokta : x,y
 * Ortak alanlar: col (RGB tam sayı; -1 = ön plan rengi), lay (etkin katman), lt (çizgi tipi),
 *                bb [minx,miny,maxx,maxy], e (üst düzey varlık), et (alt varlık türü)
 */
import { LibreDwg, Dwg_File_Type } from './lib/dist/libredwg-web.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const FG = -1; // ön plan rengi (ACI 7 / saf beyaz / saf siyah)

// ---------------------------------------------------------------------------
// ACI (AutoCAD Color Index) paleti
// ---------------------------------------------------------------------------
function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}
const ACI = new Array(256).fill(0);
(() => {
  const base = [0x000000, 0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xffffff, 0x808080, 0xc0c0c0];
  for (let i = 0; i < 10; i++) ACI[i] = base[i];
  const levels = [1, 0.8, 0.6, 0.5, 0.3];
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15, k = (i - 10) % 10;
    ACI[i] = hsv(hue, k % 2 ? 0.5 : 1, levels[Math.floor(k / 2)]);
  }
  const grays = [51, 91, 132, 173, 214, 255];
  for (let i = 250; i < 256; i++) ACI[i] = (grays[i - 250] << 16) | (grays[i - 250] << 8) | grays[i - 250];
  ACI[7] = FG;
})();
const rgbCss = (c, fg) => c === FG ? fg : '#' + (c & 0xffffff).toString(16).padStart(6, '0');

// ---------------------------------------------------------------------------
// 2B afin dönüşüm: [a,b,c,d,e,f]  x' = a x + c y + e,  y' = b x + d y + f
// ---------------------------------------------------------------------------
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const isIdent = (m) => m === IDENT || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);
// benzerlik: döndürme + eşit ölçek, aynalama yok → yaylar yay kalır
const isSim = (m) => Math.abs(m[0] - m[3]) < 1e-9 && Math.abs(m[1] + m[2]) < 1e-9;
const simScale = (m) => Math.hypot(m[0], m[1]);
const simRot = (m) => Math.atan2(m[1], m[0]);
function insertMatrix(ins, base, dx = 0, dy = 0) {
  const r = ins.rotation || 0, cs = Math.cos(r), sn = Math.sin(r);
  const sx = ins.xScale || 1, sy = ins.yScale || 1;
  const p = ins.insertionPoint || { x: 0, y: 0 };
  let m = [cs, sn, -sn, cs, p.x, p.y];               // T(ip)·R
  if (dx || dy) m = mul(m, [1, 0, 0, 1, dx, dy]);      // sütun/satır kaydırması
  m = mul(m, [sx, 0, 0, sy, 0, 0]);                    // S
  if (base && (base.x || base.y)) m = mul(m, [1, 0, 0, 1, -base.x, -base.y]); // T(-base)
  return m;
}

// ---------------------------------------------------------------------------
// Geometri yardımcıları
// ---------------------------------------------------------------------------
function arcPts(cx, cy, r, a0, a1, out) {
  let d = a1 - a0;
  while (d <= 0) d += TAU;
  const n = Math.max(8, Math.ceil(d / (Math.PI / 60)));
  for (let i = 0; i <= n; i++) {
    const a = a0 + d * i / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
}
function ellipsePts(cx, cy, rx, ry, rot, a0, a1, out) {
  let d = a1 - a0;
  while (d <= 0) d += TAU;
  const n = Math.max(16, Math.ceil(d / (Math.PI / 60)));
  const cs = Math.cos(rot), sn = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const a = a0 + d * i / n, x = rx * Math.cos(a), y = ry * Math.sin(a);
    out.push([cx + x * cs - y * sn, cy + x * sn + y * cs]);
  }
}
/** bulge'lı çokgen kenarını yay işlemine çevirir; ops'a ekler */
function bulgeArc(x1, y1, x2, y2, b, ops) {
  const theta = 4 * Math.atan(b);
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  if (d < 1e-12 || Math.abs(theta) < 1e-9) { ops.push([1, x2, y2]); return; }
  const r = d / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const h = Math.sqrt(Math.max(0, r * r - d * d / 4));
  const s = b > 0 ? 1 : -1;
  const cx = mx - s * h * dy / d, cy = my + s * h * dx / d;
  const a0 = Math.atan2(y1 - cy, x1 - cx), a1 = Math.atan2(y2 - cy, x2 - cx);
  if (b > 0) ops.push([2, cx, cy, r, a0, a1]); else ops.push([-2, cx, cy, r, a0, a1]); // -2: saat yönünde a0 → a1
}
/** B-spline (de Boor) örnekleme */
function bsplinePts(cps, degree, knots, weights, closed) {
  const n = cps.length;
  if (n < 2) return cps.map(p => [p.x, p.y]);
  let k = knots && knots.length >= n + degree + 1 ? knots.slice() : null;
  if (!k) { // düzgün açık düğüm vektörü
    k = [];
    for (let i = 0; i < n + degree + 1; i++) k.push(i < degree + 1 ? 0 : i > n - 1 ? n - degree : i - degree);
  }
  const t0 = k[degree], t1 = k[n];
  const samples = Math.min(2000, Math.max(24, n * 10));
  const out = [];
  for (let s = 0; s <= samples; s++) {
    const t = s === samples ? t1 : t0 + (t1 - t0) * s / samples;
    let span = degree;
    while (span < n - 1 && t >= k[span + 1]) span++;
    const dx = [], dy = [], dw = [];
    for (let j = 0; j <= degree; j++) {
      const p = cps[span - degree + j], w = weights && weights.length === n ? weights[span - degree + j] : 1;
      dx.push(p.x * w); dy.push(p.y * w); dw.push(w);
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = span - degree + j;
        const den = k[i + degree - r + 1] - k[i];
        const a = den === 0 ? 0 : (t - k[i]) / den;
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
      }
    }
    const w = dw[degree] || 1;
    out.push([dx[degree] / w, dy[degree] / w]);
  }
  if (closed && out.length) out.push(out[0]);
  return out;
}
/** Uydurma noktalarından geçen Catmull-Rom eğrisi */
function catmullPts(pts, closed) {
  const n = pts.length;
  if (n < 3) return pts.map(p => [p.x, p.y]);
  const P = (i) => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < 10; s++) {
      const t = s / 10, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)]);
    }
  }
  const last = closed ? pts[0] : pts[n - 1];
  out.push([last.x, last.y]);
  return out;
}

// ---------------------------------------------------------------------------
// MTEXT biçim kodlarını temizle
// ---------------------------------------------------------------------------
function mtextLines(raw) {
  if (raw == null) return [];
  let s = String(raw);
  s = s.replace(/\\\\/g, '\x01');
  s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ');
  s = s.replace(/\\S([^;]*?)\^([^;]*?);/g, '$1/$2');          // kesirli (üst^alt)
  s = s.replace(/\\[fF][^;]*;/g, '').replace(/\\p[^;]*;/g, '');
  s = s.replace(/\\[CcHhWwQqTtAa][0-9.\-x]*;?/g, '');
  s = s.replace(/\\[LlOoKkNXx]/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, 'Ø').replace(/%%[uUoO]/g, '').replace(/%%%/g, '%');
  s = s.replace(/\x01/g, '\\');
  return s.split('\n');
}
function textPlain(t) { return mtextLines(t).join(' '); }

// ---------------------------------------------------------------------------
// Sahne kurma
// ---------------------------------------------------------------------------
const S = {
  prims: [], layers: new Map(), ltypes: new Map(), ext: null, hasDoc: false,
  view: { scale: 1, cx: 0, cy: 0 }, fileName: '', units: '', version: '', counts: {},
  dark: true, showText: true, mode: 'view', measure: [], snap: null, selected: null,
  lastRenderMs: 0, cacheValid: false, cacheView: null, entityCount: 0, blockCount: 0, gestureActive: false,
};

function layerColor(l) {
  if (l.colorIndex >= 1 && l.colorIndex <= 255) return ACI[l.colorIndex];
  if (typeof l.color === 'number' && l.color !== 0xffffff && l.color !== 0) return l.color & 0xffffff;
  return FG;
}
function normColor(c) { return (c === 0xffffff || c === 0) ? FG : c; }

class SceneBuilder {
  constructor(db) {
    this.db = db;
    this.prims = [];
    this.blocksByName = new Map();
    this.blocksByHandle = new Map();
    for (const b of db.tables.BLOCK_RECORD.entries) {
      this.blocksByName.set((b.name || '').toUpperCase(), b);
      this.blocksByHandle.set(b.handle, b);
    }
    this.layers = new Map();
    for (const l of db.tables.LAYER.entries) {
      this.layers.set(l.name, { name: l.name, color: layerColor(l), lt: l.lineType || 'Continuous',
        frozen: !!l.frozen, off: !!l.off, visible: !(l.frozen || l.off), count: 0 });
    }
    this.ltypes = new Map();
    for (const lt of db.tables.LTYPE.entries) {
      const pat = (lt.pattern || []).map(p => p.elementLength || 0);
      if (pat.length && lt.totalPatternLength > 0) this.ltypes.set(lt.name.toUpperCase(), { name: lt.name, pat, len: lt.totalPatternLength });
    }
    this.ltscale = db.header.LTSCALE || 1;
    this.deferred = [];
    this.counts = {};
  }

  layerOf(name) {
    let l = this.layers.get(name);
    if (!l) { l = { name, color: FG, lt: 'Continuous', frozen: false, off: false, visible: true, count: 0 }; this.layers.set(name, l); }
    return l;
  }

  /** Alt varlığın etkin katmanı, rengi ve çizgi tipi (blok bağlamıyla) */
  style(e, ctx) {
    const layName = (e.layer === '0' && ctx.layer) ? ctx.layer : (e.layer || '0');
    const lay = this.layerOf(layName);
    let col;
    if (typeof e.color === 'number' && e.colorIndex !== 0 && !(e.colorIndex >= 1 && e.colorIndex <= 255)) col = normColor(e.color & 0xffffff);
    else if (e.colorIndex === 0) col = ctx.color != null ? ctx.color : lay.color;   // BYBLOCK
    else if (e.colorIndex >= 1 && e.colorIndex <= 255) col = ACI[e.colorIndex];
    else col = lay.color;                                                       // BYLAYER
    let lt = e.lineType || '';
    const u = lt.toUpperCase();
    if (!u || u === 'BYLAYER') lt = lay.lt; else if (u === 'BYBLOCK') lt = ctx.lt || lay.lt;
    const ltu = (lt || 'CONTINUOUS').toUpperCase();
    const ltd = this.ltypes.get(ltu);
    const lts = this.ltscale * (e.lineTypeScale || 1) * (ctx.lts || 1);
    return { lay: layName, col, lt: ltd ? { key: ltu + '@' + lts.toFixed(4), pat: ltd.pat, len: ltd.len, scale: lts } : null };
  }

  count(t) { this.counts[t] = (this.counts[t] || 0) + 1; }

  build() {
    const db = this.db;
    let ms = null;
    for (const b of db.tables.BLOCK_RECORD.entries) if (/^\*MODEL_SPACE$/i.test(b.name || '')) { ms = b; break; }
    let ents = ms && ms.entities && ms.entities.length ? ms.entities : null;
    if (!ents) {
      const paper = new Set(db.tables.BLOCK_RECORD.entries.filter(b => /^\*PAPER_SPACE/i.test(b.name || '')).map(b => b.handle));
      ents = db.entities.filter(e => !paper.has(e.ownerBlockRecordSoftId) && !e.isInPaperSpace && e.type !== 'ATTRIB' && e.type !== 'VIEWPORT');
    }
    const root = { m: IDENT, layer: null, color: null, lt: null, lts: 1, depth: 0, top: null };
    for (const e of ents) {
      try { this.entity(e, root); } catch (err) { console.warn('varlık atlandı', e.type, err); }
    }
    // Uzantıları hesapla, sonra sonsuz çizgileri (XLINE/RAY) ekle
    const ext = this.extents(this.prims);
    for (const d of this.deferred) this.infinite(d.e, d.ctx, ext);
    return { prims: this.prims, layers: this.layers, ltypes: this.ltypes, ext: this.extents(this.prims) || ext || [0, 0, 1, 1],
      counts: this.counts, entityCount: ents.length, blockCount: this.blocksByName.size };
  }

  extents(prims) {
    let ok = false;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of prims) {
      if (p.inf || !p.bb || !isFinite(p.bb[0])) continue;
      ok = true;
      if (p.bb[0] < bb[0]) bb[0] = p.bb[0];
      if (p.bb[1] < bb[1]) bb[1] = p.bb[1];
      if (p.bb[2] > bb[2]) bb[2] = p.bb[2];
      if (p.bb[3] > bb[3]) bb[3] = p.bb[3];
    }
    return ok ? bb : null;
  }

  // ---- ilkel ekleme ------------------------------------------------------
  addPath(ops, opt, e, ctx) {
    if (!ops.length) return null;
    const m = ctx.m;
    let out;
    if (isIdent(m)) out = ops;
    else if (isSim(m)) {
      const s = simScale(m), r = simRot(m);
      out = ops.map(o => {
        if (o[0] === 0 || o[0] === 1) { const p = apply(m, o[1], o[2]); return [o[0], p[0], p[1]]; }
        if (o[0] === 2 || o[0] === -2) { const p = apply(m, o[1], o[2]); return [o[0], p[0], p[1], o[3] * s, o[4] + r, o[5] + r]; }
        const p = apply(m, o[1], o[2]); return [3, p[0], p[1], o[3] * s, o[4] * s, o[5] + r, o[6], o[7]];
      });
    } else {
      out = [];
      for (const o of ops) {
        if (o[0] === 0 || o[0] === 1) { const p = apply(m, o[1], o[2]); out.push([o[0], p[0], p[1]]); continue; }
        const pts = [];
        if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], pts);
        else if (o[0] === -2) { arcPts(o[1], o[2], o[3], o[5], o[4], pts); pts.reverse(); }
        else ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
        for (let i = 0; i < pts.length; i++) {
          const p = apply(m, pts[i][0], pts[i][1]);
          out.push([out.length ? 1 : 0, p[0], p[1]]);
        }
      }
    }
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const o of out) {
      let x0, y0, x1, y1;
      if (o[0] === 0 || o[0] === 1) { x0 = x1 = o[1]; y0 = y1 = o[2]; }
      else if (o[0] === 2 || o[0] === -2) { x0 = o[1] - o[3]; x1 = o[1] + o[3]; y0 = o[2] - o[3]; y1 = o[2] + o[3]; }
      else { const r = Math.max(o[3], o[4]); x0 = o[1] - r; x1 = o[1] + r; y0 = o[2] - r; y1 = o[2] + r; }
      if (x0 < bb[0]) bb[0] = x0;
      if (y0 < bb[1]) bb[1] = y0;
      if (x1 > bb[2]) bb[2] = x1;
      if (y1 > bb[3]) bb[3] = y1;
    }
    const st = this.style(e, ctx);
    const scale = isIdent(m) ? 1 : Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const p = { k: 0, ops: out, closed: !!opt.closed, fill: !!opt.fill, alpha: opt.alpha == null ? 1 : opt.alpha,
      w: (opt.w || 0) * scale, col: opt.col != null ? opt.col : st.col, lay: st.lay, lt: opt.fill ? null : st.lt, bb,
      e: ctx.top || e, et: e.type, bg: !!opt.bg };
    this.prims.push(p);
    this.layerOf(st.lay).count++;
    return p;
  }

  addText(t, e, ctx, opt = {}) {
    if (!t || !t.text) return;
    const lines = mtextLines(t.text).filter((l, i, a) => l.length || a.length === 1);
    if (!lines.length || !lines.join('').trim()) return;
    const h = t.textHeight || t.height || 0;
    if (!(h > 0)) return;
    let x = t.startPoint ? t.startPoint.x : 0, y = t.startPoint ? t.startPoint.y : 0;
    const ha = t.halign || 0, va = t.valign || 0;
    // Hizalı yazıda konum, hizalama noktasıdır (endPoint)
    if ((ha !== 0 || va !== 0) && t.endPoint && (t.endPoint.x !== 0 || t.endPoint.y !== 0)) { x = t.endPoint.x; y = t.endPoint.y; }
    const hax = ha === 1 || ha === 4 ? 1 : ha === 2 ? 2 : ha === 3 || ha === 5 ? 1 : 0;
    const vay = ha === 4 ? 2 : va;
    let rot = t.rotation || 0;
    if ((ha === 3 || ha === 5) && t.endPoint && t.startPoint) { // ALIGNED / FIT: iki nokta arası
      const dx = t.endPoint.x - t.startPoint.x, dy = t.endPoint.y - t.startPoint.y;
      rot = Math.atan2(dy, dx); x = (t.startPoint.x + t.endPoint.x) / 2; y = (t.startPoint.y + t.endPoint.y) / 2;
    }
    this.pushText(x, y, h, rot, lines, hax, vay, t.xScale || 1, e, ctx, opt);
  }

  pushText(x, y, h, rot, lines, hax, vay, ws, e, ctx, opt = {}) {
    const m = ctx.m;
    if (!isIdent(m)) {
      const p = apply(m, x, y); x = p[0]; y = p[1];
      const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      h *= s; rot += Math.atan2(m[1], m[0]);
      if (m[0] * m[3] - m[1] * m[2] < 0) rot = -rot; // aynalanmış blok
    }
    const maxLen = Math.max(...lines.map(l => l.length));
    const wEst = maxLen * h * 0.75 * ws, hEst = h * (1 + 1.667 * (lines.length - 1));
    const R = Math.hypot(wEst, hEst);
    const st = this.style(e, ctx);
    const p = { k: 1, x, y, h, rot, lines, ha: hax, va: vay, ws, col: opt.col != null ? opt.col : st.col, lay: st.lay,
      bb: [x - R, y - R, x + R, y + R], e: ctx.top || e, et: e.type, spacing: opt.spacing || 1 };
    this.prims.push(p);
    this.layerOf(st.lay).count++;
  }

  addPoint(x, y, e, ctx) {
    const p = apply(ctx.m, x, y);
    const st = this.style(e, ctx);
    this.prims.push({ k: 2, x: p[0], y: p[1], col: st.col, lay: st.lay, bb: [p[0], p[1], p[0], p[1]], e: ctx.top || e, et: e.type });
    this.layerOf(st.lay).count++;
  }

  // ---- varlıklar -----------------------------------------------------------
  entity(e, ctx) {
    if (!e || e.isVisible === false) return;
    if (ctx.depth === 0) this.count(e.type);
    const flipX = !!(e.extrusionDirection && e.extrusionDirection.z < -0.5);
    switch (e.type) {
      case 'LINE': {
        const a = e.startPoint, b = e.endPoint;
        this.addPath([[0, a.x, a.y], [1, b.x, b.y]], {}, e, ctx);
        break;
      }
      case 'LWPOLYLINE': case 'POLYLINE2D': {
        let vs = e.vertices || [];
        if (e.type === 'POLYLINE2D') {
          const hasSpline = vs.some(v => v.flag & 8);
          vs = vs.filter(v => hasSpline ? (v.flag & 8) : !(v.flag & 16));
        }
        if (vs.length < 1) break;
        const closed = !!(e.flag & 1);
        const ops = [];
        const X = (v) => flipX ? -v.x : v.x;
        ops.push([0, X(vs[0]), vs[0].y]);
        for (let i = 0; i < vs.length - 1; i++) {
          const b = (vs[i].bulge || 0) * (flipX ? -1 : 1);
          if (b) bulgeArc(X(vs[i]), vs[i].y, X(vs[i + 1]), vs[i + 1].y, b, ops); else ops.push([1, X(vs[i + 1]), vs[i + 1].y]);
        }
        if (closed && vs.length > 1) {
          const l = vs[vs.length - 1], b = (l.bulge || 0) * (flipX ? -1 : 1);
          if (b) bulgeArc(X(l), l.y, X(vs[0]), vs[0].y, b, ops); else ops.push([1, X(vs[0]), vs[0].y]);
        }
        let w = e.constantWidth || 0;
        if (!w) {
          const sw = vs.map(v => Math.max(v.startWidth || 0, v.endWidth || 0));
          w = Math.max(0, ...sw);
          if (e.type === 'POLYLINE2D') w = Math.max(w, e.startWidth || 0, e.endWidth || 0);
        }
        this.addPath(ops, { closed, w }, e, ctx);
        break;
      }
      case 'POLYLINE3D': {
        const vs = e.vertices || [];
        if (vs.length < 2) break;
        const ops = [[0, vs[0].x, vs[0].y]];
        for (let i = 1; i < vs.length; i++) ops.push([1, vs[i].x, vs[i].y]);
        this.addPath(ops, { closed: !!(e.flag & 1) }, e, ctx);
        break;
      }
      case 'POLYLINE_PFACE': case 'POLYLINE_MESH': case 'POLYFACE': {
        const vs = e.vertices || [];
        const locs = vs.filter(v => !(v.flag & 128));
        const faces = vs.filter(v => (v.flag & 128));
        if (faces.length) {
          for (const f of faces) {
            const idx = [f.polyfaceIndex0, f.polyfaceIndex1, f.polyfaceIndex2, f.polyfaceIndex3].filter(i => i);
            const pts = idx.map(i => locs[Math.abs(i) - 1]).filter(Boolean);
            if (pts.length >= 2) {
              const ops = [[0, pts[0].x, pts[0].y]];
              for (let i = 1; i < pts.length; i++) ops.push([1, pts[i].x, pts[i].y]);
              this.addPath(ops, { closed: pts.length > 2 }, e, ctx);
            }
          }
        } else if (locs.length > 1) {
          const ops = [[0, locs[0].x, locs[0].y]];
          for (let i = 1; i < locs.length; i++) ops.push([1, locs[i].x, locs[i].y]);
          this.addPath(ops, {}, e, ctx);
        }
        break;
      }
      case 'CIRCLE': {
        const cx = flipX ? -e.center.x : e.center.x;
        this.addPath([[0, cx + e.radius, e.center.y], [2, cx, e.center.y, e.radius, 0, TAU]], { closed: true }, e, ctx);
        break;
      }
      case 'ARC': {
        let a0 = e.startAngle, a1 = e.endAngle, cx = e.center.x;
        if (flipX) { cx = -cx; const t = Math.PI - a0; a0 = Math.PI - a1; a1 = t; }
        this.addPath([[0, cx + e.radius * Math.cos(a0), e.center.y + e.radius * Math.sin(a0)], [2, cx, e.center.y, e.radius, a0, a1]], {}, e, ctx);
        break;
      }
      case 'ELLIPSE': {
        const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y;
        const rx = Math.hypot(mx, my), ry = rx * (e.axisRatio || 1), rot = Math.atan2(my, mx);
        const a0 = e.startAngle || 0, a1 = e.endAngle == null ? TAU : e.endAngle;
        const full = Math.abs((a1 - a0) - TAU) < 1e-6 || Math.abs(a1 - a0) < 1e-9;
        const sx = e.center.x + rx * Math.cos(a0) * Math.cos(rot) - ry * Math.sin(a0) * Math.sin(rot);
        const sy = e.center.y + rx * Math.cos(a0) * Math.sin(rot) + ry * Math.sin(a0) * Math.cos(rot);
        this.addPath([[0, sx, sy], [3, e.center.x, e.center.y, rx, ry, rot, a0, full ? a0 + TAU : a1]], { closed: full }, e, ctx);
        break;
      }
      case 'SPLINE': {
        const closed = !!(e.flag & 1);
        let pts;
        if (e.controlPoints && e.controlPoints.length >= 2) pts = bsplinePts(e.controlPoints, e.degree || 3, e.knots, e.weights, closed && !(e.knots && e.knots.length));
        else if (e.fitPoints && e.fitPoints.length >= 2) pts = catmullPts(e.fitPoints, closed);
        else break;
        const ops = [[0, pts[0][0], pts[0][1]]];
        for (let i = 1; i < pts.length; i++) ops.push([1, pts[i][0], pts[i][1]]);
        this.addPath(ops, {}, e, ctx);
        break;
      }
      case 'POINT': this.addPoint(e.position.x, e.position.y, e, ctx); break;
      case 'TEXT': this.addText(e, e, ctx); break;
      case 'ATTRIB': if (e.text && !(e.flags & 1)) this.addText(e.text, e, ctx); break;
      case 'ATTDEF': if (e.text && (e.flags & 2) && !(e.flags & 1)) this.addText(e.text, e, ctx); break;
      case 'MTEXT': {
        const lines = this.wrapMText(e);
        if (!lines.length || !(e.textHeight > 0)) break;
        const ap = e.attachmentPoint || 1;
        const hax = (ap - 1) % 3, vay = ap <= 3 ? 3 : ap <= 6 ? 2 : 1;
        let rot = e.rotation || 0;
        if (e.direction && (Math.abs(e.direction.x) > 1e-9 || Math.abs(e.direction.y) > 1e-9)) rot = Math.atan2(e.direction.y, e.direction.x);
        this.pushText(e.insertionPoint.x, e.insertionPoint.y, e.textHeight, rot, lines, hax, vay, 1, e, ctx, { spacing: e.lineSpacing || 1 });
        break;
      }
      case 'INSERT': this.insert(e, ctx); break;
      case 'DIMENSION': case 'ARC_DIMENSION': case 'LARGE_RADIAL_DIMENSION': {
        const blk = e.name ? this.blocksByName.get(e.name.toUpperCase()) : null;
        if (blk && blk.entities && blk.entities.length) {
          this.block(blk, { ...ctx, layer: e.layer, color: this.style(e, ctx).col, lt: e.lineType, depth: ctx.depth + 1, top: ctx.top || e });
        } else if (e.textPoint) {
          const txt = e.text && e.text !== '<>' ? e.text : (e.measurement != null ? fmt(e.measurement) : '');
          if (txt) this.pushText(e.textPoint.x, e.textPoint.y, this.dimTextHeight(e), e.textRotation || 0, mtextLines(txt), 1, 2, 1, e, ctx);
        }
        break;
      }
      case 'ACAD_TABLE': case 'TABLE': {
        const blk = e.blockRecordHandle ? this.blocksByHandle.get(e.blockRecordHandle) : null;
        if (blk && blk.entities) this.block(blk, { ...ctx, depth: ctx.depth + 1, top: ctx.top || e });
        break;
      }
      case 'HATCH': this.hatch(e, ctx); break;
      case 'SOLID': case 'TRACE': {
        const c = [e.corner1, e.corner2, e.corner4 || e.corner3, e.corner3].filter(Boolean);
        const ops = [[0, c[0].x, c[0].y]];
        for (let i = 1; i < c.length; i++) ops.push([1, c[i].x, c[i].y]);
        this.addPath(ops, { closed: true, fill: true, alpha: 0.9 }, e, ctx);
        break;
      }
      case '3DFACE': {
        const c = [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean);
        if (c.length < 2) break;
        const ops = [[0, c[0].x, c[0].y]];
        for (let i = 1; i < c.length; i++) ops.push([1, c[i].x, c[i].y]);
        this.addPath(ops, { closed: true }, e, ctx);
        break;
      }
      case 'LEADER': {
        const vs = e.vertices || [];
        if (vs.length < 2) break;
        const ops = [[0, vs[0].x, vs[0].y]];
        for (let i = 1; i < vs.length; i++) ops.push([1, vs[i].x, vs[i].y]);
        this.addPath(ops, {}, e, ctx);
        break;
      }
      case 'MULTILEADER': case 'MLEADER': {
        for (const sec of e.leaderSections || []) {
          for (const ln of sec.leaderLines || []) {
            const vs = (ln.vertices || []).slice();
            if (sec.lastLeaderLinePoint && sec.doglegVector && sec.doglegLength) {
              vs.push(sec.lastLeaderLinePoint);
              vs.push({ x: sec.lastLeaderLinePoint.x + sec.doglegVector.x * sec.doglegLength, y: sec.lastLeaderLinePoint.y + sec.doglegVector.y * sec.doglegLength });
            }
            if (vs.length < 2) continue;
            const ops = [[0, vs[0].x, vs[0].y]];
            for (let i = 1; i < vs.length; i++) ops.push([1, vs[i].x, vs[i].y]);
            this.addPath(ops, {}, e, ctx);
          }
        }
        if (e.textContent && e.textHeight > 0) {
          const p = e.textAnchor || e.contentBasePosition;
          if (p) this.pushText(p.x, p.y, e.textHeight, e.textRotation || 0, mtextLines(e.textContent), 0, 1, 1, e, ctx);
        }
        if (e.blockContent && e.blockContent.blockContentId) {
          const blk = this.blocksByHandle.get(e.blockContent.blockContentId);
          const bc = e.blockContent;
          if (blk && bc.position) {
            const ins = { insertionPoint: bc.position, rotation: bc.rotation || 0, xScale: bc.scale ? bc.scale.x : 1, yScale: bc.scale ? bc.scale.y : 1 };
            this.block(blk, { ...ctx, m: mul(ctx.m, insertMatrix(ins, blk.basePoint)), depth: ctx.depth + 1, top: ctx.top || e, layer: e.layer });
          }
        }
        break;
      }
      case 'MLINE': {
        const vs = e.vertices || [];
        if (vs.length < 2) break;
        const n = e.numberOfLines || (vs[0].lines ? vs[0].lines.length : 1);
        for (let j = 0; j < n; j++) {
          const ops = [];
          for (let i = 0; i < vs.length; i++) {
            const v = vs[i], off = v.lines && v.lines[j] && v.lines[j].segmentParams ? (v.lines[j].segmentParams[0] || 0) : 0;
            const md = v.miterDirection || { x: 0, y: 0 };
            ops.push([ops.length ? 1 : 0, v.vertex.x + md.x * off, v.vertex.y + md.y * off]);
          }
          this.addPath(ops, { closed: !!(e.flags & 2) }, e, ctx);
        }
        break;
      }
      case 'XLINE': case 'RAY': this.deferred.push({ e, ctx }); break;
      case 'TOLERANCE': {
        if (e.text && e.insertionPoint) this.pushText(e.insertionPoint.x, e.insertionPoint.y, 2.5, 0, mtextLines(e.text.replace(/%%v/g, '|')), 0, 0, 1, e, ctx);
        break;
      }
      case 'IMAGE': {
        if (e.position && e.uPixel && e.vPixel && e.imageSize) {
          const p = e.position, u = e.uPixel, v = e.vPixel, w = e.imageSize.x, h = e.imageSize.y;
          const c = [[p.x, p.y], [p.x + u.x * w, p.y + u.y * w], [p.x + u.x * w + v.x * h, p.y + u.y * w + v.y * h], [p.x + v.x * h, p.y + v.y * h]];
          this.addPath([[0, c[0][0], c[0][1]], [1, c[1][0], c[1][1]], [1, c[2][0], c[2][1]], [1, c[3][0], c[3][1]]], { closed: true }, e, ctx);
        }
        break;
      }
      case 'WIPEOUT': {
        if (e.position && e.uPixel && e.vPixel && e.clippingBoundaryPath && e.clippingBoundaryPath.length > 2) {
          const p = e.position, u = e.uPixel, v = e.vPixel;
          const ops = e.clippingBoundaryPath.map((b, i) => {
            const bx = b.x + 0.5, by = 0.5 - b.y;
            return [i ? 1 : 0, p.x + u.x * bx + v.x * by, p.y + u.y * bx + v.y * by];
          });
          this.addPath(ops, { closed: true, fill: true, bg: true, alpha: 1 }, e, ctx);
        }
        break;
      }
      default: break; // 3DSOLID, REGION, BODY, VIEWPORT, PROXY, SHAPE…: geometrisi yok ya da kâğıt uzayı
    }
  }

  dimTextHeight(e) {
    const ds = this.db.tables.DIMSTYLE && this.db.tables.DIMSTYLE.entries.find(d => d.name === e.styleName);
    return ds && ds.DIMTXT > 0 ? ds.DIMTXT * (ds.DIMSCALE || 1) : 2.5;
  }

  /** MTEXT satırlarını dikdörtgen genişliğine göre böler (kaba tahminle) */
  wrapMText(e) {
    const lines = mtextLines(e.text);
    const w = e.rectWidth || 0, h = e.textHeight || 0;
    if (!(w > 0) || !(h > 0)) return lines;
    const cw = h * 0.72;
    const maxChars = Math.max(1, Math.floor(w / cw));
    const out = [];
    for (const line of lines) {
      if (line.length <= maxChars) { out.push(line); continue; }
      let cur = '';
      for (const word of line.split(' ')) {
        if (!cur.length) cur = word;
        else if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
        else { out.push(cur); cur = word; }
      }
      if (cur.length) out.push(cur);
    }
    return out;
  }

  insert(e, ctx) {
    const blk = this.blocksByName.get((e.name || '').toUpperCase());
    if (!blk || ctx.depth > 24) return;
    const st = this.style(e, ctx);
    const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const m = mul(ctx.m, insertMatrix(e, blk.basePoint, c * (e.columnSpacing || 0), r * (e.rowSpacing || 0)));
        const sub = { m, layer: st.lay, color: st.col, lt: e.lineType, lts: (ctx.lts || 1) * (e.lineTypeScale || 1), depth: ctx.depth + 1, top: ctx.top || e };
        if (blk.entities) this.block(blk, sub);
      }
    }
    // Öznitelikler (ATTRIB) dünya koordinatında saklanır; blok dönüşümü uygulanmaz
    for (const a of e.attribs || []) this.entity(a, { ...ctx, layer: st.lay, color: st.col, top: ctx.top || e });
  }

  block(blk, ctx) {
    if (ctx.depth > 24) return;
    for (const s of blk.entities || []) {
      if (s.type === 'ATTDEF' && !(s.flags & 2)) continue;
      this.entity(s, ctx);
    }
  }

  hatch(e, ctx) {
    const paths = e.boundaryPaths || [];
    const ops = [];
    for (const bp of paths) {
      if (bp.vertices) {
        const vs = bp.vertices;
        if (!vs.length) continue;
        ops.push([0, vs[0].x, vs[0].y]);
        for (let i = 0; i < vs.length; i++) {
          const a = vs[i], b = vs[(i + 1) % vs.length];
          if (i === vs.length - 1 && !bp.isClosed && !(bp.boundaryPathTypeFlag & 2)) break;
          if (bp.hasBulge && a.bulge) bulgeArc(a.x, a.y, b.x, b.y, a.bulge, ops); else ops.push([1, b.x, b.y]);
        }
      } else if (bp.edges) {
        let first = true;
        for (const ed of bp.edges) {
          if (ed.type === 1) {
            if (first) ops.push([0, ed.start.x, ed.start.y]);
            ops.push([1, ed.end.x, ed.end.y]);
          } else if (ed.type === 2) {
            let a0 = ed.startAngle, a1 = ed.endAngle;
            if (Math.abs(a0) > TAU + 0.01 || Math.abs(a1) > TAU + 0.01) { a0 *= Math.PI / 180; a1 *= Math.PI / 180; }
            const pts = [];
            if (ed.isCCW !== false) arcPts(ed.center.x, ed.center.y, ed.radius, a0, a1, pts);
            else { arcPts(ed.center.x, ed.center.y, ed.radius, a1, a0, pts); pts.reverse(); }
            for (let i = 0; i < pts.length; i++) ops.push([first && i === 0 ? 0 : 1, pts[i][0], pts[i][1]]);
          } else if (ed.type === 3) {
            const rx = Math.hypot(ed.end.x, ed.end.y), ry = rx * (ed.lengthOfMinorAxis || 1), rot = Math.atan2(ed.end.y, ed.end.x);
            let a0 = ed.startAngle, a1 = ed.endAngle;
            if (Math.abs(a0) > TAU + 0.01 || Math.abs(a1) > TAU + 0.01) { a0 *= Math.PI / 180; a1 *= Math.PI / 180; }
            const pts = [];
            if (ed.isCCW !== false) ellipsePts(ed.center.x, ed.center.y, rx, ry, rot, a0, a1, pts);
            else { ellipsePts(ed.center.x, ed.center.y, rx, ry, rot, a1, a0, pts); pts.reverse(); }
            for (let i = 0; i < pts.length; i++) ops.push([first && i === 0 ? 0 : 1, pts[i][0], pts[i][1]]);
          } else if (ed.type === 4) {
            let pts;
            if (ed.controlPoints && ed.controlPoints.length >= 2) pts = bsplinePts(ed.controlPoints, ed.degree || 3, ed.knots, ed.controlPoints.map(p => p.weight == null ? 1 : p.weight), false);
            else if (ed.fitDatum && ed.fitDatum.length >= 2) pts = catmullPts(ed.fitDatum, false);
            else continue;
            for (let i = 0; i < pts.length; i++) ops.push([first && i === 0 ? 0 : 1, pts[i][0], pts[i][1]]);
          }
          first = false;
        }
      }
    }
    if (!ops.length) return;
    const solid = e.solidFill === 1 || (e.patternName || '').toUpperCase() === 'SOLID';
    this.addPath(ops, { closed: true, fill: true, alpha: solid ? 0.85 : 0.18 }, e, ctx);
  }

  infinite(e, ctx, ext) {
    const L = ext ? Math.hypot(ext[2] - ext[0], ext[3] - ext[1]) * 2 || 1000 : 1000;
    const p = e.firstPoint, d = e.unitDirection;
    const a = e.type === 'RAY' ? [p.x, p.y] : [p.x - d.x * L, p.y - d.y * L];
    const b = [p.x + d.x * L, p.y + d.y * L];
    const pr = this.addPath([[0, a[0], a[1]], [1, b[0], b[1]]], {}, e, ctx);
    if (pr) pr.inf = true;
  }
}

// ---------------------------------------------------------------------------
// Biçimleme
// ---------------------------------------------------------------------------
const nf3 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
function fmt(v, d = 3) { return (d === 2 ? nf2 : nf3).format(v); }
const UNITS = { 0: '', 1: 'inç', 2: 'ft', 3: 'mil', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 8: 'µin', 9: 'mils', 10: 'yd', 11: 'Å', 12: 'nm', 13: 'µm', 14: 'dm', 15: 'dam', 16: 'hm', 17: 'Gm' };
const TYPE_TR = { LINE: 'Çizgi', LWPOLYLINE: 'Polyline', POLYLINE2D: 'Polyline (2B)', POLYLINE3D: 'Polyline (3B)', CIRCLE: 'Daire', ARC: 'Yay',
  ELLIPSE: 'Elips', SPLINE: 'Spline', TEXT: 'Yazı', MTEXT: 'Çok satırlı yazı', INSERT: 'Blok', HATCH: 'Tarama', DIMENSION: 'Ölçü',
  POINT: 'Nokta', SOLID: 'Dolgu', '3DFACE': '3B yüzey', LEADER: 'Kılavuz çizgi', MULTILEADER: 'Çoklu kılavuz', MLINE: 'Çoklu çizgi',
  XLINE: 'Sonsuz çizgi', RAY: 'Işın', ATTRIB: 'Öznitelik', ATTDEF: 'Öznitelik tanımı', WIPEOUT: 'Maske', IMAGE: 'Resim', ACAD_TABLE: 'Tablo',
  TOLERANCE: 'Tolerans', '3DSOLID': '3B katı', REGION: 'Bölge', VIEWPORT: 'Görünüm penceresi', TRACE: 'İz' };
const trType = (t) => TYPE_TR[t] || t;
const VERSIONS = { AC1006: 'R10', AC1009: 'R11/R12', AC1012: 'R13', AC1014: 'R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018', AC1035: 'AutoCAD 2026+' };

// ---------------------------------------------------------------------------
// Tuval / görünüm
// ---------------------------------------------------------------------------
const cv = $('cv'), ov = $('ov'), vp = $('viewport');
const ctx = cv.getContext('2d', { alpha: false });
const octx = ov.getContext('2d');
const off = document.createElement('canvas');
let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
let W = 1, H = 1;

function resize() {
  const r = vp.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  for (const c of [cv, ov, off]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  S.cacheValid = false;
  requestRender();
}
new ResizeObserver(resize).observe(vp);
window.addEventListener('resize', resize);

const toWorld = (sx, sy) => [S.view.cx + (sx - W / 2) / S.view.scale, S.view.cy - (sy - H / 2) / S.view.scale];
const toScreen = (x, y) => [W / 2 + (x - S.view.cx) * S.view.scale, H / 2 - (y - S.view.cy) * S.view.scale];

function zoomExtents(bb) {
  bb = bb || S.ext;
  if (!bb) return;
  const ew = Math.max(bb[2] - bb[0], 1e-9), eh = Math.max(bb[3] - bb[1], 1e-9);
  S.view.scale = Math.min(W / ew, H / eh) * 0.92;
  if (!isFinite(S.view.scale) || S.view.scale <= 0) S.view.scale = 1;
  S.view.cx = (bb[0] + bb[2]) / 2; S.view.cy = (bb[1] + bb[3]) / 2;
  requestRender();
}

let renderQueued = false, fullTimer = 0;
function requestRender(fast) {
  if (fast && S.lastRenderMs > 40 && S.cacheValid) {
    presentCache();
    clearTimeout(fullTimer);
    fullTimer = setTimeout(() => render(), 140);
    return;
  }
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function bgColor() { return S.dark ? '#1c2129' : '#ffffff'; }
function fgColor() { return S.dark ? '#f2f4f7' : '#111111'; }

function ltDash(lt, scale) {
  if (!lt) return null;
  const total = lt.len * lt.scale;
  if (total * scale < 4) return null;
  const arr = [];
  let expectDash = true;
  for (const el of lt.pat) {
    const len = Math.abs(el) * lt.scale;
    const isDash = el > 0, isDot = el === 0;
    if (isDot) { if (!expectDash) arr.push(0); arr.push(1.5 / scale); expectDash = false; continue; }
    if (isDash !== expectDash) arr.push(0);
    arr.push(len);
    expectDash = !isDash;
  }
  if (arr.length % 2) arr.push(0);
  return arr.length ? arr : null;
}

function render() {
  const t0 = performance.now();
  const bg = bgColor(), fg = fgColor();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!S.hasDoc) { drawOverlay(); return; }
  const { scale, cx, cy } = S.view;
  const k = scale * dpr;
  ctx.setTransform(k, 0, 0, -k, cv.width / 2 - k * cx, cv.height / 2 + k * cy);
  const vx0 = cx - W / (2 * scale), vx1 = cx + W / (2 * scale), vy0 = cy - H / (2 * scale), vy1 = cy + H / (2 * scale);
  const minPx = 0.35 / scale;
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  const thin = 1 / scale;
  let curKey = null, open = false;
  const layers = S.layers;
  const flush = () => { if (open) { ctx.stroke(); open = false; } };
  const prims = S.prims;
  for (let i = 0, n = prims.length; i < n; i++) {
    const p = prims[i];
    const bb = p.bb;
    if (bb[2] < vx0 || bb[0] > vx1 || bb[3] < vy0 || bb[1] > vy1) continue;
    const L = layers.get(p.lay);
    if (L && !L.visible) continue;
    if (p.k === 0) {
      if (!p.fill && (bb[2] - bb[0]) < minPx && (bb[3] - bb[1]) < minPx) continue;
      const col = p.bg ? bg : rgbCss(p.col, fg);
      if (p.fill) {
        flush(); curKey = null;
        ctx.globalAlpha = p.alpha; ctx.fillStyle = col;
        ctx.beginPath(); tracePath(ctx, p.ops); ctx.closePath(); ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        continue;
      }
      const w = p.w > thin ? p.w : thin;
      const dash = p.lt ? ltDash(p.lt, scale) : null;
      const key = col + '|' + w + '|' + (dash ? p.lt.key : '');
      if (key !== curKey) {
        flush();
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []);
        ctx.beginPath(); open = true; curKey = key;
      } else if (!open) { ctx.beginPath(); open = true; }
      tracePath(ctx, p.ops);
      if (p.closed) ctx.closePath();
    } else if (p.k === 1) {
      if (!S.showText) continue;
      if (p.h * scale < 2.2) continue;
      flush(); curKey = null;
      drawText(p, fg);
    } else {
      flush(); curKey = null;
      const s = 3 / scale;
      ctx.strokeStyle = rgbCss(p.col, fg); ctx.lineWidth = thin; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x + s, p.y); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x, p.y + s); ctx.stroke();
    }
  }
  flush();
  ctx.setLineDash([]);
  S.lastRenderMs = performance.now() - t0;
  if (S.lastRenderMs > 40) {
    const oc = off.getContext('2d');
    oc.setTransform(1, 0, 0, 1, 0, 0);
    oc.clearRect(0, 0, off.width, off.height);
    oc.drawImage(cv, 0, 0);
    S.cacheValid = true; S.cacheView = { ...S.view };
  } else S.cacheValid = false;
  drawOverlay();
  updateStatus();
}

function tracePath(c, ops) {
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

function drawText(p, fg) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  const s = p.h / 10;
  ctx.scale(s * p.ws, -s);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = rgbCss(p.col, fg);
  ctx.textAlign = p.ha === 1 ? 'center' : p.ha === 2 ? 'right' : 'left';
  const n = p.lines.length, lh = 16.67 * (p.spacing || 1);
  // va: 0 taban, 1 alt, 2 orta, 3 üst — yazı bloğunun dikey konumu (yerel y aşağı doğru)
  let y0;
  if (p.va === 3) { ctx.textBaseline = 'top'; y0 = 0; }
  else if (p.va === 2) { ctx.textBaseline = 'middle'; y0 = -((n - 1) * lh) / 2; }
  else { ctx.textBaseline = 'alphabetic'; y0 = -(n - 1) * lh; }
  for (let i = 0; i < n; i++) ctx.fillText(p.lines[i], 0, y0 + i * lh);
  ctx.restore();
}

function presentCache() {
  const v0 = S.cacheView, v = S.view;
  const kk = v.scale / v0.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bgColor(); ctx.fillRect(0, 0, cv.width, cv.height);
  const dx = (cv.width / 2 + (v0.cx - v.cx) * v.scale * dpr) - kk * cv.width / 2;
  const dy = (cv.height / 2 - (v0.cy - v.cy) * v.scale * dpr) - kk * cv.height / 2;
  ctx.drawImage(off, dx, dy, off.width * kk, off.height * kk);
  drawOverlay();
  updateStatus();
}

// ---- kaplama: seçim, ölçü, yapışma ----------------------------------------
function drawOverlay() {
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, W, H);
  const acc = '#f5b342';
  if (S.selected && S.hasDoc) {
    const p = S.selected;
    octx.save();
    const k = S.view.scale;
    octx.setTransform(k * dpr, 0, 0, -k * dpr, ov.width / 2 - k * dpr * S.view.cx, ov.height / 2 + k * dpr * S.view.cy);
    octx.strokeStyle = acc; octx.lineWidth = 3 / k; octx.globalAlpha = 0.9; octx.setLineDash([]);
    if (p.k === 0) { octx.beginPath(); tracePath(octx, p.ops); if (p.closed) octx.closePath(); octx.stroke(); }
    else octx.strokeRect(p.bb[0], p.bb[1], p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]);
    octx.restore();
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if (S.mode === 'measure') {
    const pts = S.measure.map(p => toScreen(p[0], p[1]));
    octx.strokeStyle = acc; octx.fillStyle = acc; octx.lineWidth = 2; octx.setLineDash([]);
    if (pts.length > 1) {
      octx.beginPath(); octx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i][0], pts[i][1]);
      octx.stroke();
    }
    octx.font = 'bold 12px sans-serif'; octx.textBaseline = 'bottom'; octx.textAlign = 'left';
    for (let i = 0; i < pts.length; i++) {
      octx.fillStyle = acc;
      octx.beginPath(); octx.arc(pts[i][0], pts[i][1], 5, 0, TAU); octx.fill();
      octx.fillStyle = S.dark ? '#fff' : '#111'; octx.fillText(String(i + 1), pts[i][0] + 7, pts[i][1] - 6);
      if (i > 0) {
        const mx = (pts[i][0] + pts[i - 1][0]) / 2, my = (pts[i][1] + pts[i - 1][1]) / 2;
        const d = Math.hypot(S.measure[i][0] - S.measure[i - 1][0], S.measure[i][1] - S.measure[i - 1][1]);
        label(octx, fmt(d) + (S.units ? ' ' + S.units : ''), mx, my);
      }
    }
    if (S.snap) {
      const s = toScreen(S.snap[0], S.snap[1]);
      octx.strokeStyle = '#3ddc84'; octx.lineWidth = 2;
      octx.strokeRect(s[0] - 7, s[1] - 7, 14, 14);
    }
  }
}
function label(c, text, x, y) {
  c.font = 'bold 12px sans-serif';
  const w = c.measureText(text).width + 10;
  c.fillStyle = 'rgba(20,26,34,.85)'; c.fillRect(x - w / 2, y - 18, w, 18);
  c.fillStyle = '#f5b342'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y - 9);
  c.textAlign = 'left'; c.textBaseline = 'bottom';
}

function updateStatus(sx, sy) {
  if (!S.hasDoc) { $('stScale').textContent = ''; return; }
  const u = S.units ? ' ' + S.units : '';
  $('stScale').textContent = '1 px = ' + fmt(1 / S.view.scale, 3) + u;
  if (sx != null) { const w = toWorld(sx, sy); $('stCoord').textContent = 'X: ' + fmt(w[0]) + '  Y: ' + fmt(w[1]); }
}

// ---------------------------------------------------------------------------
// Etkileşim
// ---------------------------------------------------------------------------
const pointers = new Map();
let gesture = null, lastTap = 0, lastTapPos = null;

vp.addEventListener('pointerdown', (ev) => {
  if (!S.hasDoc) return;
  vp.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  closeMenu();
  const arr = [...pointers.values()];
  if (arr.length === 1) gesture = { type: 'pan', x0: ev.clientX, y0: ev.clientY, view: { ...S.view }, t0: performance.now(), moved: false };
  else if (arr.length === 2) {
    const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    const mid = [(arr[0].x + arr[1].x) / 2, (arr[0].y + arr[1].y) / 2];
    const r = vp.getBoundingClientRect();
    gesture = { type: 'pinch', d0: d, mid0: [mid[0] - r.left, mid[1] - r.top], view: { ...S.view }, moved: true };
  }
  S.gestureActive = true;
});
vp.addEventListener('pointermove', (ev) => {
  const r = vp.getBoundingClientRect();
  if (!pointers.has(ev.pointerId)) { if (S.hasDoc && ev.pointerType === 'mouse') updateStatus(ev.clientX - r.left, ev.clientY - r.top); return; }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (!gesture) return;
  if (gesture.type === 'pan') {
    const dx = ev.clientX - gesture.x0, dy = ev.clientY - gesture.y0;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true;
    S.view.cx = gesture.view.cx - dx / S.view.scale;
    S.view.cy = gesture.view.cy + dy / S.view.scale;
    requestRender(true);
  } else if (gesture.type === 'pinch' && pointers.size >= 2) {
    const arr = [...pointers.values()];
    const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    const mid = [(arr[0].x + arr[1].x) / 2 - r.left, (arr[0].y + arr[1].y) / 2 - r.top];
    const v0 = gesture.view;
    const ns = Math.max(1e-9, Math.min(1e9, v0.scale * d / Math.max(1, gesture.d0)));
    // mid0 altındaki dünya noktası, şimdi mid altında olmalı
    const wx = v0.cx + (gesture.mid0[0] - W / 2) / v0.scale, wy = v0.cy - (gesture.mid0[1] - H / 2) / v0.scale;
    S.view.scale = ns;
    S.view.cx = wx - (mid[0] - W / 2) / ns;
    S.view.cy = wy + (mid[1] - H / 2) / ns;
    requestRender(true);
  }
});
function endPointer(ev) {
  const r = vp.getBoundingClientRect();
  const had = pointers.delete(ev.pointerId);
  if (!had) return;
  if (gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 0 && ev.type === 'pointerup') {
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const now = performance.now();
    if (now - lastTap < 320 && lastTapPos && Math.hypot(lastTapPos[0] - sx, lastTapPos[1] - sy) < 30) {
      zoomAt(sx, sy, 2); lastTap = 0;
    } else { lastTap = now; lastTapPos = [sx, sy]; onTap(sx, sy); }
  }
  if (pointers.size === 0) { gesture = null; S.gestureActive = false; clearTimeout(fullTimer); requestRender(); }
  else if (pointers.size === 1) { const p = [...pointers.values()][0]; gesture = { type: 'pan', x0: p.x, y0: p.y, view: { ...S.view }, moved: true }; }
}
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);
vp.addEventListener('wheel', (ev) => {
  if (!S.hasDoc) return;
  ev.preventDefault();
  const r = vp.getBoundingClientRect();
  zoomAt(ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.2 : 1 / 1.2);
}, { passive: false });

function zoomAt(sx, sy, f) {
  const w = toWorld(sx, sy);
  S.view.scale = Math.max(1e-9, Math.min(1e9, S.view.scale * f));
  S.view.cx = w[0] - (sx - W / 2) / S.view.scale;
  S.view.cy = w[1] + (sy - H / 2) / S.view.scale;
  requestRender();
}

function onTap(sx, sy) {
  updateStatus(sx, sy);
  const w = toWorld(sx, sy);
  if (S.mode === 'measure') {
    const sn = snapVertex(w, 18 / S.view.scale);
    S.measure.push(sn || w);
    S.snap = sn;
    updateMeasure();
    drawOverlay();
    return;
  }
  const hit = pick(w, 12 / S.view.scale);
  S.selected = hit;
  drawOverlay();
  if (hit) showInfo(hit); else hide('infoPanel');
}

// ---- seçim / yapışma -------------------------------------------------------
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function angIn(a, a0, a1) { // a, [a0→a1] saat yönü tersi aralığında mı
  const n = (v) => ((v % TAU) + TAU) % TAU;
  const d = n(a1 - a0), x = n(a - a0);
  return d < 1e-9 ? true : x <= d + 1e-9;
}
function primDist(p, w) {
  if (p.k === 2) return Math.hypot(p.x - w[0], p.y - w[1]);
  if (p.k === 1) return (w[0] >= p.bb[0] && w[0] <= p.bb[2] && w[1] >= p.bb[1] && w[1] <= p.bb[3]) ? Math.hypot(p.x - w[0], p.y - w[1]) * 0.25 : Infinity;
  let best = Infinity, lx = 0, ly = 0, sx = 0, sy = 0;
  for (const o of p.ops) {
    if (o[0] === 0) { lx = sx = o[1]; ly = sy = o[2]; continue; }
    if (o[0] === 1) { best = Math.min(best, segDist(w[0], w[1], lx, ly, o[1], o[2])); lx = o[1]; ly = o[2]; continue; }
    if (o[0] === 2 || o[0] === -2) {
      const a = Math.atan2(w[1] - o[2], w[0] - o[1]);
      const inside = o[0] === 2 ? angIn(a, o[4], o[5]) : angIn(a, o[5], o[4]);
      const d = Math.abs(Math.hypot(w[0] - o[1], w[1] - o[2]) - o[3]);
      if (inside) best = Math.min(best, d);
      lx = o[1] + o[3] * Math.cos(o[5]); ly = o[2] + o[3] * Math.sin(o[5]);
      continue;
    }
    if (o[0] === 3) {
      const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
      for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(w[0], w[1], pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
      lx = pts[pts.length - 1][0]; ly = pts[pts.length - 1][1];
    }
  }
  if (p.closed) best = Math.min(best, segDist(w[0], w[1], lx, ly, sx, sy));
  if (p.fill && best > 0 && pointInPath(p, w)) best = Math.min(best, 1e-3 + best * 0.5);
  return best;
}
function pointInPath(p, w) {
  const pts = flatten(p.ops);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > w[1]) !== (yj > w[1])) && (w[0] < (xj - xi) * (w[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function flatten(ops) {
  const pts = [];
  for (const o of ops) {
    if (o[0] === 0 || o[0] === 1) pts.push([o[1], o[2]]);
    else if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], pts);
    else if (o[0] === -2) { const t = []; arcPts(o[1], o[2], o[3], o[5], o[4], t); t.reverse(); pts.push(...t); }
    else ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
  }
  return pts;
}
function pick(w, tol) {
  let best = null, bd = tol;
  for (const p of S.prims) {
    if (p.inf) continue;
    const L = S.layers.get(p.lay);
    if (L && !L.visible) continue;
    if (p.k === 1 && !S.showText) continue;
    if (w[0] < p.bb[0] - tol || w[0] > p.bb[2] + tol || w[1] < p.bb[1] - tol || w[1] > p.bb[3] + tol) continue;
    const d = primDist(p, w);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function snapVertex(w, tol) {
  let best = null, bd = tol;
  const test = (x, y) => { const d = Math.hypot(x - w[0], y - w[1]); if (d < bd) { bd = d; best = [x, y]; } };
  for (const p of S.prims) {
    if (p.inf || p.k === 1) continue;
    const L = S.layers.get(p.lay);
    if (L && !L.visible) continue;
    if (w[0] < p.bb[0] - tol || w[0] > p.bb[2] + tol || w[1] < p.bb[1] - tol || w[1] > p.bb[3] + tol) continue;
    if (p.k === 2) { test(p.x, p.y); continue; }
    for (const o of p.ops) {
      if (o[0] === 0 || o[0] === 1) test(o[1], o[2]);
      else if (o[0] === 2 || o[0] === -2) { test(o[1], o[2]); test(o[1] + o[3] * Math.cos(o[4]), o[2] + o[3] * Math.sin(o[4])); test(o[1] + o[3] * Math.cos(o[5]), o[2] + o[3] * Math.sin(o[5])); }
      else if (o[0] === 3) test(o[1], o[2]);
    }
  }
  return best;
}

// ---- ölçüler ---------------------------------------------------------------
function pathLength(ops, closed) {
  let len = 0, lx = 0, ly = 0, sx = 0, sy = 0;
  for (const o of ops) {
    if (o[0] === 0) { lx = sx = o[1]; ly = sy = o[2]; }
    else if (o[0] === 1) { len += Math.hypot(o[1] - lx, o[2] - ly); lx = o[1]; ly = o[2]; }
    else if (o[0] === 2 || o[0] === -2) {
      let d = o[0] === 2 ? o[5] - o[4] : o[4] - o[5];
      while (d <= 0) d += TAU;
      if (d > TAU) d = TAU;
      len += o[3] * d;
      lx = o[1] + o[3] * Math.cos(o[5]); ly = o[2] + o[3] * Math.sin(o[5]);
    } else {
      const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      lx = pts[pts.length - 1][0]; ly = pts[pts.length - 1][1];
    }
  }
  if (closed) len += Math.hypot(sx - lx, sy - ly);
  return len;
}
function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}

// ---------------------------------------------------------------------------
// Paneller
// ---------------------------------------------------------------------------
function show(id) { $(id).hidden = false; }
function hide(id) { $(id).hidden = true; }
function openPanels() { return ['layerPanel', 'infoPanel', 'measurePanel', 'docPanel'].filter(id => !$(id).hidden); }
function closeMenu() { hide('moreMenu'); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => hide(b.dataset.close)));

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function kv(pairs) {
  return pairs.filter(p => p && p[1] !== null && p[1] !== undefined && p[1] !== '').map(p => p.length === 1
    ? `<div class="full"><strong>${esc(p[0])}</strong></div>`
    : `<div class="k">${esc(p[0])}</div><div class="v">${esc(String(p[1]))}</div>`).join('');
}

function showInfo(p) {
  const e = p.e, u = S.units ? ' ' + S.units : '';
  const rows = [];
  const top = e.type, sub = p.et;
  $('infoTitle').textContent = trType(top) + (sub !== top ? ' › ' + trType(sub) : '');
  if (top === 'INSERT') rows.push(['Blok adı', e.name]);
  if (top === 'DIMENSION') {
    rows.push(['Ölçü değeri', e.measurement != null ? fmt(e.measurement) + u : null]);
    if (e.text && e.text !== '<>') rows.push(['Ölçü yazısı', textPlain(e.text)]);
    rows.push(['Ölçü stili', e.styleName]);
  }
  rows.push(['Katman', p.lay]);
  const L = S.layers.get(p.lay);
  const colTxt = p.col === FG ? '7 (beyaz/siyah)' : rgbCss(p.col, '');
  rows.push(['Renk', (e.colorIndex === 256 ? 'Katmandan ' : e.colorIndex === 0 ? 'Bloktan ' : '') + colTxt]);
  rows.push(['Çizgi tipi', p.lt ? p.lt.key.split('@')[0] : (L ? L.lt : 'Continuous')]);
  if (p.k === 0) {
    const len = pathLength(p.ops, p.closed);
    if (sub === 'CIRCLE' && p.ops[1]) {
      const o = p.ops[1];
      rows.push(['Merkez', fmt(o[1]) + ' ; ' + fmt(o[2])], ['Yarıçap', fmt(o[3]) + u], ['Çevre', fmt(len) + u], ['Alan', fmt(Math.PI * o[3] * o[3]) + (u ? u + '²' : '')]);
    } else if (sub === 'ARC' && p.ops[1] && p.ops[1][0] === 2) {
      const o = p.ops[1];
      rows.push(['Merkez', fmt(o[1]) + ' ; ' + fmt(o[2])], ['Yarıçap', fmt(o[3]) + u], ['Yay uzunluğu', fmt(len) + u], ['Açı', fmt(((o[5] - o[4] + TAU) % TAU) * 180 / Math.PI, 2) + '°']);
    } else {
      const pts = flatten(p.ops);
      const first = pts[0], last = pts[pts.length - 1];
      rows.push(['Uzunluk', fmt(len) + u]);
      if (sub === 'LINE' && first && last) rows.push(['Başlangıç', fmt(first[0]) + ' ; ' + fmt(first[1])], ['Bitiş', fmt(last[0]) + ' ; ' + fmt(last[1])], ['ΔX / ΔY', fmt(last[0] - first[0]) + ' / ' + fmt(last[1] - first[1])]);
      else if (first) rows.push(['Köşe sayısı', p.ops.length], ['Başlangıç', fmt(first[0]) + ' ; ' + fmt(first[1])], ['Bitiş', fmt(last[0]) + ' ; ' + fmt(last[1])]);
      if (p.closed || p.fill) rows.push(['Kapalı', 'Evet'], ['Alan', fmt(polyArea(pts)) + (u ? u + '²' : '')]);
      if (p.w) rows.push(['Genişlik', fmt(p.w) + u]);
      if (sub === 'HATCH') rows.push(['Desen', e.patternName]);
    }
  } else if (p.k === 1) {
    rows.push(['Metin', p.lines.join('\n')], ['Yükseklik', fmt(p.h) + u], ['Dönüş', fmt(p.rot * 180 / Math.PI, 2) + '°'], ['Konum', fmt(p.x) + ' ; ' + fmt(p.y)]);
    if (sub === 'ATTRIB') rows.push(['Etiket', e.tag]);
  } else rows.push(['Konum', fmt(p.x) + ' ; ' + fmt(p.y)]);
  rows.push(['Tanıtıcı (handle)', e.handle]);
  $('infoBody').innerHTML = kv(rows);
  show('infoPanel');
}

function updateMeasure() {
  const u = S.units ? ' ' + S.units : '';
  const m = S.measure;
  if (!m.length) { $('measureBody').innerHTML = '<div class="full">Birinci noktaya dokunun.</div>'; return; }
  const rows = [];
  let total = 0;
  for (let i = 1; i < m.length; i++) {
    const d = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]); total += d;
    const ang = Math.atan2(m[i][1] - m[i - 1][1], m[i][0] - m[i - 1][0]) * 180 / Math.PI;
    rows.push([`${i} → ${i + 1}`, `${fmt(d)}${u}   (ΔX ${fmt(m[i][0] - m[i - 1][0])}, ΔY ${fmt(m[i][1] - m[i - 1][1])}, ${fmt(ang, 2)}°)`]);
  }
  if (m.length > 2) {
    const closing = Math.hypot(m[0][0] - m[m.length - 1][0], m[0][1] - m[m.length - 1][1]);
    rows.push(['Toplam', fmt(total) + u], ['Kapalı çevre', fmt(total + closing) + u], ['Alan (kapalı)', fmt(polyArea(m)) + (u ? u + '²' : '')]);
  }
  rows.push(['Son nokta', fmt(m[m.length - 1][0]) + ' ; ' + fmt(m[m.length - 1][1]) + (S.snap ? '  (köşeye yapıştı)' : '')]);
  if (m.length === 1) rows.push(['İkinci noktaya dokunun.']);
  $('measureBody').innerHTML = kv(rows);
}

function buildLayerList() {
  const q = ($('layerFilter').value || '').toLowerCase();
  const list = [...S.layers.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  $('layerCount').textContent = list.length + ' katman';
  const fg = fgColor();
  $('layerList').innerHTML = list.filter(l => !q || l.name.toLowerCase().includes(q)).map(l =>
    `<label class="layer${l.frozen ? ' frozen' : ''}"><input type="checkbox" data-layer="${esc(l.name)}" ${l.visible ? 'checked' : ''}>
     <span class="sw" style="background:${rgbCss(l.color, fg)}"></span><span class="nm">${esc(l.name)}</span><span class="ct">${l.count}</span></label>`).join('') || '<div class="muted">Eşleşen katman yok</div>';
}
$('layerList').addEventListener('change', (ev) => {
  const cb = ev.target;
  if (!cb.dataset.layer) return;
  const l = S.layers.get(cb.dataset.layer);
  if (l) { l.visible = cb.checked; S.cacheValid = false; requestRender(); }
});
$('layerFilter').addEventListener('input', buildLayerList);
$('btnLayersAll').addEventListener('click', () => { for (const l of S.layers.values()) l.visible = true; buildLayerList(); requestRender(); });
$('btnLayersNone').addEventListener('click', () => { for (const l of S.layers.values()) l.visible = false; buildLayerList(); requestRender(); });

function showDocInfo() {
  const c = S.counts;
  const rows = [['Dosya', S.fileName], ['Sürüm', S.version], ['Birim (INSUNITS)', S.units || 'tanımsız'],
    ['Varlık sayısı', S.entityCount], ['Çizilen ilkel', S.prims.length], ['Katman', S.layers.size], ['Blok tanımı', S.blockCount],
    ['X aralığı', S.ext ? fmt(S.ext[0]) + ' … ' + fmt(S.ext[2]) : ''], ['Y aralığı', S.ext ? fmt(S.ext[1]) + ' … ' + fmt(S.ext[3]) : ''],
    ['Genişlik × Yükseklik', S.ext ? fmt(S.ext[2] - S.ext[0]) + ' × ' + fmt(S.ext[3] - S.ext[1]) + (S.units ? ' ' + S.units : '') : '']];
  rows.push(['Varlık türleri']);
  for (const t of Object.keys(c).sort((a, b) => c[b] - c[a])) rows.push([trType(t), c[t]]);
  $('docTitle').textContent = 'Çizim bilgisi';
  $('docBody').innerHTML = kv(rows);
  show('docPanel');
}
function showAbout() {
  $('docTitle').textContent = 'Hakkında';
  const ver = window.Android && window.Android.appVersion ? window.Android.appVersion() : 'web';
  $('docBody').innerHTML = kv([
    ['Uygulama', 'DWG Görüntüleyici ' + ver],
    ['Çözümleyici', 'LibreDWG (GNU GPL v3) – WebAssembly derlemesi, @mlightcad/libredwg-web 0.7.10'],
    ['Desteklenen', 'DWG R13 – 2018 (AC1012 … AC1032); yalnız görüntüleme, kaydetme yok'],
    ['Desteklenmeyen', 'DXF, 3B katılar (3DSOLID/REGION), OLE, harici referanslar (XREF), özel yazı tipleri (SHX)'],
    ['Kullanım', 'Tek parmak: kaydır · İki parmak: yakınlaştır · Çift dokunma: 2× yakınlaştır · Dokunma: nesne bilgisi'],
    ['Lisans', 'Uygulama kaynak kodu GNU GPL v3 ile dağıtılır (LibreDWG gereği).'],
  ]);
  show('docPanel');
}

// ---- düğmeler ----------------------------------------------------------------
function openPicker() {
  if (window.Android && window.Android.openFilePicker) window.Android.openFilePicker();
  else $('fileInput').click();
}
$('btnOpen').addEventListener('click', openPicker);
$('btnOpen2').addEventListener('click', openPicker);
$('fileInput').addEventListener('change', async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  try { await loadBytes(await f.arrayBuffer(), f.name); } catch (err) { fail(err); }
  ev.target.value = '';
});
$('btnExtents').addEventListener('click', () => { zoomExtents(); });
$('btnLayers').addEventListener('click', () => { if ($('layerPanel').hidden) { buildLayerList(); show('layerPanel'); } else hide('layerPanel'); });
$('btnMeasure').addEventListener('click', () => setMode(S.mode === 'measure' ? 'view' : 'measure'));
$('btnMeasureClear').addEventListener('click', () => { S.measure = []; S.snap = null; updateMeasure(); drawOverlay(); });
$('btnMeasureClose').addEventListener('click', () => setMode('view'));
$('btnMore').addEventListener('click', () => { $('moreMenu').hidden = !$('moreMenu').hidden; });
$('moreMenu').addEventListener('click', (ev) => {
  const act = ev.target.dataset.act;
  if (!act) return;
  closeMenu();
  if (act === 'info') { if (S.hasDoc) showDocInfo(); else toast('Önce bir DWG dosyası açın.'); }
  else if (act === 'bg') { S.dark = !S.dark; document.body.classList.toggle('light', !S.dark); S.cacheValid = false; requestRender(); if (!$('layerPanel').hidden) buildLayerList(); }
  else if (act === 'text') { S.showText = !S.showText; S.cacheValid = false; requestRender(); toast(S.showText ? 'Yazılar gösteriliyor' : 'Yazılar gizlendi'); }
  else if (act === 'png') savePng();
  else if (act === 'about') showAbout();
});

function setMode(m) {
  S.mode = m;
  $('btnMeasure').classList.toggle('active', m === 'measure');
  if (m === 'measure') { S.selected = null; hide('infoPanel'); S.measure = []; S.snap = null; updateMeasure(); show('measurePanel'); }
  else { hide('measurePanel'); S.measure = []; S.snap = null; }
  drawOverlay();
}

function savePng() {
  if (!S.hasDoc) { toast('Önce bir DWG dosyası açın.'); return; }
  const c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d');
  g.drawImage(cv, 0, 0); g.drawImage(ov, 0, 0);
  const name = (S.fileName || 'cizim').replace(/\.dwg$/i, '') + '_' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.png';
  const data = c.toDataURL('image/png');
  if (window.Android && window.Android.savePng) window.Android.savePng(data.split(',')[1], name);
  else { const a = document.createElement('a'); a.href = data; a.download = name; a.click(); }
}

// Geri tuşu (Android'den çağrılır): açık bir şey kapandıysa true
function onBack() {
  if (!$('moreMenu').hidden) { closeMenu(); return true; }
  const open = openPanels();
  if (open.length) { for (const id of open) hide(id); if (S.mode === 'measure') setMode('view'); return true; }
  if (S.mode === 'measure') { setMode('view'); return true; }
  if (S.selected) { S.selected = null; drawOverlay(); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Yükleme
// ---------------------------------------------------------------------------
let lib = null;
function setLoading(text, sub) {
  if (text == null) { hide('loading'); return; }
  $('loadingText').textContent = text; $('loadingSub').textContent = sub || ''; show('loading');
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

function fail(err) {
  console.error(err);
  setLoading(null);
  const msg = (err && err.message) || String(err);
  toast('Dosya açılamadı: ' + msg, 6000);
}

async function loadBytes(buf, name) {
  const bytes = new Uint8Array(buf);
  const head = String.fromCharCode(...bytes.slice(0, 6));
  if (!/^AC10\d\d$/.test(head) && !/^AC1\.\d/.test(head)) {
    const asText = String.fromCharCode(...bytes.slice(0, 64));
    if (/^\s*0\s*\r?\n\s*SECTION/.test(asText)) throw new Error('Bu bir DXF dosyası; yalnız DWG açılabilir. AutoCAD/NetCAD ile DWG olarak kaydedin.');
    if (bytes.length === 0) throw new Error('Dosya boş.');
    throw new Error('Bu bir DWG dosyası değil (başlık: ' + head.replace(/[^\x20-\x7e]/g, '?') + ').');
  }
  S.version = VERSIONS[head] || head;
  if (head === 'AC1006' || head === 'AC1009' || /^AC1\./.test(head)) throw new Error('Çok eski DWG sürümü (' + S.version + '). R13 ve sonrası açılabilir.');
  setLoading('Çözümleyici yükleniyor…', 'LibreDWG WebAssembly');
  await nextFrame();
  if (!lib) lib = await LibreDwg.create();
  setLoading('DWG çözümleniyor…', name + ' · ' + fmt(bytes.length / 1024 / 1024, 2) + ' MB · ' + S.version);
  await nextFrame();
  const t0 = performance.now();
  let dwg;
  try { dwg = lib.dwg_read_data(bytes, Dwg_File_Type.DWG); } catch (e) { throw new Error('LibreDWG dosyayı çözemedi: ' + (e.message || e)); }
  if (!dwg) throw new Error('LibreDWG dosyayı çözemedi (bozuk ya da şifreli olabilir).');
  setLoading('Çizim hazırlanıyor…', 'bloklar açılıyor, geometri düzleştiriliyor');
  await nextFrame();
  let db;
  try { db = lib.convert(dwg); } finally { try { lib.dwg_free(dwg); } catch (_) { /* yoksay */ } }
  const scene = new SceneBuilder(db).build();
  S.prims = scene.prims; S.layers = scene.layers; S.ltypes = scene.ltypes; S.ext = scene.ext; S.counts = scene.counts;
  S.entityCount = scene.entityCount; S.blockCount = scene.blockCount;
  S.units = UNITS[db.header.INSUNITS] || '';
  S.fileName = name; S.hasDoc = true; S.selected = null; S.cacheValid = false;
  if (S.mode === 'measure') setMode('view');
  hide('empty'); hide('infoPanel'); hide('docPanel');
  $('fileName').textContent = name; $('fileName').title = name;
  $('stCount').textContent = S.entityCount + ' varlık · ' + S.layers.size + ' katman';
  if (!$('layerPanel').hidden) buildLayerList();
  zoomExtents();
  setLoading(null);
  const ms = Math.round(performance.now() - t0);
  const hidden = [...S.layers.values()].filter(l => !l.visible).length;
  toast(`${name} açıldı · ${S.entityCount} varlık · ${ms} ms` + (hidden ? ` · ${hidden} katman dondurulmuş/kapalı` : ''));
  if (!S.prims.length) toast('Model uzayında çizilebilir nesne bulunamadı.', 5000);
}

async function loadCurrent(name, size) {
  try {
    setLoading('Dosya okunuyor…', name + (size > 0 ? ' · ' + fmt(size / 1024 / 1024, 2) + ' MB' : ''));
    await nextFrame();
    const r = await fetch('/file/current', { cache: 'no-store' });
    if (!r.ok) throw new Error('dosya okunamadı (HTTP ' + r.status + ')');
    const buf = await r.arrayBuffer();
    await loadBytes(buf, name);
  } catch (err) { fail(err); }
}

// Android köprüsü
window.dwgApp = { loadCurrent, onBack, loadBytes, zoomExtents, render, toScreen, toWorld, state: S };

// Başlangıç
resize();
requestRender();
if (window.Android && window.Android.getPendingFile) {
  try {
    const pf = window.Android.getPendingFile();
    if (pf) { const o = JSON.parse(pf); loadCurrent(o.name, o.size); }
  } catch (e) { console.warn(e); }
}
