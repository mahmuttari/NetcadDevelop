package com.mahmuttari.dwgviewer;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

import org.json.JSONObject;

/**
 * Sahip (geliştirici) hesabı: Google ile giriş yapılan hesap bu listedeyse bütün özellikler açılır.
 * Amaç, uygulamanın sahibinin kendi cihazında ücretli özellikleri satın almadan denemesidir.
 *
 * <h3>E-posta neden düz yazılmıyor</h3>
 * APK herkese açıktır ve içindeki dizgeler {@code strings} ile okunur; adres düz yazılsaydı sahibin
 * kişisel e-postası binary'den toplanabilirdi. Adres yerine SHA-256 <b>özeti</b> gömülür:
 * karşılaştırma aynı işi görür, adres okunamaz.
 *
 * <h3>Gmail eşleştirmesi</h3>
 * Gmail, yerel kısımdaki noktaları ve "+etiket" ekini yok sayar; {@code m.a.h@gmail.com},
 * {@code mah+deneme@gmail.com} ve {@code mah@googlemail.com} aynı kutuya düşer. Özet alınmadan önce
 * adres bu kurala göre sadeleştirilir — yoksa kullanıcı aynı hesapla girdiği hâlde eşleşme kaçardı.
 * Öteki alan adlarında yalnız kırpma ve küçük harfe çevirme yapılır (nokta orada anlamlıdır).
 *
 * <h3>Sınır — dürüstçe</h3>
 * Bu bir KOLAYLIKTIR, güvenlik sınırı DEĞİLDİR. İstemci tarafındaki her kapı gibi APK'yı yamalayan
 * biri tarafından aşılabilir; zaten uygulamanın bütün yetki kapıları istemcidedir. Gerçek gelir
 * koruması Play aboneliği ve imzalı çevrimdışı lisans koduyla sağlanır. Buradaki liste yalnız
 * sahibin kendi hesabını tanır ve başka hiçbir hesaba bir şey açmaz.
 */
public final class Owner {
    /** Sadeleştirilmiş adreslerin SHA-256 özetleri (küçük harf onaltılık) */
    private static final String[] HASHES = {
        "c1229a408b05e41c6284ff502bf63abf045fcf74ac79bacff88771d1743fd578",   // uygulama sahibi
    };

    private Owner() { }

    /** Sahip hesabına verilen basamak: en üst paket */
    public static final String TIER = Tier.SUPER;
    /** Yetki kaynağı adı (Pro / proInfo / JS paneli bunu görür) */
    public static final String SOURCE = "owner";

    /** Adresi karşılaştırılabilir biçime getirir; boş / bozuk girdide "" döner. */
    public static String canon(String email) {
        if (email == null) return "";
        String e = email.trim().toLowerCase(Locale.ROOT);
        int at = e.indexOf('@');
        if (at <= 0 || at == e.length() - 1) return "";
        String local = e.substring(0, at), domain = e.substring(at + 1);
        if (domain.equals("gmail.com") || domain.equals("googlemail.com")) {
            int plus = local.indexOf('+');
            if (plus >= 0) local = local.substring(0, plus);
            local = local.replace(".", "");
            domain = "gmail.com";
        }
        return local.isEmpty() ? "" : local + "@" + domain;
    }

    /** Adres sahip listesinde mi? */
    public static boolean is(String email) {
        String c = canon(email);
        if (c.isEmpty()) return false;
        String h = sha256(c);
        if (h.isEmpty()) return false;
        boolean match = false;
        // Sabit süre değil ama gizli bir sır da yok: liste özet, girdi kullanıcının kendi adresi.
        for (String k : HASHES) if (k.equalsIgnoreCase(h)) match = true;
        return match;
    }

    /** Google profil JSON'undan ("{...\"email\":\"...\"}") adresi çıkarır; yoksa "" */
    public static String emailOf(String userJson) {
        if (userJson == null || userJson.isEmpty()) return "";
        try { return new JSONObject(userJson).optString("email", ""); } catch (Exception e) { return ""; }
    }

    private static String sha256(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
            return sb.toString();
        } catch (Exception e) { return ""; }
    }
}
