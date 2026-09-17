// Ölçülendirme özelliklerinin düzenlenmesi (v7.56): her ölçü tanımını (def) taşır, özellikler kutusundan
// yeniden kurulur — yazı, yükseklik, ok, ondalık, ön / son ek, çarpan, uzatma boşluğu / taşması. Taşıma,
// döndürme, ölçek, ayna, kopya ve pano tanımı da taşır; dosyadan gelen DIMENSION varlıkları (hizalı, dönük,
// yarıçap, çap, açısal) tanım noktalarından ve ölçü stilinden çevrilir; ordinat gibi türler dürüstçe reddedilir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_olcu_duzenle.mjs [çıktı] [örnekler]
import fs from 'node:fs';
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const J = JSON.stringify;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await openFile(page, `${SM}/example_2000.dwg`, { settle: 400 });
const ev = (fn, a) => page.evaluate(fn, a);
const bekle = (ms = 150) => page.waitForTimeout(ms);
await ev(() => { localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; window.dwgApp.osnap.setModes([]); });

// ---- yardımcılar ----------------------------------------------------------------------------------
/** Dünya noktasına dokunuş; ardışık dokunuşlar çift dokunma sayılmasın diye 380 ms beklenir */
const tapWorld = async (x, y) => {
  await ev(() => { document.getElementById('toast').hidden = true; });   // bildirim dokunuşu yutmasın
  const sc = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]);
  const r = await page.locator('#viewport').boundingBox();
  await page.touchscreen.tap(r.x + sc[0], r.y + sc[1]);
  await bekle(380);
};
const prims = () => ev(() => window.dwgApp.state.scene.layouts[0].prims.length);
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
/** Bir grubun (gid) parçaları: tanım, ölçü çizgileri, yazı, ok boyu (SOLID ucundan tabanına) */
const grup = (gid) => ev((g) => {
  const ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g);
  const core = ps.find(p => p.ent && p.ent.def), txt = ps.find(p => p.k === 1);
  const sol = ps.filter(p => p.k === 0 && p.fill && p.ops.length === 3);
  const okBoyu = sol.length ? (() => { const o = sol[0].ops; const b = [(o[1][1] + o[2][1]) / 2, (o[1][2] + o[2][2]) / 2]; return Math.hypot(b[0] - o[0][1], b[1] - o[0][2]); })() : null;
  return { n: ps.length, keys: ps.map(p => p.key), def: core ? core.ent.def : null, segs: core ? core.ent.segs : null, measure: core ? core.ent.measure : null, text: txt ? txt.lines.join('\n') : null, th: txt ? txt.h : null, tx: txt ? txt.x : null, ty: txt ? txt.y : null, okBoyu, lay: core ? core.lay : null };
}, gid);
const sonGid = () => ev(() => { const ps = window.dwgApp.state.scene.layouts[0].prims; for (let i = ps.length - 1; i >= 0; i--) if (ps[i].info && ps[i].info.gid && ps[i].info.t === 'DIMENSION') return ps[i].info.gid; return null; });
/** Özellikler kutusuna sıraya konmuş cevapla düzenleme (kutu açılmaz, cevap hemen döner) */
const duzenle = async (gid, cevap) => { await queueAnswers(page, cevap); return ev(async (g) => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.gid === g); return window.dwgApp.editor.tools.editDim(p); }, gid); };
const gunluk = () => ev(() => { const d = window.dwgApp.editor.doc; return { log: d.log.length, u: d.undoStack.length, r: d.redoStack.length }; });
const fmt = (v, d) => ev(async ([v, d]) => { const St = await import('./state.js'); return St.fmt(v, d == null ? undefined : d); }, [v, d]);
const xf = (g, m) => ev(([g, m]) => { const ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g); return window.dwgApp.editor.runCmd({ op: 'xform', keys: ps.map(p => p.key), m, dz: 0 }); }, [g, m]);
const rotM = (a, cx, cy) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; };
/** Aracı başlatır: çalışan araç önce iptal edilir (aynı karoya ikinci dokunuş aracı kapatırdı), bilgi paneli kapatılır */
const arac = async (id) => { await ev((id) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); document.getElementById('infoPanel').hidden = true; E.act(id); }, id); await bekle(200); };
const TAP = 1e-3;   // dokunuşla girilen noktalar ekran pikseline yuvarlanır: 1e-5 düzeyinde sapma olağandır

// ---- 1. Karo, basamak, komut tablosu ------------------------------------------------------------------
{
  await page.click('#toolbar [data-tab="annot"]'); await bekle(200);
  const r = await ev(async () => {
    const E = await import('./edition.js'), A = await import('./acad.js');
    const b = document.querySelector('#toolbar [data-act="t:dimedit"]');
    return { tile: !!b, label: b ? b.querySelector('.lb').textContent : '', tier: E.FEATURE_TIER.get('t:dimedit'), ded: A.resolve('DED') && A.resolve('DED').id, dimedit: A.resolve('dimedit') && A.resolve('dimedit').id, st: A.stats() };
  });
  ok('1a "Ölçüyü düzenle" karosu ölçülendirme grubunda', r.tile && r.label === 'Ölçüyü düzenle', J([r.tile, r.label]));
  ok('1b t:dimedit Premium', r.tier === 'premium', String(r.tier));
  ok('1c DIMEDIT ve DED komutu araca bağlı', r.ded === 't:dimedit' && r.dimedit === 't:dimedit', J([r.ded, r.dimedit]));
  ok('1d komut tablosu: 487 kayıt = 175 AutoCAD + 31 özgü + 281 bulunmayan; 731 ad', r.st.total === 487 && r.st.acad === 175 && r.st.ext === 31 && r.st.known === 281 && r.st.names === 731, J(r.st));
}

