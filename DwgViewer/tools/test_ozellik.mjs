/*
 * v7.70 — ÖZELLİKLER'de nesne türü süzgeci (AutoCAD Properties paleti gibi): "Tümü (5)", "Çizgi (3)", "Daire (2)"; tür
 * seçilince seçim o türe daralır, değişiklik yalnız onlara uygulanır, "Tümü" geri getirir.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_ozellik.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';

const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
const J = JSON.stringify;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });
const bekle = (ms = 150) => page.waitForTimeout(ms);
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e) => ({ layer: '0', color: 256, ...e })) }); window.dwgApp.requestRender(); }, ents);
const sec = (keys) => ev((ks) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (ks.includes(p.key)) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, keys);
const selKeys = () => ev(() => [...window.dwgApp.editor.sel].map(p => p.key).sort());
const layerOf = (k) => ev((key) => { const p = window.dwgApp.state.prims.find(q => q.key === key); return p ? p.lay : null; }, k);
const dlg = () => ev(() => ({ acik: !document.getElementById('docPanel').hidden, baslik: document.getElementById('docTitle').textContent, opts: [...document.querySelectorAll('#pType option')].map(o => o.textContent), val: (document.getElementById('pType') || {}).value }));

await ev(() => window.dwgApp.editor.runCmd({ op: 'layer', name: 'HEDEF', color: 1 }));
await ekle([
  { id: 'oz_l1', type: 'LINE', pts: [[100, 100, 0], [200, 100, 0]] }, { id: 'oz_l2', type: 'LINE', pts: [[100, 150, 0], [200, 150, 0]] }, { id: 'oz_l3', type: 'LINE', pts: [[100, 200, 0], [200, 200, 0]] },
  { id: 'oz_c1', type: 'CIRCLE', pts: [[300, 100, 0]], r: 20 }, { id: 'oz_c2', type: 'CIRCLE', pts: [[300, 200, 0]], r: 20 },
]);
await page.click('#toolbar [data-tab="edit"]');
await sec(['oz_l1', 'oz_l2', 'oz_l3', 'oz_c1', 'oz_c2']);
await ev(() => window.dwgApp.editor.act('props')); await bekle(250);
const d0 = await dlg();
ok('1 Özellikler: 5 nesne; tür listesi "Tümü (5)", "Çizgi (3)", "Daire (2)" (çoktan aza)', d0.acik && /\(5 /.test(d0.baslik) && d0.opts[0] === 'Tümü (5)' && d0.opts[1] === 'Çizgi (3)' && d0.opts[2] === 'Daire (2)' && d0.val === '', J(d0));
await page.screenshot({ path: `${out}/ozellik_tur.png` });
await page.selectOption('#pType', 'CIRCLE'); await bekle(250);
const d1 = await dlg(), s1 = await selKeys();
ok('2 "Daire (2)" seçilince seçim dairelere daralır (2), başlık 2 nesne, liste seçili Daire', s1.join(',') === 'oz_c1,oz_c2' && /\(2 /.test(d1.baslik) && d1.val === 'CIRCLE', J({ s1, d1 }));
await page.selectOption('#pLayer', 'HEDEF'); await page.click('#pOk'); await bekle(250);
const lay = { l1: await layerOf('oz_l1'), c1: await layerOf('oz_c1'), c2: await layerOf('oz_c2') };
ok('3 Uygula yalnız dairelere: daireler HEDEF katmanına geçti, çizgiler 0 katmanında kaldı; daralmış seçim duruyor', lay.c1 === 'HEDEF' && lay.c2 === 'HEDEF' && lay.l1 === '0' && (await selKeys()).join(',') === 'oz_c1,oz_c2', J(lay));
await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150);
await sec(['oz_l1', 'oz_l2', 'oz_l3', 'oz_c1', 'oz_c2']);
await ev(() => window.dwgApp.editor.act('props')); await bekle(250);
await page.selectOption('#pType', 'LINE'); await bekle(250);
ok('4 "Çizgi (3)" → 3 çizgi seçili', (await selKeys()).join(',') === 'oz_l1,oz_l2,oz_l3', J(await selKeys()));
await page.selectOption('#pType', ''); await bekle(250);
const d2 = await dlg();
ok('5 "Tümü" seçimi geri getirir (5), liste yeniden Tümü', (await selKeys()).length === 5 && /\(5 /.test(d2.baslik) && d2.val === '', J({ s: await selKeys(), d2 }));
await ev(() => window.dwgApp.onBack()); await bekle(150);
const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);
await dil('en'); await ev(() => window.dwgApp.editor.act('props')); await bekle(250);
const d3 = await dlg();
ok('6 İngilizce: "All (5)", "Line (3)", "Circle (2)"', d3.opts[0] === 'All (5)' && d3.opts[1] === 'Line (3)' && d3.opts[2] === 'Circle (2)', J(d3.opts));
await ev(() => window.dwgApp.onBack()); await dil('tr'); await bekle(100);
ok('X sayfa hatası yok', errors.length === 0, J(errors.slice(0, 3)));
await browser.close(); await srv.kill();
C.summary(); C.exit();
