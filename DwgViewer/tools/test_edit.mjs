// PDF ve Word düzenleme (Pro): açıklama katmanı, sayfa işlemleri, yerinde metin düzenleme ve DOCX yazıcı.
// Çıktılar BAĞIMSIZ doğrulanır: üretilen PDF pdf-lib ile Node'da geri okunur, DOCX Node'un zlib'iyle açılıp
// XML'i sınanır, sonra aynı DOCX uygulamaya geri yüklenip kendi okuyucumuzla gidiş-dönüş karşılaştırılır.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_edit.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, queueAnswers, PHONE, projectRoot } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
const { out, samples: SM } = args(import.meta.url);
const DOCS = path.join(SM, 'doc');
const C = checker(), ok = C.ok;
const require0 = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb, degrees } = require0(path.join(projectRoot, 'app/src/main/assets/viewer/lib/pdf-lib.min.js'));

// ---------------------------------------------------------------------------------
// Örnek PDF: üç sayfa, sonuncusu 90 derece dönük (pdf-lib ile üretilir, gerçek bir PDF)
// ---------------------------------------------------------------------------------
const PDF_PATH = path.join(out, 'kesif.pdf');
{
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const sizes = [[595, 842], [595, 842], [842, 595]];
  sizes.forEach((s, i) => {
    const p = d.addPage(s);
    p.drawText('Sayfa ' + (i + 1) + ' - test belgesi', { x: 60, y: s[1] - 90, size: 20, font: f, color: rgb(0.1, 0.2, 0.5) });
    if (i === 2) p.setRotation(degrees(90));
  });
  fs.writeFileSync(PDF_PATH, await d.save());
}
/** ZIP'i Node'un zlib'iyle açar: {ad → Buffer} */
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

const srv = await startServer();
const browser = await launchBrowser();
const errors = [];
const hook = (page) => {
  page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
};
const boot = async (page, ev) => {
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2');
};

// ---------------------------------------------------------------------------------
// 1) Pro: PDF düzenleme
// ---------------------------------------------------------------------------------
const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
const page = await ctx.newPage(); hook(page);
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
onDialog(page, async d => { await d.dismiss(); });
await boot(page, ev);
const openDoc = async (f) => { await page.setInputFiles('#fileInput', f); await page.waitForFunction(() => !document.getElementById('docView').hidden, null, { timeout: 20000 }); await page.waitForTimeout(300); };

