// Masaüstü kipi: klavye ve fare bağlıyken AutoCAD davranışı.
//  1) desktop.js saf mantığı: tuş çözümü, ortho ve kutupsal kısıt, öncelik sırası.
//  2) Sezim: gerçek fare olayı kipi açar, artı imleç gelir.
//  3) Fare: orta tuş kaydırır ve SEÇMEZ, çift tıklama sınırlara oturur, sağ tuş Enter'dır.
//  4) Klavye: harf komut satırına düşer, F3/F7/F8/F10 AutoCAD atamalarıyla çalışır.
//  5) Ortho gerçekten kilitler; YAKALAMA ortho'yu yener (AutoCAD önceliği).
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_masaustu.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker } from './harness.mjs';

const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];

// Masaüstü bağlamı: fare var, dokunma yok — DeX / klavye-fare bağlı tablet karşılığı
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 600 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });

const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const view = () => ev(() => ({ cx: window.dwgApp.state.view.cx, cy: window.dwgApp.state.view.cy, scale: window.dwgApp.state.view.scale }));
const aktif = () => ev(() => window.dwgApp.editor.tools.active);
const secili = () => ev(() => { const s = window.dwgApp.state.selected; return s ? s.key : null; });
const desk = () => ev(() => JSON.parse(JSON.stringify(window.dwgApp.state.desk)));
const box = async () => page.locator('#viewport').boundingBox();
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await page.waitForTimeout(150); };
const scr = (x, y) => ev(([a, b]) => { const s = window.dwgApp.toScreen(a, b); return { x: s[0], y: s[1] }; }, [x, y]);
const setUi = (o) => ev(async (q) => { const E = await import('./editor.js'); Object.assign(E.ui, q); window.dispatchEvent(new CustomEvent('dwg:ui')); }, o);
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims; const q = p[p.length - 1]; return q && q.ops ? q.ops.map(o => o.slice()) : null; });
const yak = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ---------------------------------------------------------------------------------
// 1) Saf mantık
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const D = await import('./desktop.js');
    const K = (k, o = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
    return {
      f8: D.resolveKey(K('F8')), f3: D.resolveKey(K('F3')), f10: D.resolveKey(K('F10')), f7: D.resolveKey(K('F7')),
      f9: D.resolveKey(K('F9')), f12: D.resolveKey(K('F12')),
      ctrlZ: D.resolveKey(K('z', { ctrlKey: true })), ctrlShiftZ: D.resolveKey(K('z', { ctrlKey: true, shiftKey: true })),
      ctrlS: D.resolveKey(K('s', { ctrlKey: true })), ctrlShiftS: D.resolveKey(K('S', { ctrlKey: true, shiftKey: true })), ctrlQ: D.resolveKey(K('q', { ctrlKey: true })),
      duz: D.resolveKey(K('a')),
      harf: D.isCommandChar(K('l')), rakam: D.isCommandChar(K('3')), ctrlHarf: D.isCommandChar(K('l', { ctrlKey: true })),
      ok: D.isCommandChar(K('ArrowUp')), bosluk: D.isCommandChar(K(' ')),
      oY: D.orthoPoint([0, 0, 0], [10, 3, 0]), oD: D.orthoPoint([0, 0, 0], [3, 10, 0]),
      p15: D.polarPoint([0, 0, 0], [10, 1, 0], 15), p45: D.polarPoint([0, 0, 0], [10, 9, 0], 45),
      kYakalama: D.constrain([0, 0, 0], [10, 3, 0], { snapped: true, ortho: true }),
      kOrtho: D.constrain([0, 0, 0], [10, 3, 0], { ortho: true, polar: true }),
      kYok: D.constrain([0, 0, 0], [10, 3, 0], {}),
      tabanYok: D.constrain(null, [10, 3, 0], { ortho: true }),
    };
  });
  ok('1a F8 ortho, F10 kutupsal, F3 yakalama, F7 ızgara (AutoCAD atamaları)',
    g.f8.special === 'ortho' && g.f10.special === 'polar' && g.f3.act === 'osnap' && g.f7.act === 'grid',
    JSON.stringify({ f8: g.f8, f10: g.f10, f3: g.f3, f7: g.f7 }));
  ok('1b karşılığı OLMAYAN işlev tuşu boş bırakılmış (F9, F12 uydurulmadı)', g.f9 === null && g.f12 === null);
  ok('1c Ctrl kısayolları: Z geri, Shift+Z ileri, S kaydet (QSAVE), Shift+S farklı kaydet (SAVEAS); tanımsız olan null', g.ctrlZ.act === 'undo' && g.ctrlShiftZ.act === 'redo' && g.ctrlS.act === 'save' && g.ctrlShiftS.act === 'saveas' && g.ctrlQ === null, JSON.stringify({ z: g.ctrlZ, sz: g.ctrlShiftZ, s: g.ctrlS, ss: g.ctrlShiftS, q: g.ctrlQ }));
  ok('1d değiştiricisiz düz harf kısayol DEĞİLDİR (komut satırına gider)', g.duz === null);
  ok('1e komut karakteri: harf ve rakam evet; Ctrl\'lü, ok ve boşluk hayır',
    g.harf === true && g.rakam === true && g.ctrlHarf === false && g.ok === false && g.bosluk === false, JSON.stringify(g));
  ok('1f ortho büyük bileşene kilitler', yak(g.oY[0], 10) && yak(g.oY[1], 0) && yak(g.oD[0], 0) && yak(g.oD[1], 10), JSON.stringify([g.oY, g.oD]));
  ok('1g kutupsal açıyı yuvarlar, UZAKLIĞI korur',
    yak(Math.hypot(g.p15[0], g.p15[1]), Math.hypot(10, 1)) && yak(g.p15[1], 0) &&
    yak(g.p45[0], g.p45[1]) && yak(Math.hypot(g.p45[0], g.p45[1]), Math.hypot(10, 9)),
    JSON.stringify({ p15: g.p15.map(v => +v.toFixed(3)), p45: g.p45.map(v => +v.toFixed(3)) }));
  ok('1h öncelik: YAKALAMA ortho\'yu yener', yak(g.kYakalama[0], 10) && yak(g.kYakalama[1], 3), JSON.stringify(g.kYakalama));
  ok('1i öncelik: ortho kutupsalı yener (ikisi birden açıkken)', yak(g.kOrtho[0], 10) && yak(g.kOrtho[1], 0), JSON.stringify(g.kOrtho));
  ok('1j kısıt yokken ve taban yokken nokta olduğu gibi kalır', yak(g.kYok[1], 3) && yak(g.tabanYok[1], 3));
}

