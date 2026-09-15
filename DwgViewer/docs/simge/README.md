# Uygulama simgesi önerisi — “Plan ve Kalem”

Bu klasör bir **öneridir**. Yayındaki simge değiştirilmemiştir; karar başvuru
sahibinindir. Aşağıda gerekçe, dosyalar ve benimseme adımı yazılıdır.

## Neden yeni bir simge

Yayındaki simge, verilen görselden üretilmiş bir yığındır: ZIP klasörü, PDF
yaprağı, Word yaprağı, önde DWG paftası ve arkada mavi yörünge. Ürünün ne
yaptığını doğru anlatır ama **başlatıcıda okunmaz**. Karşılaştırma sayfası
(`karsilastirma.png`) bunu gösteriyor: 96 px altında görsel tanınmaz bir lekeye
dönüşüyor, 48 px'te (başlatıcıların çoğunun gerçek boyutu) hiçbir öğe
seçilemiyor. Play'in kendi yönergesi de simgenin **48 dp'de ayırt edilebilir**
olmasını ister; fotoğrafik ve çok öğeli simgeler bu eşiği geçemez.

## Fikir

Simge, bekleme canlandırmasının **birinci perdesidir**: iki odalı planın tek
çizgide çizilmiş hâli ve çizginin bittiği yerde bekleyen kalem başı. Yol,
canlandırmadaki Euler yolunun aynısıdır —

```
M-23 0  V21  H23  V-21  H-23  V0  H23
```

— yani hiçbir duvar iki kez geçilmez, çizgi kesintisizdir. Kullanıcı simgeye
dokunduğunda, simgedeki çizginin kendini çizdiğini görür: **simge ile açılış
aynı şeyin iki hâlidir.** Marka böylece bir resimden değil, bir davranıştan
doğar.

Kalem başı vurgu renginde (`#F5B342`) tek noktadır ve içinde küçük bir göz
taşır: büyük boyutta bir canlı, küçük boyutta yalnız bir uç olarak okunur.

## Oranlar

Uyarlanabilir simge 108 dp tuvalde çizilir, başlatıcı 72 dp'lik daireye
(r = 36) kırpar. Markanın merkeze en uzak noktası köşeleridir:
`(23 + 3, 21 + 3)` → **35,4 dp**. Yani en dar maske olan dairede bile köşe
kırpılmaz; damla ve yuvarlak kare maskelerinde rahat oturur. Kalem başı sağda
`23 + 6,8 = 29,8 dp`de kalır. Künye sayfası (`kunye.png`) üç maskeyi ve
192'den 24 px'e kadar altı boyutu yan yana gösterir.

## Seçenekler ve neden elendiler

`varyant.png` beş varyantı aynı boyutlarda karşılaştırır:

| Varyant | Sonuç |
|---|---|
| B1 kalın kontur (7,5) | Odalar sıkışıyor, 36 px'te iç boşluk kapanıyor |
| **B2 (seçilen)** | Her boyutta açık; 24 px'te bile plan olarak okunuyor |
| B3 diyafram halkalı | Halka küçük boyutta gürültü, 48 px altında kayboluyor |
| B4 kapı boşluklu | Büyükte güzel, küçükte boşluk çizim hatası gibi duruyor |
| B5 bölme yukarıda | Tarayıcı penceresi/başlık çubuğu gibi okunuyor |

Ayrıca bir de sarmal (“kıvrım”) denendi — `karsilastirma.png` üstteki satır.
Kontur ile boşluk oranı küçük boyutta kapandığı için sarmal, sarmal olarak
değil dolu bir leke olarak okunuyordu; elendi.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `simge.svg` | Ana kaynak, 108 × 108, zemin + ön yüz |
| `on-yuz.svg` | Yalnız ön yüz (saydam zemin) |
| `tek-renk.svg` | Android 13 temalı simge katmanı |
| `magaza-512.png` | Play Console mağaza simgesi (512 × 512, köşesiz) |
| `android/ic_launcher_foreground.xml` | Ön yüz **vektör** katmanı |
| `android/ic_launcher_monochrome.xml` | Tek renk katmanı |
| `kunye.png` · `varyant.png` · `karsilastirma.png` | Karar kayıtları |

Hepsini `tools/gen_simge.mjs` üretir; elle düzenlenmez.

## Benimsemek istenirse

1. `android/ic_launcher_foreground.xml` ve `android/ic_launcher_monochrome.xml`
   dosyalarını `app/src/main/res/drawable/` altına kopyala.
2. `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` içinde ön yüzü
   `@mipmap/ic_launcher_foreground` yerine `@drawable/ic_launcher_foreground`
   olarak göster.
3. Artık gereksiz kalan beş yoğunluktaki
   `mipmap-*dpi/ic_launcher_foreground.png` dosyalarını sil — ön yüz vektör
   olduğu için her yoğunlukta keskindir ve APK küçülür.
4. `ic_launcher_background.xml` zaten aynı mavi gradyandır, dokunulmaz.

Zemin rengi, kalem başı rengi ya da oran değiştirilecekse `tools/gen_simge.mjs`
başındaki sabitler değiştirilip betik yeniden çalıştırılır.
