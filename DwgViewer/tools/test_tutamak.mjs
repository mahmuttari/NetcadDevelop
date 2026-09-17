// KÖŞE TUTAMAKLARI — boşta dokunuş (v7.61 düzeltmesi). Tutamaklar seçili nesnede çıkar; boşta dokunuş bilgi
// paneline gidip nesneyi seçime almadığından karo açıkken nesneye dokunmak hiçbir şey yapmıyordu. Şimdi kip
// açıkken boşta dokunuş nesneyi (grubuyla) SEÇER, tutamaklar çıkar, köşe sürüklenir; boş yere dokunmak
// seçimi bırakır. Kip kapalıyken eski yol (vurgu + bilgi paneli) değişmedi.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_tutamak.mjs [çıktı] [örnekler]
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
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes([]); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const tapWorld = async (x, y) => { await bekle(110); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(400); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: 'tu_' + i, layer: '0', color: 256 })) }); window.dwgApp.requestRender(); }, ents);
const primOf = (id) => ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); return p ? { ops: p.ops.map(o => o.slice()) } : null; }, id);
const durum = () => ev(() => { const E = window.dwgApp.editor; return { sel: E.sel.size, selKeys: [...E.sel].map(p => p.key), selected: window.dwgApp.state.selected ? window.dwgApp.state.selected.key : null, info: document.getElementById('infoPanel').hidden, badge: document.getElementById('selBadge').hidden, grip: E.gripInfo(), running: E.tools.running }; });
const grips = () => ev(async () => { const M = await import('./editor.js'); return !!M.ui.grips; });
const act = async (id) => { await ev((a) => window.dwgApp.editor.act(a), id); await bekle(200); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
/** Sentetik dokunma sürüklemesi (ekran koordinatları): tutamak jesti gizmoDown / Move / Up kapısından geçer */
const surukle = async (pts) => {
  await ev((pts) => {
    const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
    const mk = (type, p) => new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: type === 'pointerdown' ? 0 : -1, buttons: type === 'pointerup' ? 0 : 1 });
    vp.dispatchEvent(mk('pointerdown', pts[0]));
    for (const p of pts.slice(1)) vp.dispatchEvent(mk('pointermove', p));
    vp.dispatchEvent(mk('pointerup', pts[pts.length - 1]));
  }, pts);
  await bekle(300);
};

await page.click('#toolbar [data-tab="edit"]');
await ekle([
  { type: 'LWPOLYLINE', pts: [[200, 200, 0], [400, 200, 0], [400, 400, 0], [200, 400, 0]], closed: false },   // tu_0: dört köşeli açık yol
  { type: 'LINE', pts: [[600, 150, 0], [700, 450, 0]] },                                                       // tu_1
]);
await zoom([0, 0, 800, 600]);

// ---------------------------------------------------------------------------------
// 1 · Kip KAPALI: boşta dokunuş eski yol (vurgu + bilgi paneli), seçim yok
// ---------------------------------------------------------------------------------
{
  ok('1a başlangıçta köşe tutamakları kapalı', (await grips()) === false);
  await tapWorld(300, 200);
  const d = await durum();
  ok('1b kip kapalıyken dokunuş nesneyi VURGULAR ve bilgi panelini açar, seçime almaz, tutamak yok', d.sel === 0 && d.selected === 'tu_0' && d.info === false && d.grip.n === 0, J(d));
  await ev(() => { document.getElementById('infoPanel').hidden = true; window.dwgApp.state.selected = null; });
}

