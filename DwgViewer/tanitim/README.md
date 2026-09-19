# Tanıtım videosu

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
