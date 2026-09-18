// AYNALA — "Orijinal kalsın" düğmesi (v7.59) ve X / Y eksen düğmeleri (v7.60: ayna çizgisi yatay / düşey, tek noktayla). AutoCAD MIRROR'ın sondaki "Erase source objects? <N>" sorusu
// seçimden sonra komut çubuğunda bir düğmedir: açıkken (varsayılan) aynalanmış kopya eklenir ve kaynak durur,
// kapalıyken kaynak taşınır. Soru kutusu kalktı; düğme her başlangıçta açığa döner, Geri durumu korur.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_aynala.mjs [çıktı] [örnekler]
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
let tarayiciKutusu = 0;
onDialog(page, async d => { tarayiciKutusu++; await d.dismiss(); });
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
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor; E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: 'ay_' + i, layer: '0', color: 256 })) }); window.dwgApp.requestRender(); }, ents);
const primOf = (id) => ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); return p ? { ops: p.ops.map(o => o.slice()), bb: p.bb.slice() } : null; }, id);
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, bb: p.bb.slice() }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
const bar = () => ev(() => ({ text: document.getElementById('cmdText').textContent.trim(), btns: [...document.querySelectorAll('#cmdBtns [data-cmd]')].map(b => [b.dataset.cmd, b.classList.contains('on'), b.textContent.trim(), !!b.querySelector('svg use[href="#i-copyobj"]'), Math.round(b.getBoundingClientRect().height)]), h: document.getElementById('cmdBar').getBoundingClientRect().height }));
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, selecting: T.selecting, step: T.step, keep: T.mirrorKeep, axis: T.mirrorAxis, sel: window.dwgApp.editor.sel.size, pts: T.pts.length }; });
const kutuAcik = () => ev(async () => { const D = await import('./dialog.js'); return D.isOpen(); });
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(150); };
const dugme = async (k) => { await page.click(`#cmdBtns [data-cmd="${k}"]`); await bekle(150); };
const dugmeVar = (b, k) => b.btns.find(q => q[0] === k) || null;
const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dwgApp.editor.tools.say(); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);

await page.click('#toolbar [data-tab="edit"]');
await ekle([{ type: 'LINE', pts: [[200, 200, 0], [400, 200, 0]] }]);      // ay_0: yatay doğru y = 200
await zoom([0, 0, 800, 600]);

// ---------------------------------------------------------------------------------
// 1 · Seçim aşamasında düğme yok; seçimden sonra "Orijinal kalsın" AÇIK gelir
// ---------------------------------------------------------------------------------
{
  await arac('t:mirror');
  const d0 = await durum(), b0 = await bar();
  ok('1a Aynala seçimle başlar, orijinal kalsın varsayılan AÇIK; seçim aşamasında düğme yok (Bitir · kutu · çokgen · Tümü · İptal)', d0.selecting === true && d0.keep === true && !dugmeVar(b0, 'mirrorkeep') && ['finish', 'selbox', 'sellasso', 'selall', 'cancel'].every(k => dugmeVar(b0, k)), J({ d0, btns: b0.btns.map(q => q[0]) }));
  await tapWorld(300, 200);
  await dugme('finish');
  const d1 = await durum(), b1 = await bar(), mk = dugmeVar(b1, 'mirrorkeep');
  ok('1b Bitir: ayna çizgisinin 1. noktası istenir; "Orijinal kalsın" düğmesi görünür, AÇIK (vurgulu), kopya simgeli; İptal sonda', d1.selecting === false && d1.step === 1 && d1.sel === 1 && /Ayna çizgisi 1\. nokta/.test(b1.text) && !!mk && mk[1] === true && mk[2] === 'Orijinal kalsın' && mk[3] === true && b1.btns[b1.btns.length - 1][0] === 'cancel', J({ d1, text: b1.text, btns: b1.btns }));
  ok('1c komut çubuğu en çok üç satır (< 150 px): istem + giriş · Enter + [X · Y · Orijinal kalsın · İptal]; etiket tek satır', b1.h < 150 && mk[4] === dugmeVar(b1, 'cancel')[4], J({ h: b1.h, btns: b1.btns.map(q => [q[0], q[4]]) }));
  await page.screenshot({ path: `${out}/aynala_dugme.png` });
  ok('1d soru kutusu açılmadı', (await kutuAcik()) === false);
}

