// Kilit rozeti sözleşmesi (v7.31): kilitli özellik GİZLENMEZ, işaretlenir.
//   kilitli(kimlik) ⇔ el.hasAttribute('data-need') ⇔ el.querySelector('.lk') ⇔ !Ed.has(kimlik)
// Beklenen kümeler ELLE YAZILMAZ; her denetim Ed.has() / Ed.need() ile karşılaştırılır, böylece
// FEATURE_TIER değiştiğinde sınama kendiliğinden doğru kalır.
// Kapsam: dört basamakta bütün yüzeyler, Super'de sıfır rozet, düzenin sabitliği, rengin
// belirteçten gelmesi (altı tema), biçim (yuvarlak değil / düğme değil), kilitli karonun ölü
// olmaması, kilitli sekmenin vitrin olması, bayat rozet olmaması, ayar, dil, RTL ve paket paneli.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_lock.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import path from 'node:path';

const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];
const TIERS = ['free', 'adfree', 'premium', 'super'];
const PRICES = {
  adfree: { monthly: '₺39,99', yearly: '₺299,99' },
  premium: { monthly: '₺249,99', yearly: '₺1.699,99' },
  super: { monthly: '₺399,99', yearly: '₺2.199,99' },
};
/** Sahte köprü: basamak window.__setEd ile değişir (test_edition.mjs kalıbı) */
const fakeBridge = (prices) => {
  let ed = 'free';
  window.Android = {
    edition: () => ed,
    proInfo: () => JSON.stringify({ edition: ed, source: ed === 'free' ? 'none' : 'play', name: '', exp: 0, plan: 'monthly', prices, billingReady: true, licenseEnabled: true }),
    buyPro() {}, restorePro() {}, activateLicense: () => false,
    adsAvailable: () => ed === 'free', showAd() {}, openUrl() {},
    appVersion: () => '7.31', versionCode: () => '54', updateUrl: () => '', getPendingFile: () => '', getRecent: () => '[]', pickFile() {},
  };
  window.__setEd = (e) => { ed = e; window.dwgApp.onEdition(e, 'restored'); };
};
const hook = (page) => {
  page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
};

const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
await ctx.addInitScript(fakeBridge, PRICES);
const page = await ctx.newPage(); hook(page);
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
const setEd = async (e) => { await ev((x) => window.__setEd(x), e); await page.waitForTimeout(220); };

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
await openFile(page, path.join(SM, 'example_2018.dwg'), { settle: 500 });

// ---------------------------------------------------------------------------------
// 1) SÖZLEŞME — dört basamakta, bütün yüzeylerde
// ---------------------------------------------------------------------------------
/** Her denetim için kimlik → kilitli mi / damga doğru mu; bozuk olanların listesi döner */
const scan = () => ev(async () => {
  const Ed = await import('./edition.js');
  const bad = [];
  const check = (el, id, where) => {
    const lock = !Ed.has(id);
    const hasAttr = el.hasAttribute('data-need');
    const hasMark = !!el.querySelector('.lk');
    if (lock !== hasAttr || lock !== hasMark || (lock && el.dataset.need !== Ed.need(id))) {
      bad.push(`${where}:${id}(kilit=${lock} attr=${hasAttr}:${el.dataset.need || '-'} mark=${hasMark})`);
    }
  };
  document.querySelectorAll('#toolbar .tb-row [data-act]').forEach(b => check(b, b.dataset.act, 'karo'));
  document.querySelectorAll('#toolsGrid [data-tool]').forEach(b => check(b, b.dataset.tool, 'arac'));
  document.querySelectorAll('#moreMenu [data-act]').forEach(b => { if (b.dataset.act !== 'pro') check(b, b.dataset.act, 'menu'); });
  const dv = document.querySelector('#drivePanel [data-drive="upload"]'); if (dv) check(dv, 'driveUpload', 'drive');
  const eb = document.querySelector('[data-doc="edit"]'); if (eb) check(eb, 'docEdit', 'belge');
  const ab = document.getElementById('iaArea'); if (ab) check(ab, 'area3d', 'alan');
  const nb = document.getElementById('btnNew2'); if (nb) check(nb, 'new', 'yeni');
  // sekme: kendi kimliği kilitliyse rozetli olmalı (türetilmiş rozet ayrıca sınanır)
  document.querySelectorAll('#toolbar [data-tab]').forEach(b => {
    const id = b.dataset.tab;
    if (Ed.FEATURE_TIER.has(id) && !Ed.has(id) && b.dataset.need !== Ed.need(id)) bad.push('sekme:' + id);
  });
  return { bad, needs: document.querySelectorAll('[data-need]').length, marks: document.querySelectorAll('.lk').length };
});

