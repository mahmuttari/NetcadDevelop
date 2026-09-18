// NESNE YAKALAMA İZLEME (v7.66, AutoCAD object snap tracking / OTRACK, F11). Gezinen imleç (kalem / fare / parmakla
// nişan) bir yakalama noktasının üstünde bekleyince nokta EDİNİLİR (+), yeniden bekleyince bırakılır; imleç edinilmiş
// noktalardan geçen yatay / düşey (kutupsalda açılı) hizalama yollarına ve iki yolun kesişimine oturur; ortho kilidiyle
// yolun kilit doğrusunu kestiği nokta alınır. Dokunmatikte İz noktası (TT) düğmesi dokunuşla edinir. Nokta verilince,
// araç bitince ve iz kapatılınca edinilmiş noktalar silinir. Geometri otrack.js'te (saf), edinme ve çizim app.js'te.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_izleme.mjs [çıktı] [örnekler]
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
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const tapWorld = async (x, y) => { await bekle(110); await temizle(); const s = await scr(x, y); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(380); };
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const yaz = (v) => page.fill('#cmdInput', v);
const enter = async () => { await page.click('#cmdEnter'); await bekle(150); };
const pts = () => ev(() => window.dwgApp.editor.tools.pts.map(p => p.slice(0, 2)));
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, ops: p.ops.map(o => o.slice()) }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const track = () => ev(() => window.dwgApp.__track());
const kalem = (type, x, y, buttons = 0) => ev(([t, x, y, b]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: t === 'pointermove' ? -1 : 0, buttons: b, pressure: b ? 0.5 : 0 })); }, [type, x, y, buttons]);
/** kalem havada gezinir: dünya noktasının üstüne gelir ve ms bekler (edinme için DWELL_MS = 350 ms'den uzun) */
const gez = async (wx, wy, ms = 220) => { const s = await scr(wx, wy); await kalem('pointermove', s[0], s[1]); await bekle(ms); return s; };
/** kalemle dokunuş: iniş + kalkış aynı yerde (havadaki imlecin durduğu yere işlenir) */
const dokun = async (wx, wy) => { const s = await scr(wx, wy); await kalem('pointerdown', s[0], s[1], 1); await bekle(60); await kalem('pointerup', s[0], s[1], 0); await bekle(420); };
const kalemCik = async () => { await kalem('pointerout', -50, -50); await bekle(120); };
const hover = () => ev(() => ({ h: window.dwgApp.__pickbox().hover, pen: window.dwgApp.state.pen.hover, tr: window.dwgApp.__track().hover }));

// ---------------------------------------------------------------------------------
// 0 · Saf modül (otrack.js): açılar, edinme listesi, izdüşüm, kesişim, kilit, sınır
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const T = await import('./otrack.js');
    let L = T.toggle([], [300, 100], 'end').list;
    const proj = T.align(L, [303, 300], 10, T.angles(false));
    const L2 = T.toggle(L, [500, 400], 'mid').list;
    const cross = T.align(L2, [302, 397], 10, T.angles(false));
    const lock = T.align(L, [290, 305], 10, T.angles(false), { base: [100, 300], dir: [1, 0] });
    const lockNone = T.align(L, [200, 305], 10, T.angles(false), { base: [100, 300], dir: [1, 0] });
    const polar = T.align(L, [402, 199], 10, T.angles(true, 45));
    let L8 = []; for (let i = 0; i < 8; i++) L8 = T.toggle(L8, [i, 0]).list;
    return { max: T.MAX_PTS, dwell: T.DWELL_MS, a0: T.angles(false), a45: T.angles(true, 45).length, a15: T.angles(true, 15).length, rm: T.toggle(L, [300, 100]).list.length,
      proj: { p: proj.p, cross: proj.cross, deg: proj.paths[0].deg, dist: proj.paths[0].dist }, cross: { p: cross.p, cross: cross.cross, n: cross.paths.length }, lock: { p: lock.p, lock: lock.lock }, lockNone, polar: polar.p, far: T.align(L, [400, 300], 10, T.angles(false)), n8: L8.length, first8: L8[0].p[0] };
  });
  ok('0a sabitler AutoCAD: en çok 7 nokta, bekleme 350 ms; açılar 0/90/180/270, kutupsalda 45° → 8, 15° → 24', r.max === 7 && r.dwell === 350 && r.a0.join(',') === '0,90,180,270' && r.a45 === 8 && r.a15 === 24, J(r));
  ok('0b izdüşüm: (300,100) düşey yolu, imleç (303,300) → (300,300), 90°, uzaklık 200; yeniden ekleme bırakır', yak(r.proj.p[0], 300) && yak(r.proj.p[1], 300) && !r.proj.cross && r.proj.deg === 90 && yak(r.proj.dist, 200) && r.rm === 0, J(r.proj));
  ok('0c kesişim: (300,100) düşey × (500,400) yatay, imleç (302,397) → (300,400), iki yol', yak(r.cross.p[0], 300) && yak(r.cross.p[1], 400) && r.cross.cross && r.cross.n === 2, J(r.cross));
  ok('0d ortho kilidi: taban (100,300) +x doğrusu × (300,100) düşey yolu → (300,300); yol uzaktaysa null', yak(r.lock.p[0], 300) && yak(r.lock.p[1], 300) && r.lock.lock && r.lockNone === null, J(r.lock));
  ok('0e kutupsal 45° yolu: imleç (402,199) → 45° doğrusunda (x−300 = y−100)', yak(r.polar[0] - 300, r.polar[1] - 100, 1e-9), J(r.polar));
  ok('0f uzakta yol yok → null; 8. nokta en eskisini düşürür (7 kalır, ilki 1)', r.far === null && r.n8 === 7 && r.first8 === 1, J({ far: r.far, n8: r.n8, first8: r.first8 }));
}

