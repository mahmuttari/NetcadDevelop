// Ölçüler DXF'e GERÇEK DIMENSION olarak yazılır ve yeniden açılınca düzenlenebilir kalır (v8.9.8).
// Kullanıcı isteği: "ölçülendirmeden sonra ölçüyü düzenleyemiyoruz anladığım kadarıyla. Bu konuyu çözelim."
// Kök nedenlerden biri: DWG yazılamadığı için her kayıt DXF'ten geçer ve ölçü eskiden gevşek çizgi + ok + yazı olarak
// yazılıyordu (üstelik çizgiler tek LWPOLYLINE'da zikzak çiziyordu); dosya yeniden açılınca ölçü artık ölçü değildi.
// Burada sınanan:
//   1-2  uygulama ölçüleri (hizalı, yatay, düşey, dönük, yarıçap, çap, iki açısal, ASCII dışı yazı, genel ölçek 0,5):
//        her biri tek DIMENSION + anonim *D bloğu + ACAD DSTYLE + uygulamanın tam tanımı (XDATA DWGOFFICEZIP)
//   3    yeniden açılınca tanım BİREBİR geri gelir, geometri ve yazı aynı, tek kez çizilir, ölçü tutamakları çıkar
//   4    yeniden açılan ölçü düzenlenir, ikinci kuşak kayıt da ölçüleri korur
//   5    AutoCAD'de değiştirilmiş (XDATA'sı bayat) ölçü tanımını DXF alanlarından kurar
//   6    benimsenen ölçü taşınır / döndürülerek kopyalanır / panoya kopyalanıp yapıştırılır ve hâlâ düzenlenir
//   7    AutoCAD'in kendi ölçüleri (pface_full.dxf, example_2000.dwg) kayıtta DIMENSION olarak kalır
//   8    DSTYLE okuyucusu: DIMPOST'tan sonraki geçersiz kılmalar yitmez; dosya ölçüsü taşınıp düzenlenince yeni yerinde
//        kurulur; kopyası tek nesne kalır (yetim parça yok)
// Kullanım: node tools/test_olcu_dxf.mjs [çıktı] [örnekler]
import fs from 'node:fs';
import path from 'node:path';
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
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
const ev = (fn, a) => page.evaluate(fn, a);
const temizle = () => ev(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('edits:') || k.startsWith('dimsty:')) localStorage.removeItem(k); });
const ac = async (f) => { await temizle(); await openFile(page, f, { settle: 300 }); await temizle(); };
const cnt = (s, re) => (s.match(re) || []).length;
const DIM_RE = /\r\n0\r\nDIMENSION\r\n/g, DBLK_RE = /\r\n2\r\n\*D\d+\r\n70\r\n1\r\n/g;
const dxfYaz = (o = {}) => ev(async (o) => {
  const S = window.dwgApp.state, Ed = await import('./edit.js'), St = await import('./state.js');
  const dimFmt = { prec: St.S.prec, pad: !!St.S.precPad, dsep: St.sepOf().ondalik || '.' };
  return Ed.writeDxf(S.scene.layouts[0].prims, S.layers, { dimFmt, onlyEdited: !!o.onlyEdited, ltypes: S.ltypes, units: 0, blocks: S.blocks, vars: S.vars, ...(o.extra || {}) });
}, o);
const yaz = (ad, txt) => { const f = path.join(out, ad); fs.writeFileSync(f, txt); return f; };
// ölçü grubunun imzası: bütün doğru parçaları ve yaylar (yuvarlanmış), yazının yeri
const IMZA = `(ps) => { const segs = []; for (const q of ps) if (q.k === 0) { let last = null; for (const o of q.ops) { if (o[0] === 0) last = [o[1], o[2]]; else if (o[0] === 1) { segs.push([last[0], last[1], o[1], o[2]].map(v => Math.round(v * 1e3) / 1e3)); last = [o[1], o[2]]; } else if (o[0] === 2 || o[0] === -2) segs.push(['arc', o[1], o[2], o[3]].map(v => typeof v === 'number' ? Math.round(v * 1e3) / 1e3 : v)); } } return segs; }`;
const segKey = (s) => s.filter(q => !(q[0] !== 'arc' && q[0] === q[2] && q[1] === q[3])).map(q => q.join(',')).sort().join(';');   // SOLID'in 4. köşesi (= 3.) sıfır boylu kenar verir

