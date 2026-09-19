// Budama (trim) · Uzatma (extend) · Kavis (fillet) · Pah (chamfer) + tek köşe (vertex) tutamağı.
//  1) Saf geometri: segIntersect'in sonsuz kipi, segAt, trimPath, extendPath, filletCorner,
//     chamferCorner, cornerAt — beklenen sayılar elle hesaplanmış, kodun kendisinden alınmamıştır.
//  2) Araç akışı: iki dokunuş, kesicinin korunması, bölünmede ilkel sayısı, tek geri alma.
//  3) Köşe tutamağı: varsayılan KAPALI (kutu ölçeklemesi bozulmasın), açıkken düğüm önceliği,
//     sürüklerken belgenin değişmemesi, bırakışta tek 'reshape'.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_budama.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, queueAnswers, PHONE } from './harness.mjs';

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
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });

await ev(async () => { window.__G = await import('./geom.js'); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const count = () => ev(() => window.dwgApp.state.prims.length);
const undoLen = () => ev(() => { const d = window.dwgApp.editor.doc; return d ? d.log.length : -1; });   // günlük: geri alma yığını 10 adımla sınırlı (v7.55), sayım günlükten
const sonOp = () => ev(() => { const d = window.dwgApp.editor.doc; const l = d && d.log ? d.log : []; return l.length ? l[l.length - 1].op : null; });
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await page.waitForTimeout(150); };
const tapWorld = async (x, y) => { await page.waitForTimeout(110); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(160); };
/** Bilinen koordinatlarda yol ekler; dönen kimliklerle sonradan bulunur */
const ekle = (ents) => ev((es) => {
  const E = window.dwgApp.editor, ids = es.map((e, i) => 'sin_' + Date.now() + '_' + i);
  E.doc.run({ op: 'add', ents: es.map((e, i) => ({ ...e, id: ids[i], layer: '0', color: 256 })) });
  window.dwgApp.requestRender();
  return ids;
}, ents);
const primOf = (id) => ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); return p ? { ops: p.ops.map(o => o.slice()), closed: !!p.closed, entType: p.ent && p.ent.type } : null; }, id);
const sil = (ids) => ev((ks) => { window.dwgApp.editor.doc.run({ op: 'delete', keys: ks }); window.dwgApp.requestRender(); }, ids);
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
const yak = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ---------------------------------------------------------------------------------
// 1) Saf geometri — sayfa içinde geom.js doğrudan çağrılır
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const G = await import('./geom.js');
    const poly = [[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 10, 0]];
    const rect = [[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 10, 0], [1, 0, 10, 0]];
    const A = [[0, 0, 0, 0], [1, 8, 0, 0]], B = [[0, 10, 2, 0], [1, 10, 10, 0]];
    const zikzak = [[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 4, 0], [1, 4, 4, 0], [1, 4, 12, 0]];
    const daire = [[0, 10, 0, 0], [2, 0, 0, 10, 0, 2 * Math.PI, 0]];          // merkez [0,0], r 10
    const yay = [[0, 10, 0, 0], [2, 0, 0, 10, 0, Math.PI, 0]];                // üst yarım çember
    return {
      sinirli: G.segIntersect([0, 0, 4, 0], [5, -5, 5, 5]),
      sonsuz: G.segIntersect([0, 0, 4, 0], [5, -5, 5, 5], true),
      icinde: G.segIntersect([0, 0, 10, 0], [5, -5, 5, 5]),
      segAt: G.segAt(poly, false, [9, 3]),
      yayAtla: G.segAt([[0, 0, 0, 0], [2, 5, 0, 5, Math.PI, 0, 0], [1, 20, 0, 0]], false, [15, 0.2]),
      trimUc: G.trimPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [[5, -5, 5, 5]], [8, 0]),
      trimOrta: G.trimPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [[3, -5, 3, 5], [7, -5, 7, 5]], [5, 0]),
      trimKapali: G.trimPath(rect, true, [[2, -5, 2, 5], [8, -5, 8, 5]], [5, 0]),
      trimYok: G.trimPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [[20, -5, 20, 5]], [5, 0]),
      boy: (o) => 0,
      uzatUc: G.extendPath([[0, 0, 0, 0], [1, 4, 0, 0]], false, [[10, -5, 10, 5]], [4, 0]),
      uzatSonsuz: G.extendPath([[0, 0, 0, 0], [1, 4, 0, 0]], false, [[10, 3, 10, 5]], [4, 0]),
      uzatKapali: G.extendPath(rect, true, [[20, -5, 20, 5]], [5, 0]),
      uzatBas: G.extendPath([[0, 4, 0, 0], [1, 10, 0, 0]], false, [[0, -5, 0, 5]], [4, 0]),
      kavis: G.filletCorner([0, 0], [10, 0], [10, 10], 3),
      kavisKirp: G.filletCorner([0, 0], [10, 0], [10, 10], 50),
      kavisDuz: G.filletCorner([0, 0], [10, 0], [20, 0], 3),
      pah: G.chamferCorner([0, 0], [10, 0], [10, 10], 2, 2),
      kAyni: G.cornerAt(poly, false, [5, 0], poly, false, [10, 5]),
      kIki: G.cornerAt(A, false, [4, 0], B, false, [10, 8]),
      kParalel: G.cornerAt(A, false, [4, 0], [[0, 0, 5, 0], [1, 8, 5, 0]], false, [4, 5]),
      // v7.92: aynı segmente iki kez dokunma, ATLAMALI segmentler ve kapalı yolun başlangıç düğümü
      kAyniSeg: G.cornerAt(poly, false, [5, 0], poly, false, [7, 0]),
      // [0,0]→[10,0]→[10,4]→[4,4]→[4,12]: 1. ve 4. segment arasında iki segment var, atılmalı
      kAtlamali: G.cornerAt(zikzak, false, [5, 0], zikzak, false, [4, 9]),
      kKapanis: G.cornerAt(rect, true, [5, 0], rect, true, [0, 5]),
      // v7.92 · KESİCİ HER NESNEDEN
      cutDaire: G.cutterSegs({ k: 0, closed: true, ops: daire }).length,
      cutDaireKapali: (() => { const q = G.cutterSegs({ k: 0, closed: true, ops: daire }); const a = q[0], b = q[q.length - 1]; return Math.hypot(b[2] - a[0], b[3] - a[1]); })(),
      cutYazi: G.cutterSegs({ k: 1, bb: [0, 0, 4, 2] }),
      cutNokta: G.cutterSegs({ k: 2, bb: [3, 3, 3, 3] }).length,
      cutResim: G.cutterSegs({ k: 3, quad: [[0, 0], [4, 0], [4, 3], [0, 3]] }).length,
      cutAltYol: G.cutterSegs({ k: 0, closed: true, ops: [[0, 0, 0, 0], [1, 2, 0, 0], [1, 2, 2, 0], [0, 5, 5, 0], [1, 7, 5, 0], [1, 7, 7, 0]] }).length,
      // v7.92 · YAY VE DAİRE BUDANIR
      trimDaire: G.trimPath(daire, true, [[0, -20, 0, 20]], [7.0710678, 7.0710678]),
      trimYay: G.trimPath(yay, false, [[-20, 5, 20, 5]], [0, 10]),
      // v7.92 · DOLGU (tarama) budama: kare dolgu düşey doğruyla ikiye bölünür, SOL parçaya dokunulur
      trimAlan: G.trimRegion([[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 10, 0], [1, 0, 10, 0]], [[4, -5, 4, 15]], [2, 5]),
      trimAlanYay: G.trimRegion([[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 10, 0], [1, 0, 10, 0]], G.cutterSegs({ k: 0, closed: false, ops: [[0, 4, -5, 0], [1, 4, 2, 0], [2, 4, 5, 3, -Math.PI / 2, Math.PI / 2, 0], [1, 4, 15, 0]] }), [2, 5]),
      boyDaire: (() => { const r = G.trimPath(daire, true, [[0, -20, 0, 20]], [7.0710678, 7.0710678]); return r ? r.parts.map(q => G.pathLength3(q.ops, false)) : null; })(),
      boyYay: (() => { const r = G.trimPath(yay, false, [[-20, 5, 20, 5]], [0, 10]); return r ? r.parts.map(q => G.pathLength3(q.ops, false)) : null; })(),
            boyUc: G.pathLength3(G.trimPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [[5, -5, 5, 5]], [8, 0]).parts[0].ops, false),
      boyOrta: G.trimPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [[3, -5, 3, 5], [7, -5, 7, 5]], [5, 0]).parts.map(p => G.pathLength3(p.ops, false)),
      boyUzat: G.pathLength3(G.extendPath([[0, 0, 0, 0], [1, 4, 0, 0]], false, [[10, -5, 10, 5]], [4, 0]).ops, false),
      // boyla kısaltma / uzatma (LENGTHEN DElta): uç dokunulan noktaya yakın olandır
      lenUzat: G.lengthenPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [9, 0], 4),
      lenKisalt: G.lengthenPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [9, 0], -3),
      lenBas: G.lengthenPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [1, 0], -3),
      lenDugumYutar: G.lengthenPath([[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 10, 0]], false, [10, 9], -15),
      lenUzun: G.lengthenPath([[0, 0, 0, 0], [1, 10, 0, 0]], false, [9, 0], -12),
      lenKapali: G.lengthenPath(rect, true, [5, 0], 3),
      lenYay: G.lengthenPath([[0, 0, 0, 0], [2, 5, 0, 5, Math.PI, 0, 0]], false, [10, 0], 3),
    };
  });
  ok('1a segIntersect: sınırlı kipte kesişim YOK (yakalamanın int kipi sahte kesişim üretmesin)', g.sinirli === null, JSON.stringify(g.sinirli));
  ok('1L1 lengthenPath +4: son uç [10,0] → [14,0]', g.lenUzat && g.lenUzat.at === 'end' && yak(g.lenUzat.ops[1][1], 14) && yak(g.lenUzat.ops[1][2], 0), JSON.stringify(g.lenUzat));
  ok('1L2 lengthenPath −3: son uç [7,0]', g.lenKisalt && yak(g.lenKisalt.ops[1][1], 7), JSON.stringify(g.lenKisalt));
  ok('1L3 başa yakın dokunuş baş ucu kısaltır: [3,0]–[10,0]', g.lenBas && g.lenBas.at === 'start' && yak(g.lenBas.ops[0][1], 3) && g.lenBas.ops[0][0] === 0 && yak(g.lenBas.ops[1][1], 10), JSON.stringify(g.lenBas));
  ok('1L4 kısaltma düğüm yutar: 15 birim, 10\'luk son segmenti alır + 5 keser → [0,0]–[5,0]', g.lenDugumYutar && g.lenDugumYutar.ops.length === 2 && yak(g.lenDugumYutar.ops[1][1], 5) && yak(g.lenDugumYutar.ops[1][2], 0), JSON.stringify(g.lenDugumYutar));
  ok('1L5 yoldan uzun kısaltma, kapalı yol ve yaylı yol null', g.lenUzun === null && g.lenKapali === null && g.lenYay === null, JSON.stringify([g.lenUzun, g.lenKapali, g.lenYay]));
  ok('1a2 segIntersect(inf=true) parçaların uzantısında kesişir', g.sonsuz && yak(g.sonsuz[0], 5) && yak(g.sonsuz[1], 0), JSON.stringify(g.sonsuz));
  ok('1a3 iki argümanlı eski davranış bozulmadı', g.icinde && yak(g.icinde[0], 5) && yak(g.icinde[1], 0), JSON.stringify(g.icinde));
  ok('1b segAt dokunulan segmentin dizinini ve oranını verir', g.segAt && g.segAt.i === 2 && yak(g.segAt.t, 0.3), JSON.stringify(g.segAt));
  ok('1b2 segAt yayı atlar ama imleci kaydırmaz (sonraki segment doğru yerde)', g.yayAtla && g.yayAtla.i === 2 && yak(g.yayAtla.t, 0.5), JSON.stringify(g.yayAtla));
  ok('2a trimPath uç budama: tek parça, boy 10 → 5, atılan aralık [5,0]–[10,0]',
    g.trimUc && g.trimUc.parts.length === 1 && yak(g.boyUc, 5) && yak(g.trimUc.cut[0][0], 5) && yak(g.trimUc.cut[1][0], 10), JSON.stringify(g.trimUc));
  ok('2b trimPath orta kesit: İKİ parça, boyları 3 ve 3', g.trimOrta && g.trimOrta.parts.length === 2 && yak(g.boyOrta[0], 3) && yak(g.boyOrta[1], 3), JSON.stringify(g.boyOrta));
  {
    const o = g.trimKapali && g.trimKapali.parts[0].ops;
    ok('2c kapalı dikdörtgen budanınca AÇILIR: [8,0]\u2192tur\u2192[2,0], 6 düğüm, closed=false',
      !!o && g.trimKapali.parts.length === 1 && g.trimKapali.parts[0].closed === false && o.length === 6 &&
      yak(o[0][1], 8) && yak(o[0][2], 0) && yak(o[4][1], 0) && yak(o[4][2], 0) && yak(o[5][1], 2), JSON.stringify(o));
  }
  ok('2d kesişim yoksa null (çağıran trimNoHit basar)', g.trimYok === null);
  ok('3a extendPath: uç sınıra kadar uzar, boy 4 → 10', g.uzatUc && g.uzatUc.at === 'end' && yak(g.uzatUc.p[0], 10) && yak(g.boyUzat, 10), JSON.stringify(g.uzatUc));
  ok('3b sınırlı parça ıskalanırsa SONSUZ doğruya düşülür (kenar uzat kipi)', g.uzatSonsuz && yak(g.uzatSonsuz.p[0], 10) && yak(g.uzatSonsuz.p[1], 0), JSON.stringify(g.uzatSonsuz));
  ok('3c kapalı yolun serbest ucu yok → null', g.uzatKapali === null);
  ok('3d ters uçtan dokunuşta baş uç uzar', g.uzatBas && g.uzatBas.at === 'start' && yak(g.uzatBas.p[0], 0), JSON.stringify(g.uzatBas));
  {
    const f = g.kavis;
    const d0 = f && Math.hypot(f.t0[0] - f.cx, f.t0[1] - f.cy), d1 = f && Math.hypot(f.t1[0] - f.cx, f.t1[1] - f.cy);
    ok('4a filletCorner: t0=[7,0] t1=[10,3] merkez=[7,3]; iki teğet de merkeze tam r uzaklıkta',
      !!f && yak(f.t0[0], 7) && yak(f.t0[1], 0) && yak(f.t1[0], 10) && yak(f.t1[1], 3) && yak(f.cx, 7) && yak(f.cy, 3) && yak(d0, 3, 1e-9) && yak(d1, 3, 1e-9), JSON.stringify(f));
  }
  ok('4b yarıçap kollara sığmazsa KIRPILIR, sessizce başarısız olmaz', g.kavisKirp && g.kavisKirp.r <= 10 + 1e-6 && g.kavisKirp.r > 0, JSON.stringify(g.kavisKirp && g.kavisKirp.r));
  ok('4b2 doğrudaş köşede kavis yok', g.kavisDuz === null);
  ok('4c chamferCorner: t0=[8,0] t1=[10,2], yeni kenar 2\u221a2',
    g.pah && yak(g.pah.t0[0], 8) && yak(g.pah.t1[1], 2) && yak(Math.hypot(g.pah.t1[0] - g.pah.t0[0], g.pah.t1[1] - g.pah.t0[1]), 2 * Math.SQRT2), JSON.stringify(g.pah));
  ok('6a cornerAt aynı ilkelde ardışık segmentleri çözer', g.kAyni && g.kAyni.kind === 'same' && g.kAyni.i === 1 && g.kAyni.j === 2 && yak(g.kAyni.c[0], 10) && yak(g.kAyni.c[1], 0), JSON.stringify(g.kAyni));
  ok('6b cornerAt iki ayrı ilkelde SONSUZ doğruların kesişimini alır, uzak uçları verir',
    g.kIki && g.kIki.kind === 'two' && yak(g.kIki.c[0], 10) && yak(g.kIki.c[1], 0) && yak(g.kIki.p0[0], 0) && yak(g.kIki.p1[1], 10), JSON.stringify(g.kIki));
  ok('6c paralel doğrularda köşe yok, SEBEBİ söylenir', g.kParalel && g.kParalel.kind === null && g.kParalel.neden === 'parallel', JSON.stringify(g.kParalel));
  ok('6d aynı segmente iki kez dokunmak ayrı bir sebeptir (kullanıcı ne yaptığını görsün)',
    g.kAyniSeg && g.kAyniSeg.kind === null && g.kAyniSeg.neden === 'sameSeg', JSON.stringify(g.kAyniSeg));
  ok('6e ATLAMALI iki segment: köşe uzantıların kesişiminde, aradaki işlemler atılır (AutoCAD FILLET)',
    g.kAtlamali && g.kAtlamali.kind === 'sameFar' && yak(g.kAtlamali.c[0], 4) && yak(g.kAtlamali.c[1], 0) &&
    g.kAtlamali.drop[0] === 2 && g.kAtlamali.drop[1] === 3, JSON.stringify(g.kAtlamali));
  ok('C1 cutterSegs daireyi kesici yapar: yay örneklenir, halka kapalıdır',
    g.cutDaire > 100 && g.cutDaireKapali < 1e-6, JSON.stringify([g.cutDaire, g.cutDaireKapali]));
  ok('C2 cutterSegs yazıyı sınır kutusuyla keser (AutoCAD TEXT kesici davranışı): 4 kenar',
    g.cutYazi.length === 4 && g.cutYazi.some(q => q[0] === 0 && q[1] === 0 && q[2] === 4 && q[3] === 0), JSON.stringify(g.cutYazi));
  ok('C3 nokta ilkelinin kenarı yok, resim dörtgeni 4 kenar', g.cutNokta === 0 && g.cutResim === 4, JSON.stringify([g.cutNokta, g.cutResim]));
  ok('C4 çok parçalı sınır (tarama): her ALT YOL ayrı kapanır, aralarında hayalet kenar doğmaz — 2×3 = 6',
    g.cutAltYol === 6, String(g.cutAltYol));
  {
    const o = g.trimDaire && g.trimDaire.parts[0].ops;
    ok('Y1 TAM DAİRE budanır: 45°\'de dokunulan çeyrek atılır, geriye TEK yay kalır (2 işlem)',
      !!o && g.trimDaire.parts.length === 1 && o.length === 2 && o[0][0] === 0 && (o[1][0] === 2 || o[1][0] === -2), JSON.stringify(o));
    ok('Y2 kalan yayın boyu 270° = 10 × 3π/2 = 47,124', g.boyDaire && yak(g.boyDaire[0], 10 * 1.5 * Math.PI, 1e-6), JSON.stringify(g.boyDaire));
  }
  ok('Y3 YAY ortadan budanır: iki parça, her biri 30° = 10 × π/6 = 5,236',
    g.trimYay && g.trimYay.parts.length === 2 && yak(g.boyYay[0], 10 * Math.PI / 6, 1e-6) && yak(g.boyYay[1], 10 * Math.PI / 6, 1e-6), JSON.stringify(g.boyYay));
  {
    const r = g.trimAlan;
    const alan = r ? (() => { const pts = r.ops.map(o => [o[1], o[2]]); let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); })() : -1;
    ok('D1 DOLGU budanınca KAPALI kalır (açılsa dolgu taşardı)', !!r && r.closed === true, JSON.stringify(r && r.ops));
    ok('D2 sol parça atıldı: 10×10 = 100 alandan geriye 6×10 = 60 kalır', yak(alan, 60, 1e-6), String(alan));
  }
  {
    const r = g.trimAlanYay;
    const alan = r ? (() => { const pts = r.ops.map(o => [o[1], o[2]]); let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); })() : -1;
    // Yay sola doğru şişse alan artardı; sağa şiştiği için kalan parçadan yarım daire (≈14,1) düşer.
    ok('D3 kesici YAYSA kalan alanın yeni kenarı da YAY olur, kiriş çekilmez (düğüm sayısı > 5)',
      !!r && r.closed === true && r.ops.length > 5, JSON.stringify(r && r.ops.length));
    ok('D4 yayla kesilen alan 60 − yarım daire (≈ 45,9)', yak(alan, 60 - Math.PI * 9 / 2, 0.05), String(alan));
  }
  ok('Y4 budanan yayın parçaları YİNE YAYDIR (doğruya düzleştirilmez)',
    g.trimYay && g.trimYay.parts.every(q => q.ops.some(o => o[0] === 2 || o[0] === -2)), JSON.stringify(g.trimYay && g.trimYay.parts.map(q => q.ops)));
  ok('6f kapalı yolun BAŞLANGIÇ düğümü de köşedir (kapanış kenarı ile ilk kenar)',
    g.kKapanis && g.kKapanis.kind === 'same' && g.kKapanis.i === 0 && yak(g.kKapanis.c[0], 0) && yak(g.kKapanis.c[1], 0), JSON.stringify(g.kKapanis));
}