// ---------------------------------------------------------------------------------
// 2 · Kip AÇIK: boşta dokunuş SEÇER, tutamaklar çıkar, köşe sürüklenir, boş yer bırakır
// ---------------------------------------------------------------------------------
{
  await act('grips');
  ok('2a karo kipi açar (bildirim)', (await grips()) === true && /tutamak/i.test(await toast()), await toast());
  await tapWorld(300, 200);
  const d = await durum();
  const beklenen = [];
  for (const p of [[200, 200], [400, 200], [400, 400], [200, 400]]) beklenen.push(await scr(p[0], p[1]));
  const yerinde = d.grip.pts.length === 4 && d.grip.pts.every((q, i) => Math.hypot(q[0] - beklenen[i][0], q[1] - beklenen[i][1]) < 1.5);
  ok('2b kip açıkken dokunuş nesneyi SEÇER: seçim 1 (tu_0), vurgu yok, bilgi paneli kapalı, rozet görünür, 4 köşede tutamak (ekran konumları birebir)', d.sel === 1 && d.selKeys[0] === 'tu_0' && d.selected === null && d.info === true && d.badge === false && d.grip.n === 4 && yerinde && d.grip.r === 5 && d.grip.hitR === 20, J({ d, beklenen }));   // v7.64: kare yarı kenarı 7 → 5 (%75), isabet yarıçapı aynı
  await page.screenshot({ path: `${out}/tutamak_secili.png` });
  // 3. köşe (400,400) → (500,450): tutamağa basıp sürükle
  const g = d.grip.pts[2], hedef = await scr(500, 450);
  await surukle([[g[0], g[1]], [(g[0] + hedef[0]) / 2, (g[1] + hedef[1]) / 2], [hedef[0], hedef[1]]]);
  const p = await primOf('tu_0');
  ok('2c köşe sürüklendi: 3. düğüm (500,450) oldu, öteki düğümler yerinde (dokunuş payı 1e-3)', yak(p.ops[2][1], 500, 1e-3) && yak(p.ops[2][2], 450, 1e-3) && yak(p.ops[1][1], 400, 1e-6) && yak(p.ops[3][2], 400, 1e-6), J(p.ops));
  const d2 = await durum();
  ok('2d sürüklemeden sonra seçim ve tutamaklar duruyor (tutamak yeni yerde)', d2.sel === 1 && d2.grip.n === 4 && Math.hypot(d2.grip.pts[2][0] - hedef[0], d2.grip.pts[2][1] - hedef[1]) < 1.5, J(d2.grip));
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150);
  const p2 = await primOf('tu_0');
  ok('2e geri al düğümü (400,400)\'e döndürür (tek adım)', yak(p2.ops[2][1], 400) && yak(p2.ops[2][2], 400), J(p2.ops));
  await tapWorld(650, 300);                                    // tu_1 doğrusuna dokun → seçim değişir
  const d3 = await durum();
  ok('2f başka nesneye dokunmak seçimi ona geçirir: doğru, 2 tutamak', d3.sel === 1 && d3.selKeys[0] === 'tu_1' && d3.grip.n === 2, J(d3));
  await tapWorld(100, 550);                                    // boş yer
  const d4 = await durum();
  ok('2g boş yere dokunmak seçimi bırakır, tutamak kalmaz, bilgi paneli açılmaz', d4.sel === 0 && d4.grip.n === 0 && d4.info === true && d4.selected === null, J(d4));
}

// ---------------------------------------------------------------------------------
// 3 · Araç çalışırken dokunuş araca gider; kip kapanınca eski yol; ipucu metni
// ---------------------------------------------------------------------------------
{
  await act('t:line');
  await tapWorld(300, 200);
  const d = await durum();
  ok('3a Çizgi aracı çalışırken dokunuş aracın noktasıdır, seçim yapılmaz', d.running === true && d.sel === 0, J(d));
  await ev(() => { window.dwgApp.editor.tools.cancel(); });
  await act('grips');
  ok('3b kip kapatıldı', (await grips()) === false);
  await tapWorld(300, 200);
  const d2 = await durum();
  ok('3c kip kapalı: yine vurgu + bilgi paneli, seçim yok', d2.sel === 0 && d2.selected === 'tu_0' && d2.info === false, J(d2));
  await ev(() => { document.getElementById('infoPanel').hidden = true; window.dwgApp.state.selected = null; });
  const ip = await ev(async () => { const I = await import('./i18n.js'); const tr = I.t('th_grips'); I.setLang('en'); const en = I.t('th_grips'); I.setLang('tr'); return { tr, en }; });
  ok('3d karo ipucu yeni davranışı söyler (TR / EN)', /dokunulan nesne seçilir/.test(ip.tr) && /tapping selects/.test(ip.en), J(ip));
}

