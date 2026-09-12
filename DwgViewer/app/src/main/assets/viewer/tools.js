/*
 * Araç durum makineleri: çizim, düzenleme ve ölçüm.
 *
 * ToolManager, uygulamadan bir "api" nesnesi alır:
 *   snap(w) → {p:[x,y,z],kind}|null    pick(w) → prim|null      sel: Set<prim>
 *   prompt(text, opts)   → komut satırı metni ve giriş alanı ({input:'point'|'number'|'text'|null, buttons:[…]})
 *   run(cmd)             → EditDoc.run
 *   render()  overlay()  toast(msg)  result(rows)  layer()  color()  newKey()
 *   fmt(v)   units()     unitToM()
 * Nokta girişi: dokunma (yakalamalı) ya da yazılı: "x,y" | "x,y,z" | "@dx,dy" | "@L<açı"
 */
import { TAU, flatten, polyArea, pathLength, segDist, opsBBox } from './geom.js';
import { newId, offsetPoints } from './edit.js';
import { t, addStrings } from './i18n.js';
import { askText, askConfirm } from './dialog.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;

export const TOOLS = {
  // çizim  (name/steps Türkçe; en/stepsEn İngilizce — sözlüğe tool_<ad> / tstep_<ad>_<i> anahtarlarıyla kaydedilir)
  line: { name: 'Çizgi', en: 'Line', steps: ['Birinci noktayı seçin', 'İkinci noktayı seçin (devam eder)'], stepsEn: ['Pick the first point', 'Pick the second point (continues)'] },
  pline: { name: 'Polyline', en: 'Polyline', steps: ['Birinci noktayı seçin', 'Sonraki noktayı seçin · Bitir / Kapat'], stepsEn: ['Pick the first point', 'Pick the next point · Finish / Close'] },
  rect: { name: 'Dikdörtgen', en: 'Rectangle', steps: ['Birinci köşeyi seçin', 'Karşı köşeyi seçin'], stepsEn: ['Pick the first corner', 'Pick the opposite corner'] },
  circle: { name: 'Daire', en: 'Circle', steps: ['Merkezi seçin', 'Yarıçap noktasını seçin ya da yarıçapı yazın'], stepsEn: ['Pick the center', 'Pick a radius point or type the radius'] },
  arc3: { name: 'Yay (3 nokta)', en: 'Arc (3 points)', steps: ['Başlangıç noktası', 'Yay üzerinde bir nokta', 'Bitiş noktası'], stepsEn: ['Start point', 'A point on the arc', 'End point'] },
  point: { name: 'Nokta', en: 'Point', steps: ['Noktayı seçin'], stepsEn: ['Pick the point'] },
  text: { name: 'Yazı', en: 'Text', steps: ['Yazı konumunu seçin'], stepsEn: ['Pick the text position'] },
  pline3d: { name: '3B Polyline', en: '3D Polyline', steps: ['Birinci noktayı seçin (kot sorulur)', 'Sonraki noktayı seçin · Bitir'], stepsEn: ['Pick the first point (elevation is asked)', 'Pick the next point · Finish'] },
  face3d: { name: '3B Yüzey', en: '3D Face', steps: ['1. köşe', '2. köşe', '3. köşe', '4. köşe (isteğe bağlı) · Bitir'], stepsEn: ['Vertex 1', 'Vertex 2', 'Vertex 3', 'Vertex 4 (optional) · Finish'] },
  // düzenleme
  select: { name: 'Seç', en: 'Select', steps: ['Nesnelere dokunun (ekle/çıkar) · Bitir'], stepsEn: ['Tap objects (add/remove) · Finish'] },
  move: { name: 'Taşı', en: 'Move', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Hedef nokta (ya da @dx,dy)'], stepsEn: ['Select objects · Finish', 'Base point', 'Target point (or @dx,dy)'] },
  copy: { name: 'Kopyala', en: 'Copy', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Hedef nokta (yineler) · Bitir'], stepsEn: ['Select objects · Finish', 'Base point', 'Target point (repeats) · Finish'] },
  rotate: { name: 'Döndür', en: 'Rotate', steps: ['Nesneleri seçin · Bitir', 'Dönme merkezi', 'Açıyı yazın (°) ya da ikinci noktayı seçin'], stepsEn: ['Select objects · Finish', 'Rotation center', 'Type the angle (°) or pick a second point'] },
  scale: { name: 'Ölçekle', en: 'Scale', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Çarpanı yazın'], stepsEn: ['Select objects · Finish', 'Base point', 'Type the factor'] },
  mirror: { name: 'Aynala', en: 'Mirror', steps: ['Nesneleri seçin · Bitir', 'Ayna çizgisi 1. nokta', 'Ayna çizgisi 2. nokta'], stepsEn: ['Select objects · Finish', 'Mirror line point 1', 'Mirror line point 2'] },
  offset: { name: 'Ofset', en: 'Offset', steps: ['Nesneleri seçin · Bitir', 'Mesafeyi yazın', 'Tarafı seçin (nokta)'], stepsEn: ['Select objects · Finish', 'Type the distance', 'Pick the side (point)'] },
  del: { name: 'Sil', en: 'Delete', steps: ['Nesneleri seçin · Bitir'], stepsEn: ['Select objects · Finish'] },
  setz: { name: 'Kot ata', en: 'Set Z', steps: ['Nesneleri seçin · Bitir', 'Kotu (Z) yazın'], stepsEn: ['Select objects · Finish', 'Type the elevation (Z)'] },
  edittext: { name: 'Yazı düzenle', en: 'Edit text', steps: ['Yazıya dokunun'], stepsEn: ['Tap the text'] },
  // ölçüm
  dist: { name: 'Mesafe', en: 'Distance', steps: ['Noktalara dokunun'], stepsEn: ['Tap points'] },
  area: { name: 'Alan', en: 'Area', steps: ['Köşelere dokunun · Bitir'], stepsEn: ['Tap vertices · Finish'] },
  angle: { name: 'Açı', en: 'Angle', steps: ['Köşe (tepe) noktası', 'Birinci kol noktası', 'İkinci kol noktası'], stepsEn: ['Vertex point', 'First arm point', 'Second arm point'] },
  radius: { name: 'Yarıçap', en: 'Radius', steps: ['Daire ya da yaya dokunun'], stepsEn: ['Tap a circle or arc'] },
  coord: { name: 'Koordinat', en: 'Coordinate', steps: ['Noktaya dokunun'], stepsEn: ['Tap a point'] },
};
{ const tr = {}, en = {}; for (const [k, d] of Object.entries(TOOLS)) { tr['tool_' + k] = d.name; en['tool_' + k] = d.en || d.name; d.steps.forEach((st, i) => { tr[`tstep_${k}_${i}`] = st; en[`tstep_${k}_${i}`] = (d.stepsEn && d.stepsEn[i]) || st; }); } addStrings(tr, en); }
const toolName = (k) => t('tool_' + k);
const toolStep = (k, i) => t(`tstep_${k}_${i}`);
const SELECT_TOOLS = new Set(['move', 'copy', 'rotate', 'scale', 'mirror', 'offset', 'del', 'setz']);

export class ToolManager {
  constructor(api) {
    this.api = api;
    this.active = null;
    this.pts = [];       // toplanan noktalar [x,y,z]
    this.step = 0;
    this.selecting = false;
    this.last = null;    // son nokta (göreli giriş için)
    this.number = null;
    this.draft = null;   // kaplama için önizleme: { segs:[[p,q]…], pts:[…], circle:{c,r}, text }
    this.results = [];
  }
  get running() { return !!this.active; }

  start(name) {
    const def = TOOLS[name];
    if (!def) return;
    this.cancel(true);
    this.active = name; this.pts = []; this.step = 0; this.draft = null; this.results = [];
    if (SELECT_TOOLS.has(name)) {
      this.selecting = this.api.sel.size === 0;
      if (!this.selecting) { this.step = 1; }
    }
    if (name === 'select') this.selecting = true;
    this.say();
  }
  cancel(silent) {
    if (this.active && this.active !== 'select' && this.pts.length && ['pline', 'pline3d', 'face3d', 'area'].includes(this.active)) this.finish();
    this.active = null; this.pts = []; this.step = 0; this.draft = null; this.selecting = false;
    if (!silent) { this.api.prompt(null); this.api.overlay(); }
  }
  say() {
    const def = TOOLS[this.active];
    if (!def) return;
    let text = toolName(this.active) + ': ';
    if (this.selecting) text += toolStep(this.active, 0) + `  [${this.api.sel.size} ${t('selCount')}]`;
    else text += toolStep(this.active, Math.min(this.step, def.steps.length - 1));
    const numberTools = { circle: 1, rotate: 2, scale: 2, offset: 1, setz: 1 };
    const wantsNumber = numberTools[this.active] != null && this.step === numberTools[this.active] && !this.selecting;
    const buttons = [];
    if (this.selecting || ['pline', 'pline3d', 'face3d', 'area', 'copy', 'line', 'dist'].includes(this.active)) buttons.push('finish');
    if (['pline', 'area'].includes(this.active) && this.pts.length > 2) buttons.push('close');
    if (this.pts.length) buttons.push('back');
    if (this.selecting) buttons.push('selall');
    buttons.push('cancel');
    this.api.prompt(text, { input: wantsNumber ? 'number' : (this.selecting ? null : 'point'), buttons });
  }

  // ---- giriş -----------------------------------------------------------------------
  /** yazılı giriş: koordinat ya da sayı */
  typed(text) {
    const s = String(text).trim().replace(/,/g, (m, i, str) => (str.indexOf(',') !== str.lastIndexOf(',') || /\d,\d{1,3}$/.test(str) && !/,.*,/.test(str) && false) ? ',' : ',');
    if (!s) return;
    if (this.selecting) return;
    const numberTools = { circle: 1, rotate: 2, scale: 2, offset: 1, setz: 1 };
    if (numberTools[this.active] != null && this.step === numberTools[this.active]) {
      const v = parseFloat(s.replace(',', '.'));
      if (!isFinite(v)) { this.api.toast(t('numberExpected')); return; }
      this.number = v;
      this.onNumber(v);
      return;
    }
    const p = this.parsePoint(s);
    if (!p) { this.api.toast(t('coordFormat')); return; }
    void this.point(p, null);
  }
  parsePoint(s) {
    const rel = s.startsWith('@');
    const body = rel ? s.slice(1) : s;
    const norm = (v) => parseFloat(v.trim().replace(',', '.'));
    if (body.includes('<')) {
      const [L, A] = body.split('<');
      const l = norm(L), a = norm(A) * D2R;
      if (!isFinite(l) || !isFinite(a)) return null;
      const base = this.last || [0, 0, 0];
      return [base[0] + l * Math.cos(a), base[1] + l * Math.sin(a), base[2] || 0];
    }
    // "x;y" ya da "x y" ya da "x,y" — ondalık ayırıcı nokta kabul edilir
    const parts = body.split(/[;\s]+|,(?=\s*-?\d)/).filter(Boolean);
    if (parts.length < 2) return null;
    const v = parts.map(norm);
    if (v.some(x => !isFinite(x))) return null;
    if (rel) { const b = this.last || [0, 0, 0]; return [b[0] + v[0], b[1] + v[1], (b[2] || 0) + (v[2] || 0)]; }
    return [v[0], v[1], v[2] || 0];
  }
  /** dokunma: w = dünya [x,y]; prim = dokunulan nesne (seçim için) */
  tap(w, screen) {
    if (!this.active) return false;
    if (this.selecting) {
      const p = this.api.pick(w);
      if (p) { if (this.api.sel.has(p)) this.api.sel.delete(p); else this.api.sel.add(p); this.say(); this.api.overlay(); }
      return true;
    }
    if (this.active === 'radius' || this.active === 'edittext') {
      const p = this.api.pick(w);
      if (!p) { this.api.toast(t('noObject')); return true; }
      if (this.active === 'radius') {
        const o = p.k === 0 ? p.ops.find(q => q[0] === 2 || q[0] === -2) : null;
        if (!o) { this.api.toast(t('notCircle')); return true; }
        const u = this.api.units();
        this.api.result([[t('radius'), this.api.fmt(o[3]) + u], [t('diameter'), this.api.fmt(2 * o[3]) + u], [t('center'), this.api.fmt(o[1]) + ' ; ' + this.api.fmt(o[2])], [t('circumference'), this.api.fmt(pathLength(p.ops, p.closed)) + u]]);
        this.draft = { circle: { c: [o[1], o[2]], r: o[3] } }; this.api.overlay();
      } else {
        if (p.k !== 1) { this.api.toast(t('notText')); return true; }
        void this.editText(p);
      }
      return true;
    }
    const numberTools = { circle: 1, rotate: 2, scale: 2, offset: 1, setz: 1 };
    const sn = this.api.snap(w);
    const p = sn ? [sn.p[0], sn.p[1], sn.p[2] != null ? sn.p[2] : 0] : [w[0], w[1], 0];
    if (numberTools[this.active] === this.step && this.active === 'scale') { this.api.toast(t('typeFactor')); return true; }
    if (numberTools[this.active] === this.step && this.active === 'setz') { this.api.toast(t('typeZ')); return true; }
    if (numberTools[this.active] === this.step && this.active === 'offset') { this.api.toast(t('typeDist')); return true; }
    void this.point(p, sn);
    return true;
  }
  /** yazı düzenleme kutusu (uygulama içi diyalog) */
  async editText(p) {
    const old = p.lines.join('\n');
    const txt = await askText(t('textPrompt'), old, { multiline: true });
    if (txt !== null && txt !== old) this.api.run({ op: 'edittext', keys: [p.key], text: txt });
    this.api.render();
  }
  onNumber(v) {
    const A = this.api;
    switch (this.active) {
      case 'circle': { const c = this.pts[0]; this.commit({ type: 'CIRCLE', pts: [c], r: Math.abs(v) }); this.pts = []; this.step = 0; break; }
      case 'rotate': { const c = this.pts[0]; this.xform(rotM(c, v * D2R)); this.done(); break; }
      case 'scale': { const c = this.pts[0]; if (!(v > 0)) { A.toast(t('factorPositive')); return; } this.xform([v, 0, 0, v, c[0] * (1 - v), c[1] * (1 - v)]); this.done(); break; }
      case 'setz': { A.run({ op: 'setz', keys: [...A.sel].map(p => p.key), z: v }); A.toast(t('zSet') + ': ' + A.fmt(v)); this.done(); break; }
      case 'offset': { this.number = v; this.step = 2; this.say(); break; }
      default: break;
    }
    A.render();
  }
  /** toplanan nokta (kot / yazı / ayna onayı sorulabildiğinden async; çağıranlar beklemez) */
  async point(p, sn) {
    const A = this.api;
    this.pts.push(p); this.last = p;
    const n = this.pts.length;
    switch (this.active) {
      case 'line':
        if (n >= 2) { this.commit({ type: 'LINE', pts: [this.pts[n - 2], this.pts[n - 1]] }); this.pts = [p]; }
        this.step = 1; break;
      case 'pline': case 'area': this.step = 1; break;
      case 'pline3d': case 'face3d': {
        if (!sn || sn.p[2] == null) {
          const v = await askText(`${n}. ${t('pointZ')}`, this.last && n > 1 ? String(this.pts[n - 2][2]) : '0', { type: 'number' });
          if (v === null) { this.pts.pop(); return; }
          p[2] = parseFloat(String(v).replace(',', '.')) || 0;
        }
        if (this.active === 'face3d' && n === 4) { this.finish(); return; }
        this.step = Math.min(n, TOOLS[this.active].steps.length - 1); break;
      }
      case 'rect': if (n === 2) { const [a, b] = this.pts; this.commit({ type: 'LWPOLYLINE', closed: true, pts: [[a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]]] }); this.pts = []; this.step = 0; } else this.step = 1; break;
      case 'circle': if (n === 2) { const [c, q] = this.pts; this.commit({ type: 'CIRCLE', pts: [c], r: Math.hypot(q[0] - c[0], q[1] - c[1]) }); this.pts = []; this.step = 0; } else this.step = 1; break;
      case 'arc3': if (n === 3) { const arc = arc3(this.pts[0], this.pts[1], this.pts[2]); if (arc) this.commit({ type: 'ARC', pts: [[arc.cx, arc.cy, this.pts[0][2]]], r: arc.r, a0: arc.a0, a1: arc.a1 }); else A.toast(t('collinear')); this.pts = []; this.step = 0; } else this.step = n; break;
      case 'point': this.commit({ type: 'POINT', pts: [p] }); this.pts = []; break;
      case 'text': {
        const txt = await askText(t('textPrompt'), '', { multiline: true });
        if (txt) { const h = await askText(t('textHeightPrompt'), String(A.textHeight()), { type: 'number' }); const hv = parseFloat(String(h || '').replace(',', '.')); this.commit({ type: 'TEXT', pts: [p], text: txt, h: hv > 0 ? hv : A.textHeight() }); }
        this.pts = []; break;
      }
      case 'move': case 'copy': case 'rotate': case 'scale': case 'mirror': case 'offset': await this.modifyPoint(); break;
      case 'dist': this.step = 1; this.showDist(); break;
      case 'angle': if (n === 3) { const [v, a, b] = this.pts; const ang = Math.abs(angDiff(Math.atan2(a[1] - v[1], a[0] - v[0]), Math.atan2(b[1] - v[1], b[0] - v[0]))) * R2D; A.result([[t('angle'), A.fmt(ang, 2) + '°'], [t('supplement'), A.fmt(360 - ang, 2) + '°'], [t('arm1'), A.fmt(Math.hypot(a[0] - v[0], a[1] - v[1])) + A.units()], [t('arm2'), A.fmt(Math.hypot(b[0] - v[0], b[1] - v[1])) + A.units()]]); this.draft = { segs: [[v, a], [v, b]], pts: this.pts.slice() }; this.pts = []; this.step = 0; } else this.step = n; break;
      case 'coord': {
        const rows = [['X', A.fmt(p[0])], ['Y', A.fmt(p[1])], ['Z', A.fmt(p[2] || 0)]];
        if (sn) rows.push([t('snapLbl'), sn.kind.toUpperCase()]);
        const ll = A.lonLat ? A.lonLat(p[0], p[1]) : null;
        if (ll) rows.push([t('latLon'), ll[1].toFixed(6) + ' / ' + ll[0].toFixed(6)]);
        rows.push([`<div class="full btns"><button class="btn small" id="tCopy">${t('copy')}</button></div>`]);
        A.result(rows, () => A.copy(A.fmt(p[0]) + ';' + A.fmt(p[1]) + ';' + A.fmt(p[2] || 0)));
        this.draft = { pts: [p] }; this.pts = []; break;
      }
      default: break;
    }
    this.updateDraft();
    this.say();
    A.overlay();
  }
  async modifyPoint() {
    const A = this.api;
    const n = this.pts.length;
    if (this.active === 'move' && n === 2) { const [a, b] = this.pts; this.xform([1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], (b[2] || 0) - (a[2] || 0)); this.done(); return; }
    if (this.active === 'copy' && n >= 2) { const a = this.pts[0], b = this.pts[n - 1]; const keys = [...A.sel].map(p => p.key); A.run({ op: 'copy', keys, newKeys: keys.map(() => newId()), m: [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], dz: (b[2] || 0) - (a[2] || 0) }); A.render(); this.step = 2; return; }
    if (this.active === 'rotate' && n === 2) { const [c, q] = this.pts; this.xform(rotM(c, Math.atan2(q[1] - c[1], q[0] - c[0]))); this.done(); return; }
    if (this.active === 'mirror' && n === 2) { const [a, b] = this.pts; const keys = [...A.sel].map(p => p.key); const m = mirrorM(a, b); const keep = await askConfirm(t('keepOriginals')); if (keep) A.run({ op: 'copy', keys, newKeys: keys.map(() => newId()), m }); else A.run({ op: 'xform', keys, m }); A.render(); this.done(); return; }
    if (this.active === 'offset' && this.step === 2) {
      const side = this.pts[n - 1]; const d = Math.abs(this.number || 0);
      const ents = [];
      for (const p of A.sel) {
        if (p.k !== 0) continue;
        const pts = flatten(p.ops).map((q, i) => [q[0], q[1], 0]);
        const o1 = offsetPoints(pts, d, p.closed), o2 = offsetPoints(pts, -d, p.closed);
        if (!o1 || !o2) continue;
        const dist = (arr) => Math.min(...arr.map((q, i) => i ? segDist(side[0], side[1], arr[i - 1][0], arr[i - 1][1], q[0], q[1]) : Infinity));
        const pick = dist(o1) < dist(o2) ? o1 : o2;
        ents.push({ type: pts.length === 2 ? 'LINE' : 'LWPOLYLINE', pts: pick, closed: p.closed, layer: p.lay, color: p.info && p.info.ci != null ? p.info.ci : 256, id: newId() });
      }
      if (ents.length) A.run({ op: 'add', ents }); else A.toast(t('offsetFail'));
      A.render(); this.done(); return;
    }
    this.step = Math.min(n + 1, TOOLS[this.active].steps.length - 1);
  }
  xform(m, dz = 0) { const keys = [...this.api.sel].map(p => p.key); if (!keys.length) return; this.api.run({ op: 'xform', keys, m, dz }); this.api.render(); }
  done() { this.pts = []; this.step = 0; this.api.sel.clear(); this.api.toast(toolName(this.active) + ' ' + t('applied')); this.cancel(); }
  commit(ent) {
    const A = this.api;
    ent.id = newId(); ent.layer = ent.layer || A.layer(); if (ent.color == null) ent.color = A.color();
    A.run({ op: 'add', ents: [ent] });
    A.render();
  }
  /** Bitir düğmesi */
  finish() {
    const A = this.api;
    if (this.selecting) {
      if (!A.sel.size) { A.toast(t('selEmpty')); return; }
      this.selecting = false;
      if (this.active === 'select') { this.cancel(); return; }
      if (this.active === 'del') { A.run({ op: 'delete', keys: [...A.sel].map(p => p.key) }); A.render(); A.toast(t('deleted')); this.done(); return; }
      this.step = 1; this.say(); return;
    }
    const n = this.pts.length;
    if (this.active === 'pline' && n >= 2) { this.commit({ type: 'LWPOLYLINE', pts: this.pts.slice(), closed: false }); this.pts = []; this.step = 0; }
    else if (this.active === 'pline3d' && n >= 2) { this.commit({ type: 'POLYLINE3D', pts: this.pts.slice() }); this.pts = []; this.step = 0; }
    else if (this.active === 'face3d' && n >= 3) { this.commit({ type: '3DFACE', pts: this.pts.slice(0, 4) }); this.pts = []; this.step = 0; }
    else if (this.active === 'area' && n >= 3) { this.showArea(); this.pts = []; this.step = 0; }
    else if (this.active === 'line' || this.active === 'dist') { this.pts = []; this.step = 0; }
    else if (this.active === 'copy') { this.done(); return; }
    this.draft = null; this.say(); A.overlay();
  }
  close() {
    if (this.active === 'pline' && this.pts.length > 2) { this.commit({ type: 'LWPOLYLINE', pts: this.pts.slice(), closed: true }); this.pts = []; this.step = 0; this.draft = null; this.say(); this.api.overlay(); }
    else if (this.active === 'area') this.finish();
  }
  back() { this.pts.pop(); this.step = Math.max(0, this.step - 1); this.updateDraft(); this.say(); this.api.overlay(); }
  selectAll() { for (const p of this.api.visiblePrims()) if (p.k !== 4) this.api.sel.add(p); this.say(); this.api.overlay(); }

  updateDraft() {
    const pts = this.pts;
    if (['pline', 'pline3d', 'area', 'line', 'dist', 'face3d', 'mirror'].includes(this.active)) this.draft = { pts: pts.slice(), segs: pts.slice(1).map((q, i) => [pts[i], q]), close: this.active === 'area' || this.active === 'face3d' };
    else if (this.active === 'rect' && pts.length === 1) this.draft = { pts: pts.slice() };
    else if (this.active === 'circle' && pts.length === 1) this.draft = { pts: pts.slice() };
    else if (this.active === 'arc3') this.draft = { pts: pts.slice(), segs: pts.slice(1).map((q, i) => [pts[i], q]) };
    else if (['move', 'copy', 'rotate', 'scale', 'offset'].includes(this.active)) this.draft = { pts: pts.slice() };
    else if (this.active === 'angle') this.draft = { pts: pts.slice(), segs: pts.slice(1).map(q => [pts[0], q]) };
  }
  showDist() {
    const A = this.api, m = this.pts, u = A.units();
    if (m.length < 2) return;
    const rows = []; let total = 0, total3 = 0;
    for (let i = 1; i < m.length; i++) {
      const d = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]), dz = (m[i][2] || 0) - (m[i - 1][2] || 0), d3 = Math.hypot(d, dz);
      total += d; total3 += d3;
      const ang = Math.atan2(m[i][1] - m[i - 1][1], m[i][0] - m[i - 1][0]) * R2D;
      rows.push([`${i} → ${i + 1}`, `${A.fmt(d)}${u}  ΔX ${A.fmt(m[i][0] - m[i - 1][0])}  ΔY ${A.fmt(m[i][1] - m[i - 1][1])}` + (dz ? `  ΔZ ${A.fmt(dz)}  3B ${A.fmt(d3)}${u}` : '') + `  ${A.fmt(ang, 2)}°` + (A.unitToM() && A.unitToM() !== 1 ? `  = ${A.fmt(d * A.unitToM(), 2)} m` : '')]);
    }
    if (m.length > 2) rows.push([t('total'), A.fmt(total) + u + (total3 !== total ? ` (3B ${A.fmt(total3)}${u})` : '')]);
    A.result(rows);
  }
  showArea() {
    const A = this.api, m = this.pts, u = A.units();
    const area = polyArea(m), per = pathLength(m.map((q, i) => [i ? 1 : 0, q[0], q[1]]), true);
    const rows = [[t('area'), A.fmt(area) + (u ? u + '²' : '')], [t('perimeter'), A.fmt(per) + u], [t('cornersN'), m.length]];
    if (A.unitToM() && A.unitToM() !== 1) rows.push([t('areaM2'), A.fmt(area * A.unitToM() ** 2, 2) + ' m²'], [t('areaDa'), A.fmt(area * A.unitToM() ** 2 / 1000, 3) + ' da']);
    else if (A.unitToM() === 1) rows.push([t('areaDa'), A.fmt(area / 1000, 3) + ' da'], [t('areaHa'), A.fmt(area / 10000, 4) + ' ha']);
    A.result(rows);
    this.draft = { pts: m.slice(), segs: m.slice(1).map((q, i) => [m[i], q]), close: true, keep: true };
  }
}

// ---- yardımcılar ------------------------------------------------------------------------
export function rotM(c, a) { const cs = Math.cos(a), sn = Math.sin(a); return [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]]; }
export function mirrorM(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const A = (dx * dx - dy * dy) / L2, B = 2 * dx * dy / L2;
  // yansıma: p' = R (p - a) + a
  return [A, B, B, -A, a[0] - A * a[0] - B * a[1], a[1] - B * a[0] + A * a[1]];
}
export function arc3(p1, p2, p3) {
  const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  let a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  // orta nokta yay üzerinde olacak şekilde yön seç (saat yönü tersi a0→a1)
  const n = (v) => ((v % TAU) + TAU) % TAU;
  const inCcw = n(am - a0) <= n(a1 - a0);
  if (!inCcw) [a0, a1] = [a1, a0];
  return { cx: ux, cy: uy, r, a0, a1 };
}
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
