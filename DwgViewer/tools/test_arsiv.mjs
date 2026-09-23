// Arşiv çıkarma (ZIP/RAR gezgini) ve arşiv yapma (dosya panelinde çoklu seçim → ZIP).
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_arsiv.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const { out } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;

// ---- küçük ZIP yazıcı / okuyucu (sınamanın kendi aracı; uygulamanınkinden bağımsız) ----
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files) {
  const parts = [], cds = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name, 'utf8'), raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = zlib.deflateRawSync(raw); const useDef = comp.length < raw.length; const body = useDef ? comp : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(useDef ? 8 : 0, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, body);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x800, 8); cd.writeUInt16LE(useDef ? 8 : 0, 10); cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(off, 42);
    cds.push(cd, nb);
    off += lh.length + nb.length + body.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
/** Merkezi dizinden okur → [{name, size, method, time, data}] */
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('EOCD yok');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('merkezi dizin bozuk');
    const method = buf.readUInt16LE(p + 10), time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const loff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(loff + 26), lelen = buf.readUInt16LE(loff + 28);
    const start = loff + 30 + lnlen + lelen;
    const body = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(body) : body;
    if (crc32(data) !== crc) throw new Error('CRC uyuşmuyor: ' + name);
    if (data.length !== size) throw new Error('boy uyuşmuyor: ' + name);
    out.push({ name, size, method, time, date, data });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

const zip = makeZip([
  ['pafta/plan.txt', 'PLAN içeriği\n'],
  ['pafta/alt/notlar.txt', 'ALT NOT\n'],
  ['veri.csv', 'ad;x;y\nB1;100;200\n'],
  ['okuyun.txt', 'kök dosya\n'],
]);
fs.writeFileSync(path.join(out, 'proje.zip'), zip);
fs.writeFileSync(path.join(out, 'kroki.txt'), 'kroki gövdesi\n');
fs.writeFileSync(path.join(out, 'rapor.txt'), 'rapor gövdesi\n');

const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

// İndirmeler toplanır: tarayıcı yolunda "çıkarma" her girdi için bir indirmedir
const inen = [];
page.on('download', async (d) => {
  const p = path.join(out, 'inen_' + inen.length + '_' + d.suggestedFilename().replace(/[^\w.-]+/g, '_'));
  try { await d.saveAs(p); inen.push({ ad: d.suggestedFilename(), yol: p }); } catch (e) { console.log('[download]', e.message); }
});
const bekleIndirme = async (n, ms = 6000) => { const t0 = Date.now(); while (inen.length < n && Date.now() - t0 < ms) await page.waitForTimeout(100); return inen.length; };

await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2');

// ---------------------------------------------------------------- 1) saf işlevler
{
  const r = await ev(async () => {
    const A = await import('./arsiv.js');
    return {
      zipSlip: A.guvenliYol('../../etc/passwd'),
      ortaNokta: A.guvenliYol('a/../b/./c.dwg'),
      tersBolu: A.guvenliYol('klasor\\alt\\plan.dwg'),
      mutlak: A.guvenliYol('/kok/dosya.txt'),
      yasak: A.guvenliAd('pro:je*"<>|.dwg'),
      gizli: A.guvenliAd('...gizli.txt'),
      bos: A.guvenliAd('   ', 'dosya'),
      turkce: A.guvenliAd('Çizim Şğüöı.dwg'),
      uzun: A.guvenliAd('x'.repeat(300) + '.dwg').length,
      klasor: A.klasorAdi('proje adı.zip'),
      dizin: A.dizinYolu('a/b/c.dwg'),
      son: A.sonAd('a/b/c.dwg'),
      mime: A.mimeFor('x.DWG') + '|' + A.mimeFor('x.pdf') + '|' + A.mimeFor('x.bilinmez'),
      alt: A.klasorAltindakiler([{ name: 'a/b.txt' }, { name: 'a/', dir: true }, { name: 'c.txt' }], 'a/'),
    };
  });
  ok('1a Zip-Slip: ".." parçaları atılır', r.zipSlip === 'etc/passwd', r.zipSlip);
  ok('1b ortadaki ".." ve "." atılır', r.ortaNokta === 'a/b/c.dwg', r.ortaNokta);
  ok('1c ters bölü ayraca çevrilir', r.tersBolu === 'klasor/alt/plan.dwg', r.tersBolu);
  ok('1d mutlak yol göreliye iner', r.mutlak === 'kok/dosya.txt', r.mutlak);
  ok('1e yasak karakterler "_" olur', r.yasak === 'pro_je_.dwg', r.yasak);
  ok('1f baştaki noktalar atılır (gizli dosya olmaz)', r.gizli === 'gizli.txt', r.gizli);
  ok('1g boş ad varsayılana düşer', r.bos === 'dosya', r.bos);
  ok('1h Türkçe harfler korunur', r.turkce === 'Çizim Şğüöı.dwg', r.turkce);
  ok('1i çok uzun ad 120 kararakterle sınırlı', r.uzun <= 120, String(r.uzun));
  ok('1j arşiv adından klasör adı', r.klasor === 'proje adı', r.klasor);
  ok('1k dizinYolu / sonAd', r.dizin === 'a/b' && r.son === 'c.dwg', r.dizin + ' · ' + r.son);
  ok('1l MIME uzantıdan', r.mime === 'image/vnd.dwg|application/pdf|application/octet-stream', r.mime);
  ok('1m klasör altındaki dosyalar (klasör girdisi hariç)', JSON.stringify(r.alt) === JSON.stringify(['a/b.txt']), JSON.stringify(r.alt));
}

