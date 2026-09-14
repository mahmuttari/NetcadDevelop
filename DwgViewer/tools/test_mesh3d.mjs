// Ağ ilkeli (k=5) 3B görünümde YÜZEY üretiyor mu — sahnede başka üçgen kaynağı YOKKEN.
// Bu senaryo gerçek bir hatayı yakalar: bütün yüzeyleri ağ ilkelinden gelen bir modelde
// (ör. 44.203 çok yüzlü ağdan oluşan çelik model) eski 'tris' tamponu boş kalır; yüzey çizimini
// o tamponun sayısına bakarak açan her kapı yanlışlıkla kapanır ve HUD "Yüzey yok" der.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_mesh3d.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, WEBGL_ARGS } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
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

// ---- yalnız ağ ilkelinden oluşan sentetik sahne (küp: 8 köşe, 12 üçgen, 12 kenar) ----------
const setup = await page.evaluate(() => {
  const V = [0,0,0, 10,0,0, 10,10,0, 0,10,0, 0,0,10, 10,0,10, 10,10,10, 0,10,10];
  const F = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  const E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const seg = [];
  for (const [a, b] of E) seg.push(V[a*3], V[a*3+1], V[a*3+2], V[b*3], V[b*3+1], V[b*3+2]);
  const prim = { k: 5, vtx: new Float32Array(V), idx: new Uint32Array(F), seg: new Float32Array(seg),
    bb: [0, 0, 10, 10], zmin: 0, zmax: 10, face: true, alpha: 1, w: 0,
    col: 0xffffff, lay: '0', lt: null, lts: 1, lw: 0, info: { h: 'M1', t: 'POLYLINE_PFACE' }, et: 'POLYLINE_PFACE' };
  const layers = new Map([['0', { name: '0', color: null, visible: true, lw: -1, lt: 'Continuous', count: 1 }]]);
  const v = window.dwgApp.editor.view3d();
  v.setScene([prim], layers, { dark: true });
  v.set('grid', false); v.set('axes', false); v.set('persp', false);
  v.preset('iso', { animate: false });
  v.render();
  return { nTris: v._n.tris, nMeshIdx: v._nIdx.mesh, countsTris: v.counts.tris, hud: v.hudText(), u32: v.u32 };
});
ok('1a 32 bit indeks uzantısı var (indeksli yol etkin)', setup.u32 === true, String(setup.u32));
ok('1b senaryo gerçek: eski üçgen tamponu BOŞ', setup.nTris === 0, String(setup.nTris));
ok('1c ağ indeks tamponu dolu (12 üçgen × 3)', setup.nMeshIdx === 36, String(setup.nMeshIdx));
ok('1d üçgen sayacı ağ tamponunu da sayıyor', setup.countsTris === 36, String(setup.countsTris));
ok('1e HUD "Yüzey yok" DEMİYOR', !/Yüzey yok|No faces/.test(setup.hud), setup.hud);

// ---- yüzeyler gerçekten çiziliyor mu: tel kafes ile gölgeli görüntü farklı olmalı --------------
const px = await page.evaluate(() => {
  const v = window.dwgApp.editor.view3d();
  v.zoom(1.4);
  const snap = (st) => {
    v.set('style', st); v._fastFrame = false; v.render();
    const cv = v.cv, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  const wf = snap('wireframe'), sh = snap('shaded'), re = snap('realistic');
  const diff = (x, y) => { let n = 0; for (let k = 0; k < x.length; k += 16) if (Math.abs(x[k] - y[k]) + Math.abs(x[k+1] - y[k+1]) + Math.abs(x[k+2] - y[k+2]) > 30) n++; return n; };
  // gölgeli görüntüde küpün ORTASI arka plandan farklı olmalı (yüzey dolu)
  const cw = v.cv.width, ch = v.cv.height, mid = ((ch >> 1) * cw + (cw >> 1)) * 4;
  const bg = [wf[0], wf[1], wf[2]];
  const filled = Math.abs(sh[mid] - bg[0]) + Math.abs(sh[mid+1] - bg[1]) + Math.abs(sh[mid+2] - bg[2]) > 30;
  return { wfSh: diff(wf, sh), shRe: diff(sh, re), filled };
});
ok('2a gölgeli görüntü tel kafesten farklı (yüzeyler çiziliyor)', px.wfSh > 200, String(px.wfSh));
ok('2b küpün ortası dolu (arka plan değil)', px.filled === true, JSON.stringify(px));

// ---- etkileşim sadeleştirmesi küçük sahneyi ETKİLEMEMELİ ---------------------------------------
const lod = await page.evaluate(() => {
  const v = window.dwgApp.editor.view3d();
  v._lastFrameMs = 9999; v._lastRenderAt = (performance.now ? performance.now() : Date.now());
  v.render();
  return { fast: !!v._fastFrame, meshIdx: v._nIdx.mesh };
});
ok('3 küçük sahnede sadeleştirme devreye girmiyor', lod.fast === false, JSON.stringify(lod));

C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
