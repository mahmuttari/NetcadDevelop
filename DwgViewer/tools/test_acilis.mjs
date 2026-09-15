// Yerli (native) çizim açılış ekranı — başvuru sahibinin GÖNDERDİĞİ Compose dosyasının
// değişmediğini ve doğru bağlandığını sınar. Tarayıcı gerektirmez.
//
// Bu sınamanın varlık sebebi açık bir istektir: "hiç değiştirmeden olduğu gibi ekle". Dosya
// tek karakter bile değişirse A1 düşer. Değiştirmek gerekirse önce bu özet güncellenir, yani
// değişiklik bilerek ve görülerek yapılır.
// Kullanım: node tools/test_acilis.mjs
import { checker } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const C = checker(), ok = C.ok;
const oku = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
// Gönderilen dosyanın özgün özeti ve şu anki özeti. İkisi ayrı tutulur ki fark GÖRÜLSÜN:
// dosya gönderildiği gibidir, YALNIZ iki satırı derlenebilmek için çevrilmiştir (aşağıda F).
const GONDERILEN = '2de3a94f570d26a2569f9ca94f77ddd325773d0436427f965a5625b7070bfe3c';
const SIMDIKI = 'daf9fa1e6e79714653d2e744924a73201873fd5b8184b8f11c9c9c390c531264';
const KT = 'app/src/main/java/com/example/dwgloader/MainActivity.kt';

// --- A) Gönderilen dosya birebir duruyor mu -------------------------------------------------
{
  const ham = fs.readFileSync(path.join(process.cwd(), KT));
  const ozet = crypto.createHash('sha256').update(ham).digest('hex');
  ok('A1 dosya beklenen hâlinde (izinsiz düzenlenmemiş)',
    ozet === SIMDIKI, ozet.slice(0, 16) + '… / beklenen ' + SIMDIKI.slice(0, 16) + '…');
  const kt = ham.toString('utf8');
  ok('A2 dosya kendi paketinde ve kendi adıyla', kt.startsWith('package com.example.dwgloader'), kt.split('\n')[0]);
  ok('A3 ekranın genel (public) girişi var: DwgLoadingScreen(fileName, progress)',
    /@Composable\s+fun DwgLoadingScreen\(\s*fileName: String,\s*progress: Int/.test(kt));
  ok('A4 paketin kendi demo döngüsü dosyada duruyor ama dışarıdan çağrılmıyor',
    kt.includes('LaunchedEffect(Unit)') && kt.includes('private fun DwgDemoApp'));
}

// --- B) Köprü: ekranı olduğu gibi çağırıyor -------------------------------------------------
{
  const ov = oku('app/src/main/java/com/mahmuttari/dwgviewer/DwgLoadingOverlay.kt');
  ok('B1 köprü ekranı gönderildiği imzayla çağırıyor',
    /DwgLoadingScreen\(fileName = dosya, progress = yuzde\)/.test(ov));
  ok('B2 köprü ekranın kendi paketinden alıyor', ov.includes('import com.example.dwgloader.DwgLoadingScreen'));
  ok('B3 örtü kapatılabiliyor ve bileşim serbest bırakılıyor',
    ov.includes('fun hide()') && ov.includes('disposeComposition()'));
  ok('B4 örtü açıkken altı tıklanamıyor', ov.includes('isClickable = true'));
}

// --- C) Etkinlik ve köprü yöntemi -----------------------------------------------------------
{
  const ma = oku('app/src/main/java/com/mahmuttari/dwgviewer/MainActivity.java');
  ok('C1 etkinlik ComponentActivity (ComposeView yaşam döngüsü sahibi ister)',
    /class MainActivity extends androidx\.activity\.ComponentActivity/.test(ma));
  ok('C2 JS köprüsünde loadingScreen(pct, file) var ve eksi yüzde kapatıyor',
    /@JavascriptInterface public void loadingScreen\(int pct, String file\)/.test(ma) && /pct < 0\) loadOverlay\.hide\(\)/.test(ma));
  ok('C3 geri tuşu, gönderilen ekranda olmayan Vazgeç\'in yerini tutuyor',
    /loadOverlay\.isShowing\(\)/.test(ma) && ma.includes('cancelLoading'));
}

// --- D) JS tarafı: çizim açılışı yerli ekrana gidiyor, tarayıcıda yedek çalışıyor -----------
{
  const js = oku('app/src/main/assets/viewer/app.js');
  ok('D1 çizim açılışı köprü varsa yerli ekrana gidiyor',
    /A\(\)\.loadingScreen\(Math\.round\(v\), file \|\| ''\)/.test(js));
  ok('D2 iki örtü üst üste gelmiyor (yerli açıkken WebView örtüsü gizleniyor)',
    /yerliAcilis = true;[\s\S]{0,120}hide\('loading'\)/.test(js));
  ok('D3 köprü hata verirse WebView örtüsüne düşülüyor', /catch \(e\) \{ yerliAcilis = false; \}/.test(js));
  ok('D4 kapanışta yerli ekran da kapatılıyor', /loadingScreen\(-1, ''\)/.test(js));
  ok('D5 iptal tek yerden: düğme de geri tuşu da aynı yordamı çağırıyor',
    /function cancelLoading\(\)/.test(js) && /addEventListener\('click', cancelLoading\)/.test(js) && /cancelLoading,/.test(js));
}

// --- E) Derleme ayarları --------------------------------------------------------------------
{
  const kok = oku('build.gradle'), app = oku('app/build.gradle');
  ok('E1 Kotlin ve Compose eklentileri bildirilmiş',
    kok.includes('org.jetbrains.kotlin.android') && kok.includes('org.jetbrains.kotlin.plugin.compose'));
  ok('E2 uygulamada compose açık ve jvmTarget 17', app.includes('compose true') && app.includes('jvmTarget = "17"'));
  ok('E3 Compose BOM ile sürüm birliği', /compose-bom:\d{4}\.\d{2}\.\d{2}/.test(app));
  ok('E4 activity-compose var (ComposeView için)', app.includes('androidx.activity:activity-compose'));
}

// --- F) Gönderilen dosyaya yapılan TEK müdahale: iki satırlık derleme düzeltmesi ------------
// Paket Compose'a karşı hiç derlenmemiş: DrawScope.drawArc'ın Rect alan bir aşırı yüklemesi
// yoktur, topLeft + size ister. Geometri birebir korunarak çevrildi; başka hiçbir satıra
// dokunulmadı. Bu denetim, "iki satır" sözünün zamanla üç olmasını engeller.
{
  const kt = oku(KT);
  const rectli = (kt.match(/drawArc\([^\n]*Rect\(/g) || []).length;
  ok('F1 derlenmeyen Rect kullanımı kalmadı', rectli === 0, String(rectli));
  ok('F2 iki yay da topLeft + size ile ve özgün ölçülerinde',
    kt.includes('topLeft = Offset(left+w*0.27f, y-12), size = Size(w*0.15f, 24f)')
    && kt.includes('topLeft = Offset(left+w*0.72f,y-12), size = Size(w*0.19f, 24f)'));
  // Özgün dosyadan farkı yalnız bu iki satır olmalı: satır sayısı ve öteki bütün satırlar aynı
  ok('F3 dosyanın satır sayısı değişmedi (satır eklenip çıkarılmadı)',
    kt.split('\n').length === 603, String(kt.split('\n').length));
}

C.summary();
