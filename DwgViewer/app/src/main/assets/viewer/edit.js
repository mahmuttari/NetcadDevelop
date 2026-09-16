/*
 * Düzenleme çekirdeği.
 *
 *  - Varlık tanımı (ent): kullanıcının çizdiği nesnelerin taşınabilir biçimi
 *      { type:'LINE'|'LWPOLYLINE'|'POLYLINE3D'|'CIRCLE'|'ARC'|'POINT'|'TEXT'|'3DFACE'
 *            |'SOLID'|'HATCH'|'CLOUD'|'DIMENSION'|'EXTRUDE',
 *        pts:[[x,y,z]…], r, a0, a1, closed, text, h, rot, layer, color (ACI ya da -1),
 *        itype: bilgi türü üstüne yazımı (ör. ok başı SOLID ama bilgide DIMENSION görünsün),
 *        gid:   grup kimliği — aynı ölçülendirmenin / balonun bütün parçaları birlikte seçilir }
 *  - entToPrim(): tanımı çizilebilir ilkele çevirir (scene.js ilkel biçimi)
 *  - transformPrim(): ilkele 2B afin dönüşüm + Δz uygular
 *  - EditDoc: komut günlüğü (add/delete/xform/props/setz), geri al / yinele, kalıcılık
 *  - writeDxf(): sahne + düzenlemeler → ASCII DXF (AC1015); bloklar patlatılmış hâlde
 */
import { TAU, mul, apply, isSim, simScale, simRot, det, arcPts, ellipsePts, opsBBox, flatten, cloudOps, extrudeMesh } from './geom.js';
import { FG, ACI } from './scene.js';

const R2D = 180 / Math.PI;
let seq = 0;
export const newId = () => 'E' + Date.now().toString(36) + (seq++).toString(36);

