/*
 * 3B geometrik ölçüm ailesinin saf hesap ve akış çekirdeği:
 * nokta-doğru, nokta-düzlem, doğru-doğru, doğru-düzlem, düzlem-düzlem,
 * düzlemler arası açı ve akıllı açı.
 *
 * Bu modül EKRANA HİÇ DOKUNMAZ. Girdi [x,y,z] dizileri, çıktı sayı, mantıksal
 * değer ve nokta üçlüleridir. Seçim, yakalama, çizim ve birim çevrimi çağıranın
 * (editor.js / app.js) işidir.
 *
 * Alınan kararlar ve nedenleri:
 *
 *   · Hesabın tamamı geom.js'in 3B işlevleriyle yapılır (pointLine3, planeFrom3,
 *     pointPlane3, lineLine3, linePlane3, planePlane3, angleBetween). Formül
 *     buraya kopyalanmaz: aynı hesabın iki yerde durması, birinde düzeltilen
 *     bir kararsızlığın ötekinde kalmasına yol açar.
 *
 *   · Hiçbir kullanıcı metni gömülmez. `rows` satırlarının ilk öğesi bir i18n
 *     ANAHTARIDIR ('dist3', 'angle', 'parallel' …), metin değildir; üçüncü öğe
 *     birim türüdür ('len' uzunluk — çağıran çizim birimini ekler, 'deg' derece,
 *     'bool' mantıksal, 'pt' nokta/doğrultu üçlüsü). Böylece aynı çekirdek her
 *     dilde ve her birim ayarında çalışır.
 *
 *   · Hata durumunda istisna fırlatılmaz: compute null, guides boş dizi döndürür.
 *     Ölçüm bir dokunuş akışının içindedir; bozuk bir nokta uygulamayı düşürmemeli,
 *     çağıran yalnız kullanıcıyı uyarmalıdır.
 *
 *   · Sıfır eşikleri MUTLAK değil GÖRELİdir. Bir çizim milimetre de olabilir
 *     UTM koordinatı da; sabit bir eşik birinde her şeyi sıfır, ötekinde hiçbir
 *     şeyi sıfır sayardı. Ölçüde geçen noktaların büyüklüğünden bir ölçek
 *     çıkarılır ve eşikler onunla çarpılır.
 *
 *   · Doğrusallık denetimi yalnız DÜZLEM tanımlarında null verir (üç doğrusal
 *     nokta düzlem tanımlamaz). Açı ölçümünde doğrusal üç nokta kararsızlık
 *     değildir: 0° ya da 180° geçerli bir sonuçtur ve öyle bildirilir.
 *
 *   · 'smartangle' akışı: ilk iki nokta her zaman birinci doğrudur. Üçüncü nokta
 *     gelirse ölçü, TEPESİ İKİNCİ NOKTA olan açıya döner (kollar 2→1 ve 2→3);
 *     dördüncü nokta gelirse üçüncü ile dördüncü ayrı bir doğru olur ve iki doğru
 *     arasındaki dar açı ölçülür. Tepe noktası `extra.apex` ile ve 'apex' satırıyla
 *     ayrıca bildirilir ki kullanıcı hangi noktanın tepe sayıldığını görebilsin.
 *
 *   · Paralel / kesişen / çakışık / aykırı (skew) durumları ayrı satırlardır.
 *     Tek bir "durum" anahtarı yerine ayrı mantıksal satırlar seçildi: çağıran
 *     istediğini gösterir, i18n tarafında durum adı çözmek zorunda kalmaz.
 *
 *   · `extra`, çağıranın çizime işleyebileceği ham geometridir (dik ayak, izdüşüm,
 *     kesişim noktası, düzlem nesnesi, arakesit doğrultusu). Her modda `extra.kind`
 *     hangi şeklin çözüldüğünü söyler. Gösterilecek metin değildir.
 */
