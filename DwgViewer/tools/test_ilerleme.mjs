// Açılış yüzdesi — GERÇEK ZAMAN ÇİZELGESİ ÜZERİNDE ÖLÇÜM.
//
// Bu sınamanın sebebi kullanıcının bildirdiği somut kusurdur: "%96'ya gelip dakikalarca
// bekledi, sanki donuyormuş hissi oluşuyor." Yüzde ya gerçek ilerlemeye bağlanıyordu (sessiz
// aşamada donuyor), ya da gerçekten koparılıyordu (dosyayla ilgisi kalmıyor). Burada ölçülen
// üç şeydir ve üçü de gözle değil sayıyla sınanır:
//
//   1. Yüzde GERİ GİTMİYOR mu?  (çok paftalı çizimde sahne sayacı eskiden başa dönüyordu)
//   2. Bant haritası tutarlı mı? (hangi yüzde hangi bandın içinde)
//   3. Kestirim ve öğrenme doğru çalışıyor mu? (cihazın hızı ölçülüp düzeltiliyor mu)
//
// Kotlin tarafındaki kestirimcinin ÜÇ DEĞİŞMEZİ — asla durmaz, asla sıçramaz, asla geri gitmez —
// burada aynı formülün bir örneği üzerinde sınanır; formülün Kotlin kaynağındaki karşılığını
// tools/test_acilis.mjs satır satır denetler. Öykünücü olmadığı için ekranın kendisi bu
// ortamda çalıştırılamaz.
// Kullanım: PLAYWRIGHT_PKG=<node_modules> node tools/test_ilerleme.mjs [çıktı]
import { args, startServer, launchBrowser, openFile, noUpdate, checker, PHONE, samplesDir } from './harness.mjs';
import path from 'node:path';

const SM = samplesDir;

args(import.meta.url);
const C = checker(), ok = C.ok;
const errors = [];

const srv = await startServer();
const browser = await launchBrowser();
const ctx = await browser.newContext({ ...PHONE, viewport: { width: 412, height: 780 } });
await noUpdate(ctx);
const page = await ctx.newPage();
page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
await page.goto(srv.url + 'index.html');
await page.waitForSelector('#btnOpen2');

// --- A) Bant haritası -----------------------------------------------------------------------
{
  const r = await page.evaluate(() => {
    const B = window.dwgApp.__band;
    return [0, 1, 13.9, 14, 44.9, 45, 69.9, 70, 91.9, 92, 98, 99, 100].map(v => {
      const b = B(v); return { v, ad: b.ad, alt: b.alt, ust: b.ust, i: b.i };
    });
  });
  const al = (v) => r.find(x => x.v === v);
  ok('A1 bant haritası: %1 lib, %14 parse, %45 scene, %70 index, %92 view',
    al(1).ad === 'lib' && al(14).ad === 'parse' && al(45).ad === 'scene'
    && al(70).ad === 'index' && al(92).ad === 'view',
    r.map(x => `${x.v}→${x.ad}`).join(' '));
  ok('A2 bant sınırları bitişik ve artan (boşluk ya da çakışma yok)',
    r.every(x => x.alt < x.ust) && al(14).alt === 14 && al(13.9).ust === 14 && al(45).alt === 45 && al(44.9).ust === 45);
  ok('A3 bant dizini yüzdeyle birlikte artıyor',
    al(1).i === 0 && al(14).i === 1 && al(45).i === 2 && al(70).i === 3 && al(92).i === 4);
  ok('A4 en üst bant 99\'da biter: serbest akış 100 YAZAMAZ', al(99).ust === 99 && al(100).ust === 99);
}

// --- B) Süre kestirimi ve cihazın kendi hızını öğrenmesi ------------------------------------
{
  const r = await page.evaluate(() => {
    const T = window.dwgApp.__tahminTaban, O = window.dwgApp.__olcek;
    return {
      kucuk: T(500, 0.5), orta: T(200000, 20), buyuk: T(3000000, 300),
      taban: T(0, 0), olcek: O(),
      bant: window.dwgApp.__bantBeklenen({ i: 1, ad: 'parse', alt: 14, ust: 45 }),
      bantView: window.dwgApp.__bantBeklenen({ i: 4, ad: 'view', alt: 92, ust: 99 }),
    };
  });
  ok('B1 kestirim dosya büyüdükçe artıyor (nesne ve boyutla)',
    r.kucuk < r.orta && r.orta < r.buyuk, `${Math.round(r.kucuk)} < ${Math.round(r.orta)} < ${Math.round(r.buyuk)} ms`);
  ok('B2 taban var: çok küçük dosyada bile geçiş görülecek kadar süre ayrılıyor',
    r.taban >= 600, String(r.taban));
  ok('B3 öğrenilmiş ölçek makul aralıkta (ilk koşuda 1)', r.olcek > 0 && r.olcek <= 12, String(r.olcek));
  ok('B4 bandın beklenen süresi gerçek ağırlıkla orantılı (parse > view)',
    r.bant > r.bantView, `${Math.round(r.bant)} > ${Math.round(r.bantView)} ms`);
}

