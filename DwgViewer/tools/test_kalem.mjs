// Kalem desteği: S Pen · Apple Pencil · genel Android kalemleri.
//  1) stylus.js saf mantığı: tür ayrımı, silgi/yan düğme bitleri, avuç reddi, basınç ölçümü.
//  2) Avuç reddi gerçekten uygulanıyor mu: kalem değerken dokunuş belgeye HİÇ ulaşmamalı.
//  3) Havada gezinme: uç değmeden konum ve yakalama okunur, belge DEĞİŞMEZ.
//  4) Silgi ucu siler, yan düğme atanan görevi yapar, basınç nota kaydedilir.
//  5) Kademe: çekirdek (tanıma + avuç reddi) ücretsiz, gelişmişler Premium.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_kalem.mjs [çıktı] [örnekler]
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

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });

const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const count = () => ev(() => window.dwgApp.state.prims.length);
const undoLen = () => ev(() => { const d = window.dwgApp.editor.doc; return d ? d.log.length : -1; });   // günlük: geri alma yığını 10 adımla sınırlı (v7.55), sayım günlükten
const penState = () => ev(() => JSON.parse(JSON.stringify(window.dwgApp.state.pen)));
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await page.waitForTimeout(150); };
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
const selKey = () => ev(() => { const s = window.dwgApp.state.selected; return s ? s.key : null; });

/*
 * Sentetik işaretçi olayı. Playwright'ın kendi girdi API'sinde kalem yoktur; uygulama standart
 * PointerEvent alanlarını okuduğu için olay doğrudan kurulup gönderilir. Böylece basınç, eğim,
 * silgi biti ve yan düğme biti gerçek cihazdaki değerlerle sınanabilir.
 */
const sendPen = (type, o = {}) => ev(([t, q]) => {
  const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
  vp.dispatchEvent(new PointerEvent(t, {
    pointerId: q.id == null ? 77 : q.id,
    pointerType: q.pt || 'pen',
    isPrimary: true, bubbles: true, cancelable: true,
    clientX: r.left + q.x, clientY: r.top + q.y,
    buttons: q.buttons == null ? (t === 'pointerup' ? 0 : 1) : q.buttons,
    button: q.button == null ? (t === 'pointermove' ? -1 : 0) : q.button,
    pressure: q.pressure == null ? (t === 'pointerup' ? 0 : 0.5) : q.pressure,
    width: q.width == null ? 1 : q.width, height: q.height == null ? 1 : q.height,
    tiltX: q.tiltX || 0, tiltY: q.tiltY || 0,
  }));
}, [type, o]);
/** Dünya noktasının ekran karşılığı (sentetik olaya koymak için) */
const scr = (x, y) => ev(([a, b]) => { const s = window.dwgApp.toScreen(a, b); return { x: s[0], y: s[1] }; }, [x, y]);
/* Ayar, editor.js'teki CANLI ui nesnesine yazılır: localStorage yalnız açılışta okunur, oraya
   yazmak çalışan uygulamayı etkilemez (ilk kurulumda bu yüzden üç sınama yanlış geçmişti). */
const setUi = (o) => ev(async (q) => { const E = await import('./editor.js'); Object.assign(E.ui, q); window.dispatchEvent(new CustomEvent('dwg:ui')); }, o);