import {
  v3sub, v3add, v3dot, v3cross, v3len, v3norm, dist3, angleBetween,
  pointLine3, planeFrom3, pointPlane3, lineLine3, linePlane3, planePlane3,
} from './geom.js';

const REL = 1e-9;          // göreli sıfır eşiği (uzunluk)
const SIN_MIN = 1e-7;      // üç noktanın "doğrusal" sayılma sınırı (aradaki açının sinüsü)
const ANG_TOL = 1e-6;      // derece cinsinden açı karşılaştırma payı (dik / paralel)

/**
 * Ölçüm modları. Her mod:
 *   id      mod anahtarı
 *   needs   ölçünün tamamlanması için gereken nokta sayısı (en çok)
 *   min     sonuç veren en az nokta sayısı — 'smartangle' dışında needs ile aynıdır
 *   groups  noktaların hangi geometriyi tanımladığı, ör. [1,2] = önce 1 nokta, sonra 2 noktalı doğru
 *   parts   her grubun makine okunur adı; stepOf bunu döndürür, i18n metni buradan üretir
 */
export const MODES = [
  { id: 'ptline', needs: 3, min: 3, groups: [1, 2], parts: ['point', 'line1'] },
  { id: 'ptplane', needs: 4, min: 4, groups: [1, 3], parts: ['point', 'plane1'] },
  { id: 'lineline', needs: 4, min: 4, groups: [2, 2], parts: ['line1', 'line2'] },
  { id: 'lineplane', needs: 5, min: 5, groups: [2, 3], parts: ['line1', 'plane1'] },
  { id: 'planeplane', needs: 6, min: 6, groups: [3, 3], parts: ['plane1', 'plane2'] },
  { id: 'planeangle', needs: 6, min: 6, groups: [3, 3], parts: ['plane1', 'plane2'] },
  // 'smartangle' iki doğruyla tanımlanır (2+2); üçüncü nokta konduğunda ölçü geçici
  // olarak tepe açısına döner, o yüzden min 3'tür. Gruplar yine [2,2]: üçüncü nokta
  // ikinci doğrunun BAŞI, dördüncü nokta ikinci doğrunun SONUdur. Tepe noktası bir
  // "parça" değildir, ikinci noktanın kendisidir; 'apex' satırıyla bildirilir.
  { id: 'smartangle', needs: 4, min: 3, groups: [2, 2], parts: ['line1', 'line2'] },
];
const BY_ID = new Map(MODES.map(m => [m.id, m]));

// ---- küçük yardımcılar ---------------------------------------------------------
/**
 * Gerçek sonlu sayı mı. Genel `isFinite` KULLANILMAZ: o önce sayıya çevirir ve
 * isFinite(null) / isFinite(true) / isFinite('') hepsi true döner — böyle bir
 * koordinat sessizce 0 olur ve ölçü yanlış çıkar. Ölçüm noktaları sayıdır;
 * sayı olmayan her şey bozuk girdidir ve ölçü iptal edilmelidir.
 */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
/** Tek noktayı temizler: z eksikse 0; sayı değilse null (çağıran ölçüyü iptal eder) */
const pt3 = (p) => (p && fin(p[0]) && fin(p[1]))
  ? [p[0], p[1], fin(p[2]) ? p[2] : 0] : null;
/** Ölçek: eşikler bununla çarpılır; en az 1 alınır ki orijin çevresindeki çizim sıfırlanmasın */
const scaleOf = (P) => {
  let s = 1;
  for (const p of P) {
    const m = Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
    if (m > s) s = m;
  }
  return s;
};
/** Doğru ölçülebilir uzunlukta mı (çok kısa doğru sayısal olarak kararsızdır) */
const lineOk = (a, b, s) => dist3(a, b) > s * REL;
/**
 * Üç noktadan düzlem — planeFrom3'ün önüne konan kararlılık süzgeci.
 * planeFrom3 çapraz çarpımın BÜYÜKLÜĞÜNE bakar; büyük koordinatlarda neredeyse
 * doğrusal bir üçlü o sınavı geçer. Burada büyüklük, kenar boylarının çarpımına
 * bölünerek aradaki açının sinüsüne çevrilir: ölçekten bağımsız bir ölçüt olur.
 */
