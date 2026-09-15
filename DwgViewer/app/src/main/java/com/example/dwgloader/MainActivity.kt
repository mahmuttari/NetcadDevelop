package com.example.dwgloader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlin.math.min

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                DwgDemoApp()
            }
        }
    }
}

@Composable
private fun DwgDemoApp() {
    var progress by remember { mutableIntStateOf(0) }
    var finished by remember { mutableStateOf(false) }

    /*
     * DEMO:
     * Bu blok sadece çalışan örnek göstermek için yüklemeyi simüle eder.
     *
     * Gerçek uygulamada aşağıdaki loop'u kaldırın ve:
     *
     *   progress = dwgLoader.progress
     *
     * benzeri biçimde gerçek parser/render ilerlemesine bağlayın.
     */
    LaunchedEffect(Unit) {
        while (progress < 100) {
            delay(
                when {
                    progress < 20 -> 45L
                    progress < 55 -> 65L
                    progress < 85 -> 50L
                    else -> 85L
                }
            )
            progress = min(100, progress + (1..3).random())
        }
        delay(550)
        finished = true
    }

    Surface(color = Color(0xFF08111B), modifier = Modifier.fillMaxSize()) {
        AnimatedContent(
            targetState = finished,
            transitionSpec = { fadeIn(tween(450)) togetherWith fadeOut(tween(350)) },
            label = "screen"
        ) { isFinished ->
            if (!isFinished) {
                DwgLoadingScreen(
                    fileName = "Proje.dwg",
                    progress = progress
                )
            } else {
                FakeViewerScreen(fileName = "Proje.dwg")
            }
        }
    }
}

@Composable
fun DwgLoadingScreen(
    fileName: String,
    progress: Int,
    ayrinti: Boolean = true,
    modifier: Modifier = Modifier
) {
    val stage = stageFor(progress)
    val animatedProgress by animateFloatAsState(
        targetValue = progress / 100f,
        animationSpec = tween(220, easing = FastOutSlowInEasing),
        label = "progress"
    )

    val infinite = rememberInfiniteTransition(label = "loader")
    val pulse by infinite.animateFloat(
        initialValue = 0.65f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(900, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse"
    )

    val scan by infinite.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            tween(1350, easing = LinearEasing)
        ),
        label = "scan"
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        Color(0xFF0B1622),
                        Color(0xFF08111B),
                        Color(0xFF07101A)
                    )
                )
            )
    ) {
        BlueprintGrid(modifier = Modifier.fillMaxSize())

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(42.dp))

            Text(
                text = fileName,
                color = Color.White.copy(alpha = 0.72f),
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )

            Spacer(Modifier.weight(0.65f))

            DwgStageGraphic(
                progress = progress,
                pulse = pulse,
                scan = scan,
                modifier = Modifier.size(230.dp)
            )

            Spacer(Modifier.height(34.dp))

            Text(
                text = "$progress%",
                color = Color.White,
                fontSize = 38.sp,
                fontWeight = FontWeight.SemiBold
            )

            if (ayrinti) {
                Spacer(Modifier.height(9.dp))

                AnimatedContent(
                    targetState = stage.title,
                    transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(140)) },
                    label = "title"
                ) { title ->
                    Text(
                        text = title,
                        color = Color(0xFFEAF3FF),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Medium
                    )
                }

                Spacer(Modifier.height(8.dp))

                Text(
                    text = stage.subtitle,
                    color = Color(0xFF8FA3B8),
                    fontSize = 13.sp
                )

                Spacer(Modifier.height(30.dp))
            } else {
                // Ayrıntı kapalı: sayı ile çubuk arasında tek boşluk kalır.
                Spacer(Modifier.height(26.dp))
            }

            CadProgressBar(
                progress = animatedProgress,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(13.dp)
            )

            if (ayrinti) {
                Spacer(Modifier.height(18.dp))

                StageDots(stageIndex = stage.index)
            }

            Spacer(Modifier.weight(1f))

            if (ayrinti) {
                Text(
                    text = if (progress < 100) "DWG görüntüsü hazırlanıyor" else "Tamamlandı",
                    color = Color(0xFF71869A),
                    fontSize = 12.sp
                )
            }

            Spacer(Modifier.height(34.dp))
        }
    }
}

data class LoadingStage(
    val index: Int,
    val title: String,
    val subtitle: String
)

