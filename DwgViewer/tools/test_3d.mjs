// 3B görünüm sınaması (test_tr.dxf): DXF kaydetme, 3B açma, mesafe, seçim + kot atama, yazılı 3B polyline, 2B'ye dönüş.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_3d.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
onDialog(page, async d => { await d.accept('7'); });
await page.goto(srv.url + 'index.html');
await openFile(page, `${SM}/test_tr.dxf`);
await page.evaluate(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); for (const l of window.dwgApp.state.layers.values()) l.visible = true; });
// DXF kaydet düğmesi hatasız çalışır ve indirme başlatır
{
  const dl = page.waitForEvent('download', { timeout: 10000 }).then(d => d.suggestedFilename(), () => null);
  const r = await page.evaluate(() => { try { const b = document.querySelector('#toolbar [data-act="savedxf"]'); b.click(); return 'ok'; } catch (e) { return 'ERR ' + e.message; } });
  const name = await dl;
  ok('1a DXF kaydet düğmesi', r === 'ok', r);
  ok('1b DXF indirmesi başladı (.dxf)', !!name && /\.dxf$/i.test(name), String(name));
}
// 3B
await page.click('#toolbar [data-tab="3d"]'); await page.click('#toolbar [data-act="3d"]'); await page.waitForTimeout(600);
{
  const v = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); return v ? { lines: v.counts.lines, tris: v.counts.tris, verts: v.vertices.length, bb: v.bb.map(x => Math.round(x)) } : null; });
  ok('2a 3B tuval görünür', await page.locator('#cv3d').isVisible());
  ok('2b 3B sahne kuruldu (15 üçgen köşesi, 75 köşe, çizgiler var)', v && v.tris === 15 && v.verts === 75 && v.lines > 0, JSON.stringify(v));   // tris köşe sayar: HATCH 3 üçgen (9) + 2 ölçü oku (6); köşe 63 + 3 ölçü çizgisi·2 + 2 ok·3
  ok('2c 3B sınır kutusu [100,80,0,540,160,52]', v && v.bb.join(',') === '100,80,0,540,160,52', v && v.bb.join(','));
}
await page.screenshot({ path: `${out}/e_3d_iso.png` });
await page.click('#toolbar [data-act="v:top"]'); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/e_3d_top.png` });
await page.click('#toolbar [data-act="v:iso"]'); await page.waitForTimeout(200);
// 3B mesafe: ekranda görünen ilk iki köşe (B1 hattının iki ucu, z 52.4 / 51.9)
await page.click('#toolbar [data-tab="draw"]'); await page.waitForTimeout(250);   // v7.80: 3B araçları Çiz şeridindedir
await page.click('#toolbar [data-act="3:dist"]');
const vs = await page.evaluate(() => { const v = window.dwgApp.editor.view3d(); const W = v.cv.clientWidth, H = v.cv.clientHeight; const seen = new Set(); const out = []; for (const a of v.vertices) { const s = v.project(a[0], a[1], a[2]); const k = Math.round(s[0]) + ',' + Math.round(s[1]); if (s[0] > 40 && s[0] < W - 40 && s[1] > 60 && s[1] < H - 60 && !seen.has(k)) { seen.add(k); out.push(s); } if (out.length === 2) break; } return out; });
ok('3a iki köşe ekranda bulundu', vs.length === 2, JSON.stringify(vs.map(s => s.slice(0, 2).map(Math.round))));
{ const r = await page.locator('#cv3d').boundingBox(); for (const s of vs) { await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await page.waitForTimeout(250); } }
{
  const txt = (await page.locator('#docBody').innerText()).replace(/\n/g, ' | ');
  ok('3b 3B mesafe 107,704 m, ΔZ -0,5 m', /3B mesafe \| 107,704 m/.test(txt) && /ΔZ \| -0,5 m/.test(txt), txt.slice(0, 120));
  ok('3c uç noktalar (100;100;52,4) → (200;140;51,9)', txt.includes('100 ; 100 ; 52,4') && txt.includes('200 ; 140 ; 51,9'), txt.slice(120, 220));
}
await page.screenshot({ path: `${out}/e_3d_dist.png` });
await page.evaluate(() => window.dwgApp.onBack());
// 3B: seç + kot ata (giriş kutusu cevabı 7)
await page.click('#toolbar [data-act="3:select"]');
{ const r = await page.locator('#cv3d').boundingBox(); await page.touchscreen.tap(r.x + vs[0][0], r.y + vs[0][1]); await page.waitForTimeout(250); }
ok('4a 3B seçim: LINE', (await page.evaluate(() => [...window.dwgApp.editor.sel].map(p => p.et).join(','))) === 'LINE');
await queueAnswers(page, '7'); await page.click('#toolbar [data-act="3:setz"]'); await page.waitForTimeout(300);
{
  const z = await page.evaluate(() => [...window.dwgApp.state.scene.layouts[0].prims].filter(p => p.info && p.info.edited).map(p => p.et + ':' + JSON.stringify(p.ops ? p.ops.map(o => o[3]) : p.z)).join(' '));
  ok('4b kot atama: LINE her iki ucu z=7', z === 'LINE:[7,7]', z);
}
// 3B polyline yazılı
await page.click('#toolbar [data-act="3:pline"]'); await page.fill('#cmdInput', '100,100,50'); await page.click('#cmdEnter'); await page.fill('#cmdInput', '200,150,55'); await page.click('#cmdEnter'); await page.fill('#cmdInput', '300,100,60'); await page.click('#cmdEnter'); await page.click('#cmdBtns [data-cmd3="finish"]'); await page.waitForTimeout(300);
{
  const p = await page.evaluate(() => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.ent && q.ent.type === 'POLYLINE3D'); return p ? JSON.stringify(p.ent.pts) : 'none'; });
  ok('5 3B polyline üç köşesiyle eklendi', p === '[[100,100,50],[200,150,55],[300,100,60]]', p);
}
await page.screenshot({ path: `${out}/e_3d_pline.png` });
await page.evaluate(() => window.dwgApp.onBack()); await page.waitForTimeout(200);
ok('6 2B görünüme dönüldü', await page.locator('#cv3d').isHidden());
await page.screenshot({ path: `${out}/e_2d_after.png` });
// ---------------------------------------------------------------------------------
// 8 · v7.79: ince bilgi satırı (HUD) ve ona dokunarak gizleme
// ---------------------------------------------------------------------------------
{
  const h1 = await page.evaluate(async () => {
    const E = window.dwgApp.editor, v = E.view3d();
    if (!v.opts.hud) { E.act('hud3'); await new Promise(r => setTimeout(r, 200)); }
    v.render(); E.act('hud3'); E.act('hud3');   // çizim tazelensin, kutu ölçülsün
    await new Promise(r => setTimeout(r, 300));
    return { hud: v.opts.hud, kutu: v._hudBox ? { w: Math.round(v._hudBox.w), h: v._hudBox.h } : null };
  });
  ok('8a bilgi satırı ince: iki satırlık kutu 40 px altında', !!h1.kutu && h1.kutu.h > 0 && h1.kutu.h <= 40, JSON.stringify(h1));

  const h2 = await page.evaluate(async () => {
    const E = window.dwgApp.editor, v = E.view3d();
    if (!v._hudBox) return { kutuYok: true };
    const b = v._hudBox, cv = document.getElementById('cv3d') || document.getElementById('cv');
    const r0 = cv.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, clientX: r0.left + b.x + b.w / 2, clientY: r0.top + b.y + b.h / 2, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    cv.dispatchEvent(new PointerEvent('pointerdown', opt));
    cv.dispatchEvent(new PointerEvent('pointerup', { ...opt, buttons: 0 }));
    await new Promise(r => setTimeout(r, 350));
    const el = document.getElementById('toast');
    return { hud: v.opts.hud, ileti: el && !el.hidden ? (el.querySelector('.tx') || el).textContent : '' };
  });
  ok('8b bilgi satırına dokunmak onu gizler ve geri getirme yolunu söyler', h2.hud === false && /\u25b8/.test(h2.ileti), JSON.stringify(h2));

  const h3 = await page.evaluate(async () => {
    const E = window.dwgApp.editor, v = E.view3d();
    E.act('hud3'); await new Promise(r => setTimeout(r, 250));
    return { hud: v.opts.hud };
  });
  ok('8c karo bilgi satırını geri getirir', h3.hud === true, JSON.stringify(h3));
}

// ---------------------------------------------------------------------------------
// 9 · v7.80: 3B'de Çiz şeridi 3B araçlarını gösterir — çizmeye kalkışınca görünüm değişmez
// ---------------------------------------------------------------------------------
{
  const g1 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    if (!E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 700)); }
    E.act('tab:draw'); await new Promise(r => setTimeout(r, 250));
    const row = document.querySelector('#toolbar .tb-row[data-for="draw"]');
    const k = row ? [...row.querySelectorAll('[data-act]')].map(b => b.dataset.act) : [];
    return { uc: E.is3D(), karolar: k, ikiB: k.filter(a => a.startsWith('t:')), ucB: k.filter(a => a.startsWith('3:')) };
  });
  ok('9a 3B\'de Çiz şeridinde HİÇ 2B çizim aracı yok (kaza ile görünüm değişmez)', g1.uc === true && g1.ikiB.length === 0, JSON.stringify(g1));
  ok('9b 3B\'de Çiz şeridi 3B araçlarını gösterir (3B Polyline, açıklama, kot…)', g1.ucB.includes('3:pline') && g1.ucB.length >= 5, JSON.stringify(g1));

  /*
   * v7.81: LINE ÜÇ BOYUTTA DA ÇALIŞIR. Eskiden 3B'de LINE yazmak görünümü 2B'ye düşürüyordu;
   * AutoCAD'de öyle olmaz. Artık karşılığı olan komut (LINE, MOVE, COPY, ROTATE, SCALE, MIRROR)
   * doğrudan 3B aracına gider ve görünüm KORUNUR.
   */
  const g2 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    const once = E.is3D();
    E.act('t:line'); await new Promise(r => setTimeout(r, 400));   // komut satırından yazılmış gibi
    const r = { onceUc: once, sonraUc: E.is3D(), arac3: E.m3 ? E.m3.name : null, arac2: E.tools.active };
    if (E.m3) E.act('3:line');   // aynı karoya ikinci dokunuş gibi: araç kapanmaz, istem tazelenir
    return r;
  });
  ok('9c 3B\'de LINE komutu 3B ÇİZGİ aracını başlatır, görünüm korunur', g2.onceUc === true && g2.sonraUc === true && g2.arac3 === 'line' && g2.arac2 === null, JSON.stringify(g2));

  // Karşılığı OLMAYAN bir 2B aracı (tarama: yapı düzlemi ister) yine 2B'ye döner ve nedenini söyler
  const g2b = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    if (E.m3) { E.m3 = null; }
    if (!E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 700)); }
    document.getElementById('toast').hidden = true;
    E.act('t:hatch'); await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('toast');
    const r = { sonraUc: E.is3D(), arac: E.tools.active, ileti: el && !el.hidden ? (el.querySelector('.tx') || el).textContent : '' };
    if (E.tools.running) E.tools.cancel();
    return r;
  });
  ok('9c2 3B karşılığı olmayan 2B aracı 2B\'ye döner ve NEDENİ söylenir', g2b.sonraUc === false && g2b.arac === 'hatch' && g2b.ileti.length > 10, JSON.stringify(g2b));

  const g3 = await page.evaluate(async () => {
    const row = document.querySelector('#toolbar .tb-row[data-for="draw"]');
    const k = row ? [...row.querySelectorAll('[data-act]')].map(b => b.dataset.act) : [];
    return { ikiB: k.filter(a => a.startsWith('t:')).length };
  });
  ok('9d 2B\'ye dönünce Çiz şeridi 2B araçlarına geri döner', g3.ikiB >= 5, JSON.stringify(g3));

  // 3B Çiz şeridinde de kilit rozeti sözleşmesi geçerlidir: kilitli ⇔ data-need ⇔ .lk
  const g4 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    if (!E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 700)); }
    E.act('tab:draw'); await new Promise(r => setTimeout(r, 250));
    const Ed = await import('./edition.js');
    const bad = [...document.querySelectorAll('#toolbar .tb-row[data-for="draw"] [data-act]')].map(b => {
      const k = b.dataset.act, lock = !Ed.has(k);
      return { k, ok: lock === b.hasAttribute('data-need') && lock === !!b.querySelector('.lk') && (!lock || b.dataset.need === Ed.need(k)) };
    }).filter(x => !x.ok).map(x => x.k);
    return { bad, n: document.querySelectorAll('#toolbar .tb-row[data-for="draw"] [data-act]').length };
  });
  ok('9e 3B Çiz şeridinde rozet sözleşmesi tutuyor', g4.bad.length === 0 && g4.n >= 5, JSON.stringify(g4));
}

// ---------------------------------------------------------------------------------
// 10 · v7.81: 3B nesne yakalama (END/MID/CEN/PER/NEA), 3B ÇİZGİ ve 3B düzenleme komutları
// ---------------------------------------------------------------------------------
{
  /*
   * 3B dokunuş işleyicisi pointer olaylarına bağlıdır (click değil): sınama da gerçek
   * pointerdown/up gönderir. Çift dokunuş penceresi 320 ms'dir — aralar ondan uzun tutulur,
   * yoksa ikinci dokunuş "sığdır" sayılır.
   */
  const ORTAK = `
    const E = window.dwgApp.editor, v = E.view3d(), P = () => window.dwgApp.state.scene.layouts[0].prims;
    const bekle = (ms) => new Promise(r => setTimeout(r, ms));
    const dokun = async (sx, sy) => {
      const cv = document.getElementById('cv3d'), r0 = cv.getBoundingClientRect();
      cv.setPointerCapture = () => {};
      const o = { bubbles: true, cancelable: true, clientX: r0.left + sx, clientY: r0.top + sy, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      cv.dispatchEvent(new PointerEvent('pointerdown', o));
      cv.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
      await bekle(420);
    };
    const uclar = (q) => q.ops.map(o => [o[1], o[2], o[3] || 0]);
    /*
     * Yakalama sınamasında ÇİZİM KALABALIK OLMAMALIDIR: bir noktanın "orta nokta" olarak
     * yakalandığını, ekranda ona daha yakın başka bir aday varken kanıtlayamayız. Model
     * ilkelleri geçici olarak sınanan nesnelere indirilir, sonra geri konur.
     */
    const yalniz = (liste) => {
      const m = window.dwgApp.state.scene.layouts[0], yedek = m.prims.slice();
      m.prims.length = 0; for (const q of liste) m.prims.push(q);
      return () => { m.prims.length = 0; for (const q of yedek) m.prims.push(q); };
    };
  `;
  const calis = (govde) => page.evaluate(`(async () => {${ORTAK}${govde}})()`);
  const esit3 = (p, q, e = 1e-6) => !!p && !!q && p.length === q.length && p.every((n, i) => Math.abs(n - q[i]) < e);

  await calis(`
    if (E.m3) E.m3 = null;
    if (!E.is3D()) { E.act('3d'); await bekle(700); }
    E.act('tab:draw'); await bekle(250);
    const U = (await import('./editor.js')).ui;
    U.snap3 = true; U.snap3Modes = ['end', 'mid', 'cen'];
    return true;
  `);

  // ---- 10a · ORTA NOKTA yakalaması: doğrunun ekrandaki ortasına dokunmak tam ortayı verir
  const y1 = await calis(`
    const p = P().find(q => q.et === 'LINE' && q.ops && q.ops.length === 2);
    if (!p) return { yok: true };
    const geri = yalniz([p]);
    const [A, B] = uclar(p);
    const orta = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    const s = v.project(orta[0], orta[1], orta[2]);
    E.act('3:dist'); await bekle(250);
    await dokun(s[0], s[1]);
    const alinan = E.m3 && E.m3.pts.length ? E.m3.pts[0] : null;
    if (E.m3) { E.m3.pts = []; E.m3 = null; }
    geri();
    return { orta, alinan, uc: [A, B] };
  `);
  ok('10a 3B yakalama: doğrunun ORTA noktası yakalanır', esit3(y1.alinan, y1.orta), JSON.stringify(y1));

  // ---- 10b · yakalama kapatılınca aynı dokunuş ORTA noktayı vermez (eski köşe yoluna düşer)
  const y2 = await calis(`
    const U = (await import('./editor.js')).ui;
    U.snap3 = false;
    const p = P().find(q => q.et === 'LINE' && q.ops && q.ops.length === 2);
    const geri = yalniz([p]);
    const [A, B] = uclar(p);
    const orta = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    const s = v.project(orta[0], orta[1], orta[2]);
    E.act('3:dist'); await bekle(250);
    await dokun(s[0], s[1]);
    const alinan = E.m3 && E.m3.pts.length ? E.m3.pts[0] : null;
    if (E.m3) { E.m3.pts = []; E.m3 = null; }
    geri(); U.snap3 = true;
    return { orta, alinan };
  `);
  ok('10b yakalama kapalıyken ORTA nokta yakalanmaz', !esit3(y2.alinan, y2.orta), JSON.stringify(y2));

  // ---- 10c · karo, anahtar ve öntanımlı kipler
  const y3 = await calis(`
    const U = (await import('./editor.js')).ui;
    const karo = () => document.querySelector('#toolbar [data-act="snap3"]');
    E.act('snap3'); await bekle(250);
    const kapali = U.snap3, rozet1 = karo() ? karo().classList.contains('on') : null;
    E.act('snap3'); await bekle(250);
    return { kapali, rozet1, acik: U.snap3, rozet2: karo() ? karo().classList.contains('on') : null, kipler: U.snap3Modes.slice() };
  `);
  ok('10c yakalama karosu ui.snap3 ile birlikte yanıp söner', y3.kapali === false && y3.rozet1 === false && y3.acik === true && y3.rozet2 === true, JSON.stringify(y3));
  ok('10c2 öntanımlı kipler END / MID / CEN', y3.kipler.join(',') === 'end,mid,cen', JSON.stringify(y3.kipler));

  // ---- 10d · 3B ÇİZGİ: yazılan üç nokta iki LINE parçası yazar, kotlar korunur
  const y4 = await calis(`
    const say = () => P().filter(q => q.ent && q.ent.type === 'LINE').length;
    const once = say();
    E.act('3:line'); await bekle(300);
    const yaz = async (t) => { const i = document.getElementById('cmdInput'); i.value = t; document.getElementById('cmdEnter').click(); await bekle(300); };
    await yaz('10,10,3'); await yaz('20,10,3'); await yaz('20,20,9');
    const btn = document.querySelector('#cmdBtns [data-cmd3="finish"]');
    if (btn) btn.click();
    await bekle(300);
    const ikinci = P().filter(q => q.ent && q.ent.type === 'LINE' && q.ent.pts && q.ent.pts.some(t => t[0] === 20 && t[1] === 20));
    return { artis: say() - once, kalan: E.m3, uc: ikinci.length ? ikinci[0].ent.pts : null };
  `);
  ok('10d 3B çizgi: üç nokta iki LINE parçası yazar', y4.artis === 2, JSON.stringify({ artis: y4.artis }));
  ok('10d2 ikinci parça kotlarıyla yazılır (z 3 → 9)', !!y4.uc && y4.uc.length === 2 && y4.uc[0][2] === 3 && y4.uc[1][2] === 9, JSON.stringify(y4.uc));
  ok('10d3 Bitir komutu kapatır', y4.kalan === null, JSON.stringify(y4.kalan));

  // ---- 10e · 3B DÖNDÜR: dokunulan noktadan geçen Z ekseni çevresinde 90°
  await queueAnswers(page, '90');
  const y5 = await calis(`
    const p = P().find(q => q.ent && q.ent.type === 'LINE' && q.ent.pts && q.ent.pts.some(t => t[0] === 20 && t[1] === 20));
    if (!p) return { yok: true };
    E.setSelection([p]);
    const once = uclar(p);
    const s = v.project(once[0][0], once[0][1], once[0][2]);
    E.act('3:rotate'); await bekle(300);
    await dokun(s[0], s[1]);
    await bekle(900);
    const p2 = P().find(q => q.key === p.key);
    return { once, sonra: p2 ? uclar(p2) : null };
  `);
  {
    const o = y5.once, sn = y5.sonra;
    const bek = o && [o[0][0] - (o[1][1] - o[0][1]), o[0][1] + (o[1][0] - o[0][0]), o[1][2]];
    ok('10e 3B döndür: taban nokta yerinde kalır', !!sn && esit3(sn[0], o[0], 1e-6), JSON.stringify(y5));
    ok('10e2 ikinci uç Z ekseni çevresinde 90° döner, kot korunur', !!sn && esit3(sn[1], bek, 1e-6), JSON.stringify({ sonra: sn, beklenen: bek }));
  }

  // ---- 10f · 3B ÖLÇEKLE: kot da ölçeklenir (yalnız XY ölçeklense cisim eğilirdi)
  await queueAnswers(page, '2');
  const y6 = await calis(`
    const p = P().find(q => q.ent && q.ent.type === 'LINE' && q.ops && q.ops.length === 2 && Math.abs((q.ops[1][3] || 0) - (q.ops[0][3] || 0)) > 1e-9);
    if (!p) return { yok: true };
    E.setSelection([p]);
    const once = uclar(p);
    const s = v.project(once[0][0], once[0][1], once[0][2]);
    E.act('3:scale'); await bekle(300);
    await dokun(s[0], s[1]);
    await bekle(900);
    const p2 = P().find(q => q.key === p.key);
    return { once, sonra: p2 ? uclar(p2) : null };
  `);
  {
    const o = y6.once, sn = y6.sonra;
    const bek = o && [o[0][0] + (o[1][0] - o[0][0]) * 2, o[0][1] + (o[1][1] - o[0][1]) * 2, o[0][2] + (o[1][2] - o[0][2]) * 2];
    ok('10f 3B ölçekle: taban nokta yerinde kalır', !!sn && esit3(sn[0], o[0], 1e-6), JSON.stringify(y6));
    ok('10f2 KOT da iki katına çıkar (2B ölçek cismi eğerdi)', !!sn && esit3(sn[1], bek, 1e-6), JSON.stringify({ sonra: sn, beklenen: bek }));
  }

  // ---- 10g · 3B KOPYALA: iki dokunuş, kopya taban → hedef vektörüyle üç boyutta ötelenir
  const y7 = await calis(`
    const p = P().find(q => q.ent && q.ent.type === 'LINE' && q.ops && q.ops.length === 2 && Math.abs((q.ops[1][3] || 0) - (q.ops[0][3] || 0)) > 1e-9);
    if (!p) return { yok: true };
    E.setSelection([p]);
    const [A, B] = uclar(p);
    const sa = v.project(A[0], A[1], A[2]), sb = v.project(B[0], B[1], B[2]);
    const say = () => P().filter(q => q.ent && q.ent.type === 'LINE').length;
    const once = say();
    E.act('3:copy'); await bekle(300);
    await dokun(sa[0], sa[1]);
    await dokun(sb[0], sb[1]);
    await bekle(900);
    const beklenen = [A[0] + (B[0] - A[0]), A[1] + (B[1] - A[1]), A[2] + (B[2] - A[2])];
    const basliklar = P().filter(q => q.ent && q.ent.type === 'LINE' && q.key !== p.key && q.ops && q.ops.length === 2).map(uclar).map(u => u[0]);
    return { artis: say() - once, beklenen, basliklar, kip: E.m3 };
  `);
  ok('10g 3B kopyala: tam bir kopya eklenir', y7.artis === 1, JSON.stringify({ artis: y7.artis }));
  ok('10g2 kopyanın başlangıcı taban → hedef vektörü kadar ötelenir', (y7.basliklar || []).some(q => esit3(q, y7.beklenen, 1e-6)), JSON.stringify({ beklenen: y7.beklenen, basliklar: y7.basliklar }));
  ok('10g3 komut kendiliğinden kapanır', y7.kip === null, JSON.stringify(y7.kip));

  // ---- 10h · 3B AYNALA: iki noktadan geçen düşey düzlem
  const y8 = await calis(`
    /*
     * Ayna düzlemi DOKUNUŞLA verilir, yani düzlemin iki noktası da yakalanabilir bir nesnenin
     * üstünde olmalıdır. Sınama bunun için y = 80 doğrultusunda bir "ayna kirişi" çizer;
     * aynalanan nesne ondan ayrı ikinci bir çizgidir.
     */
    E.addEnts([{ type: 'LINE', pts: [[150, 80, 10], [250, 80, 10]] }, { type: 'LINE', pts: [[150, 120, 10], [250, 140, 10]] }]);
    await bekle(400);
    const bul = (x, y) => P().filter(q => q.ent && q.ent.type === 'LINE' && q.ent.pts && q.ent.pts[0][0] === x && q.ent.pts[0][1] === y).pop();
    const kiris = bul(150, 80), hedef = bul(150, 120);
    if (!kiris || !hedef) return { yok: true };
    const geri = yalniz([kiris, hedef]);
    E.setSelection([hedef]);
    const once = uclar(hedef);
    const [A, B] = uclar(kiris);
    const sa = v.project(A[0], A[1], A[2]), sb = v.project(B[0], B[1], B[2]);
    E.act('3:mirror'); await bekle(300);
    await dokun(sa[0], sa[1]);
    await dokun(sb[0], sb[1]);
    await bekle(900);
    const p2 = P().find(q => q.key === hedef.key);
    const sonra = p2 ? uclar(p2) : null;
    geri();
    return { once, sonra, kip: E.m3 };
  `);
  {
    const o = y8.once, sn = y8.sonra;
    // y = 80 düzlemine göre yansıma: (x, y, z) → (x, 160 - y, z)
    const bek = o && o.map(q => [q[0], 160 - q[1], q[2]]);
    ok('10h 3B aynala: XY yansır, KOT korunur', !!sn && esit3(sn[0], bek[0], 1e-6) && esit3(sn[1], bek[1], 1e-6), JSON.stringify({ once: o, sonra: sn, beklenen: bek }));
    ok('10h2 komut kendiliğinden kapanır', y8.kip === null, JSON.stringify(y8.kip));
  }
  await page.screenshot({ path: `${out}/e_3d_duzenleme.png` });

  // ---- 10i · seçim yoksa 3B düzenleme komutu başlamaz (AutoCAD'de de ilk istem nesne seçimidir)
  const y9 = await calis(`
    E.setSelection([]);
    const durum = {};
    const kutu = () => { const d = document.getElementById('askDlg'); return !!d && !d.hidden; };
    for (const ad of ['3:move', '3:copy', '3:rotate', '3:scale', '3:mirror', '3:setz', '3:del']) {
      E.act(ad); await bekle(200);
      durum[ad] = (E.m3 ? E.m3.name : null);
      if (kutu()) durum[ad] = 'KUTU';        // seçim yokken değer kutusu açılmamalı (Kot ata)
      if (E.m3) E.m3 = null;
    }
    durum.cizgiSayisi = P().filter(q => q.ent && q.ent.type === 'LINE').length;
    return durum;
  `);
  ok('10i seçim yokken hiçbir 3B düzenleme komutu açılmaz (Kot ata kutu bile açmaz)',
    ['3:move', '3:copy', '3:rotate', '3:scale', '3:mirror', '3:setz', '3:del'].every(k => y9[k] === null), JSON.stringify(y9));
}

ok('7 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
