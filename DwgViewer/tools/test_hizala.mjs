/*
 * v7.72 — ALIGN (1 çift: taşı; 2 çift: taşı + döndür; ölçek düğmesi), WIPEOUT (köşelerden maske, polyline'dan maske,
 * çerçeve anahtarı, piksel düzeyinde örtme), DRAWORDER (öne / arkaya / üstüne / altına, TEXTTOFRONT, HATCHTOBACK,
 * seçim menüsü kartları, geri alma), DXF'te WIPEOUT + CLASSES.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_hizala.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';

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
const J = JSON.stringify, yak = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes([]); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const tapWorld = async (x, y) => { await bekle(110); await temizle(); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(420); };
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(200); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(250); };
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, step: T.step, selecting: T.selecting, text: document.getElementById('cmdText').textContent.trim(), sel: window.dwgApp.editor.sel.size, btns: [...document.querySelectorAll('#cmdBtns [data-cmd]')].map(b => b.dataset.cmd) }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const prim = (key) => ev((k) => { const p = window.dwgApp.state.prims.find(q => q.key === k); return p ? { key: p.key, k: p.k, et: p.et, bg: !!p.bg, fill: !!p.fill, closed: !!p.closed, ops: p.ops ? p.ops.map(o => o.slice()) : null, bb: p.bb, lines: p.lines, x: p.x, y: p.y } : null; }, key);
const sira = (keys) => ev((ks) => ks.map(k => window.dwgApp.state.prims.findIndex(p => p.key === k)), keys);
const ekle = (ents) => ev((es) => { const E = window.dwgApp.editor, S = window.dwgApp.state; const n0 = S.prims.length; const NID = () => 'T' + Math.random().toString(36).slice(2, 10); E.runCmd({ op: 'add', ents: es.map(e => ({ ...e, id: e.id || NID(), layer: e.layer || '0', color: e.color == null ? 256 : e.color })) }); return S.prims.slice(n0).map(p => p.key); }, ents);
const secKeys = (keys) => ev((ks) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (ks.includes(p.key)) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, keys);
const bosNokta = () => ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });
const runCmd = (cmd) => ev((c) => window.dwgApp.editor.runCmd(c), cmd);
const undo = async () => { await ev(() => { window.dwgApp.editor.act('undo'); }); await bekle(150); };
const bitir = async () => { await page.click('#cmdBtns [data-cmd="finish"]'); await bekle(300); };
/** (x, y) dünya noktası çevresinde w×h cihaz pikselinde arka plandan ayrışan piksel sayısı (arka plan: bx, by boş noktası) */
const boya = (x, y, bx, by) => ev(([x, y, bx, by]) => {
  const c = document.getElementById('cv'), g = c.getContext('2d'), dpr = c.width / c.clientWidth;
  const b = window.dwgApp.toScreen(bx, by), bd = g.getImageData(Math.round(b[0] * dpr), Math.round(b[1] * dpr), 1, 1).data;
  const s = window.dwgApp.toScreen(x, y), W = 9, H = 9;
  const d = g.getImageData(Math.round(s[0] * dpr - W / 2), Math.round(s[1] * dpr - H / 2), W, H).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bd[0]) + Math.abs(d[i + 1] - bd[1]) + Math.abs(d[i + 2] - bd[2]) > 60) n++;
  return { n, bg: [bd[0], bd[1], bd[2]] };
}, [x, y, bx, by]);

await page.click('#toolbar [data-tab="edit"]');
const [X0, Y0] = await bosNokta();
const BG0 = await ev(() => window.dwgApp.state.prims.filter(p => p.bg).length);   // dosyadan gelen maskeler (DWG WIPEOUT)
await zoom([X0 - 50, Y0 - 50, X0 + 700, Y0 + 700]);