// ---------------------------------------------------------------- 2) zipYap
{
  const zaman = Date.UTC(2024, 4, 17, 13, 45, 20);
  const bayt = await ev(async (t) => {
    const A = await import('./arsiv.js');
    const enc = new TextEncoder();
    const u8 = await A.zipYap([
      { name: 'a/../plan.txt', data: enc.encode('PLAN'), time: t },
      { name: 'plan.txt', data: enc.encode('İKİNCİ'), time: t },
      { name: 'klasor/uzun.txt', data: enc.encode('x'.repeat(4000)), time: t },
    ]);
    return Array.from(u8);
  }, zaman);
  const girdiler = readZip(Buffer.from(bayt));
  ok('2a üç girdi yazıldı', girdiler.length === 3, String(girdiler.length));
  ok('2b ".." temizlendi', girdiler[0].name === 'a/plan.txt', girdiler[0].name);
  ok('2c çakışan ad numaralandı', girdiler[1].name === 'plan.txt' && girdiler[2].name === 'klasor/uzun.txt', girdiler.map(g => g.name).join(', '));
  ok('2d içerik bozulmadı (CRC + boy doğrulandı)', girdiler[0].data.toString('utf8') === 'PLAN' && girdiler[1].data.toString('utf8') === 'İKİNCİ');
  ok('2e büyük girdi deflate edildi, küçük girdi saklandı', girdiler[2].method === 8 && girdiler[0].method === 0, girdiler.map(g => g.method).join(','));
  // DOS saati: saniye iki birimlidir, yıl 1980'den sayılır
  const d = new Date(zaman);
  const bekTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const bekDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  ok('2f zaman damgası yazıldı', girdiler[0].time === bekTime && girdiler[0].date === bekDate, girdiler[0].time + '/' + bekTime);
  // ad çakışması aynı ZIP'te ikinci kez
  const ikiz = await ev(async () => {
    const A = await import('./arsiv.js');
    const enc = new TextEncoder();
    const u8 = await A.zipYap([{ name: 'ayni.txt', data: enc.encode('1') }, { name: 'ayni.txt', data: enc.encode('2') }, { name: 'AYNI.TXT', data: enc.encode('3') }]);
    return Array.from(u8);
  });
  const ad = readZip(Buffer.from(ikiz)).map(g => g.name);
  ok('2g üç ayrı ad (büyük/küçük harf de çakışma sayılır)', new Set(ad).size === 3, ad.join(', '));
}

// ---------------------------------------------------------------- 3) arşiv gezgininde çıkarma
await page.setInputFiles('#fileInput', path.join(out, 'proje.zip')); await page.waitForTimeout(700);
ok('3a arşiv açıldı', await ev(() => !document.getElementById('docView').hidden && document.querySelectorAll('#docContent .arc-item').length >= 2));
ok('3b araç çubuğunda "Tümünü çıkar"', await ev(() => { const b = document.getElementById('arcAll'); return !!b && /Tümünü/.test(b.textContent); }), await ev(() => (document.getElementById('arcAll') || {}).textContent || ''));
ok('3c her satırda çıkarma düğmesi', await ev(() => document.querySelectorAll('#docContent .arc-item [data-arc-out]').length === document.querySelectorAll('#docContent .arc-item').length));
await shot('arsiv_liste');

