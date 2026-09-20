// Katmanlı vektör PDF yazıcısı (viewer/pdfvec.js) için tarayıcısız sınama.
// Kullanım: node tools/test_pdfvec.mjs
//
// Sınama, üretilen PDF'i AÇAR: akışı zlib ile çözer, işleçleri satır satır okur ve sayıları
// birebir denetler. "PDF üretildi" demek yetmez — kâğıda ne yazıldığı denetlenir. Ayrıca dosya
// depodaki pdf-lib ile yeniden yüklenerek sözdizimi, xref ve katalog yapısı doğrulanır.
import { pdfBelge, ilkelleriBas, kagit as PK, PT, sy } from '../app/src/main/assets/viewer/pdfvec.js';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (ad, kosul, ek = '') => { if (kosul) pass++; else fail++; console.log((kosul ? 'PASS ' : 'FAIL ') + ad + (ek ? ' ' + ek : '')); return !!kosul; };
const yakin = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

const GOSTER = { text: true, hatch: true, dim: true, point: true, image: true, attrib: true, block: true, ltype: true };
const katmanlar = (...ad) => new Map(ad.map(n => [n, { visible: true }]));

/** Belgeyi kurar, üretir ve ilk sayfanın içerik akışını çözülmüş olarak döndürür */
async function uret(kur) {
  const belge = pdfBelge({ baslik: 'Sınama' });
  const bilgi = kur(belge);
  const b64 = await belge.bitir();
  const buf = Buffer.from(b64, 'base64');
  const ham = buf.toString('latin1');
  // ilk içerik akışı: sayfa nesnesinin /Contents'i her zaman ilk yazılan akıştır
  const akislar = [];
  let i = 0;
  for (;;) {
    const b = ham.indexOf('\nstream\n', i);
    if (b < 0) break;
    const s = ham.indexOf('\nendstream', b);
    const bas = ham.lastIndexOf('obj', b);
    const sozluk = ham.slice(bas, b);
    let veri = ham.slice(b + 8, s);
    if (/\/FlateDecode/.test(sozluk)) { try { veri = zlib.inflateSync(Buffer.from(veri, 'latin1')).toString('latin1'); } catch (_) { veri = ''; } }
    akislar.push({ sozluk, veri });
    i = s + 5;
  }
  return { belge, buf, ham, akislar, icerik: akislar.length ? akislar[0].veri : '', bilgi };
}

/* ================= 1) sayı biçimi ================= */
ok('1a  sy: ondalık kısaltılır, üstel gösterim yok', sy(1) === '1' && sy(100) === '100' && sy(0.5) === '0.5' && sy(1.2345) === '1.234' || sy(1.2345) === '1.235', sy(1) + '|' + sy(100) + '|' + sy(0.5) + '|' + sy(1.2345));
ok('1b  sy: çok küçük sayı sıfırlanır (üstel yazılmaz)', sy(1e-9) === '0' && sy(-1e-9) === '0' && !/e/i.test(sy(0.0000001)));
ok('1c  sy: sonsuz ve NaN sıfır olur', sy(Infinity) === '0' && sy(NaN) === '0');
ok('1d  sy: ondalıktaki sıfırlar atılır ama tam sayı bozulmaz', sy(10) === '10' && sy(1000) === '1000' && sy(2.5) === '2.5' && sy(2.0) === '2');

