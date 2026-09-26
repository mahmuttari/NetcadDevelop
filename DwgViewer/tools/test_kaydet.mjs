// Kaydet / Farklı kaydet (v8.9.8). Kullanıcı isteği: "Kaydeti ve farklı kaydeti bulamadım. Mantıklı bir şekilde ekleyelim."
//   1  bulunurluk: "⋯" menüsünde Ana ekran'ın hemen altında Kaydet + Farklı kaydet; şeritte ayrı "Dosya" grubu;
//      durum çubuğunda disket düğmesi (çizim düzenlenince çıkar); Ctrl+S / Ctrl+Shift+S
//   2  kaydedilmemiş değişiklik göstergesi: dosya adında ve disket düğmesinde nokta; kayıtla söner, yeni düzenleme / geri
//      almayla yanar
//   3  Android: ilk Kaydet İndirilenler/DWGViewer'a YENİ dosya açar (paylaşım penceresi yok), sonraki Kaydet'ler AYNI
//      dosyanın üstüne yazar (kopya çoğalmaz); hedef silinmişse aynı adla yeniden açar
//   4  Farklı kaydet: ad + konum + kapsam; "Başka bir konum seç…" Android seçicisini açar, seçilen belge Kaydet'in yeni
//      hedefi olur; vazgeçmek hiçbir şeyi değiştirmez; "Yalnız değişiklikler" hedefi değiştirmez
//   5  uygulama kapanıp çizim yeniden açılınca: hedef ve kaydedilmiş hâl hatırlanır
//   6  tarayıcı: Kaydet indirir (çizimin adı + .dxf)
// Kullanım: node tools/test_kaydet.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const J = JSON.stringify;
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, acceptDownloads: true });
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
const ev = (fn, a) => page.evaluate(fn, a);
const bekle = (ms = 150) => page.waitForTimeout(ms);
const FILE = `${SM}/example_2000.dwg`;
await openFile(page, FILE, { settle: 400 });
const temizDepo = () => ev(() => { const k = window.dwgApp.state.fileKey; for (const p of ['edits:', 'saveTarget:', 'dimsty:']) localStorage.removeItem(p + k); });
await temizDepo();
await openFile(page, FILE, { settle: 400 });   // temiz günlükle yeniden
await ev(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });

