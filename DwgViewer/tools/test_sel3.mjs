/*
 * ÜÇ BOYUTLU BÖLGE SEÇİMİ ÇEKİRDEĞİ (viewer/sel3.js).
 *
 * sel3.js saf bir modüldür: kamera, WebGL ve DOM bilmez, ekran izdüşümünü bir işlev olarak alır.
 * Bu yüzden tarayıcıya gerek yoktur. Burada sınanan şey ARAYÜZ DEĞİL, KARARIN KENDİSİDİR:
 * pencere ile kesen arasındaki fark, kameranın arkasına düşen köşenin nasıl sayıldığı, yayın
 * düzleştirilmiş kirişinin kutuya değip değmediği, ağ gövdesinin kenarlarının bulunması ve
 * bütçe aşılınca taramanın durması.
 *
 * Kullanım: node tools/test_sel3.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checker, projectRoot } from './harness.mjs';

const C = checker(), ok = C.ok;
const V = path.join(projectRoot, 'app', 'src', 'main', 'assets', 'viewer', 'sel3.js');
const M = await import(pathToFileURL(V).href);

/** Üstten bakış: x sağa, y aşağı; kot ekranı etkilemez — beklenen piksel elle hesaplanabilir */
const ust = (x, y) => [x, y];
/** Yandan bakış: x sağa, z yukarı — kotu olan nesnelerin ayrıştığı görünüm */
const yan = (x, y, z) => [x, -z];
/** Kameranın arkasına düşenler: z < 0 olan nokta görünmez sayılır */
const arkali = (x, y, z) => (z < 0 ? null : [x, y]);

const bb = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  return [x0, y0, x1, y1];
};
/** k = 0 yol ilkeli: köşe listesinden moveto + lineto zinciri */
function yol(key, pts, o = {}) {
  const ops = pts.map((q, i) => [i ? 1 : 0, q[0], q[1], q[2] || 0]);
  const zs = pts.map(q => q[2] || 0);
  return { k: 0, key, ops, bb: bb(pts), zmin: Math.min(...zs), zmax: Math.max(...zs), ...o };
}
const adlar = (r) => r.prims.map(p => p.key).sort();

// ---------------------------------------------------------------------------------
// A · Pencere ile kesen arasındaki fark (AutoCAD kuralı)
// ---------------------------------------------------------------------------------
{
  const ic = yol('ic', [[10, 10, 0], [20, 20, 0]]);          // tamamen kutunun içinde
  const dis = yol('dis', [[100, 100, 0], [120, 120, 0]]);    // tamamen dışarıda
  const tasan = yol('tasan', [[15, 15, 0], [80, 80, 0]]);    // içeriden başlayıp dışarı taşan
  const gecen = yol('gecen', [[-20, 25, 0], [80, 25, 0]]);   // kutuyu baştan başa kesiyor, köşesi yok
  const pr = [ic, dis, tasan, gecen];
  const kutu = { rect: [0, 0, 50, 50] };

  ok('A1 PENCERE yalnız tamamı içeride olanı alır', JSON.stringify(adlar(M.regionPick3(pr, ust, kutu, { crossing: false }))) === '["ic"]',
    JSON.stringify(adlar(M.regionPick3(pr, ust, kutu, { crossing: false }))));
  ok('A2 KESEN değen her nesneyi alır (taşan ve baştan başa geçen dâhil)',
    JSON.stringify(adlar(M.regionPick3(pr, ust, kutu, { crossing: true }))) === '["gecen","ic","tasan"]',
    JSON.stringify(adlar(M.regionPick3(pr, ust, kutu, { crossing: true }))));
  ok('A3 tamamen dışarıdaki hiçbir kipte girmez',
    !adlar(M.regionPick3(pr, ust, kutu, { crossing: true })).includes('dis') && !adlar(M.regionPick3(pr, ust, kutu, { crossing: false })).includes('dis'));
  // Köşesi kutuda olmayan ama kutuyu kesen parça: yalnız uç noktalara bakan bir hesap bunu kaçırırdı.
  ok('A4 kutuyu kesen ama köşesi içeride OLMAYAN parça kesende bulunur',
    adlar(M.regionPick3([gecen], ust, kutu, { crossing: true })).length === 1);
  ok('A5 aynı parça pencerede bulunmaz', adlar(M.regionPick3([gecen], ust, kutu, { crossing: false })).length === 0);
}

