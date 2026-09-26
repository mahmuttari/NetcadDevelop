// Seçim bütünlüğü (v8.9.8): bir ölçü, blok, tablo, çoklu kılavuz ya da MLINE AutoCAD'deki gibi TEK nesnedir.
//   1  sayılar nesne sayar: istem "[1 seçili]", rozet 1, "Seçim · 1 nesne", "Özellikler (1 nesne)", "Tümü (1)"
//   2  dosya varlıkları tanıtıcıyla bütün seçilir (dosya ölçüsü 9 parça, tablo 38, çoklu kılavuz 3, MLINE 2 → 1 nesne)
//   3  pencere nesnenin bütün parçalarını ister, kesen tek parçayla bütün nesneyi alır; dönen sayı nesne sayısıdır
//   4  "Benzerini seç" nesnenin bütün parçalarını ekler; istem ve rozet aynı sayıyı gösterir
//   5  çift dokunuş yalnız düzenleme bağlamında ölçü kutusunu açar (Seç aracı, fare); salt görüntülerken parmakla
//      çift dokunuş yakınlaştırır; özellik kilitliyse yükseltme kutusu çıkmaz, yakınlaştırır
// Kullanıcı isteği: "ölçülendirmeden sonra ölçüyü düzenleyemiyoruz anladığım kadarıyla. Bu konuyu çözelim."
// Kullanım: node tools/test_olcu_secim.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, askLog } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const J = JSON.stringify;
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
const ekran = async (x, y) => { const sc = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]); const r = await page.locator('#viewport').boundingBox(); return [r.x + sc[0], r.y + sc[1]]; };
const tapWorld = async (x, y) => { await ev(() => { document.getElementById('toast').hidden = true; }); const [X, Y] = await ekran(x, y); await page.touchscreen.tap(X, Y); await bekle(380); };
const ciftDokun = async (x, y) => { const [X, Y] = await ekran(x, y); await page.touchscreen.tap(X, Y); await bekle(110); await page.touchscreen.tap(X, Y); await bekle(450); };
const ciftTikla = async (x, y) => { const [X, Y] = await ekran(x, y); await page.mouse.dblclick(X, Y); await bekle(450); };
const kutuAcik = () => ev(() => { const d = document.getElementById('askDlg'); return !!d && !d.hidden ? document.getElementById('askLabel').textContent : null; });
const kutuKapat = async () => { await ev(() => { const b = document.getElementById('askNo'); if (b && !document.getElementById('askDlg').hidden) b.click(); }); await bekle(250); };
const olcek = () => ev(() => window.dwgApp.state.view.scale);
const durum = () => ev(() => ({ cmd: document.getElementById('cmdText').textContent, rozet: (document.querySelector('#selBadge .n') || {}).textContent, sel: window.dwgApp.editor.sel.size }));
const temiz = () => ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; for (const id of ['docPanel', 'proPanel']) { const e = document.getElementById(id); if (e) e.hidden = true; } window.dwgApp.editor.render && 0; });

// ---- hazırlık: makul boyutta düşey bir ölçü (600) --------------------------------------------------------------------
await ev((b) => window.dwgApp.zoomExtents(b), [0, 0, 1200, 1200]); await bekle(200);
const gid = await ev(() => {
  const T = window.dwgApp.editor.tools;
  const res = T.buildDim({ ...T.dimDefaults(), h: 20, arrow: 20, exo: 5, exe: 10, scale: 1, kind: 'linear', sub: 'vertical', pts: [[600, 300, 0], [620, 900, 0], [800, 600, 0]] }, T.annotOpts());
  T.commitMany(res.ents);
  const ps = window.dwgApp.state.scene.layouts[0].prims; for (let i = ps.length - 1; i >= 0; i--) if (ps[i].info && ps[i].info.gid && ps[i].info.t === 'DIMENSION') return ps[i].info.gid;
  return null;
});
const parca = () => ev((g) => window.dwgApp.editor.sel.size && [...window.dwgApp.editor.sel].filter(p => p.info && p.info.gid === g).length, gid);

