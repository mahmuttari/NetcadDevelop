/*
 * DOS (OEM) kod sayfaları: tarayıcı TextDecoder'ı ibm857 / ibm850 etiketlerini tanımaz (WHATWG dışı).
 * Tablolar 0x80-0xFF için kod noktası; ilk 128 bayt ASCII. Tanımsız konumlar U+FFFD.
 * Kullanım: dxf.js decodeText, worker.js (LibreDWG sarmalayıcısının TextDecoder çağrıları), docs.js ZIP girdi adları.
 */
export const CP857 = [199,252,233,226,228,224,229,231,234,235,232,239,238,305,196,197,201,230,198,244,246,242,251,249,304,214,220,248,163,216,350,351,225,237,243,250,241,209,286,287,191,174,172,189,188,161,171,187,9617,9618,9619,9474,9508,193,194,192,169,9571,9553,9559,9565,162,165,9488,9492,9524,9516,9500,9472,9532,227,195,9562,9556,9577,9574,9568,9552,9580,164,186,170,202,203,200,65533,205,206,207,9496,9484,9608,9604,166,204,9600,211,223,212,210,245,213,181,65533,215,218,219,217,236,255,175,180,173,177,65533,190,182,167,247,184,176,168,183,185,179,178,9632,160];
export const CP850 = [199,252,233,226,228,224,229,231,234,235,232,239,238,236,196,197,201,230,198,244,246,242,251,249,255,214,220,248,163,216,215,402,225,237,243,250,241,209,170,186,191,174,172,189,188,161,171,187,9617,9618,9619,9474,9508,193,194,192,169,9571,9553,9559,9565,162,165,9488,9492,9524,9516,9500,9472,9532,227,195,9562,9556,9577,9574,9568,9552,9580,164,240,208,202,203,200,305,205,206,207,9496,9484,9608,9604,166,204,9600,211,223,212,210,245,213,181,254,222,218,219,217,253,221,175,180,173,177,8215,190,182,167,247,184,176,168,183,185,179,178,9632,160];
/** etiket → tablo (küçük harf, WHATWG'de olmayan OEM adları) */
export const OEM_TABLES = { ibm857: CP857, cp857: CP857, 'dos-857': CP857, ibm850: CP850, cp850: CP850, 'dos-850': CP850 };

/** baytları verilen 0x80-0xFF tablosuyla çözer (ArrayBuffer, Uint8Array ya da başka görünüm) */
export function decodeCp(input, table) {
  const u = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(0);
  let out = '';
  const CH = 8192, buf = new Array(CH);
  for (let i = 0; i < u.length; i += CH) {
    const n = Math.min(CH, u.length - i);
    for (let k = 0; k < n; k++) { const b = u[i + k]; buf[k] = b < 128 ? b : table[b - 128]; }
    out += String.fromCharCode.apply(null, n === CH ? buf : buf.slice(0, n));
  }
  return out;
}

/** etikete göre çözücü: OEM tablosu varsa decodeCp, yoksa yerel TextDecoder */
export function decoderFor(label, opts) {
  const key = String(label || 'utf-8').trim().toLowerCase();
  const tbl = OEM_TABLES[key];
  if (tbl) return { encoding: key, decode: (b) => decodeCp(b, tbl) };
  return new NativeTextDecoder(label, opts);
}

const NativeTextDecoder = globalThis.TextDecoder;

/**
 * Genel TextDecoder'ı OEM etiketlerini de tanıyan bir sarmalayıcıyla değiştirir; öteki etiketler yerel sınıfa gider.
 * LibreDWG sarmalayıcısı convert() sırasında `new TextDecoder(encoding)` çağırdığı için işçide bir kez kurulur.
 */
export function installTextDecoder(g = globalThis) {
  if (!g.TextDecoder || g.TextDecoder.__oem) return;
  const Native = g.TextDecoder;
  class OemTextDecoder {
    constructor(label = 'utf-8', opts) {
      const key = String(label).trim().toLowerCase();
      const tbl = OEM_TABLES[key];
      if (tbl) { this.encoding = key; this._tbl = tbl; this.fatal = !!(opts && opts.fatal); this.ignoreBOM = !!(opts && opts.ignoreBOM); }
      else { this._d = new Native(label, opts); this.encoding = this._d.encoding; this.fatal = this._d.fatal; this.ignoreBOM = this._d.ignoreBOM; }
    }
    decode(input, opts) { return this._tbl ? decodeCp(input == null ? new Uint8Array(0) : input, this._tbl) : this._d.decode(input, opts); }
  }
  OemTextDecoder.__oem = true;
  g.TextDecoder = OemTextDecoder;
}
