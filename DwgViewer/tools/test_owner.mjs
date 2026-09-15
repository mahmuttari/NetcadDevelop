// Sahip (geliştirici) hesabı yetkisi: Google ile giriş yapılan hesap Owner listesindeyse bütün
// özellikler açılır. Bu sınama iki şeyi korur:
//   A) KAYNAK DENETİMİ — özet sabiti doğru adresi karşılıyor mu, adres APK'ya düz yazılmış mı,
//      Pro/MainActivity/edition.js üçü de "owner" kaynağını tanıyor mu.
//   B) ARAYÜZ — köprü source:"owner" bildirdiğinde panel bunu dürüstçe gösteriyor, bütün kapılar
//      açılıyor ve reklam duruyor mu.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_owner.mjs [çıktı] [örnekler]
import { args, startServer, launchBrowser, onDialog, noUpdate, checker, PHONE } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const { out } = args(import.meta.url);
const C = checker(), ok = C.ok;
const JAVA = path.join(process.cwd(), 'app/src/main/java/com/mahmuttari/dwgviewer');
const VIEW = path.join(process.cwd(), 'app/src/main/assets/viewer');
const read = (p) => fs.readFileSync(p, 'utf8');
const errors = [];

// ---------------------------------------------------------------------------------
// A) Kaynak denetimi
// ---------------------------------------------------------------------------------
const OWNER_EMAIL = 'mahmuttari@gmail.com';
/** Owner.java'daki sadeleştirmenin birebir aynısı (bağımsız uygulama: ikisi ayrışırsa sınama düşer) */
function canon(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.indexOf('@');
  if (at <= 0 || at === e.length - 1) return '';
  let local = e.slice(0, at), domain = e.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const plus = local.indexOf('+');
    if (plus >= 0) local = local.slice(0, plus);
    local = local.split('.').join('');
    domain = 'gmail.com';
  }
  return local ? local + '@' + domain : '';
}
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const ownerJava = read(path.join(JAVA, 'Owner.java'));
const hashes = [...ownerJava.matchAll(/"([0-9a-fA-F]{64})"/g)].map(m => m[1].toLowerCase());
ok('A1 Owner.java tek bir özet taşıyor', hashes.length === 1, hashes.join(','));
ok('A2 özet, sahip adresinin sadeleştirilmiş hâlinin SHA-256\'sı', hashes[0] === sha(canon(OWNER_EMAIL)), `${hashes[0]} ↔ ${sha(canon(OWNER_EMAIL))}`);
ok('A3 sadeleştirme Gmail kuralını uyguluyor', canon('M.A.H+x@GoogleMail.com') === 'mah@gmail.com', canon('M.A.H+x@GoogleMail.com'));

// Adres HİÇBİR kaynakta düz yazılmamalı: APK'daki dizgeler `strings` ile okunur.
{
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(java|js|json|xml|html|css|gradle|properties|md)$/.test(f.name)) files.push(p); } };
  walk(path.join(process.cwd(), 'app/src'));
  const at = '@' + OWNER_EMAIL.split('@')[1];
  const alt = OWNER_EMAIL.split('@')[0] + at.replace('gmail.com', 'googlemail.com');
  const hits = files.filter(p => { const s = read(p); return s.includes(OWNER_EMAIL) || s.includes(alt); }).map(p => path.relative(process.cwd(), p));
  ok('A4 sahip adresi uygulama kaynaklarına DÜZ YAZILMAMIŞ (yalnız özeti gömülü)', hits.length === 0, hits.join(' '));
}

const proJava = read(path.join(JAVA, 'Pro.java'));
ok('A5 Pro.java üçüncü kaynağı tanıyor (okuma, en yüksek basamak, silme)',
  /KEY_OWNER\s*=\s*"owner"/.test(proJava) && /public JSONObject owner\(\)/.test(proJava)
  && /clearOwner/.test(proJava) && /owner\(\)/.test(proJava.split('public String edition()')[1] || ''));

