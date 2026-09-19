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
    // Kutuya çizilen metni yeniden kur: yoğun kipte hudText(true) + Z aralığı aynı satırdadır
    const bb = v.bb, cl = v.opts.clip, F = window.dwgApp.editor.fmt || ((n) => String(n));
    const z = cl ? `Z: ${F(cl[2])} … ${F(cl[5])}` : bb ? `Z: ${F(bb[2])} … ${F(bb[5])}` : '';
    return { hud: v.opts.hud, kutu: v._hudBox ? { w: Math.round(v._hudBox.w), h: v._hudBox.h } : null,
      metin: v.hudText(true) + '  ' + z, tam: v.hudText() };
  });
  /*
   * YOĞUN BİLGİ SATIRI (v7.82). v7.79'da kutu iki satır ve 32 px'ti. Kullanıcı "%50 küçültelim"
   * dedi; kazanç metni kısaltmaktan geldi: "Izgara N m" ve "Paralel/Perspektif" durum çubuğunda
   * (#stGrid, #stMode) ZATEN yazıyordu, HUD'dan çıkarıldı ve Z aralığı kamera satırının sonuna
   * alındı. Tek satır kaldı: satır yüksekliği 12 → 10, iç boşluk 4 → 3, yazı 10 → 9 px → 16 px.
   * Üst sınır 20 px: iki satıra dönerse (çok dar tuval) bu denetim uyarır.
   */
  ok('8a bilgi satırı YOĞUN: tek satırlık kutu 20 px altında (v7.79\'da 32 px idi)', !!h1.kutu && h1.kutu.h > 0 && h1.kutu.h <= 20, JSON.stringify(h1));
  /*
   * Yoğun HUD yalnız GERÇEK yinelenmeyi atar: "Paralel / Perspektif" durum çubuğundaki #stMode
   * çipinde ("3B · Paralel") 3B açıkken her zaman yazar. IZGARA ATILMAZ — durum çubuğundaki çip
   * 2B ızgarayı gösterir ve 2B ızgara kapalıyken hiç görünmez; HUD'daki adım ise 3B zemin
   * ızgarasınındır. İkisi ayrı ölçüdür.
   */
  ok('8a2 yoğun HUD izdüşümü YİNELEMEZ (durum çubuğunda "3B · Paralel" yazar)', !/Paralel|Persp/.test(h1.metin || ''), JSON.stringify(h1.metin));
  ok('8a2b ama 3B ızgara adımını SAKLAMAZ (2B çipiyle aynı ölçü değildir)', /Izgara/.test(h1.metin || ''), JSON.stringify(h1.metin));
  ok('8a3 yoğun HUD kamera açılarını ve Z aralığını TEK satırda verir', /Yaw/.test(h1.metin || '') && /Z:/.test(h1.metin || ''), JSON.stringify(h1.metin));

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

