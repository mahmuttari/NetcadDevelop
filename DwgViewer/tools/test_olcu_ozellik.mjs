// Ölçü özellikleri kutusu v8.9.8 ve "Dosyayı paylaş".
// Kullanıcı istekleri: "Burada renk ve katman ayarı olsun, ayrıca tüm özellikle ölçekleme yani mevcut yazı boyutu
// ve ok boyutunu küçültme AutoCAD'de olduğu gibi ölçü ölçeği değişmeden." · "Bu menüde dosyayı paylaş olsun."
// Kutu GERÇEK arayüzden sürülür (alan doldurma, renk karesine dokunma, Uygula); sıraya konmuş cevap yalnız
// ikinci ölçünün hazırlığında kullanılır.
// Kullanım: node tools/test_olcu_ozellik.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const J = JSON.stringify;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
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
await ev(() => { localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); localStorage.removeItem('dimsty:' + window.dwgApp.state.fileKey); document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; window.dwgApp.osnap.setModes([]); });

const tapWorld = async (x, y) => {
  await ev(() => { document.getElementById('toast').hidden = true; });
  const sc = await ev(([x, y]) => window.dwgApp.toScreen(x, y), [x, y]);
  const r = await page.locator('#viewport').boundingBox();
  await page.touchscreen.tap(r.x + sc[0], r.y + sc[1]);
  await bekle(380);
};
const arac = async (id) => { await ev((id) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); document.getElementById('infoPanel').hidden = true; E.act(id); }, id); await bekle(200); };
const sonGid = () => ev(() => { const ps = window.dwgApp.state.scene.layouts[0].prims; for (let i = ps.length - 1; i >= 0; i--) if (ps[i].info && ps[i].info.gid && ps[i].info.t === 'DIMENSION') return ps[i].info.gid; return null; });
const grup = (gid) => ev((g) => {
  const ps = window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && p.info.gid === g);
  const core = ps.find(p => p.ent && p.ent.def), txt = ps.find(p => p.k === 1);
  const sol = ps.filter(p => p.k === 0 && p.fill && p.ops.length === 3);
  const okBoyu = sol.length ? (() => { const o = sol[0].ops; const b = [(o[1][1] + o[2][1]) / 2, (o[1][2] + o[2][2]) / 2]; return Math.hypot(b[0] - o[0][1], b[1] - o[0][2]); })() : null;
  const sg = core ? core.ent.segs : null;
  return { n: ps.length, keys: ps.map(p => p.key), def: core ? core.ent.def : null, measure: core ? core.ent.measure : null, text: txt ? txt.lines.join('\n') : null, th: txt ? txt.h : null, okBoyu,
    bosluk: sg ? Math.hypot(sg[0][0][0] - core.ent.def.pts[0][0], sg[0][0][1] - core.ent.def.pts[0][1]) : null,
    tasma: sg ? Math.hypot(sg[0][1][0] - sg[2][0][0], sg[0][1][1] - sg[2][0][1]) : null,
    lays: [...new Set(ps.map(p => p.lay))], cis: [...new Set(ps.map(p => p.info.ci))] };
}, gid);
const gunluk = () => ev(() => { const d = window.dwgApp.editor.doc; return { log: d.log.length, u: d.undoStack.length }; });
const secGrup = (gids) => ev((gs) => { const E = window.dwgApp.editor; E.sel.clear(); for (const p of window.dwgApp.state.scene.layouts[0].prims.filter(p => p.info && gs.includes(p.info.gid))) E.sel.add(p); }, gids);
/** Seçim menüsünden "Ölçü özellikleri" kartıyla kutuyu açar (kullanıcının yolu) */
const kutuAc = async () => {
  await ev(() => window.dwgApp.editor.selMenu()); await bekle(200);
  await page.click('#docBody [data-sm="dimedit"]'); await bekle(250);
  return ev(() => {
    const d = document.getElementById('askDlg');
    const v = (id) => { const e = document.getElementById('askF_' + id); return e ? e.value : null; };
    const sw = [...document.querySelectorAll('#askF_color button[data-v]')];
    return { acik: !!d && !d.hidden, baslik: document.getElementById('askLabel').textContent, scale: v('scale'), h: v('h'), arrow: v('arrow'), exo: v('exo'), exe: v('exe'), factor: v('factor'),
      layer: v('layer'), katmanlar: [...document.querySelectorAll('#askF_layer option')].map(o => o.value), renk: sw.length, renkSecili: (sw.find(b => b.classList.contains('active')) || {}).dataset?.v || null,
      asDefault: !!(document.getElementById('askF_asDefault') || {}).checked, ipucu: (document.querySelector('.ask-hint') || {}).textContent || '' };
  });
};
const uygula = async () => { await page.click('#askOk'); await bekle(350); };