const mainJava = read(path.join(JAVA, 'MainActivity.java'));
const syncCalls = (mainJava.match(/syncOwnerGrant\(\)/g) || []).length;
ok('A6 MainActivity üç yerde eşitliyor: açılış, giriş, çıkış (+ tanım)', syncCalls === 4, String(syncCalls));
ok('A7 çıkışta yetki geri alınıyor', /gSignOut\(\)\s*\{[\s\S]{0,260}syncOwnerGrant\(\)[\s\S]{0,60}revoked/.test(mainJava));
ok('A8 yetki, reklam kurulmadan ÖNCE eşitleniyor',
  mainJava.indexOf('syncOwnerGrant();') < mainJava.indexOf('ads = new Ads(this);'));

const ed = read(path.join(VIEW, 'edition.js'));
ok('A9 edition.js "owner" kaynağını kabul ediyor ve panelde gösteriyor',
  /o\.source === 'owner'/.test(ed) && /proSrcOwner/.test(ed));
ok('A10 "owner" nedeni etkinleştirme uyarısı veriyor', /r === 'owner'/.test(ed));

// ---------------------------------------------------------------------------------
// B) Arayüz: köprü source:"owner" derse panel ne gösteriyor
// ---------------------------------------------------------------------------------
const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext(PHONE);
await noUpdate(ctx);
await ctx.addInitScript(() => {
  let ed = 'free', src = 'none', mail = '';
  window.__adCalls = [];
  window.Android = {
    edition: () => ed,
    proInfo: () => JSON.stringify({ edition: ed, source: src, name: mail, exp: 0, plan: '', prices: {}, billingReady: true, licenseEnabled: true }),
    buyPro() {}, restorePro() {}, activateLicense: () => false,
    adsAvailable: () => ed === 'free', showAd: (r) => window.__adCalls.push(r), openUrl() {},
    appVersion: () => '7.33', versionCode: () => '56', updateUrl: () => '', getPendingFile: () => '', getRecent: () => '[]', pickFile() {},
    gSignIn: () => '', gSignOut() { ed = 'free'; src = 'none'; mail = ''; window.dwgApp.onEdition('free', 'revoked'); },
  };
  // Java'nın giriş sonrası yaptığının aynısı: yetki yazılır, sonra onEdition bildirilir
  window.__signInOwner = (email) => { ed = 'super'; src = 'owner'; mail = email; window.dwgApp.onEdition('super', 'owner'); };
});
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 200)); } });
onDialog(page, async d => { await d.dismiss(); });
const ev = (fn, a) => page.evaluate(fn, a);
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');
await ev(() => { localStorage.clear(); localStorage.setItem('ui', JSON.stringify({ hints: { tour: true } })); });
await page.reload(); await page.waitForSelector('#btnOpen2'); await page.waitForTimeout(200);

const state = () => ev(async () => {
  const Ed = await import('./edition.js');
  return { tier: Ed.tier(), noAds: Ed.noAds(), line: !document.getElementById('proLine').hidden,
    gates: ['t:line', 't:move', 'profile', 'compare', 'driveUpload', 'mesh3d'].filter(x => Ed.has(x)),
    locked: document.querySelectorAll('[data-need]').length };
});
const s0 = await state();
ok('B1 giriş öncesi: ücretsiz, kapılar kapalı, rozetler var', s0.tier === 'free' && !s0.noAds && s0.gates.length === 0 && s0.locked > 0, JSON.stringify(s0));

await ev(() => window.__signInOwner('mahmuttari@gmail.com'));
await page.waitForTimeout(350);
const s1 = await state();
ok('B2 sahip hesabıyla giriş: en üst pakete çıkar, BÜTÜN kapılar açılır, reklam durur',
  s1.tier === 'super' && s1.noAds && s1.gates.length === 6, JSON.stringify(s1));
ok('B3 kilit rozeti kalmaz', s1.locked === 0, String(s1.locked));
ok('B4 ana ekrandaki Pro tanıtım satırı kalkar', s1.line === false);

await ev(() => window.dwgApp.openProPanel());
await page.waitForTimeout(250);
const panel = await ev(() => { const p = document.getElementById('proPanel'); const h = p.querySelector('[data-pro-status]'); return { open: !p.hidden, status: h ? h.dataset.proStatus : null, txt: p.innerText.replace(/\s+/g, ' ') }; });
ok('B5 panel kaynağı DÜRÜSTÇE "Geliştirici hesabı" olarak gösterir (satın alma gibi göstermez)',
  panel.open && panel.status === 'owner' && /Geliştirici hesabı/.test(panel.txt) && /mahmuttari@gmail\.com/.test(panel.txt), JSON.stringify(panel).slice(0, 200));
await page.screenshot({ path: `${out}/owner_panel.png` });
await ev(() => window.dwgApp.onBack()); await page.waitForTimeout(100);

await ev(() => window.Android.gSignOut());
await page.waitForTimeout(350);
const s2 = await state();
ok('B6 çıkışta yetki geri alınır: ücretsize döner, kapılar kapanır, rozetler geri gelir',
  s2.tier === 'free' && !s2.noAds && s2.gates.length === 0 && s2.locked > 0, JSON.stringify(s2));

ok('B7 sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