// ---------------------------------------------------------------------------------
// 1 · ALIGN tek çift: yalnız öteleme (kaynak → hedef); Bitir ile 2 noktada uygulanır
// ---------------------------------------------------------------------------------
{
  const [k] = await ekle([{ type: 'LINE', pts: [[X0, Y0, 0], [X0 + 100, Y0, 0]] }]);
  await secKeys([k]);
  await arac('t:align');
  const d0 = await durum();
  ok('1a ALIGN: seçim hazır → 1. kaynak noktası istenir; Ölçek düğmesi çubukta', d0.active === 'align' && d0.step === 1 && !d0.selecting && d0.btns.includes('alignscale') && /kaynak|source/i.test(d0.text), J(d0));
  await tapWorld(X0, Y0);
  const d1 = await durum();
  ok('1b 1. kaynak alındı → 1. hedef istenir (adım 2)', d1.step === 2 && /hedef|destination/i.test(d1.text), J(d1));
  await tapWorld(X0 + 50, Y0 + 50);
  const d2 = await durum();
  ok('1c 1. hedef alındı → 2. kaynak ya da Bitir (adım 3)', d2.step === 3 && /Bitir|Finish/i.test(d2.text), J(d2));
  await bitir();
  const p = await prim(k);
  ok('1d Bitir: çizgi (+50, +50) ötelendi, döndürülmedi; araç bitti', p && yak(p.ops[0][1], X0 + 50) && yak(p.ops[0][2], Y0 + 50) && yak(p.ops[1][1], X0 + 150) && yak(p.ops[1][2], Y0 + 50) && !(await durum()).active, J([p && p.ops, await durum()]));
  await undo();
  const p2 = await prim(k);
  ok('1e geri alma çizgiyi yerine koyar', p2 && yak(p2.ops[0][1], X0, 1e-6) && yak(p2.ops[1][1], X0 + 100, 1e-6), J(p2 && p2.ops));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 2 · ALIGN iki çift, ölçek kapalı: öteleme + 90° döndürme; dördüncü noktada kendiliğinden uygulanır
// ---------------------------------------------------------------------------------
{
  const [k] = await ekle([{ type: 'LINE', pts: [[X0, Y0 + 200, 0], [X0 + 100, Y0 + 200, 0]] }]);
  await secKeys([k]);
  await arac('t:align');
  await tapWorld(X0, Y0 + 200);          // 1. kaynak
  await tapWorld(X0 + 300, Y0 + 200);    // 1. hedef
  await tapWorld(X0 + 100, Y0 + 200);    // 2. kaynak
  const d3 = await durum();
  ok('2a üç nokta alındı → 2. hedef istenir (adım 4)', d3.step === 4, J(d3));
  await tapWorld(X0 + 300, Y0 + 300);    // 2. hedef: kaynak doğrultusu +X, hedef doğrultusu +Y → 90°
  const p = await prim(k);
  ok('2b dördüncü noktada uygulandı: çizgi (X0+300, Y0+200) → (X0+300, Y0+300), 90° döndü, boy 100 (ölçek yok)', p && yak(p.ops[0][1], X0 + 300) && yak(p.ops[0][2], Y0 + 200) && yak(p.ops[1][1], X0 + 300) && yak(p.ops[1][2], Y0 + 300) && !(await durum()).active, J(p && p.ops));
  ok('2c ileti "Hizala uygulandı"', /hizala|align/i.test(await toast()) && /uyguland|applied/i.test(await toast()), await toast());
  await iptal();
}

// ---------------------------------------------------------------------------------
// 3 · ALIGN iki çift + Ölçek düğmesi: hedef aralığı / kaynak aralığı = 2 → çizgi 200 birim
// ---------------------------------------------------------------------------------
{
  const [k] = await ekle([{ type: 'LINE', pts: [[X0, Y0 + 400, 0], [X0 + 100, Y0 + 400, 0]] }]);
  await secKeys([k]);
  await arac('t:align');
  await page.click('#cmdBtns [data-cmd="alignscale"]'); await bekle(200);
  const sc = await ev(() => ({ on: window.dwgApp.editor.tools.alignScale, btn: !!document.querySelector('#cmdBtns [data-cmd="alignscale"].on') }));
  ok('3a Ölçek düğmesi açıldı (alignScale = true, düğme vurgulu)', sc.on && sc.btn, J(sc));
  // noktalar görüntü penceresinin ortasında kalır (sağ kenardaki gezinme düğmeleri dokunuşu yutar)
  await tapWorld(X0, Y0 + 400); await tapWorld(X0 + 150, Y0 + 450); await tapWorld(X0 + 100, Y0 + 400); await tapWorld(X0 + 350, Y0 + 450);
  const p = await prim(k);
  ok('3b ölçekli hizalama: çizgi (X0+150, Y0+450) → (X0+350, Y0+450), 2 kat', p && yak(p.ops[0][1], X0 + 150) && yak(p.ops[0][2], Y0 + 450) && yak(p.ops[1][1], X0 + 350) && yak(p.ops[1][2], Y0 + 450), J(p && p.ops));
  await shot('hizala_3');
  await iptal();
  // kaynak noktalar üst üste → hizalama kurulamadı iletisi, araç noktaları sıfırlar
  await secKeys([k]);
  await arac('t:align');
  await tapWorld(X0 + 150, Y0 + 450); await tapWorld(X0 + 150, Y0 + 550); await tapWorld(X0 + 150, Y0 + 450); await tapWorld(X0 + 250, Y0 + 550);
  const d = await durum();
  ok('3c çakışık kaynak noktaları: hata iletisi, araç 1. noktaya döner', /kurulamadı|yapılamadı|failed|üst üste|coincide/i.test(await toast()) && d.active === 'align' && d.step === 1, J([await toast(), d]));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 4 · WIPEOUT köşelerden: maske ilkeli (k=0, bg, kapalı); piksel düzeyinde çizgiyi örter; DRAWORDER öne alınca çizgi görünür
// ---------------------------------------------------------------------------------
let WK = null, LK = null;
{
  await zoom([X0, Y0 + 550, X0 + 400, Y0 + 850]);
  [LK] = await ekle([{ type: 'LINE', pts: [[X0 + 50, Y0 + 700, 0], [X0 + 350, Y0 + 700, 0]], color: 1 }]);
  await bekle(300);
  const b0 = await boya(X0 + 200, Y0 + 700, X0 + 20, Y0 + 830);
  ok('4a maske yokken çizgi merkezde görünüyor (arka plandan ayrışan piksel > 0)', b0.n > 0, J(b0));
  const n0 = await count();
  await arac('t:wipeout');
  const d0 = await durum();
  ok('4b WIPEOUT: köşe istemi, Polyline düğmesi çubukta', d0.active === 'wipeout' && d0.btns.includes('wipepoly') && /köşe|corner/i.test(d0.text), J(d0));
  await tapWorld(X0 + 100, Y0 + 600); await tapWorld(X0 + 300, Y0 + 600);
  const d2 = await durum();
  ok('4c iki köşeden sonra Polyline düğmesi kalkar, Bitir / Kapat istemi', !d2.btns.includes('wipepoly') && d2.step === 1, J(d2));
  await tapWorld(X0 + 300, Y0 + 800); await tapWorld(X0 + 100, Y0 + 800);
  await bitir();
  const P = await ev((n) => window.dwgApp.state.prims.slice(n).map(p => ({ key: p.key, k: p.k, bg: !!p.bg, fill: !!p.fill, closed: !!p.closed, et: p.et, n: p.ops ? p.ops.length : 0, bb: p.bb })), n0);
  WK = P.length ? P[0].key : null;
  ok('4d maske eklendi: tek ilkel, k=0, bg, dolu, kapalı, 4 köşe; sınır kutusu köşelerde', P.length === 1 && P[0].k === 0 && P[0].bg && P[0].fill && P[0].closed && P[0].n === 4 && yak(P[0].bb[0], X0 + 100) && yak(P[0].bb[3], Y0 + 800), J(P));
  ok('4e ileti "Maske eklendi"', /maske|wipeout/i.test(await toast()), await toast());
  await bekle(400);
  const b1 = await boya(X0 + 200, Y0 + 700, X0 + 20, Y0 + 830);
  const b2 = await boya(X0 + 75, Y0 + 700, X0 + 20, Y0 + 830);
  ok('4f maske çizgiyi ÖRTER: merkezde arka plan rengi (0 piksel), maskenin dışında çizgi görünür', b1.n === 0 && b2.n > 0, J({ ic: b1, dis: b2 }));
  await shot('maske_4');
  await runCmd({ op: 'draworder', keys: [LK], mode: 'front' });
  await bekle(400);
  const b3 = await boya(X0 + 200, Y0 + 700, X0 + 20, Y0 + 830);
  ok('4g çizgi öne alınınca maskenin üstünde görünür', b3.n > 0 && (await sira([LK, WK]))[0] > (await sira([LK, WK]))[1], J([b3, await sira([LK, WK])]));
  await undo(); await bekle(400);
  const b4 = await boya(X0 + 200, Y0 + 700, X0 + 20, Y0 + 830);
  ok('4h geri alma sırayı geri getirir: çizgi yine örtülü', b4.n === 0 && (await sira([LK, WK]))[0] < (await sira([LK, WK]))[1], J([b4, await sira([LK, WK])]));
  await runCmd({ op: 'draworder', keys: [WK], mode: 'back' });
  await bekle(400);
  const b5 = await boya(X0 + 200, Y0 + 700, X0 + 20, Y0 + 830);
  ok('4i maske arkaya gönderilince (dizinin başı) çizgi görünür', b5.n > 0 && (await sira([WK]))[0] === 0, J([b5, await sira([WK])]));
  await undo(); await bekle(200);
  await iptal();
}

// ---------------------------------------------------------------------------------
// 5 · WIPEOUTFRAME anahtarı: çerçeve kapalıyken maske kenarında çizgi kalmaz; açıkken kenar çizilir
// ---------------------------------------------------------------------------------
{
  await bekle(300);
  const e0 = await boya(X0 + 100, Y0 + 650, X0 + 20, Y0 + 830);   // sol kenar üzerinde
  await ev(() => window.dwgApp.editor.act('wipeframe')); await bekle(400);
  const st = await ev(() => window.dwgApp.state.wipeFrame);
  const e1 = await boya(X0 + 100, Y0 + 650, X0 + 20, Y0 + 830);
  ok('5a WIPEOUTFRAME kapandı: state.wipeFrame=false, ileti; kenar pikselleri arka plana döndü', st === false && /çerçeve|frame/i.test(await toast()) && e0.n > 0 && e1.n === 0, J({ st, e0, e1, t: await toast() }));
  await ev(() => window.dwgApp.editor.act('wipeframe')); await bekle(300);
  ok('5b yeniden açıldı', (await ev(() => window.dwgApp.state.wipeFrame)) === true, '');
}

// ---------------------------------------------------------------------------------
// 6 · WIPEOUT Polyline kipi: kapalı polyline'a dokun → silinsin mi? (evet) → maske girer, polyline kalkar (tek geri alma)
// ---------------------------------------------------------------------------------
{
  await zoom([X0 + 400, Y0 + 550, X0 + 800, Y0 + 850]);
  const [pk] = await ekle([{ type: 'LWPOLYLINE', pts: [[X0 + 500, Y0 + 600, 0], [X0 + 700, Y0 + 600, 0], [X0 + 700, Y0 + 780, 0], [X0 + 500, Y0 + 780, 0]], closed: true }]);
  const n0 = await count();
  await arac('t:wipeout');
  await page.click('#cmdBtns [data-cmd="wipepoly"]'); await bekle(200);
  const d0 = await ev(() => ({ poly: window.dwgApp.editor.tools.wipePoly, obj: window.dwgApp.editor.tools.wantsObject(), text: document.getElementById('cmdText').textContent.trim() }));
  ok('6a Polyline düğmesi: nesne istemi açık (wipePoly, wantsObject)', d0.poly && d0.obj, J(d0));
  await queueAnswers(page, true);                  // "Polyline silinsin mi?" → evet
  await tapWorld(X0 + 600, Y0 + 600);              // alt kenarın ortası
  const P = await ev((n) => window.dwgApp.state.prims.slice(n).map(p => ({ key: p.key, bg: !!p.bg, n: p.ops ? p.ops.length : 0, bb: p.bb })), n0 - 1);
  const gone = !(await prim(pk));
  ok('6b maske polyline\'dan üretildi (4 köşe, aynı kutu), polyline silindi', P.some(p => p.bg && p.n === 4 && yak(p.bb[0], X0 + 500, 1e-6) && yak(p.bb[3], Y0 + 780, 1e-6)) && gone, J([P, gone]));
  await undo();
  ok('6c tek geri alma: polyline geri, maske kalktı', !!(await prim(pk)) && !(await ev((n) => window.dwgApp.state.prims.slice(n).some(p => p.bg), n0)), '');
  await iptal();
  // kapalı olmayan nesne → "kapalı polyline değil" iletisi
  const [lk] = await ekle([{ type: 'LINE', pts: [[X0 + 450, Y0 + 820, 0], [X0 + 750, Y0 + 820, 0]] }]);
  await arac('t:wipeout');
  await page.click('#cmdBtns [data-cmd="wipepoly"]'); await bekle(200);
  await tapWorld(X0 + 600, Y0 + 820);
  ok('6d açık çizgi maske olmaz: uyarı, ilkel eklenmedi', /kapalı|closed/i.test(await toast()) && (await count()) === n0 + 1, J([await toast(), await count(), n0]));
  await iptal();
  await runCmd({ op: 'delete', keys: [lk] });
}

// ---------------------------------------------------------------------------------
// 7 · DRAWORDER aracı: form (öne) · üstüne / altına başvuru nesnesi · kendine başvuru uyarısı · seçim menüsü · TEXTTOFRONT / HATCHTOBACK
// ---------------------------------------------------------------------------------
{
  await zoom([X0 - 50, Y0 - 50, X0 + 700, Y0 + 700]);
  const [A, B, Cc] = await ekle([
    { type: 'LINE', pts: [[X0, Y0 + 500, 0], [X0 + 100, Y0 + 500, 0]] },
    { type: 'LINE', pts: [[X0, Y0 + 520, 0], [X0 + 100, Y0 + 520, 0]] },
    { type: 'LINE', pts: [[X0, Y0 + 540, 0], [X0 + 100, Y0 + 540, 0]] },
  ]);
  const s0 = await sira([A, B, Cc]);
  ok('7a eklenme sırası A < B < C', s0[0] < s0[1] && s0[1] < s0[2], J(s0));
  await secKeys([A]);
  await queueAnswers(page, { mode: 'front' });
  await arac('t:draworder');
  await bekle(300);
  const s1 = await sira([A, B, Cc]);
  ok('7b araç: form "Öne" → A dizinin sonuna (C\'nin üstüne); ileti; araç bitti', s1[0] > s1[2] && s1[0] === (await count()) - 1 && !(await durum()).active && /sıra|order/i.test(await toast()), J([s1, await toast()]));
  await iptal();
  await secKeys([A]);
  await queueAnswers(page, { mode: 'below' });
  await arac('t:draworder');
  await bekle(300);
  const d = await ev(() => ({ dro: window.dwgApp.editor.tools.dro, step: window.dwgApp.editor.tools.step, obj: window.dwgApp.editor.tools.wantsObject(), text: document.getElementById('cmdText').textContent.trim() }));
  ok('7c "Altına": başvuru nesnesi istenir (nesne istemi)', d.dro === 'below' && d.step === 1 && d.obj && /başvuru|reference/i.test(d.text), J(d));
  await tapWorld(X0 + 50, Y0 + 500);   // A'nın kendisi → uyarı, araç sürer
  ok('7d kendine başvuru: uyarı, araç sürüyor', /başvuru|reference|kendisi|itself/i.test(await toast()) && (await durum()).active === 'draworder', J([await toast(), await durum()]));
  await tapWorld(X0 + 50, Y0 + 520);   // B → A, B'nin hemen altına
  const s2 = await sira([A, B, Cc]);
  ok('7e B\'ye dokununca A, B\'nin hemen altına girer (A = B − 1); araç bitti', s2[0] === s2[1] - 1 && !(await durum()).active, J(s2));
  await runCmd({ op: 'draworder', keys: [Cc], mode: 'above', ref: A });
  const s3 = await sira([A, B, Cc]);
  ok('7f "Üstüne" komutu: C, A\'nın hemen üstüne (C = A + 1)', s3[2] === s3[0] + 1, J(s3));
  await undo();
  ok('7g geri alma: eski sıra', J(await sira([A, B, Cc])) === J(s2), J(await sira([A, B, Cc])));
  // seçim menüsü kartları: Öne getir / Arkaya gönder
  await secKeys([B]);
  await ev(() => window.dwgApp.editor.act('toback')); await bekle(200);
  ok('7h "Arkaya gönder" (menü kartı / TOBACK): B dizinin başında', (await sira([B]))[0] === 0, J(await sira([B])));
  await secKeys([B]);
  await ev(() => window.dwgApp.editor.act('tofront')); await bekle(200);
  ok('7i "Öne getir" (TOFRONT): B dizinin sonunda', (await sira([B]))[0] === (await count()) - 1, J(await sira([B])));
  // TEXTTOFRONT / HATCHTOBACK
  const [tk] = await ekle([{ type: 'TEXT', pts: [[X0, Y0 + 600, 0]], text: 'ÜST', h: 8 }]);
  const [sk] = await ekle([{ type: 'SOLID', pts: [[X0 + 200, Y0 + 500, 0], [X0 + 300, Y0 + 500, 0], [X0 + 300, Y0 + 600, 0], [X0 + 200, Y0 + 600, 0]] }]);
  const [lk] = await ekle([{ type: 'LINE', pts: [[X0 + 200, Y0 + 550, 0], [X0 + 300, Y0 + 550, 0]] }]);
  await ev(() => window.dwgApp.editor.act('texttofront')); await bekle(200);
  const st = await sira([tk, sk, lk]);
  ok('7j TEXTTOFRONT: yazı dizinin sonuna geçti (dolgu ve çizginin üstüne)', st[0] === (await count()) - 1 && st[0] > st[2], J(st));
  await ev(() => { window.dwgApp.display.setDisplay('hatchBack', true); });
  await ev(() => window.dwgApp.editor.act('hatchtoback')); await bekle(200);
  const sh = await sira([sk, lk]);
  const nFill = await ev(() => window.dwgApp.state.prims.filter(p => p.k === 0 && p.fill && !p.bg && (p.et === 'HATCH' || p.et === 'SOLID' || p.et === 'TRACE')).length);
  const hb = await ev(() => window.dwgApp.state.hatchBack);
  ok('7k HATCHTOBACK: dolgu, dosyadaki öteki dolgularla birlikte dizinin başına (indis < dolgu sayısı, çizginin altında); "taramalar arkada" görüntü ayarı kapatıldı (sıra artık diziden)', sh[0] < nFill && sh[0] < sh[1] && hb === false, J([sh, nFill, hb]));
  await shot('sira_7');
  await iptal();
}

// ---------------------------------------------------------------------------------
// 8 · DXF: WIPEOUT varlığı + CLASSES bölümü; günlük yeniden oynatma sırayı korur
// ---------------------------------------------------------------------------------
{
  const dxf = await ev(() => { const r = window.dwgApp.editor.dxfBase64(false); return r ? decodeURIComponent(escape(atob(r.b64))) : ''; });
  const cnt = (re) => (dxf.match(re) || []).length;
  ok('8a DXF: CLASSES bölümünde WIPEOUT sınıfı, ENTITIES\'te dosyadakiler + bir WIPEOUT (4 köşe + kapanış, 91 = 5)', /\n2\r\nCLASSES\r\n[\s\S]*?\n1\r\nWIPEOUT\r\n/.test(dxf) && cnt(/\n0\r\nWIPEOUT\r\n/g) === BG0 + 1 && /\n0\r\nWIPEOUT\r\n[\s\S]*?\n91\r\n5\r\n/.test(dxf), J({ wipe: cnt(/\n0\r\nWIPEOUT\r\n/g), BG0, cls: /CLASSES/.test(dxf) }));
  const keys = await ev(() => window.dwgApp.state.prims.slice(-6).map(p => p.key));
  await openFile(page, `${SM}/example_2000.dwg`, { settle: 600 });
  const keys2 = await ev(() => window.dwgApp.state.prims.slice(-6).map(p => p.key));
  const wipe = await ev(() => window.dwgApp.state.prims.filter(p => p.bg).length);
  ok('8b dosya yeniden açılınca günlük oynar: son altı ilkelin sırası aynı, maske geri geldi', J(keys) === J(keys2) && wipe === BG0 + 1, J([keys, keys2, wipe, BG0]));
}

await browser.close();
await srv.kill();
C.summary(errors);
C.exit();
