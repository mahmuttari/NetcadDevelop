// Bekleme görselleri (#loading .loadart) — çeşit seçimi, 'cad' açılış anlatısının KESİNTİSİZ
// DÖNGÜSÜ, gerçek ilerlemeyi gösteren metin/çubuk/noktalar, tema belirteçleri, durgun kip.
//
// Sözleşme iki parçalıdır ve ikisi BİRBİRİNDEN BAĞIMSIZDIR:
//   · Görsel kendi 9 s'lik döngüsünü baştan sona, kesintisiz ve sürekli tekrar ederek oynar.
//     İlerleme yüzdesine BAKMAZ — bağlandığında hızlı açılışta resimler sıçrıyor, yavaş
//     aşamada tek kare donuyordu; anlatı bozuluyordu.
//   · Nerede olunduğunu başlık, alt yazı, çubuk ve aşama noktaları söyler.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_loadart.mjs [çıktı]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const KINDS = ['cad', 'doc', 'out', 'd3', 'cloud'];
const TEMA = ['dark', 'light', 'blueprint', 'sepia', 'hicontrast'];
const DUR = 9000;                       // app.css --cadT ile aynı olmalı (A6 sınar)

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
  ok('A1 bekleme görsellerinde keyframe var', bodies.length >= 18, String(bodies.length));
  // Yalnız transform / opacity / stroke-* canlandırılır: ötekiler düzen ya da boya tetikler.
  const IZIN = /^(transform|opacity|stroke-dashoffset|stroke-dasharray|fill-opacity|stroke-opacity)$/;
  const kotu = [];
  for (const b of bodies) for (const m of b.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)) if (!IZIN.test(m[2])) kotu.push(m[2]);
  ok('A2 yalnız transform / opacity / stroke-* canlandırılıyor (düzen ve boya tetiklenmiyor)',
    kotu.length === 0, [...new Set(kotu)].join(' '));
  const hex = [...anim.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  ok('A3 sabit renk yok (hepsi :root belirtecinden)', hex.length === 0, hex.join(' '));

  // '.la-cad' 2. bölümdeki ortak kalem kuralında da geçer; kesit 3. bölümün kendi
  // başlangıcından (--cadT bildirimi) sonraki ilk '.la-doc'a kadar alınır.
  const bas = anim.indexOf('--cadT');
  const cad = anim.slice(bas, anim.indexOf('.la-doc', bas));
  const sure = [...cad.matchAll(/animation:\s*([\w-]+)\s+([^\s]+)/g)].map(m => [m[1], m[2]]);
  const anlati = sure.filter(([ad]) => ad !== 'cadPulse');
  ok('A4 anlatının bütün parçaları TEK saati paylaşıyor (perdeler ayrışamaz)',
    anlati.length >= 9 && anlati.every(([, s]) => s === 'var(--cadT)'),
    anlati.map(([a, s]) => a + ':' + s).join(' '));
  ok('A5 döngü süresi sınamadakiyle aynı', cad.includes('--cadT: ' + (DUR / 1000) + 's'), String(DUR));
  // Görsel ilerlemeye bağlanmamalı: data-cad yalnız aşama noktalarını sürer
  const cadSecici = [...anim.matchAll(/#loading\[data-cad="\d"\][^{]*/g)].map(m => m[0]);
  ok('A6 çizim data-cad\'e bakmıyor (yalnız aşama noktaları bakar)',
    cadSecici.length > 0 && cadSecici.every(s => s.includes('.ldots')), cadSecici.join(' | ').slice(0, 160));
}

// =================================================================================
// B) Tarayıcı — çeşit seçimi
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
await ev(() => { document.getElementById('loading').className = 'modal load-cad'; window.dwgApp.__cadLoad(46, 'ornek.dwg · 12 MB'); });
await page.waitForTimeout(80);

/** Döngüyü verilen yüzdede dondurur ve çizimin o karedeki hâlini okur */
const kare = (pct) => ev((ms) => {
  document.querySelectorAll('#loading .la-cad, #loading .la-cad *')
    .forEach(el => el.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }));
  const q = (s) => document.querySelector('#loading .la-cad ' + s);
  const cs = (s) => getComputedStyle(q(s));
  const say = (m) => { const v = (m.match(/matrix\(([^)]*)\)/) || [0, '1,0,0,1,0,0'])[1].split(',').map(Number); return v[3]; };
  return {
    s: [0, 1, 2, 3, 4].map(k => Number(cs('.s' + k).opacity)),
    w1: 100 - (parseFloat(cs('.w1').strokeDashoffset) || 0),
    w2: 100 - (parseFloat(cs('.w2').strokeDashoffset) || 0),
    crop: Number(cs('.crop').opacity),
    ok: 100 - (parseFloat(cs('.okmark').strokeDashoffset) || 0),
    ply: say(cs('.ply').transform), rise: say(cs('.rise').transform),
    scanY: (new DOMMatrixReadOnly(cs('.scan').transform)).f, scanOp: Number(cs('.scan').opacity),
  };
}, Math.round(DUR * pct / 100));