// ---- 1. Ölçü kur, kutuyu arayüzden aç ------------------------------------------------------------------
await ev((b) => window.dwgApp.zoomExtents(b), [0, 0, 2000, 2000]); await bekle(200);
await arac('t:dim');
await tapWorld(200, 300); await tapWorld(700, 300); await tapWorld(200, 500);
await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); });
const g1 = await sonGid(); const d1 = await grup(g1);
ok('1a ölçü kuruldu (4 parça, tanımda genel ölçek 1)', d1.n === 4 && d1.def && d1.def.scale === 1, J(d1.def));
await secGrup([g1]);
const k1 = await kutuAc();
ok('1b kutu seçim menüsünden açıldı: başlık "Ölçü özellikleri"', k1.acik && k1.baslik === 'Ölçü özellikleri', J(k1.baslik));
ok('1c katman seçimi: çizimin katmanları, ölçünün katmanı seçili', k1.katmanlar.length > 1 && k1.katmanlar.includes(d1.lays[0]) && k1.layer === d1.lays[0], J([k1.layer, k1.katmanlar.length]));
ok('1d renk kareleri (≥ 23) ve geçerli renk seçili', k1.renk >= 23 && k1.renkSecili === String(d1.cis[0]), J([k1.renk, k1.renkSecili, d1.cis]));
ok('1e genel ölçek alanı "1"; "yeni ölçüler de" işaretli; ipucu genel ölçeği anlatıyor', k1.scale === '1' && k1.asDefault && /Genel ölçek/.test(k1.ipucu), J([k1.scale, k1.asDefault]));
{
  // sayılar TR ondalık virgülüyle ve en çok 6 anlamlı basamakla ("112.406432482" gibi değil)
  const hepsi = [k1.h, k1.arrow, k1.exo, k1.exe];
  const bicim = hepsi.every(v => /^\d+(,\d+)?$/.test(v) && v.replace(/[^\d]/g, '').replace(/^0+/, '').length <= 6);
  ok('1f sayı alanları TR biçiminde (virgül, nokta yok) ve ≤ 6 anlamlı basamak', bicim, J(hepsi));
}
// dokunmadan Uygula: ölçü değişmez, geri alma adımı oluşmaz
const l1 = await gunluk();
await uygula();
const d1b = await grup(g1), l1b = await gunluk();
ok('1g dokunmadan Uygula: yeniden kurulmaz, tanım TAM korunur, günlük değişmez', l1b.log === l1.log && J(d1b.def) === J(d1.def) && J(d1b.keys) === J(d1.keys), J([l1, l1b]));

// ---- 2. Genel ölçek (DIMSCALE) --------------------------------------------------------------------------
await secGrup([g1]);
await kutuAc();
await page.fill('#askF_scale', '0,5');
await uygula();
const d2 = await grup(g1), l2 = await gunluk();
ok('2a genel ölçek 0,5: yazı, ok, uzatma boşluğu ve taşması yarıya indi', near(d2.th, d1.th * 0.5) && near(d2.okBoyu, d1.okBoyu * 0.5, 1e-4) && near(d2.bosluk, d1.bosluk * 0.5, 1e-4) && near(d2.tasma, d1.tasma * 0.5, 1e-4), J([d1.th, d2.th, d1.okBoyu, d2.okBoyu, d1.bosluk, d2.bosluk, d1.tasma, d2.tasma]));
ok('2b ölçülen değer ve yazı DEĞİŞMEDİ, çarpan 1 kaldı', near(d2.measure, d1.measure) && d2.text === d1.text && d2.def.factor === 1, J([d1.text, d2.text]));
ok('2c tanımda scale 0,5; taban yazı yüksekliği (h) aynı kaldı', d2.def.scale === 0.5 && near(d2.def.h, d1.def.h), J([d2.def.scale, d2.def.h, d1.def.h]));
ok('2d tek geri alma adımı, yeni parçalar seçili', l2.log === l1b.log + 1 && await ev(() => window.dwgApp.editor.sel.size) === 4, J([l1b, l2]));
await ev(() => window.dwgApp.editor.doc.undo()); await bekle(150);
ok('2e geri al: eski boyut geri geldi', near((await grup(g1)).th, d1.th));
await ev(() => window.dwgApp.editor.doc.redo()); await bekle(150);