// ---------------------------------------------------------------------------------------
// Varlık tanımı → ilkel
// ---------------------------------------------------------------------------------------
export function entToPrim(ent, layers) {
  const lay = layers.get(ent.layer);
  const col = ent.color === -1 || ent.color == null ? (lay ? lay.color : FG) : (ent.color >= 1 && ent.color <= 255 ? ACI[ent.color] : FG);
  const info = { t: ent.type, h: ent.id, lay: ent.layer, ci: ent.color == null ? 256 : ent.color, col, lt: '', lw: lay ? lay.lw : 25, edited: true, text: ent.text };
  if (ent.itype) info.t = ent.itype;            // ok başı SOLID'dir ama ölçü süzgeci onu da gizlemelidir
  if (ent.gid) info.gid = ent.gid;              // grup: parçalar birlikte seçilir, birlikte silinir
  const base = { col, lay: ent.layer, lw: lay ? lay.lw : 25, lt: null, lts: 1, info, et: ent.type, key: ent.id, ent };
  const P = ent.pts || [];
  switch (ent.type) {
    case 'LINE': case 'LWPOLYLINE': case 'POLYLINE3D': case '3DFACE': {
      if (P.length < 2) return null;
      const ops = P.map((p, i) => [i ? 1 : 0, p[0], p[1], p[2] || 0]);
      const closed = !!ent.closed || ent.type === '3DFACE';
      return { ...base, k: 0, ops, closed, fill: false, alpha: 1, w: ent.width || 0, bb: opsBBox(ops), face: ent.type === '3DFACE' };
    }
    case 'CIRCLE': {
      const c = P[0]; if (!c || !(ent.r > 0)) return null;
      const ops = [[0, c[0] + ent.r, c[1], c[2] || 0], [2, c[0], c[1], ent.r, 0, TAU, c[2] || 0]];
      return { ...base, k: 0, ops, closed: true, fill: false, alpha: 1, w: 0, bb: opsBBox(ops) };
    }
    case 'ARC': {
      const c = P[0]; if (!c || !(ent.r > 0)) return null;
      const ops = [[0, c[0] + ent.r * Math.cos(ent.a0), c[1] + ent.r * Math.sin(ent.a0), c[2] || 0], [2, c[0], c[1], ent.r, ent.a0, ent.a1, c[2] || 0]];
      return { ...base, k: 0, ops, closed: false, fill: false, alpha: 1, w: 0, bb: opsBBox(ops) };
    }
    case 'POINT': {
      const p = P[0]; if (!p) return null;
      return { ...base, k: 2, x: p[0], y: p[1], z: p[2] || 0, bb: [p[0], p[1], p[0], p[1]] };
    }
    case 'TEXT': {
      const p = P[0]; if (!p || !ent.text) return null;
      const h = ent.h || 2.5, lines = String(ent.text).split('\n');
      const R = Math.hypot(Math.max(...lines.map(l => l.length)) * h * 0.75, h * (1 + 1.667 * (lines.length - 1)));
      return { ...base, k: 1, x: p[0], y: p[1], z: p[2] || 0, h, rot: ent.rot || 0, lines, ha: ent.ha || 0, va: ent.va || 0, ws: 1, obl: 0, spacing: 1, bb: [p[0] - R, p[1] - R, p[0] + R, p[1] + R] };
    }
    case 'SOLID': {                                   // dolu çokgen: ok başı, işaret
      if (P.length < 3) return null;
      const ops = P.map((p, i) => [i ? 1 : 0, p[0], p[1], p[2] || 0]);
      return { ...base, k: 0, ops, closed: true, fill: true, alpha: ent.alpha == null ? 1 : ent.alpha, w: 0, bb: opsBBox(ops) };
    }
    case 'HATCH': {                                   // tarama; sınır kapalı çokgen
      if (P.length < 3) return null;
      const ops = P.map((p, i) => [i ? 1 : 0, p[0], p[1], p[2] || 0]);
      const ad = String(ent.pattern || 'SOLID').toUpperCase();
      const dolu = ad === 'SOLID';
      info.pattern = ent.pattern || 'SOLID'; info.solid = dolu;
      // Desenli tarama İKİ ilkelden oluşur: sınır (dolgusuz, çerçeve) ve desen çizgileri.
      // Ayrı tutulmalarının sebebi çizim değil YAZMA: DXF'e desenli HATCH olarak yazılırken
      // çizgiler ayrıca LWPOLYLINE olarak çıkmamalıdır (hpart bayrağı onları süzer).
      return { ...base, k: 0, ops, closed: true, fill: dolu, alpha: ent.alpha == null ? 1 : ent.alpha, w: 0, bb: opsBBox(ops) };
    }
    case 'CLOUD': {                                   // revizyon bulutu: yol üzerinde dışa kabaran yaylar
      const ops = cloudOps(P, ent.r || 0, ent.closed !== false);
      if (!ops) return null;
      return { ...base, k: 0, ops, closed: false, fill: false, alpha: 1, w: ent.width || 0, bb: opsBBox(ops) };
    }
    case 'DIMENSION': {                               // çok parçalı yol + isteğe bağlı yay (açı ölçüsü)
      const ops = [];
      for (const sg of ent.segs || []) {
        if (!sg || sg.length < 2) continue;
        ops.push([0, sg[0][0], sg[0][1], sg[0][2] || 0]);
        for (let i = 1; i < sg.length; i++) ops.push([1, sg[i][0], sg[i][1], sg[i][2] || 0]);
      }
      for (const a of ent.arcs || []) {
        if (!a || a.length < 7) continue;
        ops.push([0, a[1] + a[3] * Math.cos(a[4]), a[2] + a[3] * Math.sin(a[4]), a[6] || 0]);   // yay her zaman a[4] açısından başlar
        ops.push(a.slice());
      }
      if (!ops.length) return null;
      if (ent.measure != null) info.meas = ent.measure;
      return { ...base, k: 0, ops, closed: false, fill: false, alpha: 1, w: 0, bb: opsBBox(ops) };
    }
    case 'PATH': {                                    // ham yol: yay ve elips bilgisi korunur (blok, pano)
      const ops = (ent.ops || []).map(o => o.slice());
      if (ops.length < 2) return null;
      // ent.ops OLUŞTURMA ANI’nın görüntüsüdür; ilkel sonradan taşınırsa transformPrim yalnız p.ops’u
      // günceller. Bloğa ya da panoya yeniden alırken primToEnt p.ops’u okur, bu yüzden ayrışma olmaz.
      const pr = { ...base, k: 0, ops, closed: !!ent.closed, fill: !!ent.fill, alpha: ent.alpha == null ? 1 : ent.alpha, w: ent.width || 0, bb: opsBBox(ops) };
      if (ent.hp != null) pr.hp = ent.hp;             // desen adımı: LOD dolgusu bunu okur (render.js)
      return pr;
    }
    case 'MESH': {                                    // hazır üçgen ağı (blok, pano)
      const V = ent.vtx, I = ent.idx;
      if (!V || !V.length || !I || !I.length) return null;
      const vtx = V instanceof Float32Array ? V.slice() : new Float32Array(V);
      const idx = I instanceof Uint32Array ? I.slice() : new Uint32Array(I);
      const seg = ent.seg && ent.seg.length ? (ent.seg instanceof Float32Array ? ent.seg.slice() : new Float32Array(ent.seg)) : new Float32Array(0);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i + 2 < vtx.length; i += 3) {
        if (vtx[i] < x0) x0 = vtx[i]; if (vtx[i] > x1) x1 = vtx[i];
        if (vtx[i + 1] < y0) y0 = vtx[i + 1]; if (vtx[i + 1] > y1) y1 = vtx[i + 1];
        if (vtx[i + 2] < z0) z0 = vtx[i + 2]; if (vtx[i + 2] > z1) z1 = vtx[i + 2];
      }
      if (!isFinite(x0)) return null;
      return { ...base, k: 5, vtx, idx, seg, bb: [x0, y0, x1, y1], zmin: z0, zmax: z1, face: true, alpha: 1, w: 0 };
    }
    case 'EXTRUDE': {                                 // 2B profile kalınlık: üçgen ağ gövdesi
      if (P.length < 2) return null;
      const m = extrudeMesh(P.map(q => [q[0], q[1], q[2] || 0]), ent.h, ent.closed !== false, ent.cap !== false);
      if (!m) return null;
      return { ...base, k: 5, vtx: m.vtx, idx: m.idx, seg: m.seg, bb: m.bb, zmin: m.zmin, zmax: m.zmax, face: true, alpha: 1, w: 0 };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------
// İlkel dönüşümleri
// ---------------------------------------------------------------------------------------
/** ilkeli 2B afin m ile dönüştürür, z'ye dz ekler; yerinde değiştirir */
export function transformPrim(p, m, dz = 0) {
  if (p.k === 5) {                                    // ağ ilkeli: köşe ve kenar dizileri yerinde dönüştürülür
    const V = p.vtx, G = p.seg;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const put = (a, i, q, z) => { a[i] = q[0]; a[i + 1] = q[1]; a[i + 2] = z; if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; };
    for (let i = 0; i + 2 < V.length; i += 3) put(V, i, apply(m, V[i], V[i + 1]), V[i + 2] + dz);
    for (let i = 0; i + 2 < G.length; i += 3) put(G, i, apply(m, G[i], G[i + 1]), G[i + 2] + dz);
    if (isFinite(x0)) p.bb = [x0, y0, x1, y1];
    if (p.zmin != null) { p.zmin += dz; p.zmax += dz; }
    return;
  }
  if (p.k === 0) {
    let out;
    if (isSim(m)) {
      const s = simScale(m), r = simRot(m);
      out = p.ops.map(o => {
        if (o[0] === 0 || o[0] === 1) { const q = apply(m, o[1], o[2]); return [o[0], q[0], q[1], o[3] != null ? o[3] + dz : undefined]; }
        if (o[0] === 2 || o[0] === -2) { const q = apply(m, o[1], o[2]); return [o[0], q[0], q[1], o[3] * s, o[4] + r, o[5] + r, o[6] != null ? o[6] + dz : undefined]; }
        const q = apply(m, o[1], o[2]); return [3, q[0], q[1], o[3] * s, o[4] * s, o[5] + r, o[6], o[7]];
      });
    } else {
      const mirror = det(m) < 0;
      out = [];
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) { const q = apply(m, o[1], o[2]); out.push([o[0], q[0], q[1], o[3] != null ? o[3] + dz : undefined]); continue; }
        if ((o[0] === 2 || o[0] === -2) && mirror && Math.abs(Math.abs(m[0]) - Math.abs(m[3])) < 1e-9) {
          // aynalama: yay yönü değişir
          const q = apply(m, o[1], o[2]);
          const s = Math.hypot(m[0], m[1]);
          const a0 = Math.atan2(m[1] * Math.cos(o[4]) + m[3] * Math.sin(o[4]), m[0] * Math.cos(o[4]) + m[2] * Math.sin(o[4]));
          const a1 = Math.atan2(m[1] * Math.cos(o[5]) + m[3] * Math.sin(o[5]), m[0] * Math.cos(o[5]) + m[2] * Math.sin(o[5]));
          out.push([-o[0], q[0], q[1], o[3] * s, a0, a1, o[6] != null ? o[6] + dz : undefined]);
          continue;
        }
        const pts = [];
        if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], pts);
        else if (o[0] === -2) { arcPts(o[1], o[2], o[3], o[5], o[4], pts); pts.reverse(); }
        else ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
        for (let i = 0; i < pts.length; i++) { const q = apply(m, pts[i][0], pts[i][1]); out.push([out.length ? 1 : 0, q[0], q[1], o[6] != null ? o[6] + dz : undefined]); }
      }
    }
    p.ops = out; p.bb = opsBBox(out);
    if (p.w) p.w *= Math.sqrt(Math.abs(det(m)));
  } else if (p.k === 1) {
    const q = apply(m, p.x, p.y); p.x = q[0]; p.y = q[1];
    const s = Math.sqrt(Math.abs(det(m))); p.h *= s; p.rot += Math.atan2(m[1], m[0]);
    if (p.z != null) p.z += dz;
    const R = Math.hypot(Math.max(...p.lines.map(l => l.length)) * p.h * 0.75 * p.ws, p.h * (1 + 1.667 * (p.lines.length - 1)));
    p.bb = [p.x - R, p.y - R, p.x + R, p.y + R];
  } else if (p.k === 2 || p.k === 4) {
    const q = apply(m, p.x, p.y); p.x = q[0]; p.y = q[1]; if (p.z != null) p.z += dz; p.bb = [p.x, p.y, p.x, p.y];
  } else if (p.k === 3) {
    p.quad = p.quad.map(c => apply(m, c[0], c[1])); p.bb = [Math.min(...p.quad.map(c => c[0])), Math.min(...p.quad.map(c => c[1])), Math.max(...p.quad.map(c => c[0])), Math.max(...p.quad.map(c => c[1]))];
  }
  if (p.ent) { // tanım da güncellensin
    p.ent.pts = (p.ent.pts || []).map(q => { const r = apply(m, q[0], q[1]); return [r[0], r[1], (q[2] || 0) + dz]; });
    if (p.ent.r) p.ent.r *= Math.sqrt(Math.abs(det(m)));
    if (p.ent.type === 'ARC') { const r = Math.atan2(m[1], m[0]); p.ent.a0 += r; p.ent.a1 += r; }
    if (p.ent.type === 'TEXT') p.ent.rot = (p.ent.rot || 0) + Math.atan2(m[1], m[0]);
  }
  return p;
}
export function setPrimZ(p, z) {
  if (p.k === 5) {
    // ağ gövdesi yassıltılamaz (k=0'daki gibi bütün z'leri eşitlemek gövdeyi dejenere ederdi): taban kotu z'ye taşınır
    const dz = z - (p.zmin != null ? p.zmin : 0);
    if (dz) {
      const V = p.vtx, G = p.seg;
      if (V) for (let i = 2; i < V.length; i += 3) V[i] += dz;
      if (G) for (let i = 2; i < G.length; i += 3) G[i] += dz;
      if (p.zmin != null) { p.zmin += dz; p.zmax += dz; }
    }
    return;                                        // p.bb yalnız x-y taşır, değişmez
  }
  if (p.k === 0) for (const o of p.ops) { if (o[0] === 0 || o[0] === 1) o[3] = z; else if (o[0] === 2 || o[0] === -2) o[6] = z; }
  else p.z = z;
  if (p.ent) { p.ent.pts = (p.ent.pts || []).map(q => [q[0], q[1], z]); }
}
/**
 * İlkelin derin kopyası. Ağ ilkelinin (k=5) yazılı dizileri JSON turundan geçirilemez — Float32Array
 * düz nesneye ({"0":…}) döner ve geri alma/kopyalama sahneyi bozardı. Köşe ve kenar dizileri
 * kopyalanır (transformPrim onları YERİNDE değiştirir); üçgen indeksleri hiçbir yerde değişmediği
 * için paylaşılır.
 */