// ---- 1. uygulama ölçüleri ------------------------------------------------------------------------------------------
await ac(`${SM}/example_2000.dwg`);
const made = await ev((IMZA) => {
  const imza = eval(IMZA);
  const E = window.dwgApp.editor, T = E.tools, S = window.dwgApp.state;
  const base = { ...T.dimDefaults(), h: 20, arrow: 20, exo: 5, exe: 10, scale: 1 };
  const mk = (def) => { const res = T.buildDim({ ...base, ...def }, T.annotOpts()); if (res) T.commitMany(res.ents); return !!res; };
  mk({ kind: 'linear', sub: 'aligned', pts: [[200, 300, 0], [700, 400, 0], [180, 520, 0]] });
  mk({ kind: 'linear', sub: 'horizontal', pts: [[1000, 1000, 0], [1300, 1100, 0], [1000, 1200, 0]], prec: 1, prefix: 'L=', suffix: ' mm', factor: 2 });
  mk({ kind: 'linear', sub: 'vertical', pts: [[1500, 200, 0], [1500, 1320, 0], [1700, 700, 0]], text: 'Toplam <>' });
  mk({ kind: 'linear', sub: 'rotated', rot: Math.PI / 6, pts: [[100, 1500, 0], [400, 1600, 0], [100, 1800, 0]], h: 30, arrow: 25, exo: 4, exe: 9, prec: 0 });
  E.addEnts([{ type: 'CIRCLE', pts: [[1500, 1500, 0]], r: 100, layer: '0', color: 1 }]);
  mk({ kind: 'radial', sub: 'radius', pts: [[1500, 1500, 0], [1600, 1560, 0]], r: 100, prefix: 'R ' });
  mk({ kind: 'radial', sub: 'diameter', pts: [[1500, 1500, 0], [1400, 1450, 0]], r: 100, prefix: '⌀ ', scale: 0.5 });
  mk({ kind: 'angular', pts: [[1800, 1800, 0], [1950, 1800, 0], [1800, 1950, 0]], prec: 2, suffix: '°' });
  mk({ kind: 'angular', pts: [[2200, 1800, 0], [2100, 1700, 0], [2300, 1750, 0]], prec: 1, suffix: '°', r: 60 });
  mk({ kind: 'linear', sub: 'aligned', pts: [[300, 800, 0], [600, 800, 0], [450, 700, 0]], text: 'SABİT {x} \\ y' });
  mk({ kind: 'linear', sub: 'horizontal', pts: [[2500, 300, 0], [2900, 300, 0], [2500, 450, 0]], scale: 0.5 });   // genel ölçek (DIMSCALE) 0,5
  const outp = [], seen = new Set();
  for (const p of S.scene.layouts[0].prims) {
    const g = p.info && p.info.gid; if (!g || p.info.t !== 'DIMENSION' || seen.has(g)) continue; seen.add(g);
    const ps = S.scene.layouts[0].prims.filter(q => q.info && q.info.gid === g);
    const core = ps.find(q => q.ent && q.ent.def), txt = ps.find(q => q.k === 1);
    outp.push({ gid: g, n: ps.length, def: core.ent.def, text: txt.lines.join('\n'), tpos: [txt.x, txt.y, txt.h, txt.rot], segs: imza(ps) });
  }
  return outp;
}, IMZA);
ok('1 on uygulama ölçüsü kuruldu (genel ölçek 0,5 olan ikisi dâhil)', made.length === 10 && made.filter(m => m.def.scale === 0.5).length === 2, String(made.length));

// ---- 2. DXF yapısı ---------------------------------------------------------------------------------------------------
const delta = await dxfYaz({ onlyEdited: true });
const fDelta = yaz('olcu_delta.dxf', delta);
ok('2a her ölçü tek DIMENSION + anonim *D bloğu; ölçü çizgileri zikzak LWPOLYLINE değil', cnt(delta, DIM_RE) === 10 && cnt(delta, DBLK_RE) === 10 && cnt(delta, /\r\nLWPOLYLINE\r\n/g) === 0, J({ dim: cnt(delta, DIM_RE), blk: cnt(delta, DBLK_RE), lw: cnt(delta, /\r\nLWPOLYLINE\r\n/g) }));
ok('2b APPID tablosunda ACAD ve DWGOFFICEZIP; DIMSTYLE kaydının tanıtıcısı 105 kodunda', /\r\n0\r\nTABLE\r\n2\r\nAPPID\r\n/.test(delta) && /\r\n2\r\nDWGOFFICEZIP\r\n/.test(delta) && /\r\n0\r\nDIMSTYLE\r\n105\r\n/.test(delta));
ok('2c Türkçe arayüzde DIMDSEP 44 (virgül); genel ölçek DSTYLE DIMSCALE 0,5 olarak yazıldı', /\r\n1070\r\n278\r\n1070\r\n44\r\n/.test(delta) && /\r\n1070\r\n40\r\n1040\r\n0\.5\r\n/.test(delta));
ok('2d ASCII dışı yazı \\U+ kaçışıyla (⌀ → \\U+2300, İ → \\U+0130)', /\\U\+2300/.test(delta) && /\\U\+0130/.test(delta) && !/[^\x00-\x7f]/.test(delta));

