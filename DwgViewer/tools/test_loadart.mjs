// Bekleme görselleri (#loading .loadart) — çeşit seçimi, AŞAMALI 'cad' görselinin ilerlemeye
// bağlılığı, tema belirteçleri, durgun kip ve biçem kuralları.
//
// 'cad' görselinin sözleşmesi şudur: bir döngü değil, GERÇEK İLERLEMENİN resmidir. Çizim de
// başlık da aynı yüzdeden türer, dolayısıyla ikisi asla çelişemez — sınamanın çekirdeği budur.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_loadart.mjs [çıktı]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const KINDS = ['cad', 'doc', 'out', 'd3', 'cloud'];
const TEMA = ['dark', 'light', 'blueprint', 'sepia', 'hicontrast'];

// =================================================================================
// A) Kaynak taraması
// =================================================================================
const cssHam = fs.readFileSync(path.join(process.cwd(), 'app/src/main/assets/viewer/app.css'), 'utf8');
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
  ok('A1 bekleme görsellerinde keyframe var', bodies.length >= 12, String(bodies.length));
  // Yalnız transform / opacity / stroke-* canlandırılır: ötekiler düzen ya da boya tetikler.
  const IZIN = /^(transform|opacity|stroke-dashoffset|stroke-dasharray|fill-opacity|stroke-opacity)$/;
  const kotu = [];
  for (const b of bodies) for (const m of b.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)) if (!IZIN.test(m[2])) kotu.push(m[2]);
  ok('A2 yalnız transform / opacity / stroke-* canlandırılıyor (düzen ve boya tetiklenmiyor)',
    kotu.length === 0, [...new Set(kotu)].join(' '));
  const hex = [...anim.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  ok('A3 sabit renk yok (hepsi :root belirtecinden)', hex.length === 0, hex.join(' '));
  // 'cad' görseli sürekli dönmez; dönen yalnız nabız ile tarama olmalı
  const cad = anim.slice(anim.indexOf('.la-cad'), anim.indexOf('.la-doc'));
  const dongu = [...cad.matchAll(/animation:\s*([\w-]+)/g)].map(m => m[1]);
  ok('A4 cad görselinde yalnız nabız ve tarama döngüsü var; gerisi ilerlemeye bağlı',
    new Set(dongu).size <= 2 && dongu.every(d => /cadPulse|cadScan/.test(d)), [...new Set(dongu)].join(' '));
}

// =================================================================================
// B) Tarayıcı
// =================================================================================
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 780 } });
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

/** Yüzdeyi verir, aşama geçişi (220 ms) bitene dek bekler ve ölçülebilir her şeyi okur */
const at = async (pct) => { const r = await oku(pct); await page.waitForTimeout(300); return await oku(pct); };
const oku = (pct) => ev((v) => {
  document.getElementById('loading').hidden = false;
  window.dwgApp.__cadLoad(v, 'ornek.dwg · 12 MB');
  const el = document.getElementById('loading');
  const cs = (s) => getComputedStyle(document.querySelector('#loading .la-cad ' + s));
  const gor = (s) => { const e = document.querySelector('#loading .la-cad ' + s); if (!e) return 0;
    let o = Number(getComputedStyle(e).opacity); const g = e.closest('g.st'); if (g && g !== e) o *= Number(getComputedStyle(g).opacity); return o; };
  const w1 = document.querySelector('#loading .la-cad .w1');
  return {
    stage: el.dataset.cad, t: Number(getComputedStyle(el).getPropertyValue('--t')),
    baslik: document.getElementById('loadingText').textContent,
    altyazi: document.getElementById('loadingSub').textContent,
    dosya: document.getElementById('loadingFile').textContent,
    dosyaGizli: document.getElementById('loadingFile').hidden,
    bar: document.getElementById('loadingFill').style.width,
    yuzde: document.getElementById('loadingPct').textContent,
    noktaGizli: document.getElementById('loadingDots').hidden,
    etkinNokta: [...document.querySelectorAll('#loading .ldots > i')]
      .map(i => getComputedStyle(i).transform !== 'none' && getComputedStyle(i).transform !== 'matrix(1, 0, 0, 1, 0, 0)'),
    s: [0, 1, 2, 3, 4].map(k => gor('.s' + k)),
    planCizili: 100 - (parseFloat(cs('.w1').strokeDashoffset) || 0),
    bolmeCizili: 100 - (parseFloat(cs('.w2').strokeDashoffset) || 0),
    planBoy: w1 ? +w1.getTotalLength().toFixed(1) : 0,
    okCizili: 100 - (parseFloat(cs('.okmark').strokeDashoffset) || 0),
    levhaOlcek: cs('.ply').transform, dikmeOlcek: cs('.rise').transform,
  };
}, pct);

