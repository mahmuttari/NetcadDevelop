// Ekran / Ölçü kipi (v7.57): değer isteyen düzenleme araçları (ötele, kavis, pah, buda, uzat) nesne
// seçilmeden ÖNCE sorar. Ekran: değer çizimde dokunarak (ötelede geçiş noktası, kavis / pahta yayın
// geçeceği nokta, buda / uzatta kesici / sınır); Ölçü: değer önce yazılır, sonra nesne seçilir.
// Dokunmak Ekran'ı, sayı yazmak Ölçü'yü seçer; boş Enter son değeri alır; kip düğmeleri araç boyunca kalır.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_kip.mjs [çıktı] [örnekler]
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

const tapWorld = async (x, y) => { await page.waitForTimeout(110); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(380); };
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor, ids = es.map((e, i) => 'kip_' + Date.now() + '_' + i); E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: ids[i], layer: '0', color: 256 })) }); window.dwgApp.requestRender(); return ids; }, ents);
const primOf = (id) => ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); return p ? { ops: p.ops.map(o => o.slice()), closed: !!p.closed } : null; }, id);
const sil = (ids) => ev((ks) => { window.dwgApp.editor.doc.run({ op: 'delete', keys: ks }); window.dwgApp.requestRender(); }, ids);
const count = () => ev(() => window.dwgApp.state.prims.length);
const logLen = () => ev(() => window.dwgApp.editor.doc.log.length);
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await page.waitForTimeout(150); };
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
const bar = () => ev(() => ({ text: document.getElementById('cmdText').textContent.trim(), btns: [...document.querySelectorAll('#cmdBtns [data-cmd]')].map(b => [b.dataset.cmd, b.classList.contains('on'), b.textContent.trim()]), inpHidden: document.getElementById('cmdInput').hidden, ph: document.getElementById('cmdInput').placeholder }));
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, mode: T.mode, val: T.val, step: T.step, c1: !!T.c1, corner: !!T.corner, last: { ...T.lastVal } }; });
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await page.waitForTimeout(150); };
const yaz = async (s) => { await ev((x) => window.dwgApp.editor.tools.typed(x), s); await page.waitForTimeout(120); };
const dugme = async (k) => { await page.click(`#cmdBtns [data-cmd="${k}"]`); await page.waitForTimeout(120); };
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { ops: p.ops.map(o => o.slice()), key: p.key }; });
const onDugme = (b, k) => { const x = b.btns.find(q => q[0] === k); return x ? x[1] : null; };

await page.click('#toolbar [data-tab="edit"]');

// ---- 1. Soru: ötele önce Ekran mı Ölçü mü diye sorar --------------------------------------------------
{
  await arac('t:offset');
  const b = await bar(), d = await durum();
  ok('1a ötele başlar başlamaz "Ekran mı, Ölçü mü?" sorar; iki kip düğmesi + Vazgeç; sayı yazılabilir', /Ekran mı, Ölçü mü/.test(b.text) && b.btns.map(q => q[0]).join(',') === 'modescreen,modevalue,cancel' && !b.inpHidden && /sayı/i.test(b.ph), J(b));
  ok('1b düğme adları Ekran / Ölçü, henüz hiçbiri seçili değil; kip yok', b.btns[0][2] === 'Ekran' && b.btns[1][2] === 'Ölçü' && !b.btns[0][1] && !b.btns[1][1] && d.mode === null && d.val === null, J([b.btns, d]));
}

