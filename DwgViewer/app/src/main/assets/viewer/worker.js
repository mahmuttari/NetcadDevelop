/*
 * Çözümleme işçisi: DWG (LibreDWG WebAssembly) ya da DXF (dxf.js) → sahne.
 * Ana iş parçacığı bloke olmaz; ilerleme iletileri gönderilir.
 *
 * İstek : { id, cmd:'parse', bytes:ArrayBuffer, name }               → { id, ok, scene }
 *         { id, cmd:'xref',  bytes, name, inserts:[{m,layer,color}], prefix } → { id, ok, xref:{prims,layers,ltypes,ext} }
 * İlerleme: { id, stage:'lib'|'parse'|'scene' }
 */
import { LibreDwg, Dwg_File_Type } from './lib/dist/libredwg-web.js';
import { SceneBuilder } from './scene.js';
import { parseDxf, isDxf } from './dxf.js';
import { readAcDs, mapAsmToHandles, isR2004Family } from './acds.js';

let lib = null;

async function readDb(bytes, id) {
  const u8 = new Uint8Array(bytes);
  if (isDxf(u8)) { postMessage({ id, stage: 'parse' }); return parseDxf(u8); }
  const head = String.fromCharCode(...u8.slice(0, 6));
  if (!/^AC10\d\d$/.test(head)) {
    if (u8.length === 0) throw new Error('Dosya boş.');
    throw new Error('Bu bir DWG/DXF dosyası değil (başlık: ' + head.replace(/[^\x20-\x7e]/g, '?') + ').');
  }
  if (head < 'AC1012') throw new Error('Çok eski DWG sürümü (' + head + '). R13 ve sonrası açılabilir.');
  postMessage({ id, stage: 'lib' });
  if (!lib) lib = await LibreDwg.create();
  postMessage({ id, stage: 'parse' });
  let dwg;
  try { dwg = lib.dwg_read_data(u8, Dwg_File_Type.DWG); } catch (e) { throw new Error('LibreDWG dosyayı çözemedi: ' + (e.message || e)); }
  if (!dwg) throw new Error('LibreDWG dosyayı çözemedi (bozuk ya da şifreli olabilir).');
  let db;
  try { db = lib.convert(dwg); db.raw3d = collectRaw3D(lib, dwg, db); } finally { try { lib.dwg_free(dwg); } catch (_) { /* yoksay */ } }
  if (head >= 'AC1027') attachAcDs(u8, db);
  db.header = db.header || {};
  db.header.ACADVER = head;
  return db;
}

/**
 * Dönüştürücü yalnız 3DSOLID'i aktarır; REGION, BODY ve MESH varlıklarını düşürür. Bunlar için tanıtıcı,
 * katman, renk ve sahip blok bilgisiyle asgari varlık kayıtları üretilip veri tabanına eklenir ki sahne
 * kurucu ham 3B veriyi (raw3d) bu tanıtıcılarla bulabilsin.
 */
function synthesizeDropped(lib, db, byType, ownerOf, hex) {
  const names = { 37: 'REGION', 39: 'BODY', 663: 'MESH' };
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
  for (const t of [37, 39, 663]) {
    for (const o of byType[t] || []) {
      try {
        const h = hex(o); if (!h || seen.has(h)) continue;
        const ent = lib.dwg_object_to_entity(o); if (!ent) continue;
        let colorIndex = 256, color;
        try { const c = lib.dwg_object_entity_get_color_object(ent); if (c) { colorIndex = c.index; if (c.method === 194 || ((c.rgb >>> 24) & 255) === 194) color = c.rgb & 0xffffff; } } catch (_) { /* renk yok */ }
        let isVisible = true; try { isVisible = !lib.dwg_object_entity_get_invisible(ent); } catch (_) { /* geç */ }
        const root = ownerOf.get(o), ownerH = root ? hex(root) : null;
        const e = { type: names[t], handle: h, layer: layerName(ent), colorIndex, color, lineType: '', isVisible, ownerBlockRecordSoftId: ownerH };
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
      const walk = (list) => { for (const e of list || []) { if ((e.type === '3DSOLID' || e.type === 'REGION' || e.type === 'BODY') && e.handle && !(raw[e.handle] && raw[e.handle].acis)) empty.push(e.handle); } };
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
  const byType = { 37: [], 38: [], 39: [], 663: [] }, ownerOf = new Map();
  for (const root of roots) {
    let next = null, guard = 0;
    try { next = lib.get_first_owned_entity(root); } catch (_) { continue; }
    while (next && guard++ < 2000000) {
      try { const ft = lib.dwg_object_get_fixedtype(next); if (byType[ft]) { byType[ft].push(next); ownerOf.set(next, root); } } catch (_) { /* atla */ }
      try { next = lib.get_next_owned_entity(root, next); } catch (_) { break; }
    }
  }
  if (db) synthesizeDropped(lib, db, byType, ownerOf, hex);
  const objs = (t) => byType[t] || [];
  for (const t of [37, 38, 39]) {                              // REGION, 3DSOLID, BODY
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

self.onmessage = async (ev) => {
  const { id, cmd } = ev.data;
  try {
    if (cmd === 'parse') {
      const db = await readDb(ev.data.bytes, id);
      postMessage({ id, stage: 'scene' });
      const scene = new SceneBuilder(db).build();
      scene.version = db.header.ACADVER || '';
      if (scene.solidDiag) { scene.solidDiag.acds = db.acdsInfo || null; scene.solidDiag.samples = rawSamples(db.raw3d); }
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
