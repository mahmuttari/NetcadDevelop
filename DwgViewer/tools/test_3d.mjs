import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/')('playwright');
import { spawn } from 'node:child_process';
const port = 8911, out = process.argv[2], SM = process.argv[3];
const srv = spawn(process.execPath, ['/home/user/NetcadDevelop/DwgViewer/tools/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 600));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('dialog', async d => { await d.accept('7'); });
await page.goto(`http://localhost:${port}/index.html`);
await page.setInputFiles('#fileInput', `${SM}/test_tr.dxf`);
await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); for (const l of window.dwgApp.state.layers.values()) l.visible = true; });
// DXF indirme hata ayıklama
console.log('dxf click', await page.evaluate(() => { try { const b = document.querySelector('#toolbar [data-act="savedxf"]'); b.click(); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }));
await page.waitForTimeout(500);
console.log('toast', await page.locator('#toast').innerText().catch(() => ''));
// 3B
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(600);
console.log('3d', await page.locator('#cv3d').isVisible(), await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); return v ? JSON.stringify({ lines: v.counts.lines, tris: v.counts.tris, verts: v.vertices.length, bb: v.bb.map(x => Math.round(x)) }) : 'no'; }));
await page.screenshot({ path: `${out}/e_3d_iso.png` });
await page.click('#toolbar [data-act="v:top"]'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/e_3d_top.png` });
await page.click('#toolbar [data-act="v:iso"]'); await page.waitForTimeout(200);
// 3B mesafe: B1 hattının iki ucu (z 52.4 / 51.9)
await page.click('#toolbar [data-act="3:dist"]');
const vs = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); const W = v.cv.clientWidth, H = v.cv.clientHeight; const seen = new Set(); const out = []; for (const a of v.vertices) { const s = v.project(a[0], a[1], a[2]); const k = Math.round(s[0]) + ',' + Math.round(s[1]); if (s[0] > 40 && s[0] < W - 40 && s[1] > 60 && s[1] < H - 60 && !seen.has(k)) { seen.add(k); out.push(s); } if (out.length === 2) break; } return out; });
console.log('vertex screens', JSON.stringify(vs));
{ const r = await page.locator('#cv3d').boundingBox(); for (const s of vs) { await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(250); } }
console.log('3d dist', (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ').slice(0, 220));
await page.screenshot({ path: `${out}/e_3d_dist.png` });
await page.evaluate(() => window.dwgApp.onBack());
// 3B: seç + kot ata
await page.click('#toolbar [data-act="3:select"]');
{ const r = await page.locator('#cv3d').boundingBox(); await page.touchscreen.tap(r.x + vs[0][0], r.y + vs[0][1]); await page.waitForTimeout(250); }
console.log('sel3d', await page.evaluate(() => [...window.dwgApp.editor.sel].map(p => p.et).join(',')));
await page.click('#toolbar [data-act="3:setz"]'); await page.waitForTimeout(300);
console.log('setz', await page.evaluate(() => [...window.dwgApp.state.scene.layouts[0].prims].filter(p => p.info && p.info.edited).map(p => p.et + ':' + JSON.stringify(p.ops ? p.ops.map(o => o[3]) : p.z)).join(' ')));
// 3B polyline yazılı
await page.click('#toolbar [data-act="3:pline"]'); await page.fill('#cmdInput', '100,100,50'); await page.click('#cmdEnter'); await page.fill('#cmdInput', '200,150,55'); await page.click('#cmdEnter'); await page.fill('#cmdInput', '300,100,60'); await page.click('#cmdEnter'); await page.click('#cmdBtns [data-cmd3="finish"]'); await page.waitForTimeout(300);
console.log('pline3d', await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'POLYLINE3D'); return p ? JSON.stringify(p.ent.pts) : 'none'; }));
await page.screenshot({ path: `${out}/e_3d_pline.png` });
await page.evaluate(() => window.dwgApp.onBack()); await page.waitForTimeout(200);
console.log('back to 2d', await page.locator('#cv3d').isHidden());
await page.screenshot({ path: `${out}/e_2d_after.png` });
await browser.close(); srv.kill();