const snap = {};
for (const e of TIERS) {
  await setEd(e);
  await ev(() => { window.dwgApp.home.show(); window.dwgApp.home.setTab('tools', true); });
  await page.waitForTimeout(150);
  const r = await scan();
  snap[e] = r;
  ok(`1 ${e}: kilitli ⇔ data-need ⇔ .lk sözleşmesi bütün yüzeylerde tutuyor`, r.bad.length === 0, r.bad.slice(0, 6).join(' | '));
  await page.screenshot({ path: `${out}/lock_${e}.png` });
  await ev(() => window.dwgApp.home.hide());
}
ok('2 Super pakette tek bir rozet kalmaz', snap.super.needs === 0 && snap.super.marks === 0, JSON.stringify(snap.super));
ok('3 rozet kümesi basamakla daralır (free ≥ adfree ≥ premium > super=0)',
  snap.free.needs >= snap.adfree.needs && snap.adfree.needs > snap.premium.needs && snap.premium.needs > 0 && snap.super.needs === 0,
  TIERS.map(x => x + ':' + snap[x].needs).join(' '));
ok('3b adfree = free (FEATURE_TIER\'da adfree isteyen özellik yok)', snap.free.needs === snap.adfree.needs, snap.free.needs + ' / ' + snap.adfree.needs);

// ---------------------------------------------------------------------------------
// 4) DÜZEN SABİT — karo ve sekme sayısı basamakla DEĞİŞMEZ
// ---------------------------------------------------------------------------------
{
  const counts = {};
  for (const e of TIERS) {
    await setEd(e);
    counts[e] = await ev(() => ({ tabs: document.querySelectorAll('#toolbar [data-tab]').length, tiles: document.querySelectorAll('#toolbar .tb-row [data-act]').length }));
  }
  const a = JSON.stringify(counts.free);
  ok('4 sekme ve karo sayısı dört basamakta birebir aynı (yalnız rozet sayısı değişir)',
    TIERS.every(e => JSON.stringify(counts[e]) === a), JSON.stringify(counts));
}

