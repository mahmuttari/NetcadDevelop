/*
 * DWG OfficeZip — TANITIM VİDEOSU 2 (v7.90): "kroki telefonda çizilir"
 *
 * Birinci tanıtım (tools/promo.mjs) var olan bir projeyi AÇIP gezdiriyordu. Bu ikincisi tersini
 * yapar: ekranda BOŞ bir çizimle başlar ve izleyicinin gözü önünde 12,5 x 8,0 m — yani 100 m² —
 * bir kat krokisi çizer. Dış duvar, 20 cm kabuk, iç bölmeler, 90 cm kapı boşluğu, kapı kanadı,
 * tarama, oda adları ve ölçüler; hepsi uygulamanın kendi komutlarıyla, kare kare kaydedilir.
 *
 * NEDEN ÇİZİM SAHNESİ: bir görüntüleyici ile bir çizim aracı arasındaki farkı anlatmanın en kısa
 * yolu, çizdirmektir. "Şunu da yapar" demek yerine yaptırırız.
 *
 * MARKA KURALI (kullanıcının açık talimatı): videoda hiçbir yerde başka bir yazılımın adı
 * GEÇMEZ. Komut adları sektörün ortak dilidir, o yüzden ekranda görünür; ama altyazı
 * "alışılmış çizim komutları", "masaüstündeki gibi" der. Aynı kural tablo ve metin belgesi
 * biçimleri için de geçerlidir: ".xlsx" ve ".docx" dosya biçimi adıdır, ürün adı değildir.
 *
 * DÜRÜSTLÜK KURALLARI (birinci tanıtımdan devralındı):
 *  - Ekranda görünen her sayı uygulamanın kendi hesabıdır; altyazıya elle sayı yazılmaz,
 *    uygulamanın yazdığı okunur (bkz. tarama alanı ve ölçü metinleri).
 *  - Gerçekten uzun süren iş, süresi kısaltılarak gösterilecekse ekranda "hızlandırıldı"
 *    rozeti durur.
 *  - Hiçbir kare elle düzenlenmez.
 *
 * Kullanım:
 *   FFMPEG=<ffmpeg yolu> PLAYWRIGHT_PKG=<node_modules> node tools/promo2.mjs <çıktı> [sahne,no]
 */
import { startServer, launchBrowser, PHONE, noUpdate, queueAnswers } from './harness.mjs';
import { hatKur, cekim, yumusak, FPS } from './promo_hat.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BETIK = path.dirname(new URL(import.meta.url).pathname);
const FFMPEG = process.env.FFMPEG || path.join(BETIK, '../ff/node_modules/ffmpeg-static/ffmpeg');
const OUT = path.resolve(process.argv[2] || './cikti2');
const SADECE = process.argv[3] ? process.argv[3].split(',').map(Number) : null;
fs.mkdirSync(OUT, { recursive: true });
const KAPLAMA = fs.readFileSync(path.join(BETIK, 'promo_kaplama.js'), 'utf8');

