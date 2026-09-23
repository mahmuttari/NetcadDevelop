// Yeni dosya oluşturma (altı biçim) ve Excel / CSV / metin düzenleme sınaması.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_new.mjs [çıktı]
import { args, startServer, launchBrowser, onDialog, noUpdate, queueAnswers, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** ZIP'i Node'un zlib'iyle açar: {ad → Buffer} (bağımsız doğrulama, test_edit ile aynı) */
function unzip(buf) {
  let eo = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error('EOCD yok');
  const n = buf.readUInt16LE(eo + 10); let p = buf.readUInt32LE(eo + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('merkezi dizin bozuk');
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'), method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const lnl = buf.readUInt16LE(lo + 26), lel = buf.readUInt16LE(lo + 28), st = lo + 30 + lnl + lel;
    const raw = buf.slice(st, st + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
    p += 46 + nl + el + cl;
  }
  return files;
}

const { out } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;

const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page);
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnNew2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnNew2');

/** Yeni dosya kutusunu açar, türü seçer, adı verir */
async function newFile(kind, name) {
  await ev(() => window.dwgApp.showNewDoc());
  await page.waitForSelector('#docPanel .new-item', { state: 'visible' });
  await queueAnswers(page, name);
  await page.click(`#docBody [data-new="${kind}"]`);
}
/** Kaydet düğmesine basar, inen dosyayı out klasörüne yazar ve yolunu döner */
async function saveAndGet(fileName) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#docTools [data-pe="save"]')]);
  const p = path.join(out, fileName);
  await dl.saveAs(p);
  return p;
}
/** İnen dosyayı uygulamada yeniden açar */
async function reopen(p) {
  await page.setInputFiles('#fileInput', p);
  await page.waitForTimeout(700);
}

// ---- 1. seçici -------------------------------------------------------------------------
await ev(() => window.dwgApp.showNewDoc());
await page.waitForSelector('#docPanel .new-item', { state: 'visible' });
{
  const r = await ev(() => ({ n: document.querySelectorAll('#docBody .new-item').length, ids: [...document.querySelectorAll('#docBody [data-new]')].map(b => b.dataset.new), ext: [...document.querySelectorAll('#docBody .new-item small')].map(s => s.textContent), lb: document.querySelector('#docBody .new-item span')?.textContent, ic: !!document.querySelector('#docBody .new-item use') }));
  ok('n1 altı biçim, simge ve uzantı', r.n === 6 && r.ids.join(',') === 'dxf,docx,xlsx,pdf,txt,csv' && r.ext.join(',') === '.dxf,.docx,.xlsx,.pdf,.txt,.csv' && !!r.lb && r.ic, JSON.stringify(r));
}
await shot('yeni_secici');
await ev(() => window.dwgApp.docs && document.getElementById('docPanel') && (document.getElementById('docPanel').hidden = true));

