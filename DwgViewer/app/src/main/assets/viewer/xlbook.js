/*
 * EXCEL ÇALIŞMA KİTABI — dosyadan sayfaya (biçim tanıma, okuma, hesaplama, görünüm).
 *
 * NEDEN AYRI BİR KATMAN. v7.89'a kadar Excel okuması docs.js'in içinde tek bir işlevdi ve
 * yalnız xlsx biliyordu: hücrenin <v> değerini okuyup altı haneye yuvarlıyordu. Üç şey
 * eksikti ve üçü de sahada karşımıza çıkıyor:
 *
 *   1. FORMÜL. Dosyayı en son Excel kaydettiyse her formül hücresinde bir de son hesaplanan
 *      değer (<v>) durur. Ama LibreOffice'in bazı sürümleri, openpyxl / xlsxwriter gibi
 *      kütüphaneler ve kurum yazılımlarının ürettiği dosyalar <v> YAZMAZ; o dosyalar bizde
 *      bomboş görünüyordu. Artık değer yoksa formül hesaplanır (xlfn.js).
 *   2. BİÇİM. Değer ile görünüş ayrı yerde durur: 45923 bir tarihtir, 0,18 bir yüzdedir.
 *      Biçim kodu okunmadan hakediş ya da keşif tablosu okunamaz hâle gelir (xlfmt.js).
 *   3. BİÇİMİN KENDİSİ. "Excel" dendiğinde gelen dosya her zaman xlsx değildir: eski .xls,
 *      .xlsb, LibreOffice .ods, Excel 2003'ün XML'i, kurumsal yazılımların "xls" diye
 *      kaydettiği HTML tablosu, noktalı virgülle ayrılmış CSV… Kullanıcının isteği açıktı:
 *      "açamayacağı herhangi bir Excel olmasın".
 *
 * UZANTIYA GÜVENİLMEZ. Biçim, dosyanın ilk baytlarından tanınır (`tani`). Sahada en sık
 * görülen yanlış uzantı, kurum yazılımlarının ürettiği HTML tablosunun ".xls" adıyla
 * kaydedilmesidir; Excel onu açar, uzantıya bakan bir okuyucu açamaz.
 *
 * ORTAK MODEL. Hangi biçimden gelirse gelsin sonuç aynı şekle oturur:
 *   Kitap  : { bicim, sayfalar: [Sayfa], adlar: Map, tarih1904, uyarilar: [] }
 *   Sayfa  : { ad, h: [[Hucre|null]], satir, sutun, birlesim: ['A1:B2'] }
 *   Hucre  : { v: ham değer, f: formül metni | null, b: biçim kodu | null }
 * Ham değer, xlfn.js'in değer sözleşmesiyle aynıdır: sayı / metin / mantık / null / {e}.
 *
 * HESAP SIRASI. Hücre değeri istendiğinde: (a) ham değer varsa o kullanılır — dosyadaki
 * önbellekli değer Excel'in kendi sonucudur, yeniden hesaplamak hem yavaş hem gereksizdir;
 * (b) yoksa formül hesaplanır ve sonuç bellekte tutulur. Döngüsel başvuru (A1 kendini
 * gösteriyor) sonsuz özyinelemeye girmez: zincir yakalanır, 0 döner ve uyarı listesine yazılır
 * — Excel'in yineleme kapalıyken yaptığının aynısı.
 */
import * as XL from './xlfn.js';
import './xlfn_math.js';
import './xlfn_stat.js';
import './xlfn_text.js';
import './xlfn_date.js';
import './xlfn_logic.js';
import './xlfn_ref.js';
import './xlfn_fin.js';
import './xlfn_eng.js';
import { bicimle, YERLESIK, TARIH_ID } from './xlfmt.js';

const dec = (buf, kod = 'utf-8') => new TextDecoder(kod).decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
const u8of = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));

// ---------------------------------------------------------------------------------
// Biçim tanıma
// ---------------------------------------------------------------------------------
/*
 * Dönüş: 'zip' (xlsx / xlsb / ods — hangisi olduğu arşiv içeriğinden anlaşılır), 'ole'
 * (.xls BIFF), 'xml2003', 'html', 'csv', 'bilinmiyor'. Uzantı yalnız ipucu olarak
 * kullanılır; karar baytlarındır.
 */