// ---- 3. yeniden aç: tanım birebir, tek çizim, tutamaklar -----------------------------------------------------------------
await ac(fDelta);
const back = await ev((IMZA) => {
  const imza = eval(IMZA);
  const S = window.dwgApp.state, T = window.dwgApp.editor.tools;
  const by = new Map();
  for (const p of S.scene.layouts[0].prims) { const i = p.info; if (!i || i.t !== 'DIMENSION' || !i.dim) continue; if (!by.has(i.h)) by.set(i.h, []); by.get(i.h).push(p); }
  const outp = [];
  for (const [h, ps] of by) {
    const info = ps[0].info, txt = ps.find(q => q.k === 1), core = ps.find(q => q.ent && q.ent.def);
    outp.push({ h, gid: info.gid, n: ps.length, ets: ps.map(q => q.et), app: !!info.dim.app, def: T.dimDefFromFile(info.dim, ps), coreDef: core ? core.ent.def : null,
      text: txt ? txt.lines.join('\n') : null, tpos: txt ? [txt.x, txt.y, txt.h, txt.rot] : null, segs: imza(ps) });
  }
  return { groups: outp, total: S.scene.layouts[0].prims.length };
}, IMZA);
ok('3a yeniden açıldı: 10 ölçü, hepsi uygulama tanımıyla benimsendi (gid "D" + tanıtıcı)', back.groups.length === 10 && back.groups.every(g => g.app && g.gid === 'D' + g.h), J(back.groups.map(g => [g.h, g.gid, g.app])));
ok('3b her ölçü *D bloğundan TEK kez çizildi (ölçü dışında yalnız çember var); tanım taşıyan parça (et DIMENSION) bir tane, yazı MTEXT', back.groups.every(g => g.ets.filter(e => e === 'DIMENSION').length === 1 && g.ets.includes('MTEXT')) && back.total === back.groups.reduce((n, g) => n + g.n, 0) + 1, J([back.total, back.groups.map(g => g.ets.join('/'))]));
{
  let defSame = 0, geoSame = 0; const bozuk = [];
  for (let i = 0; i < made.length && i < back.groups.length; i++) {
    const m = made[i], b = back.groups[i];
    const d1 = J(m.def) === J(b.def) && J(m.def) === J(b.coreDef);
    const g1 = m.text === b.text && segKey(m.segs) === segKey(b.segs) && m.tpos.every((v, k) => Math.abs(v - b.tpos[k]) < 1e-5);
    if (d1) defSame++; if (g1) geoSame++;
    if (!d1 || !g1) bozuk.push({ i, kind: m.def.kind, sub: m.def.sub, d1, g1, a: d1 ? '' : J(m.def), b: d1 ? '' : J(b.def), ta: m.text, tb: b.text });
  }
  ok('3c on ölçünün tanımı BİREBİR geri geldi (tür, noktalar, yazı, ön / son ek, çarpan, ondalık, genel ölçek)', defSame === 10, J(bozuk));
  ok('3d yazı ve geometri aynı (çizgiler, yaylar, yazı yeri / boyu / açısı)', geoSame === 10, J(bozuk));
}
{
  const r = await ev(async (h) => {
    const E = window.dwgApp.editor, S = window.dwgApp.state;
    const ps = S.scene.layouts[0].prims.filter(p => p.info && p.info.h === h && p.info.t === 'DIMENSION');
    E.sel.clear(); for (const p of ps) E.sel.add(p); window.dwgApp.editor.render && window.dwgApp.editor.render();
    const gi = E.dimGripInfo(); E.sel.clear();
    return gi ? gi.ids : null;
  }, back.groups[0].h);
  ok('3e yeniden açılan ölçü seçilince ölçü tutamakları çıkar (p1 p2 d1 d2 tx)', J(r) === J(['p1', 'p2', 'd1', 'd2', 'tx']), J(r));
}

// ---- 4. yeniden açılan ölçü düzenlenir; ikinci kuşak -------------------------------------------------------------------
await queueAnswers(page, { prefix: 'P=', prec: '2' });
const ed = await ev(async (h) => {
  const S = window.dwgApp.state, E = window.dwgApp.editor;
  const p = S.scene.layouts[0].prims.find(q => q.info && q.info.h === h && q.info.t === 'DIMENSION');
  const r = await E.tools.editDims([p]);
  const grp = S.scene.layouts[0].prims.filter(q => q.info && q.info.gid === p.info.gid);
  return { r, n: grp.length, text: (grp.find(q => q.k === 1) || { lines: [''] }).lines.join(''), def: (grp.find(q => q.ent && q.ent.def) || { ent: {} }).ent.def };
}, back.groups[0].h);
ok('4a yeniden açılan ölçü "Ölçü özellikleri" ile düzenlendi (aynı grup, 4 parça, P= ön eki)', ed.r === true && ed.n === 4 && ed.text.startsWith('P='), J([ed.r, ed.n, ed.text]));
const gen2 = await dxfYaz({ onlyEdited: false });
const fGen2 = yaz('olcu_kusak2.dxf', gen2);
await ac(fGen2);
const g2 = await ev(() => { const S = window.dwgApp.state, T = window.dwgApp.editor.tools; const hs = new Map(); for (const p of S.scene.layouts[0].prims) { const i = p.info; if (i && i.t === 'DIMENSION' && i.dim && i.dim.app) { if (!hs.has(i.h)) hs.set(i.h, []); hs.get(i.h).push(p); } } return [...hs.values()].map(ps => ({ gid: ps[0].info.gid, def: T.dimDefFromFile(ps[0].info.dim, ps) })); });
ok('4b ikinci kuşak dosya: 10 ölçü de benimsendi, düzenleme korundu', g2.length === 10 && g2.every(g => g.gid) && g2.some(g => J(g.def) === J(ed.def)), String(g2.length));