/** DXF'e yazılacak en çok üçgen: üstü atlanır (üçgen başına ~14 satır) */
const DXF_MAX_FACE = 200000;
export const clonePrim = (p) => {
  if (p.k === 5) return { ...p, vtx: p.vtx ? p.vtx.slice() : p.vtx, seg: p.seg ? p.seg.slice() : p.seg, idx: p.idx, bb: p.bb ? p.bb.slice() : p.bb, info: p.info };
  const c = JSON.parse(JSON.stringify({ ...p, info: undefined })); c.info = p.info; return c;
};

/** Kapalı ya da açık çokgeni d kadar ötele (pozitif = sola). Yalnız doğru parçalı yollar. */
export function offsetPoints(pts, d, closed) {
  const n = pts.length; if (n < 2) return null;
  const segs = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * d, ny = dx / L * d;
    segs.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny]]);
  }
  const out = [];
  const inter = (s1, s2) => {
    const d0 = (s1[1][0] - s1[0][0]) * (s2[1][1] - s2[0][1]) - (s1[1][1] - s1[0][1]) * (s2[1][0] - s2[0][0]);
    if (Math.abs(d0) < 1e-12) return s1[1];
    const t = ((s2[0][0] - s1[0][0]) * (s2[1][1] - s2[0][1]) - (s2[0][1] - s1[0][1]) * (s2[1][0] - s2[0][0])) / d0;
    return [s1[0][0] + t * (s1[1][0] - s1[0][0]), s1[0][1] + t * (s1[1][1] - s1[0][1])];
  };
  if (closed) for (let i = 0; i < n; i++) out.push(inter(segs[(i - 1 + n) % n], segs[i]));
  else { out.push(segs[0][0]); for (let i = 1; i < n - 1; i++) out.push(inter(segs[i - 1], segs[i])); out.push(segs[segs.length - 1][1]); }
  return out.map((q, i) => [q[0], q[1], pts[i][2]]);
}

