// i18n ve uygulama içi diyalog sınaması (example_2000.dwg): İngilizce kipte Ekran/3B panelleri, komut satırı, HUD, toast'lar,
// Hakkında ekranı; askText/askConfirm kutusunun DOM akışı (Tamam / Enter / Esc / geri tuşu / onay), eldiven modu; yerel prompt/confirm kalmadı.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_i18n.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, isUpdateDialog } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [], native = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { if (!isUpdateDialog(d)) native.push(d.type() + ':' + d.message().slice(0, 60)); await d.dismiss(); });
const TRc = /[çğıöşüÇĞİÖŞÜ]/;
const ev = (fn, a) => page.evaluate(fn, a);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const setLang = (l) => ev(async (l) => { const i = await import('./i18n.js'); i.setLang(l); i.applyI18n(); window.dwgApp.getSettings().lang = l; }, l);
const tapWorld = async (x, y) => { const s = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(200); };
const count = () => ev(() => window.dwgApp.state.scene.layouts[0].prims.length);
/** sekmeyi açar; etkin sekmeye ikinci dokunuş şeridi katladığından yalnız etkin değilse tıklar */
const tab = async (id) => { const on = await ev((id) => { const b = document.querySelector(`#toolbar [data-tab="${id}"]`); return !!b && b.classList.contains('active') && !document.getElementById('toolbar').classList.contains('collapsed'); }, id); if (!on) { await page.click(`#toolbar [data-tab="${id}"]`); await page.waitForTimeout(120); } };
const trWords = (s) => (s.match(/\S*[çğıöşüÇĞİÖŞÜ]\S*/g) || []).slice(0, 8).join(' ');
await page.goto(srv.url + 'index.html'); await page.waitForSelector('#btnOpen2');
await ev(() => localStorage.clear());
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); const t = document.getElementById('tour'); if (t) t.hidden = true; });