private fun stageFor(progress: Int): LoadingStage = when (progress) {
    in 0..14 -> LoadingStage(0, "DWG dosyası açılıyor…", "Dosya hazırlanıyor")
    in 15..29 -> LoadingStage(1, "Dosya okunuyor…", "Çizim verileri yükleniyor")
    in 30..47 -> LoadingStage(2, "Katmanlar işleniyor…", "Layer bilgileri ayrıştırılıyor")
    in 48..67 -> LoadingStage(3, "Geometri oluşturuluyor…", "Çizim nesneleri hazırlanıyor")
    in 68..84 -> LoadingStage(4, "Çizim optimize ediliyor…", "Görüntü hazırlanıyor")
    in 85..96 -> LoadingStage(5, "Görünüm ayarlanıyor…", "Viewport hazırlanıyor")
    in 97..99 -> LoadingStage(6, "Son kontroller yapılıyor…", "Render tamamlanıyor")
    else -> LoadingStage(7, "DWG hazır", "Dosya başarıyla açıldı")
}

@Composable
private fun CadProgressBar(progress: Float, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val radius = size.height / 2
        drawRoundRect(
            color = Color(0xFF1A2A38),
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius, radius),
            style = Stroke(width = 1.3f)
        )

        if (progress > 0f) {
            val w = size.width * progress
            drawRoundRect(
                brush = Brush.horizontalGradient(
                    listOf(Color(0xFF278EF7), Color(0xFF39D7F2))
                ),
                size = Size(w, size.height),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(radius, radius)
            )

            val x = w.coerceIn(radius, size.width - radius)
            drawCircle(
                color = Color(0xFF9CF7FF).copy(alpha = 0.35f),
                radius = 15f,
                center = Offset(x, size.height / 2)
            )
            drawCircle(
                color = Color(0xFFC9FBFF),
                radius = 3.8f,
                center = Offset(x, size.height / 2)
            )
        }
    }
}

@Composable
private fun StageDots(stageIndex: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(4) { i ->
            val active = when (stageIndex) {
                0, 1 -> i == 0
                2, 3 -> i == 1
                4, 5, 6 -> i == 2
                else -> i == 3
            }
            Box(
                Modifier
                    .size(if (active) 7.dp else 6.dp)
                    .background(
                        if (active) Color(0xFF39A9FF) else Color(0xFF32485B),
                        RoundedCornerShape(50)
                    )
            )
        }
    }
}

@Composable
private fun BlueprintGrid(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val step = 44f
        var x = 0f
        while (x < size.width) {
            drawLine(
                Color(0xFF16415A).copy(alpha = 0.12f),
                Offset(x, 0f),
                Offset(x, size.height),
                1f
            )
            x += step
        }
        var y = 0f
        while (y < size.height) {
            drawLine(
                Color(0xFF16415A).copy(alpha = 0.12f),
                Offset(0f, y),
                Offset(size.width, y),
                1f
            )
            y += step
        }
    }
}

