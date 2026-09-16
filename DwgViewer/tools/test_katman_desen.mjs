/*
 * KATMAN DÜZENLEME + GERÇEK TARAMA DESENİ.
 *
 * İki eksik, ikisi de rakipte (DWG FastView) var:
 *   · Katman paneli yalnız görünürlük ve izolasyon yapıyordu; katmanın ADI, rengi, çizgi tipi,
 *     kalınlığı, dondurma ve kilit durumu değiştirilemiyor, katman silinemiyordu.
 *   · Çizilen tarama yalnız DÜZ DOLGU üretiyordu (commitMany HATCH, alpha 1); ANSI31 gibi
 *     gerçek desenler yoktu — oysa okuma tarafı desenleri zaten çiziyordu.
 *
 * Buradaki asıl kural TEK TANIM, TEK ÇİZİCİdir: DWG/DXF'ten okunan tarama ile bizim
 * ürettiğimiz tarama AYNI koddan (geom.hatchLines) geçmelidir. İkisi ayrı olsaydı zamanla
 * ayrışır ve aynı desen okunurken başka, çizilirken başka görünürdü.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_katman_desen.mjs
 */
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, queueAnswers, samplesDir } from './harness.mjs';
import path from 'node:path';

args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message.slice(0, 200)); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
try { await page.click('#tourSkip', { timeout: 3000 }); } catch (_) { /* tur yok */ }
const ev = (fn, a) => page.evaluate(fn, a);

// ---- A) Desen tanımı ve çizici -------------------------------------------------------------
{
  const r = await ev(async () => {
    const G = await import('./geom.js');
    const A = await import('./annot.js');
    const kare = [[0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0]];
    const d0 = G.patternDefs('ANSI31', 10, 0);
    const d45 = G.patternDefs('ANSI31', 10, 45);
    const d1 = G.patternDefs('ANSI31', 1, 0);
    return {
      adlar: Object.keys(G.HATCH_PATTERNS),
      aci0: +(d0[0].angle * 180 / Math.PI).toFixed(3),
      aci45: +(d45[0].angle * 180 / Math.PI).toFixed(3),
      adim10: +Math.hypot(d0[0].offset.x, d0[0].offset.y).toFixed(6),
      adim1: +Math.hypot(d1[0].offset.x, d1[0].offset.y).toFixed(6),
      net: G.patternDefs('NET', 1, 0).length,
      solid: G.patternDefs('SOLID', 1, 0).length,
      bilinmeyen: G.patternDefs('YOKBOYLE', 1, 0).length,
      cizgi: (() => { const h = G.hatchLines([kare.map(p => [p[0], p[1]])], d0, {}); return h ? { segs: h.segs, ops: h.ops.length, step: +h.minStep.toFixed(4) } : null; })(),
      butce: G.hatchLines([kare.map(p => [p[0], p[1]])], G.patternDefs('ANSI31', 0.001, 0), { maxSeg: 50 }),
      solidEnt: (() => { const x = A.hatchEnts(kare, { pattern: 'SOLID' }); return x && { n: x.ents.length, t: x.ents.map(e => e.type).join(','), p: x.pattern }; })(),
      ansiEnt: (() => { const x = A.hatchEnts(kare, { pattern: 'ANSI31', scale: 10 }); return x && { n: x.ents.length, t: x.ents.map(e => e.type).join(','), p: x.pattern, hpart: !!x.ents[1].hpart, hp: +x.ents[1].hp.toFixed(4) }; })(),
      dusus: (() => { const x = A.hatchEnts(kare, { pattern: 'YOKBOYLE' }); return x && x.pattern; })(),
    };
  });
  ok('A1 desen tablosu SOLID ve ANSI31 dâhil birden çok desen taşıyor',
    r.adlar.includes('SOLID') && r.adlar.includes('ANSI31') && r.adlar.length >= 8, r.adlar.join(' '));
  ok('A2 ölçek adımı doğrusal ölçekliyor (0,125 → ×1 = 0,125 · ×10 = 1,25)',
    Math.abs(r.adim1 - 0.125) < 1e-6 && Math.abs(r.adim10 - 1.25) < 1e-6, `${r.adim1} / ${r.adim10}`);
  ok('A3 açı hem satırın kendi açısına hem kullanıcı açısına bakıyor (45° + 45° = 90°)',
    r.aci0 === 45 && r.aci45 === 90, `${r.aci0} / ${r.aci45}`);
  ok('A4 NET iki çizgi ailesi, SOLID sıfır, bilinmeyen desen sıfır',
    r.net === 2 && r.solid === 0 && r.bilinmeyen === 0, `${r.net} / ${r.solid} / ${r.bilinmeyen}`);
  // minStep ötelemenin BOYU değil, çizgiler arası DİK aralıktır. ANSI31'in çizgileri 45°'dir ve
  // .pat ötelemesi eksenler boyunca (0 · 0,125) verilir; dik aralık 0,125/√2'dir. Ölçek 10'da
  // 1,25/√2 = 0,8839. (test_io:45'teki "ANSI31 -0,7071" değeri de aynı kökten gelir.)
  ok('A5 çizici parça üretiyor ve DİK adımı bildiriyor (LOD dolgusu bunu okur)',
    !!r.cizgi && r.cizgi.segs > 10 && r.cizgi.ops === r.cizgi.segs * 2 && Math.abs(r.cizgi.step - 1.25 / Math.SQRT2) < 1e-3, JSON.stringify(r.cizgi));
  ok('A6 bütçe aşılınca null döner (sonsuz desen telefonu kilitlemez)', r.butce === null, JSON.stringify(r.butce));
  ok('A7 SOLID tek varlık, desenli tarama İKİ varlık (sınır + desen çizgileri)',
    r.solidEnt.n === 1 && r.solidEnt.t === 'HATCH' && r.ansiEnt.n === 2 && r.ansiEnt.t === 'HATCH,PATH', JSON.stringify([r.solidEnt, r.ansiEnt]));
  ok('A8 desen çizgileri hpart bayrağı taşıyor (DXF\'e ayrıca LWPOLYLINE olarak yazılmasın)',
    r.ansiEnt.hpart === true && Math.abs(r.ansiEnt.hp - 1.25 / Math.SQRT2) < 1e-3, JSON.stringify(r.ansiEnt));
  ok('A9 bilinmeyen desen SOLID\'e düşüyor (kullanıcı boş sonuçla karşılaşmaz)', r.dusus === 'SOLID', String(r.dusus));
}

