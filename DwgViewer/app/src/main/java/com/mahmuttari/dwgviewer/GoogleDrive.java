package com.mahmuttari.dwgviewer;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

/**
 * Google ile giriş (OAuth 2.0 + PKCE, tarayıcı üzerinden) ve Google Drive REST v3.
 *
 * Play Services gerektirmez. Akış:
 *  1. signIn(): code_verifier üretilir, tarayıcıda accounts.google.com açılır.
 *  2. Google, manifest'teki "com.googleusercontent.apps.<istemci-no>:/oauth2redirect" adresine döner;
 *     MainActivity.onNewIntent → handleRedirect() kodu belirteçle takas eder, hesabı okur.
 *  3. Belirteçler uygulama içi SharedPreferences'ta tutulur; süresi dolunca yenilenir.
 *
 * İstemci kimliği gradle.properties → GOOGLE_CLIENT_ID (Android türü OAuth istemcisi; paket adı +
 * imza SHA-1 ile Google Cloud Console'da oluşturulur). Boşsa giriş düğmesi açıklama gösterir.
 */
public class GoogleDrive {
    private static final String TAG = "DwgViewer.Google";
    private static final String AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
    private static final String TOKEN = "https://oauth2.googleapis.com/token";
    private static final String REVOKE = "https://oauth2.googleapis.com/revoke";
    private static final String USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
    private static final String API = "https://www.googleapis.com/drive/v3/";
    private static final String UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
    private static final String SCOPES = "openid email profile https://www.googleapis.com/auth/drive";

    private final Activity act;
    private final SharedPreferences prefs;
    // PKCE doğrulayıcı ve state prefs'te tutulur: kullanıcı tarayıcıdayken süreç öldürülse de yönlendirme işlenir
    private static final long PKCE_TTL = 10 * 60_000L;

    public interface Cb { void done(boolean ok, String json); }

    public GoogleDrive(Activity act) {
        this.act = act;
        this.prefs = act.getSharedPreferences("google", Activity.MODE_PRIVATE);
    }

    public static boolean configured() { return BuildConfig.GOOGLE_CLIENT_ID != null && !BuildConfig.GOOGLE_CLIENT_ID.isEmpty(); }
    public static String redirectUri() { return BuildConfig.GOOGLE_REDIRECT_SCHEME + ":/oauth2redirect"; }

    // ---- giriş ---------------------------------------------------------------------------
    public String signIn() {
        if (!configured()) return "İstemci kimliği tanımlı değil (gradle.properties → GOOGLE_CLIENT_ID).";
        try {
            byte[] rnd = new byte[48]; new SecureRandom().nextBytes(rnd);
            String verifier = b64url(rnd);
            byte[] st = new byte[16]; new SecureRandom().nextBytes(st);
            String state = b64url(st);
            prefs.edit().putString("pkce_verifier", verifier).putString("pkce_state", state).putLong("pkce_t", System.currentTimeMillis()).apply();
            String challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
            String url = AUTH + "?client_id=" + enc(BuildConfig.GOOGLE_CLIENT_ID) + "&redirect_uri=" + enc(redirectUri()) + "&response_type=code&scope=" + enc(SCOPES)
                    + "&code_challenge=" + challenge + "&code_challenge_method=S256&state=" + state + "&access_type=offline&prompt=consent";
            act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            return "";
        } catch (Exception e) {
            Log.w(TAG, "signIn", e);
            return "Tarayıcı açılamadı: " + e.getMessage();
        }
    }