// ---------------------------------------------------------------------------------
// 1) Saf mantık (stylus.js sayfa içinde)
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const St = await import('./stylus.js');
    const E = (o) => ({ pointerId: 1, pointerType: 'mouse', buttons: 0, button: -1, pressure: 0, width: 1, height: 1, ...o });
    const guard = new St.PalmGuard();
    const r0 = guard.down(E({ pointerId: 9, pointerType: 'touch' }), 1000, []);
    const r1 = guard.down(E({ pointerId: 1, pointerType: 'pen', buttons: 1 }), 1100, [9]);
    const r2 = guard.down(E({ pointerId: 10, pointerType: 'touch' }), 1150, []);
    guard.up(E({ pointerId: 1, pointerType: 'pen' }));
    const r3 = guard.down(E({ pointerId: 11, pointerType: 'touch' }), 1200, []);
    const r4 = guard.down(E({ pointerId: 12, pointerType: 'touch' }), 1100 + 700 + 10, []);
    const pr = new St.Pressure();
    pr.feed(E({ pointerType: 'pen', pressure: 0.5 })); pr.feed(E({ pointerType: 'pen', pressure: 0.5 }));
    const sabit = pr.real;
    pr.feed(E({ pointerType: 'pen', pressure: 0.85 }));
    return {
      kalem: St.kindOf(E({ pointerType: 'pen', buttons: 1 })),
      silgiBit: St.kindOf(E({ pointerType: 'pen', buttons: 32 })),
      silgiUp: St.kindOf(E({ pointerType: 'pen', buttons: 0, button: 5 })),
      yanKalem: St.kindOf(E({ pointerType: 'pen', buttons: 3 })),
      yan: St.barrelOf(E({ pointerType: 'pen', buttons: 3 })),
      dokunus: St.kindOf(E({ pointerType: 'touch', buttons: 1 })),
      egim: St.tiltOf(E({ pointerType: 'pen', tiltX: 30, tiltY: 40 })),
      egimYok: St.tiltOf(E({ pointerType: 'pen' })),
      r0: r0.block, r1drop: r1.drop, r2: r2.block, r3: r3.block, r4: r4.block,
      sabit, gercek: pr.real,
      w0: St.widthFor(4, 0), w1: St.widthFor(4, 1), wOff: St.widthFor(4, 0.9, { real: false }),
    };
  });
  ok('1a kalem / dokunuş ayrımı', g.kalem === 'pen' && g.dokunus === 'touch', `${g.kalem} · ${g.dokunus}`);
  ok('1b silgi ucu iki yoldan da tanınır (buttons biti 32 ve bırakışta button 5)', g.silgiBit === 'eraser' && g.silgiUp === 'eraser', `${g.silgiBit} · ${g.silgiUp}`);
  ok('1c yan düğmeli kalem SİLGİ sayılmaz', g.yanKalem === 'pen' && g.yan === true, `${g.yanKalem} · ${g.yan}`);
  ok('1d eğim okunur, bildirmeyen cihazda null', g.egim && g.egim.deg === 50 && g.egimYok === null, JSON.stringify(g.egim));
  ok('1e kalem görülmemişken dokunuş serbest', g.r0 === false);
  ok('1f kalem inince önceden basılı dokunuş iptal listesine girer', g.r1drop.length === 1 && g.r1drop[0] === 9, JSON.stringify(g.r1drop));
  ok('1g kalem temastayken ve kalktıktan hemen sonra dokunuş elenir', g.r2 === true && g.r3 === true);
  ok('1h sağır süre bitince dokunuş yeniden serbest', g.r4 === false);
  ok('1i sabit 0,5 gerçek basınç sayılmaz; değer oynayınca sayılır', g.sabit === false && g.gercek === true);
  ok('1j basınç arttıkça kalınlık artar, desteklenmiyorsa taban kalınlık', g.w0 < g.w1 && g.wOff === 4, `${g.w0} → ${g.w1}`);
}

// ---------------------------------------------------------------------------------
// 2) Kademe
// ---------------------------------------------------------------------------------
{
  const n = await ev(async () => { const E = await import('./edition.js'); return { pen: E.need('pen'), has: E.has('pen') }; });
  ok('2a gelişmiş kalem yetenekleri Premium', n.pen === 'premium', n.pen);
  ok('2b sınama Super kipinde açık', n.has === true);
}