export function tani(buf, ad = '') {
  const u = u8of(buf);
  if (u.length >= 8 && u[0] === 0xD0 && u[1] === 0xCF && u[2] === 0x11 && u[3] === 0xE0) return 'ole';
  if (u.length >= 4 && u[0] === 0x50 && u[1] === 0x4B && (u[2] === 3 || u[2] === 5 || u[2] === 7)) return 'zip';
  // Metin tabanlılar: ilk 8 KiB yeter. UTF-16 damgası varsa ona göre çözülür.
  let s;
  if (u[0] === 0xFF && u[1] === 0xFE) s = dec(u.subarray(0, 16384), 'utf-16le');
  else if (u[0] === 0xFE && u[1] === 0xFF) s = dec(u.subarray(0, 16384), 'utf-16be');
  else s = dec(u.subarray(0, 8192));
  const t = s.replace(/^﻿/, '').replace(/\u0000/g, '').replace(/^\s+/, '');
  if (/^<\?xml/i.test(t) && /urn:schemas-microsoft-com:office:spreadsheet/i.test(t)) return 'xml2003';
  if (/<(!doctype\s+html|html|table|body|meta|head)\b/i.test(t)) return 'html';
  if (/^<\?xml/i.test(t) && /<Workbook\b/i.test(t)) return 'xml2003';
  // Düz metin mi? Yazdırılabilir oranı yüksekse ayraçlı metin sayılır.
  let yaz = 0; const n = Math.min(u.length, 2048);
  for (let i = 0; i < n; i++) { const c = u[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127) || c >= 0x80) yaz++; }
  if (n && yaz / n > 0.95) return 'csv';
  return 'bilinmiyor';
}
/** Arşivin içindekilere bakarak hangi ZIP tabanlı biçim olduğunu söyler */
export function zipBicimi(entries) {
  const ad = new Set((entries || []).map(e => String(e.name || e).replace(/^\.?\//, '')));
  if ([...ad].some(n => /^xl\/worksheets\/.*\.bin$/i.test(n))) return 'xlsb';
  if ([...ad].some(n => /^xl\/workbook\.(xml|bin)$/i.test(n))) return ad.has('xl/workbook.bin') ? 'xlsb' : 'xlsx';
  if (ad.has('content.xml') || [...ad].some(n => /^content\.xml$/i.test(n))) return 'ods';
  return 'bilinmiyor';
}

// ---------------------------------------------------------------------------------
// Ortak model
// ---------------------------------------------------------------------------------
export const sutunNo = XL.sutunNo;
export const sutunAd = XL.sutunAd;
const yeniKitap = (bicim) => ({ bicim, sayfalar: [], adlar: new Map(), tarih1904: false, uyarilar: [] });
const yeniSayfa = (ad) => ({ ad: ad || '', h: [], satir: 0, sutun: 0, birlesim: [] });
function koy(sayfa, r, c, hucre) {
  if (r < 0 || c < 0) return;
  let sat = sayfa.h[r]; if (!sat) sat = sayfa.h[r] = [];
  sat[c] = hucre;
  if (r + 1 > sayfa.satir) sayfa.satir = r + 1;
  if (c + 1 > sayfa.sutun) sayfa.sutun = c + 1;
}
const hucre = (v, f, b) => ({ v: v === undefined ? null : v, f: f || null, b: b == null ? null : b });

/** "A1" / "$B$7" → { r, c } (0 tabanlı). Geçersizse null. */
export function refCoz(s) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(s || '').trim());
  return m ? { r: +m[2] - 1, c: sutunNo(m[1]) } : null;
}

// ---------------------------------------------------------------------------------
// Paylaşılan formül kaydırma
// ---------------------------------------------------------------------------------
/*
 * xlsx'te bir sütuna aynı formül yazıldığında Excel metni YALNIZ İLK hücreye koyar
 * (<f t="shared" si="3" ref="B2:B50">), kalanlar yalnız si numarasını taşır. Metin
 * kopyalanmakla bitmez: göreli başvurular kaydırılmalıdır (B2'deki A2, B3'te A3 olur).
 *
 * Kaydırma metin üzerinde yapılır ama kaba bir regex ile DEĞİL: tırnak içindeki metin
 * ("A1 sütunu" gibi), tek tırnaklı sayfa adları ('Ocak 2026'!A1) ve hata değerleri (#REF!)
 * es geçilir; bir A1 örüntüsünün önünde harf ya da rakam varsa (LOG10 içindeki G10 gibi)
 * o bir başvuru değildir. $ ile sabitlenmiş kısım kaydırılmaz — kuralın tamamı budur.
 */
export function kaydirFormul(src, dr, dc) {
  if (!src || (!dr && !dc)) return src || '';
  const s = String(src); let out = '';
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === '"') { const j = s.indexOf('"', i + 1); const son = j < 0 ? s.length : j + 1; out += s.slice(i, son); i = son; continue; }
    if (ch === "'") { const j = s.indexOf("'", i + 1); const son = j < 0 ? s.length : j + 1; out += s.slice(i, son); i = son; continue; }
    if (ch === '#') { const m = /^#[A-Za-z0-9_/!?]+/.exec(s.slice(i)); if (m) { out += m[0]; i += m[0].length; continue; } }
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w.(])/.exec(s.slice(i));
    if (m) {
      const onceki = i ? s[i - 1] : '';
      if (!/[A-Za-z0-9_.]/.test(onceki)) {
        const c = sutunNo(m[2]), r = +m[4] - 1;
        const yc = m[1] ? c : c + dc, yr = m[3] ? r : r + dr;
        out += (yc < 0 || yr < 0 || yc > 16383 || yr > 1048575)
          ? '#REF!'
          : m[1] + sutunAd(yc) + m[3] + (yr + 1);
        i += m[0].length; continue;
      }
    }
    out += ch; i++;
  }
  return out;
}

