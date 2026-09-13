// Word 97-2003 (.doc): samples/doc derlemi (Apache POI sınama verisi) Node'da doğrudan docToHtml ile — metin iddiaları
// çözümleyiciden BAĞIMSIZ (parça tablosunu ayrı bir Python okuyucuyla çıkaran zemin gerçeği ve `strings -el` çıktısından seçilmiş
// cümleler) — ve tarayıcıda belge görünümü (belge kipi, etiket, sayfa / akış, yakınlaştırma, resim, uyarı satırı, Dosya Aç süzgeci).
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_doc.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE, projectRoot } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { out, samples: SM } = args(import.meta.url);
const DOCS = path.join(SM, 'doc');
const C = checker(), ok = C.ok;
const { docToHtml } = await import(pathToFileURL(path.join(projectRoot, 'app', 'src', 'main', 'assets', 'viewer', 'doc.js')).href);
const { sniffDoc, rtfToHtml, mhtmlParts } = await import(pathToFileURL(path.join(projectRoot, 'app', 'src', 'main', 'assets', 'viewer', 'docalt.js')).href);
// ".doc" uzantılı öteki biçimler (EKAP vb. "Word'e aktar" çıktıları): sentetik RTF (cp1254), Word HTML (@page, MsoNormal, script), MHTML (PNG parçası)
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');   // 1×1 PNG
const RTF = Buffer.concat([Buffer.from('{\\rtf1\\ansi\\ansicpg1254\\deff0\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1134\\margb1134{\\fonttbl{\\f0\\fnil Times New Roman;}}{\\colortbl;\\red255\\green0\\blue0;\\red0\\green0\\blue255;}{\\info{\\title gizli}}\\pard\\qc\\b\\fs32 \\u304?DAR\\u304? \\u350?ARTNAME\\b0\\fs24\\par\n\\pard\\qj Madde 1 - \\cf1 k\\\'fdrm\\\'fdz\\cf0  ve \\i italik\\i0  yaz\\\'fd; \\u351?\\u287?\\u252?\\u246?\\u231? {\\field{\\*\\fldinst HYPERLINK "https://ekap.kik.gov.tr"}{\\fldrslt EKAP}}\\par\n{\\listtext\\tab 1.\\tab}\\pard\\li720\\fi-360 Birinci madde\\par\n{\\listtext\\tab 2.\\tab}\\pard\\li720\\fi-360 \\u304?kinci madde\\par\n\\pard\\trowd\\cellx3000\\cellx6000\\intbl Poz\\cell Tutar\\cell\\row\\trowd\\cellx3000\\cellx6000\\intbl 15.140\\cell 1.250,50\\cell\\row\n\\pard\\par Resim: {\\pict\\pngblip\\picwgoal1440 '), Buffer.from(PNG1.toString('hex')), Buffer.from('}\\par\\page Son sayfa\\par}')]);
const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta http-equiv=Content-Type content="text/html; charset=windows-1254"><title>Şartname</title><style>@page WordSection1 { size:595.3pt 841.9pt; margin:70.85pt 70.85pt 70.85pt 70.85pt; } p.MsoNormal { margin:0cm; font-size:12pt; }</style><script>window.__pwned = 1;</script></head><body lang=TR><div class=WordSection1><p class=MsoNormal align=center style='text-align:center'><b>İDARİ ŞARTNAME</b><o:p></o:p></p><p class=MsoNormal onclick="window.__pwned=2" style='position:absolute;color:#1F497D'>Madde 1 - İşin adı: <a href="javascript:alert(1)">kötü</a> <a href="https://ekap.kik.gov.tr">EKAP</a></p><table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse'><tr><td width=200 style='width:150pt;border:solid windowtext 1pt'><p class=MsoNormal>Poz</p></td><td><p class=MsoNormal>Tutar</p></td></tr><tr><td><p class=MsoNormal>15.140</p></td><td><p class=MsoNormal>1.250,50</p></td></tr></table><img src="file:///C:/tmp/image001.jpg" width=100><br clear=all style='page-break-before:always'><p class=MsoNormal>İkinci sayfa</p></div></body></html>`;
const MHTML = ['MIME-Version: 1.0', 'Content-Type: multipart/related; boundary="----=_NextPart_01"', '', '------=_NextPart_01', 'Content-Location: file:///C:/sartname.htm', 'Content-Transfer-Encoding: quoted-printable', 'Content-Type: text/html; charset="utf-8"', '', '<html><head><style>@page { size: 21cm 29.7cm; margin: 2cm; }</style></head><body><p class=3DMsoNormal>Web ar=C5=9Fivi paragraf=C4=B1</p><img src=3D"file:///C:/sartname_files/image001.png"></body></html>', '------=_NextPart_01', 'Content-Location: file:///C:/sartname_files/image001.png', 'Content-Transfer-Encoding: base64', 'Content-Type: image/png', '', PNG1.toString('base64'), '------=_NextPart_01--', ''].join('\r\n');
fs.writeFileSync(path.join(out, 'ekap_rtf.doc'), RTF); const CP1254 = { 'İ': 0xDD, 'Ş': 0xDE, 'Ğ': 0xD0, 'ı': 0xFD, 'ş': 0xFE, 'ğ': 0xF0 };   // windows-1254'ün latin1'den ayrılan Türkçe harfleri
const enc1254 = (s) => Buffer.from(Array.from(s, ch => CP1254[ch] != null ? CP1254[ch] : ch.charCodeAt(0) & 255));
fs.writeFileSync(path.join(out, 'word_html.doc'), enc1254(WORD_HTML)); fs.writeFileSync(path.join(out, 'web_arsivi.doc'), MHTML, 'latin1');

