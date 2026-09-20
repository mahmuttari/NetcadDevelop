/*
 * v7.68 — dizi ailesi: kutupsal dizinin merkezi DOKUNUŞLA, yol dizisi (ARRAYPATH: sayıyla / aralıkla, yola dönme,
 * kaynak dokunulan uca taşınır), doğrudan ARRAYRECT / ARRAYPOLAR / ARRAYPATH komutları, kat artımı (Z), ARRAY'in tür
 * sorusu, ARRAYCLASSIC / 3DARRAY eş anlamlıları, yetki (dizi türleri Dizi'nin basamağını taşır), saf yardımcılar.
 * Formlar sınama kancasıyla (window.__ask.queue) cevaplanır; sonuç çizimden (prims) okunur.
 * Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_dizi.mjs [çıktı] [örnekler]
 */
import { args, startServer, launchBrowser, openFile, onDialog, noUpdate, checker, PHONE, queueAnswers, askLog } from './harness.mjs';

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
const J = JSON.stringify, yak = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes([]); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const temizle = () => ev(() => { document.getElementById('toast').hidden = true; });
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const tapWorld = async (x, y) => { await bekle(110); await temizle(); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(420); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const aktif = () => ev(() => window.dwgApp.editor.tools.active);
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, step: T.step, selecting: T.selecting, text: document.getElementById('cmdText').textContent.trim(), sel: window.dwgApp.editor.sel.size }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const primOf = (key) => ev((k) => { const p = window.dwgApp.state.prims.find(q => q.key === k); return p ? { key: p.key, k: p.k, ops: p.ops ? p.ops.map(o => o.slice()) : null, bb: p.bb } : null; }, key);
const sonN = (n) => ev((m) => window.dwgApp.state.prims.slice(-m).map(p => ({ key: p.key, ops: p.ops.map(o => o.slice()) })), n);
const yaz = async (v) => { await page.fill('#cmdInput', v); await bekle(100); };
const enter = async () => { await page.click('#cmdEnter'); await bekle(220); };
const komut = async (s) => { await yaz(s); await enter(); };
const bitir = async () => { await page.click('#cmdBtns [data-cmd="finish"]'); await bekle(350); };
const ekle = (ents) => ev((es) => {
  const E = window.dwgApp.editor, S = window.dwgApp.state;
  const n0 = S.prims.length;
  const NID = () => 'T' + Math.random().toString(36).slice(2, 10);
  E.runCmd({ op: 'add', ents: es.map(e => ({ ...e, id: e.id || NID(), layer: e.layer || '0', color: e.color == null ? 256 : e.color })) });
  return S.prims.slice(n0).map(p => p.key);
}, ents);
const secKeys = (keys) => ev((ks) => { const E = window.dwgApp.editor, S = window.dwgApp.state; E.sel.clear(); for (const p of S.prims) if (ks.includes(p.key)) E.sel.add(p); E.tools.api.overlay(); return E.sel.size; }, keys);
const undo = async () => { await ev(() => window.dwgApp.editor.act('undo')); await bekle(250); };
/** çizgi ilkelinin orta noktası ve yön açısı (derece, 0-180) */
const cizgi = (p) => { const a = p.ops[0], b = p.ops[1]; const mx = (a[1] + b[1]) / 2, my = (a[2] + b[2]) / 2; let d = Math.atan2(b[2] - a[2], b[1] - a[1]) * 180 / Math.PI; d = ((d % 180) + 180) % 180; return { mx, my, deg: d, z: a[3] }; };
const iceren = (list, x, y, e = 1e-3) => list.some(q => yak(q.mx, x, e) && yak(q.my, y, e));
const sonForm = async () => { const l = await askLog(page); return l.length ? l[l.length - 1] : null; };

await page.click('#toolbar [data-tab="edit"]');
await zoom([0, 0, 800, 600]);

