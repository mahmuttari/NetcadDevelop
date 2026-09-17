// KALEMLİ CİHAZDA ÜÇ KUSUR (v7.62). (1) Boşta (komut yok) havada gezinirken yakalama işaretleri çıkmaz — yakalama
// yalnız nokta isteminde aranır. (2) Yalnız değer istenen istemde giriş alanı kendiliğinden odaklanır (klavye / el
// yazısı paneli gelir); nokta istemlerinde ve Ekran / Ölçü sorusunda odaklanmaz. (3) Seçim kutusu tutamağı: avuç
// reddi parmağı düşürünce tutamak jesti kapanır (giz takılı kalıp bütün dokunuşları yutmaz); "Kalem çizer, parmak
// gezinir" kipinde parmak tutamağı yine sürükler, bölge seçimi ise kaleme kalır.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_kalem2.mjs [çıktı] [örnekler]
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
const J = JSON.stringify, yak = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes(['end', 'mid']); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const tapWorld = async (x, y) => { await bekle(110); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(380); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: 'k2_' + i, layer: '0', color: 256 })) }); window.dwgApp.requestRender(); }, ents);
const primOf = (id) => ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); return p ? { bb: p.bb.slice() } : null; }, id);
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const hover = () => ev(() => ({ h: window.dwgApp.__pickbox().hover, pen: window.dwgApp.state.pen.hover, chip: !document.getElementById('stSnap').hidden }));
const odak = () => ev(() => (document.activeElement && document.activeElement.id) || null);
const kalem = (type, x, y, buttons = 0) => ev(([t, x, y, b]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: t === 'pointerdown' ? 0 : -1, buttons: b, pressure: b ? 0.5 : 0 })); }, [type, x, y, buttons]);
const parmak = (type, x, y) => ev(([t, x, y]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerup' || t === 'pointercancel' ? 0 : 1 })); }, [type, x, y]);
const sec = (key) => ev((k) => { const E = window.dwgApp.editor; E.sel.clear(); E.sel.add(window.dwgApp.state.prims.find(p => p.key === k)); window.dwgApp.requestRender(); }, key);
const gizmo = () => ev(() => window.dwgApp.editor.gizmoInfo());
const busy = () => ev(() => ({ busy: window.dwgApp.editor.gizmoBusy(), g: window.dwgApp.state.gestureActive }));

await page.click('#toolbar [data-tab="edit"]');
await ekle([
  { type: 'LINE', pts: [[200, 200, 0], [600, 200, 0]] },                                                        // k2_0
  { type: 'LWPOLYLINE', pts: [[200, 350, 0], [400, 350, 0], [400, 500, 0], [200, 500, 0]], closed: true },      // k2_1
]);
await zoom([0, 0, 800, 600]);

// ---------------------------------------------------------------------------------
// 1 · Boşta gezinirken yakalama işareti yok; nokta isteminde var
// ---------------------------------------------------------------------------------
{
  const s = await scr(600, 200);
  await kalem('pointermove', s[0] + 4, s[1] + 3); await bekle(220);
  const a = await hover();
  ok('1a boşta (komut yok) kalem uç noktanın üstünde: imleç var ama YAKALAMA YOK, çip kapalı, önizleme ham nokta', !!a.h && a.h.snap === null && a.chip === false && Array.isArray(a.pen) && Math.abs(a.pen[0] - 600) > 1e-3, J(a));
  await arac('t:line');
  await kalem('pointermove', s[0] + 4, s[1] + 3); await bekle(220);
  const b = await hover();
  ok('1b Çizgi aracı (nokta istemi): aynı yerde END yakalanır, çip görünür, önizleme (600,200)', !!b.h && b.h.snap === 'end' && b.chip === true && yak(b.pen[0], 600) && yak(b.pen[1], 200), J(b));
  await iptal();
  await ev(() => window.dwgApp.setMode('measure')); await bekle(150);
  await kalem('pointermove', s[0] + 4, s[1] + 3); await bekle(220);
  const c = await hover();
  ok('1c Ölçüm kipi de nokta istemidir: yakalama çalışır', !!c.h && c.h.snap === 'end', J(c));
  await ev(() => window.dwgApp.setMode('view')); await bekle(150);
  await arac('t:select');
  await kalem('pointermove', s[0] + 4, s[1] + 3); await bekle(220);
  const d = await hover();
  ok('1d Seç aracı (nesne istemi): yakalama yok', !!d.h && d.h.snap === null, J(d));
  await kalem('pointerout', s[0], s[1]); await iptal(); await bekle(800);
}

// ---------------------------------------------------------------------------------
// 2 · Yalnız değer istenen istemde giriş alanı kendiliğinden odaklanır
// ---------------------------------------------------------------------------------
{
  await arac('t:offset');
  ok('2a Ekran / Ölçü sorusunda giriş alanı odaklanmaz (dokunmak Ekran seçer, klavye çizimi örtmesin)', (await odak()) !== 'cmdInput', String(await odak()));
  await page.click('#cmdBtns [data-cmd="modevalue"]'); await bekle(200);
  ok('2b Ölçü seçilince değer istenir ve alan ODAKLANIR (klavye kendiliğinden)', (await odak()) === 'cmdInput', String(await odak()));
  await iptal();
  await ev(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await sec('k2_1'); await ev(() => window.dwgApp.editor.act('t:setz')); await bekle(200);
  ok('2c Kot ata (yalnız sayı): alan odaklanır', (await odak()) === 'cmdInput', String(await odak()));
  await iptal();
  await ev(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await arac('t:line');
  ok('2d Çizgi (nokta istemi): odaklanmaz', (await odak()) !== 'cmdInput', String(await odak()));
  await iptal();
  await sec('k2_1'); await ev(() => window.dwgApp.editor.act('t:rotate')); await bekle(200);
  ok('2e Döndür taban noktası (nokta istemi): odaklanmaz', (await odak()) !== 'cmdInput', String(await odak()));
  await tapWorld(300, 420);
  ok('2f Döndür açısı (sayı ya da nokta): odaklanmaz — klavye çizimi örtmesin', (await odak()) !== 'cmdInput', String(await odak()));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 3 · Tutamak jesti: avuç reddi parmağı düşürünce jest kapanır; sonraki dokunuşlar işlenir
// ---------------------------------------------------------------------------------
{
  await sec('k2_1');
  const g = await gizmo();
  ok('3a seçim kutusu tutamakları var (taşı / döndür), jest boşta; kare yarı kenarı 8 px (v7.64: %75), isabet 22 px aynı', !!g && g.busy === false && g.grip === 8 && g.hitR === 22, J(g));
  const bb0 = (await primOf('k2_1')).bb;
  await parmak('pointerdown', g.move[0], g.move[1]); await bekle(60);
  await parmak('pointermove', g.move[0] + 20, g.move[1] + 5); await bekle(60);
  const mid = await busy();
  ok('3b parmak taşı tutamağını sürüklüyor: jest meşgul', mid.busy === true && mid.g === true, J(mid));
  await kalem('pointerdown', g.move[0] + 200, g.move[1] + 80, 1); await bekle(80);    // kalem indi → avuç reddi parmağı düşürür
  const son = await busy();
  ok('3c kalem inince düşürülen parmağın tutamak jesti KAPANIR (giz takılı kalmaz), değişiklik atılır', son.busy === false && J((await primOf('k2_1')).bb) === J(bb0), J({ son, bb: (await primOf('k2_1')).bb, bb0 }));
  await kalem('pointerup', g.move[0] + 200, g.move[1] + 80, 0); await bekle(100);
  await parmak('pointerup', g.move[0] + 20, g.move[1] + 5); await bekle(900);          // eski parmağın bırakışı (artık kayıtlı değil) + avuç sağır süresi
  const g2 = await gizmo();
  await parmak('pointerdown', g2.move[0], g2.move[1]); await bekle(60);
  await parmak('pointermove', g2.move[0] + 30, g2.move[1]); await bekle(60);
  await parmak('pointermove', g2.move[0] + 60, g2.move[1]); await bekle(60);
  await parmak('pointerup', g2.move[0] + 60, g2.move[1]); await bekle(300);
  const bb1 = (await primOf('k2_1')).bb, scale = await ev(() => window.dwgApp.state.view.scale);
  ok('3d sonraki parmak sürüklemesi olağan çalışır: kutu 60 px sağa taşındı', yak(bb1[0] - bb0[0], 60 / scale, 1e-3) && yak(bb1[1], bb0[1], 1e-6), J({ bb0, bb1, dx: (bb1[0] - bb0[0]) * scale }));
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); });
}

// ---------------------------------------------------------------------------------
// 4 · "Kalem çizer, parmak gezinir": parmak tutamağı yine sürükler, bölge seçimi kaleme kalır
// ---------------------------------------------------------------------------------
{
  await ev(async () => { const M = await import('./editor.js'); M.ui.penDraw = true; M.applyUi({ store: false }); window.dwgApp.state.pen.seen = true; }); await bekle(150);
  await sec('k2_1');
  const g = await gizmo(), bb0 = (await primOf('k2_1')).bb;
  await parmak('pointerdown', g.move[0], g.move[1]); await bekle(60);
  await parmak('pointermove', g.move[0] + 30, g.move[1]); await bekle(60);
  await parmak('pointermove', g.move[0] + 60, g.move[1]); await bekle(60);
  await parmak('pointerup', g.move[0] + 60, g.move[1]); await bekle(300);
  const bb1 = (await primOf('k2_1')).bb, scale = await ev(() => window.dwgApp.state.view.scale);
  ok('4a kalem kipinde parmak taşı tutamağını sürükledi: kutu 60 px sağa', yak(bb1[0] - bb0[0], 60 / scale, 1e-3), J({ bb0, bb1 }));
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); });
  await arac('t:select');
  const p0 = await scr(100, 100), p1 = await scr(700, 560);
  await parmak('pointerdown', p0[0], p0[1]); await bekle(60);
  await parmak('pointermove', (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2); await bekle(60);
  await parmak('pointermove', p1[0], p1[1]); await bekle(100);
  const sd = await ev(() => ({ drag: window.dwgApp.editor.selDragState(), pick: window.dwgApp.editor.pickingObject() }));
  await parmak('pointerup', p1[0], p1[1]); await bekle(300);
  const sel = await ev(() => window.dwgApp.editor.sel.size);
  ok('4b kalem kipinde parmakla boş yerden sürükleme örtük pencere AÇMAZ (parmak gezinir), seçim boş', sd.drag === null && sel === 0, J({ sd, sel }));
  await iptal();
  await ev(async () => { const M = await import('./editor.js'); M.ui.penDraw = false; M.applyUi({ store: false }); });
}

await page.screenshot({ path: `${out}/kalem2.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
