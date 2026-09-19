/*
 * EXCEL 97-2003 (.xls — BIFF8 / BIFF5 ikili biçimi) → xlbook modeli.
 *
 * NEDEN. Kamu kurumlarında dolaşan tabloların önemli bir bölümü hâlâ .xls'tir: eski
 * yazılımların çıktısı, arşivdeki hakedişler, kurum içi şablonlar. v7.89'a kadar bu dosyalar
 * yalnız "Drive ile PDF'e çevir" düğmesi gösteriyordu — yani çevrimdışı açılamıyordu.
 *
 * KATMANLAR. OLE bileşik dosya (cfb.js) → "Workbook" (BIFF8) ya da "Book" (BIFF5) akışı →
 * kayıt akışı. Her kayıt: 2 bayt kimlik, 2 bayt uzunluk, gövde; 8.224 baytı aşan gövde
 * CONTINUE (0x003C) kayıtlarıyla sürer.
 *
 * FORMÜL METNİ ÇÖZÜLMEZ — bilerek. BIFF'te formül, metin olarak değil RPN belirteç akışı
 * olarak saklanır (ptgAdd, ptgFuncVar, ptgRef…); metne çevirmek ayrı bir derleyici demektir.
 * Buna gerek yok: BIFF'te her FORMULA kaydı SON HESAPLANAN DEĞERİ de taşır ve xlbook zaten
 * önbellekli değeri yeğler. Yani sayfa doğru görünür; yalnız formülün kendisi gösterilmez.
 * (xlsx'te durum tersidir: orada değer eksik olabilir, formül metni vardır.)
 *
 * ŞİFRELİ DOSYA. FILEPASS kaydı varsa içerik çözülemez; parola sorulmaz, açık bir hata verilir.
 */
import { Cfb } from './cfb.js';
import { YERLESIK } from './xlfmt.js';

const u8 = (b, p) => (p >= 0 && p < b.length ? b[p] : 0);
const u16 = (b, p) => (p >= 0 && p + 2 <= b.length ? b[p] | (b[p + 1] << 8) : 0);
const u32 = (b, p) => (p >= 0 && p + 4 <= b.length ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : 0);

const R = {
  FORMULA: 0x0006, EOF: 0x000A, CALCCOUNT: 0x000C, DATEMODE: 0x0022, FILEPASS: 0x002F,
  CONTINUE: 0x003C, SST: 0x00FC, LABELSST: 0x00FD, BOUNDSHEET: 0x0085, MULRK: 0x00BD,
  MULBLANK: 0x00BE, XF: 0x00E0, MERGEDCELLS: 0x00E5, CODEPAGE: 0x0042, FORMAT: 0x041E,
  BLANK: 0x0201, NUMBER: 0x0203, LABEL: 0x0204, BOOLERR: 0x0205, STRING: 0x0207,
  ROW: 0x0208, INDEX: 0x020B, RK: 0x027E, RSTRING: 0x00D6, BOF: 0x0809, DIMENSIONS: 0x0200,
};
const HATA = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0F: '#VALUE!', 0x17: '#REF!', 0x1D: '#NAME?', 0x24: '#NUM!', 0x2A: '#N/A' };
/* Kod sayfası: Türkçe dosyalar windows-1254'tür; CODEPAGE kaydı söyler, yoksa 1252 varsayılır. */
const KOD_SAYFA = { 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 65001: 'utf-8' };

/** RK sayısı: 30 bitlik kısaltılmış double ya da 30 bitlik tam sayı; alt iki bit bayraktır. */
function rkSayi(rk) {
  const tam = rk & 2, yuz = rk & 1;
  let v;
  if (tam) v = (rk | 0) >> 2;
  else { const dv = new DataView(new ArrayBuffer(8)); dv.setUint32(0, 0, true); dv.setUint32(4, rk & 0xFFFFFFFC, true); v = dv.getFloat64(0, true); }
  return yuz ? v / 100 : v;
}
function cift(b, p) { const dv = new DataView(b.buffer, b.byteOffset + p, 8); return dv.getFloat64(0, true); }

/* ---------------------------------------------------------------------------------
 * Kayıt akışı
 * ------------------------------------------------------------------------------- */
/*
 * CONTINUE birleştirme kayda göre değişir: SST'de sınır anlamlıdır (her parçanın başında
 * yeni bir "8 bit mi 16 bit mi" bayrağı vardır), ötekilerde gövde düz eklenir. Bu yüzden
 * okuyucu parçaları AYRI AYRI saklar; SST kendi kuralıyla, kalanlar birleştirerek okur.
 */
