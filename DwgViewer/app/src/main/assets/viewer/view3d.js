/*
 * 3B görünüm: WebGL ile çizgi/yüzey/nokta çizimi, yörünge (orbit) kamerası, köşe yakalama ve seçim.
 * Sahne ilkelleri (scene.js) segmentlere ayrılır; yaylar örneklenir; 3DFACE / dolgular üçgenlenir.
 *
 * Görsel stiller (tel kafes, gizli çizgi, gölgeli, gölgeli+kenar, röntgen), renklendirme
 * (nesne / katman / kot / tek renk), zemin ızgarası, eksenler, kesit kutusu, düşey abartı,
 * ön ayarlı kamera açıları (animasyonlu), kamera geçmişi, döner tabla, HUD ve ekran görüntüsü.
 *
 * Seçenekler `opts` içindedir; dışarıdan yalnız `set(key, value)` ile değiştirilir. Kalıcı
 * seçenekler `store 'view3d'` anahtarında tutulur (clip, clipBox, turntable ve zScale hariç).
 */
import { TAU, arcPts, ellipsePts } from './geom.js';
import { FG } from './scene.js';
import { store, fmt as fmtNum } from './state.js';

// ---- gölgelendiriciler ------------------------------------------------------------------------
// Tek program: renk modu (öznitelik / kot rampası / tek renk), aydınlatma, kesit ve derinlik
// solması uniform'larla seçilir. Konumlar sahne merkezine göre (origin) tutulur: büyük UTM
// koordinatlarında float32 hassasiyeti bozulmasın diye.
const VS = `
attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aNrm;
uniform mat4 uMVP; uniform float uZ; uniform float uPointSize; uniform vec2 uOff;
uniform int uColorMode; uniform vec3 uFg; uniform float uZmin; uniform float uZmax;
uniform vec3 uClipMin; uniform vec3 uClipInv; uniform vec3 uEye; uniform vec2 uFadeRange;
varying vec4 vCol; varying vec3 vNrm; varying vec3 vClip; varying float vFade;
vec3 ramp(float t) {
  vec3 c0 = vec3(0.16, 0.36, 0.95), c1 = vec3(0.2, 0.8, 0.9), c2 = vec3(0.25, 0.82, 0.3), c3 = vec3(0.98, 0.85, 0.2), c4 = vec3(0.95, 0.25, 0.2);
  float s = t * 4.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  return mix(c3, c4, clamp(s - 3.0, 0.0, 1.0));
}
void main() {
  vec3 p3 = vec3(aPos.x, aPos.y, aPos.z * uZ);
  vec4 p = uMVP * vec4(p3, 1.0);
  p.xy += uOff * p.w;
  gl_Position = p; gl_PointSize = uPointSize;
  vNrm = aNrm;
  vClip = (aPos - uClipMin) * uClipInv;
  vFade = clamp((distance(p3, uEye) - uFadeRange.x) / max(uFadeRange.y - uFadeRange.x, 1e-6), 0.0, 1.0);
  vec3 rgb = aCol.rgb;
  if (uColorMode == 1) rgb = ramp(clamp((aPos.z - uZmin) / max(uZmax - uZmin, 1e-9), 0.0, 1.0));
  else if (uColorMode == 2) rgb = uFg;
  vCol = vec4(rgb, aCol.a);
}`;
const FS = `
precision mediump float;
varying vec4 vCol; varying vec3 vNrm; varying vec3 vClip; varying float vFade;
uniform float uAlpha; uniform vec4 uOverride; uniform bool uClip;
uniform bool uLit; uniform vec3 uLightDir; uniform float uAmbient; uniform float uIntensity;
uniform float uFade; uniform vec3 uBg;
void main() {
  if (uClip && (vClip.x < 0.0 || vClip.y < 0.0 || vClip.z < 0.0 || vClip.x > 1.0 || vClip.y > 1.0 || vClip.z > 1.0)) discard;
  vec3 rgb = uOverride.a > 0.0 ? uOverride.rgb : vCol.rgb;
  if (uLit) { float d = abs(dot(normalize(vNrm), uLightDir)); rgb *= uAmbient + (1.0 - uAmbient) * d * uIntensity; }
  if (uFade > 0.0) rgb = mix(rgb, uBg, uFade * vFade);
  gl_FragColor = vec4(rgb, vCol.a * uAlpha);
}`;

// ---- küçük matris kütüphanesi (sütun-öncelikli 4x4) ----
function perspective(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; }
function ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; }
function lookAt(eye, c, up) {
  let zx = eye[0] - c[0], zy = eye[1] - c[1], zz = eye[2] - c[2]; let L = Math.hypot(zx, zy, zz) || 1; zx /= L; zy /= L; zz /= L;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; L = Math.hypot(xx, xy, xz) || 1; xx /= L; xy /= L; xz /= L;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
}
function mul4(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
function xform4(m, x, y, z) { const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; }
function translate(tx, ty, tz) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]; }

