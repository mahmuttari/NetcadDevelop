// Seçim tutamağı (gizmo) ve bilgi panelinin kısa / ayrıntılı görünümü.
//  1) Tutamak yalnız doğru koşullarda çizilir (2B, seçim var, araç çalışmıyor, ayar açık).
//  2) Köşe → oranlı ölçek, kenar → tek eksende uzat/kısalt, orta → taşı, ip ucu → döndür.
//  3) Sürükleme sırasında BELGE DEĞİŞMEZ; bırakışta tek 'xform' komutu → tek geri alma.
//  4) Bilgi paneli: kısa görünüm öntanımlı, "Ayrıntılar" çipi açar/kapar ve seçim saklanır;
//     "Dokununca bilgi panelini aç" kapalıyken düz dokunuş paneli açmaz ama nesneyi seçer.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_gizmo.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import path from 'node:path';

const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];

const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, path.join(SM, 'example_2018.dwg'), { settle: 600 });

const vpRect = await ev(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return { x: r.left, y: r.top }; });
/** Tuval koordinatını sayfa koordinatına çevirir */
const pg = (p) => [vpRect.x + p[0], vpRect.y + p[1]];

/** Seçimi belirli bir ilkele kurar (en geniş kutulu yol: tutamaklar rahat ayrışsın) */
const selectBig = () => ev(() => {
  const S = window.dwgApp.state;
  let best = null, area = -1;
  for (const p of S.prims) {
    if (p.k !== 0 || !p.bb) continue;
    const a = (p.bb[2] - p.bb[0]) * (p.bb[3] - p.bb[1]);
    if (a > area) { area = a; best = p; }
  }
  if (!best) return null;
  window.dwgApp.editor.select(best);
  // Nesneye yakınlaş: kutu ekranın ORTASINDA ve tamamen İÇİNDE kalsın, yoksa köşe tutamakları
  // görünüm alanının dışına düşer ve sentetik fare onlara inemez.
  const b = best.bb, mx = (b[2] - b[0]) || 1, my = (b[3] - b[1]) || 1;
  window.dwgApp.zoomExtents([b[0] - mx, b[1] - my, b[2] + mx, b[3] + my]);
  return { key: best.key, bb: best.bb.slice() };
});
/** Tutamakların ekran yerleşimi (uygulamanın kullandığı modülün aynısıyla hesaplanır) */
const layout = () => ev(async () => {
  const Gz = await import('./gizmo.js'), St = await import('./state.js'), E = await import('./editor.js');
  const bb = Gz.boxOf(window.dwgApp.editor.selection());
  if (!bb) return null;
  const L = Gz.layout(bb, St.toScreen, { fs: E.ui.fontScale, glove: E.ui.glove });
  return { pts: L.pts, box: L.box, tiny: L.tiny, hitR: L.hitR };
});
const bbOf = (key) => ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); return p ? p.bb.slice() : null; }, key);
const undoLen = () => ev(() => { const d = window.dwgApp.editor.doc; return d ? d.log.length : -1; });   // günlük: geri alma yığını 10 adımla sınırlı (v7.55), sayım günlükten
/** Tutamağı sürükler: basar, iki adımda taşır, bırakır */
async function drag(from, to) {
  const a = pg(from), b = pg(to);
  await page.mouse.move(a[0], a[1]);
  await page.mouse.down();
  await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 });
  await page.mouse.move(b[0], b[1], { steps: 4 });
  await page.waitForTimeout(60);
  const mid = await ev(() => ({ busy: window.dwgApp.editor.gizmoBusy() }));
  await page.mouse.up();
  await page.waitForTimeout(120);
  return mid;
}

