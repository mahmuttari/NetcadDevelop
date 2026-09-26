/*
 * ÖLÇÜ TUTAMAKLARI (v8.9.8) — AutoCAD'in ölçü üzerindeki tutamakları.
 *
 * Kullanıcı isteği: "Ölçülendirmeden sonra ölçüyü düzenleyemiyoruz." Ölçü seçilince ne köşe tutamağı ne kutu
 * çıkıyordu; ölçü ancak özellik kutusundan değişebiliyordu. AutoCAD'de ölçü seçilince tutamakları belirir:
 * uzatma çizgisinin başlangıçları (ölçülen noktalar), ölçü çizgisinin uçları ve yazı. Buradaki modül bunların
 * YERİNİ ve SÜRÜKLENİNCE TANIMIN NE OLACAĞINI hesaplar; saftır (DOM, durum, belge yok) — gizmo.js gibi.
 *
 * Tanım (def) tools.dimDefaults biçimindedir: kind 'linear' (pts p1, p2, q · sub aligned / horizontal / vertical /
 * rotated) · 'radial' (pts merkez, işaret noktası; r · sub radius / diameter) · 'angular' (pts tepe, kol a, kol b; r).
 * geo, annot.js üreticilerinin döndürdüğü yapı geometrisidir (ölçü çizgisi uçları, yazı ortası …).
 *
 * Sürükleme anlamları (AutoCAD):
 *   doğrusal  p1 / p2  ölçülen noktayı taşır, değer yeniden ölçülür. Hizalı ölçüde ölçü çizgisinin UZAKLIĞI
 *                      korunur (çizgi yeni doğrultuya paralel kalır); yatay / düşey / dönük ölçüde ölçü çizgisi yerinde kalır
 *             d1 / d2  ölçü çizgisini paralel kaydırır (yalnız dik bileşen), değer değişmez
 *             tx       yazıyı taşır: çizgi boyunca konum yazıya (def.tp), dik bileşen ölçü çizgisine gider (DIMTMOVE=0)
 *   yarıçap   c        merkezi taşır, çevre noktası yerinde kalır → yarıçap yeniden ölçülür
 *             on       çevre noktasını taşır → yarıçap ve doğrultu
 *             tx       yazıyı taşır → okun doğrultusu yazıya döner, yarıçap aynı
 *   çap       on / on2 çapın bir ucunu taşır, öteki uç yerinde → merkez ve çap yeniden
 *   açı       v / a / b tepe ya da kol noktası · arc yayın yarıçapı ve (karşı çeyreğe geçilirse) ölçülen açı · tx yazı (yay ona gelir)
 * Her yeni nokta ölçünün düzlemine (def.pts[0] z'si) oturur. Geçersiz sonuç (sıfır uzunluk) null döner.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (v) => Math.hypot(v[0], v[1]);
const perp = (v) => [-v[1], v[0]];
const unit = (v) => { const L = len(v); return L > 1e-12 ? [v[0] / L, v[1] / L] : null; };
const cp = (p) => (Array.isArray(p) ? [p[0], p[1], p[2] || 0] : p);

/** Tanımın türüne göre tutamak kimlikleri */
export const GRIP_IDS = { linear: ['p1', 'p2', 'd1', 'd2', 'tx'], radius: ['c', 'on', 'tx'], diameter: ['on', 'on2', 'tx'], angular: ['v', 'a', 'b', 'arc', 'tx'] };
const kindOf = (def) => (def.kind === 'radial' ? (def.sub === 'diameter' ? 'diameter' : 'radius') : def.kind);

/** Tutamaklar: [{ id, x, y, z }] (dünya koordinatı). Tanım ya da geometri eksikse boş dizi */
export function gripsOf(def, geo) {
  if (!def || !geo || !Array.isArray(def.pts)) return [];
  const P = def.pts, g = [];
  const put = (id, p) => { if (p && isFinite(p[0]) && isFinite(p[1])) g.push({ id, x: p[0], y: p[1], z: p[2] || 0 }); };
  const k = kindOf(def);
  if (k === 'linear') { put('p1', P[0]); put('p2', P[1]); put('d1', geo.d1); put('d2', geo.d2); put('tx', geo.tmid); }
  else if (k === 'radius') { put('c', P[0]); put('on', geo.on); put('tx', geo.tmid); }
  else if (k === 'diameter') { put('on', geo.on); put('on2', geo.from); put('tx', geo.tmid); }
  else if (k === 'angular') { put('v', P[0]); put('a', P[1]); put('b', P[2]); put('arc', geo.arcMid); put('tx', geo.tmid); }
  return g;
}