// ---------------------------------------------------------------------------------
// 2) Kademe: beş yeni kimlik FEATURE_TIER'de
// ---------------------------------------------------------------------------------
{
  const n = await ev(async () => { const E = await import('./edition.js'); return ['t:trim', 't:extend', 't:fillet', 't:chamfer', 'grips'].map(k => E.need(k)); });
  ok('7 beş yeni yetenek Premium basamağında', n.every(x => x === 'premium'), n.join(','));
  const karo = await ev(() => ['t:trim', 't:extend', 't:fillet', 't:chamfer', 'grips'].map(k => !!document.querySelector(`#toolbar [data-act="${k}"]`)));
  ok('7b beş karo da şeritte çizildi', karo.every(Boolean), JSON.stringify(karo));
  const simge = await ev(() => ['i-trim', 'i-extend', 'i-fillet', 'i-chamfer', 'i-grips'].map(id => !!document.getElementById(id)));
  ok('7c beş SVG simgesi tanımlı (boş kare çizilmiyor)', simge.every(Boolean), JSON.stringify(simge));
}

// ---------------------------------------------------------------------------------
// 3) Buda aracı — kesişen iki doğru
// ---------------------------------------------------------------------------------
await page.click('#toolbar [data-tab="edit"]');
{
  // hedef: (100,300)–(900,300) · kesici: (500,100)–(500,500)
  const ids = await ekle([
    { type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] },
    { type: 'LINE', pts: [[500, 100, 0], [500, 500, 0]] },
  ]);
  await zoom([0, 0, 1000, 600]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:trim"]');
  await tapWorld(500, 400);        // kesici kenar
  await tapWorld(800, 300);        // atılacak parça (sağ yarı)
  const p = await primOf(ids[0]);
  ok('8a buda: ilkel sayısı DEĞİŞMEZ, doğru [100,300]–[500,300]\'e iner',
    (await count()) === n0 && p && p.ops.length === 2 && yak(p.ops[1][1], 500) && yak(p.ops[1][2], 300), JSON.stringify(p && p.ops));
  ok('8b tek geri alma adımı, günlükte son op reshape', (await undoLen()) === u0 + 1 && (await sonOp()) === 'reshape', `${u0} → ${await undoLen()} · ${await sonOp()}`);
  ok('8c ent ile ops ayrışmadı (LINE olarak kaldı)', p.entType === 'LINE', String(p.entType));
  await shot('bd_trim');
  // araç 1. adımda kaldı mı: kesici korunur, ikinci hedef aynı komutta budanabilir
  const istem = await ev(() => document.getElementById('cmdText').textContent.trim());
  ok('8d araç sürer: istem hâlâ ikinci adımda (kesici korundu)', /Atılacak|remove/i.test(istem), istem);
  await ev(() => window.dwgApp.editor.doc.undo());
  await page.waitForTimeout(100);
  const p2 = await primOf(ids[0]);
  ok('8e geri al doğruyu eski boyuna döndürür', p2 && yak(p2.ops[1][1], 900), JSON.stringify(p2 && p2.ops));
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 4) Buda — ortadan bölme (iki kesici)
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([
    { type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] },
    { type: 'LWPOLYLINE', pts: [[400, 100, 0], [400, 500, 0], [700, 500, 0], [700, 100, 0]], closed: false },
  ]);
  await zoom([0, 0, 1000, 600]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:trim"]');
  await tapWorld(400, 200);        // kesici (U şeklinde polyline)
  await tapWorld(550, 300);        // ortadaki parça
  const p = await primOf(ids[0]);
  ok('9a bölme: ilkel sayısı +1 (ikinci yarı yeni ilkel)', (await count()) === n0 + 1, `${n0} → ${await count()}`);
  ok('9b kalan ilk yarı [100,300]–[400,300]', p && yak(p.ops[1][1], 400), JSON.stringify(p && p.ops));
  ok('9c bölme TEK geri alma adımı: son op group', (await undoLen()) === u0 + 1 && (await sonOp()) === 'group', `${u0} → ${await undoLen()} · ${await sonOp()}`);
  await ev(() => window.dwgApp.editor.doc.undo());
  await page.waitForTimeout(120);
  const p2 = await primOf(ids[0]);
  ok('9d tek geri al hem boyu hem ilkel sayısını eski hâline döndürür',
    (await count()) === n0 && p2 && yak(p2.ops[1][1], 900), `${await count()} · ${JSON.stringify(p2 && p2.ops)}`);
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 5) Buda — DAİRE hedefi (v7.92'de desteklendi), yazı hedefi ve kendi kendini kesme
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([
    { type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] },
    { type: 'CIRCLE', pts: [[500, 300, 0]], r: 120 },
  ]);
  await zoom([0, 0, 1000, 600]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:trim"]');
  await tapWorld(100, 300);        // kesici: doğru
  await tapWorld(500, 420);        // hedef: dairenin ÜST yarısı — v7.91'e kadar reddediliyordu
  await page.waitForTimeout(250);
  {
    const p = await primOf(ids[1]);
    const yay = p && p.ops.find(o => o[0] === 2 || o[0] === -2);
    const boy = await ev((k) => { const P = window.dwgApp.state.prims.find(x => x.key === k); return P ? window.__G.pathLength3(P.ops, false) : -1; }, ids[1]);
    ok('10a DAİRE budanır: üst yarı atılır, geriye tek yay kalır (ilkel sayısı değişmez)',
      !!yay && (await count()) === n0 && p.ops.length === 2, JSON.stringify(p && p.ops));
    ok('10b kalan yayın boyu yarım çember = π × 120 = 376,99', yak(boy, Math.PI * 120, 1e-4), String(boy));
    ok('10c tek reshape', (await undoLen()) === u0 + 1 && (await sonOp()) === 'reshape', String(await sonOp()));
  }
  const u1 = await undoLen();
  await tapWorld(300, 300);        // hedef = kesicinin kendisi
  ok('10d kesici kenarın kendisi budanamaz', (await undoLen()) === u1 && /kendisi|itself/i.test(await toast()), await toast());
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(120);
  await sil(ids);
}
{
  // Yazı hedefi hâlâ budanmaz (AutoCAD de kesmez); ama KESİCİ olabilir — C2 bunu kanıtlıyor.
  const ids = await ekle([
    { type: 'LINE', pts: [[100, 700, 0], [900, 700, 0]] },
    { type: 'TEXT', pts: [[400, 650, 0]], text: 'KESICI', h: 60 },
  ]);
  await zoom([0, 500, 1000, 900]);
  const u0 = await undoLen();
  await page.click('#toolbar [data-act="t:trim"]');
  await tapWorld(150, 700);        // kesici: doğru
  await tapWorld(430, 680);        // hedef: yazı
  ok('10e yazı hedefi budanmaz, belge kirlenmez', (await undoLen()) === u0, await toast());
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 5b) v7.92 · DAİRE KESİCİ ve DOLGU hedefi — araç akışında
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([
    { type: 'CIRCLE', pts: [[500, 300, 0]], r: 150 },
    { type: 'LINE', pts: [[100, 300, 0], [900, 300, 0]] },
  ]);
  await zoom([0, 0, 1000, 600]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:trim"]');
  await tapWorld(500, 450);        // KESİCİ: dairenin kendisi (v7.91'e kadar "düz kenar yok" diyordu)
  const istem = await ev(() => document.getElementById('cmdText').textContent);
  ok('11a DAİRE kesici kenar olarak kabul edilir (araç 2. adıma geçer)', /Atılacak parça|piece to remove/i.test(istem), istem);
  await tapWorld(500, 300);        // doğrunun daire İÇİNDE kalan parçası
  await page.waitForTimeout(250);
  ok('11b daireyle kesilen doğru İKİ parçaya ayrıldı', (await count()) === n0 + 1, `${n0} → ${await count()}`);
  {
    const p = await primOf(ids[1]);
    ok('11c kalan parça daireye teğet noktada biter ([350,300])', p && yak(p.ops[1][1], 350, 1e-3) && yak(p.ops[1][2], 300, 1e-3), JSON.stringify(p && p.ops));
  }
  await shot('bd_daire_kesici');
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(150);
  await sil(ids);
}
// ---------------------------------------------------------------------------------
// 5c) v7.93 · TARAMA BÜTÜN OLARAK budanır ve desen yeniden üretilir
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([
    { type: 'LWPOLYLINE', pts: [[200, 800, 0], [800, 800, 0], [800, 1200, 0], [200, 1200, 0]], closed: true },
    { type: 'LINE', pts: [[500, 700, 0], [500, 1300, 0]] },
  ]);
  await zoom([100, 700, 900, 1300]);
  // Desenli tarama: sınır (saydam dolgu) + desen çizgileri = İKİ ilkel, ortak gid
  await ev(() => { window.dwgApp.editor.curPattern = { name: 'ANSI31', scale: 0, angle: 0 }; });
  await ev(() => window.dwgApp.editor.act('t:hatch')); await page.waitForTimeout(300);
  await tapWorld(500, 1000); await page.waitForTimeout(500);
  await ev(() => { const b = document.querySelector('#cmdBtns [data-cmd="cancel"]'); if (b) b.click(); }); await page.waitForTimeout(150);
  // Örnek çizimde başka taramalar da var; YALNIZ bizim dikdörtgenimizin içindekiler sayılır
  const tar = () => ev(() => {
    const ic = (b) => b && b[0] > 150 && b[1] > 750 && b[2] < 850 && b[3] < 1250;
    const P = window.dwgApp.state.prims.filter(x => x.info && x.info.gid && ic(x.bb) && (x.et === 'HATCH' || x.info.t === 'HATCH' || x.hp != null));
    const s = P.find(x => x.et === 'HATCH');
    return { n: P.length, sinir: s ? { bb: s.bb.map(v => Math.round(v)), kapali: !!s.closed, dolgu: !!s.fill } : null,
      cizgi: P.filter(x => x !== s).reduce((a, x) => a + (x.ops ? x.ops.length : 0), 0) };
  });
  const t0 = await tar();
  if (!t0.sinir) {
    ok('12m (atlandı) desenli tarama üretilemedi', false, JSON.stringify(t0));
  } else {
    ok('12m desenli tarama iki ilkeldir: sınır + desen çizgileri', t0.n >= 2 && t0.cizgi > 10, JSON.stringify(t0));
    const u0 = await undoLen();
    await page.click('#toolbar [data-act="t:trim"]');
    await tapWorld(500, 1300);     // kesici: düşey doğru
    await tapWorld(300, 1000);     // hedef: taramanın SOL yarısı (desen çizgisinin üstüne denk gelebilir)
    await page.waitForTimeout(400);
    const t1 = await tar();
    ok('12n tarama BÜTÜN olarak budandı: sınır sağ yarıya indi (x0 = 500)',
      t1.sinir && Math.abs(t1.sinir.bb[0] - 500) <= 1 && Math.abs(t1.sinir.bb[2] - 800) <= 1, JSON.stringify(t1.sinir));
    ok('12o sınır hâlâ KAPALI ve DOLGULU', t1.sinir && t1.sinir.kapali && t1.sinir.dolgu, JSON.stringify(t1.sinir));
    ok('12p desen YENİDEN üretildi: çizgi düğümleri yarıya yakın azaldı',
      t1.cizgi > 0 && t1.cizgi < t0.cizgi, `${t0.cizgi} → ${t1.cizgi}`);
    ok('12r tek geri alma adımı (sil + ekle bir grup)', (await undoLen()) === u0 + 1 && (await sonOp()) === 'group', String(await sonOp()));
    await shot('bd_tarama_buda');
    await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(200);
    const t2 = await tar();
    ok('12s geri al taramayı eski hâline döndürür', t2.sinir && Math.abs(t2.sinir.bb[0] - 200) <= 1 && t2.cizgi === t0.cizgi, JSON.stringify(t2.sinir));
    await page.click('#cmdBtns [data-cmd="cancel"]');
  }
  await ev(() => { const E = window.dwgApp.editor; const ic = (b) => b && b[0] > 150 && b[1] > 750 && b[2] < 850 && b[3] < 1250; const ks = window.dwgApp.state.prims.filter(x => x.info && x.info.gid && ic(x.bb)).map(x => x.key); if (ks.length) E.doc.run({ op: 'delete', keys: ks }); });
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 6) Uzat aracı
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([
    { type: 'LINE', pts: [[100, 300, 0], [400, 300, 0]] },
    { type: 'LINE', pts: [[800, 100, 0], [800, 500, 0]] },
  ]);
  await zoom([0, 0, 1000, 600]);
  const u0 = await undoLen();
  await page.click('#toolbar [data-act="t:extend"]');
  await tapWorld(800, 450);        // sınır
  await tapWorld(390, 300);        // uzatılacak uç
  const p = await primOf(ids[0]);
  ok('11a uzat: uç sınıra oturur (x=800)', p && yak(p.ops[1][1], 800) && yak(p.ops[1][2], 300), JSON.stringify(p && p.ops));
  ok('11b tek reshape komutu', (await undoLen()) === u0 + 1 && (await sonOp()) === 'reshape', `${await sonOp()}`);
  await shot('bd_extend');
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 7) Kavis — aynı polyline'ın iki komşu segmenti
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([{ type: 'LWPOLYLINE', pts: [[200, 200, 0], [700, 200, 0], [700, 600, 0]], closed: false }]);
  await zoom([100, 100, 800, 700]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:fillet"]');
  // Ekran / Ölçü sorusu (v7.57): Ölçü seçilir, yarıçap ÖNCE yazılır, sonra iki doğruya dokunulur
  const soru = await ev(() => ({ text: document.getElementById('cmdText').textContent, ekran: !!document.querySelector('#cmdBtns [data-cmd="modescreen"]'), olcu: !!document.querySelector('#cmdBtns [data-cmd="modevalue"]') }));
  ok('12- kavis önce Ekran mı Ölçü mü diye sorar (iki düğme)', /Ekran mı, Ölçü mü/.test(soru.text) && soru.ekran && soru.olcu, JSON.stringify(soru));
  await page.click('#cmdBtns [data-cmd="modevalue"]'); await page.waitForTimeout(120);
  await ev(() => window.dwgApp.editor.tools.typed('100'));
  await tapWorld(400, 200);
  await tapWorld(700, 400);
  await page.waitForTimeout(250);
  const p = await primOf(ids[0]);
  const yay = p && p.ops.find(o => o[0] === 2 || o[0] === -2);
  ok('12a aynı polyline: ilkel sayısı DEĞİŞMEZ (yay yolun İÇİNE girer)', (await count()) === n0, `${n0} → ${await count()}`);
  ok('12b ops +1 ve eklenen işlem bir yay, yarıçapı 100', p && p.ops.length === 4 && !!yay && yak(yay[3], 100, 1e-6), JSON.stringify(p && p.ops));
  ok('12c köşe düğümü teğet noktasına çekildi ([600,200])', p && yak(p.ops[1][1], 600) && yak(p.ops[1][2], 200), JSON.stringify(p && p.ops[1]));
  ok('12d tek reshape komutu', (await undoLen()) === u0 + 1 && (await sonOp()) === 'reshape', String(await sonOp()));
  ok('12e yay içeren ops → ent PATH\'e çevrildi (blok/pano bayat kalmasın)', p.entType === 'PATH', String(p.entType));
  await shot('bd_fillet_ayni');
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 7b) Kavis — aynı polyline'ın ATLAMALI iki segmenti (v7.92) ve kapalı yolun BAŞLANGIÇ düğümü
// ---------------------------------------------------------------------------------
{
  // [200,200] → [700,200] → [700,400] → [400,400] → [400,900]: 1. ve 4. segment
  const ids = await ekle([{ type: 'LWPOLYLINE', pts: [[200, 200, 0], [700, 200, 0], [700, 400, 0], [400, 400, 0], [400, 900, 0]], closed: false }]);
  await zoom([100, 100, 900, 1000]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:fillet"]');
  await page.click('#cmdBtns [data-cmd="modevalue"]'); await page.waitForTimeout(120);
  await ev(() => window.dwgApp.editor.tools.typed('50'));
  await tapWorld(300, 200);    // 1. segment
  await tapWorld(400, 700);    // 4. segment
  await page.waitForTimeout(250);
  const p = await primOf(ids[0]);
  const yay = p && p.ops.find(o => o[0] === 2 || o[0] === -2);
  ok('12f ATLAMALI segmentlerde kavis KURULUR (eski sürüm "kavis kurulamadı" diyordu)', !!yay, JSON.stringify(p && p.ops));
  ok('12g aradaki iki işlem atıldı: 5 işlem → 4 (baş · teğet · yay · son)', p && p.ops.length === 4, JSON.stringify(p && p.ops));
  ok('12h yol L\'ye döndü: baş [200,200], son [400,900], yay yarıçapı 50',
    p && yak(p.ops[0][1], 200) && yak(p.ops[0][2], 200) && yak(p.ops[3][1], 400) && yak(p.ops[3][2], 900) && yak(yay[3], 50, 1e-6), JSON.stringify(p && p.ops));
  ok('12i tek reshape, ilkel sayısı değişmedi', (await count()) === n0 && (await undoLen()) === u0 + 1 && (await sonOp()) === 'reshape', String(await sonOp()));
  await shot('bd_fillet_atlamali');
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}
{
  const ids = await ekle([{ type: 'LWPOLYLINE', pts: [[200, 200, 0], [700, 200, 0], [700, 700, 0], [200, 700, 0]], closed: true }]);
  await zoom([100, 100, 800, 800]);
  const u0 = await undoLen();
  await page.click('#toolbar [data-act="t:fillet"]');
  await page.click('#cmdBtns [data-cmd="modevalue"]'); await page.waitForTimeout(120);
  await ev(() => window.dwgApp.editor.tools.typed('60'));
  await tapWorld(400, 200);    // ilk kenar
  await tapWorld(200, 450);    // KAPANIŞ kenarı — köşeleri ortak düğüm [200,200]
  await page.waitForTimeout(250);
  const p = await primOf(ids[0]);
  const yay = p && p.ops.find(o => o[0] === 2 || o[0] === -2);
  ok('12j kapalı yolun BAŞLANGIÇ düğümünde de kavis kurulur (eskiden hiç kurulamıyordu)', !!yay && p.closed === true, JSON.stringify(p && p.ops));
  ok('12k başlangıç düğümü kapanış kenarındaki teğet noktasına çekildi ([200,260]); yay [260,200]\'de biter',
    p && p.ops[0][0] === 0 && yak(p.ops[0][1], 200) && yak(p.ops[0][2], 260) &&
    yak(p.ops[2][1], 700) && yak(p.ops[2][2], 200), JSON.stringify(p && p.ops.slice(0, 3)));
  ok('12l tek reshape', (await undoLen()) === u0 + 1 && (await sonOp()) === 'reshape', String(await sonOp()));
  await shot('bd_fillet_kapanis');
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 8) Kavis — iki AYRI doğru
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([
    { type: 'LINE', pts: [[200, 200, 0], [600, 200, 0]] },
    { type: 'LINE', pts: [[700, 300, 0], [700, 600, 0]] },
  ]);
  await zoom([100, 100, 800, 700]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:fillet"]');
  await page.click('#cmdBtns [data-cmd="modevalue"]'); await page.waitForTimeout(120);
  await ev(() => window.dwgApp.editor.tools.typed('80'));
  await tapWorld(400, 200);
  await tapWorld(700, 500);
  await page.waitForTimeout(250);
  ok('13a iki ayrı doğru: ilkel sayısı +1 (yay ayrı ilkel)', (await count()) === n0 + 1, `${n0} → ${await count()}`);
  ok('13b tek geri alma adımı: son op group', (await undoLen()) === u0 + 1 && (await sonOp()) === 'group', String(await sonOp()));
  const yay = await ev(() => { const p = window.dwgApp.state.prims.slice(-1)[0]; const o = p && p.ops.find(q => q[0] === 2 || q[0] === -2); return o ? o.slice() : null; });
  ok('13c eklenen ilkelin ops\'unda yay var ve yarıçapı 80', !!yay && yak(yay[3], 80, 1e-6), JSON.stringify(yay));
  const p1 = await primOf(ids[0]), p2 = await primOf(ids[1]);
  ok('13d iki doğrunun köşeye yakın uçları teğet noktalarına çekildi',
    p1 && p2 && yak(p1.ops[1][1], 620) && yak(p2.ops[0][2], 280), JSON.stringify([p1 && p1.ops[1], p2 && p2.ops[0]]));
  await shot('bd_fillet_iki');
  await ev(() => window.dwgApp.editor.doc.undo()); await page.waitForTimeout(120);
  ok('13e tek geri al yayı da uçları da eski hâline döndürür', (await count()) === n0, `${await count()}`);
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 9) Pah
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([{ type: 'LWPOLYLINE', pts: [[200, 200, 0], [700, 200, 0], [700, 600, 0]], closed: false }]);
  await zoom([100, 100, 800, 700]);
  const n0 = await count(), u0 = await undoLen();
  await page.click('#toolbar [data-act="t:chamfer"]');
  await page.click('#cmdBtns [data-cmd="modevalue"]'); await page.waitForTimeout(120);
  await ev(() => window.dwgApp.editor.tools.typed('100'));
  await tapWorld(400, 200);
  await tapWorld(700, 400);
  await page.waitForTimeout(250);
  const p = await primOf(ids[0]);
  const kenar = p && p.ops.length === 4 ? Math.hypot(p.ops[2][1] - p.ops[1][1], p.ops[2][2] - p.ops[1][2]) : -1;
  ok('14a pah: köşe düğümü İKİ düğüme dönüştü (ops +1), ilkel sayısı değişmedi', (await count()) === n0 && p && p.ops.length === 4, JSON.stringify(p && p.ops));
  ok('14b yeni kenarın boyu 100\u221a2', yak(kenar, 100 * Math.SQRT2, 1e-6), String(kenar));
  ok('14c tek reshape komutu', (await undoLen()) === u0 + 1 && (await sonOp()) === 'reshape', String(await sonOp()));
  ok('14d düz ops → ent LWPOLYLINE olarak kaldı', p.entType === 'LWPOLYLINE', String(p.entType));
  await shot('bd_chamfer');
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await sil(ids);
}