// ---------------------------------------------------------------------------------
// 1) Görünürlük koşulları
// ---------------------------------------------------------------------------------
ok('1a seçim yokken tutamak yok', (await layout()) === null);
const sel = await selectBig();
await page.waitForTimeout(200);
ok('1b en geniş yol seçildi', !!sel && !!sel.key, JSON.stringify(sel && sel.bb));
let L = await layout();
ok('1c seçim yapılınca tutamak yerleşimi kurulur: 4 köşe + 4 kenar + taşı + döndür',
  !!L && ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w', 'move', 'rot'].every(k => Array.isArray(L.pts[k])), JSON.stringify(L && Object.keys(L.pts)));
ok('1d döndürme tutamağı kutunun SAĞINDA ve dışında', L.pts.rot[0] > L.box[2], `${Math.round(L.pts.rot[0])} > ${Math.round(L.box[2])}`);
{
  const vpSize = await ev(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return [r.width, r.height]; });
  const inside = (p) => p[0] > 2 && p[1] > 2 && p[0] < vpSize[0] - 2 && p[1] < vpSize[1] - 2;
  ok('1f bütün tutamaklar görünüm alanının içinde (sınanabilirlik koşulu)',
    Object.values(L.pts).every(inside), JSON.stringify({ vp: vpSize, box: L.box.map(Math.round), rot: L.pts.rot.map(Math.round) }));
}
ok('1e taşıma tutamağı kutunun merkezinde', Math.abs(L.pts.move[0] - (L.box[0] + L.box[2]) / 2) < 0.6 && Math.abs(L.pts.move[1] - (L.box[1] + L.box[3]) / 2) < 0.6);
await page.screenshot({ path: `${out}/gizmo_secim.png` });

