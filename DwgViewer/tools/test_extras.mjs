// v7.28 ile gelen işlevler: ondalık hassasiyeti, ölçüm paylaşımı, yüzey/yanal alan, metin çıkarma,
// çok sayfalı PDF ve hazır ifadeler. Her biri kendi katmanında sınanır: saf hesap (meshMetrics,
// buildPdf, collectTexts) doğrudan çağrılır, arayüz tarafı gerçek dokunuşla sürülür.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_extras.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
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
await page.evaluate(() => { document.getElementById('toast').hidden = true; const t = document.getElementById('tour'); if (t) t.hidden = true; });

// ---- 1. Ağ ölçüleri: 10×10×10 küp -------------------------------------------------------------
// Kapalı küpte toplam yüzey 600, yanal (dört düşey yüz) 400, yatayımsı (üst+alt) 200,
// üstten ve alttan izdüşüm 100'er, hacim 1000, üçgen 12. Sayılar elle doğrulanabilir olsun diye küp seçildi.
const cube = await page.evaluate(async () => {
  const g = await import('./geom.js');
  const V = [0,0,0, 10,0,0, 10,10,0, 0,10,0, 0,0,10, 10,0,10, 10,10,10, 0,10,10];
  const F = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  const m = g.meshMetrics(new Float32Array(V), new Uint32Array(F));
  const empty = g.meshMetrics(new Float32Array([0,0,0]), new Uint32Array([]));
  const degen = g.meshMetrics(new Float32Array([0,0,0, 1,1,1, 2,2,2]), new Uint32Array([0,1,2]));
  return { m, empty, degen };
});
ok('1a toplam yüzey 600', near(cube.m.total, 600, 1e-3), String(cube.m.total));
ok('1b yanal alan 400', near(cube.m.lateral, 400, 1e-3), String(cube.m.lateral));
ok('1c yatayımsı yüzey 200', near(cube.m.flat, 200, 1e-3), String(cube.m.flat));
ok('1d üstten izdüşüm 100', near(cube.m.top, 100, 1e-3), String(cube.m.top));
ok('1e alttan izdüşüm 100', near(cube.m.bottom, 100, 1e-3), String(cube.m.bottom));
ok('1f hacim 1000', near(cube.m.volume, 1000, 1e-3), String(cube.m.volume));
ok('1g üçgen sayısı 12', cube.m.tris === 12, String(cube.m.tris));
ok('1h boş ağ sıfır verir', cube.empty.total === 0 && cube.empty.tris === 0, JSON.stringify(cube.empty));
ok('1i yozlaşmış üçgen sayılmaz', cube.degen.tris === 0 && cube.degen.total === 0, JSON.stringify(cube.degen));

// ---- 2. Yüzey alanı çipi: k=5 gövdede görünür, başka ilkelde gizli ------------------------------
const chip = await page.evaluate(() => {
  const app = window.dwgApp, S = app.state;
  const mesh = S.prims.find(p => p.k === 5), line = S.prims.find(p => p.k === 0);
  if (!mesh || !line) return { mesh: !!mesh, line: !!line };
  app.showInfo(mesh);
  const onMesh = !document.getElementById('iaArea').hidden;
  app.showInfo(line);
  const onLine = document.getElementById('iaArea').hidden;
  app.showInfo(mesh);
  document.getElementById('iaArea').click();          // tarayıcıda basamak 'super': kapı açık
  const body = document.getElementById('docBody');
  return { mesh: true, line: true, onMesh, onLine, title: document.getElementById('docTitle').textContent,
    rows: body ? body.textContent.replace(/\s+/g, ' ') : '', tris: mesh.idx.length / 3 };
});
ok('2a sahnede hem ağ hem çizgi ilkeli var', chip.mesh === true && chip.line === true, JSON.stringify(chip));
ok('2b ağ gövdesinde yüzey çipi görünür', chip.onMesh === true);
ok('2c çizgi ilkelinde çip gizli', chip.onLine === true);
ok('2d yüzey paneli açıldı', /Yüzey alanı/i.test(chip.title || ''), String(chip.title));
ok('2e panelde toplam yüzey, yanal alan ve hacim var', /Toplam yüzey/.test(chip.rows) && /Yanal alan/.test(chip.rows) && /Hacim/.test(chip.rows), chip.rows.slice(0, 160));
ok('2f üçgen sayısı panelde geçiyor', chip.rows.includes(String(chip.tris)), String(chip.tris));
await page.evaluate(() => { window.dwgApp.state.selected = null; document.getElementById('docPanel').hidden = true; document.getElementById('infoPanel').hidden = true; });

