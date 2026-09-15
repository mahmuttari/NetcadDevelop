// 'cad' bekleme görselinin (yılan planı çizer → kıvrılıp surata döner) CSS'ini ÜRETİR.
//
// Neden üretici: bu canlandırmada üç şey aynı anda ve BİREBİR tutmak zorundadır — kalem
// başının konumu, arkasında kalan çizginin ucu ve yılanın gövde boyu. Elle yazılan keyframe
// yüzdelerinde bunlar kaçınılmaz olarak ayrışır (baş çizginin ucundan kopar, gövde duvarın
// içinde kalır). Burada tek bir "zaman → yol" eşlemesi kurulur, bütün keyframe'ler o
// eşlemeden türetilir; böylece ayrışma matematiksel olarak imkânsız hâle gelir.
//
// Kullanım: node tools/gen_loadart.mjs          → CSS'i ekrana basar
//           node tools/gen_loadart.mjs --yaz    → app.css'teki üretilmiş bloğu değiştirir
//           node tools/gen_loadart.mjs --json   → sınamanın okuduğu zaman çizgisini basar
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------------------
// GEOMETRİ (viewBox 0 0 120 120)
// ---------------------------------------------------------------------------------------
// Plan: 18..102 x 26..86 dış duvar + y=56'da iç bölme. Bu çizge Euler yolu taşır: iç bölmenin
// iki ucu (18,56) ve (102,56) tek tek dereceleri, ötekiler çift. Yol soldaki uçtan başlar,
// HİÇBİR duvarı iki kez geçmeden sağdaki uca varır — yılan kendi izine basmaz.
export const PLAN_D = 'M18 56 V86 H102 V26 H18 V56 H102';
const PLAN = [[18, 56], [18, 86], [102, 86], [102, 26], [18, 26], [18, 56], [102, 56]];

// Yüz çemberi: merkez (60,56), r=42 — yani TAM PLANIN GENİŞLİĞİ (18..102). Başlangıç noktası
// (102,56), planın bittiği noktanın kendisi: kalem durmadan devam eder, plan biter çember
// başlar. Saat 3'ten yukarı (ekranda saat yönünün tersi, sweep=0).
const FC = [60, 56], FR = 42;
export const FACE_D = `M102 56 A${FR} ${FR} 0 0 0 18 56 A${FR} ${FR} 0 0 0 102 56`;
const FACE_LEN = 2 * Math.PI * FR;

const segs = [];
for (let i = 1; i < PLAN.length; i++) {
  const [x0, y0] = PLAN[i - 1], [x1, y1] = PLAN[i];
  segs.push({ x0, y0, x1, y1, len: Math.abs(x1 - x0) + Math.abs(y1 - y0) });
}
const PLAN_LEN = segs.reduce((a, s) => a + s.len, 0);
/** Plan yolunda d uzaklığındaki nokta */
function planAt(d) {
  let r = Math.max(0, Math.min(PLAN_LEN, d));
  for (const s of segs) {
    if (r <= s.len) { const k = s.len ? r / s.len : 0; return [s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k]; }
    r -= s.len;
  }
  return [PLAN[PLAN.length - 1][0], PLAN[PLAN.length - 1][1]];
}
/** Çemberde s uzaklığındaki nokta (saat 3'ten yukarı) */
const faceAt = (s) => { const a = s / FR; return [FC[0] + FR * Math.cos(a), FC[1] - FR * Math.sin(a)]; };

// Yakalama düğümleri: planın BÜTÜN köşeleri. CAD'de kalem köşeye "snap" eder; duraklama da,
// gövdenin uzaması da oradadır. Ritim geometrinin kendisinden gelir — uzun duvar uzun bekler.
const NODES = [30, 114, 174, 258, 288];

// ---------------------------------------------------------------------------------------
// ZAMAN ÇİZGİSİ (yüzde; döngü DUR saniye)
// ---------------------------------------------------------------------------------------
export const DUR = 6.0;
const T_IN = 2.5;          // kalem başı belirir
const T_TRACE = 52.5;      // plan biter
const DWELL = 1.2;         // her köşede duraklama (72 ms) — "snap" hissi
const T_HOLD = 55.5;       // kıvrılma başlar (plan bitişi ile arasında bir soluk vardır)
const T_COIL = 72.5;       // çember kapanır
const T_ABSORB = 79.5;     // gövde suratın içine çekilir
// Plan bittiğinde kalem bir an DURUR ama kuyruk yürümeye devam eder: mürekkep oturur, biten
// plan temiz görünür ve kıvrılmadan önce bir hazırlık (anticipation) beati doğar.
const HOLD_ADV = 35;       // o soluk boyunca kuyruğun aldığı yol (kullanıcı birimi)
const L0 = 6, DL = 4;      // gövde boyu (plan pathLength birimi): 6, sonra her düğümde +4

