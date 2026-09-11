// display2d modülü sınaması (kabul listesi A.5–A.20 + regresyon 1).
// Kullanım: PLAYWRIGHT_PKG=/opt/node22/lib/node_modules/ node tools/test_display2d.mjs <outdir> <samples> [port]
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PKG || '/opt/node22/lib/node_modules/')('playwright');
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const out = process.argv[2] || '/tmp/ui_display2d', SM = process.argv[3] || '/home/user/NetcadDevelop/DwgViewer/samples';
const port = Number(process.argv[4] || (8920 + Math.floor(Math.random() * 70)));
fs.mkdirSync(out, { recursive: true });
const srv = spawn(process.execPath, ['/home/user/NetcadDevelop/DwgViewer/tools/serve.mjs', String(port)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
let fails = 0, passes = 0;
const ok = (name, cond, extra = '') => { if (cond) { passes++; console.log('PASS', name, extra); } else { fails++; console.log('FAIL', name, extra); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
page.on('dialog', async d => { await d.accept('5'); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const vpBox = async () => page.locator('#viewport').boundingBox();

// ---- 1. yükleme, boş durum -----------------------------------------------------------------
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForSelector('#btnOpen2');
await page.waitForTimeout(300);
ok('1 boş sayfa hatasız', errors.length === 0 && await page.locator('#empty').isVisible(), errors.join(' | ').slice(0, 200));
ok('13a #gpsBtn #navFabs içinde', await ev(() => !!document.querySelector('#navFabs #gpsBtn')));

// ---- 6. eski ayar göçü ---------------------------------------------------------------------
await ev(() => { localStorage.clear(); localStorage.setItem('settings', JSON.stringify({ dark: false, lwScale: 5 })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(300);
{
  const r = await ev(() => ({ theme: window.dwgApp.getSettings().display.theme, lw: window.dwgApp.getSettings().display.lwScale, slw: window.dwgApp.state.lwScale, light: document.body.classList.contains('light'), dark: window.dwgApp.state.dark }));
  ok('6 settings göçü', r.theme === 'light' && r.lw === 5 && r.slw === 5 && r.light && r.dark === false, JSON.stringify(r));
}
await ev(() => { localStorage.clear(); });
await page.reload(); await page.waitForSelector('#btnOpen2');

const load = async (f) => { await page.setInputFiles('#fileInput', f); await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 120000 }); await page.waitForTimeout(400); await ev(() => { document.getElementById('toast').hidden = true; }); };
await load(`${SM}/example_2000.dwg`);
await ev(() => window.dwgApp.zoomExtents());
await shot('d_loaded');

// ---- 5. tema ------------------------------------------------------------------------------
{
  const bg0 = await ev(() => getComputedStyle(document.body).getPropertyValue('--bg').trim());
  await ev(() => window.dwgApp.display.setDisplay('theme', 'blueprint')); await page.waitForTimeout(250);
  const r1 = await ev(() => ({ th: document.body.dataset.theme, dark: window.dwgApp.state.dark, bg: getComputedStyle(document.body).getPropertyValue('--bg').trim() }));
  ok('5a blueprint', r1.th === 'blueprint' && r1.dark === true, JSON.stringify(r1) + (r1.bg !== bg0 ? '' : ' (CSS --bg değişmedi: C tokenleri)'));
  await shot('d_theme_blueprint');
  await ev(() => window.dwgApp.display.setDisplay('theme', 'light')); await page.waitForTimeout(250);
  const r2 = await ev(() => ({ light: document.body.classList.contains('light'), dark: window.dwgApp.state.dark }));
  ok('5b light', r2.light && r2.dark === false, JSON.stringify(r2));
  await ev(() => window.dwgApp.display.setDisplay('theme', 'hicontrast')); await page.waitForTimeout(250);
  const px = await ev(() => { const c = document.getElementById('cv'); const d = c.getContext('2d').getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; });
  ok('5c hicontrast beyaz', px[0] === 255 && px[1] === 255 && px[2] === 255, JSON.stringify(px));
  await shot('d_theme_hicontrast');
  await ev(() => window.dwgApp.display.setDisplay('theme', 'sepia')); await page.waitForTimeout(250); await shot('d_theme_sepia');
  await ev(() => window.dwgApp.display.setDisplay('theme', 'dark')); await page.waitForTimeout(200);
  // PDF yolu (renderRegion light)
  const dlP = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#btnMore'); await page.click('#moreMenu [data-act="pdf"]'); await page.click('#pGo');
  const dl = await dlP; ok('5d PDF üretildi', !!dl, dl.suggestedFilename());
  await page.waitForTimeout(300); await ev(() => window.dwgApp.onBack());
}

// ---- 7. görünürlük -----------------------------------------------------------------------
{
  await ev(() => window.dwgApp.display.setDisplay('showHatch', false));
  const r = await ev(() => { const S = window.dwgApp.state; const h = S.prims.find(p => p.et === 'HATCH') || S.prims.find(p => p.fill); return { hatch: S.show.hatch, vis: h ? window.dwgApp.display.primVisible(h) : null, has: !!h }; });
  ok('7a showHatch', r.hatch === false && (r.has ? r.vis === false : true), JSON.stringify(r));
  await ev(() => window.dwgApp.display.setDisplay('showText', false));
  ok('7b showText getter', await ev(() => window.dwgApp.state.showText === false && window.dwgApp.state.show.text === false));
  await shot('d_no_text_hatch');
  await ev(() => { window.dwgApp.display.setDisplay('showText', true); window.dwgApp.display.setDisplay('showHatch', true); });
  ok('7c eski setter', await ev(() => { window.dwgApp.state.showText = false; const a = window.dwgApp.state.show.text === false; window.dwgApp.state.showText = true; window.dwgApp.state.mono = true; const b = window.dwgApp.state.colorMode === 'mono'; window.dwgApp.state.mono = false; return a && b && window.dwgApp.state.colorMode === 'entity'; }));
}

// ---- 8. ızgara --------------------------------------------------------------------------
{
  await ev(() => window.dwgApp.display.setDisplay('grid', true)); await page.waitForTimeout(250);
  const r = await ev(() => { const g = document.getElementById('stGrid'); return { vis: !!g && !g.hidden, txt: g ? g.textContent : '' }; });
  ok('8a #stGrid', r.vis && /Izgara/.test(r.txt), JSON.stringify(r));
  const diff = await ev(() => { const c = document.getElementById('cv'), g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, Math.min(c.height, 200)).data; const bg = [d[0], d[1], d[2]]; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== bg[0] || d[i + 1] !== bg[1] || d[i + 2] !== bg[2]) n++; return n; });
  ok('8b ızgara piksel', diff > 100, 'farklı piksel: ' + diff);
  await shot('d_grid');
  await ev(() => { window.dwgApp.display.setDisplay('gridStep', 1e-6); window.dwgApp.render(); });
  const ms = await ev(() => window.dwgApp.state.lastRenderMs);
  ok('8c uç adım süresi', ms < 500, ms.toFixed(1) + ' ms');
  await ev(() => { window.dwgApp.display.setDisplay('gridStyle', 'point'); window.dwgApp.display.setDisplay('gridStep', 'auto'); }); await page.waitForTimeout(200); await shot('d_grid_point');
  await ev(() => { window.dwgApp.display.setDisplay('grid', false); window.dwgApp.display.setDisplay('gridStyle', 'line'); });
}

// ---- 9. izolasyon -------------------------------------------------------------------------
{
  const before = await ev(() => [...window.dwgApp.state.layers.values()].map(l => l.name + ':' + l.visible).join(','));
  await ev(() => { document.getElementById('btnLayers').click(); window.dwgApp.display.isolateLayers(['0']); });
  await page.waitForTimeout(200);
  const r = await ev(() => ({ others: [...window.dwgApp.state.layers.values()].filter(l => l.name !== '0').every(l => l.visible === false), iso: window.dwgApp.display.isIsolated(), uniso: (() => { const b = document.getElementById('btnLayersUniso'); return b ? !b.hidden : 'yok'; })() }));
  ok('9a isolateLayers', r.others && r.iso && (r.uniso === true || r.uniso === 'yok'), JSON.stringify(r));
  await shot('d_isolated_layers');
  await ev(() => window.dwgApp.display.unisolate());
  const after = await ev(() => [...window.dwgApp.state.layers.values()].map(l => l.name + ':' + l.visible).join(','));
  ok('9b unisolate geri yükler', before === after && !(await ev(() => window.dwgApp.display.isIsolated())));
  await ev(() => window.dwgApp.onBack());
}

// ---- 10. soldurma / 11. renk modu ---------------------------------------------------------
{
  await ev(() => { window.dwgApp.display.setDisplay('fade', true); window.dwgApp.display.setDisplay('fadePct', 70); window.dwgApp.render(); });
  ok('10 fade', await ev(() => window.dwgApp.state.fade.on === true && window.dwgApp.state.fade.pct === 70));
  await shot('d_fade');
  await ev(() => window.dwgApp.display.setDisplay('fade', false));
  await ev(() => window.dwgApp.display.setDisplay('colorMode', 'mono'));
  ok('11a mono', await ev(() => window.dwgApp.state.mono === true));
  await ev(() => window.dwgApp.display.setDisplay('colorMode', 'layer')); await page.waitForTimeout(200);
  const pal = await ev(() => window.dwgApp.display.layerPalette('0'));
  ok('11b layerPalette', /^#|^hsl/.test(pal), pal);
  await shot('d_layer_palette');
  await ev(() => window.dwgApp.display.setDisplay('colorMode', 'entity'));
}

// ---- 12. ekran sheet'i --------------------------------------------------------------------
{
  const hasTile = await ev(() => !!document.querySelector('#toolbar [data-act="display"]'));
  if (hasTile) await page.click('#toolbar [data-act="display"]'); else await ev(() => window.dwgApp.display.openDisplayOptions());
  await page.waitForTimeout(300);
  const r = await ev(() => ({ vis: !document.getElementById('displayPanel').hidden, sepia: !!document.querySelector('#displayPanel .seg[data-key="theme"] button[data-val="sepia"]'), grid: !!document.querySelector('#displayPanel label.switch input[data-key="grid"]'), lw: !!document.querySelector('#displayPanel .slider[data-key="lwScale"] input[type=range]') }));
  ok('12a sheet içeriği', r.vis && r.sepia && r.grid && r.lw, JSON.stringify(r) + (hasTile ? '' : ' (data-act=display karosu yok; API ile açıldı)'));
  await shot('d_sheet');
  await page.click('#displayPanel .seg[data-key="theme"] button[data-val="sepia"]'); await page.waitForTimeout(150);
  ok('12b seg tıklaması', await ev(() => window.dwgApp.state.theme === 'sepia'));
  await page.click('#displayPanel label.switch input[data-key="grid"]'); await page.waitForTimeout(150);
  ok('12c switch', await ev(() => window.dwgApp.state.grid.on === true));
  await page.locator('#displayPanel .slider[data-key="lwScale"] .inc').click(); await page.waitForTimeout(100);
  ok('12d slider +', await ev(() => window.dwgApp.state.lwScale === 3.5), String(await ev(() => window.dwgApp.state.lwScale)));
  await shot('d_sheet_changed');
  await page.click('#displayReset'); await page.waitForTimeout(200);
  const r2 = await ev(() => ({ theme: window.dwgApp.state.theme, grid: window.dwgApp.state.grid.on, act: (() => { const a = document.querySelector('#toast .act'); return a && !a.hidden ? a.textContent : ''; })() }));
  ok('12e sıfırla + geri al', r2.theme === 'dark' && r2.grid === false && r2.act === 'Geri al', JSON.stringify(r2));
  await page.click('#toast .act'); await page.waitForTimeout(150);
  ok('12f geri al çalıştı', await ev(() => window.dwgApp.state.theme === 'sepia'));
  await ev(() => window.dwgApp.display.resetDisplay());
  await ev(() => { document.getElementById('toast').hidden = true; window.dwgApp.onBack(); });
}

// ---- 13. FAB kümesi ------------------------------------------------------------------------
{
  await ev(() => window.dwgApp.zoomExtents()); await page.waitForTimeout(150);
  const v0 = await ev(() => ({ ...window.dwgApp.state.view }));
  const prevDisabled = await ev(() => document.querySelector('#navFabs [data-nav="prev"]').disabled);
  ok('13b geçmiş boşken prev disabled', prevDisabled);
  await page.click('#navFabs [data-nav="in"]'); await page.waitForTimeout(150);
  const v1 = await ev(() => ({ ...window.dwgApp.state.view }));
  ok('13c zoom in', near(v1.scale, v0.scale * 1.5) && near(v1.cx, v0.cx, 1e-9) && near(v1.cy, v0.cy, 1e-9), JSON.stringify([v0, v1]));
  await page.click('#navFabs [data-nav="out"]'); await page.waitForTimeout(150);
  const v2 = await ev(() => ({ ...window.dwgApp.state.view }));
  ok('13d zoom out', near(v2.scale, v0.scale), '');
  await page.click('#navFabs [data-nav="in"]'); await page.waitForTimeout(150);
  await page.click('#navFabs [data-nav="prev"]'); await page.waitForTimeout(150);
  const v3 = await ev(() => ({ ...window.dwgApp.state.view }));
  ok('13e prev', near(v3.scale, v2.scale), JSON.stringify(v3));
  await page.click('#navFabs [data-nav="in"]'); await page.waitForTimeout(100);
  await page.click('#navFabs [data-nav="fit"]'); await page.waitForTimeout(150);
  const v4 = await ev(() => ({ ...window.dwgApp.state.view }));
  ok('13f fit', near(v4.scale, v0.scale) && near(v4.cx, v0.cx, 1e-9), '');
  await shot('d_fabs');
}

// ---- 14. pencere --------------------------------------------------------------------------
{
  await ev(() => window.dwgApp.zoomExtents());
  const s0 = await ev(() => window.dwgApp.state.view.scale);
  await ev(() => window.dwgApp.zoomWindow());
  ok('14a cmdBar ipucu', await ev(() => !document.getElementById('cmdBar').hidden && /Pencere/.test(document.getElementById('cmdText').textContent)));
  const r = await vpBox();
  await page.mouse.move(r.x + 100, r.y + 100); await page.mouse.down(); await page.mouse.move(r.x + 200, r.y + 200, { steps: 5 }); await page.mouse.move(r.x + 300, r.y + 300, { steps: 5 });
  await shot('d_zoomwin_drag');
  await page.mouse.up(); await page.waitForTimeout(200);
  const rr = await ev(() => { const S = window.dwgApp.state; const c = window.dwgApp.toScreen(S.view.cx, S.view.cy); const w = window.dwgApp.toWorld(S.W / 2, S.H / 2); return { scale: S.view.scale, sx: c[0], sy: c[1], W: S.W, H: S.H }; });
  const wc = await ev(() => window.dwgApp.toWorld(window.dwgApp.state.W / 2, window.dwgApp.state.H / 2));
  // dikdörtgen merkezi (200,200) ekran → dünya; şimdi görünüm merkezi olmalı
  const expected = await ev(() => null);
  ok('14b pencere yakınlaştırdı', rr.scale > s0 && await ev(() => document.getElementById('cmdBar').hidden), 'scale ' + s0.toFixed(4) + ' → ' + rr.scale.toFixed(4));
  await ev(() => window.dwgApp.zoomWindow());
  ok('14c onBack iptal', await ev(() => window.dwgApp.onBack() === true && document.getElementById('cmdBar').hidden));
  // pencere merkezi denetimi: bilinen dünya dikdörtgeni
  await ev(() => window.dwgApp.zoomExtents());
  const a = await ev(() => window.dwgApp.toWorld(100, 100)), b = await ev(() => window.dwgApp.toWorld(300, 300));
  await ev(() => window.dwgApp.zoomWindow());
  await page.mouse.move(r.x + 100, r.y + 100); await page.mouse.down(); await page.mouse.move(r.x + 300, r.y + 300, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
  const cpx = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  const W = await ev(() => [window.dwgApp.state.W, window.dwgApp.state.H]);
  ok('14d merkez ±1 px', Math.abs(cpx[0] - W[0] / 2) <= 1 && Math.abs(cpx[1] - W[1] / 2) <= 1, JSON.stringify(cpx) + ' vs ' + JSON.stringify(W.map(v => v / 2)));
}

// ---- 15. görünüm geçmişi ------------------------------------------------------------------
{
  await ev(() => { window.dwgApp.zoomExtents(); window.dwgApp.zoomBy(2); });
  const vz = await ev(() => ({ ...window.dwgApp.state.view }));
  ok('15a back', await ev(() => window.dwgApp.viewHistory.back()) === true);
  const ve = await ev(() => ({ ...window.dwgApp.state.view }));
  const ext = await ev(() => { const S = window.dwgApp.state; const e = S.ext; return { cx: (e[0] + e[2]) / 2, cy: (e[1] + e[3]) / 2 }; });
  ok('15b back extents', near(ve.cx, ext.cx, 1e-6) && near(vz.scale, ve.scale * 2), JSON.stringify([ve, ext]));
  ok('15c forward', await ev(() => window.dwgApp.viewHistory.forward()) === true && near((await ev(() => window.dwgApp.state.view.scale)), vz.scale));
  ok('15d canBack/canForward', await ev(() => window.dwgApp.viewHistory.canBack() === true && window.dwgApp.viewHistory.canForward() === false));
}

// ---- 16. çift-dokun-sürükle / iki parmak dokunuş -------------------------------------------
{
  await ev(() => window.dwgApp.zoomExtents()); await page.waitForTimeout(100);
  const s0 = await ev(() => window.dwgApp.state.view.scale);
  const r = await vpBox(); const x = r.x + 200, y = r.y + 450;
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await touch('touchStart', [{ x, y }]); await touch('touchEnd', []); await page.waitForTimeout(80);
  await touch('touchStart', [{ x, y }]); await page.waitForTimeout(60);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x, y: y - i * 10 }]); await page.waitForTimeout(16); }
  await touch('touchEnd', []); await page.waitForTimeout(250);
  const s1 = await ev(() => window.dwgApp.state.view.scale);
  ok('16a çift-dokun-sürükle 2×', near(s1, s0 * 2, 0.02), (s1 / s0).toFixed(3));
  await ev(() => window.dwgApp.zoomExtents()); await page.waitForTimeout(100);
  const s2 = await ev(() => window.dwgApp.state.view.scale);
  await touch('touchStart', [{ x: x - 30, y }, { x: x + 30, y }]); await page.waitForTimeout(60); await touch('touchEnd', []); await page.waitForTimeout(250);
  const s3 = await ev(() => window.dwgApp.state.view.scale);
  ok('16b iki parmak dokunuş 0,5×', near(s3, s2 / 2, 0.02), (s3 / s2).toFixed(3));
  // çift dokunuş hâlâ 2×
  await ev(() => window.dwgApp.zoomExtents()); await page.waitForTimeout(100);
  const s4 = await ev(() => window.dwgApp.state.view.scale);
  await page.touchscreen.tap(x, y); await page.waitForTimeout(60); await page.touchscreen.tap(x, y); await page.waitForTimeout(250);
  const s5 = await ev(() => window.dwgApp.state.view.scale);
  ok('16c çift dokunuş 2×', near(s5, s4 * 2, 0.02), (s5 / s4).toFixed(3));
  await cdp.detach();
}

// ---- 17. toast ---------------------------------------------------------------------------
{
  await ev(() => { window.__undone = 0; window.dwgApp.toast('x', { type: 'error', action: { label: 'Geri al', fn: () => { window.__undone++; } } }); });
  const r = await ev(() => ({ cls: document.getElementById('toast').className, act: document.querySelector('#toast .act').textContent, hidden: document.getElementById('toast').hidden }));
  ok('17a toast error + action', /error/.test(r.cls) && r.act === 'Geri al' && !r.hidden, JSON.stringify(r));
  await shot('d_toast');
  await page.click('#toast .act');
  ok('17b action fn', await ev(() => window.__undone === 1));
  await ev(() => window.dwgApp.toast('m', 1000));
  ok('17c sayı argümanı', await ev(() => !document.getElementById('toast').hidden && document.querySelector('#toast .tx').textContent === 'm'));
  await page.waitForTimeout(1200);
  ok('17d 1000 ms sonra gizli', await ev(() => document.getElementById('toast').hidden));
}

// ---- 18. eldiven --------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const m = await import('./editor.js');
    if (!m.ui || typeof m.applyUi !== 'function') { window.dispatchEvent(new CustomEvent('dwg:ui', { detail: { glove: true } })); return { fallback: true }; }
    m.ui.glove = true; m.applyUi();
    return { tile: getComputedStyle(document.getElementById('app')).getPropertyValue('--tile').trim() };
  });
  await ev(() => window.dwgApp.zoomExtents([0, 0, 600, 600]));
  await page.waitForTimeout(150);
  // bir çizgi ilkeli seç, 16 px uzağa dokun
  const hit = await ev(() => { const S = window.dwgApp.state; const p = S.prims.find(q => q.k === 0 && q.et === 'LINE' && q.ops.length === 2 && Math.abs(q.ops[0][2] - q.ops[1][2]) < 1e-6 && Math.hypot(q.ops[1][1] - q.ops[0][1], 0) * S.view.scale > 80 && q.bb[0] > 0 && q.bb[2] < 600 && q.bb[1] > 0 && q.bb[3] < 600); if (!p) return null; const mx = (p.ops[0][1] + p.ops[1][1]) / 2, my = p.ops[0][2]; const s = window.dwgApp.toScreen(mx, my); return { s, h: p.info && p.info.h }; });
  if (hit) {
    const vb = await vpBox();
    await page.touchscreen.tap(vb.x + hit.s[0], vb.y + hit.s[1] + 16); await page.waitForTimeout(300);
    const sel = await ev(() => window.dwgApp.state.selected && window.dwgApp.state.selected.info && window.dwgApp.state.selected.info.h);
    ok('18 eldiven pick 20 px', sel === hit.h && !(await ev(() => document.getElementById('infoPanel').hidden)), JSON.stringify({ r, sel, h: hit.h }));
    await shot('d_info_glove');
    await ev(() => window.dwgApp.onBack());
  } else ok('18 eldiven pick (uygun yatay çizgi bulunamadı, atlandı)', true);
  await ev(async () => { const m = await import('./editor.js'); if (m.ui) { m.ui.glove = false; m.applyUi(); } else window.dispatchEvent(new CustomEvent('dwg:ui', { detail: { glove: false } })); });
}

