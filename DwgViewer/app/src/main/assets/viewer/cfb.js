/*
 * OLE BİLEŞİK DOSYA (CFB — Compound File Binary, "OLE2 kapsayıcısı").
 *
 * Microsoft'un 97-2003 ikili biçimlerinin ortak kabuğudur: tek bir dosyanın içinde adları
 * olan akışlar (stream) ve klasörler (storage) taşır — dosya içinde küçük bir dosya sistemi.
 * Word 97-2003 (.doc) "WordDocument" akışını, Excel 97-2003 (.xls) "Workbook" akışını buraya
 * koyar. İki okuyucu aynı kabuğu paylaşsın diye bu sınıf doc.js'ten ayrıldı (v7.90): tek
 * uygulama, tek yerde düzeltilen kusur.
 *
 * YAPI. Başlık (512 bayt) → DIFAT → FAT (sektör zincirleri) → dizin ağacı → akışlar. Küçük
 * akışlar (eşiğin altında, genelde 4096 bayt) ayrı bir "mini akış"ta ve miniFAT zinciriyle
 * durur; büyükler doğrudan sektörlerdedir.
 *
 * DAYANIKLILIK. Kısaltılmış (truncated) dosya sahada sık görülür — bulutta yarım inen ek,
 * kopyalanırken kesilen dosya. Zincirler dosyada GERÇEKTEN var olan sektör sayısıyla
 * sınırlanır ve her döngüde bir sayaç korur; bozuk bir zincir sonsuz döngüye girmez, eksik
 * kısım sıfır olarak okunur.
 */
const u16 = (b, p) => (p >= 0 && p + 2 <= b.length ? b[p] | (b[p + 1] << 8) : 0);
const u32 = (b, p) => (p >= 0 && p + 4 <= b.length ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : 0);
const NOSEC = 0xFFFFFFFA;      // bu ve üstü özel sektör değerleri (DIFSECT, FATSECT, ENDOFCHAIN, FREESECT)
const NOSTREAM = 0xFFFFFFFF;

export class Cfb {
  /** opts.yokIleti: başlık uymazsa atılacak hata metni (çağıran biçimin diliyle konuşur) */
  constructor(buf, opts = {}) {
    const b = this.b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (b.length < 512 || u32(b, 0) !== 0xE011CFD0 || u32(b, 4) !== 0xE11AB1A1) throw new Error(opts.yokIleti || 'OLE bileşik dosya başlığı yok');
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
    // yalnız kök düzeyindeki girdiler (gömülü nesnelerin kendi akışları karışmasın): kırmızı-kara ağaç dolaşımı
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
  /** Kök düzeyindeki akış adları (hangi biçim olduğunu anlamak için) */
  adlar() { return [...this.root.keys()]; }
}
/** İlk bulunan akışı döndürür (ad sırasına göre denenir) */
export function ilkAkis(cfb, adlar) {
  for (const a of adlar) { const s = cfb.stream(a); if (s) return { ad: a, veri: s }; }
  return null;
}
