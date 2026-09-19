# Tanıtım videoları

İki tanıtım vardır ve birbirinin yerine geçmez: birincisi var olan bir projeyi **açıp
gezdirir**, ikincisi boş bir sayfadan başlayıp gözünüzün önünde **kroki çizer**.

## 2 · Kroki (v7.90) — `DWG_OfficeZip_kroki.mp4`

**`DWG_OfficeZip_kroki.mp4`** — 1080 × 2400 (dikey 9:20) · 30 kare/sn · 83 sn · H.264 + AAC
**`DWG_OfficeZip_kroki_sessiz.mp4`** — aynı görüntü, sessiz nüsha (kurgu kaynağı)
**`kroki_fon_muzik.m4a`** — fon müziği tek başına
**`kroki_sahneler.json`** — her sahnenin başladığı saniye

Yeniden çekmek için: `FFMPEG=<yol> node tools/promo2.mjs <klasör>`
Tek sahne: `node tools/promo2.mjs <klasör> 7,13` (sahne numaraları).

### Ne gösteriyor

Boş bir çizim açılır ve **12,5 × 8,0 m = 100 m²** bir kat krokisi, uygulamanın kendi
komutlarıyla çizilir:

| sn | Sahne |
|---|---|
| 0,0 | açılış kartı |
| 2,3 | yeni boş çizim (birim metre) |
| 5,7 | komut satırı: `REC` yazılır, öneri listesi açılır, `RECTANG` tamamlanır |
| 9,9 | dış duvar: `0,0` → `@12.5,8` |
| 13,6 | ötele ile 20 cm duvar kabuğu (nesneye ve tarafa dokunarak) |
| 18,4 | iç bölmeler, 90 cm kapı boşluğu, kapı kanadı yayı |
| 28,1 | tarama — alanı **uygulama** iletir |
| 30,6 | oda adları |
| 35,6 | doğrusal ve hizalı ölçü + detay yakınlaşması |
| 44,5 | katman söndürme / yakma (etki çizimin üstünde görülür) |
| 54,6 | parmakla nişan aparatı (imleç parmaktan 56 px ayrı) |
| 59,4 | ölçüm |
| 64,2 | duvarlara kalınlık, üç boyuta geçiş, görsel stiller |
| 73,7 | hazır değeri olmayan bir tablonun hesaplanması |
| 79,2 | kapanış |

### Videodaki her sayı uygulamanın kendi hesabıdır

Altyazıya elle sayı yazılmaz; ekrandan okunur ve altyazıya oradan geçirilir:

- **36,48 m²** — taramanın alanı, uygulamanın kendi iletisinden.
- **12,5 m** ve **8 m** — ölçü yazıları, ölçü priminden okunarak.
- **8,118 m · ΔX 7,2 · ΔY 3,75 · 27,51°** — ölçüm panelinin kendi çıktısı ("END yakalandı").
- **`ofs:[0,-56]` · `snap:"end"`** — nişan aparatının gerçek durumu; imleç parmaktan 56 px
  yukarıda ve uç noktayı yakalamış.
- **`tris: 198` · `Z: 0 … 3`** — kalınlık gerçekten uygulandı, 3B'deki kütle gerçek.
- Tablodaki **67.488,00 ₺ · 146.683,00 ₺ · 29.336,60 ₺ · 23.09.2025** — dosyada hazır değer
  YOKTUR (formül hücrelerinde `<v>` yazılmamıştır); ekranda dolu görünmesi hesabı uygulamanın
  yaptığı anlamına gelir. Tablonun ilk satırındaki **36,48 m²** de krokinin kendi tarama
  alanıdır: iki sahne uydurma bir sayıyla değil, uygulamanın kendi hesabıyla bağlanmıştır.

### Marka kuralı

Videoda **başka hiçbir yazılımın adı geçmez**. Komut adları (RECTANG, OFFSET, DIMLINEAR…)
sektörün ortak dilidir ve ekranda görünür; altyazı bunu "komut satırı: bildiğiniz adlar"
diye anar. Kural `tools/promo2.mjs` dosyasının başlığında yazılıdır ki sonradan bozulmasın.

### Bilinen sınırlar (dürüstlük notu)

- Kayıt masaüstü tarayıcısında, telefon kadrajıyla (360 × 800 CSS, 3× yoğunluk) alınmıştır;
  gerçek cihazda arayüz aynıdır, başarım farklı olabilir.
- Kalınlık komutu **Super** basamağındadır; ücretsiz ya da premium bir cihazda o sahnedeki
  komut yükseltme kutusunu açar.
- Yazı tipi ve renkler cihazın sistem yazı tipine göre birazcık değişir.

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