// tek dosya: onay sorulmaz
inen.length = 0;
await page.click('#docContent .arc-item[data-entry="veri.csv"] [data-arc-out]');
await bekleIndirme(1);
ok('3d tek dosya çıkarıldı (onay sorulmadan)', inen.length === 1, inen.map(x => x.ad).join(','));
ok('3e dosya adı arşiv klasörüyle ön ekli', inen[0] && /^proje_veri\.csv$/.test(inen[0].ad), inen[0] && inen[0].ad);
ok('3f içerik aynı', inen[0] && fs.readFileSync(inen[0].yol, 'utf8') === 'ad;x;y\nB1;100;200\n');
ok('3g girdi AÇILMADI (çıkarma düğmesi satırı açmaz)', await ev(() => !!document.querySelector('#docContent .arc-item')));

// klasör satırı: alt klasördeki dosyalar da gelir
inen.length = 0;
await ev(() => { window.__ask.queue.push(true); });
await page.click('#docContent .arc-item[data-entry="pafta/"] [data-arc-out]');
await bekleIndirme(2);
ok('3h klasör çıkarıldı: iki dosya', inen.length === 2, inen.map(x => x.ad).join(','));
ok('3i arşiv içi yol ada katıldı', inen.some(x => x.ad === 'proje_pafta_plan.txt') && inen.some(x => x.ad === 'proje_pafta_alt_notlar.txt'), inen.map(x => x.ad).join(','));
ok('3j onay soruldu', await ev(() => window.__ask.log.some(l => l.type === 'confirm' && /4 dosya|2 dosya/.test(l.label))), await ev(() => JSON.stringify(window.__ask.log.slice(-1))));

// klasörün içine girince düğme "Bu klasörü çıkar" olur
await page.click('#docContent .arc-item[data-entry="pafta/"]'); await page.waitForTimeout(200);
ok('3k klasörde düğme etiketi değişti', await ev(() => /Bu klasörü/.test(document.getElementById('arcAll').textContent)), await ev(() => document.getElementById('arcAll').textContent));
await page.click('#docContent [data-crumb=""]'); await page.waitForTimeout(150);

// tümü
inen.length = 0;
await ev(() => { window.__ask.queue.push(true); });
await page.click('#arcAll');
await bekleIndirme(4, 9000);
ok('3l tümü çıkarıldı: dört dosya', inen.length === 4, inen.map(x => x.ad).join(','));
ok('3m kök dosya da geldi', inen.some(x => x.ad === 'proje_okuyun.txt'), inen.map(x => x.ad).join(','));
ok('3n vazgeçilirse hiçbir şey yazılmaz', await (async () => { inen.length = 0; await ev(() => { window.__ask.queue.push(false); }); await page.click('#arcAll'); await page.waitForTimeout(600); return inen.length === 0; })(), String(inen.length));
await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(200);
await ev(() => window.dwgApp.docs.close());

