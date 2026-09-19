/*
 * DWG OfficeZip — TANITIM VİDEOSU 2: "plan telefonda çizilir" (v7.91, iki dakika)
 *
 * Birinci tanıtım (tools/promo.mjs) var olan bir projeyi AÇIP gezdiriyordu. Bu ikincisi tersini
 * yapar: ekranda BOŞ bir çizimle başlar ve izleyicinin gözü önünde 16,0 x 10,0 m — 160 m² —
 * AYNALI İKİ DAİRELİ bir kat planı çizer. Kullanıcının verdiği plan budur: ortada sırt sırta
 * iki servis çekirdeği (mutfak + banyo), iki yanda oturma ve yatak odaları.
 *
 * NEDEN BU PLAN: simetrik olduğu için AYNALA komutu bir gösteri değil, işin doğal parçası olur.
 * Sol daire çizilir, tek komutla sağ daire doğar. Bir çizim aracının işe yaradığı en somut an.
 *
 * MOBİLYA da sol dairede çizilir (10. sahne, MOBILYA katmanı) ve aynayla sağa geçer: yatak,
 * gardırop, koltuk, mutfak tezgâhı ve donatı. Üç boyuta geçerken duvara 2,90 m, mobilyaya
 * 0,60 m yükseklik verilir — tek yükseklik yatağı gardırop boyunda gösterir, yani planı
 * doğrulamak yerine yalanlar.
 *
 * ÜÇ KURAL — bozulmaması için buraya yazıldı:
 *
 * 1. ÖZELLİĞİN ÜSTÜNE YAZI GELMEZ (kullanıcının açık talimatı). Altyazı, gösterilecek şeyden
 *    ÖNCE görünür, söyleyeceğini söyler ve KAYBOLUR; asıl an ekranda yalnız uygulama vardır.
 *    Sonuç okunacaksa (tarama alanı, ölçü metni) iş bittikten sonra, çizimin dışında kalan
 *    boş banda yazılır. Panel açan sahnelerde (katman, yakalama, tablo, 3B) altyazı hiç durmaz.
 *
 * 2. MARKA ADI GEÇMEZ (kullanıcının açık talimatı). Komut adları sektörün ortak dilidir ve
 *    ekranda görünür; altyazı bunu "komut satırı: bildiğiniz adlar" diye anar. Başka hiçbir
 *    yazılımın adı ne altyazıda ne kartlarda geçer.
 *
 * 3. HİÇBİR SAYI ELLE YAZILMAZ. Tarama alanı uygulamanın kendi iletisinden, ölçü metinleri
 *    ölçü priminden, 3B sayaçları görünümün kendisinden okunur ve altyazıya oradan geçirilir.
 *
 * KROKİ SÖZLEŞMESİ: bölme duvarları SÜREKLİ çizilir, kapılar üstlerine yay + kanat çizgisi
 * olarak konur. Böylece her oda kapalı bir alandır — tarama ve alan ölçümü gerçekten çalışır.
 * Hızlı krokide yaygın olan yazımdır; duvarı kesmek ayrı bir iştir ve bu videonun konusu değil.
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

// ---------------------------------------------------------------------------------
// Sahne 18'in tablosu: içinde BİLEREK hazır değer yoktur
// ---------------------------------------------------------------------------------
/*
 * Formül hücrelerinde yalnız <f> vardır, <v> yoktur. Kurum yazılımlarının ve yaygın
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
const METRAJ = path.join(OUT, 'mahal_listesi.xlsx');
fs.writeFileSync(METRAJ, zipYaz([
  ['[Content_Types].xml', '<Types/>'],
  ['xl/workbook.xml', `<workbook xmlns="${SML}" xmlns:r="${RNS}"><sheets><sheet name="Mahal listesi" sheetId="1" r:id="rId1"/></sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${PKGNS}"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`],
  ['xl/sharedStrings.xml', `<sst xmlns="${SML}"><si><t>Mahal</t></si><si><t>Adet</t></si><si><t>Alan m²</t></si><si><t>Toplam m²</t></si>`
    + `<si><t>Oturma odası</t></si><si><t>Yatak odası</t></si><si><t>Mutfak</t></si><si><t>Banyo</t></si><si><t>TOPLAM</t></si><si><t>Ortak alan payı</t></si><si><t>Tarih</t></si></sst>`],
  ['xl/styles.xml', `<styleSheet xmlns="${SML}"><numFmts count="1"><numFmt numFmtId="166" formatCode="#,##0.00 &quot;m²&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="166"/><xf numFmtId="14"/><xf numFmtId="9"/></cellXfs></styleSheet>`],
  ['xl/worksheets/sheet1.xml', `<worksheet xmlns="${SML}"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>2</v></c><c r="C2"><v>28.3</v></c><c r="D2" s="1"><f>B2*C2</f></c></row>
<row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3"><v>2</v></c><c r="C3"><v>31.4</v></c><c r="D3" s="1"><f>B3*C3</f></c></row>
<row r="4"><c r="A4" t="s"><v>6</v></c><c r="B4"><v>2</v></c><c r="C4"><v>6.6</v></c><c r="D4" s="1"><f>B4*C4</f></c></row>
<row r="5"><c r="A5" t="s"><v>7</v></c><c r="B5"><v>2</v></c><c r="C5"><v>5.2</v></c><c r="D5" s="1"><f>B5*C5</f></c></row>
<row r="6"><c r="A6" t="s"><v>8</v></c><c r="B6"><f>SUM(B2:B5)</f></c><c r="D6" s="1"><f>SUM(D2:D5)</f></c></row>
<row r="7"><c r="A7" t="s"><v>9</v></c><c r="C7" s="3"><v>0.18</v></c><c r="D7" s="1"><f>D6*C7</f></c></row>
<row r="8"><c r="A8" t="s"><v>10</v></c><c r="B8" s="2"><v>45923</v></c></row>
</sheetData></worksheet>`],
]));

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, acceptDownloads: true });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 160)));
page.on('dialog', (d) => d.dismiss().catch(() => {}));
/* Kaydetme sahnesinin KANITI: tarayıcıya gerçekten bir dosya indi mi? */
const inenler = [];
page.on('download', (d) => { inenler.push(d.suggestedFilename()); });