// --- B2) Bant payları ÖLÇÜMDEN gelir, bant genişliğinden değil -----------------------------
// Bu ayrım kritiktir: genişliğe göre dağıtılan bütçede çözümleme bandı 2,7 kat küçük kalıyor
// (ölçüm: çözümleme sürenin %85-89'unu tutuyor ama çubuğun %31,6'sını), zaman ekseni hemen
// kuyruğa giriyor ve sayı bandın tavanına yapışıyordu — donma bu kez %44'te tekrarlardı.
{
  const r = await page.evaluate(() => {
    // Gerçek bir açılış kurulur (2 milyon nesne, 300 MB): taban 120 ms'lik alt sınır
    // oranları bozmasın, paylar görünür olsun.
    window.dwgApp.__kestirimBasla(2000000, 300);
    const B = window.dwgApp.__bantBeklenen;
    const b = (ad, alt, ust, i) => ({ i, ad, alt, ust });
    const sure = {
      lib: B(b('lib', 1, 14, 0)), parse: B(b('parse', 14, 45, 1)), scene: B(b('scene', 45, 70, 2)),
      index: B(b('index', 70, 92, 3)), view: B(b('view', 92, 99, 4)),
    };
    const genislik = { lib: 13, parse: 31, scene: 25, index: 22, view: 7 };
    return { sure, genislik, toplam: Object.values(sure).reduce((a, x) => a + x, 0) };
  });
  const pay = (k) => r.sure[k] / r.toplam;
  ok('B5 çözümleme bandı bütçenin yarısından fazlasını alıyor (genişliği %31,6 olsa da)',
    pay('parse') > 0.5, `%${(100 * pay('parse')).toFixed(1)}`);
  ok('B6 indeks bandı bütçenin küçük bir payını alıyor (genişliği %22,4 olsa da)',
    pay('index') < 0.2, `%${(100 * pay('index')).toFixed(1)}`);
  ok('B7 paylar bant genişliğiyle ORANTILI DEĞİL (ölçümden geliyor)',
    Math.abs(pay('parse') - 31 / 98) > 0.2, `pay %${(100 * pay('parse')).toFixed(1)} · genişlik %${(100 * 31 / 98).toFixed(1)}`);
  ok('B8 her bandın bir bütçesi var (hiçbiri sıfır değil)',
    Object.values(r.sure).every(x => x >= 120), Object.entries(r.sure).map(([k, v]) => `${k}:${Math.round(v)}`).join(' '));
}

