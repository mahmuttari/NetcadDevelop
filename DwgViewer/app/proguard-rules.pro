# DWG Görüntüleyici – R8 kuralları

# JS köprüsü: WebView yöntemleri adıyla çağırır; @JavascriptInterface yöntemleri ve adları korunur
-keepclassmembers class com.mahmuttari.dwgviewer.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# junrar (RAR 2/3/4) yansıma ve slf4j kullanır; olduğu gibi kalır
-keep class com.github.junrar.** { *; }
-dontwarn org.slf4j.**

# play-services-ads 23.6 API 35 sınıfına başvurur; compileSdk 34'te R8 bulamaz, uyarı bastırılır.
# Reklam SDK'sının ve Play Faturalandırma'nın (billing 7.1.1) kendi keep kuralları AAR ile gelir (consumer rules);
# ayrıca kural gerekmez.
-dontwarn android.media.LoudnessCodecController
-dontwarn android.media.LoudnessCodecController$OnLoudnessCodecUpdateListener
