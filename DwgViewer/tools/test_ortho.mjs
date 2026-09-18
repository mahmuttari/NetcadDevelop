// ORTHO KOMUTLA BİRLİKTE (v7.61). Telefonda F8 yok; nokta istenen her adımda komut çubuğunun koordinat giriş
// satırında Ortho düğmesi durur. Durum tektir (S.desk.ortho): düğme, Ekran sekmesindeki karo, F8 ve kutupsal
// aynı değeri okur / yazar. Dokunuşla alınan nokta kısıtlanır; kalem gezinmesi ve parmakla nişan alma önizlemesi
// de kısıtlı noktayı gösterir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_ortho.mjs [çıktı] [örnekler]
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
const tapWorld = async (x, y) => { await bekle(110); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(380); };
const dugme = () => ev(() => { const b = document.getElementById('cmdOrtho'); return b ? { hidden: b.hidden, on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), title: b.title, aria: b.getAttribute('aria-label'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) } : null; });
const desk = () => ev(() => ({ ortho: window.dwgApp.state.desk.ortho, polar: window.dwgApp.state.desk.polar }));
const karo = () => ev(() => { const el = document.querySelector('#toolbar [data-act="ortho"]'); return el ? el.classList.contains('on') : null; });
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, selecting: T.selecting, pts: T.pts.map(p => p.slice(0, 2)), inp: document.getElementById('cmdInput').hidden, text: document.getElementById('cmdText').textContent.trim() }; });
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, ops: p.ops.map(o => o.slice()) }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const kalem = (type, x, y) => ev(([t, x, y]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: -1, buttons: 0, pressure: 0 })); }, [type, x, y]);
const dokun = (type, x, y) => ev(([t, x, y]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerup' || t === 'pointercancel' ? 0 : 1 })); }, [type, x, y]);
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);

await page.click('#toolbar [data-tab="draw"]');
await zoom([0, 0, 800, 600]);

// ---------------------------------------------------------------------------------
// 1 · Düğme yalnız NOKTA istenirken görünür
// ---------------------------------------------------------------------------------
{
  const b0 = await dugme();
  ok('1a boşta (komut istemi) Ortho düğmesi gizli', b0 && b0.hidden === true, J(b0));
  await arac('t:line');
  const b1 = await dugme(), d1 = await durum();
  // 40 x 32 (v7.66): istem satırında İz noktası (TT) düğmesi de durur; iki düğme 40 px olunca "Çizgi: İkinci noktayı seçin (devam eder)" (289 px) 412 px telefonda tek satırda kalır
  ok('1b Çizgi aracı nokta ister: düğme görünür, KAPALI, istem satırının sağında (30 x 24 — yoğun kip, v7.82), başlık / aria "Ortho (F8)"', b1.hidden === false && b1.on === false && b1.pressed === 'false' && b1.title === 'Ortho (F8)' && b1.aria === 'Ortho (F8)' && b1.w === 30 && b1.h === 24 && d1.inp === false, J({ b1, d1 }));
  // v7.61 gerilemesi: giriş satırına konan düğme Enter'ı Bitir'in altına sokuyor, Bitir · Geri · İptal'i üçüncü satıra taşırıyordu.
  // Şimdi düğme istem satırındadır: Enter hiçbir düğmeyle çakışmaz; Bitir · Geri · İptal ile bile çubuk iki satırda kalır (< 100 px)
  const yer = await ev(() => { const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }; const en = r(document.getElementById('cmdEnter')), o = r(document.getElementById('cmdOrtho')), tx = r(document.getElementById('cmdText')); const kesisen = [...document.querySelectorAll('#cmdBtns button')].map(r).filter(q => q[0] < en[2] && q[2] > en[0] && q[1] < en[3] && q[3] > en[1]); return { kesisen: kesisen.length, ortoSagda: o[0] >= tx[2] - 1 && Math.abs((o[1] + o[3]) / 2 - (tx[1] + tx[3]) / 2) < 12, h: document.getElementById('cmdBar').getBoundingClientRect().height }; });
  ok('1b2 Enter hiçbir komut düğmesiyle çakışmaz; Ortho istem metninin sağında, aynı satırda', yer.kesisen === 0 && yer.ortoSagda, J(yer));
  await tapWorld(300, 300);                                    // birinci nokta → Bitir · Geri · İptal
  const h3 = await ev(() => ({ h: document.getElementById('cmdBar').getBoundingClientRect().height, btns: [...document.querySelectorAll('#cmdBtns [data-cmd]')].map(b => b.dataset.cmd) }));
  ok('1b3 Bitir · Geri · İptal ile çubuk iki satırda kalır (< 100 px): Ortho tuvalden satır yemez', h3.btns.join(',') === 'finish,back,cancel' && h3.h < 100, J(h3));
  await ev(() => window.dwgApp.editor.tools.back()); await bekle(120);
  await arac('t:select');
  ok('1c Seç aracı (giriş yok): düğme gizli', (await dugme()).hidden === true);
  await arac('t:offset');
  ok('1d Ötele sorusu (sayı istemi): düğme gizli', (await dugme()).hidden === true && (await durum()).inp === false, J(await durum()));
  await arac('t:move');
  ok('1e Taşı seçim aşaması: gizli', (await dugme()).hidden === true);
  await iptal();
}

