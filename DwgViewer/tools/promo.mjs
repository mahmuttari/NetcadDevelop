/*
 * DWG OfficeZip — TANITIM VİDEOSU ÇEKİMİ
 *
 * Videoda görünen her şey uygulamanın kendisidir: çizim gerçek bir proje dosyası
 * (MARFEN_YUZER_TERFI_2D.dwg, 7,75 MB · 132.274 varlık), ölçüler uygulamanın kendi hesabı,
 * sayılar uygulamanın kendi yazdığı satırlar. Hiçbir ekran görüntüsü elle düzenlenmedi.
 *
 * Kayıt kare karedir (bkz. hat.mjs): durağan görüntüler tek kare alınıp çoğaltılır, hareketli
 * olanlar gerçekten yakalanır. YÜKLEME sahnesi ayrıdır — orada kareler GERÇEK ZAMANA göre
 * yazılır, yoksa video dosyanın gerçekte açıldığından hızlı açıldığını ima ederdi.
 */
import { startServer, launchBrowser, PHONE, noUpdate } from './harness.mjs';
import { hatKur, cekim, yumusak, FPS } from './promo_hat.mjs';
import fs from 'node:fs';
import path from 'node:path';

const KOK = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCRATCH = path.dirname(new URL(import.meta.url).pathname);
const FFMPEG = process.env.FFMPEG || path.join(SCRATCH, '../ff/node_modules/ffmpeg-static/ffmpeg');
const OUT = path.resolve(process.argv[2] || './cikti');
const SADECE = process.argv[3] ? process.argv[3].split(',').map(Number) : null;   // yalnız bu sahneler
fs.mkdirSync(OUT, { recursive: true });
const KAPLAMA = fs.readFileSync(path.join(SCRATCH, 'promo_kaplama.js'), 'utf8');

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, permissions: ['geolocation'], geolocation: { latitude: 40.7654, longitude: 29.9408 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 160)));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

const hat = hatKur(FFMPEG, path.join(OUT, 'promo_ham.mp4'));
const C = cekim(page, hat);
const ev = (fn, a) => page.evaluate(fn, a);
const K = {
  altMetin: (tr, en, yer) => ev(([a, b, c]) => window.__promo.altMetin(a, b, c), [tr, en || '', yer || 'alt']),
  alt: (p) => ev((x) => window.__promo.alt(x), p),
  kartMetin: (h) => ev((x) => window.__promo.kartMetin(x), h),
  kart: (p) => ev((x) => window.__promo.kart(x), p),
  rozetMetin: (h) => ev((x) => window.__promo.rozetMetin(x), h),
  rozet: (p) => ev((x) => window.__promo.rozet(x), p),
  karart: (p) => ev((x) => window.__promo.karart(x), p),
  halka: (x, y, p) => ev(([a, b, c]) => window.__promo.halka(a, b, c), [x, y, p]),
  nokta: (x, y) => ev(([a, b]) => window.__promo.nokta(a, b), [x, y]),
};
const enjekte = () => page.evaluate(KAPLAMA);
const sessiz = () => ev(() => { for (const id of ['toast', 'tour']) { const e = document.getElementById(id); if (e) e.hidden = true; } });

// --- altyazı ------------------------------------------------------------------------------
async function altyaziAc(tr, en, yer) { await K.altMetin(tr, en, yer); await C.hareket(0.30, (t) => K.alt(yumusak(t))); }
async function altyaziKapat() { await C.hareket(0.24, (t) => K.alt(1 - yumusak(t))); }
async function altyaziDegis(tr, en, yer) { await altyaziKapat(); await altyaziAc(tr, en, yer); }

// --- dokunuş ------------------------------------------------------------------------------
const olay = (tip, x, y, id = 3) => ev(([t, a, b, i]) => {
  const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
  vp.dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', isPrimary: i === 3 || i === 11, bubbles: true, cancelable: true, clientX: r.left + a, clientY: r.top + b, button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerdown' || t === 'pointermove' ? 1 : 0 }));
}, [tip, x, y, id]);

