// DGN'in UÇTAN UCA açılması: dosya seçiciden gerçek baytlarla girer, işçi çözümler, sahne kurulur.
// Çözümleyicinin kendi sınaması tools/test_dgn.mjs'tedir; buradaki soru "boru hattı DGN'i tanıyor mu".
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_dgn_acma.mjs [çıktı]
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import { ornekDgn, dosya, tcb } from './dgn_ornek.mjs';
import fs from 'node:fs';
import path from 'node:path';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;

const dgnYol = path.join(out, 'ornek_plan.dgn');
fs.writeFileSync(dgnYol, Buffer.from(ornekDgn()));
// V8 benzeri dosya: OLE imzası + kökte "Dgn~H" — açılmamalı, açık ileti vermeli
const v8 = Buffer.alloc(2048);
Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(v8, 0);
for (const [i, ch] of [...'Dgn~H'].entries()) { v8[512 + i * 2] = ch.charCodeAt(0); v8[512 + i * 2 + 1] = 0; }
const v8Yol = path.join(out, 'v8_plan.dgn');
fs.writeFileSync(v8Yol, v8);

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
onDialog(page);
await page.goto(srv.url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.dwgApp, null, { timeout: 60000 });
const ev = (fn, arg) => page.evaluate(fn, arg);

// (1) belge merkezi .dgn'i çizim (cad) sayıyor
{
  const r = await ev(async () => { const D = await import('./docs.js'); return { kind: D.kindOf('plan.dgn'), cad: D.isCad('plan.DGN'), simge: D.iconFor('plan.dgn') }; });
  ok('1  .dgn uzantısı "cad" türünde ve çizim simgesini alıyor', r.kind === 'cad' && r.cad === true && /i-pline/.test(r.simge), JSON.stringify(r));
}

// (2) dosya seçiciden açılır
await openFile(page, dgnYol, { settle: 400 });
{
  const r = await ev(() => {
    const s = window.dwgApp.state;
    const türler = {};
    for (const p of s.prims) { const t = p.info && p.info.t; if (t) türler[t] = (türler[t] || 0) + 1; }
    return { ad: s.fileName, sürüm: s.version, birim: s.units, n: s.prims.length, katman: s.layers.size, türler, ext: s.ext };
  });
  ok('2a  DGN açıldı ve ilkeller üretildi', r.n > 0, JSON.stringify(r).slice(0, 200));
  ok('2b  sürüm rozeti DGN diyor', /^DGN/.test(r.sürüm || ''), r.sürüm);
  ok('2c  birim metre olarak okundu', r.birim === 'm', String(r.birim));
  ok('2d  seviyeler katman listesine geçti', r.katman >= 6, String(r.katman));
  ok('2e  çizgi, çokgen, daire, yay ve yazı geldi',
    r.türler.LINE >= 1 && r.türler.LWPOLYLINE >= 2 && r.türler.CIRCLE >= 1 && r.türler.ARC >= 1 && r.türler.TEXT >= 1, JSON.stringify(r.türler));
  ok('2f  dolgu taraması geldi', (r.türler.HATCH || 0) >= 1, JSON.stringify(r.türler));
  ok('2g  çizim sınırları metre ölçeğinde', r.ext && r.ext[2] > 30 && r.ext[2] < 100, JSON.stringify((r.ext || []).map(v => Math.round(v))));
}

// (3) yazı windows-1254 ile çözüldü (Türkçe harfler bozulmadı)
{
  const r = await ev(() => window.dwgApp.state.prims.filter(p => p.k === 1).map(p => (p.lines || [p.text]).join('')));
  ok('3  Türkçe yazı bozulmadan geldi', r.some(t => t === 'ÇİZİM'), JSON.stringify(r).slice(0, 120));
}

// (4) DGN düzenlenebilir: bir nesne seçilip silinebiliyor (DXF yolundan farksız)
{
  const r = await ev(() => {
    const a = window.dwgApp, ed = a.editor;
    const p = a.state.prims.find(q => q.info && q.info.t === 'LINE');
    if (!p) return { yok: true };
    const once = a.state.prims.length;
    ed.sel.clear(); ed.sel.add(p); ed.selAction('del');
    return { once, sonra: a.state.prims.length };
  });
  ok('4  DGN nesnesi seçilip silinebiliyor (DXF yolundan farksız)', !r.yok && r.sonra === r.once - 1, JSON.stringify(r));
}

// (5) V8 dosyası açık iletiyle reddedilir (sessiz boş çizim değil)
{
  await page.evaluate(() => { window.__toastlar = []; });
  await page.setInputFiles('#fileInput', v8Yol);
  await page.waitForTimeout(3000);
  const r = await ev(() => {
    const el = document.getElementById('toast');
    return { metin: (el && el.textContent) || '', gövde: document.body.innerText.slice(0, 4000) };
  });
  const hepsi = r.metin + ' ' + r.gövde;
  ok('5  V8 DGN için "V8 / V7 olarak kaydedin" iletisi', /V8/.test(hepsi) && /V7/.test(hepsi), hepsi.replace(/\s+/g, ' ').slice(0, 160));
}

ok('6  sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
C.exit();
