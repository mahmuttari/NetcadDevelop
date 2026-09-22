/*
 * EKRAN YERLEŞİMİ VE RENK EŞİTLİĞİ (v8.6).
 *
 * Kullanıcının iki ekran görüntüsünde bildirdiği dört aksaklık burada sayıyla kapatılır:
 *
 *  1) PUSULA EKRANIN ORTASINA KAÇIYORDU. 3B'de kuzey oku görünüm küpünün SOLUNA konuyordu; komut
 *     çubuğu açıkken küp zoom sütununa yer açmak için `right: 72px`e çekiliyor, pusula bir 40 px
 *     daha sola gidince 412 px'lik telefonda merkezi x ≈ 204'e, yani ekranın tam ortasına
 *     düşüyor ve çizimin üstünde duruyordu. Konum artık çakışmaya göre seçilir.
 *  2) 2B İLE 3B AYNI ÇİZİMİ AYRI RENKLERLE GÖSTERİYORDU. 2B nesne rengini render.entityCss'ten
 *     geçiriyor (koyu temada parlaklık TABANI, yüksek kontrastta TAVAN); 3B ham tam sayıyı
 *     çeviriyordu. "Katman paleti" kipinde ise 2B altın-açı HSL paleti, 3B katmanın DXF rengini
 *     kullanıyordu — aynı kip iki ayrı palet demekti.
 *  3) ÖLÇEK ÇUBUĞU KOMUT ÇUBUĞUNUN ALTINDA KALIYORDU. Kaplama S.H - 14'e çiziliyor; komut çubuğu
 *     tuvali kısaltmıyor, ÜSTÜNE biniyor. Pay artık DOM'dan okunuyor.
 *  4) KOORDİNAT ÇİPİ YARIM KALIYORDU. "X: 15.257,27…" — Y hiç görünmüyordu. Çip artık azalan
 *     uzunlukta dört nüsha taşır ve statusFit kırpılmayan ilkini yazar.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_yerlesim.mjs [çıktı] [örnekler]
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
const ev = (fn, a) => page.evaluate(fn, a);

// =============================================================================================
// 1) PUSULA: hiçbir yerleşimde ekranın ortasına düşmez, hiçbir düğmeyle çakışmaz
// =============================================================================================
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(800);

/** pusulanın ve engellerin tuval kutusuna göre konumu */
const pusulaDurum = () => ev(() => {
  const v = window.dwgApp.editor.view3d();
  const cv = document.getElementById('cv3d'), b = cv.getBoundingClientRect();
  const kutu = (id) => { const e = document.getElementById(id); if (!e || e.hidden || !e.offsetParent) return null; const q = e.getBoundingClientRect(); return q.width && q.height ? { x: q.left - b.left, y: q.top - b.top, w: q.width, h: q.height } : null; };
  return { W: b.width, H: b.height, p: v._pusula || null, cube: kutu('cube3d'), navFabs: kutu('navFabs'), dpad: kutu('dpad') };
});
const yenile3 = async () => { await page.waitForTimeout(120); await ev(() => window.dwgApp.editor.yenile3B()); await page.waitForTimeout(220); };
/** pusula kutusu ile engel kutusu kesişiyor mu (K harfi merkezin 34 px üstüne yazılır) */
const cakisir = (p, g) => !!g && p.cx + p.r + 8 > g.x && p.cx - p.r - 8 < g.x + g.w && p.cy + p.r + 8 > g.y && p.cy - 34 < g.y + g.h;

