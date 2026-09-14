package com.mahmuttari.dwgviewer;

/**
 * Yetki basamakları. Sıra bağlayıcıdır: free &lt; adfree &lt; premium &lt; super.
 *
 * Kullanıcı birden çok abonelik taşıyabilir (örneğin Ad-Free'yi bırakmadan Premium alırsa); geçerli yetki
 * her zaman sahip olunanların EN YÜKSEĞİdir, bunu {@link #max(String, String)} belirler. Basamak adları
 * JS tarafıyla birebir aynıdır (edition.js TIERS) ve köprüden dizge olarak geçer.
 */
public final class Tier {
    public static final String FREE = "free";
    public static final String ADFREE = "adfree";
    public static final String PREMIUM = "premium";
    public static final String SUPER = "super";

    private Tier() { }

    /** Basamak sırası; tanınmayan değer free sayılır (eski kayıt, bozuk tercih) */
    public static int rank(String t) {
        if (SUPER.equals(t)) return 3;
        if (PREMIUM.equals(t)) return 2;
        if (ADFREE.equals(t)) return 1;
        return 0;
    }

    /** Tanınan bir basamak adı ya da free */
    public static String norm(String t) { return rank(t) == 0 ? FREE : t; }

    /** İkisinden yüksek olanı */
    public static String max(String a, String b) { return rank(a) >= rank(b) ? norm(a) : norm(b); }

    /** Play abonelik ürün kimliğinden basamak; tanınmayan ürün free döner */
    public static String ofSku(String sku) {
        if (sku == null) return FREE;
        if (sku.equals(BuildConfig.SKU_SUPER)) return SUPER;
        if (sku.equals(BuildConfig.SKU_PREMIUM)) return PREMIUM;
        if (sku.equals(BuildConfig.SKU_ADFREE)) return ADFREE;
        return FREE;
    }

    /** Basamağın Play abonelik ürün kimliği; free için "" */
    public static String sku(String tier) {
        if (SUPER.equals(tier)) return BuildConfig.SKU_SUPER;
        if (PREMIUM.equals(tier)) return BuildConfig.SKU_PREMIUM;
        if (ADFREE.equals(tier)) return BuildConfig.SKU_ADFREE;
        return "";
    }

    /** Reklam yalnız hiçbir aboneliği olmayanda gösterilir */
    public static boolean showsAds(String tier) { return rank(tier) == 0; }
}