/** Tuvale dokunuş: halka büyür, dokunuş gerçekten gönderilir */
async function dokun(x, y, sonra = 0.5) {
  await C.hareket(0.20, async (t) => { await K.halka(x, y, t * 0.5); if (t > 0.9) { await olay('pointerdown', x, y); await olay('pointerup', x, y); } });
  await C.hareket(0.26, (t) => K.halka(x, y, 0.5 + t * 0.5));
  await K.halka(0, 0, null);
  if (sonra) await C.tut(sonra);
}
/** Arayüz düğmesine dokunuş (seçici ile) */
async function dugme(sec, sonra = 0.6) {
  const el = page.locator(sec).first();
  const kutu = await el.boundingBox();
  if (kutu) {
    const x = kutu.x + kutu.width / 2, y = kutu.y + kutu.height / 2;
    await C.hareket(0.18, (t) => K.halka(x, y, t * 0.5));
    await el.click({ force: true }).catch(() => {});
    await C.hareket(0.24, (t) => K.halka(x, y, 0.5 + t * 0.5));
    await K.halka(0, 0, null);
  } else { await el.click({ force: true }).catch(() => {}); }
  if (sonra) await C.tut(sonra);
}
/** Görünümü yumuşakça kaydır / yakınlaştır (uygulamanın kendi durumundan) */
async function gorunum(sn, hedef) {
  const bas = await ev(() => ({ ...window.dwgApp.state.view }));
  await C.hareket(sn, (t) => ev(([b, h, e]) => {
    const A = window.dwgApp, v = A.state.view;
    v.scale = b.scale * Math.pow(h.scale / b.scale, e);
    v.cx = b.cx + (h.cx - b.cx) * e; v.cy = b.cy + (h.cy - b.cy) * e;
    A.render();
  }, [bas, { scale: hedef.scale == null ? bas.scale : hedef.scale, cx: hedef.cx == null ? bas.cx : hedef.cx, cy: hedef.cy == null ? bas.cy : hedef.cy }, yumusak(t)]));
}
/** Gerçek zamanlı bekleme: kareler geçen SÜREYE göre yazılır (hız yanılsaması olmasın) */
async function gercekBekle(bitti, enCok = 60000) {
  const t0 = Date.now(); const kareler = [];
  for (;;) {
    const t = Date.now() - t0;
    const b = await page.screenshot({ type: 'jpeg', quality: 92 });
    kareler.push({ t, b });
    if (await bitti().catch(() => false)) break;
    if (t > enCok) break;
  }
  const son = Date.now() - t0;
  for (let i = 0; i < kareler.length; i++) {
    const bit = i + 1 < kareler.length ? kareler[i + 1].t : son;
    const n = Math.max(1, Math.round((bit - kareler[i].t) / 1000 * FPS));
    for (let j = 0; j < n; j++) await hat.yaz(kareler[i].b);
  }
  return son;
}

/*
 * HIZLANDIRILMIŞ BEKLEME. Bazı işler gerçekten uzun sürer (bu makinede A3 · 150 dpi PDF üretimi
 * ~48 sn). Videoda bunu gerçek süresiyle göstermek izlenemez, kesip atmak ise işin hızlı
 * olduğunu ima eder. İkisi de yapılmaz: kareler sıkıştırılır ve ekranda "hızlandırıldı" rozeti
 * durur — izleyici beklendiğini görür, ne kadar beklendiğini de rozet söyler.
 */
