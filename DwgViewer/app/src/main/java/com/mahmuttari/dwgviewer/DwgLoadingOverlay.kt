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
import androidx.compose.ui.platform.ComposeView
import com.example.dwgloader.DwgLoadingScreen
import kotlinx.coroutines.delay
import kotlin.math.min

/**
 * Başvuru sahibinin gönderdiği Jetpack Compose açılış ekranını uygulamanın üstünde gösterir.
 *
 * EKRANIN KENDİSİNE DOKUNULMAZ. `com.example.dwgloader.MainActivity.kt` gönderildiği dosyadır
 * (iki istisna, ikisi de belgeli: derlenmeyen iki satırlık drawArc çağrısı ve ayrıntı yazılarını
 * kapatan `ayrinti` anahtarı — bkz. tools/test_acilis.mjs). Bu dosya yalnız o ekranı yerleştirir
 * ve sürer; canlandırmanın kendisine hiçbir yerden dokunulmaz.
 *
 * YÜZDE GERÇEK İLERLEMEDEN GELMEZ. Başvuru sahibinin isteği budur: canlandırma açılış
 * aşamalarına bağlanmasın. Bağlandığında hızlı açılan dosyada resimler sıçrıyor, yavaş aşamada
 * tek kare donuyordu. Bunun yerine gönderilen paketin KENDİ sürücüsü kullanılır — aşağıdaki
 * döngü, paketteki DwgDemoApp'in LaunchedEffect bloğunun aynısıdır: aynı eşikler, aynı
 * gecikmeler, aynı 1..3 artışı.
 *
 * TEK PARÇA: SIFIRDAN YÜZE, BİR KEZ. Yüzde bir kez 0'dan 100'e çıkar; başa dönmez, tekrarlamaz.
 *
 * YÜZDE 100 "DOSYA AÇILDI" DEMEKTİR. Kural budur ve sürücünün kuruluşu buna göredir: dosya
 * açılmadan yüzde 100 YAZILMAZ. Serbest akış TAVAN'da (%96) durur; oradan 100'e ancak çizim
 * açıldığında çıkılır. Tavanın 96 olması keyfî değildir — gönderilen ekran %97'den itibaren
 * onay imini (drawSuccess) çizer; 96'da beklemek, planın çizildiği son kareyi gösterir, yani
 * "bitti" demeden bekler.
 *
 * İki uç da kapalıdır:
 *  · Çizim, yüzde tavana varmadan açılırsa ekran ORTADA KESİLMEZ: kalan yol BITIRME_MS içinde
 *    düzgün bir süpürmeyle 100'e taşınır (nerede olursa olsun aynı süre), onay imi görünür,
 *    BITIS_BEKLEME_MS kadar durur ve örtü solar. Kullanıcı her açılışta sıfırdan yüze TAM bir
 *    geçiş görür.
 *  · Çizim tavana varıldıktan sonra da yükleniyorsa ekran %96'da BEKLER — 100 yazmaz, başa
 *    da dönmez. Bekleme ölü değildir: gönderilen ekranın nabzı (pulse) ve tarama çizgisi
 *    (scan) sonsuz geçişlerdir, akmaya devam eder.
 *
 * TEMPO — gönderilen videoya uyum. Paketin gecikmeleri (45/65/50/85 ms) kâğıt üzerinde 0'dan
 * 100'e yaklaşık 3,0 saniyede gider. Gönderilen tanıtım videosu ise kare kare ölçüldüğünde
 * 7,1 saniye sürüyor ve hız neredeyse düzgün (~14 %/s):
 *     0,2 sn → %3   1,0 → %16   2,0 → %30   3,0 → %44   4,0 → %58
 *     5,0 → %72     6,0 → %85   6,8 → %96   7,2 → %100
 * Bu profil, her adıma sabit bir maliyet eklenmiş gibi durur (yavaş bir cihazda kaydedilmiş
 * olmalı). Referans olarak VİDEO alındı: TEMPO ile gecikmeler ölçeklenir ve ekran her cihazda
 * videodaki hızda akar. Paketin kâğıt üstündeki hızı istenirse TEMPO = 1.0 yapılır; başka
 * hiçbir şey değişmez.
 */
class DwgLoadingOverlay(private val activity: Activity) {

