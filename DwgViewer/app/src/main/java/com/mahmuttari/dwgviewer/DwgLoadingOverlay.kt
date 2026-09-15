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
 * (tek istisna: derlenmeyen iki satırlık drawArc çağrısı, geometri birebir korunarak çevrildi —
 * bkz. tools/test_acilis.mjs). Bu dosya yalnız o ekranı yerleştirir ve sürer.
 *
 * YÜZDE GERÇEK İLERLEMEDEN GELMEZ. Başvuru sahibinin isteği budur: canlandırma açılış
 * aşamalarına bağlanmasın. Bağlandığında hızlı açılan dosyada resimler sıçrıyor, yavaş aşamada
 * tek kare donuyordu. Bunun yerine gönderilen paketin KENDİ sürücüsü kullanılır — aşağıdaki
 * döngü, paketteki DwgDemoApp'in LaunchedEffect bloğunun aynısıdır (aynı eşikler, aynı
 * gecikmeler, aynı 1..3 artışı, sondaki aynı 550 ms bekleyiş). Tek fark: dosya hâlâ
 * yükleniyorsa baştan başlar, çünkü tek geçiş 3 saniyedir ve büyük çizim daha uzun sürer.
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
        /** Devirde solma süresi: video da bitişte yumuşak geçiyor */
        const val SOLMA_MS = 350L
    }

    private var view: ComposeView? = null
    private var dosya by mutableStateOf("")

    /** Örtü ekranda mı */
    fun isShowing(): Boolean = view != null

    /** Gösterir. Açıksa yalnız dosya adını tazeler. */
    fun show(file: String) {
        dosya = file
        if (view != null) return
        val v = ComposeView(activity)
        v.setContent {
            MaterialTheme {
                var ilerleme by remember { mutableIntStateOf(0) }
                LaunchedEffect(Unit) {
                    // Gönderilen paketteki sürücünün aynısı; yalnız TEMPO ile ölçeklenir ve
                    // yükleme bitene dek baştan tekrarlar.
                    while (true) {
                        ilerleme = 0
                        while (ilerleme < 100) {
                            delay(
                                (TEMPO * when {
                                    ilerleme < 20 -> 45L
                                    ilerleme < 55 -> 65L
                                    ilerleme < 85 -> 50L
                                    else -> 85L
                                }).toLong()
                            )
                            ilerleme = min(100, ilerleme + (1..3).random())
                        }
                        delay((TEMPO * 550L).toLong())
                    }
                }
                // Gönderilen ekran, gönderildiği imzayla çağrılır.
                DwgLoadingScreen(fileName = dosya, progress = ilerleme)
            }
        }
        // Dokunuşlar WebView'a geçmesin: örtü açıkken altı tıklanamaz olmalı.
        v.isClickable = true
        v.isFocusable = true
        val kok = activity.findViewById<ViewGroup>(android.R.id.content)
        kok.addView(v, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view = v
    }

    /** Örtüyü yumuşakça kaldırır (videodaki bitiş geçişi gibi). Açık değilse bir şey yapmaz. */
    fun hide() {
        val v = view ?: return
        view = null
        v.animate().alpha(0f).setDuration(SOLMA_MS).withEndAction {
            (v.parent as? ViewGroup)?.removeView(v)
            v.disposeComposition()
        }.start()
    }
}
