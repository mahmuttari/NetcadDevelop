import com.mahmuttari.dwgviewer.Rar5;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/*
 * Rar5.java sınaması (JVM; tarayıcı sınamalarından ayrıdır, javac ile koşar).
 *
 * corpus/ altındaki arşivler rar 7.12 (RAR5) ve rar 6.12 (RAR4) ile üretilmiştir; corpus.tsv her
 * girdinin açılmış boyunu ve MD5'ini taşır. Sınama arşivi listeler, her girdiyi açar, boyu ve MD5'i
 * karşılaştırır (Rar5 ayrıca arşivin kendi CRC32'sini doğrular). "!" ile başlayan satırlar hata
 * beklenen arşivlerdir (şifreli, başlığı şifreli, çok parçalı); "?" satırı RAR5 olmayan arşivin
 * imza denetiminden geçmediğini sınar — o dosya junrar yoluna gitmelidir.
 *
 * Koşum: tools/test_rar5.sh
 */
public class Rar5Test {
    static int pass, fail;
    static void ok(String t, boolean c, String d) {
        System.out.println((c ? "PASS " : "FAIL ") + t + (d == null || d.isEmpty() ? "" : "  " + d));
        if (c) pass++; else fail++;
    }
    static String md5(byte[] b) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (byte x : MessageDigest.getInstance("MD5").digest(b)) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    public static void main(String[] args) throws Exception {
        File dir = new File(args.length > 0 ? args[0] : "tools/rar5");
        File corpus = new File(dir, "corpus");
        List<String> lines = Files.readAllLines(new File(dir, "corpus.tsv").toPath(), StandardCharsets.UTF_8);

        Map<String, List<String[]>> want = new LinkedHashMap<>();
        Map<String, List<String[]>> want4 = new LinkedHashMap<>();   // "4" öneki: RAR 2/3/4 (junrar yolu)
        List<String[]> errs = new ArrayList<>();
        List<String> notRar5 = new ArrayList<>();
        for (String line : lines) {
            if (line.isEmpty() || line.startsWith("#")) continue;
            if (line.startsWith("!")) { String[] p = line.substring(1).split("\t"); errs.add(p); continue; }
            if (line.startsWith("?")) { notRar5.add(line.substring(1).trim()); continue; }
            boolean r4 = line.startsWith("4");
            String[] p = (r4 ? line.substring(1) : line).split("\t");
            if (p.length < 4) continue;
            (r4 ? want4 : want).computeIfAbsent(p[0], k -> new ArrayList<>()).add(new String[]{ p[1], p[2], p[3] });
        }

        for (Map.Entry<String, List<String[]>> e : want.entrySet()) {
            File arc = new File(corpus, e.getKey());
            ok(e.getKey() + " · imza RAR5", Rar5.isRar5(arc), "");
            Rar5.Info info;
            try { info = Rar5.read(arc); } catch (Exception ex) { ok(e.getKey() + " · liste", false, ex.toString()); continue; }
            List<String> names = new ArrayList<>();
            for (Rar5.Entry en : info.entries) if (!en.dir) names.add(en.name);
            List<String> expect = new ArrayList<>();
            for (String[] w : e.getValue()) expect.add(w[0]);
            ok(e.getKey() + " · liste (" + expect.size() + " girdi, adlar ve sıra)", names.equals(expect), names.toString());
            for (String[] w : e.getValue()) {
                Rar5.Entry target = null;
                for (Rar5.Entry en : info.entries) if (en.name.equals(w[0])) { target = en; break; }
                if (target == null) { ok(e.getKey() + " » " + w[0], false, "girdi yok"); continue; }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                long t0 = System.currentTimeMillis();
                try { Rar5.extract(arc, info, target, out); }
                catch (Exception ex) { ok(e.getKey() + " » " + w[0], false, "hata: " + ex); continue; }
                byte[] got = out.toByteArray();
                String md5 = md5(got);
                boolean good = got.length == Long.parseLong(w[1]) && md5.equals(w[2]) && target.size == got.length;
                ok(e.getKey() + " » " + w[0], good,
                   got.length + " bayt · m" + target.method + (target.solid ? " · katı" : "")
                   + " · sözlük " + (target.winSize >> 10) + "K · " + (System.currentTimeMillis() - t0) + " ms"
                   + (good ? "" : " · MD5 " + md5 + " ≠ " + w[2] + " (boy " + w[1] + ")"));
            }
        }

        for (String[] er : errs) {
            File arc = new File(corpus, er[0]);
            String msg = "";
            boolean threw = false;
            try {
                Rar5.Info info = Rar5.read(arc);
                if (info.entries.isEmpty()) { msg = info.headerEncrypted ? "Şifreli başlık" : "girdi yok"; threw = info.headerEncrypted; }
                for (Rar5.Entry en : info.entries) {
                    if (en.dir) continue;
                    try { Rar5.extract(arc, info, en, new ByteArrayOutputStream()); }
                    catch (Exception ex) { threw = true; msg = String.valueOf(ex.getMessage()); break; }
                }
            } catch (Exception ex) { threw = true; msg = String.valueOf(ex.getMessage()); }
            ok(er[0] + " · açık hata iletisi", threw && msg.contains(er[1]), msg);
        }

        for (String n : notRar5) {
            File arc = new File(corpus, n);
            byte[] head = Arrays.copyOf(Files.readAllBytes(arc.toPath()), 8);
            ok(n + " · RAR5 değil (junrar yoluna gider)", !Rar5.isRar5(arc),
               "imza " + String.format("%02x%02x", head[6], head[7]));
        }

        // RAR 2/3/4 (junrar): yalnız kitaplık sınıf yolundaysa; katı arşivde Rar4.java zinciri sınanır
        boolean haveJunrar = true;
        try { Class.forName("com.github.junrar.Archive"); } catch (Throwable t) { haveJunrar = false; }
        if (!haveJunrar) System.out.println("ATLA  RAR 2/3/4 denetimleri (junrar sınıf yolunda yok)");
        else for (Map.Entry<String, List<String[]>> e : want4.entrySet()) {
            File arc = new File(corpus, e.getKey());
            for (String[] w : e.getValue()) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                boolean found;
                try { found = Rar4Bridge.extract(arc, w[0], out); }
                catch (Exception ex) { ok(e.getKey() + " » " + w[0], false, "hata: " + ex); continue; }
                byte[] got = out.toByteArray();
                String md5 = md5(got);
                boolean good = found && got.length == Long.parseLong(w[1]) && md5.equals(w[2]);
                ok(e.getKey() + " » " + w[0] + " (RAR4)", good,
                   got.length + " bayt" + (good ? "" : " · MD5 " + md5 + " ≠ " + w[2] + " (boy " + w[1] + ")"));
            }
        }

        System.out.println("\nSONUÇ: " + pass + " geçti, " + fail + " kaldı");
        System.exit(fail == 0 ? 0 : 1);
    }
}
