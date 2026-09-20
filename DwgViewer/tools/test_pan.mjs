/*
 * KAYDIR (PAN) TUŞU ve ŞERİT SİMGELERİNİN AYRILMASI — v7.96
 *
 * İki soru sınanır:
 *  1. Düzenle sekmesinin simgesi Seç karosununkinden ayrı mı (ikisi de i-select'ti), ve hiçbir
 *     iki sekme aynı simgeyi taşımıyor mu.
 *  2. Kaydır kipi: şerit karosu, ekrandaki FAB, PAN / P komutu, Esc ile çıkış. Kip açıkken
 *     sürükleme YALNIZ görünümü kaydırmalı — araç çalışırken bile seçim yapılmamalı; kip
 *     kapanınca eski davranış geri gelmeli. 3B'de kip yerine tek parmak ayarı çevrilmeli.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_pan.mjs
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
const J = JSON.stringify, bekle = (ms = 160) => page.waitForTimeout(ms);
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await bekle(150);
await openFile(page, `${samplesDir}/example_2000.dwg`, { settle: 400 });
await ev(() => { localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); document.getElementById('toast').hidden = true; });

const gorunum = () => ev(() => ({ cx: window.dwgApp.state.view.cx, cy: window.dwgApp.state.view.cy, scale: window.dwgApp.state.view.scale }));
const secim = () => ev(() => window.dwgApp.editor.sel.size);
const kip = () => ev(() => ({ mode: !!window.dwgApp.state.panMode, api: window.dwgApp.__pan() }));
const sekme = (id) => ev((x) => window.dwgApp.editor.openTab(x), id);
/** Sentetik dokunma sürüklemesi (test_secim ile aynı desen) */
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
const dokun = async (x, y) => drag([[x, y], [x, y]]);

// ---------------------------------------------------------------------------------
// 1 · Simgeler: Düzenle sekmesi artık Seç karosunun simgesini taşımıyor
// ---------------------------------------------------------------------------------
{
  const g = await ev(() => {
    const sekmeler = [...document.querySelectorAll('#toolbar [data-tab]')].map(b => {
      const u = b.querySelector('use');
      return { id: b.dataset.tab, icon: u ? (u.getAttribute('href') || '') : '' };
    });
    return {
      sekmeler,
      hand: !!document.getElementById('i-hand'),
      modify: !!document.getElementById('i-modify'),
      select: !!document.getElementById('i-select'),
    };
  });
  const edit = g.sekmeler.find(s => s.id === 'edit');
  const simgeler = g.sekmeler.map(s => s.icon);
  ok('1a yeni simgeler tanımlı: el (kaydır) ve anahtar (düzenle)', g.hand && g.modify && g.select, J({ hand: g.hand, modify: g.modify }));
  ok('1b Düzenle sekmesi artık #i-modify taşıyor (Seç karosunun #i-select\'i değil)', edit && edit.icon === '#i-modify', J(edit));
  ok('1c hiçbir iki sekme aynı simgeyi taşımıyor', new Set(simgeler).size === simgeler.length, J(simgeler));
}

// ---------------------------------------------------------------------------------
// 2 · Kaydır karosu Görünüm şeridinde, Seç karosu Düzenle şeridinde simgesini korudu
// ---------------------------------------------------------------------------------
{
  await sekme('view'); await bekle(150);
  const g = await ev(() => {
    const b = document.querySelector('#toolbar [data-act="pan"]');
    const u = b && b.querySelector('use'), lb = b && b.querySelector('.lb');
    const grup = b ? b.closest('.tb-group') : null;
    return b ? { var: true, icon: u ? u.getAttribute('href') : '', lb: lb ? lb.textContent.trim() : '', basili: b.getAttribute('aria-pressed'), kapali: b.disabled, grup: grup ? (grup.querySelector('.cap') || {}).textContent : '' } : { var: false };
  });
  ok('2a Kaydır karosu Görünüm şeridinde ve el simgesini taşıyor', g.var && g.icon === '#i-hand', J(g));
  ok('2b karo Türkçe "Kaydır" yazıyor ve belge açıkken etkin', g.lb === 'Kaydır' && g.kapali === false, J(g));
  await sekme('edit'); await bekle(150);
  const s = await ev(() => { const b = document.querySelector('#toolbar [data-act="t:select"]'); const u = b && b.querySelector('use'); return { var: !!b, icon: u ? u.getAttribute('href') : '' }; });
  ok('2c Seç karosu kendi simgesini KORUDU (değişen yalnız sekme başlığıydı)', s.var && s.icon === '#i-select', J(s));
  await sekme('view'); await bekle(120);
}

