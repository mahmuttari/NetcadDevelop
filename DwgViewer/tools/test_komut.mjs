// AutoCAD komut uyumu: adlar, kısaltmalar, komut satırı ve İngilizce arayüz etiketleri.
//  1) acad.js tablosunun kendi sağlığı: çakışan ad yok, kimlikler gerçek, kısaltmalar uydurulmamış.
//  2) Komut satırı: boşta "Command:" ister, ad çözer, geçmiş ve boş Enter yineleme çalışır.
//  3) İngilizce arayüzde etiket AutoCAD komut adıdır (LINE, ERASE, RECTANG…), Türkçe'de değişmez.
//  4) Uygulamaya özgü komutlar AutoCAD komutu gibi SUNULMAZ; listede ayrı bölümde durur.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_komut.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';

const { out, samples: SM } = args(import.meta.url);
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const errors = [];

const ctx = await browser.newContext(PHONE);
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
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; });

const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const bar = () => ev(() => ({ hidden: document.getElementById('cmdBar').hidden, text: document.getElementById('cmdText').textContent.trim(), ph: document.getElementById('cmdInput').placeholder, inpHidden: document.getElementById('cmdInput').hidden }));
const aktif = () => ev(() => window.dwgApp.editor.tools.active);
const toast = () => ev(() => { const el = document.getElementById('toast'); return el && !el.hidden ? el.textContent.trim() : ''; });
const yaz = async (v) => { await page.fill('#cmdInput', v); await page.waitForTimeout(120); };
const gir = async () => { await page.click('#cmdEnter'); await page.waitForTimeout(220); };
const iptal = async () => { await ev(() => { window.dwgApp.editor.tools.cancel(); }); await page.waitForTimeout(180); };
/** Dili uygulamanın kendi yolundan değiştirir (dwg:lang olayı yayınlanır) */
const dil = (l) => ev(async (x) => {
  const I = await import('./i18n.js');
  const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x;
  window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } }));
}, l);
const etiket = (act) => ev((a) => { const b = document.querySelector(`#toolbar [data-act="${a}"] .lb`); return b ? b.textContent.trim() : null; }, act);

