package com.mahmuttari.dwgviewer;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * DWG OfficeZip – Android kabuğu.
 *
 * Çizim işi WebView içindeki HTML/JS'te yapılır. Bu sınıf:
 *  1. assets/viewer sayfasını sahte bir https kökünden sunar,
 *  2. seçilen / paylaşılan / indirilen dosyaları aynı kökte /file/<id> adresinde akıtır,
 *  3. dosya seçici, son dosyalar, pano, konum, kamera izni, PNG/PDF kaydetme ve
 *     paylaşma, indirme deposu, küçük resimler, ayar/not deposu ve hata kaydı için köprü sağlar,
 *  4. SAF ağaç izniyle klasör gezgini (kökler, listeleme, arama, açma) köprüsü sunar.
 */
public class MainActivity extends androidx.activity.ComponentActivity {

    private static final String TAG = "DwgViewer";
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/viewer/index.html";
    private static final int REQ_PICK = 1001;
    /** Son açılan seçicinin çoklu seçim isteyip istemediği (toplu işlem) */
    private boolean pickMulti = false;
    private static final int REQ_TREE = 1002;
    private static final int REQ_LOCATION = 2001;
    private static final int REQ_CAMERA = 2002;
    private static final int RECENT_MAX = 30;
    private static final String BUILD_ID = "v" + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ", " + BuildConfig.GIT_SHA + ")";

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html"); MIME.put("js", "text/javascript"); MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css"); MIME.put("json", "application/json"); MIME.put("wasm", "application/wasm");
        MIME.put("png", "image/png"); MIME.put("jpg", "image/jpeg"); MIME.put("jpeg", "image/jpeg"); MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2"); MIME.put("md", "text/plain"); MIME.put("pdf", "application/pdf");
        MIME.put("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); MIME.put("doc", "application/msword");
        MIME.put("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); MIME.put("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        MIME.put("zip", "application/zip"); MIME.put("rar", "application/vnd.rar"); MIME.put("txt", "text/plain"); MIME.put("csv", "text/csv"); MIME.put("xml", "text/xml");
        MIME.put("gif", "image/gif"); MIME.put("webp", "image/webp"); MIME.put("bmp", "image/bmp"); MIME.put("dxf", "application/dxf"); MIME.put("dwg", "application/acad");
    }

    private static boolean crashHookSet;
    private WebView webView;
    private boolean pageReady;
    // sayfa hazır olmadan gelen JS çağrıları (Google giriş sonucu, paylaşılan metin, liste yenileme)
    private final List<String> pendingJs = new ArrayList<>();
    private Object backCallback; // android.window.OnBackInvokedCallback (API 33+)

    // geçerli dosya
    private Uri currentUri;
    /** bu açılışta intent'le gelen dosya var mı: 'bekleyen dosya' yalnız budur */
    private boolean intentBekliyor;
    /** render süreci çöktükten sonra açık dosya BİR KEZ geri yüklenir (döngüye girmesin diye sayılır) */
    private int cokmeKurtarma;
    private File currentFile;
    private String currentName;
    private long currentSize;

    // seçilen dosya yuvaları: id → Uri
    private final Map<String, Uri> slots = new HashMap<>();
    private int slotSeq = 0;
    private String pickPurpose = "open";

    private LocationManager locationManager;
    private LocationListener locationListener;
    private PermissionRequest pendingCameraRequest;

    // belgeler (PDF / Word / ZIP / RAR), Google Drive ve WebDAV
    private Docs docs;
    private GoogleDrive google;
    private WebDav webdav;
    /** Reklam: AdMob geçiş reklamı; yalnız Pro yetkisi yokken başlatılır, Pro'ya geçince bırakılır */
    private Ads ads;
    /** Pro yetkisi (Play satın alması ya da lisans kodu; prefs "pro") ve Google Play Faturalandırma */
    private Pro pro;
    private Billing billing;
    /** Ana iş parçacığı zamanlayıcısı: süreli lisans bitiş planı (scheduleLicenseExpiry) */
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService bg = java.util.concurrent.Executors.newSingleThreadExecutor();
    /** Klasör gezgini (fsList/fsSearch) kendi yürütücüsünde: Drive yüklemesi ya da önbellek kopyasının arkasında sıraya girmez */
    private final java.util.concurrent.ExecutorService fsExec = java.util.concurrent.Executors.newSingleThreadExecutor();
    /** Son gönderilen fsSearch isteği; eskimiş bir arama her klasörden sonra buna bakıp vazgeçer (JS eski yanıtı zaten seq ile atar) */
    private volatile String fsSearchLatest;

    // ---------------------------------------------------------------------------------------
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Java tarafındaki yakalanmamış istisnalar (bg executor'daki OOM dahil) hata kaydına girer; süreç başına bir kez kurulur
        if (!crashHookSet) {
            crashHookSet = true;
            final Thread.UncaughtExceptionHandler def = Thread.getDefaultUncaughtExceptionHandler();
            final Context app = getApplicationContext(); // etkinlik değil: süreç boyunca yaşayan işleyici Activity'yi tutmasın
            Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
                appendLog(app, new Date() + " " + BUILD_ID + " " + t.getName() + " " + Log.getStackTraceString(e));
                if (def != null) def.uncaughtException(t, e);
            });
        }
        docs = new Docs(this);
        google = new GoogleDrive(this);
        webdav = new WebDav(this);
        pro = new Pro(this);
        // Sahip hesabı yetkisi, reklam kurulmadan ÖNCE eşitlenir: yoksa açılışta bir kez reklam kurulur
        // ve yetki sonradan yükselse de o örnek ayakta kalırdı.
        syncOwnerGrant();
        ads = new Ads(this);
        if (showsAds()) ads.init();
        // her açılışta Play sahipliği yeniden doğrulanır; hizmet yoksa sessizce geçilir, kayıtlı yetkiye dokunulmaz
        billing = new Billing(this, new Billing.Listener() {
            @Override public void onVerified(String tier, boolean restore) {
                if (!Tier.FREE.equals(tier)) { boolean changed = pro.set("play", tier, null, 0, ""); if (changed || restore) editionChanged("restored"); }
                else if (pro.clearPlay()) editionChanged("revoked");
                else if (restore) editionChanged("none");
            }
            @Override public void onPurchase(String state) {
                editionChanged(state);   // basamak zaten onVerified ile yazıldı
            }
            @Override public void onReady() {
                // yetki değişmedi; boş neden JS'te sessizdir, yalnız açık Pro paneli yeniden çizilir (fiyat, Satın al / Geri yükle etkin)
                jsWhenReady("window.dwgApp && window.dwgApp.onEdition(" + JSONObject.quote(pro.edition()) + ",\"\")");
            }
        });
        billing.connect();
        scheduleLicenseExpiry();
        bg.execute(() -> docs.sweep());
        createWebView();

        if (Build.VERSION.SDK_INT >= 33) {
            // Android 13+ tahminli geri hareketi: enableOnBackInvokedCallback açıkken onBackPressed çağrılmaz
            android.window.OnBackInvokedCallback cb = this::onBackPressed;
            backCallback = cb;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
        }

        // 7.46'da 'son oturumu geri yükle' varsayılanı açıktı ve Ayarlar bir kez kaydedilmişse
        // tercihlere true yazılmış olabilir; 7.47'de varsayılan kapalı olduğundan tek seferlik silinir
        if (prefs().getInt("prefsSurum", 0) < 70) prefs().edit().remove("resumeLast").putInt("prefsSurum", 70).apply();

        // yeniden yaratılmada geçerli dosya durumdan geri alınır; zaten işlenmiş intent (giriş dönüşü vb.) yeniden işlenmez
        if (savedInstanceState == null) handleIntent(getIntent()); else restoreState(savedInstanceState);
        webView.loadUrl(START_URL);
    }

    /** WebView'ı kurar; render süreci çöktüğünde yeniden çağrılır */
    private void createWebView() {
        webView = new WebView(this);
        pageReady = false;
        webView.setBackgroundColor(0xFF161C25);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        // yerel varlıklar zaten no-store sunulur; yalnız harita karoları sunucunun Cache-Control'üne göre önbelleğe girer
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        s.setGeolocationEnabled(false);
        // sayfa yalnız yerel assets'ten gelir; http WMS/XYZ ve http pafta sunucuları için gerekli
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && u.toString().startsWith(ORIGIN)) return serve(u);
                return null; // harita karoları, WMS, sunucu indirmeleri: ağa gider
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(ORIGIN)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // başlangıç dosyasını app.js getPendingFile() ile kendisi alır;
                // pushCurrentFile yalnız onNewIntent / seçici / son dosyalar için
                pageReady = true;
                flushPendingJs();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail d) {
                appendLog(new Date() + " " + BUILD_ID + " WebView render süreci çöktü crash=" + d.didCrash() + " prio=" + d.rendererPriorityAtExit());
                if (webView != view) return true;
                Toast.makeText(MainActivity.this, d.didCrash() ? R.string.webview_crashed : R.string.webview_restarted, Toast.LENGTH_LONG).show();
                WebView old = webView;
                webView = null;
                // setContentView içerik görünümünün bütün çocuklarını düşürür; açılış örtüsünün
                // ComposeView'i de düşer. Alan bırakılmazsa isShowing() sonsuza dek true kalır
                // ve geri tuşu ölü bir örtüye iptal göndermeye devam eder.
                if (loadOverlay != null) { loadOverlay.unut(); }
                createWebView();           // setContentView eskisini ağaçtan düşürür
                old.destroy();
                // Çökme kurtarması: açık dosya sayfa yeniden yüklenince BİR KEZ geri açılır. İkinci
                // çökmede denenmez — ağır bir model bellek yetmediği için çöküyorsa sonsuz döngü olurdu;
                // o durumda ana ekran açılır ve dosya devam kartında tek dokunuş uzakta durur.
                if ((currentUri != null || currentFile != null) && cokmeKurtarma == 0) cokmeKurtarma = 1; else cokmeKurtarma = 2;
                webView.loadUrl(START_URL); // sayfa açılınca bekleyen dosyayı getPendingFile ile çeker
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                boolean wantsCamera = false;
                for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
                if (!wantsCamera) { request.deny(); return; }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingCameraRequest = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                }
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (handleIntent(intent)) { pushCurrentFile(); intentBekliyor = false; } // yalnız yeni dosya geldiyse; giriş dönüşü ve simge tıklaması yüklemez
    }

    /** true: intent'ten yeni bir dosya alındı */
    private boolean handleIntent(Intent intent) {
        if (intent == null) return false;
        Uri uri = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
            // Google ile giriş yönlendirmesi
            if (uri != null && google.handleRedirect(uri, (ok, json) -> {
                // Giriş başarılıysa sahip hesabı yetkisi HEMEN eşitlenir; JS onGoogle'ı aldığında basamak güncel olur.
                if (ok) runOnUiThread(() -> { if (syncOwnerGrant()) editionChanged(Owner.SOURCE); });
                jsWhenReady("window.dwgApp && window.dwgApp.onGoogle(" + ok + "," + json + ")");
            })) return false;
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) {
                // paylaşılan bağlantı / metin: QR akışıyla aynı yoldan (https://…/pafta.dwg#B-127, dwg://…, B-127)
                String txt = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (txt != null && !txt.trim().isEmpty())
                    jsWhenReady("window.dwgApp && window.dwgApp.onQr && window.dwgApp.onQr(" + JSONObject.quote(txt.trim()) + ")");
                return false;
            }
        }
        if (uri == null) return false;
        setCurrent(uri, false);
        intentBekliyor = true;
        return true;
    }

    private void setCurrent(Uri uri, boolean underTree) { setCurrent(uri, underTree, null, -1); }

    /**
     * underTree=true: SAF ağaç izni altındaki belge — izin ağaçla yaşar; kalıcı izin denenmez, önbelleğe kopyalanmaz.
     * knownName/knownSize verilmişse (klasör gezgini) sağlayıcı yeniden sorgulanmaz.
     */
    private void setCurrent(Uri uri, boolean underTree, String knownName, long knownSize) {
        currentUri = uri;
        currentFile = null;
        currentName = knownName != null && !knownName.isEmpty() ? knownName : queryName(uri);
        currentSize = knownSize >= 0 ? knownSize : querySize(uri);
        boolean persistable = underTree;
        if (!underTree) try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            persistable = true;
        } catch (Exception ignored) { }
        addRecent(uri.toString(), currentName, currentSize);
        if (!persistable && ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            // dosya yöneticisi / WhatsApp / e-postadan gelen geçici URI: süreç kapanınca erişilemez.
            // Arka planda önbelleğe kopyalanır, kayıt file:// olarak değiştirilir (UI bloklanmaz, dosya URI'den açılır)
            final Uri src = uri; final String name = currentName; final long size0 = currentSize; final String srcKey = uri.toString();
            bg.execute(() -> {
                try (InputStream in = getContentResolver().openInputStream(src)) {
                    if (in == null) return;
                    JSONObject o = docs.importStream(in, name);
                    final File copy = docs.file(o.getString("id"));
                    final long size = size0 >= 0 ? size0 : copy.length(); // küçük resim anahtarı (ad_boyut) değişmesin
                    runOnUiThread(() -> {
                        removeRecent(srcKey);
                        if (src.equals(currentUri)) { currentUri = null; currentFile = copy; currentSize = size; }
                        addRecent(Uri.fromFile(copy).toString(), name, size);
                        jsWhenReady("window.dwgApp && window.dwgApp.refreshRecent && window.dwgApp.refreshRecent()");
                    });
                } catch (Exception e) { Log.w(TAG, "kopya", e); }
            });
        }
    }

    private void setCurrentFile(File f) {
        currentFile = f;
        currentUri = null;
        currentName = f.getName().replaceFirst("^\\d+_", "");
        currentSize = f.length();
        addRecent(Uri.fromFile(f).toString(), currentName, currentSize);
    }

    private void pushCurrentFile() {
        if (!pageReady || (currentUri == null && currentFile == null)) return;
        js("window.dwgApp && window.dwgApp.loadCurrent(" + JSONObject.quote(currentName) + "," + currentSize + ")");
    }

    private void js(String code) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(code, null));
    }

    // ---- Pro yetkisi ----------------------------------------------------------------------------
    /** Reklam gösterilecek mi? Hiçbir abonelik ya da lisans yoksa (basamak free) evet. */
    private boolean showsAds() { return pro == null || Tier.showsAds(pro.edition()); }
    /** Herhangi bir ücretli basamak var mı? (reklamın kapanma ölçütü) */
    private boolean paid() { return !showsAds(); }

    /**
     * Yetki değişimi/olayı JS'e bildirilir: onEdition("pro"|"free", reason); reason: "purchased" | "cancelled" | "pending" |
     * "error:<mesaj>" | "restored" | "none" | "license" | "revoked". Pro'ya geçince yüklü reklam bırakılır; yetki
     * düşünce (revoked) reklam yeniden kurulur. Ana iş parçacığında çağrılır.
     */
    private void editionChanged(String reason) {
        String ed = pro.edition();
        if (paid()) { if (ads != null) ads.destroy(); }
        else if (ads == null || "revoked".equals(reason)) { ads = new Ads(this); ads.init(); }
        jsWhenReady("window.dwgApp && window.dwgApp.onEdition(" + JSONObject.quote(ed) + "," + JSONObject.quote(reason) + ")");
        scheduleLicenseExpiry();
    }

    /**
     * Sahip hesabı yetkisini Google oturumuyla eşitler: giriş yapılan hesap {@link Owner} listesindeyse
     * en üst paket verilir, oturum kapalıysa ya da başka bir hesapsa kayıt silinir. Yetki değiştiyse true.
     * Her açılışta ve her giriş/çıkışta çağrılır — böylece hesap değişince yetki geride kalmaz.
     */
    private boolean syncOwnerGrant() {
        try {
            String email = (google != null && google.signedIn()) ? Owner.emailOf(google.user()) : "";
            if (!email.isEmpty() && Owner.is(email)) return pro.set(Owner.SOURCE, Owner.TIER, email, 0, "");
            return pro.clearOwner();
        } catch (Exception e) { return false; }
    }

    /** Süreli lisansın bitişinde çalışır: Pro.get() süresi dolan kaydı siler; yetki düştüyse JS'e "revoked" bildirilir */
    private final Runnable licenseExpiry = () -> { if (pro != null && showsAds()) editionChanged("revoked"); };
    /**
     * Süreli lisans (exp > 0) uygulama açıkken biterse yetki düşüşü bekletilmeden bildirilsin: bitişten 1 s sonra
     * editionChanged("revoked") planlanır (şerit, reklam zamanlayıcısı ve panel Pro'da kalmasın). Önceki plan iptal edilir;
     * süresiz yetki ya da yetki yokken plan yoktur. onCreate'te, lisans etkinleştirilince ve her yetki olayında çağrılır.
     */
    private void scheduleLicenseExpiry() {
        mainHandler.removeCallbacks(licenseExpiry);
        long exp = pro == null ? 0 : pro.nextExpiry();   // iki kaynaktan en yakın bitiş
        if (exp <= 0) return;
        long delay = Math.max(0, exp * 1000L - System.currentTimeMillis()) + 1000L;
        mainHandler.postDelayed(licenseExpiry, delay);
    }

    /** Sayfa hazırsa hemen, değilse onPageFinished'te çalıştırır (giriş dönüşü sayfa yüklenmeden gelebilir) */
    private void jsWhenReady(String code) {
        runOnUiThread(() -> { if (pageReady) js(code); else pendingJs.add(code); });
    }

    private void flushPendingJs() {
        for (String code : pendingJs) js(code);
        pendingJs.clear();
    }

    // ---- durum (yeniden yaratılma) -------------------------------------------------------------
    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (currentUri != null) out.putString("currentUri", currentUri.toString());
        if (currentFile != null) out.putString("currentFile", currentFile.getAbsolutePath());
        out.putString("currentName", currentName);
        out.putLong("currentSize", currentSize);
    }

    private void restoreState(Bundle in) {
        String u = in.getString("currentUri"), f = in.getString("currentFile");
        if (u == null && f == null) return;
        currentUri = u == null ? null : Uri.parse(u);
        currentFile = f == null ? null : new File(f);
        currentName = in.getString("currentName", "cizim.dwg");
        currentSize = in.getLong("currentSize", -1);
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        // hafif: açık PDF çizicisi bırakılır (gerektiğinde yeniden açılır)
        if (level >= TRIM_MEMORY_RUNNING_LOW && docs != null) docs.closePdf();
    }

    // ---- dosya adı / boyutu ----------------------------------------------------------------
    private String queryName(Uri uri) {
        String name = null;
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (i >= 0) name = c.getString(i);
                }
            } catch (Exception e) { Log.w(TAG, "ad okunamadı", e); }
        }
        if (name == null) name = uri.getLastPathSegment();
        if (name == null) name = "cizim.dwg";
        return name;
    }

    private long querySize(Uri uri) {
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int i = c.getColumnIndex(OpenableColumns.SIZE);
                    if (i >= 0 && !c.isNull(i)) return c.getLong(i);
                }
            } catch (Exception ignored) { }
        } else if (ContentResolver.SCHEME_FILE.equals(uri.getScheme()) && uri.getPath() != null) {
            return new File(uri.getPath()).length();
        }
        return -1;
    }

    // ---- sahte https kökü ------------------------------------------------------------------
    private WebResourceResponse serve(Uri url) {
        String path = url.getPath() == null ? "" : url.getPath();
        try {
            if (path.startsWith("/assets/")) {
                String asset = path.substring("/assets/".length());
                InputStream in = getAssets().open(asset, AssetManager.ACCESS_STREAMING);
                return ok(mimeOf(asset), in, -1);
            }
            if (path.startsWith("/file/")) {
                String id = path.substring("/file/".length());
                if (id.equals("current")) {
                    if (currentFile != null) return ok("application/octet-stream", new FileInputStream(currentFile), currentFile.length());
                    if (currentUri != null) {
                        InputStream in = getContentResolver().openInputStream(currentUri);
                        if (in != null) return ok("application/octet-stream", in, currentSize);
                    }
                    return notFound();
                }
                if (id.startsWith("slot_")) {
                    Uri u = slots.get(id);
                    if (u == null) return notFound();
                    InputStream in = getContentResolver().openInputStream(u);
                    return in == null ? notFound() : ok("application/octet-stream", in, -1);
                }
                if (id.startsWith("thumb_")) {
                    File f = new File(dir("thumbs"), safe(id.substring(6)) + ".png");
                    return f.exists() ? ok("image/png", new FileInputStream(f), f.length()) : notFound();
                }
                if (id.startsWith("photo_")) {
                    File f = new File(dir("photos"), safe(id));
                    return f.exists() ? ok("image/jpeg", new FileInputStream(f), f.length()) : notFound();
                }
                if (id.startsWith("dl_")) {
                    File f = new File(dir("downloads"), safe(id.substring(3)));
                    return f.exists() ? ok("application/octet-stream", new FileInputStream(f), f.length()) : notFound();
                }
                if (id.startsWith("f_")) {
                    File f = docs.file(id);
                    return f != null && f.exists() ? ok(mimeOf(docs.name(id)), new FileInputStream(f), f.length()) : notFound();
                }
                if (id.startsWith("pdfpage_")) {
                    // pdfpage_<f_n>_<sayfa>_<genişlik>
                    String[] parts = id.split("_");
                    if (parts.length >= 5) {
                        byte[] png = docs.pdfPage(parts[1] + "_" + parts[2], Integer.parseInt(parts[3]), Integer.parseInt(parts[4]));
                        return ok(png.length > 8 && png[0] == (byte) 0x89 ? "image/png" : "image/jpeg", new ByteArrayInputStream(png), png.length);
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "sunulamadı: " + path, e);
        }
        return notFound();
    }

    private static WebResourceResponse ok(String mime, InputStream in, long len) {
        WebResourceResponse r = new WebResourceResponse(mime, null, in);
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Access-Control-Allow-Origin", "*");
        if (len > 0) h.put("Content-Length", Long.toString(len));
        r.setResponseHeaders(h);
        return r;
    }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    private static String mimeOf(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase();
        String m = MIME.get(ext);
        return m == null ? "application/octet-stream" : m;
    }

    private File dir(String name) {
        File d = new File(getFilesDir(), name);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static String safe(String s) {
        return s.replaceAll("[^A-Za-z0-9._\\-]", "_");
    }

    // ---- dosya seçici ---------------------------------------------------------------------
    private void openPicker(String purpose, String mime) { openPicker(purpose, mime, false); }

    private void openPicker(String purpose, String mime, boolean multi) {
        pickPurpose = purpose == null ? "open" : purpose;
        pickMulti = multi;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        if (multi) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        // kalıcı izin: 'son dosyalar' uygulama yeniden başladıktan sonra da açılsın
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        i.setType(mime == null || mime.isEmpty() ? "*/*" : mime);
        if (mime == null || mime.equals("*/*")) {
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/acad", "application/x-acad", "application/autocad_dwg", "application/dwg", "application/x-dwg",
                    "application/x-autocad", "image/vnd.dwg", "image/x-dwg", "drawing/dwg", "application/dxf", "image/vnd.dxf",
                    "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/zip", "application/x-zip-compressed", "application/vnd.rar", "application/x-rar-compressed", "image/*", "text/*",
                    "application/octet-stream", "*/*"});
        }
        try {
            startActivityForResult(i, REQ_PICK);
        } catch (Exception e) {
            Toast.makeText(this, R.string.open_failed, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_TREE) {
            // klasör seçimi (SAF ağaç izni); iptalde JS'e null döner
            Uri tree = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (tree == null) jsWhenReady("window.dwgApp && window.dwgApp.onFsRoot && window.dwgApp.onFsRoot(null)"); else onTreePicked(tree);
            return;
        }
        if (requestCode != REQ_PICK || resultCode != RESULT_OK || data == null) return;
        if (pickMulti) {
            // çoklu seçim: her URI'ye bir yuva verilir ve JS'e tek çağrıda liste gönderilir
            android.content.ClipData cd = data.getClipData();
            org.json.JSONArray arr = new org.json.JSONArray();
            int n = cd != null ? cd.getItemCount() : (data.getData() != null ? 1 : 0);
            for (int k = 0; k < n; k++) {
                Uri u = cd != null ? cd.getItemAt(k).getUri() : data.getData();
                if (u == null) continue;
                String sid = "slot_" + (++slotSeq);
                slots.put(sid, u);
                try {
                    JSONObject o = new JSONObject();
                    o.put("id", sid); o.put("name", queryName(u)); o.put("size", querySize(u));
                    arr.put(o);
                } catch (Exception e) { Log.w(TAG, "pickFiles", e); }
            }
            pickMulti = false;
            js("window.dwgApp && window.dwgApp.onFilesPicked && window.dwgApp.onFilesPicked(" + JSONObject.quote(pickPurpose) + "," + JSONObject.quote(arr.toString()) + ")");
            return;
        }
        if (data.getData() == null) return;
        Uri uri = data.getData();
        if ("open".equals(pickPurpose)) {
            setCurrent(uri, false);
            pushCurrentFile();
            return;
        }
        String name = queryName(uri);
        long size = querySize(uri);
        String id;
        if ("photo".equals(pickPurpose)) {
            // fotoğrafı uygulama deposuna kopyala (not kalıcı olsun)
            id = "photo_" + System.currentTimeMillis();
            try (InputStream in = getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(new File(dir("photos"), id))) {
                copy(in, out);
            } catch (Exception e) {
                Log.w(TAG, "fotoğraf kopyalanamadı", e);
                return;
            }
        } else {
            id = "slot_" + (++slotSeq);
            slots.put(id, uri);
        }
        js("window.dwgApp && window.dwgApp.onFilePicked(" + JSONObject.quote(pickPurpose) + "," + JSONObject.quote(id) + "," + JSONObject.quote(name) + "," + size + ")");
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    // ---- son dosyalar -----------------------------------------------------------------------
    private SharedPreferences prefs() { return getSharedPreferences("dwgviewer", Context.MODE_PRIVATE); }

    /**
     * OTURUM SÜREKLİLİĞİ. Son açılan dosya kalıcı olarak saklanır; uygulama kapanıp yeniden
     * açıldığında getPendingFile bunu döndürür ve çizim kendiliğinden geri yüklenir. Eskiden
     * yalnız bellekteki currentUri/currentFile vardı: geri tuşuyla çıkıldığında etkinlik
     * ölüyor, dönüldüğünde dosya açılmamış oluyordu — kullanıcının bildirdiği kusur buydu.
     */
    private void sonOturumYaz(String uri, String name, long size) {
        try { prefs().edit().putString("sonUri", uri == null ? "" : uri).putString("sonAd", name == null ? "" : name).putLong("sonBoyut", size).apply(); }
        catch (Exception e) { Log.w(TAG, "son oturum", e); }
    }
    /** Son oturumu unutur (dosya açılamadığında JS tarafı çağırır) */
    private void sonOturumSil() { try { prefs().edit().remove("sonUri").remove("sonAd").remove("sonBoyut").apply(); } catch (Exception ignored) { } }
    /**
     * Saklanan son dosyayı geçerli dosya yapar. URI hâlâ okunabilir değilse (izin geri
     * alınmış, dosya silinmiş) false döner ve kayıt silinir; kullanıcı ana ekranda kalır.
     */
    private boolean sonOturumYukle() {
        String u = prefs().getString("sonUri", "");
        if (u == null || u.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(u);
            if ("file".equals(uri.getScheme())) {
                File f = new File(uri.getPath());
                if (!f.canRead()) { sonOturumSil(); return false; }
                currentFile = f; currentUri = null;
            } else {
                try (InputStream in = getContentResolver().openInputStream(uri)) { if (in == null) { sonOturumSil(); return false; } }
                currentUri = uri; currentFile = null;
            }
            currentName = prefs().getString("sonAd", "cizim.dwg");
            currentSize = prefs().getLong("sonBoyut", -1);
            return true;
        } catch (Exception e) { sonOturumSil(); return false; }
    }

    private void addRecent(String uri, String name, long size) {
        sonOturumYaz(uri, name, size);
        try {
            JSONArray old = new JSONArray(prefs().getString("recent", "[]"));
            JSONArray out = new JSONArray();
            JSONObject me = new JSONObject();
            me.put("uri", uri); me.put("name", name); me.put("size", size); me.put("time", System.currentTimeMillis());
            me.put("key", fileKey(name, size));
            out.put(me);
            for (int i = 0; i < old.length() && out.length() < RECENT_MAX; i++) {
                JSONObject o = old.getJSONObject(i);
                if (!uri.equals(o.optString("uri"))) out.put(o);
            }
            prefs().edit().putString("recent", out.toString()).apply();
        } catch (Exception e) { Log.w(TAG, "recent", e); }
    }

    private void removeRecent(String uri) {
        try {
            JSONArray old = new JSONArray(prefs().getString("recent", "[]")), out = new JSONArray();
            for (int i = 0; i < old.length(); i++) {
                JSONObject o = old.getJSONObject(i);
                if (!uri.equals(o.optString("uri"))) out.put(o);
            }
            prefs().edit().putString("recent", out.toString()).apply();
        } catch (Exception ignored) { }
    }

    /** app.js ile aynı kural: ad_boyut, izin verilmeyen karakterler '_' */
    private static String fileKey(String name, long size) {
        return (name + "_" + size).replaceAll("[^\\w.-]+", "_");
    }

    // ---- klasör gezgini (SAF ağaç izni) ----------------------------------------------------
    private static final Locale TR = new Locale("tr");
    private static final String[] FS_PROJ = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED};

    /** prefs "fs_roots": [{uri,name,time}] */
    private JSONArray fsRootsLoad() { try { return new JSONArray(prefs().getString("fs_roots", "[]")); } catch (Exception e) { return new JSONArray(); } }
    private void fsRootsSave(JSONArray a) { prefs().edit().putString("fs_roots", a.toString()).apply(); }

    private JSONArray fsRootsWithout(String uri) throws org.json.JSONException {
        JSONArray old = fsRootsLoad(), out = new JSONArray();
        for (int i = 0; i < old.length(); i++) { JSONObject o = old.getJSONObject(i); if (!uri.equals(o.optString("uri"))) out.put(o); }
        return out;
    }

    /** Ağaç kökünün görünen adı: ağaç belgesinin DISPLAY_NAME'i; yoksa kimliğin ':' sonrası son parçası; o da boşsa "Depolama" */
    private String fsRootName(Uri tree) {
        String id = null;
        try {
            id = DocumentsContract.getTreeDocumentId(tree);
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
            try (Cursor c = getContentResolver().query(doc, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) { String n = c.getString(0); if (n != null && !n.isEmpty()) return n; }
            }
        } catch (Exception e) { Log.w(TAG, "kök adı", e); }
        if (id != null) {
            String t = id.substring(id.lastIndexOf(':') + 1);           // "primary:Download" → "Download"
            if (t.endsWith("/")) t = t.substring(0, t.length() - 1);
            t = t.substring(t.lastIndexOf('/') + 1);
            if (!t.isEmpty()) return t;
        }
        return "Depolama";
    }

    /** ACTION_OPEN_DOCUMENT_TREE sonucu: kalıcı izin alınır, prefs'e yazılır, JS'e kök nesnesi (ya da null) bildirilir */
    private void onTreePicked(Uri tree) {
        JSONObject me = null;
        try {
            getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            me = new JSONObject();
            me.put("uri", tree.toString()); me.put("name", fsRootName(tree)); me.put("time", System.currentTimeMillis()); me.put("ok", true);
            JSONArray out = new JSONArray(); out.put(me);   // aynı uri ikinci kez eklenmez, zamanı yenilenir
            JSONArray rest = fsRootsWithout(tree.toString());
            for (int i = 0; i < rest.length(); i++) out.put(rest.get(i));
            fsRootsSave(out);
        } catch (Exception e) {
            Log.w(TAG, "ağaç izni", e);
            me = null;
            Toast.makeText(this, R.string.folder_denied, Toast.LENGTH_SHORT).show();
        }
        jsWhenReady("window.dwgApp && window.dwgApp.onFsRoot && window.dwgApp.onFsRoot(" + (me == null ? "null" : me.toString()) + ")");   // süreç öldürülüp yeniden yaratıldıysa sayfa henüz hazır değildir
    }

    /** Bir klasörün çocukları: [{id,name,dir,size,time,mime}]; gizli (.) girdiler atlanır; sıralama JS'te */
    private JSONArray fsChildren(Uri root, String docId) throws Exception {
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(root, docId);
        JSONArray arr = new JSONArray();
        try (Cursor c = getContentResolver().query(kids, FS_PROJ, null, null, null)) {
            if (c == null) throw new IOException("klasör okunamadı");
            // sütunlar adla bulunur: sağlayıcı projeksiyon sırasını korumak zorunda değildir (üçüncü taraf MatrixCursor)
            int iId = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID), iName = c.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int iMime = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE), iSize = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE), iTime = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            while (c.moveToNext()) {
                String name = c.isNull(iName) ? "" : c.getString(iName);
                if (name.isEmpty() || name.startsWith(".")) continue;
                String mime = iMime < 0 || c.isNull(iMime) ? "" : c.getString(iMime);
                JSONObject o = new JSONObject();
                o.put("id", c.getString(iId)); o.put("name", name); o.put("dir", DocumentsContract.Document.MIME_TYPE_DIR.equals(mime));
                o.put("size", iSize < 0 || c.isNull(iSize) ? -1 : c.getLong(iSize)); o.put("time", iTime < 0 || c.isNull(iTime) ? 0 : c.getLong(iTime)); o.put("mime", mime);
                arr.put(o);
            }
        }
        return arr;
    }

    /** Eskimiş arama: JS'in bekleyen kaydı kapansın diye ok=false döner; JS o isteğin sırası geçtiği için yanıtı zaten atar */
    private void fsCancelled(String reqId) {
        js("window.dwgApp && window.dwgApp.onFs(" + JSONObject.quote(reqId) + ",false," + JSONObject.quote("iptal") + ")");
    }

    private String fsMessage(Throwable e) {
        if (e instanceof SecurityException) return getString(R.string.folder_denied);
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }

    // ---- konum -----------------------------------------------------------------------------
    private boolean hasPermission(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }

    private void startLocation() {
        boolean fine = hasPermission(Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION);
        if (!fine && !coarse) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
            return;
        }
        if (locationManager == null) locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationListener != null) return;
        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location l) {
                String heading = l.hasBearing() ? String.valueOf(l.getBearing()) : "null";
                js("window.dwgApp && window.dwgApp.onLocation(" + l.getLatitude() + "," + l.getLongitude() + "," + l.getAccuracy() + "," + heading + "," + l.getSpeed() + ")");
            }
            @Override public void onProviderDisabled(String p) { js("window.dwgApp && window.dwgApp.onLocationError('GPS kapalı')"); }
            @Override public void onProviderEnabled(String p) { }
            @Override public void onStatusChanged(String p, int s, Bundle b) { }
        };
        try {
            // Android 12+ 'yaklaşık konum': yalnız COARSE varsa GPS sağlayıcısı kullanılamaz, ağ sağlayıcısıyla devam edilir
            if (fine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0.5f, locationListener);
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000, 1f, locationListener);
            if (!fine) Toast.makeText(this, R.string.location_approx, Toast.LENGTH_SHORT).show();
            Location last = fine ? locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER) : null;
            if (last == null) last = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last != null) locationListener.onLocationChanged(last);
        } catch (SecurityException e) {
            js("window.dwgApp && window.dwgApp.onLocationError('izin yok')");
        }
    }

    private void stopLocation() {
        if (locationManager != null && locationListener != null) {
            try { locationManager.removeUpdates(locationListener); } catch (Exception ignored) { }
        }
        locationListener = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION) {
            // izinler ada göre değerlendirilir: 'Yaklaşık' seçildiğinde yalnız COARSE gelir, o da yeter
            boolean fine = false, coarse = false;
            for (int i = 0; i < permissions.length && i < grantResults.length; i++) {
                if (grantResults[i] != PackageManager.PERMISSION_GRANTED) continue;
                if (Manifest.permission.ACCESS_FINE_LOCATION.equals(permissions[i])) fine = true;
                if (Manifest.permission.ACCESS_COARSE_LOCATION.equals(permissions[i])) coarse = true;
            }
            if (fine || coarse) startLocation();
            else if (!shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION))
                js("window.dwgApp && window.dwgApp.onLocationError('konum izni kalıcı olarak reddedildi; Ayarlar > Uygulamalar > DWG OfficeZip > İzinler yolundan verin')");
            else js("window.dwgApp && window.dwgApp.onLocationError('konum izni verilmedi')");
        } else if (requestCode == REQ_CAMERA && pendingCameraRequest != null) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) pendingCameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingCameraRequest.deny();
            pendingCameraRequest = null;
        }
    }

    /*
     * Çizim açılış ekranı YERLİ (native) katmandadır: başvuru sahibinin gönderdiği Jetpack
     * Compose ekranı WebView'ın üstünde gösterilir (DwgLoadingOverlay). JavaScript yalnız
     * gerçek yüzdeyi bildirir; çizimin kendisi Android'in arayüz iş parçacığında koşar, yani
     * WebView'daki çözümleme ağırlaşsa bile donmaz.
     */
    private DwgLoadingOverlay loadOverlay;

    // ---- geri tuşu ---------------------------------------------------------------------------
    @Override
    public void onBackPressed() {
        // Gönderilen açılış ekranında Vazgeç düğmesi yoktur; ekran açıkken geri tuşu yüklemeyi
        // iptal eder. Böylece ekrana dokunmadan çıkış yolu korunur.
        if (loadOverlay != null && loadOverlay.isShowing() && webView != null) {
            /*
             * İptal JavaScript'e gider, çünkü çözümleyici işini durduracak olan odur. Ama JS ya
             * da işleyici süreci tıkanmışsa geri tuşu hiçbir şey yapmaz ve kullanıcının çıkış
             * yolu kalmaz. Bu yüzden bir emniyet süresi konur: iptal bir saniye içinde örtüyü
             * kapatmadıysa örtü buradan kaldırılır. Çözümleme arka planda sürse bile kullanıcı
             * ekranda kilitli kalmaz.
             */
            webView.evaluateJavascript("window.dwgApp && window.dwgApp.cancelLoading && window.dwgApp.cancelLoading()", null);
            final DwgLoadingOverlay ov = loadOverlay;
            webView.postDelayed(() -> { if (ov.isShowing()) ov.hideNow(); }, 1000);
            return;
        }
        if (webView == null) { super.onBackPressed(); return; }
        // onBackSystem: kapatacak bir şey yoksa ve dosya açıksa ana ekrana döner (dosya
        // kapanmaz); yalnız ana ekranın Ev sekmesinde false döner, orada uygulama kapanır.
        webView.evaluateJavascript("window.dwgApp ? String(window.dwgApp.onBackSystem ? window.dwgApp.onBackSystem() : window.dwgApp.onBack()) : 'false'", value -> {
            if (!"\"true\"".equals(value) && !"true".equals(value)) finish();
        });
    }

    // ---- kaydetme / paylaşma ---------------------------------------------------------------
    /** Görüntü ya da belgeyi ortak depoya yazar; share=true ise paylaşım menüsünü açar. */
    private String saveShared(byte[] bytes, String fileName, String mime, String subDir, boolean share) throws IOException {
        Uri shareUri;
        String where;
        boolean image = mime.startsWith("image/");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/" + subDir);
            Uri coll = image ? MediaStore.Images.Media.EXTERNAL_CONTENT_URI : MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            Uri uri = getContentResolver().insert(coll, v);
            if (uri == null) throw new IOException("MediaStore kaydı açılamadı");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("çıkış akışı yok");
                out.write(bytes);
            }
            shareUri = uri;
            where = (image ? "Resimler/" : "İndirilenler/") + subDir + "/" + fileName;
        } else {
            File d = new File(getExternalFilesDir(image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOCUMENTS), subDir);
            if (!d.exists() && !d.mkdirs()) throw new IOException("klasör açılamadı");
            File f = new File(d, fileName);
            try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
            shareUri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            where = f.getAbsolutePath();
        }
        if (share) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, shareUri);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivity(Intent.createChooser(i, fileName)); } catch (Exception ignored) { }
        }
        return where;
    }

    private void appendLog(String line) { appendLog(this, line); }

    private static void appendLog(Context ctx, String line) {
        try {
            File d = new File(ctx.getFilesDir(), "log");
            if (!d.exists()) d.mkdirs();
            File f = new File(d, "errors.log");
            if (f.length() > 200_000) f.delete();
            try (FileOutputStream out = new FileOutputStream(f, true)) { out.write((line + "\n").getBytes(StandardCharsets.UTF_8)); }
        } catch (IOException ignored) { }
    }

    private String readFile(File f) {
        if (!f.exists()) return "";
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int n = in.read(b);
            return new String(b, 0, Math.max(0, n), StandardCharsets.UTF_8);
        } catch (IOException e) { return ""; }
    }

    // ---- JS köprüsü ---------------------------------------------------------------------------
    private class Bridge {
        @JavascriptInterface public void openFilePicker() { runOnUiThread(() -> openPicker("open", "*/*")); }
        @JavascriptInterface public void pickFile(String purpose, String mime) { runOnUiThread(() -> openPicker(purpose, mime, false)); }
        /** Çoklu seçim (toplu işlem): seçilen her dosya için bir yuva açılır, JS'e liste hâlinde bildirilir */
        @JavascriptInterface public void pickFiles(String purpose, String mime) { runOnUiThread(() -> openPicker(purpose, mime, true)); }

        /**
         * Sayfa açılırken JS'in soracağı dosya. YALNIZ gerçekten bekleyen bir dosya varsa
         * (paylaşım, dosya seçici, son dosyalar) döner.
         *
         * Son oturum BURADAN AÇILMAZ. Bir süre öyleydi ve yanlıştı: kullanıcı 27 MB'lık bir
         * modeli bir kez açtıktan sonra uygulama her açılışta onu yeniden çözümlüyordu,
         * istemediği hâlde. Son oturum artık ana ekrandaki "Kaldığınız yerden devam edin"
         * kartıyla sunulur (lastSessionInfo) ve yalnız kullanıcı dokununca yüklenir
         * (openLastSession). Otomatik açılış isteyen için ayar durur, varsayılanı KAPALI.
         */
        @JavascriptInterface
        public String getPendingFile() {
            boolean resume = false;
            // Bekleyen dosya YALNIZ bu açılışta gelen paylaşım/aç-ile intent'idir. currentUri/currentFile
            // bellekte kalmış (singleTask yeniden teslim) ya da onSaveInstanceState'ten geri kurulmuş
            // olabilir; o durumda uygulama kullanıcı dokunmadan çizimle açılırdı. Ayarı açmadıysa ana
            // ekran korunur, dosya 'kaldığınız yerden devam edin' kartında tek dokunuş uzakta durur.
            boolean kurtarma = cokmeKurtarma == 1 && (currentUri != null || currentFile != null);
            if (kurtarma) cokmeKurtarma = 2;
            if (!intentBekliyor && !kurtarma) {
                if (!prefs().getBoolean("resumeLast", false)) return "";
                if (!sonOturumYukle()) return "";
                resume = true;
            }
            intentBekliyor = false;
            try {
                JSONObject o = new JSONObject();
                o.put("name", currentName); o.put("size", currentSize); o.put("resume", resume);
                return o.toString();
            } catch (Exception e) { return ""; }
        }
        /** Ana ekrandaki devam kartı için: saklanan son dosyanın adı ve boyutu (yüklemeden) */
        @JavascriptInterface
        public String lastSessionInfo() {
            String u = prefs().getString("sonUri", "");
            if (u == null || u.isEmpty()) return "";
            try {
                JSONObject o = new JSONObject();
                o.put("name", prefs().getString("sonAd", "")); o.put("size", prefs().getLong("sonBoyut", -1));
                return o.toString();
            } catch (Exception e) { return ""; }
        }
        /** Devam kartına dokunuldu: saklanan son dosya normal yoldan açılır */
        @JavascriptInterface
        public void openLastSession() {
            runOnUiThread(() -> { if (sonOturumYukle()) pushCurrentFile(); else js("window.dwgApp && window.dwgApp.refreshResume && window.dwgApp.refreshResume()"); });
        }
        /** Ayar: son dosya açılışta KENDİLİĞİNDEN açılsın mı (varsayılan kapalı) */
        @JavascriptInterface public void setResumeLast(boolean on) { try { prefs().edit().putBoolean("resumeLast", on).apply(); } catch (Exception ignored) { } }
        @JavascriptInterface public boolean getResumeLast() { return prefs().getBoolean("resumeLast", false); }
        /** Son oturum açılamadı: kaydı sil, bir dahaki açılışta denenmesin */
        @JavascriptInterface public void forgetLastSession() { runOnUiThread(() -> { sonOturumSil(); currentUri = null; currentFile = null; }); }

        /**
         * Çizim açılış ekranı: show = true gösterir (açıksa yalnız dosya adını tazeler),
         * show = false kapatır (yüzde önce 100'e süpürülür, sonra örtü solar). Gerçek ilerleme
         * ayrı yoldan gelir: loadingProgress. Ekranın kendisi com.example.dwgloader
         * paketindedir ve gönderildiği gibidir; burada yalnız çağrılır.
         */
        @JavascriptInterface public void loadingScreen(boolean show, String file) {
            runOnUiThread(() -> {
                if (loadOverlay == null) loadOverlay = new DwgLoadingOverlay(MainActivity.this);
                if (show) loadOverlay.show(file == null ? "" : file); else loadOverlay.hide();
            });
        }
        /**
         * İptal ya da hata: açılış ekranı geçişini TAMAMLAMADAN kapanır. Normal kapanışta
         * (loadingScreen(false, ...)) yüzde önce 100'e varır; burada varmaz, çünkü dosya
         * açılmamıştır.
         */
        /**
         * Gerçek açılış ilerlemesi. Yüzdeler yüzde birlik çözünürlük için 100 ile çarpılmış
         * tam sayılardır. Ekran bu üçünden (gerçek yüzde · bandın sınırları · bandın beklenen
         * süresi) donmayan, sıçramayan bir sayı üretir; bkz. DwgLoadingOverlay.
         */
        @JavascriptInterface public void loadingProgress(int yuzde100, int alt100, int ust100, int beklenenMs) {
            runOnUiThread(() -> { if (loadOverlay != null) loadOverlay.ilerleme(yuzde100, alt100, ust100, beklenenMs); });
        }
        @JavascriptInterface public void loadingScreenAbort() {
            runOnUiThread(() -> { if (loadOverlay != null) loadOverlay.hideNow(); });
        }
        @JavascriptInterface public void toast(String msg) { runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show()); }
        @JavascriptInterface public void finish() { runOnUiThread(MainActivity.this::finish); }
        /**
         * Cihazın dil tercihleri, en yüksek öncelikliden başlayarak virgülle ayrılmış BCP-47 etiketleri
         * ("tr-TR,en-US"). Android 13 ve sonrasında kullanıcının uygulamaya özel dil seçimi de buraya yansır;
         * arayüz dili "otomatik" iken viewer bu listeden desteklediği ilk dili seçer.
         */
        @JavascriptInterface public String deviceLang() {
            StringBuilder sb = new StringBuilder();
            try {
                android.os.LocaleList ll = getResources().getConfiguration().getLocales();
                for (int i = 0; i < ll.size(); i++) { if (sb.length() > 0) sb.append(','); sb.append(ll.get(i).toLanguageTag()); }
            } catch (Throwable ignored) { /* eski sürüm ya da yapılandırma yok */ }
            if (sb.length() == 0) sb.append(Locale.getDefault().toLanguageTag());
            return sb.toString();
        }
        @JavascriptInterface public String appVersion() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public int versionCode() { return BuildConfig.VERSION_CODE; }
        /** Sürüm denetimi için version.json adresi (derlendiği dala göre) */
        @JavascriptInterface public String updateUrl() { return BuildConfig.UPDATE_URL; }
        /** Derleme kimliği: kısa git commit numarası ('yok' ise git bulunamadı) */
        @JavascriptInterface public String buildId() { return BuildConfig.GIT_SHA; }
        /** O anki basamak: "free" | "adfree" | "premium" | "super" (JS kapıları buna göre kurar; onEdition ile değişir) */
        @JavascriptInterface public String edition() { return pro.edition(); }
        /**
         * Paket paneli için:
         * {edition, source:"play"|"license"|"none", name, exp, plan, billingReady, licenseEnabled,
         *  prices:{"adfree":{"monthly":"…","yearly":"…"}, "premium":{…}, "super":{…}}}
         */
        @JavascriptInterface
        public String proInfo() {
            try {
                JSONObject e = pro.current(), o = new JSONObject();
                o.put("edition", pro.edition());
                o.put("source", e == null ? "none" : e.optString("source", "none"));
                o.put("name", e == null ? "" : e.optString("name", ""));
                o.put("exp", e == null ? 0 : e.optLong("exp", 0));
                o.put("plan", e == null ? "" : e.optString("plan", ""));
                o.put("billingReady", billing != null && billing.ready());
                o.put("licenseEnabled", License.enabled());
                JSONObject prices = new JSONObject();
                if (billing != null) for (java.util.Map.Entry<String, String> en : billing.allPrices().entrySet()) {
                    String[] parts = en.getKey().split("/", 2);
                    if (parts.length != 2) continue;
                    JSONObject t = prices.optJSONObject(parts[0]);
                    if (t == null) { t = new JSONObject(); prices.put(parts[0], t); }
                    t.put(parts[1], en.getValue());
                }
                o.put("prices", prices);
                return o.toString();
            } catch (Exception ex) { return "{}"; }
        }
        /**
         * Abonelik akışı; tier: "adfree"|"premium"|"super", plan: "monthly"|"yearly".
         * Sonuç onEdition(basamak, "purchased" | "cancelled" | "pending" | "error:<mesaj>").
         * Aynı basamak zaten etkinse akış açılmaz, yalnız yetki tazelenir.
         */
        @JavascriptInterface
        public void buyPro(String tier, String plan) {
            final String t = Tier.norm(tier), pl = plan == null ? "" : plan;
            runOnUiThread(() -> {
                if (Tier.FREE.equals(t)) return;
                if (t.equals(pro.edition())) { editionChanged("restored"); return; }
                if (billing != null) billing.buy(t, pl);
            });
        }
        /** Play sahipliğini yeniden sorar; sonuç onEdition(ed, "restored" | "none" | "error:<mesaj>") */
        @JavascriptInterface public void restorePro() { runOnUiThread(() -> { if (billing != null) billing.verify(true); }); }
        /** Çevrimdışı lisans kodu: doğrulanırsa yetki yazılır ve onEdition("pro","license") yollanır */
        @JavascriptInterface
        public boolean activateLicense(String code) {
            JSONObject p = License.verify(code);
            if (p == null) return false;
            pro.set("license", p.optString("p", ""), p.optString("n", ""), p.optLong("e", 0), "");
            runOnUiThread(() -> editionChanged("license"));
            return true;
        }
        /** Pro yetkisi yokken yüklü bir geçiş reklamı hazırsa true; Pro'da her zaman false */
        @JavascriptInterface public boolean adsAvailable() { return showsAds() && ads != null && ads.ready(); }
        /** Geçiş reklamı isteği (reason: "open" | "interval"); sonuç JS'e onAd(reason, shown) ile döner; Pro'da hemen false */
        @JavascriptInterface
        public void showAd(String reason) {
            final String r = reason == null ? "" : reason;
            runOnUiThread(() -> {
                if (paid() || ads == null) { js("window.dwgApp && window.dwgApp.onAd(" + JSONObject.quote(r) + ",false)"); return; }
                ads.show(r, shown -> js("window.dwgApp && window.dwgApp.onAd(" + JSONObject.quote(r) + "," + shown + ")"));
            });
        }
        /** Kalıcı izin reddinde uygulamanın sistem ayarları sayfası */
        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void copy(String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("koordinat", text));
            });
        }

        /** Pano metni (WebView'da navigator.clipboard.readText çalışmaz); ana iş parçacığında okunur */
        @JavascriptInterface
        public String paste() {
            java.util.concurrent.FutureTask<String> t = new java.util.concurrent.FutureTask<>(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip() == null || cm.getPrimaryClip().getItemCount() == 0) return "";
                CharSequence cs = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                return cs == null ? "" : cs.toString();
            });
            runOnUiThread(t);
            try { return t.get(2, java.util.concurrent.TimeUnit.SECONDS); } catch (Exception e) { return ""; }
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { } });
        }

        @JavascriptInterface
        public void shareText(String subject, String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, subject);
                i.putExtra(Intent.EXTRA_TEXT, text);
                try { startActivity(Intent.createChooser(i, subject)); } catch (Exception ignored) { }
            });
        }

        // anahtar/değer deposu (ayarlar, notlar, görünümler)
        @JavascriptInterface
        public void saveText(String key, String text) {
            try (FileOutputStream out = new FileOutputStream(new File(dir("kv"), safe(key) + ".txt"))) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            } catch (IOException e) { Log.w(TAG, "saveText", e); }
        }
        @JavascriptInterface public String loadText(String key) { return readFile(new File(dir("kv"), safe(key) + ".txt")); }

        // son dosyalar
        @JavascriptInterface
        public String getRecent() {
            try {
                JSONArray arr = new JSONArray(prefs().getString("recent", "[]")), out = new JSONArray();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    // önbellek kopyası silinmiş (Docs.sweep, 7 gün) file:// kayıtları listeden düşer
                    Uri u = Uri.parse(o.optString("uri"));
                    if (ContentResolver.SCHEME_FILE.equals(u.getScheme()) && (u.getPath() == null || !new File(u.getPath()).exists())) continue;
                    o.put("thumb", new File(dir("thumbs"), safe(o.optString("key")) + ".png").exists());
                    out.put(o);
                }
                if (out.length() != arr.length()) prefs().edit().putString("recent", out.toString()).apply();
                return out.toString();
            } catch (Exception e) { return "[]"; }
        }
        @JavascriptInterface
        public void openRecent(String uriStr) {
            runOnUiThread(() -> {
                try {
                    Uri u = Uri.parse(uriStr);
                    if (ContentResolver.SCHEME_FILE.equals(u.getScheme())) {
                        File f = new File(u.getPath());
                        if (!f.exists()) throw new IOException("dosya yok");
                        setCurrentFile(f);
                    } else {
                        // erişilebilir mi?
                        try (InputStream in = getContentResolver().openInputStream(u)) { if (in == null) throw new IOException(); }
                        // ağaç altındaki belge: izin ağaçla yaşar, kopya alınmaz
                        setCurrent(u, DocumentsContract.isTreeUri(u));
                    }
                    pushCurrentFile();
                } catch (Exception e) {
                    // ölü kayıt: listeden silinir, JS listeyi yeniler
                    removeRecent(uriStr);
                    jsWhenReady("window.dwgApp && window.dwgApp.refreshRecent && window.dwgApp.refreshRecent()");
                    Toast.makeText(MainActivity.this, R.string.recent_gone, Toast.LENGTH_SHORT).show();
                }
            });
        }
        @JavascriptInterface
        public void saveThumb(String key, String base64) {
            try (FileOutputStream out = new FileOutputStream(new File(dir("thumbs"), safe(key) + ".png"))) {
                out.write(Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) { Log.w(TAG, "thumb", e); }
        }

        /** Son dosyalar kaydını siler; JS listeyi kendisi yeniden çizer */
        @JavascriptInterface public void removeRecent(String uri) { MainActivity.this.removeRecent(uri); }

        // ---- klasör gezgini (SAF ağaç izni) ---------------------------------------------
        /** Kayıtlı kökler: [{uri,name,time,ok}] — ok=false: kalıcı izin kaybolmuş */
        @JavascriptInterface
        public String fsRoots() {
            try {
                java.util.Set<String> live = new java.util.HashSet<>();
                for (android.content.UriPermission p : getContentResolver().getPersistedUriPermissions()) if (p.isReadPermission()) live.add(p.getUri().toString());
                JSONArray a = fsRootsLoad();
                for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i); o.put("ok", live.contains(o.optString("uri"))); }
                return a.toString();
            } catch (Exception e) { return "[]"; }
        }
        /** Android API düzeyi: JS, İndirilenler açıklamasını (Android 11+ kökün kendisi seçilemez) yalnız ≥ 30'da gösterir */
        @JavascriptInterface
        public int sdkInt() { return Build.VERSION.SDK_INT; }
        /** Klasör seçiciyi açar; sonuç dwgApp.onFsRoot(obj|null). hint 'download': seçici İndirilenler'de açılır.
         *  Android 11+ (API 30) İndirilenler kökünün kendisini ve Android/data - Android/obb altını ACTION_OPEN_DOCUMENT_TREE ile
         *  vermez; kullanıcı İndirilenler içindeki bir alt klasörü seçer. */
        @JavascriptInterface
        public void fsAddRoot(String hint) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                if ("download".equals(hint)) // EXTRA_INITIAL_URI API 26+, minSdk 26
                    i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"));
                try { startActivityForResult(i, REQ_TREE); }
                catch (Exception e) {
                    Toast.makeText(MainActivity.this, R.string.open_failed, Toast.LENGTH_SHORT).show();
                    js("window.dwgApp && window.dwgApp.onFsRoot && window.dwgApp.onFsRoot(null)");
                }
            });
        }
        /** Kökü bırakır: kalıcı izin geri verilir (hata yutulur), prefs'ten silinir */
        @JavascriptInterface
        public void fsRemoveRoot(String uri) {
            try { getContentResolver().releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
            try { fsRootsSave(fsRootsWithout(uri)); } catch (Exception ignored) { }
        }
        /** Klasör içeriği (arka planda); docId "" → ağaç kökü. Sonuç dwgApp.onFs(reqId, ok, {items:[…]} | "hata") */
        @JavascriptInterface
        public void fsList(String reqId, String rootUri, String docId) {
            fsExec.execute(() -> {
                String out; boolean ok = true;
                try {
                    Uri root = Uri.parse(rootUri);
                    String id = docId == null || docId.isEmpty() ? DocumentsContract.getTreeDocumentId(root) : docId;
                    JSONObject o = new JSONObject(); o.put("items", fsChildren(root, id)); out = o.toString();
                } catch (Throwable e) { // OOM dâhil: uygulama kapanmaz, JS hata alır
                    Log.w(TAG, "fsList", e); ok = false; out = JSONObject.quote(fsMessage(e));
                }
                js("window.dwgApp && window.dwgApp.onFs(" + JSONObject.quote(reqId) + "," + ok + "," + out + ")");
            });
        }
        /** Özyinelemeli ad araması (BFS, derinlik ≤ 8, en çok 500 sonuç, 8 s). Sonuç {items:[…parent:"Klasör/Alt"], truncated} */
        @JavascriptInterface
        public void fsSearch(String reqId, String rootUri, String query) {
            fsSearchLatest = reqId;
            fsExec.execute(() -> {
                if (!reqId.equals(fsSearchLatest)) { fsCancelled(reqId); return; } // kuyrukta beklerken yenisi geldi: hiç başlama
                String out; boolean ok = true;
                try {
                    Uri root = Uri.parse(rootUri);
                    String q = query == null ? "" : query.trim().toLowerCase(TR);
                    JSONArray items = new JSONArray();
                    boolean truncated = false;
                    long deadline = System.currentTimeMillis() + 8000;
                    java.util.ArrayDeque<Object[]> queue = new java.util.ArrayDeque<>(); // {docId, yol, derinlik}
                    queue.add(new Object[]{DocumentsContract.getTreeDocumentId(root), "", 0});
                    while (!queue.isEmpty() && !truncated) {
                        if (!reqId.equals(fsSearchLatest)) { fsCancelled(reqId); return; } // eskimiş arama: yarıda kesilir
                        if (System.currentTimeMillis() > deadline) { truncated = true; break; }
                        Object[] cur = queue.poll();
                        String path = (String) cur[1]; int depth = (Integer) cur[2];
                        JSONArray kids;
                        try { kids = fsChildren(root, (String) cur[0]); } catch (Exception e) { continue; } // erişilemeyen alt klasör atlanır
                        for (int i = 0; i < kids.length(); i++) {
                            JSONObject k = kids.getJSONObject(i);
                            String name = k.getString("name");
                            if (k.getBoolean("dir")) {
                                if (depth < 8) queue.add(new Object[]{k.getString("id"), path.isEmpty() ? name : path + "/" + name, depth + 1});
                                else truncated = true; // derinlik sınırı: sonuç eksik kalır
                                continue;
                            }
                            if (!q.isEmpty() && !name.toLowerCase(TR).contains(q)) continue;
                            k.put("parent", path);
                            items.put(k);
                            if (items.length() >= 500) { truncated = true; break; }
                        }
                    }
                    JSONObject o = new JSONObject(); o.put("items", items); o.put("truncated", truncated); out = o.toString();
                } catch (Throwable e) {
                    Log.w(TAG, "fsSearch", e); ok = false; out = JSONObject.quote(fsMessage(e));
                }
                js("window.dwgApp && window.dwgApp.onFs(" + JSONObject.quote(reqId) + "," + ok + "," + out + ")");
            });
        }
        /** Ağaç altındaki belgeyi geçerli dosya yapar (kopyalanmaz; izin ağaçla yaşar) ve JS'e yükletir */
        @JavascriptInterface
        public void fsOpen(String rootUri, String docId, String name, long size) {
            runOnUiThread(() -> {
                try {
                    Uri u = DocumentsContract.buildDocumentUriUsingTree(Uri.parse(rootUri), docId);
                    setCurrent(u, true, name, size);
                    pushCurrentFile();
                } catch (Exception e) {
                    Log.w(TAG, "fsOpen", e);
                    Toast.makeText(MainActivity.this, R.string.open_failed, Toast.LENGTH_SHORT).show();
                }
            });
        }
        /** Ağaç altındaki belgeyi yuvaya koyar (karşılaştırma / xref / resim / yükleme); JS onFilePicked'i kendisi sürer */
        @JavascriptInterface
        public String fsSlot(String rootUri, String docId) {
            Uri u = DocumentsContract.buildDocumentUriUsingTree(Uri.parse(rootUri), docId);
            synchronized (slots) { String id = "slot_" + (++slotSeq); slots.put(id, u); return id; }
        }

        // indirme deposu
        @JavascriptInterface
        public String saveBytes(String name, String base64) {
            try {
                String fn = System.currentTimeMillis() + "_" + safe(name);
                try (FileOutputStream out = new FileOutputStream(new File(dir("downloads"), fn))) { out.write(Base64.decode(base64, Base64.DEFAULT)); }
                return "dl_" + fn;
            } catch (Exception e) { Log.w(TAG, "saveBytes", e); return ""; }
        }
        @JavascriptInterface
        public String listDownloads() {
            JSONArray arr = new JSONArray();
            File[] files = dir("downloads").listFiles();
            if (files != null) for (File f : files) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("id", "dl_" + f.getName()); o.put("name", f.getName().replaceFirst("^\\d+_", "")); o.put("size", f.length()); o.put("time", f.lastModified());
                    arr.put(o);
                } catch (Exception ignored) { }
            }
            return arr.toString();
        }
        @JavascriptInterface public void deleteDownload(String id) { if (id.startsWith("dl_")) new File(dir("downloads"), safe(id.substring(3))).delete(); }
        @JavascriptInterface
        public void openDownload(String id) {
            if (!id.startsWith("dl_")) return;
            File f = new File(dir("downloads"), safe(id.substring(3)));
            if (!f.exists()) return;
            runOnUiThread(() -> { setCurrentFile(f); pushCurrentFile(); });
        }

        // konum / kamera
        @JavascriptInterface public void startLocation() { runOnUiThread(MainActivity.this::startLocation); }
        @JavascriptInterface public void stopLocation() { runOnUiThread(MainActivity.this::stopLocation); }
        @JavascriptInterface
        public void requestCamera() {
            runOnUiThread(() -> {
                if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            });
        }

        // kaydetme
        @JavascriptInterface
        public String savePng(String base64, String fileName) {
            try {
                String where = saveShared(Base64.decode(base64, Base64.DEFAULT), fileName, "image/png", "DWGViewer", false);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, getString(R.string.saved_to, where), Toast.LENGTH_LONG).show());
                return where;
            } catch (Exception e) {
                Log.w(TAG, "png", e);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, R.string.save_failed, Toast.LENGTH_SHORT).show());
                return "";
            }
        }
        @JavascriptInterface
        public String saveFile(String base64, String fileName, String mime, boolean share) {
            try {
                return saveShared(Base64.decode(base64, Base64.DEFAULT), fileName, mime, "DWGViewer", share);
            } catch (Exception e) {
                Log.w(TAG, "saveFile", e);
                return "";
            }
        }

        // ---- belgeler: PDF / Word / ZIP / RAR ---------------------------------------------
        /** Geçerli dosyayı (ya da slot/dl kimliğini) belge olarak kaydeder → {id,name,size,ext} */
        @JavascriptInterface
        public String docOpen(String what) {
            try {
                if ("current".equals(what)) {
                    if (currentFile != null) return docs.info(docs.register(currentFile, currentName)).toString();
                    if (currentUri != null) try (InputStream in = getContentResolver().openInputStream(currentUri)) { return docs.importStream(in, currentName).toString(); }
                    return "{\"error\":\"dosya yok\"}";
                }
                if (what.startsWith("slot_")) { Uri u = slots.get(what); if (u == null) return "{\"error\":\"yuva yok\"}"; try (InputStream in = getContentResolver().openInputStream(u)) { return docs.importStream(in, queryName(u)).toString(); } }
                if (what.startsWith("dl_")) { File f = new File(dir("downloads"), safe(what.substring(3))); return docs.info(docs.register(f, f.getName().replaceFirst("^\\d+_", ""))).toString(); }
                if (what.startsWith("f_")) return docs.info(what).toString();
                return "{\"error\":\"bilinmeyen\"}";
            } catch (Exception e) { Log.w(TAG, "docOpen", e); return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}"; }
        }
        /** Kayıtlı belgeyi (ör. arşivden çıkan DWG) geçerli dosya yapar ve JS'e bildirir */
        @JavascriptInterface
        public void docOpenAsCurrent(String id) {
            File f = docs.file(id); if (f == null) return;
            final String name = docs.name(id);
            runOnUiThread(() -> { currentFile = f; currentUri = null; currentName = name; currentSize = f.length(); pushCurrentFile(); });
        }
        @JavascriptInterface public String pdfInfo(String id) { return docs.pdfInfo(id); }
        @JavascriptInterface public void pdfClose() { docs.closePdf(); }
        @JavascriptInterface public String arcList(String id) { return docs.arcList(id); }
        @JavascriptInterface public String arcExtract(String id, String entry) { return docs.arcExtract(id, entry); }
        /** Belgeyi sistem görüntüleyicisine gönderir (başka uygulamayla aç) */
        @JavascriptInterface
        public void docShare(String id, boolean view) {
            File f = docs.file(id); if (f == null) return;
            runOnUiThread(() -> {
                try {
                    Uri u = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                    String mime = mimeOf(docs.name(id));
                    Intent i = new Intent(view ? Intent.ACTION_VIEW : Intent.ACTION_SEND);
                    if (view) i.setDataAndType(u, mime); else { i.setType(mime); i.putExtra(Intent.EXTRA_STREAM, u); }
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(i, docs.name(id)));
                } catch (Exception e) { Toast.makeText(MainActivity.this, R.string.open_failed, Toast.LENGTH_SHORT).show(); }
            });
        }
        /** Belgeyi indirme deposuna (çevrimdışı) kopyalar */
        @JavascriptInterface
        public String docKeep(String id) {
            File f = docs.file(id); if (f == null) return "";
            try {
                String fn = System.currentTimeMillis() + "_" + safe(docs.name(id));
                try (InputStream in = new FileInputStream(f); OutputStream out = new FileOutputStream(new File(dir("downloads"), fn))) { MainActivity.copy(in, out); }
                return "dl_" + fn;
            } catch (Exception e) { return ""; }
        }

        // ---- Google ile giriş / Drive -----------------------------------------------------
        /**
         * Uygulamanın gerçekten imzalandığı sertifikanın SHA-1 parmak izi ("AB:CD:…" biçiminde).
         * Google Cloud Console'da Android OAuth istemcisi bu değerle oluşturulur; Play uygulama imzalaması
         * devreye girerse APK yeniden imzalanır ve bu değer değişir — giriş çalışmıyorsa ilk bakılacak yer burasıdır.
         */
        @JavascriptInterface public String signingSha1() {
            try {
                java.security.cert.Certificate[] certs;
                android.content.pm.PackageManager pm = getPackageManager();
                if (Build.VERSION.SDK_INT >= 28) {
                    android.content.pm.SigningInfo si = pm.getPackageInfo(getPackageName(), android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES).signingInfo;
                    android.content.pm.Signature[] sg = si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
                    return sha1Of(sg[0].toByteArray());
                }
                @SuppressWarnings("deprecation")
                android.content.pm.Signature[] sg = pm.getPackageInfo(getPackageName(), android.content.pm.PackageManager.GET_SIGNATURES).signatures;
                return sha1Of(sg[0].toByteArray());
            } catch (Throwable e) { Log.w(TAG, "signingSha1", e); return ""; }
        }
        private String sha1Of(byte[] der) throws Exception {
            byte[] d = java.security.MessageDigest.getInstance("SHA-1").digest(der);
            StringBuilder sb = new StringBuilder(d.length * 3);
            for (byte b : d) { if (sb.length() > 0) sb.append(':'); sb.append(String.format(Locale.US, "%02X", b)); }
            return sb.toString();
        }
        @JavascriptInterface public boolean gConfigured() { return GoogleDrive.configured(); }
        @JavascriptInterface public String gRedirect() { return GoogleDrive.redirectUri(); }
        @JavascriptInterface public String gSignIn() { runOnUiThread(() -> { String r = google.signIn(); if (!r.isEmpty()) Toast.makeText(MainActivity.this, r, Toast.LENGTH_LONG).show(); }); return ""; }
        @JavascriptInterface public void gSignOut() {
            google.signOut();
            // Oturum kapanınca sahip hesabı yetkisi de gider (satın alınmış yetki varsa o kalır).
            runOnUiThread(() -> { if (syncOwnerGrant()) editionChanged("revoked"); });
        }
        @JavascriptInterface public String gAccount() { return google.signedIn() ? google.user() : ""; }
        /** Asenkron Drive işlemi; sonuç dwgApp.onDrive(reqId, ok, json) ile döner */
        @JavascriptInterface
        public void gDrive(String reqId, String op, String argsJson) {
            bg.execute(() -> {
                String out; boolean ok = true;
                try {
                    JSONObject a = argsJson == null || argsJson.isEmpty() ? new JSONObject() : new JSONObject(argsJson);
                    switch (op) {
                        case "list": out = google.list(a.optString("folder", "root"), a.optString("q", ""), a.optString("pageToken", "")); break;
                        case "meta": out = google.meta(a.getString("id")); break;
                        case "about": out = google.about(); break;
                        case "mkdir": out = google.createFolder(a.getString("name"), a.optString("parent", "root")); break;
                        case "delete": google.delete(a.getString("id")); out = "{}"; break;
                        // Paylaşım: izin oluşturma, izin listesi ve izni kaldırma (kapsam değişmedi, drive kapsamı yeter)
                        case "share": out = google.share(a.getString("id"), a.optString("type", "anyone"), a.optString("role", "reader"), a.optString("email", ""), a.optBoolean("notify", false)); break;
                        case "permissions": out = google.permissions(a.getString("id")); break;
                        case "unshare": google.unshare(a.getString("id"), a.getString("permissionId")); out = "{}"; break;
                        case "download": {
                            File f = google.download(a.getString("id"), a.optString("name", "dosya"), a.optString("mime", ""), docs.cacheDir("drive"),
                                    (done, total) -> js("window.dwgApp && window.dwgApp.onDriveProgress(" + JSONObject.quote(reqId) + "," + done + "," + total + ")"));
                            String name = f.getName().replaceFirst("^[^_]*_", "");
                            JSONObject info = docs.info(docs.register(f, name));
                            if (a.optBoolean("open", false)) { final File ff = f; final String nm = name; runOnUiThread(() -> { currentFile = ff; currentUri = null; currentName = nm; currentSize = ff.length(); }); }
                            out = info.toString(); break;
                        }
                        case "upload": {
                            // dosya Java yığınına alınmaz: akış + uzunluk doğrudan Drive'a yazılır
                            String name = a.getString("name"), mime = a.optString("mime", "application/octet-stream"), folder = a.optString("folder", "");
                            String convertTo = a.has("convertTo") ? a.getString("convertTo") : null;
                            File src = null;
                            if (a.has("fileId")) { src = docs.file(a.getString("fileId")); if (src == null) throw new IOException("dosya yok"); }
                            else if ("current".equals(a.optString("src"))) {
                                src = currentFile;
                                if (src == null && currentUri != null && currentSize < 0) {
                                    // boyutu bilinmeyen içerik: önce önbelleğe alınır, uzunluk oradan okunur
                                    try (InputStream in = getContentResolver().openInputStream(currentUri)) { src = docs.file(docs.importStream(in, currentName).getString("id")); }
                                }
                                if (src == null && currentUri == null) throw new IOException("dosya yok");
                            }
                            if (src != null) { try (InputStream in = new FileInputStream(src)) { out = google.upload(in, src.length(), name, mime, folder, convertTo); } }
                            else if ("current".equals(a.optString("src"))) { try (InputStream in = getContentResolver().openInputStream(currentUri)) { if (in == null) throw new IOException("dosya açılamadı"); out = google.upload(in, currentSize, name, mime, folder, convertTo); } }
                            else { byte[] bytes = Base64.decode(a.getString("b64"), Base64.DEFAULT); out = google.upload(new ByteArrayInputStream(bytes), bytes.length, name, mime, folder, convertTo); }
                            break;
                        }
                        case "convertPdf": {
                            File src = docs.file(a.getString("fileId")); if (src == null) throw new IOException("dosya yok");
                            String name = docs.name(a.getString("fileId"));
                            File f = google.convertToPdf(src, name, mimeOf(name), docs.cacheDir("drive"), (done, total) -> js("window.dwgApp && window.dwgApp.onDriveProgress(" + JSONObject.quote(reqId) + "," + done + "," + total + ")"));
                            out = docs.info(docs.register(f, name.replaceFirst("\\.[^.]+$", "") + ".pdf")).toString(); break;
                        }
                        default: throw new IOException("bilinmeyen işlem: " + op);
                    }
                } catch (Throwable e) { // OutOfMemoryError da JS'e hata olarak döner, uygulama kapanmaz
                    Log.w(TAG, "drive " + op, e);
                    ok = false; out = JSONObject.quote(GoogleDrive.message(e));
                }
                js("window.dwgApp && window.dwgApp.onDrive(" + JSONObject.quote(reqId) + "," + ok + "," + out + ")");
            });
        }

        // ---- WebDAV (Nextcloud / ownCloud / mod_dav) --------------------------------------
        /** Kayıtlı hesaplar: [{id,name,url,user}] — parola dönmez */
        @JavascriptInterface public String wdAccounts() { return webdav.accounts(); }
        /** {id?,name,url,user,pass} kaydeder (id yoksa üretir; var olan hesapta boş pass eski parolayı korur); hesap id'sini döner, hatada "" */
        @JavascriptInterface public String wdSave(String json) {
            try { return webdav.save(json); }
            catch (Exception e) { Log.w(TAG, "wdSave", e); final String m = WebDav.message(e); runOnUiThread(() -> Toast.makeText(MainActivity.this, m, Toast.LENGTH_LONG).show()); return ""; }
        }
        @JavascriptInterface public void wdRemove(String id) { webdav.remove(id); }
        /**
         * Asenkron WebDAV işlemi; sonuç dwgApp.onWebDav(reqId, ok, json). op: "list" {id,path} → {items:[{name,path,dir,size,time,mime}],path};
         * "download" {id,path,name} → docs.info {id,name,size,ext} (ilerleme: dwgApp.onWebDavProgress(reqId, done, total));
         * "test" {url,user,pass} → {ok:true,url}. Hatada ok=false, json = ileti (JSON dizesi).
         */
        /*
         * Yüklenecek dosyanın kaynağı üç biçimde gelebilir:
         *   {docId}  → çevrimdışı belge deposundaki dosya (Docs)
         *   {b64}    → JS'in ürettiği içerik (PDF, PNG, DXF, CSV) — geçici dosyaya yazılır
         *   başka    → o an açık olan dosya (currentFile ya da currentUri'nin önbellek kopyası)
         * JS'in 30 MB'lık bir DWG'yi base64'e çevirmesi gerekmez; açık dosya doğrudan kullanılır.
         */
        private File uploadSource(JSONObject a) throws IOException {
            String fileId = a.optString("fileId", "");
            if (!fileId.isEmpty()) { File f = docs.file(fileId); if (f != null && f.exists()) return f; }
            String b64 = a.optString("b64", "");
            if (!b64.isEmpty()) {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                File tmp = new File(docs.cacheDir("webdav"), "yukleme_" + System.currentTimeMillis());
                try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(bytes); }
                return tmp;
            }
            if (currentFile != null && currentFile.exists()) return currentFile;
            // Sağlayıcıdan gelen içerik: uzunluk PUT için gerektiğinden önce önbelleğe alınır
            if (currentUri != null) {
                try (InputStream in = getContentResolver().openInputStream(currentUri)) {
                    if (in == null) return null;
                    return docs.file(docs.importStream(in, currentName).getString("id"));
                } catch (Exception e) { throw new IOException("dosya açılamadı"); }
            }
            return null;
        }
        @JavascriptInterface
        public void wd(String reqId, String op, String argsJson) {
            bg.execute(() -> {
                String out; boolean ok = true;
                try {
                    JSONObject a = argsJson == null || argsJson.isEmpty() ? new JSONObject() : new JSONObject(argsJson);
                    switch (op) {
                        case "list": out = webdav.list(a.optString("id"), a.optString("path", "/")); break;
                        case "download":
                            out = webdav.download(a.optString("id"), a.getString("path"), a.optString("name", ""), docs,
                                    (done, total) -> js("window.dwgApp && window.dwgApp.onWebDavProgress && window.dwgApp.onWebDavProgress(" + JSONObject.quote(reqId) + "," + done + "," + total + ")")).toString();
                            break;
                        case "test": out = webdav.test(a.optString("url"), a.optString("user"), a.optString("pass")); break;
                        // Yazma: yükleme, klasör, silme, taşıma ve varlık denetimi
                        case "upload": {
                            java.io.File src = uploadSource(a);
                            if (src == null) throw new IOException("yüklenecek dosya bulunamadı");
                            out = webdav.upload(a.optString("id"), a.optString("path", "/"), a.optString("name", src.getName()), src,
                                    a.optBoolean("overwrite", false),
                                    (done, total) -> js("window.dwgApp && window.dwgApp.onWebDavProgress && window.dwgApp.onWebDavProgress(" + JSONObject.quote(reqId) + "," + done + "," + total + ")"));
                            break;
                        }
                        case "mkdir": out = webdav.mkdir(a.optString("id"), a.optString("path", "/"), a.getString("name")); break;
                        case "delete": out = webdav.delete(a.optString("id"), a.getString("path")); break;
                        case "move": out = webdav.move(a.optString("id"), a.getString("from"), a.getString("to"), a.optBoolean("overwrite", false)); break;
                        case "stat": out = webdav.stat(a.optString("id"), a.getString("path")); break;
                        default: throw new IOException("bilinmeyen işlem: " + op);
                    }
                } catch (Throwable e) {
                    Log.w(TAG, "webdav " + op, e);
                    ok = false; out = JSONObject.quote(WebDav.message(e));
                }
                js("window.dwgApp && window.dwgApp.onWebDav && window.dwgApp.onWebDav(" + JSONObject.quote(reqId) + "," + ok + "," + out + ")");
            });
        }

        // hata kaydı
        @JavascriptInterface public void logError(String text) { appendLog(text); }
        @JavascriptInterface public String getErrorLog() { return readFile(new File(dir("log"), "errors.log")); }
        @JavascriptInterface public void clearErrorLog() { new File(dir("log"), "errors.log").delete(); }
    }

    @Override
    protected void onDestroy() {
        stopLocation();
        mainHandler.removeCallbacks(licenseExpiry);
        if (ads != null) ads.destroy();
        if (billing != null) billing.destroy();
        if (docs != null) docs.closePdf();
        bg.shutdown();
        fsExec.shutdownNow();
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((android.window.OnBackInvokedCallback) backCallback);
            backCallback = null;
        }
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
