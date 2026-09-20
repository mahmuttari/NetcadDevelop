package com.mahmuttari.dwgviewer;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.util.List;
import java.util.UUID;

/**
 * WebDAV hesapları (Nextcloud / ownCloud / Apache mod_dav / Synology…) ve işlemleri.
 *
 *  - Hesaplar prefs "webdav" → "accounts": [{id,name,url,user,pass}]; pass Secrets ile (Android Keystore
 *    AES/GCM) şifrelidir, JS'e hiçbir zaman dönmez. Prefs dosyası yedeklemeden dışlanmıştır (backup_rules).
 *  - list / download / test: WebDavClient (saf Java) + WebDavXml (PROPFIND çözümleme). Arka planda çalışır;
 *    MainActivity.Bridge.wd() sonucu dwgApp.onWebDav(reqId, ok, json) ile JS'e verir.
 */
public class WebDav {
    private static final String TAG = "DwgViewer.WebDav";
    private final SharedPreferences prefs;

    public interface Progress { void at(long done, long total); }

    public WebDav(Context ctx) { this.prefs = ctx.getSharedPreferences("webdav", Context.MODE_PRIVATE); }

    // ---- hesap deposu ---------------------------------------------------------------------
    private synchronized JSONArray load() {
        try { return new JSONArray(prefs.getString("accounts", "[]")); } catch (Exception e) { return new JSONArray(); }
    }
    private synchronized void store(JSONArray arr) { prefs.edit().putString("accounts", arr.toString()).apply(); }

    /** JSON dizisi [{id,name,url,user}] — parola dönmez */
    public String accounts() {
        JSONArray in = load(), out = new JSONArray();
        for (int i = 0; i < in.length(); i++) {
            JSONObject a = in.optJSONObject(i); if (a == null) continue;
            JSONObject o = new JSONObject();
            try { o.put("id", a.optString("id")); o.put("name", a.optString("name")); o.put("url", a.optString("url")); o.put("user", a.optString("user")); } catch (Exception ignored) { }
            out.put(o);
        }
        return out.toString();
    }