/**
 * Sürüklenen tutamağın yeni tanımı (girdi DEĞİŞMEZ). g: tutamağın yeni dünya konumu.
 * ctx: { geo0: sürükleme başındaki geometri, g0: tutamağın ilk konumu, arms(v, a, b, p) → [pa, pb] (açının çeyreği) }
 */
export function dragDef(def, id, g, ctx = {}) {
  if (!def || !Array.isArray(def.pts) || !g || !isFinite(g[0]) || !isFinite(g[1])) return null;
  const nd = JSON.parse(JSON.stringify(def));
  const z = (def.pts[0] && def.pts[0][2]) || 0;
  const G = [g[0], g[1], z];
  const geo0 = ctx.geo0 || {}, g0 = ctx.g0 || G;
  const P = nd.pts, k = kindOf(def);
  if (k === 'linear') {
    if (P.length < 3) return null;
    if (id === 'p1' || id === 'p2') {
      const i = id === 'p1' ? 0 : 1;
      P[i] = G;
      if ((def.sub || 'aligned') === 'aligned') {
        // hizalı: ölçü çizgisinin ölçülen doğruya UZAKLIĞI (işaretiyle) korunur, çizgi yeni doğrultuya paralel olur
        const d = unit(sub(P[1], P[0])); if (!d) return null;
        const n = perp(d), off = typeof geo0.off === 'number' ? geo0.off : dot(sub(def.pts[2], def.pts[0]), perp(unit(sub(def.pts[1], def.pts[0])) || [1, 0]));
        P[2] = [P[0][0] + n[0] * off, P[0][1] + n[1] * off, z];
      }
      return nd;
    }
    const n0 = geo0.n || perp(unit(sub(def.pts[1], def.pts[0])) || [1, 0]);
    const dl = dot(sub(G, g0), n0);   // yalnız dik bileşen: ölçü çizgisi paralel kayar
    if (id === 'd1' || id === 'd2' || id === 'tx') {
      P[2] = [P[2][0] + n0[0] * dl, P[2][1] + n0[1] * dl, z];
      if (id === 'tx') nd.tp = G;                                                  // yazı parmağın altına
      else if (Array.isArray(nd.tp)) nd.tp = [nd.tp[0] + n0[0] * dl, nd.tp[1] + n0[1] * dl, z];   // taşınmış yazı çizgiyle gider
      return nd;
    }
    return null;
  }
  if (k === 'radius') {
    if (P.length < 2) return null;
    if (id === 'c') {
      const on = geo0.on || def.pts[1];
      const r = len(sub(on, G)); if (!(r > 1e-9)) return null;
      P[0] = G; P[1] = [on[0], on[1], z]; nd.r = r;
      return nd;
    }
    if (id === 'on') { const r = len(sub(G, P[0])); if (!(r > 1e-9)) return null; P[1] = G; nd.r = r; return nd; }
    if (id === 'tx') { if (!(len(sub(G, P[0])) > 1e-9)) return null; P[1] = G; return nd; }   // ok yazıya döner
    return null;
  }
  if (k === 'diameter') {
    if (P.length < 2) return null;
    const on = geo0.on, from = geo0.from;
    if (id === 'on' || id === 'on2') {
      const sabit = id === 'on' ? from : on; if (!sabit) return null;
      const r = len(sub(G, sabit)) / 2; if (!(r > 1e-9)) return null;
      const c = [(G[0] + sabit[0]) / 2, (G[1] + sabit[1]) / 2, z];
      P[0] = c; P[1] = id === 'on' ? G : [sabit[0], sabit[1], z]; nd.r = r;
      return nd;
    }
    if (id === 'tx') { if (!(len(sub(G, P[0])) > 1e-9)) return null; P[1] = G; return nd; }
    return null;
  }
  if (k === 'angular') {
    if (P.length < 3) return null;
    const i = { v: 0, a: 1, b: 2 }[id];
    if (i != null) { P[i] = G; if (len(sub(P[1], P[0])) < 1e-9 || len(sub(P[2], P[0])) < 1e-9) return null; return nd; }
    if (id === 'arc' || id === 'tx') {
      const v = P[0];
      const h = (def.h > 0 ? def.h : 2.5) * (def.scale > 0 ? def.scale : 1);
      const r = len(sub(G, v)) - (id === 'tx' ? h * 0.8 : 0);                        // yazı yayın h × 0,8 dışında durur
      if (!(r > 1e-9)) return null;
      nd.r = r;
      if (typeof ctx.arms === 'function') { const [pa, pb] = ctx.arms(v, P[1], P[2], G); P[1] = cp(pa); P[2] = cp(pb); P[1][2] = z; P[2][2] = z; }
      return nd;
    }
    return null;
  }
  return null;
}

