package com.mahmuttari.dwgviewer;

import android.app.Activity;

/** Pro çeşit: reklam yok. Ücretsiz çeşitteki Ads (src/free) ile aynı imza; her çağrı boşa düşer. */
public class Ads {
    public interface Done { void done(boolean shown); }
    public Ads(Activity act) { }
    public void init() { }
    public boolean ready() { return false; }
    public void show(String reason, Done cb) { cb.done(false); }
    public void destroy() { }
}
