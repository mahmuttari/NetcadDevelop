/*
 * ACIS (SAT metin / SAB ikili) okuyucu ve yüzey üçgenleyici — 3DSOLID, REGION, BODY için.
 *
 *  parseAcis(src)  src: string (SAT) ya da Uint8Array (SAT ya da SAB) → { version, records:[{type, tok:[...]}] }
 *  tessellate(acis, opts) → { edges: [ [ [x,y,z], … ], … ], tris: number[] (x,y,z ×3 ardışık), faces: n }
 *
 * Desteklenen geometri: plane / cone(silindir, koni) / sphere / torus yüzeyleri; straight / ellipse kenarları.
 * intcurve (kesişim) kenarları uç noktalar arasında kiriş olarak; spline yüzeyler yalnız kenarlarıyla.
 * Düzlem ve koni yüzeyleri sınır döngülerinden (delikli çokgen, kulak kesme) üçgenlenir; küre ve torus
 * parametre ızgarasıyla (kırpma dikkate alınmadan) çizilir. Amaç mühendislik katılarının (plaka, boru,
 * flanş, kutu, silindir) 3B'de yüzeyli görünmesi; tam ACIS uyumu değildir.
 */

// ---------------------------------------------------------------------------------
// SAT (metin) jetonlama
// ---------------------------------------------------------------------------------
function tokenizeSat(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const first = (lines[i++] || '').trim().split(/\s+/);
  const version = parseInt(first[0], 10) || 0;
  // başlık: sürüm ≥ 200'de ürün/tarih satırı ve birim satırı vardır
  if (version >= 200) { i++; i++; }
  const records = [];
  let buf = '';
  for (; i < lines.length; i++) {
    const ln = lines[i]; if (!ln) continue;
    buf += (buf ? ' ' : '') + ln;
    if (!/#\s*$/.test(ln)) continue;             // çok satırlı kayıt
    const raw = buf.replace(/#\s*$/, '').trim(); buf = '';
    if (!raw) continue;
    const parts = raw.split(/\s+/);
    let k = 0;
    // sürüm ≥ 700: "-<idx> tip …" biçimi olabilir
    if (/^-?\d+$/.test(parts[0]) && parts.length > 1 && /^[a-zA-Z]/.test(parts[1])) k = 1;
    const type = parts[k++];
    const tok = [];
    for (; k < parts.length; k++) {
      const s = parts[k];
      if (s[0] === '$') tok.push({ t: 'p', v: parseInt(s.slice(1), 10) });
      else if (s[0] === '@') { const n = parseInt(s.slice(1), 10); let str = ''; let need = n; while (need > 0 && k + 1 < parts.length) { k++; str += (str ? ' ' : '') + parts[k]; need = n - str.length; } tok.push({ t: 's', v: str }); }
      else if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) tok.push({ t: 'n', v: parseFloat(s) });
      else tok.push({ t: 'e', v: s });        // forward / reversed / I / F / T / single / double / forward_v …
    }
    records.push({ type, tok });
  }
  return { version, records };
}

// ---------------------------------------------------------------------------------
// SAB (ikili) jetonlama — etiketli jeton akışı
// ---------------------------------------------------------------------------------
// SAB başlığı 15 bayttır: "ACIS BinaryFile" (ACIS ≤ 21800) ya da "ASM BinaryFile4" (AutoCAD 2018+, ASM 223)
const SAB_MAGIC = 'ACIS BinaryFile', ASM_MAGIC = 'ASM BinaryFile';
const startsWith = (u8, s) => { for (let i = 0; i < s.length; i++) if (u8[i] !== s.charCodeAt(i)) return false; return true; };
export function isSab(u8) { return !!u8 && u8.length > 16 && (startsWith(u8, SAB_MAGIC) || startsWith(u8, ASM_MAGIC)); }
function tokenizeSab(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 15;
  const i32 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
  const f64 = () => { const v = dv.getFloat64(p, true); p += 8; return v; };
  const str8 = () => { const n = u8[p++]; const s = latin(u8, p, n); p += n; return s; };
  const str32 = () => { const n = dv.getUint32(p, true); p += 4; const s = latin(u8, p, n); p += n; return s; };
  const version = i32(); i32(); i32(); i32();          // sürüm, kayıt sayısı, gövde sayısı, bayraklar
  // ürün / sürüm / tarih dizgileri ve birim/toleranslar jeton olarak gelir; ilk kayıt başlığına (0x0d/0x0e) kadar atlanır
  const records = [], unknown = [];
  let cur = null;
  let guard = 0;
  while (p < u8.length && guard++ < 50_000_000) {
    const tag = u8[p++];
    switch (tag) {
      case 0x02: cur && cur.tok.push({ t: 'n', v: u8[p] }); p += 1; break;                      // char / small int
      case 0x03: cur && cur.tok.push({ t: 'n', v: dv.getInt16(p, true) }); p += 2; break;
      case 0x04: { const v = i32(); if (cur) cur.tok.push({ t: 'n', v }); break; }               // int32
      case 0x05: { const v = dv.getFloat32(p, true); p += 4; cur && cur.tok.push({ t: 'n', v }); break; }
      case 0x06: { const v = f64(); if (cur) cur.tok.push({ t: 'n', v }); break; }               // double
      case 0x07: { const s = str8(); if (cur) cur.tok.push({ t: 's', v: s }); break; }           // kısa dizgi
      case 0x08: { const s = str32(); if (cur) cur.tok.push({ t: 's', v: s }); break; }          // uzun dizgi
      case 0x09: { const n = dv.getUint32(p, true); p += 4 + n; break; }                        // ikili blok
      case 0x0a: cur && cur.tok.push({ t: 'e', v: 'true' }); break;
      case 0x0b: cur && cur.tok.push({ t: 'e', v: 'false' }); break;
      case 0x0c: { const v = i32(); if (cur) cur.tok.push({ t: 'p', v }); break; }               // işaretçi (kayıt dizini)
      case 0x0d: { const s = str8(); if (cur && cur.pending) { cur.type += '-' + s; cur.pending = false; } else { cur = { type: s, tok: [] }; records.push(cur); } break; }   // varlık türü (ana ad)
      case 0x0e: { const s = str8(); if (cur && cur.pending) cur.type += '-' + s; else { cur = { type: s, tok: [], pending: true }; records.push(cur); } break; }   // tür öneki ("plane" → "plane-surface")
      case 0x0f: cur && cur.tok.push({ t: 'e', v: '{' }); break;                                // alt tür başı
      case 0x10: cur && cur.tok.push({ t: 'e', v: '}' }); break;                                // alt tür sonu
      case 0x11: cur = null; break;                                                             // kayıt sonu
      case 0x12: { const s = str32(); if (cur) cur.tok.push({ t: 's', v: s }); break; }
      case 0x13: case 0x14: { const x = f64(), y = f64(), z = f64(); if (cur) cur.tok.push({ t: 'n', v: x }, { t: 'n', v: y }, { t: 'n', v: z }); break; }  // konum / yön vektörü
      case 0x15: { const s = str8(); if (cur) cur.tok.push({ t: 'e', v: s }); break; }           // sayım (enum)
      case 0x16: { const x = f64(), y = f64(); if (cur) cur.tok.push({ t: 'n', v: x }, { t: 'n', v: y }); break; } // 2B vektör
      case 0x17: { const s = str8(); if (cur) cur.tok.push({ t: 'e', v: s }); break; }
      default: {
        // bilinmeyen etiket (daha yeni ASM sürümü): bu kayıt atılır, bir sonraki kayıt başına (0x11 + 0x0d/0x0e) kadar ilerlenir
        unknown.push(tag);
        if (cur) { records.pop(); cur = null; }
        while (p < u8.length && !(u8[p] === 0x11 && (u8[p + 1] === 0x0d || u8[p + 1] === 0x0e))) p++;
        p++;
        break;
      }
    }
  }
  if (unknown.length) records.unknownTags = [...new Set(unknown)].map(t => '0x' + t.toString(16));
  // tür adlarındaki "-" bileşimi SAT ile aynı sıraya getirilir: SAB'da alt türler "plane" "surface" → "plane-surface"
  return { version, records };
}
function latin(u8, p, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]); return s; }