// ---------------------------------------------------------------- 4) dosya panelinde çoklu seçim → ZIP
await page.setInputFiles('#fileInput', path.join(out, 'kroki.txt')); await page.waitForTimeout(500);
await ev(() => window.dwgApp.docs.close()); await page.waitForTimeout(100);
await page.setInputFiles('#fileInput', path.join(out, 'rapor.txt')); await page.waitForTimeout(500);
await ev(() => window.dwgApp.docs.close()); await page.waitForTimeout(100);
await ev(() => window.dwgApp.openCenter('recent')); await page.waitForTimeout(300);
// Son listesinde üç dosya var: yukarıda açılan proje.zip ile bu ikisi. Arşivin kendisi de seçilebilir —
// ZIP içine ikili bir dosyanın bozulmadan girdiği böylece sınanır.
ok('4a Son sekmesinde üç dosya', await ev(() => document.querySelectorAll('#openBody [data-open-recent]').length === 3), String(await ev(() => document.querySelectorAll('#openBody [data-open-recent]').length)));
ok('4b seçim kipi kapalıyken onay kutusu yok', await ev(() => !document.querySelector('#openBody .selbox')));
await page.click('#openSel'); await page.waitForTimeout(200);
ok('4c seçim kipi: her satırda onay kutusu', await ev(() => document.querySelectorAll('#openBody .selbox').length === 3), String(await ev(() => document.querySelectorAll('#openBody .selbox').length)));
ok('4d seçim şeridi çıktı', await ev(() => !!document.querySelector('#openBody .open-sel [data-open="zip"]')));
ok('4e seçim boşken ZIP düğmesi kapalı', await ev(() => document.querySelector('#openBody .open-sel [data-open="zip"]').disabled === true));
await shot('panel_secim');
await page.click('#openBody [data-sel-key]'); await page.waitForTimeout(200);
ok('4f satır seçildi (dosya AÇILMADI)', await ev(() => document.querySelectorAll('#openBody .sel-on').length === 1 && !document.getElementById('openPanel').hidden));
ok('4g şerit sayıyı yazdı', await ev(() => /1 seçili/.test(document.querySelector('#openBody .open-sel .sel-msg').textContent)), await ev(() => document.querySelector('#openBody .open-sel .sel-msg').textContent));
await page.click('#openBody .open-sel [data-open="selall"]'); await page.waitForTimeout(200);
ok('4h tümünü seç', await ev(() => document.querySelectorAll('#openBody .sel-on').length === 3), String(await ev(() => document.querySelectorAll('#openBody .sel-on').length)));

inen.length = 0;
await ev(() => { window.__ask.queue.push('paket.zip'); });
await page.click('#openBody .open-sel [data-open="zip"]');
await bekleIndirme(1, 9000);
ok('4i ZIP indirildi', inen.length === 1 && inen[0].ad === 'paket.zip', inen.map(x => x.ad).join(','));
if (inen.length) {
  const g = readZip(fs.readFileSync(inen[0].yol));
  const adlar = g.map(x => x.name).sort();
  ok('4j üç dosya da içinde', JSON.stringify(adlar) === JSON.stringify(['kroki.txt', 'proje.zip', 'rapor.txt']), adlar.join(', '));
  ok('4k metin içerikleri doğru', g.find(x => x.name === 'kroki.txt').data.toString('utf8') === 'kroki gövdesi\n' && g.find(x => x.name === 'rapor.txt').data.toString('utf8') === 'rapor gövdesi\n');
  ok('4k2 ikili dosya bayt bayt aynı', g.find(x => x.name === 'proje.zip').data.equals(fs.readFileSync(path.join(out, 'proje.zip'))));
}
ok('4l ZIP sonrası seçim kipi kapandı', await ev(() => !document.querySelector('#openBody .selbox')));

// uzantı kendiliğinden eklenir, vazgeçilince dosya yazılmaz
await page.click('#openSel'); await page.click('#openBody .open-sel [data-open="selall"]'); await page.waitForTimeout(150);
inen.length = 0;
await ev(() => { window.__ask.queue.push(null); });
await page.click('#openBody .open-sel [data-open="zip"]'); await page.waitForTimeout(600);
ok('4m ad kutusu iptal edilince ZIP yapılmaz', inen.length === 0, String(inen.length));
inen.length = 0;
await ev(() => { window.__ask.queue.push('yedek'); });
await page.click('#openBody .open-sel [data-open="zip"]');
await bekleIndirme(1, 9000);
ok('4n ".zip" uzantısı kendiliğinden eklenir', inen.length === 1 && inen[0].ad === 'yedek.zip', inen.map(x => x.ad).join(','));
ok('4o başarılı ZIP sonrası kip yine kapandı', await ev(() => !document.querySelector('#openBody .selbox')));
await page.click('#openSel'); await page.waitForTimeout(150);
const acik = await ev(() => document.querySelectorAll('#openBody .selbox').length);
await page.click('#openSel'); await page.waitForTimeout(150);
ok('4p Seç düğmesi kipi açıp kapatır', acik === 3 && await ev(() => !document.querySelector('#openBody .selbox')), String(acik));

C.summary(errors);
await browser.close(); srv.kill();
C.exit();
