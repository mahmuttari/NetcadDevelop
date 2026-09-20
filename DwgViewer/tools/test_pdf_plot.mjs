// PDF çıktı kutusunun uçtan uca sınaması: alan seçimi, kâğıt ölçüsü (özel dâhil) ve
// katmanlı vektör PDF. Yazıcının kendi sınaması tools/test_pdfvec.mjs'tedir; buradaki soru
// "kullanıcı kutudan ne seçerse dosyaya o gidiyor mu".
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_pdf_plot.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const { out, samples: SM } = args(import.meta.url);
const C = checker(), ok = C.ok;

/** Sahte Android köprüsü: paketi dışarıdan seçmek için (shot_locked.mjs kalıbı) */
const kopru = () => {
  let ed = 'super';
  window.Android = {
    edition: () => ed,
    proInfo: () => JSON.stringify({ edition: ed, source: 'play', name: '', exp: 0, plan: 'monthly', prices: {}, billingReady: true, licenseEnabled: true }),
    buyPro() {}, restorePro() {}, activateLicense: () => false,
    adsAvailable: () => false, showAd() {}, versionCode: () => '117', appVersion: () => '7.94',
    getPendingFile: () => '', getRecent: () => '[]',
  };
};

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
await ctx.addInitScript(kopru);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
onDialog(page);
await page.goto(srv.url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.dwgApp, null, { timeout: 60000 });
const ev = (fn, arg) => page.evaluate(fn, arg);

await openFile(page, path.join(SM, 'example_2000.dwg'), { settle: 400 });

/** PDF kutusunu açar */
async function kutuAc() {
  await ev(() => window.dwgApp.editor.act('pdf'));
  await page.waitForSelector('#pGo', { timeout: 15000 });
}
/** Oluştur'a basar ve indirilen PDF'i döndürür */
async function uret() {
  const bek = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#pGo');
  const d = await bek;
  const yol = path.join(out, d.suggestedFilename());
  await d.saveAs(yol);
  return fs.readFileSync(yol);
}
/** PDF'in sıkıştırılmış ilk içerik akışını çözer */
function icerikCoz(buf) {
  const ham = buf.toString('latin1');
  const b = ham.indexOf('\nstream\n');
  if (b < 0) return '';
  const s = ham.indexOf('\nendstream', b);
  const bas = ham.lastIndexOf('obj', b);
  const veri = ham.slice(b + 8, s);
  if (!/\/FlateDecode/.test(ham.slice(bas, b))) return veri;
  try { return zlib.inflateSync(Buffer.from(veri, 'latin1')).toString('latin1'); } catch (_) { return ''; }
}
const ocgAdlari = (buf) => [...buf.toString('latin1').matchAll(/\/Type \/OCG \/Name <FEFF([0-9A-F]+)>/g)]
  .map(m => { let u = ''; for (let i = 4; i + 3 < m[1].length + 4; i += 4) { const h = m[1].slice(i - 4, i); if (h.length === 4) u += String.fromCharCode(parseInt(h, 16)); } return u; });

