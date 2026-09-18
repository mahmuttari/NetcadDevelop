/*
 * blocks.js — çizim içi BLOK TABLOSU ve yerleştirme (INSERT) çekirdeği.
 *
 * NE İŞE YARAR
 *   Sürüm 7.71'e kadar uygulamanın düzenleme modelinde blok TANIMI yoktu: DWG'den gelen yerleştirmeler
 *   sahne kurulurken düzleştirilmiş ilkellerdi (ortak bir info nesnesi paylaşırlar), kullanıcının
 *   "Blok kütüphanesi"ne kaydettiği bloklar ise cihazda saklanan varlık listeleriydi ve çizime düz
 *   nesne olarak yapıştırılırdı. AutoCAD'in BLOCK / INSERT / BEDIT / REFEDIT / ATTDEF / dinamik blok
 *   ailesi bir TANIM TABLOSU ister: tanım bir kez durur, her yerleştirme ona bakar, tanım değişince
 *   bütün yerleştirmeler değişir. Bu modül o tabloyu ve tanım → dünya genişletmesini verir.
 *
 * TANIM (def)
 *   { name, base:[x,y,z], ents:[varlık…], dyn:{ params:[…] } | null }
 *   Varlıklar edit.js / blocklib.js varlık biçimindedir (LINE, PATH, TEXT, ATTDEF, INSERT (iç içe), WIPEOUT…)
 *   ve TANIM UZAYINDADIR: taban noktası `base` yerleştirme noktasına oturur. DWG'den benimsenen
 *   tanımlarda taban (0,0,0)'dır (AutoCAD'in kendi kuralı: blok içeriği taban noktasına göre yazılır).
 *
 * YERLEŞTİRME (ins)
 *   { type:'INSERT', id, name, layer, color, x, y, z, rot, sx, sy, m:[6], attrs:[[tag, değer]…], dyn:{ paramId: değer } }
 *   Matris m = T(x,y)·R(rot)·S(sx,sy) — TEK gerçek kaynak: taşıma / döndürme / aynalama matrise
 *   uygulanır, x-y-rot-sx-sy ondan türetilir (decompose). Böylece yansıtılmış bir blok (sy < 0)
 *   yeniden genişletildiğinde yerinde kalır; AutoCAD'in de yaptığı budur.
 *
 * DİNAMİK BLOK — DÜRÜSTÇE
 *   AutoCAD'in dinamik bloğu (parametre + eylem çizgesi, ACAD_ENHANCEDBLOCK) DWG'den okunup
 *   değerlendirilMEZ: LibreDWG bu çizgeyi çözümlemez. Burada uygulamanın KENDİ parametre modeli
 *   vardır (görünürlük, çevirme, döndürme, doğrusal uzunluk, nokta); tanım düzenleyicide kurulur,
 *   yerleştirme tutamakla değer alır, değer yerleştirmede saklanır ve genişletmede uygulanır.
 *   DXF'e yazılırken dinamik blok sabit bir blok olarak çıkar (AutoCAD'deki "statik" hâli).
 *
 * KURALLAR
 *  - Bu modül SAF'tır: DOM'a, S durumuna dokunmaz; giren varlıkları DEĞİŞTİRMEZ, kopya döner.
 *  - Dönüşüm tek kapıdan geçer (xformEnts): varlık → ilkel → transformPrim → varlık. Yay yönü,
 *    ölçü tanımı, yazı dönüşü edit.js'in doğrulanmış yolundan gelir; ikinci bir dönüştürücü yazılmaz.
 *  - Ad karşılaştırması büyük harfe duyarsızdır (AutoCAD blok adları da öyledir).
 */
import { mul, apply, det, pointInPoly, flatten, segIntersect } from './geom.js';
import { entToPrim, transformPrim } from './edit.js';
import { primToEnt } from './blocklib.js';

export const MAX_DEPTH = 24;
const D2R = Math.PI / 180;
/** Genişletmede yerleştirme matrisi tanım dosyasına ait olmayan katmanları çözmek için boş katman haritası (renk bilgisi ci'de taşınır) */
const NO_LAYERS = new Map();

