/*
 * sel3.js — ÜÇ BOYUTLU BÖLGE SEÇİMİ (3D window / crossing / polygon selection).
 *
 * NE İŞE YARAR
 *   3B görünümde ekrana çizilen bir DİKDÖRTGEN ya da ÇOKGEN içine düşen nesneleri bulur.
 *   AutoCAD'in iki kuralı aynen geçerlidir:
 *     PENCERE (window)  — nesnenin TAMAMI bölgenin içindeyse seçilir. Soldan sağa sürükleme.
 *     KESEN   (crossing)— bölgeye DEĞEN her nesne seçilir. Sağdan sola sürükleme.
 *
 * NEDEN AYRI BİR MODÜL VE NEDEN EKRAN UZAYINDA
 *   2B'deki tools.selectRegion DÜNYA koordinatlarında çalışır: kutu bir XY dikdörtgenidir.
 *   3B'de böyle bir dikdörtgen yoktur — kullanıcı ekrana bir çerçeve çizer ve o çerçeve
 *   dünyada bir PİRAMİTTİR. Bu yüzden sınama ekran uzayında yapılır: nesnenin geometrisi
 *   izdüşüme alınır, sonra düzlemde kesişim aranır. Kot (z) hesaba kendiliğinden girer,
 *   çünkü izdüşüm onu zaten taşır.
 *
 * KURALLAR
 *  - SAF: durum tutmaz, sahneye dokunmaz, girdiyi değiştirmez, DOM ve kamera bilmez.
 *  - İzdüşüm bir işlev olarak alınır: (x, y, z) → [ekranX, ekranY] ya da görünmüyorsa null.
 *  - Kameranın ARKASINA düşen köşe "görünmüyor" sayılır. Böyle bir köşesi olan nesne
 *    PENCEREYE giremez (tamamı içinde olduğu söylenemez) ama KESEN'e girebilir: görünen
 *    parçası bölgeye değiyorsa seçilir.
 *  - Bütçe: her sürükleme bitişinde yüz binlerce köşe taranmaz; maxWork aşılınca tarama
 *    durur ve o ana kadar bulunanlar döner (eksik: true ile bildirilir).
 */

import { primGeom3 } from './osnap3.js';