// ---------------------------------------------------------------------------------
// xlsx / xlsm (OOXML)
// ---------------------------------------------------------------------------------
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function xml(buf) {
  if (typeof DOMParser !== 'function') throw new Error('DOMParser yok');
  const d = new DOMParser().parseFromString(dec(buf), 'application/xml');
  if (d.querySelector('parsererror')) throw new Error('XML çözümlenemedi');
  return d;
}
const cocuklar = (el, ad) => (el ? [...el.getElementsByTagName(ad)] : []);
async function belki(arc, yol) { try { return await arc.read(yol); } catch (_) { return null; } }

/** Paylaşılan dizge tablosu: <si> içinde düz <t> ya da biçimli <r><t> parçaları */
function sharedStrings(doc) {
  if (!doc) return [];
  return [...doc.getElementsByTagName('si')].map(si => cocuklar(si, 't').map(x => x.textContent).join(''));
}
/*
 * styles.xml: hücrenin `s` özniteliği cellXfs sırasını, o da numFmtId'yi verir. 0-49 arası
 * numaraların kodu dosyada YAZMAZ, yerleşiktir (xlfmt.YERLESIK); 164 ve sonrası dosyadan gelir.
 */
function bicimTablosu(doc) {
  const kod = new Map(Object.entries(YERLESIK).map(([k, v]) => [+k, v]));
  if (!doc) return { xf: [], kod };
  for (const nf of doc.getElementsByTagName('numFmt')) kod.set(+nf.getAttribute('numFmtId'), nf.getAttribute('formatCode') || '');
  const xfs = doc.getElementsByTagName('cellXfs')[0];
  const xf = xfs ? [...xfs.getElementsByTagName('xf')].map(x => +(x.getAttribute('numFmtId') || 0)) : [];
  return { xf, kod };
}
async function okuXlsx(arc) {
  const kitap = yeniKitap('xlsx');
  const wb = xml(await arc.read('xl/workbook.xml'));
  const pr = wb.getElementsByTagName('workbookPr')[0];
  if (pr && (pr.getAttribute('date1904') === '1' || pr.getAttribute('date1904') === 'true')) kitap.tarih1904 = true;
  let rels = new Map();
  const relBuf = await belki(arc, 'xl/_rels/workbook.xml.rels');
  if (relBuf) for (const r of xml(relBuf).getElementsByTagName('Relationship')) rels.set(r.getAttribute('Id'), r.getAttribute('Target') || '');
  const ss = sharedStrings(await belki(arc, 'xl/sharedStrings.xml').then(b => (b ? xml(b) : null)).catch(() => null));
  const sty = bicimTablosu(await belki(arc, 'xl/styles.xml').then(b => (b ? xml(b) : null)).catch(() => null));
  const kodOf = (sIdx) => { if (sIdx == null || sIdx === '') return null; const id = sty.xf[+sIdx]; return id == null ? null : (sty.kod.get(id) || null); };

  for (const sh of wb.getElementsByTagName('sheet')) {
    const ad = sh.getAttribute('name') || '';
    if ((sh.getAttribute('state') || '') === 'veryHidden') continue;
    const rid = sh.getAttributeNS(R_NS, 'id') || sh.getAttribute('r:id');
    const hedef = rels.get(rid);
    if (!hedef) continue;
    const yol = 'xl/' + String(hedef).replace(/^\/?xl\//, '').replace(/^\//, '');
    const sayfa = yeniSayfa(ad);
    try {
      const doc = xml(await arc.read(yol));
      const paylasilan = new Map();   // si → { src, r, c }
      for (const row of doc.getElementsByTagName('row')) {
        for (const c of row.getElementsByTagName('c')) {
          const ref = refCoz(c.getAttribute('r') || '');
          if (!ref) continue;
          const tp = c.getAttribute('t') || 'n';
          const vEl = c.getElementsByTagName('v')[0];
          const isEl = c.getElementsByTagName('is')[0];
          const fEl = c.getElementsByTagName('f')[0];
          let f = null;
          if (fEl) {
            const ft = fEl.getAttribute('t') || 'normal';
            const si = fEl.getAttribute('si');
            const src = fEl.textContent || '';
            if (ft === 'shared' && si != null) {
              if (src) { paylasilan.set(si, { src, r: ref.r, c: ref.c }); f = src; }
              else { const p = paylasilan.get(si); f = p ? kaydirFormul(p.src, ref.r - p.r, ref.c - p.c) : null; }
            } else if (ft === 'dataTable') f = null;   // veri tablosu (what-if) — değeri önbellekten okunur
            else f = src || null;
          }
          let v = null;
          if (tp === 's') v = ss[+(vEl ? vEl.textContent : 0)] ?? '';
          else if (tp === 'inlineStr') v = isEl ? cocuklar(isEl, 't').map(x => x.textContent).join('') : '';
          else if (tp === 'str') v = vEl ? vEl.textContent : '';
          else if (tp === 'b') v = vEl ? vEl.textContent === '1' : false;
          else if (tp === 'e') v = XL.hataAl(vEl ? vEl.textContent : '#VALUE!');
          else if (vEl && vEl.textContent.trim() !== '') { const n = Number(vEl.textContent); v = isFinite(n) ? n : vEl.textContent; }
          else v = null;
          if (v === null && !f) continue;   // boş hücre yer kaplamasın
          koy(sayfa, ref.r, ref.c, hucre(v, f, kodOf(c.getAttribute('s'))));
        }
      }
      for (const m of doc.getElementsByTagName('mergeCell')) { const r = m.getAttribute('ref'); if (r) sayfa.birlesim.push(r); }
    } catch (e) { kitap.uyarilar.push(ad + ': ' + (e.message || e)); }
    kitap.sayfalar.push(sayfa);
  }
  // Tanımlı adlar: "Sheet1!$A$1:$B$4" ya da sabit bir değer
  for (const dn of wb.getElementsByTagName('definedName')) {
    const ad = dn.getAttribute('name'); if (!ad || /^_xlnm\./i.test(ad)) continue;
    kitap.adlar.set(ad.toUpperCase(), (dn.textContent || '').trim());
  }
  return kitap;
}

// ---------------------------------------------------------------------------------
// ODS (OpenDocument — LibreOffice / Google E-Tablolar dışa aktarımı)
// ---------------------------------------------------------------------------------
/*
 * ODS'te tekrar eden hücre ve satırlar sayıyla kısaltılır (number-columns-repeated).
 * Bir sayfanın sonundaki "1024 boş sütun" ya da "1048576 boş satır" olduğu gibi açılırsa
 * bellek biter; bu yüzden yineleme yalnız DOLU hücre için açılır, sondaki boşluk atılır.
 */
const ODS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const ODS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
async function okuOds(arc) {
  const kitap = yeniKitap('ods');
  const doc = xml(await arc.read('content.xml'));
  const oz = (el, ad, ns = ODS_TABLE) => el.getAttributeNS(ns, ad) ?? el.getAttribute('table:' + ad) ?? null;
  for (const tbl of doc.getElementsByTagNameNS(ODS_TABLE, 'table')) {
    const sayfa = yeniSayfa(oz(tbl, 'name') || '');
    let r = 0;
    for (const row of tbl.getElementsByTagNameNS(ODS_TABLE, 'table-row')) {
      const yr = Math.min(+(oz(row, 'number-rows-repeated') || 1) || 1, 100000);
      let c = 0; const satir = [];
      for (const cell of row.childNodes) {
        if (cell.nodeType !== 1 || !/table-(table-)?cell$/.test(cell.nodeName)) continue;
        const yc = Math.min(+(oz(cell, 'number-columns-repeated') || 1) || 1, 16384);
        const tur = cell.getAttributeNS(ODS_OFFICE, 'value-type') || cell.getAttribute('office:value-type');
        const sayi = cell.getAttributeNS(ODS_OFFICE, 'value') ?? cell.getAttribute('office:value');
        const bool = cell.getAttributeNS(ODS_OFFICE, 'boolean-value') ?? cell.getAttribute('office:boolean-value');
        const tarih = cell.getAttributeNS(ODS_OFFICE, 'date-value') ?? cell.getAttribute('office:date-value');
        let fml = oz(cell, 'formula');
        if (fml) fml = String(fml).replace(/^of:/, '').replace(/^=/, '').replace(/\[\.?([A-Za-z$]+\d+)\]/g, '$1').replace(/\[\.?([^\]]+)\]/g, '$1');
        const metin = [...cell.getElementsByTagNameNS(ODS_TEXT, 'p')].map(p => p.textContent).join('\n');
        let v = null;
        if (tur === 'float' || tur === 'percentage' || tur === 'currency') v = Number(sayi);
        else if (tur === 'boolean') v = bool === 'true';
        else if (tur === 'date') v = tarihMetinSeri(tarih);
        else if (metin !== '') v = metin;
        for (let k = 0; k < yc; k++) satir.push(v === null && !fml ? null : hucre(v, fml, null));
        c += yc;
        if (satir.length > 16384) break;
      }
      while (satir.length && satir[satir.length - 1] == null) satir.pop();
      if (satir.length) for (let k = 0; k < yr && k < 1000; k++) satir.forEach((h, i) => { if (h) koy(sayfa, r + k, i, h); });
      r += yr;
      if (r > 1048576) break;
    }
    kitap.sayfalar.push(sayfa);
  }
  return kitap;
}
/** "2026-09-19" / "2026-09-19T08:30:00" → Excel seri sayısı */
function tarihMetinSeri(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || ''));
  if (!m) return null;
  const gun = XL.tarihSeri(+m[1], +m[2], +m[3]);
  const sn = (+(m[4] || 0)) * 3600 + (+(m[5] || 0)) * 60 + (+(m[6] || 0));
  return gun + sn / 86400;
}

