/*
 * Açıklama ve ölçülendirme üreticileri.
 *
 * Buradaki her işlev SAF'tır: girdi noktalar ve seçenekler, çıktı `ent` dizisi (edit.js'in
 * varlık tanımı). Hiçbiri sahneye dokunmaz, hiçbiri kimlik üretmez — kimliği (id) ve katmanı
 * çağıran verir, çünkü hepsi tek bir `add` komutuyla eklenir ve tek geri almayla kalkar.
 *
 * Ortak seçenekler (o):
 *   h      yazı yüksekliği (çizim birimi)
 *   arrow  ok boyu (verilmezse h)
 *   layer  katman adı        color  ACI (256 = katmandan)
 *   gid    grup kimliği — aynı ölçülendirmenin bütün parçaları bunu taşır, birlikte seçilir
 *   label  ölçü metni (biçimlemeyi çağıran yapar: birim, ondalık, ölçek)
 *
 * Ölçülendirme gerçek DXF DIMENSION varlığı DEĞİL, çizilmiş geometridir (uzatma çizgileri,
 * ölçü çizgisi, ok başları, yazı). Bu bilinçli bir karardır: iç modelimizde ölçü stili yok,
 * geometri her okuyucuda birebir aynı görünür ve DXF'e sorunsuz yazılır. Parçalar `itype`
 * ile DIMENSION damgası taşıdığı için "Ölçüleri gizle" süzgeci onları da gizler.
 */
import { TAU, patternDefs, hatchLines, autoHatchScale } from './geom.js';

const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => { const L = len(v) || 1; return [v[0] / L, v[1] / L]; };
const add = (a, v, s = 1) => [a[0] + v[0] * s, a[1] + v[1] * s, a[2] || 0];
const perp = (v) => [-v[1], v[0]];

/** Ortak alanları basar; id'yi çağıran ekler */
const stamp = (ent, o) => ({ ...ent, layer: o.layer, color: o.color == null ? 256 : o.color, itype: o.itype || 'DIMENSION', gid: o.gid });

/** Ok başı: uç noktası tip, gövde yönü dir (uçtan geriye), boy a → dolu üçgen */
export function arrowEnt(tip, dir, a, o) {
  const d = unit(dir), n = perp(d);
  const b = add(tip, d, a), w = a * 0.18;
  return stamp({ type: 'SOLID', pts: [[tip[0], tip[1], tip[2] || 0], [b[0] + n[0] * w, b[1] + n[1] * w, tip[2] || 0], [b[0] - n[0] * w, b[1] - n[1] * w, tip[2] || 0]] }, o);
}

/**
 * Doğrusal ölçülendirme.
 *   kind 'aligned' ölçü çizgisi p1→p2 ile paralel · 'horizontal' yatay · 'vertical' düşey ·
 *        'rotated' o.rot açısında (DXF tip 0, kod 50): ölçülen değer noktaların bu doğrultudaki izdüşümüdür
 *   q    ölçü çizgisinin geçtiği nokta (kullanıcının seçtiği üçüncü nokta)
 *   o.gap uzatma çizgisinin ölçü noktasından boşluğu (DIMEXO) · o.ext ölçü çizgisini aşan taşma (DIMEXE);
 *        verilmezse h × 0,25 ve h × 0,5
 * Dönüş: [DIMENSION (çizgiler), SOLID ok, SOLID ok, TEXT] — hepsi aynı gid.
 * measure alanı ölçülen uzunluğu (çizim birimi) taşır; çağıran metni buna göre biçimler.
 */
export function dimLinear(kind, p1, p2, q, o) {
  const h = o.h > 0 ? o.h : 2.5, a = o.arrow > 0 ? o.arrow : h;
  let dir;
  if (kind === 'horizontal') dir = [1, 0];
  else if (kind === 'vertical') dir = [0, 1];
  else if (kind === 'rotated') { const r = o.rot || 0; dir = [Math.cos(r), Math.sin(r)]; }
  else { const v = sub(p2, p1); if (len(v) < 1e-12) return null; dir = unit(v); }
  const n = perp(dir);
  const off = (q[0] - p1[0]) * n[0] + (q[1] - p1[1]) * n[1];      // ölçü çizgisinin öteleme miktarı
  const t1 = (p1[0] - p1[0]) * dir[0] + (p1[1] - p1[1]) * dir[1];
  const t2 = (p2[0] - p1[0]) * dir[0] + (p2[1] - p1[1]) * dir[1];
  const measure = Math.abs(t2 - t1);
  if (!(measure > 1e-12)) return null;
  const base = [p1[0] + n[0] * off, p1[1] + n[1] * off];
  const d1 = [base[0] + dir[0] * t1, base[1] + dir[1] * t1, p1[2] || 0];
  const d2 = [base[0] + dir[0] * t2, base[1] + dir[1] * t2, p1[2] || 0];
  const gap = o.gap >= 0 ? o.gap : h * 0.25, ext = o.ext >= 0 ? o.ext : h * 0.5;   // ölçü noktasıyla uzatma çizgisi arası boşluk ve taşma (DIMEXO / DIMEXE)
  const e1a = add(p1, n, Math.sign(off || 1) * gap), e1b = add(d1, n, Math.sign(off || 1) * ext);
  const e2a = add(p2, n, Math.sign(off || 1) * gap), e2b = add(d2, n, Math.sign(off || 1) * ext);
  const segs = [[e1a, e1b], [e2a, e2b], [d1, d2]];
  const inward = t2 > t1 ? dir : [-dir[0], -dir[1]];
  const ents = [
    stamp({ type: 'DIMENSION', segs, measure, ...(o.def ? { def: o.def } : {}) }, o),   // def: tanım (kind, noktalar, yazı seçenekleri) — düzenlemede yeniden kurulur
    arrowEnt(d1, inward, a, o),
    arrowEnt(d2, [-inward[0], -inward[1]], a, o),
  ];
  let rot = Math.atan2(dir[1], dir[0]);
  if (rot > Math.PI / 2 + 1e-9 || rot < -Math.PI / 2 - 1e-9) rot += Math.PI;   // yazı hiçbir zaman baş aşağı durmaz
  const up = perp([Math.cos(rot), Math.sin(rot)]);
  /*
   * YAZI KONUMU (v8.9.8, tutamakla taşınan yazı). o.tp yazının ORTA noktasıdır (DXF kod 11). AutoCAD'in DIMTMOVE=0
   * davranışı: yazı ölçü çizgisinin üstünde kalır, dik yöndeki taşıma ölçü çizgisini de taşır (o iş tutamak
   * matematiğinde q ile yapılır); burada yalnız ÇİZGİ BOYUNCA konum kullanılır. Yazı uzatma çizgilerinin dışına
   * çıkarsa ölçü çizgisi yazının altına kadar uzar (o.tw: yazı genişliği tahmini).
   */
  let tt = (t1 + t2) / 2, out = false;
  if (Array.isArray(o.tp)) {
    tt = (o.tp[0] - base[0]) * dir[0] + (o.tp[1] - base[1]) * dir[1];
    const lo = Math.min(t1, t2), hi = Math.max(t1, t2), hw = (o.tw > 0 ? o.tw : 0) / 2;
    if (tt - hw < lo - 1e-9 || tt + hw > hi + 1e-9) {
      out = true;
      const ucA = tt + hw > hi ? hi : lo, ucB = tt + hw > hi ? tt + hw : tt - hw;   // en yakın ölçü çizgisi ucundan yazının öteki kenarına
      segs.push([[base[0] + dir[0] * ucA, base[1] + dir[1] * ucA, d1[2]], [base[0] + dir[0] * ucB, base[1] + dir[1] * ucB, d1[2]]]);
    }
  }
  const onLine = [base[0] + dir[0] * tt, base[1] + dir[1] * tt, d1[2]];
  const tp = add(onLine, up, h * 0.35);
  ents.push(stamp({ type: 'TEXT', pts: [[tp[0], tp[1], d1[2]]], text: o.label == null ? '' : String(o.label), h, rot, ha: 1, va: 0 }, o));
  // yapı geometrisi (tutamaklar ve yazı konumu için): ölçü çizgisi uçları, doğrultu, dik yön, öteleme, yazı ortası
  const tmid = add(tp, up, h * 0.5);
  return { ents, measure, geo: { d1, d2, base, dir, n, off, up, t1, t2, tmid: [tmid[0], tmid[1], d1[2]], out } };
}