// ---------------------------------------------------------------------------------
// 10) Köşe (vertex) tutamağı
// ---------------------------------------------------------------------------------
{
  const ids = await ekle([{ type: 'LWPOLYLINE', pts: [[200, 200, 0], [700, 200, 0], [700, 600, 0], [200, 600, 0]], closed: false }]);
  await zoom([100, 100, 800, 700]);
  await ev((k) => { const p = window.dwgApp.state.prims.find(x => x.key === k); window.dwgApp.editor.select(p); }, ids[0]);
  await page.waitForTimeout(150);

  const layout = () => ev(async () => {
    const Gz = await import('./gizmo.js'), St = await import('./state.js'), E = await import('./editor.js');
    const sel = [...window.dwgApp.editor.selection()];
    const bb = Gz.boxOf(sel); if (!bb) return null;
    const L = Gz.layout(bb, St.toScreen, { fs: E.ui.fontScale, glove: E.ui.glove });
    const vs = Gz.vertsOf(sel[0]);
    const VL = E.ui.grips && vs.length ? Gz.layoutVerts(vs, St.toScreen, { fs: E.ui.fontScale, glove: E.ui.glove }) : null;
    return { grips: !!E.ui.grips, vn: vs.length, pts: L.pts, vpts: VL ? VL.pts : null, hitBox: Gz.hit(L.pts.nw[0], L.pts.nw[1], L, null), hitVert: Gz.hit(L.pts.nw[0], L.pts.nw[1], L, VL) };
  });

  let L = await layout();
  ok('15a köşe tutamağı VARSAYILAN KAPALI (kutu ölçeklemesi bozulmaz)', L.grips === false && L.vpts === null, JSON.stringify({ grips: L.grips }));
  ok('15b kapalıyken kutu köşesine dokunuş kutu tutamağını verir', L.hitBox === 'nw' && L.hitVert === 'nw', `${L.hitBox} / ${L.hitVert}`);
  ok('15c vertsOf düz düğüm sayısını verir (4)', L.vn === 4, String(L.vn));

  await page.click('#toolbar [data-act="grips"]');
  await page.waitForTimeout(200);
  L = await layout();
  ok('15d karo açınca ui.grips true ve her düğüm için ekran noktası kurulur', L.grips === true && L.vpts && L.vpts.length === 4, JSON.stringify({ grips: L.grips, n: L.vpts && L.vpts.length }));
  ok('15e açıkken kutu köşesiyle çakışan düğüm ÖNCELİK kazanır', /^v:\d+$/.test(String(L.hitVert)), String(L.hitVert));
  ok('15f karo basılı görünür', await ev(() => { const b = document.querySelector('#toolbar [data-act="grips"]'); return b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true'; }));
  await shot('bd_grips');

  // sürükleme: 1. düğüm (indeks 1 → [700,200]) sağa/yukarı taşınır
  const r = await page.locator('#viewport').boundingBox();
  const s0 = await ev(() => window.dwgApp.toScreen(700, 200));
  const u0 = await undoLen(), p0 = await primOf(ids[0]);
  await page.mouse.move(r.x + s0[0], r.y + s0[1]);
  await page.mouse.down();
  await page.mouse.move(r.x + s0[0] + 30, r.y + s0[1] - 20, { steps: 4 });
  await page.mouse.move(r.x + s0[0] + 60, r.y + s0[1] - 40, { steps: 4 });
  await page.waitForTimeout(80);
  const ortada = { u: await undoLen(), ops: (await primOf(ids[0])).ops };
  await page.mouse.up();
  await page.waitForTimeout(180);
  const p1 = await primOf(ids[0]), u1 = await undoLen();
  const sc = await ev(() => window.dwgApp.state.view.scale);
  const dx = (p1.ops[1][1] - p0.ops[1][1]) * sc, dy = (p1.ops[1][2] - p0.ops[1][2]) * sc;

  ok('16a sürükleme sırasında BELGE DEĞİŞMEZ (yalnız önizleme)',
    ortada.u === u0 && yak(ortada.ops[1][1], p0.ops[1][1]) && yak(ortada.ops[1][2], p0.ops[1][2]), JSON.stringify({ u: ortada.u, v: ortada.ops[1] }));
  ok('16b bırakışta yalnız o düğüm taşındı (+60 px sağ, +40 px yukarı)', Math.abs(dx - 60) < 4 && Math.abs(dy - 40) < 4, `dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
  ok('16c öteki düğümler BİREBİR aynı kaldı',
    [0, 2, 3].every(i => yak(p1.ops[i][1], p0.ops[i][1]) && yak(p1.ops[i][2], p0.ops[i][2])), JSON.stringify(p1.ops));
  ok('16d tek geri alma adımı, günlükte op reshape', u1 === u0 + 1 && (await sonOp()) === 'reshape', `${u0} → ${u1} · ${await sonOp()}`);
  await ev(() => window.dwgApp.editor.doc.undo());
  await page.waitForTimeout(120);
  const p2 = await primOf(ids[0]);
  ok('16e geri al düğümü TAM eski yerine koyar', yak(p2.ops[1][1], p0.ops[1][1]) && yak(p2.ops[1][2], p0.ops[1][2]), JSON.stringify(p2.ops[1]));

  await page.click('#toolbar [data-act="grips"]');   // eski hâline: kapalı
  await page.waitForTimeout(120);
  ok('16f karo yeniden basılınca kapanır', (await layout()).grips === false);
  await sil(ids);
}

ok('17 sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); await srv.kill();
C.summary(); C.exit();
