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
// 3B dosya bu depoya geldiğinde BOŞ açılıyordu; kusur v7.46'da giderildi ve C bölümü onu
// kalıcı olarak korur. Kök sebep şuydu ve tek satırdı:
//
//   collectRaw3D (worker.js) tarayacağı kökleri kurarken blok tanımlarını
//   lib.dwg_getall_BLOCK_HEADER(dwg) ile alıyordu. O çağrı blok başlığının TİO işaretçisini
//   döndürür; lib.get_first_owned_entity() ise Dwg_Object* bekler. İkisi karışınca yürüyüş
//   her blokta boş dönüyor ve blokların İÇİ HİÇ TARANMIYORDU. Model uzayındaki geometri
//   göründüğü için kusur yıllarca sessiz kaldı — ancak geometrisinin tamamı bloklarda olan
//   bir dosyada ortaya çıktı. Kökler artık nesne dizininden (dwg_get_object + fixedtype 49)
//   toplanıyor; aynı blokta yürüyüş çalışıyor.
//
// Dönüştürücünün POLYLINE_PFACE'i düşürmesi kusur DEĞİLDİR: synthesizeDropped onu yeniden
// kurar ve mesh geometrisi collectRaw3D içinde tepe/yüz alt varlıklarından örülür. O
// mekanizma zaten doğruydu, yalnız beslenmiyordu.
//
// Üçüncü kusur v7.47'de giderildi ve altta duran pompa gövdelerini geri getirdi. Dosyanın 84
// pompa gövdesi AcDbSurface'tir (sınıf 508); LibreDWG'de böyle bir tür yoktur, hepsi UNKNOWN_ENT'e
// düşer ve tek veri kaynakları önizleme (proxy) grafiğidir. O grafik bir metafile başlığıyla açılır
// — [RL toplam uzunluk][RL kayıt sayısı] — ve kayıtlar 8. bayttan sonra gelir; scene.js çözücüyü
// 0. bayttan başlattığı için başlığı kaydın kendisi sanıyordu: "boy" bütün tamponu gösterdiğinden
// akış tek sahte kayıtta yutuluyor, "tür" ise kayıt sayısı olup rastgele bir dala düşüyordu. 1e+279
// mertebesindeki 18 bozuk ilkel de bundandı (case 6'da dönüşüm matrisinin baytları nokta sanılıyordu).
// Başlık atlandığında 84/84 blob tertemiz çözülüyor: 6.426 kayıt, 3.129 kabuk, 429.188 üçgen ve tek
// bozuk koordinat yok. Yüzeyler sıkışık ağ ilkeline (k=5) yazılır; üçgen başına nesne üretilseydi
// telefonda ~280 MB tutardı, şimdi 9,3 MB. extents()'in 1e15 büyüklük denetimi emniyet supabı olarak
// durur ama artık tek bir ilkeli bile elemiyor.
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
  // Mesh'in tepeleri R2004+ düzenindedir: vertex[] dizisinde, ardışık zincirde DEĞİL.
  // Bu dosyanın kimliği budur; kurtarma yolunun doğru dalı sınanmış olur.
  ok('C6 mesh tepeleri dizi düzeninde (R2004+), zincirde değil',
    ic.zincirli === 0, `${ic.zincirli}/${ic.denenen} mesh'te ardışık zincir var`);

  ok('C7 3B geometri ekrana geliyor: 2.300+ ağ ilkeli, 200 binden çok üçgen',
    r.ag >= 2300 && r.gecerliBB >= 2300, `${r.ag} ağ · ${r.gecerliBB} geçerli bb`);
  ok('C8 3B sınırları dosya başlığındaki gerçek ölçüyle aynı (17,6 m × 9,0 m)',
    Math.round(r.ext[0]) === -288 && Math.round(r.ext[2]) === 17288 && Math.round(r.ext[3]) === 8710,
    r.ext.map(x => Math.round(x)).join(' '));
  ok('C9 tek bir bozuk ilkel sınırları uçurmuyor (büyüklük denetimi)',
    Math.abs(r.ext[2]) < 1e9 && Math.abs(r.ext[1]) < 1e9, `${r.ext[1]} … ${r.ext[2]}`);
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

