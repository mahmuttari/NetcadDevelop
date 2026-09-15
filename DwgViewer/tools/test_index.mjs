// Uzamsal indeks (RTree) — eşdeğerlik ve ANA İŞ PARÇACIĞINI KİLİTLEMEME.
//
// Bu sınamanın sebebi somut bir kusurdur: indeks eskiden tek blok hâlinde kuruluyordu, büyük
// çizimde ana iş parçacığı saniyelerce donuyordu ve o süre boyunca bekleme görseli duruyor,
// Vazgeç düğmesi basılmıyordu. Buradaki ölçü "hızlı mı" değil, "ARADAN ÇIKIYOR MU"dur:
// requestAnimationFrame çağrıları arasındaki EN BÜYÜK boşluk, ekranın ne kadar süre donduğudur.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_index.mjs [çıktı]
import { args, startServer, launchBrowser, noUpdate, checker, PHONE } from './harness.mjs';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const N = 200000;          // gerçek büyük paftalarda ilkel sayısı bu mertebededir
const KILIT = 120;         // kabul edilen en uzun kilit (ms) — bunun üstü gözle "dondu" olur

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 780 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');

// --- A) eşdeğerlik: aradan çıkan kurucu, eşzamanlı kurucuyla BİREBİR aynı ağacı vermeli ----
{
  const r = await page.evaluate(async (n) => {
    const { RTree } = await import('./geom.js');
    // yinelenebilir sözde rastgele: sınama her koşuda aynı veriyi görsün
    let s = 123456789;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const items = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = rnd() * 1000, y = rnd() * 1000, w = rnd() * 12, h = rnd() * 12;
      items[i] = { bb: [x, y, x + w, y + h] };
    }
    const bbOf = (p) => p.bb;
    const a = new RTree(items, bbOf);
    const b = await RTree.build(items, bbOf, 16, {});
    // düğüm düğüm karşılaştırma: yaprak sırası bile aynı olmalı
    const imza = (nd, o) => { o.push(nd.bb.join(',')); if (nd.ch) for (const c of nd.ch) imza(c, o); else o.push('i' + nd.i); return o; };
    const ia = imza(a.root, []).join('|'), ib = imza(b.root, []).join('|');
    // arama sonuçları da birebir
    let fark = 0;
    for (let k = 0; k < 40; k++) {
      const x0 = rnd() * 950, y0 = rnd() * 950, w = 10 + rnd() * 120;
      const ra = a.collect(x0, y0, x0 + w, y0 + w).join(','), rb = b.collect(x0, y0, x0 + w, y0 + w).join(',');
      if (ra !== rb) fark++;
    }
    return { esit: ia === ib, uzunluk: ia.length, fark };
  }, N);
  ok('A1 aradan çıkan kurucu, eşzamanlı kurucuyla BİREBİR aynı ağacı kuruyor', r.esit, 'imza ' + r.uzunluk + ' karakter');
  ok('A2 40 rastgele aramada tek bir sonuç farkı yok', r.fark === 0, String(r.fark));
}

// --- B) kilit ölçümü: eşzamanlı kurucu donduruyor, aradan çıkan kurucu donmuyor ------------
const olc = (tur) => page.evaluate(async ({ n, tur }) => {
  const { RTree } = await import('./geom.js');
  let s = 987654321;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const items = new Array(n);
  for (let i = 0; i < n; i++) { const x = rnd() * 1000, y = rnd() * 1000; items[i] = { bb: [x, y, x + 8, y + 8] }; }
  const kare = [];
  let calis = true;
  const kay = (ts) => { kare.push(ts); if (calis) requestAnimationFrame(kay); };
  requestAnimationFrame(kay);
  await new Promise(r => setTimeout(r, 120));                 // ölçüm başlasın
  const bas = kare.length, t0 = performance.now();
  const yuzdeler = [];
  if (tur === 'sync') new RTree(items, p => p.bb);
  else await RTree.build(items, p => p.bb, 16, { onPct: (v) => yuzdeler.push(v) });
  const sure = performance.now() - t0;
  await new Promise(r => setTimeout(r, 120));
  calis = false;
  let enBuyuk = 0;
  for (let i = Math.max(1, bas); i < kare.length; i++) enBuyuk = Math.max(enBuyuk, kare[i] - kare[i - 1]);
  return { enBuyuk: Math.round(enBuyuk), sure: Math.round(sure), yuzdeler };
}, { n: N, tur });

