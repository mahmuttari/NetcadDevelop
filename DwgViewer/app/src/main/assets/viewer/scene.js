/*
 * SceneBuilder: DwgDatabase (LibreDWG ya da dxf.js çıktısı) → çizilebilir sahne.
 * DOM kullanmaz; Web Worker içinde çalışır.
 *
 * Sahne:
 *   layouts : [{ name, isModel, prims, ext, viewports:[{x0,y0,x1,y1,cx,cy,scale,on}] }]
 *   layers  : [{ name, color, lt, lw, frozen, off, visible, count }]
 *   ltypes  : { NAME: { pat:[…], len } }
 *   styles  : { NAME: { font, width, oblique } }
 *   xrefs   : [{ name, inserts:[{m, layer, color}] }]
 *   images  : [{ handle, fileName }]
 *   counts, entityCount, blockCount, header:{…}
 *
 * İlkel türleri:
 *   k=0 yol   : ops, closed, fill, alpha, w (dünya birimi genişlik), bg (maske)
 *   k=1 yazı  : x,y,h,rot,lines[],ha,va,ws,font,obl,spacing
 *   k=2 nokta : x,y,z
 *   k=3 resim : quad [[x,y]×4], img (imagedef handle), pw, ph
 *   k=4 blok ekleme noktası (çizilmez, yakalanır): x,y,z
 * Ortak: col (RGB; -1 = ön plan), lay, lt (ad), lts (çizgi tipi ölçeği), lw (1/100 mm), bb, info
 */
import { parseAcis, tessellate, triangulate, newell } from './acis.js';
import { TAU, IDENT, mul, apply, isIdent, isSim, simScale, simRot, det, insertMatrix, arcPts, ellipsePts, bulgeArc, bsplinePts, catmullPts, opsBBox } from './geom.js';

export const FG = -1;

// ---- ACI paleti ---------------------------------------------------------------
function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}
export const ACI = new Array(256).fill(0);
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

// DWG çizgi kalınlığı kodu → 1/100 mm
const LW_TABLE = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
export const LW_DEFAULT = 25;
function lwOf(code) {
  if (code == null) return -1;
  if (code >= 0 && code < LW_TABLE.length) return LW_TABLE[code];
  if (code === 29 || code === -1) return -1;   // ByLayer
  if (code === 30 || code === -2) return -2;   // ByBlock
  if (code === 31 || code === -3) return LW_DEFAULT;
  if (code > 31 && code <= 211) return code;   // DXF: doğrudan 1/100 mm
  return -1;
}

// ---- MTEXT biçim kodları -------------------------------------------------------
export function mtextLines(raw) {
  if (raw == null) return [];
  let s = String(raw);
  s = s.replace(/\\\\/g, '\x01');
  s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ');
  s = s.replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, '$1/$2');
  s = s.replace(/\\[fF][^;]*;/g, '').replace(/\\p[^;]*;/g, '');
  s = s.replace(/\\[CcHhWwQqTtAa][0-9.\-x]*;?/g, '');
  s = s.replace(/\\[LlOoKkNXx]/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, 'Ø').replace(/%%[uUoO]/g, '').replace(/%%%/g, '%');
  s = s.replace(/\x01/g, '\\');
  return s.split('\n');
}
export const textPlain = (t) => mtextLines(t).join(' ');

function layerColor(l) {
  if (l.colorIndex >= 1 && l.colorIndex <= 255) return ACI[l.colorIndex];
  if (typeof l.color === 'number' && l.color !== 0xffffff && l.color !== 0) return l.color & 0xffffff;
  return FG;
}
const normColor = (c) => (c === 0xffffff || c === 0) ? FG : c;

function fontOf(file) {
  const f = (file || '').toLowerCase().replace(/^.*[\\/]/, '');
  if (!f) return 'sans-serif';
  const base = f.replace(/\.(shx|ttf|ttc|otf|pfb)$/, '');
  if (/\.(ttf|ttc|otf)$/.test(f) || !/\.shx$/.test(f)) {
    const fam = base.replace(/[_-]?(bd|bold|i|it|italic|regular)$/i, '');
    return `"${fam}", "${base}", sans-serif`;
  }
  if (/^roman[tdc]|^script|^gothic|^italic/.test(base)) return 'serif';
  if (/^mono|^isocp|^iso/.test(base)) return '"Roboto Mono", monospace';
  return 'sans-serif';
}

/** OCS (nesne koordinat sistemi) tabanı — Arbitrary Axis Algorithm; extrusion Z eksenine paralelse null */
/** blok ekleme Z dönüşümü: z_dünya = zo + zs · z_blok (ekleme noktasının kotu ve Z ölçeği) */
const zW = (z, ctx) => (ctx && (ctx.zs !== 1 || ctx.zo)) ? (ctx.zo || 0) + (ctx.zs || 1) * (z || 0) : (z || 0);
function zOps(ops, zs, zo) {
  return ops.map(o => {
    if (o[0] === 0 || o[0] === 1) return o.length > 3 && o[3] != null ? [o[0], o[1], o[2], zo + zs * o[3]] : (zo ? [o[0], o[1], o[2], zo] : o);
    if (o[0] === 2 || o[0] === -2) { const r = o.slice(); r[6] = zo + zs * (o[6] || 0); return r; }
    return o;
  });
}

/**
 * Ağ kenar süzgeci: yüz döngülerinden (3B nokta dizileri) çizilecek kenarları seçer.
 * İki eş düzlemli komşu yüz arasındaki kenar (üçgenleme çaprazı, düz yüzeyin parçalanması) çizilmez;
 * yalnız sınır kenarları ve kırışıklık açısı `creaseDeg`'i aşan kenarlar kalır. `hidden[f][k]` (dosyadaki
 * görünmez kenar bayrağı) her zaman gizler. Dönen: [[a,b], …]
 */
export function meshEdges(faces, hidden = null, creaseDeg = 20) {
  const cosT = Math.cos(creaseDeg * Math.PI / 180);
  const key = (q) => q[0] + ',' + q[1] + ',' + q[2];
  const map = new Map();
  faces.forEach((f, fi) => {
    if (!f || f.length < 2) return;
    const n = newell(f); const L = Math.hypot(n[0], n[1], n[2]) || 1; const nn = [n[0] / L, n[1] / L, n[2] / L];
    const m = f.length === 2 ? 1 : f.length;
    for (let k = 0; k < m; k++) {
      const a = f[k], b = f[(k + 1) % f.length]; const ka = key(a), kb = key(b); if (ka === kb) continue;
      const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      let e = map.get(ek); if (!e) { e = { a, b, n: [], hid: false }; map.set(ek, e); }
      e.n.push(f.length >= 3 ? nn : null);
      if (hidden && hidden[fi] && hidden[fi][k]) e.hid = true;
    }
  });
  const out = [];
  for (const e of map.values()) {
    if (e.hid) continue;
    const ns = e.n.filter(Boolean);
    if (ns.length >= 2) {                                   // komşu yüzler: hepsi eş düzlemliyse kenar iç kenardır
      let crease = false;
      for (let i = 1; i < ns.length && !crease; i++) if (Math.abs(ns[0][0] * ns[i][0] + ns[0][1] * ns[i][1] + ns[0][2] * ns[i][2]) < cosT) crease = true;
      if (!crease) continue;
    }
    out.push([e.a, e.b]);
  }
  return out;
}