const uPlan = PLAN_LEN / 100;      // 1 pathLength birimi kaç kullanıcı birimi (plan)
const uFace = FACE_LEN / 100;      // aynısı (çember)
const v0 = (T_TRACE - T_IN - DWELL * NODES.length) / PLAN_LEN;   // % / kullanıcı birimi

/** Baş: zaman → plan yolundaki uzaklık. Düğümlerde düz (duraklama). */
const headStops = [];
{
  let t = T_IN, d = 0;
  headStops.push([t, 0]);
  for (const n of NODES) {
    t += (n - d) * v0; d = n;
    headStops.push([t, d]); t += DWELL; headStops.push([t, d]);
  }
  t += (PLAN_LEN - d) * v0;
  headStops.push([t, PLAN_LEN]);
}
const tOfD = (d) => {           // düğüm duraklamaları dahil, d uzaklığına varış anı
  for (let i = 1; i < headStops.length; i++) {
    const [t0, d0] = headStops[i - 1], [t1, d1] = headStops[i];
    if (d <= d1 + 1e-9) return d1 === d0 ? t0 : t0 + (t1 - t0) * (d - d0) / (d1 - d0);
  }
  return headStops[headStops.length - 1][0];
};

/** Kuyruk: yılan oyununun kendi kuralı — yem yenince kuyruk DURUR, baş gitmeye devam eder,
 *  gövde o farktan uzar. Kuyruğu geri çekmek yerine bekletmek tek doğru olanı: gerçek
 *  yılanda da uzama arkadan eklenir, baş yerinden oynamaz.
 *
 *  Kuyruğun kırılma noktaları BAŞINKİLERLE aynı anlara konmak zorundadır (köşeye varış,
 *  duraklamanın sonu, uzamanın sonu). Aradaki düz parçalarda kuyruk başla aynı hızda gider,
 *  yani gövde boyu sabit kalır. Bir kırılma atlanırsa iki uç farklı hızda yürür ve boy
 *  görünmeden kayar — ilk yazımda tam bu olmuştu, sınama 6 yerine 7 okudu. */
const tailStops = [[T_IN, 0], [tOfD(L0 * uPlan), 0]];
{
  let boy = L0;
  for (const nd of NODES) {
    const kuyruk = nd - boy * uPlan;                  // varışta kuyruk = baş − boy
    tailStops.push([tOfD(nd), kuyruk]);               // köşeye varış
    tailStops.push([tOfD(nd) + DWELL, kuyruk]);       // duraklama: baş da kuyruk da durur
    boy += DL;
    // tOfD zaten kendinden önceki duraklamaları sayar; DWELL'i bir daha eklemek iki kez
    // saymak olur ve kuyruk uzama penceresinden sonra da donuk kalır.
    tailStops.push([tOfD(nd + DL * uPlan), kuyruk]);   // uzama: baş DL kadar gider, kuyruk durur
  }
  tailStops.push([T_TRACE, PLAN_LEN - boy * uPlan]);
}
function dOfT(t) {
  for (let i = 1; i < headStops.length; i++) {
    const [t0, d0] = headStops[i - 1], [t1, d1] = headStops[i];
    if (t <= t1 + 1e-9) return t1 === t0 ? d1 : d0 + (d1 - d0) * (t - t0) / (t1 - t0);
  }
  return PLAN_LEN;
}
const tailOfT = (t) => {
  if (t <= tailStops[0][0]) return 0;
  for (let i = 1; i < tailStops.length; i++) {
    const [t0, p0] = tailStops[i - 1], [t1, p1] = tailStops[i];
    if (t <= t1 + 1e-9) return t1 === t0 ? p1 : p0 + (p1 - p0) * (t - t0) / (t1 - t0);
  }
  return tailStops[tailStops.length - 1][1];
};