// ---------------------------------------------------------------------------------
// 2) Sezim
// ---------------------------------------------------------------------------------
{
  const r = await box();
  await page.mouse.move(r.x + 400, r.y + 300); await page.waitForTimeout(250);
  const d = await desk();
  ok('2a gerçek fare olayı masaüstü kipini açar', d.mouse === true, JSON.stringify(d));
  const g = await ev(() => ({ cls: document.body.classList.contains('has-mouse'), imlec: getComputedStyle(document.getElementById('viewport')).cursor }));
  ok('2b çizim alanında CAD artı imleci', g.cls === true && g.imlec === 'crosshair', JSON.stringify(g));
  ok('2c fare gezinirken artı imleç ve yakalama önizlemesi okunur', !!(await ev(() => window.dwgApp.state.pen.hover)));
  await shot('masaustu_imlec');
}

// ---------------------------------------------------------------------------------
// 3) Fare tuşları
// ---------------------------------------------------------------------------------
{
  const r = await box();
  await ev(() => { window.dwgApp.state.selected = null; });
  const v0 = await view();
  await page.mouse.move(r.x + 400, r.y + 300);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(r.x + 520, r.y + 390, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(220);
  const v1 = await view();
  ok('3a ORTA TUŞ kaydırır (AutoCAD\'in temel fare hareketi)', Math.abs(v1.cx - v0.cx) > 1e-9 || Math.abs(v1.cy - v0.cy) > 1e-9, JSON.stringify({ v0, v1 }));
  ok('3b orta tuşla kaydırma hiçbir nesneyi SEÇMEZ', (await secili()) === null, String(await secili()));
  ok('3c orta tuş ölçeği değiştirmez', yak(v1.scale, v0.scale, 1e-12), `${v0.scale} → ${v1.scale}`);

  // orta tuş çift tıklama → sınırlara otur
  await ev(() => { window.dwgApp.zoomExtents([0, 0, 100, 100]); });
  await page.waitForTimeout(150);
  const v2 = await view();
  await page.mouse.move(r.x + 400, r.y + 300);
  await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(60);
  await page.mouse.down({ button: 'middle' }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(300);
  const v3 = await view();
  ok('3d orta tuş ÇİFT tıklama sınırlara oturur', Math.abs(v3.scale - v2.scale) > 1e-12, `${v2.scale.toExponential(2)} → ${v3.scale.toExponential(2)}`);
}

// ---------------------------------------------------------------------------------
// 4) Sağ tuş
// ---------------------------------------------------------------------------------
{
  const r = await box();
  await setUi({ deskRight: 'enter' }); await page.waitForTimeout(80);
  // önce bir komut çalıştır ki yinelenecek bir şey olsun
  await ev(() => window.dwgApp.editor.act('t:circle')); await page.waitForTimeout(150);
  await ev(() => window.dwgApp.editor.tools.cancel()); await page.waitForTimeout(150);
  await page.mouse.move(r.x + 500, r.y + 300);
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  ok('4a sağ tuş "Enter" görevinde SON komutu yineler', (await aktif()) === 'circle', String(await aktif()));
  // çalışan araç varsa sağ tuş onu bitirir
  await ev(() => window.dwgApp.editor.tools.cancel()); await page.waitForTimeout(120);

  await setUi({ deskRight: 'menu' }); await page.waitForTimeout(80);
  /*
   * v7.93: sağ tuş menüsü artık AutoCAD gibi İKİ AYRI menüdür. Nesnenin üstünde düzenleme menüsü
   * (Sil, Taşı, Döndür…), boş yerde eski bağlam listesi (koordinat kopyala, buradan ölç…). İkisi de
   * aynı kapıdan (longPressMenu) geçer; uzun basış ve kalemin yan düğmesi de buraya iner.
   */
  const bosXY = await ev(() => {
    const A = window.dwgApp, r = document.getElementById('viewport').getBoundingClientRect(), isabet = A.editor.tools.api.pick;
    for (let gy = 0.12; gy < 0.92; gy += 0.03) for (let gx = 0.06; gx < 0.94; gx += 0.03) {
      const sx = Math.round(r.width * gx), sy = Math.round(r.height * gy);
      if (!isabet(A.toWorld(sx, sy))) return [sx, sy];
    }
    return null;
  });
  if (!bosXY) C.skip('4b boş yerde sağ tuş', 'görüntü alanında boş nokta yok');
  else {
    await page.mouse.move(r.x + bosXY[0], r.y + bosXY[1]);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
    ok('4b "Menü" görevinde BOŞ yerde bağlam menüsü açılır', await ev(() => { const d = document.getElementById('docPanel'); return !!(d && !d.hidden && d.querySelector('.ctx-list')); }));
    await ev(() => { const d = document.getElementById('docPanel'); if (d) d.hidden = true; });
  }
  const nesneXY = await ev(() => {
    const A = window.dwgApp, r = document.getElementById('viewport').getBoundingClientRect(), isabet = A.editor.tools.api.pick;
    for (let gy = 0.12; gy < 0.92; gy += 0.02) for (let gx = 0.06; gx < 0.94; gx += 0.02) {
      const sx = Math.round(r.width * gx), sy = Math.round(r.height * gy);
      if (isabet(A.toWorld(sx, sy))) return [sx, sy];
    }
    return null;
  });
  if (!nesneXY) C.skip('4b2 nesne üstünde sağ tuş', 'görüntü alanında nesne yok');
  else {
    await page.mouse.move(r.x + nesneXY[0], r.y + nesneXY[1]);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
    const dm = await ev(() => { const d = document.getElementById('docPanel'); return { acik: !!(d && !d.hidden), grid: !!(d && d.querySelector('.sel-grid')), n: window.dwgApp.editor.sel.size }; });
    ok('4b2 nesnenin üstünde sağ tuş DÜZENLEME menüsünü açar (nesne seçilir)', dm.acik && dm.grid && dm.n >= 1, JSON.stringify(dm));
    await ev(() => { const d = document.getElementById('docPanel'); if (d) d.hidden = true; window.dwgApp.editor.sel.clear(); window.dwgApp.editor.tools.cancel(); });
  }
  await page.mouse.move(r.x + 500, r.y + 300);

  await setUi({ deskRight: 'none' }); await page.waitForTimeout(80);
  const a0 = await aktif();
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(250);
  ok('4c "Yok" görevinde sağ tuş hiçbir şey yapmaz', (await aktif()) === a0 && await ev(() => document.getElementById('docPanel').hidden));
  await setUi({ deskRight: 'enter' }); await page.waitForTimeout(80);
}

// ---------------------------------------------------------------------------------
// 5) Klavye
// ---------------------------------------------------------------------------------
{
  await ev(() => { window.dwgApp.editor.tools.cancel(); document.getElementById('cmdInput').blur(); });
  await page.waitForTimeout(150);
  await page.keyboard.press('l'); await page.waitForTimeout(220);
  const k = await ev(() => ({ val: document.getElementById('cmdInput').value, odak: document.activeElement && document.activeElement.id }));
  ok('5a harf yazınca metin komut satırına DÜŞER ve odak oraya geçer (AutoCAD)', k.val === 'l' && k.odak === 'cmdInput', JSON.stringify(k));
  await page.keyboard.type('ine'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  ok('5b yazmaya kesintisiz devam edip Enter ile komut çalışır', (await aktif()) === 'line', String(await aktif()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  ok('5c Esc aracı iptal eder', (await aktif()) === null);

  const s0 = await ev(() => window.dwgApp.state.snapModes.size);
  await page.keyboard.press('F3'); await page.waitForTimeout(250);
  const s1 = await ev(() => window.dwgApp.state.snapModes.size);
  ok('5d F3 nesne yakalamayı değiştirir', s0 !== s1, `${s0} → ${s1}`);
  await page.keyboard.press('F3'); await page.waitForTimeout(250);

  await page.keyboard.press('F8'); await page.waitForTimeout(250);
  ok('5e F8 ortho açar', (await desk()).ortho === true);
  await page.keyboard.press('F10'); await page.waitForTimeout(250);
  const d = await desk();
  ok('5f F10 kutupsal açar ve ortho\'yu KAPATIR (ikisi birlikte olamaz)', d.polar === true && d.ortho === false, JSON.stringify(d));
  await page.keyboard.press('F10'); await page.waitForTimeout(250);
  ok('5g F10 yeniden basınca kapanır', (await desk()).polar === false);

  const g0 = await ev(() => window.dwgApp.state.show.grid === undefined ? window.dwgApp.state.grid.on : window.dwgApp.state.grid.on);
  await page.keyboard.press('F7'); await page.waitForTimeout(250);
  ok('5h F7 ızgarayı değiştirir', (await ev(() => window.dwgApp.state.grid.on)) !== g0);
  await page.keyboard.press('F7'); await page.waitForTimeout(200);
  await shot('masaustu_klavye');
}

// ---------------------------------------------------------------------------------
// 6) Ortho gerçekten kilitliyor mu
// ---------------------------------------------------------------------------------
{
  const r = await box();
  await zoom([0, 0, 2000, 2000]);
  // Yakalama kapatılır: bu sınama ORTHO'yu ölçüyor, yakalamayı değil.
  await ev(() => { window.dwgApp.state.snapModes.clear(); window.dwgApp.state.desk.ortho = false; window.dwgApp.state.desk.polar = false; });
  const n0 = await ev(() => window.dwgApp.state.prims.length);
  const a = await scr(400, 400), b = await scr(1400, 700);   // 1000 sağ, 300 yukarı → ortho yatayı seçmeli
  await ev(() => window.dwgApp.editor.act('t:line')); await page.waitForTimeout(150);
  await ev(() => { window.dwgApp.state.desk.ortho = true; });
  await page.mouse.click(r.x + a.x, r.y + a.y); await page.waitForTimeout(200);
  await page.mouse.click(r.x + b.x, r.y + b.y); await page.waitForTimeout(250);
  await ev(() => window.dwgApp.editor.tools.cancel()); await page.waitForTimeout(200);
  const ops = await sonPrim();
  ok('6a ortho AÇIKKEN çizilen doğru eksene kilitlenir (Y değişmez)',
    (await ev(() => window.dwgApp.state.prims.length)) === n0 + 1 && ops && ops.length === 2 && yak(ops[0][2], ops[1][2], 1e-6),
    JSON.stringify(ops));
  await shot('masaustu_ortho');

  // yakalama ortho'yu yenmeli
  await ev(() => { window.dwgApp.state.desk.ortho = false; window.dwgApp.editor.doc.undo(); });
  await page.waitForTimeout(200);
  const n1 = await ev(() => window.dwgApp.state.prims.length);
  ok('6b geri al çizgiyi kaldırdı', n1 === n0, `${n1} / ${n0}`);

  // Dikdörtgenin karşı köşesi bir DOĞRULTU değil KÖŞEdir: ortho ona uygulanmaz (uygulansaydı
  // dikdörtgen sıfır genişliğe çökerdi). AutoCAD'de de RECTANG'ın ikinci köşesi ortho'dan bağımsızdır.
  await ev(() => window.dwgApp.editor.act('t:rect')); await page.waitForTimeout(150);
  await ev(() => { window.dwgApp.state.desk.ortho = true; });
  await page.mouse.click(r.x + a.x, r.y + a.y); await page.waitForTimeout(200);
  await page.mouse.click(r.x + b.x, r.y + b.y); await page.waitForTimeout(250);
  await ev(() => { window.dwgApp.state.desk.ortho = false; });
  const rops = await sonPrim();
  const rbb = rops && rops.length >= 4 ? [Math.min(...rops.map(o => o[1])), Math.min(...rops.map(o => o[2])), Math.max(...rops.map(o => o[1])), Math.max(...rops.map(o => o[2]))] : null;
  ok('6c ortho AÇIKKEN dikdörtgen çökmez (genişlik ve yükseklik sıfırdan büyük)',
    (await ev(() => window.dwgApp.state.prims.length)) === n0 + 1 && rbb && rbb[2] - rbb[0] > 1 && rbb[3] - rbb[1] > 1, JSON.stringify(rbb));
  await ev(() => { window.dwgApp.editor.tools.cancel(); window.dwgApp.editor.doc.undo(); }); await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------------
// 7) Ayar bölümü ve kapatma
// ---------------------------------------------------------------------------------
{
  const sec = await ev(async () => {
    const E = await import('./editor.js');
    const d = document.createElement('div'); d.innerHTML = E.accessibilitySection().html;
    const s = d.querySelector('.desk-sec');
    return s ? { var: true, anahtar: [...s.querySelectorAll('input[data-desk]')].map(i => i.dataset.desk), sag: [...s.querySelectorAll('.seg[data-desk-right] button')].map(b => b.dataset.val), aci: [...s.querySelectorAll('.seg[data-desk-polar] button')].map(b => b.dataset.val), durum: (s.querySelector('.muted') || {}).textContent || '', ham: /\bdesk[A-Z]/.test(s.textContent) } : { var: false };
  });
  ok('7a ayarlarda masaüstü bölümü var', sec.var === true);
  ok('7b sağ tuş üç seçenek, kutupsal açı beş adım', sec.var && sec.sag.length === 3 && sec.aci.length === 5, JSON.stringify({ sag: sec.sag, aci: sec.aci }));
  ok('7c fare algılandığı için durum satırı bunu söyler', sec.var && /algıland|detect/i.test(sec.durum), sec.durum);
  ok('7d ham i18n anahtarı sızmamış', sec.var && sec.ham === false);

  // kapatınca eski davranış
  await setUi({ desktop: false }); await page.waitForTimeout(150);
  const r = await box();
  await ev(() => { window.dwgApp.state.selected = null; window.dwgApp.editor.tools.cancel(); document.getElementById('cmdInput').blur(); });
  const v0 = await view();
  await page.mouse.move(r.x + 400, r.y + 300);
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(r.x + 520, r.y + 390, { steps: 4 }); await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(200);
  /*
   * Orta tuşla sürüklemek ve iki kez tıklamak kip KAPALIYKEN de görünümü oynatır — eski jest
   * yolu tuş ayırmıyordu ve ayırmaya da gerek yok. Kipin kapandığını ayırt eden temiz iki
   * ölçüt şunlardır: artı imleç kalkar, ve masaüstü dalına özgü sağ tuş görevi çalışmaz.
   */
  const imlec = await ev(() => getComputedStyle(document.getElementById('viewport')).cursor);
  ok('7e kip KAPALIYKEN çizim alanı artı imleci bırakır', imlec !== 'crosshair', imlec);
  await setUi({ deskRight: 'menu' }); await page.waitForTimeout(80);
  await ev(() => { const d = document.getElementById('docPanel'); if (d) d.hidden = true; });
  await page.mouse.move(r.x + 420, r.y + 320);
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  ok('7e2 kip KAPALIYKEN sağ tuş görevi çalışmaz (masaüstü dalı atlanır)',
    await ev(() => { const d = document.getElementById('docPanel'); return !d || d.hidden || !d.querySelector('.ctx-list'); }));
  await setUi({ deskRight: 'enter' }); await page.waitForTimeout(80);
  await page.keyboard.press('q'); await page.waitForTimeout(200);
  ok('7f kip kapalıyken harf komut satırına düşmez', (await ev(() => document.getElementById('cmdInput').value)) === '');
  await setUi({ desktop: true }); await page.waitForTimeout(120);
}

// ---------------------------------------------------------------------------------
// 9) Büyük ekran / masaüstü araştırmasının bulguları (v8.9.8)
// ---------------------------------------------------------------------------------
{
  const r = await box();
  await ev(() => { window.dwgApp.editor.tools.cancel(); window.dwgApp.editor.sel.clear(); const i = document.getElementById('cmdInput'); i.value = ''; i.blur(); document.getElementById('toast').hidden = true; });
  const g = await ev(async () => { const D = await import('./desktop.js'); return D.resolveKey({ key: 'a', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }); });
  ok('9a Ctrl+A tümünü seç eylemine çözülür (AutoCAD)', !!g && g.act === 'selectall', JSON.stringify(g));
  await page.mouse.move(r.x + 300, r.y + 300);
  await page.keyboard.press('Control+a'); await page.waitForTimeout(300);
  const n = await ev(() => window.dwgApp.editor.sel.size);
  ok('9b Ctrl+A görünen nesneleri seçer', n > 0, String(n));
  const yazi = await ev(() => String(window.getSelection() || '').length);
  ok('9c Ctrl+A arayüz yazısını seçmez', yazi === 0, String(yazi));
  await ev(() => { window.dwgApp.editor.tools.cancel(); window.dwgApp.editor.sel.clear(); });
  const kat = () => ev(() => document.getElementById('toolbar').classList.contains('collapsed'));
  const k0 = await kat(); await page.keyboard.press('Control+0'); await page.waitForTimeout(250);
  const k1 = await kat(); await page.keyboard.press('Control+0'); await page.waitForTimeout(250);
  const k2 = await kat();
  ok('9d Ctrl+0 şeridi katlar ve geri açar', k1 !== k0 && k2 === k0, JSON.stringify([k0, k1, k2]));
  // 9e fareyle nokta seçildikten sonra klavyeden yazılan göreli koordinat kaybolmaz
  await ev(() => { document.getElementById('toast').hidden = true; });
  await page.mouse.move(r.x + 500, r.y + 350);
  await page.keyboard.type('line'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  const adet0 = await ev(() => window.dwgApp.state.prims.length);
  await page.mouse.move(r.x + 520, r.y + 420); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250);
  await page.keyboard.type('@2,0');
  const giris = await ev(() => ({ v: document.getElementById('cmdInput').value, odak: document.activeElement && document.activeElement.id }));
  ok('9e tıklamadan sonra yazılan "@2,0" komut satırına gider ve odak oraya geçer', giris.v === '@2,0' && giris.odak === 'cmdInput', JSON.stringify(giris));
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const son = await sonPrim(), adet1 = await ev(() => window.dwgApp.state.prims.length);
  const dx = son ? son[son.length - 1][1] - son[0][1] : NaN, dy = son ? son[son.length - 1][2] - son[0][2] : NaN;
  ok('9f Enter göreli koordinatla çizgiyi kurar (Δx 2, Δy 0)', adet1 === adet0 + 1 && yak(dx, 2, 1e-6) && yak(dy, 0, 1e-6), JSON.stringify({ adet0, adet1, dx, dy }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  await ev(() => { window.dwgApp.editor.tools.cancel(); });
  // 9g geniş ekranda alt sayfa sağdan açılır, çizimin tamamını örtmez
  await page.click('#btnMeasure'); await page.waitForTimeout(400);
  const q = await ev(() => { const b = document.getElementById('measurePanel').getBoundingClientRect(); return { l: b.left, w: b.width, r: b.right, W: innerWidth }; });
  ok('9g ölçüm sayfası geniş ekranda sağ yan sayfadır (≤ 520 px, sağa yaslı)', q.w <= 521 && Math.abs(q.r - q.W) < 1 && q.l > q.W / 2, JSON.stringify(q));
  await page.click('#btnMeasure'); await page.waitForTimeout(250);
}

ok('8 sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); await srv.kill();
C.summary(); C.exit();
