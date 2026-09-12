// Bütün sınama betiklerini (tools/test_*.mjs, kendisi hariç) sırayla çalıştırır, SONUÇ satırlarını ve çıkış kodlarını toplar.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_all.mjs [ad…]   (ad verilirse yalnız adı geçenler: core editor …)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { here, projectRoot } from './harness.mjs';
const TIMEOUT_MS = 10 * 60 * 1000;
const filter = process.argv.slice(2);
let scripts = fs.readdirSync(here).filter(f => /^test_.*\.mjs$/.test(f) && f !== 'test_all.mjs').sort();
if (filter.length) scripts = scripts.filter(f => filter.some(n => f === n || f === `test_${n}.mjs` || f === `${n}.mjs`));
if (!scripts.length) { console.error('Çalıştırılacak betik yok:', filter.join(' ')); process.exit(2); }

function run(script) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(here, script)], { cwd: projectRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', timedOut = false;
    const onData = (d) => { const s = d.toString(); buf += s; process.stdout.write(s); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const m = buf.match(/SONUÇ:[^\n]*/g);
      resolve({ script, code: timedOut ? 'ZAMAN AŞIMI' : (code === null ? 'sinyal ' + signal : code), ok: !timedOut && code === 0, result: m ? m[m.length - 1].replace(/^SONUÇ:\s*/, '') : '(SONUÇ satırı yok)', secs: ((Date.now() - t0) / 1000).toFixed(0) });
    });
  });
}

const rows = [];
for (const s of scripts) {
  console.log(`\n${'='.repeat(70)}\n>>> ${s}\n${'='.repeat(70)}`);
  rows.push(await run(s));
}
const w = Math.max(...rows.map(r => r.script.length));
console.log(`\n${'='.repeat(70)}\nÖZET`);
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.script.padEnd(w)}  çıkış=${String(r.code).padEnd(4)} ${r.secs.padStart(4)} sn  ${r.result}`);
const failed = rows.filter(r => !r.ok);
console.log(`\nSONUÇ: ${rows.length - failed.length} betik geçti, ${failed.length} kaldı`);
process.exit(failed.length ? 1 : 0);
