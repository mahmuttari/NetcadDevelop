package com.mahmuttari.dwgviewer;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import android.app.Activity;

import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * GOOGLE PLAY UYGULAMA İÇİ GÜNCELLEME (v8.9.6).
 *
 * Eskiden sürüm denetimi GitHub'daki release/version.json'a bakar, yeni sürümde APK'nın GitHub
 * adresini açardı. Play'den kurulan bir uygulamanın kendini Play dışından güncellemesi Play
 * politikasına aykırıdır (Cihaz ve Ağ Kötüye Kullanımı); artık güncelleme Play Core'un
 * AppUpdateManager'ı ile yapılır:
 *
 *  - Play'de yeni sürüm varsa ESNEK güncelleme başlatılır: Play kendi penceresini açar, indirme
 *    arka planda sürer, kullanıcı uygulamayı kullanmaya devam eder. İndirme bitince JS'e "ready"
 *    bildirilir; kullanıcı onaylarsa {@link #complete()} uygulamayı yeniden başlatıp kurar.
 *    Esnek güncellemeye izin verilmiyorsa (Play Console'dan öncelik yüksek verilmişse) ANINDA
 *    güncelleme denenir.
 *  - Yarım kalmış bir anında güncelleme varsa uygulamaya her dönüşte (onResume) kaldığı yerden sürdürülür.
 *  - Uygulama Play'den kurulmamışsa (APK ile yüklenmiş, hata ayıklama derlemesi) Play Core hata
 *    verir; elle istenen denetimde mağaza sayfası açılır, açılıştaki otomatik denetim sessiz kalır.
 *
 * JS'e sonuç window.dwgApp.onUpdate(durum) ile döner: "available" (Play penceresi açıldı) · "none"
 * (güncel) · "ready" (indirildi, yeniden başlatma bekliyor) · "store" (mağaza sayfası açıldı) ·
 * "error:<mesaj>".
 */
final class Updates {
    interface Sink { void send(String state); }

    private static final String TAG = "DwgUpdates";
    static final String STORE_WEB = "https://play.google.com/store/apps/details?id=" + BuildConfig.APPLICATION_ID;
    private static final String STORE_APP = "market://details?id=" + BuildConfig.APPLICATION_ID;

    /** Play güncelleme penceresinin istek kodu; sonucu beklemeyiz (durum dinleyici ve onResume izler) */
    private static final int REQ_UPDATE = 0x5750;

    private final Activity act;
    private final Sink sink;
    private AppUpdateManager mgr;
    private boolean listening;

    private final InstallStateUpdatedListener listener;

    Updates(Activity act, Sink sink) {
        this.act = act;
        this.sink = sink;
        this.listener = st -> { if (st.installStatus() == InstallStatus.DOWNLOADED) sink.send("ready"); };
        try { mgr = AppUpdateManagerFactory.create(act); } catch (Throwable t) { Log.w(TAG, "Play Core yok", t); mgr = null; }
    }

    /** Play'de yeni sürüm var mı; varsa güncelleme akışını başlatır. manual: kullanıcı "Güncelleme?" düğmesine bastı */
    void check(boolean manual) {
        if (mgr == null) { if (manual) openStore(); return; }
        mgr.getAppUpdateInfo()
            .addOnSuccessListener(info -> act.runOnUiThread(() -> onInfo(info, manual)))
            .addOnFailureListener(e -> act.runOnUiThread(() -> {
                Log.w(TAG, "denetim", e);
                if (manual) openStore();   // Play'den kurulmamış ya da Play hizmeti yok: mağaza sayfası
            }));
    }

    private void onInfo(AppUpdateInfo info, boolean manual) {
        if (info.installStatus() == InstallStatus.DOWNLOADED) { sink.send("ready"); return; }
        int avail = info.updateAvailability();
        if (avail == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) return;   // onResume sürdürür
        if (avail != UpdateAvailability.UPDATE_AVAILABLE) { if (manual) sink.send("none"); return; }
        if (info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) start(info, AppUpdateType.FLEXIBLE);
        else if (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) start(info, AppUpdateType.IMMEDIATE);
        else if (manual) openStore();
    }

    private void start(AppUpdateInfo info, int type) {
        try {
            if (type == AppUpdateType.FLEXIBLE && !listening) { mgr.registerListener(listener); listening = true; }
            mgr.startUpdateFlowForResult(info, act, AppUpdateOptions.newBuilder(type).build(), REQ_UPDATE);
            sink.send("available");
        } catch (Exception e) {
            Log.w(TAG, "akış", e);
            sink.send("error:" + e.getMessage());
        }
    }

    /** Esnek güncelleme indirildiyse uygulamayı yeniden başlatıp kurar */
    void complete() {
        if (mgr != null) mgr.completeUpdate();
    }

    /** Uygulamaya dönüldüğünde: arka planda biten indirme ve yarım kalan anında güncelleme */
    void onResume() {
        if (mgr == null) return;
        mgr.getAppUpdateInfo().addOnSuccessListener(info -> act.runOnUiThread(() -> {
            if (info.installStatus() == InstallStatus.DOWNLOADED) sink.send("ready");
            else if (info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) start(info, AppUpdateType.IMMEDIATE);
        }));
    }

    void destroy() {
        if (mgr != null && listening) { mgr.unregisterListener(listener); listening = false; }
    }

    /** Uygulamanın Play Store sayfası: önce Play uygulaması, yoksa tarayıcı */
    void openStore() {
        try {
            act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(STORE_APP)).setPackage("com.android.vending"));
        } catch (Exception e) {
            try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(STORE_WEB))); } catch (Exception ignored) { }
        }
        sink.send("store");
    }
}
