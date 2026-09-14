/*
 * Çizime ÇİZİLMİŞ tabloyu (ızgara çizgileri + hücre yazıları) satır/sütun dizisine çevirir.
 *
 * Neden böyle: DXF/DWG'de tabloların çoğu gerçek ACAD_TABLE varlığı değildir; çizen kişi
 * dikdörtgenleri ve doğruları çizip içine TEXT/MTEXT koyar. Bu yüzden çözümleme SAHNE
 * İLKELLERİ üzerinden yapılır (k=0 yollar ve k=1 yazılar); hangi varlıktan geldikleri,
 * blok içinden mi patladıkları önemli değildir — ilkel biçimi hepsini aynı düzleme indirir.
 *
 * Kararlar ve gerekçeleri:
 *  - Izgara çizgisi, doğrultusu tol içinde yatay ya da düşey olan DOĞRU PARÇALARINDAN kurulur.
 *    Yaylar (op 2/-2/3) örneklenip parçalara ayrılır: bir yay ızgara çizgisi olamaz ama
 *    üzerinden geçen kısa parçalar kümenin kapsamını yanlış büyütmesin diye kapsam ÖLÇÜLÜR,
 *    parça sayısı sayılmaz.
 *  - Kümeleme "boşluk zinciri"dir: sıralanmış anahtarlarda ardışık fark tol'u aşınca yeni küme
 *    başlar. Böylece iki kümenin ortalaması her zaman birbirinden tol'dan uzaktır; ayrıca
 *    süzme gerekmez, dejenere (sıfır genişlikli) hücre oluşmaz.
 *  - Küme konumu, parça UZUNLUĞUYLA AĞIRLIKLANMIŞ ortalamadır: bir ızgara çizgisini kesen
 *    onlarca kısa yazı parçası, uzun çizginin gerçek konumunu kaydırmasın diye.
 *  - Bir kümenin "kapsamı" parça uzunlukları TOPLAMI değil, BİRLEŞİMİDİR (üst üste binen
 *    parçalar bir kez sayılır). Üst üste çizilmiş (kopyalanmış) çerçeveler sahte kapsam
 *    üretip süs çizgisini ızgara sanmasın diye.
 *  - Hücreye yazı atarken yazının hizası dikkate alınır: sağa dayalı yazının ekleme noktası
 *    hücrenin sağ çizgisinin üstündedir, olduğu gibi kullanılırsa yandaki sütuna düşer.
 *    Nokta hiza yönünün tersine tol/2 kadar içeri çekilir.
 *  - İlkeller TEK KEZ gezilir: prims bir üreteç de olabilir, ikinci tur boş dönerdi. Yazılar
 *    ızgara kurulmadan hücreye oturtulamadığı için dikdörtgen içindeki adaylar saklanır.
 *  - Yay açıları flatten'a verilmeden önce bir tura kırpılır: geom.arcPts süpürmeyi
 *    sınırlamaz, bozuk bir açı çiftinde belleği taşırır ya da sonsuz döngüye girer.
 *  - Hiçbir metin gömülü değildir; modül yalnız çizimden okuduğu dizgeleri ve sayıları döndürür.
 *  - Bozuk girdide istisna fırlatılmaz: null ya da boş dizi döner.
 */
import { flatten, opsBBox } from './geom.js';

const TAU = Math.PI * 2;
const DEF_TOL = 0.005;          // dikdörtgenin kısa kenarının %0,5'i
const DEF_MIN_LINES = 2;
const DEF_MIN_SPAN = 0.6;
const MAX_CELLS = 40000;        // WebView'i kilitlememek için hücre tavanı

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const normRect = (r) => (Array.isArray(r) && r.length >= 4 && num(r[0]) && num(r[1]) && num(r[2]) && num(r[3]))
  ? [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])] : null;

// ---- büyüyen düz sayı yığını: kayıt başına 3 sayı (anahtar, aralık başı, aralık sonu) ----
const makeBuf = (cap) => ({ a: new Float64Array(cap * 3), n: 0 });
function put3(b, k, p, q) {
  if ((b.n + 1) * 3 > b.a.length) { const t = new Float64Array(b.a.length ? b.a.length * 2 : 768); t.set(b.a); b.a = t; }
  const i = b.n * 3;
  b.a[i] = k; b.a[i + 1] = p; b.a[i + 2] = q;
  b.n++;
}

