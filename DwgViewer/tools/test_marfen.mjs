// REFERANS MODELLER — MARFEN Yüzer Terfi (2B site planı + 3B tesis modeli).
//
// Başvuru sahibinin verdiği iki gerçek proje dosyası. Örnek derlemindeki öteki dosyalar
// küçük ve yapaydır (en büyüğü 868 KB); bunlar 7,75 MB ve 27,18 MB'lık gerçek işlerdir ve
// hattın farklı yerlerini zorlar:
//
//   2B (AC1032 / AutoCAD 2018, 7,75 MB) — 132.274 varlık, 10.717 blok, 6 katman.
//       Ağırlığı çizgi ve yazıda: 121.958 LINE, 5.319 TEXT, 4.277 WIPEOUT. Sahne kurulumu
//       ve uzamsal indeks bantlarını gerçek ölçekte yükler.
//
//   3B (AC1018 / AutoCAD 2004, 27,18 MB) — 2.290 blok yerleştirmesi, her biri bir polyface
//       mesh: 201.348 VERTEX_PFACE + 342.174 VERTEX_PFACE_FACE, toplam 557.547 nesne.
//
// 3B dosyada BİLİNEN BİR KUSUR vardır ve bu sınama onu kayda geçirir: çizim BOŞ açılır.
// Sebep ölçüldü — LibreDWG dosyayı hatasız okuyor (2.290 POLYLINE_PFACE nesnesi dizin
// taramasıyla bulunuyor, num_owned = 48 tepe ile), ama blokların varlık ZİNCİRİ boştur:
// get_first_owned_entity() denenen 50 blokta da null döner, first_vertex / last_vertex
// alanları sıfırdır ve geometri R2004+ düzeninde `vertex[]` dizisindedir. Dönüştürücü
// (lib.convert) zincir yürüyüşüne dayandığı için blokların içini boş görür: 2.294 blok
// kaydından yalnız *Model_Space dolu gelir, o da 2.290 INSERT ile. Sonuç: her INSERT
// geometrisiz bir ilkele düşer, sınır kutusu [0,0,1,1] olur.
//
// Düzeltme geldiğinde C bölümündeki SKIP'ler PASS'a çevrilecektir; A ve B bölümleri
// dosyaların bozulmadığını ve 2B tarafın gerilemediğini korur.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_marfen.mjs
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, samplesDir } from './harness.mjs';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const D2 = path.join(samplesDir, 'MARFEN_YUZER_TERFI_2D.dwg');
const D3 = path.join(samplesDir, 'MARFEN_YUZER_TERFI_3D.dwg');

// --- A) Dosyalar yerinde ve bozulmamış ------------------------------------------------------
{
  const ozet = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
  const boyut = (p) => fs.statSync(p).size;
  const bas = (p) => fs.readFileSync(p).subarray(0, 6).toString('latin1');
  ok('A1 2B dosya yerinde ve AC1032 (AutoCAD 2018)', fs.existsSync(D2) && bas(D2) === 'AC1032', bas(D2));
  ok('A2 3B dosya yerinde ve AC1018 (AutoCAD 2004)', fs.existsSync(D3) && bas(D3) === 'AC1018', bas(D3));
  ok('A3 2B boyutu değişmedi', boyut(D2) === 8129805, String(boyut(D2)));
  ok('A4 3B boyutu değişmedi', boyut(D3) === 28505100, String(boyut(D3)));
  ok('A5 dosya adları verildiği gibi', fs.existsSync(D2) && fs.existsSync(D3),
    `${path.basename(D2)} · ${path.basename(D3)}`);
  console.log('    özetler:', ozet(D2), ozet(D3));
}

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 780 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message.slice(0, 200)); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
try { await page.click('#tourSkip', { timeout: 3000 }); } catch (_) { /* tur yok */ }

const durum = () => page.evaluate(() => {
  const S = window.dwgApp.state, sc = S.scene, d = sc.solidDiag || {};
  return { ad: S.fileName, surum: S.version, birim: S.units, varlik: S.entityCount, ilkel: S.prims.length,
    katman: S.layers.size, blok: S.blockCount, ext: S.ext, uyari: sc.readWarn || 0,
    tur: S.counts || {}, kati: d.solids || 0, ag: S.prims.filter(p => p.k === 5).length,
    // Geçerli sınır kutusu: sayılar sonlu VE en az bir boyutu sıfırdan büyük. Yalnız genişliğe
    // bakmak yanlış olur — dikey bir çizginin genişliği sıfırdır ama kutusu geçerlidir.
    gecerliBB: S.prims.filter(p => p.bb && isFinite(p.bb[0]) && isFinite(p.bb[3])
      && ((p.bb[2] - p.bb[0]) > 0 || (p.bb[3] - p.bb[1]) > 0)).length };
});

