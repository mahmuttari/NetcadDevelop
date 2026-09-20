// MicroStation DGN okuyucusu (viewer/dgn.js) için tarayıcısız sınama.
// Kullanım: node tools/test_dgn.mjs
//
// Örnek dosya depoya konmaz: ISFF elemanları burada BAYT BAYT kurulur (test_xlbook.mjs'in
// OLE/BIFF üretiminde olduğu gibi). Böylece hem yazma hem okuma tarafı aynı belirtimden
// beslenir ve bir kayma anında görülür.
import { parseDgn, isDgn, dgnKind } from '../app/src/main/assets/viewer/dgn.js';
import { SceneBuilder } from '../app/src/main/assets/viewer/scene.js';
import { putI32, putU16, putVax, elem, disp, tcb, renkTablosu, cizgi, cokgen, elips, yay, yazi, kapsayici, bsplineBaslik, dugumler, dosya, UOR_ALT, ALT_ANA, U } from './dgn_ornek.mjs';


let pass = 0, fail = 0;
const ok = (ad, kosul, ek = '') => { if (kosul) pass++; else fail++; console.log((kosul ? 'PASS ' : 'FAIL ') + ad + (ek ? ' ' + ek : '')); return !!kosul; };
const yakin = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

/* ================= 1) tanıma ve sayı kuruluşu ================= */
const bosV7 = dosya([tcb(false)]);
ok('1a  V7 başlığı tanınır', dgnKind(bosV7) === 'v7' && isDgn(bosV7));
ok('1b  3B V7 başlığı tanınır (ilk bayt 0xC8)', dosya([tcb(true)])[0] === 0xc8 && dgnKind(dosya([tcb(true)])) === 'v7');
ok('1c  DGN olmayan bayt reddedilir', !isDgn(new Uint8Array([0x41, 0x43, 0x31, 0x30, 0x31, 0x35])) && !isDgn(new Uint8Array(4)));
{
  // V8: OLE bileşik dosya imzası + kökte "Dgn~H" akış adı (UTF-16LE)
  const v8 = new Uint8Array(1024);
  v8.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  const ad = 'Dgn~H';
  for (let i = 0; i < ad.length; i++) { v8[512 + i * 2] = ad.charCodeAt(i); v8[512 + i * 2 + 1] = 0; }
  ok('1d  V8 (OLE kabuklu) tanınır', dgnKind(v8) === 'v8');
  let m = '';
  try { parseDgn(v8); } catch (e) { m = e.message; }
  ok('1e  V8 açık iletiyle reddedilir', /V8/.test(m) && /V7/.test(m), m.slice(0, 60));
  const olmayan = new Uint8Array(1024); olmayan.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  ok('1f  DGN olmayan OLE dosyası (Excel/Word) DGN sayılmaz', dgnKind(olmayan) === null);
}
{
  // VAX çift gidiş-dönüşü: yazıcı ile okuyucu aynı sayıyı vermeli
  const b = new Uint8Array(8);
  let hepsi = true;
  for (const x of [1, -1, 0.125, -0.125, 1234.5678, 1e6, -3.14159265358979, 1e-4]) {
    putVax(b, 0, x);
    const e = elem(1, 15, 72); disp(e, {}); e.set(b, 36); putVax(e, 44, x); putI32(e, 52, 0); putVax(e, 56, 0); putVax(e, 64, 0);
    const d = parseDgn(dosya([tcb(false), e]));
    // birincil eksen = |x| × ölçek
    const ent = d.entities[0];
    const r = ent ? (ent.radius != null ? ent.radius : Math.hypot(ent.majorAxisEndPoint.x, ent.majorAxisEndPoint.y)) : NaN;
    if (!yakin(r, Math.abs(x) / (UOR_ALT * ALT_ANA), Math.abs(x) * 1e-12 + 1e-15)) { hepsi = false; console.log('   sapma', x, r); }
  }
  ok('1g  VAX çift gidiş-dönüşü sekiz değerde bire bir', hepsi);
}

