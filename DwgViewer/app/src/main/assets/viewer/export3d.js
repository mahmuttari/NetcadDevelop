/*
 * 3B dışa aktarım: sahnedeki üçgen gövdeleri Wavefront OBJ ve STL'e yazar.
 *
 * Kaynak üçgenler iki yerden gelir:
 *   k=5 ağ ilkeli   — vtx (x,y,z…) + idx (üçgen köşe dizini); doğrudan kullanılır
 *   k=0 yüz yolu    — face:true olan (ya da et='3DFACE'), 3-4 köşeli düz yollar;
 *                     dörtgen 0-1-2 ve 0-2-3 üçgenlerine bölünür
 * Başka hiçbir ilkel (yazı, nokta, resim, yüz olmayan yol, ağın kenar dizisi `seg`)
 * dışa aktarılmaz: OBJ ve STL yüzey biçimleridir, çizgi taşımazlar.
 *
 * Kararlar ve nedenleri
 *  - KÖŞE TEKİLLEŞTİRME YAPILMAZ. Milyonlarca köşede karma tablosu (hash) hem yavaştır
 *    hem de tablonun kendisi üçgen dizisinden çok yer tutar. Ayrıca kazancı yalnız dosya
 *    boyutundadır: STL zaten üçgen başına 3 köşe yazar, OBJ okuyucuları da yinelenen
 *    köşeyle sorunsuz çalışır. Bu yüzden k=5 gövdesinin kendi köşe dizisi olduğu gibi
 *    yazılır (o dizi zaten tekildir), yüz yolları ise üçgen başına kendi köşesini yazar.
 *  - OBJ'de önce BÜTÜN v satırları, sonra g/usemtl blokları ve f satırları yazılır;
 *    f dizinleri 1 tabanlı ve GLOBAL'dir. Böylece gruplama sırası köşe sırasını bozmaz.
 *  - Üçgenler gezilirken tahsis yapılmaz: köşeler modül düzeyindeki geçici tipli dizilere
 *    yazılır, üçgenler geri çağırıma dokuz SAYI olarak verilir (dizi kurulmaz).
 *  - Metin çıktı tek bir dev satır dizisine toplanmaz: `sink` her 4096 satırda bir parçayı
 *    düzleştirir, satır nesneleri o anda çöpe gider. Ölçüldü — 1 milyon üçgenlik ASCII STL
 *    (204 MB metin) tek dizi + join ile 1.385 MB tepe yapıyor ve 1 GB'lık yığında düşüyordu;
 *    parçalı biriktirmede tepe 400 MB, 400 MB'lık yığında bile tamamlanıyor. Çıktı bayt
 *    bayt aynıdır. Yine de metin biçimlerin pratik sınırı ikili STL'inkinden çok
 *    aşağıdadır — çağıran OBJ ve ASCII STL için maxTris'i düşük tutmalıdır.
 *  - Bellek: ikili STL 84 + 50 x üçgen bayttır; 3 milyon üçgen ~150 MB'lık tek bir
 *    ArrayBuffer eder. WebView'de bu tahsis düşmeye yol açabildiği için maxTris eşiği
 *    aşılırsa hiçbir şey üretilmez, null döner — uyarmak çağıranın işidir.
 *  - İkili STL'in başlığındaki üçgen sayısı, GERÇEKTEN yazılan üçgen sayısıdır: taşkın
 *    dizin yüzünden atlanan üçgen olursa başlık düzeltilir ve tampon kırpılır. Yoksa
 *    okuyucu, dosyanın sonundaki sıfır baytları orijinde dejenere üçgen sanar.
 *  - Hiçbir işlev istisna fırlatmaz; bozuk girdi, eksik dizi, taşkın dizin ve NaN
 *    koordinat sessizce atlanır ya da null / boş sonuç verir.
 *  - Modülde kullanıcıya gösterilecek metin yoktur. OBJ'deki 'o', 'g' ve 'usemtl'
 *    adları biçimin kendi anahtar sözcükleridir; değerleri katman adından ya da
 *    çağıranın verdiği opts.name'den gelir, çevrilmez.
 */