function kayitlar(b, tekBolum = false) {
  const out = []; let p = 0;
  while (p + 4 <= b.length) {
    const id = u16(b, p), len = u16(b, p + 2);
    const gov = b.subarray(p + 4, Math.min(b.length, p + 4 + len));
    p += 4 + len;
    if (id === R.CONTINUE && out.length) { out[out.length - 1].devam.push(gov); continue; }
    out.push({ id, gov, devam: [] });
    // Bir sayfa BOF ile başlar, EOF ile biter; sayfa gövdesi okunurken dosyanın kalanını
    // (öteki sayfaları) taramak on sayfalık bir kitapta işi on katına çıkarırdı.
    if (id === R.EOF && (tekBolum || p >= b.length)) break;
  }
  return out;
}
const tumu = (k) => { if (!k.devam.length) return k.gov; const n = k.gov.length + k.devam.reduce((a, x) => a + x.length, 0); const o = new Uint8Array(n); o.set(k.gov, 0); let d = k.gov.length; for (const x of k.devam) { o.set(x, d); d += x.length; } return o; };

/* ---------------------------------------------------------------------------------
 * Dizgeler
 * ------------------------------------------------------------------------------- */
/*
 * BIFF8 Unicode dizgesi: uzunluk, bayrak baytı (bit0 = 16 bit karakter, bit2 = uzantı,
 * bit3 = zengin biçim), sonra karakterler, sonra biçim ve uzantı blokları. Bayrağın
 * yanlış okunması bütün SST'yi kaydırır — hücrelerin yerine başka hücrelerin metni gelir.
 */
function kisaDizge(b, p, cozucu, biff8 = true) {
  const cch = u8(b, p);
  if (!biff8) { const bas = p + 1; return { s: cozucu(b.subarray(bas, bas + cch)), son: bas + cch }; }
  const bayrak = u8(b, p + 1), on6 = !!(bayrak & 1);
  const bas = p + 2, bayt = on6 ? cch * 2 : cch;
  const s = on6 ? new TextDecoder('utf-16le').decode(b.subarray(bas, bas + bayt)) : cozucu(b.subarray(bas, bas + bayt));
  return { s, son: bas + bayt };
}
/** SST okuyucu: parça sınırında bayrak baytı yenilenir (biçimin en çok yanlış uygulanan kuralı) */
function sstOku(kayit, cozucu) {
  const parca = [kayit.gov, ...kayit.devam];
  let ci = 0, p = 8;                       // ilk 8 bayt: toplam ve benzersiz dizge sayısı
  const kalan = () => parca[ci].length - p;
  const ilerle = () => { while (ci < parca.length && p >= parca[ci].length) { ci++; p = 0; } };
  const bayt = () => { ilerle(); if (ci >= parca.length) return 0; return parca[ci][p++]; };
  const iki = () => { const a = bayt(), b = bayt(); return a | (b << 8); };
  const dort = () => { const a = iki(), b = iki(); return (a | (b << 16)) >>> 0; };
  const atla = (n) => { let k = n; while (k > 0 && ci < parca.length) { ilerle(); if (ci >= parca.length) break; const al = Math.min(k, kalan()); p += al; k -= al; } };

  const benzersiz = u32(kayit.gov, 4);
  const liste = [];
  for (let i = 0; i < benzersiz; i++) {
    ilerle(); if (ci >= parca.length) break;
    const cch = iki();
    let bayrak = bayt();
    let on6 = !!(bayrak & 1);
    const zengin = !!(bayrak & 8), uzanti = !!(bayrak & 4);
    const cRun = zengin ? iki() : 0;
    const cbExt = uzanti ? dort() : 0;
    let s = '', yazilan = 0;
    while (yazilan < cch) {
      ilerle(); if (ci >= parca.length) break;
      const yer = kalan();
      const alinabilir = on6 ? Math.min(cch - yazilan, yer >> 1) : Math.min(cch - yazilan, yer);
      if (alinabilir > 0) {
        const bayt2 = on6 ? alinabilir * 2 : alinabilir;
        const dilim = parca[ci].subarray(p, p + bayt2);
        s += on6 ? new TextDecoder('utf-16le').decode(dilim) : cozucu(dilim);
        p += bayt2; yazilan += alinabilir;
      }
      if (yazilan < cch) {
        // parça bitti: sonraki parçanın İLK baytı yeni bayraktır
        ci++; p = 0;
        if (ci >= parca.length) break;
        bayrak = parca[ci][p++]; on6 = !!(bayrak & 1);
      }
    }
    atla(cRun * 4); atla(cbExt);
    liste.push(s);
  }
  return liste;
}

