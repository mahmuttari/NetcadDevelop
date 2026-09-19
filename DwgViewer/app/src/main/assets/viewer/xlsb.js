/*
 * EXCEL İKİLİ ÇALIŞMA KİTABI (.xlsb — BIFF12) → xlbook modeli.
 *
 * NEDEN. xlsb, xlsx ile aynı ZIP kabuğunu kullanır ama içindeki parçalar XML değil ikilidir.
 * Büyük tabloları hızlı açtığı için kurumlarda "ağır dosya" çözümü olarak yaygınlaşır; bir
 * Excel görüntüleyici onu tanımıyorsa kullanıcı için o dosya yok demektir.
 *
 * KAYIT BİÇİMİ. Her kayıt: değişken uzunluklu kimlik (1-2 bayt; ilk baytın 0x80 biti varsa
 * ikinci bayt da okunur) + değişken uzunluklu boy (1-4 bayt, her bayt 7 bit) + gövde.
 * Hücre başlığı 8 bayttır: sütun (u32) + biçim sırası (3 bayt) + bayraklar (1 bayt); satır
 * numarası ayrı bir BrtRowHdr kaydından gelir.
 *
 * FORMÜL METNİ ÇÖZÜLMEZ — .xls'te olduğu gibi, aynı gerekçeyle: BIFF12'de de formül RPN
 * belirteç akışıdır ve kayıt son hesaplanan değeri zaten taşır.
 */
const u8 = (b, p) => (p >= 0 && p < b.length ? b[p] : 0);
const u16 = (b, p) => (p >= 0 && p + 2 <= b.length ? b[p] | (b[p + 1] << 8) : 0);
const u32 = (b, p) => (p >= 0 && p + 4 <= b.length ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : 0);
const cift = (b, p) => (p + 8 <= b.length ? new DataView(b.buffer, b.byteOffset + p, 8).getFloat64(0, true) : 0);

const B = {
  ROW: 0x0000, BLANK: 0x0001, RK: 0x0002, HATA: 0x0003, BOOL: 0x0004, REEL: 0x0005,
  METIN: 0x0006, ISST: 0x0007, F_METIN: 0x0008, F_SAYI: 0x0009, F_BOOL: 0x000A, F_HATA: 0x000B,
  SST_OGE: 0x0013, BIRLESIM: 0x00B0, SAYFA: 0x009C,
};
/*
 * İki numara kolay karışır: BrtFmt (biçim kodu tanımı) 0x002C, BrtXF 0x002F. Aşağıdaki
 * tablo MS-XLSB'nin numaralarıdır; yanlış numara sessizce boş biçim verir, bu yüzden ikisi
 * de ayrı ayrı yazıldı.
 */
const BRT_FMT = 0x002C;   // ifmt (u16) + biçim kodu
const BRT_XF = 0x002F;    // ixfeParent (u16) + iFmt (u16) + …
const HATA_KOD = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0F: '#VALUE!', 0x17: '#REF!', 0x1D: '#NAME?', 0x24: '#NUM!', 0x2A: '#N/A' };