// ---------------------------------------------------------------------------------
// B · Kutunun köşe sırası önemli değil; çokgen de aynı kararı verir
// ---------------------------------------------------------------------------------
{
  const ic = yol('ic', [[10, 10, 0], [20, 20, 0]]);
  ok('B1 ters verilen kutu düzeltilir (x1<x0, y1<y0)',
    adlar(M.regionPick3([ic], ust, { rect: [50, 50, 0, 0] }, { crossing: false })).length === 1);
  ok('B2 kutuDuzelt sıraya sokar', JSON.stringify(M.kutuDuzelt([50, 40, 10, 5])) === '[10,5,50,40]');
  const kare = { poly: [[0, 0], [50, 0], [50, 50], [0, 50]] };
  ok('B3 aynı alanı kaplayan ÇOKGEN kutuyla aynı sonucu verir',
    adlar(M.regionPick3([ic], ust, kare, { crossing: false })).length === 1);
  // İçbükey çokgen: kutunun veremeyeceği ayrım
  const V = { poly: [[0, 0], [50, 0], [50, 50], [40, 50], [40, 10], [10, 10], [10, 50], [0, 50]] };
  const oyukta = yol('oyukta', [[20, 25, 0], [30, 25, 0]]);   // U'nun oyuğunda: çokgenin DIŞINDA
  const kolda = yol('kolda', [[2, 20, 0], [8, 40, 0]]);       // sol kolun içinde
  ok('B4 içbükey çokgenin oyuğundaki nesne SEÇİLMEZ', adlar(M.regionPick3([oyukta], ust, V, { crossing: true })).length === 0);
  ok('B5 içbükey çokgenin kolundaki nesne seçilir', adlar(M.regionPick3([kolda], ust, V, { crossing: false })).length === 1);
  ok('B6 üç noktadan az çokgen hiçbir şey seçmez', M.regionPick3([kolda], ust, { poly: [[0, 0], [1, 1]] }, {}).prims.length === 0);
}

// ---------------------------------------------------------------------------------
// C · Kot (z) hesaba izdüşümle girer
// ---------------------------------------------------------------------------------
{
  const alcak = yol('alcak', [[10, 0, 0], [20, 0, 0]]);       // z = 0  → ekran y = 0
  const yuksek = yol('yuksek', [[10, 0, 40], [20, 0, 40]]);   // z = 40 → ekran y = -40
  const pr = [alcak, yuksek];
  // Yandan bakışta ekran kutusu y ∈ [-10, 10]: yalnız alçak olan girer.
  ok('C1 yandan bakışta kotu yüksek nesne kutunun dışında kalır',
    JSON.stringify(adlar(M.regionPick3(pr, yan, { rect: [0, -10, 30, 10] }, { crossing: true }))) === '["alcak"]',
    JSON.stringify(adlar(M.regionPick3(pr, yan, { rect: [0, -10, 30, 10] }, { crossing: true }))));
  ok('C2 kutu yukarı taşınınca yüksek olan girer',
    JSON.stringify(adlar(M.regionPick3(pr, yan, { rect: [0, -50, 30, -30] }, { crossing: true }))) === '["yuksek"]');
  ok('C3 üstten bakışta ikisi de aynı yerde görünür ve birlikte seçilir',
    adlar(M.regionPick3(pr, ust, { rect: [0, -5, 30, 5] }, { crossing: true })).length === 2);
}