/*
 * Ölçü TANIMININ (tools.dimDefaults biçimi) dönüşmüş kopyası. Taşıma, döndürme, ölçekleme, ayna ve
 * blok / pano yerleştirmesi tanımı da taşır ki sonradan düzenlenen ölçü geometrinin yeni yerine otursun.
 *   pt(p)  tek noktanın dönüşümü ([x,y,z] → [x,y,z])
 *   s      uzunluk çarpanı (yarıçap, yazı, ok, uzatma boşluğu ve taşması)
 *   lin    doğrusal kısım [a, b, c, d] (x' = a x + c y, y' = b x + d y): yatay / düşey / dönük ölçünün
 *          doğrultusu bununla döndürülür. Doğrultu eksenlerden birine denk gelirse yatay ya da düşey,
 *          gelmezse 'rotated' olur — 'aligned'e düşürülmez, çünkü o ölçülen DEĞERİ değiştirirdi
 *          (izdüşüm yerine noktalar arası uzaklık).
 */
export function transformDef(d, pt, s, lin) {
  if (!d || typeof d !== 'object') return d;
  const nd = { ...d, pts: (d.pts || []).map(pt) };
  if (Array.isArray(d.tp)) nd.tp = pt(d.tp);   // tutamakla taşınmış yazı konumu da dönüşür
  for (const k of ['r', 'h', 'arrow', 'exo', 'exe']) if (typeof d[k] === 'number' && d[k] > 0) nd[k] = d[k] * s;
  if (d.kind === 'linear' && (d.sub === 'horizontal' || d.sub === 'vertical' || d.sub === 'rotated') && Array.isArray(lin)) {
    const a0 = d.sub === 'horizontal' ? 0 : d.sub === 'vertical' ? Math.PI / 2 : (d.rot || 0);
    const vx = Math.cos(a0), vy = Math.sin(a0);
    const wx = lin[0] * vx + lin[2] * vy, wy = lin[1] * vx + lin[3] * vy;
    let ang = Math.atan2(wy, wx); ang = ((ang % Math.PI) + Math.PI) % Math.PI;   // doğrultunun işareti önemsiz: [0, π)
    if (Math.abs(Math.sin(ang)) < 1e-9) { nd.sub = 'horizontal'; nd.rot = 0; }
    else if (Math.abs(Math.cos(ang)) < 1e-9) { nd.sub = 'vertical'; nd.rot = Math.PI / 2; }
    else { nd.sub = 'rotated'; nd.rot = ang; }
  }
  return nd;
}

/** Yarıçap ya da çap ölçülendirmesi: merkezden çember üzerindeki noktaya lider + yazı */
export function dimRadial(kind, center, r, at, o) {
  const h = o.h > 0 ? o.h : 2.5, a = o.arrow > 0 ? o.arrow : h;
  if (!(r > 0)) return null;
  const dir = unit(sub(at, center));
  const on = [center[0] + dir[0] * r, center[1] + dir[1] * r, center[2] || 0];
  const measure = kind === 'diameter' ? 2 * r : r;
  const from = kind === 'diameter'
    ? [center[0] - dir[0] * r, center[1] - dir[1] * r, center[2] || 0]
    : [center[0], center[1], center[2] || 0];
  const tail = [on[0] + dir[0] * h * 2, on[1] + dir[1] * h * 2, on[2]];
  const ents = [
    stamp({ type: 'DIMENSION', segs: [[from, on], [on, tail]], measure, ...(o.def ? { def: o.def } : {}) }, o),
    arrowEnt(on, [-dir[0], -dir[1]], a, o),
  ];
  if (kind === 'diameter') ents.push(arrowEnt(from, dir, a, o));
  const right = dir[0] >= 0;
  const tp = [tail[0] + (right ? h * 0.4 : -h * 0.4), tail[1] + h * 0.35, tail[2]];
  ents.push(stamp({ type: 'TEXT', pts: [tp], text: o.label == null ? '' : String(o.label), h, rot: 0, ha: right ? 0 : 2, va: 0 }, o));
  const tw = (o.label == null ? 0 : String(o.label).length) * h * 0.6;
  const tmid = [tp[0] + (right ? tw / 2 : -tw / 2), tp[1] + h * 0.5, tp[2]];
  return { ents, measure, geo: { c: [center[0], center[1], center[2] || 0], on, from, tail, tmid } };
}

