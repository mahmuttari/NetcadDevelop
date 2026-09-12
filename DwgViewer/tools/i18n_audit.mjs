#!/usr/bin/env node
/*
 * i18n denetimi: viewer/*.js ve index.html içindeki t('…') / tt('…', '…') anahtarlarını ve
 * data-i18n / data-i18n-ph / data-i18n-title / data-i18n-aria özniteliklerini toplar, TR ve EN
 * sözlükleriyle karşılaştırır; ayrıca toast/prompt/confirm/alert/innerHTML/textContent gibi
 * kullanıcıya görünen yerlerdeki sabit Türkçe dizgileri listeler.
 *   node tools/i18n_audit.mjs [viewerDir]     → çıkış kodu 0: eksik anahtar yok
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = path.resolve(process.argv[2] || path.join(here, '..', 'app', 'src', 'main', 'assets', 'viewer')) + path.sep;

// Sözlükleri modülün kendisinden oku: addStrings ile kaydedilen anahtarlar da (editor.js karoları,
// tools.js araç adları) sayılsın. Modüller tarayıcı API'si beklediğinden hafif bir DOM taklidi kurulur.
const stub = () => new Proxy(function () {}, { get: (_, k) => k === Symbol.toPrimitive ? () => '' : (k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = stub(); try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'audit', language: 'tr', vibrate() {} }, configurable: true }); } catch (_) { /* yok */ }
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
globalThis.CustomEvent = class {}; globalThis.Worker = class { postMessage() {} };
globalThis.requestAnimationFrame = () => 0; globalThis.Image = class {}; globalThis.Path2D = class {};
globalThis.HTMLElement = class {}; globalThis.ResizeObserver = class { observe() {} }; globalThis.MutationObserver = class { observe() {} };
globalThis.addEventListener = () => {}; globalThis.dispatchEvent = () => true; globalThis.location = { href: 'file:///', hash: '', search: '' };
const i18n = await import(V + 'i18n.js');
for (const f of ['editor.js', 'tools.js']) { try { await import(V + f); } catch (e) { console.warn('uyarı:', f, 'yüklenemedi —', e.message.split('\n')[0]); } }
const TRk = new Set(Object.keys(i18n.TR)), ENk = new Set(Object.keys(i18n.EN));

