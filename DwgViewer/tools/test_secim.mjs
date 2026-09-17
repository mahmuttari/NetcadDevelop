/*
 * SEÇİM ARACI — pencere / kesen kutu (AutoCAD yön kuralı), çokgen (lasso), seçim rozeti ve seçime
 * uygulanan yüzen menü (Sil, Kopyala, Taşı, Blok yap, Döndür, Ayna, Ölçek, Renk, Çizgi tipi, Katman,
 * Özellikler, Seçimi bırak). Sürükleme sentetik işaretçi olaylarıyla verilir (dokunma).
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_secim.mjs
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, samplesDir } from './harness.mjs';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message.slice(0, 200)); });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${samplesDir}/example_2000.dwg`, { settle: 400 });
await ev(() => { localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); document.getElementById('toast').hidden = true; });
const J = JSON.stringify, bekle = (ms = 160) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const sel = () => ev(() => ({ n: window.dwgApp.editor.sel.size, keys: [...window.dwgApp.editor.sel].map(p => p.key), active: window.dwgApp.editor.tools.active, mode: window.dwgApp.editor.tools.selMode, selecting: window.dwgApp.editor.tools.selecting }));
const badge = () => ev(() => { const b = document.getElementById('selBadge'); return { hidden: b.hidden, n: b.querySelector('.n').textContent, left: parseFloat(b.style.left), top: parseFloat(b.style.top) }; });
const doc = () => ev(() => ({ acik: !document.getElementById('docPanel').hidden, baslik: document.getElementById('docTitle').textContent }));
const klik = async (s) => { const r = await ev((q) => { const b = document.querySelector(q); if (!b) return false; b.click(); return true; }, s); await bekle(); return r; };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(150); };
const scr = (x, y) => ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]);
/** Sentetik dokunma sürüklemesi: ekran (görüntü alanı) koordinatlarıyla nokta dizisi */
const drag = async (pts) => {
  await ev((pts) => {
    const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
    const mk = (type, p) => new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    vp.dispatchEvent(mk('pointerdown', pts[0]));
    for (const p of pts.slice(1)) vp.dispatchEvent(mk('pointermove', p));
    vp.dispatchEvent(mk('pointerup', pts[pts.length - 1]));
  }, pts);
  await bekle(260);
};
const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dwgApp.editor.tools.say(); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);

// Hedef: tek parçalı, yatay ya da eğik bir çizgi (uç noktaları bilinen)
const P = await ev(() => { const S = window.dwgApp.state; const p = S.prims.find(q => q.k === 0 && q.ops.length === 2 && q.ops[0][0] === 0 && q.ops[1][0] === 1 && Math.abs(q.bb[2] - q.bb[0]) > 10 && Math.abs(q.bb[3] - q.bb[1]) > 10 && !(S.layers.get(q.lay) && S.layers.get(q.lay).locked)); return p ? { key: p.key, bb: p.bb, lay: p.lay, ci: p.info ? p.info.ci : null } : null; });
console.log('hedef', J(P));
const w = P.bb[2] - P.bb[0], h = P.bb[3] - P.bb[1];
await zoom([P.bb[0] - w, P.bb[1] - h, P.bb[2] + w, P.bb[3] + h]);
const box = async (x0, y0, x1, y1) => [await scr(x0, y0), await scr(x1, y1)];   // dünya → ekran