// ---------------------------------------------------------------------------------
// 1) Tablonun kendi sağlığı
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const A = await import('./acad.js');
    return {
      hata: A.dogrula(),
      n: A.COMMANDS.length,
      adet: A.BY_NAME.size,
      acad: A.COMMANDS.filter(c => !c.ext).length,
      ext: A.COMMANDS.filter(c => c.ext).length,
      // AutoCAD'in kendi kısaltmaları: birkaçı elle doğrulanır
      L: A.resolve('l') && A.resolve('l').id,
      TR: A.resolve('TR') && A.resolve('TR').id,
      E: A.resolve('e') && A.resolve('e').id,
      F: A.resolve('F') && A.resolve('F').id,
      CHA: A.resolve('cha') && A.resolve('cha').id,
      X: A.resolve('x') && A.resolve('x').id,
      onek: A.resolve('_line') && A.resolve('_line').id,
      tirnak: A.resolve("'zoom") && A.resolve("'zoom").id,
      tire: A.resolve('-layer') && A.resolve('-layer').id,
      yok: A.resolve('BOZUKKOMUT'),
      bos: A.resolve(''),
      oner: A.suggest('LIN').map(c => c.cmd),
      onerKisa: A.suggest('TR').map(c => c.cmd),
      cmdLine: A.cmdOf('t:line'), cmdDel: A.cmdOf('t:del'), cmdYok: A.cmdOf('olmayan'),
      adlar: A.namesOf('t:copy'),
      st: A.stats(),
      // tanınan ama bulunmayan komut: kimliği yok, avail:false; kısaltması da çözülür
      polygon: A.resolve('polygon') && { id: A.resolve('polygon').id, avail: A.resolve('polygon').avail },
      pol: A.resolve('pol') && A.resolve('pol').cmd,
      stretchS: A.resolve('s') && A.resolve('s').cmd,
      // eşanlamlı: MTEXT / T aynı araca gider ama etiket birincil addan (TEXT) okunur
      mtext: A.resolve('t') && A.resolve('t').id, textCmd: A.cmdOf('t:text'), textNames: A.namesOf('t:text'),
      ds: A.resolve('ds') && A.resolve('ds').id, dimstyleD: A.resolve('d') && A.resolve('d').cmd,
      layiso: A.resolve('layiso') && A.resolve('layiso').id, regenRE: A.resolve('re') && A.resolve('re').id,
      repGrid: A.repeatable('grid'), repOrtho: A.repeatable('ortho'), repLine: A.repeatable('t:line'), repYok: A.repeatable('olmayan'),
      onerNa: A.suggest('POL', 8).map(c => [c.cmd, c.avail === false]),
    };
  });
  ok('1a tabloda çakışan ad, yinelenen kimlik ya da eksik alan yok', g.hata.length === 0, JSON.stringify(g.hata).slice(0, 200));
  ok('1b tablo dolu: 300+ komut, 600+ ad ve kısaltma', g.n >= 300 && g.adet >= 600, `${g.n} komut · ${g.adet} ad`);
  ok('1c çalışan AutoCAD · uygulamaya özgü · tanınan-bulunmayan ayrı sayılıyor', g.st.acad >= 150 && g.st.ext >= 25 && g.st.known >= 250 && g.st.acad + g.st.ext + g.st.known === g.n, JSON.stringify(g.st));
  ok('1d AutoCAD kısaltmaları doğru bağlanmış (L, TR, E, F, CHA, X)',
    g.L === 't:line' && g.TR === 't:trim' && g.E === 't:del' && g.F === 't:fillet' && g.CHA === 't:chamfer' && g.X === 't:explode',
    JSON.stringify({ L: g.L, TR: g.TR, E: g.E, F: g.F, CHA: g.CHA, X: g.X }));
  ok('1h tanınan ama bulunmayan komut çözülür: kimliksiz, avail:false; kısaltması da (POL, S)',
    g.polygon && g.polygon.id === 't:polygon' && g.polygon.avail !== false && g.pol === 'POLYGON' && g.stretchS === 'STRETCH', JSON.stringify({ p: g.polygon, pol: g.pol, s: g.stretchS }));
  ok('1i eşanlamlı ad aynı araca gider, etiket birincil addan okunur (T → TEXT, DS → DSETTINGS, D → DIMSTYLE)',
    g.mtext === 't:text' && g.textCmd === 'TEXT' && g.textNames === 'TEXT (DT)' && g.ds === 'display' && g.dimstyleD === 'DIMSTYLE', JSON.stringify({ mtext: g.mtext, textCmd: g.textCmd, names: g.textNames, ds: g.ds, d: g.dimstyleD }));
  ok('1j yeni katman ve yenileme komutları bağlı (LAYISO, RE → REGEN)', g.layiso === 'layiso' && g.regenRE === 'regen', JSON.stringify({ layiso: g.layiso, re: g.regenRE }));
  ok('1k açma/kapama komutları yinelenmez, çizim komutları yinelenir', g.repGrid === false && g.repOrtho === false && g.repLine === true && g.repYok === false, JSON.stringify({ grid: g.repGrid, ortho: g.repOrtho, line: g.repLine, yok: g.repYok }));
  ok('1l öneride çalışan komut bulunmayandan önce gelir', g.onerNa.length >= 2 && g.onerNa[0][1] === false && g.onerNa.some(x => x[1] === true) && g.onerNa.findIndex(x => x[1]) > g.onerNa.filter(x => !x[1]).length - 1, JSON.stringify(g.onerNa));
  ok('1e AutoCAD önekleri kabul edilir: _ (dil bağımsız), \' (saydam), - (komut satırı sürümü)',
    g.onek === 't:line' && g.tirnak === 'extents' && g.tire === 'layers', JSON.stringify({ onek: g.onek, tirnak: g.tirnak, tire: g.tire }));
  ok('1f tanınmayan ve boş girdi null döner (sessizce yanlış komut çalışmaz)', g.yok === null && g.bos === null);
  ok('1g öneri: tam ad başlangıçları önce gelir', g.oner[0] === 'LINE' && g.oner.includes('LINETYPE'), JSON.stringify(g.oner));
  ok('1h öneri kısaltmayı da bulur (TR → TRIM)', g.onerKisa.includes('TRIM'), JSON.stringify(g.onerKisa));
  ok('1i cmdOf tabloda olmayan kimlikte null döner (çağıran kendi adını kullanabilsin)', g.cmdLine === 'LINE' && g.cmdDel === 'ERASE' && g.cmdYok === null);
  ok('1j namesOf komutu kısaltmalarıyla yazar', g.adlar === 'COPY (CO, CP)', g.adlar);
}

