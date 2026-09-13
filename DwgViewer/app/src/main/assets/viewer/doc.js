/*
 * Word 97-2003 (.doc — MS-DOC ikili biçimi) → HTML. Bağımlılık yok; tarayıcıda ve Node'da çalışır.
 *
 *  Katmanlar: OLE bileşik dosya (CFB: FAT / miniFAT / DIFAT, dizin ağacı) → FIB (WordDocument başı) → CLX / parça tablosu
 *  (CP → fc; 8 bit windows-1252 ya da UTF-16LE) → metin. Biçim: PlcfBteChpx / PlcfBtePapx ile FKP sayfaları (karakter ve
 *  paragraf sprm'leri), STSH stil sayfası (istdBase zinciri, başlık stilleri), PlfLst / PlfLfo listeler (madde imi, numara
 *  biçimi, sayaç), PlcfSed bölümler (sayfa boyutu ve kenar boşlukları), alanlar (0x13 / 0x14 / 0x15; HYPERLINK → <a>),
 *  tablolar (0x07 hücre ve TTP satır sonu, iç içe tablo itap, sprmTDefTable sütun genişlikleri ve birleştirmeler), resimler
 *  (sprmCPicLocation → Data akışı PICF → OfficeArt blip JPEG / PNG / DIB; kayan çizimler PlcSpaMom + DggInfo), dipnotlar
 *  (PlcffndTxt). Word 6 / 95 (nFib < 0xC1, wIdent 0xA5DC): yalnız metin. Şifreli belge açılmaz.
 *
 *  docToHtml(buf, { tt }) → { parts, html, width, page:{width,height,margins}, warnings } — docs.js docxToHtml ile aynı şekil.
 *  Bloklar: <p>, <h1>..<h6>, <table class="docx-tbl">, <div class="pagebreak"></div>; liste paragrafı <p class="li">
 *  <span class="bul">…</span>; satır içi biçim <span style="…">; köprü <a href target=_blank rel=noopener>; resim <img src="data:…">.
 *  Bütün metin esc() ile kaçışlanır; köprü yalnız http(s) / ftp / mailto şemalarıyla verilir.
 */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const u8at = (b, p) => p >= 0 && p < b.length ? b[p] : 0;
const u16 = (b, p) => p >= 0 && p + 2 <= b.length ? b[p] | (b[p + 1] << 8) : 0;
const i16 = (b, p) => (u16(b, p) << 16) >> 16;
const u32 = (b, p) => p >= 0 && p + 4 <= b.length ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : 0;
const i32 = (b, p) => u32(b, p) | 0;
const EMPTY = new Uint8Array(0);
const NOSEC = 0xFFFFFFFA;   // bu ve üstü özel sektör değerleri (DIFSECT, FATSECT, ENDOFCHAIN, FREESECT)
const NOSTREAM = 0xFFFFFFFF;

// ---------------------------------------------------------------------------------
// OLE bileşik dosya (CFB)
// ---------------------------------------------------------------------------------
class Cfb {
  constructor(buf, tt) {
    const b = this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (b.length < 512 || u32(b, 0) !== 0xE011CFD0 || u32(b, 4) !== 0xE11AB1A1) throw new Error(tt('docNotWord', 'Word belgesi değil (OLE bileşik dosya başlığı yok)'));
    const ss = this.ss = 1 << u16(b, 0x1E), ms = this.ms = 1 << u16(b, 0x20);
    if (!(ss === 512 || ss === 4096) || !(ms >= 16 && ms <= ss)) throw new Error('OLE sektör boyutu geçersiz');
    const nFat = u32(b, 0x2C), dirStart = u32(b, 0x30), miniStart = u32(b, 0x3C), difatStart = u32(b, 0x44);
    this.thr = u32(b, 0x38) || 4096;
    const nSec = this.nSec = Math.max(0, Math.ceil((b.length - ss) / ss));   // dosyadaki sektör sayısı; kısaltılmış dosyada zincir burada kesilir
    const per = ss >> 2;
    // DIFAT: 109 giriş başlıkta, kalanı zincirli DIFAT sektörlerinde
    const difat = [];
    for (let i = 0; i < 109; i++) difat.push(u32(b, 0x4C + 4 * i));
    for (let s = difatStart, guard = 0; s < NOSEC && s < nSec && guard < nSec; guard++) { const o = (s + 1) * ss; for (let i = 0; i < per - 1; i++) difat.push(u32(b, o + 4 * i)); s = u32(b, o + ss - 4); }
    // FAT (yalnız dosyada var olan sektörler)
    const nf = Math.min(nFat, difat.length, nSec);
    const fat = this.fat = new Uint32Array(nf * per);
    for (let i = 0, k = 0; i < nf; i++) { const s = difat[i]; const o = (s + 1) * ss; for (let j = 0; j < per; j++) fat[k++] = s < NOSEC && s < nSec ? u32(b, o + 4 * j) : NOSTREAM; }
    // dizin
    const dir = this.read(dirStart);
    this.entries = [];
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const nl = u16(dir, p + 64), type = dir[p + 66];
      let name = ''; for (let i = 0; i + 1 < Math.min(nl, 64); i += 2) { const c = u16(dir, p + i); if (!c) break; name += String.fromCharCode(c); }
      this.entries.push({ name, type, left: u32(dir, p + 68), right: u32(dir, p + 72), child: u32(dir, p + 76), start: u32(dir, p + 116), size: u32(dir, p + 120) });
    }
    const root = this.entries[0];
    if (!root || root.type !== 5) throw new Error('OLE kök dizini yok');
    // mini akış (kök girdisinin zinciri) + miniFAT
    this.mini = this.read(root.start, root.size);
    const mf = this.read(miniStart); this.minifat = new Uint32Array(mf.length >> 2);
    for (let i = 0; i < this.minifat.length; i++) this.minifat[i] = u32(mf, 4 * i);
    // yalnız kök düzeyindeki girdiler (gömülü nesnelerin kendi WordDocument akışları karışmasın): kırmızı-kara ağaç dolaşımı
    this.root = new Map();
    const seen = new Set(), todo = [root.child];
    while (todo.length) {
      const i = todo.pop(); if (i === NOSTREAM || i >= this.entries.length || seen.has(i)) continue;
      seen.add(i); const e = this.entries[i]; if (!this.root.has(e.name)) this.root.set(e.name, e);
      todo.push(e.left, e.right);
    }
  }
  /** FAT zincirini okur; kısaltılmış dosyada eksik sektörler sıfırdır, döngü korumalıdır */
  read(start, size = -1) {
    const { b, ss, fat } = this; const secs = [];
    for (let s = start, guard = 0; s < NOSEC && guard <= fat.length; guard++) {
      secs.push(s); if (size >= 0 && secs.length * ss >= size) break;
      if (s >= fat.length) break; s = fat[s];
    }
    const out = new Uint8Array(size >= 0 ? size : secs.length * ss);
    for (let i = 0; i < secs.length; i++) { const o = (secs[i] + 1) * ss, dst = i * ss; if (dst >= out.length) break; const n = Math.min(ss, out.length - dst, b.length - o); if (n > 0) out.set(b.subarray(o, o + n), dst); }
    return out;
  }
  /** Kök düzeyindeki akış (yoksa null); mini akış eşiğinin altındakiler miniFAT zincirinden */
  stream(name) {
    const e = this.root.get(name); if (!e || e.type !== 2) return null;
    if (e.size < this.thr) {
      const { mini, ms, minifat } = this, out = new Uint8Array(e.size);
      for (let s = e.start, dst = 0, guard = 0; s < NOSEC && dst < e.size && guard <= minifat.length; guard++) {
        const o = s * ms, n = Math.min(ms, e.size - dst, mini.length - o); if (n > 0) out.set(mini.subarray(o, o + n), dst);
        dst += ms; if (s >= minifat.length) break; s = minifat[s];
      }
      return out;
    }
    return this.read(e.start, e.size);
  }
}

