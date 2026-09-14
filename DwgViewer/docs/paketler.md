# Paketler, fiyatlar ve Play Console kurulumu

Uygulama dört basamaklıdır. Sıra bağlayıcıdır ve tek kaynaktan gelir:
`viewer/edition.js` içindeki **`FEATURE_TIER`** tablosu ile Java tarafındaki
**`Tier.java`**. Bir özelliğin **davranışını** başka pakete taşımak için
`FEATURE_TIER` içinde tek satır yeter: şerit karoları, sekmeler, menü
eylemleri, `has()` ve `gate()` hep oradan beslenir.

**Ama paket kartında yazan madde listesi oradan gelmez.** Pro panelindeki
maddeler `tierFeat_free` / `tierFeat_adfree` / `tierFeat_premium` /
`tierFeat_super` anahtarlarından okunur (i18n.js + `lang/` altındaki on üç
dosya, yani on beş yer). Bir özellik paket değiştirdiğinde bu anahtarlar da
elle düzeltilmelidir; yoksa kart bir şey söyler, kapı başka şey yapar.

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

## Rakip kıyası: DWG FastView (Türkiye / Google Play, 14.09.2026)

Fiyatlar uygulamanın kendi satın alma sayfasından okundu.

| Paket | Rakip aylık | Rakip yıllık | Yıllık / aylık |
|---|---|---|---|
| Ad-Free | 54,99 TL | 499,99 TL | 9,1× |
| Premium | 346,99 TL | 2.499,99 TL | 7,2× |
| Super | 539,99 TL | 2.539,99 TL | 4,7× |

**Bizim eski fiyatlarımızla karşılaştırma.** Aylıkta her kademede rakibin
altındaydık (−27 / −14 / −17 %), ama **yıllıkta üstüne çıkıyorduk**:
Premium yıllık +%20, Super yıllık **+%77**. Sebebi, bu belgede daha önce
savunduğum "yıllık = aylığın 10 katı" kuralıydı. O kural genel yazılım
aboneliğinde doğrudur; bu kategoride değil. Ölçüm bunu gösteriyor: rakip
yıllıkta %24 – %61 arasında indirim veriyor, çünkü mobil abonelikte tutundurma
düşüktür ve bir yıllık geliri peşin almak yeğlenir. Kural düzeltildi.

Rakibin kendi hatası da kayda geçirilmeli: **Premium yıllık 2.499,99 ile Super
yıllık 2.539,99 arasında yalnız 40 TL (%1,6) fark var.** Bu, ilk fiyat
önerisinde düzelttiğimiz "yıllıkta iki paket birbirine yapışıyor" hatasının
daha ağır hâlidir; Premium yıllık onlarda ölü üründür. Bizim tabloda bu boşluk
%29'dur.

### Yeni fiyatlar

| Paket | Aylık | Yıllık | Yıllık / aylık | Yıllıkta indirim | Rakibe göre aylık | Rakibe göre yıllık |
|---|---|---|---|---|---|---|
| Ad-Free | 39,99 TL | 299,99 TL | 7,5× | %37 | −%27 | −%40 |
| Premium | 249,99 TL | 1.699,99 TL | 6,8× | %43 | −%28 | −%32 |
| Super | 399,99 TL | 2.199,99 TL | 5,5× | %54 | −%26 | −%13 |

Premium → Super farkı aylıkta %60, yıllıkta %29: iki üründe de yükseltmenin
gerekçesi var, hiçbiri ölü değil. Yeni uygulamayız ve özellik sayımız
rakibinkinin altında; her satırda onun altında kalmak bilinçli konumlandırmadır.

### Rakibin Ad-Free'si

Rakibin Ad-Free katmanının **tek** ayrıcalığı vardır: "reklamları kapat".
Bizimki de öyle (`edition.js` FEATURE_TIER'da adfree'ye bağlı tek kimlik yok,
tek fark `noAds()`). Bu tasarım pazar lideriyle birebir örtüşüyor, değişmemeli.

### Kademelemenin mantığı farklı

Rakip Premium ile Super'i **platformla** ayırıyor (mobil / Windows / web);
mobil ayrıcalık listeleri neredeyse aynı. Biz **yetenekle** ayırıyoruz
(2B çizim-düzenleme premium, 3B ve mühendislik araçları super). Tek platformlu
bir üründe bizimki daha dürüsttür, ama Super'in +%60'ı hak ettiğini mağaza
metninin açıkça göstermesi gerekir.