// ---------------------------------------------------------------------------------
// 2) Taşıma
// ---------------------------------------------------------------------------------
{
  const b0 = await bbOf(sel.key), u0 = await undoLen();
  const st = await drag(L.pts.move, [L.pts.move[0] + 60, L.pts.move[1] - 40]);
  const b1 = await bbOf(sel.key), u1 = await undoLen();
  const sc = await ev(() => window.dwgApp.state.view.scale);
  const dx = (b1[0] - b0[0]) * sc, dy = (b1[1] - b0[1]) * sc;
  ok('2a sürükleme sırasında tutamak etkin (belge henüz değişmedi)', st.busy === true);
  ok('2b taşıma: nesne parmakla aynı yönde ve aynı kadar gitti (+60 px sağ, +40 px yukarı)',
    Math.abs(dx - 60) < 3 && Math.abs(dy - 40) < 3, `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
  ok('2c tek geri alma adımı eklendi', u1 === u0 + 1, `${u0} → ${u1}`);
  await ev(() => window.dwgApp.editor.doc.undo());
  await page.waitForTimeout(80);
  const b2 = await bbOf(sel.key);
  ok('2d geri al: kutu birebir eski yerine döndü', Math.abs(b2[0] - b0[0]) < 1e-6 && Math.abs(b2[1] - b0[1]) < 1e-6);
}

// ---------------------------------------------------------------------------------
// 3) Köşeden oranlı ölçek
// ---------------------------------------------------------------------------------
{
  L = await layout();
  const b0 = await bbOf(sel.key);
  const w0 = b0[2] - b0[0], h0 = b0[3] - b0[1];
  // sağ üst köşeyi köşegen boyunca dışarı çek: sabit nokta sol alt (sw)
  const anchor = L.pts.sw, g = L.pts.ne;
  const to = [anchor[0] + (g[0] - anchor[0]) * 1.5, anchor[1] + (g[1] - anchor[1]) * 1.5];
  await drag(g, to);
  const b1 = await bbOf(sel.key);
  const w1 = b1[2] - b1[0], h1 = b1[3] - b1[1];
  ok('3a köşe: her iki eksende AYNI oranda büyüdü (oran korunur)',
    Math.abs(w1 / w0 - h1 / h0) < 0.02 && w1 / w0 > 1.3, `w×${(w1 / w0).toFixed(3)} h×${(h1 / h0).toFixed(3)}`);
  ok('3b karşı köşe (sol alt) sabit kaldı', Math.abs(b1[0] - b0[0]) < 1e-6 && Math.abs(b1[1] - b0[1]) < 1e-6,
    `${b0[0].toFixed(4)},${b0[1].toFixed(4)} → ${b1[0].toFixed(4)},${b1[1].toFixed(4)}`);
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(80);
}

// ---------------------------------------------------------------------------------
// 4) Kenardan tek eksende uzat / kısalt
// ---------------------------------------------------------------------------------
{
  L = await layout();
  const b0 = await bbOf(sel.key);
  const w0 = b0[2] - b0[0], h0 = b0[3] - b0[1];
  ok('4a kutu kenar tutamaklarını gösterecek kadar büyük', L.tiny === false);
  await drag(L.pts.e, [L.pts.e[0] + (L.box[2] - L.box[0]) * 0.5, L.pts.e[1]]);
  const b1 = await bbOf(sel.key);
  const w1 = b1[2] - b1[0], h1 = b1[3] - b1[1];
  ok('4b sağ kenar: YALNIZ X ekseninde uzadı, Y değişmedi',
    w1 / w0 > 1.3 && Math.abs(h1 / h0 - 1) < 0.01, `w×${(w1 / w0).toFixed(3)} h×${(h1 / h0).toFixed(3)}`);
  ok('4c sol kenar sabit kaldı', Math.abs(b1[0] - b0[0]) < 1e-6);
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(80);
}

// ---------------------------------------------------------------------------------
// 5) Döndürme (15° kilidi)
// ---------------------------------------------------------------------------------
{
  L = await layout();
  const b0 = await bbOf(sel.key);
  const cx = (L.box[0] + L.box[2]) / 2, cy = (L.box[1] + L.box[3]) / 2;
  const r = L.pts.rot[0] - cx;
  // 90°'ye sürükle: ekran y aşağı olduğu için tepe noktası dünyada +90°'dir
  await drag(L.pts.rot, [cx, cy - r]);
  const b1 = await bbOf(sel.key);
  const w0 = b0[2] - b0[0], h0 = b0[3] - b0[1], w1 = b1[2] - b1[0], h1 = b1[3] - b1[1];
  ok('5a döndürme: 90°\'de kutunun eni ile boyu yer değiştirdi (15° kilidi tuttu)',
    Math.abs(w1 - h0) / Math.max(1e-9, h0) < 0.02 && Math.abs(h1 - w0) / Math.max(1e-9, w0) < 0.02,
    `${w0.toFixed(2)}×${h0.toFixed(2)} → ${w1.toFixed(2)}×${h1.toFixed(2)}`);
  await page.screenshot({ path: `${out}/gizmo_dondur.png` });
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(80);
}

// ---------------------------------------------------------------------------------
// 6) Kutunun dışına dokunmak tutamağı çalıştırmaz (kaydırma bozulmasın)
// ---------------------------------------------------------------------------------
{
  L = await layout();
  const u0 = await undoLen();
  const far = [Math.max(6, L.box[0] - 120), Math.max(6, L.box[1] - 120)];
  const a = pg(far);
  await page.mouse.move(a[0], a[1]); await page.mouse.down();
  await page.mouse.move(a[0] + 50, a[1] + 50, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(120);
  ok('6 kutunun uzağından sürükleme dönüşüm YAPMAZ (görünüm kaydırılır)', (await undoLen()) === u0);
}

// ---------------------------------------------------------------------------------
// 7) Ayar: tutamak kapatılabilir
// ---------------------------------------------------------------------------------
{
  await ev(async () => { const E = await import('./editor.js'); E.ui.gizmo = false; E.applyUi(); });
  await page.waitForTimeout(100);
  const u0 = await undoLen();
  const p0 = L.pts.move;
  await drag(p0, [p0[0] + 60, p0[1]]);
  ok('7a ui.gizmo=false → tutamak yok, sürükleme dönüşüm yapmaz', (await undoLen()) === u0);
  await ev(async () => { const E = await import('./editor.js'); E.ui.gizmo = true; E.applyUi(); });
  await page.waitForTimeout(100);
  ok('7b geri açılınca tutamak döner', (await layout()) !== null);
}

// ---------------------------------------------------------------------------------
// 8) Bilgi paneli: kısa / ayrıntılı
// ---------------------------------------------------------------------------------
{
  const info = () => ev(() => {
    const el = document.getElementById('infoPanel');
    const d = document.getElementById('iaDetail');
    return { open: !el.hidden, rows: el.querySelectorAll('#infoBody .k').length, chip: d ? { hidden: d.hidden, txt: d.textContent.trim(), on: d.classList.contains('on') } : null,
      keys: [...el.querySelectorAll('#infoBody .k')].map(x => x.textContent) };
  });
  await ev(() => { const S = window.dwgApp.state; const p = S.prims.find(x => x.k === 0 && x.et === 'LINE') || S.prims[0]; window.dwgApp.showInfo(p); });
  await page.waitForTimeout(120);
  const short = await info();
  ok('8a panel KISA açılır ve "Ayrıntılar (n)" çipi görünür',
    short.open && short.chip && !short.chip.hidden && /Ayrıntılar/.test(short.chip.txt) && !short.chip.on && short.rows > 0, JSON.stringify(short.chip) + ' satır=' + short.rows);
  ok('8b kısa görünümde ikincil satırlar yok (Tanıtıcı, Çizgi tipi)',
    !short.keys.some(k => /Tanıtıcı|Çizgi tipi/.test(k)), short.keys.join(' · '));
  await page.screenshot({ path: `${out}/info_kisa.png` });
  await page.click('#iaDetail'); await page.waitForTimeout(150);
  const full = await info();
  ok('8c çip ayrıntılıya geçirir: satır sayısı artar, Tanıtıcı gelir, etiket "Daha az" olur',
    full.rows > short.rows && full.keys.some(k => /Tanıtıcı/.test(k)) && /Daha az/.test(full.chip.txt) && full.chip.on, `${short.rows} → ${full.rows}`);
  await page.screenshot({ path: `${out}/info_ayrintili.png` });
  ok('8d seçim saklanır (ui.infoFull)', await ev(async () => { const E = await import('./editor.js'); return E.ui.infoFull === true && JSON.parse(localStorage.getItem('ui')).infoFull === true; }));
  await ev(() => { const S = window.dwgApp.state; window.dwgApp.showInfo(S.prims[1] || S.prims[0]); });
  await page.waitForTimeout(120);
  ok('8e başka nesnede de ayrıntılı kalır', (await info()).chip.on === true);
  await page.click('#iaDetail'); await page.waitForTimeout(150);
  ok('8f geri kısa', (await info()).chip.on === false);
}

// ---------------------------------------------------------------------------------
// 9) Ayar: dokununca panel açılmasın
// ---------------------------------------------------------------------------------
{
  await ev(() => { const el = document.getElementById('infoPanel'); el.hidden = true; });
  // SEÇİM TEMİZLENİR: aksi hâlde dokunulacak nokta kendi sınır kutusunun köşe tutamağına denk
  // gelir, jesti tutamak yutar ve "panel açılmadı" yanlış sebeple doğru görünür.
  await ev(() => window.dwgApp.editor.select(null));
  await ev(async () => { const E = await import('./editor.js'); E.ui.infoTap = false; E.applyUi(); });
  const hitPt = await ev(async () => {
    const St = await import('./state.js');
    const p = window.dwgApp.state.prims.find(x => x.k === 0 && x.ops && x.ops.length > 1);
    if (!p) return null;
    const o = p.ops[1];                       // ilk köşe değil: köşe tutamağı bölgesinden uzak dur
    const s = St.toScreen(o[1], o[2]);
    const r = document.getElementById('viewport').getBoundingClientRect();
    return (s[0] > 10 && s[1] > 10 && s[0] < r.width - 10 && s[1] < r.height - 10) ? s : null;
  });
  if (hitPt) {
    const a = pg(hitPt);
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(250);
    const got = await ev(() => ({ hidden: document.getElementById('infoPanel').hidden, sel: !!window.dwgApp.state.selected }));
    ok('9a infoTap=false → düz dokunuş paneli AÇMAZ ama nesneyi yine vurgular', got.hidden === true && got.sel === true, JSON.stringify(got));
    await ev(async () => { const E = await import('./editor.js'); E.ui.infoTap = true; E.applyUi(); });
    await page.waitForTimeout(600);   // çift dokunuş penceresi (TOL.dbl) kapansın
    await page.mouse.move(a[0], a[1]); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(300);
    ok('9b infoTap=true → açar', await ev(() => document.getElementById('infoPanel').hidden === false));
  } else ok('9 dokunulacak nokta bulunamadı', false);
}

ok('10 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