const hat = hatKur(FFMPEG, path.join(OUT, 'promo2_ham.mp4'));
const C = cekim(page, hat);
const ev = (fn, a) => page.evaluate(fn, a);
const K = {
  altMetin: (tr, en, yer) => ev(([a, b, c]) => window.__promo.altMetin(a, b, c), [tr, en || '', yer || 'ust']),
  alt: (p) => ev((x) => window.__promo.alt(x), p),
  kartMetin: (h) => ev((x) => window.__promo.kartMetin(x), h),
  kart: (p) => ev((x) => window.__promo.kart(x), p),
  rozetMetin: (h) => ev((x) => window.__promo.rozetMetin(x), h),
  rozet: (p) => ev((x) => window.__promo.rozet(x), p),
  karart: (p) => ev((x) => window.__promo.karart(x), p),
  halka: (x, y, p) => ev(([a, b, c]) => window.__promo.halka(a, b, c), [x, y, p]),
  nokta: (x, y) => ev(([a, b]) => window.__promo.nokta(a, b), [x, y]),
};
const olay = (tip, x, y, id = 3) => ev(([t, a, b, i]) => {
  const vp = document.getElementById('viewport'), r = vp.getBoundingClientRect();
  vp.dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', isPrimary: i === 3 || i === 11, bubbles: true, cancelable: true, clientX: r.left + a, clientY: r.top + b, button: t === 'pointerdown' ? 0 : -1, buttons: t === 'pointerdown' || t === 'pointermove' ? 1 : 0 }));
}, [tip, x, y, id]);
const enjekte = () => page.evaluate(KAPLAMA);
const sessiz = () => ev(() => { for (const id of ['toast', 'tour']) { const e = document.getElementById(id); if (e) e.hidden = true; } });
const bekle = (ms) => page.waitForTimeout(ms);

// ---------------------------------------------------------------------------------
// Altyazı — 1. kural: gösterilecek şeyin ÜSTÜNE gelmez
// ---------------------------------------------------------------------------------
async function altAc(tr, en, yer) { await K.altMetin(tr, en, yer || 'ust'); await C.hareket(0.26, (t) => K.alt(yumusak(t))); }
async function altKapat() { await C.hareket(0.20, (t) => K.alt(1 - yumusak(t))); }
/** Önce söyle, sonra sus: asıl an ekranda yalnız uygulama kalır */
async function anlat(tr, en, sn = 1.5, yer) { await altAc(tr, en, yer); await C.tut(sn); await altKapat(); }
/** İş bittikten sonra sonucu okut (çizimin dışındaki boş bantta) */
async function sonuc(tr, en, sn = 1.8, yer) { await altAc(tr, en, yer); await C.tut(sn); await altKapat(); }

// ---------------------------------------------------------------------------------
// Komut satırı
// ---------------------------------------------------------------------------------
/*
 * Komut satırı sessizce doldurulabilirdi (page.fill), ama videonun anlattığı şey tam olarak
 * BU: adı yazıyorsunuz, araç açılıyor. Harf harf yazılır ve her harfte kare alınır.
 */
async function yazCanli(s, { kare = 2 } = {}) {
  await page.click('#cmdInput');
  for (const ch of s) { await page.type('#cmdInput', ch, { delay: 0 }); for (let i = 0; i < kare; i++) await C.kare(); }
}
async function enterCanli(sonra = 0.25) {
  const kutu = await page.locator('#cmdEnter').boundingBox();
  if (kutu) {
    const x = kutu.x + kutu.width / 2, y = kutu.y + kutu.height / 2;
    await C.hareket(0.14, (t) => K.halka(x, y, t * 0.6));
    await page.click('#cmdEnter').catch(() => {});
    await C.hareket(0.16, (t) => K.halka(x, y, 0.6 + t * 0.4));
    await K.halka(0, 0, null);
  } else { await page.click('#cmdEnter').catch(() => {}); }
  if (sonra) await C.tut(sonra);
}
/** Kayda GİREN giriş */
const KC = async (s, sonra = 0.25, kare = 2) => { await yazCanli(s, { kare }); await enterCanli(sonra); };
/** Kayda GİRMEYEN (sahne arası hazırlık) giriş */
const K0 = async (s) => { await page.fill('#cmdInput', s); await bekle(60); await page.click('#cmdEnter'); await bekle(170); };
const iptal = async () => { await ev(() => { const E = window.dwgApp.editor; if (E.tools && E.tools.running) E.tools.cancel(); if (E.sel) E.sel.clear(); }); await bekle(100); };
const istem = () => ev(() => document.getElementById('cmdText').textContent.trim());
const toast = () => ev(() => { const el = document.getElementById('toast'); if (!el || el.hidden) return ''; const tx = el.querySelector('.tx'); return (tx ? tx.textContent : el.textContent).trim(); });
const sayi = () => ev(() => window.dwgApp.state.prims.length);
/* Türkçe altyazıda ondalık virgül, İngilizcesinde nokta: aynı sayı iki yazımla yazılır. */
const enSayi = (s) => String(s).replace(/\./g, '\u0001').replace(/,/g, '.').replace(/\u0001/g, ',');