// ---------------------------------------------------------------------------------
// 1 · ARRAYPOLAR: merkez DOKUNUŞLA (AutoCAD "Specify center point of array")
// ---------------------------------------------------------------------------------
{
  const [kL] = await ekle([{ type: 'LINE', pts: [[100, 100, 0], [120, 100, 0]] }]);
  await komut('arraypolar');
  const d0 = await durum();
  ok('1a ARRAYPOLAR aracı seçimle başlar', d0.active === 'arraypolar' && d0.selecting, J(d0));
  await secKeys([kL]); await bitir();
  const d1 = await durum();
  ok('1b Bitir: merkez noktası istenir (adım 1), form henüz açılmadı', d1.active === 'arraypolar' && !d1.selecting && d1.step === 1 && /merkez/i.test(d1.text), J(d1));
  const n0 = await count();
  await queueAnswers(page, { n: 4, total: 360, rotate: true, dz: 0 });
  await tapWorld(200, 100);
  const f = await sonForm();
  ok('1c merkeze dokununca kutupsal dizi formu açılır (başlık "Kutupsal dizi")', f && f.type === 'form' && f.label === 'Kutupsal dizi', J(f));
  const kop = (await sonN(3)).map(p => cizgi(p));
  ok('1d 4 öge, tam dolaşım: 3 kopya dokunulan merkez (200,100) çevresinde 90° adımlarla — (200,10), (290,100), (200,190)', (await count()) === n0 + 3 && iceren(kop, 200, 10) && iceren(kop, 290, 100) && iceren(kop, 200, 190), J(kop));
  ok('1e kopyalar dönüyor: 90° ve 270° kopyalar düşey, 180° kopya yatay', kop.filter(q => yak(q.deg, 90, 1e-6)).length === 2 && kop.filter(q => yak(q.deg, 0, 1e-6) || yak(q.deg, 180, 1e-6)).length === 1, J(kop));
  ok('1f ileti öge sayısını söyler (· 4), araç kapandı, seçim boş', /·\s*4$/.test(await toast()) && (await aktif()) === null && (await durum()).sel === 0, J({ t: await toast(), a: await aktif() }));
  const src = cizgi(await primOf(kL));
  ok('1g kaynak yerinde kaldı (110,100)', yak(src.mx, 110, 1e-6) && yak(src.my, 100, 1e-6), J(src));
  await shot('dizi_kutupsal');
  await undo();
  ok('1h tek geri alma üç kopyayı kaldırır', (await count()) === n0, String(await count()));
  // kopyalar dönmesin
  await komut('arraypolar'); await secKeys([kL]); await bitir();
  await queueAnswers(page, { n: 4, total: 360, rotate: false, dz: 5 });
  await tapWorld(200, 100);
  const kop2 = (await sonN(3)).map(p => cizgi(p));
  ok('1i "kopyalar dönsün" kapalı: kopyalar aynı yerlerde, hepsi yatay; kat artımı 5 → Z 5, 10, 15', (await count()) === n0 + 3 && iceren(kop2, 200, 10) && iceren(kop2, 290, 100) && iceren(kop2, 200, 190) && kop2.every(q => yak(q.deg, 0, 1e-6)) && [5, 10, 15].every(z => kop2.some(q => yak(q.z, z, 1e-6))), J(kop2));
  await undo();
  // eksik açı: 3 öge, 90° → uçlar dâhil 45° adım
  await komut('arraypolar'); await secKeys([kL]); await bitir();
  await queueAnswers(page, { n: 3, total: 90, rotate: true, dz: 0 });
  await tapWorld(110, 200);   // merkez tam kaynağın altında (uzaklık 100)
  const kop3 = (await sonN(2)).map(p => cizgi(p));
  ok('1j toplam açı 90°, 3 öge: kopyalar 45° ve 90° döner (uçlar dâhil)', (await count()) === n0 + 2 && kop3.some(q => yak(q.deg, 45, 1e-6)) && kop3.some(q => yak(q.deg, 90, 1e-6)), J(kop3));
  await undo();
  // koordinatla merkez
  await komut('arraypolar'); await secKeys([kL]); await bitir();
  await queueAnswers(page, { n: 2, total: 180, rotate: true, dz: 0 });
  await komut('200,100');
  const kop4 = (await sonN(1)).map(p => cizgi(p));
  ok('1k merkez yazılarak da verilir (200,100): 180° kopya (290,100)', (await count()) === n0 + 1 && iceren(kop4, 290, 100), J(kop4));
  await undo(); await iptal();
  // sınır aşımı: uyarı, merkez yeniden istenir; ikinci dokunuş çalışır (nokta listesi sıfırlanır)
  await komut('arraypolar'); await secKeys([kL]); await bitir();
  await queueAnswers(page, { n: 30000, total: 360, rotate: true, dz: 0 });
  await tapWorld(200, 100);
  const dR = await durum();
  ok('1l 30000 kopya: "çok yüksek" uyarısı, araç merkez istemeye döner (adım 1), çizim değişmez', /yüksek|too high|Too many/i.test(await toast()) && dR.active === 'arraypolar' && dR.step === 1 && (await count()) === n0, J({ t: await toast(), dR }));
  await queueAnswers(page, { n: 2, total: 180, rotate: true, dz: 0 });
  await tapWorld(200, 100);
  ok('1m uyarıdan sonra ikinci merkez dokunuşu formu yeniden açar ve diziyi kurar (1 kopya)', (await count()) === n0 + 1 && (await aktif()) === null, J({ n: await count(), n0 }));
  await undo(); await iptal();
}

