// GEZİNME VE OTURUM SÜREKLİLİĞİ.
//
// Bu sınamanın sebebi somut bir kusurdur: "Uygulamadan geri çıktığımda son açılan dosya
// kapanıyor ve dosya açılan sayfaya dönüyor. Açık olan dosya kapanmasın. Farklı bir ekrana
// geçtiğimde bellekte kalmaya devam etsin. Her ekranda ana sayfa butonu olsun, geri butonu
// olsun."
//
// Ölçülen dört şey:
//   1. Ana ekrana geçmek çizimi KAPATMIYOR (sahne, katmanlar, görünüm bellekte).
//   2. Ana ekranda "Kaldığınız yerden devam edin" kartı var ve tek dokunuşla geri dönüyor.
//   3. Geri tuşu çizim kökünde uygulamayı kapatmıyor, ana ekrana dönüyor; ana ekranın Ev
//      sekmesinde ise false dönüyor (uygulamadan çıkış) — yani döngü yok.
//   4. Her ekranda geri ve ana sayfa düğmesi var.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_gezinme.mjs
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, samplesDir } from './harness.mjs';
import path from 'node:path';
import fs from 'node:fs';

args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const SM = samplesDir;

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 780 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
// Karşılama turu ilk açılışta çıkar; gezinme sınamasının konusu o değil.
try { await page.click('#tourSkip', { timeout: 2000 }); } catch (_) { /* tur yok */ }

// --- A) Düğmeler her ekranda var mı ---------------------------------------------------------
{
  const r = await page.evaluate(() => {
    const v = (id) => !!document.getElementById(id);
    const q = (s) => !!document.querySelector(s);
    return {
      cizimGeri: v('btnBack'), cizimEv: v('btnHome'),
      evGeri: v('homeBack'), evEv: v('homeHomeBtn'),
      acGeri: q('#openPanel [data-open="close"]'), acEv: q('#openPanel [data-open="home"]'),
      belgeGeri: q('#docView [data-doc="back"]'), belgeEv: q('#docView [data-doc="home"]'),
      kart: v('homeResume'), kartDugme: v('homeResumeBtn'),
    };
  });
  ok('A1 çizim ekranında geri ve ana sayfa düğmesi', r.cizimGeri && r.cizimEv);
  ok('A2 ana ekranda geri ve ana sayfa düğmesi', r.evGeri && r.evEv);
  ok('A3 Dosya Aç merkezinde geri ve ana sayfa düğmesi', r.acGeri && r.acEv);
  ok('A4 belge görünümünde geri ve ana sayfa düğmesi', r.belgeGeri && r.belgeEv);
  ok('A5 "kaldığınız yerden devam edin" kartı var', r.kart && r.kartDugme);
}

// --- A6) Karşılama turu ana ekranı engellemiyor ----------------------------------------------
{
  const r = await page.evaluate(() => {
    const t = document.getElementById('tour');
    t.hidden = false;                                   // tur açıkken ana ekrana geçilirse
    document.body.classList.add('homemode');
    const g = getComputedStyle(t).display;
    document.body.classList.remove('homemode'); t.hidden = true;
    return g;
  });
  ok('A6 ana ekran kipinde karşılama turu gizleniyor (düğmeleri engellemiyor)', r === 'none', r);
}

// --- B) Açık dosya yokken kart gizli ---------------------------------------------------------
{
  const gizli = await page.evaluate(() => document.getElementById('homeResume').hidden);
  ok('B1 dosya yokken devam kartı gizli', gizli === true, String(gizli));
}