// ---- 3. Ondalık hassasiyeti ---------------------------------------------------------------------
const prec = await page.evaluate(async () => {
  const st = await import('./state.js');
  const S = window.dwgApp.state;
  const keepP = S.prec, keepPad = S.precPad;
  const r = {};
  S.prec = 3; S.precPad = false; r.d3 = st.fmt(12.3456789);
  S.prec = 1; r.d1 = st.fmt(12.3456789);
  S.prec = 0; r.d0 = st.fmt(12.3456789);
  S.prec = 2; S.precPad = true; r.pad = st.fmt(12.5);
  S.precPad = false; r.noPad = st.fmt(12.5);
  r.explicit = st.fmt(12.3456789, 4);          // açıkça verilen basamak ayardan etkilenmez
  S.prec = 9; r.clamped = st.fmt(1 / 3);       // üst sınır 6
  S.prec = keepP; S.precPad = keepPad;
  return r;
});
ok('3a 3 basamak', prec.d3 === '12,346', prec.d3);
ok('3b 1 basamak', prec.d1 === '12,3', prec.d1);
ok('3c 0 basamak', prec.d0 === '12', prec.d0);
ok('3d son sıfır yazılır', prec.pad === '12,50', prec.pad);
ok('3e son sıfır kapalıyken yazılmaz', prec.noPad === '12,5', prec.noPad);
ok('3f açık basamak ayardan etkilenmez', prec.explicit === '12,3457', prec.explicit);
ok('3g basamak 6 ile sınırlanır', prec.clamped === '0,333333', prec.clamped);

// ---- 4. Ölçüm paylaşımı: dökümde başlık, kalın okuma ve satırlar var ------------------------------
// Panel yalnız kendi düğmeleriyle yenilenir; üç nokta konup biri geri alınınca iki noktalı ölçü çizilir.
const meas = await page.evaluate(() => {
  const app = window.dwgApp, S = app.state;
  app.setMode('measure');
  S.measure.length = 0;
  S.measure.push([0, 0, 0], [30, 40, 0], [99, 99, 0]);
  document.getElementById('btnMeasureUndo').click();
  const el = document.getElementById('measureShare');
  return { hasShare: !!el, hasCopy: !!document.getElementById('measureCopy'), n: S.measure.length, txt: app.__measure.text() };
});
ok('4a ölçüm panelinde paylaş düğmesi var', meas.hasShare === true, JSON.stringify({ s: meas.hasShare, c: meas.hasCopy }));
ok('4b panoya kopyala düğmesi duruyor', meas.hasCopy === true);
ok('4c geri al bir nokta düşürdü', meas.n === 2, String(meas.n));
ok('4d döküm ölçü başlığıyla başlıyor', /Ölç/i.test(meas.txt.split('\n')[0]), meas.txt.split('\n')[0]);
ok('4e dökümde 3-4-5 üçgeninin 50 uzunluğu geçiyor', meas.txt.includes('50'), meas.txt.replace(/\n/g, ' | ').slice(0, 160));

// Ölçüm CSV'si: panelden kazınmaz, ölçüm verisinden kurulur — parça başına bir satır, Δ'lar ayrı sütunda.
const mcsv = await page.evaluate(() => {
  const app = window.dwgApp, S = app.state;
  S.measure.length = 0;
  S.measure.push([0, 0, 0], [30, 40, 0]);
  const duz = app.__measure.csv();
  S.measure.length = 0;
  S.measure.push([0, 0, 0], [30, 40, 120]);          // kotlu: eğik boy 130, yatay 50
  const egik = app.__measure.csv();
  return { duz, egik, has: !!document.getElementById('measureCsv') };
});
ok('4f ölçüm panelinde CSV düğmesi var', mcsv.has === true);
ok('4g CSV noktalı virgülle ayrılmış başlık satırı taşıyor',
  mcsv.duz.split('\r\n').some(l => l.split(';').length >= 12 && /X1/.test(l)),
  mcsv.duz.split('\r\n').find(l => /X1/.test(l)) || '');
ok('4h düz ölçümde eğik boy = yatay boy = 50', /(^|;)50(;|$)/m.test(mcsv.duz.replace(/\r/g, '')), mcsv.duz.replace(/\r?\n/g, ' | ').slice(0, 200));