// ---------------------------------------------------------------------------------
// 2 · ARRAYRECT: form hemen açılır; sütun × satır, aralıklar, kat artımı
// ---------------------------------------------------------------------------------
{
  const [kC] = await ekle([{ type: 'CIRCLE', pts: [[300, 300, 0]], r: 10 }]);
  await komut('arrayrect');
  ok('2a ARRAYRECT aracı seçimle başlar', (await aktif()) === 'arrayrect', String(await aktif()));
  await secKeys([kC]);
  const n0 = await count();
  await queueAnswers(page, { nx: 3, ny: 2, dx: 50, dy: 40, dz: 10 });
  await bitir();
  const f = await sonForm();
  ok('2b Bitir: dikdörtgen dizi formu doğrudan açılır (nokta istenmez)', f && f.type === 'form' && f.label === 'Dikdörtgen dizi', J(f));
  const kop = (await sonN(5)).map(p => { const a = p.ops.find(o => o[0] === 2); return { cx: a[1], cy: a[2], z: a[6] }; });
  const bekl = [[350, 300, 10], [400, 300, 20], [300, 340, 10], [350, 340, 20], [400, 340, 30]];
  ok('2c 3 × 2 dizi: 5 kopya (350,300) (400,300) (300,340) (350,340) (400,340); Z = artım × (sütun + satır)', (await count()) === n0 + 5 && bekl.every(b => kop.some(q => yak(q.cx, b[0], 1e-6) && yak(q.cy, b[1], 1e-6) && yak(q.z, b[2], 1e-6))), J(kop));
  ok('2d araç kapandı', (await aktif()) === null, String(await aktif()));
  await undo();
  ok('2e tek geri alma beş kopyayı kaldırır', (await count()) === n0, String(await count()));
  // 1 × 1: kopya yok → uyarı, araç kapanır
  await iptal();   // önceki seçim kalmasın: seçim hazırken dizi araçları formu hemen açar
  await komut('arrayrect'); await secKeys([kC]);
  await queueAnswers(page, { nx: 1, ny: 1, dx: 50, dy: 40, dz: 0 });
  await bitir();
  ok('2f 1 × 1 dizi boş: uyarı, çizim değişmez, araç kapanır', /boş/.test(await toast()) && (await count()) === n0 && (await aktif()) === null, await toast());
  // formdan vazgeçme
  await iptal();   // önceki seçim kalmasın: seçim hazırken dizi araçları formu hemen açar
  await komut('arrayrect'); await secKeys([kC]);
  await queueAnswers(page, null);
  await bitir();
  ok('2g formdan vazgeçince araç kapanır, çizim değişmez', (await aktif()) === null && (await count()) === n0, String(await aktif()));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 3 · ARRAYPATH: sayıyla, yola dönme, kaynak yolun dokunulan ucuna taşınır; aralıkla; uzak uçtan
// ---------------------------------------------------------------------------------
{
  const [kP, kL] = await ekle([
    { type: 'LWPOLYLINE', pts: [[500, 100, 0], [600, 100, 0], [600, 200, 0]] },   // L biçimli yol, boy 200
    { type: 'LINE', pts: [[400, 50, 0], [420, 50, 0]] },                           // kaynak: yatay çizgi, orta (410,50)
  ]);
  await komut('arraypath');
  ok('3a ARRAYPATH aracı seçimle başlar', (await aktif()) === 'arraypath', String(await aktif()));
  await secKeys([kL]); await bitir();
  const d1 = await durum();
  ok('3b Bitir: yol istenir (adım 1)', d1.active === 'arraypath' && !d1.selecting && d1.step === 1 && /yol/i.test(d1.text), J(d1));
  const n0 = await count();
  await queueAnswers(page, { method: 'count', n: 5, align: true, dz: 0 });
  await tapWorld(520, 100);   // başlangıca yakın
  const f = await sonForm();
  ok('3c yola dokununca yol dizisi formu açılır', f && f.type === 'form' && f.label === 'Yol dizisi', J(f));
  const src = cizgi(await primOf(kL));
  ok('3d kaynak nesne yolun dokunulan ucuna taşındı (500,100), yönü değişmedi (yatay)', yak(src.mx, 500, 1e-6) && yak(src.my, 100, 1e-6) && yak(src.deg, 0, 1e-6), J(src));
  const kop = (await sonN(4)).map(p => cizgi(p));
  ok('3e 5 öge, yol eşit bölündü: kopyalar (550,100) (600,100) (600,150) (600,200)', (await count()) === n0 + 4 && iceren(kop, 550, 100) && iceren(kop, 600, 100) && iceren(kop, 600, 150) && iceren(kop, 600, 200), J(kop));
  const at = (x, y) => kop.find(q => yak(q.mx, x, 1e-3) && yak(q.my, y, 1e-3));
  ok('3f yola dönme: yatay parçadaki kopya yatay, köşedeki ve düşey parçadakiler düşey (köşe sonraki parçanın yönünü alır)', yak(at(550, 100).deg, 0, 1e-6) && yak(at(600, 100).deg, 90, 1e-6) && yak(at(600, 150).deg, 90, 1e-6) && yak(at(600, 200).deg, 90, 1e-6), J(kop));
  ok('3g ileti "· 5", araç kapandı', /·\s*5$/.test(await toast()) && (await aktif()) === null, await toast());
  await shot('dizi_yol');
  await undo();
  const geri = cizgi(await primOf(kL));
  ok('3h tek geri alma: kopyalar kalkar, kaynak eski yerine (410,50) döner', (await count()) === n0 && yak(geri.mx, 410, 1e-6) && yak(geri.my, 50, 1e-6), J({ n: await count(), geri }));
  // aralıkla, dönme yok, UZAK uçtan dokunuş → yol ters: (600,200) → (600,100) → (500,100)
  await komut('arraypath'); await secKeys([kL]); await bitir();
  await queueAnswers(page, { method: 'spacing', d: 60, align: false, dz: 0 });
  await tapWorld(600, 190);
  const src2 = cizgi(await primOf(kL));
  const kop2 = (await sonN(3)).map(p => cizgi(p));
  ok('3i aralık 60, uzak uçtan: kaynak (600,200)ye taşındı; kopyalar (600,140) (580,100) (520,100) — sığdığı kadar (4 öge)', (await count()) === n0 + 3 && yak(src2.mx, 600, 1e-6) && yak(src2.my, 200, 1e-6) && iceren(kop2, 600, 140) && iceren(kop2, 580, 100) && iceren(kop2, 520, 100), J({ src2, kop2 }));
  ok('3j yola dönme kapalı: bütün kopyalar yatay kaldı', kop2.every(q => yak(q.deg, 0, 1e-6)), J(kop2));
  await undo();
  // aralık yoldan uzun: yalnız başlangıç → "dizi boş"
  await komut('arraypath'); await secKeys([kL]); await bitir();
  await queueAnswers(page, { method: 'spacing', d: 500, align: true, dz: 0 });
  await tapWorld(520, 100);
  ok('3k aralık yoldan uzunsa dizi boş kalır: uyarı, çizim değişmez, araç yol istemeye döner', /boş/.test(await toast()) && (await count()) === n0 && (await aktif()) === 'arraypath' && (await durum()).step === 1, await toast());
  await iptal();
  // 1 öge kabul edilmez
  await komut('arraypath'); await secKeys([kL]); await bitir();
  await queueAnswers(page, { method: 'count', n: 1, align: true, dz: 0 });
  await tapWorld(520, 100);
  ok('3l sayıyla 1 öge kabul edilmez (en az 2), araç yol istemeye döner', /En az 2|At least 2/.test(await toast()) && (await count()) === n0 && (await aktif()) === 'arraypath' && (await durum()).step === 1, await toast());
  await iptal();
  // yol yerine nokta nesnesine dokunuş: "düz kenar yok" — nokta, örnek dosyanın geometrisinden uzakta (dokunuş başka bir yolu yakalamasın)
  const bn = await ev(() => { const S = window.dwgApp.state; let mx = -Infinity, my = -Infinity; for (const p of S.prims) { if (!p.bb || !isFinite(p.bb[2])) continue; mx = Math.max(mx, p.bb[2]); my = Math.max(my, p.bb[3]); } return [mx + 1000, my + 1000]; });
  const [kPt] = await ekle([{ type: 'POINT', pts: [[bn[0], bn[1], 0]] }]);
  await zoom([bn[0] - 200, bn[1] - 200, bn[0] + 200, bn[1] + 200]);
  await komut('arraypath'); await secKeys([kL]); await bitir();
  await tapWorld(bn[0], bn[1]);
  ok('3m yol olmayan nesneye dokunuş: "düz kenar yok" uyarısı, araç yol istemeye devam eder', /düz kenar|no straight/i.test(await toast()) && (await aktif()) === 'arraypath' && (await durum()).step === 1, J({ t: await toast(), d: await durum() }));
  await iptal();
  // KAPALI yol: n öge n eşit aralığa (dikiş yerine ikinci öge konmaz); aralıkla da son nokta başlangıç sayılmaz
  const [kSq] = await ekle([{ type: 'LWPOLYLINE', closed: true, pts: [[bn[0] + 100, bn[1], 0], [bn[0] + 140, bn[1], 0], [bn[0] + 140, bn[1] + 40, 0], [bn[0] + 100, bn[1] + 40, 0]] }]);
  const [kL3] = await ekle([{ type: 'LINE', pts: [[bn[0] - 150, bn[1] - 150, 0], [bn[0] - 130, bn[1] - 150, 0]] }]);
  await komut('arraypath'); await secKeys([kL3]); await bitir();
  await queueAnswers(page, { method: 'count', n: 4, align: true, dz: 0 });
  const nS = await count();
  await tapWorld(bn[0] + 102, bn[1]);
  const kSrc = cizgi(await primOf(kL3)), kK = (await sonN(3)).map(p => cizgi(p));
  const kose = [[bn[0] + 140, bn[1]], [bn[0] + 140, bn[1] + 40], [bn[0] + 100, bn[1] + 40]];
  ok('3n kapalı kare, 4 öge: kaynak dokunulan köşede, 3 kopya öteki üç köşede (dikişte yinelenen öge yok)', (await count()) === nS + 3 && yak(kSrc.mx, bn[0] + 100, 1e-3) && yak(kSrc.my, bn[1], 1e-3) && kose.every(c => iceren(kK, c[0], c[1])) && !iceren(kK, bn[0] + 100, bn[1]), J({ kSrc, kK }));
  await undo();
  await komut('arraypath'); await secKeys([kL3]); await bitir();
  await queueAnswers(page, { method: 'spacing', d: 40, align: false, dz: 0 });
  await tapWorld(bn[0] + 102, bn[1]);
  const kK2 = (await sonN(3)).map(p => cizgi(p));
  ok('3o kapalı kare, aralık 40 (çevre 160): 4 öge, başlangıca dönen son nokta atlanır', (await count()) === nS + 3 && kose.every(c => iceren(kK2, c[0], c[1])) && !iceren(kK2, bn[0] + 100, bn[1]), J(kK2));
  await undo();
  // sınırlar: aralıkla çok küçük aralık ve sayıyla çok büyük sayı — dizi üretilmeden reddedilir, araç yol istemeye döner
  await komut('arraypath'); await secKeys([kL3]); await bitir();
  await queueAnswers(page, { method: 'spacing', d: 0.001, align: true, dz: 0 });
  await tapWorld(bn[0] + 102, bn[1]);
  ok('3p aralık 0,001 (160.001 öge): "çok yüksek" uyarısı, çizim değişmez, araç sürer', /yüksek|too high|Too many/i.test(await toast()) && (await count()) === nS && (await aktif()) === 'arraypath', await toast());
  await queueAnswers(page, { method: 'count', n: 100000000, align: true, dz: 0 });
  await tapWorld(bn[0] + 102, bn[1]);
  ok('3q sayıyla 100 000 000 öge: anında reddedilir (dizi üretilmez), çizim değişmez', /yüksek|too high|Too many/i.test(await toast()) && (await count()) === nS, await toast());
  await iptal();
  // yolun kotu: ögeler yolun Z\'sine oturur (kaynak Z 0 → yol Z 100)
  const [kPz] = await ekle([{ type: 'LWPOLYLINE', pts: [[bn[0] - 100, bn[1] + 100, 100], [bn[0], bn[1] + 100, 100]] }]);
  await komut('arraypath'); await secKeys([kL3]); await bitir();
  await queueAnswers(page, { method: 'count', n: 2, align: true, dz: 0 });
  await tapWorld(bn[0] - 98, bn[1] + 100);
  const zSrc = (await primOf(kL3)).ops[0][3], zKop = (await sonN(1))[0].ops[0][3];
  ok('3r yol Z = 100: taşınan kaynak ve kopya yolun kotunda', yak(zSrc, 100, 1e-6) && yak(zKop, 100, 1e-6), J({ zSrc, zKop }));
  await undo(); await iptal();
  await zoom([0, 0, 800, 600]);
  void kP; void kPt; void kSq; void kPz;
}

// ---------------------------------------------------------------------------------
// 4 · ARRAY (tür sorusu), ön seçimle başlama, karo geçişi
// ---------------------------------------------------------------------------------
{
  const [kC] = await ekle([{ type: 'CIRCLE', pts: [[100, 500, 0]], r: 8 }]);
  await komut('array');
  const d0 = await durum();
  ok('4a ARRAY (AR) seçimle başlar', d0.active === 'array' && d0.selecting, J(d0));
  await secKeys([kC]);
  await queueAnswers(page, { kind: 'path' });
  await bitir();
  const f = await sonForm(), d1 = await durum();
  ok('4b Bitir: tür sorulur (form "Dizi"), Yol seçilince araç yol dizisine döner ve yol ister', f && f.label === 'Dizi' && d1.active === 'arraypath' && d1.step === 1 && !d1.selecting, J({ f, d1 }));
  await iptal();
  // ön seçim + Dizi karosu: tür sorusu hemen açılır
  await secKeys([kC]);
  const n0 = (await askLog(page)).length;
  await queueAnswers(page, { kind: 'polar' });
  await ev(() => window.dwgApp.editor.act('t:array')); await bekle(300);
  const d2 = await durum();
  ok('4c seçim hazırken Dizi karosu: tür sorusu hemen açılır, Kutupsal seçilince merkez istenir', (await askLog(page)).length === n0 + 1 && d2.active === 'arraypolar' && d2.step === 1, J(d2));
  // Dizi karosuna yeniden dokunmak alt türü de kapatır
  await ev(() => window.dwgApp.editor.act('t:array')); await bekle(200);
  ok('4d Dizi karosuna yeniden dokunuş kutupsal alt aracı kapatır', (await aktif()) === null, String(await aktif()));
  // tür formundan vazgeçme
  await iptal();   // önceki seçim kalmasın: seçim hazırken dizi araçları formu hemen açar
  await komut('array'); await secKeys([kC]);
  await queueAnswers(page, null);
  await bitir();
  ok('4e tür sorusundan vazgeçince araç kapanır', (await aktif()) === null, String(await aktif()));
  // son tür hatırlanır: kutupsal seçilmişti; öntanımlı kutupsal
  await iptal();   // önceki seçim kalmasın: seçim hazırken dizi araçları formu hemen açar
  await komut('ar'); await secKeys([kC]);
  await queueAnswers(page, {});   // boş nesne: öntanımlılar
  await bitir();
  ok('4f "AR" kısaltması; boş cevap son türü (kutupsal) alır', (await aktif()) === 'arraypolar', String(await aktif()));
  await iptal();
  // komut satırından ARRAYPATH: Dizi karosu vurgulanır (alt türler Dizi karosunda)
  await iptal();
  await komut('arraypath'); await bekle(150);
  const vur = await ev(() => { const b = document.querySelector('#toolbar [data-act="t:array"]'); return b ? b.classList.contains('active') : null; });
  ok('4h ARRAYPATH komutla başlayınca Dizi karosu vurgulu', vur === true, String(vur));
  await iptal();
  // seçim yokken Bitir uyarır
  await iptal();   // önceki seçim kalmasın: seçim hazırken dizi araçları formu hemen açar
  await komut('arrayrect'); await bitir();
  ok('4g seçim yokken Bitir: "seçim boş" uyarısı, araç sürer', /boş|empty/i.test(await toast()) && (await aktif()) === 'arrayrect', await toast());
  await iptal();
}

// ---------------------------------------------------------------------------------
// 5 · Komut tablosu, yetki, karo, İngilizce adlar, saf yardımcılar
// ---------------------------------------------------------------------------------
{
  const g = await ev(async () => {
    const A = await import('./acad.js'), E = await import('./edition.js'), G = await import('./geom.js'), N = await import('./annot.js');
    const id = (n) => { const c = A.resolve(n); return c ? (c.avail === false ? 'NA' : c.id) : undefined; };
    const frames = G.pathFramesAt([[0, 0], [100, 0], [100, 100]], [0, 50, 100, 150, 200, 250]);
    const dup = G.pathFramesAt([[0, 0], [10, 0], [10, 10], [10, 10]], [0, 10, 20]);
    const items = N.arrayItems('path', { frames, base: [10, 0], align: true, dz: 2 });
    const noal = N.arrayItems('path', { frames, base: [10, 0], align: false });
    return {
      hata: A.dogrula(), st: A.stats(),
      ARRAY: id('ARRAY'), AR: id('AR'), ARRAYRECT: id('ARRAYRECT'), ARRAYPOLAR: id('ARRAYPOLAR'), ARRAYPATH: id('ARRAYPATH'), ARRAYCLASSIC: id('ARRAYCLASSIC'), D3: id('3DARRAY'), A3: id('3A'), ARRAYEDIT: id('ARRAYEDIT'),
      note: (A.resolve('ARRAY') || {}).note || '',
      need: ['t:array', 't:arrayrect', 't:arraypolar', 't:arraypath'].map(k => E.need(k)), inTier: E.FEATURE_TIER.has('t:arraypath'),
      frames: frames.map(f => [f.p[0], f.p[1], Math.round(f.ang * 180 / Math.PI)]), items, noal, dup: dup.map(f => [f.p[0], f.p[1], Math.round(f.ang * 180 / Math.PI)]),
      hint: [...(document.querySelector('#toolbar [data-act="t:array"]') || { attributes: [] }).attributes].map(a => a.value).join(' | ') + ' | ' + (await import('./i18n.js')).t('th_t:array'),
    };
  });
  ok('5a tablo sağlıklı; sayılar 508 kayıt · 222 AutoCAD · 33 özgü · 253 bulunmayan · 755 ad', g.hata.length === 0 && g.st.total === 508 && g.st.acad === 222 && g.st.ext === 33 && g.st.known === 253 && g.st.names === 755, J({ hata: g.hata, st: g.st }));
  ok('5b ARRAY / AR tür sorar; ARRAYRECT, ARRAYPOLAR, ARRAYPATH doğrudan; ARRAYCLASSIC ve 3DARRAY / 3A eş anlamlı; ARRAYEDIT bulunmuyor', g.ARRAY === 't:array' && g.AR === 't:array' && g.ARRAYRECT === 't:arrayrect' && g.ARRAYPOLAR === 't:arraypolar' && g.ARRAYPATH === 't:arraypath' && g.ARRAYCLASSIC === 't:array' && g.D3 === 't:array' && g.A3 === 't:array' && g.ARRAYEDIT === 'NA', J(g));
  ok('5c ARRAY notu türleri ve Z artımını söyler', /polar/.test(g.note) && /path/.test(g.note) && /Z increment/.test(g.note), g.note);
  ok('5d yetki: dizi türleri Dizi\'nin basamağını (premium) taşır, dökümde ayrı satır açmaz', g.need.every(x => x === 'premium') && g.inTier === false, J({ need: g.need, inTier: g.inTier }));
  ok('5e Dizi karosunun ipucu yolu ve kat artımını söyler', /yol/.test(g.hint) && /kat/i.test(g.hint), g.hint);
  ok('5f pathFramesAt: köşedeki nokta sonraki parçanın yönünü alır, son nokta son parçanın; yolu aşan uzaklık atlanır', g.frames.length === 5 && J(g.frames) === J([[0, 0, 0], [50, 0, 0], [100, 0, 90], [100, 50, 90], [100, 100, 90]]), J(g.frames));
  ok('5f2 yinelenen son köşe (sıfır boylu parça): son noktanın yönü önceki gerçek parçadan (90°)', J(g.dup) === J([[0, 0, 0], [10, 0, 90], [10, 10, 90]]), J(g.dup));
  const m2 = g.items[2].m;
  ok('5g arrayItems(path): 0. öge salt öteleme (taban → yol başı), köşedeki öge tabanı çevresinde 90° döner, Z = artım × sıra', g.items.length === 5 && J(g.items[0].m.map(v => Math.round(v * 1e6) / 1e6)) === J([1, 0, 0, 1, -10, 0]) && yak(m2[0], 0, 1e-9) && yak(m2[1], 1, 1e-9) && yak(m2[0] * 10 + m2[2] * 0 + m2[4], 100, 1e-9) && yak(m2[1] * 10 + m2[3] * 0 + m2[5], 0, 1e-9) && g.items[2].dz === 4, J(g.items));
  ok('5h align kapalıyken bütün ögeler salt öteleme', g.noal.every(it => yak(it.m[0], 1) && yak(it.m[1], 0)), J(g.noal.map(it => it.m)));
  // İngilizce arayüz
  const dil = (l) => ev(async (x) => { const I = await import('./i18n.js'); const r = I.setLang(x); I.applyI18n(); window.dwgApp.getSettings().lang = x; window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang: r } })); }, l);
  await dil('en'); await bekle(200);
  const en = await ev(async () => { const I = await import('./i18n.js'); return { rect: I.t('tool_arrayrect'), polar: I.t('tool_arraypolar'), path: I.t('tool_arraypath'), step: I.t('tstep_arraypath_1'), dz: I.t('arrayDz'), lb: (document.querySelector('#toolbar [data-act="t:array"] .lb') || {}).textContent }; });
  ok('5i İngilizce arayüzde araç adları AutoCAD komut adlarıdır (ARRAYRECT / ARRAYPOLAR / ARRAYPATH), yol adımı, Z etiketi; karo etiketi ARRAY', en.rect === 'ARRAYRECT' && en.polar === 'ARRAYPOLAR' && en.path === 'ARRAYPATH' && /tapped end/.test(en.step) && /Level increment/.test(en.dz) && en.lb.trim() === 'ARRAY', J(en));
  await dil('tr'); await bekle(150);
}