async function hizliBekle(bitti, hedefSn, enCok = 120000) {
  const t0 = Date.now(); const kareler = []; let rozetAcik = false;
  for (;;) {
    // Rozet ancak gerçek bekleme video süresini AŞTIĞINDA yakılır: iş kısa sürdüyse ortada
    // sıkıştırma yoktur ve "hızlandırıldı" demek ters yönde yanıltır.
    if (!rozetAcik && Date.now() - t0 > hedefSn * 1000) { await K.rozetMetin('<b>⏩</b> hızlandırıldı'); await K.rozet(1); rozetAcik = true; }
    const b = await page.screenshot({ type: 'jpeg', quality: 92 });
    kareler.push(b);
    if (await bitti().catch(() => false)) break;
    if (Date.now() - t0 > enCok) break;
  }
  const gecen = (Date.now() - t0) / 1000;
  const toplam = Math.max(1, Math.round(hedefSn * FPS));
  for (let i = 0; i < toplam; i++) await hat.yaz(kareler[Math.min(kareler.length - 1, Math.floor(i / toplam * kareler.length))]);
  if (rozetAcik) await K.rozet(0);
  console.log('   gerçek süre:', gecen.toFixed(1), 'sn ->', hedefSn, 'sn', rozetAcik ? '(rozet yandı)' : '');
  return gecen;
}
/* Her sahne bilinen bir durumdan başlasın: açık araç, not çubuğu, panel ve menü kapanır */
async function temizDurum() {
  await ev(() => {
    const A = window.dwgApp, E = A.editor;
    if (E.tools && E.tools.running) E.tools.cancel();
    if (E.sel) E.sel.clear();
    const nc = document.getElementById('noteClose'); if (nc && !document.getElementById('notesBar').hidden) nc.click();
    // Belge görünümü açık kalırsa sonraki sahne ÇİZİMDE değil, belgenin üstünde oynar (görüldü):
    // tuval arkada çalışır, ekranda belge durur. Bu yüzden çizime dönmek temizliğin parçasıdır.
    const dv = document.getElementById('docView');
    if (dv && !dv.hidden) { const kapat = dv.querySelector('[data-doc="close"]'); if (kapat) kapat.click(); else dv.hidden = true; }
    for (const id of ['layerPanel', 'infoPanel', 'measurePanel', 'docPanel', 'searchPanel', 'displayPanel', 'drivePanel', 'moreMenu', 'proPanel', 'openPanel']) { const e = document.getElementById(id); if (e) e.hidden = true; }
    if (A.state.mode !== 'view') A.setMode('view');
    const t = document.getElementById('toast'); if (t) t.hidden = true;
    A.render();
  });
}
const MARKA = '<div class="mark">DWG <i>OfficeZip</i></div><div class="cizgi"></div>';
const yap = (n) => !SADECE || SADECE.includes(n);
const atlanan = [];
async function sahne(n, ad, fn) {
  if (!yap(n)) return;
  C.sahne(n + ' · ' + ad);
  try { await temizDurum(); await fn(); } catch (e) { atlanan.push(n + ' · ' + ad + ' — ' + e.message.slice(0, 120)); console.log('  ATLANDI:', e.message.slice(0, 160)); }
}

// ============================================================================================
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true }, reduceMotion: true })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(700);
await enjekte(); await sessiz();

await sahne(1, 'açılış kartı', async () => {
  await K.kartMetin(MARKA + '<div class="alt1">Pafta şantiyeye gelir.<br>DWG ve DXF, telefonda, çevrimdışı.</div>');
  await K.kart(1);
  await C.tut(1.8);
  await C.hareket(0.45, (t) => K.kart(1 - yumusak(t)));
});

await sahne(2, 'ana ekran', async () => {
  await altyaziAc('Kurulumdan sonra tek ekran', 'One screen after install');
  await C.tut(1.2);
  await altyaziKapat();
});

