/*
 * Çözümleme işçisi: DWG (LibreDWG WebAssembly) ya da DXF (dxf.js) → sahne.
 * Ana iş parçacığı bloke olmaz; ilerleme iletileri gönderilir.
 *
 * İstek : { id, cmd:'parse', bytes:ArrayBuffer, name }               → { id, ok, scene }
 *         { id, cmd:'xref',  bytes, name, inserts:[{m,layer,color}], prefix } → { id, ok, xref:{prims,layers,ltypes,ext} }
 * İlerleme: { id, stage:'lib'|'parse'|'scene', pct? }   (pct: DXF okuma ve sahne kurma yüzdesi)
 */
import * as LW from './lib/dist/libredwg-web.js';
const { LibreDwg } = LW;
import { SceneBuilder } from './scene.js';
import { parseDxf, isDxf } from './dxf.js';
import { readAcDs, mapAsmToHandles, isR2004Family } from './acds.js';
import { installTextDecoder } from './codepage.js';
import * as Win from './dwgwin.js';

installTextDecoder(self);   // DOS857/DOS850: sarmalayıcı convert() sırasında new TextDecoder(encoding) çağırır, tarayıcı bu etiketleri tanımaz

let lib = null;
const msgOf = (e) => (e == null ? '' : String(e.message || e));   // null/undefined: boş dize (ileti sonuna '[null]' eklenmesin)
/** Emscripten abort / bellek hatası: modül bir daha kullanılamaz, lib sıfırlanıp yeniden kurulur */
const isAbort = (e) => (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) || /abort|unreachable|memory access|out of memory|RangeError|WebAssembly\.Memory/i.test(msgOf(e));
const isMem = (e) => /memory|bellek|OUTOFMEM|RangeError/i.test(msgOf(e));
/*
 * Bu ortamda ayrılabilen en büyük wasm belleği (MB). Çözümleyicinin kendi yığınını okumak mümkün değil:
 * libredwg-web glue'sunda HEAPU8 ve wasmMemory yerel değişkendir, Module üzerinde dışa aktarılmaz.
 * Onun yerine BAĞIMSIZ bir WebAssembly.Memory ile tavan aranır — asıl merak edilen sayı da budur:
 * WebView'ın bu cihazda wasm'a izin verdiği üst sınır. Ölçüm yalnız bellek hatasından SONRA yapılır,
 * çünkü sondanın kendisi geçici olarak bellek ayırır; sağlıklı bir açılışta bunu yapmak riski artırır.
 * Ayrılan bellek ölçüm biter bitmez bırakılır.
 */
let ceilCache = 0;
function wasmCeilingMB() {
  if (ceilCache) return ceilCache;
  const PAGES = 16;   // 1 MB = 16 sayfa (64 KiB)
  const can = (mb) => { let m = null; try { m = new WebAssembly.Memory({ initial: mb * PAGES }); return !!m; } catch (_) { return false; } finally { m = null; } };
  if (!can(16)) return (ceilCache = -1);          // 16 MB bile olmuyorsa ölçüm anlamsız
  if (can(4032)) return (ceilCache = 4032);       // wasm32 tavanına dayanmış
  let lo = 16, hi = 4032;
  for (let i = 0; i < 8 && hi - lo > 48; i++) { const mid = (lo + hi) >> 1; if (can(mid)) lo = mid; else hi = mid; }
  return (ceilCache = lo);
}
/**
 * Bellek hatası iletisi. CİHAZIN toplam belleğiyle ilgili DEĞİLDİR: Android WebView her işleyici sürecine
 * ayrı bir tavan koyar ve wasm yığını büyürken eski ile yeni tampon bir an birlikte durur, yani tepe
 * ihtiyaç son boyutun yaklaşık iki katıdır. Bu yüzden telefonda boş bellek olsa da hata alınabilir.
 * İletide dosya boyutu ve o anki yığın yazılır — destek için gereken iki sayı bunlar.
 */
