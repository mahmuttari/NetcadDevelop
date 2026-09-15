package com.mahmuttari.dwgviewer

import android.app.Activity
import android.view.ViewGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.platform.ComposeView
import com.example.dwgloader.DwgLoadingScreen
import kotlinx.coroutines.delay
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Başvuru sahibinin gönderdiği Jetpack Compose açılış ekranını uygulamanın üstünde gösterir ve
 * yüzdesini sürer.
 *
 * EKRANIN KENDİSİNE DOKUNULMAZ. `com.example.dwgloader.MainActivity.kt` gönderildiği dosyadır
 * (iki istisna, ikisi de belgeli: derlenmeyen iki satırlık drawArc çağrısı ve ayrıntı yazılarını
 * kapatan `ayrinti` anahtarı — bkz. tools/test_acilis.mjs). Canlandırmanın çizimine hiçbir
 * yerden dokunulmaz.
 *
 * ------------------------------------------------------------------------------------------
 * YÜZDE NASIL ÜRETİLİR
 * ------------------------------------------------------------------------------------------
 * Üç deneme yapıldı, üçü de tek başına yanlıştı ve neden yanlış olduğu buraya yazılmıştır:
 *
 *  1) Yüzde doğrudan gerçek ilerlemeye bağlandı (7.36). Hızlı dosyada sayı sıçrıyor, sessiz
 *     aşamada tek kare donuyordu. Açılış hattının beş bandından üçü ayrıntılı bildirir
 *     (pencereli çözümleme, sahne kurulumu, uzamsal indeks), ikisi seyrek: 32 MB altındaki
 *     dosyada LibreDWG tek blok hâlinde çalışır ve HİÇ bildirmez.
 *  2) Yüzde gerçekten koparıldı, ekran kendi sürücüsüyle aktı (7.39-7.41). Bu kez dosyayla
 *     ilgisi kalmadı; yüze çıkıyor ama dosya açılmıyordu.
 *  3) Tavan konuldu, %96'da beklendi (7.42). Uzun açılışta ekran dakikalarca kıpırdamadı.
 *
 * Doğrusu ikisini BİRLEŞTİRMEKTİR. Her karede üç sayı hesaplanır:
 *
 *   gercek : JS'in bildirdiği gerçek yüzde (asla geri gitmez)
 *   zaman  : bulunulan bandın içinde, o bant için beklenen süreye göre DOĞRUSAL ilerleyen
 *            yüzde — açılışı "eşit dolduran" kısım budur. Beklenen süre aşılırsa doğrusallık
 *            biter ve bandın tavanına yavaşlayarak yaklaşılır: asla tavana değmez, asla
 *            durmaz. Beklenen süre JS'ten gelir; dosyanın boyutundan ve nesne sayısından
 *            çıkarılır ve her açılıştan sonra ölçülen gerçek süreyle düzeltilir.
 *   g      : ekrandaki sayı. hedef = max(gercek, zaman)'a doğru, saniyede en çok ENCOK_HIZ
 *            ile gider — böylece gerçek yüzde birden sıçrasa bile ekranda süpürülerek geçilir.
 *
 * Değer tek yönlüdür (monoton): hedef monotondur, g de hedefi geçmez ve azalmaz.
 *
 * YÜZDE 100 "DOSYA AÇILDI" DEMEKTİR. Serbest akış TAVAN'ı (%96) geçemez; 100'e yalnız
 * kapanma dalından çıkılır: çizim açıldığında kalan yol BITIRME_MS içinde süpürülür, onay imi
 * görünür, örtü solar. Tavanın 96 olması keyfî değildir — gönderilen ekran %97'den itibaren
 * onay imini çizer, dolayısıyla 96'nın üstü "bitti" demektir.
 */
class DwgLoadingOverlay(private val activity: Activity) {