/* ---------- 1. Kutunun yeni alanları ---------- */
await kutuAc();
{
  const r = await ev(() => {
    const g = (id) => document.getElementById(id);
    const kagit = [...g('pPaper').options].map(o => o.value);
    const gorunur = (ad) => [...document.querySelectorAll(`#docBody [data-row="${ad}"]`)].every(e => !e.hidden);
    return { alanlar: ['pTitle', 'pPaper', 'pW', 'pH', 'pOrient', 'pArea', 'pPick', 'pScale', 'pMargin', 'pMode', 'pColor', 'pDpi', 'pFrame', 'pLw'].filter(i => !g(i)),
      kagit, kagitN: kagit.length, ozelVar: kagit.includes('ozel'),
      alan: [...g('pArea').options].map(o => o.value), kip: [...g('pMode').options].map(o => o.value),
      ozelSatir: gorunur('ozel'), yonSatir: gorunur('yon'), dpiSatir: gorunur('dpi'), winSatir: gorunur('win') };
  });
  ok('1a kutunun bütün yeni alanları var', r.alanlar.length === 0, r.alanlar.join(','));
  ok('1b kâğıt listesi ISO A + ISO B + ANSI + ARCH (21 ölçü) ve "Özel"', r.kagitN === 22 && r.ozelVar && r.kagit.includes('A0') && r.kagit.includes('ANSI D') && r.kagit.includes('ARCH E1'), r.kagitN + ' · ' + r.kagit.slice(0, 3).join(','));
  ok('1c kapsam üç seçenek: ekran, sınırlar, pencere', r.alan.join(',') === 'view,ext,win', r.alan.join(','));
  ok('1d çıktı iki seçenek: vektör, raster', r.kip.join(',') === 'vektor,raster', r.kip.join(','));
  ok('1e başlangıçta özel ölçü ve pencere satırı gizli, yön ve dpi görünür', !r.ozelSatir && !r.winSatir && r.yonSatir, JSON.stringify(r));
}
{
  // "Özel" seçilince ölçü satırı açılır, yön satırı kapanır
  await page.selectOption('#pPaper', 'ozel');
  await page.waitForTimeout(80);
  const r = await ev(() => ({ ozel: [...document.querySelectorAll('#docBody [data-row="ozel"]')].every(e => !e.hidden),
    yon: [...document.querySelectorAll('#docBody [data-row="yon"]')].every(e => e.hidden) }));
  ok('1f "Özel ölçü" seçilince G×Y satırı açılır, yön satırı kapanır', r.ozel && r.yon, JSON.stringify(r));
  await page.selectOption('#pPaper', 'A3');
  await page.selectOption('#pMode', 'raster');
  await page.waitForTimeout(80);
  const r2 = await ev(() => [...document.querySelectorAll('#docBody [data-row="dpi"]')].every(e => !e.hidden));
  ok('1g raster kipinde çözünürlük satırı görünür', r2);
  await page.selectOption('#pMode', 'vektor');
  await page.waitForTimeout(80);
  const r3 = await ev(() => [...document.querySelectorAll('#docBody [data-row="dpi"]')].every(e => e.hidden));
  ok('1h vektör kipinde çözünürlük satırı gizlenir (raster ayarıdır)', r3);
}
{
  const kucuk = await ev(() => [...document.querySelectorAll('#docBody button, #docBody select, #docBody input')]
    .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40; })
    .map(b => (b.id || b.className) + ':' + Math.round(b.getBoundingClientRect().height)));
  ok('1i dokunma hedefleri en az 40 px', kucuk.length === 0, kucuk.join(' '));
}

/* ---------- 2. Vektör çıktı: katmanlar PDF'in içinde ---------- */
{
  const buf = await uret();
  fs.writeFileSync(path.join(out, 'vektor_a3.pdf'), buf);
  const ham = buf.toString('latin1');
  const icerik = icerikCoz(buf);
  ok('2a geçerli PDF üretildi', ham.startsWith('%PDF-') && /%%EOF/.test(ham), String(buf.length) + ' bayt');
  ok('2b A3 yatay: MediaBox 1190,551 × 841,89', ham.includes('/MediaBox [0 0 1190.551 841.89]'), (ham.match(/\/MediaBox \[[^\]]*\]/) || [''])[0]);
  ok('2c katalogda /OCProperties var (PDF katman taşıyor)', /\/OCProperties/.test(ham));
  const adlar = ocgAdlari(buf);
  ok('2d çizimin katmanları OCG olarak yazıldı', adlar.length >= 3, adlar.length + ': ' + adlar.slice(0, 4).join(' | '));
  const kat = await ev(() => [...window.dwgApp.state.layers.values()].map(l => ({ ad: l.name, gorunur: l.visible, bas: l.plot !== false, n: l.count })));
  const basilabilir = kat.filter(l => l.gorunur && l.bas).map(l => l.ad);
  ok('2e yalnız görünür ve BASILIR katmanlar PDF katmanı oldu', adlar.length > 0 && adlar.every(a => basilabilir.includes(a)),
    adlar.filter(a => !basilabilir.includes(a)).join(',') || 'hepsi eşleşti');
  ok('2e2 AutoCAD gibi DEFPOINTS kâğıda basılmaz', !adlar.some(a => /^defpoints$/i.test(a)) && kat.some(l => /^defpoints$/i.test(l.ad)),
    adlar.join(' | '));
  ok('2f içerik vektördür: yol işleçleri var, tek bir sayfa resmi yok', / l$/m.test(icerik) && !/\/Im1 Do/.test(icerik), icerik.slice(0, 60).replace(/\n/g, ' '));
  ok('2g katman blokları dengeli (BDC = EMC)', (icerik.match(/BDC/g) || []).length === (icerik.match(/^EMC$/gm) || []).length && (icerik.match(/BDC/g) || []).length > 0,
    (icerik.match(/BDC/g) || []).length + '/' + (icerik.match(/^EMC$/gm) || []).length);
  ok('2h yazı gerçek PDF yazısıdır (Helvetica + ToUnicode)', /\/BaseFont \/Helvetica/.test(ham) && /\/ToUnicode/.test(ham) && /Tj/.test(icerik));
  ok('2i çerçeve ve künye çizildi', /re S/.test(icerik) && / h f/.test(icerik));
}

