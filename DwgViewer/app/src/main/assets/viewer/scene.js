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
import { parseAcis, tessellate } from './acis.js';
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
    const root = { m: IDENT, layer: null, color: null, lt: null, lts: 1, lw: null, depth: 0, top: null, info: null };
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
    const p = { k: 1, x, y, z: opt.z || 0, h, rot, lines, ha: hax, va: vay, ws, font: opt.font, obl: opt.obl || 0, mx: !!opt.mx, my: !!opt.my,
      col: opt.col != null ? opt.col : st.col, lay: st.lay, lw: st.lw, bb: [x - R, y - R, x + R, y + R], info: ctx.info || this.info(e, st), et: e.type, spacing: opt.spacing || 1 };
    this.prims.push(p);
    this.layerOf(st.lay).count++;
  }

  addPoint(x, y, z, e, ctx, k = 2) {
    const p = apply(ctx.m, x, y);
    const st = this.style(e, ctx);
    this.prims.push({ k, x: p[0], y: p[1], z, col: st.col, lay: st.lay, bb: [p[0], p[1], p[0], p[1]], info: ctx.info || this.info(e, st), et: e.type });
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
      case '3DSOLID': case 'REGION': case 'BODY': case 'MESH': this.solid(e, ctx); break;
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
        const vs = e.vertices || [];
        const locs = vs.filter(v => !(v.flag & 128));
        const faces = vs.filter(v => (v.flag & 128));
        if (faces.length) {
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
  solid(e, ctx) {
    const raw = (this.db.raw3d && this.db.raw3d[e.handle]) || (e.acisText ? { acis: e.acisText } : null);
    const st = this.style(e, ctx), info = ctx.info || this.info(e, st);
    const edges = [], tris = [];
    if (raw && raw.mesh) {
      const V = raw.mesh.verts, F = raw.mesh.faces;
      for (let i = 0; i < F.length;) { const n = F[i++]; if (n < 2 || i + n > F.length) break; const idx = F.slice(i, i + n); i += n; const pts = idx.map(j => V[j]).filter(Boolean); if (pts.length < 2) continue; edges.push(pts.concat([pts[0]])); for (let k = 1; k < pts.length - 1; k++) tris.push(pts[0], pts[k], pts[k + 1]); }
    } else if (raw && raw.acis) {
      try {
        const key = e.handle; let t = this._acisCache && this._acisCache.get(key);
        if (!t) { t = tessellate(parseAcis(raw.acis), { arcSegs: 32 }); (this._acisCache || (this._acisCache = new Map())).set(key, t); }
        for (const pl of t.edges) edges.push(pl);
        for (let i = 0; i + 8 < t.tris.length; i += 9) tris.push([t.tris[i], t.tris[i + 1], t.tris[i + 2]], [t.tris[i + 3], t.tris[i + 4], t.tris[i + 5]], [t.tris[i + 6], t.tris[i + 7], t.tris[i + 8]]);
        if (!t.faces && raw.wires) for (const w of raw.wires) edges.push(w);
      } catch (err) { if (raw.wires) for (const w of raw.wires) edges.push(w); }
    } else if (raw && raw.wires) { for (const w of raw.wires) edges.push(w); }
    if (!edges.length && !tris.length) return;
    const m = ctx.m, id = isIdent(m);
    const P = (q) => { if (id) return [q[0], q[1], q[2] || 0]; const w = apply(m, q[0], q[1]); return [w[0], w[1], q[2] || 0]; };
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
        const sub = { m, layer: st.lay, color: st.col, lt: e.lineType, lts: (ctx.lts || 1) * (e.lineTypeScale || 1), lw: st.lw, depth: ctx.depth + 1, top: ctx.top, info };
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
