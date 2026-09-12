package com.mahmuttari.dwgviewer;

import android.app.Activity;
import android.os.SystemClock;
import android.util.Log;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.interstitial.InterstitialAd;
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

/**
 * AdMob geçiş reklamı (interstitial); yalnız Pro yetkisi olmayan kullanıcıya.
 *
 * Akış: init() → UMP rıza bilgisi güncellenir, gerekiyorsa rıza formu gösterilir → canRequestAds olunca
 * MobileAds arka planda başlatılır ve ilk reklam ön yüklenir. show(reason, cb): yüklü reklam varsa gösterir,
 * kapanınca bir sonrakini yükler ve cb.done(true) der; yüklü değilse cb.done(false) der ve yüklemeyi tetikler.
 * JS zamanlaması ne derse desin iki gösterim arasında en az {@link #MIN_GAP_MS} beklenir (AdMob politikası).
 * Pro yetkisi varken MainActivity init() çağırmaz; yetki sonradan gelirse destroy() ile yüklü reklam bırakılır ve
 * bir daha yüklenmez ({@link #stopped}).
 */
public class Ads {
    private static final String TAG = "DwgViewerAds";
    /** İki gösterim arası taban koruması (JS hatasına karşı) */
    private static final long MIN_GAP_MS = 60_000L;

    private final Activity act;
    private InterstitialAd ad;
    private boolean sdkReady, initStarted, loading, showing, stopped;
    private long lastShown = -MIN_GAP_MS; // ilk gösterim beklemesin

    public interface Done { void done(boolean shown); }

    public Ads(Activity act) { this.act = act; }

    /** Rıza akışı + SDK başlatma; her adım hata verse de bir sonraki adım denenir (reklam olmadan uygulama çalışır) */
    public void init() {
        ConsentRequestParameters params = new ConsentRequestParameters.Builder().build();
        final ConsentInformation ci = UserMessagingPlatform.getConsentInformation(act);
        ci.requestConsentInfoUpdate(act, params,
            () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(act, formError -> {
                if (formError != null) Log.w(TAG, "rıza formu: " + formError.getMessage());
                if (ci.canRequestAds()) startSdk(); else Log.w(TAG, "rıza yok; reklam istenmiyor");
            }),
            err -> { Log.w(TAG, "rıza bilgisi: " + err.getMessage()); if (ci.canRequestAds()) startSdk(); });
        // önceki oturumda rıza alınmışsa formu beklemeden başlanabilir
        if (ci.canRequestAds()) startSdk();
    }

    private void startSdk() {
        if (initStarted || stopped) return;
        initStarted = true;
        new Thread(() -> MobileAds.initialize(act, status -> act.runOnUiThread(() -> { sdkReady = true; load(); })), "admob-init").start();
    }

    /** Bir sonraki geçiş reklamını ön yükler (ana iş parçacığı) */
    private void load() {
        if (!sdkReady || loading || ad != null || stopped || act.isFinishing()) return;
        loading = true;
        InterstitialAd.load(act, BuildConfig.ADMOB_INTERSTITIAL_ID, new AdRequest.Builder().build(), new InterstitialAdLoadCallback() {
            @Override public void onAdLoaded(InterstitialAd a) { loading = false; ad = a; }
            @Override public void onAdFailedToLoad(LoadAdError e) { loading = false; ad = null; Log.w(TAG, "yükleme: " + e.getMessage()); }
        });
    }

    /** Yüklü bir reklam var ve taban koruması geçti mi? */
    public boolean ready() { return ad != null && !stopped && !showing && SystemClock.elapsedRealtime() - lastShown >= MIN_GAP_MS; }

    /** Yüklüyse gösterir; kapanınca yenisini yükler ve cb.done(true). Değilse cb.done(false) ve yükleme tetiklenir. Ana iş parçacığında çağrılır. */
    public void show(String reason, Done cb) {
        if (!ready()) { if (ad == null) load(); cb.done(false); return; }
        final InterstitialAd a = ad;
        ad = null; showing = true;
        a.setFullScreenContentCallback(new FullScreenContentCallback() {
            @Override public void onAdShowedFullScreenContent() { lastShown = SystemClock.elapsedRealtime(); }
            @Override public void onAdDismissedFullScreenContent() { showing = false; load(); cb.done(true); }
            @Override public void onAdFailedToShowFullScreenContent(AdError e) { showing = false; Log.w(TAG, "gösterim: " + e.getMessage()); load(); cb.done(false); }
        });
        try { a.show(act); } catch (Exception e) { showing = false; Log.w(TAG, "gösterim: " + e); load(); cb.done(false); }
    }

    /** Reklamı bırakır ve bir daha yüklemez (Pro'ya geçiş, etkinlik sonu) */
    public void destroy() { stopped = true; ad = null; }
}
