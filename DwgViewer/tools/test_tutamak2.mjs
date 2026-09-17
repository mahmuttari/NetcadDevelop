/*
 * v7.69 — ÇOKLU SEÇİMDE köşe tutamakları (AutoCAD gibi): seçili bütün yolların düğümleri çıkar; bir düğüm sürüklenince
 * yalnız o yol değişir; AYNI noktadaki düğümler (birleşen duvarların ortak köşesi) birlikte gider ve tek geri alma adımıdır;
 * çakışan köşe kendi eski yerine yakalanmaz; nesne (100) ve düğüm (400) sınırları; pencere seçiminden sonra tutamaklar kalır.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_tutamak2.mjs [çıktı] [örnekler]
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
const J = JSON.stringify, yak = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes([]); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e) => ({ layer: '0', color: 256, ...e })) }); window.dwgApp.requestRender(); }, ents);
const primOf = (id) => ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); return p ? { ops: p.ops.map(o => o.slice()) } : null; }, id);
const sec = (keys) => ev((ks) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (ks.includes(p.key)) E.sel.add(p); window.dwgApp.editor.tools.api.overlay(); return E.sel.size; }, keys);
const grip = () => ev(() => window.dwgApp.editor.gripInfo());
const gizmo = () => ev(() => window.dwgApp.editor.gizmoInfo());
const grips = () => ev(async () => { const M = await import('./editor.js'); return !!M.ui.grips; });
const act = async (id) => { await ev((a) => window.dwgApp.editor.act(a), id); await bekle(200); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const undo = async () => { await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); }); await bekle(150); };
const undoLen = () => ev(() => { const d = window.dwgApp.editor.doc; return d && d.undoStack ? d.undoStack.length : (d && typeof d.canUndo === 'function' ? (d.canUndo() ? 1 : 0) : -1); });
const mk = (type, p) => ev(([t, p]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerup' ? 0 : 1 })); }, [type, p]);
/** Sentetik dokunma sürüklemesi (ekran koordinatları): tutamak jesti gizmoDown / Move / Up kapısından geçer */
const surukle = async (pts) => { await mk('pointerdown', pts[0]); for (const p of pts.slice(1)) await mk('pointermove', p); await mk('pointerup', pts[pts.length - 1]); await bekle(300); };
/** Düğüm tutamağının ekrandaki yeri (dünya noktasına en yakın tutamak) */
const gripAt = async (x, y) => { const s = await scr(x, y), g = await grip(); let best = null, bd = Infinity; for (const p of g.pts) { const d = Math.hypot(p[0] - s[0], p[1] - s[1]); if (d < bd) { bd = d; best = p; } } return bd <= 2 ? best : null; };
const kacGrip = async (x, y) => { const s = await scr(x, y), g = await grip(); return g.pts.filter(p => Math.hypot(p[0] - s[0], p[1] - s[1]) <= 2).length; };

await page.click('#toolbar [data-tab="edit"]');
await ekle([
  { id: 'tu_0', type: 'LWPOLYLINE', pts: [[200, 200, 0], [400, 200, 0], [400, 400, 0], [200, 400, 0]], closed: false },   // dört köşeli açık yol
  { id: 'tu_1', type: 'LINE', pts: [[600, 150, 0], [700, 450, 0]] },
  { id: 'tu_2', type: 'LINE', pts: [[400, 400, 0], [500, 500, 0]] },                                                       // tu_0'ın üçüncü köşesiyle ORTAK köşe
]);
await zoom([0, 0, 800, 600]);