/** Bir doğru parçasını yatay / düşey yığınına yazar; dikdörtgen dışına taşan bölümü kırpar */
function edge(ax, ay, bx, by, R, tol, hb, vb) {
  if (!num(ax) || !num(ay) || !num(bx) || !num(by)) return;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dy) < tol && Math.abs(dx) >= tol) {
    const k = (ay + by) / 2;
    if (k < R[1] - tol || k > R[3] + tol) return;
    const a = Math.max(R[0], Math.min(ax, bx)), b = Math.min(R[2], Math.max(ax, bx));
    if (b - a > 0) put3(hb, k, a, b);
    return;
  }
  if (Math.abs(dx) < tol && Math.abs(dy) >= tol) {
    const k = (ax + bx) / 2;
    if (k < R[0] - tol || k > R[2] + tol) return;
    const a = Math.max(R[1], Math.min(ay, by)), b = Math.min(R[3], Math.max(ay, by));
    if (b - a > 0) put3(vb, k, a, b);
  }
}

// Yay/elips işlemi için yeniden kullanılan tampon: extractTable eşzamansız değildir, iç içe
// çağrılmaz; her yay için yeni dizi ayırmamak adına tek tampon paylaşılır.
const AOP = [0, 0, 0, 0, 0, 0, 0, 0];
const AWRAP = [AOP];

/**
 * Yay/elips işlemini flatten'a vermeden önce güvenli hâle getirir; bozuksa null döner.
 *
 * Neden gerekli: geom.arcPts / ellipsePts süpürmeyi SINIRLAMAZ. Çizimden okunan bozuk bir açı
 * çiftinde (a1 - a0 = 1e300) örnek sayısı 1e302 çıkar ve bellek taşar; ters işaretlisinde
 * (-1e300) "while (d <= 0) d += TAU" döngüsü kayan nokta duyarlığı yüzünden HİÇ BİTMEZ —
 * ikisi de try/catch ile yakalanamaz, uygulamayı düşürür. opsBBox'ın arcExt'i bu kırpmayı
 * kendi içinde yapar, flatten yapmaz; burada aynı kırpma uygulanır: başlangıç açısı bir tura
 * indirilir, süpürme (0, TAU] aralığına kapatılır.
 */
function safeArc(o) {
  const t = o[0];
  const el = t === 3;
  const nc = el ? 5 : 3;                      // açılardan önceki sayısal alan sayısı
  for (let i = 1; i <= nc; i++) if (!num(o[i])) return null;
  let a0 = o[nc + 1], a1 = o[nc + 2];
  if (!num(a0) || !num(a1)) { a0 = 0; a1 = TAU; }             // bozuk açı: tam tur
  a0 %= TAU; if (a0 < 0) a0 += TAU;                           // taşkın açıda cos/sin duyarlığı korunur
  let d = el || t === 2 ? a1 - a0 : a0 - a1;                  // -2 saat yönündedir, süpürme ters okunur
  if (!num(d) || d <= 0) d = TAU;
  if (d > TAU) d = TAU;
  AOP[0] = t; AOP[1] = o[1]; AOP[2] = o[2]; AOP[3] = o[3];
  AOP[4] = el ? o[4] : a0;
  AOP[5] = el ? o[5] : (t === 2 ? a0 + d : a0 - d);
  AOP[6] = el ? a0 : 0;
  AOP[7] = el ? a0 + d : 0;
  return AWRAP;
}

/** Yol ilkelinin işlemlerini gezip doğru parçalarını toplar (yaylar örneklenir) */
function walkOps(p, R, tol, hb, vb) {
  let cx = 0, cy = 0, sx = 0, sy = 0, has = false;
  for (const o of p.ops) {
    if (!o || o.length < 3) continue;
    const t = o[0];
    if (t === 0) { cx = sx = o[1]; cy = sy = o[2]; has = true; continue; }
    if (t === 1) {
      if (has) edge(cx, cy, o[1], o[2], R, tol, hb, vb); else { sx = o[1]; sy = o[2]; has = true; }
      cx = o[1]; cy = o[2];
      continue;
    }
    // yay / elips: tek işlemi örnekle. Tabloda yay seyrektir, örnekleme burada yapılır.
    // Tanınmayan işlem kodu atılır: flatten onu elips sanıp tanımsız alan okurdu.
    if (t !== 2 && t !== -2 && t !== 3) continue;
    const a = safeArc(o);
    if (!a) continue;
    const pts = flatten(a);
    if (!pts.length) continue;
    if (has) edge(cx, cy, pts[0][0], pts[0][1], R, tol, hb, vb);
    else { sx = pts[0][0]; sy = pts[0][1]; has = true; }
    for (let i = 1; i < pts.length; i++) edge(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], R, tol, hb, vb);
    cx = pts[pts.length - 1][0]; cy = pts[pts.length - 1][1];
  }
  if (p.closed && has) edge(cx, cy, sx, sy, R, tol, hb, vb);
}