/** Öntanımlı üçgen tavanı: bunun üstünde ikili STL tamponu ~150 MB'a çıkar */
const MAX_TRIS = 3000000;
/** Bir yüz yolunun en çok dört köşesi (x,y,z) — üçgen döngüsünde yeniden tahsis edilmez */
const VBUF = new Float64Array(12);
/** Üçgen normali için geçici alan */
const NBUF = new Float64Array(3);
/** Metin biriktiricinin parça boyu (satır): bu kadar satır birikince tek dizeye düzleştirilir */
const CHUNK = 4096;

const fin = (v) => (Number.isFinite(v) ? v : 0);
const scaleOf = (o) => (o && Number.isFinite(o.unitToM) && o.unitToM !== 0 ? o.unitToM : 1);
const limitOf = (o) => (o && Number.isFinite(o.maxTris) && o.maxTris > 0 ? Math.floor(o.maxTris) : MAX_TRIS);
/** Köşe dizini geçerli mi: eksi, kesirli ve tanımsız değer de elenir (idx düz dizi olabilir) */
const okIdx = (i, nv) => i >= 0 && i < nv;

/**
 * Metin biriktirici. Satırları diziye koyup sonda join'lemek satır başına ayrı bir dize
 * nesnesi demektir; asıl yük çıktının kendisi değil, o milyonlarca küçük nesnedir.
 * Satırlar CHUNK boyunda parçalarda düzleştirilir.
 */
function sink() {
  const parts = [];
  let buf = [];
  return {
    add(s) { if (buf.push(s) >= CHUNK) { parts.push(buf.join('\n')); buf = []; } },
    text() { if (buf.length) { parts.push(buf.join('\n')); buf = []; } return parts.length ? parts.join('\n') + '\n' : ''; },
  };
}

/**
 * OBJ sayı biçimi: en çok 6 ondalık, sondaki gereksiz sıfırlar atılır.
 * Tam sayılar doğrudan yazılır (12 → '12'). |v| >= 1e21 olduğunda JS'in kendi
 * gösterimi (üstel) kullanılır; o büyüklükte koordinat gerçek bir çizimde yoktur.
 */
const f6 = (v) => {
  if (!Number.isFinite(v)) return '0';
  const r = Math.round(v * 1e6) / 1e6;
  if (Number.isInteger(r)) return String(r);
  const s = r.toFixed(6);
  let e = s.length;
  while (s.charCodeAt(e - 1) === 48) e--;          // sondaki '0'lar
  if (s.charCodeAt(e - 1) === 46) e--;             // yalnız kalan '.'
  return s.slice(0, e);
};

/** OBJ belirteci: boşluk ve satır sonu ad bölerdi, alt çizgiye çevrilir */
const token = (s) => {
  const t = (s == null ? '' : String(s)).replace(/\s+/g, '_');
  return t.length ? t.slice(0, 120) : '0';
};

const isMesh = (p) => !!p && p.k === 5 && !!p.vtx && !!p.idx && p.vtx.length >= 9 && p.idx.length >= 3;
/**
 * Yüz yolu. `face` damgasını sahnenin katı/ağ dalı ile edit.js'in 3DFACE varlığı basar;
 * DXF'ten okunan 3DFACE ise düz yol olarak eklendiği için damga taşımaz — o yüzden varlık
 * türüne de bakılır, yoksa çizimden gelen bütün 3DFACE'ler dışa aktarımdan düşerdi.
 */
const isFacePath = (p) => !!p && p.k === 0 && (p.face === true || p.et === '3DFACE')
  && !!p.ops && p.ops.length >= 3 && p.ops.length <= 4;

