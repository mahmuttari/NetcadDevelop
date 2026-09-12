package com.mahmuttari.dwgviewer;

import android.app.Activity;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import java.util.Collections;
import java.util.List;

/**
 * Google Play Faturalandırma: Pro tek seferlik, tüketilmeyen ürün (BuildConfig.PRO_SKU).
 *
 * Akış: connect() → bağlanınca queryPurchasesAsync(INAPP) ile sahiplik doğrulanır (PURCHASED + acknowledge) ve
 * ürün fiyatı (formattedPrice) alınır. Sonuçlar {@link Listener} ile ana iş parçacığına döner:
 * onVerified(owned): Play "sahip" ya da "değil" dedi (hizmet yoksa çağrılmaz); onPurchase(state, msg):
 * satın alma akışının sonucu ("purchased" | "cancelled" | "pending" | "error:<mesaj>"); onReady(): bağlantı kuruldu ve
 * ürün sorgusu bitti (panel açıkken bağlanıldıysa fiyat ve düğmeler yenilensin). Play hizmeti yoksa
 * (BILLING_UNAVAILABLE vb.) ready() false kalır ve hata yutulur; bağlantı koparsa bir sonraki istekte yeniden
 * bağlanılır. Yaşam döngüsü: onDestroy'da destroy().
 */
public class Billing implements PurchasesUpdatedListener {
    private static final String TAG = "DwgViewerBilling";
    private static final int RECONNECT_MAX = 3;

    public interface Listener {
        /** Açılış/geri yükleme doğrulaması: Play'e göre Pro sahibi mi? (restore: restorePro() isteğinden geldiyse true) */
        void onVerified(boolean owned, boolean restore);
        /** Satın alma akışı sonucu: "purchased" | "cancelled" | "pending" | "error:<mesaj>" */
        void onPurchase(String state);
        /** Play bağlantısı kuruldu ve ürün ayrıntısı (fiyat) sorgusu sonuçlandı: açık Pro paneli fiyat / düğmeleri yenileyebilir */
        void onReady();
    }

    private final Activity act;
    private final Listener listener;
    private BillingClient client;
    private ProductDetails product;
    private boolean ready, connecting;
    private int reconnects;
    /** Bağlantı kurulunca yapılacak iş (satın alma ya da geri yükleme isteği bağlantıdan önce gelirse) */
    private Runnable pending;