// 3B uzunluk kusuru: kot bilinen uçlarda mesafe EĞİK ölçülmeli (30-40-120 → 130), yatay izdüşüm 50 ayrı sütunda.
ok('4i kotlu ölçümde eğik boy 130, yatay 50 ayrı sütunda',
  /(^|;)130(;|$)/m.test(mcsv.egik.replace(/\r/g, '')) && /(^|;)50(;|$)/m.test(mcsv.egik.replace(/\r/g, '')) && /(^|;)120(;|$)/m.test(mcsv.egik.replace(/\r/g, '')),
  mcsv.egik.replace(/\r?\n/g, ' | ').slice(0, 260));
await page.evaluate(() => window.dwgApp.setMode('view'));

// ---- 4b. Eğik yolun uzunluğu: pathLength3 yatay izdüşümü değil gerçek boyu vermeli --------------
const zlen = await page.evaluate(async () => {
  const g = await import('./geom.js');
  const ops = [[0, 0, 0, 0], [1, 30, 40, 120]];      // 3-4-5 tabanı, Δz 120 → eğik 130
  return { d2: g.pathLength(ops, false), d3: g.pathLength3(ops, false),
    kapali2: g.pathLength(ops, true), kapali3: g.pathLength3(ops, true),
    kotsuz3: g.pathLength3([[0, 0, 0], [1, 30, 40]], false) };
});
ok('4j pathLength yatay izdüşüm veriyor (50)', Math.abs(zlen.d2 - 50) < 1e-9, String(zlen.d2));
ok('4k pathLength3 gerçek eğik boyu veriyor (130)', Math.abs(zlen.d3 - 130) < 1e-9, String(zlen.d3));
ok('4l kapalı yolda dönüş parçası da eğik sayılıyor (260)', Math.abs(zlen.kapali3 - 260) < 1e-9 && Math.abs(zlen.kapali2 - 100) < 1e-9, `${zlen.kapali3} / ${zlen.kapali2}`);
ok('4m kot verilmemiş 2B yolda iki ölçüm birebir aynı', Math.abs(zlen.kotsuz3 - 50) < 1e-9, String(zlen.kotsuz3));

// ---- 4c. Sayım paneli: kapsam, katman × tür çaprazı ve CSV --------------------------------------
const cnt = await page.evaluate(async () => {
  const app = window.dwgApp;
  app.action('count');
  await new Promise(r => setTimeout(r, 250));
  const body = document.getElementById('docBody');
  const sel = document.getElementById('cntScope');
  const opts = sel ? [...sel.options].map(o => o.value) : [];
  const bar = body.querySelectorAll('.cbar').length, head = body.querySelectorAll('.cnt-h').length;
  const hepsi = app.__count.data('all'), gorunur = app.__count.data('vis');
  const csv = app.__count.csv('all');
  document.getElementById('docClose') && document.getElementById('docClose').click();
  return { opts, bar, head, csv, hepsi: hepsi.prims, gorunur: gorunur.prims,
    tur: [...hepsi.types.keys()].length, kat: [...hepsi.byLayer.keys()].length,
    ham: /&lt;div/.test(body.innerHTML) };
});
ok('5A sayım panelinde dört kapsam var', cnt.opts.join(',') === 'all,sel,vis,win', cnt.opts.join(','));
ok('5B oransal çubuklar ve başlıklar HTML olarak basılıyor (kaçırılmıyor)', cnt.bar > 0 && cnt.head >= 2 && !cnt.ham, `${cnt.bar} çubuk · ${cnt.head} başlık · ham=${cnt.ham}`);
ok('5C kapsam daraltması ilkel sayısını değiştirebiliyor', cnt.gorunur <= cnt.hepsi && cnt.hepsi > 0, `${cnt.gorunur}/${cnt.hepsi}`);
ok('5D katman × tür çaprazı üretildi', cnt.kat >= 1 && cnt.tur >= 1, `${cnt.kat} katman · ${cnt.tur} tür`);
ok('5E sayım CSV\'sinde blok, tür ve katman bölümleri var',
  cnt.csv.includes(';') && cnt.csv.split('\r\n').length > 4, cnt.csv.split('\r\n').slice(0, 3).join(' | '));

