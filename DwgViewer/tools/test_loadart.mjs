// Bekleme görselleri (#loading .loadart): çeşit seçimi, yılan oyununun zaman çizgisi, durgun kip
// ve biçem kuralları. Bu görsellerin bugüne dek sınaması yoktu; sözleşme burada sabitlenir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_loadart.mjs [çıktı]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const KINDS = ['cad', 'doc', 'out', 'd3', 'cloud'];
const DUR = 4400;   // yılan görselinin döngü süresi (app.css ile aynı olmalı)

// ---------------------------------------------------------------------------------
// A) Biçem kuralları (kaynak taraması)
// ---------------------------------------------------------------------------------
const css = fs.readFileSync(path.join(process.cwd(), 'app/src/main/assets/viewer/app.css'), 'utf8');
// Bölüm sınırları açıklama satırlarında yazar; önce ham metinde bulunur, sonra açıklamalar
// silinir — yoksa içlerindeki Türkçe sözcükler CSS özelliği sanılır.
const anim = css.slice(css.indexOf('BEKLEME ANİMASYONLARI'), css.indexOf('KİLİT ROZETİ'))
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

/** @keyframes gövdelerini parantez sayarak çıkarır (tek satırlık kural da, çok satırlı da) */
function keyframeBodies(src) {
  const out = [];
  const re = /@keyframes\s+[\w-]+\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let derinlik = 1, i = re.lastIndex;
    while (i < src.length && derinlik > 0) {
      if (src[i] === '{') derinlik++;
      else if (src[i] === '}') derinlik--;
      i++;
    }
    out.push(src.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
  }
  return out;
}
{
  const bodies = keyframeBodies(anim);
  ok('A1 bekleme görsellerinde keyframe var', bodies.length >= 20, String(bodies.length));
  // Yalnız transform / opacity / stroke-* canlandırılır: ötekiler düzen ya da boya tetikler.
  const IZIN = /^(transform|opacity|stroke-dashoffset|stroke-dasharray|fill-opacity|stroke-opacity)$/;
  const kotu = [];
  for (const b of bodies) for (const m of b.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)) {
    const prop = m[2];
    if (!IZIN.test(prop)) kotu.push(prop);
  }
  ok('A2 yalnız transform / opacity / stroke-* canlandırılıyor (düzen ve boya tetiklenmiyor)',
    kotu.length === 0, [...new Set(kotu)].join(' '));
  const hex = [...anim.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  ok('A3 sabit renk yok (hepsi :root belirtecinden)', hex.length === 0, hex.join(' '));
  ok('A4 yılan döngüsü ile sınamanın süresi aynı', anim.includes(DUR / 1000 + 's'), String(DUR));
}

// ---------------------------------------------------------------------------------
// B) Tarayıcıda: çeşit seçimi ve yılanın zaman çizgisi
// ---------------------------------------------------------------------------------
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
  await page.waitForTimeout(80);
  const r = await vis();
  ok(`B2 load-${k}: yalnız kendi görseli açık, dönen gösterge kapalı`,
    r.art && !r.spin && r.la.length === 1 && r.la[0] === k, JSON.stringify(r));
}

/** Döngüyü verilen yüzdede dondurur ve görünen parçaları okur */
const at = (pct) => ev((ms) => {
  document.querySelectorAll('#loading .la-cad, #loading .la-cad *').forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }));
  const q = (s) => document.querySelector('#loading .la-cad ' + s);
  const eff = (el) => { if (!el) return 0; let o = Number(getComputedStyle(el).opacity); const g = el.closest('g'); if (g && g !== el) o *= Number(getComputedStyle(g).opacity); return o; };
  const seen = (el) => eff(el) > 0.02;
  const num = (el, p) => parseFloat(getComputedStyle(el)[p]) || 0;
  const tr = q('.trail');
  return {
    plan: eff(q('.plan')), snake: eff(q('.snake')), smile: eff(q('.smile')),
    trailOff: num(tr, 'strokeDashoffset'),
    snakeLen: parseFloat(getComputedStyle(q('.snake')).strokeDasharray) || 0,
    pel: ['p1', 'p2', 'p3', 'p4'].map(c => seen(q('.' + c))),
    face: seen(q('.face')), mouth: seen(q('.mouth')), eyes: getComputedStyle(q('.eye')).transform,
  };
}, Math.round(DUR * pct / 100));