function ocsOf(e) {
  const n = e && e.extrusionDirection; if (!n) return null;
  const L = Math.hypot(n.x || 0, n.y || 0, n.z || 0); if (!(L > 0)) return null;
  const nx = n.x / L, ny = n.y / L, nz = n.z / L;
  if (Math.abs(nx) < 1e-9 && Math.abs(ny) < 1e-9) return null;           // (0,0,±1): 2B yol (flipX) yeter
  const ref = (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) ? [0, 1, 0] : [0, 0, 1];
  let ax = [ref[1] * nz - ref[2] * ny, ref[2] * nx - ref[0] * nz, ref[0] * ny - ref[1] * nx];
  const al = Math.hypot(ax[0], ax[1], ax[2]) || 1; ax = [ax[0] / al, ax[1] / al, ax[2] / al];
  const ay = [ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]];
  return { ax, ay, n: [nx, ny, nz], to: (x, y, z) => [x * ax[0] + y * ay[0] + (z || 0) * nx, x * ax[1] + y * ay[1] + (z || 0) * ny, x * ax[2] + y * ay[2] + (z || 0) * nz] };
}
/** 2B ops (yay/elips dâhil) → OCS'ten dünyaya örneklenmiş 3B çizgi ops */
function opsToWcs(ops, z, ocs) {
  const out = [];
  const put = (x, y, zz) => { const w = ocs.to(x, y, zz == null ? z : zz); out.push([out.length ? 1 : 0, w[0], w[1], w[2]]); };
  for (const o of ops) {
    if (o[0] === 0 || o[0] === 1) { put(o[1], o[2], o[3]); continue; }
    const pts = [];
    if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], pts);
    else if (o[0] === -2) { arcPts(o[1], o[2], o[3], o[5], o[4], pts); pts.reverse(); }
    else ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
    for (const q of pts) put(q[0], q[1], o[0] === 3 ? z : o[6]);
  }
  return out;
}

export class SceneBuilder {
  /**
   * @param db DwgDatabase
   * @param opts { layerPrefix?: string, xref?: boolean }
   */
  constructor(db, opts = {}) {
    this.db = db;
    this.opts = opts;
    this.prefix = opts.layerPrefix ? opts.layerPrefix + '|' : '';
    this.blocksByName = new Map();
    this.blocksByHandle = new Map();
    for (const b of db.tables.BLOCK_RECORD.entries) {
      this.blocksByName.set((b.name || '').toUpperCase(), b);
      this.blocksByHandle.set(b.handle, b);
    }
    this.layers = new Map();
    for (const l of db.tables.LAYER.entries) this.layers.set(this.prefix + l.name, {
      name: this.prefix + l.name, color: layerColor(l), lt: (l.lineType || 'Continuous'), lw: lwOf(l.lineweight) > 0 ? lwOf(l.lineweight) : LW_DEFAULT,
      frozen: !!l.frozen, off: !!l.off, visible: !(l.frozen || l.off), count: 0 });
    this.ltypes = {};
    for (const lt of db.tables.LTYPE.entries) {
      const pat = (lt.pattern || []).map(p => p.elementLength || 0);
      if (pat.length && lt.totalPatternLength > 0) this.ltypes[lt.name.toUpperCase()] = { name: lt.name, pat, len: lt.totalPatternLength };
    }
    this.styles = {};
    for (const st of (db.tables.STYLE ? db.tables.STYLE.entries : [])) this.styles[(st.name || 'STANDARD').toUpperCase()] = {
      font: fontOf(st.font), width: st.widthFactor || 1, oblique: st.obliqueAngle || 0, height: st.fixedTextHeight || 0 };
    this.imageDefs = new Map();
    for (const d of (db.objects && db.objects.IMAGEDEF) || []) this.imageDefs.set(d.handle, d);
    this.ltscale = (db.header && db.header.LTSCALE) || 1;
    this.counts = {};
    this.xrefs = new Map();
    this.images = new Map();
    this.entityCount = 0;
  }

  layerOf(name) {
    let l = this.layers.get(name);
    if (!l) { l = { name, color: FG, lt: 'Continuous', lw: LW_DEFAULT, frozen: false, off: false, visible: true, count: 0 }; this.layers.set(name, l); }
    return l;
  }

  /** etkin katman, renk, çizgi tipi ve kalınlık (blok bağlamıyla) */
  style(e, ctx) {
    const raw = (e.layer === '0' && ctx.layer) ? ctx.layer : (e.layer || '0');
    const layName = ctx.layer && e.layer === '0' ? raw : this.prefix + raw;
    const lay = this.layerOf(layName);
    let col;
    if (typeof e.color === 'number' && e.colorIndex !== 0 && !(e.colorIndex >= 1 && e.colorIndex <= 255)) col = normColor(e.color & 0xffffff);
    else if (e.colorIndex === 0) col = ctx.color != null ? ctx.color : lay.color;
    else if (e.colorIndex >= 1 && e.colorIndex <= 255) col = ACI[e.colorIndex];
    else col = lay.color;
    let lt = e.lineType || '';
    const u = lt.toUpperCase();
    if (!u || u === 'BYLAYER') lt = lay.lt; else if (u === 'BYBLOCK') lt = ctx.lt || lay.lt;
    const ltu = (lt || 'CONTINUOUS').toUpperCase();
    const lts = this.ltscale * (e.lineTypeScale || 1) * (ctx.lts || 1);
    let lw = lwOf(e.lineweight);
    if (lw === -2) lw = ctx.lw != null ? ctx.lw : lay.lw;
    if (lw < 0) lw = lay.lw;
    return { lay: layName, col, lt: this.ltypes[ltu] ? ltu : null, lts, lw };
  }

  count(t) { this.counts[t] = (this.counts[t] || 0) + 1; }

  /** Üst düzey varlık için bilgi nesnesi (paylaşılır) */
  info(e, st) {
    const inf = { t: e.type, h: e.handle, lay: st.lay, ci: e.colorIndex, col: st.col, lt: e.lineType || '', lw: st.lw };
    if (e.type === 'INSERT') {
      inf.name = e.name;
      const p = e.insertionPoint || {}; inf.x = p.x; inf.y = p.y; inf.z = p.z;
      inf.rot = e.rotation || 0; inf.sx = e.xScale; inf.sy = e.yScale;
      if (e.attribs && e.attribs.length) inf.attrs = e.attribs.map(a => [a.tag || '', textPlain(a.text ? a.text.text : '')]);
    }
    if (e.type === 'DIMENSION') { inf.meas = e.measurement; inf.text = e.text; inf.style = e.styleName; }
    if (e.type === 'TEXT' || e.type === 'MTEXT') { inf.text = textPlain(e.text); inf.style = e.styleName; }
    if (e.type === 'ATTRIB') { inf.text = textPlain(e.text ? e.text.text : ''); inf.tag = e.tag; }
    if (e.type === 'HATCH') { inf.pattern = e.patternName; inf.solid = e.solidFill === 1; }
    if (e.type === 'IMAGE') { const d = this.imageDefs.get(e.imageDefHandle); if (d) inf.file = d.fileName; }
    if (e.xdata && e.xdata.length) {
      const xd = [];
      for (const x of e.xdata) {
        const vals = (x.value || []).map(v => v.value).filter(v => v !== '' && v != null && typeof v !== 'object');
        if (vals.length && /^[\x20-\x7e]+$/.test(x.appName || '')) xd.push([x.appName, vals.slice(0, 20).join(', ')]);
      }
      if (xd.length) inf.xd = xd.slice(0, 12);
    }
    return inf;
  }

  // ---- kurulum --------------------------------------------------------------------
  build() {
    const db = this.db;
    const layouts = [];
    const records = db.tables.BLOCK_RECORD.entries;
    const layoutObjs = (db.objects && db.objects.LAYOUT) || [];
    let model = records.find(b => /^\*MODEL_SPACE$/i.test(b.name || ''));
    let modelEnts = model && model.entities && model.entities.length ? model.entities : null;
    if (!modelEnts) {
      const paper = new Set(records.filter(b => /^\*PAPER_SPACE/i.test(b.name || '')).map(b => b.handle));
      modelEnts = db.entities.filter(e => !paper.has(e.ownerBlockRecordSoftId) && !e.isInPaperSpace && e.type !== 'ATTRIB' && e.type !== 'VIEWPORT');
    }
    layouts.push(this.layout('Model', true, modelEnts, null));
    if (!this.opts.xref) {
      const papers = records.filter(b => /^\*PAPER_SPACE/i.test(b.name || '') && b.entities && b.entities.length);
      const named = papers.map(b => {
        const lo = layoutObjs.find(l => l.paperSpaceTableId === b.handle) || layoutObjs.find(l => l.layoutName && b.layout === l.handle);
        return { b, name: lo ? lo.layoutName : b.name.replace(/^\*/, ''), order: lo ? lo.tabOrder : 99 };
      }).sort((a, b) => a.order - b.order);
      for (const n of named) {
        const L = this.layout(n.name, false, n.b.entities, n.b);
        if (L.prims.length || L.viewports.length) layouts.push(L);
      }
    }
    return {
      layouts,
      layers: [...this.layers.values()],
      ltypes: this.ltypes,
      styles: this.styles,
      xrefs: [...this.xrefs.values()],
      images: [...this.images.values()],
      counts: this.counts,
      solidDiag: this.solidDiagData ? { ...this.solidDiagData, versions: [...this.solidDiagData.versions], unknownTags: [...this.solidDiagData.unknownTags], errors: this.solidDiagData.errors.slice(0, 12) } : null,
      entityCount: this.entityCount,
      blockCount: this.blocksByName.size,
      header: this.headerInfo(),
    };
  }