// ---- 1 İngilizce kip: paneller, aria, komut satırı, toast ----------------------------------------
await setLang('en');
{
  const a = await ev(() => ({ search: document.getElementById('btnSearch').getAttribute('aria-label'), coord: document.getElementById('stCoord').title, ph: document.getElementById('cmdInput').placeholder, tb: document.getElementById('toolbar').getAttribute('aria-label') }));
  ok('1a aria/title/placeholder EN', a.search === 'Search' && a.coord === 'Tap to copy' && !TRc.test(a.ph) && a.tb === 'Toolbar', JSON.stringify(a));
  await ev(() => window.dwgApp.display.openDisplayOptions()); await page.waitForTimeout(300);
  const d2 = await page.locator('#displayBody').innerText();
  ok('1b Ekran paneli (2B) Türkçe içermiyor', !TRc.test(d2) && /Preset|Theme|Visibility/.test(d2), trWords(d2));
  await shot('i_en_display2d');
  await ev(() => window.dwgApp.onBack());
  await tab('3d'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(700);
  await ev(() => window.dwgApp.display.openDisplayOptions({ seg: '3d' })); await page.waitForTimeout(400);
  const d3 = await page.locator('#displayBody').innerText();
  ok('1c 3B paneli Türkçe içermiyor', !TRc.test(d3) && /Style|Camera|Perspective/.test(d3), trWords(d3));
  await shot('i_en_display3d');
  await ev(() => window.dwgApp.onBack());
  const hud = await ev(() => window.dwgApp.editor.view3d().hudText());
  ok('1d HUD EN', /^Yaw .*Pitch .*Grid .*(Parallel|Persp\.)/.test(hud) && !TRc.test(hud), hud);
  const chip = (await page.locator('#stMode').innerText()).trim();
  ok('1e durum çipi EN', /^3D · (Ortho|Persp)$/.test(chip), chip);
  const vs = await ev(() => [...document.querySelectorAll('#cube3d button, #cube3d [role=button]')].map(b => b.textContent.trim() + '|' + (b.getAttribute('aria-label') || '')).join(' '));
  ok('1f küp düğmeleri Türkçe içermiyor', !TRc.test(vs), trWords(vs));
  await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(200);   // 3B kapat
  ok('1g 2B\'ye dönüldü', await ev(() => !window.dwgApp.editor.is3D()));
  await tab('edit'); await page.click('#toolbar [data-act="t:select"]'); await page.waitForTimeout(150);
  const cmd = (await page.locator('#cmdText').innerText()) + ' | ' + (await page.locator('#cmdBtns').innerText());
  ok('1h komut satırı EN', /^Select: Tap objects .*\[0 selected\]/.test(cmd) && /Finish/.test(cmd) && /Cancel/.test(cmd) && !TRc.test(cmd), cmd);
  await page.click('#cmdBtns [data-cmd="cancel"]');
  await tab('display'); await page.click('#toolbar .tb-row[data-for="display"] [data-act="hatch"]'); await page.waitForTimeout(100);
  const toast = await page.locator('#toast .tx').innerText();
  ok('1i tarama toast EN', toast === 'Hatches hidden', toast);
  await page.click('#toolbar .tb-row[data-for="display"] [data-act="hatch"]');
  await page.click('#btnLayers'); await page.waitForTimeout(200);
  const lb = await ev(() => [...document.querySelectorAll('#layerList .lbtn')].slice(0, 2).map(b => b.title).join(','));
  ok('1j katman düğmeleri EN', lb === 'Fade,Only this', lb);
  await ev(() => window.dwgApp.onBack());
  // düzenleme panelleri
  await tab('draw'); await page.click('#toolbar [data-act="layer"]'); await page.waitForTimeout(150);
  const lp = (await page.locator('#docTitle').innerText()) + ' | ' + (await page.locator('#docBody').innerText());
  ok('1k geçerli katman paneli EN', /^Current layer/.test(lp) && /Create layer/.test(lp) && !TRc.test(lp), trWords(lp));
  await ev(() => window.dwgApp.onBack());
}
// ---- 2 Hakkında -----------------------------------------------------------------------------------
{
  await page.click('#btnMore'); await page.click('#moreMenu [data-act="about"]'); await page.waitForTimeout(200);
  const ab = (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ');
  ok('2a Hakkında EN: destek/sınır/klavye/üçüncü taraf/lisans', /3DSOLID/.test(ab) && /Keyboard/.test(ab) && /Ctrl\+Z/.test(ab) && /jsQR \(Apache-2\.0\)/.test(ab) && /junrar \(MIT\)/.test(ab) && /GPL-3\.0/.test(ab) && /binary DXF/.test(ab) && !/view only|yalnız görüntüleme/i.test(ab) && !TRc.test(ab), trWords(ab) || ab.slice(0, 120));
  await shot('i_about_en');
  await ev(() => window.dwgApp.onBack());
  await setLang('tr');
  await page.click('#btnMore'); await page.click('#moreMenu [data-act="about"]'); await page.waitForTimeout(200);
  const at = (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ');
  ok('2b Hakkında TR: sürüm satırı, Klavye, Üçüncü taraf, ACIS', /DWG Görüntüleyici web/.test(at) && /Klavye/.test(at) && /Üçüncü taraf/.test(at) && /ACIS/.test(at) && /Hata kaydını paylaş/.test(at), at.slice(0, 160));
  await shot('i_about_tr');
  await ev(() => window.dwgApp.onBack());
}
// ---- 3 uygulama içi diyalog: yazı aracı (metin + yükseklik), Enter, Esc, geri tuşu, onay -----------
{
  await ev(() => window.dwgApp.zoomExtents([0, 0, 2000, 2000])); await page.waitForTimeout(150);
  const n0 = await count();
  await tab('draw'); await page.click('#toolbar [data-act="t:text"]');
  await tapWorld(500, 500);
  const d1 = await ev(() => { const d = document.getElementById('askDlg'); return d && !d.hidden ? { label: document.getElementById('askLabel').textContent, ta: !!d.querySelector('textarea#askIn'), focus: document.activeElement && document.activeElement.id, ok: document.getElementById('askOk').textContent, no: document.getElementById('askNo').textContent } : null; });
  ok('3a yazı kutusu açıldı (textarea, odak, Tamam/Vazgeç)', d1 && d1.label === 'Yazı:' && d1.ta && d1.focus === 'askIn' && d1.ok === 'Tamam' && d1.no === 'Vazgeç', JSON.stringify(d1));
  await shot('i_ask_text');
  await page.fill('#askIn', 'Kutu yazısı'); await page.click('#askOk'); await page.waitForTimeout(100);
  const d2 = await ev(() => { const d = document.getElementById('askDlg'); return !d.hidden ? { label: document.getElementById('askLabel').textContent, val: document.getElementById('askIn').value, mode: document.getElementById('askIn').getAttribute('inputmode') } : null; });
  ok('3b yükseklik kutusu (öntanımlı değer, decimal)', d2 && d2.label === 'Yazı yüksekliği:' && Number(d2.val) > 0 && d2.mode === 'decimal', JSON.stringify(d2));
  await page.fill('#askIn', '25'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  const t = await ev(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'TEXT' && q.info && q.info.edited); return p ? [p.lines.join(' '), p.ent.h] : null; });
  ok('3c Enter ile yazı eklendi', await count() === n0 + 1 && t && t[0] === 'Kutu yazısı' && t[1] === 25 && await ev(() => document.getElementById('askDlg').hidden), JSON.stringify(t));
  // Esc vazgeçer
  await tapWorld(700, 700); await page.waitForTimeout(100);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok('3d Esc → kutu kapandı, nesne eklenmedi, araç sürüyor', await ev(() => document.getElementById('askDlg').hidden) && await count() === n0 + 1 && await ev(() => window.dwgApp.editor.tools.running));
  // geri tuşu vazgeçer
  await tapWorld(900, 900); await page.waitForTimeout(100);
  const b = await ev(() => window.dwgApp.onBack());
  ok('3e geri tuşu → kutu kapandı (true), araç sürüyor', b === true && await ev(() => document.getElementById('askDlg').hidden && window.dwgApp.editor.tools.running));
  await page.click('#cmdBtns [data-cmd="cancel"]').catch(() => {});
  // onay kutusu
  const p1 = ev(async () => { const m = await import('./dialog.js'); return m.askConfirm('Silinsin mi?'); });
  await page.waitForTimeout(100);
  const c1 = await ev(() => { const d = document.getElementById('askDlg'); return { open: !d.hidden, confirm: d.classList.contains('confirm'), field: document.getElementById('askField').children.length, focus: document.activeElement && document.activeElement.id }; });
  await page.click('#askNo');
  const r1 = await p1;
  const p2 = ev(async () => { const m = await import('./dialog.js'); return m.askConfirm('Silinsin mi?'); });
  await page.waitForTimeout(100); await page.keyboard.press('Enter');
  const r2 = await p2;
  ok('3f onay kutusu: Vazgeç → false, Enter → true, giriş alanı yok', c1.open && c1.confirm && c1.field === 0 && c1.focus === 'askOk' && r1 === false && r2 === true, JSON.stringify({ c1, r1, r2 }));
  // eldiven modu ve tema
  await ev(async () => { const m = await import('./editor.js'); m.ui.glove = true; m.applyUi(); });
  const p3 = ev(async () => { const m = await import('./dialog.js'); return m.askText('Not metni:', 'x'); });
  await page.waitForTimeout(120);
  const g = await ev(() => { const b = document.getElementById('askOk').getBoundingClientRect(), card = getComputedStyle(document.querySelector('.ask-card')), panel = getComputedStyle(document.body).getPropertyValue('--panel').trim(); return { h: b.height, bg: card.backgroundColor, panel }; });
  const hex = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(h); return m ? `rgb(${parseInt(m[1].slice(0, 2), 16)}, ${parseInt(m[1].slice(2, 4), 16)}, ${parseInt(m[1].slice(4, 6), 16)})` : h; };
  ok('3g eldiven: düğme ≥ 52 px; kart tema panel rengi', g.h >= 52 && g.bg === hex(g.panel), JSON.stringify(g));
  await shot('i_ask_glove');
  await ev(async () => { const m = await import('./dialog.js'); m.cancel(); const e = await import('./editor.js'); e.ui.glove = false; e.applyUi(); });
  ok('3h cancel() → null', (await p3) === null);
  // sınama kuyruğu
  const q = await ev(async () => { const m = await import('./dialog.js'); window.__ask.queue.push('42', false); const a = await m.askText('k'); const b = await m.askConfirm('c'); return [a, b, document.getElementById('askDlg').hidden]; });
  ok('3i kuyruk: kutu açılmadan cevap', q[0] === '42' && q[1] === false && q[2] === true, JSON.stringify(q));
}
ok('4 yerel prompt/confirm açılmadı', native.length === 0, native.join(' | '));
ok('5 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