export const keyOf = (name) => String(name == null ? '' : name).trim().toUpperCase();
const say = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
export const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------------------------
// Matris
// ---------------------------------------------------------------------------------------
/** Yerleştirme matrisi: m verilmişse o, yoksa T(x,y)·R(rot)·S(sx,sy) (taban tanım kökeninde) */
export function insMatrix(i) {
  if (Array.isArray(i.m) && i.m.length === 6 && i.m.every(v => typeof v === 'number' && isFinite(v))) return i.m.slice();
  const r = say(i.rot), cs = Math.cos(r), sn = Math.sin(r);
  const sx = i.sx == null ? 1 : say(i.sx) || 1, sy = i.sy == null ? 1 : say(i.sy) || 1;
  return [cs * sx, sn * sx, -sn * sy, cs * sy, say(i.x), say(i.y)];
}
/** m = T·R·S ayrışımı: { x, y, rot, sx, sy } (sy aynalamada eksi çıkar; kaykı yoksa kesindir) */
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1]);
  const rot = Math.atan2(m[1], m[0]);
  const sy = -Math.sin(rot) * m[2] + Math.cos(rot) * m[3];
  return { x: m[4], y: m[5], rot, sx, sy };
}
export function invert(m) {
  const d = det(m);
  if (!d || !isFinite(d)) return null;
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
export function rotM(c, a) { const cs = Math.cos(a), sn = Math.sin(a); return [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]]; }
export function mirrorM(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const A = (dx * dx - dy * dy) / L2, B = 2 * dx * dy / L2;
  return [A, B, B, -A, a[0] - A * a[0] - B * a[1], a[1] - B * a[0] + A * a[1]];
}
/** Yerleştirme varlığının matrisini günceller ve türetilmiş alanları yazar */
export function withMatrix(ins, m, dz = 0) {
  const d = decompose(m);
  return { ...ins, m: m.slice(), x: d.x, y: d.y, z: say(ins.z) + say(dz), rot: d.rot, sx: d.sx, sy: d.sy };
}

// ---------------------------------------------------------------------------------------
// Varlık dönüşümü (tek kapı)
// ---------------------------------------------------------------------------------------
/** Varlığın dönüşümde korunacak, geometri dışı alanları */
const KEEP = ['id', 'tag', 'prompt', 'flags', 'vis', 'bg', 'hp', 'hpart', 'pattern', 'alpha', 'itype', 'gid', 'layer', 'color', 'linetype'];
/**
 * Varlık kümesinin m ile dönüşmüş KOPYASI (z'ye dz eklenir). İç içe yerleştirme (INSERT) matrisini
 * çarparak taşır; ATTDEF konum ve dönüşünü yazı gibi alır, öteki alanları korur; MASKE çokgeni
 * doğrudan dönüşür; geri kalan her varlık edit.js'in ilkel yolundan geçer.
 */
