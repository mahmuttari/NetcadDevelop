// Çekirdek sınama: DWG sürümleri (R14–2018), Türkçe DXF, ikili DXF reddi, sayfa düzenleri, arama, PDF çıktısı, notlar.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_core.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error' && !/İkili \(binary\) DXF/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });  // (c) adımında fail() beklenen hatayı console.error ile de basar
onDialog(page, async d => { await d.accept('5'); });
const ev = (fn, a) => page.evaluate(fn, a);
const fresh = async () => { await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2'); await ev(() => { try { localStorage.clear(); } catch (_) { /* geç */ } }); };
const quiet = () => ev(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });
const info = () => ev(() => { const S = window.dwgApp.state; return { ver: S.version, raw: S.scene.version, ents: S.entityCount, prims: S.prims.length, layouts: S.scene.layouts.length }; });
await fresh();

// ---- (a) DWG sürümleri ----
const VERSIONS = [['example_r14.dwg', 'AC1014', 'R14'], ['example_2000.dwg', 'AC1015', 'AutoCAD 2000'], ['example_2004.dwg', 'AC1018', 'AutoCAD 2004'], ['example_2007.dwg', 'AC1021', 'AutoCAD 2007'], ['example_2010.dwg', 'AC1024', 'AutoCAD 2010'], ['example_2013.dwg', 'AC1027', 'AutoCAD 2013'], ['example_2018.dwg', 'AC1032', 'AutoCAD 2018']];
for (const [f, raw, label] of VERSIONS) {
  const fp = path.join(SM, f);
  if (!fs.existsSync(fp)) { C.skip('a ' + f, 'örnek yok'); continue; }
  try { await openFile(page, fp, { timeout: 180000 }); } catch (e) { ok('a ' + f + ' açıldı', false, e.message.slice(0, 100)); continue; }
  await quiet();
  const i = await info();
  ok(`a ${f}: ${raw} → "${label}", varlık > 0`, i.raw === raw && i.ver === label && i.ents > 0 && i.prims > 0, JSON.stringify(i));
}

// ---- (b) Türkçe DXF ----
{
  await openFile(page, path.join(SM, 'test_tr.dxf')); await quiet();
  const r = await ev(() => { const S = window.dwgApp.state; const texts = S.prims.filter(p => p.k === 1).map(p => p.lines.join(' ')); return { ver: S.version, texts, tr: texts.filter(t => /[ğüşıöçĞÜŞİÖÇ]/.test(t)) }; });
  ok('b test_tr.dxf: DXF AutoCAD 2000, kod sayfası çözülmüş Türkçe TEXT', r.ver === 'DXF AutoCAD 2000' && r.tr.length >= 1, JSON.stringify(r.tr.slice(0, 3)) + ' / ' + r.texts.length + ' yazı');
}

// ---- (c) ikili DXF reddi ----
{
  const bin = path.join(out, 'ikili.dxf');
  fs.writeFileSync(bin, Buffer.concat([Buffer.from('AutoCAD Binary DXF\r\n\x1a\x00', 'latin1'), Buffer.alloc(64)]));
  await fresh();
  await page.setInputFiles('#fileInput', bin);
  let msg = '';
  try { await page.waitForFunction(() => /İkili/.test(document.getElementById('toast').textContent), null, { timeout: 30000 }); msg = await ev(() => document.getElementById('toast').textContent); } catch (_) { msg = await ev(() => document.getElementById('toast').textContent); }
  const st = await ev(() => ({ hasDoc: window.dwgApp.state.hasDoc, loading: document.getElementById('loading').hidden }));
  ok('c ikili DXF: anlaşılır hata ("İkili (binary) DXF desteklenmiyor"), belge açılmadı', /İkili \(binary\) DXF desteklenmiyor/.test(msg) && !st.hasDoc && st.loading, msg.slice(0, 100) + ' ' + JSON.stringify(st));
}

