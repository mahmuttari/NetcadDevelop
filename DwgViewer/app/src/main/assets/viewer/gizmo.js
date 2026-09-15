/**
 * gizmo.js — seçim tutamağı (taşı · ölçekle · uzat/kısalt · döndür)
 *
 * Seçim yapıldığında çizimin üstünde kesikli bir çerçeve ve tutamaklar belirir; kullanıcı ayrı
 * bir araç seçmeden nesneyi doğrudan sürükleyebilir. Rakip uygulamalardaki "seçim kutusu"nun
 * karşılığıdır.
 *
 * TUTAMAKLAR
 *   köşe (4)  → ölçekle: oran korunur, karşı köşe sabit kalır
 *   kenar (4) → uzat / kısalt: tek eksende ölçek, karşı kenar sabit kalır
 *   orta      → taşı
 *   ip ucu    → döndür: kutu merkezi etrafında, 15°'ye yakınsa kilitlenir
 *
 * TASARIM KURALLARI
 *  - Bu modül SAF'tır: DOM'a, S durumuna ve çizim belgesine dokunmaz. Ekran dönüşümünü
 *    (toScreen / toWorld) ve ölçüleri çağıran verir; karşılığında yerleşim, isabet ve matris
 *    döner. Böylece sınanması kolaydır ve editor.js şişmez.
 *  - Sürükleme sırasında BELGE DEĞİŞMEZ: yalnız bir önizleme matrisi üretilir. Değişiklik
 *    bırakışta tek bir 'xform' komutu olarak işlenir → tek geri alma adımı.
 *  - Matris düzeni edit.js / geom.js ile aynı: m = [a, b, c, d, e, f],
 *    x' = a·x + c·y + e   ve   y' = b·x + d·y + f.
 *  - Ekran y ekseni dünyanınkinin tersidir; bütün hesap DÜNYA koordinatında yapılır, yalnız
 *    yerleşim ve isabet ekranda olur.
 */

/** Kimlikler: köşeler saat yönünde (ekranda sol üstten), kenarlar üst/sağ/alt/sol */
export const CORNERS = ['nw', 'ne', 'se', 'sw'];
export const EDGES = ['n', 'e', 's', 'w'];
export const KINDS = [...CORNERS, ...EDGES, 'move', 'rot'];
/** Hangi tutamak hangi yetkiyi ister (editor.js gate() için) */
export const NEED_OF = { move: 't:move', rot: 't:rotate', nw: 't:scale', ne: 't:scale', se: 't:scale', sw: 't:scale', n: 't:scale', e: 't:scale', s: 't:scale', w: 't:scale' };

const EPS = 1e-12;
/** Dünya sınır kutusu: [x0, y0, x1, y1]; boş seçimde null */
export function boxOf(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of prims) {
    const b = p && p.bb;
    if (!b || !isFinite(b[0])) continue;
    if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1];
    if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3];
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}

/**
 * Ekran yerleşimi. bb dünya kutusu, ts(x, y) → [sx, sy].
 * opts: { fs (yazı ölçeği), glove (eldiven kipi), W, H }
 * Dönen kutu köşeleri EKRAN sırasıyladır: nw, ne, se, sw.
 */
export function layout(bb, ts, opts = {}) {
  if (!bb) return null;
  const fs = opts.fs || 1, glove = !!opts.glove;
  const a = ts(bb[0], bb[1]), b = ts(bb[2], bb[3]);
  const grip = Math.round((glove ? 13 : 11) * fs);          // karenin yarı kenarı
  const hitR = Math.round((glove ? 26 : 22) * fs);          // dokunma yarıçapı (44+ px hedef)
  let x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  let y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // EN AZ BİR KUTU: yatay ya da düşey tek çizgi seçildiğinde kutunun bir kenarı sıfırdır ve
  // tutamaklar üst üste biner. Kutu yalnız ÇİZİM için açılır; ölçek hesabı gerçek dünya
  // kutusunu kullanır, bu yüzden dönüşüm bozulmaz.
  const minH = grip * 1.6;
  if (x1 - x0 < minH * 2) { x0 = cx - minH; x1 = cx + minH; }
  if (y1 - y0 < minH * 2) { y0 = cy - minH; y1 = cy + minH; }
  // İp kutunun dışında kalmalı ve sağ kenar tutamağına yapışmamalı
  const leash = Math.max((x1 - x0) / 2 + grip * 5, 96 * fs);
  return {
    box: [x0, y0, x1, y1], cx, cy, grip, hitR,
    pts: {
      nw: [x0, y0], ne: [x1, y0], se: [x1, y1], sw: [x0, y1],
      n: [cx, y0], e: [x1, cy], s: [cx, y1], w: [x0, cy],
      move: [cx, cy], rot: [cx + leash, cy],
    },
    leash: [[cx, cy], [cx + leash, cy]],
    /** kutu ekranda bu kadar küçükse kenar tutamakları çizilmez (üst üste biner) */
    tiny: (x1 - x0) < hitR * 2.4 || (y1 - y0) < hitR * 2.4,
  };
}