// ---------------------------------------------------------------------------------
// 2 · AÇIK: aynalanmış KOPYA eklenir, kaynak durur; sonda soru kutusu yok
// ---------------------------------------------------------------------------------
{
  const n0 = await count();
  await tapWorld(300, 300);
  const b2 = await bar();
  // Geri gelince giriş satırı düğmelerden ayrılır: üç satır (Çizgi / Polyline'ın Bitir · Geri · İptal durumuyla aynı); etiket düğme içinde kırılmaz
  const mk2 = dugmeVar(b2, 'mirrorkeep'), cn2 = dugmeVar(b2, 'cancel');
  ok('2a 1. noktadan sonra Geri + Orijinal kalsın + İptal; en çok üç satır (< 150 px) ve etiket tek satır', dugmeVar(b2, 'back') && mk2 && cn2 && b2.h < 150 && mk2[4] === cn2[4], J({ btns: b2.btns.map(q => [q[0], q[4]]), h: b2.h }));
  await tapWorld(500, 300);                                    // ayna çizgisi y = 300 → kopya y = 400
  await bekle(200);
  const n1 = await count(), kaynak = await primOf('ay_0'), yeni = await sonPrim(), d = await durum(), tst = await toast();
  ok("2b kopya eklendi (+1), kaynak y = 200'de durdu, kopya y = 400'de", n1 === n0 + 1 && yak(kaynak.ops[0][2], 200) && yak(kaynak.ops[1][2], 200) && yak(yeni.bb[1], 400) && yak(yeni.bb[3], 400) && yak(yeni.bb[0], 200) && yak(yeni.bb[2], 400), J({ n0, n1, kaynak: kaynak.ops, yeni }));
  ok('2c araç bitti, "Aynala uygulandı" bildirimi; ne uygulama kutusu ne tarayıcı kutusu açıldı', d.active === null && /Aynala/.test(tst) && /uygulandı/.test(tst) && (await kutuAcik()) === false && tarayiciKutusu === 0, J({ d, tst, tarayiciKutusu }));
  await ev((k) => { window.dwgApp.editor.doc.run({ op: 'delete', keys: [k] }); window.dwgApp.requestRender(); }, yeni.key);   // kopya silinir, sahne başa döner
}

// ---------------------------------------------------------------------------------
// 3 · KAPALI: kaynak taşınır (silinir), kopya yok; düğme her başlangıçta açığa döner
// ---------------------------------------------------------------------------------
{
  await arac('t:mirror');
  ok('3a yeni başlangıçta orijinal kalsın yine AÇIK', (await durum()).keep === true);
  await tapWorld(300, 200);
  await dugme('finish');
  await dugme('mirrorkeep');
  const d = await durum(), b = await bar(), mk = dugmeVar(b, 'mirrorkeep');
  ok('3b düğmeye dokunuldu: KAPALI (vurgu yok), durum false, istem değişmedi', d.keep === false && mk && mk[1] === false && /Ayna çizgisi 1\. nokta/.test(b.text), J({ d, mk }));
  const n0 = await count();
  await tapWorld(300, 300); await tapWorld(500, 300); await bekle(200);
  const n1 = await count(), kaynak = await primOf('ay_0');
  ok("3c kaynak y = 400'e taşındı, sayı değişmedi (kopya yok)", n1 === n0 && yak(kaynak.ops[0][2], 400) && yak(kaynak.ops[1][2], 400) && yak(kaynak.ops[0][1], 200) && yak(kaynak.ops[1][1], 400), J({ n0, n1, kaynak: kaynak.ops }));
  ok('3d yine soru kutusu yok', (await kutuAcik()) === false && tarayiciKutusu === 0);
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); });   // kaynak y = 200'e döner
  const geri = await primOf('ay_0');
  ok("3e geri al: kaynak y = 200'e döndü (tek geri alma adımı)", yak(geri.ops[0][2], 200) && yak(geri.ops[1][2], 200), J(geri.ops));
}

