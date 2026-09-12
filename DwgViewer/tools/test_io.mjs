// Dosya girişi sınaması: BOM'lu / DOS857 DXF, DOS857 DWG, kesik ve bozuk DWG (LibreDWG hata kodu), DXF çizgi kalınlığı ve
// katman gerçek rengi, DXF MESH / ACDSDATA / ACAD_TABLE / MULTILEADER / TOLERANCE / desenli HATCH, R2004 MULTILEADER metni,
// yükleme iptali ve ikinci dosya, büyük XLSX sayfalama, OEM adlı ZIP girdisi.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_io.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, projectRoot } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
const { out, samples: SM } = args(import.meta.url);
const VIEWER = path.join(projectRoot, 'app/src/main/assets/viewer');
const { CP857 } = await import(path.join(VIEWER, 'codepage.js'));
const C = checker(), ok = C.ok;
const L = (c, v) => `${c}\n${v}\n`;

// ---- fixture üretimi ----
const dwg2000 = fs.readFileSync(path.join(SM, 'example_2000.dwg'));
fs.writeFileSync(path.join(out, 'trunc60_2000.dwg'), dwg2000.subarray(0, Math.floor(dwg2000.length * 0.6)));
{ const b = Buffer.from(dwg2000); b.fill(0, Math.floor(b.length * 0.3), Math.floor(b.length * 0.3) + 65536); /* nesne bölgesi: %30'dan itibaren 64 KB */ fs.writeFileSync(path.join(out, 'corrupt_2000.dwg'), b); }
const trTxt = new TextDecoder('windows-1254').decode(fs.readFileSync(path.join(SM, 'test_tr.dxf')));
fs.writeFileSync(path.join(out, 'bom_tr.dxf'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(trTxt, 'utf8')]));
{ const inv = new Map(); CP857.forEach((cp, i) => { if (cp !== 0xFFFD) inv.set(cp, 128 + i); });
  const b = Buffer.from([...trTxt.replace('ANSI_1254', 'DOS857')].map(ch => { const c = ch.charCodeAt(0); return c < 128 ? c : (inv.get(c) ?? 63); }));
  fs.writeFileSync(path.join(out, 'dos857_tr.dxf'), b); }