// --- C) Kestirimcinin üç değişmezi ----------------------------------------------------------
// Kotlin'deki formülün aynısı. Burada 0,1 sn'lik adımlarla 10 dakikalık bir açılış öykünülür:
// bir bant içinde gerçek yüzde HİÇ gelmezse bile sayı durmamalı, bandı da aşmamalıdır.
{
  const DOGRUSAL_PAY = 0.85, KUYRUK = 2.0, ENCOK_HIZ = 26;
  const egri = (u) => u <= DOGRUSAL_PAY ? u : DOGRUSAL_PAY + (1 - DOGRUSAL_PAY) * (1 - 1 / (1 + (u - DOGRUSAL_PAY) * KUYRUK));
  const kos = (opt) => {
    const { bantAlt, bantUst, beklenenMs, sureMs, gercekF, tavan } = opt;
    let g = bantAlt, t = 0, enKucukArtis = Infinity, enBuyukArtis = 0, geri = 0, oncekiG = g;
    const dt = 0.1;
    while (t < sureMs) {
      t += dt * 1000;
      const u = t / beklenenMs;
      const zaman = bantAlt + (bantUst - bantAlt) * Math.min(0.9999, egri(u));
      let hedef = Math.max(gercekF ? gercekF(t) : 0, zaman);
      if (tavan != null) hedef = Math.min(tavan, hedef);
      g = Math.max(g, Math.min(hedef, g + ENCOK_HIZ * dt));
      const d = g - oncekiG;
      if (d < 0) geri++;
      if (d > enBuyukArtis) enBuyukArtis = d;
      if (t > 500 && g < bantUst - 0.05 && d < enKucukArtis) enKucukArtis = d;
      oncekiG = g;
    }
    return { g, geri, enBuyukArtis, enKucukArtis };
  };
  const TAVAN = 96;
  // 10 dakikalık sessiz bir parse bandı: hiç gerçek yüzde gelmiyor
  const uzun = kos({ bantAlt: 14, bantUst: 45, beklenenMs: 20000, sureMs: 600000 });
  ok('C1 on dakikalık SESSİZ bantta bile sayı geri gitmiyor', uzun.geri === 0, String(uzun.geri));
  ok('C2 sessiz bant tavanı aşılmıyor (45 yazılmıyor)', uzun.g < 45, uzun.g.toFixed(3));
  ok('C3 sessiz bantta sayı tavana gerçekten yaklaşıyor (donup kalmıyor)',
    uzun.g > 44.5, uzun.g.toFixed(3));
  // Kestirim doğruysa bandın doğrusal kısmı gerçekten doğrusal mı
  const dogrusal = kos({ bantAlt: 14, bantUst: 45, beklenenMs: 20000, sureMs: 17000 });
  const beklenenDogrusal = 14 + 31 * (17000 / 20000);
  ok('C4 kestirim doğruyken akış EŞİT (doğrusal): 17/20 sürede bandın 17/20\'si',
    Math.abs(dogrusal.g - beklenenDogrusal) < 0.6, `${dogrusal.g.toFixed(2)} ≈ ${beklenenDogrusal.toFixed(2)}`);
  // Gerçek yüzde birden sıçrarsa ekranda süpürülerek geçilmeli
  const sicrama = kos({
    bantAlt: 14, bantUst: 45, beklenenMs: 20000, sureMs: 4000,
    gercekF: (t) => (t > 1000 ? 45 : 0),
  });
  ok('C5 gerçek yüzde sıçrasa bile kare başına artış hız sınırını aşmıyor',
    sicrama.enBuyukArtis <= ENCOK_HIZ * 0.1 + 1e-6, sicrama.enBuyukArtis.toFixed(3));
  ok('C6 sıçrama süpürülüp tamamlanıyor (3 sn içinde tavana varılıyor)',
    sicrama.g > 44.9, sicrama.g.toFixed(3));
  /*
   * SON BANT VE ONAY İMİ. Gönderilen ekran %97'den itibaren onay imini çizer. Son bant
   * 92-99'dur; tavan konmasaydı zaman ekseni beklenen sürenin %71'inde 97'yi geçer ve dosya
   * açılmadan ekranda "bitti" imi belirirdi. Serbest akış bu yüzden 96'yı geçemez.
   */
  const son = kos({ bantAlt: 92, bantUst: 99, beklenenMs: 3000, sureMs: 300000, tavan: TAVAN });
  ok('C7 son bantta bile onay imi eşiğine (97) çıkılmıyor: dosya açılmadan "bitti" görünmez',
    son.g <= TAVAN + 1e-6, son.g.toFixed(3));
  ok('C8 tavana gerçekten varılıyor (uzun açılışta sayı 96\'ya kadar akıyor)',
    son.g > TAVAN - 0.01, son.g.toFixed(3));
}

// --- D) Gerçek açılışta yüzde geri gitmiyor -------------------------------------------------
// Çok paftalı çizimde sahne sayacı eskiden her paftada başa dönüyor, çubuk %70'ten %45'e
// düşüyordu (scene.js layout başına sıfırlanan sayaç). Artık sayaç küreseldir; burada gerçek
// bir dosya açılırken çubuk kare kare örneklenir ve tek bir geri adım bile aranır.
{
  const ornekle = async () => page.evaluate(() => {
    window.__ilerlemeIzi = [];
    const el = document.getElementById('loadingFill');
    window.__ilerlemeDur = false;
    const tik = () => {
      if (window.__ilerlemeDur) return;
      const w = el ? parseFloat(el.style.width) : NaN;
      const gizli = document.getElementById('loading').hidden;
      if (!gizli && isFinite(w)) window.__ilerlemeIzi.push([performance.now(), w]);
      requestAnimationFrame(tik);
    };
    requestAnimationFrame(tik);
  });
  await ornekle();
  await openFile(page, path.join(SM, 'example_2000.dwg'), { settle: 150 });
  const iz = await page.evaluate(() => { window.__ilerlemeDur = true; return window.__ilerlemeIzi; });
  let geri = 0;
  for (let i = 1; i < iz.length; i++) if (iz[i][1] < iz[i - 1][1] - 0.01) geri++;
  ok('D1 gerçek açılışta çubuk örneklenebildi', iz.length > 2, `${iz.length} örnek`);
  ok('D2 gerçek açılışta yüzde HİÇ geri gitmiyor', geri === 0,
    `${geri} geri adım / ${iz.length} örnek · ${iz.length ? iz[0][1] + '% → ' + iz[iz.length - 1][1] + '%' : ''}`);
}

ok('Z sayfa hatası yok', errors.length === 0, errors.join(' | ').slice(0, 300));
C.summary(errors);
await browser.close(); srv.kill();