/** Açı ölçülendirmesi: tepe v, kollar a ve b; yay yarıçapı r (verilmezse kısa kolun %70'i) */
export function dimAngular(v, a, b, o) {
  const h = o.h > 0 ? o.h : 2.5, ar = o.arrow > 0 ? o.arrow : h;
  const u1 = sub(a, v), u2 = sub(b, v);
  const L1 = len(u1), L2 = len(u2);
  if (!(L1 > 1e-12) || !(L2 > 1e-12)) return null;
  const d1 = unit(u1), d2 = unit(u2);
  const r = o.r > 0 ? o.r : Math.min(L1, L2) * 0.7;
  let a0 = Math.atan2(d1[1], d1[0]), a1 = Math.atan2(d2[1], d2[0]);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += TAU;
  while (sweep > Math.PI) sweep -= TAU;
  const measure = Math.abs(sweep) / D2R;
  const z = v[2] || 0;
  const p0 = [v[0] + d1[0] * r, v[1] + d1[1] * r, z];
  const p1 = [v[0] + d2[0] * r, v[1] + d2[1] * r, z];
  // yay, ops biçiminde tek parça olarak DIMENSION varlığına verilir
  const ccw = sweep > 0;
  // [2, …, s, e] s'den e'ye saat yönünün TERSİNE, [-2, …, s, e] saat yönünde gider. Saat yönündeki seçimde eskiden hem
  // işaret hem uçlar değiştiriliyordu: iki ters çevirme uzun yayı (270°) çiziyor, yazı "90°" diyordu
  const arcOp = [ccw ? 2 : -2, v[0], v[1], r, a0, a1, z];
  const ext = o.ext >= 0 ? o.ext : h * 0.5;                        // kolların yayı aşan taşması (DIMEXE)
  const arm = (d) => [[v[0], v[1], z], [v[0] + d[0] * (r + ext), v[1] + d[1] * (r + ext), z]];
  const segs = [arm(d1), arm(d2)];
  const tang1 = perp(d1), tang2 = perp(d2);
  const ents = [
    stamp({ type: 'DIMENSION', segs, arcs: [arcOp], measure, ...(o.def ? { def: o.def } : {}) }, o),
    arrowEnt(p0, ccw ? [-tang1[0], -tang1[1]] : tang1, ar, o),
    arrowEnt(p1, ccw ? tang2 : [-tang2[0], -tang2[1]], ar, o),
  ];
  const am = a0 + sweep / 2;
  const tp = [v[0] + Math.cos(am) * (r + h * 0.8), v[1] + Math.sin(am) * (r + h * 0.8), z];
  ents.push(stamp({ type: 'TEXT', pts: [tp], text: o.label == null ? '' : String(o.label), h, rot: 0, ha: 1, va: 0 }, o));
  const arcMid = [v[0] + Math.cos(am) * r, v[1] + Math.sin(am) * r, z];
  return { ents, measure, r, geo: { v: [v[0], v[1], z], p0, p1, arcMid, tmid: [tp[0], tp[1] + h * 0.5, z], r } };   // r: kullanılan yay yarıçapı (verilmemişse kısa kolun %70'i) — tanım bunu saklar
}

/** Lider (kılavuz çizgili açıklama): pts yol, son noktadan sonra yazı; ilk noktada ok */
export function leaderEnts(pts, text, o) {
  const h = o.h > 0 ? o.h : 2.5, a = o.arrow > 0 ? o.arrow : h;
  if (!pts || pts.length < 2) return null;
  const z = pts[0][2] || 0;
  const tip = pts[0], nxt = pts[1];
  const dir = unit(sub(nxt, tip));
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const right = end[0] >= prev[0];
  const shelf = [end[0] + (right ? h * 1.2 : -h * 1.2), end[1], z];
  const segs = [pts.map(p => [p[0], p[1], p[2] || 0]).concat([shelf])];
  const oo = { ...o, itype: o.itype || 'LEADER' };
  const ents = [stamp({ type: 'DIMENSION', segs }, oo), arrowEnt(tip, dir, a, oo)];
  const tp = [shelf[0] + (right ? h * 0.3 : -h * 0.3), shelf[1] + h * 0.35, z];
  ents.push(stamp({ type: 'TEXT', pts: [tp], text: String(text == null ? '' : text), h, rot: 0, ha: right ? 0 : 2, va: 0 }, oo));
  return { ents };
}

/** Revizyon bulutu: kapalı yol üzerinde dışa kabaran yaylar */
export function cloudEnt(pts, r, o) {
  if (!pts || pts.length < 2) return null;
  return [stamp({ type: 'CLOUD', pts: pts.map(p => [p[0], p[1], p[2] || 0]), r, closed: o.closed !== false }, { ...o, itype: o.itype || 'CLOUD' })];
}

/** Numaralandırma balonu: daire + ortalanmış yazı */
export function balloonEnts(center, text, o) {
  const h = o.h > 0 ? o.h : 2.5;
  const s = String(text == null ? '' : text);
  const r = o.r > 0 ? o.r : h * (0.9 + 0.32 * Math.max(0, s.length - 1));
  const z = center[2] || 0;
  const oo = { ...o, itype: o.itype || 'BALLOON' };
  return [
    stamp({ type: 'CIRCLE', pts: [[center[0], center[1], z]], r }, oo),
    stamp({ type: 'TEXT', pts: [[center[0], center[1] - h * 0.5, z]], text: s, h, rot: 0, ha: 1, va: 0 }, oo),
  ];
}