// ---------------------------------------------------------------------------------
// 2) Kimlikler gerçek: tablodaki her id uygulamada var olan bir eylem
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const A = await import('./acad.js'), E = await import('./editor.js');
    const T = await import('./tools.js');
    // Karo kimlikleri DOM'dan, araç kimlikleri TOOLS tablosundan doğrulanır
    const karo = new Set([...document.querySelectorAll('#toolbar [data-act]')].map(b => b.dataset.act));
    const arac = new Set(T.TOOL_IDS || []);
    const yok = A.COMMANDS.filter(c => {
      if (!c.id) return c.avail !== false;   // kimliksiz kayıt yalnız "bulunmayan" olabilir
      if (c.id.startsWith('t:')) return !arac.has(c.id.slice(2));
      return false;   // karo kimlikleri sekmeye göre çizilir, DOM'da hepsi aynı anda olmaz
    });
    return { yok: yok.map(c => `${c.cmd}→${c.id}`), aracN: arac.size, karoN: karo.size };
  });
  ok('2a tablodaki her ARAÇ kimliği gerçekten var (hayalet komut yok)', g.yok.length === 0, JSON.stringify(g.yok));
  ok('2b araç tablosu okunabildi', g.aracN >= 40, String(g.aracN));
}

// ---------------------------------------------------------------------------------
// 3) Komut satırı — boşta istem
// ---------------------------------------------------------------------------------
{
  const b = await bar();
  ok('3a çizim açılınca komut satırı boşta "Komut:" ister', b.hidden === false && /Komut|Command/.test(b.text) && b.inpHidden === false, JSON.stringify(b));
  await shot('komut_bosta');
}

