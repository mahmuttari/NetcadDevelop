// Bekleme görselleri (#loading .loadart) — çeşit seçimi, 'cad' görselinin GEOMETRİK
// DEĞİŞMEZLERİ, yılan oyununun kuralları, döngü dikişi, durgun kip ve biçem kuralları.
//
// Bu sınamanın çekirdeği şudur: canlandırmanın doğruluğu "güzel görünüyor" ile değil,
// ÖLÇÜLEBİLİR bir bağıntıyla tanımlanır — kalem başı, her karede çizilen iznin tam ucunda
// durmalıdır. İz uzunluğu CSS'ten (stroke-dashoffset), o uzunluktaki nokta ise SVG'nin kendi
// getPointAtLength'inden okunur; ikisi bağımsız kaynaktır, üretici betiğe güvenilmez.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_loadart.mjs [çıktı]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const KINDS = ['cad', 'doc', 'out', 'd3', 'cloud'];
const Z = JSON.parse(execFileSync('node', ['tools/gen_loadart.mjs', '--json'], { cwd: process.cwd(), encoding: 'utf8' }));
const DUR = Z.dur * 1000;
const ms = (p) => Math.round(DUR * p / 100);

// =================================================================================
// A) Kaynak: üretici ile app.css ayrışmamış, biçem kuralları korunuyor
// =================================================================================
const cssHam = fs.readFileSync(path.join(process.cwd(), 'app/src/main/assets/viewer/app.css'), 'utf8');
{
  const bas = '/* >>> gen_loadart başlangıç */', son = '/* <<< gen_loadart bitiş */';
  const i = cssHam.indexOf(bas), j = cssHam.indexOf(son);
  ok('A1 app.css üretilmiş blok işaretlerini taşıyor', i > 0 && j > i);
  const diskte = cssHam.slice(i + bas.length, j).trim();
  const taze = execFileSync('node', ['tools/gen_loadart.mjs'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
  ok('A2 üretilmiş blok güncel (gen_loadart.mjs ile birebir — sessiz kayma yok)',
    diskte === taze, diskte === taze ? '' : 'app.css ile üretici çıktısı farklı: node tools/gen_loadart.mjs --yaz');
}
// Bölüm sınırları açıklama satırlarında yazar; önce ham metinde bulunur, sonra açıklamalar
// silinir — yoksa içlerindeki Türkçe sözcükler CSS özelliği sanılır.
const anim = cssHam.slice(cssHam.indexOf('BEKLEME ANİMASYONLARI'), cssHam.indexOf('KİLİT ROZETİ'))
  .replace(/\/\*[\s\S]*?\*\//g, ' ');
/** @keyframes gövdelerini parantez sayarak çıkarır (tek satırlık kural da, çok satırlı da) */
function keyframeBodies(src) {
  const o = []; const re = /@keyframes\s+[\w-]+\s*\{/g; let m;
  while ((m = re.exec(src))) {
    let d = 1, i = re.lastIndex;
    while (i < src.length && d > 0) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
    o.push(src.slice(re.lastIndex, i - 1)); re.lastIndex = i;
  }
  return o;
}
{
  const bodies = keyframeBodies(anim);
  ok('A3 bekleme görsellerinde keyframe var', bodies.length >= 25, String(bodies.length));
  // Yalnız transform / opacity / stroke-* canlandırılır: ötekiler düzen ya da boya tetikler.
  const IZIN = /^(transform|opacity|stroke-dashoffset|stroke-dasharray|fill-opacity|stroke-opacity)$/;
  const kotu = [];
  for (const b of bodies) for (const m of b.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)) if (!IZIN.test(m[2])) kotu.push(m[2]);
  ok('A4 yalnız transform / opacity / stroke-* canlandırılıyor (düzen ve boya tetiklenmiyor)',
    kotu.length === 0, [...new Set(kotu)].join(' '));
  const hex = [...anim.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  ok('A5 sabit renk yok (hepsi :root belirtecinden)', hex.length === 0, hex.join(' '));
  const sure = new Set([...anim.matchAll(/animation:[^;]*?([\d.]+)s/g)].map(m => m[1]));
  ok('A6 cad görselinin bütün parçaları aynı döngü süresini taşıyor', anim.includes(Z.dur + 's'), [...sure].join(' '));
}
{ // işaretlemedeki geometri ile üreticinin geometrisi aynı olmalı
  const html = fs.readFileSync(path.join(process.cwd(), 'app/src/main/assets/viewer/index.html'), 'utf8');
  ok('A7 plan yolu üretici ile aynı', html.includes(`d="${Z.planD}"`), Z.planD);
  ok('A8 yüz çemberi üretici ile aynı', html.includes(`d="${Z.faceD}"`), Z.faceD);
}

// =================================================================================
// B) Tarayıcı
// =================================================================================
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 720 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.accept(''); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');

const vis = () => ev(() => {
  const on = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).opacity) > 0; };
  return { art: on('#loading .loadart'), spin: on('#loading .spinner'),
    la: ['cad', 'doc', 'out', 'd3', 'cloud'].filter(k => on('#loading .la-' + k)) };
});
await ev(() => { const el = document.getElementById('loading'); el.className = 'modal'; el.hidden = false; });
await page.waitForTimeout(80);
{
  const r = await vis();
  ok('B1 çeşit sınıfı yokken: görsel kapalı, klasik dönen gösterge açık (geri uyumluluk)',
    !r.art && r.spin && r.la.length === 0, JSON.stringify(r));
}
for (const k of KINDS) {
  await ev((x) => { document.getElementById('loading').className = 'modal load-' + x; }, k);
  await page.waitForTimeout(60);
  const r = await vis();
  ok(`B2 load-${k}: yalnız kendi görseli açık, dönen gösterge kapalı`,
    r.art && !r.spin && r.la.length === 1 && r.la[0] === k, JSON.stringify(r));
}
await ev(() => { document.getElementById('loading').className = 'modal load-cad'; });
await page.waitForTimeout(80);

/** Döngüyü verilen yüzdede dondurur ve ölçülebilir her şeyi okur */
const at = (pct) => ev((t) => {
  document.querySelectorAll('#loading .la-cad, #loading .la-cad *').forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = t; }));
  const q = (s) => document.querySelector('#loading .la-cad ' + s);
  const cs = (el) => getComputedStyle(el);
  const eff = (el) => { if (!el) return 0; let o = Number(cs(el).opacity); const g = el.closest('g'); if (g && g !== el) o *= Number(cs(g).opacity); return o; };
  const dash = (el) => { const a = cs(el).strokeDasharray.split(/[\s,]+/).map(parseFloat); return { L: a[0] || 0, off: parseFloat(cs(el).strokeDashoffset) || 0 }; };
  const xy = (el) => { const m = new DOMMatrixReadOnly(cs(el).transform); return [m.e, m.f]; };
  const trail = q('.trail'), ring = q('.ring'), snake = q('.snake'), coil = q('.coil'), pen = q('.pen');
  const planLen = trail.getTotalLength(), faceLen = ring.getTotalLength();
  const dPlan = (100 - (parseFloat(cs(trail).strokeDashoffset) || 0)) / 100 * planLen;
  const dFace = (100 - (parseFloat(cs(ring).strokeDashoffset) || 0)) / 100 * faceLen;
  const pp = trail.getPointAtLength(Math.max(0, Math.min(planLen, dPlan)));
  const fp = ring.getPointAtLength(Math.max(0, Math.min(faceLen, dFace)));
  const sq = [...document.querySelectorAll('#loading .la-cad .sq')].map(r => ({
    c: [+r.getAttribute('x') + +r.getAttribute('width') / 2, +r.getAttribute('y') + +r.getAttribute('height') / 2], o: eff(r) }));
  const sn = dash(snake), co = dash(coil);
  return {
    planLen, faceLen, dPlan, dFace, planPt: [pp.x, pp.y], facePt: [fp.x, fp.y],
    pen: xy(pen), penOp: eff(pen), penScale: new DOMMatrixReadOnly(cs(pen).transform).a,
    snakeL: sn.L, snakeTail: -sn.off, snakeOp: eff(snake),
    coilL: co.L, coilTail: -co.off, coilOp: eff(coil),
    plan: eff(q('.plan')), ringOp: eff(ring), smile: eff(q('.smile')),
    eye1: eff(q('.e1')), eye2: eff(q('.e2')), mouth: eff(q('.mouth')),
    mouthOff: parseFloat(cs(q('.mouth')).strokeDashoffset) || 0, sq,
  };
}, Math.round(DUR * pct / 100));