// ---------------------------------------------------------------------------------
// Dokunuş ve görünüm
// ---------------------------------------------------------------------------------
async function dokunD(x, y, sonra = 0.3) {
  await sessiz();
  const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
  const r = await page.locator('#viewport').boundingBox();
  const px = r.x + s[0], py = r.y + s[1];
  await C.hareket(0.16, (t) => K.halka(px, py, t * 0.55));
  await page.touchscreen.tap(px, py);
  await C.hareket(0.20, (t) => K.halka(px, py, 0.55 + t * 0.45));
  await K.halka(0, 0, null);
  if (sonra) await C.tut(sonra);
}
async function dugme(sec, sonra = 0.45) {
  const el = page.locator(sec).first();
  const kutu = await el.boundingBox().catch(() => null);
  if (kutu) {
    const x = kutu.x + kutu.width / 2, y = kutu.y + kutu.height / 2;
    await C.hareket(0.14, (t) => K.halka(x, y, t * 0.55));
    await el.click({ force: true }).catch(() => {});
    await C.hareket(0.18, (t) => K.halka(x, y, 0.55 + t * 0.45));
    await K.halka(0, 0, null);
  } else { await el.click({ force: true }).catch(() => {}); }
  if (sonra) await C.tut(sonra);
}
async function gorunum(sn, hedef) {
  const bas = await ev(() => ({ ...window.dwgApp.state.view }));
  await C.hareket(sn, (t) => ev(([b, h, e]) => {
    const A = window.dwgApp, v = A.state.view;
    v.scale = b.scale * Math.pow(h.scale / b.scale, e);
    v.cx = b.cx + (h.cx - b.cx) * e; v.cy = b.cy + (h.cy - b.cy) * e;
    A.render();
  }, [bas, { scale: hedef.scale == null ? bas.scale : hedef.scale, cx: hedef.cx == null ? bas.cx : hedef.cx, cy: hedef.cy == null ? bas.cy : hedef.cy }, yumusak(t)]));
}
const zoomBB = async (bb) => { await ev((b) => window.dwgApp.zoomExtents(b), bb); await bekle(160); };
/*
 * Kadraj sağa doğru geniştir: sağ kenardaki yüzen düğme sütunu (yaklaşık 90 CSS px, ekranın
 * dörtte biri) planın üstüne binmesin. 16 m'lik plan 23 m'lik bir pencereye oturunca
 * genişliğin yaklaşık %70'ini kaplar ve düğmelerin altı boş kalır.
 */
const KADRAJ = [-2.6, -4.4, 20.4, 11.2];
/*
 * SOL DAİRE KADRAJI. 16 x 10 m'lik bir plan dikey ekranda ince bir şerit kalır: genişliğe
 * oturur, üstte ve altta koca bir boşluk bırakır. Çizim sahneleri bu yüzden YALNIZ SOL
 * DAİREYE yaklaşır — çizilen şey okunur büyüklükte olur. Ayna anında görünüm planın
 * tamamına açılır; sağ dairenin doğuşu o açılışla birlikte görülür.
 */
const KADRAJ_SOL = [-1.2, -0.8, 10.8, 10.8];

const MARKA = '<div class="mark">DWG <i>OfficeZip</i></div><div class="cizgi"></div>';
const yap = (n) => !SADECE || SADECE.includes(n);
const atlanan = [];
async function sahne(n, ad, fn) {
  if (!yap(n)) return;
  C.sahne(n + ' · ' + ad);
  try { await fn(); } catch (e) { atlanan.push(n + ' · ' + ad + ' — ' + (e.message || e).slice(0, 140)); console.log('  ATLANDI:', (e.message || e).slice(0, 200)); }
}
/*
 * -LAYER'ın 'N' (New) seçeneği katmanı YARATIR ama GEÇERLİ YAPMAZ; AutoCAD'de de böyledir,
 * geçerli yapan 'M' (Make). İlk çekimde 'N' kullanıldığı için altı katman yaratılıyor ama
 * her nesne '0' katmanında kalıyordu: 14. sahnede yazı/ölçü söndürülünce ekranda hiçbir şey
 * değişmiyor, 18. sahnede mobilya duvardan ayırt edilemiyordu.
 */
const katmanYeni = async (ad) => { await K0('-la'); await K0('M'); await K0(ad); };
/** Dikdörtgen: iki köşe, kayda girerek */
const dikC = async (a, b, sonra = 0.35) => { await K0('rec'); await KC(a, 0.2, 1); await KC(b, sonra, 1); await iptal(); };
/** Dikdörtgen: kayda girmeden (sahne arası) */
const dik0 = async (a, b) => { await K0('rec'); await K0(a); await K0(b); await iptal(); };

// ==============================================================================================
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnNew2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true }, reduceMotion: true })); });
await page.reload(); await page.waitForSelector('#btnNew2'); await bekle(600);
await enjekte(); await sessiz();

// --- 1 · açılış -------------------------------------------------------------------------------
await sahne(1, 'açılış kartı', async () => {
  await K.kartMetin(MARKA + '<div class="alt1">Kat planı sahada çizilir.<br>Telefonda, çevrimdışı.</div>');
  await K.kart(1);
  await C.tut(2.0);
  await C.hareket(0.40, (t) => K.kart(1 - yumusak(t)));
});