// ---------------------------------------------------------------------------------
// 1 · Kurulum: boş bölgeye iki çizgi — A düşey (50300,50100)→(50300,50600), B yatay (50600,50800)→(50900,50800)
// ---------------------------------------------------------------------------------
await page.click('#toolbar [data-tab="draw"]');
await zoom([50000, 50000, 51000, 51000]);
{
  const n0 = await count();
  await arac('t:line'); await yaz('50300,50100'); await enter(); await yaz('50300,50600'); await enter(); await iptal();
  await arac('t:line'); await yaz('50600,50800'); await enter(); await yaz('50900,50800'); await enter();
  const sn = await ev(() => window.dwgApp.__snapAt(50302, 50598));
  ok('1a iki çizgi çizildi; çizgi aracı açıkken (50302,50598) uç noktaya (50300,50600) yakalanır', (await count()) === n0 + 2 && !!sn && sn.kind === 'end' && yak(sn.p[0], 50300) && yak(sn.p[1], 50600), J({ n: (await count()) - n0, sn }));
  await iptal();
  const t0 = await track();
  ok('1b nesne yakalama izleme varsayılan AÇIK; edinilmiş nokta yok', t0.on === true && t0.pts.length === 0, J(t0));
}

// ---------------------------------------------------------------------------------
// 2 · Kalemle edinme: uç noktada bekleyince (+) alınır; imleç düşey yola oturur; dokunuş yola işlenir, liste silinir
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await dokun(50100, 50250);                                                        // taban: yakınında nesne yok
  ok('2a çizgi aracının ilk noktası kalemle (50100,50250)', (await pts()).length === 1 && yak((await pts())[0][0], 50100, 3), J(await pts()));
  await gez(50300, 50600, 120);
  const d0 = await track();
  await bekle(450);
  const d1 = await track();
  ok('2b uç nokta (50300,50600) üstünde 120 ms: henüz edinilmedi, bekleme sürüyor; 570 ms sonra EDİNİLDİ (END)', d0.pts.length === 0 && !!d0.dwell && d1.pts.length === 1 && d1.pts[0].kind === 'end' && yak(d1.pts[0].p[0], 50300) && yak(d1.pts[0].p[1], 50600), J({ d0, d1 }));
  await bekle(400);
  ok('2c aynı noktada durmaya devam etmek yeniden tetiklemez (nokta bırakılmaz)', (await track()).pts.length === 1, J(await track()));
  await gez(50308, 50850);
  const h = await hover();
  ok('2d imleç (50308,50850): edinilmiş noktanın DÜŞEY yoluna oturur → x tam 50300, kip TRK, tek yol, kesişim yok', !!h.tr && !h.tr.cross && h.tr.n === 1 && yak(h.tr.p[0], 50300) && yak(h.tr.p[1], 50850, 4) && h.h.snap === 'trk' && yak(h.pen[0], 50300), J(h));
  ok('2e ipucu metni AutoCAD düzeninde: "END <uzaklık> < 90°"', /^END [\d.,]+ < 90°$/.test(h.tr.text), h.tr.text);
  await page.screenshot({ path: `${out}/izleme_yol.png` });
  const n1 = await count();
  await dokun(50308, 50850);
  const p = await sonPrim(), t2 = await track();
  const fl = await ev(() => ({ flash: window.dwgApp.state.snapFlash && window.dwgApp.state.snapFlash.kind, yol: !!(window.dwgApp.state.snapFlash && window.dwgApp.state.snapFlash.trk), chip: document.getElementById('stSnap').hidden ? '' : document.getElementById('stSnap').textContent }));
  ok('2f dokunuş yola işlendi: çizgi (50100,50250)→(50300,≈50850), x birebir; dokunuş işareti TRK ve yol; nokta verilince iz noktaları silindi', (await count()) === n1 + 1 && yak(p.ops[1][1], 50300) && yak(p.ops[1][2], 50850, 4) && t2.pts.length === 0 && fl.flash === 'trk' && fl.yol && fl.chip === 'TRK', J({ ops: p.ops, t2, fl }));
}

