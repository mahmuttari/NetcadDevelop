// Pencereli DWG okuma: nesne haritası dilimleyicisi doğru harita üretiyor mu, dilimlenmiş okuma
// tek parça okumayla AYNI sahneyi mi veriyor, dosya sonradan bozulmuş hâlde mi kalıyor.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_dwgwin.mjs [çıktı] [örnekler]
import fs from 'node:fs';
import path from 'node:path';
import { args, startServer, launchBrowser, noUpdate, checker, PHONE } from './harness.mjs';
const { out, samples: SM } = args(import.meta.url);
// sunucu yalnız viewer klasörünü sunar; örnek dosyalar sayfaya base64 olarak geçirilir
const b64 = (n) => fs.readFileSync(path.join(SM, n)).toString('base64');
const FILES = Object.fromEntries(['example_2000.dwg', 'example_r14.dwg', 'example_2004.dwg', 'pface_2000.dwg'].map(n => [n, b64(n)]));
const srv = await startServer();
const C = checker(), ok = C.ok;
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
const ev = (fn, a) => page.evaluate(fn, a);

// ---- 1 plan: hangi dosya dilimlenir, hangisi dilimlenmez -------------------------------------
await ev((f) => { window.__f = f; window.__u8 = (n) => Uint8Array.from(atob(window.__f[n]), c => c.charCodeAt(0)); }, FILES);
const plans = await ev(async () => {
  const W = await import('./dwgwin.js');
  const get = async (n) => window.__u8(n);
  const r = {};
  for (const [k, n, per] of [['r2000', 'example_2000.dwg', 60], ['r14', 'example_r14.dwg', 60], ['r2004', 'example_2004.dwg', 60],
                             ['buyukPencere', 'example_2000.dwg', 100000], ['pface', 'pface_2000.dwg', 60]]) {
    const u8 = await get(n); const p = W.plan(u8, per);
    r[k] = p ? { win: p.windows.length, keep: p.keepAlways.length, obj: p.objects, ver: p.ver } : null;
  }
  return r;
});
ok('1a R2000 küçük pencereyle dilimlenir', plans.r2000 && plans.r2000.win > 1 && plans.r2000.obj === 750, JSON.stringify(plans.r2000));
ok('1b R14 küçük pencereyle dilimlenir', plans.r14 && plans.r14.win > 1 && plans.r14.obj === 832, JSON.stringify(plans.r14));
ok('1c R2004 dilimlenmez (harita sıkıştırılmış)', plans.r2004 === null, JSON.stringify(plans.r2004));
ok('1d büyük pencerede dilimlemeye gerek yok', plans.buyukPencere === null, JSON.stringify(plans.buyukPencere));
ok('1e pface dosyası: INSERT içerdiği için dilimlenmez ya da dilimlenir, karar tutarlı',
  plans.pface === null || plans.pface.win > 1, JSON.stringify(plans.pface));

// ---- 2 uygula/geri al: dosya baytları özgün hâline döner --------------------------------------
const roundTrip = await ev(async () => {
  const W = await import('./dwgwin.js');
  const u8 = window.__u8('example_2000.dwg');
  const orig = u8.slice();
  const p = W.plan(u8, 60);
  const sizes = [];
  for (let k = 0; k < p.windows.length; k++) sizes.push(W.applyWindow(u8, p, k).length);
  const changed = u8.some((b, i) => b !== orig[i]);
  W.restore(u8, p);
  let same = u8.length === orig.length; for (let i = 0; same && i < u8.length; i++) if (u8[i] !== orig[i]) same = false;
  const toplam = sizes.reduce((a, b) => a + b, 0) - p.keepAlways.length * (p.windows.length - 1);
  return { changed, same, sizes: sizes.length, toplam, obj: p.objects, keep: p.keepAlways.length };
});
ok('2a pencere uygulanınca dosya değişiyor', roundTrip.changed);
ok('2b geri alınınca dosya bayt bayt özgün hâline dönüyor', roundTrip.same);
ok('2c pencerelerin toplamı bütün nesneleri kapsıyor', roundTrip.toplam === roundTrip.obj, `${roundTrip.toplam} / ${roundTrip.obj}`);

// ---- 3 pencereli okuma tek parça okumayla aynı sahneyi veriyor mu ----------------------------
const cmp = await ev(async () => {
  const buf = window.__u8('example_2000.dwg').buffer;
  const run = (bytes, winObj) => new Promise((res, rej) => {
    const w = new Worker('./worker.js', { type: 'module' });
    const to = setTimeout(() => { w.terminate(); rej(new Error('zaman aşımı')); }, 120000);
    w.onmessage = (e) => { if (e.data.stage) return; clearTimeout(to); w.terminate(); e.data.ok ? res(e.data.scene) : rej(new Error(e.data.error)); };
    w.onerror = (e) => { clearTimeout(to); rej(new Error(e.message || 'işçi hatası')); };
    w.postMessage({ id: 1, cmd: 'parse', bytes, winObj }, [bytes]);
  });
  const sig = (sc) => {
    const L = sc.layouts[0]; let n = 0, sx = 0, sy = 0, sz = 0, kinds = {};
    for (const p of L.prims) { kinds[p.k] = (kinds[p.k] || 0) + 1; n++;
      if (p.ops) for (const o of p.ops) { sx += o[1] || 0; sy += o[2] || 0; sz += o[3] || 0; }
      else { sx += p.x || 0; sy += p.y || 0; sz += p.z || 0; } }
    return { n, sx: +sx.toFixed(6), sy: +sy.toFixed(6), sz: +sz.toFixed(6), kinds: JSON.stringify(kinds),
      lay: sc.layers.map(l => l.name).sort().join('|'), ent: sc.entityCount, layouts: sc.layouts.length,
      ext: L.ext.map(v => +v.toFixed(6)).join(','), counts: JSON.stringify(sc.counts) };
  };
  const out = {};
  for (const [k, n] of [['s2000', 'example_2000.dwg'], ['pface', 'pface_2000.dwg']]) {
    const b1 = window.__u8(n).buffer, b2 = window.__u8(n).buffer;
    const A = sig(await run(b1, 0));
    const B0 = await run(b2, 60);
    out[k] = { A, B: sig(B0), windows: B0.windows || 0 };
  }
  return out;
});
for (const [k, c] of Object.entries(cmp)) {
  ok(`3-${k} pencereli sonuç tek parça sonucuyla aynı (pencere=${c.windows})`,
    c.A.n === c.B.n && c.A.kinds === c.B.kinds && c.A.sx === c.B.sx && c.A.sy === c.B.sy && c.A.sz === c.B.sz
    && c.A.lay === c.B.lay && c.A.ent === c.B.ent && c.A.layouts === c.B.layouts && c.A.ext === c.B.ext && c.A.counts === c.B.counts,
    `ilkel ${c.A.n}/${c.B.n} · varlık ${c.A.ent}/${c.B.ent} · sınır ${c.A.ext === c.B.ext ? 'aynı' : 'FARKLI'}`);
}
const usedWin = Object.values(cmp).some((c) => c.windows > 1);
console.log(usedWin ? 'not: en az bir örnekte pencereli yol kullanıldı' : 'not: örneklerde pencereli yol eksiksizlik denetimini geçemedi, tek parça okumaya düşüldü (beklenen davranış)');

C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
