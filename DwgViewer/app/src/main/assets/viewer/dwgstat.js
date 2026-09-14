/*
 * DWG ön yoklaması: dosyayı çözümlemeden ÖNCE içindeki nesne sayısını okur.
 *
 * Neden gerekli: LibreDWG her DWG nesnesi için bellekte bir yapı kurar; ölçülen maliyet nesne başına
 * yaklaşık 600 bayttır. WebAssembly 32 bittir, yani yığın hiçbir cihazda 4096 MB'ı geçemez — bu, telefonun
 * belleğiyle ilgili değil, mimarinin mutlak sınırıdır. Birkaç milyon nesneli bir çizim bu tavana çarpar;
 * çarpması da dakikalar sürer. Sayı önceden bilinirse kullanıcı beklemeden uyarılabilir.
 *
 * R13 / R14 / R2000 (AC1012 – AC1015) dosyalarında nesne haritası (bölüm 2) sıkıştırılmamıştır ve
 * doğrudan okunur. R2004 ve sonrasında (AC1018+) haritanın kendisi sıkıştırılmış bölüm sayfalarının
 * içindedir; onlarda sayı okunamaz ve null döner — çağıran taraf bunu "bilinmiyor" saymalıdır.
 */

/** Nesne haritasındaki değerler "modular char": 7 bitlik gruplar, son baytta 0x40 işaret bitidir. */
function modularChar(b, st) {
  let sh = 0, v = 0;
  for (let i = 0; i < 5; i++) {
    if (st.p >= st.end) { st.bad = true; return 0; }
    const c = b[st.p++];
    if (c & 0x80) { v |= (c & 0x7f) << sh; sh += 7; continue; }
    v |= (c & 0x3f) << sh;
    return (c & 0x40) ? -v : v;
  }
  st.bad = true; return 0;
}

/**
 * @param {Uint8Array} u8 dosyanın tamamı
 * @returns {{objects:number, ver:string}|null} okunamıyorsa null
 */
export function dwgObjectCount(u8) {
  if (!u8 || u8.length < 0x100) return null;
  const ver = String.fromCharCode(...u8.slice(0, 6));
  if (!/^AC101[2345]$/.test(ver)) return null;                 // yalnız R13 – R2000
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint32(0x15, true);
  if (!(n >= 1 && n <= 32) || 0x19 + n * 9 > u8.length) return null;
  let seek = 0, size = 0;
  for (let i = 0; i < n; i++) {
    const o = 0x19 + i * 9;
    if (u8[o] === 2) { seek = dv.getUint32(o + 1, true); size = dv.getUint32(o + 5, true); }
  }
  if (!size || seek + size > u8.length) return null;

  const st = { p: seek, end: seek + size, bad: false };
  let objects = 0, pages = 0;
  const stop = seek + size;
  while (st.p + 2 <= stop) {
    const secSize = (u8[st.p] << 8) | u8[st.p + 1];            // sayfa boyutu: büyük uçlu, CRC dahil
    st.p += 2;
    if (secSize <= 2) break;                                    // 2'lik son sayfa: harita bitti
    const end = st.p + secSize - 2;
    if (end > stop || ++pages > 200000) { st.bad = true; break; }
    st.end = end;
    while (st.p < end) {
      modularChar(u8, st); modularChar(u8, st);                 // handle farkı, konum farkı
      if (st.bad) break;
      objects++;
    }
    if (st.bad) break;
    st.p = end + 2;                                             // sayfa CRC'si
    st.end = stop;
  }
  if (st.bad || !objects) return null;
  return { objects, ver };
}
