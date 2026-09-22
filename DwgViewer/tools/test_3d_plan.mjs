/*
 * PLAN (ÜSTTEN) GÖRÜNÜŞ SONSUZ YÜKSEKLİKTENDİR.
 *
 * Kullanıcı isteği: "Üstten bakışta varsayılan bakış yüksekliği sonsuz olmalı; model ne kadar
 * yüksek olursa olsun en tepeden bakılmalı." Haritacılıkta plan, tanımı gereği paralel
 * izdüşümdür: bakış sonsuzdan gelir, düşey kenarlar noktaya iner, ölçek her kotta aynıdır.
 *
 * İki eski davranış bunu bozuyordu:
 *   (1) Paralel izdüşümün derinlik aralığı SABİTTİ (uzaklık + 2,5 yarıçap). Modelin ölçekli
 *       yüksekliği bu payı aşınca — düşey abartı (Z×) 2,5'in üstündeyse ya da model çok
 *       yüksekse — üstten bakışta modelin ALTI kırpılıyordu.
 *   (2) Üst/alt ön ayarının eğimi 90°'den 1e-3 sapıyordu ve perspektif açıksa öyle kalıyordu:
 *       200 m'lik bir yapının tepesi planda 20 cm yana kayıyor, perspektifte ise göz sonlu
 *       yükseklikte kaldığı için yapılar dışa yatıyor, yakınlaşmışsa göz modelin içine giriyordu.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_3d_plan.mjs [çıktı] [örnekler]
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

// ---- ince ve YÜKSEK bir kule: tabanı 10 x 10, yüksekliği 200 ----------------------------------
const kur = await page.evaluate(() => {
  const V = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 200, 10, 0, 200, 10, 10, 200, 0, 10, 200];
  const F = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const seg = []; for (const [a, b] of E) seg.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2]);
  const prim = { k: 5, vtx: new Float32Array(V), idx: new Uint32Array(F), seg: new Float32Array(seg),
    bb: [0, 0, 10, 10], zmin: 0, zmax: 200, face: true, alpha: 1, w: 0,
    col: 0xffffff, lay: '0', lt: null, lts: 1, lw: 0, info: { h: 'K1', t: 'POLYLINE_PFACE' }, et: 'POLYLINE_PFACE' };
  const layers = new Map([['0', { name: '0', color: null, visible: true, lw: -1, lt: 'Continuous', count: 1 }]]);
  const v = window.dwgApp.editor.view3d();
  v.setScene([prim], layers, { dark: true });
  v.set('grid', false); v.set('axes', false); v.set('hud', false);
  v.set('persp', false); v.set('zScale', 1);
  v.fit({ animate: false }); v.preset('top', { animate: false }); v.render();
  return { bb: v.bb, radius: v.radius, pitch: v.cam.pitch, dist: v.cam.dist };
});
ok('1a kule kuruldu (yükseklik 200, taban 10)', Math.abs(kur.bb[5] - 200) < 1e-6 && Math.abs(kur.bb[3] - 10) < 1e-6, JSON.stringify(kur.bb));
ok('1b üst ön ayarın eğimi 90°ye 1e-5 kadar yakın (tam dik bakış)', Math.abs(kur.pitch - Math.PI / 2) < 1e-5, String(Math.PI / 2 - kur.pitch));

/** sekiz kutu köşesinin derinliği (NDC z) ve tepe-taban ekran kayması */
const olc = (zs) => page.evaluate((z) => {
  const v = window.dwgApp.editor.view3d();
  v.set('zScale', z); v.preset('top', { animate: false }); v.render();
  const bb = v.bb, d = [];
  for (let i = 0; i < 8; i++) d.push(v.project(i & 1 ? bb[3] : bb[0], i & 2 ? bb[4] : bb[1], i & 4 ? bb[5] : bb[2])[2]);
  const alt = v.project(0, 0, bb[2]), ust = v.project(0, 0, bb[5]);
  return { min: Math.min(...d), max: Math.max(...d), kayma: Math.hypot(ust[0] - alt[0], ust[1] - alt[1]), persp: v.cam.persp };
}, zs);

