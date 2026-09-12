// Belge görüntüleyici (PDF / DOCX / XLSX / ZIP / metin), Drive paneli (Android köprü taklidi) ve 3B stil sınaması.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_docs.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;

// ---- küçük ZIP yazıcı (store + deflate, CRC32) ----
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
const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Teknik Rapor</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Kalın</w:t></w:r><w:r><w:t xml:space="preserve"> ve </w:t></w:r><w:r><w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr><w:t>kırmızı italik</w:t></w:r><w:r><w:t>. Şğüçöı</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Madde bir</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Madde iki</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Baca</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Kot</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>52,40</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:hyperlink r:id="rId5"><w:r><w:t>bağlantı</w:t></w:r></w:hyperlink></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;
const numXml = `<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const relsXml = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://isu.gov.tr" TargetMode="External"/></Relationships>`;
const docx = makeZip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', docxXml], ['word/styles.xml', stylesXml], ['word/numbering.xml', numXml], ['word/_rels/document.xml.rels', relsXml]]);
const xlsx = makeZip([['xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Metraj" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`],
  ['xl/sharedStrings.xml', `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Poz</t></si><si><t>Ø300 boru</t></si></sst>`],
  ['xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>1250.5</v></c></row></sheetData><mergeCells><mergeCell ref="A3:B3"/></mergeCells></worksheet>`]]);
const dwgBytes = fs.readFileSync(path.join(SM, 'test_tr.dxf'));
const zip = makeZip([['pafta/plan.dxf', dwgBytes], ['pafta/notlar.txt', 'satır 1\nsatır 2\n'], ['rapor.docx', docx], ['veri.csv', 'ad;x;y\nB1;100;200\nB2;150;250\n']]);
fs.writeFileSync(path.join(out, 'ornek.zip'), zip); fs.writeFileSync(path.join(out, 'rapor.docx'), docx); fs.writeFileSync(path.join(out, 'metraj.xlsx'), xlsx);
// tek sayfalık geçerli PDF (tarayıcıda embed)
const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>`;
fs.writeFileSync(path.join(out, 'test.pdf'), pdf);

const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });  // pdfpage_* taklit ortamda 404 döner
onDialog(page, async d => { await d.accept('5'); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2');

// ---- ZIP (tarayıcı okuyucu) ----
await page.setInputFiles('#fileInput', path.join(out, 'ornek.zip')); await page.waitForTimeout(600);
ok('zip açıldı', await ev(() => !document.getElementById('docView').hidden && document.querySelectorAll('#docContent .arc-item').length >= 3), String(await ev(() => document.querySelectorAll('#docContent .arc-item').length)));
await shot('doc_zip');
await page.click('#docContent .arc-item[data-entry="pafta/"]'); await page.waitForTimeout(200);
ok('zip klasör', await ev(() => !!document.querySelector('#docContent .arc-item[data-entry="pafta/notlar.txt"]')));
await page.click('#docContent .arc-item[data-entry="pafta/notlar.txt"]'); await page.waitForTimeout(400);
ok('zip › metin', await ev(() => /satır 2/.test(document.querySelector('#docContent .doc-pre')?.textContent || '')));
{ const b = await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(250); ok('geri', b === true && await ev(() => !!document.querySelector('#docContent .arc-item'))); }
await page.click('#docContent [data-crumb=""]'); await page.waitForTimeout(150);
await page.click('#docContent .arc-item[data-entry="veri.csv"]'); await page.waitForTimeout(300);
ok('zip › csv tablo', await ev(() => document.querySelectorAll('#docContent .xlsx-tbl tr').length === 3));
await shot('doc_csv');
await ev(() => window.dwgApp.onBack());
await page.click('#docContent .arc-item[data-entry="rapor.docx"]'); await page.waitForTimeout(600);
{
  const r = await ev(() => { const p = document.querySelector('#docContent .docx-page'); return { h1: !!p?.querySelector('h1'), bold: !!p?.querySelector('span[style*="font-weight:700"]'), red: !!p?.querySelector('span[style*="color:#FF0000"]'), li: p?.querySelectorAll('.li').length, tbl: p?.querySelectorAll('.docx-tbl td').length, a: p?.querySelector('a')?.href, tr: /Şğüçöı/.test(p?.textContent || ''), num: /2\./.test(p?.querySelectorAll('.li')[1]?.textContent || '') }; });
  ok('zip › docx', r.h1 && r.bold && r.red && r.li === 2 && r.tbl === 4 && /isu\.gov\.tr/.test(r.a || '') && r.tr && r.num, JSON.stringify(r));
}
await shot('doc_docx');
await ev(() => window.dwgApp.onBack());
await page.click('#docContent .arc-item[data-entry="pafta/"]'); await page.waitForTimeout(150);
await page.click('#docContent .arc-item[data-entry="pafta/plan.dxf"]');
await page.waitForFunction(() => window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 60000 }); await page.waitForTimeout(400);
ok('zip › dxf çizim olarak', await ev(() => document.getElementById('docView').hidden && window.dwgApp.state.fileName === 'plan.dxf' && window.dwgApp.state.entityCount > 0));
ok('arşive dön toast', await ev(() => !document.getElementById('toast').hidden && /Arşive dön/.test(document.querySelector('#toast .act').textContent)));
await page.click('#toast .act'); await page.waitForTimeout(300);
ok('arşive dönüldü', await ev(() => !document.getElementById('docView').hidden && !!document.querySelector('#docContent .arc-item')));
await ev(() => window.dwgApp.docs.close());
// ---- XLSX ----
await page.setInputFiles('#fileInput', path.join(out, 'metraj.xlsx')); await page.waitForTimeout(500);
ok('xlsx', await ev(() => { const t = document.querySelector('#docContent .xlsx-tbl'); return !!t && /Ø300 boru/.test(t.textContent) && /1\.250,5/.test(t.textContent) && !!document.querySelector('#docTools [data-sheet="0"]'); }), await ev(() => (document.querySelector('#docContent')?.textContent || '').slice(0, 80)));
await shot('doc_xlsx');
await ev(() => window.dwgApp.docs.close());
// ---- PDF (tarayıcı embed) ----
await page.setInputFiles('#fileInput', path.join(out, 'test.pdf')); await page.waitForTimeout(400);
ok('pdf embed', await ev(() => !!document.querySelector('#docContent embed.doc-embed')));
ok('kapat', await ev(() => window.dwgApp.onBack() === true && document.getElementById('docView').hidden));

// ---- Android köprüsü taklidi: Drive paneli + PDF sayfaları + arşiv (yerel) ----
await ev(() => {
  const files = { f_1: { name: 'plan.pdf', size: 1234, ext: 'pdf' } };
  window.__calls = [];
  window.Android = {
    gConfigured: () => true, gAccount: () => window.__acc || '', gSignIn: () => { setTimeout(() => { window.__acc = JSON.stringify({ name: 'Mahmut T.', email: 'test@example.com' }); window.dwgApp.onGoogle(true, { name: 'Mahmut T.', email: 'test@example.com' }); }, 50); return ''; }, gSignOut: () => { window.__acc = ''; },
    gDrive: (id, op, args) => { window.__calls.push([op, JSON.parse(args)]); setTimeout(() => {
      if (op === 'list') { const a = JSON.parse(args); window.dwgApp.onDrive(id, true, a.folder === 'klas1' ? { files: [{ id: 'pdf1', name: 'plan.pdf', mimeType: 'application/pdf', size: '1234', modifiedTime: '2026-09-01T10:00:00Z' }] } : { files: [{ id: 'klas1', name: 'Projeler', mimeType: 'application/vnd.google-apps.folder' }, { id: 'dwg1', name: 'hat.dwg', mimeType: 'application/acad', size: '5000', modifiedTime: '2026-09-02T10:00:00Z', webViewLink: 'https://drive.google.com/x' }], nextPageToken: a.pageToken ? '' : 'p2' }); }
      else if (op === 'download') window.dwgApp.onDrive(id, true, { id: 'f_1', name: 'plan.pdf', size: 1234, ext: 'pdf' });
      else if (op === 'upload') window.dwgApp.onDrive(id, true, { id: 'up1', name: JSON.parse(args).name, webViewLink: 'https://drive.google.com/up1' });
      else window.dwgApp.onDrive(id, true, {});
    }, 30); },
    docOpen: (w) => JSON.stringify(files.f_1 ? { id: 'f_1', ...files.f_1 } : {}), docOpenAsCurrent: () => {}, pdfInfo: (id) => JSON.stringify({ pages: 3, sizes: [[595, 842], [595, 842], [842, 595]] }), pdfClose: () => {},
    arcList: () => '[]', arcExtract: () => '{}', docShare: () => {}, docKeep: () => 'dl_x', openUrl: (u) => { window.__url = u; }, saveFile: () => 'İndirilenler/x', savePng: () => 'Resimler/x', pickFile: () => {},
    loadText: (k) => localStorage.getItem(k) || '', saveText: (k, v) => localStorage.setItem(k, v),
  };
});
await page.click('#btnMore'); await page.click('#moreMenu [data-act="drive"]'); await page.waitForTimeout(200);
ok('drive giriş ekranı', await ev(() => !document.getElementById('drivePanel').hidden && !!document.querySelector('#driveList [data-drive="signin"]')));
await page.click('#driveList [data-drive="signin"]'); await page.waitForTimeout(400);
ok('drive liste', await ev(() => document.querySelectorAll('#driveList .drive-item').length === 2 && /Mahmut/.test(document.getElementById('driveAccount').textContent)));
await shot('drive_list');
await page.click('#driveList [data-drive="more"]'); await page.waitForTimeout(200);
ok('daha fazla', await ev(() => document.querySelectorAll('#driveList .drive-item').length === 4 && !document.querySelector('#driveList [data-drive="more"]')));
await page.click('#driveList .drive-item[data-id="klas1"]'); await page.waitForTimeout(300);
ok('klasöre gir', await ev(() => document.querySelectorAll('#driveCrumbs .doc-crumbs .chip').length === 2 && document.querySelectorAll('#driveList .drive-item').length === 1));
await page.click('#driveList .drive-item[data-id="pdf1"]'); await page.waitForTimeout(500);
{
  const r = await ev(() => ({ open: !document.getElementById('docView').hidden, pages: document.querySelectorAll('#docContent .pdf-page').length, img: document.querySelector('#docContent .pdf-page img')?.getAttribute('src'), panel: document.getElementById('drivePanel').hidden }));
  ok('drive › pdf (PdfRenderer yolu)', r.open && r.pages === 3 && /^\/file\/pdfpage_f_1_0_\d+$/.test(r.img || '') && r.panel, JSON.stringify(r));
}
await shot('doc_pdf_android');
await page.click('#docTools [data-doc="zin"]'); await page.waitForTimeout(150);
ok('pdf zoom', await ev(() => window.dwgApp.docs.current().zoom > 1 && /_\d+$/.test(document.querySelector('#docContent .pdf-page img')?.getAttribute('src') || '')));
await page.fill('#pdfPageIn', '3'); await page.press('#pdfPageIn', 'Enter'); await page.dispatchEvent('#pdfPageIn', 'change'); await page.waitForTimeout(200);
ok('pdf sayfaya git', await ev(() => document.getElementById('docContent').scrollTop > 100));
await ev(() => window.dwgApp.docs.close());
// yükleme akışı (PNG → Drive)
await ev(() => window.dwgApp.savePng()); await page.waitForTimeout(200);
ok('png toast drive eylemi', await ev(() => !document.getElementById('toast').hidden && /Drive/.test(document.querySelector('#toast .act').textContent)));
await page.click('#toast .act'); await page.waitForTimeout(300);
ok('klasör seçici', await ev(() => !document.getElementById('drivePanel').hidden && !!document.querySelector('#driveList [data-drive="pickhere"]')));
await page.click('#driveList [data-drive="pickhere"]'); await page.waitForTimeout(300);
ok('yükleme çağrısı', await ev(() => { const c = window.__calls.find(x => x[0] === 'upload'); return !!c && /\.png$/.test(c[1].name) && c[1].folder === 'klas1' && /yüklendi/i.test(document.querySelector('#toast .tx').textContent); }), await ev(() => JSON.stringify(window.__calls.map(c => c[0]))));
await shot('drive_uploaded');

// ---- 3B: stiller, en-boy, hareket seçenekleri ----
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(600);
{
  const r = await ev(() => { const v = window.dwgApp.editor.view3d(); const cv = v.cv; const dpr = Math.min(3, window.devicePixelRatio || 1); return { w: cv.width, h: cv.height, cw: Math.round(cv.clientWidth * dpr), ch: Math.round(cv.clientHeight * dpr), persp: v.cam.persp, hud: v.hudText() }; });
  ok('3B tuval boyutu = CSS×dpr, paralel varsayılan', r.w === r.cw && r.h === r.ch && r.persp === false && /Paralel/.test(r.hud), JSON.stringify(r));
  // dış boyut değişince tuval kendini düzeltir
  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(400);
  await ev(() => window.dwgApp.editor.render3D());
  const r2 = await ev(() => { const v = window.dwgApp.editor.view3d(); const cv = v.cv; const dpr = Math.min(3, window.devicePixelRatio || 1); return { w: cv.width, h: cv.height, cw: Math.round(cv.clientWidth * dpr), ch: Math.round(cv.clientHeight * dpr) }; });
  ok('yatayda tuval düzeltildi', r2.w === r2.cw && r2.h === r2.ch && r2.w > r2.h, JSON.stringify(r2));
  await page.setViewportSize({ width: 412, height: 915 }); await page.waitForTimeout(400);
  const styles = await ev(() => { const v = window.dwgApp.editor.view3d(); const res = {}; for (const s of ['wireframe2d', 'wireframe', 'hidden', 'shaded', 'shadedEdges', 'realistic', 'conceptual', 'gray', 'sketchy', 'xray']) { v.set('style', s); v.render(); res[s] = v.gl.getError(); } v.set('shadow', true); v.set('silhouette', true); v.set('overhang', 3); v.set('jitter', 2); v.set('lightQuality', 'smooth'); v.set('specular', true); v.set('faceOpacity', 0.6); v.render(); res.extra = v.gl.getError(); v.set('shadow', false); v.set('silhouette', false); v.set('overhang', 0); v.set('jitter', 0); v.set('faceOpacity', 1); v.set('style', 'realistic'); v.render(); return res; });
  ok('3B stiller hatasız', Object.values(styles).every(e => e === 0), JSON.stringify(styles));
  await shot('3d_realistic');
  await ev(() => { const v = window.dwgApp.editor.view3d(); v.set('touch.twoFinger', 'zoomrotate'); v.set('touch.threeFinger', 'orbit'); v.set('touch.doubleTap', 'zoom'); }); await page.waitForTimeout(450);
  ok('dokunma seçenekleri', await ev(() => { const v = window.dwgApp.editor.view3d(); const t = v.opts.touch; const st = JSON.parse(localStorage.getItem('view3d') || '{}'); return t.twoFinger === 'zoomrotate' && t.threeFinger === 'orbit' && t.doubleTap === 'zoom' && st.touch.twoFinger === 'zoomrotate' && st.persp === false; }));
  // iki parmak twist → yaw değişir
  const yaw0 = await ev(() => window.dwgApp.editor.view3d().cam.yaw);
  const vb = await page.locator('#viewport').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const cx = vb.x + 200, cy = vb.y + 400;
  await tp('touchStart', [{ x: cx - 60, y: cy }, { x: cx + 60, y: cy }]); await page.waitForTimeout(40);
  for (let i = 1; i <= 8; i++) { const a = i * 0.08; await tp('touchMove', [{ x: cx - 60 * Math.cos(a), y: cy - 60 * Math.sin(a) }, { x: cx + 60 * Math.cos(a), y: cy + 60 * Math.sin(a) }]); await page.waitForTimeout(16); }
  await tp('touchEnd', []); await page.waitForTimeout(200);
  const yaw1 = await ev(() => window.dwgApp.editor.view3d().cam.yaw);
  ok('iki parmak döndürme', Math.abs(yaw1 - yaw0) > 0.3, (yaw1 - yaw0).toFixed(3));
  // 3B seçenek paneli yeni bölümler
  await ev(() => window.dwgApp.openDisplayOptions({ seg: '3d' })); await page.waitForTimeout(300);
  ok('3B panel bölümleri', await ev(() => ['style', 'face', 'edge', 'env', 'camera'].every(id => !!document.querySelector(`#displayBody [data-sec="${id}"]`)) && !!document.querySelector('#displayBody .seg[data-key="touch.threeFinger"]') && !!document.querySelector('#displayBody .seg[data-key="style"] [data-val="conceptual"]')));
  await shot('3d_panel_styles');
  await ev(() => window.dwgApp.onBack()); await ev(() => window.dwgApp.onBack());
  await cdp.detach();
}
// ---- 3DSOLID (ACIS) yüzeyleri + görsel stil düğmesi ----
{
  await page.setInputFiles('#fileInput', path.join(SM, 'example_2000.dwg'));
  await page.waitForFunction(() => window.dwgApp.state.hasDoc && window.dwgApp.state.fileName === 'example_2000.dwg' && document.getElementById('loading').hidden, null, { timeout: 120000 }); await page.waitForTimeout(400);
  const r = await ev(() => { const ps = window.dwgApp.state.scene.layouts[0].prims; return { solids: window.dwgApp.state.counts['3DSOLID'], tri: ps.filter(p => p.tri).length, edges: ps.filter(p => !p.tri && p.et === '3DSOLID').length, drawn2d: ps.filter(p => p.tri && window.dwgApp.display.primVisible(p)).length }; });
  ok('3DSOLID + 2 REGION + çok yüzlü ağ üçgenlendi (SAT)', r.solids === 1 && r.tri === 30 && r.edges >= 12 && r.drawn2d === 0, JSON.stringify(r));
  await ev(() => window.dwgApp.editor.openTab('3d')); await page.click('#toolbar .tb-row[data-for="3d"] [data-act="3d"]'); await page.waitForTimeout(600);
  const c = await ev(() => { const v = window.dwgApp.editor.view3d(); return { tris: v.counts.tris, hud: v.hudText() }; });
  ok('3B yüzey sayısı', c.tris >= 213 && !/Yüzey yok/.test(c.hud), JSON.stringify(c));
  ok('görsel stil karosu', await ev(() => { const b = document.querySelector('#toolbar .tb-row[data-for="3d"] [data-act="vstyle"]'); return !!b && /#i-vs-/.test(b.querySelector('use').getAttribute('href')); }));
  await page.click('#toolbar .tb-row[data-for="3d"] [data-act="vstyle"]'); await page.waitForTimeout(250);
  ok('görsel stil kutusu', await ev(() => document.querySelectorAll('#tbPop .vs-grid [data-vs]').length === 10));
  await shot('vstyle_pop');
  await page.click('#tbPop [data-vs="conceptual"]'); await page.waitForTimeout(200);
  ok('kavramsal stil seçildi', await ev(() => window.dwgApp.editor.view3d().opts.style === 'conceptual' && document.querySelector('#toolbar .tb-row[data-for="3d"] [data-act="vstyle"] use').getAttribute('href') === '#i-vs-conceptual'));
  await ev(() => { const ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.tri); const v = window.dwgApp.editor.view3d(); v.fitSelection(new Set(ps), { animate: false }); v.preset('isoNE', { animate: false }); window.dwgApp.editor.render3D(); });
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(100);
  await shot('solid_conceptual');
  await ev(() => window.dwgApp.onBack());
}
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
