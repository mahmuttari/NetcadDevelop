/*
 * v7.74 / v7.75 — son iki günün denetiminde doğrulanan dokuz kusurun düzeltmesi:
 *   1. Komut satırından açılır kutu isteyen komutlar (VS / VSCURRENT / HIDE / RENDER / SECTIONPLANE)
 *      çapa düğmesi olmadığı için çöküyordu (openPop → anchor.getBoundingClientRect).
 *   2. Özellikler paletinde yalnız renk / çizgi tipi / kalınlık değişince bütün seçim ilk nesnenin
 *      katmanına taşınıyordu (props komutuna her zaman layer konuyordu).
 *   3. ed.dxfBase64 blok düzenleyici oturumunda kapılanmıyordu: Drive'a blok içeriği yüklenirdi.
 *   4. i18n'de layerExists anahtarı iki kez tanımlıydı (ilk, açıklayıcı metin ölüydü).
 *   5. WebDAV "Cihazdan dosya seç ve yükle" düğmesi hiçbir şey yapmıyordu (api.pickForCloud yoktu).
 *   6. Blok tanımı kendine başvurabiliyordu: bir bloğun yerleştirmesi seçilip aynı adla blok
 *      yapılınca tanım kendini içerir; genişletme her düzeyde yeniden açılır ve uygulama kilitlenir.
 *   7. Var olan bir blok adının üzerine yazınca çizimdeki yerleştirmeler eski tanımı göstermeye
 *      devam ediyordu (blockdef'in yanında blocksync yoktu).
 *   8. Masaüstünde BOŞLUK çalışan komutu bitirmek yerine son komutu yineliyordu (AutoCAD'de
 *      boşluk komut içinde ENTER'dır).
 *   9. Kalem HAVADA gezinirken bütün parmak dokunuşları avuç reddine takılıyordu; stylus.js'in
 *      kendi sözleşmesi "havada gezinme bloklamaz" derken watch() sağır süreyi gezinmede de
 *      yeniliyordu.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_denetim.mjs [çıktı] [örnekler]
 */
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
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
const J = JSON.stringify;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const komut = async (s) => { await page.fill('#cmdInput', s); await bekle(80); await page.click('#cmdEnter'); await bekle(300); };
const popAcik = () => ev(() => { const p = document.getElementById('tbPop'); return p ? { acik: !p.hidden, n: p.querySelectorAll('button,[data-opt],[data-vs]').length } : null; });
const kapat = () => ev(() => { const p = document.getElementById('tbPop'); if (p) { p.hidden = true; p.innerHTML = ''; } document.getElementById('toast').hidden = true; });

// ---------------------------------------------------------------------------------
// 1 · Komut satırından açılır kutu: çapa yok, yine de açılır ve sayfa hatası vermez
// ---------------------------------------------------------------------------------
{
  await ev(async () => { const E = await import('./editor.js'); E.ui.cmdLine = false; window.dwgApp.editor.act('cmdline'); });
  await bekle(300);
  ok('1a komut satırı açık', !(await ev(() => document.getElementById('cmdBar').hidden)), '');
  for (const [cmd, ad] of [['VS', 'görsel stil'], ['HIDE', 'gizli'], ['RENDER', 'gerçekçi'], ['SPLANE', 'kesit']]) {
    const n0 = errors.length;
    await komut(cmd);
    const p = await popAcik();
    ok(`1 komut satırı "${cmd}" (${ad}): kutu açıldı, sayfa hatası yok`, !!p && p.acik && p.n > 0 && errors.length === n0, J([p, errors.slice(n0)]));
    await kapat();
  }
  await shot('denetim_pop');
}

// ---------------------------------------------------------------------------------
// 2 · Özellikler: çok katmanlı seçimde yalnız renk değişince katman KORUNUR
// ---------------------------------------------------------------------------------
{
  const hazir = await ev(() => {
    const S = window.dwgApp.state, E = window.dwgApp.editor;
    const kat = [...S.layers.keys()].filter(k => S.prims.some(p => p.lay === k && p.k === 0));
    if (kat.length < 2) return null;
    const a = S.prims.find(p => p.lay === kat[0] && p.k === 0), b = S.prims.find(p => p.lay === kat[1] && p.k === 0);
    E.sel.clear(); E.sel.add(a); E.sel.add(b);
    return { keys: [a.key, b.key], lay: [a.lay, b.lay] };
  });
  ok('2a iki ayrı katmandan birer nesne seçildi', !!hazir && hazir.lay[0] !== hazir.lay[1], J(hazir));
  await ev(() => { const E = window.dwgApp.editor; document.getElementById('infoPanel').hidden = true; E.act('props'); });
  await bekle(250);
  await ev(() => { const b = document.querySelector('#docBody [data-ci="1"]'); if (b) b.click(); document.getElementById('pOk').click(); });
  await bekle(250);
  const sonra = await ev((ks) => ks.map(k => { const p = window.dwgApp.state.prims.find(q => q.key === k); return { lay: p.lay, ci: p.info && p.info.ci }; }), hazir.keys);
  ok('2b yalnız renk uygulandı (ACI 1), her nesne KENDİ katmanında kaldı', sonra.every(x => x.ci === 1) && sonra[0].lay === hazir.lay[0] && sonra[1].lay === hazir.lay[1], J([hazir.lay, sonra]));
  await ev(() => { window.dwgApp.editor.act('undo'); window.dwgApp.editor.sel.clear(); });
  await bekle(150);
}

