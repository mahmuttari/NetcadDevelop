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
/** yay sınırı: uç noktalar + süpürme içindeki çeyrek açıları (tam çember kutusu değil) */
function arcExt(cx, cy, r, a0, a1, bb) {
  let d = a1 - a0;
  if (!Number.isFinite(a0) || !Number.isFinite(d)) { a0 = 0; d = TAU; }   // bozuk açı: tam çember kutusu
  a0 %= TAU; if (a0 < 0) a0 += TAU;                                       // taşkın açı (1e300): döngü sabit adımda biter
  if (d < 0) d = d % TAU + TAU;
  if (d > TAU) d = TAU;
  const hit = (a) => {
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
  };
  hit(a0); hit(a0 + d);
  const Q = Math.PI / 2;
  for (let q = Math.ceil(a0 / Q - 1e-9) * Q; q <= a0 + d + 1e-9; q += Q) hit(q);
}
export function opsBBox(ops) {
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const o of ops) {
    if (o[0] === 2) { arcExt(o[1], o[2], o[3], o[4], o[5], bb); continue; }
    if (o[0] === -2) { arcExt(o[1], o[2], o[3], o[5], o[4], bb); continue; }
    if (o[0] === 3) {
      const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
      for (const p of pts) { if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; }
      continue;
    }
    const x = o[1], y = o[2];
    if (x < bb[0]) bb[0] = x;
    if (y < bb[1]) bb[1] = y;
    if (x > bb[2]) bb[2] = x;
    if (y > bb[3]) bb[3] = y;
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
/*
 * Yolun GERÇEK (eğik) uzunluğu. pathLength yalnız XY düzleminde ölçer; eğik bir isale hattında
 * ya da kotlu bir polyline'da yatay izdüşüm verir ve çizimde yazan boydan kısa çıkar. Kot yalnız
 * moveTo/lineTo'da taşınır (ops biçimi: [0,x,y,z?] [1,x,y,z?]); yaylar ilkelin kendi kotunda
 * düzlemseldir, o yüzden yay boyu iki ölçümde de aynıdır. Kot verilmemiş uçta Δz sıfır sayılır,
 * böylece 2B çizimde sonuç pathLength ile birebir aynı kalır.
 */
export function pathLength3(ops, closed) {
  let len = 0, lx = 0, ly = 0, lz = 0, sx = 0, sy = 0, sz = 0;
  const zOf = (o) => (o.length > 3 && typeof o[3] === 'number' && isFinite(o[3]) ? o[3] : 0);
  for (const o of ops) {
    if (o[0] === 0) { lx = sx = o[1]; ly = sy = o[2]; lz = sz = zOf(o); }
    else if (o[0] === 1) { const z = zOf(o); len += Math.hypot(o[1] - lx, o[2] - ly, z - lz); lx = o[1]; ly = o[2]; lz = z; }
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
  if (closed) len += Math.hypot(sx - lx, sy - ly, sz - lz);
  return len;
}
/**
 * Düz parçalı yol (flatten çıktısı) boyunca verilen yol uzunluklarındaki noktalar — AutoCAD DIVIDE / MEASURE.
 * dists artan sırada olmak zorunda değildir; yol boyunu aşanlar ve negatifler atlanır. → [[x, y]…]
 */
export function pathPointsAt(pts, dists) {
  const out = [];
  if (!Array.isArray(pts) || pts.length < 2) return out;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  for (const d of dists) {
    if (!(d >= 0) || d > L + 1e-9) continue;
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? Math.max(0, Math.min(1, (d - cum[i - 1]) / seg)) : 0;
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
  }
  return out;
}
/**
 * Yol üzerinde verilen uzaklıklardaki noktalar ve o noktadaki yol yönü (radyan): yol dizisi (ARRAYPATH) için.
 * Köşeye düşen nokta SONRAKİ parçanın yönünü alır, yolun sonu son parçanın yönünü. Uzaklık yolu aşarsa atlanır.
 */
export function pathFramesAt(pts, dists) {
  const out = [];
  if (!Array.isArray(pts) || pts.length < 2) return out;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  for (const d of dists) {
    if (!(d >= 0) || d > L + 1e-9) continue;
    let i = 1; while (i < cum.length - 1 && cum[i] <= d + 1e-9) i++;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? Math.max(0, Math.min(1, (d - cum[i - 1]) / seg)) : 0;
    let k = i; while (k > 1 && cum[k] - cum[k - 1] <= 1e-12) k--;   // sıfır boylu son parça (yinelenen köşe): yön önceki gerçek parçadan
    out.push({ p: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t], ang: Math.atan2(pts[k][1] - pts[k - 1][1], pts[k][0] - pts[k - 1][0]) });
  }
  return out;
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
  if (p.k === 5) {
    /*
     * Ağ ilkeli 2B'de yalnız KENARLARIYLA çizilir (render.js), o yüzden yalnız kenarlarından seçilir.
     * Sınır kutusuna uzaklık verilemez: kutunun içinde sıfır döner ve büyük bir gövde, altındaki
     * çizgi, yazı ve ölçüleri seçilemez hâle getirir. Çok büyük gövdede parça atlanır — sonuç yalnız
     * BÜYÜR (gerçek uzaklığın üstünde kalır), asla sahte sıfır üretmez.
     */
    const g = p.seg;
    if (!g || !g.length) return Infinity;
    const x = w[0], y = w[1];
    const step = g.length > 1200000 ? 6 * Math.ceil(g.length / 1200000) : 6;
    let best = Infinity;
    for (let i = 0; i + 5 < g.length; i += step) {
      const ax = g[i], ay = g[i + 1], bx = g[i + 3], by = g[i + 4];
      if (x - best > (ax > bx ? ax : bx) || (ax < bx ? ax : bx) - x > best
        || y - best > (ay > by ? ay : by) || (ay < by ? ay : by) - y > best) continue;   // ucuz kutu elemesi
      const d = segDist(x, y, ax, ay, bx, by);
      if (d < best) best = d;
    }
    return best;
  }
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
  /**
   * AYNI ağacı kurar ama ARADAN ÇIKABİLİR: ana iş parçacığını saniyelerce kilitlemek yerine
   * her ~10 ms'de bir denetimi tarayıcıya bırakır.
   *
   * NEDEN GEREKLİ: yapıcı (constructor) tek bloktur. 500 bin ilkelde yarım saniyeyi aşan bir
   * kilit demektir ve o süre boyunca EKRANDA HİÇBİR ŞEY KIPIRDAMAZ — bekleme görseli donar
   * (stroke-dashoffset bileşik katmanda çalışamaz, ana iş parçacığına bağlıdır), Vazgeç
   * düğmesi basılmaz, geri tuşu işlenmez. Kullanıcı uygulamanın çöktüğünü sanır.
   *
   * NEDEN ELLE YAZILMIŞ SIRALAMA: Array.prototype.sort tek bloktur, yarısında durdurulamaz;
   * 500 bin öğede tek başına saniyeye yakın kilittir. Aşağıdaki aşağı-yukarı birleştirme
   * sıralaması her geçişi eşit parçalara böler, aradan çıkıp kaldığı yerden devam eder.
   * Üstelik karşılaştırma bir kapanış (closure) çağrısı değil, Float64Array üzerinde düz sayı
   * karşılaştırmasıdır. Sıralama KARARLIdır ve eşitlikte sol öğeyi önde tutar — yani
   * Array.prototype.sort (TimSort) ile birebir aynı sırayı verir. Bu tesadüf değil, koşuldur:
   * kurulan ağaç eşzamanlı kurulanla düğüm düğüm aynı olsun diye böyle yazıldı ve sınama
   * (tools/test_index.mjs) bunu her koşuda doğruluyor.
   *
   * @param {object} [o] onPct: yüzde bildirimi · budget: kesintisiz çalışma bütçesi (ms) ·
   *                     sleep: aradan çıkma yordamı (sınamada değiştirilebilir)
   */
  static async build(items, bboxOf, node = 16, o = {}) {
    const t = Object.create(RTree.prototype);
    t.bboxOf = bboxOf; t.items = items;
    const n = items.length;
    if (!n) { t.root = null; return t; }
    const butce = o.budget || 10;
    const uyu = o.sleep || (() => new Promise(r => setTimeout(r)));
    const simdi = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // İş tahmini: ilerleme çubuğu uydurma değil, gerçekten dokunulacak öğe sayısına dayanır.
    let toplam = n;
    for (let L = n; L > node;) {
      const S = Math.ceil(Math.sqrt(Math.ceil(L / node)));
      const dilim = Math.ceil(L / S);
      toplam += L * (Math.ceil(Math.log2(Math.max(2, L))) + Math.ceil(Math.log2(Math.max(2, dilim))) + 1);
      L = Math.ceil(L / node);
    }
    let yapilan = 0, t0 = simdi();
    const nefes = async () => {
      if (simdi() - t0 < butce) return;
      if (o.onPct) o.onPct(Math.min(99, 100 * yapilan / toplam));
      await uyu(); t0 = simdi();
    };

    // 1) yapraklar — parça parça, çünkü 500 bin küçük nesne ayırmak da bloktur
    const leaves = new Array(n);
    for (let i = 0; i < n; i++) {
      leaves[i] = { bb: bboxOf(items[i]), i };
      if ((i & 8191) === 8191) { yapilan = i; await nefes(); }
    }
    yapilan = n;

    let level = leaves;
    while (level.length > node) {
      const L = level.length;
      const S = Math.ceil(Math.sqrt(Math.ceil(L / node)));
      const dilimBoy = Math.ceil(L / S);

      // x'e göre sırala (dilimlemek için)
      const kx = new Float64Array(L);
      for (let i = 0; i < L; i++) kx[i] = level[i].bb[0] + level[i].bb[2];
      const sira = new Uint32Array(L);
      for (let i = 0; i < L; i++) sira[i] = i;
      for (const adim of siralaGen(sira, kx)) { yapilan += adim; await nefes(); }
      const xs = new Array(L);
      for (let i = 0; i < L; i++) xs[i] = level[sira[i]];

      const next = [];
      for (let s = 0; s < L; s += dilimBoy) {
        const son = Math.min(s + dilimBoy, L), boy = son - s;
        const ky = new Float64Array(boy);
        for (let i = 0; i < boy; i++) ky[i] = xs[s + i].bb[1] + xs[s + i].bb[3];
        const sy = new Uint32Array(boy);
        for (let i = 0; i < boy; i++) sy[i] = i;
        for (const adim of siralaGen(sy, ky)) { yapilan += adim; await nefes(); }
        for (let j = 0; j < boy; j += node) {
          const ch = [];
          const bb = [Infinity, Infinity, -Infinity, -Infinity];
          for (let k = j; k < Math.min(j + node, boy); k++) {
            const c = xs[s + sy[k]];
            ch.push(c);
            if (c.bb[0] < bb[0]) bb[0] = c.bb[0]; if (c.bb[1] < bb[1]) bb[1] = c.bb[1];
            if (c.bb[2] > bb[2]) bb[2] = c.bb[2]; if (c.bb[3] > bb[3]) bb[3] = c.bb[3];
          }
          next.push({ bb, ch });
        }
        yapilan += boy;
        await nefes();
      }
      level = next;
    }
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of level) { if (c.bb[0] < bb[0]) bb[0] = c.bb[0]; if (c.bb[1] < bb[1]) bb[1] = c.bb[1]; if (c.bb[2] > bb[2]) bb[2] = c.bb[2]; if (c.bb[3] > bb[3]) bb[3] = c.bb[3]; }
    t.root = { bb, ch: level };
    if (o.onPct) o.onPct(100);
    return t;
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

/**
 * Sayısal anahtara göre KARARLI, parça parça çalışan aşağı-yukarı birleştirme sıralaması.
 * `sira` yerinde sıralanır; `key[sira[i]]` artan olur. Her ~8 bin birleştirme adımında
 * yield eder ve o ana dek dokunulan öğe sayısını verir, çağıran da denetimi tarayıcıya
 * bırakır. Eşitlikte SOL öğe önde kalır (kararlılık) — bu yüzden sonuç Array.prototype.sort
 * ile aynıdır ve eşzamanlı kurulan ağaçla birebir eşleşir.
 */
function* siralaGen(sira, key) {
  const n = sira.length;
  if (n < 2) return;
  let a = sira, b = new Uint32Array(n), sayac = 0;
  for (let w = 1; w < n; w *= 2) {
    for (let lo = 0; lo < n; lo += 2 * w) {
      const orta = Math.min(lo + w, n), hi = Math.min(lo + 2 * w, n);
      let i = lo, j = orta, k = lo;
      while (i < orta && j < hi) b[k++] = key[a[j]] < key[a[i]] ? a[j++] : a[i++];
      while (i < orta) b[k++] = a[i++];
      while (j < hi) b[k++] = a[j++];
      sayac += hi - lo;
      if (sayac >= 8192) { const v = sayac; sayac = 0; yield v; }
    }
    const t = a; a = b; b = t;
  }
  if (a !== sira) sira.set(a);
  if (sayac) yield sayac;
}

// ---- yakalama (osnap) ---------------------------------------------------------------
/** Yol ilkelinden doğru parçaları [x1,y1,x2,y2,z1,z2] ve yayları toplar */
export function segmentsOf(p) {
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
/*
 * İki doğru parçasının kesişimi. inf=false (öntanımlı) iken kesişim İKİ PARÇANIN da içinde
 * olmak zorundadır — yakalamanın 'int' kipi bunu ister, yoksa uzakta duran iki çizginin
 * uzantısında sahte kesişim çıkar. inf=true ise parçalar SONSUZ doğru sayılır; uzatma (extend)
 * ve iki ayrı doğru arasındaki kavis köşeyi böyle bulur. Matematik tek yerde durur.
 */
export function segIntersect(a, b, inf = false) {
  const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d;
  const u = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
  if (!inf && (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9)) return null;
  return [a[0] + t * (a[2] - a[0]), a[1] + t * (a[3] - a[1])];
}
// ---- budama · uzatma · kavis · pah ---------------------------------------------------
/*
 * Bu bölüm YALNIZ DÜZ segmentlerle çalışır. Yay, daire ve elips hedeflerinde null döner;
 * çağıran kullanıcıya "bu nesne desteklenmiyor" der. Yay–yay kavisi, çoklu seçimle toplu
 * budama ve kesici kenarsız (serbest) budama bu sürümün dışındadır.
 *
 * ops biçimi: [0,x,y,z] moveTo · [1,x,y,z] lineTo · [2,cx,cy,r,a0,a1,z] CCW yay ·
 * [-2,…] CW yay · [3,…] elips. Dizin (i) her zaman segmentin BİTİŞ işleminin dizinidir;
 * kapalı yolun kapanış segmenti i = ops.length ile gösterilir.
 */
const zNum = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/**
 * Dokunulan noktaya en yakın DÜZ segment.
 * → { i, t, a:[x,y,z], b:[x,y,z], d } ya da null (hiç düz segment yoksa)
 * t segment üzerindeki oran; segFoot yerine doğrudan izdüşümle hesaplanır, çünkü segFoot
 * aralık dışında null döner ve uçlara dokunulduğunda budama yapılamaz hâle gelirdi.
 */
export function segAt(ops, closed, w) {
  let lx = 0, ly = 0, lz = 0, sx = 0, sy = 0, sz = 0, has = false, best = null;
  let mn = Infinity, mx = -Infinity;   // kapanış payı için yolun büyüklüğü
  const dene = (i, ax, ay, az, bx, by, bz) => {
    const d = segDist(w[0], w[1], ax, ay, bx, by);
    if (best && d >= best.d) return;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((w[0] - ax) * dx + (w[1] - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = { i, t, a: [ax, ay, az], b: [bx, by, bz], d };
  };
  const genis = (x, y) => { if (x < mn) mn = x; if (x > mx) mx = x; if (y < mn) mn = y; if (y > mx) mx = y; };
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o[0] === 0) { lx = sx = o[1]; ly = sy = o[2]; lz = sz = zNum(o[3]); has = true; genis(o[1], o[2]); continue; }
    if (o[0] === 1) { if (has) dene(i, lx, ly, lz, o[1], o[2], zNum(o[3])); lx = o[1]; ly = o[2]; lz = zNum(o[3]); genis(o[1], o[2]); continue; }
    // yay ve elips tutamak almaz; ama imleç konumu korunmalı, yoksa sonraki segment kayar
    if (o[0] === 2 || o[0] === -2) { lx = o[1] + o[3] * Math.cos(o[5]); ly = o[2] + o[3] * Math.sin(o[5]); lz = zNum(o[6]); genis(o[1] - o[3], o[2] - o[3]); genis(o[1] + o[3], o[2] + o[3]); continue; }
    const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
    lx = pts[pts.length - 1][0]; ly = pts[pts.length - 1][1];
  }
  /*
   * Kapanış segmenti YALNIZ gerçekten bir uzunluğu varsa sayılır. Tam daire ops'u
   * [moveTo(cx+r, cy), arc(0 → 2π)] biçimindedir ve yay Math.sin(2π) = −2,4e−16 yüzünden
   * başladığı noktaya kılpayı dönmez; ham eşitlik denetimi orada sıfıra yakın bir kapanış
   * segmenti uydurur ve daire "budanabilir düz kenarı var" gibi görünürdü.
   */
  const pay = isFinite(mx - mn) ? Math.max(mx - mn, 1) * 1e-9 : 1e-9;
  if (closed && has && Math.hypot(lx - sx, ly - sy) > pay) dene(ops.length, lx, ly, lz, sx, sy, sz);
  return best;
}

/**
 * Budama. Dokunulan segmenti kesici kenarlarla kesip dokunulan parçayı atar.
 * → { parts:[{ops, closed}], cut:[[x,y],[x,y]] } ya da null (kesişim yok / düz segment yok)
 * Kapalı yolda budama yolu AÇAR: kalan tek parça, atılan aralığın bittiği yerden başlayıp
 * kapanış üzerinden dolaşarak başladığı yerde biter.
 */
export function trimPath(ops, closed, cutSegs, w) {
  const s = segAt(ops, closed, w);
  if (!s) return null;
  const [ax, ay, az] = s.a, [bx, by, bz] = s.b;
  const ts = [];
  for (const c of cutSegs) {
    const q = segIntersect([ax, ay, bx, by], [c[0], c[1], c[2], c[3]]);
    if (!q) continue;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const t = ((q[0] - ax) * dx + (q[1] - ay) * dy) / l2;
    if (t > 1e-9 && t < 1 - 1e-9 && !ts.some(v => Math.abs(v - t) < 1e-9)) ts.push(t);
  }
  ts.sort((p, q) => p - q);
  let tA = 0, tB = 1;
  for (const t of ts) { if (t <= s.t) tA = t; else { tB = t; break; } }
  if (tA === 0 && tB === 1) return null;
  const nokta = (t) => [ax + t * (bx - ax), ay + t * (by - ay), az + t * (bz - az)];
  const A = nokta(tA), B = nokta(tB);
  const kopya = (o) => o.slice();
  const i = s.i, N = ops.length;
  if (!ops[0] || ops[0][0] !== 0) return null;
  const bas = [1, ops[0][1], ops[0][2], zNum(ops[0][3])];   // kapanış kenarının varış noktası
  const opAt = (k) => (k < N ? kopya(ops[k]) : bas.slice());
  let parts;
  if (closed) {
    /*
     * Kapalı yolda budama yolu AÇAR. B'den başlanır, dokunulan segmentin bittiği yere gidilir,
     * halka boyunca bir tam tur atılır (kapanış kenarı N. segment sayılır) ve A'da durulur.
     * Segmentler 1..N-1 sıradan işlemler, N ise kapanıştır; halka sırası bu yüzden modülodur.
     */
    const yeni = [[0, B[0], B[1], B[2]]];
    if (tB < 1 - 1e-9) yeni.push(opAt(i));
    for (let m = 1; m < N; m++) yeni.push(opAt(((i - 1 + m) % N) + 1));
    if (tA > 1e-9) yeni.push([1, A[0], A[1], A[2]]);
    parts = yeni.length > 1 ? [{ ops: yeni, closed: false }] : [];
  } else {
    parts = [];
    // Birinci parça: budanan aralığın BAŞINA kadar. tA sıfırsa kesim tam segmentin başındadır,
    // öndeki işlemler yine de kalır — bu parça atlanırsa yolun yarısı sessizce kaybolur.
    const p1 = [];
    for (let k = 0; k < i && k < N; k++) p1.push(kopya(ops[k]));
    if (tA > 1e-9) p1.push([1, A[0], A[1], A[2]]);
    if (p1.length > 1) parts.push({ ops: p1, closed: false });
    // İkinci parça: B'den segmentin KENDİ bitişine, oradan yolun kalanına.
    const p2 = [[0, B[0], B[1], B[2]]];
    if (tB < 1 - 1e-9) p2.push(opAt(i));
    for (let k = i + 1; k < N; k++) p2.push(kopya(ops[k]));
    if (p2.length > 1) parts.push({ ops: p2, closed: false });
  }
  if (!parts.length) return null;
  return { parts, cut: [[A[0], A[1]], [B[0], B[1]]] };
}

/**
 * Uzatma. Yolun dokunulan ucunu, sınır parçalarıyla kesişene kadar uzatır.
 * → { ops, at:'start'|'end', p:[x,y,z] } ya da null
 * Sınırın SINIRLI parçasıyla kesişim bulunamazsa sınırın SONSUZ doğrusuna düşülür — bu
 * AutoCAD'in "kenar uzat" (edge extend) kipine denktir ve bilerek açıktır: kullanıcı kısa
 * bir sınır çizgisine dokunduğunda araç sessizce hiçbir şey yapmasın diye.
 */
export function extendPath(ops, closed, bndSegs, w) {
  if (closed || !ops.length) return null;
  let bas = -1, son = -1;
  for (let i = 0; i < ops.length; i++) { const o = ops[i]; if (o[0] === 0 && bas < 0) bas = i; if (o[0] === 1) son = i; }
  if (bas < 0 || son < 0) return null;
  const basKom = ops[bas + 1] && ops[bas + 1][0] === 1 ? ops[bas + 1] : null;
  const sonKom = son - 1 >= 0 && (ops[son - 1][0] === 0 || ops[son - 1][0] === 1) ? ops[son - 1] : null;
  const adaylar = [];
  if (basKom) adaylar.push({ at: 'start', i: bas, uc: ops[bas], kom: basKom });
  if (sonKom && son !== bas) adaylar.push({ at: 'end', i: son, uc: ops[son], kom: sonKom });
  if (!adaylar.length) return null;
  adaylar.sort((p, q) => Math.hypot(p.uc[1] - w[0], p.uc[2] - w[1]) - Math.hypot(q.uc[1] - w[0], q.uc[2] - w[1]));
  const a = adaylar[0];
  let vx = a.uc[1] - a.kom[1], vy = a.uc[2] - a.kom[2];
  const vl = Math.hypot(vx, vy);
  if (vl < 1e-12) return null;
  vx /= vl; vy /= vl;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const c of bndSegs) { mnx = Math.min(mnx, c[0], c[2]); mxx = Math.max(mxx, c[0], c[2]); mny = Math.min(mny, c[1], c[3]); mxy = Math.max(mxy, c[1], c[3]); }
  if (!isFinite(mnx)) return null;
  const K = Math.max(Math.hypot(mxx - mnx, mxy - mny), Math.hypot(a.uc[1] - mnx, a.uc[2] - mny)) * 4 + 1;
  const isin = [a.uc[1], a.uc[2], a.uc[1] + vx * K, a.uc[2] + vy * K];
  const ara = (inf) => {
    let en = null, ed = Infinity;
    for (const c of bndSegs) {
      const q = segIntersect(isin, [c[0], c[1], c[2], c[3]], inf);
      if (!q) continue;
      const d = (q[0] - a.uc[1]) * vx + (q[1] - a.uc[2]) * vy;
      if (d > 1e-9 && d < ed) { ed = d; en = q; }
    }
    return en;
  };
  const q = ara(false) || ara(true);
  if (!q) return null;
  const yeni = ops.map(o => o.slice());
  const z = zNum(a.uc[3]);
  yeni[a.i] = [a.uc[0], q[0], q[1], z];
  return { ops: yeni, at: a.at, p: [q[0], q[1], z] };
}

/**
 * Kavis (fillet). p0–c–p1 köşesine r yarıçaplı teğet yay oturtur.
 * → { t0, t1, cx, cy, r, a0, a1, ccw } ya da null (çakışık / doğrudaş köşe)
 * İstenen yarıçap kollara sığmıyorsa en kısa kola göre KIRPILIR ve kırpılan değer r'de döner;
 * çağıran isterse kullanıcıya bildirir. Sessizce başarısız olmaktansa sığanı yapmak yeğdir.
 */
export function filletCorner(p0, c, p1, r) {
  let u0x = p0[0] - c[0], u0y = p0[1] - c[1], u1x = p1[0] - c[0], u1y = p1[1] - c[1];
  const l0 = Math.hypot(u0x, u0y), l1 = Math.hypot(u1x, u1y);
  if (l0 < 1e-9 || l1 < 1e-9) return null;
  u0x /= l0; u0y /= l0; u1x /= l1; u1y /= l1;
  const nokta = Math.max(-1, Math.min(1, u0x * u1x + u0y * u1y));
  const ang = Math.acos(nokta);
  if (ang < 1e-6 || Math.abs(ang - Math.PI) < 1e-6) return null;
  const tan = Math.tan(ang / 2);
  let rr = Math.max(1e-9, r), L = rr / tan;
  const Lmax = Math.min(l0, l1);
  if (L > Lmax) { L = Lmax; rr = L * tan; }
  const t0 = [c[0] + u0x * L, c[1] + u0y * L], t1 = [c[0] + u1x * L, c[1] + u1y * L];
  let bx = u0x + u1x, by = u0y + u1y;
  const bl = Math.hypot(bx, by);
  if (bl < 1e-12) return null;
  bx /= bl; by /= bl;
  const h = rr / Math.sin(ang / 2);
  const cx = c[0] + bx * h, cy = c[1] + by * h;
  const a0 = Math.atan2(t0[1] - cy, t0[0] - cx), a1 = Math.atan2(t1[1] - cy, t1[0] - cx);
  // Yayın yönü: t0'dan t1'e giderken hangi yönde döndüğü. Çapraz çarpım işareti verir.
  const ccw = (u0x * u1y - u0y * u1x) < 0;
  return { t0, t1, cx, cy, r: rr, a0, a1, ccw };
}

/** Pah (chamfer). Köşeyi d0/d1 mesafelerinde kesip düz bir kenarla birleştirir. */
export function chamferCorner(p0, c, p1, d0, d1) {
  let u0x = p0[0] - c[0], u0y = p0[1] - c[1], u1x = p1[0] - c[0], u1y = p1[1] - c[1];
  const l0 = Math.hypot(u0x, u0y), l1 = Math.hypot(u1x, u1y);
  if (l0 < 1e-9 || l1 < 1e-9) return null;
  u0x /= l0; u0y /= l0; u1x /= l1; u1y /= l1;
  const ang = Math.acos(Math.max(-1, Math.min(1, u0x * u1x + u0y * u1y)));
  if (ang < 1e-6 || Math.abs(ang - Math.PI) < 1e-6) return null;
  const a = Math.min(Math.max(1e-9, d0), l0), b = Math.min(Math.max(1e-9, d1), l1);
  return { t0: [c[0] + u0x * a, c[1] + u0y * a], t1: [c[0] + u1x * b, c[1] + u1y * b] };
}

/**
 * Yolun bir ucunu VERİLEN BOY kadar uzatır (delta > 0) ya da kısaltır (delta < 0) — AutoCAD
 * LENGTHEN'in DElta seçeneği. Uç, dokunulan noktaya (w) yakın olandır. Yalnız düz işlemlerden
 * (moveTo / lineTo) oluşan AÇIK yollarda çalışır: yaylı ya da kapalı yolda null döner.
 * Kısaltma birden çok düğümü yutabilir (150 birim, 100'lük iki segmentten birini tamamen alır,
 * ötekinden 50 keser); yol boyundan uzun kısaltmada null döner.
 * → { ops, at:'start'|'end', delta } ya da null
 */
export function lengthenPath(ops, closed, w, delta) {
  if (closed || !Array.isArray(ops) || ops.length < 2 || !isFinite(delta) || delta === 0) return null;
  if (!ops.every(o => Array.isArray(o) && (o[0] === 0 || o[0] === 1))) return null;
  const first = ops[0], last = ops[ops.length - 1];
  const atEnd = Math.hypot(w[0] - last[1], w[1] - last[2]) <= Math.hypot(w[0] - first[1], w[1] - first[2]);
  // her zaman SON uçta çalışılır: baştan istenirse düğüm sırası çevrilir, sonra geri çevrilir
  const rev = (L) => L.slice().reverse().map((o, i) => [i ? 1 : 0, o[1], o[2], o[3]]);
  let V = atEnd ? ops.map(o => o.slice()) : rev(ops);
  if (delta > 0) {
    const a = V[V.length - 2], b = V[V.length - 1];
    const L = Math.hypot(b[1] - a[1], b[2] - a[2]);
    if (L < 1e-12) return null;
    const ux = (b[1] - a[1]) / L, uy = (b[2] - a[2]) / L;
    V[V.length - 1] = [1, b[1] + ux * delta, b[2] + uy * delta, b[3]];
  } else {
    let rem = -delta;
    while (V.length >= 2) {
      const a = V[V.length - 2], b = V[V.length - 1];
      const L = Math.hypot(b[1] - a[1], b[2] - a[2]);
      if (rem < L - 1e-9) { const ux = (b[1] - a[1]) / L, uy = (b[2] - a[2]) / L; V[V.length - 1] = [1, b[1] - ux * rem, b[2] - uy * rem, b[3]]; rem = 0; break; }
      rem -= L; V.pop();
    }
    if (rem > 1e-9 || V.length < 2) return null;
  }
  return { ops: atEnd ? V : rev(V), at: atEnd ? 'end' : 'start', delta };
}

/**
 * İki dokunuşun tarif ettiği köşeyi çözer.
 * → { kind:'same'|'two', i, j, c, p0, p1 } ya da null
 * kind 'same': aynı ilkelde ARDIŞIK iki segment — ortak köşe zaten vardır, kavis içeri girer.
 * kind 'two': ayrı ilkeller — köşe, iki segmentin SONSUZ doğrularının kesişimidir; p0/p1 her
 * segmentin kesişimden UZAK ucudur, böylece kavis kullanıcının dokunduğu tarafa oturur.
 */
export function cornerAt(opsA, closedA, wA, opsB, closedB, wB) {
  const sA = segAt(opsA, closedA, wA), sB = segAt(opsB, closedB, wB);
  if (!sA || !sB) return null;
  if (opsA === opsB) {
    if (sA.i === sB.i) return null;
    const [ilk, son] = sA.i < sB.i ? [sA, sB] : [sB, sA];
    if (son.i !== ilk.i + 1) return null;               // yalnız ARDIŞIK segmentler
    return { kind: 'same', i: ilk.i, j: son.i, c: [ilk.b[0], ilk.b[1]], p0: [ilk.a[0], ilk.a[1]], p1: [son.b[0], son.b[1]] };
  }
  const c = segIntersect([sA.a[0], sA.a[1], sA.b[0], sA.b[1]], [sB.a[0], sB.a[1], sB.b[0], sB.b[1]], true);
  if (!c) return null;
  const uzak = (s) => (Math.hypot(s.a[0] - c[0], s.a[1] - c[1]) >= Math.hypot(s.b[0] - c[0], s.b[1] - c[1]) ? [s.a[0], s.a[1]] : [s.b[0], s.b[1]]);
  return { kind: 'two', i: sA.i, j: sB.i, c, p0: uzak(sA), p1: uzak(sB) };
}

/*
 * YAKALAMA (nesne yakalama, OSNAP). AutoCAD'in çalışan kiplerinin TAMAMI:
 *   end uç · mid orta · cen merkez · gcen geometrik merkez · node düğüm · qua çeyrek · int kesişim ·
 *   ext uzantı · ins ekleme · per dik · tan teğet · nea en yakın · app görünür kesişim · par paralel
 *
 * prims: aday ilkeller (açıklık penceresi) · w: dünya noktası · tol: açıklık (dünya birimi) ·
 * modes: Set · prev: önceki nokta (dik, teğet ve paralel bunu ister; yoksa o kipler ertelenir) ·
 * opt.wide: paralel için geniş aday kümesi — referans doğru imlecin altında olmak zorunda değildir.
 *
 * Öncelik AutoCAD'deki gibidir: aynı açıklıkta birden çok aday varsa uç / düğüm > kesişim > merkez /
 * ekleme > çeyrek > orta > teğet > dik > uzantı / paralel > en yakın; ağırlık (PRI) uzaklığa eklenir.
 * Kesişim (int) ile görünür kesişim (app) farkı: int iki parçanın Z'si de biliniyorsa aynı kotta
 * olmasını ister; app yalnız ekrandaki (XY) çakışmaya bakar — 3B ağ kenarlarında ikisi ayrışır.
 * Yaylar CCW'ye normalize edilir; saat yönlü yayın (op −2) orta ve çeyrek noktaları da doğru çıkar.
 * → { p:[x,y,z], kind } ya da null
 */
const PRI = { end: 0, node: 0, int: 0.1, app: 0.15, cen: 0.2, ins: 0.2, gcen: 0.25, qua: 0.25, mid: 0.3, tan: 0.4, per: 0.5, ext: 0.6, par: 0.6, nea: 0.9 };
export const SNAP_MODES = Object.keys(PRI);
/** Yolun parçaları: düz segmentler, CCW yaylar, elipsler ve elips örnek segmentleri (yalnız en yakın / kesişim için) */
function pathParts(p) {
  const segs = [], arcs = [], ells = [], esegs = [];
  let lx = 0, ly = 0, lz, sx = 0, sy = 0, sz;
  for (const o of p.ops) {
    if (o[0] === 0) { lx = sx = o[1]; ly = sy = o[2]; lz = sz = o[3]; continue; }
    if (o[0] === 1) { segs.push([lx, ly, o[1], o[2], lz, o[3]]); lx = o[1]; ly = o[2]; lz = o[3]; continue; }
    if (o[0] === 2 || o[0] === -2) {
      arcs.push(o[0] === 2 ? { cx: o[1], cy: o[2], r: o[3], a0: o[4], a1: o[5], z: o[6] } : { cx: o[1], cy: o[2], r: o[3], a0: o[5], a1: o[4], z: o[6] });
      lx = o[1] + o[3] * Math.cos(o[5]); ly = o[2] + o[3] * Math.sin(o[5]); lz = undefined; continue;
    }
    if (o[0] === 3) {
      ells.push({ cx: o[1], cy: o[2], rx: o[3], ry: o[4], rot: o[5], a0: o[6], a1: o[7] });
      const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
      for (let i = 1; i < pts.length; i++) esegs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
      lx = pts[pts.length - 1][0]; ly = pts[pts.length - 1][1]; lz = undefined;
    }
  }
  if (p.closed && (lx !== sx || ly !== sy)) segs.push([lx, ly, sx, sy, lz, sz]);
  return { segs, arcs, ells, esegs };
}
/** Elips parametresindeki nokta (ellipsePts ile aynı kurgu) */
function ellAt(e, a) {
  const x = e.rx * Math.cos(a), y = e.ry * Math.sin(a), cs = Math.cos(e.rot), sn = Math.sin(e.rot);
  return [e.cx + x * cs - y * sn, e.cy + x * sn + y * cs];
}
/** Doğru parçası – çember kesişimleri (parça içinde, yay aralığında) */
function segArcHits(s, a) {
  const dx = s[2] - s[0], dy = s[3] - s[1], fx = s[0] - a.cx, fy = s[1] - a.cy;
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - a.r * a.r;
  if (A < 1e-18) return [];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc), out = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const x = s[0] + t * dx, y = s[1] + t * dy;
    if (angIn(Math.atan2(y - a.cy, x - a.cx), a.a0, a.a1)) out.push([x, y]);
  }
  return out;
}
/** Çember – çember kesişimleri (iki yayın da aralığında) */
function arcArcHits(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
  if (d < 1e-12 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return [];
  const x = (d * d - b.r * b.r + a.r * a.r) / (2 * d), h2 = a.r * a.r - x * x, h = h2 > 0 ? Math.sqrt(h2) : 0;
  const mx = a.cx + x * dx / d, my = a.cy + x * dy / d, out = [];
  for (const sg of (h > 0 ? [1, -1] : [1])) {
    const px = mx + sg * h * (-dy / d), py = my + sg * h * (dx / d);
    if (angIn(Math.atan2(py - a.cy, px - a.cx), a.a0, a.a1) && angIn(Math.atan2(py - b.cy, px - b.cx), b.a0, b.a1)) out.push([px, py]);
  }
  return out;
}
/** Kesişim noktasındaki kot: parça üzerindeki oran ile doğrusal; bilinmiyorsa undefined */
function zOn(s, x, y) {
  if (s[4] == null || s[5] == null) return undefined;
  const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
  const t = l2 ? ((x - s[0]) * dx + (y - s[1]) * dy) / l2 : 0;
  return s[4] + t * (s[5] - s[4]);
}
/*
 * YAKALAMA ADAYLARI (v7.87). snapPoint tek "en iyi" noktayı döndürür; bu yeterli değildir:
 * parmakla çizerken kullanıcı hedefi piksel piksel bulamaz, ama açıklık içindeki adaylar
 * AYRIK ve azdır — doğru çözüm listeyi gösterip seçtirmektir (AutoCAD'in TAB ile aday
 * değiştirmesinin dokunmatik karşılığı).
 *
 * Gezinme snapPoint'ten gelir, kopyalanmaz. Dönen liste:
 *   [{ p:[x,y,z], kind, d, prim }]  — uzaklığa göre sıralı, aynı nokta+kip bir kez.
 * Sıralamada kipe küçük bir ağırlık verilir: eşit uzaklıkta UÇ, ORTA'nın önüne geçsin.
 */
export function snapCandidates(prims, w, tol, modes, prev, opt = {}) {
  const enCok = opt.max == null ? 6 : opt.max;
  const gorulen = new Map();
  const yuvarla = (v) => Math.round(v / (tol * 1e-3 || 1e-9));
  snapPoint(prims, w, tol, modes, prev, {
    ...opt,
    onCand: (x, y, kind, z, d, prim) => {
      /*
       * Ayıklama KOORDİNATA göredir, kipe göre değil: kullanıcı bir NOKTA seçiyor. Aynı piksele
       * düşen UÇ ile KESİŞİM iki ayrı çip olarak gösterilseydi seçici gereksiz kalabalık olurdu;
       * o noktanın en güçlü kipi (PRI) kazanır.
       */
      const anahtar = yuvarla(x) + ':' + yuvarla(y);
      const skor = d + PRI[kind] * tol * 0.1;
      const eski = gorulen.get(anahtar);
      if (eski && eski.skor <= skor) return;
      gorulen.set(anahtar, { p: [x, y, z], kind, d, skor, prim: prim || null });
    },
  });
  const liste = [...gorulen.values()];
  liste.sort((a, b) => a.skor - b.skor);
  return liste.slice(0, enCok);
}

export function snapPoint(prims, w, tol, modes, prev, opt = {}) {
  let best = null, bd = tol;
  const has = (m) => modes.has(m);
  /*
   * opt.onCand: aday TOPLAYICI. snapPoint tek "en iyi" noktayı döndürür; dokunmatikte ise
   * açıklık içindeki BÜTÜN adayları kullanıcıya listelemek gerekir (v7.87 yakalama aparatı).
   * Gezinme kopyalanmaz — aynı test() hem en iyiyi seçer hem isteyene her adayı bildirir.
   */
  let curPrim = null;
  const test = (x, y, kind, z) => {
    if (!(isFinite(x) && isFinite(y))) return;
    const ham = Math.hypot(x - w[0], y - w[1]);
    if (opt.onCand && ham <= tol) opt.onCand(x, y, kind, z, ham, curPrim);
    const d = ham + PRI[kind] * tol * 0.5;
    if (d < bd) { bd = d; best = { p: [x, y, z], kind }; }
  };
  const allSegs = [], allArcs = [];
  const wantX = has('int') || has('app');
  const straight = (s) => {
    if (has('end')) { test(s[0], s[1], 'end', s[4]); test(s[2], s[3], 'end', s[5]); }
    if (has('mid')) test((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, 'mid', s[4] != null && s[5] != null ? (s[4] + s[5]) / 2 : undefined);
    if (has('per') && prev) { const f = segFoot(prev[0], prev[1], s[0], s[1], s[2], s[3]); if (f) test(f[0], f[1], 'per', zOn(s, f[0], f[1])); }
    if (has('nea')) { const f = segFoot(w[0], w[1], s[0], s[1], s[2], s[3]); if (f) test(f[0], f[1], 'nea', zOn(s, f[0], f[1])); }
    if (has('ext')) {
      // parçanın SONSUZ doğrusu üzerindeki dik ayak; yalnız parçanın DIŞINDA kalıyorsa uzantıdır
      const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
      if (l2 > 0) { const t = ((w[0] - s[0]) * dx + (w[1] - s[1]) * dy) / l2; if (t < 0 || t > 1) test(s[0] + t * dx, s[1] + t * dy, 'ext', s[4] != null && s[5] != null ? s[4] + t * (s[5] - s[4]) : undefined); }
    }
    if (wantX && allSegs.length < 400) allSegs.push(s);
  };
  const curved = (a) => {
    if (has('cen')) test(a.cx, a.cy, 'cen', a.z);
    const at = (ang) => [a.cx + a.r * Math.cos(ang), a.cy + a.r * Math.sin(ang)];
    let span = a.a1 - a.a0; while (span <= 0) span += TAU;
    const full = span >= TAU - 1e-9;
    if (has('end') && !full) { const p0 = at(a.a0), p1 = at(a.a1); test(p0[0], p0[1], 'end', a.z); test(p1[0], p1[1], 'end', a.z); }
    if (has('mid') && !full) { const m = at(a.a0 + span / 2); test(m[0], m[1], 'mid', a.z); }
    if (has('qua')) for (let k = 0; k < 4; k++) { const q = k * Math.PI / 2; if (angIn(q, a.a0, a.a1)) { const pq = at(q); test(pq[0], pq[1], 'qua', a.z); } }
    const aw = Math.atan2(w[1] - a.cy, w[0] - a.cx), inW = angIn(aw, a.a0, a.a1);
    if (has('nea') && inW) { const n = at(aw); test(n[0], n[1], 'nea', a.z); }
    if (has('ext') && !full && !inW) { const n = at(aw); test(n[0], n[1], 'ext', a.z); }   // yayın çember üzerindeki devamı
    if (has('per') && prev) {
      const ap = Math.atan2(prev[1] - a.cy, prev[0] - a.cx);
      for (const ang of [ap, ap + Math.PI]) if (angIn(ang, a.a0, a.a1)) { const f = at(ang); test(f[0], f[1], 'per', a.z); }
    }
    if (has('tan') && prev) {
      // prev'den çembere iki teğet: merkez–prev doğrultusundan ±acos(r/d)
      const d = Math.hypot(prev[0] - a.cx, prev[1] - a.cy);
      if (d > a.r + 1e-9) {
        const th = Math.acos(a.r / d), ap = Math.atan2(prev[1] - a.cy, prev[0] - a.cx);
        for (const ang of [ap + th, ap - th]) if (angIn(ang, a.a0, a.a1)) { const q = at(ang); test(q[0], q[1], 'tan', a.z); }
      }
    }
    if (wantX && allArcs.length < 200) allArcs.push(a);
  };
  for (const p of prims) {
    curPrim = p;
    if (p.k === 2) { if (has('node') || has('end')) test(p.x, p.y, 'node', p.z); continue; }
    if (p.k === 4 || p.k === 1) { if (has('ins') && typeof p.x === 'number') test(p.x, p.y, 'ins', p.z); continue; }
    if (p.k === 5) {                                 // ağ ilkeli: kenar dizisi doğrudan taranır (kopyalanmaz)
      const g = p.seg;
      if (!g || !g.length || g.length > 1200000) continue;
      for (let i = 0; i + 5 < g.length; i += 6) {
        const x1 = g[i], y1 = g[i + 1], z1 = g[i + 2], x2 = g[i + 3], y2 = g[i + 4], z2 = g[i + 5];
        if ((x1 < x2 ? x1 : x2) - tol > w[0] || (x1 > x2 ? x1 : x2) + tol < w[0]) continue;   // tolerans penceresi (kayıpsız eleme)
        if ((y1 < y2 ? y1 : y2) - tol > w[1] || (y1 > y2 ? y1 : y2) + tol < w[1]) continue;
        straight([x1, y1, x2, y2, z1, z2]);
      }
      continue;
    }
    if (p.k !== 0) continue;
    const { segs, arcs, ells, esegs } = pathParts(p);
    for (const s of segs) straight(s);
    for (const a of arcs) curved(a);
    for (const e of ells) {
      if (has('cen')) test(e.cx, e.cy, 'cen');
      let span = e.a1 - e.a0; while (span <= 0) span += TAU;
      const full = span >= TAU - 1e-9;
      if (has('end') && !full) { const p0 = ellAt(e, e.a0), p1 = ellAt(e, e.a1); test(p0[0], p0[1], 'end'); test(p1[0], p1[1], 'end'); }
      if (has('mid') && !full) { const m = ellAt(e, e.a0 + span / 2); test(m[0], m[1], 'mid'); }
      if (has('qua')) for (let k = 0; k < 4; k++) { const q = k * Math.PI / 2; if (angIn(q, e.a0, e.a1)) { const pq = ellAt(e, q); test(pq[0], pq[1], 'qua'); } }
    }
    for (const s of esegs) {   // elips örnekleri: yalnız en yakın ve kesişim (uç / orta / uzantı sahte olurdu)
      if (has('nea')) { const f = segFoot(w[0], w[1], s[0], s[1], s[2], s[3]); if (f) test(f[0], f[1], 'nea'); }
      if (wantX && allSegs.length < 400) allSegs.push(s);
    }
    if (has('gcen') && p.closed) {
      // kapalı yolun alan ağırlık merkezi (yaylar ve elipsler örneklenir)
      const poly = [];
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) poly.push([o[1], o[2]]);
        else if (o[0] === 2 || o[0] === -2) { const pts = []; ellipsePts(o[1], o[2], o[3], o[3], 0, o[0] === 2 ? o[4] : o[5], o[0] === 2 ? o[5] : o[4], pts); for (const q of pts) poly.push(q); }
        else if (o[0] === 3) { const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts); for (const q of pts) poly.push(q); }
      }
      let A = 0, cx = 0, cy = 0;
      for (let i = 0, n = poly.length; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], f = a[0] * b[1] - b[0] * a[1]; A += f; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; }
      if (Math.abs(A) > 1e-12) test(cx / (3 * A), cy / (3 * A), 'gcen');
    }
  }
  curPrim = null;   // kesişimler tek bir ilkele ait değildir
  if (wantX) {
    const both = has('int'), app = has('app');
    const hit = (x, y, s1, s2) => {
      const z1 = s1 ? zOn(s1, x, y) : undefined, z2 = s2 ? zOn(s2, x, y) : undefined;
      const ayniKot = z1 == null || z2 == null || Math.abs(z1 - z2) <= tol;
      if (both && ayniKot) test(x, y, 'int', z1 != null ? z1 : z2);
      else if (app) test(x, y, 'app', z1 != null ? z1 : z2);
    };
    for (let i = 0; i < allSegs.length; i++) for (let j = i + 1; j < allSegs.length; j++) {
      const x = segIntersect(allSegs[i], allSegs[j]);
      if (x) hit(x[0], x[1], allSegs[i], allSegs[j]);
    }
    for (const s of allSegs) for (const a of allArcs) for (const q of segArcHits(s, a)) hit(q[0], q[1], s, null);
    for (let i = 0; i < allArcs.length; i++) for (let j = i + 1; j < allArcs.length; j++) for (const q of arcArcHits(allArcs[i], allArcs[j])) hit(q[0], q[1], null, null);
  }
  if (has('par') && prev) {
    // Paralel: prev'den geçen, referans doğruya paralel yol üzerinde imlece en yakın nokta.
    // Referans, dokunuşa en yakın DÜZ parçadır; geniş aday kümesi verilirse oradan seçilir.
    let ref = null, rd = Infinity;
    for (const p of (opt.wide || prims)) {
      if (p.k !== 0) continue;
      for (const s of pathParts(p).segs) {
        const dx = s[2] - s[0], dy = s[3] - s[1], l = Math.hypot(dx, dy);
        if (l < 1e-12) continue;
        const ux = dx / l, uy = dy / l, tt = (w[0] - prev[0]) * ux + (w[1] - prev[1]) * uy;
        const qx = prev[0] + ux * tt, qy = prev[1] + uy * tt;
        const off = Math.hypot(w[0] - qx, w[1] - qy);
        if (off > tol) continue;
        const dRef = segDist(w[0], w[1], s[0], s[1], s[2], s[3]);   // dokunuşa yakın referans yeğlenir
        if (dRef < rd) { rd = dRef; ref = [qx, qy]; }
      }
    }
    if (ref) test(ref[0], ref[1], 'par');
  }
  return best;
}