let objCount = 0;   // ana iş parçacığının ön yoklamada saydığı DWG nesne sayısı (0 = bilinmiyor)
const memMsg = (n, stage, err) => {
  const mb = n / 1048576;
  const ceil = wasmCeilingMB();
  const raw = String(msgOf(err) || '').slice(0, 90);
  /*
   * Nesne başına ölçülen maliyet ~800 bayttır: 7.088.013 nesneli 283,8 MB'lık bir R2000 dosyası
   * LibreDWG'nin 64 bit YEREL derlemesinde 5.680 MB tepe bellekle okundu ((5680 - 284) / 7,088 milyon ≈ 800 B).
   * Dosyanın kendisi de yığında durduğu için ona ekleniyor. Sayı içeriğe göre değişir, bu yüzden "en az" denir.
   */
  const need = objCount ? Math.round(mb + objCount * 800 / 1048576) : 0;
  return `Çizim tarayıcı motorunun bellek tavanına takıldı (dosya ${mb.toFixed(1)} MB`
    + `${objCount ? ', ' + objCount + ' nesne' : ''}`
    + `${stage ? ', aşama: ' + stage : ''}${ceil > 0 ? `, bu cihazda wasm tavanı ~${ceil} MB` : ''}).`
    + (need ? ` Bu çizim için gereken bellek en az ${need} MB'dır.` : '')
    + ` Cihazın boş belleğiyle ilgisi yoktur: WebAssembly 32 bittir, yığını hiçbir cihazda 4096 MB'ı geçemez`
    + ` ve WebView her sekmeye bundan da düşük bir tavan koyar.`
    + ` Çizimi AutoCAD'de PURGE/AUDIT ile küçültmek ya da paftaya bölmek çözer.`
    + (raw ? ` [${raw}]` : '');
};
const countEntities = (db) => { let n = (db.entities || []).length; for (const r of ((db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [])) n += (r.entities || []).length; return n; };

async function readDb(bytes, id) {
  const u8 = new Uint8Array(bytes);
  if (isDxf(u8)) { postMessage({ id, stage: 'parse' }); return parseDxf(u8, { onProgress: (p) => postMessage({ id, stage: 'parse', pct: Math.round(p * 100) }) }); }
  const head = String.fromCharCode(...u8.slice(0, 6));
  if (!/^AC10\d\d$/.test(head)) {
    if (u8.length === 0) throw new Error('Dosya boş.');
    throw new Error('Bu bir DWG/DXF dosyası değil (başlık: ' + head.replace(/[^\x20-\x7e]/g, '?') + ').');
  }
  if (head < 'AC1012') throw new Error('Çok eski DWG sürümü (' + head + '). R13 ve sonrası açılabilir.');
  postMessage({ id, stage: 'lib' });
  await ensureLib(u8);
  postMessage({ id, stage: 'parse' });
  return decodeDwg(u8, head);
}

async function ensureLib(u8) {
  if (lib) return;
  try { lib = await LibreDwg.create(); }
  catch (e) { const m = isMem(e) ? memMsg(u8.length, 'çözümleyici kurulumu', e) : 'Çözümleyici başlatılamadı: ' + msgOf(e); lib = null; throw new Error(m); }
}

/** tek bir DWG tamponunu veritabanına çevirir; pencereli yolda her pencere için yeniden çağrılır */
function decodeDwg(u8, head, ends) {
  // sarmalayıcının dwg_read_data'sı hata kodunu yutar (yalnız OUTOFMEM fırlatır); dosya doğrudan okunur, kod değerlendirilir
  const W = lib.wasmInstance, ERR = LW.Dwg_Error;
  let res = null;
  try {
    try { W.FS.unlink('/tmp.dwg'); } catch (_) { /* yok */ }
    W.FS.createDataFile('/', 'tmp.dwg', u8, true, false, true);   // canOwn: MEMFS baytları kopyalamaz
    res = W.dwg_read_file('tmp.dwg');
  } catch (e) {
    const m = isMem(e) ? memMsg(u8.length, 'DWG okuma', e) : 'LibreDWG dosyayı çözemedi: ' + msgOf(e);
    if (isAbort(e)) lib = null;
    throw new Error(m);
  } finally { try { W.FS.unlink('/tmp.dwg'); } catch (_) { /* yok */ } }
  const code = res ? (res.error | 0) : ERR.INVALIDDWG;
  if (!res || !res.data || (code & ERR.OUTOFMEM)) {
    try { if (res && res.data) W.dwg_abandon(res.data); } catch (_) { /* yoksay */ }
    throw new Error((code & ERR.OUTOFMEM) ? memMsg(u8.length, 'DWG okuma', null) : `LibreDWG dosyayı çözemedi (bozuk ya da şifreli olabilir; hata kodu ${code}).`);
  }
  const dwg = res.data;
  const critical = code >= ERR.CLASSESNOTFOUND ? code : 0;   // DWG_ERR_CRITICAL: CLASSESNOTFOUND (128) ve üstü; sağlam dosyalarda 64/68 kalır
  const suspect = critical || ((code & ERR.WRONGCRC) ? code : 0);   // CRC hatası: dosya açılır ama nesneler eksik olabilir (bozuk kopya) → uyarı
  let db, cp = 0;
  try { if (ends && ends.length) patchChains(dwg, ends); try { cp = lib.dwg_get_codepage(dwg) | 0; } catch (_) { cp = 0; } db = lib.convert(dwg); db.raw3d = collectRaw3D(lib, dwg, db); db.sortents = collectSortents(lib, dwg, db); attachEed(lib, dwg, db, head, cp); }
  catch (e) {
    const m = isMem(e) ? memMsg(u8.length, 'nesne dönüşümü', e) : (critical ? `DWG bozuk ya da kesik (LibreDWG hata kodu ${code}): ` : 'LibreDWG dosyayı çözemedi: ') + msgOf(e);
    if (isAbort(e)) lib = null;
    throw new Error(m);
  } finally { try { if (lib) lib.dwg_free(dwg); } catch (_) { /* yoksay */ } }
  if (critical && !countEntities(db)) throw new Error(`DWG bozuk ya da kesik (LibreDWG hata kodu ${code}); dosyayı yeniden kopyalayın ya da AutoCAD RECOVER ile onarın.`);
  db.readWarn = suspect;                                        // kritik kod ya da CRC hatası + varlık var: çizim eksik olabilir, ana iş parçacığı uyarır
  if (head >= 'AC1027') attachAcDs(u8, db);
  db.header = db.header || {};
  db.header.ACADVER = head;
  if (head < 'AC1021') fixMleaderText(db, cp);
  return db;
}

/**
 * R2007 öncesi dosyalarda MULTILEADER metni (MLEADER_Content_MText.default_text) wasm tarafında sürüm bilgisi olmadan
 * UTF-16 gibi okunur: 8 bitlik kod sayfası baytları ikişer ikişer birleşir ('LEADER' → '䕌䑁剅'). Kod birimleri bayta
 * ayrılıp dosyanın kod sayfasıyla yeniden çözülür; yalnız 0xFF üstü karakter içeren (yani birleşmiş) metinlere dokunulur.
 */
function fixMleaderText(db, cp) {
  let dec = null;
  try { dec = new TextDecoder(LW.dwgCodePageToEncoding(cp) || 'windows-1254'); } catch (_) { try { dec = new TextDecoder('windows-1254'); } catch (__) { dec = null; } }
  if (!dec) return;
  const fix = (s) => {
    if (typeof s !== 'string' || !s) return s;
    let hi = false; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) { hi = true; break; }
    if (!hi) return s;
    const b = []; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b.push(c & 0xff, c >> 8); }
    return dec.decode(new Uint8Array(b)).replace(/\0+$/, '');
  };
  const walk = (list) => { for (const e of list || []) if (e && (e.type === 'MULTILEADER' || e.type === 'MLEADER')) e.textContent = fix(e.textContent); };
  walk(db.entities);
  for (const r of ((db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [])) walk(r.entities);
}

/**
 * Dönüştürücü yalnız 3DSOLID'i aktarır; REGION, BODY ve MESH varlıklarını düşürür. Bunlar için tanıtıcı,
 * katman, renk ve sahip blok bilgisiyle asgari varlık kayıtları üretilip veri tabanına eklenir ki sahne
 * kurucu ham 3B veriyi (raw3d) bu tanıtıcılarla bulabilsin.
 */