    /** Yönlendirme geldi mi? Evetse belirteç takası yapılır (arka planda) ve cb çağrılır. */
    public boolean handleRedirect(Uri uri, Cb cb) {
        if (uri == null || !redirectUri().startsWith(uri.getScheme() + ":")) return false;
        String code = uri.getQueryParameter("code"), state = uri.getQueryParameter("state"), err = uri.getQueryParameter("error");
        if (err != null) { cb.done(false, JSONObject.quote(err)); return true; }
        final String verifier = prefs.getString("pkce_verifier", null), expState = prefs.getString("pkce_state", null);
        long t = prefs.getLong("pkce_t", 0);
        prefs.edit().remove("pkce_verifier").remove("pkce_state").remove("pkce_t").apply();
        if (code == null || verifier == null || state == null || !state.equals(expState)) { cb.done(false, "\"geçersiz yanıt\""); return true; }
        if (System.currentTimeMillis() - t > PKCE_TTL) { cb.done(false, "\"giriş isteği zaman aşımına uğradı; yeniden deneyin\""); return true; }
        new Thread(() -> {
            try {
                String body = "code=" + enc(code) + "&client_id=" + enc(BuildConfig.GOOGLE_CLIENT_ID) + "&redirect_uri=" + enc(redirectUri()) + "&grant_type=authorization_code&code_verifier=" + enc(verifier);
                JSONObject tok = new JSONObject(post(TOKEN, body, "application/x-www-form-urlencoded", null));
                if (!tok.has("access_token")) throw new IOException(tok.optString("error_description", tok.toString()));
                saveTokens(tok, null);
                JSONObject me = new JSONObject(get(USERINFO, accessToken()));
                prefs.edit().putString("user", me.toString()).apply();
                cb.done(true, me.toString());
            } catch (Exception e) {
                Log.w(TAG, "token", e);
                cb.done(false, JSONObject.quote(message(e)));
            }
        }).start();
        return true;
    }

    /** Kullanıcıya gösterilecek hata iletisi: ağ yokluğu ve bellek yetersizliği Türkçe, ötekiler olduğu gibi */
    public static String message(Throwable e) {
        if (e instanceof java.net.UnknownHostException || e instanceof java.net.SocketTimeoutException || e instanceof java.net.ConnectException)
            return "İnternet bağlantısı yok (" + e.getClass().getSimpleName() + ")";
        if (e instanceof OutOfMemoryError) return "Dosya yüklemek için bellek yetmedi";
        return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    }

    private void saveTokens(JSONObject tok, String keepRefresh) {
        SharedPreferences.Editor ed = prefs.edit();
        ed.putString("access", tok.optString("access_token"));
        ed.putLong("exp", System.currentTimeMillis() + Math.max(60, tok.optLong("expires_in", 3600) - 60) * 1000L);
        String r = tok.optString("refresh_token", "");
        if (!r.isEmpty()) ed.putString("refresh", r); else if (keepRefresh != null) ed.putString("refresh", keepRefresh);
        ed.apply();
    }

    public String user() { return prefs.getString("user", ""); }
    public boolean signedIn() { return !prefs.getString("refresh", "").isEmpty() || !prefs.getString("access", "").isEmpty(); }

    public void signOut() {
        final String tok = prefs.getString("refresh", prefs.getString("access", ""));
        prefs.edit().clear().apply();
        if (!tok.isEmpty()) new Thread(() -> { try { post(REVOKE + "?token=" + enc(tok), "", "application/x-www-form-urlencoded", null); } catch (Exception ignored) { } }).start();
    }

    /** Geçerli erişim belirteci; süresi dolmuşsa yeniler. */
    public synchronized String accessToken() throws IOException {
        String a = prefs.getString("access", "");
        if (!a.isEmpty() && System.currentTimeMillis() < prefs.getLong("exp", 0)) return a;
        String r = prefs.getString("refresh", "");
        if (r.isEmpty()) throw new IOException("Oturum yok; Google ile giriş yapın.");
        try {
            String body = "refresh_token=" + enc(r) + "&client_id=" + enc(BuildConfig.GOOGLE_CLIENT_ID) + "&grant_type=refresh_token";
            JSONObject tok = new JSONObject(post(TOKEN, body, "application/x-www-form-urlencoded", null));
            if (!tok.has("access_token")) { prefs.edit().remove("access").remove("refresh").apply(); throw new IOException("Oturum süresi doldu; yeniden giriş yapın."); }
            saveTokens(tok, r);
            return tok.getString("access_token");
        } catch (org.json.JSONException e) { throw new IOException("belirteç yanıtı okunamadı"); }
    }

    // ---- Drive ---------------------------------------------------------------------------
    public static final String FIELDS = "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,iconLink,thumbnailLink,webViewLink,shared,owners(displayName))";