## Rakipte olup bizde olmayanlar — yol haritası

Dört bağımsız denetçi rakibin 78 satırlık listesini bizim 101 yeteneğimizle
eşledi; tekrarlar ayıklandığında 58 ayrı özellik kalıyor. **22 başlık bizde
yok**; 28'inin karşılığı var; 26 yeteneğimizin rakipte karşılığı yok.

### 1. Ucuz — veri zaten hazır (önce bunlar)

| Özellik | Neden ucuz | Kademe | Durum |
|---|---|---|---|
| Blok sayma + grafik istatistik | sayımlar `S.counts`, blok adı `info.name` | free | **v7.27'de eklendi** |
| Yüzey / yanal alan / hacim | ağ üçgenleri bellekte (`p.vtx`, `p.idx`) | super | **v7.28'de eklendi** |
| Çok sayfalı PDF | düzenler `scene.layouts` içinde | premium | **v7.28'de eklendi** |
| Metin çıkarma (CSV / düz metin) | yazı ilkelleri ve öznitelikler sahnede | premium | **v7.28'de eklendi** |
| Ölçümü paylaşma | köprü hazır (`MainActivity.shareText`) | free | **v7.28'de eklendi** |
| Ondalık hassasiyeti ayarı | tek `fmt()` çağrısı | free | **v7.28'de eklendi** |
| Hazır ifadeler (Useful Words) | sabit liste + son kullanılanlar | free | **v7.28'de eklendi** |

Bu yedisi v7.28 ile kapandı; **birinci öbekte açık madde kalmadı**. Ayrıntıları:

- **Yüzey / yanal alan** — seçili ağ gövdesinin bilgi panelinde “Yüzey alanı” çipi. Toplam yüzey,
  yanal alan (normali düşeyden en çok 30° sapan üçgenler), yatayımsı yüzeyler, üstten ve alttan
  izdüşüm, kapalı ağta hacim ve üçgen sayısı. Hesap `geom.meshMetrics`tedir; 10 m'lik küpte
  600 / 400 / 200 / 100 / 100 / 1000 değerleri sınamayla bağlandı.
- **Çok sayfalı PDF** — PDF kutusunda “Bütün sayfalar” seçeneği (yalnız birden çok düzen varsa
  çıkar). Her düzen kendi sınırlarına sığdırılır, kendi ölçeğini ve “n / m” sayfa numarasını taşır.
  `buildPdf` artık sayfa dizisi alır; nesne numaraları ve xref sayfa sayısına göre üretilir.
- **Metin çıkarma** — Görünüm › Çıktı › “Metin çıkar”. TEXT / MTEXT gövdeleri ve blok
  öznitelikleri; CSV'de metin, etiket, tür, katman, X/Y/Z, yükseklik, açı ve tutamak sütunları.
  İstenirse bütün sayfalar taranır. Excel'in Türkçe ayraçı (`;`) ve BOM kullanılır.
- **Ölçümü paylaşma** — ölçü panelinde “Paylaş” çipi; dökümü kopyalama ile aynı metinden üretir.
- **Ondalık hassasiyeti** — Ayarlar'da 0-6 basamak ve “son sıfırlar” seçeneği. `fmt()` basamak
  verilmediğinde ayarı okur; açı gibi basamağı sabit olması gereken yerler değeri açıkça geçer
  ve ayardan etkilenmez.
- **Hazır ifadeler** — yazı ve not kutularının üstünde çip sırası: dilin öntanımlı on iki ifadesi
  (`presetList`) ve kullanıcının son sekiz yazdığı. Liste cihazda kalır, hiçbir yere gönderilmez.

### 2. Orta — var olan düzenleme çekirdeğine eklenir

Ölçülendirme (dimension) oluşturma · ölçümü çizime işaretleme · revizyon bulutu ·
numaralandırma · artımlı kopya · yazı yüksekliğini değiştirme · çizimde
bul-değiştir · öznitelik düzenleme · explode · tarama (hatch) oluşturma ·
kalınlık (extrusion) atama · dolgu alanı ölçümü · 3B açıklama.