// ---- 2. Ötele, Ölçü: değer → nesne → taraf; araç aynı değerle sürer ------------------------------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] }]);
  await zoom([0, 0, 1000, 600]);
  const n0 = await count(), l0 = await logLen();
  await dugme('modevalue');
  const b1 = await bar();
  ok('2a Ölçü düğmesi: mesafe istenir, Ölçü düğmesi vurgulu (.on)', /Mesafeyi yazın/.test(b1.text) && onDugme(b1, 'modevalue') === true && !onDugme(b1, 'modescreen'), J(b1));
  await yaz('50');
  const b2 = await bar(), d2 = await durum();
  ok('2b değer 50 alındı, istem "Nesneye dokunun" (Ölçü adımı)', d2.mode === 'value' && d2.val === 50 && /Nesneye dokunun/.test(b2.text) && d2.step === 0, J([b2.text, d2]));
  await tapWorld(500, 300);
  const b3 = await bar(), d3 = await durum();
  ok('2c nesneye dokunuldu: istem "Tarafı seçin", nokta beklenir', /Tarafı seçin/.test(b3.text) && d3.step === 1 && d3.c1, J([b3.text, d3]));
  await tapWorld(500, 420);
  const p = await sonPrim(), d4 = await durum(), b4 = await bar();
  ok('2d taraf noktası: kopya 50 üstte (y = 350), ilkel +1, günlük +1', (await count()) === n0 + 1 && (await logLen()) === l0 + 1 && yak(p.ops[0][2], 350, 1e-3) && yak(p.ops[1][2], 350, 1e-3), J(p.ops));
  ok('2e araç sürer: yine "Nesneye dokunun", değer korunur, son değer 50 hatırlanır', /Nesneye dokunun/.test(b4.text) && d4.mode === 'value' && d4.val === 50 && d4.step === 0 && d4.last.offset === 50, J([b4.text, d4]));
  await tapWorld(500, 300); await tapWorld(500, 200);
  const p2 = await sonPrim();
  ok('2f ikinci ötele aynı değerle alta (y = 250)', (await count()) === n0 + 2 && yak(p2.ops[0][2], 250, 1e-3), J(p2.ops));
  await dugme('cancel');
  await sil(ids); await sil([p.key, p2.key]);
}

// ---- 3. Ötele, Ekran: dokunmak Ekran'ı seçer; geçiş noktası -----------------------------------------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] }]);
  await zoom([0, 0, 1000, 600]);
  await arac('t:offset');
  await tapWorld(500, 300);
  const b1 = await bar(), d1 = await durum();
  ok('3a soru açıkken nesneye dokunmak Ekran kipini seçer: Ekran düğmesi vurgulu, istem "Geçiş noktasına dokunun"', d1.mode === 'screen' && onDugme(b1, 'modescreen') === true && /Geçiş noktasına/.test(b1.text) && d1.step === 1, J([b1, d1]));
  await tapWorld(500, 380);
  const p = await sonPrim(), d2 = await durum();
  ok('3b kopya geçiş noktasından geçer (y ≈ 380), mesafe hatırlanır (≈ 80)', yak(p.ops[0][2], 380, 1.5) && yak(p.ops[1][2], 380, 1.5) && yak(d2.last.offset, 80, 1.5), J([p.ops, d2.last]));
  ok('3c Ekran kipinde de araç sürer (step 0, nesne bekler)', d2.step === 0 && d2.mode === 'screen' && !d2.c1, J(d2));
  // geçiş noktası koordinat olarak da yazılabilir (giriş alanı koordinat yer tutucusuyla açık)
  await tapWorld(500, 300);
  const b3 = await bar();
  ok('3d geçiş noktası adımında giriş alanı koordinat kabul eder (yer tutucu x,y)', !b3.inpHidden && /x,y/.test(b3.ph), J(b3));
  await yaz('500,360');
  const p3 = await sonPrim();
  ok('3e yazılan "500,360" geçiş noktası sayılır: kopya y = 360', yak(p3.ops[0][2], 360, 1e-6), J(p3.ops));
  // geçiş noktası beklenirken yazılan tek sayı mesafeyi verir, seçili nesne bırakılmaz; sonraki dokunuş taraf
  await tapWorld(500, 300);
  await yaz('30');
  const d3 = await durum(), b4 = await bar();
  ok('3f nokta beklenirken yazılan sayı Ölçü kipine geçirir (30), nesne korunur, taraf istenir', d3.mode === 'value' && d3.val === 30 && d3.c1 && d3.step === 1 && /Tarafı seçin/.test(b4.text), J([d3, b4.text]));
  await tapWorld(500, 200);
  const p4 = await sonPrim();
  ok('3g taraf dokunuşu: kopya 30 altta (y = 270)', yak(p4.ops[0][2], 270, 1e-3), J(p4.ops));
  await dugme('cancel');
  await sil(ids); await sil([p.key, p3.key, p4.key]);
}