for (const zs of [1, 2.5, 5, 10]) {
  const r = await olc(zs);
  ok(`2 Z×${zs}: kutunun sekiz köşesi de derinlik aralığının İÇİNDE (kırpma yok)`,
    r.min >= -1 && r.max <= 1, JSON.stringify({ min: +r.min.toFixed(4), max: +r.max.toFixed(4) }));
}
{
  const r = await olc(1);
  ok('3 200 m yüksekliğin tepesiyle tabanı planda AYNI noktaya düşüyor (sonsuz yükseklik)',
    r.kayma < 0.05, r.kayma.toFixed(5) + ' px');
}

// ---- perspektif açıkken üst görünüşe geçiş: izdüşüm paralele alınır ---------------------------
const per = await page.evaluate(async () => {
  const v = window.dwgApp.editor.view3d();
  const olay = [];
  const din = (e) => { if (e.detail && (e.detail.key === 'planOrtho' || e.detail.key === 'persp')) olay.push(e.detail.key + '=' + e.detail.value); };
  window.addEventListener('dwg:view3d', din);
  v.set('persp', true); v.set('zScale', 1);
  v.preset('iso', { animate: false });
  const oncePersp = v.cam.persp;
  v.preset('top', { animate: false }); v.render();
  await new Promise(r => setTimeout(r, 60));
  window.removeEventListener('dwg:view3d', din);
  const bb = v.bb, alt = v.project(0, 0, bb[2]), ust = v.project(0, 0, bb[5]);
  return { oncePersp, sonraPersp: v.cam.persp, olay, kayma: Math.hypot(ust[0] - alt[0], ust[1] - alt[1]) };
});
ok('4a perspektif gerçekten açıktı', per.oncePersp === true);
ok('4b üst görünüşe geçince izdüşüm paralele alındı', per.sonraPersp === false, JSON.stringify(per));
ok('4c değişiklik bildiriliyor (planOrtho)', per.olay.some(x => x.startsWith('planOrtho')), per.olay.join(' '));
ok('4d perspektiften gelince de tepe ile taban aynı noktada', per.kayma < 0.05, per.kayma.toFixed(5) + ' px');

// ---- yan görünüşte perspektif KORUNUR: karar yalnız plan içindir ------------------------------
const yan = await page.evaluate(() => {
  const v = window.dwgApp.editor.view3d();
  v.set('persp', true); v.preset('front', { animate: false }); v.render();
  const p = v.cam.persp; v.set('persp', false);
  return p;
});
ok('5 ön görünüşte perspektife dokunulmuyor', yan === true, String(yan));

// ---- kule üstten gerçekten çiziliyor mu (piksel) ----------------------------------------------
const px = await page.evaluate(() => {
  const v = window.dwgApp.editor.view3d();
  v.set('persp', false); v.set('zScale', 8); v.set('style', 'shaded');
  // ÖNCE açı, SONRA kadraj: sığdırma bakış doğrultusuna bağlıdır (view3d._kadraj)
  v.preset('top', { animate: false }); v.fit({ animate: false });
  v._lastFrameMs = 0; v._lastRenderAt = 0; v.render();
  const cv = v.cv, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
  /*
   * Arka plan SOL ÜST PİKSELDEN alınamaz: kadraj düzeldikten sonra (v8.4, yön duyarlı sığdırma)
   * kule ekranın tamamını dolduruyor ve sol üst piksel de kulenin kendisi oluyor. Ölçüt, görünümün
   * KENDİ temizleme rengidir.
   */
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const bgf = v._bgColor(), bg = [Math.round(bgf[0] * 255), Math.round(bgf[1] * 255), Math.round(bgf[2] * 255)];
  const orta = ((c.height >> 1) * c.width + (c.width >> 1)) * 4;
  let n = 0; for (let k = 0; k < d.length; k += 16) if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24) n++;
  return { dolu: n, ortaDolu: Math.abs(d[orta] - bg[0]) + Math.abs(d[orta + 1] - bg[1]) + Math.abs(d[orta + 2] - bg[2]) > 24 };
});
ok('6 Z×8 düşey abartıda bile kule üstten dolu çiziliyor', px.dolu > 50 && px.ortaDolu === true, JSON.stringify(px));