// ---------------------------------------------------------------------------------
// 11 · v7.82: 3B'de Geri al / Yinele görünür, yoğun çubuklar, Çiz şeridinde katman / renk
// ---------------------------------------------------------------------------------
{
  /*
   * KULLANICININ BİLDİRİMİ: "3d çizim yaparken redo undo tuşları görünmüyor."
   * Kök neden CSS'teydi: body.mode3d BÜTÜN .st-quick satırını gizliyordu. O karar 3B yalnız
   * BAKILAN bir görünümken doğruydu (ızgara, çizgi kalınlığı, yazı, 2B yakalama gerçekten
   * anlamsız); v7.81 ile 3B'de çizgi çiziliyor, taşınıyor, döndürülüyor — geri alınamayan bir
   * düzenleme kipi olmaz. Artık yalnız 2B'ye özgü dört anahtar gizlenir.
   */
  const u1 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    if (!E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 700)); }
    const gor = (sel) => { const b = document.querySelector(sel); if (!b) return null; const r = b.getBoundingClientRect(); return { v: getComputedStyle(b).display !== 'none' && r.width > 0 && r.height > 0, w: Math.round(r.width), h: Math.round(r.height), kapali: b.disabled }; };
    return {
      uc: E.is3D(),
      undo: gor('#stQuick [data-quick="undo"]'), redo: gor('#stQuick [data-quick="redo"]'),
      grid: gor('#stQuick [data-quick="grid"]'), text: gor('#stQuick [data-quick="text"]'),
      osnap: gor('#stQuick [data-quick="osnap"]'), lw: gor('#stQuick [data-quick="lw"]'),
      koord: gor('#stCoord'),
    };
  });
  ok('11a 3B\'de Geri al ve Yinele durum çubuğunda GÖRÜNÜR', u1.uc === true && !!u1.undo && u1.undo.v === true && !!u1.redo && u1.redo.v === true, JSON.stringify(u1));
  ok('11a2 iki düğme de 40 px dokunma hedefini korur', !!u1.undo && u1.undo.w >= 40 && u1.undo.h >= 40 && u1.redo.w >= 40 && u1.redo.h >= 40, JSON.stringify({ undo: u1.undo, redo: u1.redo }));
  ok('11b 2B\'ye özgü dört anahtar ve 2B imleç koordinatı 3B\'de GİZLİ kalır',
    [u1.grid, u1.lw, u1.text, u1.osnap, u1.koord].every(x => x && x.v === false), JSON.stringify({ grid: u1.grid, lw: u1.lw, text: u1.text, osnap: u1.osnap, koord: u1.koord }));

  // Geri al gerçekten çalışır: 3B'de bir çizgi çiz, durum çubuğundaki düğmeyle geri al
  const u2 = await page.evaluate(async () => {
    const E = window.dwgApp.editor, P = () => window.dwgApp.state.scene.layouts[0].prims;
    const say = () => P().filter(q => q.ent && q.ent.type === 'LINE').length;
    E.act('tab:draw'); await new Promise(r => setTimeout(r, 200));
    const once = say();
    E.act('3:line'); await new Promise(r => setTimeout(r, 250));
    const yaz = async (t) => { const i = document.getElementById('cmdInput'); i.value = t; document.getElementById('cmdEnter').click(); await new Promise(r => setTimeout(r, 250)); };
    await yaz('5,5,1'); await yaz('15,5,1');
    const btn = document.querySelector('#cmdBtns [data-cmd3="finish"]'); if (btn) btn.click();
    await new Promise(r => setTimeout(r, 250));
    const cizildi = say();
    const ub = document.querySelector('#stQuick [data-quick="undo"]');
    const kapaliydi = ub.disabled;
    ub.click(); await new Promise(r => setTimeout(r, 500));
    return { once, cizildi, sonra: say(), kapaliydi, rozet: ub.querySelector('.st-ct') ? ub.querySelector('.st-ct').textContent : null };
  });
  ok('11c 3B çizgi çizildi, durum çubuğundaki Geri al onu geri aldı', u2.cizildi === u2.once + 1 && u2.sonra === u2.once && u2.kapaliydi === false, JSON.stringify(u2));

  // Çiz şeridi 3B'de artık katman / renk ve geri al / yinele de gösterir (2B Çiz şeridiyle simetri)
  const u3 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    if (!E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 700)); }
    E.act('tab:draw'); await new Promise(r => setTimeout(r, 250));
    const row = document.querySelector('#toolbar .tb-row[data-for="draw"]');
    const k = row ? [...row.querySelectorAll('[data-act]')].map(b => b.dataset.act) : [];
    const tekil = k.length === new Set(k).size;
    return { karolar: k, tekil };
  });
  ok('11d 3B Çiz şeridinde Katman, Renk, Geri al ve Yinele var', ['layer', 'color', 'undo', 'redo'].every(a => u3.karolar.includes(a)), JSON.stringify(u3.karolar));
  ok('11d2 şeritte aynı karo iki kez çizilmedi', u3.tekil === true, JSON.stringify(u3.karolar));

  /*
   * YOĞUN ÇUBUKLAR. Ölçüm BOŞTAKİ çubukta yapılır — kullanıcının ekran görüntüsündeki durum odur.
   * Çalışan komutun çubuğu istem metnine kendi satırını verir (iki satır) ve zaten daha yüksektir;
   * onu yoğun kiple karşılaştırmak elmayla armudu ölçmek olurdu.
   * Ortho düğmesinin yoğun ölçüsü (30 x 24) test_ortho 1b'nin sözleşmesidir: Ortho bir 2B kısıtıdır,
   * 3B'de hiç gösterilmez (burada offsetWidth 0 döner).
   */
  const u4 = await page.evaluate(async () => {
    const M = await import('./editor.js'), E = window.dwgApp.editor;
    if (E.m3) { E.m3 = null; }
    if (E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 500)); }   // 2B: boşta çubuk burada
    if (E.tools && E.tools.running) E.tools.cancel();
    const bar = document.getElementById('cmdBar');
    if (bar.hidden) { E.act('cmdline'); await new Promise(r => setTimeout(r, 200)); }
    if (bar.hidden) { E.act('cmdline'); await new Promise(r => setTimeout(r, 200)); }
    await new Promise(r => setTimeout(r, 250));
    const olc = () => {
      const inp = document.getElementById('cmdInput'), en = document.getElementById('cmdEnter');
      return { bar: bar.offsetHeight, bosta: bar.classList.contains('idle'), giris: inp.offsetHeight, enter: en ? en.offsetHeight : null };
    };
    const yogun = olc();
    M.ui.denseBars = false; M.applyUi(); await new Promise(r => setTimeout(r, 250));
    const genis = olc();
    M.ui.denseBars = true; M.ui.glove = true; M.applyUi(); await new Promise(r => setTimeout(r, 250));
    const eldiven = olc();
    M.ui.glove = false; M.applyUi(); await new Promise(r => setTimeout(r, 250));
    return { yogun, genis, eldiven, acik: M.ui.denseBars };
  });
  ok('11e yoğun kip öntanımlı AÇIK ve giriş 26 px (eski 40 px)', u4.acik === true && u4.yogun.giris === 26, JSON.stringify(u4));
  ok('11e2 yoğun kapatılınca eski 40 px geri gelir', u4.genis.giris === 40, JSON.stringify(u4));
  ok('11e3 eldiven kipi yoğun kipi EZER (52 px)', u4.eldiven.giris === 52 && u4.eldiven.bar > u4.genis.bar, JSON.stringify(u4));
  ok('11e4 boştaki yoğun çubuk 32 px altında ve genişten en az %30 kısa', u4.yogun.bosta === true && u4.yogun.bar > 0 && u4.yogun.bar < 32 && u4.yogun.bar <= u4.genis.bar * 0.7, JSON.stringify({ yogun: u4.yogun.bar, genis: u4.genis.bar, eldiven: u4.eldiven.bar }));
  ok('11e5 Enter düğmesi de küçülür ama WCAG 24 px tabanının üstünde kalır', u4.yogun.enter >= 24 && u4.yogun.enter < u4.genis.enter, JSON.stringify({ y: u4.yogun.enter, g: u4.genis.enter, e: u4.eldiven.enter }));
}