@Composable
private fun DwgStageGraphic(
    progress: Int,
    pulse: Float,
    scan: Float,
    modifier: Modifier = Modifier
) {
    val cyan = Color(0xFF50E7F2)
    val blue = Color(0xFF258CFF)

    Canvas(modifier = modifier) {
        val cx = size.width / 2
        val cy = size.height / 2
        val s = size.minDimension

        drawCircle(
            color = blue.copy(alpha = 0.08f * pulse),
            radius = s * 0.43f,
            center = Offset(cx, cy)
        )
        drawCircle(
            color = blue.copy(alpha = 0.16f),
            radius = s * 0.35f,
            center = Offset(cx, cy),
            style = Stroke(1.5f)
        )

        when {
            progress < 30 -> drawDwgFile(cx, cy, s, scan, blue, cyan)
            progress < 50 -> drawLayers(cx, cy, s, blue, cyan, progress)
            progress < 72 -> drawGeometry(cx, cy, s, blue, cyan, progress)
            progress < 97 -> drawPlan(cx, cy, s, blue, cyan, progress)
            else -> drawSuccess(cx, cy, s, cyan, pulse)
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawDwgFile(
    cx: Float,
    cy: Float,
    s: Float,
    scan: Float,
    blue: Color,
    cyan: Color
) {
    val w = s * 0.34f
    val h = s * 0.47f
    val left = cx - w / 2
    val top = cy - h / 2
    val fold = w * 0.30f

    val p = Path().apply {
        moveTo(left + 8f, top)
        lineTo(left + w - fold, top)
        lineTo(left + w, top + fold)
        lineTo(left + w, top + h)
        lineTo(left, top + h)
        lineTo(left, top + 8f)
        close()
    }

    drawPath(
        path = p,
        brush = Brush.verticalGradient(
            listOf(Color(0xFF1A3248), Color(0xFF102033))
        )
    )
    drawPath(p, Color(0xFF8BC7FF), style = Stroke(2f))

    val foldPath = Path().apply {
        moveTo(left + w - fold, top)
        lineTo(left + w - fold, top + fold)
        lineTo(left + w, top + fold)
    }
    drawPath(foldPath, Color(0xFF8BC7FF), style = Stroke(2f))

    val scanY = top + h * scan
    drawLine(
        brush = Brush.horizontalGradient(listOf(Color.Transparent, cyan, Color.Transparent)),
        start = Offset(left - 18f, scanY),
        end = Offset(left + w + 18f, scanY),
        strokeWidth = 3.5f
    )

    // DWG badge
    val badgeTop = top + h * 0.67f
    drawRoundRect(
        brush = Brush.horizontalGradient(listOf(blue, Color(0xFF2FB8FF))),
        topLeft = Offset(left, badgeTop),
        size = Size(w, h * 0.25f),
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(7f, 7f)
    )

    // geometric text approximation (avoids font dependency inside Canvas)
    val y = badgeTop + h * 0.13f
    drawLine(Color.White, Offset(left + w*0.22f, y-12), Offset(left + w*0.22f, y+12), 3f)
    drawLine(Color.White, Offset(left + w*0.22f, y-12), Offset(left + w*0.33f, y-12), 3f)
    drawLine(Color.White, Offset(left + w*0.22f, y+12), Offset(left + w*0.33f, y+12), 3f)
    drawArc(Color.White, -90f, 180f, false, topLeft = Offset(left+w*0.27f, y-12), size = Size(w*0.15f, 24f), style = Stroke(3f))
    drawLine(Color.White, Offset(left+w*0.47f,y-12), Offset(left+w*0.52f,y+12), 3f)
    drawLine(Color.White, Offset(left+w*0.52f,y+12), Offset(left+w*0.58f,y-4), 3f)
    drawLine(Color.White, Offset(left+w*0.58f,y-4), Offset(left+w*0.64f,y+12), 3f)
    drawLine(Color.White, Offset(left+w*0.64f,y+12), Offset(left+w*0.69f,y-12), 3f)
    drawArc(Color.White, 30f, 300f, false, topLeft = Offset(left+w*0.72f,y-12), size = Size(w*0.19f, 24f), style = Stroke(3f))
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawLayers(
    cx: Float,
    cy: Float,
    s: Float,
    blue: Color,
    cyan: Color,
    progress: Int
) {
    val reveal = ((progress - 30) / 20f).coerceIn(0f, 1f)
    repeat(4) { i ->
        val y = cy - 40f + i * 28f
        val halfW = s * (0.28f + i * 0.025f)
        val h = s * 0.11f
        val alpha = 0.28f + i * 0.16f
        val p = Path().apply {
            moveTo(cx - halfW, y)
            lineTo(cx, y - h * reveal)
            lineTo(cx + halfW, y)
            lineTo(cx, y + h * reveal)
            close()
        }
        drawPath(p, if (i == 3) cyan.copy(alpha = alpha) else blue.copy(alpha = alpha), style = Stroke(2.2f))
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawGeometry(
    cx: Float,
    cy: Float,
    s: Float,
    blue: Color,
    cyan: Color,
    progress: Int
) {
    val t = ((progress - 50) / 22f).coerceIn(0f, 1f)
    val baseY = cy + s * 0.18f
    val left = cx - s * 0.28f
    val right = cx + s * 0.28f

    drawLine(blue.copy(alpha=.55f), Offset(left, baseY), Offset(right, baseY), 2f)
    drawLine(blue.copy(alpha=.45f), Offset(cx, baseY-s*.18f), Offset(cx, baseY+s*.10f), 1.5f)

    val heights = listOf(.24f, .37f, .29f, .42f, .32f)
    heights.forEachIndexed { i, h ->
        val x = left + (right-left) * (i/4f)
        val top = baseY - s*h*t
        drawLine(cyan.copy(alpha=.8f), Offset(x, baseY), Offset(x, top), 2.2f)
    }

    drawLine(cyan, Offset(left, baseY-s*.24f*t), Offset(cx, baseY-s*.29f*t), 2f)
    drawLine(cyan, Offset(cx, baseY-s*.29f*t), Offset(right, baseY-s*.32f*t), 2f)
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawPlan(
    cx: Float,
    cy: Float,
    s: Float,
    blue: Color,
    cyan: Color,
    progress: Int
) {
    val t = ((progress - 72) / 25f).coerceIn(0f, 1f)
    val w = s * 0.60f
    val h = s * 0.45f
    val left = cx - w/2
    val top = cy - h/2

    drawRect(
        Color(0xFFB9D5E9).copy(alpha = .42f*t),
        Offset(left, top),
        Size(w, h),
        style = Stroke(2f)
    )
    drawLine(cyan.copy(alpha=.65f*t), Offset(left+w*.36f, top), Offset(left+w*.36f, top+h), 1.8f)
    drawLine(cyan.copy(alpha=.65f*t), Offset(left+w*.68f, top), Offset(left+w*.68f, top+h), 1.8f)
    drawLine(blue.copy(alpha=.7f*t), Offset(left, top+h*.42f), Offset(left+w, top+h*.42f), 1.8f)
    drawLine(blue.copy(alpha=.7f*t), Offset(left+w*.36f, top+h*.70f), Offset(left+w, top+h*.70f), 1.8f)

    // CAD corner marks
    val m = 14f
    drawLine(cyan, Offset(left-m,top-m), Offset(left+12,top-m), 2f)
    drawLine(cyan, Offset(left-m,top-m), Offset(left-m,top+12), 2f)
    drawLine(cyan, Offset(left+w+m,top+h+m), Offset(left+w-12,top+h+m), 2f)
    drawLine(cyan, Offset(left+w+m,top+h+m), Offset(left+w+m,top+h-12), 2f)
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawSuccess(
    cx: Float,
    cy: Float,
    s: Float,
    cyan: Color,
    pulse: Float
) {
    drawCircle(
        color = cyan.copy(alpha = .12f * pulse),
        radius = s*.28f
    )
    drawCircle(
        color = cyan,
        radius = s*.22f,
        style = Stroke(7f)
    )
    val p = Path().apply {
        moveTo(cx-s*.10f, cy)
        lineTo(cx-s*.025f, cy+s*.08f)
        lineTo(cx+s*.13f, cy-s*.10f)
    }
    drawPath(p, cyan, style = Stroke(width = 9f, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

@Composable
private fun FakeViewerScreen(fileName: String) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF08111B))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp)
                .background(Color(0xFF0C1723))
                .padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("‹", color = Color.White, fontSize = 34.sp)
            Spacer(Modifier.weight(1f))
            Text(fileName, color = Color.White, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.weight(1f))
            Text("⋮", color = Color.White, fontSize = 27.sp)
        }

        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            BlueprintGrid(Modifier.fillMaxSize())
            Canvas(Modifier.fillMaxWidth(.82f).aspectRatio(1.05f)) {
                val c = Color(0xFFB6CBDD)
                drawRect(c.copy(alpha=.75f), style = Stroke(2f))
                drawLine(c, Offset(size.width*.32f,0f), Offset(size.width*.32f,size.height),2f)
                drawLine(c, Offset(size.width*.69f,0f), Offset(size.width*.69f,size.height),2f)
                drawLine(c, Offset(0f,size.height*.38f), Offset(size.width,size.height*.38f),2f)
                drawLine(c, Offset(size.width*.32f,size.height*.68f), Offset(size.width,size.height*.68f),2f)
                drawRect(c.copy(alpha=.7f), Offset(size.width*.07f,size.height*.08f), Size(size.width*.18f,size.height*.19f), style=Stroke(1.5f))
                drawRect(c.copy(alpha=.7f), Offset(size.width*.75f,size.height*.11f), Size(size.width*.18f,size.height*.20f), style=Stroke(1.5f))
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(82.dp)
                .background(Color(0xFF101D2A))
                .padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            ViewerAction("Katmanlar", "▱")
            ViewerAction("Ölçüm", "╱")
            ViewerAction("Görünüm", "◉")
            ViewerAction("Paylaş", "⌯")
        }
    }
}

@Composable
private fun ViewerAction(label: String, icon: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(icon, color = Color(0xFFDBE9F4), fontSize = 23.sp)
        Spacer(Modifier.height(3.dp))
        Text(label, color = Color(0xFFAABCCC), fontSize = 10.sp)
    }
}