export function parseAcis(src) {
  if (typeof src === 'string') return tokenizeSat(src);
  if (isSab(src)) return tokenizeSab(src);
  return tokenizeSat(new TextDecoder('latin1').decode(src));
}

// ---------------------------------------------------------------------------------
// Kayıt erişimi
// ---------------------------------------------------------------------------------
const SURFACES = new Set(['plane', 'cone', 'sphere', 'torus', 'spline', 'meshsurf', 'sweep', 'blend', 'offset', 'net', 'skin', 'rot', 'ref', 'sum', 'tube', 'comp', 'exact', 'compcurv']);
const CURVES = new Set(['straight', 'ellipse', 'intcurve', 'helix', 'undefc', 'degenerate', 'compcurv', 'pcurve']);
class Acis {
  constructor(parsed) {
    this.v = parsed.version; this.rec = parsed.records;
    this.hist = this.v >= 700;          // sürüm ≥ 7: öznitelik işaretçisinden sonra "-1 $hist" gelir
  }
  at(i) { return i >= 0 && i < this.rec.length ? this.rec[i] : null; }
  /** kayıt türü ana adı: "plane-surface" → "plane"; "persubent-acadSolidHistory-attrib" → attrib */
  kind(r) { const t = r.type; if (/attrib$/.test(t)) return 'attrib'; const i = t.indexOf('-'); return i < 0 ? t : t.slice(0, i); }
  /** işaretçi listesi (öznitelik ve tarihçe hariç) */
  ptrs(r) { const ps = r.tok.filter(t => t.t === 'p').map(t => t.v); ps.shift(); if (this.hist) ps.shift(); return ps; }
  /** sayı listesi (sürüm ≥ 700 dizin "-1" hariç) */
  nums(r) { let ts = r.tok; if (this.hist) { const i = ts.findIndex(t => t.t === 'n'); if (i >= 0 && ts[i].v === -1 && ts[i + 1] && ts[i + 1].t === 'p') ts = ts.slice(0, i).concat(ts.slice(i + 1)); } return ts.filter(t => t.t === 'n').map(t => t.v); }
  enums(r) { return r.tok.filter(t => t.t === 'e').map(t => t.v); }
  /** işaretçilerden türü verilen ilk kayıt (ASM sürümleri arasında işaretçi sırası değiştiği için sıraya güvenilmez) */
  ref(r, kind) { for (const i of this.ptrs(r)) { const t = this.at(i); if (t && this.kind(t) === kind) return t; } return null; }
  refs(r, kind) { const out = []; for (const i of this.ptrs(r)) { const t = this.at(i); if (t && this.kind(t) === kind) out.push(t); } return out; }
  /** yüz kaydının yüzeyi: tür adı "…-surface" olan ya da bilinen yüzey türlerinden ilk işaretçi */
  surfaceOf(r) { for (const i of this.ptrs(r)) { const t = this.at(i); if (t && (SURFACES.has(this.kind(t)) || /surface/.test(t.type))) return t; } return null; }
  curveOf(r) { for (const i of this.ptrs(r)) { const t = this.at(i); if (t && (CURVES.has(this.kind(t)) || /curve/.test(t.type))) return t; } return null; }
  /** yön: SAT "forward"/"reversed", SAB false=forward / true=reversed, eski SAT 0=forward / 1=reversed */
  sense(r, which = 0) {
    const e = this.enums(r).filter(s => s === 'forward' || s === 'reversed' || s === 'true' || s === 'false');
    if (e.length > which) { const s = e[which]; return s === 'forward' || s === 'false'; }
    if (this.v < 200) { const ns = r.tok.filter(t => t.t === 'n'); if (ns.length) return ns[ns.length - 1].v === 0; }
    return true;
  }
}