// =================================================================================
// C) Aşamalar: çizim ile başlık aynı yüzdeden türer
// =================================================================================
{
  const BEKLENEN = [
    [5, '0'], [29, '0'], [30, '1'], [49, '1'], [50, '2'], [71, '2'], [72, '3'], [96, '3'], [97, '4'], [100, '4'],
  ];
  let dogru = 0;
  const gorulen = [];
  for (const [p, st] of BEKLENEN) { const a = await at(p); gorulen.push(p + '→' + a.stage); if (a.stage === st) dogru++; }
  ok('C1 yüzde → aşama haritası tasarımdaki sınırlarla birebir (30 · 50 · 72 · 97)',
    dogru === BEKLENEN.length, gorulen.join(' '));

  let tekAsama = 0;
  for (const [p, st] of BEKLENEN) {
    const a = await at(p);
    if (a.s[+st] > .95 && a.s.filter((v, i) => i !== +st).every(v => v < .05)) tekAsama++;
  }
  ok('C2 her yüzdede YALNIZ kendi aşamasının çizimi görünür', tekAsama === BEKLENEN.length, `${tekAsama}/${BEKLENEN.length}`);

  const a0 = await at(10), a1 = await at(35), a2 = await at(60), a3 = await at(85), a4 = await at(100);
  const bas = [a0.baslik, a1.baslik, a2.baslik, a3.baslik, a4.baslik];
  ok('C3 başlık aşamayla değişiyor ve beşi de farklı', new Set(bas).size === 5, bas.join(' | '));
  ok('C4 her başlığın kendi alt yazısı var, ham anahtar sızmıyor',
    [a0, a1, a2, a3, a4].every(x => x.altyazi && !/^stg/.test(x.altyazi) && !/^stg/.test(x.baslik)),
    [a0.altyazi, a4.altyazi].join(' | '));
  ok('C5 sonda "hazır" metni geliyor', a4.baslik !== a3.baslik && /hazır/i.test(a4.baslik), a4.baslik);

  // aşama içi oran: --t aşamanın başında 0, sonunda 1'e yaklaşmalı
  const t0 = await at(72), t1 = await at(84), t2 = await at(96);
  ok('C6 aşama içindeki oran (--t) yüzdeyle artıyor',
    t0.t < .05 && t1.t > .4 && t1.t < .6 && t2.t > .9, `${t0.t} < ${t1.t} < ${t2.t}`);
}

