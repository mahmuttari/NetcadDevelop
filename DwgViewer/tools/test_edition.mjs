// Ücretsiz / Pro sürüm sınaması: sekme ve karo gizleme, Diğer menüsü, karşılama kartı, gate() yükseltme kutusu,
// reklam zamanlaması (sahte Android köprüsü: edition/showAd/proUrl/openUrl) ve Pro'da hiçbir kısıt olmaması.
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
const PRO_URL = 'https://ornek/pro.apk';

// ---------------------------------------------------------------------------------
// 1) ÜCRETSİZ sürüm (sahte Android köprüsü + window.__edition)
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  await ctx.addInitScript((proUrl) => {
    window.__edition = 'free';
    const calls = (window.__adCalls = []), opened = (window.__opened = []), picks = (window.__picks = []);
    window.Android = {
      edition: () => 'free', proUrl: () => proUrl, adsAvailable: () => true,
      showAd: (reason) => { calls.push(reason); }, openUrl: (u) => { opened.push(u); },
      appVersion: () => '7.0', versionCode: () => '23', updateUrl: () => 'https://ornek/version-free.json',
      getPendingFile: () => '', getRecent: () => '[]', pickFile: (p, m) => { picks.push([p, m]); },
    };
  }, PRO_URL);
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const calls = () => ev(() => window.__adCalls.slice());
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
  ok('1a sürüm: free', await ev(() => window.dwgApp.edition() === 'free' && window.dwgApp.isPro() === false && document.body.classList.contains('edition-free')));
  // karşılama kartı
  {
    const r = await ev(() => { const p = document.getElementById('proLine'), b = document.getElementById('btnGoPro'); return { hidden: p.hidden, vis: !!(p && p.offsetParent), text: p.textContent.trim(), btn: !!b && b.offsetParent !== null, open2: !!document.getElementById('btnOpen2'), input: !!document.getElementById('fileInput') }; });
    ok('1b karşılama kartında #proLine ve Pro düğmesi görünür', !r.hidden && r.vis && r.btn && /Ücretsiz sürüm/.test(r.text) && /Pro sürümde/.test(r.text) && r.open2 && r.input, JSON.stringify(r).slice(0, 200));
    await shot('free_welcome');
    await page.click('#btnGoPro'); await page.waitForTimeout(50);
    ok('1c karşılama Pro düğmesi → Android.openUrl(proUrl)', await ev((u) => window.__opened.length === 1 && window.__opened[0] === u, PRO_URL));
    await ev(() => { window.__opened.length = 0; });
  }
  // sekmeler ve karolar
  {
    const tabs = await ev(() => [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab));
    ok('1d sekme listesinde draw / edit yok', !tabs.includes('draw') && !tabs.includes('edit') && ['view', 'display', 'measure', '3d'].every(t => tabs.includes(t)), tabs.join(','));
    const row = (id) => ev((id) => [...document.querySelectorAll(`#toolbar .tb-row[data-for="${id}"] [data-act]`)].map(b => b.dataset.act), id);
    const m = await row('measure');
    ok('1e ölçü sekmesi: profile yok; dist/area/angle/radius/coord var', !m.includes('profile') && ['t:dist', 't:area', 't:angle', 't:radius', 't:coord', 'osnap', 'grid', 'crosshair'].every(a => m.includes(a)), m.join(','));
    const v = await row('view');
    ok('1f görünüm sekmesi: pdf/savedxf/savedelta/notes/compare/undo/redo yok; png/layers/drive/more var', !['pdf', 'savedxf', 'savedelta', 'notes', 'compare', 'undo', 'redo'].some(a => v.includes(a)) && ['extents', 'layers', 'search', 'png', 'drive', 'display', 'more', 'gps', 'basemap', 'views', 'layouts'].every(a => v.includes(a)), v.join(','));
    const d3 = await row('3d');
    ok('1g 3B sekmesi: 3:move/3:setz/3:del/3:pline/undo yok; 3:dist/3:select/vstyle/clip3 var', !['3:move', '3:setz', '3:del', '3:pline', 'undo'].some(a => d3.includes(a)) && ['3d', 'fit3', 'v:iso', '3:dist', '3:select', 'vstyle', 'clip3', 'persp'].every(a => d3.includes(a)), d3.join(','));
    const groups = await ev(() => [...document.querySelectorAll('#toolbar .tb-row .tb-group')].every(g => g.querySelectorAll('[data-act]').length > 0));
    ok('1h boş grup çizilmedi', groups);
    const ids = await ev(() => ({ undo: !!document.getElementById('tbUndo'), save: !!document.getElementById('tbSave'), layer: !!document.getElementById('tbLayer') }));
    ok('1i tbUndo / tbSave / tbLayer kimlikleri yok', !ids.undo && !ids.save && !ids.layer, JSON.stringify(ids));
  }
  // Diğer menüsü
  {
    await page.click('#btnMore'); await page.waitForTimeout(100);
    const r = await ev(() => { const q = (a) => document.querySelector(`#moreMenu [data-act="${a}"]`); return { notes: q('notes').hidden, profile: q('profile').hidden, compare: q('compare').hidden, pdf: q('pdf').hidden, pro: q('pro').hidden, proVis: q('pro').offsetParent !== null, proText: q('pro').textContent.trim(), png: q('png').hidden, info: q('info').hidden, about: q('about').hidden }; });
    ok('1j Diğer menüsü: notes/profile/compare/pdf gizli, pro görünür', r.notes && r.profile && r.compare && r.pdf && !r.pro && r.proVis && r.proText === 'Pro sürüme geç' && !r.png && !r.info && !r.about, JSON.stringify(r));
    await shot('free_more_menu');
    await page.click('#moreMenu [data-act="pro"]'); await page.waitForTimeout(50);
    ok('1k menü › Pro sürüme geç → openUrl', await ev((u) => document.getElementById('moreMenu').hidden && window.__opened.length === 1 && window.__opened[0] === u, PRO_URL));
    await ev(() => { window.__opened.length = 0; });
    ok('1l Drive paneli yükleme düğmesi gizli', await ev(() => document.querySelector('#drivePanel [data-drive="upload"]').hidden === true && !document.querySelector('#drivePanel [data-drive="refresh"]').hidden));
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
    ok('1v act("t:line") aracı başlatmaz, yükseltme kutusu açılır', r.dlg && /Pro sürümde/.test(r.label) && /indirmek ister misiniz/.test(r.label) && r.okBtn === 'Pro sürüme geç' && !r.running && !r.cmd, JSON.stringify(r));
    await shot('free_gate_dialog');
    await page.click('#askNo'); await page.waitForTimeout(80);
    ok('1w kutuda Vazgeç → openUrl çağrılmaz', await ev(() => document.getElementById('askDlg').hidden && window.__opened.length === 0 && !window.dwgApp.editor.tools.running));
    // kuyruklu cevaplar: hayır / evet
    await queueAnswers(page, false); await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(80);
    ok('1x kuyruk "hayır" → araç yok, openUrl yok', await ev(() => window.__opened.length === 0 && !window.dwgApp.editor.tools.running));
    await queueAnswers(page, true); await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(80);
    ok('1y kuyruk "evet" → opened[0] === proUrl, araç yine yok', await ev((u) => window.__opened.length === 1 && window.__opened[0] === u && !window.dwgApp.editor.tools.running, PRO_URL));
    const log = (await askLog(page)).slice(n0);
    ok('1z üç istek de confirm türünde', log.length === 3 && log.every(l => l.type === 'confirm' && /Pro/.test(l.label)), JSON.stringify(log).slice(0, 200));
    await ev(() => { window.__opened.length = 0; });
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
      ok('2d2 act("3:pline") 3B polyline başlatmaz, yükseltme kutusu istenir, belge değişmez', !r.m3 && !r.is3D && r.cmdHidden && r.n === n && !r.dirty && asked.length === 1 && asked[0].type === 'confirm' && /Pro/.test(asked[0].label), JSON.stringify(r) + ' ' + JSON.stringify(asked).slice(0, 120));
    }
    await queueAnswers(page, false);
    const kz = await ev(() => window.dwgApp.editor.key({ key: 'z', ctrlKey: true }));
    ok('2e Ctrl+Z kapıdan döner', kz === true);
    await queueAnswers(page, false); await ev(() => window.dwgApp.drive.uploadWithPicker({ b64: 'QQ==', name: 'x.dxf', mime: 'application/dxf' })); await page.waitForTimeout(80);
    ok('2f Drive uploadWithPicker kapılı (panel açılmaz)', await ev(() => document.getElementById('drivePanel').hidden));
    const log = await askLog(page);
    ok('2g her dolaylı yol yükseltme kutusu istedi', log.filter(l => l.type === 'confirm' && /Pro/.test(l.label)).length >= 10, String(log.length));
    // Pro'ya ait olmayan menü eylemleri kutu açmadan çalışır
    const n0 = (await askLog(page)).length;
    await page.click('#btnMore'); await page.click('#moreMenu [data-act="about"]'); await page.waitForTimeout(150);
    const about = await ev(() => document.getElementById('docBody').innerText);
    ok('2h Hakkında: sürüm satırında "Ücretsiz"', /7\.0 \(23\)[^\n]*Ücretsiz/.test(about) && (await askLog(page)).length === n0, about.split('\n').slice(0, 3).join(' | '));
    await ev(() => window.dwgApp.onBack());
    await page.click('#btnMore'); await page.click('#moreMenu [data-act="info"]'); await page.waitForTimeout(150);
    ok('2i Çizim bilgisi açılır', await ev(() => !document.getElementById('docPanel').hidden && document.getElementById('docTitle').textContent === 'Çizim bilgisi'));
    await ev(() => window.dwgApp.onBack());
  }
  ok('2j ücretsiz: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
  await ctx.close();
}