    private companion object {
        /** 1.0 = paketin kendi gecikmeleri (~3,0 sn) · 2.4 = gönderilen videonun hızı (~7,1 sn) */
        const val TEMPO = 2.4
        /**
         * Serbest akışın tavanı. Dosya açılmadan bu sayının üstü yazılmaz; 100 yalnız
         * "açıldı" demektir. 96, gönderilen ekranın onay imine geçtiği eşiğin (97) bir
         * altıdır — bekleme, planın çizildiği son karede olur.
         */
        const val TAVAN = 96
        /** Çizim açıldığında kalan yolun süpürülme süresi — %20'den de %90'dan da aynı. */
        const val BITIRME_MS = 600L
        /** 100'e varıldıktan sonra onay iminin görülmesi için beklenen süre */
        const val BITIS_BEKLEME_MS = 380L
        /** Örtünün solma süresi */
        const val SOLMA_MS = 350L
    }

    private var view: ComposeView? = null
    private var dosya by mutableStateOf("")
    /** Çizim açıldı; yüzde 100'e varır varmaz örtü kalkacak. */
    private var kapanmaIstendi by mutableStateOf(false)

    /** Örtü ekranda mı */
    fun isShowing(): Boolean = view != null

    /** Gösterir. Açıksa yalnız dosya adını tazeler. */
    fun show(file: String) {
        dosya = file
        if (view != null) {
            // Zaten açık: kapanmakta değilse dokunma. Kapanmaktaysa (kullanıcı hemen ikinci bir
            // dosya açtı) eskisini bırak, yenisi kendi sıfırdan yüze geçişini yapsın.
            if (!kapanmaIstendi) return
            kaldir()
        }
        kapanmaIstendi = false
        val v = ComposeView(activity)
        v.setContent {
            MaterialTheme {
                var ilerleme by remember { mutableIntStateOf(0) }
                LaunchedEffect(Unit) {
                    // TEK GEÇİŞ: while (ilerleme < 100). Başa dönen bir döngü YOKTUR.
                    while (ilerleme < 100) {
                        if (kapanmaIstendi) {
                            // Çizim açıldı: kalan yol, nerede kalındıysa oradan, sabit sürede
                            // süpürülür. Artışın ortalaması 2 olduğu için adım sayısı kalan/2.
                            val adim = ((100 - ilerleme) / 2).coerceAtLeast(1)
                            delay((BITIRME_MS / adim).coerceAtLeast(3L))
                            ilerleme = min(100, ilerleme + (1..3).random())
                        } else {
                            // Serbest akış: gönderilen paketteki sürücünün aynısı — aynı
                            // eşikler, aynı gecikmeler, aynı 1..3 artışı; yalnız TEMPO ile
                            // ölçeklenir. TAVAN'ı geçmez: dosya açılmadan 100 yazılmaz.
                            val temel = when {
                                ilerleme < 20 -> 45L
                                ilerleme < 55 -> 65L
                                ilerleme < 85 -> 50L
                                else -> 85L
                            }
                            delay((TEMPO * temel).toLong())
                            ilerleme = min(TAVAN, ilerleme + (1..3).random())
                        }
                    }
                }
                // Yüzde 100'e yalnız çizim açıldığında varılır (TAVAN kuralı), yani buraya
                // düşmek "dosya açıldı ve geçiş tamamlandı" demektir: onay imi görülsün diye
                // kısa bir bekleyişten sonra örtü kalkar.
                LaunchedEffect(ilerleme, kapanmaIstendi) {
                    if (ilerleme >= 100 && kapanmaIstendi) {
                        delay(BITIS_BEKLEME_MS)
                        kaldir()
                    }
                }
                // Gönderilen ekran. ayrinti = false: aşama başlığı, alt yazısı, aşama noktaları
                // ve alttaki durum satırı gizlenir — başvuru sahibinin isteği, dosya tek bir
                // açılış yüzdesiyle açılsın, ayrıntı bildirmesin. Canlandırma, ilerleme çubuğu
                // ve yüzde olduğu gibi kalır; anahtar gönderilen dosyanın içindedir, varsayılanı
                // true'dur, yani paketin kendi demo ekranı hiç değişmemiştir.
                DwgLoadingScreen(fileName = dosya, progress = ilerleme, ayrinti = false)
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
