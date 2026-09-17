// PICKBOX (v7.57): AutoCAD'in imleç kuralı. NOKTA isteminde artı imleç çıkar ve nesne yakalama
// (osnap) çalışır; NESNE isteminde ("Select objects:") imleç küçük bir kareye döner ve yakalama
// hiç çalışmaz — düzenleme araçlarının seçim aşamasında yakalamanın anlamı yoktur. Boştayken
// ikisi birden görünür. Karenin yarı boyu gerçek seçim toleransıdır (TOL.pick), eldivende büyür.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_pickbox.mjs [çıktı] [örnekler]
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
const J = JSON.stringify;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes(['end', 'mid', 'int']); });

const bekle = (ms = 140) => page.waitForTimeout(ms);
const kutu = () => ev(() => window.dwgApp.__pickbox());
const yakala = (x, y, o) => ev(([a, b, c]) => window.dwgApp.__snapAt(a, b, c), [x, y, o || null]);
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, selecting: T.selecting, mode: T.mode, step: T.step, nokta: T.running ? T.wantsPoint() : null, secim: window.dwgApp.editor.sel.size }; });
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor, ids = es.map((e, i) => 'pb_' + i); E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: ids[i], layer: '0', color: 256 })) }); window.dwgApp.requestRender(); return ids; }, ents);
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const tapWorld = async (x, y) => { await bekle(110); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(380); };
const ciz = async () => { await ev(() => window.dwgApp.requestRender()); await bekle(180); };
/** Kaplama tuvalinde (x, y) çevresindeki yarıçap kadar pencerede boyalı piksel sayısı */
const piksel = (x, y, rad = 2) => ev(([x, y, rad]) => {
  const ov = document.getElementById('ov'), c = ov.getContext('2d'), d = window.dwgApp.state.dpr;
  const X = Math.round(x * d), Y = Math.round(y * d), R = Math.max(1, Math.round(rad * d));
  if (X - R < 0 || Y - R < 0 || X + R >= ov.width || Y + R >= ov.height) return -1;
  const im = c.getImageData(X - R, Y - R, R * 2 + 1, R * 2 + 1).data;
  let n = 0; for (let i = 3; i < im.length; i += 4) if (im[i] > 24) n++;
  return n;
}, [x, y, rad]);
/** İmleci boş bir ekran noktasına koyar (dünya karşılığı hesaplanır), çizer ve üç örnek nokta okur */
const imlecOku = async (sx, sy) => {
  const w = await ev(([a, b]) => window.dwgApp.toWorld(a, b), [sx, sy]);
  await ev((p) => { window.dwgApp.state.lastPoint = [p[0], p[1]]; }, w);
  await ciz();
  const { r } = await kutu();
  return { r, merkez: await piksel(sx, sy), kose: await piksel(sx + r, sy + r), disari: await piksel(sx + r + 8, sy + r + 8) };
};

await page.click('#toolbar [data-tab="edit"]');
// Bilinen üç doğru: yatay (uçları 200,200 ve 600,200), düşey (700,300 - 700,600), yatay (150,450 - 550,450)
await ekle([
  { type: 'LINE', pts: [[200, 200, 0], [600, 200, 0]] },
  { type: 'LINE', pts: [[700, 300, 0], [700, 600, 0]] },
  { type: 'LINE', pts: [[150, 450, 0], [550, 450, 0]] },
]);
await zoom([100, 100, 800, 700]);

// ---------------------------------------------------------------------------------
// 1 · Boşta: komut yok → yakalama çalışır, kare istemi kapalı
// ---------------------------------------------------------------------------------
{
  const k = await kutu(), sn = await yakala(200, 200);
  ok('1a boşta nesne istemi yok (pickingObject false), kare yarı boyu = seçim toleransı (12 px)', k.on === false && k.r === 12 && k.tol === 12, J(k));
  ok('1b boşta yakalama çalışır: (200,200) uç noktası bulunur', !!sn && sn.kind === 'end' && sn.p[0] === 200 && sn.p[1] === 200, J(sn));
}

