/*
 * DWG nesne haritası dilimleyicisi — büyük çizimleri pencere pencere okumak için.
 *
 * Sorun: LibreDWG her DWG nesnesi için bellekte tam bir yapı kurar; ölçülen maliyet nesne başına
 * ~800 bayttır (`Dwg_Object` 184 + `Dwg_Object_Entity` 296 + tür yapısı + tanıtıcı işaretçileri +
 * malloc payı). 7,09 milyon nesneli bir dosya bu yüzden 5.680 MB istiyor; WebAssembly 32 bit olduğu
 * için yığın 4096 MB'ı geçemiyor ve dosya hiçbir cihazda açılamıyor.
 *
 * Çözüm: LibreDWG nesneleri YALNIZ nesne haritasından (bölüm 2) okur — haritada olmayan bir nesneyi
 * dosyada aramaz (`decode.c`, handles_section). Haritayı biz yeniden yazarsak çözümleyicinin ne
 * okuyacağını biz belirleriz. Dosya, her biri birkaç yüz bin nesnelik pencerelere bölünür; her
 * pencere için harita yerinde yamalanır, çözümleyici yalnız o dilimi kurar, sahne ilkelleri
 * biriktirilir ve nesneler serbest bırakılır. Ölçüm: 283,8 MB / 7,09 milyon nesnelik dosyada tepe
 * bellek 5.680 MB'dan 454 MB'a indi (12,5 kat), süre değişmedi, geometri birebir aynı çıktı.
 *
 * Yalnız R13 – R2000 (AC1012 – AC1015). R2004 ve sonrasında harita sıkıştırılmış bölüm sayfalarının
 * içindedir; orada `plan()` null döner ve çağıran tek parça okumaya devam eder.
 */

// ---- CRC-16 (poly 0xA001) — LibreDWG bit_calc_CRC ile birebir aynı, tohum 0xC0C1 ---------------
const CRCT = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xA001) : (c >>> 1); t[i] = c; }
  return t;
})();
export const crc16 = (b, from, len, seed = 0xC0C1) => {
  let c = seed;
  for (let i = from, e = from + len; i < e; i++) c = ((c >>> 8) ^ CRCT[(c ^ b[i]) & 0xff]) & 0xffff;
  return c;
};

// Grafik (entity) türleri: TEXT(1) – XLINE(0x29) aralığı ile sonraki grafik türleri.
// Listede olmayan her şey (tablolar, sözlükler, sınıf tabanlı 500+ türler) her pencerede tutulur.
const ENTITY = new Set([...Array(0x29).keys()].map(i => i + 1).concat([0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x4a, 0x4d, 0x4e]));
const T_SEQEND = 0x06, T_INSERT = 0x07, T_MINSERT = 0x08, T_ATTRIB = 0x02, T_BLOCK = 0x04, T_ENDBLK = 0x05;
const OPENS = new Set([T_INSERT, T_MINSERT, T_ATTRIB, 0x0f, 0x10, 0x1d, 0x1e]);          // ardından SEQEND gelebilen türler
const VERTEX = new Set([0x0a, 0x0b, 0x0c, 0x0d, 0x0e]);
/** pencere ancak burada kapanabilir: dizi (POLYLINE…SEQEND, INSERT…ATTRIB…SEQEND) ortasında bölünmez */
const canClose = (t) => t === T_SEQEND || (!OPENS.has(t) && !VERTEX.has(t));
/** üst düzey varlık türleri: alt öge (köşe, öznitelik, dizi sonu) ve blok imleri zincir ucu olamaz */
const TOP = new Set([...ENTITY].filter((t) => !VERTEX.has(t) && t !== T_ATTRIB && t !== T_SEQEND && t !== T_BLOCK && t !== T_ENDBLK));
const DUP_MAX = 2000000;   // her pencerede yinelenen çizili varlık (INSERT/ATTRIB) toplamı bu sayıyı aşarsa pencereleme kullanılmaz