// ---------------------------------------------------------------------------------
// 3) Avuç reddi — kalem değerken dokunuş belgeye ulaşmamalı
// ---------------------------------------------------------------------------------
await zoom([0, 0, 2000, 2000]);
{
  const p = await scr(500, 500);
  const u0 = await undoLen();
  await sendPen('pointerdown', { id: 1, pt: 'pen', x: p.x, y: p.y, pressure: 0.4 });
  await page.waitForTimeout(40);
  const st1 = await penState();
  ok('3a kalem dokununca cihazda kalem "görüldü" olarak işaretlenir', st1.seen === true, JSON.stringify(st1));
  // el kenarı kalemden SONRA iniyor
  await sendPen('pointerdown', { id: 2, pt: 'touch', x: p.x + 90, y: p.y + 70, width: 55, height: 55 });
  await page.waitForTimeout(40);
  const iz = await ev(() => window.dwgApp.state.pen.drop);
  ok('3b kalem temastayken inen avuç ELENİR (sayaç arttı)', iz >= 1, String(iz));
  await sendPen('pointerup', { id: 1, pt: 'pen', x: p.x, y: p.y });
  await sendPen('pointerup', { id: 2, pt: 'touch', x: p.x + 90, y: p.y + 70 });
  await page.waitForTimeout(80);
  ok('3c elenen avuç belgeyi kirletmedi', (await undoLen()) === u0, `${u0} → ${await undoLen()}`);
  ok('3d kalem bırakılınca durum temizlenir', (await penState()).kind === null);
}
{
  // El kenarı kalemden ÖNCE iniyor. Sağır süre (700 ms) dolmadan dokunuş ZATEN elenir; bu
  // senaryoyu ölçebilmek için önce sürenin geçmesi beklenir, yoksa sınama yanlış sebeple geçer.
  await page.waitForTimeout(800);
  const p = await scr(700, 700);
  // Temas NORMAL genişlikte: geniş olsaydı zaten genişlik kuralıyla elenirdi ve bu sınama
  // "kalem inince jest atılır" kuralını değil, başka bir kuralı ölçmüş olurdu.
  await sendPen('pointerdown', { id: 3, pt: 'touch', x: p.x + 120, y: p.y + 90, width: 10, height: 10 });
  await page.waitForTimeout(40);
  const once = await ev(() => window.dwgApp.state.gestureActive);
  const v0 = await ev(() => ({ cx: window.dwgApp.state.view.cx, cy: window.dwgApp.state.view.cy }));
  await sendPen('pointerdown', { id: 4, pt: 'pen', x: p.x, y: p.y, pressure: 0.6 });
  await page.waitForTimeout(40);
  // ASIL SORU: avuç kalem indikten sonra görünümü kaydırabiliyor mu? Sayaçlar iptal edilen
  // (engellenen değil) dokunuşu saymadığı için ölçü doğrudan sonuçtan alınır.
  await sendPen('pointermove', { id: 3, pt: 'touch', x: p.x + 320, y: p.y + 260, buttons: 1 });
  await page.waitForTimeout(80);
  const v1 = await ev(() => ({ cx: window.dwgApp.state.view.cx, cy: window.dwgApp.state.view.cy }));
  ok('3e kalemden ÖNCE inen avuç, kalem inince görünümü KAYDIRAMAZ (jesti atılır)',
    once === true && Math.abs(v1.cx - v0.cx) < 1e-9 && Math.abs(v1.cy - v0.cy) < 1e-9, JSON.stringify({ once, v0, v1 }));
  await sendPen('pointerup', { id: 4, pt: 'pen', x: p.x, y: p.y });
  await sendPen('pointerup', { id: 3, pt: 'touch', x: p.x + 120, y: p.y + 90 });
  await page.waitForTimeout(60);
}
{
  await setUi({ palmReject: false });
  await page.waitForTimeout(60);
  const p = await scr(900, 900);
  const d0 = await ev(() => window.dwgApp.state.pen.drop);
  await sendPen('pointerdown', { id: 5, pt: 'pen', x: p.x, y: p.y });
  await sendPen('pointerdown', { id: 6, pt: 'touch', x: p.x + 80, y: p.y + 60, width: 60, height: 60 });
  await page.waitForTimeout(40);
  ok('3f ayar kapatılınca hiçbir dokunuş elenmez', (await ev(() => window.dwgApp.state.pen.drop)) === d0, `${d0}`);
  await sendPen('pointerup', { id: 5, pt: 'pen', x: p.x, y: p.y });
  await sendPen('pointerup', { id: 6, pt: 'touch', x: p.x + 80, y: p.y + 60 });
  await setUi({ palmReject: true });
  await page.waitForTimeout(60);
}

