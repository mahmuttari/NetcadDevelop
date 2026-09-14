package com.mahmuttari.dwgviewer;

import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;

/**
 * Çevrimdışı Pro lisans kodu doğrulaması.
 *
 * Kod biçimi: "DWGPRO-" + base64url(payload) + "." + base64url(imza). payload UTF-8 JSON
 * {"p":"<basamak>","n":"<lisans sahibi adı>","e":<bitiş epoch saniye ya da 0>}; basamak
 * "adfree" | "premium" | "super". Eski kodlardaki "dwg_pro" değeri "super" sayılır. İmza RSA-2048 SHA256withRSA ile
 * base64url(payload) DİZESİNİN UTF-8 baytları üzerinden alınır (tools/license_gen.mjs aynı baytları imzalar; JSON
 * yeniden serileştirilmez, böylece anahtar sırası ya da boşluk farkı imzayı bozmaz). Açık anahtar
 * BuildConfig.LICENSE_PUBLIC_KEY (Base64 X.509 SubjectPublicKeyInfo); boşsa özellik kapalıdır ve her kod reddedilir.
 */
public final class License {
    private static final String PREFIX = "DWGPRO-";

    private License() { }

    /** payload'daki p alanını basamağa çevirir; eski tek ürünlü kodlar (dwg_pro) tam yetki sayılır */
    private static String tierOf(String p) {
        if (p == null) return Tier.FREE;
        if ("dwg_pro".equals(p) || "pro".equals(p)) return Tier.SUPER;
        return Tier.norm(p);
    }

    /** Açık anahtar tanımlı mı (lisans kodu özelliği açık mı)? */
    public static boolean enabled() { return BuildConfig.LICENSE_PUBLIC_KEY != null && !BuildConfig.LICENSE_PUBLIC_KEY.isEmpty(); }

    /**
     * Kodu doğrular: imza açık anahtarla, p tanınan bir basamak, e == 0 ya da e > şimdi.
     * @return payload JSON'u (p basamağa normalleştirilmiş, n, e) ya da null (geçersiz / süresi dolmuş / kapalı)
     */
    public static JSONObject verify(String code) {
        if (!enabled() || code == null) return null;
        try {
            String c = code.trim();
            if (!c.startsWith(PREFIX)) return null;
            c = c.substring(PREFIX.length());
            int dot = c.indexOf('.');
            if (dot <= 0 || dot == c.length() - 1) return null;
            String payloadB64 = c.substring(0, dot), sigB64 = c.substring(dot + 1);

            PublicKey pub = KeyFactory.getInstance("RSA").generatePublic(
                new X509EncodedKeySpec(Base64.decode(BuildConfig.LICENSE_PUBLIC_KEY, Base64.DEFAULT)));
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(pub);
            sig.update(payloadB64.getBytes(StandardCharsets.US_ASCII)); // base64url dizesi zaten ASCII; UTF-8 ile aynı baytlar
            if (!sig.verify(b64url(sigB64))) return null;

            JSONObject p = new JSONObject(new String(b64url(payloadB64), StandardCharsets.UTF_8));
            String tier = tierOf(p.optString("p"));
            if (Tier.FREE.equals(tier)) return null;
            p.put("p", tier);   // çağıran doğrudan basamağı okur
            long exp = p.optLong("e", 0);
            if (exp != 0 && exp <= System.currentTimeMillis() / 1000L) return null;
            return p;
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] b64url(String s) { return Base64.decode(s, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
}