/**
 * Dizi (artımlı kopya) dönüşümleri.
 *   kind 'rect'  → nx × ny, dx / dy aralıklı dikdörtgen dizi
 *   kind 'polar' → merkez c çevresinde n kopya, toplam açı total (derece), rotate ise kopyalar döner
 * Dönüş: [{m:[a,b,c,d,e,f], dz}] — ilk kopya (0,0) atlanır, yalnız YENİ kopyalar döner.
 */
export function arrayItems(kind, prm) {
  const out = [];
  if (kind === 'path') {
    // Yol dizisi: çerçeveler { p, ang } (geom.pathFramesAt). 0. öge yolun başıdır — çağıran kaynağı oraya taşır, ötekiler kopyadır.
    // align: kopya, yolun o noktadaki yönüne İLK çerçeveye göre döner (AutoCAD: hizalama ilk ögenin yönüne göredir); taban noktası çevresinde.
    const frames = prm.frames || [], b = prm.base || [0, 0];
    frames.forEach((f, i) => {
      const a = prm.align === false || !frames.length ? 0 : f.ang - frames[0].ang, cs = Math.cos(a), sn = Math.sin(a);
      out.push({ m: [cs, sn, -sn, cs, f.p[0] - cs * b[0] + sn * b[1], f.p[1] - sn * b[0] - cs * b[1]], dz: (prm.dz || 0) * i });
    });
    return out;
  }
  if (kind === 'polar') {
    const n = Math.max(2, Math.round(prm.n || 2));
    const total = (prm.total == null ? 360 : prm.total) * D2R;
    const full = Math.abs(Math.abs(total) - TAU) < 1e-9;
    const step = total / (full ? n : Math.max(1, n - 1));
    const c = prm.center || [0, 0];
    for (let i = 1; i < n; i++) {
      const A = step * i, cs = Math.cos(A), sn = Math.sin(A);
      if (prm.rotate === false) {
        // nesne dönmez, yalnız taban noktası merkez çevresinde döner: fark kadar ötelenir
        const b = prm.base || c;
        const nx = c[0] + (b[0] - c[0]) * cs - (b[1] - c[1]) * sn;
        const ny = c[1] + (b[0] - c[0]) * sn + (b[1] - c[1]) * cs;
        out.push({ m: [1, 0, 0, 1, nx - b[0], ny - b[1]], dz: (prm.dz || 0) * i });
      } else {
        out.push({ m: [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]], dz: (prm.dz || 0) * i });
      }
    }
    return out;
  }
  const nx = Math.max(1, Math.round(prm.nx || 1)), ny = Math.max(1, Math.round(prm.ny || 1));
  const dx = prm.dx || 0, dy = prm.dy || 0, dz = prm.dz || 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (i === 0 && j === 0) continue;
    out.push({ m: [1, 0, 0, 1, dx * i, dy * j], dz: dz * (i + j) });
  }
  return out;
}

/*
 * TARAMA ÜRETİCİSİ. Saf: kimlik üretmez, sahneye dokunmaz, yalnız varlık listesi döndürür.
 * SOLID'de tek varlık (dolu çokgen) verir; desenli olduğunda İKİ varlık: sınır çerçevesi ve
 * desen çizgileri. Çizgiler geom.hatchLines ile üretilir — okunan taramayla AYNI çizici.
 * Desen bulunamazsa ya da bütçe aşılırsa SOLID'e düşer: kullanıcı boş sonuçla karşılaşmaz.
 */