    /**
     * {id?,name,url,user,pass} kaydeder; id yoksa üretir. Var olan hesapta pass boş verilirse eski parola korunur
     * (parolayı yeniden yazmadan ad/adres düzenleme). Döner: hesap id'si. Hata: IOException (ileti Türkçe).
     */
    public String save(String json) throws IOException {
        JSONObject a;
        try { a = new JSONObject(json); } catch (Exception e) { throw new IOException("Geçersiz hesap verisi"); }
        String url = WebDavClient.normalize(a.optString("url", ""));
        String user = a.optString("user", "").trim();
        String pass = a.optString("pass", "");
        String name = a.optString("name", "").trim();
        if (name.isEmpty()) { try { name = new java.net.URL(url).getHost(); } catch (Exception e) { name = "WebDAV"; } }
        String id = a.optString("id", "").trim();
        if (id.isEmpty()) id = "wd_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        synchronized (this) {
            JSONArray arr = load();
            JSONObject old = null; int at = -1;
            for (int i = 0; i < arr.length(); i++) { JSONObject o = arr.optJSONObject(i); if (o != null && id.equals(o.optString("id"))) { old = o; at = i; break; } }
            String enc;
            if (pass.isEmpty()) enc = old == null ? "" : old.optString("pass", "");
            else {
                try { enc = Secrets.encrypt(pass); }
                catch (Exception e) { Log.w(TAG, "encrypt", e); throw new IOException("Parola şifrelenemedi: " + e.getMessage()); }
            }
            JSONObject o = new JSONObject();
            try { o.put("id", id); o.put("name", name); o.put("url", url); o.put("user", user); o.put("pass", enc); o.put("t", System.currentTimeMillis()); }
            catch (Exception e) { throw new IOException("Hesap yazılamadı"); }
            try { if (at >= 0) arr.put(at, o); else arr.put(o); } catch (Exception e) { throw new IOException("Hesap yazılamadı"); }
            store(arr);
        }
        return id;
    }

    public void remove(String id) {
        if (id == null) return;
        synchronized (this) {
            JSONArray arr = load(), out = new JSONArray();
            for (int i = 0; i < arr.length(); i++) { JSONObject o = arr.optJSONObject(i); if (o != null && !id.equals(o.optString("id"))) out.put(o); }
            store(out);
        }
    }

    /** Kayıtlı hesabın istemcisi (parola çözülmüş); hesap yoksa ya da parola çözülemiyorsa IOException */
    private WebDavClient client(String id) throws IOException {
        JSONArray arr = load();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && id != null && id.equals(o.optString("id"))) {
                String pass = Secrets.decrypt(o.optString("pass", ""));
                if (pass == null) throw new IOException("Kayıtlı parola çözülemedi; hesabı düzenleyip parolayı yeniden girin");
                return new WebDavClient(o.optString("url"), o.optString("user"), pass);
            }
        }
        throw new IOException("WebDAV hesabı bulunamadı");
    }

    // ---- işlemler --------------------------------------------------------------------------
    /** Klasör içeriği: {items:[{name,path,dir,size,time,mime}]} */
    public String list(String id, String path) throws Exception {
        WebDavClient c = client(id);
        String p = path == null || path.isEmpty() ? "/" : path;
        if (!p.endsWith("/")) p += "/";
        WebDavClient.Response r = c.propfind(p, 1);
        List<WebDavXml.Item> items = WebDavXml.parse(r.body, c.basePath(), p);
        JSONArray arr = new JSONArray();
        for (WebDavXml.Item it : items) {
            JSONObject o = new JSONObject();
            o.put("name", it.name); o.put("path", it.path); o.put("dir", it.dir); o.put("size", it.size); o.put("time", it.time); o.put("mime", it.mime);
            arr.put(o);
        }
        return new JSONObject().put("items", arr).put("path", p).toString();
    }

    /** Dosyayı önbelleğe indirir (docs.importStream → "webdav" alt dizini); {id,name,size,ext} döner */
    public JSONObject download(String id, String path, String name, Docs docs, Progress pr) throws Exception {
        WebDavClient c = client(id);
        String nm = name == null || name.isEmpty() ? path.substring(path.lastIndexOf('/') + 1) : name;
        if (nm.isEmpty()) nm = "dosya";
        HttpURLConnection conn = c.get(path);
        try {
            final long total = conn.getContentLengthLong();
            try (InputStream in = new ProgressStream(conn.getInputStream(), total, pr)) { return docs.importStream(in, nm, "webdav"); }
        } finally { conn.disconnect(); }
    }

    /*
     * YÜKLEME. Çakışma ve kısmi yükleme sözleşmesi:
     *
     * ÇAKIŞMA hata değil SORUDUR. Hedefte aynı adlı dosya varsa ve overwrite=false ise
     * {"exists":true, path, size, time} döner; JS bunu görüp kullanıcıya "üzerine yaz / yeniden
     * adlandır / vazgeç" kutusu açar. IOException atmak yanlış olurdu: kullanıcı bir karar
     * vermelidir, bir hatayla karşılaşmamalıdır.
     *
     * KISMİ YÜKLEME. WebDAV'ın atomik yazma garantisi YOKTUR: bağlantı ortasında koparsa sunucuda
     * yarım dosya kalabilir. Bu yüzden önce geçici ada (.<ad>.yukleniyor) yazılır, başarıyla
     * bittikten sonra MOVE ile gerçek adına alınır. MOVE aynı sunucu içinde olduğu için çoğu
     * sunucuda atomiktir. Yükleme yarıda kalırsa geçici ad silinmeye çalışılır; silinemezse
     * kullanıcının gerçek dosyası yine de bozulmamıştır — sözleşmenin asıl amacı budur.
     */
    public String upload(String id, String dirPath, String name, java.io.File src, boolean overwrite, Progress pr) throws Exception {
        WebDavClient c = client(id);
        String dir = dirPath == null || dirPath.isEmpty() ? "/" : dirPath;
        if (!dir.endsWith("/")) dir += "/";
        String nm = safeName(name);
        String hedef = dir + nm;
        if (!overwrite && c.statOrNull(hedef) != null) {
            return new JSONObject().put("exists", true).put("path", hedef).put("name", nm).toString();
        }
        String gecici = dir + "." + nm + ".yukleniyor";
        long len = src.length();
        boolean tasindi = false;
        try {
            try (InputStream in = new java.io.FileInputStream(src)) { c.put(gecici, in, len, mimeOf(nm), false, pr); }
            c.move(gecici, hedef, true);
            tasindi = true;
        } finally {
            if (!tasindi) { try { c.del(gecici); } catch (Exception ignored) { } }
        }
        return new JSONObject().put("ok", true).put("path", hedef).put("name", nm).put("size", len).toString();
    }
    /** Klasör oluşturur; zaten varsa sessizce başarılı sayılır (MKCOL 405). */
    public String mkdir(String id, String path, String name) throws Exception {
        WebDavClient c = client(id);
        String dir = path == null || path.isEmpty() ? "/" : path;
        if (!dir.endsWith("/")) dir += "/";
        String p = dir + safeName(name);
        c.mkcol(p);
        return new JSONObject().put("ok", true).put("path", p + "/").toString();
    }
    /** Dosya ya da klasör siler. */
    public String delete(String id, String path) throws Exception {
        client(id).del(path);
        return new JSONObject().put("ok", true).put("path", path).toString();
    }
    /** Taşır / yeniden adlandırır. */
    public String move(String id, String from, String to, boolean overwrite) throws Exception {
        client(id).move(from, to, overwrite);
        return new JSONObject().put("ok", true).put("path", to).toString();
    }
    /** Yol var mı: {"exists":true|false} */
    public String stat(String id, String path) throws Exception {
        return new JSONObject().put("exists", client(id).statOrNull(path) != null).put("path", path).toString();
    }
    /** Dosya adından yol ayracı ve sunucuyu şaşırtan karakterleri atar */
    static String safeName(String name) {
        String n = name == null ? "" : name.trim().replace("\\", "/");
        int i = n.lastIndexOf('/');
        if (i >= 0) n = n.substring(i + 1);
        n = n.replaceAll("[\\u0000-\\u001f]", "").trim();
        if (n.isEmpty() || n.equals(".") || n.equals("..")) n = "dosya";
        return n.length() > 180 ? n.substring(0, 180) : n;
    }
    static String mimeOf(String name) {
        String l = name.toLowerCase(java.util.Locale.ROOT);
        if (l.endsWith(".dwg")) return "image/vnd.dwg";
        if (l.endsWith(".dxf")) return "image/vnd.dxf";
        if (l.endsWith(".dgn")) return "application/dgn";
        if (l.endsWith(".pdf")) return "application/pdf";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".csv")) return "text/csv";
        return "application/octet-stream";
    }

    /** Bağlantı sınaması (PROPFIND Depth:0); {ok:true} ya da IOException */
    public String test(String url, String user, String pass) throws Exception {
        WebDavClient c = new WebDavClient(url, user, pass);
        WebDavClient.Response r = c.propfind("/", 0);
        // gövde çözülebilmeli (multistatus); aksi halde WebDAV değil
        WebDavXml.parse(r.body, c.basePath(), "/x-yok-x/");
        return new JSONObject().put("ok", true).put("url", c.base).toString();
    }

    /** Kullanıcıya gösterilecek ileti: ağ hataları Türkçe, ötekiler olduğu gibi */
    public static String message(Throwable e) {
        if (e instanceof javax.net.ssl.SSLException) return "Güvenli bağlantı kurulamadı: " + e.getMessage();
        if (e instanceof org.xml.sax.SAXException) return "Sunucu yanıtı WebDAV biçiminde değil (adres bir WebDAV kökü olmayabilir)";
        return GoogleDrive.message(e);
    }

    /** İlerleme bildiren akış (250 ms'de bir) */
    private static final class ProgressStream extends java.io.FilterInputStream {
        private final long total; private final Progress pr; private long done, lastT;
        ProgressStream(InputStream in, long total, Progress pr) { super(in); this.total = total; this.pr = pr; }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            int n = super.read(b, off, len);
            if (n > 0 && pr != null) { done += n; long t = System.currentTimeMillis(); if (t - lastT > 250) { pr.at(done, total); lastT = t; } }
            return n;
        }
        @Override public int read() throws IOException { int b = super.read(); if (b >= 0) done++; return b; }
    }
}