{
  await ev(() => window.dwgApp.editor.act('t:select')); await bekle(200);
  const b = await ev(() => ({ selbox: !!document.querySelector('#cmdBtns [data-cmd="selbox"]'), lasso: !!document.querySelector('#cmdBtns [data-cmd="sellasso"]'), selall: !!document.querySelector('#cmdBtns [data-cmd="selall"]'), enter: document.getElementById('cmdEnter').hidden, title: document.querySelector('#cmdBtns [data-cmd="selbox"]').title, w: document.querySelector('#cmdBtns [data-cmd="selbox"]').getBoundingClientRect().width, satir: document.getElementById('cmdBar').getBoundingClientRect().height }));
  ok('1 seç aracı: Pencere ve Çokgen düğmeleri (simge, başlıklı), Tümü; giriş yokken Enter gizli; çubuk iki satır (< 100 px)', b.selbox && b.lasso && b.selall && b.enter && b.title === 'Pencere / kesen kutu' && b.w >= 40 && b.satir < 100, J(b));
  await klik('#cmdBtns [data-cmd="selbox"]');
  const m = await sel(), on = await ev(() => document.querySelector('#cmdBtns [data-cmd="selbox"]').classList.contains('on'));
  const prompt = await ev(() => document.getElementById('cmdText').textContent);
  ok('2 Pencere düğmesi kutu kipini açar, düğme vurgulanır, istem yön kuralını söyler', m.mode === 'box' && on && /soldan sağa/.test(prompt), J({ m, on, prompt }));
  await shot('secim_kutu_kipi');
  // pencere: kutunun TAMAMINI saran soldan sağa sürükleme → seçilir
  const [a, b2] = await box(P.bb[0] - w * 0.2, P.bb[3] + h * 0.2, P.bb[2] + w * 0.2, P.bb[1] - h * 0.2);
  await temizle(); await drag([a, [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2], b2]);
  const s1 = await sel();
  ok('3 PENCERE (soldan sağa, tamamını saran): hedef seçildi, ileti "n nesne seçildi"', s1.keys.includes(P.key) && /nesne seçildi/.test(await toast()), J({ s1, t: await toast() }));
  const bd = await badge();
  ok('4 seçim rozeti göründü ve sayıyı yazıyor', !bd.hidden && bd.n === String(s1.n) && bd.left >= 0 && bd.top >= 0, J(bd));
  await shot('secim_rozet');
  await ev(() => window.dwgApp.editor.selAction('clear')); await bekle();
  const s2 = await sel(), bd2 = await badge();
  ok('5 "Seçimi bırak": seçim boş, rozet gizli, araç kapandı', s2.n === 0 && bd2.hidden && s2.active === null, J({ s2, bd2 }));
}
{
  // yarım kutu: pencere seçmez, kesen seçer
  await ev(() => window.dwgApp.editor.act('t:select')); await bekle(); await klik('#cmdBtns [data-cmd="selbox"]');
  const [a, b2] = await box(P.bb[0] - w * 0.2, P.bb[3] + h * 0.2, P.bb[0] + w * 0.5, P.bb[1] - h * 0.2);   // sol yarı
  await temizle(); await drag([a, b2]);
  const s1 = await sel();
  ok('6 yarım kutu PENCERE: çizginin yarısı dışarıda → seçilmez, "bölgede nesne yok" ya da başka nesne', !s1.keys.includes(P.key), J(s1));
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.say(); });
  await drag([b2, a]);   // sağdan sola: KESEN
  const s2 = await sel();
  ok('7 aynı yarım kutu KESEN (sağdan sola): çizgi dokunduğu için seçilir', s2.keys.includes(P.key), J(s2));
  const kutuOn = await ev(() => document.querySelector('#cmdBtns [data-cmd="selbox"]').classList.contains('on'));
  ok('8 kutu kipi sürüklemeden sonra da açık kalır (art arda bölge eklenir)', kutuOn && (await sel()).mode === 'box');
  await klik('#cmdBtns [data-cmd="selbox"]');
  ok('9 düğmeye yeniden dokunmak dokunma kipine döndürür', (await sel()).mode === 'tap');
  await ev(() => window.dwgApp.editor.selAction('clear')); await bekle();
}
{
  // AutoCAD'in ÖRTÜK PENCERESİ (v7.57): dokunma kipinde boş yerden sürüklemek kutu seçer — düğmeye gerek yok.
  // Soldan sağa mavi pencere (içindekiler), sağdan sola yeşil kesen (dokunanlar); etiket işaretçinin yanında.
  await ev(() => window.dwgApp.editor.act('t:select')); await bekle();
  const [a, b2] = await box(P.bb[0] - w * 0.2, P.bb[3] + h * 0.2, P.bb[2] + w * 0.2, P.bb[1] - h * 0.2);
  const prompt = await ev(() => document.getElementById('cmdText').textContent);
  ok('9a dokunma kipinin istemi örtük pencereyi söyler (→ pencere, ← kesen)', (await sel()).mode === 'tap' && /→ pencere/.test(prompt) && /← kesen/.test(prompt), prompt);
  // sürükleme ortasında kutunun kipi okunur: soldan sağa → pencere (crossing false), örtük
  const orta = await ev(([a, b]) => {
    const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
    const mk = (type, p) => new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    vp.dispatchEvent(mk('pointerdown', a)); vp.dispatchEvent(mk('pointermove', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])); vp.dispatchEvent(mk('pointermove', b));
    const st = window.dwgApp.editor.selDragState();
    vp.dispatchEvent(mk('pointerup', b));
    return st;
  }, [a, b2]);
  await bekle(260);
  const s1 = await sel();
  ok('9b boş yerden soldan sağa sürükleme: örtük PENCERE (mavi, kesen değil) → hedef seçildi', orta && orta.implied && orta.mode === 'box' && orta.crossing === false && s1.keys.includes(P.key) && s1.mode === 'tap', J({ orta, s1 }));
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.say(); });
  const [c, d2] = await box(P.bb[0] - w * 0.2, P.bb[3] + h * 0.2, P.bb[0] + w * 0.5, P.bb[1] - h * 0.2);   // sol yarı
  const orta2 = await ev(([a, b]) => {
    const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
    const mk = (type, p) => new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + p[0], clientY: r.top + p[1], button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    vp.dispatchEvent(mk('pointerdown', b)); vp.dispatchEvent(mk('pointermove', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])); vp.dispatchEvent(mk('pointermove', a));
    const st = window.dwgApp.editor.selDragState();
    vp.dispatchEvent(mk('pointerup', a));
    return st;
  }, [c, d2]);
  await bekle(260);
  const s2 = await sel();
  ok('9c boş yerden sağdan sola yarım kutu: örtük KESEN (yeşil) → dokunan çizgi seçildi', orta2 && orta2.implied && orta2.crossing === true && s2.keys.includes(P.key), J({ orta2, s2 }));
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.say(); });
  // nesnenin üstünden başlayan sürükleme kutu DEĞİLDİR (dokunmak nesneyi seçer, sürüklemek kaydırır)
  const uz = await scr((P.bb[0] + P.bb[2]) / 2, (P.bb[1] + P.bb[3]) / 2);
  const orta3 = await ev(([p, b]) => {
    const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
    const mk = (type, q) => new PointerEvent(type, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + q[0], clientY: r.top + q[1], button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    vp.dispatchEvent(mk('pointerdown', p)); vp.dispatchEvent(mk('pointermove', [p[0] + 40, p[1] + 40])); vp.dispatchEvent(mk('pointermove', b));
    const st = window.dwgApp.editor.selDragState();
    vp.dispatchEvent(mk('pointercancel', b));
    return st;
  }, [uz, b2]);
  await bekle(200);
  ok('9d nesnenin üstünden başlayan sürükleme örtük kutu açmaz (kaydırma kalır)', orta3 === null, J(orta3));
  // boş yere yalnız dokunmak bir şey seçmez ve kutu bırakmaz
  await ev(() => window.dwgApp.editor.sel.clear());
  await drag([a, a]);
  const s4 = await sel();
  ok('9e boş yere yalnız dokunmak seçim yapmaz, kutu kalmaz', s4.n === 0 && (await ev(() => window.dwgApp.editor.selDragState())) === null, J(s4));
  const renk = await ev(async () => { const E = await import('./editor.js'); return E.SEL_COLORS; });
  ok('9f renkler AutoCAD düzeni: pencere mavi, kesen yeşil', renk && renk.window === '#4da3ff' && renk.crossing === '#3ddc84', J(renk));
  ok('9g dokunma kipinin istemi kısa kalır (çubuk < 100 px)', (await ev(() => document.getElementById('cmdBar').getBoundingClientRect().height)) < 100);
  await ev(() => window.dwgApp.editor.tools.cancel()); await ev(() => window.dwgApp.editor.sel.clear()); await bekle();
}
{
  // çokgen (lasso)
  await ev(() => window.dwgApp.editor.act('t:select')); await bekle(); await klik('#cmdBtns [data-cmd="sellasso"]');
  ok('10 Çokgen kipi', (await sel()).mode === 'lasso' && /Çokgen/.test(await ev(() => document.getElementById('cmdText').textContent)));
  const c = [[P.bb[0] - w * 0.25, P.bb[1] - h * 0.25], [P.bb[2] + w * 0.25, P.bb[1] - h * 0.25], [P.bb[2] + w * 0.25, P.bb[3] + h * 0.25], [P.bb[0] - w * 0.25, P.bb[3] + h * 0.25]];
  const spts = []; for (const q of c) spts.push(await scr(q[0], q[1]));
  await temizle(); await drag([spts[0], spts[1], spts[2], spts[3], spts[0]]);   // sağa başlayan tur: pencere
  const s1 = await sel();
  ok('11 çokgen PENCERE (sağa başlayan): tamamı içerideki çizgi seçildi', s1.keys.includes(P.key), J(s1));
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.say(); });
  const yarim = [[P.bb[0] + w * 0.5, P.bb[1] - h * 0.25], [P.bb[0] - w * 0.25, P.bb[1] - h * 0.25], [P.bb[0] - w * 0.25, P.bb[3] + h * 0.25], [P.bb[0] + w * 0.5, P.bb[3] + h * 0.25]];
  const y2 = []; for (const q of yarim) y2.push(await scr(q[0], q[1]));
  await drag([y2[0], y2[1], y2[2], y2[3], y2[0]]);   // sola başlayan: kesen, yalnız sol yarıyı sarar
  ok('12 çokgen KESEN (sola başlayan, yarım): dokunan çizgi seçildi', (await sel()).keys.includes(P.key), J(await sel()));
  await shot('secim_cokgen');
}
{
  // rozet → menü; renk / çizgi tipi / katman / sil / taşı
  await klik('#selBadge');
  const d = await doc();
  const kart = await ev(() => [...document.querySelectorAll('#docBody .sel-grid .os-card')].map(b => b.dataset.sm).join(','));
  ok('13 rozete dokunmak seçim menüsünü açar: 16 kart (benzerini seç, gizle, izole et, kes dâhil)', d.acik && /^Seçim · \d+ nesne$/.test(d.baslik) && kart === 'del,copy,move,block,rotate,mirror,scale,color,ltype,layer,props,similar,hide,iso,cut,clear', J({ d, kart }));
  await shot('secim_menu');
  await klik('#docBody [data-sm="color"]');
  ok('14 Renk: renk kutusu açıldı', (await doc()).baslik === 'Renk seç');
  const u0 = await ev(() => window.dwgApp.editor.doc.log.length);
  await klik('#docBody [data-ci="1"]');
  const ci = await ev((k) => { const p = window.dwgApp.state.prims.find(q => q.key === k); return p.info.ci; }, P.key);
  ok('15 kırmızıya dokununca seçimin rengi ACI 1 oldu, tek komut', ci === 1 && (await ev(() => window.dwgApp.editor.doc.log.length)) === u0 + 1, J({ ci }));
  await ev(() => window.dwgApp.editor.selAction('ltype')); await bekle();
  const lts = await ev(() => [...document.querySelectorAll('#docBody [data-lt]')].map(e => e.dataset.lt));
  ok('16 Çizgi tipi listesi: Katmandan + dosyanın çizgi tipleri', lts[0] === '' && lts.length >= 1, J(lts));
  const hedefLt = lts.find(x => x) || null;
  if (hedefLt) {
    await ev((k) => { document.querySelector(`#docBody [data-lt="${k}"]`).click(); }, hedefLt); await bekle();
    const lt = await ev((k) => { const p = window.dwgApp.state.prims.find(q => q.key === k); return { lt: p.lt, info: p.info.lt, ent: p.ent && p.ent.linetype }; }, P.key);
    ok('17 çizgi tipi nesneye işlendi (lt, info.lt, ent.linetype)', lt.lt === hedefLt && lt.info === hedefLt && (lt.ent === hedefLt || lt.ent == null), J(lt));
    await ev(() => window.dwgApp.editor.selAction('ltype')); await bekle(); await klik('#docBody [data-lt=""]');
    ok('18 Katmandan seçilince lt boşalır', (await ev((k) => window.dwgApp.state.prims.find(q => q.key === k).lt, P.key)) === null);
  } else { await ev(() => window.dwgApp.onBack()); C.skip('17-18 çizgi tipi', 'dosyada çizgi tipi yok'); }
  await ev(() => window.dwgApp.editor.selAction('layer')); await bekle();
  const lays = await ev(() => [...document.querySelectorAll('#docBody [data-lay]')].map(e => e.dataset.lay));
  const hedefLay = lays.find(l => l !== P.lay);
  await ev((l) => { document.querySelector(`#docBody [data-lay="${l}"]`).click(); }, hedefLay); await bekle();
  ok('19 Katman değiştir: nesne ' + hedefLay + ' katmanına geçti', (await ev((k) => window.dwgApp.state.prims.find(q => q.key === k).lay, P.key)) === hedefLay);
  for (let i = 0; i < (hedefLt ? 4 : 2); i++) await ev(() => window.dwgApp.editor.doc.undo());
  const geri = await ev((k) => { const p = window.dwgApp.state.prims.find(q => q.key === k); return { lay: p.lay, ci: p.info.ci, lt: p.lt || null }; }, P.key);
  ok('20 geri alma renk / çizgi tipi / katmanı eski hâline döndürür', geri.lay === P.lay && geri.ci === P.ci && geri.lt === null, J({ geri, P }));
  // taşı: seçim korunur, taban noktası sorulur
  await ev(() => window.dwgApp.editor.selAction('move')); await bekle();
  const mv = await sel();
  ok('21 menüden Taşı: araç move, seçim korunur, seçim aşaması atlanır (taban noktası)', mv.active === 'move' && mv.n >= 1 && mv.selecting === false, J(mv));
  await ev(() => window.dwgApp.editor.tools.cancel()); await bekle();
  // sil + geri al
  const n0 = await ev(() => window.dwgApp.state.prims.length);
  await ev((k) => { const S = window.dwgApp.state, E = window.dwgApp.editor; E.sel.clear(); E.sel.add(S.prims.find(q => q.key === k)); }, P.key);
  await ev(() => window.dwgApp.editor.selAction('del')); await bekle();
  const n1 = await ev(() => window.dwgApp.state.prims.length);
  ok('22 menüden Sil: nesne gitti, seçim boş, rozet gizli', n1 === n0 - 1 && (await sel()).n === 0 && (await badge()).hidden, `${n0} → ${n1}`);
  await ev(() => window.dwgApp.editor.doc.undo()); await bekle();
  ok('23 silme geri alındı', (await ev(() => window.dwgApp.state.prims.length)) === n0);
}
{
  await dil('en'); await bekle(150);
  await ev((k) => { const S = window.dwgApp.state, E = window.dwgApp.editor; E.sel.add(S.prims.find(q => q.key === k)); E.selMenu(); }, P.key); await bekle();
  const en = await ev(() => ({ baslik: document.getElementById('docTitle').textContent, lbl: [...document.querySelectorAll('#docBody .sel-grid .os-card span')].map(s => s.textContent).slice(0, 4).join('|') }));
  // İngilizce arayüzde araç adı AutoCAD komut adıdır (v7.50 kuralı): ERASE, COPY, MOVE
  ok('24 EN: "Selection · 1 objects", kart adları İngilizce (AutoCAD komut adları)', /^Selection · 1 /.test(en.baslik) && en.lbl === 'ERASE|COPY|MOVE|Make block', J(en));
  await ev(() => window.dwgApp.onBack()); await dil('tr'); await bekle();
  await ev(() => window.dwgApp.editor.act('t:select')); await bekle();
  const enBtn = await ev(() => document.querySelector('#cmdBtns [data-cmd="sellasso"]').title);
  ok('25 çokgen düğmesi başlığı Türkçe', enBtn === 'Çokgen (serbest)', enBtn);
  await ev(() => window.dwgApp.editor.tools.cancel());
}
{
  // Seçim aşamasındaki başka bir araçta da (Taşı) pencere seçimi çalışır
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.act('t:move'); }); await bekle();
  const m0 = await sel();
  await klik('#cmdBtns [data-cmd="selbox"]');
  const [a, b2] = await box(P.bb[0] - w * 0.2, P.bb[3] + h * 0.2, P.bb[2] + w * 0.2, P.bb[1] - h * 0.2);
  await drag([a, b2]);
  const m1 = await sel();
  ok('26 Taşı aracının seçim aşamasında da Pencere kutusu çalışır (hedef seçildi, araç move)', m0.active === 'move' && m0.selecting && m1.keys.includes(P.key) && m1.active === 'move', J({ m0, m1 }));
  await ev(() => window.dwgApp.editor.tools.cancel()); await ev(() => window.dwgApp.editor.sel.clear());
}
ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
