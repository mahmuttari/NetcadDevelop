/*
 * Blok kütüphanesi ve dosyalar arası pano.
 *
 * İki iş yapar:
 *   1. İlkelleri (scene.js / edit.js prim) taşınabilir VARLIK (ent) biçimine çevirir ve
 *      varlık kümesini öteler, ölçekler, döndürür.
 *   2. Bu kümeleri yerel depoya (state.js store) adlı blok ya da pano olarak yazar/okur.
 *
 * NEDEN böyle:
 *
 *  - Depolama anahtarları 'blocklib' (adlı bloklar) ve 'clipboard' (tek gözlü pano). İkisi de
 *    AÇIK DOSYAYA DEĞİL CİHAZA bağlıdır: kullanıcı bir çizimde kopyalayıp başka bir çizimde
 *    yapıştırabilsin diye. Dosya anahtarı (S.fileKey) bilerek karıştırılmaz; karıştırılsaydı
 *    dosyalar arası yapıştırma olmazdı. Bunun bedeli, iki dosyanın aynı panoyu paylaşmasıdır.
 *
 *  - Saklanan şey ilkel değil VARLIK'tır. İlkel; sınır kutusu, katman rengi, çizgi tipi ölçeği
 *    gibi türetilmiş alanlar taşır ve Float32Array içerir — JSON turundan sağ çıkmaz
 *    (Float32Array düz nesneye döner). Varlık biçimi ise saf sayı ve dizidir; okunduğunda
 *    edit.js entToPrim ile yeniden ilkele çevrilir, böylece hedef dosyanın katman renkleri
 *    ve kalınlıkları uygulanır.
 *
 *  - k=0 yolu PATH olarak saklanır ve `ops` OLDUĞU GİBİ kopyalanır. Yol düzleştirilseydi
 *    (flatten) yay ve elips bilgisi kaybolur, blok her yapıştırmada bir parça daha bozulurdu.
 *
 *  - Boyut sınırı: tek blok ya da pano içeriği 2 MB'ı (JSON) aşarsa hiç yazılmaz, false döner.
 *    Depo Android tarafında dosyaya, tarayıcıda localStorage'a yazar; ikisi de sessizce
 *    başarısız olabilir, o yüzden sınır yazmadan ÖNCE denetlenir. Ağ (MESH) varlıklarında dizi
 *    uzunluğu milyonu bulabildiği için önce kaba bir boyut kestirimi yapılır; kestirim sınırın
 *    çok üstündeyse JSON.stringify hiç çağrılmaz (koca metni boşuna kurmamak için).
 *
 *  - Hiçbir işlev istisna fırlatmaz: bozuk girdide null, boş dizi ya da false döner.
 *  - Kullanıcıya gösterilecek metin üretilmez; yalnız veri ve sayı döner (i18n çağıranın işi).
 */
import { transformDef } from './annot.js';

const LIB_KEY = 'blocklib';
const CLIP_KEY = 'clipboard';
const MAX_JSON = 2 * 1024 * 1024;      // tek blok / pano içeriği için üst sınır (JSON karakteri)
const MAX_NAME = 60;
const BOS_BB = [0, 0, 0, 0];

const say = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const dizi = (a) => (a && typeof a.length === 'number' ? Array.from(a) : []);
const nokta = (p) => [say(p[0]), say(p[1]), say(p[2])];

// ---------------------------------------------------------------------------------------
// İlkel → varlık
// ---------------------------------------------------------------------------------------
/** Yol işlemi kopyası; eksik z (undefined) 0'a çekilir ki JSON turunda null'a düşmesin. */
const opKopya = (o) => {
  const c = o.slice();
  if (c[0] === 0 || c[0] === 1) c[3] = say(c[3]);
  else if (c[0] === 2 || c[0] === -2) c[6] = say(c[6]);
  return c;
};