const es = await olc('sync');
const as = await olc('async');
ok('B1 ESKİ yol gerçekten donduruyor (sınamanın ölçtüğü şey gerçek)', es.enBuyuk > KILIT,
  `en uzun kilit ${es.enBuyuk} ms · toplam ${es.sure} ms`);
ok(`B2 YENİ yol ${KILIT} ms'den uzun kilitlemiyor`, as.enBuyuk <= KILIT,
  `en uzun kilit ${as.enBuyuk} ms · toplam ${as.sure} ms`);
ok('B3 kilit en az dört kat kısaldı', es.enBuyuk >= as.enBuyuk * 4,
  `${es.enBuyuk} ms → ${as.enBuyuk} ms`);
ok('B4 yüzde bildirimi geliyor, geri gitmiyor ve 100\'e varıyor',
  as.yuzdeler.length > 3 && as.yuzdeler.every((v, i, a) => i === 0 || v >= a[i - 1] - 1e-9) && as.yuzdeler[as.yuzdeler.length - 1] === 100,
  `${as.yuzdeler.length} bildirim, son ${as.yuzdeler[as.yuzdeler.length - 1]}`);

// --- C) asıl istek: indeks kurulurken BEKLEME GÖRSELİ AKMAYA DEVAM ETMELİ -----------------
{
  const r = await page.evaluate(async (n) => {
    const { RTree } = await import('./geom.js');
    const el = document.getElementById('loading');
    el.hidden = false;
    window.dwgApp.__cadLoad(75, 'sinama.dwg');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
    const tara = () => { const a = document.querySelector('#loading .la-cad .scan').getAnimations()[0]; return a ? Number(a.currentTime) : -1; };
    let s = 5150;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const items = new Array(n);
    for (let i = 0; i < n; i++) { const x = rnd() * 1000, y = rnd() * 1000; items[i] = { bb: [x, y, x + 8, y + 8] }; }
    const c0 = tara(), w0 = performance.now();
    await RTree.build(items, p => p.bb, 16, { onPct: (v) => window.dwgApp.__cadLoad(70 + 22 * v / 100, 'sinama.dwg') });
    await new Promise(r => requestAnimationFrame(r));
    const c1 = tara(), w1 = performance.now();
    return { ilerleme: c1 - c0, gecen: w1 - w0, stage: el.dataset.cad,
      bar: document.getElementById('loadingFill').style.width,
      baslik: document.getElementById('loadingText').textContent };
  }, N);
  const oran = r.gecen > 0 ? r.ilerleme / r.gecen : 0;
  ok('C1 indeks kurulurken bekleme canlandırması akmaya devam ediyor',
    oran > 0.6, `canlandırma ${Math.round(r.ilerleme)} ms ilerledi, geçen süre ${Math.round(r.gecen)} ms (oran ${oran.toFixed(2)})`);
  // Görsel artık kendi döngüsünü oynar; ilerlemeyi METİN ile ÇUBUK gösterir. Denetim de
  // onları okur: indeks bandı boyunca aşama "optimize" olmalı ve çubuk 90'a yaklaşmalıdır.
  ok('C2 indeks boyunca aşama "optimize" ve çubuk ilerlemiş',
    r.stage === '3' && parseFloat(r.bar) > 85 && /optimize/i.test(r.baslik),
    `aşama=${r.stage} çubuk=${r.bar} başlık=${r.baslik}`);
}

ok('D sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