// ---- 2. Doğrusal ölçü tanım taşır -------------------------------------------------------------------
await zoom([0, 0, 2000, 2000]);
const n0 = await prims();
await arac('t:dim');
await tapWorld(200, 300); await tapWorld(700, 300); await tapWorld(200, 500);
const g1 = await sonGid(); const d1 = await grup(g1);
ok('2a doğrusal ölçü dört parça, tanım (def) DIMENSION parçasında', await prims() === n0 + 4 && d1.n === 4 && !!d1.def && d1.def.kind === 'linear' && d1.def.sub === 'aligned' && d1.def.pts.length === 3, J(d1.def));
ok('2b tanım varsayılanları: ok = yükseklik, boşluk h/4, taşma h/2, ondalık ayardan, çarpan 1, yazı boş', d1.def.h > 0 && near(d1.def.arrow, d1.def.h) && near(d1.def.exo, d1.def.h * 0.25) && near(d1.def.exe, d1.def.h * 0.5) && d1.def.prec === null && d1.def.factor === 1 && d1.def.text === '', J(d1.def));
ok('2c ölçü yazısı 500 + birim', /^500/.test(d1.text) && d1.text.endsWith(d1.def.suffix), d1.text);

// ---- 3. Özellikler kutusu: yazı, yükseklik, ok, ondalık, ön / son ek, çarpan, boşluk, taşma ------------
const l0 = await gunluk();
const r3 = await duzenle(g1, { text: '', h: 40, arrow: 30, prec: '1', prefix: 'L=', suffix: ' mm', factor: '2', exo: 5, exe: 12 });
await bekle(200);
const d3 = await grup(g1), l3 = await gunluk();
const beklenen3 = 'L=' + await fmt(1000, 1) + ' mm';
ok('3a düzenleme uygulandı: dört parça, yeni anahtarlar, aynı grup', r3 === true && d3.n === 4 && d3.keys.every(k => !d1.keys.includes(k)), J(d3.keys));
ok('3b yazı: ön ek + çarpan 2 + 1 ondalık + son ek → ' + beklenen3, d3.text === beklenen3, d3.text);
ok('3c yazı yüksekliği 40, ok boyu 30', near(d3.th, 40) && near(d3.okBoyu, 30), J([d3.th, d3.okBoyu]));
{
  const e1a = d3.segs[0][0], e1b = d3.segs[0][1], dl1 = d3.segs[2][0];
  ok('3d uzatma çizgisi: ölçü noktasından 5 boşluk, ölçü çizgisini 12 aşar', near(Math.hypot(e1a[0] - 200, e1a[1] - 300), 5, TAP) && near(Math.hypot(e1b[0] - dl1[0], e1b[1] - dl1[1]), 12, TAP), J([e1a, e1b, dl1]));
}
ok('3e tek geri alma adımı (günlük +1, yığın +1)', l3.log === l0.log + 1 && l3.u === l0.u + 1, J([l0, l3]));

// ---- 4. Geri al / yinele ------------------------------------------------------------------------------
await ev(() => window.dwgApp.editor.doc.undo()); await bekle(150);
const d4 = await grup(g1);
ok('4a geri al: eski dört parça aynı anahtarlarla geri geldi', d4.n === 4 && d4.keys.every(k => d1.keys.includes(k)) && /^500/.test(d4.text), J(d4.keys));
await ev(() => window.dwgApp.editor.doc.redo()); await bekle(150);
const d4b = await grup(g1);
ok('4b yinele: düzenlenmiş ölçü geri geldi', d4b.text === beklenen3 && d4b.keys.every(k => d3.keys.includes(k)), String(d4b.text));

// ---- 5. Yazı geçersiz kılma ve "<>" ---------------------------------------------------------------------
await duzenle(g1, { text: 'Toplam <>' }); await bekle(150);
const d5 = await grup(g1);
ok('5a "<>" ölçülen değerle değişir', d5.text === 'Toplam ' + beklenen3, d5.text);
await duzenle(g1, { text: 'SABİT' }); await bekle(150);
ok('5b sabit yazı ölçülen değeri gizler', (await grup(g1)).text === 'SABİT');
await duzenle(g1, { text: '', prec: 'auto', prefix: '', suffix: '', factor: '1' }); await bekle(150);
const d5c = await grup(g1), beklenen5 = await fmt(500, null);
ok('5c ondalık "ayarlardaki", ön / son ek boş, çarpan 1 → ' + beklenen5, d5c.text === beklenen5 && d5c.def.prec === null && d5c.def.factor === 1, d5c.text);

// ---- 6. Sayı alanı yerel ayardan bağımsız (binlik ayracı tuzağı) -------------------------------------------
await duzenle(g1, { h: 2200 }); await bekle(150);
await duzenle(g1, {}); await bekle(150);                 // kutu kendi değerleriyle onaylanır ("2.200" değil "2200")
const d6 = await grup(g1);
ok('6 2200 yükseklik dokunulmadan onaylanınca 2200 kalır (2,2 olmaz)', near(d6.def.h, 2200) && near(d6.th, 2200), J([d6.def.h, d6.th]));
await duzenle(g1, { h: 40, arrow: 30 }); await bekle(150);