// ---- 5b. Akıllı ölçüm: dokunulan nesnenin TÜRÜNE göre doğru ölçü ------------------------------
// Kullanıcı hangi ölçüyü istediğini önceden seçmez; araç türü anlayıp anlamlı olanı verir.
const ident = await page.evaluate(() => {
  const app = window.dwgApp, ed = app.editor;
  const oku = (pred) => {
    const p = app.state.prims.find(pred);
    if (!p) return null;
    ed.tools.start('ident');
    ed.tools.identify(p);
    const body = document.getElementById('resultBody') || document.getElementById('docBody');
    return (body ? body.textContent : '').replace(/\s+/g, ' ');
  };
  return {
    daire: oku(p => { if (!(p.k === 0 && p.ops.length === 2)) return false; const o = p.ops[1]; if (o[0] !== 2 && o[0] !== -2) return false; return Math.abs(Math.abs(o[5] - o[4]) - Math.PI * 2) < 1e-6; }),
    yay: oku(p => { if (!(p.k === 0 && p.ops.length === 2)) return false; const o = p.ops[1]; if (o[0] !== 2 && o[0] !== -2) return false; return Math.abs(Math.abs(o[5] - o[4]) - Math.PI * 2) > 1e-6; }),
    cizgi: oku(p => p.k === 0 && p.ops.length === 2 && p.ops[1][0] === 1),
    yazi: oku(p => p.k === 1),
    karo: !!document.querySelector('[data-act="t:ident"]'),
  };
});
ok('5F akıllı ölçüm karosu ölçü sekmesinde', ident.karo === true);
ok('5G tam daireden yarıçap, çap, çevre ve alan okunuyor',
  !!ident.daire && /Yarıçap/.test(ident.daire) && /Çap/.test(ident.daire) && /Çevre/.test(ident.daire) && /Alan/.test(ident.daire),
  (ident.daire || '').slice(0, 130));
// Yay tam daire değildir: çevre ve alan YERİNE yay uzunluğu ve merkez açısı verilmeli
ok('5G2 yaydan yay uzunluğu ve açı okunuyor, çevre/alan verilmiyor',
  !!ident.yay && /Yay uzunluğu/.test(ident.yay) && /Açı/.test(ident.yay) && !/Çevre/.test(ident.yay) && !/Alan/.test(ident.yay),
  (ident.yay || '').slice(0, 130));
ok('5H çizgiden uzunluk, köşe sayısı ve açı okunuyor',
  !!ident.cizgi && /Uzunluk/.test(ident.cizgi) && /Açı/.test(ident.cizgi) && !/Yarıçap/.test(ident.cizgi),
  (ident.cizgi || '').slice(0, 120));
ok('5I yazıdan içerik ve yükseklik okunuyor',
  !!ident.yazi && /Yükseklik/.test(ident.yazi) && /Metin/.test(ident.yazi),
  (ident.yazi || '').slice(0, 120));

// ---- 5. Metin çıkarma ---------------------------------------------------------------------------
const tx = await page.evaluate(() => {
  const app = window.dwgApp;
  const rows = app.__text.collect();
  const cell = app.__text.csvCell;
  return { n: rows.length, first: rows[0] || null,
    plain: cell('abc'), quoted: cell('a;b'), esc: cell('a"b'), nl: cell('a\nb') };
});
ok('5a çizimden yazı toplandı', tx.n > 0, String(tx.n));
ok('5b satırda metin, katman ve konum var', !!(tx.first && tx.first.txt && tx.first.lay !== undefined && isFinite(tx.first.x)), JSON.stringify(tx.first));
ok('5c düz hücre tırnaklanmaz', tx.plain === 'abc', tx.plain);
ok('5d ayraçlı hücre tırnaklanır', tx.quoted === '"a;b"', tx.quoted);
ok('5e iç tırnak ikilenir', tx.esc === '"a""b"', tx.esc);
ok('5f satır sonu tırnaklanır', tx.nl === '"a\nb"', JSON.stringify(tx.nl));