// ---------------------------------------------------------------------------------
// 1) Node: doğrudan dönüştürücü
// ---------------------------------------------------------------------------------
const bufOf = (name) => { const b = fs.readFileSync(path.join(DOCS, name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const unent = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const textOf = (r) => unent(r.parts.join('\n').replace(/<[^>]+>/g, ''));
const conv = (name, opts) => { const t0 = performance.now(); const r = docToHtml(bufOf(name), opts); r.ms = performance.now() - t0; r.text = textOf(r); return r; };
const has = (s, ...subs) => subs.every(x => s.includes(x));
const inOrder = (s, ...subs) => { let i = 0; for (const x of subs) { const j = s.indexOf(x, i); if (j < 0) return false; i = j + x.length; } return true; };
const strip = (h) => h.replace(/<span[^>]*>|<\/span>|<p>|<\/p>/g, '');
{
  const r = conv('SampleDoc.doc');
  ok('n1 SampleDoc: 7 paragraf, metin sırayla', r.parts.length === 7 && inOrder(r.text, 'I am a test document', 'This is page 1', 'I am Calibri (Body) in font size 11', 'This is page two', 'It’s Arial Black in 16 point', 'It’s also in blue'), r.parts.length + ' | ' + r.text.slice(0, 60));
  ok('n2 SampleDoc: sayfa sonu, A4 (11907 × 16840 twip), 72 pt kenar, 16 pt mavi (COLORREF 54 8D D4)', r.html.includes('<div class="pagebreak"></div>') && Math.abs(r.page.width - 595.35) < 0.5 && Math.abs(r.page.height - 842) < 0.5 && r.page.margins.left === 72 && r.page.margins.top === 72 && r.html.includes('<span style="color:#548DD4;font-size:16pt">It’s also in blue</span>') && r.warnings.length === 0 && r.width === r.page.width + 'pt', JSON.stringify(r.page));
}
{ const r = conv('simple.doc'); ok('n3 simple: Word 97 SR-2 tek paragraf, Letter', r.parts.length === 1 && has(r.text, 'This is a simple file created with Word 97-SR2.') && r.page.width === 612 && r.page.height === 792, r.text); }
{
  const r = conv('Lists.doc'); const lis = r.parts.filter(p => p.startsWith('<p class="li"'));
  const bul = (p) => (/<span class="bul">([^<]*)<\/span>/.exec(p) || [])[1];
  ok('n4 Lists: h1 başlık + ≥ 20 liste paragrafı', r.parts[0].startsWith('<h1') && has(r.text, 'Heading Level 1', 'This document has different lists in it for testing') && lis.length >= 20, String(lis.length));
  const ptext = (p) => p.replace(/<span class="bul">[^<]*<\/span>/, '').replace(/<[^>]+>/g, '');
  const ul = lis.filter(p => ['Unordered list 1', 'UL 2', 'UL 3'].includes(ptext(p))).map(bul), ol = lis.filter(p => ['Ordered list 1', 'OL 2', 'OL 3'].includes(ptext(p))).slice(0, 3).map(bul), tick = lis.filter(p => ['Tick 1', 'Tick 2'].includes(ptext(p))).map(bul);
  ok('n5 Lists: madde imi •, numara 1. 2. 3., Wingdings onay imi', JSON.stringify(ul) === '["•","•","•"]' && JSON.stringify(ol) === '["1.","2.","3."]' && tick.length === 2 && tick.every(t => t === '✓'), JSON.stringify({ ul, ol, tick }));
  // çok düzeyli numaralı liste: metnin kendisi beklenen numarayı söyler ("OL 2.2.1" → "2.2.1."); düzey sayaçları ve sıfırlama
  const mlo = lis.filter(p => /^OL \d/.test(ptext(p))).map(p => [ptext(p), bul(p)]); const mlOk = mlo.length >= 9 && mlo.every(([t, b]) => b === t.slice(3) + '.');
  ok('n5b Lists: çok düzeyli numaralama metinle örtüşür (1. 2. 2.1. 2.2. 2.2.1. … 3.)', mlOk, JSON.stringify(mlo));
  const ml = [...new Set(lis.map(p => (/margin-left:([\d.]+)pt/.exec(p) || [])[1]))];
  ok('n6 Lists: çok düzeyli liste (≥ 2 farklı sol boşluk)', ml.length >= 2 && has(r.text, 'ML 1:1'), ml.join(','));
}
{
  const r = conv('innertable.doc'); const tbl = r.parts[0];
  ok('n7 innertable: dış tablo 3 satır, E hücresinde 2 satırlı iç tablo, hücre sırası', r.parts.length === 2 && tbl.startsWith('<table class="docx-tbl">') && (tbl.match(/<table/g) || []).length === 2 && (tbl.match(/<tr>/g) || []).length === 5 && /<td[^>]*><p>(<span[^>]*>)?E(<\/span>)?<\/p><table/.test(tbl) && inOrder(r.text, 'A', 'B', 'C', 'D', 'E', '1', '2', '3', '4', 'F', 'G', 'H', 'I', 'J'), strip(tbl).slice(0, 300));
}
{
  const r = conv('table-merges.doc'); const tbl = r.parts[0];
  ok('n8 table-merges: ızgara (5 sütun) ve colspan', /<colgroup>(<col style="width:[\d.]+pt">){5}<\/colgroup>/.test(tbl) && tbl.includes('<td colspan="3">') && tbl.includes('<td colspan="2">') && inOrder(r.text, 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'), strip(tbl).slice(0, 300));
}
{
  const r = conv('test-fields.doc');
  ok('n9 test-fields: alan kodu gizli, sonuç görünür, dipnot 1 / sonnot i, bölümler', !/CREATEDATE|MERGEFORMAT/.test(r.text) && has(r.text, '19/11/2010 14:49:00', 'Here is a link to an endnote', 'Here is a link to a footnote', 'Some annotation linking here') && r.html.includes('endnote</span><sup>i</sup>') && r.html.includes('footnote</span><sup>1</sup>') && inOrder(r.text, 'Dipnotlar', 'Sonnotlar'), r.text.replace(/\n/g, ' | ').slice(0, 220));
}
{ const r = conv('footnote.doc'); ok('n10 footnote: başvurular ve Dipnotlar / Sonnotlar bölümleri', r.parts[0].includes('Test text</span><sup>1</sup><sup>i</sup>') && inOrder(r.text, 'Test text', 'Dipnotlar', '1', 'TestFootnote', 'Sonnotlar', 'i', 'TestEndnote'), r.text.replace(/\n/g, ' | ')); }
{ const r = conv('hyperlink.doc'); ok('n11 hyperlink: HYPERLINK alanı → <a href>', /<a href="http:\/\/testuri\.org\/" target="_blank" rel="noopener">.*Hyperlink text.*<\/a>/.test(r.html) && !/HYPERLINK/.test(r.text) && inOrder(r.text, 'Before text; ', 'Hyperlink text', '; after text'), r.html.slice(0, 300)); }
{ const r = conv('HeaderFooterUnicode.doc'); ok('n12 HeaderFooterUnicode: yalnız ana metin (12 paragraf), £ € ve Fransızca', r.parts.length === 12 && has(r.text, 'This is a fairly simple word document, over two pages, with headers and footers.', 'GBP - £', 'EUR - €', 'Now, we’ll have some French text, in bold and big:', 'Molière', 'École du mensonge', 'This is page two.') && !/This is a header|This is a footer/i.test(r.text), String(r.parts.length)); }
{ const r = conv('o_kurs.doc'); ok('n13 o_kurs: hızlı kaydedilmiş Rusça belge (395 parça, 0Table) < 1 s, satır sonu, liste', r.ms < 1000 && r.parts.length >= 40 && inOrder(r.text, 'МИНИСТЕРСТВО ЭКОНОМИЧЕСКОГО РАЗВИТИЯ И ТОРГОВЛИ', 'РОССИЙСКОЙ ФЕДЕРАЦИИ', 'ВЫСШАЯ КОММЕРЧЕСКАЯ ШКОЛА', 'УТВЕРЖДАЮ') && r.parts[0].includes('<br>') && r.html.includes('class="li"') && r.warnings.length === 0, `${r.ms.toFixed(0)} ms, ${r.parts.length} blok, ${r.warnings.join(';')}`); }
{
  // picture.doc: satır içi resim deflate ile sıkıştırılmış bir EMF; içinde tek EMR_STRETCHDIBITS (sıkıştırılmamış DIB 1024 × 768 × 24 bit,
  // 2.359.296 bayt — Python zlib + EMF kayıt yürüyüşüyle bağımsız doğrulandı) → doc.js açar, DIB'i BMP olarak verir
  const r = conv('picture.doc'); const m = /<img src="data:image\/bmp;base64,([A-Za-z0-9+/=]+)" alt="" style="width:([\d.]+)pt;max-width:100%">/.exec(r.html);
  ok('n14 picture: 1,4 MB, deflate EMF içindeki DIB çıkarıldı, < 3 s', !!m && m[1].length > 3000000 && +m[2] > 100 && r.ms < 3000 && r.warnings.length === 0 && r.text.includes('qwertyuiop'), `${r.ms.toFixed(0)} ms ${m ? m[1].length + ' b64, ' + m[2] + ' pt' : 'img yok'} ${r.warnings.join(';')}`);
  if (m) { const bmp = Buffer.from(m[1], 'base64'); const w = bmp.readInt32LE(18), h = bmp.readInt32LE(22), bpp = bmp.readUInt16LE(28), off = bmp.readUInt32LE(10); ok('n15 picture: BMP başlığı (BM, 1024 × 768, 24 bit, veri 2.359.296 bayt)', bmp[0] === 0x42 && bmp[1] === 0x4D && w === 1024 && Math.abs(h) === 768 && bpp === 24 && bmp.length - off === 2359296, `${w}×${h} ${bpp} bit, ${bmp.length} bayt`); fs.writeFileSync(path.join(out, 'picture.bmp'), bmp); }
}
for (const [name, want] of [['Word95.doc', 'The quick brown fox jumps over the lazy dog'], ['Word6.doc', 'The quick brown fox jumps over the lazy dog'], ['Bug60936.doc', '4 skóre a p']]) {   // Bug60936: Çekçe metin ama lid 0x0409 (İngilizce) — kod sayfası bilinemez, 1252 ile 'pøed' çıkar
  const r = conv(name); ok(`n16 ${name}: Word 6/95 (wIdent 0xA5DC) yalnız metin + uyarı`, has(r.text, want) && r.warnings.some(w => /Word 6\/95/.test(w)), r.text.slice(0, 60).replace(/\n/g, ' | ') + ' | ' + r.warnings.join(';'));
}
{ const r = conv('Bug49933.doc'); ok('n17 Bug49933: Word 95 Rusça — yazı tipi kodlamalı Kiril (windows-1251) ve 0x07 tablo sezgisi', has(r.text, 'Компания', 'предлагает со склада в Москве') && r.parts.some(p => p.startsWith('<table')) && r.warnings.some(w => /Word 6\/95/.test(w)), r.text.slice(0, 80).replace(/\n/g, ' | ')); }
{
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let runs = 0, crashes = 0, errs = 0, okc = 0;
  for (const name of ['SampleDoc.doc', 'Lists.doc', 'innertable.doc', 'o_kurs.doc', 'Word95.doc', 'picture.doc']) {
    const orig = Buffer.from(fs.readFileSync(path.join(DOCS, name)));
    const variants = [orig.subarray(0, Math.floor(orig.length * 0.5)), orig.subarray(0, 600), orig.subarray(0, 511), orig.subarray(0, 2048)];
    for (let k = 0; k < 6; k++) { const b = Buffer.from(orig); for (let i = 0; i < 30; i++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256); variants.push(b); }
    for (const b of variants) { runs++; try { docToHtml(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); okc++; } catch (e) { if (e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError) { crashes++; console.log('  çökme', name, e.message); } else errs++; } }
  }
  ok('n18 bozuk / kısaltılmış dosyalar: çökme yok (TypeError / RangeError)', crashes === 0, `${runs} deneme, ${okc} çıktı, ${errs} denetimli hata`);
}
{
  let msg = ''; try { docToHtml(new Uint8Array(1024).buffer); } catch (e) { msg = e.message; }
  ok('n19 OLE olmayan veri → "Word belgesi değil"', /Word belgesi değil/.test(msg), msg);
  // şifreli bayrağı: FIB'in sektörü (EC A5 ile başlar) bulunur, fEncrypted (bit 8 @0x0A) kaldırılır → reddedilmeli
  const b = Buffer.from(fs.readFileSync(path.join(DOCS, 'simple.doc'))); let fib = -1; for (let p = 512; p + 16 <= b.length; p += 512) if (b[p] === 0xEC && b[p + 1] === 0xA5) { fib = p; break; }
  let enc = ''; if (fib >= 0) { b[fib + 0x0B] |= 0x01; try { docToHtml(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); } catch (e) { enc = e.message; } }
  ok('n20 şifreli belge reddedilir', fib >= 0 && /Şifreli/.test(enc), fib + ' ' + enc);
  const tr = conv('Word6.doc', { tt: (k) => 'K:' + k }); ok('n21 çeviri kancası (tt) uyarı metnine uygulanır', tr.warnings[0] === 'K:docOldWord', tr.warnings.join(';'));
}
{
  const sn = (b) => sniffDoc(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  ok('n22 biçim tanıma: OLE / RTF / HTML / MHTML / ZIP / metin / bilinmeyen', sn(fs.readFileSync(path.join(DOCS, 'simple.doc'))) === 'ole' && sn(RTF) === 'rtf' && sn(enc1254(WORD_HTML)) === 'html' && sn(Buffer.from(MHTML, 'latin1')) === 'mhtml' && sn(Buffer.from('PK\x03\x04' + 'x'.repeat(40), 'latin1')) === 'zip' && sn(Buffer.from('Düz metin belgesi\nikinci satır\n')) === 'text' && sn(Buffer.from([0, 1, 2, 3, 200, 201, 7, 8, 0, 0, 0, 0])) === 'unknown');
  const r = rtfToHtml(RTF.buffer.slice(RTF.byteOffset, RTF.byteOffset + RTF.byteLength)); const t = textOf(r);
  ok('n23 RTF: Türkçe (cp1254 \\\'fd ve \\uN), başlık ortalı kalın, renk, italik, köprü', has(t, 'İDARİ ŞARTNAME', 'Madde 1 - kırmız ve italik yazı; şğüöç EKAP') && /<p style="text-align:center"><span style="font-weight:700;font-size:16pt">İDARİ ŞARTNAME<\/span><\/p>/.test(r.parts[0]) && r.html.includes('<span style="color:#FF0000;font-size:12pt">kırmız</span>') && r.html.includes('font-style:italic') && /<a href="https:\/\/ekap\.kik\.gov\.tr" target="_blank" rel="noopener">(<span[^>]*>)?EKAP(<\/span>)?<\/a>/.test(r.html) && !/gizli/.test(t), r.parts.slice(0, 2).join(' | ').slice(0, 300));
  ok('n24 RTF: liste (listtext), tablo (cellx → colgroup), resim (pngblip), sayfa sonu, A4 2 cm', r.html.includes('<p class="li" style="margin-left:36pt"><span class="bul">1.</span>') && r.html.includes('<span class="bul">2.</span>') && /<table class="docx-tbl"><colgroup><col style="width:150pt"><col style="width:150pt"><\/colgroup><tr><td><p>(<span[^>]*>)?Poz(<\/span>)?<\/p><\/td><td><p>(<span[^>]*>)?Tutar(<\/span>)?<\/p><\/td><\/tr><tr><td><p>(<span[^>]*>)?15\.140(<\/span>)?<\/p><\/td><td><p>(<span[^>]*>)?1\.250,50(<\/span>)?<\/p><\/td><\/tr><\/table>/.test(r.html) && r.html.includes('<img src="data:image/png;base64,' + PNG1.toString('base64') + '" alt="" style="width:72pt;max-width:100%">') && r.html.includes('<div class="pagebreak"></div>') && has(t, 'Son sayfa') && Math.abs(r.page.width - 595.3) < 0.1 && r.page.margins.left === 56.7 && r.warnings.length === 0, r.html.slice(300, 900));
  const m = mhtmlParts(Buffer.from(MHTML, 'latin1')); ok('n25 MHTML: HTML parçası (quoted-printable, UTF-8) ve PNG parçası çözülür', /Web arşivi paragrafı/.test(m.html) && m.resolve('file:///C:/sartname_files/image001.png').startsWith('data:image/png;base64,') && m.resolve('image001.png') !== '', m.html.slice(0, 120));
}

// ---------------------------------------------------------------------------------
// 2) Tarayıcı: belge görünümü
// ---------------------------------------------------------------------------------
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const donePages = () => page.waitForFunction(() => document.querySelector('#docContent .docx-pages')?.dataset.done === '1', null, { timeout: 20000 });
const openDoc = async (name) => { await page.setInputFiles('#fileInput', path.join(DOCS, name)); await page.waitForFunction(() => !document.getElementById('docView').hidden, null, { timeout: 20000 }); await page.waitForTimeout(150); };
await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2');
await openDoc('SampleDoc.doc'); await donePages();
{
  const r = await ev(() => { const b = document.getElementById('docContent'); const sheets = [...b.querySelectorAll('.docx-sheet')]; return { docmode: document.body.classList.contains('docmode'), meta: document.getElementById('docMeta').textContent, paged: b.classList.contains('paged'), n: sheets.length, p1: /I am a test document/.test(sheets[0]?.textContent || ''), p2: /This is page two/.test(sheets[1]?.textContent || ''), no: sheets[0]?.querySelector('.docx-no')?.textContent, pad: sheets[0]?.style.paddingLeft, toolbar: getComputedStyle(document.getElementById('toolbar')).display, warn: !!document.querySelector('#docTools .doc-warn') }; });
  ok('b1 SampleDoc: belge kipi, "Word 97-2003" etiketi, 2 sayfa (sayfa sonu), metin doğru sayfada, 72 pt kenar, şerit gizli', r.docmode && /Word 97-2003/.test(r.meta) && r.paged && r.n === 2 && r.p1 && r.p2 && r.no === '1 / 2' && r.pad === '96px' && r.toolbar === 'none' && !r.warn, JSON.stringify(r));
}
await shot('doc_sample');
await page.click('#docTools [data-doc="layout"]'); await page.waitForTimeout(200);
{
  const f0 = await ev(() => ({ flow: !!document.querySelector('#docContent .docx-page'), sheets: document.querySelectorAll('#docContent .docx-sheet').length, btn: document.querySelector('#docTools [data-doc="layout"]').dataset.layout, st: localStorage.getItem('doc:docxLayout'), txt: /It’s also in blue/.test(document.querySelector('#docContent .docx-page')?.textContent || '') }));
  await page.click('#docTools [data-doc="zin"]'); await page.waitForTimeout(100);
  const f1 = await ev(() => parseFloat(document.querySelector('#docContent .docx-page').style.fontSize));
  ok('b2 akış görünümü + yazı yakınlaştırma (.doc)', f0.flow && f0.sheets === 0 && f0.btn === 'flow' && f0.st === 'flow' && f0.txt && f1 > 100, JSON.stringify({ f0, f1 }));
  await page.click('#docTools [data-doc="layout"]'); await page.waitForTimeout(200); await donePages();
  const z0 = await ev(() => window.dwgApp.docs.current().pzoom);
  await page.click('#docTools [data-doc="zin"]'); await page.waitForTimeout(100);
  const z1 = await ev(() => ({ z: window.dwgApp.docs.current().pzoom, tr: document.querySelector('#docContent .docx-pages').style.transform, kind: window.dwgApp.docs.current().kind }));
  ok('b3 sayfa kipine dönüş + ölçek büyütme (.doc)', z1.kind === 'doc' && z1.z > z0 && /scale\(/.test(z1.tr), JSON.stringify({ z0, z1 }));
}
await ev(() => window.dwgApp.docs.close());
await openDoc('Lists.doc'); await donePages();
ok('b4 Lists: sayfada liste paragrafları ve imler', await ev(() => { const li = document.querySelectorAll('#docContent .docx-sheet .li'); return li.length >= 20 && [...li].some(l => l.querySelector('.bul')?.textContent === '•') && [...li].some(l => l.querySelector('.bul')?.textContent === '2.'); }), String(await ev(() => document.querySelectorAll('#docContent .docx-sheet .li').length)));
await shot('doc_lists');
await ev(() => window.dwgApp.docs.close());
await openDoc('innertable.doc'); await donePages();
ok('b5 innertable: iç içe tablo çizildi', await ev(() => !!document.querySelector('#docContent .docx-sheet .docx-tbl td .docx-tbl') && document.querySelectorAll('#docContent .docx-sheet .docx-tbl td').length >= 12));
await ev(() => window.dwgApp.docs.close());
await openDoc('picture.doc'); await donePages();
{
  await page.waitForFunction(() => { const im = document.querySelector('#docContent .docx-sheet img'); return !!im && im.complete; }, null, { timeout: 20000 });
  const r = await ev(() => { const im = document.querySelector('#docContent .docx-sheet img'); return { src: im.getAttribute('src').slice(0, 22), w: im.naturalWidth, h: im.naturalHeight, css: im.style.width, n: document.querySelectorAll('#docContent .docx-sheet').length }; });
  ok('b6 picture: EMF içindeki DIB tarayıcıda çözüldü (1024 × 768), genişlik pt', /^data:image\/bmp;base64/.test(r.src) && r.w === 1024 && r.h === 768 && /pt$/.test(r.css) && r.n >= 1, JSON.stringify(r));
}
await shot('doc_picture');
await ev(() => window.dwgApp.docs.close());
await openDoc('Word95.doc'); await donePages();
ok('b7 Word95: uyarı satırı (Word 6/95) ve metin', await ev(() => /Word 6\/95/.test(document.querySelector('#docTools .doc-warn')?.textContent || '') && /quick brown fox/.test(document.querySelector('#docContent .docx-sheet')?.textContent || '')));
await ev(() => window.dwgApp.docs.close());
ok('b8 kapatınca belge kipi biter', await ev(() => !document.body.classList.contains('docmode') && document.getElementById('docView').hidden));
// ".doc" uzantılı RTF / Word HTML / MHTML: tarayıcıda belge görünümü, etiket, temizleme (script çalışmaz, on* / javascript: silinir)
await page.setInputFiles('#fileInput', path.join(out, 'ekap_rtf.doc')); await page.waitForFunction(() => !document.getElementById('docView').hidden, null, { timeout: 20000 }); await donePages();
{ const r = await ev(() => ({ meta: document.getElementById('docMeta').textContent, n: document.querySelectorAll('#docContent .docx-sheet').length, t: document.querySelector('#docContent .docx-sheet')?.textContent || '', tbl: !!document.querySelector('#docContent .docx-sheet .docx-tbl'), img: document.querySelector('#docContent .docx-sheet img')?.naturalWidth })); ok('b10 RTF .doc: sayfa görünümü (2 sayfa), RTF etiketi, tablo, resim', /RTF/.test(r.meta) && r.n === 2 && /İDARİ ŞARTNAME/.test(r.t) && r.tbl && r.img === 1, JSON.stringify(r)); }
await shot('doc_rtf');
await ev(() => window.dwgApp.docs.close());
await page.setInputFiles('#fileInput', path.join(out, 'word_html.doc')); await page.waitForFunction(() => !document.getElementById('docView').hidden, null, { timeout: 20000 }); await donePages();
{ const r = await ev(() => { const sh = [...document.querySelectorAll('#docContent .docx-sheet')]; const a = [...document.querySelectorAll('#docContent .docx-sheet a')]; return { meta: document.getElementById('docMeta').textContent, n: sh.length, t: sh[0]?.textContent || '', p2: /İkinci sayfa/.test(sh[1]?.textContent || ''), tbl: document.querySelectorAll('#docContent .docx-sheet .docx-tbl td').length, pwned: window.__pwned, onclick: !!document.querySelector('#docContent [onclick]'), js: a.some(x => /javascript/i.test(x.getAttribute('href') || '')), ekap: a.some(x => x.href === 'https://ekap.kik.gov.tr/' && x.target === '_blank'), pad: sh[0]?.style.paddingLeft, ph: !!document.querySelector('#docContent .docx-sheet .muted'), abs: !!document.querySelector('#docContent .docx-sheet [style*="position"]') }; });
  ok('b11 Word HTML .doc: @page (A4, 70,85 pt), tablo, sayfa sonu, script / onclick / javascript: temizlendi, dış köprü', /Word HTML/.test(r.meta) && r.n === 2 && /İDARİ ŞARTNAME/.test(r.t) && /Madde 1 - İşin adı/.test(r.t) && r.p2 && r.tbl === 4 && r.pwned === undefined && !r.onclick && !r.js && r.ekap && /^94\.[45]/.test(r.pad || '') && r.ph && !r.abs, JSON.stringify(r)); }
await shot('doc_html');
await ev(() => window.dwgApp.docs.close());
await page.setInputFiles('#fileInput', path.join(out, 'web_arsivi.doc')); await page.waitForFunction(() => !document.getElementById('docView').hidden, null, { timeout: 20000 }); await donePages();
{ await page.waitForFunction(() => { const im = document.querySelector('#docContent .docx-sheet img'); return !!im && im.complete; }, null, { timeout: 10000 }).catch(() => {}); const r = await ev(() => ({ meta: document.getElementById('docMeta').textContent, t: document.querySelector('#docContent .docx-sheet')?.textContent || '', img: document.querySelector('#docContent .docx-sheet img')?.naturalWidth, pad: document.querySelector('#docContent .docx-sheet')?.style.paddingLeft })); ok('b12 MHTML .doc: UTF-8 metin, cid resmi data: URL, 2 cm kenar', /MHTML/.test(r.meta) && /Web arşivi paragrafı/.test(r.t) && r.img === 1 && /^75\.[56]/.test(r.pad || ''), JSON.stringify(r)); }
await ev(() => window.dwgApp.docs.close());
// Dosya Aç: tür süzgeci "Ofis" .doc'u kapsar (sanal klasör ağacı → doc/ klasörü)
{
  await ev(() => document.getElementById('btnOpen').click()); await page.waitForTimeout(80);
  await page.click('#openChips [data-open-tab="device"]'); await page.waitForTimeout(60);
  await page.setInputFiles('#folderInput', SM);
  await page.waitForFunction(() => document.querySelectorAll('#openBody [data-open-entry]').length >= 5, null, { timeout: 10000 });
  const dirRow = await ev(() => { const r = [...document.querySelectorAll('#openBody [data-open-entry]')].find(x => x.dataset.dir === '1' && x.dataset.name === 'doc'); return !!r; });
  if (dirRow) {
    await page.click('#openBody [data-open-entry][data-name="doc"]'); await page.waitForTimeout(120);
    await page.selectOption('#openKind', 'office'); await page.waitForTimeout(80);
    const rows = await ev(() => [...document.querySelectorAll('#openBody [data-open-entry]')].map(r => r.dataset.name));
    const n = fs.readdirSync(DOCS).filter(f => /\.doc$/i.test(f)).length;
    ok('b9 Dosya Aç › Ofis süzgeci .doc dosyalarını listeler', rows.length === n && rows.every(x => /\.doc$/i.test(x)), rows.length + '/' + n);
    await page.selectOption('#openKind', 'all');
  } else C.skip('b9 Dosya Aç › Ofis süzgeci', 'doc/ klasör satırı yok');
  await page.click('#openPanel [data-open="close"]');
}
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
