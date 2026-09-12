// Düzenleyici sınaması (example_2000.dwg): çizim araçları, seç/taşı, geri al/yinele, döndür, alan ölçüsü, DXF kaydı, 3B mesafe.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_editor.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
import fs from 'node:fs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.accept('5'); });   // yerel prompt/confirm kalmadı; uygulama içi kutu queueAnswers ile cevaplanır
await page.goto(srv.url + 'index.html');
await openFile(page, `${SM}/example_2000.dwg`);
await page.evaluate(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const count = () => page.evaluate(() => window.dwgApp.state.scene.layouts[0].prims.length);
const zoom = async (bb) => { await page.evaluate((bb) => window.dwgApp.zoomExtents(bb), bb); await page.waitForTimeout(150); };
const tapWorld = async (x, y) => { await page.waitForTimeout(120); const s = await page.evaluate(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(150); };
const typed = async (v) => { await page.fill('#cmdInput', v); await page.click('#cmdEnter'); await page.waitForTimeout(100); };
const rectPos = () => page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'LWPOLYLINE'); return p.ops[0].slice(1, 3); });
const n0 = await count(); ok('1 başlangıç ilkel sayısı 338', n0 === 338, String(n0));   // 337 + MULTILEADER ok başı
await zoom([0, 0, 2000, 2000]);
await shot('e_toolbar_view');
// çizim: çizgi (yazılı koordinat, @uzunluk<açı, @dx,dy)
await page.click('#toolbar [data-tab="draw"]'); await shot('e_toolbar_draw');
await page.click('#toolbar [data-act="t:line"]');
ok('2a çizgi istemi', (await page.locator('#cmdText').innerText()) === 'Çizgi: Birinci noktayı seçin', await page.locator('#cmdText').innerText());
await typed('1000,1000'); await typed('@500<45'); await typed('@0,300'); await page.click('#cmdBtns [data-cmd="finish"]');
ok('2b iki çizgi eklendi (339)', await count() === n0 + 2, String(await count()));
// dikdörtgen dokunarak
await page.click('#toolbar [data-act="t:rect"]'); await tapWorld(200, 200); await tapWorld(600, 500);
ok('2c dikdörtgen eklendi (340)', await count() === n0 + 3, String(await count()));
// daire: merkez + yarıçap yazılı
await page.click('#toolbar [data-act="t:circle"]'); await tapWorld(1500, 400); await typed('150');
ok('2d daire eklendi (341)', await count() === n0 + 4, String(await count()));
// yazı (uygulama içi kutu kuyruğu: metin, yükseklik)
await queueAnswers(page, 'Deneme yazısı', '40'); await page.click('#toolbar [data-act="t:text"]');
await tapWorld(300, 1500);
ok('2e yazı eklendi (342)', await count() === n0 + 5, String(await count()));
{
  const t = await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'TEXT' && q.info && q.info.edited); return p ? [p.lines.join(' '), p.ent.h] : null; });
  ok('2f yazı metni ve yüksekliği giriş kutusundan geldi', t && t[0] === 'Deneme yazısı' && t[1] === 40, JSON.stringify(t));
}
await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
await shot('e_drawn');
// düzenle: seç + taşı
await page.click('#toolbar [data-tab="edit"]'); await page.click('#toolbar [data-act="t:move"]');
await tapWorld(400, 200); // dikdörtgen kenarı
{
  const sel = await page.evaluate(() => [...window.dwgApp.editor.sel].map(p => p.et + '/' + (p.ent ? p.ent.type : '-')));
  const cmd = await page.locator('#cmdText').innerText();
  ok('3a dokunarak dikdörtgen seçildi', sel.length === 1 && sel[0] === 'LWPOLYLINE/LWPOLYLINE' && /\[1 seçili\]/.test(cmd), sel.join(',') + ' ' + cmd);
}
await page.click('#cmdBtns [data-cmd="finish"]'); await typed('0,0'); await typed('@100,50');
{ const m = await rectPos(); ok('3b taşındı → (300, 250)', near(m[0], 300) && near(m[1], 250), JSON.stringify(m)); }
// geri al / yinele
await page.click('#toolbar .tb-row[data-for="edit"] [data-act="undo"]');
{ const m = await rectPos(); ok('3c geri al → (200, 200)', near(m[0], 200) && near(m[1], 200), JSON.stringify(m)); }
await page.click('#toolbar .tb-row[data-for="edit"] [data-act="redo"]');
{ const m = await rectPos(); ok('3d yinele → (300, 250)', near(m[0], 300) && near(m[1], 250), JSON.stringify(m)); }
// döndür (yazılı açı 90, merkez 0,0)
await page.click('#toolbar [data-act="t:rotate"]'); await tapWorld(500, 250); await page.click('#cmdBtns [data-cmd="finish"]'); await typed('0,0'); await typed('90');
{ const m = await rectPos(); ok('3e 90° döndürme → (-250, 300)', near(m[0], -250) && near(m[1], 300), JSON.stringify(m.map(Math.round))); }
{
  const log = await page.evaluate(() => JSON.parse(localStorage.getItem('edits:' + window.dwgApp.state.fileKey)).map(c => c.op).join(','));
  ok('3f düzenleme günlüğü: 5 ekleme + 2 dönüşüm', log === 'add,add,add,add,add,xform,xform', log);
}
await shot('e_edited');
// ölçü: alan (1000×1000 mm karesi)
await page.click('#toolbar [data-tab="measure"]'); await page.click('#toolbar [data-act="t:area"]'); await tapWorld(0, 0); await tapWorld(1000, 0); await tapWorld(1000, 1000); await tapWorld(0, 1000); await page.click('#cmdBtns [data-cmd="finish"]');
{
  const a = (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ');
  ok('4 alan ölçüsü: 1.000.000 mm², çevre 4.000 mm, 4 köşe, 1 m²', /Alan \| 1\.000\.000(,\d+)? mm²/.test(a) && a.includes('Çevre | 4.000 mm') && a.includes('Köşe | 4') && a.includes('Alan (m²) | 1 m²'), a.slice(0, 160));
}
await page.evaluate(() => window.dwgApp.onBack());
await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
// DXF kaydet (indirme) ve modül üzerinden yalnız düzenlenenler
{
  let size = -1, msg = '';
  try { const dl = page.waitForEvent('download', { timeout: 15000 }); await page.click('#toolbar [data-tab="view"]'); await page.click('#toolbar [data-act="savedxf"]'); const d = await dl; await d.saveAs(`${out}/edited.dxf`); size = fs.statSync(`${out}/edited.dxf`).size; } catch (e) { msg = e.message.slice(0, 80); }
  ok('5a DXF indirildi (> 100 KB)', size > 100000, size + ' ' + msg);
  const dxf = await page.evaluate(async () => { const m = await import('./edit.js'); const S = window.dwgApp.state; return m.writeDxf(S.scene.layouts[0].prims, S.layers, { onlyEdited: true }); });
  ok('5b yalnız düzenlenenler DXF\'i: LWPOLYLINE, CIRCLE, TEXT ve yazı metni', dxf.length > 1000 && dxf.includes('LWPOLYLINE') && dxf.includes('CIRCLE') && dxf.includes('Deneme yazısı'), 'uzunluk=' + dxf.length);
}
// 3B
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(500);
{
  const v = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); return v ? { lines: v.counts.lines, tris: v.counts.tris, verts: v.vertices.length, bb: v.bb.map(Math.round) } : null; });
  ok('6a 3B görünüm açıldı, sahne dolu', await page.locator('#cv3d').isVisible() && v && v.lines > 100000 && v.tris > 100 && v.verts > 1000, JSON.stringify(v));
}
await shot('e_3d_iso');
await page.click('#toolbar [data-act="v:top"]'); await page.waitForTimeout(200); await shot('e_3d_top');
// 3B mesafe: iki köşe (vertices[0] ve [3])
await page.click('#toolbar [data-act="3:dist"]');
const vs = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); const a = v.vertices[0], b = v.vertices[3]; return [v.project(a[0], a[1], a[2]), v.project(b[0], b[1], b[2])]; });
{ const r = await page.locator('#cv3d').boundingBox(); await page.touchscreen.tap(r.x + vs[0][0], r.y + vs[0][1]); await page.waitForTimeout(200); await page.touchscreen.tap(r.x + vs[1][0], r.y + vs[1][1]); await page.waitForTimeout(300); }
{
  const d = (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ');
  ok('6b 3B mesafe 646,248 mm, ΔZ 0', /3B mesafe \| 646,248 mm/.test(d) && /ΔZ \| 0 mm/.test(d), d.slice(0, 120));
}
await shot('e_3d_dist');
ok('7 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
