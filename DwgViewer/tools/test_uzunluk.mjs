// DOĞRUDAN UZAKLIK GİRİŞİ (v7.65, AutoCAD direct distance entry). Çizgi / Polyline'da bir taban nokta varken kutuya
// yazılan tek sayı bir UZUNLUKTUR: sonraki dokunuş yalnız yönü verir, nokta tabandan o yönde o kadar ileride alınır.
// Kutudaki sayı dokunma anında okunur (Enter gerekmez); Enter'la da bekletilir ve istem yönü ister. Ortho yönü
// kısıtlar; virgüllü sayı koordinattır; ilk noktada uzunluk anlamsızdır; kullanılınca kutu boşalır.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_uzunluk.mjs [çıktı] [örnekler]
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
const J = JSON.stringify, yak = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(150);
await openFile(page, `${SM}/example_2000.dwg`, { settle: 500 });
await ev(() => { document.getElementById('toast').hidden = true; localStorage.removeItem('edits:' + window.dwgApp.state.fileKey); window.dwgApp.osnap.setModes([]); });

const bekle = (ms = 150) => page.waitForTimeout(ms);
const tapWorld = async (x, y) => { await bekle(110); await ev(() => { document.getElementById('toast').hidden = true; }); const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]); const r = await page.locator('#viewport').boundingBox(); await page.touchscreen.tap(r.x + s[0], r.y + s[1]); await bekle(380); };
const arac = async (id) => { await ev((a) => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); document.getElementById('infoPanel').hidden = true; E.act(a); }, id); await bekle(150); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); E.sel.clear(); }); await bekle(120); };
const zoom = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(200); };
const durum = () => ev(() => { const T = window.dwgApp.editor.tools; return { active: T.active, pts: T.pts.map(p => p.slice(0, 2)), pend: T.pendLen, kutu: document.getElementById('cmdInput').value, text: document.getElementById('cmdText').textContent.trim() }; });
const sonPrim = () => ev(() => { const p = window.dwgApp.state.prims[window.dwgApp.state.prims.length - 1]; return { key: p.key, ops: p.ops.map(o => o.slice()) }; });
const count = () => ev(() => window.dwgApp.state.prims.length);
const yaz = (v) => page.fill('#cmdInput', v);
const enter = async () => { await page.click('#cmdEnter'); await bekle(150); };
const scr = (x, y) => ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
const kalem = (type, x, y) => ev(([t, x, y]) => { const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect(); vp.dispatchEvent(new PointerEvent(t, { pointerId: 8, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: -1, buttons: 0, pressure: 0 })); }, [type, x, y]);
const u = (dx, dy) => { const d = Math.hypot(dx, dy); return [dx / d, dy / d]; };

await page.click('#toolbar [data-tab="draw"]');
await zoom([0, 0, 800, 600]);

// ---------------------------------------------------------------------------------
// 1 · Çizgi: kutuda 300 varken dokunuş yönü verir, nokta tabandan 300 ileride; kutu boşalır
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await yaz('300');
  await tapWorld(200, 200);                                    // ilk nokta: taban yok, uzunluk kullanılmaz, kutu kalır
  const d0 = await durum();
  ok('1a ilk noktada uzunluk anlamsız: dokunuş ilk noktayı koyar, kutudaki 300 durur', d0.pts.length === 1 && yak(d0.pts[0][0], 200, 1e-3) && d0.kutu === '300', J(d0));
  const n0 = await count();
  await tapWorld(600, 260);                                    // yön: (400,60) → birim (0,98868, 0,14834) × 300
  const p1 = await sonPrim(), d1 = await durum(), [ux, uy] = u(400, 60);
  ok('1b dokunuş yönünde 300 ileride: (200,200) + 300·u(400,60) ≈ (496,6, 244,5), kutu boşaldı', (await count()) === n0 + 1 && yak(p1.ops[1][1], 200 + 300 * ux, 0.5) && yak(p1.ops[1][2], 200 + 300 * uy, 0.5) && d1.kutu === '' && d1.pend === null, J({ ops: p1.ops, d1 }));
  const L1 = Math.hypot(p1.ops[1][1] - p1.ops[0][1], p1.ops[1][2] - p1.ops[0][2]);
  ok('1c parça boyu tam 300 (dokunuş noktasına uzaklık değil)', yak(L1, 300, 1e-6), String(L1));
  await tapWorld(700, 500);                                    // kutu boş: olağan nokta
  const p2 = await sonPrim();
  ok('1d kutu boşken dokunuş olağan noktadır (700,500)', yak(p2.ops[1][1], 700, 1e-3) && yak(p2.ops[1][2], 500, 1e-3), J(p2.ops));
  await iptal();
}