// ---- yardımcılar ----
/** css renk ('#rgb', '#rrggbb', 'rgb(a,b,c)') ya da [r,g,b] (0..1) → [r,g,b] (0..1); tanınmazsa null */
export function parseColor(c) {
  if (c == null) return null;
  if (Array.isArray(c)) return c.length >= 3 ? [c[0], c[1], c[2]] : null;
  if (typeof c === 'number') return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s); if (m) return [parseInt(m[1][0] + m[1][0], 16) / 255, parseInt(m[1][1] + m[1][1], 16) / 255, parseInt(m[1][2] + m[1][2], 16) / 255];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s); if (m) { const v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s); if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  return null;
}
const toCss = (c) => '#' + [0, 1, 2].map(i => Math.round(Math.max(0, Math.min(1, c[i])) * 255).toString(16).padStart(2, '0')).join('');
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function niceStep(v) { const p = 10 ** Math.floor(Math.log10(v || 1)); const m = v / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
/** açı farkını en kısa yönde alır */
const angDelta = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const reduceMotion = () => {
  try { if (document.body && document.body.classList.contains('reduce-motion')) return true; } catch (_) { /* geç */ }
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
};

/** büyüyen Float32 dizisi (tampon kurulumu için; per-frame değil) */
class Grow {
  constructor(cap = 1024) { this.a = new Float32Array(cap); this.n = 0; }
  push3(x, y, z) { if (this.n + 3 > this.a.length) this.grow(); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n += 3; }
  push4(x, y, z, w) { if (this.n + 4 > this.a.length) this.grow(); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = w; this.n += 4; }
  push1(x) { if (this.n + 1 > this.a.length) this.grow(); this.a[this.n++] = x; }
  grow() { const b = new Float32Array(Math.max(1024, this.a.length * 2)); b.set(this.a); this.a = b; }
  out() { return this.a.subarray(0, this.n); }
}

const PRESET_ANGLES = {
  top: { yaw: -Math.PI / 2, pitch: Math.PI / 2 - 1e-3 },
  bottom: { yaw: -Math.PI / 2, pitch: -Math.PI / 2 + 1e-3 },
  front: { yaw: -Math.PI / 2, pitch: 0.001 },
  back: { yaw: Math.PI / 2, pitch: 0.001 },
  left: { yaw: Math.PI, pitch: 0.001 },
  right: { yaw: 0, pitch: 0.001 },
  iso: { yaw: -Math.PI / 4, pitch: 0.6 },
  isoNE: { yaw: -Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
  isoNW: { yaw: -3 * Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
  isoSE: { yaw: Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
  isoSW: { yaw: 3 * Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
};
const PERSIST_SKIP = new Set(['clip', 'clipBox', 'turntable', 'zScale']);
const ENUMS = {
  style: ['wireframe', 'hidden', 'shaded', 'shadedEdges', 'xray'], colorMode: ['entity', 'layer', 'elevation', 'mono'], lightMode: ['camera', 'fixed'],
  gridZ: ['min', 'zero', 'custom'], bg: ['theme', 'gradient', 'black', 'white', 'custom'], lineWidth: ['thin', 'normal', 'thick'],
  elevLabels: ['off', 'sel', 'visible'], hudPos: ['tl', 'bl'],
};
const FACE_ETS = new Set(['3DFACE', 'POLYFACE', 'POLYLINE_PFACE', 'POLYLINE_MESH']);

export class View3D {
  static DEFAULTS = Object.freeze({
    style: 'wireframe', colorMode: 'entity',
    light: true, lightMode: 'camera', lightIntensity: 0.8, ambient: 0.45,
    grid: true, gridStep: 'auto', gridZ: 'min', gridZValue: 0,
    axes: true, axisLabels: true, compass: true, cube: true,
    fov: 52, bg: 'theme', bgColor: '#000000',
    pointSize: 6, textPoints: true, lineWidth: 'normal',
    clip: null, clipBox: false, turntable: false, turnSpeed: 15, depthFade: false, dimOthers: false,
    elevLabels: 'off', hud: true, hudPos: 'tl',
    touch: Object.freeze({ oneFinger: 'orbit', invertY: false, sensitivity: 1 }),
  });
  static PRESETS = [
    { id: 'top', tr: 'Üst', en: 'Top' }, { id: 'bottom', tr: 'Alt', en: 'Bottom' }, { id: 'front', tr: 'Ön', en: 'Front' }, { id: 'back', tr: 'Arka', en: 'Back' },
    { id: 'left', tr: 'Sol', en: 'Left' }, { id: 'right', tr: 'Sağ', en: 'Right' }, { id: 'iso', tr: 'İzometrik', en: 'Isometric' },
    { id: 'isoNE', tr: 'İzo KD', en: 'Iso NE' }, { id: 'isoNW', tr: 'İzo KB', en: 'Iso NW' }, { id: 'isoSE', tr: 'İzo GD', en: 'Iso SE' }, { id: 'isoSW', tr: 'İzo GB', en: 'Iso SW' },
  ];
  static PRESET_ANGLES = PRESET_ANGLES;

  constructor(canvas) {
    this.cv = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL yok');
    this.gl = gl;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog; gl.useProgram(prog);
    this.aPos = gl.getAttribLocation(prog, 'aPos'); this.aCol = gl.getAttribLocation(prog, 'aCol'); this.aNrm = gl.getAttribLocation(prog, 'aNrm');
    this.u = {};
    for (const n of ['uMVP', 'uZ', 'uPointSize', 'uOff', 'uColorMode', 'uFg', 'uZmin', 'uZmax', 'uClipMin', 'uClipInv', 'uEye', 'uFadeRange', 'uAlpha', 'uOverride', 'uClip', 'uLit', 'uLightDir', 'uAmbient', 'uIntensity', 'uFade', 'uBg']) this.u[n] = gl.getUniformLocation(prog, n);
    // tamponlar: her ad için konum (pos) + renk (col) (+ normal) ayrı
    this.bufs = {};
    this._n = { lines: 0, edges: 0, tris: 0, pts: 0, txt: 0, grid: 0, axes: 0, sel: 0, clipBox: 0, bgq: 0 };
    this.counts = { lines: 0, tris: 0, pts: 0, grid: 0, axes: 0, sel: 0 };
    this.src = {};            // yeniden renklendirme kaynakları
    this.layerNames = []; this.layerRGB = new Float32Array(0); this.layerIdx = new Map();
    this.cam = { yaw: -Math.PI / 4, pitch: 0.6, dist: 100, target: [0, 0, 0], persp: true };
    this.zScale = 1;
    this.center = [0, 0, 0]; this.radius = 1; this.origin = [0, 0, 0];
    this.bb = null; this.zrange = [0, 1];
    this.vertices = [];  // yakalama için [x,y,z,prim]
    this.dark = true;
    this.fg = [0.95, 0.96, 0.97]; this.bgTheme = [0.11, 0.13, 0.16]; this.selColor = [1, 0.62, 0.04];
    this.units = ''; this.gridStep = 1;
    this.hist = []; this.histI = -1;
    this.onChange = null; this.onFrame = null;
    this.lastMvp = null; this._mvpF32 = new Float32Array(16);
    this._anim = null; this._turn = null; this._persistT = 0;
    this.sceneOpts = {}; this.fadeSet = null; this.fadePct = 0; this._selCount = 0;
    // seçenekler
    this.opts = JSON.parse(JSON.stringify(View3D.DEFAULTS));
    this._loadOpts();
    this._bindStop();
    this._uploadBgQuad();
  }

  // ---------------------------------------------------------------------------------
  // seçenekler ve kalıcılık
  // ---------------------------------------------------------------------------------
  _loadOpts() {
    const st = store.json('view3d', null);
    if (!st || typeof st !== 'object') return;
    for (const k of Object.keys(View3D.DEFAULTS)) {
      if (PERSIST_SKIP.has(k) || !(k in st)) continue;
      const v = st[k], def = View3D.DEFAULTS[k];
      if (k === 'touch') { if (v && typeof v === 'object') { if (v.oneFinger === 'orbit' || v.oneFinger === 'pan') this.opts.touch.oneFinger = v.oneFinger; if (typeof v.invertY === 'boolean') this.opts.touch.invertY = v.invertY; if (isFinite(v.sensitivity) && v.sensitivity > 0) this.opts.touch.sensitivity = clamp(+v.sensitivity, 0.25, 4); } continue; }
      if (ENUMS[k]) { if (ENUMS[k].includes(v)) this.opts[k] = v; continue; }
      if (k === 'gridStep') { if (v === 'auto' || (isFinite(v) && v > 0)) this.opts[k] = v; continue; }
      if (typeof def === 'boolean') { if (typeof v === 'boolean') this.opts[k] = v; continue; }
      if (typeof def === 'number') { if (typeof v === 'number' && isFinite(v)) this.opts[k] = v; continue; }
      if (typeof def === 'string') { if (typeof v === 'string') this.opts[k] = v; }
    }
  }
  _persist() {
    clearTimeout(this._persistT);
    this._persistT = setTimeout(() => {
      const o = {};
      for (const k of Object.keys(View3D.DEFAULTS)) if (!PERSIST_SKIP.has(k)) o[k] = this.opts[k];
      store.set('view3d', JSON.stringify(o));
    }, 300);
  }
  _emit(key, value) {
    try { if (typeof this.onChange === 'function') this.onChange(key, value); } catch (_) { /* dinleyici hatası görünümü durdurmasın */ }
    try { window.dispatchEvent(new CustomEvent('dwg:view3d', { detail: { key, value } })); } catch (_) { /* geç */ }
  }
  /** seçeneği uygular, gerekirse ilgili tamponu yeniler, çizer ve bildirir */
  set(key, value) {
    const o = this.opts;
    if (key === 'zScale') { const f = +value; if (!(f > 0) || !isFinite(f)) return; this.zScale = f; this.render(); this._emit('zScale', f); return; }
    if (key === 'persp') { this.cam.persp = !!value; this.render(); this._emit('persp', this.cam.persp); return; }
    if (key === 'touch') { Object.assign(o.touch, value || {}); this._persist(); this._emit('touch', { ...o.touch }); return; }
    if (key.startsWith('touch.')) { const k = key.slice(6); if (!(k in o.touch)) return; o.touch[k] = k === 'sensitivity' ? clamp(+value || 1, 0.25, 4) : k === 'invertY' ? !!value : (value === 'pan' ? 'pan' : 'orbit'); this._persist(); this._emit(key, o.touch[k]); return; }
    if (!(key in View3D.DEFAULTS)) return;
    if (ENUMS[key] && !ENUMS[key].includes(value)) return;
    if (key === 'gridStep') { value = value === 'auto' ? 'auto' : +value; if (value !== 'auto' && !(value > 0)) return; }
    else if (key === 'clip') { value = View3D.validClip(value); }
    else if (typeof View3D.DEFAULTS[key] === 'boolean') value = !!value;
    else if (typeof View3D.DEFAULTS[key] === 'number') { value = +value; if (!isFinite(value)) return; if (key === 'fov') value = clamp(value, 10, 120); if (key === 'pointSize') value = clamp(value, 1, 32); if (key === 'ambient') value = clamp(value, 0, 1); if (key === 'lightIntensity') value = clamp(value, 0, 2); if (key === 'turnSpeed') value = clamp(value, 1, 180); }
    const prev = o[key];
    o[key] = value;
    switch (key) {
      case 'grid': case 'gridStep': case 'gridZ': case 'gridZValue': if (this.bb) this.buildGrid(); break;
      case 'clip': case 'clipBox': this.buildClipBox(); break;
      case 'colorMode': if (value === 'layer' || prev === 'layer') this.recolor(); break;
      case 'turntable': this.setTurntable(value, true); value = o.turntable; break;
      default: break;
    }
    if (!PERSIST_SKIP.has(key)) this._persist();
    this.render();
    this._emit(key, value);
  }
  static validClip(v) {
    if (!v || !Array.isArray(v) || v.length < 6) return null;
    const a = v.slice(0, 6).map(Number); if (a.some(x => !isFinite(x))) return null;
    for (let i = 0; i < 3; i++) if (a[i] > a[i + 3]) { const t = a[i]; a[i] = a[i + 3]; a[i + 3] = t; }
    return a;
  }

  // ---------------------------------------------------------------------------------
  // sahne
  // ---------------------------------------------------------------------------------
  /** ilkelleri tamponlara yükler; opts: { dark, mono, bg, fg, colorMode, fade:{pct, layers:Set}, selColor } */
  setScene(prims, layers, opts = {}) {
    this.sceneOpts = opts;
    const dark = opts.dark !== false;
    this.dark = dark;
    this.fg = parseColor(opts.fg) || (dark ? [0.95, 0.96, 0.97] : [0.07, 0.07, 0.07]);
    this.bgTheme = parseColor(opts.bg) || (dark ? [0.11, 0.13, 0.16] : [1, 1, 1]);
    this.selColor = parseColor(opts.selColor) || [1, 0.62, 0.04];
    if (opts.colorMode && ENUMS.colorMode.includes(opts.colorMode)) this.opts.colorMode = opts.colorMode;
    if (opts.mono) { this.opts.colorMode = 'mono'; this._monoScene = true; }
    else if (this._monoScene && this.opts.colorMode === 'mono') { this.opts.colorMode = 'entity'; this._monoScene = false; }
    this.fadeSet = opts.fade && opts.fade.layers && opts.fade.pct > 0 ? opts.fade.layers : null;
    this.fadePct = opts.fade ? +opts.fade.pct || 0 : 0;
    // katman dizini ve renkleri
    const names = []; const idx = new Map();
    for (const [name, l] of layers) { idx.set(name, names.length); names.push([name, l]); }
    const lrgb = new Float32Array(Math.max(1, names.length + 1) * 3);
    for (let i = 0; i < names.length; i++) { const c = names[i][1].color; const rgb = (c == null || c === FG) ? this.fg : parseColor(c); lrgb[i * 3] = rgb[0]; lrgb[i * 3 + 1] = rgb[1]; lrgb[i * 3 + 2] = rgb[2]; }
    lrgb[names.length * 3] = this.fg[0]; lrgb[names.length * 3 + 1] = this.fg[1]; lrgb[names.length * 3 + 2] = this.fg[2];
    this.layerNames = names.map(n => n[0]); this.layerIdx = idx; this.layerRGB = lrgb;
    const unk = names.length;

    // ön geçiş: kaba boyut tahmini (kapasite)
    const est = Math.min(1 << 18, Math.max(4096, prims.length * 8));
    const B = {};
    for (const n of ['lines', 'edges', 'tris', 'pts', 'txt']) B[n] = { pos: new Grow(n === 'lines' ? est * 3 : 4096), rgb: new Grow(n === 'lines' ? est * 3 : 4096), lay: new Grow(n === 'lines' ? est : 1024), nrm: n === 'tris' ? new Grow(4096) : null };
    const verts = [];
    let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const fg = this.fg;
    const col = (c) => c === FG || c == null ? fg : [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    const bbx = (x, y, z) => { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z; };
    let li = 0, c = fg;
    const push = (b, x, y, z) => { b.pos.push3(x, y, z); b.rgb.push3(c[0], c[1], c[2]); b.lay.push1(li); bbx(x, y, z); };
    const tri = (a, b2, c2) => {
      const t = B.tris;
      // düz normal
      const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      push(t, a[0], a[1], a[2]); push(t, b2[0], b2[1], b2[2]); push(t, c2[0], c2[1], c2[2]);
      t.nrm.push3(nx, ny, nz); t.nrm.push3(nx, ny, nz); t.nrm.push3(nx, ny, nz);
    };
    for (const p of prims) {
      if (p.inf || p.k === 4 || p.k === 3) continue;
      const lay = layers.get(p.lay); if (lay && !lay.visible) continue;
      li = idx.has(p.lay) ? idx.get(p.lay) : unk;
      c = col(p.col);
      if (p.k === 2) { push(B.pts, p.x, p.y, p.z || 0); verts.push([p.x, p.y, p.z || 0, p]); continue; }
      if (p.k === 1) { push(B.txt, p.x, p.y, p.z || 0); continue; }
      const isFace = !!(p.face || (p.closed && FACE_ETS.has(p.et)) || p.fill);
      const LB = isFace ? B.edges : B.lines;
      let cur = null;
      const seg = (a, b2) => { push(LB, a[0], a[1], a[2]); push(LB, b2[0], b2[1], b2[2]); };
      const flush = () => {
        if (cur && cur.length > 1) {
          for (let i = 1; i < cur.length; i++) seg(cur[i - 1], cur[i]);
          if (p.closed && cur.length > 2) seg(cur[cur.length - 1], cur[0]);
          if (isFace && cur.length >= 3) for (let i = 1; i < cur.length - 1; i++) tri(cur[0], cur[i], cur[i + 1]);
        }
        cur = null;
      };
      for (const o of p.ops) {
        if (o[0] === 0) { flush(); cur = [[o[1], o[2], o[3] || 0]]; verts.push([o[1], o[2], o[3] || 0, p]); }
        else if (o[0] === 1) { if (!cur) cur = []; cur.push([o[1], o[2], o[3] || 0]); verts.push([o[1], o[2], o[3] || 0, p]); }
        else if (o[0] === 2 || o[0] === -2) {
          const z = o[6] != null ? o[6] : (cur && cur.length ? cur[cur.length - 1][2] : 0);
          const q = []; if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], q); else { arcPts(o[1], o[2], o[3], o[5], o[4], q); q.reverse(); }
          if (!cur) cur = [];
          for (let i = 0; i < q.length; i++) cur.push([q[i][0], q[i][1], z]);
          verts.push([o[1], o[2], z, p]); verts.push([q[q.length - 1][0], q[q.length - 1][1], z, p]);
        } else { const z = cur && cur.length ? cur[cur.length - 1][2] : 0; const q = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], q); if (!cur) cur = []; for (const r of q) cur.push([r[0], r[1], z]); }
      }
      flush();
    }
    if (!isFinite(bb[0])) bb = [0, 0, 0, 1, 1, 1];
    const bbChanged = !this.bb || this.bb.some((v, i) => Math.abs(v - bb[i]) > 1e-9);
    this.bb = bb;
    this.center = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2];
    this.origin = this.center.slice();
    this.radius = Math.max(1e-6, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], (bb[5] - bb[2])) / 2);
    this.zrange = [bb[2], bb[5]];
    this.vertices = verts;
    // tamponlar: konumlar merkeze göre
    for (const n of ['lines', 'edges', 'tris', 'pts', 'txt']) {
      const b = B[n], pos = b.pos.out(), o = this.origin;
      for (let i = 0; i < pos.length; i += 3) { pos[i] -= o[0]; pos[i + 1] -= o[1]; pos[i + 2] -= o[2]; }
      this.src[n] = { rgb: b.rgb.out(), lay: b.lay.out(), alpha: n === 'txt' ? 0.6 : 1 };
      this.uploadPos(n, pos); if (b.nrm) this.uploadNrm(n, b.nrm.out());
      this._n[n] = pos.length / 3;
    }
    this.recolor();
    this.counts.lines = this._n.lines + this._n.edges; this.counts.tris = this._n.tris; this.counts.pts = this._n.pts + this._n.txt;
    this.buildGrid(); this.buildAxes(); this.buildClipBox();
    if (bbChanged || !this._sceneOnce) { this._sceneOnce = true; this.fit({ animate: false }); }
    this.setSelection(this._lastSel || []);
  }
  /** renk tamponlarını geçerli renk moduna (nesne/katman) ve solgunluğa göre yeniden kurar */
  recolor() {
    const byLayer = this.opts.colorMode === 'layer', fade = this.fadeSet, fa = 1 - this.fadePct / 100, lr = this.layerRGB, names = this.layerNames;
    for (const n of ['lines', 'edges', 'tris', 'pts', 'txt']) {
      const s = this.src[n]; if (!s) continue;
      const cnt = s.lay.length, out = new Float32Array(cnt * 4);
      for (let i = 0; i < cnt; i++) {
        const li = s.lay[i];
        if (byLayer) { out[i * 4] = lr[li * 3]; out[i * 4 + 1] = lr[li * 3 + 1]; out[i * 4 + 2] = lr[li * 3 + 2]; }
        else { out[i * 4] = s.rgb[i * 3]; out[i * 4 + 1] = s.rgb[i * 3 + 1]; out[i * 4 + 2] = s.rgb[i * 3 + 2]; }
        out[i * 4 + 3] = s.alpha * (fade && fade.has(names[li]) ? fa : 1);
      }
      this.uploadCol(n, out);
    }
  }
  _buf(name, kind) { const k = name + ':' + kind; if (!this.bufs[k]) this.bufs[k] = this.gl.createBuffer(); return this.bufs[k]; }
  uploadPos(name, arr) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this._buf(name, 'pos')); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  uploadCol(name, arr) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this._buf(name, 'col')); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  uploadNrm(name, arr) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this._buf(name, 'nrm')); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  /** düz [x,y,z,r,g,b,a,…] dizisini (merkeze göre) yükler — ızgara, eksen, seçim, kesit kutusu */
  upload(name, arr, relative = false) {
    const n = arr.length / 7, pos = new Float32Array(n * 3), colr = new Float32Array(n * 4), o = this.origin;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = arr[i * 7] - (relative ? 0 : o[0]); pos[i * 3 + 1] = arr[i * 7 + 1] - (relative ? 0 : o[1]); pos[i * 3 + 2] = arr[i * 7 + 2] - (relative ? 0 : o[2]);
      colr[i * 4] = arr[i * 7 + 3]; colr[i * 4 + 1] = arr[i * 7 + 4]; colr[i * 4 + 2] = arr[i * 7 + 5]; colr[i * 4 + 3] = arr[i * 7 + 6];
    }
    this.uploadPos(name, pos); this.uploadCol(name, colr);
    this._n[name] = n;
    if (name in this.counts) this.counts[name] = n;
  }
  _uploadBgQuad() { this.upload('bgq', [-1, -1, 0, 0, 0, 0, 1, 1, -1, 0, 0, 0, 0, 1, -1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1], true); }

  /** zemin ızgarası: adım ve kot seçeneklerine göre ayrı tampon */
  buildGrid() {
    const bb = this.bb; if (!bb) return;
    const G = [];
    const w = bb[3] - bb[0], h = bb[4] - bb[1], ext = Math.max(w, h, 1e-9);
    let step = this.opts.gridStep === 'auto' ? niceStep(ext / 10) : +this.opts.gridStep;
    if (!(step > 0)) step = niceStep(ext / 10);
    // eksen başına en çok 200 çizgi
    if (ext / step > 200) step *= Math.pow(2, Math.ceil(Math.log2(ext / step / 200)));
    const x0 = Math.floor(bb[0] / step) * step, x1 = Math.ceil(bb[3] / step) * step, y0 = Math.floor(bb[1] / step) * step, y1 = Math.ceil(bb[4] / step) * step;
    const z = this.opts.gridZ === 'zero' ? 0 : this.opts.gridZ === 'custom' ? (+this.opts.gridZValue || 0) : bb[2];
    const gc = this.dark ? [0.25, 0.3, 0.36] : [0.8, 0.83, 0.87];
    const mc = this.dark ? [0.36, 0.42, 0.5] : [0.68, 0.72, 0.78];
    let k = 0;
    for (let x = x0; x <= x1 + step * 1e-6; x += step, k++) { const cc = k % 5 === 0 ? mc : gc; G.push(x, y0, z, cc[0], cc[1], cc[2], 1, x, y1, z, cc[0], cc[1], cc[2], 1); }
    k = 0;
    for (let y = y0; y <= y1 + step * 1e-6; y += step, k++) { const cc = k % 5 === 0 ? mc : gc; G.push(x0, y, z, cc[0], cc[1], cc[2], 1, x1, y, z, cc[0], cc[1], cc[2], 1); }
    this.gridStep = step; this.gridZ = z;
    this.upload('grid', G);
  }
  /** X (kırmızı) Y (yeşil) Z (mavi) eksenleri, bb köşesinde */
  buildAxes() {
    const bb = this.bb; if (!bb) return;
    const a = Math.max(bb[3] - bb[0], bb[4] - bb[1]) * 0.15 || 1, z = bb[2];
    this.axisLen = a;
    this.upload('axes', [
      bb[0], bb[1], z, 1, 0.27, 0.23, 1, bb[0] + a, bb[1], z, 1, 0.27, 0.23, 1,
      bb[0], bb[1], z, 0.19, 0.86, 0.35, 1, bb[0], bb[1] + a, z, 0.19, 0.86, 0.35, 1,
      bb[0], bb[1], z, 0.26, 0.52, 0.96, 1, bb[0], bb[1], z + a, 0.26, 0.52, 0.96, 1]);
  }
  /** kesit kutusu (12 kenar, vurgu rengi) */
  buildClipBox() {
    const c = this.opts.clip;
    if (!c || !this.opts.clipBox) { this._n.clipBox = 0; return; }
    const s = this.selColor, A = [];
    const P = [[c[0], c[1], c[2]], [c[3], c[1], c[2]], [c[3], c[4], c[2]], [c[0], c[4], c[2]], [c[0], c[1], c[5]], [c[3], c[1], c[5]], [c[3], c[4], c[5]], [c[0], c[4], c[5]]];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of E) A.push(P[i][0], P[i][1], P[i][2], s[0], s[1], s[2], 1, P[j][0], P[j][1], P[j][2], s[0], s[1], s[2], 1);
    this.upload('clipBox', A);
  }
  /** seçili ilkellerin vurgusu (renk: setScene opts.selColor) */
  setSelection(prims) {
    this._lastSel = prims;
    const S = [], s = this.selColor; let n = 0;
    const segp = (a, b) => { S.push(a[0], a[1], a[2], s[0], s[1], s[2], 1, b[0], b[1], b[2], s[0], s[1], s[2], 1); };
    for (const p of prims) {
      n++;
      if (p.k !== 0) { if (p.x != null) segp([p.x, p.y, p.z || 0], [p.x, p.y, (p.z || 0) + this.radius * 0.02]); continue; }
      let cur = null;
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) { const q = [o[1], o[2], o[3] || 0]; if (cur && o[0] === 1) segp(cur, q); cur = q; }
        else if (o[0] === 2 || o[0] === -2) { const z = o[6] || 0; const q = []; if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], q); else { arcPts(o[1], o[2], o[3], o[5], o[4], q); q.reverse(); } for (let i = 1; i < q.length; i++) segp([q[i - 1][0], q[i - 1][1], z], [q[i][0], q[i][1], z]); cur = [q[q.length - 1][0], q[q.length - 1][1], z]; }
        else { const z = cur ? cur[2] : 0; const q = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], q); for (let i = 1; i < q.length; i++) segp([q[i - 1][0], q[i - 1][1], z], [q[i][0], q[i][1], z]); if (q.length) cur = [q[q.length - 1][0], q[q.length - 1][1], z]; }
      }
    }
    this._selCount = n;
    this.upload('sel', S);
  }

  // ---------------------------------------------------------------------------------
  // kamera
  // ---------------------------------------------------------------------------------
  _fovK() { return Math.tan(26 * Math.PI / 180) / Math.tan(clamp(this.opts.fov, 10, 120) * Math.PI / 360); }
  /** sahneyi sığdırır (hedef = merkez) */
  fit({ animate = true } = {}) {
    this.pushHistory();
    this._goto({ target: this.center.slice(), dist: this.radius * 2.2 * this._fovK() }, animate);
    this.pushHistory();
  }
  /** seçime sığdırır; seçim boşsa false */
  fitSelection(prims, { animate = true } = {}) {
    let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const add = (x, y, z) => { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z; };
    for (const p of prims || []) {
      if (!p) continue;
      if (p.k === 1 || p.k === 2) { if (p.x != null) add(p.x, p.y, p.z || 0); continue; }
      if (p.k !== 0 || !p.ops) continue;
      let z = 0;
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) { z = o[3] || 0; add(o[1], o[2], z); }
        else if (o[0] === 2 || o[0] === -2) { z = o[6] != null ? o[6] : z; add(o[1] - o[3], o[2] - o[3], z); add(o[1] + o[3], o[2] + o[3], z); }
        else { const r = Math.max(o[3], o[4]); add(o[1] - r, o[2] - r, z); add(o[1] + r, o[2] + r, z); }
      }
    }
    if (!isFinite(bb[0])) return false;
    const r = Math.max(this.radius * 0.02, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) / 2);
    this.pushHistory();
    this._goto({ target: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2], dist: r * 2.2 * this._fovK() }, animate);
    this.pushHistory();
    return true;
  }
  /** ön ayar açısı; eski adların açıları aynen korunur */
  preset(name, { animate = true } = {}) {
    const a = PRESET_ANGLES[name] || PRESET_ANGLES.iso;
    this.pushHistory();
    this._goto({ yaw: a.yaw, pitch: a.pitch }, animate);
    this.pushHistory();
  }
  getCamera() { const c = this.cam; return { yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: c.target.slice(), persp: c.persp, fov: this.opts.fov }; }
  setCamera(cam, { animate = true } = {}) {
    if (!cam) return;
    this.pushHistory();
    const to = {};
    if (isFinite(cam.yaw)) to.yaw = cam.yaw; if (isFinite(cam.pitch)) to.pitch = clamp(cam.pitch, -1.5708, 1.5708);
    if (cam.dist > 0) to.dist = cam.dist; if (cam.target && cam.target.length >= 3) to.target = [+cam.target[0], +cam.target[1], +cam.target[2]];
    if (typeof cam.persp === 'boolean') this.cam.persp = cam.persp;
    if (isFinite(cam.fov) && cam.fov !== this.opts.fov) { this.opts.fov = clamp(+cam.fov, 10, 120); this._persist(); }
    this._goto(to, animate);
    this.pushHistory();
  }
  /** kamerayı hedefe götürür: hedef değerler hemen cam'e yazılır, görüntü 250 ms'de yumuşar */
  _goto(to, animate) {
    const c = this.cam;
    const from = this._anim ? this._display() : { yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: c.target.slice() };
    if (to.yaw != null) c.yaw = to.yaw; if (to.pitch != null) c.pitch = to.pitch; if (to.dist != null) c.dist = to.dist; if (to.target) c.target = to.target.slice();
    if (!animate || reduceMotion() || !window.requestAnimationFrame) { this._anim = null; this.render(); return; }
    const same = Math.abs(angDelta(from.yaw, c.yaw)) < 1e-6 && Math.abs(from.pitch - c.pitch) < 1e-6 && Math.abs(from.dist - c.dist) < 1e-9 && from.target.every((v, i) => Math.abs(v - c.target[i]) < 1e-9);
    if (same) { this._anim = null; this.render(); return; }
    this._anim = { from, t0: performance.now(), dur: 250 };
    if (!this._animReq) this._animReq = requestAnimationFrame(this._animStep);
    this.render();
  }
  _animStep = () => {
    this._animReq = 0;
    if (!this._anim) return;
    const t = (performance.now() - this._anim.t0) / this._anim.dur;
    if (t >= 1) this._anim = null;
    this.render();
    if (typeof this.onFrame === 'function') { try { this.onFrame(); } catch (_) { /* geç */ } }
    else if (typeof this.onChange === 'function') { try { this.onChange('camera', this.getCamera()); } catch (_) { /* geç */ } }
    if (this._anim) this._animReq = requestAnimationFrame(this._animStep);
  };
  /** çizilen (ara) kamera */
  _display() {
    const c = this.cam, a = this._anim;
    if (!a) return c;
    const t = easeOut(clamp((performance.now() - a.t0) / a.dur, 0, 1)), f = a.from;
    return { yaw: f.yaw + angDelta(f.yaw, c.yaw) * t, pitch: lerp(f.pitch, c.pitch, t), dist: lerp(f.dist, c.dist, t), target: [lerp(f.target[0], c.target[0], t), lerp(f.target[1], c.target[1], t), lerp(f.target[2], c.target[2], t)], persp: c.persp };
  }
  _stopAnim() { if (this._anim) { this._anim = null; } }
  // ---- kamera geçmişi (30) ----
  _camEq(a, b) { return !!a && !!b && Math.abs(a.yaw - b.yaw) < 1e-9 && Math.abs(a.pitch - b.pitch) < 1e-9 && Math.abs(a.dist - b.dist) < 1e-9 && a.persp === b.persp && a.target.every((v, i) => Math.abs(v - b.target[i]) < 1e-9); }
  pushHistory() {
    const cur = this.getCamera();
    if (this.histI >= 0 && this._camEq(this.hist[this.histI], cur)) return;
    this.hist.length = this.histI + 1;
    this.hist.push(cur);
    if (this.hist.length > 30) this.hist.shift();
    this.histI = this.hist.length - 1;
  }
  canHistoryBack() { return this.histI > 0; }
  canHistoryForward() { return this.histI >= 0 && this.histI < this.hist.length - 1; }
  historyBack() {
    if (!this.canHistoryBack()) return false;
    const cur = this.getCamera();
    if (!this._camEq(this.hist[this.histI], cur)) { this.hist.length = this.histI + 1; this.hist.push(cur); if (this.hist.length > 30) this.hist.shift(); this.histI = this.hist.length - 1; }
    this.histI--;
    this._applyHist(this.hist[this.histI]);
    return true;
  }
  historyForward() {
    if (!this.canHistoryForward()) return false;
    this.histI++;
    this._applyHist(this.hist[this.histI]);
    return true;
  }
  _applyHist(h) { const c = this.cam; c.yaw = h.yaw; c.pitch = h.pitch; c.dist = h.dist; c.target = h.target.slice(); c.persp = h.persp; this._anim = null; this.render(); this._emit('camera', this.getCamera()); }

  // ---------------------------------------------------------------------------------
  // çizim
  // ---------------------------------------------------------------------------------
  _eye(c) { const zs = this.zScale; const tgt = [c.target[0], c.target[1], c.target[2] * zs]; return [tgt[0] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), tgt[1] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), tgt[2] + c.dist * Math.sin(c.pitch), tgt]; }
  /** dünya (mutlak) → kırpma matrisi */
  mvp() {
    const cv = this.cv, c = this._display();
    const aspect = cv.width / Math.max(1, cv.height);
    const e = this._eye(c), tgt = e[3], eye = [e[0], e[1], e[2]];
    const view = lookAt(eye, tgt, [0, 0, 1]);
    const near = Math.max(1e-4, c.dist * 0.01), far = c.dist * 10 + this.radius * 10;
    const fov = clamp(this.opts.fov, 10, 120) * Math.PI / 180;
    const hh = c.dist * Math.tan(fov / 2);
    const proj = c.persp ? perspective(fov, aspect, near, far) : ortho(-hh * aspect, hh * aspect, -hh, hh, -far, far);
    return mul4(proj, view);
  }
  _bgColor() {
    const b = this.opts.bg;
    if (b === 'black') return [0, 0, 0]; if (b === 'white') return [1, 1, 1];
    if (b === 'custom') return parseColor(this.opts.bgColor) || this.bgTheme;
    if (b === 'gradient') return this.dark ? [0.09, 0.11, 0.15] : [0.9, 0.92, 0.95];
    return this.bgTheme;
  }
  /** etkin arka plan (css) — HUD ve panel için */
  bgCss() { return toCss(this._bgColor()); }
  /** arka plana göre okunur ön plan (FG(-1) nesneleri için) */
  _fgFor(bg) { return lum(bg) > 0.5 ? [0.07, 0.07, 0.07] : [0.95, 0.96, 0.97]; }
  render() {
    const gl = this.gl, cv = this.cv, o = this.opts;
    if (!cv.width || !cv.height) return;
    gl.viewport(0, 0, cv.width, cv.height);
    const bg = this._bgColor();
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    const u = this.u;
    const fgEff = (o.bg === 'theme') ? this.fg : this._fgFor(bg);
    // gradyan arka plan: tam ekran dörtgen, derinlik yazmadan
    if (o.bg === 'gradient') {
      const top = this.dark ? [0.05, 0.07, 0.11] : [0.98, 0.99, 1], bot = this.dark ? [0.2, 0.25, 0.32] : [0.78, 0.82, 0.88];
      this.uploadCol('bgq', new Float32Array([bot[0], bot[1], bot[2], 1, bot[0], bot[1], bot[2], 1, top[0], top[1], top[2], 1, top[0], top[1], top[2], 1]));
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.uniformMatrix4fv(u.uMVP, false, IDENT4); gl.uniform1f(u.uZ, 1); gl.uniform2f(u.uOff, 0, 0); gl.uniform1i(u.uColorMode, 0); gl.uniform1i(u.uClip, 0); gl.uniform1i(u.uLit, 0); gl.uniform1f(u.uFade, 0); gl.uniform4f(u.uOverride, 0, 0, 0, 0); gl.uniform1f(u.uAlpha, 1);
      this._draw('bgq', gl.TRIANGLE_STRIP, 1);
      gl.depthMask(true);
    }
    gl.enable(gl.DEPTH_TEST);
    const c = this._display();
    const m = this.mvp();
    const mo = mul4(m, translate(this.origin[0], this.origin[1], this.origin[2] * this.zScale));
    for (let i = 0; i < 16; i++) this._mvpF32[i] = mo[i];
    gl.uniformMatrix4fv(u.uMVP, false, this._mvpF32);
    gl.uniform1f(u.uZ, this.zScale);
    gl.uniform2f(u.uOff, 0, 0);
    gl.uniform3f(u.uFg, fgEff[0], fgEff[1], fgEff[2]);
    gl.uniform3f(u.uBg, bg[0], bg[1], bg[2]);
    gl.uniform1f(u.uZmin, this.zrange[0] - this.origin[2]); gl.uniform1f(u.uZmax, this.zrange[1] - this.origin[2]);
    const e = this._eye(c);
    gl.uniform3f(u.uEye, e[0] - this.origin[0], e[1] - this.origin[1], e[2] - this.origin[2] * this.zScale);
    gl.uniform2f(u.uFadeRange, Math.max(0, c.dist - this.radius * 0.5), c.dist + this.radius * 1.5);
    gl.uniform1f(u.uFade, o.depthFade ? 0.75 : 0);
    // kesit
    const cl = o.clip;
    if (cl) { const og = this.origin; gl.uniform1i(u.uClip, 1); gl.uniform3f(u.uClipMin, cl[0] - og[0], cl[1] - og[1], cl[2] - og[2]); gl.uniform3f(u.uClipInv, 1 / Math.max(1e-12, cl[3] - cl[0]), 1 / Math.max(1e-12, cl[4] - cl[1]), 1 / Math.max(1e-12, cl[5] - cl[2])); }
    else gl.uniform1i(u.uClip, 0);
    // ışık
    let L;
    if (o.lightMode === 'fixed') L = [-0.5, -0.5, 0.7071]; else { const cp = Math.cos(c.pitch); L = [cp * Math.cos(c.yaw), cp * Math.sin(c.yaw), Math.sin(c.pitch)]; const k = 0.35; L = [L[0] * (1 - k) - k * 0.6, L[1] * (1 - k) - k * 0.6, L[2] * (1 - k) + k]; }
    const LL = Math.hypot(L[0], L[1], L[2]) || 1;
    gl.uniform3f(u.uLightDir, L[0] / LL, L[1] / LL, L[2] / LL);
    gl.uniform1f(u.uAmbient, o.light ? o.ambient : 1); gl.uniform1f(u.uIntensity, o.light ? o.lightIntensity : 0);
    gl.uniform1i(u.uLit, 0); gl.uniform4f(u.uOverride, 0, 0, 0, 0);
    gl.uniform1f(u.uPointSize, 1);
    const dpr = window.devicePixelRatio || 1;
    // ızgara ve eksenler: renk özniteliğinden, kesitsiz
    gl.uniform1i(u.uColorMode, 0); gl.uniform1i(u.uClip, 0);
    if (o.grid) this._draw('grid', gl.LINES, 0.6);
    if (o.axes) this._draw('axes', gl.LINES, 1);
    if (cl) gl.uniform1i(u.uClip, 1);
    // nesneler
    const cm = o.colorMode === 'elevation' ? 1 : o.colorMode === 'mono' ? 2 : 0;
    gl.uniform1i(u.uColorMode, cm);
    const dim = o.dimOthers && this._selCount > 0 ? 0.3 : 1;
    const style = this._n.tris ? o.style : (o.style === 'xray' ? 'xray' : 'wireframe');
    const lit = o.light && (style === 'shaded' || style === 'shadedEdges');
    if (style === 'hidden') {
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.uniform4f(u.uOverride, bg[0], bg[1], bg[2], 1);
      this._draw('tris', gl.TRIANGLES, 1, true);
      gl.uniform4f(u.uOverride, 0, 0, 0, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    } else if (style === 'shaded' || style === 'shadedEdges') {
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.uniform1i(u.uLit, lit ? 1 : 0);
      this._draw('tris', gl.TRIANGLES, dim, true);
      gl.uniform1i(u.uLit, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    } else if (style === 'xray') {
      gl.depthMask(false);
      this._draw('tris', gl.TRIANGLES, 0.25 * dim, true);
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
    }
    // çizgiler (kalınlık: NDC ofsetli tekrar)
    const segs = (this._n.lines + this._n.edges) / 2;
    const lw = segs > 300000 ? 'thin' : o.lineWidth;
    const offs = lw === 'thick' ? THICK_OFFS : lw === 'normal' ? NORMAL_OFFS : THIN_OFFS;
    const px = 2 / cv.width, py = 2 / cv.height;
    for (let i = 0; i < offs.length; i++) {
      gl.uniform2f(u.uOff, offs[i][0] * px, offs[i][1] * py);
      this._draw('lines', gl.LINES, dim);
      if (style !== 'shaded') this._draw('edges', gl.LINES, dim);
    }
    gl.uniform2f(u.uOff, 0, 0);
    gl.uniform1f(u.uPointSize, o.pointSize * dpr);
    this._draw('pts', gl.POINTS, dim);
    if (o.textPoints) { gl.uniform1f(u.uPointSize, o.pointSize * 0.7 * dpr); this._draw('txt', gl.POINTS, dim); }
    // seçim, kesit kutusu: derinlik testi kapalı, kesitsiz
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1i(u.uColorMode, 0); gl.uniform1i(u.uClip, 0); gl.uniform1f(u.uFade, 0);
    for (let i = 0; i < NORMAL_OFFS2.length; i++) { gl.uniform2f(u.uOff, NORMAL_OFFS2[i][0] * px, NORMAL_OFFS2[i][1] * py); this._draw('sel', gl.LINES, 1); }
    gl.uniform2f(u.uOff, 0, 0);
    if (o.clipBox && cl) this._draw('clipBox', gl.LINES, 0.9);
    gl.enable(gl.DEPTH_TEST);
    this.lastMvp = m;
  }
  _draw(name, mode, alpha, withNrm = false) {
    const n = this._n[name]; if (!n) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name + ':pos']);
    gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name + ':col']);
    gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 4, gl.FLOAT, false, 0, 0);
    if (this.aNrm >= 0) {
      if (withNrm && this.bufs[name + ':nrm']) { gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name + ':nrm']); gl.enableVertexAttribArray(this.aNrm); gl.vertexAttribPointer(this.aNrm, 3, gl.FLOAT, false, 0, 0); }
      else { gl.disableVertexAttribArray(this.aNrm); gl.vertexAttrib3f(this.aNrm, 0, 0, 1); }
    }
    gl.uniform1f(this.u.uAlpha, alpha);
    gl.drawArrays(mode, 0, n);
  }
  /** dünya → ekran (css px) */
  project(x, y, z) {
    const m = this.lastMvp || this.mvp();
    const p = xform4(m, x, y, (z || 0) * this.zScale);
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    return [(p[0] + 1) / 2 * W, (1 - p[1]) / 2 * H, p[2]];
  }
  /** ekran noktasına en yakın köşe (yakalama); kesit dışı köşeler yok sayılır */
  pickVertex(sx, sy, tol = 18) {
    let best = null, bd = tol;
    const cl = this.opts.clip;
    const m = this.lastMvp || this.mvp(), W = this.cv.clientWidth, H = this.cv.clientHeight, zs = this.zScale;
    for (const v of this.vertices) {
      if (cl && (v[0] < cl[0] || v[1] < cl[1] || v[2] < cl[2] || v[0] > cl[3] || v[1] > cl[4] || v[2] > cl[5])) continue;
      const x = v[0], y = v[1], z = v[2] * zs;
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      const pz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      if (pz < -1 || pz > 1) continue;
      const px = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) / 2 * W, py = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2 * H;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = { p: [v[0], v[1], v[2]], prim: v[3] }; }
    }
    return best;
  }
  // ---- hareketler ----
  orbit(dx, dy) {
    this._stopAnim();
    const t = this.opts.touch, k = 0.01 * (t.sensitivity || 1), inv = t.invertY ? -1 : 1;
    this.cam.yaw -= dx * k; this.cam.pitch = Math.max(-1.5, Math.min(1.55, this.cam.pitch + inv * dy * k));
  }
  zoom(f) { this._stopAnim(); this.cam.dist = Math.max(this.radius * 0.01, Math.min(this.radius * 50, this.cam.dist / f)); }
  pan(dx, dy) {
    this._stopAnim();
    const c = this.cam, W = this.cv.clientWidth || 1;
    const k = c.dist * 1.0 / W;
    const rx = [-Math.sin(c.yaw), Math.cos(c.yaw), 0];
    const up = [-Math.sin(c.pitch) * Math.cos(c.yaw), -Math.sin(c.pitch) * Math.sin(c.yaw), Math.cos(c.pitch)];
    c.target[0] += (-dx * rx[0] + dy * up[0]) * k; c.target[1] += (-dx * rx[1] + dy * up[1]) * k; c.target[2] += (dy * up[2]) * k / this.zScale;
  }

  // ---------------------------------------------------------------------------------
  // döner tabla
  // ---------------------------------------------------------------------------------
  _bindStop() {
    // kendi dinleyicisi: dokunuş döner tablayı durdurur (kabuğa bağımlı değil)
    this.cv.addEventListener('pointerdown', () => { if (this._turn) this.setTurntable(false); }, true);
    try { document.addEventListener('visibilitychange', () => { if (document.hidden && this._turn) this.setTurntable(false); }); } catch (_) { /* geç */ }
  }
  setTurntable(on, fromSet = false) {
    on = !!on;
    if (on && reduceMotion()) on = false;
    if (on === !!this._turn) { if (this.opts.turntable !== on) { this.opts.turntable = on; if (!fromSet) this._emit('turntable', on); } return; }
    if (!on) {
      if (this._turn) { cancelAnimationFrame(this._turn.req); clearTimeout(this._turn.stopT); }
      this._turn = null; this.opts.turntable = false;
      if (!fromSet) this._emit('turntable', false);
      return;
    }
    this.opts.turntable = true;
    const st = { req: 0, last: performance.now(), stopT: 0 };
    this._turn = st;
    const step = (now) => {
      if (this._turn !== st) return;
      const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
      this.cam.yaw -= this.opts.turnSpeed * Math.PI / 180 * dt;
      this._anim = null;
      this.render();
      if (typeof this.onFrame === 'function') { try { this.onFrame(); } catch (_) { /* geç */ } }
      st.req = requestAnimationFrame(step);
    };
    st.req = requestAnimationFrame(step);
    st.stopT = setTimeout(() => { if (this._turn === st) { this.setTurntable(false); } }, 60000);
    if (!fromSet) this._emit('turntable', true);
  }
  stopTurntable() { this.setTurntable(false); }

  // ---------------------------------------------------------------------------------
  // ekran görüntüsü ve HUD
  // ---------------------------------------------------------------------------------
  /** WebGL tuvali + (varsa) kaplama tuvali cihaz pikselinde birleştirilir → dataURL */
  screenshot({ overlay = null } = {}) {
    this.render();
    const cv = this.cv, out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    const c = out.getContext('2d');
    c.drawImage(cv, 0, 0);
    if (overlay && overlay.width && overlay.height) c.drawImage(overlay, 0, 0, overlay.width, overlay.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }
  /** durum çubuğu / HUD metni */
  hudText() {
    const c = this.cam, u = this.units ? ' ' + this.units : '';
    let s = `Yaw ${fmtNum(c.yaw * 180 / Math.PI, 0)}°  Pitch ${fmtNum(c.pitch * 180 / Math.PI, 0)}°  Z×${fmtNum(this.zScale, 2)}  Izgara ${fmtNum(this.gridStep)}${u}  ${c.persp ? 'Persp.' : 'Orto.'}`;
    if (!this._n.tris) s += ' · Yüzey yok';
    return s;
  }
  /**
   * #ov üzerine HUD: kamera metni, eksen etiketleri, kot lejantı, kesit aralığı, pusula, kot etiketleri.
   * host: { fg, W, H, units, fmt, sel, gestureActive, fontScale }
   */
  drawHud(c, host = {}) {
    const o = this.opts, W = host.W || this.cv.clientWidth, H = host.H || this.cv.clientHeight, fs = host.fontScale || 1;
    if (host.units != null) this.units = host.units;
    const f = host.fmt || fmtNum;
    const bg = this._bgColor();
    const fg = o.bg === 'theme' && host.fg ? host.fg : toCss(this._fgFor(bg));
    const boxBg = lum(bg) > 0.5 ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.45)';
    const accent = toCss(this.selColor);
    c.save();
    c.textBaseline = 'top'; c.textAlign = 'left';
    const mono = `${Math.round(11 * fs)}px ui-monospace, "Roboto Mono", monospace`;
    const sans = `${Math.round(12 * fs)}px system-ui, sans-serif`;
    // eksen etiketleri
    if (o.axes && o.axisLabels && this.bb) {
      const bb = this.bb, a = this.axisLen || 1;
      c.font = `bold ${Math.round(12 * fs)}px system-ui, sans-serif`;
      const lab = (p, t, col) => { if (p[2] < -1 || p[2] > 1) return; c.fillStyle = col; c.fillText(t, p[0] + 3, p[1] - 14); };
      lab(this.project(bb[0] + a, bb[1], bb[2]), 'X', '#ff453a'); lab(this.project(bb[0], bb[1] + a, bb[2]), 'Y', '#30d158'); lab(this.project(bb[0], bb[1], bb[2] + a), 'Z', '#4285f4');
    }
    // kamera metni
    if (o.hud) {
      c.font = mono;
      const l1 = this.hudText();
      const bb = this.bb, cl = o.clip;
      const l2 = cl ? `Z: ${f(cl[2])} … ${f(cl[5])}` : bb ? `Z: ${f(bb[2])} … ${f(bb[5])}` : '';
      const lh = Math.round(14 * fs), pad = 5;
      const w = Math.max(c.measureText(l1).width, c.measureText(l2).width) + pad * 2, h = lh * (l2 ? 2 : 1) + pad * 2;
      const x = 8, y = o.hudPos === 'bl' ? H - 8 - h : 8;
      c.fillStyle = boxBg; c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, h, 6); else c.rect(x, y, w, h);
      c.fill();
      c.fillStyle = fg; c.fillText(l1, x + pad, y + pad);
      if (l2) { c.fillStyle = cl ? accent : fg; c.fillText(l2, x + pad, y + pad + lh); }
    }
    // kot lejantı (sağda dikey)
    if (o.colorMode === 'elevation') {
      const bh = Math.max(80, Math.round(H * 0.4)), bw = 18, x = W - 4 - bw, y = Math.round((H - bh) / 2);
      const g = c.createLinearGradient(0, y + bh, 0, y);
      g.addColorStop(0, '#295cf2'); g.addColorStop(0.25, '#33cce6'); g.addColorStop(0.5, '#40d14d'); g.addColorStop(0.75, '#fad933'); g.addColorStop(1, '#f24033');
      c.fillStyle = boxBg; c.fillRect(x - 4, y - 4, bw + 8, bh + 8);
      c.fillStyle = g; c.fillRect(x, y, bw, bh);
      c.font = sans; c.fillStyle = fg; c.textAlign = 'right';
      c.fillText(f(this.zrange[1]), x - 6, y); c.fillText(f(this.zrange[0]), x - 6, y + bh - 12);
      c.textAlign = 'left';
    }
    // pusula (2B'deki kuzey oku; cam.yaw ile döner)
    if (o.compass) {
      let left = false; try { left = document.body.classList.contains('left-hand'); } catch (_) { /* geç */ }
      const ce = document.getElementById('cube3d'); const cubeOn = o.cube && !!(ce && !ce.hidden);
      const cubeBottom = cubeOn ? ce.offsetTop + ce.offsetHeight : 0;
      const r = 16, cx = left ? 8 + 42 : W - 8 - 42, cy = cubeBottom + 8 + r + 6;
      let swap = false; try { swap = !!(window.dwgApp && window.dwgApp.state && window.dwgApp.state.geo && window.dwgApp.state.geo.swap); } catch (_) { /* geç */ }
      // ekranda kuzey (+Y) yönü: kamera yaw'ına göre
      const ang = this.cam.yaw + Math.PI / 2 + (swap ? Math.PI / 2 : 0);
      c.save(); c.translate(cx, cy); c.rotate(ang);
      c.fillStyle = boxBg; c.beginPath(); c.arc(0, 0, r + 4, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.45, r * 0.55); c.lineTo(0, r * 0.2); c.closePath(); c.fillStyle = '#ff453a'; c.fill();
      c.beginPath(); c.moveTo(0, -r); c.lineTo(-r * 0.45, r * 0.55); c.lineTo(0, r * 0.2); c.closePath(); c.fillStyle = fg; c.fill();
      c.restore();
      c.font = `bold ${Math.round(11 * fs)}px system-ui, sans-serif`; c.fillStyle = fg; c.textAlign = 'center';
      c.fillText('K', cx + Math.sin(ang) * (r + 12), cy - Math.cos(ang) * (r + 12) - 6);
      c.textAlign = 'left';
    }
    // kot etiketleri
    if (o.elevLabels !== 'off' && !host.gestureActive && this.vertices.length) {
      c.font = sans;
      const seen = new Set(); const items = [];
      const cl = o.clip;
      if (o.elevLabels === 'sel' && host.sel && host.sel.size) {
        for (const v of this.vertices) { if (!host.sel.has(v[3])) continue; if (cl && (v[2] < cl[2] || v[2] > cl[5])) continue; const s = this.project(v[0], v[1], v[2]); if (s[2] < -1 || s[2] > 1) continue; items.push([s[0], s[1], v[2], 0]); }
      } else if (o.elevLabels === 'visible') {
        for (const v of this.vertices) {
          if (cl && (v[0] < cl[0] || v[1] < cl[1] || v[2] < cl[2] || v[0] > cl[3] || v[1] > cl[4] || v[2] > cl[5])) continue;
          const s = this.project(v[0], v[1], v[2]); if (s[2] < -1 || s[2] > 1 || s[0] < 0 || s[1] < 0 || s[0] > W || s[1] > H) continue;
          items.push([s[0], s[1], v[2], Math.hypot(s[0] - W / 2, s[1] - H / 2)]);
        }
        items.sort((a, b) => a[3] - b[3]);
      }
      let n = 0;
      for (const it of items) {
        const k = (Math.round(it[0] / 8) * 8) + ',' + (Math.round(it[1] / 8) * 8); if (seen.has(k)) continue; seen.add(k);
        const txt = f(it[2]); const w = c.measureText(txt).width + 6;
        c.fillStyle = boxBg; c.fillRect(it[0] + 4, it[1] - 16, w, 15); c.fillStyle = fg; c.fillText(txt, it[0] + 7, it[1] - 15);
        c.fillStyle = accent; c.fillRect(it[0] - 2, it[1] - 2, 4, 4);
        if (++n >= 150) break;
      }
    }
    c.restore();
  }
}
const IDENT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const THIN_OFFS = [[0, 0]];
const NORMAL_OFFS = [[0, 0]];
const NORMAL_OFFS2 = [[0, 0], [1, 0], [0, 1]];
const THICK_OFFS = [[0, 0], [1, 0], [0, 1], [1, 1]];