// ---- 5. bayat XDATA (AutoCAD'de uzatılmış ölçü) -----------------------------------------------------------------------
{
  const L = delta.split('\r\n');
  let j = L.indexOf('DIMENSION'); while (L[j] !== '13') j++;
  L[j + 1] = String(parseFloat(L[j + 1]) + 50);
  await ac(yaz('olcu_bayat.dxf', L.join('\r\n')));
  const st = await ev(() => { const S = window.dwgApp.state, T = window.dwgApp.editor.tools; const p0 = S.scene.layouts[0].prims.find(p => p.info && p.info.t === 'DIMENSION' && p.info.dim); const ps = S.scene.layouts[0].prims.filter(q => q.info === p0.info); return { app: !!p0.info.dim.app, gid: p0.info.gid || null, own: T.appDimDef(p0.info.dim), def: T.dimDefFromFile(p0.info.dim, ps) }; });
  ok('5 bayat XDATA fark edildi: benimsenmez, tanım uzatılmış 13 noktasından (250) kurulur', st.app && st.gid === null && st.own === null && Math.abs(st.def.pts[0][0] - 250) < 1e-9, J([st.gid, st.own, st.def && st.def.pts]));
}

// ---- 6. benimsenen ölçü: taşı / döndürerek kopyala / pano -------------------------------------------------------------
await ac(fDelta);
{
  const r = await ev(async () => {
    const S = window.dwgApp.state, E = window.dwgApp.editor, T = E.tools;
    const ps0 = () => S.scene.layouts[0].prims;
    const gids = [...new Set(ps0().filter(p => p.info && p.info.t === 'DIMENSION').map(p => p.info.gid))];
    const keysOf = (g) => ps0().filter(p => p.info && p.info.gid === g).map(p => p.key);
    const coreOf = (g) => ps0().find(p => p.info && p.info.gid === g && p.ent && p.ent.def);
    const byDef = (f) => gids.find(g => { const c = coreOf(g); return c && f(c.ent.def); });
    const g0 = byDef(d => d.sub === 'aligned' && d.pts[0][0] === 200), g1 = byDef(d => d.sub === 'horizontal' && d.prefix === 'L=');
    E.runCmd({ op: 'xform', keys: keysOf(g0), m: [1, 0, 0, 1, 1000, 0], dz: 0 });
    const nk = keysOf(g1).map((_, i) => 'cp' + i);
    E.runCmd({ op: 'copy', keys: keysOf(g1), newKeys: nk, m: [0, 1, -1, 0, 0, 0], dz: 0 });   // 90° döndürülmüş kopya
    const gc = ps0().find(p => p.key === 'cp0').info.gid;
    window.__ask = window.__ask || { queue: [], log: [] };
    window.__ask.queue.push({ prefix: 'M=' }); await T.editDims([coreOf(g0)]);
    window.__ask.queue.push({ prefix: 'C=' }); await T.editDims([coreOf(gc)]);
    const son = (pre) => { const t = ps0().find(p => p.k === 1 && p.info && p.info.t === 'DIMENSION' && p.lines[0].includes(pre)); const g = t && t.info.gid; return g ? { n: ps0().filter(p => p.info && p.info.gid === g).length, def: coreOf(g).ent.def } : null; };
    return { adopted: gids.length, gc, g1, m: son('M='), c: son('C='), orig1: coreOf(g1).ent.def };
  });
  ok('6a taşınan ölçü düzenlenince YENİ yerinde kurulur (x 200 → 1200)', r.adopted === 10 && r.m && r.m.n === 4 && Math.abs(r.m.def.pts[0][0] - 1200) < 1e-6, J([r.adopted, r.m && r.m.def.pts]));
  ok('6b 90° döndürülmüş kopya ayrı grup; düzenlenince kopya düşey kurulur, aslı yatay kalır', r.gc !== r.g1 && r.c && r.c.n === 4 && r.c.def.sub === 'vertical' && r.orig1.sub === 'horizontal', J([r.c && r.c.def.sub]));
  const gen3 = await dxfYaz({ onlyEdited: false });
  await ac(yaz('olcu_kusak3.dxf', gen3));
  const g3 = await ev(() => { const S = window.dwgApp.state; const gs = new Map(); for (const p of S.scene.layouts[0].prims) if (p.info && p.info.t === 'DIMENSION' && p.info.dim) { const g = p.info.h; if (!gs.has(g)) gs.set(g, { core: null, text: '' }); const G = gs.get(g); if (p.ent && p.ent.def) G.core = p.ent.def; if (p.k === 1) G.text = p.lines[0]; } return [...gs.values()].map(g => ({ adopted: !!g.core, text: g.text, x0: g.core && g.core.pts[0][0] })); });
  ok('6c üçüncü kuşak: 11 ölçü (10 + kopya), hepsi benimsendi, düzenlemeler yerinde', g3.length === 11 && g3.every(g => g.adopted) && g3.some(g => g.text.startsWith('M=') && Math.abs(g.x0 - 1200) < 1e-6) && g3.some(g => g.text.includes('C=')), J(g3.map(g => [g.adopted, g.text])));
}
{
  const r = await ev(async () => {
    const S = window.dwgApp.state, E = window.dwgApp.editor, T = E.tools;
    const core = S.scene.layouts[0].prims.find(p => p.info && p.info.t === 'DIMENSION' && p.info.gid && String(p.info.gid).startsWith('D') && p.ent && p.ent.def);
    E.sel.clear(); for (const p of S.scene.layouts[0].prims.filter(q => q.info && q.info.gid === core.info.gid)) E.sel.add(p);
    window.dwgApp.action('copyclip'); await new Promise(r => setTimeout(r, 300));
    window.dwgApp.action('pasteclip'); await new Promise(r => setTimeout(r, 400));
    const cs = [...E.sel], pc = cs.find(p => p.ent && p.ent.def);
    if (!pc) return { pasted: cs.length, core: false };
    const turler = [...new Set(cs.map(p => p.info && p.info.t))];
    window.__ask = window.__ask || { queue: [], log: [] }; window.__ask.queue.push({ prefix: 'Y=' });
    const okk = await T.editDims([pc]);
    const t = S.scene.layouts[0].prims.find(p => p.k === 1 && p.lines[0].includes('Y='));
    return { pasted: cs.length, core: true, turler, ok: okk, text: t && t.lines[0] };
  });
  ok('6d panoya kopyalanıp yapıştırılan ölçü düzenlenebilir; oku ve yazısı da "ölçü" türünde (ölçüleri gizle süzgeci)', r.core && J(r.turler) === J(['DIMENSION']) && r.ok === true && !!r.text, J(r));
}