// ---------------------------------------------------------------------------------
// D · Görünmeyen köşe (kameranın arkası)
// ---------------------------------------------------------------------------------
{
  // Bir ucu kameranın arkasında (z < 0 → izdüşüm null), öteki ucu kutunun içinde.
  const yarim = yol('yarim', [[20, 20, -5], [25, 25, 10]]);
  ok('D1 bir köşesi GÖRÜNMEYEN nesne PENCEREYE giremez (tamamı içinde denemez)',
    M.regionPick3([yarim], arkali, { rect: [0, 0, 50, 50] }, { crossing: false }).prims.length === 0);
  ok('D2 ama görünen ucu bölgedeyse KESENE girer',
    M.regionPick3([yarim], arkali, { rect: [0, 0, 50, 50] }, { crossing: true }).prims.length === 1);
  const hepsiArkada = yol('arka', [[20, 20, -5], [25, 25, -8]]);
  ok('D3 tamamı görünmeyen nesne hiçbir kipte seçilmez',
    M.regionPick3([hepsiArkada], arkali, { rect: [0, 0, 50, 50] }, { crossing: true }).prims.length === 0
    && M.regionPick3([hepsiArkada], arkali, { rect: [0, 0, 50, 50] }, { crossing: false }).prims.length === 0);
}

// ---------------------------------------------------------------------------------
// E · Yay, kapalı yol ve ağ gövdesi
// ---------------------------------------------------------------------------------
{
  // Yay: merkez (0,0), yarıçap 30, 0 → 90°. Düzleştirilmiş kirişleri kutuya değer.
  const yay = { k: 0, key: 'yay', ops: [[2, 0, 0, 30, 0, Math.PI / 2, 0]], bb: [-30, -30, 30, 30], zmin: 0, zmax: 0 };
  ok('E1 yayın düzleştirilmiş kirişi kutuya değer (kesen)',
    M.regionPick3([yay], ust, { rect: [20, 20, 24, 24] }, { crossing: true }).prims.length === 1);
  ok('E2 yayı tamamen kapsayan kutu pencerede de alır',
    M.regionPick3([yay], ust, { rect: [-40, -40, 40, 40] }, { crossing: false }).prims.length === 1);

  // Kapalı yol: son kenar (kapanış) da sayılmalı — yalnız o kenar bölgeye değiyor.
  const kapali = yol('kapali', [[0, 0, 0], [40, 0, 0], [40, 40, 0]], { closed: true });
  ok('E3 kapalı yolun KAPANIŞ kenarı da hesaba girer',
    M.regionPick3([kapali], ust, { rect: [18, 18, 22, 22] }, { crossing: true }).prims.length === 1);

  // Ağ gövdesi: kenar dizisi (altı sayı = bir parça)
  const agKenarli = { k: 5, key: 'agK', vtx: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0]), idx: new Uint32Array([0, 1, 2]), seg: new Float32Array([0, 0, 0, 10, 0, 0]), bb: [0, 0, 10, 10], zmin: 0, zmax: 0 };
  ok('E4 ağ gövdesinin KENAR dizisi okunur', M.parcalar3(agKenarli).segs.length === 1);
  // Kenar dizisi boşsa üçgen indislerinden kenar kurulur: üç köşesi de dışarıda olan büyük üçgen
  // bölgeyi ortasından kesiyorsa kaçmamalı.
  const agUcgen = { k: 5, key: 'agU', vtx: new Float32Array([-100, -100, 0, 100, -100, 0, 0, 100, 0]), idx: new Uint32Array([0, 1, 2]), seg: new Float32Array(0), bb: [-100, -100, 100, 100], zmin: 0, zmax: 0 };
  ok('E5 kenar dizisi boş ağda üçgen kenarları kurulur (3 kenar)', M.parcalar3(agUcgen).segs.length === 3);
  ok('E6 üç köşesi de dışarıdaki üçgenin kenarı bölgeyi kesiyorsa bulunur',
    M.regionPick3([agUcgen], ust, { rect: [-60, -102, -40, -98] }, { crossing: true }).prims.length === 1);

  // Nokta benzeri ilkel (yazı / blok): kendi kutusunun köşeleriyle temsil edilir
  const yazi = { k: 1, key: 'yazi', z: 5, bb: [10, 10, 30, 14] };
  ok('E7 yazı / blok kendi kutusuyla temsil edilir (4 köşe)', M.parcalar3(yazi).pts.length === 4);
  ok('E8 kutusu tamamen içerideyse pencerede seçilir',
    M.regionPick3([yazi], ust, { rect: [0, 0, 50, 50] }, { crossing: false }).prims.length === 1);
  ok('E9 kutusunun bir köşesi dışarıdaysa pencerede seçilmez, kesende seçilir',
    M.regionPick3([yazi], ust, { rect: [0, 0, 20, 50] }, { crossing: false }).prims.length === 0
    && M.regionPick3([yazi], ust, { rect: [0, 0, 20, 50] }, { crossing: true }).prims.length === 1);
}

