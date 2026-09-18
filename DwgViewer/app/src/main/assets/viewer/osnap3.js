/*
 * osnap3.js — ÜÇ BOYUTLU NESNE YAKALAMA (3D object snap).
 *
 * NE İŞE YARAR
 *   3B görünümde bir noktaya dokunulduğunda, dokunulan yere en yakın ANLAMLI geometrik noktayı
 *   bulur: bir parçanın ucu, ortası, bir yayın merkezi, seçili bir doğrultuya dik ayak ya da
 *   bir parça üzerindeki en yakın nokta. 2B'deki osnap.js'in üç boyutlu karşılığıdır ve aynı
 *   kip adlarını (END, MID, CEN, PER, NEA) kullanır; işaretleri de aynı çiziciden gelir.
 *
 * NEDEN AYRI BİR MODÜL
 *   2B yakalama ekran düzleminde ve RTree ile çalışır; burada aday nokta ÜÇ BOYUTLUDUR ve
 *   yakınlık EKRANDA ölçülür (kullanıcı parmağını ekrana basar, dünyaya değil). Bu yüzden
 *   modül bir "izdüşüm" işlevi alır: (x, y, z) → [ekranX, ekranY, derinlik] ya da görünmüyorsa
 *   null. Böylece modül saf kalır: kamera, WebGL ve DOM bilmez, yalnız geometri ve aritmetik.
 *
 * KURALLAR
 *  - SAF: durum tutmaz, sahneye dokunmaz, girdiyi değiştirmez.
 *  - Öncelik 2B ile aynıdır: END > MID > CEN > PER > NEA. Aynı uzaklıkta önce gelen kazanır;
 *    eşitlik payı, kipin önceliğine göre küçük bir ceza eklenerek çözülür (osnap.js'teki PRI).
 *  - Bütçe: çok büyük çizimlerde her dokunuşta yüz binlerce nokta taranmaz; işlem sayısı
 *    maxWork ile sınırlanır ve sınıra gelince tarama durur (bulunan en iyi aday döner).
 */

/** Kip listesi: kimlik, kısaltma, öncelik (küçük olan üstündür) */
export const MODES3 = [
  { id: 'end', abbr: 'END', pri: 0 },
  { id: 'mid', abbr: 'MID', pri: 1 },
  { id: 'cen', abbr: 'CEN', pri: 2 },
  { id: 'per', abbr: 'PER', pri: 3 },
  { id: 'nea', abbr: 'NEA', pri: 4 },
];
export const DEFAULT_MODES3 = ['end', 'mid', 'cen'];
const PRI = {}; for (const m of MODES3) PRI[m.id] = m.pri;

const say = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/**
 * İlkelin işlemlerinden (ops) ÜÇ BOYUTLU parça listesi üretir.
 * Yay ve elips işlemleri düzleştirilmiş noktalarla gelir (sahne de öyle çizer); merkez ayrıca
 * döndürülür ki CEN yakalaması yayın merkezini bulabilsin.
 * Dönüş: { segs: [[ax,ay,az,bx,by,bz]…], cens: [[x,y,z]…] }
 */