const duzenler = [
  ['1a dikey · sağ el', async () => {}],
  ['1b dikey · sol el', async () => { await ev(() => document.body.classList.add('left-hand')); }],
  ['1c dikey · küp kapalı', async () => { await ev(() => { document.body.classList.remove('left-hand'); window.dwgApp.editor.view3d().set('cube', false); }); }],
  ['1d yatay · küp açık', async () => { await ev(() => window.dwgApp.editor.view3d().set('cube', true)); await page.setViewportSize({ width: 915, height: 412 }); }],
];
for (const [ad, kur] of duzenler) {
  await kur(); await yenile3();
  const d = await pusulaDurum();
  if (!d.p) { ok(ad + ' — pusula konumu okunamadı', false); continue; }
  const sol = d.p.cx < d.W / 2;
  const disUcte = sol ? d.p.cx < d.W / 3 : d.p.cx > d.W * 2 / 3;
  const carpma = ['cube', 'navFabs', 'dpad'].filter(k => cakisir(d.p, d[k]));
  ok(`${ad}: pusula dış üçte birde (ortaya kaçmıyor)`, disUcte,
    `cx=${Math.round(d.p.cx)} / W=${Math.round(d.W)} → %${Math.round(d.p.cx / d.W * 100)}`);
  ok(`${ad}: pusula hiçbir düğmeyle çakışmıyor`, carpma.length === 0, carpma.join(','));
  ok(`${ad}: pusula ekranın içinde`, d.p.cx > 0 && d.p.cx < d.W && d.p.cy - 34 > 0 && d.p.cy + d.p.r < d.H, JSON.stringify(d.p));
}
await page.setViewportSize({ width: 412, height: 915 }); await yenile3();

// =============================================================================================
// 2) RENK: 3B, 2B'nin renk çözücüsünü kullanır
// =============================================================================================
{
  const gecti = await ev(() => {
    // editor.refresh3D setScene'e renk çözücülerini geçiriyor mu
    const v = window.dwgApp.editor.view3d();
    const asil = v.setScene.bind(v); let gorulen = null;
    v.setScene = (p, l, o) => { gorulen = o ? Object.keys(o) : []; return asil(p, l, o); };
    window.dwgApp.editor.yenile3B();
    v.setScene = asil;
    return gorulen;
  });
  ok('2a editor 3B sahnesine renk çözücülerini geçiriyor',
    !!gecti && gecti.includes('renk') && gecti.includes('katmanRenk'), JSON.stringify(gecti));
}
{
  /*
   * Koyu temanın PARLAKLIK TABANI: parlaklığı 0,2'nin altındaki renk beyaza doğru çekilir.
   * Saf mavi (ACI 5, 0x0000ff) parlaklığı 0,0722'dir — 2B onu açar, eski 3B açmazdı.
   */
  const r = await ev(async () => {
    const R = await import('./render.js');
    const V = await import('./view3d.js');
    const v = window.dwgApp.editor.view3d();
    const renkler = [0x0000ff, 0xff0000, 0x00ff00, 0xffffff, 0x101010];
    const cizgi = (i, c) => ({ k: 0, ops: [[0, i * 10, 0, 0], [1, i * 10 + 5, 5, 0]], col: c, lay: '0', lt: null, lts: 1, lw: 0, w: 0, alpha: 1, info: { h: 'L' + i, t: 'LINE' }, et: 'LINE', bb: [i * 10, 0, i * 10 + 5, 5] });
    const layers = new Map([['0', { name: '0', color: null, visible: true, lw: -1, lt: 'Continuous', count: 1 }], ['SU', { name: 'SU', color: 0x00ffff, visible: true, lw: -1, lt: 'Continuous', count: 1 }]]);
    v.setScene(renkler.map((c, i) => cizgi(i, c)), layers, { dark: true, fg: R.fgColor(), renk: (p) => R.entityCss(p.col, R.fgColor()), katmanRenk: R.layerPalette });
    const rgb = v.src.lines.rgb;
    const yakin = (a, b) => Math.abs(a - b) < 1.5 / 255;
    const sonuc = renkler.map((c, i) => {
      const bek = V.parseColor(R.entityCss(c, R.fgColor()));
      const var_ = [rgb[i * 6], rgb[i * 6 + 1], rgb[i * 6 + 2]];
      return { c: c.toString(16), bek, var: var_, esit: bek && bek.every((x, k) => yakin(x, var_[k])) };
    });
    // katman paleti kipi: 3B tamponu 2B'nin palet rengini taşımalı
    const li = v.layerIdx.get('SU');
    const pal = V.parseColor(R.layerPalette('SU'));
    const tampon = [v.layerRGB[li * 3], v.layerRGB[li * 3 + 1], v.layerRGB[li * 3 + 2]];
    return { sonuc, pal, tampon, palEsit: pal && pal.every((x, k) => yakin(x, tampon[k])) };
  });
  const kotu = r.sonuc.filter(x => !x.esit);
  ok('2b nesne renkleri 2B ile birebir aynı (tema kıstırması dâhil)', kotu.length === 0,
    JSON.stringify(kotu.map(x => ({ renk: x.c, bek: x.bek, var: x.var }))));
  const mavi = r.sonuc[0];
  ok('2c koyu temanın parlaklık tabanı 3B\'de de uygulanıyor (saf mavi açılıyor)',
    mavi.bek && mavi.bek[2] > 0.5 && mavi.bek[0] > 0.1, JSON.stringify(mavi.bek));
  ok('2d "katman paleti" kipi 2B ile aynı paleti kullanıyor', r.palEsit === true, JSON.stringify({ pal: r.pal, tampon: r.tampon }));
}
{
  // hsl() çözümlemesi: palet bu biçimi üretir, view3d.parseColor onu okuyabilmeli
  const h = await ev(async () => {
    const V = await import('./view3d.js');
    return { kirmizi: V.parseColor('hsl(0 100% 50%)'), yesil: V.parseColor('hsl(120, 100%, 25%)'), gri: V.parseColor('hsl(210 0% 40%)'), bozuk: V.parseColor('hsl(abc)') };
  });
  const y = (a, b) => a && Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[2] - b[2]) < 0.01;
  ok('2e parseColor hsl() okuyor', y(h.kirmizi, [1, 0, 0]) && y(h.yesil, [0, 0.5, 0]) && y(h.gri, [0.4, 0.4, 0.4]), JSON.stringify(h));
  ok('2f bozuk hsl null döner', h.bozuk === null, JSON.stringify(h.bozuk));
}

