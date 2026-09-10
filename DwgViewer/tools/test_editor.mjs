import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/')('playwright');
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const port = 8910, out = process.argv[2], SM = process.argv[3];
const srv = spawn(process.execPath, ['/home/user/NetcadDevelop/DwgViewer/tools/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
const answers = [];
page.on('dialog', async d => { await d.accept(answers.length ? answers.shift() : '5'); });
await page.goto(`http://localhost:${port}/index.html`);
await page.setInputFiles('#fileInput', `${SM}/example_2000.dwg`);
await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const count = () => page.evaluate(() => window.dwgApp.state.scene.layouts[0].prims.length);
const zoom = async (bb) => { await page.evaluate((bb) => window.dwgApp.zoomExtents(bb), bb); await page.waitForTimeout(150); };
const tapWorld = async (x, y) => { await page.waitForTimeout(120); const s = await page.evaluate(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(150); };
const typed = async (v) => { await page.fill('#cmdInput', v); await page.click('#cmdEnter'); await page.waitForTimeout(100); };
const n0 = await count(); console.log('prims start', n0);
await zoom([0, 0, 2000, 2000]);
await shot('e_toolbar_view');
// çizim: çizgi
await page.click('#toolbar [data-tab="draw"]'); await shot('e_toolbar_draw');
await page.click('#toolbar [data-act="t:line"]'); console.log('prompt', await page.locator('#cmdText').innerText());
await typed('1000,1000'); await typed('@500<45'); await typed('@0,300'); await page.click('#cmdBtns [data-cmd="finish"]');
console.log('after lines', await count());
// dikdörtgen dokunarak
await page.click('#toolbar [data-act="t:rect"]'); await tapWorld(200, 200); await tapWorld(600, 500); console.log('after rect', await count());
// daire: merkez + yarıçap yazılı
await page.click('#toolbar [data-act="t:circle"]'); await tapWorld(1500, 400); await typed('150'); console.log('after circle', await count());
// yazı
answers.push('Deneme yazısı', '40'); await page.click('#toolbar [data-act="t:text"]');
await tapWorld(300, 1500); console.log('after text', await count());
await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
await shot('e_drawn');
// düzenle: seç + taşı
await page.click('#toolbar [data-tab="edit"]'); await page.click('#toolbar [data-act="t:move"]');
await tapWorld(400, 200); // dikdörtgen kenarı
console.log('sel', await page.evaluate(() => [...window.dwgApp.editor.sel].map(p => p.et + '/' + p.key + '/' + (p.ent ? p.ent.type : '-')).join(',')), await page.locator('#cmdText').innerText());
await page.click('#cmdBtns [data-cmd="finish"]'); await typed('0,0'); await typed('@100,50');
const moved = await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'LWPOLYLINE'); return p.ops[0].slice(1, 3); }); console.log('rect moved to', moved);
// geri al / yinele
await page.click('#toolbar .tb-row[data-for="edit"] [data-act="undo"]'); console.log('undo', await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'LWPOLYLINE'); return p.ops[0].slice(1, 3); }));
await page.click('#toolbar .tb-row[data-for="edit"] [data-act="redo"]'); console.log('redo', await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'LWPOLYLINE'); return p.ops[0].slice(1, 3); }));
// döndür (yazılı açı), sil
await page.click('#toolbar [data-act="t:rotate"]'); await tapWorld(500, 250); await page.click('#cmdBtns [data-cmd="finish"]'); await typed('0,0'); await typed('90');
console.log('after rotate', await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'LWPOLYLINE'); return p.ops[0].slice(1, 3).map(v => Math.round(v)); }));
console.log('edit log', await page.evaluate(() => JSON.parse(localStorage.getItem('edits:' + window.dwgApp.state.fileKey)).map(c => c.op).join(',')));
await shot('e_edited');
// ölçü: alan
await page.click('#toolbar [data-tab="measure"]'); await page.click('#toolbar [data-act="t:area"]'); await tapWorld(0, 0); await tapWorld(1000, 0); await tapWorld(1000, 1000); await tapWorld(0, 1000); await page.click('#cmdBtns [data-cmd="finish"]');
console.log('area', (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ')); await page.evaluate(() => window.dwgApp.onBack());
await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
// DXF kaydet
try { const dl = page.waitForEvent('download', { timeout: 15000 }); await page.click('#toolbar [data-tab="view"]'); await page.click('#toolbar [data-act="savedxf"]'); const d = await dl; await d.saveAs(`${out}/edited.dxf`); console.log('dxf size', fs.statSync(`${out}/edited.dxf`).size); } catch (e) { console.log('dxf download:', e.message.slice(0, 80)); }
console.log('dxf via module', await page.evaluate(async () => { const m = await import('./edit.js'); const S = window.dwgApp.state; return m.writeDxf(S.scene.layouts[0].prims, S.layers, { onlyEdited: true }).length; }));
// 3B
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(500);
console.log('3d visible', await page.locator('#cv3d').isVisible(), await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); return v ? JSON.stringify({ lines: v.counts.lines, tris: v.counts.tris, verts: v.vertices.length, bb: v.bb.map(Math.round) }) : 'no'; }));
await shot('e_3d_iso');
await page.click('#toolbar [data-act="v:top"]'); await page.waitForTimeout(200); await shot('e_3d_top');
// 3B mesafe: iki köşe
await page.click('#toolbar [data-act="3:dist"]');
const vs = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); const a = v.vertices[0], b = v.vertices[3]; return [v.project(a[0], a[1], a[2]), v.project(b[0], b[1], b[2])]; });
{ const r = await page.locator('#cv3d').boundingBox(); await page.touchscreen.tap(r.x + vs[0][0], r.y + vs[0][1]); await page.waitForTimeout(200); await page.touchscreen.tap(r.x + vs[1][0], r.y + vs[1][1]); await page.waitForTimeout(300); }
console.log('3d dist', (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ').slice(0, 200));
await shot('e_3d_dist');
await browser.close(); srv.kill();