    private companion object {
        /** Ekrandaki sayının en yüksek tırmanma hızı (yüzde/saniye). Sıçrama bununla süpürmeye döner. */
        const val ENCOK_HIZ = 26f
        /** Kapanışta kalan yolun süpürülme süresi — %20'den de %90'dan da aynı. */
        const val BITIRME_MS = 600f
        /** 100'e varıldıktan sonra onay iminin görülmesi için beklenen süre */
        const val BITIS_BEKLEME_MS = 380L
        /** Örtünün solma süresi */
        const val SOLMA_MS = 350L
        /**
         * Bandın doğrusal ilerlediği kısım. Beklenen sürenin %85'ine kadar sayı eşit akar;
         * sonrası yavaşlayarak tavana yaklaşır. Doğrusal kısım "eşit dolma" hissini, yavaşlayan
         * kısım "tavanı aşmama" kuralını sağlar.
         */
        const val DOGRUSAL_PAY = 0.85f
        /** Yavaşlayan kuyruğun sıkılığı: büyük değer, aşımdan sonra tavana daha hızlı yaklaşır. */
        const val KUYRUK = 2.0f
        /**
         * SERBEST AKIŞIN TAVANI. Dosya açılmadan bu sayının üstü YAZILMAZ ve sayı olduğu için
         * de değil, GÖRSEL olduğu için: gönderilen ekran %97'den itibaren onay imini çizer
         * (MainActivity.kt, `progress < 97 -> drawPlan` / `else -> drawSuccess`). Tavan 97 ya
         * da üstü olsaydı, son bandın zaman ekseni beklenen sürenin %71'inde 97'yi geçer ve
         * dosya HENÜZ AÇILMAMIŞKEN ekranda "bitti" imi belirirdi. Ekranın çizimine
         * dokunulmadığına göre doğru yer budur: 96'da durulur, 100'e kapanma dalından çıkılır.
         */
        const val TAVAN = 96f
    }

    private var view: ComposeView? = null
    private var dosya by mutableStateOf("")
    /** Çizim açıldı; kalan yol süpürülüp örtü kalkacak. */
    private var kapanmaIstendi by mutableStateOf(false)

    // --- JS'ten gelen gerçek durum ---------------------------------------------------------
    // Bunlar bileşimde (composition) okunmaz, kare döngüsünde okunur; ikisi de arayüz iş
    // parçacığındadır, bu yüzden düz alan yeterlidir — durum nesnesi olsalardı her güncelleme
    // gereksiz yere yeniden birleştirme tetiklerdi.
    @Volatile private var gercek = 0f                     // gerçek yüzde, monoton
    @Volatile private var bantAlt = 1f
    @Volatile private var bantUst = 14f
    @Volatile private var bantBeklenenMs = 600
    private var bantBasladiNs = 0L                        // bulunulan banda girildiği an

    /** Örtü ekranda mı */
    fun isShowing(): Boolean = view != null

    /**
     * JS'ten gelen gerçek ilerleme. Yüzdeler yüzde birlik çözünürlük için 100 ile çarpılmış
     * tam sayılardır (ör. %43,25 → 4325).
     */
    fun ilerleme(yuzde100: Int, alt100: Int, ust100: Int, beklenenMs: Int) {
        val y = (yuzde100 / 100f).coerceIn(0f, 100f)
        val a = (alt100 / 100f).coerceIn(0f, 100f)
        val u = (ust100 / 100f).coerceIn(0f, 100f)
        /*
         * Bant GERİ GİTMEZ. Hattın iki yerinde gerçek yüzde geriye düşebiliyor: çok paftalı
         * çizimde sahne sayacı (düzeltildi ama eski işçi sürümüyle karşılaşılabilir) ve bir
         * dosyanın ardından ikincisinin açılması. Bandın geri alınması, zaman ekseninin de
         * geri sarılması demek olurdu; sayı o an durur, hatta gerilerdi.
         */
        if (u > bantUst) { bantAlt = a; bantUst = u; bantBasladiNs = 0L }
        bantBeklenenMs = max(120, beklenenMs)
        if (y > gercek) gercek = y                        // gerçek yüzde geri gitmez
    }

