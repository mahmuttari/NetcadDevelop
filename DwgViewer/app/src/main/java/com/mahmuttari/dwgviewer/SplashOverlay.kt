package com.mahmuttari.dwgviewer

import android.app.Activity
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.ViewGroup
import android.widget.ImageView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import java.util.Calendar
import kotlin.math.max
import kotlin.math.min

/**
 * MARKA AÇILIŞ EKRANI — uygulama soğuk açılırken WebView'ın üstünde duran karşılama sayfası.
 *
 * NEDEN VAR
 *   WebView'ın kurulup index.html'i çizmesi bir saniyeyi bulur; o sürede kullanıcı boş, koyu bir
 *   pencere görüyordu. Bu örtü o boşluğu markayla doldurur: üstte slogan, ortada teknik çizim
 *   dilinde bir illüstrasyon, altta simge + ad, en altta telif satırı. Düzen, masaüstü CAD
 *   programlarının ve rakip görüntüleyicilerin karşılama sayfalarıyla aynı KURGUDUR (slogan /
 *   illüstrasyon / kimlik / telif); ÇİZİM ise bizimdir — aşağıdaki illüstrasyon bu dosyada,
 *   vektör olarak, sıfırdan çizilir. Başka bir ürünün logosu ya da resmi kullanılmaz.
 *
 * İLLÜSTRASYON NE ANLATIR
 *   Uygulamanın kendi plan motifi: simge önerisinde ve çizim açılış canlandırmasında tek kalem
 *   darbesiyle çizilen Euler yolu (M-23 0 V21 H23 V-21 H-23 V0 H23 — dış duvar + orta bölme).
 *   Burada o plan önce çizilir, sonra duvarlar planın üstünde YÜKSELİR ve izometrik bir gövde
 *   olur; çevresinde teknik resim kuralıyla üç izdüşüm durur (plan, ön görünüş, yan görünüş),
 *   ölçü çizgileri mimari çentikle çizilir, gizli kenarlar kesiklidir, sol altta X-Y-Z üçlüsü
 *   vardır. Yani resim "CAD" demekle kalmaz, uygulamanın kendi simgesinin ÜÇ BOYUTLU hâlidir.
 *
 * ZAMANLAMA
 *   Örtü en az EN_AZ_MS görünür (okunabilsin diye), JavaScript ilk ekranı çizdiğini bildirince
 *   (Bridge.splashDone → hazir) kalkar; JS hiç bildirmezse onPageFinished + kısa pay yeter
 *   (sayfaHazir), o da gelmezse EN_COK_MS'de emniyet kilidi kaldırır — hiçbir durumda ekranda
 *   asılı kalmaz. Yalnız soğuk açılışta gösterilir (döndürme / yeniden yaratma değil); render
 *   süreci çökerse alan bırakılır (unut), çünkü setContentView örtünün görünümünü de düşürür.
 *
 * HAREKET
 *   Sistem "canlandırma ölçeği" sıfırsa (erişilebilirlik) çizim hazır hâlde başlar, hiçbir şey
 *   kıpırdamaz. Renkler çizim açılış ekranıyla aynı ailedendir (lacivert zemin, camgöbeği vurgu)
 *   ki bir dosya açılırken bu örtüden ötekine geçiş renk değiştirmesin.
 */
class SplashOverlay(private val activity: Activity) {

    companion object {
        /** Örtünün en az görünme süresi: slogan okunacak kadar, bekletecek kadar değil */
        const val EN_AZ_MS = 1400L
        /** Emniyet kilidi: JS de sayfa da haber vermezse örtü bu sürede kendiliğinden kalkar */
        const val EN_COK_MS = 5000L
        /** onPageFinished sonrası JS bildirimi için tanınan pay; gelmezse sayfa hazır sayılır */
        const val SAYFA_PAYI_MS = 900L
        /** Solma süresi */
        const val SOLMA_MS = 350L
        /** İllüstrasyonun çizilme süresi (plan → duvarlar → izdüşümler) */
        const val CIZIM_MS = 1100
    }