// --- 2 · boş çizim ------------------------------------------------------------------------------
await sahne(2, 'yeni boş çizim', async () => {
  await anlat('Yeni çizim · birim metre', 'New drawing · metres', 1.2);
  await ev(() => window.dwgApp.showNewDoc());
  await page.waitForSelector('#docPanel .new-item', { state: 'visible' });
  await C.tut(0.7);
  await queueAnswers(page, 'kat_plani');
  await dugme('#docBody [data-new="dxf"]', 0.2);
  await page.waitForFunction(() => window.dwgApp && window.dwgApp.state.hasDoc && document.getElementById('loading').hidden, null, { timeout: 30000 });
  await bekle(450);
  await enjekte();
  await ev(() => { if (document.getElementById('cmdBar').hidden) window.dwgApp.editor.act('cmdline'); });
  await zoomBB(KADRAJ);
  await C.tut(0.5);
});

// --- 3 · komut satırı ---------------------------------------------------------------------------
await sahne(3, 'komut satırı ve öneri listesi', async () => {
  await katmanYeni('DUVAR');
  await anlat('Komut satırı: bildiğiniz adlar', 'Command line: names you know', 1.3);
  await yazCanli('REC', { kare: 4 });          // öneri listesi açılır
  await C.tut(1.2);                             // RECTANG · RECOVER · RECOVERALL
  await yazCanli('TANG', { kare: 3 });
  await C.tut(0.4);
  await enterCanli(0.4);
});

// --- 4 · dış duvar ------------------------------------------------------------------------------
await sahne(4, 'dış duvar 16,0 x 10,0 = 160 m²', async () => {
  await KC('0,0', 0.4);
  await KC('@16,10', 0.8);
  await iptal();
  await sonuc('16,0 × 10,0 m = 160 m²', '16.0 × 10.0 m = 160 m²', 1.5);
});

// --- 5 · ötele ----------------------------------------------------------------------------------
await sahne(5, 'ötele ile 25 cm duvar kalınlığı', async () => {
  await anlat('Ötele: 25 cm duvar', 'Offset: 25 cm wall', 1.2);
  await yazCanli('OFFSET', { kare: 2 });
  await enterCanli(0.35);
  await KC('0.25', 0.35);
  await page.fill('#cmdInput', '');
  await dokunD(8, 0, 0.3);        // alt duvara dokun
  await dokunD(8, 1.5, 0.55);     // içeri taraf
  await iptal();
  await C.tut(0.3);
  await zoomBB(KADRAJ_SOL);
  await C.tut(0.4);
});

// --- 6 · iç bölmeler ----------------------------------------------------------------------------
await sahne(6, 'iç bölmeler ve servis çekirdeği', async () => {
  await katmanYeni('BOLME');
  await anlat('İç bölmeler ve servis çekirdeği', 'Partitions and the service core', 1.4);
  await dikC('6.6,0.25', '@0.1,9.5', 0.3);      // çekirdek duvarı
  await dikC('7.95,0.25', '@0.05,9.5', 0.3);    // iki daire arası ayırıcının YARISI: aynası öbür yarıyı tamamlar
  await dikC('0.25,5.2', '@6.35,0.1', 0.3);     // oturma / yatak ayırıcı
  await dikC('6.7,4.4', '@1.25,0.1', 0.5);      // mutfak / banyo ayırıcı
  await C.tut(0.4);
});

// --- 7 · kapılar --------------------------------------------------------------------------------
await sahne(7, 'kapılar: kanat ve açılım yayı', async () => {
  await katmanYeni('KAPI');
  await anlat('Kapı kanadı ve açılım yayı', 'Door leaf and swing arc', 1.4);
  /* Üç kapı: giriş (1,00 m), yatak odası (0,90 m), banyo (0,90 m). Yay üç noktayla çizilir;
     ortadaki nokta kirişin DIŞINDA olmalı, yoksa üç nokta doğrusal olur ve yay kurulmaz. */
  const kapi = async (yayA, yayB, yayC, kanatA, kanatB) => {
    await K0('arc'); await KC(yayA, 0.15, 1); await KC(yayB, 0.15, 1); await KC(yayC, 0.3, 1); await iptal();
    await K0('line'); await K0(kanatA); await K0(kanatB); await iptal();
  };
  await kapi('1.0,9.75', '1.293,9.043', '2.0,8.75', '2.0,9.75', '2.0,8.75');      // giriş
  await kapi('3.3,5.3', '3.564,4.664', '4.2,4.4', '4.2,5.3', '4.2,4.4');          // yatak odası
  await kapi('6.6,1.8', '5.964,2.064', '5.7,2.7', '6.6,2.7', '5.7,2.7');          // banyo
  await C.tut(0.5);
});

// --- 8 · pencereler + dizi ------------------------------------------------------------------------
await sahne(8, 'pencere çiz, diziyle çoğalt', async () => {
  await katmanYeni('PENCERE');
  await anlat('Bir pencere çiz, diziyle çoğalt', 'Draw one window, array the rest', 1.4);
  await dikC('1.2,0', '@1.6,0.25', 0.4);
  // Dikdörtgen dizi: iki kopya, 3,2 m aralıkla — alt duvardaki ikinci pencere
  const n0 = await sayi();
  await ev(() => { const A = window.dwgApp, E = A.editor; E.sel.clear(); E.sel.add(A.state.prims[A.state.prims.length - 1]); A.render(); });
  // Form komuttan ÖNCE kuyruğa konur: seçim doluyken araç seçim adımını atlayıp formu
  // doğrudan açabilir; sonradan kuyruğa koymak o durumda geç kalırdı.
  await queueAnswers(page, { nx: 2, ny: 1, dx: 3.2, dy: 0, dz: 0 });
  await K0('arrayrect');
  const fi = await istem();
  if (/seçin/i.test(fi)) { await page.click('#cmdBtns [data-cmd="finish"]').catch(() => {}); }
  await bekle(600); await iptal();
  console.log('   dizi sonrası yeni prim:', (await sayi()) - n0);
  await C.tut(0.6);
  // sol duvarda iki, üst duvarda bir pencere
  await dik0('0,2.4', '@0.25,1.4');
  await dik0('0,6.4', '@0.25,1.4');
  await dik0('3.6,9.75', '@1.8,0.25');
  await C.tut(0.6);
});