export function xformEnts(ents, m, dz = 0) {
  const out = [];
  for (const e of ents || []) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'INSERT') { out.push(withMatrix(e, mul(m, insMatrix(e)), dz)); continue; }
    if (e.type === 'WIPEOUT') { out.push({ ...e, pts: (e.pts || []).map(q => { const r = apply(m, q[0], q[1]); return [r[0], r[1], say(q[2]) + dz]; }) }); continue; }
    if ((e.type === 'CIRCLE' || e.type === 'ARC') && e.pts && e.pts[0] && e.r > 0) {
      // benzerlik dönüşümü (öteleme, döndürme, tek ölçek, yansıma): daire daire, yay yay kalır — DXF'e CIRCLE / ARC yazılır;
      // yansıyan yay ile eşit olmayan ölçek yol (PATH) olur
      const dt = det(m), k = Math.sqrt(Math.abs(dt)), eps = 1e-9 * Math.max(1, k);
      const conf = k > 0 && Math.abs(Math.hypot(m[0], m[1]) - k) < eps && Math.abs(Math.hypot(m[2], m[3]) - k) < eps && Math.abs(m[0] * m[2] + m[1] * m[3]) < eps * Math.max(1, k);
      if (conf && (e.type === 'CIRCLE' || dt > 0)) {
        const c = apply(m, e.pts[0][0], e.pts[0][1]), o = { ...e, pts: [[c[0], c[1], say(e.pts[0][2]) + dz]], r: e.r * k };
        if (e.type === 'ARC') { const rot = Math.atan2(m[1], m[0]); o.a0 = say(e.a0) + rot; o.a1 = say(e.a1) + rot; }
        out.push(o); continue;
      }
    }
    const p = entToPrim(e, NO_LAYERS);
    if (!p) continue;
    transformPrim(p, m, dz);
    if (e.type === 'ATTDEF') { out.push({ ...e, pts: [[p.x, p.y, say(p.z)]], h: p.h, rot: p.rot }); continue; }
    const e2 = primToEnt(p);
    if (!e2) continue;
    const c = { ...e2 };
    for (const k of KEEP) if (e[k] !== undefined) c[k] = e[k];
    if (e2.itype && !e.itype) c.itype = e2.itype;
    if (e.type === 'TEXT') c.type = 'TEXT';
    out.push(c);
  }
  return out;
}
/** Verilen indislerdeki (ya da hepsi) varlıklara dönüşüm; ötekiler olduğu gibi */
function xformSubset(ents, idx, m) {
  if (!idx) return xformEnts(ents, m);
  const set = new Set(idx);
  const moved = xformEnts(ents.filter((_, i) => set.has(i)), m);
  let j = 0;
  return ents.map((e, i) => (set.has(i) ? moved[j++] : e));
}
/** Çerçevenin içindeki köşeler (dx, dy) kadar taşınır (STRETCH); yay ve elips merkezi içerdeyse yay taşınır */
export function stretchEnts(ents, frame, dx, dy, idx) {
  const inside = (x, y) => x >= frame[0] && x <= frame[2] && y >= frame[1] && y <= frame[3];
  const set = idx ? new Set(idx) : null;
  return (ents || []).map((e, i) => {
    if (!e || (set && !set.has(i))) return e;
    if (e.type === 'INSERT') { const c = { ...e }; if (inside(say(e.x), say(e.y))) { const m = insMatrix(e); m[4] += dx; m[5] += dy; return withMatrix(c, m); } return c; }
    if (e.type === 'WIPEOUT') return { ...e, pts: (e.pts || []).map(q => (inside(q[0], q[1]) ? [q[0] + dx, q[1] + dy, q[2]] : q)) };
    if (e.type === 'ATTDEF' || e.type === 'TEXT' || e.type === 'POINT') { const q = e.pts && e.pts[0]; return q && inside(q[0], q[1]) ? { ...e, pts: [[q[0] + dx, q[1] + dy, say(q[2])]] } : e; }
    const p = entToPrim(e, NO_LAYERS);
    if (!p) return e;
    if (p.k === 0) {
      let moved = 0;
      p.ops = p.ops.map(o => { if (!inside(o[1], o[2])) return o.slice(); moved++; const q = o.slice(); q[1] += dx; q[2] += dy; return q; });
      if (!moved) return e;
      const e2 = primToEnt(p); if (!e2) return e;
      const c = { ...e2 }; for (const k of KEEP) if (e[k] !== undefined) c[k] = e[k]; if (e2.itype && !e.itype) c.itype = e2.itype;
      return c;
    }
    if (p.k === 5) return e;   // ağ gövdesi esnetilmez, bütün olarak kalır
    return e;
  });
}

// ---------------------------------------------------------------------------------------
// Dinamik parametreler
// ---------------------------------------------------------------------------------------
/*
 * Parametre: { id, kind:'vis'|'flip'|'rot'|'linear'|'point', label, ents:[tanım indisleri]|null (hepsi),
 *   vis:    states:[ad…], def: öntanımlı durum   (varlık.vis = [ad…] hangi durumlarda göründüğünü söyler; yoksa hep görünür)
 *   flip:   a:[x,y], b:[x,y] çevirme ekseni; def: false
 *   rot:    base:[x,y], r: tutamak yarıçapı, def: 0 (derece)
 *   linear: base:[x,y], end:[x,y], mode:'move'|'stretch', frame:[x0,y0,x1,y1] (stretch), def: |end−base|
 *   point:  base:[x,y], def:[0,0] (öteleme) }
 * Değerler yerleştirmede { id: değer } olarak durur; verilmeyen parametre öntanımlısını alır.
 */