// ---------------------------------------------------------------------------------
// F · Süzgeç, bütçe ve savunma
// ---------------------------------------------------------------------------------
{
  const a = yol('a', [[10, 10, 0], [20, 20, 0]]), b = yol('b', [[12, 12, 0], [18, 18, 0]]);
  ok('F1 visible süzgeci elenen nesneyi hiç aramaz',
    JSON.stringify(adlar(M.regionPick3([a, b], ust, { rect: [0, 0, 50, 50] }, { crossing: true, visible: (p) => p.key === 'a' }))) === '["a"]');
  const cok = [];
  for (let i = 0; i < 2000; i++) cok.push(yol('c' + i, [[i % 50, Math.floor(i / 50), 0], [i % 50 + 1, Math.floor(i / 50) + 1, 0]]));
  const kisitli = M.regionPick3(cok, ust, { rect: [0, 0, 60, 60] }, { crossing: true, maxWork: 200 });
  ok('F2 bütçe aşılınca tarama durur ve bildirilir', kisitli.eksik === true && kisitli.work > 0, JSON.stringify({ work: kisitli.work, eksik: kisitli.eksik, n: kisitli.prims.length }));
  ok('F3 bütçe geniş olunca hepsi bulunur', M.regionPick3(cok, ust, { rect: [0, 0, 60, 60] }, { crossing: true }).prims.length === 2000);
  ok('F4 boş girdi çökertmez', M.regionPick3([], ust, { rect: [0, 0, 1, 1] }, {}).prims.length === 0
    && M.regionPick3(null, ust, { rect: [0, 0, 1, 1] }, {}).prims.length === 0
    && M.regionPick3([a], null, { rect: [0, 0, 1, 1] }, {}).prims.length === 0
    && M.regionPick3([a], ust, null, {}).prims.length === 0);
  ok('F5 ne dikdörtgen ne çokgen verilirse hiçbir şey seçilmez', M.regionPick3([a], ust, {}, {}).prims.length === 0);
  ok('F6 girdi DEĞİŞTİRİLMEZ (saf modül)', JSON.stringify(a.ops) === JSON.stringify(yol('a', [[10, 10, 0], [20, 20, 0]]).ops));
}

// ---------------------------------------------------------------------------------
// G · Geometri yardımcıları tek tek
// ---------------------------------------------------------------------------------
{
  ok('G1 parçalar kesişiyor', M.parcaKesisiyor(0, 0, 10, 10, 0, 10, 10, 0) === true);
  ok('G2 paralel parçalar kesişmez', M.parcaKesisiyor(0, 0, 10, 0, 0, 5, 10, 5) === false);
  ok('G3 uç değmesi kesişim sayılır', M.parcaKesisiyor(0, 0, 10, 0, 10, 0, 20, 0) === true);
  ok('G4 parça kutuya değiyor (içinden geçiyor)', M.parcaKutuyaDeger(-10, 5, 30, 5, [0, 0, 10, 10]) === true);
  ok('G5 kutunun tamamen dışındaki parça değmez', M.parcaKutuyaDeger(-10, 50, 30, 50, [0, 0, 10, 10]) === false);
  ok('G6 kutunun içinde kalan parça değmiş sayılır', M.parcaKutuyaDeger(2, 2, 8, 8, [0, 0, 10, 10]) === true);
  const kare = [[0, 0], [10, 0], [10, 10], [0, 10]];
  ok('G7 nokta çokgende', M.noktaCokgende(kare, 5, 5) === true && M.noktaCokgende(kare, 15, 5) === false);
  ok('G8 parça çokgene değiyor', M.parcaCokgeneDeger(-5, 5, 15, 5, kare) === true);
  ok('G9 uzaktaki parça çokgene değmez', M.parcaCokgeneDeger(-5, 50, 15, 50, kare) === false);
}

C.summary();
C.exit();
