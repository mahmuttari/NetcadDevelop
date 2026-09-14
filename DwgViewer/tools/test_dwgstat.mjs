// DWG ön yoklaması: nesne haritasından okunan nesne sayısı doğru mu, desteklenmeyen ve bozuk
// dosyalarda güvenli biçimde null dönüyor mu. Tarayıcı gerekmez, saf Node.
// Kullanım: node tools/test_dwgstat.mjs
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, checker } from './harness.mjs';
const { dwgObjectCount } = await import(path.join(projectRoot, 'app/src/main/assets/viewer/dwgstat.js'));
const C = checker(), ok = C.ok;
const read = (p) => new Uint8Array(fs.readFileSync(path.join(projectRoot, p)));
const stat = (p) => { try { return dwgObjectCount(read(p)); } catch (e) { return { err: String(e.message || e) }; } };

// ---- 1 R13 – R2000: sayı okunur -------------------------------------------------------------
const e2000 = stat('samples/example_2000.dwg');
ok('1a R2000 sayılıyor', e2000 && e2000.ver === 'AC1015' && e2000.objects === 750, JSON.stringify(e2000));
const p2000 = stat('samples/pface_2000.dwg');
ok('1b R2000 (pface) sayılıyor', p2000 && p2000.objects === 751, JSON.stringify(p2000));
const r14 = stat('samples/example_r14.dwg');
ok('1c R14 sayılıyor', r14 && r14.ver === 'AC1014' && r14.objects === 832, JSON.stringify(r14));

// ---- 2 R2004+ : harita sıkıştırılmıştır, okunmaz (null) --------------------------------------
for (const [n, f] of [['R2004', 'samples/example_2004.dwg'], ['R2007', 'samples/example_2007.dwg'], ['R2018', 'samples/example_2018.dwg']])
  ok(`2 ${n} null döner`, stat(f) === null, JSON.stringify(stat(f)));

// ---- 3 bozuk / kesik / DWG olmayan girdide çökmez --------------------------------------------
{ // kesik dosya (test_io üretir; yoksa yerinde kesilir)
  const src = path.join(projectRoot, 'tools/out/test_io/trunc60_2000.dwg');
  const b = fs.existsSync(src) ? new Uint8Array(fs.readFileSync(src)) : read('samples/example_2000.dwg').slice(0, Math.round(read('samples/example_2000.dwg').length * 0.6));
  ok('3a kesik dosya null', dwgObjectCount(b) === null);
}
ok('3b boş dizi null', dwgObjectCount(new Uint8Array(0)) === null);
ok('3c null girdi null', dwgObjectCount(null) === null);
ok('3d DXF metni null', dwgObjectCount(new Uint8Array(Buffer.from('0\nSECTION\n2\nHEADER\n'.padEnd(4096, ' ')))) === null);
{ // başlığı R2000 ama gövdesi çöp: bölüm konumu dosya dışına düşer, null olmalı
  const b = new Uint8Array(4096); b.set(Buffer.from('AC1015'));
  const dv = new DataView(b.buffer); dv.setUint32(0x15, 6, true);
  for (let i = 0; i < 6; i++) { const o = 0x19 + i * 9; b[o] = i; dv.setUint32(o + 1, 0x7fffff00, true); dv.setUint32(o + 5, 999999, true); }
  ok('3e bölüm konumu dosya dışında → null', dwgObjectCount(b) === null);
}
{ // rastgele bayt yığını: başlık tutmaz
  const b = new Uint8Array(8192); for (let i = 0; i < b.length; i++) b[i] = (i * 37) & 0xff;
  ok('3f rastgele bayt null', dwgObjectCount(b) === null);
}

// ---- 4 sayım gerçekten çözümleyicinin gördüğü nesne sayısıyla tutarlı mı ----------------------
// LibreDWG'nin num_objects'i haritadaki kayıt sayısıyla birebir aynı olmalıdır.
{
  const LW = await import(path.join(projectRoot, 'app/src/main/assets/viewer/lib/dist/libredwg-web.js'));
  const lib = await LW.LibreDwg.create();
  const W = lib.wasmInstance;
  const u8 = read('samples/example_2000.dwg');
  W.FS.createDataFile('/', 't.dwg', u8, true, false, true);
  const res = W.dwg_read_file('t.dwg');
  const n = res && res.data ? W.dwg_get_num_objects(res.data) : -1;
  ok('4 LibreDWG nesne sayısı ön yoklamayla aynı', n === 750, `libredwg=${n} önyoklama=${e2000 && e2000.objects}`);
  try { W.dwg_free(res.data); } catch (_) { /* geç */ }
}

C.summary();
C.exit();