// ---------------------------------------------------------------------------------
// 1 · Çoklu seçimde tutamaklar çıkar; kutu tutamağı da durur
// ---------------------------------------------------------------------------------
{
  await act('grips');
  ok('1a karo kipi açar', (await grips()) === true, await toast());
  await sec(['tu_0', 'tu_1']);
  const g = await grip(), z = await gizmo();
  ok('1b iki nesne seçili: 4 + 2 = 6 köşe tutamağı, 2 nesne; kutu tutamağı da var', g.n === 6 && g.objs === 2 && g.keys.filter(k => k === 'tu_0').length === 4 && g.keys.filter(k => k === 'tu_1').length === 2 && z !== null, J({ g: { n: g.n, objs: g.objs }, z: !!z }));
  ok('1c tutamaklar düğümlerin ekran yerlerinde ((200,200), (400,400), (600,150), (700,450))', (await gripAt(200, 200)) && (await gripAt(400, 400)) && (await gripAt(600, 150)) && (await gripAt(700, 450)), J(g.pts));
  await page.screenshot({ path: `${out}/coklu_tutamak.png` });
}

// ---------------------------------------------------------------------------------
// 2 · Bir düğüm sürüklenince yalnız o yol değişir; tek geri alma
// ---------------------------------------------------------------------------------
{
  const g0 = await gripAt(600, 150), hedef = await scr(650, 100);
  await surukle([g0, [(g0[0] + hedef[0]) / 2, (g0[1] + hedef[1]) / 2], hedef]);
  const p1 = await primOf('tu_1'), p0 = await primOf('tu_0');
  ok('2a doğrunun ucu (600,150) → (650,100) taşındı (dokunuş payı 1e-3)', yak(p1.ops[0][1], 650, 1e-3) && yak(p1.ops[0][2], 100, 1e-3) && yak(p1.ops[1][1], 700) && yak(p1.ops[1][2], 450), J(p1.ops));
  ok('2b öteki seçili yol (tu_0) değişmedi', J(p0.ops.map(o => [o[1], o[2]])) === J([[200, 200], [400, 200], [400, 400], [200, 400]]), J(p0.ops));
  const g = await grip();
  ok('2c sürüklemeden sonra seçim ve 6 tutamak duruyor (tutamak yeni yerde)', g.n === 6 && (await gripAt(650, 100)) !== null, J({ n: g.n }));
  await undo();
  const p2 = await primOf('tu_1');
  ok('2d tek geri alma ucu (600,150)\'ye döndürür', yak(p2.ops[0][1], 600) && yak(p2.ops[0][2], 150), J(p2.ops));
}