// ---------------------------------------------------------------------------------
// 3 · Kesişim: iki edinilmiş noktanın yolları kesişince imleç kesişime oturur
// ---------------------------------------------------------------------------------
{
  await gez(50600, 50800, 520);                                                     // B1 edinilir
  await gez(50300, 50100, 520);                                                     // A1 edinilir
  const t0 = await track();
  ok('3a iki nokta edinildi: (50600,50800) ve (50300,50100)', t0.pts.length === 2 && yak(t0.pts[0].p[0], 50600) && yak(t0.pts[1].p[1], 50100), J(t0));
  await gez(50606, 50094);
  const h = await hover();
  ok('3b imleç (50606,50094): B1 düşey × A1 yatay → KESİŞİM (50600,50100) birebir, iki yol', !!h.tr && h.tr.cross && h.tr.n === 2 && yak(h.tr.p[0], 50600) && yak(h.tr.p[1], 50100), J(h.tr));
  ok('3c ipucu iki yolu söyler: "END … < 270° · END … < 0°" (eşit uzaklıkta sıra ekleme sırasıdır)', /^END [\d.,]+ < (270|0)° · END [\d.,]+ < (0|270)°$/.test(h.tr.text) && /270°/.test(h.tr.text) && / 0°/.test(h.tr.text), h.tr.text);
  await page.screenshot({ path: `${out}/izleme_kesisim.png` });
  await dokun(50606, 50094);
  const p = await sonPrim();
  ok('3d dokunuş kesişime işlendi: (50600,50100) birebir', yak(p.ops[1][1], 50600) && yak(p.ops[1][2], 50100), J(p.ops));
}

// ---------------------------------------------------------------------------------
// 4 · Bırakma: edinilmiş noktada yeniden bekleyince nokta bırakılır; menzilden çıkınca sayaç sıfırlanır
// ---------------------------------------------------------------------------------
{
  await gez(50300, 50600, 520);
  const a = (await track()).pts.length;
  await gez(50100, 50950, 200);
  const b = (await track()).pts.length;
  await gez(50300, 50600, 520);
  const c = (await track()).pts.length;
  ok('4a bekle → 1 · uzaklaş → 1 kalır · yeniden bekle → 0 (bırakıldı)', a === 1 && b === 1 && c === 0, J({ a, b, c }));
  await kalemCik();
  ok('4b kalem menzilden çıkınca gezinen imleç ve bekleme sayacı kalkar', (await hover()).h === null && (await track()).dwell === null);
}

// ---------------------------------------------------------------------------------
// 5 · Ortho kilidi: imleç taban noktadan +x doğrusunda kilitli; edinilmiş noktanın düşey yolu o doğruyu kestiği yerde alınır
// ---------------------------------------------------------------------------------
{
  await iptal(); await arac('t:line');
  await dokun(50100, 50250);
  await ev(() => window.dwgApp.__trackAdd(50300, 50600, 'end'));
  await ev(() => window.dwgApp.editor.act('ortho')); await bekle(120);
  await gez(50290, 50262);
  const h = await hover();
  ok('5a ortho açık, imleç (50290,50262): kilit +x (y = 50250) × düşey yol (x = 50300) → (50300,50250) birebir, kilit', !!h.tr && h.tr.lock && yak(h.tr.p[0], 50300) && yak(h.tr.p[1], 50250), J(h.tr));
  await page.screenshot({ path: `${out}/izleme_ortho.png` });
  await dokun(50290, 50262);
  const p = await sonPrim();
  ok('5b dokunuş kesişime işlendi: (50100,50250)→(50300,50250), iki koordinat da birebir', yak(p.ops[0][1], 50100, 3) && yak(p.ops[1][1], 50300) && yak(p.ops[1][2], 50250), J(p.ops));
  await gez(50290, 50262);
  const h2 = await hover();
  ok('5c iz noktası silindikten sonra aynı yerde yalnız ortho: yol yok, imleç kilit doğrusunda (y = 50250)', h2.tr === null && !!h2.pen && yak(h2.pen[1], 50250), J(h2));
  await ev(() => window.dwgApp.editor.act('ortho')); await bekle(120);
  await kalemCik(); await iptal();
}

