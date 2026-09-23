/*
 * 3B ETKİLEŞİM SADELEŞTİRMESİ MODELİ GÖRÜNMEZ KILAMAZ (v8.1).
 *
 * Kullanıcı bildirimi: "bir projede görüntü bir ara kayboldu, geldi." Sebep, ağır sahnelerde
 * hareket sırasında ağ YÜZEYLERİNİ atlayan sadeleştirmeydi: Gölgeli / Gerçekçi gibi kenar
 * ÇİZMEYEN stillerde (STYLES.shaded.edges === false) yüzey de kenar da çizilmeyince ekran
 * tamamen boşalıyor, parmak kalkınca 220 ms sonra tam kalitede yeniden çiziliyordu.
 *
 * Burada sınanan sözleşme üç maddedir:
 *   1) Geri düşülecek TEL KAFES YOKSA sadeleştirme HİÇ açılmaz.
 *   2) Açıldığında kenarlar zorla çizilir; ekranda boyalı piksel kalır (model kaybolmaz).
 *   3) Kaydedilen ekran görüntüsü hiçbir zaman sadeleştirilmiş kareden alınmaz.
 *
 * v8.7'DE (1)'İN KAPSAMI DARALDI. Kendi kenar dizisi (seg) boş gelen bir gövdeye artık
 * view3d._telKafesKenar üçgen indeksinden kenar ÜRETİR (kullanıcı bildirimi: "tel kafes
 * görünümde çizimin tamamını göstermiyor"). Dolayısıyla böyle bir gövde artık tel kafese
 * geri düşebilir ve sadeleştirme onda da açılır. Kenar üretilemeyen tek durum, üretimin
 * bellek sınırını (MESH_WIRE_MAX_TRI) aşan gövdedir; (1) yalnız orada geçerlidir.
 * Ayrıca 3B tuval ölçüsünün render()'ın kullandığı ölçüyle birebir olduğu doğrulanır: ayrışırsa
 * kamera uzaklığı her yeniden boyutlandırmada ikinci kez düzeltilir.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_3d_lod.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, WEBGL_ARGS } from './harness.mjs';
const { samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser({ args: WEBGL_ARGS });
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
await page.evaluate(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(700);

/*
 * Sahne kurulumu. Ağırlık ölçütü indeks SAYISIDIR (2.000.000), rasterleştirme yükü değil; bu
 * yüzden yük, hepsi aynı köşeye giden BOZUK (sıfır alanlı) üçgenlerle kurulur: sayaç eşiği aşar,
 * ekrana tek piksel düşmez, sınama saniyeler yerine milisaniyelerde koşar. Görünen geometri
 * ayrı bir küp ağıdır; kenar dizisi olan ve olmayan iki nüshası denenir.
 */