// ---- 4. Sayı yazmak Ölçü'yü seçer; boş Enter son değeri alır; kip değişince adım sıfırlanır ----------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] }]);
  await zoom([0, 0, 1000, 600]);
  await arac('t:offset');
  const b0 = await bar();
  ok('4a istemde son değer ipucu <30> (bir önceki ötelemeden)', /<30/.test(b0.text), b0.text);
  await yaz('25');
  const d1 = await durum(), b1 = await bar();
  ok('4b soru açıkken sayı yazmak Ölçü kipini seçer ve değeri alır (25)', d1.mode === 'value' && d1.val === 25 && onDugme(b1, 'modevalue') === true && /Nesneye dokunun/.test(b1.text), J([d1, b1.text]));
  await tapWorld(500, 300);
  await dugme('modescreen');
  const d2 = await durum(), b2 = await bar();
  ok('4c ortada kip değişince nesne seçimine dönülür (step 0, nesne bırakılır)', d2.mode === 'screen' && d2.step === 0 && !d2.c1 && /Nesneye dokunun/.test(b2.text), J([d2, b2.text]));
  await dugme('modevalue');
  const b3 = await bar();
  ok('4d Ölçü seçilince değer yeniden istenir, ipucu <25>', /Mesafeyi yazın/.test(b3.text) && /<25/.test(b3.text), b3.text);
  await ev(() => { const inp = document.getElementById('cmdInput'); inp.value = ''; document.getElementById('cmdEnter').click(); });
  await page.waitForTimeout(120);
  const d4 = await durum();
  ok('4e boş Enter son değeri (25) alır — AutoCAD <öntanımlı>', d4.mode === 'value' && d4.val === 25, J(d4));
  await yaz('40');
  const d5 = await durum();
  ok('4f değer alındıktan sonra yazılan tek sayı değeri değiştirir (25 → 40)', d5.mode === 'value' && d5.val === 40 && d5.last.offset === 40, J(d5));
  await dugme('modevalue');
  await yaz('0');
  ok('4g değer isteminde sıfır reddedilir', /Sayı bekleniyor/.test(await toast()), await toast());
  await yaz('abc');
  ok('4h değer isteminde sayı dışı giriş reddedilir', /Sayı bekleniyor/.test(await toast()) && (await durum()).val === null, await toast());
  await dugme('cancel');
  await sil(ids);
}

// ---- 5. Kavis, Ekran: yay dokunulan noktadan geçer; yazılan sayı da olur --------------------------------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[200, 200, 0], [600, 200, 0]] }, { type: 'LINE', pts: [[700, 300, 0], [700, 600, 0]] }]);
  await zoom([100, 100, 800, 700]);
  const n0 = await count(), l0 = await logLen();
  await arac('t:fillet');
  ok('5a kavis de önce sorar', /Ekran mı, Ölçü mü/.test((await bar()).text), (await bar()).text);
  await tapWorld(400, 200); await tapWorld(700, 500);
  const b1 = await bar(), d1 = await durum();
  ok('5b iki doğrudan sonra Ekran kipi: "Kavisin geçeceği noktaya dokunun", köşe hazır, sayı da yazılabilir', d1.mode === 'screen' && d1.step === 2 && d1.corner && /Kavisin geçeceği/.test(b1.text) && !b1.inpHidden, J([b1, d1]));
  // köşe c = (700,200), kollar (−1,0) ve (0,1): φ = 45°. r = 80 için yayın ortası köşeden 80·(√2−1) = 33,137 uzakta,
  // açıortay (−1,1)/√2 üzerinde → nokta (676,569 ; 223,431). Dokunuş yerine tam nokta verilir (piksel yuvarlaması olmasın).
  const d = 80 * (Math.SQRT2 - 1);
  await ev((pt) => window.dwgApp.editor.tools.cornerPoint(pt), [700 - d / Math.SQRT2, 200 + d / Math.SQRT2, 0]);
  await page.waitForTimeout(200);
  const yay = await ev(() => { const p = window.dwgApp.state.prims.slice(-1)[0]; const o = p && p.ops.find(q => q[0] === 2 || q[0] === -2); return o ? o.slice() : null; });
  const d2 = await durum();
  ok('5c yay yarıçapı 80 (nokta → açıortay izdüşümü → r), ilkel +1, tek adım', !!yay && yak(yay[3], 80, 1e-6) && (await count()) === n0 + 1 && (await logLen()) === l0 + 1, J([yay, await count(), n0]));
  ok('5d kavis sonrası araç sürer (step 0), son yarıçap 80 hatırlanır', d2.step === 0 && d2.mode === 'screen' && yak(d2.last.fillet, 80, 1e-6), J(d2));
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(120);
  // dokunuşla da (piksel toleransı): aynı nokta ekrandan
  await tapWorld(400, 200); await tapWorld(700, 500);
  await tapWorld(700 - d / Math.SQRT2, 200 + d / Math.SQRT2);
  const yay2 = await ev(() => { const p = window.dwgApp.state.prims.slice(-1)[0]; const o = p && p.ops.find(q => q[0] === 2 || q[0] === -2); return o ? o.slice() : null; });
  ok('5e ekrandan dokunuşla yarıçap ≈ 80 (piksel yuvarlaması payı)', !!yay2 && yak(yay2[3], 80, 8), J(yay2));
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(120);
  await tapWorld(400, 200); await tapWorld(700, 500);
  await yaz('60');
  const yay3 = await ev(() => { const p = window.dwgApp.state.prims.slice(-1)[0]; const o = p && p.ops.find(q => q[0] === 2 || q[0] === -2); return o ? o.slice() : null; });
  ok('5f Ekran kipinin üçüncü adımında yazılan sayı doğrudan yarıçaptır (60)', !!yay3 && yak(yay3[3], 60, 1e-6), J(yay3));
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(120);
  await tapWorld(400, 200); await tapWorld(700, 500);
  const l1 = await logLen();
  await ev(() => window.dwgApp.editor.tools.cornerPoint([760, 140, 0]));
  await page.waitForTimeout(150);
  ok('5g köşenin gerisine dokunulursa kavis kurulmaz, neden söylenir', (await logLen()) === l1 && /gerisine/.test(await toast()), await toast());
  await dugme('cancel');
  await sil(ids);
}