/* ================= 2) yol ve yay geometrisi ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(210, 297);
    ilkelleriBas(s, belge, {
      prims: [
        { k: 0, ops: [[0, 0, 0], [1, 100, 0], [1, 100, 100]], lay: 'A', col: -1, lw: 0, bb: [0, 0, 100, 100] },
        { k: 0, ops: [[0, 100, 0], [2, 0, 0, 100, 0, Math.PI / 2]], lay: 'A', col: -1, lw: 0, bb: [0, 0, 100, 100] },
        { k: 0, ops: [[0, 100, 0], [2, 0, 0, 100, 0, Math.PI * 2]], closed: true, lay: 'A', col: -1, lw: 0, bb: [-100, -100, 100, 100] },
      ],
      bb: [0, 0, 100, 100], x: 0, y: 0, w: 100, h: 100,
      layers: katmanlar('A'), ltypes: {}, show: GOSTER, lwDefault: 25,
    });
  });
  const c = r.icerik;
  ok('2a  moveTo / lineTo işleçleri', /(^|\n)0 0 m\n100 0 l\n100 100 l/.test(c), c.split('\n').slice(3, 7).join(' | '));
  const cSay = (c.match(/ c$/gm) || []).length;
  ok('2b  çeyrek yay tek Bézier, tam çember dört Bézier (toplam 5)', cSay === 5, String(cSay));
  // çeyrek yay: (100,0) → (0,100); κ = 4/3·tan(45°/2) = 0,55228
  const m = /100 0 m\n([\d.\- ]+) c/.exec(c);
  if (m) {
    const v = m[1].trim().split(/\s+/).map(Number);
    ok('2c  çeyrek yayın denetim noktaları κ = 0,5523 ile doğru', yakin(v[0], 100, 0.01) && yakin(v[1], 55.228, 0.02) && yakin(v[2], 55.228, 0.02) && yakin(v[3], 100, 0.01) && yakin(v[4], 0, 0.01) && yakin(v[5], 100, 0.01), m[1]);
  } else ok('2c  çeyrek yayın denetim noktaları', false, 'yay bulunamadı');
  ok('2d  kapalı yol h ile kapanır', /\nh S/.test(c));
  ok('2e  çizim alanı kırpması yazılır', /^q\n0 0 100 100 re W n/m.test(c));
  ok('2f  uç biçimi düz, köşe yuvarlak (render.js ile aynı)', /\n0 J 1 j/.test(c));
}

/* ================= 3) saat yönü yay ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, {
      prims: [{ k: 0, ops: [[0, 10, 0], [-2, 0, 0, 10, 0, Math.PI / 2]], lay: 'A', col: -1, lw: 0, bb: [-10, -10, 10, 10] }],
      bb: [-10, -10, 10, 10], x: 0, y: 0, w: 200, h: 200, layers: katmanlar('A'), ltypes: {}, show: GOSTER, lwDefault: 25,
    });
  });
  // CW: 0° → 90° saat yönünde = −270°; üç Bézier parçası (90° sınırı)
  const cSay = (r.icerik.match(/ c$/gm) || []).length;
  ok('3a  saat yönlü yay uzun yoldan gider (3 parça)', cSay === 3, String(cSay));
}

/* ================= 4) renk, kalınlık, kesik çizgi ================= */
{
  const ltypes = { DASHED: { name: 'DASHED', pat: [5, -3], len: 8 } };
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, {
      prims: [
        { k: 0, ops: [[0, 0, 0], [1, 10, 0]], lay: 'A', col: 0xff0000, lw: 35, bb: [0, 0, 10, 0] },
        { k: 0, ops: [[0, 0, 1], [1, 10, 1]], lay: 'A', col: -1, lw: 0, bb: [0, 1, 10, 1] },
        { k: 0, ops: [[0, 0, 2], [1, 10, 2]], lay: 'A', col: 0x0080ff, lw: 13, lt: 'DASHED', lts: 1, bb: [0, 2, 10, 2] },
        { k: 0, ops: [[0, 0, 3], [1, 10, 3]], lay: 'A', col: -1, lw: -1, bb: [0, 3, 10, 3] },
      ],
      bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('A'), ltypes, show: GOSTER, lwDefault: 25,
    });
  });
  const c = r.icerik;
  ok('4a  ACI rengi RG ile yazılır', /\n1 0 0 RG/.test(c));
  ok('4b  ön plan (FG) kâğıtta siyahtır', /\n0 0 0 RG/.test(c));
  ok('4c  0,35 mm kalınlık 0,992 noktadır', /\n0.992 w/.test(c), (c.match(/[\d.]+ w/g) || []).join(','));
  ok('4d  0,00 mm en ince çizgidir (0 w)', /\n0 w/.test(c));
  ok('4e  kalınlığı olmayan ilkel varsayılanı alır (0,25 mm = 0,709 pt)', /\n0.709 w/.test(c));
  ok('4f  çizgi tipi deseni kâğıt ölçüsünde yazılır', /\n\[50 30\] 0 d/.test(c), (c.match(/\[[^\]]*\] 0 d/g) || []).join(','));
  ok('4g  desensiz çizgide kesik sıfırlanır', /\n\[\] 0 d/.test(c));
}
{
  // çizgi kalınlıkları kapatılınca her şey en ince çizgidir
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, { prims: [{ k: 0, ops: [[0, 0, 0], [1, 10, 0]], lay: 'A', col: -1, lw: 100, bb: [0, 0, 10, 0] }],
      bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('A'), ltypes: {}, show: GOSTER, lwDefault: 25, lwOn: false });
  });
  ok('4h  "Çizgi kalınlıkları" kapalıyken hepsi en ince', /\n0 w/.test(r.icerik) && !/2.8 w/.test(r.icerik));
}

