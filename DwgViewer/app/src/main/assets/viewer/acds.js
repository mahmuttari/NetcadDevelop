/*
 * AcDs veri deposu okuyucu (R2013+ DWG): 3DSOLID / REGION / BODY varlıklarının ASM (ACIS) ikili
 * verisi 2013 ve sonrası dosyalarda varlığın içinde değil, "AcDb:AcDsPrototype_1b" bölümündedir.
 * LibreDWG bu bölümü her sürümde katılara bağlayamadığından (2018 dosyalarında boş kalır) bölüm burada
 * dosya baytlarından doğrudan okunur.
 *
 * Yalnız R2004 dosya biçimi ailesi (AC1018, AC1024, AC1027, AC1032) desteklenir; R2007 (AC1021) bölüm
 * yerleşimi farklıdır (Reed-Solomon) ve null döner.
 *
 * Kaynak: LibreDWG decode.c (decrypt_R2004_header, read_R2004_section_map, read_R2004_section_info,
 * read_2004_compressed_section, decompress_R2004_section) ve acds.spec; ODA DWG belirtimi bölüm 4/24.
 */

const SECTION_PAGE_MAP = 0x41630e3b, SECTION_INFO = 0x4163003b, SECTION_PAGE = 0x4163043b;
const ACDS_NAME = 'AcDb:AcDsPrototype_1b';

/** R2004 dosya başlığı (0x80'den itibaren) — sözde rastgele XOR ile şifrelidir */
function decryptHeader(u8, at, size) {
  const out = new Uint8Array(size);
  let seed = 1;
  for (let i = 0; i < size; i++) { seed = (Math.imul(seed, 0x343fd) + 0x269ec3) >>> 0; out[i] = u8[at + i] ^ ((seed >>> 16) & 0xff); }
  return out;
}
const rl = (u8, o) => (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
const rs = (u8, o) => (u8[o] | (u8[o + 1] << 8)) >>> 0;
const rll = (u8, o) => rl(u8, o) + rl(u8, o + 4) * 4294967296;
const rlSigned = (u8, o) => (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24));

/**
 * R2004 LZ77 türevi açma. src[sp..sEnd) → dst[dp..) ; dst tamamı geri başvuru için kullanılabilir.
 * decompress_R2004_section'ın birebir karşılığıdır.
 */
export function decompressR2004(src, sp, sEnd, dst, dp, dEnd) {
  let pos = sp, d = dp;
  const rc = () => (pos < sEnd ? src[pos++] : 0);
  const litLen = (op) => { let low = op & 0xf; if (low === 0) { let last = 0; while ((last = rc()) === 0 && pos < sEnd) low += 0xff; low += 0xf + last; } return low + 3; };
  const compBytes = (op, bits) => { let n = op & bits; if (n === 0) { let last = 0; while ((last = rc()) === 0 && pos < sEnd) n += 0xff; n += last + bits; } return n + 2; };
  const copy = (n) => { for (let i = 0; i < n; i++) { const b = rc(); if (d < dEnd) dst[d++] = b; } return rc(); };
  let op1 = rc();
  if ((op1 & 0xf0) === 0) op1 = copy(litLen(op1));
  while (pos < sEnd && d < dEnd && op1 !== 0x11) {
    let cb = 0, co = 0;
    if (op1 < 0x10 || op1 >= 0x40) { cb = (op1 >> 4) - 1; const op2 = rc(); co = (((op1 >> 2) & 3) | (op2 << 2)) + 1; }
    else if (op1 < 0x20) { cb = compBytes(op1, 7); co = (op1 & 8) << 11; const b1 = rc(), b2 = rc(); co |= (b1 >> 2); co |= (b2 << 6); co += 0x4000; op1 = b1; }
    else { cb = compBytes(op1, 0x1f); const b1 = rc(), b2 = rc(); co |= (b1 >> 2); co |= (b2 << 6); co += 1; op1 = b1; }
    const end = d + cb;
    if (end > dEnd || d - co < 0 || co > dEnd) throw new Error('R2004 açma: geçersiz geri başvuru');
    for (; d < end; d++) dst[d] = dst[d - co];
    let ll = op1 & 3;
    if (ll === 0) { op1 = rc(); if ((op1 & 0xf0) === 0) ll = litLen(op1); }
    if (ll && end + ll <= dEnd) op1 = copy(ll);
    else if (ll) break;
  }
  return d;
}

