import java.io.File;
import java.io.OutputStream;
import java.lang.reflect.Method;

/*
 * Rar4.java (uygulama paketinde, paket görünürlüğünde) sınamadan çağrılabilsin diye küçük köprü.
 * Sınıfı yansımayla (reflection) açar; junrar sınıf yolunda değilse çağrı hiç yapılmaz.
 */
final class Rar4Bridge {
    private Rar4Bridge() { }
    static boolean extract(File archive, String entry, OutputStream out) throws Exception {
        Class<?> c = Class.forName("com.mahmuttari.dwgviewer.Rar4");
        Method m = c.getDeclaredMethod("extract", File.class, String.class, OutputStream.class);
        m.setAccessible(true);
        return (Boolean) m.invoke(null, archive, entry, out);
    }
}