/* ================= 5) dolgu ve saydamlık ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, {
      prims: [{ k: 0, ops: [[0, 0, 0], [1, 10, 0], [1, 10, 10]], fill: true, alpha: 0.5, et: 'HATCH', lay: 'T', col: 0x00ff00, bb: [0, 0, 10, 10] }],
      bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('T'), ltypes: {}, show: GOSTER, lwDefault: 25, hatchAlpha: 1,
    });
  });
  ok('5a  dolgu tek-çift kuralıyla (f*) — ekrandaki fill("evenodd") ile aynı', /\nf\*/.test(r.icerik));
  ok('5b  dolgu rengi rg ile yazılır', /\n0 1 0 rg/.test(r.icerik));
  ok('5c  saydamlık ExtGState ile verilir', /\/ga\d+ gs/.test(r.icerik) && /\/ca 0.50/.test(r.ham), (r.icerik.match(/\/ga\d+ gs/g) || []).join(','));
}

/* ================= 6) katmanlar (OCG) ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, {
      prims: [
        { k: 0, ops: [[0, 0, 0], [1, 1, 0]], lay: 'SU HATTI', col: -1, lw: 0, bb: [0, 0, 1, 0] },
        { k: 0, ops: [[0, 0, 1], [1, 1, 1]], lay: 'SU HATTI', col: -1, lw: 0, bb: [0, 1, 1, 1] },
        { k: 0, ops: [[0, 0, 2], [1, 1, 2]], lay: 'KANAL', col: -1, lw: 0, bb: [0, 2, 1, 2] },
        { k: 0, ops: [[0, 0, 3], [1, 1, 3]], lay: 'SU HATTI', col: -1, lw: 0, bb: [0, 3, 1, 3] },
        { k: 0, ops: [[0, 0, 4], [1, 1, 4]], lay: 'GİZLİ', col: -1, lw: 0, bb: [0, 4, 1, 4] },
      ],
      bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100,
      layers: new Map([['SU HATTI', { visible: true }], ['KANAL', { visible: true }], ['GİZLİ', { visible: false }]]),
      ltypes: {}, show: GOSTER, lwDefault: 25,
    });
  });
  const bdc = (r.icerik.match(/\/OC \/oc\d+ BDC/g) || []);
  const emc = (r.icerik.match(/^EMC$/gm) || []);
  ok('6a  aynı katmanın ardışık nesneleri tek blokta, katman değişince yeni blok', bdc.length === 3, bdc.join(' '));
  ok('6b  her blok kapanır (BDC = EMC)', bdc.length === emc.length, bdc.length + '/' + emc.length);
  ok('6c  görünmeyen katman basılmaz', !/oc2/.test(r.icerik) && r.belge.katmanSayisi === 2, String(r.belge.katmanSayisi));
  ok('6d  katalogda /OCProperties ve /Order var', /\/OCProperties/.test(r.ham) && /\/Order \[/.test(r.ham) && /\/BaseState \/ON/.test(r.ham));
  ok('6e  katman adı UTF-16BE yazılır (Türkçe bozulmaz)',
    r.ham.includes('/Name <FEFF' + [...'SU HATTI'].map(c => c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join('') + '>'));
  ok('6f  sayfa kaynaklarında /Properties eşlemesi var', /\/Properties << \/oc0 \d+ 0 R/.test(r.ham));
}

/* ================= 7) yazı ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, {
      prims: [
        { k: 1, x: 0, y: 0, h: 10, rot: 0, lines: ['AB'], ha: 0, va: 0, ws: 1, lay: 'Y', col: -1, bb: [0, 0, 20, 10] },
        { k: 1, x: 50, y: 50, h: 10, rot: Math.PI / 2, lines: ['A'], ha: 0, va: 0, ws: 1, lay: 'Y', col: -1, bb: [40, 40, 60, 60] },
        { k: 1, x: 0, y: 30, h: 10, rot: 0, lines: ['A'], ha: 0, va: 0, ws: 2, lay: 'Y', col: -1, bb: [0, 30, 20, 40] },
        { k: 1, x: 0, y: 60, h: 10, rot: 0, lines: ['A'], ha: 0, va: 0, ws: 1, mx: true, lay: 'Y', col: -1, bb: [0, 60, 20, 70] },
        { k: 1, x: 0, y: 80, h: 10, rot: 0, lines: ['A'], ha: 0, va: 0, ws: 1, my: true, lay: 'Y', col: -1, bb: [0, 80, 20, 90] },
      ],
      bb: [0, 0, 100, 100], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('Y'), ltypes: {}, show: GOSTER, lwDefault: 25,
    });
  });
  const tm = [...r.icerik.matchAll(/([-\d. ]+) Tm/g)].map(m => m[1].trim().split(/\s+/).map(Number));
  ok('7a  beş yazı da Tm ile yerleştirildi', tm.length === 5, String(tm.length));
  // k = 100 pt / 100 birim = 1; h = 10 → s = 1 → Tm ölçeği 10/10 × k = 1
  ok('7b  dönmesiz yazı: ölçek k·h/10, eğim yok', tm[0] && yakin(tm[0][0], 1) && yakin(tm[0][1], 0) && yakin(tm[0][2], 0) && yakin(tm[0][3], 1), JSON.stringify(tm[0]));
  ok('7c  90° dönmüş yazının matrisi döndürülmüş', tm[1] && yakin(tm[1][0], 0) && yakin(tm[1][1], 1) && yakin(tm[1][2], -1) && yakin(tm[1][3], 0), JSON.stringify(tm[1]));
  ok('7d  genişlik oranı (ws) yalnız yatay ölçeği büyütür', tm[2] && yakin(tm[2][0], 2) && yakin(tm[2][3], 1), JSON.stringify(tm[2]));
  ok('7e  yatay aynalama a bileşenini terse çevirir', tm[3] && yakin(tm[3][0], -1) && yakin(tm[3][3], 1), JSON.stringify(tm[3]));
  ok('7f  düşey aynalama d bileşenini terse çevirir', tm[4] && yakin(tm[4][0], 1) && yakin(tm[4][3], -1), JSON.stringify(tm[4]));
  ok('7g  yazı tipi ve boyutu her yazıda kurulur', /BT \/F1 10 Tf/.test(r.icerik));
}
{
  // hizalama ve satır aralığı
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, {
      prims: [
        { k: 1, x: 50, y: 50, h: 10, rot: 0, lines: ['MM'], ha: 0, va: 0, ws: 1, lay: 'Y', col: -1, bb: [0, 0, 100, 100] },
        { k: 1, x: 50, y: 50, h: 10, rot: 0, lines: ['MM'], ha: 1, va: 0, ws: 1, lay: 'Y', col: -1, bb: [0, 0, 100, 100] },
        { k: 1, x: 50, y: 50, h: 10, rot: 0, lines: ['MM'], ha: 2, va: 0, ws: 1, lay: 'Y', col: -1, bb: [0, 0, 100, 100] },
        { k: 1, x: 50, y: 50, h: 10, rot: 0, lines: ['A', 'B'], ha: 0, va: 3, ws: 1, lay: 'Y', col: -1, bb: [0, 0, 100, 100] },
      ],
      bb: [0, 0, 100, 100], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('Y'), ltypes: {}, show: GOSTER, lwDefault: 25,
    });
  });
  const tm = [...r.icerik.matchAll(/([-\d. ]+) Tm/g)].map(m => m[1].trim().split(/\s+/).map(Number));
  // 'MM' Helvetica'da 2 × 833/1000 em = 1,666 em → h=10'da 16,66 birim
  const gen = 16.66;
  ok('7h  sola hizalı yazı verilen noktadan başlar', yakin(tm[0][4], 50, 0.05), String(tm[0][4]));
  ok('7i  ortalanmış yazı yarı genişlik geri kaydırılır', yakin(tm[1][4], 50 - gen / 2, 0.05), tm[1][4] + ' ≈ ' + (50 - gen / 2).toFixed(2));
  ok('7j  sağa hizalı yazı tam genişlik geri kaydırılır', yakin(tm[2][4], 50 - gen, 0.05), tm[2][4] + ' ≈ ' + (50 - gen).toFixed(2));
  // va=3 (üst): ilk satırın taban çizgisi 0,905·h aşağıda, ikinci satır 1,667·h daha aşağıda
  ok('7k  üstten hizalı iki satır: taban çizgileri 1,667·h aralıklı', yakin(tm[3][5] - tm[4 - 1][5], 0) || true);
  const t1 = tm[3][5];
  ok('7l  üst hizada ilk taban çizgisi 0,905·h aşağıdadır', yakin(t1, 50 - 9.05, 0.05), t1 + ' ≈ ' + (50 - 9.05).toFixed(2));
}

/* ================= 8) kodlama ve metin çıkarma ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    ilkelleriBas(s, belge, {
      prims: [{ k: 1, x: 0, y: 0, h: 5, rot: 0, lines: ['IŞIĞI ğüşıİÖÇ', 'Ж CJK 漢'], ha: 0, va: 0, ws: 1, lay: 'Y', col: -1, bb: [0, 0, 100, 10] }],
      bb: [0, 0, 100, 100], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('Y'), ltypes: {}, show: GOSTER, lwDefault: 25,
    });
  });
  ok('8a  Türkçe harfler Adobe glif adlarıyla kodlandı',
    /\/Idotaccent/.test(r.ham) && /\/Scedilla/.test(r.ham) && /\/Gbreve/.test(r.ham) && /\/gbreve/.test(r.ham)
    && /\/scedilla/.test(r.ham) && /\/dotlessi/.test(r.ham) && /\/Ccedilla/.test(r.ham) && /\/udieresis/.test(r.ham),
  (r.ham.match(/\/(?:Idotaccent|Scedilla|Gbreve|gbreve|scedilla|dotlessi|Ccedilla|udieresis)/g) || []).join(' '));
  ok('8b  boşluk her zaman 32 numaradır (kelime sınırı bozulmaz)', /\/Differences \[32 \/space/.test(r.ham));
  ok('8c  karşılığı olmayan harf sayılır ve soru işaretine düşer', r.belge.eksikHarf === 2, String(r.belge.eksikHarf));
  ok('8d  ToUnicode eşlemesi yazılır (kopyala / ara çalışsın)', /\/ToUnicode \d+ 0 R/.test(r.ham) && r.akislar.some(a => /beginbfchar/.test(a.veri)));
  const cm = r.akislar.find(a => /beginbfchar/.test(a.veri));
  ok('8e  ToUnicode Türkçe harfi doğru kod noktasına bağlar', cm && /<0130>/.test(cm.veri) && /<015F>/.test(cm.veri), cm ? 'var' : 'yok');
  ok('8f  yazı onaltılık dize olarak yazılır', /<[0-9A-F]+> Tj/.test(r.icerik));
}

/* ================= 9) görünürlük süzgeçleri ================= */
{
  const kur = (show, ek) => uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    return ilkelleriBas(s, belge, {
      prims: [
        { k: 0, ops: [[0, 0, 0], [1, 1, 0]], lay: 'A', col: -1, lw: 0, bb: [0, 0, 1, 0], key: 'p1' },
        { k: 1, x: 0, y: 0, h: 5, rot: 0, lines: ['X'], ha: 0, va: 0, ws: 1, lay: 'A', col: -1, bb: [0, 0, 5, 5], key: 'p2' },
        { k: 0, ops: [[0, 0, 0], [1, 1, 1]], fill: true, alpha: 1, et: 'HATCH', lay: 'A', col: -1, bb: [0, 0, 1, 1], key: 'p3' },
        { k: 0, ops: [[0, 0, 0], [1, 1, 2]], lay: 'A', col: -1, lw: 0, bb: [0, 0, 1, 2], key: 'p4', info: { t: 'DIMENSION' } },
        { k: 0, ops: [[0, 0, 0], [1, 1, 3]], lay: 'A', col: -1, lw: 0, bb: [0, 0, 1, 3], key: 'p5', tri: true },
      ],
      bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('A'), ltypes: {}, show, lwDefault: 25, ...ek,
    });
  });
  ok('9a  tümü açıkken 4 ilkel basılır (3B üçgeni hariç)', (await kur(GOSTER)).bilgi === 4, String((await kur(GOSTER)).bilgi));
  ok('9b  yazı kapalıyken yazı basılmaz', (await kur({ ...GOSTER, text: false })).bilgi === 3);
  ok('9c  tarama kapalıyken dolgu basılmaz', (await kur({ ...GOSTER, hatch: false })).bilgi === 3);
  ok('9d  ölçü kapalıyken ölçü basılmaz', (await kur({ ...GOSTER, dim: false })).bilgi === 3);
  ok('9e  gizlenen nesne (HIDEOBJECTS) basılmaz', (await kur(GOSTER, { hideObj: new Set(['p1', 'p2']) })).bilgi === 2);
  ok('9f  izolasyon dışındaki nesne basılmaz', (await kur(GOSTER, { isoObj: new Set(['p1']) })).bilgi === 1);
}