    private var view: ComposeView? = null
    private var basladi = 0L
    private var hazirOldu = false
    private val h = Handler(Looper.getMainLooper())
    private val emniyet = Runnable { kaldir() }

    fun isShowing(): Boolean = view != null

    /** Gösterir; zaten açıksa dokunmaz. */
    fun show() {
        if (view != null) return
        basladi = SystemClock.uptimeMillis()
        hazirOldu = false
        // Erişilebilirlik: canlandırmalar kapalıysa (ölçek 0) çizim bitmiş hâlde durur
        val hareket = try {
            Settings.Global.getFloat(activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
        } catch (_: Throwable) { true }
        val v = ComposeView(activity)
        v.setContent { MaterialTheme { DwgSplashScreen(hareket = hareket) } }
        // Dokunuşlar WebView'a geçmesin: örtü açıkken altı tıklanamaz olmalı
        v.isClickable = true
        v.isFocusable = true
        activity.findViewById<ViewGroup>(android.R.id.content)
            .addView(v, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view = v
        h.postDelayed(emniyet, EN_COK_MS)
    }

    /** JS ilk ekranı çizdi: en az süre dolduysa hemen, dolmadıysa dolunca kalkar. */
    fun hazir() {
        if (view == null || hazirOldu) return
        hazirOldu = true
        val kalan = EN_AZ_MS - (SystemClock.uptimeMillis() - basladi)
        if (kalan <= 0) kaldir() else h.postDelayed({ kaldir() }, kalan)
    }

    /** Sayfa yüklendi (onPageFinished): JS kısa süre içinde haber vermezse hazır sayılır. */
    fun sayfaHazir() {
        if (view == null || hazirOldu) return
        h.postDelayed({ hazir() }, SAYFA_PAYI_MS)
    }

    /** Beklemeden kaldırır (hata yolu). */
    fun hideNow() { kaldir() }

    /**
     * Örtünün görünümü dışarıdan düşürüldü (render süreci çöktü, setContentView içerik ağacını
     * değiştirdi). Alan bırakılır; yoksa isShowing() sonsuza dek doğru kalırdı.
     */
    fun unut() {
        h.removeCallbacksAndMessages(null)
        val v = view
        view = null
        try { v?.disposeComposition() } catch (_: Throwable) { /* zaten atılmış olabilir */ }
    }

    private fun kaldir() {
        h.removeCallbacks(emniyet)
        val v = view ?: return
        view = null
        v.animate().alpha(0f).setDuration(SOLMA_MS).withEndAction {
            (v.parent as? ViewGroup)?.removeView(v)
            v.disposeComposition()
        }.start()
    }
}

// ---- Ekranın kendisi ---------------------------------------------------------------------------

private val ZEMIN_UST = Color(0xFF0B1622)
private val ZEMIN_ORTA = Color(0xFF08111B)
private val ZEMIN_ALT = Color(0xFF07101A)
private val VURGU = Color(0xFF50E7F2)          // camgöbeği: duvar kenarları, ölçü çentikleri, eksenler
private val MAVI = Color(0xFF258CFF)           // yüz dolguları
private val SOLUK = Color(0xFF8FA3B8)          // izdüşüm çizgileri, ölçü çizgileri
private val METIN = Color(0xFFEAF3FF)
private val SLOGAN = Color(0xFFB7C3D0)
private val TELIF = Color(0xFF71869A)

@Composable
fun DwgSplashScreen(hareket: Boolean, modifier: Modifier = Modifier) {
    // Çizimin ilerlemesi: 0 → 1 tek seferlik. Hareket kapalıysa bitmiş hâlde başlar.
    val cizim = remember { Animatable(if (hareket) 0f else 1f) }
    LaunchedEffect(Unit) {
        if (hareket) cizim.animateTo(1f, tween(SplashOverlay.CIZIM_MS, easing = FastOutSlowInEasing))
    }
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(ZEMIN_UST, ZEMIN_ORTA, ZEMIN_ALT)))
    ) {
        MilimetrikKagit(Modifier.fillMaxSize())
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.weight(0.8f))
            Text(
                text = stringResource(R.string.splash_tagline),
                color = SLOGAN,
                fontSize = 21.sp,
                lineHeight = 29.sp,
                fontWeight = FontWeight.SemiBold,
                fontStyle = FontStyle.Italic,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.weight(0.7f))
            TeknikCizim(t = cizim.value, modifier = Modifier.size(300.dp))
            Spacer(Modifier.weight(1f))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                // Başlatıcı simgesinin kendisi (uyarlanabilir simge ImageView'da tam çizilir); köşeleri yuvarlanır
                AndroidView(
                    factory = { c -> ImageView(c).apply { setImageResource(R.mipmap.ic_launcher); scaleType = ImageView.ScaleType.FIT_CENTER } },
                    modifier = Modifier.size(56.dp).clip(RoundedCornerShape(14.dp))
                )
                Text(
                    text = stringResource(R.string.app_name),
                    color = METIN,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold
                )
            }
            Spacer(Modifier.height(16.dp))
            val yil = remember { Calendar.getInstance().get(Calendar.YEAR) }
            Text(
                text = "© $yil ${stringResource(R.string.app_name)} · ${stringResource(R.string.splash_rights)}",
                color = TELIF,
                fontSize = 12.sp,
                textAlign = TextAlign.Center
            )
            Spacer(Modifier.height(28.dp))
        }
    }
}

