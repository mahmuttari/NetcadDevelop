package com.mahmuttari.dwgviewer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import com.github.junrar.Archive;
import com.github.junrar.exception.UnsupportedRarEncryptedException;
import com.github.junrar.exception.UnsupportedRarV5Exception;
import com.github.junrar.rarfile.FileHeader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Belge hizmetleri: dosya kaydı (id → File), PDF sayfa çizimi (PdfRenderer), ZIP ve RAR arşivleri.
 *
 *  - Kayıt: WebView'e sunulan her belge bir "f_<n>" kimliği alır; /file/f_<n> ile akıtılır.
 *  - PDF: /file/pdfpage_<id>_<sayfa>_<genişlik> → sayfa görüntüsü (PNG). Sayfa boyutları pdfInfo ile.
 *  - ZIP: java.util.zip; RAR: junrar (RAR 2/3/4; RAR5 desteklenmez). Çıkarılan girdiler yine kayıt alır.
 */
public class Docs {
    private static final String TAG = "DwgViewer.Docs";
    private final Context ctx;
    private final Map<String, File> files = new LinkedHashMap<>();
    private final Map<String, String> names = new HashMap<>();
    private int seq = 0;
    private final Object pdfLock = new Object();
    private String pdfOpenId;
    private PdfRenderer pdf;
    private ParcelFileDescriptor pdfFd;

    public Docs(Context ctx) { this.ctx = ctx; }

    // ---- kayıt ---------------------------------------------------------------------------
    public synchronized String register(File f, String name) {
        for (Map.Entry<String, File> e : files.entrySet()) if (e.getValue().equals(f)) { names.put(e.getKey(), name); return e.getKey(); }
        String id = "f_" + (++seq);
        files.put(id, f); names.put(id, name == null ? f.getName() : name);
        return id;
    }
    public synchronized File file(String id) { return files.get(id); }
    private synchronized boolean registered(File f) { return files.containsValue(f); }
    public synchronized String name(String id) { String n = names.get(id); return n == null ? "" : n; }

    public File cacheDir(String sub) {
        File d = new File(ctx.getCacheDir(), sub);
        if (!d.exists()) d.mkdirs();
        return d;
    }
    public static String safe(String s) { return s.replaceAll("[^A-Za-z0-9._\\-]", "_"); }
    public static String ext(String name) { int i = name.lastIndexOf('.'); return i < 0 ? "" : name.substring(i + 1).toLowerCase(); }