await sahne(3, 'örnek çizim açılıyor (gerçek zamanlı)', async () => {
  await altyaziAc('7,75 MB · 132.274 varlık', '7.75 MB · 132,274 objects');
  const kart = page.locator('#sampleList > *').first();
  const kutu = await kart.boundingBox();
  if (kutu) { const x = kutu.x + kutu.width / 2, y = kutu.y + kutu.height / 2; await C.hareket(0.2, (t) => K.halka(x, y, t * 0.6)); }
  await ev(() => { const l = document.getElementById('sampleList'); const c = l && l.children[0]; if (c) (c.querySelector('button') || c).click(); });
  await K.halka(0, 0, null);
  const ms = await gercekBekle(() => ev(() => !!(window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden)), 90000);
  console.log('   yükleme gerçek süre:', ms, 'ms');
  await enjekte();
  await K.altMetin('7,75 MB · 132.274 varlık', '7.75 MB · 132,274 objects'); await K.alt(1);
  await C.tut(1.5);   // uygulamanın kendi bildirimi ekranda: dosya adı · varlık sayısı · süre
  await sessiz();
  await altyaziKapat();
});

await sahne(4, 'gezinme', async () => {
  await altyaziAc('132 bin nesne, takılmadan gezinir', '132k objects, no stutter');
  const v = await ev(() => ({ ...window.dwgApp.state.view }));
  await gorunum(1.4, { scale: v.scale * 3.4, cx: v.cx - 7, cy: v.cy + 5 });
  await C.tut(0.4);
  await gorunum(1.1, { cx: v.cx + 16, cy: v.cy + 11 });
  await C.tut(0.3);
  await altyaziKapat();
  await dugme('#navFabs [data-nav="fit"]', 0.9);
});

await sahne(5, 'katmanlar', async () => {
  // Önce yazı katmanı AÇIKken kadraj: fark görülsün diye yazıların olduğu bölgeye yaklaşılır
  const v = await ev(() => ({ ...window.dwgApp.state.view }));
  await gorunum(1.1, { scale: v.scale * 2.6, cx: v.cx - 4, cy: v.cy + 6 });
  await altyaziAc('6 katman · yazıları tek dokunuşla kaldır', '6 layers · hide the text layer');
  await C.tut(1.0);
  await altyaziKapat();
  await dugme('#btnLayers', 0.8);
  await dugme('[data-lon="S-Z2-A_TEXTUAL_ANNOTATION"]', 0.9);
  await dugme('#btnLayers', 0.5);
  await altyaziAc('11.080 yazı nesnesi ekrandan kalktı', '11,080 text objects hidden');
  await C.tut(1.3);
  await altyaziKapat();
  // geri aç: çizim bozulmuş kalmasın
  await ev(() => { const b = document.querySelector('[data-lon="S-Z2-A_TEXTUAL_ANNOTATION"]'); const p = document.getElementById('btnLayers'); if (p) p.click(); if (b) b.click(); if (p) p.click(); });
  await C.tut(0.2);
});

await sahne(6, 'ölçü', async () => {
  await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); window.dwgApp.setMode('measure'); });
  await C.tut(0.7);
  await altyaziAc('Uçtan uca ölçü — uca kendiliğinden oturur', 'End to end, snapped to the endpoint', 'ust');
  await dokun(110, 300, 0.7);
  await dokun(255, 395, 1.0);
  const okuma = await ev(() => document.getElementById('measureBody').textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
  console.log('   ölçüm:', okuma);
  await C.tut(1.2);
  await altyaziKapat();
  await ev(() => { const b = document.getElementById('btnMeasureClose'); if (b) b.click(); window.dwgApp.setMode('view'); });
  await C.tut(0.3);
});

await sahne(7, 'komut satırı', async () => {
  await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); });
  await altyaziAc('AutoCAD komutları: LINE, TR, F…', 'AutoCAD commands: LINE, TR, F…', 'ust');
  await page.click('#cmdInput');
  for (const h of 'LINE') { await page.type('#cmdInput', h, { delay: 0 }); await C.hareket(0.1, () => {}); }
  await C.tut(0.9);   // öneri listesi ekranda
  await page.press('#cmdInput', 'Enter');
  await C.tut(0.7);
  await dokun(120, 300, 0.5);
  await dokun(250, 400, 0.8);
  await ev(() => { const T = window.dwgApp.editor.tools; if (T.running) T.cancel(); });
  await C.tut(0.5);
  await altyaziKapat();
});