export function hatchEnts(pts, o = {}) {
  if (!pts || pts.length < 3) return null;
  const ad = String(o.pattern || 'SOLID').toUpperCase();
  const z = (pts[0] && pts[0][2]) || 0;
  // gid: sınır ile desen çizgileri TEK nesne gibi seçilir ve birlikte silinir. edit.js ent.gid okur.
  // SOLID tek varlıktır, grup kimliği ALMAZ: tek ilkelli nesneye grup damgası vurmak esnetme gibi
  // düğüm düzeyinde çalışan komutları bütün-taşımaya düşürürdü.
  const gid = o.gid || o.group;
  // AutoCAD künyesi (ada kipi, desen türü, çift, tohum, geçiş) ve dosyanın kendi desen tanımı:
  // budanan / yeniden üretilen tarama da kaynağıyla aynı koşullarla açılsın (v7.93)
  const ek = {};
  if (o.hrec && typeof o.hrec === 'object') ek.hrec = o.hrec;
  if (Array.isArray(o.hdefs) && o.hdefs.length) ek.hdefs = o.hdefs;
  const ortak = { layer: o.layer, color: o.color };
  const alpha = o.alpha == null ? 1 : o.alpha;
  const cokgen = pts.map(p => [p[0], p[1], z]);
  /*
   * SINIR YAYI YAY OLARAK TAŞINIR (v7.93). Tarama varlığı yalnız köşe listesi (pts) tutuyordu;
   * daire ya da yay sınırlı bir tarama budandığında sınır kirişleniyordu. Çağıran ham işlem
   * dizisini (ops) verirse — ve içinde yay varsa — o da varlığa yazılır: edit.entToPrim ilkeli
   * ondan kurar, edit.writeDxf yayı AutoCAD'e bulge olarak geri verir. pts her zaman yazılır:
   * desen hesabı ve eski belgeler onu okur.
   */
  const hamOps = Array.isArray(o.ops) && o.ops.length >= 2 && o.ops.some(q => q && (q[0] === 2 || q[0] === -2 || q[0] === 3))
    ? o.ops.map(q => q.slice()) : null;
  if (hamOps) ek.ops = hamOps;
  const duz = (sc, an) => ({ ents: [{ ...ortak, ...ek, type: 'HATCH', pts: cokgen, pattern: 'SOLID', hscale: sc, hangle: an, alpha }], pattern: 'SOLID', segs: 0, scale: sc, angle: an });
  // Ölçek ve açı SOLID'de de saklanır: desenliye geri çevrildiğinde kullanıcının ayarı geri gelsin.
  if (ad === 'SOLID') return duz(o.scale > 0 ? o.scale : 1, o.angle || 0);

  const poly = [pts.map(p => [p[0], p[1]])];
  const an = o.angle || 0;
  /*
   * ÖLÇEK. acad.pat desenleri inç tabanlıdır; milimetre birimli bir projede öntanımlı ölçek 1
   * yüz binlerce çizgi ister, çizici bütçeyi aşar ve tarama SESSİZCE düz dolguya düşerdi —
   * kullanıcı ANSI31 seçip düz bir leke görürdü. Artık ölçek verilmemişse alan büyüklüğünden
   * türetilir; verilen ölçek bütçeye sığmıyorsa kademeli olarak açılır ve HANGİ ölçeğin
   * kullanıldığı döndürülür (çağıran bunu kullanıcıya söyler). Hiçbiri sığmazsa düz dolguya
   * düşülür ama bu artık SESSİZ değildir: dustu = true.
   */
  /*
   * DOSYANIN KENDİ DESENİ (v7.93). Tablomuzda olmayan bir AutoCAD deseni — AR-CONC, ANGLE,
   * BRICK… — budandığında ya da yeniden üretildiğinde eskiden SOLID'e düşüyordu: dosyadan gelen
   * tarama bir kez budanınca dokusunu kaybediyor, DXF'e de SOLID olarak çıkıyordu. Dosyanın
   * tanım satırları (o.hdefs) ölçek ve açı UYGULANMIŞ hâldedir; yeniden ölçeklenmez, olduğu gibi
   * kullanılır ve desen ADI korunur — AutoCAD taramayı kendi desen adıyla açar.
   */
  if (!patternDefs(ad, 1, 0).length && Array.isArray(o.hdefs) && o.hdefs.length) {
    const rf = hatchLines(poly, o.hdefs, { maxSeg: 20000, maxWork: 1e6 });
    if (rf) {
      const sc0 = o.scale > 0 ? o.scale : 1;
      const sinirF = { ...ortak, ...ek, type: 'HATCH', pts: cokgen, pattern: ad, hscale: sc0, hangle: an, alpha, hp: rf.minStep, ...(gid ? { gid } : {}) };
      const cizgiF = { ...ortak, type: 'PATH', ops: rf.ops.map(op => [op[0], op[1], op[2], z]), closed: false, fill: false, hp: rf.minStep, hpart: 1, ...(gid ? { gid } : {}) };
      return { ents: [sinirF, cizgiF], pattern: ad, segs: rf.segs, scale: sc0, angle: an, dosyaDeseni: true };
    }
  }
  const oto = autoHatchScale(ad, poly);
  const istenen = o.scale > 0 ? o.scale : oto;
  const denemeler = [istenen];
  for (const k of [oto, oto * 2, oto * 5, oto * 10, oto * 25, oto * 100]) if (k > istenen * 1.001 && !denemeler.some(x => Math.abs(x - k) < 1e-9)) denemeler.push(k);
  for (const sc of denemeler) {
    const defs = patternDefs(ad, sc, an);
    const r = defs.length ? hatchLines(poly, defs, { maxSeg: 20000, maxWork: 1e6 }) : null;
    if (!r) continue;
    /*
     * İKİ VARLIK. Sınır, desen aralığı ekranda 2 px'in altına inince çizgilerin yerine görünen
     * SAYDAM DOLGUDUR (render.js LOD; dosyadan okunan taramada da aynı düzen vardır) — bu olmadan
     * uzaklaşınca tarama ekrandan tamamen kaybolurdu. hp / hpFill çiftini render.js okur.
     */
    const sinir = { ...ortak, ...ek, type: 'HATCH', pts: cokgen, pattern: ad, hscale: sc, hangle: an, alpha, hp: r.minStep, ...(gid ? { gid } : {}) };
    const cizgi = { ...ortak, type: 'PATH', ops: r.ops.map(op => [op[0], op[1], op[2], z]), closed: false, fill: false, hp: r.minStep, hpart: 1, ...(gid ? { gid } : {}) };
    return { ents: [sinir, cizgi], pattern: ad, segs: r.segs, scale: sc, angle: an, oto: Math.abs(sc - istenen) > 1e-9 };
  }
  return { ...duz(istenen, an), dustu: true, istenenDesen: ad };
}


/*
 * YENİ ÖLÇÜNÜN VARSAYILAN BOYU (v8.9.8). Eskiden yazı yüksekliği çizimin TAM kutusunun 1/91'iydi: birkaç uzak nesne
 * kutuyu şişiriyor ve kullanıcının ekranındaki gibi 1120 mm'lik ölçüye 450–820 mm yazı çıkıyordu (example_2000'de
 * 42 m!). Buradaki sıra, AutoCAD'deki "geçerli ölçü stili"nin çizimde GERÇEKTEN görünen karşılığını arar;
 * ilk uyan kazanır:
 *   (A) çizimdeki model uzayı ölçülerinin EKRANDAKİ yazı yüksekliğinin ortancası (geçerli stildekiler önce, doğrusal
 *       ölçüler önce); ok / uzatma o ölçünün stilinden, yazıya oranla
 *   (B) geçerli ölçü stili (DIMTXT × DIMSCALE) — ama yalnız çizime uyuyorsa: dokunulmamış ISO-25 / Standard şablonu
 *       (2,5 / 0,18) mm planında okunmaz 2,5 mm yazı verir; şablon yalnız yazıların ortancasına ya da çizim genişliğine
 *       uyuyorsa kabul edilir
 *   (C) yazıların (TEXT / MTEXT) ortanca yüksekliği, yuvarlak sayıya
 *   (D) çizimin sağlam genişliği (nesne merkezlerinin %5–%95 aralığı × 1,1) / 350, yuvarlak sayıya
 * A ve B'de birim son eki yalnız DIMPOST'tan gelir (AutoCAD birim eklemez); C ve D'de çarpan 1 ise çizim birimi eklenir.
 */