const R = await page.evaluate(() => {
  const V = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10];
  const F = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const seg = []; for (const [a, b] of E) seg.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2]);
  const base = (idx, sg) => ({ k: 5, vtx: new Float32Array(V), idx, seg: new Float32Array(sg),
    bb: [0, 0, 10, 10], zmin: 0, zmax: 10, face: true, alpha: 1, w: 0,
    col: 0xffffff, lay: '0', lt: null, lts: 1, lw: 0, info: { h: 'M1', t: 'POLYLINE_PFACE' }, et: 'POLYLINE_PFACE' });
  const kup = (sg) => base(new Uint32Array(F), sg);
  /*
   * Yük ilkeli: AYNI minik üçgen 700.001 kez yinelenir. Sıfır alanlı (bozuk) üçgen kullanılamaz —
   * normali tanımsız kalır, kırışıklık gruplaması her köşe için yeni grup açar ve setScene kareler
   * mertebesinde çalışır. Aynı üçgen ise tek normal verir: gruplama hızlı, rasterleştirme bir piksel.
   */
  const yuk = () => {
    const tri = new Float32Array([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0]);
    const I = new Uint32Array(700001 * 3);
    for (let i = 0; i < I.length; i += 3) { I[i] = 0; I[i + 1] = 1; I[i + 2] = 2; }
    const q = base(I, []); q.vtx = tri; return q;
  };
  const layers = new Map([['0', { name: '0', color: null, visible: true, lw: -1, lt: 'Continuous', count: 1 }]]);
  const v = window.dwgApp.editor.view3d();
  const boya = () => {
    const cv = v.cv, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, bg = [d[0], d[1], d[2]];
    let n = 0; for (let k = 0; k < d.length; k += 16) if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24) n++;
    return n;
  };
  const kur = (prims, stil) => {
    v.setScene(prims, layers, { dark: true });
    v.set('grid', false); v.set('axes', false); v.set('hud', false); v.set('persp', false); v.set('style', stil);
    v.preset('iso', { animate: false });
    v._lastFrameMs = 0; v._lastRenderAt = 0; v.render();
  };
  const surukle = () => { v._lastFrameMs = 9999; v._lastRenderAt = performance.now(); v.render(); };
  const o = {};
  // (1) kenarlı ağ + Gölgeli stil: sadeleştirme açılır ama tel kafes görünür
  kur([kup(seg), yuk()], 'shaded');
  o.kenarli = { meshIdx: v._nIdx.mesh, meshEdge: v._nMeshEdge, tam: boya() };
  surukle();
  o.kenarli.fast = !!v._fastFrame; o.kenarli.hizli = boya();
  // ekran görüntüsü: hemen ardından istense bile TAM kalite
  v._lastFrameMs = 9999; v._lastRenderAt = performance.now();
  const png = v.screenshot();
  o.kenarli.shotFast = !!v._fastFrame; o.kenarli.shotPng = typeof png === 'string' && png.startsWith('data:image/png');
  // (2) kenar dizisi BOŞ ağ: v8.7'den beri kenar üretilir, sadeleştirme güvenle açılır
  kur([kup([]), yuk()], 'shaded');
  o.kenarsiz = { meshIdx: v._nIdx.mesh, meshEdge: v._nMeshEdge, tam: boya() };
  surukle();
  o.kenarsiz.fast = !!v._fastFrame; o.kenarsiz.hizli = boya();
  // (3) tel kafes stili: eskiden de çalışıyordu, gerileme olmasın
  kur([kup(seg), yuk()], 'wireframe');
  surukle();
  o.telkafes = { fast: !!v._fastFrame, hizli: boya() };
  /*
   * (4) kenar ÜRETİLEMEYEN ağ (üretim sınırını aşan gövde): sadeleştirme hiç açılmamalı.
   * Sahne TEL KAFES stilinde ve PİKSEL OKUNMADAN kurulur: 700 bin üçgenin gölgeli basımı ve
   * yazılımsal geri okuması (ReadPixels) dördüncü sahnede oluşturucuyu düşürüyor. Tel kafeste
   * yüzey hiç çizilmez, sınanan sayaçlar (kenar üretildi mi, sadeleştirme açıldı mı) ise
   * stilden bağımsızdır; boyanın doluluğu (2) ve (3)'te ölçülüyor.
   */
  v.setScene([yuk()], layers, { dark: true });
  v.set('style', 'wireframe');
  o.uretilemez = { meshIdx: v._nIdx.mesh, meshEdge: v._nMeshEdge };
  surukle();
  o.uretilemez.fast = !!v._fastFrame;
  /*
   * Sahne HAFİF bırakılır (yalnız küp): bundan sonraki bölümler — tuval ölçüsü ve bağlam kaybı —
   * her yeniden çizimde 700 bin üçgeni yeniden yüklemesin; yazılımsal WebGL'de oluşturucu düşüyor.
   * Küpün 12 üçgeni (36 indeks) bağlam geri gelince ağ tamponunun yeniden kurulduğunu göstermeye
   * yeter (bkz. 7d): sınanan şey tamponun BÜYÜKLÜĞÜ değil, geri yüklenmiş olmasıdır.
   */
  v.setScene([kup(seg)], layers, { dark: true });
  v.set('style', 'wireframe'); v.render();
  return o;
});

