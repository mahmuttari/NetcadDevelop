// Marka açılış örtüsü (SplashOverlay) — yerli Compose ekranı; tarayıcı gerektirmez.
//
// Sınananlar: (A) ekran kendi dosyasında ve KENDİ çizimiyle (başka ürünün logosu, resmi, adı
// yok); (B) zamanlama sözleşmesi: en az süre, emniyet kilidi, JS bildirimi, sayfa payı, çökmede
// alan bırakma; (C) MainActivity bağlantısı: yalnız soğuk açılış, setContentView'dan SONRA,
// onPageFinished ve onRenderProcessGone yolları, Bridge.splashDone; (D) JS tarafı ilk ekrandan
// sonra haber veriyor; (E) 15 dilin hepsinde slogan ve telif satırı var, rakibin cümlesi değil;
// (F) Android 12+ sistem açılış zemini örtüyle aynı renk.
// Kullanım: node tools/test_splash.mjs
import { checker } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const C = checker(), ok = C.ok;
const oku = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const KT = 'app/src/main/java/com/mahmuttari/dwgviewer/SplashOverlay.kt';
const kt = oku(KT);
const ma = oku('app/src/main/java/com/mahmuttari/dwgviewer/MainActivity.java');
const js = oku('app/src/main/assets/viewer/app.js');