/**
 * Üçgen ağın alan ve hacim ölçüleri (3B). vtx: düz Float32Array (x,y,z…), idx: üçgen köşe dizini.
 *
 *   total    bütün üçgenlerin gerçek (eğimli) alanı toplamı — yüzey alanı
 *   lateral  normali yataya yakın üçgenler: yanal (düşey) yüzeyler. Sınır cosLimit = |nz|/‖n‖;
 *            0,5 düşeyden en çok 30° sapan yüzey demektir.
 *   flat     geri kalan (yatayımsı) üçgenlerin gerçek alanı
 *   top      normali yukarı bakan üçgenlerin XY izdüşümü — üstten görünen plan alanı
 *   bottom   normali aşağı bakan üçgenlerin XY izdüşümü
 *   volume   işaretli hacim toplamının mutlak değeri; yalnız KAPALI ağda hacimdir
 *   tris     üçgen sayısı
 *
 * Alanlar çizim birimi karesindedir; çağıran gerekirse S.unitToM ile metreye çevirir.
 */
export function meshMetrics(vtx, idx, cosLimit = 0.5) {
  const out = { total: 0, lateral: 0, flat: 0, top: 0, bottom: 0, volume: 0, tris: 0 };
  if (!vtx || !idx || idx.length < 3) return out;
  let vol = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = vtx[a], ay = vtx[a + 1], az = vtx[a + 2];
    const bx = vtx[b], by = vtx[b + 1], bz = vtx[b + 2];
    const cx = vtx[c], cy = vtx[c + 1], cz = vtx[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const n = Math.hypot(nx, ny, nz);
    if (!(n > 0)) continue;                 // yozlaşmış üçgen: alana da hacme de katılmaz
    const area = n / 2;
    out.tris++;
    out.total += area;
    if (Math.abs(nz) / n <= cosLimit) out.lateral += area; else out.flat += area;
    if (nz > 0) out.top += nz / 2; else out.bottom += -nz / 2;
    vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6;
  }
  out.volume = Math.abs(vol);
  return out;
}