    /** Akışı önbelleğe kopyalar ve kaydeder; JSON {id,name,size,ext} döner */
    public JSONObject importStream(InputStream in, String name) throws Exception {
        File f = new File(cacheDir("docs"), System.currentTimeMillis() + "_" + safe(name));
        try (OutputStream out = new FileOutputStream(f)) { copy(in, out); }
        return info(register(f, name));
    }
    public JSONObject info(String id) throws Exception {
        File f = file(id);
        JSONObject o = new JSONObject();
        o.put("id", id); o.put("name", name(id)); o.put("size", f == null ? 0 : f.length()); o.put("ext", ext(name(id)));
        return o;
    }
    static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    // ---- PDF -----------------------------------------------------------------------------
    private void openPdf(String id) throws IOException {
        if (id.equals(pdfOpenId) && pdf != null) return;
        closePdf();
        File f = file(id);
        if (f == null) throw new IOException("belge yok: " + id);
        pdfFd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        pdf = new PdfRenderer(pdfFd);
        pdfOpenId = id;
    }
    public void closePdf() {
        synchronized (pdfLock) { // süren bir sayfa çiziminin (pdfPage) ortasında kapatılmasın
            try { if (pdf != null) pdf.close(); } catch (Exception ignored) { }
            try { if (pdfFd != null) pdfFd.close(); } catch (Exception ignored) { }
            pdf = null; pdfFd = null; pdfOpenId = null;
        }
    }
    /** {pages, sizes:[[w,h],…] (nokta)} */
    public String pdfInfo(String id) {
        synchronized (pdfLock) {
            try {
                openPdf(id);
                JSONObject o = new JSONObject();
                int n = pdf.getPageCount();
                o.put("pages", n);
                JSONArray sizes = new JSONArray();
                for (int i = 0; i < n; i++) {
                    try (PdfRenderer.Page p = pdf.openPage(i)) { sizes.put(new JSONArray().put(p.getWidth()).put(p.getHeight())); }
                }
                o.put("sizes", sizes);
                return o.toString();
            } catch (SecurityException e) {
                return "{\"error\":\"Şifreli PDF açılamıyor\"}";
            } catch (Exception e) {
                Log.w(TAG, "pdfInfo", e);
                return "{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
        }
    }
    /** Sayfayı verilen piksel genişliğinde çizer; PNG bayt dizisi */
    public byte[] pdfPage(String id, int index, int width) throws IOException {
        synchronized (pdfLock) {
            openPdf(id);
            if (index < 0 || index >= pdf.getPageCount()) throw new IOException("sayfa yok");
            try (PdfRenderer.Page p = pdf.openPage(index)) {
                int w = Math.max(64, Math.min(4096, width));
                int h = Math.max(1, Math.round((float) w * p.getHeight() / p.getWidth()));
                Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                Canvas c = new Canvas(bmp); c.drawColor(Color.WHITE);
                p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                ByteArrayOutputStream out = new ByteArrayOutputStream(w * h / 4);
                bmp.compress(w > 1800 ? Bitmap.CompressFormat.JPEG : Bitmap.CompressFormat.PNG, 92, out);
                bmp.recycle();
                return out.toByteArray();
            }
        }
    }

    // ---- arşivler ------------------------------------------------------------------------
    /** JSON [{name,size,dir,time}] — ZIP ya da RAR (uzantıya değil içeriğe bakılır) */
    public String arcList(String id) {
        File f = file(id);
        if (f == null) return "{\"error\":\"dosya yok\"}";
        try {
            JSONArray arr = new JSONArray();
            if (isRar(f)) {
                if (isRar5(f)) return "{\"error\":\"" + RAR5_MSG + "\"}";
                try (Archive a = new Archive(f)) {
                    if (a.isEncrypted()) return "{\"error\":\"Şifreli RAR desteklenmiyor\"}";
                    // junrar yapıcısı RAR5/şifreli dışındaki hataları yutup boş liste döndürür
                    if (a.getFileHeaders().isEmpty()) return "{\"error\":\"Arşiv okunamadı (bozuk ya da desteklenmeyen RAR)\"}";
                    for (FileHeader h : a.getFileHeaders()) {
                        JSONObject o = new JSONObject();
                        o.put("name", h.getFileName().replace('\\', '/')); o.put("size", h.getFullUnpackSize()); o.put("dir", h.isDirectory());
                        o.put("time", h.getMTime() == null ? 0 : h.getMTime().getTime());
                        arr.put(o);
                    }
                }
            } else {
                try (ZipFile z = new ZipFile(f)) {
                    Enumeration<? extends ZipEntry> en = z.entries();
                    while (en.hasMoreElements()) {
                        ZipEntry e = en.nextElement();
                        JSONObject o = new JSONObject();
                        o.put("name", e.getName()); o.put("size", e.getSize()); o.put("dir", e.isDirectory()); o.put("time", e.getTime());
                        arr.put(o);
                    }
                }
            }
            return arr.toString();
        } catch (UnsupportedRarV5Exception e) {
            return "{\"error\":\"" + RAR5_MSG + "\"}";
        } catch (UnsupportedRarEncryptedException e) {
            return "{\"error\":\"Şifreli RAR desteklenmiyor\"}";
        } catch (Exception e) {
            Log.w(TAG, "arcList", e);
            return "{\"error\":" + JSONObject.quote(msgOf(e)) + "}";
        }
    }
    /** Girdiyi önbelleğe çıkarır ve kaydeder; JSON {id,name,size,ext} */
    public String arcExtract(String id, String entry) {
        File f = file(id);
        if (f == null) return "{\"error\":\"dosya yok\"}";
        String base = entry.replace('\\', '/');
        String name = base.substring(base.lastIndexOf('/') + 1);
        File out = new File(cacheDir("extract"), id + "_" + safe(base));
        try {
            if (isRar(f)) {
                if (isRar5(f)) return "{\"error\":\"" + RAR5_MSG + "\"}";
                try (Archive a = new Archive(f)) {
                    for (FileHeader h : a.getFileHeaders()) {
                        if (h.getFileName().replace('\\', '/').equals(base)) {
                            try (OutputStream os = new FileOutputStream(out)) { a.extractFile(h, os); }
                            return info(register(out, name)).toString();
                        }
                    }
                }
            } else {
                try (ZipFile z = new ZipFile(f)) {
                    ZipEntry e = z.getEntry(base);
                    if (e != null) {
                        try (InputStream in = z.getInputStream(e); OutputStream os = new FileOutputStream(out)) { copy(in, os); }
                        return info(register(out, name)).toString();
                    }
                }
            }
            return "{\"error\":\"girdi bulunamadı\"}";
        } catch (UnsupportedRarV5Exception e) {
            return "{\"error\":\"" + RAR5_MSG + "\"}";
        } catch (UnsupportedRarEncryptedException e) {
            return "{\"error\":\"Şifreli RAR desteklenmiyor\"}";
        } catch (Exception e) {
            Log.w(TAG, "arcExtract", e);
            return "{\"error\":" + JSONObject.quote(msgOf(e)) + "}";
        }
    }
    private static final String RAR5_MSG = "RAR5 biçimi desteklenmiyor; arşivi RAR4 ya da ZIP olarak yeniden sıkıştırın.";
    /** İletisi olmayan istisnalar (junrar'ın UnsupportedRarV5Exception'ı gibi) 'null' yerine sınıf adıyla döner */
    private static String msgOf(Exception e) { return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(); }
    private static boolean isRar(File f) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[7]; int n = in.read(b);
            return n >= 6 && b[0] == 'R' && b[1] == 'a' && b[2] == 'r' && b[3] == '!' && b[4] == 0x1A && b[5] == 0x07;
        } catch (IOException e) { return false; }
    }
    /** RAR5 imzası: "Rar!" 1A 07 01 00 (RAR4: "Rar!" 1A 07 00) */
    private static boolean isRar5(File f) {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[8]; int n = in.read(b);
            return n >= 8 && b[0] == 'R' && b[1] == 'a' && b[2] == 'r' && b[3] == '!' && b[4] == 0x1A && b[5] == 0x07 && b[6] == 0x01 && b[7] == 0x00;
        } catch (IOException e) { return false; }
    }

    /** Eski önbellek dosyalarını temizler (7 günden eski) */
    public void sweep() {
        long cut = System.currentTimeMillis() - 7L * 24 * 3600 * 1000;
        for (String sub : new String[]{"docs", "extract", "drive"}) {
            File[] fs = cacheDir(sub).listFiles();
            if (fs != null) for (File f : fs) if (f.lastModified() < cut && !registered(f)) f.delete();
        }
    }
}
