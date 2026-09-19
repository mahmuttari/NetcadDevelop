/*
 * EXCEL FORMÜL MOTORU — ÇEKİRDEK (saf modül: DOM, dosya, ağ, takvim bilmez).
 *
 * NEDEN GEREKLİ. Bir xlsx dosyasında her formül hücresi iki şey taşır: formülün kendisi (<f>)
 * ve son hesaplandığında bulunan değer (<v>). v7.88'e kadar yalnız <v> okunuyordu. Bu, dosyayı
 * en son Excel kaydettiyse çalışır; ama LibreOffice'in bazı sürümleri, openpyxl / xlsxwriter
 * gibi kütüphaneler ve kurum yazılımlarının ürettiği dosyalar <v> YAZMAZ — o zaman tablo
 * bomboş görünür. Motor bu boşluğu kapatır: değer yoksa formül hesaplanır.
 *
 * DEĞER SÖZLEŞMESİ (bütün işlevler bu beş türle konuşur):
 *   sayı    → number            mantık → true / false
 *   metin   → string            boş    → null            (boş hücre; 0 ile aynı değildir)
 *   hata    → { e: '#DIV/0!' }  dizi   → [[...], [...]]   (2 boyutlu, satır öncelikli)
 * Tarih ayrı bir tür DEĞİLDİR: Excel'de tarih bir seri sayıdır (1900 dizgesi, 1899-12-30 sıfır
 * noktası). Görünüşü sayı biçimi verir (xlfmt.js), değeri değil.
 *
 * İŞLEV KAYDI. Kategori dosyaları (xlfn_math.js, xlfn_text.js …) buraya `kaydet()` ile girer;
 * çekirdek hiçbir işlevin adını bilmez. Böylece kategoriler birbirinden ve çekirdekten bağımsız
 * yazılıp ayrı ayrı sınanabilir.
 */

// ---------------------------------------------------------------------------------
// Hata değerleri
// ---------------------------------------------------------------------------------
export const ERR = {
  NULL: { e: '#NULL!' }, DIV0: { e: '#DIV/0!' }, VALUE: { e: '#VALUE!' }, REF: { e: '#REF!' },
  NAME: { e: '#NAME?' }, NUM: { e: '#NUM!' }, NA: { e: '#N/A' }, GETDATA: { e: '#GETTING_DATA' },
  CALC: { e: '#CALC!' }, SPILL: { e: '#SPILL!' },
};
const ERR_ADI = new Map(Object.values(ERR).map(v => [v.e, v]));
export const hata = (v) => !!(v && typeof v === 'object' && !Array.isArray(v) && typeof v.e === 'string');
export const hataAl = (kod) => ERR_ADI.get(kod) || { e: kod };
/** Argümanlardan İLK hatayı döndürür (Excel kuralı: hata yayılır, ilk hata kazanır) */
export function ilkHata(...a) {
  for (const v of a) {
    if (hata(v)) return v;
    if (Array.isArray(v)) { const h = ilkHata(...v.flat()); if (h) return h; }
  }
  return null;
}