/** Yuvarlak uzunluk: {1, 1,25, 1,5, 2, 2,5, 3, 4, 5, 6, 8} × 10^n içinden logaritmik olarak en yakını */
export function niceLen(v) {
  if (!(v > 0) || !isFinite(v)) return v;
  const e = Math.floor(Math.log10(v)), b = Math.pow(10, e);
  let best = v, bd = Infinity;
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) { const c = m * b, d = Math.abs(Math.log(c / v)); if (d < bd) { bd = d; best = c; } }
  return +best.toPrecision(6);
}
const med = (a) => { const v = a.filter(x => x > 0 && isFinite(x)).sort((p, q) => p - q); return v.length ? v[(v.length - 1) >> 1] : NaN; };
const q = (sorted, f) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * f)))];
/** Sağlam çizim genişliği: nesne merkezlerinin %5–%95 aralığının büyüğü × 1,1 (uzak tek tük nesneler kutuyu şişirmesin) */
export function robustWidth(xs, ys) {
  if (!xs || xs.length < 2) return 0;
  const a = xs.slice().sort((p, r) => p - r), b = ys.slice().sort((p, r) => p - r);
  return 1.1 * Math.max(q(a, 0.95) - q(a, 0.05), q(b, 0.95) - q(b, 0.05));
}
const r6 = (v) => (typeof v === 'number' && isFinite(v) ? +v.toPrecision(6) : v);
const postSplit = (post) => { const s = String(post || ''), i = s.indexOf('<>'); return i >= 0 ? [s.slice(0, i), s.slice(i + 2)] : ['', s]; };
const TEMPLATES = [[2.5, 2.5, 0.625, 1.25], [0.18, 0.18, 0.0625, 0.18]];
/**
 * inp: { cur (scene.dimstyle), dims: [{ style, type, h (ekrandaki yazı), sty, key }], texts: [h…], extW, units }
 * Dönüş: { src: 'A'|'B'|'C'|'D', h, arrow, exo, exe, prec, adec, prefix, suffix, factor, dsep, repKey }
 */
export function autoDimStyle(inp) {
  const cur = inp.cur || null, dims = (inp.dims || []).filter(d => d && d.h > 0), texts = inp.texts || [], extW = inp.extW > 0 ? inp.extW : 0;
  const tMed = med(texts);
  const dsep = cur && cur.known && cur.known.dsep && cur.dsep > 0 ? cur.dsep : undefined;
  // (A) çizimdeki ölçüler
  if (dims.length) {
    const nm = cur && cur.name ? String(cur.name).toUpperCase() : '';
    let pool = nm ? dims.filter(d => String(d.style || '').toUpperCase() === nm) : [];
    if (!pool.length) pool = dims;
    const lin = pool.filter(d => d.type === 0 || d.type === 1);
    if (lin.length) pool = lin;
    const hM = med(pool.map(d => d.h));
    let rep = pool[0];
    for (const d of pool) if (Math.abs(d.h - hM) < Math.abs(rep.h - hM)) rep = d;
    const st = rep.sty || {}, k = st.txt > 0 ? hM / st.txt : 1;   // ek açıklamalı ölçü: stil yüksekliği ile ekrandaki ayrı
    return { src: 'A', h: r6(hM), arrow: r6(st.asz > 0 ? st.asz * k : hM), exo: r6(st.exo >= 0 ? st.exo * k : hM / 4), exe: r6(st.exe >= 0 ? st.exe * k : hM / 2),
      prec: null, adec: null, prefix: '', suffix: '', factor: 1, dsep: st.dsep > 0 ? st.dsep : dsep, repKey: rep.key };
  }
  // (B) geçerli stil, çizime uyuyorsa
  if (cur && cur.src !== 'default' && cur.txt > 0) {
    const sc = cur.scale > 0 ? cur.scale : 1, hS = cur.txt * sc;
    const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    const sablon = sc === 1 && TEMPLATES.some(T => near(cur.txt, T[0]) && near(cur.asz, T[1]) && near(cur.exo, T[2]) && near(cur.exe, T[3]));
    const R = extW > 0 ? extW / hS : 0;
    const ok = sablon
      ? (texts.length >= 3 ? (hS >= tMed / 4 && hS <= tMed * 4) : (R >= 50 && R <= 1200))
      : ((texts.length < 3 || (hS >= tMed / 10 && hS <= tMed * 10)) && (!extW || (R >= 20 && R <= 20000)));
    if (ok) {
      const [prefix, suffix] = cur.known && cur.known.post ? postSplit(cur.post) : ['', ''];
      return { src: 'B', h: r6(hS), arrow: r6(cur.tsz > 0 ? hS : (cur.asz > 0 ? cur.asz * sc : hS)), exo: r6(cur.exo >= 0 ? cur.exo * sc : hS / 4), exe: r6(cur.exe >= 0 ? cur.exe * sc : hS / 2),
        prec: cur.known && cur.known.dec && cur.dec >= 0 ? Math.min(6, cur.dec | 0) : null,
        adec: cur.known && cur.known.adec ? Math.min(6, (cur.adec < 0 ? cur.dec : cur.adec) | 0) : null,
        prefix, suffix, factor: cur.known && cur.known.lfac && cur.lfac > 0 ? cur.lfac : 1, dsep, repKey: null };
    }
  }
  // (C) yazıların ortancası · (D) sağlam genişlik
  const h = texts.length >= 3 && tMed > 0 ? niceLen(tMed) : niceLen((extW || 100) / 350);
  return { src: texts.length >= 3 && tMed > 0 ? 'C' : 'D', h, arrow: h, exo: r6(h / 4), exe: r6(h / 2), prec: null, adec: null, prefix: '', suffix: inp.units || '', factor: 1, dsep, repKey: null };
}


