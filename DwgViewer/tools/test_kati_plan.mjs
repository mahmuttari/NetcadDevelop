/*
 * KATI MODEL PLANI, DOKUNMA PARILTISI, KAYDET / FARKLI KAYDET (v8.6).
 *
 * 1) KATI MODEL PLANI. Kullanıcının bildirimi: "2B üstten bakışta kesitten bakıyormuş gibi."
 *    Paylaşılan model 41,4 m açıklıklı bir köprüydü ve 2917 varlığının TAMAMI POLYLINE_PFACE
 *    (3.399.552 üçgen). 2B çizici ağ ilkellerini yalnız KENARLARIYLA çiziyordu: tabliyenin
 *    altındaki bütün kirişler, ayaklar ve korkuluklar üst üste görünüyordu — plan değil röntgen.
 *    Artık uygulamanın kendi WebGL çizicisi plan kipinde (üstten, paralel, gölgeli) 2B
 *    kamerasıyla aynı kadraja kurulup saydam kare olarak 2B tuvalinin üstüne basılıyor.
 *    Burada sınanan şey ekran değil KARARDIR: alttaki gövde üstteki gövdenin ARKASINDA kalmalı.
 *
 * 2) DOKUNMA PARILTISI. "Ekrandaki Seç komutunu tıkladığım anlaşılmıyor; tıkladığımda seçim
 *    parıltısı gelsin." Düğmelerin hiçbir :active durumu yoktu.
 *
 * 3) KAYDET / FARKLI KAYDET. Şeritte yalnız "DXF kaydet" vardı ve adı hep "<ad>_duzenlenmis.dxf"
 *    idi; ne çizimin kendi adıyla kaydedilebiliyordu ne de ad seçilebiliyordu.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_kati_plan.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, noUpdate, checker, queueAnswers, PHONE, WEBGL_ARGS } from './harness.mjs';
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
// 1) KATI MODEL PLANI
// =============================================================================================
/*
 * İKİ KUTU, BİRİ ÖTEKİNİN ÜSTÜNDE. Alttaki KIRMIZI (z 0..4), üstteki MAVİ (z 10..14) ve mavi
 * kutu kırmızıyı planda TAMAMEN örter. Doğru plan mavi verir; tel kafeste ikisinin de kenarları
 * görünür ve kırmızı "altından" okunur — kullanıcının "kesit gibi" dediği şey budur.
 */
const kutuKur = () => ev(() => {
  const kutu = (x0, y0, x1, y1, z0, z1, col, key) => {
    const V = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
    const F = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    const seg = []; for (const [a, b] of E) seg.push(V[a * 3], V[a * 3 + 1], V[a * 3 + 2], V[b * 3], V[b * 3 + 1], V[b * 3 + 2]);
    return { k: 5, key, vtx: new Float32Array(V), idx: new Uint32Array(F), seg: new Float32Array(seg),
      bb: [x0, y0, x1, y1], zmin: z0, zmax: z1, face: true, alpha: 1, w: 0, lw: 0, lt: null, lts: 1,
      col, lay: '0', info: { h: key, t: 'POLYLINE_PFACE' }, et: 'POLYLINE_PFACE' };
  };
  const S = window.dwgApp.state, model = S.scene.layouts[0];
  // alttaki kırmızı biraz DAHA GENİŞ: kenarından görünmesi doğru, ortasından görünmesi yanlış
  const alt = kutu(-60, -60, 60, 60, 0, 4, 0xff0000, 'ALT');
  const ust = kutu(-40, -40, 40, 40, 10, 14, 0x0000ff, 'UST');
  model.prims.length = 0; model.prims.push(alt, ust);
  S.prims = model.prims; S.tree = null; S.cacheValid = false;
  window.dwgApp.editor.planBayat();
  // Görünüm ELLE kurulur: zoomExtents dosyanın kendi sınırlarını kullanır, enjekte edilen
  // ilkelleri görmez ve kamera milyonlarca birim uzakta kalır.
  S.view.cx = 0; S.view.cy = 0; S.view.scale = Math.min(S.W, S.H) / 170;
  window.dwgApp.requestRender();
  return { n: model.prims.length, view: { ...S.view } };
});
await kutuKur();
await page.waitForTimeout(1500);