const files = fs.readdirSync(V).filter(f => /\.(js|html)$/.test(f) && f !== 'i18n.js' && f !== 'codepage.js');
const missTR = {}, missEN = {}, ttFallback = {}, literals = {};
const add = (m, f, k) => (m[f] ||= new Set()).add(k);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length));
const TRc = /[çğıöşüÇĞİÖŞÜ]/;
const blank = (m) => m.replace(/[^\n]/g, ' ');
/** data-i18n taşıyan öğenin metni ve data-i18n-aria/-title/-ph taşıyan öğenin ilgili özniteliği başlangıçta Türkçe olsa da applyI18n ile değişir: sayılmaz */
function stripI18nHtml(h) {
  return h.replace(/<title>[^<]*<\/title>/i, (m) => blank(m)).replace(/<([a-z0-9]+)\b((?:"[^"]*"|[^<>"])*)>/gi, (tag, name, attrs) => {
    let a = attrs;
    if (/data-i18n-aria=/.test(a)) a = a.replace(/aria-label="[^"]*"/, (m) => blank(m));
    if (/data-i18n-title=/.test(a)) a = a.replace(/(?<![-\w])title="[^"]*"/, (m) => blank(m));
    if (/data-i18n-ph=/.test(a)) a = a.replace(/placeholder="[^"]*"/, (m) => blank(m));
    return `<${name}${a}>`;
  }).replace(/(<[a-z0-9]+\b[^<>]*\bdata-i18n="[^"]*"[^<>]*>)([^<]*)/gi, (m, tag, txt) => tag + blank(txt));
}
for (const f of files) {
  const raw = fs.readFileSync(V + f, 'utf8');
  const s = f.endsWith('.js') ? strip(raw) : stripI18nHtml(raw);
  for (const m of s.matchAll(/(?<![A-Za-z0-9_.$])tt?\(\s*(['"`])([A-Za-z0-9_:]+)\1\s*[,)]/g)) {   // 'tour' + n gibi önekler sayılmaz
    const k = m[2]; if (k.includes('$')) continue;   // şablon anahtarı (tl_${…}) — dinamik
    if (!TRk.has(k)) add(missTR, f, k); if (!ENk.has(k)) add(missEN, f, k);
    if (m[0].startsWith('tt') && !TRk.has(k)) add(ttFallback, f, k);
  }
  for (const m of s.matchAll(/data-i18n(?:-ph|-title|-aria)?=(['"])([^'"]+)\1/g)) { const k = m[2]; if (k.includes('$')) continue; if (!TRk.has(k)) add(missTR, f, k); if (!ENk.has(k)) add(missEN, f, k); }
  // Sabit Türkçe literal'ler: kullanıcıya görünen bağlamlar
  const lines = s.split('\n');
  lines.forEach((ln, i) => {
    if (!TRc.test(ln)) return;
    // tt('k', 'Türkçe yedek') yedekleri ve T('act', 'i-x', 'tr', 'en', …) karo tanımları sayılmaz (anahtarlıdır)
    const cleaned = ln.replace(/\btt\(\s*'[^']*'\s*,\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`)\s*\)/g, 'tt()').replace(/\bT\('[^']*',\s*'[^']*',\s*'[^']*',\s*'[^']*'(?:,\s*'[^']*')*\)/g, 'T()');
    if (!TRc.test(cleaned)) return;
    if (/\b(?:stepsEn|attrI18n|i18n):|,\s*en:\s*'/.test(cleaned)) return;   // anahtarlı kaynak tabloları (TOOLS, CRS, BASEMAPS): TR metin addStrings/sözlük ile eşlenir
    if (f.endsWith('.html')) {
      for (const m of cleaned.matchAll(/(?:aria-label|title|placeholder)="([^"]*[çğıöşüÇĞİÖŞÜ][^"]*)"/g)) add(literals, f, `${i + 1}: ${m[0]}`);
      for (const m of cleaned.matchAll(/>([^<>{}]*[çğıöşüÇĞİÖŞÜ][^<>{}]*)</g)) if (!/<!--/.test(ln)) add(literals, f, `${i + 1}: >${m[1].trim()}<`);
      return;
    }
    const ctx = /\b(?:toast|prompt|confirm|alert|say|openDoc|showPrompt|prompt3D|needDoc|ask|askText|askConfirm|setLoading|onStage|loadingSub|fail|kv|result|shareText|rows\.push|showResult)\s*\(|^\s*\[['"`]|\.(?:innerHTML|textContent|title|placeholder|ariaLabel)\s*[+]?=|setAttribute\(\s*['"](?:title|aria-label|placeholder)['"]|\b(?:label|title|name|text|msg|message|hint|cap|steps?|desc)\s*:\s*(['"`])/;
    if (!ctx.test(cleaned)) return;
    for (const m of cleaned.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*[çğıöşüÇĞİÖŞÜ](?:(?!\1)[^\\\n]|\\.)*)\1/g)) add(literals, f, `${i + 1}: ${m[0].slice(0, 90)}`);
  });
}
let bad = 0;
const rep = (title, m) => { for (const f of Object.keys(m).sort()) { console.log(`${title} ${f} (${m[f].size}): ${[...m[f]].join(' ')}`); } };
console.log(`TR anahtar ${TRk.size} · EN anahtar ${ENk.size}`);
const trOnly = [...TRk].filter(k => !ENk.has(k)), enOnly = [...ENk].filter(k => !TRk.has(k));
if (trOnly.length) { console.log('Yalnız TR:', trOnly.join(' ')); bad += trOnly.length; }
if (enOnly.length) { console.log('Yalnız EN:', enOnly.join(' ')); bad += enOnly.length; }
rep('TR sözlüğünde YOK', missTR); rep('EN sözlüğünde YOK', missEN); rep('tt() yedeğe düşen', ttFallback);
for (const m of [missTR, missEN]) for (const f in m) bad += m[f].size;
let lit = 0; for (const f of Object.keys(literals).sort()) { console.log(`Sabit Türkçe literal ${f} (${literals[f].size}):`); for (const l of literals[f]) console.log('   ' + l); lit += literals[f].size; }
console.log(`Özet: eksik anahtar ${bad}, sabit Türkçe literal ${lit}`);
process.exit(bad ? 1 : 0);
