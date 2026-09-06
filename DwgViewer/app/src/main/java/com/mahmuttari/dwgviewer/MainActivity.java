package com.mahmuttari.dwgviewer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * DWG Görüntüleyici.
 *
 * Bütün çizim işi WebView içindeki HTML/JS'de yapılır; DWG dosyası LibreDWG'nin
 * WebAssembly derlemesiyle çözülür. Bu sınıf yalnız üç şey yapar:
 *  1. assets/viewer altındaki sayfayı sahte bir https kökünden sunar
 *     (ES modülleri ve WebAssembly için gerçek bir kaynak (origin) gerekir),
 *  2. kullanıcının seçtiği ya da başka uygulamadan gelen DWG'yi aynı kökte
 *     /file/current adresinde sayfaya akıtır,
 *  3. dosya seçici, PNG kaydetme, bildirim ve geri tuşu için köprü sağlar.
 */
public class MainActivity extends Activity {

    private static final String TAG = "DwgViewer";
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/viewer/index.html";
    private static final int REQ_OPEN = 1001;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("wasm", "application/wasm");
        MIME.put("png", "image/png");
        MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2");
        MIME.put("md", "text/plain");
    }

    private WebView webView;
    private Uri currentUri;
    private String currentName;
    private long currentSize;
    private boolean pageReady;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
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
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setTextZoom(100);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Sayfa dışına çıkılmaz.
                return !request.getUrl().toString().startsWith(ORIGIN);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                pushCurrentFile();
            }
        });

        handleIntent(getIntent());
        webView.loadUrl(START_URL);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
        pushCurrentFile();
    }

    /** VIEW / SEND ile gelen dosyayı alır. */
    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri != null) setCurrent(uri);
    }

    private void setCurrent(Uri uri) {
        currentUri = uri;
        currentName = queryName(uri);
        currentSize = querySize(uri);
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Her sağlayıcı kalıcı izin vermez; gerekmez de.
        }
    }

    /** Sayfaya "yeni dosya var" der; sayfa dosyayı /file/current adresinden çeker. */
    private void pushCurrentFile() {
        if (!pageReady || currentUri == null) return;
        final String js = "window.dwgApp && window.dwgApp.loadCurrent(" + JSONObject.quote(currentName)
                + "," + currentSize + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private String queryName(Uri uri) {
        String name = null;
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (i >= 0) name = c.getString(i);
                }
            } catch (Exception e) {
                Log.w(TAG, "ad okunamadı", e);
            }
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
            } catch (Exception ignored) {
            }
        } else if (ContentResolver.SCHEME_FILE.equals(uri.getScheme()) && uri.getPath() != null) {
            return new File(uri.getPath()).length();
        }
        return -1;
    }

    /** Sahte https kökündeki istekleri karşılar. */
    private WebResourceResponse serve(Uri url) {
        if (url == null || !url.toString().startsWith(ORIGIN)) return null;
        String path = url.getPath() == null ? "" : url.getPath();

        if (path.startsWith("/assets/")) {
            String asset = path.substring("/assets/".length());
            try {
                InputStream in = getAssets().open(asset, AssetManager.ACCESS_STREAMING);
                WebResourceResponse r = new WebResourceResponse(mimeOf(asset), null, in);
                r.setResponseHeaders(noCache());
                return r;
            } catch (IOException e) {
                return notFound();
            }
        }

        if (path.equals("/file/current")) {
            if (currentUri == null) return notFound();
            try {
                InputStream in = getContentResolver().openInputStream(currentUri);
                if (in == null) return notFound();
                WebResourceResponse r = new WebResourceResponse("application/octet-stream", null, in);
                Map<String, String> h = noCache();
                if (currentSize > 0) h.put("Content-Length", Long.toString(currentSize));
                r.setResponseHeaders(h);
                return r;
            } catch (Exception e) {
                Log.w(TAG, "dosya açılamadı", e);
                return notFound();
            }
        }
        return notFound();
    }

    private static Map<String, String> noCache() {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        h.put("Access-Control-Allow-Origin", "*");
        return h;
    }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8",
                new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    private static String mimeOf(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase();
        String m = MIME.get(ext);
        return m == null ? "application/octet-stream" : m;
    }

    // ---- Dosya seçici -----------------------------------------------------

    private void openPicker() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        // DWG'nin MIME tipi sağlayıcıdan sağlayıcıya değişir; hepsini göster.
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/acad", "application/x-acad", "application/autocad_dwg",
                "application/dwg", "application/x-dwg", "application/x-autocad",
                "image/vnd.dwg", "image/x-dwg", "drawing/dwg", "application/octet-stream", "*/*"});
        try {
            startActivityForResult(i, REQ_OPEN);
        } catch (Exception e) {
            Toast.makeText(this, R.string.open_failed, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN && resultCode == RESULT_OK && data != null && data.getData() != null) {
            setCurrent(data.getData());
            pushCurrentFile();
        }
    }

    // ---- Geri tuşu: önce sayfadaki paneller kapanır ----------------------

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("window.dwgApp ? String(window.dwgApp.onBack()) : 'false'", value -> {
            if (!"\"true\"".equals(value) && !"true".equals(value)) {
                finish();
            }
        });
    }

    // ---- PNG kaydetme -----------------------------------------------------

    private String savePng(String base64, String fileName) throws IOException {
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/DWGViewer");
            Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("MediaStore kaydı açılamadı");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("çıkış akışı yok");
                out.write(bytes);
            }
            return "Resimler/DWGViewer/" + fileName;
        } else {
            File dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "DWGViewer");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("klasör açılamadı");
            File f = new File(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(bytes);
            }
            return f.getAbsolutePath();
        }
    }

    // ---- JS köprüsü -------------------------------------------------------

    private class Bridge {
        @JavascriptInterface
        public void openFilePicker() {
            runOnUiThread(MainActivity.this::openPicker);
        }

        /** Sayfa yüklendiğinde bekleyen bir dosya var mı? */
        @JavascriptInterface
        public String getPendingFile() {
            if (currentUri == null) return "";
            try {
                JSONObject o = new JSONObject();
                o.put("name", currentName);
                o.put("size", currentSize);
                return o.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void finish() {
            runOnUiThread(MainActivity.this::finish);
        }

        @JavascriptInterface
        public String savePng(String base64, String fileName) {
            try {
                String where = savePng(base64, fileName);
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        getString(R.string.saved_to, where), Toast.LENGTH_LONG).show());
                return where;
            } catch (Exception e) {
                Log.w(TAG, "png kaydedilemedi", e);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, R.string.save_failed, Toast.LENGTH_SHORT).show());
                return "";
            }
        }

        @JavascriptInterface
        public String appVersion() {
            return BuildConfig.VERSION_NAME;
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && webView != null) {
            webView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }
}