/** ekran ortasındaki (üstteki kutunun merkezi) pikselin rengi + kırmızı/mavi piksel sayıları */
const renkOlc = () => ev(() => {
  const S = window.dwgApp.state, cv = document.getElementById('cv'), g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const px = (wx, wy) => { const s = window.dwgApp.toScreen(wx, wy); const i = ((Math.round(s[1] * S.dpr) * cv.width) + Math.round(s[0] * S.dpr)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  let kirmizi = 0, mavi = 0;
  for (let k = 0; k < d.length; k += 4) {
    const r = d[k], gg = d[k + 1], b = d[k + 2];
    if (r > 70 && r > gg * 1.8 && r > b * 1.8) kirmizi++;
    else if (b > 70 && b > r * 1.8 && b > gg * 1.8) mavi++;
  }
  return { orta: px(0, 0), kenar: px(50, 0), kirmizi, mavi };
});
let dolu = null;
{
  const r = await renkOlc();
  dolu = r;
  const maviMi = (c) => c[2] > 60 && c[2] > c[0] * 1.6;
  const kirmiziMi = (c) => c[0] > 60 && c[0] > c[2] * 1.6;
  ok('1a üstteki gövde planda DOLU çiziliyor (merkez mavi)', maviMi(r.orta), JSON.stringify(r.orta));
  ok('1b alttaki gövde üstteki tarafından ÖRTÜLÜYOR (merkez kırmızı değil)', !kirmiziMi(r.orta), JSON.stringify(r.orta));
  ok('1c örtülmeyen kenar payı görünmeye devam ediyor (kırmızı)', kirmiziMi(r.kenar), JSON.stringify(r.kenar));
  ok('1d iki renk de sahnede var', r.mavi > 200 && r.kirmizi > 200, JSON.stringify({ mavi: r.mavi, kirmizi: r.kirmizi }));
}
{
  // ayar kapatılınca eski davranışa (tel kafes) dönülür: gövdelerin İÇİ boşalır
  await ev(() => window.dwgApp.display.setDisplay('solidPlan', false));
  await page.waitForTimeout(900);
  const r = await renkOlc();
  ok('1e ayar kapatılınca gövdeler dolmuyor (tel kafes)', !(r.orta[2] > 60 && r.orta[2] > r.orta[0] * 1.6), JSON.stringify(r.orta));
  // Tel kafeste geriye yalnız KENAR çizgileri kalır: dolu plandan en az on kat az mavi piksel
  ok('1f tel kafeste dolu piksel çok azalıyor', r.mavi * 10 < dolu.mavi, `telkafes ${r.mavi} · dolu ${dolu.mavi}`);
  await ev(() => { window.dwgApp.display.setDisplay('solidPlan', true); window.dwgApp.state.cacheValid = false; window.dwgApp.requestRender(); });
  await page.waitForTimeout(1200);
  const g = await renkOlc();
  const tani = await ev(() => ({ ayar: window.dwgApp.state.ui2d.solidPlan, ms: Math.round(window.dwgApp.state.lastRenderMs) }));
  ok('1g ayar geri açılınca plan yeniden doluyor', g.orta[2] > 60 && g.orta[2] > g.orta[0] * 1.6, JSON.stringify(g.orta) + ' ' + JSON.stringify(tani));
}
{
  // ağ içermeyen çizimde altlık hiç devreye girmez (WebGL bağlamı boşuna kurulmaz)
  const r = await ev(() => {
    const S = window.dwgApp.state, model = S.scene.layouts[0];
    model.prims.length = 0;
    model.prims.push({ k: 0, key: 'L1', ops: [[0, 0, 0, 0], [1, 100, 100, 0]], col: 0xffffff, lay: '0', lt: null, lts: 1, lw: 0, w: 0, alpha: 1, info: { h: 'L1', t: 'LINE' }, et: 'LINE', bb: [0, 0, 100, 100] });
    S.prims = model.prims; S.tree = null; S.cacheValid = false;
    window.dwgApp.editor.planBayat();
    return window.dwgApp.editor.planAltlik(document.getElementById('cv').getContext('2d'), document.getElementById('cv'), S.view.scale);
  });
  ok('1h ağ içermeyen çizimde plan altlığı çalışmıyor', r === false, String(r));
}

// =============================================================================================
// 2) DOKUNMA PARILTISI
// =============================================================================================
{
  const kutu = await ev(() => { const b = document.querySelector('#toolbar .tb-pin'); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  ok('2a kalıcı Seç düğmesi var', !!kutu);
  if (kutu) {
    await page.mouse.move(kutu.x, kutu.y);
    await page.mouse.down();
    const basili = await ev(() => { const b = document.querySelector('#toolbar .tb-pin'); return { flash: b.classList.contains('tap-flash'), outline: getComputedStyle(b).outlineWidth }; });
    await page.mouse.up();
    ok('2b dokunulduğunda parıltı sınıfı geliyor', basili.flash === true, JSON.stringify(basili));
    ok('2c parıltı görünür bir halka çiziyor', parseFloat(basili.outline) >= 2, basili.outline);
    await page.waitForTimeout(900);
    const sonra = await ev(() => document.querySelector('#toolbar .tb-pin').classList.contains('tap-flash'));
    ok('2d parıltı kendiliğinden kalkıyor (sınıf takılı kalmıyor)', sonra === false, String(sonra));
  }
  // şerit karosu da aynı geri bildirimi alır
  const kr = await ev(() => { const b = document.querySelector('#toolbar .tb-row button'); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; });
  if (!kr) C.skip('2e şerit karosu bulunamadı');
  else {
    await page.mouse.move(kr.x, kr.y); await page.mouse.down();
    const f = await ev(() => document.querySelector('#toolbar .tb-row button').classList.contains('tap-flash'));
    await page.mouse.up();
    ok('2e şerit karosu da parıldıyor', f === true, String(f));
  }
}

// =============================================================================================
// 3) KAYDET / FARKLI KAYDET
// =============================================================================================
{
  const v = await ev(() => {
    const A = window.dwgApp, ed = A.editor;
    const ad = ed.dosyaAdiSuz;
    return {
      komutlar: ['save', 'saveas'].map(a => !!document.querySelector(`#toolbar [data-act="${a}"]`) || !!a),
      suz: { bos: ad('', 'cizim'), yol: ad('a/b\\c:d', 'cizim'), uzanti: ad('plan', 'cizim'), varUzanti: ad('plan.DXF', 'cizim'), nokta: ad('...gizli', 'cizim') },
    };
  });
  ok('3a dosya adı süzgeci yol ayıracını ve yasak imleri atıyor', v.suz.yol === 'a_b_c_d.dxf', v.suz.yol);
  ok('3b boş ad varsayılana düşüyor', v.suz.bos === 'cizim.dxf', v.suz.bos);
  ok('3c uzantı kendiliğinden ekleniyor, iki kez eklenmiyor', v.suz.uzanti === 'plan.dxf' && v.suz.varUzanti === 'plan.DXF', JSON.stringify(v.suz));
  ok('3d baştaki noktalar atılıyor (gizli dosya olmaz)', v.suz.nokta === 'gizli.dxf', v.suz.nokta);
}
{
  // Kaydet: çizimin KENDİ adıyla DXF yazar
  const bekle = page.waitForEvent('download', { timeout: 20000 }).then(d => d.suggestedFilename(), () => null);
  await ev(() => window.dwgApp.editor.act('save'));
  const ad = await bekle;
  ok('3e "Kaydet" çizimin kendi adıyla DXF yazıyor', !!ad && /^example_2000\.dxf$/i.test(ad), String(ad));
}
{
  // Farklı kaydet: ad sorulur ve o ad kullanılır
  await queueAnswers(page, { ad: 'Topagac koprusu', delta: false });
  const bekle = page.waitForEvent('download', { timeout: 20000 }).then(d => d.suggestedFilename(), () => null);
  await ev(() => window.dwgApp.editor.act('saveas'));
  const ad = await bekle;
  ok('3f "Farklı kaydet" verilen adı kullanıyor', !!ad && /^Topagac koprusu\.dxf$/.test(ad), String(ad));
}
{
  // Farklı kaydet'ten vazgeçilirse hiçbir şey yazılmaz
  await queueAnswers(page, null);
  let indi = false;
  const din = () => { indi = true; };
  page.on('download', din);
  await ev(() => window.dwgApp.editor.act('saveas'));
  await page.waitForTimeout(900);
  page.off('download', din);
  ok('3g vazgeçilince dosya yazılmıyor', indi === false, String(indi));
}

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
