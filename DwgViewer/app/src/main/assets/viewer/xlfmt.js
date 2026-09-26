/*
 * EXCEL SAYI BİÇİMİ — kod yorumlayıcısı (saf modül).
 *
 * NEDEN GEREKLİ. xlsx'te bir hücrenin DEĞERİ ile GÖRÜNÜŞÜ ayrı yerlerde durur: değer <v>'de bir
 * sayıdır, görünüşü ise styles.xml'deki biçim kodundan gelir. v7.88'e kadar biçim hiç okunmuyor,
 * her sayı altı haneye yuvarlanıp basılıyordu. Sonuç: tarihler 45923 gibi çıplak seri sayı,
 * paralar binlik ayracı ve simgesi olmadan, yüzdeler 100 kat küçük, muhasebe hizalaması yok.
 * Bir keşif özetinde ya da hakediş tablosunda bu, belgeyi okunamaz kılar.
 *
 * KAPSAM. Dört bölümlü kod (pozitif;negatif;sıfır;metin), köşeli parantez koşulları ([>=1000]),
 * renk adları, para simgesi ve yerel kod ([$₺-41F]), 0 # ? yer tutucuları, binlik ayracı ve
 * ölçekleme virgülü, yüzde, kesir (# ?/?), bilimsel (0.00E+00), kaçış (\ ve "…"), yineleme (*),
 * boşluk doldurma (_), metin yer tutucusu (@), tarih ve saat imleri, geçen süre ([h] [mm] [ss]).
 *
 * YUVARLAMA. Excel yarımı SIFIRDAN UZAĞA yuvarlar; JS'in toFixed'i ikilik gösterim yüzünden
 * 1,005'i 1,00 yapabilir. Bu yüzden yuvarlama ondalık metin üzerinden yapılır (bkz. yuvarlaMetin).
 */

// ---------------------------------------------------------------------------------
// Yerleşik biçimler (numFmtId 0-49). Dosya bunları YAZMAZ, numarayla anar.
// ---------------------------------------------------------------------------------
/*
 * 14-22 arası TARİH biçimleri YERELE GÖRE DEĞİŞİR — bu Excel'in kendi davranışıdır, bizim
 * yorumumuz değil: dosya yalnız "14" numarasını yazar, görünüşü açan bilgisayarın yereli
 * belirler. Aynı dosya İngilizce Excel'de 09-23-25, Türkçe Excel'de 23.09.2025 gösterir.
 * Uygulama Türkçe önceliklidir (ay ve gün adları da Türkçedir), bu yüzden gün-ay-yıl ve
 * nokta ayracı kullanılır. 5-8 (para) ve 41-44 (muhasebe) da yerele bağlıdır; simge ₺'dir.
 */
/*
 * 9-10 (YÜZDE) da yerele bağlıdır: Türkçe Excel yerleşik yüzdeyi "%20" diye, işareti ÖNE koyarak
 * gösterir (TDK yazımı); İngilizce Excel "20%". Uygulama arayüz dili Türkçeyken aynı dosya "KDV 20%"
 * gösteriyordu — oysa aynı ekrandaki yakınlaştırma çipi "%100" yazar. Kod arayüz dilinden okunur
 * (<html lang>); belge yokken (Node sınamaları) İngilizce biçim kalır. Getter olduğu için tabloyu
 * açarken kurulan eşlemeler (Object.entries) o anki dili alır.
 */
const trArayuz = () => { try { return typeof document !== 'undefined' && /^tr/i.test(document.documentElement.lang || ''); } catch (_) { return false; } };
export const YERLESIK = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  5: '"₺"#,##0;-"₺"#,##0', 6: '"₺"#,##0;[Red]-"₺"#,##0', 7: '"₺"#,##0.00;-"₺"#,##0.00', 8: '"₺"#,##0.00;[Red]-"₺"#,##0.00',
  get 9() { return trArayuz() ? '%0' : '0%'; }, get 10() { return trArayuz() ? '%0.00' : '0.00%'; }, 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'dd.mm.yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'dd.mm.yyyy h:mm',
  37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
  41: '_-* #,##0_-;-* #,##0_-;_-* "-"_-;_-@_-', 42: '_-"₺"* #,##0_-;-"₺"* #,##0_-;_-"₺"* "-"_-;_-@_-',
  43: '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-', 44: '_-"₺"* #,##0.00_-;-"₺"* #,##0.00_-;_-"₺"* "-"??_-;_-@_-',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};