// --- E) Pompa gövdeleri: AcDbSurface proxy grafiğinden gelen eğrisel gövdeler ---------------
// Kullanıcının telefonda gördüğü eksik buydu: kaideler çiziliyor, salyangoz gövdeli dalgıç
// pompalar çıkmıyordu. 84 yüzey tek blokta (G$CEEC95A0C) durur ve model uzayına iki kez konur.
{
  await openFile(page, D3, { timeout: 900000, settle: 200 });
  const r = await durum();
  const px = await page.evaluate(() => {
    const P = window.dwgApp.state.prims || [];
    const q = P.filter(p => p.et === 'ACAD_PROXY_ENTITY');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    let tri = 0, seg = 0, bayt = 0, kotu = 0;
    for (const p of q) {
      x0 = Math.min(x0, p.bb[0]); y0 = Math.min(y0, p.bb[1]); x1 = Math.max(x1, p.bb[2]); y1 = Math.max(y1, p.bb[3]);
      if (p.zmin != null) z0 = Math.min(z0, p.zmin); if (p.zmax != null) z1 = Math.max(z1, p.zmax);
      tri += p.idx ? p.idx.length / 3 : 0; seg += p.seg ? p.seg.length / 6 : 0;
      bayt += (p.vtx ? p.vtx.byteLength : 0) + (p.idx ? p.idx.byteLength : 0) + (p.seg ? p.seg.byteLength : 0);
      for (const v of p.vtx || []) if (!isFinite(v) || Math.abs(v) > 1e6) kotu++;
    }
    return { adet: q.length, k5: q.every(p => p.k === 5), tri, seg, bayt, kotu,
      bb: [x0, y0, x1, y1], z: [z0, z1] };
  });
  ok('E1 84 AcDbSurface iki yerleşimle tanındı (dosya bilgisinde gerçek adıyla)',
    r.tur['SURFACE (önizleme grafiği)'] === 168 && r.tur.ACAD_PROXY_ENTITY_GRAFIK === 168,
    `${r.tur['SURFACE (önizleme grafiği)']} yüzey · ${r.tur.ACAD_PROXY_ENTITY_GRAFIK} grafik`);
  ok('E2 proxy grafiğinden 429.188 üçgen çıktı (metafile başlığı atlanıyor)',
    px.tri === 429188, String(px.tri));
  ok('E3 kenarlar siluet süzgecinden geçti (16.664 = 8.332 × 2 yerleşim)', px.seg === 16664, String(px.seg));
  ok('E4 yüzeyler sıkışık ağ ilkelinde: 168 nesne, 10 MB altı (üçgen başına nesne olsaydı ~280 MB)',
    px.adet === 168 && px.k5 && px.bayt < 10 * 1024 * 1024, `${px.adet} ilkel · ${(px.bayt / 1048576).toFixed(1)} MB`);
  ok('E5 tek bozuk koordinat yok (eskiden 1e+279 mertebesinde 18 ilkel vardı)', px.kotu === 0, String(px.kotu));
  ok('E6 pompalar yerinde: iki kaide arasında, su altında (Z −2999 … +45)',
    Math.round(px.bb[0]) === 3124 && Math.round(px.bb[2]) === 13691
    && Math.round(px.z[0]) === -2999 && Math.round(px.z[1]) === 45,
    `${px.bb.map(v => Math.round(v)).join(' ')} · z ${px.z.map(v => Math.round(v)).join(' … ')}`);
  ok('E7 model sınırları pompalarla birlikte gerçek ölçüde kaldı',
    Math.round(r.ext[2]) === 17288 && Math.abs(r.ext[0]) < 1e6, r.ext.map(x => Math.round(x)).join(' '));
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
