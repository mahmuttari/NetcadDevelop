/*
 * 3B SAHNESİ 2B PLANLA AYNI ÇİZİMİ GÖSTERİR.
 *
 * Kullanıcı bildirimi: "Üst görünüm hâlâ problemli" — 2B'de boş görünen bir koridor 3B'de gri bir
 * kütleye dönüşüyordu. Sebep tek bir boşluktu: 3B sahnesi 2B'nin görünürlük ve çizim kurallarının
 * HİÇBİRİNDEN geçmiyordu. editor.refresh3D ham ilkel listesini veriyor, view3d yalnız "sonsuz /
 * görüntü / kapalı katman" eliyordu. Bundan dört ayrı belirti doğuyordu ve dördü de burada sınanır:
 *   1) 2B'de KAPATILAN (tarama, yazı, ölçü, blok) ve GİZLENEN nesneler 3B'de geri geliyordu.
 *   2) Desenli taramanın iki nüshası (desen çizgileri + uzak ölçek dolgusu) 3B'de İKİSİ BİRDEN
 *      çiziliyordu; opak dolgu desenin üstünü kapatıyordu.
 *   3) İlkelin kendi saydamlığı (p.alpha) yok sayılıyordu: %18'lik tarama dolgusu %100 opak oluyordu.
 *   4) Maske (WIPEOUT) arka plan yerine nesnenin kendi rengiyle opak bir yüzeye dönüşüyordu.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_3d_sahne.mjs [çıktı] [örnekler]
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

// 3B'ye bir kez girilir; 2B anahtarları değişince sahne editörün kendi yenileyicisiyle kurulur
const gir3 = async () => { await page.click('#toolbar [data-tab="3d"]'); await page.waitForTimeout(150); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(800); };
const yenile = async () => { const r = await page.evaluate(() => window.dwgApp.editor.yenile3B()); await page.waitForTimeout(250); return r; };
const sayac = () => page.evaluate(() => { const v = window.dwgApp.editor.view3d(); return { cizgi: v.counts.lines, ucgen: v.counts.tris, nokta: v.counts.pts, kose: v.vertPrim.length }; });

// ---- 1) 2B görünürlük süzgeci 3B'ye de uygulanıyor mu ----------------------------------------
await gir3();
const tam = await sayac();
ok('1a 3B sahne kuruldu', tam.cizgi > 0, JSON.stringify(tam));
await page.evaluate(() => { window.dwgApp.state.show.text = false; window.dwgApp.state.show.dim = false; });
ok('1a2 sahne yenileyicisi çalıştı', await yenile() === true);
const kisitli = await sayac();
ok('1b 2B\'de yazı ve ölçü kapatılınca 3B de onları çizmiyor',
  kisitli.nokta < tam.nokta && kisitli.cizgi < tam.cizgi, JSON.stringify({ tam, kisitli }));
await page.evaluate(() => { window.dwgApp.state.show.text = true; window.dwgApp.state.show.dim = true; });
await yenile();
const geri = await sayac();
ok('1c anahtarlar geri açılınca sahne eski hâline dönüyor', geri.cizgi === tam.cizgi && geri.nokta === tam.nokta, JSON.stringify({ tam, geri }));

// gizlenen nesne (HIDEOBJECTS) 3B'de de gizli
const gizle = await page.evaluate(() => {
  const S = window.dwgApp.state;
  const p = S.scene.layouts[0].prims.find(q => q && q.k === 0 && q.key != null);
  if (!p) return null;
  S.hideObj = S.hideObj || new Set(); S.hideObj.add(p.key);
  return p.key;
});
await yenile();
const gizliSay = await sayac();
ok('1d 2B\'de gizlenen nesne 3B\'de de görünmüyor', gizle == null || gizliSay.kose < tam.kose, JSON.stringify({ tam: tam.kose, gizli: gizliSay.kose }));
await page.evaluate(() => { window.dwgApp.state.hideObj && window.dwgApp.state.hideObj.clear(); });
await yenile();

// ---- 2-4) sentetik sahne: LOD nüshası, saydamlık, maske -------------------------------------
const sent = await page.evaluate(() => {
  const kare = (x0, y0, x1, y1) => [[0, x0, y0, 0], [1, x1, y0, 0], [1, x1, y1, 0], [1, x0, y1, 0]];
  const temel = (o) => ({ k: 0, ops: kare(0, 0, 100, 100), closed: true, fill: true, col: 0xff0000, lay: '0', lt: null, lts: 1, lw: 0, w: 0, alpha: 1, info: { h: 'H', t: 'HATCH' }, et: 'HATCH', bb: [0, 0, 100, 100], ...o });
  const layers = new Map([['0', { name: '0', color: null, visible: true, lw: -1, lt: 'Continuous', count: 1 }]]);
  const v = window.dwgApp.editor.view3d();
  const kur = (prims) => { v.setScene(prims, layers, { dark: true }); return { tris: v._n.tris, alp: v.src.tris.alp ? [...new Set(Array.from(v.src.tris.alp))] : null, rgb: v.src.tris.rgb ? [v.src.tris.rgb[0], v.src.tris.rgb[1], v.src.tris.rgb[2]] : null }; };
  const o = {};
  o.desen = kur([temel({ hp: 5 })]);                                   // yalnız desen nüshası
  o.ikisi = kur([temel({ hp: 5 }), temel({ hpFill: 5, alpha: 0.18 })]); // desen + uzak ölçek dolgusu
  o.saydam = kur([temel({ alpha: 0.18 })]);
  o.maske = kur([temel({ bg: true, col: 0xff0000 })]);
  o.bgTheme = [...v.bgTheme];
  return o;
});
ok('2 desenli taramanın uzak ölçek DOLGUSU 3B\'de atlanıyor (aynı tarama iki kez çizilmiyor)',
  sent.ikisi.tris === sent.desen.tris, JSON.stringify({ yalnizDesen: sent.desen.tris, ikiNusha: sent.ikisi.tris }));
ok('3 ilkelin kendi saydamlığı korunuyor (%18 dolgu 3B\'de de %18)',
  sent.saydam.alp && sent.saydam.alp.length === 1 && Math.abs(sent.saydam.alp[0] - 0.18) < 1e-6, JSON.stringify(sent.saydam.alp));
ok('3b saydamlığı olmayan ilkel opak kalıyor',
  sent.desen.alp && sent.desen.alp.every(a => Math.abs(a - 1) < 1e-6), JSON.stringify(sent.desen.alp));
ok('4 maske (WIPEOUT) nesnenin kendi rengiyle değil ARKA PLAN rengiyle çiziliyor',
  sent.maske.rgb && sent.maske.rgb.every((c, i) => Math.abs(c - sent.bgTheme[i]) < 1e-6), JSON.stringify({ maske: sent.maske.rgb, bg: sent.bgTheme }));

// ---- 5) sınır kutusunda aykırı değer tavanı (2B ile aynı) ------------------------------------
const tavan = await page.evaluate(() => {
  const layers = new Map([['0', { name: '0', color: null, visible: true, lw: -1, lt: 'Continuous', count: 1 }]]);
  const iyi = { k: 0, ops: [[0, 0, 0, 0], [1, 100, 100, 0]], col: 0xffffff, lay: '0', lt: null, lts: 1, lw: 0, w: 0, alpha: 1, info: { h: 'L1', t: 'LINE' }, et: 'LINE', bb: [0, 0, 100, 100] };
  const bozuk = { ...iyi, ops: [[0, 0, 0, 0], [1, 1e30, 1e30, 1e30]], info: { h: 'L2', t: 'LINE' } };
  const v = window.dwgApp.editor.view3d();
  v.setScene([iyi, bozuk], layers, { dark: true });
  return v.bb.slice();
});
ok('5 bozuk bir koordinat 3B sınır kutusunu şişirmiyor (2B\'deki 1e15 tavanı)',
  tavan.every(x => Math.abs(x) <= 1e15) && tavan[3] <= 1000, JSON.stringify(tavan));

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