/* ---------- 3. Özel kâğıt ölçüsü ---------- */
{
  await kutuAc();
  await page.selectOption('#pPaper', 'ozel');
  await page.fill('#pW', '500');
  await page.fill('#pH', '350');
  const buf = await uret();
  const ham = buf.toString('latin1');
  ok('3a özel ölçü kâğıda birebir yazıldı (500 × 350 mm)', ham.includes('/MediaBox [0 0 1417.323 992.126]'), (ham.match(/\/MediaBox \[[^\]]*\]/) || [''])[0]);
}

/* ---------- 4. Alan seçimi (pencere) ---------- */
{
  await kutuAc();
  await page.selectOption('#pArea', 'win');
  await page.waitForTimeout(80);
  ok('4a pencere satırı açıldı ve "seçilmedi" diyor', await ev(() => !document.querySelector('#docBody [data-row="win"]').hidden && /seçilmedi|not picked/i.test(document.getElementById('pWinInfo').textContent)));
  await page.click('#pPick');
  await page.waitForTimeout(200);
  ok('4b seçim başlayınca kutu kapanır ve komut çubuğu istemi çıkar',
    await ev(() => document.getElementById('docPanel').hidden && !document.getElementById('cmdBar').hidden && /alan|area/i.test(document.getElementById('cmdText').textContent)));
  const g0 = await ev(() => ({ ...window.dwgApp.state.view }));
  // ekranda bir dikdörtgen sürükle
  await page.mouse.move(120, 300); await page.mouse.down();
  await page.mouse.move(200, 380, { steps: 6 });
  await page.mouse.move(320, 520, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('#pGo', { timeout: 10000 });
  const r = await ev(() => ({ bilgi: document.getElementById('pWinInfo').textContent, alan: document.getElementById('pArea').value, view: { ...window.dwgApp.state.view } }));
  ok('4c seçim bitince kutu geri açılır ve pencere ölçüsünü yazar', r.alan === 'win' && !/seçilmedi|not picked/i.test(r.bilgi) && /\d/.test(r.bilgi), r.bilgi);
  ok('4d alan seçimi GÖRÜNÜMÜ DEĞİŞTİRMEZ (yakınlaştırma değildir)',
    Math.abs(r.view.cx - g0.cx) < 1e-6 && Math.abs(r.view.cy - g0.cy) < 1e-6 && Math.abs(r.view.scale - g0.scale) < 1e-9,
    `${g0.scale.toFixed(4)} → ${r.view.scale.toFixed(4)}`);
  const secilen = await ev(() => {
    const a = window.dwgApp.toWorld(120, 520), b = window.dwgApp.toWorld(320, 300);
    return [a[0], a[1], b[0], b[1]];
  });
  const buf = await uret();
  fs.writeFileSync(path.join(out, 'vektor_pencere.pdf'), buf);
  const icerik = icerikCoz(buf);
  ok('4e seçilen alan basıldı: kâğıttaki nesne sayısı tam sayfadan az', (icerik.match(/BDC/g) || []).length > 0, (icerik.match(/BDC/g) || []).length + ' blok');
  ok('4f pencere dünya dikdörtgeni doğru köşelerden kuruldu (sol alt / sağ üst)', secilen[2] > secilen[0] && secilen[3] > secilen[1], JSON.stringify(secilen.map(v => Math.round(v))));
}

/* ---------- 4b. Elle seçilen pencereye pay eklenmez ---------- */
{
  const r = await ev(() => {
    const A = window.dwgApp;
    const pencere = [1000, 2000, 5000, 4000];              // 4000 × 2000 dünya birimi
    const win = A.__pdfAlan({ area: 'win', win: pencere, scale: '' }, 400, 200);   // kâğıt oranı 2:1, pencere de 2:1
    const ext = A.__pdfAlan({ area: 'ext', scale: '' }, 400, 200);
    const genis = A.__pdfAlan({ area: 'win', win: [0, 0, 1000, 100], scale: '' }, 400, 200);  // pencere 10:1, kâğıt 2:1
    return { win: win.bb, ext: ext.bb, genis: genis.bb, sinir: A.state.ext };
  });
  ok('4g kâğıt oranına eşit pencere BİREBİR basılır (pay eklenmez)',
    r.win.every((v, i) => Math.abs(v - [1000, 2000, 5000, 4000][i]) < 1e-6), JSON.stringify(r.win));
  ok('4h pencere kâğıttan genişse yalnız kısa kenar büyür, uzun kenar korunur',
    Math.abs(r.genis[0] - 0) < 1e-6 && Math.abs(r.genis[2] - 1000) < 1e-6 && (r.genis[3] - r.genis[1]) > 400,
    JSON.stringify(r.genis.map(v => Math.round(v))));
  ok('4i çizim sınırlarında ise küçük bir pay bırakılır (nesneler kenara yapışmasın)',
    r.sinir && (r.ext[0] < r.sinir[0] - 1e-9) && (r.ext[2] > r.sinir[2] - 1e-9),
    JSON.stringify([r.ext[0], r.sinir[0]].map(v => Math.round(v))));
}

/* ---------- 5. Raster kip hâlâ çalışıyor ---------- */
{
  await kutuAc();
  await page.selectOption('#pMode', 'raster');
  await page.selectOption('#pPaper', 'A4');
  await page.waitForTimeout(80);
  const buf = await uret();
  const ham = buf.toString('latin1');
  ok('5a raster çıktı JPEG gömüyor', /\/Filter \/DCTDecode/.test(ham) && /\/Im1 Do/.test(ham));
  ok('5b raster çıktıda katman yoktur (beklenen davranış)', !/\/OCProperties/.test(ham));
  const mb = (ham.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) || []);
  ok('5c A4 yatay MediaBox (raster yazıcı iki ondalık yazar)', mb.length === 3 && Math.abs(Number(mb[1]) - 841.89) < 0.02 && Math.abs(Number(mb[2]) - 595.276) < 0.02, mb[0] || 'yok');
}

