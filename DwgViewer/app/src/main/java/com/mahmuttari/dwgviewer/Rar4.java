package com.mahmuttari.dwgviewer;

import com.github.junrar.Archive;
import com.github.junrar.rarfile.FileHeader;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/*
 * RAR 2/3/4 ÇIKARMA (junrar) — KATI (SOLID) ARŞİV DESTEĞİYLE.
 *
 * NEDEN AYRI DOSYA
 *   junrar'ın Archive.extractFile'ı katı arşivde bir girdiyi TEK BAŞINA açamaz: çözücü penceresi
 *   yalnız zincir baştan sırayla işlendiğinde dolar, doğrudan çağrıda "window is null" ile düşer.
 *   (rar 6.12 ile üretilmiş katı bir RAR4 arşivinde doğrulandı.) Burada AutoCAD tarafındaki
 *   Rar5.extract ile aynı kural uygulanır: hedeften geriye katı olmayan ilk girdiye yürünür ve
 *   zincir TEK Archive örneğiyle sırayla açılır; hedeften önceki çıktılar atılır.
 *
 *   Sınıf Android'e bağlı değildir (yalnız junrar), böylece JVM sınamasından da koşar:
 *   tools/test_rar5.sh, junrar jar'ı Gradle önbelleğinde bulursa RAR4 denetimlerini de çalıştırır.
 */
final class Rar4 {
    private Rar4() { }

    /** Çıktıyı yutan akış: zincirde hedeften önceki girdiler yalnız pencereyi doldurur */
    private static final OutputStream SINK = new OutputStream() {
        @Override public void write(int b) { }
        @Override public void write(byte[] b, int off, int len) { }
    };

    /** Girdiyi çıkarır; katı arşivde zincirin başından başlar. Bulunamazsa false döner. */
    static boolean extract(File file, String entryName, OutputStream out) throws Exception {
        String want = entryName == null ? "" : entryName.replace('\\', '/');
        try (Archive archive = new Archive(file)) {
            List<FileHeader> headers = new ArrayList<>();
            for (FileHeader h : archive.getFileHeaders()) if (!h.isDirectory()) headers.add(h);
            int target = -1;
            for (int i = 0; i < headers.size(); i++)
                if (headers.get(i).getFileName().replace('\\', '/').equals(want)) { target = i; break; }
            if (target < 0) return false;
            int start = target;
            while (start > 0 && headers.get(start).isSolid()) start--;
            if (headers.get(start).isSolid())
                throw new IOException("Katı (solid) zincirin başlangıcı bu dosyada yok; çok parçalı arşivin ilk parçasıyla birlikte açın");
            for (int i = start; i <= target; i++) archive.extractFile(headers.get(i), i == target ? out : SINK);
            return true;
        }
    }
}