// sentetik DXF: katman 420 / 370, LINE 370, MESH (küp), desenli HATCH, ACAD_TABLE (+*T bloğu), MULTILEADER (AutoCAD biçimi), TOLERANCE
function synDxf(extra = '') {
  let s = L(0, 'SECTION') + L(2, 'HEADER') + L(9, '$ACADVER') + L(1, 'AC1027') + L(9, '$INSUNITS') + L(70, 6) + L(0, 'ENDSEC');
  s += L(0, 'SECTION') + L(2, 'TABLES') + L(0, 'TABLE') + L(2, 'LAYER') + L(0, 'LAYER') + L(5, 'L0') + L(2, '0') + L(70, 0) + L(62, 7) + L(6, 'Continuous')
    + L(0, 'LAYER') + L(5, 'L1') + L(2, 'INCE') + L(70, 0) + L(62, 3) + L(420, 0x1234AB) + L(370, 13) + L(6, 'Continuous') + L(0, 'ENDTAB')
    + L(0, 'TABLE') + L(2, 'BLOCK_RECORD') + L(0, 'BLOCK_RECORD') + L(5, 'B1') + L(2, '*T1') + L(0, 'ENDTAB') + L(0, 'ENDSEC');
  s += L(0, 'SECTION') + L(2, 'BLOCKS') + L(0, 'BLOCK') + L(5, 'B2') + L(2, '*T1') + L(70, 1) + L(10, 0) + L(20, 0) + L(30, 0)
    + L(0, 'LINE') + L(5, 'B3') + L(8, '0') + L(10, 0) + L(20, 0) + L(30, 0) + L(11, 5) + L(21, 0) + L(31, 0)
    + L(0, 'LINE') + L(5, 'B4') + L(8, '0') + L(10, 0) + L(20, 0) + L(30, 0) + L(11, 0) + L(21, -2) + L(31, 0) + L(0, 'ENDBLK') + L(0, 'ENDSEC');
  s += L(0, 'SECTION') + L(2, 'ENTITIES');
  s += L(0, 'LINE') + L(5, 'E1') + L(8, 'INCE') + L(370, 13) + L(10, 0) + L(20, 0) + L(30, 0) + L(11, 10) + L(21, 0) + L(31, 0);
  s += L(0, 'LINE') + L(5, 'E2') + L(8, '0') + L(370, 50) + L(10, 0) + L(20, 1) + L(30, 0) + L(11, 10) + L(21, 1) + L(31, 0);
  const cube = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  s += L(0, 'MESH') + L(5, 'M1') + L(8, '0') + L(100, 'AcDbSubDMesh') + L(71, 2) + L(72, 0) + L(91, 0) + L(92, 8);
  for (const p of cube) s += L(10, p[0] + 20) + L(20, p[1]) + L(30, p[2]);
  s += L(93, faces.length * 5); for (const f of faces) { s += L(90, 4); for (const i of f) s += L(90, i); }
  s += L(94, 2) + L(90, 0) + L(90, 1) + L(95, 0);
  s += L(0, 'HATCH') + L(5, 'H1') + L(8, '0') + L(100, 'AcDbHatch') + L(10, 0) + L(20, 0) + L(30, 0) + L(210, 0) + L(220, 0) + L(230, 1) + L(2, 'ANSI31') + L(70, 0) + L(71, 0) + L(91, 1)
    + L(92, 2) + L(72, 0) + L(73, 1) + L(93, 4) + L(10, 30) + L(20, 0) + L(10, 40) + L(20, 0) + L(10, 40) + L(20, 10) + L(10, 30) + L(20, 10) + L(97, 0)
    + L(75, 0) + L(76, 1) + L(52, 0) + L(41, 1) + L(77, 0) + L(78, 1) + L(53, 45) + L(43, 0) + L(44, 0) + L(45, -0.7071) + L(46, 0.7071) + L(79, 0) + L(47, 1) + L(98, 0);
  s += L(0, 'ACAD_TABLE') + L(5, 'T1') + L(8, '0') + L(100, 'AcDbBlockReference') + L(2, '*T1') + L(10, 100) + L(20, 200) + L(30, 0) + L(100, 'AcDbTable') + L(280, 0) + L(340, 'B1') + L(11, 1) + L(21, 0) + L(31, 0) + L(91, 2) + L(92, 2);
  s += L(0, 'MULTILEADER') + L(5, 'ML1') + L(8, '0') + L(100, 'AcDbMLeader') + L(270, 2) + L(300, 'CONTEXT_DATA{') + L(40, 1) + L(10, 50) + L(20, 60) + L(30, 0) + L(41, 2.5) + L(140, 3) + L(145, 1)
    + L(290, 1) + L(304, 'Merhaba') + L(11, 0) + L(21, 0) + L(31, 1) + L(12, 55) + L(22, 66) + L(32, 0) + L(42, 0)
    + L(302, 'LEADER{') + L(290, 1) + L(291, 1) + L(10, 40) + L(20, 60) + L(30, 0) + L(11, 1) + L(21, 0) + L(31, 0) + L(90, 0) + L(40, 2)
    + L(304, 'LEADER_LINE{') + L(10, 10) + L(20, 10) + L(30, 0) + L(10, 30) + L(20, 50) + L(30, 0) + L(91, 0) + L(305, '}') + L(303, '}') + L(301, '}') + L(41, 2) + L(42, 4);
  s += L(0, 'TOLERANCE') + L(5, 'TL1') + L(8, '0') + L(100, 'AcDbFcf') + L(3, 'ISO-25') + L(10, 70) + L(20, 70) + L(30, 0) + L(11, 1) + L(21, 0) + L(31, 0) + L(1, '{\\Fgdt;j}%%v0.1%%vA');
  s += extra + L(0, 'ENDSEC') + L(0, 'EOF');
  return s;
}
fs.writeFileSync(path.join(out, 'syn.dxf'), synDxf());
// ZIP yazıcı (store + deflate)
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files) {
  const parts = [], cds = []; let off = 0;
  for (const [nameBuf, data, flags] of files) {
    const nb = Buffer.isBuffer(nameBuf) ? nameBuf : Buffer.from(nameBuf, 'utf8'), raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const comp = zlib.deflateRawSync(raw); const useDef = comp.length < raw.length; const body = useDef ? comp : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(useDef ? 8 : 0, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    parts.push(lh, nb, body);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(useDef ? 8 : 0, 10); cd.writeUInt32LE(crc32(raw), 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nb.length, 28); cd.writeUInt32LE(off, 42);
    cds.push(cd, nb);
    off += lh.length + nb.length + body.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
{ // OEM (CP857) adlı girdi: 'Şehir_ç.txt' → 9E 65 68 69 72 5F 87 ...
  const inv = new Map(); CP857.forEach((cp, i) => inv.set(cp, 128 + i));
  const nm = Buffer.from([...'Şehir_ç.txt'].map(ch => { const c = ch.charCodeAt(0); return c < 128 ? c : inv.get(c); }));
  fs.writeFileSync(path.join(out, 'cp857name.zip'), makeZip([[nm, 'merhaba', 0]]));
}
{ // 60k satırlık XLSX
  const N = 60000; let rows = '';
  for (let r = 1; r <= N; r++) { rows += `<row r="${r}">`; for (let c = 0; c < 8; c++) rows += `<c r="${String.fromCharCode(65 + c)}${r}"><v>${r * 8 + c}</v></c>`; rows += '</row>'; }
  const xlsx = makeZip([['xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Koordinat" sheetId="1" r:id="rId1"/></sheets></workbook>`, 0x800],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`, 0x800],
    ['xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`, 0x800]]);
  fs.writeFileSync(path.join(out, 'big60k.xlsx'), xlsx);
}
{ // büyük DXF (iptal / ikinci dosya sınaması): 250k çizgi
  let s = L(0, 'SECTION') + L(2, 'HEADER') + L(9, '$ACADVER') + L(1, 'AC1015') + L(0, 'ENDSEC') + L(0, 'SECTION') + L(2, 'ENTITIES');
  const chunks = [s]; for (let i = 0; i < 250000; i++) chunks.push(`0\nLINE\n8\n0\n10\n${i % 500}\n20\n${Math.floor(i / 500)}\n30\n0\n11\n${i % 500 + 0.5}\n21\n${Math.floor(i / 500) + 0.5}\n31\n0\n`);
  chunks.push(L(0, 'ENDSEC') + L(0, 'EOF')); fs.writeFileSync(path.join(out, 'big250k.dxf'), chunks.join(''));
}
// dwg2dxf (LibreDWG) varsa dönüştürülmüş DXF
const BIN = process.env.LIBREDWG_BIN || '/home/user/libredwg/libredwg/programs';
let convDxf = null;
if (fs.existsSync(path.join(BIN, 'dwg2dxf'))) { const o = path.join(out, 'conv_2000.dxf'); const r = spawnSync(path.join(BIN, 'dwg2dxf'), ['-y', '-o', o, path.join(SM, 'example_2000.dwg')], { encoding: 'utf8' }); if (fs.existsSync(o) && fs.statSync(o).size > 1000) convDxf = o; else console.log('[dwg2dxf]', (r.stderr || '').slice(0, 200)); }

// ---- tarayıcı ----
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/bozuk ya da kesik|çözemedi|Hata:/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
const dialogs = [];
onDialog(page, async d => { dialogs.push(d.message().slice(0, 80)); await d.accept(); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
await ev(() => { try { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); } catch (_) { /* geç */ } });
await page.reload(); await page.waitForSelector('#btnOpen2');
await ev(() => {
  window.__toasts = [];
  const t = document.getElementById('toast');
  new MutationObserver(() => { if (!t.hidden) { const tx = (t.querySelector('.tx') || t).textContent; if (!window.__toasts.length || window.__toasts[window.__toasts.length - 1] !== tx) window.__toasts.push(tx); } }).observe(t, { attributes: true, childList: true, subtree: true, characterData: true });
});
const resetToasts = () => ev(() => { window.__toasts = []; document.getElementById('toast').hidden = true; });
const toasts = () => ev(() => window.__toasts.slice());
const S = () => ev(() => { const S = window.dwgApp.state; return { hasDoc: S.hasDoc, name: S.fileName, ver: S.version, ents: S.entityCount, prims: S.prims.length, layers: [...S.layers.values()].map(l => ({ name: l.name, lw: l.lw, color: l.color })), texts: S.prims.filter(p => p.k === 1).map(p => p.lines.join(' ')), types: S.counts }; });
/** hata beklenen açma: 'Hata' toast'ı ya da belge gelene kadar bekler */
async function openExpectError(file) {
  await resetToasts();
  const prev = await ev(() => window.dwgApp.state.fileKey || '');
  await page.setInputFiles('#fileInput', file);
  await page.waitForFunction((prev) => { const a = window.dwgApp; return document.getElementById('loading').hidden && (window.__toasts.some(x => /^Hata/.test(x)) || (a.state.hasDoc && a.state.fileKey !== prev)); }, prev, { timeout: 120000 });
  await page.waitForTimeout(300);
  return (await toasts()).find(x => /^Hata/.test(x)) || '';
}

// (1) BOM'lu DXF
await openFile(page, path.join(out, 'bom_tr.dxf'), { settle: 200 });
{ const s = await S(); ok('1 BOM\'lu DXF açılır, Türkçe yazı doğru', s.hasDoc && s.ents === 11 && s.texts.some(t => /İçme suyu hattı/.test(t)), JSON.stringify({ ents: s.ents, t: s.texts.slice(0, 2) })); }
// (2) DOS857 DXF
await openFile(page, path.join(out, 'dos857_tr.dxf'), { settle: 200 });
{ const s = await S(); ok('2 DOS857 kod sayfalı DXF: Türkçe yazı doğru (İçme suyu hattı Ø200)', s.hasDoc && s.texts.some(t => /İçme suyu hattı Ø200/.test(t)), JSON.stringify(s.texts.slice(0, 2))); }
// (3) DOS857 DWG (başlık kod sayfası 15)
if (fs.existsSync(path.join(SM, 'dos857_2000.dwg'))) {
  await openFile(page, path.join(SM, 'dos857_2000.dwg'), { settle: 200 });
  const s = await S(); ok('3 DOS857 (kod sayfası 15) DWG: Türkçe yazı doğru', s.hasDoc && s.texts.some(t => /İçme suyu hattı/.test(t)), JSON.stringify(s.texts.slice(0, 2)));
} else C.skip('3 dos857_2000.dwg', 'örnek yok');
// (4) kesik / bozuk DWG
let healthyPrims = 0;
{
  const m = await openExpectError(path.join(out, 'trunc60_2000.dwg'));
  ok('4a %60\'ta kesilmiş DWG: anlamlı hata (bozuk ya da kesik / hata kodu)', /bozuk ya da kesik|hata kodu/.test(m), m.slice(0, 120));
  const hdr = path.join(out, 'header_only.dwg'); fs.writeFileSync(hdr, dwg2000.subarray(0, 200));
  const m2 = await openExpectError(hdr);
  ok('4b 200 baytlık DWG: hata', /^Hata/.test(m2), m2.slice(0, 120));
  await resetToasts();
  await openFile(page, path.join(out, 'corrupt_2000.dwg'), { settle: 1800 });
  const s = await S(), ts = await toasts();
  ok('4c ortası bozuk DWG: açılır ama uyarı toast\'ı (eksik/bozuk okunmuş olabilir)', s.hasDoc && ts.some(x => /eksik\/bozuk okunmuş olabilir/.test(x)), JSON.stringify({ prims: s.prims, ts }));
  await resetToasts();
  await openFile(page, path.join(SM, 'example_2000.dwg'), { settle: 300 });
  const s2 = await S(), ts2 = await toasts();
  healthyPrims = s2.prims;
  ok('4d sağlam DWG sonrasında açılır (bozuktan fazla ilkel), uyarı yok', s2.prims > s.prims && s2.prims >= 330 && !ts2.some(x => /eksik\/bozuk/.test(x)), JSON.stringify({ prims: s2.prims, corrupt: s.prims, ts: ts2 }));
}
// (5) sentetik DXF: kalınlık, 420, MESH, HATCH deseni, ACAD_TABLE, MULTILEADER, TOLERANCE
await openFile(page, path.join(out, 'syn.dxf'), { settle: 300 });
{
  const r = await ev(() => { const S = window.dwgApp.state; const ps = S.prims; const by = (et) => ps.filter(p => p.et === et); const lw = (p) => p.lw; return { layers: [...S.layers.values()].map(l => [l.name, l.lw, l.color]), e1: ps.find(p => p.info && p.info.h === 'E1'), e2lw: ps.filter(p => p.info && p.info.h === 'E2').map(lw), tri: ps.filter(p => p.tri).length, types: S.counts, hatch: by('HATCH').length, hatchOps: by('HATCH').reduce((n, p) => n + (p.ops ? p.ops.length : 0), 0), ins: ps.filter(p => p.et === 'LINE' && p.info && p.info.h === 'T1').length, insBb: ps.filter(p => p.et === 'LINE' && p.info && p.info.h === 'T1').map(p => p.bb), ml: by('MULTILEADER').length, mlText: by('MULTILEADER').filter(p => p.k === 1).map(p => p.lines.join(' ')), tol: by('TOLERANCE').map(p => p.lines && p.lines.join(' ')) }; });
  const inc = r.layers.find(l => l[0] === 'INCE');
  ok('5a katman INCE: 370=13 → 13 (0,13 mm), 420 gerçek renk 0x1234AB', inc && inc[1] === 13 && inc[2] === 0x1234AB, JSON.stringify(inc));
  ok('5b LINE 370=50 → lw 50 (kod 11); 370=13 → 13', r.e2lw[0] === 50 && r.e1 && r.e1.lw === 13, JSON.stringify({ e2: r.e2lw, e1: r.e1 && r.e1.lw }));
  ok('5c DXF MESH (küp) üçgenlendi (12 üçgen)', r.tri === 12, String(r.tri));
  ok('5d desenli HATCH çizgi parçalarına açıldı (ANSI31)', r.hatch >= 1 && r.hatchOps > 10, JSON.stringify({ h: r.hatch, ops: r.hatchOps }));
  ok('5e ACAD_TABLE *T bloğu ekleme noktasında (100,200) çizildi', r.ins === 2 && r.insBb.every(bb => bb[0] >= 99 && bb[2] <= 106 && bb[1] >= 197 && bb[3] <= 201), JSON.stringify(r.insBb));
  ok('5f MULTILEADER: kılavuz çizgisi + yazı "Merhaba"', r.ml >= 2 && r.mlText.includes('Merhaba'), JSON.stringify({ ml: r.ml, t: r.mlText }));
  ok('5g TOLERANCE yazısı', r.tol.length === 1 && /0\.1/.test(r.tol[0]), JSON.stringify(r.tol));
}
// (6) ACDSDATA: 2018 DWG'nin SAB verisi DXF ACDSDATA bölümüne konur, üçgen sayısı DWG ile aynı olmalı
{
  await openFile(page, path.join(SM, 'example_2018.dwg'), { settle: 300 });
  const d = await ev(() => { const S = window.dwgApp.state; const d = S.scene.solidDiag; const smp = (d && d.samples || []).find(s => s.b64 && s.acisType === 'SAB' && s.acisBytes <= 49152); return smp ? { b64: smp.b64, handle: smp.handle, tri: S.prims.filter(p => p.tri && p.info && p.info.h === smp.handle).length } : null; });
  if (!d) C.skip('6 ACDSDATA', 'örnek SAB verisi alınamadı');
  else {
    const hex = Buffer.from(d.b64, 'base64').toString('hex').toUpperCase();
    let acds = L(0, 'SECTION') + L(2, 'ACDSDATA') + L(70, 2) + L(71, 6) + L(0, 'ACDSSCHEMA') + L(90, 0) + L(1, 'AcDb3DSolid_ASM_Data') + L(0, 'ACDSRECORD') + L(90, 1) + L(2, 'AcDbDs::ID') + L(280, 10) + L(320, 'S1') + L(2, 'ASM_Data') + L(280, 15) + L(94, hex.length / 2);
    for (let i = 0; i < hex.length; i += 254) acds += L(310, hex.slice(i, i + 254));
    acds += L(0, 'ENDSEC');
    const body = L(0, '3DSOLID') + L(5, 'S1') + L(8, '0') + L(100, 'AcDbModelerGeometry') + L(290, 0) + L(2, '{00000000-0000-0000-0000-000000000000}');
    const dxf = synDxf(body).replace(L(0, 'EOF'), acds + L(0, 'EOF'));
    fs.writeFileSync(path.join(out, 'acds.dxf'), dxf);
    await openFile(page, path.join(out, 'acds.dxf'), { settle: 300 });
    const r = await ev(() => { const S = window.dwgApp.state; return { tri: S.prims.filter(p => p.tri && p.info && p.info.h === 'S1').length, diag: S.scene.solidDiag && S.scene.solidDiag.errors.slice(0, 2) }; });
    ok(`6 AC1027 DXF 3DSOLID + ACDSDATA: üçgen sayısı DWG ile aynı (${d.tri})`, r.tri > 0 && r.tri === d.tri, JSON.stringify(r));
  }
}
// (7) dwg2dxf çıktısı: MULTILEADER (proxy grafiği) ve TOLERANCE çizilir, ilkel sayısı DWG'ye yakın
if (convDxf) {
  await openFile(page, convDxf, { settle: 300 });
  const r = await ev(() => { const S = window.dwgApp.state; const ps = S.prims; return { prims: ps.length, ml: ps.filter(p => p.et === 'MULTILEADER').length, tol: ps.filter(p => p.et === 'TOLERANCE').length }; });
  ok('7a dwg2dxf DXF: MULTILEADER ilkel > 0 (92/310 proxy grafiği), TOLERANCE > 0', r.ml > 0 && r.tol > 0, JSON.stringify(r));
  ok('7b dwg2dxf DXF ilkel sayısı DWG\'ye yakın (tablo dönüştürücüde düşer: 31 çizgi + 7 yazı)', r.prims >= healthyPrims - 40, r.prims + ' / ' + healthyPrims);
} else C.skip('7 dwg2dxf', 'LibreDWG dwg2dxf yok');
// (8) R2004 MULTILEADER metni
if (fs.existsSync(path.join(SM, 'Leader_2004.dwg'))) {
  await openFile(page, path.join(SM, 'Leader_2004.dwg'), { settle: 300 });
  const r = await ev(() => window.dwgApp.state.prims.filter(p => p.et === 'MULTILEADER' && p.k === 1).map(p => p.lines.join(' ')));
  ok('8 R2004 MULTILEADER yazısı "LEADER" (UTF-16 karışıklığı onarıldı)', r.some(t => /LEADER/.test(t)) && !r.some(t => /[ -￿]/.test(t)), JSON.stringify(r));
} else C.skip('8 Leader_2004.dwg', 'örnek yok');
// (9) yükleme iptali ve ikinci dosya
{
  await resetToasts();
  await page.setInputFiles('#fileInput', path.join(out, 'big250k.dxf'));
  await page.waitForFunction(() => !document.getElementById('loading').hidden, null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.click('#loadingCancel');
  await page.waitForTimeout(300);
  const st = await ev(() => ({ loading: document.getElementById('loading').hidden, name: window.dwgApp.state.fileName }));
  ok('9a Vazgeç: yükleme modalı kapanır, büyük dosya gelmez', st.loading && st.name !== 'big250k.dxf', JSON.stringify(st));
  await openFile(page, path.join(SM, 'example_2004.dwg'), { settle: 200 });
  ok('9b iptalden sonra işçi yeniden kuruldu: example_2004.dwg açılır', (await S()).name === 'example_2004.dwg');
  await resetToasts();
  await page.setInputFiles('#fileInput', path.join(out, 'big250k.dxf'));
  await page.waitForTimeout(600);
  await page.setInputFiles('#fileInput', path.join(SM, 'example_2000.dwg'));
  await page.waitForFunction(() => window.dwgApp.state.fileName === 'example_2000.dwg' && document.getElementById('loading').hidden, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  const ts = await toasts();
  ok('9c yüklenirken ikinci dosya: ilki iptal, yalnız ikincisi gelir', !ts.some(x => /big250k/.test(x)) && ts.some(x => /example_2000\.dwg/.test(x)) && (await S()).prims === healthyPrims, JSON.stringify(ts));
}
// (10) XLSX sayfalama
{
  const t0 = Date.now();
  await page.setInputFiles('#fileInput', path.join(out, 'big60k.xlsx'));
  await page.waitForFunction(() => !!document.querySelector('#docContent .xlsx-tbl'), null, { timeout: 60000 });
  const ms = Date.now() - t0;
  const r = await ev(() => ({ rows: document.querySelectorAll('#docContent .xlsx-tbl tr').length, more: !!document.querySelector('#docContent [data-more]'), note: (document.querySelector('#docContent .muted') || {}).textContent }));
  ok('10a 60k satırlık XLSX: ilk 1000 satır + "Daha fazla", 10 sn altında', r.rows === 1001 && r.more && ms < 10000, JSON.stringify({ ...r, ms }));
  await page.click('#docContent [data-more]'); await page.waitForTimeout(300);
  const r2 = await ev(() => document.querySelectorAll('#docContent .xlsx-tbl tr').length);
  ok('10b Daha fazla → 2000 satır', r2 === 2001, String(r2));
  await ev(() => window.dwgApp.docs.close());
}
// (11) OEM adlı ZIP girdisi
{
  await page.setInputFiles('#fileInput', path.join(out, 'cp857name.zip')); await page.waitForTimeout(600);
  const names = await ev(() => [...document.querySelectorAll('#docContent .arc-item')].map(e => e.dataset.entry));
  ok('11 ZIP girdi adı CP857 ile çözülür (Şehir_ç.txt)', names.includes('Şehir_ç.txt'), JSON.stringify(names));
  await ev(() => window.dwgApp.docs.close());
}
ok('12 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
