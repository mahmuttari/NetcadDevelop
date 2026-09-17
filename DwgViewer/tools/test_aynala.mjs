// AYNALA — "Orijinal kalsın" düğmesi (v7.59). AutoCAD MIRROR'ın sondaki "Erase source objects? <N>" sorusu
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
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, selecting: T.selecting, step: T.step, keep: T.mirrorKeep, sel: window.dwgApp.editor.sel.size, pts: T.pts.length }; });
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
  ok('1b Bitir: ayna çizgisinin 1. noktası istenir; "Orijinal kalsın" düğmesi görünür, AÇIK (vurgulu), kopya simgeli; İptal yanında', d1.selecting === false && d1.step === 1 && d1.sel === 1 && /Ayna çizgisi 1\. nokta/.test(b1.text) && !!mk && mk[1] === true && mk[2] === 'Orijinal kalsın' && mk[3] === true && b1.btns[b1.btns.length - 1][0] === 'cancel', J({ d1, text: b1.text, btns: b1.btns }));
  ok('1c komut çubuğu iki satırı aşmaz (< 100 px): istem + [giriş · Enter · Orijinal kalsın · İptal]', b1.h < 100, String(b1.h));
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
  ok('5b komut tablosu: MIRROR notu düğmeyi söyler; sayılar değişmedi (458 / 158 / 663)', /Keep original/.test(a.mi || '') && /Erase source/.test(a.mi || '') && a.st.total === 458 && a.st.acad === 158 && a.st.names === 663, J(a));
  const dil15 = await ev(async () => { const I = await import('./i18n.js'); const out = { tr: I.TR.mirrorKeepBtn, en: I.EN.mirrorKeepBtn }; for (const l of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'vi', 'zh']) { const M = await import(`./lang/${l}.js`); out[l] = M.default.mirrorKeepBtn; } return out; });
  ok('5c "Orijinal kalsın" 15 dilde de var', Object.values(dil15).every(v => typeof v === 'string' && v.length > 0) && Object.keys(dil15).length === 15, J(dil15));
}

await page.screenshot({ path: `${out}/aynala.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