// ---- 7. Taşınan ölçü yeni yerinde kurulur -------------------------------------------------------------
await xf(g1, [1, 0, 0, 1, 100, 50]); await bekle(150);
const d7 = await grup(g1);
ok('7a taşıma tanımı da taşıdı (p1 → 300,350; q → 300,550)', near(d7.def.pts[0][0], 300, TAP) && near(d7.def.pts[0][1], 350, TAP) && near(d7.def.pts[2][0], 300, TAP) && near(d7.def.pts[2][1], 550, TAP), J(d7.def.pts));
await duzenle(g1, { prefix: 'T=' }); await bekle(150);
const d7b = await grup(g1);
ok('7b taşınmış ölçü düzenlenince yeni yerinde kuruldu (ölçü çizgisi y = 550)', near(d7b.segs[2][0][1], 550, TAP) && near(d7b.segs[2][0][0], 300, TAP) && d7b.text.startsWith('T='), J([d7b.segs[2], d7b.text]));

// ---- 8. Döndürme, ölçek, ayna: yatay / düşey / dönük kip ------------------------------------------------
await arac('t:dimh');
await tapWorld(1000, 1000); await tapWorld(1300, 1100); await tapWorld(1000, 1200);
const g8 = await sonGid(); const d8 = await grup(g8);
ok('8a yatay ölçü: kip horizontal, ölçü 300', !!d8.def && d8.def.sub === 'horizontal' && near(d8.measure, 300, TAP), J([d8.def && d8.def.sub, d8.measure]));
await xf(g8, rotM(Math.PI / 2, 1000, 1000));
const d8b = await grup(g8);
ok('8b 90° dönüş: yatay → düşey', d8b.def.sub === 'vertical', d8b.def.sub);
await duzenle(g8, {}); await bekle(150);
const d8c = await grup(g8);
ok('8c döndürülmüş ölçü yeniden kurulunca ölçü yine 300 (düşey izdüşüm)', near(d8c.measure, 300, TAP) && d8c.def.sub === 'vertical', J([d8c.measure, d8c.def.sub]));
await xf(g8, rotM(Math.PI / 6, 1000, 1000));
const d8d = await grup(g8);
ok('8d 30° daha dönüş: "rotated" kipi, doğrultu 120°', d8d.def.sub === 'rotated' && near(d8d.def.rot, Math.PI / 2 + Math.PI / 6), J([d8d.def.sub, d8d.def.rot]));
await duzenle(g8, {}); await bekle(150);
const d8e = await grup(g8);
ok('8e dönük ölçü yeniden kurulunca ölçü korunur (300; hizalıya düşmez)', near(d8e.measure, 300, TAP) && d8e.def.sub === 'rotated', J([d8e.measure, d8e.def.sub]));
await xf(g8, [2, 0, 0, 2, 0, 0]);
const d8f = await grup(g8);
ok('8f 2× ölçek: yazı, ok, boşluk ve taşma da iki katı; ölçülen değer 600', near(d8f.def.h, 2 * d8e.def.h) && near(d8f.def.arrow, 2 * d8e.def.arrow) && near(d8f.def.exo, 2 * d8e.def.exo) && near(d8f.def.exe, 2 * d8e.def.exe) && near(d8f.measure, 600, TAP), J([d8e.def.h, d8f.def.h, d8f.measure]));
await duzenle(g8, {}); await bekle(150);
const d8f2 = await grup(g8);
ok('8f2 ölçeklenmiş ölçü yeniden kurulunca 600 ölçer, yazı iki kat', near(d8f2.measure, 600, TAP) && near(d8f2.th, d8f.def.h), J([d8f2.measure, d8f2.th]));
const n8 = await prims();
await arac('t:dimh');
// sağ kenardaki yüzen gezinme düğmeleri (navFabs) dokunuşu yutar: noktalar sol yarıda seçilir
await tapWorld(600, 1500); await tapWorld(900, 1600); await tapWorld(600, 1700);
const g8m = await sonGid();
ok('8g0 ikinci yatay ölçü kuruldu', await prims() === n8 + 4 && g8m !== g8, J([n8, await prims(), g8m, g8]));
await xf(g8m, [-1, 0, 0, 1, 3000, 0]);
const m1 = (await grup(g8m)).def.sub;
await xf(g8m, [0, 1, 1, 0, 0, 0]);
const m2 = (await grup(g8m)).def.sub;
ok('8g ayna: düşey eksende yansıma yatayı korur, x↔y takası yatayı düşey yapar', m1 === 'horizontal' && m2 === 'vertical', J([m1, m2]));

