// Katı modeller (AcDs / ASM), blok ekleme Z ötelemesi ve 3B en-boy oranı sınaması.
// Kullanım: PLAYWRIGHT_PKG=/opt/node22/lib/node_modules/ node tools/test_solids.mjs <çıktı> <örnekler>
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/')('playwright');
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2] || '/tmp/ui_solids', SM = process.argv[3] || '/home/user/NetcadDevelop/DwgViewer/samples', port = Number(process.argv[4] || (8940 + Math.floor(Math.random() * 30)));
fs.mkdirSync(out, { recursive: true });
const srv = spawn(process.execPath, ['/home/user/NetcadDevelop/DwgViewer/tools/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); };

// ---- sınama DXF'i: 100x100 3DFACE karesi (z=0) + Z=500'e eklenmiş, Z ölçeği 2 olan blok ----
const g = (c, v) => `${c}\n${v}\n`;
const dxf = g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1015') + g(0, 'ENDSEC') +
  g(0, 'SECTION') + g(2, 'BLOCKS') +
  g(0, 'BLOCK') + g(8, '0') + g(2, 'KUTU') + g(70, 0) + g(10, 0) + g(20, 0) + g(30, 0) + g(3, 'KUTU') +
  g(0, 'LINE') + g(8, '0') + g(10, 0) + g(20, 0) + g(30, 0) + g(11, 10) + g(21, 0) + g(31, 25) +
  g(0, 'ENDBLK') + g(8, '0') + g(0, 'ENDSEC') +
  g(0, 'SECTION') + g(2, 'ENTITIES') +
  g(0, '3DFACE') + g(8, '0') + g(10, 0) + g(20, 0) + g(30, 0) + g(11, 100) + g(21, 0) + g(31, 0) + g(12, 100) + g(22, 100) + g(32, 0) + g(13, 0) + g(23, 100) + g(33, 0) +
  g(0, 'INSERT') + g(8, '0') + g(2, 'KUTU') + g(10, 20) + g(20, 20) + g(30, 500) + g(41, 1) + g(42, 1) + g(43, 2) +
  g(0, 'ENDSEC') + g(0, 'EOF');
fs.writeFileSync(path.join(out, 'kare.dxf'), dxf);

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', async d => { await d.dismiss(); });

async function open(file) {
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForSelector('#btnOpen2');
  await page.evaluate(() => { try { localStorage.clear(); } catch (_) { /* geç */ } });
  await page.setInputFiles('#fileInput', file);
  await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 180000 });
  await page.evaluate(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });
  await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(700);
}
const info3d = () => page.evaluate(() => { const v = window.dwgApp.editor.view3d(); return v ? { lines: v.counts.lines, tris: v.counts.tris, bb: v.bb.map(x => +x.toFixed(2)), hud: v.hudText(), style: v.opts.style } : null; });
/** WebGL tuvalinde arka plan dışı piksellerin sınır kutusu (cihaz pikseli) */
const inkBox = () => page.evaluate(() => {
  const v = window.dwgApp.editor.view3d(); v.set('grid', false); v.set('axes', false); v.render();
  const cv = v.cv, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d'); g.drawImage(cv, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, bg = [d[0], d[1], d[2]];
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cw: cv.width, ch: cv.height, cssW: cv.clientWidth, cssH: cv.clientHeight, dpr: window.devicePixelRatio };
});

