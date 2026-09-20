/*
 * Düzenleme çekirdeği.
 *
 *  - Varlık tanımı (ent): kullanıcının çizdiği nesnelerin taşınabilir biçimi
 *      { type:'LINE'|'LWPOLYLINE'|'POLYLINE3D'|'CIRCLE'|'ARC'|'POINT'|'TEXT'|'3DFACE'
 *            |'SOLID'|'HATCH'|'CLOUD'|'DIMENSION'|'EXTRUDE'|'ATTDEF'|'WIPEOUT'|'INSERT' (blocks.js),
 *        pts:[[x,y,z]…], r, a0, a1, closed, text, h, rot, layer, color (ACI ya da -1),
 *        itype: bilgi türü üstüne yazımı (ör. ok başı SOLID ama bilgide DIMENSION görünsün),
 *        gid:   grup kimliği — aynı ölçülendirmenin / balonun bütün parçaları birlikte seçilir }
 *  - entToPrim(): tanımı çizilebilir ilkele çevirir (scene.js ilkel biçimi)
 *  - transformPrim(): ilkele 2B afin dönüşüm + kot dönüşümü (z * zs + dz) uygular
 *  - EditDoc: komut günlüğü (add/delete/xform/props/setz), geri al / yinele, kalıcılık
 *  - writeDxf(): sahne + düzenlemeler → ASCII DXF (AC1015); uygulamanın blok tanımları BLOCKS bölümüne, yerleştirmeleri
 *    INSERT (+ATTRIB) olarak, maskeler WIPEOUT olarak yazılır; DWG'den gelen ve benimsenmemiş yerleştirmeler patlatılmış kalır
 */
import { TAU, mul, apply, isSim, simScale, simRot, det, arcPts, ellipsePts, opsBBox, flatten, cloudOps, extrudeMesh, patternDefs, pointInPoly } from './geom.js';
import { FG, ACI, BYLAYER, BYBLOCK, normCi, isByLayer, resolveColor } from './scene.js';
import { transformDef } from './annot.js';
import { expandInsert, insMatrix, withMatrix, keyOf as blkKey, attrsFor, insFromInfo, decompose, xformEnts } from './blocks.js';

const R2D = 180 / Math.PI;
let seq = 0;
export const newId = () => 'E' + Date.now().toString(36) + (seq++).toString(36);