// ---- 9. Kopya yeni grup kimliği alır ----------------------------------------------------------------------
const r9 = await ev((g) => {
  const S = window.dwgApp.state, ps = S.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g);
  const nk = ps.map((_, i) => 'kopya' + i + '_' + Math.random().toString(36).slice(2, 8));
  const okk = window.dwgApp.editor.runCmd({ op: 'copy', keys: ps.map(p => p.key), newKeys: nk, m: [1, 0, 0, 1, 0, 600], dz: 0 });
  const cs = S.scene.layouts[0].prims.filter(p => nk.includes(p.key)), core = cs.find(p => p.ent && p.ent.def);
  return { okk, n: cs.length, gids: [...new Set(cs.map(p => p.info.gid))], entGid: core ? core.ent.gid : null };
}, g1);
ok('9a kopya yeni grup kimliği aldı (kaynağınkinden farklı, kopya içinde tek, ent.gid de aynı)', r9.okk && r9.n === 4 && r9.gids.length === 1 && r9.gids[0] !== g1 && r9.entGid === r9.gids[0], J([r9.gids, g1, r9.entGid]));
await duzenle(r9.gids[0], { prefix: 'K=' }); await bekle(150);
const d9 = await grup(r9.gids[0]), d9s = await grup(g1);
ok('9b kopya düzenlenince yalnız kopya değişir', d9.text.startsWith('K=') && !d9s.text.startsWith('K=') && d9s.n === 4, J([d9.text, d9s.text]));

// ---- 10. Yarıçap ve çap -----------------------------------------------------------------------------------
await ev(() => window.dwgApp.editor.addEnts([{ type: 'CIRCLE', pts: [[1500, 1500, 0]], r: 100, layer: '0', color: 1 }])); await bekle(150);
await arac('t:dimr'); await tapWorld(1600, 1500);
const g10 = await sonGid(); const d10 = await grup(g10);
ok('10a yarıçap ölçüsü: tanım radial / radius, r 100, yazı "R 100…"', !!d10.def && d10.def.kind === 'radial' && d10.def.sub === 'radius' && near(d10.def.r, 100, TAP) && /^R 100/.test(d10.text), J([d10.def, d10.text]));
await duzenle(g10, { prefix: 'R=', prec: '0', suffix: '' }); await bekle(150);
ok('10b yarıçap yazısı R=100', (await grup(g10)).text === 'R=100', (await grup(g10)).text);
await arac('t:dimd'); await tapWorld(1500, 1600);
const g10d = await sonGid(); const d10d = await grup(g10d);
ok('10c çap ölçüsü: diameter, yazı "⌀ 200…"', !!d10d.def && d10d.def.sub === 'diameter' && /^⌀ 200/.test(d10d.text), J([d10d.def && d10d.def.sub, d10d.text]));

// ---- 11. Açısal ------------------------------------------------------------------------------------------
await arac('t:dima');
await tapWorld(1800, 1800); await tapWorld(1950, 1800); await tapWorld(1800, 1950);
const g11 = await sonGid(); const d11 = await grup(g11);
ok('11a açı ölçüsü: tanım angular, 90°, yay yarıçapı tanımda, yazı "90°"', !!d11.def && d11.def.kind === 'angular' && near(d11.measure, 90, TAP) && d11.def.r > 0 && d11.text === (await fmt(90, 2)) + '°', J([d11.def && d11.def.kind, d11.measure, d11.def && d11.def.r, d11.text]));
await duzenle(g11, { prec: '1', exe: 20, factor: '5' }); await bekle(150);
const d11b = await grup(g11);
const kol = Math.hypot(d11b.segs[0][1][0] - d11b.segs[0][0][0], d11b.segs[0][1][1] - d11b.segs[0][0][1]);
ok('11b açısal: taşma 20 uygulanır (kol = r + 20), çarpan açıya uygulanmaz', near(d11b.def.exe, 20) && near(kol, d11b.def.r + 20, TAP) && d11b.text === (await fmt(90, 1)) + '°' && d11b.def.factor === 1, J([d11b.def.exe, kol, d11b.def.r, d11b.text, d11b.def.factor]));

// ---- 12. Seçim menüsü kartı --------------------------------------------------------------------------------
{
  await ev((g) => { const E = window.dwgApp.editor; E.sel.clear(); for (const p of window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g)) E.sel.add(p); E.selMenu(); }, g1); await bekle(200);
  const m = await ev(() => { const b = document.querySelector('#docBody [data-sm="dimedit"]'); const ids = [...document.querySelectorAll('#docBody [data-sm]')].map(e => e.dataset.sm); return { var: !!b, ad: b ? b.textContent.trim() : '', n: ids.length, sira: ids.indexOf('dimedit') }; });
  ok('12a ölçü seçiliyken seçim menüsünde "Ölçü özellikleri" kartı (17 kart, Özellikler kartının önünde)', m.var && m.ad === 'Ölçü özellikleri' && m.n === 17 && m.sira === 10, J(m));
  const l12 = await gunluk();
  await queueAnswers(page, { prefix: 'S=' });
  await page.click('#docBody [data-sm="dimedit"]'); await bekle(300);
  const d12 = await grup(g1), l12b = await gunluk(), selN = await ev(() => window.dwgApp.editor.sel.size);
  ok('12b karttan düzenleme: ölçü yeniden kuruldu, tek adım, seçim bırakıldı', d12.text.startsWith('S=') && l12b.log === l12.log + 1 && selN === 0, J([d12.text, l12, l12b, selN]));
  await ev(() => { const E = window.dwgApp.editor; E.sel.clear(); const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.k === 0 && !(q.info && q.info.t === 'DIMENSION')); E.sel.add(p); E.selMenu(); }); await bekle(200);
  ok('12c ölçü seçili değilken kart yok (16 kart)', await ev(() => !document.querySelector('#docBody [data-sm="dimedit"]') && document.querySelectorAll('#docBody [data-sm]').length === 16));
  await ev(() => { window.dwgApp.editor.sel.clear(); document.getElementById('docPanel').hidden = true; });
}

