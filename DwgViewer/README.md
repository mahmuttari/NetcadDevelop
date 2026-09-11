# DWG Görüntüleyici (Android) — v4.0

AutoCAD **DWG** ve **DXF** çizimlerini telefonda açan, çevrimdışı çalışan
Android uygulaması. Dosya cihazdan dışarı çıkmaz; çözümleme telefonun
içinde yapılır. Su ve kanalizasyon altyapı paftalarıyla saha çalışması
için tasarlanmıştır: GPS konumu, köşe yakalamalı ölçü, boru profili,
notlar ve PDF çıktısı.

## Kurulum

1. `release/DwgGoruntuleyici.apk` dosyasını telefona indirin (ya da GitHub
   Actions'taki *DwgGoruntuleyici-apk* çıktısını alın).
2. Dosyaya dokunun; Android "bilinmeyen kaynaklardan yükleme" izni
   isterse verin.
3. Uygulama, dosya yöneticisi, e-posta ve WhatsApp'ta `.dwg` / `.dxf`
   dosyaları için "Birlikte aç" listesine kendiliğinden girer.

Gereksinim: Android 8.0 (API 26) ve güncel bir **Android System WebView**.
İzinler: konum (GPS, isteğe bağlı), kamera (QR, isteğe bağlı), internet
(harita altlığı, sunucudan pafta indirme, sürüm denetimi; hiçbir çizim
verisi gönderilmez).

## Özellikler

| Alan | Özellik |
|---|---|
| Dosya | DWG R13 – 2018 (AC1012 … AC1032), ASCII DXF (kod sayfası çözümlemeli, Türkçe karakterler); son dosyalar listesi küçük resimle; sunucudan (JSON liste / dizin / doğrudan adres) indirme ve çevrimdışı kopya; QR ile pafta açma |
| Gezinme | kaydırma, iki parmakla yakınlaştırma, çift dokunma, tümünü sığdır, **sayfa düzenleri** (layout sekmeleri, görünüm pencereleri kırpılarak model uzayı içeri çizilir), kayıtlı görünümler |
| Görünüm | katman paneli (arama, toplu aç/kapa), koyu/açık arka plan, tek renk, **çizgi kalınlıkları**, çizgi tipleri, yazı stilleri (STYLE tablosu), yazı gizleme |
| Sorgu | dokunulan nesnenin bilgisi (tür, katman, renk, çizgi tipi, kalınlık, uzunluk / alan / yarıçap / kot, **blok öznitelikleri**, **XDATA**, handle); koordinat kopyalama; arama (yazı, katman, blok, öznitelik, XDATA, handle) |
| Ölçü | **osnap** kümesi: END, MID, CEN, INT, PER, NEA, INS (blok ekleme noktası), NOD; uzaklık, ΔX/ΔY, açı, toplam, kapalı alan; metre karşılığı |
| Profil | ardışık bacalar arasında yatay mesafe, kot farkı, **eğim (‰ ve %)**, kümülatif mesafe; kot yakalanan noktanın Z'sinden gelir, yoksa elle girilir |
| Konum | **GPS "buradayım"**: ITRF96 TM27…TM45, WGS84 UTM 35/36/37, ED50 TM ve UTM, Web Merkator; çizim birimi ve eksen sırası (X=Kuzey) ayarı; ek kaydırma; konumu izleme; doğruluk dairesi ve yön |
| Altlık | OpenStreetMap, Esri uydu/topografik/sokak, özel XYZ, özel WMS (EPSG:3857); saydamlık |
| Notlar | kalem, çizgi, ok, dikdörtgen, daire, yazı, **fotoğraf iğnesi**; DWG'ye dokunulmaz, notlar dosya başına ayrı saklanır; PNG/PDF çıktısına basılır |
| Çıktı | PNG; **PDF** (A4–A0, dikey/yatay, 1:N ölçek ya da sığdır, antet: başlık, dosya, ölçek, birim, CRS, tarih, kuzey oku, ölçek çubuğu); paylaşım menüsü |
| Karşılaştırma | iki revizyonu üst üste bindirme: kaldırılan kırmızı, eklenen yeşil, ortak gri; sayılar |
| Referanslar | eksik **XREF** ve **resim altlığı** listesi; dosya seçilince yerine yerleştirme |
| Kabuk | Türkçe/İngilizce, tablet düzeni (katman paneli yan sütun), sürüm denetimi, hata kaydı paylaşma |
| **Arayüz (v4)** | şerit araç çubuğu: sekmeler › gruplar › SVG simgeli karolar (Görünüm · Ekran · Ölçü · Çiz · Düzenle · 3B); karoya **uzun basınca** açıklama ve **Sık kullanılanlara ekle** (Favoriler sekmesi en başta); etkin sekmeye ikinci dokunuşla şerit **katlanır**; yatayda şerit sağda dikey ray (sol el düzeninde solda); tablette grup başlıkları ve yan sütun (Katmanlar / Ekran); alt sayfalarda tutamak (aşağı sürükle → kapat, yukarı → büyüt); durum çubuğunda hızlı düğmeler (ızgara, kalınlık, yazı, nesne yakalama), ölçek seçici, kip çipi; gezinti düğmeleri (+ / − / sığdır / önceki görünüm / GPS), yön tuşları; erişilebilirlik: yazı boyutu, eldiven modu (büyük hedefler, geniş yakalama), sol el, yüksek kontrast, hareket azaltma, titreşim; ilk açılışta tanıtım turu |
| **Ekran seçenekleri (2B)** | tema (koyu, açık, blueprint, sepya, yüksek kontrast, sisteme uy), **güneş modu**, ön ayarlar (saha / ofis / baskı önizleme), özel arka plan rengi, görünürlük süzgeçleri (yazı, tarama, ölçülendirme, nokta, resim, öznitelik, blok, çizgi tipi), çizgi kalınlığı ölçeği ve en az kalınlık, renk modu (nesne / katman paleti / tek renk), ızgara (adım, çizgi/nokta), cetveller, artı imleç, ölçek çubuğu, kuzey oku, katman izolasyonu ve soldurma, seçim vurgusu rengi/kalınlığı, nokta biçimi, yazı eşiği, tarama saydamlığı, altlık saydamlığı; görünüm geçmişi (önceki/sonraki), pencereyle yakınlaştırma, koordinata git, ana görünüm |
| **Ekran seçenekleri (3B)** | stil (tel kafes, gizli çizgi, gölgeli, gölgeli+kenar, röntgen), renk (nesne / katman / **kot** / tek renk) ve kot lejantı, aydınlatma (yön, yoğunluk, ortam), zemin ızgarası (adım, kot), eksenler ve etiketler, pusula, **görünüm küpü** (yüz / köşe / kenar dokunuşu, sürükleyerek yörünge, çift dokunuşla sığdır), perspektif / ortografik ve görüş açısı, **düşey abartı** (kaydırıcı, ×1/×2/×5/×10), **kesit** (Z aralığı ve kesit kutusu), döner tabla, dokunma davranışı (tek parmak döndür/kaydır, dikey ters, hassasiyet), kot etiketleri, HUD, nokta boyu, çizgi kalınlığı, derinlik solması, seçileni öne çıkarma; 11 görünüm ön ayarı (üst, alt, ön, arka, sol, sağ, izometrik KD/KB/GD/GB); kamera **yer imleri** (küçük resimli, dosya başına); kamera geçmişi; 3B ekran görüntüsü |
| **Araç çubuğu** | alt kısımda sekmeli düğme çubuğu: (Favoriler) · Görünüm · Ekran · Ölçü · Çiz · Düzenle · 3B; komut satırı (adım adım yönerge, yazılı koordinat girişi `x,y` / `x,y,z` / `@dx,dy` / `@L<açı`, Bitir / Kapat / Geri / İptal düğmeleri) |
| **Çizim** | çizgi (zincirleme), polyline (açık/kapalı), dikdörtgen, daire (merkez + yarıçap noktası ya da yazılı yarıçap), yay (3 nokta), nokta, yazı, 3B polyline (kotlu), 3B yüzey; geçerli katman / renk seçimi, yeni katman oluşturma; tüm yakalama kipleri çizimde de geçerli |
| **Düzenleme** | seç (dokunarak ekle/çıkar, tümünü seç), taşı, kopyala (yineleyerek), döndür (yazılı açı ya da nokta), ölçekle, aynala (orijinali koru / korumama), ofset (mesafe + taraf), sil, kot ata, yazı düzenle, özellikler (katman/renk); sınırsız geri al / yinele; düzenlemeler dosya başına kalıcı (uygulama kapansa da korunur) |
| **Ölçüm araçları** | mesafe (yatay, ΔX/ΔY/ΔZ, 3B, açı), alan (m², dekar, hektar; çevre), açı (3 nokta), yarıçap/çap/çevre, koordinat (XYZ + enlem/boylam + kopyalama) |
| **3B görünüm** | WebGL: yörünge (tek parmak döndür, iki parmak kaydır/yakınlaştır), izometrik/üst/ön/sol ön ayarları, perspektif/ortografik, Z abartı çarpanı, ızgara ve eksenler, köşe yakalama; 3B mesafe (yatay, ΔZ, eğim), seçim, 3B taşıma, kot atama, silme, 3B polyline (köşeye dokunarak ya da x,y,z yazarak) |
| **Kaydetme** | **DXF** (AC1015): tüm çizim (bloklar patlatılmış, katmanlar ve çizgi tipleri korunur) ya da yalnız değişiklikler; paylaşım menüsüyle e-posta/WhatsApp/Drive'a gönderme |

Çizilen varlıklar: LINE, LWPOLYLINE, POLYLINE (2B/3B/çok yüzlü), CIRCLE,
ARC, ELLIPSE, SPLINE, POINT, TEXT, MTEXT, ATTRIB, INSERT (iç içe, dizili,
ölçekli, döndürülmüş), DIMENSION, HATCH, SOLID, 3DFACE, LEADER,
MULTILEADER, MLINE, XLINE, RAY, ACAD_TABLE, WIPEOUT, IMAGE, VIEWPORT.

Yapmadıkları: 3B katıları (3DSOLID/REGION) ve ikili DXF'i çizmez, SHX
yazı tipleri yerine sistem yazı tipini kullanır. **DWG olarak yazamaz**:
kullanılan LibreDWG WebAssembly derlemesinde yazma kapalıdır; düzenlemeler
DXF olarak kaydedilir (AutoCAD ve NetCAD doğrudan açar). Orijinal DWG
hiçbir zaman değiştirilmez. ED50 datum kaydırması ülke ortalaması
parametreleriyle yapılır (±2-5 m).

## Nasıl çalışır

```
DWG/DXF baytları ─► worker.js ─► LibreDWG (WASM) / dxf.js ─► scene.js (SceneBuilder)
                                                                 │  bloklar açılır, ilkeller üretilir
                                                                 ▼
                                   app.js  ◄─ render.js (tuval) ◄─ ilkel listesi + R-ağacı (geom.js)
                                     │
                                     ├─ proj.js (TM/UTM, datum), tiles.js (harita karoları)
                                     ├─ notes.js (redline), i18n.js (dil), state.js (durum)
                                     └─ Android köprüsü (MainActivity.java)
```

* **Android tarafı** (`MainActivity.java`): WebView; `assets/viewer`
  sahte bir https kökünden sunulur; seçilen / paylaşılan / indirilen
  dosyalar `/file/<id>` adresinde akıtılır; dosya seçici, son dosyalar,
  pano, konum, kamera izni, PNG/PDF kaydetme ve paylaşma (FileProvider),
  indirme deposu, küçük resimler, anahtar/değer deposu ve hata kaydı.
* **Çözümleme** bir Web Worker'da yapılır; arayüz kilitlenmez.
* **Düzenleme** (`edit.js`, `tools.js`, `editor.js`): her komut (ekle, sil,
  dönüştür, kopyala, kot ata, özellik, katman, yazı) bir günlüğe yazılır ve
  dosya anahtarına göre saklanır; dosya yeniden açıldığında günlük aynı
  sırayla uygulanır. Nesneler `handle#sıra` anahtarıyla izlenir. Geri al /
  yinele bellek içi anlık görüntülerle çalışır. DXF yazıcı ilkelleri LINE,
  LWPOLYLINE (bulge'lı), POLYLINE (3B), CIRCLE, ARC, TEXT/MTEXT, POINT, 3DFACE
  olarak yazar.
* **3B görünüm** (`view3d.js`): WebGL çizgi/üçgen tamponları, yörünge
  kamerası, köşe listesi üzerinden ekran uzayında yakalama.
* **Uzamsal indeks** (STR paketli R-ağacı) seçim, yakalama ve yakın
  ölçekte çizim için kullanılır; büyük paftalarda hareket sırasında
  önbellek görüntüsü kaydırılır.

## Derleme

```
cd DwgViewer
./gradlew assembleRelease        # app/build/outputs/apk/release/app-release.apk
```

JDK 17+, Android SDK (platform 34, build-tools 34.0.0) gerekir;
`local.properties` içinde `sdk.dir=…` verin. GitHub Actions
(`.github/workflows/dwgviewer-apk.yml`) her `DwgViewer/**` değişikliğinde
APK'yı derleyip *artifact* olarak yükler. `release/version.json`
uygulamanın sürüm denetiminde kullanılır; yeni sürümde
`versionCode`/`versionName` ile birlikte güncellenir.

APK `keystore/dwgviewer.jks` ile imzalanır (şifre `gradle.properties`).
Aynı anahtarla imzalanmayan bir sürüm kurulu sürümün üzerine yüklenemez.

## Tarayıcıda deneme / sınama

```
node tools/serve.mjs 8765          # http://localhost:8765/ — dosya seçiciyle aynı sayfa
PLAYWRIGHT_PKG=<playwright kurulu dizin> node tools/screenshot.mjs <çıktı> a.dwg b.dxf
```

Çekirdek LibreDWG'nin `test/test-data/example_*.dwg` dosyaları ve
Türkçe kod sayfalı bir DXF ile sınanmıştır (sahne kurma, R-ağacı,
yakalama, projeksiyon geri dönüşümü < 1 mm, ölçü, profil, notlar, PDF,
karşılaştırma, sayfa düzeni, GPS işaretçisi).

## QR kod biçimi

* `https://sunucu/paftalar/K-12.dwg#B-127` → paftayı indirir, açar ve
  `B-127` öznitelikli/yazılı nesneye yakınlaşır.
* `dwg://K-12.dwg#B-127` → açık çizimde `B-127` arar.
* Düz metin → açık çizimde arar.

## Sunucu pafta listesi biçimi

JSON: `{"paftalar":[{"ad":"K-12.dwg","url":"https://…/K-12.dwg"}]}`
(`files`/`name`/`url` anahtarları da geçerlidir) ya da `.dwg` bağlantıları
içeren bir HTML dizin listesi.

## Lisans

Çözümleyici LibreDWG'dir (GNU GPL v3); bu yüzden uygulamanın kaynak kodu
da GPL v3 ile dağıtılır. jsQR Apache-2.0 lisanslıdır. Harita altlıkları
kendi kullanım koşullarına tabidir (OpenStreetMap: ODbL; Esri: Esri
kullanım şartları).