/**
 * Anahtarları tol içinde kümeler; kapsamı span * minSpan'ın altında kalan kümeyi atar.
 * Dönüş: artan sırada küme konumları (düz dizi).
 */
function clusterLines(buf, tol, span, minSpan) {
  const n = buf.n, A = buf.a;
  if (!n) return [];
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => A[a * 3] - A[b * 3]);
  const need = span * minSpan;
  const out = [], tmp = [];
  let s = 0;
  for (let e = 1; e <= n; e++) {
    if (e < n && A[idx[e] * 3] - A[idx[e - 1] * 3] <= tol) continue;   // aynı küme sürüyor
    let wsum = 0, ksum = 0;
    tmp.length = 0;
    for (let i = s; i < e; i++) {
      const j = idx[i] * 3, L = A[j + 2] - A[j + 1];
      wsum += L; ksum += A[j] * L;
      tmp.push(idx[i]);
    }
    tmp.sort((a, b) => A[a * 3 + 1] - A[b * 3 + 1]);
    let covered = 0, ca = A[tmp[0] * 3 + 1], cb = A[tmp[0] * 3 + 2];
    for (let i = 1; i < tmp.length; i++) {
      const a = A[tmp[i] * 3 + 1], b = A[tmp[i] * 3 + 2];
      if (a <= cb) { if (b > cb) cb = b; }
      else { covered += cb - ca; ca = a; cb = b; }
    }
    covered += cb - ca;
    if (wsum > 0 && covered >= need) out.push(ksum / wsum);
    s = e;
  }
  return out;
}

/** v değerinin hangi banda düştüğü: g[j] <= v <= g[j+1] → j, dışarıdaysa -1 */
function band(g, v) {
  const n = g.length;
  if (n < 2 || !(v >= g[0]) || !(v <= g[n - 1])) return -1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v >= g[m]) lo = m; else hi = m; }
  return lo;
}

/** Yazı ilkelinin gövde metni: boş satırlar atılır, satırlar boşlukla birleşir */
function textOf(p) {
  const src = Array.isArray(p.lines) ? p.lines : (typeof p.text === 'string' ? [p.text] : null);
  if (!src) return '';
  let out = '';
  for (const l of src) {
    const t = (l == null ? '' : String(l)).trim();
    if (!t) continue;
    out = out ? out + ' ' + t : t;
  }
  return out;
}

/**
 * Dikdörtgen içindeki çizilmiş tabloyu çözer.
 *   prims  ilkel dizisi (ya da yinelenebilir)
 *   rect   [x0,y0,x1,y1] arama dikdörtgeni (sırası önemsiz, normalleştirilir)
 *   opts   { tol, minLines, minSpan }
 * Dönüş: { rows, nx, ny, gridX, gridY, cells } ya da null.
 *   rows   yukarıdan aşağı satır, soldan sağa sütun; her hücre dizge (boşsa '')
 *   cells  satır öncelikli düz dizi (r * nx + c): { r, c, x0, y0, x1, y1, text, n }
 */