// ---------------------------------------------------------------------------------
// 4 · Köşe tutamağı sürüklenirken başka nesnenin yakalama noktalarına oturur (v7.65); işaret çizilir;
//     köşenin kendi eski yeri yakalanmaz; yakalama kapalıyken ham bırakış
// ---------------------------------------------------------------------------------
{
  await ev(() => window.dwgApp.osnap.setModes(['end', 'mid']));
  await act('grips');
  await tapWorld(300, 200);                                    // tu_0 seçilir, 4 tutamak
  const d = await durum();
  ok('4a hazırlık: tu_0 seçili, 4 tutamak, yakalama uç + orta', d.sel === 1 && d.grip.n === 4, J(d.grip));
  // 3. köşe (400,400) → tu_1 doğrusunun ucu (600,150): parmak uca 10 px kala bırakılır
  const g = d.grip.pts[2], uc = await scr(600, 150), hedef = [uc[0] - 7, uc[1] + 7];
  await ev(([a, b]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); const mk = (t, p) => new PointerEvent(t, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: t === 'pointerdown' ? 0 : -1, buttons: 1 }); vp.dispatchEvent(mk('pointerdown', a)); vp.dispatchEvent(mk('pointermove', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])); vp.dispatchEvent(mk('pointermove', b)); }, [g, hedef]);
  await bekle(150);
  const orta = await ev(() => window.dwgApp.editor.gizmoInfo());
  await page.screenshot({ path: `${out}/tutamak_yakalama.png` });
  ok('4b sürükleme sırasında uç yakalandı (END), sürüklenen köşe uca oturdu, işaret için durum dolu', !!orta && orta.sn === 'end' && orta.p && yak(orta.p[0], 600, 1e-6) && yak(orta.p[1], 150, 1e-6), J(orta));
  await ev((b) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + b[0], clientY: r.top + b[1], button: -1, buttons: 0 })); }, hedef);
  await bekle(300);
  const p = await primOf('tu_0');
  ok('4c bırakınca köşe TAM (600,150): başka nesnenin ucuna oturdu', p.ops[2][1] === 600 && p.ops[2][2] === 150, J(p.ops));
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150);
  // 2. köşe (400,200) kendi eski yerinin 9 px yanına: kendi eski köşesine yapışmaz
  const d2 = await durum(), g2 = d2.grip.pts[1], yakin = [g2[0] + 9, g2[1] - 6];
  await surukle([[g2[0], g2[1]], [g2[0] + 4, g2[1] - 3], yakin]);
  const p2 = await primOf('tu_0'), w2 = await ev((q) => window.dwgApp.toWorld(q[0], q[1]), yakin);
  ok('4d köşe kendi eski yerine geri yapışmaz: (400,200)\'den ayrıldı, parmağın bıraktığı yere gitti', !(yak(p2.ops[1][1], 400, 1e-6) && yak(p2.ops[1][2], 200, 1e-6)) && yak(p2.ops[1][1], w2[0], 1e-3) && yak(p2.ops[1][2], w2[1], 1e-3), J({ ops: p2.ops, w2 }));
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150);
  // yakalama kapalı: ham bırakış
  await ev(() => window.dwgApp.osnap.setModes([]));
  const d3 = await durum(), g3 = d3.grip.pts[2];
  await surukle([[g3[0], g3[1]], [(g3[0] + hedef[0]) / 2, (g3[1] + hedef[1]) / 2], hedef]);
  const p3 = await primOf('tu_0'), w3 = await ev((q) => window.dwgApp.toWorld(q[0], q[1]), hedef);
  ok('4e yakalama kapalıyken köşe parmağın bıraktığı ham noktaya gider (uca oturmaz)', yak(p3.ops[2][1], w3[0], 1e-3) && yak(p3.ops[2][2], w3[1], 1e-3) && !(p3.ops[2][1] === 600 && p3.ops[2][2] === 150), J({ ops: p3.ops, w3 }));
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); });
  await act('grips');
}

await page.screenshot({ path: `${out}/tutamak.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