// =============================================================================================
// 3) ÖLÇEK ÇUBUĞU VE KUZEY OKU: komut çubuğunun altında kalmaz
// =============================================================================================
await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(400);   // 2B'ye dön
{
  const r = await ev(() => {
    const A = window.dwgApp, S = A.state;
    A.display.setDisplay('scaleBar', true); A.display.setDisplay('north', true);
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const cb = document.getElementById('cmdBar');
    const acik = !!(cb && !cb.hidden && cb.offsetParent);
    const q = acik ? cb.getBoundingClientRect() : null;
    const pay = A.__kaplamaPayi();
    return { H: S.H, W: S.W, acik, cmdUst: q ? q.top - vp.top : null, cmdY: q ? q.height : 0, pay };
  });
  ok('3a komut çubuğu açık ve tuvalin üstüne biniyor', r.acik === true && r.cmdUst < r.H, JSON.stringify({ H: r.H, cmdUst: r.cmdUst }));
  ok('3b alt güvenli pay komut çubuğunu kapsıyor', r.pay.alt >= r.H - r.cmdUst, JSON.stringify(r.pay));
  const olcekY = r.H - 14 - r.pay.alt;
  ok('3c ölçek çubuğu komut çubuğunun ÜSTÜNDE kalıyor', olcekY < r.cmdUst, `çubuk y=${Math.round(olcekY)} · komut üst=${Math.round(r.cmdUst)}`);
  // komut çubuğu kapanınca pay sıfırlanır (ölçek çubuğu en alta döner)
  const kapali = await ev(() => { const cb = document.getElementById('cmdBar'); if (cb) cb.hidden = true; return window.dwgApp.__kaplamaPayi(); });
  ok('3d komut çubuğu kapanınca pay kalkıyor', kapali.alt === 0, JSON.stringify(kapali));
  await ev(() => { const cb = document.getElementById('cmdBar'); if (cb) cb.hidden = false; });
}
{
  // gerçek pikselde: ölçek çubuğunun kutusu komut çubuğunun üstünde çiziliyor
  {
    const q = await ev(() => { const b = document.getElementById('viewport').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    await page.mouse.move(q.x + q.w * 0.5, q.y + q.h * 0.4); await page.waitForTimeout(250);   // kaplamayı yeniden çizdirir
  }
  const r = await ev(() => {
    const A = window.dwgApp, S = A.state;
    const ov = document.getElementById('ov'), g = ov.getContext('2d');
    const d = g.getImageData(0, 0, Math.round(160 * S.dpr), ov.height).data;
    const w = Math.round(160 * S.dpr);
    let enAlt = -1;
    for (let y = 0; y < ov.height; y++) for (let x = 0; x < w; x++) { if (d[(y * w + x) * 4 + 3] > 8) { enAlt = y; break; } }
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const q = document.getElementById('cmdBar').getBoundingClientRect();
    return { enAlt: enAlt / S.dpr, cmdUst: q.top - vp.top, H: S.H };
  });
  ok('3e sol alt kaplamanın en alt pikseli komut çubuğunu aşmıyor', r.enAlt >= 0 && r.enAlt <= r.cmdUst + 1,
    `en alt y=${Math.round(r.enAlt)} · komut üst=${Math.round(r.cmdUst)}`);
}

// =============================================================================================
// 4) KOORDİNAT ÇİPİ: hiçbir zaman yarım kalmaz
// =============================================================================================
{
  const vb = await ev(() => { const q = document.getElementById('viewport').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
  await page.mouse.move(vb.x + vb.w / 2, vb.y + vb.h / 2);
  await page.waitForTimeout(300);
  const r = await ev(() => {
    const co = document.getElementById('stCoord');
    return { metin: co.textContent, k0: co.dataset.k0, k1: co.dataset.k1, k2: co.dataset.k2, k3: co.dataset.k3,
      kirpik: co.scrollWidth > co.clientWidth + 1, gizli: co.classList.contains('st-squeeze'),
      sw: co.scrollWidth, cw: co.clientWidth, durum: window.dwgApp.__stFit() };
  });
  ok('4a koordinatın dört nüshası kuruldu', !!(r.k0 && r.k1 && r.k2 && r.k3), JSON.stringify({ k0: r.k0, k3: r.k3 }));
  ok('4b nüshalar gerçekten kısalıyor', r.k0.length >= r.k1.length && r.k1.length > r.k2.length && r.k2.length > r.k3.length,
    JSON.stringify([r.k0.length, r.k1.length, r.k2.length, r.k3.length]));
  ok('4c ekrandaki koordinat YARIM DEĞİL (kırpılmamış ya da tümden düşmüş)', !r.kirpik || r.gizli,
    JSON.stringify({ metin: r.metin, sw: r.sw, cw: r.cw }));
  ok('4d görünen metin nüshalardan biri', r.gizli || [r.k0, r.k1, r.k2, r.k3].includes(r.metin), r.metin);
  ok('4e X ile Y birlikte görünüyor (yalnız X kalmıyor)', r.gizli || /\d.*[;Y]/.test(r.metin), r.metin);
}
{
  // dar ekranda da: hızlı düğmeler artınca koordinat kısalır, kesilmez
  await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(400);
  const vb = await ev(() => { const q = document.getElementById('viewport').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
  await page.mouse.move(vb.x + vb.w / 2, vb.y + vb.h / 2);
  await page.waitForTimeout(350);
  const r = await ev(() => {
    const co = document.getElementById('stCoord'), bar = document.getElementById('statusbar');
    return { kirpik: co.scrollWidth > co.clientWidth + 1, gizli: co.classList.contains('st-squeeze'), metin: co.textContent,
      tasma: bar.scrollWidth - bar.clientWidth, durum: window.dwgApp.__stFit() };
  });
  ok('4f 360 px ekranda da koordinat yarım kalmıyor', !r.kirpik || r.gizli, JSON.stringify(r));
  ok('4g çubuk taşmıyor', r.tasma <= 1, String(r.tasma));
  // kopyalama tam değeri kullanır: kısaltma yalnız EKRANI etkiler
  const kopya = await ev(() => { const co = document.getElementById('stCoord'); return { k0: co.dataset.k0, ekran: co.textContent }; });
  ok('4h tam değer saklanmaya devam ediyor (kopyalama kısalmaz)', !!kopya.k0 && kopya.k0.includes('X:'), kopya.k0);
  await page.setViewportSize({ width: 412, height: 915 }); await page.waitForTimeout(300);
}

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