// ---- 7. AutoCAD'in kendi ölçüleri kayıtta DIMENSION kalır ---------------------------------------------------------------
{
  const snap = () => ev((IMZA) => { const imza = eval(IMZA); const S = window.dwgApp.state, T = window.dwgApp.editor.tools; const by = new Map(); for (const p of S.scene.layouts[0].prims) { const i = p.info; if (i && i.t === 'DIMENSION' && i.dim) { if (!by.has(i.h)) by.set(i.h, []); by.get(i.h).push(p); } }
    return [...by.values()].map(ps => { const d = ps[0].info.dim; let def = null; try { def = T.dimDefFromFile(d, ps); } catch (e) { def = 'ERR ' + e.message; } const t = ps.find(q => q.k === 1);
      return { type: d.type, n: ps.length, def, text: t ? t.lines.join('|') : null, segs: imza(ps).filter(s => s[0] !== 'arc'), lay: ps[0].info.lay, col: ps[0].col }; }); }, IMZA);
  await ac(`${SM}/pface_full.dxf`);
  const A = await snap();
  const t7 = await dxfYaz({ onlyEdited: false });
  await ac(yaz('olcu_pface.dxf', t7));
  const B = await snap();
  const nonOrd = A.filter(g => g.type !== 6);
  ok('7a pface_full: ordinat dışı bütün ölçüler kayıttan sonra DIMENSION (ordinatlar patlatılmış yazılır)', nonOrd.length === 6 && B.length === nonOrd.length && cnt(t7, DIM_RE) === nonOrd.length, J([A.map(g => g.type), B.map(g => g.type)]));
  const near = (x, y) => { if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= 1e-5 * Math.max(1, Math.abs(x)); if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((v, k) => near(v, y[k])); if (x && y && typeof x === 'object' && typeof y === 'object') return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every(k => near(x[k], y[k])); return x === y; };
  const fark = [];
  for (let i = 0; i < nonOrd.length && i < B.length; i++) { const a = nonOrd[i], b = B[i]; if (!(near(a.def, b.def) && a.text === b.text && segKey(a.segs) === segKey(b.segs) && a.col === b.col && a.lay === b.lay)) fark.push({ i, a: [a.type, a.text, a.lay, a.col], b: [b.type, b.text, b.lay, b.col], def: near(a.def, b.def), seg: segKey(a.segs) === segKey(b.segs) }); }
  ok('7b geçiş: tür, kurulan tanım, yazı, geometri, katman ve renk kayıttan sonra aynı', fark.length === 0, J(fark));
  await ac(`${SM}/example_2000.dwg`);
  const nDwg = await ev(() => new Set(window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'DIMENSION' && p.info.dim && p.info.dim.type !== 6).map(p => p.info.h)).size);
  const tDwg = await dxfYaz({ onlyEdited: false });
  ok('7c DWG → DXF kaydı dosyanın kendi ölçülerini patlatmaz (example_2000.dwg)', nDwg > 0 && cnt(tDwg, DIM_RE) === nDwg, J([nDwg, cnt(tDwg, DIM_RE)]));
  const eski = await dxfYaz({ onlyEdited: false, extra: { realDims: false } });
  ok('7d realDims:false eski davranışı verir (DIMENSION yazılmaz)', cnt(eski, DIM_RE) === 0);
}

