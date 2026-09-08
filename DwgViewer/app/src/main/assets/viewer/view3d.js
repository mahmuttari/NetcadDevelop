/*
 * 3B görünüm: WebGL ile çizgi/yüzey çizimi, yörünge (orbit) kamerası, köşe yakalama ve seçim.
 * Sahne ilkelleri (scene.js) segmentlere ayrılır; yaylar örneklenir; 3DFACE'ler üçgen olarak dolgulanır.
 */
import { TAU, arcPts, ellipsePts } from './geom.js';
import { FG } from './scene.js';

const VS = `attribute vec3 aPos; attribute vec4 aCol; uniform mat4 uMVP; uniform float uZ; varying vec4 vCol;
void main(){ gl_Position = uMVP * vec4(aPos.x, aPos.y, aPos.z * uZ, 1.0); gl_PointSize = 6.0; vCol = aCol; }`;
const FS = `precision mediump float; varying vec4 vCol; uniform float uAlpha; void main(){ gl_FragColor = vec4(vCol.rgb, vCol.a * uAlpha); }`;

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

export class View3D {
  constructor(canvas) {
    this.cv = canvas;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL yok');
    this.gl = gl;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    this.prog = prog; gl.useProgram(prog);
    this.aPos = gl.getAttribLocation(prog, 'aPos'); this.aCol = gl.getAttribLocation(prog, 'aCol');
    this.uMVP = gl.getUniformLocation(prog, 'uMVP'); this.uZ = gl.getUniformLocation(prog, 'uZ'); this.uAlpha = gl.getUniformLocation(prog, 'uAlpha');
    this.bufs = { lines: null, tris: null, pts: null, grid: null, sel: null };
    this.counts = { lines: 0, tris: 0, pts: 0, grid: 0, sel: 0 };
    this.cam = { yaw: -Math.PI / 4, pitch: 0.6, dist: 100, target: [0, 0, 0], persp: true };
    this.zScale = 1;
    this.center = [0, 0, 0]; this.radius = 1;
    this.vertices = [];  // yakalama için [x,y,z,prim]
    this.dark = true;
  }

