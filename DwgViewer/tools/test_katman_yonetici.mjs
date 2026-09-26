/*
 * KATMAN YÖNETİCİSİ (AutoCAD Layer Properties Manager düzeni) + -LAYER KOMUT SATIRI.
 *
 * Katman paneli v7.54'te yeniden kuruldu: her satırda geçerli (✓) · ad · ampul (açık/kapalı) ·
 * kar tanesi (dondur/çöz) · kilit · renk örneği · çizgi tipi · kalınlık · sayı; üstte Yeni /
 * Sil / Geçerli yap / İzole et. Kural: her hücre doğrudan düzenlenir, her değişiklik düzenleme
 * günlüğünden geçer (geri alınır, DXF'e yazılır), görünürlük TÜRETİLİR (kapalı ya da donuk
 * değilse ve izolasyon gizlemiyorsa). -LAYER ise AutoCAD'in pencere açmayan komut satırı
 * sürümüdür: seçenek harfleri (?, N, M, S, R, ON, OFF, C, L, LW, F, T, LO, U) sırayla sorulur.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_katman_yonetici.mjs
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, queueAnswers, askLog, PHONE, samplesDir } from './harness.mjs';

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
await openFile(page, `${samplesDir}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; });

const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const bekle = (ms = 160) => page.waitForTimeout(ms);
/** Seçiciyi bulup DOM'dan tıklar (kaydırma / örtüşme sorunu olmadan); bulunmazsa false */
const klik = async (sel) => { const r = await ev((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel); await bekle(); return r; };
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
/** Bayat ileti sonraki iddiaya karışmasın: kutuyu gizler (uygulama yeni iletide yeniden açar) */
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const undoN = () => ev(() => window.dwgApp.editor.doc.undoStack.length);
const undo = async () => { await ev(() => window.dwgApp.editor.doc.undo()); await bekle(); };
const durum = (name) => ev((n) => { const l = window.dwgApp.state.layers.get(n); return l ? { off: !!l.off, frozen: !!l.frozen, locked: !!l.locked, visible: !!l.visible, iso: !!l.isoHidden, color: l.color, lt: l.lt || 'Continuous', lw: l.lw == null ? 25 : l.lw } : null; }, name);
const satir = (name) => ev((n) => {
  const r = document.querySelector(`#layerList [data-layer-row="${n}"]`); if (!r) return null;
  const q = (s) => r.querySelector(s), ic = (b) => { const u = b && b.querySelector('use'); return u ? u.getAttribute('href') : ''; };
  return { cls: r.className, cur: ic(q('[data-lcur]')), on: { cls: q('[data-lon]').className, title: q('[data-lon]').title, ic: ic(q('[data-lon]')) },
    frz: { cls: q('[data-lfrz]').className, title: q('[data-lfrz]').title, ic: ic(q('[data-lfrz]')) }, lock: { cls: q('[data-llock]').className, title: q('[data-llock]').title, ic: ic(q('[data-llock]')) },
    sw: q('[data-lcolor] .sw').style.background, lt: q('[data-llt]').textContent.trim(), lw: q('[data-llw]').textContent.trim() };
}, name);
const panel = () => ev(() => ({ acik: !document.getElementById('layerPanel').hidden, n: document.querySelectorAll('#layerList .lrow').length, sel: document.getElementById('layerSelName').textContent, del: document.getElementById('btnLayerDel').disabled, cur: document.getElementById('btnLayerCur').disabled, iso: document.getElementById('btnLayerIso').disabled, uniso: document.getElementById('btnLayersUniso').hidden, lbtn: document.querySelectorAll('#layerList .lbtn, #layerList input[type=checkbox]').length }));
const acPanel = async () => { const p = await panel(); if (!p.acik) { await klik('#btnLayers'); } };
const bar = () => ev(() => ({ hidden: document.getElementById('cmdBar').hidden, text: document.getElementById('cmdText').textContent.trim(), ph: document.getElementById('cmdInput').placeholder, seq: !!window.dwgApp.editor.cmdSeqActive() }));
const yaz = async (v) => { await page.fill('#cmdInput', v); await bekle(100); };
const gir = async () => { await page.click('#cmdEnter'); await bekle(220); };
const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);