await sahne(8, 'notlar', async () => {
  await ev(() => { const b = document.getElementById('btnMore'); if (b) b.click(); });
  await C.tut(0.5);
  await dugme('#moreMenu [data-act="notes"]', 0.8);
  await altyaziAc('Kırmızı kalem notu; DWG değişmez', 'Redline notes; the DWG is untouched', 'ust');
  await C.tut(0.8);
  const ok = page.locator('#notesBar button').nth(3);
  if (await ok.count()) await dugme('#notesBar button:nth-child(4)', 0.5);
  // ok çiz: parmak sürüklenir
  await K.nokta(120, 250);
  await olay('pointerdown', 120, 250, 7);
  await C.hareket(0.7, async (t) => { const x = 120 + 110 * yumusak(t), y = 250 + 90 * yumusak(t); await K.nokta(x, y); await olay('pointermove', x, y, 7); });
  await olay('pointerup', 230, 340, 7);
  await K.nokta(null, null);
  await C.tut(1.2);
  await altyaziKapat();
  await ev(() => { const b = document.getElementById('noteClose'); if (b) b.click(); });
  await C.tut(0.3);
});

let uretilenPdf = null;
await sahne(9, 'ölçekli PDF', async () => {
  await ev(() => { const b = document.getElementById('btnMore'); if (b) b.click(); });
  await C.tut(0.4);
  await dugme('#moreMenu [data-act="pdf"]', 0.9);
  await altyaziAc('Ölçekli PDF: A3 · 1:500 · antet', 'Scaled PDF: A3 · 1:500 · title block', 'ust');
  await C.tut(0.7);
  await page.fill('#pScale', '500');
  await C.tut(0.8);
  /*
   * Tarayıcı yapısında üretilen PDF indirilir (telefonda uygulama onu kendi belge görünümünde
   * açar). İndirileni yakalayıp saklıyoruz: belgeler sahnesinde AÇILAN PDF, uygulamanın az önce
   * kendi ürettiği dosyadır — hazır bir örnek değil.
   */
  const inen = page.waitForEvent('download', { timeout: 180000 }).catch(() => null);
  let bitti = false; inen.then(() => { bitti = true; });
  await dugme('#pGo', 0);
  await hizliBekle(() => Promise.resolve(bitti), 2.4, 180000);
  await altyaziKapat();
  const d = await inen;
  if (d) { uretilenPdf = SCRATCH + '/dosya/uretilen_pafta.pdf'; await d.saveAs(uretilenPdf); console.log('   üretilen PDF:', uretilenPdf, fs.statSync(uretilenPdf).size, 'bayt'); }
  else console.log('   PDF indirilemedi');
  await C.tut(0.3);
});

await sahne(10, 'GPS', async () => {
  // Belge görünümü açıksa çizime dön (PDF sahnesinden sonra); ana ekrana GİTME
  await ev(() => { const d = document.getElementById('docView'); if (d && !d.hidden) { const b = d.querySelector('[data-doc="close"]'); if (b) b.click(); } });
  await C.tut(0.6);
  await dugme('#gpsBtn', 0.6);
  await hizliBekle(() => ev(() => !!(window.dwgApp.state.gps && window.dwgApp.state.gps.on)), 1.2, 15000);
  await enjekte(); await sessiz();
  await K.altMetin('Paftadaki yeriniz: GPS ile', 'Your spot on the sheet: GPS'); await K.alt(1);
  await C.tut(1.6);
  await altyaziKapat();
});