// ---------------------------------------------------------------------------------
// 6 · Kutupsal açılar (ölçü kipi, kilit yok): 45° yolu
// ---------------------------------------------------------------------------------
{
  await ev(() => { window.dwgApp.setMode('measure'); window.dwgApp.state.desk.polarStep = 45; window.dwgApp.editor.act('polar'); }); await bekle(150);
  await ev(() => window.dwgApp.__trackAdd(50300, 50100, 'end'));
  await gez(50504, 50296);
  const h = await hover();
  // v7.70: yol imlecin yanında örnek dosyanın bir çizgisini kesiyorsa INT açıkken oraya oturur (AutoCAD genişletilmiş kesişim, "× INT"); nokta yine 45° yolunda
  ok('6a kutupsal 45° açık, imleç (50504,50296): (50300,50100) noktasının 45° yolu → x−50300 = y−50100, ipucu "< 45°" (yolu kesen nesne varsa × INT)', !!h.tr && (!h.tr.cross || h.tr.obj) && yak(h.tr.p[0] - 50300, h.tr.p[1] - 50100, 1e-6) && /< 45°( × INT)?$/.test(h.tr.text), J(h.tr));
  await ev(() => { window.dwgApp.editor.act('polar'); window.dwgApp.state.desk.polarStep = 15; }); await bekle(120);
  await gez(50504, 50296);
  const h2 = await hover();
  ok('6b kutupsal kapanınca 45° yolu yok (yalnız dik eksenler)', h2.tr === null, J(h2.tr));
  await kalemCik();
  await ev(() => window.dwgApp.setMode('view')); await bekle(120);
  ok('6c kip değişince edinilmiş noktalar silinir', (await track()).pts.length === 0);
}

