// Ortak sınama altyapısı: sunucu, tarayıcı, dosya açma, iddia sayacı.
// Betikler: import { args, startServer, launchBrowser, openFile, onDialog, checker } from './harness.mjs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '..');
export const samplesDir = path.join(projectRoot, 'samples');
export const outRoot = path.join(here, 'out');
/** Chromium'da yazılımsal WebGL (3B görünüm sınamaları için) */
export const WEBGL_ARGS = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
/** Sınama telefon görünümü (mevcut betiklerin ortak bağlam ayarı) */
export const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true };

/** Playwright paketi: PLAYWRIGHT_PKG ortam değişkeni, yoksa proje/global node_modules */
export function playwright() {
  const env = process.env.PLAYWRIGHT_PKG;
  const cands = [env && (env.endsWith('/') ? env : env + '/'), projectRoot + '/', '/opt/node22/lib/node_modules/'].filter(Boolean);
  let last;
  for (const c of cands) { try { return createRequire(c)('playwright'); } catch (e) { last = e; } }
  throw new Error('playwright bulunamadı; PLAYWRIGHT_PKG=<node_modules dizini> verin (' + (last && last.message) + ')');
}

/** Komut satırı: <çıktı> <örnekler> [3. arg]; varsayılan çıktı tools/out/<betik adı>, örnekler <proje>/samples */
export function args(scriptUrl) {
  const name = path.basename(fileURLToPath(scriptUrl), '.mjs');
  const out = path.resolve(process.argv[2] || path.join(outRoot, name));
  const samples = path.resolve(process.argv[3] || samplesDir);
  fs.mkdirSync(out, { recursive: true });
  return { name, out, samples, rest: process.argv.slice(4) };
}

/** serve.mjs'yi port 0 ile başlatır, gerçek adresi stdout'tan okur. */
export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(here, 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '', done = false;
    const timer = setTimeout(() => { if (!done) { done = true; proc.kill(); reject(new Error('sunucu 15 sn içinde hazır olmadı')); } }, 15000);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const m = /^(http:\/\/localhost:(\d+)\/)\s*$/m.exec(buf);
      if (m && !done) { done = true; clearTimeout(timer); resolve({ url: m[1], port: Number(m[2]), proc, kill: () => proc.kill() }); }
    });
    proc.on('exit', (code) => { if (!done) { done = true; clearTimeout(timer); reject(new Error('sunucu çıktı: ' + code)); } });
  });
}

/** Chromium'u WebGL bayraklarıyla açar (CHROMIUM_PATH verilmişse onu kullanır). */
export async function launchBrowser(opts = {}) {
  const { chromium } = playwright();
  return chromium.launch({ args: WEBGL_ARGS, executablePath: process.env.CHROMIUM_PATH || undefined, ...opts });
}

/** Uygulamanın dosya anahtarı (app.js setScene ile aynı kural) */
export const fileKeyOf = (file) => (path.basename(file) + '_' + fs.statSync(file).size).replace(/[^\w.-]+/g, '_');

/** #fileInput ile dosya yükler; hasDoc && loading.hidden (ve mümkünse yeni dosya anahtarı) bekler. */
export async function openFile(page, file, opts = {}) {
  const timeout = opts.timeout || 120000;
  const key = fileKeyOf(file);
  const prev = await page.evaluate(() => (window.dwgApp && window.dwgApp.state.fileKey) || '').catch(() => '');
  await page.setInputFiles('#fileInput', file);
  const want = prev === key ? '' : key;   // aynı dosya yeniden yükleniyorsa anahtar değişmez
  await page.waitForFunction((k) => { const a = window.dwgApp; return !!a && a.state.hasDoc && document.getElementById('loading').hidden && (!k || a.state.fileKey === k); }, want, { timeout });
  if (opts.settle) await page.waitForTimeout(opts.settle);
}

/** Otomatik sürüm denetiminin confirm penceresi mi? (sınama kuyruğunu bozmasın) */
export const isUpdateDialog = (d) => d.type() === 'confirm' && /sürüm|İndirme sayfası|version|download page/i.test(d.message());

/** Dialog işleyici: sürüm confirm'ü sessizce kapatılır, ötekiler handler'a gider (handler yoksa kapatılır). */
export function onDialog(page, handler) {
  page.on('dialog', async (d) => {
    try {
      if (isUpdateDialog(d)) { await d.dismiss(); return; }
      if (handler) await handler(d); else await d.dismiss();
    } catch (e) { console.log('[dialog]', e.message); }
  });
}

/** Uygulama içi giriş/onay kutusuna (dialog.js askText/askConfirm) sıradaki cevapları kuyruklar; kutu açılmaz, cevap hemen döner.
 *  Metin kutusu için dizgi (null = vazgeç), onay için true/false. */
export function queueAnswers(page, ...vals) {
  return page.evaluate((v) => { const h = (window.__ask = window.__ask || { queue: [], log: [] }); h.queue.push(...v); }, vals);
}
/** Şimdiye kadar istenen kutular: [{type:'text'|'confirm', label}] */
export function askLog(page) {
  return page.evaluate(() => (window.__ask && window.__ask.log) ? window.__ask.log.slice() : []);
}

/** Sayfaya sınama bayrağı koyar: window.__noUpdate (app.js checkUpdate bunu görünce döner). */
export function noUpdate(target) {
  return target.addInitScript(() => { window.__noUpdate = true; });
}

/** PASS/FAIL/SKIP sayacı; summary() "SONUÇ: N geçti, M kaldı" basar, exit() kaldı varsa 1 ile çıkar. */
export function checker() {
  const c = { passed: 0, failed: 0, skipped: 0 };
  c.ok = (name, cond, extra = '') => { if (cond) c.passed++; else c.failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); return !!cond; };
  c.skip = (name, why = '') => { c.skipped++; console.log('SKIP ' + name + (why ? ' ' + why : '')); };
  c.summary = (errors) => {
    console.log(`\nSONUÇ: ${c.passed} geçti, ${c.failed} kaldı` + (c.skipped ? `, ${c.skipped} atlandı` : '') + (errors ? `; sayfa hataları: ${errors.length}` : ''));
    if (errors) for (const e of errors) console.log('  err:', String(e).slice(0, 200));
  };
  c.exit = () => process.exit(c.failed ? 1 : 0);
  return c;
}