// ---------------------------------------------------------------------------------------
// Çokgen üçgenlemesi (kulak kırpma)
// ---------------------------------------------------------------------------------------
/**
 * Basit (kendini kesmeyen) çokgeni üçgenlere ayırır. pts: [[x,y]…] kapalı kabul edilir
 * (son nokta ilkine eşitse yok sayılır). Dönüş: köşe DİZİNLERİ üçlüleri [i,j,k,…].
 * Kulak kırpma O(n²)'dir; profil ve tarama sınırı gibi yüz köşeli çokgenler için fazlasıyla hızlıdır.
 * Yön (saat yönü / tersi) kendiliğinden düzeltilir; dejenere üçgen üretilmez.
 */
export function triangulate(pts) {
  const P = pts.slice();
  if (P.length > 1) { const a = P[0], b = P[P.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) P.pop(); }
  const n = P.length;
  if (n < 3) return [];
  const idx = P.map((_, i) => i);
  if (polyArea2(P) < 0) idx.reverse();                 // kulak kırpma saat yönü tersi ister
  const out = [];
  let guard = 2 * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (!isEar(P, idx, a, b, c)) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;                                // kendini kesen ya da dejenere çokgen: elde kalanı yelpaze yap
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  else if (idx.length > 3) for (let i = 1; i + 1 < idx.length; i++) out.push([idx[0], idx[i], idx[i + 1]]);
  return out;
}
/** İşaretli iki katı alan (yön belirlemek için) */
function polyArea2(P) { let s = 0; for (let i = 0, n = P.length; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s; }
function isEar(P, idx, a, b, c) {
  const A = P[a], B = P[b], C = P[c];
  const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
  if (cross <= 1e-12) return false;                     // dışbükey değil (ya da dejenere)
  for (const q of idx) {
    if (q === a || q === b || q === c) continue;
    if (inTri(P[q], A, B, C)) return false;
  }
  return true;
}
function inTri(p, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-15) return false;
  const u = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / d;
  const v = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / d;
  return u >= -1e-12 && v >= -1e-12 && u + v <= 1 + 1e-12;
}

