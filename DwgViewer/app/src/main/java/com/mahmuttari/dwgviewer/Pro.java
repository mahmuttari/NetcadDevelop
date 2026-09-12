package com.mahmuttari.dwgviewer;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * Pro yetkisi (entitlement) deposu: SharedPreferences "pro" altında JSON {source:"play"|"license", name?, exp?}.
 *
 * İki kaynak vardır: Google Play satın alması ("play"; her açılışta {@link Billing} yeniden doğrular, Play "yok"
 * derse silinir) ve çevrimdışı lisans kodu ("license"; bitiş tarihine kadar kalır, Play doğrulaması ona dokunmaz).
 * Yetki değişimini MainActivity JS'e onEdition(edition, reason) ile bildirir.
 */
public final class Pro {
    private static final String PREF = "pro", KEY = "entitlement";
    private final SharedPreferences prefs;

    public Pro(Context ctx) { prefs = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE); }

    /** Kayıtlı yetki (süresi dolmuş lisans kaydı yok sayılır ve silinir) ya da null */
    public JSONObject get() {
        try {
            String s = prefs.getString(KEY, null);
            if (s == null) return null;
            JSONObject o = new JSONObject(s);
            long exp = o.optLong("exp", 0);
            if (exp != 0 && exp <= System.currentTimeMillis() / 1000L) { clear(); return null; }
            return o;
        } catch (Exception e) { return null; }
    }

    /** "pro" | "free" — o anki yetki */
    public String edition() { return get() != null ? "pro" : "free"; }

    /** Yetki kaynağı: "play" | "license" | "none" */
    public String source() { JSONObject o = get(); return o == null ? "none" : o.optString("source", "none"); }

    /** Yetkiyi yazar. exp: bitiş epoch saniye ya da 0 (süresiz). Değişiklik olduysa true. */
    public boolean set(String source, String name, long exp) {
        try {
            JSONObject o = new JSONObject();
            o.put("source", source);
            if (name != null && !name.isEmpty()) o.put("name", name);
            if (exp > 0) o.put("exp", exp);
            String s = o.toString();
            boolean changed = !s.equals(prefs.getString(KEY, null));
            prefs.edit().putString(KEY, s).apply();
            return changed;
        } catch (Exception e) { return false; }
    }

    /** Play kaynaklı yetkiyi siler (lisans kaynaklı kalır). Değişiklik olduysa true. */
    public boolean clearPlay() {
        JSONObject o = get();
        if (o == null || !"play".equals(o.optString("source"))) return false;
        clear();
        return true;
    }

    private void clear() { prefs.edit().remove(KEY).apply(); }
}