// ---------------------------------------------------------------------------------
// SpreadsheetML 2003 (Excel'in XML'i — "XML Elektronik Tablosu 2003")
// ---------------------------------------------------------------------------------
/*
 * Satır ve hücre sırası ÖRTÜKTÜR: <Cell> bir sonraki sütuna yazar, ss:Index verilmişse
 * oraya atlar. Bu atlama okunmazsa boş hücreler kayar ve bütün tablo bir sütun sola gelir.
 */
const SS_NS = 'urn:schemas-microsoft-com:office:spreadsheet';
function okuXml2003(text) {
  if (typeof DOMParser !== 'function') throw new Error('DOMParser yok');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML çözümlenemedi');
  const kitap = yeniKitap('xml2003');
  const oz = (el, ad) => el.getAttributeNS(SS_NS, ad) ?? el.getAttribute('ss:' + ad) ?? el.getAttribute(ad);
  const ws = [...doc.getElementsByTagNameNS(SS_NS, 'Worksheet')];
  const liste = ws.length ? ws : [...doc.getElementsByTagName('Worksheet')];
  for (const w of liste) {
    const sayfa = yeniSayfa(oz(w, 'Name') || '');
    let r = 0;
    for (const row of w.getElementsByTagName('Row')) {
      const ri = oz(row, 'Index'); if (ri) r = +ri - 1;
      let c = 0;
      for (const cell of row.getElementsByTagName('Cell')) {
        const ci = oz(cell, 'Index'); if (ci) c = +ci - 1;
        const d = cell.getElementsByTagName('Data')[0] || cell.getElementsByTagNameNS(SS_NS, 'Data')[0];
        const tur = d ? oz(d, 'Type') : null;
        const ham = d ? d.textContent : '';
        let v = null;
        if (tur === 'Number') v = Number(ham);
        else if (tur === 'Boolean') v = ham === '1' || /^true$/i.test(ham);
        else if (tur === 'DateTime') v = tarihMetinSeri(ham);
        else if (tur === 'Error') v = XL.hataAl(ham);
        else if (ham !== '') v = ham;
        let f = oz(cell, 'Formula');
        if (f) f = r1c1(String(f), r, c);
        const birlesikR = +(oz(cell, 'MergeDown') || 0), birlesikC = +(oz(cell, 'MergeAcross') || 0);
        if (birlesikR || birlesikC) sayfa.birlesim.push(`${sutunAd(c)}${r + 1}:${sutunAd(c + birlesikC)}${r + 1 + birlesikR}`);
        if (v !== null || f) koy(sayfa, r, c, hucre(v, f, null));
        c += 1 + birlesikC;
      }
      r++;
    }
    kitap.sayfalar.push(sayfa);
  }
  return kitap;
}
/** SpreadsheetML formülleri R1C1 yazımındadır: "=RC[-1]*2" → "=B3*2" */
function r1c1(src, r, c) {
  return src.replace(/^=/, '').replace(/R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?/g, (tam, rp, cp) => {
    const coz = (p, taban) => {
      if (p == null) return { i: taban, mutlak: false };
      if (p[0] === '[') return { i: taban + +p.slice(1, -1), mutlak: false };
      return { i: +p - 1, mutlak: true };
    };
    const rr = coz(rp, r), cc = coz(cp, c);
    if (rr.i < 0 || cc.i < 0) return '#REF!';
    return (cc.mutlak ? '$' : '') + sutunAd(cc.i) + (rr.mutlak ? '$' : '') + (rr.i + 1);
  });
}