// --- 9 · tarama ve alan -----------------------------------------------------------------------------
await sahne(9, 'ıslak hacim taraması ve alan', async () => {
  await anlat('Kapalı alana dokun: tarama', 'Tap a closed area: hatch', 1.2);
  await ev(() => { window.dwgApp.editor.curPattern = { name: 'ANSI31', scale: 0, angle: 0 }; });
  await K0('hatch');
  // Tarama AYNADAN ÖNCE yapılır, bu yüzden yalnız SOL banyo taranır: sağ daire henüz yok.
  // Sağdaki taramayı 11. sahnedeki ayna getirir — aynı iş iki kez yapılmaz.
  await dokunD(7.3, 2.3, 0.2);
  await bekle(550);
  const t1 = await toast();
  console.log('   tarama iletisi:', t1);
  await iptal(); await sessiz();
  await enjekte();
  const m = /([\d.,]+)\s*m²/.exec(t1 || '');
  await sonuc(m ? `Banyo alanı: ${m[1]} m² — uygulamanın hesabı` : 'Tarama eklendi',
    m ? `Bathroom area: ${enSayi(m[1])} m² — computed by the app` : 'Hatch added', 2.0);
});

// --- 10 · mobilya -----------------------------------------------------------------------------------
await sahne(10, 'mobilya: yatak, dolap, koltuk, tezgah', async () => {
  /*
   * Mobilya AYNADAN ÖNCE çizilir: sol dairenin donatısı tek komutla sağa geçer, iki kez
   * çizilmez. Kendi katmanındadır (MOBILYA) — 18. sahnede duvarlara 2,90 m, mobilyaya 0,60 m
   * yükseklik verilirken ayrım oradan yapılır; tek yükseklik verilseydi yatak dolap boyunda
   * çıkardı. Ölçüler gerçek: tek kişilik yatak 1,60 × 2,10, gardırop 2,40 × 0,60, koltuk
   * 0,90 × 2,20, mutfak tezgâhı 0,60 derinliğinde.
   */
  await katmanYeni('MOBILYA');
  await anlat('Mobilyayı da çizer', 'Furniture too', 1.3);
  await dikC('0.45,1.5', '@1.6,2.1', 0.3);      // yatak
  await dikC('2.7,0.45', '@2.4,0.6', 0.3);      // gardırop
  await dikC('0.45,5.6', '@0.9,2.2', 0.3);      // koltuk
  await dikC('6.7,4.5', '@0.6,5.25', 0.4);      // mutfak tezgâhı
  // Kalan donatı hızlı geçilir: izleyici kuralı ilk dördünde zaten gördü.
  await dik0('0.45,3.35', '@1.6,0.25');         // yastık
  await dik0('0.45,3.8', '@0.5,0.5');           // komodin
  await dik0('1.6,5.6', '@0.9,0.9');            // berjer
  await dik0('1.75,6.95', '@1.1,0.6');          // sehpa
  await dik0('3.6,8.3', '@1.8,1.0');            // yemek masası
  await dik0('6.78,6.6', '@0.45,0.5');          // evye
  await dik0('6.78,8.3', '@0.45,0.5');          // ocak
  await dik0('6.7,0.25', '@1.25,0.9');          // duş teknesi
  await dik0('7.35,2.9', '@0.4,0.6');           // klozet
  await dik0('6.75,3.7', '@0.55,0.4');          // lavabo
  await C.tut(0.8);
});

// --- 11 · AYNALA ------------------------------------------------------------------------------------
await sahne(11, 'aynala: sol daireden sağ daire', async () => {
  /*
   * Videonun can alıcı sahnesi. Plan simetrik olduğu için sol dairenin tamamı tek komutla
   * sağa geçer. Seçime dış duvar ve kabuğu GİRMEZ (ilk iki ilkel); onlar iki daireyi birden
   * saran tek kabuktur. Ayna ekseni düşeydir (x = 8,00) ve "orijinal kalsın" açıktır.
   */
  await anlat('Plan simetrik: sol daire mobilyasıyla aynalanır', 'Symmetric plan: mirror the left flat with its furniture', 1.8);
  const secildi = await ev(() => {
    const A = window.dwgApp, E = A.editor;
    E.sel.clear();
    let n = 0;
    A.state.prims.forEach((p, i) => { if (i >= 2) { E.sel.add(p); n++; } });   // 0-1: dış duvar + kabuk
    A.render();
    return n;
  });
  console.log('   aynalanacak nesne:', secildi);
  await C.tut(0.8);
  await K0('mirror');
  let i1 = await istem();
  if (/seçin/i.test(i1)) { await page.click('#cmdBtns [data-cmd="finish"]').catch(() => {}); await bekle(250); i1 = await istem(); }
  console.log('   ayna istemi:', i1);
  // "Orijinal kalsın" açık olmalı: yoksa sol daire taşınır, kopyalanmaz
  const keepOn = await ev(() => { const b = document.querySelector('#cmdBtns [data-cmd="mirrorkeep"]'); return b ? b.getAttribute('aria-pressed') === 'true' || b.classList.contains('on') : null; });
  console.log('   orijinal kalsın:', keepOn);
  if (keepOn === false) await dugme('#cmdBtns [data-cmd="mirrorkeep"]', 0.4);
  await dugme('#cmdBtns [data-cmd="mirrory"]', 0.5);   // düşey ayna çizgisi: tek nokta yeter
  const n0 = await sayi();
  await KC('8,5', 0.5);
  await iptal();
  const eklenen = (await sayi()) - n0;
  console.log('   aynadan gelen nesne:', eklenen);
  await sessiz();
  // Sağ daire kadrajın DIŞINDA doğdu; görünüm yumuşakça açılınca izleyici onu ortaya
  // çıkarken görür. Sert bir kesme aynı bilgiyi verir ama anı harcardı.
  const tam = await ev(([b]) => { const A = window.dwgApp; A.zoomExtents(b); return { ...A.state.view }; }, [KADRAJ]);
  await ev(([b]) => window.dwgApp.zoomExtents(b), [KADRAJ_SOL]);
  await gorunum(1.3, tam);
  await C.tut(0.6);
  await sonuc(`Tek komutla ${eklenen} nesne aynalandı`, `${eklenen} objects, one command`, 1.8);
});