// ---- 13. Pano: tanım taşınır, grup kimliği yenilenir --------------------------------------------------------
{
  await ev((g) => { const E = window.dwgApp.editor; E.sel.clear(); for (const p of window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g)) E.sel.add(p); }, g1);
  await ev(() => window.dwgApp.action('copyclip')); await bekle(300);
  const n13 = await prims();
  await ev(() => window.dwgApp.action('pasteclip')); await bekle(400);
  const p1 = await ev(() => { const cs = [...window.dwgApp.editor.sel], core = cs.find(p => p.ent && p.ent.def), txt = cs.find(p => p.k === 1); return { n: cs.length, gid: core ? core.info.gid : null, def: core ? core.ent.def : null, tx: txt ? txt.x : null, ty: txt ? txt.y : null }; });
  await ev(() => window.dwgApp.action('pasteclip')); await bekle(400);
  const p2 = await ev(() => { const cs = [...window.dwgApp.editor.sel], core = cs.find(p => p.ent && p.ent.def); return { n: cs.length, gid: core ? core.info.gid : null }; });
  ok('13a yapıştırılan ölçü tanımını taşır ve YENİ grup kimliği alır; ikinci yapıştırma ayrı grup', await prims() === n13 + 8 && p1.n === 4 && !!p1.def && !!p1.gid && p1.gid !== g1 && !!p2.gid && p2.gid !== p1.gid, J([p1.gid, p2.gid, g1]));
  const src = await grup(g1);
  const dx = p1.tx - src.tx, dy = p1.ty - src.ty;   // yazı ne kadar taşındıysa tanım noktaları da o kadar taşınmalı
  ok('13b yapıştırılan ölçünün tanım noktaları da aynı ötelemeyle taşındı', near(p1.def.pts[0][0] - src.def.pts[0][0], dx, 1e-6) && near(p1.def.pts[0][1] - src.def.pts[0][1], dy, 1e-6), J([dx, dy, p1.def.pts[0], src.def.pts[0]]));
  await duzenle(p2.gid, { prefix: 'P=' }); await bekle(150);
  const d13 = await grup(p2.gid);
  ok('13c yapıştırılan ölçü düzenlenebilir (P=…)', d13.n === 4 && d13.text.startsWith('P='), String(d13.text));
  await ev(() => window.dwgApp.editor.sel.clear());
}

// ---- 14. Blok kütüphanesi dönüşümleri tanımı taşır (saf) -------------------------------------------------------
{
  const r = await ev(async () => {
    const L = await import('./blocklib.js');
    const def = { kind: 'linear', sub: 'horizontal', rot: 0, pts: [[0, 0, 0], [100, 0, 0], [0, 50, 0]], h: 5, arrow: 5, exo: 1, exe: 2, prec: null, prefix: '', suffix: '', factor: 1, text: '' };
    const e = { type: 'PATH', ops: [[0, 0, 0, 0], [1, 100, 0, 0]], layer: '0', color: 256, def };
    const mv = L.moveEnts([e], 10, 20, 0)[0], rt = L.rotateEnts([e], Math.PI / 2, 0, 0)[0], sc = L.scaleEnts([e], 2, 0, 0)[0], rt30 = L.rotateEnts([e], Math.PI / 6, 0, 0)[0];
    return { mv: mv.def.pts[1], rtSub: rt.def.sub, rtP: rt.def.pts[1], scH: sc.def.h, scExo: sc.def.exo, r30: rt30.def.sub, r30rot: rt30.def.rot, orig: e.def.pts[1] };
  });
  ok('14 blok dönüşümleri tanımı taşır: öteleme, 90° (yatay→düşey), ölçek (h ve boşluk ×2), 30° (rotated); özgün değişmez', near(r.mv[0], 110) && near(r.mv[1], 20) && r.rtSub === 'vertical' && near(r.rtP[0], 0, 1e-9) && near(r.rtP[1], 100, 1e-9) && near(r.scH, 10) && near(r.scExo, 2) && r.r30 === 'rotated' && near(r.r30rot, Math.PI / 6, 1e-9) && near(r.orig[0], 100), J(r));
}