// ---------------------------------------------------------------------------------------
// 3B vektör ve geometrik ölçüm çekirdeği
// ---------------------------------------------------------------------------------------
/*
 * Aşağıdaki işlevler 3B ölçüm ailesinin (nokta-doğru, nokta-düzlem, doğru-doğru, doğru-düzlem,
 * düzlem-düzlem, düzlemler arası açı) hesap çekirdeğidir. Hepsi saf: girdi [x,y,z] dizileri,
 * çıktı sayı ya da küçük nesne. Ekran, seçim ve birim çevrimi çağıranın işidir.
 * Paralellik eşiği EPS_PAR: iki doğrultunun çapraz çarpım büyüklüğü bunun altındaysa paralel sayılır.
 */
const EPS_PAR = 1e-9;
export const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const v3len = (a) => Math.hypot(a[0], a[1], a[2]);
export const v3norm = (a) => { const L = v3len(a); return L > 0 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 0]; };
export const dist3 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
/** İki doğrultu arasındaki dar açı, derece (0-90) */
export const angleBetween = (u, v) => {
  const lu = v3len(u), lv = v3len(v);
  if (!(lu > 0) || !(lv > 0)) return NaN;
  const c = Math.min(1, Math.max(-1, Math.abs(v3dot(u, v)) / (lu * lv)));
  return Math.acos(c) * 180 / Math.PI;
};
/** Nokta – doğru (a,b) uzaklığı ve doğru üzerindeki dik ayağı */
export function pointLine3(p, a, b) {
  const d = v3sub(b, a), L2 = v3dot(d, d);
  if (L2 < 1e-24) return { dist: dist3(p, a), foot: a.slice(), t: 0 };
  const t = v3dot(v3sub(p, a), d) / L2;
  const foot = v3add(a, v3mul(d, t));
  return { dist: dist3(p, foot), foot, t };
}
/** Üç noktadan düzlem: {n (birim normal), d} — n·x = d; noktalar doğrusalsa null */
export function planeFrom3(a, b, c) {
  const n0 = v3cross(v3sub(b, a), v3sub(c, a));
  if (v3len(n0) < EPS_PAR) return null;
  const n = v3norm(n0);
  return { n, d: v3dot(n, a), p0: a.slice() };
}
/** Nokta – düzlem işaretli uzaklığı ve düzlem üzerindeki izdüşümü */
export function pointPlane3(p, pl) {
  const s = v3dot(pl.n, p) - pl.d;
  return { dist: Math.abs(s), signed: s, foot: v3sub(p, v3mul(pl.n, s)) };
}
/**
 * Doğru – doğru: en kısa uzaklık, en yakın nokta çifti ve dar açı.
 * Paralel doğrularda uzaklık nokta-doğru uzaklığıdır; kesişiyorlarsa uzaklık ~0 çıkar.
 */