  /** ilkelleri tamponlara yükler */
  setScene(prims, layers, opts = {}) {
    const fg = opts.dark === false ? [0.07, 0.07, 0.07] : [0.95, 0.96, 0.97];
    this.dark = opts.dark !== false;
    const L = [], T = [], P = [];
    const verts = [];
    let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const col = (c) => c === FG ? fg : [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    const push = (arr, x, y, z, c, a = 1) => { arr.push(x, y, z, c[0], c[1], c[2], a); if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z; };
    for (const p of prims) {
      if (p.inf || p.k === 4 || p.k === 3) continue;
      const lay = layers.get(p.lay); if (lay && !lay.visible) continue;
      const c = opts.mono ? fg : col(p.col);
      if (p.k === 2) { push(P, p.x, p.y, p.z || 0, c); verts.push([p.x, p.y, p.z || 0, p]); continue; }
      if (p.k === 1) { push(P, p.x, p.y, p.z || 0, c, 0.6); continue; }
      const pts = [];
      let cur = null;
      const seg = (a, b) => { push(L, a[0], a[1], a[2], c); push(L, b[0], b[1], b[2], c); };
      const flush = () => { if (cur && cur.length > 1) { for (let i = 1; i < cur.length; i++) seg(cur[i - 1], cur[i]); if (p.closed && cur.length > 2) seg(cur[cur.length - 1], cur[0]); if (p.face || (p.fill && cur.length >= 3)) fan(cur); } cur = null; };
      const fan = (ring) => { for (let i = 1; i < ring.length - 1; i++) { push(T, ring[0][0], ring[0][1], ring[0][2], c, 0.25); push(T, ring[i][0], ring[i][1], ring[i][2], c, 0.25); push(T, ring[i + 1][0], ring[i + 1][1], ring[i + 1][2], c, 0.25); } };
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
    this.bb = bb;
    this.center = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2];
    this.radius = Math.max(1e-6, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], (bb[5] - bb[2])) / 2);
    this.vertices = verts;
    this.upload('lines', L); this.upload('tris', T); this.upload('pts', P);
    this.buildGrid(bb, fg);
    this.fit();
  }
  buildGrid(bb, fg) {
    const G = [];
    const w = bb[3] - bb[0], h = bb[4] - bb[1];
    const step = niceStep(Math.max(w, h) / 10);
    const x0 = Math.floor(bb[0] / step) * step, x1 = Math.ceil(bb[3] / step) * step, y0 = Math.floor(bb[1] / step) * step, y1 = Math.ceil(bb[4] / step) * step;
    const z = bb[2];
    const gc = this.dark ? [0.25, 0.3, 0.36] : [0.8, 0.83, 0.87];
    for (let x = x0; x <= x1 + 1e-9; x += step) G.push(x, y0, z, gc[0], gc[1], gc[2], 1, x, y1, z, gc[0], gc[1], gc[2], 1);
    for (let y = y0; y <= y1 + 1e-9; y += step) G.push(x0, y, z, gc[0], gc[1], gc[2], 1, x1, y, z, gc[0], gc[1], gc[2], 1);
    // eksenler
    const a = Math.max(w, h) * 0.15 || 1;
    G.push(bb[0], bb[1], z, 1, 0.27, 0.23, 1, bb[0] + a, bb[1], z, 1, 0.27, 0.23, 1);
    G.push(bb[0], bb[1], z, 0.19, 0.86, 0.35, 1, bb[0], bb[1] + a, z, 0.19, 0.86, 0.35, 1);
    G.push(bb[0], bb[1], z, 0.26, 0.52, 0.96, 1, bb[0], bb[1], z + a, 0.26, 0.52, 0.96, 1);
    this.gridStep = step;
    this.upload('grid', G);
  }
  upload(name, arr) {
    const gl = this.gl;
    if (!this.bufs[name]) this.bufs[name] = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    this.counts[name] = arr.length / 7;
  }
  /** seçili ilkellerin vurgusu */
  setSelection(prims) {
    const S = [];
    for (const p of prims) {
      if (p.k !== 0) { if (p.x != null) S.push(p.x, p.y, p.z || 0, 1, 0.7, 0.26, 1, p.x, p.y, (p.z || 0) + this.radius * 0.02, 1, 0.7, 0.26, 1); continue; }
      let cur = null;
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) { const q = [o[1], o[2], o[3] || 0]; if (cur && o[0] === 1) S.push(cur[0], cur[1], cur[2], 1, 0.7, 0.26, 1, q[0], q[1], q[2], 1, 0.7, 0.26, 1); cur = q; }
        else if (o[0] === 2 || o[0] === -2) { const z = o[6] || 0; const q = []; if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], q); else { arcPts(o[1], o[2], o[3], o[5], o[4], q); q.reverse(); } for (let i = 1; i < q.length; i++) S.push(q[i - 1][0], q[i - 1][1], z, 1, 0.7, 0.26, 1, q[i][0], q[i][1], z, 1, 0.7, 0.26, 1); cur = [q[q.length - 1][0], q[q.length - 1][1], z]; }
      }
    }
    this.upload('sel', S);
  }

  fit() { this.cam.target = this.center.slice(); this.cam.dist = this.radius * 2.2; }
  preset(name) {
    const c = this.cam;
    if (name === 'top') { c.yaw = -Math.PI / 2; c.pitch = Math.PI / 2 - 1e-3; }
    else if (name === 'front') { c.yaw = -Math.PI / 2; c.pitch = 0.001; }
    else if (name === 'left') { c.yaw = Math.PI; c.pitch = 0.001; }
    else if (name === 'right') { c.yaw = 0; c.pitch = 0.001; }
    else { c.yaw = -Math.PI / 4; c.pitch = 0.6; }
  }
  mvp() {
    const cv = this.cv, c = this.cam;
    const aspect = cv.width / Math.max(1, cv.height);
    const zs = this.zScale;
    const tgt = [c.target[0], c.target[1], c.target[2] * zs];
    const eye = [tgt[0] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), tgt[1] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), tgt[2] + c.dist * Math.sin(c.pitch)];
    const view = lookAt(eye, tgt, [0, 0, 1]);
    const near = Math.max(1e-4, c.dist * 0.01), far = c.dist * 10 + this.radius * 10;
    const proj = c.persp ? perspective(0.9, aspect, near, far) : ortho(-c.dist * 0.5 * aspect, c.dist * 0.5 * aspect, -c.dist * 0.5, c.dist * 0.5, -far, far);
    return mul4(proj, view);
  }
  render() {
    const gl = this.gl, cv = this.cv;
    gl.viewport(0, 0, cv.width, cv.height);
    const bg = this.dark ? [0.11, 0.13, 0.16] : [1, 1, 1];
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    const m = this.mvp();
    gl.uniformMatrix4fv(this.uMVP, false, new Float32Array(m));
    gl.uniform1f(this.uZ, this.zScale);
    const draw = (name, mode, alpha = 1) => {
      if (!this.counts[name]) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name]);
      gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 4, gl.FLOAT, false, 28, 12);
      gl.uniform1f(this.uAlpha, alpha);
      gl.drawArrays(mode, 0, this.counts[name]);
    };
    draw('grid', gl.LINES, 0.6);
    gl.depthMask(false); draw('tris', gl.TRIANGLES, 1); gl.depthMask(true);
    draw('lines', gl.LINES, 1);
    draw('pts', gl.POINTS, 1);
    gl.disable(gl.DEPTH_TEST);
    draw('sel', gl.LINES, 1);
    this.lastMvp = m;
  }
  /** dünya → ekran (css px) */
  project(x, y, z) {
    const m = this.lastMvp || this.mvp();
    const p = xform4(m, x, y, (z || 0) * this.zScale);
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    return [(p[0] + 1) / 2 * W, (1 - p[1]) / 2 * H, p[2]];
  }
  /** ekran noktasına en yakın köşe (yakalama) */
  pickVertex(sx, sy, tol = 18) {
    let best = null, bd = tol;
    for (const v of this.vertices) {
      const s = this.project(v[0], v[1], v[2]);
      if (s[2] < -1 || s[2] > 1) continue;
      const d = Math.hypot(s[0] - sx, s[1] - sy);
      if (d < bd) { bd = d; best = { p: [v[0], v[1], v[2]], prim: v[3] }; }
    }
    return best;
  }
  // ---- hareketler ----
  orbit(dx, dy) { this.cam.yaw -= dx * 0.01; this.cam.pitch = Math.max(-1.5, Math.min(1.55, this.cam.pitch + dy * 0.01)); }
  zoom(f) { this.cam.dist = Math.max(this.radius * 0.01, Math.min(this.radius * 50, this.cam.dist / f)); }
  pan(dx, dy) {
    const c = this.cam, W = this.cv.clientWidth;
    const k = c.dist * 1.0 / W;
    const rx = [-Math.sin(c.yaw), Math.cos(c.yaw), 0];
    const up = [-Math.sin(c.pitch) * Math.cos(c.yaw), -Math.sin(c.pitch) * Math.sin(c.yaw), Math.cos(c.pitch)];
    c.target[0] += (-dx * rx[0] + dy * up[0]) * k; c.target[1] += (-dx * rx[1] + dy * up[1]) * k; c.target[2] += (dy * up[2]) * k / this.zScale;
  }
}
function niceStep(v) { const p = 10 ** Math.floor(Math.log10(v || 1)); const m = v / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; }
