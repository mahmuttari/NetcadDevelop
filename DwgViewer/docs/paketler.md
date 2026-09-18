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
yoktu**; 28'inin karşılığı vardı; 26 yeteneğimizin rakipte karşılığı yok.
**v7.27 ile bir, v7.28 ile altı, v7.29 ile kalan on beş başlık kapandı: liste bitti.**

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

### 2. Orta — var olan düzenleme çekirdeğine eklenir · **v7.29'da tamamlandı**

| Özellik | Nerede | Kademe |
|---|---|---|
| Ölçülendirme: doğrusal, yatay, düşey, yarıçap, çap, açı | Açıklama sekmesi ▸ Ölçülendirme | premium |
| Ölçü özelliklerini düzenleme (yazı, yükseklik, ok, ondalık, ön / son ek, çarpan, uzatma) — dosyadan gelen ölçüler dâhil (v7.56) | Açıklama ▸ Ölçüyü düzenle · seçim menüsü ▸ Ölçü özellikleri · `DIMEDIT` | premium |
| Ekran / Ölçü sorusu: ötele, kavis, pah, buda, uzat nesne seçilmeden önce değerin ekrandan mı yazarak mı geleceğini sorar; buda / uzat Ölçü kipi = LENGTHEN DElta (v7.57) | komut çubuğu ▸ Ekran / Ölçü düğmeleri | var olan araçların kademesi (yeni yetenek değil) |
| AutoCAD örtük penceresi: Seç aracında boş yerden sürükleme, soldan sağa mavi pencere / sağdan sola yeşil kesen, etiketli (v7.57) | Seç aracı, dokunma kipi | ücretsiz (seçim) |
| Pickbox imleci: nesne isteminde küçük kare + nesne vurgusu, yakalama kapalı; nokta isteminde artı imleç + yakalama (v7.57) | bütün düzenleme araçları, Seç aracı | ücretsiz (imleç davranışı) |
| Pickbox yarı boy (6 px) + kareye değmeyen artı kolları; tek imleç kuralı (kalem gezinirken son dokunuş imleci çizilmez) (v7.58) | bütün araçlar | ücretsiz (imleç davranışı) |
| Parmakla nişan alma: araç / ölçü çalışırken uzun basıp sürükleme, imleç parmağın altında, 2× büyüteç üstte, bırakınca dokunuş (v7.58) | dokunmatik, araç çalışırken | ücretsiz (dokunma doğruluğu) |
| Aynala: "Orijinal kalsın" düğmesi — seçimden sonra komut çubuğunda, açık = kopya, kapalı = kaynak silinir; soru kutusu kalktı (v7.59) | Aynala aracı | var olan aracın kademesi |
| Aynala: X / Y düğmeleri — ayna çizgisi yatay ya da düşey, tek noktayla (AutoCAD'de ikinci noktada ORTHO) (v7.60) | Aynala aracı | var olan aracın kademesi |
| Ortho komutla birlikte: koordinat giriş satırında Ortho düğmesi (nokta istenen her adımda), kalem / parmak önizlemesi kısıtlı noktayı gösterir (v7.61) | komut çubuğu | ücretsiz (yardımcı) |
| Köşe tutamakları: kip açıkken boşta dokunuş nesneyi seçer ve tutamakları çıkarır (düzeltme, v7.61) | Düzenle ▸ Köşe tutamakları | premium (grips) |
| Kalemli cihaz: boşta gezinirken yakalama yok, değer isteminde kendiliğinden odak, düşürülen parmağın tutamak jesti kapanır, kalem kipinde parmak tutamağı sürükler (v7.62) | kalem / dokunma | ücretsiz (doğru çalışma) |
| Tutamaklar %75 boyuta indi; dokunma yarıçapı aynı (v7.64) | seçim kutusu, köşe tutamakları | var olan yeteneklerin kademesi |
| Doğrudan uzaklık girişi: Çizgi / Polyline'da kutudaki sayı kadar dokunulan yönde ilerleme (AutoCAD direct distance entry) (v7.65) | Çiz ▸ Çizgi, Polyline | var olan araçların kademesi |
| Köşe tutamağı sürüklenirken başka nesnelerin yakalama noktalarına oturur; sürüklemede işaret; kendi eski yerine yapışmaz (v7.65) | Düzenle ▸ Köşe tutamakları | premium (grips) |
| Çoklu seçimde köşe tutamakları: seçili bütün yolların düğümleri, çakışan köşeler birlikte (tek geri alma), 100 nesne / 400 düğüm sınırı, nesne başına 200'ü aşan yol atlanır (v7.69) | Düzenle ▸ Köşe tutamakları | premium (grips) |
| İzlemede uzantı yolları: çizgi doğrultusu, yay çemberi, iki uzantının kesişimi, genişletilmiş kesişim; EXT yakalama kipinden bağımsız (v7.74), EXT varsayılan (v7.70) | Ölçü ▸ Yakalama izi, yakalama ayarları | var olan yakalamanın kademesi |
| Tarama / Sınır / Dolgu alanı ayrı çizgi, yay ve polyline parçalarından kapalı alanı bulur (en küçük yüz) (v7.70) | Çiz ▸ Tarama, Sınır; Ölçü ▸ Dolgu alanı | aracın kendi kademesi |
| Desen seçicide her desenin SVG önizlemesi (kartlı liste) (v7.70) | Çiz ▸ Desen | premium (hatchpat) |
| Özellikler'de nesne türü süzgeci: Tümü / Çizgi (3) / Daire (2), seçim türe daralır (v7.70) | Düzenle ▸ Özellikler, seçim menüsü | premium (props) |
| Dinamik okuma: çizim yaparken taban noktadan imlece uzaklık ve açı, lastik bant (v7.71) | imleç etiketi, büyüteç | var olan aracın kademesi |
| RAR5 arşivleri açılır (WinRAR 5+ varsayılan biçimi): saf Java çözücü, katı arşivler, süzgeçler, CRC32; RAR 2/3/4 junrar ile (v7.74) | Dosya Aç ▸ arşiv, belge kipi | ücretsiz |
| Çizgi uzantısı yönünde izleme yakalaması dokunuşla: taban noktanın (son nokta) parçası ucundaysa uzantısı edinme gerekmeden yol (EXT kipine bağlı) (v7.73) | bütün nokta istemleri; Ölçü ▸ Yakalama izi | ücretsiz (otrack) |
| Blok yap / Blok ekle (ölçek, dönüş, öznitelik formu, MINSERT) / Bloklar paneli (yeniden adlandır, değiştir, kütüphaneye, WBLOCK, PURGE) / NCOPY / BASE (v7.72) | Düzenle ▸ Blok yap, Blok ekle, Bloklar, Blok içinden kopya, Taban; seçim menüsü ▸ Blok | premium (t:block, t:insert, blocks, t:ncopy, t:base) |
| Blok düzenleyici (BEDIT / BSAVE / BCLOSE) ve yerinde düzenleme (REFEDIT / REFCLOSE, solgun arka plan) (v7.72) | Düzenle ▸ Blok düzenle, Yerinde düzenle; seçim menüsü ▸ Blok düzenle | premium (t:bedit, t:refedit) |
| Öznitelik tanımı (ATTDEF), ATTSYNC, BATTMAN, ATTDISP (v7.72) | Düzenle ▸ Öznitelik tanımı; komut satırı | premium (t:attdef; düzenleme t:attr) |
| Dinamik blok: BPARAMETER (doğrusal taşı / esnet, döndürme, çevirme, nokta, görünürlük), BVSTATE, yerleştirmede özel tutamaklar, değerler Özellikler'de (v7.72) | blok düzenleyici çubuğu ▸ Parametreler; komut satırı | super (t:bparam, t:bvstate) |
| Harici referans: XATTACH (DWG / DXF, ekleme noktası, ölçek, dönüş), XCLIP dikdörtgen, XBIND, boşalt / yeniden yükle / ayır, XOPEN, solgunluk (v7.72) | Menü ▸ Harici referanslar; komut satırı | premium (xattach, t:xclip, xbind) |
| Hizala (ALIGN: 1 çift taşı, 2 çift taşı + döndür, Ölçek düğmesi) (v7.72) | Düzenle ▸ Hizala | premium (t:align) |
| Maske (WIPEOUT: köşelerden ya da kapalı polyline'dan; WIPEOUTFRAME çerçeve anahtarı) (v7.72) | Çiz ▸ Maske; komut satırı | premium (t:wipeout) |
| Çizim sırası (DRAWORDER: öne / arkaya / üstüne / altına; TEXTTOFRONT, HATCHTOBACK; seçim menüsünde Öne getir / Arkaya gönder) (v7.72) | Düzenle ▸ Çizim sırası; seçim menüsü | premium (t:draworder) |
| Özellikler paletinde nesnenin düzenlenebilir alanları: çizgi uçları, daire / yay merkez–yarıçap–açı, polyline kapalı / genişlik, yazı içerik–yükseklik–dönüş–konum, nokta XYZ, yerleştirme konum–dönüş–ölçek–öznitelik–dinamik değer, çizgi kalınlığı (v7.72) | Düzenle ▸ Özellikler, seçim menüsü | premium (props) |
| Nesne yakalama izleme (AutoCAD OTRACK, F11): yakalama noktasında bekleyince iz noktası (+), yatay / düşey (kutupsalda açılı) hizalama yolları ve kesişimleri, ortho kilidiyle kesişim, İz noktası (TT) düğmesi Ortho'nun yanında, Yakalama izi karosu (v7.66) | Ölçü ▸ Yakalama izi, Ekran ▸ Yakalama izi, komut çubuğu | var olan yakalamanın kademesi (kalemle gezinme premium) |
| Çokgen (POLYGON), Böl (DIVIDE), Aralıkla (MEASURE), Sınır (BOUNDARY) (v7.67) | Çiz ▸ Çokgen, Böl, Aralıkla, Sınır | premium |
| Esnet (STRETCH, kesen pencere içindeki köşeler), Birleştir (JOIN), Özellik eşle (MATCHPROP) (v7.67) | Düzenle ▸ Esnet, Birleştir, Özellik eşle | premium |
| Benzerini seç (SELECTSIMILAR / QSELECT), Gizle / İzole et / Hepsini göster (HIDEOBJECTS / ISOLATEOBJECTS / UNISOLATEOBJECTS), ZOOM seçenekleri (Z W / P / E / A / O / 2X), eş anlamlılar (LENGTHEN, RENAME, DDVPOINT, GEOMARKME) (v7.67) | Düzenle ▸ seçim grubu, seçim menüsü, komut satırı | free (seçim ve görünümün kademesi) |
| Kes (CUTCLIP): seçimi panoya alıp siler (v7.67) | Düzenle ▸ Kes, seçim menüsü | premium (pano) |
| Ölçümü çizime işaretleme | Açıklama ▸ Ölçümü işle | premium |
| Revizyon bulutu | Açıklama ▸ Revizyon bulutu | premium |
| Numaralandırma (balon, artan) | Açıklama ▸ Numaralandır | premium |
| Artımlı kopya: dikdörtgen, kutupsal (merkez dokunuşla) ve yol dizisi (ARRAYPATH: sayıyla / aralıkla, kopyalar yola döner), kat artımı (Z); ARRAYRECT / ARRAYPOLAR / ARRAYPATH doğrudan (v7.68) | Düzenle ▸ Dizi, komut satırı | premium (dizi türleri Dizi'nin basamağını taşır) |
| Yazı yüksekliğini değiştirme | Düzenle ▸ Yazı yüksekliği | premium |
| Çizimde bul-değiştir | Düzenle ▸ Bul-değiştir | premium |
| Öznitelik düzenleme | Düzenle ▸ Öznitelik | premium |
| Explode (patlatma) | Düzenle ▸ Patlat | premium |
| Tarama (hatch) oluşturma | Açıklama ▸ Tarama | premium |
| Kalınlık (extrusion) atama | Düzenle ▸ Kalınlık | super |
| Dolgu alanı ölçümü | Ölçü ▸ Dolgu alanı | **ücretsiz** |
| 3B açıklama | 3B ▸ 3B açıklama | super |

Ölçülendirme, iç modelde gerçek bir DXF `DIMENSION` varlığı değil **çizilmiş geometridir**
(uzatma çizgileri + ölçü çizgisi + dolu ok başları + yazı). Bu bilinçli bir karardır:
mobil çekirdekte ölçü stili yoktur, geometri her okuyucuda birebir aynı görünür ve DXF'e
sorunsuz yazılır. Bedeli açıktır: **ilişkisel değildir** — ölçülen nesne taşınırsa ölçü
değeri kendiliğinden güncellenmez, ve AutoCAD'de ölçü nesnesi olarak düzenlenemez.
Parçalar `gid` ile gruplanır (biri seçilince hepsi seçilir) ve `itype: DIMENSION` damgası
taşır, böylece "Ölçüleri gizle" süzgeci ok başlarını da gizler.

**v7.56'dan itibaren uygulama içinde düzenlenebilir.** Her ölçü, DIMENSION parçasının
`ent.def` alanında tanımını taşır (tür, tanım noktaları, yazı / ok / uzatma ölçüleri,
ondalık, ön / son ek, çarpan, yazı geçersiz kılması); "Ölçüyü düzenle" kutusu tanımı
değiştirip ölçüyü yeniden kurar (`replace` işlemi, tek geri alma). Taşıma, döndürme,
ölçekleme, ayna, kopya, pano ve blok kütüphanesi tanımı da taşır. Dosyadan gelen
`DIMENSION` varlıkları (hizalı, dönük, yarıçap, çap, açısal) ilk düzenlemede tanım
noktalarından ve etkin ölçü stilinden çevrilir; ordinat, yay ve blok içindeki ölçü
düzenlenemez ve bu açıkça söylenir. DXF'e yazılan yine geometridir: AutoCAD'de ölçü
nesnesi olarak açılmaz.

### 3. Ağır — yeni altyapı ister · **v7.29'da tamamlandı**

| Özellik | Nasıl çözüldü | Kademe |
|---|---|---|
| 3B geometrik ölçüm ailesi (7 ölçüm) | `measure3d.js` — nokta-doğru, nokta-düzlem, doğru-doğru, doğru-düzlem, düzlem-düzlem, düzlemler arası açı, akıllı açı | super |
| Blok kütüphanesi (oluştur / kaydet / ekle) | `blocklib.js` — cihazda saklanan JSON kütüphane | premium |
| Pano ile dosyalar arası yapıştırma | aynı çekirdek, `clipboard` anahtarı | premium |
| Toplu (batch) işlem | `app.js` — çoklu dosya seçici + rapor / metin / DXF / PDF | super |
| 3B biçim dönüştürme (OBJ / STL) | `export3d.js` — ikili ve ASCII STL, Wavefront OBJ | super |
| Tablo çıkarma | `tablex.js` — çizilmiş ızgaradan satır/sütun okuma | premium |
| PDF→CAD | `pdfcad.js` — pdf-lib ile içerik akışı çözülüp yorumlanır | super |

**3B ölçüm ailesi neden kolay çıktı.** Yedi ölçümün hiçbiri kenar ya da yüzey seçimi
istemiyor: hepsi yalnız NOKTALARLA tanımlanabiliyor (nokta-doğru 3 nokta, düzlem-düzlem
6 nokta). Var olan `pickVertex` yettiği için ışın-üçgen kesişimi hiç gerekmedi.

**PDF→CAD'in gerçek sınırları.** Yalnız vektör içerik çevrilir; gömülü resimler, kırpma
yolları, saydamlık ve gölgelendirme aktarılmaz. Metinde harf ilerlemesi glif genişliğinden
değil kabaca hesaplanır, Type0 / Identity-H fontlu yazılar atlanır — bunu kapatmanın tek
yolu pdf.js'i yalnız `getTextContent` için yüklemektir (APK'ya ~1 MB). Taranmış (resim) PDF
zaten vektör taşımaz; uygulama bu durumu ayrı bir iletiyle söyler.

**Toplu işlemin dürüst tarifi.** Dosyalar sırayla AÇILIR: çözümleme işçide yapılır, sahne
uygulamaya kurulur, işlem uygulanır. "Arka planda" iş görmek daha zarif görünürdü ama PDF
çıktısı çizim ardalanının tamamını (katman görünürlüğü, tema, ölçek çubuğu) kullanır; ayrı
bir yol açmak iki ayrı doğruluk kaynağı demekti. İşlem bitince açık olan çizim geri gelir.

### Rakipte hiç olmayan üstünlüklerimiz

Pencereli DWG okuma (7,09 milyon nesnelik dosyayı açabilme) · kot/eğim profili ·
yalnız değişenleri DXF yazma · ofis belgesi açma **ve düzenleme** + yeni dosya
oluşturma · GPS, harita altlığı, ITRF96/ED50 dâhil koordinat sistemleri ·
XREF ve eksik resim bağlama · notta fotoğraf iğnesi · kullanıcının **kendi**
bulutu (Drive + WebDAV/Nextcloud) — rakibin 10 GB'lık satıcı deposundan hem
sınırsız hem gizlilik açısından üstün · ZIP/RAR gezgini · onbeş dil ·
eldiven kipi ve güneş modu.

### Kademe hizalaması — YAPILDI (v7.48)

DWG FastView'ün "Open an account" ekranı satır satır çıkarıldığında beş
özelliğimizin rakipten bir basamak yukarıda durduğu görüldü: aynı parayı
ödeyen kullanıcı bizde daha azını alıyordu. Başvuru sahibinin kararıyla
beşi de Premium'a indirildi:

| Özellik | Kimlik | Eskiden | Şimdi | Rakipte |
|---|---|---|---|---|
| PDF→CAD | `pdfcad` | super | **premium** | Premium |
| Toplu işlem | `batch` | super | **premium** | Premium |
| Çizim karşılaştırma | `compare` | super | **premium** | Premium (Windows) |
| Drive'a yükleme | `driveUpload` | super | **premium** | Premium (bulut) |
| Yüzey / yanal alan | `area3d` | super | **premium** | Premium (mobil) |

**Super'i ayıran iki özellik yerinde kaldı** ve mağaza metninde Super bu iki
satırla anlatılmalıdır — ikisinin de rakipte hiçbir kademede karşılığı yoktur:

- `profile` — kot / eğim profili (her parçada uzunluk, Δh, ‰ ve %, kümülatif Σ)
- `savedelta` — yalnız değişenleri DXF olarak teslim etme

Hizalamanın kendisi toplamı değiştirmedi (65); dağılımı değiştirdi:
Premium 47 → **52**, Super 18 → **13**. Toplam daha sonra aynı sürümde
eklenen yeteneklerle **75**'e çıktı (aşağıya bakınız): katman düzenleme ve
desen seçici ile 70, budama ailesi ve köşe tutamağıyla 75; bugünkü dağılım
Premium **61**, Super **14**; gelişmiş kalem desteğiyle toplam **76**'ya çıktı
(Premium 62).

**Kart metni kapıdan türemez.** Paket kartındaki madde listesi
`tierFeat_*` anahtarlarından okunur (`edition.js` `featureList`), kapı ise
`FEATURE_TIER`dan. İkisi ayrı yerlerde durduğu için kapı bir şey yapıp kart
başka bir şey söyleyebilir. Bu yüzden 15 dil dosyasının tamamı elle
güncellendi ve `tools/test_lock.mjs` 15a-15d denetimleri eklendi: beş
kimliğin kapısı, Super'in iki ayırt edici özelliği ve kartın sözü birlikte
sınanır.

### Rakipte olup bizde olmayan düzenleme araçları — YAPILDI (v7.48)

Rakip karşılaştırmasında altı başlık "bizde yok" ya da "kısmen" çıktı ve
hepsi kapatıldı. Dördü klasik 2B düzenleme, biri katman yönetimi, biri
tarama:

| Yetenek | Kimlik | Kademe | Ne yapar |
|---|---|---|---|
| Budama | `t:trim` | premium | Kesici kenara, sonra atılacak parçaya dokunulur; kesici korunur, araç sürer |
| Uzatma | `t:extend` | premium | Sınıra, sonra uzatılacak uca dokunulur; sınırlı kesişim yoksa kenarın sonsuz doğrusuna düşülür |
| Kavis | `t:fillet` | premium | İki doğruya dokunulup yarıçap yazılır; aynı polyline'da yay yolun İÇİNE girer |
| Pah | `t:chamfer` | premium | İki doğruya dokunulup mesafe yazılır |
| Köşe tutamakları | `grips` | premium | Seçili yolların (çoklu seçimde de) her düğümü sürüklenir, çakışan köşeler birlikte; bırakış yakalamaya oturur |
| Katman düzenleme | `layeredit` | premium | Katman yöneticisi (AutoCAD Layer Properties Manager düzeni): ad, renk (ACI ızgarası), çizgi tipi, kalınlık, açık / donuk / kilitli hücre içinde; silme nesneleriyle birlikte tek geri-al adımı; `-LAYER` komut satırı |
| Tarama deseni | `hatchpat` | premium | ANSI31/32/33/37, NET, LINE, DOTS, CROSS, EARTH, GRAVEL |

Dördü de **düz segmentler** üzerinde çalışır; yay, daire ve elips
hedeflerinde araç "bu nesnede düz kenar yok" der ve belgeye dokunmaz. Yay-yay
kavisi, çoklu seçimle toplu budama ve kesici kenarsız (serbest) budama bu
sürümün dışındadır.

Geometriyi yeniden yazan tek bir komut eklendi: **`reshape`**. Var olan
`xform` yalnız afin matris uygular; budama, kavis ve tek köşe taşıma afin
değildir. Bölünme (budamada ortadan kesme) ve kavis yayının ayrı ilkel
olarak eklenmesi için yeni op yazılmadı — var olan `group` ikisini tek geri
alma adımı yapıyor.

**Köşe tutamağı varsayılan KAPALIDIR.** Bir polyline'ın düğümleri çoğu zaman
seçim kutusunun köşelerine denk gelir (dikdörtgende birebir); açık bırakılsa
kutuyla ölçekleme yapılamaz hâle gelirdi. Karodan açıldığında düğüm önceliği
kazanır. `tools/test_budama.mjs` bunu ölçüyor (15a-15e).

### Kalem desteği — YAPILDI (v7.49)

Rakibin hiçbir kademesinde kalem için ayrı bir söz yoktur; bizde altı yetenek vardır.
Ayrım bilinçlidir ve iki gruba bölünür:

| Yetenek | Kimlik | Kademe | Gerekçe |
|---|---|---|---|
| Kalem tanıma | — | **ücretsiz** | Özellik değil, doğru çalışma |
| Avuç reddi | — | **ücretsiz** | Olmadan uygulama kalemli cihazda bozuk görünür |
| Havada önizleme | `pen` | premium | Uç değmeden konum, yakalama ve koordinat |
| Silgi ucu | `pen` | premium | Kalemi ters çevirince nesne silinir |
| Yan düğme görevi | `pen` | premium | Menü / sil / yakalama / geri al / yok |
| Basınca göre kalınlık | `pen` | premium | Not kaleminin serbest çizgisinde |
| Kalem çizer, parmak gezinir | `pen` | premium | Masaüstündeki fare/klavye ayrımının karşılığı |

**Avuç reddini paranın arkasına koymamak bir pazarlama kararı değil, doğruluk kararıdır.**
Kalemli bir telefonda avuç reddi yoksa kullanıcı "uygulama bozuk" der ve siler; o kullanıcı
Premium'u hiç görmez. Kilitlenecek olan, uygulamanın çalışması değil, fazladan verdiğidir.

Yetenek toplamı 75 → **76** (yalnız `pen` sayaca girer): Premium **62**, Super **14**.

**Cihaz adına göre hiçbir kural yazılmamıştır.** "Samsung ise şunu yap" biçiminde bir dal
yoktur; İşaretçi Olayları (Pointer Events) standardı ne veriyorsa o okunur, böylece adını
bilmediğimiz kalemler de çalışır. Standardın garanti etmediği iki şey — basınç ve temas
büyüklüğü — varsayılmaz, ÖLÇÜLEREK öğrenilir: basınç bildirmeyen bir kalem temas ettiği
sürece sabit 0,5 verir, bu yüzden değerin gerçekten oynadığı görülene kadar "basınç var"
denmez.

**Apple Pencil hakkında dürüst not:** uygulama Android'dir, iPad'de kurulmaz. Apple Pencil
desteği, görüntüleyicinin tarayıcıda açılan web sürümü için geçerlidir — iPadOS Safari
kalemi aynı standart alanlarla bildirir, bu yüzden aynı kod yolu çalışır. Mağaza metninde
bu ayrım korunmalı, "Apple Pencil destekli Android uygulaması" gibi yanıltıcı bir cümle
kurulmamalıdır.

### AutoCAD komut uyumu — YAPILDI (v7.50)

Hedef kullanıcı AutoCAD kaslıdır. Rakip DWG FastView'de komut satırı **yoktur**; bizde
vardır ve AutoCAD adlarıyla çalışır. Bu, mağaza metninde öne çıkarılması gereken bir
ayırt edicidir.

Kapsam (v7.56): **458 kayıt, 663 ad ve kısaltma** — 158 çalışan AutoCAD adı, 31
uygulamaya özgü ad, 269 tanınan ama bulunmayan AutoCAD komutu (DIMEDIT v7.56'da çalışır oldu). Kaynak `IPARD` değil,
uygulamanın kendi `viewer/acad.js` dosyasıdır ve tektir — komut satırı, İngilizce arayüz
etiketleri ve yardım listesi hepsi oradan okur. (v7.50'de 86 komut / 144 addı.)

**Tanınan ama bulunmayan komut (v7.52).** Klavye-fare kipinde AutoCAD kaslı kullanıcı en
sık kullandığı komutları yazar; POLYGON, STRETCH, PEDIT, EXTRUDE, MATCHPROP gibi bizde
karşılığı olmayanlar `avail:false` ile tablodadır. Yazıldığında "bilinmeyen komut" denmez,
bulunmadığı ve varsa en yakın karşılığı söylenir; öneri listesinde soluk durur, komut
listesinde üçüncü bölümdedir. Bu sınıf **satılmaz**: mağaza metninde "300 AutoCAD komutu"
denemez, doğrusu "158 çalışan AutoCAD komutu; 269 komut daha tanınır ve en yakın karşılığı
söylenir"dir. "En sık kullanılan 300" sıralamasının yetkili bir kaynağı yoktur; liste
acad.pgp kısaltma tablosu + şerit panelleri + eğitim müfredatlarından derlendi, `acad.js`
başlığında yazar.

**Kademe etkisi yok.** Komut satırı ücretsizdir; komutun kendisi hangi kademedeyse kapı
orada çalışır (LINE yazan ücretsiz kullanıcı yükseltme kutusunu görür, bugünkü karo
davranışının aynısı). Yetenek sayacı komut satırıyla **76'da kaldı** (v7.56'da ölçü
özelliklerini düzenlemeyle 77): komut satırı yeni bir yetenek
açmaz, var olanlara ikinci bir kapı verir.

**Mağaza metninde dikkat edilecek üç nokta:**

1. "AutoCAD uyumlu komutlar" denebilir; **"AutoCAD ile uyumludur"** ya da Autodesk'in
   onayını ima eden bir ifade kullanılamaz. AutoCAD, Autodesk'in tescilli markasıdır;
   bizimki nominatif kullanımdır (ürünü tarif etmek için adını anmak).
2. Autodesk'in **simge çizimleri kopyalanmamıştır.** Üç simge (ERASE, COPY, EXPLODE) CAD
   sektörünün paylaştığı gösterim diline çevrildi — silgi, nesne+kopyası, kenarlarına
   ayrılan nesne — ama çizim bize aittir. Bu ayrım korunmalı; mağaza görsellerine
   Autodesk arayüzünden alınmış hiçbir parça konmamalıdır.
3. AutoCAD'de karşılığı **olmayan** 30 yeteneğimiz komut listesinde ayrı bölümdedir ve
   öyle kalmalıdır. "458 AutoCAD komutu" demek yanlış olur; doğrusu **"158 çalışan
   AutoCAD komutu + 31 uygulamaya özgü komut + 269 tanınan ama bulunmayan komut"**tur.

### Masaüstü kipi — YAPILDI (v7.51)

Klavye-fare bağlı bir tablet ya da Samsung DeX, hedef kullanıcının sahada değil **ofiste**
kullandığı düzenektir. Orada uygulama masaüstü CAD gibi davranır: orta tuş kaydırır, sağ tuş
Enter'dır, harf yazmak komut satırına düşer, F8 ortho açar.

**Kademe etkisi yok — masaüstü kipi ücretsizdir.** Avuç reddiyle aynı gerekçe: fare bağlı bir
cihazda orta tuşun kaydırmaması bir özellik eksikliği değil, bozukluktur. Yetenek toplamı
**76**'da kaldı.

İki yeni çizim yeteneği geldi ve ikisi de ücretsiz kipin parçasıdır:

| Yetenek | Tuş | Ne yapar |
|---|---|---|
| Ortho | F8 | Noktayı yatay ya da düşeye kilitler |
| Kutupsal izleme | F10 | Noktayı açı adımına oturtur (5/10/15/30/45°), uzaklığı korur |

Öncelik AutoCAD'deki gibidir: **yakalama** ortho'yu yener, **ortho** kutupsalı yener.

**Mağaza metninde:** "klavye ve fare ile masaüstü gibi" cümlesi rakipte karşılığı olmayan bir
ayırt edicidir ve DeX kullanan kurumsal alıcıya doğrudan hitap eder. Karşılığı olmayan işlev
tuşlarının (F9, F11, F12) **bilerek boş bırakıldığı** da yazılabilir; bu, "AutoCAD'i taklit
ediyoruz" değil "AutoCAD'i biliyoruz" mesajı verir.

### Fiyatlar değişmedi

Rakibin Eylül 2026 TR fiyatlarına göre konumumuz korunuyor: Ad-Free
−%27 aylık / −%40 yıllık, Premium −%28 / −%32, Super −%26 / −%13.
Rakipte Premium yıllık (2.499,99) ile Super yıllık (2.539,99) arasında
yalnız **%1,6** fark var — onlarda Premium yıllık ölü üründür. Bizde bu
fark %29, aylıkta %60'tır; iki üründe de yükseltmenin gerekçesi vardır.
Fiyata dokunmak bu yapısal avantajı bozardı.

## Paket kartının görünümü

Panel `edition.js renderProPanel` / `tierCard` tarafından üretilir, biçemi
`app.css`in "Pro paneli" bölümündedir. Tasarımın bağlayıcı kuralları:

- **Her kademenin bir kimlik rengi vardır** ve o renk kartta dört yerde
  tekrarlanır: üst şerit (`.tier-strip`), simge çipi (`.tier-ic`), satın
  alma düğmesi ve kart çerçevesi. Renkler `:root` belirteçleridir —
  `--t-adfree` (mavi), `--t-premium` (turuncu), `--t-super` (mor); kartın
  kendi `--t` değişkeni bunlardan birine bağlanır, hiçbir yerde sabit renk
  yazılmaz. Düğme yazısı `--t-ink`tir ve açık temalarda beyaza döner.
- **Fiyat kodda tutulmaz.** Aylık fiyat Play'den gelen dizedir; yanındaki
  "/ay" `perMonth` anahtarından okunur. Yıllık düğmedeki **−%NN** tasarruf
  rozeti de yazılmaz, `priceNum()` iki fiyatı sayıya çevirip `savingOf()`
  ile `1 − yıllık / (12 × aylık)` hesabından bulunur ve yalnız oran
  %5-%95 arasındaysa basılır. Fiyat Play'de değişince rozet kendiliğinden
  doğru kalır; tabloyu elle güncellemek gerekmez.
- **"En çok seçilen" kurdelesi** (`tierPopular`) yalnız **Premium**
  kartındadır. Orta paketi işaretlemek klasik üç paket kurgusunun
  parçasıdır; hangi kartta duracağı `renderProPanel` içinde tek yerde
  yazılıdır.
- **Madde listesi yine `tierFeat_*` anahtarlarından gelir**; `|` ile
  ayrılan parçalar onay imli satırlara açılır. Yani bir özellik paket
  değiştirdiğinde düzeltilecek yer değişmedi (i18n.js + `lang/` altındaki
  on üç dosya).
- Panelin başındaki bant (`.pro-hero`) ücretsizken tanıtım metnini,
  abonelikte etkin paketi ve kaynağını gösterir.

Görüntüler `tools/shot_pro.mjs` ile altı düzende (beş tema + büyük yazı)
alınır: `tools/out/pro/`.

## Kilitli özellik nasıl gösterilir (v7.31)

v7.30'a kadar yetki yetmeyen şerit karosu, sekme ve menü satırı **eleniyordu**. Bu,
paket farkını gizliyordu: o günkü 67 kapılı kimliğin 63'ünün şeritte / menüde bir girişi var
(tablo bugün 102 kimlik taşır: 86 Premium, 16 Super),
yani ücretsiz kullanıcı uygulamanın yeteneklerinin neredeyse tamamını hiç göremiyordu.
Artık eleme yok.

**Sözleşme (tek satır, sınanabilir):**

```
kilitli(kimlik) ⇔ el.hasAttribute('data-need') ⇔ el.querySelector('.lk')
Super pakette: document.querySelectorAll('[data-need], .lk').length === 0
```

`tools/test_lock.mjs` bunu dört basamakta bütün yüzeylerde sınar ve beklenen kümeyi
**elle yazmaz**: her denetim `Ed.has()` / `Ed.need()` ile karşılaştırılır. FEATURE_TIER
değiştiğinde sınama kendiliğinden doğru kalır.

**Tek kaynak `edition.js`:** `lockAttr(id)` · `lockBadge(id, kind)` · `lockBadgeFor(n, kind)`
· `lockText(id)` · `lockMark(el, id, kind)` · `syncLockText(root)` · `capabilityList()` ·
`unlockCount(x, from)`. Hiçbir üretici kendi rozetini kurmaz.

**İki biçim:**

| biçim | nerede | ne gösterir |
|---|---|---|
| `.lk-bar` kilit şeridi | şerit karosu, şerit sekmesi, simge-yalnız düğme | paket renginde 3 px çubuk |
| `.lk-pill` hap | ana ekran Araçlar, "Diğer" menüsü, belge Düzenle, Yeni dosya, bilgi çipi, uzun basış kutusu | paket ADI (`data-i18n="tier_*"`) |

**Neden yuvarlak değil, neden köşede değil.** Şeritte sağ üstteki 6 px yuvarlak zaten
"etkin" (`.tb-row button.on::after`), sol üstteki "sık kullanılan" (`.fav-mark::before`)
demektir ve ikisi de `var(--accent)` ile çizilir. `--accent`, dark / blueprint / sepia
temalarında `--t-premium` ile **aynı hex**tir. Kilit işareti yuvarlak ya da köşeye konsaydı
"turuncu yuvarlak = etkin" ile "kilitli" birbirine girerdi. Ayrımı renk değil **biçim ve
konum** verir. Kilitli denetim **soldurulmaz** da: `opacity` zaten iki anlam taşıyor
(`.4` = `disabled`, `.55` = "önce bir çizim aç").

**Renk hangi paket olduğunu söyler ama tek taşıyıcı değildir.** Dar yüzeyde paket kimliği
yalnız renktir (`--t-adfree` mavi, `--t-premium` turuncu, `--t-super` mor); bu bilinçli bir
sınırdır ve paket adı **dört yerde metinle** tekrarlanır: hap, uzun basış kutusu, ekran
okuyucuya okunan `.lk-vh` cümlesi ve panel dökümü. Bu tekrarlardan biri kaldırılırsa renk
körü kullanıcı için iddia çöker.

**Dokunuş akışı değişmedi:** kilitli denetim `disabled` EDİLMEZ (disabled düğme ne `click`
ne `pointerdown` üretir; rozet ölü süse döner ve uzun basış da çalışmaz), dokunuşta bugünkü
`gate()` kutusu açılır. Tek iyileştirme: panel artık `openProPanel(need)` ile **gereken
paketin kartında odaklı** açılır.

**Kilitli sekme vitrindir:** paket paneli açmaz, satırı açar. Böylece ücretsiz kullanıcı
Çizim'de 13, Düzenleme'de 22, Açıklama'da 15 aracı adıyla ve simgesiyle görür. Aynı hamlede
bir kusur kapandı: Açıklama sekmesinin kendisi ücretsizdi ama 15 karosunun tamamı elendiği
için satır boşalıyor ve favorilerin "Bir karoya uzun basarak buraya ekleyin" metni
basılıyordu.

**Ayar:** Ayarlar › Erişilebilirlik ve kullanım › "Kilitli araçları şeritte göster"
(`ui.showLocked`, öntanımlı **açık**). Yalnız şeridi etkiler; ana ekran Araçlar ızgarası,
menü, belge düğmeleri ve paket paneli rozetli kalır. Super pakette satır hiç çizilmez.
"Rozetleri kapat, karolar kalsın" seçeneği yoktur: o birleşim, dokunulduğunda gerekçesiz
kutu açan ölü karolar üretir.

**Kontrast düzeltmesi.** Açık temada `--t-premium` `#c8810b` idi: karo zemini (`--btn`)
üzerinde 2,56:1, grafik nesne eşiği olan 3:1'in altında. `#9a6208` yapıldı → 4,10:1; aynı
değişiklik paket kartındaki satın alma düğmesinde beyaz yazının 3,18:1'lik AA düşüşünü de
5,09:1'e çıkarır. Öteki beş temada hiçbir paket rengi eşiğin altında değildir.

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
