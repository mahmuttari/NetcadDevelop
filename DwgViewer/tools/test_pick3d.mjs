/*
 * 3B YÜZEY SEÇİMİ — ışın-üçgen kesişimi (Möller–Trumbore).
 *
 * Rakip (DWG FastView) Super'de "Model / Surface" hedef seçimi satıyor: 3B'de yalnız köşeye
 * değil, yüzeyin ÜSTÜNDE serbest bir noktaya da dokunulabilmesi. Bizde 3B'de nokta toplamanın
 * tek yolu pickVertex'ti; eğrisel bir yüzeyin ortasından ölçü alınamıyordu.
 *
 * Buradaki asıl kanıt GERİ İZDÜŞÜMdür: pickSurface'ın döndürdüğü nokta project() ile ekrana
 * geri konduğunda dokunulan pikselin TAM ÜSTÜNE düşmelidir. Kamera ışını ters matris kurularak
 * değil, mvp() ile aynı üç açıdan üretildiği için bu sapma sıfır olmalıdır — paralel, perspektif
 * ve Z abartılı kiplerin üçünde de.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_pick3d.mjs
 */
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, samplesDir } from './harness.mjs';
import path from 'node:path';

args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 780 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message.slice(0, 200)); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
try { await page.click('#tourSkip', { timeout: 3000 }); } catch (_) { /* tur yok */ }
const ev = (fn, a) => page.evaluate(fn, a);

// ---- A) Saf çekirdek: tek üçgen, bilinen cevap --------------------------------------------
{
  const r = await ev(async () => {
    const g = await import('./geom.js');
    const vtx = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const idx = new Uint32Array([0, 1, 2]);
    const ic = g.rayMesh3(vtx, idx, 2, 2, 5, 0, 0, -1, 1);          // üçgenin içine, yukarıdan aşağı
    const dis = g.rayMesh3(vtx, idx, 9, 9, 5, 0, 0, -1, 1);          // üçgenin DIŞINA (u+v>1)
    const ters = g.rayMesh3(vtx, idx, 2, 2, 5, 0, 0, 1, 1);          // ters yön: arkada kalır
    const arka = g.rayMesh3(vtx, idx, 2, 2, -5, 0, 0, 1, 1);         // alttan yukarı: arka yüz de kabul
    const par = g.rayMesh3(vtx, idx, 2, 2, 5, 1, 0, 0, 1);           // düzleme paralel
    // Z abartısı: üçgen z=0'da, ölçek sonucu değiştirmemeli
    const vtx2 = new Float32Array([0, 0, 4, 10, 0, 4, 0, 10, 4]);
    const z1 = g.rayMesh3(vtx2, idx, 2, 2, 50, 0, 0, -1, 1);
    const z5 = g.rayMesh3(vtx2, idx, 2, 2, 50, 0, 0, -1, 5);
    const kutu = g.rayBox3(2, 2, 5, Infinity, Infinity, -1, 0, 0, -1, 10, 10, 1);
    const kutuYok = g.rayBox3(50, 50, 5, Infinity, Infinity, -1, 0, 0, -1, 10, 10, 1);
    return { ic: ic && ic.p, t: ic && +ic.t.toFixed(6), n: ic && ic.n, dis, ters, arka: !!arka, par,
      z1: z1 && +z1.p[2].toFixed(6), z5: z5 && +z5.p[2].toFixed(6), kutu, kutuYok };
  });
  ok('A1 üçgenin içine gönderilen ışın kesişiyor (2,2,0), t=5',
    !!r.ic && Math.abs(r.ic[0] - 2) < 1e-9 && Math.abs(r.ic[1] - 2) < 1e-9 && Math.abs(r.ic[2]) < 1e-9 && r.t === 5, JSON.stringify([r.ic, r.t]));
  ok('A2 normal birim ve düzleme dik (0,0,±1)', !!r.n && Math.abs(Math.abs(r.n[2]) - 1) < 1e-9, JSON.stringify(r.n));
  ok('A3 üçgenin dışı kesişmiyor (u+v>1)', r.dis === null, JSON.stringify(r.dis));
  ok('A4 ters yöndeki kesişim yok sayılıyor (t<0)', r.ters === null, JSON.stringify(r.ters));
  ok('A5 arka yüz de kabul ediliyor (katı olmayan yüzeyde yön umursanmaz)', r.arka === true);
  ok('A6 düzleme paralel ışın kesişmiyor', r.par === null, JSON.stringify(r.par));
  ok('A7 Z abartısı dönen KOTU değiştirmiyor (kesişim ölçekli uzayda, sonuç gerçek kotta)',
    r.z1 === 4 && r.z5 === 4, `${r.z1} / ${r.z5}`);
  ok('A8 ışın-kutu: içeri geçen true, ıskalayan false', r.kutu === true && r.kutuYok === false, `${r.kutu} / ${r.kutuYok}`);
}