// --- A) Kendi ekranı, kendi çizimi ------------------------------------------------------------
{
  ok('A1 örtü kendi paketinde', kt.startsWith('package com.mahmuttari.dwgviewer'));
  ok('A2 illüstrasyon KODLA çizilir: resim dosyası yüklenmez (Image/painterResource/BitmapFactory yok)',
    !/painterResource|BitmapFactory|ImageBitmap|decodeResource|\.png|\.jpg|\.webp/.test(kt));
  ok('A3 çizim uygulamanın kendi plan motifi: Euler yolu (M-23 0 V21 H23 V-21 H-23 V0 H23) ile aynı köşeler',
    /PLAN = floatArrayOf\(-23f, 0f, -23f, 21f, 23f, 21f, 23f, -21f, -23f, -21f, -23f, 0f, 23f, 0f\)/.test(kt));
  ok('A4 teknik resim öğeleri: izometrik gövde, üç izdüşüm, ölçü çentiği, gizli kenar kesikli, eksen üçlüsü',
    /fun iso\(/.test(kt) && /plan görünüşü/.test(kt) && /ön görünüş/.test(kt) && /yan görünüş/.test(kt)
    && /fun DrawScope\.olcu\(/.test(kt) && /dashPathEffect/.test(kt) && /drawText\("Z"/.test(kt) && /drawText\("X"/.test(kt) && /drawText\("Y"/.test(kt));
  const yabanci = /gstar|fastview|autodesk|autocad|dwgfastview/i;
  ok('A5 başka bir ürünün adı, logosu ya da resmi yok (Kotlin, kaynaklar)',
    !yabanci.test(kt) && !fs.readdirSync('app/src/main/res').some(d => d.startsWith('values') && fs.existsSync(`app/src/main/res/${d}/strings.xml`) && yabanci.test(oku(`app/src/main/res/${d}/strings.xml`))));
  ok('A6 alt kimlik: uygulamanın kendi başlatıcı simgesi ve adı',
    /setImageResource\(R\.mipmap\.ic_launcher\)/.test(kt) && /stringResource\(R\.string\.app_name\)/.test(kt));
  ok('A7 telif satırı yıl + ad + çevrilen "tüm hakları saklıdır"; yıl sabit yazılmaz',
    /Calendar\.getInstance\(\)\.get\(Calendar\.YEAR\)/.test(kt) && /R\.string\.splash_rights/.test(kt) && !/© 20\d\d/.test(kt));
  ok('A8 canlandırma erişilebilirliğe saygılı: ANIMATOR_DURATION_SCALE 0 ise çizim bitmiş hâlde başlar',
    /ANIMATOR_DURATION_SCALE/.test(kt) && /Animatable\(if \(hareket\) 0f else 1f\)/.test(kt));
  ok('A9 zemin çizim açılış ekranıyla aynı aile (lacivert) — örtüden örtüye renk sıçramaz',
    /0xFF0B1622/.test(kt) && /0xFF08111B/.test(kt) && /0xFF07101A/.test(kt));
}

// --- B) Zamanlama sözleşmesi ---------------------------------------------------------------------
{
  const sabit = (ad) => { const m = kt.match(new RegExp(`const val ${ad} = (\\d+)L?`)); return m ? Number(m[1]) : NaN; };
  const enAz = sabit('EN_AZ_MS'), enCok = sabit('EN_COK_MS'), pay = sabit('SAYFA_PAYI_MS'), solma = sabit('SOLMA_MS');
  ok('B1 en az süre okunacak kadar (1-2 s), emniyet kilidi ondan büyük ve 10 s altında',
    enAz >= 1000 && enAz <= 2000 && enCok > enAz && enCok <= 10000, JSON.stringify({ enAz, enCok }));
  ok('B2 sayfa payı en az sürenin altında; solma kısa', pay > 0 && pay < enAz && solma > 0 && solma <= 600, JSON.stringify({ pay, solma }));
  ok('B3 show() emniyet kilidini kurar, kaldir() kaldırır', /h\.postDelayed\(emniyet, EN_COK_MS\)/.test(kt) && /h\.removeCallbacks\(emniyet\)/.test(kt));
  ok('B4 hazir(): en az süre dolduysa hemen, dolmadıysa kalan süre kadar bekler',
    /val kalan = EN_AZ_MS - \(SystemClock\.uptimeMillis\(\) - basladi\)/.test(kt) && /if \(kalan <= 0\) kaldir\(\) else h\.postDelayed\(\{ kaldir\(\) \}, kalan\)/.test(kt));
  ok('B5 sayfaHazir(): JS haber vermezse pay sonunda hazır sayılır', /fun sayfaHazir\(\)[\s\S]{0,200}h\.postDelayed\(\{ hazir\(\) \}, SAYFA_PAYI_MS\)/.test(kt));
  ok('B6 hazir() iki kez çağrılınca ikincisi iş yapmaz (hazirOldu)', /if \(view == null \|\| hazirOldu\) return\s+hazirOldu = true/.test(kt));
  ok('B7 unut(): bekleyen bütün zamanlayıcılar iptal, alan bırakılır', /fun unut\(\)[\s\S]{0,200}h\.removeCallbacksAndMessages\(null\)[\s\S]{0,120}view = null/.test(kt));
  ok('B8 kaldir() solarak kaldırır ve bileşimi serbest bırakır', /animate\(\)\.alpha\(0f\)\.setDuration\(SOLMA_MS\)/.test(kt) && /disposeComposition\(\)/.test(kt));
  ok('B9 örtü açıkken altı tıklanamaz', /isClickable = true/.test(kt) && /isFocusable = true/.test(kt));
}

// --- C) MainActivity bağlantısı --------------------------------------------------------------
{
  const i0 = ma.indexOf('createWebView();\n        // setContentView');
  ok('C1 örtü WebView kurulduktan (setContentView) SONRA ve YALNIZ soğuk açılışta gösterilir',
    i0 > 0 && /if \(savedInstanceState == null\) \{ splash = new SplashOverlay\(this\); splash\.show\(\); \}/.test(ma));
  ok('C2 onPageFinished sayfa payını başlatır', /flushPendingJs\(\);\s*\n\s*if \(splash != null\) splash\.sayfaHazir\(\);/.test(ma));
  ok('C3 render süreci çökünce alan bırakılır (setContentView görünümü düşürür)',
    /if \(splash != null\) \{ splash\.unut\(\); splash = null; \}\s*\n\s*createWebView\(\);/.test(ma));
  ok('C4 JS köprüsü: splashDone → hazir()', /@JavascriptInterface public void splashDone\(\)[\s\S]{0,120}splash\.hazir\(\)/.test(ma));
  ok('C5 örtü, çizim açılış örtüsünden ayrı bir nesne (ikisi birbirine karışmaz)', /private SplashOverlay splash;/.test(ma) && /private DwgLoadingOverlay loadOverlay;/.test(ma));
}

// --- D) JS tarafı --------------------------------------------------------------------------------
{
  const i1 = js.indexOf("Home.show();   // çizim / belge yokken ana ekran"), i2 = js.indexOf('A().splashDone()');
  ok('D1 ilk ekran (ana ekran) çizildikten SONRA haber verilir, iki kare beklenir',
    i1 > 0 && i2 > i1 && /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{ try \{ A\(\)\.splashDone\(\); \}/.test(js));
  ok('D2 köprü yoksa (tarayıcı) ya da eski APK\'da sessiz', /typeof A\(\)\.splashDone === 'function'/.test(js));
}

// --- E) Diller ------------------------------------------------------------------------------------
{
  const gradle = oku('app/build.gradle');
  const m = gradle.match(/resourceConfigurations \+= \[([^\]]+)\]/);
  const diller = m ? m[1].split(',').map(x => x.trim().replace(/"/g, '')) : [];
  const dizin = (l) => (l === 'en' ? 'values' : `values-${l}`);
  const eksik = [], rakip = [], ayni = new Set();
  for (const l of diller) {
    const p = `app/src/main/res/${dizin(l)}/strings.xml`;
    if (!fs.existsSync(p)) { eksik.push(l + ' (dizin yok)'); continue; }
    const s = oku(p);
    const t = (s.match(/<string name="splash_tagline">([^<]*)<\/string>/) || [])[1];
    const r = (s.match(/<string name="splash_rights">([^<]*)<\/string>/) || [])[1];
    if (!t || !r) eksik.push(l);
    else { if (/anytime|anywhere/i.test(t)) rakip.push(l); ayni.add(t); }
  }
  ok('E1 derlemenin taşıdığı 15 dilin hepsinde slogan ve telif satırı var', diller.length === 15 && eksik.length === 0, JSON.stringify({ n: diller.length, eksik }));
  ok('E2 slogan rakibin cümlesi değil (Anytime, Anywhere yok) ve dilden dile çevrilmiş (aynı metin tekrarlanmıyor)',
    rakip.length === 0 && ayni.size === diller.length, JSON.stringify({ rakip, farkli: ayni.size }));
  ok('E3 slogan uygulamanın işini söylüyor (ölçme de var: görüntüleyiciyi ayıran şey)',
    /ölç/.test(oku('app/src/main/res/values-tr/strings.xml')) && /measure/.test(oku('app/src/main/res/values/strings.xml')));
}

// --- F) Sistem açılış penceresi (Android 12+) ---------------------------------------------------
{
  const v31 = fs.existsSync('app/src/main/res/values-v31/styles.xml') ? oku('app/src/main/res/values-v31/styles.xml') : '';
  const renk = oku('app/src/main/res/values/colors.xml');
  ok('F1 values-v31 teması sistem açılış zeminini örtünün rengine bağlıyor',
    /windowSplashScreenBackground">@color\/splash_bg/.test(v31) && /name="splash_bg">#08111B/.test(renk));
  const asil = oku('app/src/main/res/values/styles.xml');
  const ogeler = (s) => (s.match(/<item name="android:(windowBackground|statusBarColor|navigationBarColor|windowLightStatusBar)">[^<]*<\/item>/g) || []).sort().join('|');
  ok('F2 v31 teması öteki öğelerde ana temayla birebir aynı (üstüne yazarken hiçbir şey düşmedi)', ogeler(asil) === ogeler(v31) && ogeler(asil).length > 0);
}

C.summary(); C.exit();