// ---------------------------------------------------------------------------------
// 5) RENK BELİRTEÇTEN GELİR — altı tema
// ---------------------------------------------------------------------------------
await setEd('free');
{
  const themes = ['dark', 'light', 'blueprint', 'sepia', 'hicontrast'];
  let bad = [];
  for (const th of themes) {
    const r = await ev((t) => {
      document.body.dataset.theme = t === 'dark' ? '' : t;
      const norm = (c) => { const m = String(c).match(/[\d.]+/g); return m ? m.slice(0, 3).map(n => Math.round(+n)).join(',') : c; };
      const probe = document.createElement('span'); document.body.appendChild(probe);
      const tok = (n) => { probe.style.color = getComputedStyle(document.body).getPropertyValue('--t-' + n).trim(); return norm(getComputedStyle(probe).color); };
      const want = { adfree: tok('adfree'), premium: tok('premium'), super: tok('super') };
      probe.remove();
      const bars = [...document.querySelectorAll('#toolbar .lk-bar')];
      const wrong = bars.filter(b => norm(getComputedStyle(b).backgroundColor) !== want[b.dataset.tier]).length;
      return { n: bars.length, wrong };
    }, th);
    if (!r.n || r.wrong) bad.push(`${th}:${r.wrong}/${r.n}`);
  }
  await ev(() => { document.body.dataset.theme = ''; document.body.classList.add('contrast'); });
  const cr = await ev(() => document.querySelectorAll('#toolbar .lk-bar').length);
  await ev(() => document.body.classList.remove('contrast'));
  ok('5 kilit şeridinin rengi altı temada da --t-* belirtecinden gelir (sabit renk yok)', bad.length === 0 && cr > 0, bad.join(' '));
}
{
  const raw = await (await fetch(srv.url + 'app.css')).text();
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');   // yorumlar ayıklanır: "silindi" notu kuralın kendisi sanılmasın
  // Rozet kurallarının hiçbirinde sabit renk olmamalı; #f59e0b .tool-c3 simge gradyanında meşru durur.
  const lkRules = css.split('}').filter(b => /\.lk[-\s{.,:]|\[data-need/.test(b));
  const hex = lkRules.filter(b => /#[0-9a-fA-F]{3,8}\b/.test(b));
  ok('5b rozet kurallarında sabit renk yok ve eski .pro-badge kuralı kalmadı',
    hex.length === 0 && !/\.tool \.pro-badge/.test(css) && !/rtl"\] \.tool \.pro-badge/.test(css) && lkRules.length > 5,
    hex.slice(0, 2).join(' | '));
}

// ---------------------------------------------------------------------------------
// 6) BİÇİM — yuvarlak değil, düğme değil, "etkin" göstergesiyle çakışmaz
// ---------------------------------------------------------------------------------
{
  const r = await ev(() => {
    const lk = [...document.querySelectorAll('.lk')];
    return {
      n: lk.length,
      round: lk.filter(e => /50%/.test(getComputedStyle(e).borderRadius)).length,
      btn: lk.filter(e => e.tagName === 'BUTTON').length,
      hidden: lk.filter(e => e.getAttribute('aria-hidden') !== 'true').length,
      onLocked: document.querySelectorAll('#toolbar .tb-row button[data-need].on').length,
      pe: lk.filter(e => getComputedStyle(e).pointerEvents !== 'none').length,
    };
  });
  ok('6 rozet: yuvarlak değil, <button> değil, aria-hidden, dokunuşu yutmaz; kilitli karo hiç "etkin" olmaz',
    r.n > 0 && r.round === 0 && r.btn === 0 && r.hidden === 0 && r.onLocked === 0 && r.pe === 0, JSON.stringify(r));
  const vh = await ev(() => { const b = document.querySelector('#toolbar .tb-row button[data-need]'); return b ? { need: b.dataset.need, name: (b.textContent || '').replace(/\s+/g, ' ').trim(), aria: b.hasAttribute('aria-label') } : null; });
  ok('6b kilitli karonun erişilebilir adı içerikten kurulur (aria-label ezmez) ve kilit cümlesini taşır',
    vh && !vh.aria && /paketinde bulunur/.test(vh.name), JSON.stringify(vh));
}

// ---------------------------------------------------------------------------------
// 7) KİLİTLİ KARO ÖLÜ DEĞİL — tıklanır, uzun basılır, panel odaklanır
// ---------------------------------------------------------------------------------
{
  const dis = await ev(() => { const b = document.getElementById('tbUndo'); return b ? b.disabled : null; });
  ok('7 ücretsizde tbUndo rozetli ama disabled DEĞİL (disabled düğme click/pointerdown üretmez)', dis === false, String(dis));
  await ev(() => { const b = document.querySelector('#toolbar .tb-row [data-act="pdf"]'); window.dwgApp.editor.showTilePopForTest ? 0 : b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); });
  await page.waitForTimeout(620);
  const pop = await ev(() => { const p = document.getElementById('tbPop'); return p && !p.hidden ? { lock: !!p.querySelector('.pop-lock'), tier: (p.querySelector('.pop-lock .lk-pill') || {}).dataset?.tier, pro: !!p.querySelector('[data-pop="pro"]'), txt: p.textContent.replace(/\s+/g, ' ').trim() } : null; });
  ok('7b kilitli karoya uzun basış: kutuda paket hapı + "…paketinde bulunur." + Paketlere bak düğmesi',
    pop && pop.lock && pop.tier === 'premium' && pop.pro && /paketinde bulunur/.test(pop.txt), JSON.stringify(pop));
  if (pop && pop.pro) {
    await page.click('#tbPop [data-pop="pro"]'); await page.waitForTimeout(200);
    const f = await ev(() => { const p = document.getElementById('proPanel'); return { open: !p.hidden, focus: [...p.querySelectorAll('.tier-card.focus')].map(c => c.dataset.tier) }; });
    ok('7c kutudaki düğme paket panelini GEREKEN kartta odaklı açar', f.open && JSON.stringify(f.focus) === JSON.stringify(['premium']), JSON.stringify(f));
    await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(80);
  }
}

// ---------------------------------------------------------------------------------
// 8) VİTRİN — kilitli sekme satırı açar, panel AÇMAZ; annot artık boş değil
// ---------------------------------------------------------------------------------
{
  await page.click('#toolbar [data-tab="draw"]'); await page.waitForTimeout(200);
  const r = await ev(() => {
    const row = document.querySelector('#toolbar .tb-row[data-for="draw"]');
    return { tab: window.dwgApp.editor.tab, panel: !document.getElementById('proPanel').hidden,
      tiles: row.querySelectorAll('[data-act]').length, locked: row.querySelectorAll('[data-act][data-need]').length,
      cta: row.querySelectorAll('.lk-cta').length, ctaTier: (row.querySelector('.lk-cta') || {}).dataset?.tier,
      first: row.firstElementChild.classList.contains('tb-lockg') };
  });
  ok('8 kilitli Çiz sekmesi satırı açar, paket panelini AÇMAZ; 13 karo rozetli, tek çağrı karosu BAŞTA',
    r.tab === 'draw' && !r.panel && r.tiles === 13 && r.locked === 13 && r.cta === 1 && r.ctaTier === 'premium' && r.first, JSON.stringify(r));
  await page.click('#toolbar [data-tab="annot"]'); await page.waitForTimeout(180);
  const a = await ev(() => { const row = document.querySelector('#toolbar .tb-row[data-for="annot"]'); return { empty: !!row.querySelector('.tb-empty'), tiles: row.querySelectorAll('[data-act]').length, txt: row.textContent }; });
  // Karo sayısı sabit yazılmaz: sekmeye yeni araç eklendiğinde sınama yanlış kırmızı verirdi.
  // Denetlenecek şey sayı değil DAVRANIŞtır — satır boş görünmemeli ve "favEmpty" metni çıkmamalı.
  ok('8b Açıklama sekmesi artık boş değil (eskiden bütün karolar elenip yanlış "favEmpty" metni çıkıyordu)',
    !a.empty && a.tiles >= 15 && !/uzun basarak/.test(a.txt), JSON.stringify({ empty: a.empty, tiles: a.tiles }));
  // 9) çağrı karosu: kutu açmadan panel
  await page.click('#toolbar .tb-row[data-for="annot"] .lk-cta'); await page.waitForTimeout(220);
  const p = await ev(() => { const el = document.getElementById('proPanel'); return { open: !el.hidden, focus: [...el.querySelectorAll('.tier-card.focus')].map(c => c.dataset.tier) }; });
  ok('9 satır çağrı karosu: kutu olmadan paket paneli, gereken kartta odaklı', p.open && JSON.stringify(p.focus) === JSON.stringify(['premium']), JSON.stringify(p));
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(80);
  await page.click('#toolbar [data-tab="view"]'); await page.waitForTimeout(120);
}

// ---------------------------------------------------------------------------------
// 10) DİL — hap data-i18n ile, kilit cümlesi syncLockText ile tazelenir
// ---------------------------------------------------------------------------------
{
  const read = () => ev(() => {
    const m = document.querySelector('#moreMenu [data-act="notes"] .lk-pill');
    const vh = document.querySelector('#toolbar .lk-vh');
    const dv = document.querySelector('#drivePanel [data-drive="upload"]');
    return { pill: m ? m.textContent.trim() : '', vh: vh ? vh.textContent.trim() : '', aria: dv ? dv.getAttribute('aria-label') : '' };
  });
  const tr = await read();
  await ev(async () => { const I = await import('./i18n.js'); I.setLang('en'); I.applyI18n(); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: 'en' } })); });
  await page.waitForTimeout(250);
  const en = await read();
  await ev(async () => { const I = await import('./i18n.js'); I.setLang('tr'); I.applyI18n(); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: 'tr' } })); });
  await page.waitForTimeout(250);
  const tr2 = await read();
  ok('10 dil değişiminde hap, kilit cümlesi ve simge düğmesinin adı birlikte tazelenir',
    tr.pill === 'Premium' && /paketinde bulunur/.test(tr.vh) && /paketinde bulunur/.test(tr.aria)
    && en.pill === 'Premium' && /Included in|Only in|Premium/.test(en.vh) && !/paketinde bulunur/.test(en.vh) && !/paketinde bulunur/.test(en.aria)
    && tr2.vh === tr.vh, JSON.stringify({ tr, en, tr2 }));
}