// Örnek çizimin katmanları: nesnesi olan bir katman (X) ve geçerli katman
const info = await ev(() => { const S = window.dwgApp.state; const cnt = new Map(); for (const p of S.prims) if (p.k !== 4 && !p.inf) cnt.set(p.lay, (cnt.get(p.lay) || 0) + 1); const adlar = [...S.layers.keys()]; const dolu = adlar.filter(a => a !== '0' && (cnt.get(a) || 0) > 0 && !/["\\]/.test(a)).sort((a, b) => cnt.get(b) - cnt.get(a)); return { n: adlar.length, adlar, dolu, cur: window.dwgApp.editor.curLayer }; });
const X = info.dolu[0] || null;
console.log('katman', info.n, 'dolu', info.dolu.length, 'X =', X, 'geçerli =', info.cur);

// ---------------------------------------------------------------------------------
// A) Panel düzeni
// ---------------------------------------------------------------------------------
{
  await klik('#btnLayers');
  const p = await panel();
  ok('A1 katman paneli açıldı ve her katman bir satır', p.acik && p.n === info.n && p.n >= 2, JSON.stringify(p));
  ok('A2 eski onay kutusu / .lbtn düğmeleri yok (yeni satır düzeni)', p.lbtn === 0, String(p.lbtn));
  const hucre = await ev(() => [...document.querySelectorAll('#layerList .lrow')].map(r => ['[data-lcur]', '[data-lname]', '[data-lon]', '[data-lfrz]', '[data-llock]', '[data-lcolor] .sw', '[data-llt]', '[data-llw]', '.lc-ct'].every(s => r.querySelector(s))).every(Boolean));
  ok('A3 her satırda geçerli · ad · ampul · dondur · kilit · renk · çizgi tipi · kalınlık · sayı hücreleri var', hucre);
  ok('A4 seçim yokken Sil / Geçerli yap / İzole et kapalı, ad boş', p.del && p.cur && p.iso && p.sel === '', JSON.stringify(p));
  const cur = await satir(info.cur);
  ok('A5 geçerli katmanın satırı "cur" sınıfında ve ✓ simgesi taşıyor', !!cur && /\bcur\b/.test(cur.cls) && cur.cur === '#i-check', JSON.stringify(cur && { cls: cur.cls, cur: cur.cur }));
  const ilk = await satir(info.adlar[0]);
  ok('A6 açık katmanın ampulü yanıyor (st-on, i-bulb), dondur güneş, kilit açık', !!ilk && /st-on/.test(ilk.on.cls) && ilk.on.ic === '#i-bulb' && ilk.frz.ic === '#i-sunny' && ilk.lock.ic === '#i-unlock', JSON.stringify(ilk));
  ok('A7 çizgi tipi ve kalınlık hücreleri dolu (Continuous · 0.25 mm varsayılan)', !!ilk && ilk.lt.length > 0 && /^\d[.,]\d\d$/.test(ilk.lw), JSON.stringify(ilk && { lt: ilk.lt, lw: ilk.lw }));
  const boyut = await ev(() => [...document.querySelectorAll('#layerList button, #layerPanel .layer-actions button, #layerPanel .panel-head button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40); }).map(b => (b.id || b.className) + ':' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)));
  ok('A8 paneldeki görünür her düğme ≥ 40x40 px (eldivenli dokunuş)', boyut.length === 0, boyut.slice(0, 6).join(' '));
  const bas = await ev(() => getComputedStyle(document.querySelector('#layerList .lhead')).display);
  ok('A9 telefonda sütun başlığı gizli (satır iki katlı), yalnız geniş panelde görünür', bas === 'none', bas);
  const dar = await ev(() => { const r = document.querySelector('#layerList .lrow'); const p = document.getElementById('layerList').getBoundingClientRect(); return [...r.querySelectorAll('.lctl .lc')].every(b => b.getBoundingClientRect().right <= p.right + 0.5); });
  ok('A9b 340 px panelde denetim şeridi sağa TAŞMAZ (kalınlık düğmesi görünür)', dar);
  await shot('katman_telefon');
  // geniş görüntü alanı tek başına yetmez: panel 340 px kalır ve iki katlı düzen sürer (ad sütunu sıfıra inmez)
  await page.setViewportSize({ width: 1000, height: 800 }); await bekle(200);
  const orta = await ev(() => ({ head: getComputedStyle(document.querySelector('#layerList .lhead')).display, ad: document.querySelector('#layerList .lrow .lc-name').getBoundingClientRect().width }));
  ok('A10 geniş görüntü alanında dar panel iki katlı kalır, ad sütunu görünür', orta.head === 'none' && orta.ad > 100, JSON.stringify(orta));
  // yerleşik (docked) yan sütun 400 px'tir; panel genişliği için sütunun kendisi büyütülür (taşırmak değil)
  await ev(() => { const side = document.getElementById('side'), panel = document.getElementById('layerPanel'); if (side && panel.parentElement === side) side.style.flex = '0 0 760px'; else panel.style.width = '720px'; }); await bekle(250);
  const genis = await ev(() => ({ head: getComputedStyle(document.querySelector('#layerList .lhead')).display, satir: document.querySelector('#layerList .lrow').getBoundingClientRect().height, ad: document.querySelector('#layerList .lrow .lc-name').getBoundingClientRect().width, basliklar: [...document.querySelectorAll('#layerList .lhead .lctl > span')].map(x => x.title || x.textContent.trim()).join(',') }));
  ok('A11 720 px panelde AutoCAD cetveli: başlık satırı, tek katlı satır (< 60 px), ad sütunu ≥ 120 px, simgeli durum başlıkları', genis.head === 'grid' && genis.satir < 60 && genis.ad >= 120 && genis.basliklar === 'Açık,Dondur,Kilitle,Renk,Çizgi tipi,Kalınlık', JSON.stringify(genis));
  await shot('katman_genis');
  await ev(() => { const side = document.getElementById('side'); if (side) side.style.flex = ''; document.getElementById('layerPanel').style.width = ''; });
  // gerçek yol: 1280 px ve üstü ekranda yerleşik yan sütun 640 px'e çıkar ve cetvel kendiliğinden tek satıra geçer
  await page.setViewportSize({ width: 1280, height: 800 }); await bekle(300);
  const dex = await ev(() => ({ side: Math.round(document.getElementById('side').getBoundingClientRect().width), head: getComputedStyle(document.querySelector('#layerList .lhead')).display, canvas: Math.round(document.getElementById('viewport').getBoundingClientRect().width) }));
  ok('A12 1280 px ekranda yan sütun 640 px, cetvel tek satırlı, çizim alanına ≥ 600 px kalır', dex.side === 640 && dex.head === 'grid' && dex.canvas >= 600, JSON.stringify(dex));
  await page.setViewportSize(PHONE.viewport); await bekle(200);
}

// ---------------------------------------------------------------------------------
// B) Ampul / dondur / kilit: dokun → değişir, geri al → döner; tek geri alma adımı
// ---------------------------------------------------------------------------------
{
  const ad = info.adlar.find(a => a !== info.cur && !/["\\]/.test(a)) || info.adlar[0];
  const u0 = await undoN();
  await klik(`#layerList [data-lon="${ad}"]`);
  const d1 = await durum(ad), r1 = await satir(ad);
  ok('B1 ampule dokununca katman KAPANIR: off=true, görünmez, satır "hid", ampul sönük (i-bulb-off)', d1.off && !d1.visible && /\bhid\b/.test(r1.cls) && /st-off/.test(r1.on.cls) && r1.on.ic === '#i-bulb-off' && r1.on.title === 'Kapalı', JSON.stringify({ d1, on: r1.on }));
  ok('B2 tek geri alma adımı üretti', (await undoN()) === u0 + 1, `${u0} → ${await undoN()}`);
  await undo();
  const d2 = await durum(ad), r2 = await satir(ad);
  ok('B3 geri al: katman yeniden AÇIK ve liste kendiliğinden tazelendi (layersChanged kancası)', !d2.off && d2.visible && !/\bhid\b/.test(r2.cls) && r2.on.ic === '#i-bulb', JSON.stringify({ d2, cls: r2.cls }));
  await klik(`#layerList [data-lfrz="${ad}"]`);
  const d3 = await durum(ad), r3 = await satir(ad);
  ok('B4 kar tanesi: dondurulunca frozen=true, görünmez, satır üstü çizili, simge i-snow, başlık "Çöz"', d3.frozen && !d3.visible && /\bfrozen\b/.test(r3.cls) && r3.frz.ic === '#i-snow' && r3.frz.title === 'Çöz' && /st-frozen/.test(r3.frz.cls), JSON.stringify({ d3, frz: r3.frz }));
  await klik(`#layerList [data-lfrz="${ad}"]`);
  const d4 = await durum(ad);
  ok('B5 ikinci dokunuş çözer (thaw): görünür', !d4.frozen && d4.visible, JSON.stringify(d4));
  await klik(`#layerList [data-llock="${ad}"]`);
  const d5 = await durum(ad), r5 = await satir(ad);
  ok('B6 kilit: locked=true, simge i-lock, başlık "Kilidi aç"; görünürlük değişmez', d5.locked && d5.visible && r5.lock.ic === '#i-lock' && r5.lock.title === 'Kilidi aç' && /st-locked/.test(r5.lock.cls), JSON.stringify({ d5, lock: r5.lock }));
  await undo();
  ok('B7 kilit geri alındı', !(await durum(ad)).locked);
  await undo(); await undo();   // dondur + çöz
  const d6 = await durum(ad);
  ok('B8 dondur/çöz adımları da geri alındı; katman ilk hâlinde', !d6.frozen && !d6.off && d6.visible && (await undoN()) === u0, JSON.stringify(d6));
}

// ---------------------------------------------------------------------------------
// C) Seçim · geçerli yap · yeni · yeniden adlandır · sil
// ---------------------------------------------------------------------------------
{
  const ad = info.adlar.find(a => a !== info.cur && !/["\\]/.test(a)) || info.adlar[0];
  await klik(`#layerList [data-lname="${ad}"]`);
  const p = await panel(), r = await satir(ad);
  ok('C1 ada dokunmak satırı SEÇER: "sel" sınıfı, ad üstte, Sil / Geçerli / İzole açıldı', /\bsel\b/.test(r.cls) && p.sel === ad && !p.del && !p.cur && !p.iso, JSON.stringify({ cls: r.cls, p }));
  await klik('#btnLayerCur');
  const cur = await ev(() => window.dwgApp.editor.curLayer), rc = await satir(ad);
  ok('C2 "Geçerli yap" seçili katmanı geçerli yaptı (✓ taşındı)', cur === ad && rc.cur === '#i-check', JSON.stringify({ cur, ic: rc.cur }));
  const oner = await ev(() => window.dwgApp.editor.nextLayerName());
  ok('C3 yeni katman adı önerisi AutoCAD gibi "Katman1"', oner === 'Katman1', oner);
  // yeni katman: seçili satır (ad) varken renk / çizgi tipi / kalınlık ondan kopyalanır
  await ev((n) => { window.dwgApp.editor.runCmd({ op: 'layerprops', name: n, color: 5, lw: 50 }); }, ad);   // seçili katmana mavi + 0,50 mm
  const log0 = (await askLog(page)).length;
  await queueAnswers(page, 'TEST_KAT');
  await klik('#btnLayerNew');
  const lg = await askLog(page);
  const y = await durum('TEST_KAT'), py = await panel();
  ok('C4 Yeni: giriş kutusu "Yeni katman" etiketiyle soruldu, katman oluştu ve seçildi', lg.length === log0 + 1 && lg[lg.length - 1].label === 'Yeni katman' && !!y && py.sel === 'TEST_KAT', JSON.stringify({ lg: lg.slice(-1), y, sel: py.sel }));
  ok('C5 yeni katman seçili satırın rengini (mavi) ve kalınlığını (0,50) aldı', !!y && y.color === 0x0000ff && y.lw === 50 && y.lt === 'Continuous', JSON.stringify(y));
  await undo();   // en son komut: 'layer' (TEST_KAT)
  ok('C6 yeni katman geri alınabilir', !(await durum('TEST_KAT')) && !(await satir('TEST_KAT')), '');
  await ev(() => { window.dwgApp.editor.doc.redo(); }); await bekle();
  ok('C7 yinele katmanı geri getirir ve liste tazelenir', !!(await durum('TEST_KAT')) && !!(await satir('TEST_KAT')));
  // aynı adla ikinci katman: uyarı, kutu yine sorulur ama katman sayısı değişmez
  const n0 = (await panel()).n; await temizle();
  await queueAnswers(page, ad);
  await klik('#btnLayerNew');
  ok('C8 var olan adla yeni katman istenirse uyarı, sayı değişmez', (await panel()).n === n0 && /zaten var/.test(await toast()), await toast());
  // yeniden adlandırma: çift dokunuş
  await queueAnswers(page, 'TEST_KAT2');
  await page.dblclick(`#layerList [data-lname="TEST_KAT"]`); await bekle();
  const ra = await ev(() => { const S = window.dwgApp.state; return { yeni: S.layers.has('TEST_KAT2'), eski: S.layers.has('TEST_KAT') }; });
  ok('C9 çift dokunuş yeniden adlandırır (TEST_KAT → TEST_KAT2)', ra.yeni && !ra.eski, JSON.stringify(ra));
  ok('C10 seçim yeni adı izliyor', (await panel()).sel === 'TEST_KAT2', (await panel()).sel);
  const log1 = (await askLog(page)).length; await temizle();
  await page.dblclick('#layerList [data-lname="0"]'); await bekle();
  ok('C11 "0" katmanı yeniden adlandırılamaz: kutu açılmadan uyarı', (await askLog(page)).length === log1 && /"0"/.test(await toast()), await toast());
  await queueAnswers(page, ad); await temizle();
  await page.dblclick('#layerList [data-lname="TEST_KAT2"]'); await bekle();
  ok('C12 var olan ada yeniden adlandırma reddedilir', (await durum('TEST_KAT2')) !== null && /zaten var/.test(await toast()), await toast());
  // F2 de yeniden adlandırır
  await queueAnswers(page, 'TEST_KAT3');
  await ev(() => { const n = document.querySelector('#layerList [data-lname="TEST_KAT2"]'); n.focus(); n.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })); }); await bekle();
  ok('C13 F2 tuşu yeniden adlandırır (klavye)', !!(await durum('TEST_KAT3')) && !(await durum('TEST_KAT2')));
  // silme kuralları
  await temizle(); await klik('#layerList [data-lname="0"]'); await klik('#btnLayerDel');
  ok('C14 "0" silinemez', !!(await durum('0')) && /"0"/.test(await toast()), await toast());
  await temizle(); await klik(`#layerList [data-lname="${ad}"]`); await klik('#btnLayerDel');
  ok('C15 GEÇERLİ katman silinemez (AutoCAD kuralı)', !!(await durum(ad)) && /Geçerli katman silinemez/.test(await toast()), await toast());
  const log2 = (await askLog(page)).length;
  await klik('#layerList [data-lname="TEST_KAT3"]'); await klik('#btnLayerDel');
  ok('C16 BOŞ katman sorulmadan silinir; seçim temizlenir, Sil kapanır', !(await durum('TEST_KAT3')) && (await askLog(page)).length === log2 && (await panel()).sel === '' && (await panel()).del, JSON.stringify(await panel()));
  await undo();
  ok('C17 silme geri alınır', !!(await durum('TEST_KAT3')));
  await undo();   // TEST_KAT3 adı → TEST_KAT2 … (kalan adımlar aşağıda temizlenir)
  if (X && X !== ad) {
    // dolu katman: kutu (taşı / birlikte sil) sorulur; taşı: nesneler 0'a geçer, geri alma döndürür
    const once = await ev((n) => window.dwgApp.state.prims.filter(p => p.lay === n).length, X);
    await queueAnswers(page, { mode: 'move' });
    await klik(`#layerList [data-lname="${X}"]`); await klik('#btnLayerDel');
    const sonra = await ev((n) => ({ var: window.dwgApp.state.layers.has(n), kalan: window.dwgApp.state.prims.filter(p => p.lay === n).length }), X);
    ok('C18 DOLU katman: kutu sorulur, nesneler "0"a taşınır, katman silinir', once > 0 && !sonra.var && sonra.kalan === 0, JSON.stringify({ once, sonra }));
    await undo();
    ok('C19 dolu katman silme geri alındı (katman ve nesneleri döndü)', (await ev((n) => window.dwgApp.state.prims.filter(p => p.lay === n).length, X)) === once);
  } else C.skip('C18-19 dolu katman silme', 'örnekte nesneli ikinci katman yok');
}

// ---------------------------------------------------------------------------------
// D) Renk · çizgi tipi · kalınlık seçicileri
// ---------------------------------------------------------------------------------
{
  const ad = info.adlar.find(a => a !== '0' && !/["\\]/.test(a)) || '0';
  await acPanel();
  await klik(`#layerList [data-lcolor="${ad}"]`);
  const rp = await ev(() => ({ acik: !document.getElementById('docPanel').hidden, baslik: document.getElementById('docTitle').textContent, std: document.querySelectorAll('#docBody .aci-std button').length, grid: document.querySelectorAll('#docBody .aci-grid button').length, inp: !!document.getElementById('lcCi') }));
  ok('D1 renk seçici: "Renk seç: <ad>", 9 standart + 246 ızgara rengi (ACI 1-255), numara girişi', rp.acik && rp.baslik === 'Renk seç: ' + ad && rp.std === 9 && rp.grid === 246 && rp.inp, JSON.stringify(rp));
  await shot('renk_secici');
  await klik('#docBody [data-ci="1"]');
  const d1 = await durum(ad), r1 = await satir(ad);
  ok('D2 kırmızıya (ACI 1) dokununca katman rengi değişti, kutu kapandı, örnek kırmızı', d1.color === 0xff0000 && (await ev(() => document.getElementById('docPanel').hidden)) && /255, 0, 0/.test(r1.sw), JSON.stringify({ color: d1.color.toString(16), sw: r1.sw }));
  await klik(`#layerList [data-lcolor="${ad}"]`);
  await ev(() => { document.getElementById('lcCi').value = '3'; }); await klik('#lcCiOk');
  ok('D3 numara girişiyle ACI 3 (yeşil)', (await durum(ad)).color === 0x00ff00, (await durum(ad)).color.toString(16));
  await undo(); await undo();
  ok('D4 iki renk adımı geri alındı', (await durum(ad)).color !== 0x00ff00 && (await durum(ad)).color !== 0xff0000);
  await klik(`#layerList [data-llt="${ad}"]`);
  const lp = await ev(() => ({ baslik: document.getElementById('docTitle').textContent, adlar: [...document.querySelectorAll('#docBody [data-lt]')].map(e => e.dataset.lt), aktif: (document.querySelector('#docBody [data-lt].active') || {}).dataset }));
  ok('D5 çizgi tipi seçici dosyanın LTYPE tablosunu listeler; Continuous başta ve geçerli işaretli', lp.baslik === 'Çizgi tipi seç: ' + ad && lp.adlar[0] === 'Continuous' && lp.aktif && lp.aktif.lt === (await durum(ad)).lt, JSON.stringify(lp));
  const hedefLt = lp.adlar.find(a => a !== (lp.aktif && lp.aktif.lt)) || null;
  if (hedefLt) {
    await ev((h) => { document.querySelector(`#docBody [data-lt="${h}"]`).click(); }, hedefLt); await bekle();
    ok('D6 başka bir çizgi tipi seçilince katman güncellendi ve hücre yeni adı yazıyor', (await durum(ad)).lt === hedefLt && (await satir(ad)).lt === hedefLt, JSON.stringify({ lt: (await durum(ad)).lt, hucre: (await satir(ad)).lt }));
    await undo();
  } else { await ev(() => window.dwgApp.onBack()); C.skip('D6 ikinci çizgi tipi', 'dosyada Continuous dışında çizgi tipi yok'); }
  await klik(`#layerList [data-llw="${ad}"]`);
  const wp = await ev(() => ({ baslik: document.getElementById('docTitle').textContent, n: document.querySelectorAll('#docBody [data-lw]').length, vars: (document.querySelector('#docBody [data-lw="25"]') || {}).textContent }));
  ok('D7 kalınlık seçici AutoCAD standart listesini (24 değer) mm olarak sunar; 0,25 "varsayılan"', wp.baslik === 'Çizgi kalınlığı seç: ' + ad && wp.n === 24 && /0[.,]25 mm · varsayılan/.test(wp.vars || ''), JSON.stringify(wp));
  const lw0 = (await durum(ad)).lw, hedef = lw0 === 50 ? 70 : 50;
  await klik(`#docBody [data-lw="${hedef}"]`);
  ok('D8 listeden kalınlık seçildi: lw (0,01 mm) ve hücre metni', (await durum(ad)).lw === hedef && (await satir(ad)).lw.replace(',', '.') === (hedef / 100).toFixed(2), JSON.stringify({ lw: (await durum(ad)).lw, h: (await satir(ad)).lw }));
  await undo();
  ok('D9 kalınlık geri alındı', (await durum(ad)).lw === lw0, `${(await durum(ad)).lw} / ${lw0}`);
}

// ---------------------------------------------------------------------------------
// E) Tümü · Hiçbiri · Ters çevir — toplu ve TEK geri alma adımı
// ---------------------------------------------------------------------------------
{
  await acPanel();
  const u0 = await undoN();
  const ilk = await ev(() => [...window.dwgApp.state.layers.values()].map(l => [l.name, !!l.off, !!l.frozen, !!l.visible].join(':')).join('|'));
  await klik('#btnLayersNone');
  const hepsiKapali = await ev(() => [...window.dwgApp.state.layers.values()].every(l => l.off && !l.visible));
  ok('E1 Hiçbiri: bütün katmanlar KAPALI (off), görünmez', hepsiKapali);
  ok('E2 Hiçbiri tek geri alma adımı', (await undoN()) === u0 + 1, `${u0} → ${await undoN()}`);
  await klik('#btnLayersInvert');
  const hepsiAcik = await ev(() => [...window.dwgApp.state.layers.values()].every(l => !l.off));
  ok('E3 Ters çevir: kapalılar açıldı (dosyadan donuk gelen katman donuk kalır, o ayrı bayrak)', hepsiAcik);
  ok('E4 Ters çevir de TEK geri alma adımı (boş fazladan adım yok)', (await undoN()) === u0 + 2, `${u0} → ${await undoN()}`);
  await ev(() => { const l = [...window.dwgApp.state.layers.values()][0]; window.dwgApp.editor.runCmd({ op: 'layerbulk', items: [{ name: l.name, frozen: true }] }); }); await bekle();
  await klik('#btnLayersAll');
  const hepsiAcikCozuk = await ev(() => [...window.dwgApp.state.layers.values()].every(l => !l.off && !l.frozen && l.visible));
  ok('E5 Tümü: hepsi açık VE çözük', hepsiAcikCozuk);
  await undo(); await undo(); await undo(); await undo();
  const son = await ev(() => [...window.dwgApp.state.layers.values()].map(l => [l.name, !!l.off, !!l.frozen, !!l.visible].join(':')).join('|'));
  ok('E6 dört adım geri: dosyadan gelen ilk durum (donuk katman dâhil) birebir', (await undoN()) === u0 && son === ilk, son);
}

// ---------------------------------------------------------------------------------
// F) İzolasyon (geçici) ile katman durumu (kalıcı) karışmaz
// ---------------------------------------------------------------------------------
{
  const ad = info.adlar.find(a => a !== '0' && !/["\\]/.test(a)) || '0';
  const diger = info.adlar.find(a => a !== ad && !/["\\]/.test(a));
  await acPanel();
  await klik(`#layerList [data-lname="${ad}"]`); await klik('#btnLayerIso');
  const f1 = await durum(diger), r1 = await satir(diger), p1 = await panel();
  ok('F1 İzole et: öteki katman görünmez ama KAPALI DEĞİL (ampul yanıyor), "İzolasyonu kaldır" göründü', !f1.visible && f1.iso && !f1.off && r1.on.ic === '#i-bulb' && /\bhid\b/.test(r1.cls) && !p1.uniso, JSON.stringify({ f1, ic: r1.on.ic, uniso: p1.uniso }));
  await klik(`#layerList [data-lon="${diger}"]`);   // izolasyon sürerken kapat
  await klik('#btnLayersUniso');
  const f2 = await durum(diger), f3 = await durum(ad);
  ok('F2 izolasyon kalkınca izole edilen katman geri geldi; izolasyonda KAPATILAN katman kapalı kaldı', f3.visible && !f3.iso && f2.off && !f2.visible && !f2.iso, JSON.stringify({ f2, f3 }));
  await undo();
  ok('F3 kapatma geri alındı: katman görünür', (await durum(diger)).visible);
}

// ---------------------------------------------------------------------------------
// G) Uzun basış menüsü ve sağ tık: yeniden adlandır seçeneği; bağlam menüsünden kilit
// ---------------------------------------------------------------------------------
{
  const ad = info.adlar.find(a => a !== '0' && !/["\\]/.test(a)) || '0';
  await acPanel();
  await ev((n) => { document.querySelector(`#layerList [data-layer-row="${n}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); }, ad); await bekle();
  const m = await ev(() => ({ baslik: document.getElementById('docTitle').textContent, items: [...document.querySelectorAll('#docBody [data-lm]')].map(e => e.dataset.lm) }));
  ok('G1 satır menüsü: sığdır · geçerli · yalnız bu · soldur · kilit · yeniden adlandır · düzenle · sil', m.baslik === 'Katman: ' + ad && m.items.join(',') === 'fit,cur,iso,fade,lock,rename,props,del', JSON.stringify(m));
  await klik('#docBody [data-lm="lock"]');
  ok('G2 menüden kilit: locked=true ve geri alınabilir', (await durum(ad)).locked && (await undo(), !(await durum(ad)).locked));
}

// ---------------------------------------------------------------------------------
// H) -LAYER komut satırı
// ---------------------------------------------------------------------------------
{
  await ev(() => window.dwgApp.onBack());   // paneli kapat
  let b = await bar();
  if (b.hidden) { await ev(() => window.dwgApp.editor.act('cmdline')); await bekle(); b = await bar(); }
  ok('H1 komut satırı boşta', !b.hidden && !b.seq, JSON.stringify(b));
  await temizle(); await yaz('-la'); await gir();
  b = await bar();
  ok('H2 "-LA": seçenek istemi (pencere açılmaz), sıra etkin', b.seq && /^Seçenek girin \[\?\/M=Yap/.test(b.text) && /U=Kilit aç\]:$/.test(b.text), JSON.stringify(b));
  await shot('la_secenek');
  await yaz('N'); await gir();
  b = await bar();
  ok('H3 N: katman adı sorulur, öneri "Katman1"', b.seq && b.text === 'Katman adı' && b.ph === 'Katman1', JSON.stringify(b));
  await yaz(''); await gir();
  ok('H4 boş Enter öneriyi kabul eder: Katman1 oluştu, sıra bitti, istem boşa döndü', !!(await durum('Katman1')) && !(await bar()).seq && /Katman oluşturuldu: Katman1/.test(await toast()), JSON.stringify({ t: await toast(), b: await bar() }));
  await temizle(); await yaz('-la'); await gir(); await yaz('OFF'); await gir();
  b = await bar();
  ok('H5 OFF: katman adları istemi ("*" = tümü)', b.seq && /^Katman adları/.test(b.text) && b.ph === '*', JSON.stringify(b));
  await yaz('Katman1'); await gir();
  ok('H6 Katman1 kapandı, ileti "Kapalı: Katman1"', (await durum('Katman1')).off && /Kapalı: Katman1/.test(await toast()), await toast());
  await temizle(); await yaz('-la'); await gir(); await yaz('on'); await gir(); await yaz('*'); await gir();
  ok('H7 ON * (küçük harf de olur): bütün katmanlar açık', await ev(() => [...window.dwgApp.state.layers.values()].every(l => !l.off)));
  await temizle(); await yaz('-la'); await gir(); await yaz('S'); await gir();
  b = await bar();
  ok('H8 S: ad istemi, öneri geçerli katman', b.seq && b.text === 'Katman adı' && b.ph === (await ev(() => window.dwgApp.editor.curLayer)), JSON.stringify(b));
  await yaz('Katman1'); await gir();
  ok('H9 Katman1 geçerli katman oldu', (await ev(() => window.dwgApp.editor.curLayer)) === 'Katman1');
  await temizle(); await yaz('-la'); await gir(); await yaz('C'); await gir();
  b = await bar();
  ok('H10 C: renk istemi (ACI 1-255)', b.seq && /^Renk \(ACI 1-255\)/.test(b.text) && b.ph === '1-255', JSON.stringify(b));
  await yaz('3'); await gir(); await yaz('Katman1'); await gir();
  ok('H11 renk 3 → yeşil', (await durum('Katman1')).color === 0x00ff00, (await durum('Katman1')).color.toString(16));
  await temizle(); await yaz('-la'); await gir(); await yaz('C'); await gir(); await yaz('999'); await gir();
  ok('H12 geçersiz renk: "Geçersiz seçenek", sıra biter', /Geçersiz seçenek/.test(await toast()) && !(await bar()).seq, await toast());
  await temizle(); await yaz('-la'); await gir(); await yaz('LW'); await gir(); await yaz('0,5'); await gir(); await yaz('Katman1'); await gir();
  ok('H13 LW 0,5 (virgüllü) → 0,50 mm', (await durum('Katman1')).lw === 50, String((await durum('Katman1')).lw));
  await temizle(); await yaz('-la'); await gir(); await yaz('L'); await gir(); await yaz(''); await gir(); await yaz('Katman1'); await gir();
  ok('H14 L boş → Continuous', (await durum('Katman1')).lt === 'Continuous', (await durum('Katman1')).lt);
  await temizle(); await yaz('-la'); await gir(); await yaz('F'); await gir(); await yaz('Katman1'); await gir();
  ok('H15 F: dondurdu', (await durum('Katman1')).frozen && !(await durum('Katman1')).visible);
  await temizle(); await yaz('-la'); await gir(); await yaz('T'); await gir(); await yaz('Katman1'); await gir();
  ok('H16 T: çözdü', !(await durum('Katman1')).frozen && (await durum('Katman1')).visible);
  await temizle(); await yaz('-la'); await gir(); await yaz('LO'); await gir(); await yaz('Katman1'); await gir();
  ok('H17 LO: kilitledi', (await durum('Katman1')).locked);
  await temizle(); await yaz('-la'); await gir(); await yaz('U'); await gir(); await yaz('Katman1'); await gir();
  ok('H18 U: kilidi açtı', !(await durum('Katman1')).locked);
  await temizle(); await yaz('-la'); await gir(); await yaz('R'); await gir(); await yaz('Katman1'); await gir();
  b = await bar();
  ok('H19 R: yeni ad istemi', b.seq && b.text === 'Yeni ad', JSON.stringify(b));
  await yaz('KAT_X'); await gir();
  ok('H20 Katman1 → KAT_X (geçerli katman adı da izledi)', !!(await durum('KAT_X')) && !(await durum('Katman1')) && (await ev(() => window.dwgApp.editor.curLayer)) === 'KAT_X', await ev(() => window.dwgApp.editor.curLayer));
  await undo();
  ok('H20b yeniden adlandırma geri alınınca geçerli katman eski ada döner', !!(await durum('Katman1')) && (await ev(() => window.dwgApp.editor.curLayer)) === 'Katman1', await ev(() => window.dwgApp.editor.curLayer));
  await ev(() => { window.dwgApp.editor.doc.redo(); }); await bekle();
  ok('H20c yinele: yeniden KAT_X ve geçerli', !!(await durum('KAT_X')) && (await ev(() => window.dwgApp.editor.curLayer)) === 'KAT_X');
  await temizle(); await yaz('-la'); await gir(); await yaz('BOZUK'); await gir();
  b = await bar();
  ok('H21 geçersiz seçenek: uyarı, AYNI istem yeniden (sıra bitmez)', b.seq && /^Seçenek girin/.test(b.text) && /Geçersiz seçenek: BOZUK/.test(await toast()), JSON.stringify({ b, t: await toast() }));
  await klik('#cmdBtns [data-cmdseq="cancel"]');
  b = await bar();
  ok('H22 İptal düğmesi sırayı bitirir, "İptal edildi", istem boşa döner', !b.seq && /İptal edildi/.test(await toast()) && /Komut/.test(b.text), JSON.stringify({ b, t: await toast() }));
  await temizle(); await yaz('-la'); await gir(); await yaz('OFF'); await gir(); await yaz('YOKBOYLE'); await gir();
  ok('H23 olmayan katman adı: "Katman bulunamadı: YOKBOYLE"', /Katman bulunamadı: YOKBOYLE/.test(await toast()) && !(await bar()).seq, await toast());
  await temizle(); await yaz('-la'); await gir(); await yaz('OFF'); await gir(); await yaz(`KAT_X,${info.adlar.find(a => a !== '0' && a !== 'KAT_X' && !/["\\]/.test(a))}`); await gir();
  const u1 = await undoN();
  const ikisi = await ev((n) => [...window.dwgApp.state.layers.values()].filter(l => l.off).map(l => l.name).sort().join(','), null);
  ok('H24 virgülle iki katman birden kapatıldı', ikisi.split(',').length === 2 && ikisi.includes('KAT_X'), ikisi);
  await undo();
  ok('H25 -LAYER OFF tek geri alma adımıyla döner', (await undoN()) === u1 - 1 && (await ev(() => [...window.dwgApp.state.layers.values()].every(l => !l.off))));
  await temizle(); await yaz('-la'); await gir(); await yaz('M'); await gir(); await yaz('KAT_M'); await gir();
  ok('H26 M: yeni katman oluşturup geçerli yapar', !!(await durum('KAT_M')) && (await ev(() => window.dwgApp.editor.curLayer)) === 'KAT_M');
  await temizle(); await yaz('-la'); await gir(); await yaz('?'); await gir();
  const liste = await ev(() => ({ acik: !document.getElementById('docPanel').hidden, baslik: document.getElementById('docTitle').textContent, n: document.querySelectorAll('#docBody table.cmd-list tr').length, m: window.dwgApp.state.layers.size }));
  ok('H27 ?: katman listesi metin olarak (AutoCAD -LAYER ? gibi)', liste.acik && liste.baslik === 'Katmanlar' && liste.n === liste.m && !(await bar()).seq, JSON.stringify(liste));
  await ev(() => window.dwgApp.onBack());
  await yaz('LA'); await gir();
  ok('H28 tiresiz LA yöneticiyi (paneli) açar', (await panel()).acik);
  await ev(() => window.dwgApp.onBack());
}

// ---------------------------------------------------------------------------------
// I) Geçerli katman kutusunda "Katman yöneticisi" düğmesi
// ---------------------------------------------------------------------------------
{
  await ev(() => window.dwgApp.editor.act('layer')); await bekle();
  const k = await ev(() => { const b = document.getElementById('eLayerMgr'); return { var: !!b, metin: b ? b.textContent.trim() : '' }; });
  ok('I1 kutuda "Katman yöneticisi" düğmesi', k.var && k.metin === 'Katman yöneticisi', JSON.stringify(k));
  await klik('#eLayerMgr');
  ok('I2 düğme paneli açar, kutu kapanır', (await panel()).acik && (await ev(() => document.getElementById('docPanel').hidden)));
}

// ---------------------------------------------------------------------------------
// J) DXF: kapalı / donuk / kilitli katman dosyaya yazılır (kalıcı durum)
// ---------------------------------------------------------------------------------
{
  await ev(() => { window.dwgApp.editor.runCmd({ op: 'layerbulk', items: [{ name: 'KAT_X', off: true, frozen: true, locked: true }] }); });
  const r = await ev(async () => {
    const S = window.dwgApp.state, E = await import('./edit.js');
    const sat = E.writeDxf(S.prims, S.layers, { ltypes: S.ltypes }).split(/\r?\n/);
    let f70 = null, f62 = null;
    for (let k = 0; k + 1 < sat.length; k++) if (sat[k].trim() === '2' && sat[k + 1].trim() === 'KAT_X') {
      for (let j = k; j < Math.min(k + 12, sat.length - 1); j++) { if (sat[j].trim() === '70' && f70 == null) f70 = Number(sat[j + 1]); if (sat[j].trim() === '62' && f62 == null) f62 = Number(sat[j + 1]); }
    }
    return { f70, f62 };
  });
  ok('J1 LAYER 70 = 1|4 = 5 (donuk + kilitli), 62 negatif (kapalı)', r.f70 === 5 && r.f62 < 0, JSON.stringify(r));
  await undo();
}

// ---------------------------------------------------------------------------------
// K) İngilizce arayüz: hücre başlıkları ve istemler çevrili
// ---------------------------------------------------------------------------------
{
  await dil('en'); await bekle(200);
  await ev(() => window.dwgApp.onBack()); await klik('#btnLayers');
  const r = await satir('KAT_X');
  const head = await ev(() => { const h = document.querySelector('#layerList .lhead'); return [h.querySelector('.lc-cur').textContent, h.querySelector('.lc-name').textContent, ...[...h.querySelectorAll('.lctl > span')].map(x => x.title || x.textContent.trim()), h.querySelector('.lc-ct').textContent].join(','); });
  ok('K1 EN: On / Freeze / Lock başlıkları, sütun başlığı İngilizce', !!r && r.on.title === 'On' && r.frz.title === 'Freeze' && r.lock.title === 'Lock' && head === 'Status,Layer,On,Freeze,Lock,Color,Linetype,Lineweight,Count', JSON.stringify({ on: r && r.on.title, head }));
  await ev(() => window.dwgApp.onBack());
  await temizle(); await yaz('-la'); await gir();
  ok('K2 EN: -LAYER istemi AutoCAD\'in kendi metni', /^Enter an option \[\?\/Make\/Set\/New\/Rename\/ON\/OFF\/Color\/Ltype\/LWeight\/Freeze\/Thaw\/LOck\/Unlock\]:$/.test((await bar()).text), (await bar()).text);
  await klik('#cmdBtns [data-cmdseq="cancel"]');
  await dil('tr'); await bekle(200);
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