export function lineLine3(a1, a2, b1, b2) {
  const u = v3sub(a2, a1), v = v3sub(b2, b1), w = v3sub(a1, b1);
  const A = v3dot(u, u), B = v3dot(u, v), C = v3dot(v, v), D = v3dot(u, w), E = v3dot(v, w);
  const den = A * C - B * B;
  const ang = angleBetween(u, v);
  if (Math.abs(den) < EPS_PAR * Math.max(1, A * C)) {          // paralel
    const r = pointLine3(b1, a1, a2);
    return { dist: r.dist, parallel: true, angle: 0, pa: r.foot, pb: b1.slice() };
  }
  const s = (B * E - C * D) / den, t = (A * E - B * D) / den;
  const pa = v3add(a1, v3mul(u, s)), pb = v3add(b1, v3mul(v, t));
  return { dist: dist3(pa, pb), parallel: false, angle: ang, pa, pb };
}
/** Doğru – düzlem: kesişiyorsa uzaklık 0 ve kesişim noktası; paralelse uzaklık ve açı 0 */
export function linePlane3(a, b, pl) {
  const u = v3sub(b, a), dn = v3dot(pl.n, u);
  const ang = 90 - angleBetween(u, pl.n);                       // doğru ile düzlem arasındaki açı
  if (Math.abs(dn) < EPS_PAR * Math.max(1, v3len(u))) {         // paralel: uzaklık sabittir
    return { dist: pointPlane3(a, pl).dist, parallel: true, angle: 0, at: null };
  }
  const t = (pl.d - v3dot(pl.n, a)) / dn;
  return { dist: 0, parallel: false, angle: Math.abs(ang), at: v3add(a, v3mul(u, t)) };
}
/** Düzlem – düzlem: paralellerse uzaklık, değilse açı (0-90) */
export function planePlane3(p1, p2) {
  const ang = angleBetween(p1.n, p2.n);
  const par = v3len(v3cross(p1.n, p2.n)) < 1e-7;
  if (par) {
    const s = v3dot(p1.n, p2.p0) - p1.d;
    return { parallel: true, dist: Math.abs(s), angle: 0 };
  }
  return { parallel: false, dist: 0, angle: ang };
}