// ---------------------------------------------------------------------------------
// 11) BAYAT ROZET YOK — satın alma sonrası rozet yeniden çizilmeden kalkar
// ---------------------------------------------------------------------------------
{
  await setEd('free');
  const before = await ev(() => {
    const dv = document.querySelector('#drivePanel [data-drive="upload"]');
    return { drive: dv ? dv.dataset.need || '' : '', newBtn: (document.getElementById('btnNew2') || {}).dataset?.need || '' };
  });
  await setEd('super');
  const after = await ev(() => {
    const dv = document.querySelector('#drivePanel [data-drive="upload"]');
    return { drive: dv ? dv.dataset.need || '' : '', newBtn: (document.getElementById('btnNew2') || {}).dataset?.need || '', marks: document.querySelectorAll('.lk').length };
  });
  // Beklenen basamak kapı tablosundan okunur; kademe yeniden konumlandığında sınama kendiliğinden uyar
  const bek = await ev(async () => { const Ed = await import('./edition.js'); const m = {}; for (const [id, x] of Ed.FEATURE_TIER) m[id] = x; return { drive: m.driveUpload, yeni: m.new }; });
  ok('11 yetki yükselince Drive ve "Yeni dosya" rozetleri YENİDEN ÇİZİLMEDEN kalkar (bayat rozet yalan söylemez)',
    before.drive === bek.drive && before.newBtn === bek.yeni && after.drive === '' && after.newBtn === '' && after.marks === 0,
    JSON.stringify({ before, after, bek }));
  await setEd('free');
}