  headerInfo() {
    const h = this.db.header || {};
    return { INSUNITS: h.INSUNITS, LTSCALE: h.LTSCALE, EXTMIN: h.EXTMIN, EXTMAX: h.EXTMAX, LIMMIN: h.LIMMIN, LIMMAX: h.LIMMAX, CECOLOR: h.CECOLOR ? h.CECOLOR.index : undefined };
  }

  layout(name, isModel, ents, block) {
    this.prims = [];
    this.deferred = [];
    this.viewports = [];
    const root = { m: IDENT, zs: 1, zo: 0, layer: null, color: null, lt: null, lts: 1, lw: null, depth: 0, top: null, info: null };
    for (const e of ents || []) {
      this.entityCount++;
      try { this.entity(e, root); } catch (err) { console.warn('varlık atlandı', e && e.type, err); }
    }
    let ext = this.extents(this.prims);
    for (const d of this.deferred) this.infinite(d.e, d.ctx, ext);
    ext = this.extents(this.prims) || ext;
    if (!isModel) {
      for (const v of this.viewports) { const bb = [v.x0, v.y0, v.x1, v.y1]; ext = ext ? [Math.min(ext[0], bb[0]), Math.min(ext[1], bb[1]), Math.max(ext[2], bb[2]), Math.max(ext[3], bb[3])] : bb; }
    }
    return { name, isModel, prims: this.prims, ext: ext || [0, 0, 1, 1], viewports: this.viewports };
  }

  /** Harici referans dosyası yüklendiğinde: bu veritabanının model uzayını verilen matrislerle kurar */
  buildXref(inserts) {
    const out = [];
    const records = this.db.tables.BLOCK_RECORD.entries;
    const model = records.find(b => /^\*MODEL_SPACE$/i.test(b.name || ''));
    const ents = model && model.entities ? model.entities : this.db.entities;
    for (const ins of inserts) {
      this.prims = []; this.deferred = []; this.viewports = [];
      const root = { m: ins.m, layer: ins.layer, color: ins.color, lt: null, lts: 1, lw: null, depth: 1, top: null, info: null };
      for (const e of ents) { try { this.entity(e, root); } catch (err) { /* atla */ } }
      out.push(...this.prims);
    }
    return { prims: out, layers: [...this.layers.values()], ltypes: this.ltypes, ext: this.extents(out) };
  }