// ---------------------------------------------------------------------------------
// 4) Komut çağırma
// ---------------------------------------------------------------------------------
{
  await yaz('line'); await gir();
  ok('4a küçük harf "line" LINE aracını başlatır', (await aktif()) === 'line', String(await aktif()));
  ok('4b araç çalışırken çubuk aracın istemine geçer', /Çizgi|Line/.test((await bar()).text), (await bar()).text);
  await iptal();
  ok('4c araç bitince çubuk boştaki isteme DÖNER (kapanmaz)', (await bar()).hidden === false && /Komut|Command/.test((await bar()).text), JSON.stringify(await bar()));

  await yaz('TR'); await gir();
  ok('4d AutoCAD kısaltması "TR" budamayı başlatır', (await aktif()) === 'trim', String(await aktif()));
  await iptal();
  await yaz('f'); await gir();
  ok('4e "F" kavis başlatır (AutoCAD FILLET kısaltması)', (await aktif()) === 'fillet', String(await aktif()));
  await iptal();

  // boş Enter son komutu yineler
  await yaz(''); await gir();
  ok('4f boş Enter SON komutu yineler (AutoCAD davranışı)', (await aktif()) === 'fillet', String(await aktif()));
  await iptal();

  await yaz('BOZUKKOMUT'); await gir();
  ok('4g tanınmayan ad uyarı verir, hiçbir araç başlamaz', (await aktif()) === null && /BOZUKKOMUT/.test(await toast()), await toast());

  // Tanınan ama bulunmayan AutoCAD komutu: "bilinmeyen" DENMEZ; bulunmadığı ve en yakın karşılığı söylenir
  await ev(() => { document.getElementById('toast').hidden = true; });
  await yaz('donut'); await gir();
  const tNa = await toast();
  ok('4h DONUT: "bulunmuyor" uyarısı ve en yakın karşılık (iki daire); araç başlamaz', (await aktif()) === null && /DONUT/.test(tNa) && /bulunmuyor|not available/.test(tNa) && /circle/i.test(tNa), tNa);
  // boş Enter bulunmayan komutu DEĞİL, ondan önceki gerçek komutu yineler
  await yaz(''); await gir();
  ok('4i boş Enter bulunmayan komutu değil son gerçek komutu (FILLET) yineler', (await aktif()) === 'fillet', String(await aktif()));
  await iptal();
  // POLYGON artık gerçek bir komuttur (v7.67): aracı başlatır, kenar sayısını sorar
  await yaz('polygon'); await gir();
  ok('4h2 POLYGON çokgen aracını başlatır (kısaltma POL)', (await aktif()) === 'polygon', String(await aktif()));
  await iptal();
  await yaz('pol'); await gir();
  ok('4h3 "POL" kısaltması da çokgeni başlatır', (await aktif()) === 'polygon', String(await aktif()));
  await iptal();
  await yaz('f'); await gir(); await iptal(); // son gerçek komut yine FILLET olsun (4j buna bakar)
  // açma/kapama karosu "son komut" olmaz: GRID'e dokunduktan sonra boş Enter ızgarayı geri kapatmaz
  const gridOnce = await ev(() => window.dwgApp.state.grid.on);
  await ev(() => window.dwgApp.editor.act('grid')); await page.waitForTimeout(150);
  await yaz(''); await gir();
  const gridSonra = await ev(() => window.dwgApp.state.grid.on);
  ok('4j GRID karosundan sonra boş Enter ızgarayı yinelemez (FILLET başlar, ızgara değişmez)', (await aktif()) === 'fillet' && gridSonra === !gridOnce, JSON.stringify({ once: gridOnce, sonra: gridSonra, aktif: await aktif() }));
  await iptal();
  await ev(() => window.dwgApp.editor.act('grid')); await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------------
// 5) Öneri listesi
// ---------------------------------------------------------------------------------
{
  await yaz('dim');
  const s = await ev(() => { const e = document.getElementById('cmdSug'); return { hidden: e.hidden, n: e.querySelectorAll('button').length, adlar: [...e.querySelectorAll('button b')].map(b => b.textContent) }; });
  ok('5a yazarken uyan komutlar listelenir', s.hidden === false && s.n > 1 && s.adlar.every(a => a.startsWith('DIM')), JSON.stringify(s.adlar));
  await shot('komut_oneri');
  await ev(() => document.querySelector('#cmdSug [data-cmd-run="DIMRADIUS"]').click());
  await page.waitForTimeout(250);
  ok('5b öneriye dokunmak komutu çalıştırır', (await aktif()) === 'dimr', String(await aktif()));
  ok('5c komut çalışınca öneri listesi kapanır', await ev(() => document.getElementById('cmdSug').hidden));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 6) Geçmiş
// ---------------------------------------------------------------------------------
{
  await yaz('circle'); await gir(); await iptal();
  await yaz('rectang'); await gir(); await iptal();
  await page.focus('#cmdInput');
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(80);
  const g1 = await ev(() => document.getElementById('cmdInput').value);
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(80);
  const g2 = await ev(() => document.getElementById('cmdInput').value);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80);
  const g3 = await ev(() => document.getElementById('cmdInput').value);
  ok('6a yukarı ok geçmişte geriye gider (en son komut önce)', g1 === 'RECTANG' && g2 === 'CIRCLE', `${g1} → ${g2}`);
  ok('6b aşağı ok geçmişin sonunda alanı boşaltır', g3 === '', JSON.stringify(g3));
  await ev(() => { document.getElementById('cmdInput').value = ''; });
}