// ---------------------------------------------------------------------------------
// 2) PRO sürüm (varsayılan: Android yok)
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);
  ok('3a sürüm: pro', await ev(() => window.dwgApp.edition() === 'pro' && window.dwgApp.isPro() === true && document.body.classList.contains('edition-pro')));
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
    ok('3h Hakkında: sürüm satırında "Pro"', /web[^\n]*· Pro/.test(about), about.split('\n').slice(0, 2).join(' | '));
    await ev(() => window.dwgApp.onBack());
  }
  ok('3i pro: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
  await ctx.close();
}

// ---------------------------------------------------------------------------------
// 3) edition() önceliği: Android.edition() > window.__edition > 'pro'; geçersiz köprü değeri __edition'a düşer
// ---------------------------------------------------------------------------------
for (const c of [
  { name: '4a Android.edition()="pro" + __edition="free" → pro (köprü üstün)', bridge: 'pro', w: 'free', want: 'pro' },
  { name: '4b Android.edition()="" (geçersiz) + __edition="free" → free', bridge: '', w: 'free', want: 'free' },
  { name: '4c Android.edition()="free" + __edition yok → free', bridge: 'free', w: null, want: 'free' },
  { name: '4d Android.edition() "sürüm" (geçersiz) + __edition yok → pro (varsayılan)', bridge: 'sürüm', w: null, want: 'pro' },
]) {
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  await ctx.addInitScript((c) => {
    if (c.w !== null) window.__edition = c.w;
    window.Android = { edition: () => c.bridge, proUrl: () => '', adsAvailable: () => c.bridge === 'free', showAd: () => {}, openUrl: () => {}, appVersion: () => '7.0', versionCode: () => '23', updateUrl: () => '', getPendingFile: () => '', getRecent: () => '[]', pickFile: () => {} };
  }, c);
  const page = await ctx.newPage(); hook(page);
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ e: window.dwgApp.edition(), pro: window.dwgApp.isPro(), cls: document.body.classList.contains('edition-pro') ? 'pro' : document.body.classList.contains('edition-free') ? 'free' : '-', tabs: [...document.querySelectorAll('#toolbar [data-tab]')].map(b => b.dataset.tab), proLine: document.getElementById('proLine').hidden }));
  const hasDraw = r.tabs.includes('draw') && r.tabs.includes('edit');
  ok(c.name, r.e === c.want && r.pro === (c.want === 'pro') && r.cls === c.want && hasDraw === (c.want === 'pro') && r.proLine === (c.want === 'pro'), JSON.stringify(r).slice(0, 200));
  await ctx.close();
}
ok('4e öncelik sınamaları: sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));

C.summary(errors);
await browser.close(); srv.kill();
C.exit();
