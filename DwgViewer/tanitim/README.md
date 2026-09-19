# Tanıtım videoları

İki tanıtım vardır ve birbirinin yerine geçmez: birincisi var olan bir projeyi **açıp
gezdirir**, ikincisi boş bir sayfadan başlayıp gözünüzün önünde **kat planı çizer**.

## 2 · Kat planı (v7.90) — `DWG_OfficeZip_kat_plani.mp4`

**`DWG_OfficeZip_kat_plani.mp4`** — 1080 × 2400 (dikey 9:20) · 30 kare/sn · 2:07 · H.264 + AAC
**`DWG_OfficeZip_kat_plani_sessiz.mp4`** — aynı görüntü, sessiz nüsha (kurgu kaynağı)
**`kat_plani_fon_muzik.m4a`** — fon müziği tek başına
**`kat_plani_sahneler.json`** — her sahnenin başladığı saniye

Yeniden çekmek için: `FFMPEG=<yol> node tools/promo2.mjs <klasör>`
Tek sahne: `node tools/promo2.mjs <klasör> 9,17` (sahne numaraları).

### Ne çiziyor

Boş bir çizim açılır ve **16,0 × 10,0 m = 160 m²**, **aynalı iki daireli** bir kat planı,
uygulamanın kendi komutlarıyla çizilir. Plan kullanıcının verdiği krokidir: ortada sırt
sırta iki servis çekirdeği (mutfak + banyo), iki yanda oturma ve yatak odaları.

| sn | Sahne |
|---|---|
| 0,0 | açılış kartı |
| 2,4 | yeni boş çizim (birim metre) |
| 5,8 | komut satırı: `REC` yazılır, öneri listesi açılır, `RECTANG` tamamlanır |
| 10,6 | dış duvar: `0,0` → `@16,10` |
| 15,0 | ötele ile 25 cm duvar kabuğu |
| 21,0 | iç bölmeler ve servis çekirdeği |
| 30,1 | kapılar: kanat çizgisi + açılım yayı (giriş, yatak odası, banyo) |
| 39,6 | bir pencere çizilir, **dizi** ile çoğaltılır |
| 44,3 | **aynala**: sol daire tek komutla sağa geçer, görünüm plana açılır |
| 53,4 | oda adları (Türkçe) |
| 59,3 | doğrusal ve hizalı ölçü |
| 66,7 | ıslak hacim taraması ve alan |
| 72,0 | katman söndürme / yakma (etki çizimin üstünde görülür) |
| 82,1 | on dört yakalama kipi |
| 86,0 | parmakla nişan aparatı |
| 92,0 | ölçüm |
| 98,1 | duvarlara kalınlık, üç boyuta geçiş, görsel stiller |
| 110,3 | hazır değeri olmayan bir mahal listesinin hesaplanması |
| 117,6 | DXF olarak kaydetme |
| 122,9 | kapanış |

### Üç kural — `tools/promo2.mjs` başlığında da yazılıdır

**1 · Özelliğin üstüne yazı gelmez.** Altyazı, gösterilecek şeyden ÖNCE görünür,
söyleyeceğini söyler ve kaybolur; asıl an ekranda yalnız uygulama vardır. Panel açan
sahnelerde (katman, yakalama, tablo, 3B) altyazı hiç durmaz. Sonuç okunacaksa iş bittikten
sonra, çizimin dışında kalan boş banda yazılır.

**2 · Marka adı geçmez.** Komut adları (RECTANG, OFFSET, MIRROR, DIMLINEAR…) sektörün ortak
dilidir ve ekranda görünür; altyazı bunu "komut satırı: bildiğiniz adlar" diye anar. Başka
hiçbir yazılımın adı ne altyazıda ne kartlarda geçer.

**3 · Hiçbir sayı elle yazılmaz.** Ekrandan okunur, altyazıya oradan geçirilir:

- **15 nesne** — aynalanan nesne sayısı, çizimin kendi sayımından.
- **5,188 m²** — banyo taramasının alanı, uygulamanın kendi iletisinden. Mahal listesindeki
  "Banyo 5,2 m²" satırı bu sayıyla tutarlıdır.
- **16 m · 10 m · 8 m** — ölçü yazıları, ölçü priminden.
- **8,051 m · ΔX 6,35 · ΔY 4,95 · 37,94°** — ölçüm panelinin kendi çıktısı ("END yakalandı").
- **`ofs:[0,-56]`** — nişan aparatının gerçek durumu: imleç parmaktan 56 px yukarıda.
- **`tris: 750` · 20 duvar** — kalınlık gerçekten uygulandı, 3B'deki kütle gerçek.
- **56,60 / 62,80 / 143,00 m² · 25,74 m² · 23.09.2025** — tabloda hazır değer YOKTUR
  (formül hücrelerinde `<v>` yazılmamıştır); dolu görünmesi hesabı uygulamanın yaptığı
  anlamına gelir.
- **`kat_plani_duzenlenmis.dxf`** — kaydetme sahnesinin kanıtı, tarayıcıya gerçekten inen
  dosyanın adı. (İlk çekimde bu sahne yalan söylüyordu: komut dosya adını soruyor, kutu
  cevaplanmadığı için hiçbir şey kaydedilmiyordu. Artık dosya inmezse sahne atlanır.)

### Kroki sözleşmesi

