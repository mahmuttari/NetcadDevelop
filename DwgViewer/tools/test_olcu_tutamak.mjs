// Ölçü tutamakları (v8.9.8): ölçü seçilince AutoCAD'deki gibi tutamaklar çıkar — ölçülen noktalar (p1 / p2),
// ölçü çizgisinin uçları (d1 / d2) ve yazı (tx); yarıçapta merkez / çevre / yazı, açıda tepe / kollar / yay / yazı.
// Sürükleme belgeyi değiştirmez (önizleme), bırakış TEK 'replace' adımıdır; ölçü seçili kalır, geri alınınca da.
// Kullanıcı isteği: "ölçülendirmeden sonra ölçüyü düzenleyemiyoruz anladığım kadarıyla. Bu konuyu çözelim."
// Kullanım: node tools/test_olcu_tutamak.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const J = JSON.stringify;
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
const ev = (fn, a) => page.evaluate(fn, a);
const bekle = (ms = 150) => page.waitForTimeout(ms);
await ev(() => { localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); localStorage.removeItem('dimsty:' + window.dwgApp.state.fileKey); document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; window.dwgApp.osnap.setModes([]); });

const arac = async (id) => { await ev((id) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); document.getElementById('infoPanel').hidden = true; E.act(id); }, id); await bekle(200); };
const tapWorld = async (x, y) => {
  await ev(() => { document.getElementById('toast').hidden = true; });
  const sc = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]);
  const r = await page.locator('#viewport').boundingBox();
  await page.touchscreen.tap(r.x + sc[0], r.y + sc[1]);
  await bekle(380);
};
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const mk = (type, p, id = 7) => ev(([t, p, id]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerup' ? 0 : 1 })); }, [type, p, id]);
/** Ekran noktalarından geçen dokunma sürüklemesi */
const surukle = async (pts) => { await mk('pointerdown', pts[0]); for (const p of pts.slice(1)) await mk('pointermove', p); await mk('pointerup', pts[pts.length - 1]); await bekle(300); };
/** Dünya noktasındaki tutamağı dünya hedefine sürükler (ara adımlarla) */
const tutSurukle = async (id, to) => {
  const gi = await ev(() => window.dwgApp.editor.dimGripInfo());
  const i = gi.ids.indexOf(id); const a = gi.pts[i]; const b = await scr(to[0], to[1]);
  const pts = [a]; for (let k = 1; k <= 6; k++) pts.push([a[0] + (b[0] - a[0]) * k / 6, a[1] + (b[1] - a[1]) * k / 6]);
  await surukle(pts);
};
const tutDunya = (id) => ev((id) => { const g = window.dwgApp.editor.dimGripInfo(); const i = g ? g.ids.indexOf(id) : -1; return i >= 0 ? g.world[i] : null; }, id);
const sonGid = () => ev(() => { const ps = window.dwgApp.state.scene.layouts[0].prims; for (let i = ps.length - 1; i >= 0; i--) if (ps[i].info && ps[i].info.gid && ps[i].info.t === 'DIMENSION') return ps[i].info.gid; return null; });
const grup = (gid) => ev((g) => {
  const ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g);
  const core = ps.find(p => p.ent && p.ent.def), txt = ps.find(p => p.k === 1);
  return { n: ps.length, keys: ps.map(p => p.key), def: core ? core.ent.def : null, segs: core ? core.ent.segs : null, measure: core ? core.ent.measure : null, text: txt ? txt.lines.join('') : null, tx: txt ? txt.x : null, ty: txt ? txt.y : null, th: txt ? txt.h : null };
}, gid);
const gunluk = () => ev(() => { const d = window.dwgApp.editor.doc; return { log: d.log.length, u: d.undoStack.length }; });
const secSay = () => ev(() => window.dwgApp.editor.sel.size);
const fmt = (v, d) => ev(async ([v, d]) => { const St = await import('./state.js'); return St.fmt(v, d == null ? undefined : d); }, [v, d]);

// ---- 1. Düşey ölçü; Seç aracıyla seç → tutamaklar ------------------------------------------------------------------
await ev((b) => window.dwgApp.zoomExtents(b), [0, 0, 1200, 1200]); await bekle(200);
// küçük yazı: tutamaklar birbirine binmesin (varsayılan yazı çizim genişliğinden gelir)
await ev(() => window.dwgApp.editor.doc.run({ op: 'vars', set: { DIMAPP: 1, DIMTXT: 20, DIMASZ: 20, DIMEXO: 5, DIMEXE: 10, DIMSCALE: 1, DIMDEC: -1, DIMPOST: '', DIMLFAC: 1 } }));
await arac('t:dimv');
await tapWorld(200, 300); await tapWorld(200, 800); await tapWorld(500, 550);
await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); });
const g1 = await sonGid(), d1 = await grup(g1);
ok('1a düşey ölçü kuruldu (500)', d1.n === 4 && near(d1.measure, 500, 1e-2) && d1.def.sub === 'vertical', J([d1.measure, d1.def && d1.def.sub]));
await arac('t:select');
await tapWorld(500, 550);   // ölçü çizgisine dokun → dört parça birlikte seçilir
const gi1 = await ev(() => window.dwgApp.editor.dimGripInfo());
ok('1b Seç aracında ölçü seçilince beş tutamak: p1 p2 d1 d2 tx', gi1 && J(gi1.ids) === J(['p1', 'p2', 'd1', 'd2', 'tx']), J(gi1 && gi1.ids));
ok('1c tutamak yerleri: p1/p2 ölçülen noktalar, d1/d2 ölçü çizgisi x=500', gi1 && near(gi1.world[0][0], 200, 0.5) && near(gi1.world[0][1], 300, 0.5) && near(gi1.world[1][1], 800, 0.5) && near(gi1.world[2][0], 500, 0.5) && near(gi1.world[3][0], 500, 0.5), J(gi1 && gi1.world));
{
  const cmd = await ev(() => ({ txt: document.getElementById('cmdText').textContent, btn: !!document.querySelector('#cmdBtns [data-cmd="dimedit"]'), rozet: (document.querySelector('#selBadge .n') || {}).textContent }));
  ok('1d istem "[1 seçili]", rozet 1, komut çubuğunda "Ölçü özellikleri"', /\[1 seçili\]/.test(cmd.txt) && cmd.rozet === '1' && cmd.btn, J(cmd));
}

