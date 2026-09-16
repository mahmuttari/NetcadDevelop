package com.mahmuttari.dwgviewer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * WebDAV HTTP istemcisi (Nextcloud, ownCloud, Apache mod_dav, nginx, Synology…). Saf Java: Android'de ve
 * masaüstü JVM'de (sınama) aynı kod çalışır; android.* kullanılmaz.
 *
 *  - PROPFIND: Android'in HttpURLConnection'ı (OkHttp tabanlı) yalnız standart yöntemleri kabul eder,
 *    setRequestMethod("PROPFIND") ProtocolException fırlatır. Bu yüzden PROPFIND doğrudan soket üzerinden
 *    (HTTP/1.1, Content-Length ya da chunked gövde, Connection: close) yazılıp okunur; HTTPS için
 *    SSLSocketFactory + sunucu adı doğrulaması (endpoint identification "HTTPS").
 *    Sistem HTTP vekili (ProxySelector) uygulanır: http vekile mutlak URL ile, https CONNECT tüneliyle.
 *  - GET (indirme): HttpURLConnection; yönlendirme izlenmez.
 *  - Kimlik: Basic (java.util.Base64, API 26+). Zaman aşımı 15 s. Yönlendirme yok: 3xx hata sayılır ve
 *    hedef adres iletide gösterilir; kullanıcı tam adresi yazar.
 */
final class WebDavClient {
    static final int TIMEOUT = 15000;
    static final int MAX_BODY = 16 * 1024 * 1024;
    static final String UA = "DwgViewer/7.2 (WebDAV)";
    private static final String PROPFIND_BODY = "<?xml version=\"1.0\" encoding=\"utf-8\"?><d:propfind xmlns:d=\"DAV:\"><d:prop>"
            + "<d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:displayname/></d:prop></d:propfind>";

    /** Hesap kökü: sonu "/" ile biten mutlak URL */
    final String base;
    final String user, pass;

    WebDavClient(String url, String user, String pass) throws IOException {
        this.base = normalize(url);
        this.user = user == null ? "" : user;
        this.pass = pass == null ? "" : pass;
    }

    /** "cloud.example.com/remote.php/dav/files/ali" → "https://cloud.example.com/remote.php/dav/files/ali/" */
    static String normalize(String url) throws IOException {
        String u = url == null ? "" : url.trim();
        if (u.isEmpty()) throw new IOException("Sunucu adresi boş");
        if (!u.contains("://")) u = "https://" + u;
        if (!u.toLowerCase(Locale.ROOT).startsWith("http://") && !u.toLowerCase(Locale.ROOT).startsWith("https://")) throw new IOException("Adres http:// ya da https:// ile başlamalı");
        URL p = new URL(u);
        if (p.getHost() == null || p.getHost().isEmpty()) throw new IOException("Sunucu adı eksik");
        int q = u.indexOf('?'); if (q >= 0) u = u.substring(0, q);
        if (!u.endsWith("/")) u += "/";
        return u;
    }

    /** Hesap kökünün sunucudaki çözülmüş yolu, sonu "/" ("/remote.php/dav/files/ali/") — WebDavXml.parse için */
    String basePath() throws IOException {
        String p = new URL(base).getPath();
        if (p == null || p.isEmpty()) p = "/";
        p = WebDavXml.decode(p);
        return p.endsWith("/") ? p : p + "/";
    }

    /** Hesap köküne göre yolu ("/Projeler/plan.dwg") tam, yüzde kodlu URL'ye çevirir */
    String resolve(String relPath) {
        String r = relPath == null ? "/" : relPath.trim();
        if (!r.startsWith("/")) r = "/" + r;
        while (r.contains("//")) r = r.replace("//", "/");
        return base.substring(0, base.length() - 1) + encodePath(r);
    }

