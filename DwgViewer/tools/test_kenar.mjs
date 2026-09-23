// Ağ kenarı süzgeci (scene.meshEdges) sınaması — Playwright kullanmaz; depo kökünden
// "node tools/test_kenar.mjs" ile koşar.
//
// v8.9: kullanıcının "tel kafeste boru profiller görünmüyor" bildirimi iki okuyucu kusurunu ortaya
// çıkardı: (1) iki yüzün paylaştığı kenar, yüzlerden BİRİ gizli deyince atılıyordu — AutoCAD biri
// GÖRÜNÜR diyorsa çizer; (2) "kıymık yüz" eşiği (alan/çevre² > 0,0015) 6 m'lik borunun cidar fasetini
// kıymık sayıp normalini atıyor, kapak-cidar arasındaki 90°'lik halka bile düşüyor, kenar listesi
// tümden boşalıyordu. Burada üçü de sayıyla bağlanır; 20° kırışıklık kuralı (küp 12, boru cidarı
// halka dışı kenarsız) olduğu gibi kalır — cidar kenarlarını tel kafeste view3d çizer.
globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ getContext: () => null, style: {} }) };
const S = await import('../app/src/main/assets/viewer/scene.js');

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek === undefined ? '' : ' ' + ek)); } };

// ---- 1) uzun ince boru: cidar fasetleri kıymık sayılmaz, halka kenarları kalır ----------------
const boru = (n, R, H) => {
  const V = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; V.push([R * Math.cos(a), R * Math.sin(a), 0]); }
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; V.push([R * Math.cos(a), R * Math.sin(a), H]); }
  V.push([0, 0, 0], [0, 0, H]);
  const F = [];
  for (let i = 0; i < n; i++) { const a = i, b = (i + 1) % n, c = n + i, d = n + b; F.push([V[a], V[b], V[d], V[c]]); F.push([V[2 * n], V[b], V[a]]); F.push([V[2 * n + 1], V[c], V[d]]); }
  return F;
};
ok('1a 6 m × Ø200 boru (32 dilim): iki uç halkası = 64 kenar (eski kıymık kuralı 0 veriyordu)', S.meshEdges(boru(32, 0.1, 6)).length === 64, String(S.meshEdges(boru(32, 0.1, 6)).length));
ok('1b 12 m × Ø100 boru (64 dilim): 128 halka kenarı', S.meshEdges(boru(64, 0.05, 12)).length === 128, String(S.meshEdges(boru(64, 0.05, 12)).length));
ok('1c kısa kalın boru (16 dilim, 20° üstü cidar açısı 22,5°): halkalar + 16 boyuna = 48', S.meshEdges(boru(16, 1, 2)).length === 48, String(S.meshEdges(boru(16, 1, 2)).length));
// gerçek kıymık: üç köşesi neredeyse doğrusal bir yüz normalsiz kalmalı — komşu düz yüze sahte kırışıklık çizmemeli
{
  const duz = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];
  const kiymik = [[10, 0, 0], [10, 10, 0], [10.000001, 5, 0.0004]];   // düz kenarı paylaşan, hafif bükük iğne
  // paylaşılan kenar iki yüz arasında ama biri kıymık: iç kenar sayılır → düz yüzün 3 dış kenarı + kıymığın 2 dış kenarı = 5
  ok('1d gerçek kıymık normalsiz kalır: paylaşılan kenarda sahte kırışıklık çizilmez (5 kenar)', S.meshEdges([duz, kiymik]).length === 5, String(S.meshEdges([duz, kiymik]).length));
}

// ---- 2) gizli kenar bayrağı: VEYA kuralı --------------------------------------------------------
{
  const K = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const KF = [[K[0], K[3], K[2], K[1]], [K[4], K[5], K[6], K[7]], [K[0], K[1], K[5], K[4]], [K[1], K[2], K[6], K[5]], [K[2], K[3], K[7], K[6]], [K[3], K[0], K[4], K[7]]];
  const bos = () => KF.map(() => [false, false, false, false]);
  const H1 = bos(); H1[2][1] = true;                    // 1-5 kenarı yüz 2'de gizli, yüz 3'te görünür → çizilir
  const H2 = bos(); H2[2][1] = true; H2[3][3] = true;   // iki yüz de gizli diyor → çizilmez
  ok('2a küp, bayraksız: 12 kenar (çaprazsız)', S.meshEdges(KF).length === 12, String(S.meshEdges(KF).length));
  ok('2b tek yüz gizli diyor, komşu görünür: kenar ÇİZİLİR (12) — eski VE kuralı 11 veriyordu', S.meshEdges(KF, H1).length === 12, String(S.meshEdges(KF, H1).length));
  ok('2c iki komşu yüz de gizli diyor: kenar çizilmez (11)', S.meshEdges(KF, H2).length === 11, String(S.meshEdges(KF, H2).length));
  ok('2d bayrak dizisi eksik yüz (null) görünür sayılır', S.meshEdges(KF, [null, null, [false, true, false, false], null, null, null]).length === 12);
}

// ---- 3) eş düzlemli çaprazlar 20° kuralıyla elenmeye devam ediyor ------------------------------
{
  const A = [[0, 0, 0], [10, 0, 0], [10, 10, 0]], B = [[0, 0, 0], [10, 10, 0], [0, 10, 0]];
  ok('3 eş düzlemli iki üçgen: çapraz çizilmez, 4 dış kenar', S.meshEdges([A, B]).length === 4, String(S.meshEdges([A, B]).length));
}

console.log(`\nSONUÇ: ${g} geçti, ${k} kaldı`);
process.exit(k ? 1 : 0);