// ---- 2. XLSX: oluştur, düzenle, kaydet, geri oku ---------------------------------------
await newFile('xlsx', 'metraj');
await page.waitForSelector('#docContent .xlsx-tbl', { timeout: 20000 });
{
  const r = await ev(() => { const t = document.querySelector('#docContent .xlsx-tbl'); return { name: document.getElementById('docName').textContent, rows: t.rows.length, cols: t.rows[0].cells.length, edit: !!document.querySelector('#docTools [data-doc="edit"]'), tab: document.querySelector('#docTools [data-sheet]')?.textContent }; });
  ok('n2 boş xlsx açıldı (30 satır × 8 sütun + başlık)', r.name === 'metraj.xlsx' && r.rows === 31 && r.cols === 9 && r.edit && r.tab === 'Sayfa1', JSON.stringify(r));
}
await page.click('#docTools [data-doc="edit"]');
await page.waitForSelector('#docContent .grid-ed td[contenteditable]');
{
  const r = await ev(() => ({ ed: document.querySelectorAll('#docContent .grid-ed td[contenteditable="true"]').length, save: !!document.querySelector('#docTools [data-pe="save"]'), row: !!document.querySelector('#docTools [data-pe="addrow"]'), col: !!document.querySelector('#docTools [data-pe="addcol"]') }));
  ok('n3 ızgara düzenleyici açıldı', r.ed === 240 && r.save && r.row && r.col, JSON.stringify(r));
}
await ev(() => {
  const set = (r, c, v) => { const td = document.querySelector(`#docContent .grid-ed td[data-r="${r}"][data-c="${c}"]`); td.textContent = v; td.dispatchEvent(new Event('input', { bubbles: true })); };
  set(0, 0, 'Poz'); set(0, 1, 'Ø300 boru'); set(1, 0, '25.005'); set(1, 1, '1250,50');
});
await page.click('#docTools [data-pe="addcol"]');
await page.click('#docTools [data-pe="addrow"]');
{
  const r = await ev(() => { const t = document.querySelector('#docContent .grid-ed'); return { rows: t.rows.length, cols: t.rows[0].cells.length, a1: t.querySelector('td[data-r="0"][data-c="0"]').textContent }; });
  ok('n4 satır ve sütun eklendi, yazılan değer duruyor', r.rows === 32 && r.cols === 10 && r.a1 === 'Poz', JSON.stringify(r));
}
await shot('yeni_xlsx_duzenle');
const xlsxPath = await saveAndGet('metraj_kayit.xlsx');
ok('n5 xlsx dosyası indi', fs.existsSync(xlsxPath) && fs.statSync(xlsxPath).size > 400, String(fs.existsSync(xlsxPath) && fs.statSync(xlsxPath).size));
await page.waitForTimeout(400);
await reopen(xlsxPath);
{
  const r = await ev(() => { const t = document.querySelector('#docContent .xlsx-tbl'); const cell = (r2, c) => t.rows[r2 + 1].cells[c + 1]?.textContent; return { name: document.getElementById('docName').textContent, a1: cell(0, 0), b1: cell(0, 1), a2: cell(1, 0), b2: cell(1, 1), rows: t.rows.length }; });
  // v8.8: Türkçe yazımdaki sayılar artık gerçek sayı hücresi olarak yazılır (Excel kuralı):
  // '25.005' → 25005, '1250,50' → 1250,5 — genel biçim son sıfırı ve binlik noktayı göstermez.
  ok('n6 kaydedilen xlsx geri okundu, sayılar sayı hücresi oldu', /metraj/.test(r.name) && r.a1 === 'Poz' && r.b1 === 'Ø300 boru' && r.a2 === '25005' && r.b2 === '1250,5', JSON.stringify(r));
}

// ---- 2b. v8.8: formül motoru, otomatik toplam, hücre biçimi, satır ekleme kaydırması ----
await page.click('#docTools [data-doc="edit"]');
await page.waitForSelector('#docContent .grid-ed td[contenteditable]');
// Gerçek kullanıcı yolu: hücreye odaklan, yaz, odaktan çık (focusout → hucreIsle → yeniden hesap)
const hucreYaz = (r, c, v) => ev(([r2, c2, v2]) => {
  const td = document.querySelector(`#docContent .grid-ed td[data-r="${r2}"][data-c="${c2}"]`);
  td.focus(); td.textContent = v2; td.blur();
}, [r, c, v]);
const hucreOku = (r, c) => ev(([r2, c2]) => document.querySelector(`#docContent .grid-ed td[data-r="${r2}"][data-c="${c2}"]`).textContent, [r, c]);
await hucreYaz(1, 2, '=A2*2');
ok('e1 formül girildi ve hesaplandı (=A2*2 → 50010)', await hucreOku(1, 2) === '50010', await hucreOku(1, 2));
// Türkçe Excel'in ';' argüman ayracı: normalize edilmezse ikinci argüman SESSİZCE düşerdi
await hucreYaz(1, 3, '=SUM(A2;A2)');
ok('e1b Türkçe ; ayracı , olarak işleniyor (=SUM(A2;A2) → 50010)', await hucreOku(1, 3) === '50010', await hucreOku(1, 3));
// otomatik toplam: A3 boş, üstünde A2=25005 var → SUM(A2:A2)
await ev(() => document.querySelector('#docContent .grid-ed td[data-r="2"][data-c="0"]').focus());
await page.click('#docTools [data-pe="autosum"]');
await page.waitForTimeout(150);
ok('e2 otomatik toplam üstteki sayı bloğunu topladı', await hucreOku(2, 0) === '25005', await hucreOku(2, 0));
// hücre biçimi: aynı hücre kalın + dolgu (seçim autosum sonrası duruyor)
await page.click('#docTools [data-pe="cellbold"]');
await page.click('#docTools [data-pe="cellfill"][data-color="#fff2a8"]');
ok('e3 kalın ve dolgu hücreye canlı uygulandı', await ev(() => {
  const td = document.querySelector('#docContent .grid-ed td[data-r="2"][data-c="0"]');
  return td.style.fontWeight === '700' && td.style.background !== '';
}));
// satır ekleme: 2. satırın üstüne — formüller Excel kuralıyla kayar (=A2*2 → =A3*2, SUM(A2:A2) → SUM(A3:A3))
await ev(() => document.querySelector('#docContent .grid-ed td[data-r="1"][data-c="0"]').focus());
await page.click('#docTools [data-pe="insrow"]');
await page.waitForTimeout(200);
ok('e4 satır eklendi, formül metinleri kaydı', await ev(() => {
  const td = document.querySelector('#docContent .grid-ed td[data-r="2"][data-c="2"]');
  td.focus(); const f = td.textContent; td.blur();
  return f === '=A3*2';
}), 'odakta görülen formül');
await shot('yeni_xlsx_formul');
const xlsx88 = await saveAndGet('metraj_v88.xlsx');
// --- bağımsız doğrulama: paket içinde <f> + önbellek <v>, styles.xml biçimi, calcPr ---
{
  const files = unzip(fs.readFileSync(xlsx88));
  const sheet = files['xl/worksheets/sheet1.xml'].toString('utf8');
  const styles = (files['xl/styles.xml'] || Buffer.alloc(0)).toString('utf8');
  const wb = files['xl/workbook.xml'].toString('utf8');
  ok('e5 xlsx: formül <f> ve önbellek değeri <v> yazıldı', sheet.includes('<f>A3*2</f>') && sheet.includes('<v>50010</v>')
    && sheet.includes('<f>SUM(A3:A3)</f>'), sheet.slice(0, 0) || 'formül satırları');
  ok('e6 xlsx: hücre biçimi styles.xml\'e, calcPr workbook\'a yazıldı', /<b\/>/.test(styles) && /FFF2A8/i.test(styles)
    && wb.includes('<calcPr fullCalcOnLoad="1"/>'));
}
await page.waitForTimeout(300);
await reopen(xlsx88);
{
  const r = await ev(() => { const t = document.querySelector('#docContent .xlsx-tbl'); const cell = (r2, c) => t.rows[r2 + 1].cells[c + 1]?.textContent; return { f: cell(2, 2), s: cell(3, 0) }; });
  ok('e7 yeniden açılışta formüller hesaplanıyor', r.f === '50010' && r.s === '25005', JSON.stringify(r));
}