// ---- 6. Kavis / pah, Ölçü: değer önce, iki dokunuş, kutu açılmaz ----------------------------------------------
{
  const ids = await ekle([{ type: 'LWPOLYLINE', pts: [[200, 200, 0], [700, 200, 0], [700, 600, 0]], closed: false }]);
  await zoom([100, 100, 800, 700]);
  await arac('t:chamfer');
  await dugme('modevalue');
  ok('6a pah Ölçü: mesafe istemi', /Pah mesafesi/.test((await bar()).text), (await bar()).text);
  await yaz('100');
  const b1 = await bar();
  ok('6b değerden sonra "Birinci doğruya dokunun" (Ölçü adımı)', /Birinci doğruya/.test(b1.text) && onDugme(b1, 'modevalue') === true, J(b1));
  await tapWorld(400, 200); await tapWorld(700, 400);
  const p = await primOf(ids[0]);
  const kenar = p && p.ops.length === 4 ? Math.hypot(p.ops[2][1] - p.ops[1][1], p.ops[2][2] - p.ops[1][2]) : -1;
  ok('6c pah kuruldu: kenar 100√2, iletişim kutusu açılmadı', yak(kenar, 100 * Math.SQRT2, 1e-6), String(kenar));
  const d = await durum();
  ok('6d Ölçü kipinde araç sürer, değer 100 korunur', d.mode === 'value' && d.val === 100 && d.step === 0, J(d));
  await dugme('cancel');
  await sil(ids);
}

// ---- 7. Pah, Ekran: noktadan mesafe ----------------------------------------------------------------------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[200, 200, 0], [600, 200, 0]] }, { type: 'LINE', pts: [[700, 300, 0], [700, 600, 0]] }]);
  await zoom([100, 100, 800, 700]);
  await arac('t:chamfer');
  await tapWorld(400, 200); await tapWorld(700, 500);
  ok('7a pah Ekran: "Pahın geçeceği noktaya dokunun"', /Pahın geçeceği/.test((await bar()).text), (await bar()).text);
  // eşit mesafeli pah kenarının ortası köşeden x·cos φ uzakta: x = 50 → 35,355; açıortay (−1,1)/√2 → (675 ; 225)
  await ev(() => window.dwgApp.editor.tools.cornerPoint([675, 225, 0]));
  await page.waitForTimeout(200);
  const kenar = await ev(() => { const p = window.dwgApp.state.prims.slice(-1)[0]; const o = p.ops; return o.length === 2 ? Math.hypot(o[1][1] - o[0][1], o[1][2] - o[0][2]) : -1; });
  ok('7b pah kenarı 50√2 (mesafe 50)', yak(kenar, 50 * Math.SQRT2, 1e-6), String(kenar));
  await dugme('cancel');
  await sil(ids);
}