/** Tarih sayılan yerleşik biçimler: hücrenin tarih mi sayı mı olduğu buradan da anlaşılır */
export const TARIH_ID = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

const RENK = { black: '#000', blue: '#1a56db', cyan: '#0e7490', green: '#15803d', magenta: '#a21caf', red: '#b91c1c', white: '#fff', yellow: '#a16207' };
const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const AY_UZUN = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const GUN_UZUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

// ---------------------------------------------------------------------------------
// Kod ayrıştırma
// ---------------------------------------------------------------------------------
/*
 * Ayrıştırma sonucu KOD METNİNİN saf işlevidir, değerin değil: aynı kod bir sütundaki
 * 60.000 hücrenin hepsinde yeniden çözülürse iş 60.000 katına çıkar. Bir tabloda ayrı
 * biçim kodu sayısı onlarla ölçülür, bu yüzden bellek küçüktür ve kazanç büyüktür.
 * Dönen nesneler okunur, değiştirilmez.
 */
const BOLUM_BELLEK = new Map();
const IM_BELLEK = new Map();
/*
 * Bölümler ';' ile ayrılır ama tırnak içindeki ve '\' ile kaçırılmış ';' ayraç DEĞİLDİR;
 * köşeli parantez içindekiler de ([$-41F] gibi) dokunulmaz. Kaba bir split() bu yüzden yanlıştır.
 */
export function bolumler(kod) {
  const c0 = BOLUM_BELLEK.get(kod); if (c0) return c0;
  const o = []; let cur = '', tirnak = false, kose = false;
  for (let i = 0; i < kod.length; i++) {
    const c = kod[i];
    if (c === '"') { tirnak = !tirnak; cur += c; continue; }
    if (!tirnak && c === '[') kose = true;
    if (!tirnak && c === ']') kose = false;
    if (c === '\\') { cur += c + (kod[i + 1] || ''); i++; continue; }
    if (c === ';' && !tirnak && !kose) { o.push(cur); cur = ''; continue; }
    cur += c;
  }
  o.push(cur);
  const _r = o; BOLUM_BELLEK.set(kod, _r); return _r;
}
/*
 * Bir bölümün başındaki [Red] · [>=100] · [$₺-41F] · [h] imlerini ayırır.
 * Tarama karakter karakterdir, düz bir regex DEĞİL: '["]' gibi TIRNAK İÇİNDEKİ köşeli parantez
 * bir im değil, basılacak metnin kendisidir — regex onu yutup metin bölümünü boşaltıyordu.
 */