/**
 * Yüz yolunun köşelerini out'a (x,y,z üçlüleri) yazar; köşe sayısını döndürür.
 * Yay / elips içeren yol düz yüz değildir, 0 döner. İkinci bir moveTo da reddedilir:
 * kopuk iki parça yüz değildir, birleştirilirse olmayan bir dörtgen uydurulur.
 * 3DFACE'in dördüncü köşesi üçüncüyle (ya da yol kapatılmışsa birinciyle) aynı olabilir:
 * üçgene indirilir.
 */
function faceVerts(p, out) {
  const ops = p.ops;
  let n = 0;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i], c = o[0];
    if (i === 0 ? c !== 0 : c !== 1) return 0;
    if (n === 4) return 0;
    const x = o[1], y = o[2], z = o[3] || 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
    out[n * 3] = x; out[n * 3 + 1] = y; out[n * 3 + 2] = z;
    n++;
  }
  if (n === 4) {
    const same = (a, b) => Math.abs(out[a * 3] - out[b * 3]) < 1e-12
      && Math.abs(out[a * 3 + 1] - out[b * 3 + 1]) < 1e-12
      && Math.abs(out[a * 3 + 2] - out[b * 3 + 2]) < 1e-12;
    if (same(2, 3) || same(0, 3)) n = 3;
  }
  return n >= 3 ? n : 0;
}

/**
 * Dışa aktarılabilir gövdeleri toplar.
 * → [{ p, mesh, lay, nv, nt }] — nv köşe, nt üçgen sayısı; ilkeller kopyalanmaz.
 * nt bir ÜST sınırdır: ağ gövdesinde taşkın dizinli üçgen yazım sırasında atlanır.
 */
function collect(prims) {
  const out = [];
  if (!prims || typeof prims.length !== 'number') return out;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    if (!p || p.inf) continue;
    if (isMesh(p)) {
      const nv = Math.floor(p.vtx.length / 3), nt = Math.floor(p.idx.length / 3);
      if (nv < 3 || nt < 1) continue;
      out.push({ p, mesh: true, lay: token(p.lay), nv, nt });
      continue;
    }
    if (isFacePath(p)) {
      const n = faceVerts(p, VBUF);
      if (!n) continue;
      out.push({ p, mesh: false, lay: token(p.lay), nv: n, nt: n - 2 });
    }
  }
  return out;
}

const triCount = (bodies) => { let n = 0; for (let i = 0; i < bodies.length; i++) n += bodies[i].nt; return n; };

/**
 * Bütün üçgenleri gezer; her üçgeni dokuz sayı olarak fn'e verir (ölçek uygulanmış).
 * Dizi kurulmaz, nesne üretilmez — üç milyon üçgende çöp toplayıcı çalışmasın.
 * → gerçekten verilen üçgen sayısı (taşkın dizinliler atlandığı için nt toplamından az olabilir)
 */
function forEachTri(bodies, s, fn) {
  let done = 0;
  for (let bi = 0; bi < bodies.length; bi++) {
    const b = bodies[bi];
    if (b.mesh) {
      const V = b.p.vtx, I = b.p.idx, nv = b.nv;
      for (let i = 0; i + 2 < I.length; i += 3) {
        const a = I[i], c = I[i + 1], d = I[i + 2];
        if (!okIdx(a, nv) || !okIdx(c, nv) || !okIdx(d, nv)) continue;   // taşkın dizin: üçgen atlanır
        const ai = a * 3, ci = c * 3, di = d * 3;
        fn(fin(V[ai]) * s, fin(V[ai + 1]) * s, fin(V[ai + 2]) * s,
          fin(V[ci]) * s, fin(V[ci + 1]) * s, fin(V[ci + 2]) * s,
          fin(V[di]) * s, fin(V[di + 1]) * s, fin(V[di + 2]) * s);
        done++;
      }
      continue;
    }
    const n = faceVerts(b.p, VBUF);
    if (n < 3) continue;
    fn(VBUF[0] * s, VBUF[1] * s, VBUF[2] * s, VBUF[3] * s, VBUF[4] * s, VBUF[5] * s, VBUF[6] * s, VBUF[7] * s, VBUF[8] * s);
    done++;
    if (n === 4) {
      fn(VBUF[0] * s, VBUF[1] * s, VBUF[2] * s, VBUF[6] * s, VBUF[7] * s, VBUF[8] * s, VBUF[9] * s, VBUF[10] * s, VBUF[11] * s);
      done++;
    }
  }
  return done;
}