export const DYN_KINDS = ['vis', 'flip', 'rot', 'linear', 'point'];
export const params = (def) => (def && def.dyn && Array.isArray(def.dyn.params) ? def.dyn.params : []);
export const dynValue = (prm, values) => (values && values[prm.id] != null ? values[prm.id] : prm.def);
/** Tanımın varlıklarını yerleştirmenin parametre değerleriyle değerlendirir (tanım uzayında, kopya) */
export function evalDyn(def, values) {
  let ents = clone(def.ents || []);
  const P = params(def);
  if (!P.length) return ents;
  const vis = P.find(p => p.kind === 'vis');
  // Görünürlük: elenen varlıkların indisleri kayar; öteki parametrelerin indis listeleri asıl tanıma göredir, bu yüzden
  // eleme en sonda yapılır — önce dönüşümler, sonra süzme.
  for (const prm of P) {
    const v = dynValue(prm, values);
    if (prm.kind === 'flip') { if (v && prm.a && prm.b) ents = xformSubset(ents, prm.ents, mirrorM(prm.a, prm.b)); }
    else if (prm.kind === 'rot') { const d = (say(v) - say(prm.def)) * D2R; if (d && prm.base) ents = xformSubset(ents, prm.ents, rotM(prm.base, d)); }
    else if (prm.kind === 'linear') {
      if (!prm.base || !prm.end) continue;
      const ux = prm.end[0] - prm.base[0], uy = prm.end[1] - prm.base[1], L = Math.hypot(ux, uy);
      if (!(L > 1e-12)) continue;
      const delta = say(v) - say(prm.def), dx = ux / L * delta, dy = uy / L * delta;
      if (!delta) continue;
      ents = prm.mode === 'stretch' && prm.frame ? stretchEnts(ents, prm.frame, dx, dy, prm.ents) : xformSubset(ents, prm.ents, [1, 0, 0, 1, dx, dy]);
    } else if (prm.kind === 'point') {
      const o = Array.isArray(v) ? v : [0, 0];
      if (o[0] || o[1]) ents = xformSubset(ents, prm.ents, [1, 0, 0, 1, say(o[0]), say(o[1])]);
    }
  }
  if (vis) { const st = dynValue(vis, values); ents = ents.filter(e => !(Array.isArray(e.vis) && e.vis.length) || e.vis.includes(st)); }
  return ents;
}
/**
 * Yerleştirmenin tutamakları (DÜNYA koordinatı): [{ id, kind, label, x, y, ux, uy, value }]
 * ux/uy: doğrusal parametrede yön, döndürmede merkez → tutamak yönü. Kutu tutamağından ayrı çizilir.
 */
export function dynGrips(def, values, m) {
  const out = [];
  for (const prm of params(def)) {
    const v = dynValue(prm, values);
    let p = null, dir = null;
    if (prm.kind === 'vis') p = prm.base || (def.base ? [def.base[0], def.base[1]] : [0, 0]);
    else if (prm.kind === 'flip') { p = prm.a; if (prm.b) dir = [prm.b[0] - prm.a[0], prm.b[1] - prm.a[1]]; }
    else if (prm.kind === 'rot') { const a = say(v) * D2R, r = prm.r > 0 ? prm.r : 1; p = [prm.base[0] + r * Math.cos(a), prm.base[1] + r * Math.sin(a)]; dir = [prm.base[0], prm.base[1]]; }
    else if (prm.kind === 'linear') { const ux = prm.end[0] - prm.base[0], uy = prm.end[1] - prm.base[1], L = Math.hypot(ux, uy) || 1; p = [prm.base[0] + ux / L * say(v), prm.base[1] + uy / L * say(v)]; dir = [ux / L, uy / L]; }
    else if (prm.kind === 'point') { const o = Array.isArray(v) ? v : [0, 0]; p = [prm.base[0] + say(o[0]), prm.base[1] + say(o[1])]; }
    if (!p) continue;
    const w = apply(m, p[0], p[1]);
    const g = { id: prm.id, kind: prm.kind, label: prm.label || prm.id, x: w[0], y: w[1], value: v };
    if (dir) {
      if (prm.kind === 'rot') { const c = apply(m, dir[0], dir[1]); g.cx = c[0]; g.cy = c[1]; }
      else { const d = [m[0] * dir[0] + m[2] * dir[1], m[1] * dir[0] + m[3] * dir[1]], L = Math.hypot(d[0], d[1]) || 1; g.ux = d[0] / L; g.uy = d[1] / L; }
    }
    out.push(g);
  }
  return out;
}
/**
 * Tutamak sürüklemesinden yeni değer: w dünya noktası, m yerleştirme matrisi (tersi tanım uzayına götürür).
 * Görünürlük ve çevirme sürüklenmez (dokunuşla değişir): null döner.
 */