/*
 * KADRAJ: SIĞDIRMA BAKIŞ DOĞRULTUSUNU OKUR (v8.4). Eski sığdırma sınır KÜRESİNİ kullanıyordu;
 * uzun ve ince bir modelde (dere güzergâhı gibi) model ekranın ortasında ince bir şerit hâlinde
 * kalıyor, ekranın büyük kısmı boş duruyordu. Kapalı biçimde türetilebilir bir tavanı vardı:
 * görünen pencere uzun ekranda 2,146·R/oran olduğundan model uzun ekseni EN ÇOK %41,96
 * doldurabiliyordu. Aşağıdaki denetim bu tavanı kırdığımızı sayıyla gösterir.
 */
{
  const kad = await page.evaluate(() => {
    const V = [0, 0, 0, 3000, 0, 0, 3000, 400, 0, 0, 400, 0, 0, 0, 20, 3000, 0, 20, 3000, 400, 20, 0, 400, 20];
    const F = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const seg = []; for (const [a, b] of E) seg.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2]);
    const prim = { k: 5, vtx: new Float32Array(V), idx: new Uint32Array(F), seg: new Float32Array(seg),
      bb: [0, 0, 3000, 400], zmin: 0, zmax: 20, face: true, alpha: 1, w: 0,
      col: 0xffffff, lay: '0', lt: null, lts: 1, lw: 0, info: { h: 'G1', t: 'POLYLINE_PFACE' }, et: 'POLYLINE_PFACE' };
    const layers = new Map([['0', { name: '0', color: null, visible: true, lw: -1, lt: 'Continuous', count: 1 }]]);
    const v = window.dwgApp.editor.view3d();
    v.setScene([prim], layers, { dark: true });
    v.set('grid', false); v.set('axes', false); v.set('hud', false); v.set('persp', false); v.set('zScale', 1);
    v.preset('top', { animate: false }); v.fit({ animate: false }); v.render();
    const W = v.cv.clientWidth, H = v.cv.clientHeight, bb = v.bb;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) { const p = v.project(i & 1 ? bb[3] : bb[0], i & 2 ? bb[4] : bb[1], i & 4 ? bb[5] : bb[2]);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    return { W, H, enOran: (x1 - x0) / W, boyOran: (y1 - y0) / H, tasma: x0 < -1 || y0 < -1 || x1 > W + 1 || y1 > H + 1 };
  });
  // Telefon dikey (412x915), model 3000x400: bağlayıcı eksen YATAYDIR, ekranın en az %80'ini doldurmalı
  ok('7a uzun ve ince model üstten bakışta ekranı dolduruyor (eski tavan %41,96)',
    kad.enOran > 0.8, `en %${Math.round(kad.enOran * 100)} · boy %${Math.round(kad.boyOran * 100)}`);
  ok('7b model ekranın dışına taşmıyor', kad.tasma === false, JSON.stringify(kad));
  // Yatay tuvalde de aynı: bağlayıcı eksen değişse de doluluk korunur
  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(350);
  const yat = await page.evaluate(() => {
    const v = window.dwgApp.editor.view3d();
    v.preset('top', { animate: false }); v.fit({ animate: false }); v.render();
    const W = v.cv.clientWidth, H = v.cv.clientHeight, bb = v.bb;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) { const p = v.project(i & 1 ? bb[3] : bb[0], i & 2 ? bb[4] : bb[1], i & 4 ? bb[5] : bb[2]);
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    return { enOran: (x1 - x0) / W, boyOran: (y1 - y0) / H, tasma: x0 < -1 || y0 < -1 || x1 > W + 1 || y1 > H + 1 };
  });
  ok('7c yatay tuvalde de doluluk korunuyor', yat.enOran > 0.8 && yat.tasma === false, `en %${Math.round(yat.enOran * 100)} · boy %${Math.round(yat.boyOran * 100)}`);
  await page.setViewportSize({ width: 412, height: 915 }); await page.waitForTimeout(300);
  // Kot farkı üstten bakışta GÖRÜNMEZ: yalnız Z'yi büyütmek kadrajı değiştirmemeli
  const z = await page.evaluate(() => {
    const v = window.dwgApp.editor.view3d();
    v.set('zScale', 1); v.preset('top', { animate: false }); v.fit({ animate: false });
    const d1 = v.cam.dist;
    v.set('zScale', 20); v.fit({ animate: false });
    return { d1, d2: v.cam.dist };
  });
  ok('7d düşey abartı üstten bakıştaki kadrajı değiştirmiyor (kot ekranda görünmez)',
    Math.abs(z.d2 - z.d1) / z.d1 < 0.02, JSON.stringify({ d1: Math.round(z.d1), d2: Math.round(z.d2) }));
}