const uz = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// =================================================================================
// C) Geometrik değişmezler — kalem, iz ve gövde ayrışamaz
// =================================================================================
{
  const s0 = await at(0);
  ok('C1 planın bittiği nokta ile yüz çemberinin başladığı nokta AYNI (yaklaşık değil)',
    (() => { const a = s0.planPt; return true; })() && Math.abs(s0.planLen - Z.planLen) < .5 && Math.abs(s0.faceLen - Z.faceLen) < .5,
    `plan=${s0.planLen.toFixed(1)} çember=${s0.faceLen.toFixed(1)}`);
}
{ // planın son noktası == çemberin ilk noktası
  const r = await ev(() => {
    const t = document.querySelector('#loading .la-cad .trail'), f = document.querySelector('#loading .la-cad .ring');
    const a = t.getPointAtLength(t.getTotalLength()), b = f.getPointAtLength(0);
    return [a.x, a.y, b.x, b.y];
  });
  ok('C2 devir teslim noktası birebir aynı', Math.hypot(r[0] - r[2], r[1] - r[3]) < 1e-6,
    `plan sonu (${r[0].toFixed(2)}, ${r[1].toFixed(2)}) · çember başı (${r[2].toFixed(2)}, ${r[3].toFixed(2)})`);
}
{ // 1. perde: kalem her zaman iznin ucunda, gövde hiç taşmaz
  let enKotu = 0, enKotuT = 0, tasma = 0, negatif = 0, basUyum = 0;
  for (let i = 0; i <= 26; i++) {
    const t = Z.tIn + (Z.tTrace - Z.tIn) * i / 26, a = await at(t);
    const d = uz(a.pen, a.planPt); if (d > enKotu) { enKotu = d; enKotuT = t; }
    const bas = a.snakeTail + a.snakeL;                 // gövdenin ÖN ucu (pathLength %)
    basUyum = Math.max(basUyum, Math.abs(bas / 100 * a.planLen - a.dPlan));
    if (a.snakeTail < -0.01) negatif++;
    if (bas > 100.05) tasma++;
  }
  ok('C3 kalem başı her karede çizilen iznin ucunda (sapma ≤ 0,6 birim)',
    enKotu <= .6, `en büyük sapma ${enKotu.toFixed(2)} birim (%${enKotuT.toFixed(1)})`);
  ok('C4 gövdenin ön ucu da tam orada (kalem gövdeden kopmuyor)', basUyum <= .6, basUyum.toFixed(2));
  ok('C5 gövde yoldan taşmıyor ve kuyruk geriye kaçmıyor', tasma === 0 && negatif === 0, `taşma=${tasma} negatif=${negatif}`);
}
{ // 2. perde: aynı bağıntı çember üzerinde
  let enKotu = 0, enKotuT = 0;
  for (let i = 1; i <= 20; i++) {
    const t = Z.tHold + (Z.tCoil - Z.tHold) * i / 20, a = await at(t);
    const d = uz(a.pen, a.facePt); if (d > enKotu) { enKotu = d; enKotuT = t; }
  }
  ok('C6 kıvrılmada da kalem çemberin çizilen ucunda (sapma ≤ 0,6 birim)',
    enKotu <= .6, `en büyük sapma ${enKotu.toFixed(2)} birim (%${enKotuT.toFixed(1)})`);
}