// --- 12 · oda adları --------------------------------------------------------------------------------
await sahne(12, 'oda adları (Türkçe)', async () => {
  /* Yazı AYNADAN SONRA yazılır: aynalanan yazı ters okunurdu. */
  await katmanYeni('YAZI');
  await anlat('Oda adları', 'Room names', 1.1);
  /*
   * Yazı soldan sağa akar; sağ dairede aynı x'i kullanmak adları ortada üst üste bindirir
   * (ilk çekimde "MUTFAKOTURMA ODASI" çıktı). Sağ daire için yerleşim de aynalanır: yazı
   * SAĞ kenardan içeri doğru konumlanır. Yükseklik 0,38 m — telefonda okunan en küçük boy.
   */
  const H = 0.38;
  const yazi = async (ad, nokta, kayda = true) => {
    await queueAnswers(page, ad, String(H));
    await K0('text');
    if (kayda) await KC(nokta, 0.3, 1); else await K0(nokta);
    await bekle(240); await iptal();
  };
  await yazi('OTURMA ODASI', '0.7,8.4');
  await yazi('MUTFAK', '4.4,8.4');
  await yazi('YATAK ODASI', '0.7,3.2');
  await yazi('BANYO', '4.9,1.4');
  await yazi('OTURMA ODASI', '12.4,8.4', false);
  await yazi('MUTFAK', '9.6,8.4', false);
  await yazi('YATAK ODASI', '12.6,3.2', false);
  await yazi('BANYO', '9.6,1.4', false);
  await sessiz(); await zoomBB(KADRAJ);
  await C.tut(1.0);
});

// --- 13 · ölçülendirme -------------------------------------------------------------------------------
await sahne(13, 'ölçülendirme', async () => {
  await katmanYeni('OLCU');
  await anlat('Ölçüyü uygulama yazar', 'The app writes the dimension', 1.3);
  await yazCanli('DIMLINEAR', { kare: 2 });
  await enterCanli(0.25);
  await KC('0,0', 0.2, 1); await KC('16,0', 0.2, 1); await KC('8,-1.7', 0.5, 1);
  await iptal();
  await K0('dimaligned'); await K0('0,0'); await K0('0,10'); await K0('-1.8,5'); await iptal();
  await K0('dimlinear'); await K0('0,0'); await K0('8,0'); await K0('4,-3.3'); await iptal();
  // Ölçü yazısı öntanımlı olarak çok küçüktür (extents / 200 * 2,2); telefonda okunsun diye büyütülür
  const buyut = async (x, y) => {
    await queueAnswers(page, { h: 0.45, arrow: 0.36, exo: 0.12, exe: 0.22 });
    await K0('dimedit');
    const s = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [x, y]);
    const r = await page.locator('#viewport').boundingBox();
    await page.touchscreen.tap(r.x + s[0], r.y + s[1]);
    await bekle(400); await iptal();
  };
  await buyut(12.0, -1.7); await buyut(-1.8, 7.0); await buyut(6.0, -3.3);
  await sessiz(); await zoomBB(KADRAJ);
  const yazilar = await ev(() => window.dwgApp.state.prims.filter(p => p.k === 1 && p.info && p.info.t === 'DIMENSION').map(p => p.lines[0]));
  console.log('   ölçü yazıları:', JSON.stringify(yazilar));
  await enjekte();
  const uc = yazilar.slice(0, 3).map(x => String(x).replace(/\s*m$/, '')).join(' · ');
  await sonuc(uc ? `Ölçüler: ${uc} m` : 'Ölçüler yazıldı', uc ? `Dimensions: ${enSayi(uc)} m` : 'Dimensions written', 1.8);
});


// --- 14 · katmanlar -----------------------------------------------------------------------------------
await sahne(14, 'katmanlar', async () => {
  await anlat('Yedi katman: duvar · bölme · kapı · pencere · mobilya · yazı · ölçü',
    'Seven layers: wall, partition, door, window, furniture, text, dim', 2.2);
  /* Panel 412 px genişlikte bütün ekranı kaplar: söndürme etkisi panel AÇIKKEN görünmez.
     Sıra: söndür → paneli kapat → çizime bak → aç → yak. */
  await dugme('#btnLayers', 0.7);
  await dugme('#layerList [data-lon="YAZI"]', 0.35);
  await dugme('#layerList [data-lon="OLCU"]', 0.35);
  await dugme('#btnLayers', 1.4);
  await dugme('#btnLayers', 0.5);
  await dugme('#layerList [data-lon="YAZI"]', 0.3);
  await dugme('#layerList [data-lon="OLCU"]', 0.3);
  await dugme('#btnLayers', 0.9);
  await ev(() => { const e = document.getElementById('layerPanel'); if (e) e.hidden = true; window.dwgApp.render(); });
  await C.tut(0.4);
});