const planeOf = (a, b, c, s) => {
  if (!lineOk(a, b, s) || !lineOk(a, c, s) || !lineOk(b, c, s)) return null;
  const u = v3sub(b, a), v = v3sub(c, a);
  const sin = v3len(v3cross(u, v)) / (v3len(u) * v3len(v));
  if (!(sin > SIN_MIN)) return null;
  const pl = planeFrom3(a, b, c);
  if (pl) return pl;
  // Buraya düşmek üçgenin bozuk olduğu anlamına GELMEZ: planeFrom3'ün kendi eşiği
  // mutlaktır (|u x v| < 1e-9), yani kenarları çok kısa ama açısı düzgün bir üçgen
  // (mikron ölçeğinde bir ayrıntı) yukarıdaki göreli sınavı geçtiği hâlde orada
  // takılır. Üçgen, a çevresinde birim kenarlara büyütülüp bir kez daha sorulur:
  // normalin DOĞRULTUSU, p0 = a ve d = n·a değişmediği için düzlem birebir aynıdır,
  // yalnız sayısal koşullanması düzelir.
  return planeFrom3(a, v3add(a, v3norm(u)), v3add(a, v3norm(v)));
};
/** Üçgen kenarları — düzlemi ekranda gösteren üç yardımcı çizgi */
const triEdges = (a, b, c) => [[a, b], [b, c], [c, a]];
/**
 * Yardımcı çizgiyi ancak görünür bir boyu varsa ekler. Ölçülen bağ (dikme, izdüşüm,
 * en yakın nokta çifti) ölçünün sıfır çıktığı durumlarda — nokta düzlemin üstünde,
 * doğru düzlemin içinde, düzlemler çakışık — iki ucu aynı noktaya düşer; sıfır boylu
 * çizgi ekranda ya hiç görünmez ya da yön veremediği için nokta gibi bir leke bırakır.
 */
const pushSeg = (g, p, q, s) => { if (dist3(p, q) > s * REL) g.push([p, q]); };
/** Dik mi (dar açı 90°'ye ANG_TOL kadar yakın) */
const isPerp = (deg) => isFinite(deg) && Math.abs(deg - 90) <= ANG_TOL;

// ---- akış ----------------------------------------------------------------------
/** Modun gerektirdiği nokta sayısı; bilinmeyen id'de 0 */
export function needsOf(id) {
  const m = BY_ID.get(id);
  return m ? m.needs : 0;
}
/**
 * O an kaçıncı noktanın istendiğini anlatan makine okunur anahtar:
 *   { part: 'line1', index: 0, optional: false }
 * part  hangi geometri parçası doldurluyor · index  o parça içindeki sıra
 * optional  bu noktadan önce zaten bir sonuç alınabiliyor mu ('smartangle'ın 4. noktası)
 * Ölçü tamamlanmışsa ya da id bilinmiyorsa null.
 */
export function stepOf(id, n) {
  const m = BY_ID.get(id);
  if (!m || !isFinite(n)) return null;
  const k = Math.floor(n);
  if (k < 0 || k >= m.needs) return null;
  let i = k;
  for (let g = 0; g < m.groups.length; g++) {
    if (i < m.groups[g]) return { part: m.parts[g], index: i, optional: k >= m.min };
    i -= m.groups[g];
  }
  return null;
}