// ---------------------------------------------------------------------------------
// 12) AYAR — showLocked yalnız ŞERİDİ etkiler
// ---------------------------------------------------------------------------------
{
  await ev(async () => { const E = await import('./editor.js'); E.ui.showLocked = false; window.dwgApp.editor.rebuild(); });
  await page.waitForTimeout(250);
  const off = await ev(() => ({ tabs: [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab), tileNeeds: document.querySelectorAll('#toolbar [data-need]').length, cta: document.querySelectorAll('#toolbar .lk-cta').length, menu: document.querySelectorAll('#moreMenu [data-need]').length }));
  ok('12 showLocked=false → şerit eski hâline döner (draw/edit yok, rozet yok), menü rozetli KALIR',
    !off.tabs.includes('draw') && !off.tabs.includes('edit') && off.tileNeeds === 0 && off.cta === 0 && off.menu > 0, JSON.stringify(off));
  await ev(async () => { const E = await import('./editor.js'); E.ui.showLocked = true; window.dwgApp.editor.rebuild(); });
  await page.waitForTimeout(250);
  const on = await ev(() => ({ tabs: document.querySelectorAll('#toolbar [data-tab]').length, needs: document.querySelectorAll('#toolbar [data-need]').length }));
  ok('12b showLocked=true → geri gelir', on.tabs === 7 && on.needs > 0, JSON.stringify(on));
}