// ---- 1. sayılar nesne sayar ---------------------------------------------------------------------------------------
await arac('t:select');
await tapWorld(800, 450);
{
  const d = await durum();
  ok('1a Seç aracında ölçüye dokunuş: istem "[1 seçili]", rozet 1, içeride 4 parça', /\[1 seçili\]/.test(d.cmd) && d.rozet === '1' && d.sel === 4, J(d));
  await ev(() => window.dwgApp.editor.selMenu()); await bekle(200);
  const bas = await ev(() => document.getElementById('docTitle') ? document.getElementById('docTitle').textContent : (document.querySelector('#docPanel h2, #docPanel .doc-title') || {}).textContent);
  ok('1b seçim menüsü başlığı "Seçim · 1 nesne"', /1 nesne/.test(bas || ''), J(bas));
  await ev(() => window.dwgApp.editor.selAction('props')); await bekle(250);
  const pr = await ev(() => ({ bas: document.getElementById('docTitle') ? document.getElementById('docTitle').textContent : '', tur: [...document.querySelectorAll('#pType option')].map(o => o.textContent) }));
  ok('1c Özellikler: "(1 nesne)" ve tür listesi "Tümü (1)", "… (1)"', /\(1 nesne\)/.test(pr.bas) && /\(1\)$/.test(pr.tur[0] || '') && pr.tur.every(x => /\(1\)$/.test(x)), J(pr));
  await ev(() => { const e = document.getElementById('docPanel'); if (e) e.hidden = true; });
}

// ---- 2. dosya varlıkları tanıtıcıyla bütün ------------------------------------------------------------------------
{
  const r = await ev(() => {
    const T = window.dwgApp.editor.tools, ps = window.dwgApp.state.scene.layouts[0].prims;
    const of = (h) => { const p = ps.find(q => q.info && q.info.h === h && q.k !== 4); if (!p) return null; const g = T.groupOf(p); return [g.length, T.objCount(g), p.info.t]; };
    return { dim: of('37E'), tablo: of('4F2'), mlead: of('640'), mline: of('75C') };
  });
  ok('2a dosya ölçüsü 37E: 9 parça tek nesne', r.dim && r.dim[0] === 9 && r.dim[1] === 1, J(r.dim));
  ok('2b tablo 4F2 (38 parça), çoklu kılavuz 640 (3), MLINE 75C (2): her biri tek nesne olarak seçilir', r.tablo && r.tablo[0] === 38 && r.tablo[1] === 1 && r.mlead && r.mlead[0] === 3 && r.mlead[1] === 1 && r.mline && r.mline[0] === 2 && r.mline[1] === 1, J(r));
}