Bölme duvarları **sürekli** çizilir, kapılar üstlerine yay + kanat çizgisi olarak konur.
Böylece her oda kapalı bir alandır ve tarama ile alan ölçümü gerçekten çalışır. Hızlı
krokide yaygın olan yazımdır; duvarı kesmek ayrı bir iştir ve bu videonun konusu değildir.

### Bilinen sınırlar (dürüstlük notu)

- Kayıt masaüstü tarayıcısında, telefon kadrajıyla (360 × 800 CSS, 3× yoğunluk) alınmıştır;
  gerçek cihazda arayüz aynıdır, başarım farklı olabilir.
- Kalınlık komutu **Super** basamağındadır; ücretsiz ya da premium bir cihazda o sahnedeki
  komut yükseltme kutusunu açar.
- Tam plana yakınlaşıldığında tarama deseni yoğunlaşıp düz griye düşer; bu uygulamanın
  bilinçli davranışıdır (alt piksel desen → saydam dolgu), kayıt kusuru değildir.

---

## 1 · Gezinti (v7.88) — `DWG_OfficeZip_tanitim.mp4`

**`DWG_OfficeZip_tanitim.mp4`** — 1080 × 2400 (dikey 9:20) · 30 kare/sn · 88 sn · H.264 + AAC
**`DWG_OfficeZip_tanitim_sessiz.mp4`** — aynı görüntü, sessiz nüsha
**`fon_muzik.m4a`** — fon müziği tek başına (düzenlerken düzeyi değiştirmek ya da başka bir
parçayla değiştirmek için)

## Sonradan düzenlemek için

Kurgu kaynağı **sessiz nüshadır**: görüntü yeniden kodlanmamış kopyadır, ses ayrı dosyada durur.
Bir kurgu programına ikisini yan yana koyup kesmek, hızlandırmak ya da müziği değiştirmek
yeterlidir. Sıfırdan yeniden çekmek gerekirse `node tools/promo.mjs <klasör>` komutu hem videoyu
hem de `sahneler.json` dosyasını (her sahnenin başladığı saniye) üretir.

## Ne gösteriyor

Videodaki her kare uygulamanın **gerçek ekran kaydıdır**. Maket ekran, elle çizilmiş arayüz ya
da sonradan düzenlenmiş görüntü yoktur:

- Çizim, APK'nın içinde taşınan gerçek proje dosyasıdır: `MARFEN_YUZER_TERFI_2D.dwg`
  (7,75 MB · AutoCAD 2018 · 132.274 varlık · 6 katman).
- Ölçüm sonucu (14.877,17 mm = 14,88 m, ΔX / ΔY / açı) uygulamanın kendi hesabıdır.
- Katman satırındaki 11.080 sayısı katman yöneticisinin kendi saydığıdır.
- PDF, uygulamanın PDF çıktı kutusuyla gerçekten üretilmiştir (A3 · yatay · 1:500 · 150 dpi).
- Word, Excel ve ZIP dosyaları belge görünümünde gerçekten açılmıştır.

Sahne sırası: açılış kartı → ana ekran → örnek çizimin açılması (gerçek zamanlı) → gezinme →
katman yöneticisi → uçtan uca ölçü → komut satırı (LINE) → kırmızı kalem notu → ölçekli PDF →
GPS konumu → Word / Excel / ZIP → parmakla yakalama aparatı (büyüteç + aday çipleri) →
pencere / kesen kutuyla 1.526 nesnenin seçilmesi → 3B tesis modeli (döner tabla, beş görsel
stil, görünüm küpü) → kapanış kartı.

## Yeniden çekmek

```
node tools/promo.mjs <çıktı klasörü> [sahne,no,listesi]
```

Çekim **kare karedir**: Playwright'ın video kaydı ekranı CSS piksel çözünürlüğünde yakalar
(360 × 800), ekran görüntüsü ise deviceScaleFactor'ü onurlandırır. Bu yüzden video, 1080 × 2400
ekran görüntüsü dizisinden kurulur ve doğrudan ffmpeg'e beslenir. Durağan görüntüler tek kare
alınıp çoğaltılır, yalnız hareketli kareler gerçekten yakalanır.

Ses, `tools/promo_muzik.mjs` ile ffmpeg'de sentezlenir (telifsiz); videoya şöyle eklenir:

```
ffmpeg -i promo_ham.mp4 -i fon64.wav -map 0:v -map 1:a -shortest \
       -c:v copy -c:a aac -ar 48000 -b:a 128k -movflags +faststart cikti.mp4
```

## Bu ortamda çekilemeyen iki sahne

- **PDF görüntüleme.** Tarayıcı yapısında belge görünümü PDF'i yerleşik eklentiyle gösterir ve
  başsız Chromium'da o eklenti yoktur. Telefonda PDF `PdfRenderer` ile çizilir ve açılır. Video
  PDF'in **üretilmesini** gösterir, açılmasını göstermez — olmayan bir şey gösterilmedi.
3B sahnesi videoda VARDIR: `MARFEN_YUZER_TERFI_3D.dwg` 1.916.478 üçgen ve 180.732 çizgiyle
açılıyor (sayaçlar `editor.view3d().counts`ten okundu), döner tabla çalışıyor, beş görsel stil
(gölgeli · gerçekçi · kavramsal · eskiz · röntgen) ve görünüm küpü sahnede. Kök depodaki eski
bir not bu dosyanın boş açıldığını söylüyordu; ölçüm bunun artık geçerli olmadığını gösterdi.