await ev(() => { document.getElementById('loading').className = 'modal load-cad'; });
await page.waitForTimeout(80);
{
  const a = await at(2);
  ok('B3 başlangıç: dört yem de duruyor, iz henüz çizilmemiş, yılan kısa (7)',
    a.pel.every(Boolean) && a.trailOff > 94 && Math.round(a.snakeLen) === 7, JSON.stringify(a.pel) + ' off=' + a.trailOff.toFixed(1) + ' L=' + a.snakeLen);

  // Yem, başın oradan geçtiği anda kaybolmalı: yol yüzdesi 20 · 42 · 62 · 85 → zaman 11,6 · 24,4 · 36 · 49,3
  const yeme = [[11.6, 0], [24.4, 1], [36, 2], [49.3, 3]];
  for (const [t, i] of yeme) {
    const before = await at(t - 2), after = await at(t + 3);
    ok(`B4 ${i + 1}. yem tam başın geçtiği anda yeniyor (%${t})`,
      before.pel[i] === true && after.pel[i] === false, `önce=${before.pel[i]} sonra=${after.pel[i]}`);
  }
  const grow = [await at(5), await at(20), await at(30), await at(45), await at(55)];
  const lens = grow.map(g => Math.round(g.snakeLen));
  ok('B5 yılan her yemde beş birim uzuyor: 7 → 12 → 17 → 22 → 27',
    JSON.stringify(lens) === JSON.stringify([7, 12, 17, 22, 27]), lens.join(' → '));

  const done = await at(60);
  ok('B6 %58\'de plan tamamlanmış (iz sonuna kadar çizili) ve yem kalmamış',
    done.trailOff < 0.5 && done.pel.every(x => !x) && done.plan > 0.9, `off=${done.trailOff} plan=${done.plan}`);

  const hand = await at(78);
  ok('B7 devir teslim: plan sönmüş, yılan ile yüz çemberi bir an birlikte (kıvrılma okunur)',
    hand.plan < 0.1 && hand.snake > 0.1 && hand.face === true, JSON.stringify({ plan: +hand.plan.toFixed(2), snake: +hand.snake.toFixed(2), face: hand.face }));

  const grin = await at(93);
  ok('B8 sonda gülen surat: çember, ağız ve gözler var; plan ile yılan gitmiş',
    grin.smile > 0.9 && grin.face && grin.mouth && grin.eyes !== 'matrix(0, 0, 0, 0, 0, 0)' && grin.plan < 0.05 && grin.snake < 0.05,
    JSON.stringify({ smile: +grin.smile.toFixed(2), face: grin.face, mouth: grin.mouth, eyes: grin.eyes, plan: +grin.plan.toFixed(2) }));

  // Yuvarlak uç başlığı tuzağı: gizli yol tamamen ötelenmiş olsa bile ucunda nokta bırakır
  const early = await at(40);
  ok('B9 ağız çizilmeden önce hiç görünmüyor (yuvarlak uç başlığı noktası kalmıyor)', early.mouth === false);
}

// ---------------------------------------------------------------------------------
// C) Durgun kip: hareket yok ama resim BİLGİ VEREN son hâlinde
// ---------------------------------------------------------------------------------
{
  await ev(() => { document.body.classList.add('reduce-motion'); document.getElementById('loading').className = 'modal load-cad'; });
  await page.waitForTimeout(150);
  const r = await ev(() => {
    const q = (s) => document.querySelector('#loading .la-cad ' + s);
    const eff = (el) => { let o = Number(getComputedStyle(el).opacity); const g = el.closest('g'); if (g && g !== el) o *= Number(getComputedStyle(g).opacity); return o; };
    const running = [...document.querySelectorAll('#loading .la-cad, #loading .la-cad *')]
      .flatMap(el => el.getAnimations()).filter(a => a.playState === 'running').length;
    return { running, trailOff: parseFloat(getComputedStyle(q('.trail')).strokeDashoffset) || 0,
      plan: eff(q('.plan')), snake: eff(q('.snake')), smile: eff(q('.smile')), pel: eff(q('.p1')) };
  });
  ok('C1 durgun kipte hiçbir animasyon koşmuyor', r.running === 0, String(r.running));
  ok('C2 durgun kip BİLGİ VEREN son hâl: plan tam çizili, yem/yılan/surat gizli',
    r.trailOff === 0 && r.plan > 0.9 && r.snake < 0.05 && r.smile < 0.05 && r.pel < 0.05, JSON.stringify(r));
  await page.screenshot({ path: `${out}/durgun.png` });
  await ev(() => document.body.classList.remove('reduce-motion'));
}

ok('D sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