// ---------------------------------------------------------------------------------------
// Komut günlüğü
// ---------------------------------------------------------------------------------------
export class EditDoc {
  /**
   * @param ctx { prims:()=>array, layers:Map, keyOf:(p)=>string, insert:(prim, at)=>void, remove:(prim)=>index, rebuild:()=>void, store:{get,set}, key:string }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.log = [];      // kalıcı komutlar
    this.undoStack = []; // { cmd, restore:() => void }
    this.redoStack = [];
  }
  get dirty() { return this.log.length > 0; }
  find(keys) {
    const set = new Set(keys);
    return this.ctx.prims().filter(p => set.has(p.key));
  }
  /** komutu uygular, günlüğe yazar */
  run(cmd, opts = {}) {
    const restore = this.apply(cmd);
    if (!restore) return false;
    this.log.push(cmd);
    this.undoStack.push({ cmd, restore });
    this.redoStack = [];
    if (!opts.silent) this.save();
    return true;
  }
  apply(cmd) {
    const C = this.ctx;
    switch (cmd.op) {
      case 'add': {
        const created = [];
        for (const ent of cmd.ents) {
          const p = entToPrim(ent, C.layers);
          if (!p) continue;
          C.insert(p); created.push(p);
        }
        if (!created.length) return null;
        C.rebuild();
        return () => { for (const p of created) C.remove(p); C.rebuild(); };
      }
      case 'delete': {
        const ps = this.find(cmd.keys);
        if (!ps.length) return null;
        const removed = ps.map(p => ({ p, at: C.remove(p) }));
        C.rebuild();
        return () => { for (const r of removed.reverse()) C.insert(r.p, r.at); C.rebuild(); };
      }
      case 'xform': {
        const ps = this.find(cmd.keys);
        if (!ps.length) return null;
        const snaps = ps.map(p => clonePrim(p));
        for (const p of ps) { transformPrim(p, cmd.m, cmd.dz || 0); p.info = { ...p.info, edited: true }; }
        C.rebuild();
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); C.rebuild(); };
      }
      case 'copy': {
        const ps = this.find(cmd.keys);
        if (!ps.length) return null;
        const created = ps.map((p, i) => { const c = clonePrim(p); c.key = cmd.newKeys[i]; c.info = { ...p.info, h: c.key, edited: true }; if (c.ent) { c.ent = { ...c.ent, id: c.key }; } transformPrim(c, cmd.m, cmd.dz || 0); C.insert(c); return c; });
        C.rebuild();
        return () => { for (const p of created) C.remove(p); C.rebuild(); };
      }
      case 'setz': {
        const ps = this.find(cmd.keys);
        if (!ps.length) return null;
        const snaps = ps.map(p => clonePrim(p));
        for (const p of ps) { setPrimZ(p, cmd.z); p.info = { ...p.info, edited: true }; }
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); };
      }
      case 'props': {
        const ps = this.find(cmd.keys);
        if (!ps.length) return null;
        const snaps = ps.map(p => ({ lay: p.lay, col: p.col, info: p.info, ent: p.ent }));
        for (const p of ps) {
          const lay = cmd.layer ? C.layers.get(cmd.layer) : null;
          if (cmd.layer) p.lay = cmd.layer;
          if (cmd.color != null) p.col = cmd.color === 256 ? (C.layers.get(p.lay) ? C.layers.get(p.lay).color : FG) : (cmd.color === -1 ? FG : ACI[cmd.color]);
          else if (lay && (p.info && p.info.ci === 256)) p.col = lay.color;
          p.info = { ...p.info, lay: p.lay, ci: cmd.color != null ? cmd.color : (p.info ? p.info.ci : 256), col: p.col, edited: true };
          if (p.ent) p.ent = { ...p.ent, layer: p.lay, color: cmd.color != null ? cmd.color : p.ent.color };
        }
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); };
      }
      case 'layer': {
        if (C.layers.has(cmd.name)) return null;
        C.layers.set(cmd.name, { name: cmd.name, color: cmd.color === -1 || cmd.color == null ? FG : ACI[cmd.color], lt: 'Continuous', lw: 25, frozen: false, off: false, visible: true, count: 0, added: true });
        return () => { C.layers.delete(cmd.name); };
      }
      /*
       * KATMAN ÖZELLİKLERİ. Yeniden adlandırma, renk, çizgi tipi, kalınlık, dondur/çöz ve kilit
       * tek komutta toplanır: kullanıcı katman kutusunda hepsini birlikte değiştirir, geri alma
       * da tek adım olmalıdır.
       *
       * Yeniden adlandırmada katmanın ADI nesnelerin üzerinde taşındığı için (p.lay) bütün
       * ilkeller taranıp güncellenir. '0' katmanı yeniden adlandırılamaz — DXF'te ayrılmış addır
       * ve renk/çizgi tipi "katmandan" çözümlemesinin dayanağıdır.
       */
      case 'layerprops': {
        const l = C.layers.get(cmd.name); if (!l) return null;
        const yeniAd = cmd.newName && cmd.newName !== cmd.name ? String(cmd.newName).trim() : null;
        if (yeniAd && (cmd.name === '0' || C.layers.has(yeniAd) || !yeniAd)) return null;
        const onceki = { ...l };
        const etkilenen = yeniAd ? this.ctx.prims().filter(p => p.lay === cmd.name) : [];
        const eskiRenkler = new Map();
        if (cmd.color != null) for (const p of this.ctx.prims()) if (p.lay === cmd.name) eskiRenkler.set(p, p.col);
        if (cmd.color != null) l.color = cmd.color === -1 ? FG : (cmd.color >= 1 && cmd.color <= 255 ? ACI[cmd.color] : FG);
        if (cmd.lt != null) l.lt = cmd.lt;
        if (cmd.lw != null) l.lw = cmd.lw;
        if (cmd.frozen != null) { l.frozen = !!cmd.frozen; l.visible = !l.frozen && !l.off; }
        if (cmd.off != null) { l.off = !!cmd.off; l.visible = !l.frozen && !l.off; }
        if (cmd.locked != null) l.locked = !!cmd.locked;
        l.edited = true;
        // Katman rengiyle çizilen nesneler (colorIndex 256) yeni rengi almalı
        if (cmd.color != null) for (const p of eskiRenkler.keys()) if (p.info && p.info.ci === 256) p.col = l.color;
        if (yeniAd) {
          C.layers.delete(cmd.name);
          l.name = yeniAd;
          C.layers.set(yeniAd, l);
          for (const p of etkilenen) { p.lay = yeniAd; if (p.info) p.info = { ...p.info, lay: yeniAd }; if (p.ent) p.ent = { ...p.ent, layer: yeniAd }; }
        }
        return () => {
          if (yeniAd) { C.layers.delete(yeniAd); for (const p of etkilenen) { p.lay = cmd.name; if (p.info) p.info = { ...p.info, lay: cmd.name }; if (p.ent) p.ent = { ...p.ent, layer: cmd.name }; } }
          C.layers.set(cmd.name, Object.assign(l, onceki));
          for (const [p, c] of eskiRenkler) p.col = c;
        };
      }
      /*
       * KATMAN SİLME. İki kip: içindeki nesneler de silinir ('ents') ya da '0' katmanına taşınır
       * ('move'). Varsayılan taşımadır — silme geri alınabilir olsa bile kullanıcının nesnesini
       * sessizce yok etmek doğru değildir. '0' katmanı silinemez.
       */
      case 'layerdel': {
        if (cmd.name === '0') return null;
        const l = C.layers.get(cmd.name); if (!l) return null;
        const icerik = this.ctx.prims().filter(p => p.lay === cmd.name);
        const kip = cmd.mode === 'ents' ? 'ents' : 'move';
        const onceki = { ...l };
        let silinen = null;
        if (kip === 'ents') {
          const set = new Set(icerik);
          silinen = icerik.map(p => ({ p, i: this.ctx.prims().indexOf(p) }));
          const arr = this.ctx.prims();
          for (let i = arr.length - 1; i >= 0; i--) if (set.has(arr[i])) arr.splice(i, 1);
        } else {
          const sifir = C.layers.get('0');
          for (const p of icerik) { p.lay = '0'; if (p.info) p.info = { ...p.info, lay: '0' }; if (p.ent) p.ent = { ...p.ent, layer: '0' }; if (p.info && p.info.ci === 256 && sifir) p.col = sifir.color; }
        }
        C.layers.delete(cmd.name);
        return () => {
          C.layers.set(cmd.name, Object.assign(l, onceki));
          if (kip === 'ents' && silinen) { const arr = this.ctx.prims(); for (const { p, i } of silinen) arr.splice(Math.min(i, arr.length), 0, p); }
          else for (const p of icerik) { p.lay = cmd.name; if (p.info) p.info = { ...p.info, lay: cmd.name }; if (p.ent) p.ent = { ...p.ent, layer: cmd.name }; if (p.info && p.info.ci === 256) p.col = l.color; }
        };
      }
      case 'edittext': {
        const ps = this.find(cmd.keys).filter(p => p.k === 1);
        if (!ps.length) return null;
        const snaps = ps.map(p => ({ lines: p.lines, ent: p.ent }));
        for (const p of ps) { p.lines = String(cmd.text).split('\n'); if (p.ent) p.ent = { ...p.ent, text: cmd.text }; if (p.info) p.info = { ...p.info, text: cmd.text, edited: true }; }
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); };
      }
      case 'array': {
        // artımlı kopya: bütün kopyalar TEK komutta oluşur, tek geri almayla kalkar
        const ps = this.find(cmd.keys);
        if (!ps.length) return null;
        const created = [];
        for (const it of cmd.items || []) {
          ps.forEach((p, i) => {
            const c = clonePrim(p);
            c.key = (it.newKeys && it.newKeys[i]) || newId();
            c.info = { ...p.info, h: c.key, edited: true };
            if (c.ent) c.ent = { ...c.ent, id: c.key };
            transformPrim(c, it.m, it.dz || 0);
            C.insert(c); created.push(c);
          });
        }
        if (!created.length) return null;
        C.rebuild();
        return () => { for (const p of created) C.remove(p); C.rebuild(); };
      }
      case 'textheight': {
        const ps = this.find(cmd.keys).filter(p => p.k === 1 && p.h > 0);
        if (!ps.length) return null;
        const snaps = ps.map(p => clonePrim(p));
        for (const p of ps) {
          const h = cmd.h > 0 ? cmd.h : (cmd.factor > 0 ? p.h * cmd.factor : p.h);
          if (!(h > 0)) continue;
          p.h = h;
          if (p.ent) p.ent = { ...p.ent, h };
          p.info = { ...p.info, edited: true };
          const R = Math.hypot(Math.max(...p.lines.map(l => l.length)) * p.h * 0.75 * (p.ws || 1), p.h * (1 + 1.667 * (p.lines.length - 1)));
          p.bb = [p.x - R, p.y - R, p.x + R, p.y + R];
        }
        C.rebuild();
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); C.rebuild(); };
      }
      case 'settexts': {
        // her anahtara AYRI metin: bul-değiştir tek geri almayla döner
        const map = new Map((cmd.items || []).map(it => [it.key, it.text]));
        const ps = C.prims().filter(p => map.has(p.key) && p.k === 1);
        if (!ps.length) return null;
        const snaps = ps.map(p => ({ lines: p.lines, ent: p.ent, info: p.info, bb: p.bb }));
        for (const p of ps) {
          const txt = String(map.get(p.key));
          p.lines = txt.split('\n');
          if (p.ent) p.ent = { ...p.ent, text: txt };
          p.info = { ...p.info, text: txt, edited: true };
          const R = Math.hypot(Math.max(...p.lines.map(l => l.length)) * p.h * 0.75 * (p.ws || 1), p.h * (1 + 1.667 * (p.lines.length - 1)));
          p.bb = [p.x - R, p.y - R, p.x + R, p.y + R];
        }
        C.rebuild();
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); C.rebuild(); };
      }
      case 'attrib': {
        // Blok özniteliği: hem ATTRIB yazısı hem yerleştirmenin paylaşılan bilgi listesi güncellenir.
        // Bir yerleştirmenin BÜTÜN ilkelleri AYNI info nesnesini taşır; yeni liste hepsine birden verilir,
        // yoksa bilgi panelinde eski değer kalırdı. Birden çok öznitelik tek komutta değişir.
        const group = C.prims().filter(p => p.info && p.info.h === cmd.h);
        if (!group.length) return null;
        const info0 = group[0].info;
        const attrs = info0.attrs || [];
        const items = (cmd.items || []).filter(it => attrs[it.i]);
        if (!items.length) return null;
        const texts = group.filter(p => p.k === 1 && (p.et === 'ATTRIB' || p.et === 'ATTDEF'));
        const snaps = texts.map(p => ({ p, lines: p.lines, bb: p.bb }));
        const next = attrs.map(a => a.slice());
        for (const it of items) {
          next[it.i] = [attrs[it.i][0], String(it.value)];
          const target = texts[it.i];
          if (!target) continue;
          target.lines = String(it.value).split('\n');
          const R = Math.hypot(Math.max(...target.lines.map(l => l.length)) * target.h * 0.75 * (target.ws || 1), target.h * (1 + 1.667 * (target.lines.length - 1)));
          target.bb = [target.x - R, target.y - R, target.x + R, target.y + R];
        }
        const newInfo = { ...info0, attrs: next, edited: true };
        for (const p of group) if (p.info === info0) p.info = newInfo;
        C.rebuild();
        return () => {
          for (const p of group) if (p.info === newInfo) p.info = info0;
          for (const sN of snaps) { sN.p.lines = sN.lines; sN.p.bb = sN.bb; }
          C.rebuild();
        };
      }
      case 'group': {
        // Birden çok alt komutu TEK geçmiş adımı olarak uygular (bul-değiştir gibi karma işlemler).
        // Alt komutlar günlüğe ayrı ayrı yazılmaz; yalnız 'group' yazılır ve yeniden oynatılır.
        const restores = [];
        for (const sub of cmd.cmds || []) { const r = this.apply(sub); if (r) restores.push(r); }
        if (!restores.length) return null;
        return () => { for (const r of restores.slice().reverse()) r(); };
      }
      case 'explode': {
        // blok yerleştirmesini parçalarına ayırır: her ilkel kendi kimliğini alır, blok bağı kalkar.
        // Kimlikler komutun içinde saklanır; böylece kayıtlı günlük yeniden oynatıldığında aynı anahtarlar çıkar.
        const group = C.prims().filter(p => p.info && p.info.h === cmd.h && p.info.t === 'INSERT');
        if (!group.length) return null;
        const snaps = group.map(p => ({ p, info: p.info, key: p.key }));
        group.forEach((p, i) => {
          const id = (cmd.ids && cmd.ids[i]) || (cmd.h + '_x' + i);
          p.key = id;
          p.info = { ...p.info, t: p.et || 'LINE', h: id, name: undefined, attrs: undefined, exploded: true, edited: true };
        });
        C.rebuild();
        return () => { for (const sN of snaps) { sN.p.info = sN.info; sN.p.key = sN.key; } C.rebuild(); };
      }
      case 'reshape': {
        /*
         * Bir yolun köşelerini YERİNDE yeniden yazar. Budama, uzatma, kavis, pah ve tek köşe
         * sürüklemesi bunu kullanır; hiçbiri afin dönüşüm değildir, bu yüzden 'xform' ile
         * anlatılamazlar. Bölme (budamada ortadan kesme) ve kavis yayının ayrı ilkel olarak
         * eklenmesi için yeni op yazılmaz — var olan 'group' ikisini tek geri alma adımı yapar.
         */
        const map = new Map((cmd.items || []).map(it => [it.key, it]));
        const ps = C.prims().filter(p => map.has(p.key) && p.k === 0);
        if (!ps.length) return null;
        const snaps = ps.map(p => clonePrim(p));
        for (const p of ps) {
          const it = map.get(p.key);
          if (!Array.isArray(it.ops) || it.ops.length < 2) continue;
          // Kot her zaman sayıya indirgenir: kalıcı günlük JSON'dur ve undefined orada null olur,
          // yeniden yüklemede NaN üretirdi.
          p.ops = it.ops.map(o => o.map(v => (typeof v === 'number' && isFinite(v) ? v : 0)));
          if (it.closed != null) p.closed = !!it.closed;
          p.bb = opsBBox(p.ops);
          p.info = { ...p.info, edited: true };
          // p.ent ile p.ops ayrışmamalı: blok kitaplığı, pano ve bilgi paneli ent'i okur.
          if (p.ent) {
            const duz = p.ops.every(o => o[0] === 0 || o[0] === 1);
            if (duz && (p.ent.type === 'LINE' || p.ent.type === 'LWPOLYLINE' || p.ent.type === 'POLYLINE3D')) {
              p.ent = { ...p.ent, type: p.ops.length === 2 ? p.ent.type : (p.ent.type === 'LINE' ? 'LWPOLYLINE' : p.ent.type), pts: p.ops.map(o => [o[1], o[2], o[3] || 0]), closed: !!p.closed };
            } else {
              p.ent = { ...p.ent, type: 'PATH', ops: p.ops.map(o => o.slice()), closed: !!p.closed };
            }
          }
        }
        C.rebuild();
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); C.rebuild(); };
      }
      default: return null;
    }
  }
  undo() {
    const u = this.undoStack.pop();
    if (!u) return false;
    u.restore();
    this.log.pop();
    this.redoStack.push(u.cmd);
    this.save();
    return true;
  }
  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    const restore = this.apply(cmd);
    if (restore) { this.log.push(cmd); this.undoStack.push({ cmd, restore }); }
    this.save();
    return true;
  }
  save() { if (this.ctx.key) this.ctx.store.set('edits:' + this.ctx.key, JSON.stringify(this.log)); }
  /** kayıtlı günlüğü yeniden uygular */
  load() {
    if (!this.ctx.key) return 0;
    const log = this.ctx.store.json('edits:' + this.ctx.key, []);
    let n = 0;
    for (const cmd of log) { const r = this.apply(cmd); if (r) { this.log.push(cmd); this.undoStack.push({ cmd, restore: r }); n++; } }
    return n;
  }
  clear() { this.log = []; this.undoStack = []; this.redoStack = []; this.save(); }
}