// ---- 3. Katman ve renk ----------------------------------------------------------------------------------
const hedef = await ev((cur) => [...window.dwgApp.state.layers.keys()].find(n => n !== cur), d1.lays[0]);
await secGrup([g1]);
await kutuAc();
await page.selectOption('#askF_layer', hedef);
await page.click('#askF_color button[data-v="1"]');
await uygula();
const d3 = await grup(g1);
ok('3a dört parça da yeni katmanda', d3.n === 4 && d3.lays.length === 1 && d3.lays[0] === hedef, J([hedef, d3.lays]));
ok('3b dört parça da kırmızı (ACI 1)', d3.cis.length === 1 && d3.cis[0] === 1, J(d3.cis));
ok('3c boyut ve yazı korunur (yalnız katman / renk değişti)', near(d3.th, d2.th) && d3.text === d2.text && d3.def.scale === 0.5, J([d3.th, d3.text]));
{
  const k3 = await (async () => { await secGrup([g1]); return kutuAc(); })();
  ok('3d kutu yeniden açılınca yeni katman ve renk seçili', k3.layer === hedef && k3.renkSecili === '1', J([k3.layer, k3.renkSecili]));
  await page.click('#askNo'); await bekle(150);
}

// ---- 4. Yalnız yazı yüksekliği: varsayılan orandaki ok / uzatma birlikte değişir ------------------------------
await secGrup([g1]);
await kutuAc();
const h4 = d3.def.h / 4;
await page.fill('#askF_h', String(h4).replace('.', ','));
await uygula();
const d4 = await grup(g1);
ok('4a h dörtte bire indi; ok (= h), boşluk (h/4), taşma (h/2) onunla birlikte', near(d4.def.h, h4, 1e-5) && near(d4.def.arrow, d3.def.arrow / 4, 1e-5) && near(d4.def.exo, d3.def.exo / 4, 1e-5) && near(d4.def.exe, d3.def.exe / 4, 1e-5), J([d3.def, d4.def]));
ok('4b genel ölçek korunur (0,5), çizimdeki yazı = h × 0,5', d4.def.scale === 0.5 && near(d4.th, d4.def.h * 0.5, 1e-5), J([d4.def.scale, d4.th]));

// ---- 5. "Yeni ölçüler de bu ayarlarla" ------------------------------------------------------------------
// stil çizimin başlık değişkenlerinde (AutoCAD adlarıyla; geri alınabilir, DXF'e yazılır)
const st = await ev(() => ({ ...window.dwgApp.state.vars }));
ok('5a stil bu çizim için başlık değişkenlerine yazıldı (DIMTXT, DIMSCALE, katman, renk)', st && st.DIMAPP === 1 && near(st.DIMTXT, d4.def.h, 1e-9) && st.DIMSCALE === 0.5 && st.DIMLAYERAPP === hedef && st.DIMCLRAPP === 1, J(st));
await arac('t:dimh');
await tapWorld(900, 300); await tapWorld(1400, 300); await tapWorld(900, 450);
await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); });
const g5 = await sonGid(); const d5 = await grup(g5);
ok('5b yeni ölçü saklanan ayarlarla çizildi: h, ölçek, katman, renk', g5 !== g1 && near(d5.def.h, d4.def.h, 1e-9) && d5.def.scale === 0.5 && near(d5.th, d4.th, 1e-9) && d5.lays[0] === hedef && d5.cis[0] === 1, J([d5.def.h, d5.def.scale, d5.lays, d5.cis]));

// ---- 6. Birden çok ölçü birlikte ------------------------------------------------------------------------
// ikinci ölçünün yüksekliğini farklılaştır (hazırlık: sıraya konmuş cevap)
await queueAnswers(page, { h: String(d4.def.h * 3), asDefault: false });
await ev((g) => { const p = window.dwgApp.state.scene.layouts[0].prims.find(q => q.info && q.info.gid === g); return window.dwgApp.editor.tools.editDim(p); }, g5); await bekle(200);
const d6a = await grup(g1), d6b = await grup(g5), l6 = await gunluk();
await secGrup([g1, g5]);
const k6 = await kutuAc();
ok('6a iki ölçü: başlık "Ölçü özellikleri · 2 ölçü", farklı yükseklik boş, ortak ölçek "0,5"', k6.baslik === 'Ölçü özellikleri · 2 ölçü' && k6.h === '' && k6.scale === '0,5' && /Birden çok ölçü/.test(k6.ipucu), J([k6.baslik, k6.h, k6.scale]));
await page.fill('#askF_scale', '1');
await uygula();
const d6c = await grup(g1), d6d = await grup(g5), l6b = await gunluk();
ok('6b genel ölçek ikisinde de 1; her birinin kendi yüksekliği korundu (boş alan dokunulmadı)', d6c.def.scale === 1 && d6d.def.scale === 1 && near(d6c.def.h, d6a.def.h, 1e-9) && near(d6d.def.h, d6b.def.h, 1e-9), J([d6c.def.h, d6d.def.h]));
ok('6c ikisi tek geri alma adımında', l6b.log === l6.log + 1, J([l6, l6b]));
await ev(() => window.dwgApp.editor.doc.undo()); await bekle(150);
ok('6d geri al ikisini birlikte geri getirir', (await grup(g1)).def.scale === 0.5 && (await grup(g5)).def.scale === 0.5);
await ev(() => window.dwgApp.editor.doc.redo()); await bekle(150);

