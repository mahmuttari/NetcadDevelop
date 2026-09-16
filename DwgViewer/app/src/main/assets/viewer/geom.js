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
    if (p.k === 5) {                                 // ağ ilkeli: kenar dizisi doğrudan taranır (segmentsOf'a kopyalanmaz)
      const g = p.seg;
      if (!g || !g.length || g.length > 1200000) continue;
      for (let i = 0; i + 5 < g.length; i += 6) {
        const x1 = g[i], y1 = g[i + 1], z1 = g[i + 2], x2 = g[i + 3], y2 = g[i + 4], z2 = g[i + 5];
        if ((x1 < x2 ? x1 : x2) - tol > w[0] || (x1 > x2 ? x1 : x2) + tol < w[0]) continue;   // tolerans penceresi (kayıpsız eleme)
        if ((y1 < y2 ? y1 : y2) - tol > w[1] || (y1 > y2 ? y1 : y2) + tol < w[1]) continue;
        if (modes.has('end')) { test(x1, y1, 'end', z1); test(x2, y2, 'end', z2); }
        if (modes.has('mid')) test((x1 + x2) / 2, (y1 + y2) / 2, 'mid', (z1 + z2) / 2);
        if (modes.has('per') && prev) { const f = segFoot(prev[0], prev[1], x1, y1, x2, y2); if (f) test(f[0], f[1], 'per'); }
        if (modes.has('nea')) { const f = segFoot(w[0], w[1], x1, y1, x2, y2); if (f) test(f[0], f[1], 'nea'); }
        if (modes.has('int') && allSegs.length < 400) allSegs.push([x1, y1, x2, y2, z1, z2]);
      }
      continue;
    }
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