// ---------------------------------------------------------------------------------
// 2 · Düğme durumu değiştirir; dokunuşla alınan nokta eksene kilitlenir; araçlar arasında kalıcı
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await page.click('#cmdOrtho'); await bekle(200);
  const b = await dugme(), d = await desk(), tst = await toast();
  ok('2a düğmeye dokunuldu: ortho AÇIK, düğme vurgulu (aria-pressed true), bildirim, kutupsal kapalı', d.ortho === true && d.polar === false && b.on === true && b.pressed === 'true' && /Ortho/i.test(tst), J({ b, d, tst }));
  await page.screenshot({ path: `${out}/ortho_dugme.png` });
  ok('2b düğme odak almaz (klavye açılmasın)', (await ev(() => document.activeElement && document.activeElement.id)) !== 'cmdInput');
  const k = await karo();
  ok('2c Ekran sekmesindeki Ortho karosu da açık görünür (tek durum)', k === true || k === null, String(k));
  const n0 = await count();
  await tapWorld(200, 200);
  await tapWorld(600, 260);                                    // dx 400 > dy 60 → yatay: y kilitlenir
  const p1 = await sonPrim();
  // dokunulan nokta ekran pikseline yuvarlanır (~1,8 birim / px): kilit tam eksendedir (y'ler birebir eşit), koordinat 1e-5 sapar → pay 1e-3
  ok('2d ikinci dokunuş (600,260) yatay eksene kilitlendi: doğru (200,200)-(600,200), y birebir eşit', (await count()) === n0 + 1 && yak(p1.ops[0][1], 200, 1e-3) && yak(p1.ops[0][2], 200, 1e-3) && yak(p1.ops[1][1], 600, 1e-3) && p1.ops[1][2] === p1.ops[0][2], J(p1.ops));
  await tapWorld(640, 500);                                    // dy 300 > dx 40 → düşey: x kilitlenir (zincir çizgi 600,200 → 600,500)
  const p2 = await sonPrim();
  ok('2e üçüncü dokunuş (640,500) düşey eksene kilitlendi: (600,200)-(600,500), x birebir eşit', (await count()) === n0 + 2 && yak(p2.ops[0][1], 600, 1e-3) && yak(p2.ops[0][2], 200, 1e-3) && yak(p2.ops[1][2], 500, 1e-3) && p2.ops[1][1] === p2.ops[0][1], J(p2.ops));
  await iptal();
  await arac('t:move');
  ok('2f başka araç, seçim aşaması: düğme gizli ama durum açık kalır', (await dugme()).hidden === true && (await desk()).ortho === true);
  await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); E.sel.add(window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]); E.tools.finish(); }); await bekle(150);
  const b2 = await dugme();
  ok('2g Taşı taban noktası istemi: düğme yeniden görünür ve AÇIK', b2.hidden === false && b2.on === true, J(b2));
  await iptal();
  await ev(() => { const E = window.dwgApp.editor; E.doc.undo(); E.doc.undo(); window.dwgApp.requestRender(); });
}

