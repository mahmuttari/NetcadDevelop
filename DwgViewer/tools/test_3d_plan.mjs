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
  v.fit({ animate: false }); v.preset('top', { animate: false });
  v._lastFrameMs = 0; v._lastRenderAt = 0; v.render();
  const cv = v.cv, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, bg = [d[0], d[1], d[2]];
  const orta = ((c.height >> 1) * c.width + (c.width >> 1)) * 4;
  let n = 0; for (let k = 0; k < d.length; k += 16) if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24) n++;
  return { dolu: n, ortaDolu: Math.abs(d[orta] - bg[0]) + Math.abs(d[orta + 1] - bg[1]) + Math.abs(d[orta + 2] - bg[2]) > 24 };
});
ok('6 Z×8 düşey abartıda bile kule üstten dolu çiziliyor', px.dolu > 50 && px.ortaDolu === true, JSON.stringify(px));

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
