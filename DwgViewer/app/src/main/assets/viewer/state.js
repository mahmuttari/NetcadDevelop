/* Paylaşılan uygulama durumu ve görünüm matematiği. */
import { GeoRef } from './proj.js';

export const S = {
  // belge
  scene: null, layoutIndex: 0, prims: [], tree: null, layers: new Map(), ltypes: {}, styles: {}, ext: null, hasDoc: false,
  fileName: '', fileKey: '', units: '', unitToM: 1, version: '', counts: {}, entityCount: 0, blockCount: 0,
  images: new Map(),            // imagedef handle → HTMLImageElement
  xrefs: [],                    // [{name, inserts, loaded}]
  // görünüm
  view: { scale: 1, cx: 0, cy: 0 }, W: 1, H: 1, dpr: 1,
  dark: true, showText: true, mono: false, lw: false, lwScale: 3,
  // araçlar
  mode: 'view', measure: [], snap: null, snapModes: new Set(['end', 'mid', 'cen', 'int', 'ins', 'node']), selected: null,
  compare: null,                // { prims, tree, stats }
  notesOn: false, noteTool: 'select', noteColor: '#ff3b30',
  geo: new GeoRef(), gps: { on: false, follow: false, lon: null, lat: null, acc: 0, heading: null, t: 0 },
  basemap: { id: 'none', url: '', opacity: 0.8, wms: '' },
  lastRenderMs: 0, cacheValid: false, cacheView: null, gestureActive: false,
};

export const toWorld = (sx, sy) => [S.view.cx + (sx - S.W / 2) / S.view.scale, S.view.cy - (sy - S.H / 2) / S.view.scale];
export const toScreen = (x, y) => [S.W / 2 + (x - S.view.cx) * S.view.scale, S.H / 2 - (y - S.view.cy) * S.view.scale];

export function fitView(bb, margin = 0.92) {
  if (!bb || !isFinite(bb[0])) return;
  const ew = Math.max(bb[2] - bb[0], 1e-9), eh = Math.max(bb[3] - bb[1], 1e-9);
  S.view.scale = Math.min(S.W / ew, S.H / eh) * margin;
  if (!isFinite(S.view.scale) || S.view.scale <= 0) S.view.scale = 1;
  S.view.cx = (bb[0] + bb[2]) / 2; S.view.cy = (bb[1] + bb[3]) / 2;
}
export function zoomAtScreen(sx, sy, f) {
  const w = toWorld(sx, sy);
  S.view.scale = Math.max(1e-9, Math.min(1e9, S.view.scale * f));
  S.view.cx = w[0] - (sx - S.W / 2) / S.view.scale;
  S.view.cy = w[1] + (sy - S.H / 2) / S.view.scale;
}
/** görünür dünya dikdörtgeni */
export const visibleRect = () => [S.view.cx - S.W / (2 * S.view.scale), S.view.cy - S.H / (2 * S.view.scale), S.view.cx + S.W / (2 * S.view.scale), S.view.cy + S.H / (2 * S.view.scale)];

export const UNITS = { 0: '', 1: 'inç', 2: 'ft', 3: 'mil', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 8: 'µin', 9: 'mils', 10: 'yd', 11: 'Å', 12: 'nm', 13: 'µm', 14: 'dm', 15: 'dam', 16: 'hm', 17: 'Gm' };
export const UNIT_TO_M = { 1: 0.0254, 2: 0.3048, 3: 1609.344, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 8: 2.54e-8, 9: 2.54e-5, 10: 0.9144, 11: 1e-10, 12: 1e-9, 13: 1e-6, 14: 0.1, 15: 10, 16: 100, 17: 1e9 };

const nf3 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
export function fmt(v, d = 3) { if (v == null || !isFinite(v)) return '–'; return (d === 2 ? nf2 : d === 0 ? nf0 : nf3).format(v); }
export const fmtUnit = (v, d) => fmt(v, d) + (S.units ? ' ' + S.units : '');

/** yerel depolama (Android'de dosya, tarayıcıda localStorage) */
export const store = {
  get(key) {
    try { if (window.Android && window.Android.loadText) return window.Android.loadText(key) || ''; } catch (_) { /* geç */ }
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  },
  set(key, val) {
    try { if (window.Android && window.Android.saveText) { window.Android.saveText(key, val); return; } } catch (_) { /* geç */ }
    try { localStorage.setItem(key, val); } catch (_) { /* yoksay */ }
  },
  json(key, def) { try { const v = this.get(key); return v ? JSON.parse(v) : def; } catch (_) { return def; } },
};