/*
 * TARAMA DESENİ. AutoCAD .pat biçimli tanım satırları: her satır bir çizgi ailesidir —
 * [açı°, taban x, taban y, Δx, Δy, ...çizgi/boşluk dizisi]. Δ, ardışık çizgiler arası ötelemedir;
 * dizi boşsa çizgi süreklidir, negatif değer boşluktur, sıfır noktadır.
 *
 * Tablo acad.pat değerleridir ve BURADA TEK KOPYA durur: DWG/DXF'ten gelen tanımlar da, bizim
 * ürettiğimiz taramalar da aynı çiziciden (hatchLines) geçer. İkinci bir desen tanımı ya da
 * ikinci bir çizici yazılmaz — yoksa okunan ile üretilen tarama zamanla ayrışır.
 */
export const HATCH_PATTERNS = {
  SOLID: [],
  ANSI31: [[45, 0, 0, 0, 0.125]],
  ANSI32: [[45, 0, 0, 0, 0.375], [45, 0.176776695, 0, 0, 0.375]],
  ANSI33: [[45, 0, 0, 0, 0.25], [45, 0.176776695, 0, 0, 0.25, 0.125, -0.0625]],
  ANSI37: [[45, 0, 0, 0, 0.125], [135, 0, 0, 0, 0.125]],
  NET: [[0, 0, 0, 0, 0.125], [90, 0, 0, 0, 0.125]],
  LINE: [[0, 0, 0, 0, 0.125]],
  DOTS: [[0, 0, 0, 0.03125, 0.0625, 0, -0.0625]],
  CROSS: [[0, 0, 0, 0.25, 0.25, 0.125, -0.375], [90, 0.0625, -0.0625, 0.25, 0.25, 0.125, -0.375]],
  EARTH: [[0, 0, 0, 0.25, 0.25, 0.25, -0.0625], [0, 0, 0.09375, 0.25, 0.25, 0.25, -0.0625], [90, 0, 0, 0.25, 0.25, 0.25, -0.0625], [90, 0.09375, 0, 0.25, 0.25, 0.25, -0.0625]],
  GRAVEL: [[45, 0, 0, 0.21875, 0.1875, 0.0625, -0.125], [45, 0.0625, 0.0625, 0.21875, 0.1875, 0.0625, -0.125]],
};
/** Desen adı → çizici tanım satırları. ölçek ve dönüş uygulanır; bilinmeyen ad ya da SOLID → [] */
export function patternDefs(name, scale = 1, angleDeg = 0) {
  const raw = HATCH_PATTERNS[String(name || '').toUpperCase()];
  if (!raw || !raw.length) return [];
  const k = Math.abs(scale) > 1e-9 ? Math.abs(scale) : 1;
  const rot = (angleDeg || 0) * Math.PI / 180, cs = Math.cos(rot), sn = Math.sin(rot);
  return raw.map(r => {
    const a = (r[0] || 0) * Math.PI / 180 + rot;
    const bx = (r[1] || 0) * k, by = (r[2] || 0) * k;
    const dx = (r[3] || 0) * k, dy = (r[4] || 0) * k;
    return {
      angle: a,
      // taban desen uzayındadır: yalnız kullanıcı dönüşüyle döner. Kayma ise ÇİZGİNİN kendi
      // ekseninde verilir (acad.pat / DXF 45-46) — döndürülmez, yalnız ölçeklenir.
      base: { x: bx * cs - by * sn, y: bx * sn + by * cs },
      offset: { x: dx, y: dy },
      dashLengths: r.slice(5).map(v => v * k),
    };
  });
}
/** Desenin 1 ölçekteki DİK aralığı (en sık çizgi ailesi); otomatik ölçek bunun üstüne kurulur */
export function patternStep(name) {
  let m = Infinity;
  for (const d of patternDefs(name, 1, 0)) { const s = Math.abs((d.offset && d.offset.y) || 0); if (s > 1e-12 && s < m) m = s; }
  return isFinite(m) ? m : 0;
}
/**
 * OTOMATİK DESEN ÖLÇEĞİ. acad.pat desenleri İNÇ tabanlıdır (ANSI31'in aralığı 0,125 birim).
 * Milimetre birimli bir projede 2 m x 2 m'lik bir alan bu aralıkla 22 binden fazla çizgi ister:
 * çizici bütçeyi aşar ve tarama sessizce düz dolguya düşerdi. Burada alanın kısa kenarına göre
 * okunabilir bir aralık seçilir (kısa kenarın ~1/40'ı) ve 1-2-5 basamağına yuvarlanır.
 * polys: [[ [x,y], … ], …]  ·  dönüş: ölçek (>0) ya da desen bilinmiyorsa 1
 */
export function autoHatchScale(name, polys) {
  const step = patternStep(name);
  if (!(step > 0)) return 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pl of polys || []) for (const q of pl) { if (q[0] < x0) x0 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[0] > x1) x1 = q[0]; if (q[1] > y1) y1 = q[1]; }
  const kisa = Math.min(x1 - x0, y1 - y0);
  if (!(kisa > 0) || !isFinite(kisa)) return 1;
  const ham = (kisa / 40) / step;
  if (!(ham > 0) || !isFinite(ham)) return 1;
  const us = Math.pow(10, Math.floor(Math.log10(ham)));
  const k = ham / us;
  return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * us;
}
/**
 * Kapalı çokgenleri desen tanımına göre çizgi parçalarına böler.
 * polys: [[ [x,y], … ], …] · defs: patternDefs çıktısı ya da DXF/DWG tanım satırları
 * Dönüş { ops, segs, minStep } ya da bütçe aşılırsa null.
 *
 * Gövde scene.js'teki çiziciden OLDUĞU GİBİ taşındı; davranış değişmedi, yalnız `this` bağı
 * kesildi ve bütçeler parametre oldu. Okunan tarama ile ürettiğimiz tarama aynı koddan geçer.
 */