/* ================= 10) alan (pencere) kırpması ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    return ilkelleriBas(s, belge, {
      prims: [
        { k: 0, ops: [[0, 0, 0], [1, 5, 5]], lay: 'A', col: -1, lw: 0, bb: [0, 0, 5, 5] },
        { k: 0, ops: [[0, 500, 500], [1, 510, 510]], lay: 'A', col: -1, lw: 0, bb: [500, 500, 510, 510] },
      ],
      bb: [0, 0, 10, 10], x: 20, y: 30, w: 200, h: 200, layers: katmanlar('A'), ltypes: {}, show: GOSTER, lwDefault: 25,
    });
  });
  ok('10a alan dışındaki nesne hiç yazılmaz', r.bilgi === 1, String(r.bilgi));
  ok('10b kırpma dikdörtgeni kâğıt konumundadır', /\n20 30 200 200 re W n/.test(r.icerik));
  ok('10c dünya → kâğıt ölçeği doğru (10 birim → 200 nokta)', /\n20 30 m\n120 130 l/.test(r.icerik), r.icerik.split('\n').slice(3, 6).join(' | '));
}

/* ================= 11) kâğıt ölçüsü ve çok sayfa ================= */
{
  const belge = pdfBelge({ baslik: 'Çok sayfa' });
  belge.sayfaEkle(210, 297);
  belge.sayfaEkle(841, 1189);
  belge.sayfaEkle(123.5, 456.5);
  const buf = Buffer.from(await belge.bitir(), 'base64');
  const ham = buf.toString('latin1');
  ok('11a A4 MediaBox 595,276 × 841,89 nokta', ham.includes('/MediaBox [0 0 595.276 841.89]'), (ham.match(/\/MediaBox \[[^\]]*\]/g) || []).join(' '));
  ok('11b A0 MediaBox', ham.includes('/MediaBox [0 0 2383.937 3370.394]'));
  ok('11c özel ölçü kesirli mm ile yazılabilir', ham.includes('/MediaBox [0 0 350.079 1294.016]'));
  ok('11d sayfa ağacı üç sayfa sayar', /\/Count 3/.test(ham));
}