// ---------------------------------------------------------------------------------
// 6 · Bütünlük merceğinin bulguları: tür sorusundan dikdörtgen, ön seçim + komut, eş anlamlılar, bağıl merkez,
//     çoklu seçim, tür başına hafıza (reddedilen değer öntanımlı olmaz), yolda Z artımı, aralık 0, yay yolu, ücretsiz kademe
// ---------------------------------------------------------------------------------
{
  await iptal(); await zoom([0, 0, 800, 600]);
  const [kA] = await ekle([{ type: 'LINE', pts: [[100, 250, 0], [120, 250, 0]] }]);   // orta (110,250)
  await komut('array'); await secKeys([kA]);
  await queueAnswers(page, { kind: 'rect' }, { nx: 2, ny: 1, dx: 30, dy: 0, dz: 0 });
  const nA = await count(); await bitir();
  const fA = await sonForm();
  ok('6a ARRAY → Dikdörtgen: tür sorusundan sonra dikdörtgen formu hemen açılır, 1 kopya (140,250)', fA && fA.label === 'Dikdörtgen dizi' && (await count()) === nA + 1 && iceren((await sonN(1)).map(cizgi), 140, 250), J({ fA, n: await count(), nA }));
  await undo(); await iptal();
  // ön seçim + komut
  await secKeys([kA]); const l0 = (await askLog(page)).length;
  await queueAnswers(page, null);
  await komut('arrayrect'); await bekle(250);
  ok('6b seçim hazırken ARRAYRECT formu Bitir olmadan açar (vazgeçildi → araç kapalı)', (await askLog(page)).length === l0 + 1 && (await aktif()) === null, J({ l: (await askLog(page)).length - l0, a: await aktif() }));
  await secKeys([kA]); await komut('arraypath'); await bekle(150);
  const d6 = await durum();
  ok('6c seçim hazırken ARRAYPATH doğrudan yol ister (adım 1)', d6.active === 'arraypath' && d6.step === 1 && !d6.selecting, J(d6));
  await iptal();
  // eş anlamlılar komut satırından
  await komut('3a');
  ok('6d "3A" (3DARRAY) Dizi aracını seçimle başlatır', (await aktif()) === 'array' && (await durum()).selecting, J(await durum()));
  await iptal();
  await komut('arrayclassic');
  ok('6e ARRAYCLASSIC de Dizi aracını başlatır', (await aktif()) === 'array', String(await aktif()));
  await iptal();
  await yaz(''); await enter();
  ok('6f boş Enter son komutu yineler (Dizi)', (await aktif()) === 'array', String(await aktif()));
  await iptal();
  // bağıl merkez: önceki aracın son noktasına göre (AutoCAD LASTPOINT)
  await komut('line'); await tapWorld(100, 100); await tapWorld(150, 100); await iptal();
  await komut('arraypolar'); await secKeys([kA]); await bitir();
  await queueAnswers(page, { n: 2, total: 180, rotate: true, dz: 0 });
  const nG = await count();
  await komut('@50,0');
  const g1 = (await sonN(1)).map(cizgi);
  ok('6g "@50,0" son noktaya (150,100) göre merkez (200,100): 180° kopya (290,-50)', (await count()) === nG + 1 && iceren(g1, 290, -50), J(g1));
  await undo(); await iptal();
  // çoklu seçim: artı (iki çizgi), yol dizisi ikisini birlikte taşır
  const [k1, k2] = await ekle([{ type: 'LINE', pts: [[400, 400, 0], [420, 400, 0]] }, { type: 'LINE', pts: [[410, 390, 0], [410, 410, 0]] }]);
  const [kP2] = await ekle([{ type: 'LWPOLYLINE', pts: [[500, 400, 0], [600, 400, 0]] }]);
  await komut('arraypath'); await secKeys([k1, k2]); await bitir();
  await queueAnswers(page, { method: 'count', n: 3, align: true, dz: 0 });
  const nH = await count(); await tapWorld(505, 400);
  const h1 = cizgi(await primOf(k1)), h2 = cizgi(await primOf(k2)), hk = (await sonN(4)).map(cizgi);
  const nAt = (x, y) => hk.filter(q => yak(q.mx, x, 1e-3) && yak(q.my, y, 1e-3)).length;
  ok('6h iki nesne (artı): ikisi de yolun başına (500,400) taşındı; her çerçevede iki kopya (550 ve 600)', (await count()) === nH + 4 && yak(h1.mx, 500, 1e-3) && yak(h1.my, 400, 1e-3) && yak(h2.mx, 500, 1e-3) && yak(h2.my, 400, 1e-3) && nAt(550, 400) === 2 && nAt(600, 400) === 2, J({ h1, h2, hk }));
  await undo();
  const u1 = cizgi(await primOf(k1)), u2 = cizgi(await primOf(k2));
  ok('6i tek geri alma iki kaynağı da eski yerine getirir', (await count()) === nH && yak(u1.mx, 410, 1e-6) && yak(u2.my, 400, 1e-6), J({ u1, u2 }));
  await iptal();
  await komut('arraypolar'); await secKeys([k1, k2]); await bitir();
  await queueAnswers(page, { n: 10002, total: 360, rotate: true, dz: 0 });
  await tapWorld(450, 450);
  ok('6j iki nesne × 10.001 kopya sınırı aşar: dizi üretilmeden uyarı, merkez yeniden istenir', /yüksek|too high|Too many/i.test(await toast()) && (await aktif()) === 'arraypolar' && (await durum()).step === 1 && (await count()) === nH, J({ t: await toast(), d: await durum() }));
  await iptal();
  // tür başına hafıza: reddedilen 10002 öntanımlı olmadı; kutupsal (n 2, 180°) ve yol (n 3) ayrı hatırlanır
  await komut('arraypolar'); await secKeys([kA]); await bitir();
  await queueAnswers(page, {});
  const nK = await count(); await tapWorld(200, 100);
  ok('6k boş cevap son UYGULANAN kutupsal değerleri alır (n 2, 180°) → 1 kopya; reddedilen 10002 öntanımlı olmadı', (await count()) === nK + 1, J({ n: await count(), nK, t: await toast() }));
  await undo(); await iptal();
  await komut('arraypath'); await secKeys([kA]); await bitir();
  await queueAnswers(page, {});
  await tapWorld(505, 400);
  ok('6l yol dizisinin hafızası ayrı: boş cevap son yol değerlerini (n 3) alır → 2 kopya', (await count()) === nK + 2, J({ n: await count(), nK }));
  await undo(); await iptal();
  // yolda Z artımı uçtan uca
  await komut('arraypath'); await secKeys([kA]); await bitir();
  await queueAnswers(page, { method: 'count', n: 3, align: true, dz: 7 });
  await tapWorld(505, 400);
  const zs = (await sonN(2)).map(p => p.ops[0][3]).sort((a, b) => a - b), zA = (await primOf(kA)).ops[0][3];
  ok('6m yol Z 0, artım 7: kopyalar Z 7 ve 14, taşınan kaynak Z 0', yak(zs[0], 7, 1e-6) && yak(zs[1], 14, 1e-6) && yak(zA, 0, 1e-6), J({ zs, zA }));
  await undo(); await iptal();
  // aralık 0
  await komut('arraypath'); await secKeys([kA]); await bitir();
  await queueAnswers(page, { method: 'spacing', d: 0, align: true, dz: 0 });
  const nN = await count(); await tapWorld(505, 400);
  ok('6n aralık 0: "sayı bekleniyor", çizim değişmez, yol yeniden istenir', /sayı|number/i.test(await toast()) && (await count()) === nN && (await aktif()) === 'arraypath' && (await durum()).step === 1, J({ t: await toast(), d: await durum() }));
  await iptal();
  // yay yolu: (400,500) → (300,600) çeyrek yay, saat yönünün tersi; ortadaki kopya yayın üstünde ve teğete dönmüş (≈45°)
  const [kArc] = await ekle([{ type: 'ARC', pts: [[300, 500, 0]], r: 100, a0: 0, a1: Math.PI / 2 }]);
  await komut('arraypath'); await secKeys([kA]); await bitir();
  await queueAnswers(page, { method: 'count', n: 3, align: true, dz: 0 });
  const nY = await count(); await tapWorld(300 + 100 * Math.cos(0.17), 500 + 100 * Math.sin(0.17));
  const ya = cizgi(await primOf(kA)), yk = (await sonN(2)).map(cizgi);
  const orta = yk.find(q => q.mx < 395 && q.my < 595) || yk[0];
  ok('6o yay yolu: kaynak yayın başında (400,500); orta kopya yayın üstünde (≈370,7 · 570,7) ve ≈45° dönmüş; son kopya (300,600) ≈90°', (await count()) === nY + 2 && yak(ya.mx, 400, 1e-3) && yak(ya.my, 500, 1e-3) && yak(orta.mx, 370.71, 1.0) && yak(orta.my, 570.71, 1.0) && Math.abs(orta.deg - 45) < 3 && yk.some(q => yak(q.mx, 300, 1e-3) && yak(q.my, 600, 1e-3) && Math.abs(q.deg - 90) < 3), J({ ya, yk }));
  await undo(); await iptal();
  // ücretsiz kademe: alt tür komutları kilitli (Dizi'nin basamağı)
  await ev(() => { window.__edition = 'free'; });
  await queueAnswers(page, false);
  await komut('arraypath'); await bekle(250);
  const lg = await askLog(page), son = lg[lg.length - 1];
  ok('6p ücretsizde ARRAYPATH: yükseltme kutusu (Premium), araç başlamaz', (await aktif()) === null && son && son.type === 'confirm' && /Premium/.test(son.label), J({ a: await aktif(), son }));
  await queueAnswers(page, false);
  await komut('arraypolar'); await bekle(250);
  ok('6q ücretsizde ARRAYPOLAR da kilitli', (await aktif()) === null, String(await aktif()));
  await ev(() => { window.__edition = 'super'; });
  await komut('arraypolar'); await bekle(150);
  ok('6r kademe geri gelince komut çalışır', (await aktif()) === 'arraypolar', String(await aktif()));
  await iptal();
  void kP2; void kArc;
}

ok('X sayfa hatası yok', errors.length === 0, J(errors.slice(0, 3)));
await shot('son');
await browser.close(); await srv.kill();
C.summary(); C.exit();
