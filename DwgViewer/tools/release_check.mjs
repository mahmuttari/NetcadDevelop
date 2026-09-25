// Sürüm tutarlılığı denetimi: app/build.gradle ↔ release/version.json ↔ README başlığı ↔ (varsa) release APK'sı
// (release/DwgGoruntuleyici.apk: paket adı com.mahmuttari.dwgviewer, etiket "DWG OfficeZip").
// Kullanım: node tools/release_check.mjs [--no-apk] [--apk <yol>] [--aapt <yol>]
//   --no-apk : APK denetimini atla (CI'da APK derlenmeden önce)
//   --apk    : verilen APK'yı denetle (paket adı ve etiket yine sınanır)
// Farklılık varsa 1 ile çıkar ve farkları listeler.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './harness.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const noApk = argv.includes('--no-apk');
// tek uygulama: Pro yetkisi çalışma zamanında (Play satın alması / lisans kodu), APK ve paket adı tektir
const PAKET = 'com.mahmuttari.dwgviewer', ETIKET = 'DWG OfficeZip';
const APKS = [{ ad: 'APK', yol: path.resolve(projectRoot, opt('--apk') || 'release/DwgGoruntuleyici.apk'), paket: PAKET, etiket: ETIKET }];
const problems = [];
const bad = (m) => { problems.push(m); console.log('FARK  ' + m); };
const good = (m) => console.log('OK    ' + m);
const warn = (m) => console.log('UYARI ' + m);
const rd = (f) => fs.readFileSync(path.join(projectRoot, f), 'utf8');
const hasUnzip = spawnSync('sh', ['-c', 'command -v unzip'], { encoding: 'utf8' }).status === 0;

const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.mahmuttari.dwgviewer';

// ---- kaynaklar ----
const gradle = rd('app/build.gradle');
const vc = Number((/versionCode\s+(\d+)/.exec(gradle) || [])[1]);
const vn = (/versionName\s+"([^"]+)"/.exec(gradle) || [])[1];
const readmeLine = rd('README.md').split(/\r?\n/)[0];
const rv = (/\bv(\d+(?:\.\d+)*)\b/.exec(readmeLine) || [])[1];
console.log(`build.gradle     versionCode=${vc} versionName=${vn}`);
if (!vc || !vn) bad('app/build.gradle içinde versionCode/versionName okunamadı');
for (const [f, apk] of [['release/version.json', 'DwgGoruntuleyici.apk']]) {
  let vj;
  try { vj = JSON.parse(rd(f)); } catch (e) { bad(`${f} okunamadı: ${e.message}`); continue; }
  const n = path.basename(f).padEnd(16);
  console.log(`${n} versionCode=${vj.versionCode} versionName=${vj.versionName} url=${vj.url}`);
  if (Number(vj.versionCode) === vc) good(`${f} versionCode = ${vc}`); else bad(`${f} versionCode ${vj.versionCode} ≠ build.gradle ${vc}`);
  if (vj.versionName === vn) good(`${f} versionName = ${vn}`); else bad(`${f} versionName "${vj.versionName}" ≠ build.gradle "${vn}"`);
  if (!/^https:\/\//.test(vj.url || '')) bad(`${f} url https ile başlamıyor`);
  // v8.9.6'dan beri uygulama Play'den güncellenir; version.json yalnız eski (GitHub APK'lı) kurulumları Play sayfasına yönlendirir
  else if (!vj.url.endsWith('/' + apk) && vj.url !== PLAY_URL) bad(`${f} url ne ${apk} ne Play sayfası: ${vj.url}`);
}
console.log(`README.md:1      ${readmeLine.trim()}  → v${rv}`);
if (rv === vn) good(`README başlığı v${vn}`); else bad(`README.md ilk satırı "v${rv}" ≠ build.gradle "${vn}"`);

// ---- APK ----
if (noApk) console.log('APK denetimi atlandı (--no-apk)');
else {
  const aapt = findAapt();
  if (!aapt) warn('aapt bulunamadı (--aapt, AAPT, ANDROID_HOME/ANDROID_SDK_ROOT, local.properties sdk.dir ya da PATH); badging denetimi atlandı');
  const varolan = APKS.filter(a => fs.existsSync(a.yol) || (warn(`${a.ad} yok: ${path.relative(projectRoot, a.yol)} (denetim atlandı)`), false));
  for (const a of varolan) checkApk(a, aapt);
}

console.log(problems.length ? `\nSONUÇ: ${problems.length} fark` : '\nSONUÇ: sürümler tutarlı');
process.exit(problems.length ? 1 : 0);

// ---------------------------------------------------------------------------
/** APK: badging (paket adı, etiket, versionCode/versionName) ve assets/viewer bayt eşitliği */
function checkApk(a, aapt) {
  const rel = path.relative(projectRoot, a.yol);
  if (aapt) {
    const r = spawnSync(aapt, ['dump', 'badging', a.yol], { encoding: 'utf8' });
    if (r.status !== 0) bad(`${a.ad}: aapt dump badging başarısız: ` + (r.stderr || '').slice(0, 200));
    else {
      const pkg = (/package: name='([^']*)'/.exec(r.stdout) || [])[1];
      const avc = Number((/versionCode='(\d+)'/.exec(r.stdout) || [])[1]), avn = (/versionName='([^']*)'/.exec(r.stdout) || [])[1];
      const label = (/application-label:'([^']*)'/.exec(r.stdout) || [])[1];
      console.log(`${a.ad.padEnd(16)} package=${pkg} versionCode=${avc} versionName=${avn} label="${label}" (${rel})`);
      if (pkg === a.paket) good(`${a.ad} paket adı ${a.paket}`); else bad(`${a.ad} paket adı "${pkg}" ≠ ${a.paket}`);
      if (label === a.etiket) good(`${a.ad} etiketi "${a.etiket}"`); else bad(`${a.ad} etiketi "${label}" ≠ "${a.etiket}"`);
      if (avc === vc) good(`${a.ad} versionCode = ${vc}`); else bad(`${a.ad} versionCode ${avc} ≠ build.gradle ${vc}`);
      if (avn === vn) good(`${a.ad} versionName = ${vn}`); else bad(`${a.ad} versionName "${avn}" ≠ build.gradle "${vn}"`);
    }
  }
  // gömülü görüntüleyici dosyaları bayt bayt kaynakla aynı mı?
  const srcDir = path.join(projectRoot, 'app/src/main/assets/viewer');
  // dwg de denetlenir: referans çizimler (ornekler/) APK'ya bozulmadan girmeli
  const files = walk(srcDir).filter(f => /\.(js|css|html|wasm|json|dwg)$/.test(f));
  const entries = zipEntries(a.yol);
  let same = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(srcDir, f));
    const inApk = zipRead(a.yol, entries, 'assets/viewer/' + f);
    if (!inApk) bad(`${a.ad} APK'da yok: assets/viewer/${f}`);
    else if (!src.equals(inApk)) bad(`${a.ad} APK'daki assets/viewer/${f} kaynaktan farklı (${inApk.length} ↔ ${src.length} bayt)`);
    else same++;
  }
  const extra = [...entries.keys()].filter(n => n.startsWith('assets/viewer/') && /\.(js|css|html|wasm|json)$/.test(n) && !files.includes(n.slice('assets/viewer/'.length)));
  for (const n of extra) bad(`${a.ad} APK'da fazla: ${n} (kaynakta yok)`);
  if (same === files.length && !extra.length) good(`${a.ad} assets/viewer: ${same} dosya bayt bayt aynı`); else console.log(`${a.ad} assets/viewer: ${same}/${files.length} dosya aynı`);
}
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