export function dynValueAt(def, prm, w, m) {
  const inv = invert(m); if (!inv) return null;
  const q = apply(inv, w[0], w[1]);
  if (prm.kind === 'rot') { let a = Math.atan2(q[1] - prm.base[1], q[0] - prm.base[0]) / D2R; if (a < 0) a += 360; return Math.round(a * 100) / 100; }
  if (prm.kind === 'linear') { const ux = prm.end[0] - prm.base[0], uy = prm.end[1] - prm.base[1], L = Math.hypot(ux, uy) || 1; const v = ((q[0] - prm.base[0]) * ux + (q[1] - prm.base[1]) * uy) / L; return Math.max(0, Math.round(v * 1e6) / 1e6); }
  if (prm.kind === 'point') return [Math.round((q[0] - prm.base[0]) * 1e6) / 1e6, Math.round((q[1] - prm.base[1]) * 1e6) / 1e6];
  return null;
}

// ---------------------------------------------------------------------------------------
// Genişletme: tanım → dünya varlıkları → ilkeller
// ---------------------------------------------------------------------------------------
/** Tanımdaki öznitelik tanımları (sırası yerleştirmenin attrs sırasıdır) */
export const attdefsOf = (def) => (def && Array.isArray(def.ents) ? def.ents.filter(e => e && e.type === 'ATTDEF') : []);
/** Yerleştirmenin öznitelik listesi: tanımın etiketleri, verilen değerler (etikete göre), yoksa öntanımlılar */
export function attrsFor(def, given) {
  const map = new Map((given || []).map(a => [String(a[0]).toUpperCase(), a[1]]));
  return attdefsOf(def).map(a => [a.tag || '', map.has(String(a.tag || '').toUpperCase()) ? map.get(String(a.tag || '').toUpperCase()) : (a.text == null ? '' : String(a.text))]);
}
/**
 * Yerleştirmeyi ilkellere genişletir. blocks: Map(KEY → def), layers: hedef çizimin katmanları (renk çözümü).
 * Bütün ilkeller TEK info nesnesini paylaşır (scene.js'in DWG yerleştirmesiyle aynı sözleşme); anahtar ins.id#i.
 * Katman '0' ve blok rengi (0) yerleştirmeninkini alır (AutoCAD kuralı). Öznitelikler ATTRIB yazısı olur (p.ai = indis).
 */
export function expandInsert(ins, blocks, layers, info, depth = 0) {
  const def = blocks.get(keyOf(ins.name));
  if (!def || depth > MAX_DEPTH) return [];
  const m = insMatrix(ins);
  const base = Array.isArray(def.base) ? def.base : [0, 0, 0];
  const mb = mul(m, [1, 0, 0, 1, -say(base[0]), -say(base[1])]);   // tanımın tabanı ekleme noktasına oturur (AutoCAD: T(−taban))
  const lay = layers.get(ins.layer);
  const shared = info || {
    t: 'INSERT', h: ins.id, name: def.name, x: m[4], y: m[5], z: say(ins.z), rot: decompose(m).rot, sx: decompose(m).sx, sy: decompose(m).sy, m: m.slice(),
    attrs: attrsFor(def, ins.attrs), dyn: ins.dyn ? clone(ins.dyn) : undefined, blk: true, lay: ins.layer, ci: ins.color == null ? 256 : ins.color,
    col: lay ? lay.color : -1, lt: '', lw: lay ? lay.lw : 25, edited: true,
  };
  const world = xformEnts(evalDyn(def, ins.dyn), mb, say(ins.z) - say(base[2]));
  const out = [];
  let ai = 0, n = 0;
  // Ekleme noktası işareti (k=4): INS yakalaması ve bilgi paneli için; çizilmez, seçime girmez (scene.js ile aynı sözleşme)
  if (depth === 0) out.push({ k: 4, x: m[4], y: m[5], z: say(ins.z), bb: [m[4], m[5], m[4], m[5]], col: shared.col, lay: ins.layer || '0', info: shared, et: 'INSERT', key: ins.id + '#ins' });
  const attrs = shared.attrs || [];
  for (const e0 of world) {
    let e = e0;
    if (!e.layer || e.layer === '0') e = { ...e, layer: ins.layer || '0' };
    if (e.color === 0) e = { ...e, color: ins.color == null ? 256 : ins.color };
    if (e.type === 'INSERT') {
      for (const p of expandInsert({ ...e, id: ins.id + '/' + n }, blocks, layers, shared, depth + 1)) { p.key = ins.id + '#' + (n++); out.push(p); }
      continue;
    }
    if (e.type === 'ATTDEF') {
      const i = ai++;
      const invisible = (e.flags | 0) & 1;
      if (invisible) continue;
      const val = attrs[i] ? attrs[i][1] : (e.text == null ? '' : String(e.text));
      if (val === '') continue;
      const tp = entToPrim({ ...e, type: 'TEXT', text: val, id: ins.id + '#' + n }, layers);
      if (!tp) continue;
      tp.et = 'ATTRIB'; tp.ai = i; tp.key = ins.id + '#' + (n++); tp.info = shared;
      if (tp.ent) tp.ent = { ...tp.ent, tag: e.tag };
      out.push(tp);
      continue;
    }
    const p = entToPrim({ ...e, id: ins.id + '#' + n }, layers);
    if (!p) continue;
    p.key = ins.id + '#' + (n++); p.info = shared;
    out.push(p);
  }
  return out;
}
/**
 * Tanım kendine mi başvuruyor? AutoCAD bir blok tanımının kendi içinde (doğrudan ya da iç içe
 * bloklar üzerinden) kendisine başvurmasını reddeder — böyle bir tanım genişletilirken her
 * düzeyde yeniden açılır, iç içe iki yerleştirmede 2^24 ilkele kadar büyür ve uygulama kilitlenir.
 * ents: tanıma girecek varlıklar · blocks: Map(KEY → def) · name: tanımlanmakta olan ad.
 */