await sahne(11, 'belgeler', async () => {
  await altyaziAc('Adın ikinci yarısı: Office ve Zip', 'The other half of the name');
  await C.tut(1.0); await altyaziKapat();
  /*
   * Üretilen PDF burada AÇILMIYOR: tarayıcı yapısında belge görünümü PDF'i yerleşik eklentiyle
   * gösterir ve başsız Chromium'da o eklenti yoktur ("Couldn't load plugin"). Telefonda PDF
   * PdfRenderer ile çizilir ve sorunsuz açılır — ama videoda olmayan bir şey gösterilmez.
   */
  for (const [yol, tr, en] of ([
    [SCRATCH + '/dosya/teknik_rapor.docx', 'Word belgesi', 'Word documents'],
    [SCRATCH + '/dosya/kesif_ozeti.xlsx', 'Excel tablosu', 'Excel sheets'],
    [SCRATCH + '/dosya/proje_dosyalari.zip', 'ZIP ve RAR arşivi', 'ZIP and RAR archives'],
  ])) {
    await page.setInputFiles('#fileInput', yol);
    await gercekBekle(() => ev(() => { const d = document.getElementById('docView'); return !!(d && !d.hidden && document.getElementById('docContent').textContent.trim().length > 20); }), 30000);
    await enjekte(); await sessiz();
    await K.altMetin(tr, en, 'alt'); await K.alt(1);
    await C.tut(1.5);
    await C.hareket(0.2, (t) => K.alt(1 - t));
  }
});

await sahne(12, 'parmakla yakalama aparatı', async () => {
  await ev(() => { window.dwgApp.osnap.setModes(['end', 'mid', 'int', 'cen', 'per', 'nea']); window.dwgApp.editor.act('t:line'); });
  await C.tut(0.5);
  await altyaziAc('Parmak hedefi örtmesin: büyüteç ve ofset imleç', 'The finger never covers the target', 'ust');
  // uzun basış: imleç parmaktan ayrılır, büyüteç açılır
  const fx = 170, fy = 470;
  await K.nokta(fx, fy);
  await olay('pointerdown', fx, fy, 9);
  await C.tut(0.8);            // TOL.long = 500 ms: nişan kurulur
  await C.hareket(0.9, async (t) => {
    const x = fx + 34 * yumusak(t), y = fy - 26 * yumusak(t);
    await K.nokta(x, y); await olay('pointermove', x, y, 9);
  });
  await C.tut(1.0);
  const h = await ev(() => window.dwgApp.__pickbox().hover);
  console.log('   nişan:', JSON.stringify(h));
  await olay('pointerup', fx + 34, fy - 26, 9);
  await K.nokta(null, null);
  await C.tut(1.1);            // birden çok aday varsa çip seçici burada açılır
  const sp = await ev(() => { const e = document.getElementById('snapPick'); return e && !e.hidden ? e.querySelectorAll('[data-sp]').length : 0; });
  console.log('   aday çipi:', sp);
  await altyaziKapat();
  await ev(() => { const e = document.getElementById('snapPick'); const x = e && e.querySelector('[data-sp="x"]'); if (x) x.click(); const T = window.dwgApp.editor.tools; if (T.running) T.cancel(); });
  await C.tut(0.3);
});

await sahne(13, 'pencere / kesen seçim', async () => {
  /*
   * Örtük pencere BOŞ yerden sürükleyince açılır; kalabalık bir paftada boş yer bulmak şansa
   * kalır. Bu yüzden komut çubuğunun KUTU kipi açıkça seçiliyor — videoda gösterilen de zaten
   * o düğmedir.
   */
  await ev(() => { window.dwgApp.editor.act('t:select'); });
  await C.tut(0.4);
  await ev(() => { const T = window.dwgApp.editor.tools; if (T.setSelMode) T.setSelMode('box'); });
  await C.tut(0.4);
  await altyaziAc('Pencere / kesen kutuyla toplu seçim', 'Window / crossing box selection', 'ust');
  await K.nokta(60, 250);
  await olay('pointerdown', 60, 250, 8);
  await C.hareket(1.1, async (t) => {
    const x = 60 + 250 * yumusak(t), y = 250 + 230 * yumusak(t);
    await K.nokta(x, y); await olay('pointermove', x, y, 8);
  });
  await olay('pointerup', 310, 480, 8);
  await K.nokta(null, null);
  await C.tut(1.3);
  const n = await ev(() => { const b = document.getElementById('selBadge'); return { gizli: b.hidden, metin: b.textContent.trim().slice(0, 40), sec: window.dwgApp.editor.sel.size }; });
  console.log('   seçim:', JSON.stringify(n));
  await altyaziKapat();
  await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); if (E.tools.running) E.tools.cancel(); window.dwgApp.render(); });
  await C.tut(0.3);
});