// ---- 15. Dosyadan gelen ölçüler (pface_full.dxf: hizalı, dönük, 2 çizgili açısal, ordinat) --------------------
await openFile(page, `${SM}/pface_full.dxf`, { settle: 400 });
await ev(() => { document.getElementById('toast').hidden = true; });
const dosya = () => ev(() => {
  const by = new Map();
  for (const p of window.dwgApp.state.scene.layouts[0].prims) {
    if (!p.info || p.info.t !== 'DIMENSION' || !p.info.dim) continue;
    const h = p.info.h;
    if (!by.has(h)) by.set(h, { h, type: p.info.dim.type, n: 0, meas: p.info.meas, keys: [], sty: p.info.dim.sty, ov: p.info.dim.ov, dim: p.info.dim, col: p.col, bb: [Infinity, Infinity, -Infinity, -Infinity] });
    const g = by.get(h); g.n++; g.keys.push(p.key);
    g.bb = [Math.min(g.bb[0], p.bb[0]), Math.min(g.bb[1], p.bb[1]), Math.max(g.bb[2], p.bb[2]), Math.max(g.bb[3], p.bb[3])];
  }
  return [...by.values()];
});
const F = await dosya();
ok('15a pface_full.dxf: 9 DIMENSION (hizalı, dönük, açısal, ordinat), parçaları ortak bilgiyle', F.length === 9 && F.every(g => g.n >= 2), J(F.map(g => [g.type, g.n])));
const fa = F.find(g => g.type === 1);
ok('15b stil bilgisi: DIMDEC 2, DIMADEC 0 (başlıktan), DIMTXT 2,5, DIMASZ 2,5, DIMEXO 0,625, DIMEXE 1,25, DIMLFAC 1, DIMPOST boş', !!fa && fa.sty.dec === 2 && fa.sty.adec === 0 && near(fa.sty.txt, 2.5) && near(fa.sty.asz, 2.5) && near(fa.sty.exo, 0.625) && near(fa.sty.exe, 1.25) && near(fa.sty.lfac, 1) && fa.sty.post === '', J(fa && fa.sty));
const editF = async (h, cevap) => { await queueAnswers(page, cevap); return ev(async (h) => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.h === h && q.info.t === 'DIMENSION'); return window.dwgApp.editor.tools.editDim(p); }, h); };
const yeniGrup = (oldKeys) => ev((ks) => {
  const ps = window.dwgApp.state.scene.layouts[0].prims, kaldi = ps.filter(p => ks.includes(p.key)).length;
  let gid = null; for (let i = ps.length - 1; i >= 0; i--) if (ps[i].info && ps[i].info.gid && ps[i].info.t === 'DIMENSION') { gid = ps[i].info.gid; break; }
  const g = ps.filter(p => p.info && p.info.gid === gid), core = g.find(p => p.ent && p.ent.def), txt = g.find(p => p.k === 1);
  return { kaldi, gid, n: g.length, def: core ? core.ent.def : null, measure: core ? core.ent.measure : null, text: txt ? txt.lines.join(' ') : null, th: txt ? txt.h : null, cols: [...new Set(g.map(p => p.col))], lay: core ? core.lay : null };
}, oldKeys);
const lF = await gunluk();
const rA = await editF(fa.h, { text: 'A<>' }); await bekle(200);
const nA = await yeniGrup(fa.keys);
ok('15c hizalı dosya ölçüsü yeniden kuruldu: eski parçalar gitti, yeni grup gid aldı, DIMDEC 2, yazı A + ölçüm', rA === true && nA.kaldi === 0 && !!nA.gid && nA.n === 4 && nA.def.kind === 'linear' && nA.def.sub === 'aligned' && nA.text === 'A' + await fmt(fa.meas, 2) && near(nA.th, 2.5) && near(nA.measure, fa.meas, 1e-6), J([nA.text, nA.measure, fa.meas, nA.th, nA.kaldi]));
const lF2 = await gunluk();
const geri = await ev(async (ks) => { window.dwgApp.editor.doc.undo(); const ps = window.dwgApp.state.scene.layouts[0].prims; return ps.filter(p => ks.includes(p.key)).length; }, fa.keys);
ok('15c2 yeniden kurulan parçalar dosyadaki katmanda ve katman renginde (ByLayer korunur)', nA.lay === 'Tavolo 3' && nA.cols.length === 1 && nA.cols[0] === fa.col, J([nA.lay, nA.cols, fa.col]));
ok('15d tek adım; geri al dosya parçalarını aynı anahtarlarla getirir', lF2.log === lF.log + 1 && geri === fa.keys.length, J([lF, lF2, geri, fa.keys.length]));
await ev(() => window.dwgApp.editor.doc.redo()); await bekle(100);
const fr = F.filter(g => g.type === 0)[0];
await editF(fr.h, {}); await bekle(200);
const nR = await yeniGrup(fr.keys);
ok('15e dönük (tip 0, 0°) dosya ölçüsü: yatay kip, ölçüm dosyadakiyle aynı', nR.kaldi === 0 && nR.def.sub === 'horizontal' && near(nR.measure, fr.meas, 1e-6) && nR.text === await fmt(fr.meas, 2), J([nR.def.sub, nR.measure, fr.meas, nR.text]));
const fg = F.find(g => g.type === 2);
await editF(fg.h, {}); await bekle(200);
const nG = await yeniGrup(fg.keys);
// Bu dosyanın *D7 bloğu yayı 13 noktasını tepe alarak çizer (kollar 14 ve 15, yay noktası 10): dosyanın kendi
// ölçümü (108°) DXF sözleşmesi okumasına (42°) değil bu okumaya yakındır; beklenen açı o noktalardan hesaplanır
const vG = fg.dim.x1s, aG = fg.dim.x1e, bG = fg.dim.x2s;
let swG = Math.atan2(bG[1] - vG[1], bG[0] - vG[0]) - Math.atan2(aG[1] - vG[1], aG[0] - vG[0]); while (swG <= -Math.PI) swG += 2 * Math.PI; while (swG > Math.PI) swG -= 2 * Math.PI;
const derece = Math.abs(swG) * 180 / Math.PI;
ok('15f 2 çizgili açısal dosya ölçüsü: tepe 13 (bloğun çizdiği, ölçüme yakın okuma), 108°, yay yarıçapı 10 noktasından, DIMADEC 0', nG.kaldi === 0 && nG.def.kind === 'angular' && near(nG.def.pts[0][0], vG[0], 1e-6) && near(nG.measure, derece, 1e-6) && near(derece, 108, 1e-6) && nG.text === (await fmt(derece, 0)) + '°' && nG.def.prec === 0 && near(nG.def.r, Math.hypot(fg.dim.cp[0] - vG[0], fg.dim.cp[1] - vG[1]), 1e-6), J([nG.def && nG.def.pts, nG.measure, derece, nG.text, nG.def && nG.def.prec, nG.def && nG.def.r]));
const fo = F.find(g => g.type === 6);
const rO = await ev(async (h) => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.h === h && q.info.t === 'DIMENSION'); return window.dwgApp.editor.tools.editDim(p); }, fo.h); await bekle(100);
const toastO = await ev(() => document.getElementById('toast').textContent);
ok('15g ordinat ölçü yeniden kurulamaz: kutu açılmaz, nedeni söylenir, kuyruk boş', rO === false && /yeniden kurulamıyor/.test(toastO) && await ev(() => !(window.__ask && window.__ask.queue.length)), toastO);
{
  const fb = F.filter(g => g.type === 0)[1];
  const w = fb.bb[2] - fb.bb[0], h = fb.bb[3] - fb.bb[1];
  await zoom([fb.bb[0] - w, fb.bb[1] - h, fb.bb[2] + w, fb.bb[3] + h]);
  const r = await ev(async (h) => {
    const S = window.dwgApp.state, E = window.dwgApp.editor; E.sel.clear(); E.act('t:select'); await new Promise(r => setTimeout(r, 150));
    const part = S.scene.layouts[0].prims.find(q => q.info && q.info.h === h && q.k === 0);
    const o = part.ops.find(x => x[0] === 1) || part.ops[0];
    E.tools.tap([(part.ops[0][1] + o[1]) / 2, (part.ops[0][2] + o[2]) / 2], null);
    return { n: E.sel.size, tum: [...E.sel].every(p => p.info && p.info.h === h), parca: S.scene.layouts[0].prims.filter(q => q.info && q.info.h === h).length };
  }, fb.h);
  ok('15h seç aracı dosya ölçüsünün bütün parçalarını birlikte seçer', r.n === r.parca && r.tum && r.n >= 2, J(r));
  await ev(() => { window.dwgApp.editor.tools.cancel(); window.dwgApp.editor.sel.clear(); });
}

