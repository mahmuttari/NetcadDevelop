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
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
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
import java.util.HashMap;
import java.util.Map;

/**
 * DWG Görüntüleyici – Android kabuğu.
 *
 * Çizim işi WebView içindeki HTML/JS'te yapılır. Bu sınıf:
 *  1. assets/viewer sayfasını sahte bir https kökünden sunar,
 *  2. seçilen / paylaşılan / indirilen dosyaları aynı kökte /file/<id> adresinde akıtır,
 *  3. dosya seçici, son dosyalar, pano, konum, kamera izni, PNG/PDF kaydetme ve
 *     paylaşma, indirme deposu, küçük resimler, ayar/not deposu ve hata kaydı için köprü sağlar.
 */
public class MainActivity extends Activity {

    private static final String TAG = "DwgViewer";
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/viewer/index.html";
    private static final int REQ_PICK = 1001;
    private static final int REQ_LOCATION = 2001;
    private static final int REQ_CAMERA = 2002;
    private static final int RECENT_MAX = 12;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html"); MIME.put("js", "text/javascript"); MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css"); MIME.put("json", "application/json"); MIME.put("wasm", "application/wasm");
        MIME.put("png", "image/png"); MIME.put("jpg", "image/jpeg"); MIME.put("jpeg", "image/jpeg"); MIME.put("svg", "image/svg+xml");
        MIME.put("woff2", "font/woff2"); MIME.put("md", "text/plain"); MIME.put("pdf", "application/pdf");
    }

    private WebView webView;
    private boolean pageReady;

    // geçerli dosya
    private Uri currentUri;
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

    // ---------------------------------------------------------------------------------------
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
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setTextZoom(100);
        s.setGeolocationEnabled(false);

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
                pageReady = true;
                pushCurrentFile();
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

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) uri = intent.getData();
        else if (Intent.ACTION_SEND.equals(action)) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri != null) setCurrent(uri);
    }

    private void setCurrent(Uri uri) {
        currentUri = uri;
        currentFile = null;
        currentName = queryName(uri);
        currentSize = querySize(uri);
        try {
            getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) { }
        addRecent(uri.toString(), currentName, currentSize);
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
        final String js = "window.dwgApp && window.dwgApp.loadCurrent(" + JSONObject.quote(currentName) + "," + currentSize + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void js(String code) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(code, null));
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
    private void openPicker(String purpose, String mime) {
        pickPurpose = purpose == null ? "open" : purpose;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime == null || mime.isEmpty() ? "*/*" : mime);
        if (mime == null || mime.equals("*/*")) {
            i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/acad", "application/x-acad", "application/autocad_dwg", "application/dwg", "application/x-dwg",
                    "application/x-autocad", "image/vnd.dwg", "image/x-dwg", "drawing/dwg", "application/dxf", "image/vnd.dxf",
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
        if (requestCode != REQ_PICK || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if ("open".equals(pickPurpose)) {
            setCurrent(uri);
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

    private void addRecent(String uri, String name, long size) {
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

    /** app.js ile aynı kural: ad_boyut, izin verilmeyen karakterler '_' */
    private static String fileKey(String name, long size) {
        return (name + "_" + size).replaceAll("[^\\w.-]+", "_");
    }

    // ---- konum -----------------------------------------------------------------------------
    private void startLocation() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
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
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0.5f, locationListener);
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000, 1f, locationListener);
            Location last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
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
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_LOCATION) {
            if (granted) startLocation(); else js("window.dwgApp && window.dwgApp.onLocationError('konum izni verilmedi')");
        } else if (requestCode == REQ_CAMERA && pendingCameraRequest != null) {
            if (granted) pendingCameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingCameraRequest.deny();
            pendingCameraRequest = null;
        }
    }

    // ---- geri tuşu ---------------------------------------------------------------------------
    @Override
    public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript("window.dwgApp ? String(window.dwgApp.onBack()) : 'false'", value -> {
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

    private void appendLog(String line) {
        try {
            File f = new File(dir("log"), "errors.log");
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
        @JavascriptInterface public void pickFile(String purpose, String mime) { runOnUiThread(() -> openPicker(purpose, mime)); }

        @JavascriptInterface
        public String getPendingFile() {
            if (currentUri == null && currentFile == null) return "";
            try {
                JSONObject o = new JSONObject();
                o.put("name", currentName); o.put("size", currentSize);
                return o.toString();
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface public void toast(String msg) { runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show()); }
        @JavascriptInterface public void finish() { runOnUiThread(MainActivity.this::finish); }
        @JavascriptInterface public String appVersion() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public int versionCode() { return BuildConfig.VERSION_CODE; }

        @JavascriptInterface
        public void copy(String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("koordinat", text));
            });
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
                JSONArray arr = new JSONArray(prefs().getString("recent", "[]"));
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    o.put("thumb", new File(dir("thumbs"), safe(o.optString("key")) + ".png").exists());
                }
                return arr.toString();
            } catch (Exception e) { return "[]"; }
        }
        @JavascriptInterface
        public void openRecent(String uriStr) {
            runOnUiThread(() -> {
                try {
                    Uri u = Uri.parse(uriStr);
                    if (ContentResolver.SCHEME_FILE.equals(u.getScheme())) { setCurrentFile(new File(u.getPath())); }
                    else {
                        // erişilebilir mi?
                        try (InputStream in = getContentResolver().openInputStream(u)) { if (in == null) throw new IOException(); }
                        setCurrent(u);
                    }
                    pushCurrentFile();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, R.string.open_failed, Toast.LENGTH_SHORT).show();
                }
            });
        }
        @JavascriptInterface
        public void saveThumb(String key, String base64) {
            try (FileOutputStream out = new FileOutputStream(new File(dir("thumbs"), safe(key) + ".png"))) {
                out.write(Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) { Log.w(TAG, "thumb", e); }
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

        // hata kaydı
        @JavascriptInterface public void logError(String text) { appendLog(text); }
        @JavascriptInterface public String getErrorLog() { return readFile(new File(dir("log"), "errors.log")); }
        @JavascriptInterface public void clearErrorLog() { new File(dir("log"), "errors.log").delete(); }
    }

    @Override
    protected void onDestroy() {
        stopLocation();
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