/** Sahte Android köprüsü: yalnız kayıt yöntemleri; çağrılar window.__kay'a yazılır */
const kopruKur = (o = {}) => ev((o) => {
  window.__kay = [];
  let n = 0;
  window.Android = {
    // MediaStore gibi: aynı ad varsa "ad (1).dxf" verir ve GERÇEK adı döndürür
    canSaveDownloads: () => window.__dl !== false,
    saveNew: (b64, name, mime) => {
      n++; const txt = atob(b64); window.__dosyalar = window.__dosyalar || [];
      let ad = name; for (let k = 1; window.__dosyalar.includes(ad); k++) ad = name.replace(/\.dxf$/i, '') + ' (' + k + ').dxf';
      window.__dosyalar.push(ad);
      window.__kay.push(['new', name, mime, txt.length, /SECTION/.test(txt.slice(0, 200)), txt.includes('AC1015'), ad]);
      return o.newFail ? '' : JSON.stringify({ uri: 'content://media/external/downloads/' + (100 + n), name: ad, dir: 'dl', where: 'DWGViewer/' + ad });
    },
    saveOver: (b64, uri) => { const txt = atob(b64); window.__kay.push(['over', uri, txt.length]); window.__sonYazilan = txt; return window.__overCevap || 'ok'; },
    saveAsPick: (id, b64, name, mime) => { window.__kay.push(['pick', name, mime, atob(b64).length]); const cev = window.__pickCevap || { ok: true, info: JSON.stringify({ uri: 'content://com.android.externalstorage.documents/document/primary%3AProje%2F' + encodeURIComponent(name), name, where: name }) }; setTimeout(() => window.dwgApp.onSaveAs(id, cev.ok, cev.info), 60); },
    shareUri: (uri, mime) => { window.__kay.push(['share', uri, mime]); },
    saveFile: (...a) => { window.__kay.push(['saveFile-ESKI', a[1], a[3]]); return 'x'; },
  };
}, o);
const kopruKaldir = () => ev(() => { delete window.Android; delete window.__overCevap; delete window.__pickCevap; delete window.__dl; });
const kay = () => ev(() => (window.__kay || []).slice());
const durum = () => ev(() => {
  const E = window.dwgApp.editor, q = document.querySelector('#stQuick [data-quick="save"]');
  return { ...E.saveState(), fnDot: document.getElementById('fileName').classList.contains('unsaved'), qGor: !!q && !q.hidden, qDot: !!q && q.classList.contains('unsaved'),
    toast: (document.getElementById('toast') || {}).textContent || '' };
});
const duzenle = (x = 0) => ev((x) => { window.dwgApp.editor.addEnts([{ type: 'LINE', pts: [[x, 0, 0], [x + 100, 50, 0]], layer: '0', color: 1 }]); }, x);
const menudenSec = async (act) => { await ev(() => { document.getElementById('toast').hidden = true; }); await page.click('#btnMore'); await bekle(120); await page.click(`#moreMenu [data-act="${act}"]`); await bekle(300); };
const tus = async (key) => { await ev(() => { document.getElementById('toast').hidden = true; document.activeElement && document.activeElement.blur && document.activeElement.blur(); }); await page.keyboard.press(key); await bekle(300); };
const formAcik = () => ev(() => { const d = document.getElementById('askDlg'); return !!d && !d.hidden ? { baslik: document.getElementById('askLabel').textContent, alanlar: [...document.querySelectorAll('#askField [id^="askF_"]')].map(e => e.id.slice(5)), ad: (document.getElementById('askF_ad') || {}).value, yer: [...document.querySelectorAll('#askF_yer option')].map(o => o.value), ipucu: (document.querySelector('.ask-hint') || {}).textContent || '' } : null; });

// ---- 1. bulunurluk ------------------------------------------------------------------------------------------------------
{
  const m = await ev(() => { const b = [...document.querySelectorAll('#moreMenu [data-act]')].map(x => x.dataset.act); return { sira: b, save: b.indexOf('save'), saveas: b.indexOf('saveas'), home: b.indexOf('home'), etiket: [...document.querySelectorAll('#moreMenu [data-act="save"] span, #moreMenu [data-act="saveas"] span')].map(s => s.textContent) }; });
  ok('1a "⋯" menüsünde Kaydet ve Farklı kaydet, Ana ekran\'ın hemen altında', m.save === m.home + 1 && m.saveas === m.save + 1 && J(m.etiket) === J(['Kaydet', 'Farklı kaydet']), J(m));
  const r = await ev(() => { document.querySelector('#toolbar [data-tab="view"]').click(); const cap = [...document.querySelectorAll('.tb-row[data-for="view"] .tb-caption')].map(e => e.textContent); const sv = document.querySelector('#toolbar [data-act="save"]'), sa = document.querySelector('#toolbar [data-act="saveas"]'); return { cap, sv: !!sv, sa: !!sa, ayniGrup: !!(sv && sa && sv.parentElement === sa.parentElement), pdfAyri: !!(sv && document.querySelector('#toolbar [data-act="pdf"]') && document.querySelector('#toolbar [data-act="pdf"]').parentElement !== sv.parentElement) }; });
  ok('1b şeritte Kaydet ve Farklı kaydet kendi "Dosya" grubunda (Dışa aktar\'dan ayrı)', r.sv && r.sa && r.ayniGrup && r.pdfAyri && r.cap.includes('Dosya'), J(r));
  const d0 = await durum();
  ok('1c düzenleme yokken: disket düğmesi gizli, nokta yok, kaydedilmemiş değil', !d0.qGor && !d0.fnDot && !d0.unsaved, J(d0));
}