// ---------------------------------------------------------------------------------
// 7) İngilizce arayüz: etiketler AutoCAD komut adı
// ---------------------------------------------------------------------------------
{
  const tr = {};
  for (const a of ['t:line', 't:del', 't:rect', 't:trim', 't:dim']) tr[a] = await etiket(a);
  ok('7a Türkçe arayüzde etiketler TÜRKÇE kalır', tr['t:del'] === 'Sil' && tr['t:line'] === 'Çizgi' && tr['t:rect'] === 'Dikdörtgen', JSON.stringify(tr));

  await dil('en'); await page.waitForTimeout(400);
  const en = {};
  for (const a of ['t:line', 't:del', 't:rect', 't:trim', 't:dim', 't:coord', 't:pline', 't:arc3', 't:edittext']) en[a] = await etiket(a);
  ok('7b İngilizce arayüzde etiket AutoCAD komut adıdır',
    en['t:line'] === 'LINE' && en['t:del'] === 'ERASE' && en['t:rect'] === 'RECTANG' && en['t:trim'] === 'TRIM' && en['t:dim'] === 'DIMALIGNED' && en['t:coord'] === 'ID' && en['t:pline'] === 'PLINE' && en['t:arc3'] === 'ARC' && en['t:edittext'] === 'TEXTEDIT',
    JSON.stringify(en));
  const b = await bar();
  ok('7c İngilizce boşta istem ve yer tutucu çevrildi', /^Command/.test(b.text) && /command/i.test(b.ph), JSON.stringify(b));
  await shot('komut_ingilizce');
  const ipucu = await ev(() => { const x = document.querySelector('#toolbar [data-act="t:copy"]'); return x ? x.getAttribute('title') : null; });
  ok('7d İngilizce karo başlığı komut adı', ipucu === 'COPY', String(ipucu));
}

