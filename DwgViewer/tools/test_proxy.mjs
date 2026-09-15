// Proxy varlık grafikleri ayrıştırıcısı (scene.js proxy()) için tarayıcısız sınama.
// Kullanım: node tools/test_proxy.mjs
import { SceneBuilder } from '../app/src/main/assets/viewer/scene.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); };

// ---- proxy grafik akışı üretici (ODA bölüm 29: RL size, RL type, veri) ----
class W {
  constructor() { this.parts = []; this.len = 0; this.n = 0; }
  chunk(type, body) { const b = new DataView(new ArrayBuffer(8)); b.setInt32(0, 8 + body.byteLength, true); b.setInt32(4, type, true); this.parts.push(new Uint8Array(b.buffer), new Uint8Array(body)); this.len += 8 + body.byteLength; this.n++; return this; }
  // gerçek dosyalardaki biçim: [RL toplam uzunluk][RL kayıt sayısı] başlığı, sonra kayıtlar
  out() { const u = new Uint8Array(8 + this.len); const dv = new DataView(u.buffer); dv.setInt32(0, 8 + this.len, true); dv.setInt32(4, this.n, true); let o = 8; for (const p of this.parts) { u.set(p, o); o += p.length; } return u; }
  outNoHead() { const u = new Uint8Array(this.len); let o = 0; for (const p of this.parts) { u.set(p, o); o += p.length; } return u; }
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
const mesh = prims.filter(p => p.k === 5), lines = prims.filter(p => p.k === 0), txt = prims.filter(p => p.k === 1);
const triCount = (ps) => ps.reduce((a, p) => a + p.idx.length / 3, 0);
const segCount = (ps) => ps.reduce((a, p) => a + p.seg.length / 6, 0);
ok('proxy: yüzeyler tek sıkışık ağ ilkelinde (üçgen başına nesne yok)', mesh.length === 1, 'mesh=' + mesh.length);
ok('proxy: kabuk 6 yüz → 12 üçgen + çokgen 1 + ağ 4 = 17 üçgen', triCount(mesh) === 17, 'tris=' + triCount(mesh));
ok('proxy: küp kenarları ağ ilkelinin kenar dizisinde (12, eş düzlemli çaprazlar gizli)', segCount(mesh) === 12, 'seg=' + segCount(mesh));
ok('proxy: çizgi, daire, çokgen ve ağ çizgileri ayrı yol ilkeli', lines.length === 1 + 1 + 1 + 5, 'lines=' + lines.length);
ok('proxy: kabuk köşeleri paylaşılıyor (küp 8 köşe, çokgen 3, ağ 12)', mesh[0] && mesh[0].vtx.length / 3 === 8 + 3 + 12, 'vtx=' + (mesh[0] && mesh[0].vtx.length / 3));
ok('proxy: yazı okundu', txt.length === 1 && txt[0].lines[0] === 'PROXY' && Math.abs(txt[0].z - 40) < 1e-9, JSON.stringify(txt[0] && [txt[0].lines, txt[0].z]));
ok('proxy: renk ACI 1 (kırmızı) uygulanmış', mesh[0] && mesh[0].col === 0xff0000, mesh[0] && mesh[0].col.toString(16));
const vtx = mesh[0] ? mesh[0].vtx : new Float32Array(0);
let donusumlu = false; for (let i = 0; i + 2 < vtx.length; i += 3) if (vtx[i] >= 100 && Math.abs(vtx[i + 2] - 50) < 1e-4) donusumlu = true;
ok('proxy: dönüşüm yığını uygulanmış (x+100, z+50)', donusumlu);
let kz0 = false, kz10 = false; for (let i = 0; i + 2 < vtx.length; i += 3) { if (vtx[i] <= 10 && Math.abs(vtx[i + 2]) < 1e-6) kz0 = true; if (vtx[i] <= 10 && Math.abs(vtx[i + 2] - 10) < 1e-6) kz10 = true; }
ok('proxy: küp köşeleri doğru kotlarda', kz0 && kz10);
ok('proxy: sayım', scene.counts.ACAD_PROXY_ENTITY === 1 && scene.counts.ACAD_PROXY_ENTITY_GRAFIK === 1, JSON.stringify(scene.counts));
// negatif sayaç geleneği (-4 a b c d …) da aynı sonucu vermeli
const w2 = new W(); const F2 = F.map((v, i) => (i % 5 === 0 ? -v : v));
w2.chunk(9, bodyOf([['i', 8], ...V.flatMap(q => P3(...q)), ['i', F2.length], ...F2.map(i => ['i', i]), ['i', 0], ['i', 0], ['i', 0]]));
db.entities[0].graphics = w2.out();
const s2 = new SceneBuilder(db).build();
ok('proxy: negatif sayaçlı kabuk 12 üçgen', triCount(s2.layouts[0].prims.filter(p => p.k === 5)) === 12, 'tris=' + triCount(s2.layouts[0].prims.filter(p => p.k === 5)));
// başlıksız yazan üreticiler: aynı akış 8 baytlık metafile başlığı olmadan da çözülmeli
db.entities[0].graphics = w2.outNoHead();
const s3 = new SceneBuilder(db).build();
ok('proxy: başlıksız akış da çözülüyor', triCount(s3.layouts[0].prims.filter(p => p.k === 5)) === 12, 'tris=' + triCount(s3.layouts[0].prims.filter(p => p.k === 5)));
// köşe öznitelik sözcüğü (0x80 = köşe normali) okunmazsa kayıt sonu şaşar: normalli kabuk da 12 üçgen vermeli
const w4 = new W();
w4.chunk(9, bodyOf([['i', 8], ...V.flatMap(q => P3(...q)), ['i', F.length], ...F.map(i => ['i', i]),
  ['i', 0], ['i', 0], ['i', 0x80], ...V.flatMap(() => P3(0, 0, 1))]));
w4.chunk(6, bodyOf([['i', 2], ...P3(0, 0, 99), ...P3(10, 0, 99)]));
db.entities[0].graphics = w4.out();
const s4 = new SceneBuilder(db).build();
const m4 = s4.layouts[0].prims.filter(p => p.k === 5), l4 = s4.layouts[0].prims.filter(p => p.k === 0);
ok('proxy: köşe normalli kabuk 12 üçgen ve sonraki kayıt okunuyor', triCount(m4) === 12 && l4.length === 1, 'tris=' + triCount(m4) + ' lines=' + l4.length);
// kenar görünürlüğü: 2 = siluet, tel kafes olarak çizilmez
const nE = 24;                                                          // 6 yüz × 4 kenar
const w5 = new W();
w5.chunk(9, bodyOf([['i', 8], ...V.flatMap(q => P3(...q)), ['i', F.length], ...F.map(i => ['i', i]),
  ['i', 0x40], ...Array.from({ length: nE }, () => ['i', 2]), ['i', 0], ['i', 0]]));
db.entities[0].graphics = w5.out();
const s5 = new SceneBuilder(db).build();
ok('proxy: siluet (2) işaretli kenarlar çizilmiyor', segCount(s5.layouts[0].prims.filter(p => p.k === 5)) === 0, 'seg=' + segCount(s5.layouts[0].prims.filter(p => p.k === 5)));
console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