await openDoc(PDF_PATH);
ok('p1 PDF açıldı, Pro sürümde Düzenle düğmesi var', await ev(() => !document.getElementById('docView').hidden && !!document.querySelector('[data-doc="edit"]')));
await page.click('[data-doc="edit"]');
await page.waitForFunction(() => document.querySelectorAll('#docContent .pdfe-page').length > 0, null, { timeout: 25000 });
{
  const r = await ev(() => {
    const ps = [...document.querySelectorAll('#docContent .pdfe-page')];
    return { n: ps.length, sizes: ps.map(p => Math.round(parseFloat(p.style.width) / parseFloat(p.style.height) * 1000) / 1000), editmode: document.body.classList.contains('editmode'), tool: document.querySelector('#docContent .pdfe-stack')?.dataset.tool, tools: [...document.querySelectorAll('#docTools [data-pe="tool"]')].map(b => b.dataset.tool).join(',') };
  });
  // üç sayfa da A4 oranında görünmeli: 3. sayfa 842x595 ama 90 derece dönük, yani ekranda 595x842
  ok('p2 düzenleyici açıldı: 3 sayfa, dönük sayfa dahil A4 oranı, varsayılan el aracı', r.n === 3 && r.sizes.every(x => Math.abs(x - 595 / 842) < 0.01) && r.editmode && r.tool === 'pan' && r.tools === 'pan,pen,hi,text,stamp,erase', JSON.stringify(r));
}
// kalem: bir iz çiz
await page.click('[data-pe="tool"][data-tool="pen"]');
const drawOn = async (nth, dx, dy) => {
  await page.locator('#docContent .pdfe-page').nth(nth).scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const bb = await page.locator('#docContent .pdfe-page').nth(nth).boundingBox();
  await page.mouse.move(bb.x + dx, bb.y + dy); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(bb.x + dx + i * 10, bb.y + dy + Math.sin(i) * 14);
  await page.mouse.up(); await page.waitForTimeout(120);
};
await drawOn(0, 40, 70);
ok('p3 kalem izi eklendi (SVG polyline + saydam vuruş izi)', await ev(() => {
  const g = document.querySelectorAll('#docContent .pdfe-page:nth-of-type(1) g.pdfe-ann');
  const pl = g[0] && g[0].querySelectorAll('polyline');
  return g.length === 1 && pl.length === 2 && pl[0].getAttribute('stroke') === 'transparent' && +pl[0].getAttribute('stroke-width') >= 16 && pl[1].getAttribute('stroke') === '#d92b2b';
}));
// vurgu ikinci sayfaya
await page.click('[data-pe="tool"][data-tool="hi"]');
await drawOn(1, 40, 120);
ok('p4 vurgu izi kalın ve yarı saydam, ikinci sayfada', await ev(() => {
  const g = document.querySelectorAll('#docContent .pdfe-page:nth-of-type(2) g.pdfe-ann');
  const vis = g[0] && g[0].querySelectorAll('polyline')[1];
  return g.length === 1 && !!vis && +vis.getAttribute('stroke-opacity') < 0.5 && +vis.getAttribute('stroke-width') > 8;
}), String(await ev(() => document.querySelectorAll('#docContent .pdfe-page:nth-of-type(2) g.pdfe-ann').length)));
// damga (metin sormaz, hazır metin koyar)
await page.click('[data-pe="tool"][data-tool="stamp"]');
{
  await page.locator('#docContent .pdfe-page').nth(0).scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const bb = await page.locator('#docContent .pdfe-page').nth(0).boundingBox();
  await page.mouse.click(bb.x + bb.width * 0.55, bb.y + bb.height * 0.5);
  await page.waitForTimeout(150);
}
ok('p5 damga: çerçeveli tarihli metin', await ev(() => {
  const g = [...document.querySelectorAll('#docContent g.pdfe-ann')].find(x => x.querySelector('text'));
  return !!g && !!g.querySelector('rect') && /ONAYLANDI/.test(g.textContent) && /\d{2}\.\d{2}\.\d{4}/.test(g.textContent);
}), String(await ev(() => document.querySelectorAll('#docContent g.pdfe-ann').length)));
await shot('edit_pdf');
// silgi + geri al
const before = await ev(() => document.querySelectorAll('#docContent .pdfe-ann').length);
await page.click('[data-pe="tool"][data-tool="erase"]');
{
  // izin ÜZERİNDEKİ gerçek bir noktaya dokun: kalın saydam vuruş izi bunu yakalamalı
  await page.locator('#docContent .pdfe-page').nth(0).scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  const pt = await ev(() => {
    const hit = document.querySelector('#docContent .pdfe-page:nth-of-type(1) g.pdfe-ann polyline.pdfe-hit');
    const layer = hit.closest('svg'), r = layer.getBoundingClientRect(), vb = layer.viewBox.baseVal;
    const p = hit.getAttribute('points').split(' ')[2].split(',').map(Number);
    return [r.left + p[0] / vb.width * r.width, r.top + p[1] / vb.height * r.height];
  });
  await page.mouse.click(pt[0], pt[1]);
  await page.waitForTimeout(180);
}
const afterErase = await ev(() => document.querySelectorAll('#docContent .pdfe-ann').length);
await page.click('[data-pe="undo"]'); await page.waitForTimeout(150);
const afterUndo = await ev(() => document.querySelectorAll('#docContent .pdfe-ann').length);
ok('p6 silgi siler, geri al geri getirir', before === 3 && afterErase === 2 && afterUndo === 3, `${before} → ${afterErase} → ${afterUndo}`);
// sayfa döndürme (görünümdeki ilk sayfa) ve sayfa silme
await page.click('[data-pe="rotl"]'); await page.waitForTimeout(200);
ok('p7 sayfa sola döndürüldü (oran ters çevrildi)', await ev(() => { const p = document.querySelector('#docContent .pdfe-page'); return parseFloat(p.style.width) > parseFloat(p.style.height); }));
// yakınlaştır: sayfalar görüş alanından uzun olsun, böylece "etkin sayfa" belirgin olur
await page.click('[data-pe="zin"]'); await page.click('[data-pe="zin"]'); await page.waitForTimeout(150);
await page.locator('#docContent .pdfe-page').nth(1).scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
ok('p8a etkin sayfa ikinci sayfa olarak işaretlendi', await ev(() => {
  const ps = [...document.querySelectorAll('#docContent .pdfe-page')];
  return ps.length === 3 && ps[1].classList.contains('on') && !ps[0].classList.contains('on');
}), await ev(() => [...document.querySelectorAll('#docContent .pdfe-page')].map(p => p.classList.contains('on') ? '1' : '0').join('')));
await queueAnswers(page, true);   // "sayfa silinsin mi" onayı
await page.click('[data-pe="delpage"]'); await page.waitForTimeout(250);
ok('p8 görünümdeki sayfa silindi (3 → 2), döndürülen sayfa kaldı', await ev(() => {
  const ps = [...document.querySelectorAll('#docContent .pdfe-page')];
  return ps.length === 2 && parseFloat(ps[0].style.width) > parseFloat(ps[0].style.height);
}), String(await ev(() => document.querySelectorAll('#docContent .pdfe-page').length))); 
// kaydet ve indir
const dlPdf = page.waitForEvent('download', { timeout: 40000 });
await page.click('[data-pe="save"]');
const PDF_OUT = path.join(out, 'kesif_duzenlendi.pdf');
{
  const d = await dlPdf; await d.saveAs(PDF_OUT);
  ok('p9 düzenlenmiş PDF indirildi, düzenleme kipi kapandı', /duzenlendi\.pdf$/.test(d.suggestedFilename()) && await ev(() => !document.body.classList.contains('editmode') && !document.querySelector('.pdfe-page')), d.suggestedFilename());
}
// --- bağımsız doğrulama: pdf-lib ile geri oku ---
{
  const src = await PDFDocument.load(fs.readFileSync(PDF_PATH));
  const res = await PDFDocument.load(fs.readFileSync(PDF_OUT));
  const rots = res.getPages().map(p => p.getRotation().angle);
  const sizes = res.getPages().map(p => { const s = p.getSize(); return Math.round(s.width) + 'x' + Math.round(s.height); });
  const grew = fs.statSync(PDF_OUT).size > fs.statSync(PDF_PATH).size;
  // 1. sayfa sola döndürüldü (0 → 270), 2. sayfa silindi, 3. sayfa özgün 90 derecesini korudu
  ok('p10 çıktı PDF: 1 sayfa eksik, döndürme yazıldı, özgün büyüklüğü aştı', src.getPageCount() === 3 && res.getPageCount() === 2
    && rots[0] === 270 && sizes[0] === '595x842' && rots[1] === 90 && sizes[1] === '842x595' && grew, JSON.stringify({ rots, sizes, grew }));
  ok('p11 özgün PDF değişmedi', fs.statSync(PDF_PATH).size === (await src.save()).length || src.getPageCount() === 3);
}
await ev(() => window.dwgApp.docs.close());

