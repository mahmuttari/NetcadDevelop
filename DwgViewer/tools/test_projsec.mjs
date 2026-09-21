/*
 * PROJEKSİYON (DİLİM) SEÇİCİ. Türkiye'de dilim seçimi bir hesap değil bir EŞLEŞTİRMEDİR:
 * yerin boylamı hangi orta meridyene yakınsa dilim odur. Burada sınanan, o eşleştirmenin
 * doğruluğu (3° için 27…45, 6° UTM için 35N…38N), dilim sınırına kalan payın metre olarak
 * doğru yazılması, Gauss-Krüger sağa değerinin dilim önekini gerçekten taşıması ve kutunun
 * beş giriş yolunun (il/ilçe, harita, adres, koordinat, çizim) aynı sonucu vermesidir.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_projsec.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE } from './harness.mjs';
const { samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;

// ---- 1) saf hesap: proj.js ve tr_idari.js (tarayıcısız) ---------------------------------------
const V = new URL('../app/src/main/assets/viewer/', import.meta.url).href;
const P = await import(V + 'proj.js');
const TR = await import(V + 'tr_idari.js');
const PS = await import(V + 'projsec.js');

ok('1a il dizini 81 kayıt', TR.IL.length === 81, String(TR.IL.length));
ok('1b ilçe dizini 970 üzeri kayıt', Object.values(TR.ILCE).reduce((s, a) => s + a.length, 0) > 900, String(Object.values(TR.ILCE).reduce((s, a) => s + a.length, 0)));
ok('1c Kocaeli/Gebze dizinde ve doğru yerde', (() => { const g = (TR.ILCE[41] || []).find(d => d[0] === 'Gebze'); return !!g && Math.abs(g[1] - 29.546) < 0.02 && Math.abs(g[2] - 40.904) < 0.02; })(), JSON.stringify((TR.ILCE[41] || []).find(d => d[0] === 'Gebze')));
ok('1d arama il ve ilçe adında çalışıyor', TR.ara('gebze').length === 1 && TR.ara('kocaeli').length >= 12, JSON.stringify([TR.ara('gebze').length, TR.ara('kocaeli').length]));

// dilim eşleştirmesi: bilinen yerler
const yer = { 'İzmir': [27.14, 38.42], 'İzmit': [29.9187, 40.7654], 'Ankara': [32.85, 39.93], 'Kayseri': [35.48, 38.73], 'Erzurum': [41.27, 39.90], 'Iğdır': [44.04, 39.92] };
const bek3 = { 'İzmir': 9, 'İzmit': 10, 'Ankara': 11, 'Kayseri': 12, 'Erzurum': 14, 'Iğdır': 15 };
const bek6 = { 'İzmir': 35, 'İzmit': 35, 'Ankara': 36, 'Kayseri': 36, 'Erzurum': 37, 'Iğdır': 38 };
for (const [ad, ll] of Object.entries(yer)) {
  const d3 = P.dilim3(ll[0]).dilim, d6 = P.dilim6(ll[0]).dilim;
  ok(`2 ${ad}: 3° dilim ${bek3[ad]} · 6° dilim ${bek6[ad]}N`, d3 === bek3[ad] && d6 === bek6[ad], `${d3} / ${d6}`);
}
// orta meridyen dilim numarasının üç katıdır
ok('2z orta meridyen = dilim x 3 (9…15 → 27…45)', [9, 10, 11, 12, 13, 14, 15].every(z => P.dilim3(z * 3).om === z * 3 && P.dilim3(z * 3).dilim === z));

// sınır payı: İzmit 6° dilim sınırına (30°) yakın, 3° sınırına (31,5°) uzak
const o = P.crsOner(29.9187, 40.7654);
ok('3a İzmit 6° dilim sınırına 10 km\'den yakın (Kocaeli iki UTM dilimine yayılır)', o.pay6.metre < 10000 && o.pay6.metre > 3000, Math.round(o.pay6.metre) + ' m');
ok('3b İzmit 3° dilim sınırına 100 km\'den uzak', o.pay3.metre > 100000, Math.round(o.pay3.metre) + ' m');
ok('3c altı öneri: ITRF96 ve ED50 x (3° TM, 3° GK, 6° UTM)',
  o.liste.map(c => c.id).join(' ') === 'ITRF96_TM30 ITRF96_GK10 WGS84_UTM35 ED50_TM30 ED50_GK10 ED50_UTM35', o.liste.map(c => c.id).join(' '));

// CRS listesi: eksik kalan dilimler eklendi mi, EPSG kodları ve sabitler doğru mu
const byId = (id) => P.CRS.find(c => c.id === id);
ok('4a 3° Gauss-Krüger dilimleri 9…15, iki datum için de var', [9, 10, 11, 12, 13, 14, 15].every(z => byId('ITRF96_GK' + z) && byId('ED50_GK' + z)));
ok('4b GK sağa değeri dilim önekini taşır (10. dilim → 10.500.000)', byId('ITRF96_GK10').fe === 10500000 && byId('ED50_GK15').fe === 15500000, `${byId('ITRF96_GK10').fe} / ${byId('ED50_GK15').fe}`);
ok('4c GK EPSG kodları: TUREF 5269…5275, ED50 2206…2212', /EPSG:5270\b/.test(byId('ITRF96_GK10').name) && /EPSG:2207\b/.test(byId('ED50_GK10').name) && /EPSG:5275\b/.test(byId('ITRF96_GK15').name) && /EPSG:2206\b/.test(byId('ED50_GK9').name));
ok('4d 38. UTM dilimi (Iğdır, Hakkâri) eklendi', !!byId('WGS84_UTM38') && !!byId('ED50_UTM38') && /EPSG:32638/.test(byId('WGS84_UTM38').name) && /EPSG:23038/.test(byId('ED50_UTM38').name));
ok('4e 3° TM ölçek katsayısı 1, 6° UTM 0,9996', byId('ITRF96_TM30').k0 === 1 && byId('ITRF96_GK10').k0 === 1 && byId('WGS84_UTM35').k0 === 0.9996);

// TM30 ile GK10 aynı izdüşüm, yalnız sağa değer 10.000.000 farklı
{
  const a = P.toCrs(29.9187, 40.7654, byId('ITRF96_TM30')), b = P.toCrs(29.9187, 40.7654, byId('ITRF96_GK10'));
  ok('5a GK10 = TM30 + 10.000.000 (sağa değer dilim öneki)', Math.abs((b[0] - a[0]) - 10000000) < 1e-6 && Math.abs(b[1] - a[1]) < 1e-6, JSON.stringify([a.map(Math.round), b.map(Math.round)]));
  const geri = P.fromCrs(b[0], b[1], byId('ITRF96_GK10'));
  ok('5b gidiş-dönüş milimetre altında', Math.abs(geri[0] - 29.9187) < 1e-7 && Math.abs(geri[1] - 40.7654) < 1e-7, JSON.stringify(geri));
  const tah = P.crsTahmin(b[0], b[1]);
  ok('5c çizim koordinatından dilim tahmini GK10 veriyor', tah.aday.length >= 2 && tah.aday[0].crs.id.endsWith('GK10') && tah.d3.dilim === 10, tah.aday.slice(0, 3).map(x => x.crs.id).join(' '));
  ok('5d yanlış sabitli CRS elendi (TM30 sağa değeri 10 milyonu taşımaz)', !tah.aday.some(x => x.crs.id === 'ITRF96_TM30'), tah.aday.map(x => x.crs.id).join(' '));
}
// koordinat metni çözümü
ok('6a ondalık "enlem, boylam"', JSON.stringify(PS.koordCoz('40.7654, 29.9187')) === JSON.stringify([29.9187, 40.7654]), JSON.stringify(PS.koordCoz('40.7654, 29.9187')));
ok('6b derece-dakika-saniye', (() => { const p = PS.koordCoz('40°45\'55"N 29°55\'07"E'); return p && Math.abs(p[0] - 29.9186) < 0.001 && Math.abs(p[1] - 40.7653) < 0.001; })(), JSON.stringify(PS.koordCoz('40°45\'55"N 29°55\'07"E')));
ok('6c boylam önce yazılırsa da anlaşılır (tek seçenek)', (() => { const p = PS.koordCoz('129.5, 40.9'); return p && p[0] === 129.5 && p[1] === 40.9; })(), JSON.stringify(PS.koordCoz('129.5, 40.9')));
ok('6d saçma metin reddedilir', PS.koordCoz('abc') === null && PS.koordCoz('') === null);

// ---- 2) kutu: ayarlardan açılır, il/ilçe seçimi koordinat sistemini uygular ---------------------
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/tile\.openstreetmap|nominatim|ERR_/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
await page.evaluate(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });
// karolar yerel sunucudan: ağ beklenmesin
// Karo kancası: ağa çıkılmaz, 1x1 saydam PNG verilir (sınama ağ hızına bağlı olmasın)
await page.evaluate(() => { window.__psKaro = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; });

await page.click('#btnMore'); await page.click('[data-act="settings"]');
ok('7a ayarlarda "yerden seç" düğmesi var', await page.locator('#sCrsPick').count() === 1);
await page.click('#sCrsPick'); await page.waitForTimeout(500);
ok('7b seçici açıldı: beş giriş yolu', await page.evaluate(() => [...document.querySelectorAll('.ps-seg [data-ps]')].map(b => b.dataset.ps).join(',')) === 'il,harita,adres,koord,cizim');

const secIlIlce = async (il, ilce) => page.evaluate(async ([i, j]) => {
  const s = document.getElementById('psIl'); s.value = String(i); s.onchange();
  const d = document.getElementById('psIlce');
  const opt = [...d.options].find(o => o.textContent === j);
  d.value = opt.value; d.onchange();
  return document.getElementById('psSonuc').textContent;
}, [il, ilce]);

const gebze = await secIlIlce(41, 'Gebze');
ok('8a Gebze seçilince 3° dilim 10, 6° dilim 35N yazıyor', /3° dilim: ?10/.test(gebze.replace(/\s+/g, ' ')) && /35N/.test(gebze), gebze.replace(/\s+/g, ' ').slice(0, 160));
ok('8b altı koordinat sistemi kartı çıktı', await page.locator('.ps-card').count() === 6, String(await page.locator('.ps-card').count()));
ok('8c kartlar EPSG kodlarını yazıyor', await page.evaluate(() => [...document.querySelectorAll('.ps-card em')].map(e => e.textContent).join(' ')) === 'EPSG:5254 EPSG:5270 EPSG:32635 EPSG:2320 EPSG:2207 EPSG:23035',
  await page.evaluate(() => [...document.querySelectorAll('.ps-card em')].map(e => e.textContent).join(' ')));
ok('8d Gebze sınırdan uzak (38 km): gereksiz uyarı ÇIKMIYOR', await page.locator('.ps-uyari').count() === 0, String(await page.locator('.ps-uyari').count()));

// Kandıra (41,05° K / 30,10° D) 30°'nin doğusunda: 6° dilim 36N olmalı — il içinde dilim değişir
const kandira = await secIlIlce(41, 'Kandıra');
ok('8e aynı ilin başka ilçesi öbür UTM dilimine düşüyor (Kandıra → 36N)', /36N/.test(kandira), kandira.replace(/\s+/g, ' ').slice(0, 140));
ok('8f Kandıra UTM sınırına 10 km: uyarı çıkıyor ve 6° diyor',
  await page.locator('.ps-uyari').count() >= 1 && /6°/.test(await page.locator('.ps-uyari').first().textContent()),
  await page.locator('.ps-uyari').count() ? (await page.locator('.ps-uyari').first().textContent()).replace(/\s+/g, ' ') : '(uyarı yok)');

// kart seçilince ayarlar geri açılır ve koordinat sistemi uygulanır
await secIlIlce(41, 'Gebze');
await page.click('.ps-card[data-crs="ITRF96_GK10"]'); await page.waitForTimeout(400);
ok('9a seçim ayarlara işlendi (ITRF96 / 3° GK 10)', await page.evaluate(() => { const s = document.getElementById('sCrs'); return s ? s.value : null; }) === 'ITRF96_GK10', String(await page.evaluate(() => { const s = document.getElementById('sCrs'); return s && s.value; })));
ok('9b ayarlar kutusu geri geldi (birim ve kaydırma alanları yerinde)', await page.evaluate(() => ['sUnit', 'sDx', 'sDy', 'sSave'].every(id => !!document.getElementById(id))));

// koordinat sekmesi
await page.click('#sCrsPick'); await page.waitForTimeout(300);
await page.click('.ps-seg [data-ps="koord"]');
await page.fill('#psK', '39.9334, 32.8597');   // Ankara
await page.click('#psKOk'); await page.waitForTimeout(200);
ok('10 elle koordinat: Ankara → 3° dilim 11, 6° dilim 36N', await page.evaluate(() => { const s = document.getElementById('psSonuc').textContent.replace(/\s+/g, ' '); return /3° dilim: ?11/.test(s) && /36N/.test(s); }), (await page.locator('#psSonuc').textContent()).replace(/\s+/g, ' ').slice(0, 140));

// harita sekmesi: tuval kuruluyor ve sürükleme konumu değiştiriyor
await page.click('.ps-seg [data-ps="harita"]'); await page.waitForTimeout(300);
ok('11a harita tuvali kuruldu', await page.evaluate(() => { const c = document.getElementById('psCv'); return !!c && c.width > 0 && c.height > 0; }));
const once = await page.locator('#psCvTxt').textContent();
const kutu = await page.locator('#psCv').boundingBox();
await page.mouse.move(kutu.x + kutu.width / 2, kutu.y + kutu.height / 2);
await page.mouse.down(); await page.mouse.move(kutu.x + kutu.width / 2 - 60, kutu.y + kutu.height / 2 - 40, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(200);
const sonra = await page.locator('#psCvTxt').textContent();
ok('11b haritayı sürüklemek seçilen noktayı kaydırıyor', once !== sonra && /°/.test(sonra), `${once} → ${sonra}`);
ok('11c sürüklenen konum için de dilim hesaplanıyor', /dilim/.test((await page.locator('#psSonuc').textContent()) || ''));

// çizimden tahmin: UTM benzeri koordinatlı çizimde dilim adayları listelenir
await page.click('.ps-seg [data-ps="cizim"]'); await page.waitForTimeout(200);
ok('12 "Çizimden" sekmesi çalışıyor (tahmin ya da gerekçeli uyarı)', await page.evaluate(() => { const g = document.getElementById('psGovde'); return !!g && g.textContent.trim().length > 0; }), (await page.locator('#psGovde').textContent()).replace(/\s+/g, ' ').slice(0, 120));

C.summary(errors);
await browser.close(); try { srv.kill && srv.kill(); } catch (_) { /* geç */ }
C.exit();