// ---- 2. p2'yi sürükle: yeniden ölçülür, tek adım, seçili kalır ----------------------------------------------------------
const l2 = await gunluk();
await tutSurukle('p2', [200, 1000]);
const d2 = await grup(g1), l2b = await gunluk();
ok('2a p2 → (200,1000): ölçü 700, ölçü çizgisi yerinde (x=500)', near(d2.measure, 700, 0.5) && near(d2.segs[2][0][0], 500, 0.5), J([d2.measure, d2.segs && d2.segs[2]]));
ok('2b yazı yeni değeri gösterir', d2.text === await fmt(d2.measure) || d2.text.startsWith((await fmt(700, 0)).slice(0, 2)), J(d2.text));
ok('2c tek geri alma adımı, aynı grup kimliği, 4 parça seçili, tutamaklar duruyor', l2b.log === l2.log + 1 && d2.n === 4 && await secSay() === 4 && !!(await ev(() => window.dwgApp.editor.dimGripInfo())), J([l2, l2b]));

// ---- 3. d1: ölçü çizgisi paralel kayar, değer değişmez --------------------------------------------------------------
await tutSurukle('d1', [650, 290]);
const d3 = await grup(g1);
ok('3a d1 → x=650: ölçü çizgisi x=650 oldu, ölçü 700 kaldı', near(d3.segs[2][0][0], 650, 0.5) && near(d3.measure, 700, 0.5), J([d3.segs[2], d3.measure]));

// ---- 4. yazı: parmağın altına gelir, ölçü çizgisi yazıyla gider ----------------------------------------------------------
const tx0 = await tutDunya('tx');
await tutSurukle('tx', [720, tx0[1] + 120]);
const d4 = await grup(g1), tx1 = await tutDunya('tx');
ok('4a yazı tutamağı bırakılan yere oturdu (tp)', d4.def.tp && near(tx1[0], 720, 2) && near(tx1[1], tx0[1] + 120, 2), J([d4.def.tp, tx1]));
// yazı ölçü çizgisinin ÜSTÜNDE durur (orta noktası çizgiden 0,35h + 0,5h = 0,85h içeride): düşey ölçüde yazı çizginin solunda
ok('4b dik bileşen ölçü çizgisini taşıdı (çizgi = yazı ortası + 0,85·h = 737), değer aynı', near(d4.segs[2][0][0], 720 + 0.85 * 20, 1) && near(d4.measure, 700, 0.5), J([d4.segs[2], d4.measure]));
// yazıyı uzatma çizgisinin dışına taşı: ölçü çizgisi yazıya kadar uzar (4. parça)
await tutSurukle('tx', [720, 1150]);
const d4b = await grup(g1);
ok('4c yazı ölçünün dışında: ölçü çizgisi yazının altına uzadı (4 çizgi parçası)', d4b.segs.length === 4, J(d4b.segs.length));

// ---- 5. geri al: eski hâl ve seçim ---------------------------------------------------------------------------------------
await ev(() => window.dwgApp.editor.act('undo')); await bekle(200);
const d5 = await grup(g1);
ok('5a geri al: yazı eski konumda (3 çizgi parçası), seçim canlı parçalarda', d5.segs.length === 3 && await ev(() => { const E = window.dwgApp.editor, S = window.dwgApp.state; return [...E.sel].every(p => S.prims.includes(p)) && E.sel.size === 4; }), J([d5.segs.length]));
await ev(() => window.dwgApp.editor.act('redo')); await bekle(200);