/** RK sayısı — .xls ile aynı kuruluş */
function rkSayi(rk) {
  const tam = rk & 2, yuz = rk & 1;
  let v;
  if (tam) v = (rk | 0) >> 2;
  else { const dv = new DataView(new ArrayBuffer(8)); dv.setUint32(0, 0, true); dv.setUint32(4, rk & 0xFFFFFFFC, true); v = dv.getFloat64(0, true); }
  return yuz ? v / 100 : v;
}
/** XLWideString: uzunluk (u32 karakter) + UTF-16LE */
function genisMetin(b, p) {
  const cch = u32(b, p);
  if (cch === 0xFFFFFFFF || cch > 1e7) return { s: '', son: p + 4 };
  const bayt = cch * 2;
  return { s: new TextDecoder('utf-16le').decode(b.subarray(p + 4, p + 4 + bayt)), son: p + 4 + bayt };
}
/** Kayıt akışı: değişken uzunluklu kimlik ve boy */
function* kayitlar(b) {
  let p = 0;
  while (p < b.length) {
    let id = b[p++];
    if (id & 0x80) { id = (id & 0x7F) | (b[p++] << 7); }
    let boy = 0;
    for (let i = 0; i < 4; i++) { const x = b[p++]; boy |= (x & 0x7F) << (7 * i); if (!(x & 0x80)) break; }
    if (boy < 0 || p + boy > b.length) { yield { id, gov: b.subarray(p, b.length) }; return; }
    yield { id, gov: b.subarray(p, p + boy) };
    p += boy;
  }
}
const hucre = (v, f, bc) => ({ v: v === undefined ? null : v, f: f || null, b: bc == null ? null : bc });
const sutunAd = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export async function okuXlsb(arc, opts = {}) {
  const YERLESIK = opts.YERLESIK, tt = opts.tt || ((k, tr) => tr);
  const kitap = { bicim: 'xlsb', sayfalar: [], adlar: new Map(), tarih1904: false, uyarilar: [] };
  const oku = async (yol) => { try { const x = await arc.read(yol); return x instanceof Uint8Array ? x : new Uint8Array(x); } catch (_) { return null; } };

  // --- paylaşılan dizgeler ---
  const sst = [];
  const sstBuf = await oku('xl/sharedStrings.bin');
  if (sstBuf) for (const k of kayitlar(sstBuf)) { if (k.id === B.SST_OGE) sst.push(genisMetin(k.gov, 1).s); }

  // --- biçimler ---
  const kodOfId = new Map(Object.entries(YERLESIK || {}).map(([k, v]) => [+k, v]));
  const xfFmt = [];
  const styBuf = await oku('xl/styles.bin');
  if (styBuf) {
    let xfBolumu = false;
    for (const k of kayitlar(styBuf)) {
      if (k.id === BRT_FMT) { kodOfId.set(u16(k.gov, 0), genisMetin(k.gov, 2).s); continue; }
      if (k.id === BRT_XF) { xfFmt.push(u16(k.gov, 2)); xfBolumu = true; continue; }
      if (xfBolumu && k.id === 0x0271) break;   // BrtEndCellXFs
    }
  }
  const kodOf = (ixf) => { const id = xfFmt[ixf]; return id == null ? null : (kodOfId.get(id) ?? null); };

  // --- sayfa listesi ve ilişkiler ---
  const rels = new Map();
  const relBuf = await oku('xl/_rels/workbook.bin.rels');
  if (relBuf && typeof DOMParser === 'function') {
    const d = new DOMParser().parseFromString(new TextDecoder().decode(relBuf), 'application/xml');
    for (const r of d.getElementsByTagName('Relationship')) rels.set(r.getAttribute('Id'), r.getAttribute('Target') || '');
  }
  const wbBuf = await oku('xl/workbook.bin');
  if (!wbBuf) throw new Error(tt('xlNotExcel', 'Bu dosya Excel çalışma kitabı değil') + ' (xl/workbook.bin yok)');
  const sayfaBilgi = [];
  for (const k of kayitlar(wbBuf)) {
    if (k.id !== B.SAYFA) continue;
    const gizli = u32(k.gov, 0) !== 0;
    const rid = genisMetin(k.gov, 8);
    const ad = genisMetin(k.gov, rid.son);
    sayfaBilgi.push({ ad: ad.s, rid: rid.s, gizli });
  }

  for (const bilgi of sayfaBilgi) {
    const hedef = rels.get(bilgi.rid);
    const yol = hedef ? 'xl/' + String(hedef).replace(/^\/?xl\//, '').replace(/^\//, '') : null;
    const buf = yol ? await oku(yol) : null;
    const sayfa = { ad: bilgi.ad, h: [], satir: 0, sutun: 0, birlesim: [] };
    kitap.sayfalar.push(sayfa);
    if (!buf) { kitap.uyarilar.push(bilgi.ad + ': sayfa parçası bulunamadı'); continue; }
    const koy = (r, c, h) => { if (r < 0 || c < 0 || r > 1048575 || c > 16383) return; (sayfa.h[r] || (sayfa.h[r] = []))[c] = h; if (r + 1 > sayfa.satir) sayfa.satir = r + 1; if (c + 1 > sayfa.sutun) sayfa.sutun = c + 1; };
    let r = 0;
    for (const k of kayitlar(buf)) {
      const g = k.gov;
      switch (k.id) {
        case B.ROW: r = u32(g, 0); break;
        case B.RK: koy(r, u32(g, 0), hucre(rkSayi(u32(g, 8)), null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.REEL: koy(r, u32(g, 0), hucre(cift(g, 8), null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.BOOL: koy(r, u32(g, 0), hucre(u8(g, 8) !== 0, null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.HATA: koy(r, u32(g, 0), hucre({ e: HATA_KOD[u8(g, 8)] || '#VALUE!' }, null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.ISST: koy(r, u32(g, 0), hucre(sst[u32(g, 8)] ?? '', null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.METIN: koy(r, u32(g, 0), hucre(genisMetin(g, 8).s, null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.F_SAYI: koy(r, u32(g, 0), hucre(cift(g, 8), null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.F_METIN: koy(r, u32(g, 0), hucre(genisMetin(g, 8).s, null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.F_BOOL: koy(r, u32(g, 0), hucre(u8(g, 8) !== 0, null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.F_HATA: koy(r, u32(g, 0), hucre({ e: HATA_KOD[u8(g, 8)] || '#VALUE!' }, null, kodOf(u32(g, 4) & 0xFFFFFF))); break;
        case B.BIRLESIM: sayfa.birlesim.push(sutunAd(u32(g, 8)) + (u32(g, 0) + 1) + ':' + sutunAd(u32(g, 12)) + (u32(g, 4) + 1)); break;
        default: break;
      }
    }
  }
  if (!kitap.sayfalar.length) throw new Error(tt('xlNoSheet', 'Çalışma sayfası bulunamadı'));
  return kitap;
}