// ---------------------------------------------------------------------------------
// 4 · Geri düğmesi durumu korur; İptal + yeniden başlatma açığa döndürür; seçim menüsünden başlayınca düğme hemen var
// ---------------------------------------------------------------------------------
{
  await arac('t:mirror');
  await tapWorld(300, 200);
  await dugme('finish');
  await dugme('mirrorkeep');
  await tapWorld(300, 300);
  await dugme('back');
  const d = await durum(), b = await bar(), mk = dugmeVar(b, 'mirrorkeep');
  ok('4a Geri: 1. nokta silindi, düğme KAPALI kaldı', d.pts === 0 && d.keep === false && mk && mk[1] === false, J({ d, mk }));
  await dugme('cancel');
  await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); const p = window.dwgApp.state.prims.find(x => x.key === 'ay_0'); E.sel.add(p); E.act('t:mirror'); }); await bekle(150);
  const d2 = await durum(), b2 = await bar(), mk2 = dugmeVar(b2, 'mirrorkeep');
  ok('4b seçim önceden varsa (seçim menüsü) araç 1. noktadan başlar: düğme hemen görünür ve AÇIK', d2.selecting === false && d2.step === 1 && d2.keep === true && mk2 && mk2[1] === true, J({ d2, mk2 }));
  await dugme('cancel');
  ok('4c İptal: araç kapandı, düğme kalktı', (await durum()).active === null && !dugmeVar(await bar(), 'mirrorkeep'));
}

// ---------------------------------------------------------------------------------
// 5 · İngilizce ve komut tablosu
// ---------------------------------------------------------------------------------
{
  await dil('en'); await bekle(150);
  await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); const p = window.dwgApp.state.prims.find(x => x.key === 'ay_0'); E.sel.add(p); E.act('t:mirror'); }); await bekle(150);
  const b = await bar(), mk = dugmeVar(b, 'mirrorkeep');
  ok('5a İngilizce: "MIRROR: Mirror line point 1", düğme "Keep original"', /^MIRROR: Mirror line point 1/.test(b.text) && mk && mk[2] === 'Keep original', J({ text: b.text, mk }));
  await dugme('cancel');
  await dil('tr'); await bekle(150);
  const a = await ev(async () => { const A = await import('./acad.js'); return { mi: A.resolve('MI').note, st: A.stats() }; });
  ok('5b komut tablosu: MIRROR notu düğmeyi söyler; sayılar değişmedi (506 / 220 / 751)', /Keep original/.test(a.mi || '') && /Erase source/.test(a.mi || '') && a.st.total === 506 && a.st.acad === 220 && a.st.names === 751, J(a));   // v7.81: 3DROTATE, 3DSCALE, MIRROR3D, 3DLINE, 3DOSNAP eklendi
  const dil15 = await ev(async () => { const I = await import('./i18n.js'); const out = { tr: I.TR.mirrorKeepBtn, en: I.EN.mirrorKeepBtn }; for (const l of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'vi', 'zh']) { const M = await import(`./lang/${l}.js`); out[l] = M.default.mirrorKeepBtn; } return out; });
  ok('5c "Orijinal kalsın" 15 dilde de var', Object.values(dil15).every(v => typeof v === 'string' && v.length > 0) && Object.keys(dil15).length === 15, J(dil15));
}