// ---------------------------------------------------------------------------------
// FIB, parça tablosu, metin
// ---------------------------------------------------------------------------------
function readFib(wd, tt) {
  const ident = u16(wd, 0), nFib = u16(wd, 2), flags = u16(wd, 0x0A);
  if (ident !== 0xA5EC && ident !== 0xA5DC) throw new Error(tt('docNotWord', 'Word belgesi değil') + ' (wIdent 0x' + ident.toString(16).toUpperCase() + ')');
  if (flags & 0x0100) throw new Error(tt('docEncrypted', 'Şifreli Word belgesi açılamıyor'));
  const old = ident === 0xA5DC || nFib < 0xC1;
  const nPairs = old ? 0 : u16(wd, 0x98);
  const fcl = (i) => i < nPairs ? [u32(wd, 0x9A + 8 * i), u32(wd, 0x9E + 8 * i)] : [0, 0];
  return { ident, nFib, flags, old, lid: u16(wd, 6), complex: !!(flags & 0x0004), tbl1: !!(flags & 0x0200), fcMin: u32(wd, 0x18), fcMac: u32(wd, 0x1C),
    ccpText: old ? u32(wd, 0x34) : u32(wd, 0x4C), ccpFtn: old ? 0 : u32(wd, 0x50), ccpHdd: old ? 0 : u32(wd, 0x54), ccpMcr: old ? 0 : u32(wd, 0x58), ccpAtn: old ? 0 : u32(wd, 0x5C), ccpEdn: old ? 0 : u32(wd, 0x60), fcl };
}
/** CLX: Prc kayıtları (prm grpprl'leri) + Pcdt (PlcPcd parça tablosu). Word 6/95'te CLX WordDocument içindedir. */
function readClx(src, fc, lcb) {
  const pcs = [], prcs = []; let p = fc; const end = Math.min(src.length, fc + lcb);
  while (p < end) {
    const t = src[p];
    if (t === 1) { const cb = u16(src, p + 1); prcs.push(src.subarray(p + 3, Math.min(end, p + 3 + cb))); p += 3 + cb; }
    else if (t === 2) {
      const lcbPcd = u32(src, p + 1), n = Math.floor((Math.min(lcbPcd, end - p - 5) - 4) / 12), q = p + 5;
      for (let k = 0; k < n; k++) {
        const cp0 = u32(src, q + 4 * k), cp1 = u32(src, q + 4 * (k + 1)), d = q + 4 * (n + 1) + 8 * k;
        const fcRaw = u32(src, d + 2), prm = u16(src, d + 6), comp = !!(fcRaw & 0x40000000);
        if (cp1 < cp0) break;
        pcs.push({ cp0, cp1, fc: comp ? (fcRaw & 0x3FFFFFFF) >>> 1 : fcRaw, uni: !comp, prm });
      }
      break;
    } else break;
  }
  return { pcs, prcs };
}
const dec1252 = new TextDecoder('windows-1252'), decU16 = new TextDecoder('utf-16le', { ignoreBOM: true });
/** Word 6/95: 8 bit metnin kod sayfası FIB'deki dil kimliğinden (lid) kestirilir; Word 97+ 8 bit parçaları hep windows-1252'dir */
function decoderForLid(lid) {
  const prim = lid & 0x3FF, sub = lid >> 10; let cp = 'windows-1252';
  if (prim === 0x19 || prim === 0x22 || prim === 0x23 || prim === 0x02 || prim === 0x2F || prim === 0x3F || prim === 0x43 || prim === 0x50 || (prim === 0x1A && sub === 3)) cp = 'windows-1251';   // Rusça, Ukraynaca, Belarusça, Bulgarca, Makedonca, Kazakça, Özbekçe (Kiril), Moğolca, Sırpça (Kiril)
  else if (prim === 0x1F || prim === 0x2C) cp = 'windows-1254';   // Türkçe, Azerice
  else if (prim === 0x08) cp = 'windows-1253'; else if (prim === 0x0D) cp = 'windows-1255'; else if (prim === 0x01 || prim === 0x20 || prim === 0x29) cp = 'windows-1256';   // Yunanca, İbranice, Arapça / Urduca / Farsça
  else if (prim === 0x05 || prim === 0x0E || prim === 0x15 || prim === 0x18 || prim === 0x1A || prim === 0x1B || prim === 0x24) cp = 'windows-1250';   // Çekçe, Macarca, Lehçe, Romence, Hırvatça / Sırpça (Latin), Slovakça, Slovence
  else if (prim === 0x25 || prim === 0x26 || prim === 0x27) cp = 'windows-1257'; else if (prim === 0x2A) cp = 'windows-1258'; else if (prim === 0x1E) cp = 'windows-874';   // Baltık, Vietnamca, Tayca
  try { return cp === 'windows-1252' ? dec1252 : new TextDecoder(cp); } catch (_) { return dec1252; }
}
/** Parçaları CP sırasıyla çözer; her parça tam (cp1 - cp0) karakter verir (kısaltılmış dosyada boşlukla tamamlanır) → CP = dizgi indeksi */
function decodePieces(pcs, wd, cpLimit, dec8 = dec1252) {
  let text = '';
  for (const pc of pcs) {
    if (pc.cp0 >= cpLimit) break;
    const n = Math.min(pc.cp1, cpLimit) - pc.cp0; if (n <= 0) continue;
    const a = Math.min(pc.fc, wd.length), e = Math.min(pc.uni ? pc.fc + 2 * n : pc.fc + n, wd.length);
    let s = pc.uni ? decU16.decode(wd.subarray(a, e - ((e - a) & 1))) : dec8.decode(wd.subarray(a, e));
    if (s.length < n) s += ' '.repeat(n - s.length); else if (s.length > n) s = s.slice(0, n);
    text += s;
  }
  return text;
}

// ---------------------------------------------------------------------------------
// Sprm çözümü, karakter / paragraf / bölüm özellikleri
// ---------------------------------------------------------------------------------
/** grpprl'deki her sprm için fn(kod, işlenen başlangıcı, işlenen uzunluğu). spra (bit 13-15) işlenen boyutunu verir. */
function eachSprm(g, fn) {
  let i = 0; const n = g.length;
  while (i + 2 <= n) {
    const code = g[i] | (g[i + 1] << 8), spra = code >> 13; i += 2; let len;
    if (spra <= 1) len = 1; else if (spra === 2 || spra === 4 || spra === 5) len = 2; else if (spra === 3) len = 4; else if (spra === 7) len = 3;
    else if (code === 0xD608 || code === 0xD606) len = u16(g, i) + 1;   // sprmTDefTable: cb (u16) = kalan bayt + 1
    else if (code === 0xC615) { const cb = u8at(g, i); if (cb === 255) { let p = i + 1; const del = u8at(g, p); p += 1 + del * 4; const add = u8at(g, p); p += 1 + add * 3; len = p - i; } else len = cb + 1; }   // sprmPChgTabs
    else len = u8at(g, i) + 1;
    if (len < 1) break;
    fn(code, i, Math.min(len, n - i)); i += len;
  }
}
const CHP0 = () => ({ b: 0, i: 0, strike: 0, dstrike: 0, u: 0, caps: 0, smallcaps: 0, vanish: 0, fldVanish: 0, spec: 0, ole2: 0, data: 0, hps: 20, ico: 0, cv: -1, iss: 0, hpsPos: 0, hl: 0, pic: -1, sym: 0, istd: 10 });
const PAP0 = () => ({ istd: 0, jc: 0, inTable: 0, ttp: 0, itap: 0, innerCell: 0, innerTtp: 0, ilvl: 0, ilfo: 0, dxaLeft: 0, dxaLeft1: 0, dxaRight: 0, dyaBefore: 0, dyaAfter: 0, pbb: 0, tdef: null });
const clone = (o) => Object.assign({}, o);
/** Toggle işlenen: 0 kapalı, 1 açık, 128 stilin değeri (değişmez), 129 stilin tersi */
const tog = (cur, v) => v === 1 ? 1 : v === 0 ? 0 : v === 129 ? (cur ? 0 : 1) : cur;
function applyChpx(chp, g, ctx) {
  eachSprm(g, (c, at) => {
    const v = g[at];
    switch (c) {
      case 0x0835: chp.b = tog(chp.b, v); break; case 0x0836: chp.i = tog(chp.i, v); break; case 0x0837: chp.strike = tog(chp.strike, v); break;
      case 0x083A: chp.smallcaps = tog(chp.smallcaps, v); break; case 0x083B: chp.caps = tog(chp.caps, v); break; case 0x083C: chp.vanish = tog(chp.vanish, v); break;
      case 0x0802: chp.fldVanish = tog(chp.fldVanish, v); break; case 0x0855: chp.spec = tog(chp.spec, v); break; case 0x080A: chp.ole2 = tog(chp.ole2, v); break; case 0x0806: chp.data = tog(chp.data, v); break;
      case 0x2A53: chp.dstrike = v; break; case 0x2A3E: chp.u = v; break; case 0x4A43: chp.hps = u16(g, at); break; case 0x2A42: chp.ico = v; break; case 0x6870: chp.cv = u32(g, at); break;
      case 0x2A48: chp.iss = v; break; case 0x4845: chp.hpsPos = i16(g, at); break; case 0x2A0C: chp.hl = v; break; case 0x6A03: chp.pic = u32(g, at); break; case 0x6A09: chp.sym = u16(g, at + 2); break;
      case 0x4A30: { const istd = u16(g, at); if (ctx && ctx.charStyle) ctx.charStyle(chp, istd); chp.istd = istd; break; }   // karakter stili: run'ın kendi sprm'lerinden önce
      case 0x2A33: if (ctx && ctx.base) Object.assign(chp, ctx.base()); break;   // sprmCPlain: paragraf stilinin değerlerine dön
      default: break;
    }
  });
}
function applyPapx(pap, g, ctx) {
  eachSprm(g, (c, at, len) => {
    const v = g[at];
    switch (c) {
      case 0x4600: pap.istd = u16(g, at); break;
      case 0x2461: case 0x2403: pap.jc = v; break; case 0x2416: pap.inTable = v; break; case 0x2417: pap.ttp = v; break; case 0x6649: pap.itap = i32(g, at); break;
      case 0x244B: pap.innerCell = v; break; case 0x244C: pap.innerTtp = v; break; case 0x260A: pap.ilvl = v; break; case 0x460B: pap.ilfo = u16(g, at); break;
      case 0x840F: case 0x845E: pap.dxaLeft = i16(g, at); break; case 0x8411: case 0x8460: pap.dxaLeft1 = i16(g, at); break; case 0x840E: case 0x845D: pap.dxaRight = i16(g, at); break;
      case 0xA413: pap.dyaBefore = u16(g, at); break; case 0xA414: pap.dyaAfter = u16(g, at); break; case 0x2407: pap.pbb = v; break;
      case 0xD608: case 0xD606: { const t = parseTdef(g, at, len); if (t) pap.tdef = t; break; }
      case 0x6646: if (ctx && ctx.data && ctx.depth < 2) { const fc = u32(g, at), cb = u16(ctx.data, fc); if (cb && fc + 2 + cb <= ctx.data.length) applyPapx(pap, ctx.data.subarray(fc + 2, fc + 2 + cb), { data: ctx.data, depth: ctx.depth + 1 }); } break;   // sprmPHugePapx: Data akışındaki büyük grpprl (uzun tablo tanımı)
      default: break;
    }
  });
}
/** TDefTableOperand: cb u16, itcMac u8, rgdxaCenter (itcMac+1) i16 (twip), rgTc80 itcMac × 20 bayt (tcgrf: 1 fFirstMerged, 2 fMerged, 0x20 fVertMerge, 0x40 fVertRestart) */
function parseTdef(g, at, len) {
  const itc = u8at(g, at + 2), end = at + len; if (!itc || itc > 63 || at + 3 + 2 * (itc + 1) > end) return null;
  const xs = [], tcs = []; for (let i = 0; i <= itc; i++) xs.push(i16(g, at + 3 + 2 * i));
  const tcBase = at + 3 + 2 * (itc + 1); for (let i = 0; i < itc; i++) { const p = tcBase + 20 * i; tcs.push(p + 2 <= end ? u16(g, p) : 0); }
  return { xs, tcs };
}
function applySepx(sep, g) {
  eachSprm(g, (c, at) => {
    switch (c) {
      case 0xB01F: sep.xaPage = u16(g, at); break; case 0xB020: sep.yaPage = u16(g, at); break; case 0xB021: sep.dxaLeft = u16(g, at); break; case 0xB022: sep.dxaRight = u16(g, at); break;
      case 0x9023: sep.dyaTop = i16(g, at); break; case 0x9024: sep.dyaBottom = i16(g, at); break; case 0x3001: sep.orient = g[at]; break; case 0x3009: sep.bkc = g[at]; break;
      default: break;
    }
  });
}