// ---- 3. CSV -----------------------------------------------------------------------------
await ev(() => window.dwgApp.docs.close());
await newFile('csv', 'noktalar');
await page.waitForSelector('#docContent .xlsx-tbl', { timeout: 20000 });
ok('n7 boş csv ızgara olarak açıldı', await ev(() => document.getElementById('docName').textContent === 'noktalar.csv' && !!document.querySelector('#docTools [data-doc="edit"]')));
await page.click('#docTools [data-doc="edit"]');
await page.waitForSelector('#docContent .grid-ed td[contenteditable]');
await ev(() => {
  const set = (r, c, v) => { const td = document.querySelector(`#docContent .grid-ed td[data-r="${r}"][data-c="${c}"]`); td.textContent = v; td.dispatchEvent(new Event('input', { bubbles: true })); };
  set(0, 0, 'ad'); set(0, 1, 'x'); set(0, 2, 'y'); set(1, 0, 'B1;özel'); set(1, 1, '100'); set(1, 2, '200');
});
const csvPath = await saveAndGet('noktalar_kayit.csv');
{
  const txt = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.replace(/;/g, '').trim());
  ok('n8 csv metni doğru (ayraç ;, tırnaklı alan)', txt[0].startsWith('ad;x;y') && txt[1].startsWith('"B1;özel";100;200'), JSON.stringify(txt.slice(0, 2)));
}
await page.waitForTimeout(400);
await reopen(csvPath);
ok('n9 kaydedilen csv geri okundu', await ev(() => { const t = document.querySelector('#docContent .xlsx-tbl'); return t.rows[0].cells[0].textContent === 'ad' && t.rows[1].cells[0].textContent === 'B1;özel'; }));

// ---- 3b. Büyük CSV: ızgarada yalnız ilk GRID_MAX satır basılır, gerisi dosyada korunur ------
await ev(() => window.dwgApp.docs.close());
{
  const big = path.join(out, 'buyuk.csv');
  fs.writeFileSync(big, Array.from({ length: 1200 }, (_, i) => `S${i};${i * 2};not-${i}`).join('\r\n') + '\r\n', 'utf8');
  await reopen(big);
  await page.click('#docTools [data-doc="edit"]');
  await page.waitForSelector('#docContent .grid-ed td[contenteditable]');
  const r = await ev(() => ({ shown: document.querySelectorAll('#docContent .grid-ed tr').length - 1, more: !!document.querySelector('#docTools [data-pe="gridmore"]') }));
  ok('n9a büyük csv: ilk 1000 satır basıldı, "Daha fazla" var', r.shown === 1000 && r.more, JSON.stringify(r));
  await ev(() => { const td = document.querySelector('#docContent .grid-ed td[data-r="0"][data-c="0"]'); td.textContent = 'DEGISTI'; td.dispatchEvent(new Event('input', { bubbles: true })); });
  const p2 = await saveAndGet('buyuk_kayit.csv');
  const lines = fs.readFileSync(p2, 'utf8').split(/\r?\n/).filter(l => l.length);
  ok('n9b basılmayan satırlar korundu (1200 satır, 1150. satır yerinde)', lines.length === 1200 && lines[0] === 'DEGISTI;0;not-0' && lines[1150] === 'S1150;2300;not-1150', JSON.stringify([lines.length, lines[0], lines[1150]]));
}