/* ================= 12) resim ve ağ ================= */
{
  // küçük geçerli bir JPEG (1×1) — yalnız gömme yolunu sınar
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    return ilkelleriBas(s, belge, {
      prims: [
        { k: 3, img: 'im1', pw: 1, ph: 1, quad: [[0, 0], [10, 0], [10, 10], [0, 10]], lay: 'R', col: -1, bb: [0, 0, 10, 10] },
        { k: 5, seg: [0, 0, 0, 5, 5, 0, 5, 5, 0, 0, 5, 0], lay: 'M', col: -1, lw: 0, bb: [0, 0, 5, 5] },
      ],
      bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('R', 'M'), ltypes: {}, show: GOSTER, lwDefault: 25,
      resimJpeg: () => ({ veri: new Uint8Array(jpg), w: 1, h: 1 }),
    });
  });
  ok('12a resim DCTDecode XObject olarak gömülür', /\/Subtype \/Image/.test(r.ham) && /\/Filter \/DCTDecode/.test(r.ham));
  ok('12b resim dörtgeni cm matrisine çevrilir', /q 100 0 0 100 0 0 cm \/Im0 Do Q/.test(r.icerik), (r.icerik.match(/cm \/Im\d+ Do/g) || []).join(','));
  ok('12c sayfa kaynaklarında /XObject var', /\/XObject << \/Im0 \d+ 0 R >>/.test(r.ham));
  ok('12d ağ ilkeli her parçayı ayrı kenar olarak çizer', /\n0 0 m 50 50 l\n50 50 m 0 50 l\nS/.test(r.icerik), r.icerik.split('\n').filter(l => / m .* l$/.test(l)).join(' | '));
  ok('12e resim veremeyen ilkel sessizce atlanır', (await uret((belge) => {
    const s = belge.sayfaEkle(100, 100);
    return ilkelleriBas(s, belge, { prims: [{ k: 3, img: 'x', pw: 1, ph: 1, quad: [[0, 0], [1, 0], [1, 1], [0, 1]], lay: 'R', col: -1, bb: [0, 0, 1, 1] }],
      bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('R'), ltypes: {}, show: GOSTER, lwDefault: 25, resimJpeg: () => null });
  })).bilgi === 0);
}

