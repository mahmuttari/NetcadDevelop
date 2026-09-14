/*
 * Açıklama ve ölçülendirme üreticileri.
 *
 * Buradaki her işlev SAF'tır: girdi noktalar ve seçenekler, çıktı `ent` dizisi (edit.js'in
 * varlık tanımı). Hiçbiri sahneye dokunmaz, hiçbiri kimlik üretmez — kimliği (id) ve katmanı
 * çağıran verir, çünkü hepsi tek bir `add` komutuyla eklenir ve tek geri almayla kalkar.
 *
 * Ortak seçenekler (o):
 *   h      yazı yüksekliği (çizim birimi)
 *   arrow  ok boyu (verilmezse h)
 *   layer  katman adı        color  ACI (256 = katmandan)
 *   gid    grup kimliği — aynı ölçülendirmenin bütün parçaları bunu taşır, birlikte seçilir
 *   label  ölçü metni (biçimlemeyi çağıran yapar: birim, ondalık, ölçek)
 *
 * Ölçülendirme gerçek DXF DIMENSION varlığı DEĞİL, çizilmiş geometridir (uzatma çizgileri,
 * ölçü çizgisi, ok başları, yazı). Bu bilinçli bir karardır: iç modelimizde ölçü stili yok,
 * geometri her okuyucuda birebir aynı görünür ve DXF'e sorunsuz yazılır. Parçalar `itype`
 * ile DIMENSION damgası taşıdığı için "Ölçüleri gizle" süzgeci onları da gizler.
 */
import { TAU } from './geom.js';

const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => { const L = len(v) || 1; return [v[0] / L, v[1] / L]; };
const add = (a, v, s = 1) => [a[0] + v[0] * s, a[1] + v[1] * s, a[2] || 0];
const perp = (v) => [-v[1], v[0]];

/** Ortak alanları basar; id'yi çağıran ekler */
const stamp = (ent, o) => ({ ...ent, layer: o.layer, color: o.color == null ? 256 : o.color, itype: o.itype || 'DIMENSION', gid: o.gid });

/** Ok başı: uç noktası tip, gövde yönü dir (uçtan geriye), boy a → dolu üçgen */
export function arrowEnt(tip, dir, a, o) {
  const d = unit(dir), n = perp(d);
  const b = add(tip, d, a), w = a * 0.18;
  return stamp({ type: 'SOLID', pts: [[tip[0], tip[1], tip[2] || 0], [b[0] + n[0] * w, b[1] + n[1] * w, tip[2] || 0], [b[0] - n[0] * w, b[1] - n[1] * w, tip[2] || 0]] }, o);
}

/**
 * Doğrusal ölçülendirme.
 *   kind 'aligned' ölçü çizgisi p1→p2 ile paralel · 'horizontal' yatay · 'vertical' düşey
 *   q    ölçü çizgisinin geçtiği nokta (kullanıcının seçtiği üçüncü nokta)
 * Dönüş: [DIMENSION (çizgiler), SOLID ok, SOLID ok, TEXT] — hepsi aynı gid.
 * measure alanı ölçülen uzunluğu (çizim birimi) taşır; çağıran metni buna göre biçimler.
 */
export function dimLinear(kind, p1, p2, q, o) {
  const h = o.h > 0 ? o.h : 2.5, a = o.arrow > 0 ? o.arrow : h;
  let dir;
  if (kind === 'horizontal') dir = [1, 0];
  else if (kind === 'vertical') dir = [0, 1];
  else { const v = sub(p2, p1); if (len(v) < 1e-12) return null; dir = unit(v); }
  const n = perp(dir);
  const off = (q[0] - p1[0]) * n[0] + (q[1] - p1[1]) * n[1];      // ölçü çizgisinin öteleme miktarı
  const t1 = (p1[0] - p1[0]) * dir[0] + (p1[1] - p1[1]) * dir[1];
  const t2 = (p2[0] - p1[0]) * dir[0] + (p2[1] - p1[1]) * dir[1];
  const measure = Math.abs(t2 - t1);
  if (!(measure > 1e-12)) return null;
  const base = [p1[0] + n[0] * off, p1[1] + n[1] * off];
  const d1 = [base[0] + dir[0] * t1, base[1] + dir[1] * t1, p1[2] || 0];
  const d2 = [base[0] + dir[0] * t2, base[1] + dir[1] * t2, p1[2] || 0];
  const gap = h * 0.25, ext = h * 0.5;                             // ölçü noktasıyla uzatma çizgisi arası boşluk ve taşma
  const e1a = add(p1, n, Math.sign(off || 1) * gap), e1b = add(d1, n, Math.sign(off || 1) * ext);
  const e2a = add(p2, n, Math.sign(off || 1) * gap), e2b = add(d2, n, Math.sign(off || 1) * ext);
  const segs = [[e1a, e1b], [e2a, e2b], [d1, d2]];
  const inward = t2 > t1 ? dir : [-dir[0], -dir[1]];
  const ents = [
    stamp({ type: 'DIMENSION', segs, measure }, o),
    arrowEnt(d1, inward, a, o),
    arrowEnt(d2, [-inward[0], -inward[1]], a, o),
  ];
  const mid = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2, d1[2]];
  let rot = Math.atan2(dir[1], dir[0]);
  if (rot > Math.PI / 2 + 1e-9 || rot < -Math.PI / 2 - 1e-9) rot += Math.PI;   // yazı hiçbir zaman baş aşağı durmaz
  const tp = add(mid, perp([Math.cos(rot), Math.sin(rot)]), h * 0.35);
  ents.push(stamp({ type: 'TEXT', pts: [[tp[0], tp[1], mid[2]]], text: o.label == null ? '' : String(o.label), h, rot, ha: 1, va: 0 }, o));
  return { ents, measure };
}