// --- 15 · yakalama kipleri -----------------------------------------------------------------------------
await sahne(15, 'yakalama kipleri', async () => {
  await anlat('On dört yakalama kipi', 'Fourteen snap modes', 1.4);
  await K0('osnap');
  await page.waitForSelector('#osGrid', { state: 'visible', timeout: 8000 });
  await C.tut(1.8);
  const n = await ev(() => document.querySelectorAll('#osGrid [data-os]').length);
  console.log('   yakalama kartı:', n);
  await ev(() => window.dwgApp.onBack());
  await bekle(350); await enjekte(); await sessiz();
  await C.tut(0.3);
});

// --- 16 · parmakla nişan aparatı -----------------------------------------------------------------------
await sahne(16, 'parmakla nişan aparatı', async () => {
  await anlat('Parmak hedefi örtmez: imleç yukarıda', 'The finger never covers the target', 1.6);
  await ev(() => { window.dwgApp.osnap.setModes(['end', 'mid', 'int', 'cen', 'per', 'nea']); window.dwgApp.editor.act('t:line'); });
  await C.tut(0.3);
  const r = await page.locator('#viewport').boundingBox();
  const p0 = await ev(([a, b]) => window.dwgApp.toScreen(a, b), [6.65, 5.25]);   // bölme kesişimi
  const fx = Math.round(p0[0]) + 26, fy = Math.round(p0[1]) + 40;
  await K.nokta(r.x + fx, r.y + fy);
  await olay('pointerdown', fx, fy, 9);
  await C.tut(0.8);
  await C.hareket(0.9, async (t) => {
    const x = fx - 24 * yumusak(t), y = fy - 34 * yumusak(t);
    await K.nokta(r.x + x, r.y + y); await olay('pointermove', x, y, 9);
  });
  await C.tut(0.9);
  const h = await ev(() => { try { return window.dwgApp.__pickbox().hover; } catch (e) { return null; } });
  console.log('   nişan:', JSON.stringify(h));
  await olay('pointerup', fx - 24, fy - 34, 9);
  await K.nokta(null, null);
  await C.tut(0.7);
  await ev(() => { const e = document.getElementById('snapPick'); const x = e && e.querySelector('[data-sp="x"]'); if (x) x.click(); const T = window.dwgApp.editor.tools; if (T.running) T.cancel(); window.dwgApp.editor.sel.clear(); window.dwgApp.render(); });
  await C.tut(0.3);
});

// --- 17 · ölçüm ---------------------------------------------------------------------------------------
await sahne(17, 'ölçüm', async () => {
  await anlat('Uçtan uca ölçü — uca kendiliğinden oturur', 'End to end, snapped to the corner', 1.5);
  await ev(() => { const E = window.dwgApp.editor; if (E.tools.running) E.tools.cancel(); window.dwgApp.setMode('measure'); });
  await C.tut(0.4);
  await dokunD(0.25, 0.25, 0.4);
  await dokunD(6.6, 5.2, 0.9);
  const okuma = await ev(() => { const e = document.getElementById('measureBody'); return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : ''; });
  console.log('   ölçüm:', okuma);
  await C.tut(1.4);
  await ev(() => { const b = document.getElementById('btnMeasureClose'); if (b) b.click(); window.dwgApp.setMode('view'); });
  await C.tut(0.3);
});

// --- 18 · kalınlık ve üç boyut -------------------------------------------------------------------------
await sahne(18, 'kalınlık ver, üç boyuta geç', async () => {
  await anlat('Duvarlara kalınlık ver', 'Give the walls a height', 1.4);
  /*
   * Kalınlık aracı ÖNCE nesne, SONRA değer ister; değer bir form kutusundan değil KOMUT
   * SATIRINDAN gelir. Seçim doluysa araç seçim adımını atlar ve doğrudan yüksekliği sorar.
   * Seçim GEOMETRİYLE yapılır (kapalı yollar); yazı, ölçü ve tarama dışarıda kalır.
   *
   * İKİ AYRI YÜKSEKLİK. Duvar 2,90 m, mobilya 0,60 m. Tek değer verilseydi yatak gardırop
   * boyunda, tezgâh tavana kadar çıkardı — üç boyutlu görüntü planı doğrulamak yerine
   * yalanlardı. Ayrım MOBILYA katmanındandır (10. sahnede orada çizildi, ayna da katmanı
   * taşır).
   */
  const yukselt = async (mobilya, h) => {
    const n = await ev(([mob]) => {
      const A = window.dwgApp, E = A.editor;
      E.sel.clear();
      let k = 0;
      for (const p of A.state.prims) {
        if (!(p.k === 0 && p.closed && !p.fill && p.ops && p.ops.length >= 3)) continue;   // kapalı yol: duvar ya da mobilya
        if ((p.lay === 'MOBILYA') !== mob) continue;
        E.sel.add(p); k++;
      }
      A.render();
      return k;
    }, [mobilya]);
    console.log(`   seçilen (${mobilya ? 'mobilya' : 'duvar'}):`, n);
    if (!n) return 0;
    await C.tut(0.5);
    await K0('thickness');
    console.log('   kalınlık istemi:', await istem());
    await KC(h, 0.5, 3);
    await iptal();
    return n;
  };
  const nDuvar = await yukselt(false, '2.9');
  if (!nDuvar) throw new Error('kalınlık verilecek kapalı yol yok');
  const nMobilya = await yukselt(true, '0.6');
  if (!nMobilya) throw new Error('MOBILYA katmanında kapalı yol yok — 10. sahne çalışmadı');
  const ext = await ev(() => window.dwgApp.state.prims.filter(p => p.et === 'EXTRUDE').length);
  console.log('   yükseltilen:', ext, '(duvar', nDuvar, '· mobilya', nMobilya, ')');
  await C.tut(0.4);
  await altAc('Aynı plan, üç boyutta', 'The same plan, in 3D'); await C.tut(1.2); await altKapat();
  await ev(() => window.dwgApp.editor.act('3d'));
  await bekle(1600);
  await enjekte(); await sessiz();
  const c = await ev(() => { try { return window.dwgApp.editor.view3d().counts; } catch (e) { return null; } });
  console.log('   3B sayaç:', JSON.stringify(c));
  await ev(() => { try { window.dwgApp.editor.view3d().set('turntable', true); } catch (e) {} });
  await C.hareket(3.0, () => {});
  await ev(() => { try { window.dwgApp.editor.view3d().set('turntable', false); } catch (e) {} });
  // 'realistic' ile 'shaded' düz prizma yüzünde AYNI pikseli verir; gerçekten farklı üçlü seçildi
  for (const st of ['shaded', 'conceptual', 'sketchy']) {
    await ev((x) => { try { const v = window.dwgApp.editor.view3d(); v.set('style', x); v.render(); } catch (e) {} }, st);
    await C.tut(0.8);
  }
  await ev(() => { try { if (window.dwgApp.editor.is3D()) window.dwgApp.editor.act('3d'); } catch (e) {} });
  await bekle(600);
  await enjekte(); await sessiz();
  await zoomBB(KADRAJ);
  await C.tut(0.3);
});

