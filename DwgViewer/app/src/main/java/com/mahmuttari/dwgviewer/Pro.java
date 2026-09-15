package com.mahmuttari.dwgviewer;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * Yetki (entitlement) deposu: SharedPreferences "pro" altında JSON
 * {tier:"adfree"|"premium"|"super", source:"play"|"license", name?, exp?, plan?}.
 *
 * Üç kaynak vardır: Google Play aboneliği ("play"; her açılışta {@link Billing} yeniden doğrular, Play "yok"
 * derse silinir), çevrimdışı lisans kodu ("license"; bitiş tarihine kadar kalır, Play doğrulaması ona dokunmaz)
 * ve sahip hesabı ("owner"; Google ile giriş yapılan hesap {@link Owner} listesindeyse verilir, çıkışta silinir).
 * Birkaçı bir aradaysa yüksek olan geçerlidir — {@link #edition()} en yükseğini döner, böylece Play aboneliği
 * biten ama süreli lisansı olan kullanıcı lisansının basamağına düşer, sıfıra değil.
 *
 * Yetki değişimini MainActivity JS'e onEdition(tier, reason) ile bildirir.
 */
public final class Pro {
    private static final String PREF = "pro", KEY_PLAY = "play", KEY_LICENSE = "license", KEY_OWNER = "owner";
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
    /** Sahip hesabı kaynaklı kayıt ya da null */
    public JSONObject owner() { return read(KEY_OWNER); }

    /** Geçerli basamak: üç kaynağın en yükseği ("free" | "adfree" | "premium" | "super") */
    public String edition() {
        JSONObject p = play(), l = license(), w = owner();
        String t = Tier.max(p == null ? Tier.FREE : p.optString("tier"), l == null ? Tier.FREE : l.optString("tier"));
        return Tier.max(t, w == null ? Tier.FREE : w.optString("tier"));
    }

    /**
     * Geçerli basamağı veren kayıt (panelde kaynak ve bitiş göstermek için) ya da null.
     * Eşitlikte sıra play &gt; license &gt; owner: gerçekten ödenmiş bir yetki varsa panel onu gösterir,
     * sahip hesabı kolaylığı satın almanın önüne geçmez.
     */
    public JSONObject current() {
        JSONObject[] src = { play(), license(), owner() };
        JSONObject best = null;
        int bestRank = 0;
        for (JSONObject o : src) {
            int r = o == null ? 0 : Tier.rank(o.optString("tier"));
            if (r > bestRank) { bestRank = r; best = o; }
        }
        return best;
    }

    /** Yetki kaynağı: "play" | "license" | "none" */
    public String source() { JSONObject o = current(); return o == null ? "none" : o.optString("source", "none"); }

    /**
     * Kaydı yazar. tier free ise o kaynağın kaydı silinir. exp: bitiş epoch saniye ya da 0 (süresiz).
     * plan: "monthly" | "yearly" | "" (yalnız bilgi amaçlı, panelde gösterilir). Değişiklik olduysa true.
     */
    public boolean set(String source, String tier, String name, long exp, String plan) {
        String key = KEY_LICENSE.equals(source) ? KEY_LICENSE : KEY_OWNER.equals(source) ? KEY_OWNER : KEY_PLAY;
        String t = Tier.norm(tier);
        if (Tier.FREE.equals(t)) return clear(key);
        try {
            JSONObject o = new JSONObject();
            o.put("tier", t);
            o.put("source", key);
            if (name != null && !name.isEmpty()) o.put("name", name);
            if (exp > 0) o.put("exp", exp);
            if (plan != null && !plan.isEmpty()) o.put("plan", plan);
            String s = o.toString();
            boolean changed = !s.equals(prefs.getString(key, null));
            prefs.edit().putString(key, s).apply();
            return changed;
        } catch (Exception e) { return false; }
    }

    /** Play kaynaklı yetkiyi siler (lisans ve sahip kaynaklı kalır). Değişiklik olduysa true. */
    public boolean clearPlay() { return clear(KEY_PLAY); }

    /** Sahip hesabı yetkisini siler (Google oturumu kapanınca). Değişiklik olduysa true. */
    public boolean clearOwner() { return clear(KEY_OWNER); }

    private boolean clear(String key) {
        if (prefs.getString(key, null) == null) return false;
        prefs.edit().remove(key).apply();
        return true;
    }

    /** Süreli kayıtların en yakın bitişi (epoch saniye) ya da 0 — MainActivity bitiş anını buna göre planlar */
    public long nextExpiry() {
        long best = 0;
        for (JSONObject o : new JSONObject[]{ play(), license(), owner() }) {
            if (o == null) continue;
            long e = o.optLong("exp", 0);
            if (e > 0 && (best == 0 || e < best)) best = e;
        }
        return best;
    }
}