/** Yarıçap ya da çap ölçülendirmesi: merkezden çember üzerindeki noktaya lider + yazı */
export function dimRadial(kind, center, r, at, o) {
  const h = o.h > 0 ? o.h : 2.5, a = o.arrow > 0 ? o.arrow : h;
  if (!(r > 0)) return null;
  const dir = unit(sub(at, center));
  const on = [center[0] + dir[0] * r, center[1] + dir[1] * r, center[2] || 0];
  const measure = kind === 'diameter' ? 2 * r : r;
  const from = kind === 'diameter'
    ? [center[0] - dir[0] * r, center[1] - dir[1] * r, center[2] || 0]
    : [center[0], center[1], center[2] || 0];
  const tail = [on[0] + dir[0] * h * 2, on[1] + dir[1] * h * 2, on[2]];
  const ents = [
    stamp({ type: 'DIMENSION', segs: [[from, on], [on, tail]], measure }, o),
    arrowEnt(on, [-dir[0], -dir[1]], a, o),
  ];
  if (kind === 'diameter') ents.push(arrowEnt(from, dir, a, o));
  const right = dir[0] >= 0;
  const tp = [tail[0] + (right ? h * 0.4 : -h * 0.4), tail[1] + h * 0.35, tail[2]];
  ents.push(stamp({ type: 'TEXT', pts: [tp], text: o.label == null ? '' : String(o.label), h, rot: 0, ha: right ? 0 : 2, va: 0 }, o));
  return { ents, measure };
}

/** Açı ölçülendirmesi: tepe v, kollar a ve b; yay yarıçapı r (verilmezse kısa kolun %70'i) */
export function dimAngular(v, a, b, o) {
  const h = o.h > 0 ? o.h : 2.5, ar = o.arrow > 0 ? o.arrow : h;
  const u1 = sub(a, v), u2 = sub(b, v);
  const L1 = len(u1), L2 = len(u2);
  if (!(L1 > 1e-12) || !(L2 > 1e-12)) return null;
  const d1 = unit(u1), d2 = unit(u2);
  const r = o.r > 0 ? o.r : Math.min(L1, L2) * 0.7;
  let a0 = Math.atan2(d1[1], d1[0]), a1 = Math.atan2(d2[1], d2[0]);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += TAU;
  while (sweep > Math.PI) sweep -= TAU;
  const measure = Math.abs(sweep) / D2R;
  const z = v[2] || 0;
  const p0 = [v[0] + d1[0] * r, v[1] + d1[1] * r, z];
  const p1 = [v[0] + d2[0] * r, v[1] + d2[1] * r, z];
  // yay, ops biçiminde tek parça olarak DIMENSION varlığına verilir
  const ccw = sweep > 0;
  const arcOp = [ccw ? 2 : -2, v[0], v[1], r, ccw ? a0 : a1, ccw ? a1 : a0, z];
  const arm = (d) => [[v[0], v[1], z], [v[0] + d[0] * (r + h * 0.5), v[1] + d[1] * (r + h * 0.5), z]];
  const segs = [arm(d1), arm(d2)];
  const tang1 = perp(d1), tang2 = perp(d2);
  const ents = [
    stamp({ type: 'DIMENSION', segs, arcs: [arcOp], measure }, o),
    arrowEnt(p0, ccw ? [-tang1[0], -tang1[1]] : tang1, ar, o),
    arrowEnt(p1, ccw ? tang2 : [-tang2[0], -tang2[1]], ar, o),
  ];
  const am = a0 + sweep / 2;
  const tp = [v[0] + Math.cos(am) * (r + h * 0.8), v[1] + Math.sin(am) * (r + h * 0.8), z];
  ents.push(stamp({ type: 'TEXT', pts: [tp], text: o.label == null ? '' : String(o.label), h, rot: 0, ha: 1, va: 0 }, o));
  return { ents, measure };
}