ok('1a yük gerçekten ağır (indeks eşiği aşıldı)', R.kenarli.meshIdx > 2000000, String(R.kenarli.meshIdx));
ok('1b ağ kenarları sayıldı (tel kafes var)', R.kenarli.meshEdge === 24, String(R.kenarli.meshEdge));
ok('1c kenar dizisi boş gövdeye tel kafes ÜRETİLİYOR (küpün 12 kenarı)', R.kenarsiz.meshEdge === 24, String(R.kenarsiz.meshEdge));
ok('1d üretim sınırını aşan gövdede kenar üretilmiyor (bellek koruması)', R.uretilemez.meshEdge === 0, String(R.uretilemez.meshEdge));
ok('2a Gölgeli stilde sürüklemede sadeleştirme açılıyor', R.kenarli.fast === true, JSON.stringify(R.kenarli));
ok('2b sadeleştirilmiş kare BOŞ DEĞİL: kenarlar zorla çiziliyor', R.kenarli.hizli > 0, JSON.stringify({ tam: R.kenarli.tam, hizli: R.kenarli.hizli }));
ok('2c sadeleştirilmiş kare tam kareden daha seyrek (yüzeyler gerçekten atlandı)', R.kenarli.hizli < R.kenarli.tam, JSON.stringify({ tam: R.kenarli.tam, hizli: R.kenarli.hizli }));
ok('3a geri düşecek tel kafes yoksa sadeleştirme AÇILMIYOR', R.uretilemez.fast === false, JSON.stringify(R.uretilemez));
ok('3b kenarı ÜRETİLEN gövdede sadeleştirme açılır ve ekran BOŞALMAZ', R.kenarsiz.fast === true && R.kenarsiz.hizli > 0, JSON.stringify(R.kenarsiz));
ok('3c o sahnede sürükleme karesi tam kareden seyrek (yüzeyler atlandı, kenar kaldı)', R.kenarsiz.hizli < R.kenarsiz.tam, JSON.stringify({ tam: R.kenarsiz.tam, hizli: R.kenarsiz.hizli }));
ok('4 ekran görüntüsü sadeleştirilmiş kareden alınmıyor', R.kenarli.shotFast === false && R.kenarli.shotPng === true, JSON.stringify({ fast: R.kenarli.shotFast, png: R.kenarli.shotPng }));
ok('5 tel kafes stilinde sürükleme karesi yine dolu', R.telkafes.hizli > 0, JSON.stringify(R.telkafes));

// ---- tuval ölçüsü: render()'ın ölçüsüyle birebir; kamera uzaklığı ikinci kez düzeltilmiyor ----
await page.setViewportSize({ width: 380, height: 780 });   // gerçek yeniden boyutlandırma: ResizeObserver → resize() → editor.onResize()
await page.waitForTimeout(350);
const boyut = await page.evaluate(() => {
  const v = window.dwgApp.editor.view3d(), cv = v.cv, S = window.dwgApp.state;
  const w0 = cv.width, h0 = cv.height, d0 = v.cam.dist;
  v.render();
  return { w0, h0, w1: cv.width, h1: cv.height, d0, d1: v.cam.dist, bekW: Math.round(cv.clientWidth * S.dpr), bekH: Math.round(cv.clientHeight * S.dpr) };
});
ok('6a 3B tuval ölçüsü render ile aynı formülden', boyut.w0 === boyut.bekW && boyut.h0 === boyut.bekH, JSON.stringify(boyut));
ok('6b render tuvali yeniden boyutlandırmıyor', boyut.w1 === boyut.w0 && boyut.h1 === boyut.h0, JSON.stringify(boyut));
ok('6c kamera uzaklığı ikinci kez düzeltilmiyor', Math.abs(boyut.d1 - boyut.d0) < 1e-9, JSON.stringify({ d0: boyut.d0, d1: boyut.d1 }));

// ---- WebGL bağlam kaybı: kullanıcıya söylenir, tamponlar geri yüklenir ----
const baglam = await page.evaluate(async () => {
  const v = window.dwgApp.editor.view3d();
  const olaylar = [];
  const din = (e) => { if (e.detail && e.detail.key === 'context') olaylar.push(e.detail.value); };
  window.addEventListener('dwg:view3d', din);
  const x = v.gl.getExtension('WEBGL_lose_context');
  if (!x) { window.removeEventListener('dwg:view3d', din); return { yok: true }; }
  x.loseContext();
  await new Promise(r => setTimeout(r, 60));
  const kayip = { lost: v._lost, olay: olaylar.slice() };
  x.restoreContext();
  await new Promise(r => setTimeout(r, 400));
  window.removeEventListener('dwg:view3d', din);
  return { yok: false, kayip, sonra: { lost: v._lost, olaylar: olaylar.slice(), meshIdx: v._nIdx.mesh, u32: v.u32 } };
});
if (baglam.yok) ok('7 bağlam kaybı sınanamadı (WEBGL_lose_context yok)', true, 'atlandı');
else {
  ok('7a bağlam kaybında durum bildiriliyor', baglam.kayip.lost === true && baglam.kayip.olay.includes('lost'), JSON.stringify(baglam.kayip));
  ok('7b bağlam geri gelince kayıp bayrağı kalkıyor', baglam.sonra.lost === false, JSON.stringify(baglam.sonra));
  ok('7c geri gelince "kuruldu" ya da "yeniden kur" bildiriliyor', baglam.sonra.olaylar.some(v2 => v2 === 'restored' || v2 === 'rebuild'), JSON.stringify(baglam.sonra.olaylar));
  ok('7d ağ tamponu geri yüklendi (küpün 36 indeksi)', baglam.sonra.meshIdx === 36, String(baglam.sonra.meshIdx));
}

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
