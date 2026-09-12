// Sürüm tutarlılığı denetimi: app/build.gradle ↔ release/version.json ↔ README başlığı ↔ (varsa) release APK'sı.
// Kullanım: node tools/release_check.mjs [--no-apk] [--apk <yol>] [--aapt <yol>]
//   --no-apk : APK denetimini atla (CI'da APK derlenmeden önce)
// Farklılık varsa 1 ile çıkar ve farkları listeler.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './harness.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const noApk = argv.includes('--no-apk');
const apkPath = path.resolve(projectRoot, opt('--apk') || 'release/DwgGoruntuleyici.apk');
const problems = [];
const bad = (m) => { problems.push(m); console.log('FARK  ' + m); };
const good = (m) => console.log('OK    ' + m);
const warn = (m) => console.log('UYARI ' + m);
const rd = (f) => fs.readFileSync(path.join(projectRoot, f), 'utf8');
const hasUnzip = spawnSync('sh', ['-c', 'command -v unzip'], { encoding: 'utf8' }).status === 0;

// ---- kaynaklar ----
const gradle = rd('app/build.gradle');
const vc = Number((/versionCode\s+(\d+)/.exec(gradle) || [])[1]);
const vn = (/versionName\s+"([^"]+)"/.exec(gradle) || [])[1];
const vj = JSON.parse(rd('release/version.json'));
const readmeLine = rd('README.md').split(/\r?\n/)[0];
const rv = (/\bv(\d+(?:\.\d+)*)\b/.exec(readmeLine) || [])[1];
console.log(`build.gradle     versionCode=${vc} versionName=${vn}`);
console.log(`version.json     versionCode=${vj.versionCode} versionName=${vj.versionName} url=${vj.url}`);
console.log(`README.md:1      ${readmeLine.trim()}  → v${rv}`);
if (!vc || !vn) bad('app/build.gradle içinde versionCode/versionName okunamadı');
if (Number(vj.versionCode) === vc) good(`version.json versionCode = ${vc}`); else bad(`version.json versionCode ${vj.versionCode} ≠ build.gradle ${vc}`);
if (vj.versionName === vn) good(`version.json versionName = ${vn}`); else bad(`version.json versionName "${vj.versionName}" ≠ build.gradle "${vn}"`);
if (rv === vn) good(`README başlığı v${vn}`); else bad(`README.md ilk satırı "v${rv}" ≠ build.gradle "${vn}"`);
if (!/^https:\/\//.test(vj.url || '')) bad('version.json url https ile başlamıyor');

// ---- APK ----
if (noApk) console.log('APK denetimi atlandı (--no-apk)');
else if (!fs.existsSync(apkPath)) warn(`APK yok: ${apkPath} (denetim atlandı)`);
else {
  const aapt = findAapt();
  if (!aapt) warn('aapt bulunamadı (--aapt, AAPT, ANDROID_HOME/ANDROID_SDK_ROOT, local.properties sdk.dir ya da PATH); badging denetimi atlandı');
  else {
    const r = spawnSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' });
    if (r.status !== 0) bad('aapt dump badging başarısız: ' + (r.stderr || '').slice(0, 200));
    else {
      const avc = Number((/versionCode='(\d+)'/.exec(r.stdout) || [])[1]), avn = (/versionName='([^']*)'/.exec(r.stdout) || [])[1];
      console.log(`APK              versionCode=${avc} versionName=${avn} (${path.relative(projectRoot, apkPath)})`);
      if (avc === vc) good(`APK versionCode = ${vc}`); else bad(`APK versionCode ${avc} ≠ build.gradle ${vc}`);
      if (avn === vn) good(`APK versionName = ${vn}`); else bad(`APK versionName "${avn}" ≠ build.gradle "${vn}"`);
    }
  }
  // gömülü görüntüleyici dosyaları bayt bayt kaynakla aynı mı?
  const srcDir = path.join(projectRoot, 'app/src/main/assets/viewer');
  const files = walk(srcDir).filter(f => /\.(js|css|html|wasm|json)$/.test(f));
  const entries = zipEntries(apkPath);
  let same = 0;
  for (const rel of files) {
    const src = fs.readFileSync(path.join(srcDir, rel));
    const inApk = zipRead(apkPath, entries, 'assets/viewer/' + rel);
    if (!inApk) bad(`APK'da yok: assets/viewer/${rel}`);
    else if (!src.equals(inApk)) bad(`APK'daki assets/viewer/${rel} kaynaktan farklı (${inApk.length} ↔ ${src.length} bayt)`);
    else same++;
  }
  const extra = [...entries.keys()].filter(n => n.startsWith('assets/viewer/') && /\.(js|css|html|wasm|json)$/.test(n) && !files.includes(n.slice('assets/viewer/'.length)));
  for (const n of extra) bad(`APK'da fazla: ${n} (kaynakta yok)`);
  if (same === files.length && !extra.length) good(`assets/viewer: ${same} dosya bayt bayt aynı`); else console.log(`assets/viewer: ${same}/${files.length} dosya aynı`);
}

console.log(problems.length ? `\nSONUÇ: ${problems.length} fark` : '\nSONUÇ: sürümler tutarlı');
process.exit(problems.length ? 1 : 0);

// ---------------------------------------------------------------------------
function findAapt() {
  const cands = [opt('--aapt'), process.env.AAPT];
  const sdks = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT];
  try { const lp = rd('local.properties'); const m = /^sdk\.dir=(.+)$/m.exec(lp); if (m) sdks.push(m[1].trim().replace(/\\:/g, ':')); } catch (_) { /* yok */ }
  for (const sdk of sdks.filter(Boolean)) {
    const bt = path.join(sdk, 'build-tools');
    if (!fs.existsSync(bt)) continue;
    const vers = fs.readdirSync(bt).filter(v => fs.existsSync(path.join(bt, v, 'aapt'))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of vers) cands.push(path.join(bt, v, 'aapt'));
  }
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  const w = spawnSync('sh', ['-c', 'command -v aapt'], { encoding: 'utf8' });
  return w.status === 0 ? w.stdout.trim() : null;
}
function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) { const rel = base ? base + '/' + e.name : e.name; if (e.isDirectory()) out.push(...walk(dir, rel)); else out.push(rel); }
  return out;
}
/** ZIP merkezi dizinini okur: ad → { off, method, csize } (unzip varsa okuma için o kullanılır) */
function zipEntries(file) {
  const b = fs.readFileSync(file);
  let e = b.length - 22; while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP sonu bulunamadı: ' + file);
  const n = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16);
  const map = new Map();
  for (let i = 0; i < n; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP merkezi dizin bozuk');
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    map.set(b.toString('utf8', p + 46, p + 46 + nl), { off, method, csize });
    p += 46 + nl + el + cl;
  }
  map.buffer = b;
  return map;
}
function zipRead(file, entries, name) {
  const ent = entries.get(name); if (!ent) return null;
  if (hasUnzip) { const r = spawnSync('unzip', ['-p', file, name], { maxBuffer: 64 * 1024 * 1024 }); if (r.status === 0) return r.stdout; }
  const b = entries.buffer, lh = ent.off;
  const nl = b.readUInt16LE(lh + 26), el = b.readUInt16LE(lh + 28), start = lh + 30 + nl + el;
  const data = b.subarray(start, start + ent.csize);
  return ent.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
}