/** Lider (kılavuz çizgili açıklama): pts yol, son noktadan sonra yazı; ilk noktada ok */
export function leaderEnts(pts, text, o) {
  const h = o.h > 0 ? o.h : 2.5, a = o.arrow > 0 ? o.arrow : h;
  if (!pts || pts.length < 2) return null;
  const z = pts[0][2] || 0;
  const tip = pts[0], nxt = pts[1];
  const dir = unit(sub(nxt, tip));
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const right = end[0] >= prev[0];
  const shelf = [end[0] + (right ? h * 1.2 : -h * 1.2), end[1], z];
  const segs = [pts.map(p => [p[0], p[1], p[2] || 0]).concat([shelf])];
  const oo = { ...o, itype: o.itype || 'LEADER' };
  const ents = [stamp({ type: 'DIMENSION', segs }, oo), arrowEnt(tip, dir, a, oo)];
  const tp = [shelf[0] + (right ? h * 0.3 : -h * 0.3), shelf[1] + h * 0.35, z];
  ents.push(stamp({ type: 'TEXT', pts: [tp], text: String(text == null ? '' : text), h, rot: 0, ha: right ? 0 : 2, va: 0 }, oo));
  return { ents };
}

/** Revizyon bulutu: kapalı yol üzerinde dışa kabaran yaylar */
export function cloudEnt(pts, r, o) {
  if (!pts || pts.length < 2) return null;
  return [stamp({ type: 'CLOUD', pts: pts.map(p => [p[0], p[1], p[2] || 0]), r, closed: o.closed !== false }, { ...o, itype: o.itype || 'CLOUD' })];
}

/** Numaralandırma balonu: daire + ortalanmış yazı */
export function balloonEnts(center, text, o) {
  const h = o.h > 0 ? o.h : 2.5;
  const s = String(text == null ? '' : text);
  const r = o.r > 0 ? o.r : h * (0.9 + 0.32 * Math.max(0, s.length - 1));
  const z = center[2] || 0;
  const oo = { ...o, itype: o.itype || 'BALLOON' };
  return [
    stamp({ type: 'CIRCLE', pts: [[center[0], center[1], z]], r }, oo),
    stamp({ type: 'TEXT', pts: [[center[0], center[1] - h * 0.5, z]], text: s, h, rot: 0, ha: 1, va: 0 }, oo),
  ];
}

/**
 * Dizi (artımlı kopya) dönüşümleri.
 *   kind 'rect'  → nx × ny, dx / dy aralıklı dikdörtgen dizi
 *   kind 'polar' → merkez c çevresinde n kopya, toplam açı total (derece), rotate ise kopyalar döner
 * Dönüş: [{m:[a,b,c,d,e,f], dz}] — ilk kopya (0,0) atlanır, yalnız YENİ kopyalar döner.
 */
export function arrayItems(kind, prm) {
  const out = [];
  if (kind === 'polar') {
    const n = Math.max(2, Math.round(prm.n || 2));
    const total = (prm.total == null ? 360 : prm.total) * D2R;
    const full = Math.abs(Math.abs(total) - TAU) < 1e-9;
    const step = total / (full ? n : Math.max(1, n - 1));
    const c = prm.center || [0, 0];
    for (let i = 1; i < n; i++) {
      const A = step * i, cs = Math.cos(A), sn = Math.sin(A);
      if (prm.rotate === false) {
        // nesne dönmez, yalnız taban noktası merkez çevresinde döner: fark kadar ötelenir
        const b = prm.base || c;
        const nx = c[0] + (b[0] - c[0]) * cs - (b[1] - c[1]) * sn;
        const ny = c[1] + (b[0] - c[0]) * sn + (b[1] - c[1]) * cs;
        out.push({ m: [1, 0, 0, 1, nx - b[0], ny - b[1]], dz: (prm.dz || 0) * i });
      } else {
        out.push({ m: [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]], dz: (prm.dz || 0) * i });
      }
    }
    return out;
  }
  const nx = Math.max(1, Math.round(prm.nx || 1)), ny = Math.max(1, Math.round(prm.ny || 1));
  const dx = prm.dx || 0, dy = prm.dy || 0, dz = prm.dz || 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i === 0 && j === 0) continue;
    out.push({ m: [1, 0, 0, 1, dx * i, dy * j], dz: dz * (i + j) });
  }
  return out;
}
