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

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Play Faturalandırma: üç ABONELİK (adfree &lt; premium &lt; super), her birinde iki temel plan
 * (BuildConfig.PLAN_MONTHLY, BuildConfig.PLAN_YEARLY).
 *
 * Akış: connect() → bağlanınca üç ürünün ayrıntısı sorgulanır (temel plan başına biçimli fiyat) ve
 * queryPurchasesAsync(SUBS) ile sahiplik doğrulanır. Kullanıcı birden çok abonelik taşıyabildiği için
 * yetki, etkin aboneliklerin EN YÜKSEK basamağıdır.
 *
 * Basamak değiştirme: Play, aboneliklerde yükseltme/düşürmeyi destekler. Elde etkin bir abonelik varken
 * başka bir basamak satın alınırsa akış {@link BillingFlowParams.SubscriptionUpdateParams} ile başlatılır;
 * Play eski aboneliği iptal edip farkı oranlar (CHARGE_PRORATED_PRICE). Bu olmadan kullanıcı iki aboneliği
 * birden öder.
 *
 * Sonuçlar {@link Listener} ile ana iş parçacığına döner:
 *   onVerified(tier, restore) — Play'e göre geçerli basamak ("free" hiç abonelik yoksa)
 *   onPurchase(state)         — "purchased" | "cancelled" | "pending" | "error:&lt;mesaj&gt;"
 *   onReady()                 — bağlantı kuruldu ve ürün sorgusu bitti (açık panel fiyatları yeniler)
 * Play hizmeti yoksa ready() false kalır ve hata yutulur. Yaşam döngüsü: onDestroy'da destroy().
 */
public class Billing implements PurchasesUpdatedListener {
    private static final String TAG = "DwgViewerBilling";
    private static final int RECONNECT_MAX = 3;

    public interface Listener {
        /** Açılış/geri yükleme doğrulaması: Play'e göre geçerli basamak; restore: restorePro() isteğinden geldiyse true */
        void onVerified(String tier, boolean restore);
        /** Satın alma akışı sonucu: "purchased" | "cancelled" | "pending" | "error:<mesaj>" */
        void onPurchase(String state);
        /** Play bağlantısı kuruldu ve ürün ayrıntısı sorgusu sonuçlandı */
        void onReady();
    }

    private final Activity act;
    private final Listener listener;
    private BillingClient client;
    /** basamak → ProductDetails (abonelik) */
    private final Map<String, ProductDetails> products = new HashMap<>();
    /** "<basamak>/<plan>" → biçimli fiyat ("₺299,99") */
    private final Map<String, String> prices = new HashMap<>();
    /** Etkin abonelik satın alma jetonu (basamak değiştirmede eskisini bildirmek için) */
    private String activeToken;
    private String activeTier = Tier.FREE;
    private boolean ready, connecting;
    private int reconnects;
    private Runnable pending;