// ---------------------------------------------------------------------------------
// 4) Havada gezinme — uç değmeden konum ve yakalama
// ---------------------------------------------------------------------------------
{
  const ids = await ev(() => {
    const E = window.dwgApp.editor;
    E.doc.run({ op: 'add', ents: [{ id: 'kh1', type: 'LINE', pts: [[1000, 1000, 0], [1400, 1000, 0]], layer: '0', color: 256 }] });
    window.dwgApp.requestRender();
    return ['kh1'];
  });
  await zoom([900, 900, 1500, 1200]);
  const u0 = await undoLen();
  const p = await scr(1400, 1000);       // çizginin uç noktası: yakalama buraya oturmalı
  await sendPen('pointermove', { id: 8, pt: 'pen', x: p.x + 6, y: p.y + 5, buttons: 0, pressure: 0 });
  await page.waitForTimeout(160);
  const st = await penState();
  ok('4a havada gezinme konumu okunur (uç değmeden)', !!st.hover, JSON.stringify(st.hover));
  ok('4b gezinme uç noktaya YAKALANIR (1400;1000)', st.hover && Math.abs(st.hover[0] - 1400) < 1e-6 && Math.abs(st.hover[1] - 1000) < 1e-6, JSON.stringify(st.hover));
  ok('4c gezinme belgeye dokunmaz (geri alma yığını sabit)', (await undoLen()) === u0, `${u0} → ${await undoLen()}`);
  ok('4d gezinme hiçbir nesneyi SEÇMEZ', (await selKey()) === null, String(await selKey()));
  const chip = await ev(() => { const el = document.getElementById('stSnap'); return el && !el.hidden ? el.textContent.trim() : ''; });
  ok('4e yakalama çipi gezinmede de yazar', chip.length > 0, chip);
  await shot('kalem_hover');
  await sendPen('pointerout', { id: 8, pt: 'pen', x: p.x, y: p.y, buttons: 0 });
  await page.waitForTimeout(80);
  ok('4f kalem menzilden çıkınca imleç kalkar', (await penState()).hover === null);
  // ayar kapalıyken gezinme okunmaz
  await setUi({ penHover: false }); await page.waitForTimeout(60);
  await sendPen('pointermove', { id: 8, pt: 'pen', x: p.x + 6, y: p.y + 5, buttons: 0, pressure: 0 });
  await page.waitForTimeout(140);
  ok('4g ayar kapalıyken havada önizleme yapılmaz', (await penState()).hover === null);
  await setUi({ penHover: true }); await page.waitForTimeout(60);
  await ev((k) => { window.dwgApp.editor.doc.run({ op: 'delete', keys: k }); window.dwgApp.requestRender(); }, ids);
}

// ---------------------------------------------------------------------------------
// 5) Silgi ucu
// ---------------------------------------------------------------------------------
{
  await ev(() => {
    window.dwgApp.editor.doc.run({ op: 'add', ents: [{ id: 'ks1', type: 'LINE', pts: [[100, 100, 0], [900, 100, 0]], layer: '0', color: 256 }] });
    window.dwgApp.requestRender();
  });
  await zoom([0, 0, 1000, 400]);
  const n0 = await count(), u0 = await undoLen();
  const p = await scr(500, 100);
  await sendPen('pointerdown', { id: 20, pt: 'pen', x: p.x, y: p.y, buttons: 32, pressure: 0.5 });
  await page.waitForTimeout(40);
  ok('5a silgi basılıyken belge HENÜZ değişmez (bırakışta silinir)', (await count()) === n0, `${n0} → ${await count()}`);
  await sendPen('pointerup', { id: 20, pt: 'pen', x: p.x, y: p.y, buttons: 0, button: 5 });
  await page.waitForTimeout(150);
  ok('5b silgi ucu nesneyi siler', (await count()) === n0 - 1, `${n0} → ${await count()}`);
  ok('5c silme tek geri alma adımıdır', (await undoLen()) === u0 + 1, `${u0} → ${await undoLen()}`);
  await shot('kalem_silgi');
  await ev(() => window.dwgApp.editor.doc.undo());
  await page.waitForTimeout(120);
  ok('5d geri al nesneyi geri getirir', (await count()) === n0, String(await count()));
  // boşluğa silgi: uyarı verir, belge değişmez
  const bos = await scr(500, 380);
  const u1 = await undoLen();
  await sendPen('pointerdown', { id: 21, pt: 'pen', x: bos.x, y: bos.y, buttons: 32 });
  await sendPen('pointerup', { id: 21, pt: 'pen', x: bos.x, y: bos.y, buttons: 0, button: 5 });
  await page.waitForTimeout(150);
  ok('5e boşlukta silgi belgeyi kirletmez ve uyarır', (await undoLen()) === u1 && /bulunamadı|not found/i.test(await toast()), await toast());
  await ev(() => { const p = window.dwgApp.state.prims.find(x => x.key === 'ks1'); if (p) window.dwgApp.editor.doc.run({ op: 'delete', keys: ['ks1'] }); window.dwgApp.requestRender(); });
}