// --- C) Çizim açıkken ana ekrana geçiş: dosya KAPANMIYOR -------------------------------------
{
  await openFile(page, path.join(SM, 'example_2000.dwg'), { settle: 200 });
  const once = await page.evaluate(() => ({
    hasDoc: window.dwgApp.state.hasDoc, ad: window.dwgApp.state.fileName,
    prim: window.dwgApp.state.prims.length, katman: window.dwgApp.state.layers.size,
    olcek: window.dwgApp.state.view.scale,
  }));
  ok('C1 çizim açıldı', once.hasDoc && once.prim > 0, `${once.ad} · ${once.prim} ilkel`);

  await page.evaluate(() => window.dwgApp.goHome());
  await page.waitForTimeout(120);
  const evde = await page.evaluate(() => ({
    evAcik: !document.getElementById('home').hidden,
    hasDoc: window.dwgApp.state.hasDoc, ad: window.dwgApp.state.fileName,
    prim: window.dwgApp.state.prims.length, katman: window.dwgApp.state.layers.size,
    olcek: window.dwgApp.state.view.scale,
    kartGizli: document.getElementById('homeResume').hidden,
    kartAd: document.getElementById('homeResumeName').textContent,
  }));
  ok('C2 ana ekran açıldı', evde.evAcik === true);
  ok('C3 ÇİZİM KAPANMADI: sahne, katmanlar ve görünüm bellekte',
    evde.hasDoc && evde.prim === once.prim && evde.katman === once.katman && evde.olcek === once.olcek,
    `${evde.prim}/${once.prim} ilkel · ${evde.katman}/${once.katman} katman`);
  ok('C4 devam kartı görünür ve dosya adını yazıyor',
    evde.kartGizli === false && evde.kartAd === once.ad, `${evde.kartAd}`);

  // Kart: tek dokunuşla çizime dönüş
  await page.click('#homeResumeBtn');
  await page.waitForTimeout(120);
  const geri = await page.evaluate(() => ({
    evAcik: !document.getElementById('home').hidden,
    prim: window.dwgApp.state.prims.length, olcek: window.dwgApp.state.view.scale,
  }));
  ok('C5 kart çizime döndürdü (yeniden açmadan)',
    geri.evAcik === false && geri.prim === once.prim && geri.olcek === once.olcek);
}

// --- D) Geri tuşu: çizimde ana ekrana, Ev'de uygulamadan çıkışa ------------------------------
{
  // onBack sözleşmesi korunur: kapatacak bir şey yoksa false. Gezinme adımı onBackSystem'dedir.
  const r0 = await page.evaluate(() => window.dwgApp.onBack());
  ok('D0 onBack sözleşmesi korundu: kapatacak bir şey yokken false', r0 === false, String(r0));
  const r1 = await page.evaluate(() => ({ sonuc: window.dwgApp.onBackSystem(), evAcik: !document.getElementById('home').hidden }));
  ok('D1 sistem geri tuşu çizim kökünde: uygulamayı kapatmıyor, ana ekrana dönüyor',
    r1.sonuc === true && r1.evAcik === true, `onBackSystem=${r1.sonuc}`);
  const r2 = await page.evaluate(() => ({ hasDoc: window.dwgApp.state.hasDoc, prim: window.dwgApp.state.prims.length }));
  ok('D2 geri tuşu çizimi kapatmadı', r2.hasDoc && r2.prim > 0, `${r2.prim} ilkel`);
  // Ev dışındaki sekmede geri → Ev'e
  await page.evaluate(() => window.dwgApp.home.setTab('tools'));
  await page.waitForTimeout(60);
  const r3 = await page.evaluate(() => ({ sonuc: window.dwgApp.onBackSystem(), tab: window.dwgApp.home.tab() }));
  ok('D3 Ev dışındaki sekmede geri: Ev sekmesine dönüyor', r3.sonuc === true && r3.tab === 'ev', `${r3.tab}`);
  const r4 = await page.evaluate(() => window.dwgApp.onBackSystem());
  ok('D4 Ev sekmesinde geri: false (uygulamadan çıkış) — DÖNGÜ YOK', r4 === false, String(r4));
}

// --- E) Ev dışındaki sekmelerde üst şerit düğmeleri görünür ----------------------------------
{
  await page.evaluate(() => window.dwgApp.home.setTab('files'));
  await page.waitForTimeout(60);
  const a = await page.evaluate(() => ({ geri: !document.getElementById('homeBack').hidden, ev: !document.getElementById('homeHomeBtn').hidden, baslik: document.getElementById('homeTopTitle').textContent }));
  ok('E1 Dosya sekmesinde geri ve ana sayfa görünür', a.geri && a.ev, `başlık=${a.baslik}`);
  await page.click('#homeBack');
  await page.waitForTimeout(60);
  const b = await page.evaluate(() => ({ tab: window.dwgApp.home.tab(), geri: !document.getElementById('homeBack').hidden }));
  ok('E2 geri düğmesi Ev sekmesine döndürdü ve orada gizlendi', b.tab === 'ev' && b.geri === false);
}