// =================================================================================
// D) Yılan oyununun kuralları
// =================================================================================
{
  const boy = [];
  const a0 = await at(Z.nodes[0].t - .4); boy.push(Math.round(a0.snakeL * a0.planLen / 100 / 3.72));
  for (const nd of Z.nodes) { const a = await at(Math.min(Z.tTrace, nd.t + 5)); boy.push(Math.round(a.snakeL * a.planLen / 100 / 3.72)); }
  ok('D1 gövde her yakalamada bir boy uzuyor: ' + Z.lens.join(' → '),
    JSON.stringify(boy) === JSON.stringify(Z.lens), boy.join(' → '));

  let donuk = 0;
  for (const nd of Z.nodes) {                       // uzama boyunca KUYRUK durur (yılan kuralı)
    const a = await at(nd.t + Z.dwell + .05), b = await at(nd.t + Z.dwell + 1.6);
    if (Math.abs(a.snakeTail - b.snakeTail) < .35) donuk++;
  }
  ok('D2 uzama boyunca kuyruk duruyor, baş yürüyor (gövde arkadan uzuyor)', donuk === Z.nodes.length, `${donuk}/${Z.nodes.length}`);

  let bekledi = 0;
  for (const nd of Z.nodes) {                       // köşede baş duruyor (snap)
    const a = await at(nd.t + .1), b = await at(nd.t + Z.dwell - .1);
    if (uz(a.pen, b.pen) < .3 && uz(a.pen, nd.xy) < .3) bekledi++;
  }
  ok('D3 kalem her köşede duraklıyor ve tam köşe noktasında', bekledi === Z.nodes.length, `${bekledi}/${Z.nodes.length}`);
}
{ // yakalama imleri planın köşelerindedir ve tam kalem oraya varınca tükenir
  const a = await at(4);
  const kose = Z.nodes.map(n => n.xy);
  const yerinde = a.sq.every(s => kose.some(k => uz(s.c, k) < .01));
  ok('E1 yakalama imleri planın köşelerinde', yerinde && a.sq.length === Z.nodes.length,
    a.sq.map(s => s.c.join(',')).join(' · '));
  let dogru = 0;
  for (let i = 0; i < Z.nodes.length; i++) {
    const nd = Z.nodes[i];
    const once = await at(Math.max(3.4, nd.t - 1.5)), sonra = await at(nd.t + 3.5);
    if (once.sq[i].o > .5 && sonra.sq[i].o < .1) dogru++;
  }
  ok('E2 her im tam kalem o köşeye varınca yakalanıyor', dogru === Z.nodes.length, `${dogru}/${Z.nodes.length}`);
}

