#!/usr/bin/env node
/*
 * Dil dosyası denetimi: viewer/lang/<kod>.js dosyalarını tam anahtar kümesiyle karşılaştırır.
 *   node tools/lang_check.mjs [viewerDir] [--v]
 * Çıkış kodu 0: her dilde bütün anahtarlar var, fazlalık yok, yer tutucular tutuyor.
 *
 * Tam anahtar kümesi = i18n.js'in TR sözlüğü + editor.js ve tools.js'in addStrings ile
 * kaydettiği anahtarlar (karo adları, araç adları ve adım ipuçları).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(here, '..', 'app', 'src', 'main', 'assets', 'viewer')) + path.sep;
const verbose = process.argv.includes('--v');

const stub = () => new Proxy(function () {}, { get: (_, k) => k === Symbol.toPrimitive ? () => '' : (k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = stub(); try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'audit', language: 'tr', languages: ['tr'], vibrate() {} }, configurable: true }); } catch (_) { /* yok */ }
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
globalThis.CustomEvent = class {}; globalThis.Worker = class { postMessage() {} };
globalThis.requestAnimationFrame = () => 0; globalThis.Image = class {}; globalThis.Path2D = class {};
globalThis.HTMLElement = class {}; globalThis.ResizeObserver = class { observe() {} }; globalThis.MutationObserver = class { observe() {} };
globalThis.addEventListener = () => {}; globalThis.dispatchEvent = () => true; globalThis.location = { href: 'file:///', hash: '', search: '' };

const i18n = await import(V + 'i18n.js');
for (const f of ['editor.js', 'tools.js']) { try { await import(V + f); } catch (e) { console.warn('uyarı:', f, '—', e.message.split('\n')[0]); } }
const KEYS = Object.keys(i18n.TR);
const EN = i18n.EN, TR = i18n.TR;

/*
 * 3B ölçüm satır anahtarları VERİ olarak t()'ye gider (measure3d.js → editor.js geoRows), yani
 * statik literal taraması onları göremez. Eksik anahtar t() tarafından olduğu gibi döndürüldüğü
 * için kullanıcı ham 'dir' gibi bir metin görür. Burada kümenin tamamı TR sözlüğüne sınanır.
 */
let m3bad = 0;
try {
  const m3 = await import(V + 'measure3d.js');
  const m3keys = [...(m3.ROW_KEYS || []), ...(m3.PART_KEYS || [])];
  const miss3 = m3keys.filter(k => !(k in TR));
  if (miss3.length) { m3bad = miss3.length; console.log(`measure3d anahtarı TR sözlüğünde YOK (${miss3.length}): ${miss3.join(' ')}`); }
  else console.log(`measure3d anahtarları: ${m3keys.length} satır/parça anahtarının tamamı sözlükte`);
} catch (e) { console.warn('uyarı: measure3d.js —', e.message.split('\n')[0]); }

/** %1$s, {0}, {name} gibi yer tutucular çeviride de bulunmalı (biçim dizgileri bozulmasın) */
const holders = (s) => (String(s).match(/%\d*\$?[sd]|\{\w+\}/g) || []).sort().join(',');
/** Türkçe'ye özgü harfler: çeviri dosyasına sızmış Türkçe metnin izi */
const TRc = /[ığşĞİŞ]/;   // yalnız Türkçe'ye özgü harfler (ç ö ü Almanca ve Fransızca'da da var)

let bad = 0, warn = 0;
console.log(`Tam anahtar kümesi: ${KEYS.length} (i18n.js ${Object.keys(i18n.TR).length - 269} + addStrings 269)`);
const rows = [];
for (const id of i18n.LANG_IDS) {
  if (id === 'tr' || id === 'en') { rows.push([id, KEYS.length, 0, 0, 0, 'gömülü']); continue; }
  const file = V + 'lang/' + id + '.js';
  if (!fs.existsSync(file)) { console.log(`${id}: DOSYA YOK (${path.relative(process.cwd(), file)})`); bad++; rows.push([id, 0, KEYS.length, 0, 0, 'yok']); continue; }
  const mod = await import(file);
  const d = mod.default || mod.STRINGS;
  if (!d || typeof d !== 'object') { console.log(`${id}: varsayılan dışa aktarım bir nesne değil`); bad++; continue; }
  const have = new Set(Object.keys(d));
  const miss = KEYS.filter(k => !have.has(k));
  const extra = [...have].filter(k => !(k in TR));
  const same = KEYS.filter(k => have.has(k) && d[k] === EN[k] && String(EN[k]).length > 3 && !/^[A-Z0-9İÖÜÇŞĞ%°·×\-–—.,:;/()\s]+$/.test(String(EN[k])));
  const ph = KEYS.filter(k => have.has(k) && holders(d[k]) !== holders(EN[k]));
  const trleak = KEYS.filter(k => have.has(k) && d[k] !== TR[k] && TRc.test(String(d[k])) && !TRc.test(String(EN[k])));
  if (miss.length) { bad += miss.length; console.log(`${id}: EKSİK ${miss.length} → ${miss.slice(0, 25).join(' ')}${miss.length > 25 ? ' …' : ''}`); }
  if (extra.length) { bad += extra.length; console.log(`${id}: FAZLA ${extra.length} → ${extra.slice(0, 25).join(' ')}`); }
  if (ph.length) { bad += ph.length; console.log(`${id}: YER TUTUCU UYUŞMUYOR ${ph.length} → ${ph.slice(0, 10).join(' ')}`); }
  if (trleak.length) { warn += trleak.length; console.log(`${id}: Türkçe harf içeriyor ${trleak.length} → ${trleak.slice(0, 10).join(' ')}`); }
  if (same.length && verbose) console.log(`${id}: İngilizce ile birebir aynı ${same.length} → ${same.slice(0, 20).join(' ')}`);
  rows.push([id, have.size, miss.length, extra.length, same.length, miss.length || extra.length || ph.length ? 'HATA' : 'tamam']);
}
console.log('\nkod  anahtar  eksik  fazla  EN-aynı  durum');
for (const r of rows) console.log(String(r[0]).padEnd(5) + String(r[1]).padStart(7) + String(r[2]).padStart(7) + String(r[3]).padStart(7) + String(r[4]).padStart(9) + '  ' + r[5]);
console.log(`\nÖzet: hata ${bad + m3bad}, uyarı ${warn}`);
process.exit(bad + m3bad ? 1 : 0);