// ---- (d) sayfa düzenleri ----
{
  await fresh();
  await openFile(page, path.join(SM, 'example_2000.dwg')); await quiet();
  const r = await ev(() => { const S = window.dwgApp.state; const L = S.scene.layouts; const n0 = S.prims.length, i0 = S.layoutIndex; const tabs = document.getElementById('layoutTabs'); const tabN = tabs.querySelectorAll('button').length; window.dwgApp.setLayout(1); const n1 = S.prims.length, i1 = S.layoutIndex, same = S.prims === L[0].prims; window.dwgApp.setLayout(0); return { count: L.length, names: L.map(l => l.name), n0, n1, i0, i1, same, tabsHidden: tabs.hidden, tabN, back: S.layoutIndex === 0 && S.prims === L[0].prims }; });
  ok('d1 example_2000.dwg: birden çok sayfa düzeni, sekmeler görünür', r.count > 1 && !r.tabsHidden && r.tabN === r.count, JSON.stringify({ count: r.count, names: r.names, tabN: r.tabN }));
  ok('d2 düzen değişince ilkel listesi değişir', r.i0 === 0 && r.i1 === 1 && !r.same && r.n1 !== r.n0 && r.back, `model ${r.n0} → düzen 1: ${r.n1}`);
}

// ---- (e) arama ----
{
  const r = await ev(() => {
    const S = window.dwgApp.state;
    const p = S.prims.find(q => q.k === 1 && q.lines.join(' ').trim().length >= 3 && S.layers.get(q.lay) && S.layers.get(q.lay).visible);
    if (!p) return null;
    const word = p.lines.join(' ').trim().split(/\s+/)[0];
    document.getElementById('btnSearch').click();
    const inp = document.getElementById('searchInput'); inp.value = word; inp.dispatchEvent(new Event('input'));
    const items = [...document.querySelectorAll('#searchBody .item')].map(el => el.textContent);
    return { word, n: items.length, first: items[0] || '', panel: !document.getElementById('searchPanel').hidden };
  });
  ok('e arama: bir yazı için sonuç ≥ 1', r && r.n >= 1 && r.panel && r.first.toLowerCase().includes(r.word.toLowerCase()), JSON.stringify(r));
  await ev(() => { const b = document.querySelector('#searchBody .item'); if (b) b.click(); });
  ok('e2 sonuç seçilince nesne seçili ve bilgi paneli açık', await ev(() => !!window.dwgApp.state.selected && !document.getElementById('infoPanel').hidden));
  await ev(() => window.dwgApp.onBack()); await ev(() => window.dwgApp.onBack());
}

// ---- (f) PDF ----
{
  await quiet();
  const dlP = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#btnMore'); await page.click('[data-act="pdf"]'); await page.click('#pGo');
  const dl = await dlP; const pdfPath = path.join(out, 'core.pdf'); await dl.saveAs(pdfPath);
  const buf = fs.readFileSync(pdfPath), txt = buf.toString('latin1');
  ok('f1 PDF "%PDF-" ile başlar, "/Type /Page" içerir', buf.subarray(0, 5).toString('latin1') === '%PDF-' && /\/Type \/Page\b/.test(txt), buf.length + ' bayt, ' + dl.suggestedFilename());
  ok('f2 PDF varsayılan A3 yatay (MediaBox 1190.55×841.89 pt), %%EOF', /\/MediaBox \[0 0 1190\.55 841\.89\]/.test(txt) && txt.includes('%%EOF'));
  await ev(() => window.dwgApp.onBack());
}

// ---- (g) notlar ----
{
  const r = await ev(async () => {
    const m = await import('./notes.js'); const S = window.dwgApp.state;
    const before = m.notes.items.length;
    const n = m.addNote({ type: 'text', pts: [[100, 100]], color: '#ff0000', text: 'sınama notu' });
    const after = m.notes.items.length;
    const key = 'notes:' + S.fileKey;
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    const hit = stored.find(x => x.id === n.id);
    m.loadNotes(S.fileKey); const reloaded = m.notes.items.some(x => x.id === n.id && x.text === 'sınama notu');
    m.removeNote(n.id);
    const gone = !JSON.parse(localStorage.getItem(key) || '[]').some(x => x.id === n.id);
    return { same: window.dwgApp.notes === m.notes, keyOk: m.notes.key === S.fileKey, before, after, stored: !!hit && hit.text === 'sınama notu' && hit.type === 'text', reloaded, gone };
  });
  ok('g1 not ekle → store\'da (notes:<dosya>) kayıt var, yeniden yüklenince gelir', r.same && r.keyOk && r.after === r.before + 1 && r.stored && r.reloaded, JSON.stringify(r));
  ok('g2 not sil → kayıt kalkar', r.gone);
}

ok('h sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
