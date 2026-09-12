// DWG Görüntüleyici çevrimdışı Pro lisans kodu aracı (Node 22, yalnız node:crypto).
//
//   node tools/license_gen.mjs keygen --out <özel.pem>
//       RSA-2048 anahtar çifti üretir; özel anahtarı PEM (PKCS#8) olarak dosyaya yazar, açık anahtarı Base64 X.509
//       SubjectPublicKeyInfo olarak stdout'a basar → gradle.properties → LICENSE_PUBLIC_KEY. Özel anahtar depoya GİRMEZ
//       (varsayılan yer keystore/license_private.pem, .gitignore'da).
//   node tools/license_gen.mjs sign --key <özel.pem> --name <ad> [--expires YYYY-MM-DD] [--sku dwg_pro]
//       Lisans kodu basar: "DWGPRO-" + base64url(payload) + "." + base64url(imza)
//       payload UTF-8 JSON {"p":"dwg_pro","n":"<ad>","e":<bitiş epoch saniye ya da 0>}
//       İmza: SHA256withRSA (PKCS#1 v1.5), base64url(payload) DİZESİNİN UTF-8 baytları üzerinden — Java tarafı
//       (License.java) aynı baytları doğrular; JSON yeniden serileştirilmez.
//   node tools/license_gen.mjs verify --pub <base64 spki> <kod>
//       Kodu doğrular; geçerliyse payload'ı basar ve 0 ile, değilse 1 ile çıkar.
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, createSign, createVerify, createPublicKey, createPrivateKey } from 'node:crypto';

const PREFIX = 'DWGPRO-';
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Kod üretimi (imza payload'ın base64url dizesi üzerinden) */
export function sign(privatePem, { name, expires = 0, sku = 'dwg_pro' }) {
  const payload = b64url(Buffer.from(JSON.stringify({ p: sku, n: name, e: expires }), 'utf8'));
  const s = createSign('sha256'); s.update(Buffer.from(payload, 'utf8')); s.end();
  return PREFIX + payload + '.' + b64url(s.sign(createPrivateKey(privatePem)));
}

/** Doğrulama: payload nesnesi ya da null (imza, sku ve bitiş tarihi denetlenir; License.java ile aynı kurallar) */
export function verify(pubB64, code, { sku = 'dwg_pro', now = Math.floor(Date.now() / 1000) } = {}) {
  try {
    if (!code.startsWith(PREFIX)) return null;
    const [payload, sig] = code.slice(PREFIX.length).split('.');
    if (!payload || !sig) return null;
    const pub = createPublicKey({ key: Buffer.from(pubB64, 'base64'), format: 'der', type: 'spki' });
    const v = createVerify('sha256'); v.update(Buffer.from(payload, 'utf8')); v.end();
    if (!v.verify(pub, Buffer.from(sig, 'base64url'))) return null;
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (p.p !== sku) return null;
    if (p.e && p.e <= now) return null;
    return p;
  } catch (_) { return null; }
}

/** YYYY-MM-DD → o günün sonu (23:59:59 UTC) epoch saniye */
function parseExpires(s) {
  if (!s) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error('--expires biçimi YYYY-MM-DD olmalı: ' + s);
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59) / 1000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === 'keygen') {
      const out = opt('--out') || 'keystore/license_private.pem';
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      process.stderr.write(`özel anahtar yazıldı: ${out} (depoya girmez)\naçık anahtar (gradle.properties → LICENSE_PUBLIC_KEY):\n`);
      process.stdout.write(publicKey.export({ type: 'spki', format: 'der' }).toString('base64') + '\n');
    } else if (cmd === 'sign') {
      const key = opt('--key'), name = opt('--name');
      if (!key || !name) throw new Error('kullanım: sign --key <özel.pem> --name <ad> [--expires YYYY-MM-DD] [--sku dwg_pro]');
      process.stdout.write(sign(fs.readFileSync(key, 'utf8'), { name, expires: parseExpires(opt('--expires')), sku: opt('--sku') || 'dwg_pro' }) + '\n');
    } else if (cmd === 'verify') {
      const pub = opt('--pub'), code = argv.filter((a, i) => i > 0 && argv[i - 1] !== '--pub' && argv[i - 1] !== '--sku' && a !== '--pub' && a !== '--sku').pop();
      if (!pub || !code) throw new Error('kullanım: verify --pub <base64> [--sku dwg_pro] <kod>');
      const p = verify(pub, code, { sku: opt('--sku') || 'dwg_pro' });
      if (!p) { console.log('GEÇERSİZ'); process.exit(1); }
      console.log('GEÇERLİ ' + JSON.stringify(p) + (p.e ? ' (bitiş ' + new Date(p.e * 1000).toISOString().slice(0, 10) + ')' : ' (süresiz)'));
    } else {
      console.log('kullanım: license_gen.mjs keygen --out <özel.pem> | sign --key <özel.pem> --name <ad> [--expires YYYY-MM-DD] [--sku dwg_pro] | verify --pub <base64> <kod>');
      process.exit(2);
    }
  } catch (e) { console.error('HATA ' + e.message); process.exit(1); }
}