/** Sağ el kuralıyla birim normal; dejenere üçgende [0,0,0]. Sonuç NBUF'a yazılır. */
function normal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz);
  if (L > 0) { NBUF[0] = nx / L; NBUF[1] = ny / L; NBUF[2] = nz / L; }
  else { NBUF[0] = 0; NBUF[1] = 0; NBUF[2] = 0; }
}

/**
 * Sahnenin 3B içeriğinin sayımı ve kaba dosya boyutu tahmini.
 * bytesStl ikili STL'in TAM boyudur (84 + 50 x üçgen); bytesObj tahmindir —
 * gerçek boyut koordinatların ondalık uzunluğuna göre değişir (± %40).
 * maxTris burada uygulanmaz: eşiği sınamak için önce bu sayılar okunur.
 */
export function meshStats(prims) {
  const bodies = collect(prims);
  let tris = 0, verts = 0;
  for (let i = 0; i < bodies.length; i++) { tris += bodies[i].nt; verts += bodies[i].nv; }
  return {
    bodies: bodies.length,
    tris,
    verts,
    bytesObj: bodies.length ? 64 + verts * 26 + tris * 22 + bodies.length * 24 : 0,
    bytesStl: tris ? 84 + tris * 50 : 0,
  };
}

/**
 * Wavefront OBJ metni.
 *   opts { name, unitToM, byLayer, maxTris }
 * Gövde yoksa ya da üçgen sayısı maxTris'i aşarsa null döner.
 */
export function objText(prims, opts) {
  const o = opts || {};
  const bodies = collect(prims);
  if (!bodies.length) return null;
  const tris = triCount(bodies);
  if (tris > limitOf(o)) return null;
  const s = scaleOf(o);
  const name = token(o.name == null ? 'model' : o.name);
  const L = sink();
  L.add('o ' + name);
  // 1. geçiş: bütün köşeler, gövde sırasıyla. Her gövdenin küresel taban dizini saklanır.
  let base = 1;
  for (let bi = 0; bi < bodies.length; bi++) {
    const b = bodies[bi];
    b.base = base;
    if (b.mesh) {
      const V = b.p.vtx;
      for (let i = 0; i + 2 < V.length; i += 3) L.add('v ' + f6(fin(V[i]) * s) + ' ' + f6(fin(V[i + 1]) * s) + ' ' + f6(fin(V[i + 2]) * s));
    } else {
      const n = faceVerts(b.p, VBUF);
      for (let i = 0; i < n; i++) L.add('v ' + f6(VBUF[i * 3] * s) + ' ' + f6(VBUF[i * 3 + 1] * s) + ' ' + f6(VBUF[i * 3 + 2] * s));
    }
    base += b.nv;
  }
  // 2. geçiş: gruplar ve yüzler. Sıra değişse de f dizinleri küresel olduğu için köşeler yerinde kalır.
  const groups = new Map();
  for (let bi = 0; bi < bodies.length; bi++) {
    const b = bodies[bi];
    const g = o.byLayer ? b.lay : name;
    let arr = groups.get(g);
    if (!arr) { arr = []; groups.set(g, arr); }
    arr.push(b);
  }
  for (const [g, arr] of groups) {
    L.add('g ' + g);
    L.add('usemtl ' + g);                        // .mtl üretilmez: malzeme adı yalnız gruplamayı korur
    for (let ai = 0; ai < arr.length; ai++) {
      const b = arr[ai], base0 = b.base;
      if (b.mesh) {
        const I = b.p.idx, nv = b.nv;
        for (let i = 0; i + 2 < I.length; i += 3) {
          const a = I[i], c = I[i + 1], d = I[i + 2];
          if (!okIdx(a, nv) || !okIdx(c, nv) || !okIdx(d, nv)) continue;
          L.add('f ' + (base0 + a) + ' ' + (base0 + c) + ' ' + (base0 + d));
        }
      } else {
        L.add('f ' + base0 + ' ' + (base0 + 1) + ' ' + (base0 + 2));
        if (b.nv === 4) L.add('f ' + base0 + ' ' + (base0 + 2) + ' ' + (base0 + 3));
      }
    }
  }
  return L.text();
}