    /** Klasör içeriği ya da arama. folder: 'root' | id | 'shared' | 'recent' | 'starred' */
    public String list(String folder, String q, String pageToken) throws IOException {
        StringBuilder query = new StringBuilder("trashed = false");
        String order = "folder,name_natural";
        if (q != null && !q.isEmpty()) query.append(" and name contains '").append(q.replace("\\", "\\\\").replace("'", "\\'")).append("'");
        else if ("shared".equals(folder)) query.append(" and sharedWithMe = true");
        else if ("starred".equals(folder)) query.append(" and starred = true");
        else if ("recent".equals(folder)) { query.append(" and mimeType != 'application/vnd.google-apps.folder'"); order = "viewedByMeTime desc"; }
        else query.append(" and '").append(folder == null || folder.isEmpty() ? "root" : folder).append("' in parents");
        String url = API + "files?q=" + enc(query.toString()) + "&orderBy=" + enc(order) + "&pageSize=100&fields=" + enc(FIELDS)
                + "&supportsAllDrives=true&includeItemsFromAllDrives=true" + (pageToken != null && !pageToken.isEmpty() ? "&pageToken=" + enc(pageToken) : "");
        return get(url, accessToken());
    }
    public String meta(String id) throws IOException {
        return get(API + "files/" + enc(id) + "?fields=" + enc("id,name,mimeType,size,parents,webViewLink") + "&supportsAllDrives=true", accessToken());
    }
    public String about() throws IOException { return get(API + "about?fields=" + enc("user,storageQuota"), accessToken()); }

    public interface Progress { void at(long done, long total); }