// ---------------------------------------------------------------------------------
// 2 · Seç aracı: nesne istemi → yakalama susar, imleç kare olur
// ---------------------------------------------------------------------------------
{
  await arac('t:select');
  const d = await durum(), k = await kutu();
  ok('2a Seç aracı seçim aşamasındadır ve nesne istemi açıktır', d.selecting === true && k.on === true, J({ d, k }));
  const sn = await yakala(200, 200);
  ok('2b nesne isteminde yakalama HİÇ çalışmaz: aynı uç noktada sonuç null', sn === null, J(sn));
  const g = await yakala(200, 200, { grip: true });
  ok('2c tutamak (grip) sürüklemesi muaftır: { grip:true } ile uç nokta yine bulunur', !!g && g.kind === 'end', J(g));
}

// ---------------------------------------------------------------------------------
// 3 · Kaplamada gerçekten KARE çizilir (artı değil): köşede boya var, merkez boş
// ---------------------------------------------------------------------------------
{
  const vpb = await page.locator('#viewport').boundingBox();
  const sx = Math.round(vpb.width * 0.32), sy = Math.round(vpb.height * 0.30);
  const kare = await imlecOku(sx, sy);
  ok('3a nesne isteminde kare: köşede boya var, merkez boş, karenin dışı boş', kare.kose > 0 && kare.merkez === 0 && kare.disari === 0, J(kare));
  await iptal();
  await arac('t:line');
  const arti = await imlecOku(sx, sy);
  ok('3b nokta isteminde artı imleç: merkez boyalı, köşe boş (kare yok)', arti.merkez > 0 && arti.kose === 0, J(arti));
  const d = await durum(), k = await kutu(), sn = await yakala(600, 200);
  ok('3c çizim aracı nokta ister: nesne istemi kapalı ve yakalama çalışır', d.selecting === false && k.on === false && !!sn && sn.kind === 'end', J({ d, k, sn }));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 4 · Taşı: önce nesne istemi (kare, yakalama yok), seçim bitince nokta istemi (artı, yakalama var)
// ---------------------------------------------------------------------------------
{
  await arac('t:move');
  const a = await kutu();
  ok('4a Taşı seçim aşamasıyla başlar: nesne istemi açık', a.on === true && (await durum()).selecting === true, J(a));
  ok('4b seçim aşamasında yakalama yok', (await yakala(700, 300)) === null);
  await tapWorld(400, 200);                                    // yatay doğruya dokun → seç
  await page.click('#cmdBtns [data-cmd="finish"]'); await bekle(200);
  const d = await durum(), k = await kutu(), sn = await yakala(700, 300);
  ok('4c seçim bitti, taban noktası isteniyor: nesne istemi kapandı, yakalama geri geldi', d.selecting === false && d.secim === 1 && k.on === false && !!sn && sn.kind === 'end', J({ d, k, sn }));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 5 · Ekran / Ölçü soran araçlar: soru ve nesne adımı kare, taraf / köşe noktası artı
// ---------------------------------------------------------------------------------
{
  await arac('t:trim');
  ok('5a Buda: Ekran / Ölçü sorusu henüz yanıtlanmadı, sıradaki dokunuş NESNE seçer → kare', (await kutu()).on === true && (await durum()).mode === null);
  ok('5b Buda sorusunda yakalama yok', (await yakala(150, 450)) === null);
  await iptal();

  await arac('t:offset');
  await ev(() => window.dwgApp.editor.tools.setValue(40)); await bekle(150);
  const o1 = await kutu(), d1 = await durum();
  ok('5c Ötele Ölçü kipi: değer yazıldı, şimdi NESNE isteniyor → kare, yakalama yok', o1.on === true && d1.mode === 'value' && d1.nokta === false && (await yakala(150, 450)) === null, J({ o1, d1 }));
  await tapWorld(350, 450);                                    // nesneyi seç → taraf noktası adımı
  const o2 = await kutu(), d2 = await durum(), sn = await yakala(550, 450);
  ok('5d Ötelede taraf NOKTASI isteniyor: kare kalktı, artı ve yakalama geri geldi', d2.nokta === true && o2.on === false && !!sn && sn.kind === 'end', J({ o2, d2, sn }));
  await iptal();

  await arac('t:fillet');
  ok('5e Kavis Ekran kipi, birinci nesne: kare', (await kutu()).on === true);
  await tapWorld(400, 200); await tapWorld(700, 500);
  const f = await kutu(), df = await durum();
  ok('5f Kavis iki nesneyi aldı, üçüncü adım yayın geçeceği NOKTAdır: kare kalktı', df.nokta === true && f.on === false, J({ f, df }));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 6 · Nesneye dokunan öteki araçlar ve bölge sürüklemesi
// ---------------------------------------------------------------------------------
{
  for (const [id, ad] of [['t:edittext', 'Yazı düzenle'], ['t:explode', 'Patlat'], ['t:ident', 'Tanı'], ['t:extend', 'Uzat'], ['t:chamfer', 'Pah']]) {
    await arac(id);
    ok(`6a ${ad} (${id}) nesne ister: kare açık, yakalama kapalı`, (await kutu()).on === true && (await yakala(200, 200)) === null);
  }
  await iptal();
  // Bölge sürüklemesi de nesne seçimidir: kutu çizilirken yakalama işareti belirmemeli
  await arac('t:select');
  const s0 = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [130, 620]);   // boş yerden başlar (örtük pencere)
  const s1 = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [640, 260]);   // soldan sağa: PENCERE — 150..550 arasındaki yatay doğruyu tümüyle kapsar
  await ev(([p, q]) => {
    const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
    const mk = (t, c) => new PointerEvent(t, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + c[0], clientY: r.top + c[1], button: 0, buttons: t === 'pointerup' ? 0 : 1 });
    vp.dispatchEvent(mk('pointerdown', p)); vp.dispatchEvent(mk('pointermove', [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])); vp.dispatchEvent(mk('pointermove', q));
  }, [s0, s1]);
  await bekle(150);
  const sd = await ev(() => ({ drag: window.dwgApp.editor.selDragState(), pick: window.dwgApp.editor.pickingObject() }));
  ok('6b bölge sürüklemesi sürerken nesne istemi açık kalır (yakalama işareti çıkmaz)', !!sd.drag && sd.pick === true, J(sd));
  await ev((q) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + q[0], clientY: r.top + q[1], button: 0, buttons: 0 })); }, s1);
  await bekle(250);
  ok('6c sürükleme bitti: pencere seçimi nesneleri aldı, nesne istemi sürüyor', (await durum()).secim > 0 && (await kutu()).on === true, J(await durum()));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 7 · Kare boyu eldivenle ve yazı ölçeğiyle büyür (dokunma alanı gerçekte de büyüdüğü için)