/**
 * İlkeli taşınabilir varlığa çevirir. Çizilemeyen ilkellerde (k=3 resim, k=4 blok ekleme
 * noktası) null döner: resim ham veriyi dosyanın kendisinden alır, ekleme noktasının kendi
 * geometrisi yoktur — ikisi de panoya anlamlı biçimde giremez.
 * Katman ve renk (info.ci; 256 = katmandan) taşınır, türetilmiş renk (info.col) taşınmaz:
 * blok hedef dosyanın katman renklerini almalıdır.
 */
export function primToEnt(p) {
  if (!p || typeof p !== 'object') return null;
  const inf = p.info || {};
  const ort = {
    layer: p.lay || inf.lay || '0',
    color: typeof inf.ci === 'number' ? inf.ci : 256,
  };
  if (inf.gid) ort.gid = inf.gid;                       // grup kimliği: parçalar birlikte seçilir
  if (typeof p.et === 'string') ort.itype = p.et;       // bilgi türü üstüne yazımı (ok başı, ölçü parçası)
  if (Array.isArray(p.vis) && p.vis.length) ort.vis = p.vis.slice();   // dinamik blok görünürlük durumları (blocks.js)
  if (p.ent && p.ent.def && typeof p.ent.def === 'object') {
    // ölçü tanımı: bloğa alınan / panoya kopyalanan ölçü hedefte de düzenlenebilir kalsın
    ort.def = JSON.parse(JSON.stringify(p.ent.def));
    if (typeof p.ent.measure === 'number') ort.measure = p.ent.measure;
  }
  switch (p.k) {
    case 0: {
      if (!Array.isArray(p.ops)) return null;
      // dizi olmayan işlem atılır: bozuk bir yol yüzünden istisna fırlatılmaz
      const ops = p.ops.filter(Array.isArray).map(opKopya);
      if (ops.length < 2) return null;                    // tek işlemli yol (yalnız moveto) çizilmez; entToPrim de üretmez
      if (p.bg) {                                         // maske (WIPEOUT): sınır çokgeni taşınır, dolgu arka plan rengidir
        const pts = []; for (const o of ops) { if (o[0] === 0 || o[0] === 1) pts.push([o[1], o[2], say(o[3])]); }
        if (pts.length >= 3) return { ...ort, type: 'WIPEOUT', pts };
      }
      return {
        ...ort, type: 'PATH',
        ops,
        closed: !!p.closed, fill: !!p.fill, width: say(p.w),
      };
    }
    case 1: {
      const text = (p.lines || []).join('\n');
      if (!text) return null;                           // boş yazı geri çevrildiğinde ilkel üretmez
      const e = {
        ...ort, type: 'TEXT', pts: [[say(p.x), say(p.y), say(p.z)]],
        text, h: p.h > 0 ? p.h : 2.5, rot: say(p.rot), ha: say(p.ha), va: say(p.va),
      };
      if (p.et === 'ATTDEF') {                          // öznitelik tanımı (blok düzenleyici): etiket, istem, öntanımlı değer ve bayraklar korunur
        const src = p.ent && p.ent.type === 'ATTDEF' ? p.ent : null;
        e.type = 'ATTDEF'; e.tag = src ? src.tag : (inf.tag || text); e.prompt = src ? (src.prompt || '') : ''; e.text = src ? (src.text == null ? '' : src.text) : ''; e.flags = src ? (src.flags | 0) : 0;
        delete e.itype;
      }
      return e;
    }
    case 2:
      return { ...ort, type: 'POINT', pts: [[say(p.x), say(p.y), say(p.z)]] };
    case 5: {
      if (!p.vtx || !p.vtx.length || !p.idx || !p.idx.length) return null;
      return {
        ...ort, type: 'MESH',
        vtx: dizi(p.vtx), idx: dizi(p.idx), seg: dizi(p.seg),
        zmin: say(p.zmin), zmax: say(p.zmax),
      };
    }
    default: return null;                               // k=3 resim, k=4 ekleme noktası ve bilinmeyen
  }
}