// ---- 1. blok Z ötelemesi ve en-boy oranı ----
await open(path.join(out, 'kare.dxf'));
let i = await info3d();
ok('1a 3B açıldı', !!i, JSON.stringify(i));
ok('1b blok Z ötelemesi (500 + 2·25 = 550)', i && Math.abs(i.bb[5] - 550) < 1e-6 && Math.abs(i.bb[2]) < 1e-6, i && i.bb.join(','));
await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); v.set('persp', false); v.set('style', 'shaded'); v.preset('top', { animate: false }); v.fit({ animate: false }); v.render(); });
await page.waitForTimeout(300);
let b = await inkBox();
ok('1c dikey: tuval = CSS × dpr', Math.abs(b.cw - b.cssW * b.dpr) <= 2 && Math.abs(b.ch - b.cssH * b.dpr) <= 2, JSON.stringify(b));
ok('1d dikey: kare kare kalır (en/boy 1 ± %2)', b.w > 100 && Math.abs(b.w / b.h - 1) < 0.02, `${b.w}x${b.h}`);
await page.screenshot({ path: `${out}/aspect_portrait.png` });
await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(400);
await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); v.fit({ animate: false }); v.render(); });
await page.waitForTimeout(300);
b = await inkBox();
ok('1e yatay: tuval = CSS × dpr', Math.abs(b.cw - b.cssW * b.dpr) <= 2 && Math.abs(b.ch - b.cssH * b.dpr) <= 2, JSON.stringify(b));
ok('1f yatay: kare kare kalır', b.w > 100 && Math.abs(b.w / b.h - 1) < 0.02, `${b.w}x${b.h}`);
await page.screenshot({ path: `${out}/aspect_landscape.png` });
// perspektifte de (üstten bakış, merkezde) kare kalmalı
await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); v.set('clip', [-1, -1, -1, 101, 101, 1]); v.set('persp', true); v.fit({ animate: false }); v.render(); });   // kesit: yalnız z≈0 karesi (yukarıdaki blok çizgisi perspektifte büyür)
await page.waitForTimeout(200);
b = await inkBox();
ok('1g perspektif üstten: kare kare kalır', b.w > 100 && Math.abs(b.w / b.h - 1) < 0.03, `${b.w}x${b.h}`);
await page.setViewportSize({ width: 412, height: 915 });