// =================================================================================
// C) Döngü: baştan sona, kesintisiz, sürekli
// =================================================================================
{
  const N = 60, kareler = [];
  for (let i = 0; i < N; i++) kareler.push(await kare(100 * i / N));

  // 1) Hiçbir anda ekran boş kalmamalı — kullanıcının "bütünlük" şikâyetinin ölçüsü budur
  // Ölçü TOPLAM görünürlüktür: geçiş ortasında iki perde 0,5/0,5 olabilir ama toplam 1
  // kalmalıdır. Toplam düşerse ekranda gerçekten bir sönüklük var demektir.
  const bos = kareler.map((k, i) => [Math.round(100 * i / N), k.s.reduce((a, b) => a + b, 0)]).filter(([, m]) => m < .85);
  ok('C1 döngünün HİÇBİR anında kare sönmüyor (perdeler birebir çakışarak devrediyor)',
    bos.length === 0, bos.map(([p, m]) => `%${p}:${m.toFixed(2)}`).join(' '));

  // 2) Perdeler sırayla ve yalnız bir tanesi baskın
  const bask = kareler.map(k => k.s.indexOf(Math.max(...k.s)));
  const sira = bask.filter((v, i) => i === 0 || v !== bask[i - 1]);
  // Son örnek dikişe düşerse baştaki perde yeniden baskın olur — döngü budur, kusur değil.
  const duz = sira[sira.length - 1] === 0 && sira.length === 6 ? sira.slice(0, 5) : sira;
  ok('C2 beş perde döngüde bir kez ve SIRAYLA geçiyor: 0 → 1 → 2 → 3 → 4',
    JSON.stringify(duz) === JSON.stringify([0, 1, 2, 3, 4]), sira.join(' → '));
  const ikili = kareler.filter(k => k.s.filter(v => v > .6).length > 1).length;
  ok('C3 aynı anda en fazla bir perde tam görünür (geçişler kısa)', ikili <= 3, String(ikili));

  // 3) Dikiş: %100 ile %0 aynı kare olmalı
  const a = await kare(0), b = await kare(99.9);
  const fark = Math.max(...a.s.map((v, i) => Math.abs(v - b.s[i])));
  ok('C4 döngü dikişsiz: %100 ile %0 aynı kareyi gösteriyor', fark < .08, fark.toFixed(3));
}

// =================================================================================
// D) Her perdenin kendi hareketi var (donuk resim değil)
// =================================================================================
{
  const t = async (p) => kare(p);
  const sc = [await t(4), await t(12)];
  ok('D1 pafta perdesinde tarama ışığı aşağı iniyor', sc[1].scanY > sc[0].scanY - 60 && (sc[0].scanOp > .5 || sc[1].scanOp > .5),
    `y ${sc[0].scanY.toFixed(0)} → ${sc[1].scanY.toFixed(0)}`);
  const p1 = [await t(22), await t(30), await t(38)];
  ok('D2 katman levhaları döngü içinde açılıyor', p1[0].ply < p1[1].ply && p1[1].ply < p1[2].ply,
    p1.map(x => x.ply.toFixed(2)).join(' → '));
  const p2 = [await t(42), await t(50), await t(57)];
  ok('D3 geometri dikmeleri döngü içinde yükseliyor', p2[0].rise < p2[1].rise && p2[1].rise < p2[2].rise,
    p2.map(x => x.rise.toFixed(2)).join(' → '));
  const p3 = [await t(56), await t(63), await t(70), await t(74)];
  ok('D4 plan TEK KALEM DARBESİYLE adım adım çiziliyor',
    p3.every((v, i) => i === 0 || v.w1 >= p3[i - 1].w1) && p3[0].w1 < 15 && p3[3].w1 > 95,
    p3.map(x => Math.round(x.w1) + '%').join(' → '));
  const p4 = [await t(74), await t(78), await t(82)];
  ok('D5 iç bölmeler dış duvardan SONRA geliyor', p4[0].w2 < 20 && p4[2].w2 > 90,
    p4.map(x => Math.round(x.w2) + '%').join(' → '));
  const p5 = [await t(86), await t(90), await t(94)];
  ok('D6 onay imi sonda çiziliyor', p5[0].ok < 30 && p5[2].ok > 95, p5.map(x => Math.round(x.ok) + '%').join(' → '));
}

