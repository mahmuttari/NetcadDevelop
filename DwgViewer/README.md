# DWG Görüntüleyici (Android) — v2.0

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

Çizilen varlıklar: LINE, LWPOLYLINE, POLYLINE (2B/3B/çok yüzlü), CIRCLE,
ARC, ELLIPSE, SPLINE, POINT, TEXT, MTEXT, ATTRIB, INSERT (iç içe, dizili,
ölçekli, döndürülmüş), DIMENSION, HATCH, SOLID, 3DFACE, LEADER,
MULTILEADER, MLINE, XLINE, RAY, ACAD_TABLE, WIPEOUT, IMAGE, VIEWPORT.

Yapmadıkları: 3B katıları (3DSOLID/REGION) ve ikili DXF'i çizmez, SHX
yazı tipleri yerine sistem yazı tipini kullanır, dosya kaydetmez/düzenlemez
(notlar ayrı tutulur). ED50 datum kaydırması ülke ortalaması
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