export function hatchLines(polys, defs, opt = {}) {
  if (!polys || !polys.length || !defs || !defs.length) return null;
  const maxSeg = opt.maxSeg != null ? opt.maxSeg : 120000;
  const maxWork = opt.maxWork != null ? opt.maxWork : 4e6;
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pl of polys) for (const q of pl) { if (q[0] < bb[0]) bb[0] = q[0]; if (q[1] < bb[1]) bb[1] = q[1]; if (q[0] > bb[2]) bb[2] = q[0]; if (q[1] > bb[3]) bb[3] = q[1]; }
  const diag = Math.hypot(bb[2] - bb[0], bb[3] - bb[1]);
  if (!(diag > 0)) return null;
  const corners = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]];
  const npts = polys.reduce((t, l) => t + l.length, 0);
  const out = []; let segs = 0, lines = 0, minStep = Infinity;
  for (const dl of defs) {
    const a = dl.angle || 0, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const base = dl.base || { x: 0, y: 0 }, off = dl.offset || { x: 0, y: 0 };
    /*
     * KAYMA, ÇİZGİNİN KENDİ EKSENİNDEDİR (acad.pat ve DXF 45/46 kuralı): delta-x çizgi DOĞRULTUSUNDA,
     * delta-y çizgiye DİK ölçülür. Dünya ekseni sanılırsa açılı desenlerde aralık cos(açı) kadar
     * daralır — ANSI31 (45°, delta-y 0,125) AutoCAD'de 0,125 aralıklıyken burada 0,0884 çıkıyordu.
     */
    const dwx = (off.x || 0) * ux + (off.y || 0) * nx, dwy = (off.x || 0) * uy + (off.y || 0) * ny;   // dünya karşılığı
    const step = off.y || 0;                                        // ardışık çizgiler arası dik uzaklık (işaretli)
    if (!(Math.abs(step) > 1e-12)) continue;
    if (Math.abs(step) < minStep) minStep = Math.abs(step);
    const dashes = (dl.dashLengths || []).filter(v => typeof v === 'number' && isFinite(v));
    const period = dashes.reduce((t, v) => t + Math.abs(v), 0);
    let dmin = Infinity, dmax = -Infinity;
    for (const c of corners) { const d = (c[0] - base.x) * nx + (c[1] - base.y) * ny; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
    const i0 = Math.floor(Math.min(dmin / step, dmax / step)) - 1, i1 = Math.ceil(Math.max(dmin / step, dmax / step)) + 1;
    lines += i1 - i0 + 1;
    if (lines > maxSeg || lines * npts > maxWork || (period > 0 && lines * (diag / period) * dashes.length > maxSeg * 4)) return null;   // kırpma maliyeti de sınırlı
    for (let i = i0; i <= i1; i++) {
      const ox = base.x + dwx * i, oy = base.y + dwy * i;
      const ts = [];
      for (const pl of polys) {
        for (let j = 0, m = pl.length; j < m; j++) {
          const p = pl[j], q = pl[(j + 1) % m];
          const den = (q[0] - p[0]) * nx + (q[1] - p[1]) * ny;
          if (Math.abs(den) < 1e-15) continue;
          const sPar = ((ox - p[0]) * nx + (oy - p[1]) * ny) / den;
          if (sPar < 0 || sPar >= 1) continue;
          ts.push((p[0] + sPar * (q[0] - p[0]) - ox) * ux + (p[1] + sPar * (q[1] - p[1]) - oy) * uy);
        }
      }
      if (ts.length < 2) continue;
      ts.sort((x, y) => x - y);
      for (let j = 0; j + 1 < ts.length; j += 2) {
        const t0 = ts[j], t1 = ts[j + 1];
        if (!(t1 - t0 > 1e-12)) continue;
        if (!(period > 0)) { out.push([0, ox + ux * t0, oy + uy * t0], [1, ox + ux * t1, oy + uy * t1]); segs++; continue; }
        let t = Math.floor(t0 / period) * period, di = 0;               // çizgi-boşluk dizisi çizginin kendi başlangıcından (i. taban) sayılır
        while (t < t1) {
          const v = dashes[di], len = Math.abs(v);
          if (v >= 0) {
            const s0 = Math.max(t0, t), s1 = v === 0 ? Math.min(t1, t + diag * 1e-4) : Math.min(t1, t + len);
            if (s1 > s0) { out.push([0, ox + ux * s0, oy + uy * s0], [1, ox + ux * s1, oy + uy * s1]); segs++; }
          }
          t += len; di = (di + 1) % dashes.length;
          if (segs > maxSeg) return null;
        }
      }
    }
  }
  if (!out.length || !isFinite(minStep)) return null;
  return { ops: out, segs, minStep };
}

/*
 * IŞIN-KUTU (slab testi). ix/iy/iz ÇAĞIRAN tarafından bir kez hesaplanmış 1/d değerleridir:
 * her gövde için üç bölme yapmamak içindir, binlerce gövdede fark eder. Işın yönünün bir
 * bileşeni sıfırken 1/0 = ±Infinity doğru sonucu verir (ışın o eksende hiç ilerlemez);
 * NaN yalnız (0 − 0) · Infinity durumunda çıkar ve NaN karşılaştırmaları false döndürdüğü
 * için kutu elenmiş olur — kaybedilen, ışının kutunun yüzeyi üzerinde tam teğet geçtiği
 * kıl payı durumdur, seçimde önemsizdir.
 */
export function rayBox3(ox, oy, oz, ix, iy, iz, x0, y0, z0, x1, y1, z1, tMax) {
  let t0 = (x0 - ox) * ix, t1 = (x1 - ox) * ix;
  if (t0 > t1) { const q = t0; t0 = t1; t1 = q; }
  let u0 = (y0 - oy) * iy, u1 = (y1 - oy) * iy;
  if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
  if (u0 > t0) t0 = u0;
  if (u1 < t1) t1 = u1;
  if (t0 > t1) return false;
  let v0 = (z0 - oz) * iz, v1 = (z1 - oz) * iz;
  if (v0 > v1) { const q = v0; v0 = v1; v1 = q; }
  if (v0 > t0) t0 = v0;
  if (v1 < t1) t1 = v1;
  return t0 <= t1 && t1 >= 0 && t0 <= (tMax == null ? Infinity : tMax);
}
/*
 * IŞIN-ÜÇGEN (Möller–Trumbore). Sıkışık ağ ilkelinin (k=5) vtx/idx dizilerini doğrudan tarar;
 * ara nesne üretmez. zs, Z abartısıdır: üçgenler dünya kotunda durur ama ekranda zs ile
 * ölçeklenmiş görünür, dolayısıyla KESİŞİM ÖLÇEKLENMİŞ UZAYDA aranmalı, dönen nokta ise
 * gerçek kota geri çevrilmelidir — yoksa Z abartısı açıkken seçilen nokta ekranda
 * dokunulan yerden kayar.
 *
 * İki yüzü de kabul eder (arka yüz elenmez): katı olmayan yüzeylerde ve içeriden bakışta
 * yüzün hangi tarafa baktığı kullanıcının umurunda değildir.
 */
export function rayMesh3(vtx, idx, ox, oy, oz, dx, dy, dz, zs = 1, tMax = Infinity, clip = null) {
  let bt = tMax, bi = -1;
  const EPS = 1e-12;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    if (a + 2 >= vtx.length || b + 2 >= vtx.length || c + 2 >= vtx.length) continue;
    const ax = vtx[a], ay = vtx[a + 1], az = vtx[a + 2] * zs;
    const e1x = vtx[b] - vtx[a], e1y = vtx[b + 1] - vtx[a + 1], e1z = (vtx[b + 2] - vtx[a + 2]) * zs;
    const e2x = vtx[c] - vtx[a], e2y = vtx[c + 1] - vtx[a + 1], e2z = (vtx[c + 2] - vtx[a + 2]) * zs;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) continue;                      // ışın üçgenin düzlemine paralel
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t <= 1e-9 || t >= bt) continue;
    if (clip) {                                                 // kesit kutusu: kesilen yüzey seçilemez
      const hx = ox + dx * t, hy = oy + dy * t, hz = (oz + dz * t) / (zs || 1);
      if (hx < clip[0] || hy < clip[1] || hz < clip[2] || hx > clip[3] || hy > clip[4] || hz > clip[5]) continue;
    }
    bt = t; bi = i;
  }
  if (bi < 0) return null;
  const a = idx[bi] * 3, b = idx[bi + 1] * 3, c = idx[bi + 2] * 3;
  const e1x = vtx[b] - vtx[a], e1y = vtx[b + 1] - vtx[a + 1], e1z = (vtx[b + 2] - vtx[a + 2]) * zs;
  const e2x = vtx[c] - vtx[a], e2y = vtx[c + 1] - vtx[a + 1], e2z = (vtx[c + 2] - vtx[a + 2]) * zs;
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // Nokta GERÇEK kota çevrilir: kesişim ölçeklenmiş uzayda bulundu
  return { t: bt, p: [ox + dx * bt, oy + dy * bt, (oz + dz * bt) / (zs || 1)], n: [nx, ny, nz], tri: bi / 3 };
}

/**
 * Revizyon bulutu: verilen yolu, dışa doğru kabaran r yarıçaplı yay dizisine çevirir.
 * Dönüş, ilkel `ops` biçimindedir (bir moveto + yaylar). closed ise yol kapatılır.
 * Yay uzunluğu yolun toplam uzunluğuna göre eşit bölünür, böylece köşelerde yarım yay kalmaz.
 */
export function cloudOps(pts, r, closed = true) {
  const P = pts.filter(p => p && isFinite(p[0]) && isFinite(p[1]));
  if (P.length < 2) return null;
  const z = P[0][2] || 0;
  const ring = closed ? P.concat([P[0]]) : P;
  // yol boyunca eşit aralıklı örnek noktalar
  let total = 0;
  const segLen = [];
  for (let i = 1; i < ring.length; i++) { const L = Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]); segLen.push(L); total += L; }
  if (!(total > 0)) return null;
  const R = r > 0 ? r : total / 40;
  const chord = Math.min(2 * R * 0.95, total);            // yay kirişi çapı geçemez
  const n = Math.max(closed ? 3 : 1, Math.round(total / chord));
  const step = total / n;
  const at = (s) => {                                      // yol üzerinde s uzunluğundaki nokta
    let acc = 0;
    for (let i = 0; i < segLen.length; i++) {
      if (acc + segLen[i] >= s - 1e-12) { const t = segLen[i] > 0 ? (s - acc) / segLen[i] : 0; const a = ring[i], b = ring[i + 1]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
      acc += segLen[i];
    }
    const last = ring[ring.length - 1];
    return [last[0], last[1]];
  };
  const ccwPath = closed ? polyArea(P) > 0 : true;         // dışarı yön: saat yönü tersi yolda sola değil sağa
  const ops = [];
  const first = at(0);
  ops.push([0, first[0], first[1], z]);
  for (let i = 0; i < n; i++) {
    const A = at(i * step), B = at(Math.min(total, (i + 1) * step));
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    if (!(L > 1e-12)) continue;
    const half = L / 2;
    const rr = Math.max(R, half * 1.02);
    const h = Math.sqrt(Math.max(0, rr * rr - half * half));
    // dışa doğru birim normal (kapalı yolda çokgenin dışı, açık yolda solu)
    const nx = ccwPath ? dy / L : -dy / L, ny = ccwPath ? -dx / L : dx / L;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    const cx = mx - nx * h, cy = my - ny * h;              // merkez içeride: yay dışa kabarır
    const a0 = Math.atan2(A[1] - cy, A[0] - cx), a1 = Math.atan2(B[1] - cy, B[0] - cx);
    const am = Math.atan2(my + ny * (rr - h) - cy, mx + nx * (rr - h) - cx);
    const norm = (v) => ((v % TAU) + TAU) % TAU;
    const ccw = norm(am - a0) <= norm(a1 - a0);            // tepe noktası saat yönü tersi taramada mı?
    ops.push([ccw ? 2 : -2, cx, cy, rr, a0, a1, z]);
  }
  return ops.length > 1 ? ops : null;
}