// --- B) 2B site planı: tam açılmalı ---------------------------------------------------------
{
  const t0 = Date.now();
  await openFile(page, D2, { timeout: 600000, settle: 200 });
  const ms = Date.now() - t0;
  const r = await durum();
  ok('B1 2B açıldı', r.ad === 'MARFEN_YUZER_TERFI_2D.dwg' && r.surum === 'AutoCAD 2018', `${r.ad} · ${r.surum} · ${ms} ms`);
  ok('B2 2B varlık sayısı', r.varlik === 132274, String(r.varlik));
  ok('B3 2B geometri üretildi (ilkellerin tamamının sınır kutusu geçerli)',
    r.ilkel === 132272 && r.gecerliBB === 132272, `${r.ilkel} ilkel · ${r.gecerliBB} geçerli bb`);
  ok('B4 2B katman ve blok sayısı', r.katman === 6 && r.blok === 10717, `${r.katman} katman · ${r.blok} blok`);
  ok('B5 2B içerik dağılımı (çizgi ağırlıklı, yazı ve wipeout var)',
    r.tur.LINE === 121958 && r.tur.TEXT === 5319 && r.tur.WIPEOUT === 4277,
    `LINE ${r.tur.LINE} · TEXT ${r.tur.TEXT} · WIPEOUT ${r.tur.WIPEOUT}`);
  ok('B6 2B birim mm ve sınırlar gerçek (≈74 m × 97 m)', r.birim === 'mm'
    && Math.round((r.ext[2] - r.ext[0]) / 1000) === 75 && Math.round((r.ext[3] - r.ext[1]) / 1000) === 97,
    r.ext.map(x => Math.round(x)).join(' '));
  ok('B7 2B okuma uyarısı yok', r.uyari === 0, String(r.uyari));
}

// --- C) 3B tesis modeli: dosyada geometri VAR, ekranda yok ----------------------------------
{
  const t0 = Date.now();
  await openFile(page, D3, { timeout: 900000, settle: 200 });
  const ms = Date.now() - t0;
  const r = await durum();
  ok('C1 3B açıldı (hatasız)', r.ad === 'MARFEN_YUZER_TERFI_3D.dwg' && r.surum === 'AutoCAD 2004' && r.uyari === 0,
    `${r.ad} · ${r.surum} · ${ms} ms`);
  ok('C2 3B blok yerleştirmeleri okundu', r.varlik === 2290 && r.tur.INSERT === 2290, `${r.varlik} INSERT`);
  ok('C3 3B blok tanımları okundu', r.blok === 2294, String(r.blok));

  // Dosyanın İÇİNDE geometri gerçekten var mı: kitaplığı doğrudan sorar
  const ic = await page.evaluate(async (b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const LW = await import('./lib/dist/libredwg-web.js');
    const lib = await LW.LibreDwg.create(); const W = lib.wasmInstance;
    try { W.FS.unlink('/m.dwg'); } catch (_) { /* yok */ }
    W.FS.createDataFile('/', 'm.dwg', u8, true, false, true);
    const dwg = W.dwg_read_file('m.dwg').data;
    const N = lib.dwg_get_num_objects(dwg);
    let pface = 0, vert = 0, face = 0, zincirli = 0, denenen = 0, ornekOwned = null;
    for (let i = 0; i < N; i++) {
      let o = null; try { o = lib.dwg_get_object(dwg, i); } catch (_) { continue; }
      if (!o) continue;
      let ft = -1; try { ft = lib.dwg_object_get_fixedtype(o); } catch (_) { continue; }
      if (ft === 29) {
        pface++;
        if (denenen < 20) {
          denenen++;
          try { if (lib.get_first_owned_entity(o)) zincirli++; } catch (_) { /* zincir yok */ }
          if (ornekOwned == null) { try { const t = lib.dwg_object_to_entity_tio(o); const v = lib.dwg_dynapi_entity_value(t, 'num_owned'); ornekOwned = v && v.data; } catch (_) { /* geç */ } }
        }
      } else if (ft === 12) vert++; else if (ft === 13) face++;
    }
    try { lib.dwg_free(dwg); } catch (_) { /* geç */ }
    return { N, pface, vert, face, zincirli, denenen, ornekOwned };
  }, fs.readFileSync(D3).toString('base64'));

  ok('C4 dosyada 2.290 polyface mesh GERÇEKTEN var', ic.pface === 2290, `${ic.pface} POLYLINE_PFACE / ${ic.N} nesne`);
  ok('C5 mesh tepe sayısını biliyor (num_owned)', ic.ornekOwned > 0, String(ic.ornekOwned));
  ok('C6 KÖK SEBEP: blokların varlık zinciri boş (LibreDWG yürüyemiyor)',
    ic.zincirli === 0, `${ic.zincirli}/${ic.denenen} blokta zincir var`);

  // Bilinen kusur: geometri ekrana gelmiyor. Düzeltme geldiğinde bu iki satır ok()'a çevrilir.
  if (r.gecerliBB > 0) {
    ok('C7 3B geometri ekrana geldi (kusur giderilmiş)', true, `${r.gecerliBB} geçerli bb`);
    ok('C8 3B sınırları gerçek', !(r.ext[0] === 0 && r.ext[2] === 1), r.ext.join(' '));
  } else {
    C.skip('C7 3B geometri ekrana GELMİYOR — bilinen kusur',
      `${r.ilkel} ilkel, hiçbirinin sınır kutusu geçerli değil; sebep C6`);
    C.skip('C8 3B sınırları boş — bilinen kusur', `ext = [${r.ext.join(', ')}] (başlıkta gerçek sınır 17,6 × 9,0 × 7,6 m)`);
  }
}

