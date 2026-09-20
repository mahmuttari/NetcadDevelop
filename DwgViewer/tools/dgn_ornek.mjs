// DGN (ISFF / V7) örnek dosya yazıcısı — SINAMA YARDIMCISI, uygulamaya girmez.
// Elemanlar bayt bayt kurulur; okuyucu (viewer/dgn.js) ile aynı belirtimden beslenir.
// Kullanan: tools/test_dgn.mjs (çözümleyici), tools/test_dgn_acma.mjs (uçtan uca açma).

/* ================= ISFF yazıcısı ================= */

/** DGN 32 bit tamsayı: yüksek söz önce, her söz küçük uçlu */
export function putI32(b, o, v) {
  v = v | 0;
  b[o + 2] = v & 0xff; b[o + 3] = (v >>> 8) & 0xff; b[o] = (v >>> 16) & 0xff; b[o + 1] = (v >>> 24) & 0xff;
}
export const putU16 = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; };

const _dv = new DataView(new ArrayBuffer(8));
/** IEEE 754 double → VAX/Intergraph F_floating (GDAL CPLIEEEToVaxDouble) */
export function putVax(b, o, x) {
  _dv.setFloat64(0, x, true);
  let hi = _dv.getUint32(4, true), lo = _dv.getUint32(0, true);
  const isaret = hi & 0x80000000;
  let us = (hi >>> 20) & 0x7ff;
  if (us) us = us - 1023 + 129;
  if (us <= 0) { for (let i = 0; i < 8; i++) b[o + i] = 0; return; }
  const nhi = ((((hi << 3) | (lo >>> 29)) & 0x007fffff) | (us << 23) | isaret) >>> 0;
  const nlo = (lo << 3) >>> 0;
  b[o + 0] = (nhi >>> 16) & 0xff; b[o + 1] = (nhi >>> 24) & 0xff;
  b[o + 2] = nhi & 0xff; b[o + 3] = (nhi >>> 8) & 0xff;
  b[o + 4] = (nlo >>> 16) & 0xff; b[o + 5] = (nlo >>> 24) & 0xff;
  b[o + 6] = nlo & 0xff; b[o + 7] = (nlo >>> 8) & 0xff;
}

/** Eleman iskeleti: 4 baytlık başlık + söz sayısı */
export function elem(seviye, tur, boy, { karmasik = false } = {}) {
  if (boy % 2) throw new Error('eleman boyu çift olmalı');
  const b = new Uint8Array(boy);
  b[0] = (seviye & 0x3f) | (karmasik ? 0x80 : 0);
  b[1] = tur & 0x7f;
  putU16(b, 2, (boy - 4) / 2);
  return b;
}
/** Görüntü başlığı: renk, stil, kalınlık ve (varsa) öznitelik bloğunun yeri */
export function disp(b, { renk = 0, stil = 0, agirlik = 0, oznBas = 0 } = {}) {
  putU16(b, 28, 0);
  putU16(b, 30, oznBas ? (oznBas - 32) / 2 : (b.length - 32) / 2);
  putU16(b, 32, oznBas ? 0x0800 : 0);
  b[34] = (stil & 0x7) | ((agirlik & 0x1f) << 3);
  b[35] = renk & 0xff;
  return b;
}

export const UOR_ALT = 10, ALT_ANA = 1000;      // 1 m = 1000 mm, 1 mm = 10 UOR → 10.000 UOR/m
export const U = (m) => Math.round(m * UOR_ALT * ALT_ANA);

export function tcb(bOyut3) {
  const b = elem(8, 9, 1536);
  if (bOyut3) b[0] = 0xc8;               // 3B dosyanın ilk baytı tam olarak 0xC8'dir (GDAL DGNTestOpen)
  if (bOyut3) b[1214] |= 0x40;
  putI32(b, 1112, ALT_ANA);
  putI32(b, 1116, UOR_ALT);
  b[1120] = 109; b[1121] = 32;           // "m "
  b[1122] = 109; b[1123] = 109;          // "mm"
  putVax(b, 1240, 0); putVax(b, 1248, 0); putVax(b, 1256, 0);
  return b;
}

/** Renk tablosu: tür 5, seviye 1 */
export function renkTablosu(renkler) {
  const b = elem(1, 5, 808);
  disp(b, {});
  b[38] = 0; b[39] = 0; b[40] = 0;                       // 255 = siyah
  for (const [i, [r, g, bl]] of Object.entries(renkler)) { const o = 41 + Number(i) * 3; b[o] = r; b[o + 1] = g; b[o + 2] = bl; }
  return b;
}

export function cizgi(sev, renk, x0, y0, x1, y1, o = {}) {
  const b = elem(sev, 3, 56, o); disp(b, { renk, ...o });
  putI32(b, 36, U(x0)); putI32(b, 40, U(y0)); putI32(b, 44, U(x1)); putI32(b, 48, U(y1));
  return b;
}