// ---------------------------------------------------------------------------------------
// Sınır kutusu
// ---------------------------------------------------------------------------------------
/**
 * Varlık kümesinin KABA sınır kutusu [x0,y0,x1,y1]. Kaba: yay ve elips, süpürme açısına
 * bakılmadan tam çember kutusuyla alınır — sonuç gerçek kutuyu her zaman KAPSAR, asla
 * içinde kalmaz. Blok önizlemesi ve taban noktası için bu yeter; kesin kutu, varlık ilkele
 * çevrildiğinde geom.opsBBox ile zaten kurulur.
 * Boş ya da bozuk kümede [0,0,0,0] döner (çağıran w/h okumasında 0 görsün, çökmesin).
 */
export function entsBBox(ents) {
  if (!Array.isArray(ents) || !ents.length) return BOS_BB.slice();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const kat = (x, y) => {
    if (!isFinite(x) || !isFinite(y)) return;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  const kutu = (x, y, r) => { kat(x - r, y - r); kat(x + r, y + r); };
  for (const e of ents) {
    if (!e || typeof e !== 'object') continue;
    const r = say(e.r);
    // yarıçapı olan türlerde nokta yerine çember kutusu alınır; bulut yayları da dışa kabarır
    const pay = (r > 0 && (e.type === 'CIRCLE' || e.type === 'ARC' || e.type === 'CLOUD')) ? r : 0;
    if (Array.isArray(e.pts)) {
      for (const p of e.pts) {
        if (!p) continue;
        if (pay) kutu(say(p[0]), say(p[1]), pay);
        else kat(say(p[0]), say(p[1]));
      }
    }
    if (Array.isArray(e.ops)) {
      for (const o of e.ops) {
        if (!o) continue;
        if (o[0] === 2 || o[0] === -2) kutu(say(o[1]), say(o[2]), Math.abs(say(o[3])));
        else if (o[0] === 3) kutu(say(o[1]), say(o[2]), Math.max(Math.abs(say(o[3])), Math.abs(say(o[4]))));
        else kat(say(o[1]), say(o[2]));
      }
    }
    if (Array.isArray(e.segs)) for (const s of e.segs) { if (Array.isArray(s)) for (const p of s) { if (p) kat(say(p[0]), say(p[1])); } }
    if (Array.isArray(e.arcs)) for (const o of e.arcs) { if (o) kutu(say(o[1]), say(o[2]), Math.abs(say(o[3]))); }
    if (e.vtx && e.vtx.length) { const V = e.vtx; for (let i = 0; i + 2 < V.length; i += 3) kat(V[i], V[i + 1]); }
    if (e.type === 'TEXT' && Array.isArray(e.pts) && e.pts[0]) {
      // yazı kutusu ölçülmez, kestirilir. Pay, edit.js entToPrim'in yazıya verdiği yarıçapın
      // AYNISIDIR (en uzun satır x 0,75h ile satır yığınının yüksekliğinin hipotenüsü); daha
      // küçük bir pay dönme ve hiza hâllerinde kutuyu gerçeğin içinde bırakırdı.
      const h = e.h > 0 ? e.h : 2.5;
      const satir = String(e.text == null ? '' : e.text).split('\n');
      let en = 0;
      for (const s of satir) if (s.length > en) en = s.length;
      const pay = Math.hypot(en * h * 0.75, h * (1 + 1.667 * (satir.length - 1)));
      const p = e.pts[0];
      kat(say(p[0]) - pay, say(p[1]) - pay); kat(say(p[0]) + pay, say(p[1]) + pay);
    }
  }
  return isFinite(x0) ? [x0, y0, x1, y1] : BOS_BB.slice();
}

// ---------------------------------------------------------------------------------------
// Dönüşümler
// ---------------------------------------------------------------------------------------
/*
 * Üç dönüşüm de tek bir çekirdekten geçer. Çekirdek, geom.js'in afin dizilimini kullanır
 * (x' = a x + c y + e, y' = b x + d y + f) ve yanına üç sayı daha alır:
 *   zs, dz  z ekseni ölçeği ve ötelemesi
 *   ss      uzunluk çarpanı (yarıçap, yazı yüksekliği, kalem kalınlığı)
 *   da      açı artımı (radyan)
 * Kapanış (closure) yerine düz sayı alanları kullanılır: ağ (MESH) döngüleri milyonlarca
 * köşe gezebilir, orada nokta başına dizi/çağrı tahsisi yapılmaz.
 */
const donusum = (a, b, c, d, e, f, zs, dz, ss, da) => ({ a, b, c, d, e, f, zs, dz, ss, da });
const T_X = (t, x, y) => t.a * x + t.c * y + t.e;
const T_Y = (t, x, y) => t.b * x + t.d * y + t.f;
const T_Z = (t, z) => z * t.zs + t.dz;
const T_P = (t, p) => {
  const x = say(p[0]), y = say(p[1]);
  return [T_X(t, x, y), T_Y(t, x, y), T_Z(t, say(p[2]))];
};

/** Bir yol işleminin dönüşmüş kopyası (yay ve elips parametre olarak taşınır, düzleştirilmez) */
function opDonustur(t, o) {
  const k = o[0];
  if (k === 0 || k === 1) {
    const x = say(o[1]), y = say(o[2]);
    return [k, T_X(t, x, y), T_Y(t, x, y), T_Z(t, say(o[3]))];
  }
  if (k === 2 || k === -2) {
    const x = say(o[1]), y = say(o[2]);
    return [k, T_X(t, x, y), T_Y(t, x, y), Math.abs(say(o[3])) * t.ss, say(o[4]) + t.da, say(o[5]) + t.da, T_Z(t, say(o[6]))];
  }
  if (k === 3) {
    const x = say(o[1]), y = say(o[2]);
    return [3, T_X(t, x, y), T_Y(t, x, y), say(o[3]) * t.ss, say(o[4]) * t.ss, say(o[5]) + t.da, say(o[6]), say(o[7])];
  }
  return o.slice();
}

/** Düz üçlü dizisini (vtx / seg) yerinde değil, yeni diziye dönüştürür */
function uclDonustur(t, src) {
  const n = src.length - (src.length % 3);
  const out = new Array(n);
  for (let i = 0; i < n; i += 3) {
    const x = src[i], y = src[i + 1];
    out[i] = T_X(t, x, y);
    out[i + 1] = T_Y(t, x, y);
    out[i + 2] = T_Z(t, src[i + 2]);
  }
  return out;
}

/** Tek varlığın dönüşmüş KOPYASI; özgünü değişmez */
function entDonustur(t, e) {
  if (!e || typeof e !== 'object') return null;
  const c = { ...e };
  if (Array.isArray(e.pts)) c.pts = e.pts.map(p => (p ? T_P(t, p) : [0, 0, 0]));
  if (Array.isArray(e.ops)) c.ops = e.ops.map(o => (o ? opDonustur(t, o) : [0, 0, 0, 0]));
  if (Array.isArray(e.segs)) c.segs = e.segs.map(s => (Array.isArray(s) ? s.map(p => (p ? T_P(t, p) : [0, 0, 0])) : []));
  if (Array.isArray(e.arcs)) c.arcs = e.arcs.map(o => (o ? opDonustur(t, o) : o));
  if (e.vtx && e.vtx.length) c.vtx = uclDonustur(t, e.vtx);
  if (e.seg && e.seg.length) c.seg = uclDonustur(t, e.seg);
  if (e.idx) c.idx = dizi(e.idx);                        // üçgen dizini dönüşümden etkilenmez
  if (typeof e.r === 'number') c.r = Math.abs(e.r) * t.ss;
  if (typeof e.width === 'number') c.width = Math.abs(e.width) * t.ss;
  if (e.type === 'TEXT') {
    if (typeof e.h === 'number') c.h = Math.abs(e.h) * t.ss;
    c.rot = say(e.rot) + t.da;
  } else if (typeof e.h === 'number') {
    c.h = e.h * t.zs;                                    // EXTRUDE yüksekliği z ekseninde ölçeklenir (işaret korunur)
  }
  if (e.type === 'ARC') { c.a0 = say(e.a0) + t.da; c.a1 = say(e.a1) + t.da; }
  if (typeof e.zmin === 'number' || typeof e.zmax === 'number') {
    const z1 = T_Z(t, say(e.zmin)), z2 = T_Z(t, say(e.zmax));
    c.zmin = Math.min(z1, z2); c.zmax = Math.max(z1, z2);
  }
  if (typeof e.measure === 'number') {
    // açı ölçüsü (yay taşıyan DIMENSION) derecedir, ölçekten etkilenmez; doğrusal ölçü uzunluktur
    c.measure = (Array.isArray(e.arcs) && e.arcs.length) ? e.measure : Math.abs(e.measure) * t.ss;
  }
  if (e.def && typeof e.def === 'object') c.def = transformDef(e.def, p => T_P(t, p), t.ss, [t.a, t.b, t.c, t.d]);   // ölçü tanımı da dönüşür
  return c;
}

const kumeDonustur = (ents, t) => (Array.isArray(ents) ? ents.map(e => entDonustur(t, e)).filter(Boolean) : []);

/** Öteleme; yeni dizi döner, özgün varlıklar değişmez */
export function moveEnts(ents, dx, dy, dz) {
  return kumeDonustur(ents, donusum(1, 0, 0, 1, say(dx), say(dy), 1, say(dz), 1, 0));
}

/**
 * Ölçek: (cx,cy) sabit noktası çevresinde s katı. z ekseni 0 çevresinde aynı katsayıyla
 * ölçeklenir — blok her üç eksende BENZER kalsın diye; z dokunulmadan bırakılsaydı ölçeklenen
 * bir gövdenin yüksekliği tabanıyla oransız kalırdı. Yarıçap, yazı yüksekliği ve kalem
 * kalınlığı |s| ile büyür.
 *
 * NEGATİF s ayna DEĞİL, merkeze göre nokta yansımasıdır: iki eksen birden ters çevrildiği için
 * belirleyici s² > 0 kalır, yön (saat yönü / tersi) değişmez. Yansıma tam olarak |s| ölçeği +
 * 180° dönmedir; bu yüzden açı artımı da π olmalıdır. Aksi hâlde yay ve elips merkezleri
 * yansırken açıları yerinde kalır, yol başlangıç noktasından kopardı.
 */
export function scaleEnts(ents, s, cx, cy) {
  const k = say(s);
  if (!k) return [];                                     // sıfır ölçek: geometri yok olur, boş dizi
  const x = say(cx), y = say(cy);
  const da = k < 0 ? Math.PI : 0;
  return kumeDonustur(ents, donusum(k, 0, 0, k, x - k * x, y - k * y, k, 0, Math.abs(k), da));
}

/** Döndürme: (cx,cy) çevresinde a radyan (saat yönü tersi). z değişmez. */
export function rotateEnts(ents, a, cx, cy) {
  const r = say(a), cs = Math.cos(r), sn = Math.sin(r), x = say(cx), y = say(cy);
  return kumeDonustur(ents, donusum(cs, sn, -sn, cs, x - cs * x + sn * y, y - sn * x - cs * y, 1, 0, 1, r));
}

// ---------------------------------------------------------------------------------------
// Depolama
// ---------------------------------------------------------------------------------------
/** Ad temizliği: baştaki/sondaki boşluk atılır, en çok 60 karakter; boş ad kabul edilmez. */
function temizAd(name) {
  if (typeof name !== 'string') return '';
  const s = name.trim().slice(0, MAX_NAME).trim();
  return s;
}

/** JSON'a girecek varlık: yazılı diziler (Float32Array…) düz diziye çevrilir. */
function temizEnt(e) {
  if (!e || typeof e !== 'object' || typeof e.type !== 'string') return null;
  const c = { ...e };
  if (e.vtx) c.vtx = dizi(e.vtx);
  if (e.idx) c.idx = dizi(e.idx);
  if (e.seg) c.seg = dizi(e.seg);
  return c;
}
const temizEnts = (ents) => (Array.isArray(ents) ? ents.map(temizEnt).filter(Boolean) : []);

/**
 * Kaba boyut kestirimi (karakter). Amaç, milyon köşeli bir ağı JSON'a çevirmeden eleyebilmek:
 * gerçek boyut buna yakın çıkar, kestirim sınırın kat kat üstündeyse stringify hiç denenmez.
 * Ham (henüz düz diziye çevrilmemiş) küme üzerinde de çalışır — yazılı dizilerin de `length`i
 * vardır; eleme, kopya çıkarılmadan ÖNCE yapılabilsin diye böyle yazıldı.
 * Köşe başına 20 karakter sayılır: Float32 değeri çift duyarlığa yükselince JSON'a
 * 0.10000000149011612 gibi uzun yazılır, 14 karakter kestirimi gerçeğin altında kalırdı.
 */
function kabaBoyut(ents) {
  let n = 0;
  for (const e of ents) {
    if (!e || typeof e !== 'object') continue;
    n += 96;
    if (e.pts) n += e.pts.length * 40;
    if (e.ops) n += e.ops.length * 64;
    if (e.segs) for (const s of e.segs) n += (s ? s.length : 0) * 40;
    if (e.arcs) n += e.arcs.length * 64;
    if (e.vtx) n += e.vtx.length * 20;
    if (e.seg) n += e.seg.length * 20;
    if (e.idx) n += e.idx.length * 8;
    if (e.text) n += String(e.text).length * 2;
  }
  return n;
}

/** Taban noktası: verilmemişse kutunun sol alt köşesi (yapıştırmada tutamak orası olur) */
function tabanNoktasi(base, bb) {
  if (Array.isArray(base) && base.length >= 2) return nokta(base);
  return [bb[0], bb[1], 0];
}

/** Kütüphane kaydı: { v:1, b:{ ad → kayıt } }. Eski/biçimsiz içerik düz harita sayılır. */
function libOku(store) {
  if (!store || typeof store.json !== 'function') return {};
  const raw = store.json(LIB_KEY, null);
  if (!raw || typeof raw !== 'object') return {};
  const b = raw.b && typeof raw.b === 'object' ? raw.b : raw;
  const out = {};
  for (const k of Object.keys(b)) {
    const r = b[k];
    if (r && typeof r === 'object' && Array.isArray(r.ents)) out[k] = r;
  }
  return out;
}

function libYaz(store, lib) {
  try { store.set(LIB_KEY, JSON.stringify({ v: 1, b: lib })); return true; } catch (_) { return false; }
}

/**
 * Kütüphanedeki blokların listesi: [{ name, n, w, h, at }]
 *   n   varlık sayısı        w,h  kaba kutu genişlik/yükseklik
 *   at  son yazma zamanı (ms)
 * Ada göre sıralıdır; sıralamayı ekran değil bu işlev sabitler ki liste her açılışta aynı gelsin.
 */
export function listBlocks(store) {
  const lib = libOku(store);
  const out = [];
  for (const name of Object.keys(lib)) {
    const r = lib[name];
    const bb = Array.isArray(r.bb) && r.bb.length === 4 ? r.bb : entsBBox(r.ents);
    out.push({
      name,
      n: r.ents.length,
      w: Math.abs(say(bb[2]) - say(bb[0])),
      h: Math.abs(say(bb[3]) - say(bb[1])),
      at: say(r.at),
    });
  }
  out.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return out;
}

/** Bloğu kaydeder (aynı ad varsa üzerine yazar). Sınırı aşan ya da boş küme yazılmaz. */
export function saveBlock(store, name, ents, base) {
  const ad = temizAd(name);
  if (!ad || !store || typeof store.set !== 'function') return false;
  // ucuz eleme KOPYA ÇIKARMADAN önce: milyon köşeli bir ağda temizEnts'in düz dizi kopyası
  // yüzlerce MB tutardı, oysa küme zaten sınırın kat kat üstünde
  if (!Array.isArray(ents) || kabaBoyut(ents) > MAX_JSON * 4) return false;
  const list = temizEnts(ents);
  if (!list.length) return false;
  const bb = entsBBox(list);
  const rec = { n: list.length, bb, base: tabanNoktasi(base, bb), at: Date.now(), ents: list };
  let s;
  try { s = JSON.stringify(rec); } catch (_) { return false; }
  if (!s || s.length > MAX_JSON) return false;
  const lib = libOku(store);
  lib[ad] = rec;
  return libYaz(store, lib);
}

/** Bloğu okur: { name, ents, base } ya da null. Dönen varlıklar tazedir, çağıran değiştirebilir. */
export function loadBlock(store, name) {
  const ad = temizAd(name);
  if (!ad) return null;
  const r = libOku(store)[ad];
  if (!r || !Array.isArray(r.ents) || !r.ents.length) return null;
  const bb = Array.isArray(r.bb) && r.bb.length === 4 ? r.bb : entsBBox(r.ents);
  return { name: ad, ents: r.ents, base: tabanNoktasi(r.base, bb) };
}

/** Bloğu siler. Yoksa false döner (silinecek bir şey olmaması hata değildir, ama iş de yapılmamıştır). */
export function deleteBlock(store, name) {
  const ad = temizAd(name);
  if (!ad || !store || typeof store.set !== 'function') return false;
  const lib = libOku(store);
  if (!(ad in lib)) return false;
  delete lib[ad];
  return libYaz(store, lib);
}

// ---------------------------------------------------------------------------------------
// Pano (dosyalar arası)
// ---------------------------------------------------------------------------------------
/** Panoya yazar (tek göz; önceki içerik silinir). Sınırı aşarsa yazmaz, false döner. */
export function clipWrite(store, ents, base) {
  if (!store || typeof store.set !== 'function') return false;
  if (!Array.isArray(ents) || kabaBoyut(ents) > MAX_JSON * 4) return false;   // kopya çıkarmadan ucuz eleme
  const list = temizEnts(ents);
  if (!list.length) return false;
  const bb = entsBBox(list);
  const rec = { v: 1, at: Date.now(), base: tabanNoktasi(base, bb), bb, ents: list };
  let s;
  try { s = JSON.stringify(rec); } catch (_) { return false; }
  if (!s || s.length > MAX_JSON) return false;
  try { store.set(CLIP_KEY, s); } catch (_) { return false; }
  return true;
}

/** Panoyu okur: { ents, base, at } ya da null (boşsa, bozuksa) */
export function clipRead(store) {
  if (!store || typeof store.json !== 'function') return null;
  const r = store.json(CLIP_KEY, null);
  if (!r || typeof r !== 'object' || !Array.isArray(r.ents) || !r.ents.length) return null;
  const bb = Array.isArray(r.bb) && r.bb.length === 4 ? r.bb : entsBBox(r.ents);
  return { ents: r.ents, base: tabanNoktasi(r.base, bb), at: say(r.at) };
}

/** Panoyu boşaltır. Anahtar silinmez, boş metin yazılır: depo silme yeteneği sunmuyor. */
export function clipClear(store) {
  if (!store || typeof store.set !== 'function') return;
  try { store.set(CLIP_KEY, ''); } catch (_) { /* yoksay */ }
}