export function refersTo(name, ents, blocks) {
  const hedef = keyOf(name);
  if (!hedef) return false;
  const gorulen = new Set([hedef]);   // kendisi de gezilmiş sayılır: döngülü tanımlarda sonsuz gezinme olmaz
  const yigin = [ents || []];
  while (yigin.length) {
    for (const e of yigin.pop()) {
      if (!e || e.type !== 'INSERT') continue;
      const k = keyOf(e.name);
      if (k === hedef) return true;
      if (!k || gorulen.has(k)) continue;
      gorulen.add(k);
      const def = blocks && blocks.get ? blocks.get(k) : null;
      if (def && Array.isArray(def.ents)) yigin.push(def.ents);
    }
  }
  return false;
}
/** Paylaşılan info'dan yerleştirme varlığı (geri yazma: BEDIT kaydı, DXF INSERT) */
export function insFromInfo(info) {
  return { type: 'INSERT', id: info.h, name: info.name, layer: info.lay || '0', color: info.ci == null ? 256 : info.ci, x: say(info.x), y: say(info.y), z: say(info.z), rot: say(info.rot), sx: info.sx == null ? 1 : info.sx, sy: info.sy == null ? 1 : info.sy, m: insMatrix(info), attrs: info.attrs ? clone(info.attrs) : [], dyn: info.dyn ? clone(info.dyn) : undefined };
}
/**
 * DWG yerleştirmesinden tanım BENİMSEME: bir yerleştirmenin ilkelleri matrisin tersiyle tanım uzayına
 * alınır (taban 0,0,0 — AutoCAD kuralı). ATTRIB yazıları ATTDEF olur (etiket: info.attrs'tan, önce
 * değer eşleşmesiyle, sonra sırayla). Yerleştirme matrisi DWG'de x-y-rot-sx-sy'dir; taban bilinmediği
 * için taban 0 kabul edilir — bu, tanımın tabana göre yazılmış hâlidir.
 */
