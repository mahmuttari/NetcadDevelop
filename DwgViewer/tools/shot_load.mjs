// Bekleme görsellerinin, iskeletlerin ve boş durum kartlarının ekran görüntüsü.
// Tasarımı gözle görmek içindir; sınama değildir.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/shot_load.mjs [çıktı]
import { args, startServer, launchBrowser, onDialog, noUpdate, PHONE } from './harness.mjs';
import fs from 'node:fs';
const { out } = args(import.meta.url);
fs.mkdirSync(out, { recursive: true });
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 760 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
onDialog(page, async d => { await d.accept(''); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');

// --- beş bekleme görseli, her biri koyu ve açık temada ---
const KIND = [['cad', 'Çizim çözümleniyor', 'plan.dwg · 12,4 MB', 42],
  ['doc', 'Belge açılıyor', 'rapor.pdf · 8 sayfa', null],
  ['out', 'PDF üretiliyor', 'A3 · 1/500', 68],
  ['d3', '3B sahne kuruluyor', '18.240 üçgen', null],
  ['cloud', 'İndiriliyor', 'K-12 paftası', 25]];
for (const th of ['dark', 'light']) {
  for (const [k, txt, sub, pct] of KIND) {
    await page.evaluate(([t, kind, text, s, p]) => {
      document.body.dataset.theme = t;
      const el = document.getElementById('loading');
      el.className = 'modal load-' + kind;
      el.hidden = false;
      document.getElementById('loadingText').textContent = text;
      document.getElementById('loadingSub').textContent = s;
      const prog = document.getElementById('loadingProg');
      prog.hidden = p == null;
      if (p != null) { document.getElementById('loadingFill').style.width = p + '%'; document.getElementById('loadingPct').textContent = '%' + p; }
    }, [th, k, txt, sub, pct]);
    await page.waitForTimeout(900);            // döngünün ortasına denk gelsin
    await page.locator('#loading').screenshot({ path: `${out}/load_${k}_${th}.png` });
    console.log('yazıldı', `load_${k}_${th}.png`);
  }
}
// --- durgun kip: her görselin hareketsiz hâli döngünün TAMAMLANMIŞ karesi olmalı ---
await page.evaluate(() => { document.body.dataset.theme = 'dark'; document.body.classList.add('reduce-motion'); });
for (const [k, txt, sub, pct] of KIND) {
  await page.evaluate(([kind, text, s, p]) => {
    const el = document.getElementById('loading');
    el.className = 'modal load-' + kind; el.hidden = false;
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingSub').textContent = s;
    const prog = document.getElementById('loadingProg');
    prog.hidden = p == null;
    if (p != null) { document.getElementById('loadingFill').style.width = p + '%'; document.getElementById('loadingPct').textContent = '%' + p; }
  }, [k, txt, sub, pct]);
  await page.waitForTimeout(400);
  await page.locator('.loadart').screenshot({ path: `${out}/still_${k}.png` });
  console.log('yazıldı', `still_${k}.png`);
}
await page.evaluate(() => { const el = document.getElementById('loading'); el.hidden = true; el.className = 'modal'; document.body.classList.remove('reduce-motion'); document.body.dataset.theme = 'dark'; });

// --- iskeletler ve boş durum kartları: kendi başına bir sayfada ---
const html = `<div style="padding:10px">
  <h3>skel-list</h3><div id="a"></div>
  <h3>skel-grid</h3><div id="b"></div>
  <h3>skel-doc</h3><div id="c"></div>
</div>`;
for (const th of ['dark', 'light']) {
  await page.evaluate(([t, h]) => {
    document.body.dataset.theme = t;
    let box = document.getElementById('shotBox');
    if (!box) { box = document.createElement('div'); box.id = 'shotBox'; box.style.cssText = 'position:absolute;inset:0;z-index:99;overflow:auto;background:var(--bg);color:var(--fg)'; document.getElementById('app').appendChild(box); }
    box.innerHTML = h;
    return import('./skel.js').then(S => {
      box.querySelector('#a').innerHTML = S.skelList(3);
      box.querySelector('#b').innerHTML = S.skelGrid(4);
      box.querySelector('#c').innerHTML = S.skelDoc(6);
    });
  }, [th, html]);
  await page.waitForTimeout(700);
  await page.locator('#shotBox').screenshot({ path: `${out}/skel_${th}.png` });
  console.log('yazıldı', `skel_${th}.png`);
}
for (const th of ['dark', 'light']) {
  await page.evaluate((t) => {
    document.body.dataset.theme = t;
    const box = document.getElementById('shotBox');
    return import('./skel.js').then(S => {
      box.innerHTML = S.emptyBox('cad', 'Son dosyalar', 'Henüz dosya açılmadı.', '<button class="btn primary small">Cihaz</button>')
        + S.emptyBox('search', 'Sonuç yok', 'Aradığınız ada uyan dosya yok; daha kısa bir parça yazmayı deneyin.')
        + S.emptyBox('folder', 'Klasör boş', 'Bu klasörde gösterilecek dosya yok.')
        + S.emptyBox('cloud', 'Çevrimdışı kopyalar', 'Çevrimdışı kopya yok.');
    });
  }, th);
  await page.waitForTimeout(400);
  await page.locator('#shotBox').screenshot({ path: `${out}/empty_${th}.png` });
  console.log('yazıldı', `empty_${th}.png`);
}
await browser.close(); srv.kill();