// ---------------------------------------------------------------------------------
// HTML tablosu (".xls" adıyla kaydedilmiş kurumsal çıktı)
// ---------------------------------------------------------------------------------
/*
 * Kurum yazılımlarının çoğu "Excel'e aktar" düğmesine bir HTML tablosu bağlar ve dosyayı
 * .xls diye kaydeder. Excel bunu açar (uzantıya değil içeriğe bakar), uzantıya bakan bir
 * okuyucu açamaz. Burada rowspan / colspan açılır ki hücreler kaymasın.
 */
function okuHtml(text) {
  if (typeof DOMParser !== 'function') throw new Error('DOMParser yok');
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const kitap = yeniKitap('html');
  const tablolar = [...doc.querySelectorAll('table')].filter(t => !t.querySelector('table'));
  if (!tablolar.length) throw new Error('tablo yok');
  tablolar.forEach((tbl, i) => {
    const bant = tbl.getAttribute('data-sheet-name') || (tbl.caption && tbl.caption.textContent.trim());
    const sayfa = yeniSayfa(bant || (tablolar.length > 1 ? 'Tablo ' + (i + 1) : 'Sayfa1'));
    const dolu = new Set();
    let r = 0;
    for (const tr of tbl.rows) {
      let c = 0;
      for (const td of tr.cells) {
        while (dolu.has(r + ':' + c)) c++;
        const rs = Math.min(td.rowSpan || 1, 4096), cs = Math.min(td.colSpan || 1, 1024);
        const ham = (td.textContent || '').replace(/\s+/g, ' ').trim();
        const v = ham === '' ? null : (sayiMi(ham) ?? ham);
        if (v !== null) koy(sayfa, r, c, hucre(v, null, null));
        if (rs > 1 || cs > 1) {
          sayfa.birlesim.push(`${sutunAd(c)}${r + 1}:${sutunAd(c + cs - 1)}${r + rs}`);
          for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) if (a || b) dolu.add((r + a) + ':' + (c + b));
        }
        c += cs;
      }
      r++;
    }
    kitap.sayfalar.push(sayfa);
  });
  return kitap;
}
/*
 * "1.234,56" mi "1,234.56" mı — ve asıl önemlisi, HANGİSİ SAYI DEĞİL?
 *
 * Kural üç adımdır:
 *   1. İki ayraç türü de varsa (nokta ve virgül) SONUNCUSU ondalıktır, öteki binliktir.
 *   2. Tek tür ayraç birden çok kez geçiyorsa o binliktir; o zaman ilkten sonraki her
 *      öbek TAM ÜÇ hane olmalıdır — değilse bu bir sayı değil, METİNDİR.
 *   3. Tek tür ayraç bir kez geçiyorsa: sonrasında tam üç hane varsa ve sayı üç haneden
 *      uzunsa binliktir ("1.234" → 1234), değilse ondalıktır ("1,5" → 1,5).
 *
 * İkinci adım kritiktir: ÇŞB poz numarası "15.140.1001" üç öbektir ve sonuncusu dört
 * hanedir. Kural olmadan bu 15140,1001 diye bir sayıya dönüşür ve keşif cetvelindeki poz
 * sütunu bozulur — sahada en çok karşılaşılan hata budur.
 */