/** sürüm damgası: 'AC1018' vb. */
export function dwgVersion(u8) { return String.fromCharCode(...u8.subarray(0, 6)); }
export function isR2004Family(u8) { const v = dwgVersion(u8); return v === 'AC1018' || v === 'AC1024' || v === 'AC1027' || v === 'AC1032'; }

/** dosyadaki bölümleri çözer: { pageMap:Map(number→{address,size}), infos:[{name,size,numSections,maxDecomp,compressed,type,pages:[{number,size,address}]}] } */
export function readSections(u8) {
  if (!isR2004Family(u8)) return null;
  if (u8.length < 0x80 + 0x6c + 0x20) return null;
  const h = decryptHeader(u8, 0x80, 0x6c);
  if (String.fromCharCode(...h.subarray(0, 8)) !== 'AcFssFcA') throw new Error('R2004 başlık çözülemedi');
  const sectionMapAddress = rll(h, 0x54), sectionInfoId = rlSigned(h, 0x5c), sectionArraySize = rlSigned(h, 0x60);
  // ---- bölüm sayfa haritası (sistem bölümü) ----
  let start = sectionMapAddress + 0x100;
  if (start + 0x14 > u8.length) throw new Error('bölüm haritası dosya dışında');
  if (rl(u8, start) !== SECTION_PAGE_MAP) throw new Error('bölüm haritası imzası yanlış');
  const decompSize = rl(u8, start + 4), compSize = rl(u8, start + 8);
  if (decompSize > 0x4000000) throw new Error('bölüm haritası çok büyük');
  const map = new Uint8Array(decompSize + 1024);
  decompressR2004(u8, start + 0x14, Math.min(u8.length, start + 0x14 + compSize), map, 0, decompSize);
  const pageMap = new Map();
  let addr = 0x100, p = 0, remaining = decompSize;
  while (remaining >= 8) {
    const number = rlSigned(map, p), size = rl(map, p + 4); p += 8; remaining -= 8;
    pageMap.set(number, { address: addr, size });
    if (number <= sectionArraySize) addr += size;
    if (remaining >= 16 && number < 0) { p += 16; remaining -= 16; }
  }
  // ---- bölüm bilgisi (veri bölümü haritası) ----
  const infoSec = pageMap.get(sectionInfoId);
  if (!infoSec) throw new Error('bölüm bilgisi bulunamadı');
  const ia = infoSec.address;
  if (ia + 0x14 > u8.length || rl(u8, ia) !== SECTION_INFO) throw new Error('bölüm bilgisi imzası yanlış');
  const iDecomp = rl(u8, ia + 4), iComp = rl(u8, ia + 8);
  if (iDecomp > 0x4000000) throw new Error('bölüm bilgisi çok büyük');
  const inf = new Uint8Array(iDecomp + 1024);
  decompressR2004(u8, ia + 0x14, Math.min(u8.length, ia + 0x14 + iComp), inf, 0, iDecomp);
  const numDesc = rl(inf, 0);
  const infos = [];
  let q = 20;
  for (let i = 0; i < numDesc; i++) {
    if (q + 8 + 24 + 64 > iDecomp) break;
    const size = rll(inf, q), numSections = rl(inf, q + 8), maxDecomp = rl(inf, q + 12), compressed = rl(inf, q + 20), type = rl(inf, q + 24);
    let name = ''; for (let k = 0; k < 64; k++) { const c = inf[q + 32 + k]; if (!c) break; name += String.fromCharCode(c); }
    q += 96;
    const pages = [];
    if (numSections < 1000000) {
      for (let j = 0; j < numSections; j++) {
        if (q + 16 > iDecomp) break;
        pages.push({ number: rlSigned(inf, q), size: rl(inf, q + 4), address: rll(inf, q + 8) });
        q += 16;
      }
    }
    infos.push({ name, size, numSections, maxDecomp, compressed, type, pages });
  }
  return { pageMap, infos, version: dwgVersion(u8) };
}

