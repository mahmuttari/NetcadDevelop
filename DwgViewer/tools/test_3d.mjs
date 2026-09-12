// 3B görünüm sınaması (test_tr.dxf): DXF kaydetme, 3B açma, mesafe, seçim + kot atama, yazılı 3B polyline, 2B'ye dönüş.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_3d.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
onDialog(page, async d => { await d.accept('7'); });
await page.goto(srv.url + 'index.html');
await openFile(page, `${SM}/test_tr.dxf`);
await page.evaluate(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); for (const l of window.dwgApp.state.layers.values()) l.visible = true; });
// DXF kaydet düğmesi hatasız çalışır ve indirme başlatır
{
  const dl = page.waitForEvent('download', { timeout: 10000 }).then(d => d.suggestedFilename(), () => null);
  const r = await page.evaluate(() => { try { const b = document.querySelector('#toolbar [data-act="savedxf"]'); b.click(); return 'ok'; } catch (e) { return 'ERR ' + e.message; } });
  const name = await dl;
  ok('1a DXF kaydet düğmesi', r === 'ok', r);
  ok('1b DXF indirmesi başladı (.dxf)', !!name && /\.dxf$/i.test(name), String(name));
}
// 3B
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(600);
{
  const v = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); return v ? { lines: v.counts.lines, tris: v.counts.tris, verts: v.vertices.length, bb: v.bb.map(x => Math.round(x)) } : null; });
  ok('2a 3B tuval görünür', await page.locator('#cv3d').isVisible());
  ok('2b 3B sahne kuruldu (15 üçgen köşesi, 75 köşe, çizgiler var)', v && v.tris === 15 && v.verts === 75 && v.lines > 0, JSON.stringify(v));   // tris köşe sayar: HATCH 3 üçgen (9) + 2 ölçü oku (6); köşe 63 + 3 ölçü çizgisi·2 + 2 ok·3
  ok('2c 3B sınır kutusu [100,80,0,540,160,52]', v && v.bb.join(',') === '100,80,0,540,160,52', v && v.bb.join(','));
}
await page.screenshot({ path: `${out}/e_3d_iso.png` });
await page.click('#toolbar [data-act="v:top"]'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/e_3d_top.png` });
await page.click('#toolbar [data-act="v:iso"]'); await page.waitForTimeout(200);
// 3B mesafe: ekranda görünen ilk iki köşe (B1 hattının iki ucu, z 52.4 / 51.9)
await page.click('#toolbar [data-act="3:dist"]');
const vs = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); const W = v.cv.clientWidth, H = v.cv.clientHeight; const seen = new Set(); const out = []; for (const a of v.vertices) { const s = v.project(a[0], a[1], a[2]); const k = Math.round(s[0]) + ',' + Math.round(s[1]); if (s[0] > 40 && s[0] < W - 40 && s[1] > 60 && s[1] < H - 60 && !seen.has(k)) { seen.add(k); out.push(s); } if (out.length === 2) break; } return out; });
ok('3a iki köşe ekranda bulundu', vs.length === 2, JSON.stringify(vs.map(s => s.slice(0, 2).map(Math.round))));
{ const r = await page.locator('#cv3d').boundingBox(); for (const s of vs) { await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(250); } }
{
  const txt = (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ');
  ok('3b 3B mesafe 107,704 m, ΔZ -0,5 m', /3B mesafe \| 107,704 m/.test(txt) && /ΔZ \| -0,5 m/.test(txt), txt.slice(0, 120));
  ok('3c uç noktalar (100;100;52,4) → (200;140;51,9)', txt.includes('100 ; 100 ; 52,4') && txt.includes('200 ; 140 ; 51,9'), txt.slice(120, 220));
}
await page.screenshot({ path: `${out}/e_3d_dist.png` });
await page.evaluate(() => window.dwgApp.onBack());
// 3B: seç + kot ata (giriş kutusu cevabı 7)
await page.click('#toolbar [data-act="3:select"]');
{ const r = await page.locator('#cv3d').boundingBox(); await page.touchscreen.tap(r.x + vs[0][0], r.y + vs[0][1]); await page.waitForTimeout(250); }
ok('4a 3B seçim: LINE', (await page.evaluate(() => [...window.dwgApp.editor.sel].map(p => p.et).join(','))) === 'LINE');
await queueAnswers(page, '7'); await page.click('#toolbar [data-act="3:setz"]'); await page.waitForTimeout(300);
{
  const z = await page.evaluate(() => [...window.dwgApp.state.scene.layouts[0].prims].filter(p => p.info && p.info.edited).map(p => p.et + ':' + JSON.stringify(p.ops ? p.ops.map(o => o[3]) : p.z)).join(' '));
  ok('4b kot atama: LINE her iki ucu z=7', z === 'LINE:[7,7]', z);
}
// 3B polyline yazılı
await page.click('#toolbar [data-act="3:pline"]'); await page.fill('#cmdInput', '100,100,50'); await page.click('#cmdEnter'); await page.fill('#cmdInput', '200,150,55'); await page.click('#cmdEnter'); await page.fill('#cmdInput', '300,100,60'); await page.click('#cmdEnter'); await page.click('#cmdBtns [data-cmd3="finish"]'); await page.waitForTimeout(300);
{
  const p = await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'POLYLINE3D'); return p ? JSON.stringify(p.ent.pts) : 'none'; });
  ok('5 3B polyline üç köşesiyle eklendi', p === '[[100,100,50],[200,150,55],[300,100,60]]', p);
}
await page.screenshot({ path: `${out}/e_3d_pline.png` });
await page.evaluate(() => window.dwgApp.onBack()); await page.waitForTimeout(200);
ok('6 2B görünüme dönüldü', await page.locator('#cv3d').isHidden());
await page.screenshot({ path: `${out}/e_2d_after.png` });
ok('7 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