/** Çok soluk milimetrik kâğıt: 8 px ince, 40 px kalın çizgi — çizim açılış ekranıyla aynı doku */
@Composable
private fun MilimetrikKagit(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val ince = Color(0xFF16415A).copy(alpha = 0.10f)
        val kalin = Color(0xFF16415A).copy(alpha = 0.20f)
        val adim = 8f * density
        var i = 0
        var x = 0f
        while (x < size.width) { drawLine(if (i % 5 == 0) kalin else ince, Offset(x, 0f), Offset(x, size.height), 1f); x += adim; i++ }
        i = 0
        var y = 0f
        while (y < size.height) { drawLine(if (i % 5 == 0) kalin else ince, Offset(0f, y), Offset(size.width, y), 1f); y += adim; i++ }
    }
}

// ---- İllüstrasyon --------------------------------------------------------------------------------
// Model birimleri: plan 46 × 42 (x: −23…23, y: −21…21), orta bölme y = 0'da, duvar yüksekliği H.
// İzometrik izdüşüm: X = cx + (x − y)·cos30·s, Y = cy + (x + y)·sin30·s − z·s.
// Görünen yüzler: üst, y = +21 (sol ön), x = +23 (sağ ön). Arka dikey kenar ve orta bölmenin
// dış duvarla birleştiği dikey çizgiler GİZLİDİR ve kesikli çizilir.

private const val COS30 = 0.8660254f
private const val SIN30 = 0.5f
private const val H = 16f
/** Euler yolu: 7 nokta, 6 parça; hiçbir duvar iki kez geçilmez */
private val PLAN = floatArrayOf(-23f, 0f, -23f, 21f, 23f, 21f, 23f, -21f, -23f, -21f, -23f, 0f, 23f, 0f)