    public Billing(Activity act, Listener listener) {
        this.act = act;
        this.listener = listener;
        client = BillingClient.newBuilder(act)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    public boolean ready() { return ready && client != null && client.isReady(); }

    /** Biçimli fiyat ("₺299,99"); henüz alınmadıysa "" */
    public String price(String tier, String plan) {
        String v = prices.get(tier + "/" + plan);
        return v == null ? "" : v;
    }

    /** Play'in bildiği bütün fiyatlar: {"premium":{"monthly":"₺299,99","yearly":"…"}, …} */
    public Map<String, String> allPrices() { return new HashMap<>(prices); }

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
                        queryProducts(null);
                        verify(false);
                        runPending();
                    } else {
                        ready = false;
                        Log.w(TAG, "kurulum: " + r.getResponseCode() + " " + r.getDebugMessage());
                        Runnable p = pending; pending = null;
                        if (p != null) listener.onPurchase("error:" + msg(r, ""));
                    }
                });
            }
            @Override public void onBillingServiceDisconnected() {
                act.runOnUiThread(() -> {
                    connecting = false; ready = false;
                    if (reconnects++ < RECONNECT_MAX) connect(null);
                });
            }
        });
    }

    private void runPending() { Runnable p = pending; pending = null; if (p != null) p.run(); }

    /** Üç aboneliğin ayrıntısı ve temel plan fiyatları; then != null ise sorgu bitince çalışır */
    private void queryProducts(Runnable then) {
        if (!ready()) { if (then != null) then.run(); return; }
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (String tier : new String[]{ Tier.ADFREE, Tier.PREMIUM, Tier.SUPER }) {
            String sku = Tier.sku(tier);
            if (sku.isEmpty()) continue;
            list.add(QueryProductDetailsParams.Product.newBuilder().setProductId(sku).setProductType(BillingClient.ProductType.SUBS).build());
        }
        QueryProductDetailsParams q = QueryProductDetailsParams.newBuilder().setProductList(list).build();
        client.queryProductDetailsAsync(q, (r, result) -> act.runOnUiThread(() -> {
            List<ProductDetails> details = result != null ? result.getProductDetailsList() : null;
            if (r.getResponseCode() == BillingClient.BillingResponseCode.OK && details != null) {
                for (ProductDetails d : details) {
                    String tier = Tier.ofSku(d.getProductId());
                    if (Tier.FREE.equals(tier)) continue;
                    products.put(tier, d);
                    List<ProductDetails.SubscriptionOfferDetails> offers = d.getSubscriptionOfferDetails();
                    if (offers == null) continue;
                    for (ProductDetails.SubscriptionOfferDetails o : offers) {
                        String plan = logicalPlan(o);
                        if (plan == null) continue;
                        List<ProductDetails.PricingPhase> ph = o.getPricingPhases().getPricingPhaseList();
                        if (ph == null || ph.isEmpty()) continue;
                        // Son evre yinelenen (asıl) fiyattır; önündekiler deneme süresi ya da tanıtım fiyatıdır
                        String formatted = ph.get(ph.size() - 1).getFormattedPrice();
                        if (formatted != null && !formatted.isEmpty()) prices.put(tier + "/" + plan, formatted);
                    }
                }
            } else Log.w(TAG, "ürün: " + r.getResponseCode() + " " + r.getDebugMessage());
            if (ready()) listener.onReady();
            if (then != null) then.run();
        }));
    }

    /** Sahiplik doğrulaması: queryPurchasesAsync(SUBS); en yüksek basamak kazanır, onaylanmamışlar onaylanır */
    public void verify(boolean restore) {
        if (!ready()) { connect(() -> verify(restore)); return; }
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
            (r, purchases) -> act.runOnUiThread(() -> {
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "sorgu: " + r.getResponseCode() + " " + r.getDebugMessage());
                    if (restore) listener.onVerified(Tier.FREE, true);   // istek üzerine geldiyse "bulunamadı"; açılışta yetkiye dokunulmaz
                    return;
                }
                String best = Tier.FREE, token = null;
                if (purchases != null) for (Purchase p : purchases) {
                    if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                    String t = tierOf(p);
                    if (Tier.FREE.equals(t)) continue;
                    acknowledge(p);
                    if (Tier.rank(t) >= Tier.rank(best)) { best = t; token = p.getPurchaseToken(); }
                }
                activeTier = best; activeToken = token;
                listener.onVerified(best, restore);
            }));
    }

    /** Satın alma / basamak değiştirme akışı; tier: adfree|premium|super, plan: monthly|yearly */
    public void buy(String tier, String plan) {
        final String t = Tier.norm(tier);
        final String pl = BuildConfig.PLAN_YEARLY.equals(plan) ? BuildConfig.PLAN_YEARLY : BuildConfig.PLAN_MONTHLY;
        if (Tier.FREE.equals(t)) return;
        if (!ready()) { connect(() -> buy(t, pl)); return; }
        if (products.get(t) == null) { queryProducts(() -> launch(t, pl)); return; }
        launch(t, pl);
    }

    private void launch(String tier, String plan) {
        ProductDetails d = products.get(tier);
        if (d == null) { listener.onPurchase("error:Abonelik Play'de bulunamadı (" + Tier.sku(tier) + ")"); return; }
        String offer = offerToken(d, plan);
        if (offer == null) { listener.onPurchase("error:Temel plan Play'de bulunamadı (" + Tier.sku(tier) + " / " + plan + ")"); return; }
        BillingFlowParams.Builder b = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).setOfferToken(offer).build()));
        // Elde etkin bir abonelik varsa yenisi onun yerine geçer; yoksa kullanıcı iki aboneliği birden öder
        if (activeToken != null && !Tier.FREE.equals(activeTier)) {
            b.setSubscriptionUpdateParams(BillingFlowParams.SubscriptionUpdateParams.newBuilder()
                .setOldPurchaseToken(activeToken)
                .setSubscriptionReplacementMode(BillingFlowParams.SubscriptionUpdateParams.ReplacementMode.CHARGE_PRORATED_PRICE)
                .build());
        }
        BillingResult r = client.launchBillingFlow(act, b.build());
        if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) listener.onPurchase("error:" + msg(r, Tier.sku(tier)));
    }

    /**
     * Teklifin mantıksal planı (PLAN_MONTHLY / PLAN_YEARLY). Önce temel plan kimliğine, tutmazsa yinelenen
     * evrenin fatura dönemine (P1M / P1Y) bakılır: Play Console'da temel plan silinemediği ve kimliği yeniden
     * kullanılamadığı için yanlış kurulan bir planın yerine açılan plan farklı kimlik taşıyabilir (ör. yearly-1).
     * Taksitli (taahhütlü) planlar hiçbir mantıksal plana eşlenmez.
     */
    private static String logicalPlan(ProductDetails.SubscriptionOfferDetails o) {
        if (o.getInstallmentPlanDetails() != null) return null;
        String id = o.getBasePlanId();
        if (BuildConfig.PLAN_MONTHLY.equals(id) || BuildConfig.PLAN_YEARLY.equals(id)) return id;
        List<ProductDetails.PricingPhase> ph = o.getPricingPhases().getPricingPhaseList();
        if (ph == null || ph.isEmpty()) return null;
        String period = ph.get(ph.size() - 1).getBillingPeriod();
        if ("P1Y".equals(period) || "P12M".equals(period)) return BuildConfig.PLAN_YEARLY;
        if ("P1M".equals(period)) return BuildConfig.PLAN_MONTHLY;
        return null;
    }

    /** Mantıksal plana karşılık gelen teklif jetonu; deneme/tanıtım teklifi varsa o tercih edilir */
    private static String offerToken(ProductDetails d, String plan) {
        List<ProductDetails.SubscriptionOfferDetails> offers = d.getSubscriptionOfferDetails();
        if (offers == null) return null;
        String base = null;
        for (ProductDetails.SubscriptionOfferDetails o : offers) {
            if (!plan.equals(logicalPlan(o))) continue;
            // offerId dolu olan bir teklif (ücretsiz deneme / tanıtım fiyatı) varsa kullanıcı lehinedir
            if (o.getOfferId() != null && !o.getOfferId().isEmpty()) return o.getOfferToken();
            base = o.getOfferToken();
        }
        return base;
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        act.runOnUiThread(() -> {
            int code = r.getResponseCode();
            if (code == BillingClient.BillingResponseCode.USER_CANCELED) { listener.onPurchase("cancelled"); return; }
            if (code != BillingClient.BillingResponseCode.OK) { listener.onPurchase("error:" + msg(r, "")); return; }
            boolean pendingSeen = false;
            String best = Tier.FREE;
            if (purchases != null) for (Purchase p : purchases) {
                String t = tierOf(p);
                if (Tier.FREE.equals(t)) continue;
                if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                    acknowledge(p);
                    if (Tier.rank(t) >= Tier.rank(best)) { best = t; activeToken = p.getPurchaseToken(); }
                } else if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) pendingSeen = true;
            }
            if (!Tier.FREE.equals(best)) { activeTier = best; listener.onVerified(best, false); listener.onPurchase("purchased"); }
            else listener.onPurchase(pendingSeen ? "pending" : "error:Satın alma sonucu boş");
        });
    }

    /** Satın almanın taşıdığı en yüksek basamak */
    private static String tierOf(Purchase p) {
        String best = Tier.FREE;
        for (String sku : p.getProducts()) best = Tier.max(best, Tier.ofSku(sku));
        return best;
    }

    /** Onaylanmamış abonelik 3 gün içinde onaylanmazsa Play iade eder; sonuç yalnız günlüğe yazılır */
    private void acknowledge(Purchase p) {
        if (p.isAcknowledged() || !ready()) return;
        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
            r -> { if (r.getResponseCode() != BillingClient.BillingResponseCode.OK) Log.w(TAG, "onay: " + r.getResponseCode() + " " + r.getDebugMessage()); });
    }

    private static String msg(BillingResult r, String sku) {
        String d = r.getDebugMessage();
        switch (r.getResponseCode()) {
            case BillingClient.BillingResponseCode.BILLING_UNAVAILABLE: return "Google Play Faturalandırma bu cihazda kullanılamıyor";
            case BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE:
            case BillingClient.BillingResponseCode.NETWORK_ERROR: return "Google Play'e ulaşılamadı (ağ)";
            case BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED: return "Bu abonelik zaten etkin; 'Aboneliği geri yükle' deneyin";
            case BillingClient.BillingResponseCode.ITEM_UNAVAILABLE: return "Abonelik Play'de bulunamadı" + (sku.isEmpty() ? "" : " (" + sku + ")");
            case BillingClient.BillingResponseCode.DEVELOPER_ERROR: return "Faturalandırma yapılandırma hatası";
            default: return (d == null || d.isEmpty() ? "Google Play hatası" : d) + " (" + r.getResponseCode() + ")";
        }
    }

    public void destroy() {
        if (client != null) { try { client.endConnection(); } catch (Exception ignored) { } client = null; }
        ready = false; products.clear(); prices.clear(); pending = null; activeToken = null; activeTier = Tier.FREE;
    }
}
