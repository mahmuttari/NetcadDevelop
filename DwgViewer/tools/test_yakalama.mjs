/*
 * NESNE YAKALAMA (OSNAP) — AutoCAD'in 14 çalışan kipi, bir kerelik geçersiz kılmalar (M2P, FROM,
 * TK, NON ve kip adları), yakalama izi (F11), ayar kutusu, ölçü panelindeki çip şeridi, -OSNAP
 * komut satırı ve nokta istemine yazılan kip adları.
 *
 * A) geom.snapPoint saf geometriyle (sentetik ilkeller): her kipin doğru noktayı bulması, öncelik,
 *    int / app ayrımı (kot), saat yönlü yayın orta noktası, elips çeyrekleri, paralel için geniş küme.
 * B) Arayüz: ayar kutusu kartları, tümü / temizle / varsayılan, ana anahtar, çip şeridi, F3 / F11,
 *    -OSNAP, nokta istemine yazılan M2P / FROM / TK / NON, durum çubuğunda uzun basış, dokunuş
 *    sonrası işaret, glif SVG'si, İngilizce arayüz.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_yakalama.mjs
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, samplesDir } from './harness.mjs';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message.slice(0, 200)); });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const J = JSON.stringify;

// ---------------------------------------------------------------------------------
// A) Geometri: sentetik ilkeller, saf snapPoint
// ---------------------------------------------------------------------------------
{
  const r = await ev(async () => {
    const G = await import('./geom.js');
    const TAU = Math.PI * 2;
    const path = (ops, closed = false) => ({ k: 0, ops, closed });
    const L1 = path([[0, 0, 0, 0], [1, 100, 0, 0]]);                 // yatay, z = 0
    const L2 = path([[0, 30, -50, 0], [1, 30, 50, 0]]);              // düşey, L1'i (30,0)'da keser
    const L3 = path([[0, 50, -10, 100], [1, 50, 10, 100]]);          // z = 100: L1 ile yalnız GÖRÜNÜR kesişim
    const CIR = path([[0, 250, 0], [2, 200, 0, 50, 0, TAU]]);        // merkez (200,0) r 50
    const ARC = path([[0, 50, 100], [-2, 0, 100, 50, 0, -Math.PI / 2]]);   // saat yönlü: 0° → −90° (merkez 0,100)
    const RECT = path([[0, 300, 0, 0], [1, 400, 0, 0], [1, 400, 60, 0], [1, 300, 60, 0]], true);
    const PT = { k: 2, x: 500, y: 0, z: 7 };
    const TXT = { k: 1, x: 600, y: 0 };
    const ELL = path([[0, 760, 0], [3, 700, 0, 60, 30, 0, 0, TAU]]);
    const all = [L1, L2, L3, CIR, ARC, RECT, PT, TXT, ELL];
    const S = (w, modes, prev, opt, list) => { const s = G.snapPoint(list || all, w, 6, new Set(modes), prev || null, opt || {}); return s ? { x: +s.p[0].toFixed(4), y: +s.p[1].toFixed(4), z: s.p[2], k: s.kind } : null; };
    return {
      modes: G.SNAP_MODES,
      end: S([101, 2], ['end']), mid: S([49, 2], ['mid']), int: S([31, 1], ['int']), cen: S([199, 3], ['cen']),
      qua: S([250, 2], ['qua']), quaTop: S([201, 48], ['qua']), gcen: S([349, 31], ['gcen']), node: S([501, 1], ['node']), ins: S([601, -2], ['ins']),
      per: S([50, 1], ['per'], [50, 40]), perNoPrev: S([50, 1], ['per']), tan: S([243, 24], ['tan'], [200, 100]),
      nea: S([70, 3], ['nea']), ext: S([130, 1], ['ext'], null, null, [L1]), extIn: S([70, 1], ['ext'], null, null, [L1]),   // yalnız L1: dikdörtgenin alt kenarının uzantısı da (70,0)'dan geçer
      intZ: S([50, 0.5], ['int']), appZ: S([50, 0.5], ['app']),
      par: S([60, 101], ['par'], [0, 100], { wide: [L1] }), parNoRef: S([60, 101], ['par'], [0, 100], { wide: [] }),
      arcMid: S([36, 65], ['mid']), arcEnd: S([49, 99], ['end']), arcQua: S([1, 51], ['qua']),
      ellQua: S([759, 1], ['qua']), ellQuaTop: S([701, 29], ['qua']), ellCen: S([699, 1], ['cen']),
      pri: S([100, 0], ['end', 'nea']), priMid: S([30, 1], ['mid', 'int']),   // L2'nin ortası ve L1 ile kesişimi aynı nokta (30,0): kesişim öncelikli
      none: S([1000, 1000], G.SNAP_MODES), empty: S([100, 0], []),
      cwArcNea: S([35, 64], ['nea']),
    };
  });
  const p = (o, x, y, k) => !!o && near(o.x, x, 1e-3) && near(o.y, y, 1e-3) && o.k === k;
  ok('A1 tablo 14 kip', r.modes.length === 14 && r.modes.join(',') === 'end,node,int,app,cen,ins,gcen,qua,mid,tan,per,ext,par,nea', r.modes.join(','));
  ok('A2 END uç (100,0)', p(r.end, 100, 0, 'end'), J(r.end));
  ok('A3 MID orta (50,0)', p(r.mid, 50, 0, 'mid'), J(r.mid));
  ok('A4 INT kesişim (30,0)', p(r.int, 30, 0, 'int'), J(r.int));
  ok('A5 CEN merkez (200,0)', p(r.cen, 200, 0, 'cen'), J(r.cen));
  ok('A6 QUA çeyrek (250,0) ve (200,50)', p(r.qua, 250, 0, 'qua') && p(r.quaTop, 200, 50, 'qua'), J([r.qua, r.quaTop]));
  ok('A7 GCE geometrik merkez (350,30)', p(r.gcen, 350, 30, 'gcen'), J(r.gcen));
  ok('A8 NOD düğüm (500,0) kotuyla', p(r.node, 500, 0, 'node') && r.node.z === 7, J(r.node));
  ok('A9 INS yazı ekleme noktası (600,0)', p(r.ins, 600, 0, 'ins'), J(r.ins));
  ok('A10 PER dik ayak (50,0); önceki nokta yoksa dik yok', p(r.per, 50, 0, 'per') && r.perNoPrev === null, J([r.per, r.perNoPrev]));
  ok('A11 TAN teğet noktası (243.30,25) — (200,100)\'den çembere', p(r.tan, 200 + 50 * Math.cos(Math.PI / 6), 25, 'tan'), J(r.tan));
  ok('A12 NEA en yakın (70,0)', p(r.nea, 70, 0, 'nea'), J(r.nea));
  ok('A13 EXT uzantı (130,0); parçanın içinde uzantı sayılmaz', p(r.ext, 130, 0, 'ext') && r.extIn === null, J([r.ext, r.extIn]));
  ok('A14 INT farklı kottaki parçayı kesişim saymaz, APP sayar (50,0)', r.intZ === null && p(r.appZ, 50, 0, 'app'), J([r.intZ, r.appZ]));
  ok('A15 PAR paralel (60,100): referans doğru geniş kümeden, yoksa yok', p(r.par, 60, 100, 'par') && r.parNoRef === null, J([r.par, r.parNoRef]));
  ok('A16 saat yönlü yay: orta nokta −45°\'te (35.36,64.64), uç ve çeyrek doğru', p(r.arcMid, 50 * Math.cos(-Math.PI / 4), 100 + 50 * Math.sin(-Math.PI / 4), 'mid') && p(r.arcEnd, 50, 100, 'end') && p(r.arcQua, 0, 50, 'qua'), J([r.arcMid, r.arcEnd, r.arcQua]));
  ok('A17 elips: çeyrekler (760,0) (700,30) ve merkez', p(r.ellQua, 760, 0, 'qua') && p(r.ellQuaTop, 700, 30, 'qua') && p(r.ellCen, 700, 0, 'cen'), J([r.ellQua, r.ellQuaTop, r.ellCen]));
  ok('A18 öncelik: uç en yakını yener; kesişim ortayı yener', r.pri.k === 'end' && r.priMid.k === 'int', J([r.pri, r.priMid]));
  ok('A19 uzakta hiçbir şey yok → null; kip yok → null', r.none === null && r.empty === null);
  ok('A20 saat yönlü yayda NEA yayın kendi aralığında', !!r.cwArcNea && r.cwArcNea.k === 'nea' && near(Math.hypot(r.cwArcNea.x, r.cwArcNea.y - 100), 50, 1e-3), J(r.cwArcNea));
}

// ---------------------------------------------------------------------------------
// B) Arayüz
// ---------------------------------------------------------------------------------
await openFile(page, `${samplesDir}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const bekle = (ms = 160) => page.waitForTimeout(ms);
const klik = async (sel) => { const r = await ev((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel); await bekle(); return r; };
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const modes = () => ev(() => [...window.dwgApp.state.snapModes].sort().join(','));
const doc = () => ev(() => ({ acik: !document.getElementById('docPanel').hidden, baslik: document.getElementById('docTitle').textContent }));
const bar = () => ev(() => ({ text: document.getElementById('cmdText').textContent.trim(), ph: document.getElementById('cmdInput').placeholder, seq: !!window.dwgApp.editor.cmdSeqActive() }));
const yaz = async (v) => { await page.fill('#cmdInput', v); await bekle(100); };
const gir = async () => { await page.click('#cmdEnter'); await bekle(220); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(150); };
const tapWorld = async (x, y) => { const s = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(380); };   // 380 ms: art arda yakın iki dokunuş çift dokunuş (320 ms) sayılmasın
const pts = () => ev(() => window.dwgApp.editor.tools.pts.map(p => p.slice(0, 2).map(v => +v.toFixed(3))));
const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dwgApp.osnap.renderBar(document.getElementById('snapBar')); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);

{
  ok('B1 varsayılan kipler END MID CEN INT INS NOD', (await modes()) === 'cen,end,ins,int,mid,node', await modes());
  await ev(() => window.dwgApp.editor.act('osnapset')); await bekle(200);
  const d = await doc();
  const kart = await ev(() => ({ n: document.querySelectorAll('#osGrid .os-card').length, once: document.querySelectorAll('#osOnce .os-card').length, on: [...document.querySelectorAll('#osGrid .os-card.on')].map(b => b.dataset.os).sort().join(','), svg: document.querySelectorAll('#osGrid .os-card svg').length, adlar: [...document.querySelectorAll('#osGrid .os-card span')].map(s => s.textContent).slice(0, 4).join('|'), master: document.querySelector('input[data-key="osMaster"]').checked, ap: (document.querySelector('.seg[data-key="osAperture"] button.on') || {}).dataset }));
  ok('B2 ayar kutusu "Nesne yakalama": 14 kip kartı + 18 bir kerelik kart, her kartta glif', d.acik && d.baslik === 'Nesne yakalama' && kart.n === 14 && kart.once === 18 && kart.svg === 14, J({ d, kart }));
  ok('B3 açık kipler kartta vurgulu, ana anahtar açık, açıklık Orta', kart.on === 'cen,end,ins,int,mid,node' && kart.master === true && kart.ap && kart.ap.val === '18', J(kart));
  ok('B4 kart adları Türkçe (Uç nokta | Orta nokta | Merkez | Geometrik merkez)', kart.adlar === 'Uç nokta|Orta nokta|Merkez|Geometrik merkez', kart.adlar);
  await shot('osnap_kutu');
  await klik('#osGrid [data-os="qua"]');
  ok('B5 karta dokunmak kipi açar (QUA)', (await modes()).includes('qua') && (await ev(() => document.querySelector('#osGrid [data-os="qua"]').classList.contains('on'))));
  await klik('#osGrid [data-os="qua"]');
  ok('B6 yeniden dokunmak kapatır', !(await modes()).includes('qua'));
  await klik('[data-os-all]');
  ok('B7 Tümünü seç → 14 kip', (await ev(() => window.dwgApp.state.snapModes.size)) === 14);
  await klik('[data-os-clear]');
  ok('B8 Tümünü temizle → 0 ve ana anahtar kapanır', (await ev(() => window.dwgApp.state.snapModes.size)) === 0 && (await ev(() => document.querySelector('input[data-key="osMaster"]').checked)) === false);
  await klik('[data-os-default]');
  ok('B9 Varsayılan → 6 kip', (await modes()) === 'cen,end,ins,int,mid,node');
  await ev(() => { const i = document.querySelector('input[data-key="osMaster"]'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); }); await bekle();
  ok('B10 ana anahtar kapatınca kipler boşalır (F3 ile aynı)', (await ev(() => window.dwgApp.state.snapModes.size)) === 0);
  await ev(() => { const i = document.querySelector('input[data-key="osMaster"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }); await bekle();
  ok('B11 yeniden açınca liste geri gelir', (await modes()) === 'cen,end,ins,int,mid,node', await modes());
  await ev(() => { document.querySelector('.seg[data-key="osAperture"] [data-val="26"]').click(); }); await bekle();
  await ev(() => { const i = document.querySelector('input[data-key="osIgnoreHatch"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }); await bekle();
  const kayit = await ev(() => JSON.parse(localStorage.getItem('settings')).snapOpt);
  ok('B12 açıklık Büyük (26 px) ve "taramaları yoksay" ayarlara yazıldı', kayit && kayit.aperture === 26 && kayit.ignoreHatch === true, J(kayit));
  await ev(() => { document.querySelector('.seg[data-key="osAperture"] [data-val="18"]').click(); const i = document.querySelector('input[data-key="osIgnoreHatch"]'); i.checked = false; i.dispatchEvent(new Event('change', { bubbles: true })); }); await bekle();
  await ev(() => window.dwgApp.onBack()); await bekle();
}
{
  // ölçü panelindeki çip şeridi
  await ev(() => window.dwgApp.setMode('measure')); await bekle(200);
  const c = await ev(() => ({ n: document.querySelectorAll('#snapBar .os-chip').length, gear: !!document.querySelector('#snapBar .os-gear'), on: [...document.querySelectorAll('#snapBar .os-chip.on')].map(b => b.dataset.os).sort().join(','), eski: document.querySelectorAll('#snapBar input[type=checkbox]').length, per: document.querySelector('#snapBar [data-os="per"]').textContent.trim() }));
  ok('B13 çip şeridi: dişli + 14 kip, açık olanlar vurgulu, eski onay kutuları yok', c.n === 15 && c.gear && c.on === 'cen,end,ins,int,mid,node' && c.eski === 0 && c.per === 'PER', J(c));
  await klik('#snapBar [data-os="per"]');
  ok('B14 çipe dokunmak kipi açar ve çip vurgulanır', (await modes()).includes('per') && (await ev(() => document.querySelector('#snapBar [data-os="per"]').classList.contains('on'))));
  await klik('#snapBar [data-os="per"]');
  await klik('#snapBar .os-gear');
  ok('B15 dişli ayar kutusunu açar', (await doc()).baslik === 'Nesne yakalama');
  await ev(() => window.dwgApp.onBack()); await shot('osnap_cipler'); await ev(() => window.dwgApp.setMode('view')); await bekle();
}
{
  // F3 / F11 / durum çubuğu
  await ev(() => window.dwgApp.editor.act('osnap')); await bekle();
  const kapali = await ev(() => ({ n: window.dwgApp.state.snapModes.size, st: document.querySelector('#stQuick [data-quick="osnap"]').classList.contains('on') }));
  await ev(() => window.dwgApp.editor.act('osnap')); await bekle();
  ok('B16 F3 (osnap eylemi) kapatır ve durum çubuğu düğmesi söner; yeniden açınca liste döner', kapali.n === 0 && !kapali.st && (await modes()) === 'cen,end,ins,int,mid,node', J(kapali));
  await temizle(); await ev(() => window.dwgApp.editor.act('otrack')); await bekle();
  const tr1 = await ev(() => ({ on: window.dwgApp.osnap.opt().otrack }));
  const t1 = await toast();
  await ev(() => window.dwgApp.editor.act('otrack')); await bekle();
  ok('B17 F11 (otrack) yakalama izini açar / kapatır, ileti yazar', tr1.on === true && /Yakalama izi açık/.test(t1) && (await ev(() => window.dwgApp.osnap.opt().otrack)) === false, J({ tr1, t1 }));
  const fk = await ev(async () => { const D = await import('./desktop.js'); return D.FKEYS.F11 && D.FKEYS.F11.act; });
  ok('B18 desktop.js: F11 → otrack', fk === 'otrack', String(fk));
  // durum çubuğunda uzun basış ayar kutusunu açar, ardından gelen click kipi değiştirmez
  const n0 = await ev(() => window.dwgApp.state.snapModes.size);
  await ev(() => { const b = document.querySelector('#stQuick [data-quick="osnap"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch' })); });
  await bekle(650);
  await ev(() => { const b = document.querySelector('#stQuick [data-quick="osnap"]'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch' })); b.click(); }); await bekle();
  ok('B19 durum çubuğu OSNAP düğmesine uzun basış ayar kutusunu açar; sonraki click kipi değiştirmez', (await doc()).baslik === 'Nesne yakalama' && (await ev(() => window.dwgApp.state.snapModes.size)) === n0, J(await doc()));
  await ev(() => window.dwgApp.onBack()); await bekle();
}
{
  // -OSNAP komut satırı
  let b = await bar(); if (!b.text) { await ev(() => window.dwgApp.editor.act('cmdline')); await bekle(); }
  await yaz('-os'); await gir(); b = await bar();
  ok('B20 "-OS": kip listesi istemi, geçerli liste öneri olarak', b.seq && /^Yakalama kipleri/.test(b.text) && b.ph === 'END,MID,CEN,INT,INS,NOD', J(b));
  await temizle(); await yaz('end, mid,bozuk'); await gir();
  ok('B21 "end, mid,bozuk" → END+MID kurulur, tanınmayan ad bildirilir, sıra biter', (await modes()) === 'end,mid' && !(await bar()).seq, await modes());
  await yaz('-osnap'); await gir(); await yaz('none'); await gir();
  ok('B22 NONE hepsini kapatır', (await ev(() => window.dwgApp.state.snapModes.size)) === 0);
  await ev(() => window.dwgApp.osnap.setModes(window.dwgApp.osnap.DEFAULT_MODES)); await bekle();
  await yaz('os'); await gir();
  ok('B23 tiresiz OSNAP (AutoCAD gibi) ayar kutusunu açar', (await doc()).baslik === 'Nesne yakalama');
  await ev(() => window.dwgApp.onBack()); await bekle();
}
{
  // Nokta istemine yazılan bir kerelik kipler: boş bölgede polyline aracıyla (noktalar birikir; LINE her parçadan sonra son noktadan devam eder)
  await zoom([50000, 50000, 52000, 52000]);
  await ev(() => window.dwgApp.editor.act('t:pline')); await bekle();
  await temizle(); await yaz('m2p'); await gir();
  ok('B24 "m2p" yazınca bir kerelik kip kurulur ve ileti yazar', (await ev(() => window.dwgApp.state.snapOnce)) === 'm2p' && /Bir kerelik: M2P/.test(await toast()), await toast());
  await tapWorld(50100, 50100);
  const ilk = await ev(() => ({ once: window.dwgApp.state.snapOnce, n: window.dwgApp.editor.tools.pts.length }));
  ok('B25 ilk dokunuş NOKTA SAYILMAZ (bekler), ikinci nokta istenir', ilk.n === 0 && ilk.once === 'm2p' && /ikinci noktaya dokunun/.test(await toast()), J(ilk));
  await tapWorld(50300, 50100);
  const p1 = await pts();
  ok('B26 ikinci dokunuşta iki noktanın ORTASI (50200,50100) ilk köşe olur, kip tüketilir', p1.length === 1 && near(p1[0][0], 50200, 0.5) && near(p1[0][1], 50100, 0.5) && (await ev(() => window.dwgApp.state.snapOnce)) === null, J(p1));
  await yaz('from'); await gir(); await tapWorld(50500, 50500);
  ok('B27 FROM: taban dokunuşu nokta sayılmaz, "@dx,dy yazın" denir', (await pts()).length === 1 && /@dx,dy/.test(await toast()));
  await yaz('@10,5'); await gir();
  const p2 = await pts();
  ok('B28 @10,5 taban noktaya göre çözülür → (50510,50505)', p2.length === 2 && near(p2[1][0], 50510, 0.5) && near(p2[1][1], 50505, 0.5), J(p2));
  await yaz('@100,0'); await gir();
  const p3 = await pts();
  ok('B29 sonraki @ yine SON noktaya göre (taban bir kez kullanıldı) → (50610,50505)', p3.length === 3 && near(p3[2][0], 50610, 0.5) && near(p3[2][1], 50505, 0.5), J(p3));
  await yaz('tk'); await gir(); await tapWorld(50800, 50800);
  ok('B30 TK: iz noktası alınır, nokta sayılmaz', (await pts()).length === 3 && (await ev(() => window.dwgApp.state.snapOnce)) === 'tk2');
  await tapWorld(50806, 50900);
  const p4 = await pts();
  ok('B31 ikinci dokunuş iz noktasına DÜŞEY hizalanır → (50800,50900)', p4.length === 4 && near(p4[3][0], 50800, 0.5) && near(p4[3][1], 50900, 0.5), J(p4));
  await yaz('non'); await gir();
  ok('B32 NON bir kerelik "yakalama yok"', (await ev(() => window.dwgApp.state.snapOnce)) === 'non');
  await tapWorld(50900, 50900);
  ok('B33 NON tüketildi, nokta ham alındı', (await pts()).length === 5 && (await ev(() => window.dwgApp.state.snapOnce)) === null);
  await ev(() => window.dwgApp.editor.tools.cancel()); await bekle();
}
{
  // Gerçek çizim üstünde dokunuş: uç noktaya oturur, dokunuş sonrası işaret kalır, çip yazar
  const uc = await ev(() => { const S = window.dwgApp.state; const p = S.prims.find(q => q.k === 0 && q.ops.length === 2 && q.ops[0][0] === 0 && q.ops[1][0] === 1); return p ? { x: p.ops[1][1], y: p.ops[1][2], bb: p.bb } : null; });
  if (uc) {
    await zoom([uc.x - 500, uc.y - 500, uc.x + 500, uc.y + 500]);
    await ev(() => window.dwgApp.editor.act('t:line')); await bekle();
    const s = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [uc.x, uc.y]);
    const r = await page.locator('#viewport').boundingBox();
    await page.touchscreen.tap(r.x + s[0] + 6, r.y + s[1] - 5); await bekle(200);
    const st = await ev(() => ({ pts: window.dwgApp.editor.tools.pts.map(p => p.slice(0, 2)), flash: window.dwgApp.state.snapFlash && window.dwgApp.state.snapFlash.kind, chip: document.getElementById('stSnap').hidden ? '' : document.getElementById('stSnap').textContent, trk: window.dwgApp.state.trackPt }));
    ok('B34 uç noktanın 6 px yanına dokunuş uca OTURUR; dokunuş sonrası işaret END, durum çipi END, iz noktası alındı', st.pts.length === 1 && near(st.pts[0][0], uc.x, 1e-6) && near(st.pts[0][1], uc.y, 1e-6) && st.flash === 'end' && st.chip === 'END' && !!st.trk, J(st));
    await shot('osnap_isaret');
    await ev(() => window.dwgApp.editor.tools.cancel()); await bekle();
  } else C.skip('B34 örnekte tek parçalı çizgi yok');
}
{
  const g = await ev(() => {
    const O = window.dwgApp.osnap;
    const c = document.createElement('canvas').getContext('2d');
    let hata = null; try { for (const k of [...O.MODES.map(m => m.id), 'm2p', 'from', 'tk', 'non', 'trk']) O.drawMarker(c, 10, 10, k, 7); } catch (e) { hata = e.message; }
    return { hata, end: O.markerSvg('end'), per: O.markerSvg('per'), cen: O.markerSvg('cen'), ov: [O.overrideOf('END'), O.overrideOf('endp'), O.overrideOf('mtp'), O.overrideOf('none'), O.overrideOf('tt'), O.overrideOf('xyz')], list: O.parseList('END, mid;cen bozuk') };
  });
  ok('B35 her kipin tuval işareti çizilir; SVG glifleri yol / daire taşır', g.hata === null && /<path d="M/.test(g.end) && /<path/.test(g.per) && /<circle/.test(g.cen), J({ hata: g.hata }));
  ok('B36 yazılan adlar AutoCAD eşanlamlılarıyla çözülür (ENDP, MTP, NONE, TT)', g.ov.join(',') === 'end,end,m2p,non,tk,', g.ov.join(','));
  ok('B37 parseList: tanınanlar sırayla, tanınmayan "bozuk" ayrı', g.list.modes.join(',') === 'end,mid,cen' && g.list.bad.join(',') === 'bozuk', J(g.list));
}
{
  await dil('en'); await bekle(200);
  await ev(() => window.dwgApp.editor.act('osnapset')); await bekle(200);
  const en = await ev(() => ({ baslik: document.getElementById('docTitle').textContent, ad: document.querySelector('#osGrid [data-os="per"] span').textContent, chip: document.querySelector('#snapBar [data-os="end"]').title }));
  ok('B38 EN: "Object snap", kart adı "Perpendicular", çip başlığı "Endpoint"', en.baslik === 'Object snap' && en.ad === 'Perpendicular' && en.chip === 'Endpoint', J(en));
  await ev(() => window.dwgApp.onBack()); await dil('tr'); await bekle(150);
}
ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