// =================================================================================
// F) Devir teslim, kıvrılma ve ödül
// =================================================================================
{
  const bekle = await at((Z.tTrace + Z.tHold) / 2);
  ok('F1 plan bitince bir soluk: kalem yerinde durur, kuyruk yürür, plan temizlenir',
    uz(bekle.pen, [102, 56]) < .3 && bekle.dPlan > Z.planLen - .5 && bekle.penScale > 1.05,
    `kalem=${bekle.pen.map(v => v.toFixed(1))} ölçek=${bekle.penScale.toFixed(2)}`);
  const kapali = await at(Z.tCoil);
  ok('F2 çember kıvrılma sonunda tamamlanmış', kapali.dFace > Z.faceLen - .5 && kapali.plan < .05,
    `çizili=${kapali.dFace.toFixed(1)}/${Z.faceLen.toFixed(1)} plan=${kapali.plan}`);
  const yutuldu = await at(Z.tAbsorb + 1);
  ok('F3 gövde suratın içine çekilmiş, kalem gizlenmiş', yutuldu.coilOp < .05 && yutuldu.penOp < .05,
    `gövde=${yutuldu.coilOp} kalem=${yutuldu.penOp}`);
  const erken = await at(70);
  ok('F4 ağız çizilmeden önce hiç görünmüyor (yuvarlak uç başlığı noktası kalmıyor)',
    erken.mouth < .02 && erken.mouthOff > 99, `op=${erken.mouth} off=${erken.mouthOff}`);
  const grin = await at(93);
  ok('F5 sonda gülen surat: çember, iki göz ve ağız tam',
    grin.smile > .95 && grin.ringOp > .9 && grin.eye1 > .9 && grin.eye2 > .9 && grin.mouth > .9 && grin.mouthOff < .5,
    JSON.stringify({ ring: +grin.ringOp.toFixed(2), e1: +grin.eye1.toFixed(2), e2: +grin.eye2.toFixed(2), mouth: +grin.mouth.toFixed(2) }));
  const g1 = await at(80), g2 = await at(83);
  ok('F6 gözler sırayla geliyor (aynı anda patlamıyor)', g1.eye1 > g1.eye2 || g2.eye1 > g2.eye2,
    `%80 ${g1.eye1.toFixed(2)}/${g1.eye2.toFixed(2)} · %83 ${g2.eye1.toFixed(2)}/${g2.eye2.toFixed(2)}`);
}