@Composable
private fun TeknikCizim(t: Float, modifier: Modifier = Modifier) {
    val yazi = remember { Paint().apply { isAntiAlias = true; color = 0xFF8FA3B8.toInt(); textAlign = Paint.Align.CENTER } }
    val eksenYazi = remember { Paint().apply { isAntiAlias = true; color = 0xFF50E7F2.toInt(); textAlign = Paint.Align.CENTER; isFakeBoldText = true } }
    Canvas(modifier) {
        val w = size.minDimension
        val s = w / 138f                                   // birim başına piksel (gövde + izdüşümler kareyi doldurur)
        val cx = size.width / 2f
        val cy = size.height * 0.47f
        val lw = max(1.5f, s * 0.42f)
        val ince = max(1f, s * 0.22f)
        fun iso(x: Float, y: Float, z: Float) = Offset(cx + (x - y) * COS30 * s, cy + (x + y) * SIN30 * s - z * s)
        // üç perde: plan çizilir → duvarlar yükselir → izdüşümler, ölçüler ve eksenler belirir
        val t1 = (t / 0.40f).coerceIn(0f, 1f)
        val t2 = ((t - 0.35f) / 0.40f).coerceIn(0f, 1f)
        val t3 = ((t - 0.70f) / 0.30f).coerceIn(0f, 1f)
        val kesik = PathEffect.dashPathEffect(floatArrayOf(3.5f * s, 2.5f * s), 0f)

        // 1) plan: tek kalem darbesi, uzunluk oranıyla ilerler (parça boyları 21, 46, 42, 46, 21, 46)
        run {
            var toplam = 0f
            for (k in 0 until 6) { val ax = PLAN[k * 2]; val ay = PLAN[k * 2 + 1]; val bx = PLAN[k * 2 + 2]; val by = PLAN[k * 2 + 3]; toplam += kotlin.math.abs(bx - ax) + kotlin.math.abs(by - ay) }
            var kalan = toplam * t1
            for (k in 0 until 6) {
                if (kalan <= 0f) break
                val ax = PLAN[k * 2]; val ay = PLAN[k * 2 + 1]; val bx = PLAN[k * 2 + 2]; val by = PLAN[k * 2 + 3]
                val boy = kotlin.math.abs(bx - ax) + kotlin.math.abs(by - ay)
                val oran = min(1f, kalan / boy)
                val ex = ax + (bx - ax) * oran; val ey = ay + (by - ay) * oran
                drawLine(SOLUK, iso(ax, ay, 0f), iso(ex, ey, 0f), lw * 0.8f, StrokeCap.Round)
                kalan -= boy
            }
        }

        // 2) duvarlar yükselir: yüz dolguları, görünen kenarlar camgöbeği, gizli kenarlar kesikli
        if (t2 > 0f) {
            val h = H * t2
            val ust = Path().apply {
                moveTo(iso(-23f, 21f, h).x, iso(-23f, 21f, h).y); lineTo(iso(23f, 21f, h).x, iso(23f, 21f, h).y)
                lineTo(iso(23f, -21f, h).x, iso(23f, -21f, h).y); lineTo(iso(-23f, -21f, h).x, iso(-23f, -21f, h).y); close()
            }
            val solOn = Path().apply {
                moveTo(iso(-23f, 21f, 0f).x, iso(-23f, 21f, 0f).y); lineTo(iso(23f, 21f, 0f).x, iso(23f, 21f, 0f).y)
                lineTo(iso(23f, 21f, h).x, iso(23f, 21f, h).y); lineTo(iso(-23f, 21f, h).x, iso(-23f, 21f, h).y); close()
            }
            val sagOn = Path().apply {
                moveTo(iso(23f, 21f, 0f).x, iso(23f, 21f, 0f).y); lineTo(iso(23f, -21f, 0f).x, iso(23f, -21f, 0f).y)
                lineTo(iso(23f, -21f, h).x, iso(23f, -21f, h).y); lineTo(iso(23f, 21f, h).x, iso(23f, 21f, h).y); close()
            }
            val orta = Path().apply {                          // orta bölme: y = 0 düzlemi, x −23…23
                moveTo(iso(-23f, 0f, 0f).x, iso(-23f, 0f, 0f).y); lineTo(iso(23f, 0f, 0f).x, iso(23f, 0f, 0f).y)
                lineTo(iso(23f, 0f, h).x, iso(23f, 0f, h).y); lineTo(iso(-23f, 0f, h).x, iso(-23f, 0f, h).y); close()
            }
            drawPath(orta, VURGU, alpha = 0.10f * t2)         // camdan gövdenin içinde duran duvar
            drawPath(solOn, MAVI, alpha = 0.12f * t2)
            drawPath(sagOn, MAVI, alpha = 0.07f * t2)
            drawPath(ust, VURGU, alpha = 0.09f * t2)
            // gizli dikeyler: arka köşe ve orta bölmenin iki ucu (dış duvarın ardında kalır)
            drawLine(SOLUK, iso(-23f, -21f, 0f), iso(-23f, -21f, h), ince, StrokeCap.Round, kesik, alpha = 0.7f)
            drawLine(SOLUK, iso(23f, 0f, 0f), iso(23f, 0f, h), ince, StrokeCap.Round, kesik, alpha = 0.7f)
            drawLine(SOLUK, iso(-23f, 0f, 0f), iso(-23f, 0f, h), ince, StrokeCap.Round, kesik, alpha = 0.7f)
            // görünen dikeyler
            drawLine(VURGU, iso(23f, 21f, 0f), iso(23f, 21f, h), lw, StrokeCap.Round)
            drawLine(VURGU, iso(-23f, 21f, 0f), iso(-23f, 21f, h), lw, StrokeCap.Round)
            drawLine(VURGU, iso(23f, -21f, 0f), iso(23f, -21f, h), lw, StrokeCap.Round)
            // üst çevre ve orta bölmenin üst kenarı
            drawPath(ust, VURGU, alpha = t2, style = Stroke(lw, cap = StrokeCap.Round))
            drawLine(VURGU, iso(-23f, 0f, h), iso(23f, 0f, h), lw, StrokeCap.Round, alpha = t2)
        }

        // 3) izdüşümler: plan (altta), ön görünüş (sol üst), yan görünüş (sağ üst) + ölçüler + eksenler
        if (t3 > 0f) {
            val a = t3
            val s2 = s * 0.42f                                 // izdüşüm ölçeği
            val kagit = SOLUK.copy(alpha = 0.9f * a)
            yazi.textSize = 3.9f * s
            eksenYazi.textSize = 4.6f * s

            // plan görünüşü
            val pc = Offset(cx, cy + 0.34f * w)
            val pw = 46f * s2; val ph = 42f * s2
            val p0 = Offset(pc.x - pw / 2, pc.y - ph / 2)
            drawRect(kagit, p0, androidx.compose.ui.geometry.Size(pw, ph), style = Stroke(ince))
            drawLine(kagit, Offset(p0.x, pc.y), Offset(p0.x + pw, pc.y), ince)
            olcu(Offset(p0.x, p0.y + ph), Offset(p0.x + pw, p0.y + ph), Offset(0f, 1f), 5.5f * s, "46", yazi, a, ince, s)
            olcu(Offset(p0.x + pw, p0.y), Offset(p0.x + pw, p0.y + ph), Offset(1f, 0f), 5.5f * s, "42", yazi, a, ince, s)

            // ön görünüş (y = +21 yüzü): 46 × H
            val fc = Offset(cx - 0.30f * w, cy - 0.27f * w)
            val fw = 46f * s2; val fh = H * s2
            val f0 = Offset(fc.x - fw / 2, fc.y - fh / 2)
            drawRect(kagit, f0, androidx.compose.ui.geometry.Size(fw, fh), style = Stroke(ince))
            olcu(Offset(f0.x, f0.y), Offset(f0.x + fw, f0.y), Offset(0f, -1f), 5.5f * s, "46", yazi, a, ince, s)

            // yan görünüş (x = +23 yüzü): 42 × H, orta bölme gizli → kesikli
            val yc = Offset(cx + 0.30f * w, cy - 0.27f * w)
            val yw = 42f * s2; val yh = H * s2
            val y0 = Offset(yc.x - yw / 2, yc.y - yh / 2)
            drawRect(kagit, y0, androidx.compose.ui.geometry.Size(yw, yh), style = Stroke(ince))
            drawLine(kagit, Offset(yc.x, y0.y), Offset(yc.x, y0.y + yh), ince, pathEffect = kesik)
            olcu(Offset(y0.x + yw, y0.y), Offset(y0.x + yw, y0.y + yh), Offset(1f, 0f), 5.5f * s, "16", yazi, a, ince, s)

            // izdüşüm bağları: her görünüş gövdeye kesikli ince çizgiyle bağlanır
            val bag = SOLUK.copy(alpha = 0.35f * a)
            drawLine(bag, Offset(pc.x, p0.y), iso(23f, 21f, 0f), ince, pathEffect = kesik)
            drawLine(bag, Offset(fc.x, f0.y + fh), iso(-23f, 21f, H * 0.5f), ince, pathEffect = kesik)
            drawLine(bag, Offset(yc.x, y0.y + yh), iso(23f, -21f, H * 0.5f), ince, pathEffect = kesik)

            // eksen üçlüsü (sol alt): Z yukarı, X sağ-aşağı, Y sol-aşağı — izdüşümle aynı yönler
            val o = Offset(0.10f * w, size.height * 0.90f)
            val L = 9f * s
            val ex = VURGU.copy(alpha = a)
            drawLine(ex, o, Offset(o.x, o.y - L), lw * 0.8f, StrokeCap.Round)
            drawLine(ex, o, Offset(o.x + L * COS30, o.y + L * SIN30), lw * 0.8f, StrokeCap.Round)
            drawLine(ex, o, Offset(o.x - L * COS30, o.y + L * SIN30), lw * 0.8f, StrokeCap.Round)
            eksenYazi.alpha = (255 * a).toInt()
            val c = drawContext.canvas.nativeCanvas
            c.drawText("Z", o.x, o.y - L - 2.5f * s, eksenYazi)
            c.drawText("X", o.x + L * COS30 + 3.5f * s, o.y + L * SIN30 + 1.8f * s, eksenYazi)
            c.drawText("Y", o.x - L * COS30 - 3.5f * s, o.y + L * SIN30 + 1.8f * s, eksenYazi)
        }
    }
}