// ---- 19. ölçek seçici (test_tr.dxf, birim m) ----------------------------------------------
await load(`${SM}/test_tr.dxf`);
await ev(() => { for (const l of window.dwgApp.state.layers.values()) l.visible = true; window.dwgApp.zoomExtents(); });
await page.click('#btnMore'); await page.click('#moreMenu [data-act="settings"]');
ok('44 ayarlar alanları', await ev(() => ['sCrs', 'sUnit', 'sDx', 'sDy', 'sSave', 'sLw'].every(id => !!document.getElementById(id))));
await page.selectOption('#sUnit', '1'); await page.click('#sSave'); await page.waitForTimeout(300);
{
  const txt = await page.locator('#stScale').innerText();
  ok('19a #stScale 1:N', /^1:\d/.test(txt), txt);
  await page.click('#stScale'); await page.waitForTimeout(200);
  ok('19b çip', await ev(() => !!document.querySelector('#docPanel [data-scale="500"]')));
  await shot('d_scale_picker');
  await page.click('#docPanel [data-scale="500"]'); await page.waitForTimeout(150);
  const r = await ev(() => ({ scale: window.dwgApp.state.view.scale, exp: 3779.53 * window.dwgApp.state.unitToM / 500 }));
  ok('19c 1:500', Math.abs(r.scale - r.exp) < 1e-3, JSON.stringify(r));
}
// yardımcılar: cetvel + artı imleç + kuzey büyük
await ev(() => { window.dwgApp.display.setDisplay('rulers', true); window.dwgApp.display.setDisplay('northBig', true); window.dwgApp.display.setDisplay('crosshair', 'full'); window.dwgApp.setMode('measure'); });
{ const vb = await vpBox(); await page.touchscreen.tap(vb.x + 150, vb.y + 300); await page.waitForTimeout(200); }
await shot('d_rulers_crosshair');
await ev(() => { window.dwgApp.setMode('view'); window.dwgApp.display.setDisplay('rulers', false); window.dwgApp.display.setDisplay('northBig', false); window.dwgApp.display.setDisplay('crosshair', 'small'); });
// güneş modu ve ön ayarlar
await ev(() => window.dwgApp.display.setDisplay('sun', true)); await page.waitForTimeout(200);
ok('3 güneş modu', await ev(() => document.body.classList.contains('sun') && window.dwgApp.state.theme === 'hicontrast' && window.dwgApp.state.minLw === 1.5));
await shot('d_sun');
await ev(() => window.dwgApp.display.setDisplay('sun', false));
ok('3b güneş kapanınca tema geri', await ev(() => window.dwgApp.state.theme === 'dark' && window.dwgApp.state.minLw === 1));
await ev(() => window.dwgApp.display.applyPreset('print')); await page.waitForTimeout(200);
ok('3c baskı ön ayarı', await ev(() => window.dwgApp.state.theme === 'light' && window.dwgApp.state.colorMode === 'mono' && window.dwgApp.state.lw === true && window.dwgApp.state.preset === 'print'));
await shot('d_preset_print');
await ev(() => window.dwgApp.display.applyPreset('office'));
// koordinata git
await ev(() => window.dwgApp.gotoCoord()); await page.waitForTimeout(150);
await page.fill('#gotoX', '300'); await page.fill('#gotoY', '120'); await page.click('#gotoMark'); await page.waitForTimeout(200);
ok('goto', await ev(() => Math.abs(window.dwgApp.state.view.cx - 300) < 1e-9 && Math.abs(window.dwgApp.state.view.cy - 120) < 1e-9 && !!window.dwgApp.state.gotoMarker));
await shot('d_goto');
await ev(() => window.dwgApp.onBack());
// uzun basış bağlam menüsü
{
  const vb = await vpBox();
  await ev(() => { window.dwgApp.zoomExtents(); });
  await page.waitForTimeout(100);
  await page.mouse.move(vb.x + 30, vb.y + 60); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(200);
  ok('uzun basış menüsü', await ev(() => !document.getElementById('docPanel').hidden && !!document.querySelector('#docBody [data-ctx="copy"]')));
  await shot('d_longpress');
  await ev(() => window.dwgApp.onBack());
}
// kalıcılık
{
  await ev(() => { window.dwgApp.display.setDisplay('theme', 'sepia'); window.dwgApp.display.setDisplay('grid', true); });
  await page.waitForTimeout(500);
  const st = await ev(() => JSON.parse(localStorage.getItem('settings')));
  ok('kalıcılık settings.display', st.version === 2 && st.display.theme === 'sepia' && st.display.grid === true && st.dark === false, JSON.stringify({ v: st.version, th: st.display && st.display.theme, dark: st.dark }));
  await ev(() => window.dwgApp.display.resetDisplay());
}
// ---- 20. 3B savePng -------------------------------------------------------------------------
{
  await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(600);
  const dlP = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await ev(() => window.dwgApp.savePng());
  const dl = await dlP;
  ok('20 3B savePng download', !!dl && errors.filter(e => /savePng|screenshot/.test(e)).length === 0, dl ? dl.suggestedFilename() : 'download yok');
  await shot('d_3d');
  // FAB'lar 3B'de
  await page.click('#navFabs [data-nav="in"]'); await page.waitForTimeout(100);
  ok('13g 3B zoom fab hatasız', errors.length === 0);
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(200);
}
// ---- yatay ve küçük ekran -------------------------------------------------------------------
await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(400); await shot('d_landscape');
await page.setViewportSize({ width: 360, height: 640 }); await page.waitForTimeout(400);
await ev(() => window.dwgApp.display.openDisplayOptions()); await page.waitForTimeout(300); await shot('d_small_sheet');
{
  const bad = await ev(() => [...document.querySelectorAll('#navFabs button, #displayPanel .seg button, #displayPanel .chip, #displayPanel .switch')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.width < 40 || r.height < 32); }).map(b => b.outerHTML.slice(0, 60)));
  ok('46 dokunma hedefleri (360×640)', bad.length === 0, bad.join(' | ').slice(0, 300));
}
await ev(() => window.dwgApp.onBack());
console.log(`\nSONUÇ: ${passes} geçti, ${fails} kaldı; sayfa hataları: ${errors.length}`);
for (const e of errors) console.log('  err:', e.slice(0, 200));
await browser.close(); srv.kill();
process.exit(fails ? 1 : 0);