// --- F) Oturum sürekliliği: köprü sözleşmesi -------------------------------------------------
// Tarayıcıda Android köprüsü yoktur; burada JS tarafının sözleşmeye uyduğu kaynaktan sınanır.
{
  const js = fs.readFileSync(new URL('../app/src/main/assets/viewer/app.js', import.meta.url), 'utf8');
  const java = fs.readFileSync(new URL('../app/src/main/java/com/mahmuttari/dwgviewer/MainActivity.java', import.meta.url), 'utf8');
  ok('F1 açılışta bekleyen dosya "resume" alanıyla ayırt ediliyor', /o\.resume && A\(\)\.forgetLastSession/.test(js));
  ok('F2 geri yükleme başarısızsa kayıt siliniyor',
    /if \(!S\.hasDoc && !Docs\.isOpen\(\)\) \{ try \{ A\(\)\.forgetLastSession\(\)/.test(js));
  ok('F3 Android son oturumu kalıcı yazıyor', /private void sonOturumYaz\(/.test(java) && /prefs\(\)\.edit\(\)[\s\S]{0,120}"sonUri"/.test(java));
  ok('F4 getPendingFile son oturuma yalnız ayar AÇIKKEN düşüyor (varsayılan kapalı)',
    /if \(!prefs\(\)\.getBoolean\("resumeLast", false\)\) return "";/.test(java) && /if \(!sonOturumYukle\(\)\) return "";/.test(java));
  ok('F5 okunamayan dosyada kayıt siliniyor (izin geri alınmış / dosya silinmiş)',
    /sonOturumSil\(\); return false;/.test(java));
  ok('F6 ayar açılabilir/kapanabilir', /setResumeLast\(boolean on\)/.test(java) && /getResumeLast\(\)/.test(java) && /sResume/.test(js));
  ok('F7 goHome açık belgeyi KAPATMIYOR', /function goHome\(\) \{ closeMenu\(\); Home\.show\(\); \}/.test(js));
  // Açılışta kendiliğinden dosya açılmaz: son oturum karta düşer, kullanıcı karar verir.
  ok('F10 son oturum açılışta KENDİLİĞİNDEN yüklenmiyor (varsayılan kapalı)',
    /prefs\(\)\.getBoolean\("resumeLast", false\)/.test(java) && /getResumeLast\(\) \{ return prefs\(\)\.getBoolean\("resumeLast", false\); \}/.test(java));
  ok('F11 son oturum karta sunuluyor ve yalnız dokununca açılıyor',
    /lastSessionInfo\(\)/.test(java) && /openLastSession\(\)/.test(java)
    && /a\.lastSessionInfo\(\)/.test(js) && /a\.openLastSession\(\)/.test(js));
  ok('F12 kart iki kaynağı ayırıyor: bellekteki çizim anında döner, kayıtlı oturum yeniden açılır',
    /function resumeInfo\(\)/.test(js) && /bellek: true/.test(js) && /bellek: false/.test(js)
    && /if \(r\.bellek\) \{ Home\.hide\(\); return; \}/.test(js));
  ok('F8 sistem geri tuşu ayrı yoldan gidiyor (onBack sözleşmesi bozulmadı)',
    /function onBackSystem\(\) \{[\s\S]{0,600}goHome\(\); return true;/.test(js)
    && /window\.dwgApp\.onBackSystem \? window\.dwgApp\.onBackSystem\(\)/.test(java));
  ok('F9 ana ekranda ikinci kez ana ekrana gidilmiyor (çıkış yolu kapanmaz)',
    /if \(!Home\.isShown\(\) && \(S\.hasDoc \|\| Docs\.isOpen\(\)\)\)/.test(js));
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