export function extractTable(prims, rect, opts) {
  try {
    if (!prims || typeof prims[Symbol.iterator] !== 'function') return null;
    const R = normRect(rect);
    if (!R) return null;
    const w = R[2] - R[0], h = R[3] - R[1];
    if (!(w > 0) || !(h > 0)) return null;
    const o = opts || {};
    const tol = num(o.tol) && o.tol > 0 ? o.tol : Math.min(w, h) * DEF_TOL;
    if (!(tol > 0)) return null;
    const minLines = num(o.minLines) && o.minLines >= 1 ? Math.floor(o.minLines) : DEF_MIN_LINES;
    const minSpan = num(o.minSpan) && o.minSpan > 0 ? o.minSpan : DEF_MIN_SPAN;

    // 1) TEK geçiş: doğru parçaları toplanır, yazı adayları kenara ayrılır.
    // Tek geçiş zorunludur: prims bir üreteç (generator) olabilir ve ikinci kez gezilemez —
    // ikinci tur boş dönse hiçbir hücre dolmaz, üstelik hata da vermezdi. Yazının hangi
    // hücreye düştüğü ancak ızgara kurulduktan sonra bilinir, bu yüzden adaylar saklanır;
    // dikdörtgen dışındakiler burada elenir, böylece saklanan sayı tablo kadarıyla sınırlıdır.
    const hb = makeBuf(256), vb = makeBuf(256), txt = [];
    const m2 = tol * 2;
    for (const p of prims) {
      if (!p) continue;
      if (p.k === 1) {
        if (!num(p.x) || !num(p.y)) continue;
        if (p.x < R[0] - m2 || p.x > R[2] + m2 || p.y < R[1] - m2 || p.y > R[3] + m2) continue;
        const s = textOf(p);
        if (s) txt.push({ r: 0, c: 0, x: p.x, y: p.y, ha: p.ha | 0, va: p.va | 0, s });
        continue;
      }
      if (p.k !== 0 || !Array.isArray(p.ops) || !p.ops.length) continue;
      const bb = (Array.isArray(p.bb) && p.bb.length === 4) ? p.bb : opsBBox(p.ops);
      if (!bb || bb[2] < R[0] - tol || bb[0] > R[2] + tol || bb[3] < R[1] - tol || bb[1] > R[3] + tol) continue;
      walkOps(p, R, tol, hb, vb);
    }

    // 2-3) kümele: yatay çizgi genişliği, düşey çizgi yüksekliği kadar uzanmalı
    const gridY = clusterLines(hb, tol, w, minSpan);
    const gridX = clusterLines(vb, tol, h, minSpan);
    if (gridX.length < minLines + 1 || gridY.length < minLines + 1) return null;
    const nx = gridX.length - 1, ny = gridY.length - 1;
    if (nx * ny > MAX_CELLS) return null;

    // 4) hücreleri kur (r = 0 en üst satır; çizimde y yukarı büyür, gridY tersten okunur)
    const cells = new Array(nx * ny);
    for (let r = 0; r < ny; r++) {
      const yb = ny - 1 - r;
      for (let c = 0; c < nx; c++) {
        cells[r * nx + c] = { r, c, x0: gridX[c], y0: gridY[yb], x1: gridX[c + 1], y1: gridY[yb + 1], text: '', n: 0 };
      }
    }
    const eps = tol * 0.5;
    const hits = [];
    for (const it of txt) {
      const px = it.x + (it.ha === 2 ? -eps : it.ha === 1 ? 0 : eps);   // 0 sol · 1 orta · 2 sağ
      const py = it.y + (it.va === 3 ? -eps : it.va === 2 ? 0 : eps);   // 0 taban çizgisi · 1 alt · 2 orta · 3 üst
      const c = band(gridX, px), b = band(gridY, py);
      if (c < 0 || b < 0) continue;
      it.r = ny - 1 - b; it.c = c;
      hits.push(it);
    }
    // aynı hücrede çok yazı: önce yukarıdan aşağı, sonra soldan sağa
    hits.sort((a, b) => a.r - b.r || a.c - b.c || b.y - a.y || a.x - b.x);
    for (const it of hits) {
      const cell = cells[it.r * nx + it.c];
      cell.text = cell.n ? cell.text + ' ' + it.s : it.s;
      cell.n++;
    }

    // 5) satır dizisi
    const rows = new Array(ny);
    for (let r = 0; r < ny; r++) {
      const row = new Array(nx);
      for (let c = 0; c < nx; c++) row[c] = cells[r * nx + c].text;
      rows[r] = row;
    }
    return { rows, nx, ny, gridX, gridY, cells };
  } catch (e) {
    return null;
  }
}

/**
 * Satır dizisini CSV'ye çevirir. sep verilmezse ';' (ondalık ayracı virgül olan yerelde
 * güvenli ayraç). Alan içinde ayraç, çift tırnak ya da satır sonu varsa alan tırnaklanır ve
 * içteki tırnak ikilenir; satırlar CRLF ile ayrılır (RFC 4180).
 */
export function tableCsv(rows, sep) {
  if (!Array.isArray(rows)) return '';
  const s = typeof sep === 'string' && sep.length ? sep : ';';
  const q = (v) => {
    const t = v == null ? '' : String(v);
    return (t.indexOf(s) >= 0 || t.indexOf('"') >= 0 || t.indexOf('\n') >= 0 || t.indexOf('\r') >= 0)
      ? '"' + t.split('"').join('""') + '"' : t;
  };
  const out = [];
  for (const row of rows) out.push(Array.isArray(row) ? row.map(q).join(s) : q(row));
  return out.join('\r\n');
}