/** Ekran noktası hangi tutamağın üstünde? Öncelik: döndür > taşı > köşe > kenar. */
export function hit(sx, sy, L) {
  if (!L) return null;
  const near = (p, r) => Math.hypot(sx - p[0], sy - p[1]) <= r;
  if (near(L.pts.rot, L.hitR)) return 'rot';
  if (near(L.pts.move, L.hitR)) return 'move';
  for (const k of CORNERS) if (near(L.pts[k], L.hitR)) return k;
  if (!L.tiny) for (const k of EDGES) if (near(L.pts[k], L.hitR)) return k;
  return null;
}

/** Dünya kutusunun köşesi / kenar ortası (kimliğe göre) */
const worldPt = (bb, k) => {
  const [x0, y0, x1, y1] = bb, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return { nw: [x0, y1], ne: [x1, y1], se: [x1, y0], sw: [x0, y0], n: [mx, y1], e: [x1, my], s: [mx, y0], w: [x0, my], move: [mx, my], rot: [mx, my] }[k];
};
/** Sürükleme sırasında sabit kalan nokta: karşı köşe / karşı kenar / merkez */
export const anchorOf = (bb, k) => worldPt(bb, { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne', n: 's', e: 'w', s: 'n', w: 'e', move: 'move', rot: 'rot' }[k]);

export const translateM = (dx, dy) => [1, 0, 0, 1, dx, dy];
export const scaleM = (ax, ay, sx, sy) => [sx, 0, 0, sy, ax - sx * ax, ay - sy * ay];
export const rotateM = (cx, cy, a) => { const cs = Math.cos(a), sn = Math.sin(a); return [cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy]; };

/** En küçük ölçek: yanlışlıkla aynalamayı ve sıfıra çökmeyi önler (aynalama için ayrı araç var) */
export const MIN_SCALE = 0.02;
/** Döndürmede bu açıya (derece) bu kadar yakınsa kilitlenir */
export const SNAP_DEG = 15, SNAP_TOL_DEG = 3;

/**
 * Sürüklemenin matrisini ve okunur bilgisini üretir.
 * kind: tutamak · bb: sürükleme BAŞINDAKİ dünya kutusu · w0: basma noktası (dünya) · w: şimdiki nokta (dünya)
 * Dönen: { m, kind, info: { tip: 'move'|'scale'|'rot', … } } — bilgi editor.js'te biçimlenir.
 */
export function drag(kind, bb, w0, w) {
  const [x0, y0, x1, y1] = bb;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (kind === 'move') {
    const dx = w[0] - w0[0], dy = w[1] - w0[1];
    return { m: translateM(dx, dy), info: { tip: 'move', dx, dy } };
  }
  if (kind === 'rot') {
    const a0 = Math.atan2(w0[1] - cy, w0[0] - cx), a1 = Math.atan2(w[1] - cy, w[0] - cx);
    let a = a1 - a0;
    const deg = a * 180 / Math.PI;
    const snapped = Math.round(deg / SNAP_DEG) * SNAP_DEG;
    const snap = Math.abs(deg - snapped) <= SNAP_TOL_DEG;
    if (snap) a = snapped * Math.PI / 180;
    return { m: rotateM(cx, cy, a), info: { tip: 'rot', deg: a * 180 / Math.PI, snap } };
  }
  const [ax, ay] = anchorOf(bb, kind);
  const g0 = worldPt(bb, kind);
  if (CORNERS.includes(kind)) {
    // Köşe: oran korunur. Ölçek, imlecin köşegen üzerindeki izdüşümünden bulunur — kenara paralel
    // sürüklemede sıçrama olmaz ve serbest el hareketi düzgün bir orana oturur.
    const vx = g0[0] - ax, vy = g0[1] - ay;
    const den = vx * vx + vy * vy;
    if (den < EPS) return { m: translateM(0, 0), info: { tip: 'scale', sx: 1, sy: 1 } };
    const s = Math.max(MIN_SCALE, ((w[0] - ax) * vx + (w[1] - ay) * vy) / den);
    return { m: scaleM(ax, ay, s, s), info: { tip: 'scale', sx: s, sy: s, uniform: true } };
  }
  // Kenar: tek eksende uzat / kısalt; öteki eksen 1 kalır
  let sx = 1, sy = 1;
  if (kind === 'e' || kind === 'w') { const d = g0[0] - ax; sx = Math.abs(d) < EPS ? 1 : Math.max(MIN_SCALE, (w[0] - ax) / d); }
  else { const d = g0[1] - ay; sy = Math.abs(d) < EPS ? 1 : Math.max(MIN_SCALE, (w[1] - ay) / d); }
  return { m: scaleM(ax, ay, sx, sy), info: { tip: 'scale', sx, sy, uniform: false } };
}

/**
 * Dünya matrisini YEREL kökene taşır. Kaplama, büyük UTM sayıları tuvale girmesin diye
 * (world - origin) koordinatında çizer; dünya matrisi oraya doğrudan uygulanamaz.
 *   yerel = dünya - o  →  yerel' = A·yerel + (A·o + t - o)
 */
export const localM = (m, ox, oy) => [m[0], m[1], m[2], m[3],
  m[0] * ox + m[2] * oy + m[4] - ox,
  m[1] * ox + m[3] * oy + m[5] - oy];

/** Matris birim mi? (kıpırdamayan sürükleme belgeye yazılmaz) */
export const isIdentity = (m) => !m || (Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9);

/**
 * Tutamakları çizer. c ekran (dpr) dönüşümünde olmalı.
 * col: { line, fill, ink } — çizgi rengi, tutamak dolgusu, simge rengi.
 * m verilirse kutu o matrisle dönüştürülmüş gösterilir (sürükleme önizlemesi).
 */
export function draw(c, L, col, opts = {}) {
  if (!L) return;
  const { grip } = L;
  const line = col.line || '#ff9f0a', fill = col.fill || '#101820', ink = col.ink || line;
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  // --- kesikli çerçeve
  c.strokeStyle = line; c.lineWidth = Math.max(1.5, 2 * (opts.fs || 1));
  c.setLineDash([7, 5]);
  c.strokeRect(L.box[0], L.box[1], L.box[2] - L.box[0], L.box[3] - L.box[1]);
  // --- döndürme ipi
  c.beginPath(); c.moveTo(L.leash[0][0], L.leash[0][1]); c.lineTo(L.leash[1][0], L.leash[1][1]); c.stroke();
  c.setLineDash([]);
  const square = (p) => { c.beginPath(); c.rect(p[0] - grip, p[1] - grip, grip * 2, grip * 2); c.fill(); c.stroke(); };
  const circle = (p, r) => { c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.fill(); c.stroke(); };
  c.fillStyle = fill; c.strokeStyle = line; c.lineWidth = Math.max(2, 2.5 * (opts.fs || 1));
  for (const k of CORNERS) square(L.pts[k]);
  if (!L.tiny) for (const k of EDGES) square(L.pts[k]);
  circle(L.pts.move, grip * 1.15);
  circle(L.pts.rot, grip * 1.15);
  // --- simgeler: taşı = dört yönlü ok, döndür = dönen ok
  c.strokeStyle = ink; c.lineWidth = Math.max(1.6, 2 * (opts.fs || 1)); c.fillStyle = ink;
  drawMoveIcon(c, L.pts.move, grip * 0.78);
  drawRotIcon(c, L.pts.rot, grip * 0.72);
  // --- kenar tutamaklarına yön çizgisi (uzat/kısalt olduğu anlaşılsın)
  if (!L.tiny) {
    c.strokeStyle = ink; c.lineWidth = Math.max(1.4, 1.8 * (opts.fs || 1));
    const bar = grip * 0.5;
    for (const k of EDGES) {
      const p = L.pts[k], v = (k === 'n' || k === 's');
      c.beginPath();
      if (v) { c.moveTo(p[0] - bar, p[1]); c.lineTo(p[0] + bar, p[1]); }
      else { c.moveTo(p[0], p[1] - bar); c.lineTo(p[0], p[1] + bar); }
      c.stroke();
    }
  }
  c.restore();
}

function drawMoveIcon(c, p, r) {
  const [x, y] = p, h = r * 0.42;
  c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); c.stroke();
  const tip = (dx, dy) => { c.beginPath(); c.moveTo(x + dx * r, y + dy * r); c.lineTo(x + dx * (r - h) - dy * h * 0.8, y + dy * (r - h) - dx * h * 0.8); c.lineTo(x + dx * (r - h) + dy * h * 0.8, y + dy * (r - h) + dx * h * 0.8); c.closePath(); c.fill(); };
  tip(1, 0); tip(-1, 0); tip(0, 1); tip(0, -1);
}
function drawRotIcon(c, p, r) {
  const [x, y] = p;
  c.beginPath(); c.arc(x, y, r, Math.PI * 0.35, Math.PI * 1.75); c.stroke();
  const a = Math.PI * 0.35, ex = x + Math.cos(a) * r, ey = y + Math.sin(a) * r, h = r * 0.55;
  c.beginPath(); c.moveTo(ex + h * 0.6, ey - h * 0.2); c.lineTo(ex - h * 0.5, ey - h * 0.55); c.lineTo(ex - h * 0.1, ey + h * 0.6); c.closePath(); c.fill();
}