/* ================= 2) tek düzey geometri ================= */
const RENK = { 0: [255, 255, 255], 1: [255, 0, 0], 2: [0, 170, 0], 3: [0, 0, 255], 4: [255, 255, 0] };
const metin = new Uint8Array([0xc7, 0xdd, 0x5a, 0xdd, 0x4d]);   // "ÇİZİM" — windows-1254
const ana = dosya([
  tcb(false),
  renkTablosu(RENK),
  cizgi(1, 1, 0, 0, 5, 2),
  cizgi(1, 1, 7, 7, 7, 7),                                   // sıfır boylu çizgi = nokta
  cokgen(2, 4, 2, [[0, 0], [1, 0], [1, 1], [0, 1]], { stil: 2 }),
  cokgen(3, 6, 3, [[10, 10], [14, 10], [14, 13], [10, 13], [10, 10]], { dolgu: 4 }),
  elips(4, 1, 20, 20, 3, 3, 0),
  elips(4, 2, 30, 20, 4, 2, 30),
  yay(5, 3, 40, 40, 5, 5, 0, 0, 90),
  yay(5, 3, 60, 40, 5, 5, 0, 0, -90),
  yazi(6, 1, 2, 3, 0.5, 0.25, 15, 7, metin),
  elem(9, 23, 60),                                            // CONE: desteklenmeyen
]);
const db = parseDgn(ana);
const tur = (t) => db.entities.filter(e => e.type === t);