await sahne(14, '3B tesis modeli', async () => {
  await altyaziAc('Aynı uygulama, 3B tesis modeli', 'The same app, in 3D');
  await ev(() => { const l = document.getElementById('sampleList'); const c = l && l.children[1]; if (c) (c.querySelector('button') || c).click(); });
  await hizliBekle(() => ev(() => !!(window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden && /3D/.test(document.getElementById('fileName').textContent))), 2.0, 180000);
  await enjekte(); await sessiz();
  await ev(() => window.dwgApp.editor.act('3d'));
  await hizliBekle(() => ev(() => { try { return window.dwgApp.editor.is3D() && window.dwgApp.editor.view3d().counts.tris > 0; } catch (e) { return false; } }), 1.6, 60000);
  await enjekte(); await sessiz();
  const c = await ev(() => window.dwgApp.editor.view3d().counts);
  console.log('   3B sayaçlar:', JSON.stringify(c));
  await K.altMetin('1,9 milyon üçgen · parmakla döner', '1.9M triangles, spun by finger'); await K.alt(1);
  // döner tabla: kendiliğinden dönen model
  await ev(() => { const v = window.dwgApp.editor.view3d(); v.set('turntable', true); });
  await C.hareket(3.2, () => {});
  await ev(() => { const v = window.dwgApp.editor.view3d(); v.set('turntable', false); });
  await altyaziDegis('Görsel stiller: gölgeli · gerçekçi · eskiz · röntgen', 'Visual styles: shaded, realistic, sketch, x-ray');
  for (const st of ['shaded', 'realistic', 'conceptual', 'sketchy', 'xray']) {
    await ev((x) => { const v = window.dwgApp.editor.view3d(); v.set('style', x); v.render(); }, st);
    await C.tut(0.85);
  }
  await altyaziDegis('Görünüm küpüyle tek dokunuşta cephe', 'One tap on the cube for a front view');
  await ev((x) => { const v = window.dwgApp.editor.view3d(); v.set('style', x); v.render(); }, 'shadedEdges');
  await dugme('#cube3d [data-face="front"]', 0.2);
  await C.hareket(1.2, () => {});
  await C.tut(0.8);
  await altyaziKapat();
});

// --- bitiş ----------------------------------------------------------------------------------
await sahne(90, 'kapanış', async () => {
  await C.hareket(0.4, (t) => K.karart(yumusak(t)));
  await K.kartMetin(MARKA + '<div class="alt1">Çizimi sahaya götürün.</div><div class="kucuk">Android · çevrimdışı çalışır<br>Açma, ölçü, katman ve GPS ücretsiz</div>');
  await K.kart(1); await K.karart(0);
  await C.tut(2.6);
});

const kare = await hat.bitir();
console.log('\nkare:', kare, '=', (kare / FPS).toFixed(1), 'sn ·', path.join(OUT, 'promo_ham.mp4'), fs.statSync(path.join(OUT, 'promo_ham.mp4')).size, 'bayt');
if (atlanan.length) console.log('ATLANAN SAHNELER:\n - ' + atlanan.join('\n - '));
await ctx.close(); await browser.close(); srv.kill();