// ---- B) Tek tanım tek çizici: okuma yolu da aynı çiziciyi kullanıyor -----------------------
{
  const r = await ev(async () => {
    const sc = await import('./scene.js');
    const g = await import('./geom.js');
    return { sceneKullaniyor: String(sc.SceneBuilder.prototype.hatchPattern).includes('hatchLines'), geomVar: typeof g.hatchLines === 'function' };
  });
  ok('B1 sahne çizicisi geom.hatchLines\'ı çağırıyor (ikinci bir desen çizici yok)',
    r.sceneKullaniyor === true && r.geomVar === true, JSON.stringify(r));
}

// ---- C) Katman düzenleme --------------------------------------------------------------------
await openFile(page, path.join(samplesDir, 'test_tr.dxf'));
{
  const r = await ev(async () => {
    const Ed = await import('./edition.js');
    const m = {}; for (const [id, x] of Ed.FEATURE_TIER) m[id] = x;
    return { layeredit: m.layeredit, hatchpat: m.hatchpat };
  });
  ok('C1 katman düzenleme ve desen seçici Premium kapısında',
    r.layeredit === 'premium' && r.hatchpat === 'premium', JSON.stringify(r));
}
{
  // Yeniden adlandırma: nesnelerin p.lay alanı da güncellenmeli, geri alma eski adı döndürmeli
  const r = await ev(() => {
    const app = window.dwgApp, S = app.state, ed = app.editor;
    const ad = [...S.layers.keys()].find(k => k !== '0' && S.prims.some(p => p.lay === k));
    if (!ad) return null;
    const once = S.prims.filter(p => p.lay === ad).length;
    const ok1 = ed.runCmd({ op: 'layerprops', name: ad, newName: ad + '_YENI', color: 1 });
    const sonra = S.prims.filter(p => p.lay === ad + '_YENI').length;
    const renk = S.layers.get(ad + '_YENI') ? S.layers.get(ad + '_YENI').color : null;
    ed.doc.undo();
    const geri = S.prims.filter(p => p.lay === ad).length;
    return { ad, ok1, once, sonra, geri, renk, varYeni: S.layers.has(ad + '_YENI'), varEski: S.layers.has(ad) };
  });
  ok('C2 katman yeniden adlandırıldı ve nesneler yeni adı aldı',
    !!r && r.ok1 && r.sonra === r.once && r.once > 0, JSON.stringify(r));
  ok('C3 renk de değişti (ACI 1 = kırmızı)', !!r && r.renk === 0xff0000, r && ('0x' + (r.renk || 0).toString(16)));
  ok('C4 geri alma eski adı ve nesneleri döndürdü',
    !!r && r.geri === r.once && r.varEski === true && r.varYeni === false, JSON.stringify(r));
}
{
  // '0' katmanı korunuyor
  const r = await ev(() => {
    const ed = window.dwgApp.editor;
    return { ren: ed.runCmd({ op: 'layerprops', name: '0', newName: 'SIFIR' }), sil: ed.runCmd({ op: 'layerdel', name: '0' }) };
  });
  ok('C5 "0" katmanı yeniden adlandırılamıyor ve silinemiyor', r.ren === false && r.sil === false, JSON.stringify(r));
}
{
  // Silme: nesneler '0'a taşınır (varsayılan) · geri alma katmanı ve nesneleri döndürür
  const r = await ev(() => {
    const app = window.dwgApp, S = app.state, ed = app.editor;
    const ad = [...S.layers.keys()].find(k => k !== '0' && S.prims.some(p => p.lay === k));
    if (!ad) return null;
    const n = S.prims.filter(p => p.lay === ad).length;
    const toplam = S.prims.length;
    const ok1 = ed.runCmd({ op: 'layerdel', name: ad, mode: 'move' });
    const tasindi = S.prims.filter(p => p.lay === '0').length;
    const kalan = S.prims.length;
    ed.doc.undo();
    return { ad, n, ok1, kalan, toplam, geri: S.prims.filter(p => p.lay === ad).length, varMi: S.layers.has(ad), tasindi };
  });
  ok('C6 katman silindi, nesneler "0"a taşındı (silinmediler)',
    !!r && r.ok1 && r.kalan === r.toplam, JSON.stringify(r));
  ok('C7 geri alma katmanı ve nesnelerin katmanını döndürdü',
    !!r && r.geri === r.n && r.varMi === true, JSON.stringify(r));
}
{
  // Silme 'ents' kipi: nesneler de gider, geri alma hepsini döndürür
  const r = await ev(() => {
    const app = window.dwgApp, S = app.state, ed = app.editor;
    const ad = [...S.layers.keys()].find(k => k !== '0' && S.prims.some(p => p.lay === k));
    if (!ad) return null;
    const n = S.prims.filter(p => p.lay === ad).length, toplam = S.prims.length;
    ed.runCmd({ op: 'layerdel', name: ad, mode: 'ents' });
    const sonra = S.prims.length;
    ed.doc.undo();
    return { n, toplam, sonra, geri: S.prims.length };
  });
  ok('C8 "birlikte sil" kipi nesneleri de siliyor', !!r && r.sonra === r.toplam - r.n && r.n > 0, JSON.stringify(r));
  ok('C9 geri alma silinen nesneleri geri koyuyor', !!r && r.geri === r.toplam, JSON.stringify(r));
}
{
  // DXF yazımı: kilitli katman 70 grubunun 4. bitiyle çıkar (dxf.js okurken zaten bu biti çözüyor)
  const r = await ev(async () => {
    const app = window.dwgApp, S = app.state, ed = app.editor;
    const E = await import('./edit.js');
    const ad = [...S.layers.keys()].find(k => k !== '0');
    ed.runCmd({ op: 'layerprops', name: ad, locked: true, frozen: false });
    const dxf = E.writeDxf(S.prims, S.layers, { ltypes: S.ltypes });
    ed.doc.undo();
    const sat = dxf.split(/\r?\n/);
    let kilit = false;
    for (let k = 0; k + 1 < sat.length; k++) {
      if (sat[k].trim() === '2' && sat[k + 1].trim() === ad) {
        for (let j2 = k; j2 < Math.min(k + 10, sat.length - 1); j2++) if (sat[j2].trim() === '70' && (Number(sat[j2 + 1]) & 4)) kilit = true;
      }
    }
    return { ad, kilit, n: sat.length };
  });
  ok('C10 kilitli katman DXF 70 grubunun 4. bitiyle yazılıyor', r.kilit === true, JSON.stringify(r));
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