const say = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/** [x0,y0,x1,y1] kutusunu x0<x1, y0<y1 olacak biçimde düzeltir */
export function kutuDuzelt(r) {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

const noktaKutuda = (x, y, r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

/** İki doğru parçası kesişiyor mu (uç değmesi de kesişim sayılır) */
export function parcaKesisiyor(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // eşdoğrusal / uç değmesi
  const uzerinde = (px, py, qx, qy, rx, ry) =>
    Math.min(px, qx) - 1e-9 <= rx && rx <= Math.max(px, qx) + 1e-9 &&
    Math.min(py, qy) - 1e-9 <= ry && ry <= Math.max(py, qy) + 1e-9;
  if (Math.abs(d1) < 1e-9 && uzerinde(ax, ay, bx, by, cx, cy)) return true;
  if (Math.abs(d2) < 1e-9 && uzerinde(ax, ay, bx, by, dx, dy)) return true;
  if (Math.abs(d3) < 1e-9 && uzerinde(cx, cy, dx, dy, ax, ay)) return true;
  if (Math.abs(d4) < 1e-9 && uzerinde(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

/** Doğru parçası eksen hizalı kutuya değiyor mu (içinde kalmak da değmektir) */
export function parcaKutuyaDeger(ax, ay, bx, by, r) {
  if (noktaKutuda(ax, ay, r) || noktaKutuda(bx, by, r)) return true;
  // kutunun tamamen dışında kalan yarım düzlemler: dört kenarla kesişim aramaya gerek yok
  if ((ax < r[0] && bx < r[0]) || (ax > r[2] && bx > r[2]) || (ay < r[1] && by < r[1]) || (ay > r[3] && by > r[3])) return false;
  return parcaKesisiyor(ax, ay, bx, by, r[0], r[1], r[2], r[1])
    || parcaKesisiyor(ax, ay, bx, by, r[2], r[1], r[2], r[3])
    || parcaKesisiyor(ax, ay, bx, by, r[2], r[3], r[0], r[3])
    || parcaKesisiyor(ax, ay, bx, by, r[0], r[3], r[0], r[1]);
}

/** Nokta çokgenin içinde mi (ışın atma, tek / çift kuralı) */
export function noktaCokgende(poly, x, y) {
  let ic = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi) ic = !ic;
  }
  return ic;
}

/** Doğru parçası çokgene değiyor mu */
export function parcaCokgeneDeger(ax, ay, bx, by, poly) {
  if (noktaCokgende(poly, ax, ay) || noktaCokgende(poly, bx, by)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (parcaKesisiyor(ax, ay, bx, by, poly[j][0], poly[j][1], poly[i][0], poly[i][1])) return true;
  }
  return false;
}

/**
 * İlkelin ÜÇ BOYUTLU parça listesi. primGeom3 yalnız yol ilkellerini (k === 0) bilir;
 * burada ağ ilkeli (k === 5) ve nokta benzeri ilkeller de karşılanır, yoksa 3B'de bir
 * yüzey ya da yazı hiçbir bölge seçimine girmezdi.
 *   { segs: [[ax,ay,az,bx,by,bz]…], pts: [[x,y,z]…] }
 * pts, parçası olmayan ilkelin temsilcisidir (nokta, yazı, blok: kendi kutusunun köşeleri).
 */
export function parcalar3(p) {
  if (!p) return { segs: [], pts: [] };
  if (p.k === 0) return { segs: primGeom3(p).segs, pts: [] };
  if (p.k === 5) {
    /*
     * Ağ gövdesi. p.seg KENAR dizisidir: altı sayı bir parçanın iki ucudur (geom.extrudeMesh).
     * Kenar dizisi boşsa (dışarıdan gelen hazır ağ) üçgen indislerinden kenar kurulur — köşeleri
     * tek tek nokta saymak yanlış olurdu: bölgeyi ortasından kesen büyük bir üçgen, üç köşesi de
     * dışarıda kaldığı için kaçardı.
     */
    const segs = [];
    const V = p.vtx, G = p.seg, I = p.idx;
    if (G && G.length) for (let i = 0; i + 5 < G.length; i += 6) segs.push([say(G[i]), say(G[i + 1]), say(G[i + 2]), say(G[i + 3]), say(G[i + 4]), say(G[i + 5])]);
    else if (V && V.length && I && I.length) {
      const k = (j) => [say(V[j * 3]), say(V[j * 3 + 1]), say(V[j * 3 + 2])];
      for (let i = 0; i + 2 < I.length; i += 3) {
        const a = k(I[i]), b = k(I[i + 1]), c = k(I[i + 2]);
        segs.push([a[0], a[1], a[2], b[0], b[1], b[2]], [b[0], b[1], b[2], c[0], c[1], c[2]], [c[0], c[1], c[2], a[0], a[1], a[2]]);
      }
    }
    const pts = [];
    if (!segs.length && V && V.length) for (let i = 0; i + 2 < V.length; i += 3) pts.push([say(V[i]), say(V[i + 1]), say(V[i + 2])]);
    return { segs, pts };
  }
  // Nokta / yazı / blok: kendi sınır kutusunun dört köşesi, ilkelin kotunda.
  const bb = p.bb;
  const z = p.z != null ? say(p.z) : p.zmin != null ? say(p.zmin) : 0;
  if (!bb || bb.length < 4) return { segs: [], pts: [] };
  return { segs: [], pts: [[bb[0], bb[1], z], [bb[2], bb[1], z], [bb[2], bb[3], z], [bb[0], bb[3], z]] };
}

/** İlkelin sınır kutusunun sekiz köşesi — kaba eleme için */
function kutuKoseleri(p) {
  const bb = p && p.bb;
  if (!bb || bb.length < 4) return null;
  const z0 = p.zmin != null ? say(p.zmin) : p.z != null ? say(p.z) : 0;
  const z1 = p.zmax != null ? say(p.zmax) : z0;
  return [
    [bb[0], bb[1], z0], [bb[2], bb[1], z0], [bb[2], bb[3], z0], [bb[0], bb[3], z0],
    [bb[0], bb[1], z1], [bb[2], bb[1], z1], [bb[2], bb[3], z1], [bb[0], bb[3], z1],
  ];
}

/**
 * ÜÇ BOYUTLU BÖLGE SEÇİMİ.
 *   prims   : sahne ilkelleri
 *   project : (x, y, z) → [ekranX, ekranY] ya da görünmüyorsa null
 *   shape   : { rect: [x0,y0,x1,y1] } ya da { poly: [[x,y]…] } — EKRAN koordinatları
 *   opts    : { crossing (bool), maxWork, visible (p → boolean) }
 * Dönüş: { prims: [ilkel…], work, eksik }
 */
export function regionPick3(prims, project, shape, opts = {}) {
  const out = [];
  if (!prims || !prims.length || typeof project !== 'function' || !shape) return { prims: out, work: 0, eksik: false };
  const kesen = opts.crossing === true;
  const maxWork = opts.maxWork == null ? 200000 : opts.maxWork;
  const gorunur = typeof opts.visible === 'function' ? opts.visible : null;

  const rect = shape.rect ? kutuDuzelt(shape.rect) : null;
  const poly = shape.poly && shape.poly.length >= 3 ? shape.poly : null;
  if (!rect && !poly) return { prims: out, work: 0, eksik: false };
  // Çokgenin kendi ekran kutusu: kaba eleme her iki biçimde de kutuyla yapılır.
  const kaba = rect || (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of poly) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
    return [x0, y0, x1, y1];
  })();

  const icinde = (x, y) => (rect ? noktaKutuda(x, y, rect) : noktaCokgende(poly, x, y));
  const deger = (ax, ay, bx, by) => (rect ? parcaKutuyaDeger(ax, ay, bx, by, rect) : parcaCokgeneDeger(ax, ay, bx, by, poly));

  let work = 0, eksik = false;
  for (const p of prims) {
    if (work > maxWork) { eksik = true; break; }
    if (gorunur && !gorunur(p)) continue;
    /*
     * KABA ELEME. İzdüşüm bir projektif dönüşümdür: bir kutunun izdüşümü, köşelerinin
     * izdüşümlerinin dışbükey örtüsünün içinde kalır. Dolayısıyla o sekiz noktanın ekran
     * kutusu, nesnenin ekran kutusunu kapsar — kesişmiyorsa nesne bölgeye giremez.
     * Köşelerden biri kameranın arkasındaysa örtü kuralı bozulur; o zaman eleme yapılmaz.
     */
    const kk = kutuKoseleri(p);
    if (kk) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, tam = true;
      for (const q of kk) {
        work++;
        const s = project(q[0], q[1], q[2]);
        if (!s) { tam = false; break; }
        if (s[0] < x0) x0 = s[0]; if (s[0] > x1) x1 = s[0];
        if (s[1] < y0) y0 = s[1]; if (s[1] > y1) y1 = s[1];
      }
      if (tam && (x1 < kaba[0] || x0 > kaba[2] || y1 < kaba[1] || y0 > kaba[3])) continue;
    }

    const g = parcalar3(p);
    if (!g.segs.length && !g.pts.length) continue;

    let hepsiIcinde = true, degdi = false, gorunmeyenVar = false;
    // tek noktalar (nokta / yazı / blok temsilcileri, parçasız ağ köşeleri)
    for (const q of g.pts) {
      work++;
      const s = project(q[0], q[1], q[2]);
      if (!s) { gorunmeyenVar = true; hepsiIcinde = false; continue; }
      if (icinde(s[0], s[1])) degdi = true; else hepsiIcinde = false;
      if (kesen && degdi) break;
    }
    if (!(kesen && degdi)) {
      for (const sg of g.segs) {
        if (work > maxWork) { eksik = true; break; }
        work += 2;
        const a = project(sg[0], sg[1], sg[2]), b = project(sg[3], sg[4], sg[5]);
        if (!a || !b) {
          gorunmeyenVar = true; hepsiIcinde = false;
          if (!kesen) break;
          /*
           * TEK UCU GÖRÜNEN PARÇA. Parçanın görünmeyen tarafa giden bölümü kırpılamaz (kırpma
           * kamera düzlemini bilmeyi gerektirir, bu modül onu bilmez); ama GÖRÜNEN uç bölgeye
           * düşüyorsa nesne bölgeye değmiştir ve kesen seçimine girer. Bu dal olmadan, bir ucu
           * kameranın arkasında kalan her nesne kesen seçiminden sessizce kaçardı.
           */
          const g = a || b;
          if (g && !degdi && icinde(g[0], g[1])) degdi = true;
          if (degdi) break;
          continue;
        }
        const ai = icinde(a[0], a[1]), bi = icinde(b[0], b[1]);
        if (!ai || !bi) hepsiIcinde = false;
        if (!degdi && (ai || bi || deger(a[0], a[1], b[0], b[1]))) degdi = true;
        if (kesen && degdi) break;
        if (!kesen && !hepsiIcinde) break;   // pencere: bir köşe dışarıdaysa nesne zaten girmez
      }
    }
    if (kesen ? degdi : (hepsiIcinde && !gorunmeyenVar && (g.segs.length > 0 || g.pts.length > 0))) out.push(p);
  }
  return { prims: out, work, eksik };
}
