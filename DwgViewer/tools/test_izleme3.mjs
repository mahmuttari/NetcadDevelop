/*
 * v7.73 — ÖRTÜK UZANTI İZLEMESİ (dokunmatik): aracın taban noktası (son alınan nokta) bir parçanın ucuysa o parçanın
 * uzantısı edinme gerekmeden yoldur. Kullanıcının "çizgi uzantısı yönünde izleme yakalaması çalışmadı" bildirimi:
 * dokunmatikte uca dokunup ikinci noktayı uzantı yönünde seçerken hiçbir nokta edinilmiş değildi (edinme kalem
 * beklemesi / TT ister). Denetimler: dokunuşla çizgiyi sürdürme (açılı), düz sürdürme, açıklık dışı, geri yön,
 * EXT kapalı, uç olmayan taban, yay ucu → çember yolu, polyline köşesi → iki doğrultu, TT ile edinilmiş aynı nokta
 * (yinelenen yol yok), kalem gezinmesi (ipucu "EXT … < 37°"), dokunuş sonrası kısa yol görüntüsü.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_izleme3.mjs [çıktı] [örnekler]
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
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const tapWorld = async (x, y, ms = 400) => { await bekle(100); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await scr(x, y); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(ms); };
const kalem = (type, x, y, buttons = 0) => ev(([t, x, y, b]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: b ? 0 : -1, buttons: b, pressure: b ? 0.5 : 0 })); }, [type, x, y, buttons]);
const gez = async (wx, wy, ms = 220) => { const s = await scr(wx, wy); await kalem('pointermove', s[0], s[1]); await bekle(ms); return s; };
const dokun = async (wx, wy) => { const s = await scr(wx, wy); await kalem('pointerdown', s[0], s[1], 1); await bekle(60); await kalem('pointerup', s[0], s[1], 0); await bekle(420); };
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); window.dwgApp.__trackClear(); }); await bekle(120); };
const undo = async () => { await ev(() => { window.dwgApp.editor.act('undo'); }); await bekle(120); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e) => ({ layer: '0', color: 256, ...e })) }); window.dwgApp.requestRender(); }, ents);
const track = () => ev(() => window.dwgApp.__track());
const base = () => ev(() => window.dwgApp.__trackBase());
const snapAt = (x, y) => ev(([a, b]) => window.dwgApp.__snapAt(a, b), [x, y]);
const pts = () => ev(() => window.dwgApp.editor.tools.pts.map(p => p.slice(0, 2)));
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, ops: p.ops.map(o => o.slice(0, 3)) }; });
const modes = () => ev(() => [...window.dwgApp.state.snapModes].sort().join(','));

await page.click('#toolbar [data-tab="edit"]');
const [X0, Y0] = await ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });
await ev((b) => window.dwgApp.zoomExtents(b), [X0 - 50, Y0 - 50, X0 + 900, Y0 + 900]); await bekle(250);
const TOL = await ev(() => 18 / window.dwgApp.state.view.scale);   // açıklık (dünya birimi)
const P1 = [X0, Y0], P2 = [X0 + 400, Y0 + 300], U = [0.8, 0.6], V = [-0.6, 0.8];   // 36,87° çizgi, birim yön ve dik
const perp = (q) => Math.abs((q[0] - P2[0]) * U[1] - (q[1] - P2[1]) * U[0]), along = (q) => (q[0] - P2[0]) * U[0] + (q[1] - P2[1]) * U[1];
await ekle([
  { type: 'LINE', id: 'LA', pts: [[P1[0], P1[1], 0], [P2[0], P2[1], 0]] },
  { type: 'ARC', id: 'AR', pts: [[X0 + 700, Y0 + 700, 0]], r: 100, a0: 0, a1: Math.PI / 2 },
  { type: 'LWPOLYLINE', id: 'PL', pts: [[X0 + 100, Y0 + 700, 0], [X0 + 300, Y0 + 700, 0], [X0 + 300, Y0 + 500, 0]], closed: false },
]);
ok('0 ortam: EXT ve izleme açık, ortho / kutupsal kapalı, açıklık 18 px', /(^|,)ext(,|$)/.test(await modes()) && (await track()).on && !(await ev(() => window.dwgApp.state.desk.ortho || window.dwgApp.state.desk.polar)) && TOL > 0, J([await modes(), TOL]));

// ---------------------------------------------------------------------------------
// 1 · dokunuşla çizgiyi sürdürme: uca dokun (END), uzantı yönünde 8 birim sapmayla dokun → uzantıya oturur
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await tapWorld(P2[0], P2[1]);
  const p0 = await pts();
  ok('1a ilk nokta uca oturdu (END), edinilmiş iz noktası yok', p0.length === 1 && yak(p0[0][0], P2[0]) && yak(p0[0][1], P2[1]) && (await track()).pts.length === 0, J([p0, (await track()).pts]));
  const b = await base();
  ok('1b taban noktanın örtük uzantısı: doğrultu 36,87° (tek), çember yok', b && b.dirs.length === 1 && yak(b.dirs[0], 36.8698976, 1e-6) && b.arcs.length === 0 && yak(b.p[0], P2[0]), J(b));
  const T = [P2[0] + 200 * U[0] + 8 * V[0], P2[1] + 200 * U[1] + 8 * V[1]];
  const s1 = await snapAt(T[0], T[1]);
  ok('1c uzantıya 8 birim yakın imleç: TRK, izdüşüm doğrultu üstünde (sapma 0, uçtan 200)', s1 && s1.kind === 'trk' && yak(perp(s1.p), 0, 1e-6) && yak(along(s1.p), 200, 1e-6), J(s1));
  await tapWorld(T[0], T[1], 120);
  const fl = await ev(() => { const f = window.dwgApp.state.snapFlash; return f ? { trk: !!(f.trk && f.trk.paths && f.trk.paths.length), ext: f.trk ? f.trk.paths.map(p => !!p.ext) : null, kind: f.kind } : null; });
  await bekle(300);
  const l1 = await sonPrim();
  ok('1d dokunuş uzantıya TAM oturdu: çizgi ucu doğrultuda (sapma 0); dokunuş sonrası kısa süre EXT yolu gösterilir', yak(perp([l1.ops[1][1], l1.ops[1][2]]), 0, 1e-6) && yak(along([l1.ops[1][1], l1.ops[1][2]]), 200, 1e-3) && fl && fl.trk && fl.ext[0] === true, J([l1.ops, fl]));
  // taban artık yeni uç: az önce çizilen parçanın doğrultusu — düz sürdürme
  const b2 = await base();
  const P3 = [l1.ops[1][1], l1.ops[1][2]];
  ok('1e taban yeni uca geçti: az önce çizilen parçanın doğrultusu (36,87°) örtük yol', b2 && yak(b2.p[0], P3[0]) && b2.dirs.length === 1 && yak(b2.dirs[0], 36.8698976, 1e-6), J(b2));
  await tapWorld(P3[0] + 150 * U[0] - 10 * V[0], P3[1] + 150 * U[1] - 10 * V[1]);
  const l2 = await sonPrim();
  ok('1f düz sürdürme: ikinci parça da aynı doğrultuda (sapma 0, boy 150)', yak(perp([l2.ops[1][1], l2.ops[1][2]]), 0, 1e-6) && yak(along([l2.ops[1][1], l2.ops[1][2]]), 350, 1e-3), J(l2.ops));
  await shot('izleme3_1');
  await iptal(); await undo(); await undo();
}

// ---------------------------------------------------------------------------------
// 2 · sınırlar: açıklık dışı, geri yön (parçanın üstü), EXT kapalı, uç olmayan taban
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await tapWorld(P2[0], P2[1]);
  const uzak = [P2[0] + 200 * U[0] + (TOL + 20) * V[0], P2[1] + 200 * U[1] + (TOL + 20) * V[1]];
  ok('2a açıklığın dışındaki imleç yola oturmaz', (await snapAt(uzak[0], uzak[1])) === null, J(await snapAt(uzak[0], uzak[1])));
  const geri = [P2[0] - 150 * U[0] + 3 * V[0], P2[1] - 150 * U[1] + 3 * V[1]];
  const sg = await snapAt(geri[0], geri[1]);
  ok('2b uzantı yalnız uçtan DIŞARI: parçanın kendi üstündeki imleç uzantı yolu vermez (yakalama yoksa null)', !sg || sg.kind !== 'trk', J(sg));
  await ev(() => window.dwgApp.osnap.setModes(['end', 'mid', 'cen', 'int', 'ins', 'node']));
  const T = [P2[0] + 200 * U[0] + 8 * V[0], P2[1] + 200 * U[1] + 8 * V[1]];
  ok('2c EXT kipi kapalıyken örtük uzantı yok (AutoCAD: uzantı EXT yakalamasına bağlı)', (await base()) === null && (await snapAt(T[0], T[1])) === null, J([await base(), await snapAt(T[0], T[1])]));
  await ev(() => window.dwgApp.osnap.setModes(['end', 'mid', 'cen', 'int', 'ext', 'ins', 'node']));
  ok('2d EXT geri gelince yol yeniden var', !!(await base()) && (await snapAt(T[0], T[1])).kind === 'trk', '');
  await iptal();
  await arac('t:line');
  await tapWorld(X0 + 600, Y0 + 100);   // boş yer: hiçbir parçanın ucu değil
  ok('2e taban bir parçanın ucu değilse örtük uzantı yok', (await base()) === null && (await snapAt(X0 + 700, Y0 + 105)) === null, J([await pts(), await base()]));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 3 · yay ucu → çember yolu; polyline köşesi → iki doğrultu (0° ve 90°)
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await tapWorld(X0 + 800, Y0 + 700);   // yayın 0° ucu
  const b = await base();
  ok('3a yay ucu taban: çember yolu (merkez (700,700), r 100), doğrultu yok', b && b.arcs.length === 1 && yak(b.arcs[0].r, 100, 1e-6) && yak(b.arcs[0].c[0], X0 + 700, 1e-6) && b.dirs.length === 0, J(b));
  const a = -Math.PI / 4, W = [X0 + 700 + 104 * Math.cos(a), Y0 + 700 + 104 * Math.sin(a)];
  const s = await snapAt(W[0], W[1]);
  ok('3b çemberin devamındaki imleç (−45°, 4 birim dışarı) çembere ışınsal oturur (r = 100)', s && s.kind === 'trk' && yak(Math.hypot(s.p[0] - (X0 + 700), s.p[1] - (Y0 + 700)), 100, 1e-6), J(s));
  await iptal();
  await arac('t:line');
  await tapWorld(X0 + 300, Y0 + 700);   // polyline köşesi
  const b2 = await base();
  ok('3c polyline köşesi taban: iki doğrultu — 0° (yatay parçanın dışa devamı) ve 90° (düşey parçanın)', b2 && b2.dirs.length === 2 && b2.dirs.some(d => yak(d, 0, 1e-6)) && b2.dirs.some(d => yak(d, 90, 1e-6)), J(b2));
  const s2 = await snapAt(X0 + 450, Y0 + 706), s3 = await snapAt(X0 + 305, Y0 + 850);
  ok('3d yatay uzantıya (450, 700) ve düşey uzantıya (300, 850) oturur', s2 && s2.kind === 'trk' && yak(s2.p[0], X0 + 450, 1e-6) && yak(s2.p[1], Y0 + 700, 1e-6) && s3 && s3.kind === 'trk' && yak(s3.p[0], X0 + 300, 1e-6) && yak(s3.p[1], Y0 + 850, 1e-6), J([s2, s3]));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 5 · nesne yakalaması izi yener: uzantı üstünde bir ucun yakınındaki dokunuş uca (END) oturur
// ---------------------------------------------------------------------------------
{
  const Q = [P2[0] + 300 * U[0], P2[1] + 300 * U[1]];
  await ekle([{ type: 'LINE', id: 'LB', pts: [[Q[0], Q[1] + 5, 0], [Q[0] + 100, Q[1] + 205, 0]] }]);   // ucu uzantının 5 birim yanında
  await arac('t:line');
  await tapWorld(P2[0], P2[1]);
  const s = await snapAt(Q[0] + 2, Q[1] + 4);
  ok('5a uzantı yakınındaki gerçek uç (END) izi yener', s && s.kind === 'end' && yak(s.p[1], Q[1] + 5, 1e-6), J(s));
  await iptal(); await undo();
}

// ---------------------------------------------------------------------------------
// 4 · KALEM (bu bölümden sonra parmak dokunuşu avuç içi sayılıp elenir — tasarım gereği, bölüm en sonda): TT ile aynı nokta edinilince
//     örtük kayıt eklenmez (yinelenen yol yok); edinme olmadan gezinen kalem örtük uzantıya oturur, ipucu "EXT 200 < 37°"
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await tapWorld(P2[0], P2[1]);
  await page.click('#cmdTt'); await bekle(120);
  await dokun(P2[0], P2[1]);
  const tr = await track();
  ok('4a TT ile uç edinildi (dirs 36,87°); örtük taban artık yok (edinilen esas)', tr.pts.length === 1 && yak(tr.pts[0].dirs[0], 36.8698976, 1e-6) && (await base()) === null, J([tr.pts, await base()]));
  const T = [P2[0] + 200 * U[0] + 8 * V[0], P2[1] + 200 * U[1] + 8 * V[1]];
  await gez(T[0], T[1], 250);
  const h = (await track()).hover;
  ok('4b kalem uzantıda: TEK yol (yinelenmez), EXT, ipucu "EXT 200 < 37°"', h && h.n === 1 && h.ext[0] === true && /^EXT 200 < 37°$/.test(h.text) && yak(perp(h.p), 0, 1e-6), J(h));
  await iptal();
  // örtük yol kalemle: edinme olmadan gezinen kalem de uzantıya oturur ve dokunuşu oraya işler
  await arac('t:line');
  await dokun(P2[0], P2[1]);
  await gez(T[0], T[1], 250);
  const h2 = (await track()).hover;
  ok('4c edinme olmadan gezinen kalem (ilk nokta kalemle) örtük uzantıya oturur: ipucu "EXT 200 < 37°", tek yol', h2 && h2.n === 1 && h2.ext[0] === true && /^EXT 200 < 37°$/.test(h2.text) && (await track()).pts.length === 0, J(h2));
  await shot('izleme3_kalem');
  await dokun(T[0], T[1]);
  const l = await sonPrim();
  ok('4d kalem dokunuşu uzantıya oturdu (sapma 0, uçtan 200)', yak(perp([l.ops[1][1], l.ops[1][2]]), 0, 1e-6) && yak(along([l.ops[1][1], l.ops[1][2]]), 200, 1e-3), J(l.ops));
  await iptal(); await undo();
}

// ---------------------------------------------------------------------------------
// 6 · KUTUPSAL açıkken (yardım, kısıt değil) uzantı yolu yine kazanır; ORTHO açıkken (gerçek kısıt) uzantı yolu yok, kilit
// ---------------------------------------------------------------------------------
{
  const T = [P2[0] + 200 * U[0] + 8 * V[0], P2[1] + 200 * U[1] + 8 * V[1]];
  await ev(() => { window.dwgApp.state.desk.polar = true; window.dwgApp.state.desk.ortho = false; });
  await arac('t:line');
  await dokun(P2[0], P2[1]);
  const sP = await snapAt(T[0], T[1]);
  await gez(T[0], T[1], 250);
  const hP = (await track()).hover;
  ok('6a kutupsal açık: imleç 36,87° uzantısında → yol kazanır (kutupsal 45° değil), ipucu EXT', sP && sP.kind === 'trk' && yak(perp(sP.p), 0, 1e-6) && hP && hP.ext[0] === true && !hP.lock, J([sP, hP]));
  await dokun(T[0], T[1]);
  const lP = await sonPrim();
  ok('6b kutupsalda dokunuş uzantıya oturdu (kutupsal açıya değil)', yak(perp([lP.ops[1][1], lP.ops[1][2]]), 0, 1e-6), J(lP.ops));
  await iptal(); await undo();
  await ev(() => { window.dwgApp.state.desk.polar = false; window.dwgApp.state.desk.ortho = true; });
  await arac('t:line');
  await dokun(P2[0], P2[1]);
  const sO = await snapAt(T[0], T[1]);
  await gez(T[0], T[1], 250);
  const hO = (await track()).hover;
  ok('6c ortho açık: açılı uzantı yolu alınmaz (kilit doğrusunu kesmez) → izleme yok', sO === null && hO === null, J([sO, hO]));
  // ortho kilidi × uzantı kesişimi: taban (P2) +x doğrusu, başka bir çizginin uzantısı onu keser
  await ekle([{ type: 'LINE', id: 'LC', pts: [[P2[0] + 300, P2[1] + 200, 0], [P2[0] + 300, P2[1] + 100, 0]] }]);   // düşey, ucu (P2+300, P2+100)
  await ev(([x, y]) => window.dwgApp.__trackAdd(x, y, 'end'), [P2[0] + 300, P2[1] + 100]);
  await gez(P2[0] + 296, P2[1] + 15, 250);
  const hX = (await track()).hover;
  ok('6d ortho kilidi (+x) × düşey uzantı (x = P2+300) → kesişim (P2+300, P2y), kilit', hX && hX.lock && yak(hX.p[0], P2[0] + 300, 1e-6) && yak(hX.p[1], P2[1], 1e-6), J(hX));
  await iptal(); await undo();
  await ev(() => { window.dwgApp.state.desk.polar = false; window.dwgApp.state.desk.ortho = false; });
}

await browser.close();
await srv.kill();
C.summary(errors);
C.exit();