    public Billing(Activity act, Listener listener) {
        this.act = act;
        this.listener = listener;
        client = BillingClient.newBuilder(act)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    /** Play hizmetine bağlı ve ürün sorgulanabilir mi? */
    public boolean ready() { return ready && client != null && client.isReady(); }

    /** Play'den gelen biçimli fiyat ("₺149,99"); henüz alınmadıysa "" */
    public String price() {
        if (product == null) return "";
        ProductDetails.OneTimePurchaseOfferDetails o = product.getOneTimePurchaseOfferDetails();
        return o == null ? "" : o.getFormattedPrice();
    }

    /** Bağlanır; bağlanınca sahiplik doğrulanır ve fiyat alınır. Zaten bağlıysa boşa düşer. */
    public void connect() { connect(null); }

    private void connect(Runnable then) {
        if (client == null) return;
        if (then != null) pending = then;
        if (ready()) { runPending(); return; }
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                act.runOnUiThread(() -> {
                    connecting = false;
                    if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        ready = true; reconnects = 0;
                        queryProduct();
                        verify(false);
                        runPending();
                    } else {
                        ready = false;
                        Log.w(TAG, "kurulum: " + r.getResponseCode() + " " + r.getDebugMessage());
                        Runnable p = pending; pending = null;
                        if (p != null) listener.onPurchase("error:" + msg(r));
                    }
                });
            }
            @Override public void onBillingServiceDisconnected() {
                act.runOnUiThread(() -> {
                    connecting = false; ready = false;
                    // Play hizmeti koptu; sınırlı sayıda yeniden denenir, sonrası bir sonraki istekte
                    if (reconnects++ < RECONNECT_MAX) connect(null);
                });
            }
        });
    }

    private void runPending() { Runnable p = pending; pending = null; if (p != null) p.run(); }

    /** Ürün ayrıntıları (fiyat ve satın alma akışı için ProductDetails) */
    private void queryProduct() {
        if (!ready()) return;
        QueryProductDetailsParams q = QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(
            QueryProductDetailsParams.Product.newBuilder().setProductId(BuildConfig.PRO_SKU).setProductType(BillingClient.ProductType.INAPP).build())).build();
        client.queryProductDetailsAsync(q, (r, list) -> act.runOnUiThread(() -> {
            if (r.getResponseCode() == BillingClient.BillingResponseCode.OK && list != null && !list.isEmpty()) product = list.get(0);
            else Log.w(TAG, "ürün: " + r.getResponseCode() + " " + r.getDebugMessage());
            if (ready()) listener.onReady();   // fiyat gelmemiş olsa da bağlantı hazır: panel "Satın al"ı etkinleştirir
        }));
    }

    /** Sahiplik doğrulaması: queryPurchasesAsync(INAPP); PURCHASED + PRO_SKU → sahip (gerekirse acknowledge) */
    public void verify(boolean restore) {
        if (!ready()) { connect(() -> verify(restore)); return; }
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
            (r, purchases) -> act.runOnUiThread(() -> {
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "sorgu: " + r.getResponseCode() + " " + r.getDebugMessage());
                    if (restore) listener.onVerified(false, true); // istek üzerine geldiyse "bulunamadı" denir; açılışta yetkiye dokunulmaz
                    return;
                }
                boolean owned = false;
                for (Purchase p : purchases) if (isPro(p)) { owned = true; acknowledge(p); }
                listener.onVerified(owned, restore);
            }));
    }

    /** Satın alma akışını başlatır; sonuç onPurchasesUpdated ile döner */
    public void buy() {
        if (!ready()) { connect(this::buy); return; }
        if (product == null) {
            // ürün henüz gelmedi: bir kez daha sorgulanır, ardından denenir
            QueryProductDetailsParams q = QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(
                QueryProductDetailsParams.Product.newBuilder().setProductId(BuildConfig.PRO_SKU).setProductType(BillingClient.ProductType.INAPP).build())).build();
            client.queryProductDetailsAsync(q, (r, list) -> act.runOnUiThread(() -> {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK && list != null && !list.isEmpty()) { product = list.get(0); launch(); }
                else listener.onPurchase("error:" + (list == null || list.isEmpty() ? "Ürün Play'de bulunamadı (" + BuildConfig.PRO_SKU + ")" : msg(r)));
            }));
            return;
        }
        launch();
    }

    private void launch() {
        BillingFlowParams p = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product).build())).build();
        BillingResult r = client.launchBillingFlow(act, p);
        if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) listener.onPurchase("error:" + msg(r));
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        act.runOnUiThread(() -> {
            int code = r.getResponseCode();
            if (code == BillingClient.BillingResponseCode.USER_CANCELED) { listener.onPurchase("cancelled"); return; }
            if (code != BillingClient.BillingResponseCode.OK) { listener.onPurchase("error:" + msg(r)); return; }
            boolean pendingSeen = false, owned = false;
            if (purchases != null) for (Purchase p : purchases) {
                if (!p.getProducts().contains(BuildConfig.PRO_SKU)) continue;
                if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) { owned = true; acknowledge(p); }
                else if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) pendingSeen = true;
            }
            listener.onPurchase(owned ? "purchased" : pendingSeen ? "pending" : "error:Satın alma sonucu boş");
        });
    }

    private boolean isPro(Purchase p) { return p.getPurchaseState() == Purchase.PurchaseState.PURCHASED && p.getProducts().contains(BuildConfig.PRO_SKU); }

    /** Onaylanmamış satın alma 3 gün içinde onaylanmazsa Play iade eder; sonuç yalnız günlüğe yazılır */
    private void acknowledge(Purchase p) {
        if (p.isAcknowledged() || !ready()) return;
        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
            r -> { if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) Log.w(TAG, "onay: " + r.getResponseCode() + " " + r.getDebugMessage()); });
    }

    /** Kullanıcıya gösterilecek kısa hata metni */
    private static String msg(BillingResult r) {
        String d = r.getDebugMessage();
        switch (r.getResponseCode()) {
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE: return "Google Play Faturalandırma bu cihazda kullanılamıyor";
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE:
            case BillingClient.BillingResponseCode.NETWORK_ERROR: return "Google Play'e ulaşılamadı (ağ)";
            case BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED: return "Bu ürün zaten satın alınmış; 'Satın alımı geri yükle' deneyin";
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE: return "Ürün Play'de bulunamadı (" + BuildConfig.PRO_SKU + ")";
            case BillingClient.BillingResponseCode.DEVELOPER_ERROR: return "Faturalandırma yapılandırma hatası";
            default: return (d == null || d.isEmpty() ? "Google Play hatası" : d) + " (" + r.getResponseCode() + ")";
        }
    }

    public void destroy() {
        if (client != null) { try { client.endConnection(); } catch (Exception ignored) { } client = null; }
        ready = false; product = null; pending = null;
    }
}