// ---------------------------------------------------------------------------------
// Tür çevirimi — Excel'in kendi kuralları
// ---------------------------------------------------------------------------------
/** Metni sayıya çevirir (Excel'in gevşek kuralı: yüzde, para birimi yok; boşluk kırpılır) */
export function metinSayi(s) {
  const x = String(s).trim();
  if (x === '') return NaN;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(x)) return Number(x);
  if (/^[+-]?(\d+\.?\d*|\.\d+)%$/.test(x)) return Number(x.slice(0, -1)) / 100;
  return NaN;
}
/** Sayıya zorlar. Boş = 0, mantık = 0/1, çevrilemeyen metin = #VALUE! */
export function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : ERR.NUM;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (hata(v)) return v;
  if (Array.isArray(v)) return num(ilkSkaler(v));
  const n = metinSayi(v);
  return isNaN(n) ? ERR.VALUE : n;
}
/** Metne zorlar. Boş = "", mantık = DOĞRU/YANLIŞ değil TRUE/FALSE (Excel iç gösterimi) */
export function str(v) {
  if (v == null) return '';
  if (hata(v)) return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return sayiMetin(v);
  if (Array.isArray(v)) return str(ilkSkaler(v));
  return String(v);
}
/** Mantığa zorlar. Boş = YANLIŞ, 0 = YANLIŞ, "TRUE"/"FALSE" tanınır, başka metin #VALUE! */
export function bool(v) {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (hata(v)) return v;
  if (Array.isArray(v)) return bool(ilkSkaler(v));
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  const n = metinSayi(s);
  return isNaN(n) ? ERR.VALUE : n !== 0;
}
/** Sayının Excel'deki varsayılan metin karşılığı: en çok 15 anlamlı hane, üstel eşik 1e11 / 1e-5 */
export function sayiMetin(n) {
  if (!isFinite(n)) return n > 0 ? '#NUM!' : '#NUM!';
  if (n === 0) return '0';
  const m = Math.abs(n);
  if (m >= 1e11 || m < 1e-4) {
    let s = n.toExponential(Math.min(14, 14));
    s = s.replace(/\.?0+e/, 'E').replace(/e/, 'E').replace(/E([+-])(\d)$/, 'E$10$2');
    return s;
  }
  const s = String(Number(n.toPrecision(15)));
  return s.includes('e') ? String(n) : s;
}
const ilkSkaler = (a) => { const f = a.flat(); return f.length ? f[0] : null; };
/** 2 boyutlu diziye çevirir (skaler → [[v]]) */
export const mat = (v) => (Array.isArray(v) ? (Array.isArray(v[0]) ? v : [v]) : [[v]]);
/** Dizileri tek düze listeye açar (SUM, COUNT … aileleri böyle çalışır) */
export function duzle(args) {
  const o = [];
  const it = (v) => { if (Array.isArray(v)) v.forEach(it); else o.push(v); };
  args.forEach(it);
  return o;
}
/** Toplama ailesinin sayı süzgeci: metin ve mantık ATLANIR (doğrudan argüman değilse) */
export function sayilar(args, { metin = false, mantik = false } = {}) {
  const o = [];
  for (const v of duzle(args)) {
    if (v == null) continue;
    if (typeof v === 'number') { o.push(v); continue; }
    if (typeof v === 'boolean') { if (mantik) o.push(v ? 1 : 0); continue; }
    if (hata(v)) return v;
    if (metin) { const n = metinSayi(v); o.push(isNaN(n) ? 0 : n); }
  }
  return o;
}