/*
 * ÖN AYAR GÖRÜNÜŞ KADRAJI DA KURAR (v8.5).
 *
 * preset() eskiden yalnız AÇIYI yazıyordu; uzaklık ve hedef kullanıcının bıraktığı yerde kalıyordu.
 * Sığdırma v8.4'te bakış doğrultusuna bağlandığı için bu tutarsız hâle geldi: izometrikte
 * yakınlaşmış bir kullanıcı "Üst"e bastığında plan, izometrik için hesaplanmış uzaklıkla açılıyor
 * ve model ekranın ortasında küçük kalıyordu. AutoCAD'in ViewCube yüzü de öntanımlı olarak sığdırır.
 * Kural: DİK görünüşler (üst/alt/ön/arka/sol/sağ) kadrajı kurar, İZOMETRİK kurmaz (orada
 * yakınlaşma kullanıcının kararıdır), `{ fit:false }` her zaman kapatır.
 */
{
  const r = await page.evaluate(() => {
    const v = window.dwgApp.editor.view3d();
    v.set('persp', false); v.set('zScale', 1);
    v.preset('top', { animate: false }); v.render();
    const kadraj = { dist: v.cam.dist, tgt: v.cam.target.slice() };
    // kullanıcı yakınlaşıp kaydırmış olsun
    v.cam.dist = kadraj.dist / 12; v.cam.target[0] += 900; v.cam.target[1] -= 400; v.render();
    const bozuk = v.cam.dist;
    v.preset('top', { animate: false }); v.render();
    const sonra = { dist: v.cam.dist, tgt: v.cam.target.slice() };
    // izometrik: kadraj KURULMAZ
    v.cam.dist = bozuk; const izoOnce = v.cam.dist;
    v.preset('iso', { animate: false });
    const izo = v.cam.dist;
    // dik görünüşte de çağıran kapatabilir
    v.cam.dist = bozuk;
    v.preset('front', { animate: false, fit: false });
    const kapali = v.cam.dist;
    return { kadraj, bozuk, sonra, izoOnce, izo, kapali, uzaklikYardimci: v._kadrajUzakligi() };
  });
  ok('8a yakınlaşmış kullanıcı "Üst"e basınca kadraj yeniden kuruluyor',
    Math.abs(r.sonra.dist - r.kadraj.dist) / r.kadraj.dist < 0.02, JSON.stringify({ kadraj: Math.round(r.kadraj.dist), bozuk: Math.round(r.bozuk), sonra: Math.round(r.sonra.dist) }));
  ok('8b kaydırılan hedef de sığdırma merkezine dönüyor',
    Math.hypot(r.sonra.tgt[0] - r.kadraj.tgt[0], r.sonra.tgt[1] - r.kadraj.tgt[1]) < Math.max(1, r.kadraj.dist * 1e-3),
    JSON.stringify({ once: r.kadraj.tgt.map(Math.round), sonra: r.sonra.tgt.map(Math.round) }));
  ok('8c izometriğe geçiş yakınlaşmayı BOZMUYOR', Math.abs(r.izo - r.izoOnce) < 1e-6, JSON.stringify({ once: r.izoOnce, sonra: r.izo }));
  ok('8d { fit:false } dik görünüşte de kadrajı kapatıyor', Math.abs(r.kapali - r.bozuk) < 1e-6, JSON.stringify({ once: r.bozuk, sonra: r.kapali }));
}
/*
 * TUVAL YENİDEN BOYUTLANDIĞINDA TAŞINAN ÇARPAN, SIĞDIRMANIN KENDİ FORMÜLÜ OLMALI (v8.5).
 * Eski `_fitK` sınır küresine bakıyordu, v8.4 sığdırması ise bakış doğrultusuna: ekran
 * döndürülünce üst görünüş yanlış ölçekte kalıyordu. İkisi artık tek işlevdir.
 */
{
  const r = await page.evaluate(() => {
    const v = window.dwgApp.editor.view3d();
    v.preset('top', { animate: false });
    return { yardimci: v._kadrajUzakligi(), kadraj: v._kadraj(null).dist, dist: v.cam.dist };
  });
  ok('9a _kadrajUzakligi ile _kadraj aynı uzaklığı veriyor', Math.abs(r.yardimci - r.kadraj) < 1e-6, JSON.stringify(r));
  ok('9b ön ayar bu uzaklığa oturmuş', Math.abs(r.dist - r.kadraj) / r.kadraj < 0.02, JSON.stringify(r));
}

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