// ---- 4. TXT ------------------------------------------------------------------------------
await ev(() => window.dwgApp.docs.close());
await newFile('txt', 'notlar');
await page.waitForSelector('#docContent .doc-pre', { state: 'attached', timeout: 20000 });
ok('n10 boş metin açıldı', await ev(() => document.getElementById('docName').textContent === 'notlar.txt' && document.querySelector('#docContent .doc-pre').textContent === '' && !!document.querySelector('#docTools [data-doc="edit"]')));
await page.click('#docTools [data-doc="edit"]');
await page.waitForSelector('#docContent .doc-edit-txt');
await page.fill('#docContent .doc-edit-txt', 'İSU Genel Müdürlüğü\nAtıksu hattı: Ø300\n');
await shot('yeni_txt_duzenle');
const txtPath = await saveAndGet('notlar_kayit.txt');
ok('n11 metin dosyası doğru yazıldı', fs.readFileSync(txtPath, 'utf8') === 'İSU Genel Müdürlüğü\nAtıksu hattı: Ø300\n', JSON.stringify(fs.readFileSync(txtPath, 'utf8')));
await page.waitForTimeout(400);
await reopen(txtPath);
ok('n12 kaydedilen metin geri okundu', await ev(() => /Atıksu hattı: Ø300/.test(document.querySelector('#docContent .doc-pre')?.textContent || '')));

// ---- 5. DOCX ve PDF -----------------------------------------------------------------------
await ev(() => window.dwgApp.docs.close());
await newFile('docx', 'rapor');
await page.waitForSelector('#docContent .docx-page, #docContent .docx-pages', { timeout: 25000 });
ok('n13 boş Word belgesi açıldı ve düzenlenebilir', await ev(() => document.getElementById('docName').textContent === 'rapor.docx' && !!document.querySelector('#docTools [data-doc="edit"]')));
await ev(() => window.dwgApp.docs.close());
await newFile('pdf', 'kapak');
await page.waitForTimeout(1500);
ok('n14 boş PDF açıldı', await ev(() => document.getElementById('docName').textContent === 'kapak.pdf' && !document.getElementById('docView').hidden));

// ---- 6. DXF: çizim olarak açılır -----------------------------------------------------------
await ev(() => window.dwgApp.docs.close());
await newFile('dxf', 'plan');
await page.waitForFunction(() => window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 30000 });
await page.waitForTimeout(400);
{
  const r = await ev(() => ({ name: window.dwgApp.state.fileName, doc: window.dwgApp.state.hasDoc, view: document.getElementById('docView').hidden, layers: window.dwgApp.state.layers ? window.dwgApp.state.layers.length : -1 }));
  ok('n15 boş DXF çizim olarak açıldı', r.name === 'plan.dxf' && r.doc && r.view, JSON.stringify(r));
}
await shot('yeni_dxf');

// ---- 7. Ücretsiz sürüm: yeni dosya Pro kapısına takılır --------------------------------------
await ev(() => { window.__edition = 'free'; window.dwgApp.onEdition('free', 'sinama'); });
await page.waitForTimeout(200);
await ev(() => window.dwgApp.showNewDoc());
await page.waitForTimeout(300);
{
  // docBody bir önceki seçicinin biçimlendirmesini taşır; ölçüt panelin açılmaması ve yükseltme kutusunun çıkmasıdır
  const r = await ev(() => ({ panel: document.getElementById('docPanel').hidden, ask: !document.getElementById('askDlg')?.hidden, msg: document.getElementById('askLabel')?.textContent || '' }));
  ok('n16 ücretsizde yeni dosya Pro kapısına takılır', r.panel && r.ask, JSON.stringify(r));
  await ev(() => window.dwgApp.onBack());
}
await ev(() => { window.__edition = 'pro'; window.dwgApp.onEdition('pro', 'sinama'); });

C.summary(errors);
await browser.close(); srv.kill();
C.exit();