// ---------------------------------------------------------------------------------------
// Varlık tanımı → ilkel
// ---------------------------------------------------------------------------------------
export function entToPrim(ent, layers) {
  const lay = layers.get(ent.layer);
  /*
   * KATMANDAN (ByLayer) = 256. v7.92'ye kadar bu satır 256'yı hiç ele almıyordu: `256 <= 255`
   * yanlış olduğu için renk sessizce FG'ye düşüyor, yani "Katmandan" seçilen nesne katman
   * rengini DEĞİL sabit ön plan rengini alıyordu. Kusur nesne ent'inden her yeniden kurulduğunda
   * (yapıştırma, blok açılımı, replace, blocksync, patlatma) geri geliyordu. Karar artık
   * scene.resolveColor'dadır; ci de normalize edilerek saklanır, böylece aşağı akıştaki
   * "ci === 256" denetimleri -1 / null taşıyan nesneleri atlamaz.
   */
  const col = resolveColor(ent.color, lay ? lay.color : null);
  const info = { t: ent.type, h: ent.id, lay: ent.layer, ci: normCi(ent.color), col, lt: '', lw: lay ? lay.lw : 25, edited: true, text: ent.text };
  if (ent.itype) info.t = ent.itype;            // ok başı SOLID'dir ama ölçü süzgeci onu da gizlemelidir
  if (ent.gid || ent.group) info.gid = ent.gid || ent.group;   // grup: parçalar birlikte seçilir, birlikte silinir ('group' v7.76 öncesi belgelerde)
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
    case 'ATTDEF': {                                  // öznitelik tanımı: tanım düzenleyicide etiket (ya da öntanımlı değer) yazı olarak görünür
      const p = P[0]; if (!p) return null;
      const shown = ent.text != null && String(ent.text) !== '' ? String(ent.text) : (ent.tag || 'TAG');
      const h = ent.h || 2.5, lines = shown.split('\n');
      info.tag = ent.tag || ''; info.text = shown;
      const R = Math.hypot(Math.max(...lines.map(l => l.length)) * h * 0.75, h * (1 + 1.667 * (lines.length - 1)));
      return { ...base, k: 1, x: p[0], y: p[1], z: p[2] || 0, h, rot: ent.rot || 0, lines, ha: ent.ha || 0, va: ent.va || 0, ws: 1, obl: 0, spacing: 1, bb: [p[0] - R, p[1] - R, p[0] + R, p[1] + R] };
    }
    case 'WIPEOUT': {                                 // maske: arka plan rengiyle dolu kapalı çokgen; çizim sırasında altında kalanı örter
      if (P.length < 3) return null;
      const ops = P.map((p, i) => [i ? 1 : 0, p[0], p[1], p[2] || 0]);
      return { ...base, k: 0, ops, closed: true, fill: true, bg: true, alpha: 1, w: 0, bb: opsBBox(ops) };
    }
    case 'SOLID': {                                   // dolu çokgen: ok başı, işaret
      if (P.length < 3) return null;
      const ops = P.map((p, i) => [i ? 1 : 0, p[0], p[1], p[2] || 0]);
      return { ...base, k: 0, ops, closed: true, fill: true, alpha: ent.alpha == null ? 1 : ent.alpha, w: 0, bb: opsBBox(ops) };
    }
    case 'HATCH': {                                   // tarama; sınır kapalı çokgen (yaylı olabilir)
      // ent.ops varsa sınır YAY taşıyor demektir (daire / yay kenarlı tarama): kirişlenmiş pts
      // yerine ham işlem dizisi kullanılır, böylece yay budamada da DXF'te de yay kalır.
      const hamOps = Array.isArray(ent.ops) && ent.ops.length >= 2 ? ent.ops.filter(Array.isArray).map(o => o.slice()) : null;
      if (!hamOps && P.length < 3) return null;
      const ops = hamOps || P.map((p, i) => [i ? 1 : 0, p[0], p[1], p[2] || 0]);
      const ad = String(ent.pattern || 'SOLID').toUpperCase();
      const dolu = ad === 'SOLID';
      info.pattern = ent.pattern || 'SOLID'; info.solid = dolu;
      info.hscale = ent.hscale == null ? 1 : ent.hscale; info.hangle = ent.hangle == null ? 0 : ent.hangle;   // DXF kod 41 / 52
      // Tarama künyesi (ada kipi, desen türü, çift, piksel boyu, kot, tohum, geçiş, ilmek bayrakları) ve
      // dosyanın kendi desen tanım satırları: bloğa / panoya alınıp geri konan tarama da AutoCAD'e aynı çıkar
      if (ent.hrec && typeof ent.hrec === 'object') info.hrec = ent.hrec;
      if (Array.isArray(ent.hdefs) && ent.hdefs.length) info.hdefs = ent.hdefs;
      /*
       * Desenli tarama İKİ ilkelden oluşur: SINIR ve desen çizgileri. Ayrı tutulmalarının bir sebebi
       * YAZMA'dır (çizgiler DXF'e ayrıca LWPOLYLINE olarak çıkmamalı; hpart onları süzer), öteki sebep
       * UZAKLIK DÜZEYİ'dir: desen aralığı ekranda 2 px'in altına inince render.js çizgileri değil
       * sınırın SAYDAM DOLGUSUNU çizer. Bu dolgu olmadan uzaklaşınca tarama ekrandan tümden kaybolur —
       * dosyadan okunan taramada da aynı düzen vardır (scene.js hpFill).
       */
      const pr = { ...base, k: 0, ops, closed: true, fill: true, alpha: dolu ? (ent.alpha == null ? 1 : ent.alpha) : 0.18, w: 0, bb: opsBBox(ops) };
      if (!dolu && ent.hp != null) pr.hpFill = ent.hp;
      return pr;
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
      if (ent.bg) pr.bg = true;                       // maske (WIPEOUT) yolu: arka plan rengiyle dolar
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

/** Varlık → ilkel(ler): INSERT tanım tablosuyla genişletilir (blocks.expandInsert, ortak info), ötekiler tek ilkeldir */
export function entsToPrims(ent, layers, blocks) {
  if (ent && ent.type === 'INSERT') return blocks ? expandInsert(ent, blocks, layers) : [];
  const p = entToPrim(ent, layers);
  return p ? [p] : [];
}

// ---------------------------------------------------------------------------------------
// İlkel dönüşümleri
// ---------------------------------------------------------------------------------------
/*
 * İlkeli 2B afin m ile dönüştürür ve kotu z' = z * zs + dz kuralıyla taşır; yerinde değiştirir.
 *
 * zs NEDEN VAR: üç boyutlu ÖLÇEKLE komutu bir cismi X ve Y'de büyütüp Z'de olduğu gibi bırakamaz —
 * cisim eğrilir. zs (öntanımlı 1) kotu da aynı çarpanla büyütür; taban kotunun yerinde kalması için
 * çağıran dz = z0 * (1 - zs) verir. zs = 1 iken davranış eskisiyle BİREBİR aynıdır.
 */
export function transformPrim(p, m, dz = 0, zs = 1) {
  if (p.k === 5) {                                    // ağ ilkeli: köşe ve kenar dizileri yerinde dönüştürülür
    const V = p.vtx, G = p.seg;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const put = (a, i, q, z) => { a[i] = q[0]; a[i + 1] = q[1]; a[i + 2] = z; if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; };
    for (let i = 0; i + 2 < V.length; i += 3) put(V, i, apply(m, V[i], V[i + 1]), V[i + 2] * zs + dz);
    for (let i = 0; i + 2 < G.length; i += 3) put(G, i, apply(m, G[i], G[i + 1]), G[i + 2] * zs + dz);
    if (isFinite(x0)) p.bb = [x0, y0, x1, y1];
    if (p.zmin != null) { p.zmin = p.zmin * zs + dz; p.zmax = p.zmax * zs + dz; }
    return;
  }
  if (p.k === 0) {
    let out;
    if (isSim(m)) {
      const s = simScale(m), r = simRot(m);
      out = p.ops.map(o => {
        if (o[0] === 0 || o[0] === 1) { const q = apply(m, o[1], o[2]); return [o[0], q[0], q[1], o[3] != null ? o[3] * zs + dz : undefined]; }
        if (o[0] === 2 || o[0] === -2) { const q = apply(m, o[1], o[2]); return [o[0], q[0], q[1], o[3] * s, o[4] + r, o[5] + r, o[6] != null ? o[6] * zs + dz : undefined]; }
        const q = apply(m, o[1], o[2]); return [3, q[0], q[1], o[3] * s, o[4] * s, o[5] + r, o[6], o[7]];
      });
    } else {
      const mirror = det(m) < 0;
      out = [];
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) { const q = apply(m, o[1], o[2]); out.push([o[0], q[0], q[1], o[3] != null ? o[3] * zs + dz : undefined]); continue; }
        if ((o[0] === 2 || o[0] === -2) && mirror && Math.abs(Math.abs(m[0]) - Math.abs(m[3])) < 1e-9) {
          // aynalama: yay yönü değişir
          const q = apply(m, o[1], o[2]);
          const s = Math.hypot(m[0], m[1]);
          const a0 = Math.atan2(m[1] * Math.cos(o[4]) + m[3] * Math.sin(o[4]), m[0] * Math.cos(o[4]) + m[2] * Math.sin(o[4]));
          const a1 = Math.atan2(m[1] * Math.cos(o[5]) + m[3] * Math.sin(o[5]), m[0] * Math.cos(o[5]) + m[2] * Math.sin(o[5]));
          out.push([-o[0], q[0], q[1], o[3] * s, a0, a1, o[6] != null ? o[6] * zs + dz : undefined]);
          continue;
        }
        const pts = [];
        if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], pts);
        else if (o[0] === -2) { arcPts(o[1], o[2], o[3], o[5], o[4], pts); pts.reverse(); }
        else ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
        for (let i = 0; i < pts.length; i++) { const q = apply(m, pts[i][0], pts[i][1]); out.push([out.length ? 1 : 0, q[0], q[1], o[6] != null ? o[6] * zs + dz : undefined]); }
      }
    }
    p.ops = out; p.bb = opsBBox(out);
    if (p.w) p.w *= Math.sqrt(Math.abs(det(m)));
  } else if (p.k === 1) {
    const q = apply(m, p.x, p.y); p.x = q[0]; p.y = q[1];
    const s = Math.sqrt(Math.abs(det(m))); p.h *= s; p.rot += Math.atan2(m[1], m[0]);
    if (p.z != null) p.z = p.z * zs + dz;
    const R = Math.hypot(Math.max(...p.lines.map(l => l.length)) * p.h * 0.75 * p.ws, p.h * (1 + 1.667 * (p.lines.length - 1)));
    p.bb = [p.x - R, p.y - R, p.x + R, p.y + R];
  } else if (p.k === 2 || p.k === 4) {
    const q = apply(m, p.x, p.y); p.x = q[0]; p.y = q[1]; if (p.z != null) p.z = p.z * zs + dz; p.bb = [p.x, p.y, p.x, p.y];
  } else if (p.k === 3) {
    p.quad = p.quad.map(c => apply(m, c[0], c[1])); p.bb = [Math.min(...p.quad.map(c => c[0])), Math.min(...p.quad.map(c => c[1])), Math.max(...p.quad.map(c => c[0])), Math.max(...p.quad.map(c => c[1]))];
  }
  if (p.ent) { // tanım da güncellensin
    p.ent.pts = (p.ent.pts || []).map(q => { const r = apply(m, q[0], q[1]); return [r[0], r[1], (q[2] || 0) * zs + dz]; });
    if (p.ent.r) p.ent.r *= Math.sqrt(Math.abs(det(m)));
    if (p.ent.type === 'ARC') { const r = Math.atan2(m[1], m[0]); p.ent.a0 += r; p.ent.a1 += r; }
    if (p.ent.type === 'TEXT') p.ent.rot = (p.ent.rot || 0) + Math.atan2(m[1], m[0]);
    if (p.ent.def) {
      // Ölçü tanımı da taşınır / döner / ölçeklenir ki özellikler sonradan düzenlenince yeniden kurulan
      // ölçü geometrinin yeni yerine otursun (annot.transformDef: yatay / düşey / dönük doğrultu da döner).
      const s = Math.sqrt(Math.abs(det(m)));
      p.ent = { ...p.ent, def: transformDef(p.ent.def, q => { const w = apply(m, q[0], q[1]); return [w[0], w[1], (q[2] || 0) * zs + dz]; }, s, [m[0], m[1], m[2], m[3]]) };
      // ölçülen değer de ölçeklenir (açı ölçüsü derecedir, ölçekten etkilenmez) — bilgi paneli bayat kalmasın
      if (typeof p.ent.measure === 'number' && !(Array.isArray(p.ent.arcs) && p.ent.arcs.length)) p.ent.measure *= s;
    }
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
/*
 * Katman görünürlüğü TÜRETİLİR: kapalı ya da donuk değilse ve izolasyon gizlemiyorsa görünür
 * (display.syncLayerVisible ile aynı kural; edit.js ekran modülünü içe almaz). Geri almada da
 * bu kural uygulanır — anlık görüntüdeki eski "visible" değeri geri YÜKLENMEZ: izolasyon
 * sırasında kapatılan katman, izolasyon kalktıktan sonra geri alınınca görünür olmalıdır.
 * isoHidden (izolasyon), faded (soldurma) ve count geçici / türetilmiş alanlardır; geri alma
 * onlara dokunmaz.
 */
const katmanGorunur = (l) => { l.visible = !l.off && !l.frozen && !l.isoHidden; return l.visible; };
const GECICI = (l) => ({ isoHidden: l.isoHidden, faded: l.faded, count: l.count });

/*
 * GERİ ALMA HAFIZASI: 10 geri, 10 ileri (kullanıcı kararı). Onbirinci komutta en eski geri alma
 * adımı düşer — komut günlükte kalır (dosya yeniden açılınca yine uygulanır, DXF'e yazılır), yalnız
 * geri alınamaz olur. Yinele yığını da aynı derinliktedir: on birinci geri alınan adım yinelenemez.
 */
export const UNDO_DEPTH = 10;
/*
 * PAYLAŞILAN BİLGİ NESNESİ. Bir blok yerleştirmesinin bütün ilkelleri AYNI info nesnesini taşır (scene.js ve
 * blocks.expandInsert sözleşmesi); ilkel başına { ...info } kopyalamak bu bağı koparır ve öznitelik / dinamik
 * parametre düzenlemesi yalnız bir ilkele işlerdi. Bu yüzden bir komut içinde her eski info için TEK yeni info
 * üretilir (Map ile) ve paylaşım korunur. Yerleştirme bilgisine matris düzeltmesi de burada uygulanır.
 */
function infoMapper(extra, insFn, ps) {
  const map = new Map(), canon = new Map();
  // Yerleştirme bilgisi TANITICIYA (h) göre tek kez üretilir: geometri ilkelinin bilgisi esastır, ekleme noktası işareti (k=4)
  // ve eski bir dosyada ayrışmış kopyalar aynı yeni nesneyi alır — grup hiçbir işlemde ayrışamaz
  if (ps) { for (const p of ps) { const i = p.info; if (i && i.t === 'INSERT' && i.h && p.k !== 4 && !canon.has(i.h)) canon.set(i.h, i); } for (const p of ps) { const i = p.info; if (i && i.t === 'INSERT' && i.h && !canon.has(i.h)) canon.set(i.h, i); } }
  return (info) => {
    if (!info) return info;
    const ins = info.t === 'INSERT' && info.h ? 'h:' + info.h : null;
    let n = map.get(ins || info);
    if (!n) { const src = ins ? (canon.get(info.h) || info) : info; n = { ...src, ...extra }; if (ins && typeof insFn === 'function') n = insFn(n) || n; map.set(ins || info, n); }
    return n;
  };
}
/** Yerleştirme bilgisinin matrisini m ile çarpar (x, y, rot, sx, sy türetilir); kot z' = z * zs + dz olur */
function insXform(info, m, dz, zs = 1) {
  const w = withMatrix({ z: info.z }, mul(m, insMatrix(info)), dz, zs);
  return { ...info, m: w.m, x: w.x, y: w.y, z: w.z, rot: w.rot, sx: w.sx, sy: w.sy };
}
/** Yerleştirme grupları: tanıtıcı (info.h) başına { info, prims } — taşınmış eski dosyalarda info nesneleri kopyalanmış olabilir, tanıtıcı bağlar */
function insGroups(C, filter) {
  const map = new Map();
  for (const p of C.prims()) {
    const i = p.info;
    if (!i || i.t !== 'INSERT' || !i.h || !i.name) continue;
    if (filter && !filter(i, p)) continue;
    let g = map.get(i.h); if (!g) { g = { info: i, prims: [] }; map.set(i.h, g); }
    g.prims.push(p);
  }
  return [...map.values()];
}
/*
 * YERLEŞTİRMELERİ TANIMDAN YENİDEN GENİŞLETME (BSAVE, REFCLOSE, ATTSYNC, BLOCKREPLACE, dinamik değer). Eski ilkeller
 * çıkar, yeni genişletme grubun ilk ilkelinin yerine girer (çizim sırası korunur); öznitelik değerleri etikete göre
 * taşınır. DWG'den gelen (düzleştirilmiş) yerleştirme de bu yolla uygulama yerleştirmesine döner (info.blk, matris
 * x-y-rot-sx-sy'den, taban 0). Dizi YERİNDE değiştirilir (S.prims aynı diziyi paylaşır); geri alma eski içeriği
 * geri yazar. infoFn eski info'dan yenisini üretir (ad, dinamik değer).
 */
function resyncGroups(C, groups, infoFn) {
  const arr = C.prims(), old = arr.slice();
  const member = new Map(), plans = [];
  for (const g of groups) {
    const ni = infoFn ? infoFn(g.info) : g.info;          // önce yeni bilgi (BLOCKREPLACE'te yeni ad), tanım ona göre bulunur
    const def = C.blocks.get(blkKey(ni.name));
    if (!def || !g.prims.length) continue;
    const ins = insFromInfo({ ...ni, name: def.name });
    ins.attrs = attrsFor(def, ni.attrs);
    const fresh = expandInsert(ins, C.blocks, C.layers);
    if (!fresh.length) continue;
    const plan = { prims: fresh, done: false };
    plans.push(plan);
    for (const p of g.prims) member.set(p, plan);
  }
  if (!plans.length) return null;
  const out = [];
  for (const p of old) { const pl = member.get(p); if (!pl) { out.push(p); continue; } if (!pl.done) { pl.done = true; for (const q of pl.prims) out.push(q); } }
  arr.length = 0; for (const p of out) arr.push(p);
  return () => { arr.length = 0; for (const p of old) arr.push(p); };
}
export class EditDoc {
  /**
   * @param ctx { prims:()=>array, layers:Map, blocks:Map (blok tanımları, blocks.js), vars:{} (başlık değişkenleri: INSBASE), insert:(prim, at)=>void, remove:(prim)=>index, rebuild:()=>void, store:{get,set}, key:string }
   */
  constructor(ctx) {
    this.ctx = ctx;
    if (!(ctx.blocks instanceof Map)) ctx.blocks = new Map();
    if (!ctx.vars || typeof ctx.vars !== 'object') ctx.vars = {};
    this.log = [];      // kalıcı komutlar
    this.undoStack = []; // { cmd, restore:() => void }
    this.redoStack = [];
  }
  get dirty() { return this.log.length > 0; }
  find(keys) {
    const set = new Set(keys);
    return this.ctx.prims().filter(p => set.has(p.key));
  }
  /**
   * Anahtarlarla bulunan ilkeller + dokundukları YERLEŞTİRME gruplarının bütün üyeleri (ekleme noktası işareti k=4 dâhil).
   * Yerleştirme AutoCAD'de tek nesnedir: seçim hangi parçasını tutarsa tutsun taşıma, silme, kopyalama, özellik ve
   * çizim sırası bütün gruba gider; işaret geride kalıp bilgisi eskiyemez. Önce anahtarla istenenler (copy / array'de
   * newKeys sırayla bunlarla eşleşir), sonra grubun kalanı döner.
   */
  findWhole(keys) {
    const set = new Set(keys), all = this.ctx.prims(), hs = new Set();
    for (const p of all) if (set.has(p.key) && p.info && p.info.t === 'INSERT' && p.info.h) hs.add(p.info.h);
    if (!hs.size) return all.filter(p => set.has(p.key));
    const found = [], extra = [];
    for (const p of all) { if (set.has(p.key)) found.push(p); else if (p.info && p.info.t === 'INSERT' && hs.has(p.info.h)) extra.push(p); }
    return found.concat(extra);
  }
  /** komutu uygular, günlüğe yazar */
  run(cmd, opts = {}) {
    const restore = this.apply(cmd);
    if (!restore) return false;
    this.log.push(cmd);
    this.undoStack.push({ cmd, restore });
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
    if (!opts.silent) this.save();
    this._katmanSonrasi(cmd);
    return true;
  }
  /** Katman işlemleri (layer*, layerbulk) sahne önbelleğini ve katman listesini etkiler: çağırana haber verir */
  _katmanSonrasi(cmd) {
    if (cmd && typeof cmd.op === 'string' && cmd.op.startsWith('layer') && typeof this.ctx.layersChanged === 'function') {
      try { this.ctx.layersChanged(cmd); } catch (_) { /* arayüz yoksa geç */ }
    }
  }
  apply(cmd) {
    const C = this.ctx;
    switch (cmd.op) {
      case 'add': {
        const created = [];
        for (const ent of cmd.ents) for (const p of entsToPrims(ent, C.layers, C.blocks)) { C.insert(p); created.push(p); }
        if (!created.length) return null;
        C.rebuild();
        return () => { for (const p of created) C.remove(p); C.rebuild(); };
      }
      case 'delete': {
        const ps = this.findWhole(cmd.keys);
        if (!ps.length) return null;
        const removed = ps.map(p => ({ p, at: C.remove(p) }));
        C.rebuild();
        return () => { for (const r of removed.reverse()) C.insert(r.p, r.at); C.rebuild(); };
      }
      /*
       * YENİDEN KURMA: bir grubun (ölçülendirme) eski parçaları silinir, yenileri eklenir — TEK geri
       * alma adımı. Ölçü özellikleri düzenlenince tanımdan yeniden üretilen parçalar buradan geçer.
       */
      case 'replace': {
        const ps = this.find(cmd.keys || []);
        const removed = ps.map(p => ({ p, at: C.remove(p) }));
        const created = [];
        for (const ent of cmd.ents || []) for (const p of entsToPrims(ent, C.layers, C.blocks)) { C.insert(p); created.push(p); }
        if (!removed.length && !created.length) return null;
        C.rebuild();
        return () => { for (const p of created) C.remove(p); for (const r of removed.slice().reverse()) C.insert(r.p, r.at); C.rebuild(); };
      }
      case 'xform': {
        const ps = this.findWhole(cmd.keys);
        if (!ps.length) return null;
        const snaps = ps.map(p => clonePrim(p));
        const zs = cmd.zs == null ? 1 : cmd.zs;   // kot çarpanı (3B ölçekle); 1 = eski davranış
        const ni = infoMapper({ edited: true }, (i) => insXform(i, cmd.m, cmd.dz || 0, zs), ps);   // yerleştirme matrisi de döner / ölçeklenir / yansır
        for (const p of ps) { transformPrim(p, cmd.m, cmd.dz || 0, zs); p.info = ni(p.info); }
        C.rebuild();
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); C.rebuild(); };
      }
      case 'copy': {
        const ps = this.findWhole(cmd.keys);
        if (!ps.length) return null;
        // Kopyalanan grup (ölçülendirme, balon) YENİ bir grup kimliği alır: kopya ile aslı birlikte seçilmesin
        const gmap = new Map(), imap = new Map(), nk = cmd.newKeys || [], zs = cmd.zs == null ? 1 : cmd.zs;
        const created = ps.map((p, i) => {
          const c = clonePrim(p);
          const ih = p.info && p.info.t === 'INSERT' && p.info.h ? p.info.h : null;
          // anahtarla istenmeyen grup üyesi (ekleme noktası işareti): anahtarı yeni tanıtıcıdan türer — yeniden oynatmada da aynı
          c.key = i < nk.length ? nk[i] : (ih && imap.has(ih) ? imap.get(ih).h + (p.k === 4 ? '#ins' : '#e' + i) : newId());
          // Yerleştirme ilkelleri ortak info'yu paylaşmayı sürdürür; kopyanın tanıtıcısı grubun İLK yeni anahtarıdır (yeniden oynatmada da aynı)
          if (ih) { let ni = imap.get(ih); if (!ni) { ni = insXform({ ...p.info, h: c.key, edited: true }, cmd.m, cmd.dz || 0, zs); imap.set(ih, ni); } c.info = ni; }
          else { c.info = { ...p.info, h: c.key, edited: true }; if (c.info.gid) { if (!gmap.has(c.info.gid)) gmap.set(c.info.gid, newId()); c.info.gid = gmap.get(c.info.gid); } }
          if (c.ent) { c.ent = { ...c.ent, id: c.key, ...(c.ent.gid && !(p.info && p.info.t === 'INSERT') ? { gid: c.info.gid } : {}) }; }
          transformPrim(c, cmd.m, cmd.dz || 0, zs); C.insert(c); return c;
        });
        C.rebuild();
        return () => { for (const p of created) C.remove(p); C.rebuild(); };
      }
      case 'setz': {
        const ps = this.findWhole(cmd.keys);
        if (!ps.length) return null;
        const snaps = ps.map(p => clonePrim(p));
        const ni = infoMapper({ edited: true }, (i) => ({ ...i, z: cmd.z }), ps);
        for (const p of ps) { setPrimZ(p, cmd.z); p.info = ni(p.info); }
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); };
      }
      case 'props': {
        const ps = this.findWhole(cmd.keys);
        if (!ps.length) return null;
        const snaps = ps.map(p => ({ lay: p.lay, col: p.col, lt: p.lt, lw: p.lw, info: p.info, ent: p.ent }));
        const imap = new Map();   // yerleştirme ilkelleri ortak info'yu paylaşmayı sürdürür
        for (const p of ps) {
          const lay = cmd.layer ? C.layers.get(cmd.layer) : null;
          if (cmd.layer) p.lay = cmd.layer;
          if (cmd.lt !== undefined) p.lt = cmd.lt || null;   // '' / null = katmandan (ByLayer); anahtar LTYPE tablosunun büyük harfli adı
          if (cmd.lw !== undefined) { const L2 = C.layers.get(p.lay); p.lw = cmd.lw >= 0 ? cmd.lw : (L2 ? L2.lw : 25); }   // −1 = katmandan (ByLayer)
          if (cmd.color != null) p.col = resolveColor(cmd.color, C.layers.get(p.lay) ? C.layers.get(p.lay).color : null);
          else if (lay && (p.info && isByLayer(p.info.ci))) p.col = lay.color;
          const old = p.info;
          let ni = old ? imap.get(old) : null;
          if (!ni) { ni = { ...p.info, lay: p.lay, ci: normCi(cmd.color != null ? cmd.color : (p.info ? p.info.ci : BYLAYER)), col: p.col, lt: cmd.lt !== undefined ? (cmd.lt || '') : (p.info ? p.info.lt : ''), ...(cmd.lw !== undefined ? { lw: p.lw } : {}), edited: true }; if (old) imap.set(old, ni); }
          p.info = ni;
          if (p.ent) p.ent = { ...p.ent, layer: p.lay, color: cmd.color != null ? cmd.color : p.ent.color, ...(cmd.lt !== undefined ? { linetype: cmd.lt || 'BYLAYER' } : {}) };
        }
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); };
      }
      case 'layer': {
        if (C.layers.has(cmd.name)) return null;
        C.layers.set(cmd.name, { name: cmd.name, color: resolveColor(cmd.color, null), lt: cmd.lt || 'Continuous', lw: cmd.lw == null ? 25 : cmd.lw, frozen: false, off: false, locked: false, visible: true, count: 0, added: true });
        return () => { C.layers.delete(cmd.name); };
      }
      /*
       * TOPLU KATMAN DURUMU. AutoCAD'in Layer Properties Manager'ındaki ampul / kar tanesi / kilit
       * sütunları ve LAYON, LAYOFF, LAYFRZ, LAYTHW, LAYLCK, LAYULK komutları buradan geçer: birden
       * çok katmanın açık/kapalı, donuk/çözük, kilitli/açık durumu TEK geri alma adımında değişir.
       * Görünürlük TÜRETİLİR (kapalı ya da donuk değilse ve izolasyon gizlemiyorsa görünür); doğrudan
       * yazılmaz, böylece izolasyon (geçici) ile katman durumu (kalıcı, DXF'e yazılan) karışmaz.
       */
      case 'layerbulk': {
        const items = Array.isArray(cmd.items) ? cmd.items : [];
        const onceki = [];
        for (const it of items) {
          const l = it && C.layers.get(it.name); if (!l) continue;
          onceki.push({ l, off: !!l.off, frozen: !!l.frozen, locked: !!l.locked, edited: l.edited });
          if (it.off != null) l.off = !!it.off;
          if (it.frozen != null) l.frozen = !!it.frozen;
          if (it.locked != null) l.locked = !!it.locked;
          katmanGorunur(l);
          l.edited = true;
        }
        if (!onceki.length) return null;
        return () => { for (const o of onceki) { o.l.off = o.off; o.l.frozen = o.frozen; o.l.locked = o.locked; o.l.edited = o.edited; katmanGorunur(o.l); } };
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
        if (cmd.color != null) l.color = resolveColor(cmd.color, null);
        if (cmd.lt != null) l.lt = cmd.lt;
        if (cmd.lw != null) l.lw = cmd.lw;
        if (cmd.frozen != null) { l.frozen = !!cmd.frozen; katmanGorunur(l); }
        if (cmd.off != null) { l.off = !!cmd.off; katmanGorunur(l); }
        if (cmd.locked != null) l.locked = !!cmd.locked;
        l.edited = true;
        // Katman rengiyle çizilen nesneler (colorIndex 256) yeni rengi almalı
        if (cmd.color != null) for (const p of eskiRenkler.keys()) if (p.info && isByLayer(p.info.ci)) p.col = l.color;
        if (yeniAd) {
          C.layers.delete(cmd.name);
          l.name = yeniAd;
          C.layers.set(yeniAd, l);
          for (const p of etkilenen) { p.lay = yeniAd; if (p.info) p.info = { ...p.info, lay: yeniAd }; if (p.ent) p.ent = { ...p.ent, layer: yeniAd }; }
        }
        return () => {
          if (yeniAd) { C.layers.delete(yeniAd); for (const p of etkilenen) { p.lay = cmd.name; if (p.info) p.info = { ...p.info, lay: cmd.name }; if (p.ent) p.ent = { ...p.ent, layer: cmd.name }; } }
          C.layers.set(cmd.name, Object.assign(l, onceki, GECICI(l))); katmanGorunur(l);
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
          for (const p of icerik) { p.lay = '0'; if (p.info) p.info = { ...p.info, lay: '0' }; if (p.ent) p.ent = { ...p.ent, layer: '0' }; if (p.info && isByLayer(p.info.ci) && sifir) p.col = sifir.color; }
        }
        C.layers.delete(cmd.name);
        return () => {
          C.layers.set(cmd.name, Object.assign(l, onceki, { faded: l.faded, isoHidden: false })); katmanGorunur(l);   // silinmişken izolasyon değişmiş olabilir: bayat isoHidden taşınmaz
          if (kip === 'ents' && silinen) { const arr = this.ctx.prims(); for (const { p, i } of silinen) arr.splice(Math.min(i, arr.length), 0, p); }
          else for (const p of icerik) { p.lay = cmd.name; if (p.info) p.info = { ...p.info, lay: cmd.name }; if (p.ent) p.ent = { ...p.ent, layer: cmd.name }; if (p.info && isByLayer(p.info.ci)) p.col = l.color; }
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
        const ps = this.findWhole(cmd.keys);
        if (!ps.length) return null;
        const created = [];
        for (const it of cmd.items || []) {
          const imap = new Map(), nk = it.newKeys || [], gmap = new Map();
          ps.forEach((p, i) => {
            const c = clonePrim(p);
            const ih = p.info && p.info.t === 'INSERT' && p.info.h ? p.info.h : null;
            c.key = i < nk.length ? nk[i] : (ih && imap.has(ih) ? imap.get(ih).h + (p.k === 4 ? '#ins' : '#e' + i) : newId());
            if (ih) { let ni = imap.get(ih); if (!ni) { ni = insXform({ ...p.info, h: c.key, edited: true }, it.m, it.dz || 0); imap.set(ih, ni); } c.info = ni; }   // yerleştirme: ortak info, tek tanıtıcı
            else {
              c.info = { ...p.info, h: c.key, edited: true };
              // Dizinin her kopyası YENİ bir grup kimliği alır ('copy' dalındaki kuralla aynı):
              // yoksa bütün kopyalar aslıyla aynı gruba girer ve birine dokunmak hepsini seçerdi.
              if (c.info.gid) { if (!gmap.has(c.info.gid)) gmap.set(c.info.gid, newId()); c.info.gid = gmap.get(c.info.gid); }
            }
            if (c.ent) c.ent = { ...c.ent, id: c.key, ...(c.ent.gid && !ih ? { gid: c.info.gid } : {}) };
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
          // uygulama yerleştirmesinde yazı ilkeli öznitelik indisini taşır (p.ai; görünmeyen öznitelik yazı üretmez → sıra kayar), DWG'de sıra
          const target = texts.some(q => q.ai != null) ? texts.find(q => q.ai === it.i) : texts[it.i];
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
        const marks = group.filter(p => p.k === 4).map(p => ({ p, at: C.remove(p) }));   // ekleme noktası işareti bloğa aitti: patlayınca kalkar
        group.forEach((p, i) => {
          if (p.k === 4) return;
          const id = (cmd.ids && cmd.ids[i]) || (cmd.h + '_x' + i);
          p.key = id;
          p.info = { ...p.info, t: p.et || 'LINE', h: id, name: undefined, attrs: undefined, blk: undefined, m: undefined, dyn: undefined, exploded: true, edited: true };
        });
        C.rebuild();
        return () => { for (const sN of snaps) { sN.p.info = sN.info; sN.p.key = sN.key; } for (const r of marks.slice().reverse()) C.insert(r.p, r.at); C.rebuild(); };
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
          if (typeof it.w === 'number' && it.w >= 0) p.w = it.w;   // polyline genişliği (Özellikler paleti)
          p.bb = opsBBox(p.ops);
          p.info = { ...p.info, edited: true };
          // p.ent ile p.ops ayrışmamalı: blok kitaplığı, pano ve bilgi paneli ent'i okur.
          if (p.ent) {
            const duz = p.ops.every(o => o[0] === 0 || o[0] === 1);
            if (duz && (p.ent.type === 'LINE' || p.ent.type === 'LWPOLYLINE' || p.ent.type === 'POLYLINE3D')) {
              p.ent = { ...p.ent, type: p.ops.length === 2 ? p.ent.type : (p.ent.type === 'LINE' ? 'LWPOLYLINE' : p.ent.type), pts: p.ops.map(o => [o[1], o[2], o[3] || 0]), closed: !!p.closed, ...(typeof it.w === 'number' ? { width: p.w } : {}) };
            } else {
              p.ent = { ...p.ent, type: 'PATH', ops: p.ops.map(o => o.slice()), closed: !!p.closed, ...(typeof it.w === 'number' ? { width: p.w } : {}) };
            }
          }
        }
        C.rebuild();
        return () => { ps.forEach((p, i) => Object.assign(p, snaps[i])); C.rebuild(); };
      }
      /*
       * BLOK TABLOSU. Tanım komutları yalnız tabloyu değiştirir; yerleştirmelerin yeniden genişletilmesi ayrı bir
       * komuttur (blocksync) ve çağıran ikisini 'group' ile tek geri alma adımı yapar. Tanım komut günlüğünde
       * durur: dosya yeniden açılınca tablo günlükten kurulur, DXF'e BLOCKS bölümü olarak yazılır.
       */
      case 'blockdef': {
        const key = blkKey(cmd.name);
        if (!key || !cmd.def || typeof cmd.def !== 'object') return null;
        const old = C.blocks.get(key) || null;
        C.blocks.set(key, { ...cmd.def, name: cmd.def.name || String(cmd.name).trim(), base: Array.isArray(cmd.def.base) ? cmd.def.base : [0, 0, 0], ents: Array.isArray(cmd.def.ents) ? cmd.def.ents : [] });
        return () => { if (old) C.blocks.set(key, old); else C.blocks.delete(key); };
      }
      case 'blockdel': {
        const key = blkKey(cmd.name), old = C.blocks.get(key);
        if (!old) return null;
        C.blocks.delete(key);
        return () => { C.blocks.set(key, old); };
      }
      case 'blockrename': {
        const key = blkKey(cmd.name), nk = blkKey(cmd.newName), def = C.blocks.get(key);
        if (!def || !nk || nk === key || C.blocks.has(nk)) return null;
        const ad = String(cmd.newName).trim();
        C.blocks.delete(key); C.blocks.set(nk, { ...def, name: ad });
        const touched = [], ni = infoMapper({ name: ad });
        for (const p of C.prims()) if (p.info && p.info.t === 'INSERT' && blkKey(p.info.name) === key) { touched.push([p, p.info]); p.info = ni(p.info); }
        return () => { C.blocks.delete(nk); C.blocks.set(key, def); for (const [p, i] of touched) p.info = i; };
      }
      case 'blocksync': {
        const names = new Set((cmd.names || (cmd.name ? [cmd.name] : [])).map(blkKey));
        const groups = insGroups(C, (i) => (!names.size || names.has(blkKey(i.name))) && C.blocks.has(blkKey(i.name)) && (cmd.h == null || i.h === cmd.h));
        const r = resyncGroups(C, groups, null);
        if (!r) return null;
        C.rebuild();
        return () => { r(); C.rebuild(); };
      }
      case 'blockreplace': {
        const from = blkKey(cmd.from), to = C.blocks.get(blkKey(cmd.to));
        if (!to || !from) return null;
        const r = resyncGroups(C, insGroups(C, (i) => blkKey(i.name) === from), (i) => ({ ...i, name: to.name }));
        if (!r) return null;
        C.rebuild();
        return () => { r(); C.rebuild(); };
      }
      case 'dynset': {
        // dinamik parametre değeri: yerleştirmede saklanır, ilkeller yeniden genişletilir
        const r = resyncGroups(C, insGroups(C, (i) => i.h === cmd.h && C.blocks.has(blkKey(i.name))), (i) => ({ ...i, dyn: { ...(i.dyn || {}), ...(cmd.values || {}) } }));
        if (!r) return null;
        C.rebuild();
        return () => { r(); C.rebuild(); };
      }
      /*
       * ÇİZİM SIRASI (AutoCAD DRAWORDER / TEXTTOFRONT / HATCHTOBACK). İlkel dizisinin sırası çizim sırasıdır: sonda
       * olan üstte görünür. Seçilenler kendi aralarındaki sırayı koruyarak öne (sona), arkaya (başa), bir
       * nesnenin üstüne ya da altına alınır. Geri alma dizinin eski sırasını geri yazar.
       */
      case 'draworder': {
        const arr = C.prims(), set = new Set(this.findWhole(cmd.keys || []));
        if (!set.size) return null;
        const old = arr.slice();
        const moving = old.filter(p => set.has(p)), rest = old.filter(p => !set.has(p));
        let out;
        if (cmd.mode === 'back') out = moving.concat(rest);
        else if (cmd.mode === 'above' || cmd.mode === 'below') {
          const ri = rest.findIndex(p => p.key === cmd.ref);
          if (ri < 0) return null;
          const i = ri + (cmd.mode === 'above' ? 1 : 0);
          out = rest.slice(0, i).concat(moving, rest.slice(i));
        } else out = rest.concat(moving);
        arr.length = 0; for (const p of out) arr.push(p);
        C.rebuild();
        return () => { arr.length = 0; for (const p of old) arr.push(p); C.rebuild(); };
      }
      /** Başlık değişkenleri (BASE → $INSBASE): DXF'e yazılır, günlükte durur */
      case 'vars': {
        if (!cmd.set || typeof cmd.set !== 'object') return null;
        const prev = {};
        for (const k of Object.keys(cmd.set)) { prev[k] = C.vars[k]; C.vars[k] = cmd.set[k]; }
        return () => { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete C.vars[k]; else C.vars[k] = prev[k]; } };
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
    if (this.redoStack.length > UNDO_DEPTH) this.redoStack.shift();
    this.save();
    this._katmanSonrasi(u.cmd);
    return true;
  }
  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    const restore = this.apply(cmd);
    if (restore) { this.log.push(cmd); this.undoStack.push({ cmd, restore }); if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift(); }
    this.save();
    this._katmanSonrasi(cmd);
    return true;
  }
  save() { if (this.ctx.key) this.ctx.store.set('edits:' + this.ctx.key, JSON.stringify(this.log)); }
  /** kayıtlı günlüğü yeniden uygular */
  load() {
    if (!this.ctx.key) return 0;
    const log = this.ctx.store.json('edits:' + this.ctx.key, []);
    let n = 0;
    for (const cmd of log) { const r = this.apply(cmd); if (r) { this.log.push(cmd); this.undoStack.push({ cmd, restore: r }); n++; } }
    while (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();   // yeniden açılışta da yalnız son 10 adım geri alınabilir
    return n;
  }
  clear() { this.log = []; this.undoStack = []; this.redoStack = []; this.save(); }
}

// ---------------------------------------------------------------------------------------
// DXF yazıcı
// ---------------------------------------------------------------------------------------
const f6 = (v) => (Math.round((v || 0) * 1e6) / 1e6).toString();
export function aciOf(col, layerCol) {
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
  const blocks = opts.blocks instanceof Map ? opts.blocks : new Map();
  const ltypes = opts.ltypes || {};
  const vars = opts.vars || {};
  // Desen çizgileri ayrı LWPOLYLINE olarak YAZILMAZ: desenli tarama DXF'e HATCH olarak çıkar ve
  // AutoCAD deseni kendisi üretir. Yazılsaydı dosyada hem dolgu hem çizgiler olur, çift görünürdü.
  // harici referansın ilkelleri (p.xref) çizimin kendi geometrisi değildir: DXF'e yazılmaz, XBIND ile blok olunca yazılır
  // Desen çizgileri ilkeli DXF'e AYRICA yazılmaz: tarama zaten HATCH varlığı olarak çıkar.
  // Bizim ürettiğimizde bayrak ent.hpart'tadır, dosyadan okunanda ilkelin kendi p.hp'sinde —
  // ikincisi süzülmezse dosyadan gelen her tarama dev bir zikzak LWPOLYLINE olarak dışa çıkardı.
  const ents = prims.filter(p => p.k !== 4 && !p.inf && !p.xref && !(p.ent && p.ent.hpart) && !(p.k === 0 && p.hp != null) && (!opts.onlyEdited || (p.info && p.info.edited)));
  // Uygulamanın blok yerleştirmeleri (info.blk, tanımı tabloda) ilkel ilkel değil TEK INSERT olarak yazılır
  const isIns = (p) => !!(p.info && p.info.t === 'INSERT' && p.info.blk && blocks.has(blkKey(p.info.name)));
  const insG = new Map();
  for (const p of ents) if (isIns(p)) { let g = insG.get(p.info.h); if (!g) { g = { info: p.info, prims: [] }; insG.set(p.info.h, g); } g.prims.push(p); }
  const usedLayers = new Set(ents.map(p => p.lay));
  for (const d of blocks.values()) for (const e of d.ents || []) if (e && e.layer) usedLayers.add(e.layer);
  const bb = ents.length ? ents.reduce((a, p) => [Math.min(a[0], p.bb[0]), Math.min(a[1], p.bb[1]), Math.max(a[2], p.bb[2]), Math.max(a[3], p.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]) : [0, 0, 1, 1];
  const hasWipe = ents.some(p => p.k === 0 && p.bg) || [...blocks.values()].some(d => (d.ents || []).some(e => e && (e.type === 'WIPEOUT' || e.bg)));
  // HEADER
  w(0, 'SECTION'); w(2, 'HEADER');
  w(9, '$ACADVER'); w(1, 'AC1015');
  w(9, '$INSUNITS'); w(70, opts.units == null ? 0 : opts.units);
  w(9, '$EXTMIN'); w(10, f6(bb[0])); w(20, f6(bb[1])); w(30, 0);
  w(9, '$EXTMAX'); w(10, f6(bb[2])); w(20, f6(bb[3])); w(30, 0);
  w(9, '$LTSCALE'); w(40, 1);
  if (Array.isArray(vars.INSBASE)) { w(9, '$INSBASE'); w(10, f6(vars.INSBASE[0])); w(20, f6(vars.INSBASE[1])); w(30, f6(vars.INSBASE[2])); }   // BASE komutu
  w(0, 'ENDSEC');
  // CLASSES: WIPEOUT sınıf kaydı olmadan AutoCAD maskeyi okumaz (WipeOut Dbx uygulaması)
  if (hasWipe) {
    w(0, 'SECTION'); w(2, 'CLASSES');
    w(0, 'CLASS'); w(1, 'WIPEOUT'); w(2, 'AcDbWipeout'); w(3, 'WipeOut|Product Desc:     WipeOut Dbx Application|Company:          Autodesk, Inc.|WEB Address:      www.autodesk.com'); w(90, 0); w(280, 0); w(281, 1);
    w(0, 'ENDSEC');
  }
  // TABLES
  w(0, 'SECTION'); w(2, 'TABLES');
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
  // BLOCK_RECORD: model / kâğıt uzayı ve uygulamanın her blok tanımı için bir kayıt (BLOCK'un sahibi 330 ile buraya bağlanır)
  w(0, 'TABLE'); w(2, 'BLOCK_RECORD'); const brTab = H(); w(5, brTab); w(100, 'AcDbSymbolTable'); w(70, blocks.size + 2);
  const rec = (name) => { const h = H(); w(0, 'BLOCK_RECORD'); w(5, h); w(330, brTab); w(100, 'AcDbSymbolTableRecord'); w(100, 'AcDbBlockTableRecord'); w(2, name); w(340, 0); return h; };
  const msH = rec('*Model_Space'), psH = rec('*Paper_Space'), recH = new Map();
  for (const [k, d] of blocks) recH.set(k, rec(d.name));
  w(0, 'ENDTAB');
  w(0, 'ENDSEC');
  // ---- varlık yazıcıları (ENTITIES ve BLOCKS ortak) ----
  const common = (type, p, sub, owner) => {
    w(0, type); w(5, H()); if (owner) w(330, owner); w(100, 'AcDbEntity'); w(8, p.lay || '0');
    const lay = layers.get(p.lay);
    /*
     * RENK KODU 62 (v7.93). Eskiden nesnenin AÇIK indeksi yazılmıyor, renk p.col'dan aciOf ile
     * YENİDEN TÜRETİLİYORDU; katman rengiyle aynı olan açık bir atama böylece sessizce
     * KATMANDAN'a dönüşüyordu. BLOKTAN (0) ise — kök kusur p.col'u FG yaptığı için — 62 = 7
     * olarak çıkıyor, yani blok içi renk kalıcı olarak bozuluyordu. Artık nesnenin kendi
     * indeksi ne diyorsa o yazılır: 0 = BLOKTAN, 1-255 açık, 256 = KATMANDAN (62 hiç yazılmaz).
     * İndeksi olmayan eski ilkellerde renkten türetme yedek kalır.
     */
    if (p.info && p.info.ci != null) { const ci = normCi(p.info.ci); if (ci !== BYLAYER) w(62, ci); }
    else { const ci = aciOf(p.col, lay ? lay.color : null); if (ci !== 256) w(62, ci); }
    if (p.lt) w(6, ltypes[p.lt] ? ltypes[p.lt].name : p.lt);
    if (sub) w(100, sub);
  };
  /*
   * MASKE (WIPEOUT): AutoCAD 1×1 piksellik bir "resim" yazar; sınır köşeleri resim uzayında −0,5…0,5 aralığındadır
   * (scene.js aynı kuralı okur: bx = b.x + 0.5, by = 0.5 − b.y). Kutu sol alt köşe konum, u genişlik, v yükseklik.
   */
  const writeWipeout = (p, owner) => {
    const pts = []; for (const o of p.ops) { if (o[0] === 0 || o[0] === 1) pts.push([o[1], o[2]]); else for (const q of flatten([o])) pts.push([q[0], q[1]]); }
    if (pts.length < 3) return;
    if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts.pop();
    const x0 = Math.min(...pts.map(q => q[0])), y0 = Math.min(...pts.map(q => q[1])), x1 = Math.max(...pts.map(q => q[0])), y1 = Math.max(...pts.map(q => q[1]));
    const wd = Math.max(x1 - x0, 1e-9), ht = Math.max(y1 - y0, 1e-9), elev = (p.ops[0] && p.ops[0][3]) || 0;
    common('WIPEOUT', p, 'AcDbWipeout', owner);
    w(90, 0); w(10, f6(x0)); w(20, f6(y0)); w(30, f6(elev)); w(11, f6(wd)); w(21, 0); w(31, 0); w(12, 0); w(22, f6(ht)); w(32, 0);
    w(13, 1); w(23, 1); w(340, 0); w(70, 7); w(280, 1); w(281, 50); w(282, 50); w(283, 0); w(360, 0); w(71, 2); w(91, pts.length + 1);
    const ring = pts.concat([pts[0]]);
    for (const q of ring) { w(14, f6((q[0] - x0) / wd - 0.5)); w(24, f6(0.5 - (q[1] - y0) / ht)); }
  };
  const writeEnt = (p, owner) => {
    try {
      if (p.k === 1) {
        const txt = p.lines.join('\\P');
        if (p.lines.length > 1) {
          common('MTEXT', p, 'AcDbMText', owner); w(10, f6(p.x)); w(20, f6(p.y)); w(30, f6(p.z || 0)); w(40, f6(p.h)); w(71, p.va === 3 ? 1 : p.va === 2 ? 4 : 7); w(1, txt.slice(0, 250)); w(50, f6(p.rot * R2D));
        } else {
          common('TEXT', p, 'AcDbText', owner); w(10, f6(p.x)); w(20, f6(p.y)); w(30, f6(p.z || 0)); w(40, f6(p.h)); w(1, p.lines[0]); w(50, f6(p.rot * R2D)); w(41, f6(p.ws || 1));
          w(72, p.ha === 1 ? 1 : p.ha === 2 ? 2 : 0); w(11, f6(p.x)); w(21, f6(p.y)); w(31, f6(p.z || 0)); w(100, 'AcDbText'); w(73, p.va === 3 ? 3 : p.va === 2 ? 2 : p.va === 1 ? 1 : 0);
        }
        return;
      }
      if (p.k === 2) { common('POINT', p, 'AcDbPoint', owner); w(10, f6(p.x)); w(20, f6(p.y)); w(30, f6(p.z || 0)); return; }
      if (p.k === 5) {
        // ağ gövdesi: üçgenler 3DFACE, kenarlar LINE olarak yazılır (yoksa katı geometri DXF'e hiç girmez).
        // Çok büyük gövdede yüzler atlanır, kenarlar her zaman yazılır — dosya bellek taşırmasın.
        const V = p.vtx, I = p.idx, G = p.seg;
        const nTri = I ? (I.length / 3) | 0 : 0;
        if (nTri > 0 && nTri <= DXF_MAX_FACE) {
          for (let i = 0; i + 2 < I.length; i += 3) {
            const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3;
            if (a + 2 >= V.length || b + 2 >= V.length || c + 2 >= V.length) continue;
            common('3DFACE', p, 'AcDbFace', owner);
            for (const [q, v] of [[0, a], [1, b], [2, c], [3, c]]) { w(10 + q, f6(V[v])); w(20 + q, f6(V[v + 1])); w(30 + q, f6(V[v + 2])); }
            if (G && G.length) w(70, 15);          // gerçek kenarlar LINE olarak yazılıyor: üçgenleme kenarları gizli
          }
        }
        if (G) for (let i = 0; i + 5 < G.length; i += 6) {
          common('LINE', p, 'AcDbLine', owner);
          w(10, f6(G[i])); w(20, f6(G[i + 1])); w(30, f6(G[i + 2])); w(11, f6(G[i + 3])); w(21, f6(G[i + 4])); w(31, f6(G[i + 5]));
        }
        return;
      }
      if (p.k !== 0) return;
      const ops = p.ops;
      if (p.bg) { writeWipeout(p, owner); return; }
      const hatchTur = p.et === 'HATCH' || (p.info && p.info.t === 'HATCH');
      const hatchAd = hatchTur ? String((p.info && p.info.pattern) || 'SOLID').toUpperCase() : '';
      // Desenli tarama DOLGUSUZ bir ilkeldir (çizgileri ayrı, hpart'lı bir yolda durur); yine de
      // DXF'e HATCH olarak çıkmalıdır, yoksa dosyada yalnız sınır çokgeni kalır ve tarama kaybolur.
      if ((p.fill || (hatchAd && hatchAd !== 'SOLID')) && (hatchTur || p.et === 'SOLID' || p.et === 'TRACE')) {
        // Dolu yüzeyler gerçek DXF varlığı olarak yazılır; LWPOLYLINE'a düşürmek dolguyu kaybettirirdi.
        // Alt yollar ayrı sınırdır (moveto her seferinde yeni yol açar).
        /*
         * İLMEKLER YAYI YAY OLARAK TAŞIR (v7.93). Eskiden her yay kirişlenip 64 kenarlı çokgene
         * çevriliyordu: AutoCAD'de daire sınırlı bir tarama açılınca sınır artık daire değildi,
         * tutamağı da yarıçapı da kayboluyordu. Artık yay, AutoCAD'in kendi gösterimiyle —
         * çokgen ilmeğin BULGE değeriyle (tan(açıklık/4)) — yazılır. Tam daire tek bulge ile
         * anlatılamaz (tan(pi/2) sonsuzdur): AutoCAD gibi iki yarım yaya bölünür. Elips ve
         * spline yayında bulge karşılığı yoktur, onlar kirişlenmeye devam eder.
         */
        const bulgeLoops = () => {
          const out = []; let cur = null;
          const son = () => (cur && cur.length ? cur[cur.length - 1] : null);
          for (const o of ops) {
            if (o[0] === 0) { cur = [[o[1], o[2], 0]]; out.push(cur); continue; }
            if (!cur) continue;
            if (o[0] === 1) { cur.push([o[1], o[2], 0]); continue; }
            if (o[0] === 2 || o[0] === -2) {
              const ccw = o[0] === 2, cx = o[1], cy = o[2], r = o[3];
              let sw = ccw ? o[5] - o[4] : o[4] - o[5];
              while (sw <= 1e-12) sw += TAU;                     // arcPts kuralı: sıfır açıklık tam turdur
              const isaret = ccw ? 1 : -1;
              const nokta = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
              const bas = son();
              if (!bas) { const s0 = nokta(o[4]); cur.push([s0[0], s0[1], 0]); }
              if (sw >= TAU - 1e-9) {                            // tam daire: iki yarım yay, bulge = ±1
                const orta = nokta(o[4] + isaret * Math.PI), bit = nokta(o[4]);
                const b0 = son(); if (b0) b0[2] = isaret;
                cur.push([orta[0], orta[1], isaret]);
                cur.push([bit[0], bit[1], 0]);
              } else {
                const b0 = son(); if (b0) b0[2] = isaret * Math.tan(sw / 4);
                const bit = nokta(o[5]);
                cur.push([bit[0], bit[1], 0]);
              }
              continue;
            }
            for (const q of flatten([o])) cur.push([q[0], q[1], 0]);   // elips / spline: kiriş
          }
          // Kapalı ilmekte son köşe ilkinin aynısıysa atılır: DXF 73 = 1 zaten kapatır, yinelenen
          // köşe AutoCAD'de sıfır boylu kenar bırakır (ve bulge'ü ilk köşeye taşımak gerekirdi).
          for (const l of out) {
            while (l.length > 2) {
              const a = l[0], b = l[l.length - 1];
              if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && !b[2]) l.pop(); else break;
            }
          }
          return out.filter(l => l.length >= 3 || l.some(q => q[2]));   // iki köşeli ilmek ancak YAY taşıyorsa alan kapatır (daire)
        };
        const paths = bulgeLoops();
        const elev = (ops[0] && ops[0][3]) || 0;
        if (paths.length && p.fill && !hatchTur && paths.length === 1 && paths[0].length <= 4 && !paths[0].some(q => q[2])) {
          // Üç ya da dört köşeli dolu: DXF SOLID. Köşe sırası 1-2-4-3'tür, üçgende 4 = 3.
          const q = paths[0];
          const A = q[0], B = q[1], Cc = q[2], Dd = q.length > 3 ? q[3] : q[2];
          common('SOLID', p, 'AcDbTrace', owner);
          w(10, f6(A[0])); w(20, f6(A[1])); w(30, f6(elev));
          w(11, f6(B[0])); w(21, f6(B[1])); w(31, f6(elev));
          w(12, f6(Dd[0])); w(22, f6(Dd[1])); w(32, f6(elev));
          w(13, f6(Cc[0])); w(23, f6(Cc[1])); w(33, f6(elev));
          return;
        }
        if (paths.length) {
          const inf = p.info || {};
          const hr = (inf.hrec && typeof inf.hrec === 'object') ? inf.hrec : {};
          const desenli = !!hatchAd && hatchAd !== 'SOLID';
          const olcek = desenli ? (typeof inf.hscale === 'number' && inf.hscale ? inf.hscale : 1) : 1;
          const aci = desenli ? (typeof inf.hangle === 'number' ? inf.hangle : 0) : 0;
          /*
           * Desen tanım satırları. Kendi desenlerimizde tablodan üretilir; DOSYADAN okunan
           * taramada dosyanın kendi satırları (inf.hdefs) yazılır — böylece tablomuzda olmayan
           * ANGLE, AR-CONC, BRICK gibi AutoCAD desenleri adıyla ve dokusuyla korunur, daha önce
           * olduğu gibi sessizce düz dolguya (SOLID) çevrilmez.
           */
          const dosyaDefs = Array.isArray(inf.hdefs) && inf.hdefs.length ? inf.hdefs : null;
          const defs = desenli ? (patternDefs(hatchAd, olcek, aci).length ? patternDefs(hatchAd, olcek, aci) : (dosyaDefs || [])) : [];
          /*
           * ADA (island) BAYRAKLARI. Her ilmeği "dış sınır" (bayrak 1) yazmak yanlıştı: içteki
           * delik de dış sayılınca AutoCAD onu ayrı bir dolu ada gibi görüyordu. Bir ilmek başka
           * bir ilmeğin İÇİNDE kalıyorsa iç ilmektir (yalnız bayrak 2 = çokgen). Ekranda da aynı
           * kural geçerlidir: render.js dolguyu tek-çift (evenodd) kuralıyla çizer, yani AutoCAD'in
           * NORMAL ada kipiyle birebir — ada kipi bu yüzden öntanımlı olarak 0 yazılır.
           */
          const duz = paths.map(l => l.map(q => [q[0], q[1]]));
          const disMi = duz.map((a, i) => !duz.some((b, j) => j !== i && b.length >= 3 && pointInPoly(b, a[0][0], a[0][1])));
          const kot = typeof hr.elev === 'number' ? hr.elev : elev;
          common('HATCH', p, 'AcDbHatch', owner);
          w(10, 0); w(20, 0); w(30, f6(kot));
          w(210, 0); w(220, 0); w(230, 1);
          w(2, defs.length ? hatchAd : 'SOLID'); w(70, defs.length ? 0 : 1);
          /*
           * 71 = 0 (ilişkisiz) HER ZAMAN. İlişkisel tarama sınırını çizen NESNELERE 330 ile
           * bağlıdır; bizde o nesneler ayrı ilkel olarak durmaz. 71 = 1 yazıp 330'ları yazmamak
           * AutoCAD'de bozuk tarama demektir — ilişkisizlik dosyayı düzenlenebilir bırakır.
           */
          w(71, 0);
          w(91, paths.length);
          for (let i = 0; i < paths.length; i++) {
            const part = paths[i], bulge = part.some(q => q[2]);
            w(92, (disMi[i] ? 1 : 0) | 2); w(72, bulge ? 1 : 0); w(73, 1); w(93, part.length);
            for (const q of part) { w(10, f6(q[0])); w(20, f6(q[1])); if (bulge) w(42, f6(q[2] || 0)); }
            w(97, 0);
          }
          w(75, typeof hr.style === 'number' ? hr.style : 0); w(76, typeof hr.ptype === 'number' ? hr.ptype : 1);
          /*
           * Desen tanımı (AutoCAD'in kendi sırası): 52 açı, 41 ölçek, 77 çift, 78 satır sayısı,
           * sonra her satır 53 açı · 43-44 taban · 45-46 kayma · 79 tire sayısı · 49 tireler.
           * 45-46 ÇİZGİNİN kendi eksenindedir (geom.patternDefs de öyle üretir), döndürülmez.
           * Bu satırlar olmadan AutoCAD deseni çizemez; yalnız ad yazmak boş tarama verir.
           */
          if (defs.length) {
            w(52, f6(aci)); w(41, f6(olcek)); w(77, hr.dbl ? 1 : 0); w(78, defs.length);
            for (const d of defs) {
              w(53, f6(d.angle * R2D));
              w(43, f6(d.base.x)); w(44, f6(d.base.y));
              w(45, f6(d.offset.x)); w(46, f6(d.offset.y));
              const dl = d.dashLengths || [];
              w(79, dl.length);
              for (const v of dl) w(49, f6(v));
            }
          }
          if (hr.pix > 0) w(47, f6(hr.pix));
          // Tohum noktaları: AutoCAD taramayı yeniden hesaplarken (HATCHEDIT · sınır yeniden kur) buradan başlar
          const seeds = Array.isArray(hr.seeds) ? hr.seeds.slice(0, 32) : [];
          w(98, seeds.length);
          for (const q of seeds) { w(10, f6(q[0])); w(20, f6(q[1])); }
          /*
           * Geçiş (gradient) dolgusu: 450 bayrak, 451 ayrılmış, 452 tek renk mi, 453 renk sayısı,
           * 460 dönüş (radyan), 461 kaydırma, 462 ton, 463 renk değeri, 470 geçiş adı.
           */
          if (hr.grad) {
            const g = hr.grad, cs = Array.isArray(g.colors) && g.colors.length ? g.colors : [{ rgb: 0, value: 0 }, { rgb: 0xffffff, value: 1 }];
            w(450, 1); w(451, 0); w(452, g.one ? 1 : 0); w(453, g.one ? 1 : Math.min(2, cs.length));
            w(460, f6(g.rot || 0)); w(461, f6(g.def || 0)); w(462, f6(g.tint || 0));
            for (const c of cs.slice(0, g.one ? 1 : 2)) { w(463, f6(c.value || 0)); w(421, (c.rgb | 0) >>> 0); }
            w(470, String(g.name || 'LINEAR'));
          }
          return;
        }
      }
      if (ops.length === 2 && ops[1][0] === 2 && Math.abs((ops[1][5] - ops[1][4]) - TAU) < 1e-9) {
        const o = ops[1]; common('CIRCLE', p, 'AcDbCircle', owner); w(10, f6(o[1])); w(20, f6(o[2])); w(30, f6(o[6] || 0)); w(40, f6(o[3])); return;
      }
      if (ops.length === 2 && (ops[1][0] === 2 || ops[1][0] === -2)) {
        const o = ops[1]; const a0 = o[0] === 2 ? o[4] : o[5], a1 = o[0] === 2 ? o[5] : o[4];
        common('ARC', p, 'AcDbCircle', owner); w(10, f6(o[1])); w(20, f6(o[2])); w(30, f6(o[6] || 0)); w(40, f6(o[3])); w(100, 'AcDbArc'); w(50, f6(a0 * R2D)); w(51, f6(a1 * R2D)); return;
      }
      const zs = ops.filter(o => o[0] === 0 || o[0] === 1).map(o => o[3] || 0);
      const is3d = zs.some(z => Math.abs(z - zs[0]) > 1e-9);
      const hasArc = ops.some(o => o[0] === 2 || o[0] === -2 || o[0] === 3);
      if (p.face && ops.length >= 3 && ops.length <= 4) {
        common('3DFACE', p, 'AcDbFace', owner);
        for (let i = 0; i < 4; i++) { const o = ops[Math.min(i, ops.length - 1)]; w(10 + i, f6(o[1])); w(20 + i, f6(o[2])); w(30 + i, f6(o[3] || 0)); }
        return;
      }
      if (is3d && !hasArc) {
        common('POLYLINE', p, 'AcDb3dPolyline', owner); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, 8 | (p.closed ? 1 : 0));
        for (const o of ops) { if (o[0] !== 0 && o[0] !== 1) continue; w(0, 'VERTEX'); w(5, H()); w(100, 'AcDbEntity'); w(8, p.lay || '0'); w(100, 'AcDbVertex'); w(100, 'AcDb3dPolylineVertex'); w(10, f6(o[1])); w(20, f6(o[2])); w(30, f6(o[3] || 0)); w(70, 32); }
        w(0, 'SEQEND'); w(5, H()); w(100, 'AcDbEntity'); w(8, p.lay || '0');
        return;
      }
      if (ops.length === 2 && ops[1][0] === 1 && !p.closed && !p.w && !p.fill) {
        common('LINE', p, 'AcDbLine', owner); w(10, f6(ops[0][1])); w(20, f6(ops[0][2])); w(30, f6(ops[0][3] || 0)); w(11, f6(ops[1][1])); w(21, f6(ops[1][2])); w(31, f6(ops[1][3] || 0)); return;
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
        for (const part of parts) { common('LWPOLYLINE', p, 'AcDbPolyline', owner); w(90, part.length); w(70, 1); w(38, f6(zs[0])); for (const v of part) { w(10, f6(v[0])); w(20, f6(v[1])); } }
        return;
      }
      if (verts.length < 2) return;
      common('LWPOLYLINE', p, 'AcDbPolyline', owner); w(90, verts.length); w(70, p.closed || p.fill ? 1 : 0); if (p.w) w(43, f6(p.w)); w(38, f6(zs[0]));
      for (const v of verts) { w(10, f6(v[0])); w(20, f6(v[1])); if (v[2]) w(42, f6(v[2])); }
    } catch (e) { /* bu ilkeli atla */ }
  };
  /** Öznitelik tanımı (blok içinde): AcDbText + AcDbAttributeDefinition */
  const writeAttdef = (e, owner) => {
    const q = (e.pts && e.pts[0]) || [0, 0, 0];
    const p = { lay: e.layer || '0', col: FG, info: { ci: normCi(e.color) } };
    w(0, 'ATTDEF'); w(5, H()); if (owner) w(330, owner); w(100, 'AcDbEntity'); w(8, p.lay);
    if (p.info.ci !== BYLAYER) w(62, p.info.ci);   // 0 = BLOKTAN da yazılır
    w(100, 'AcDbText'); w(10, f6(q[0])); w(20, f6(q[1])); w(30, f6(q[2] || 0)); w(40, f6(e.h || 2.5)); w(1, e.text == null ? '' : String(e.text)); w(50, f6((e.rot || 0) * R2D));
    w(100, 'AcDbAttributeDefinition'); w(3, e.prompt == null ? '' : String(e.prompt)); w(2, String(e.tag || 'TAG')); w(70, e.flags | 0);
  };
  /** Yerleştirme: INSERT (+ ATTRIB… SEQEND). i: paylaşılan info ya da INSERT varlığı; attPrims: görünen ATTRIB ilkelleri (konum) */
  const writeInsert = (i, owner, attPrims) => {
    const def = blocks.get(blkKey(i.name));
    const m = insMatrix(i), d = decompose(m);
    const attdefs = def ? (def.ents || []).filter(e => e && e.type === 'ATTDEF') : [];
    const attrs = attrsFor(def, i.attrs);
    const hasAtt = attdefs.length > 0;
    const lay = i.lay || i.layer || '0', ci = normCi(i.ci != null ? i.ci : i.color);
    w(0, 'INSERT'); w(5, H()); if (owner) w(330, owner); w(100, 'AcDbEntity'); w(8, lay);
    if (ci !== BYLAYER) w(62, ci);   // 0 = BLOKTAN da yazılır
    w(100, 'AcDbBlockReference'); if (hasAtt) w(66, 1); w(2, def ? def.name : i.name);
    w(10, f6(d.x)); w(20, f6(d.y)); w(30, f6(i.z || 0)); w(41, f6(d.sx)); w(42, f6(d.sy)); w(43, 1); w(50, f6(d.rot * R2D));
    if (hasAtt) {
      const world = xformEnts(attdefs, m, i.z || 0);   // görünmeyen öznitelik için tanımın dönüştürülmüş konumu
      attdefs.forEach((a, ai) => {
        const val = attrs[ai] ? String(attrs[ai][1]) : String(a.text == null ? '' : a.text);
        const wp = attPrims ? attPrims.find(q => q.ai === ai) : null, we = world[ai] || {};
        const q = (we.pts && we.pts[0]) || [d.x, d.y, i.z || 0];
        const x = wp ? wp.x : q[0], y = wp ? wp.y : q[1], z = wp ? (wp.z || 0) : (q[2] || 0), h = wp ? wp.h : (we.h || 2.5), rot = wp ? wp.rot : (we.rot || 0);
        w(0, 'ATTRIB'); w(5, H()); if (owner) w(330, owner); w(100, 'AcDbEntity'); w(8, wp ? (wp.lay || lay) : (a.layer && a.layer !== '0' ? a.layer : lay));
        w(100, 'AcDbText'); w(10, f6(x)); w(20, f6(y)); w(30, f6(z)); w(40, f6(h)); w(1, val); w(50, f6(rot * R2D));
        w(100, 'AcDbAttribute'); w(2, String(a.tag || 'TAG')); w(70, a.flags | 0);
      });
      w(0, 'SEQEND'); w(5, H()); if (owner) w(330, owner); w(100, 'AcDbEntity'); w(8, lay);
    }
  };
  const writeDefEnt = (e, owner) => {
    if (!e || typeof e !== 'object') return;
    // Taramanın DESEN ÇİZGİLERİ blok tanımında da ayrıca yazılmaz: tarama HATCH varlığı olarak
    // çıkar, AutoCAD deseni kendi üretir. Yazılsaydı blok içinde hem dolgu hem dev bir zikzak
    // polyline olur, tarama çift görünür ve dosya şişerdi (üst düzeyde aynı süzgeç ents'tedir).
    if (e.hpart) return;
    if (e.type === 'INSERT') { writeInsert(e, owner, null); return; }
    if (e.type === 'ATTDEF') { writeAttdef(e, owner); return; }
    const p = entToPrim(e, layers);
    if (p) writeEnt(p, owner);
  };
  // BLOCKS: model / kâğıt uzayı boş kayıtları ve uygulamanın blok tanımları (tanım uzayında, taban 10/20/30)
  w(0, 'SECTION'); w(2, 'BLOCKS');
  const blockHead = (name, owner, base, flags) => { w(0, 'BLOCK'); w(5, H()); w(330, owner); w(100, 'AcDbEntity'); w(8, '0'); w(100, 'AcDbBlockBegin'); w(2, name); w(70, flags); w(10, f6(base[0])); w(20, f6(base[1])); w(30, f6(base[2])); w(3, name); w(1, ''); };
  const blockEnd = (owner) => { w(0, 'ENDBLK'); w(5, H()); w(330, owner); w(100, 'AcDbEntity'); w(8, '0'); w(100, 'AcDbBlockEnd'); };
  blockHead('*Model_Space', msH, [0, 0, 0], 0); blockEnd(msH);
  blockHead('*Paper_Space', psH, [0, 0, 0], 0); blockEnd(psH);
  for (const [k, d] of blocks) {
    const owner = recH.get(k), list = d.ents || [];
    blockHead(d.name, owner, Array.isArray(d.base) ? d.base : [0, 0, 0], list.some(e => e && e.type === 'ATTDEF') ? 2 : 0);
    for (const e of list) writeDefEnt(e, owner);
    blockEnd(owner);
  }
  w(0, 'ENDSEC');
  // ENTITIES: çizim sırasıyla; yerleştirme grubu ilk ilkelinin yerinde tek INSERT olarak
  w(0, 'SECTION'); w(2, 'ENTITIES');
  const written = new Set();
  for (const p of ents) {
    if (isIns(p)) { const g = insG.get(p.info.h); if (!g || written.has(g)) continue; written.add(g); writeInsert(g.info, null, g.prims.filter(q => q.ai != null)); continue; }
    writeEnt(p, null);
  }
  w(0, 'ENDSEC');
  w(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