export function adoptFromPrims(name, prims) {
  const list = (prims || []).filter(p => p && p.k !== 4 && p.info && p.info.t === 'INSERT');
  if (!list.length) return null;
  const info = list[0].info;
  const m = insMatrix(info), inv = invert(m);
  if (!inv) return null;
  const attrs = (info.attrs || []).map(a => [String(a[0] || ''), String(a[1] == null ? '' : a[1])]), used = new Set();
  const ents = [];
  let plain = 0;
  for (const p of list) {
    const e = primToEnt(p);
    if (!e) continue;
    if (p.k === 1 && (p.et === 'ATTRIB' || p.et === 'ATTDEF')) {
      const txt = (p.lines || []).join('\n');
      let i = attrs.findIndex((a, j) => !used.has(j) && a[1] === txt);
      if (i < 0) i = attrs.findIndex((a, j) => !used.has(j));
      if (i >= 0) used.add(i);
      ents.push({ ...e, type: 'ATTDEF', tag: i >= 0 ? attrs[i][0] : (p.info.tag || 'TAG' + (ents.length + 1)), prompt: '', text: txt, flags: 0 });
      continue;
    }
    plain++;
    ents.push(e);
  }
  if (!ents.length) return null;
  const defEnts = xformEnts(ents, inv, -say(info.z));
  return { name: info.name || name, base: [0, 0, 0], ents: defEnts, dyn: null, adopted: true, plain };
}
/** Tanımın kaba sınır kutusu (tanım uzayı) */
export function defBBox(def) {
  const ps = [];
  for (const e of (def && def.ents) || []) {
    if (e.type === 'INSERT') { ps.push([say(e.x), say(e.y)]); continue; }
    const p = entToPrim(e.type === 'ATTDEF' ? { ...e, type: 'TEXT', text: e.tag || 'X' } : e, NO_LAYERS);
    if (p && p.bb && isFinite(p.bb[0])) ps.push([p.bb[0], p.bb[1]], [p.bb[2], p.bb[3]]);
  }
  if (!ps.length) return null;
  return [Math.min(...ps.map(q => q[0])), Math.min(...ps.map(q => q[1])), Math.max(...ps.map(q => q[0])), Math.max(...ps.map(q => q[1]))];
}

// ---------------------------------------------------------------------------------------
// Kırpma (XCLIP): dikdörtgen pencere
// ---------------------------------------------------------------------------------------
/** Liang–Barsky: parça (x0,y0)-(x1,y1) dikdörtgen içinde kalan bölümü ya da null */
function clipSeg(x0, y0, x1, y1, r) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const tests = [[-dx, x0 - r[0]], [dx, r[2] - x0], [-dy, y0 - r[1]], [dy, r[3] - y0]];
  for (const [p, q] of tests) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
    else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}
/** Sutherland–Hodgman: kapalı çokgeni dikdörtgene kırpar */
function clipPoly(pts, r) {
  let out = pts.slice();
  const edges = [[0, 1], [2, -1], [1, 1], [3, -1]];   // [dizin, işaret]: x ≥ x0, x ≤ x1, y ≥ y0, y ≤ y1
  for (const [k, s] of edges) {
    const inp = out; out = [];
    if (!inp.length) break;
    const inside = (q) => (k % 2 === 0 ? q[0] : q[1]) * s >= r[k] * s;
    const cross = (a, b) => { const axis = k % 2 === 0 ? 0 : 1, v = r[k]; const t = (v - a[axis]) / ((b[axis] - a[axis]) || 1e-300); return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; };
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ia = inside(a), ib = inside(b);
      if (ib) { if (!ia) out.push(cross(a, b)); out.push(b); }
      else if (ia) out.push(cross(a, b));
    }
  }
  return out;
}
/**
 * İlkelleri dikdörtgene kırpar; yeni ilkel listesi döner (kopya). Yollar parça parça kırpılır (yay ve
 * elipsler düzleştirilir), dolgular çokgen olarak kırpılır, yazı / nokta / ağ tutamağı içerdeyse kalır.
 * Dışarıda kalanlar atılır. Değişmeyen ilkel olduğu gibi (aynı nesne) döner.
 */