// ---------------------------------------------------------------------------------
// 13) DOKUNMA HEDEFİ ve TAŞMA — dar ekran, eldiven, %130 yazı
// ---------------------------------------------------------------------------------
{
  await page.setViewportSize({ width: 360, height: 640 });
  await ev(async () => { const E = await import('./editor.js'); E.ui.glove = true; E.ui.fontScale = 1.3; E.applyUi(); window.dwgApp.editor.rebuild(); });
  await page.waitForTimeout(300);
  const r = await ev(() => {
    const bad = [];
    document.querySelectorAll('#toolbar .tb-row button').forEach(b => {
      const r0 = b.getBoundingClientRect(); if (r0.width < 1) return;
      if (r0.width < 40 || r0.height < 40) bad.push('kucuk:' + (b.dataset.act || b.dataset.lk));
      const lk = b.querySelector('.lk-bar'); if (!lk) return;
      const r1 = lk.getBoundingClientRect();
      if (r1.right > r0.right + 0.5 || r1.left < r0.left - 0.5 || r1.top < r0.top - 0.5 || r1.bottom > r0.bottom + 0.5) bad.push('tasma:' + b.dataset.act);
    });
    return { bad, over: document.getElementById('toolbar').scrollWidth > 0 };
  });
  ok('13 eldiven + %130 yazı + 360 px: her karo ≥ 40×40 ve kilit şeridi karodan taşmıyor', r.bad.length === 0, r.bad.slice(0, 6).join(' '));
  await ev(async () => { const E = await import('./editor.js'); E.ui.glove = false; E.ui.fontScale = 1; E.applyUi(); window.dwgApp.editor.rebuild(); });
  await page.setViewportSize({ width: PHONE.viewport.width, height: PHONE.viewport.height });
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------------
// 14) PAKET PANELİ — sayaç dökümle birebir, toplam 65, Ad-Free'de sayaç yok
// ---------------------------------------------------------------------------------
{
  await ev(() => window.dwgApp.openProPanel());
  await page.waitForTimeout(250);
  const r = await ev(async () => {
    const Ed = await import('./edition.js');
    const p = document.getElementById('proPanel');
    const counts = {}, lists = {};
    p.querySelectorAll('.tier-card').forEach(c => { const n = c.querySelector('.tier-count'); counts[c.dataset.tier] = n ? Number((n.textContent.match(/\d+/) || [0])[0]) : 0; });
    p.querySelectorAll('.lk-all-g').forEach(g => { lists[g.dataset.tier] = g.querySelectorAll('li').length; });
    return { counts, lists, total: p.querySelectorAll('.lk-all li').length, cap: Ed.capabilityList().length, title: !!p.querySelector('.lk-all .opt-title') };
  });
  // Sayaç KÜMÜLATİFtir: Super kartı, Premium'un açtıklarını da açar. Okuyucu dökümdeki grupları
  // toplayarak doğrulayabilir — Premium = 63, Super = 63 + 14 = 77. (Beş özellik v7.48'de
  // Super'den Premium'a indi; driveShare, webdavWrite, target3, hatchpat ve layeredit eklendi: 65 → 70;
  // budama, uzatma, kavis, pah ve köşe tutamağı ile 70 → 75; gelişmiş kalem desteği ile 75 → 76;
  // ölçü özelliklerini düzenleme (t:dimedit, v7.56) ile 76 → 77.
  // Kalem TANIMA ve AVUÇ REDDİ ücretsizdir, bu yüzden sayaca girmez.)
  const cum = (x) => ['adfree', 'premium', 'super'].slice(0, ['adfree', 'premium', 'super'].indexOf(x) + 1).reduce((a, y) => a + (r.lists[y] || 0), 0);
  const same = ['premium', 'super'].every(x => r.counts[x] === cum(x));
  ok('14 kart sayacı dökümdeki grupların toplamıyla birebir aynı (Premium 63, Super 63+14=77); Ad-Free\'de sayaç yok',
    r.title && same && r.total === r.cap && r.counts.adfree === 0 && r.total === 77, JSON.stringify({ ...r, cumPremium: cum('premium'), cumSuper: cum('super') }));
  await page.screenshot({ path: `${out}/lock_panel.png` });

  /*
   * KART METNİ ↔ KAPI TUTARLILIĞI. Kartın madde listesi FEATURE_TIER'dan TÜREMEZ; ayrı
   * tierFeat_* anahtarlarından okunur (edition.js featureList). Yani kapı bir şey yapıp kart
   * başka bir şey söyleyebilir ve bunu hiçbir sınama yakalamıyordu. Rakiple hizalanan beş
   * özelliğin kapısı ile kartta durduğu yer burada birlikte sınanır.
   */
  const tut = await ev(async () => {
    const Ed = await import('./edition.js');
    const I = await import('./i18n.js');
    const t = (k) => I.t(k);
    const kapi = {};
    for (const [id, x] of Ed.FEATURE_TIER) kapi[id] = x;
    const mad = (x) => String(t('tierFeat_' + x)).split('|').map(v => v.trim().toLocaleLowerCase('tr'));
    return { kapi, premium: mad('premium'), super: mad('super') };
  });
  const BES = ['pdfcad', 'batch', 'compare', 'driveUpload', 'area3d'];
  ok('15a rakiple hizalanan beş özellik Premium kapısında',
    BES.every(k => tut.kapi[k] === 'premium'), BES.map(k => k + '=' + tut.kapi[k]).join(' '));
  ok('15b Super\'i ayıran iki özellik Super\'de kaldı (profil ve yalnız değişenleri teslim)',
    tut.kapi.profile === 'super' && tut.kapi.savedelta === 'super',
    `profile=${tut.kapi.profile} savedelta=${tut.kapi.savedelta}`);
  // Kartın sözü kapıyla aynı olmalı: Premium kartı bu dördünü saymalı, Super kartı artık saymamalı
  const gecer = (liste, ip) => liste.some(v => v.includes(ip));
  ok('15c Premium kartı karşılaştırma, PDF→CAD, Drive ve yanal alanı sayıyor',
    ['karşılaştırma', 'pdf→cad', 'drive', 'yanal alan'].every(ip => gecer(tut.premium, ip)),
    tut.premium.join(' | '));
  ok('15d Super kartı artık karşılaştırma ve Drive vaat etmiyor',
    !gecer(tut.super, 'karşılaştırma') && !gecer(tut.super, 'drive'), tut.super.join(' | '));
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------------
// 15) RTL — Arapça arayüzde rozet karodan taşmaz, hap satır sonunda durur
// ---------------------------------------------------------------------------------
{
  await ev(async () => { const I = await import('./i18n.js'); await I.setLang('ar'); I.applyI18n(); window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: 'ar' } })); });
  await page.waitForTimeout(500);
  await ev(() => { const m = document.getElementById('moreMenu'); if (m) m.hidden = false; });   // gizli öğenin dikdörtgeni 0×0'dır
  await page.waitForTimeout(150);
  const r = await ev(() => {
    const dir = document.documentElement.getAttribute('dir');
    const bad = [];
    document.querySelectorAll('#toolbar .tb-row button > .lk-bar').forEach(lk => {
      const b = lk.parentElement.getBoundingClientRect(), r1 = lk.getBoundingClientRect();
      if (r1.left < b.left - 0.5 || r1.right > b.right + 0.5) bad.push(lk.parentElement.dataset.act);
    });
    const m = document.querySelector('#moreMenu [data-act="notes"]');
    const mp = m && m.querySelector('.lk-pill');
    const onRight = mp ? (mp.getBoundingClientRect().left - m.getBoundingClientRect().left) < (m.getBoundingClientRect().width / 2) : false;
    const mb = m ? m.getBoundingClientRect() : null;
    return { dir, bad, onRight, w: mb ? Math.round(mb.width) : 0, pill: mp ? mp.textContent.trim() : '' };
  });
  ok('15 RTL: kilit şeridi karodan taşmaz, menü hapı satırın sonunda (solda) durur', r.dir === 'rtl' && r.bad.length === 0 && r.w > 100 && r.onRight, JSON.stringify(r));
  await page.screenshot({ path: `${out}/lock_rtl.png` });
  await ev(() => { const m = document.getElementById('moreMenu'); if (m) m.hidden = true; });
  await ev(async () => { const I = await import('./i18n.js'); I.setLang('tr'); I.applyI18n(); });
  await page.waitForTimeout(200);
}

ok('16 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close();
srv.kill();