// ---- 2-3. Android: ilk kayıt yeni dosya, sonrakiler üstüne ------------------------------------------------------------------
await kopruKur();
await duzenle(0);
{
  const d = await durum();
  ok('2a düzenlemeden sonra: disket düğmesi görünür ve noktalı, dosya adında nokta', d.qGor && d.qDot && d.fnDot && d.unsaved, J(d));
  await menudenSec('save');
  const k = await kay(), d2 = await durum();
  ok('3a menüden Kaydet: İndirilenler/DWGViewer\'a YENİ dosya "example_2000.dxf" (DXF, AC1015); eski paylaşımlı yol çağrılmadı, paylaşım penceresi açılmadı', k.length === 1 && k[0][0] === 'new' && k[0][1] === 'example_2000.dxf' && k[0][2] === 'application/dxf' && k[0][4] && k[0][5], J(k));
  ok('3b kayıttan sonra: nokta söndü, hedef hatırlandı, ileti yeri (arayüz dilinde) ve DWG → DXF notunu söyler', !d2.unsaved && !d2.fnDot && !d2.qDot && d2.qGor && d2.hedef && d2.hedef.uri === 'content://media/external/downloads/101' && d2.hedef.dir === 'dl' && /Kaydedildi: İndirilenler › DWGViewer › example_2000\.dxf/.test(d2.toast) && /DWG yazılamadığı için DXF/.test(d2.toast), J(d2));
  const pay = await ev(() => { const b = document.querySelector('#toast button.act:not([hidden])'); if (b) b.click(); return !!b; });
  await bekle(100);
  const k2 = await kay();
  ok('3c iletinin "Paylaş" eylemi kaydedilen dosyayı paylaşır (istenirse)', pay && k2.some(x => x[0] === 'share' && x[1] === 'content://media/external/downloads/101'), J(k2));
}
await duzenle(200);
await tus('Control+s');
{
  const k = await kay(), d = await durum();
  const over = k.filter(x => x[0] === 'over'), yeni = k.filter(x => x[0] === 'new');
  ok('3d ikinci kayıt (Ctrl+S): AYNI dosyanın üstüne yazar, yeni kopya açılmaz', over.length === 1 && over[0][1] === 'content://media/external/downloads/101' && yeni.length === 1 && !d.unsaved, J(k));
}
await ev(() => { window.dwgApp.editor.act('undo'); });
{
  const d = await durum();
  ok('2b kayıttan sonra geri almak da kaydedilmemiş değişikliktir (kayıtlı dosya ekrandakinden farklı)', d.unsaved && d.fnDot && d.qDot, J(d));
}
await ev(() => { window.__overCevap = 'fail'; window.__kay = []; });
await ev(() => window.dwgApp.editor.act('save')); await bekle(250);
{
  const k = await kay(), d = await durum();
  ok('3e yazma hatası (yer yok / G/Ç): hedef KORUNUR, yeni kopya açılmaz, kaydedilmemiş kalır, hata söylenir', k.length === 1 && k[0][0] === 'over' && d.hedef.uri === 'content://media/external/downloads/101' && d.unsaved && /kaydedilemedi/i.test(d.toast), J([k, d]));
}
await ev(() => { window.__overCevap = 'gone'; window.__kay = []; });
await ev(() => window.dwgApp.editor.act('save')); await bekle(250);
{
  const k = await kay(), d = await durum();
  ok('3f hedef yoksa (silinmiş / izin düşmüş) aynı adla yeni dosya açılır; ad çakışınca GERÇEK ad ("(1)") söylenir ve hatırlanır', k.length === 2 && k[0][0] === 'over' && k[1][0] === 'new' && k[1][1] === 'example_2000.dxf' && k[1][6] === 'example_2000 (1).dxf' && d.hedef.uri === 'content://media/external/downloads/102' && d.hedef.name === 'example_2000 (1).dxf' && /example_2000 \(1\)\.dxf/.test(d.toast) && !d.unsaved, J([k, d]));
}
await ev(() => { delete window.__overCevap; window.__kay = []; });
// Farklı kaydet, İndirilenler, şu anki hedefin adıyla: "(2)" kopyası açılmaz, hedefin üstüne yazılır
await duzenle(300);
await queueAnswers(page, { ad: 'example_2000 (1)', yer: 'dl', delta: false });
await ev(() => window.dwgApp.editor.act('saveas')); await bekle(350);
{
  const k = await kay(), d = await durum();
  ok('3g Farklı kaydet → İndirilenler, hedefle aynı ad: yeni kopya açılmaz, hedefin üstüne yazılır', k.length === 1 && k[0][0] === 'over' && k[0][1] === 'content://media/external/downloads/102' && !d.unsaved, J([k, d.hedef]));
}
await ev(() => { window.__kay = []; });