ok('2a  başlık ve birim', db.header.ACADVER === 'DGN V7 · 2B' && db.header.INSUNITS === 6, db.header.ACADVER + ' / ' + db.header.INSUNITS);
{
  const l = tur('LINE')[0];
  ok('2b  LINE ana birime çevrildi', l && yakin(l.startPoint.x, 0) && yakin(l.endPoint.x, 5) && yakin(l.endPoint.y, 2),
    l ? `${l.endPoint.x},${l.endPoint.y}` : 'yok');
  ok('2c  sıfır boylu çizgi POINT oldu', tur('POINT').length === 1 && yakin(tur('POINT')[0].position.x, 7));
  ok('2d  renk tablosundan gerçek renk', l && l.color === 0xff0000 && l.colorIndex === 1, l ? String(l.color) : 'yok');
}
{
  const p = tur('LWPOLYLINE');
  const acik = p.find(q => !(q.flag & 512)), kapali = p.find(q => (q.flag & 512));
  ok('2e  LINE_STRING açık LWPOLYLINE (4 köşe)', acik && acik.vertices.length === 4 && yakin(acik.vertices[2].x, 1));
  ok('2f  SHAPE kapalı LWPOLYLINE, yinelenen son köşe atıldı', kapali && kapali.vertices.length === 4, kapali ? String(kapali.vertices.length) : 'yok');
  ok('2g  çizgi stili adı taşındı', acik && acik.lineType === 'DGN 2', acik ? acik.lineType : 'yok');
}
{
  const h = tur('HATCH')[0];
  ok('2h  dolgu bağlantısı SOLID taramaya çevrildi', h && h.solidFill === 1 && h.boundaryPaths[0].vertices.length === 4);
  ok('2i  tarama dolgu rengini alır (indis 4 = sarı)', h && h.colorIndex === 4 && h.color === 0xffff00, h ? String(h.color) : 'yok');
}
{
  const c = tur('CIRCLE')[0], el = tur('ELLIPSE')[0];
  ok('2j  eş eksenli tam elips CIRCLE olur', c && yakin(c.radius, 3) && yakin(c.center.x, 20), c ? String(c.radius) : 'yok');
  ok('2k  farklı eksenli elips ELLIPSE kalır', el && yakin(Math.hypot(el.majorAxisEndPoint.x, el.majorAxisEndPoint.y), 4) && yakin(el.axisRatio, 0.5));
  ok('2l  elips dönmesi ana eksene işlendi (30°)', el && yakin(Math.atan2(el.majorAxisEndPoint.y, el.majorAxisEndPoint.x), 30 * Math.PI / 180, 1e-9));
}
{
  const a = tur('ARC');
  const poz = a.find(q => yakin(q.center.x, 40)), neg = a.find(q => yakin(q.center.x, 60));
  ok('2m  pozitif süpürme 0° → 90°', poz && yakin(poz.startAngle, 0) && yakin(poz.endAngle, Math.PI / 2));
  ok('2n  negatif süpürme saat yönünün tersine çevrildi (−90° → 0°)', neg && yakin(neg.startAngle, -Math.PI / 2) && yakin(neg.endAngle, 0),
    neg ? `${neg.startAngle},${neg.endAngle}` : 'yok');
}
{
  const y = tur('TEXT')[0];
  ok('2o  yazı windows-1254 ile çözüldü', y && y.text === 'ÇİZİM', y ? y.text : 'yok');
  ok('2p  yazı yüksekliği ve genişlik oranı', y && yakin(y.textHeight, 0.5, 1e-6) && yakin(y.xScale, 0.5, 1e-6), y ? `${y.textHeight}/${y.xScale}` : 'yok');
  ok('2q  yazı dönmesi radyana çevrildi', y && yakin(y.rotation, 15 * Math.PI / 180, 1e-9));
  ok('2r  ortala/ortala hizalaması (7) → halign 1, valign 2', y && y.halign === 1 && y.valign === 2);
  ok('2s  hizalama noktası hem startPoint hem endPoint', y && yakin(y.startPoint.x, 2) && yakin(y.endPoint.y, 3));
}
ok('2t  seviyeler katman oldu', ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6'].every(n => db.tables.LAYER.entries.some(l => l.name === n)));
ok('2u  yalnız kullanılan çizgi tipi tabloya girer', db.tables.LTYPE.entries.length === 1 && db.tables.LTYPE.entries[0].name === 'DGN 2'
  && db.tables.LTYPE.entries[0].totalPatternLength > 0 && db.tables.LTYPE.entries[0].pattern.length === 2);
ok('2v  model uzayı bloğu bütün varlıkları taşır', db.tables.BLOCK_RECORD.entries.length === 1
  && db.tables.BLOCK_RECORD.entries[0].entities.length === db.entities.length);
ok('2w  sayım tablosu doldu', db.census.LINE === 2 && db.census.SHAPE === 1 && db.census.TEXT === 1 && db.census.ELLIPSE === 2);
ok('2x  desteklenmeyen tür sessiz geçilmez', db.dgn.desteksiz.CONE === 1);
ok('2y  tanıtıcılar benzersiz', new Set(db.entities.map(e => e.handle)).size === db.entities.length);

/* ================= 3) bileşik elemanlar ================= */
{
  const f = dosya([
    tcb(false),
    kapsayici(1, 2),                                          // CELL_HEADER
    cizgi(1, 1, 0, 0, 1, 0, { karmasik: true }),
    cizgi(1, 1, 1, 0, 1, 1, { karmasik: true }),
    kapsayici(2, 12, 44),                                     // COMPLEX_CHAIN
    cokgen(2, 4, 1, [[5, 5], [6, 5], [6, 6]], { karmasik: true }),
    kapsayici(3, 34, 40),                                     // SHARED_CELL_DEFN — üyeleri çizilmez
    cizgi(3, 1, 99, 99, 100, 100, { karmasik: true }),
    cizgi(4, 1, 20, 20, 21, 21),                              // tanımdan sonra normal eleman
  ]);
  const d = parseDgn(f);
  const cz = d.entities.filter(e => e.type === 'LINE');
  ok('3a  hücre üyeleri düzleştirildi (2 çizgi)', cz.length === 3, String(cz.length));
  ok('3b  karmaşık zincir üyesi çizildi', d.entities.some(e => e.type === 'LWPOLYLINE' && yakin(e.vertices[0].x, 5)));
  ok('3c  paylaşılan hücre TANIMI çizilmez', !cz.some(e => yakin(e.startPoint.x, 99)));
  ok('3d  tanımdan sonraki normal eleman yine çizilir', cz.some(e => yakin(e.startPoint.x, 20)));
  ok('3e  kapsayıcının kendisi varlık üretmez', !d.entities.some(e => /CELL|CHAIN/.test(e.type)));
}

/* ================= 4) B-spline ================= */
{
  const kutup = [[0, 0], [1, 2], [3, 2], [4, 0]];
  const dv = [0, 0, 0, 0, 1, 1, 1, 1];
  const f = dosya([
    tcb(false),
    bsplineBaslik(1, 3, kutup.length, dv.length),
    cokgen(1, 21, 1, kutup, { karmasik: true }),
    dugumler(1, dv),
    cizgi(1, 1, 0, 0, 1, 1),                                  // bspline birikimini kapatır
  ]);
  const d = parseDgn(f);
  const sp = d.entities.find(e => e.type === 'SPLINE');
  ok('4a  B-spline SPLINE varlığına çevrildi', !!sp);
  ok('4b  derece ve kutup sayısı', sp && sp.degree === 3 && sp.controlPoints.length === 4, sp ? `${sp.degree}/${sp.controlPoints.length}` : 'yok');
  ok('4c  düğüm vektörü (n + derece + 1) sayıda geldi', sp && sp.knots && sp.knots.length === 8, sp && sp.knots ? String(sp.knots.length) : 'yok');
  ok('4d  kutuplar ana birimde', sp && yakin(sp.controlPoints[3].x, 4));
  ok('4e  spline kapandıktan sonra normal eleman okunur', d.entities.some(e => e.type === 'LINE'));
}

/* ================= 5) 3B dosya ================= */
{
  const b = elem(1, 4, 4 + 34 + 3 * 12 + 2);                  // 3B çizgi dizisi: pntsize 12
  disp(b, { renk: 1 });
  putU16(b, 36, 3);
  [[0, 0, 0], [1, 0, 1], [2, 0, 2]].forEach(([x, y, z], i) => {
    putI32(b, 38 + i * 12, U(x)); putI32(b, 42 + i * 12, U(y)); putI32(b, 46 + i * 12, U(z));
  });
  const d = parseDgn(dosya([tcb(true), b]));
  ok('5a  3B dosyada boyut 3 okundu', d.dgn.boyut === 3 && d.header.ACADVER === 'DGN V7 · 3B');
  const p = d.entities.find(e => e.type === 'POLYLINE3D');
  ok('5b  kotu değişen dizi POLYLINE3D oldu', p && p.vertices.length === 3 && yakin(p.vertices[2].z, 2), p ? String(p.vertices.length) : 'yok');
}

/* ================= 6) sahne kurulumu ================= */
{
  const s = new SceneBuilder(db).build();
  const prims = s.layouts[0].prims;
  ok('6a  SceneBuilder DGN veritabanını kurar', prims.length > 0, String(prims.length));
  ok('6b  katmanlar sahneye geçti', s.layers.length >= 6, String(s.layers.length));
  const ext = s.layouts[0].ext;
  ok('6c  çizim sınırları makul (metre)', ext[0] >= -1 && ext[2] > 30 && ext[2] < 100, JSON.stringify(ext.map(v => Math.round(v))));
  ok('6d  yazı ilkeli üretildi', prims.some(p => p.k === 1));
  ok('6e  dolu tarama ilkeli üretildi', prims.some(p => p.k === 0 && p.fill));
}

/* ================= 7) bozuk / kısa dosya ================= */
{
  const kirik = ana.slice(0, 1536 + 400);                     // renk tablosunun ortasından kesildi
  let hata = '';
  let d = null;
  try { d = parseDgn(kirik); } catch (e) { hata = e.message; }
  ok('7a  kısaltılmış dosya çökmez', !hata, hata);
  ok('7b  kısaltılmış dosyada eksik eleman okunmaz', d && d.entities.length === 0, d ? String(d.entities.length) : 'yok');
  const bozukBoy = dosya([tcb(false), (() => { const b = cizgi(1, 1, 0, 0, 1, 1); putU16(b, 2, 30000); return b; })()]);
  let h2 = '';
  try { parseDgn(bozukBoy); } catch (e) { h2 = e.message; }
  ok('7c  taşkın eleman boyu gezintiyi durdurur, çökme yok', !h2, h2);
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