/**
 * İkili STL: 80 bayt başlık + uint32 üçgen sayısı + üçgen başına 50 bayt
 * (normal + 3 köşe = 12 float32, ardından uint16 öznitelik sayacı = 0).
 * Gövde yoksa, eşik aşılırsa ya da tampon tahsisi başarısızsa null döner.
 */
export function stlBinary(prims, opts) {
  const o = opts || {};
  const bodies = collect(prims);
  if (!bodies.length) return null;
  const tris = triCount(bodies);
  if (!tris || tris > limitOf(o)) return null;
  let u8;
  try {
    u8 = new Uint8Array(84 + tris * 50);
  } catch (e) {
    return null;                                  // bellek yetmedi: çağıran uyarır
  }
  const dv = new DataView(u8.buffer);
  // 80 baytlık başlık. 'solid' ile başlayan ikili dosyayı bazı okuyucular ASCII sanar,
  // bu yüzden ada gerekirse bir alt çizgi eklenir. Başlık yalnız ASCII taşır.
  let head = (o.name == null ? 'model' : String(o.name)).replace(/[^\x20-\x7e]/g, '_');
  if (/^solid/i.test(head)) head = '_' + head;
  for (let i = 0; i < 80 && i < head.length; i++) u8[i] = head.charCodeAt(i) & 0x7f;
  const s = scaleOf(o);
  let off = 84;
  const wrote = forEachTri(bodies, s, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    normal(ax, ay, az, bx, by, bz, cx, cy, cz);
    dv.setFloat32(off, NBUF[0], true); dv.setFloat32(off + 4, NBUF[1], true); dv.setFloat32(off + 8, NBUF[2], true);
    dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
    dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
    dv.setUint16(off + 48, 0, true);
    off += 50;
  });
  if (!wrote) return null;                        // hepsi atlandıysa boş dosya değil, null
  dv.setUint32(80, wrote, true);                  // sayaç YAZILANI söyler; atlanan üçgen varsa tampon kırpılır
  return wrote === tris ? u8 : u8.subarray(0, off);
}

/**
 * ASCII STL. İkilinin ~4 katı yer tutar; yalnız küçük modeller ve gözle denetim için.
 * ASCII biçimde katman/grup taşınmaz — dosyada tek bir solid vardır.
 */
export function stlText(prims, opts) {
  const o = opts || {};
  const bodies = collect(prims);
  if (!bodies.length) return null;
  const tris = triCount(bodies);
  if (!tris || tris > limitOf(o)) return null;
  const s = scaleOf(o);
  const name = token(o.name == null ? 'model' : o.name);
  const L = sink();
  L.add('solid ' + name);
  const wrote = forEachTri(bodies, s, (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    normal(ax, ay, az, bx, by, bz, cx, cy, cz);
    L.add('facet normal ' + f6(NBUF[0]) + ' ' + f6(NBUF[1]) + ' ' + f6(NBUF[2]));
    L.add('  outer loop');
    L.add('    vertex ' + f6(ax) + ' ' + f6(ay) + ' ' + f6(az));
    L.add('    vertex ' + f6(bx) + ' ' + f6(by) + ' ' + f6(bz));
    L.add('    vertex ' + f6(cx) + ' ' + f6(cy) + ' ' + f6(cz));
    L.add('  endloop');
    L.add('endfacet');
  });
  if (!wrote) return null;                        // tek üçgen bile yazılmadıysa boş solid döndürülmez
  L.add('endsolid ' + name);
  return L.text();
}