    /** Dosyayı indirir (Google Docs türleri PDF'e dışa aktarılır); hedef dosyayı döner */
    public File download(String id, String name, String mime, File dir, Progress pr) throws IOException {
        String url;
        String outName = name;
        if (mime != null && mime.startsWith("application/vnd.google-apps.")) {
            String exp = "application/pdf";
            if (mime.endsWith("spreadsheet")) exp = "application/pdf";
            url = API + "files/" + enc(id) + "/export?mimeType=" + enc(exp);
            if (!outName.toLowerCase().endsWith(".pdf")) outName = outName + ".pdf";
        } else url = API + "files/" + enc(id) + "?alt=media&supportsAllDrives=true";
        File f = new File(dir, Docs.safe(id) + "_" + Docs.safe(outName));
        HttpURLConnection c = open(url, "GET", accessToken());
        int code = c.getResponseCode();
        if (code >= 400) throw new IOException(errorOf(c, code));
        long total = c.getContentLengthLong(), done = 0;
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(f)) {
            byte[] buf = new byte[65536]; int n; long lastT = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n); done += n;
                long t = System.currentTimeMillis();
                if (pr != null && t - lastT > 250) { pr.at(done, total); lastT = t; }
            }
        }
        if (pr != null) pr.at(done, done);
        return f;
    }

    /**
     * Çok parçalı yükleme; gövde akıtılır, dosya Java yığınına alınmaz. len bilinmiyorsa (-1) parçalı kip.
     * convertTo (ör. application/vnd.google-apps.document) verilirse Google biçimine çevrilir.
     */
    public String upload(InputStream in, long len, String name, String mime, String folderId, String convertTo) throws IOException {
        JSONObject meta = new JSONObject();
        try {
            meta.put("name", name);
            if (folderId != null && !folderId.isEmpty() && !"root".equals(folderId)) meta.put("parents", new org.json.JSONArray().put(folderId));
            if (convertTo != null) meta.put("mimeType", convertTo);
        } catch (Exception ignored) { }
        String boundary = "dwgviewer" + System.currentTimeMillis();
        byte[] head = ("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + boundary + "\r\nContent-Type: " + mime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] tail = ("\r\n--" + boundary + "--").getBytes(StandardCharsets.UTF_8);
        HttpURLConnection c = open(UPLOAD + "?uploadType=multipart&supportsAllDrives=true&fields=" + enc("id,name,mimeType,webViewLink,parents"), "POST", accessToken());
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "multipart/related; boundary=" + boundary);
        if (len >= 0) c.setFixedLengthStreamingMode(head.length + len + tail.length); else c.setChunkedStreamingMode(65536);
        try (OutputStream out = c.getOutputStream()) { out.write(head); Docs.copy(in, out); out.write(tail); }
        int code = c.getResponseCode();
        if (code >= 400) throw new IOException(errorOf(c, code));
        try (InputStream rin = c.getInputStream()) { return read(rin); }
    }
    public String createFolder(String name, String parent) throws IOException {
        JSONObject meta = new JSONObject();
        try { meta.put("name", name); meta.put("mimeType", "application/vnd.google-apps.folder"); if (parent != null && !parent.isEmpty()) meta.put("parents", new org.json.JSONArray().put(parent)); } catch (Exception ignored) { }
        return post(API + "files?supportsAllDrives=true&fields=" + enc("id,name,mimeType"), meta.toString(), "application/json; charset=UTF-8", accessToken());
    }
    public void delete(String id) throws IOException {
        HttpURLConnection c = open(API + "files/" + enc(id) + "?supportsAllDrives=true", "DELETE", accessToken());
        int code = c.getResponseCode();
        if (code >= 400) throw new IOException(errorOf(c, code));
        c.disconnect();
    }
    /** Ofis belgesini Google biçimine çevirip PDF olarak indirir (geçici dosya silinir) */
    public File convertToPdf(File src, String name, String mime, File dir, Progress pr) throws IOException {
        String gtype = "application/vnd.google-apps.document";
        String low = name.toLowerCase();
        if (low.endsWith(".xls") || low.endsWith(".xlsx") || low.endsWith(".csv") || low.endsWith(".ods")) gtype = "application/vnd.google-apps.spreadsheet";
        else if (low.endsWith(".ppt") || low.endsWith(".pptx") || low.endsWith(".odp")) gtype = "application/vnd.google-apps.presentation";
        String up;
        try (InputStream in = new java.io.FileInputStream(src)) { up = upload(in, src.length(), name, mime, null, gtype); }
        String id;
        try { id = new JSONObject(up).getString("id"); } catch (Exception e) { throw new IOException("dönüştürme yanıtı okunamadı: " + up); }
        try { return download(id, name.replaceFirst("\\.[^.]+$", ""), gtype, dir, pr); }
        finally { try { delete(id); } catch (Exception ignored) { } }
    }

    // ---- HTTP ----------------------------------------------------------------------------
    private static HttpURLConnection open(String url, String method, String token) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(20000); c.setReadTimeout(120000);
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        c.setRequestProperty("Accept", "application/json");
        return c;
    }
    private static String get(String url, String token) throws IOException {
        HttpURLConnection c = open(url, "GET", token);
        int code = c.getResponseCode();
        if (code >= 400) throw new IOException(errorOf(c, code));
        try (InputStream in = c.getInputStream()) { return read(in); }
    }
    private static String post(String url, String body, String contentType, String token) throws IOException { return post(url, body.getBytes(StandardCharsets.UTF_8), contentType, token); }
    private static String post(String url, byte[] body, String contentType, String token) throws IOException {
        HttpURLConnection c = open(url, "POST", token);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", contentType);
        c.setFixedLengthStreamingMode(body.length);
        try (OutputStream out = c.getOutputStream()) { out.write(body); }
        int code = c.getResponseCode();
        if (code >= 400) throw new IOException(errorOf(c, code));
        try (InputStream in = c.getInputStream()) { return read(in); }
    }
    private static String errorOf(HttpURLConnection c, int code) {
        String msg = "";
        try (InputStream in = c.getErrorStream()) { if (in != null) msg = read(in); } catch (IOException ignored) { }
        try { JSONObject o = new JSONObject(msg); if (o.has("error")) { Object e = o.get("error"); msg = e instanceof JSONObject ? ((JSONObject) e).optString("message", e.toString()) : o.optString("error_description", e.toString()); } } catch (Exception ignored) { }
        if (code == 401) msg = "Oturum geçersiz (401); yeniden giriş yapın. " + msg;
        return "HTTP " + code + ": " + msg;
    }
    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream(); Docs.copy(in, o);
        return o.toString("UTF-8");
    }
    private static String enc(String s) { try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; } }
    private static String b64url(byte[] b) { return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
}
