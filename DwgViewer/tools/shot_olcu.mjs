// Ölçü özellikleri kutusunun ve düzenlenmiş ölçünün ekran görüntüsü (v7.56). Tasarımı gözle görmek içindir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_olcu.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
const { out, samples: SM } = args(import.meta.url);
fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; window.dwgApp.osnap.setModes([]); });
const tapWorld = async (x, y) => {
  await ev(() => { document.getElementById('toast').hidden = true; });
  const sc = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]);
  const r = await page.locator('#viewport').boundingBox();
  await page.touchscreen.tap(r.x + sc[0], r.y + sc[1]);
  await page.waitForTimeout(380);
};
// boş bir bölgede, okunur boyda üç ölçü: yatay, hizalı ve yarıçap
await ev(() => window.dwgApp.zoomExtents([4800, 4800, 5600, 5600]));
await page.waitForTimeout(250);
await page.click('#toolbar [data-tab="annot"]');
const arac = async (id) => { await ev((id) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); document.getElementById('infoPanel').hidden = true; E.act(id); }, id); await page.waitForTimeout(200); };
await arac('t:dimh'); await tapWorld(4900, 5000); await tapWorld(5300, 5000); await tapWorld(4900, 5120);
await arac('t:dim'); await tapWorld(4900, 5250); await tapWorld(5250, 5450); await tapWorld(4850, 5350);
await ev(() => window.dwgApp.editor.addEnts([{ type: 'CIRCLE', pts: [[5450, 5350, 0]], r: 90, layer: '0', color: 4 }]));
await arac('t:dimr'); await tapWorld(5513, 5413);
await ev(() => { window.dwgApp.editor.tools.cancel(); });
// uygulamanın kendi ölçüleri çizim boyutuna göre çok büyük yazı alır; kutuyla üçünü de okunur boya indir
const gids = await ev(() => { const ps = window.dwgApp.state.scene.layouts[0].prims; return [...new Set(ps.filter(p => p.info && p.info.gid && p.info.t === 'DIMENSION').map(p => p.info.gid))]; });
console.log('ölçü grupları', gids.length);
for (const g of gids) {
  await ev((g) => { const h = (window.__ask = window.__ask || { queue: [], log: [] }); h.queue.push({ h: 18, arrow: 14, exo: 4, exe: 8, prec: '1' }); const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.gid === g); return window.dwgApp.editor.tools.editDim(p); }, g);
  await page.waitForTimeout(150);
}
await ev(() => { document.getElementById('toast').hidden = true; });
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/olcu_1_uc_olcu.png` });
// özellikler kutusu: yatay ölçü seçili, seçim menüsünden "Ölçü özellikleri"
await ev((g) => { const E = window.dwgApp.editor; E.sel.clear(); for (const p of window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g)) E.sel.add(p); window.dwgApp.editor.selMenu(); }, gids[0]);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/olcu_2_secim_menusu.png` });
await page.click('#docBody [data-sm="dimedit"]');
console.log('kutu bekleniyor'); await page.waitForSelector('.ask-form', { timeout: 15000 });
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/olcu_3_ozellikler.png` });
// kutuyu gerçek girişle doldur: yazı "L = <>", son ek " mm", çarpan 0,1
await page.fill('#askF_text', 'L = <>'); await page.fill('#askF_suffix', ' mm'); await page.fill('#askF_factor', '0,1'); await page.selectOption('#askF_prec', '2');
await page.click('#askOk');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/olcu_4_sonuc.png` });
// dosyadan gelen ölçü: pface_full.dxf'in hizalı ölçüsü düzenlenir
await openFile(page, `${SM}/pface_full.dxf`, { settle: 400 });
await ev(() => { document.getElementById('toast').hidden = true; });
const fa = await ev(() => { const ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'DIMENSION' && p.info.dim && p.info.dim.type === 1); const h = ps[0].info.h; const g = ps.filter(p => p.info.h === h); const bb = g.reduce((b, p) => [Math.min(b[0], p.bb[0]), Math.min(b[1], p.bb[1]), Math.max(b[2], p.bb[2]), Math.max(b[3], p.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]); return { h, bb }; });
await ev((bb) => { const w = bb[2] - bb[0], h = bb[3] - bb[1]; window.dwgApp.zoomExtents([bb[0] - w * 0.6, bb[1] - h * 0.6, bb[2] + w * 0.6, bb[3] + h * 0.6]); }, fa.bb);
await page.waitForTimeout(300);
await ev((h) => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.h === h && q.info.t === 'DIMENSION'); void window.dwgApp.editor.tools.editDim(p); return true; }, fa.h);   // kutu açık kalır: söz beklenmez
console.log('kutu bekleniyor'); await page.waitForSelector('.ask-form', { timeout: 15000 });
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/olcu_5_dosya_olcusu.png` });
await page.fill('#askF_text', 'A = <>'); await page.fill('#askF_suffix', ' mm');
await page.click('#askOk');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/olcu_6_dosya_sonuc.png` });
for (const f of fs.readdirSync(out)) console.log('yazıldı', `${out}/${f}`);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