/**
 * 2B profili düşeyde h kadar süpürerek üçgen ağ gövdesi üretir (kalınlık / extrusion).
 *   prof   [[x,y,z]…] taban profili; kapalıysa son nokta ilkine eşit olabilir (atılır)
 *   h      yükseklik (eksi olabilir: aşağı süpürür)
 *   closed profil kapalı mı (yan yüzler halkayı tamamlar)
 *   cap    kapalı profilde alt ve üst yüzler doldurulsun mu
 * Dönüş: { vtx:Float32Array, idx:Uint32Array, seg:Float32Array, bb, zmin, zmax } — k=5 ilkelinin alanları.
 */
export function extrudeMesh(prof, h, closed = true, cap = true) {
  if (!prof || prof.length < 2 || !isFinite(h) || h === 0) return null;
  let ring = prof.map(p => [p[0], p[1], p[2] || 0]);
  if (closed && ring.length > 2) {
    const a = ring[0], b = ring[ring.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) ring = ring.slice(0, -1);
  }
  const N = ring.length;
  if (N < 2) return null;
  const vtx = new Float32Array(N * 2 * 3);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < N; i++) {
    const p = ring[i];
    vtx[i * 3] = p[0]; vtx[i * 3 + 1] = p[1]; vtx[i * 3 + 2] = p[2];
    const j = (N + i) * 3;
    vtx[j] = p[0]; vtx[j + 1] = p[1]; vtx[j + 2] = p[2] + h;
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2];
    if (p[2] + h < z0) z0 = p[2] + h; if (p[2] + h > z1) z1 = p[2] + h;
  }
  const tris = [];
  const last = closed ? N : N - 1;
  for (let i = 0; i < last; i++) {
    const a = i, b = (i + 1) % N, c = N + i, d = N + ((i + 1) % N);
    tris.push(a, b, d, a, d, c);
  }
  if (cap && closed && N >= 3) {
    const t = triangulate(ring.map(p => [p[0], p[1]]));
    for (const [a, b, c] of t) { tris.push(a, c, b); tris.push(N + a, N + b, N + c); }   // alt yüz aşağı, üst yüz yukarı bakar
  }
  const idx = new Uint32Array(tris);
  const seg = [];
  const push = (i, j) => { seg.push(vtx[i * 3], vtx[i * 3 + 1], vtx[i * 3 + 2], vtx[j * 3], vtx[j * 3 + 1], vtx[j * 3 + 2]); };
  for (let i = 0; i < last; i++) { push(i, (i + 1) % N); push(N + i, N + ((i + 1) % N)); }
  for (let i = 0; i < N; i++) push(i, N + i);
  return { vtx, idx, seg: new Float32Array(seg), bb: [x0, y0, x1, y1], zmin: z0, zmax: z1 };
}

/**
 * Verilen dünya noktasını içine alan EN KÜÇÜK kapalı ilkeli bulur (tarama ve dolgu alanı için).
 * Yalnız kapalı ya da dolu k=0 yolları sayılır; iç içe alanlarda en küçüğü seçilir ki
 * bir odanın içine dokunulduğunda bütün bina değil oda bulunsun.
 * Dönüş: { prim, pts, area } ya da null.
 */
/*
 * KAPALI ALAN İZİ (AutoCAD BOUNDARY / HATCH "iç nokta seç"): ayrı çizgi, yay ve polyline PARÇALARINDAN oluşan kapalı
 * alanı bulur — tek bir kapalı nesne şart değildir. Parçalar karşılıklı kesişimlerinde bölünür, düzlemsel çizge kurulur,
 * noktadan sağa atılan ışının ilk kestiği kenardan başlanıp yüzün SOL tarafı izlenir (her düğümde gelen yönün tersinden
 * saat yönünde ilk kenar); böylece noktayı içeren en küçük yüz çıkar. Çıkmaz uçlar (sarkan çizgiler) atılır. Noktaya en
 * yakın ilkellerden en çok maxSeg parça alınır; tarama dolguları ve desen çizgileri sayılmaz. → { pts (saat yönünün
 * tersi), area, prim: null } ya da null.
 */
export function traceBoundary(prims, x, y, opt = {}) {
  const MAXSEG = opt.maxSeg || 2000;
  const list = [];
  for (const p of prims) {
    if (!p || p.k !== 0 || !p.ops || !p.bb || !isFinite(p.bb[0]) || p.fill || (p.info && p.info.t === 'HATCH')) continue;
    const d = Math.max(0, p.bb[0] - x, x - p.bb[2]) + Math.max(0, p.bb[1] - y, y - p.bb[3]);
    list.push({ p, d });
  }
  list.sort((a, b) => a.d - b.d);
  const segs = []; let ext = 1;
  for (const { p } of list) {
    const pts = flatten(p.ops); const n = pts.length;
    if (n < 2) continue;
    for (let i = 1; i < n; i++) if (pts[i][0] !== pts[i - 1][0] || pts[i][1] !== pts[i - 1][1]) segs.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    if (p.closed && (pts[0][0] !== pts[n - 1][0] || pts[0][1] !== pts[n - 1][1])) segs.push([pts[n - 1][0], pts[n - 1][1], pts[0][0], pts[0][1]]);
    ext = Math.max(ext, Math.abs(p.bb[0] - x), Math.abs(p.bb[2] - x), Math.abs(p.bb[1] - y), Math.abs(p.bb[3] - y));
    if (segs.length >= MAXSEG) break;
  }
  if (segs.length < 3) return null;
  const eps = Math.max(1e-9, ext * 1e-7);
  const paramOn = (s, X) => { const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy; return L2 > 0 ? ((X[0] - s[0]) * dx + (X[1] - s[1]) * dy) / L2 : 0; };
  const cuts = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i], ax0 = Math.min(a[0], a[2]) - eps, ax1 = Math.max(a[0], a[2]) + eps, ay0 = Math.min(a[1], a[3]) - eps, ay1 = Math.max(a[1], a[3]) + eps;
    for (let j = i + 1; j < segs.length; j++) {
      const b = segs[j];
      if (Math.max(b[0], b[2]) < ax0 || Math.min(b[0], b[2]) > ax1 || Math.max(b[1], b[3]) < ay0 || Math.min(b[1], b[3]) > ay1) continue;
      const X = segIntersect(a, b); if (!X) continue;
      cuts[i].push(paramOn(a, X)); cuts[j].push(paramOn(b, X));
    }
  }
  const nodes = new Map(), pos = [], adj = [], edges = [], seen = new Set();
  const nodeOf = (px, py) => { const k = Math.round(px / eps) + ',' + Math.round(py / eps); let id = nodes.get(k); if (id == null) { id = pos.length; nodes.set(k, id); pos.push([px, py]); adj.push([]); } return id; };
  segs.forEach((sg, i) => {
    const ts = cuts[i].sort((a, b) => a - b); let prev = null;
    for (const t of ts) {
      const tt = Math.max(0, Math.min(1, t)), n = nodeOf(sg[0] + (sg[2] - sg[0]) * tt, sg[1] + (sg[3] - sg[1]) * tt);
      if (prev != null && n !== prev) { const k = Math.min(prev, n) + '-' + Math.max(prev, n); if (!seen.has(k)) { seen.add(k); const e = edges.length; edges.push([prev, n]); adj[prev].push(e); adj[n].push(e); } }
      prev = n;
    }
  });
  let best = null;
  for (let e = 0; e < edges.length; e++) {
    const [a, b] = edges[e], A = pos[a], B = pos[b];
    if ((A[1] > y) === (B[1] > y)) continue;
    const xi = A[0] + (y - A[1]) * (B[0] - A[0]) / (B[1] - A[1]);
    if (xi > x + eps && (!best || xi < best.xi)) best = { e, xi };
  }
  if (!best) return null;
  let [u, v] = edges[best.e];
  if ((pos[v][0] - pos[u][0]) * (y - pos[u][1]) - (pos[v][1] - pos[u][1]) * (x - pos[u][0]) < 0) [u, v] = [v, u];   // nokta kenarın solunda
  const start = u, startNext = v, ids = [];
  let cur = u, nxt = v, guard = edges.length * 2 + 8;
  while (guard-- > 0) {
    ids.push(cur);
    const back = Math.atan2(pos[cur][1] - pos[nxt][1], pos[cur][0] - pos[nxt][0]);   // nxt düğümünde gelen yönün tersi
    let pick = null, pickD = Infinity;
    for (const e of adj[nxt]) {
      const [a, b] = edges[e], w = a === nxt ? b : a;
      if (w === cur && adj[nxt].length > 1) continue;
      const ang = Math.atan2(pos[w][1] - pos[nxt][1], pos[w][0] - pos[nxt][0]);
      let d = ((back - ang) % TAU + TAU) % TAU; if (d < 1e-12) d = TAU;   // saat yönünde ilk kenar
      if (d < pickD) { pickD = d; pick = w; }
    }
    if (pick == null) return null;
    cur = nxt; nxt = pick;
    if (cur === start && nxt === startNext) break;
  }
  if (guard <= 0) return null;
  // sarkan uçlar (a → b → a) atılır
  let changed = true;
  while (changed && ids.length > 2) { changed = false; for (let i = 0; i < ids.length; i++) { const a = ids[(i + ids.length - 1) % ids.length], c = ids[(i + 1) % ids.length]; if (a === c) { ids.splice(i, 1); ids.splice(i % ids.length, 1); changed = true; break; } } }
  let pts = ids.map(i => pos[i]);
  // doğrusal ara düğümler (T kavşağı, kesişimle bölünmüş kenar) atılır: sınır polyline'ı yalnız gerçek köşeleri taşır
  for (let k = 0; k < pts.length && pts.length > 3; k++) {
    const a = pts[(k + pts.length - 1) % pts.length], b = pts[k], c = pts[(k + 1) % pts.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cr) / L <= eps * 10 && ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) > 0) { pts.splice(k, 1); k = -1; }
  }
  if (pts.length < 3 || !pointInPoly(pts, x, y)) return null;
  const area = Math.abs(polyArea(pts));
  if (!(area > 0)) return null;
  return { pts, area, prim: null };
}
export function enclosingPrim(prims, x, y) {
  let best = null, bestArea = Infinity;
  for (const p of prims) {
    if (!p || p.k !== 0 || !p.bb || !(p.closed || p.fill)) continue;
    if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) continue;
    const pts = flatten(p.ops);
    if (pts.length < 3) continue;
    if (!pointInPoly(pts, x, y)) continue;
    const a = Math.abs(polyArea(pts));
    if (a > 0 && a < bestArea) { bestArea = a; best = { prim: p, pts, area: a }; }
  }
  return best;
}
