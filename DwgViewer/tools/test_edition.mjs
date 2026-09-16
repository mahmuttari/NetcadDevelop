// Pro yetkisi sınaması (tek uygulama, uygulama içi satın alma): Ücretsizde sekme / karo / menü gizleme, karşılama kartı,
// Pro paneli (#proPanel: fiyat, Satın al, Geri yükle, Lisans kodu), satın alma sonrası onEdition → şerit yeniden kurulur,
// lisans kodu akışı, gate() yükseltme kutusu → panel, reklam zamanlaması (sahte Android köprüsü: edition dinamik, proInfo,
// buyPro, restorePro, activateLicense, showAd) ve Pro'da (Android yok) hiçbir kısıt olmaması.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_edition.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers, askLog } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];
const hook = (page) => {
  page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
  onDialog(page, async d => { await d.accept('5'); });
};
const PRICE = '₺449,99';
/** Sahte fiyat çizelgesi: üç paket × iki dönem (Play'den gelen biçimli fiyatların yerine) */
const FAKE_PRICES = {
  adfree: { monthly: '₺39,99', yearly: '₺399,99' },
  premium: { monthly: '₺299,99', yearly: '₺2.999,99' },
  super: { monthly: PRICE, yearly: '₺4.499,99' },
};
/** Sahte köprü: basamak değişkendir (let ed); buyPro / activateLicense / restorePro dwgApp.onEdition ile sonuç bildirir */
const fakeBridge = ({ price, prices }) => {
  let ed = 'free', src = 'none', plan = '';
  const calls = (window.__adCalls = []), opened = (window.__opened = []), picks = (window.__picks = []), pro = (window.__proCalls = []);
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  const paid = () => ed !== 'free';
  window.Android = {
    edition: () => ed,
    proInfo: () => JSON.stringify({ edition: ed, source: paid() ? src : 'none', name: paid() && src === 'license' ? 'Deneme Kullanıcı' : '', exp: paid() && src === 'license' ? exp : 0, plan, prices: price ? prices : {}, billingReady: !!price, licenseEnabled: true }),
    buyPro: (t, pl) => { pro.push('buy:' + t + '/' + pl); ed = t; src = 'play'; plan = pl; setTimeout(() => window.dwgApp.onEdition(t, 'purchased'), 10); },
    restorePro: () => { pro.push('restore'); setTimeout(() => window.dwgApp.onEdition(ed, paid() ? 'restored' : 'none'), 10); },
    activateLicense: (c) => { pro.push('license:' + c); if (c !== 'DWGPRO-ok') return false; ed = 'super'; src = 'license'; plan = ''; window.dwgApp.onEdition('super', 'license'); return true; },
    adsAvailable: () => ed === 'free', showAd: (reason) => { calls.push(reason); }, openUrl: (u) => { opened.push(u); },
    appVersion: () => '7.1', versionCode: () => '24', updateUrl: () => 'https://ornek/version.json',
    getPendingFile: () => '', getRecent: () => '[]', pickFile: (p, m) => { picks.push([p, m]); },
  };
  window.__setEd = (e, s) => { ed = e; src = s || 'none'; if (e === 'free') plan = ''; };
};