export function clipPrims(prims, rect) {
  const r = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const out = [];
  const inBox = (bb) => bb && bb[0] >= r[0] && bb[2] <= r[2] && bb[1] >= r[1] && bb[3] <= r[3];
  const hits = (bb) => bb && !(bb[2] < r[0] || bb[0] > r[2] || bb[3] < r[1] || bb[1] > r[3]);
  for (const p of prims || []) {
    if (!p || !p.bb) continue;
    if (!hits(p.bb)) continue;
    if (inBox(p.bb)) { out.push(p); continue; }
    if (p.k === 1 || p.k === 2) { if (p.x >= r[0] && p.x <= r[2] && p.y >= r[1] && p.y <= r[3]) out.push(p); continue; }
    if (p.k !== 0) { out.push(p); continue; }
    const parts = []; let cur = null;
    for (const o of p.ops) {
      if (o[0] === 0) { cur = [[o[1], o[2], say(o[3])]]; parts.push(cur); }
      else if (cur) { const qs = o[0] === 1 ? [[o[1], o[2], say(o[3])]] : flatten([[0, cur[cur.length - 1][0], cur[cur.length - 1][1]], o]).slice(1).map(q => [q[0], q[1], say(o[6])]); for (const q of qs) cur.push(q); }
    }
    const ops = [];
    if (p.fill) {
      for (const part of parts) { if (part.length < 3) continue; const c = clipPoly(part.map(q => [q[0], q[1]]), r); if (c.length >= 3) c.forEach((q, i) => ops.push([i ? 1 : 0, q[0], q[1], part[0][2]])); }
    } else {
      for (const part of parts) {
        const pts = p.closed && part.length > 2 ? part.concat([part[0]]) : part;
        let open = false;
        for (let i = 1; i < pts.length; i++) {
          const s = clipSeg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], r);
          if (!s) { open = false; continue; }
          const z = pts[i][2];
          if (!open || Math.hypot(s[0] - ops[ops.length - 1][1], s[1] - ops[ops.length - 1][2]) > 1e-9) { ops.push([0, s[0], s[1], z]); open = true; }
          ops.push([1, s[2], s[3], z]);
        }
      }
    }
    if (ops.length < 2) continue;
    const c = { ...p, ops, closed: !!p.fill, bb: [Math.min(...ops.map(o => o[1])), Math.min(...ops.map(o => o[2])), Math.max(...ops.map(o => o[1])), Math.max(...ops.map(o => o[2]))] };
    if (c.ent) c.ent = { ...c.ent, type: 'PATH', ops: ops.map(o => o.slice()), closed: c.closed, fill: !!p.fill };
    out.push(c);
  }
  return out;
}
/** Çokgen içinde kalan ilkeller (kaba: kutu köşeleri ya da tutamak noktası çokgende) — XCLIP çokgen seçeneği için */
export function insidePoly(prims, poly) {
  return (prims || []).filter(p => {
    if (!p || !p.bb) return false;
    if (p.k === 1 || p.k === 2) return pointInPoly(poly, p.x, p.y);
    const bb = p.bb, corners = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]];
    if (corners.some(c => pointInPoly(poly, c[0], c[1]))) return true;
    const edges = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; edges.push([a[0], a[1], b[0], b[1]]); }
    const sides = [[bb[0], bb[1], bb[2], bb[1]], [bb[2], bb[1], bb[2], bb[3]], [bb[2], bb[3], bb[0], bb[3]], [bb[0], bb[3], bb[0], bb[1]]];
    return sides.some(s => edges.some(e => segIntersect(s, e)));
  });
}

// ---------------------------------------------------------------------------------------
// Hizalama (ALIGN)
// ---------------------------------------------------------------------------------------
/**
 * AutoCAD ALIGN: 1 çift → öteleme; 2 çift → öteleme + döndürme (+ isteğe bağlı ölçek: hedef aralığı / kaynak aralığı).
 * pairs: [[kaynak, hedef], …] (dünya noktaları). Matris döner; kaynak noktalar üst üsteyse null.
 */
export function alignMatrix(pairs, scale) {
  if (!pairs || !pairs.length) return null;
  const [s1, d1] = pairs[0];
  if (pairs.length < 2) return [1, 0, 0, 1, d1[0] - s1[0], d1[1] - s1[1]];
  const [s2, d2] = pairs[1];
  const sv = [s2[0] - s1[0], s2[1] - s1[1]], dv = [d2[0] - d1[0], d2[1] - d1[1]];
  const Ls = Math.hypot(sv[0], sv[1]), Ld = Math.hypot(dv[0], dv[1]);
  if (!(Ls > 1e-12)) return null;
  const a = Math.atan2(dv[1], dv[0]) - Math.atan2(sv[1], sv[0]);
  const k = scale && Ld > 1e-12 ? Ld / Ls : 1;
  const cs = Math.cos(a) * k, sn = Math.sin(a) * k;
  // p' = d1 + R·k·(p − s1)
  return [cs, sn, -sn, cs, d1[0] - cs * s1[0] + sn * s1[1], d1[1] - sn * s1[0] - cs * s1[1]];
}
