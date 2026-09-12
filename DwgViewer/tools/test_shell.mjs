// Kabuk (C) kabul sınaması: şerit, sık kullanılan, katlama, Ekran sekmesi, alt sayfa, durum çubuğu, yatay/tablet, ui, i18n, tur, 3B küp
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_shell.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
const dialogs = []; onDialog(page, async d => { dialogs.push(d.message()); await d.accept('5'); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
await ev(() => localStorage.clear());
await page.reload(); await page.waitForSelector('#btnOpen2');
const load = async (f) => { await openFile(page, f, { settle: 900 }); };
await load(`${SM}/example_2000.dwg`);
// 45 tur
ok('45a tur görünür', await ev(() => !document.getElementById('tour').hidden));
await shot('s_tour');
await page.click('#tourSkip'); await page.waitForTimeout(100);
ok('45b atla → hints.tour', await ev(() => JSON.parse(localStorage.getItem('ui')).hints.tour === true && document.getElementById('tour').hidden));
await ev(() => { document.getElementById('toast').hidden = true; });
// 33 şerit
{
  const r = await ev(() => {
    const groups = document.querySelectorAll('#toolbar .tb-row[data-for="view"] .tb-group').length;
    const tiles = [...document.querySelectorAll('#toolbar .tb-row[data-for="view"] button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    const tabH = Math.min(...[...document.querySelectorAll('#toolbar .tb-tabs button')].map(b => b.getBoundingClientRect().height));
    const emoji = /\p{Extended_Pictographic}/u.test(document.getElementById('toolbar').textContent);
    const svg = [...document.querySelectorAll('#toolbar .tb-row button')].every(b => b.querySelector('svg.ic use'));
    return { groups, small: tiles.filter(t => t[0] < 56 || t[1] < 56), tabH, emoji, svg, n: tiles.length };
  });
  ok('33 şerit', r.groups >= 4 && r.small.length === 0 && r.tabH >= 40 && !r.emoji && r.svg, JSON.stringify(r));
  ok('3 seçiciler', await ev(() => ['[data-tab="view"]', '[data-tab="display"]', '[data-tab="measure"]', '[data-tab="draw"]', '[data-tab="edit"]', '[data-tab="3d"]', '.tb-row[data-for="edit"] [data-act="undo"]', '.tb-row[data-for="edit"] [data-act="redo"]', '#tbUndo', '#tbRedo', '#tbSave', '#tbLayer', '[data-act="3d"]', '[data-act="v:top"]', '[data-act="v:iso"]', '[data-act="3:dist"]', '[data-act="3:select"]', '[data-act="3:setz"]', '[data-act="3:pline"]', '[data-act="savedxf"]', '[data-act="t:line"]', '[data-act="t:rect"]', '[data-act="t:circle"]', '[data-act="t:text"]', '[data-act="t:move"]', '[data-act="t:rotate"]', '[data-act="t:area"]'].every(s => !!document.querySelector('#toolbar ' + s))));
}
// 34 uzun basış + sık kullanılan
{
  const b = await page.locator('#toolbar .tb-row[data-for="view"] [data-act="extents"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(150);
  ok('34a tbPop', await ev(() => !document.getElementById('tbPop').hidden && !!document.querySelector('#tbPop [data-fav]')));
  await shot('s_tbpop');
  await page.click('#tbPop [data-fav]'); await page.waitForTimeout(200);
  const r = await ev(() => ({ favs: JSON.parse(localStorage.getItem('ui')).favs, tab: !!document.querySelector('#toolbar [data-tab="fav"]'), tile: !!document.querySelector('#toolbar .tb-row[data-for="fav"] [data-act="extents"]') }));
  ok('34b fav', r.favs.includes('extents') && r.tab && r.tile, JSON.stringify(r));
  // hareketle iptal
  const b2 = await page.locator('#toolbar .tb-row[data-for="view"] [data-act="layers"]').boundingBox();
  await page.mouse.move(b2.x + 10, b2.y + 10); await page.mouse.down(); await page.mouse.move(b2.x + 30, b2.y + 10, { steps: 3 }); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(100);
  ok('34c hareket popover açmaz', await ev(() => document.getElementById('tbPop').hidden));
  await ev(() => { const p = document.getElementById('layerPanel'); if (!p.hidden) window.dwgApp.onBack(); });
  await page.click('#toolbar [data-tab="fav"]'); await page.waitForTimeout(100); await shot('s_fav_tab');
  await page.click('#toolbar [data-tab="view"]'); await page.waitForTimeout(100);
}
// 35 katlama
{
  const h0 = await ev(() => document.getElementById('viewport').getBoundingClientRect().height);
  await page.click('#toolbar [data-tab="view"]'); await page.waitForTimeout(250);
  const r = await ev(() => ({ col: document.getElementById('toolbar').classList.contains('collapsed'), rows: [...document.querySelectorAll('#toolbar .tb-row')].every(r => getComputedStyle(r).display === 'none'), h: document.getElementById('viewport').getBoundingClientRect().height, ui: JSON.parse(localStorage.getItem('ui')).tbCollapsed.portrait }));
  ok('35 katlama', r.col && r.rows && r.h - h0 >= 56 && r.ui === true, JSON.stringify({ ...r, h0 }));
  await shot('s_collapsed');
  await page.click('#toolbar [data-tab="view"]'); await page.waitForTimeout(250);
  ok('35b açılır', await ev(() => !document.getElementById('toolbar').classList.contains('collapsed')));
}
// 36 Ekran sekmesi
{
  await page.click('#toolbar [data-tab="display"]'); await page.waitForTimeout(150);
  const acts = await ev(() => [...document.querySelectorAll('#toolbar .tb-row[data-for="display"] [data-act]')].map(b => b.dataset.act));
  ok('36a 2B satırı', ['theme', 'sun', 'text', 'hatch', 'dim', 'lw', 'mono', 'grid', 'crosshair', 'fade', 'display'].every(a => acts.includes(a)), acts.join(','));
  await shot('s_display_tab');
  await page.click('#toolbar .tb-row[data-for="display"] [data-act="grid"]'); await page.waitForTimeout(150);
  ok('36b grid karo', await ev(() => window.dwgApp.state.grid.on === true && document.querySelector('#toolbar .tb-row[data-for="display"] [data-act="grid"]').classList.contains('on')));
  await page.click('#toolbar .tb-row[data-for="display"] [data-act="grid"]'); await page.waitForTimeout(100);
  await page.click('#toolbar .tb-row[data-for="display"] [data-act="theme"]'); await page.waitForTimeout(200);
  ok('36c tema karosu', await ev(() => window.dwgApp.state.dark === false));
  await shot('s_light_display');
  await page.click('#toolbar .tb-row[data-for="display"] [data-act="theme"]'); await page.waitForTimeout(200);
  await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(700);
  await page.click('#toolbar [data-tab="display"]'); await page.waitForTimeout(150);
  const acts3 = await ev(() => [...document.querySelectorAll('#toolbar .tb-row[data-for="display"] [data-act]')].map(b => b.dataset.act));
  ok('36d 3B satırı', ['vstyle', 'color3', 'grid3', 'axes3', 'zscale', 'clip3', 'turn3'].every(a => acts3.includes(a)), acts3.join(','));
  await shot('s_display_tab_3d');
  // 4 zscale prompt yok
  const nd = dialogs.length;
  await page.click('#toolbar .tb-row[data-for="display"] [data-act="zscale"]'); await page.waitForTimeout(300);
  ok('4 zscale popover', dialogs.length === nd && await page.locator('#tbPop input[type=range][data-key="zScale"]').isVisible());
  await shot('s_zscale_pop');
  await page.click('#tbPop [data-z="5"]'); await page.waitForTimeout(100);
  ok('4b z ×5', await ev(() => window.dwgApp.editor.view3d().zScale === 5));
  await ev(() => window.dwgApp.onBack()); // popover kapanır
  ok('4c back popover', await ev(() => document.getElementById('tbPop').hidden && window.dwgApp.editor.is3D()));
  // 21 küp
  const v = await ev(() => { const v3 = window.dwgApp.editor.view3d(); return { cube: !document.getElementById('cube3d').hidden, faces: document.querySelectorAll('#cube3d [data-face]').length }; });
  ok('21a küp görünür', v.cube && v.faces === 6, JSON.stringify(v));
  await page.click('#cube3d [data-face="top"]'); await page.waitForTimeout(450);
  ok('21b top', await ev(() => Math.abs(window.dwgApp.editor.view3d().cam.pitch - Math.PI / 2) < 0.01));
  await page.click('#cube3d [data-face="front"]'); await page.waitForTimeout(450);
  ok('21c front', await ev(() => Math.abs(window.dwgApp.editor.view3d().cam.yaw + Math.PI / 2) < 0.01), String(await ev(() => window.dwgApp.editor.view3d().cam.yaw)));
  await page.click('#cube3d [data-corner="isoNE"]'); await page.waitForTimeout(450);
  ok('21d isoNE', await ev(() => { const c = window.dwgApp.editor.view3d().cam; return Math.abs(c.yaw + Math.PI / 4) < 0.01 && Math.abs(c.pitch - 0.6155) < 0.01; }), await ev(() => JSON.stringify(window.dwgApp.editor.view3d().cam)));
  ok('38b stMode 3B', /^3B · (Paralel|Persp)$/.test((await page.locator('#stMode').innerText()).trim()), await page.locator('#stMode').innerText());
  await shot('s_3d_cube');
  // 32 display sheet 3B
  await page.click('#toolbar .tb-row[data-for="display"] [data-act="display"]'); await page.waitForTimeout(400);
  ok('32 3B sheet', await ev(() => !!document.querySelector('#displayPanel [data-seg="3d"].on') && !!document.querySelector('#displayBody .seg[data-key="style"]')));
  await shot('s_3d_sheet');
  await page.click('#displayBody .seg[data-key="style"] [data-val="shaded"]'); await page.waitForTimeout(200);
  ok('32b stil seg', await ev(() => window.dwgApp.editor.view3d().opts.style === 'shaded'));
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(100);
  // 30 yer imleri
  await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar .tb-row[data-for="3d"] [data-act="cam3"]'); await page.waitForTimeout(300);
  ok('30a cam panel', await ev(() => !!document.querySelector('#docPanel #camName') && !!document.querySelector('#docPanel #camSave')));
  await page.fill('#camName', 'Deneme'); await page.click('#camSave'); await page.waitForTimeout(200);
  ok('30b kaydedildi', await ev(() => JSON.parse(localStorage.getItem('cam3:' + window.dwgApp.state.fileKey)).length === 1 && !!document.querySelector('#docPanel .cam-item')));
  await shot('s_bookmarks');
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(100);
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(200);
  ok('3B kapandı', await ev(() => !window.dwgApp.editor.is3D()));
}
// 37 alt sayfa
{
  await ev(() => window.dwgApp.zoomExtents());
  await ev(() => { const S = window.dwgApp.state; const p = S.prims.find(q => q.k === 0); window.dwgApp.editor.select(null); window.dwgApp.state.selected = p; });
  await ev(() => { const p = window.dwgApp.state.prims.find(q => q.k === 0); window.dwgApp.editor.select(p); }); // seçim
  await ev(() => { const p = window.dwgApp.state.prims.find(q => q.k === 0); document.getElementById('infoPanel').hidden = false; });
  const r = await ev(() => ({ handle: !!document.querySelector('#infoPanel .sheet-handle'), detent: document.getElementById('infoPanel').dataset.detent }));
  ok('37a tutamak', r.handle && !!r.detent, JSON.stringify(r));
  const hb = await page.locator('#infoPanel .sheet-handle').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2, hb.y + 300, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
  ok('37b sürükle kapat', await ev(() => document.getElementById('infoPanel').hidden === true));
  await ev(() => { window.dwgApp.editor.select(null); window.dwgApp.state.selected = null; });
}
// 38 durum çubuğu
{
  const r = await ev(() => ({ h: document.getElementById('statusbar').getBoundingClientRect().height }));
  await page.click('#stQuick [data-quick="lw"]'); await page.waitForTimeout(150);
  const r2 = await ev(() => ({ lw: window.dwgApp.state.lw, on: document.querySelector('#stQuick [data-quick="lw"]').classList.contains('on') }));
  ok('38a stQuick lw', r.h >= 32 && r2.lw === true && r2.on, JSON.stringify({ r, r2 }));
  await page.click('#stQuick [data-quick="lw"]');
  await ev(() => window.dwgApp.setMode('measure')); await page.waitForTimeout(100);
  ok('38c stMode ölçü', /Ölçü/.test(await page.locator('#stMode').innerText()));
  await ev(() => window.dwgApp.setMode('view'));
}
// 41 yazı ölçeği, 42 sol el, 18 eldiven
{
  await ev(async () => { const m = await import('./editor.js'); m.ui.fontScale = 1.3; m.applyUi(); });
  await page.waitForTimeout(200);
  const r = await ev(() => ({ fs: getComputedStyle(document.getElementById('app')).getPropertyValue('--fs').trim(), ovf: [...document.querySelectorAll('.tb-row button .lb')].filter(l => l.scrollWidth > l.clientWidth + 1).length, top: document.getElementById('topbar').scrollWidth <= document.getElementById('topbar').clientWidth }));
  ok('41 yazı ölçeği', r.fs === '1.3' && r.ovf === 0 && r.top, JSON.stringify(r));
  await shot('s_fontscale');
  await ev(async () => { const m = await import('./editor.js'); m.ui.fontScale = 1; m.ui.leftHand = true; m.applyUi(); });
  await page.waitForTimeout(200);
  const l = await ev(() => ({ x: document.getElementById('navFabs').getBoundingClientRect().x, w: document.getElementById('viewport').getBoundingClientRect().width }));
  ok('42a sol el', l.x < l.w / 2, JSON.stringify(l));
  const vib = await ev(async () => { const m = await import('./editor.js'); let n = 0; navigator.vibrate = () => { n++; return true; }; m.ui.haptics = false; m.haptic('snap'); const a = n; m.ui.haptics = true; m.haptic('snap'); return [a, n]; });
  ok('42b titreşim kapalıyken vibrate yok', vib[0] === 0 && vib[1] === 1, JSON.stringify(vib));
  await ev(async () => { const m = await import('./editor.js'); m.ui.leftHand = false; m.ui.glove = true; m.applyUi(); });
  await page.waitForTimeout(150);
  ok('18 eldiven --tile', await ev(() => getComputedStyle(document.getElementById('app')).getPropertyValue('--tile').trim() === '64px'));
  await shot('s_glove');
  await ev(async () => { const m = await import('./editor.js'); m.ui.glove = false; m.applyUi(); });
}
// 43 tema tokenleri
{
  await ev(() => window.dwgApp.display.setDisplay('theme', 'sepia')); await page.waitForTimeout(150);
  const bg = await ev(() => getComputedStyle(document.body).getPropertyValue('--bg').trim());
  await ev(() => window.dwgApp.display.setDisplay('sun', true)); await page.waitForTimeout(150);
  const bw = await ev(() => getComputedStyle(document.querySelector('.tb-row button')).borderWidth);
  ok('43 tokenler', bg === '#f3e9d2' && parseFloat(bw) >= 2, JSON.stringify({ bg, bw }));
  await shot('s_sun');
  await ev(() => { window.dwgApp.display.setDisplay('sun', false); window.dwgApp.display.setDisplay('theme', 'dark'); });
}
// 44 ayarlar
{
  await page.click('#btnMore'); await page.click('#moreMenu [data-act="settings"]'); await page.waitForTimeout(200);
  ok('44 ayarlar', await ev(() => ['sCrs', 'sUnit', 'sDx', 'sDy', 'sSave', 'sLw'].every(id => !!document.getElementById(id)) && !!document.querySelector('#docBody .seg[data-key="fontScale"]')));
  await shot('s_settings');
  await page.click('#docBody .seg[data-key="fontScale"] [data-val="1.15"]'); await page.waitForTimeout(100);
  ok('44b fontScale seg', await ev(() => getComputedStyle(document.getElementById('app')).getPropertyValue('--fs').trim() === '1.15'));
  await page.click('#docBody .seg[data-key="fontScale"] [data-val="1"]');
  await ev(() => window.dwgApp.onBack());
}
// 47 i18n
{
  await ev(async () => { const i = await import('./i18n.js'); i.setLang('en'); i.applyI18n(); });
  const r = await ev(() => ({ tabs: [...document.querySelectorAll('#toolbar .tb-tabs [data-tab]')].map(b => b.textContent.trim()), raw: /(^|\s)(act\.|disp|v3|tab)[A-Z]\w*/.test(document.body.innerText) }));
  ok('47a en', r.tabs.includes('View') && r.tabs.includes('Display') && !r.raw, JSON.stringify(r));
  await ev(() => window.dwgApp.display.openDisplayOptions()); await page.waitForTimeout(200);
  ok('47b başlık en', (await page.locator('#displayTitle').innerText()) === 'Display options');
  await shot('s_en_sheet');
  await ev(() => window.dwgApp.onBack());
  await ev(async () => { const i = await import('./i18n.js'); i.setLang('tr'); i.applyI18n(); });
  ok('47c tr', (await page.locator('#displayTitle').innerText()) === 'Ekran ayarları');
}
// 46 dokunma hedefleri
for (const vp of [[412, 915], [360, 640]]) {
  await page.setViewportSize({ width: vp[0], height: vp[1] }); await page.waitForTimeout(300);
  await page.click('#btnMore'); await page.waitForTimeout(100);
  const bad = await ev(() => [...document.querySelectorAll('#toolbar button, #navFabs button, #statusbar button, .panel-head button, #cmdBtns button, #moreMenu button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40); }).map(b => (b.id || b.className || b.dataset.act || '?') + ':' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)));
  ok('46 hedefler ' + vp.join('x'), bad.length === 0, bad.join(' | ').slice(0, 300));
  await ev(() => window.dwgApp.onBack());
}
// 39 yatay
{
  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(500);
  const r = await ev(() => { const tb = document.getElementById('toolbar').getBoundingClientRect(), vp = document.getElementById('viewport').getBoundingClientRect(); return { w: tb.width, h: tb.height, vh: vp.height, x: tb.x }; });
  ok('39a yatay ray', r.w >= 100 && r.w <= 130 && r.h >= 250 && r.vh >= 330, JSON.stringify(r));
  await shot('s_landscape');
  await ev(async () => { const m = await import('./editor.js'); m.ui.leftHand = true; m.applyUi(); }); await page.waitForTimeout(300);
  const x = await ev(() => document.getElementById('toolbar').getBoundingClientRect().x);
  ok('39b sol el ray', x < 10, String(x));
  await shot('s_landscape_left');
  await ev(async () => { const m = await import('./editor.js'); m.ui.leftHand = false; m.applyUi(); });
}
// 40 tablet
{
  await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(500);
  const cap = await ev(() => getComputedStyle(document.querySelector('.tb-group .tb-caption')).display !== 'none');
  await page.click('#btnLayers'); await page.waitForTimeout(300);
  const r = await ev(() => ({ side: !document.getElementById('side').hidden, inSide: document.getElementById('layerPanel').parentElement.id === 'side' }));
  ok('40a tablet katman', cap && r.side && r.inSide, JSON.stringify({ cap, ...r }));
  await shot('s_tablet_layers');
  await page.click('#side .side-tabs [data-side="display"]'); await page.waitForTimeout(300);
  const r2 = await ev(() => ({ inSide: document.getElementById('displayPanel').parentElement.id === 'side', vis: !document.getElementById('displayPanel').hidden }));
  ok('40b tablet ekran', r2.inSide && r2.vis, JSON.stringify(r2));
  await shot('s_tablet_display');
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(200);
}
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