### 3. Ağır — yeni altyapı ister

3B geometrik ölçüm ailesi (nokta-doğru, nokta-düzlem, doğru-doğru, doğru-düzlem,
düzlem-düzlem, düzlemler arası açı, akıllı açı) · blok kütüphanesi (oluştur /
ekle / kütüphaneye at) · toplu (batch) işlem · 3B biçim dönüştürme (OBJ/STL) ·
tablo çıkarma · **PDF→CAD** · pano ile dosyalar arası yapıştırma.

### Rakipte hiç olmayan üstünlüklerimiz

Pencereli DWG okuma (7,09 milyon nesnelik dosyayı açabilme) · kot/eğim profili ·
yalnız değişenleri DXF yazma · ofis belgesi açma **ve düzenleme** + yeni dosya
oluşturma · GPS, harita altlığı, ITRF96/ED50 dâhil koordinat sistemleri ·
XREF ve eksik resim bağlama · notta fotoğraf iğnesi · kullanıcının **kendi**
bulutu (Drive + WebDAV/Nextcloud) — rakibin 10 GB'lık satıcı deposundan hem
sınırsız hem gizlilik açısından üstün · ZIP/RAR gezgini · onbeş dil ·
eldiven kipi ve güneş modu.

### Önerilen iki kademe düzeltmesi

Rakip **çizim karşılaştırmayı** ve **bulut depolamayı** Premium'da veriyor;
bizde ikisi de Super'de. `edition.js` FEATURE_TIER'da `compare` ve
`driveUpload` premium'a alınırsa Premium rakiple denk olur. `profile`
(kot/eğim profili) Super'de kalmalı — rakipte karşılığı yok, Super'in gerçek
gerekçesi odur.

## Fiyatlar

Fiyatlar **kodda değil Play Console'da** tanımlıdır; uygulama onları
`ProductDetails` üzerinden okuyup panelde gösterir. Aşağıdaki tablo
Play'e girilecek değerlerdir.

| Paket | Aylık | Yıllık | Yıllığın aylık karşılığı | Yıllık / aylık |
|---|---|---|---|---|
| Ad-Free | 39,99 TL | 299,99 TL | 25,00 TL | 7,5× |
| Premium | 249,99 TL | 1.699,99 TL | 141,67 TL | 6,8× |
| Super | 399,99 TL | 2.199,99 TL | 183,33 TL | 5,5× |

Bu değerler pazar ölçümüne dayanır; gerekçesi yukarıdaki **Rakip kıyası**
bölümündedir. Daha önce burada savunulan "yıllık = aylığın 10 katı" kuralı
bu kategoride geçerli değildir ve terk edilmiştir.

**Aylık merdiven neden böyle.** İlk verilen fiyatlarda (Ad-Free 40/350,
Premium 300/2000, Super 450/2200) yıllık Premium 2.000 TL ile yıllık Super
2.200 TL arasında yalnız %10 fark vardı; aylıkta fark %50 olduğu için yıllık
tarafta Premium “ölü ürün” olurdu. Aylık merdiven (40 / 300 / 450) korundu,
yıllıklar rakip ölçümüne göre yeniden kuruldu; iki paket arasındaki fark
yıllıkta %29'a çıktı.

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

Ürün kimlikleri (`SKU_*`) `gradle.properties` içinde durur; Play'de başka
bir yazım kullanılacaksa oradan değiştirilir, kod değişmez.

**Temel plan kimlikleri için aynı şey geçerli değildir.** `PLAN_MONTHLY` ve
`PLAN_YEARLY` gradle tarafında ayarlansa da `viewer/edition.js` içindeki
`PLANS = ['monthly', 'yearly']` dizisi sabittir ve satın alma çağrısına
(`Android.buyPro(tier, plan)`) o dizideki metin gider. `Billing.buy()` gelen
metni `BuildConfig.PLAN_YEARLY` ile karşılaştırdığı için, plan kimliği
gradle'da değiştirilip JS'te değiştirilmezse **yıllık alımlar sessizce aylığa
düşer**. Plan kimliği değiştirilecekse `gradle.properties`, `edition.js`
(`PLANS` ve `planYearly` etiket karşılaştırması) birlikte güncellenir.
En sağlamı kimlikleri `monthly` / `yearly` bırakmaktır.

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