// ---------------------------------------------------------------------------------
// 2 · Enter ile bekletme: istem ipucu, sonraki dokunuş yönü verir; ortho yönü kısıtlar
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await tapWorld(200, 200);
  await yaz('250'); await enter();
  const d = await durum();
  await page.screenshot({ path: `${out}/uzunluk_bekleyen.png` });
  ok('2a Enter: 250 bekletildi, kutu boş, istem "uzunluk 250 → yöne dokunun"', d.pend === 250 && d.kutu === '' && /uzunluk 250 → yöne dokunun/.test(d.text), J(d));
  await tapWorld(200, 500);                                    // düz yukarı (+y)
  const p = await sonPrim(), d2 = await durum();
  ok('2b dokunuş (200,500): yön +y, nokta (200,450); bekleyen uzunluk tüketildi', yak(p.ops[1][1], 200, 1e-3) && yak(p.ops[1][2], 450, 1e-3) && d2.pend === null && !/uzunluk/.test(d2.text), J({ ops: p.ops, d2 }));
  // ortho açık: dokunuş (700,520) → dx 500 > dy 70 → yön +x → (700,450)
  await ev(() => window.dwgApp.editor.act('ortho')); await bekle(120);
  await yaz('500');
  await tapWorld(700, 520);
  const p3 = await sonPrim();
  ok('2c ortho açıkken yön eksene kilitlenir: (200,450) + 500·(+x) = (700,450) — tabana göre tam 500, y birebir', yak(p3.ops[0][1], 200, 1e-3) && yak(p3.ops[0][2], 450, 1e-3) && yak(p3.ops[1][1] - p3.ops[0][1], 500, 1e-6) && p3.ops[1][2] === p3.ops[0][2], J(p3.ops));
  await ev(() => window.dwgApp.editor.act('ortho')); await bekle(120);
  await iptal();
}

// ---------------------------------------------------------------------------------
// 3 · Polyline: art arda iki uzunluk; koordinat yazımı ve virgüllü sayı değişmedi; iptal bekleyeni siler
// ---------------------------------------------------------------------------------
{
  await arac('t:pline');
  await tapWorld(100, 100);
  await yaz('200'); await tapWorld(500, 100);                  // +x → (300,100)
  await yaz('150'); await tapWorld(300, 400);                  // +y → (300,250)
  const d = await durum();
  ok('3a Polyline: iki uzunluk art arda: (100,100) → (300,100) → (300,250)', d.pts.length === 3 && yak(d.pts[1][0], 300, 1e-3) && yak(d.pts[1][1], 100, 1e-3) && yak(d.pts[2][0], 300, 1e-3) && yak(d.pts[2][1], 250, 1e-3), J(d.pts));
  await yaz('500,360'); await enter();
  const d2 = await durum();
  ok('3b virgüllü giriş koordinattır: (500,360) noktası eklendi, uzunluk bekletilmedi', d2.pts.length === 4 && yak(d2.pts[3][0], 500, 1e-6) && yak(d2.pts[3][1], 360, 1e-6) && d2.pend === null, J(d2));
  await yaz('@100<0'); await enter();
  const d3 = await durum();
  ok('3c @L<açı yazımı değişmedi: (600,360)', d3.pts.length === 5 && yak(d3.pts[4][0], 600, 1e-6) && yak(d3.pts[4][1], 360, 1e-6), J(d3.pts));
  await yaz('75'); await enter();
  ok('3d bekleyen uzunluk 75', (await durum()).pend === 75);
  await page.click('#cmdBtns [data-cmd="finish"]'); await bekle(250);
  const son = await sonPrim();
  ok('3e Bitir: polyline 5 köşeyle yazıldı, bekleyen uzunluk kullanılmadı ve silindi', son.ops.length === 5 && (await durum()).pend == null, J({ n: son.ops.length, pend: (await durum()).pend }));
}

// ---------------------------------------------------------------------------------
// 4 · Önizleme: kalem gezinirken bekleyen uzunlukla hedef nokta gösterilir; komut notu
// ---------------------------------------------------------------------------------
{
  await arac('t:line');
  await tapWorld(200, 200);
  await yaz('300'); await enter();
  const s = await scr(600, 260);
  await kalem('pointermove', s[0], s[1]); await bekle(220);
  const h = await ev(() => ({ pen: window.dwgApp.state.pen.hover, hover: window.dwgApp.__pickbox().hover }));
  const [ux, uy] = u(400, 60);
  ok('4a kalem (600,260) üstünde: önizleme (200,200) + 300·u ≈ (496,6, 244,5)', !!h.hover && Array.isArray(h.pen) && yak(h.pen[0], 200 + 300 * ux, 0.5) && yak(h.pen[1], 200 + 300 * uy, 0.5), J(h));
  await kalem('pointerout', s[0], s[1]); await iptal();
  const a = await ev(async () => { const A = await import('./acad.js'); return { l: A.resolve('L').note, pl: A.resolve('PL').note, st: A.stats() }; });
  ok('4b LINE ve PLINE notları doğrudan uzaklık girişini söyler; sayılar sabit', /Direct distance/.test(a.l || '') && /Direct distance/.test(a.pl || '') && a.st.total === 458 && a.st.names === 663, J(a));
  const dil = await ev(async () => { const I = await import('./i18n.js'); const tr = I.t('dirTapHint'); I.setLang('en'); const en = I.t('dirTapHint'); I.setLang('tr'); return { tr, en }; });
  ok('4c ipucu metni TR / EN', dil.tr === 'uzunluk %s → yöne dokunun' && dil.en === 'length %s → tap the direction', J(dil));
}

await page.screenshot({ path: `${out}/uzunluk.png` });
C.summary(errors);
await browser.close(); try { srv.close && srv.close(); } catch (_) { /* geç */ }
C.exit();
