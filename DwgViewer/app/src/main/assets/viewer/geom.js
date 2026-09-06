/*
 * Geometri: afin dönüşüm, yay/spline örnekleme, sınır kutuları, uzamsal
 * indeks (STR paketli R-ağacı), uzaklık, yakalama (osnap) ve kesişim.
 *
 * Yol ilkelinin işlemleri (ops):
 *   [0,x,y,z?]  moveTo      [1,x,y,z?]  lineTo
 *   [2,cx,cy,r,a0,a1]  yay, saat yönü tersi a0→a1
 *   [-2,cx,cy,r,a0,a1] yay, saat yönünde a0→a1
 *   [3,cx,cy,rx,ry,rot,a0,a1] elips yayı (parametrik açı), saat yönü tersi
 */
export const TAU = Math.PI * 2;

// ---- afin dönüşüm [a,b,c,d,e,f]: x' = a x + c y + e, y' = b x + d y + f ----
export const IDENT = [1, 0, 0, 1, 0, 0];
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const isIdent = (m) => m === IDENT || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);
/** benzerlik: döndürme + eşit ölçek, aynalama yok → yaylar yay kalır */
export const isSim = (m) => Math.abs(m[0] - m[3]) < 1e-9 && Math.abs(m[1] + m[2]) < 1e-9;
export const simScale = (m) => Math.hypot(m[0], m[1]);
export const simRot = (m) => Math.atan2(m[1], m[0]);
export const det = (m) => m[0] * m[3] - m[1] * m[2];
export function insertMatrix(ins, base, dx = 0, dy = 0) {
  const r = ins.rotation || 0, cs = Math.cos(r), sn = Math.sin(r);
  const sx = ins.xScale || 1, sy = ins.yScale || 1;
  const p = ins.insertionPoint || { x: 0, y: 0 };
  let m = [cs, sn, -sn, cs, p.x, p.y];
  if (dx || dy) m = mul(m, [1, 0, 0, 1, dx, dy]);
  m = mul(m, [sx, 0, 0, sy, 0, 0]);
  if (base && (base.x || base.y)) m = mul(m, [1, 0, 0, 1, -base.x, -base.y]);
  return m;
}
/** 3 nokta çiftinden afin dönüşüm: (0,0)→p0, (1,0)→p1, (0,1)→p2 */
export const fromPoints = (p0, p1, p2) => [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]];