// ---- ölçüler --------------------------------------------------------------------
/** Nokta – doğru: dik uzaklık, dik ayak, ayağın parça üzerinde olup olmadığı */
function ptline(P, s) {
  const [p, a, b] = P;
  if (!lineOk(a, b, s)) return null;
  const r = pointLine3(p, a, b);
  const tol = s * REL;
  return {
    rows: [
      ['dist3', r.dist, 'len'],
      ['onLine', r.dist <= tol, 'bool'],
      ['onSegment', r.t >= -REL && r.t <= 1 + REL, 'bool'],
      ['distP1', dist3(p, a), 'len'],
      ['distP2', dist3(p, b), 'len'],
      ['lineLen', dist3(a, b), 'len'],
      ['foot', r.foot, 'pt'],
    ],
    extra: { kind: 'ptline', foot: r.foot, t: r.t, onLine: r.dist <= tol },
  };
}
/** Nokta – düzlem: işaretli uzaklık (normal yönü artı) ve düzlem üzerindeki izdüşüm */
function ptplane(P, s) {
  const [p, a, b, c] = P;
  const pl = planeOf(a, b, c, s);
  if (!pl) return null;
  const r = pointPlane3(p, pl);
  const tol = s * REL;
  return {
    rows: [
      ['dist3', r.dist, 'len'],
      ['signedDist', r.signed, 'len'],
      ['onPlane', r.dist <= tol, 'bool'],
      ['proj', r.foot, 'pt'],
    ],
    extra: { kind: 'ptplane', plane: pl, foot: r.foot, signed: r.signed },
  };
}
/** Doğru – doğru: en kısa uzaklık, en yakın nokta çifti, dar açı ve konum durumu */
function lineline(P, s) {
  const [a1, a2, b1, b2] = P;
  if (!lineOk(a1, a2, s) || !lineOk(b1, b2, s)) return null;
  const r = lineLine3(a1, a2, b1, b2);
  const touch = r.dist <= s * REL;
  const angle = r.parallel ? 0 : r.angle;
  return {
    rows: [
      ['dist3', r.dist, 'len'],
      ['angle', angle, 'deg'],
      ['parallel', r.parallel, 'bool'],
      ['coincident', r.parallel && touch, 'bool'],
      ['intersecting', !r.parallel && touch, 'bool'],
      ['skew', !r.parallel && !touch, 'bool'],
      ['perpendicular', isPerp(angle), 'bool'],
      ['pa', r.pa, 'pt'],
      ['pb', r.pb, 'pt'],
    ],
    extra: { kind: 'lineline', pa: r.pa, pb: r.pb, parallel: r.parallel, angle, at: !r.parallel && touch ? r.pa : null },
  };
}
/** Doğru – düzlem: kesişim noktası (paralelse null) ve doğru ile düzlem arasındaki açı */
function lineplane(P, s) {
  const [a, b, c, d, e] = P;
  if (!lineOk(a, b, s)) return null;
  const pl = planeOf(c, d, e, s);
  if (!pl) return null;
  const r = linePlane3(a, b, pl);
  const inPlane = r.parallel && r.dist <= s * REL;
  return {
    rows: [
      ['dist3', r.dist, 'len'],
      ['angle', r.angle, 'deg'],
      ['parallel', r.parallel, 'bool'],
      ['inPlane', inPlane, 'bool'],
      ['perpendicular', isPerp(r.angle), 'bool'],
      ['at', r.at, 'pt'],
    ],
    extra: { kind: 'lineplane', plane: pl, at: r.at, parallel: r.parallel, inPlane },
  };
}
/** İki düzlem: paralellerse aralarındaki uzaklık, değilse kesişme ve açı */
function planeplane(P, s) {
  const pl1 = planeOf(P[0], P[1], P[2], s);
  const pl2 = planeOf(P[3], P[4], P[5], s);
  if (!pl1 || !pl2) return null;
  const r = planePlane3(pl1, pl2);
  return {
    rows: [
      ['dist3', r.dist, 'len'],
      ['angle', r.angle, 'deg'],
      ['parallel', r.parallel, 'bool'],
      ['coincident', r.parallel && r.dist <= s * REL, 'bool'],
      ['intersecting', !r.parallel, 'bool'],
    ],
    extra: { kind: 'planeplane', plane1: pl1, plane2: pl2, parallel: r.parallel, dist: r.dist, angle: r.angle },
  };
}
/**
 * Düzlemler arası açı: aynı altı nokta, ama ölçü açıya odaklanır.
 * Bütünler açı da verilir (ikisinin toplamı 180°) — iki düzlemin arakesitinde iki açı
 * vardır ve kullanıcının hangisini istediği ölçüden anlaşılmaz; ikisini de bildirmek
 * karar vermesini sağlar. Düzlemler PARALELSE arakesit yoktur: o zaman bütünler açı da
 * arakesit doğrultusu da null döner (180° gibi uydurma bir değer yazılmaz).
 * Arakesit doğrultusu `extra.dir` ile döner (normallerin çapraz çarpımı, birim).
 */
