package com.mahmuttari.dwgviewer

import android.app.Activity
import android.view.ViewGroup
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import com.example.dwgloader.DwgLoadingScreen

/**
 * Başvuru sahibinin gönderdiği Jetpack Compose açılış ekranını uygulamanın üstünde gösterir.
 *
 * EKRANIN KENDİSİNE DOKUNULMAZ. `com.example.dwgloader.MainActivity.kt` gönderildiği gibi,
 * tek karakteri değiştirilmeden derlenir (SHA-256 ile doğrulanır); bu dosya yalnız onu ekrana
 * koyar ve gerçek yükleme yüzdesini besler. Gönderilen paketteki demo döngüsü (LaunchedEffect
 * ile yüzdeyi taklit eden blok) o dosyanın DwgDemoApp'inde kalır ve hiç çağrılmaz; biz doğrudan
 * `DwgLoadingScreen(fileName, progress)` çağırırız — paketin README'sinde önerilen bağlama
 * yöntemi de budur.
 *
 * NEDEN YERLİ (native) KATMAN: uygulamanın arayüzü WebView'dır, ama gönderilen ekran Compose'dur.
 * Yeniden yazmak yerine olduğu gibi eklemek istendiği için Kotlin ve Compose derlemeye alındı ve
 * ekran WebView'ın ÜSTÜNE konuldu. Bunun bir yan faydası da vardır: Compose, Android'in kendi
 * arayüz iş parçacığında çizer, WebView'ın JavaScript'i ise ayrı bir iş parçacığında koşar —
 * yani çizim çözümlemesi ağırlaşsa bile bu ekran donmaz.
 *
 * ComposeView bir ComponentActivity ister (yaşam döngüsü ve kayıt sahipleri oradan gelir); bu
 * yüzden MainActivity android.app.Activity yerine androidx.activity.ComponentActivity'yi
 * genişletir.
 */
class DwgLoadingOverlay(private val activity: Activity) {

    private var view: ComposeView? = null
    private var dosya by mutableStateOf("")
    private var yuzde by mutableIntStateOf(0)

    /** Örtü ekranda mı */
    fun isShowing(): Boolean = view != null

    /** Gösterir ya da açıksa yüzdeyi günceller. pct 0..100, file başlıkta görünecek ad. */
    fun show(file: String, pct: Int) {
        dosya = file
        yuzde = pct.coerceIn(0, 100)
        if (view != null) return
        val v = ComposeView(activity)
        v.setContent {
            MaterialTheme {
                // Gönderilen ekran, gönderildiği imzayla çağrılır.
                DwgLoadingScreen(fileName = dosya, progress = yuzde)
            }
        }
        // Dokunuşlar WebView'a geçmesin: örtü açıkken altı tıklanamaz olmalı.
        v.isClickable = true
        v.isFocusable = true
        val kok = activity.findViewById<ViewGroup>(android.R.id.content)
        kok.addView(v, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view = v
    }

    /** Örtüyü kaldırır. Açık değilse bir şey yapmaz. */
    fun hide() {
        val v = view ?: return
        view = null
        (v.parent as? ViewGroup)?.removeView(v)
        v.disposeComposition()
    }
}