// ---------------------------------------------------------------------------------
// 3 · Karo / komut ve kutupsal ile eşitlik (tek durum)
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await ev(() => window.dwgApp.editor.act('ortho')); await bekle(150);
  ok('3a karo eylemiyle kapatıldı: düğme kapalı', (await desk()).ortho === false && (await dugme()).on === false);
  await ev(() => window.dwgApp.editor.act('ortho')); await bekle(150);
  ok('3b karo eylemiyle açıldı: düğme açık', (await desk()).ortho === true && (await dugme()).on === true);
  await ev(() => window.dwgApp.editor.act('polar')); await bekle(150);
  const d = await desk(), b = await dugme();
  ok('3c kutupsal açılınca ortho kapanır (AutoCAD: ikisi birlikte olmaz), düğme kapalı', d.polar === true && d.ortho === false && b.on === false, J({ d, b }));
  await page.click('#cmdOrtho'); await bekle(150);
  const d2 = await desk();
  ok('3d düğme ortho\'yu açar, kutupsal kapanır', d2.ortho === true && d2.polar === false, J(d2));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 4 · Önizleme: kalem gezinmesi ve parmakla nişan alma kısıtlı noktayı gösterir
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await tapWorld(200, 200);
  const s = await scr(600, 260);
  await kalem('pointermove', s[0], s[1]); await bekle(220);
  const h = await ev(() => ({ pen: window.dwgApp.state.pen.hover, hover: window.dwgApp.__pickbox().hover }));
  ok('4a kalem (600,260) üstünde: önizleme noktası yatay kilitle (600,200)', !!h.hover && Array.isArray(h.pen) && yak(h.pen[0], 600, 1e-3) && yak(h.pen[1], 200, 1e-3), J(h));
  await kalem('pointerout', s[0], s[1]); await bekle(900);      // avuç reddi sağır süresi (700 ms) geçsin
  const s2 = await scr(320, 520);                            // taban (200,200): dx 120 < dy 320 → düşey kilit → (200,520)
  await dokun('pointerdown', s2[0] - 60, s2[1] + 40); await bekle(720);
  await dokun('pointermove', s2[0] - 30, s2[1] + 20); await dokun('pointermove', s2[0], s2[1]); await bekle(200);
  const h2 = await ev(() => ({ pen: window.dwgApp.state.pen.hover, hover: window.dwgApp.__pickbox().hover, loupe: window.dwgApp.__pickbox().loupe }));
  ok('4b parmakla nişan (320,520): önizleme düşey kilitle (200,520) — taban (200,200)', !!h2.hover && h2.hover.aim && !!h2.loupe && Array.isArray(h2.pen) && yak(h2.pen[0], 200, 1e-3) && yak(h2.pen[1], 520, 1e-3), J(h2));
  const n0 = await count();
  await dokun('pointerup', s2[0], s2[1]); await bekle(300);
  const p = await sonPrim();
  ok('4c bırakınca doğru önizlemedeki noktaya çizilir: (200,200)-(200,520), x birebir eşit', (await count()) === n0 + 1 && p.ops[1][1] === p.ops[0][1] && yak(p.ops[1][2], 520, 1e-3), J(p.ops));
  await iptal();
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); });
  await ev(() => window.dwgApp.editor.act('ortho')); await bekle(120);   // kapat
  ok('4d ortho kapalıyken önizleme kısıtsız', (await desk()).ortho === false);
}

// ---------------------------------------------------------------------------------
// 5 · Komut tablosu ve dil
// ---------------------------------------------------------------------------------
{
  const a = await ev(async () => { const A = await import('./acad.js'); return { note: A.resolve('ORTHO').note, st: A.stats() }; });
  ok('5a ORTHO notu komut çubuğundaki düğmeyi söyler; sayılar sabit', /command bar/.test(a.note || '') && /F8/.test(a.note || '') && a.st.total === 506 && a.st.names === 751, J(a));
  await ev(async (x) => { const I = await import('./i18n.js'); I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; }, 'de');
  await arac('t:line');
  const b = await dugme();
  ok('5b Almanca: düğme başlığı karo adından gelir — "ORTHO (F8)" (dil dosyalarında AutoCAD komut adı)', /^ortho \(F8\)$/i.test(b.title) && b.hidden === false, J(b));
  await iptal();
  await ev(async (x) => { const I = await import('./i18n.js'); I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; }, 'tr');
}

await page.screenshot({ path: `${out}/ortho.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