// ---- 8. DSTYLE okuyucusu ve dosya ölçüsünün dönüşümü ---------------------------------------------------------------------
{
  const L = []; const g = (c, v) => L.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1015'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  // AutoCAD DSTYLE çiftlerini kod sırasıyla yazar: DIMPOST (3, bir 1000 dizgisi) önce, sonra DIMLFAC (144), DIMTXT (140), DIMDEC (271)
  for (const [c, v] of [[0, 'DIMENSION'], [5, 'B1'], [8, '0'], [2, '*DX'], [10, 50], [20, 60], [30, 0], [11, 50], [21, 65], [31, 0], [70, 33], [1, ''], [42, 100], [3, 'STANDARD'], [100, 'AcDbAlignedDimension'], [13, 0], [23, 0], [33, 0], [14, 100], [24, 0], [34, 0],
    [1001, 'ACAD'], [1000, 'DSTYLE'], [1002, '{'], [1070, 3], [1000, '<> cm'], [1070, 144], [1040, 0.1], [1070, 140], [1040, 7], [1070, 271], [1070, 1], [1002, '}']]) g(c, v);
  g(0, 'ENDSEC'); g(0, 'EOF');
  const f = yaz('dstyle_post.dxf', L.join('\n') + '\n');
  await ac(f);
  const sty = await ev(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.t === 'DIMENSION' && q.info.dim); return p ? p.info.dim.sty : null; });
  ok('8a DIMPOST dizgisinden sonraki geçersiz kılmalar okunur: "<> cm", DIMLFAC 0,1, DIMTXT 7, DIMDEC 1', sty && sty.post === '<> cm' && sty.lfac === 0.1 && sty.txt === 7 && sty.dec === 1, J(sty));
  const r = await ev(async () => {
    const S = window.dwgApp.state, E = window.dwgApp.editor;
    const ps = S.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'DIMENSION');
    const bb0 = ps.reduce((a, p) => Math.min(a, p.bb[0]), Infinity);
    E.runCmd({ op: 'xform', keys: ps.map(p => p.key), m: [1, 0, 0, 1, 1000, 0], dz: 0 });
    const moved = S.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'DIMENSION');
    window.__ask = window.__ask || { queue: [], log: [] }; window.__ask.queue.push({ prefix: 'T=' });
    await E.tools.editDims([moved[0]]);
    const after = S.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'DIMENSION');
    return { bb0, bb2: after.reduce((a, p) => Math.min(a, p.bb[0]), Infinity), n: after.length };
  });
  ok('8b taşınan dosya ölçüsü düzenlenince yeni yerinde kurulur (eski yerine sıçramaz)', r.n > 0 && r.bb2 - r.bb0 > 900, J(r));
  await ac(f);
  const k = await ev(async () => {
    const S = window.dwgApp.state, E = window.dwgApp.editor;
    const ps = S.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'DIMENSION');
    const nk = ps.map((_, i) => 'kp' + i);
    E.runCmd({ op: 'copy', keys: ps.map(p => p.key), newKeys: nk, m: [1, 0, 0, 1, 0, 500], dz: 0 });
    const cps = S.scene.layouts[0].prims.filter(p => nk.includes(p.key));
    const hs = [...new Set(cps.map(p => p.info.h))], ortak = cps.every(p => p.info === cps[0].info);
    E.sel.clear(); for (const p of cps) E.sel.add(p); const say = E.objCount(); E.sel.clear();
    window.__ask = window.__ask || { queue: [], log: [] }; window.__ask.queue.push({ prefix: 'X=' });
    await E.tools.editDims([cps[0]]);
    const all = S.scene.layouts[0].prims;
    const t = all.find(p => p.k === 1 && p.lines[0].startsWith('X='));
    return { parca: cps.length, h: hs, ortak, say, yetim: all.filter(p => nk.includes(p.key)).length, y: t ? t.y : null, asil: all.filter(p => p.info && p.info.h === 'B1').length };
  });
  ok('8c kopyalanan dosya ölçüsünün parçaları TEK tanıtıcıyı ve tek bilgiyi paylaşır; seçim sayısı 1 nesne', k.parca > 1 && k.h.length === 1 && k.h[0] === 'kp0' && k.ortak && k.say === 1, J(k));
  ok('8d kopya düzenlenince yetim parça kalmaz, kopyanın yerinde (+500) kurulur, aslı yerinde durur', k.yetim === 0 && k.y > 500 && k.asil === k.parca, J(k));
  // geri al: kopya düzenlemesi ve kopya geri alınınca yalnız asıl kalır
  const u = await ev(() => { const d = window.dwgApp.editor.doc; d.undo(); d.undo(); return window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'DIMENSION').map(p => p.info.h); });
  ok('8e iki geri al: yalnız asıl ölçü kalır', u.length === k.parca && u.every(h => h === 'B1'), J(u));
}


