/*
 * 3B RENK KİPİ, TEK RENK TONU VE SAHNEYİ KENDİLİĞİNDEN YENİLEYEN AYARLAR (v8.5).
 *
 * Dört ayrı boşluk buradaki iddialarla kapatılır:
 *
 *  1) RENK KİPİ AYRIK YAŞIYORDU. 3B kendi kipini tarayıcı belleğinde saklıyor ve her dosyada geri
 *     yüklüyordu: bir kez "Katman" ya da "Kot" seçen kullanıcı aylar sonra başka bir çizimi
 *     açtığında 2B'de gri olan nesneleri 3B'de yeşil buluyor, nedenini hiçbir yerde göremiyordu.
 *     Kural: 2B'nin kipi ÖNTANIMDIR; kullanıcı 3B kipini açıkça seçtiyse o seçim korunur ve
 *     etkin kip HUD'da yazar.
 *  2) TEK RENK TONU 3B'ye GEÇMİYORDU. 2B'de turuncu tek renk seçen kullanıcı 3B'de beyaz buluyordu.
 *  3) SAHNE KENDİLİĞİNDEN YENİLENMİYORDU. 3B açıkken taramayı kapatmak, katmanı izole etmek ya da
 *     renk kipini değiştirmek ekranda hiçbir şeyi değiştirmiyordu; yalnız 2B'ye dönüp gelince
 *     görülüyordu.
 *  4) IZGARA DERİNLİK YAZIYORDU. Düz bir paftada ızgara çizimle aynı kotta durduğu için üstten
 *     bakışta altındaki çizgileri siliyordu (z-savaşı).
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_3d_kip.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, WEBGL_ARGS } from './harness.mjs';
const { samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser({ args: WEBGL_ARGS });
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await page.evaluate(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(800);

const ev = (fn, a) => page.evaluate(fn, a);
const bekle = (ms = 250) => page.waitForTimeout(ms);

// ---- 1) 2B'nin renk kipi 3B'nin ÖNTANIMI ------------------------------------------------------
{
  const bas = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    return { kip: v.opts.colorMode, kullanici: !!v._renkKullanici, kayitli: !!v._renkKayitli, cizgi: v.counts.lines };
  });
  ok('1a temiz başlangıç: 3B kipi elle seçilmemiş', bas.kullanici === false && bas.kayitli === false, JSON.stringify(bas));
  ok('1b 3B sahnesi kuruldu', bas.cizgi > 0, String(bas.cizgi));

  await ev(() => window.dwgApp.display.setDisplay('colorMode', 'layer'));
  await bekle();
  const katman = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    return { kip2: window.dwgApp.state.colorMode, kip3: v.opts.colorMode, hud: v.hudText(false) };
  });
  ok('1c 2B "Katman paleti" seçilince 3B de katman paletine geçiyor', katman.kip3 === 'layer', JSON.stringify(katman));
  ok('1d etkin kip HUD\'da yazıyor', /Katman/.test(katman.hud), katman.hud);
}

// ---- 2) kullanıcının AÇIK 3B seçimi 2B'nin kipiyle ezilmiyor ----------------------------------
{
  await ev(() => { const v = window.dwgApp.editor.view3d(); v.set('colorMode', 'elevation'); });
  await bekle(150);
  await ev(() => window.dwgApp.display.setDisplay('colorMode', 'entity'));
  await bekle();
  const r = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    return { kip2: window.dwgApp.state.colorMode, kip3: v.opts.colorMode, kullanici: !!v._renkKullanici, hud: v.hudText(false) };
  });
  ok('2a 3B\'de elle seçilen kip korunuyor (2B\'ye dönmüyor)', r.kip3 === 'elevation' && r.kip2 === 'entity', JSON.stringify(r));
  ok('2b HUD kot rampasını yazıyor', /Kot/.test(r.hud), r.hud);
}

// ---- 3) tek renk tonu 2B ile 3B'de aynı -------------------------------------------------------
{
  const r = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    // Izgara, eksenler ve aydınlatma sayımı bulandırır: tek renk kipinin TONU tel kafeste okunur
    v.set('grid', false); v.set('axes', false); v.set('style', 'wireframe');
    window.dwgApp.display.setDisplay('monoColor', '#ff0000');
    v.set('colorMode', 'mono');
    window.dwgApp.editor.yenile3B();
    v._lastFrameMs = 0; v._lastRenderAt = 0; v.render();
    const cv = v.cv, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    c.getContext('2d').drawImage(cv, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let kirmizi = 0, baska = 0;
    const bgf = v._bgColor(), bg = [Math.round(bgf[0] * 255), Math.round(bgf[1] * 255), Math.round(bgf[2] * 255)];
    for (let k = 0; k < d.length; k += 4) {
      if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) < 24) continue;
      // kenar yumuşatma koyu kırmızı üretir; ölçüt MUTLAK parlaklık değil, kanal ORANIdır
      if (d[k] > 30 && d[k] > d[k + 1] * 1.8 && d[k] > d[k + 2] * 1.8) kirmizi++; else baska++;
    }
    return { monoFg: v.monoFg, kirmizi, baska };
  });
  ok('3a 2B\'nin tek renk TONU 3B\'ye geçiyor', r.monoFg && Math.abs(r.monoFg[0] - 1) < 0.02 && r.monoFg[1] < 0.02 && r.monoFg[2] < 0.02, JSON.stringify(r.monoFg));
  ok('3b çizim gerçekten o tonda basılıyor', r.kirmizi > 50 && r.kirmizi > r.baska, JSON.stringify({ kirmizi: r.kirmizi, baska: r.baska }));
  await ev(() => { window.dwgApp.display.setDisplay('monoColor', 'fg'); const v = window.dwgApp.editor.view3d(); v.set('colorMode', 'entity'); v.set('grid', true); });
  await bekle(150);
}

// ---- 4) 2B ayarları 3B sahnesini KENDİLİĞİNDEN yeniliyor (elle yenile3B çağrısı yok) ----------
const sayac = () => ev(() => { const v = window.dwgApp.editor.view3d(); return { cizgi: v.counts.lines, ucgen: v.counts.tris, nokta: v.counts.pts, kose: v.vertPrim.length }; });
{
  const once = await sayac();
  await ev(() => window.dwgApp.display.setDisplay('showText', false));
  await bekle();
  const yazisiz = await sayac();
  ok('4a "Yazı" kapatılınca 3B sahnesi kendiliğinden yenileniyor', yazisiz.nokta < once.nokta, JSON.stringify({ once: once.nokta, sonra: yazisiz.nokta }));
  await ev(() => window.dwgApp.display.setDisplay('showText', true));
  await bekle();
  const geri = await sayac();
  ok('4b geri açılınca eski sahneye dönülüyor', geri.nokta === once.nokta && geri.kose === once.kose, JSON.stringify({ once: once.nokta, geri: geri.nokta }));

  // katman izolasyonu (afterLayerChange yolu)
  const izo = await ev(() => {
    const S = window.dwgApp.state;
    const adlar = [...S.layers.keys()];
    if (adlar.length < 2) return null;
    window.dwgApp.display.isolateLayers([adlar[0]]);
    return adlar[0];
  });
  await bekle();
  if (izo == null) C.skip('4c katman izolasyonu (çizimde tek katman var)');
  else {
    const izoSay = await sayac();
    ok('4c katman izole edilince 3B sahnesi de daralıyor', izoSay.kose < once.kose, JSON.stringify({ once: once.kose, izole: izoSay.kose }));
    await ev(() => window.dwgApp.display.unisolate());
    await bekle();
    const acik = await sayac();
    ok('4d izolasyon kalkınca sahne geri geliyor', acik.kose === once.kose, JSON.stringify({ once: once.kose, acik: acik.kose }));
  }
}

// ---- 5) ızgara derinlik yazmıyor: üstten bakışta çizimin üstünü örtmüyor ----------------------
{
  const r = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    v.set('persp', false); v.set('axes', false);
    v.preset('top', { animate: false });
    const say = () => {
      v._lastFrameMs = 0; v._lastRenderAt = 0; v.render();
      const cv = v.cv, c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const bgf = v._bgColor(), bg = [Math.round(bgf[0] * 255), Math.round(bgf[1] * 255), Math.round(bgf[2] * 255)];
      let n = 0;
      for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 24) n++;
      return n;
    };
    v.set('grid', false); const kapali = say();
    v.set('grid', true); const acik = say();
    return { kapali, acik };
  });
  ok('5a ızgarasız çizim görünüyor', r.kapali > 100, String(r.kapali));
  ok('5b ızgara açılınca çizim SİLİNMİYOR (derinlik yazmıyor)', r.acik >= r.kapali, JSON.stringify(r));
}

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