// ---------------------------------------------------------------------------------
// 3 · Komut tablosu: PAN artık bulunmayan değil, çalışan bir komut
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const A = await import('./acad.js');
    const p = A.resolve('P'), pan = A.resolve('pan'), rt = A.resolve('RTPAN'), tire = A.resolve('-pan');
    return { p: p && { id: p.id, avail: p.avail }, pan: pan && pan.id, rt: rt && rt.id, tire: tire && tire.id, cmd: A.cmdOf('pan'), adlar: A.namesOf('pan'), yinele: A.repeatable('pan'), hata: A.dogrula(), st: A.stats() };
  });
  ok('3a P ve PAN uygulamanın kaydır eylemine bağlı (AutoCAD kısaltması uydurulmadı)', g.p && g.p.id === 'pan' && g.p.avail !== false && g.pan === 'pan' && g.tire === 'pan', J(g));
  ok('3b RTPAN eşanlamlı olarak aynı eyleme gidiyor', g.rt === 'pan', J({ rt: g.rt }));
  ok('3c İngilizce etiket komut adından geliyor, kısaltmalar yazılıyor', g.cmd === 'PAN' && g.adlar === 'PAN (P, -PAN)', J({ cmd: g.cmd, adlar: g.adlar }));
  ok('3d açma/kapama komutu olduğu için boş Enter onu YİNELEMİYOR', g.yinele === false, String(g.yinele));
  ok('3e tablo sağlıklı; PAN + RTPAN bulunmayandan çalışana geçti (220 → 222, 255 → 253)',
    g.hata.length === 0 && g.st.acad === 222 && g.st.known === 253 && g.st.total === 508, J({ hata: g.hata.slice(0, 3), st: g.st }));
}

// ---------------------------------------------------------------------------------
// 4 · Kip açılıyor: karo, FAB ve durum birlikte yanıyor
// ---------------------------------------------------------------------------------
{
  const acik = await ev(() => window.dwgApp.__pan(true));
  await bekle(150);
  const g = await ev(() => {
    const k = document.querySelector('#toolbar [data-act="pan"]'), f = document.querySelector('#navFabs [data-nav="pan"]');
    return { karoOn: k ? k.classList.contains('on') : null, karoAria: k ? k.getAttribute('aria-pressed') : null, fabVar: !!f, fabOn: f ? f.classList.contains('on') : null, fabAria: f ? f.getAttribute('aria-pressed') : null };
  });
  const d = await kip();
  ok('4a __pan(true) kipi açtı ve durum tek kaynaktan okunuyor', acik === true && d.mode === true && d.api === true, J({ acik, d }));
  ok('4b şerit karosu basılı görünüyor', g.karoOn === true && g.karoAria === 'true', J(g));
  ok('4c ekrandaki FAB kümesinde Kaydır düğmesi var ve basılı', g.fabVar && g.fabOn === true && g.fabAria === 'true', J(g));
}

// ---------------------------------------------------------------------------------
// 5 · Kip açıkken sürükleme yalnız kaydırır — araç çalışırken bile seçmez
// ---------------------------------------------------------------------------------
{
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.cancel(); });
  const v0 = await gorunum();
  await drag([[200, 400], [200, 380], [240, 330], [260, 300]]);
  const v1 = await gorunum();
  const bekDx = (260 - 200) / v0.scale, bekDy = (300 - 400) / v0.scale;
  ok('5a boş kipte de olduğu gibi: sürükleme görünümü piksel/ölçek kadar kaydırdı',
    Math.abs((v0.cx - v1.cx) - bekDx) < 1e-6 && Math.abs((v1.cy - v0.cy) - bekDy) < 1e-6 && v1.scale === v0.scale,
    J({ v0, v1, bekDx, bekDy }));

  // Seç aracı çalışırken: normalde sürükleme örtük pencere açar ve nesne seçer; kip açıkken kaydırır
  await ev(() => window.dwgApp.editor.act('t:select')); await bekle(220);
  const calisiyor = await ev(() => !!(window.dwgApp.editor.tools && window.dwgApp.editor.tools.running));
  const v2 = await gorunum();
  await drag([[120, 500], [200, 450], [300, 380]]);
  const v3v = await gorunum();
  const n = await secim();
  ok('5b seç aracı çalışıyorken bile sürükleme KAYDIRDI, hiçbir nesne seçilmedi',
    calisiyor && n === 0 && Math.abs((v2.cx - v3v.cx) - (300 - 120) / v2.scale) < 1e-6, J({ calisiyor, n, v2, v3: v3v }));
  const nd = await ev(() => (window.dwgApp.editor.tools ? window.dwgApp.editor.tools.active : null));
  ok('5c araç iptal edilmedi; kip kapanınca kaldığı yerden sürer', nd === 'select', String(nd));

  // Kıpırdamayan dokunuş da seçmez (bırakışta onTap çalışmaz)
  await dokun(240, 420);
  ok('5d kipte kıpırdamayan dokunuş da seçim yapmıyor', (await secim()) === 0, String(await secim()));
}