// ---------------------------------------------------------------------------------
// 3 · ORTAK köşe: aynı noktadaki düğümler birlikte gider, tek geri alma adımı
// ---------------------------------------------------------------------------------
{
  await sec(['tu_0', 'tu_2']);
  const g = await grip();
  ok('3a tu_0 + tu_2: 6 tutamak, (400,400)\'de iki düğüm üst üste', g.n === 6 && (await kacGrip(400, 400)) === 2, J({ n: g.n, ust: await kacGrip(400, 400) }));
  const g0 = await gripAt(400, 400), hedef = await scr(450, 350);
  // sürükleme sırasında: iki düğüm de "sıcak" (içi boş), kutu meşgul
  await mk('pointerdown', g0); await mk('pointermove', [(g0[0] + hedef[0]) / 2, (g0[1] + hedef[1]) / 2]); await bekle(80);
  const ara = await grip(), busy = await ev(() => window.dwgApp.editor.gizmoBusy());
  ok('3b sürüklerken iki çakışan düğüm de sıcak (act 2 dizin), tutamak jesti meşgul', busy === true && ara.act && ara.act.length === 2, J({ busy, act: ara.act }));
  await mk('pointermove', hedef); await mk('pointerup', hedef); await bekle(300);
  const p0 = await primOf('tu_0'), p2 = await primOf('tu_2');
  ok('3c ortak köşe (400,400) → (450,350): tu_0\'ın 3. düğümü VE tu_2\'nin başı birlikte taşındı', yak(p0.ops[2][1], 450, 1e-3) && yak(p0.ops[2][2], 350, 1e-3) && yak(p2.ops[0][1], 450, 1e-3) && yak(p2.ops[0][2], 350, 1e-3), J({ p0: p0.ops[2], p2: p2.ops[0] }));
  ok('3d öteki düğümler yerinde ((400,200), (200,400), (500,500))', yak(p0.ops[1][1], 400) && yak(p0.ops[1][2], 200) && yak(p0.ops[3][1], 200) && yak(p2.ops[1][1], 500) && yak(p2.ops[1][2], 500), J({ p0: p0.ops, p2: p2.ops }));
  ok('3e taşınan köşede yine iki tutamak üst üste (birlikte gittiler)', (await kacGrip(450, 350)) === 2, String(await kacGrip(450, 350)));
  await page.screenshot({ path: `${out}/ortak_kose.png` });
  await undo();
  const q0 = await primOf('tu_0'), q2 = await primOf('tu_2');
  ok('3f TEK geri alma ikisini de (400,400)\'e döndürür', yak(q0.ops[2][1], 400) && yak(q0.ops[2][2], 400) && yak(q2.ops[0][1], 400) && yak(q2.ops[0][2], 400), J({ q0: q0.ops[2], q2: q2.ops[0] }));
  // çakışan köşe kendi eski yerine yakalanmaz: uç yakalaması açıkken küçük sürükleme ham noktaya gider
  await ev(() => window.dwgApp.osnap.setModes(['end']));
  const s0 = await gripAt(400, 400), yakin = [s0[0] + 12, s0[1] - 12];
  await mk('pointerdown', s0); await mk('pointermove', [s0[0] + 6, s0[1] - 6]); await mk('pointermove', yakin); await bekle(80);
  const zg = await gizmo();
  await mk('pointerup', yakin); await bekle(300);
  const r0 = await primOf('tu_0'), r2 = await primOf('tu_2'), w = await ev((q) => window.dwgApp.toWorld(q[0], q[1]), yakin);
  ok('3g uç yakalaması açık, 12 px sürükleme (açıklık 27 px içinde): ortak köşe eski yerine (400,400) GERİ YAPIŞMAZ — sürüklerken yakalama yok (sn null), parmağın bıraktığı noktaya gider', zg && zg.sn === null && !(yak(r0.ops[2][1], 400) && yak(r0.ops[2][2], 400)) && yak(r0.ops[2][1], w[0], 1e-3) && yak(r0.ops[2][2], w[1], 1e-3) && yak(r2.ops[0][1], w[0], 1e-3), J({ sn: zg && zg.sn, r0: r0.ops[2], r2: r2.ops[0], w }));
  await undo();
  // uç yakalaması: ortak köşe BAŞKA nesnenin ucuna oturur (tu_1'in ucu (600,150)); sürüklerken işaret END
  const s1 = await gripAt(400, 400), h1 = await scr(600, 150), h1y = [h1[0] + 5, h1[1] + 4];
  await mk('pointerdown', s1); await mk('pointermove', [(s1[0] + h1y[0]) / 2, (s1[1] + h1y[1]) / 2]); await mk('pointermove', h1y); await bekle(80);
  const zh = await gizmo();
  await mk('pointerup', h1y); await bekle(300);
  const t0 = await primOf('tu_0'), t2 = await primOf('tu_2');
  ok('3h ortak köşe başka nesnenin ucuna TAM oturur (600,150), ikisi de; sürüklerken yakalama işareti END', zh && zh.sn === 'end' && t0.ops[2][1] === 600 && t0.ops[2][2] === 150 && t2.ops[0][1] === 600 && t2.ops[0][2] === 150, J({ sn: zh && zh.sn, t0: t0.ops[2], t2: t2.ops[0] }));
  await undo();
  // ortak köşenin yanı başındaki (8 px) seçili OLMAYAN ucun bulunması: köşeyi taşıyan yolların ikisi de atlanır, uç yine bulunur
  const p8 = await ev(() => window.dwgApp.toWorld(...window.dwgApp.toScreen(400, 400).map((v, i) => v + (i ? -8 : 8))));
  await ekle([{ id: 'tu_e', type: 'LINE', pts: [[p8[0], p8[1], 0], [p8[0] + 60, p8[1] - 80, 0]] }]);
  const s2 = await gripAt(400, 400), e2 = await scr(p8[0], p8[1]), d2 = [s2[0] + (e2[0] - s2[0]) * 0.75, s2[1] + (e2[1] - s2[1]) * 0.75];   // ucun 2 px yakınına bırakılır
  await mk('pointerdown', s2); await mk('pointermove', [(s2[0] + d2[0]) / 2, (s2[1] + d2[1]) / 2]); await mk('pointermove', d2); await bekle(80);
  const ze = await gizmo();
  await mk('pointerup', d2); await bekle(300);
  const e0 = await primOf('tu_0'), ee = await primOf('tu_2');
  ok('3i eski köşeden 8 px ötede seçili olmayan bir uç: çakışan köşeyi taşıyan iki yol da atlanır, uç bulunur (END), ikisi de oraya oturur', ze && ze.sn === 'end' && yak(e0.ops[2][1], p8[0], 1e-6) && yak(e0.ops[2][2], p8[1], 1e-6) && yak(ee.ops[0][1], p8[0], 1e-6), J({ sn: ze && ze.sn, e0: e0.ops[2], ee: ee.ops[0], p8 }));
  await undo();
  await ev(() => { const S = window.dwgApp.state; const p = S.prims.find(q => q.key === 'tu_e'); if (p) window.dwgApp.editor.doc.run({ op: 'delete', keys: ['tu_e'] }); window.dwgApp.requestRender(); });
  await ev(() => window.dwgApp.osnap.setModes([]));
  // kapalı polyline'ın açık yazılmış başı / sonu (DWG'den gelen kapalı polyline: son köşe = ilk köşe) birlikte gider
  // (üçgen büyük tutulur: küçük bir şekilde köşe, kutunun ortasındaki Taşı tutamağının isabet yarıçapına girer ve bütün şekil taşınırdı)
  await ekle([{ id: 'tu_k', type: 'LWPOLYLINE', pts: [[100, 500, 0], [250, 500, 0], [250, 650, 0], [100, 500, 0]], closed: false }]);
  await sec(['tu_k']);
  ok('3j aynı yolun çakışan başı / sonu: (100,500)\'de iki tutamak üst üste', (await kacGrip(100, 500)) === 2, String(await kacGrip(100, 500)));
  const sk = await gripAt(100, 500), hk = await scr(80, 470);
  await surukle([sk, [(sk[0] + hk[0]) / 2, (sk[1] + hk[1]) / 2], hk]);
  const pk = await primOf('tu_k');
  ok('3k baş sürüklenince son da gider: ops[0] ve ops[3] birlikte (80,470), ara köşeler yerinde', yak(pk.ops[0][1], 80, 1e-3) && yak(pk.ops[0][2], 470, 1e-3) && yak(pk.ops[3][1], 80, 1e-3) && yak(pk.ops[3][2], 470, 1e-3) && yak(pk.ops[1][1], 250) && yak(pk.ops[2][2], 650), J(pk.ops));
  await undo();
  // üst üste iki özdeş doğru: her uçta iki tutamak, ikisi birlikte gider, tek geri alma
  await ekle([{ id: 'tu_d1', type: 'LINE', pts: [[600, 550, 0], [700, 550, 0]] }, { id: 'tu_d2', type: 'LINE', pts: [[600, 550, 0], [700, 550, 0]] }]);
  await sec(['tu_d1', 'tu_d2']);
  ok('3l üst üste iki özdeş doğru: 4 tutamak, her uçta 2', (await grip()).n === 4 && (await kacGrip(700, 550)) === 2, String((await grip()).n));
  const sd = await gripAt(700, 550), hd = await scr(720, 520);
  await surukle([sd, [(sd[0] + hd[0]) / 2, (sd[1] + hd[1]) / 2], hd]);
  const d1 = await primOf('tu_d1'), dd2 = await primOf('tu_d2');
  ok('3m ikisinin de ucu birlikte (720,520)\'ye gitti', yak(d1.ops[1][1], 720, 1e-3) && yak(d1.ops[1][2], 520, 1e-3) && yak(dd2.ops[1][1], 720, 1e-3), J({ d1: d1.ops[1], d2: dd2.ops[1] }));
  await undo();
  const u1 = await primOf('tu_d1'), u2 = await primOf('tu_d2');
  ok('3n tek geri alma ikisini de (700,550)\'ye döndürür', yak(u1.ops[1][1], 700) && yak(u2.ops[1][1], 700), J({ u1: u1.ops[1], u2: u2.ops[1] }));
  // daire / yay düğüm almaz: daire + polyline seçili → yalnız polyline'ın 4 tutamağı
  await ekle([{ id: 'tu_c', type: 'CIRCLE', pts: [[650, 300, 0]], r: 30 }]);
  await sec(['tu_c', 'tu_0']);
  const gc = await grip();
  ok('3o daire + polyline: dairenin başlangıç noktasına sahte tutamak yok, yalnız polyline\'ın 4 düğümü', gc.n === 4 && gc.keys.every(k => k === 'tu_0'), J({ n: gc.n, keys: gc.keys }));
}

