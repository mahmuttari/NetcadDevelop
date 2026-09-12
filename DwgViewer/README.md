# DWG Görüntüleyici (Android) — v6.3

AutoCAD **DWG** ve **DXF** çizimlerini telefonda açan, çevrimdışı çalışan
Android uygulaması. Dosya cihazdan dışarı çıkmaz; çözümleme telefonun
içinde yapılır. Su ve kanalizasyon altyapı paftalarıyla saha çalışması
için tasarlanmıştır: GPS konumu, köşe yakalamalı ölçü, boru profili,
notlar ve PDF çıktısı.

## Kurulum

1. `release/DwgGoruntuleyici.apk` dosyasını telefona indirin. Geliştirme
   dalı `claude/dwg-viewer-apk-ykjk7a` üzerindeki güncel nüsha:
   https://github.com/mahmuttari/NetcadDevelop/raw/claude/dwg-viewer-apk-ykjk7a/DwgViewer/release/DwgGoruntuleyici.apk
   (GitHub Actions'taki *DwgGoruntuleyici-apk* çıktısı ve `v*` etiketli
   sürümlerde GitHub Releases sayfası da aynı APK'yı verir).
2. Dosyaya dokunun; Android "bilinmeyen kaynaklardan yükleme" izni
   isterse verin.
3. Uygulama, dosya yöneticisi, e-posta ve WhatsApp'ta `.dwg` / `.dxf`
   dosyaları için "Birlikte aç" listesine kendiliğinden girer. Uygulama
   içindeki **sürüm denetimi** derlendiği dalın `release/version.json`
   dosyasına bakar ve yeni sürüm varsa indirme bağlantısını açar.

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
| **Belgeler (v5)** | **PDF** (Android PdfRenderer ile sayfa sayfa çizim; sayfa gezinme, yakınlaştırma, iki parmakla büyütme), **Word .docx** (paragraf, başlık, liste, tablo, resim, köprü; OOXML → HTML), **Excel .xlsx** (sayfa sekmeleri, birleştirilmiş hücreler, CSV), **ZIP** (yerleşik okuyucu; iç içe arşiv, klasör gezintisi, arama) ve **RAR** (junrar; RAR 2/3/4), resim ve metin dosyaları; arşivden çıkan DWG/DXF doğrudan çizim olarak açılır ("Arşive dön"); .doc/.xls/.ppt gibi biçimler Google Drive ile PDF'e çevrilerek açılır; belgeler "Başka uygulamayla aç", "Paylaş", "Çevrimdışı sakla" ve "Drive'a yükle" eylemleriyle gelir; dosya yöneticisinden .pdf/.docx/.zip/.rar "Birlikte aç" listesinde görünür |
| **Google Drive (v5)** | Google ile giriş (OAuth 2.0 + PKCE, tarayıcı üzerinden; Play Services gerekmez), Drive gezgini (Drive'ım / Paylaşılanlar / Son / Yıldızlı, klasör kırıntıları, arama, sayfalama), dosya açma (Google Dokümanlar PDF olarak dışa aktarılır), çevrimdışı saklama, silme, Drive'da açma; yükleme: geçerli dosya, düzenlenmiş DXF, PNG görünüm, cihazdan seçilen dosya; PNG/PDF/DXF kaydetme uyarılarında "Drive'a yükle" kısayolu; ofis belgelerini Drive ile PDF'e dönüştürme |
| **Ekran seçenekleri (3B)** | görsel stiller (AutoCAD'e benzer): 2B tel kafes, tel kafes, gizli çizgi, gölgeli, gölgeli+kenar, **gerçekçi** (yumuşak aydınlatma + parlama), **kavramsal** (Gooch soğuk-sıcak + siluet), **gri tonlar**, **eskiz** (titreme + çizgi uzatma), röntgen; yüz ayarları (aydınlatma kalitesi yüzeyli/yumuşak, parlama, yüz saydamlığı), kenar ayarları (kenar kipi, kenar rengi, siluet kenarları ve kalınlığı, çizgi uzatma, titreme), ortam (zemin gölgesi, derinlik solması); dokunma: tek parmak döndür/kaydır, iki parmak yakınlaştır+kaydır ya da yakınlaştır+döndür, üç parmak kaydır/döndür, çift dokunuş sığdır/yakınlaştır, dikey ters, hassasiyet; varsayılan izdüşüm **paralel** (AutoCAD gibi), tuval her karede CSS boyutuyla eşitlenir (en-boy oranı korunur); renk (nesne / katman / **kot** / tek renk) ve kot lejantı, aydınlatma (yön, yoğunluk, ortam), zemin ızgarası (adım, kot), eksenler ve etiketler, pusula, **görünüm küpü** (yüz / köşe / kenar dokunuşu, sürükleyerek yörünge, çift dokunuşla sığdır), perspektif / ortografik ve görüş açısı, **düşey abartı** (kaydırıcı, ×1/×2/×5/×10), **kesit** (Z aralığı ve kesit kutusu), döner tabla, dokunma davranışı (tek parmak döndür/kaydır, dikey ters, hassasiyet), kot etiketleri, HUD, nokta boyu, çizgi kalınlığı, derinlik solması, seçileni öne çıkarma; 11 görünüm ön ayarı (üst, alt, ön, arka, sol, sağ, izometrik KD/KB/GD/GB); kamera **yer imleri** (küçük resimli, dosya başına); kamera geçmişi; 3B ekran görüntüsü |
| **3B katılar ve görsel stil düğmesi (v5.1)** | **3DSOLID / REGION / BODY** varlıkları LibreDWG'nin ham ACIS verisinden okunur (SAT metin R14–2000 ve SAB ikili 2010–2013; DXF'te kod 1/3 satırları şifre çözülür) ve yüzeyler üçgenlenir: düzlem, silindir/koni, küre, tor yüzeyleri; kenarlar (doğru, yay/elips) çizilir. **MESH** varlıkları köşe/yüz listesinden alınır. Katılar 3B görünümde gölgeli, gerçekçi, kavramsal vb. bütün görsel stillerle çizilir; "Yüzey yok" uyarısı yalnız gerçekten yüzey bulunmayan çizimde çıkar. 2B görünümde yalnız kenarlar gösterilir. Nesne koordinat sistemi (**OCS**, keyfi eksen algoritması): Z dışında ekstrüzyon yönü olan CIRCLE, ARC, LWPOLYLINE, POLYLINE, SOLID, TRACE, POINT, TEXT, MTEXT, ATTRIB, INSERT ve HATCH varlıkları dünya koordinatına dönüştürülür (yatık/aynalı çizimlerin uzamış görünmesi giderildi). 3B ve Ekran › 3B sekmelerinde **Görsel stil** düğmesi: simgesi etkin stilin küçük önizlemesidir, dokununca 10 stilin önizlemeli ızgarası açılır; "Ekran ayarları › 3B" kısayolu |
| **AcDs katı verisi (v5.2)** | AutoCAD 2013 ve sonrası (AC1027, AC1032) dosyalarda katıların ASM/ACIS verisi varlığın içinde değil, dosyanın "AcDb:AcDsPrototype_1b" veri deposu bölümündedir; LibreDWG bu bölümü 2018 dosyalarında katılara bağlayamıyor, 2013 dosyalarında ise sırayla bağlayıp bölge/katı verisini karıştırabiliyordu. Uygulama artık R2004 dosya biçimi ailesinin bölüm haritasını ve LZ77 sıkıştırmasını kendisi çözer (`acds.js`), veri kayıtlarını **tanıtıcıya göre** katılara bağlar ve "ASM BinaryFile4" (ASM 223) başlıklı ikili biçimi de okur. Dönüştürücünün düşürdüğü **REGION, BODY ve MESH** varlıkları katman, renk ve sahip bloğuyla yeniden üretilir. Desteklenmeyen (spline vb.) yüzeyler sınır döngülerinden en uygun düzleme yaklaşık olarak doldurulur; delik kalmaz. Blok eklemelerinde **Z ötelemesi ve Z ölçeği** artık uygulanır (iç içe bloklarda da). Sınama: `tools/test_solids.mjs` katıları tanıtıcı tanıtıcı, 3B en-boy oranını ise piksel ölçerek (dikey/yatay, 2,625 DPR, paralel ve perspektif) doğrular |
| **Katı dayanıklılığı (v5.3)** | ACIS/ASM kayıt işaretçileri sıraya göre değil **kayıt türüne göre** çözülür (yüz → döngü → coedge → kenar → köşe → nokta; yüzey "…-surface", eğri "…-curve"); yeni ASM sürümlerinde işaretçi sırası değişse de yüzeyler bulunur. Döngünün "sonraki" zinciri kopuksa kenarlar uç noktalarından zincirlenir. SAB akışında bilinmeyen etiket görülürse o kayıt atılır ve sonraki kayda geçilir (bütün katı kaybolmaz). **Dosya bilgisi › Katı modeller** satırı tanılamayı gösterir: katı sayısı, yüzey/atlanan sayısı, yüzey türleri, ACIS sürümü, bilinmeyen etiketler ve hatalar — bir dosyada yüzey çıkmazsa bu satır nedenini söyler. **v5.4:** yüzeyi çözülemeyen katı varsa dosya açılınca uyarı çıkar, 3B HUD'daki "Yüzey yok" nedeni de yazar; Dosya bilgisi › **Katı tanılamasını paylaş** düğmesi AcDs özetini, katı başına ham veri boyutunu ve ilk iki katının ham ACIS verisinin ilk 48 KB'ını (base64) metin olarak paylaşır — dosya gönderilemediğinde hatayı bu metinden ayıklamak mümkündür. **v5.5:** AutoCAD yüzey varlıkları (PLANESURFACE, EXTRUDEDSURFACE, LOFTEDSURFACE, REVOLVEDSURFACE, SWEPTSURFACE, NURBSURFACE) da katılarla aynı ACIS yolundan okunup üçgenlenir; sahnede hiç katı/yüzey varlığı yoksa HUD bunu söyler |
| **Proxy varlıklar ve SAB düzeltmeleri (v5.6)** | **ACAD_PROXY_ENTITY** ve LibreDWG'nin çözemediği eklenti sınıfları (Advance Steel, Civil 3D, Plant 3D, NetCAD nesneleri vb.) AutoCAD'in dosyaya kaydettiği proxy grafiklerinden çizilir (ODA belirtimi bölüm 29): çizgi, çokgen, daire/yay (3 nokta dâhil), **MESH ve SHELL yüzeyleri** (delikli yüzler kulak kesmeyle üçgenlenir, kenar görünürlüğü ve yüz renkleri uygulanır), yazı, renk/gerçek renk, dolgu ve model dönüşüm yığını. SAB okuyucu düzeltmeleri: 0x15 sayım etiketi 4 baytlık tamsayıdır, 0x17 64 bit tamsayı, alt tür blokları `{ }` içindeki tür adları yeni kayıt açmaz — spline yüzeyli (loft, süpürme) katılarda işaretçiler artık doğru çözülür; Surface.dwg (ACIS 20800) örneğinde 14 yüzün 14'ü çıkar. Dosya bilgisinde **Varlık türleri** ve **DWG nesne türleri** satırları; katı tanılaması bunları da içerir. Sınama: `tools/test_proxy.mjs` (tarayıcısız, sentetik proxy akışı) |
| **Çok yüzlü ve çokgen ağlar (v5.7)** | DWG dosyalarındaki **POLYLINE_PFACE** (çok yüzlü ağ, dışa aktarılmış 3B modellerin en yaygın yüzey biçimi) ve **POLYLINE_MESH** (M×N çokgen ağ) varlıkları dönüştürücü tarafından düşürülüyordu; artık köşe ve yüz alt varlıkları LibreDWG'den doğrudan okunur (R2004+ köşe tanıtıcı dizisi, R13–R2000 first/last vertex aralığı), görünmez kenarlar (negatif indeks) çizilmez, kapalı M/N yönleri sarılır. DXF yolunda çokgen ağ (bayrak 16) artık 2B polyline sanılmaz, köşe ızgarasından dörtgen yüzler kurulur; çok yüzlü ağda konum köşeleri (192) ile yüz kayıtları (128) doğru ayrılır. Sınama DWG'leri LibreDWG'nin `dwgwrite` aracıyla R2000 ve R2018 olarak üretilmiştir (`test_solids` 4. bölüm). 3B görünüme yüzeysiz girilince "3B yüzey bulunamadı" kartı çıkar: dosyadaki varlık türleri, LibreDWG nesne türleri, katı tanılaması ve paylaşma düğmesi |
| **Ağ kenarları ve siluet (v5.8)** | Çok yüzlü ağ, çokgen ağ ve proxy kabuklarında kenarlar **kırışıklık açısı** kuralıyla seçilir (`meshEdges`): iki komşu yüz 20°'den az açı yapıyorsa aradaki kenar (üçgenleme çaprazı, düz yüzeyin parçaları) çizilmez; sınır kenarları ve gerçek köşeler kalır, dosyadaki görünmez kenar bayrağı her zaman geçerlidir. Kavramsal stilin siluet kabuğu artık **piksel** cinsindendir (hedef uzaklığındaki piksel boyuna göre), yakınlaşınca siyah bant oluşmaz. **v5.9:** yumuşak aydınlatma (gerçekçi stil, "yumuşak" aydınlatma kalitesi) **kırışıklık açısına** (30°) bağlı: bir köşede yalnız birbirine yakın yönlü yüzlerin normalleri ortalanır; kutu köşelerinde dik yüzler karışmaz, düz yüzeyler düz, kavisli yüzeyler yumuşak gölgelenir. Sınama: gerçekçi stilde küp yüzünün merkezi ile köşeleri aynı tonda (piksel ölçümü). Ayrıca 3B **Sığdır** dikey (dar) tuvalde genişliği de hesaba katar; önceden yalnız yüksekliğe sığdırıp modelin yanlarını kesiyordu |
| **Kenar düğmesi ve kıymık dayanıklılığı (v6.0)** | Gerçekçi stil varsayılan olarak **kenarsız** çizer (AutoCAD gibi). 3B ve Ekran › 3B sekmesinde **Kenarlar** düğmesi yüzey kenar çizgilerini stilden bağımsız açar/kapatır; Ekran ayarları › Kenar kipi üç durumludur: *Stile göre* / *Yüzey kenarları* / *Yok*. Eski sürümde kaydedilmiş varsayılan "Yüzey kenarları" ayarı kullanıcı seçmediyse "Stile göre"ye alınır. Çok ince (kıymık) üçgenlerin normali koordinat gürültüsüyle eğrilir; yumuşak aydınlatmada ortalama alanla ağırlıklanır ve başvuru yönü köşedeki en büyük yüzdür, kenar süzgecinde kıymık yüzler kırışıklık kararına girmez — düz plakalardaki koyu şeritler ve çapraz çizgiler kalkar |
| **Çizim sırası ve koyu temada okunabilirlik (v6.3)** | AutoCAD'in **çizim sırası tablosu (SORTENTSTABLE)** DWG (LibreDWG nesne listesinden) ve DXF (OBJECTS bölümü) yollarında okunur; varlıklar sıra tanıtıcısına göre çizilir, böylece "arkaya gönderilmiş" dolgular çizgileri, ölçüleri ve yazıları örtmez. Tablo olmayan dosyalar için Ekran ayarları › **Taramalar ve dolgular arkada** seçeneği (varsayılan açık) taramaları ve SOLID/TRACE dolgularını önce çizer. Koyu temalarda **parlaklık tabanı**: saf mavi (ACI 5), lacivert ve koyu gri gibi 1 piksellik çizgide seçilemeyen renkler tonu korunarak beyaza doğru açılır (parlaklık 0,20'nin altındakiler ~0,38'e). Bir kesit paftasında ölçü çizgilerinin "hiç çizilmemesi" bu ikisinin birleşimiydi: dolgular ölçülerin üstüne çiziliyor, açıkta kalan mavi çizgiler koyu zeminde görünmüyordu |
| **Sık tarama deseninde uzaklık düzeyi (v6.2)** | Desenli taramanın (ANSI31 vb.) çizgi aralığı ekranda 2 pikselin altına inince desen çizgileri yerine %18 saydam dolgu çizilir; yakınlaşınca desen geri gelir. 6.1'de sub-piksel aralıklı desenler opak gri kütleye dönüşüp altındaki ölçü ve çizgileri örtüyordu (kesit paftalarındaki beton taramaları). Sahne başına toplam desen parçası bütçesi (300.000) aşılırsa kalan taramalar düz dolguya düşer |
| **Yayın sürümü denetimi ve düzeltmeleri (v6.1)** | Projenin baştan sona denetimiyle (3B çizim, 3B veri hattı, 2B çizim, arayüz, Android kabuğu, dosya biçimleri, belgeler ve sınamalar) bulunan ve bağımsız olarak doğrulanan hatalar giderildi. **2B çizim:** anonim bloğu olmayan **DIMENSION** varlıkları için ölçü çizgisi, uzatma çizgileri (DIMEXO/DIMEXE), ok başları (DIMASZ×DIMSCALE, DIMTSZ) ve yazı DIMSTYLE + XDATA geçersiz kılmalarından üretilir; blok ekleme noktası (12/22) uygulanır; **LEADER/MLEADER** ok başı ve spline çağrı çizgisi; DWG'de **LWPOLYLINE kapalılık** biti (512) doğru okunur; DXF'te **çizgi kalınlığı** (370, 1/100 mm) artık DWG kodu sanılmaz (0,13 mm çizgiler 0,60 mm basılmaz); 0,00 mm kalınlık ince kalır; **gerçek renk** (420) ACI'ye üstün gelir; konik/değişken genişlikli polyline'lar parça parça dolu çizilir; desenli **HATCH** tanım satırlarından sınırla kırpılmış desen çizgileriyle çizilir; -Z ekstrüzyonlu TEXT/MTEXT/SOLID/HATCH/INSERT/POINT aynalanır; MTEXT `\{ \}` kaçışları ve `\U+XXXX` dizileri DWG yolunda da çözülür; iç içe bloklarda ByBlock çizgi tipi; sayfa düzeni pencerelerinde PSLTSCALE ve pencere başına dondurulmuş katmanlar; 3DFACE görünmez kenarları; yay/elips sınır kutusu tam çember yerine yayın kendisi (sığdırma). **3B:** kaydırma hızı parmağı izler (CSS piksel/yükseklik), cihaz döndürülünce sığdırma korunur, WebGL bağlam kaybında tamponlar yeniden kurulur, düşey abartıda normaller ölçeklenir, km ölçekli paftada ayrıntıya yakınlaşılabilir (near/far), siluet kalınlığı ve kot etiketi ızgarası cihaz pikseline değil CSS pikseline bağlı, ölçü dokunuşlarında sahne GPU'ya yeniden yüklenmez. **ACIS:** bozuk SAB'da uzunluk sınırları (işçi belleksiz kalmaz), gövde dönüşümü satır-vektör kuralıyla ve ölçekle, ters yönlü yay kenarları, tam çevreli silindir/koni yüzleri şerit olarak, küre/torus yamaları sınır döngüleriyle kırpılır. **Dosya okuma:** LibreDWG hata kodu değerlendirilir (kesik/bozuk DWG sessizce boş açılmaz; kısmi okumada uyarı), BOM'lu DXF, DOS857/DOS850 kod sayfaları, DXF'te ACAD_TABLE / MULTILEADER / TOLERANCE / MESH / ACDSDATA ve proxy grafikleri (310), işçi zaman aşımı ve **İptal** düğmesi, gerçek ilerleme, 80 MB üstü dosyada onay, XLSX görüntülemede sayfalama. **Android:** http harita altlıkları ve pafta sunucuları (karışık içerik kipi), uygulama simgesine dokununca çizim yeniden yüklenmez, "Son dosyalar" kalıcı URI izniyle çalışır ve ölü kayıtlar silinir, WebView çökmesinde görüntüleyici yeniden kurulur ve Java çökmeleri hata kaydına girer, Drive yüklemesi akışlı (bellek), yedeklemeye Drive belirteci girmez, yaklaşık konum izniyle çalışma, PKCE doğrulayıcısı süreç ölümüne dayanıklı, pano yapıştırma köprüsü, tahminli geri hareketi, R8 küçültme (dex 4,4 MB → 0,3 MB), xlsx/kml/kmz/gpx/geojson/csv/txt için "Birlikte aç", RAR5 için anlaşılır ileti, sürüm denetimi derlendiği dalın adresine bakar. **Arayüz:** 3B durum çipi kısaltıldı (kırpılma yok), yatayda görünüm küpü ile gezinti düğmeleri çakışmaz, not çubuğu dar ekranda sarılır ve SVG simgeler kullanır, komut satırı gezinti düğmelerini örtmez, belge yokken karolar devre dışı, üst çubukta dosya adı okunur, "Hakkında" ekranı güncel (sürüm, derleme kimliği, lisanslar, klavye kısayolları), tarayıcı `prompt()/confirm()` yerine uygulama içi diyaloglar, **İngilizce arayüz tamamlandı** (3B panel, araç adları, iletiler). **Sınama:** ortak `tools/harness.mjs`, `tools/test_all.mjs` (bütün betikler), `tools/test_core.mjs` (DWG sürümleri, Türkçe DXF, ikili DXF, sayfa düzeni, arama, PDF, notlar), `tools/release_check.mjs` (sürüm ve APK–kaynak eşitliği); önceden yalnız günlük basan üç betik iddiaya çevrildi; örnek dosyalar `samples/` içinde |
| **Çizim** | çizgi (zincirleme), polyline (açık/kapalı), dikdörtgen, daire (merkez + yarıçap noktası ya da yazılı yarıçap), yay (3 nokta), nokta, yazı, 3B polyline (kotlu), 3B yüzey; geçerli katman / renk seçimi, yeni katman oluşturma; tüm yakalama kipleri çizimde de geçerli |
| **Düzenleme** | seç (dokunarak ekle/çıkar, tümünü seç), taşı, kopyala (yineleyerek), döndür (yazılı açı ya da nokta), ölçekle, aynala (orijinali koru / korumama), ofset (mesafe + taraf), sil, kot ata, yazı düzenle, özellikler (katman/renk); sınırsız geri al / yinele; düzenlemeler dosya başına kalıcı (uygulama kapansa da korunur) |
| **Ölçüm araçları** | mesafe (yatay, ΔX/ΔY/ΔZ, 3B, açı), alan (m², dekar, hektar; çevre), açı (3 nokta), yarıçap/çap/çevre, koordinat (XYZ + enlem/boylam + kopyalama) |
| **3B görünüm (araçlar)** | 3B mesafe (yatay, ΔZ, eğim), seçim, 3B taşıma, kot atama, silme, 3B polyline (köşeye dokunarak ya da `x,y,z` yazarak); köşe yakalama. Görsel stiller, kamera, ızgara, kesit ve görünüm ön ayarları için "Ekran seçenekleri (3B)" satırına bakın |
| **Kaydetme** | **DXF** (AC1015): tüm çizim (bloklar patlatılmış, katmanlar ve çizgi tipleri korunur) ya da yalnız değişiklikler; paylaşım menüsüyle e-posta/WhatsApp/Drive'a gönderme |

Çizilen varlıklar: LINE, LWPOLYLINE, POLYLINE (2B/3B/çok yüzlü), CIRCLE,
ARC, ELLIPSE, SPLINE, POINT, TEXT, MTEXT, ATTRIB, INSERT (iç içe, dizili,
ölçekli, döndürülmüş), DIMENSION, HATCH, SOLID, 3DFACE, LEADER,
MULTILEADER, TOLERANCE, MLINE, XLINE, RAY, ACAD_TABLE, WIPEOUT, IMAGE,
VIEWPORT, 3DSOLID, REGION, BODY (ACIS SAT/SAB), MESH, POLYLINE_PFACE,
POLYLINE_MESH, yüzey varlıkları (PLANESURFACE vb.), ACAD_PROXY_ENTITY.

Yapmadıkları: ikili DXF'i çizmez (anlaşılır bir iletiyle reddeder); OLE
nesnelerini çizmez; NURBS (spline) yüzeyler yalnız sınırlarından yaklaşık
doldurulur; SHX yazı tipleri yerine sistem yazı tipini kullanır; sayfa
düzeni pencerelerinde dikdörtgen olmayan kırpma sınırı uygulanmaz; RAR5
arşivleri açılmaz (RAR4 ya da ZIP gerekir). **DWG olarak yazamaz**:
kullanılan LibreDWG WebAssembly derlemesinde yazma kapalıdır; düzenlemeler
DXF olarak kaydedilir (AutoCAD ve NetCAD doğrudan açar). Orijinal DWG
hiçbir zaman değiştirilmez. ED50 datum kaydırması ülke ortalaması
parametreleriyle yapılır (±2-5 m). **Dosya boyutu:** çözümleme cihaz
belleğinde yapılır; pratik sınır 4 GB RAM'li telefonda 80-100 MB
dosyadır. 80 MB üstünde uygulama açmadan önce sorar; daha büyük paftalar
PURGE/AUDIT ile küçültülmeli ya da parçalanmalıdır. Uzun süren
yükleme **Vazgeç** ile kesilebilir.

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

## Google ile giriş / Drive kurulumu

Uygulama Play Services kullanmaz; giriş tarayıcıda yapılır ve geri dönüş
`com.googleusercontent.apps.<istemci-no>:/oauth2redirect` şemasıyla
uygulamaya gelir. Bunun için bir kez Google Cloud Console'da:

1. Proje oluşturun, **Google Drive API**'yi etkinleştirin.
2. **OAuth consent screen**: External, uygulama adı "DWG Görüntüleyici";
   kapsamlar `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive`;
   yayın durumu "Testing" ise **Test users** listesine kendi hesabınızı ekleyin.
3. **Credentials → Create credentials → OAuth client ID → Android**:
   paket adı `com.mahmuttari.dwgviewer`, SHA-1 imza parmak izi
   `24:D2:D3:A7:ED:FB:FB:93:16:5F:75:D0:E7:D8:93:B6:FD:54:D5:A7`
   (`keystore/dwgviewer.jks`).
4. Oluşan istemci kimliğini `gradle.properties` içindeki
   `GOOGLE_CLIENT_ID=` satırına yazın ve APK'yı yeniden derleyin.
   Kimlik boşsa uygulama "Google istemci kimliği bu sürüme henüz işlenmedi"
   uyarısı verir; belge görüntüleme dâhil diğer her şey çalışır.

Belirteçler cihazda uygulama-özel depoda tutulur; "Çıkış" belirteci Google
tarafında da iptal eder.

## Derleme

```
cd DwgViewer
./gradlew assembleRelease        # app/build/outputs/apk/release/app-release.apk
```

JDK 17+, Android SDK (platform 34, build-tools 34.0.0), Gradle 8.14.3 ve
AGP 8.11.1 gerekir; `local.properties` içinde `sdk.dir=…` verin. Sürüm
(release) derlemesi R8 ile küçültülür; JS köprüsü ve junrar
`app/proguard-rules.pro` ile korunur. Derleme, git dalını ve kısa commit
numarasını `BuildConfig.UPDATE_URL` / `BuildConfig.GIT_SHA` olarak gömer:
sürüm denetimi derlendiği dalın `release/version.json` dosyasına bakar,
derleme kimliği "Hakkında" ekranında ve hata kaydında görünür.

GitHub Actions (`.github/workflows/dwgviewer-apk.yml`) her `DwgViewer/**`
değişikliğinde sürüm eşitliğini denetler (`tools/release_check.mjs
--no-apk`), tarayıcısız sınamayı koşturur, APK'yı derleyip *artifact*
olarak yükler; `v*` etiketli push'ta APK'yı GitHub Release'e ekler.

Yeni sürüm çıkarırken üç yer birlikte güncellenir: `app/build.gradle`
(`versionCode`, `versionName`), `release/version.json` ve README başlığı;
`node tools/release_check.mjs` bunları ve `release/DwgGoruntuleyici.apk`
içindeki görüntüleyici dosyalarının kaynakla bayt bayt aynı olduğunu
doğrular.

APK `keystore/dwgviewer.jks` ile imzalanır (şifre `gradle.properties`).
Aynı anahtarla imzalanmayan bir sürüm kurulu sürümün üzerine yüklenemez.

## Tarayıcıda deneme / sınama

```
node tools/serve.mjs 8765          # http://localhost:8765/ — dosya seçiciyle aynı sayfa (0 → boş port)
PLAYWRIGHT_PKG=<node_modules dizini> node tools/test_all.mjs     # bütün sınamalar
PLAYWRIGHT_PKG=<node_modules dizini> node tools/test_core.mjs    # tek betik: [çıktı] [örnekler]
node tools/test_proxy.mjs                                        # tarayıcısız
node tools/release_check.mjs [--no-apk]                          # sürüm / APK tutarlılığı
PLAYWRIGHT_PKG=<node_modules dizini> node tools/screenshot.mjs <çıktı> a.dwg b.dxf
```

Gereksinim: Node 22, Playwright + Chromium (`PLAYWRIGHT_BROWSERS_PATH`).
Betikler ortak `tools/harness.mjs` üzerinden çalışır: sunucu boş bir
portta açılır, Chromium WebGL bayraklarıyla (`--use-gl=swiftshader
--enable-webgl --ignore-gpu-blocklist`) başlatılır, örnekler varsayılan
olarak `samples/` klasöründen (kökenleri `samples/README.md`) okunur, çıktı
`tools/out/<betik>/` altına yazılır. Her betik `SONUÇ: N geçti, M kaldı`
satırıyla biter ve kalan varsa 1 ile çıkar.

| Betik | Kapsam |
|---|---|
| `test_core.mjs` | R14, 2000, 2004, 2007, 2010, 2013, 2018 DWG açılışı ve sürüm etiketi; Türkçe kod sayfalı DXF; ikili DXF reddi; sayfa düzenleri; arama; PDF çıktısı; notlar |
| `test_display2d.mjs` | 2B ekran seçenekleri, tema, kalınlık, ızgara, dokunma hedefleri, ayar göçü |
| `test_shell.mjs` | şerit arayüz, sekmeler, karolar, tablet/yatay düzen, i18n ham anahtar denetimi |
| `test_editor.mjs` | çizim ve düzenleme araçları, geri al/yinele, DXF kaydetme, 3B araçlar |
| `test_3d.mjs` | 3B görünüm, kot atama, 3B polyline, 2B'ye dönüş |
| `test_features.mjs` | GPS işaretçisi, profil, karşılaştırma, projeksiyon geri dönüşümü |
| `test_solids.mjs` | AcDs katıları (2013/2018), yüzey varlıkları, çok yüzlü ağlar, blok Z, 3B en-boy pikseli, görsel stil piksel ölçümleri |
| `test_proxy.mjs` | proxy grafik akışı (tarayıcısız, sentetik) |
| `test_docs.mjs` | ZIP/DOCX/XLSX/PDF, Drive köprü taklidi, 3B stiller ve parmak hareketleri |

RAR (junrar), gerçek Google Drive ve Android PdfRenderer yalnız cihazda
çalışır; tarayıcı sınamaları bunları köprü taklidiyle geçer.

## Sürüm geçmişi

| Sürüm | versionCode | Tarih | Başlıca |
|---|---|---|---|
| 1.0 | 1 | 2026-09-06 | İlk sürüm: WebView + LibreDWG WebAssembly, DWG/DXF görüntüleme |
| 2.0 | 2 | 2026-09-06 | Saha, profesyonel ve kurumsal özellik paketleri (GPS, ölçü, profil, notlar, PDF, karşılaştırma, XREF) |
| 3.0 | 3 | 2026-09-08 | Çizim ve düzenleme araçları, sekmeli araç çubuğu, 3B görünüm, DXF kaydetme |
| 4.0 | 4 | 2026-09-11 | Şerit arayüz, Ekran sekmesi (2B/3B seçenekleri), görünüm küpü, erişilebilirlik |
| 5.0 | 5 | 2026-09-11 | PDF/Word/Excel/ZIP/RAR görüntüleme, Google ile giriş ve Drive, 3B görsel stiller ve parmak hareketleri |
| 5.1 | 6 | 2026-09-11 | 3B katılar (ACIS SAT/SAB, MESH), OCS dönüşümü, görsel stil düğmesi |
| 5.2 | 7 | 2026-09-11 | AcDs katı verisi (2013/2018), REGION/BODY/MESH, blok Z ötelemesi |
| 5.3 | 8 | 2026-09-11 | ACIS işaretçileri türe göre, SAB yeniden eşitleme, katı tanılaması |
| 5.4 | 9 | 2026-09-11 | Katı tanılaması paylaşımı, yüklemede uyarı, HUD nedeni |
| 5.5 | 10 | 2026-09-11 | AutoCAD yüzey varlıkları (PLANESURFACE vb.) |
| 5.6 | 11 | 2026-09-11 | Proxy varlık grafikleri, SAB sayım/alt tür düzeltmeleri |
| 5.7 | 12 | 2026-09-12 | Çok yüzlü ve çokgen ağlar, "3B yüzey bulunamadı" kartı |
| 5.8 | 13 | 2026-09-12 | Ağ kenarlarında kırışıklık süzgeci, piksel tabanlı siluet |
| 5.9 | 14 | 2026-09-12 | Kırışıklık açılı yumuşak aydınlatma, dikey tuvalde sığdırma |
| 6.0 | 15 | 2026-09-12 | Kenarlar düğmesi, gerçekçi stil kenarsız, kıymık üçgen dayanıklılığı |
| 6.1 | 16 | 2026-09-12 | Yayın sürümü: baştan sona denetim; 2B ölçü/çağrı/kalınlık/renk/tarama, 3B kaydırma/döndürme/bağlam kaybı, ACIS kırpma, dosya okuma dayanıklılığı, Android kabuğu, arayüz ve İngilizce tamamlama, sınama altyapısı |
| 6.2 | 17 | 2026-09-12 | Sık tarama deseninde uzaklık düzeyi: sub-piksel desenler saydam dolguya düşer, altındaki çizgiler örtülmez |
| 6.3 | 18 | 2026-09-12 | Çizim sırası tablosu (SORTENTSTABLE) DWG/DXF, "Taramalar ve dolgular arkada" seçeneği, koyu temada renk parlaklık tabanı |

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
da GPL v3 ile dağıtılır. Üçüncü taraf bileşenler (ayrıntı:
`app/src/main/assets/viewer/lib/NOTICE.md`): @mlightcad/libredwg-web 0.7.10
(GPL-3.0), jsQR (Apache-2.0), junrar 7.5.5 (MIT), AndroidX Core 1.13.1
(Apache-2.0). Harita altlıkları kendi kullanım koşullarına tabidir
(OpenStreetMap: ODbL; Esri: Esri kullanım şartları).