// ---------------------------------------------------------------------------------
// FKP sayfaları (PlcfBteChpx / PlcfBtePapx → fc aralıklı run'lar), STSH, listeler, bölümler
// ---------------------------------------------------------------------------------
/** Bütün FKP sayfalarındaki run'lar, fc'ye göre sıralı: {fc0, fc1, g (grpprl), istd (yalnız PAPX)} */
function fkpRuns(plc, wd, isPap) {
  const runs = []; if (!plc) return runs;
  const n = Math.floor((plc.length - 4) / 8);
  for (let i = 0; i < n; i++) {
    const pn = u32(plc, 4 * (n + 1) + 4 * i) & 0x3FFFFF, base = pn * 512; if (base + 512 > wd.length) continue;
    const pg = wd.subarray(base, base + 512), crun = pg[511]; if (!crun || 4 * (crun + 1) + (isPap ? 13 : 1) * crun > 511) continue;
    for (let k = 0; k < crun; k++) {
      const fc0 = u32(pg, 4 * k), fc1 = u32(pg, 4 * k + 4); if (fc1 <= fc0) continue;
      if (isPap) {
        const off = pg[4 * (crun + 1) + 13 * k] * 2; let istd = 0, g = EMPTY;
        if (off) { let cb = pg[off], st = off + 1, len = 2 * cb - 1; if (cb === 0) { cb = pg[off + 1]; st = off + 2; len = 2 * cb; } if (len >= 2) { istd = u16(pg, st); g = pg.subarray(st + 2, Math.min(511, st + len)); } }
        runs.push({ fc0, fc1, istd, g });
      } else {
        const off = pg[4 * (crun + 1) + k] * 2; let g = EMPTY;
        if (off) { const cb = pg[off]; g = pg.subarray(off + 1, Math.min(511, off + 1 + cb)); }
        runs.push({ fc0, fc1, g });
      }
    }
  }
  runs.sort((a, b) => a.fc0 - b.fc0);
  return runs;
}
/** fc'yi kapsayan run'ın indeksi (yoksa -1); hi: fc0 ≤ fc olan son run */
function runIndex(runs, fc) {
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (runs[m].fc0 <= fc) lo = m + 1; else hi = m - 1; }
  return hi >= 0 && fc < runs[hi].fc1 ? hi : -1 - (hi + 1);   // negatif: -(sonraki run indeksi) - 1
}
/** STSH: {styles: [{sti, sgc, base, name, upx[]}]}; UPX: paragraf stilinde [istd+papx, chpx], karakter stilinde [chpx] */
function parseStsh(b) {
  if (!b || b.length < 6) return null;
  const cbStshi = u16(b, 0), cstd = u16(b, 2), cbBase = u16(b, 4); if (!cstd || cbBase < 10 || cbBase > 64) return null;
  const styles = []; let p = 2 + cbStshi;
  for (let i = 0; i < cstd && p + 2 <= b.length; i++) {
    const cb = u16(b, p); p += 2; if (!cb) { styles.push(null); continue; }
    const st = p, end = Math.min(b.length, st + cb);
    const sti = u16(b, st) & 0xFFF, w1 = u16(b, st + 2), sgc = w1 & 0xF, base = w1 >> 4, cupx = u16(b, st + 4) & 0xF;
    let q = st + cbBase; const cch = u16(b, q); let name = '';
    for (let k = 0; k < cch && q + 4 + 2 * k <= end; k++) name += String.fromCharCode(u16(b, q + 2 + 2 * k));
    q += 2 + 2 * cch + 2; if ((q - st) & 1) q++;
    const upx = [];
    for (let k = 0; k < cupx && q + 2 <= end; k++) { const n = u16(b, q); q += 2; upx.push(b.subarray(q, Math.min(end, q + n))); q += n; if ((q - st) & 1) q++; }
    styles.push({ sti, sgc, base, name, upx }); p = st + cb;
  }
  return { styles };
}
/** LVL: LVLF (28 bayt) + grpprlPapx + grpprlChpx + xst (u16 uzunluk + UTF-16; 0x00..0x08 karakterleri düzey numarası yer tutucusu) */
function readLvl(b, p) {
  if (p + 28 > b.length) return null;
  const start = i32(b, p), nfc = b[p + 4], cbChpx = b[p + 24], cbPapx = b[p + 25];
  let q = p + 28; const papx = b.subarray(q, Math.min(b.length, q + cbPapx)); q += cbPapx + cbChpx;
  const cch = u16(b, q); q += 2; let xst = ''; for (let i = 0; i < cch && q + 2 <= b.length; i++, q += 2) xst += String.fromCharCode(u16(b, q));
  const tmp = PAP0(); applyPapx(tmp, papx, null);
  return { lvl: { start, nfc, xst, papx, dxaLeft: tmp.dxaLeft, dxaLeft1: tmp.dxaLeft1 }, next: q };
}
/** PlfLst (lsid → LSTF + LVL'ler) ve PlfLfo (ilfo → LFO + düzey geçersiz kılmaları) */
function parseLists(plfLst, plfLfo) {
  const lsts = new Map(), lfos = [];
  if (plfLst && plfLst.length >= 2) {
    const cLst = u16(plfLst, 0), heads = []; let p = 2;
    for (let i = 0; i < cLst && p + 28 <= plfLst.length; i++) { heads.push({ lsid: u32(plfLst, p), simple: !!(plfLst[p + 26] & 1), lvls: [] }); p += 28; }
    for (const h of heads) { const n = h.simple ? 1 : 9; for (let l = 0; l < n; l++) { const r = readLvl(plfLst, p); if (!r) break; h.lvls.push(r.lvl); p = r.next; } lsts.set(h.lsid, h); }
  }
  if (plfLfo && plfLfo.length >= 4) {
    const cLfo = u32(plfLfo, 0), heads = []; let p = 4;
    for (let i = 0; i < cLfo && p + 16 <= plfLfo.length; i++) { heads.push({ lsid: u32(plfLfo, p), clfolvl: plfLfo[p + 12], ov: [] }); p += 16; }
    for (const h of heads) {
      for (let k = 0; k < h.clfolvl && p + 8 <= plfLfo.length; k++) {
        const start = i32(plfLfo, p), fl = plfLfo[p + 4], ilvl = fl & 0x0F; p += 8; let lvl = null;
        if (fl & 0x20) { const r = readLvl(plfLfo, p); if (!r) break; lvl = r.lvl; p = r.next; }
        h.ov[ilvl] = { start: (fl & 0x10) ? start : null, lvl };
      }
      lfos.push(h);
    }
  }
  return { lsts, lfos };
}
/** PlcfSed: bölümler {cp0, cp1, sep}; Sepx WordDocument'ta (cb u16 + grpprl) */
function parseSections(plc, wd) {
  const out = []; if (!plc) return out;
  const n = Math.floor((plc.length - 4) / 16);
  for (let i = 0; i < n; i++) {
    const cp0 = u32(plc, 4 * i), cp1 = u32(plc, 4 * (i + 1)), fcSepx = u32(plc, 4 * (n + 1) + 12 * i + 2), sep = {};
    if (fcSepx !== NOSTREAM && fcSepx + 2 <= wd.length) { const cb = u16(wd, fcSepx); applySepx(sep, wd.subarray(fcSepx + 2, Math.min(wd.length, fcSepx + 2 + cb))); }
    out.push({ cp0, cp1, sep });
  }
  return out;
}
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function roman(n) { let o = ''; n = Math.max(0, Math.min(3999, n | 0)); for (const [v, s] of ROMAN) while (n >= v) { o += s; n -= v; } return o; }
function letter(n) { let s = ''; n = Math.max(1, n | 0); while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(97 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
/** nfc: 0 arap, 1 büyük Roma, 2 küçük Roma, 3 büyük harf, 4 küçük harf, 22 başı sıfırlı, 23 madde imi, 255 yok */
function fmtNum(n, nfc) {
  switch (nfc) { case 1: return roman(n); case 2: return roman(n).toLowerCase(); case 3: return letter(n).toUpperCase(); case 4: return letter(n); case 22: return n < 10 ? '0' + n : String(n); case 255: return ''; default: return String(n); }
}
const BULLETS = { 0xB7: '•', 0xA7: '▪', 0xD8: '➢', 0x6E: '■', 0x76: '❖', 0xFC: '✓', 0xA8: '•', 0x2D: '–', 0x6C: '●', 0x6F: '○', 0x71: '□', 0x75: '◆', 0xB2: '•', 0xAE: '→', 0xE0: '◊', 0x9F: '•', 0xF0: '⇒', 0x27: '•' };
/** Madde imi: Symbol / Wingdings yazı tiplerinin özel kullanım alanı (U+F0xx) karakterleri genel Unicode imlerine çevrilir */
function bulletChar(xst) { const c = xst ? xst.charCodeAt(0) : 0; if (!c) return '•'; if (c >= 0xF000 && c <= 0xF0FF) return BULLETS[c & 0xFF] || '•'; if (c < 0x20) return '•'; return xst.length > 3 ? xst.slice(0, 3) : xst; }

// ---------------------------------------------------------------------------------
// Resimler: PICF (Data akışı) ve OfficeArt blip kayıtları; kayan çizimler (PlcSpaMom + DggInfo)
// ---------------------------------------------------------------------------------
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + 0x8000))); return btoa(s); }
const JPEG = (b, p) => b[p] === 0xFF && b[p + 1] === 0xD8 && b[p + 2] === 0xFF;
const PNG = (b, p) => b[p] === 0x89 && b[p + 1] === 0x50 && b[p + 2] === 0x4E && b[p + 3] === 0x47;
const GIF = (b, p) => b[p] === 0x47 && b[p + 1] === 0x49 && b[p + 2] === 0x46;
/** Blip verisi → data: URL. DIB (başlıksız BMP) için BITMAPFILEHEADER eklenir; WMF / EMF / TIFF gösterilemez (null). */
function blipSrc(mime, d, hdrLen) {
  if (!d || d.length < 8) return null;
  if (mime === 'image/bmp') {
    const biSize = u32(d, 0), bits = u16(d, 14), cmp = u32(d, 16), clr = u32(d, 32); if (biSize < 12 || biSize > 256) return null;
    const pal = bits <= 8 ? (clr || (1 << bits)) * 4 : 0, off = 14 + (hdrLen || (biSize + pal + (cmp === 3 && biSize === 40 ? 12 : 0))), hdr = new Uint8Array(14);
    hdr[0] = 0x42; hdr[1] = 0x4D; const total = 14 + d.length; hdr[2] = total & 255; hdr[3] = (total >> 8) & 255; hdr[4] = (total >> 16) & 255; hdr[5] = (total >>> 24) & 255; hdr[10] = off & 255; hdr[11] = (off >> 8) & 255; hdr[12] = (off >> 16) & 255; hdr[13] = (off >>> 24) & 255;
    const all = new Uint8Array(total); all.set(hdr); all.set(d, 14); return 'data:image/bmp;base64,' + b64(all);
  }
  if (mime === 'image/tiff') return null;
  if (JPEG(d, 0)) mime = 'image/jpeg'; else if (PNG(d, 0)) mime = 'image/png'; else if (GIF(d, 0)) mime = 'image/gif'; else if (mime !== 'image/jpeg' && mime !== 'image/png') return null;
  return 'data:' + mime + ';base64,' + b64(d);
}
/** Blip kaydı türleri: [MIME, çift UID'li instance değerleri]; null → metafile (gösterilemez) */
const BLIP = { 0xF01A: null, 0xF01B: null, 0xF01C: null, 0xF01D: ['image/jpeg', [0x46B, 0x6E3]], 0xF01E: ['image/png', [0x6E1]], 0xF01F: ['image/bmp', [0x7A9]], 0xF029: ['image/tiff', [0x6E5]] };
/** [p, end) aralığındaki OfficeArt kayıtlarında ilk blip: kapsayıcılara (ver 0xF) ve BSE (0xF007) gövdesine iner. {src} | {meta:true} | null */
function findBlip(b, p, end, depth) {
  for (let guard = 0; p + 8 <= end && guard < 4096; guard++) {
    const ver = b[p] & 0x0F, inst = (b[p] >> 4) | (b[p + 1] << 4), type = u16(b, p + 2), len = u32(b, p + 4), body = p + 8, bodyEnd = Math.min(end, body + len);
    if (ver === 0x0F) { if (depth < 8) { const r = findBlip(b, body, bodyEnd, depth + 1); if (r) return r; } }
    else if (type === 0xF007) { const q = body + 36 + u8at(b, body + 33); if (q + 8 <= bodyEnd && depth < 8) { const r = findBlip(b, q, bodyEnd, depth + 1); if (r) return r; } }
    else if (type >= 0xF018 && type <= 0xF117) {
      const spec = BLIP[type];
      if (spec === null) { const q = body + (inst === 0x3D5 || inst === 0x217 || inst === 0x543 ? 32 : 16); const src = type === 0xF01C ? null : metaRaster(b, q, bodyEnd, type); return src ? { src } : { meta: true }; }   // WMF / EMF: içindeki raster; PICT ve salt vektör metafile gösterilemez
      if (spec) { const q = body + (spec[1].includes(inst) ? 32 : 16) + 1; const src = blipSrc(spec[0], b.subarray(q, bodyEnd)); return src ? { src } : { meta: true }; }
    }
    p = Math.max(body, bodyEnd);
  }
  return null;
}
/** JPEG işaretçi zinciri SOI'den SOS'a kadar tutarlı mı (rastgele veride FF D8 FF yanlış pozitifini eler) */
function validJpeg(b, i, end) {
  let p = i + 2, sof = false;
  for (let guard = 0; p + 4 <= end && guard < 64; guard++) {
    if (b[p] !== 0xFF) return false;
    const m = b[p + 1]; if (m === 0xDA) return sof; if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) sof = true;
    const len = (b[p + 2] << 8) | b[p + 3]; if (len < 2) return false; p += 2 + len;
  }
  return false;
}
/** Kayıt yapısı çözülemezse: aralıkta doğrulanmış JPEG / PNG / GIF imzası ara */
function sniffBlip(b, p, end) {
  for (let i = p; i + 24 < end; i++) {
    if (JPEG(b, i) ? validJpeg(b, i, end) : PNG(b, i) ? (b[i + 12] === 0x49 && b[i + 13] === 0x48 && b[i + 14] === 0x44 && b[i + 15] === 0x52) : GIF(b, i) && b[i + 3] === 0x38) { const src = blipSrc('', b.subarray(i, end)); if (src) return { src }; }
  }
  return null;
}
/** zlib / ham DEFLATE açıcı (eş zamanlı; puff algoritması): WMF / EMF blip'leri sıkıştırılmış saklanır */
function inflate(src) {
  let p = 0; if (src.length >= 2 && (src[0] & 0x0F) === 8 && ((src[0] << 8) | src[1]) % 31 === 0) p = 2;   // zlib başlığı
  let out = new Uint8Array(Math.max(4096, Math.min(64 << 20, src.length * 4))), op = 0, bitBuf = 0, bitCnt = 0;
  const ensure = (n) => { if (op + n > out.length) { const o = new Uint8Array(Math.max(out.length * 2, op + n)); o.set(out.subarray(0, op)); out = o; } };
  const bits = (n) => { while (bitCnt < n) { if (p >= src.length) throw new Error('deflate: veri bitti'); bitBuf |= src[p++] << bitCnt; bitCnt += 8; } const v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v; };
  const build = (lengths, n) => { const count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(n); for (let i = 0; i < n; i++) count[lengths[i]]++; count[0] = 0; for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1]; for (let i = 0; i < n; i++) if (lengths[i]) sym[offs[lengths[i]]++] = i; return { count, sym }; };
  const decode = (t) => { let code = 0, first = 0, index = 0; for (let len = 1; len < 16; len++) { code |= bits(1); const c = t.count[len]; if (code - c < first) return t.sym[index + (code - first)]; index += c; first += c; first <<= 1; code <<= 1; } throw new Error('deflate: geçersiz kod'); };
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  let fixedL = null, fixedD = null;
  for (let final = 0; !final;) {
    final = bits(1); const type = bits(2);
    if (type === 0) {   // saklanan blok: bayt sınırına dön, LEN / NLEN
      p -= bitCnt >> 3; bitBuf = 0; bitCnt = 0; const len = src[p] | (src[p + 1] << 8); p += 4; if (p + len > src.length) throw new Error('deflate: saklanan blok');
      ensure(len); out.set(src.subarray(p, p + len), op); op += len; p += len; continue;
    }
    let lt, dt;
    if (type === 1) { if (!fixedL) { const l = new Uint8Array(288); for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8; fixedL = build(l, 288); fixedD = build(new Uint8Array(30).fill(5), 30); } lt = fixedL; dt = fixedD; }
    else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[ORDER[i]] = bits(3);
      const ct = build(cl, 19), lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(ct);
        if (sym < 16) lengths[i++] = sym;
        else { let rep = 0, val = 0; if (sym === 16) { if (!i) throw new Error('deflate: tekrar'); val = lengths[i - 1]; rep = 3 + bits(2); } else if (sym === 17) rep = 3 + bits(3); else rep = 11 + bits(7); if (i + rep > nlen + ndist) throw new Error('deflate: uzunluk tablosu'); while (rep--) lengths[i++] = val; }
      }
      lt = build(lengths.subarray(0, nlen), nlen); dt = build(lengths.subarray(nlen), ndist);
    } else throw new Error('deflate: blok türü');
    for (;;) {
      const sym = decode(lt);
      if (sym < 256) { ensure(1); out[op++] = sym; }
      else if (sym === 256) break;
      else { const li = sym - 257; if (li >= 29) throw new Error('deflate: uzunluk'); const len = LBASE[li] + bits(LEXT[li]); const di = decode(dt); if (di >= 30) throw new Error('deflate: uzaklık'); const dist = DBASE[di] + bits(DEXT[di]); if (dist > op) throw new Error('deflate: uzaklık'); ensure(len); for (let k = 0; k < len; k++, op++) out[op] = out[op - dist]; }
    }
  }
  return out.subarray(0, op);
}
/** DIB (BITMAPINFO + bitler) → [MIME, bayt, başlık uzunluğu]: biCompression 4 JPEG, 5 PNG, ötekiler BMP */
function dibParts(bmi, bits) {
  const biSize = u32(bmi, 0), cmp = u32(bmi, 16); if (biSize < 12 || biSize > 256) return null;
  if (cmp === 4) return ['image/jpeg', bits, 0]; if (cmp === 5) return ['image/png', bits, 0];
  if (bits === null) { const bpp = u16(bmi, 14), clr = u32(bmi, 32), hdr = biSize + (bpp <= 8 ? (clr || (1 << bpp)) * 4 : 0) + (cmp === 3 && biSize === 40 ? 12 : 0); return ['image/bmp', bmi, hdr]; }   // bitişik DIB (WMF)
  const all = new Uint8Array(bmi.length + bits.length); all.set(bmi); all.set(bits, bmi.length); return ['image/bmp', all, bmi.length];
}
/** Metafile blip (WMF / EMF): sıkıştırılmışsa açılır; içindeki en büyük raster kaydı (DIB / JPEG / PNG) çıkarılır — vektör içerik çizilmez */
function metaRaster(b, p, end, type) {
  const comp = u8at(b, p + 32); let d = b.subarray(p + 34, end);   // OfficeArtMetafileHeader: cbSize @0, rcBounds, ptSize, cbSave @28, compression @32 (0 deflate, 0xFE yok), filter @33
  if (comp === 0) { try { d = inflate(d); } catch (_) { return null; } } else if (comp !== 0xFE) return null;
  let best = null; const consider = (r) => { if (r && r[1] && r[1].length > 64 && (!best || r[1].length > best[1].length)) best = r; };
  if (type === 0xF01A) {   // EMF: kayıt = tür u32 + boyut u32
    for (let q = 0, guard = 0; q + 8 <= d.length && guard < 200000; guard++) {
      const t = u32(d, q), sz = u32(d, q + 4); if (sz < 8 || q + sz > d.length) break;
      let o = 0; if (t === 81 || t === 80) o = 48; else if (t === 76 || t === 77) o = 84;   // EMR_STRETCHDIBITS / EMR_SETDIBITSTODEVICE; EMR_BITBLT / EMR_STRETCHBLT
      if (o) { const offBmi = u32(d, q + o), cbBmi = u32(d, q + o + 4), offBits = u32(d, q + o + 8), cbBits = u32(d, q + o + 12); if (cbBmi >= 12 && cbBits > 0 && offBmi + cbBmi <= sz && offBits + cbBits <= sz) consider(dibParts(d.subarray(q + offBmi, q + offBmi + cbBmi), d.subarray(q + offBits, q + offBits + cbBits))); }
      q += sz;
    }
  } else if (type === 0xF01B) {   // WMF: METAHEADER 18 bayt; kayıt = boyut u32 (kelime) + işlev u16 + parametreler
    for (let q = 18, guard = 0; q + 6 <= d.length && guard < 200000; guard++) {
      const sz = u32(d, q) * 2, fn = u16(d, q + 4); if (sz < 6 || q + sz > d.length) break;
      const o = fn === 0x0F43 ? 22 : fn === 0x0B41 ? 20 : fn === 0x0940 ? 16 : fn === 0x0D33 ? 18 : 0;   // META_STRETCHDIB, META_DIBSTRETCHBLT, META_DIBBITBLT, META_SETDIBTODEV
      if (o && q + 6 + o + 40 <= q + sz) consider(dibParts(d.subarray(q + 6 + o, q + sz), null));
      q += sz;
    }
  }
  return best ? blipSrc(best[0], best[1], best[2]) : null;
}
/** Data akışındaki PICF: lcb u32, cbHeader u16, mm u16, …, dxaGoal i16 @0x1C, dyaGoal @0x1E, mx u16 @0x20, my @0x22; ardından (mm 0x66: dosya adı) + OfficeArt */
function readPicf(data, fc) {
  const lcb = u32(data, fc), cbH = u16(data, fc + 4), mm = u16(data, fc + 6);
  if (lcb < 0x44 || cbH < 0x44 || cbH > lcb || fc + cbH > data.length) return null;
  const dxaGoal = i16(data, fc + 0x1C), mx = u16(data, fc + 0x20), end = Math.min(data.length, fc + lcb);
  let p = fc + cbH; if (mm === 0x66) p += 1 + u8at(data, p);
  const blip = findBlip(data, p, end, 0) || sniffBlip(data, p, end);
  if (!blip || !blip.src) return blip;
  const w = dxaGoal > 0 ? dxaGoal * (mx || 1000) / 1000 / 20 : 0;
  return { src: blip.src, w: Math.round(w * 10) / 10 };
}
/** PlcSpaMom: kayan çizim çapaları {cp, spid, w (pt)} */
function parseSpa(plc) {
  const out = []; if (!plc) return out;
  const n = Math.floor((plc.length - 4) / 30);
  for (let i = 0; i < n; i++) { const d = 4 * (n + 1) + 26 * i; out.push({ cp: u32(plc, 4 * i), spid: u32(plc, d), w: Math.max(0, (i32(plc, d + 12) - i32(plc, d + 4)) / 20) }); }
  return out;
}
/** DggInfo (OfficeArtContent): BSE listesi (sırayla; pib 1 tabanlı) ve şekil (spid) → pib (OPT 0x0104) eşlemesi */
function parseDgg(b) {
  const bses = [], spidPib = new Map(); if (!b) return { bses, spidPib };
  const walk = (p, end, depth, sp) => {
    for (let guard = 0; p + 8 <= end && guard < 8192; guard++) {
      if (depth === 0 && u16(b, p + 2) < 0xF000 && u16(b, p + 3) >= 0xF000) p++;   // OfficeArtWordDrawing: DgContainer'dan önce 1 baytlık dgglbl (0 ana belge, 1 üst bilgi)
      const ver = b[p] & 0x0F, inst = (b[p] >> 4) | (b[p + 1] << 4), type = u16(b, p + 2), len = u32(b, p + 4), body = p + 8, bodyEnd = Math.min(end, body + len);
      if (ver === 0x0F) { if (depth < 12) walk(body, bodyEnd, depth + 1, type === 0xF004 ? { spid: 0, pib: 0 } : sp); }
      else if (type === 0xF007) { const cbName = u8at(b, body + 33), q = body + 36 + cbName; bses.push({ foDelay: u32(b, body + 28), emb: q + 8 <= bodyEnd ? [q, bodyEnd] : null }); }
      else if (type === 0xF00A && sp) sp.spid = u32(b, body);
      else if (type === 0xF00B && sp) { for (let k = 0, q = body; k < inst && q + 6 <= bodyEnd; k++, q += 6) { const pid = u16(b, q); if ((pid & 0x3FFF) === 0x0104) sp.pib = u32(b, q + 2); if (pid & 0x8000) { /* karmaşık özellik verisi kayıt sonunda; sıralı 6 baytlık girişler etkilenmez */ } } if (sp.spid && sp.pib) spidPib.set(sp.spid, sp.pib); }
      p = Math.max(body, bodyEnd);
    }
  };
  walk(0, b.length, 0, null);
  return { bses, spidPib };
}