// ---- 8. Buda, Ölçü: yazılan boy kadar kısalt (LENGTHEN DElta) ------------------------------------------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] }, { type: 'LWPOLYLINE', pts: [[100, 100, 0], [200, 100, 0], [200, 200, 0]], closed: false }, { type: 'LWPOLYLINE', pts: [[400, 100, 0], [500, 100, 0], [500, 200, 0], [400, 200, 0]], closed: true }]);
  await zoom([0, 0, 1000, 600]);
  await arac('t:trim');
  await dugme('modevalue');
  ok('8a buda Ölçü: "Kısaltma boyunu yazın"', /Kısaltma boyunu/.test((await bar()).text), (await bar()).text);
  await yaz('150');
  ok('8b değerden sonra "Kısaltılacak uca dokunun"', /Kısaltılacak uca/.test((await bar()).text), (await bar()).text);
  const l0 = await logLen();
  await tapWorld(850, 300);
  const p = await primOf(ids[0]);
  ok('8c sağ uca yakın dokunuş: doğru 150 kısaldı ([100,300]–[750,300]), tek reshape', p && yak(p.ops[1][1], 750, 1e-6) && yak(p.ops[0][1], 100) && (await logLen()) === l0 + 1, J(p && p.ops));
  await tapWorld(150, 300);
  const p2 = await primOf(ids[0]);
  ok('8d araç sürer; sol uca dokunuş baş ucu kısaltır ([250,300]–[750,300])', p2 && yak(p2.ops[0][1], 250, 1e-6) && yak(p2.ops[1][1], 750, 1e-6), J(p2 && p2.ops));
  await tapWorld(200, 190);
  const p3 = await primOf(ids[1]);
  ok('8e polyline: 150 birim son 100\'lük segmenti yutar, öncekinden 50 keser → [100,100]–[150,100]', p3 && p3.ops.length === 2 && yak(p3.ops[1][1], 150, 1e-6) && yak(p3.ops[1][2], 100, 1e-6), J(p3 && p3.ops));
  const l1 = await logLen();
  await tapWorld(500, 150);
  ok('8f kapalı yol boyla kısaltılamaz: belge değişmez, neden söylenir', (await logLen()) === l1 && /Kapalı yol/.test(await toast()), await toast());
  await yaz('5000');
  ok('8g Ölçü kipinde yeni sayı değeri değiştirir (5000)', (await durum()).val === 5000, J(await durum()));
  await tapWorld(700, 300);
  ok('8h yoldan uzun kısaltma reddedilir', (await logLen()) === l1 && /kısaltılamaz/.test(await toast()), await toast());
  await dugme('cancel');
  await sil(ids);
}

// ---- 9. Uzat, Ölçü: yazılan boy kadar uzat; Ekran kipi eski akış ------------------------------------------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] }, { type: 'LINE', pts: [[500, 100, 0], [500, 500, 0]] }, { type: 'LINE', pts: [[100, 450, 0], [300, 450, 0]] }]);
  await zoom([0, 0, 1000, 600]);
  await arac('t:extend');
  await yaz('200');
  const b1 = await bar();
  ok('9a uzat: sayı yazmak Ölçü seçer, istem "Uzatılacak uca dokunun"', /Uzatılacak uca/.test(b1.text) && onDugme(b1, 'modevalue') === true, J(b1));
  await tapWorld(850, 300);
  const p = await primOf(ids[0]);
  ok('9b sağ uç 200 uzadı ([100,300]–[1100,300])', p && yak(p.ops[1][1], 1100, 1e-6) && yak(p.ops[1][2], 300, 1e-6), J(p && p.ops));
  await dugme('modescreen');
  const b2 = await bar();
  ok('9c Ekran kipine geçince eski akış: "Sınıra dokunun"', /Sınıra dokunun/.test(b2.text) && onDugme(b2, 'modescreen') === true, J(b2));
  await tapWorld(500, 150); await tapWorld(280, 450);
  const p2 = await primOf(ids[2]);
  ok('9d Ekran: sınır + uç → kısa doğrunun sağ ucu sınıra (x = 500) uzar', p2 && yak(p2.ops[1][1], 500, 1e-6) && yak(p2.ops[1][2], 450, 1e-6), J(p2 && p2.ops));
  await dugme('cancel');
  await sil(ids);
}

