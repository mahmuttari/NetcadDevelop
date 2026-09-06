# DWG Görüntüleyici (Android)

AutoCAD **DWG** çizimlerini telefonda açan, çevrimdışı çalışan Android
uygulaması. Dosya cihazdan dışarı çıkmaz; çözümleme telefonun içinde
yapılır.

## Kurulum

1. `release/DwgGoruntuleyici.apk` dosyasını telefona indirin (ya da GitHub
   Actions'taki *DwgGoruntuleyici-apk* çıktısını alın).
2. Dosyaya dokunun; Android "bilinmeyen kaynaklardan yükleme" izni
   isterse verin (Ayarlar → Uygulamalar → Özel uygulama erişimi →
   Bilinmeyen uygulamaları yükle).
3. Uygulama, dosya yöneticisi, e-posta ve WhatsApp'ta `.dwg` dosyaları
   için "Birlikte aç" listesine kendiliğinden girer.

Gereksinim: Android 8.0 (API 26) ve güncel bir **Android System WebView**
(WebAssembly desteği için Chrome 57+ tabanlı; 2017 sonrası her cihazda
vardır).

## Neler yapar

| Özellik | Açıklama |
|---|---|
| Sürüm desteği | DWG R13, R14, 2000, 2004, 2007, 2010, 2013, 2018 (AC1012 … AC1032) |
| Gezinme | tek parmak kaydırma, iki parmak yakınlaştırma, çift dokunma 2×, "tümünü sığdır" |
| Katmanlar | liste, arama, tek tek / toplu açma-kapama; dondurulmuş ve kapalı katmanlar başta gizli |
| Nesne bilgisi | dokunulan nesnenin türü, katmanı, rengi, çizgi tipi, uzunluk / alan / yarıçap / yazı içeriği, tanıtıcı (handle) |
| Ölçü | ardışık noktalar arası uzaklık, ΔX/ΔY, açı, toplam, kapalı alan; köşelere yapışır |
| Görünüm | koyu / açık arka plan, yazıları gizleme, çizim bilgisi (sürüm, birim, uzantılar, varlık sayıları) |
| Dışa aktarma | görünümün PNG'sini *Resimler/DWGViewer* klasörüne kaydeder |

Çizilen varlıklar: LINE, LWPOLYLINE, POLYLINE (2B/3B/çok yüzlü), CIRCLE,
ARC, ELLIPSE, SPLINE (kontrol ya da uydurma noktalı), POINT, TEXT, MTEXT,
ATTRIB, INSERT (iç içe, dizili, ölçekli, döndürülmüş bloklar), DIMENSION
(ölçü bloğu üzerinden), HATCH (sınır + dolgu), SOLID, 3DFACE, LEADER,
MULTILEADER, MLINE, XLINE, RAY, ACAD_TABLE, WIPEOUT, IMAGE çerçevesi.
Çizgi tipleri (kesikli, noktalı vb.) LTYPE tablosundan uygulanır.

Yapmadıkları: DXF okumaz (yalnız DWG), 3B katıları (3DSOLID/REGION)
çizmez, harici referansları (XREF) yüklemez, SHX yazı tipleri yerine
sistem yazı tipini kullanır, dosya kaydetmez/düzenlemez.

## Nasıl çalışır

```
DWG baytları ──► LibreDWG (WebAssembly) ──► DwgDatabase ──► SceneBuilder ──► Canvas
                 app/src/main/assets/viewer/lib/         app/src/main/assets/viewer/app.js
```

* **Android tarafı** (`app/src/main/java/.../MainActivity.java`, ~400 satır):
  bir `WebView` açar, `assets/viewer` klasörünü sahte bir https kökünden
  sunar, seçilen ya da başka uygulamadan gelen DWG'yi aynı kökte
  `/file/current` adresinde sayfaya akıtır; dosya seçici, PNG kaydetme,
  geri tuşu için köprü sağlar. Hiçbir ek kütüphane (AndroidX vb.) yoktur.
* **Görüntüleyici** (`assets/viewer/app.js`): LibreDWG'nin JS sarmalayıcısı
  (`@mlightcad/libredwg-web` 0.7.10) dosyayı çözer; `SceneBuilder`
  blokları açıp her varlığı dünya koordinatında yol / yazı / nokta
  ilkellerine çevirir; `render()` bunları tuvale çizer. Büyük çizimlerde
  hareket sırasında önbellek görüntüsü kaydırılır, hareket bitince tam
  çizim yapılır.

## Derleme

```
cd DwgViewer
./gradlew assembleRelease        # app/build/outputs/apk/release/app-release.apk
```

JDK 17+, Android SDK (platform 34, build-tools 34.0.0) gerekir; `local.properties`
içinde `sdk.dir=…` verin. Her `DwgViewer/**` değişikliğinde GitHub Actions
(`.github/workflows/dwgviewer-apk.yml`) APK'yı yeniden derleyip *artifact*
olarak yükler.

APK, `keystore/dwgviewer.jks` ile imzalanır (kendinden imzalı, şifresi
`gradle.properties` içinde). Aynı anahtarla imzalanmayan bir sürüm, kurulu
sürümün üzerine yüklenemez; anahtarı değiştirirseniz eski uygulamayı
kaldırıp yeniden kurmak gerekir.

## Tarayıcıda deneme / sınama

```
node tools/serve.mjs 8765          # http://localhost:8765/ — aynı sayfa, dosya seçiciyle
PLAYWRIGHT_PKG=<playwright kurulu dizin> node tools/screenshot.mjs <çıktı klasörü> a.dwg b.dwg
```

İkinci komut Chromium'da (telefon görünümünde) dosyaları açar, ekran
görüntüsü alır ve konsol iletilerini basar; LibreDWG'nin
`test/test-data/example_*.dwg` dosyalarıyla doğrulanmıştır.

## Lisans

Çözümleyici LibreDWG'dir (GNU GPL v3); bu yüzden uygulamanın kaynak kodu
da GPL v3 ile dağıtılır. Kurum içi kullanım ve dağıtım serbesttir;
uygulama dağıtılırken kaynak kodun da verilmesi gerekir.
