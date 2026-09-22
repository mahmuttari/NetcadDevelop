/*
 * GLSL KAYNAK DENETİMİ (viewer/view3d.js içindeki VS ve FS).
 *
 * Bir gölgelendirici programı BAĞLANMAZSA (link) `new View3D()` atar ve 3B görünüm hiç açılmaz;
 * tarayıcılı sınamalarda bu "WebGL yok" gibi görünür, asıl neden gizlenir. Bağlanmama nedenlerinin
 * en sinsisi GLSL ES 1.00'in şu kuralıdır: AYNI ADLI uniform iki aşamada da bildirilmişse TÜRÜ VE
 * DUYARLILIĞI (precision) birebir aynı olmalıdır. Köşe aşamasında öntanımlı duyarlılık float ve int
 * için highp'tir; parça aşamasında float için bildirilen değer (burada mediump), int için mediump'tir.
 * Yani parça aşamasına `uniform vec3 uViewDir;` yazmak, köşe aşamasındaki highp ile çakışır.
 *
 * Bu sınama tarayıcı açmaz: kaynağı okur, iki gölgelendiriciyi ayırır ve bildirimleri karşılaştırır.
 * Ayrıca uniform konum listesinin (JS tarafındaki ad dizisi) gölgelendiricilerle aynı kümeyi
 * taşıdığını sınar — listeye eklenmemiş bir uniform sessizce null konum alır ve hiç yazılamaz.
 *
 * Kullanım: node tools/test_3d_shader.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { checker, projectRoot } from './harness.mjs';

const C = checker(), ok = C.ok;
const KAYNAK = path.join(projectRoot, 'app', 'src', 'main', 'assets', 'viewer', 'view3d.js');
const src = fs.readFileSync(KAYNAK, 'utf8');

/** `const AD = ` ... `;` biçimindeki şablon dizgisini çıkarır */
function sablon(ad) {
  const bas = src.indexOf('const ' + ad + ' = `');
  if (bas < 0) return null;
  const i0 = src.indexOf('`', bas) + 1;
  const i1 = src.indexOf('`', i0);
  return i1 > i0 ? src.slice(i0, i1) : null;
}
/** GLSL yorumlarını atar (satır ve blok) */
const yorumsuz = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const VS = sablon('VS'), FS = sablon('FS');
ok('1a köşe gölgelendiricisi bulundu', !!VS && VS.includes('gl_Position'));
ok('1b parça gölgelendiricisi bulundu', !!FS && FS.includes('gl_FragColor'));
if (!VS || !FS) { C.summary(); C.exit(); }

const FLOATLU = /^(float|vec[234]|mat[234])$/;
const INTLI = /^(int|ivec[234])$/;
const BOOLLU = /^(bool|bvec[234])$/;

/** Bir aşamanın bildirimlerini çözer: {uniform, varying, attribute, oncelik} */
function coz(kod, asama) {
  const g = yorumsuz(kod);
  // öntanımlı duyarlılıklar
  const on = asama === 'vs'
    ? { float: 'highp', int: 'highp' }
    : { float: null, int: 'mediump' };           // parça aşamasında float için öntanımlı YOKTUR
  for (const m of g.matchAll(/\bprecision\s+(lowp|mediump|highp)\s+(float|int)\s*;/g)) on[m[2]] = m[1];
  const out = { uniform: new Map(), varying: new Map(), attribute: new Map(), on };
  for (const ham of g.split(';')) {
    const st = ham.trim().replace(/\s+/g, ' ');
    const m = /^(uniform|varying|attribute) (?:(lowp|mediump|highp) )?([A-Za-z_]\w*) ([A-Za-z_]\w*)(\[\s*\d+\s*\])?$/.exec(st);
    if (!m) continue;
    const [, tur, acik, tip, ad] = m;
    let duyar;
    if (BOOLLU.test(tip)) duyar = 'yok';               // bool'un duyarlılığı yoktur
    else if (acik) duyar = acik;
    else if (FLOATLU.test(tip)) duyar = on.float;
    else if (INTLI.test(tip)) duyar = on.int;
    else duyar = 'bilinmiyor';
    out[tur].set(ad, { tip, duyar, acik: !!acik });
  }
  return out;
}

const vs = coz(VS, 'vs'), fs_ = coz(FS, 'fs');

ok('2a parça aşamasında öntanımlı float duyarlılığı bildirilmiş', fs_.on.float !== null, String(fs_.on.float));
ok('2b köşe aşamasında uniform bulundu', vs.uniform.size > 10, String(vs.uniform.size));
ok('2c parça aşamasında uniform bulundu', fs_.uniform.size > 5, String(fs_.uniform.size));