/*
 * Hangi nesne her pencerede durur, hangisi bölünür?
 *
 * Her pencerede duranlar:
 *   - grafik olmayan nesnelerin TAMAMI (tablolar, katmanlar, sözlükler, blok kayıtları, çizim sırası
 *     tabloları). Bunlar ilkel üretmez, dolayısıyla tekrarlanmaları çizimi değiştirmez.
 *   - BLOCK ve ENDBLK: blok tanımlarının çerçevesi her pencerede sağlam kalsın diye.
 *   - INSERT, MINSERT, ATTRIB ve bunları kapatan SEQEND.
 *
 * Bölünenler: geri kalan bütün varlıklar; her biri TAM OLARAK BİR pencereye girer.
 *
 * INSERT'ler neden her pencerede? Bir blok tanımının varlıkları da bölünür; pencere k yalnız kendi
 * dilimindeki blok varlıklarını taşır. INSERT her pencerede bulunduğu için o pencerede bulunan blok
 * varlıklarını patlatır ve pencerelerin birleşimi tam patlatmayı verir — hiçbir blok varlığı iki kez
 * çizilmez, çünkü her biri tek bir penceredir. INSERT'in kendi ekleme noktası imi (k=4) pencere başına
 * bir kez üretilir; birleştirme bunları ilk pencere dışında atar. ATTRIB metinleri her pencerede
 * yeniden üretilir, bu yüzden INSERT+ATTRIB sayısı pencere sayısıyla çarpıldığında büyük çıkarsa
 * pencereleme hiç kullanılmaz (aşağıdaki DUP_MAX sınırı).
 */
function readHeader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(0x15, true);
  if (!(n >= 1 && n <= 32) || 0x19 + n * 9 + 2 > u8.length) return null;
  let sec2 = null;
  for (let i = 0; i < n; i++) {
    const o = 0x19 + i * 9;
    if (u8[o] === 2) sec2 = { addr: dv.getUint32(o + 1, true), size: dv.getUint32(o + 5, true), at: o };
  }
  if (!sec2 || !sec2.size || sec2.addr + sec2.size > u8.length) return null;
  return { sec2, crcAt: 0x19 + n * 9 };
}

/** nesne haritasını okur: mutlak tanıtıcı ve mutlak dosya konumu (farklar HER SAYFADA sıfırlanır) */
function readMap(u8, sec2) {
  const H = [], O = [];
  const stop = sec2.addr + sec2.size;
  let p = sec2.addr, bad = false;
  const mc = (signed, end) => {
    let sh = 0, v = 0;
    for (let i = 0; i < 6; i++) {
      if (p >= end) { bad = true; return 0; }
      const b = u8[p++];
      if (b & 0x80) { v += (b & 0x7f) * 2 ** sh; sh += 7; continue; }
      if (!signed) return v + b * 2 ** sh;
      const neg = b & 0x40; v += (b & 0x3f) * 2 ** sh; return neg ? -v : v;
    }
    bad = true; return 0;
  };
  let pages = 0;
  while (p + 2 <= stop) {
    const start = p, ps = (u8[p] << 8) | u8[p + 1];
    p += 2;
    if (ps <= 2) break;
    const end = start + ps;
    if (end > stop || ++pages > 400000) { bad = true; break; }
    let h = 0, o = 0;
    while (p < end) { h += mc(false, end); o += mc(true, end); if (bad) break; H.push(h); O.push(o); }
    if (bad) break;
    p = end + 2;                                                  // sayfa CRC'si
  }
  return bad || !H.length ? null : { H, O };
}

/** her nesnenin türünü dosyadan okur: MS (boyut) sonra BS (tür); çözümleme yapılmaz */
function scanTypes(u8, O) {
  const T = new Uint16Array(O.length);
  for (let i = 0; i < O.length; i++) {
    let p = O[i];
    if (p + 8 > u8.length) return null;
    for (let k = 0; k < 2; k++) { const w = u8[p] | (u8[p + 1] << 8); p += 2; if (!(w & 0x8000)) break; }   // MS: 15 bitlik LE sözcükler
    const b = u8[p], code = b >> 6;                                                                        // BS: 2 denetim biti
    T[i] = code === 2 ? 0 : code === 3 ? 256
      : code === 1 ? (((b & 0x3f) << 2) | (u8[p + 1] >> 6))
      : ((((b & 0x3f) << 2) | (u8[p + 1] >> 6)) | (((((u8[p + 1] & 0x3f) << 2) | (u8[p + 2] >> 6))) << 8));
  }
  return T;
}

const encU = (v, out) => { do { let b = v % 128; v = Math.floor(v / 128); if (v) b |= 0x80; out.push(b); } while (v); };
const encS = (v, out) => {
  const neg = v < 0; let a = Math.abs(v); const g = [];
  do { g.push(a % 128); a = Math.floor(a / 128); } while (a);
  if (g[g.length - 1] & 0x40) g.push(0);                          // işaret biti değerle karışmasın
  for (let i = 0; i < g.length; i++) out.push(i < g.length - 1 ? (g[i] | 0x80) : (neg ? (g[i] | 0x40) : g[i]));
};