// ---------------------------------------------------------------------------------
// 6 · X / Y eksen düğmeleri: ayna çizgisi yatay (X) ya da düşey (Y), tek noktayla
// ---------------------------------------------------------------------------------
{
  await arac('t:mirror'); await tapWorld(300, 200); await dugme('finish');
  const b0 = await bar(), mx = dugmeVar(b0, 'mirrorx'), my = dugmeVar(b0, 'mirrory');
  ok('6a seçimden sonra X ve Y düğmeleri, ikisi de kapalı; sıra X · Y · Orijinal kalsın · İptal', mx && my && mx[1] === false && my[1] === false && b0.btns.map(q => q[0]).join(',') === 'mirrorx,mirrory,mirrorkeep,cancel', J(b0.btns));
  const basliklar = await ev(() => [...document.querySelectorAll('#cmdBtns [data-cmd="mirrorx"], #cmdBtns [data-cmd="mirrory"]')].map(b => [b.title, b.getAttribute('aria-label'), b.getAttribute('aria-pressed'), b.querySelector('use') ? b.querySelector('use').getAttribute('href') : null]));
  ok('6b eksen düğmeleri simge + başlık / aria: "Yatay ayna çizgisi (X)" (#i-mirror-x), "Düşey ayna çizgisi (Y)" (#i-mirror)', basliklar[0][0] === 'Yatay ayna çizgisi (X)' && basliklar[0][1] === 'Yatay ayna çizgisi (X)' && basliklar[0][3] === '#i-mirror-x' && basliklar[1][0] === 'Düşey ayna çizgisi (Y)' && basliklar[1][3] === '#i-mirror' && basliklar.every(q => q[2] === 'false'), J(basliklar));
  await dugme('mirrorx');
  const b1 = await bar(), d1 = await durum();
  await page.screenshot({ path: `${out}/aynala_eksen_x.png` });
  ok('6c X: düğme açık (aria-pressed), istem "Yatay ayna çizgisinin geçeceği nokta", durum x', dugmeVar(b1, 'mirrorx')[1] === true && /Yatay ayna çizgisinin geçeceği nokta/.test(b1.text) && d1.axis === 'x' && (await ev(() => document.querySelector('#cmdBtns [data-cmd="mirrorx"]').getAttribute('aria-pressed'))) === 'true', J({ text: b1.text, d1 }));
  await dugme('mirrorx');
  ok('6d X yeniden basılınca serbest çizgiye dönülür, istem 1. noktaya döner', (await durum()).axis === null && /Ayna çizgisi 1\. nokta/.test((await bar()).text));
  await dugme('mirrorx');
  const n0 = await count();
  await tapWorld(300, 300);                                    // yatay ayna çizgisi y = 300 → kopya y = 400
  await bekle(200);
  const n1 = await count(), yeni = await sonPrim(), d2 = await durum();
  // dokunulan nokta ekran pikseline yuvarlanır (~1,8 birim / px): ayna çizgisi 300'den değil 300 ± 0,001'den geçebilir; pay 1e-3
  ok('6e tek nokta yeter: y = 300 yatay çizgisine göre kopya y = 400 (x 200..400), araç bitti', n1 === n0 + 1 && yak(yeni.bb[1], 400, 1e-3) && yak(yeni.bb[3], 400, 1e-3) && yak(yeni.bb[0], 200, 1e-3) && yak(yeni.bb[2], 400, 1e-3) && d2.active === null, J({ n0, n1, yeni, d2 }));
  await ev((k) => { window.dwgApp.editor.doc.run({ op: 'delete', keys: [k] }); window.dwgApp.requestRender(); }, yeni.key);
  await arac('t:mirror');
  ok('6f yeni başlangıçta eksen serbest', (await durum()).axis === null);
  await tapWorld(300, 200); await dugme('finish'); await dugme('mirrory');
  const b3 = await bar();
  ok('6g Y: düğme açık, X kapalı, istem "Düşey ayna çizgisinin geçeceği nokta"', dugmeVar(b3, 'mirrory')[1] === true && dugmeVar(b3, 'mirrorx')[1] === false && /Düşey ayna çizgisinin geçeceği nokta/.test(b3.text), J(b3.btns));
  const n2 = await count();
  await tapWorld(500, 300); await bekle(200);                  // düşey ayna çizgisi x = 500 → kopya x 600..800
  const n3 = await count(), yeni2 = await sonPrim();
  ok('6h x = 500 düşey çizgisine göre kopya x = 600..800, y = 200 (dokunuş payı 1e-3)', n3 === n2 + 1 && yak(yeni2.bb[0], 600, 1e-3) && yak(yeni2.bb[2], 800, 1e-3) && yak(yeni2.bb[1], 200, 1e-3) && yak(yeni2.bb[3], 200, 1e-3), J({ yeni2 }));
  await ev((k) => { window.dwgApp.editor.doc.run({ op: 'delete', keys: [k] }); window.dwgApp.requestRender(); }, yeni2.key);
  await arac('t:mirror'); await tapWorld(300, 200); await dugme('finish'); await dugme('mirrorx'); await dugme('mirrorkeep');
  const n4 = await count();
  await ev(() => window.dwgApp.editor.tools.typed('300,300')); await bekle(250);   // nokta yazıyla
  const n5 = await count(), kaynak = await primOf('ay_0');
  ok("6i X + Orijinal kalsın kapalı, nokta yazıyla (300,300): kaynak y = 400'e taşındı, sayı sabit", n5 === n4 && yak(kaynak.ops[0][2], 400) && yak(kaynak.ops[1][2], 400), J({ n4, n5, kaynak: kaynak.ops }));
  await ev(() => { window.dwgApp.editor.doc.undo(); window.dwgApp.requestRender(); });
  await arac('t:mirror'); await tapWorld(300, 200); await dugme('finish'); await tapWorld(300, 300);
  const b4 = await bar();
  ok('6j serbest kipte 1. noktadan sonra eksen düğmeleri kalkar (Geri · Orijinal kalsın · İptal)', !dugmeVar(b4, 'mirrorx') && !dugmeVar(b4, 'mirrory') && !!dugmeVar(b4, 'back') && b4.h < 150, J({ btns: b4.btns.map(q => q[0]), h: b4.h }));
  await dugme('back');
  ok('6k Geri: eksen düğmeleri geri gelir', !!dugmeVar(await bar(), 'mirrorx') && !!dugmeVar(await bar(), 'mirrory'));
  await dugme('cancel');
  await dil('en'); await bekle(150);
  await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); E.sel.add(window.dwgApp.state.prims.find(x => x.key === 'ay_0')); E.act('t:mirror'); }); await bekle(150);
  await dugme('mirrory');
  const be = await bar(), te = await ev(() => [document.querySelector('#cmdBtns [data-cmd="mirrorx"]').title, document.querySelector('#cmdBtns [data-cmd="mirrory"]').title]);
  ok('6l İngilizce: "MIRROR: Point on the vertical mirror line", başlıklar "Horizontal / Vertical mirror line (X / Y)"', /^MIRROR: Point on the vertical mirror line/.test(be.text) && te[0] === 'Horizontal mirror line (X)' && te[1] === 'Vertical mirror line (Y)', J({ text: be.text, te }));
  await dugme('cancel'); await dil('tr'); await bekle(150);
  const a = await ev(async () => { const A = await import('./acad.js'); return { mi: A.resolve('MI').note, st: A.stats() }; });
  ok('6m MIRROR notu X / Y düğmelerini ve ORTHO karşılığını söyler; sayılar sabit', /X \/ Y buttons/.test(a.mi || '') && /ORTHO/.test(a.mi || '') && a.st.total === 506, J(a));
}

await page.screenshot({ path: `${out}/aynala.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