export function sayiMi(s) {
  const t = String(s).trim().replace(/[\s\u00A0]/g, '');
  if (!t || !/^[-+(]?[\d.,]*\d[\d.,]*%?\)?$/.test(t)) return null;
  const eksi = /^\(.*\)$/.test(t) || t[0] === '-';
  const yuzde = t.endsWith('%');
  const g = t.replace(/^[-+(]+/, '').replace(/[)%]+$/g, '');
  if (!g) return null;
  const nokta = (g.match(/\./g) || []).length, virgul = (g.match(/,/g) || []).length;
  let ondIdx = -1, binlik = null;
  if (nokta && virgul) {
    if (nokta > 1 && virgul > 1) return null;
    ondIdx = Math.max(g.lastIndexOf('.'), g.lastIndexOf(','));
    binlik = g[ondIdx] === '.' ? ',' : '.';
    if ((g[ondIdx] === '.' ? nokta : virgul) > 1) return null;         // ondalık ayracı iki kez olamaz
  } else if (nokta + virgul > 1) {
    binlik = nokta ? '.' : ',';                                        // hepsi binlik
  } else if (nokta + virgul === 1) {
    const p = Math.max(g.lastIndexOf('.'), g.lastIndexOf(','));
    const kuyruk = g.length - p - 1;
    if (kuyruk === 3 && g.replace(/[.,]/g, '').length > 3) binlik = g[p]; else ondIdx = p;
  }
  const tam = ondIdx < 0 ? g : g.slice(0, ondIdx);
  const kesir = ondIdx < 0 ? '' : g.slice(ondIdx + 1);
  if (/[.,]/.test(kesir)) return null;
  if (binlik) {
    const obek = tam.split(binlik);
    if (obek.length > 1 && (obek[0].length < 1 || obek[0].length > 3 || obek.slice(1).some(x => x.length !== 3))) return null;
    if (obek.some(x => !/^\d*$/.test(x))) return null;
  } else if (!/^\d*$/.test(tam)) return null;
  const n = Number(tam.replace(/[.,]/g, '') + (kesir ? '.' + kesir : ''));
  if (!isFinite(n) || (tam.replace(/[.,]/g, '') === '' && kesir === '')) return null;
  return (eksi ? -n : n) / (yuzde ? 100 : 1);
}

// ---------------------------------------------------------------------------------
// CSV / ayraçlı metin
// ---------------------------------------------------------------------------------
/*
 * Ayraç sayılmaz, SEÇİLİR: ilk satırlarda tırnak dışında en çok geçen aday kazanır.
 * Türkiye'de Excel ondalık virgül kullandığı için CSV ayracı noktalı virgüldür; İngilizce
 * yerelde virgüldür. Tek bir varsayım ikisinden birini bozardı.
 */