export function cokgen(sev, tur, renk, pts, o = {}) {
  const veri = 38 + pts.length * 8;
  const oznVeri = o.dolgu != null ? 16 : 0;
  const boy = (veri + oznVeri + 1) & ~1;
  const b = elem(sev, tur, boy, o);
  disp(b, { renk, stil: o.stil || 0, oznBas: oznVeri ? ((veri + 1) & ~1) : 0 });
  putU16(b, 36, pts.length);
  pts.forEach(([x, y], i) => { putI32(b, 38 + i * 8, U(x)); putI32(b, 42 + i * 8, U(y)); });
  if (oznVeri) {
    const a = (veri + 1) & ~1;
    b[a] = 7; b[a + 1] = 0x10;              // boy = 7*2+2 = 16, "uzunluk birinci baytta" biti
    b[a + 2] = 0x41; b[a + 3] = 0x00;       // DGNLT_SHAPE_FILL
    b[a + 8] = o.dolgu & 0xff;
  }
  return b;
}

/** ELLIPSE (15): birincil / ikincil yarı eksen (UOR, VAX çift), dönme, merkez */
export function elips(sev, renk, cx, cy, ra, rb, donDer) {
  const b = elem(sev, 15, 72); disp(b, { renk });
  putVax(b, 36, U(ra)); putVax(b, 44, U(rb));
  putI32(b, 52, Math.round(donDer * 360000));
  putVax(b, 56, U(cx)); putVax(b, 64, U(cy));
  return b;
}

/** ARC (16): başlangıç açısı ve süpürme (derece × 360000) */
export function yay(sev, renk, cx, cy, ra, rb, donDer, basDer, supDer) {
  const b = elem(sev, 16, 80); disp(b, { renk });
  putI32(b, 36, Math.round(basDer * 360000));
  const s = Math.round(Math.abs(supDer) * 360000);
  putI32(b, 40, s);
  if (supDer < 0) b[41] |= 0x80;
  putVax(b, 44, U(ra)); putVax(b, 52, U(rb));
  putI32(b, 60, Math.round(donDer * 360000));
  putVax(b, 64, U(cx)); putVax(b, 72, U(cy));
  return b;
}

/** TEXT (17): yükseklik ve genişlik "× ölçek × 6/1000" kuruluşundadır */
export function yazi(sev, renk, x, y, hMetre, wMetre, donDer, hizala, baytlar) {
  const boy = (60 + baytlar.length + 1) & ~1;
  const b = elem(sev, 17, boy); disp(b, { renk });
  b[36] = 1; b[37] = hizala;
  putI32(b, 38, Math.round(wMetre * 1000 / 6 / (1 / (UOR_ALT * ALT_ANA))));
  putI32(b, 42, Math.round(hMetre * 1000 / 6 / (1 / (UOR_ALT * ALT_ANA))));
  putI32(b, 46, Math.round(donDer * 360000));
  putI32(b, 50, U(x)); putI32(b, 54, U(y));
  b[58] = baytlar.length;
  b.set(baytlar, 60);
  return b;
}

export function kapsayici(sev, tur, boy = 92) { const b = elem(sev, tur, boy); disp(b, {}); return b; }

export function bsplineBaslik(sev, derece, kutupSay, dugumSay) {
  const b = elem(sev, 27, 48); disp(b, {});
  b[40] = (derece - 1) & 0x0f;                 // order = derece + 1
  putU16(b, 42, kutupSay); putU16(b, 44, dugumSay);
  return b;
}
export function dugumler(sev, deger) {
  const boy = 36 + deger.length * 4;
  const b = elem(sev, 26, boy, { karmasik: true });
  putU16(b, 30, (boy - 32) / 2); putU16(b, 32, 0);
  b[0] |= 0x80;
  deger.forEach((v, i) => putI32(b, 36 + i * 4, Math.round(v * 2147483647)));
  return b;
}

export function dosya(elemanlar) {
  let boy = 2; for (const e of elemanlar) boy += e.length;
  const u = new Uint8Array(boy);
  let o = 0; for (const e of elemanlar) { u.set(e, o); o += e.length; }
  u[o] = 0xff; u[o + 1] = 0xff;
  return u;
}


/** Sınamalarda kullanılan küçük örnek: renk tablosu + çizgi, çokgen, dolu şekil, daire, yay, yazı */
export function ornekDgn() {
  const RENK = { 0: [255, 255, 255], 1: [255, 0, 0], 2: [0, 170, 0], 3: [0, 0, 255], 4: [255, 255, 0] };
  const metin = new Uint8Array([0xc7, 0xdd, 0x5a, 0xdd, 0x4d]);   // "ÇİZİM" — windows-1254
  return dosya([
    tcb(false),
    renkTablosu(RENK),
    cizgi(1, 1, 0, 0, 5, 2),
    cokgen(2, 4, 2, [[0, 0], [1, 0], [1, 1], [0, 1]], { stil: 2 }),
    cokgen(3, 6, 3, [[10, 10], [14, 10], [14, 13], [10, 13], [10, 10]], { dolgu: 4 }),
    elips(4, 1, 20, 20, 3, 3, 0),
    yay(5, 3, 40, 40, 5, 5, 0, 0, 90),
    yazi(6, 1, 2, 3, 0.5, 0.25, 15, 7, metin),
  ]);
}