/** seçilen nesnelerden yeni nesne haritası: en çok 2032 baytlık sayfalar, her sayfanın sonunda CRC */
export function buildMap(H, O, idx) {
  const pages = [];
  let i = 0;
  while (i < idx.length) {
    const body = []; let lastH = 0, lastO = 0, j = i;
    while (j < idx.length) {
      const rec = [];
      encU(H[idx[j]] - lastH, rec); encS(O[idx[j]] - lastO, rec);
      if (2 + body.length + rec.length > 2032) break;
      for (const b of rec) body.push(b);
      lastH = H[idx[j]]; lastO = O[idx[j]]; j++;
    }
    if (j === i) throw new Error('nesne haritası kaydı sayfaya sığmadı');
    pages.push(body); i = j;
  }
  let total = 4;                                                  // sonlandırıcı sayfa (boyut 2) + CRC
  for (const b of pages) total += 4 + b.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of pages) {
    const start = p, ps = 2 + b.length;
    out[p++] = ps >> 8; out[p++] = ps & 0xff;
    out.set(b, p); p += b.length;
    const c = crc16(out, start, ps);
    out[p++] = c >> 8; out[p++] = c & 0xff;
  }
  const start = p;
  out[p++] = 0; out[p++] = 2;
  const c = crc16(out, start, 2);
  out[p++] = c >> 8; out[p++] = c & 0xff;
  return out;
}

/**
 * Dosyayı inceler ve pencere planı çıkarır. Dilimlemeye gerek yoksa ya da dosya desteklenmiyorsa null.
 * @param {Uint8Array} u8 dosyanın tamamı
 * @param {number} perWindow pencere başına hedeflenen nesne sayısı
 */
export function plan(u8, perWindow = 250000) {
  if (!u8 || u8.length < 0x100) return null;
  const ver = String.fromCharCode(...u8.slice(0, 6));
  if (!/^AC101[2345]$/.test(ver)) return null;
  const hdr = readHeader(u8); if (!hdr) return null;
  const map = readMap(u8, hdr.sec2); if (!map) return null;
  const T = scanTypes(u8, map.O); if (!T) return null;
  const { H, O } = map;

  const keepAlways = [], win = [];
  let prevKept = false, dup = 0;
  for (let i = 0; i < T.length; i++) {
    const t = T[i];
    const keep = !ENTITY.has(t) || t === T_BLOCK || t === T_ENDBLK
      || t === T_INSERT || t === T_MINSERT || t === T_ATTRIB
      || (t === T_SEQEND && prevKept);
    if (keep) { keepAlways.push(i); if (ENTITY.has(t)) dup++; } else win.push(i);
    prevKept = keep && (t === T_INSERT || t === T_MINSERT || t === T_ATTRIB);
  }
  if (win.length < 2 * perWindow) return null;                    // dilimlemeye değmez
  if (dup * Math.ceil(win.length / perWindow) > DUP_MAX) return null;   // her pencerede yinelenecek çizili varlık çok fazla

  const windows = [];
  let cur = [];
  for (const i of win) {
    cur.push(i);
    if (cur.length >= perWindow && canClose(T[i])) { windows.push(cur); cur = []; }
  }
  if (cur.length) { if (windows.length) { const last = windows[windows.length - 1]; if (cur.length < perWindow / 4) { for (const i of cur) last.push(i); cur = []; } } if (cur.length) windows.push(cur); }
  if (windows.length < 2) return null;                            // tek pencere: dilimlemenin faydası yok

  const orig = u8.slice(hdr.sec2.addr, hdr.sec2.addr + hdr.sec2.size);   // özgün harita (geri alma için)
  const origCrc = (u8[hdr.crcAt + 1] << 8) | u8[hdr.crcAt];
  let topLevel = 0;
  for (let i = 0; i < T.length; i++) if (TOP.has(T[i])) topLevel++;   // pencereli okumanın eksiksizlik ölçütü
  return { ver, hdr, H, O, T, keepAlways, windows, objects: H.length, topLevel, orig, origCrc };
}

/** H içinde tanıtıcıyı arar (harita tanıtıcıları artan sıralıdır); yoksa -1 */
function findH(H, h) { let lo = 0, hi = H.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (H[m] === h) return m; if (H[m] < h) lo = m + 1; else hi = m - 1; } return -1; }
/** dizide value >= v olan ilk konum */
function lowerBound(a, v) { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }

/**
 * Her harita girdisini, kendisini içeren EN DAR blok tanıtıcı aralığına atar.
 *
 * Blok aralıkları iç içedir: model uzayının aralığı ({first…last}) çizimdeki bütün blok tanımlarının
 * aralıklarını da kapsar. Bir varlığı sahibiyle eşlemek için en dar aralık alınır; böylece bir blok
 * tanımının varlığı yanlışlıkla model uzayının zincir ucu olarak seçilmez.
 * @returns {Int32Array} harita indeksi → blok sırası (-1: hiçbir bloğun aralığında değil)
 */
export function assignBlocks(pl, blocks) {
  const H = pl.H, owner = new Int32Array(H.length).fill(-1);
  const rs = blocks.map((b, i) => ({ i, a: findH(H, b.f), z: findH(H, b.l) })).filter((b) => b.a >= 0 && b.z >= b.a);
  rs.sort((x, y) => (y.z - y.a) - (x.z - x.a));                   // geniş aralık önce yazılır, dar aralık üstüne yazar
  const T = pl.T;
  for (const b of rs) for (let i = b.a; i <= b.z; i++) if (TOP.has(T[i])) owner[i] = b.i;
  return owner;                                                   // yalnız üst düzey varlıklar: zincir ucu bir sözlük ya da köşe olamaz
}

/**
 * Bir pencerede her bloğun ZİNCİR UÇLARINI hesaplar.
 *
 * LibreDWG bir bloğun varlıklarını `first_entity` bağından başlayıp `next_entity` zinciriyle yürür ve
 * `last_entity`de durur (dwg.c, get_first/next_owned_entity). Pencerede ilk halka yoksa yürüyüş hiç
 * başlamaz. Bu yüzden her blok için o pencerede bulunan ilk ve son üst düzey varlığın TANITICISI
 * verilir; çağıran bunları `dwg_absref_get_object` ile çözüp blok başlığının bağlarına yazar.
 * Konum değil tanıtıcı döner: LibreDWG nesne dizisine yer yer fazladan girdi ekleyebildiği için
 * "harita sırası = dizi konumu" eşlemesine güvenilmez.
 * @returns {Array<{bh:number,fh:number,lh:number}>} blok başlığı, ilk ve son varlık tanıtıcıları
 */
export function chainEnds(pl, blocks, owner, idxArr) {
  const nb = blocks.length, H = pl.H;
  const first = new Int32Array(nb).fill(-1), last = new Int32Array(nb).fill(-1);
  for (let p = 0; p < idxArr.length; p++) {
    const b = owner[idxArr[p]];
    if (b < 0) continue;
    if (first[b] < 0) first[b] = idxArr[p];
    last[b] = idxArr[p];
  }
  const out = [];
  for (let b = 0; b < nb; b++) if (first[b] >= 0) out.push({ bh: blocks[b].bh, fh: H[first[b]], lh: H[last[b]] });
  return out;
}

function applyIdx(u8, pl, idx) {
  const map = buildMap(pl.H, pl.O, idx);
  if (map.length > pl.hdr.sec2.size) throw new Error('pencere haritası özgün bölümden büyük');
  u8.set(map, pl.hdr.sec2.addr);
  new DataView(u8.buffer, u8.byteOffset, u8.byteLength).setUint32(pl.hdr.sec2.at + 5, map.length, true);
  const c = crc16(u8, 0, pl.hdr.crcAt);
  u8[pl.hdr.crcAt] = c & 0xff; u8[pl.hdr.crcAt + 1] = c >> 8;
  return idx.length;
}

/** yapı geçişi: yalnız her pencerede duran nesneler — blok başlıklarının bağlarını okumak için */
export function applyStructure(u8, pl) { applyIdx(u8, pl, pl.keepAlways); return pl.keepAlways; }

/** k. pencerenin haritasını dosyanın içine YERİNDE yazar (kopya çıkarmaz) */
export function applyWindow(u8, pl, k) {
  const idx = pl.keepAlways.concat(pl.windows[k]);
  idx.sort((a, b) => a - b);
  applyIdx(u8, pl, idx);
  return idx;                                                     // harita indeksi → nesne dizisi konumu eşlemesi
}

/** dosyayı özgün hâline döndürür (pencereli yol yarıda kalırsa tek parça okumaya düşülebilsin) */
export function restore(u8, pl) {
  u8.set(pl.orig, pl.hdr.sec2.addr);
  new DataView(u8.buffer, u8.byteOffset, u8.byteLength).setUint32(pl.hdr.sec2.at + 5, pl.hdr.sec2.size, true);
  u8[pl.hdr.crcAt] = pl.origCrc & 0xff; u8[pl.hdr.crcAt + 1] = pl.origCrc >> 8;
}