export function csvAyrac(text) {
  const satirlar = text.split(/\r?\n/).slice(0, 20);
  const aday = [';', ',', '\t', '|'];
  const say = aday.map(a => 0);
  for (const s of satirlar) {
    let tirnak = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { tirnak = !tirnak; continue; }
      if (tirnak) continue;
      const k = aday.indexOf(c); if (k >= 0) say[k]++;
    }
  }
  let en = 0; for (let i = 1; i < aday.length; i++) if (say[i] > say[en]) en = i;
  return say[en] ? aday[en] : ';';
}
export function csvSatirlar(text, ayrac) {
  const a = ayrac || csvAyrac(text);
  const satirlar = []; let sat = [], alan = '', tirnak = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (tirnak) {
      if (c === '"') { if (text[i + 1] === '"') { alan += '"'; i++; } else tirnak = false; }
      else alan += c;
      continue;
    }
    if (c === '"') { tirnak = true; continue; }
    if (c === a) { sat.push(alan); alan = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { sat.push(alan); satirlar.push(sat); sat = []; alan = ''; continue; }
    alan += c;
  }
  if (alan !== '' || sat.length) { sat.push(alan); satirlar.push(sat); }
  return satirlar;
}
function okuCsv(text) {
  const kitap = yeniKitap('csv');
  const ayrac = csvAyrac(text);
  const sayfa = yeniSayfa('Sayfa1');
  const satirlar = csvSatirlar(text, ayrac);
  satirlar.forEach((sat, r) => sat.forEach((x, c) => {
    const s = x.trim();
    if (s === '') return;
    if (s[0] === '=') { koy(sayfa, r, c, hucre(null, s.slice(1), null)); return; }
    const n = sayiMi(s);
    koy(sayfa, r, c, hucre(n === null ? x : n, null, null));
  }));
  kitap.sayfalar.push(sayfa);
  kitap.ayrac = ayrac;
  return kitap;
}

// ---------------------------------------------------------------------------------
// Giriş kapısı
// ---------------------------------------------------------------------------------
/*
 * kaynak: { arc } (zaten açılmış arşiv) ya da { bytes } (ham dosya) ya da ikisi.
 * Arşiv varsa ZIP tabanlı biçimler ondan okunur; yoksa baytlardan tanınır.
 */
export async function kitapOku(kaynak, opts = {}) {
  const tt = opts.tt || ((k, tr) => tr);
  const { arc } = kaynak;
  if (arc) {
    const b = zipBicimi(arc.entries);
    if (b === 'xlsx') return okuXlsx(arc);
    if (b === 'ods') return okuOds(arc);
    if (b === 'xlsb') { const { okuXlsb } = await import('./xlsb.js'); return okuXlsb(arc, { YERLESIK, tt }); }
  }
  const bytes = kaynak.bytes;
  if (!bytes) throw new Error(tt('xlNoData', 'Excel verisi yok'));
  const u = u8of(bytes);
  const tur = tani(u, kaynak.ad || '');
  if (tur === 'ole') {
    const { okuXls } = await import('./xls.js');
    return okuXls(u, { tt });
  }
  if (tur === 'xml2003') return okuXml2003(metinCoz(u));
  if (tur === 'html') return okuHtml(metinCoz(u));
  if (tur === 'csv') return okuCsv(metinCoz(u));
  const e = new Error(tt('xlUnknown', 'Excel dosyası tanınmadı')); e.bicim = tur; throw e;
}
/** UTF-8 / UTF-16 damgası ve windows-1254 yedeği ile metne çevirir */
export function metinCoz(u8) {
  const u = u8of(u8);
  if (u[0] === 0xFF && u[1] === 0xFE) return dec(u.subarray(2), 'utf-16le');
  if (u[0] === 0xFE && u[1] === 0xFF) return dec(u.subarray(2), 'utf-16be');
  if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return dec(u.subarray(3));
  // UTF-8 olarak çözülemeyen bayt varsa dosya büyük olasılıkla windows-1254'tür (kurum çıktıları)
  const utf = dec(u);
  if (!utf.includes('�')) return utf;
  try { return new TextDecoder('windows-1254').decode(u); } catch (_) { return utf; }
}

// ---------------------------------------------------------------------------------
// Hesap ve görünüm
// ---------------------------------------------------------------------------------
/*
 * Kitabı "basılabilir sayfalar"a çevirir. Her sayfa için:
 *   cells   : metin[][]           — ekranda ve ızgara düzenleyicisinde görünen
 *   ham     : değer[][]           — sayı / metin / mantık / hata (dışa aktarım ve hizalama)
 *   hiza    : string[]            — satır başına bir dizge, sütun başına bir karakter (l / r / c)
 *   renk    : Map('r:c' → '#rgb') — biçim kodunun verdiği renk (yalnız varsa; seyrek)
 * Bellek: 60 bin satırlık bir sayfada hücre başına nesne tutmak yüzlerce MB eder; bu yüzden
 * hiza dizge, renk seyrek harita olarak saklanır.
 */