// =================================================================================
// E) Görsel ilerlemeden BAĞIMSIZ, metin ise ilerlemeye BAĞLI
// =================================================================================
{
  const oku = async (pct, faz) => {
    await ev((v) => window.dwgApp.__cadLoad(v, 'ornek.dwg · 12 MB'), pct);
    return kare(faz);
  };
  const a = await oku(7, 66), b = await oku(93, 66);
  ok('E1 aynı döngü anında çizim, ilerleme yüzdesinden BAĞIMSIZ olarak aynı',
    JSON.stringify(a.s.map(v => v.toFixed(2))) === JSON.stringify(b.s.map(v => v.toFixed(2)))
    && Math.abs(a.w1 - b.w1) < .5,
    `%7 → ${a.s.map(v => v.toFixed(1))} · %93 → ${b.s.map(v => v.toFixed(1))}`);

  const metin = async (pct) => {
    await ev((v) => window.dwgApp.__cadLoad(v, 'ornek.dwg · 12 MB'), pct);
    await page.waitForTimeout(260);                     // nokta geçişi 0,2 s
    return ev(() => {
    return { baslik: document.getElementById('loadingText').textContent,
      alt: document.getElementById('loadingSub').textContent,
      dosya: document.getElementById('loadingFile').textContent,
      bar: document.getElementById('loadingFill').style.width,
      yuzde: document.getElementById('loadingPct').textContent,
      nokta: document.getElementById('loadingDots').hidden ? [] :
        [...document.querySelectorAll('#loading .ldots > i')]
          .map(i => +(new DOMMatrixReadOnly(getComputedStyle(i).transform)).a.toFixed(2)) };
  }); };
  const m = [];
  for (const p of [10, 35, 60, 85, 100]) m.push(await metin(p));
  ok('E2 başlık ilerlemeyle değişiyor ve beşi de farklı', new Set(m.map(x => x.baslik)).size === 5,
    m.map(x => x.baslik).join(' | '));
  ok('E3 her başlığın alt yazısı var, ham anahtar sızmıyor',
    m.every(x => x.alt && !/^stg/.test(x.alt) && !/^stg/.test(x.baslik)), m[0].alt + ' | ' + m[4].alt);
  ok('E4 çubuk ve yüzde gerçek ilerlemeyi gösteriyor',
    m[1].bar === '35%' && m[1].yuzde === '%35' && m[3].bar === '85%', `${m[1].bar} ${m[1].yuzde} ${m[3].bar}`);
  ok('E5 dosya adı görselin üstünde ayrı satırda', m[0].dosya.includes('ornek.dwg'), m[0].dosya);
  const buyuk = (a) => a.indexOf(Math.max(...a));
  ok('E6 aşama noktası ilerlemeyle ilerliyor ve bitişte hepsi yanıyor',
    buyuk(m[0].nokta) === 0 && buyuk(m[1].nokta) === 1 && buyuk(m[2].nokta) === 2 && buyuk(m[3].nokta) === 3
    && m[4].nokta.every(v => v > 1.2),
    m.map(x => x.nokta.join('/')).join(' · '));

  // Ölçülemeyen aşama: uydurma yüzde YOK ama görsel dönmeye devam eder
  // kare() ölçümleri animasyonları duraklatmıştı. Elle play() demek YETMEZ, hatta zararlıdır:
  // betikten sürdürülen bir CSS animasyonu CSS'ten kopar ve animation:none ile iptal olmaz —
  // ölçüldü, durgun kip denetimini sahte biçimde düşürüyordu. Doğrusu sayfayı tazelemektir.
  await page.reload();
  await page.waitForSelector('#btnOpen2');
  await ev(() => {
    const el = document.getElementById('loading'); el.hidden = false;
    window.dwgApp.setLoading('Yükleniyor…', 'x.dwg', undefined, 'cad');
  });
  await page.waitForTimeout(80);
  const r = await ev(() => ({
    cad: document.getElementById('loading').dataset.cad,
    prog: document.getElementById('loadingProg').hidden,
    dots: document.getElementById('loadingDots').hidden,
    kosan: [...document.querySelectorAll('#loading .la-cad, #loading .la-cad *')]
      .flatMap(e => e.getAnimations()).filter(a => a.playState === 'running').length,
  }));
  ok('E7 yüzde bilinmiyorsa çubuk ve noktalar gizli, ama görsel dönmeye DEVAM ediyor',
    r.cad === undefined && r.prog && r.dots && r.kosan > 5, JSON.stringify(r));
}

// =================================================================================
// F) Tema belirteçleri
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
// G) Durgun kip: hareket durur, ekranda BİLGİ VEREN kare kalır
// =================================================================================
{
  await ev(() => { document.body.classList.add('reduce-motion'); document.getElementById('loading').hidden = false; });
  await page.waitForTimeout(150);
  const r = await ev(() => {
    const q = (s) => getComputedStyle(document.querySelector('#loading .la-cad ' + s));
    const kosan = [...document.querySelectorAll('#loading .la-cad, #loading .la-cad *')]
      .flatMap(e => e.getAnimations()).filter(a => a.playState === 'running').length;
    return { kosan, s: [0, 1, 2, 3, 4].map(k => Number(q('.s' + k).opacity)),
      w1: 100 - (parseFloat(q('.w1').strokeDashoffset) || 0),
      w2: 100 - (parseFloat(q('.w2').strokeDashoffset) || 0), scan: Number(q('.scan').opacity) };
  });
  ok('G1 durgun kipte hiçbir animasyon koşmuyor', r.kosan === 0, String(r.kosan));
  ok('G2 durgun kipte kalan kare BİLGİ VERİR: plan perdesi açık ve plan tam çizili',
    r.s[3] > .9 && r.s.filter((v, i) => i !== 3).every(v => v < .05) && r.w1 > 99 && r.w2 > 99 && r.scan < .05,
    JSON.stringify(r));
  await page.screenshot({ path: `${out}/durgun.png` });
  await ev(() => document.body.classList.remove('reduce-motion'));
}

ok('H sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