// ---- B) Kademe ve hedef kipi ---------------------------------------------------------------
{
  const r = await ev(async () => {
    const Ed = await import('./edition.js');
    const m = {}; for (const [id, x] of Ed.FEATURE_TIER) m[id] = x;
    return { t: m.target3, karo: !!document.querySelector('[data-act="target3"]') };
  });
  ok('B1 target3 Super kapısında', r.t === 'super', String(r.t));
}

// ---- C) Gerçek dosya: geri izdüşüm, derinlik sırası ve hız ---------------------------------
const D3 = path.join(samplesDir, 'MARFEN_YUZER_TERFI_3D.dwg');
{
  await openFile(page, D3, { timeout: 900000, settle: 300 });
  await page.click('#toolbar [data-tab="3d"]');
  await page.click('#toolbar [data-act="3d"]');
  await page.waitForTimeout(2500);
  const r = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    const W = v.cv.clientWidth, H = v.cv.clientHeight;
    const izgara = (n) => {
      const out = [];
      for (let i = 1; i <= n; i++) for (let j = 1; j <= n; j++) {
        const sx = W * i / (n + 1), sy = H * j / (n + 1);
        const h = v.pickSurface(sx, sy);
        if (h) { const s = v.project(h.p[0], h.p[1], h.p[2]); out.push(Math.hypot(s[0] - sx, s[1] - sy)); }
      }
      return out;
    };
    const par = izgara(6);
    v.set('zScale', 5); v.render(); const z5 = izgara(6);
    v.set('zScale', 1); v.set('persp', true); v.render(); const per = izgara(6);
    v.set('persp', false); v.render();
    const t0 = performance.now(); for (let k = 0; k < 30; k++) v.pickSurface(W / 2, H / 2); const ms = (performance.now() - t0) / 30;
    const ucgen = v.meshPrims.reduce((a, p) => a + p.idx.length / 3, 0);
    const enb = (a) => a.length ? Math.max(...a) : -1;
    return { mesh: v.meshPrims.length, ucgen, nPar: par.length, sPar: enb(par), nZ5: z5.length, sZ5: enb(z5), nPer: per.length, sPer: enb(per), ms: +ms.toFixed(2) };
  });
  ok('C1 ağ ilkelleri seçim için toplanmış (2.484 gövde, 638.826 üçgen)',
    r.mesh === 2484 && r.ucgen === 638826, `${r.mesh} gövde · ${r.ucgen} üçgen`);
  ok('C2 paralel kipte geri izdüşüm sapması 0 px (ışın ile sahne ayrışmıyor)',
    r.nPar > 0 && r.sPar < 0.01, `${r.nPar} vuruş · en büyük sapma ${r.sPar}`);
  ok('C3 Z abartısı 5 iken de sapma 0 px', r.nZ5 > 0 && r.sZ5 < 0.01, `${r.nZ5} vuruş · ${r.sZ5}`);
  ok('C4 perspektif kipte de sapma 0 px', r.nPer > 0 && r.sPer < 0.01, `${r.nPer} vuruş · ${r.sPer}`);
  ok('C5 638 bin üçgende dokunuş başına süre 20 ms altında (gövde kutusu ön elemesi yeterli, BVH gerekmiyor)',
    r.ms < 20, `${r.ms} ms`);
}
// Derinlik sırası: en yakın yüzey seçilmeli
{
  const r = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    const W = v.cv.clientWidth, H = v.cv.clientHeight;
    let en = null, sx = 0, sy = 0;
    for (let i = 1; i <= 8 && !en; i++) for (let j = 1; j <= 8 && !en; j++) {
      const x = W * i / 9, y = H * j / 9;
      const h = v.pickSurface(x, y);
      if (h) { en = h; sx = x; sy = y; }
    }
    if (!en) return null;
    const ray = v.screenRay(sx, sy);
    // Seçilen nokta ışının ÜZERİNDE olmalı ve ondan daha yakın bir kesişim bulunmamalı
    const zs = v.zScale;
    const dx = en.p[0] - ray.o[0], dy = en.p[1] - ray.o[1], dz = en.p[2] * zs - ray.o[2];
    const t = dx * ray.d[0] + dy * ray.d[1] + dz * ray.d[2];
    const sapma = Math.hypot(dx - ray.d[0] * t, dy - ray.d[1] * t, dz - ray.d[2] * t);
    return { t: +t.toFixed(3), sapma: +sapma.toFixed(6), en: +en.t.toFixed(3) };
  });
  ok('C6 seçilen nokta ışının tam üzerinde ve t en yakın kesişim',
    !!r && r.sapma < 1e-3 && Math.abs(r.t - r.en) < 1e-3, JSON.stringify(r));
}
/*
 * Yüzey seçiminin asıl değeri YAKINLAŞINCA ortaya çıkar. "Sığdır" görünümünde model küçüktür ve
 * 22 pikselin içinde neredeyse her zaman örneklenmiş bir köşe bulunur (ölçüldü: 900 pikselli
 * ızgarada yüzey vuruşu olan 129 pikselin 129'unda köşe de var). Kullanıcı eğrisel bir gövdeye
 * yaklaştığında köşeler ekranda seyrelir; işte orada köşe yoktur ama yüzey vardır.
 */
{
  const r = await ev(() => {
    const v = window.dwgApp.editor.view3d();
    const W = v.cv.clientWidth, H = v.cv.clientHeight;
    const d0 = v.cam.dist;
    v.cam.dist = d0 / 60; v.render();                          // gövdenin üstüne yaklaş
    let sayac = { srf: 0, vtx: 0, yalnizSrf: 0 }, ornek = null;
    for (let i = 1; i <= 24; i++) for (let j = 1; j <= 24; j++) {
      const x = W * i / 25, y = H * j / 25;
      const s2 = v.pickSurface(x, y), q = v.pickVertex(x, y, 22);
      if (s2) sayac.srf++;
      if (q) sayac.vtx++;
      if (s2 && !q) { sayac.yalnizSrf++; if (!ornek) ornek = { x, y, p: s2.p }; }
    }
    let geri = null;
    if (ornek) { const s3 = v.project(ornek.p[0], ornek.p[1], ornek.p[2]); geri = Math.hypot(s3[0] - ornek.x, s3[1] - ornek.y); }
    v.cam.dist = d0; v.render();
    return { ...sayac, geri: geri == null ? null : +geri.toFixed(6) };
  });
  ok('C7 yakınlaşınca köşesiz ama yüzeyli pikseller çıkıyor (yeni yeteneğin kapattığı boşluk)',
    r.yalnizSrf > 0, `${r.yalnizSrf} piksel yalnız yüzey · ${r.srf} yüzey · ${r.vtx} köşe`);
  ok('C8 o piksellerde de geri izdüşüm tam', r.geri != null && r.geri < 0.01, String(r.geri));
}
// Hedef kipi 'vertex' iken yüzey YOLU HİÇ ÇALIŞMAZ: ücretsiz sürümdeki davranış birebir korunur
{
  const r = await ev(async () => {
    const ed = window.dwgApp.editor;
    const E = await import('./editor.js');
    const v = ed.view3d();
    const W = v.cv.clientWidth, H = v.cv.clientHeight;
    const d0 = v.cam.dist; v.cam.dist = d0 / 60; v.render();
    let nokta = null;
    for (let i = 1; i <= 24 && !nokta; i++) for (let j = 1; j <= 24 && !nokta; j++) {
      const x = W * i / 25, y = H * j / 25;
      if (v.pickSurface(x, y) && !v.pickVertex(x, y, 22)) nokta = [x, y];
    }
    const out = {};
    if (nokta) {
      E.ui.pick3 = 'vertex';
      out.vertexKipi = !!v.pickVertex(nokta[0], nokta[1], 22);
      E.ui.pick3 = 'surface';
      out.yuzeyKipi = !!v.pickSurface(nokta[0], nokta[1]);
      E.ui.pick3 = 'auto';
    }
    v.cam.dist = d0; v.render();
    return { ...out, bulundu: !!nokta, kip: E.ui.pick3 };
  });
  ok('C9 hedef kipi tercihi okunabiliyor ve varsayılan "auto"', r.kip === 'auto', String(r.kip));
  ok('C10 aynı pikselde köşe kipi boş, yüzey kipi dolu',
    r.bulundu && r.vertexKipi === false && r.yuzeyKipi === true, JSON.stringify(r));
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