// ---------------------------------------------------------------------------------
// 4 · Sınırlar: 100 nesne, toplam 400 düğüm; karo açılırken neden söylenir
// ---------------------------------------------------------------------------------
{
  const cok = []; for (let i = 0; i < 101; i++) cok.push({ id: 'lim_' + i, type: 'LINE', pts: [[2000 + i * 10, 2000, 0], [2000 + i * 10, 2050, 0]] });
  await ekle(cok);
  const keys101 = cok.map(e => e.id);
  await sec(keys101);
  ok('4a 101 nesne seçili: tutamak çizilmez (0), kutu tutamağı durur', (await grip()).n === 0 && (await gizmo()) !== null, J(await grip()));
  await ekle([{ id: 'lim_pt', type: 'POINT', pts: [[2000, 2100, 0]] }]);
  await sec([...keys101.slice(0, 100), 'lim_pt']);
  ok('4a2 100 doğru + 1 nokta = 101 nesne: seçimin tamamı sayılır (GRIPOBJLIMIT), tutamak yok', (await grip()).n === 0, String((await grip()).n));
  await sec(keys101.slice(0, 100));
  ok('4b 100 nesne (sınırda): 200 tutamak', (await grip()).n === 200 && (await grip()).objs === 100, J({ n: (await grip()).n }));
  await sec(keys101);
  await temizle(); await act('grips'); await act('grips');
  ok('4c sınır aşılmışken karo açılınca neden söylenir (200 / 400 / 100)', (await grips()) === true && /200/.test(await toast()) && /400/.test(await toast()) && /100/.test(await toast()), await toast());
  const uzun = (id, x) => ({ id, type: 'LWPOLYLINE', pts: Array.from({ length: 150 }, (_, i) => [x, 3000 + i * 5, 0]), closed: false });
  await ekle([uzun('pl_a', 3000), uzun('pl_b', 3100), uzun('pl_c', 3200)]);
  await sec(['pl_a', 'pl_b']);
  ok('4d 2 × 150 = 300 düğüm: çizilir', (await grip()).n === 300, String((await grip()).n));
  await sec(['pl_a', 'pl_b', 'pl_c']);
  ok('4e 3 × 150 = 450 düğüm: toplam sınır (400) aşıldı, tutamak yok', (await grip()).n === 0, String((await grip()).n));
  // nesne başına 200'ü aşan yol atlanır, ötekilerin tutamağı kalır; tek başına seçiliyse karo nedeni söyler
  await ekle([{ id: 'pl_d', type: 'LWPOLYLINE', pts: Array.from({ length: 250 }, (_, i) => [3300, 3000 + i * 5, 0]), closed: false }]);
  await sec(['pl_d', 'tu_1']);
  const g4f = await grip();
  ok('4f 250 düğümlü yol + doğru: yalnız doğrunun 2 tutamağı (aşan yol atlanır)', g4f.n === 2 && g4f.objs === 1 && g4f.keys.every(k => k === 'tu_1'), J({ n: g4f.n, objs: g4f.objs }));
  await sec(['pl_d']); await temizle(); await act('grips'); await act('grips');
  ok('4g 250 düğümlü yol tek başına: tutamak yok, karo açılınca ileti nesne başına 200 sınırını söyler', (await grip()).n === 0 && /200/.test(await toast()), await toast());
  // araç çalışırken (Seç) karo açılırsa sınır iletisi DEĞİL "açık" iletisi: sınır yalnız gerçekten aşılınca söylenir
  await sec([]); await ev(() => { window.dwgApp.editor.act('t:select'); }); await bekle(150); await sec(['tu_0', 'tu_1']);
  await temizle(); await act('grips'); await act('grips');
  const tSel = await toast();
  ok('4h Seç aracı çalışırken (2 nesne seçili) karo: "açık" iletisi, sınır iletisi değil', /açık/.test(tSel) && !/200/.test(tSel), tSel);
  await ev(() => window.dwgApp.editor.tools.cancel()); await bekle(100);
}