/** Yeniden kurulan ölçü geçerli mi (ölçülen değer sonlu ve sıfırdan büyük) */
export function validBuilt(def, built) {
  if (!built || !Array.isArray(built.ents) || !built.ents.length) return false;
  const m = built.measure;
  return typeof m === 'number' && isFinite(m) && m > (def && def.kind === 'angular' ? 1e-6 : 1e-9);
}

/** İki tanım aynı mı (noktalar ve yazı konumu eps içinde) — hiç kıpırdamayan sürükleme işlenmesin */
export function sameDef(a, b, eps = 1e-9) {
  if (!a || !b) return false;
  const P = (x) => (Array.isArray(x) ? x : []);
  const eq = (p, q) => (!p && !q) || (p && q && Math.abs(p[0] - q[0]) <= eps && Math.abs(p[1] - q[1]) <= eps);
  if (P(a.pts).length !== P(b.pts).length) return false;
  for (let i = 0; i < P(a.pts).length; i++) if (!eq(a.pts[i], b.pts[i])) return false;
  if (!eq(a.tp, b.tp)) return false;
  return Math.abs((a.r || 0) - (b.r || 0)) <= eps;
}

/** Ekran yerleşimi: tutamak ekran konumları, çizim yarıçapı ve dokunma yarıçapı */
export function layoutGrips(grips, toScreen, o = {}) {
  const fs = o.fs || 1, glove = !!o.glove;
  const pts = grips.map(g => { const s = toScreen(g.x, g.y); return [s[0], s[1]]; });
  return { grips, pts, r: Math.round((glove ? 9 : 7) * fs), hitR: Math.round((glove ? 26 : 22) * fs) };
}

/** Dokunulan tutamak: en yakın, dokunma yarıçapı içinde; eşitlikte yazı > ölçü çizgisi > nokta. Yoksa -1 */
export function hitGrip(sx, sy, GL) {
  if (!GL || !GL.pts) return -1;
  const pri = (id) => (id === 'tx' ? 0 : id === 'd1' || id === 'd2' || id === 'arc' ? 1 : 2);
  let best = -1, bd = Infinity;
  GL.pts.forEach((p, i) => {
    const d = Math.hypot(sx - p[0], sy - p[1]);
    if (d > GL.hitR) return;
    const score = d + pri(GL.grips[i].id) * 0.5;
    if (score < bd) { bd = score; best = i; }
  });
  return best;
}

/** Tutamakları çizer: AutoCAD mavisi dolu kareler, sürüklenen tutamak kırmızı */
export function drawGrips(c, GL, col = {}, o = {}) {
  if (!GL) return;
  const r = GL.r, act = o.active != null ? o.active : -1;
  c.save(); c.setLineDash([]); c.lineWidth = 1.5;
  GL.pts.forEach((p, i) => {
    c.fillStyle = i === act ? (col.hot || '#ff4d4d') : (col.grip || '#4da3ff');
    c.strokeStyle = col.edge || '#0b1020';
    c.beginPath(); c.rect(p[0] - r, p[1] - r, 2 * r, 2 * r); c.fill(); c.stroke();
  });
  c.restore();
}