export function primGeom3(p) {
  const segs = [], cens = [];
  if (!p || p.k !== 0 || !Array.isArray(p.ops)) return { segs, cens };
  let cur = null;
  for (const o of p.ops) {
    const kod = o[0];
    if (kod === 0) { cur = [say(o[1]), say(o[2]), say(o[3])]; continue; }
    if (kod === 1) { const q = [say(o[1]), say(o[2]), say(o[3])]; if (cur) segs.push([cur[0], cur[1], cur[2], q[0], q[1], q[2]]); cur = q; continue; }
    if (kod === 2 || kod === -2) {
      // yay: merkez o[1],o[2], yarıçap o[3], açılar o[4]-o[5], kot o[6]
      const cx = say(o[1]), cy = say(o[2]), r = say(o[3]), z = o[6] != null ? say(o[6]) : (cur ? cur[2] : 0);
      cens.push([cx, cy, z]);
      const a0 = say(o[4]), a1 = say(o[5]);
      const yay = Math.abs(a1 - a0), adim = Math.max(8, Math.min(64, Math.ceil(yay / (Math.PI / 16))));
      let onceki = cur;
      for (let i = 0; i <= adim; i++) {
        const a = a0 + (a1 - a0) * (i / adim);
        const q = [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
        if (onceki) segs.push([onceki[0], onceki[1], onceki[2], q[0], q[1], q[2]]);
        onceki = q;
      }
      cur = onceki;
      continue;
    }
    // öteki işlemler (elips, spline) düzleştirilmiş gelmez; yalnız varsa geçilir
    cur = null;
  }
  if (p.closed && segs.length) {
    const ilk = segs[0], son = segs[segs.length - 1];
    if (Math.abs(son[3] - ilk[0]) > 1e-9 || Math.abs(son[4] - ilk[1]) > 1e-9 || Math.abs(son[5] - ilk[2]) > 1e-9) {
      segs.push([son[3], son[4], son[5], ilk[0], ilk[1], ilk[2]]);
    }
  }
  return { segs, cens };
}

/** a + (b-a)*t */
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** prev noktasından [a,b] parçasına DİK ayak (parça dışına düşerse null) */
export function perpFoot3(prev, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L2 = dx * dx + dy * dy + dz * dz;
  if (!(L2 > 1e-18)) return null;
  const t = ((prev[0] - a[0]) * dx + (prev[1] - a[1]) * dy + (prev[2] - a[2]) * dz) / L2;
  if (t < 0 || t > 1) return null;
  return [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t];
}

/**
 * ÜÇ BOYUTLU YAKALAMA.
 *   prims   : sahne ilkelleri (k === 0 olanlar taranır)
 *   project : (x, y, z) → [ekranX, ekranY] ya da görünmüyorsa null
 *   sx, sy  : dokunulan ekran noktası
 *   opts    : { tol (px), modes (Set|dizi), prev ([x,y,z] — PER için), maxWork, visible (p → boolean) }
 * Dönüş: { p:[x,y,z], kind, prim, d } ya da null
 */
export function snap3(prims, project, sx, sy, opts = {}) {
  const tol = opts.tol > 0 ? opts.tol : 22;
  const kipler = opts.modes instanceof Set ? opts.modes : new Set(opts.modes || DEFAULT_MODES3);
  if (!kipler.size || !Array.isArray(prims) || typeof project !== 'function') return null;
  const prev = Array.isArray(opts.prev) ? opts.prev : null;
  const gorunur = typeof opts.visible === 'function' ? opts.visible : null;
  let butce = opts.maxWork > 0 ? opts.maxWork : 120000;

  let best = null, bd = Infinity;
  const dene = (q, kind, prim) => {
    const s = project(q[0], q[1], q[2]);
    if (!s) return;
    const d = Math.hypot(s[0] - sx, s[1] - sy);
    if (d > tol) return;
    // Öncelik cezası: aynı yakınlıkta END, MID'i; MID, CEN'i yener (2B ile aynı sıra).
    const skor = d + PRI[kind] * tol * 0.25;
    if (skor < bd) { bd = skor; best = { p: [q[0], q[1], q[2]], kind, prim, d }; }
  };

  const endOn = kipler.has('end'), midOn = kipler.has('mid'), cenOn = kipler.has('cen');
  const perOn = kipler.has('per') && !!prev, neaOn = kipler.has('nea');

  for (const p of prims) {
    if (butce <= 0) break;
    if (!p || p.k !== 0) continue;
    if (gorunur && !gorunur(p)) continue;
    const g = primGeom3(p);
    if (!g.segs.length && !g.cens.length) continue;
    butce -= g.segs.length;
    if (cenOn) for (const c of g.cens) dene(c, 'cen', p);
    for (const s of g.segs) {
      const a = [s[0], s[1], s[2]], b = [s[3], s[4], s[5]];
      if (endOn) { dene(a, 'end', p); dene(b, 'end', p); }
      if (midOn) dene(lerp3(a, b, 0.5), 'mid', p);
      if (perOn) { const f = perpFoot3(prev, a, b); if (f) dene(f, 'per', p); }
      if (neaOn) {
        // EKRANDA en yakın nokta: parça ekrana izdüşürülür, oradaki en yakın t geri taşınır.
        const pa = project(a[0], a[1], a[2]), pb = project(b[0], b[1], b[2]);
        if (pa && pb) {
          const ux = pb[0] - pa[0], uy = pb[1] - pa[1], L2 = ux * ux + uy * uy;
          const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((sx - pa[0]) * ux + (sy - pa[1]) * uy) / L2)) : 0;
          dene(lerp3(a, b, t), 'nea', p);
        }
      }
    }
  }
  return best;
}