// --- 19 · hesaplayan tablo -------------------------------------------------------------------------------
await sahne(19, 'tablo: değeri boş formüller hesaplanır', async () => {
  await anlat('Mahal listesini de açar — ve hesaplar', 'Opens the schedule — and computes it', 1.6);
  await page.setInputFiles('#fileInput', METRAJ);
  await bekle(1300);
  await enjekte();
  const hucreler = await ev(() => {
    const t = document.querySelector('.xlsx-tbl'); if (!t) return null;
    return [...t.querySelectorAll('tr')].slice(1).map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent).join(' | '));
  });
  console.log('   tablo:', JSON.stringify(hucreler));
  await C.tut(2.4);
  await sonuc('Dosyada hazır değer yok; hesabı uygulama yaptı', 'No cached values; the app computed them', 2.0, 'alt');
  await ev(() => { const dv = document.getElementById('docView'); const k = dv && dv.querySelector('[data-doc="close"]'); if (k) k.click(); else if (dv) dv.hidden = true; });
  await bekle(450);
  await enjekte(); await sessiz();
  await C.tut(0.3);
});

// --- 20 · DXF olarak kaydet ---------------------------------------------------------------------------------
await sahne(20, 'DXF olarak kaydet', async () => {
  /*
   * İlk çekimde bu sahne YALAN SÖYLÜYORDU: altyazı "DXF olarak kaydedilir" derken ekranda
   * yalnız kararmış bir kip vardı — komut dosya adını soruyor, kutu cevaplanmadığı için
   * hiçbir şey kaydedilmiyordu. Artık kutu önceden cevaplanıyor ve sahnenin kanıtı
   * TARAYICIYA İNEN DOSYADIR; inmezse sahne hata verip atlanır, uydurma altyazı kalmaz.
   */
  await zoomBB(KADRAJ);
  await anlat('Değişiklikler DXF olarak kaydedilir', 'Changes are saved as DXF', 1.4);
  const n0 = inenler.length;
  await queueAnswers(page, 'kat_plani');
  await K0('dxfout');
  await bekle(2200);
  const t = await toast();
  console.log('   kaydet iletisi:', t, '· inen:', JSON.stringify(inenler.slice(n0)));
  await C.tut(1.4);
  await sessiz();
  if (inenler.length === n0 && !/kaydedildi|saved|DXF/i.test(t || '')) throw new Error('dosya inmedi, kaydetme kanıtlanamadı');
  const ad = inenler[inenler.length - 1] || '';
  await sonuc(ad ? `Kaydedildi: ${ad}` : 'Kaydedildi', ad ? `Saved: ${ad}` : 'Saved', 1.6);
});

// --- 90 · kapanış ---------------------------------------------------------------------------------------------
await sahne(90, 'kapanış', async () => {
  await sessiz();
  await zoomBB(KADRAJ);
  await C.tut(1.2);
  await C.hareket(0.45, (t) => K.karart(yumusak(t)));
  await K.kartMetin(MARKA + '<div class="alt1">160 m² iki daireli kat planı,<br>telefonda, baştan sona.</div><div class="kucuk">Android · çevrimdışı çalışır<br>Açma, ölçü, katman ve 3B görüntüleme ücretsiz</div>');
  await K.kart(1); await K.karart(0);
  await C.tut(2.8);
});

fs.writeFileSync(path.join(OUT, 'sahneler.json'), JSON.stringify({ fps: FPS, sahneler: C.gunluk, atlanan }, null, 1));
const kare = await hat.bitir();
console.log('\nkare:', kare, '=', (kare / FPS).toFixed(1), 'sn ·', path.join(OUT, 'promo2_ham.mp4'), fs.statSync(path.join(OUT, 'promo2_ham.mp4')).size, 'bayt');
if (atlanan.length) console.log('ATLANAN SAHNELER:\n - ' + atlanan.join('\n - '));
await ctx.close(); await browser.close(); srv.kill();