// ---- 10. Buda, Ekran: eski akış değişmedi --------------------------------------------------------------------------
{
  const ids = await ekle([{ type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] }, { type: 'LINE', pts: [[500, 100, 0], [500, 500, 0]] }]);
  await zoom([0, 0, 1000, 600]);
  await arac('t:trim');
  await tapWorld(500, 400); await tapWorld(800, 300);
  const p = await primOf(ids[0]), b = await bar();
  ok('10a buda Ekran: kesici + parça → [100,300]–[500,300]; istem ikinci adımda kalır', p && yak(p.ops[1][1], 500) && /Atılacak/.test(b.text) && onDugme(b, 'modescreen') === true, J([p && p.ops, b.text]));
  // Bitir / tuval Enter'ı kesiciyi silmez, akışı bozmaz; Ekran kipinde yazılan sayı Ölçü'ye geçirir
  await ev(() => window.dwgApp.editor.tools.finish()); await page.waitForTimeout(100);
  const d1 = await durum(), b1 = await bar();
  ok('10b Bitir / Enter kesiciyi korur (istem ikinci adımda kalır)', d1.mode === 'screen' && d1.step === 1 && /Atılacak/.test(b1.text), J([d1, b1.text]));
  await yaz('40');
  const d2 = await durum();
  ok('10c Ekran kipinde yazılan tek sayı Ölçü kipine geçirir (40), kesici bırakılır', d2.mode === 'value' && d2.val === 40 && d2.step === 0, J(d2));
  await dugme('cancel');
  await sil(ids);
}

// ---- 10b. Karo ipuçları yeni akışı söyler; dosya değişince son değerler sıfırlanır --------------------------
{
  const ipucu = await ev(async () => { const I = await import('./i18n.js'); return ['t:offset', 't:trim', 't:extend', 't:fillet', 't:chamfer'].map(a => I.t('th_' + a)); });
  ok('10d beş karonun ipucu (uzun basış) Ekran / Ölçü sorusunu söyler', ipucu.every(s => /Ekran mı Ölçü mü/.test(s || '')), J(ipucu));
  const once = await ev(() => ({ ...window.dwgApp.editor.tools.lastVal }));
  await openFile(page, `${SM}/test_tr.dxf`, { settle: 300 });
  const sonra = await ev(() => ({ ...window.dwgApp.editor.tools.lastVal }));
  ok('10e yeni dosya açılınca son değerler sıfırlanır (birim değişebilir)', Object.keys(once).length > 0 && Object.keys(sonra).length === 0, J([once, sonra]));
  await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
  await ev(() => { document.getElementById('toast').hidden = true; window.dwgApp.osnap.setModes([]); });
  await page.click('#toolbar [data-tab="edit"]');
}

// ---- 11. İngilizce etiketler ve komut tablosu notları ---------------------------------------------------------------
{
  const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dwgApp.editor.tools.say(); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);
  await arac('t:offset');
  await dil('en'); await page.waitForTimeout(150);
  const b = await bar();
  ok('11a İngilizce: "Screen or Measure?", düğmeler Screen / Measure', /Screen or Measure/.test(b.text) && b.btns[0][2] === 'Screen' && b.btns[1][2] === 'Measure', J(b));
  await dil('tr'); await page.waitForTimeout(150);
  await dugme('cancel');
  const a = await ev(async () => { const A = await import('./acad.js'); return { o: A.resolve('O').note, tr: A.resolve('TR').note, ex: A.resolve('EX').note, f: A.resolve('F').note, cha: A.resolve('CHA').note, len: A.resolve('LEN').note, st: A.stats() }; });
  ok('11b komut tablosu: beş komutun notu Ekran / Ölçü sorusunu söyler, LENGTHEN notu Ölçü kipine yönlendirir; sayılar değişmedi', [a.o, a.tr, a.ex, a.f, a.cha].every(n => /Screen or Measure/.test(n || '')) && /Measure mode/.test(a.len || '') && a.st.total === 508 && a.st.acad === 222 && a.st.names === 755, J(a));
}

await page.screenshot({ path: `${out}/kip.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