// ---- 4. Farklı kaydet ---------------------------------------------------------------------------------------------------
await duzenle(400);
await tus('Control+Shift+S');
{
  const f = await formAcik();
  ok('4a Ctrl+Shift+S "Farklı kaydet" kutusunu açar: ad (hedefin adı), konum (İndirilenler / başka konum), kapsam; ipucu özgün dosyanın değişmediğini söyler', f && f.baslik === 'Farklı kaydet' && f.ad === 'example_2000 (1)' && J(f.yer) === J(['dl', 'pick']) && f.alanlar.includes('delta') && /açtığınız dosya değişmez/.test(f.ipucu), J(f));
  await ev(() => { document.getElementById('askF_ad').value = 'Proje A'; const s = document.getElementById('askF_yer'); s.value = 'pick'; s.dispatchEvent(new Event('change')); });
  await page.click('#askOk'); await bekle(450);
  const k = await kay(), d = await durum();
  ok('4b "Başka bir konum seç…": Android seçicisi "Proje A.dxf" adıyla açıldı; seçilen belge Kaydet\'in yeni hedefi', k.length === 1 && k[0][0] === 'pick' && k[0][1] === 'Proje A.dxf' && d.hedef && /primary%3AProje%2FProje%20A\.dxf$/.test(d.hedef.uri) && d.hedef.name === 'Proje A.dxf' && !d.unsaved, J([k, d]));
}
await duzenle(600);
await ev(() => { window.__kay = []; }); await tus('Control+s');
{
  const k = await kay();
  ok('4c sonraki Kaydet seçilen belgenin üstüne yazar', k.length === 1 && k[0][0] === 'over' && /Proje%20A\.dxf$/.test(k[0][1]), J(k));
}
// vazgeçme
await duzenle(800);
await ev(() => { window.__kay = []; window.__pickCevap = { ok: false, info: 'cancel' }; });
await queueAnswers(page, { ad: 'Baska', yer: 'pick', delta: false });
await ev(() => window.dwgApp.editor.act('saveas')); await bekle(400);
{
  const d = await durum(), k = await kay();
  ok('4d seçicide vazgeçmek: hedef aynı kalır, kaydedilmemiş değişiklik sürer, hata iletisi çıkmaz', k.length === 1 && k[0][0] === 'pick' && /Proje%20A\.dxf$/.test(d.hedef.uri) && d.unsaved && !/kaydedilemedi/i.test(d.toast), J([k, d]));
}
await ev(() => { delete window.__pickCevap; window.__kay = []; });
// yalnız değişiklikler: hedef değişmez
await queueAnswers(page, { ad: 'degisiklikler', yer: 'dl', delta: true });
await ev(() => window.dwgApp.editor.act('saveas')); await bekle(400);
{
  const d = await durum(), k = await kay();
  ok('4e "Yalnız değişiklikler" ayrı dosya yazar ama Kaydet\'in hedefini ve kaydedilmemiş durumu değiştirmez', k.length === 1 && k[0][0] === 'new' && k[0][1] === 'degisiklikler.dxf' && /Proje%20A\.dxf$/.test(d.hedef.uri) && d.unsaved, J([k, d]));
}
await ev(() => { window.__kay = []; }); await ev(() => window.dwgApp.editor.act('save')); await bekle(250);