// ---------------------------------------------------------------------------------
// 6) Yan (barrel) düğme
// ---------------------------------------------------------------------------------
{
  await setUi({ penBarrel: 'menu' }); await page.waitForTimeout(60);
  const p = await scr(500, 500);
  await zoom([0, 0, 2000, 2000]);
  const q = await scr(500, 500);
  await sendPen('pointerdown', { id: 30, pt: 'pen', x: q.x, y: q.y, buttons: 3, button: 2, pressure: 0.5 });
  await page.waitForTimeout(160);
  const menu = await ev(() => { const d = document.getElementById('docPanel'); return !!(d && !d.hidden && d.querySelector('.ctx-list')); });
  ok('6a yan düğme "menü" görevinde uzun basış menüsünü açar', menu === true, String(menu));
  await sendPen('pointerup', { id: 30, pt: 'pen', x: q.x, y: q.y, buttons: 0, button: 2 });
  await ev(() => { const d = document.getElementById('docPanel'); if (d) d.hidden = true; });
  await page.waitForTimeout(80);
  // "yok" görevinde çizim akışına karışmaz
  await setUi({ penBarrel: 'none' }); await page.waitForTimeout(60);
  await sendPen('pointerdown', { id: 31, pt: 'pen', x: q.x, y: q.y, buttons: 3, button: 2 });
  await page.waitForTimeout(120);
  const menu2 = await ev(() => { const d = document.getElementById('docPanel'); return !!(d && !d.hidden && d.querySelector('.ctx-list')); });
  ok('6b "yok" seçilince yan düğme hiçbir şey yapmaz', menu2 === false);
  await sendPen('pointerup', { id: 31, pt: 'pen', x: q.x, y: q.y, buttons: 0, button: 2 });
  await setUi({ penBarrel: 'menu' }); await page.waitForTimeout(60);
}

