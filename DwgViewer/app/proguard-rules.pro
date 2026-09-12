# DWG Görüntüleyici – R8 kuralları

# JS köprüsü: WebView yöntemleri adıyla çağırır; @JavascriptInterface yöntemleri ve adları korunur
-keepclassmembers class com.mahmuttari.dwgviewer.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# junrar (RAR 2/3/4) yansıma ve slf4j kullanır; olduğu gibi kalır
-keep class com.github.junrar.** { *; }
-dontwarn org.slf4j.**
