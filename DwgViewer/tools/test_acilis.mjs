// Yerli (native) çizim açılış ekranı — başvuru sahibinin GÖNDERDİĞİ Compose dosyasının
// değişmediğini ve doğru bağlandığını sınar. Tarayıcı gerektirmez.
//
// Bu sınamanın varlık sebebi açık bir istektir: "hiç değiştirmeden olduğu gibi ekle".
// Dosyanın DwgLoadingScreen DIŞINDA kalan her baytı (canlandırmanın kendisi, çizim
// yordamları, ilerleme çubuğu, ızgara, aşama tablosu, demo döngüsü) özetle kilitlidir; tek
// karakter değişirse A1 düşer. Ekranın gövdesinde ise yalnız bir şey yapılmıştır: ayrıntı
// yazıları bir anahtarın (ayrinti) arkasına alınmıştır — başvuru sahibinin ikinci isteği,
// "dosya tek bir açılış oranıyla, ayrıntı bildirmeden açılsın". G bölümü bunu denetler.
// Kullanım: node tools/test_acilis.mjs
import { checker } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const C = checker(), ok = C.ok;
const oku = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
// Gönderilen dosyanın özgün özeti (iki satırlık derleme düzeltmesinden önceki hâli), kayıt
// için: 2de3a94f570d26a2569f9ca94f77ddd325773d0436427f965a5625b7070bfe3c
// DwgLoadingScreen gövdesi DIŞINDA kalan her şeyin özeti. Canlandırmanın kendisi buradadır:
// DwgStageGraphic, drawDwgFile / drawLayers / drawGeometry / drawPlan / drawSuccess,
// CadProgressBar, StageDots, BlueprintGrid, stageFor tablosu, demo döngüsü ve FakeViewerScreen.
// Bu özet, "animasyon aynen kalsın" sözünün karşılığıdır: canlandırmaya dokunulursa düşer.
const DISI = 'f67770430ee5ec72cedf54a89cd4bd36373a45de1a07dd89d97c7d32d454900a';
const KT = 'app/src/main/java/com/example/dwgloader/MainActivity.kt';
const kt = oku(KT);
// Ekranın gövdesi: imzasından, ardından gelen ilk üst düzey bildirime kadar.
const i1 = kt.indexOf('@Composable\nfun DwgLoadingScreen(');
const i2 = kt.indexOf('data class LoadingStage(');
const disiMetin = i1 >= 0 && i2 > i1 ? kt.slice(0, i1) + kt.slice(i2) : '';

