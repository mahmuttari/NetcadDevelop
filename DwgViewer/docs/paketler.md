# Paketler, fiyatlar ve Play Console kurulumu

Uygulama dört basamaklıdır. Sıra bağlayıcıdır ve tek kaynaktan gelir:
`viewer/edition.js` içindeki **`FEATURE_TIER`** tablosu ile Java tarafındaki
**`Tier.java`**. Bir özelliği başka bir pakete taşımak için `FEATURE_TIER`
içinde tek bir satır değiştirmek yeterlidir; arayüz, kapılar, rozetler ve
panel hep oradan beslenir.

```
free  <  adfree  <  premium  <  super
```

Kullanıcı birden çok abonelik taşıyabilir (Ad-Free'yi bırakmadan Premium
alırsa gibi); geçerli yetki her zaman **en yüksek** olandır. Bunu
`Pro.edition()` hesaplar, `Billing.verify()` de Play'den gelen bütün etkin
abonelikleri tarayıp en yükseğini bildirir.

## Ne hangi pakette

| | free | adfree | premium | super |
|---|:--:|:--:|:--:|:--:|
| Reklam gösterilir | ✓ | – | – | – |
| DWG/DXF/PDF/Word/Excel/ZIP/RAR açma | ✓ | ✓ | ✓ | ✓ |
| Ölçü, katman listesi, arama, GPS, harita altlığı, PNG | ✓ | ✓ | ✓ | ✓ |
| 2B çizim (çizgi, polyline, dikdörtgen, daire, yay, nokta, yazı) | – | – | ✓ | ✓ |
| 2B düzenleme (taşı, kopyala, döndür, ölçekle, aynala, ofset, sil, yazı) | – | – | ✓ | ✓ |
| Katman, renk, özellikler, geri al / yinele | – | – | ✓ | ✓ |
| Notlar, ölçekli PDF çıktısı, DXF kaydetme | – | – | ✓ | ✓ |
| Yeni dosya oluşturma (DXF, DOCX, XLSX, PDF, TXT, CSV) | – | – | ✓ | ✓ |
| Belge düzenleme (PDF, Word, Excel, CSV, metin) | – | – | ✓ | ✓ |
| 3B çizim ve düzenleme, kot atama | – | – | – | ✓ |
| Kot / eğim profili | – | – | – | ✓ |
| Çizim karşılaştırma | – | – | – | ✓ |
| Değişiklikleri kaydetme (delta) | – | – | – | ✓ |
| Google Drive'a yükleme | – | – | – | ✓ |

## Fiyatlar

Fiyatlar **kodda değil Play Console'da** tanımlıdır; uygulama onları
`ProductDetails` üzerinden okuyup panelde gösterir. Aşağıdaki tablo
Play'e girilecek değerlerdir.

| Paket | Aylık | Yıllık | Yıllığın aylık karşılığı | Yıllık / aylık |
|---|---|---|---|---|
| Ad-Free | 39,99 TL | 399,99 TL | 33,33 TL | 10,0× |
| Premium | 299,99 TL | 2.999,99 TL | 250,00 TL | 10,0× |
| Super | 449,99 TL | 4.499,99 TL | 375,00 TL | 10,0× |

**Neden 10 kat.** Yıllık fiyatın aylığın 10 katı olması sektörde
yerleşik kuraldır ve "yıllık alırsanız iki ay bedava" diye tek cümleyle
anlatılır. Oranın paketten pakete değişmesi hem anlatımı bozar hem de
paketler arasında mantıksız boşluk açar.

İlk verilen fiyatlarda (Ad-Free 40/350, Premium 300/2000, Super 450/2200)
iki sorun vardı:

1. **Yıllık Premium 2.000 TL, yıllık Super 2.200 TL** — arada yalnız %10
   fark. Aylıkta fark %50 olduğu için yıllık tarafta Premium'u seçmenin
   hiçbir gerekçesi kalmıyordu; Premium yıllık ölü ürün olurdu.
2. **Super'de yıllık, aylığın 4,9 katı** — yani %59 indirim. Aylık
   fiyatı inandırıcılıktan düşürür ve yıllık geliri gereksiz yere kırar.

Düzeltme, aylık merdiveni olduğu gibi korur (40 / 300 / 450 → .99'lu
karşılıkları) ve yalnız yıllıkları tutarlı hâle getirir.

**Kalan bir tercih:** Ad-Free ile Premium arasında 7,5 kat fark var. Bu
bilinçliyse sorun değil — Ad-Free "reklamdan kurtulmak isteyen izleyici",
Premium "çizim yapan mühendis" demektir; iki ayrı alıcı kitlesidir. Ama
klasik üç paket kurgusunda orta paketin *seçilmesi beklenen* paket olması
istenir; öyle olsun isteniyorsa Ad-Free biraz yukarı ya da Premium biraz
aşağı çekilir.

**Net kazanç.** Türkiye'de Play, kullanıcıya gösterilen fiyata KDV'yi
dahil eder ve kendisi beyan eder; üstüne Google komisyonu (yıllık ilk
1 milyon ABD doları için %15) düşer. Kaba hesapla 299,99 TL'lik bir
satıştan elinize geçen ≈ 299,99 / 1,20 × 0,85 ≈ **212 TL**'dir. Play
Console ürün sayfasında tahmini ödeme tutarını gösterir; kesin rakamı
oradan doğrulayın.

**Öneri: ücretsiz deneme ekleyin.** Play, temel plana 7 günlük ücretsiz
deneme teklifi eklemeye izin verir. 300 TL/ay bir üründe deneme, satın
almaya dönüşümü belirgin biçimde artırır ve size hiçbir maliyeti yoktur.
Uygulama tarafı hazır: `Billing.offerToken` bir teklif (deneme ya da
tanıtım fiyatı) varsa onu temel plana tercih eder.

## Play Console'da kurulum

**Para kazanma → Abonelikler → Abonelik oluştur**, üç kez:

| Ürün kimliği | Ad |
|---|---|
| `dwg_adfree` | Ad-Free |
| `dwg_premium` | Premium |
| `dwg_super` | Super |

Her abonelikte **iki temel plan** açılır. Kimlikler birebir şöyle olmalı,
uygulama onları bu adla arar:

| Temel plan kimliği | Faturalandırma dönemi |
|---|---|
| `monthly` | 1 ay, otomatik yenilenen |
| `yearly` | 1 yıl, otomatik yenilenen |

Kimlikler `gradle.properties` içinde `SKU_*` ve `PLAN_*` olarak durur;
Play'de başka bir yazım kullanılacaksa oradan değiştirilir, kod
değişmez.

**Yükseltme ve düşürme.** Uygulama, elde etkin bir abonelik varken başka
bir paket satın alınırsa akışı `SubscriptionUpdateParams` ile başlatır
(`CHARGE_PRORATED_PRICE`): Play eski aboneliği kapatır ve yalnız farkı
alır. Bu olmasaydı kullanıcı iki aboneliği birden öderdi. Panelde de
sahip olunandan düşük paketlerin satın alma düğmeleri hiç çizilmez.

## Lisans kodu (çevrimdışı)

Kod artık basamak taşır: `tools/license_gen.mjs sign --key <özel.pem>
--name "Ad Soyad" --tier premium [--expires 2027-12-31]`. Eski tek
ürünlü kodlardaki `dwg_pro` değeri `super` sayılır. Lisans ile abonelik
bir aradaysa yüksek olan geçerlidir.