// =================================================================================
// D) Çizim gerçekten ilerlemeye bağlı mı (döngü olsaydı bu denetimler geçmezdi)
// =================================================================================
{
  // Plan iki katmanda çizilir: önce dış duvar + orta bölme tek kalem darbesiyle (t 0→,62),
  // sonra iki iç bölme (t ,55→1). İkisi de kendi penceresinde adım adım ilerlemeli.
  const p1 = [];
  for (const v of [73, 77, 81, 87]) p1.push((await at(v)).planCizili);
  ok('D1a dış duvar tek kalem darbesiyle adım adım çiziliyor',
    p1.every((v, i) => i === 0 || v > p1[i - 1]) && p1[0] < 15 && p1[p1.length - 1] > 85,
    p1.map(v => Math.round(v) + '%').join(' → '));
  const p2 = [];
  for (const v of [88, 92, 96]) p2.push((await at(v)).bolmeCizili);
  ok('D1b iç bölmeler dış duvardan SONRA ve adım adım geliyor',
    (await at(75)).bolmeCizili < 5 && p2.every((v, i) => i === 0 || v > p2[i - 1]) && p2[p2.length - 1] > 85,
    p2.map(v => Math.round(v) + '%').join(' → '));

  const l1 = await at(32), l2 = await at(48);
  const say = (m) => Math.abs(Number((m.match(/matrix\(([^,]+),/) || [0, 1])[1] * 0 + (m.match(/matrix\([^,]+, [^,]+, [^,]+, ([^,]+)/) || [0, 1])[1]));
  ok('D2 katman levhaları yüzdeyle açılıyor', say(l1.levhaOlcek) < say(l2.levhaOlcek),
    `${l1.levhaOlcek} → ${l2.levhaOlcek}`);
  const g1 = await at(52), g2 = await at(70);
  ok('D3 geometri dikmeleri yüzdeyle yükseliyor', say(g1.dikmeOlcek) < say(g2.dikmeOlcek),
    `${g1.dikmeOlcek} → ${g2.dikmeOlcek}`);
  const o1 = await at(97), o2 = await at(100);
  ok('D4 onay imi sonda çiziliyor', o1.okCizili < 20 && o2.okCizili > 95,
    `${Math.round(o1.okCizili)}% → ${Math.round(o2.okCizili)}%`);
}

// =================================================================================
// E) Örtünün öteki parçaları: dosya satırı, çubuk, aşama noktaları
// =================================================================================
{
  const a = await at(64);
  ok('E1 dosya adı görselin üstünde ayrı satırda', a.dosya.includes('ornek.dwg') && !a.dosyaGizli, a.dosya);
  ok('E2 ilerleme çubuğu yüzdeyi gösteriyor', a.bar === '64%' && a.yuzde === '%64', `${a.bar} ${a.yuzde}`);
  ok('E3 aşama noktaları görünür ve yalnız bir tanesi etkin',
    !a.noktaGizli && a.etkinNokta.filter(Boolean).length === 1, JSON.stringify(a.etkinNokta));
  const son = await at(100);
  ok('E4 bitişte bütün noktalar yanıyor', son.etkinNokta.every(Boolean), JSON.stringify(son.etkinNokta));

  // Ölçülemeyen aşama: uydurma yüzde YOK
  await ev(() => { const el = document.getElementById('loading'); el.hidden = false;
    window.dwgApp.setLoading('Yükleniyor…', 'x.dwg', undefined, 'cad'); });
  await page.waitForTimeout(320);
  const r = await ev(() => {
    const el = document.getElementById('loading');
    return { cad: el.dataset.cad, prog: document.getElementById('loadingProg').hidden,
      dots: document.getElementById('loadingDots').hidden,
      s0: Number(getComputedStyle(document.querySelector('#loading .la-cad .s0')).opacity) };
  });
  ok('E5 yüzde bilinmiyorsa: çubuk ve noktalar gizli, görsel 0. aşamada durur (uydurma yüzde yok)',
    r.cad === undefined && r.prog && r.dots && r.s0 > .9, JSON.stringify(r));
}

// =================================================================================
// F) Tema belirteçleri: her temada tanımlı ve zeminden ayırt edilebilir
// =================================================================================
{
  const r = await ev((temalar) => temalar.map(tm => {
    document.body.setAttribute('data-theme', tm);
    const cs = getComputedStyle(document.body);
    const say = (v) => {                                   // belirteçler onaltılık yazılır
      const h = (v || '').trim();
      const m = /^#([0-9a-f]{6})$/i.exec(h);
      if (m) return [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16));
      const d = h.match(/\d+/g); return d ? d.slice(0, 3).map(Number) : null;
    };
    const L = (c) => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
    const hi = say(cs.getPropertyValue('--cad-hi')), dim = say(cs.getPropertyValue('--cad-dim')), pan = say(cs.getPropertyValue('--panel'));
    const kar = (a, b) => { const x = L(a) + .05, y = L(b) + .05; return +(Math.max(x, y) / Math.min(x, y)).toFixed(2); };
    return { tm, hi: !!hi, dim: !!dim, kHi: hi && pan ? kar(hi, pan) : 0, kDim: dim && pan ? kar(dim, pan) : 0 };
  }), TEMA);
  ok('F1 --cad-hi ve --cad-dim beş temada da tanımlı', r.every(x => x.hi && x.dim), JSON.stringify(r.map(x => x.tm + (x.hi && x.dim ? '✓' : '✗'))));
  ok('F2 iki renk de kart zemininden ayırt edilebiliyor (≥ 2,2:1)',
    r.every(x => x.kHi >= 2.2 && x.kDim >= 2.2), r.map(x => `${x.tm} ${x.kHi}/${x.kDim}`).join(' · '));
  await ev(() => document.body.removeAttribute('data-theme'));
}

// =================================================================================
// G) Durgun kip: döngüler durur, aşama resmi olduğu gibi kalır
// =================================================================================
{
  await ev(() => { document.body.classList.add('reduce-motion'); document.getElementById('loading').hidden = false; });
  await at(85);
  await page.waitForTimeout(120);
  const r = await ev(() => {
    const kosan = [...document.querySelectorAll('#loading .la-cad, #loading .la-cad *')]
      .flatMap(e => e.getAnimations()).filter(a => a.playState === 'running').length;
    const w1 = document.querySelector('#loading .la-cad .w1');
    return { kosan, plan: 100 - (parseFloat(getComputedStyle(w1).strokeDashoffset) || 0),
      s3: Number(getComputedStyle(document.querySelector('#loading .la-cad .s3')).opacity) };
  });
  ok('G1 durgun kipte hiçbir döngü koşmuyor', r.kosan === 0, String(r.kosan));
  ok('G2 durgun kipte de aşama resmi ilerlemeyi gösteriyor (bilgi kaybolmuyor)',
    r.s3 > .9 && r.plan > 50 && r.plan < 100, `aşama3=${r.s3} plan=%${Math.round(r.plan)}`);
  await page.screenshot({ path: `${out}/durgun.png` });
  await ev(() => document.body.classList.remove('reduce-motion'));
}

ok('H sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