// ---------------------------------------------------------------------------------
// 2) Pro: Word düzenleme ve DOCX yazıcı
// ---------------------------------------------------------------------------------
await openDoc(path.join(DOCS, 'SampleDoc.doc'));
ok('w1 .doc açıldı, Düzenle düğmesi var', await ev(() => !!document.querySelector('[data-doc="edit"]')));
await page.click('[data-doc="edit"]'); await page.waitForTimeout(400);
ok('w2 akış görünümü düzenlenebilir, araç satırı kuruldu', await ev(() => {
  const r = document.querySelector('.docx-page.doc-editing[contenteditable="true"]');
  const cmds = [...document.querySelectorAll('#docTools [data-pe]')].map(b => b.dataset.pe + (b.dataset.cmd ? ':' + b.dataset.cmd : '')).join(' ');
  return !!r && document.body.classList.contains('editmode') && cmds === 'cmd:bold cmd:italic cmd:underline cmd:justifyLeft cmd:justifyCenter cmd:justifyRight find undo save cancel';
}));
// metin ekle (Türkçe), kalın uygula, ortala
await ev(() => { const p = document.querySelector('.docx-page.doc-editing p'); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await page.keyboard.type(' ŞARTNAME EKİ ğüıöç');
await page.click('.docx-page.doc-editing p:nth-of-type(2)', { clickCount: 3 });
await page.click('[data-pe="cmd"][data-cmd="bold"]');
await page.click('.docx-page.doc-editing p:nth-of-type(3)', { clickCount: 3 });
await page.click('[data-pe="cmd"][data-cmd="justifyCenter"]');
await page.waitForTimeout(200);
ok('w3 yazma, kalın ve ortalama DOM\'a işledi', await ev(() => {
  const ps = document.querySelectorAll('.docx-page.doc-editing p');
  return /ŞARTNAME EKİ ğüıöç/.test(ps[0].textContent) && !!ps[1].querySelector('b') && /center/.test(ps[2].getAttribute('style') || '');
}));
// bul ve değiştir
await queueAnswers(page, 'Calibri', 'Times');
await page.click('[data-pe="find"]'); await page.waitForTimeout(300);
ok('w4 bul ve değiştir metni değiştirdi', await ev(() => /Times \(Body\)/.test(document.querySelector('.docx-page.doc-editing').textContent) && !/Calibri/.test(document.querySelector('.docx-page.doc-editing').textContent)));
await shot('edit_word');
const dlDocx = page.waitForEvent('download', { timeout: 40000 });
await page.click('[data-pe="save"]');
const DOCX_OUT = path.join(out, 'SampleDoc_duzenlendi.docx');
{
  const d = await dlDocx; await d.saveAs(DOCX_OUT);
  ok('w5 DOCX indirildi ve düzenleme kipi kapandı', /duzenlendi\.docx$/.test(d.suggestedFilename()) && await ev(() => !document.body.classList.contains('editmode')), d.suggestedFilename());
}
// --- bağımsız doğrulama: Node'un zlib'iyle aç, XML'i sına ---
{
  const files = unzip(fs.readFileSync(DOCX_OUT));
  const names = Object.keys(files).sort().join(' ');
  const doc = files['word/document.xml'].toString('utf8');
  const ct = files['[Content_Types].xml'].toString('utf8');
  const pgSz = /<w:pgSz w:w="(\d+)" w:h="(\d+)"\/>/.exec(doc);
  ok('w6 DOCX paketi eksiksiz ve XML iyi biçimli', names === '[Content_Types].xml _rels/.rels word/_rels/document.xml.rels word/document.xml word/styles.xml'
    && /wordprocessingml\.document\.main\+xml/.test(ct) && doc.startsWith('<?xml') && doc.trimEnd().endsWith('</w:document>')
    && (doc.match(/<w:p>/g) || []).length === (doc.match(/<\/w:p>/g) || []).length, names);
  ok('w7 DOCX içeriği: Türkçe metin, kalın, ortalama, sayfa sonu, A4 sayfa ölçüsü', doc.includes('ŞARTNAME EKİ ğüıöç') && doc.includes('<w:b/>')
    && doc.includes('<w:jc w:val="center"/>') && doc.includes('w:type="page"') && !!pgSz && Math.abs(+pgSz[1] - 11907) <= 2 && Math.abs(+pgSz[2] - 16840) <= 2,
    JSON.stringify({ b: (doc.match(/<w:b\/>/g) || []).length, jc: (doc.match(/w:jc/g) || []).length, pg: pgSz && pgSz.slice(1) }));
  ok('w8 kaynak .doc dosyası değişmedi', fs.statSync(path.join(DOCS, 'SampleDoc.doc')).size === 27136);
}
// --- gidiş-dönüş: ürettiğimiz DOCX'i kendi okuyucumuz açabiliyor mu ---
await ev(() => window.dwgApp.docs.close());
await openDoc(DOCX_OUT);
{
  const r = await ev(() => {
    const b = document.getElementById('docContent');
    return { meta: document.getElementById('docMeta').textContent, txt: b.textContent, bold: !!b.querySelector('[style*="font-weight:700"]'), center: !!b.querySelector('[style*="text-align:center"]'), body: b.querySelectorAll('.docx-page, .docx-sheet').length, paras: b.querySelectorAll('p, h1, h2').length, brk: !!b.querySelector('.pagebreak') };
  });
  // düzenlemeden çıkınca görünüm tercihi akış kipinde kaldığı için .docx-page beklenir
  ok('w9 gidiş-dönüş: ürettiğimiz DOCX kendi okuyucumuzla açılıyor, biçim korunuyor', /Word/.test(r.meta) && /ŞARTNAME EKİ ğüıöç/.test(r.txt) && /Times \(Body\)/.test(r.txt)
    && r.bold && r.center && r.body === 1 && r.paras >= 6 && r.brk, JSON.stringify({ ...r, txt: r.txt.slice(0, 50) }));
}
await ev(() => window.dwgApp.docs.close());

// ---------------------------------------------------------------------------------
// 3) Ücretsiz sürüm: düzenleme yok
// ---------------------------------------------------------------------------------
{
  const c2 = await browser.newContext(PHONE); await noUpdate(c2);
  await c2.addInitScript(() => { window.__edition = 'free'; });
  const p2 = await c2.newPage(); hook(p2);
  const ev2 = (fn, a) => p2.evaluate(fn, a);
  onDialog(p2, async d => { await d.dismiss(); });
  await boot(p2, ev2);
  await p2.setInputFiles('#fileInput', PDF_PATH);
  await p2.waitForFunction(() => !document.getElementById('docView').hidden, null, { timeout: 20000 });
  await p2.waitForTimeout(300);
  // v7.31: düğme GİZLENMEZ; çizilir, premium rozeti taşır ve tıklanınca düzenleyici yerine kapı açılır.
  const eb = await ev2(() => { const b = document.querySelector('[data-doc="edit"]'); return b ? { need: b.dataset.need || '', pill: !!b.querySelector('.lk-pill'), vh: (b.querySelector('.lk-vh') || {}).textContent || '' } : null; });
  ok('f1 Ücretsiz sürümde Düzenle düğmesi GÖRÜNÜR ve Premium rozeti taşır', await ev2(() => window.dwgApp.edition() === 'free') && eb && eb.need === 'premium' && eb.pill && /Premium/.test(eb.vh), JSON.stringify(eb));
  ok('f2 docEdit Premium kapısında (eski denetim ölüydü: dwgApp.editionApi hiç var olmadı)', await ev2(async () => { const Ed = await import('./edition.js'); return Ed.need('docEdit') === 'premium' && Ed.has('docEdit') === false; }));
  await c2.close();
}

C.summary(errors);
await browser.close(); srv.kill();
C.exit();