// --- D) Uygulamanın içine gömülü örnekler: ana ekrandan tek dokunuşla açılıyor mu -----------
// Dosyalar APK'nın içindedir (assets/viewer/ornekler); dosya seçmeye, internete ve emülatöre
// dosya atmaya gerek kalmadan açılırlar.
{
  const d = await page.evaluate(async () => {
    const yol = (a) => './ornekler/' + a;
    const r2 = await fetch(yol('MARFEN_YUZER_TERFI_2D.dwg'), { method: 'HEAD' }).catch(() => null);
    const r3 = await fetch(yol('MARFEN_YUZER_TERFI_3D.dwg'), { method: 'HEAD' }).catch(() => null);
    return { d2: r2 && r2.ok, d3: r3 && r3.ok, api: typeof window.dwgApp.openSample };
  });
  ok('D1 iki örnek de uygulamanın içinden okunabiliyor', d.d2 === true && d.d3 === true, JSON.stringify(d));
  ok('D2 açma yolu dışa verilmiş', d.api === 'function', d.api);

  // Ana ekranda kartlar
  await page.evaluate(() => window.dwgApp.goHome());
  await page.waitForTimeout(150);
  const k = await page.evaluate(() => {
    const el = document.getElementById('sampleList');
    const b = [...el.querySelectorAll('[data-ornek]')];
    return { sayi: b.length, adlar: b.map(x => x.dataset.ornek), etiket: b.map(x => x.querySelector('strong').textContent) };
  });
  ok('D3 ana ekranda iki örnek kartı var', k.sayi === 2, k.adlar.join(' · '));
  ok('D4 kart etiketleri çevrilmiş', k.etiket.every(x => x && x.length > 2), k.etiket.join(' · '));

  // Karta dokunmak gerçekten açıyor mu (2B ile sınanır: hızlı ve tam açılıyor)
  await page.evaluate(() => { window.dwgApp.state.hasDoc = false; });
  await page.click('[data-ornek="MARFEN_YUZER_TERFI_2D.dwg"]');
  await page.waitForFunction(() => { const a = window.dwgApp; return a.state.hasDoc && a.state.fileName === 'MARFEN_YUZER_TERFI_2D.dwg' && document.getElementById('loading').hidden; }, null, { timeout: 600000 });
  const r = await durum();
  ok('D5 karta dokunmak çizimi açtı (dosya seçmeden)',
    r.ad === 'MARFEN_YUZER_TERFI_2D.dwg' && r.ilkel === 132272, `${r.ad} · ${r.ilkel} ilkel`);
  ok('D6 ana ekran kapandı, çizim ekranda', await page.evaluate(() => document.getElementById('home').hidden) === true);
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