// Kıvrılma: hız çemberde yumuşakça artıp yine iner — v(σ) = v0 / (1 + A·sin(πσ)). σ=0 ve σ=1'de
// çarpan 1'dir, yani plandan çembere ve çemberden duruşa geçişte hız SIÇRAMAZ; aradaki
// hızlanma "kıvrım" hissini verir. A, kıvrılmanın tam bütçelenen süreyi tutması için çözülür.
function coilA() {
  const target = T_COIL - T_HOLD, base = FACE_LEN * v0;
  const integral = (A) => { let s = 0; const N = 2000; for (let i = 0; i < N; i++) { const q = (i + .5) / N; s += 1 / (1 + A * Math.sin(Math.PI * q)); } return s / N; };
  let lo = 0, hi = 8;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (base * integral(m) > target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const A = coilA();
/** σ (0..1) → zaman */
function coilT(sigma) {
  const N = 4000, base = FACE_LEN * v0;
  let s = 0; const steps = Math.round(sigma * N);
  for (let i = 0; i < steps; i++) { const q = (i + .5) / N; s += 1 / (1 + A * Math.sin(Math.PI * q)); }
  return T_HOLD + base * s / N;
}

// ---------------------------------------------------------------------------------------
// YARDIMCILAR
// ---------------------------------------------------------------------------------------
const n = (v, p = 3) => { const s = (+v).toFixed(p); return s.replace(/\.?0+$/, '') || '0'; };
const pc = (t) => n(t, 3) + '%';
const kf = (name, rows) => {
  const out = [];
  let prev = null;
  for (const [t, body] of rows) {
    if (prev === body) { out[out.length - 1].t.push(t); continue; }   // aynı değer → seçici birleşir
    out.push({ t: [t], body }); prev = body;
  }
  return `@keyframes ${name} {\n` + out.map(r => `  ${r.t.map(pc).join(', ')} { ${r.body} }`).join('\n') + '\n}';
};

// ---------------------------------------------------------------------------------------
// KEYFRAME ÜRETİMİ
// ---------------------------------------------------------------------------------------
const K = [];

// 1) Planın izi: dashoffset = 100 − baş yüzdesi. Baş ile aynı kırılma noktalarını kullandığı
//    için çizginin ucu HER KAREDE tam başın altındadır.
// 0% durağı ŞART: eksik olursa tarayıcı onu öğenin statik değerinden (tam çizili plan)
// türetir ve döngü, bir anlığına bitmiş planı gösterip geri sarar.
K.push(kf('snTrail', [
  [0, 'stroke-dashoffset: 100'],
  ...headStops.map(([t, d]) => [t, `stroke-dashoffset: ${n(100 - 100 * d / PLAN_LEN)}`]),
  [100, 'stroke-dashoffset: 0'],
]));

// 2) Gövde (plan): tek kesik parça. Boşluk (200) yoldan uzun tutulur; 100 verilseydi parça
//    yolun sonundan çıkarken baştan geri girer, yılan kendi kuyruğundan doğuyormuş gibi olurdu.
{
  const ts = [...new Set([...headStops.map(r => r[0]), ...tailStops.map(r => r[0])])].sort((a, b) => a - b);
  const rows = [[0, 'opacity: 0; stroke-dasharray: 0 200; stroke-dashoffset: 0']];
  for (const t of ts) {
    const p = 100 * dOfT(t) / PLAN_LEN, q = 100 * tailOfT(t) / PLAN_LEN;
    rows.push([t, `opacity: 1; stroke-dasharray: ${n(p - q)} 200; stroke-dashoffset: ${n(-q)}`]);
  }
  // Bekleme: baş (102,56)'da durur, kuyruk HOLD_ADV kadar ilerler — plan temizlenir
  const son = 100 * tailOfT(T_TRACE) / PLAN_LEN;
  rows.push([T_HOLD, `opacity: 1; stroke-dasharray: ${n(100 - son - 100 * HOLD_ADV / PLAN_LEN)} 200; stroke-dashoffset: ${n(-(son + 100 * HOLD_ADV / PLAN_LEN))}`]);
  // Çembere devir: gövdenin plan üstünde kalan kısmı, baş çemberde ilerledikçe erir
  const body = (L0 + DL * NODES.length) * uPlan - HOLD_ADV;   // kullanıcı birimi cinsinden gövde boyu
  for (let i = 1; i <= 12; i++) {
    const s = body * i / 12, t = coilT(s / FACE_LEN);
    const left = (body - s) / uPlan;
    rows.push([t, `opacity: 1; stroke-dasharray: ${n(left)} 200; stroke-dashoffset: ${n(left - 100)}`]);
  }
  rows.push([coilT(body / FACE_LEN) + .001, 'opacity: 0; stroke-dasharray: 0 200; stroke-dashoffset: -100'],
    [100, 'opacity: 0; stroke-dasharray: 0 200; stroke-dashoffset: 0']);
  K.push(kf('snBody', rows));
}

// 3) Kalem başı: plan üstünde parça parça doğrusal (köşeler kırılma noktası), çemberde
//    30 örnekle. Konum doğrudan yol geometrisinden geldiği için baş yoldan ÇIKAMAZ.
{
  const rows = [[0, 'opacity: 0; transform: translate(18px, 56px) scale(0)']];
  rows.push([T_IN, 'opacity: 1; transform: translate(18px, 56px) scale(1)']);
  for (const [t, d] of headStops) { const [x, y] = planAt(d); rows.push([t, `opacity: 1; transform: translate(${n(x)}px, ${n(y)}px) scale(1)`]); }
  rows.push([T_TRACE + (T_HOLD - T_TRACE) * .45, 'opacity: 1; transform: translate(102px, 56px) scale(1.28)'],
    [T_HOLD, 'opacity: 1; transform: translate(102px, 56px) scale(1)']);
  for (let i = 1; i <= 30; i++) {
    const sg = i / 30, t = coilT(sg), [x, y] = faceAt(sg * FACE_LEN);
    const op = t <= T_COIL - 2 ? 1 : Math.max(0, (T_COIL + 3 - t) / 5);
    rows.push([t, `opacity: ${n(Math.min(1, op), 2)}; transform: translate(${n(x)}px, ${n(y)}px) scale(1)`]);
  }
  rows.push([T_COIL + 3, 'opacity: 0; transform: translate(102px, 56px) scale(1)'],
    [T_COIL + 3.5, 'opacity: 0; transform: translate(18px, 56px) scale(0)'],
    [100, 'opacity: 0; transform: translate(18px, 56px) scale(0)']);
  K.push(kf('snHead', rows));
}

// 4) Yüz çemberi: aynı kalemin çizdiği iz; dashoffset yine başın ardından gelir.
{
  const rows = [[0, 'opacity: 0; stroke-dashoffset: 100'], [T_HOLD, 'opacity: 0; stroke-dashoffset: 100']];
  rows.push([T_HOLD + .001, 'opacity: 1; stroke-dashoffset: 100']);
  for (let i = 1; i <= 30; i++) rows.push([coilT(i / 30), `opacity: 1; stroke-dashoffset: ${n(100 - 100 * i / 30)}`]);
  rows.push([96.5, 'opacity: 1; stroke-dashoffset: 0'], [100, 'opacity: 0; stroke-dashoffset: 0']);
  K.push(kf('snRing', rows));
}

// 5) Gövde (çember): plandan devraldığı andan başlar, çember kapanınca kuyruk başı yakalar
//    ve gövde suratın içine çekilir.
{
  const bodyU = (L0 + DL * NODES.length) * uPlan - HOLD_ADV;
  const rows = [[0, 'opacity: 0; stroke-dasharray: 0 200; stroke-dashoffset: 0'],
  [T_HOLD, 'opacity: 0; stroke-dasharray: 0 200; stroke-dashoffset: 0'],
  [T_HOLD + .001, 'opacity: 1; stroke-dasharray: 0 200; stroke-dashoffset: 0']];
  for (let i = 1; i <= 30; i++) {
    const sg = i / 30, s = sg * FACE_LEN, t = coilT(sg);
    const head = 100 * sg, tail = Math.max(0, 100 * (s - bodyU) / FACE_LEN);
    rows.push([t, `opacity: 1; stroke-dasharray: ${n(head - tail)} 200; stroke-dashoffset: ${n(-tail)}`]);
  }
  const L = 100 * bodyU / FACE_LEN;
  for (let i = 1; i <= 8; i++) {                       // yutulma: yavaşlayarak (ease-out)
    const k = 1 - Math.pow(1 - i / 8, 3), t = T_COIL + (T_ABSORB - T_COIL) * (i / 8);
    rows.push([t, `opacity: 1; stroke-dasharray: ${n(L * (1 - k))} 200; stroke-dashoffset: ${n(-(100 - L * (1 - k)))}`]);
  }
  rows.push([T_ABSORB + .001, 'opacity: 0; stroke-dasharray: 0 200; stroke-dashoffset: -100'],
    [100, 'opacity: 0; stroke-dasharray: 0 200; stroke-dashoffset: 0']);
  K.push(kf('snCoil', rows));
}

// 6) Yakalama işaretleri (CAD'in uç nokta imi) ve halkası
NODES.forEach((d, i) => {
  const t = tOfD(d), inT = 3 + i * .4;
  K.push(kf('snSnap' + (i + 1), [
    [0, 'opacity: 0; transform: scale(.6)'], [inT, 'opacity: 0; transform: scale(.6)'],
    [inT + 2.5, 'opacity: 1; transform: scale(1)'], [t, 'opacity: 1; transform: scale(1)'],
    [t + 3, 'opacity: 0; transform: scale(1.9)'], [100, 'opacity: 0; transform: scale(.6)'],
  ]));
  K.push(kf('snPing' + (i + 1), [
    [0, 'opacity: 0; transform: scale(.5)'], [t, 'opacity: .55; transform: scale(.5)'],
    [t + 4, 'opacity: 0; transform: scale(2.3)'], [100, 'opacity: 0; transform: scale(.5)'],
  ]));
});

// 7) Plan grubu, surat grubu, gözler, ağız, son nefes
// 0%'da opaklık 0: döngü dikişinde grup sıçramasın. İz o anda zaten çizilmemiştir, yani
// ilk %1,5'te görünür bir şey yoktur — açılış görünmez, dikiş temiz kalır.
K.push(kf('snPlan', [[0, 'opacity: 0'], [1.5, 'opacity: 1'], [57, 'opacity: 1'], [65, 'opacity: 0'], [100, 'opacity: 0']]));
K.push(kf('snFace', [[0, 'opacity: 0'], [T_HOLD, 'opacity: 0'], [T_HOLD + .001, 'opacity: 1'],
[96.5, 'opacity: 1'], [100, 'opacity: 0']]));
K.push(kf('snEye1', [[0, 'opacity: 0; transform: scale(0)'], [79, 'opacity: 0; transform: scale(0)'],
[84, 'opacity: 1; transform: scale(1)'], [96.5, 'opacity: 1; transform: scale(1)'], [100, 'opacity: 0; transform: scale(0)']]));
K.push(kf('snEye2', [[0, 'opacity: 0; transform: scale(0)'], [80.5, 'opacity: 0; transform: scale(0)'],
[85.5, 'opacity: 1; transform: scale(1)'], [96.5, 'opacity: 1; transform: scale(1)'], [100, 'opacity: 0; transform: scale(0)']]));
K.push(kf('snMouth', [[0, 'opacity: 0; stroke-dashoffset: 100'], [83, 'opacity: 0; stroke-dashoffset: 100'],
[83.2, 'opacity: 1; stroke-dashoffset: 100'], [90, 'opacity: 1; stroke-dashoffset: 0'],
[100, 'opacity: 1; stroke-dashoffset: 0']]));
K.push(kf('snGreet', [[0, 'transform: scale(1)'], [89, 'transform: scale(1)'], [91.5, 'transform: scale(1.035)'],
[94, 'transform: scale(1)'], [100, 'transform: scale(1)']]));

// ---------------------------------------------------------------------------------------
// ÇIKTI
// ---------------------------------------------------------------------------------------
const zaman = {
  dur: DUR, planLen: PLAN_LEN, faceLen: FACE_LEN, planD: PLAN_D, faceD: FACE_D,
  tIn: T_IN, tTrace: T_TRACE, tHold: T_HOLD, tCoil: T_COIL, tAbsorb: T_ABSORB, dwell: DWELL, coilA: A, holdAdv: HOLD_ADV,
  nodes: NODES.map((d, i) => ({ d, t: tOfD(d), xy: planAt(d), i: i + 1 })),
  lens: [L0, ...NODES.map((_, i) => L0 + DL * (i + 1))],
  // sınama örnekleri: (zaman%, baş yol uzaklığı) — tarayıcıda getPointAtLength ile kıyaslanır
  ornek: Array.from({ length: 21 }, (_, i) => { const t = T_IN + (T_TRACE - T_IN) * i / 20; return { t, d: dOfT(t), tail: tailOfT(t) }; }),
};

const blok = '/* ÜRETİLMİŞ — tools/gen_loadart.mjs. Elle düzenlenmez; sayılar tek bir\n'
  + '   "zaman → yol" eşlemesinden türer, bkz. betiğin başındaki açıklama. */\n' + K.join('\n');

if (process.argv.includes('--json')) { console.log(JSON.stringify(zaman, null, 1)); }
else if (process.argv.includes('--yaz')) {
  const f = path.join(process.cwd(), 'app/src/main/assets/viewer/app.css');
  let css = fs.readFileSync(f, 'utf8');
  const bas = '/* >>> gen_loadart başlangıç */', son = '/* <<< gen_loadart bitiş */';
  const i = css.indexOf(bas), j = css.indexOf(son);
  if (i < 0 || j < 0) { console.error('app.css içinde gen_loadart işaretleri yok'); process.exit(1); }
  css = css.slice(0, i) + bas + '\n' + blok + '\n' + css.slice(j);
  fs.writeFileSync(f, css);
  console.log('app.css güncellendi: ' + K.length + ' keyframe');
} else console.log(blok);