// ---------------------------------------------------------------------------------
// 12 · v7.83: denetimin iki bulgusu — HUD vuruş bandı ve yinelenen tbLayer kimliği
// ---------------------------------------------------------------------------------
{
  /*
   * KUTU KÜÇÜLDÜ, HEDEF KÜÇÜLMEDİ. v7.82 bilgi satırını 32 → 16 px'e indirdi; dokunma hedefi
   * de onunla birlikte 16 px'e inmişti. Komut çubuğunda tutulan taban (WCAG 2.2 AA Target Size
   * (Minimum), 24 px) HUD'da da geçerlidir: kutu küçük çizilir, vuruş bandı dikeyde 24 px'e
   * tamamlanır. Bandın DIŞI çizime kalır — yoksa tuvalin üst şeridi yutulurdu.
   */
  const g1 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    if (!E.is3D()) { E.act('3d'); await new Promise(r => setTimeout(r, 600)); }
    const v = E.view3d();
    if (!v.opts.hud) { E.act('hud3'); await new Promise(r => setTimeout(r, 300)); }
    await new Promise(r => setTimeout(r, 250));
    return v._hudBox ? { h: v._hudBox.h, y: v._hudBox.y, x: v._hudBox.x, w: v._hudBox.w } : null;
  });
  ok('12a yoğun HUD kutusu hâlâ 20 px altında', !!g1 && g1.h > 0 && g1.h <= 20, JSON.stringify(g1));

  const dokunHud = (dy) => page.evaluate(async (dy) => {
    const E = window.dwgApp.editor, v = E.view3d();
    if (!v.opts.hud) { E.act('hud3'); await new Promise(r => setTimeout(r, 300)); }
    const b = v._hudBox, cv = document.getElementById('cv3d') || document.getElementById('cv');
    const r0 = cv.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r0.left + b.x + b.w / 2, clientY: r0.top + b.y + b.h + dy, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    cv.dispatchEvent(new PointerEvent('pointerdown', o));
    cv.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    await new Promise(r => setTimeout(r, 400));
    return { hud: v.opts.hud, kutuAlti: Math.round(b.y + b.h + dy) };
  }, dy);

  const g2 = await dokunHud(3);   // kutunun 3 px altı: 24 px'lik bandın İÇİ
  ok('12b kutunun hemen altı (24 px bandın içi) da bilgi satırını gizler', g2.hud === false, JSON.stringify(g2));
  await page.evaluate(async () => { const E = window.dwgApp.editor; E.act('hud3'); await new Promise(r => setTimeout(r, 300)); });

  const g3 = await dokunHud(24);  // bandın DIŞI: dokunuş çizime gider, HUD kalır
  ok('12c bandın dışı çizime kalır: HUD gizlenmez', g3.hud === true, JSON.stringify(g3));

  /*
   * ELDİVEN KİPİ YOĞUN KİPİ EZER — app.css'teki body.dense-bars.glove kuralının HUD karşılığı.
   * Eldivenle çalışan kullanıcı büyük hedef ister; kutu tam boyuna döner.
   */
  const g4 = await page.evaluate(async () => {
    const M = await import('./editor.js'), E = window.dwgApp.editor, v = E.view3d();
    if (!v.opts.hud) { E.act('hud3'); await new Promise(r => setTimeout(r, 300)); }
    await new Promise(r => setTimeout(r, 250));
    const yogun = v._hudBox.h;
    M.ui.denseBars = false; M.applyUi(); await new Promise(r => setTimeout(r, 400));
    const genis = { h: v._hudBox.h, metin: v.hudText(false) };
    M.ui.denseBars = true; M.applyUi(); await new Promise(r => setTimeout(r, 400));
    M.ui.glove = true; M.applyUi(); await new Promise(r => setTimeout(r, 400));
    const eldiven = v._hudBox.h;
    M.ui.glove = false; M.applyUi(); await new Promise(r => setTimeout(r, 400));
    return { yogun, genis, eldiven, geri: v._hudBox.h };
  });
  ok('12d eldiven kipinde HUD yoğun DEĞİL: kutu tam boya döner', g4.eldiven >= 28 && g4.eldiven > g4.yogun && g4.geri === g4.yogun, JSON.stringify(g4));
  // Yoğun kip elle kapatılınca da eski iki satırlık kutu geri gelir; izdüşüm türü metne döner.
  ok('12d2 yoğun kapatılınca HUD eski boyuna döner ve izdüşüm türü geri gelir', g4.genis.h >= 28 && g4.genis.h === g4.eldiven && /Paralel|Persp/.test(g4.genis.metin || ''), JSON.stringify(g4));

  /*
   * id="tbLayer" TEKİL OLMALI. 'layer' karosu Çiz, Açıklama ve 3B Çiz şeritlerinde geçer;
   * kimlik sekmeye bağlanmadığı için DOM'da iki kez üretiliyordu (geçersiz HTML) ve
   * updateLayerButton getElementById ile yalnız ilkini güncelliyordu.
   */
  const g5 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    const say = () => document.querySelectorAll('[id="tbLayer"]').length;
    const ucB = say();
    E.act('3d'); await new Promise(r => setTimeout(r, 600));
    const ikiB = say();
    return { ucB, ikiB, m3: E.is3D() };
  });
  ok('12e tbLayer kimliği hem 2B hem 3B kipinde TEK', g5.ucB === 1 && g5.ikiB === 1, JSON.stringify(g5));

  const g6 = await page.evaluate(async () => {
    const E = window.dwgApp.editor;
    const ad = [...window.dwgApp.state.layers.keys()].find(n => n && n.length <= 10) || [...window.dwgApp.state.layers.keys()][0];
    E.setCurLayer(ad); await new Promise(r => setTimeout(r, 200));
    const etiketler = [...document.querySelectorAll('#toolbar [data-act="layer"] .lb')].map(el => el.textContent);
    return { ad, etiketler, n: etiketler.length };
  });
  ok('12f geçerli katman adı BÜTÜN kopyalara yazılır (Çiz + Açıklama)', g6.n >= 2 && g6.etiketler.every(x => x === g6.ad), JSON.stringify(g6));
}