// ---- örnekleme ---------------------------------------------------------------
export function arcPts(cx, cy, r, a0, a1, out) {
  let d = a1 - a0;
  while (d <= 0) d += TAU;
  const n = Math.max(8, Math.ceil(d / (Math.PI / 60)));
  for (let i = 0; i <= n; i++) {
    const a = a0 + d * i / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
}
export function ellipsePts(cx, cy, rx, ry, rot, a0, a1, out) {
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
export function bulgeArc(x1, y1, x2, y2, b, ops, z) {
  const theta = 4 * Math.atan(b);
  const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
  if (d < 1e-12 || Math.abs(theta) < 1e-9) { ops.push([1, x2, y2, z]); return; }
  const r = d / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const h = Math.sqrt(Math.max(0, r * r - d * d / 4));
  const s = b > 0 ? 1 : -1;
  const cx = mx - s * h * dy / d, cy = my + s * h * dx / d;
  const a0 = Math.atan2(y1 - cy, x1 - cx), a1 = Math.atan2(y2 - cy, x2 - cx);
  ops.push([b > 0 ? 2 : -2, cx, cy, r, a0, a1]);
}
/** B-spline (de Boor) örnekleme */
export function bsplinePts(cps, degree, knots, weights, closed) {
  const n = cps.length;
  if (n < 2) return cps.map(p => [p.x, p.y]);
  degree = Math.max(1, Math.min(degree || 3, n - 1));
  let k = knots && knots.length >= n + degree + 1 ? knots.slice() : null;
  if (!k) {
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
export function catmullPts(pts, closed) {
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

// ---- yol yardımcıları ----------------------------------------------------------
/** ops → düz nokta listesi [[x,y],…] */
export function flatten(ops) {
  const pts = [];
  for (const o of ops) {
    if (o[0] === 0 || o[0] === 1) pts.push([o[1], o[2]]);
    else if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], pts);
    else if (o[0] === -2) { const t = []; arcPts(o[1], o[2], o[3], o[5], o[4], t); t.reverse(); pts.push(...t); }
    else ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
  }
  return pts;
}
export function opsBBox(ops) {
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const o of ops) {
    let x0, y0, x1, y1;
    if (o[0] === 0 || o[0] === 1) { x0 = x1 = o[1]; y0 = y1 = o[2]; }
    else if (o[0] === 2 || o[0] === -2) { x0 = o[1] - o[3]; x1 = o[1] + o[3]; y0 = o[2] - o[3]; y1 = o[2] + o[3]; }
    else { const r = Math.max(o[3], o[4]); x0 = o[1] - r; x1 = o[1] + r; y0 = o[2] - r; y1 = o[2] + r; }
    if (x0 < bb[0]) bb[0] = x0;
    if (y0 < bb[1]) bb[1] = y0;
    if (x1 > bb[2]) bb[2] = x1;
    if (y1 > bb[3]) bb[3] = y1;
  }
  return bb;
}
export function pathLength(ops, closed) {
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
export function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(a / 2);
}
export function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// ---- uzaklık ------------------------------------------------------------------
export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
/** doğru parçasına dik ayak (t ∈ [0,1] içinde kalırsa) */
export function segFoot(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  if (!l2) return null;
  const t = ((px - x1) * dx + (py - y1) * dy) / l2;
  if (t < 0 || t > 1) return null;
  return [x1 + t * dx, y1 + t * dy];
}
export function angIn(a, a0, a1) {
  const n = (v) => ((v % TAU) + TAU) % TAU;
  const d = n(a1 - a0), x = n(a - a0);
  return d < 1e-9 ? true : x <= d + 1e-9;
}
/** ilkel–nokta uzaklığı (dünya birimi) */
export function primDist(p, w) {
  if (p.k === 2) return Math.hypot(p.x - w[0], p.y - w[1]);
  if (p.k === 1) return (w[0] >= p.bb[0] && w[0] <= p.bb[2] && w[1] >= p.bb[1] && w[1] <= p.bb[3]) ? Math.hypot(p.x - w[0], p.y - w[1]) * 0.25 : Infinity;
  if (p.k === 3) return pointInPoly(p.quad, w[0], w[1]) ? 0 : Infinity;
  let best = Infinity, lx = 0, ly = 0, sx = 0, sy = 0;
  for (const o of p.ops) {
    if (o[0] === 0) { lx = sx = o[1]; ly = sy = o[2]; continue; }
    if (o[0] === 1) { best = Math.min(best, segDist(w[0], w[1], lx, ly, o[1], o[2])); lx = o[1]; ly = o[2]; continue; }
    if (o[0] === 2 || o[0] === -2) {
      const a = Math.atan2(w[1] - o[2], w[0] - o[1]);
      const inside = o[0] === 2 ? angIn(a, o[4], o[5]) : angIn(a, o[5], o[4]);
      if (inside) best = Math.min(best, Math.abs(Math.hypot(w[0] - o[1], w[1] - o[2]) - o[3]));
      lx = o[1] + o[3] * Math.cos(o[5]); ly = o[2] + o[3] * Math.sin(o[5]);
      continue;
    }
    const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(w[0], w[1], pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    lx = pts[pts.length - 1][0]; ly = pts[pts.length - 1][1];
  }
  if (p.closed) best = Math.min(best, segDist(w[0], w[1], lx, ly, sx, sy));
  if (p.fill && best > 0 && pointInPoly(flatten(p.ops), w[0], w[1])) best = Math.min(best, 1e-3 + best * 0.5);
  return best;
}

// ---- uzamsal indeks: STR paketli statik R-ağacı ------------------------------------
export class RTree {
  constructor(items, bboxOf, node = 16) {
    this.bboxOf = bboxOf;
    this.items = items;
    const n = items.length;
    if (!n) { this.root = null; return; }
    let leaves = items.map((it, i) => ({ bb: bboxOf(it), i }));
    // STR: x'e göre dilimle, dilim içinde y'ye göre sırala
    let level = leaves;
    while (level.length > node) {
      const S = Math.ceil(Math.sqrt(Math.ceil(level.length / node)));
      level.sort((a, b) => (a.bb[0] + a.bb[2]) - (b.bb[0] + b.bb[2]));
      const sliceSize = Math.ceil(level.length / S);
      const next = [];
      for (let s = 0; s < level.length; s += sliceSize) {
        const slice = level.slice(s, s + sliceSize).sort((a, b) => (a.bb[1] + a.bb[3]) - (b.bb[1] + b.bb[3]));
        for (let j = 0; j < slice.length; j += node) {
          const ch = slice.slice(j, j + node);
          const bb = [Infinity, Infinity, -Infinity, -Infinity];
          for (const c of ch) { if (c.bb[0] < bb[0]) bb[0] = c.bb[0]; if (c.bb[1] < bb[1]) bb[1] = c.bb[1]; if (c.bb[2] > bb[2]) bb[2] = c.bb[2]; if (c.bb[3] > bb[3]) bb[3] = c.bb[3]; }
          next.push({ bb, ch });
        }
      }
      level = next;
    }
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of level) { if (c.bb[0] < bb[0]) bb[0] = c.bb[0]; if (c.bb[1] < bb[1]) bb[1] = c.bb[1]; if (c.bb[2] > bb[2]) bb[2] = c.bb[2]; if (c.bb[3] > bb[3]) bb[3] = c.bb[3]; }
    this.root = { bb, ch: level };
  }
  /** bbox ile kesişen öğe indekslerini fn'e verir (ekleme sırasına yakın) */
  search(x0, y0, x1, y1, fn) {
    if (!this.root) return;
    const stack = [this.root];
    while (stack.length) {
      const nd = stack.pop();
      const b = nd.bb;
      if (b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) continue;
      if (nd.ch) { for (let i = nd.ch.length - 1; i >= 0; i--) stack.push(nd.ch[i]); }
      else fn(nd.i);
    }
  }
  collect(x0, y0, x1, y1) { const out = []; this.search(x0, y0, x1, y1, i => out.push(i)); out.sort((a, b) => a - b); return out; }
}

// ---- yakalama (osnap) ---------------------------------------------------------------
/** Yol ilkelinden doğru parçaları [x1,y1,x2,y2,z1,z2] ve yayları toplar */
function segmentsOf(p) {
  const segs = [], arcs = [];
  let lx = 0, ly = 0, lz, sx = 0, sy = 0, sz;
  for (const o of p.ops) {
    if (o[0] === 0) { lx = sx = o[1]; ly = sy = o[2]; lz = sz = o[3]; continue; }
    if (o[0] === 1) { segs.push([lx, ly, o[1], o[2], lz, o[3]]); lx = o[1]; ly = o[2]; lz = o[3]; continue; }
    if (o[0] === 2 || o[0] === -2) { arcs.push(o); lx = o[1] + o[3] * Math.cos(o[5]); ly = o[2] + o[3] * Math.sin(o[5]); lz = undefined; continue; }
    const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    lx = pts[pts.length - 1][0]; ly = pts[pts.length - 1][1]; lz = undefined;
  }
  if (p.closed && (lx !== sx || ly !== sy)) segs.push([lx, ly, sx, sy, lz, sz]);
  return { segs, arcs };
}
export function segIntersect(a, b) {
  const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d;
  const u = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + t * (a[2] - a[0]), a[1] + t * (a[3] - a[1])];
}
/**
 * Yakalama. modes: Set('end','mid','cen','per','int','nea','node')
 * prims: aday ilkeller; w: dünya noktası; tol: dünya birimi; prev: önceki nokta (dik için)
 * → { p:[x,y,z], kind } ya da null
 */
export function snapPoint(prims, w, tol, modes, prev) {
  let best = null, bd = tol;
  const PRI = { end: 0, node: 0, int: 0.1, cen: 0.2, mid: 0.3, per: 0.5, nea: 0.9 };
  const test = (x, y, kind, z) => {
    const d = Math.hypot(x - w[0], y - w[1]) + PRI[kind] * tol * 0.5;
    if (d < bd) { bd = d; best = { p: [x, y, z], kind }; }
  };
  const allSegs = [];
  for (const p of prims) {
    if (p.k === 2) { if (modes.has('node') || modes.has('end')) test(p.x, p.y, 'node', p.z); continue; }
    if (p.k === 4) { if (modes.has('ins')) test(p.x, p.y, 'ins', p.z); continue; }
    if (p.k !== 0) continue;
    const { segs, arcs } = segmentsOf(p);
    for (const s of segs) {
      if (modes.has('end')) { test(s[0], s[1], 'end', s[4]); test(s[2], s[3], 'end', s[5]); }
      if (modes.has('mid')) test((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, 'mid', s[4] != null && s[5] != null ? (s[4] + s[5]) / 2 : undefined);
      if (modes.has('per') && prev) { const f = segFoot(prev[0], prev[1], s[0], s[1], s[2], s[3]); if (f) test(f[0], f[1], 'per'); }
      if (modes.has('nea')) { const f = segFoot(w[0], w[1], s[0], s[1], s[2], s[3]); if (f) test(f[0], f[1], 'nea'); }
      if (modes.has('int')) allSegs.push(s);
    }
    for (const o of arcs) {
      if (modes.has('cen')) test(o[1], o[2], 'cen');
      if (modes.has('end')) { test(o[1] + o[3] * Math.cos(o[4]), o[2] + o[3] * Math.sin(o[4]), 'end'); test(o[1] + o[3] * Math.cos(o[5]), o[2] + o[3] * Math.sin(o[5]), 'end'); }
      if (modes.has('mid')) { let d = o[5] - o[4]; while (d <= 0) d += TAU; const a = o[4] + d / 2; test(o[1] + o[3] * Math.cos(a), o[2] + o[3] * Math.sin(a), 'mid'); }
      if (modes.has('nea')) { const a = Math.atan2(w[1] - o[2], w[0] - o[1]); if (angIn(a, o[0] === 2 ? o[4] : o[5], o[0] === 2 ? o[5] : o[4])) test(o[1] + o[3] * Math.cos(a), o[2] + o[3] * Math.sin(a), 'nea'); }
    }
  }
  if (modes.has('int') && allSegs.length < 400) {
    for (let i = 0; i < allSegs.length; i++) for (let j = i + 1; j < allSegs.length; j++) {
      const x = segIntersect(allSegs[i], allSegs[j]);
      if (x) test(x[0], x[1], 'int');
    }
  }
  return best;
}
