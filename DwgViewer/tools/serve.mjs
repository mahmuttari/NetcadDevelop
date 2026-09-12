// Geliştirme sunucusu: app/src/main/assets/viewer klasörünü doğru MIME tipleriyle sunar.
// Kullanım: node tools/serve.mjs [port]   (port 0 → boş bir port seçilir; gerçek adres stdout'a basılır)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/src/main/assets/viewer');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.md': 'text/plain' };
const port = process.argv[2] === undefined ? 8765 : Number(process.argv[2]);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
server.listen(port, () => console.log(`http://localhost:${server.address().port}/`));