    /** Gösterir. Açıksa yalnız dosya adını tazeler. */
    fun show(file: String) {
        dosya = file
        if (view != null) {
            // Zaten açık: kapanmakta değilse dokunma. Kapanmaktaysa (kullanıcı hemen ikinci bir
            // dosya açtı) eskisini bırak, yenisi kendi geçişini baştan yapsın.
            if (!kapanmaIstendi) return
            kaldir()
        }
        kapanmaIstendi = false
        gercek = 0f; bantAlt = 1f; bantUst = 14f; bantBeklenenMs = 600; bantBasladiNs = 0L
        val v = ComposeView(activity)
        v.setContent {
            MaterialTheme {
                // Ekrana giden değer TAM SAYIDIR ve yalnız değiştiğinde yazılır: kare başına
                // durum yazmak, ekranı 60 Hz'de yeniden birleştirmek demekti. Sayı ile çubuk
                // arasındaki yumuşaklığı gönderilen ekranın kendi animateFloatAsState'i (220 ms)
                // zaten sağlıyor.
                var yuzde by remember { mutableIntStateOf(0) }
                var bitti by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    var g = 0f
                    var oncekiNs = 0L
                    var kapanisBasi = -1f
                    var kapanisGecenMs = 0f
                    while (true) {
                        val simdi = withFrameNanos { it }
                        val dt = if (oncekiNs == 0L) 0f else (simdi - oncekiNs) / 1_000_000_000f
                        oncekiNs = simdi
                        if (bantBasladiNs == 0L) bantBasladiNs = simdi

                        if (kapanmaIstendi) {
                            // Çizim açıldı: kalan yol, nerede kalındıysa oradan, sabit sürede
                            // 100'e süpürülür. Nereden başlandığından bağımsız olarak aynı süre.
                            if (kapanisBasi < 0f) { kapanisBasi = g; kapanisGecenMs = 0f }
                            kapanisGecenMs += dt * 1000f
                            val k = (kapanisGecenMs / BITIRME_MS).coerceIn(0f, 1f)
                            g = max(g, kapanisBasi + (100f - kapanisBasi) * k)
                            if (g >= 99.995f) { g = 100f; bitti = true; break }
                        } else {
                            // Zaman ekseni: bandın içinde doğrusal, beklenen süre aşılırsa
                            // yavaşlayarak tavana yaklaşan (ama asla değmeyen) eğri.
                            val u = ((simdi - bantBasladiNs) / 1_000_000f) / bantBeklenenMs.toFloat()
                            val f = if (u <= DOGRUSAL_PAY) u
                            else DOGRUSAL_PAY + (1f - DOGRUSAL_PAY) * (1f - 1f / (1f + (u - DOGRUSAL_PAY) * KUYRUK))
                            val zaman = bantAlt + (bantUst - bantAlt) * f.coerceIn(0f, 0.9999f)
                            // Gerçek yüzde de tavana tabidir: hattın son bandı 92-99'dur ve
                            // kendi bildirimi 97,25'e kadar çıkar — o da "açıldı" demek değildir.
                            val hedef = min(TAVAN, max(gercek, zaman))
                            // Hız sınırı: gerçek yüzde sıçrasa bile ekranda süpürülerek geçilir.
                            g = max(g, min(hedef, g + ENCOK_HIZ * dt))
                        }
                        val yeni = g.roundToInt()
                        if (yeni != yuzde) yuzde = yeni
                    }
                }
                LaunchedEffect(bitti) {
                    if (bitti) { delay(BITIS_BEKLEME_MS); kaldir() }
                }
                // Gönderilen ekran. ayrinti = false: aşama başlığı, alt yazısı, aşama noktaları
                // ve alttaki durum satırı gizlenir — dosya tek bir açılış yüzdesiyle açılsın,
                // ayrıntı bildirmesin. Canlandırma, çubuk ve yüzde olduğu gibi kalır.
                DwgLoadingScreen(fileName = dosya, progress = yuzde, ayrinti = false)
            }
        }
        // Dokunuşlar WebView'a geçmesin: örtü açıkken altı tıklanamaz olmalı.
        v.isClickable = true
        v.isFocusable = true
        val kok = activity.findViewById<ViewGroup>(android.R.id.content)
        kok.addView(v, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view = v
    }

    /**
     * Çizim açıldı. Örtü HEMEN kalkmaz: yüzde nerede kaldıysa oradan 100'e süpürülür, onay imi
     * görünür, sonra solarak kalkar. Yüzde 100'ü ancak burası açar — ekranda 100 görünüyorsa
     * dosya açılmış demektir. Açık değilse bir şey yapmaz.
     */
    fun hide() {
        if (view == null) return
        kapanmaIstendi = true
    }

    /**
     * İPTAL / HATA yolu. Burada geçişi tamamlamak yanlış olur: kullanıcı yüklemeden vazgeçtiyse
     * ya da dosya açılamadıysa ekranın yüzde 100'e koşup onay imi göstermesi yanlış bilgidir.
     * Örtü olduğu yerde solar.
     */
    fun hideNow() {
        kapanmaIstendi = false
        kaldir()
    }

    /**
     * Örtünün görünümü dışarıdan düşürüldü (işleyici süreci çöktü ve setContentView içerik
     * ağacını değiştirdi). Alan bırakılır; yoksa isShowing() sonsuza dek doğru kalır.
     */
    fun unut() {
        val v = view
        view = null
        kapanmaIstendi = false
        try { v?.disposeComposition() } catch (_: Throwable) { /* zaten atılmış olabilir */ }
    }

    /** Örtüyü yumuşakça kaldırır. */
    private fun kaldir() {
        val v = view ?: return
        view = null
        v.animate().alpha(0f).setDuration(SOLMA_MS).withEndAction {
            (v.parent as? ViewGroup)?.removeView(v)
            v.disposeComposition()
        }.start()
    }
}