// ---------------------------------------------------------------------------------
// 1) ÜCRETSİZ (sahte Android köprüsü + window.__edition)
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  await ctx.addInitScript(fakeBridge, { price: PRICE, prices: FAKE_PRICES });
  await ctx.addInitScript(() => { window.__edition = 'free'; });
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const calls = () => ev(() => window.__adCalls.slice());
  const panel = () => ev(() => { const p = document.getElementById('proPanel'); const q = (s) => p.querySelector(s); return { open: !p.hidden, vis: p.offsetParent !== null, title: p.querySelector('#proTitle').textContent.trim(), text: p.querySelector('#proBody').innerText, cards: [...p.querySelectorAll('.tier-card')].map(c => c.dataset.tier), owned: [...p.querySelectorAll('.tier-card.owned')].map(c => c.dataset.tier), dim: [...p.querySelectorAll('.tier-card.dim')].map(c => c.dataset.tier), buys: [...p.querySelectorAll('[data-pro="buy"]')].map(b => b.dataset.tier + '/' + b.dataset.plan), prices: [...p.querySelectorAll('[data-pro="buy"] .pr')].map(x => x.textContent.trim()), restore: !!q('[data-pro="restore"]'), license: !!q('[data-pro="license"]'), status: q('[data-pro-status]') ? q('[data-pro-status]').dataset.proStatus : null, note: q('[data-pro-note]') ? q('[data-pro-note]').dataset.proNote : null, features: p.querySelectorAll('.pro-features li').length }; });
  const tabs = () => ev(() => [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab));
  const toastText = () => ev(() => { const el = document.getElementById('toast'); return el.hidden ? '' : el.querySelector('.tx').textContent; });
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
  ok('1a sürüm: free', await ev(() => window.dwgApp.edition() === 'free' && window.dwgApp.isPro() === false && document.body.classList.contains('edition-free')));
  // karşılama kartı → Pro paneli
  {
    const r = await ev(() => { const p = document.getElementById('proLine'), b = document.getElementById('btnGoPro'); return { hidden: p.hidden, vis: !!(p && p.offsetParent), text: p.textContent.trim(), btn: !!b && b.offsetParent !== null, open2: !!document.getElementById('btnOpen2'), input: !!document.getElementById('fileInput') }; });
    ok('1b karşılama kartında #proLine ve Pro düğmesi görünür', !r.hidden && r.vis && r.btn && /Ücretsiz sürüm/.test(r.text) && /satın alarak/.test(r.text) && /reklamlar kalkar/.test(r.text) && r.open2 && r.input, JSON.stringify(r).slice(0, 200));
    await shot('free_welcome');
    ok('1b2 Pro paneli başta kapalı', await ev(() => document.getElementById('proPanel').hidden === true));
    await page.click('#btnGoPro'); await page.waitForTimeout(80);
    const p = await panel();
    ok('1c karşılama düğmesi → #proPanel: "Paketler", üç kart, altı fiyatlı düğme, Geri yükle, Lisans kodu', p.open && p.vis && p.title === 'Paketler' && JSON.stringify(p.cards) === JSON.stringify(['adfree', 'premium', 'super']) && JSON.stringify(p.buys) === JSON.stringify(['adfree/monthly', 'adfree/yearly', 'premium/monthly', 'premium/yearly', 'super/monthly', 'super/yearly']) && p.prices.includes(PRICE) && p.features >= 15 && p.restore && p.license && p.status === null && p.note === null && /Üç abonelik/.test(p.text), JSON.stringify(p).slice(0, 300));
    ok('1c2 panel URL açmaz, köprüye satın alma çağrısı gitmez', await ev(() => window.__opened.length === 0 && window.__proCalls.length === 0));
    await shot('pro_panel_free');
    const back = await ev(() => window.dwgApp.onBack());
    ok('1c3 geri tuşu Pro panelini kapatır', back === true && (await panel()).open === false);
  }
  // sekmeler ve karolar
  {
    // v7.31 sözleşmesi: kilitli karo/sekme GİZLENMEZ; çizilir ve data-need + .lk rozeti taşır.
    const tb = await tabs();
    ok('1d yedi sekmenin hepsi çizilir; draw / edit / annot rozetlidir', tb.length === 7 && ['view', 'display', 'measure', 'draw', 'annot', 'edit', '3d'].every(t => tb.includes(t)), tb.join(','));
    const lockedTabs = await ev(() => [...document.querySelectorAll('#toolbar [data-tab][data-need]')].map(b => b.dataset.tab + ':' + b.dataset.need).sort());
    ok('1d2 rozetli sekmeler yalnız draw(premium) / annot(premium) / edit(premium)', lockedTabs.join(',') === 'annot:premium,draw:premium,edit:premium', lockedTabs.join(','));
    const row = (id) => ev((id) => [...document.querySelectorAll(`#toolbar .tb-row[data-for="${id}"] [data-act]`)].map(b => b.dataset.act), id);
    // Beklenen rozet kümesi ELLE YAZILMAZ: her satırda "kilitli ⇔ data-need ⇔ .lk" Ed.need() ile sınanır.
    const rowLock = (id) => ev(async (id) => {
      const Ed = await import('./edition.js');
      return [...document.querySelectorAll(`#toolbar .tb-row[data-for="${id}"] [data-act]`)].map(b => {
        const k = b.dataset.act, lock = !Ed.has(k);
        return { k, ok: lock === b.hasAttribute('data-need') && lock === !!b.querySelector('.lk') && (!lock || b.dataset.need === Ed.need(k)) };
      }).filter(x => !x.ok).map(x => x.k);
    }, id);
    const m = await row('measure');
    ok('1e ölçü sekmesi: profile ARTIK ÇİZİLİR ve super rozetlidir', m.includes('profile') && ['t:dist', 't:area', 't:angle', 't:radius', 't:coord', 'osnap', 'grid', 'crosshair'].every(a => m.includes(a)), m.join(','));
    ok('1e2 ölçü satırında rozet sözleşmesi', (await rowLock('measure')).length === 0, (await rowLock('measure')).join(','));
    const v = await row('view');
    ok('1f görünüm sekmesi: pdf/savedxf/savedelta/notes/compare/undo/redo ARTIK ÇİZİLİR', ['pdf', 'savedxf', 'savedelta', 'notes', 'compare', 'undo', 'redo'].every(a => v.includes(a)) && ['extents', 'layers', 'search', 'png', 'drive', 'display', 'more', 'gps', 'basemap', 'views', 'layouts'].every(a => v.includes(a)), v.join(','));
    ok('1f2 görünüm satırında rozet sözleşmesi', (await rowLock('view')).length === 0, (await rowLock('view')).join(','));
    const d3 = await row('3d');
    ok('1g 3B sekmesi: 3:move/3:setz/3:del/3:pline/undo ARTIK ÇİZİLİR; 3:dist/3:select rozetsiz', ['3:move', '3:setz', '3:del', '3:pline', 'undo'].every(a => d3.includes(a)) && ['3d', 'fit3', 'v:iso', '3:dist', '3:select', 'vstyle', 'clip3', 'persp'].every(a => d3.includes(a)), d3.join(','));
    ok('1g2 3B satırında rozet sözleşmesi', (await rowLock('3d')).length === 0, (await rowLock('3d')).join(','));
    // Çağrı karosu (.lk-cta) data-act taşımaz, data-lk taşır: grup denetimi ikisini de sayar
    const groups = await ev(() => [...document.querySelectorAll('#toolbar .tb-row .tb-group')].every(g => g.querySelectorAll('[data-act], [data-lk]').length > 0));
    ok('1h boş grup çizilmedi', groups);
    const ids = await ev(() => { const q = (x) => document.getElementById(x); return { undo: !!q('tbUndo'), save: !!q('tbSave'), layer: !!q('tbLayer'), undoNeed: q('tbUndo') && q('tbUndo').dataset.need, undoDis: q('tbUndo') && q('tbUndo').disabled }; });
    ok('1i tbUndo / tbSave / tbLayer kimlikleri VAR, rozetli ve ÖLÜ DEĞİL', ids.undo && ids.save && ids.layer && ids.undoNeed === 'premium' && ids.undoDis === false, JSON.stringify(ids));
  }
  // Diğer menüsü (belge yokken ana ekran açıktır ve üst çubuk gizlidir: düğme programla tıklanır, menü ana ekranın üstünde açılır)
  {
    await ev(() => document.getElementById('btnMore').click()); await page.waitForTimeout(100);
    // Rozet basamağı FEATURE_TIER'den okunur: bir yetenek Premium'a inince test kırılmaz, sözleşme sınanır.
    const r = await ev(async () => {
      const Ed = await import('./edition.js');
      const q = (a) => document.querySelector(`#moreMenu [data-act="${a}"]`); const n = (a) => q(a).dataset.need || '';
      const kilitli = ['notes', 'profile', 'compare', 'pdf'], serbest = ['png', 'info', 'about'];
      return { notes: q('notes').hidden, profile: q('profile').hidden, compare: q('compare').hidden, pdf: q('pdf').hidden, pro: q('pro').hidden, proVis: q('pro').offsetParent !== null, proText: q('pro').textContent.trim(), png: q('png').hidden, info: q('info').hidden, about: q('about').hidden, need: [n('notes'), n('profile'), n('compare'), n('pdf'), n('png'), n('info'), n('pro')].join('|'), rozet: kilitli.every(a => !Ed.has(a) && n(a) === Ed.need(a)) && serbest.every(a => Ed.has(a) && !n(a)), pills: document.querySelectorAll('#moreMenu .lk-pill').length };
    });
    ok('1j Diğer menüsü: notes/profile/compare/pdf ARTIK GÖRÜNÜR ve rozetli, pro görünür', !r.notes && !r.profile && !r.compare && !r.pdf && !r.pro && r.proVis && r.proText.startsWith('Paketlere bak') && !r.png && !r.info && !r.about && r.rozet && r.pills >= 4, JSON.stringify(r));
    await shot('free_more_menu');
    await page.click('#moreMenu [data-act="pro"]'); await page.waitForTimeout(80);
    const p = await panel();
    ok('1k menü › Paketlere bak → menü kapanır, #proPanel açılır', await ev(() => document.getElementById('moreMenu').hidden) && p.open && p.prices.includes(PRICE), JSON.stringify(p).slice(0, 120));
    await page.click('#proPanel [data-close="proPanel"]'); await page.waitForTimeout(50);
    ok('1k2 kapat düğmesi paneli kapatır', (await panel()).open === false);
    const up = await ev(async () => {
      const Ed = await import('./edition.js'); const b = document.querySelector('#drivePanel [data-drive="upload"]');
      return { hidden: b.hidden, need: b.dataset.need || '', bekl: Ed.need('driveUpload'), ad: Ed.tierName(Ed.need('driveUpload')), bar: !!b.querySelector('.lk-bar'), aria: b.getAttribute('aria-label') || '' };
    });
    ok('1l Drive yükleme düğmesi GÖRÜNÜR, rozetli, adına kilit cümlesi eklenmiş', up.hidden === false && up.need === up.bekl && up.need !== 'free' && up.bar && up.aria.includes(up.ad + ' paketinde bulunur.') && await ev(() => !document.querySelector('#drivePanel [data-drive="refresh"]').hidden), JSON.stringify(up));
  }
  // belge açılışı → reklam
  ok('1m belge açılmadan reklam isteği yok', (await calls()).length === 0);
  await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
  await ev(() => { document.getElementById('toast').hidden = true; });
  {
    const c = await calls();
    ok('1n açılışta showAd("open")', c.length === 1 && c[0] === 'open', JSON.stringify(c));
    const st = await ev(() => window.dwgApp.__ads.state());
    ok('1o __ads.state: adsOn, zamanlayıcı açık, 5 dk / 15 s', st.adsOn && st.timer && st.interval === 300000 && st.tickMs === 15000 && st.requests === 1 && st.last > 0, JSON.stringify(st));
    const now = await ev(() => Date.now());
    const r1 = await ev((n) => window.dwgApp.__ads.tick(n), now + 60000);
    ok('1p tick(now+60 s) yeni istek üretmez', r1 === false && (await calls()).length === 1);
    const r2 = await ev((n) => window.dwgApp.__ads.tick(n), now + 300000);
    const c2 = await calls();
    ok('1q tick(now+5 dk) → showAd("interval")', r2 === true && c2.length === 2 && c2[1] === 'interval', JSON.stringify(c2));
    await ev(() => window.dwgApp.onAd('interval', true));
    const r3 = await ev((n) => window.dwgApp.__ads.tick(n), now + 300000 + 10000);
    ok('1r onAd(interval,true) sonrası tick(+10 s) yeni istek yok', r3 === false && (await calls()).length === 2);
    const r4 = await ev((n) => window.dwgApp.__ads.tick(n), now + 2 * 300000 + 20000);
    ok('1s 5 dk daha sonra yeniden istek', r4 === true && (await calls()).length === 3);
    const st2 = await ev(() => window.dwgApp.__ads.state());
    ok('1t state: 3 istek, 1 gösterim', st2.requests === 3 && st2.shown === 1, JSON.stringify(st2));
  }
  await ev(() => window.dwgApp.editor.openTab('view')); await page.waitForTimeout(100);   // etkin sekmeye tıklamak katlar; openTab açık tutar
  ok('1t2 şerit açık (katlanmadı)', await ev(() => !document.getElementById('toolbar').classList.contains('collapsed') && !document.querySelector('#toolbar .tb-row[data-for="view"]').hidden));
  await shot('free_ribbon_view');
  await page.click('#toolbar [data-tab="measure"]'); await page.waitForTimeout(100); await shot('free_measure_tab');
  // ölçü aracı serbest
  {
    await page.click('#toolbar [data-act="t:dist"]'); await page.waitForTimeout(100);
    const r = await ev(() => ({ running: window.dwgApp.editor.tools.running, active: window.dwgApp.editor.tools.active, cmd: !document.getElementById('cmdBar').hidden, ask: !document.getElementById('askDlg') || document.getElementById('askDlg').hidden }));
    ok('1u mesafe aracı ücretsizde çalışır (kutu çıkmaz)', r.running && r.active === 'dist' && r.cmd && r.ask, JSON.stringify(r));
    await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {}); await page.waitForTimeout(80);
  }
  // gate: dolaylı yol — sekme gizliyken act('t:line')
  {
    const n0 = (await askLog(page)).length;
    await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(150);
    const r = await ev(() => { const d = document.getElementById('askDlg'); return { dlg: !!d && !d.hidden && d.classList.contains('confirm'), label: d ? document.getElementById('askLabel').textContent : '', okBtn: d ? document.getElementById('askOk').textContent : '', running: window.dwgApp.editor.tools.running, cmd: !document.getElementById('cmdBar').hidden }; });
    ok('1v act("t:line") aracı başlatmaz, yükseltme kutusu açılır', r.dlg && /Premium paketinde bulunur/.test(r.label) && /Paketler açılsın mı/.test(r.label) && r.okBtn === 'Paketlere bak' && !r.running && !r.cmd, JSON.stringify(r));
    await shot('free_gate_dialog');
    await page.click('#askNo'); await page.waitForTimeout(80);
    ok('1w kutuda Vazgeç → panel açılmaz, araç yok', await ev(() => document.getElementById('askDlg').hidden && document.getElementById('proPanel').hidden && !window.dwgApp.editor.tools.running));
    // kuyruklu cevaplar: hayır / evet
    await queueAnswers(page, false); await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(80);
    ok('1x kuyruk "hayır" → araç yok, panel yok', await ev(() => document.getElementById('proPanel').hidden && !window.dwgApp.editor.tools.running));
    await queueAnswers(page, true); await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(80);
    const p = await panel();
    ok('1y kuyruk "evet" → paket paneli açılır (URL açılmaz), araç yine yok', p.open && p.prices.includes(PRICE) && await ev(() => window.__opened.length === 0 && !window.dwgApp.editor.tools.running), JSON.stringify(p).slice(0, 120));
    await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(50);
    ok('1y2 geri tuşu paneli kapatır (belge açıkken de)', (await panel()).open === false);
    const log = (await askLog(page)).slice(n0);
    ok('1z üç istek de confirm türünde', log.length === 3 && log.every(l => l.type === 'confirm' && /(Premium|Super|Ad-Free) paketinde bulunur/.test(l.label)), JSON.stringify(log).slice(0, 200));
  }
  // öteki dolaylı yollar
  {
    await queueAnswers(page, false); await ev(() => window.dwgApp.setMode('profile')); await page.waitForTimeout(80);
    ok('2a setMode("profile") geçersiz', await ev(() => window.dwgApp.state.mode === 'view' && document.getElementById('measurePanel').hidden));
    await queueAnswers(page, false); await ev(() => document.querySelector('#moreMenu [data-act="notes"]').click()); await page.waitForTimeout(80);
    ok('2b menü notes (gizli düğme) → not çubuğu açılmaz', await ev(() => !window.dwgApp.state.notesOn && document.getElementById('notesBar').hidden));
    await queueAnswers(page, false); await ev(() => document.querySelector('#moreMenu [data-act="pdf"]').click()); await page.waitForTimeout(80);
    ok('2c menü pdf → PDF kutusu açılmaz', await ev(() => document.getElementById('docPanel').hidden || document.getElementById('docTitle').textContent !== 'PDF oluştur'));
    await queueAnswers(page, false); await ev(() => window.dwgApp.editor.act('3:move')); await page.waitForTimeout(80);
    ok('2d act("3:move") 3B aracı başlatmaz', await ev(() => !window.dwgApp.editor.m3 && !window.dwgApp.editor.is3D()));
    {   // 3B polyline belgeyi değiştiren tek 3B çizim aracı: kapıda kesilmeli (prims / dirty / undo değişmez, 3B'ye girilmez)
      const n = await ev(() => window.dwgApp.state.prims.length);
      const a0 = (await askLog(page)).length;
      await queueAnswers(page, false); await ev(() => window.dwgApp.editor.act('3:pline')); await page.waitForTimeout(80);
      const r = await ev(() => ({ m3: window.dwgApp.editor.m3, is3D: window.dwgApp.editor.is3D(), cmdHidden: document.getElementById('cmdBar').hidden, n: window.dwgApp.state.prims.length, dirty: !!(window.dwgApp.editor.doc && window.dwgApp.editor.doc.dirty) }));
      const asked = (await askLog(page)).slice(a0);
      ok('2d2 act("3:pline") 3B polyline başlatmaz, yükseltme kutusu istenir, belge değişmez', !r.m3 && !r.is3D && r.cmdHidden && r.n === n && !r.dirty && asked.length === 1 && asked[0].type === 'confirm' && /Super paketinde bulunur/.test(asked[0].label), JSON.stringify(r) + ' ' + JSON.stringify(asked).slice(0, 120));
    }
    await queueAnswers(page, false);
    const kz = await ev(() => window.dwgApp.editor.key({ key: 'z', ctrlKey: true }));
    ok('2e Ctrl+Z kapıdan döner', kz === true);
    await queueAnswers(page, false); await ev(() => window.dwgApp.drive.uploadWithPicker({ b64: 'QQ==', name: 'x.dxf', mime: 'application/dxf' })); await page.waitForTimeout(80);
    ok('2f Drive uploadWithPicker kapılı (panel açılmaz)', await ev(() => document.getElementById('drivePanel').hidden));
    const log = await askLog(page);
    ok('2g her dolaylı yol yükseltme kutusu istedi', log.filter(l => l.type === 'confirm' && /paketinde bulunur/.test(l.label)).length >= 10, String(log.length));
    // Pro'ya ait olmayan menü eylemleri kutu açmadan çalışır
    const n0 = (await askLog(page)).length;
    await page.click('#btnMore'); await page.click('#moreMenu [data-act="about"]'); await page.waitForTimeout(150);
    const about = await ev(() => document.getElementById('docBody').innerText);
    ok('2h Hakkında: sürüm satırında "Ücretsiz"', /7\.1 \(24\)[^\n]*Ücretsiz/.test(about) && (await askLog(page)).length === n0, about.split('\n').slice(0, 3).join(' | '));
    await ev(() => window.dwgApp.onBack());
    await page.click('#btnMore'); await page.click('#moreMenu [data-act="info"]'); await page.waitForTimeout(150);
    ok('2i Çizim bilgisi açılır', await ev(() => !document.getElementById('docPanel').hidden && document.getElementById('docTitle').textContent === 'Çizim bilgisi'));
    await ev(() => window.dwgApp.onBack());
  }
  ok('2j ücretsiz: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));

  // ---- satın alma: Pro paneli › Satın al → Android.buyPro → onEdition('pro','purchased') → şerit yeniden kurulur, reklam durur
  {
    await ev(() => { document.getElementById('toast').hidden = true; });
    await page.click('#btnMore'); await page.click('#moreMenu [data-act="pro"]'); await page.waitForTimeout(80);
    ok('5a belge açıkken menüden Pro paneli açılır', (await panel()).open);
    const adReq0 = (await calls()).length, tab0 = await ev(() => window.dwgApp.editor.tab);
    await page.click('#proPanel [data-pro="buy"][data-tier="super"][data-plan="yearly"]'); await page.waitForTimeout(150);
    ok('5b Super/yıllık düğmesi → Android.buyPro("super","yearly")', await ev(() => window.__proCalls.length === 1 && window.__proCalls[0] === 'buy:super/yearly'), JSON.stringify(await ev(() => window.__proCalls)));
    const r = await ev(() => ({ ed: window.dwgApp.edition(), pro: window.dwgApp.isPro(), cls: document.body.classList.contains('edition-pro') && !document.body.classList.contains('edition-free'), proLine: document.getElementById('proLine').hidden, menuPro: document.querySelector('#moreMenu [data-act="pro"]').hidden, notes: document.querySelector('#moreMenu [data-act="notes"]').hidden, pdf: document.querySelector('#moreMenu [data-act="pdf"]').hidden, upload: document.querySelector('#drivePanel [data-drive="upload"]').hidden, undo: !!document.getElementById('tbUndo'), save: !!document.getElementById('tbSave'), layer: !!document.getElementById('tbLayer'), profile: !!document.querySelector('#toolbar .tb-row[data-for="measure"] [data-act="profile"]'), tab: window.dwgApp.editor.tab, collapsed: document.getElementById('toolbar').classList.contains('collapsed') }));
    const tb = await tabs();
    ok('5c onEdition(super) sonrası draw / edit sekmeleri belirir (rebuild), geçerli sekme korunur', ['view', 'display', 'measure', 'draw', 'edit', '3d'].every(t => tb.includes(t)) && r.tab === tab0 && !r.collapsed && await ev((t0) => !document.querySelector(`#toolbar .tb-row[data-for="${t0}"]`).hidden && document.querySelector(`#toolbar [data-tab="${t0}"]`).classList.contains('active'), tab0), tb.join(',') + ' ' + r.tab + '/' + tab0);
    ok('5d Super: basamak/sınıf, #proLine gizli, menü pro gizli, notes/pdf görünür, Drive yükleme görünür, tbUndo/tbSave/tbLayer/profile var', r.ed === 'super' && r.pro && r.cls && r.proLine && r.menuPro && !r.notes && !r.pdf && !r.upload && r.undo && r.save && r.layer && r.profile, JSON.stringify(r));
    const st = await ev(() => window.dwgApp.__ads.state());
    const tk = await ev(() => window.dwgApp.__ads.tick(Date.now() + 60 * 60000));
    ok('5e reklam: adsOn false, zamanlayıcı durdu, tick istek üretmez', !st.adsOn && !st.timer && tk === false && (await calls()).length === adReq0, JSON.stringify(st));
    ok('5f uyarı: "Pro etkinleştirildi"', (await toastText()) === 'Pro etkinleştirildi', await toastText());
    const p = await panel();
    ok('5g panel Super durumunu gösterir: Google Play, Super kartı Etkin, satın alma düğmesi yok', p.open && p.status === 'play' && /Super/.test(p.text) && /Google Play/.test(p.text) && JSON.stringify(p.owned) === JSON.stringify(['super']) && p.buys.length === 0 && p.restore && p.license, JSON.stringify(p).slice(0, 240));
    await shot('pro_panel_after');
    await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(50);
    ok('5h panel kapandı', (await panel()).open === false);
    // artık kapı yok: t:line kutusuz başlar
    const n0 = (await askLog(page)).length;
    await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(100);
    const r2 = await ev(() => ({ running: window.dwgApp.editor.tools.running, active: window.dwgApp.editor.tools.active, marked: !!document.querySelector('#toolbar [data-act="t:line"].active') }));
    ok('5i Super sonrası act("t:line") kutusuz başlar, karo işaretli', r2.running && r2.active === 'line' && r2.marked && (await askLog(page)).length === n0, JSON.stringify(r2));
    await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {}); await page.waitForTimeout(80);
    // geri yükleme (zaten Pro): 'restored' uyarısı, şerit yeniden kurulmaz (draw sekmesi aynı düğüm)
    await ev(() => { document.getElementById('toast').hidden = true; window.__drawBtn = document.querySelector('#toolbar [data-tab="draw"]'); });
    await ev(() => window.Android.restorePro()); await page.waitForTimeout(100);
    ok('5j restorePro (Pro iken) → "Pro etkinleştirildi", şerit yeniden kurulmadı', (await toastText()) === 'Pro etkinleştirildi' && await ev(() => window.__drawBtn === document.querySelector('#toolbar [data-tab="draw"]')));
    // iptal: onEdition('free','revoked') → sekmeler kalkar, reklam zamanlayıcısı başlar
    await ev(() => { document.getElementById('toast').hidden = true; window.__setEd('free'); window.dwgApp.onEdition('free', 'revoked'); }); await page.waitForTimeout(80);
    const tb2 = await tabs(); const st2 = await ev(() => window.dwgApp.__ads.state());
    const lk2 = await ev(() => [...document.querySelectorAll('#toolbar [data-tab][data-need]')].map(b => b.dataset.tab).sort().join(','));
    ok('5k onEdition(free, revoked) → sekmeler KALIR ve yeniden rozetlenir, #proLine görünür, adsOn ve zamanlayıcı açık, uyarı', tb2.includes('draw') && tb2.includes('edit') && lk2 === 'annot,draw,edit' && await ev(() => !document.getElementById('proLine').hidden && document.body.classList.contains('edition-free')) && st2.adsOn && st2.timer && (await toastText()) === 'Pro yetkisi kaldırıldı', tb2.join(',') + ' ' + JSON.stringify(st2));
    // öteki nedenler: cancelled sessiz, pending ve error uyarı; yetki değişmez
    await ev(() => { document.getElementById('toast').hidden = true; window.dwgApp.onEdition('free', 'cancelled'); }); await page.waitForTimeout(30);
    ok('5l cancelled → sessiz, free kalır', (await toastText()) === '' && await ev(() => window.dwgApp.edition() === 'free'));
    await ev(() => window.dwgApp.onEdition('free', 'pending')); await page.waitForTimeout(30);
    ok('5m pending → uyarı', /onay bekliyor/.test(await toastText()), await toastText());
    await ev(() => window.dwgApp.onEdition('free', 'error:Fatura hizmeti yok')); await page.waitForTimeout(30);
    ok('5n error:<mesaj> → hata uyarısı iletiyle', /^Hata: Fatura hizmeti yok/.test(await toastText()), await toastText());
    await ev(() => window.dwgApp.onEdition('free', 'none')); await page.waitForTimeout(30);
    ok('5o none (geri yüklenecek satın alım yok) → uyarı', /Geri yüklenecek/.test(await toastText()), await toastText());
    // 3B araç (3:dist, Pro'ya kapalı değil) çalışırken satın alma: rebuild sonrası karo işareti korunur (ed.m3 tools'tan ayrı yürür)
    {
      await ev(() => { document.getElementById('toast').hidden = true; });
      await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(500);
      await ev(() => window.dwgApp.editor.act('3:dist')); await page.waitForTimeout(100);
      const b = await ev(() => ({ is3d: window.dwgApp.editor.is3D(), m3: window.dwgApp.editor.m3 && window.dwgApp.editor.m3.name, marked: !!document.querySelector('#toolbar [data-act="3:dist"].active') }));
      ok('5q Ücretsizde 3B mesafe aracı başlar, karo işaretli', b.is3d && b.m3 === 'dist' && b.marked, JSON.stringify(b));
      await ev(() => window.Android.buyPro('super', 'yearly')); await page.waitForTimeout(150);
      const a = await ev(() => ({ ed: window.dwgApp.edition(), m3: window.dwgApp.editor.m3 && window.dwgApp.editor.m3.name, marked: !!document.querySelector('#toolbar [data-act="3:dist"].active'), active: [...document.querySelectorAll('#toolbar [data-act].active')].map(b => b.dataset.act), tab: window.dwgApp.editor.tab, cmdHidden: document.getElementById('cmdBar').hidden }));
      ok('5r 3B araç çalışırken onEdition(super) → şerit yeniden kurulur, 3:dist karosu işaretli kalır, 3B sekmesi ve komut çubuğu açık', a.ed === 'super' && a.m3 === 'dist' && a.marked && a.active.includes('3:dist') && a.tab === '3d' && !a.cmdHidden, JSON.stringify(a));
      await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(80);   // aracı bırak
      await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(300);   // 2B'ye dön
      ok('5s 3B araç bırakıldı, 2B görünüme dönüldü', await ev(() => !window.dwgApp.editor.m3 && !window.dwgApp.editor.is3D()));
      await ev(() => { document.getElementById('toast').hidden = true; window.__setEd('free'); window.dwgApp.onEdition('free', 'revoked'); }); await page.waitForTimeout(80);
    }
    // Pro paneli açıkken dil değişimi (Ayarlar › Kaydet → applySettings): gövde yeni dilde yeniden kurulur
    {
      await ev(() => { document.getElementById('toast').hidden = true; });
      await page.click('#btnMore'); await page.click('#moreMenu [data-act="pro"]'); await page.waitForTimeout(80);
      ok('5t panel (Ücretsiz) açık, Türkçe gövde', (await panel()).open && /Üç abonelik/.test((await panel()).text));
      // Ayarlar açılınca paket paneli kapanır (tek alt sayfa kuralı; yoksa Kaydet düğmesini örter)
      await page.click('#btnMore'); await page.click('#moreMenu [data-act="settings"]'); await page.waitForTimeout(100);
      ok('5t2 Ayarlar açılınca paket paneli kapanır', (await panel()).open === false);
      await page.selectOption('#sLang', 'en'); await page.click('#sSave'); await page.waitForTimeout(150);
      await page.click('#btnMore'); await page.click('#moreMenu [data-act="pro"]'); await page.waitForTimeout(100);
      const p = await panel();
      ok('5u dil İngilizce → paket paneli İngilizce (başlık Plans, üç abonelik metni, paket adları)', p.open && p.title === 'Plans' && /Three subscriptions/.test(p.text) && !/Üç abonelik/.test(p.text) && /Ad-Free/.test(p.text) && /Premium/.test(p.text) && /Super/.test(p.text) && p.buys.length === 6, JSON.stringify(p).slice(0, 220));
      await page.click('#btnMore'); await page.click('#moreMenu [data-act="settings"]'); await page.waitForTimeout(100);
      await page.selectOption('#sLang', 'tr'); await page.click('#sSave'); await page.waitForTimeout(150);
      await page.click('#btnMore'); await page.click('#moreMenu [data-act="pro"]'); await page.waitForTimeout(100);
      const p2 = await panel();
      ok('5v dil Türkçe → panel gövdesi Türkçe', p2.open && p2.title === 'Paketler' && /Üç abonelik/.test(p2.text) && p2.buys.length === 6, JSON.stringify(p2).slice(0, 200));
      await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(50);
      ok('5w panel kapandı', (await panel()).open === false);
    }
    ok('5p satın alma akışı: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
  }

  // ---- yeniden yükleme (köprü yine free): lisans kodu akışı
  {
    await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
    ok('6a yeniden yükleme sonrası free (sekmeler çizilir, draw rozetli)', await ev(() => window.dwgApp.edition() === 'free') && (await tabs()).includes('draw') && await ev(() => document.querySelector('#toolbar [data-tab="draw"]').dataset.need === 'premium'));
    await page.click('#btnGoPro'); await page.waitForTimeout(80);
    await ev(() => { document.getElementById('toast').hidden = true; });
    const a0 = (await askLog(page)).length;
    await queueAnswers(page, 'DWGPRO-bad'); await page.click('#proPanel [data-pro="license"]'); await page.waitForTimeout(100);
    const asked = (await askLog(page)).slice(a0);
    ok('6b Lisans kodu gir → askText(lisans kodu); yanlış kod → activateLicense false, uyarı, free kalır', asked.length === 1 && asked[0].type === 'text' && /Lisans kodu/.test(asked[0].label) && await ev(() => window.__proCalls.includes('license:DWGPRO-bad') && window.dwgApp.edition() === 'free') && /geçersiz/.test(await toastText()) && await ev(() => document.querySelector('#toolbar [data-tab="draw"]').dataset.need === 'premium'), JSON.stringify(asked) + ' ' + await toastText());
    await queueAnswers(page, null); await page.click('#proPanel [data-pro="license"]'); await page.waitForTimeout(60);
    ok('6c kutuda vazgeç → köprüye kod gitmez', await ev(() => window.__proCalls.filter(c => c.startsWith('license:')).length === 1));
    await ev(() => { document.getElementById('toast').hidden = true; });
    await queueAnswers(page, ' DWGPRO-ok '); await page.click('#proPanel [data-pro="license"]'); await page.waitForTimeout(120);
    const p = await panel(); const tb = await tabs();
    ok('6d doğru kod (kırpılır) → super: draw/edit belirir, uyarı, panel "Super — Lisans — ad (bitiş)"', await ev(() => window.dwgApp.edition() === 'super' && document.getElementById('proLine').hidden) && tb.includes('draw') && tb.includes('edit') && (await toastText()) === 'Pro etkinleştirildi' && p.status === 'license' && /Super/.test(p.text) && /Lisans — Deneme Kullanıcı/.test(p.text) && /bitiş/.test(p.text), JSON.stringify(p).slice(0, 200) + ' ' + tb.join(','));
    await shot('pro_panel_license');
    await ev(() => window.dwgApp.onBack());
    ok('6e lisans akışı: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
  }
  // ---- Google Play hazır değil (fiyat yok): Satın al pasif + açıklama; lisans kodu yine var
  {
    const ctx2 = await browser.newContext(PHONE); await noUpdate(ctx2);
    await ctx2.addInitScript(fakeBridge, { price: '', prices: {} });
    const page2 = await ctx2.newPage(); hook(page2);
    await page2.goto(srv.url + 'index.html'); await page2.waitForSelector('#btnOpen2'); await page2.waitForTimeout(150);
    await page2.click('#btnGoPro'); await page2.waitForTimeout(80);
    const r = await page2.evaluate(() => { const p = document.getElementById('proPanel'); const q = (s) => p.querySelector(s); return { open: !p.hidden, prices: [...p.querySelectorAll('[data-pro="buy"] .pr')].map(x => x.textContent.trim()), buys: p.querySelectorAll('[data-pro="buy"]').length, note: q('[data-pro-note]') ? q('[data-pro-note]').dataset.proNote : null, noteText: q('[data-pro-note]') ? q('[data-pro-note]').textContent : '', license: !!q('[data-pro="license"]') }; });
    ok('7a billingReady=false: altı düğme de pasif ve fiyatsız, "Google Play kullanılamıyor", Lisans kodu var', r.open && r.buys === 6 && r.prices.every(x => /Play Store/.test(x)) && r.note === 'billing' && /Google Play kullanılamıyor/.test(r.noteText) && r.license && await page2.evaluate(() => [...document.querySelectorAll('#proPanel [data-pro="buy"]')].every(b => b.disabled)), JSON.stringify(r).slice(0, 220));
    await page2.click('#proPanel [data-pro="buy"]', { force: true }).catch(() => { /* fiyat yokken düğme de yok */ }); await page2.waitForTimeout(60);
    ok('7b pasif Satın al köprüyü çağırmaz', await page2.evaluate(() => window.__proCalls.length === 0 && window.dwgApp.edition() === 'free'));
    await ctx2.close();
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------
// 2) EN ÜST BASAMAK (tarayıcı varsayılanı: Android yok → super)
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
  ok('3a basamak: super', await ev(() => window.dwgApp.edition() === 'super' && window.dwgApp.isPro() === true && document.body.classList.contains('edition-super') && document.body.classList.contains('edition-pro')));
  ok('3b #proLine gizli', await ev(() => document.getElementById('proLine').hidden === true));
  {
    const tabs = await ev(() => [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab));
    ok('3c draw / edit sekmeleri var', ['view', 'display', 'measure', 'draw', 'edit', '3d'].every(t => tabs.includes(t)), tabs.join(','));
    const r = await ev(() => ({ pro: document.querySelector('#moreMenu [data-act="pro"]').hidden, notes: document.querySelector('#moreMenu [data-act="notes"]').hidden, pdf: document.querySelector('#moreMenu [data-act="pdf"]').hidden, undo: !!document.getElementById('tbUndo'), save: !!document.getElementById('tbSave'), layer: !!document.getElementById('tbLayer'), profile: !!document.querySelector('#toolbar .tb-row[data-for="measure"] [data-act="profile"]'), upload: document.querySelector('#drivePanel [data-drive="upload"]').hidden }));
    ok('3d Pro: pro düğmesi gizli, notes/pdf görünür, tbUndo/tbSave/tbLayer/profile var, Drive yükleme görünür', r.pro && !r.notes && !r.pdf && r.undo && r.save && r.layer && r.profile && !r.upload, JSON.stringify(r));
  }
  {
    const st = await ev(() => window.dwgApp.__ads.state());
    const r = await ev(() => window.dwgApp.__ads.tick(Date.now() + 10 * 60000));
    ok('3e Pro: reklam kapalı, tick istek üretmez', !st.adsOn && !st.timer && r === false && st.requests === 0, JSON.stringify(st));
  }
  {   // tarayıcıda Pro paneli (dwgApp.openProPanel): Pro etkin, kaynak yok; düğme yok
    await ev(() => window.dwgApp.openProPanel()); await page.waitForTimeout(60);
    const r = await ev(() => { const p = document.getElementById('proPanel'); return { open: !p.hidden, text: p.querySelector('#proBody').innerText, btns: p.querySelectorAll('[data-pro]').length, info: window.dwgApp.proInfo() }; });
    ok('3e2 tarayıcıda paket paneli: Super etkin, satın alma düğmesi yok, proInfo köprüsüz', r.open && /Super/.test(r.text) && r.btns === 0 && r.info.edition === 'super' && r.info.source === 'none' && !r.info.android, JSON.stringify(r).slice(0, 200));
    await ev(() => window.dwgApp.onBack());
    // tarayıcıda Ücretsiz görünümü (window.__edition) — panel yalnız açıklama
    await ev(() => { window.__edition = 'free'; window.dwgApp.onEdition('free', ''); }); await page.waitForTimeout(60);
    await ev(() => window.dwgApp.openProPanel()); await page.waitForTimeout(60);
    const r2 = await ev(() => { const p = document.getElementById('proPanel'); const q = (s) => p.querySelector(s); return { open: !p.hidden, note: q('[data-pro-note]') ? q('[data-pro-note]').dataset.proNote : null, text: q('[data-pro-note]') ? q('[data-pro-note]').textContent : '', btns: p.querySelectorAll('[data-pro]').length, tabs: [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab) }; });
    const lk3 = await page.evaluate(() => [...document.querySelectorAll('#toolbar [data-tab][data-need]')].map(b => b.dataset.tab).sort().join(','));
    ok('3e3 tarayıcıda Ücretsiz: panel yalnız açıklama ("Android uygulamasında satın alınır"), düğme yok; onEdition(free) sekmeleri ROZETLEDİ', r2.open && r2.note === 'browser' && /Android uygulamasında/.test(r2.text) && r2.btns === 0 && r2.tabs.includes('draw') && lk3 === 'annot,draw,edit', JSON.stringify(r2).slice(0, 200) + ' ' + lk3);
    await page.screenshot({ path: `${out}/pro_panel_browser.png` });
    await ev(() => { window.dwgApp.onBack(); window.__edition = 'super'; window.dwgApp.onEdition('super', ''); }); await page.waitForTimeout(60);
    ok('3e4 onEdition(pro) → sekmeler geri', await ev(() => [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab).includes('draw') && document.getElementById('proPanel').hidden));
  }
  await openFile(page, `${SM}/example_2000.dwg`, { settle: 300 });
  await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });
  {
    const n0 = (await askLog(page)).length;
    await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(100);
    const r = await ev(() => ({ running: window.dwgApp.editor.tools.running, active: window.dwgApp.editor.tools.active, cmd: document.getElementById('cmdText').textContent }));
    ok('3f Pro: act("t:line") aracı başlatır, kutu yok', r.running && r.active === 'line' && r.cmd === 'Çizgi: Birinci noktayı seçin' && (await askLog(page)).length === n0, JSON.stringify(r));
    await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
    const st = await ev(() => window.dwgApp.__ads.state());
    ok('3g Pro: belge açılışında reklam isteği yok', st.requests === 0 && !st.adsOn, JSON.stringify(st));
    await page.click('#btnMore'); await page.click('#moreMenu [data-act="about"]'); await page.waitForTimeout(150);
    const about = await ev(() => document.getElementById('docBody').innerText);
    ok('3h Hakkında: sürüm satırında "Super"', /web[^\n]*· Super/.test(about), about.split('\n').slice(0, 2).join(' | '));
    await ev(() => window.dwgApp.onBack());
  }
  ok('3i pro: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
  await ctx.close();
}

// ---------------------------------------------------------------------------------
// 3) tier() önceliği: Android.edition() > önbellek > window.__edition > 'super'; geçersiz köprü değeri __edition'a düşer
// ---------------------------------------------------------------------------------
for (const c of [
  { name: '4a Android.edition()="super" + __edition="free" → super (köprü üstün)', bridge: 'super', w: 'free', want: 'super' },
  { name: '4b Android.edition()="" (geçersiz) + __edition="free" → free', bridge: '', w: 'free', want: 'free' },
  { name: '4c Android.edition()="free" + __edition yok → free', bridge: 'free', w: null, want: 'free' },
  { name: '4d Android.edition() "sürüm" (geçersiz) + __edition yok → super (varsayılan)', bridge: 'sürüm', w: null, want: 'super' },
]) {
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  await ctx.addInitScript((c) => {
    if (c.w !== null) window.__edition = c.w;
    window.Android = { edition: () => c.bridge, adsAvailable: () => c.bridge === 'free', showAd: () => {}, openUrl: () => {}, appVersion: () => '7.1', versionCode: () => '24', updateUrl: () => '', getPendingFile: () => '', getRecent: () => '[]', pickFile: () => {} };
  }, c);
  const page = await ctx.newPage(); hook(page);
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ e: window.dwgApp.edition(), pro: window.dwgApp.isPro(), cls: document.body.classList.contains('edition-super') ? 'super' : document.body.classList.contains('edition-free') ? 'free' : '-', tabs: [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab), locked: [...document.querySelectorAll('#toolbar [data-tab][data-need]')].map(b => b.dataset.tab).sort(), proLine: document.getElementById('proLine').hidden }));
  // v7.31: sekme HER basamakta çizilir; ölçüt sekmenin varlığı değil ROZETİN varlığıdır.
  const allTabs = ['view', 'display', 'measure', 'draw', 'annot', 'edit', '3d'].every(x => r.tabs.includes(x));
  ok(c.name, r.e === c.want && r.pro === (c.want === 'super') && r.cls === c.want && allTabs && r.locked.length === (c.want === 'super' ? 0 : 3) && r.proLine === (c.want === 'super'), JSON.stringify(r).slice(0, 220));
  if (c.bridge === 'super' || c.bridge === 'free') {   // köprü geçerliyken onEdition ters değer verse de bir sonraki okuma köprüyü esas alır
    const r2 = await page.evaluate((b) => { window.dwgApp.onEdition(b === 'super' ? 'free' : 'super', ''); return window.dwgApp.edition(); }, c.bridge);
    ok(c.name.slice(0, 2) + '2 köprü geçerliyken edition() köprüyü okur', r2 === c.bridge, r2);
  }
  await ctx.close();
}
ok('4e öncelik sınamaları: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));

C.summary(errors);
await browser.close(); srv.kill();
C.exit();