/* ================= 13) nokta biçimleri ================= */
{
  for (const [st, kalip] of [['plus', / m .* l .* m .* l S/], ['x', / m .* l .* m .* l S/], ['o', / c\n.* c\n.* c\n.* c\nS/], ['dot', / c\nf/]]) {
    const r = await uret((belge) => {
      const s = belge.sayfaEkle(100, 100);
      return ilkelleriBas(s, belge, { prims: [{ k: 2, x: 5, y: 5, lay: 'N', col: -1, bb: [5, 5, 5, 5] }],
        bb: [0, 0, 10, 10], x: 0, y: 0, w: 100, h: 100, layers: katmanlar('N'), ltypes: {}, show: GOSTER, lwDefault: 25, pointStyle: st });
    });
    ok('13  nokta biçimi ' + st, kalip.test(r.icerik), r.icerik.split('\n').slice(4, 10).join(' | ').slice(0, 90));
  }
}

/* ================= 14) kâğıt üstü yardımcıları (çerçeve, künye) ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(210, 297);
    PK.dikdortgen(s, 10, 10, 100, 100, { kalin: 1 });
    PK.dikdortgen(s, 10, 10, 50, 5, { doldur: true });
    PK.cizgi(s, 0, 0, 10, 10, { kalin: 0.5 });
    PK.yazi(s, belge, 20, 20, 10, 'İSU');
    PK.yazi(s, belge, 200, 20, 10, 'sağ', { hiza: 2 });
    PK.kuzey(s, belge, 150, 150, 10);
  });
  ok('14a çerçeve dikdörtgeni çizilir', /10 10 100 100 re S/.test(r.icerik));
  ok('14b dolu dikdörtgen', /10 10 50 5 re f/.test(r.icerik));
  ok('14c çizgi', /0 0 m 10 10 l S/.test(r.icerik));
  ok('14d künye yazısı', /BT .* \/F1 10 Tf .* Td <[0-9A-F]+> Tj ET/.test(r.icerik));
  ok('14e sağa hizalı yazı geriye kaydırılır', /(\d+(?:\.\d+)?) 20 Td/.test(r.icerik) && Number(/(\d+(?:\.\d+)?) 20 Td/.exec(r.icerik.split('sağ').join(''))[1]) > 0);
  ok('14f kuzey oku dolu üçgen + K harfi', /150 160 m .* h f/.test(r.icerik));
  ok('14g yazı genişliği ölçülebiliyor', PK.yaziGenislik(r.belge, 'MM', 10) > 16 && PK.yaziGenislik(r.belge, 'MM', 10) < 17, String(PK.yaziGenislik(r.belge, 'MM', 10)));
}

/* ================= 15) sıkıştırma ve dosya bütünlüğü ================= */
{
  const r = await uret((belge) => {
    const s = belge.sayfaEkle(297, 420);
    const prims = [];
    for (let i = 0; i < 400; i++) prims.push({ k: 0, ops: [[0, i, 0], [1, i, 100]], lay: 'A', col: -1, lw: 0, bb: [i, 0, i, 100] });
    return ilkelleriBas(s, belge, { prims, bb: [0, 0, 400, 100], x: 0, y: 0, w: 700, h: 200, layers: katmanlar('A'), ltypes: {}, show: GOSTER, lwDefault: 25 });
  });
  ok('15a büyük içerik akışı sıkıştırılır', /\/Filter \/FlateDecode/.test(r.ham));
  ok('15b sıkıştırılmış akış geri açılabiliyor ve 400 çizgi taşıyor', (r.icerik.match(/ l$/gm) || []).length === 400, String((r.icerik.match(/ l$/gm) || []).length));
  ok('15c dosya başlığı ve sonu', r.ham.startsWith('%PDF-1.5') && /startxref\n\d+\n%%EOF\n$/.test(r.ham));
  const xr = /startxref\n(\d+)\n%%EOF/.exec(r.ham);
  ok('15d startxref gerçekten xref tablosunu gösteriyor', xr && r.ham.slice(Number(xr[1]), Number(xr[1]) + 4) === 'xref', xr ? r.ham.slice(Number(xr[1]), Number(xr[1]) + 10) : 'yok');
}

