// Proxy varlık grafikleri ayrıştırıcısı (scene.js proxy()) için tarayıcısız sınama.
// Kullanım: node tools/test_proxy.mjs
import { SceneBuilder } from '../app/src/main/assets/viewer/scene.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); };

// ---- proxy grafik akışı üretici (ODA bölüm 29: RL size, RL type, veri) ----
class W {
  constructor() { this.parts = []; this.len = 0; }
  chunk(type, body) { const b = new DataView(new ArrayBuffer(8)); b.setInt32(0, 8 + body.byteLength, true); b.setInt32(4, type, true); this.parts.push(new Uint8Array(b.buffer), new Uint8Array(body)); this.len += 8 + body.byteLength; return this; }
  out() { const u = new Uint8Array(this.len); let o = 0; for (const p of this.parts) { u.set(p, o); o += p.length; } return u; }
}
const bodyOf = (items) => { // items: ['i', n] | ['d', x] | ['s', str]
  let size = 0; for (const it of items) size += it[0] === 'i' ? 4 : it[0] === 'd' ? 8 : ((it[1].length + 1 + 3) & ~3);
  const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf); let p = 0;
  for (const it of items) { if (it[0] === 'i') { dv.setInt32(p, it[1], true); p += 4; } else if (it[0] === 'd') { dv.setFloat64(p, it[1], true); p += 8; } else { for (const ch of it[1]) u8[p++] = ch.charCodeAt(0); u8[p++] = 0; p = (p + 3) & ~3; } }
  return buf;
};
const P3 = (x, y, z) => [['d', x], ['d', y], ['d', z]];
// küp kabuğu: 8 köşe, 6 dörtgen yüz (pozitif sayaç geleneği) + renk + dolgu + çokgen + çizgi + daire + yazı + dönüşüm
const w = new W();
w.chunk(14, bodyOf([['i', 1]]));                                        // renk: ACI 1 (kırmızı)
w.chunk(20, bodyOf([['i', 1]]));                                        // dolgu açık
const V = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
const F = [4, 0, 1, 2, 3, 4, 4, 5, 6, 7, 4, 0, 1, 5, 4, 4, 1, 2, 6, 5, 4, 2, 3, 7, 6, 4, 3, 0, 4, 7];
w.chunk(9, bodyOf([['i', 8], ...V.flatMap(q => P3(...q)), ['i', F.length], ...F.map(i => ['i', i]), ['i', 0], ['i', 0], ['i', 0]]));
w.chunk(29, bodyOf([['d', 1], ['d', 0], ['d', 0], ['d', 100], ['d', 0], ['d', 1], ['d', 0], ['d', 0], ['d', 0], ['d', 0], ['d', 1], ['d', 50], ['d', 0], ['d', 0], ['d', 0], ['d', 1]]));   // x+100, z+50
w.chunk(7, bodyOf([['i', 3], ...P3(0, 0, 0), ...P3(5, 0, 0), ...P3(0, 5, 0)]));                       // üçgen çokgen (dönüşümlü)
w.chunk(31, new ArrayBuffer(0));                                        // dönüşüm kaldır
w.chunk(6, bodyOf([['i', 2], ...P3(0, 0, 20), ...P3(10, 0, 20)]));      // çizgi
w.chunk(2, bodyOf([...P3(5, 5, 30), ['d', 2], ...P3(0, 0, 1)]));        // daire
w.chunk(10, bodyOf([...P3(0, 0, 40), ...P3(0, 0, 1), ...P3(1, 0, 0), ['d', 2.5], ['d', 1], ['d', 0], ['s', 'PROXY']]));   // yazı
w.chunk(8, bodyOf([['i', 2], ['i', 3], ...P3(0, 0, 60), ...P3(1, 0, 60), ...P3(2, 0, 60), ...P3(0, 1, 60), ...P3(1, 1, 61), ...P3(2, 1, 60), ['i', 0], ['i', 0], ['i', 0]]));   // 2×3 ağ
const graphics = w.out();

const db = { header: {}, entities: [], tables: { LAYER: { entries: [{ name: '0', handle: '10', color: 7 }] }, LTYPE: { entries: [] }, STYLE: { entries: [] }, BLOCK_RECORD: { entries: [{ name: '*Model_Space', handle: '1F', flags: 0, basePoint: { x: 0, y: 0, z: 0 }, layout: '', entities: [] }] } }, objects: {} };
db.tables.BLOCK_RECORD.entries[0].entities.push({ type: 'ACAD_PROXY_ENTITY', handle: 'A1', layer: '0', colorIndex: 256, lineType: '', isVisible: true, graphics });
db.entities = db.tables.BLOCK_RECORD.entries[0].entities;
const scene = new SceneBuilder(db).build();
const prims = scene.layouts[0].prims;
const tris = prims.filter(p => p.tri), lines = prims.filter(p => p.k === 0 && !p.tri), txt = prims.filter(p => p.k === 1);
ok('proxy: kabuk 6 yüz → 12 üçgen + çokgen 1 + ağ 4 = 17 üçgen', tris.length === 17, 'tris=' + tris.length);
ok('proxy: kenarlar (küp 12, eş düzlemli çaprazlar gizli), çizgi, daire, çokgen ve ağ çizgileri', lines.length === 12 + 1 + 1 + 1 + 5, 'lines=' + lines.length);
ok('proxy: yazı okundu', txt.length === 1 && txt[0].lines[0] === 'PROXY' && Math.abs(txt[0].z - 40) < 1e-9, JSON.stringify(txt[0] && [txt[0].lines, txt[0].z]));
const tri0 = tris[0]; ok('proxy: renk ACI 1 (kırmızı) uygulanmış', tri0 && tri0.col === 0xff0000, tri0 && tri0.col.toString(16));
const poly = tris.find(p => p.ops[0][1] >= 100); ok('proxy: dönüşüm yığını uygulanmış (x+100, z+50)', !!poly && Math.abs(poly.ops[0][3] - 50) < 1e-9, poly && JSON.stringify(poly.ops[0]));
const cube = tris.filter(p => p.ops.every(o => o[1] <= 10 && o[3] <= 10)); const zs = new Set(cube.map(p => p.ops.map(o => o[3]).join(','))); ok('proxy: küp üçgenleri doğru kotlarda', cube.length === 12 && [...zs].some(z => z === '0,0,0') && [...zs].some(z => z === '10,10,10'), 'cube=' + cube.length);
ok('proxy: sayım', scene.counts.ACAD_PROXY_ENTITY === 1 && scene.counts.ACAD_PROXY_ENTITY_GRAFIK === 1, JSON.stringify(scene.counts));
// negatif sayaç geleneği (-4 a b c d …) da aynı sonucu vermeli
const w2 = new W(); const F2 = F.map((v, i) => (i % 5 === 0 ? -v : v));
w2.chunk(9, bodyOf([['i', 8], ...V.flatMap(q => P3(...q)), ['i', F2.length], ...F2.map(i => ['i', i]), ['i', 0], ['i', 0], ['i', 0]]));
db.entities[0].graphics = w2.out();
const s2 = new SceneBuilder(db).build();
ok('proxy: negatif sayaçlı kabuk 12 üçgen', s2.layouts[0].prims.filter(p => p.tri).length === 12, 'tris=' + s2.layouts[0].prims.filter(p => p.tri).length);
console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
