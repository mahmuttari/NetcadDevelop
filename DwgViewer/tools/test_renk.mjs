/*
 * RENK İNDEKSİ: KATMANDAN (ByLayer, 256) · BLOKTAN (ByBlock, 0) · AÇIK ACI (1-255)
 *
 * Kullanıcı bildirimi (v7.92): "Renk seçeneğinde KATMANDAN seçildiğinde katman rengi gelmiyor."
 * İki ayrı kusur vardı ve ikisi de burada kilitlenir:
 *
 *   1. edit.js entToPrim renk çözümleyicisi 256'yı hiç ele almıyordu. ACI tablosu 256 uzunluktadır
 *      (ACI[256] YOKTUR), `256 >= 1 && 256 <= 255` yanlış olduğu için renk sessizce FG'ye düşüyordu.
 *      Kusur nesne ent'inden her yeniden kurulduğunda (yapıştırma, blok açılımı, replace, patlatma)
 *      geri geliyor, yani "Katmandan" seçilen nesne katman rengini DEĞİL ön plan rengini alıyordu.
 *   2. Renk karosu (editor.colorSwatches) KATMANDAN'ı `background: transparent` çiziyordu: kullanıcı
 *      hangi rengin geleceğini seçmeden de seçtikten sonra da göremiyordu.
 *
 * Buradaki denetimler saf karardan (scene.resolveColor) ekrandaki karoya ve yazılan DXF'e kadar
 * bütün zinciri sınar. Sayılar elle hesaplanmıştır: ACI[1] = 0xff0000, ACI[3] = 0x00ff00.
 *
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_renk.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE } from './harness.mjs';

const { samples: SM } = args(import.meta.url);
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

// ---- A) SAF KARAR: normCi / resolveColor ----------------------------------------------------
{
  const r = await ev(async () => {
    const S = await import('./scene.js');
    const n = S.normCi;
    return {
      norm: [n(null), n(undefined), n(-1), n(0), n(1), n(255), n(256), n(300), n(-7)],
      byLayer: [S.isByLayer(null), S.isByLayer(-1), S.isByLayer(256), S.isByLayer(0), S.isByLayer(3)],
      // katman rengi KIRMIZI (0xff0000), blok bağlamı YEŞİL (0x00ff00)
      coz: {
        katmandan: S.resolveColor(256, 0xff0000),
        eksiBir: S.resolveColor(-1, 0xff0000),
        bos: S.resolveColor(null, 0xff0000),
        acik: S.resolveColor(3, 0xff0000),
        bloktan: S.resolveColor(0, 0xff0000, 0x00ff00),
        bloktanBagsiz: S.resolveColor(0, 0xff0000),
        katmansiz: S.resolveColor(256, null),
        taskin: S.resolveColor(999, 0xff0000),
      },
      FG: S.FG, ACI3: S.ACI[3], ACI256: S.ACI[256],
    };
  });
  ok('A1 normCi üç meşru değere indirger: null/-1/256/taşkın → 256, 0 → 0, 1-255 aynen',
    JSON.stringify(r.norm) === JSON.stringify([256, 256, 256, 0, 1, 255, 256, 256, 256]), JSON.stringify(r.norm));
  ok('A2 isByLayer null ve -1 için de DOĞRU (eski "ci === 256" denetimleri bunları atlıyordu)',
    JSON.stringify(r.byLayer) === JSON.stringify([true, true, true, false, false]), JSON.stringify(r.byLayer));
  ok('A3 KATMANDAN katman rengini verir (kusurun kendisi: eskiden FG geliyordu)',
    r.coz.katmandan === 0xff0000 && r.coz.eksiBir === 0xff0000 && r.coz.bos === 0xff0000, JSON.stringify(r.coz));
  ok('A4 açık indis ACI tablosundan, taşkın indis KATMANDAN sayılır (ACI[999] dışarı sızmaz)',
    r.coz.acik === r.ACI3 && r.coz.taskin === 0xff0000, JSON.stringify([r.coz.acik, r.ACI3, r.coz.taskin]));
  ok('A5 BLOKTAN yerleştirmenin rengini alır, bağlam yoksa katmana düşer',
    r.coz.bloktan === 0x00ff00 && r.coz.bloktanBagsiz === 0xff0000, JSON.stringify(r.coz));
  ok('A6 katmanı olmayan nesne FG\'ye düşer; ACI[256] gerçekten YOKTUR',
    r.coz.katmansiz === r.FG && r.ACI256 === undefined, JSON.stringify([r.coz.katmansiz, r.FG, r.ACI256]));
}

// ---- B) İLKEL KURULUMU: entToPrim -----------------------------------------------------------
await openFile(page, `${SM}/test_tr.dxf`, { settle: 400 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); });
{
  const r = await ev(async () => {
    const E = await import('./edit.js');
    const S = await import('./scene.js');
    const layers = new Map([['KIRMIZI', { name: 'KIRMIZI', color: 0xff0000, lw: 25 }]]);
    const yap = (ci) => E.entToPrim({ type: 'LINE', id: 'x' + ci, layer: 'KIRMIZI', color: ci, pts: [[0, 0, 0], [10, 0, 0]] }, layers);
    const p256 = yap(256), pNull = yap(null), pEksi = yap(-1), p3 = yap(3), p0 = yap(0);
    return {
      col: { c256: p256.col, cNull: pNull.col, cEksi: pEksi.col, c3: p3.col, c0: p0.col },
      ci: { c256: p256.info.ci, cNull: pNull.info.ci, cEksi: pEksi.info.ci, c3: p3.info.ci, c0: p0.info.ci },
      ACI3: S.ACI[3], FG: S.FG,
    };
  });
  ok('B1 color 256 (KATMANDAN) ilkelin rengini KATMAN rengi yapar — bildirilen kusur kapandı',
    r.col.c256 === 0xff0000, `col=${r.col.c256} beklenen=${0xff0000}`);
  ok('B2 null ve -1 de KATMANDAN sayılır', r.col.cNull === 0xff0000 && r.col.cEksi === 0xff0000, JSON.stringify(r.col));
  ok('B3 açık indis ACI\'den gelir, BLOKTAN bağlamsızken katmana düşer',
    r.col.c3 === r.ACI3 && r.col.c0 === 0xff0000, JSON.stringify(r.col));
  ok('B4 saklanan ci NORMALİZE edilir: null ve -1 artık 256 olarak durur (aşağı akış denetimleri çalışsın)',
    r.ci.c256 === 256 && r.ci.cNull === 256 && r.ci.cEksi === 256 && r.ci.c3 === 3 && r.ci.c0 === 0, JSON.stringify(r.ci));
}

// ---- C) KATMAN RENGİ DEĞİŞİNCE ByLayer NESNELER TAKİP EDER ----------------------------------
{
  const r = await ev(async () => {
    const A = window.dwgApp, E = A.editor;
    E.doc.run({ op: 'layer', name: 'T_RENK', color: 1 });                   // KIRMIZI
    const id = 'renk_' + Date.now();
    E.doc.run({ op: 'add', ents: [{ type: 'LINE', id, layer: 'T_RENK', color: 256, pts: [[0, 0, 0], [10, 0, 0]] }] });
    const bul = () => A.state.prims.find(p => p.key === id);
    const once = bul() ? bul().col : null;
    E.doc.run({ op: 'layerprops', name: 'T_RENK', color: 3 });               // YEŞİL
    const sonra = bul() ? bul().col : null;
    const lay = A.state.layers.get('T_RENK');
    E.doc.run({ op: 'delete', keys: [id] });
    return { once, sonra, layRenk: lay ? lay.color : null };
  });
  ok('C1 KATMANDAN nesne katmanın rengiyle çizilir (kırmızı)', r.once === 0xff0000, String(r.once));
  ok('C2 katman rengi değişince nesne de değişir (yeşil)', r.sonra === 0x00ff00 && r.layRenk === 0x00ff00, JSON.stringify(r));
}

// ---- D) RENK KAROSU: KATMANDAN karosu katmanın rengiyle boyanır ------------------------------
{
  await ev(() => {
    const A = window.dwgApp, E = A.editor;
    if (!A.state.layers.has('T_KARO')) E.doc.run({ op: 'layer', name: 'T_KARO', color: 1 });
    E.curLayer = 'T_KARO'; E.curColor = 256;
  });
  await ev(() => window.dwgApp.editor.act('color'));
  await page.waitForTimeout(250);
  const r = await ev(() => {
    const b = document.querySelector('#docBody .swatches [data-ci="256"]');
    if (!b) return null;
    const st = getComputedStyle(b);
    return { bg: st.backgroundColor, metin: b.textContent.trim(), baslik: b.getAttribute('title') || '', sinif: b.className };
  });
  await ev(() => { const p = document.getElementById('docPanel'); if (p) p.hidden = true; });
  ok('D1 KATMANDAN karosu SAYDAM değil, katmanın gerçek rengiyle boyanır (kırmızı)',
    !!r && /rgba?\(\s*255,\s*0,\s*0/.test(r.bg), JSON.stringify(r));
  ok('D2 karo "K" harfini ve katman adını korur (açık bir ACI ile karışmasın)',
    !!r && r.metin === 'K' && /T_KARO/.test(r.baslik) && /bylayer/.test(r.sinif), JSON.stringify(r));
}

// ---- E) DXF YAZIMI: 62 kodu nesnenin KENDİ indeksinden gelir ---------------------------------
{
  const r = await ev(async () => {
    const A = window.dwgApp, E = A.editor;
    const G = await import('./edit.js');
    // Katman rengi KIRMIZI; üç nesne: KATMANDAN · aynı rengin AÇIK indeksi (1) · BLOKTAN
    if (!A.state.layers.has('T_DXF')) E.doc.run({ op: 'layer', name: 'T_DXF', color: 1 });
    const ids = ['dxf_bl_' + Date.now(), 'dxf_ac_' + Date.now(), 'dxf_bb_' + Date.now()];
    E.doc.run({ op: 'add', ents: [
      { type: 'LINE', id: ids[0], layer: 'T_DXF', color: 256, pts: [[0, 0, 0], [1, 0, 0]] },
      { type: 'LINE', id: ids[1], layer: 'T_DXF', color: 1, pts: [[0, 1, 0], [1, 1, 0]] },
      { type: 'LINE', id: ids[2], layer: 'T_DXF', color: 0, pts: [[0, 2, 0], [1, 2, 0]] },
    ] });
    const prims = ids.map(k => A.state.prims.find(p => p.key === k));
    const dxf = G.writeDxf(prims, A.state.layers, { ltypes: A.state.ltypes, blocks: A.state.blocks });
    // her LINE bloğunun 62 kodunu ayıkla
    const sat = dxf.split(/\r?\n/);
    const blok = [];
    for (let i = 0; i < sat.length; i++) {
      if (sat[i].trim() !== '0' || sat[i + 1].trim() !== 'LINE') continue;
      let ci = null;
      for (let j = i + 2; j < sat.length && sat[j].trim() !== '0'; j += 2) if (sat[j].trim() === '62') ci = Number(sat[j + 1]);
      blok.push(ci);
    }
    E.doc.run({ op: 'delete', keys: ids });
    return { blok, n: prims.filter(Boolean).length };
  });
  ok('E1 üç nesne de yazıldı', r.n === 3, JSON.stringify(r));
  ok('E2 KATMANDAN → 62 HİÇ yazılmaz (null); AÇIK indis katman rengiyle aynı olsa bile KORUNUR (1); BLOKTAN → 62 = 0',
    JSON.stringify(r.blok) === JSON.stringify([null, 1, 0]), JSON.stringify(r.blok));
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