function synthesizeDropped(lib, db, byType, ownerOf, hex) {
  const names = { 37: 'REGION', 39: 'BODY', 663: 'MESH', 633: 'EXTRUDEDSURFACE', 660: 'LOFTEDSURFACE', 675: 'NURBSURFACE', 682: 'PLANESURFACE', 702: 'REVOLVEDSURFACE', 720: 'SWEPTSURFACE', 498: 'ACAD_PROXY_ENTITY', 65534: 'ACAD_PROXY_ENTITY', 29: 'POLYLINE_PFACE', 30: 'POLYLINE_MESH' };
  let layerByHandle = null;
  const layerName = (ent) => {
    try {
      if (!layerByHandle) { layerByHandle = new Map(); for (const l of ((db.tables && db.tables.LAYER && db.tables.LAYER.entries) || [])) layerByHandle.set(String(l.handle || '').toUpperCase(), l.name); }
      const ref = lib.dwg_object_entity_get_layer_object_ref(ent); const v = ref && ref.handleref ? ref.handleref.value : (ref && ref.absolute_ref);
      return (v != null && layerByHandle.get(Number(v).toString(16).toUpperCase())) || '0';
    } catch (_) { return '0'; }
  };
  const records = (db.tables && db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || [];
  const recByHandle = new Map(); for (const r of records) recByHandle.set(String(r.handle || '').toUpperCase(), r);
  const seen = new Set(); const walk = (list) => { for (const e of list || []) if (e && e.handle) seen.add(e.handle); };
  walk(db.entities); for (const r of records) walk(r.entities);
  for (const t of [37, 39, 663, 633, 660, 675, 682, 702, 720, 498, 65534, 29, 30]) {
    for (const o of byType[t] || []) {
      try {
        const h = hex(o); if (!h || seen.has(h)) continue;
        const ent = lib.dwg_object_to_entity(o); if (!ent) continue;
        let colorIndex = 256, color;
        try { const c = lib.dwg_object_entity_get_color_object(ent); if (c) { colorIndex = c.index; if (c.method === 194 || ((c.rgb >>> 24) & 255) === 194) color = c.rgb & 0xffffff; } } catch (_) { /* renk yok */ }
        let isVisible = true; try { isVisible = !lib.dwg_object_entity_get_invisible(ent); } catch (_) { /* geç */ }
        const root = ownerOf.get(o), ownerH = root ? hex(root) : null;
        const e = { type: names[t], handle: h, layer: layerName(ent), colorIndex, color, lineType: '', isVisible, ownerBlockRecordSoftId: ownerH };
        if (t === 498 || t === 65534) {                     // proxy / LibreDWG'nin çözemediği sınıf: önizleme grafiği (proxy graphics)
          let g = null; try { g = lib.dwg_entity_get_preview(o); } catch (_) { /* yok */ }
          if (!g || !g.length) continue;
          e.graphics = g instanceof Uint8Array ? new Uint8Array(g) : new Uint8Array(Array.from(g)); e.unknownClass = t === 65534;
        }
        const rec = ownerH ? recByHandle.get(ownerH) : null;
        if (rec) { if (!rec.entities) rec.entities = []; rec.entities.push(e); if (/^\*MODEL_SPACE$/i.test(rec.name || '') && Array.isArray(db.entities) && db.entities !== rec.entities) db.entities.push(e); }
        else if (Array.isArray(db.entities)) db.entities.push(e);
        seen.add(h);
      } catch (_) { /* bu nesne atlanır */ }
    }
  }
}

/**
 * R2013+ dosyalarda katıların ASM verisi AcDs bölümündedir; LibreDWG (özellikle 2018 dosyalarında) bunu
 * katılara bağlayamayınca bölüm dosya baytlarından okunur ve tanıtıcıya göre eklenir. Tanıtıcı eşlemesi
 * çözülemezse ve verisiz katı sayısı bulunan blok sayısına eşitse tanıtıcı sırasıyla bağlanır.
 */
function attachAcDs(u8, db) {
  const info = db.acdsInfo = { family: isR2004Family(u8), bytes: 0, records: 0, matched: 0, blobs: 0, error: null };
  try {
    if (!info.family) return;
    const ds = readAcDs(u8); if (!ds) return;
    info.bytes = ds.length;
    const m = mapAsmToHandles(ds);
    info.records = m.records.length; info.blobs = m.blobs.length; info.matched = Object.keys(m.byHandle).length;
    const raw = db.raw3d || (db.raw3d = {});
    let n = 0;
    // tanıtıcıyla eşleşen blok her zaman yeğlenir: LibreDWG blokları sırayla bağlar ve bölge/katı karışabilir
    for (const [h, data] of Object.entries(m.byHandle)) { const rec = raw[h] || (raw[h] = {}); rec.acis = data; n++; }
    if (!n && m.blobs.length && Array.isArray(db.entities)) {
      const empty = [];
      const walk = (list) => { for (const e of list || []) { if (/^(3DSOLID|REGION|BODY|[A-Z]*SURFACE)$/.test(e.type) && e.handle && !(raw[e.handle] && raw[e.handle].acis)) empty.push(e.handle); } };
      walk(db.entities); for (const b of Object.values(db.blocks || {})) walk(b.entities);
      const uniq = [...new Set(empty)].sort((a, b) => parseInt(a, 16) - parseInt(b, 16));
      if (uniq.length === m.blobs.length) for (let i = 0; i < uniq.length; i++) { const rec = raw[uniq[i]] || (raw[uniq[i]] = {}); rec.acis = m.blobs[i].data; }
    }
  } catch (e) { info.error = (e && e.message) || String(e); /* AcDs okunamadı: katılar tel kafes olarak kalır */ }
}

/** tanılama paylaşımı için ham katı verisinden küçük örnekler (en çok 2 katı, katı başına 48 KB, base64) */
function rawSamples(raw) {
  const out = [];
  try {
    for (const [h, rec] of Object.entries(raw || {})) {
      const item = { handle: h, acisBytes: rec.acis ? rec.acis.length : 0, acisType: rec.acis ? (typeof rec.acis === 'string' ? 'SAT' : 'SAB') : null, wires: rec.wires ? rec.wires.length : 0, mesh: !!rec.mesh };
      if (rec.acis && out.filter(o => o.b64).length < 2) {
        const u = typeof rec.acis === 'string' ? new TextEncoder().encode(rec.acis) : rec.acis;
        const part = u.subarray(0, 49152); let bin = ''; for (let i = 0; i < part.length; i++) bin += String.fromCharCode(part[i]);
        item.b64 = btoa(bin);
      }
      out.push(item); if (out.length >= 40) break;
    }
  } catch (_) { /* örnek alınamadı */ }
  return out;
}

/**
 * Dönüştürücünün taşımadığı 3B veriler: 3DSOLID / REGION / BODY için ACIS (SAT metni ya da SAB ikilisi)
 * ve önbellek tel kafesi; MESH (AcDbSubDMesh) için köşe ve yüz listesi. Anahtar: onaltılık tanıtıcı.
 */
/**
 * Çizim sırası tabloları (SORTENTSTABLE, tür 714): sahip blok kaydı → (varlık tanıtıcısı → sıra tanıtıcısı).
 * Dönüştürücü bu nesneyi vermez; LibreDWG nesne listesi taranır. scene.js sortedEnts() bu eşlemeyle çizer.
 */
/**
 * Genişletilmiş varlık verisi (XDATA): sarmalayıcının dwg_object_entity_get_xdata çıktısı bozuk (uygulama adı
 * UTF-16 sanılır, kodlar kayar); LibreDWG'nin Dwg_Eed dizisi doğrudan okunur ve dxf.js ile aynı biçimde
 * (e.xdata = [{ appName, value: [{ code, value }] }]) varlığa yazılır. Ölçü stili geçersiz kılmaları
 * (ACAD/DSTYLE: DIMSCALE, DIMASZ…) böylece DWG yolunda da geçerli olur. Ayrıca LEADER'ın ölçü stili adı
 * (sarmalayıcı MTEXT stilini okuyordu) dimstyle tanıtıcısından çözülür.
 * Dwg_Eed (wasm32): size u16 @0, handle.value u64 @16, data* @32 — data (paketli): code u8, sonra değer.
 */
function attachEed(lib, dwg, db, head, cp) {
  const W = lib.wasmInstance; if (!W || !W.dwg_ptr_to_unsigned_char_array) return;
  const r2007 = head >= 'AC1021';
  let dec = null; try { dec = new TextDecoder(LW.dwgCodePageToEncoding(cp) || 'windows-1254'); } catch (_) { try { dec = new TextDecoder('windows-1254'); } catch (__) { dec = null; } }
  const decBytes = (u) => { try { return dec ? dec.decode(u) : String.fromCharCode(...u); } catch (_) { return String.fromCharCode(...u); } };
  const bytesAt = (p, n) => new Uint8Array(W.dwg_ptr_to_unsigned_char_array(p, n));
  const hexOf = (v) => Number(v).toString(16).toUpperCase();
  const byH = new Map(); const add = (arr) => { for (const e of arr || []) if (e && e.handle) byH.set(String(e.handle).toUpperCase(), e); };
  add(db.entities); for (const b of (db.tables.BLOCK_RECORD && db.tables.BLOCK_RECORD.entries) || []) add(b.entities);
  const dimByH = new Map(); for (const d of (db.tables.DIMSTYLE && db.tables.DIMSTYLE.entries) || []) if (d && d.handle) dimByH.set(String(d.handle).toUpperCase(), d);
  const appNames = new Map();
  const nameOf = (hv) => {
    if (appNames.has(hv)) return appNames.get(hv);
    let nm = '';
    try { const ao = lib.dwg_resolve_handle(dwg, hv); if (ao) { const at = lib.dwg_object_to_object_tio(ao); const r = lib.dwg_dynapi_entity_value(at, 'name'); if (r && r.bin) nm = decBytes(new Uint8Array(Object.values(r.bin))); else if (r && typeof r.data === 'string') nm = r.data; } } catch (_) { nm = ''; }
    appNames.set(hv, nm); return nm;
  };
  const absOf = (r) => { if (r == null) return null; if (typeof r === 'number') { try { return lib.dwg_ref_get_absref(r); } catch (_) { return null; } } if (typeof r === 'object') return r.absolute_ref != null ? r.absolute_ref : (r.handleref && r.handleref.value != null ? r.handleref.value : null); return null; };
  const parseData = (dp) => {   // → [{ code, value }] (DXF 10xx kodları)
    const out = []; const h = bytesAt(dp, 8); const code = h[0]; const dv = new DataView(h.buffer);
    switch (code) {
      case 0: { const len = dv.getUint16(1, true); if (r2007) { const u = bytesAt(dp + 5, len * 2); let str = ''; for (let i = 0; i + 1 < u.length; i += 2) str += String.fromCharCode(u[i] | (u[i + 1] << 8)); out.push({ code: 1000, value: str }); } else out.push({ code: 1000, value: decBytes(bytesAt(dp + 5, len)) }); break; }
      case 2: out.push({ code: 1002, value: h[1] ? '}' : '{' }); break;
      case 3: case 5: { const b = bytesAt(dp + 1, 8); const d2 = new DataView(b.buffer); out.push({ code: 1000 + code, value: hexOf(d2.getUint32(0, true) + d2.getUint32(4, true) * 4294967296) }); break; }
      case 4: { const len = h[1]; const b = bytesAt(dp + 2, len); out.push({ code: 1004, value: Array.from(b, x => x.toString(16).padStart(2, '0')).join('') }); break; }
      case 10: case 11: case 12: case 13: { const b = bytesAt(dp + 1, 24); const d2 = new DataView(b.buffer); out.push({ code: 1000 + code, value: d2.getFloat64(0, true) }, { code: 1010 + code, value: d2.getFloat64(8, true) }, { code: 1020 + code, value: d2.getFloat64(16, true) }); break; }
      case 40: case 41: case 42: { const b = bytesAt(dp + 1, 8); out.push({ code: 1000 + code, value: new DataView(b.buffer).getFloat64(0, true) }); break; }
      case 70: out.push({ code: 1070, value: dv.getInt16(1, true) }); break;
      case 71: out.push({ code: 1071, value: dv.getInt32(1, true) }); break;
      default: break;   // 1 (appid dizini) ve bilinmeyenler
    }
    return out;
  };
  let N = 0; try { N = lib.dwg_get_num_objects(dwg); } catch (_) { return; }
  let attached = 0;
  for (let i = 0; i < N && i < 4000000; i++) {
    let o = null, tio = null;
    try { o = lib.dwg_get_object(dwg, i); if (!o || lib.dwg_object_get_supertype(o) !== 0) continue; tio = lib.dwg_object_to_entity_tio(o); if (!tio) continue; } catch (_) { continue; }
    let e = null; try { e = byH.get(hexOf(lib.dwg_obj_get_handle_value(o))); } catch (_) { e = null; }
    if (!e) continue;
    try {
      if (e.type === 'LEADER' || e.type === 'DIMENSION' || e.type === 'TOLERANCE') {   // ölçü stili adı: dimstyle tanıtıcısı → DIMSTYLE tablosu
        const ab = absOf(lib.dwg_dynapi_entity_value(tio, 'dimstyle').data); const d = ab != null ? dimByH.get(hexOf(ab)) : null;
        if (d && d.name) e.styleName = d.name;
      }
    } catch (_) { /* stil yok */ }
    try {
      const ne = lib.dwg_dynapi_common_value(tio, 'num_eed').data | 0; if (!(ne > 0)) continue;
      const ep = lib.dwg_dynapi_common_value(tio, 'eed').data | 0; if (!ep) continue;
      const tbl = bytesAt(ep, 40 * Math.min(ne, 4096)); const dv = new DataView(tbl.buffer);
      const groups = []; let cur = null;
      for (let k = 0; k < ne && k < 4096; k++) {
        const off = k * 40, size = dv.getUint16(off, true), hv = dv.getUint32(off + 16, true), dp = dv.getUint32(off + 32, true);
        if (size > 0 || !cur) { cur = { appName: nameOf(hv), value: [] }; groups.push(cur); }
        if (dp) cur.value.push(...parseData(dp));
      }
      if (groups.length) { e.xdata = groups; attached++; }
    } catch (_) { /* bu varlığın EED'si atlanır */ }
  }
  db.eedCount = attached;
}

function collectSortents(lib, dwg, db) {
  const W = lib.wasmInstance, out = {};
  const hexOf = (v) => (v == null ? null : Number(v).toString(16).toUpperCase());
  const absOf = (r) => { if (r == null) return null; if (typeof r === 'number') { try { return lib.dwg_ref_get_absref(r); } catch (_) { return null; } } if (typeof r === 'object') { if (r.absolute_ref != null) return r.absolute_ref; if (r.handleref && r.handleref.value != null) return r.handleref.value; } return null; };
  const refArr = (ptr, n) => { try { return W.dwg_ptr_to_object_ref_ptr_array(ptr, n); } catch (_) { return null; } };
  let model = null;
  try { const rec = (db.tables.BLOCK_RECORD.entries || []).find(b => /^\*MODEL_SPACE$/i.test(b.name || '')); model = rec ? String(rec.handle).toUpperCase() : null; } catch (_) { /* yok */ }
  let N = 0; try { N = lib.dwg_get_num_objects(dwg); } catch (_) { return null; }
  let found = 0;
  for (let i = 0; i < N && i < 4000000; i++) {
    let o = null; try { o = lib.dwg_get_object(dwg, i); if (!o || lib.dwg_object_get_fixedtype(o) !== 714) continue; } catch (_) { continue; }
    try {
      const tio = lib.dwg_object_to_object_tio(o); if (!tio) continue;
      const val = (f) => { try { const r = lib.dwg_dynapi_entity_value(tio, f); return r && r.data !== undefined ? r.data : null; } catch (_) { return null; } };
      const n = val('num_ents') | 0; if (!(n > 0)) continue;
      const ents = refArr(val('ents'), n), sorts = refArr(val('sort_ents'), n); if (!ents || !sorts) continue;
      let owner = hexOf(absOf(val('block_owner')));
      if (!owner) owner = model;                                     // sahibi çözülemezse model uzayı varsayılır
      if (!owner) continue;
      const m = out[owner] || (out[owner] = new Map());
      for (let k = 0; k < n; k++) { const eh = absOf(ents[k]), sh = absOf(sorts[k]); if (eh != null && sh != null) m.set(hexOf(eh), Number(sh)); }
      found++;
    } catch (_) { /* tablo atlanır */ }
  }
  return found ? out : null;
}

function collectRaw3D(lib, dwg, db) {
  const out = {};
  const W = lib.wasmInstance;
  const hex = (o) => { try { const v = lib.dwg_obj_get_handle_value(o); return Number(v).toString(16).toUpperCase(); } catch (_) { return null; } };
  const val = (tio, f) => { try { const r = lib.dwg_dynapi_entity_value(tio, f); return r && r.data !== undefined ? r.data : null; } catch (_) { return null; } };
  // model uzayı, kâğıt uzayı ve bütün blok tanımlarındaki varlıklar dolaşılır (tür: REGION 37, 3DSOLID 38, BODY 39, MESH 663)
  const roots = [];
  try { const o = lib.dwg_model_space_object(dwg); if (o) roots.push(o); } catch (_) { /* yok */ }
  try { const o = lib.dwg_paper_space_object(dwg); if (o) roots.push(o); } catch (_) { /* yok */ }
  try { const a = lib.dwg_getall_BLOCK_HEADER(dwg); const arr = Array.isArray(a) ? a : (a && a.size ? Array.from({ length: a.size() }, (_, i) => a.get(i)) : []); for (const o of arr) if (o && !roots.includes(o)) roots.push(o); } catch (_) { /* yok */ }
  // REGION 37, 3DSOLID 38, BODY 39, MESH 663; AcDbSurface türevleri (ACIS taşır): EXTRUDED 633, LOFTED 660, NURB 675, PLANE 682, REVOLVED 702, SWEPT 720
  const byType = { 37: [], 38: [], 39: [], 663: [], 633: [], 660: [], 675: [], 682: [], 702: [], 720: [], 498: [], 65534: [], 29: [], 30: [] }, ownerOf = new Map();
  const census = {}; const typeName = (ft) => { try { const E = LW.Dwg_Object_Type; const n = E && E[ft]; return n ? String(n).replace(/^DWG_TYPE_/, '') : String(ft); } catch (_) { return String(ft); } };
  for (const root of roots) {
    let next = null, guard = 0;
    try { next = lib.get_first_owned_entity(root); } catch (_) { continue; }
    while (next && guard++ < 2000000) {
      try { const ft = lib.dwg_object_get_fixedtype(next); const nm = typeName(ft); census[nm] = (census[nm] || 0) + 1; if (byType[ft]) { byType[ft].push(next); ownerOf.set(next, root); } } catch (_) { /* atla */ }
      try { next = lib.get_next_owned_entity(root, next); } catch (_) { break; }
    }
  }
  if (db) { db.census = census; synthesizeDropped(lib, db, byType, ownerOf, hex); }
  const objs = (t) => byType[t] || [];
  for (const t of [37, 38, 39, 633, 660, 675, 682, 702, 720]) {   // REGION, 3DSOLID, BODY ve yüzey varlıkları (aynı ACIS alanları)
    for (const o of objs(t)) {
      try {
        const tio = lib.dwg_object_to_entity_tio(o); const h = hex(o); if (!tio || !h) continue;
        const rec = {};
        const ver = val(tio, 'version'), ptr = val(tio, 'acis_data');
        if (ptr) {
          if (ver === 2) { const n = val(tio, 'sab_size') || 0; if (n > 0) rec.acis = new Uint8Array(W.dwg_ptr_to_unsigned_char_array(ptr, n)); }
          else rec.acis = W.UTF8ToString(ptr);
        }
        const nw = val(tio, 'num_wires'), wp = val(tio, 'wires');
        if (nw > 0 && wp) {
          const sz = lib.dwg_dynapi_subclass_size('3DSOLID_wire'), wires = [];
          for (let i = 0; i < nw && i < 100000; i++) {
            const wptr = wp + i * sz;
            const np = lib.dwg_dynapi_subclass_value(wptr, '3DSOLID_wire', 'num_points'), pts = lib.dwg_dynapi_subclass_value(wptr, '3DSOLID_wire', 'points');
            const n = np && np.data, pp = pts && pts.data;
            if (n > 1 && pp) { const arr = typeof pp === 'number' ? W.dwg_ptr_to_point3d_array(pp, n) : pp; if (arr && arr.length) wires.push(arr.map(q => [q.x, q.y, q.z])); }
          }
          if (wires.length) rec.wires = wires;
        }
        if (rec.acis || rec.wires) out[h] = rec;
      } catch (e) { /* bu katı atlanır */ }
    }
  }
  // çok yüzlü ağ (POLYLINE_PFACE 29) ve çokgen ağ (POLYLINE_MESH 30): köşe/yüz alt varlıklarından ağ kurulur
  let handleIndex = null;
  const objByHandle = (hv) => {
    try { const o = lib.dwg_resolve_handle(dwg, hv); if (o) return o; } catch (_) { /* geç */ }
    return null;
  };
  const vertexObjects = (o, tio) => {
    const out = [];
    const n = val(tio, 'num_owned') || 0, vp = val(tio, 'vertex');
    if (n > 0 && vp) {
      try {
        const refs = W.dwg_ptr_to_object_ref_ptr_array(vp, n);
        for (let i = 0; i < n; i++) { const r = refs[i]; if (!r) continue; let ab = null; try { ab = lib.dwg_ref_get_absref(r); } catch (_) { ab = r && r.absolute_ref; } const vo = ab ? objByHandle(ab) : null; if (vo) out.push(vo); }
      } catch (_) { /* aşağıdaki yola düş */ }
    }
    if (!out.length) {                                            // R13-R2000: first_vertex … last_vertex ardışık nesnelerdir
      const fv = val(tio, 'first_vertex'), lv = val(tio, 'last_vertex');
      const hv = (r) => { try { return lib.dwg_ref_get_absref(r); } catch (_) { return r && r.absolute_ref; } };
      const h0 = fv ? hv(fv) : null, h1 = lv ? hv(lv) : null;
      if (h0 && h1) {
        if (!handleIndex) { handleIndex = new Map(); try { const N = lib.dwg_get_num_objects(dwg); for (let i = 0; i < N; i++) { const oo = lib.dwg_get_object(dwg, i); try { handleIndex.set(Number(lib.dwg_obj_get_handle_value(oo)), i); } catch (_) { /* geç */ } } } catch (_) { /* geç */ } }
        const i0 = handleIndex.get(Number(h0)), i1 = handleIndex.get(Number(h1));
        if (i0 != null && i1 != null && i1 >= i0 && i1 - i0 < 5000000) for (let i = i0; i <= i1; i++) { try { out.push(lib.dwg_get_object(dwg, i)); } catch (_) { /* geç */ } }
      }
    }
    return out;
  };
  const pointOf = (vt) => { const pt = val(vt, 'point'); return pt && typeof pt === 'object' ? [pt.x || 0, pt.y || 0, pt.z || 0] : null; };
  for (const o of objs(29)) {                                   // POLYLINE_PFACE
    try {
      const tio = lib.dwg_object_to_entity_tio(o); const h = hex(o); if (!tio || !h) continue;
      const verts = [], faces = [], hidden = [];
      for (const vo of vertexObjects(o, tio)) {
        let ft = -1; try { ft = lib.dwg_object_get_fixedtype(vo); } catch (_) { continue; }
        const vt = lib.dwg_object_to_entity_tio(vo); if (!vt) continue;
        if (ft === 14) {                                          // VERTEX_PFACE_FACE: vertind[4] (1 tabanlı, negatif = görünmez kenar)
          let vi = val(vt, 'vertind'); if (typeof vi === 'number') { try { vi = Array.from(W.dwg_ptr_to_int16_t_array(vi, 4)); } catch (_) { vi = null; } }
          // dynapi sabit diziyi (BSd[4]) vermez: yapı yerleşiminden okunur — parent* (4) + flag RC (1) + dolgu (1) → vertind @6
          if (!Array.isArray(vi)) { try { vi = Array.from(W.dwg_ptr_to_int16_t_array(vt + 6, 4)); } catch (_) { vi = null; } }
          if (!Array.isArray(vi)) continue;
          const idx = [], hid = [];
          for (const v of vi) { if (!v) continue; idx.push(Math.abs(v) - 1); hid.push(v < 0); }
          if (idx.length >= 2) { faces.push(idx.length, ...idx); hidden.push(false, ...hid); }
        } else if (ft === 13 || ft === 12 || ft === 11 || ft === 10) { const pt = pointOf(vt); if (pt) verts.push(pt); }   // VERTEX_PFACE / MESH / 3D / 2D
      }
      if (verts.length && faces.length) out[h] = { mesh: { verts, faces, hidden } };
      else if (verts.length > 1) out[h] = { wires: [verts] };
    } catch (e) { /* atla */ }
  }
  for (const o of objs(30)) {                                   // POLYLINE_MESH: M×N köşe ızgarası
    try {
      const tio = lib.dwg_object_to_entity_tio(o); const h = hex(o); if (!tio || !h) continue;
      const M = val(tio, 'num_m_verts') || 0, Nn = val(tio, 'num_n_verts') || 0, flag = val(tio, 'flag') || 0;
      const verts = [];
      for (const vo of vertexObjects(o, tio)) { const vt = lib.dwg_object_to_entity_tio(vo); if (!vt) continue; const pt = pointOf(vt); if (pt) verts.push(pt); }
      if (M < 2 || Nn < 2 || verts.length < M * Nn) { if (verts.length > 1) out[h] = { wires: [verts] }; continue; }
      const closedM = !!(flag & 1), closedN = !!(flag & 32), faces = [];
      const at = (i, j) => i * Nn + j;
      for (let i = 0; i < (closedM ? M : M - 1); i++) for (let j = 0; j < (closedN ? Nn : Nn - 1); j++) { const i2 = (i + 1) % M, j2 = (j + 1) % Nn; faces.push(4, at(i, j), at(i, j2), at(i2, j2), at(i2, j)); }
      out[h] = { mesh: { verts, faces } };
    } catch (e) { /* atla */ }
  }
  for (const o of objs(663)) {                                  // MESH
    try {
      const tio = lib.dwg_object_to_entity_tio(o); const h = hex(o); if (!tio || !h) continue;
      const nv = val(tio, 'num_vertex'), vp = val(tio, 'vertex'), nf = val(tio, 'num_faces'), fp = val(tio, 'faces');
      if (nv > 0 && vp && nf > 0 && fp) {
        const va = typeof vp === 'number' ? W.dwg_ptr_to_point3d_array(vp, nv) : vp;
        const fa = typeof fp === 'number' ? Array.from(W.dwg_ptr_to_uint32_t_array(fp, nf)) : Array.from(fp);
        out[h] = { mesh: { verts: va.map(q => [q.x, q.y, q.z]), faces: fa } };
      }
    } catch (e) { /* atla */ }
  }
  return out;
}

const WIN_OBJ = 250000;      // pencere başına hedeflenen nesne sayısı (ölçüm: 250 bin nesne ≈ 200 MB yığın)
const WIN_MIN_BYTES = 32 * 1048576;   // bu boyutun altındaki dosyalar tek parça okunur

/** iki sahnenin ilkellerini ve tablolarını birleştirir; her varlık tek pencerede olduğu için tekrar oluşmaz */
function mergeScene(a, b) {
  for (const lb of b.layouts) {
    const la = a.layouts.find((l) => l.name === lb.name);
    if (!la) { a.layouts.push(lb); continue; }
    if (lb.prims.length) {
      // yayma (...) kullanılmaz: milyonlarca öge çağrı yığınını taşırır.
      // k=4 (ekleme noktası imi) atılır: INSERT her pencerede bulunduğundan bu im pencere başına yeniden üretilir.
      for (const q of lb.prims) if (q.k !== 4) la.prims.push(q);
      la.ext = la.prims.length === lb.prims.length ? lb.ext
        : [Math.min(la.ext[0], lb.ext[0]), Math.min(la.ext[1], lb.ext[1]), Math.max(la.ext[2], lb.ext[2]), Math.max(la.ext[3], lb.ext[3])];
    }
    for (const v of lb.viewports) la.viewports.push(v);
  }
  const byName = new Map(a.layers.map((l) => [l.name, l]));
  for (const l of b.layers) { const x = byName.get(l.name); if (x) x.count = (x.count || 0) + (l.count || 0); else { a.layers.push(l); byName.set(l.name, l); } }
  for (const k of Object.keys(b.counts || {})) a.counts[k] = (a.counts[k] || 0) + b.counts[k];
  a.entityCount += b.entityCount || 0;
  a.blockCount = Math.max(a.blockCount || 0, b.blockCount || 0);
  const xn = new Set(a.xrefs.map((x) => x.name)); for (const x of b.xrefs) if (!xn.has(x.name)) { a.xrefs.push(x); xn.add(x.name); }
  const im = new Set(a.images.map((x) => x.fileName)); for (const x of b.images) if (!im.has(x.fileName)) { a.images.push(x); im.add(x.fileName); }
  if (!a.solidDiag && b.solidDiag) a.solidDiag = b.solidDiag;
  return a;
}

/**
 * Pencereli okuma. Dosyanın nesne haritası dilimlenir; her dilim ayrı ayrı çözülür, sahne ilkelleri
 * biriktirilir, nesneler serbest bırakılır. Ölçülen kazanç: 283,8 MB / 7,09 milyon nesnelik bir dosyada
 * tepe bellek 5.680 MB yerine 481 MB; geometri (köşe, yüz, yüz indeksi toplamı) tek parça okumayla
 * birebir aynı. Dosya uygun değilse (R2004+, INSERT içeriyor, yeterince büyük değil) null döner ve
 * çağıran tek parça okumaya devam eder.
 */
/** ham bir DWG tamponunu MEMFS'e yazıp çözer; çağıran dwg'yi kendisi serbest bırakır */
function rawRead(u8) {
  const W = lib.wasmInstance;
  try { W.FS.unlink('/tmp.dwg'); } catch (_) { /* yok */ }
  W.FS.createDataFile('/', 'tmp.dwg', u8, true, false, true);
  let res = null;
  try { res = W.dwg_read_file('tmp.dwg'); } finally { try { W.FS.unlink('/tmp.dwg'); } catch (_) { /* yok */ } }
  return res;
}

/** yapı geçişi: her blok başlığının kendi tanıtıcısı ile ilk/son varlık tanıtıcıları */
function blockRanges(u8, keep, H) {
  const W = lib.wasmInstance, out = [];
  const res = rawRead(u8);
  if (!res || !res.data) return out;
  try {
    const n = W.dwg_get_num_objects(res.data) | 0;
    // yapı geçişinde dizi ile harita birebir örtüşür (fazladan nesne eklenmez); blok başlığının tanıtıcısı buradan alınır
    if (n !== keep.length) return out;
    for (let i = 0; i < n; i++) {
      const o = W.dwg_get_object(res.data, i);
      let ft = 0; try { ft = lib.dwg_object_get_fixedtype(o); } catch (_) { continue; }
      if (ft !== 49) continue;                                     // BLOCK_HEADER
      const tio = lib.dwg_object_to_object_tio(o);
      const ref = (f) => { try { const r = lib.dwg_dynapi_entity_value(tio, f); const p = r && r.data; return p ? (W.dwg_ref_get_absref(p) | 0) : 0; } catch (_) { return 0; } };
      const bh = H[keep[i]], f = ref('first_entity'), l = ref('last_entity');
      if (bh && f && l) out.push({ bh, f, l });
    }
  } finally { try { lib.dwg_free(res.data); } catch (_) { /* geç */ } }
  return out;
}

/**
 * Blok başlıklarının zincir uçlarını bu pencerede bulunan varlıklara yönlendirir.
 * `Dwg_Object_Ref` yapısının ilk alanı çözülmüş nesne işaretçisidir (`struct _dwg_object *obj`),
 * bu yüzden 0 uzaklığına yazmak yeterlidir. Önce bir kez `dwg_getall_entities_in_model_space`
 * çağrılır ki LibreDWG'nin `dirty_refs` çözümlemesi yamayı sonradan silmesin.
 */
function patchChains(dwg, ends) {
  const W = lib.wasmInstance;
  try { lib.dwg_getall_entities_in_model_space(dwg); } catch (_) { /* geç */ }   // dirty_refs çözümlemesi yamayı silmesin
  let done = 0;
  for (const e of ends) {
    try {
      const bo = W.dwg_absref_get_object(dwg, e.bh), fo = W.dwg_absref_get_object(dwg, e.fh), lo = W.dwg_absref_get_object(dwg, e.lh);
      if (!bo || !fo || !lo) continue;
      const tio = lib.dwg_object_to_object_tio(bo);
      const fr = lib.dwg_dynapi_entity_value(tio, 'first_entity'), lr = lib.dwg_dynapi_entity_value(tio, 'last_entity');
      if (!fr || !fr.data || !lr || !lr.data) continue;
      W.setValue(fr.data, fo, 'i32');                              // Dwg_Object_Ref'in ilk alanı: struct _dwg_object *obj
      W.setValue(lr.data, lo, 'i32');
      done++;
    } catch (_) { /* bu blok atlanır */ }
  }
  return done;
}

async function parseWindowed(u8, id, head, perWindow) {
  let pl = null;
  try { pl = Win.plan(u8, perWindow || WIN_OBJ); } catch (_) { pl = null; }
  if (!pl) return null;
  postMessage({ id, stage: 'lib' });
  await ensureLib(u8);
  let scene = null, warn = 0, order = 0, ents = 0;
  try {
    const keep = Win.applyStructure(u8, pl);
    const blocks = blockRanges(u8, keep, pl.H);
    if (!blocks.length) { Win.restore(u8, pl); return null; }      // zincir uçları okunamadı: tek parça okumaya düş
    const owner = Win.assignBlocks(pl, blocks);
    for (let k = 0; k < pl.windows.length; k++) {
      postMessage({ id, stage: 'parse', pct: Math.round((100 * k) / pl.windows.length) });
      const idxArr = Win.applyWindow(u8, pl, k);
      const db = decodeDwg(u8, head, Win.chainEnds(pl, blocks, owner, idxArr));
      warn = warn || db.readWarn || 0;
      ents += (db.entities || []).length;
      order += db.sortents ? Object.values(db.sortents).reduce((n, m) => n + m.size, 0) : 0;
      const s = new SceneBuilder(db, {}).build();
      scene = scene ? mergeScene(scene, s) : s;
    }
  } finally { try { Win.restore(u8, pl); } catch (_) { /* geç */ } }
  /*
   * Eksiksizlik denetimi. Pencereli okumanın tek parça okumayla aynı çizimi vermesi, bir bloğun
   * varlık zincirinin pencere içinde yürüyebilmesine bağlıdır (LibreDWG `next_entity` bağlarını
   * izler). Zincir sırası dosyadaki tanıtıcı sırasından farklı olan çizimlerde pencereler eksik
   * kalabilir; böyle bir durumda eksik bir sonuç göstermek yerine null dönülür ve çağıran tek parça
   * okumaya devam eder. Ölçüt, çevrilen üst düzey varlık sayısının haritadaki üst düzey varlık
   * sayısını karşılamasıdır.
   */
  if (ents < pl.topLevel * 0.98) return null;
  scene.version = head;
  scene.readWarn = warn;
  scene.drawOrder = order;
  scene.census = null;
  scene.windows = pl.windows.length;
  scene.objects = pl.objects;
  return scene;
}

self.onmessage = async (ev) => {
  const { id, cmd } = ev.data;
  try {
    if (cmd === 'parse') {
      objCount = ev.data.objects | 0;
      const u8w = new Uint8Array(ev.data.bytes);
      if (u8w.length >= WIN_MIN_BYTES || ev.data.winObj) {
        const ws = await parseWindowed(u8w, id, String.fromCharCode(...u8w.slice(0, 6)), ev.data.winObj | 0);
        if (ws) { postMessage({ id, ok: true, scene: ws }); return; }
      }
      const db = await readDb(ev.data.bytes, id);
      postMessage({ id, stage: 'scene' });
      const scene = new SceneBuilder(db, { onProgress: (i, n) => postMessage({ id, stage: 'scene', pct: n ? Math.round(100 * i / n) : 0 }) }).build();
      scene.version = db.header.ACADVER || '';
      scene.readWarn = db.readWarn || 0;
      if (scene.solidDiag) { scene.solidDiag.acds = db.acdsInfo || null; scene.solidDiag.samples = rawSamples(db.raw3d); }
      scene.census = db.census || null;
      scene.drawOrder = db.sortents ? Object.values(db.sortents).reduce((n, m) => n + m.size, 0) : 0;   // çizim sırası tablosundaki varlık sayısı
      postMessage({ id, ok: true, scene });
    } else if (cmd === 'xref') {
      const db = await readDb(ev.data.bytes, id);
      postMessage({ id, stage: 'scene' });
      const b = new SceneBuilder(db, { layerPrefix: ev.data.prefix, xref: true });
      postMessage({ id, ok: true, xref: b.buildXref(ev.data.inserts) });
    } else throw new Error('bilinmeyen komut ' + cmd);
  } catch (e) {
    postMessage({ id, ok: false, error: (e && e.message) || String(e) });
  }
};