// ---------------------------------------------------------------------------------------
// Ölçü tanımı ↔ gerçek DXF DIMENSION (AC1015) — v8.9.8: kaydedilip yeniden açılan ölçü düzenlenebilir kalır
// ---------------------------------------------------------------------------------------
export const DIM_APP = 'DWGOFFICEZIP';
/**
 * Tanımdan DIMENSION tanım noktaları. Yazıcı (edit.writeDxf) ve okuyucu doğrulaması (tools.dimDefFromFile) AYNI işlevi
 * kullanır: okunan varlığın noktaları bu işlevin tanımdan ürettikleriyle eşleşmiyorsa XDATA'daki tanım bayattır.
 *   type 0 dönük (yatay 50=0, düşey 50=90, dönük 50=rot) · 1 hizalı · 3 çap · 4 yarıçap · 5 üç noktalı açısal
 *   p10 tanım noktası · p13 / p14 uzatma noktaları · p15 çap/yarıçapta çevre noktası, açısalda tepe · leader 40 · meas 42
 */
export function dimDxf(def) {
  if (!def || typeof def !== 'object') return null;
  const P = (def.pts || []).map(q => [q[0], q[1], q[2] || 0]);
  if (def.kind === 'linear' && P.length >= 3) {
    const [p1, p2, q] = P;
    let dir, type = 0, rot = 0;
    if (def.sub === 'horizontal') dir = [1, 0];
    else if (def.sub === 'vertical') { dir = [0, 1]; rot = 90; }
    else if (def.sub === 'rotated') { const r = def.rot || 0; dir = [Math.cos(r), Math.sin(r)]; rot = r / D2R; }
    else { const v = sub(p2, p1); if (len(v) < 1e-12) return null; dir = unit(v); type = 1; }
    const n = perp(dir), off = (q[0] - p1[0]) * n[0] + (q[1] - p1[1]) * n[1], t2 = (p2[0] - p1[0]) * dir[0] + (p2[1] - p1[1]) * dir[1];
    const p10 = [p1[0] + n[0] * off + dir[0] * t2, p1[1] + n[1] * off + dir[1] * t2, p1[2]];
    return { type, p10, p13: p1, p14: p2, rot, meas: Math.abs(t2) };
  }
  if (def.kind === 'radial' && P.length >= 2 && def.r > 0) {
    // kılavuz uzunluğu dimRadial ile aynı: 2 × çizilen yazı yüksekliği (h × genel ölçek)
    const c = P[0], d = unit(sub(P[1], c)), r = def.r, h = (def.h > 0 ? def.h : 2.5) * (def.scale > 0 ? def.scale : 1);
    const on = [c[0] + d[0] * r, c[1] + d[1] * r, c[2]];
    if (def.sub === 'diameter') return { type: 3, p10: [c[0] - d[0] * r, c[1] - d[1] * r, c[2]], p15: on, leader: h * 2, meas: 2 * r };
    return { type: 4, p10: c, p15: on, leader: h * 2, meas: r };
  }
  if (def.kind === 'angular' && P.length >= 3) {
    const [v, a, b] = P;
    const L1 = len(sub(a, v)), L2 = len(sub(b, v));
    if (!(L1 > 1e-12) || !(L2 > 1e-12)) return null;
    const r = def.r > 0 ? def.r : Math.min(L1, L2) * 0.7;
    const a0 = Math.atan2(a[1] - v[1], a[0] - v[0]);
    let sw = Math.atan2(b[1] - v[1], b[0] - v[0]) - a0;
    while (sw <= -Math.PI) sw += TAU;
    while (sw > Math.PI) sw -= TAU;
    const am = a0 + sw / 2;
    // DXF'te açı 13'ten 14'e saat yönünün TERSİNE ölçülür (ezdxf, AutoCAD): saat yönündeki seçimde kollar yer değiştirir
    return { type: 5, p10: [v[0] + Math.cos(am) * r, v[1] + Math.sin(am) * r, v[2]], p13: sw < 0 ? b : a, p14: sw < 0 ? a : b, p15: v, meas: Math.abs(sw) };
  }
  return null;
}
/** AC1015 DXF dizgisi: MTEXT kaçışları (\\ { }) ve ASCII dışı karakter \U+XXXX (dxf.js unescapeText / scene.mtextLines ikisini de çözer) */
export const dxfText = (s) => String(s == null ? '' : s).replace(/[\\{}]/g, c => '\\' + c).replace(/\r?\n/g, '\\P').replace(/[^\x20-\x7e]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));   // satır sonu MTEXT \P (ham satır sonu DXF'in kod/değer satırlarını bozardı)
/** Uygulama XDATA'sı: tanımın tamamı JSON, boşluksuz ve ASCII (dxf.js değeri kırpar), 240 karakterlik 1000 parçaları */
export function dimXdataEncode(def) {
  // Veri içindeki ters bölü JSON'da "\\" olur; ardından "U+0041" gelirse dxf.js'in \U+ çözücüsü onu harfe çevirip JSON'u
  // bozardı. Bu yüzden veri ters bölüsü \u005c yazılır (JSON'un öteki kaçışları — \" \n \u… — olduğu gibi kalır)
  const json = JSON.stringify({ v: 1, def }).replace(/\\(.)/g, (m, c) => (c === '\\' ? '\\u005c' : m)).replace(/[^\x21-\x7e]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const out = [[1001, DIM_APP], [1000, 'DIMDEF'], [1070, 1]];
  for (let i = 0; i < json.length; i += 240) out.push([1000, json.slice(i, i + 240)]);
  return out;
}
const KINDS = new Set(['linear', 'radial', 'angular']);
const SUBS = new Set(['aligned', 'horizontal', 'vertical', 'rotated', 'radius', 'diameter']);
const sayi = (v, alt, ust) => typeof v === 'number' && isFinite(v) && v >= alt && v <= ust;
const noktaGecerli = (q) => Array.isArray(q) && q.length >= 2 && q.length <= 3 && q.every(n => sayi(n, -1e15, 1e15));
/*
 * XDATA'daki tanım DOSYADAN gelir (güvenilmez): her alan türü ve aralığıyla denetlenir. Sayı olmayan bir dönüş açısı ya da
 * sonsuz bir yükseklik NaN / Infinity karşılaştırmaları yanlış döndüğü için bayatlık denetimini geçiyor, ölçü düzenlenemez
 * ve yeniden kaydedince DXF alanları sıfırlanırdı.
 */
function tanimGecerli(d) {
  if (!d || typeof d !== 'object' || !KINDS.has(d.kind)) return false;
  if (!Array.isArray(d.pts) || d.pts.length < 2 || d.pts.length > 4 || !d.pts.every(noktaGecerli)) return false;
  if (d.sub != null && !SUBS.has(d.sub)) return false;
  for (const k of ['h', 'arrow', 'r', 'scale', 'factor']) if (d[k] != null && !sayi(d[k], 1e-12, 1e12)) return false;
  for (const k of ['exo', 'exe']) if (d[k] != null && !sayi(d[k], 0, 1e12)) return false;
  if (d.rot != null && !sayi(d.rot, -1e3, 1e3)) return false;
  if (d.prec != null && !sayi(d.prec, 0, 8)) return false;
  if (d.dsep != null && !sayi(d.dsep, 0, 0xffff)) return false;
  if (d.tp != null && !noktaGecerli(d.tp)) return false;
  for (const k of ['text', 'prefix', 'suffix']) if (d[k] != null && !(typeof d[k] === 'string' && d[k].length <= 256)) return false;
  return true;
}
/** e.xdata (dxf.js / libredwg biçimi) → tanım ya da null (bozuk, tanınmayan sürüm) */
export function dimXdataDecode(xdata) {
  for (const x of xdata || []) {
    if (String(x.appName || x.app_name || '').toUpperCase() !== DIM_APP) continue;
    const vals = (x.value || x.values || []).map(v => (v && typeof v === 'object') ? v : { code: 0, value: v });
    const i = vals.findIndex(v => v.code === 1000 && v.value === 'DIMDEF');
    if (i < 0 || !vals[i + 1] || vals[i + 1].code !== 1070 || (vals[i + 1].value | 0) !== 1) continue;
    let json = '';
    for (let k = i + 2; k < vals.length && vals[k].code === 1000; k++) json += String(vals[k].value);
    try {
      const o = JSON.parse(json), d = o && o.def;
      if (tanimGecerli(d)) return d;
    } catch (_) { /* bozuk */ }
  }
  return null;
}

/**
 * info.dim (scene.js) → uygulamanın XDATA tanımı, yalnız varlığın kendi alanlarıyla hâlâ örtüşüyorsa (AutoCAD'de değişmemişse):
 * tür, tanım noktaları (10/13/14/15), yazı geçersiz kılması (1) ve etkin yazı yüksekliği (DIMTXT × DIMSCALE).
 */
export function dimAppDef(d) {
  const a = d && d.app, f = dimDxf(a);
  if (!f || f.type !== d.type) return null;
  if (!(f.meas >= 0) || !isFinite(f.meas)) return null;
  // karşılaştırmalar NaN'a dayanıklı yazılır: "farklı değilse" değil "eşitse" kabul
  const tol = 1e-5, esit = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
  for (const [q, r] of [[f.p10, d.d], [f.p13, d.p1], [f.p14, d.p2], [f.p15, d.cp]]) {
    if (!q) continue;
    if (!r || !(Math.hypot(q[0] - r[0], q[1] - r[1]) <= tol)) return null;
  }
  // AutoCAD'de yazısı elle taşınmış ölçü (70 bit 128) tanımımızdan kurulamaz
  if (typeof d.fl === 'number' && (d.fl & 128)) return null;
  // yazı geçersiz kılması: ham DXF dizgisiyle karşılaştırılır (%%c, satır sonu, { } \ düz metne çevrilince eşleşmiyordu)
  const want = String(a.text || '').trim(), wantOv = want === '<>' ? '' : want;
  if (typeof d.raw === 'string') {
    const kac = wantOv.replace(/[\\{}]/g, c => '\\' + c).replace(/\r?\n/g, '\\P');
    if (d.raw.trim() !== kac && d.raw.trim() !== (want === '<>' ? '<>' : kac)) return null;
  } else if ((d.ov || '') !== wantOv) return null;
  // stil geçersiz kılmaları: yazıcının DSTYLE'a yazdığı her değer dosyadakiyle aynı olmalı — AutoCAD'de ok boyu, ondalık,
  // çarpan ya da son ek değiştirilmişse tanım bayattır (yoksa bir sonraki kayıt o değişiklikleri geri alırdı)
  const s = d.sty || {}, k = a.scale > 0 ? a.scale : 1, h0 = a.h > 0 ? a.h : 2.5, h = h0 * k;
  if (s.txt > 0 && !esit(s.txt, h)) return null;
  if (typeof s.asz === 'number' && !esit(s.asz, (a.arrow > 0 ? a.arrow : h0) * k)) return null;
  if (typeof s.exo === 'number' && !esit(s.exo, (a.exo >= 0 ? a.exo : h0 * 0.25) * k)) return null;
  if (typeof s.exe === 'number' && !esit(s.exe, (a.exe >= 0 ? a.exe : h0 * 0.5) * k)) return null;
  const ang = a.kind === 'angular';
  if (a.prec != null) { const fp = ang ? s.adec : s.dec; if (typeof fp === 'number' && fp >= 0 && fp !== (a.prec | 0)) return null; }
  if (!ang) {
    if (typeof s.lfac === 'number' && !esit(s.lfac, a.factor > 0 ? a.factor : 1)) return null;
    if (typeof s.post === 'string' && s.post !== (a.prefix || '') + '<>' + (a.suffix || '')) return null;
  }
  if (a.dsep > 0 && s.dsep > 0 && (a.dsep | 0) !== (s.dsep | 0)) return null;
  return JSON.parse(JSON.stringify(a));
}
