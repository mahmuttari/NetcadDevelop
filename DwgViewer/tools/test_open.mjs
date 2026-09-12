// Dosya Aç merkezi (open.js) sınaması: tarayıcı yolu (sanal klasör ağacı, Son / sık kullanılan, tür süzgeci, sıralama, arama,
// Çevrimdışı açıklaması, Drive çipi, geri tuşu) ve sahte Android köprüsü yolu (fsRoots / fsList / fsSearch / fsOpen / fsSlot / getRecent / listDownloads).
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_open.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
import fs from 'node:fs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];
const hook = (page) => {
  page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/slot_1|404/.test(m.text())) { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });   // seçim kipi taklidinde /file/slot_1 yoktur
  onDialog(page, async d => { await d.dismiss(); });
};
const sampleFiles = fs.readdirSync(SM).filter(f => !f.startsWith('.'));
/** panelde görünen ve 40 px'ten alçak dokunma hedefleri */
const smallTargets = () => [...document.querySelectorAll('#openPanel button, #openPanel select, #openPanel input')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40; }).map(b => (b.id || b.className) + ':' + Math.round(b.getBoundingClientRect().height));
const cadN = sampleFiles.filter(f => /\.(dwg|dxf)$/i.test(f)).length;

// ---------------------------------------------------------------------------------
// 1) Tarayıcı yolu
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const rows = () => ev(() => [...document.querySelectorAll('#openBody [data-open-entry]')].map(r => ({ name: r.dataset.name, dir: r.dataset.dir === '1', size: +r.dataset.size })));
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2');
  // açılış / kapanış / sekmeler
  await page.click('#btnOpen2'); await page.waitForTimeout(100);
  ok('1a merkez açılır (karşılama kartı)', await ev(() => !document.getElementById('openPanel').hidden && document.querySelectorAll('#openChips [data-open-tab]').length === 3 && document.querySelectorAll('#openChips [data-open-go]').length === 3 && !!document.querySelector('#openPanel .sheet-handle')));
  ok('1b son dosya yokken Cihaz sekmesi', await ev(() => document.querySelector('#openChips [data-open-tab="device"]').classList.contains('on') && !!document.querySelector('#openBody [data-open="addroot"]')));
  await shot('o_device_empty');
  await page.click('#openChips [data-open-tab="recent"]'); await page.waitForTimeout(60);
  ok('1c Son sekmesi boş açıklaması', await ev(() => document.querySelector('#openChips [data-open-tab="recent"]').classList.contains('on') && /Henüz dosya/.test(document.getElementById('openBody').textContent) && !document.getElementById('openGrid').hidden));
  await page.click('#openPanel [data-open="close"]'); await page.waitForTimeout(60);
  ok('1d kapat', await ev(() => document.getElementById('openPanel').hidden));
  await page.click('#btnOpen'); await page.waitForTimeout(60);
  ok('1e üst çubuk düğmesi açar (son sekme hatırlanır)', await ev(() => !document.getElementById('openPanel').hidden && document.querySelector('#openChips [data-open-tab="recent"]').classList.contains('on')));
  // klasör girişi (Playwright dizin yükler)
  await page.click('#openChips [data-open-tab="device"]'); await page.waitForTimeout(60);
  await page.setInputFiles('#folderInput', SM);
  await page.waitForFunction((n) => document.querySelectorAll('#openBody [data-open-entry]').length >= n, sampleFiles.length, { timeout: 10000 });
  {
    const r = await ev(() => ({ crumb: document.querySelector('#openBody [data-open-crumb="-1"]')?.textContent.trim(), roots: document.querySelectorAll('#openBody [data-open-root]').length, on: !!document.querySelector('#openBody [data-open-root].on'), n: document.querySelectorAll('#openBody [data-open-entry]').length, h: Math.min(...[...document.querySelectorAll('#openBody .open-item')].map(e => e.getBoundingClientRect().height)) }));
    ok('1f sanal ağaç: kök çipi, kırıntı, satırlar (48 px)', r.crumb === 'samples' && r.roots === 1 && r.on && r.n === sampleFiles.length && r.h >= 48, JSON.stringify(r));
  }
  await shot('o_device_list');
  // dokunma hedefleri: kök seçili, kırıntı çubuğu ve satırlar ekrandayken (boş panelde denetim boş kümeyle geçerdi)
  { const bad = await ev(smallTargets); ok('1ae dokunma hedefleri ≥ 40 px (kırıntı dâhil)', bad.length === 0 && await ev(() => document.querySelectorAll('#openBody [data-open-crumb]').length >= 1), bad.join(' ')); }
  // tür süzgeci
  await page.selectOption('#openKind', 'cad'); await page.waitForTimeout(60);
  { const r = await rows(); ok('1g tür süzgeci Çizim → yalnız dwg/dxf', r.length === cadN && r.every(x => /\.(dwg|dxf)$/i.test(x.name)), r.length + '/' + cadN); }
  await page.selectOption('#openKind', 'all'); await page.waitForTimeout(60);
  ok('1h süzgeç Tümü', (await rows()).length === sampleFiles.length);
  // sıralama
  await page.selectOption('#openSort', 'size'); await page.waitForTimeout(60);
  { const r = await rows(); ok('1i boyuta göre azalan', r.every((x, i) => i === 0 || r[i - 1].size >= x.size) && r[0].size === Math.max(...r.map(x => x.size)), r.slice(0, 3).map(x => x.name + ':' + x.size).join(' ')); }
  await page.selectOption('#openSort', 'name'); await page.waitForTimeout(60);
  { const r = await rows(); const names = r.map(x => x.name); const sorted = names.slice().sort((a, b) => a.localeCompare(b, 'tr')); ok('1j ada göre (tr)', JSON.stringify(names) === JSON.stringify(sorted), names.slice(0, 4).join(' ')); }
  // arama (3+ karakter → özyinelemeli arama)
  await page.fill('#openSearch', 'pface');
  await page.waitForFunction(() => /pface/.test(document.querySelector('#openBody .muted')?.textContent || ''), null, { timeout: 5000 });
  { const r = await rows(); const want = sampleFiles.filter(f => /pface/i.test(f)).length; ok('1k arama sonucu', r.length === want && r.every(x => /pface/i.test(x.name)), r.length + '/' + want); }
  await shot('o_search');
  await page.fill('#openSearch', '');
  await page.waitForFunction((n) => document.querySelectorAll('#openBody [data-open-entry]').length === n && !document.querySelector('#openBody .muted'), sampleFiles.length, { timeout: 5000 });
  ok('1l arama temizlenince liste', true);
  // dosyaya dokun → çizim yüklenir
  await page.click('#openBody [data-open-entry][data-name="example_2000.dwg"]');
  await page.waitForFunction(() => window.dwgApp.state.hasDoc && window.dwgApp.state.fileName === 'example_2000.dwg' && document.getElementById('loading').hidden, null, { timeout: 120000 });
  ok('1m dwg yüklendi, merkez kapandı', await ev(() => document.getElementById('openPanel').hidden && window.dwgApp.state.entityCount > 0));
  await ev(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });
  // Son sekmesi: kayıt, menü, sık kullanılan
  await page.click('#btnOpen'); await page.waitForTimeout(80);
  await page.click('#openChips [data-open-tab="recent"]'); await page.waitForTimeout(60);
  ok('1n Son listesinde kayıt', await ev(() => document.querySelectorAll('#openBody [data-open-recent]').length === 1 && document.querySelector('#openBody [data-open-recent]').dataset.name === 'example_2000.dwg' && !!document.querySelector('#openBody .open-item .open-thumb')));
  await page.click('#openBody [data-open-recent] [data-open="menu"]'); await page.waitForTimeout(60);
  ok('1o satır menüsü', await ev(() => ['open', 'fav', 'remove'].every(a => !!document.querySelector(`#openBody [data-open-act="${a}"]`))));
  await shot('o_recent_menu');
  await page.click('#openBody [data-open-act="fav"]'); await page.waitForTimeout(60);
  { const r = await ev(() => ({ fav: JSON.parse(localStorage.getItem('open:fav') || '[]'), row: !!document.querySelector('#openBody .open-item.fav[data-name="example_2000.dwg"]'), secs: document.querySelectorAll('#openBody .open-sec').length })); ok('1p sık kullanılana ekle', r.fav.length === 1 && r.fav[0].name === 'example_2000.dwg' && r.row && r.secs === 1, JSON.stringify(r)); }
  await page.click('#openBody [data-open-recent] [data-open="menu"]'); await page.waitForTimeout(60);
  ok('1q menüde "çıkar"', /çıkar/i.test(await ev(() => document.querySelector('#openBody [data-open-act="fav"]').textContent)));
  await page.click('#openBody [data-open-act="fav"]'); await page.waitForTimeout(60);
  ok('1r sık kullanılandan çıkar', await ev(() => JSON.parse(localStorage.getItem('open:fav') || '[]').length === 0 && !document.querySelector('#openBody .open-item.fav')));
  // ızgara görünümü
  await page.click('#openGrid'); await page.waitForTimeout(60);
  { const r = await ev(() => { const t = document.querySelector('#openBody .open-tile .open-thumb'); const b = t && t.getBoundingClientRect(); return { tile: !!t, w: b && Math.round(b.width), h: b && Math.round(b.height), on: document.getElementById('openGrid').classList.contains('on') }; }); ok('1s ızgara 96×72', r.tile && r.w === 96 && r.h === 72 && r.on, JSON.stringify(r)); }
  await shot('o_recent_grid');
  await page.click('#openGrid'); await page.waitForTimeout(60);
  // başka dosya aç, Son'dan ilkini yeniden aç
  await ev(() => window.dwgApp.onBack());
  await openFile(page, `${SM}/test_tr.dxf`, { settle: 300 });
  await ev(() => { document.getElementById('toast').hidden = true; });
  await page.click('#btnOpen'); await page.waitForTimeout(80);
  ok('1t iki kayıt, en yeni başta', await ev(() => { const r = [...document.querySelectorAll('#openBody [data-open-recent]')].map(x => x.dataset.name); return r.length === 2 && r[0] === 'test_tr.dxf'; }));
  await page.click('#openBody [data-open-recent][data-name="example_2000.dwg"]');
  await page.waitForFunction(() => window.dwgApp.state.hasDoc && window.dwgApp.state.fileName === 'example_2000.dwg' && document.getElementById('loading').hidden, null, { timeout: 120000 });
  ok('1u Son\'dan yeniden açıldı', await ev(() => document.getElementById('openPanel').hidden));
  await ev(() => { document.getElementById('toast').hidden = true; });
  // listeden kaldır
  await page.click('#btnOpen'); await page.waitForTimeout(80);
  await page.click('#openBody [data-open-recent][data-name="test_tr.dxf"] [data-open="menu"]'); await page.waitForTimeout(60);
  await page.click('#openBody [data-open-act="remove"]'); await page.waitForTimeout(60);
  ok('1v listeden kaldır', await ev(() => document.querySelectorAll('#openBody [data-open-recent]').length === 1));
  // arama Son sekmesinde de çalışır
  await page.fill('#openSearch', 'yok'); await page.waitForTimeout(400);
  ok('1w Son sekmesinde arama', await ev(() => document.querySelectorAll('#openBody [data-open-recent]').length === 0 && /Sonuç yok/.test(document.getElementById('openBody').textContent)));
  await page.fill('#openSearch', ''); await page.waitForTimeout(400);
  // Çevrimdışı (Android yok)
  await page.click('#openChips [data-open-tab="offline"]'); await page.waitForTimeout(60);
  ok('1x Çevrimdışı açıklaması', await ev(() => /Android/.test(document.querySelector('#openBody .doc-card')?.textContent || '')));
  await shot('o_offline_browser');
  // Drive çipi → Drive paneli
  await page.click('#openChips [data-open-go="drive"]'); await page.waitForTimeout(100);
  ok('1y Drive çipi', await ev(() => document.getElementById('openPanel').hidden && !document.getElementById('drivePanel').hidden));
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(60);
  // Sunucu çipi → sunucu kutusu, oradan Çevrimdışı bağlantısı merkeze döner
  await page.click('#btnOpen'); await page.waitForTimeout(60);
  await page.click('#openChips [data-open-go="server"]'); await page.waitForTimeout(100);
  ok('1z Sunucu çipi', await ev(() => document.getElementById('openPanel').hidden && !document.getElementById('docPanel').hidden && !!document.getElementById('srvOffline') && !document.querySelector('#docBody [data-dl]')));
  await page.click('#srvOffline'); await page.waitForTimeout(60);
  ok('1aa sunucu → Çevrimdışı', await ev(() => !document.getElementById('openPanel').hidden && document.getElementById('docPanel').hidden && document.querySelector('#openChips [data-open-tab="offline"]').classList.contains('on')));
  // geri tuşu
  const b = await ev(() => window.dwgApp.onBack());
  ok('1ab geri tuşu kapatır', b === true && await ev(() => document.getElementById('openPanel').hidden));
  // tutamakla kapatma (sürükle)
  await page.click('#btnOpen'); await page.waitForTimeout(80);
  { const hb = await page.locator('#openPanel .sheet-handle').boundingBox(); await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2, hb.y + 300, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300); }
  ok('1ac tutamakla kapat', await ev(() => document.getElementById('openPanel').hidden));
  // kökü kaldır (tarayıcı)
  await page.click('#btnOpen'); await page.click('#openChips [data-open-tab="device"]'); await page.waitForTimeout(60);
  await page.click('#openBody [data-open="rootmenu"]'); await page.waitForTimeout(60);
  await page.click('#openBody [data-open="removeroot"]'); await page.waitForTimeout(60);
  ok('1ad kökü kaldır', await ev(() => !document.querySelector('#openBody [data-open-root]') && !!document.querySelector('#openBody [data-open="addroot"]')));
  // yatay düzen
  await page.setViewportSize({ width: 915, height: 412 }); await page.waitForTimeout(300);
  { const r = await ev(() => { const p = document.getElementById('openPanel').getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect(); return { w: Math.round(p.width), right: Math.abs(p.right - a.right) < 2, tall: p.height <= a.height + 1, left: p.left > a.width / 3 }; }); ok('1af yatay düzen: sağda dar panel', r.w <= 420 && r.right && r.tall && r.left, JSON.stringify(r)); }
  await shot('o_landscape');
  await ev(() => window.dwgApp.onBack());
  await ctx.close();
}