// ---------------------------------------------------------------------------------
// Vektör yardımcıları
// ---------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const L = len(a) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
const TAU = Math.PI * 2;
/** Newell normali (uzunluğu ≈ 2·alan): kapalı 3B çokgenin en uygun düzlem normali */
function newell(pts) { const n = [0, 0, 0]; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[j], b = pts[i]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); } return n; }
/** dik düzlem tabanı */
function basis(n) { n = norm(n); const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const u = norm(cross(a, n)); const v = cross(n, u); return [u, v]; }

// ---------------------------------------------------------------------------------
// Çokgen üçgenleme (kulak kesme, delik köprüleme) — 2B
// ---------------------------------------------------------------------------------
function area2(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[i][1] + pts[j][1]); return a / 2; }
function pointInTri(px, py, a, b, c) {
  const s = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
  const t = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  if ((s < 0) !== (t < 0) && s !== 0 && t !== 0) return false;
  const d = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
  return d === 0 || (d < 0) === (s + t <= 0);
}
/** dış halka (herhangi yön) + delikler → üçgen indeks üçlüleri (pts dizisine göre) */
export function triangulate(outer, holes = []) {
  // yönleri düzelt: dış CCW, delikler CW
  let ring = outer.slice(); if (area2(ring) > 0) ring.reverse();
  const hs = holes.map(h => { const r = h.slice(); if (area2(r) < 0) r.reverse(); return r; });
  // delikleri en sağdaki noktadan köprüle (basit ve yeterli)
  hs.sort((a, b) => Math.max(...b.map(p => p[0])) - Math.max(...a.map(p => p[0])));
  for (const h of hs) {
    let hi = 0; for (let i = 1; i < h.length; i++) if (h[i][0] > h[hi][0]) hi = i;
    const hp = h[hi];
    // dış halkada görünür en yakın köşe: hp'nin sağındaki en yakın x
    let best = -1, bd = Infinity;
    for (let i = 0; i < ring.length; i++) { const q = ring[i]; if (q[0] < hp[0]) continue; const d = (q[0] - hp[0]) ** 2 + (q[1] - hp[1]) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best < 0) { best = 0; }
    const rot = h.slice(hi).concat(h.slice(0, hi + 1));
    ring = ring.slice(0, best + 1).concat(rot, ring.slice(best));
  }
  const n = ring.length, idx = []; for (let i = 0; i < n; i++) idx.push(i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = ring[i0], b = ring[i1], c = ring[i2];
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cr <= 1e-14 * (1 + Math.abs(a[0]) + Math.abs(a[1]))) continue;     // dışbükey değil
      let inside = false;
      for (const j of idx) { if (j === i0 || j === i1 || j === i2) continue; const q = ring[j]; if ((q[0] === a[0] && q[1] === a[1]) || (q[0] === b[0] && q[1] === b[1]) || (q[0] === c[0] && q[1] === c[1])) continue; if (pointInTri(q[0], q[1], a, b, c)) { inside = true; break; } }
      if (inside) continue;
      tris.push([i0, i1, i2]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) { // dejenere: yelpaze
      for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
      break;
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return { ring, tris };
}

// ---------------------------------------------------------------------------------
// Üçgenleme
// ---------------------------------------------------------------------------------
export function tessellate(parsed, opts = {}) {
  const A = new Acis(parsed);
  const R = A.rec;
  const segs = opts.arcSegs || 24;             // tam çember için parça sayısı
  const edgesOut = [], tris = [];
  let faceCount = 0, skipped = 0, approx = 0; const surfKinds = {};
  // gövde dönüşümü
  let xf = null;
  for (const r of R) if (A.kind(r) === 'body') { const t = A.ref(r, 'transform'); if (t) { const n = A.nums(t); if (n.length >= 12) xf = n; } }
  const X = (p) => xf ? [n_(xf, 0, p) + xf[9], n_(xf, 3, p) + xf[10], n_(xf, 6, p) + xf[11]] : p;
  function n_(m, o, p) { return m[o] * p[0] + m[o + 1] * p[1] + m[o + 2] * p[2]; }
  // nokta / köşe
  const pointOf = (vr) => { if (!vr) return null; const pr = A.ref(vr, 'point'); if (!pr) return null; const n = A.nums(pr); return n.length >= 3 ? [n[0], n[1], n[2]] : null; };
  // kenar örnekleme (dünya koordinatı, dönüşümsüz)
  const edgeCache = new Map();
  function edgePts(er) {
    if (edgeCache.has(er)) return edgeCache.get(er);
    const vs = A.refs(er, 'vertex');
    const p0 = pointOf(vs[0]), p1 = pointOf(vs[1] || vs[0]);
    const cr = A.curveOf(er);
    const nums = A.nums(er);
    let pts = null;
    if (cr && A.kind(cr) === 'ellipse') {
      const n = A.nums(cr);
      if (n.length >= 10 && p0 && p1) {
        const c = [n[0], n[1], n[2]], nrm = norm([n[3], n[4], n[5]]), maj = [n[6], n[7], n[8]], ratio = n[9] || 1;
        const rmaj = len(maj), u = norm(maj), v = cross(nrm, u);
        const ang = (p) => { const d = sub(p, c); return Math.atan2(dot(d, v) / (rmaj * ratio || 1), dot(d, u) / (rmaj || 1)); };
        let a0 = ang(p0), a1 = ang(p1);
        const closed = len(sub(p0, p1)) < 1e-9 * (1 + rmaj);
        if (closed) { a1 = a0 + TAU; }
        else { // parametre aralığı: start_param/end_param varsa yönü belirler
          if (nums.length >= 2 && nums[1] < nums[0]) { if (a1 > a0) a1 -= TAU; } else if (a1 <= a0) a1 += TAU;
          if (A.sense(er) === false) { /* sense edge yönü — noktalar zaten başlangıç/bitiş */ }
        }
        const k = Math.max(2, Math.ceil(Math.abs(a1 - a0) / TAU * segs));
        pts = [];
        for (let i = 0; i <= k; i++) { const a = a0 + (a1 - a0) * i / k; pts.push(add(c, add(mul(u, rmaj * Math.cos(a)), mul(v, rmaj * ratio * Math.sin(a))))); }
        if (!closed) { pts[0] = p0; pts[k] = p1; }
      }
    }
    if (!pts && p0 && p1) pts = [p0, p1];
    if (!pts) pts = [];
    edgeCache.set(er, pts);
    return pts;
  }
  // döngü → nokta dizisi
  // döngü → coedge listesi (yedek yol: coedge'lerin kendi 'loop' işaretçisinden)
  let coedgesOfLoop = null;
  function loopCoedges(lr) {
    if (!coedgesOfLoop) { coedgesOfLoop = new Map(); for (const r of R) if (A.kind(r) === 'coedge') { const l = A.ref(r, 'loop'); if (l) { if (!coedgesOfLoop.has(l)) coedgesOfLoop.set(l, []); coedgesOfLoop.get(l).push(r); } } }
    return coedgesOfLoop.get(lr) || [];
  }
  /** kenar parçalarını uç noktalarından zincirler (sonraki işaretçisi çözülemeyen döngüler için) */
  function chainPts(segs) {
    if (!segs.length) return [];
    const rest = segs.slice(); const out = rest.shift().slice();
    const near = (a, b) => len(sub(a, b)) < 1e-6 * (1 + len(a));
    let guard = 0;
    while (rest.length && guard++ < 100000) {
      const tail = out[out.length - 1]; let found = -1, rev = false;
      for (let i = 0; i < rest.length; i++) { const s2 = rest[i]; if (near(s2[0], tail)) { found = i; break; } if (near(s2[s2.length - 1], tail)) { found = i; rev = true; break; } }
      if (found < 0) break;
      const s2 = rest.splice(found, 1)[0]; const pts = rev ? s2.slice().reverse() : s2;
      for (let i = 1; i < pts.length; i++) out.push(pts[i]);
    }
    if (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
    return out;
  }
  function loopPts(lr) {
    const out = loopPtsChain(lr);
    if (out.length >= 3) return out;
    const segs = loopCoedges(lr).map(cr => { const er = A.ref(cr, 'edge'); if (!er) return null; const pts = edgePts(er).slice(); if (!A.sense(cr)) pts.reverse(); return pts.length > 1 ? pts : null; }).filter(Boolean);
    return chainPts(segs);
  }
  function loopPtsChain(lr) {
    const out = []; const first = A.ref(lr, 'coedge'); let cr = first; let guard = 0; const seen = new Set();
    while (cr && A.kind(cr) === 'coedge' && guard++ < 100000 && !seen.has(cr)) {
      seen.add(cr);
      const er = A.ref(cr, 'edge');
      if (er) {
        let pts = edgePts(er).slice();
        if (!A.sense(cr)) pts.reverse();
        for (let i = 0; i < pts.length - 1; i++) out.push(pts[i]);
        if (pts.length === 1) out.push(pts[0]);
      }
      cr = A.refs(cr, 'coedge')[0] || null; if (cr === first) break;   // ilk coedge işaretçisi: sonraki
    }
    return out;
  }
  function pushTri(a, b, c) { a = X(a); b = X(b); c = X(c); tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
  // kenarlar (tümü)
  for (const r of R) if (A.kind(r) === 'edge') { const pts = edgePts(r); if (pts.length > 1) edgesOut.push(pts.map(X)); }
  // yüzler
  for (const fr of R) {
    if (A.kind(fr) !== 'face') continue;
    const sr = A.surfaceOf(fr);
    const sk = sr ? A.kind(sr) : 'none';
    surfKinds[sk] = (surfKinds[sk] || 0) + 1;
    // döngüler: yüz → ilk döngü; döngü → sonraki döngü (tür 'loop' olan ilk işaretçi)
    const loops = []; let lr = A.ref(fr, 'loop'); let g = 0; const seenL = new Set();
    while (lr && A.kind(lr) === 'loop' && g++ < 10000 && !seenL.has(lr)) { seenL.add(lr); const pts = loopPts(lr); if (pts.length >= 3) loops.push(pts); lr = A.ref(lr, 'loop'); }
    if (!sr) { if (!loops.length) { skipped++; continue; } }
    if (sk === 'plane') {
      if (!loops.length) { skipped++; continue; }
      const n = A.nums(sr); const nrm = norm([n[3], n[4], n[5]]); const [u, v] = basis(nrm);
      const to2 = (p) => [dot(p, u), dot(p, v)];
      const rings = loops.map(l => l.map(to2));
      // en büyük alanlı halka dış, kalanlar delik
      let oi = 0, oa = 0; rings.forEach((r, i) => { const a = Math.abs(area2(r)); if (a > oa) { oa = a; oi = i; } });
      const outer = rings[oi], holes = rings.filter((_, i) => i !== oi);
      const map3 = new Map();
      const key = (p2) => p2[0] + ',' + p2[1];
      loops.forEach((l, li) => l.forEach((p3, pi) => map3.set(key(rings[li][pi]), p3)));
      const { ring, tris: T } = triangulate(outer, holes);
      for (const t of T) { const a = map3.get(key(ring[t[0]])), b = map3.get(key(ring[t[1]])), c = map3.get(key(ring[t[2]])); if (a && b && c) pushTri(a, b, c); }
      faceCount++;
    } else if (sk === 'cone') {
      const n = A.nums(sr); if (n.length < 12 || !loops.length) { skipped++; continue; }
      const root = [n[0], n[1], n[2]], axis = norm([n[3], n[4], n[5]]), maj = [n[6], n[7], n[8]], ratio = n[9] || 1, sinA = n[10], cosA = n[11];
      const rmaj = len(maj) || 1e-9, u = norm(maj), v = cross(axis, u);
      const tan = cosA !== 0 ? sinA / cosA : 0;
      // parametre uzayı: (açı, eksen boyu)
      const par = (p) => { const d = sub(p, root); const h = dot(d, axis); const rad = dot(d, u), rad2 = dot(d, v) / ratio; return [Math.atan2(rad2, rad), h]; };
      const at = (a, h) => { const r = rmaj + h * tan; return add(add(root, mul(axis, h)), add(mul(u, r * Math.cos(a)), mul(v, r * ratio * Math.sin(a)))); };
      // her döngüde açıyı sürekli aç (dikiş geçişi)
      const rings = loops.map(l => { let prev = null; const out = []; for (const p of l) { let [a, h] = par(p); if (prev != null) { while (a - prev > Math.PI) a -= TAU; while (prev - a > Math.PI) a += TAU; } prev = a; out.push([a * rmaj, h]); } return out; });
      // yüz tam çevre mi (dış halka açı aralığı ≈ 2π)? → açı yönünde ızgara ile üçgenle (kiriş hatası azalsın)
      let oi = 0, oa = 0; rings.forEach((r, i) => { const a = Math.abs(area2(r)); if (a > oa) { oa = a; oi = i; } });
      const outer = rings[oi], holes = rings.filter((_, i) => i !== oi);
      const { ring, tris: T } = triangulate(outer, holes);
      for (const t of T) { const a = ring[t[0]], b = ring[t[1]], c = ring[t[2]]; pushTri(at(a[0] / rmaj, a[1]), at(b[0] / rmaj, b[1]), at(c[0] / rmaj, c[1])); }
      faceCount++;
    } else if (sk === 'sphere') {
      const n = A.nums(sr); if (n.length < 4) { skipped++; continue; }
      const c = [n[0], n[1], n[2]], r = n[3]; const [u, v] = basis([0, 0, 1]); const w = [0, 0, 1];
      const N = segs, M = Math.max(4, segs / 2);
      const at = (a, b) => add(c, add(mul(u, r * Math.cos(b) * Math.cos(a)), add(mul(v, r * Math.cos(b) * Math.sin(a)), mul(w, r * Math.sin(b)))));
      for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, b0 = -Math.PI / 2 + j / M * Math.PI, b1 = -Math.PI / 2 + (j + 1) / M * Math.PI; pushTri(at(a0, b0), at(a1, b0), at(a1, b1)); pushTri(at(a0, b0), at(a1, b1), at(a0, b1)); }
      faceCount++;
    } else if (sk === 'torus') {
      const n = A.nums(sr); if (n.length < 8) { skipped++; continue; }
      const c = [n[0], n[1], n[2]], axis = norm([n[3], n[4], n[5]]), R0 = n[6], r0 = Math.abs(n[7]); const [u, v] = basis(axis);
      const N = segs, M = Math.max(6, segs / 2);
      const at = (a, b) => { const ring = add(mul(u, Math.cos(a)), mul(v, Math.sin(a))); return add(c, add(mul(ring, R0 + r0 * Math.cos(b)), mul(axis, r0 * Math.sin(b)))); };
      for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, b0 = j / M * TAU, b1 = (j + 1) / M * TAU; pushTri(at(a0, b0), at(a1, b0), at(a1, b1)); pushTri(at(a0, b0), at(a1, b1), at(a0, b1)); }
      faceCount++;
    } else if (loops.length) {
      // spline / desteklenmeyen yüzey: sınır döngüleri en uygun düzleme (Newell normali) izdüşürülüp üçgenlenir —
      // eğri yüzey yaklaşık dolar, delik kalmaz (fillet, kavis, serbest yüzey)
      let oi = 0, oa = 0; const nrms = loops.map(l => newell(l)); loops.forEach((l, i) => { const a = len(nrms[i]); if (a > oa) { oa = a; oi = i; } });
      if (!(oa > 0)) { skipped++; continue; }
      const nrm = norm(nrms[oi]); const [u, v] = basis(nrm);
      const to2 = (p) => [dot(p, u), dot(p, v)];
      const rings = loops.map(l => l.map(to2));
      const outer = rings[oi], holes = rings.filter((_, i) => i !== oi);
      const map3 = new Map(); const key = (p2) => p2[0] + ',' + p2[1];
      loops.forEach((l, li) => l.forEach((p3, pi) => map3.set(key(rings[li][pi]), p3)));
      const { ring, tris: T } = triangulate(outer, holes);
      for (const t of T) { const a = map3.get(key(ring[t[0]])), b = map3.get(key(ring[t[1]])), c = map3.get(key(ring[t[2]])); if (a && b && c) pushTri(a, b, c); }
      faceCount++; approx++;
    } else { skipped++; }
  }
  return { edges: edgesOut, tris, faces: faceCount, skipped, approx, surfaces: surfKinds, records: R.length, version: A.v, unknownTags: R.unknownTags || null };
}
