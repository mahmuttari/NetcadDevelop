package com.mahmuttari.dwgviewer;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import javax.xml.parsers.DocumentBuilderFactory;

/**
 * WebDAV PROPFIND (207 Multi-Status) yanıtının çözümlenmesi. Saf Java: org.w3c.dom ile yazılmıştır ki aynı
 * kod Android'de ve masaüstü JVM'de (sınama) çalışsın; android.* ya da org.json kullanılmaz.
 *
 * Ad alanı duyarlıdır ("DAV:"); önek ne olursa olsun (D:, d:, lp1:, ya da varsayılan ad alanı) yerel ad ile
 * eşlenir. href'ler mutlak URL (http://sunucu/remote.php/dav/...), sunucu köküne göre mutlak yol
 * (/remote.php/dav/...) ya da göreli olabilir; hepsi yüzde kodlu gelir ve çözülür. İstenen klasörün kendisi
 * (Depth:1 yanıtının ilk girdisi) ve gizli (.) girdiler listeye alınmaz. Sunucu href'leri hesap kökünden başka bir
 * yol önekiyle dönerse (ters vekil) önek istenen klasörün kendi girdisinden çıkarılır (serverPrefix); hesap köküne
 * eşlenemeyen girdiler listelenmez.
 */
final class WebDavXml {
    private WebDavXml() { }

    static final class Item {
        String name;
        /** Hesap köküne göre yol: klasörlerde sonu "/" ile biter, ör. "/Projeler/2026/" ya da "/Projeler/plan.dwg" */
        String path;
        boolean dir;
        long size;
        /** Son değişiklik, ms (bilinmiyorsa 0) */
        long time;
        String mime = "";
    }