// ---- 6. kıpırdamayan dokunuş seçimi bozmaz; çift dokunuş kutuyu açar ----------------------------------------------------
{
  const gi = await ev(() => window.dwgApp.editor.dimGripInfo());
  const p = gi.pts[gi.ids.indexOf('p1')];
  const l6 = await gunluk();
  await mk('pointerdown', p); await mk('pointermove', [p[0] + 2, p[1] + 1]); await mk('pointerup', [p[0] + 2, p[1] + 1]); await bekle(500);
  ok('6a tutamağa kıpırdamadan dokunuş: değişiklik yok, ölçü seçili kalır', (await gunluk()).log === l6.log && await secSay() === 4);
  await queueAnswers(page, null);   // kutu açılırsa vazgeç
  await ev(() => { window.__ask = window.__ask || { queue: [], log: [] }; window.__ask.log.length = 0; });
  await mk('pointerdown', p); await mk('pointerup', p); await bekle(120); await mk('pointerdown', p); await mk('pointerup', p); await bekle(400);
  const lg = await ev(() => (window.__ask && window.__ask.log || []).map(x => x.label || x));
  ok('6b aynı tutamağa çift dokunuş "Ölçü özellikleri" kutusunu açar', lg.some(x => /Ölçü özellikleri/.test(J(x))), J(lg));
}

// ---- 7. yakalama: p2 başka çizginin ucuna oturur; kendi parçalarına oturmaz --------------------------------------------
await ev(() => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: [{ id: 'tl_1', type: 'LINE', layer: '0', color: 256, pts: [[900, 1100, 0], [1000, 1100, 0]] }] }); window.dwgApp.osnap.setModes(['end']); window.dwgApp.requestRender(); });
await bekle(200);
await tutSurukle('p2', [905, 1106]);
const d7 = await grup(g1);
ok('7 p2 çizginin ucuna (900,1100) yakalandı; düşey ölçü 800', near(d7.def.pts[1][0], 900, 1e-6) && near(d7.def.pts[1][1], 1100, 1e-6) && near(d7.measure, 800, 1e-3), J([d7.def.pts[1], d7.measure]));
await ev(() => window.dwgApp.osnap.setModes([]));

// ---- 8. Bitir'den sonra (araç yok) da tutamaklar; kutu tutamağından önce gelir ------------------------------------------
await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.finish(); });
await bekle(200);
const gi8 = await ev(() => window.dwgApp.editor.dimGripInfo());
ok('8a araç kapalıyken de tutamaklar var', !!gi8 && gi8.ids.length === 5);
await tutSurukle('d2', [800, 500]);
ok('8b araç kapalıyken d2 sürüklemesi ölçü çizgisini taşır (kutu tutamağı değil)', near((await grup(g1)).segs[2][0][0], 800, 1));

// ---- 9. yarıçap ve açı ölçüsü tutamakları -----------------------------------------------------------------------------
await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); E.doc.run({ op: 'add', ents: [{ id: 'tl_c', type: 'CIRCLE', layer: '0', color: 256, pts: [[1100, 300, 0]], r: 100 }] }); window.dwgApp.requestRender(); });
await ev((b) => window.dwgApp.zoomExtents(b), [0, 0, 1400, 1400]); await bekle(200);
await arac('t:dimr');
await tapWorld(1200, 300);
await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); });
const gr = await sonGid();
await ev((g) => { const E = window.dwgApp.editor; E.sel.clear(); for (const p of window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g)) E.sel.add(p); window.dwgApp.editor.tools.api.overlay(); }, gr);
const gi9 = await ev(() => window.dwgApp.editor.dimGripInfo());
ok('9a yarıçap ölçüsü tutamakları: c on tx', gi9 && J(gi9.ids) === J(['c', 'on', 'tx']), J(gi9 && gi9.ids));
await tutSurukle('on', [1100, 450]);
const d9 = await grup(gr);
ok('9b çevre tutamağı (1100,450): yarıçap 150', near(d9.def.r, 150, 0.5) && near(d9.measure, 150, 0.5), J([d9.def.r, d9.measure]));

// ---- 10. yarım seçim / kilitli katman / iki ölçü: tutamak yok ---------------------------------------------------------
await ev((g) => { const E = window.dwgApp.editor; E.sel.clear(); const ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g); E.sel.add(ps[0]); }, g1);
ok('10a ölçünün tek parçası seçiliyken tutamak yok', !(await ev(() => window.dwgApp.editor.dimGripInfo())));
await ev(([a, b]) => { const E = window.dwgApp.editor; E.sel.clear(); for (const p of window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && (p.info.gid === a || p.info.gid === b))) E.sel.add(p); }, [g1, gr]);
ok('10b iki ölçü seçiliyken tutamak yok (kutu kalır)', !(await ev(() => window.dwgApp.editor.dimGripInfo())));
await ev(() => window.dwgApp.editor.sel.clear());

await page.screenshot({ path: `${out}/olcu_tutamak.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