// ---------------------------------------------------------------------------------
// 5 · Pencere seçiminden sonra tutamaklar kalır; kip kapalıyken hiç çıkmaz; metinler
// ---------------------------------------------------------------------------------
{
  await sec([]);
  await ev(() => { window.dwgApp.editor.act('t:select'); }); await bekle(200);
  await ev(() => { document.querySelector('#cmdBtns [data-cmd="selbox"]').click(); }); await bekle(150);
  const a = await scr(150, 550), b = await scr(520, 150);   // soldan sağa: PENCERE (tu_0 ve tu_2 tamamen içinde)
  await surukle([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b]);
  const s1 = await ev(() => ({ n: window.dwgApp.editor.sel.size, keys: [...window.dwgApp.editor.sel].map(p => p.key), running: window.dwgApp.editor.tools.running }));
  ok('5a pencere seçimi tu_0 ve tu_2\'yi aldı', s1.keys.includes('tu_0') && s1.keys.includes('tu_2'), J(s1));
  await ev(() => window.dwgApp.editor.tools.finish()); await bekle(200);
  const g = await grip(), s2 = await ev(() => ({ n: window.dwgApp.editor.sel.size, running: window.dwgApp.editor.tools.running }));
  ok('5b Bitir: araç kapandı, seçim duruyor, bütün seçili yolların tutamakları çıktı (≥ 6, tu_0 × 4 ve tu_2 × 2)', s2.running === false && s2.n >= 2 && g.n >= 6 && g.keys.filter(k => k === 'tu_0').length === 4 && g.keys.filter(k => k === 'tu_2').length === 2, J({ s2, n: g.n }));
  await act('grips');
  ok('5c kip kapalı: çoklu seçimde de tutamak yok', (await grips()) === false && (await grip()).n === 0, String((await grip()).n));
  await act('grips');
  const ip = await ev(async () => { const I = await import('./i18n.js'); const b = document.querySelector('#toolbar [data-act="grips"]'); const attrs = b ? [...b.attributes].map(x => x.value).join(' | ') : ''; const tr = I.t('th_grips') + ' | ' + attrs; const on = I.t('gripsOn'); I.setLang('en'); const en = I.t('th_grips') + ' | ' + I.t('gripsOn') + ' | ' + I.t('gripsTooMany'); I.setLang('tr'); return { tr, on, en }; });
  ok('5d karo ipucu ve kip metni çoklu seçimi söyler (TR / EN)', /çakışan köşeler birlikte/.test(ip.tr) && /yolların/.test(ip.on) && /coincident vertices move together/.test(ip.en) && /selected paths/.test(ip.en) && /100 objects/.test(ip.en), J(ip));
  await sec([]);
}

ok('X sayfa hatası yok', errors.length === 0, J(errors.slice(0, 3)));
await page.screenshot({ path: `${out}/son.png` });
await browser.close(); await srv.kill();
C.summary(); C.exit();