    /**
     * @param xml      yanıt gövdesi
     * @param basePath hesap URL'sinin sunucudaki yolu, çözülmüş ve sonu "/" ile ("/remote.php/dav/files/ali/")
     * @param reqPath  istenen klasörün hesap köküne göre yolu ("/" ya da "/Projeler/")
     */
    static List<Item> parse(InputStream xml, String basePath, String reqPath) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192]; int n;
        while ((n = xml.read(buf)) > 0) bo.write(buf, 0, n);
        return parse(bo.toByteArray(), basePath, reqPath);
    }

    static List<Item> parse(byte[] xml, String basePath, String reqPath) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(true);
        f.setExpandEntityReferences(false);
        try { f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true); } catch (Exception ignored) { }
        try { f.setFeature("http://xml.org/sax/features/external-general-entities", false); } catch (Exception ignored) { }
        try { f.setFeature("http://xml.org/sax/features/external-parameter-entities", false); } catch (Exception ignored) { }
        Document doc = f.newDocumentBuilder().parse(new java.io.ByteArrayInputStream(xml));
        Element root = doc.getDocumentElement();
        if (root == null || !"multistatus".equals(root.getLocalName())) throw new Exception("WebDAV yanıtı beklenen biçimde değil (multistatus yok)");

        String base = stripSlash(basePath == null ? "/" : basePath);          // "" ya da "/remote.php/dav/files/ali"
        String req = stripSlash(reqPath == null || reqPath.isEmpty() ? "/" : reqPath); // "" ya da "/Projeler"
        List<Element> resps = children(root, "response");
        String prefix = serverPrefix(resps, base, req);                          // hesap kökünün sunucudaki gerçek yolu
        List<Item> out = new ArrayList<>();
        for (Element resp : resps) {
            Element hrefEl = first(resp, "href");
            if (hrefEl == null) continue;
            String href = text(hrefEl).trim();
            String abs = decode(pathOf(href));                                   // sunucu köküne göre, çözülmüş
            boolean slash = abs.endsWith("/");
            String rel;
            if (prefix.isEmpty()) rel = abs;
            else if (stripSlash(abs).equals(prefix)) rel = "/";
            else if (abs.startsWith(prefix + "/")) rel = abs.substring(prefix.length());
            else continue;                                                       // hesap köküne eşlenemeyen href: açılamaz, listelenmez
            if (rel.isEmpty()) rel = "/";
            String relNoSlash = stripSlash(rel);
            if (relNoSlash.equals(req)) continue;                                // istenen klasörün kendisi
            String name = relNoSlash.substring(relNoSlash.lastIndexOf('/') + 1);

            Item it = new Item();
            boolean dir = slash;
            for (Element ps : children(resp, "propstat")) {
                Element st = first(ps, "status");
                if (st != null && text(st).contains(" 404 ")) continue;          // bulunmayan özellikler
                Element prop = first(ps, "prop");
                if (prop == null) continue;
                Element rt = first(prop, "resourcetype");
                if (rt != null && first(rt, "collection") != null) dir = true;
                Element len = first(prop, "getcontentlength");
                if (len != null) it.size = parseLong(text(len));
                Element lm = first(prop, "getlastmodified");
                if (lm != null) it.time = parseDate(text(lm));
                Element ct = first(prop, "getcontenttype");
                if (ct != null) { String m = text(ct).trim(); int i = m.indexOf(';'); it.mime = (i < 0 ? m : m.substring(0, i)).trim(); }
                Element dn = first(prop, "displayname");
                if (dn != null && name.isEmpty()) name = text(dn).trim();
            }
            if (name.isEmpty() || name.startsWith(".")) continue;                // gizli girdi
            it.name = name;
            it.dir = dir;
            it.path = dir ? relNoSlash + "/" : relNoSlash;
            if (dir) { it.size = 0; if (it.mime.isEmpty() || "httpd/unix-directory".equals(it.mime)) it.mime = ""; }
            out.add(it);
        }
        final java.text.Collator col = java.text.Collator.getInstance(new Locale("tr", "TR"));
        col.setStrength(java.text.Collator.PRIMARY);
        Collections.sort(out, (a, b) -> a.dir != b.dir ? (a.dir ? -1 : 1) : col.compare(a.name, b.name));
        return out;
    }

    /**
     * Hesap kökünün sunucu yanıtındaki gerçek yolu. Olağan durumda basePath'in kendisidir. Sunucu href'leri hesap
     * kökünden farklı bir önekle dönerse (ters vekil yol önekini soymuş ya da eklemiş: kullanıcı
     * "/nextcloud/remote.php/dav/files/ali/" yazar, sunucu "/remote.php/dav/files/ali/..." döner ya da tersi)
     * Depth:1 yanıtındaki istenen klasörün kendisi — hepsinin atası olan en kısa yol — bulunur; "req" soneki
     * atılınca kalan, hesap kökünün sunucudaki karşılığıdır.
     */
    static String serverPrefix(List<Element> resps, String base, String req) {
        String expect = base + req;
        String shortest = null;
        for (Element resp : resps) {
            Element hrefEl = first(resp, "href");
            if (hrefEl == null) continue;
            String abs = stripSlash(decode(pathOf(text(hrefEl).trim())));
            if (abs.equals(expect)) return base;                                  // olağan: hesap kökü ile aynı
            if (shortest == null || abs.length() < shortest.length()) shortest = abs;
        }
        if (shortest == null) return base;
        if (req.isEmpty()) return shortest;
        if (shortest.endsWith(req)) return shortest.substring(0, shortest.length() - req.length());
        return base;                                                              // eşlenemedi: kök dışı girdiler atlanır
    }

    // ---- yol -----------------------------------------------------------------------------
    /** Mutlak URL'den yol kısmı; mutlak yol olduğu gibi; göreli yol "/" ile başlatılır. Sorgu ve parça atılır. */
    static String pathOf(String href) {
        String h = href;
        int q = h.indexOf('?'); if (q >= 0) h = h.substring(0, q);
        int hash = h.indexOf('#'); if (hash >= 0) h = h.substring(0, hash);
        int s = h.indexOf("://");
        if (s > 0) {
            int p = h.indexOf('/', s + 3);
            h = p < 0 ? "/" : h.substring(p);
        } else if (!h.startsWith("/")) h = "/" + h;
        // çift eğik çizgiler tek
        while (h.contains("//")) h = h.replace("//", "/");
        return h;
    }

    /** Yüzde kodunu çözer (URLDecoder'dan farklı: '+' boşluk sayılmaz); geçersiz diziler olduğu gibi kalır */
    static String decode(String s) {
        if (s.indexOf('%') < 0) return s;
        StringBuilder out = new StringBuilder(s.length());
        ByteArrayOutputStream run = new ByteArrayOutputStream();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '%' && i + 2 < s.length() && isHex(s.charAt(i + 1)) && isHex(s.charAt(i + 2))) {
                run.write(Integer.parseInt(s.substring(i + 1, i + 3), 16)); i += 2;
            } else {
                if (run.size() > 0) { out.append(new String(run.toByteArray(), StandardCharsets.UTF_8)); run.reset(); }
                out.append(c);
            }
        }
        if (run.size() > 0) out.append(new String(run.toByteArray(), StandardCharsets.UTF_8));
        return out.toString();
    }
    private static boolean isHex(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }

    /** Sondaki "/"leri atar; "/" → "" */
    static String stripSlash(String p) {
        String s = p;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    // ---- değerler ------------------------------------------------------------------------
    private static long parseLong(String s) { try { return Long.parseLong(s.trim()); } catch (Exception e) { return 0; } }

    private static final String[] DATE_FMTS = {
            "EEE, dd MMM yyyy HH:mm:ss zzz",      // RFC 1123 (getlastmodified)
            "EEEE, dd-MMM-yy HH:mm:ss zzz",       // RFC 850
            "EEE MMM d HH:mm:ss yyyy",            // asctime
            "yyyy-MM-dd'T'HH:mm:ss'Z'",           // ISO 8601 (bazı sunucular)
            "yyyy-MM-dd'T'HH:mm:ssXXX" };
    static long parseDate(String s) {
        String t = s.trim();
        if (t.isEmpty()) return 0;
        for (String f : DATE_FMTS) {
            try {
                SimpleDateFormat df = new SimpleDateFormat(f, Locale.US);
                df.setTimeZone(TimeZone.getTimeZone("GMT"));
                df.setLenient(true);
                return df.parse(t).getTime();
            } catch (Exception ignored) { }
        }
        return 0;
    }

    // ---- DOM yardımcıları (ad alanı: DAV: ya da adsız; yerel ad eşleşir) -------------------
    private static boolean is(Node n, String local) {
        if (n.getNodeType() != Node.ELEMENT_NODE) return false;
        String ln = n.getLocalName();
        if (ln == null) { ln = n.getNodeName(); int i = ln.indexOf(':'); if (i >= 0) ln = ln.substring(i + 1); }
        if (!local.equals(ln)) return false;
        String ns = n.getNamespaceURI();
        return ns == null || ns.isEmpty() || "DAV:".equals(ns);
    }
    private static List<Element> children(Element e, String local) {
        List<Element> out = new ArrayList<>();
        NodeList nl = e.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) if (is(nl.item(i), local)) out.add((Element) nl.item(i));
        return out;
    }
    private static Element first(Element e, String local) {
        NodeList nl = e.getChildNodes();
        for (int i = 0; i < nl.getLength(); i++) if (is(nl.item(i), local)) return (Element) nl.item(i);
        return null;
    }
    private static String text(Element e) { String t = e.getTextContent(); return t == null ? "" : t; }
}