// ---------------------------------------------------------------------------------
// 3 · dxfBase64 blok düzenleyici oturumunda kapılı
// ---------------------------------------------------------------------------------
{
  const once = await ev(() => { const r = window.dwgApp.editor.dxfBase64(false); return r ? r.name : null; });
  ok('3a oturum yokken DXF üretilir', !!once, String(once));
  const acildi = await ev(() => {
    const S = window.dwgApp.state, E = window.dwgApp.editor;
    const keys = S.prims.filter(p => p.k === 0).slice(0, 2).map(p => p.key);
    E.runCmd({ op: 'blockdef', name: 'DENEME', def: { name: 'DENEME', base: [0, 0, 0], ents: [{ type: 'LINE', id: 'd1', layer: '0', color: 256, pts: [[0, 0, 0], [10, 0, 0]] }], dyn: null } });
    return E.beditStart('DENEME', {});
  });
  await bekle(300);
  const kapali = await ev(() => window.dwgApp.editor.dxfBase64(false));
  ok('3b oturum açıkken dxfBase64 null döner (Drive\'a blok içeriği yüklenmez)', acildi && kapali === null, J([acildi, kapali]));
  await ev(() => window.dwgApp.editor.beditClose());
  await bekle(300);
  const geri = await ev(() => { const r = window.dwgApp.editor.dxfBase64(false); return r ? r.name : null; });
  ok('3c oturum kapanınca yine üretilir', !!geri, String(geri));
}

// ---------------------------------------------------------------------------------
// 4 · i18n: layerExists tek tanım (TR + EN); çift tanımda ikincisi ilkini sessizce ezerdi
// ---------------------------------------------------------------------------------
{
  const n = await ev(async () => {
    const src = await (await fetch('i18n.js')).text();
    return (src.match(/\blayerExists:/g) || []).length;
  });
  ok('4a layerExists yalnız iki kez tanımlı (TR ve EN sözlüklerinde birer kez)', n === 2, String(n));
  const dup = await ev(async () => {
    const src = await (await fetch('i18n.js')).text();
    const say = {};
    for (const m of src.matchAll(/^\s*([A-Za-z_][\w]*):\s/gm)) say[m[1]] = (say[m[1]] || 0) + 1;
    return Object.entries(say).filter(([, v]) => v > 2).map(([k, v]) => k + '×' + v);
  });
  ok('4b hiçbir anahtar ikiden fazla tanımlı değil (sessiz eziyor yok)', dup.length === 0, J(dup));
}

// ---------------------------------------------------------------------------------
// 5 · WebDAV "Cihazdan dosya seç ve yükle": app.js → home.js → cloud.js bağı kurulu
// ---------------------------------------------------------------------------------
{
  const z = await ev(async () => {
    const g = async (f) => (await (await fetch(f)).text());
    const app = await g('app.js'), home = await g('home.js'), cloud = await g('cloud.js');
    return {
      appTanim: /pickForCloud:\s*\(\)\s*=>\s*pickFile\('wdupload'/.test(app),
      appAndroid: /purpose === 'wdupload'[\s\S]{0,200}Cloud\.uploadPicked/.test(app),
      appTarayici: /purpose === 'wdupload'\)\s*await Cloud\.uploadPicked/.test(app),
      homeGecis: /pickForCloud:\s*api\.pickForCloud/.test(home),
      cloudKullanim: /api\.pickForCloud\(\)/.test(cloud),
      cloudDisaVer: /export async function uploadPicked/.test(cloud),
    };
  });
  ok('5 seçici bağı uçtan uca kurulu (tanım, Android yolu, tarayıcı yolu, aktarım, kullanım, dışa verim)',
     Object.values(z).every(Boolean), J(z));
}

