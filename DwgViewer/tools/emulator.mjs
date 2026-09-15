/*
 * EMÜLATÖR BAĞLANTISI — APK'yı tarayıcıda çalışan gerçek bir Android cihazda açar.
 *
 * Neden bir araç: bu depoyu geliştiren ortamda emülatör çalıştırılamaz (donanım sanallaştırma
 * yok: /dev/kvm yok, işlemcide vmx/svm bayrağı yok, Android SDK yok). Emülatörü tarayıcıya
 * taşıyan hizmetler ise hesap ister. Bu araç, hesabı olan kişinin tek komutla bağlantı
 * üretmesini sağlar; belirteç (token) ne bu depoda ne de bir sohbet kaydında durur, yalnız
 * ortam değişkeninden okunur.
 *
 * Kullanım:
 *   APPETIZE_TOKEN=... node tools/emulator.mjs            # yeni uygulama oluşturur, bağlantı yazar
 *   APPETIZE_TOKEN=... node tools/emulator.mjs <publicKey> # var olan bağlantıyı günceller (adres değişmez)
 *
 * APK, deponun genel (public) adresinden çekilir; dosya yüklenmez, yalnız adres verilir.
 * Adres dalın son hâlini gösterir, yani önce push edilmiş olmalıdır.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAL = 'claude/dwg-viewer-apk-ykjk7a';
const APK_URL = `https://github.com/mahmuttari/NetcadDevelop/raw/${DAL}/DwgViewer/release/DwgGoruntuleyici.apk`;

const token = process.env.APPETIZE_TOKEN;
if (!token) {
  console.error('APPETIZE_TOKEN yok.\n'
    + '  1. appetize.io üzerinde ücretsiz hesap açın (Sign up).\n'
    + '  2. Account → API token bölümünden bir belirteç üretin.\n'
    + '  3. APPETIZE_TOKEN=<belirteç> node tools/emulator.mjs\n'
    + 'Belirteç yalnız bu komutun ortamında kalır; depoya yazılmaz.');
  process.exit(2);
}

/** release/version.json'dan sürüm: bağlantıya not olarak düşülür */
function surum() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(KOK, 'release/version.json'), 'utf8'));
    return `v${v.versionName} (versionCode ${v.versionCode})`;
  } catch (_) { return 'bilinmeyen sürüm'; }
}

const mevcut = process.argv[2] && /^[a-z0-9_-]+$/i.test(process.argv[2]) ? process.argv[2] : null;
const uc = mevcut ? `https://api.appetize.io/v1/apps/${mevcut}` : 'https://api.appetize.io/v1/apps';

const govde = {
  url: APK_URL,
  platform: 'android',
  fileType: 'apk',
  note: `DWG OfficeZip ${surum()}`,
  // Oturum, kullanıcı dokunmayı bıraktıktan 10 dakika sonra kapanır: büyük çizim açarken
  // varsayılan 120 sn yetmez.
  timeout: 600,
};

const r = await fetch(uc, {
  method: 'POST',
  headers: { 'X-API-KEY': token, 'Content-Type': 'application/json' },
  body: JSON.stringify(govde),
});
const metin = await r.text();
if (!r.ok) {
  console.error(`HATA ${r.status}: ${metin.slice(0, 500)}`);
  if (r.status === 401) console.error('Belirteç geçersiz ya da süresi dolmuş.');
  process.exit(1);
}
let j = null; try { j = JSON.parse(metin); } catch (_) { j = null; }
const key = (j && j.publicKey) || mevcut;
if (!key) { console.error('Yanıtta publicKey yok:', metin.slice(0, 300)); process.exit(1); }

console.log('APK       :', APK_URL);
console.log('Sürüm     :', govde.note);
console.log('publicKey :', key);
console.log('');
console.log('EMÜLATÖR BAĞLANTISI:');
console.log('  https://appetize.io/app/' + key);
console.log('');
console.log('Bir sonraki sürümde aynı adresi korumak için:');
console.log('  APPETIZE_TOKEN=... node tools/emulator.mjs ' + key);