// ---- 6. Çok sayfalı PDF -------------------------------------------------------------------------
// 1×1 piksel JPEG ile iki sayfalık bir PDF kurulur; sayfa ağacı, nesne sayısı ve xref sınanır.
const pdf = await page.evaluate(async () => {
  const jpeg = await new Promise(res => {
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1);
    res(c.toDataURL('image/jpeg', 0.5).split(',')[1]);
  });
  const one = window.dwgApp.__pdf.build([{ jpeg, pw: 1, ph: 1 }], 210, 297, 'Tek');
  const two = window.dwgApp.__pdf.build([{ jpeg, pw: 1, ph: 1 }, { jpeg, pw: 1, ph: 1 }], 210, 297, 'İki');
  const txt = (b64) => { const s = atob(b64); return s; };
  const t1 = txt(one), t2 = txt(two);
  return {
    head1: t1.slice(0, 8), eof1: t1.trimEnd().endsWith('%%EOF'),
    count1: (t1.match(/\/Count (\d+)/) || [])[1],
    count2: (t2.match(/\/Count (\d+)/) || [])[1],
    kids2: (t2.match(/\/Kids \[([^\]]*)\]/) || [])[1],
    size2: (t2.match(/\/Size (\d+)/) || [])[1],
    pages2: (t2.match(/\/Type \/Page[^s]/g) || []).length,
    xrefRows2: ((t2.match(/xref\n0 (\d+)/) || [])[1]),
    bigger: t2.length > t1.length,
  };
});
ok('6a PDF başlığı doğru', pdf.head1 === '%PDF-1.4', pdf.head1);
ok('6b dosya %%EOF ile bitiyor', pdf.eof1 === true);
ok('6c tek sayfada Count 1', pdf.count1 === '1', String(pdf.count1));
ok('6d iki sayfada Count 2', pdf.count2 === '2', String(pdf.count2));
ok('6e Kids iki sayfayı gösteriyor', pdf.kids2 === '3 0 R 6 0 R', String(pdf.kids2));
ok('6f nesne sayısı 10 (1+1+2×3+künye)', pdf.size2 === '10', String(pdf.size2));
ok('6g iki Page nesnesi var', pdf.pages2 === 2, String(pdf.pages2));
ok('6h xref satır sayısı Size ile aynı', pdf.xrefRows2 === pdf.size2, `${pdf.xrefRows2} / ${pdf.size2}`);
ok('6i iki sayfalık dosya daha büyük', pdf.bigger === true);

// ---- 7. Hazır ifadeler --------------------------------------------------------------------------
const words = await page.evaluate(async () => {
  const dlg = await import('./dialog.js');
  const before = dlg.presetWords();
  dlg.rememberWord('Kanal ekseni');
  dlg.rememberWord('a'.repeat(60));            // çok uzun: alınmaz
  dlg.rememberWord('iki\nsatır');              // çok satırlı: alınmaz
  const after = dlg.presetWords();
  const rec = dlg.recentWords();
  return { before: before.length, after: after.slice(0, 3), rec, first: after[0] };
});
ok('7a öntanımlı liste dolu', words.before >= 10, String(words.before));
ok('7b son kullanılan en başa geçti', words.first === 'Kanal ekseni', JSON.stringify(words.after));
ok('7c uzun metin listeye alınmadı', words.rec.every(w => w.length <= 40), JSON.stringify(words.rec));
ok('7d çok satırlı metin alınmadı', words.rec.every(w => !w.includes('\n')), JSON.stringify(words.rec));

const chips = await page.evaluate(async () => {
  const dlg = await import('./dialog.js');
  const p = dlg.askText('sınama', '', { words: true });
  const n = document.querySelectorAll('#askField [data-word]').length;
  const btn = document.querySelector('#askField [data-word]');
  const word = btn ? btn.dataset.word : '';
  if (btn) btn.click();
  const v1 = document.getElementById('askIn').value;
  if (btn) btn.click();
  const v2 = document.getElementById('askIn').value;
  document.getElementById('askOk').click();
  const res = await p;
  return { n, word, v1, v2, res };
});
ok('7e kutuda ifade çipleri çıktı', chips.n >= 10, String(chips.n));
ok('7f çip metni kutuya eklendi', chips.v1 === chips.word, `${chips.v1} / ${chips.word}`);
ok('7g ikinci dokunuş boşlukla ekliyor', chips.v2 === chips.word + ' ' + chips.word, chips.v2);
ok('7h onaylanan değer geri döndü', chips.res === chips.v2, String(chips.res));

// ---- 8. Yetki: yüzey ölçüsü Super, metin çıkarma Premium ----------------------------------------
const tiers = await page.evaluate(async () => {
  const Ed = await import('./edition.js');
  return { area: Ed.need('area3d'), text: Ed.need('textout') };
});
ok('8a yüzey ölçüsü Super', tiers.area === 'super', tiers.area);
ok('8b metin çıkarma Premium', tiers.text === 'premium', tiers.text);

await page.screenshot({ path: `${out}/extras.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