// ---------------------------------------------------------------------------------
// 6 · Blok tanımı kendine başvuramaz (saf modül: blocks.refersTo)
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const B = await import('./blocks.js');
    const blocks = new Map([
      ['A', { name: 'A', base: [0, 0, 0], ents: [{ type: 'INSERT', name: 'B', id: 'i1' }] }],
      ['B', { name: 'B', base: [0, 0, 0], ents: [{ type: 'LINE', pts: [[0, 0, 0], [1, 1, 0]] }] }],
      ['C', { name: 'C', base: [0, 0, 0], ents: [{ type: 'INSERT', name: 'C', id: 'i9' }] }],   // zaten döngülü: gezinme takılmamalı
    ]);
    const L = [{ type: 'LINE', pts: [[0, 0, 0], [1, 0, 0]] }];
    return {
      dogrudan: B.refersTo('A', [{ type: 'INSERT', name: 'a', id: 'x' }], blocks),   // ad büyük/küçük duyarsız
      icice: B.refersTo('B', [{ type: 'INSERT', name: 'A', id: 'x' }], blocks),      // A içinde B var → B kendine döner
      temiz: B.refersTo('Z', [{ type: 'INSERT', name: 'A', id: 'x' }, ...L], blocks),
      duz: B.refersTo('A', L, blocks),
      donguluTanim: B.refersTo('Z', [{ type: 'INSERT', name: 'C', id: 'x' }], blocks),   // sonsuz döngü olmadan false
    };
  });
  ok('6a kendine doğrudan başvuru yakalanır (ad büyük/küçük duyarsız)', r.dogrudan === true, J(r));
  ok('6b iç içe blok üzerinden dolaylı başvuru yakalanır', r.icice === true, J(r));
  ok('6c ilgisiz blok ve düz nesneler engellenmez', r.temiz === false && r.duz === false, J(r));
  ok('6d kendi içinde döngülü bir tanımı gezmek asılmaz', r.donguluTanim === false, J(r));
  const src = await ev(async () => ({
    make: /B\.refersTo\(name, ents, S\.blocks\)/.test(await (await fetch('editor.js')).text()),
    bedit: /B\.refersTo\(s\.name, ents, S\.blocks\)/.test(await (await fetch('editor.js')).text()),
  }));
  ok('6e BLOCK ve BEDIT kaydı bu denetimden geçer', src.make && src.bedit, J(src));
}

// ---------------------------------------------------------------------------------
// 7 · Var olan bloğun üzerine yazınca yerleştirmeler tazelenir (blockdef + blocksync)
// ---------------------------------------------------------------------------------
{
  const z = await ev(async () => {
    const src = await (await fetch('editor.js')).text();
    const i = src.indexOf('function blockMake(');
    const g = src.slice(i, i + 1200);
    return { vardi: /const vardi = S\.blocks\.has\(blkKey\(def\.name\)\)/.test(g), sync: /if \(vardi\) cmds\.push\(\{ op: 'blocksync'/.test(g) };
  });
  ok('7 BLOCK üzerine yazma yerleştirmeleri tazeler', z.vardi && z.sync, J(z));
}

// ---------------------------------------------------------------------------------
// 8 · Masaüstü: BOŞLUK çalışan komutu bitirir (AutoCAD), komut yokken son komutu yineler
// ---------------------------------------------------------------------------------
{
  const z = await ev(async () => {
    const src = await (await fetch('editor.js')).text();
    return {
      bitirir: /if \(\(k === 'Enter' \|\| k === ' '\) && tools\.running\)/.test(src),
      yineler: /if \(\(k === 'Enter' \|\| k === ' '\) && deskAktif\(\) && cmdLast\)/.test(src),
      sira: src.indexOf("tools.running) { if (!(tools.enterEmpty") < src.indexOf('deskAktif() && cmdLast'),
    };
  });
  ok('8 boşluk: araç çalışırken bitirir, çalışmıyorken yineler (bitiren dal önce)', z.bitirir && z.yineler && z.sira, J(z));
}

// ---------------------------------------------------------------------------------
// 9 · Avuç reddi: kalem HAVADA gezinirken parmak dokunuşu engellenmez, TEMAS engeller
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const { PalmGuard } = await import('./stylus.js');
    const g = new PalmGuard();
    const kalem = (id, buttons) => ({ pointerType: 'pen', pointerId: id, buttons, width: 1, height: 1 });
    const parmak = (id, w = 10) => ({ pointerType: 'touch', pointerId: id, width: w, height: w });
    // 1) gezinme (buttons 0) — sağır süre başlamaz
    g.watch(kalem(1, 0), 1000);
    const gezinme = g.down(parmak(11), 1010, []).block;
    // 2) gezinme sırasında GENİŞ temas yine avuçtur
    const genisTemas = g.down(parmak(12, 60), 1020, []).block;
    // 3) kalem TEMASI: parmak engellenir
    g.down(kalem(2, 1), 2000, []);
    const temas = g.down(parmak(13), 2010, []).block;
    // 4) kalem kalkınca sağır süre o anda başlar, 700 ms sonra parmak geçer
    g.up(kalem(2, 0), 3000);
    const hemen = g.down(parmak(14), 3100, []).block;
    const sonra = g.down(parmak(15), 3800, []).block;
    return { gezinme, genisTemas, temas, hemen, sonra };
  });
  ok('9a kalem havada gezinirken parmak dokunuşu geçer (iki parmakla yakınlaştırma çalışır)', r.gezinme === false, J(r));
  ok('9b gezinme sırasında bile GENİŞ temas (avuç) elenir', r.genisTemas === true, J(r));
  ok('9c kalem ekrana değerken parmak elenir', r.temas === true, J(r));
  ok('9d kalem kalktıktan hemen sonra elenir, sağır süre dolunca geçer', r.hemen === true && r.sonra === false, J(r));
}

await browser.close();
await srv.kill();
C.summary(errors);
C.exit();