// ---- 3. pencere / kesen -------------------------------------------------------------------------------------------
{
  const r = await ev((g) => {
    const E = window.dwgApp.editor, T = E.tools, ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g);
    const txt = ps.find(p => p.k === 1), sol = ps.find(p => p.k === 0 && p.fill);
    const bb = ps.reduce((a, p) => [Math.min(a[0], p.bb[0]), Math.min(a[1], p.bb[1]), Math.max(a[2], p.bb[2]), Math.max(a[3], p.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const say = () => [...E.sel].filter(p => p.info && p.info.gid === g).length;
    E.sel.clear();
    const n1 = T.selectRegion({ rect: [txt.bb[0] - 2, txt.bb[1] - 2, txt.bb[2] + 2, txt.bb[3] + 2] }, false), s1 = say();
    E.sel.clear();
    const o = sol.ops[0];
    const n2 = T.selectRegion({ rect: [o[1] - 0.5, o[2] - 0.5, o[1] + 0.5, o[2] + 0.5] }, true), s2 = say();
    E.sel.clear();
    const n3 = T.selectRegion({ rect: [bb[0] - 5, bb[1] - 5, bb[2] + 5, bb[3] + 5] }, false), s3 = say();
    const cmd = document.getElementById('cmdText').textContent;
    return { n1, s1, n2, s2, n3, s3, cmd };
  }, gid);
  ok('3a yalnız yazıyı çevreleyen PENCERE ölçüyü seçmez (parçalamaz)', r.s1 === 0, J(r));
  ok('3b tek oku kesen KUTU ölçünün dört parçasını birden seçer', r.s2 === 4, J(r));
  ok('3c bütün ölçüyü çevreleyen pencere: 4 parça; seçilen sayı nesne sayısı', r.s3 === 4 && /\[\d+ seçili\]/.test(r.cmd), J(r));
  // ok ucundaki kutu çizimin başka nesnelerine de dokunabilir: dönen sayı seçimdeki NESNE sayısına eşit olmalı (parça sayısına değil)
  const n = await ev((g) => { const E = window.dwgApp.editor, T = E.tools, ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g); E.sel.clear(); const sol = ps.find(p => p.k === 0 && p.fill); const o = sol.ops[0]; const n = T.selectRegion({ rect: [o[1] - 0.5, o[2] - 0.5, o[1] + 0.5, o[2] + 0.5] }, true); return { n, nesne: T.objCount(E.sel), parca: E.sel.size }; }, gid);
  ok('3d kesen kutunun döndürdüğü sayı seçilen NESNE sayısıdır (parça sayısı değil)', n.n === n.nesne && n.parca > n.nesne, J(n));
}

// ---- 4. benzerini seç -------------------------------------------------------------------------------------------------
{
  await ev((g) => { const E = window.dwgApp.editor; E.sel.clear(); for (const p of window.dwgApp.state.scene.layouts[0].prims.filter(q => q.info && q.info.gid === g)) E.sel.add(p); }, gid);
  await ev(() => window.dwgApp.editor.selAction('similar')); await bekle(250);
  const r = await ev(() => { const E = window.dwgApp.editor, T = E.tools; const m = /\[(\d+) seçili\]/.exec(document.getElementById('cmdText').textContent); const parcali = new Map(); for (const p of E.sel) { const k = T.objKey(p); parcali.set(k, (parcali.get(k) || 0) + 1); } const eksik = [...parcali.keys()].filter(k => T.groupOf([...E.sel].find(p => T.objKey(p) === k)).length !== parcali.get(k)); return { istem: m ? m[1] : null, rozet: (document.querySelector('#selBadge .n') || {}).textContent, nesne: T.objCount(E.sel), eksik }; });
  ok('4 "Benzerini seç": istem ve rozet aynı nesne sayısı; eklenen her nesne bütün parçalarıyla', r.istem === r.rozet && Number(r.rozet) === r.nesne && r.nesne >= 1 && r.eksik.length === 0, J(r));
}

// ---- 5. çift dokunuş ------------------------------------------------------------------------------------------------------
await temiz();
await arac('t:select');
{
  const s0 = await olcek(), l0 = (await askLog(page)).length;
  await ciftDokun(800, 450);
  const bas = await kutuAcik(), s1 = await olcek(), d = await durum();
  ok('5a Seç aracında ölçüye çift dokunuş "Ölçü özellikleri" kutusunu açar; yakınlaşmaz; ölçü seçili (4 parça)', /Ölçü özellikleri/.test(bas || '') && s1 === s0 && d.sel === 4, J([bas, s0, s1, d, l0]));
  await kutuKapat();
}
await temiz();
{
  const s0 = await olcek();
  await ciftDokun(800, 450);
  const bas = await kutuAcik(), s1 = await olcek();
  ok('5b salt görüntülerken (araç yok, tutamak kapalı, seçim yok) parmakla çift dokunuş yakınlaştırır, kutu açılmaz', bas === null && Math.abs(s1 / s0 - 2) < 1e-6, J([bas, s0, s1]));
  await ev((b) => window.dwgApp.zoomExtents(b), [0, 0, 1200, 1200]); await bekle(200);
}
await temiz();
{
  const s0 = await olcek();
  await ciftTikla(800, 450);
  const bas = await kutuAcik(), s1 = await olcek(), info = await ev(() => document.getElementById('infoPanel').hidden);
  ok('5c fareyle çift tıklama ölçü kutusunu açar (AutoCAD DBLCLKEDIT); yakınlaşmaz, bilgi paneli kapalı', /Ölçü özellikleri/.test(bas || '') && s1 === s0 && info === true, J([bas, s0, s1, info]));
  await kutuKapat();
}
await temiz();
{
  await ev(() => { window.__edition = 'free'; });
  const s0 = await olcek();
  await ciftTikla(800, 450);
  const bas = await kutuAcik(), s1 = await olcek(), pro = await ev(() => { const e = document.getElementById('proPanel'); return !!e && !e.hidden; });
  ok('5d özellik kilitliyken (Free) çift tıklama yükseltme kutusu açmaz, yakınlaştırır', bas === null && !pro && Math.abs(s1 / s0 - 2) < 1e-6, J([bas, pro, s0, s1]));
  await ev(() => { delete window.__edition; });
  await ev((b) => window.dwgApp.zoomExtents(b), [0, 0, 1200, 1200]); await bekle(200);
}

await page.screenshot({ path: `${out}/olcu_secim.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