// ---------------------------------------------------------------------------------
// Karşılaştırma — Excel sıralaması: sayı < metin < YANLIŞ < DOĞRU; metin büyük/küçük harf duymaz
// ---------------------------------------------------------------------------------
const tur = (v) => (v == null ? 0 : typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
export function karsilastir(a, b) {
  if (a == null && b == null) return 0;
  const ta = tur(a), tb = tur(b);
  if (ta !== tb) {
    // Boş hücre karşı türün "sıfırı" gibi davranır: boş = 0, boş = "" doğrudur.
    if (a == null) return tb === 0 ? (0 < b ? -1 : 0 > b ? 1 : 0) : tb === 1 ? (b === '' ? 0 : -1) : (b ? -1 : 0);
    if (b == null) return -karsilastir(b, a);
    return ta < tb ? -1 : 1;
  }
  if (ta === 0) { const x = a == null ? 0 : a, y = b == null ? 0 : b; return x < y ? -1 : x > y ? 1 : 0; }
  if (ta === 1) { const x = String(a).toUpperCase(), y = String(b).toUpperCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return (a ? 1 : 0) - (b ? 1 : 0);
}

// ---------------------------------------------------------------------------------
// Ölçüt (COUNTIF / SUMIF / AVERAGEIF … ortak dili): ">=5", "elma", "*ma", "<>"
// ---------------------------------------------------------------------------------
export function olcut(k) {
  let op = '=', s = k;
  if (typeof k === 'string') {
    const m = /^(<=|>=|<>|<|>|=)/.exec(k);
    if (m) { op = m[1]; s = k.slice(m[1].length); }
  } else if (hata(k)) return () => false;
  const sn = typeof s === 'string' ? metinSayi(s) : NaN;
  const sayisal = typeof s === 'number' ? s : (isNaN(sn) ? null : sn);
  const joker = typeof s === 'string' && /[*?~]/.test(s);
  const re = joker ? jokerRe(s) : null;
  return (v) => {
    if (op === '=' || op === '<>') {
      let e;
      if (re) e = typeof v === 'string' && re.test(v);
      else if (sayisal != null) e = typeof v === 'number' ? v === sayisal : (v == null ? sayisal === 0 : karsilastir(v, sayisal) === 0);
      else if (s === '' || s == null) e = v == null || v === '';
      else e = karsilastir(v, typeof s === 'string' ? s : s) === 0;
      return op === '=' ? e : !e;
    }
    const hedef = sayisal != null ? sayisal : s;
    if (v == null) return false;
    /*
     * KARŞILAŞTIRMA ÖLÇÜTÜ TÜRÜ AŞMAZ. Excel'in genel sıralamasında metin sayıdan büyüktür
     * (karsilastir bunu doğru yapar), ama COUNTIF(aralık;">5") bir metin hücresini SAYMAZ:
     * sayısal ölçüt yalnız sayılarla, metin ölçüt yalnız metinlerle karşılaştırılır. Bu ayrım
     * olmadan içinde bir tek metin bulunan her sütunda ">0" sayımı şişer.
     */
    if (typeof hedef === 'number' && typeof v !== 'number') return false;
    if (typeof hedef === 'string' && typeof v !== 'string') return false;
    const c = karsilastir(v, hedef);
    return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
  };
}
/** Excel joker dili: * her şey, ? tek karakter, ~ kaçış */
export function jokerRe(s, bayrak = 'i') {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '~') { const n = s[++i]; o += n == null ? '~' : n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else if (c === '*') o += '[\\s\\S]*';
    else if (c === '?') o += '[\\s\\S]';
    else o += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + o + '$', bayrak);
}

// ---------------------------------------------------------------------------------
// Tarih — Excel seri sayısı (1900 dizgesi). 1900 artık yıl HATASI korunur: 60 = 1900-02-29.
// ---------------------------------------------------------------------------------
const GUN = 86400000;
export function seriTarih(n) {
  const g = Math.floor(n);
  const ms = Date.UTC(1899, 11, 30) + (g > 59 ? g : g + 1) * GUN;
  const d = new Date(ms + Math.round((n - g) * GUN));
  return d;
}
export function tarihSeri(y, ay, gun) {
  // Excel ay/gün taşmasını kabul eder: DATE(2026;14;1) = 2027-02-01
  const t = Date.UTC(y < 1900 && y >= 0 ? y + 1900 : y, ay - 1, gun);
  if (!isFinite(t)) return ERR.NUM;
  const n = Math.round((t - Date.UTC(1899, 11, 30)) / GUN);
  return n > 59 ? n : n - 1;
}
export const seriParca = (n) => { const d = seriTarih(n); return { y: d.getUTCFullYear(), ay: d.getUTCMonth() + 1, gun: d.getUTCDate(), hafta: d.getUTCDay() }; };
export const seriSaat = (n) => { const f = n - Math.floor(n); const s = Math.round(f * 86400); return { sa: Math.floor(s / 3600) % 24, dk: Math.floor(s / 60) % 60, sn: s % 60 }; };

// ---------------------------------------------------------------------------------
// Sözcükleyici
// ---------------------------------------------------------------------------------
const HATA_RE = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!)/i;
const A1_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w.])/;
const SUTUN_RE = /^(\$?)([A-Za-z]{1,3})(?![\w.$])/;
const SATIR_RE = /^(\$?)(\d{1,7})(?![\w.$])/;
const AD_RE = /^[A-Za-z_\\À-￿][A-Za-z0-9_.\\À-￿]*/;
export function sozcukle(src) {
  const T = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      // Boşluk KESİŞİM işlecidir (A1:B5 C1:D9) — ama yalnız iki başvuru arasında anlamlıdır.
      let j = i; while (j < n && /\s/.test(src[j])) j++;
      const onc = T[T.length - 1];
      if (onc && (onc.t === 'ref' || onc.t === ')' || onc.t === 'name')) T.push({ t: 'op', v: ' ' });
      i = j; continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      T.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (c === "'") {   // 'Sayfa adı'!A1
      let j = i + 1, s = '';
      while (j < n) { if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j += 2; continue; } break; } s += src[j++]; }
      j++;
      if (src[j] === '!') { const r = basvuruOku(src, j + 1, s); if (r) { T.push(r.tok); i = r.i; continue; } }
      T.push({ t: 'name', v: s }); i = j; continue;
    }
    if (c === '#') {
      const m = HATA_RE.exec(src.slice(i));
      if (m) { T.push({ t: 'err', v: hataAl('#' + m[1].toUpperCase().replace('N/A', 'N/A')) }); i += m[0].length; continue; }
      T.push({ t: 'err', v: ERR.NAME }); i++; continue;
    }
    if (c >= '0' && c <= '9') {
      const m = /^\d+\.?\d*([eE][+-]?\d+)?/.exec(src.slice(i));
      // 1:1 (tam satır) sayıyla başlar ama başvurudur — ':' geliyorsa başvuru okunur
      if (src[i + m[0].length] === ':' && /^\d+$/.test(m[0])) { const r = basvuruOku(src, i, null); if (r) { T.push(r.tok); i = r.i; continue; } }
      T.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (c === '.' && /\d/.test(src[i + 1] || '')) { const m = /^\.\d+([eE][+-]?\d+)?/.exec(src.slice(i)); T.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    const iki = src.slice(i, i + 2);
    if (iki === '<=' || iki === '>=' || iki === '<>') { T.push({ t: 'op', v: iki }); i += 2; continue; }
    // ';' dizi sabitinde SATIR ayracıdır ({1,2;3,4}); ',' sütun ayracı ve argüman ayracıdır.
    // xlsx içindeki formüller her zaman bu iki ayracı kullanır (yerel ayar biçimi dosyaya girmez).
    if ('+-*/^&=<>:,;%'.includes(c)) { T.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(' || c === ')' || c === '{' || c === '}') { T.push({ t: c }); i++; continue; }
    if (c === '@') { i++; continue; }   // örtük kesişim işleci (_xlfn ailesinde): tek değere indirger, yok sayılır
    const r = basvuruOku(src, i, null);
    if (r) { T.push(r.tok); i = r.i; continue; }
    const m = AD_RE.exec(src.slice(i));
    if (m) {
      let ad = m[0], j = i + m[0].length;
      if (src[j] === '!') { const rr = basvuruOku(src, j + 1, ad); if (rr) { T.push(rr.tok); i = rr.i; continue; } }
      ad = ad.replace(/^_xlfn\./i, '').replace(/^_xlws\./i, '');
      T.push({ t: src[j] === '(' ? 'fn' : 'name', v: ad }); i = j; continue;
    }
    i++;   // tanınmayan karakter atlanır (bozuk formül hepten çökmesin)
  }
  return T;
}
/** src[i] konumundan bir A1 / A1:B5 / A:A / 1:1 başvurusu okur */
function basvuruOku(src, i, sayfa) {
  const s = src.slice(i);
  const bir = (x) => {
    let m = A1_RE.exec(x);
    if (m) return { len: m[0].length, c: sutunNo(m[2]), r: +m[4] - 1, ca: !!m[1], ra: !!m[3], tam: null };
    m = SUTUN_RE.exec(x);
    if (m) return { len: m[0].length, c: sutunNo(m[2]), r: 0, ca: !!m[1], ra: false, tam: 'c' };
    m = SATIR_RE.exec(x);
    if (m) return { len: m[0].length, c: 0, r: +m[2] - 1, ca: false, ra: !!m[1], tam: 'r' };
    return null;
  };
  const a = bir(s);
  if (!a) return null;
  if (a.tam && s[a.len] !== ':') return null;   // tek başına "A" bir addır, başvuru değil
  let uzun = a.len, b = null;
  if (s[a.len] === ':') { const bb = bir(s.slice(a.len + 1)); if (bb) { b = bb; uzun = a.len + 1 + bb.len; } }
  if (a.tam && !b) return null;
  /*
   * İKİ TUZAK. (1) "LOG10(1000)" bir başvuru DEĞİL, işlev adıdır: LOG sütunu + 10. satır diye
   * okunursa işlev hiç çağrılmaz ve formül sessizce bir hücreye bakar. (2) "S2!A1" içindeki S2
   * bir hücre değil, SAYFA adıdır; başvuru diye okunursa ardından gelen '!' tanınmaz, atlanır ve
   * formül yine sessizce yanlış hücreye bakar. Excel her iki yazımı da dosyaya böyle yazar.
   * Her ikisi de bir sonraki karakterden anlaşılır; okuma geri alınır, ad yoluna bırakılır.
   */
  const sonra = src[i + uzun];
  if (sonra === '(' || sonra === '!') return null;
  return { tok: { t: 'ref', v: { sayfa, a, b } }, i: i + uzun };
}
export function sutunNo(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
export function sutunAd(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

// ---------------------------------------------------------------------------------
// Ayrıştırıcı — öncelik: : (boşluk) , < % < ^ < * / < + - < & < karşılaştırma
// ---------------------------------------------------------------------------------
const ONCELIK = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5, ',': 6, ' ': 7, ':': 8 };
export function ayristir(src) {
  const T = sozcukle(String(src).replace(/^\s*=/, ''));
  let p = 0;
  const bak = () => T[p], al = () => T[p++];
  /*
   * ',' iki ayrı şeydir: işlev argümanlarını ayırır VE parantez içinde BİRLEŞİM işlecidir
   * (AREAS((A1:A3,C1:C3)) = 2). Ayrım bağlamdan gelir: argüman listesi ayrıştırılırken birleşim
   * kapalıdır, parantez grubunda açıktır. Kapalı olmasaydı SUM(1,2,3) tek bir birleşim düğümü
   * olur ve işlev tek argüman görürdü.
   */
  function birim(bir) {
    const tk = al();
    if (!tk) return { t: 'err', v: ERR.NAME };
    if (tk.t === 'num' || tk.t === 'str' || tk.t === 'err') return { t: tk.t, v: tk.v };
    if (tk.t === 'ref') return { t: 'ref', v: tk.v };
    if (tk.t === 'name') {
      const u = String(tk.v).toUpperCase();
      if (u === 'TRUE') return { t: 'bool', v: true };
      if (u === 'FALSE') return { t: 'bool', v: false };
      return { t: 'name', v: tk.v };
    }
    if (tk.t === 'fn') {
      al();   // '('
      const args = [];
      if (bak() && bak().t !== ')') {
        for (;;) {
          const s2 = bak();
          if (!s2) break;
          if (s2.t === ')') { args.push({ t: 'bos' }); break; }
          if (s2.t === 'op' && s2.v === ',') { args.push({ t: 'bos' }); al(); continue; }
          args.push(ifade(0, false));
          const q = bak();
          if (q && q.t === 'op' && q.v === ',') { al(); if (bak() && bak().t === ')') { args.push({ t: 'bos' }); break; } continue; }
          break;
        }
      }
      if (bak() && bak().t === ')') al();
      return { t: 'fn', ad: String(tk.v).toUpperCase(), args };
    }
    if (tk.t === '(') { const e = ifade(0, true); if (bak() && bak().t === ')') al(); return { t: 'par', v: e }; }
    if (tk.t === '{') {
      const satirlar = []; let sat = [];
      for (;;) {
        const s2 = bak();
        if (!s2) break;
        if (s2.t === '}') { al(); break; }
        sat.push(ifade(0, false));
        const q = bak();
        if (q && q.t === 'op' && q.v === ',') { al(); continue; }
        if (q && q.t === 'op' && q.v === ';') { al(); satirlar.push(sat); sat = []; continue; }
        if (q && q.t === '}') { al(); break; }
        break;
      }
      if (sat.length) satirlar.push(sat);
      return { t: 'dizi', v: satirlar };
    }
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) return { t: 'tek', op: tk.v, v: birimSonek(bir) };
    return { t: 'err', v: ERR.NAME };
  }
  function birimSonek(bir) {
    let e = birim(bir);
    for (;;) { const s2 = bak(); if (s2 && s2.t === 'op' && s2.v === '%') { al(); e = { t: 'yuzde', v: e }; } else break; }
    return e;
  }
  function ifade(min, bir) {
    let sol = birimSonek(bir);
    for (;;) {
      const s2 = bak();
      if (!s2 || s2.t !== 'op') break;
      const o = s2.v;
      if (o === ';' || o === '%') break;
      if (o === ',' && !bir) break;
      const pr = ONCELIK[o];
      if (pr == null || pr < min) break;
      al();
      const sag = ifade(o === '^' ? pr : pr + 1, bir);
      sol = o === ',' ? { t: 'birlesim', l: sol, r: sag } : { t: 'iki', op: o, l: sol, r: sag };
    }
    return sol;
  }
  return ifade(0, false);
}

// ---------------------------------------------------------------------------------
// İşlev kaydı
// ---------------------------------------------------------------------------------
/*
 * Bir işlev şöyle kaydedilir:
 *   kaydet('SUM', { en: 1, ek: 255, fn: (a) => … })
 *     en / ek : en az / en çok argüman (ek yoksa en ile aynı; -1 sınırsız)
 *     ham     : true ise argümanlar DEĞERLENDİRİLMEDEN AST olarak gelir (IF, IFERROR, CHOOSE…)
 *     bas     : değerlendirilmeden BAŞVURU olarak istenen argüman sıraları (ROW, OFFSET, INDEX…)
 *     dizi    : true ise dizi argümanı tek değere indirgenmez (SUMPRODUCT, MMULT…)
 *     hatasiz : true ise argümanlardaki hata yayılmaz, işleve olduğu gibi verilir (ISERROR…)
 */
export const FN = new Map();
export function kaydet(ad, tanim) { FN.set(String(ad).toUpperCase(), { en: 0, ek: null, ...tanim }); }
export function kaydetHepsi(obj) { for (const k of Object.keys(obj)) kaydet(k, obj[k]); }
export const bilinen = (ad) => FN.has(String(ad).toUpperCase());

// ---------------------------------------------------------------------------------
// Değerlendirici
// ---------------------------------------------------------------------------------
/*
 * ctx (bağlam) — motorun dış dünyayla tek arayüzü. Hepsi seçimliktir; verilmeyen yetenek
 * yokmuş gibi davranır (başvuru veren yoksa her başvuru #REF! olur, çalışma kitabı gerekmez).
 *   sayfa            : geçerli sayfa adı
 *   hucre            : { r, c } geçerli hücre (ROW / COLUMN / örtük kesişim için)
 *   oku(sayfa, r, c) : tek hücre değeri
 *   boyut(sayfa)     : { r, c } sayfanın dolu alanı (tam sütun / satır başvurusunu sınırlar)
 *   ad(isim)         : tanımlı ad → başvuru nesnesi ya da değer
 *   simdi()          : şimdiki zamanın seri sayısı (NOW / TODAY — saat motorun dışından gelir)
 *   rastgele()       : 0–1 (RAND — dışarıdan gelir ki sınama yinelenebilir olsun)
 *   yineleme         : { ac, enCok, delta } döngüsel başvuru ayarı
 */
const BOS_BASVURU = { sayfa: null, r1: 0, c1: 0, r2: 0, c2: 0, yok: true };

function basvuruCoz(v, ctx) {
  const { sayfa, a, b } = v;
  const sh = sayfa == null ? (ctx.sayfa || null) : sayfa;
  const bo = ctx.boyut ? ctx.boyut(sh) : null;
  const sonR = bo ? Math.max(0, bo.r - 1) : 1048575, sonC = bo ? Math.max(0, bo.c - 1) : 16383;
  let r1 = a.r, c1 = a.c, r2 = b ? b.r : a.r, c2 = b ? b.c : a.c;
  if (a.tam === 'c' || (b && b.tam === 'c')) { r1 = 0; r2 = sonR; }
  if (a.tam === 'r' || (b && b.tam === 'r')) { c1 = 0; c2 = sonC; }
  return { sayfa: sh, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}
export function basvuruDeger(ref, ctx) {
  if (!ref || ref.yok) return ERR.REF;
  if (ref.alanlar) return ERR.VALUE;   // birleşim tek bir değer alanı değildir
  const oku = ctx.oku || (() => null);
  if (ref.r1 === ref.r2 && ref.c1 === ref.c2) return oku(ref.sayfa, ref.r1, ref.c1);
  const o = [];
  for (let r = ref.r1; r <= ref.r2; r++) { const sat = []; for (let c = ref.c1; c <= ref.c2; c++) sat.push(oku(ref.sayfa, r, c)); o.push(sat); }
  return o;
}
/** Düğümü BAŞVURU olarak çözer (çözülemiyorsa null) */
export function degerlendirBasvuru(d, ctx) {
  if (!d) return null;
  if (d.t === 'ref') return basvuruCoz(d.v, ctx);
  if (d.t === 'par') return degerlendirBasvuru(d.v, ctx);
  if (d.t === 'name' && ctx.ad) { const r = ctx.ad(d.v); if (r && typeof r === 'object' && 'r1' in r) return r; }
  if (d.t === 'iki' && d.op === ':') {
    const a = degerlendirBasvuru(d.l, ctx), b = degerlendirBasvuru(d.r, ctx);
    if (!a || !b) return null;
    return { sayfa: a.sayfa, r1: Math.min(a.r1, b.r1), c1: Math.min(a.c1, b.c1), r2: Math.max(a.r2, b.r2), c2: Math.max(a.c2, b.c2) };
  }
  if (d.t === 'iki' && d.op === ' ') {
    const a = degerlendirBasvuru(d.l, ctx), b = degerlendirBasvuru(d.r, ctx);
    if (!a || !b) return null;
    const r1 = Math.max(a.r1, b.r1), c1 = Math.max(a.c1, b.c1), r2 = Math.min(a.r2, b.r2), c2 = Math.min(a.c2, b.c2);
    return r1 > r2 || c1 > c2 ? BOS_BASVURU : { sayfa: a.sayfa, r1, c1, r2, c2 };
  }
  if (d.t === 'birlesim') {
    const a = degerlendirBasvuru(d.l, ctx), b = degerlendirBasvuru(d.r, ctx);
    if (!a || !b) return null;
    return { alanlar: (a.alanlar || [a]).concat(b.alanlar || [b]) };
  }
  if (d.t === 'fn') { const f = FN.get(d.ad); if (f && f.basDon) { const r = cagir(f, d, ctx); return r && typeof r === 'object' && ('r1' in r || 'alanlar' in r) ? r : null; } }
  return null;
}
function cagir(f, d, ctx) {
  const ham = f.ham ? d.args : null;
  const bas = new Set(f.bas || []);
  const args = ham || d.args.map((a, i) => (bas.has(i) ? (degerlendirBasvuru(a, ctx) || degerlendir(a, ctx)) : degerlendir(a, ctx)));
  const n = d.args.length;
  if (n < (f.en || 0)) return ERR.VALUE;
  if (f.ek != null && f.ek >= 0 && n > f.ek) return ERR.VALUE;
  if (!f.ham && !f.hatasiz) { const h = ilkHata(...args.filter((_, i) => !bas.has(i))); if (h) return h; }
  try { const r = f.fn(args, ctx, d); return r === undefined ? null : r; } catch (e) { return hata(e) ? e : ERR.VALUE; }
}
export function degerlendir(d, ctx) {
  if (!d) return null;
  switch (d.t) {
    case 'num': case 'str': case 'bool': case 'err': return d.v;
    case 'bos': return null;
    case 'par': return degerlendir(d.v, ctx);
    case 'yuzde': { const v = num(degerlendir(d.v, ctx)); return hata(v) ? v : v / 100; }
    case 'tek': { const v = num(degerlendir(d.v, ctx)); return hata(v) ? v : (d.op === '-' ? -v : v); }
    case 'dizi': return d.v.map(sat => sat.map(x => degerlendir(x, ctx)));
    case 'birlesim': return ERR.VALUE;   // birleşim DEĞER olarak kullanılamaz; yalnız başvuru bağlamında anlamlıdır (AREAS)
    case 'ref': return basvuruDeger(basvuruCoz(d.v, ctx), ctx);
    case 'name': {
      if (ctx.ad) {
        const r = ctx.ad(d.v);
        if (r && typeof r === 'object' && 'r1' in r) return basvuruDeger(r, ctx);
        if (r !== undefined) return r;
      }
      return ERR.NAME;
    }
    case 'fn': {
      const f = FN.get(d.ad);
      if (!f) return ERR.NAME;
      return cagir(f, d, ctx);
    }
    case 'iki': return ikili(d, ctx);
    default: return ERR.VALUE;
  }
}
/*
 * ÖRTÜK KESİŞİM YOK. Eski Excel'de =A1:A9 yazan bir hücre kendi satırıyla kesişen tek değeri
 * verirdi; dinamik dizilerle birlikte (2018) bu kural KALDIRILDI ve yerine açık '@' işleci geldi
 * (_xlfn.SINGLE). Motor da uygulamaz: bir başvuru argümanı ne ise odur, dizi ise dizidir. Aksi
 * halde SUM(A1:A3) gibi en sıradan formül, hesaplayan hücrenin satırına bakıp #VALUE! verirdi.
 */
/** İkili işleçler dizi üzerinde eleman eleman çalışır (Excel dizi yayılımı) */
function ikili(d, ctx) {
  const o = d.op;
  if (o === ':' || o === ' ') { const r = degerlendirBasvuru(d, ctx); return r ? basvuruDeger(r, ctx) : ERR.REF; }
  const l = degerlendir(d.l, ctx), r = degerlendir(d.r, ctx);
  return yay(l, r, (a, b) => tekIkili(o, a, b));
}
export function yay(l, r, f) {
  const la = Array.isArray(l), ra = Array.isArray(r);
  if (!la && !ra) return f(l, r);
  const L = mat(l), R = mat(r);
  const nr = Math.max(la ? L.length : 1, ra ? R.length : 1);
  const nc = Math.max(la ? Math.max(...L.map(x => x.length)) : 1, ra ? Math.max(...R.map(x => x.length)) : 1);
  const o = [];
  for (let i = 0; i < nr; i++) {
    const sat = [];
    for (let j = 0; j < nc; j++) {
      const a = la ? hucreAl(L, i, j) : l, b = ra ? hucreAl(R, i, j) : r;
      sat.push(f(a, b));
    }
    o.push(sat);
  }
  return o;
}
const hucreAl = (M, i, j) => {
  const sat = M.length === 1 ? M[0] : M[i];
  if (!sat) return ERR.NA;
  const v = sat.length === 1 ? sat[0] : sat[j];
  return v === undefined ? ERR.NA : v;
};
function tekIkili(o, a, b) {
  const h = ilkHata(a, b); if (h) return h;
  if (o === '&') { const x = str(a), y = str(b); return hata(x) ? x : hata(y) ? y : x + y; }
  if (o === '=' || o === '<>' || o === '<' || o === '>' || o === '<=' || o === '>=') {
    const c = karsilastir(a, b);
    return o === '=' ? c === 0 : o === '<>' ? c !== 0 : o === '<' ? c < 0 : o === '>' ? c > 0 : o === '<=' ? c <= 0 : c >= 0;
  }
  const x = num(a); if (hata(x)) return x;
  const y = num(b); if (hata(y)) return y;
  switch (o) {
    case '+': return kontrol(x + y);
    case '-': return kontrol(x - y);
    case '*': return kontrol(x * y);
    case '/': return y === 0 ? ERR.DIV0 : kontrol(x / y);
    case '^': { if (x === 0 && y < 0) return ERR.DIV0; const v = Math.pow(x, y); return isNaN(v) ? ERR.NUM : kontrol(v); }
    default: return ERR.VALUE;
  }
}
export const kontrol = (v) => (typeof v === 'number' && !isFinite(v) ? ERR.NUM : v);

/** Tek formülü hesaplar: "=SUM(A1:A3)" → değer */
export function hesapla(formul, ctx = {}) {
  try { return degerlendir(ayristir(formul), ctx); } catch (e) { return hata(e) ? e : ERR.VALUE; }
}
