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
  try { db = lib.convert(dwg); } finally { try { lib.dwg_free(dwg); } catch (_) { /* yoksay */ } }
  db.header = db.header || {};
  db.header.ACADVER = head;
  return db;
}

self.onmessage = async (ev) => {
  const { id, cmd } = ev.data;
  try {
    if (cmd === 'parse') {
      const db = await readDb(ev.data.bytes, id);
      postMessage({ id, stage: 'scene' });
      const scene = new SceneBuilder(db).build();
      scene.version = db.header.ACADVER || '';
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