// ---- 2. AcDs katıları: 2013 ve 2018 örnekleri ----
for (const f of ['example_2013.dwg', 'example_2018.dwg']) {
  const fp = path.join(SM, f);
  if (!fs.existsSync(fp)) { console.log('SKIP', f, 'yok'); continue; }
  await open(fp);
  i = await info3d();
  const solids = await page.evaluate(() => { const by = {}; for (const p of window.dwgApp.state.scene.layouts[0].prims) if (p.tri && p.info) { const h = p.info.h; by[h] = by[h] || { t: p.info.t, tri: 0 }; by[h].tri++; } return by; });
  ok(`2 ${f}: üç katı (REGION 176, 3DSOLID 2E1, REGION 37D) üçgenlendi`, solids['176'] && solids['176'].tri === 2 && solids['2E1'] && solids['2E1'].tri === 24 && solids['37D'] && solids['37D'].tri === 2, JSON.stringify(solids));
  ok(`2 ${f}: katı yüzeyleri üçgenlendi (tris ≥ 165)`, i && i.tris >= 165, i && `tris=${i.tris} lines=${i.lines}`);
  ok(`2 ${f}: HUD "Yüzey yok" demiyor`, i && !/Yüzey yok/.test(i.hud), i && i.hud);
  const stylesDiffer = await page.evaluate(() => {
    const v = window.dwgApp.editor.view3d(); v.set('grid', false); v.set('axes', false); v.set('persp', false);
    const tris = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.tri);
    v.fitSelection(tris, { animate: false }); v.preset('iso', { animate: false });                      // katılara yaklaş: stil farkı ölçülebilsin
    const snap = (st) => { v.set('style', st); v.render(); const c = document.createElement('canvas'); c.width = v.cv.width; c.height = v.cv.height; const g = c.getContext('2d'); g.drawImage(v.cv, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const a = snap('wireframe'), b2 = snap('shaded'), c2 = snap('realistic'), d2 = snap('conceptual');
    const diff = (x, y) => { let n = 0; for (let k = 0; k < x.length; k += 16) if (Math.abs(x[k] - y[k]) + Math.abs(x[k + 1] - y[k + 1]) + Math.abs(x[k + 2] - y[k + 2]) > 30) n++; return n; };
    return { ws: diff(a, b2), sr: diff(b2, c2), sc: diff(b2, d2) };
  });
  ok(`2 ${f}: görsel stiller farklı görüntü üretiyor`, stylesDiffer.ws > 200 && stylesDiffer.sr > 50 && stylesDiffer.sc > 200, JSON.stringify(stylesDiffer));
  await page.screenshot({ path: `${out}/solid_${f.replace(/\W/g, '_')}.png` });
}

// ---- 3. AutoCAD yüzey varlıkları (2004, satır içi SAB; ACIS 20800): koni, tor, küre, düzlem, spline ----
{
  const fp = path.join(SM, 'Surface_2004.dwg');
  if (!fs.existsSync(fp)) console.log('SKIP Surface_2004.dwg yok');
  else {
    await open(fp);
    i = await info3d();
    const d = await page.evaluate(() => { const d = window.dwgApp.state.scene.solidDiag; return d ? { solids: d.solids, faces: d.faces, skipped: d.skipped, approx: d.approx, surfaces: d.surfaces, unknownTags: d.unknownTags, errors: d.errors } : null; });
    ok('3 Surface_2004: 5 yüzey varlığı okundu', d && d.solids === 5, JSON.stringify(d));
    ok('3 Surface_2004: bütün yüzler çözüldü (14 yüz, 0 atlandı, bilinmeyen etiket yok)', d && d.faces === 14 && d.skipped === 0 && d.unknownTags.length === 0 && d.errors.length === 0, d && `faces=${d.faces} skipped=${d.skipped} ${JSON.stringify(d.surfaces)} ${d.errors.join(';')}`);
    ok('3 Surface_2004: 3B üçgenler var, HUD "Yüzey yok" demiyor', i && i.tris > 100 && !/Yüzey yok/.test(i.hud), i && `tris=${i.tris} ${i.hud}`);
    await page.screenshot({ path: `${out}/surface_2004.png` });
  }
}

// ---- 4. çok yüzlü ağ (POLYFACE) ve çokgen ağ (POLYLINE_MESH): DXF yolu ve varsa dwgwrite ile üretilmiş DWG'ler ----
for (const f of ['pface.dxf', 'pface_2000.dwg', 'pface_2018.dwg']) {
  const fp = path.join(SM, f);
  if (!fs.existsSync(fp)) { console.log('SKIP', f, 'yok'); continue; }
  await open(fp);
  i = await info3d();
  const by = await page.evaluate(() => { const by = {}; for (const p of window.dwgApp.state.scene.layouts[0].prims) { const k = p.et + (p.tri ? ':tri' : ':path'); by[k] = (by[k] || 0) + 1; } return by; });
  const faceCount = (by['POLYFACE:path'] || 0) + (by['POLYLINE_PFACE:tri'] || 0) + (by['POLYLINE_MESH:path'] || 0) + (by['POLYLINE_MESH:tri'] || 0);
  ok(`4 ${f}: küp yüzleri ve ağ dörtgenleri sahnede`, faceCount >= 8, JSON.stringify(by));
  ok(`4 ${f}: 3B yüzeyler var, HUD "Yüzey yok" demiyor`, i && i.tris >= 12 && !/Yüzey yok/.test(i.hud), i && `tris=${i.tris} ${i.hud}`);
  if (f.endsWith('.dxf')) ok(`4 ${f}: sınır kutusu küp + ağ (0..30, 0..10, 0..10)`, i && Math.abs(i.bb[0]) < 1e-6 && Math.abs(i.bb[3] - 30) < 1e-6 && Math.abs(i.bb[5] - 10) < 1e-6, i && i.bb.join(','));
  else ok(`4 ${f}: DWG çok yüzlü ağ üçgenleri (küp 12 + örnek 2), kenarlar kırışıklık süzgeciyle (küp 12, ağ sınırı 6)`, by['POLYLINE_PFACE:tri'] === 14 && by['POLYLINE_PFACE:path'] === 15 && by['POLYLINE_MESH:tri'] === 4 && by['POLYLINE_MESH:path'] === 6, JSON.stringify(by));
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı; sayfa hataları: ${errors.length}`);
for (const e of errors) console.log('  hata:', e.slice(0, 200));
await browser.close(); srv.kill();
process.exit(fail ? 1 : 0);