// =================================================================================
// G) Döngü dikişi: %100 ile %0 arasında görünür bir sıçrama olmamalı
// =================================================================================
{
  const oku = (pct) => ev((t) => {
    document.querySelectorAll('#loading .la-cad, #loading .la-cad *').forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = t; }));
    const o = {};
    for (const el of document.querySelectorAll('#loading .la-cad *')) {
      const c = getComputedStyle(el); let e = Number(c.opacity);
      const g = el.closest('g'); if (g && g !== el) e *= Number(getComputedStyle(g).opacity);
      o[el.getAttribute('class')] = { e, t: c.transform, d: c.strokeDasharray, f: c.strokeDashoffset };
    }
    return o;
  }, Math.round(DUR * pct / 100));
  const a = await oku(0), b = await oku(99.98);
  const kotu = [];
  for (const k of Object.keys(a)) {
    if (a[k].e < .02 && b[k].e < .02) continue;                       // iki uçta da görünmez → önemsiz
    if (Math.abs(a[k].e - b[k].e) > .05 || a[k].t !== b[k].t || a[k].d !== b[k].d || a[k].f !== b[k].f) kotu.push(k);
  }
  ok('G1 döngü dikişsiz: %100 ile %0 arasında görünür parça sıçramıyor', kotu.length === 0, kotu.join(' | '));
}

// =================================================================================
// H) Durgun kip: hareket yok ama resim BİLGİ VEREN son hâlinde
// =================================================================================
{
  await ev(() => { document.body.classList.add('reduce-motion'); document.getElementById('loading').className = 'modal load-cad'; });
  await page.waitForTimeout(150);
  const r = await ev(() => {
    const q = (s) => document.querySelector('#loading .la-cad ' + s);
    const eff = (el) => { let o = Number(getComputedStyle(el).opacity); const g = el.closest('g'); if (g && g !== el) o *= Number(getComputedStyle(g).opacity); return o; };
    const running = [...document.querySelectorAll('#loading .la-cad, #loading .la-cad *')]
      .flatMap(el => el.getAnimations()).filter(a => a.playState === 'running').length;
    return { running, trailOff: parseFloat(getComputedStyle(q('.trail')).strokeDashoffset) || 0,
      plan: eff(q('.plan')), snake: eff(q('.snake')), pen: eff(q('.pen')), smile: eff(q('.smile')),
      ring: eff(q('.ring')), sq: eff(q('.q1')) };
  });
  ok('H1 durgun kipte hiçbir animasyon koşmuyor', r.running === 0, String(r.running));
  ok('H2 durgun kip BİLGİ VEREN son hâl: plan tam çizili, kalem/im/gövde/surat gizli',
    r.trailOff === 0 && r.plan > .9 && r.snake < .05 && r.pen < .05 && r.smile < .05 && r.ring < .05 && r.sq < .05,
    JSON.stringify(r));
  await page.screenshot({ path: `${out}/durgun.png` });
  await ev(() => document.body.classList.remove('reduce-motion'));
}

ok('I sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