// ---- 16. Sentetik DXF: dönük 30°, yarıçap, çap, 3 noktalı açısal, MTEXT kodlu geçersiz kılma, DIMSTYLE ---------
function dxfYaz(stil, ents) {
  const L = []; const g = (c, v) => L.push(String(c), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1015'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, 1); g(0, 'LAYER'); g(5, '10'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'Continuous'); g(0, 'ENDTAB');
  if (stil) { g(0, 'TABLE'); g(2, 'DIMSTYLE'); g(70, 1); g(0, 'DIMSTYLE'); g(105, '20'); g(2, 'TEST'); g(70, 0); g(3, '<> cm'); g(40, 1); g(41, 4); g(42, 1); g(44, 2); g(140, 3); g(144, 0.1); g(271, 1); g(0, 'ENDTAB'); }
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const e of ents) for (const [c, v] of e) g(c, v);
  g(0, 'ENDSEC'); g(0, 'EOF');
  return L.join('\n') + '\n';
}
const D = (h, type, sty, text, meas, extra) => [[0, 'DIMENSION'], [5, h], [8, '0'], [2, '*D' + h], [70, type + 32], [1, text], [42, meas], [3, sty], ...extra];
const P3 = (c, x, y) => [[c, x], [c + 10, y], [c + 20, 0]];
const f1 = `${out}/olcu_stil.dxf`, f2 = `${out}/olcu_stilsiz.dxf`;
fs.writeFileSync(f1, dxfYaz(true, [
  D('A1', 0, 'TEST', '\\A1;OLCU <>', 86.60254, [...P3(10, 0, 80), ...P3(11, 43, 90), ...P3(13, 0, 0), ...P3(14, 100, 0), [50, 30]]),
  D('A2', 4, 'TEST', '', 50, [...P3(10, 300, 300), ...P3(11, 340, 320), ...P3(15, 350, 300), [40, 0]]),
  D('A3', 3, 'TEST', '', 100, [...P3(10, 500, 300), ...P3(11, 550, 320), ...P3(15, 600, 300), [40, 0]]),
  D('A4', 5, 'TEST', '', 1.5707963268, [...P3(10, 850, 350), ...P3(11, 860, 360), ...P3(13, 900, 300), ...P3(14, 800, 400), ...P3(15, 800, 300)]),
  D('A5', 1, 'TEST', '', 200, [...P3(10, 100, 560), ...P3(11, 100, 565), ...P3(13, 0, 500), ...P3(14, 200, 500)]),
]));
fs.writeFileSync(f2, dxfYaz(false, [
  D('B1', 1, 'STANDARD', '', 1234.5, [...P3(10, 50, 60), ...P3(11, 50, 65), ...P3(13, 0, 0), ...P3(14, 100, 0)]),
]));
await openFile(page, f1, { settle: 400 });
await ev(() => { document.getElementById('toast').hidden = true; });
const F1 = await dosya();
ok('16a sentetik DXF: beş ölçü *D bloğu olmadan stil değerleriyle çizildi; geçersiz kılma kodlardan arındı ("OLCU <>")', F1.length === 5 && F1.every(g => g.n >= 2) && F1.find(g => g.h === 'A1').ov === 'OLCU <>', J(F1.map(g => [g.h, g.type, g.n, g.ov])));
const s1 = F1.find(g => g.h === 'A1').sty;
ok('16b stil: DIMTXT 3, DIMASZ 4, DIMEXO 1, DIMEXE 2, DIMDEC 1, DIMPOST "<> cm", DIMLFAC 0,1', near(s1.txt, 3) && near(s1.asz, 4) && near(s1.exo, 1) && near(s1.exe, 2) && s1.dec === 1 && s1.post === '<> cm' && near(s1.lfac, 0.1), J(s1));
const A1 = F1.find(g => g.h === 'A1');
await editF('A1', {}); await bekle(200);
const nA1 = await yeniGrup(A1.keys);
ok('16c dönük 30°: kip rotated, ölçü izdüşüm 86,6, yazı "OLCU " + 0,1 × ölçü (1 ondalık) + " cm"', nA1.kaldi === 0 && nA1.def.sub === 'rotated' && near(nA1.def.rot, Math.PI / 6, 1e-6) && near(nA1.measure, 86.60254, 1e-4) && nA1.text === 'OLCU ' + (await fmt(8.660254, 1)) + ' cm' && nA1.def.text === 'OLCU <>', J([nA1.def.sub, nA1.def.rot, nA1.measure, nA1.text]));
ok('16d dönük ölçü tanımı stilden: h 3, ok 4, boşluk 1, taşma 2, ondalık 1, son ek " cm", çarpan 0,1', near(nA1.def.h, 3) && near(nA1.def.arrow, 4) && near(nA1.def.exo, 1) && near(nA1.def.exe, 2) && nA1.def.prec === 1 && nA1.def.suffix === ' cm' && nA1.def.prefix === '' && near(nA1.def.factor, 0.1), J(nA1.def));
const A2 = F1.find(g => g.h === 'A2');
await editF('A2', {}); await bekle(200);
const nA2 = await yeniGrup(A2.keys);
ok('16e yarıçap (tip 4): merkez 300,300, r 50, "R " ön eki kendiliğinden, yazı R 5 cm', nA2.kaldi === 0 && nA2.def.kind === 'radial' && nA2.def.sub === 'radius' && near(nA2.def.r, 50) && near(nA2.def.pts[0][0], 300) && nA2.text === 'R ' + (await fmt(5, 1)) + ' cm', J([nA2.def && nA2.def.r, nA2.def && nA2.def.pts, nA2.text]));
const A3 = F1.find(g => g.h === 'A3');
await editF('A3', {}); await bekle(200);
const nA3 = await yeniGrup(A3.keys);
ok('16f çap (tip 3): merkez 550,300, r 50, "⌀ " ön eki, yazı ⌀ 10 cm', nA3.kaldi === 0 && nA3.def.sub === 'diameter' && near(nA3.def.r, 50) && near(nA3.def.pts[0][0], 550) && nA3.text === '⌀ ' + (await fmt(10, 1)) + ' cm', J([nA3.def && nA3.def.pts, nA3.text]));
const A4 = F1.find(g => g.h === 'A4');
await editF('A4', {}); await bekle(200);
const nA4 = await yeniGrup(A4.keys);
ok('16g 3 noktalı açısal (tip 5): tepe 800,300, 90°, yay yarıçapı yay noktasından (70,7), DIMADEC yok → DIMDEC 1, yazı 90°', nA4.kaldi === 0 && nA4.def.kind === 'angular' && near(nA4.def.pts[0][0], 800) && near(nA4.measure, 90, 1e-6) && near(nA4.def.r, Math.hypot(50, 50), 1e-6) && nA4.def.prec === 1 && nA4.text === (await fmt(90, 1)) + '°', J([nA4.def && nA4.def.pts, nA4.measure, nA4.def && nA4.def.r, nA4.text]));
const A5 = F1.find(g => g.h === 'A5');
await editF('A5', { suffix: ' m', factor: '0.001', prec: '3' }); await bekle(200);
const nA5 = await yeniGrup(A5.keys);
ok('16h hizalı (tip 1) dosya ölçüsü düzenlendi: 200 × 0,001 → 0,200 m', nA5.kaldi === 0 && nA5.def.sub === 'aligned' && near(nA5.measure, 200) && nA5.text === (await fmt(0.2, 3)) + ' m', J([nA5.measure, nA5.text]));
await openFile(page, f2, { settle: 400 });
await ev(() => { document.getElementById('toast').hidden = true; });
const F2 = await dosya();
const B1 = F2.find(g => g.h === 'B1');
ok('16i stilsiz DXF: ondalık / çarpan dosyada yazılı değil (dec yok, lfac yok)', !!B1 && B1.sty.dec === undefined && B1.sty.lfac === undefined, J(B1 && B1.sty));
await editF('B1', {}); await bekle(200);
const nB1 = await yeniGrup(B1.keys);
ok('16j stil yokken görünen yazıdan: "1234.5" → 1 ondalık, çarpan ölçümden (12,345), yazı 1.234,5', nB1.kaldi === 0 && nB1.def.prec === 1 && near(nB1.def.factor, 12.345, 1e-6) && nB1.def.prefix === '' && nB1.def.suffix === '' && nB1.text === await fmt(1234.5, 1), J([nB1.def && nB1.def.prec, nB1.def && nB1.def.factor, nB1.text]));

await page.screenshot({ path: `${out}/olcu_duzenle.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