/** adı verilen veri bölümünün açılmış içeriği (Uint8Array) ya da null */
export function readSection(u8, secs, name) {
  const info = secs.infos.find(s => s.name === name);
  if (!info || !info.numSections || !info.size) return null;
  const total = info.numSections * info.maxDecomp;
  if (!total || total > 0x2f000000) return null;
  const dec = new Uint8Array(total);
  for (const pg of info.pages) {
    if (pg.number < 0) continue;
    const sec = secs.pageMap.get(pg.number); if (!sec) continue;
    const address = sec.address;
    if (address + 32 > u8.length) continue;
    const mask = (0x4164536b ^ address) >>> 0;
    const hdr = new Uint32Array(8);
    for (let k = 0; k < 8; k++) hdr[k] = (rl(u8, address + k * 4) ^ mask) >>> 0;
    const dataSize = hdr[2], pageSize = hdr[3], startOff = hdr[4];
    if (hdr[0] !== SECTION_PAGE) { /* imza uyuşmuyor; yine de dene */ }
    if (info.compressed === 2) {
      if (startOff > total || startOff + info.maxDecomp > total) continue;
      try { decompressR2004(u8, address + 32, Math.min(u8.length, address + 32 + dataSize), dec, startOff, total); } catch (_) { /* sayfa bozuk */ }
    } else {
      const size = Math.min(info.size - startOff, pageSize);
      if (startOff + size > total || address + 32 + size > u8.length || size < 0) continue;
      dec.set(u8.subarray(address + 32, address + 32 + size), startOff);
    }
  }
  return dec.subarray(0, Math.min(info.size, total));
}

/** AcDs bölümü: ham açılmış bayt dizisi ya da null */
export function readAcDs(u8) {
  const secs = readSections(u8);
  if (!secs) return null;
  return readSection(u8, secs, ACDS_NAME);
}

const enc = (s) => Uint8Array.from(s, c => c.charCodeAt(0));
const ACIS_START = enc('ACIS BinaryFile'), ASM_START = enc('ASM BinaryFile');
const ASM_END = enc('\x0e\x03End\x0e\x02of\x0e\x03ASM\x0d\x04data');
function indexOf(hay, needle, from) {
  outer: for (let i = from; i + needle.length <= hay.length; i++) { for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer; return i; }
  return -1;
}

/**
 * AcDs içindeki bütün ASM/ACIS ikili bloklarını sırayla bulur.
 * Dönen: [{ offset, data:Uint8Array }] — sıra, dosyadaki kayıt sırasıdır.
 */
export function findAsmBlobs(ds) {
  const out = [];
  if (!ds) return out;
  let i = 0;
  while (i < ds.length) {
    let s = indexOf(ds, ACIS_START, i); let s2 = indexOf(ds, ASM_START, i);
    if (s < 0 || (s2 >= 0 && s2 < s)) s = s2;
    if (s < 0) break;
    const e = indexOf(ds, ASM_END, s);
    if (e < 0) { i = s + 20; continue; }
    const end = e + ASM_END.length;
    out.push({ offset: s, data: ds.slice(s, end) });
    i = end;
  }
  return out;
}

/**
 * AcDs veri kayıtları (ODA belirtimi 24.2.2.2 / 24.2.2.3): her kayıt bir varlık tanıtıcısına bağlıdır.
 * Dönen: [{ handle:string(hex), data:Uint8Array|null, dataSize }] — çözülemezse [].
 */