// ---------------------------------------------------------------------------------
// 6 · Esc kipi kapatır; kapanınca eski davranış geri gelir
// ---------------------------------------------------------------------------------
{
  await ev(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  await bekle(200);
  const d = await kip();
  const g = await ev(() => {
    const k = document.querySelector('#toolbar [data-act="pan"]'), f = document.querySelector('#navFabs [data-nav="pan"]');
    return { karoOn: k ? k.classList.contains('on') : null, fabOn: f ? f.classList.contains('on') : null };
  });
  ok('6a Esc kaydır kipini kapattı (araç iptalinden ÖNCE kip kapanır)', d.mode === false && d.api === false, J(d));
  ok('6b karo ve FAB birlikte söndü', g.karoOn === false && g.fabOn === false, J(g));

  // kip kapalı: seç aracının örtük penceresi yine çalışıyor mu
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.cancel(); window.dwgApp.editor.act('t:select'); }); await bekle(220);
  await ev(() => window.dwgApp.zoomExtents()); await bekle(200);
  const r = await ev(() => { const S = window.dwgApp.state, e = S.ext; const a = window.dwgApp.toScreen(e[0], e[1]), b = window.dwgApp.toScreen(e[2], e[3]); return [a, b]; });
  await drag([[Math.min(r[0][0], r[1][0]) - 20, Math.min(r[0][1], r[1][1]) - 20], [Math.max(r[0][0], r[1][0]) / 2, Math.max(r[0][1], r[1][1]) / 2], [Math.max(r[0][0], r[1][0]) + 20, Math.max(r[0][1], r[1][1]) + 20]]);
  const n = await secim();
  ok('6c kip kapalıyken seç aracının pencere seçimi yine çalışıyor (gerileme yok)', n > 0, String(n));
  await ev(() => { window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.cancel(); });
}

// ---------------------------------------------------------------------------------
// 7 · Karo ve FAB düğmesi kipi kendi başına çevirebiliyor
// ---------------------------------------------------------------------------------
{
  await sekme('view'); await bekle(150);
  await ev(() => document.querySelector('#toolbar [data-act="pan"]').click()); await bekle(200);
  const a = await kip();
  await ev(() => { const f = document.querySelector('#navFabs [data-nav="pan"]'); f.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, bubbles: true, cancelable: true })); f.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true, cancelable: true })); });
  await bekle(220);
  const b = await kip();
  ok('7a şerit karosu kipi açtı', a.mode === true, J(a));
  ok('7b ekrandaki FAB kipi kapattı', b.mode === false, J(b));
}

// ---------------------------------------------------------------------------------
// 8 · 3B: kip yok, tek parmak ayarı çevriliyor (döndür ↔ kaydır) ve kalıcı
// ---------------------------------------------------------------------------------
{
  await ev(async () => { const E = window.dwgApp.editor; if (!E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 900)); } });
  await bekle(400);
  const uc = await ev(() => window.dwgApp.editor.is3D());
  if (!uc) ok('8  3B görünüm açılamadı (WebGL yok) — sınama atlandı', false, '3B açılmadı');
  else {
    const once = await ev(() => window.dwgApp.editor.view3d().opts.touch.oneFinger);
    const a = await ev(() => window.dwgApp.__pan(true)); await bekle(150);
    const sonra = await ev(() => ({ tek: window.dwgApp.editor.view3d().opts.touch.oneFinger, mode: !!window.dwgApp.state.panMode, karo: (document.querySelector('#toolbar [data-act="pan"]') || {}).className || '' }));
    const b = await ev(() => window.dwgApp.__pan(false)); await bekle(150);
    const geri = await ev(() => window.dwgApp.editor.view3d().opts.touch.oneFinger);
    ok('8a 3B\'de Kaydır tek parmağı kaydırmaya aldı', once === 'orbit' && a === true && sonra.tek === 'pan', J({ once, a, sonra }));
    ok('8b 2B kip bayrağı 3B\'de kirletilmedi', sonra.mode === false, J(sonra));
    ok('8c yeniden dokunuş tek parmağı döndürmeye geri aldı', b === false && geri === 'orbit', J({ b, geri }));
    await ev(async () => { const E = window.dwgApp.editor; if (E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 600)); } });
    await bekle(300);
  }
}

ok('9  konsolda sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
await page.screenshot({ path: `${out}/pan.png` });
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