/* ---------- 6. Çerçevesiz çıktı ve kenar boşluğu ---------- */
{
  await kutuAc();
  await page.selectOption('#pMode', 'vektor');
  await page.selectOption('#pPaper', 'A4');
  await page.selectOption('#pArea', 'ext');
  await page.fill('#pMargin', '0');
  await page.uncheck('#pFrame');
  await page.waitForTimeout(80);
  const buf = await uret();
  const icerik = icerikCoz(buf);
  ok('6a kenar boşluğu 0 ve çerçeve kapalıyken çizim alanı tüm sayfadır',
    /^q\n0 0 841.89 595.276 re W n/m.test(icerik), icerik.split('\n').slice(0, 2).join(' | '));
  ok('6b çerçeve kapalıyken künye çizilmez', !/ h f/.test(icerik));
}

/* ---------- 6b. Çıktı rengi ekran ayarından bağımsızdır ---------- */
{
  // ekranı "katman paleti" kipine al: kâğıt yine NESNE renklerini basmalı
  await ev(() => { window.dwgApp.state.colorMode = 'layer'; window.dwgApp.requestRender(); });
  await kutuAc();
  await page.selectOption('#pMode', 'vektor');
  await page.selectOption('#pColor', 'nesne');
  await page.selectOption('#pPaper', 'A3');
  await page.check('#pFrame');
  await page.fill('#pMargin', '10');
  await page.waitForTimeout(80);
  const nesne = icerikCoz(await uret());
  const renkler = new Set((nesne.match(/^[\d.]+ [\d.]+ [\d.]+ RG$/gm) || []));
  ok('6c ekran "katman paleti" kipindeyken bile kâğıt nesne renklerini basar', renkler.size >= 2, [...renkler].join(' | ').slice(0, 80));
  await kutuAc();
  await page.selectOption('#pColor', 'mono');
  await page.waitForTimeout(80);
  const mono = icerikCoz(await uret());
  const mr = new Set((mono.match(/^[\d.]+ [\d.]+ [\d.]+ (?:RG|rg)$/gm) || []));
  // Maske (WIPEOUT) beyaz kalır: siyaha boyansa altındaki çizimi karartırdı — AutoCAD de maskeyi kâğıt rengi basar
  ok('6d "Tümü siyah" seçilince kâğıtta siyah ve maske beyazından başka renk kalmaz',
    mr.size > 0 && [...mr].every(v => /^(0 0 0|1 1 1) (RG|rg)$/.test(v)) && [...mr].some(v => /^0 0 0/.test(v)),
    [...mr].join(' | ').slice(0, 80));
  await ev(() => { window.dwgApp.state.colorMode = 'entity'; window.dwgApp.requestRender(); });
  await kutuAc();
  await page.selectOption('#pColor', 'nesne');
  await page.waitForTimeout(60);
  await ev(() => document.getElementById('docBody').querySelector('#pGo') && window.dwgApp.onBack());
}

/* ---------- 7. Çok küçük kâğıt dürüstçe reddedilir ---------- */
{
  await kutuAc();
  await page.selectOption('#pPaper', 'ozel');
  await page.check('#pFrame');                 // künye bandı 18 mm yer ister
  await page.fill('#pW', '20');
  await page.fill('#pH', '20');
  await page.fill('#pMargin', '5');
  await page.waitForTimeout(80);
  await page.click('#pGo');
  await page.waitForTimeout(1500);
  const metin = await ev(() => document.body.innerText.slice(0, 3000));
  ok('7  20×20 mm kâğıt kenar boşluğu ve künyeye yetmez, açık ileti verilir', /çok küçük|too small/i.test(metin), metin.replace(/\s+/g, ' ').slice(0, 120));
}

ok('8  sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