/*
 * SAHNE 14 İÇİN ÖRNEK TABLO. Dosya burada üretilir; içinde BİLEREK hazır değer yoktur:
 * formül hücrelerinde yalnız <f> vardır, <v> yoktur. Kurum yazılımlarının ve yaygın
 * kütüphanelerin ürettiği dosyalar tam olarak böyledir — v7.90'a kadar bu tablolar boş
 * görünüyordu. Videoda dolu görünmesi, hesabı uygulamanın yaptığının kanıtıdır.
 */
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipYaz(dosyalar) {
  const parca = [], cd = []; let ofs = 0;
  for (const [ad, veri] of dosyalar) {
    const nb = Buffer.from(ad, 'utf8'), ham = Buffer.isBuffer(veri) ? veri : Buffer.from(veri, 'utf8');
    const sik = zlib.deflateRawSync(ham); const def = sik.length < ham.length; const gov = def ? sik : ham;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(def ? 8 : 0, 8); lh.writeUInt32LE(crc32(ham), 14); lh.writeUInt32LE(gov.length, 18); lh.writeUInt32LE(ham.length, 22); lh.writeUInt16LE(nb.length, 26);
    parca.push(lh, nb, gov);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(def ? 8 : 0, 10); c.writeUInt32LE(crc32(ham), 16); c.writeUInt32LE(gov.length, 20); c.writeUInt32LE(ham.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(ofs, 42);
    cd.push(c, nb); ofs += lh.length + nb.length + gov.length;
  }
  const cdb = Buffer.concat(cd);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(dosyalar.length, 8); eo.writeUInt16LE(dosyalar.length, 10); eo.writeUInt32LE(cdb.length, 12); eo.writeUInt32LE(ofs, 16);
  return Buffer.concat([...parca, cdb, eo]);
}
const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKGNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const METRAJ = path.join(OUT, 'metraj.xlsx');
fs.writeFileSync(METRAJ, zipYaz([
  ['[Content_Types].xml', '<Types/>'],
  ['xl/workbook.xml', `<workbook xmlns="${SML}" xmlns:r="${RNS}"><sheets><sheet name="Metraj" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${PKGNS}"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`],
  ['xl/sharedStrings.xml', `<sst xmlns="${SML}"><si><t>Mahal</t></si><si><t>Alan m²</t></si><si><t>Birim ₺</t></si><si><t>Tutar</t></si><si><t>BANYO</t></si><si><t>SALON</t></si><si><t>MUTFAK</t></si><si><t>TOPLAM</t></si><si><t>KDV %20</t></si><si><t>Tarih</t></si></sst>`],
  ['xl/styles.xml', `<styleSheet xmlns="${SML}"><numFmts count="1"><numFmt numFmtId="166" formatCode="#,##0.00 &quot;₺&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="166"/><xf numFmtId="14"/><xf numFmtId="9"/></cellXfs></styleSheet>`],
  ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${SML}"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>36.48</v></c><c r="C2" s="1"><v>1850</v></c><c r="D2" s="1"><f>B2*C2</f></c></row>
<row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3"><v>28.9</v></c><c r="C3" s="1"><v>1450</v></c><c r="D3" s="1"><f>B3*C3</f></c></row>
<row r="4"><c r="A4" t="s"><v>6</v></c><c r="B4"><v>22.6</v></c><c r="C4" s="1"><v>1650</v></c><c r="D4" s="1"><f>B4*C4</f></c></row>
<row r="5"><c r="A5" t="s"><v>7</v></c><c r="B5"><f>SUM(B2:B4)</f></c><c r="D5" s="1"><f>SUM(D2:D4)</f></c></row>
<row r="6"><c r="A6" t="s"><v>8</v></c><c r="C6" s="3"><v>0.2</v></c><c r="D6" s="1"><f>D5*C6</f></c></row>
<row r="7"><c r="A7" t="s"><v>9</v></c><c r="B7" s="2"><v>45923</v></c></row>
</sheetData></worksheet>`],
]));

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 360, height: 800 }, deviceScaleFactor: 3 });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 160)));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

const hat = hatKur(FFMPEG, path.join(OUT, 'promo2_ham.mp4'));
const C = cekim(page, hat);
const ev = (fn, a) => page.evaluate(fn, a);
const K = {
  altMetin: (tr, en, yer) => ev(([a, b, c]) => window.__promo.altMetin(a, b, c), [tr, en || '', yer || 'alt']),
  alt: (p) => ev((x) => window.__promo.alt(x), p),
  kartMetin: (h) => ev((x) => window.__promo.kartMetin(x), h),
  kart: (p) => ev((x) => window.__promo.kart(x), p),
  rozetMetin: (h) => ev((x) => window.__promo.rozetMetin(x), h),
  rozet: (p) => ev((x) => window.__promo.rozet(x), p),
  karart: (p) => ev((x) => window.__promo.karart(x), p),
  halka: (x, y, p) => ev(([a, b, c]) => window.__promo.halka(a, b, c), [x, y, p]),
  nokta: (x, y) => ev(([a, b]) => window.__promo.nokta(a, b), [x, y]),
};
/* Ham pointer olayı: uzun basış / sürükleme gibi çok adımlı jestler dokunuş API'siyle kurulamaz */
const olay = (tip, x, y, id = 3) => ev(([t, a, b, i]) => {
  const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
  vp.dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', isPrimary: i === 3 || i === 11, bubbles: true, cancelable: true, clientX: r.left + a, clientY: r.top + b, button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerdown' || t === 'pointermove' ? 1 : 0 }));
}, [tip, x, y, id]);
const enjekte = () => page.evaluate(KAPLAMA);
const sessiz = () => ev(() => { for (const id of ['toast', 'tour']) { const e = document.getElementById(id); if (e) e.hidden = true; } });
const bekle = (ms) => page.waitForTimeout(ms);

// --- altyazı --------------------------------------------------------------------------------
/*
 * Altyazı ÜSTTE durur. Bu videonun anlattığı şeyin yarısı ALT kenardadır: komut çubuğu,
 * istem metni, şerit. Altyazı aşağıda olsaydı tam da gösterdiğimiz şeyi örterdi. Dikey
 * kadrajda planın üstünde kalan boşluk da böylece işe yarar.
 */
async function altAc(tr, en, yer) { await K.altMetin(tr, en, yer || 'ust'); await C.hareket(0.28, (t) => K.alt(yumusak(t))); }
async function altKapat() { await C.hareket(0.22, (t) => K.alt(1 - yumusak(t))); }
async function altDegis(tr, en, yer) { await altKapat(); await altAc(tr, en, yer); }

// --- komut satırı ---------------------------------------------------------------------------
/*
 * Komut satırı sessizce doldurulabilirdi (page.fill), ama videonun anlattığı şey tam olarak
 * BU: adı yazıyorsunuz, araç açılıyor. Bu yüzden harf harf yazılır ve her harfte bir kare
 * alınır — 30 fps'te karakter başına iki kare, saniyede on beş harf: okunabilir bir hız.
 */
async function yazCanli(s, { kare = 2 } = {}) {
  await page.click('#cmdInput');
  for (const ch of s) {
    await page.type('#cmdInput', ch, { delay: 0 });
    for (let i = 0; i < kare; i++) await C.kare();
  }
}
/** Enter düğmesine dokunuş: halka büyür, tıklanır */
async function enterCanli(sonra = 0.3) {
  const kutu = await page.locator('#cmdEnter').boundingBox();
  if (kutu) {
    const x = kutu.x + kutu.width / 2, y = kutu.y + kutu.height / 2;
    await C.hareket(0.16, (t) => K.halka(x, y, t * 0.6));
    await page.click('#cmdEnter').catch(() => {});
    await C.hareket(0.18, (t) => K.halka(x, y, 0.6 + t * 0.4));
    await K.halka(0, 0, null);
  } else { await page.click('#cmdEnter').catch(() => {}); }
  if (sonra) await C.tut(sonra);
}
/** Kayda giren komut / koordinat girişi */
const KC = async (s, sonra = 0.3, kare = 2) => { await yazCanli(s, { kare }); await enterCanli(sonra); };
/** Kayda GİRMEYEN (sahne arası hazırlık) giriş */
const K0 = async (s) => { await page.fill('#cmdInput', s); await bekle(70); await page.click('#cmdEnter'); await bekle(190); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools && E.tools.running) E.tools.cancel(); if (E.sel) E.sel.clear(); }); await bekle(110); };
const katman = async (ad, yeni) => { await K0('-la'); await K0(yeni ? 'N' : 'S'); await K0(ad); };

// --- dokunuş ---------------------------------------------------------------------------------
/** Dünya koordinatına gerçek dokunuş + halka */
async function dokunD(x, y, sonra = 0.35) {
  await sessiz();
  const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
  const r = await page.locator('#viewport').boundingBox();
  const px = r.x + s[0], py = r.y + s[1];
  await C.hareket(0.18, (t) => K.halka(px, py, t * 0.55));
  await page.touchscreen.tap(px, py);
  await C.hareket(0.22, (t) => K.halka(px, py, 0.55 + t * 0.45));
  await K.halka(0, 0, null);
  if (sonra) await C.tut(sonra);
}
/** Arayüz düğmesine dokunuş */
async function dugme(sec, sonra = 0.5) {
  const el = page.locator(sec).first();
  const kutu = await el.boundingBox().catch(() => null);
  if (kutu) {
    const x = kutu.x + kutu.width / 2, y = kutu.y + kutu.height / 2;
    await C.hareket(0.16, (t) => K.halka(x, y, t * 0.55));
    await el.click({ force: true }).catch(() => {});
    await C.hareket(0.20, (t) => K.halka(x, y, 0.55 + t * 0.45));
    await K.halka(0, 0, null);
  } else { await el.click({ force: true }).catch(() => {}); }
  if (sonra) await C.tut(sonra);
}
/** Görünümü yumuşakça kaydır / yakınlaştır */
async function gorunum(sn, hedef) {
  const bas = await ev(() => ({ ...window.dwgApp.state.view }));
  await C.hareket(sn, (t) => ev(([b, h, e]) => {
    const A = window.dwgApp, v = A.state.view;
    v.scale = b.scale * Math.pow(h.scale / b.scale, e);
    v.cx = b.cx + (h.cx - b.cx) * e; v.cy = b.cy + (h.cy - b.cy) * e;
    A.render();
  }, [bas, { scale: hedef.scale == null ? bas.scale : hedef.scale, cx: hedef.cx == null ? bas.cx : hedef.cx, cy: hedef.cy == null ? bas.cy : hedef.cy }, yumusak(t)]));
}
const zoomBB = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(180); };
/** Krokinin tamamını kadraja oturtan görünüm */
/*
 * Kadraj sağa doğru geniş tutulur: sağ kenardaki yüzen düğme sütunu (yaklaşık 90 px) planın
 * üstüne binmesin. Dikey ekranda yatay bir plan zaten genişliğe oturur; payı sağa vermek,
 * planı sola kaydırıp düğmelerin altını boş bırakır.
 */
const KADRAJ = [-1.5, -2.9, 15.8, 8.9];
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const sayi = () => ev(() => window.dwgApp.state.prims.length);
/* Türkçe altyazıda ondalık virgül, İngilizcesinde nokta: aynı sayı iki yazımla yazılır. */
const enSayi = (s) => String(s).replace(/\./g, '\u0001').replace(/,/g, '.').replace(/\u0001/g, ',');

const MARKA = '<div class="mark">DWG <i>OfficeZip</i></div><div class="cizgi"></div>';
const yap = (n) => !SADECE || SADECE.includes(n);
const atlanan = [];
async function sahne(n, ad, fn) {
  if (!yap(n)) return;
  C.sahne(n + ' · ' + ad);
  try { await fn(); } catch (e) { atlanan.push(n + ' · ' + ad + ' — ' + (e.message || e).slice(0, 140)); console.log('  ATLANDI:', (e.message || e).slice(0, 180)); }
}

// ==============================================================================================
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnNew2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true }, reduceMotion: true })); });
await page.reload(); await page.waitForSelector('#btnNew2'); await bekle(600);
await enjekte(); await sessiz();

// --- 1 · açılış -------------------------------------------------------------------------------
await sahne(1, 'açılış kartı', async () => {
  await K.kartMetin(MARKA + '<div class="alt1">Kroki sahada çizilir.<br>Telefonda, çevrimdışı.</div>');
  await K.kart(1);
  await C.tut(1.9);
  await C.hareket(0.40, (t) => K.kart(1 - yumusak(t)));
});

// --- 2 · boş çizim ------------------------------------------------------------------------------
await sahne(2, 'yeni boş çizim', async () => {
  await altAc('Yeni çizim · birim metre', 'New drawing · metres');
  await C.tut(0.7);
  await ev(() => window.dwgApp.showNewDoc());
  await page.waitForSelector('#docPanel .new-item', { state: 'visible' });
  await C.tut(0.8);
  await queueAnswers(page, 'kroki');
  await dugme('#docBody [data-new="dxf"]', 0.2);
  await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 30000 });
  await bekle(500);
  await enjekte();
  await ev(() => { if (document.getElementById('cmdBar').hidden) window.dwgApp.editor.act('cmdline'); });
  await zoomBB(KADRAJ);
  await K.altMetin('Yeni çizim · birim metre', 'New drawing · metres', 'ust'); await K.alt(1);
  await C.tut(0.8);
  await altKapat();
});

// --- 3 · komut satırı ---------------------------------------------------------------------------
await sahne(3, 'komut satırı ve öneri listesi', async () => {
  await katman('DUVAR', false).catch(() => {});
  await K0('-la'); await K0('M'); await K0('DUVAR');
  await altAc('Komut satırı: bildiğiniz adlar', 'Command line: names you know');
  await C.tut(0.5);
  await yazCanli('REC', { kare: 4 });            // öneri listesi açılır
  await C.tut(1.1);                               // RECTANG · RECOVER · RECOVERALL
  await yazCanli('TANG', { kare: 3 });
  await C.tut(0.5);
  await enterCanli(0.5);
  await altKapat();
});

// --- 4 · dış duvar: 100 m² ------------------------------------------------------------------------
await sahne(4, 'dış duvar 12,5 x 8,0 = 100 m²', async () => {
  await altAc('İki köşe: 12,5 × 8,0 m = 100 m²', '12.5 × 8.0 m = 100 m²');
  await KC('0,0', 0.45);
  await KC('@12.5,8', 0.9);
  await iptal();
  await C.tut(0.5);
  await altKapat();
});

// --- 5 · ötele: 20 cm duvar kabuğu ------------------------------------------------------------------
await sahne(5, 'ötele ile 20 cm duvar kalınlığı', async () => {
  await altAc('Ötele: 20 cm duvar', 'Offset: 20 cm wall');
  await yazCanli('OFFSET', { kare: 2 });
  await enterCanli(0.4);
  await KC('0.2', 0.4);
  await page.fill('#cmdInput', '');
  await dokunD(6.25, 0, 0.35);      // nesneye dokun
  await dokunD(6.25, 1.5, 0.6);     // hangi taraf
  await iptal();
  await C.tut(0.5);
  await altKapat();
});

// --- 6 · iç bölmeler + kapı boşluğu ---------------------------------------------------------------
await sahne(6, 'iç bölmeler ve 90 cm kapı boşluğu', async () => {
  await K0('-la'); await K0('N'); await K0('BOLME');
  await altAc('İç bölmeler · 90 cm kapı', 'Partitions · 90 cm door');
  const dik = async (a, b) => { await K0('rec'); await KC(a, 0.25, 1); await KC(b, 0.45, 1); await iptal(); };
  await dik('5.0,0.2', '@0.1,7.6');
  await dik('5.1,3.95', '@3.0,0.1');
  await dik('9.0,3.95', '@3.3,0.1');
  // kapı kanadı
  await K0('arc');
  await KC('8.1,4.0', 0.2, 1); await KC('8.74,4.26', 0.2, 1); await KC('9.0,4.9', 0.6, 1);
  await iptal();
  await C.tut(0.6);
  await altKapat();
});

// --- 7 · tarama + alan --------------------------------------------------------------------------
await sahne(7, 'tarama ve alan', async () => {
  await altAc('Kapalı alana dokun: tarama', 'Tap a closed area: hatch');
  await ev(() => { window.dwgApp.editor.curPattern = { name: 'ANSI31', scale: 0, angle: 0 }; });
  await K0('hatch');
  await dokunD(2.5, 4.0, 0.2);
  await bekle(600);
  const t = await toast();
  console.log('   tarama iletisi:', t);
  await enjekte();
  // Altyazıdaki sayı ELLE yazılmaz: uygulamanın kendi ilettiği alan okunur.
  const m = /([\d.,]+)\s*m²/.exec(t || '');
  await K.altMetin(m ? `Alanı uygulama hesapladı: ${m[1]} m²` : 'Tarama eklendi', m ? `Area computed by the app: ${enSayi(m[1])} m²` : 'Hatch added', 'ust');
  await K.alt(1);
  await C.tut(1.4);
  await iptal();
  await sessiz();
  await altKapat();
});

// --- 8 · oda adları -----------------------------------------------------------------------------
await sahne(8, 'oda adları', async () => {
  await K0('-la'); await K0('N'); await K0('YAZI');
  await altAc('Oda adları', 'Room names');
  const yazi = async (ad, nokta) => {
    await queueAnswers(page, ad, '0.35');
    await K0('text');
    await KC(nokta, 0.5, 1);
    await bekle(300); await iptal();
    await C.tut(0.25);
  };
  await yazi('SALON', '7.6,5.8');
  await yazi('MUTFAK', '7.6,2.0');
  await yazi('BANYO', '2.0,4.0');
  await C.tut(0.5);
  await altKapat();
});

// --- 9 · ölçülendirme ---------------------------------------------------------------------------
await sahne(9, 'ölçülendirme', async () => {
  await K0('-la'); await K0('N'); await K0('OLCU');
  await altAc('Ölçüyü uygulama yazar', 'Dimensions by the app');
  await yazCanli('DIMLINEAR', { kare: 2 });
  await enterCanli(0.3);
  await KC('0,0', 0.25, 1); await KC('12.5,0', 0.25, 1); await KC('6.25,-1.6', 0.7, 1);
  await iptal();
  await K0('dimaligned'); await K0('0,0'); await K0('0,8'); await K0('-1.6,4'); await iptal();
  // Ölçü yazısı öntanımlı olarak çok küçük (extents/200*2,2); telefonda okunsun diye büyütülür.
  const buyut = async (x, y) => {
    await queueAnswers(page, { h: 0.42, arrow: 0.34, exo: 0.1, exe: 0.2 });
    await K0('dimedit');
    const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
    const r = await page.locator('#viewport').boundingBox();
    await page.touchscreen.tap(r.x + s[0], r.y + s[1]);
    await bekle(420); await iptal();
  };
  await buyut(3.0, -1.6); await buyut(-1.6, 2.0);
  await sessiz(); await zoomBB(KADRAJ);
  const yazilar = await ev(() => window.dwgApp.state.prims.filter(p => p.k === 1 && p.info && p.info.t === 'DIMENSION').map(p => p.lines[0]));
  console.log('   ölçü yazıları:', JSON.stringify(yazilar));
  await enjekte();
  await K.altMetin(yazilar.length === 2 ? `Ölçüyü uygulama yazdı: ${yazilar[0]} · ${yazilar[1]}` : 'Ölçüyü uygulama yazar',
    yazilar.length === 2 ? `Dimensions by the app: ${enSayi(yazilar[0])} · ${enSayi(yazilar[1])}` : 'Dimensions by the app', 'ust');
  await K.alt(1);
  await C.tut(1.2);
  // Detay: ölçü yazısına yaklaş — dikey kadrajda plan ince bir şerit kalıyor, yakınlaşma
  // hem yazıyı okutur hem boş bandı kapatır.
  const v0 = await ev(() => ({ ...window.dwgApp.state.view }));
  await gorunum(1.2, { scale: v0.scale * 2.8, cx: 6.25, cy: -0.8 });
  await C.tut(1.0);
  await gorunum(1.0, { scale: v0.scale, cx: v0.cx, cy: v0.cy });
  await altKapat();
});

// --- 10 · katmanlar ------------------------------------------------------------------------------
await sahne(10, 'katmanlar', async () => {
  await altAc('Katmanlar: duvar · bölme · yazı · ölçü', 'Layers: wall · partition · text · dim');
  await dugme('#btnLayers', 0.9);
  await C.tut(0.7);
  /*
   * 412 px genişlikte katman paneli neredeyse bütün ekranı kaplar: söndürme etkisi panel
   * açıkken GÖRÜNMEZ. Bu yüzden söndür → paneli kapat → çizime bak → paneli aç → yak
   * sırası izlenir; izleyici farkı çizimin üstünde görür.
   */
  await dugme('#layerList [data-lon="YAZI"]', 0.5);
  await dugme('#btnLayers', 0.6);
  await altDegis('Yazı katmanı kapandı', 'Text layer switched off');
  await C.tut(1.3);
  await dugme('#btnLayers', 0.5);
  await dugme('#layerList [data-lon="YAZI"]', 0.4);
  await dugme('#btnLayers', 0.5);
  await altDegis('Ve geri geldi', 'And back again');
  await C.tut(1.0);
  await ev(() => { const e = document.getElementById('layerPanel'); if (e) e.hidden = true; window.dwgApp.render(); });
  await altKapat();
});


// --- 11 · parmakla nişan aparatı --------------------------------------------------------------
await sahne(11, 'parmakla nişan aparatı', async () => {
  /*
   * Dokunmatik CAD'in asıl sorunu: hedefi tam da göstermek istediğiniz anda parmağınız örter.
   * Uygulamanın çözümü imleci parmaktan AYIRMAKTIR — 56 px yukarıda, üstünde büyüteç, arada
   * ince kesikli kılavuz. Bu kadrajda anlatılacak en somut fark budur.
   */
  await ev(() => { window.dwgApp.osnap.setModes(['end', 'mid', 'int', 'cen', 'per', 'nea']); window.dwgApp.editor.act('t:line'); });
  await C.tut(0.4);
  await altAc('Parmak hedefi örtmez: imleç yukarıda', 'The finger never covers the target');
  const r = await page.locator('#viewport').boundingBox();
  const p0 = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [5.05, 4.0]);   // bölme kesişimi
  const fx = Math.round(p0[0]) + 26, fy = Math.round(p0[1]) + 40;
  await K.nokta(r.x + fx, r.y + fy);
  await olay('pointerdown', fx, fy, 9);
  await C.tut(0.8);                                   // uzun basış eşiği: nişan kurulur
  await C.hareket(1.0, async (t) => {
    const x = fx - 24 * yumusak(t), y = fy - 34 * yumusak(t);
    await K.nokta(r.x + x, r.y + y); await olay('pointermove', x, y, 9);
  });
  await C.tut(0.9);
  const h = await ev(() => { try { return window.dwgApp.__pickbox().hover; } catch (e) { return null; } });
  console.log('   nişan:', JSON.stringify(h));
  await olay('pointerup', fx - 24, fy - 34, 9);
  await K.nokta(null, null);
  await C.tut(0.9);
  await altKapat();
  await ev(() => { const e = document.getElementById('snapPick'); const x = e && e.querySelector('[data-sp="x"]'); if (x) x.click(); const T = window.dwgApp.editor.tools; if (T.running) T.cancel(); window.dwgApp.editor.sel.clear(); window.dwgApp.render(); });
  await C.tut(0.3);
});

// --- 12 · ölçüm ---------------------------------------------------------------------------------
await sahne(12, 'ölçüm', async () => {
  await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); window.dwgApp.setMode('measure'); });
  await C.tut(0.5);
  await altAc('Uçtan uca ölçü — uca kendiliğinden oturur', 'End to end, snapped to the corner');
  await dokunD(5.1, 0.2, 0.5);
  await dokunD(12.3, 3.95, 0.9);
  const okuma = await ev(() => { const e = document.getElementById('measureBody'); return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : ''; });
  console.log('   ölçüm:', okuma);
  await C.tut(1.3);
  await altKapat();
  await ev(() => { const b = document.getElementById('btnMeasureClose'); if (b) b.click(); window.dwgApp.setMode('view'); });
  await C.tut(0.3);
});

// --- 13 · kalınlık ve üç boyut ---------------------------------------------------------------------
await sahne(13, 'kalınlık ver, üç boyuta geç', async () => {
  /*
   * Krokinin üç boyuta çıkması, "çizim aracı" iddiasının en görünür kanıtıdır: aynı dosya,
   * aynı ekran, tek komut. Kalınlık komutu nesne ister; duvarları pencereyle seçip veririz.
   */
  await altAc('Duvarlara kalınlık ver', 'Give the walls a height');
  /*
   * Seçim KATMAN ADIYLA değil, geometriyle yapılır: katman adı yalnız o sahneler koşmuşsa
   * vardır (tek sahne denemesinde her şey "0" katmanına düşer ve seçim boş kalırdı). Kapalı
   * yollar duvarların kendisidir; yazı (k=1), ölçü ve tarama (fill) dışarıda kalır.
   */
  const secildi = await ev(() => {
    const A = window.dwgApp, E = A.editor;
    E.sel.clear();
    let n = 0;
    for (const p of A.state.prims) if (p.k === 0 && p.closed && !p.fill && p.ops && p.ops.length >= 3) { E.sel.add(p); n++; }
    A.render();
    return n;
  });
  if (!secildi) throw new Error('kalınlık verilecek kapalı yol yok');
  console.log('   seçilen duvar:', secildi);
  await C.tut(0.7);
  /*
   * Kalınlık aracı ÖNCE nesne, SONRA değer ister; değer bir form kutusundan değil KOMUT
   * SATIRINDAN gelir. Seçim zaten doluysa araç seçim adımını atlar ve doğrudan "Yüksekliği
   * yazın" der. (İlk denemede değer bir kutuya cevap sanılmıştı; hiçbir şey uygulanmadı ve
   * 3B'de plan düz kaldı — HUD "Z: 0 … 0" diyordu.)
   */
  await K0('thickness');
  const istem13 = await ev(() => document.getElementById('cmdText').textContent.trim());
  console.log('   kalınlık istemi:', istem13);
  await KC('3', 0.6, 3);
  await iptal();
  const ext = await ev(() => window.dwgApp.state.prims.filter(p => p.et === 'EXTRUDE').length);
  console.log('   yükseltilen duvar:', ext);
  await C.tut(0.5);
  await altDegis('Aynı kroki, üç boyutta', 'The same sketch, in 3D');
  await ev(() => window.dwgApp.editor.act('3d'));
  await bekle(1500);
  await enjekte(); await sessiz();
  await K.altMetin('Aynı kroki, üç boyutta', 'The same sketch, in 3D', 'ust'); await K.alt(1);
  const c = await ev(() => { try { return window.dwgApp.editor.view3d().counts; } catch (e) { return null; } });
  console.log('   3B sayaç:', JSON.stringify(c));
  await ev(() => { try { const v = window.dwgApp.editor.view3d(); v.set('turntable', true); } catch (e) {} });
  await C.hareket(3.0, () => {});
  await ev(() => { try { const v = window.dwgApp.editor.view3d(); v.set('turntable', false); } catch (e) {} });
  await altDegis('Görsel stiller tek dokunuşla', 'Visual styles, one tap each');
  // 'realistic' ile 'shaded' düz prizma yüzünde AYNI pikseli veriyor (fark yumuşak normal
  // ve parlaklıkta); videoda gerçekten farklı görünen üçlü seçildi.
  for (const st of ['shaded', 'conceptual', 'sketchy']) {
    await ev((x) => { try { const v = window.dwgApp.editor.view3d(); v.set('style', x); v.render(); } catch (e) {} }, st);
    await C.tut(0.8);
  }
  await altKapat();
  await ev(() => { try { if (window.dwgApp.editor.is3D()) window.dwgApp.editor.act('3d'); } catch (e) {} });
  await bekle(600);
  await enjekte(); await sessiz();
  await C.tut(0.3);
});

// --- 14 · hesaplayan tablo -------------------------------------------------------------------------
await sahne(14, 'tablo: değeri boş formüller hesaplanır', async () => {
  /*
   * Bu sahnenin kanıt değeri şuradadır: dosyada hazır değer YOKTUR. Kurum yazılımlarının ve
   * yaygın kütüphanelerin ürettiği tablolar tam olarak böyledir; eskiden o sütunlar boş
   * görünürdü. Ekranda dolu görünmesi, hesabı uygulamanın yaptığı anlamına gelir.
   */
  await altAc('Tabloyu da açar — ve hesaplar', 'Opens spreadsheets — and computes them', 'alt');
  await page.setInputFiles('#fileInput', METRAJ);
  await bekle(1400);
  await enjekte();
  await K.altMetin('Dosyada hazır değer yok; hesabı uygulama yaptı', 'No cached values; the app computed them', 'alt');
  await K.alt(1);
  const hucreler = await ev(() => {
    const t = document.querySelector('.xlsx-tbl'); if (!t) return null;
    return [...t.querySelectorAll('tr')].slice(1).map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent).join(' | '));
  });
  console.log('   tablo:', JSON.stringify(hucreler));
  await C.tut(2.6);
  await altDegis('Sekiz tablo biçimi', 'Eight spreadsheet formats', 'alt');
  await C.tut(1.6);
  await altKapat();
  await ev(() => { const dv = document.getElementById('docView'); const k = dv && dv.querySelector('[data-doc="close"]'); if (k) k.click(); else if (dv) dv.hidden = true; });
  await bekle(500);
  await enjekte(); await sessiz();
  await C.tut(0.3);
});

// --- 90 · kapanış ---------------------------------------------------------------------------------
await sahne(90, 'kapanış', async () => {
  await sessiz();
  await zoomBB(KADRAJ);
  await C.tut(1.0);
  await C.hareket(0.45, (t) => K.karart(yumusak(t)));
  await K.kartMetin(MARKA + '<div class="alt1">100 m² kroki, telefonda, on dakikada.</div><div class="kucuk">Android · çevrimdışı çalışır<br>Açma, ölçü, katman ve 3B görüntüleme ücretsiz</div>');
  await K.kart(1); await K.karart(0);
  await C.tut(2.6);
});

fs.writeFileSync(path.join(OUT, 'sahneler.json'), JSON.stringify({ fps: FPS, sahneler: C.gunluk, atlanan }, null, 1));
const kare = await hat.bitir();
console.log('\nkare:', kare, '=', (kare / FPS).toFixed(1), 'sn ·', path.join(OUT, 'promo2_ham.mp4'), fs.statSync(path.join(OUT, 'promo2_ham.mp4')).size, 'bayt');
if (atlanan.length) console.log('ATLANAN SAHNELER:\n - ' + atlanan.join('\n - '));
await ctx.close(); await browser.close(); srv.kill();