// ---------------------------------------------------------------------------------
// 7 · İz noktası (TT) düğmesi (istem satırında) — parmakla: dokunuş nokta sayılmaz, edinir; sonraki dokunuş yola oturur
// ---------------------------------------------------------------------------------
{
  await bekle(800);                                                                 // avuç reddi: kalemden sonra parmak 700 ms bekler
  await arac('t:line');
  await tapWorld(50100, 50250);
  const btn = await ev(() => { const b = document.getElementById('cmdTt'); return b && !b.hidden ? { title: b.title, icon: !!b.querySelector('use[href="#i-tt"]'), on: b.classList.contains('on'), barH: document.getElementById('cmdBar').offsetHeight } : null; });
  ok('7a nokta isteminde istem satırında "İz noktası (TT)" düğmesi var (simge, basılı değil); çubuk iki satırda kalır (< 110 px)', !!btn && btn.title === 'İz noktası (TT)' && btn.icon && !btn.on && btn.barH < 110, J(btn));
  await page.click('#cmdTt'); await bekle(150);
  const armed = await ev(() => ({ once: window.dwgApp.state.snapOnce, on: document.getElementById('cmdTt').classList.contains('on') }));
  ok('7b düğme bir kerelik TK kipini kurar ve basılı görünür', armed.once === 'tk' && armed.on, J(armed));
  await tapWorld(50305, 50605);
  const t1 = await track(), st = await ev(() => ({ once: window.dwgApp.state.snapOnce, n: window.dwgApp.editor.tools.pts.length, on: document.getElementById('cmdTt').classList.contains('on') }));
  ok('7c uç noktanın yanına dokunuş NOKTA SAYILMAZ: uç (50300,50600) END olarak edinilir, kip tüketilir, düğme söner, ileti', t1.pts.length === 1 && t1.pts[0].kind === 'end' && yak(t1.pts[0].p[0], 50300) && yak(t1.pts[0].p[1], 50600) && st.once === null && st.n === 1 && !st.on && /İz noktası alındı/.test(await toast()), J({ t1, st, toast: await toast() }));
  await tapWorld(50306, 50850);
  const p = await sonPrim();
  ok('7d parmakla dokunuş (50306,50850) düşey yola oturur → x tam 50300; iz noktaları silindi', yak(p.ops[1][1], 50300) && yak(p.ops[1][2], 50850, 4) && (await track()).pts.length === 0, J(p.ops));
  await arac('t:move');
  ok('7e nesne seçimi isteminde TT düğmesi yok', (await ev(() => document.getElementById('cmdTt').hidden)));
  await arac('t:circle'); await tapWorld(50150, 50450);
  ok('7f daire yarıçapı (sayı istemi): TT düğmesi yok', (await ev(() => document.getElementById('cmdTt').hidden)));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 8 · Aç / kapat: Ölçü ve Ekran sekmelerindeki "Yakalama izi" karosu, F11 eylemi, ayar kutusu; kapalıyken bekleme edinmez, TT yine çalışır
// ---------------------------------------------------------------------------------
{
  await arac('t:line'); await tapWorld(50100, 50250);
  const b0 = await ev(() => { const tt = document.getElementById('cmdTt'), o = document.getElementById('cmdOrtho'); const m = document.querySelector('#toolbar .tb-row[data-for="measure"] [data-act="otrack"]'), d = document.querySelector('#toolbar .tb-row[data-for="display"] [data-act="otrack"]'); return { ttHidden: tt.hidden, ttW: Math.round(tt.getBoundingClientRect().width), oW: Math.round(o.getBoundingClientRect().width), barH: document.getElementById('cmdBar').offsetHeight, textH: Math.round(document.getElementById('cmdText').getBoundingClientRect().height), tile: m ? { on: m.classList.contains('on'), lb: m.querySelector('.lb').textContent, icon: !!m.querySelector('use[href="#i-otrack"]') } : null, tileD: !!d }; });
  ok('8a nokta isteminde istem satırında yalnız TT ve Ortho (40 px); istem tek satırda, çubuk < 100 px; "Yakalama izi" karosu Ölçü ve Ekran sekmelerinde, basılı (açık)', !b0.ttHidden && b0.ttW === 40 && b0.oW === 40 && b0.barH < 100 && b0.textH < 30 && !!b0.tile && b0.tile.on && b0.tile.lb === 'Yakalama izi' && b0.tile.icon && b0.tileD, J(b0));
  await ev(() => window.dwgApp.__trackAdd(50300, 50600, 'end'));
  await temizle(); await ev(() => window.dwgApp.editor.act('otrack')); await bekle(150);
  const b1 = await ev(() => ({ on: document.querySelector('#toolbar .tb-row[data-for="measure"] [data-act="otrack"]').classList.contains('on'), opt: window.dwgApp.osnap.opt().otrack, n: window.dwgApp.state.track.pts.length }));
  ok('8b karo / F11 eylemi izlemeyi kapatır: karo söner, ayar false, edinilmiş noktalar silinir, ileti "kapalı"', !b1.on && b1.opt === false && b1.n === 0 && /Yakalama izi kapalı/.test(await toast()), J({ b1, toast: await toast() }));
  await bekle(800);
  await gez(50300, 50600, 520);
  ok('8c kapalıyken uç noktada bekleme EDİNMEZ', (await track()).pts.length === 0 && (await track()).on === false, J(await track()));
  await kalemCik(); await bekle(800);
  await page.click('#cmdTt'); await bekle(120); await tapWorld(50305, 50605);
  await tapWorld(50306, 50850);
  const p = await sonPrim();
  ok('8d kapalıyken TT yine çalışır (geçici iz noktası, AutoCAD gibi): dokunuş düşey yola oturdu, x tam 50300', yak(p.ops[1][1], 50300) && yak(p.ops[1][2], 50850, 4), J(p.ops));
  await temizle(); await page.click('#toolbar [data-tab="measure"]'); await page.click('#toolbar .tb-row[data-for="measure"] [data-act="otrack"]'); await bekle(150);
  const b2 = await ev(() => ({ on: document.querySelector('#toolbar .tb-row[data-for="measure"] [data-act="otrack"]').classList.contains('on'), opt: window.dwgApp.osnap.opt().otrack, kayit: JSON.parse(localStorage.getItem('settings')).snapOpt.otrack }));
  ok('8e karoya dokunmak yeniden açar: karo basılı, ayar kaydedildi (true), ileti "açık"', b2.on && b2.opt === true && b2.kayit === true && /Yakalama izi açık/.test(await toast()), J(b2));
  await page.click('#toolbar [data-tab="draw"]');
  await iptal();
  ok('8f boşta (Komut:) TT düğmesi gizli', await ev(() => document.getElementById('cmdTt').hidden));
  await ev(() => window.dwgApp.editor.act('osnapset')); await bekle(200);
  const dlg = await ev(() => ({ chk: document.querySelector('input[data-key="osTrack"]').checked, hint: document.querySelector('.os-head .opt-note').textContent }));
  ok('8g ayar kutusunda "Yakalama izi (F11)" anahtarı açık; açıklama iz noktasını ve TT düğmesini anlatır', dlg.chk === true && /iz noktası \(\+\)/.test(dlg.hint) && /TT/.test(dlg.hint), J(dlg));
  await ev(() => { const i = document.querySelector('input[data-key="osTrack"]'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); }); await bekle(150);
  const off = await ev(() => ({ opt: window.dwgApp.osnap.opt().otrack, tile: document.querySelector('#toolbar .tb-row[data-for="measure"] [data-act="otrack"]').classList.contains('on') }));
  await ev(() => { const i = document.querySelector('input[data-key="osTrack"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }); await bekle(150);
  ok('8h anahtar kapatır / açar ve karo onu izler (tek durum: F11, karo ve kutu aynı değeri yazar)', off.opt === false && off.tile === false && (await ev(() => window.dwgApp.osnap.opt().otrack)) === true);
  await ev(() => window.dwgApp.onBack()); await bekle(120);
}

// ---------------------------------------------------------------------------------
// 9 · Sınır, çizim ve temizlik: en çok 7 nokta; artı işareti yalnız nokta isteminde çizilir; araç bitince silinir
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await ev(() => { for (let i = 0; i < 8; i++) window.dwgApp.__trackAdd(50100 + i * 50, 50900, 'end'); });
  const t8 = await track();
  ok('9a sekiz edinme → 7 kalır, en eski (50100) düştü, ilki 50150', t8.pts.length === 7 && yak(t8.pts[0].p[0], 50150), J(t8.pts.map(q => q.p[0])));
  const piksel = async () => ev(() => { const S = window.dwgApp.state, c = document.getElementById('ov').getContext('2d'); const s = window.dwgApp.toScreen(50150, 50900); const d = S.dpr; const im = c.getImageData(Math.round((Math.round(s[0]) + 4) * d) - 1, Math.round(Math.round(s[1]) * d) - 1, 4, 4).data; let hit = 0; for (let i = 0; i < im.length; i += 4) if (im[i + 3] > 100 && im[i] > 150 && im[i + 2] < 90) hit++; return hit; });
  await ev(() => window.dwgApp.render()); await bekle(150);
  const px1 = await piksel();
  ok('9b edinilmiş noktada turuncu artı (+) çizilir (kaplama pikseli)', px1 > 0, String(px1));
  await iptal(); await bekle(150);
  const t9 = await track(), px2 = await piksel();
  ok('9c araç iptal edilince iz noktaları silinir ve artı kalkar', t9.pts.length === 0 && px2 === 0, J({ n: t9.pts.length, px2 }));
}

// ---------------------------------------------------------------------------------
// 10 · Komut notu ve i18n
// ---------------------------------------------------------------------------------
{
  const a = await ev(async () => { const A = await import('./acad.js'); const c = A.resolve('OTRACK'); return { note: c && c.note, st: A.stats() }; });
  ok('10a OTRACK notu iz noktasını, TT düğmesini ve kesişimi söyler; komut sayıları sabit', /tracking point/.test(a.note || '') && /TT/.test(a.note || '') && /intersections/.test(a.note || '') && a.st.total === 506 && a.st.names === 751, J(a));
  const dil = await ev(async () => { const I = await import('./i18n.js'); const tr = [I.t('osTrackHint'), I.t('osTkFirst'), I.t('osTk')]; I.setLang('en'); const en = [I.t('osTrackHint'), I.t('osTkFirst'), I.t('osTk')]; I.setLang('tr'); return { tr, en }; });
  ok('10b TR / EN metinler: bekleyince edinme, TT düğmesi, iz noktası', /bekleyince iz noktası/.test(dil.tr[0]) && /yollara oturur/.test(dil.tr[1]) && dil.tr[2] === 'İz noktası' && /Pausing over a snap point acquires a tracking point/.test(dil.en[0]) && /paths through it/.test(dil.en[1]) && dil.en[2] === 'Tracking point', J(dil));
}

await page.screenshot({ path: `${out}/izleme.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