export function hazirla(kitap, opts = {}) {
  const ayar = opts.ayar || undefined;
  const simdi = opts.simdi || (() => anlikSeri(kitap.tarih1904));
  const rastgele = opts.rastgele || Math.random;
  const indeks = new Map(kitap.sayfalar.map((s, i) => [s.ad.toUpperCase(), i]));
  const bellek = new Map();        // 'sayfa!r:c' → hesaplanmış değer
  const zincir = new Set();        // döngü yakalama
  const uyari = kitap.uyarilar;

  const sayfaBul = (ad) => (ad == null ? null : kitap.sayfalar[indeks.get(String(ad).toUpperCase())] || null);

  let aktif = { s: kitap.sayfalar[0] || yeniSayfa(''), ad: (kitap.sayfalar[0] || {}).ad || '' };

  function deger(sayfaAd, r, c) {
    const s = sayfaAd == null ? aktif.s : sayfaBul(sayfaAd);
    if (!s) return XL.ERR.REF;
    const anahtar = s.ad + '!' + r + ':' + c;
    if (bellek.has(anahtar)) return bellek.get(anahtar);
    const h = (s.h[r] || [])[c];
    if (!h) return null;
    if (!h.f) { bellek.set(anahtar, h.v); return h.v; }
    if (h.v !== null && h.v !== undefined) { bellek.set(anahtar, h.v); return h.v; }   // dosyadaki önbellekli sonuç
    if (zincir.has(anahtar)) { if (uyari.length < 20) uyari.push('Döngüsel başvuru: ' + s.ad + '!' + sutunAd(c) + (r + 1)); bellek.set(anahtar, 0); return 0; }
    zincir.add(anahtar);
    const onceki = aktif;
    aktif = { s, ad: s.ad };
    let v;
    try { v = XL.hesapla(h.f, ctxFor(s, r, c)); } catch (e) { v = XL.ERR.VALUE; }
    aktif = onceki;
    zincir.delete(anahtar);
    if (Array.isArray(v)) v = Array.isArray(v[0]) ? v[0][0] : v[0];   // dizi sonucu: sol üst hücre (taşma yok)
    bellek.set(anahtar, v === undefined ? null : v);
    return bellek.get(anahtar);
  }
  function ctxFor(s, r, c) {
    return {
      sayfa: s.ad,
      hucre: { r, c },
      oku: (sh, rr, cc) => deger(sh == null ? s.ad : sh, rr, cc),
      boyut: (sh) => { const x = sayfaBul(sh == null ? s.ad : sh); return x ? { r: x.satir, c: x.sutun } : { r: 0, c: 0 }; },
      ad: (isim) => adCoz(isim, s.ad),
      simdi, rastgele,
    };
  }
  /** Tanımlı ad → başvuru nesnesi (xlfn'in beklediği şekil) ya da değer */
  function adCoz(isim, varsayilanSayfa) {
    const ham = kitap.adlar.get(String(isim).toUpperCase());
    if (ham == null) return undefined;
    const m = /^(?:'([^']+)'|([A-Za-z0-9_ ]+))?!?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(String(ham).replace(/^=/, ''));
    if (m && (m[3] || m[5])) {
      const sh = m[1] || m[2] || varsayilanSayfa;
      const r1 = +m[4] - 1, c1 = sutunNo(m[3]);
      const r2 = m[6] ? +m[6] - 1 : r1, c2 = m[5] ? sutunNo(m[5]) : c1;
      return { sayfa: sh, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
    }
    const n = Number(ham);
    return isFinite(n) && String(ham).trim() !== '' ? n : String(ham);
  }

  /*
   * Sayfa GEREKTİĞİNDE hesaplanır. Bir çalışma kitabında yirmi sayfa olabilir; kullanıcı
   * bir tanesine bakarken hepsini hesaplamak, açılışı sayfa sayısı kadar yavaşlatır.
   * Sonuç ilk erişimde bir kez üretilir ve saklanır; sekmeye ikinci dönüşte iş yoktur.
   */
  const sayfalar = kitap.sayfalar.map((s) => {
    let hesap = null;
    const coz = () => {
      if (hesap) return hesap;
      const onceki = aktif;
      aktif = { s, ad: s.ad };
      const cells = [], ham = [], hiza = [], renk = new Map();
      for (let r = 0; r < s.satir; r++) {
        const cs = [], hs = []; let hz = '';
        const sat = s.h[r] || [];
        for (let c = 0; c < s.sutun; c++) {
          const h = sat[c];
          if (!h) { cs.push(''); hs.push(null); hz += 'l'; continue; }
          const v = deger(s.ad, r, c);
          const b = bicimle(v, h.b, ayar);
          cs.push(b.metin); hs.push(v); hz += b.hiza;
          if (b.renk) renk.set(r + ':' + c, b.renk);
        }
        cells.push(cs); ham.push(hs); hiza.push(hz);
      }
      aktif = onceki;
      hesap = { cells, ham, hiza, renk };
      return hesap;
    };
    return {
      ad: s.ad, birlesim: s.birlesim, satir: s.satir, sutun: s.sutun,
      get cells() { return coz().cells; },
      get ham() { return coz().ham; },
      get hiza() { return coz().hiza; },
      get renk() { return coz().renk; },
    };
  });
  return { bicim: kitap.bicim, sayfalar, uyarilar: uyari, tarih1904: kitap.tarih1904 };
}
/** Şimdiki zamanın Excel seri sayısı (yerel saat; NOW / TODAY buradan besleniyor) */
export function anlikSeri(tarih1904 = false) {
  const d = new Date();
  const gun = XL.tarihSeri(d.getFullYear(), d.getMonth() + 1, d.getDate()) - (tarih1904 ? 1462 : 0);
  return gun + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}
/** Bir biçim kodu tarih gösteriyor mu (yerleşik numaradan da anlaşılır) */
export const tarihKodu = (kod, id) => (id != null && TARIH_ID.has(+id)) || (kod ? /(^|[^\\"])[dmyhs]/i.test(String(kod)) : false);