// ---- 9. inceleme bulguları: bayatlık, yazı kaçışları, geçiş stili, açısal yön, renk, germe, bozuk XDATA ---------------------
{
  await ac(`${SM}/example_2000.dwg`);
  const r = await ev(async () => {
    const S = window.dwgApp.state, E = window.dwgApp.editor, T = E.tools, Ed = await import('./edit.js'), An = await import('./annot.js');
    const base = { ...T.dimDefaults(), h: 20, arrow: 20, exo: 5, exe: 10, scale: 1, prec: 2, suffix: ' mm', prefix: '', factor: 1 };
    const mk = (def, o = {}) => { const res = T.buildDim({ ...base, ...def }, { ...T.annotOpts(), ...o }); T.commitMany(res.ents); };
    mk({ kind: 'linear', sub: 'horizontal', pts: [[0, 0, 0], [300, 0, 0], [0, 80, 0]], text: '%%c<>' });
    mk({ kind: 'linear', sub: 'horizontal', pts: [[0, 400, 0], [300, 400, 0], [0, 480, 0]], text: 'A\nB' });
    mk({ kind: 'angular', pts: [[1000, 0, 0], [1100, 0, 0], [1000, -100, 0]], prec: 0, suffix: '°' });   // saat yönünde seçim
    const yaz = () => Ed.writeDxf(S.scene.layouts[0].prims, S.layers, { onlyEdited: true, ltypes: S.ltypes, blocks: S.blocks, vars: S.vars, dimFmt: { prec: 2, pad: false, dsep: ',' } });
    const txt = yaz();
    // açısal: çizilen yay kısa (90°) ve 13 → 14 saat yönünün tersine
    const angCore = S.scene.layouts[0].prims.filter(p => p.ent && p.ent.def && p.ent.def.kind === 'angular').pop();
    const arc = angCore.ent.arcs[0];
    let sw = (arc[5] - arc[4]) * (arc[0] < 0 ? -1 : 1); while (sw < 0) sw += 2 * Math.PI; while (sw > 2 * Math.PI) sw -= 2 * Math.PI;
    const f = An.dimDxf(angCore.ent.def);
    const crossZ = (f.p13[0] - f.p15[0]) * (f.p14[1] - f.p15[1]) - (f.p13[1] - f.p15[1]) * (f.p14[0] - f.p15[0]);
    return { txt, yayDer: sw * 180 / Math.PI, ccw: crossZ > 0, satirSonu: /\r\n1\r\nA\\PB\r\n/.test(txt), yuzde: /\r\n1\r\n%%c<>\r\n/.test(txt) };
  });
  ok('9a saat yönündeki açısal ölçü KISA yayı çizer (90°, 270° değil) ve DXF\'te 13 → 14 saat yönünün tersine', Math.abs(r.yayDer - 90) < 1e-6 && r.ccw, J({ yay: r.yayDer, ccw: r.ccw }));
  ok('9b çok satırlı ölçü yazısı DXF\'e \\P ile yazılır (ham satır sonu kod/değer satırlarını bozmaz); %%c olduğu gibi', r.satirSonu && r.yuzde, J({ satir: r.satirSonu, yuzde: r.yuzde }));
  const f9 = yaz('olcu_inceleme.dxf', r.txt);
  await ac(f9);
  const b = await ev(() => { const S = window.dwgApp.state; const g = new Map(); for (const p of S.scene.layouts[0].prims) if (p.info && p.info.t === 'DIMENSION' && p.info.dim) g.set(p.info.h, { gid: p.info.gid || null, text: (S.scene.layouts[0].prims.find(q => q.info === p.info && q.k === 1) || { lines: [''] }).lines.join('|') }); return [...g.values()]; });
  ok('9c "%%c<>", çok satırlı yazı ve açısal ölçü yeniden açılınca BENİMSENİR (tanım kaybolmaz)', b.length === 3 && b.every(x => x.gid), J(b));
  // AutoCAD'de değiştirilmiş stil → bayat
  {
    const L = r.txt.split('\r\n');
    // ilk DIMENSION'ın DSTYLE'ında 41 (ok) değeri 5 yapılır
    let i = L.indexOf('DIMENSION'); while (!(L[i] === 'DSTYLE')) i++; while (!(L[i] === '1070' && L[i + 1] === '41')) i++; L[i + 3] = '5';
    await ac(yaz('olcu_bayat_stil.dxf', L.join('\r\n')));
    const st = await ev(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.t === 'DIMENSION' && q.info.dim); return { gid: p.info.gid || null, asz: p.info.dim.sty.asz }; });
    ok('9d AutoCAD\'de ok boyu değiştirilmiş ölçü benimsenmez (bir sonraki kayıt o değişikliği geri almasın)', st.gid === null && st.asz === 5, J(st));
  }
  // bozuk XDATA (sayı olmayan dönüş) → benimsenmez
  {
    const L = r.txt.replace('"sub":"horizontal"', '"sub":"rotated","rot":"abc"');
    await ac(yaz('olcu_bozuk_xdata.dxf', L));
    const st = await ev(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.t === 'DIMENSION' && q.info.dim); return { gid: p.info.gid || null, app: !!p.info.dim.app }; });
    ok('9e bozuk XDATA tanımı (sayı olmayan açı) reddedilir, ölçü DXF alanlarından kurulur', st.gid === null && st.app === false, J(st));
  }
}
// geçiş: stili yazılmamış dosya ölçüsü kayıttan sonra da "2 ondalık / nokta" SAYILMAZ; çizgi işaretli ölçü 142 ile yazılır
{
  const L = []; const g = (c, v) => L.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1015'); g(0, 'ENDSEC'); g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const [c, v] of [[0, 'DIMENSION'], [5, 'C1'], [8, '0'], [2, '*DX'], [10, 50], [20, 60], [30, 0], [11, 50], [21, 65], [31, 0], [70, 33], [1, ''], [42, 100], [3, 'ISO'], [100, 'AcDbAlignedDimension'], [13, 0], [23, 0], [33, 0], [14, 100], [24, 0], [34, 0],
    [1001, 'ACAD'], [1000, 'DSTYLE'], [1002, '{'], [1070, 142], [1040, 1.5], [1002, '}']]) g(c, v);
  g(0, 'ENDSEC'); g(0, 'EOF');
  await ac(yaz('gecis_stil.dxf', L.join('\n') + '\n'));
  const once = await ev(() => window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.t === 'DIMENSION' && q.info.dim).info.dim.sty);
  const t2 = await dxfYaz({ onlyEdited: false });
  await ac(yaz('gecis_stil_2.dxf', t2));
  const sonra = await ev(() => window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.t === 'DIMENSION' && q.info.dim).info.dim.sty);
  ok('9f stili yazılmamış dosya ölçüsü kayıttan sonra da ondalık / ayırıcı "yazılmamış" kalır (Standard kaydına 271 / 278 yazılmaz)', once.dec === undefined && sonra.dec === undefined && once.dsep === undefined && sonra.dsep === undefined && !/\r\n271\r\n2\r\n/.test(t2.split('ENTITIES')[0]), J({ once, sonra }));
  ok('9g çizgi işaretli (DIMTSZ) ölçü DSTYLE\'da 142 ile yazılır, "41 = 0" yazılmaz', /\r\n1070\r\n142\r\n1040\r\n1\.5\r\n/.test(t2) && !/\r\n1070\r\n41\r\n1040\r\n0\r\n/.test(t2), '');
}
// germe (STRETCH) ölçünün yalnız bir kısmını taşıyınca dosya ölçüsünün tanımı yarım dönüşmez
{
  await ac(`${SM}/pface_full.dxf`);
  const r = await ev(() => {
    const S = window.dwgApp.state, E = window.dwgApp.editor, ps = S.scene.layouts[0].prims;
    const byH = new Map(); for (const p of ps) if (p.info && p.info.t === 'DIMENSION' && p.info.dim && p.info.dim.type === 1) { if (!byH.has(p.info.h)) byH.set(p.info.h, []); byH.get(p.info.h).push(p); }
    const [h, parts] = [...byH.entries()][0];
    const d0 = JSON.stringify(parts[0].info.dim.p2);
    E.runCmd({ op: 'xform', keys: [parts[0].key], m: [1, 0, 0, 1, -150, 0], dz: 0 });   // yalnız bir parça
    const now = S.scene.layouts[0].prims.filter(p => p.info && p.info.h === h);
    return { ayni: now.every(p => JSON.stringify(p.info.dim.p2) === d0), n: now.length };
  });
  ok('9h ölçünün yalnız bir parçası taşınınca (germe) tanım noktaları dönüşmez — parçalar tutarlı tanımı taşır', r.ayni && r.n > 1, J(r));
}
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