// --- A) Gönderilen dosyanın canlandırma tarafı birebir duruyor mu ---------------------------
{
  ok('A0 ekranın gövdesi dosyada bulundu (özet bölgesi ayrılabildi)', i1 >= 0 && i2 > i1, `${i1} / ${i2}`);
  const ozet = crypto.createHash('sha256').update(disiMetin, 'utf8').digest('hex');
  ok('A1 CANLANDIRMA ve bütün çizim yordamları birebir aynı (ekran gövdesi dışında tek bayt değişmedi)',
    ozet === DISI, ozet.slice(0, 16) + '… / beklenen ' + DISI.slice(0, 16) + '…');
  ok('A2 dosya kendi paketinde ve kendi adıyla', kt.startsWith('package com.example.dwgloader'), kt.split('\n')[0]);
  ok('A3 ekranın genel (public) girişi var: DwgLoadingScreen(fileName, progress, ayrinti)',
    /@Composable\s+fun DwgLoadingScreen\(\s*fileName: String,\s*progress: Int,\s*ayrinti: Boolean = true/.test(kt));
  ok('A4 paketin kendi demo döngüsü dosyada duruyor ama dışarıdan çağrılmıyor',
    kt.includes('LaunchedEffect(Unit)') && kt.includes('private fun DwgDemoApp'));
  ok('A5 canlandırma çağrısı gönderildiği ölçülerle duruyor (230 dp, pulse, scan)',
    /DwgStageGraphic\(\s*progress = progress,\s*pulse = pulse,\s*scan = scan,\s*modifier = Modifier\.size\(230\.dp\)/.test(kt));
}

// --- B) Köprü: ekranı olduğu gibi çağırıyor -------------------------------------------------
{
  const ov = oku('app/src/main/java/com/mahmuttari/dwgviewer/DwgLoadingOverlay.kt');
  ok('B1 köprü ekranı gönderildiği imzayla, ayrıntı kapalı çağırıyor',
    /DwgLoadingScreen\(fileName = dosya, progress = yuzde, ayrinti = false\)/.test(ov));
  // Sürücü paketin kendisinden: aynı eşikler, aynı gecikmeler, aynı 1..3 artışı. Paketin
  // sondaki 550 ms bekleyişinin yerini BITIS_BEKLEME_MS aldı; paketinki demo ekranını
  // değiştirmek içindi, bizde örtünün kalkma anını belirler.
  ok('B1b sürücü artık uydurma değil: paketin sabit gecikmeleri kaldırıldı',
    !/ilerleme < 20 -> 45L/.test(ov) && !/\(1\.\.3\)\.random\(\)/.test(ov));
  // TEK PARÇA: sıfırdan yüze bir kez. Başa dönen bir döngü olmamalı.
  ok('B1c geçiş TEK parça: sayı monoton, başa dönen bir döngü yok',
    !/ilerleme = 0/.test(ov) && /g = max\(g,/.test(ov));
  /*
   * KESTİRİMCİ. Ekrandaki sayı üç kaynaktan doğar: JS'in bildirdiği gerçek yüzde, bandın içinde
   * beklenen süreye göre DOĞRUSAL ilerleyen zaman ekseni ve ikisini süpürerek izleyen hız
   * sınırı. Üç değişmez tools/test_ilerleme.mjs'te formülün bir örneği üzerinde ÖLÇÜLÜR
   * (asla durmaz · asla sıçramaz · asla geri gitmez); buradaki denetimler Kotlin kaynağının
   * o formülün aynısı olduğunu korur. İkisi ayrışırsa ölçülen şey uygulanan şey olmaz.
   */
  ok('B1k gerçek yüzde besleniyor ve geri gitmiyor',
    /fun ilerleme\(yuzde100: Int, alt100: Int, ust100: Int, beklenenMs: Int\)/.test(ov)
    && /if \(y > gercek\) gercek = y/.test(ov));
  ok('B1l bant geri alınmıyor (zaman ekseni geri sarılmaz)', /if \(u > bantUst\) \{ bantAlt = a; bantUst = u; bantBasladiNs = 0L \}/.test(ov));
  ok('B1m zaman ekseni: beklenen sürenin %85\'ine kadar DOĞRUSAL',
    /const val DOGRUSAL_PAY = 0\.85f/.test(ov) && /if \(u <= DOGRUSAL_PAY\) u/.test(ov));
  ok('B1n aşımda yavaşlayarak tavana yaklaşıyor, tavana DEĞMİYOR',
    /DOGRUSAL_PAY \+ \(1f - DOGRUSAL_PAY\) \* \(1f - 1f \/ \(1f \+ \(u - DOGRUSAL_PAY\) \* KUYRUK\)\)/.test(ov)
    && /f\.coerceIn\(0f, 0\.9999f\)/.test(ov));
  ok('B1o hedef, gerçek ile zamanın büyüğü; TAVAN ile sınırlı, hız sınırlı ve monoton',
    /val hedef = min\(TAVAN, max\(gercek, zaman\)\)/.test(ov)
    && /g = max\(g, min\(hedef, g \+ ENCOK_HIZ \* dt\)\)/.test(ov));
  // Onay imi dosya açılmadan görünmemeli: gönderilen ekran %97'den itibaren drawSuccess çizer.
  ok('B1s serbest akışın tavanı onay imi eşiğinin altında (96 < 97)',
    /const val TAVAN = 96f/.test(ov) && oku(KT).includes('progress < 97 -> drawPlan'));
  ok('B1p kare döngüsü withFrameNanos ile (ekranın kendi saatine bağlı)', /withFrameNanos/.test(ov));
  ok('B1r ekrana yalnız tam sayı değişince yazılıyor (60 Hz yeniden birleştirme yok)',
    /val yeni = g\.roundToInt\(\)/.test(ov) && /if \(yeni != yuzde\) yuzde = yeni/.test(ov));
  ok('B1e çizim erken açılırsa geçiş kesilmez, kalan yol sabit sürede süpürülür',
    /const val BITIRME_MS = 600f/.test(ov)
    && /kapanisGecenMs \/ BITIRME_MS/.test(ov)
    && /kapanisBasi \+ \(100f - kapanisBasi\) \* k/.test(ov)
    && /fun hide\(\)[\s\S]{0,120}kapanmaIstendi = true/.test(ov));
  // ASIL KURAL: yüzde 100 "dosya açıldı" demektir. Serbest akış TAVAN'ı geçemez; 100'e
  // yalnız kapanmaIstendi doğruyken, yani çizim açıldığında çıkılır.
  // 100 "dosya açıldı" demektir: serbest akışın tavanı bantların en üstü olan 99'dur ve
  // eğri tavana değmediği için ona bile varılmaz; 100'e yalnız kapanma dalından çıkılır.
  ok('B1f serbest akış 100 YAZAMAZ: hem TAVAN hem de bandın tavanına değmeyen eğri',
    /f\.coerceIn\(0f, 0\.9999f\)/.test(ov) && /min\(TAVAN, max\(gercek, zaman\)\)/.test(ov));
  ok('B1h 100\'e yalnız kapanma dalından çıkılıyor',
    /if \(kapanmaIstendi\) \{[\s\S]{0,700}100f - kapanisBasi/.test(ov)
    && (ov.match(/g = 100f/g) || []).length === 1);
  ok('B1j 100\'e varınca örtü kalkıyor (onay imi için kısa bekleyişle)',
    /bitti = true/.test(ov) && /BITIS_BEKLEME_MS/.test(ov));
  ok('B1g iptal ve hata ayrı yol: geçiş tamamlanmadan kalkar',
    /fun hideNow\(\)/.test(ov) && /kapanmaIstendi = false[\s\S]{0,40}kaldir\(\)/.test(ov));
  ok('B1d hız sınırı ve bitirme süresi tek sabitte',
    /const val ENCOK_HIZ = 26f/.test(ov) && /const val BITIRME_MS = 600f/.test(ov));
  ok('B2 köprü ekranın kendi paketinden alıyor', ov.includes('import com.example.dwgloader.DwgLoadingScreen'));
  ok('B3 örtü kapatılabiliyor ve bileşim serbest bırakılıyor',
    ov.includes('fun hide()') && ov.includes('disposeComposition()'));
  ok('B5 tekrar açılışta yeni geçiş sıfırdan başlıyor',
    /kapanmaIstendi = false[\s\S]{0,200}ComposeView\(activity\)/.test(ov));
  ok('B4 örtü açıkken altı tıklanamıyor', ov.includes('isClickable = true'));
}

// --- C) Etkinlik ve köprü yöntemi -----------------------------------------------------------
{
  const ma = oku('app/src/main/java/com/mahmuttari/dwgviewer/MainActivity.java');
  ok('C1 etkinlik ComponentActivity (ComposeView yaşam döngüsü sahibi ister)',
    /class MainActivity extends androidx\.activity\.ComponentActivity/.test(ma));
  ok('C2b köprüde gerçek ilerleme yolu var',
    /@JavascriptInterface public void loadingProgress\(int yuzde100, int alt100, int ust100, int beklenenMs\)/.test(ma)
    && /loadOverlay\.ilerleme\(yuzde100, alt100, ust100, beklenenMs\)/.test(ma));
  ok('C2 JS köprüsü aç/kapa',
    /@JavascriptInterface public void loadingScreen\(boolean show, String file\)/.test(ma)
    && /if \(show\) loadOverlay\.show\(/.test(ma) && /else loadOverlay\.hide\(\)/.test(ma));
  ok('C2c köprüde iptal/hata yolu ayrı',
    /@JavascriptInterface public void loadingScreenAbort\(\)/.test(ma) && /loadOverlay\.hideNow\(\)/.test(ma));
  ok('C3 geri tuşu, gönderilen ekranda olmayan Vazgeç\'in yerini tutuyor',
    /loadOverlay\.isShowing\(\)/.test(ma) && ma.includes('cancelLoading'));
}

// --- D) JS tarafı: çizim açılışı yerli ekrana gidiyor, tarayıcıda yedek çalışıyor -----------
{
  const js = oku('app/src/main/assets/viewer/app.js');
  ok('D1 çizim açılışı köprü varsa yerli ekrana gidiyor, GERÇEK YÜZDEYLE',
    /A\(\)\.loadingScreen\(true, file \|\| ''\)/.test(js)
    && /A\(\)\.loadingProgress\(Math\.round\(v \* 100\), Math\.round\(b\.alt \* 100\), Math\.round\(b\.ust \* 100\), Math\.round\(bantBeklenenMs\(b\)\)\)/.test(js));
  ok('D1b köprü çağrısı boğulmuyor (bant değişimi ve son değer hariç ~25 Hz)',
    /simdi - yerliSonGonderim > 40 \|\| v >= 99/.test(js));
  ok('D1c kestirim açılış başında kuruluyor, sonunda öğreniliyor',
    /acilisKestirimBasla\(objN, bytes \/ 1048576\)/.test(js) && /acilisKestirimOgren\(\)/.test(js));
  ok('D1d iptal ve hata öğrenmeyi kirletmiyor',
    (js.match(/acilisBasladi = 0;\s+\/\/ yarıda kesilen/g) || []).length === 2);
  ok('D2 iki örtü üst üste gelmiyor (yerli açıkken WebView örtüsü gizleniyor)',
    /yerliAcilis = true;[\s\S]{0,1200}hide\('loading'\);\s+\/\/ iki örtü/.test(js));
  ok('D3 köprü hata verirse WebView örtüsüne düşülüyor', /catch \(e\) \{ yerliAcilis = false; \}/.test(js));
  ok('D4 kapanışta yerli ekran da kapatılıyor', /loadingScreen\(false, ''\)/.test(js));
  ok('D4b iptal ve hata, geçişi tamamlamayan yolu kullanıyor',
    /yerliKes && A\(\)\.loadingScreenAbort/.test(js)
    && /cancelJobs\([\s\S]{0,80}yerliKes = true/.test(js)
    && /console\.error\(err\);\s*\n\s*yerliKes = true/.test(js));
  ok('D4c kes bayrağı her kapanışta sıfırlanıyor (bir sonraki açılışa sızmaz)',
    /yerliAcilis = false;\s*\n\s*\}\s*\n\s*yerliKes = false;/.test(js));
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
  const rectli = (kt.match(/drawArc\([^\n]*Rect\(/g) || []).length;
  ok('F1 derlenmeyen Rect kullanımı kalmadı', rectli === 0, String(rectli));
  ok('F2 iki yay da topLeft + size ile ve özgün ölçülerinde',
    kt.includes('topLeft = Offset(left+w*0.27f, y-12), size = Size(w*0.15f, 24f)')
    && kt.includes('topLeft = Offset(left+w*0.72f,y-12), size = Size(w*0.19f, 24f)'));
  ok('F3 iki yay ekranın DIŞINDA, yani özetle kilitli bölgede',
    disiMetin.includes('topLeft = Offset(left+w*0.27f, y-12)')
    && disiMetin.includes('topLeft = Offset(left+w*0.72f,y-12)'));
}

// --- G) İkinci istek: tek açılış yüzdesi, ayrıntı yok ---------------------------------------
// "Altta farklı farklı detayların açılış oranlarını göstermeye gerek yok. Dosya tek bir açılış
// oranıyla bilgi vermeden açılsın." Ayrıntılar silinmedi, bir anahtarın arkasına alındı:
// varsayılan true olduğu için paketin kendi demo ekranı hiç değişmedi; bizim örtümüz false
// geçiyor. Böylece karar tek kelimeyle geri alınabilir.
{
  const ekran = kt.slice(i1, i2);
  const kapili = (ad) => {
    const k = ekran.indexOf(ad);
    if (k < 0) return false;
    // Geriye doğru en yakın 'if (ayrinti) {' ile o bloğun kapanışı arasında mı
    const acilis = ekran.lastIndexOf('if (ayrinti) {', k);
    if (acilis < 0) return false;
    let d = 0;
    for (let j = ekran.indexOf('{', acilis); j < ekran.length; j++) {
      if (ekran[j] === '{') d++;
      else if (ekran[j] === '}') { d--; if (d === 0) return j > k; }
    }
    return false;
  };
  ok('G1 aşama başlığı (DWG dosyası açılıyor… / Katmanlar işleniyor…) ayrıntı anahtarının arkasında',
    kapili('targetState = stage.title'));
  ok('G2 aşama alt yazısı (Layer bilgileri ayrıştırılıyor…) ayrıntı anahtarının arkasında',
    kapili('text = stage.subtitle'));
  ok('G3 aşama noktaları ayrıntı anahtarının arkasında', kapili('StageDots(stageIndex'));
  ok('G4 alttaki durum satırı ayrıntı anahtarının arkasında', kapili('"DWG görüntüsü hazırlanıyor"'));
  ok('G5 açılış YÜZDESİ her hâlde görünüyor (anahtarın dışında)',
    ekran.includes('text = "$progress%"') && !kapili('text = "$progress%"'));
  ok('G6 ilerleme çubuğu her hâlde görünüyor (anahtarın dışında)',
    ekran.includes('CadProgressBar(') && !kapili('CadProgressBar('));
  ok('G7 canlandırma her hâlde görünüyor (anahtarın dışında)',
    ekran.includes('DwgStageGraphic(') && !kapili('DwgStageGraphic('));
  ok('G8 ayrıntı kapalıyken sayı ile çubuk arasındaki boşluk korunuyor',
    /\} else \{[\s\S]{0,200}Spacer\(Modifier\.height\(26\.dp\)\)/.test(ekran));
  ok('G9 varsayılan açık: paketin kendi demo ekranı ayrıntıyı görmeye devam ediyor',
    /ayrinti: Boolean = true/.test(kt));
  ok('G10 ayrıntı yazıları SİLİNMEDİ, yalnız kapatıldı (geri almak tek kelime)',
    kt.includes('stageFor(progress)') && kt.includes('private fun StageDots')
    && kt.includes('"Katmanlar işleniyor…"') && kt.includes('"Viewport hazırlanıyor"'));
}

C.summary();