/* ---------------------------------------------------------------------------------
 * Okuma
 * ------------------------------------------------------------------------------- */
const hucre = (v, f, b) => ({ v: v === undefined ? null : v, f: f || null, b: b == null ? null : b });

export function okuXls(bytes, opts = {}) {
  const tt = opts.tt || ((k, tr) => tr);
  const cfb = new Cfb(bytes, { yokIleti: tt('xlNotExcel', 'Bu dosya Excel çalışma kitabı değil') });
  const akis = cfb.stream('Workbook') || cfb.stream('Book');
  if (!akis) throw new Error(tt('xlNotExcel', 'Bu dosya Excel çalışma kitabı değil') + ' (Workbook akışı yok)');
  const kay = kayitlar(akis);
  if (!kay.length || kay[0].id !== R.BOF) throw new Error('BIFF başlığı yok');
  // BIFF8 (Excel 97+) 0x0600; 0x0500 BIFF5/7 (Excel 5/95). İkisinin dizge yazımı farklıdır:
  // BIFF8 Unicode bayrağı taşır, BIFF5 doğrudan kod sayfası baytlarıdır.
  const biff8 = u16(kay[0].gov, 0) >= 0x0600;

  // --- kod sayfası ve şifre denetimi (genel bölüm) ---
  let kodSayfa = 1252, sifreli = false;
  for (const k of kay) {
    if (k.id === R.CODEPAGE) kodSayfa = u16(k.gov, 0) || 1252;
    if (k.id === R.FILEPASS) sifreli = true;
    if (k.id === R.BOF && k !== kay[0]) break;
  }
  if (sifreli) throw new Error(tt('xlEncrypted', 'Bu Excel dosyası parola korumalı; içeriği açılamaz'));
  let cozucu;
  try { const d = new TextDecoder(KOD_SAYFA[kodSayfa] || 'windows-1252'); cozucu = (x) => d.decode(x); }
  catch (_) { cozucu = (x) => String.fromCharCode(...x); }

  const kitap = { bicim: 'xls', sayfalar: [], adlar: new Map(), tarih1904: false, uyarilar: [] };
  const sst = [];
  const bicimKod = new Map();     // numFmtId → kod (yerleşikler xlbook'ta)
  const xfFmt = [];               // XF sırası → numFmtId
  const sayfaBilgi = [];          // BOUNDSHEET: { ad, ofs, gizli }

  for (const k of kay) {
    if (k.id === R.BOF && sayfaBilgi.length && k.gov.length >= 4 && u16(k.gov, 2) !== 0x0005) break;   // genel bölüm bitti
    switch (k.id) {
      case R.DATEMODE: kitap.tarih1904 = u16(k.gov, 0) === 1; break;
      case R.SST: sst.push(...sstOku(k, cozucu)); break;
      case R.FORMAT: { const g = tumu(k); bicimKod.set(u16(g, 0), biff8 ? biffMetin(g, 2, cozucu) : kisaDizge(g, 2, cozucu, false).s); break; }
      case R.XF: xfFmt.push(u16(k.gov, 2)); break;
      case R.BOUNDSHEET: { const ofs = u32(k.gov, 0), gizli = (u8(k.gov, 4) & 3) !== 0, tur = u8(k.gov, 5); const d = kisaDizge(k.gov, 6, cozucu, biff8); sayfaBilgi.push({ ad: d.s, ofs, gizli, tur }); break; }
      default: break;
    }
  }
  const kodOf = (ixfe) => { const id = xfFmt[ixfe]; return id == null ? null : (bicimKod.get(id) ?? null) ?? yerlesikKod(id); };

  // --- sayfa gövdeleri: BOUNDSHEET akış içindeki bayt konumunu verir ---
  for (const bilgi of sayfaBilgi) {
    if (bilgi.tur !== 0) continue;         // yalnız çalışma sayfası (grafik / makro sayfası değil)
    const sayfa = { ad: bilgi.ad, h: [], satir: 0, sutun: 0, birlesim: [] };
    kitap.sayfalar.push(sayfa);
    const gov = akis.subarray(Math.min(bilgi.ofs, akis.length));
    const kk = kayitlar(gov, true);
    let sonFormul = null;                   // FORMULA'nın metin sonucu bir sonraki STRING kaydındadır
    const koy = (r, c, h) => { if (r < 0 || c < 0 || r > 1048575 || c > 16383) return; (sayfa.h[r] || (sayfa.h[r] = []))[c] = h; if (r + 1 > sayfa.satir) sayfa.satir = r + 1; if (c + 1 > sayfa.sutun) sayfa.sutun = c + 1; };
    for (const k of kk) {
      if (k.id === R.EOF) break;
      const g = k.gov;
      switch (k.id) {
        case R.LABELSST: koy(u16(g, 0), u16(g, 2), hucre(sst[u32(g, 6)] ?? '', null, kodOf(u16(g, 4)))); break;
        case R.LABEL: { const d = biffMetin(tumu(k), 6, cozucu, biff8); koy(u16(g, 0), u16(g, 2), hucre(d, null, kodOf(u16(g, 4)))); break; }
        case R.RSTRING: { const d = biffMetin(tumu(k), 6, cozucu, biff8); koy(u16(g, 0), u16(g, 2), hucre(d, null, kodOf(u16(g, 4)))); break; }
        case R.RK: koy(u16(g, 0), u16(g, 2), hucre(rkSayi(u32(g, 6)), null, kodOf(u16(g, 4)))); break;
        case R.NUMBER: koy(u16(g, 0), u16(g, 2), hucre(cift(g, 6), null, kodOf(u16(g, 4)))); break;
        case R.BOOLERR: { const hata = u8(g, 7) === 1; const v = hata ? { e: HATA[u8(g, 6)] || '#VALUE!' } : u8(g, 6) !== 0; koy(u16(g, 0), u16(g, 2), hucre(v, null, kodOf(u16(g, 4)))); break; }
        case R.MULRK: { const r = u16(g, 0), c0 = u16(g, 2); const n = Math.floor((g.length - 6) / 6); for (let i = 0; i < n; i++) koy(r, c0 + i, hucre(rkSayi(u32(g, 4 + i * 6 + 2)), null, kodOf(u16(g, 4 + i * 6)))); break; }
        case R.FORMULA: {
          const r = u16(g, 0), c = u16(g, 2), ixfe = u16(g, 4);
          let v;
          if (u16(g, 12) === 0xFFFF) {
            const tur = u8(g, 6);
            if (tur === 0) { sonFormul = { r, c, ixfe }; v = ''; }         // metin: STRING kaydı gelecek
            else if (tur === 1) v = u8(g, 8) !== 0;
            else if (tur === 2) v = { e: HATA[u8(g, 8)] || '#VALUE!' };
            else v = null;
          } else v = cift(g, 6);
          koy(r, c, hucre(v, null, kodOf(ixfe)));
          break;
        }
        case R.STRING: { if (sonFormul) { const d = biffMetin(tumu(k), 0, cozucu, biff8); koy(sonFormul.r, sonFormul.c, hucre(d, null, kodOf(sonFormul.ixfe))); sonFormul = null; } break; }
        case R.MERGEDCELLS: { const n = u16(g, 0); for (let i = 0; i < n; i++) { const o = 2 + i * 8; sayfa.birlesim.push(ref(u16(g, o), u16(g, o + 4)) + ':' + ref(u16(g, o + 2), u16(g, o + 6))); } break; }
        default: break;
      }
    }
  }
  if (!kitap.sayfalar.length) throw new Error(tt('xlNoSheet', 'Çalışma sayfası bulunamadı'));
  return kitap;
}
/** BIFF8 uzun dizgesi (cch u16 + bayrak) — LABEL / STRING kayıtlarında */
function biffMetin(b, p, cozucu, biff8 = true) {
  const cch = u16(b, p);
  if (!biff8) return cozucu(b.subarray(p + 2, p + 2 + cch));
  const bayrak = u8(b, p + 2), on6 = !!(bayrak & 1);
  const bas = p + 3, bayt = on6 ? cch * 2 : cch;
  if (bas + bayt > b.length + 1) return '';
  return on6 ? new TextDecoder('utf-16le').decode(b.subarray(bas, bas + bayt)) : cozucu(b.subarray(bas, bas + bayt));
}
const sutunAd = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const ref = (r, c) => sutunAd(c) + (r + 1);
/* Yerleşik biçim numaraları (0-49) tek yerde durur: xlfmt.YERLESIK. Burada ikinci bir
 * kopya tutmak, iki tablonun zamanla ayrışması demekti. Özel kodlar (164+) FORMAT kaydından gelir. */
const yerlesikKod = (id) => (id == null ? null : YERLESIK[id] ?? null);