// ---------------------------------------------------------------------------------
{
  await arac('t:select');
  const a = await kutu();
  await ev(async () => { const E = await import('./editor.js'); E.ui.glove = true; E.applyUi({ store: false }); }); await bekle(150);
  const b = await kutu();
  await ev(async () => { const E = await import('./editor.js'); E.ui.glove = false; E.ui.fontScale = 1.4; E.applyUi({ store: false }); }); await bekle(150);
  const c = await kutu();
  await ev(async () => { const E = await import('./editor.js'); E.ui.fontScale = 1; E.applyUi({ store: false }); }); await bekle(150);
  const d = await kutu();
  ok('7a eldivende seçim toleransı 20 px olur, kare de 20 olur', a.r === 12 && b.r === 20 && b.tol === 20, J({ a, b }));
  ok('7b yazı ölçeği 1,4: kare 17 px (12 x 1,4), ölçek geri alınınca 12', c.r === 17 && d.r === 12, J({ c, d }));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 8 · "Artı imleç: Kapalı" ayarı kareyi kapatmaz (AutoCAD'de CURSORSIZE ile PICKBOX ayrıdır)
// ---------------------------------------------------------------------------------
{
  const vpb = await page.locator('#viewport').boundingBox();
  const sx = Math.round(vpb.width * 0.32), sy = Math.round(vpb.height * 0.30);
  await ev(() => window.dwgApp.display.setDisplay('crosshair', 'off')); await bekle(150);
  await arac('t:select');
  const kare = await imlecOku(sx, sy);
  ok('8a artı imleç kapalıyken bile nesne isteminde kare çizilir', kare.kose > 0 && kare.merkez === 0, J(kare));
  await iptal();
  await arac('t:line');
  const arti = await imlecOku(sx, sy);
  ok('8b artı imleç kapalı: nokta isteminde hiçbir şey çizilmez', arti.merkez === 0 && arti.kose === 0, J(arti));
  await ev(() => window.dwgApp.display.setDisplay('crosshair', 'small')); await bekle(150);
  await iptal();
}

// ---------------------------------------------------------------------------------
// 9 · Yakalama işareti nesne istemine sarkmaz (durumda dursa bile çizilmez)
// ---------------------------------------------------------------------------------
{
  // Artı imleç kapatılır ki kaplamada işaretten başka boya kalmasın; ölçüm penceresi (7 px)
  // karenin kenarına (12 px) değmez, yalnız işaretin glifini görür.
  await ev(() => window.dwgApp.display.setDisplay('crosshair', 'off')); await bekle(150);
  await arac('t:line');
  await tapWorld(200, 200);
  const cip = await ev(() => !document.getElementById('stSnap').hidden);
  ok('9a nokta isteminde yakalama çalışır: durum çubuğunda kip çipi belirir', cip === true);
  await bekle(1100);                                          // dokunuşun kendi işareti sönsün (zamanlayıcı çalışsın)
  await iptal();                                              // taslak noktası kalmasın: kaplamada yalnız işaret olacak
  const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [200, 200]);
  const isaretKur = () => ev(([x, y]) => { window.dwgApp.state.snapFlash = { p: [x, y, 0], kind: 'end', until: performance.now() + 60000 }; }, [200, 200]);
  await isaretKur(); await ciz();
  const n1 = await piksel(s[0], s[1], 7);
  ok('9b boşta duran yakalama işareti çizilir (ölçüm yöntemi işareti gerçekten görüyor)', n1 > 0, J({ n1, s }));
  await arac('t:select');
  await isaretKur(); await ciz();
  const n2 = await piksel(s[0], s[1], 7);
  const c2 = await ev(() => ({ flash: !!window.dwgApp.state.snapFlash, pick: window.dwgApp.editor.pickingObject() }));
  ok('9c nesne isteminde aynı işaret ÇİZİLMEZ (durumda duruyor olsa bile)', c2.pick === true && c2.flash === true && n2 === 0, J({ c2, n1, n2 }));
  await ev(() => window.dwgApp.display.setDisplay('crosshair', 'small')); await bekle(150);
  await iptal();
}

// ---------------------------------------------------------------------------------
// 10 · Fare gezinmesi (masaüstü kipi): nesne isteminde kare, yakalama çipi kapalı
// ---------------------------------------------------------------------------------
{
  await arac('t:select');
  const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [200, 200]);
  const vpb = await page.locator('#viewport').boundingBox();
  await page.mouse.move(vpb.x + s[0], vpb.y + s[1]); await bekle(250);
  const h = await ev(() => ({ desk: document.body.classList.contains('has-mouse'), cip: !document.getElementById('stSnap').hidden, hover: !!window.dwgApp.state.pen.hover }));
  if (!h.desk) C.skip('10a fare gezinmesi: masaüstü kipi bu ortamda açılmadı', J(h));
  else {
    ok('10a fare nesne isteminin üstünde: yakalama çipi kapalı kalır', h.cip === false, J(h));
    const n = await piksel(s[0] + 12, s[1] + 12);
    ok('10b imlecin çevresine kare çizilir (köşede boya)', n > 0, J({ n, s }));
  }
  await iptal();
}

await page.screenshot({ path: `${out}/pickbox.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