function planeangle(P, s) {
  const pl1 = planeOf(P[0], P[1], P[2], s);
  const pl2 = planeOf(P[3], P[4], P[5], s);
  if (!pl1 || !pl2) return null;
  const r = planePlane3(pl1, pl2);
  const dir = r.parallel ? null : v3norm(v3cross(pl1.n, pl2.n));
  return {
    rows: [
      ['angle', r.angle, 'deg'],
      ['angleSupp', r.parallel ? null : 180 - r.angle, 'deg'],
      ['parallel', r.parallel, 'bool'],
      ['perpendicular', isPerp(r.angle), 'bool'],
      ['normal1', pl1.n, 'pt'],
      ['normal2', pl2.n, 'pt'],
      ['dir', dir, 'pt'],
    ],
    extra: { kind: 'planeangle', plane1: pl1, plane2: pl2, parallel: r.parallel, angle: r.angle, dir },
  };
}
/** Akıllı açı — 3 nokta: tepe açısı (tepe ikinci nokta) */
function apexAngle(P, s) {
  const [a, v, b] = P;
  if (!lineOk(v, a, s) || !lineOk(v, b, s)) return null;
  const u = v3sub(a, v), w = v3sub(b, v);
  const acute = angleBetween(u, w);
  if (!isFinite(acute)) return null;
  const full = v3dot(u, w) < 0 ? 180 - acute : acute;   // angleBetween dar açı verir; geniş açıyı iç çarpımın işareti açar
  return {
    rows: [
      ['angle', full, 'deg'],
      ['angleSupp', 180 - full, 'deg'],
      ['perpendicular', isPerp(full), 'bool'],
      ['arm1', v3len(u), 'len'],
      ['arm2', v3len(w), 'len'],
      ['apex', v, 'pt'],
    ],
    extra: { kind: 'apex', apex: v, angle: full, arms: [a, b] },
  };
}
/** Akıllı açı — 4 nokta: iki doğru arasındaki dar açı (lineline ile aynı çekirdek) */
function smartangle(P, s) {
  if (P.length === 3) return apexAngle(P, s);
  const r = lineline(P, s);
  if (!r) return null;
  r.extra.kind = 'lines';
  return r;
}

const CALC = { ptline, ptplane, lineline, lineplane, planeplane, planeangle, smartangle };

/**
 * Ölçüyü hesaplar.
 *   id   mod anahtarı · pts  toplanan noktalar [[x,y,z]…]
 * Dönüş: { rows: [[i18nAnahtarı, sayı|mantıksal|nokta|null, 'len'|'deg'|'bool'|'pt']…], extra }
 * Nokta eksikse, bozuksa ya da geometri kararsızsa (çok kısa doğru, doğrusal üç
 * nokta) null — çağıran kullanıcıyı uyarır.
 */