function imleriAyir(b) {
  const c0 = IM_BELLEK.get(b); if (c0) return c0;
  let renk = null, kosul = null, para = '', gecen = false, govde = '', tirnak = false;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === '"') { tirnak = !tirnak; govde += c; continue; }
    if (c === '\\') { govde += c + (b[i + 1] || ''); i++; continue; }
    if (tirnak || c !== '[') { govde += c; continue; }
    const kapa = b.indexOf(']', i + 1);
    if (kapa < 0) { govde += c; continue; }
    const d = b.slice(i + 1, kapa).trim(), dl = d.toLowerCase();
    i = kapa;
    if (RENK[dl]) { renk = RENK[dl]; continue; }
    if (/^color\s*\d+$/i.test(d)) continue;
    const kk = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(d);
    if (kk) { kosul = { op: kk[1], v: Number(kk[2]) }; continue; }
    if (d.startsWith('$')) { const pp = d.slice(1).split('-')[0]; para += pp; if (pp) govde += '\u0001'; continue; }
    if (/^h+$|^m+$|^s+$/i.test(d)) { gecen = true; govde += '\u0002' + dl; continue; }
  }
  const _r = { govde, renk, kosul, para, gecen }; IM_BELLEK.set(b, _r); return _r;
}
/** Bölüm tarih/saat mi, sayı mı? Kaçırılmamış tarih imi varsa tarihtir. */
function tarihMi(g) {
  let tirnak = false;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '"') { tirnak = !tirnak; continue; }
    if (tirnak) continue;
    if (c === '\\') { i++; continue; }
    if (c === '\u0002') return true;
    if ('ymdhs'.includes(c.toLowerCase())) {
      // "General" içindeki 'e' değil ama 'm' geçmez; yine de AM/PM'in m'si sayılmasın diye
      // yalnız im dizileri aranır — burada tek karakter yeter, yanlış pozitif "m" kodu zaten tarihtir.
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------
// Sayı biçimleme
// ---------------------------------------------------------------------------------
/** Ondalık METİN üzerinden yarımı sıfırdan uzağa yuvarlar (toFixed'in ikilik sapmasına düşmeden) */
export function yuvarlaMetin(n, hane) {
  if (!isFinite(n)) return String(n);
  const eksi = n < 0; let x = Math.abs(n);
  // 17 anlamlı hane, sonra istenen haneye yarım-yukarı: 1,005 → "1.00500000..." → 1,01
  let s = x.toPrecision(Math.min(21, Math.max(1, Math.floor(Math.log10(x || 1)) + 1 + hane + 3)));
  if (s.includes('e')) s = x.toFixed(Math.min(100, hane + 2));
  const nokta = s.indexOf('.');
  let tam = nokta < 0 ? s : s.slice(0, nokta), ond = nokta < 0 ? '' : s.slice(nokta + 1);
  if (ond.length <= hane) return (eksi ? '-' : '') + tam + (hane ? '.' + ond.padEnd(hane, '0') : '');
  const kesilen = ond[hane];
  tam = tam + ond.slice(0, hane);
  let d = BigInt(tam || '0');
  if (kesilen >= '5') d += 1n;
  let t = d.toString().padStart(hane + 1, '0');
  const tamKisim = hane ? t.slice(0, t.length - hane) : t;
  const ondKisim = hane ? t.slice(t.length - hane) : '';
  return (eksi ? '-' : '') + tamKisim + (hane ? '.' + ondKisim : '');
}
/** Gövdedeki 0 # ? yer tutucularını sayar ve ondalık / ölçek bilgisini çıkarır */
function sayiPlan(g) {
  let tirnak = false, ond = -1, tamYer = '', ondYer = '', usYer = '', binlik = false, olcek = 0, yuzde = 0, bilim = null, kesir = null;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '"') { tirnak = !tirnak; continue; }
    if (tirnak) continue;
    if (c === '\\') { i++; continue; }
    if (c === '%') { yuzde++; continue; }
    if ((c === 'E' || c === 'e') && (g[i + 1] === '+' || g[i + 1] === '-')) { bilim = g[i + 1]; i++; usYer = ''; continue; }
    if (c === '/') { kesir = true; continue; }
    if (c === '.') { if (ond < 0 && bilim == null) ond = 0; continue; }
    if (c === ',') {
      // Yer tutucuların ARASINDAKİ virgül binlik ayracıdır; SONUNDAKİ her virgül 1000'e böler.
      const sonra = g.slice(i + 1).replace(/[^0#?.,]/g, '');
      if (/^,*$/.test(sonra)) olcek++; else binlik = true;
      continue;
    }
    // Üstel imden SONRAKİ yer tutucular ÜSTELE aittir; ondalık sayılırsa 0.00E+00 dört haneli olurdu.
    if (c === '0' || c === '#' || c === '?') { if (bilim != null) usYer += c; else if (ond >= 0) { ondYer += c; ond++; } else tamYer += c; continue; }
  }
  return { ond: Math.max(0, ond), tamYer, ondYer, usYer, binlik, olcek, yuzde, bilim, kesir };
}
/** En iyi kesir yaklaşımı (Stern-Brocot): # ?/? ve # ??/?? kodları için */
function enIyiKesir(x, enBuyukPayda) {
  let a = 0, b = 1, c = 1, d = 0;
  const hedef = x;
  for (let i = 0; i < 64; i++) {
    const m = (a + c), n = (b + d);
    if (n > enBuyukPayda) break;
    if (m / n < hedef) { a = m; b = n; } else { c = m; d = n; }
  }
  const s1 = b ? Math.abs(hedef - a / b) : Infinity, s2 = d ? Math.abs(hedef - c / d) : Infinity;
  return s1 <= s2 ? [a, b || 1] : [c, d || 1];
}
function binlikle(tam, ayrac) { return tam.replace(/\B(?=(\d{3})+(?!\d))/g, ayrac); }
/*
 * KESİR BİÇİMİ — "# ?/?" · "# ??/??" · "# ?/16". Yer tutucular üç öbektir: TAM kısım, PAY ve
 * PAYDA. Ayrımı '/' verir: '/' öncesindeki bitişik öbek paydır, sonrasındaki paydadır, daha
 * öncesinde boşlukla ayrılmış bir öbek varsa o tam kısımdır. Genel sayı yolunda bu üç öbek
 * birbirine karışıyor ve payda bölümü tam kısma yazılıyordu; bu yüzden kesir ayrı ele alınır.
 * '?' yer tutucusu eksik basamağı BOŞLUKLA doldurur — kesirler alt alta hizalansın diyedir.
 */
function kesirYaz(g, n, ayar, im, plan) {
  const bol = g.indexOf('/');
  const solHam = g.slice(0, bol), sagHam = g.slice(bol + 1);
  const payM = /([0#?]+)\s*$/.exec(solHam);
  const paydaM = /^\s*([0#?]+|\d+)/.exec(sagHam);
  const payYer = payM ? payM[1] : '?';
  const paydaYer = paydaM ? paydaM[1] : '?';
  const onHam = payM ? solHam.slice(0, payM.index) : solHam;
  const tamM = /([0#?]+)\s*$/.exec(onHam);
  const tamYer = tamM ? tamM[1] : '';
  let x = Math.abs(n);
  if (plan.yuzde) x *= Math.pow(100, plan.yuzde);
  const sabitPayda = /^\d+$/.test(paydaYer) ? Number(paydaYer) : 0;
  const tamVar = !!tamYer;
  const tam = tamVar ? Math.floor(x) : 0;
  const kalan = x - tam;
  let p, q;
  if (sabitPayda) { q = sabitPayda; p = Math.round(kalan * q); if (p === q) { p = 0; if (tamVar) return kesirCiz(g, bol, payM, paydaM, tamM, ayar, im, n, String(tam + 1), '', ''); } }
  else { const r = enIyiKesir(kalan, Math.pow(10, paydaYer.length) - 1); p = r[0]; q = r[1]; }
  const payS = String(tamVar ? p : p + tam * q);
  const paydaS = String(q);
  // Tam kısım sıfırsa '#' onu YAZMAZ, '0' yazar: "# ?/?" ile 0,5 → " 1/2", "0 ?/?" ile → "0 1/2".
  const tamS = tamVar ? (tam === 0 && !tamYer.includes('0') ? '' : String(tam)) : '';
  return kesirCiz(g, bol, payM, paydaM, tamM, ayar, im, n, tamS, payS, paydaS);
}
function kesirCiz(g, bol, payM, paydaM, tamM, ayar, im, n, tamS, payS, paydaS) {
  const solHam = g.slice(0, bol), sagHam = g.slice(bol + 1);
  const payYer = payM ? payM[1] : '?', paydaYer = paydaM ? paydaM[1] : '?', tamYer = tamM ? tamM[1] : '';
  // Pay SOLDAN, payda SAĞDAN doldurulur: " 1/3 " ile "12/99" alt alta hizalanır.
  const dolgu = (s, yer) => (s.length >= yer.length ? s : (yer[0] === '?' ? ' ' : yer[0] === '0' ? '0' : '').repeat(yer.length - s.length) + s);
  const dolguSag = (s, yer) => (s.length >= yer.length ? s : s + (yer[0] === '?' ? ' ' : yer[0] === '0' ? '0' : '').repeat(yer.length - s.length));
  const duz = (metin) => {
    let o = '', tirnak = false;
    for (let i = 0; i < metin.length; i++) {
      const c = metin[i];
      if (c === '"') { tirnak = !tirnak; continue; }
      if (tirnak) { o += c; continue; }
      if (c === '\\') { o += metin[++i] || ''; continue; }
      if (c === '_') { o += ' '; i++; continue; }
      if (c === '*') { i++; continue; }
      if (c === '\u0001') { o += im.para; continue; }
      o += c;
    }
    return o;
  };
  const onHam = payM ? solHam.slice(0, payM.index) : solHam;
  const onOn = tamM ? onHam.slice(0, tamM.index) : onHam;
  const araHam = tamM ? onHam.slice(tamM.index + tamYer.length) : '';
  const sonHam = paydaM ? sagHam.slice(paydaM.index + paydaM[0].length) : sagHam;
  const payArasi = payM ? solHam.slice((payM.index || 0) + payYer.length) : '';
  const tamMetin = tamYer && tamS !== '' ? dolgu(tamS, tamYer) : (tamYer && tamYer[0] === '?' ? ' '.repeat(tamYer.length) : '');
  return (n < 0 && !/^\s*-/.test(g) ? '' : '') + duz(onOn) + tamMetin + duz(araHam) + dolgu(payS, payYer) + duz(payArasi) + '/' + (/^\d+$/.test(paydaYer) ? paydaYer : dolguSag(paydaS, paydaYer)) + duz(sonHam);
}

/*
 * Gövdeyi baştan sona gezip çıktı kurar. Yer tutucular sırayla TÜKETİLİR: metin kısımları
 * (tırnak içi, kaçırılmış karakter, artı-eksi, boşluk…) olduğu yerde kalır. Bu yüzden
 * "0,00 TL" ile "TL 0,00" ve "(#.##0)" hep doğru yerde yazılır.
 */
function sayiYaz(g, n, ayar, im) {
  const plan = sayiPlan(g);
  if (plan.kesir) return kesirYaz(g, n, ayar, im, plan);
  /*
   * Bölümde HİÇ yer tutucu yoksa (ör. üçüncü bölümü yalnız "-" olan muhasebe kodu) sayı
   * YAZILMAZ: bölüm sabit bir metindir. Eskiden sondaki yedek dal sayıyı yine de başa
   * ekliyordu ve sıfır "0-" görünüyordu.
   */
  const sayisalVar = /[0#?]/.test(g.replace(/"[^"]*"/g, '').replace(/\\./g, ''));
  let x = Math.abs(n);
  if (plan.yuzde) x *= Math.pow(100, plan.yuzde);
  if (plan.olcek) x /= Math.pow(1000, plan.olcek);
  let tamS = '', ondS = '', usS = '';
  if (plan.bilim) {
    const tamHane = Math.max(1, plan.tamYer.replace(/[^0#?]/g, '').length);
    let us = x === 0 ? 0 : Math.floor(Math.log10(x));
    us = Math.floor(us / tamHane) * tamHane;
    const mant = x === 0 ? 0 : x / Math.pow(10, us);
    const ms = yuvarlaMetin(mant, plan.ond);
    const parcali = ms.split('.');
    tamS = parcali[0]; ondS = parcali[1] || '';
    const usAbs = Math.abs(us);
    usS = (us < 0 ? '-' : plan.bilim === '+' ? '+' : '') + String(usAbs).padStart(Math.max(1, plan.usYer.length), '0');
  } else {
    const s = yuvarlaMetin(x, plan.ond);
    const parcali = s.split('.');
    tamS = parcali[0]; ondS = parcali[1] || '';
  }
  if (tamS === '0' && plan.tamYer.replace(/[^0#?]/g, '') && !plan.tamYer.includes('0') && !plan.bilim) tamS = '';   // "#.##" sıfır tam kısmı yazmaz
  const tamGerek = plan.tamYer.replace(/[^0#?]/g, '');
  if (tamGerek.length > tamS.length) {
    const eksik = tamGerek.length - tamS.length;
    const dolgu = tamGerek.slice(0, eksik).replace(/#/g, '').replace(/\?/g, ' ').replace(/0/g, '0');
    tamS = dolgu.replace(/0/g, '0') + tamS;
  }
  if (plan.binlik) tamS = binlikle(tamS, ayar.binlik);
  // Ondalık yer tutucuları: 0 zorunlu, # gereksiz sıfırı atar, ? boşluk bırakır
  if (plan.ondYer) {
    const yer = plan.ondYer;
    let o = '';
    for (let i = 0; i < yer.length; i++) {
      const c = yer[i], d = ondS[i];
      if (d == null || d === undefined) o += c === '0' ? '0' : c === '?' ? ' ' : '';
      else o += d;
    }
    /*
     * Sondaki DOLGU sıfırları atılır: '#' hiç yazmaz, '?' yerine BOŞLUK koyar (kesirler ve
     * ondalıklar alt alta hizalansın diye). '0' zorunludur, o durur. yuvarlaMetin istenen
     * haneye kadar sıfırla doldurduğu için ayıklama burada, çıktı üzerinde yapılır.
     */
    let a = o.split('');
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i] !== '0' && a[i] !== ' ') break;
      if (yer[i] === '0') break;
      a[i] = yer[i] === '?' ? ' ' : '';
    }
    ondS = a.join('');
    while (ondS.length && ondS[ondS.length - 1] === ' ' && yer[ondS.length - 1] === '#') ondS = ondS.slice(0, -1);
  } else ondS = '';

  let out = '', oi = 0, tirnak = false;
  let tamYazildi = false;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '"') { tirnak = !tirnak; continue; }
    if (tirnak) { out += c; continue; }
    if (c === '\\') { out += g[++i] || ''; continue; }
    if (c === '\u0001') { out += im.para; continue; }
    if (c === '_') { out += ' '; i++; continue; }          // _) kadar boşluk bırak (genişlik yerine tek boşluk)
    if (c === '*') { i++; continue; }                       // yineleme dolgusu: HTML'de anlamsız, atlanır
    if (c === '%') { out += '%'; continue; }
    if ((c === 'E' && plan.bilim) && (g[i + 1] === '+' || g[i + 1] === '-')) { out += 'E' + usS; i += 1 + (/^[0#?]+/.exec(g.slice(i + 2)) || [''])[0].length; continue; }
    if (c === '.') { if (ondS) out += ayar.ondalik + ondS; oi = 1; continue; }
    if (c === ',') { const sonra = g.slice(i + 1).replace(/[^0#?.,]/g, ''); if (/^,*$/.test(sonra)) continue; continue; }
    if (c === '0' || c === '#' || c === '?') {
      const grup = /^[0#?]+/.exec(g.slice(i))[0];
      i += grup.length - 1;
      if (oi === 0 && !tamYazildi) { out += tamS; tamYazildi = true; }
      continue;
    }
    out += c;
  }
  if (!tamYazildi && !plan.bilim && sayisalVar && tamS) out = tamS + out;
  return out;
}

// ---------------------------------------------------------------------------------
// Tarih biçimleme
// ---------------------------------------------------------------------------------
const GUNMS = 86400000;
function seriParcala(n) {
  const g = Math.floor(n + 1e-9);
  const d = new Date(Date.UTC(1899, 11, 30) + (g > 59 ? g : g + 1) * GUNMS);
  const kalan = n - g;
  let sn = Math.round(kalan * 86400);
  let gunEk = 0;
  if (sn >= 86400) { sn -= 86400; gunEk = 1; }
  const d2 = gunEk ? new Date(d.getTime() + GUNMS) : d;
  return { y: d2.getUTCFullYear(), ay: d2.getUTCMonth() + 1, gun: d2.getUTCDate(), hafta: d2.getUTCDay(), sa: Math.floor(sn / 3600), dk: Math.floor(sn / 60) % 60, sn: sn % 60, kesir: kalan * 86400 - Math.floor(kalan * 86400) };
}
function tarihYaz(g, n, im) {
  const p = seriParcala(n);
  const ap = /AM\/PM|A\/P/i.test(g);
  let sa12 = p.sa % 12; if (sa12 === 0) sa12 = 12;
  let out = '', tirnak = false;
  const toplamSaat = Math.floor(n * 24), toplamDk = Math.floor(n * 1440), toplamSn = Math.round(n * 86400);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '"') { tirnak = !tirnak; continue; }
    if (tirnak) { out += c; continue; }
    if (c === '\\') { out += g[++i] || ''; continue; }
    if (c === '_') { out += ' '; i++; continue; }
    if (c === '*') { i++; continue; }
    if (c === '\u0002') {
      // geçen süre: [h] [mm] [ss] — gün taşması YOKTUR, toplam olarak yazılır
      const im2 = /^[hms]+/.exec(g.slice(i + 1))[0];
      i += im2.length;
      const v = im2[0] === 'h' ? toplamSaat : im2[0] === 'm' ? toplamDk : toplamSn;
      out += String(v).padStart(im2.length, '0');
      continue;
    }
    if (/[AaPp]/.test(c) && ap) {
      const m = /^(AM\/PM|A\/P|am\/pm|a\/p)/.exec(g.slice(i));
      if (m) { i += m[0].length - 1; const buyuk = m[0] === m[0].toUpperCase(); const s = p.sa < 12 ? (m[0].length === 3 ? 'A' : 'AM') : (m[0].length === 3 ? 'P' : 'PM'); out += buyuk ? s : s.toLowerCase(); continue; }
    }
    const m = /^(yyyy|yyy|yy|y|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|\.0+)/i.exec(g.slice(i));
    if (m) {
      const im2 = m[0].toLowerCase();
      i += m[0].length - 1;
      // 'm' saat iminden HEMEN SONRA ya da saniye iminden HEMEN ÖNCE geliyorsa DAKİKAdır, ay değil.
      const oncekiSaat = /[hH]\]?[^ymdhs]{0,2}$/.test(g.slice(0, i - m[0].length + 1));
      const sonrakiSn = /^[^ymdhs]{0,2}[sS]/.test(g.slice(i + 1));
      if (im2 === 'yyyy' || im2 === 'yyy') out += String(p.y).padStart(4, '0');
      else if (im2 === 'yy' || im2 === 'y') out += String(p.y % 100).padStart(2, '0');
      else if (im2 === 'mmmmm') out += AY_UZUN[p.ay - 1][0];
      else if (im2 === 'mmmm') out += AY_UZUN[p.ay - 1];
      else if (im2 === 'mmm') out += AY_KISA[p.ay - 1];
      else if (im2 === 'mm') out += (oncekiSaat || sonrakiSn) ? String(p.dk).padStart(2, '0') : String(p.ay).padStart(2, '0');
      else if (im2 === 'm') out += (oncekiSaat || sonrakiSn) ? String(p.dk) : String(p.ay);
      else if (im2 === 'dddd') out += GUN_UZUN[p.hafta];
      else if (im2 === 'ddd') out += GUN_KISA[p.hafta];
      else if (im2 === 'dd') out += String(p.gun).padStart(2, '0');
      else if (im2 === 'd') out += String(p.gun);
      else if (im2 === 'hh') out += String(ap ? sa12 : p.sa).padStart(2, '0');
      else if (im2 === 'h') out += String(ap ? sa12 : p.sa);
      else if (im2 === 'ss') out += String(p.sn).padStart(2, '0');
      else if (im2 === 's') out += String(p.sn);
      else if (im2[0] === '.') out += im.ondalik + String(Math.round(p.kesir * Math.pow(10, im2.length - 1))).padStart(im2.length - 1, '0');
      continue;
    }
    out += c;
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Dış arayüz
// ---------------------------------------------------------------------------------
const VARSAYILAN = { binlik: '.', ondalik: ',', para: '₺' };
/** "General" görünümü: 11 anlamlı haneye kadar düz, ötesi bilimsel (Excel'in kendi eşiği) */
export function genel(n, ayar = VARSAYILAN) {
  if (n === 0) return '0';
  const m = Math.abs(n);
  if (m >= 1e11 || (m < 1e-4 && m > 0)) {
    let s = n.toExponential(5).replace(/\.?0+e/, 'E').replace('e', 'E');
    return s.replace(/E([+-])(\d)$/, 'E$10$2').replace('.', ayar.ondalik);
  }
  // en çok 10 anlamlı hane; sondaki sıfırlar atılır
  let s = Number(n.toPrecision(10)).toString();
  return s.replace('.', ayar.ondalik);
}
/*
 * Bir değeri biçim koduna göre METNE çevirir.
 *   deger : number | string | boolean | null
 *   kod   : "#,##0.00" gibi bir biçim kodu ('General' ya da boş = genel görünüm)
 *   ayar  : { binlik, ondalik, para } — yerel ayraçlar
 * Dönüş: { metin, renk, hiza } — hiza 'r' (sayı) ya da 'l' (metin); renk yoksa null.
 */
export function bicimle(deger, kod, ayar = VARSAYILAN) {
  const a = { ...VARSAYILAN, ...(ayar || {}) };
  if (deger == null || deger === '') return { metin: '', renk: null, hiza: 'l' };
  if (deger && typeof deger === 'object' && typeof deger.e === 'string') return { metin: deger.e, renk: '#b91c1c', hiza: 'c' };
  if (typeof deger === 'boolean') return { metin: deger ? 'DOĞRU' : 'YANLIŞ', renk: null, hiza: 'c' };
  const k = (kod == null || kod === '' ? 'General' : String(kod));
  const bol = bolumler(k);
  if (typeof deger === 'string') {
    // Metin yalnız 4. bölüm varsa ona uyar; yoksa olduğu gibi yazılır.
    const mb = bol.length >= 4 ? bol[3] : null;
    if (!mb) return { metin: deger, renk: null, hiza: 'l' };
    const im = imleriAyir(mb);
    let out = '', tirnak = false;
    for (let i = 0; i < im.govde.length; i++) {
      const c = im.govde[i];
      if (c === '"') { tirnak = !tirnak; continue; }
      if (tirnak) { out += c; continue; }
      if (c === '\\') { out += im.govde[++i] || ''; continue; }
      if (c === '@') { out += deger; continue; }
      if (c === '_') { out += ' '; i++; continue; }
      if (c === '*') { i++; continue; }
      if (c === '\u0001') { out += im.para || a.para; continue; }
      out += c;
    }
    return { metin: out, renk: im.renk, hiza: 'l' };
  }
  const n = Number(deger);
  if (!isFinite(n)) return { metin: '#NUM!', renk: '#b91c1c', hiza: 'c' };
  // Bölüm seçimi: koşul varsa koşullar sırayla denenir; yoksa pozitif / negatif / sıfır.
  let sec = null, negIsaret = false;
  const kosullu = bol.some(b => /\[[<>=]/.test(b));
  if (kosullu) {
    for (let i = 0; i < Math.min(bol.length, 3); i++) {
      const im = imleriAyir(bol[i]);
      if (im.kosul) { const { op, v } = im.kosul; const t = op === '<' ? n < v : op === '<=' ? n <= v : op === '>' ? n > v : op === '>=' ? n >= v : op === '<>' ? n !== v : n === v; if (t) { sec = bol[i]; break; } }
      else if (i === bol.length - 1 || i === 2) { sec = bol[i]; break; }
    }
    if (sec == null) return { metin: '#####', renk: null, hiza: 'r' };
  } else if (bol.length === 1) { sec = bol[0]; negIsaret = n < 0; }
  else if (n > 0) sec = bol[0];
  else if (n < 0) { sec = bol[1] != null && bol[1] !== '' ? bol[1] : bol[0]; negIsaret = !(bol[1] != null && bol[1] !== ''); }
  else sec = bol.length >= 3 ? bol[2] : bol[0];
  const im = imleriAyir(sec);
  const g = im.govde;
  if (/^general$/i.test(g.trim())) return { metin: (n < 0 ? '-' : '') + genel(Math.abs(n), a), renk: im.renk, hiza: 'r' };
  if (g.trim() === '' && !im.para) return { metin: '', renk: im.renk, hiza: 'r' };
  const gAyar = { ...a, para: im.para || a.para };
  const metin = (tarihMi(g) || im.gecen) ? tarihYaz(g, n, gAyar) : sayiYaz(g, n, gAyar, { para: im.para || a.para });
  return { metin: (negIsaret ? '-' : '') + metin, renk: im.renk, hiza: 'r' };
}
/** Biçim kodu tarih/saat gösteriyor mu (sütun hizası ve dışa aktarım için) */
export function tarihBicimi(kod) {
  if (kod == null) return false;
  const b = bolumler(String(kod))[0];
  const im = imleriAyir(b);
  return tarihMi(im.govde) || im.gecen;
}