// ---------------------------------------------------------------------------------
// 2) Sahte Android köprüsü
// ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext(PHONE); await noUpdate(ctx);
  await ctx.addInitScript(() => {
    const calls = (window.__calls = []);
    const roots = (window.__roots = [{ uri: 'content://tree/A', name: 'Projeler', time: 1, ok: true }, { uri: 'content://tree/B', name: 'Eski Kart', time: 2, ok: false }]);
    const tree = { '': [{ id: 'd1', name: 'Projeler', dir: true, size: 0, time: 0, mime: 'vnd.android.document/directory' }, { id: 'f1', name: 'plan.dwg', dir: false, size: 5000, time: 1700000000000, mime: 'application/acad' }, { id: 'f2', name: 'rapor.pdf', dir: false, size: 800, time: 1700000100000, mime: 'application/pdf' }],
      d1: [{ id: 'f3', name: 'kesit.dxf', dir: false, size: 1200, time: 1700000200000, mime: '' }] };
    const recent = (window.__recent = [{ uri: 'content://x/1', name: 'pafta1.dwg', size: 1000, time: 1700000300000, key: 'k1', thumb: false }, { uri: 'content://x/2', name: 'eski.pdf', size: 2000, time: 1700000000000, key: 'k2', thumb: false }]);
    const dls = (window.__dls = [{ id: 'dl_1_pafta.dwg', name: 'pafta.dwg', size: 3000, time: 1700000400000 }]);
    const later = (fn) => setTimeout(fn, 20);
    window.Android = {
      fsRoots: () => JSON.stringify(roots),
      fsAddRoot: (hint) => { calls.push(['fsAddRoot', hint]); later(() => { const r = { uri: 'content://tree/DL', name: 'Download', time: 3, ok: true }; roots.push(r); window.dwgApp.onFsRoot(r); }); },
      fsRemoveRoot: (uri) => { calls.push(['fsRemoveRoot', uri]); const i = roots.findIndex(r => r.uri === uri); if (i >= 0) roots.splice(i, 1); },
      fsList: (id, root, docId) => { calls.push(['fsList', root, docId]); later(() => { if (root === 'content://tree/B') window.dwgApp.onFs(id, false, 'izin yok'); else window.dwgApp.onFs(id, true, { items: root === 'content://tree/DL' ? [] : (tree[docId] || []) }); }); },
      fsSearch: (id, root, q) => { calls.push(['fsSearch', root, q]); later(() => window.dwgApp.onFs(id, true, JSON.stringify({ items: [{ id: 'f3', name: 'kesit.dxf', dir: false, size: 1200, time: 1700000200000, mime: '', parent: 'Projeler/Alt' }], truncated: true }))); },
      fsOpen: (root, id, name, size) => { calls.push(['fsOpen', root, id, name, size]); },
      fsSlot: (root, id) => { calls.push(['fsSlot', root, id]); return 'slot_1'; },
      getRecent: () => JSON.stringify(recent), removeRecent: (uri) => { calls.push(['removeRecent', uri]); const i = recent.findIndex(r => r.uri === uri); if (i >= 0) recent.splice(i, 1); }, openRecent: (uri) => { calls.push(['openRecent', uri]); },
      listDownloads: () => JSON.stringify(dls), openDownload: (id) => { calls.push(['openDownload', id]); }, deleteDownload: (id) => { calls.push(['deleteDownload', id]); const i = dls.findIndex(d => d.id === id); if (i >= 0) dls.splice(i, 1); },
      pickFile: (p, m) => { calls.push(['pickFile', p, m]); }, getPendingFile: () => '', saveThumb: () => {},
      loadText: (k) => localStorage.getItem(k) || '', saveText: (k, v) => localStorage.setItem(k, v),
    };
  });
  const page = await ctx.newPage(); hook(page);
  const ev = (fn, a) => page.evaluate(fn, a);
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
  const calls = () => ev(() => window.__calls);
  const last = (name) => ev((n) => window.__calls.filter(c => c[0] === n).pop() || null, name);
  await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
  await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
  await page.reload(); await page.waitForSelector('#btnOpen2');
  ok('2a karşılama şeridi + Tümü…', await ev(() => !document.getElementById('recentWrap').hidden && document.querySelectorAll('#recentList .item').length === 2 && !!document.getElementById('recentAll')));
  await page.click('#recentAll'); await page.waitForTimeout(80);
  ok('2b Tümü… → Son sekmesi', await ev(() => !document.getElementById('openPanel').hidden && document.querySelector('#openChips [data-open-tab="recent"]').classList.contains('on') && document.querySelectorAll('#openBody [data-open-recent]').length === 2));
  // uzun basış (gerçek dokunma, CDP): 700 ms basılı tut, bırak — menü açılır; alt sayfa büyüyüp içerik parmağın altında kaysa da
  // bırakınca gelen click eylem çipine (Listeden kaldır) inmemeli: removeRecent / openRecent ÇAĞRILMAZ, menü açık kalır
  {
    const cdp = await ctx.newCDPSession(page);
    const bb = await page.locator('#openBody [data-open-recent][data-name="pafta1.dwg"]').boundingBox();
    const x = bb.x + 40, y = bb.y + bb.height / 2, n0 = (await calls()).length;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(700);
    const shifted = await ev(() => !!document.querySelector('#openBody [data-open-acts]'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const r = await ev((n0) => ({ acts: !!document.querySelector('#openBody [data-open-acts="content://x/1"]'), rows: document.querySelectorAll('#openBody [data-open-recent]').length, open: !document.getElementById('openPanel').hidden, calls: window.__calls.slice(n0).map(c => c[0]) }), n0);
    ok('2b2 uzun basış: menü açılır, bırakınca çipe tıklanmaz', shifted && r.acts && r.rows === 2 && r.open && r.calls.length === 0, JSON.stringify(r));
    await shot('a_longpress');
    // menü açıkken sıradan dokunuş çalışmaya devam eder (bayrak asılı kalmaz): çipe dokun → sık kullanılana eklenir
    await page.click('#openBody [data-open-act="fav"]'); await page.waitForTimeout(60);
    ok('2b3 uzun basıştan sonra çip dokunuşu işler', await ev(() => JSON.parse(localStorage.getItem('open:fav') || '[]').length === 1 && !document.querySelector('#openBody [data-open-acts]')));
    await page.click('#openBody [data-open-recent][data-name="pafta1.dwg"] [data-open="menu"]'); await page.click('#openBody [data-open-act="fav"]'); await page.waitForTimeout(60);
    await cdp.detach();
  }
  await page.click('#openBody [data-open-recent][data-name="eski.pdf"]'); await page.waitForTimeout(60);
  ok('2c Son → openRecent(uri)', JSON.stringify(await last('openRecent')) === JSON.stringify(['openRecent', 'content://x/2']) && await ev(() => document.getElementById('openPanel').hidden));
  await page.click('#btnOpen'); await page.waitForTimeout(60);
  await page.click('#openBody [data-open-recent][data-name="eski.pdf"] [data-open="menu"]'); await page.click('#openBody [data-open-act="remove"]'); await page.waitForTimeout(60);
  ok('2d listeden kaldır → removeRecent', JSON.stringify(await last('removeRecent')) === JSON.stringify(['removeRecent', 'content://x/2']) && await ev(() => document.querySelectorAll('#openBody [data-open-recent]').length === 1 && document.querySelectorAll('#recentList .item').length === 1));
  // sık kullanılan Son listesinden düşünce (RECENT_MAX) soluk çizilir ama URI yaşadığı sürece Android'de açılır: openRecent(uri) çağrılır
  await page.click('#openBody [data-open-recent][data-name="pafta1.dwg"] [data-open="menu"]'); await page.click('#openBody [data-open-act="fav"]'); await page.waitForTimeout(60);
  await ev(() => { window.__recent.length = 0; window.dwgApp.refreshRecent(); window.dwgApp.open.refresh(); }); await page.waitForTimeout(60);
  ok('2d2 Son\'dan düşmüş sık kullanılan soluk satır', await ev(() => !!document.querySelector('#openBody .open-item.fav.dim[data-name="pafta1.dwg"]')));
  await page.click('#openBody [data-open-recent][data-name="pafta1.dwg"]'); await page.waitForTimeout(60);
  ok('2d3 soluk sık kullanılan → openRecent(uri)', JSON.stringify(await last('openRecent')) === JSON.stringify(['openRecent', 'content://x/1']) && await ev(() => document.getElementById('openPanel').hidden));
  await page.click('#btnOpen'); await page.waitForTimeout(60);
  await page.click('#openBody [data-open-recent][data-name="pafta1.dwg"] [data-open="menu"]'); await page.click('#openBody [data-open-act="open"]'); await page.waitForTimeout(60);
  ok('2d4 satır menüsü "Aç" → openRecent(uri)', await ev(() => window.__calls.filter(c => c[0] === 'openRecent').length === 3 && document.getElementById('openPanel').hidden));
  await ev(() => { localStorage.setItem('open:fav', '[]'); });
  await page.click('#btnOpen'); await page.waitForTimeout(60);
  // Cihaz: kökler
  await page.click('#openChips [data-open-tab="device"]'); await page.waitForTimeout(60);
  ok('2e kök çipleri (izinsiz kök soluk) + İndirilenler düğmesi', await ev(() => document.querySelectorAll('#openBody [data-open-root]').length === 2 && document.querySelector('#openBody [data-open-root="content://tree/B"]').classList.contains('dim') && !!document.querySelector('#openBody [data-open="adddl"]')));
  await shot('a_roots');
  await page.click('#openBody [data-open-root="content://tree/A"]');
  await page.waitForFunction(() => document.querySelectorAll('#openBody [data-open-entry]').length === 3, null, { timeout: 5000 });
  { const r = await ev(() => ({ first: document.querySelector('#openBody [data-open-entry]').dataset.name, crumb: document.querySelectorAll('#openBody [data-open-crumb]').length, last: JSON.parse(localStorage.getItem('open:last') || '{}') })); ok('2f fsList kök: klasör önce, kırıntı, open:last', r.first === 'Projeler' && r.crumb === 1 && r.last.root === 'content://tree/A', JSON.stringify(r)); }
  ok('2g fsList("") çağrısı', JSON.stringify(await last('fsList')) === JSON.stringify(['fsList', 'content://tree/A', '']));
  await page.click('#openBody [data-open-entry][data-dir="1"]');
  await page.waitForFunction(() => document.querySelectorAll('#openBody [data-open-crumb]').length === 2 && document.querySelectorAll('#openBody [data-open-entry]').length === 1, null, { timeout: 5000 });
  ok('2h alt klasör: fsList(docId), kırıntı 2', JSON.stringify(await last('fsList')) === JSON.stringify(['fsList', 'content://tree/A', 'd1']) && await ev(() => document.querySelector('#openBody [data-open-entry]').dataset.name === 'kesit.dxf'));
  await shot('a_subdir');
  { const bad = await ev(smallTargets); ok('2h2 alt klasörde dokunma hedefleri ≥ 40 px (kırıntı çipleri)', bad.length === 0 && await ev(() => document.querySelectorAll('#openBody [data-open-crumb]').length === 2), bad.join(' ')); }
  // arama
  await page.fill('#openSearch', 'kes');
  await page.waitForFunction(() => !!document.querySelector('#openBody .open-warn'), null, { timeout: 5000 });
  { const r = await ev(() => ({ n: document.querySelectorAll('#openBody [data-open-entry]').length, parent: document.querySelector('#openBody [data-open-entry] .open-meta')?.textContent, warn: !!document.querySelector('#openBody .open-warn') })); ok('2i fsSearch: parent yolu + kısaltıldı uyarısı', r.n === 1 && r.parent === 'Projeler/Alt' && r.warn && JSON.stringify(await last('fsSearch')) === JSON.stringify(['fsSearch', 'content://tree/A', 'kes']), JSON.stringify(r)); }
  await shot('a_search');
  await page.fill('#openSearch', '');
  await page.waitForFunction(() => !document.querySelector('#openBody .open-warn') && document.querySelectorAll('#openBody [data-open-entry]').length === 1, null, { timeout: 5000 });
  // kırıntı ile köke dön, dosya aç
  await page.click('#openBody [data-open-crumb="-1"]');
  await page.waitForFunction(() => document.querySelectorAll('#openBody [data-open-entry]').length === 3, null, { timeout: 5000 });
  await page.click('#openBody [data-open-entry][data-name="plan.dwg"]'); await page.waitForTimeout(60);
  ok('2j fsOpen(root, id, name, size) ve panel kapanır', JSON.stringify(await last('fsOpen')) === JSON.stringify(['fsOpen', 'content://tree/A', 'f1', 'plan.dwg', 5000]) && await ev(() => document.getElementById('openPanel').hidden));
  // seçim kipi
  await ev(() => window.dwgApp.open.open('device', { pick: { purpose: 'compare', mime: '*/*' } }));
  await page.waitForFunction(() => document.querySelectorAll('#openBody [data-open-entry]').length === 3, null, { timeout: 5000 });
  ok('2k seçim kipi: yalnız Cihaz çipi, açıklama', await ev(() => !!document.querySelector('#openBody .open-pick') && document.querySelector('#openChips [data-open-tab="recent"]').hidden && !document.querySelector('#openChips [data-open-go]')));
  await shot('a_pick');
  await page.click('#openBody [data-open-entry][data-name="rapor.pdf"]'); await page.waitForTimeout(150);
  ok('2l seçim → fsSlot(root, id) → onFilePicked', JSON.stringify(await last('fsSlot')) === JSON.stringify(['fsSlot', 'content://tree/A', 'f2']) && await ev(() => document.getElementById('openPanel').hidden));
  await ev(() => window.dwgApp.open.open('device', { pick: { purpose: 'compare', mime: '*/*' } })); await page.waitForTimeout(60);
  await page.click('#openPanel [data-open="system"]'); await page.waitForTimeout(60);
  ok('2m seçim kipinde sistem seçicisi pickFile(purpose, mime)', JSON.stringify(await last('pickFile')) === JSON.stringify(['pickFile', 'compare', '*/*']) && await ev(() => document.getElementById('openPanel').hidden));
  // İndirilenler kökü ekle → onFsRoot → yeni kök seçilir
  await page.click('#btnOpen'); await page.waitForTimeout(60);
  await page.click('#openBody [data-open="adddl"]');
  await page.waitForFunction(() => !!document.querySelector('#openBody [data-open-root="content://tree/DL"].on') && /Klasör boş/.test(document.getElementById('openBody').textContent), null, { timeout: 5000 });
  ok('2n fsAddRoot("download") → onFsRoot → kök seçili, fsList(yeni kök)', JSON.stringify(await last('fsAddRoot')) === JSON.stringify(['fsAddRoot', 'download']) && JSON.stringify(await last('fsList')) === JSON.stringify(['fsList', 'content://tree/DL', '']) && await ev(() => /Klasör boş/.test(document.getElementById('openBody').textContent)));
  // izinsiz kök → yenile kartı; kökü kaldır
  await page.click('#openBody [data-open-root="content://tree/B"]'); await page.waitForTimeout(60);
  ok('2o izinsiz kök kartı', await ev(() => /izni kaybolmuş/i.test(document.querySelector('#openBody .doc-card')?.textContent || '') && !!document.querySelector('#openBody .doc-card [data-open="addroot"]')));
  await page.click('#openBody .doc-card [data-open="removeroot"]'); await page.waitForTimeout(60);
  ok('2p fsRemoveRoot', JSON.stringify(await last('fsRemoveRoot')) === JSON.stringify(['fsRemoveRoot', 'content://tree/B']) && await ev(() => document.querySelectorAll('#openBody [data-open-root]').length === 2));
  // fsList hatası kartı
  await ev(() => { window.__roots.push({ uri: 'content://tree/B', name: 'Hatalı', time: 5, ok: true }); });
  await page.click('#openChips [data-open-tab="recent"]'); await page.click('#openChips [data-open-tab="device"]'); await page.waitForTimeout(60);
  await page.click('#openBody [data-open-root="content://tree/B"]');
  await page.waitForFunction(() => /izin yok/.test(document.getElementById('openBody').textContent), null, { timeout: 5000 });
  ok('2q onFs(ok=false) hata kartı', true);
  // Çevrimdışı
  await page.click('#openChips [data-open-tab="offline"]'); await page.waitForTimeout(60);
  ok('2r çevrimdışı listesi', await ev(() => document.querySelectorAll('#openBody [data-open-dl]').length === 1 && document.querySelector('#openBody [data-open-dl]').dataset.name === 'pafta.dwg'));
  await shot('a_offline');
  await page.click('#openBody [data-open-dl]'); await page.waitForTimeout(60);
  ok('2s aç → openDownload(id)', JSON.stringify(await last('openDownload')) === JSON.stringify(['openDownload', 'dl_1_pafta.dwg']) && await ev(() => document.getElementById('openPanel').hidden));
  await page.click('#btnOpen'); await page.waitForTimeout(60);
  await queueAnswers(page, true);
  await page.click('#openBody [data-open-dl] [data-open="deldl"]'); await page.waitForTimeout(150);
  ok('2t sil → deleteDownload(id)', JSON.stringify(await last('deleteDownload')) === JSON.stringify(['deleteDownload', 'dl_1_pafta.dwg']) && await ev(() => document.querySelectorAll('#openBody [data-open-dl]').length === 0));
  // sunucu kutusunda çevrimdışı bloğu yok
  await page.click('#openChips [data-open-go="server"]'); await page.waitForTimeout(100);
  ok('2u sunucu kutusu çevrimdışı listesi taşımaz', await ev(() => !document.querySelector('#docBody [data-dl]') && !!document.getElementById('srvOffline')));
  await ev(() => window.dwgApp.onBack());
  ok('2v köprü çağrıları', (await calls()).every(c => typeof c[0] === 'string'));
  await ctx.close();
}
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