export function compute(id, pts) {
  const m = BY_ID.get(id);
  if (!m || !Array.isArray(pts)) return null;
  const n = Math.min(pts.length, m.needs);
  if (n < m.min) return null;
  const P = [];
  for (let i = 0; i < n; i++) {
    const p = pt3(pts[i]);
    if (!p) return null;
    P.push(p);
  }
  const fn = CALC[id];
  if (!fn) return null;
  try {
    const r = fn(P, scaleOf(P));
    return r && r.rows ? r : null;
  } catch (e) {
    return null;                                        // hiçbir bozuk girdi ölçüm akışını düşürmemeli
  }
}

/**
 * Ekranda gösterilecek yardımcı çizgiler: [[p,q]…] dünya koordinatı nokta çiftleri.
 * Tanımlayan geometri (doğru, düzlem üçgeni) ve ölçülen bağ (dikme, izdüşüm, en
 * yakın nokta çifti) birlikte döner; çağıran hepsini aynı biçemle çizebilir.
 * Nokta eksik ya da geometri kararsızsa boş dizi.
 */
export function guides(id, pts) {
  const m = BY_ID.get(id);
  if (!m || !Array.isArray(pts)) return [];
  const n = Math.min(pts.length, m.needs);
  const P = [];
  for (let i = 0; i < n; i++) {
    const p = pt3(pts[i]);
    if (!p) return [];
    P.push(p);
  }
  if (P.length < m.min) return [];
  const s = scaleOf(P);
  const g = [];
  try {
    if (id === 'ptline') {
      const [p, a, b] = P;
      if (!lineOk(a, b, s)) return [];
      const r = pointLine3(p, a, b);
      g.push([a, b]);
      pushSeg(g, p, r.foot, s);                         // nokta doğrunun üstündeyse dikme çizilmez
      if (r.t < 0) pushSeg(g, a, r.foot, s);            // ayak parçanın dışına düştü: uzatmayı da göster
      else if (r.t > 1) pushSeg(g, b, r.foot, s);
    } else if (id === 'ptplane') {
      const [p, a, b, c] = P;
      const pl = planeOf(a, b, c, s);
      if (!pl) return [];
      g.push(...triEdges(a, b, c));
      pushSeg(g, p, pointPlane3(p, pl).foot, s);
    } else if (id === 'lineline' || (id === 'smartangle' && P.length === 4)) {
      const [a1, a2, b1, b2] = P;
      if (!lineOk(a1, a2, s) || !lineOk(b1, b2, s)) return [];
      const r = lineLine3(a1, a2, b1, b2);
      g.push([a1, a2], [b1, b2]);
      if (r.dist > s * REL) g.push([r.pa, r.pb]);       // çakışık ya da kesişikse sıfır boylu çizgi eklenmez
    } else if (id === 'lineplane') {
      const [a, b, c, d, e] = P;
      if (!lineOk(a, b, s)) return [];
      const pl = planeOf(c, d, e, s);
      if (!pl) return [];
      const r = linePlane3(a, b, pl);
      g.push([a, b], ...triEdges(c, d, e));
      if (r.parallel) pushSeg(g, a, pointPlane3(a, pl).foot, s);
      else if (r.at) pushSeg(g, r.at, pointPlane3(a, pl).foot, s);
    } else if (id === 'planeplane' || id === 'planeangle') {
      const pl1 = planeOf(P[0], P[1], P[2], s);
      const pl2 = planeOf(P[3], P[4], P[5], s);
      if (!pl1 || !pl2) return [];
      g.push(...triEdges(P[0], P[1], P[2]), ...triEdges(P[3], P[4], P[5]));
      if (planePlane3(pl1, pl2).parallel) pushSeg(g, P[3], pointPlane3(P[3], pl1).foot, s);
    } else if (id === 'smartangle') {
      const [a, v, b] = P;
      if (!lineOk(v, a, s) || !lineOk(v, b, s)) return [];
      g.push([v, a], [v, b]);
    }
  } catch (e) {
    return [];
  }
  return g;
}
