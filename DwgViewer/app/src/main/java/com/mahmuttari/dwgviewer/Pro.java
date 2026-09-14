package com.mahmuttari.dwgviewer;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * Yetki (entitlement) deposu: SharedPreferences "pro" altında JSON
 * {tier:"adfree"|"premium"|"super", source:"play"|"license", name?, exp?, plan?}.
 *
 * İki kaynak vardır: Google Play aboneliği ("play"; her açılışta {@link Billing} yeniden doğrular, Play "yok"
 * derse silinir) ve çevrimdışı lisans kodu ("license"; bitiş tarihine kadar kalır, Play doğrulaması ona dokunmaz).
 * İkisi bir aradaysa yüksek olan geçerlidir — {@link #edition()} ikisinin en yükseğini döner, böylece Play
 * aboneliği biten ama süreli lisansı olan kullanıcı lisansının basamağına düşer, sıfıra değil.
 *
 * Yetki değişimini MainActivity JS'e onEdition(tier, reason) ile bildirir.
 */
public final class Pro {
    private static final String PREF = "pro", KEY_PLAY = "play", KEY_LICENSE = "license";
    private final SharedPreferences prefs;

    public Pro(Context ctx) { prefs = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE); }

    /** Kayıt (süresi dolmuşsa silinir ve null döner); key: KEY_PLAY | KEY_LICENSE */
    private JSONObject read(String key) {
        try {
            String s = prefs.getString(key, null);
            if (s == null) return null;
            JSONObject o = new JSONObject(s);
            long exp = o.optLong("exp", 0);
            if (exp != 0 && exp <= System.currentTimeMillis() / 1000L) { prefs.edit().remove(key).apply(); return null; }
            if (Tier.rank(o.optString("tier")) == 0) { prefs.edit().remove(key).apply(); return null; }
            return o;
        } catch (Exception e) { return null; }
    }

    /** Play kaynaklı kayıt ya da null */
    public JSONObject play() { return read(KEY_PLAY); }
    /** Lisans kaynaklı kayıt ya da null */
    public JSONObject license() { return read(KEY_LICENSE); }

    /** Geçerli basamak: iki kaynağın en yükseği ("free" | "adfree" | "premium" | "super") */
    public String edition() {
        JSONObject p = play(), l = license();
        return Tier.max(p == null ? Tier.FREE : p.optString("tier"), l == null ? Tier.FREE : l.optString("tier"));
    }

    /** Geçerli basamağı veren kayıt (panelde kaynak ve bitiş göstermek için) ya da null */
    public JSONObject current() {
        JSONObject p = play(), l = license();
        int rp = p == null ? 0 : Tier.rank(p.optString("tier"));
        int rl = l == null ? 0 : Tier.rank(l.optString("tier"));
        if (rp == 0 && rl == 0) return null;
        return rp >= rl ? p : l;
    }

    /** Yetki kaynağı: "play" | "license" | "none" */
    public String source() { JSONObject o = current(); return o == null ? "none" : o.optString("source", "none"); }

    /**
     * Kaydı yazar. tier free ise o kaynağın kaydı silinir. exp: bitiş epoch saniye ya da 0 (süresiz).
     * plan: "monthly" | "yearly" | "" (yalnız bilgi amaçlı, panelde gösterilir). Değişiklik olduysa true.
     */
    public boolean set(String source, String tier, String name, long exp, String plan) {
        String key = KEY_LICENSE.equals(source) ? KEY_LICENSE : KEY_PLAY;
        String t = Tier.norm(tier);
        if (Tier.FREE.equals(t)) return clear(key);
        try {
            JSONObject o = new JSONObject();
            o.put("tier", t);
            o.put("source", KEY_LICENSE.equals(source) ? KEY_LICENSE : KEY_PLAY);
            if (name != null && !name.isEmpty()) o.put("name", name);
            if (exp > 0) o.put("exp", exp);
            if (plan != null && !plan.isEmpty()) o.put("plan", plan);
            String s = o.toString();
            boolean changed = !s.equals(prefs.getString(key, null));
            prefs.edit().putString(key, s).apply();
            return changed;
        } catch (Exception e) { return false; }
    }

    /** Play kaynaklı yetkiyi siler (lisans kaynaklı kalır). Değişiklik olduysa true. */
    public boolean clearPlay() { return clear(KEY_PLAY); }

    private boolean clear(String key) {
        if (prefs.getString(key, null) == null) return false;
        prefs.edit().remove(key).apply();
        return true;
    }

    /** Süreli kayıtların en yakın bitişi (epoch saniye) ya da 0 — MainActivity bitiş anını buna göre planlar */
    public long nextExpiry() {
        long best = 0;
        for (JSONObject o : new JSONObject[]{ play(), license() }) {
            if (o == null) continue;
            long e = o.optLong("exp", 0);
            if (e > 0 && (best == 0 || e < best)) best = e;
        }
        return best;
    }
}