// ---- 5. yeniden açılış -----------------------------------------------------------------------------------------------------
{
  const once = await durum();
  await openFile(page, `${SM}/pface_full.dxf`, { settle: 300 });
  const baska = await durum();
  await openFile(page, FILE, { settle: 400 });
  const d = await durum();
  ok('5a başka çizimde bu çizimin hedefi yok, nokta yok', !baska.hedef && !baska.unsaved && !baska.fnDot, J(baska));
  ok('5b çizim yeniden açılınca (düzenlemeler günlükten geri gelir) hedef hatırlanır, kaydedilmiş hâl "kaydedilmemiş" görünmez', !once.unsaved && d.hedef && /Proje%20A\.dxf$/.test(d.hedef.uri) && !d.unsaved && d.qGor && !d.qDot && !d.fnDot, J([once, d]));
  await duzenle(1000);
  await ev(() => { window.__kay = []; }); await tus('Control+s');
  const k = await kay();
  ok('5c yeniden açılıştan sonra Kaydet yine aynı belgeye yazar', k.length === 1 && k[0][0] === 'over' && /Proje%20A\.dxf$/.test(k[0][1]), J(k));
}
// Kaydet → hepsini geri al → yeniden aç: kayıtlı dosya ekrandakinden farklı → kaydedilmemiş
{
  await ev(() => { window.__kay = []; }); await tus('Control+s');
  await ev(() => window.dwgApp.editor.act('undo')); await bekle(100);
  const once = await durum();
  await openFile(page, `${SM}/pface_full.dxf`, { settle: 300 });
  await openFile(page, FILE, { settle: 400 });
  const d = await durum();
  ok('5d kayıttan sonra geri alınıp kapanan çizim yeniden açılınca da "kaydedilmemiş" (kayıtlı dosya farklı)', once.unsaved && d.unsaved && d.fnDot && d.qDot, J([once, d]));
}
// GEOMETRİ: günlük yeniden oynatılınca çizim kaymamalı (ekle + taşı; ekle + taşı + geri al) ve kaydedilmiş hâl doğru olmalı
{
  await temizDepo();
  await openFile(page, FILE, { settle: 400 });
  const kur = await ev(() => {
    const E = window.dwgApp.editor;
    E.runCmd({ op: 'add', ents: [{ type: 'LINE', id: 'geoA', pts: [[5000, 5000, 0], [5010, 5000, 0]], layer: '0', color: 1 }] });
    E.runCmd({ op: 'xform', keys: ['geoA'], m: [1, 0, 0, 1, 100, 0], dz: 0 });
    E.runCmd({ op: 'add', ents: [{ type: 'LINE', id: 'geoB', pts: [[6000, 5000, 0], [6010, 5000, 0]], layer: '0', color: 1 }] });
    E.runCmd({ op: 'xform', keys: ['geoB'], m: [1, 0, 0, 1, 100, 0], dz: 0 });
    E.act('undo');
    const x = (k) => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.key === k); return p ? Math.round(Math.min(...p.ops.map(o => o[1]))) : null; };
    return [x('geoA'), x('geoB')];
  });
  await ev(() => { window.__kay = []; }); await tus('Control+s');
  const yazilan = await ev(() => { const k = window.__kay.find(x => x[0] === 'new' || x[0] === 'over'); return k ? k[0] : null; });
  const gor = async () => ev(() => { const x = (k) => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.key === k); return p ? Math.round(Math.min(...p.ops.map(o => o[1]))) : null; }; return [x('geoA'), x('geoB')]; });
  await openFile(page, `${SM}/pface_full.dxf`, { settle: 300 });
  await openFile(page, FILE, { settle: 400 });
  const r1 = await gor(), d1 = await durum();
  await openFile(page, `${SM}/pface_full.dxf`, { settle: 300 });
  await openFile(page, FILE, { settle: 400 });
  const r2 = await gor();
  ok('5e günlük değişmez: "ekle + taşı" yeniden açılışta 5100\'de (5200 değil), "ekle + taşı + geri al" 6000\'de; ikinci açılışta da aynı; kaydedilmiş görünür', J(kur) === J([5100, 6000]) && J(r1) === J([5100, 6000]) && J(r2) === J([5100, 6000]) && !!yazilan && !d1.unsaved, J({ kur, r1, r2, yazilan, d1 }));
}
// Ctrl+S komut satırı odaktayken; belge (PDF) önündeyken
{
  await duzenle(7000);
  await ev(() => { window.__kay = []; const c = document.getElementById('cmdInput'); if (c) { c.hidden = false; c.focus(); } });
  const odak = await ev(() => document.activeElement && document.activeElement.id);
  await page.keyboard.press('Control+s'); await bekle(300);
  const k = await kay();
  ok('5f komut satırı odaktayken Ctrl+S kaydeder', odak === 'cmdInput' && k.some(x => x[0] === 'new' || x[0] === 'over'), J([odak, k]));
  await ev(() => { window.__kay = []; document.body.classList.add('docmode'); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  await page.keyboard.press('Control+s'); await bekle(250);
  const k2 = await kay();
  await ev(() => { document.body.classList.remove('docmode'); });
  ok('5g belge (PDF / Word) önündeyken Ctrl+S arkadaki çizimi kaydetmez', k2.length === 0, J(k2));
}
// Android 9 ve öncesi: İndirilenler yok → ilk Kaydet seçiciyi açar; Farklı kaydet'te konum sorulmaz
{
  await temizDepo();
  await openFile(page, FILE, { settle: 400 });
  await ev(() => { window.__dl = false; window.__kay = []; });
  await duzenle(0);
  await tus('Control+s'); await bekle(250);
  const k = await kay(), d = await durum();
  ok('5h Android 9 ve öncesi: ilk Kaydet konum seçicisini açar, seçilen belge hedef olur', k.length === 1 && k[0][0] === 'pick' && k[0][1] === 'example_2000.dxf' && d.hedef && /primary%3AProje/.test(d.hedef.uri) && !d.unsaved, J([k, d]));
  await ev(() => window.dwgApp.editor.act('saveas')); await bekle(250);
  const f = await formAcik();
  await ev(() => { const b = document.getElementById('askNo'); if (b) b.click(); }); await bekle(200);
  ok('5i Android 9 ve öncesi: Farklı kaydet kutusunda konum seçeneği yok (tek yol seçici)', f && !f.alanlar.includes('yer') && f.alanlar.includes('ad'), J(f));
  await ev(() => { delete window.__dl; });
}
// seçici açıkken sayfa yeniden yüklenmiş: bekleyeni olmayan dönüş en azından söylenir
{
  await ev(() => { document.getElementById('toast').hidden = true; window.dwgApp.onSaveAs('yok-99', true, JSON.stringify({ uri: 'content://x/1', name: 'Kurtarilan.dxf' })); });
  await bekle(150);
  const d = await durum();
  ok('5j bekleyeni olmayan seçici dönüşü (sayfa yeniden yüklenmiş) kullanıcıya söylenir', /Kaydedildi: Kurtarilan\.dxf/.test(d.toast), d.toast);
}
await page.screenshot({ path: `${out}/kaydet_android.png` });

// ---- 6. tarayıcı: indirme ------------------------------------------------------------------------------------------------
await kopruKaldir();
await temizDepo();
await openFile(page, FILE, { settle: 400 });
await duzenle(0);
{
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await menudenSec('save');
  let ad = null; try { ad = (await dl).suggestedFilename(); } catch (_) { ad = null; }
  const d = await durum();
  ok('6a tarayıcıda Kaydet çizimin adıyla DXF indirir; indirmenin iptal edilip edilmediği bilinemediği için "kaydedildi" SAYILMAZ, hedef tutulmaz', ad === 'example_2000.dxf' && d.unsaved && !d.hedef, J([ad, d]));
  const f = await (async () => { await ev(() => window.dwgApp.editor.act('saveas')); await bekle(250); const x = await formAcik(); await ev(() => { const b = document.getElementById('askNo'); if (b) b.click(); }); await bekle(200); return x; })();
  ok('6b tarayıcıda Farklı kaydet kutusunda konum seçimi yok (yalnız ad ve kapsam)', f && !f.alanlar.includes('yer') && f.alanlar.includes('ad') && f.alanlar.includes('delta'), J(f));
}

C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