// ---------------------------------------------------------------------------------
// 7) Basınç → not kalınlığı
// ---------------------------------------------------------------------------------
{
  await ev(() => { window.dwgApp.editor.act('notes'); });
  await page.waitForTimeout(150);
  await ev(() => { window.dwgApp.state.noteTool = 'pen'; });
  await page.waitForTimeout(120);
  const a = await scr(300, 300), b = await scr(600, 400), c2 = await scr(900, 300);
  // Basıncın GERÇEK olduğu önce ölçülmeli: sabit 0,5 gelirse kalınlık dizisi kurulmaz.
  await sendPen('pointermove', { id: 40, pt: 'pen', x: a.x, y: a.y, buttons: 0, pressure: 0.2 });
  await sendPen('pointermove', { id: 40, pt: 'pen', x: a.x, y: a.y, buttons: 0, pressure: 0.9 });
  await page.waitForTimeout(80);
  await sendPen('pointerdown', { id: 40, pt: 'pen', x: a.x, y: a.y, pressure: 0.25 });
  await sendPen('pointermove', { id: 40, pt: 'pen', x: b.x, y: b.y, buttons: 1, pressure: 0.6 });
  await sendPen('pointermove', { id: 40, pt: 'pen', x: c2.x, y: c2.y, buttons: 1, pressure: 0.95 });
  await sendPen('pointerup', { id: 40, pt: 'pen', x: c2.x, y: c2.y, buttons: 0 });
  await page.waitForTimeout(150);
  const n = await ev(async () => {
    const N = await import('./notes.js');
    const last = N.notes.items[N.notes.items.length - 1];
    return last ? { type: last.type, pts: last.pts.length, pr: last.pr ? last.pr.slice() : null } : null;
  });
  ok('7a kalemle çizilen not basınç dizisi taşır', n && n.type === 'pen' && !!n.pr, JSON.stringify(n));
  ok('7b basınç dizisi nokta sayısıyla birebir aynı uzunlukta', n && n.pr && n.pr.length === n.pts, JSON.stringify(n && { pts: n.pts, pr: n.pr.length }));
  ok('7c kaydedilen basınçlar gerçekten değişiyor', n && n.pr && Math.max(...n.pr) - Math.min(...n.pr) > 0.1, JSON.stringify(n && n.pr));
  await shot('kalem_basinc');
  await ev(async () => { const N = await import('./notes.js'); for (const x of [...N.notes.items]) N.removeNote(x.id); });
  await ev(() => { if (window.dwgApp.state.notesOn) window.dwgApp.editor.act('notes'); });
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------------
// 8) "Kalem çizer, parmak gezinir"
// ---------------------------------------------------------------------------------
{
  await page.waitForTimeout(800);   // önceki bölümdeki kalemin sağır süresi dolsun, dokunuş elenmesin
  await zoom([0, 0, 2000, 2000]);
  await ev(() => { window.dwgApp.editor.doc.run({ op: 'add', ents: [{ id: 'kn1', type: 'LINE', pts: [[200, 200, 0], [1800, 200, 0]], layer: '0', color: 256 }] }); window.dwgApp.requestRender(); });
  await page.waitForTimeout(120);
  const p = await scr(1000, 200);
  await setUi({ penDraw: false }); await page.waitForTimeout(60);
  await ev(() => { window.dwgApp.state.selected = null; });
  await sendPen('pointerdown', { id: 50, pt: 'touch', x: p.x, y: p.y });
  await sendPen('pointerup', { id: 50, pt: 'touch', x: p.x, y: p.y });
  await page.waitForTimeout(200);
  ok('8a kip KAPALIYKEN parmakla dokunuş nesneyi seçer (eski davranış korunur)', (await selKey()) !== null, String(await selKey()));
  await ev(() => { window.dwgApp.state.selected = null; });
  await setUi({ penDraw: true }); await page.waitForTimeout(60);
  await sendPen('pointerdown', { id: 51, pt: 'touch', x: p.x, y: p.y });
  await sendPen('pointerup', { id: 51, pt: 'touch', x: p.x, y: p.y });
  await page.waitForTimeout(200);
  ok('8b kip AÇIKKEN parmakla dokunuş SEÇMEZ (yalnız gezinir)', (await selKey()) === null, String(await selKey()));
  await sendPen('pointerdown', { id: 52, pt: 'pen', x: p.x, y: p.y, pressure: 0.5 });
  await sendPen('pointerup', { id: 52, pt: 'pen', x: p.x, y: p.y, buttons: 0 });
  await page.waitForTimeout(200);
  ok('8c kip AÇIKKEN kalemle dokunuş yine seçer', (await selKey()) !== null, String(await selKey()));
  await setUi({ penDraw: false }); await page.waitForTimeout(60);
  await ev(() => { window.dwgApp.editor.doc.run({ op: 'delete', keys: ['kn1'] }); window.dwgApp.state.selected = null; window.dwgApp.requestRender(); });
}

// ---------------------------------------------------------------------------------
// 9) Ayar bölümü
// ---------------------------------------------------------------------------------
{
  const sec = await ev(async () => {
    const E = await import('./editor.js');
    const s = E.accessibilitySection();
    const d = document.createElement('div'); d.innerHTML = s.html;
    const pen = d.querySelector('.pen-sec');
    return pen ? {
      var: true,
      anahtarlar: [...pen.querySelectorAll('input[data-pen]')].map(i => i.dataset.pen),
      gorevler: [...pen.querySelectorAll('.seg[data-pen-act] button')].map(b => b.dataset.val),
      durum: (pen.querySelector('.muted') || {}).textContent || '',
      hamEtiket: /\bpen[A-Z]/.test(pen.textContent),
    } : { var: false };
  });
  ok('9a ayarlarda kalem bölümü var', sec.var === true);
  ok('9b beş ayar anahtarı: avuç reddi, havada önizleme, kalem kipi, basınç', sec.var && ['palmReject', 'penHover', 'penDraw', 'penPressure'].every(k => sec.anahtarlar.includes(k)), JSON.stringify(sec.anahtarlar));
  ok('9c yan düğme görev listesi beş seçenek', sec.var && sec.gorevler.length === 5 && sec.gorevler.includes('menu') && sec.gorevler.includes('erase'), JSON.stringify(sec.gorevler));
  ok('9d kalem algılandığı için durum satırı bunu söyler', sec.var && /algıland|detect/i.test(sec.durum), sec.durum);
  ok('9e ham anahtar adı sızmamış (çeviri eksikse "penTitle" yazardı)', sec.var && sec.hamEtiket === false);
}

ok('10 sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); await srv.kill();
C.summary(); C.exit();