// ---- 7. Seçim menüsü: yalnız ölçü seçiliyken kart başta ------------------------------------------------------
await secGrup([g1]);
await ev(() => window.dwgApp.editor.selMenu()); await bekle(200);
const ilk = await ev(() => { const b = document.querySelector('#docBody [data-sm]'); return b ? b.dataset.sm : null; });
ok('7 yalnız ölçü seçiliyken seçim menüsünün ilk kartı "Ölçü özellikleri"', ilk === 'dimedit', String(ilk));
await ev(() => { document.getElementById('docPanel').hidden = true; window.dwgApp.editor.sel.clear(); });

// ---- 8. Dosyayı paylaş ------------------------------------------------------------------------------------
{
  const m = await ev(() => { const b = document.querySelector('#moreMenu [data-act="fileshare"]'); return b ? { lb: b.textContent.trim(), sira: [...document.querySelectorAll('#moreMenu [data-act]')].map(x => x.dataset.act).indexOf('fileshare') } : null; });
  ok('8a "⋯" menüsünde "Dosyayı paylaş" (Çizim bilgisi\'nin altında)', m && m.lb === 'Dosyayı paylaş' && m.sira === 3, J(m));
  // Android köprüsünün taklidi: yalnız paylaşım işlevleri; çağrılar kaydedilir
  const kur = () => ev(() => { window.__pay = []; window.Android = { shareCurrent: (n) => { window.__pay.push(['cur', n]); return 'ok'; }, shareFileB64: (b, n, m) => { window.__pay.push(['b64', n, m, atob(b).slice(0, 400)]); return 'ok'; } }; });
  const kaldir = () => ev(() => { delete window.Android; });
  // değişiklik var (ölçüler eklendi): seçenek sayfası açılır
  await kur();
  await ev(() => window.dwgApp.action('fileshare')); await bekle(250);
  const sayfa = await ev(() => ({ acik: !document.getElementById('docPanel').hidden, baslik: document.getElementById('docTitle').textContent, secenek: [...document.querySelectorAll('#docBody [data-fs]')].map(e => e.dataset.fs) }));
  ok('8b değişiklik varken seçenek sayfası: "Değişikliklerle birlikte (DXF)" ve "Özgün dosya"', sayfa.acik && sayfa.baslik === 'Dosyayı paylaş' && J(sayfa.secenek) === J(['dxf', 'orig']), J(sayfa));
  await page.click('#docBody [data-fs="dxf"]'); await bekle(300);
  const p1 = await ev(() => window.__pay.slice());
  const ad = await ev(() => (window.dwgApp.state.fileName || '').replace(/\.(dwg|dxf|dgn)$/i, '') + '.dxf');
  ok('8c DXF: köprüye çizim adı + .dxf, application/dxf ve DXF metni gitti', p1.length === 1 && p1[0][0] === 'b64' && p1[0][1] === ad && p1[0][2] === 'application/dxf' && /SECTION/.test(p1[0][3]), J(p1.map(x => x.slice(0, 3))));
  await ev(() => { window.__pay = []; window.dwgApp.action('fileshare'); }); await bekle(250);
  await page.click('#docBody [data-fs="orig"]'); await bekle(250);
  const p2 = await ev(() => window.__pay.slice()), fn = await ev(() => window.dwgApp.state.fileName);
  ok('8d özgün dosya: köprüye açılan dosyanın adı gitti', p2.length === 1 && p2[0][0] === 'cur' && p2[0][1] === fn, J(p2));
  // değişiklik yokken seçenek sorulmaz, özgün dosya doğrudan gider
  await ev(() => { const d = window.dwgApp.editor.doc; while (d.undoStack.length) d.undo(); window.__pay = []; });
  const kirli = await ev(() => window.dwgApp.editor.doc.dirty);
  await ev(() => window.dwgApp.action('fileshare')); await bekle(250);
  const p3 = await ev(() => window.__pay.slice());
  ok('8e değişiklik yokken doğrudan özgün dosya paylaşılır', !kirli ? (p3.length === 1 && p3[0][0] === 'cur') : true, J([kirli, p3]));
  // köprü başarısız dönerse kullanıcıya söylenir
  await ev(() => { window.Android.shareCurrent = () => ''; document.getElementById('toast').hidden = true; });
  await ev(() => window.dwgApp.action('fileshare')); await bekle(250);
  const tst = await ev(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
  ok('8f köprü başarısızsa "Dosya paylaşılamadı" bildirimi', !kirli ? /Dosya paylaşılamadı/.test(tst) : true, tst);
  await kaldir();
}

await page.screenshot({ path: `${out}/olcu_ozellik.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
