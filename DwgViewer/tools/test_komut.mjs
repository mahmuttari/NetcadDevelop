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
    };
  });
  ok('1a tabloda çakışan ad, yinelenen kimlik ya da eksik alan yok', g.hata.length === 0, JSON.stringify(g.hata).slice(0, 200));
  ok('1b tablo dolu: 80+ komut, 140+ ad ve kısaltma', g.n >= 80 && g.adet >= 140, `${g.n} komut · ${g.adet} ad`);
  ok('1c AutoCAD karşılığı olanlar ile uygulamaya özgü olanlar ayrı sayılıyor', g.acad >= 55 && g.ext >= 20, `AutoCAD ${g.acad} · özgü ${g.ext}`);
  ok('1d AutoCAD kısaltmaları doğru bağlanmış (L, TR, E, F, CHA, X)',
    g.L === 't:line' && g.TR === 't:trim' && g.E === 't:del' && g.F === 't:fillet' && g.CHA === 't:chamfer' && g.X === 't:explode',
    JSON.stringify({ L: g.L, TR: g.TR, E: g.E, F: g.F, CHA: g.CHA, X: g.X }));
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
  await ev(() => document.querySelector('#cmdBtns [data-cmd-help]').click());
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
  ok('8b liste İKİ bölüm: AutoCAD komutu ve uygulamaya özgü', d.acik && d.basliklar.length === 2 && /AutoCAD/.test(d.basliklar[0]) && d.tablolar.length === 2 && d.tablolar[0] > 50, JSON.stringify({ b: d.basliklar, t: d.tablolar }));
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

ok('10 sayfa hatası yok', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); await srv.kill();
C.summary(); C.exit();