// ---- iki aşamada da bildirilen uniform'lar: tür ve duyarlılık birebir aynı olmalı ----
const ortak = [...vs.uniform.keys()].filter(n => fs_.uniform.has(n)).sort();
ok('3a ortak uniform var (kural işletiliyor)', ortak.length > 0, ortak.join(','));
{
  const turFark = ortak.filter(n => vs.uniform.get(n).tip !== fs_.uniform.get(n).tip);
  ok('3b ortak uniform türleri aynı', turFark.length === 0, turFark.join(','));
  const duyarFark = ortak.filter(n => vs.uniform.get(n).duyar !== fs_.uniform.get(n).duyar)
    .map(n => `${n}: vs=${vs.uniform.get(n).duyar} fs=${fs_.uniform.get(n).duyar}`);
  ok('3c ortak uniform duyarlılıkları aynı (yoksa program BAĞLANMAZ)', duyarFark.length === 0, duyarFark.join(' | '));
  // duyarlılık öntanımlıya bırakılmamalı: iki aşamanın öntanımlısı farklı olduğundan bu kırılgandır
  const kapali = ortak.filter(n => !BOOLLU.test(vs.uniform.get(n).tip) && !fs_.uniform.get(n).acik);
  ok('3d ortak uniform parça aşamasında AÇIK duyarlılıkla yazılmış', kapali.length === 0, kapali.join(','));
}

// ---- varying'ler: parça aşamasındaki her varying köşe aşamasında da aynı türle olmalı ----
{
  const eksik = [...fs_.varying.keys()].filter(n => !vs.varying.has(n));
  ok('4a parça varying\'lerinin tamamı köşe aşamasında da bildirilmiş', eksik.length === 0, eksik.join(','));
  const turFark = [...fs_.varying.keys()].filter(n => vs.varying.has(n) && vs.varying.get(n).tip !== fs_.varying.get(n).tip);
  ok('4b varying türleri aynı', turFark.length === 0, turFark.join(','));
  const yazilmayan = [...vs.varying.keys()].filter(n => !new RegExp('\\b' + n + '\\s*=').test(yorumsuz(VS)));
  ok('4c her varying köşe aşamasında yazılıyor', yazilmayan.length === 0, yazilmayan.join(','));
}

// ---- JS tarafındaki uniform ad listesi ile gölgelendiriciler aynı kümeyi taşımalı ----
const liste = (() => {
  const m = /for \(const n of \[([^\]]*)\]\) this\.u\[n\] = gl\.getUniformLocation/.exec(src);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();
ok('5a uniform konum listesi bulundu', Array.isArray(liste) && liste.length > 0, liste ? String(liste.length) : 'yok');
if (liste) {
  const bildirilen = new Set([...vs.uniform.keys(), ...fs_.uniform.keys()]);
  const fazla = liste.filter(n => !bildirilen.has(n));
  ok('5b listedeki her ad gölgelendiricide bildirilmiş', fazla.length === 0, fazla.join(','));
  const eksik = [...bildirilen].filter(n => !liste.includes(n));
  ok('5c bildirilen her uniform listede var', eksik.length === 0, eksik.join(','));
  const yinelenen = liste.filter((n, i) => liste.indexOf(n) !== i);
  ok('5d listede yinelenen ad yok', yinelenen.length === 0, yinelenen.join(','));
  // JS gövdesinde u.uXxx olarak kullanılan her ad listede olmalı (yoksa undefined konum yazılır)
  const kullanilan = [...new Set([...src.matchAll(/\bu\.(u[A-Z]\w*)/g)].map(m => m[1]))];
  const tanimsiz = kullanilan.filter(n => !liste.includes(n));
  ok('5e JS\'te kullanılan her uniform listede var', tanimsiz.length === 0, tanimsiz.join(','));
}

// ---- öznitelikler ----
{
  const cekilen = [...new Set([...src.matchAll(/getAttribLocation\(prog, '(\w+)'\)/g)].map(m => m[1]))];
  const eksik = cekilen.filter(n => !vs.attribute.has(n));
  ok('6a çekilen her öznitelik köşe aşamasında bildirilmiş', eksik.length === 0, eksik.join(','));
  const kullanilmayan = [...vs.attribute.keys()].filter(n => !cekilen.includes(n));
  ok('6b bildirilen her öznitelik JS tarafında çekiliyor', kullanilmayan.length === 0, kullanilmayan.join(','));
}

// ---- gölgelendirici gövdesi: GLSL ES 1.00'de olmayan söz dizimi ----
{
  const g = yorumsuz(VS) + '\n' + yorumsuz(FS);
  ok('7a ES 3.00 söz dizimi (in/out/texture) kullanılmıyor', !/\b(in|out|flat)\s+(?:lowp|mediump|highp\s+)?(?:float|vec[234]|mat[234]|int)\b/.test(g) && !/\btexture\s*\(/.test(g));
  ok('7b tamsayı bölme / tamsayı-kesir karışımı yok (1e-6 gibi payda korunuyor)', /max\(uFadeRange\.y - uFadeRange\.x, 1e-6\)/.test(g));
  const suslu = (s) => { let d = 0; for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d--; if (d < 0) return false; } return d === 0; };
  ok('7c süslü parantezler dengeli', suslu(g));
}

C.summary();
C.exit();