// ---------------------------------------------------------------------------------------
// DXF yazıcı
// ---------------------------------------------------------------------------------------
const f6 = (v) => (Math.round((v || 0) * 1e6) / 1e6).toString();
function aciOf(col, layerCol) {
  if (col === FG) return 7;
  if (col === layerCol) return 256;
  let best = 7, bd = Infinity;
  for (let i = 1; i < 256; i++) { const c = ACI[i]; if (c === FG) continue; const d = Math.abs(((c >> 16) & 255) - ((col >> 16) & 255)) + Math.abs(((c >> 8) & 255) - ((col >> 8) & 255)) + Math.abs((c & 255) - (col & 255)); if (d < bd) { bd = d; best = i; } }
  return best;
}
/**
 * prims: ilkeller; layers: Map; opts { onlyEdited?:boolean, ltypes?, units? }
 * → DXF metni (AC1015, UTF-8 içerik; yazılar \U+ kaçışsız)
 */
export function writeDxf(prims, layers, opts = {}) {
  const out = [];
  const w = (c, v) => { out.push(String(c)); out.push(String(v)); };
  let handle = 0x100;
  const H = () => (handle++).toString(16).toUpperCase();
  // Desen çizgileri ayrı LWPOLYLINE olarak YAZILMAZ: desenli tarama DXF'e HATCH olarak çıkar ve
  // AutoCAD deseni kendisi üretir. Yazılsaydı dosyada hem dolgu hem çizgiler olur, çift görünürdü.
  const ents = prims.filter(p => p.k !== 4 && !p.inf && !(p.ent && p.ent.hpart) && (!opts.onlyEdited || (p.info && p.info.edited)));
  const usedLayers = new Set(ents.map(p => p.lay));
  const bb = ents.length ? ents.reduce((a, p) => [Math.min(a[0], p.bb[0]), Math.min(a[1], p.bb[1]), Math.max(a[2], p.bb[2]), Math.max(a[3], p.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]) : [0, 0, 1, 1];
  // HEADER
  w(0, 'SECTION'); w(2, 'HEADER');
  w(9, '$ACADVER'); w(1, 'AC1015');
  w(9, '$INSUNITS'); w(70, opts.units == null ? 0 : opts.units);
  w(9, '$EXTMIN'); w(10, f6(bb[0])); w(20, f6(bb[1])); w(30, 0);
  w(9, '$EXTMAX'); w(10, f6(bb[2])); w(20, f6(bb[3])); w(30, 0);
  w(9, '$LTSCALE'); w(40, 1);
  w(0, 'ENDSEC');
  // TABLES
  w(0, 'SECTION'); w(2, 'TABLES');
  const ltypes = opts.ltypes || {};
  w(0, 'TABLE'); w(2, 'LTYPE'); w(5, H()); w(100, 'AcDbSymbolTable'); w(70, 3 + Object.keys(ltypes).length);
  for (const [name, desc] of [['ByBlock', ''], ['ByLayer', ''], ['Continuous', 'Solid line']]) { w(0, 'LTYPE'); w(5, H()); w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbLinetypeTableRecord'); w(2, name); w(70, 0); w(3, desc); w(72, 65); w(73, 0); w(40, 0); }
  for (const k of Object.keys(ltypes)) { const lt = ltypes[k]; w(0, 'LTYPE'); w(5, H()); w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbLinetypeTableRecord'); w(2, lt.name || k); w(70, 0); w(3, ''); w(72, 65); w(73, lt.pat.length); w(40, f6(lt.len)); for (const e of lt.pat) { w(49, f6(e)); w(74, 0); } }
  w(0, 'ENDTAB');
  w(0, 'TABLE'); w(2, 'LAYER'); w(5, H()); w(100, 'AcDbSymbolTable'); w(70, layers.size + 1);
  const layList = [...layers.values()].filter(l => usedLayers.has(l.name) || l.name === '0' || l.added || l.edited);   // düzenlenmiş boş katman da korunur
  if (!layList.some(l => l.name === '0')) layList.unshift({ name: '0', color: FG, lt: 'Continuous', lw: 25 });
  for (const l of layList) {
    w(0, 'LAYER'); w(5, H()); w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbLayerTableRecord'); w(2, l.name); w(70, (l.frozen ? 1 : 0) | (l.locked ? 4 : 0));   // DXF LAYER 70: bit 1 dondurulmuş, bit 4 kilitli
    w(62, (l.off ? -1 : 1) * aciOf(l.color, null)); w(6, l.lt && ltypes[(l.lt || '').toUpperCase()] ? l.lt : 'Continuous'); w(370, l.lw || 25); w(390, 0);
  }
  w(0, 'ENDTAB');
  w(0, 'TABLE'); w(2, 'STYLE'); w(5, H()); w(100, 'AcDbSymbolTable'); w(70, 1);
  w(0, 'STYLE'); w(5, H()); w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbTextStyleTableRecord'); w(2, 'Standard'); w(70, 0); w(40, 0); w(41, 1); w(50, 0); w(71, 0); w(42, 2.5); w(3, 'txt'); w(4, '');
  w(0, 'ENDTAB');
  w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'BLOCKS'); w(0, 'ENDSEC');
  // ENTITIES
  w(0, 'SECTION'); w(2, 'ENTITIES');
  const common = (type, p, sub) => {
    w(0, type); w(5, H()); w(100, 'AcDbEntity'); w(8, p.lay || '0');
    const lay = layers.get(p.lay);
    const ci = p.info && p.info.ci != null && p.info.ci !== 0 ? (p.info.ci === 256 ? 256 : aciOf(p.col, lay ? lay.color : null)) : aciOf(p.col, lay ? lay.color : null);
    if (ci !== 256) w(62, ci);
    if (p.lt) w(6, ltypes[p.lt] ? ltypes[p.lt].name : p.lt);
    if (sub) w(100, sub);
  };
  for (const p of ents) {
    try {
      if (p.k === 1) {
        const txt = p.lines.join('\\P');
        if (p.lines.length > 1) {
          common('MTEXT', p, 'AcDbMText'); w(10, f6(p.x)); w(20, f6(p.y)); w(30, f6(p.z || 0)); w(40, f6(p.h)); w(71, p.va === 3 ? 1 : p.va === 2 ? 4 : 7); w(1, txt.slice(0, 250)); w(50, f6(p.rot * R2D));
        } else {
          common('TEXT', p, 'AcDbText'); w(10, f6(p.x)); w(20, f6(p.y)); w(30, f6(p.z || 0)); w(40, f6(p.h)); w(1, p.lines[0]); w(50, f6(p.rot * R2D)); w(41, f6(p.ws || 1));
          w(72, p.ha === 1 ? 1 : p.ha === 2 ? 2 : 0); w(11, f6(p.x)); w(21, f6(p.y)); w(31, f6(p.z || 0)); w(100, 'AcDbText'); w(73, p.va === 3 ? 3 : p.va === 2 ? 2 : p.va === 1 ? 1 : 0);
        }
        continue;
      }
      if (p.k === 2) { common('POINT', p, 'AcDbPoint'); w(10, f6(p.x)); w(20, f6(p.y)); w(30, f6(p.z || 0)); continue; }
      if (p.k === 5) {
        // ağ gövdesi: üçgenler 3DFACE, kenarlar LINE olarak yazılır (yoksa katı geometri DXF'e hiç girmez).
        // Çok büyük gövdede yüzler atlanır, kenarlar her zaman yazılır — dosya bellek taşırmasın.
        const V = p.vtx, I = p.idx, G = p.seg;
        const nTri = I ? (I.length / 3) | 0 : 0;
        if (nTri > 0 && nTri <= DXF_MAX_FACE) {
          for (let i = 0; i + 2 < I.length; i += 3) {
            const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
            if (a + 2 >= V.length || b + 2 >= V.length || c + 2 >= V.length) continue;
            common('3DFACE', p, 'AcDbFace');
            for (const [q, v] of [[0, a], [1, b], [2, c], [3, c]]) { w(10 + q, f6(V[v])); w(20 + q, f6(V[v + 1])); w(30 + q, f6(V[v + 2])); }
            if (G && G.length) w(70, 15);          // gerçek kenarlar LINE olarak yazılıyor: üçgenleme kenarları gizli
          }
        }
        if (G) for (let i = 0; i + 5 < G.length; i += 6) {
          common('LINE', p, 'AcDbLine');
          w(10, f6(G[i])); w(20, f6(G[i + 1])); w(30, f6(G[i + 2])); w(11, f6(G[i + 3])); w(21, f6(G[i + 4])); w(31, f6(G[i + 5]));
        }
        continue;
      }
      if (p.k !== 0) continue;
      const ops = p.ops;
      if (p.fill && (p.et === 'HATCH' || p.et === 'SOLID' || p.et === 'TRACE')) {
        // Dolu yüzeyler gerçek DXF varlığı olarak yazılır; LWPOLYLINE'a düşürmek dolguyu kaybettirirdi.
        // Alt yollar ayrı sınırdır (moveto her seferinde yeni yol açar).
        const parts = []; let cur = null;
        for (const o of ops) {
          if (o[0] === 0) { cur = [[o[1], o[2]]]; parts.push(cur); }
          else if (cur) { const qs = o[0] === 1 ? [[o[1], o[2]]] : flatten([o]); for (const q of qs) cur.push([q[0], q[1]]); }
        }
        const paths = parts.filter(a => a.length >= 3);
        const elev = (ops[0] && ops[0][3]) || 0;
        if (paths.length && p.et !== 'HATCH' && paths.length === 1 && paths[0].length <= 4) {
          // Üç ya da dört köşeli dolu: DXF SOLID. Köşe sırası 1-2-4-3'tür, üçgende 4 = 3.
          const q = paths[0];
          const A = q[0], B = q[1], Cc = q[2], Dd = q.length > 3 ? q[3] : q[2];
          common('SOLID', p, 'AcDbTrace');
          w(10, f6(A[0])); w(20, f6(A[1])); w(30, f6(elev));
          w(11, f6(B[0])); w(21, f6(B[1])); w(31, f6(elev));
          w(12, f6(Dd[0])); w(22, f6(Dd[1])); w(32, f6(elev));
          w(13, f6(Cc[0])); w(23, f6(Cc[1])); w(33, f6(elev));
          continue;
        }
        if (paths.length) {
          common('HATCH', p, 'AcDbHatch');
          w(10, 0); w(20, 0); w(30, f6(elev));
          w(210, 0); w(220, 0); w(230, 1);
          w(2, 'SOLID'); w(70, 1); w(71, 0);
          w(91, paths.length);
          for (const part of paths) {
            w(92, 3); w(72, 0); w(73, 1); w(93, part.length);       // 92: dış sınır (1) + çokgen (2)
            for (const q of part) { w(10, f6(q[0])); w(20, f6(q[1])); }
            w(97, 0);
          }
          w(75, paths.length > 1 ? 1 : 0); w(76, 1); w(98, 0);
          continue;
        }
      }
      if (ops.length === 2 && ops[1][0] === 2 && Math.abs((ops[1][5] - ops[1][4]) - TAU) < 1e-9) {
        const o = ops[1]; common('CIRCLE', p, 'AcDbCircle'); w(10, f6(o[1])); w(20, f6(o[2])); w(30, f6(o[6] || 0)); w(40, f6(o[3])); continue;
      }
      if (ops.length === 2 && (ops[1][0] === 2 || ops[1][0] === -2)) {
        const o = ops[1]; const a0 = o[0] === 2 ? o[4] : o[5], a1 = o[0] === 2 ? o[5] : o[4];
        common('ARC', p, 'AcDbCircle'); w(10, f6(o[1])); w(20, f6(o[2])); w(30, f6(o[6] || 0)); w(40, f6(o[3])); w(100, 'AcDbArc'); w(50, f6(a0 * R2D)); w(51, f6(a1 * R2D)); continue;
      }
      const zs = ops.filter(o => o[0] === 0 || o[0] === 1).map(o => o[3] || 0);
      const is3d = zs.some(z => Math.abs(z - zs[0]) > 1e-9);
      const hasArc = ops.some(o => o[0] === 2 || o[0] === -2 || o[0] === 3);
      if (p.face && ops.length >= 3 && ops.length <= 4) {
        common('3DFACE', p, 'AcDbFace');
        for (let i = 0; i < 4; i++) { const o = ops[Math.min(i, ops.length - 1)]; w(10 + i, f6(o[1])); w(20 + i, f6(o[2])); w(30 + i, f6(o[3] || 0)); }
        continue;
      }
      if (is3d && !hasArc) {
        common('POLYLINE', p, 'AcDb3dPolyline'); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, 8 | (p.closed ? 1 : 0));
        for (const o of ops) { if (o[0] !== 0 && o[0] !== 1) continue; w(0, 'VERTEX'); w(5, H()); w(100, 'AcDbEntity'); w(8, p.lay || '0'); w(100, 'AcDbVertex'); w(100, 'AcDb3dPolylineVertex'); w(10, f6(o[1])); w(20, f6(o[2])); w(30, f6(o[3] || 0)); w(70, 32); }
        w(0, 'SEQEND'); w(5, H()); w(100, 'AcDbEntity'); w(8, p.lay || '0');
        continue;
      }
      if (ops.length === 2 && ops[1][0] === 1 && !p.closed && !p.w && !p.fill) {
        common('LINE', p, 'AcDbLine'); w(10, f6(ops[0][1])); w(20, f6(ops[0][2])); w(30, f6(ops[0][3] || 0)); w(11, f6(ops[1][1])); w(21, f6(ops[1][2])); w(31, f6(ops[1][3] || 0)); continue;
      }
      // LWPOLYLINE (yaylar bulge ile, elipsler örneklenerek)
      const verts = []; // [x,y,bulge]
      let lx = null, ly = null;
      const pushV = (x, y) => { if (lx !== null && Math.abs(x - lx) < 1e-12 && Math.abs(y - ly) < 1e-12) return; verts.push([x, y, 0]); lx = x; ly = y; };
      let subpaths = 0;
      for (const o of ops) {
        if (o[0] === 0) { if (verts.length) subpaths++; pushV(o[1], o[2]); }
        else if (o[0] === 1) pushV(o[1], o[2]);
        else if (o[0] === 2 || o[0] === -2) {
          const ccw = o[0] === 2; let d = ccw ? o[5] - o[4] : o[4] - o[5]; while (d <= 0) d += TAU; if (d > TAU) d = TAU;
          const sx = o[1] + o[3] * Math.cos(o[4]), sy = o[2] + o[3] * Math.sin(o[4]);
          if (lx === null || Math.hypot(sx - lx, sy - ly) > 1e-9) pushV(sx, sy);
          if (verts.length) verts[verts.length - 1][2] = (ccw ? 1 : -1) * Math.tan(d / 4);
          pushV(o[1] + o[3] * Math.cos(o[5]), o[2] + o[3] * Math.sin(o[5]));
        } else { const pts = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts); for (const q of pts) pushV(q[0], q[1]); }
      }
      if (subpaths > 0 && p.fill) { // çok parçalı tarama sınırı → her parça ayrı polyline
        const parts = []; let cur = null;
        for (const o of ops) { if (o[0] === 0) { cur = [[o[1], o[2], 0]]; parts.push(cur); } else if (cur) { const pts = o[0] === 1 ? [[o[1], o[2]]] : flatten([o]); for (const q of pts) cur.push([q[0], q[1], 0]); } }
        for (const part of parts) { common('LWPOLYLINE', p, 'AcDbPolyline'); w(90, part.length); w(70, 1); w(38, f6(zs[0])); for (const v of part) { w(10, f6(v[0])); w(20, f6(v[1])); } }
        continue;
      }
      if (verts.length < 2) continue;
      common('LWPOLYLINE', p, 'AcDbPolyline'); w(90, verts.length); w(70, p.closed || p.fill ? 1 : 0); if (p.w) w(43, f6(p.w)); w(38, f6(zs[0]));
      for (const v of verts) { w(10, f6(v[0])); w(20, f6(v[1])); if (v[2]) w(42, f6(v[2])); }
    } catch (e) { /* bu ilkeli atla */ }
  }
  w(0, 'ENDSEC');
  w(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