  extents(prims) {
    let ok = false;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of prims) {
      if (p.inf || p.k === 4 || !p.bb || !isFinite(p.bb[0])) continue;
      ok = true;
      if (p.bb[0] < bb[0]) bb[0] = p.bb[0];
      if (p.bb[1] < bb[1]) bb[1] = p.bb[1];
      if (p.bb[2] > bb[2]) bb[2] = p.bb[2];
      if (p.bb[3] > bb[3]) bb[3] = p.bb[3];
    }
    return ok ? bb : null;
  }

  // ---- ilkel ekleme ----------------------------------------------------------------
  addPath(ops, opt, e, ctx) {
    if (!ops.length) return null;
    const m = ctx.m;
    let out;
    if (isIdent(m)) out = ops;
    else if (isSim(m)) {
      const s = simScale(m), r = simRot(m);
      out = ops.map(o => {
        if (o[0] === 0 || o[0] === 1) { const p = apply(m, o[1], o[2]); return [o[0], p[0], p[1], o[3]]; }
        if (o[0] === 2 || o[0] === -2) { const p = apply(m, o[1], o[2]); return [o[0], p[0], p[1], o[3] * s, o[4] + r, o[5] + r, o[6]]; }
        const p = apply(m, o[1], o[2]); return [3, p[0], p[1], o[3] * s, o[4] * s, o[5] + r, o[6], o[7]];
      });
    } else {
      out = [];
      for (const o of ops) {
        if (o[0] === 0 || o[0] === 1) { const p = apply(m, o[1], o[2]); out.push([o[0], p[0], p[1], o[3]]); continue; }
        const pts = [];
        if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], pts);
        else if (o[0] === -2) { arcPts(o[1], o[2], o[3], o[5], o[4], pts); pts.reverse(); }
        else ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], pts);
        for (let i = 0; i < pts.length; i++) { const p = apply(m, pts[i][0], pts[i][1]); out.push([out.length ? 1 : 0, p[0], p[1]]); }
      }
    }
    if (ctx.zs !== 1 || ctx.zo) out = zOps(out, ctx.zs, ctx.zo);
    const st = this.style(e, ctx);
    const scale = isIdent(m) ? 1 : Math.sqrt(Math.abs(det(m))) || 1;
    const p = { k: 0, ops: out, closed: !!opt.closed, fill: !!opt.fill, alpha: opt.alpha == null ? 1 : opt.alpha,
      w: (opt.w || 0) * scale, col: opt.col != null ? opt.col : st.col, lay: st.lay, lt: opt.fill ? null : st.lt, lts: st.lts, lw: st.lw,
      bb: opsBBox(out), info: ctx.info || this.info(e, st), et: e.type, bg: !!opt.bg };
    this.prims.push(p);
    this.layerOf(st.lay).count++;
    return p;
  }

  addText(t, e, ctx, opt = {}) {
    if (!t || t.text == null) return;
    const lines = mtextLines(t.text).filter((l, i, a) => l.length || a.length === 1);
    if (!lines.length || !lines.join('').trim()) return;
    const sty = this.styles[(t.styleName || 'STANDARD').toUpperCase()];
    let h = t.textHeight || t.height || 0;
    if (!(h > 0) && sty && sty.height > 0) h = sty.height;
    if (!(h > 0)) return;
    let x = t.startPoint ? t.startPoint.x : 0, y = t.startPoint ? t.startPoint.y : 0;
    const ha = t.halign || 0, va = t.valign || 0;
    if ((ha !== 0 || va !== 0) && t.endPoint && (t.endPoint.x !== 0 || t.endPoint.y !== 0)) { x = t.endPoint.x; y = t.endPoint.y; }
    const hax = ha === 1 || ha === 4 ? 1 : ha === 2 ? 2 : ha === 3 || ha === 5 ? 1 : 0;
    const vay = ha === 4 ? 2 : va;
    let rot = t.rotation || 0;
    if ((ha === 3 || ha === 5) && t.endPoint && t.startPoint) {
      const dx = t.endPoint.x - t.startPoint.x, dy = t.endPoint.y - t.startPoint.y;
      rot = Math.atan2(dy, dx); x = (t.startPoint.x + t.endPoint.x) / 2; y = (t.startPoint.y + t.endPoint.y) / 2;
    }
    const ws = (t.xScale || 1) * (t.xScale ? 1 : (sty ? sty.width : 1));
    const flip = t.generationFlag || 0;
    this.pushText(x, y, h, rot, lines, hax, vay, ws, e, ctx, { ...opt, font: sty ? sty.font : undefined, obl: t.obliqueAngle || (sty ? sty.oblique : 0), mx: !!(flip & 2), my: !!(flip & 4), z: t.startPoint ? t.startPoint.z : undefined });
  }

  pushText(x, y, h, rot, lines, hax, vay, ws, e, ctx, opt = {}) {
    const m = ctx.m;
    if (!isIdent(m)) {
      const p = apply(m, x, y); x = p[0]; y = p[1];
      const s = Math.sqrt(Math.abs(det(m))) || 1;
      h *= s; rot += Math.atan2(m[1], m[0]);
      if (det(m) < 0) rot = -rot;
    }
    const maxLen = Math.max(...lines.map(l => l.length));
    const wEst = maxLen * h * 0.75 * ws, hEst = h * (1 + 1.667 * (lines.length - 1));
    const R = Math.hypot(wEst, hEst);
    const st = this.style(e, ctx);
    const p = { k: 1, x, y, z: zW(opt.z || 0, ctx), h, rot, lines, ha: hax, va: vay, ws, font: opt.font, obl: opt.obl || 0, mx: !!opt.mx, my: !!opt.my,
      col: opt.col != null ? opt.col : st.col, lay: st.lay, lw: st.lw, bb: [x - R, y - R, x + R, y + R], info: ctx.info || this.info(e, st), et: e.type, spacing: opt.spacing || 1 };
    this.prims.push(p);
    this.layerOf(st.lay).count++;
  }

  addPoint(x, y, z, e, ctx, k = 2) {
    const p = apply(ctx.m, x, y);
    const st = this.style(e, ctx);
    this.prims.push({ k, x: p[0], y: p[1], z: zW(z, ctx), col: st.col, lay: st.lay, bb: [p[0], p[1], p[0], p[1]], info: ctx.info || this.info(e, st), et: e.type });
    if (k === 2) this.layerOf(st.lay).count++;
  }

  // ---- varlıklar ---------------------------------------------------------------------
  entity(e, ctx) {
    if (!e || e.isVisible === false) return;
    if (ctx.depth === 0) { this.count(e.type); ctx = { ...ctx, top: e, info: null }; }
    const flipX = !!(e.extrusionDirection && e.extrusionDirection.z < -0.5);
    const ocs = ocsOf(e);
    if (ocs && this.entityOcs(e, ctx, ocs)) return;
    switch (e.type) {
      case 'ACAD_PROXY_ENTITY': case 'PROXY_ENTITY': this.proxy(e, ctx); break;
      case '3DSOLID': case 'REGION': case 'BODY': case 'MESH': case 'SURFACE': case 'PLANESURFACE': case 'EXTRUDEDSURFACE': case 'LOFTEDSURFACE': case 'NURBSURFACE': case 'REVOLVEDSURFACE': case 'SWEPTSURFACE': this.solid(e, ctx); break;
      case 'LINE': {
        const a = e.startPoint, b = e.endPoint;
        this.addPath([[0, a.x, a.y, a.z], [1, b.x, b.y, b.z]], {}, e, ctx);
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
        const z = e.elevation || 0;
        const ops = [];
        const X = (v) => flipX ? -v.x : v.x;
        ops.push([0, X(vs[0]), vs[0].y, z]);
        for (let i = 0; i < vs.length - 1; i++) {
          const b = (vs[i].bulge || 0) * (flipX ? -1 : 1);
          if (b) bulgeArc(X(vs[i]), vs[i].y, X(vs[i + 1]), vs[i + 1].y, b, ops, z); else ops.push([1, X(vs[i + 1]), vs[i + 1].y, z]);
        }
        if (closed && vs.length > 1) {
          const l = vs[vs.length - 1], b = (l.bulge || 0) * (flipX ? -1 : 1);
          if (b) bulgeArc(X(l), l.y, X(vs[0]), vs[0].y, b, ops, z); else ops.push([1, X(vs[0]), vs[0].y, z]);
        }
        let w = e.constantWidth || 0;
        if (!w) {
          w = Math.max(0, ...vs.map(v => Math.max(v.startWidth || 0, v.endWidth || 0)));
          if (e.type === 'POLYLINE2D') w = Math.max(w, e.startWidth || 0, e.endWidth || 0);
        }
        this.addPath(ops, { closed, w }, e, ctx);
        break;
      }
      case 'POLYLINE3D': {
        const vs = e.vertices || [];
        if (vs.length < 2) break;
        const ops = [[0, vs[0].x, vs[0].y, vs[0].z]];
        for (let i = 1; i < vs.length; i++) ops.push([1, vs[i].x, vs[i].y, vs[i].z]);
        this.addPath(ops, { closed: !!(e.flag & 1) }, e, ctx);
        break;
      }
      case 'POLYLINE_PFACE': case 'POLYLINE_MESH': case 'POLYFACE': {
        if (!e.vertices && this.db.raw3d && this.db.raw3d[e.handle]) { this.solid(e, ctx); break; }   // DWG: köşe/yüz listesi işçiden gelir
        const vs = e.vertices || [];
        // DXF: konum köşeleri 192 (64|128), yüz kayıtları yalnız 128 bayrağını taşır
        const isFace = (v) => (v.flag & 128) && !(v.flag & 64) && (v.polyfaceIndex0 || v.polyfaceIndex1);
        const locs = vs.filter(v => !isFace(v));
        const faces = vs.filter(isFace);
        const M = e.mCount || 0, Nn = e.nCount || 0;
        if (e.type === 'POLYLINE_MESH' && M >= 2 && Nn >= 2 && locs.length >= M * Nn) {     // çokgen ağ: M×N ızgara, dörtgen yüzler
          const closedM = !!(e.flag & 1), closedN = !!(e.flag & 32), at = (i, j) => locs[i * Nn + j];
          for (let i = 0; i < (closedM ? M : M - 1); i++) for (let j = 0; j < (closedN ? Nn : Nn - 1); j++) {
            const q = [at(i, j), at(i, (j + 1) % Nn), at((i + 1) % M, (j + 1) % Nn), at((i + 1) % M, j)];
            this.addPath(q.map((v, k) => [k ? 1 : 0, v.x, v.y, v.z]), { closed: true }, e, ctx);
          }
        } else if (faces.length) {
          for (const f of faces) {
            const idx = [f.polyfaceIndex0, f.polyfaceIndex1, f.polyfaceIndex2, f.polyfaceIndex3].filter(i => i);
            const pts = idx.map(i => locs[Math.abs(i) - 1]).filter(Boolean);
            if (pts.length >= 2) { const ops = [[0, pts[0].x, pts[0].y, pts[0].z]]; for (let i = 1; i < pts.length; i++) ops.push([1, pts[i].x, pts[i].y, pts[i].z]); this.addPath(ops, { closed: pts.length > 2 }, e, ctx); }
          }
        } else if (locs.length > 1) {
          const ops = [[0, locs[0].x, locs[0].y, locs[0].z]]; for (let i = 1; i < locs.length; i++) ops.push([1, locs[i].x, locs[i].y, locs[i].z]); this.addPath(ops, {}, e, ctx);
        }
        break;
      }
      case 'CIRCLE': {
        const cx = flipX ? -e.center.x : e.center.x;
        this.addPath([[0, cx + e.radius, e.center.y, e.center.z], [2, cx, e.center.y, e.radius, 0, TAU, e.center.z]], { closed: true }, e, ctx);
        break;
      }
      case 'ARC': {
        let a0 = e.startAngle, a1 = e.endAngle, cx = e.center.x;
        if (flipX) { cx = -cx; const t = Math.PI - a0; a0 = Math.PI - a1; a1 = t; }
        this.addPath([[0, cx + e.radius * Math.cos(a0), e.center.y + e.radius * Math.sin(a0), e.center.z], [2, cx, e.center.y, e.radius, a0, a1, e.center.z]], {}, e, ctx);
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
      case 'POINT': this.addPoint(e.position.x, e.position.y, e.position.z, e, ctx); break;
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
        const sty = this.styles[(e.styleName || 'STANDARD').toUpperCase()];
        this.pushText(e.insertionPoint.x, e.insertionPoint.y, e.textHeight, rot, lines, hax, vay, 1, e, ctx, { spacing: e.lineSpacing || 1, font: sty ? sty.font : undefined, z: e.insertionPoint.z });
        break;
      }
      case 'INSERT': this.insert(e, ctx); break;
      case 'DIMENSION': case 'ARC_DIMENSION': case 'LARGE_RADIAL_DIMENSION': {
        const blk = e.name ? this.blocksByName.get(e.name.toUpperCase()) : null;
        const st = this.style(e, ctx);
        const info = ctx.info || this.info(e, st);
        if (blk && blk.entities && blk.entities.length) {
          this.block(blk, { ...ctx, layer: e.layer, color: st.col, lt: e.lineType, lw: st.lw, depth: ctx.depth + 1, info });
        } else if (e.textPoint) {
          const txt = e.text && e.text !== '<>' ? e.text : (e.measurement != null ? String(Math.round(e.measurement * 1000) / 1000) : '');
          if (txt) this.pushText(e.textPoint.x, e.textPoint.y, this.dimTextHeight(e), e.textRotation || 0, mtextLines(txt), 1, 2, 1, e, { ...ctx, info });
        }
        break;
      }
      case 'ACAD_TABLE': case 'TABLE': {
        const blk = e.blockRecordHandle ? this.blocksByHandle.get(e.blockRecordHandle) : null;
        if (blk && blk.entities) this.block(blk, { ...ctx, depth: ctx.depth + 1, info: ctx.info || this.info(e, this.style(e, ctx)) });
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
        const ops = [[0, c[0].x, c[0].y, c[0].z]];
        for (let i = 1; i < c.length; i++) ops.push([1, c[i].x, c[i].y, c[i].z]);
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
        const st = this.style(e, ctx);
        const info = ctx.info || this.info(e, st);
        const c2 = { ...ctx, info };
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
            this.addPath(ops, {}, e, c2);
          }
        }
        if (e.textContent && e.textHeight > 0) {
          const p = e.textAnchor || e.contentBasePosition;
          if (p) { info.text = textPlain(e.textContent); this.pushText(p.x, p.y, e.textHeight, e.textRotation || 0, mtextLines(e.textContent), 0, 1, 1, e, c2); }
        }
        if (e.blockContent && e.blockContent.blockContentId) {
          const blk = this.blocksByHandle.get(e.blockContent.blockContentId);
          const bc = e.blockContent;
          if (blk && bc.position) {
            const ins = { insertionPoint: bc.position, rotation: bc.rotation || 0, xScale: bc.scale ? bc.scale.x : 1, yScale: bc.scale ? bc.scale.y : 1 };
            this.block(blk, { ...c2, m: mul(ctx.m, insertMatrix(ins, blk.basePoint)), depth: ctx.depth + 1, layer: e.layer });
          }
        }
        break;
      }
      case 'MLINE': {
        const vs = e.vertices || [];
        if (vs.length < 2) break;
        const n = e.numberOfLines || (vs[0].lines ? vs[0].lines.length : 1);
        const c2 = { ...ctx, info: ctx.info || this.info(e, this.style(e, ctx)) };
        for (let j = 0; j < n; j++) {
          const ops = [];
          for (let i = 0; i < vs.length; i++) {
            const v = vs[i], off = v.lines && v.lines[j] && v.lines[j].segmentParams ? (v.lines[j].segmentParams[0] || 0) : 0;
            const md = v.miterDirection || { x: 0, y: 0 };
            ops.push([ops.length ? 1 : 0, v.vertex.x + md.x * off, v.vertex.y + md.y * off]);
          }
          this.addPath(ops, { closed: !!(e.flags & 2) }, e, c2);
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
          const c = [[p.x, p.y], [p.x + u.x * w, p.y + u.y * w], [p.x + u.x * w + v.x * h, p.y + u.y * w + v.y * h], [p.x + v.x * h, p.y + v.y * h]].map(q => apply(ctx.m, q[0], q[1]));
          const st = this.style(e, ctx);
          const d = this.imageDefs.get(e.imageDefHandle);
          const handle = e.imageDefHandle || e.handle;
          const bb = [Math.min(...c.map(q => q[0])), Math.min(...c.map(q => q[1])), Math.max(...c.map(q => q[0])), Math.max(...c.map(q => q[1]))];
          this.prims.push({ k: 3, quad: c, img: handle, pw: w, ph: h, col: st.col, lay: st.lay, bb, info: ctx.info || this.info(e, st), et: 'IMAGE' });
          this.layerOf(st.lay).count++;
          if (!this.images.has(handle)) this.images.set(handle, { handle, fileName: d ? d.fileName : '', pw: w, ph: h });
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
      case 'VIEWPORT': {
        if (ctx.depth !== 0 || !e.viewportCenter || !(e.width > 0) || !(e.height > 0)) break;
        if (e.viewportId === 1 && this.viewports.length === 0 && !e.displayCenter) break;
        if (e.viewportId === 1) break; // kâğıdın kendisi
        const c = e.viewportCenter, dc = e.displayCenter || { x: 0, y: 0 };
        const vh = e.viewHeight > 0 ? e.viewHeight : e.height;
        this.viewports.push({ x0: c.x - e.width / 2, y0: c.y - e.height / 2, x1: c.x + e.width / 2, y1: c.y + e.height / 2,
          cx: dc.x, cy: dc.y, scale: e.height / vh, twist: e.viewTwistAngle || 0, on: !((e.statusBitFlags || 0) & 131072), handle: e.handle });
        break;
      }
      default: break;
    }
  }

  dimTextHeight(e) {
    const ds = this.db.tables.DIMSTYLE && this.db.tables.DIMSTYLE.entries.find(d => d.name === e.styleName);
    return ds && ds.DIMTXT > 0 ? ds.DIMTXT * (ds.DIMSCALE || 1) : 2.5;
  }

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

  /**
   * Keyfi OCS'li varlıklar (düşey düzlemde çizilmiş daire, polyline, yazı…): OCS koordinatları dünyaya
   * çevrilir; eğriler 3B çizgiye örneklenir. true → varlık işlendi.
   */
  entityOcs(e, ctx, ocs) {
    const T = e.type;
    if (T === 'CIRCLE' || T === 'ARC') {
      const a0 = T === 'ARC' ? e.startAngle : 0, a1 = T === 'ARC' ? e.endAngle : TAU;
      const ops = [[0, e.center.x + e.radius * Math.cos(a0), e.center.y + e.radius * Math.sin(a0), e.center.z], [2, e.center.x, e.center.y, e.radius, a0, a1, e.center.z]];
      this.addPath(opsToWcs(ops, e.center.z || 0, ocs), { closed: T === 'CIRCLE' }, e, ctx); return true;
    }
    if (T === 'LWPOLYLINE' || T === 'POLYLINE2D') {
      let vs = e.vertices || []; if (T === 'POLYLINE2D') { const hasSpline = vs.some(v => v.flag & 8); vs = vs.filter(v => hasSpline ? (v.flag & 8) : !(v.flag & 16)); }
      if (vs.length < 1) return true;
      const closed = !!(e.flag & 1), z = e.elevation || 0, ops = [[0, vs[0].x, vs[0].y, z]];
      for (let i = 0; i < vs.length - 1; i++) { const b = vs[i].bulge || 0; if (b) bulgeArc(vs[i].x, vs[i].y, vs[i + 1].x, vs[i + 1].y, b, ops, z); else ops.push([1, vs[i + 1].x, vs[i + 1].y, z]); }
      if (closed && vs.length > 1) { const l = vs[vs.length - 1], b = l.bulge || 0; if (b) bulgeArc(l.x, l.y, vs[0].x, vs[0].y, b, ops, z); else ops.push([1, vs[0].x, vs[0].y, z]); }
      this.addPath(opsToWcs(ops, z, ocs), { closed }, e, ctx); return true;
    }
    if (T === 'SOLID' || T === 'TRACE') {
      const c = [e.corner1, e.corner2, e.corner4 || e.corner3, e.corner3].filter(Boolean); if (c.length < 3) return true;
      const ops = c.map((q, i) => [i ? 1 : 0, q.x, q.y, q.z || 0]);
      this.addPath(opsToWcs(ops, 0, ocs), { closed: true, fill: true, alpha: 0.9 }, e, ctx); return true;
    }
    if (T === 'POINT') { const w = ocs.to(e.position.x, e.position.y, e.position.z); this.addPoint(w[0], w[1], w[2], e, ctx); return true; }
    if (T === 'TEXT' || T === 'ATTRIB' || T === 'ATTDEF') {
      const t = T === 'TEXT' ? e : e.text; if (!t || !t.startPoint) return false;
      const w = ocs.to(t.startPoint.x, t.startPoint.y, t.startPoint.z);
      const e2 = { ...t, startPoint: { x: w[0], y: w[1], z: w[2] }, endPoint: t.endPoint ? (() => { const q = ocs.to(t.endPoint.x, t.endPoint.y, t.endPoint.z); return { x: q[0], y: q[1], z: q[2] }; })() : t.endPoint };
      if (T === 'TEXT') this.addText(e2, e, ctx); else if (!(e.flags & 1)) this.addText(e2, e, ctx);
      return true;
    }
    if (T === 'MTEXT' && e.insertionPoint) { const w = ocs.to(e.insertionPoint.x, e.insertionPoint.y, e.insertionPoint.z); const e2 = { ...e, insertionPoint: { x: w[0], y: w[1], z: w[2] }, extrusionDirection: null }; this.entity(e2, ctx); return true; }
    if (T === 'INSERT' && e.insertionPoint) { const w = ocs.to(e.insertionPoint.x, e.insertionPoint.y, e.insertionPoint.z); const e2 = { ...e, insertionPoint: { x: w[0], y: w[1], z: w[2] }, extrusionDirection: null }; this.insert(e2, ctx); return true; }
    if (T === 'HATCH') { const e2 = { ...e, extrusionDirection: null }; const before = this.prims.length; this.hatch(e2, ctx); for (let i = before; i < this.prims.length; i++) { const p = this.prims[i]; if (p.k === 0) { p.ops = opsToWcs(p.ops, e.elevation || 0, ocs); p.bb = opsBBox(p.ops); } } return true; }
    return false;
  }

  /** 3DSOLID / REGION / BODY (ACIS) ve MESH: kenarlar çizgi, yüzeyler üçgen (tri:true → 2B'de çizilmez) */
  /**
   * Proxy varlık grafikleri (ODA belirtimi bölüm 29): eklenti nesneleri (Advance Steel, Civil 3D, Plant 3D,
   * NetCAD vb.) ve LibreDWG'nin çözemediği sınıflar için AutoCAD'in dosyaya kaydettiği çizim önbelleği.
   * Çizgi, çokgen, daire/yay, ağ (MESH), kabuk (SHELL) yüzeyleri, yazı; renk, dolgu ve dönüşüm yığını.
   */
  proxy(e, ctx) {
    let g = e.graphics;
    if (!g && e.graphicsData) { const hx = e.graphicsData; const n = hx.length >> 1; g = new Uint8Array(n); for (let i = 0; i < n; i++) g[i] = parseInt(hx.substr(i * 2, 2), 16); }
    if (!g || g.length < 8) return;
    const st = this.style(e, ctx), info = ctx.info || this.info(e, st);
    const c2 = { ...ctx, info };
    const dv = new DataView(g.buffer, g.byteOffset, g.byteLength), N = g.length;
    let p = 0;
    const rl = () => { const v = dv.getInt32(p, true); p += 4; return v; };
    const rd = () => { const v = dv.getFloat64(p, true); p += 8; return v; };
    const pt = () => [rd(), rd(), rd()];
    const align4 = () => { p = (p + 3) & ~3; };
    const ps = () => { let s2 = ''; while (p < N && g[p] !== 0) s2 += String.fromCharCode(g[p++]); p++; align4(); return s2; };
    const pus = () => { let s2 = ''; while (p + 1 < N && (g[p] | (g[p + 1] << 8)) !== 0) { s2 += String.fromCharCode(g[p] | (g[p + 1] << 8)); p += 2; } p += 2; align4(); return s2; };
    const xf = [];
    const X = (q) => { let r = q; for (let i = xf.length - 1; i >= 0; i--) { const m = xf[i]; r = [m[0] * r[0] + m[1] * r[1] + m[2] * r[2] + m[3], m[4] * r[0] + m[5] * r[1] + m[6] * r[2] + m[7], m[8] * r[0] + m[9] * r[1] + m[10] * r[2] + m[11]]; } return r; };
    const m = ctx.m, id = isIdent(m);
    const P = (q) => { const w3 = X(q); const z = zW(w3[2] || 0, ctx); if (id) return [w3[0], w3[1], z]; const w = apply(m, w3[0], w3[1]); return [w[0], w[1], z]; };
    let col = null, fillOn = false;
    const colNow = () => (col != null ? col : st.col);
    const lay = st.lay;
    const pushPath = (pts, closed, face) => {
      if (pts.length < 2) return;
      const ops = pts.map((q, i) => { const w = P(q); return [i ? 1 : 0, w[0], w[1], w[2]]; });
      const pr = { k: 0, ops, closed: !!closed, fill: !!(face && fillOn), face: !!face, alpha: 1, w: 0, col: colNow(), lay, lt: st.lt, lts: st.lts, lw: st.lw, bb: opsBBox(ops), info, et: 'ACAD_PROXY_ENTITY' };
      this.prims.push(pr); this.layerOf(lay).count++;
    };
    const pushTri = (a, b, c) => {
      const A = P(a), B = P(b), C = P(c);
      const ops = [[0, A[0], A[1], A[2]], [1, B[0], B[1], B[2]], [1, C[0], C[1], C[2]]];
      this.prims.push({ k: 0, ops, closed: true, face: true, tri: true, fill: false, alpha: 1, w: 0, col: colNow(), lay, lt: null, lts: 1, lw: 0, bb: opsBBox(ops), info, et: 'ACAD_PROXY_ENTITY' });
    };
    /** 3B çokgen (delikli olabilir) → üçgenler: Newell düzlemine izdüşüm + kulak kesme */
    const faceTris = (loops) => {
      if (!loops.length) return;
      const outer = loops[0];
      if (outer.length === 3 && loops.length === 1) { pushTri(outer[0], outer[1], outer[2]); return; }
      if (outer.length === 4 && loops.length === 1) { pushTri(outer[0], outer[1], outer[2]); pushTri(outer[0], outer[2], outer[3]); return; }
      const nrm = newell(outer); const L = Math.hypot(nrm[0], nrm[1], nrm[2]); if (!(L > 0)) return;
      const n = [nrm[0] / L, nrm[1] / L, nrm[2] / L];
      const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = [ax[1] * n[2] - ax[2] * n[1], ax[2] * n[0] - ax[0] * n[2], ax[0] * n[1] - ax[1] * n[0]]; const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
      const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const to2 = (q) => [q[0] * u[0] + q[1] * u[1] + q[2] * u[2], q[0] * v[0] + q[1] * v[1] + q[2] * v[2]];
      const rings = loops.map(l => l.map(to2)); const map3 = new Map(); const key = (q) => q[0] + ',' + q[1];
      loops.forEach((l, li) => l.forEach((q, qi) => map3.set(key(rings[li][qi]), q)));
      try { const { ring, tris } = triangulate(rings[0], rings.slice(1)); for (const t of tris) { const a = map3.get(key(ring[t[0]])), b = map3.get(key(ring[t[1]])), c = map3.get(key(ring[t[2]])); if (a && b && c) pushTri(a, b, c); } } catch (_) { for (let i = 1; i < outer.length - 1; i++) pushTri(outer[0], outer[i], outer[i + 1]); }
    };
    const circlePts = (c, r, nrm, u0, a0, sweep, segs) => {
      const L = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1; const n = [nrm[0] / L, nrm[1] / L, nrm[2] / L];
      let u = u0; if (!u) { const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; u = [ax[1] * n[2] - ax[2] * n[1], ax[2] * n[0] - ax[0] * n[2], ax[0] * n[1] - ax[1] * n[0]]; }
      const ul = Math.hypot(u[0], u[1], u[2]) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
      const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const k = Math.max(4, Math.ceil(Math.abs(sweep) / TAU * segs)); const out = [];
      for (let i = 0; i <= k; i++) { const a = a0 + sweep * i / k; out.push([c[0] + r * (Math.cos(a) * u[0] + Math.sin(a) * v[0]), c[1] + r * (Math.cos(a) * u[1] + Math.sin(a) * v[1]), c[2] + r * (Math.cos(a) * u[2] + Math.sin(a) * v[2])]); }
      return out;
    };
    /** üç noktadan çember: merkez, yarıçap, normal */
    const circum = (a, b, c) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2]; if (!(nn > 1e-30)) return null;
      const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2], ac2 = ac[0] * ac[0] + ac[1] * ac[1] + ac[2] * ac[2];
      const t1 = [n[1] * ab[2] - n[2] * ab[1], n[2] * ab[0] - n[0] * ab[2], n[0] * ab[1] - n[1] * ab[0]];   // n × ab
      const t2 = [ac[1] * n[2] - ac[2] * n[1], ac[2] * n[0] - ac[0] * n[2], ac[0] * n[1] - ac[1] * n[0]];   // ac × n
      const o = [(t1[0] * ac2 + t2[0] * ab2) / (2 * nn), (t1[1] * ac2 + t2[1] * ab2) / (2 * nn), (t1[2] * ac2 + t2[2] * ab2) / (2 * nn)];
      const cen = [a[0] + o[0], a[1] + o[1], a[2] + o[2]];
      return { c: cen, r: Math.hypot(o[0], o[1], o[2]), n };
    };
    const arc3 = (a, b, c, closed) => {
      const cc = circum(a, b, c); if (!cc) { pushPath([a, b, c], false, false); return; }
      if (closed) { pushPath(circlePts(cc.c, cc.r, cc.n, null, 0, TAU, 48), true, fillOn); return; }
      const u = [(a[0] - cc.c[0]) / cc.r, (a[1] - cc.c[1]) / cc.r, (a[2] - cc.c[2]) / cc.r];
      const L = Math.hypot(cc.n[0], cc.n[1], cc.n[2]) || 1; const n = [cc.n[0] / L, cc.n[1] / L, cc.n[2] / L];
      const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const ang = (q) => { const d = [q[0] - cc.c[0], q[1] - cc.c[1], q[2] - cc.c[2]]; return Math.atan2(d[0] * v[0] + d[1] * v[1] + d[2] * v[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2]); };
      let am = ang(b), ae = ang(c); if (am < 0) am += TAU; if (ae < 0) ae += TAU;
      let sweep = ae; if (am > ae) sweep = ae - TAU;               // orta nokta yayın üstünde olmalı
      pushPath(circlePts(cc.c, cc.r, n, u, 0, sweep, 48), false, false);
    };
    let guard = 0;
    while (p + 8 <= N && guard++ < 5000000) {
      const start = p, size = rl(), type = rl();
      const end = size >= 8 ? start + size : start + 8 + size;
      if (size <= 0 || end > N) break;
      try {
        switch (type) {
          case 2: { const c = pt(), r = rd(), n = pt(); pushPath(circlePts(c, r, n, null, 0, TAU, 48), true, fillOn); break; }
          case 3: { const a = pt(), b = pt(), c = pt(); arc3(a, b, c, true); break; }
          case 4: { const c = pt(), r = rd(), n = pt(), sv = pt(), sw = rd(); const at = rl(); const pts = circlePts(c, r, n, sv, 0, sw, 48); if (at === 1) { pts.push(c); pushPath(pts, true, fillOn); } else if (at === 2) pushPath(pts, true, fillOn); else pushPath(pts, false, false); break; }
          case 5: { const a = pt(), b = pt(), c = pt(); arc3(a, b, c, false); break; }
          case 6: case 32: { const n = rl(); if (n < 0 || n > 4000000) break; const pts = []; for (let i = 0; i < n; i++) pts.push(pt()); pushPath(pts, false, false); break; }
          case 7: { const n = rl(); if (n < 0 || n > 4000000) break; const pts = []; for (let i = 0; i < n; i++) pts.push(pt()); if (pts.length >= 3) { pushPath(pts, true, false); if (fillOn || pts.length <= 4 || true) faceTris([pts]); } break; }
          case 8: {                                               // ağ: satır × sütun köşe ızgarası
            const rows = rl(), cols = rl(); if (rows < 2 || cols < 2 || rows * cols > 4000000) break;
            const V = []; for (let i = 0; i < rows; i++) { const row = []; for (let j = 0; j < cols; j++) row.push(pt()); V.push(row); }
            for (let i = 0; i < rows; i++) pushPath(V[i], false, false);
            for (let j = 0; j < cols; j++) pushPath(V.map(r => r[j]), false, false);
            for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) { pushTri(V[i][j], V[i][j + 1], V[i + 1][j + 1]); pushTri(V[i][j], V[i + 1][j + 1], V[i + 1][j]); }
            break;
          }
          case 9: {                                               // kabuk: köşeler + yüz listesi (+ kenar/yüz öznitelikleri)
            const nv = rl(); if (nv < 0 || nv > 4000000) break; const V = []; for (let i = 0; i < nv; i++) V.push(pt());
            const nf = rl(); if (nf < 0 || nf > 8000000) break; const F = []; for (let i = 0; i < nf; i++) F.push(rl());
            // yüzler: sayaç + indeksler; pozitif sayaç yeni yüz, önceki döngü pozitifse negatif sayaç delik (iki yazım geleneği de)
            const faces = []; let i = 0, prevNeg = true;
            while (i < F.length) { const c = F[i++]; const k = Math.abs(c); if (!k || i + k > F.length) break; const loop = []; for (let q = 0; q < k; q++) { const ix = F[i++]; if (ix >= 0 && ix < nv) loop.push(V[ix]); } if (c < 0 && !prevNeg && faces.length) faces[faces.length - 1].push(loop); else faces.push([loop]); prevNeg = c < 0; }
            // kenar öznitelikleri (görünürlük) ve yüz renkleri
            let edgeVis = null, faceCol = null;
            let nEdges = 0; for (const f of faces) for (const l of f) nEdges += l.length;
            if (p + 4 <= end) { const ef = rl(); if (ef & 0xffff) { if (ef & 1) p += 4 * nEdges; if (ef & 2) p += 4 * nEdges; if (ef & 4) p += 4 * nEdges; if (ef & 0x20) p += 4 * nEdges; if (ef & 0x40) { edgeVis = []; for (let q = 0; q < nEdges && p + 4 <= end; q++) edgeVis.push(rl()); } } }
            if (p + 4 <= end) { const ff = rl(); if (ff & 0xffff) { if (ff & 1) { faceCol = []; for (let q = 0; q < faces.length && p + 4 <= end; q++) faceCol.push(rl()); } } }
            let ei = 0; const saveCol = col; const loops = [], loopHid = [];
            faces.forEach((f, fi) => {
              if (faceCol && faceCol[fi] != null) { const cv = faceCol[fi]; col = (cv > 0 && cv < 256) ? ACI[cv] : (cv > 256 ? (cv & 0xffffff) : saveCol); }
              faceTris(f);
              for (const l of f) { const hid = []; for (let q = 0; q < l.length; q++) { const vis = edgeVis ? edgeVis[ei] : 1; ei++; hid.push(vis === 0); } loops.push(l); loopHid.push(hid); }
            });
            col = saveCol;
            for (const e2 of meshEdges(loops, loopHid)) pushPath(e2, false, false);   // kabuk kenarları: sınır + kırışıklık, eş düzlemli çaprazlar gizli
            break;
          }
          case 10: case 36: { const sp = pt(); pt(); const dir = pt(); const h = rd(); rd(); rd(); const txt = type === 36 ? pus() : ps(); if (txt && h > 0) { const w = P(sp); this.pushText(w[0], w[1], h, Math.atan2(dir[1], dir[0]), mtextLines(txt), 0, 0, 1, e, c2, { z: w[2], col: colNow() }); } break; }
          case 11: case 38: { const sp = pt(); pt(); const dir = pt(); const txt = type === 38 ? pus() : ps(); rl(); rl(); const h = rd(); if (txt && h > 0) { const w = P(sp); this.pushText(w[0], w[1], h, Math.atan2(dir[1], dir[0]), mtextLines(txt), 0, 0, 1, e, c2, { z: w[2], col: colNow() }); } break; }
          case 14: { const c = rl(); col = c === 256 ? null : (c > 0 && c < 256) ? ACI[c] : (c === 0 ? null : (c & 0xffffff)); break; }
          case 20: fillOn = rl() === 1; break;
          case 22: { const r = g[p], gg = g[p + 1], b = g[p + 2]; col = (r << 16) | (gg << 8) | b; break; }
          case 29: case 30: { const mtx = []; for (let i = 0; i < 16; i++) mtx.push(rd()); xf.push(mtx); break; }
          case 31: xf.pop(); break;
          default: break;                                         // extents, layer, ltype, marker, clip, lwpolyline, material, mapper: atlanır
        }
      } catch (_) { /* bozuk kayıt: sonrakine geç */ }
      p = end;
    }
    this.count('ACAD_PROXY_ENTITY_GRAFIK');
  }
  /** katı tanılaması: dosya bilgisinde gösterilir (yüzey türleri, atlanan yüzler, bilinmeyen SAB etiketleri, hatalar) */
  solidDiag(e, t, err) {
    const d = this.solidDiagData || (this.solidDiagData = { solids: 0, faces: 0, skipped: 0, approx: 0, surfaces: {}, versions: new Set(), unknownTags: new Set(), errors: [] });
    d.solids++;
    if (t) {
      d.faces += t.faces || 0; d.skipped += t.skipped || 0; d.approx += t.approx || 0;
      for (const [k, v] of Object.entries(t.surfaces || {})) d.surfaces[k] = (d.surfaces[k] || 0) + v;
      if (t.version) d.versions.add(t.version);
      for (const u of t.unknownTags || []) d.unknownTags.add(u);
      if (!t.faces && !(t.tris && t.tris.length)) d.errors.push((e.type || '') + ' ' + (e.handle || '') + ': yüzey yok (' + (t.records || 0) + ' kayıt)');
    } else if (err) d.errors.push((e.type || '') + ' ' + (e.handle || '') + ': ' + (err.message || err));
  }
  solid(e, ctx) {
    const raw = (this.db.raw3d && this.db.raw3d[e.handle]) || (e.acisText ? { acis: e.acisText } : null);
    const st = this.style(e, ctx), info = ctx.info || this.info(e, st);
    const edges = [], tris = [];
    if (raw && raw.mesh) {
      const V = raw.mesh.verts, F = raw.mesh.faces, H = raw.mesh.hidden;
      const fl = [], hl = [];
      for (let i = 0; i < F.length;) {
        const n = F[i++]; if (n < 2 || i + n > F.length) break; const base = i; const idx = F.slice(i, i + n); i += n;
        const pts = idx.map(j => V[j]).filter(Boolean); if (pts.length < 2) continue;
        fl.push(pts); hl.push(H ? idx.map((_, k) => !!H[base + k]) : null);
        for (let k = 1; k < pts.length - 1; k++) tris.push(pts[0], pts[k], pts[k + 1]);
      }
      for (const e2 of meshEdges(fl, hl)) edges.push(e2);   // eş düzlemli komşu yüzler arasındaki üçgenleme kenarları çizilmez
    } else if (raw && raw.acis) {
      try {
        const key = e.handle; let t = this._acisCache && this._acisCache.get(key);
        if (!t) { t = tessellate(parseAcis(raw.acis), { arcSegs: 32 }); (this._acisCache || (this._acisCache = new Map())).set(key, t); }
        this.solidDiag(e, t, null);
        for (const pl of t.edges) edges.push(pl);
        for (let i = 0; i + 8 < t.tris.length; i += 9) tris.push([t.tris[i], t.tris[i + 1], t.tris[i + 2]], [t.tris[i + 3], t.tris[i + 4], t.tris[i + 5]], [t.tris[i + 6], t.tris[i + 7], t.tris[i + 8]]);
        if (!t.faces && raw.wires) for (const w of raw.wires) edges.push(w);
      } catch (err) { this.solidDiag(e, null, err); if (raw.wires) for (const w of raw.wires) edges.push(w); }
    } else if (raw && raw.wires) { this.solidDiag(e, null, new Error('ACIS verisi yok (yalnız tel kafes önbelleği)')); for (const w of raw.wires) edges.push(w); }
    else this.solidDiag(e, null, new Error('ACIS verisi yok'));
    if (!edges.length && !tris.length) return;
    const m = ctx.m, id = isIdent(m);
    const P = (q) => { const z = zW(q[2] || 0, ctx); if (id) return [q[0], q[1], z]; const w = apply(m, q[0], q[1]); return [w[0], w[1], z]; };
    for (const pl of edges) {
      if (pl.length < 2) continue;
      const ops = pl.map((q, i) => { const w = P(q); return [i ? 1 : 0, w[0], w[1], w[2]]; });
      this.prims.push({ k: 0, ops, closed: false, fill: false, alpha: 1, w: 0, col: st.col, lay: st.lay, lt: st.lt, lts: st.lts, lw: st.lw, bb: opsBBox(ops), info, et: e.type });
      this.layerOf(st.lay).count++;
    }
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const a = P(tris[i]), b = P(tris[i + 1]), c = P(tris[i + 2]);
      const ops = [[0, a[0], a[1], a[2]], [1, b[0], b[1], b[2]], [1, c[0], c[1], c[2]]];
      this.prims.push({ k: 0, ops, closed: true, face: true, tri: true, fill: false, alpha: 1, w: 0, col: st.col, lay: st.lay, lt: null, lts: 1, lw: 0, bb: opsBBox(ops), info, et: e.type });
    }
  }

  insert(e, ctx) {
    const blk = this.blocksByName.get((e.name || '').toUpperCase());
    if (!blk || ctx.depth > 24) return;
    const st = this.style(e, ctx);
    const info = ctx.info || this.info(e, st);
    const ip = e.insertionPoint || { x: 0, y: 0, z: 0 };
    if (ctx.depth === 0) this.addPoint(ip.x, ip.y, ip.z, e, { ...ctx, info }, 4);
    const isXref = (blk.flags & 4) || (blk.flags & 8);
    const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const m = mul(ctx.m, insertMatrix(e, blk.basePoint, c * (e.columnSpacing || 0), r * (e.rowSpacing || 0)));
        if (isXref && !(blk.entities && blk.entities.length)) {
          const key = (blk.name || '').toUpperCase();
          if (!this.xrefs.has(key)) this.xrefs.set(key, { name: blk.name, inserts: [] });
          this.xrefs.get(key).inserts.push({ m, layer: st.lay, color: st.col });
          continue;
        }
        const zs = e.zScale || 1, bz = (blk.basePoint && blk.basePoint.z) || 0;
        const sub = { m, zs: (ctx.zs || 1) * zs, zo: (ctx.zo || 0) + (ctx.zs || 1) * ((ip.z || 0) - zs * bz), layer: st.lay, color: st.col, lt: e.lineType, lts: (ctx.lts || 1) * (e.lineTypeScale || 1), lw: st.lw, depth: ctx.depth + 1, top: ctx.top, info };
        if (blk.entities) this.block(blk, sub);
      }
    }
    for (const a of e.attribs || []) this.entity(a, { ...ctx, layer: st.lay, color: st.col, info });
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

/** Karşılaştırma için ilkel imzası (koordinatlar yuvarlanır) */
export function primSignature(p, q = 1e-3) {
  const r = (v) => Math.round(v / q);
  if (p.k === 0) return 'P' + p.ops.map(o => o[0] + ':' + o.slice(1, o[0] === 0 || o[0] === 1 ? 3 : o.length).map(r).join(',')).join(';') + (p.closed ? 'C' : '') + (p.fill ? 'F' : '');
  if (p.k === 1) return 'T' + r(p.x) + ',' + r(p.y) + ',' + r(p.h) + ':' + p.lines.join('\n');
  if (p.k === 2) return 'N' + r(p.x) + ',' + r(p.y);
  if (p.k === 3) return 'I' + p.quad.map(c => r(c[0]) + ',' + r(c[1])).join(';');
  return null;
}