/**
 * Mimari ölçü çizgisi: iki uzatma çizgisi, aralarında ölçü çizgisi, uçlarda eğik çentik, ortada
 * sayı. `yon` ölçünün dışarı taşıma yönü (birim vektör), `pay` uzaklığı.
 */
private fun DrawScope.olcu(a: Offset, b: Offset, yon: Offset, pay: Float, metin: String, boya: Paint, alpha: Float, ince: Float, s: Float) {
    val renk = SOLUK.copy(alpha = 0.9f * alpha)
    val a2 = Offset(a.x + yon.x * (pay + 1.5f * s), a.y + yon.y * (pay + 1.5f * s))
    val b2 = Offset(b.x + yon.x * (pay + 1.5f * s), b.y + yon.y * (pay + 1.5f * s))
    val a1 = Offset(a.x + yon.x * pay, a.y + yon.y * pay)
    val b1 = Offset(b.x + yon.x * pay, b.y + yon.y * pay)
    drawLine(renk, a, a2, ince)                        // uzatma çizgileri
    drawLine(renk, b, b2, ince)
    drawLine(renk, a1, b1, ince)                       // ölçü çizgisi
    val cent = 1.4f * s                                // eğik çentik (mimari)
    val vurgu = VURGU.copy(alpha = alpha)
    drawLine(vurgu, Offset(a1.x - cent, a1.y + cent), Offset(a1.x + cent, a1.y - cent), ince * 1.4f, StrokeCap.Round)
    drawLine(vurgu, Offset(b1.x - cent, b1.y + cent), Offset(b1.x + cent, b1.y - cent), ince * 1.4f, StrokeCap.Round)
    boya.alpha = (255 * alpha).toInt()
    val mx = (a1.x + b1.x) / 2 + yon.x * 2.6f * s
    val my = (a1.y + b1.y) / 2 + yon.y * 2.6f * s + (if (yon.y == 0f) boya.textSize * 0.35f else if (yon.y > 0f) boya.textSize * 0.9f else -boya.textSize * 0.25f)
    drawContext.canvas.nativeCanvas.drawText(metin, mx, my, boya)
}