// ---------------------------------------------------------------------------------
// 8) Komut listesi ekranı
// ---------------------------------------------------------------------------------
{
  // v7.82: "?" #cmdBtns'ten İSTEM SATIRINA taşındı (#cmdHelp) — orada 40 px sözleşmesi dışındadır
  // ve boştaki çubuğu 40 px'te tutmuyor. Eylem düğmeleri (Bitir · Geri · İptal) #cmdBtns'te kalır.
  await ev(() => document.getElementById('cmdHelp').click());
  await page.waitForTimeout(250);
  const d = await ev(() => {
    const p = document.getElementById('docPanel');
    if (!p || p.hidden) return { acik: false };
    const basliklar = [...p.querySelectorAll('.opt-title')].map(x => x.textContent.trim());
    const tablolar = [...p.querySelectorAll('table.cmd-list')].map(t => t.querySelectorAll('tr').length);
    const ilk = [...p.querySelectorAll('table.cmd-list')][0];
    return { acik: true, basliklar, tablolar, kod: ilk ? ilk.querySelector('code').textContent : '', ham: /cmdAcad|cmdExt/.test(p.textContent) };
  });
  ok('8a "?" düğmesi komut listesini açar', d.acik === true);
  ok('8b liste ÜÇ bölüm: AutoCAD komutu · uygulamaya özgü · tanınan-bulunmayan', d.acik && d.basliklar.length === 3 && /AutoCAD/.test(d.basliklar[0]) && d.tablolar.length === 3 && d.tablolar[0] >= 150 && d.tablolar[2] >= 250, JSON.stringify({ b: d.basliklar, t: d.tablolar }));
  ok('8c uygulamaya özgü komutlar AutoCAD komutu gibi SUNULMUYOR (ayrı bölüm, ayrı sayı)', d.acik && d.tablolar[1] >= 20 && d.tablolar[0] !== d.tablolar[1], JSON.stringify(d.tablolar));
  ok('8d ham i18n anahtarı sızmamış', d.acik && d.ham === false);
  await shot('komut_listesi');
  await ev(() => { const p = document.getElementById('docPanel'); if (p) p.hidden = true; });
  await dil('tr'); await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------------
// 9) Kapatma: eski davranış geri gelir
// ---------------------------------------------------------------------------------
{
  await ev(async () => { const E = await import('./editor.js'); E.ui.cmdLine = false; window.dwgApp.editor.act('cmdline'); });
  await page.waitForTimeout(200);
  const acik = await ev(async () => { const E = await import('./editor.js'); return E.ui.cmdLine; });
  ok('9a karo komut satırını açar', acik === true, String(acik));
  await ev(() => window.dwgApp.editor.act('cmdline'));
  await page.waitForTimeout(200);
  const b = await bar();
  ok('9b kapatılınca çubuk gizlenir (araç yokken eski davranış)', b.hidden === true, JSON.stringify(b));
  await yaz('line').catch(() => {});
  await ev(() => window.dwgApp.editor.act('t:line'));
  await page.waitForTimeout(200);
  ok('9c komut satırı kapalıyken araçlar yine çalışır ve kendi istemini gösterir', (await aktif()) === 'line' && (await bar()).hidden === false, JSON.stringify(await bar()));
  await iptal();
  ok('9d komut satırı kapalıyken araç bitince çubuk gizlenir', (await bar()).hidden === true);
  await ev(() => window.dwgApp.editor.act('cmdline'));
  await page.waitForTimeout(150);
}

// ---------------------------------------------------------------------------------
// 11 · v7.82: yoğun komut çubuğu ve tek dokunuşla gizleme
// ---------------------------------------------------------------------------------
{
  const a = await ev(async () => {
    const E = window.dwgApp.editor;
    if (E.tools.running) E.tools.cancel();
    E.act('cmdline'); await new Promise(r => setTimeout(r, 120));   // kapalıysa aç
    if (document.getElementById('cmdBar').hidden) { E.act('cmdline'); await new Promise(r => setTimeout(r, 120)); }
    await new Promise(r => setTimeout(r, 250));
    const bar = document.getElementById('cmdBar'), inp = document.getElementById('cmdInput'), hb = document.getElementById('cmdHide');
    return { bosta: bar.classList.contains('idle'), h: bar.offsetHeight, giris: inp.offsetHeight,
      gizle: hb ? { gorunur: !hb.hidden, h: hb.offsetHeight } : null };
  });
  /*
   * YOĞUN ÇUBUK (v7.82). v7.79'da çubuk iki satırdan bire indi; geriye kalan yüksekliğin tamamı
   * denetimlerin kendisiydi (40 px). Kullanıcı "%50 küçültelim" dediği için taban 40 px'ten
   * WCAG 2.2 AA "Target Size (Minimum)" ölçütünün sayısal tabanına — 24 px'e — çekildi ve giriş
   * 26 px'e indi. ALTINA İNİLMEZ: 24 px erişilebilirlik ölçütünün kendisidir. Şerit, paneller ve
   * gezinme 40/48/52 px sözleşmesinde kalır (test_shell 46, test_lock 13) — gevşeme yalnız
   * komut çubuğundadır. Geniş kip (denseBars kapalı, 40 px) ve eldiven kipi (52 px)
   * ölçümleri bu dosyada değil test_3d 11e2 / 11e3'tedir.
   */
  ok('11a boştaki çubuk TEK satır ve YOĞUN (34 px altı), giriş WCAG tabanı 24 px üstünde', a.bosta === true && a.h > 0 && a.h < 34 && a.giris >= 24, JSON.stringify(a));
  ok('11b boşta Gizle düğmesi görünür', !!a.gizle && a.gizle.gorunur === true, JSON.stringify(a));

  const b = await ev(async () => {
    document.getElementById('cmdHide').click();
    await new Promise(r => setTimeout(r, 250));
    const el = document.getElementById('toast');
    return { gizli: document.getElementById('cmdBar').hidden,
      ileti: el && !el.hidden ? (el.querySelector('.tx') || el).textContent : '' };
  });
  ok('11c Gizle çubuğu kapatır ve geri getirme yolunu söyler', b.gizli === true && /\u25b8/.test(b.ileti) && b.ileti.length > 10, JSON.stringify(b));

  const c2 = await ev(async () => {
    window.dwgApp.editor.act('cmdline');   // Ekran ▸ Komut satırı ile geri gelir
    await new Promise(r => setTimeout(r, 250));
    return { gizli: document.getElementById('cmdBar').hidden };
  });
  ok('11d karo çubuğu geri getirir', c2.gizli === false, JSON.stringify(c2));

  const d = await ev(async () => {
    const E = window.dwgApp.editor;
    E.act('t:line'); await new Promise(r => setTimeout(r, 250));
    const hb = document.getElementById('cmdHide'), bar = document.getElementById('cmdBar');
    const r = { gizle: hb ? !hb.hidden : null, bosta: bar.classList.contains('idle') };
    if (E.tools.running) E.tools.cancel();
    await new Promise(r2 => setTimeout(r2, 200));
    return r;
  });
  ok('11e komut çalışırken Gizle YOK ve istem kendi satırında (çalışan komut kapatılamaz)', d.gizle === false && d.bosta === false, JSON.stringify(d));
}

ok('10 sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); await srv.kill();
C.summary(); C.exit();