// ---------------------------------------------------------------------------------
// Ana dönüştürücü
// ---------------------------------------------------------------------------------
const ICO = ['', '#000000', '#0000FF', '#00FFFF', '#00FF00', '#FF00FF', '#FF0000', '#FFFF00', '#FFFFFF', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#C0C0C0'];
const hex2 = (n) => (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
const r1 = (v) => Math.round(v * 10) / 10;
const printable = (s) => { let o = ''; for (const ch of s) if (ch.charCodeAt(0) >= 32) o += ch; return o; };
/** Karakter özellikleri → satır içi CSS (docxToHtml ile aynı özellik adları) */
function chpStyle(chp) {
  const st = [];
  if (chp.b) st.push('font-weight:700'); if (chp.i) st.push('font-style:italic');
  const dec = []; if (chp.u) dec.push('underline'); if (chp.strike || chp.dstrike) dec.push('line-through'); if (dec.length) st.push('text-decoration:' + dec.join(' '));
  if (chp.cv !== -1 && (chp.cv >>> 24) === 0) st.push('color:#' + hex2(chp.cv & 255) + hex2((chp.cv >> 8) & 255) + hex2((chp.cv >> 16) & 255));   // COLORREF 0x00BBGGRR; 0xFF000000 = otomatik
  else if (chp.ico > 0 && chp.ico < ICO.length) st.push('color:' + ICO[chp.ico]);
  if (chp.hps > 0 && chp.hps < 3276) st.push('font-size:' + (chp.hps / 2) + 'pt');
  if (chp.hl > 0 && chp.hl < ICO.length) st.push('background:' + ICO[chp.hl]);
  if (chp.caps) st.push('text-transform:uppercase'); if (chp.smallcaps) st.push('font-variant:small-caps');
  return st.join(';');
}
/**
 * .doc → HTML. opts.tt(key, türkçe) çeviri kancası (docs.js tt'si); yoksa Türkçe metin.
 * Dönüş docxToHtml ile aynı: { parts, html, width, page:{width,height,margins} (pt), warnings }
 */
export function docToHtml(buf, opts = {}) {
  const tt = typeof opts.tt === 'function' ? opts.tt : (k, tr) => tr;
  const warnings = [], warn = (s) => { if (s && !warnings.includes(s)) warnings.push(s); };
  const cfb = new Cfb(buf, tt);
  const wd = cfb.stream('WordDocument');
  if (!wd || wd.length < 0x40) throw new Error(tt('docNotWord', 'Word belgesi değil') + ' (WordDocument)');
  const fib = readFib(wd, tt);
  const tbl = fib.old ? wd : (cfb.stream(fib.tbl1 ? '1Table' : '0Table') || cfb.stream(fib.tbl1 ? '0Table' : '1Table') || EMPTY);
  const data = cfb.stream('Data') || EMPTY;
  const safe = (fn, def) => { try { return fn(); } catch (e) { warn(tt('docPartial', 'Belgenin bir bölümü çözülemedi') + ': ' + (e && e.message ? e.message : e)); return def; } };
  // --- metin ---
  let pcs, prcs = [];
  if (fib.old) {
    const r = fib.complex ? safe(() => readClx(wd, u32(wd, 0x160), u32(wd, 0x164)), { pcs: [] }) : { pcs: [] };
    pcs = r.pcs.filter(pc => pc.fc < wd.length && pc.cp1 > pc.cp0);
    if (!pcs.length) pcs = [{ cp0: 0, cp1: Math.max(0, Math.min(wd.length, fib.fcMac) - fib.fcMin), fc: fib.fcMin, uni: false, prm: 0 }];
    warn(tt('docOldWord', 'Word 6/95 belgesi: yalnız metin gösterilir'));
  } else { const [fcClx, lcbClx] = fib.fcl(33); ({ pcs, prcs } = readClx(tbl, fcClx, lcbClx)); }
  if (!pcs.length) throw new Error(tt('docNoText', 'Belge metni okunamadı (parça tablosu yok)'));
  const cpAll = pcs[pcs.length - 1].cp1;
  let ccpText = fib.old ? (fib.ccpText > 0 && fib.ccpText <= cpAll ? fib.ccpText : cpAll) : Math.min(fib.ccpText, cpAll);
  const cpEdn = ccpText + fib.ccpFtn + fib.ccpHdd + fib.ccpMcr + fib.ccpAtn;   // sonnot alt belgesinin başı
  let dec8 = fib.old ? decoderForLid(fib.lid) : dec1252;
  if (fib.old && dec8 === dec1252) {   // dil kimliği Latin derken harflerin çoğu 0xC0 üstündeyse yazı tipi kodlamalı Kiril (windows-1251) sayılır
    let hi = 0, letters = 0;
    for (const pc of pcs) { const a = Math.min(pc.fc, wd.length), e = Math.min(pc.fc + (pc.cp1 - pc.cp0), wd.length); for (let i = a; i < e; i++) { const c = wd[i]; if (c >= 0xC0) { hi++; letters++; } else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) letters++; } }
    if (letters > 40 && hi / letters > 0.6) { try { dec8 = new TextDecoder('windows-1251'); } catch (_) { /* kod sayfası yok */ } }
  }
  const text = decodePieces(pcs, wd, fib.old ? ccpText : Math.min(cpAll, cpEdn + fib.ccpEdn), dec8);
  ccpText = Math.min(ccpText, text.length);
  // --- biçim kaynakları (tablo akışındaki PLC'ler; Word 6/95'te yok) ---
  const plc = (i) => { if (fib.old) return null; const [fc, lcb] = fib.fcl(i); return lcb > 0 && fc + lcb <= tbl.length ? tbl.subarray(fc, fc + lcb) : null; };
  const chpRuns = safe(() => fkpRuns(plc(12), wd, false), []), papRuns = safe(() => fkpRuns(plc(13), wd, true), []);
  const tail = (i) => { if (fib.old) return null; const [fc, lcb] = fib.fcl(i); return lcb > 0 && fc < tbl.length ? tbl.subarray(fc) : null; };   // PlfLst'in LVL'leri lcb'nin DIŞINDA, hemen ardındadır: akış sonuna kadar ver
  const stsh = safe(() => parseStsh(plc(1)), null), lists = safe(() => parseLists(tail(73), tail(74)), null);
  const sects = safe(() => parseSections(plc(6), wd), []), spa = safe(() => parseSpa(plc(40)), []), dgg = safe(() => parseDgg(plc(50)), null);
  const fnPlc = plc(3), enPlc = plc(47), papCtx = { data, depth: 0 };
  const fnRefs = new Set(); { const r = plc(2); if (r) { const n = Math.floor((r.length - 4) / 6); for (let i = 0; i < n; i++) fnRefs.add(u32(r, 4 * i)); } }   // PlcffndRef: dipnot başvurularının CP'leri
  /** Paragrafın listesi: ilfo → LFO → LST → düzey (LFO düzey geçersiz kılmaları dâhil); yoksa null */
  const listCtx = (pap) => {
    if (!lists || pap.ilfo <= 0 || pap.ilfo >= 0xF800 || pap.ilfo > lists.lfos.length) return null;
    const lfo = lists.lfos[pap.ilfo - 1], lst = lists.lsts.get(lfo.lsid); if (!lst || !lst.lvls.length) return null;
    const il = Math.max(0, Math.min(8, pap.ilvl | 0)), lvlOf = (l) => (lfo.ov[l] && lfo.ov[l].lvl) || lst.lvls[l] || lst.lvls[0];
    const startOf = (l) => { const o = lfo.ov[l]; if (o && o.start != null) return o.start; const L = lvlOf(l); return L ? L.start : 1; };
    const lvl = lvlOf(il); return lvl ? { lfo, lst, il, lvlOf, startOf, lvl } : null;
  };
  const lvlOfPap = (pap) => { const c = listCtx(pap); return c ? c.lvl : null; };
  const pieceAt = (cp) => { let lo = 0, hi = pcs.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (pcs[m].cp0 <= cp) lo = m + 1; else hi = m - 1; } return pcs[Math.max(0, hi)]; };
  const fcOf = (pc, cp) => pc.fc + (pc.uni ? 2 : 1) * (cp - pc.cp0);
  const prmOf = (pc) => (pc.prm & 1) ? (prcs[pc.prm >> 1] || null) : null;   // karmaşık prm: CLX'teki Prc grpprl'si (hızlı kaydedilmiş belge)
  // --- stiller: istdBase zinciri boyunca UPX'ler (taban önce) ---
  const styleOf = (istd) => (stsh && stsh.styles[istd]) || null;
  const papCache = new Map(), chpCache = new Map();
  const papOfStyle = (istd, depth = 0) => {
    if (papCache.has(istd)) return papCache.get(istd);
    const st = styleOf(istd); let pap;
    if (!st || depth > 12) pap = PAP0();
    else { pap = clone(st.base !== 0xFFF && st.base !== istd ? papOfStyle(st.base, depth + 1) : PAP0()); if (st.sgc === 1 && st.upx[0] && st.upx[0].length > 2) applyPapx(pap, st.upx[0].subarray(2), papCtx); }
    pap.istd = istd; pap.tdef = null; papCache.set(istd, pap); return pap;
  };
  const chpOfStyle = (istd, depth = 0) => {
    if (chpCache.has(istd)) return chpCache.get(istd);
    const st = styleOf(istd); let chp;
    if (!st || depth > 12) chp = CHP0();
    else { chp = clone(st.base !== 0xFFF && st.base !== istd ? chpOfStyle(st.base, depth + 1) : CHP0()); const ux = st.sgc === 1 ? st.upx[1] : st.sgc === 2 ? st.upx[0] : null; if (ux && ux.length) applyChpx(chp, ux, null); }
    chp.istd = istd; chpCache.set(istd, chp); return chp;
  };
  /** Karakter stili (sprmCIstd): zincirdeki chpx'ler paragraf stilinin üstüne uygulanır */
  const charStyle = (chp, istd) => { const chain = []; for (let i = istd, d = 0; d < 12; d++) { const st = styleOf(i); if (!st || st.sgc !== 2) break; if (st.upx[0] && st.upx[0].length) chain.unshift(st.upx[0]); if (st.base === 0xFFF || st.base === i) break; i = st.base; } for (const g of chain) applyChpx(chp, g, null); };
  const headingOf = (istd) => { const st = styleOf(istd); if (!st) return 0; if (st.sti >= 1 && st.sti <= 9) return st.sti; const m = /^(?:heading|başlık)\s*(\d)$/i.exec(st.name || ''); return m ? +m[1] : 0; };
  // --- paragraf özellikleri: paragraf işaretinin fc'sindeki PAPX (stil → FKP papx → parça prm'si); Word 6/95: 0x07 sezgisi ---
  const papOf = fib.old
    ? (cpMark) => { const pap = PAP0(); if (text.charCodeAt(cpMark) === 7) { pap.inTable = 1; if (cpMark > 0 && text.charCodeAt(cpMark - 1) === 7) pap.ttp = 1; } return pap; }
    : (cpMark) => {
      const pc = pieceAt(cpMark), fc = fcOf(pc, cpMark), ri = runIndex(papRuns, fc), r = ri >= 0 ? papRuns[ri] : null, prm = prmOf(pc);
      const build = (lvlPapx) => { const pap = clone(papOfStyle(r ? r.istd : 0)); pap.tdef = null; if (lvlPapx) applyPapx(pap, lvlPapx, null); if (r) applyPapx(pap, r.g, papCtx); if (prm && prm.length) applyPapx(pap, prm, papCtx); return pap; };
      const pap = build(null), lv = lvlOfPap(pap);   // liste düzeyinin papx'ı (girinti) stil ile paragrafın kendi biçimi arasına girer
      return lv && lv.papx && lv.papx.length ? build(lv.papx) : pap;
    };
  // --- karakter run'ları: paragraf stili chp'si → FKP chpx (karakter stili + run sprm'leri) → parça prm'si ---
  const runsOf = (s, e, istd) => {
    const base = chpOfStyle(istd), ctx = { base: () => base, charStyle }, out = [];
    for (let cp = s; cp < e;) {
      const pc = pieceAt(cp), pcEnd = Math.min(pc.cp1, e), fc = fcOf(pc, cp), w = pc.uni ? 2 : 1;
      let n = Math.max(1, pcEnd - cp), g = null;
      const ri = runIndex(chpRuns, fc);
      if (ri >= 0) { const r = chpRuns[ri]; g = r.g; n = Math.min(n, Math.max(1, Math.floor((r.fc1 - fc) / w))); }
      else { const nx = chpRuns[-ri - 1]; if (nx && nx.fc0 > fc) n = Math.min(n, Math.max(1, Math.floor((nx.fc0 - fc) / w))); }
      const chp = clone(base); if (g && g.length) applyChpx(chp, g, ctx); const prm = prmOf(pc); if (prm && prm.length) applyChpx(chp, prm, ctx);
      out.push({ s: cp, e: cp + n, chp }); cp += n;
    }
    return out;
  };
  // --- resimler ---
  const picCache = new Map(), picPh = () => `<span class="muted">${esc(tt('docPicture', '[Resim]'))}</span>`;
  const imgTag = (src, w) => `<img src="${src}" alt=""${w > 0 ? ` style="width:${r1(w)}pt;max-width:100%"` : ''}>`;
  const picSrc = (fc) => {   // satır içi resim: sprmCPicLocation → Data akışı PICF; çözülemezse null
    if (!(fc >= 0) || fc === NOSTREAM || !data.length) return null;
    if (picCache.has(fc)) return picCache.get(fc);
    let h = null; try { const pic = readPicf(data, fc); if (pic && pic.src) h = imgTag(pic.src, pic.w); } catch (_) { h = null; }
    picCache.set(fc, h); return h;
  };
  const omitted = () => warn(tt('docPicOmitted', 'Bazı resimler gösterilemedi (WMF / EMF / TIFF ya da bozuk veri)'));
  const bseSrc = (bse) => { if (!bse) return null; let r = bse.emb ? findBlip(tbl, bse.emb[0], bse.emb[1], 0) : null; if (!r && bse.foDelay !== NOSTREAM && bse.foDelay + 8 <= wd.length) r = findBlip(wd, bse.foDelay, wd.length, 0); return r && r.src ? r.src : null; };   // gecikmeli akış (foDelay) WordDocument akışıdır
  const floatHtml = (cp) => {   // kayan çizim (0x08): PlcSpaMom çapası → şekil (spid) → BSE (pib) → blip
    if (!dgg || !spa.length) return '';
    const f = spa.find(x => x.cp === cp); if (!f) return '';
    const pib = dgg.spidPib.get(f.spid); if (!pib) return '';
    let src = null; try { src = bseSrc(dgg.bses[pib - 1]); } catch (_) { src = null; }
    if (!src) { omitted(); return picPh(); }
    return imgTag(src, f.w);
  };
  // --- alanlar ve satır içi HTML ---
  const fieldHtml = (f) => {
    const m = /^\s*HYPERLINK\s+(.*)$/i.exec(f.code); if (!m || !f.html) return f.html;
    const arg = m[1]; if (/^\\l\b/i.test(arg)) return f.html;   // belge içi yer imi
    const q = /"([^"]+)"/.exec(arg), url = printable(q ? q[1] : (arg.split(/\s+/)[0] || '')).trim();
    return /^(https?|ftp|mailto):/i.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${f.html}</a>` : f.html;
  };
  let fnCounter = 0, enCounter = 0;
  const inlineHtml = (s, e, pap, inNote) => {
    const stack = [{ html: '', code: '', inCode: false }]; let top = stack[0];
    let seg = '', key = '', st = '', sup = false, sub = false;   // aynı biçimli ardışık run'lar tek span'da toplanır
    const flush = () => { if (seg) { let h = esc(seg); if (sup) h = '<sup>' + h + '</sup>'; else if (sub) h = '<sub>' + h + '</sub>'; top.html += st ? `<span style="${st}">${h}</span>` : h; seg = ''; } };
    const put = (h) => { flush(); top.html += h; };
    for (const r of runsOf(s, e, pap.istd)) {
      const chp = r.chp, sym = chp.sym && chp.spec ? bulletChar(String.fromCharCode(chp.sym)) : '';
      const st2 = chpStyle(chp), sup2 = chp.iss === 1 || (chp.iss === 0 && chp.hpsPos > 0), sub2 = !sup2 && (chp.iss === 2 || (chp.iss === 0 && chp.hpsPos < 0)), key2 = st2 + (sup2 ? '^' : sub2 ? '_' : '');
      if (key2 !== key) { flush(); key = key2; st = st2; sup = sup2; sub = sub2; }
      for (let i = r.s; i < r.e; i++) {
        const c = text.charCodeAt(i);
        if (c === 0x13) { flush(); top = { html: '', code: '', inCode: true }; stack.push(top); continue; }
        if (c === 0x14) { flush(); top.inCode = false; continue; }
        if (c === 0x15) { flush(); if (stack.length > 1) { const f = stack.pop(); top = stack[stack.length - 1]; top.html += fieldHtml(f); } continue; }
        if (top.inCode) { top.code += text[i]; continue; }
        if (chp.vanish || chp.fldVanish) continue;
        if (c >= 0x20) { if (c !== 0x7F) seg += sym || text[i]; continue; }
        switch (c) {
          case 0x09: put('<span class="tab"></span>'); break;
          case 0x0B: put('<br>'); break;
          case 0x0C: put('<div class="pagebreak"></div>'); break;
          case 0x01: if (chp.spec) { const h = picSrc(chp.pic); if (h) put(h); else { put(chp.ole2 || chp.data ? `<span class="muted">${esc(tt('docObject', '[Nesne]'))}</span>` : picPh()); if (!chp.ole2 && !chp.data) omitted(); } } break;
          case 0x02: if (chp.spec && !inNote) put(`<sup>${fnRefs.size && !fnRefs.has(i) ? roman(++enCounter).toLowerCase() : ++fnCounter}</sup>`); break;   // dipnot / sonnot başvurusu
          case 0x08: if (chp.spec) put(floatHtml(i)); break;
          case 0x1E: seg += '-'; break;
          default: break;
        }
      }
    }
    flush();
    while (stack.length > 1) { const f = stack.pop(); stack[stack.length - 1].html += f.html; }   // kapanmamış alan: sonucu düz bas
    return stack[0].html;
  };
  // --- listeler: (lsid, düzey) sayaçları; alt düzeyler üst düzey artınca sıfırlanır ---
  const listState = new Map();
  const listPrefix = (pap) => {
    const L0 = listCtx(pap); if (!L0) return null;
    const { lfo, il, lvlOf, startOf, lvl } = L0;
    let st = listState.get(lfo.lsid); if (!st) { st = { cnt: [], seen: [] }; listState.set(lfo.lsid, st); }
    if (st.seen[il]) st.cnt[il]++; else { st.cnt[il] = startOf(il); st.seen[il] = true; }
    for (let l = il + 1; l < 9; l++) st.seen[l] = false;
    let txt = '';
    if (lvl.nfc === 23) txt = bulletChar(lvl.xst);
    else if (lvl.nfc !== 255) for (const ch of lvl.xst) { const c = ch.charCodeAt(0); if (c <= 8) { const L = lvlOf(c); txt += fmtNum(st.seen[c] ? st.cnt[c] : startOf(c), L ? L.nfc : 0); } else if (c >= 0x20) txt += ch; }
    return { txt, ilvl: il, dxaLeft: lvl.dxaLeft };
  };
  const paraHtml = (s, e, pap, inNote) => {
    const hl = headingOf(pap.istd), tag = hl ? 'h' + Math.min(6, hl) : 'p', style = []; let cls = '', prefix = '';
    if (pap.jc === 1) style.push('text-align:center'); else if (pap.jc === 2) style.push('text-align:right'); else if (pap.jc === 3 || pap.jc === 4) style.push('text-align:justify');
    const li = pap.ilfo > 0 ? listPrefix(pap) : null;
    if (li && li.txt) { cls = 'li'; style.push('margin-left:' + r1(pap.dxaLeft > 0 ? pap.dxaLeft / 20 : li.dxaLeft > 0 ? li.dxaLeft / 20 : 18 + 18 * li.ilvl) + 'pt'); prefix = `<span class="bul">${esc(li.txt)}</span>`; }
    else { if (pap.dxaLeft) style.push('margin-left:' + r1(pap.dxaLeft / 20) + 'pt'); if (pap.dxaLeft1) style.push('text-indent:' + r1(pap.dxaLeft1 / 20) + 'pt'); if (pap.dxaRight > 0) style.push('margin-right:' + r1(pap.dxaRight / 20) + 'pt'); }
    if (pap.dyaBefore) style.push('margin-top:' + r1(pap.dyaBefore / 20) + 'pt'); if (pap.dyaAfter) style.push('margin-bottom:' + r1(pap.dyaAfter / 20) + 'pt');
    const inner = inlineHtml(s, e, pap, inNote);
    return (pap.pbb ? '<div class="pagebreak"></div>' : '') + `<${tag}${cls ? ` class="${cls}"` : ''}${style.length ? ` style="${style.join(';')}"` : ''}>${prefix}${inner || '&nbsp;'}</${tag}>`;
  };
  // --- paragraflar (0x0D / 0x07; bölüm işareti 0x0C), tablolar (itap derinliğiyle iç içe) ---
  const sectEnd = new Map();   // bölüm işareti CP → sonraki bölümün bkc (0 sürekli, 1 sütun, 2+ yeni sayfa)
  for (let i = 0; i + 1 < sects.length; i++) { const nx = sects[i + 1].sep; sectEnd.set(sects[i].cp1 - 1, nx && nx.bkc != null ? nx.bkc : 2); }
  const itemsOf = (a, b, inNote) => {
    const items = []; let s = a;
    const push = (e, term) => {
      const cp = Math.min(e, Math.max(s, text.length - 1)), pap = safe(() => papOf(cp), PAP0());
      const tap = Math.min(8, pap.itap > 0 ? pap.itap : (pap.inTable ? 1 : 0)), rowEnd = !!(pap.ttp || pap.innerTtp), cellEnd = !rowEnd && (term === 7 || !!pap.innerCell);   // iç içe derinlik sınırı: bozuk itap özyinelemeyi taşırmasın
      items.push({ tap, rowEnd, cellEnd, pap, html: rowEnd ? '' : safe(() => paraHtml(s, e, pap, inNote), ''), brk: term === 12 && sectEnd.get(cp) >= 2 });
      s = e + 1;
    };
    for (let i = a; i < b; i++) { const c = text.charCodeAt(i); if (c === 13 || c === 7 || (c === 12 && sectEnd.has(i))) push(i, c); }
    if (s < b) push(b, 13);
    return items;
  };
  const tableHtml = (rows) => {
    rows = rows.filter(r => r.cells.length);
    // ızgara: bütün satırların sütun sınırları (twip, ±10 tolerans) → her hücre kapladığı ızgara sütunu kadar colspan alır (satırlar farklı bölünmüş olsa da hizalanır)
    const grid = []; for (const r of rows) if (r.tdef) for (const x of r.tdef.xs) if (!grid.some(g => Math.abs(g - x) <= 10)) grid.push(x);
    grid.sort((a, b) => a - b);
    const gi = (x) => { for (let i = 0; i < grid.length; i++) if (Math.abs(grid[i] - x) <= 10) return i; return -1; };
    let h = '<table class="docx-tbl">';
    if (grid.length > 1) { h += '<colgroup>'; for (let i = 1; i < grid.length; i++) h += `<col style="width:${r1((grid[i] - grid[i - 1]) / 20)}pt">`; h += '</colgroup>'; }
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri], tcs = row.tdef ? row.tdef.tcs : [], xs = row.tdef ? row.tdef.xs : null;
      h += '<tr>';
      for (let c = 0; c < row.cells.length; c++) {
        const fl = tcs[c] || 0;
        if (((fl & 2) && !(fl & 1)) || ((fl & 0x20) && !(fl & 0x40))) continue;   // yatay / dikey birleştirmenin devamı (TC80 bayrakları)
        let cs = 1; if (fl & 1) while (c + cs < row.cells.length && (tcs[c + cs] & 2) && !(tcs[c + cs] & 1)) cs++;
        let rs = 1; if (fl & 0x40) while (ri + rs < rows.length) { const t2 = rows[ri + rs].tdef ? (rows[ri + rs].tdef.tcs[c] || 0) : 0; if ((t2 & 0x20) && !(t2 & 0x40)) rs++; else break; }
        let span = cs; if (xs && xs.length > c + cs) { const a = gi(xs[c]), b = gi(xs[c + cs]); if (a >= 0 && b > a) span = b - a; }
        h += `<td${span > 1 ? ` colspan="${span}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''}>${row.cells[c] || '&nbsp;'}</td>`;
        c += cs - 1;
      }
      h += '</tr>';
    }
    return h + '</table>';
  };
  const buildTable = (items, i, lvl) => {
    const rows = []; let cur = { cells: [], buf: [], tdef: null };
    while (i < items.length) {
      const it = items[i];
      if (it.tap < lvl) break;
      if (it.tap > lvl) { const r = buildTable(items, i, lvl + 1); cur.buf.push(r.html); i = r.next; continue; }
      i++;
      if (it.rowEnd) { cur.tdef = it.pap.tdef; if (cur.buf.length) { cur.cells.push(cur.buf.join('')); cur.buf = []; } rows.push(cur); cur = { cells: [], buf: [], tdef: null }; continue; }
      cur.buf.push(it.html); if (it.cellEnd) { cur.cells.push(cur.buf.join('')); cur.buf = []; }
    }
    if (cur.buf.length) cur.cells.push(cur.buf.join('')); if (cur.cells.length) rows.push(cur);
    return { html: tableHtml(rows), next: i };
  };
  const buildBlocks = (items) => {
    const parts = [];
    for (let i = 0; i < items.length;) { const it = items[i]; if (it.tap > 0) { const r = buildTable(items, i, 1); parts.push(r.html); i = r.next; } else { if (it.html) parts.push(it.html); if (it.brk) parts.push('<div class="pagebreak"></div>'); i++; } }
    return parts;
  };
  const parts = buildBlocks(itemsOf(0, ccpText, false));
  // --- dipnotlar (PlcffndTxt) ve sonnotlar (PlcfendTxt): CP'ler kendi alt belgelerine göre; her not kendi paragraflarıyla basılır ---
  const notes = (plcTxt, base, ccp, label, numOf) => {
    if (fib.old || !plcTxt || ccp <= 0 || text.length <= base) return;
    const cps = []; for (let i = 0; i < plcTxt.length >> 2; i++) cps.push(u32(plcTxt, 4 * i));
    const out = []; let num = 0;
    for (let i = 0; i + 1 < cps.length; i++) {
      const a = base + cps[i], b = Math.min(text.length, base + Math.min(cps[i + 1], ccp)); if (b - a <= 1 || a >= text.length) continue;
      num++; const blocks = safe(() => buildBlocks(itemsOf(a, b, true)), []);
      if (blocks.length) { blocks[0] = blocks[0].replace(/^(<(?:p|h\d)[^>]*>)/, `$1<sup>${numOf(num)}</sup> `); out.push(...blocks); }
    }
    if (out.length) parts.push(`<p class="muted" style="margin-top:12pt;border-top:1px solid #999;padding-top:4pt">${esc(label)}</p>`, ...out);
  };
  notes(fnPlc, ccpText, fib.ccpFtn, tt('docFootnotes', 'Dipnotlar'), (n) => String(n));
  notes(enPlc, cpEdn, fib.ccpEdn, tt('docEndnotes', 'Sonnotlar'), (n) => roman(n).toLowerCase());
  // --- sayfa: ilk bölümün Sepx'i (twip → pt); sprm yoksa Word varsayılanı Letter 12240 × 15840, kenar 1440 / 1800; bölüm yoksa A4 ---
  const sep = sects.length ? sects[0].sep : null;
  const tw = (v, def, lo, hi) => { const n = v != null && isFinite(v) ? v / 20 : NaN; return n >= lo && n <= hi ? n : def; };
  const page = sep
    ? { width: tw(sep.xaPage, 612, 100, 2000), height: tw(sep.yaPage, 792, 100, 2000), margins: { top: tw(sep.dyaTop, 72, 0, 400), right: tw(sep.dxaRight, 90, 0, 400), bottom: tw(sep.dyaBottom, 72, 0, 400), left: tw(sep.dxaLeft, 90, 0, 400) } }
    : { width: 595, height: 842, margins: { top: 72, right: 72, bottom: 72, left: 72 } };
  if (page.margins.left + page.margins.right >= page.width - 40) { page.margins.left = page.margins.right = 36; }
  if (page.margins.top + page.margins.bottom >= page.height - 40) { page.margins.top = page.margins.bottom = 36; }
  return { parts, html: parts.join(''), width: page.width + 'pt', page, warnings };
}