// ---------------------------------------------------------------------------------
// 13 · v7.84: üstteki sığdır kalktı · 3B bölge seçimi · takılı kalmayan işaret · parmakla nişan
// ---------------------------------------------------------------------------------
{
  const ORTAK = `
    const E = window.dwgApp.editor, v = E.view3d(), P = () => window.dwgApp.state.scene.layouts[0].prims;
    const bekle = (ms) => new Promise(r => setTimeout(r, ms));
    const cv3 = () => document.getElementById('cv3d');
    const olay = (tur, sx, sy, ek) => {
      const cv = cv3(), r0 = cv.getBoundingClientRect();
      cv.setPointerCapture = () => {};
      cv.dispatchEvent(new PointerEvent(tur, { bubbles: true, cancelable: true, clientX: r0.left + sx, clientY: r0.top + sy, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: tur === 'pointerup' ? 0 : 1, ...(ek || {}) }));
    };
    const bas = async (sx, sy) => { olay('pointerdown', sx, sy); await bekle(30); };
    const kaydir = async (sx, sy) => { olay('pointermove', sx, sy); await bekle(30); };
    const birak = async (sx, sy) => { olay('pointerup', sx, sy); await bekle(360); };
    /** Bir uçtan ötekine sürükler; ara adımlar gerçek parmak gibi tek tek gönderilir. */
    const surukle = async (x0, y0, x1, y1, n = 6) => {
      await bas(x0, y0);
      for (let i = 1; i <= n; i++) await kaydir(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
      await birak(x1, y1);
    };
    const yalniz = (liste) => {
      const m = window.dwgApp.state.scene.layouts[0], yedek = m.prims.slice();
      m.prims.length = 0; for (const q of liste) m.prims.push(q);
      return () => { m.prims.length = 0; for (const q of yedek) m.prims.push(q); };
    };
    const uc = (p, i) => v.project(p.ops[i][1], p.ops[i][2], p.ops[i][3] || 0);
  `;
  const calis = (govde) => page.evaluate(`(async () => {${ORTAK}${govde}})()`);

  // ---- 13a · üst çubuktaki sığdır düğmesi kalktı; sağ kenardaki 3B'de GERÇEKTEN sığdırıyor
  const g1 = await calis(`
    if (E.m3) { E.act('3:select'); E.m3 = null; }
    if (!E.is3D()) { E.act('3d'); await bekle(700); }
    const ust = document.getElementById('btnExtents');
    const fab = document.querySelector('#navFabs [data-nav="fit"]');
    v.fit(); v.render(); await bekle(150);
    const sigdirilmis = v.cam.dist;
    v.zoom(3); v.render(); await bekle(150);
    const bozuk = v.cam.dist;
    const r = fab.getBoundingClientRect();
    fab.setPointerCapture = () => {};
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    fab.dispatchEvent(new PointerEvent('pointerdown', o));
    fab.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    await bekle(300);
    return { ustVar: !!ust, fabVar: !!fab, sigdirilmis, bozuk, sonra: v.cam.dist };
  `);
  ok('13a üst çubukta sığdır düğmesi YOK (3B\'de çalışmıyordu, sağ kenarda eşi var)', g1.ustVar === false, JSON.stringify(g1));
  ok('13a2 sağ kenardaki sığdır 3B kamerayı gerçekten sığdırır', g1.fabVar === true && Math.abs(g1.bozuk - g1.sigdirilmis) > 1e-6 && Math.abs(g1.sonra - g1.sigdirilmis) < Math.abs(g1.bozuk - g1.sigdirilmis) * 0.05, JSON.stringify(g1));

  // ---- 13b · Seç komutunda Pencere / Çokgen düğmeleri ve sürükleme kuralını söyleyen istem
  const g2 = await calis(`
    E.act('tab:draw'); await bekle(250);
    E.act('3:select'); await bekle(250);
    const dg = [...document.querySelectorAll('#cmdBtns [data-cmd3]')].map(b => b.dataset.cmd3);
    const metin = document.getElementById('cmdText').textContent;
    document.querySelector('#cmdBtns [data-cmd3="sellasso"]').click(); await bekle(200);
    const lassoKip = E.m3 && E.m3.selMode, lassoMetin = document.getElementById('cmdText').textContent;
    document.querySelector('#cmdBtns [data-cmd3="sellasso"]').click(); await bekle(200);
    const kapali = E.m3 && E.m3.selMode;
    return { dg, metin, lassoKip, lassoMetin, kapali };
  `);
  ok('13b Seç komutunda Pencere ve Çokgen düğmeleri var', g2.dg.includes('selbox') && g2.dg.includes('sellasso'), JSON.stringify(g2.dg));
  ok('13b2 istem sürükleme kuralını söyler (→ Pencere ← Kesen)', /Pencere/.test(g2.metin) && /Kesen/.test(g2.metin), g2.metin);
  ok('13b3 Çokgen düğmesi kipi açar, ikinci dokunuş kapatır', g2.lassoKip === 'lasso' && g2.kapali === 'tap' && /Çokgen|çokgen/.test(g2.lassoMetin), JSON.stringify(g2));

  // ---- 13c · ÖRTÜK PENCERE: boş yerden soldan sağa sürükleme, tamamı içeride olanı seçer
  const g3 = await calis(`
    const p = P().find(q => q.et === 'LINE' && q.ops && q.ops.length === 2);
    if (!p) return { yok: true };
    const geri = yalniz([p]);
    E.sel.clear(); E.m3 = null;
    E.act('3:select'); await bekle(250);
    const A = uc(p, 0), B = uc(p, 1);
    const x0 = Math.min(A[0], B[0]) - 40, y0 = Math.min(A[1], B[1]) - 40;
    const x1 = Math.max(A[0], B[0]) + 40, y1 = Math.max(A[1], B[1]) + 40;
    let kip = null;
    await bas(x0, y0);
    await kaydir(x0 + 20, y0 + 10);
    kip = E.sel3DragState();
    for (let i = 2; i <= 6; i++) await kaydir(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6);
    await birak(x1, y1);
    const n = E.sel.size, bitti = E.sel3DragState();
    E.sel.clear(); E.m3 = null; E.act('3:select'); await bekle(150); E.m3 = null;
    geri();
    return { n, kip, bitti };
  `);
  ok('13c boş yerden soldan sağa sürükleme ÖRTÜK PENCERE açar (mavi, kesen değil)', !!g3.kip && g3.kip.mode === 'box' && g3.kip.implied === true && g3.kip.crossing === false, JSON.stringify(g3));
  ok('13c2 pencere içindeki nesne seçilir ve sürükleme biter', g3.n === 1 && g3.bitti === null, JSON.stringify(g3));

  // ---- 13d · KESEN: sağdan sola sürükleme, yalnız DEĞEN nesneyi de alır
  const g4 = await calis(`
    const p = P().find(q => q.et === 'LINE' && q.ops && q.ops.length === 2);
    const geri = yalniz([p]);
    E.sel.clear(); E.m3 = null;
    E.act('3:select'); await bekle(250);
    const A = uc(p, 0), B = uc(p, 1);
    /*
     * Sürükleme BOŞ yerden başlamalı, yoksa örtük pencere açılmaz (dokunuş nesneyi seçer).
     * yalniz() yalnız model ilkellerini kısıtlar; 3B KÖŞE TAMPONU bütün çizimi taşımaya devam
     * eder, dolayısıyla "nesneden 60 px uzak" olmak yetmez. Başlangıç, sahnenin ekrandaki
     * kutusunun sağ dışına alınır: orada kesinlikle köşe yoktur.
     */
    let vx1 = -Infinity, vy1 = -Infinity;
    for (const q of v.vertices) { const s = v.project(q[0], q[1], q[2]); if (s[0] > vx1) vx1 = s[0]; if (s[1] > vy1) vy1 = s[1]; }
    const ox = (A[0] + B[0]) / 2, oy = (A[1] + B[1]) / 2;
    // Kutu yalnız yarısını örter: pencere olsaydı boş dönerdi, kesen nesneyi alır.
    const sx0 = vx1 + 50, sy0 = vy1 + 50, sx1 = ox, sy1 = oy;
    await bas(sx0, sy0);
    await kaydir(sx0 - 20, sy0 - 8);
    const kip = E.sel3DragState();
    for (let i = 2; i <= 6; i++) await kaydir(sx0 + (sx1 - sx0) * i / 6, sy0 + (sy1 - sy0) * i / 6);
    await birak(sx1, sy1);
    const n = E.sel.size;
    E.sel.clear(); E.m3 = null;
    geri();
    return { n, kip };
  `);
  ok('13d sağdan sola sürükleme KESEN kipini açar (yeşil)', !!g4.kip && g4.kip.crossing === true, JSON.stringify(g4));
  ok('13d2 kesen, yalnız DEĞEN nesneyi de seçer', g4.n === 1, JSON.stringify(g4));

  // ---- 13e · ÇOKGEN (lasso) seçimi
  const g5 = await calis(`
    const p = P().find(q => q.et === 'LINE' && q.ops && q.ops.length === 2);
    const geri = yalniz([p]);
    E.sel.clear(); E.m3 = null;
    E.act('3:select'); await bekle(250);
    document.querySelector('#cmdBtns [data-cmd3="sellasso"]').click(); await bekle(200);
    const A = uc(p, 0), B = uc(p, 1);
    const x0 = Math.min(A[0], B[0]) - 40, y0 = Math.min(A[1], B[1]) - 40;
    const x1 = Math.max(A[0], B[0]) + 40, y1 = Math.max(A[1], B[1]) + 40;
    await bas(x0, y0);
    await kaydir(x1, y0); await kaydir(x1, y1); await kaydir(x0, y1);
    const kip = E.sel3DragState();
    await birak(x0, y1);
    const n = E.sel.size;
    E.sel.clear(); E.m3 = null;
    geri();
    return { n, kip };
  `);
  ok('13e Çokgen kipinde sürükleme çokgen bölge çizer', !!g5.kip && g5.kip.mode === 'lasso', JSON.stringify(g5));
  ok('13e2 çokgenin içindeki nesne seçilir', g5.n === 1, JSON.stringify(g5));

  // ---- 13f · YAKALAMA İŞARETİ TAKILI KALMIYOR (v7.83'te komut bittikten sonra ekranda duruyordu)
  const g6 = await calis(`
    const p = P().find(q => q.et === 'LINE' && q.ops && q.ops.length === 2);
    const geri = yalniz([p]);
    E.sel.clear(); E.m3 = null;
    const U = (await import('./editor.js')).ui; U.snap3 = true; U.snap3Modes = ['end', 'mid', 'cen'];
    E.act('3:dist'); await bekle(250);
    const A = uc(p, 0);
    await bas(A[0], A[1]); await birak(A[0], A[1]);
    const komutSirasinda = E.snap3State();
    document.querySelector('#cmdBtns [data-cmd3="cancel"]').click(); await bekle(250);
    const iptalSonrasi = E.snap3State();
    geri();
    return { komutSirasinda, iptalSonrasi, m3: !!E.m3 };
  `);
  ok('13f komut sürerken yakalama işareti VAR', !!g6.komutSirasinda && g6.komutSirasinda.kind === 'end', JSON.stringify(g6));
  ok('13f2 komut iptal edilince işaret KALKAR (ekranda asılı kalmaz)', g6.iptalSonrasi === null && g6.m3 === false, JSON.stringify(g6));

  // ---- 13g · PARMAKLA NİŞAN: uzun basış işareti parmağa bağlar, komşu nesneye ATLAR
  const g7 = await calis(`
    const doc = E.doc;
    const yeni = (a, b) => ({ type: 'LINE', pts: [a, b], id: 'N' + Math.random().toString(36).slice(2, 8), layer: '0', color: 256 });
    doc.run({ op: 'add', ents: [yeni([0, 0, 0], [40, 0, 0]), yeni([300, 0, 0], [340, 0, 0])] });
    E.refresh3D ? E.refresh3D() : null; await bekle(300);
    const hepsi = P().filter(q => q.et === 'LINE' && q.ops && q.ops.length === 2);
    const a1 = hepsi.find(q => Math.abs(q.ops[0][1]) < 1e-6 && Math.abs(q.ops[0][2]) < 1e-6);
    const a2 = hepsi.find(q => Math.abs(q.ops[0][1] - 300) < 1e-6);
    if (!a1 || !a2) return { yok: true, n: hepsi.length };
    const geri = yalniz([a1, a2]);
    E.sel.clear(); E.m3 = null;
    const U = (await import('./editor.js')).ui; U.snap3 = true; U.snap3Modes = ['end', 'mid', 'cen'];
    E.act('3:dist'); await bekle(250);
    const U1 = uc(a1, 0), U2 = uc(a2, 0);
    await bas(U1[0] + 3, U1[1] + 3);
    await bekle(700);                      // uzun basış: nişan açılır (taban 500 ms)
    const nisan1 = E.snap3State();
    await kaydir(U2[0] + 2, U2[1] + 2);    // parmak ikinci çizgiye yaklaşır
    const nisan2 = E.snap3State();
    await birak(U2[0] + 2, U2[1] + 2);
    const alinan = E.m3 && E.m3.pts.length ? E.m3.pts[0] : null;
    if (E.m3) { E.m3.pts = []; E.m3 = null; }
    geri();
    if (doc.undo()) { E.refresh3D ? E.refresh3D() : null; }
    return { nisan1, nisan2, alinan, U1, U2 };
  `);
  ok('13g uzun basış nişanı açar: işaret parmağın altındaki uca oturur', !!g7.nisan1 && g7.nisan1.aim === true && g7.nisan1.kind === 'end', JSON.stringify(g7));
  ok('13g2 parmak komşu nesneye yaklaşınca işaret ORAYA ATLAR', !!g7.nisan2 && Math.abs(g7.nisan2.p[0] - 300) < 1e-6, JSON.stringify(g7));
  ok('13g3 parmak kalkınca nokta imlecin durduğu yere işlenir', !!g7.alinan && Math.abs(g7.alinan[0] - 300) < 1e-6, JSON.stringify(g7));
}


ok('7 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 200));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