    /** Yol bölümlerini UTF-8 yüzde kodlar; "/" ve ayrılmamış karakterler olduğu gibi kalır (URLEncoder boşluğu '+' yapar, uygun değil) */
    static String encodePath(String path) {
        StringBuilder sb = new StringBuilder(path.length() + 16);
        for (byte b : path.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '/' || c == '-' || c == '_' || c == '.' || c == '~'
                    || c == '!' || c == '$' || c == '&' || c == '\'' || c == '(' || c == ')' || c == '*' || c == '+' || c == ',' || c == ';' || c == '=' || c == ':' || c == '@')
                sb.append((char) c);
            else sb.append('%').append("0123456789ABCDEF".charAt(c >> 4)).append("0123456789ABCDEF".charAt(c & 15));
        }
        return sb.toString();
    }

    String authHeader() {
        return "Basic " + Base64.getEncoder().encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8));
    }

    // ---- PROPFIND ------------------------------------------------------------------------
    static final class Response {
        int code;
        String status = "";
        final Map<String, String> headers = new LinkedHashMap<>(); // küçük harf başlık adı
        byte[] body = new byte[0];
        String header(String name) { return headers.get(name.toLowerCase(Locale.ROOT)); }
    }

    /** PROPFIND; 207 dışı yanıt IOException (401/404/405 Türkçe ileti) */
    Response propfind(String relPath, int depth) throws IOException {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Depth", String.valueOf(depth));
        h.put("Content-Type", "application/xml; charset=utf-8");
        Response r = raw("PROPFIND", resolve(relPath), h, PROPFIND_BODY.getBytes(StandardCharsets.UTF_8));
        if (r.code != 207 && r.code != 200) throw error(r.code, r.header("location"), r.body);
        return r;
    }

    /** Ham HTTP/1.1 isteği; tek kullanımlık bağlantı (Connection: close). Yönlendirme izlenmez. */
    Response raw(String method, String fullUrl, Map<String, String> extra, byte[] body) throws IOException {
        URL u = new URL(fullUrl);
        boolean tls = "https".equalsIgnoreCase(u.getProtocol());
        int port = u.getPort() < 0 ? u.getDefaultPort() : u.getPort();
        String host = u.getHost();
        String target = u.getPath() == null || u.getPath().isEmpty() ? "/" : u.getPath();
        if (u.getQuery() != null) target += "?" + u.getQuery();
        // Sistem HTTP vekili (Wi-Fi vekil ayarı / ProxySelector): GET'teki HttpURLConnection ile aynı yolu izler.
        // http → vekile mutlak URL ile istek; https → önce CONNECT tüneli, sonra TLS.
        InetSocketAddress proxy = httpProxyFor(u);
        Socket s = new Socket();
        try {
            s.connect(proxy != null ? proxy : new InetSocketAddress(host, port), TIMEOUT);
            s.setSoTimeout(TIMEOUT);
            if (proxy != null && tls) connectTunnel(s, host, port, proxy);
            if (proxy != null && !tls) target = fullUrl;
            if (tls) {
                SSLSocket ss = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(s, host, port, true);
                SSLParameters sp = ss.getSSLParameters();
                sp.setEndpointIdentificationAlgorithm("HTTPS");   // sunucu adı sertifikayla doğrulanır
                ss.setSSLParameters(sp);
                ss.startHandshake();
                s = ss;
            }
            StringBuilder req = new StringBuilder(512);
            req.append(method).append(' ').append(target).append(" HTTP/1.1\r\n");
            req.append("Host: ").append(host).append(port == u.getDefaultPort() ? "" : ":" + port).append("\r\n");
            req.append("User-Agent: ").append(UA).append("\r\n");
            req.append("Authorization: ").append(authHeader()).append("\r\n");
            req.append("Accept: application/xml, text/xml, */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n");
            for (Map.Entry<String, String> e : extra.entrySet()) req.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            req.append("Content-Length: ").append(body == null ? 0 : body.length).append("\r\n\r\n");
            OutputStream out = s.getOutputStream();
            out.write(req.toString().getBytes(StandardCharsets.ISO_8859_1));
            if (body != null && body.length > 0) out.write(body);
            out.flush();
            InputStream in = new java.io.BufferedInputStream(s.getInputStream(), 16384);
            Response r = new Response();
            String line = readLine(in);
            while (line != null && line.startsWith("HTTP/") && line.contains(" 100")) { // 100 Continue: atla
                while ((line = readLine(in)) != null && !line.isEmpty()) { }
                line = readLine(in);
            }
            if (line == null || !line.startsWith("HTTP/")) throw new IOException("Sunucu HTTP yanıtı vermedi" + (line == null ? "" : ": " + line));
            String[] parts = line.split(" ", 3);
            try { r.code = Integer.parseInt(parts[1].trim()); } catch (Exception e) { throw new IOException("Geçersiz durum satırı: " + line); }
            r.status = parts.length > 2 ? parts[2] : "";
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0) {
                    String k = line.substring(0, c).trim().toLowerCase(Locale.ROOT), v = line.substring(c + 1).trim();
                    String old = r.headers.get(k);
                    r.headers.put(k, old == null ? v : old + ", " + v);
                }
            }
            if (r.code == 204 || r.code == 304 || "HEAD".equals(method)) return r;
            String te = r.header("transfer-encoding"), cl = r.header("content-length");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            if (te != null && te.toLowerCase(Locale.ROOT).contains("chunked")) {
                while (true) {
                    String sz = readLine(in);
                    if (sz == null) break;
                    int semi = sz.indexOf(';'); if (semi >= 0) sz = sz.substring(0, semi);
                    int n; try { n = Integer.parseInt(sz.trim(), 16); } catch (Exception e) { throw new IOException("Bozuk chunked gövde"); }
                    if (n < 0) throw new IOException("Bozuk chunked gövde");
                    if (n == 0) { while ((line = readLine(in)) != null && !line.isEmpty()) { } break; }
                    if ((long) bo.size() + n > MAX_BODY) throw new IOException("Yanıt çok büyük");   // chunked gövdede de sınır
                    copyN(in, bo, n);
                    readLine(in); // parça sonu CRLF
                }
            } else if (cl != null) {
                long n; try { n = Long.parseLong(cl.trim()); } catch (Exception e) { n = -1; }
                if (n > MAX_BODY) throw new IOException("Yanıt çok büyük (" + n + " bayt)");
                if (n >= 0) copyN(in, bo, (int) n); else copyAll(in, bo);
            } else copyAll(in, bo);
            r.body = bo.toByteArray();
            return r;
        } finally {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    /** Sistem vekil ayarından bu adres için HTTP vekili; yoksa (DIRECT) null */
    static InetSocketAddress httpProxyFor(URL u) {
        try {
            ProxySelector ps = ProxySelector.getDefault(); if (ps == null) return null;
            List<Proxy> l = ps.select(u.toURI()); if (l == null) return null;
            for (Proxy p : l) {
                if (p != null && p.type() == Proxy.Type.HTTP && p.address() instanceof InetSocketAddress) {
                    InetSocketAddress a = (InetSocketAddress) p.address();
                    return a.isUnresolved() ? new InetSocketAddress(a.getHostString(), a.getPort()) : a;
                }
            }
        } catch (Exception ignored) { /* vekil çözülemedi: doğrudan bağlan */ }
        return null;
    }

    /** Vekile CONNECT host:port yazar, 2xx bekler; başarısızsa IOException */
    private static void connectTunnel(Socket s, String host, int port, InetSocketAddress proxy) throws IOException {
        OutputStream out = s.getOutputStream();
        out.write(("CONNECT " + host + ":" + port + " HTTP/1.1\r\nHost: " + host + ":" + port + "\r\nUser-Agent: " + UA + "\r\nProxy-Connection: keep-alive\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
        out.flush();
        InputStream in = s.getInputStream();
        String line = readLine(in);
        if (line == null || !line.startsWith("HTTP/")) throw new IOException("Ağ vekili yanıt vermedi (" + proxy.getHostString() + ":" + proxy.getPort() + ")");
        String[] parts = line.split(" ", 3);
        int code; try { code = Integer.parseInt(parts[1].trim()); } catch (Exception e) { throw new IOException("Ağ vekili geçersiz yanıt verdi: " + line); }
        while ((line = readLine(in)) != null && !line.isEmpty()) { }   // tünel başlıkları
        if (code < 200 || code >= 300) throw new IOException("Ağ vekili bağlantıya izin vermedi (HTTP " + code + ")");
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(128);
        int b;
        while ((b = in.read()) >= 0) {
            if (b == '\n') break;
            if (b != '\r') bo.write(b);
            if (bo.size() > 65536) throw new IOException("Başlık satırı çok uzun");
        }
        if (b < 0 && bo.size() == 0) return null;
        return new String(bo.toByteArray(), StandardCharsets.ISO_8859_1);
    }
    private static void copyN(InputStream in, OutputStream out, int n) throws IOException {
        byte[] buf = new byte[16384]; int left = n;
        while (left > 0) {
            int r = in.read(buf, 0, Math.min(buf.length, left));
            if (r < 0) throw new IOException("Bağlantı erken kapandı");
            out.write(buf, 0, r); left -= r;
        }
    }
    private static void copyAll(InputStream in, ByteArrayOutputStream out) throws IOException {
        byte[] buf = new byte[16384]; int r;
        while ((r = in.read(buf)) > 0) { out.write(buf, 0, r); if (out.size() > MAX_BODY) throw new IOException("Yanıt çok büyük"); }
    }

    // ---- GET -----------------------------------------------------------------------------
    /** İndirme bağlantısı; durum kodu denetlenmiş, gövdesi okunmaya hazır. Çağıran getInputStream()'i kapatır. */
    HttpURLConnection get(String relPath) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(resolve(relPath)).openConnection();
        c.setRequestMethod("GET");
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(TIMEOUT); c.setReadTimeout(TIMEOUT);
        c.setRequestProperty("Authorization", authHeader());
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", "*/*");
        c.setRequestProperty("Accept-Encoding", "identity");
        int code = c.getResponseCode();
        if (code >= 300) {
            byte[] body = new byte[0];
            try (InputStream in = c.getErrorStream()) { if (in != null) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); copyAll(in, bo); body = bo.toByteArray(); } } catch (IOException ignored) { }
            c.disconnect();
            throw error(code, c.getHeaderField("Location"), body);
        }
        return c;
    }

    // ---- yazma (PUT · MKCOL · MOVE · DELETE) ----------------------------------------------
    /*
     * PUT standart bir yöntemdir ve HttpURLConnection onu kabul eder — PROPFIND'i engelleyen
     * ProtocolException duvarı burada YOKTUR. Bu yüzden raw() kullanılmaz: raw() gövdeyi byte[]
     * ister ve 30 MB'lık bir DWG'yi yığına alırdı; burada akış doğrudan sokete yazılır.
     * onlyIfAbsent=true iken "If-None-Match: *" gönderilir; sunucu destekliyorsa var olan dosya
     * 412 ile korunur. Destek garantisi olmadığı için üst katman ayrıca stat() ile de bakar.
     */
    void put(String relPath, java.io.InputStream in, long len, String contentType, boolean onlyIfAbsent, WebDav.Progress pr) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(resolve(relPath)).openConnection();
        c.setRequestMethod("PUT");
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(TIMEOUT); c.setReadTimeout(120000);      // yükleme okumadan uzun sürebilir
        c.setRequestProperty("Authorization", authHeader());
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Content-Type", contentType == null || contentType.isEmpty() ? "application/octet-stream" : contentType);
        if (onlyIfAbsent) c.setRequestProperty("If-None-Match", "*");
        c.setDoOutput(true);
        if (len >= 0) c.setFixedLengthStreamingMode(len); else c.setChunkedStreamingMode(0);
        long done = 0;
        try (OutputStream out = c.getOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (pr != null) pr.at(done, len);
            }
            out.flush();
        }
        int code = c.getResponseCode();
        if (code >= 300) {
            byte[] body = new byte[0];
            try (InputStream es = c.getErrorStream()) { if (es != null) { ByteArrayOutputStream bo = new ByteArrayOutputStream(); copyAll(es, bo); body = bo.toByteArray(); } } catch (IOException ignored) { }
            c.disconnect();
            throw writeError(code, c.getHeaderField("Location"), body);
        }
        c.disconnect();
    }
    /** Klasör oluşturur. 405 = klasör ZATEN VAR; bu bir hata değildir, sessizce döner. */
    void mkcol(String relPath) throws IOException {
        String p = relPath.endsWith("/") ? relPath : relPath + "/";
        Response r = raw("MKCOL", resolve(p), new LinkedHashMap<>(), null);
        if (r.code == 405) return;
        if (r.code >= 300) throw writeError(r.code, r.header("location"), r.body);
    }
    /** Taşıma / yeniden adlandırma. Destination MUTLAK adrestir (RFC 4918). */
    void move(String fromRel, String toRel, boolean overwrite) throws IOException {
        Map<String, String> h = new LinkedHashMap<>();
        h.put("Destination", resolve(toRel));
        h.put("Overwrite", overwrite ? "T" : "F");
        Response r = raw("MOVE", resolve(fromRel), h, null);
        if (r.code >= 300) throw writeError(r.code, r.header("location"), r.body);
    }
    /** Siler. 404 = zaten yok; bu bir hata değildir. */
    void del(String relPath) throws IOException {
        Response r = raw("DELETE", resolve(relPath), new LinkedHashMap<>(), null);
        if (r.code == 404) return;
        if (r.code >= 300) throw writeError(r.code, r.header("location"), r.body);
    }
    /** Yol var mı: PROPFIND Depth:0. Yoksa null, varsa yanıtın kendisi. */
    Response statOrNull(String relPath) {
        try { return propfind(relPath, 0); } catch (IOException e) { return null; }
    }

    // ---- hata ----------------------------------------------------------------------------
    /*
     * Yazma yolunun hata metinleri okuma yolundan AYRIDIR. 404/405 okumada "WebDAV adresi
     * bulunamadı" demek doğrudur; yazmada yanlış yönlendirir — 405 orada "sunucu bu işlemi
     * desteklemiyor", 409 ise "üst klasör yok" demektir.
     */
    static IOException writeError(int code, String location, byte[] body) {
        if (code == 403) return new IOException("Sunucu yazmaya izin vermiyor; hesabın bu klasörde yazma yetkisi yok (HTTP 403)");
        if (code == 405) return new IOException("Sunucu bu işlemi desteklemiyor (HTTP 405)");
        if (code == 409) return new IOException("Üst klasör yok (HTTP 409); önce klasörü oluşturun");
        if (code == 412) return new IOException("Aynı adlı dosya zaten var (HTTP 412)");
        if (code == 423) return new IOException("Dosya kilitli (HTTP 423)");
        if (code == 507) return new IOException("Sunucuda yer yok (HTTP 507)");
        return error(code, location, body);
    }
    static IOException error(int code, String location, byte[] body) {
        if (code == 401) return new IOException("Kullanıcı adı ya da parola hatalı");
        if (code == 403) return new IOException("Erişim reddedildi (HTTP 403); hesabın bu klasöre yetkisi yok");
        if (code == 404 || code == 405) return new IOException("WebDAV adresi bulunamadı (sunucu WebDAV desteklemiyor olabilir)");
        if (code == 423) return new IOException("Dosya kilitli (HTTP 423)");
        if (code == 507) return new IOException("Sunucuda yer yok (HTTP 507)");
        if (code >= 300 && code < 400) return new IOException("Sunucu yönlendirme döndürdü (HTTP " + code + ")" + (location == null || location.isEmpty() ? "" : "; adresi tam yazın: " + location));
        String msg = "";
        if (body != null && body.length > 0 && body.length < 4096) {
            String t = new String(body, StandardCharsets.UTF_8).replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
            if (!t.isEmpty() && t.length() < 200) msg = ": " + t;
        }
        return new IOException("HTTP " + code + msg);
    }
}