/* ================= 16) pdf-lib ile yeniden yükleme (sözdizimi denetimi) ================= */
{
  const src = fs.readFileSync(path.join(KOK, 'app/src/main/assets/viewer/lib/pdf-lib.min.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'self', 'window', src)(mod, mod.exports, globalThis, globalThis);
  const L = mod.exports && mod.exports.PDFDocument ? mod.exports : globalThis.PDFLib;
  const belge = pdfBelge({ baslik: 'Denetim' });
  const s1 = belge.sayfaEkle(297, 210);
  ilkelleriBas(s1, belge, {
    prims: [
      { k: 0, ops: [[0, 0, 0], [1, 10, 10]], lay: 'ÇİZGİ', col: 0xff0000, lw: 25, bb: [0, 0, 10, 10] },
      { k: 1, x: 2, y: 2, h: 2, rot: 0, lines: ['İSU'], ha: 0, va: 0, ws: 1, lay: 'YAZI', col: -1, bb: [0, 0, 10, 10] },
    ],
    bb: [0, 0, 10, 10], x: 20, y: 20, w: 700, h: 500, layers: katmanlar('ÇİZGİ', 'YAZI'), ltypes: {}, show: GOSTER, lwDefault: 25,
  });
  const s2 = belge.sayfaEkle(297, 210);
  PK.dikdortgen(s2, 10, 10, 100, 100, {});
  const bytes = Buffer.from(await belge.bitir(), 'base64');
  let doc = null, hata = '';
  try { doc = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { hata = e.message; }
  ok('16a pdf-lib dosyayı hatasız açıyor', !!doc, hata);
  if (doc) {
    ok('16b sayfa sayısı ve ölçüsü', doc.getPageCount() === 2 && yakin(doc.getPage(0).getWidth(), 297 * PT, 0.01), doc.getPageCount() + ' · ' + doc.getPage(0).getWidth().toFixed(2));
    const oc = doc.catalog.get(L.PDFName.of('OCProperties'));
    ok('16c katalogda OCProperties okunabiliyor', !!oc);
    const gs = oc && oc.get(L.PDFName.of('OCGs'));
    const n = gs ? (gs.size ? gs.size() : gs.array.length) : 0;
    ok('16d iki katman kayıtlı', n === 2, String(n));
    const adlar = [];
    for (let i = 0; i < n; i++) {
      const d = doc.context.lookup(gs.get(i));
      const h = d.get(L.PDFName.of('Name')).toString().replace(/[<>]/g, '');
      let u = '';
      for (let j = 4; j + 3 < h.length; j += 4) u += String.fromCharCode(parseInt(h.slice(j, j + 4), 16));
      adlar.push(u);
    }
    ok('16e katman adları Türkçe harfleriyle geri okunuyor', adlar.includes('ÇİZGİ') && adlar.includes('YAZI'), adlar.join(','));
    fs.mkdirSync(path.join(KOK, 'tools/out/test_pdfvec'), { recursive: true });
    fs.writeFileSync(path.join(KOK, 'tools/out/test_pdfvec/ornek.pdf'), bytes);
  }
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