export function readAcDsRecords(ds) {
  const out = [];
  try {
    if (!ds || ds.length < 56) return out;
    const segidxOffset = rl(ds, 24), numSegidx = rl(ds, 32), datidxSeg = rl(ds, 40);
    if (segidxOffset + 48 + numSegidx * 12 > ds.length || numSegidx > 100000) return out;
    const segs = [];
    let p = segidxOffset + 48;
    for (let i = 0; i < numSegidx; i++, p += 12) segs.push({ i, offset: rll(ds, p), size: rl(ds, p + 4) });
    for (const s of segs) {
      const o = s.offset; if (!o || o + 48 > ds.length) { s.offset = 0; continue; }
      if (rs(ds, o) !== 0xd5ac) { s.offset = 0; continue; }
      s.name = String.fromCharCode(ds[o + 2], ds[o + 3], ds[o + 4], ds[o + 5], ds[o + 6], ds[o + 7]);
      s.segsize = rl(ds, o + 16); s.objAlign = rl(ds, o + 36);
    }
    const di = segs[datidxSeg] && segs[datidxSeg].name === 'datidx' ? segs[datidxSeg] : segs.find(s => s.name === 'datidx');
    if (!di) return out;
    let q = di.offset + 48;
    const numEntries = rl(ds, q); q += 8;
    if (numEntries > 1000000) return out;
    const groups = new Map();
    for (let i = 0; i < numEntries && q + 12 <= ds.length; i++, q += 12) {
      const e = { segidx: rl(ds, q), offset: rl(ds, q + 4), schidx: rl(ds, q + 8) };
      if (!e.segidx) continue;                       // 0: boş giriş
      if (!groups.has(e.segidx)) groups.set(e.segidx, []);
      groups.get(e.segidx).push(e);
    }
    // sayfalı büyük veri (blob01 dilimleri)
    const blobPages = (recPos) => {
      const pageCount = rl(ds, recPos + 12);
      if (pageCount > 100000) return null;
      const parts = []; let total = 0;
      for (let k = 0; k < pageCount; k++) {
        const segIdx = rl(ds, recPos + 36 + k * 8), bs = segs[segIdx];
        if (!bs || !bs.offset) return null;
        const b = bs.offset + 48, n = rll(ds, b + 24);
        if (n > ds.length || b + 32 + n > ds.length) return null;
        parts.push(ds.subarray(b + 32, b + 32 + n)); total += n;
      }
      const all = new Uint8Array(total); let w = 0;
      for (const part of parts) { all.set(part, w); w += part.length; }
      return all;
    };
    for (const [segIdx, ents] of groups) {
      const seg = segs[segIdx]; if (!seg || !seg.offset || seg.name !== '_data_') continue;
      const base = seg.offset + 48, segEnd = Math.min(ds.length, seg.offset + (seg.segsize || 0) || ds.length);
      const hdrs = [];
      for (const e of ents) { const h = base + e.offset; if (h + 20 > ds.length) continue; hdrs.push({ handle: rll(ds, h + 8), off: rl(ds, h + 16), end: h + 20 }); }
      if (!hdrs.length) continue;
      // veri başlangıcı: nesne verisi hizalama ofseti (<<4) — yoksa başlık listesinin sonu
      const marker = seg.objAlign ? seg.offset + (seg.objAlign << 4) : Math.max(...hdrs.map(h => h.end));
      hdrs.sort((a, b) => a.off - b.off);
      for (let k = 0; k < hdrs.length; k++) {
        const h = hdrs[k], recPos = marker + h.off;
        if (recPos + 4 > ds.length) continue;
        const next = k + 1 < hdrs.length ? marker + hdrs[k + 1].off : segEnd;
        const maxRec = next - recPos, dataSize = rl(ds, recPos);
        let data = null;
        if (dataSize + 4 <= maxRec && recPos + 4 + dataSize <= ds.length) data = ds.subarray(recPos + 4, recPos + 4 + dataSize);
        else if (dataSize === 0xbb106bb1) data = blobPages(recPos);
        out.push({ handle: h.handle.toString(16).toUpperCase(), data, dataSize: data ? data.length : 0, offset: recPos });
      }
    }
  } catch (_) { return []; }
  return out;
}

const isAsm = (d) => d && d.length > 15 && ((d[0] === 0x41 && d[1] === 0x43 && d[2] === 0x49 && d[3] === 0x53) || (d[0] === 0x41 && d[1] === 0x53 && d[2] === 0x4d)) && indexOf(d, enc('BinaryFile'), 0) >= 0 && indexOf(d, enc('BinaryFile'), 0) < 8;

/**
 * ASM/ACIS bloklarını tanıtıcılara bağlar: { byHandle:{hex→Uint8Array}, blobs:[...] }.
 * Kayıt dizini çözülebildiyse ondan; çözülemediyse tarama sonuçları yalnız `blobs` içinde döner ve
 * çağıran sıra eşlemesine düşer.
 */
export function mapAsmToHandles(ds) {
  const byHandle = {};
  const records = readAcDsRecords(ds);
  for (const r of records) if (r.data && isAsm(r.data) && !byHandle[r.handle]) byHandle[r.handle] = r.data;
  const blobs = Object.keys(byHandle).length ? [] : findAsmBlobs(ds);
  return { blobs, records, byHandle };
}
