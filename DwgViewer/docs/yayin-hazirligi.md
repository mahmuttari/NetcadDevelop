# Yayın hazırlığı: Google doğrulaması ve Play beyanları

Bu dosya, mağaza yayını sırasında formlara yazılacak hazır metinleri tutar. İçindeki her
ifade uygulamanın gerçek davranışından çıkarılmıştır; kodda bir şey değişirse burası da
güncellenir. Gizlilik politikasının kendisi ayrı bir depodadır:
<https://mahmuttari.github.io/Yonetmelik-araclari/dwgviewer/gizlilik.html>

Kimlik bilgileri:

| Alan | Değer |
|---|---|
| Paket adı | `com.mahmuttari.dwgviewer` |
| İmza sertifikası SHA-1 | `24:D2:D3:A7:ED:FB:FB:93:16:5F:75:D0:E7:D8:93:B6:FD:54:D5:A7` |
| Geliştirici hesabı | mahmuttari@gmail.com |
| Yetkili alan adı | mahmuttari.github.io |

---

## 1. Google OAuth doğrulama başvurusu

Kısıtlı kapsam (`https://www.googleapis.com/auth/drive`) istendiği için Google, onay
ekranını "Üretim" durumuna almadan önce doğrulama ister. Form İngilizce doldurulur;
aşağıdaki metinler doğrudan yapıştırılabilir.

### 1.1 Kapsam gerekçesi (scope justification)

Google, her kısıtlı kapsam için "bu kapsam olmadan uygulamanın hangi özelliği çalışmaz"
sorusunu sorar. Cevap somut olmalı, "dosyalara erişmek için" gibi genel ifadeler reddedilir.

> **Scope requested:** `https://www.googleapis.com/auth/drive`
>
> DWG OfficeZip is an offline CAD and document viewer for surveying and infrastructure
> engineers. Users keep their project drawings (DWG, DXF) and related documents (PDF,
> Word, Excel) in their own Google Drive, typically in folders shared by their employer
> or by project partners.
>
> The app needs the full `drive` scope for three user-facing features:
>
> 1. **Drive browser.** The app shows a folder tree of My Drive, Shared with me, Recent
>    and Starred so the user can locate a drawing that already exists in Drive and was
>    not created by this app. `drive.file` cannot list pre-existing files, so this
>    feature would be impossible.
> 2. **Opening pre-existing files.** A drawing placed in Drive months ago by a colleague
>    must be downloadable and rendered on the device. Google Docs, Sheets and Slides are
>    exported to PDF through `files.export` so they can be displayed.
> 3. **Uploading and managing outputs.** Edited DXF files, exported PDF plans and PNG
>    views are uploaded back into the folder the user chooses, and the user can delete a
>    file from inside the app.
>
> The app has no server. Files move directly between the device and Google. Drive content
> is never sent to the developer, never stored outside the device, and never used for
> advertising or analytics.
>
> We considered `drive.file` with the Google Picker. It does not fit the workflow: field
> engineers open dozens of drawings across shared folders during a site visit, often with
> intermittent connectivity, and re-picking each file through the Picker every time is not
> workable. The Drive browser also has to show folder structure, which the Picker's
> per-file grant does not preserve between sessions.

### 1.1.1 Android istemcisinde "Özel URI şeması" açılmalıdır

Google, 2024'ten sonra oluşturulan Android ve iOS OAuth istemcilerinde **özel
URI şemasıyla yönlendirmeyi varsayılan olarak kapalı** getiriyor. Kapalıyken
yetkilendirme isteği tarayıcıda şu hatayla durur:

```
Hata 400: invalid_request
Custom URI scheme is not enabled for your Android client.
```

İstek kusursuz olsa bile bu hata alınır; engel istemcinin ayarındadır. Açmak
için: **Google Auth Platform › İstemciler › (Android istemcisi) › Gelişmiş
ayarlar › Özel URI şemasını etkinleştir** → Kaydet. Değişikliğin yayılması
birkaç dakika sürebilir.

Bu uygulama özel URI şeması kullanır, çünkü giriş Play Hizmetleri olmadan,
yalnız tarayıcı ve PKCE ile yürür (`GoogleDrive.java`). Google uzun vadede
Android'de Google Identity Services / Credential Manager'ı öneriyor; o yol
Play Hizmetleri bağımlılığı getirir ve Drive REST çağrıları için ayrıca
sunucu tarafı yetkilendirme gerektirir. Şema anahtarı kapatılırsa giriş
akışının yeniden yazılması gerekir.

Yeni bir imza anahtarına geçilirse (ör. Play uygulama imzalaması) yeni bir
Android istemcisi oluşturulur; bu anahtarın **yeni istemcide de** açılması
unutulmamalıdır.

### 1.2 Tanıtım videosu (demo video) senaryosu

Google, YouTube'a yüklenmiş (liste dışı olabilir) bir video ister. Videoda OAuth istemci
kimliğinin adres çubuğunda görünmesi ve her istenen kapsamın kullanıldığı yerin
gösterilmesi zorunludur. Sırası:

1. Uygulamayı açın, ana ekranı gösterin.
2. **Bulut → Google Drive → Giriş** deyin. Tarayıcı açılınca adres çubuğunu yakınlaştırıp
   `client_id=...` kısmını okunacak biçimde gösterin. Bu kare olmadan başvuru reddedilir.
3. Onay ekranındaki izin listesini gösterin, kabul edin.
4. Uygulamaya dönünce hesap adının ve e-postanın görüntülendiğini gösterin. Bu
   `openid`, `email` ve `profile` kapsamlarının karşılığıdır.
5. Drive gezgininde bir klasöre girin, içindeki DWG dosyasını açın, çizimin ekrana
   geldiğini gösterin. `drive` kapsamının okuma tarafı budur.
6. Bir PDF'i **Drive'a yükle** ile geri yükleyin. Yazma tarafı budur.
7. **Çıkış** deyin, bağlantının koptuğunu gösterin.

Video 3 ile 5 dakika arası olmalı, sesli anlatım İngilizce ya da İngilizce altyazılı.

### 1.3 Alan adı sahipliği

Google, gizlilik politikasının barındığı alan adının size ait olduğunu ister.
`mahmuttari.github.io` GitHub hesabınıza bağlı olduğu için Search Console üzerinden
doğrulanabilir. Cloud Console'da **API'ler ve Hizmetler → OAuth izin ekranı → Yetkili alan
adları** kısmına eklenen alan adı, Search Console'da doğrulanmış olmalıdır.

### 1.4 CASA güvenlik değerlendirmesi

Kısıtlı kapsam onaylandıktan sonra yıllık bağımsız güvenlik değerlendirmesi istenir.
Uygulamada bu değerlendirmenin bakacağı noktalar için yapılmış olanlar:

| Denetim başlığı | Durum |
|---|---|
| Kimlik bilgilerinin güvenli saklanması | Google erişim ve yenileme belirteçleri Android Keystore AES-256/GCM ile şifreli (`Secrets`), WebDAV parolaları aynı depoda |
| Yedeklemeye sızma | `backup_rules.xml` ve `data_extraction_rules.xml`, `google.xml` ve `webdav.xml` tercihlerini yedekten dışlıyor |
| Şifresiz trafik | `network_security_config.xml`: Google oturum, Drive ve reklam alan adlarında http yasak; yalnız kullanıcının kendi girdiği kurum içi sunucularda serbest |
| Sertifika güveni | Varsayılan korunuyor, yalnız sistem sertifikaları güvenilir (Android 7+ davranışı) |
| Gereksiz izin | Konum ve kamera isteğe bağlı özellikler için, `uses-feature required="false"` |
| Kod karartma | R8 küçültme açık |
| Yerelleştirme | Arayüz onbeş dilde; APK yalnız bu dillerin kaynağını taşır (`resourceConfigurations`), dil dosyaları uygulamanın içindedir, çeviri için ağa çıkılmaz |
| Zafiyetli bağımlılık | junrar 7.5.5, Play Billing 7.1.1, play-services-ads 23.6.0, AndroidX Core 1.13.1 |

---

## 2. Play Console veri güvenliği formu

Play, her uygulamadan toplanan ve paylaşılan veriyi beyan etmesini ister. Beyan gerçekle
uyuşmazsa uygulama kaldırılır. Aşağıdaki cevaplar uygulamanın davranışına göredir.

**Genel sorular**

| Soru | Cevap |
|---|---|
| Uygulamanız gerekli veri türlerinden herhangi birini topluyor mu? | Evet |
| Toplanan bütün veriler aktarım sırasında şifreleniyor mu? | Evet |
| Kullanıcıların verilerinin silinmesini isteme yolu var mı? | Evet, uygulama içi çıkış ve uygulamayı kaldırma; ayrıca e-posta ile talep |

**Veri türleri**

| Veri türü | Toplanıyor | Paylaşılıyor | Zorunlu | Amaç |
|---|---|---|---|---|
| Ad | Evet | Hayır | Hayır, Drive kullanılmazsa istenmez | Uygulama işlevi (bağlı hesabı göstermek) |
| E-posta adresi | Evet | Hayır | Hayır | Uygulama işlevi |
| Dosyalar ve belgeler | Evet | Hayır | Hayır | Uygulama işlevi (Drive'dan açma ve Drive'a yükleme) |
| Yaklaşık konum | Hayır | Hayır | — | Yalnız cihazda anlık kullanılır, kaydedilmez |
| Tam konum | Hayır | Hayır | — | Yalnız cihazda anlık kullanılır, kaydedilmez |
| Fotoğraf | Hayır | Hayır | — | Kamera yalnız QR okumada, görüntü saklanmaz |
| Uygulama içi satın alma geçmişi | Evet | Hayır | Evet | Uygulama işlevi (Pro yetkisi) |
| Cihaz veya diğer kimlikler | Evet | Evet | Hayır | Reklam (yalnız ücretsiz sürüm, AdMob) |
| Kilitlenme günlükleri | Hayır | Hayır | — | Yerel hata kaydı, kullanıcı isterse kendisi paylaşır |

> **Not.** "Dosyalar ve belgeler" için Play'in "toplama" tanımı, verinin cihazdan
> çıkması demektir. Drive'a yükleme bu tanıma girer. Kullanıcının kendi Drive'ına
> gitmesi "paylaşma" sayılmaz, çünkü üçüncü bir tarafa aktarım yoktur.

**Güvenlik uygulamaları bölümü**

- Veriler aktarım sırasında şifrelenir: evet, Google ve Drive trafiği TLS zorunlu.
  Kullanıcının kendi girdiği kurum içi sunucu http ise bu istisna açıkça belirtilir.
- Bağımsız güvenlik incelemesi: CASA değerlendirmesi tamamlandığında işaretlenir.

---

## 3. Yapılacaklar sırası

1. Google Cloud projesi, Drive API, onay ekranı, Android OAuth istemcisi. Çıktı:
   `GOOGLE_CLIENT_ID` → `gradle.properties`.
2. ~~Gizlilik sayfası `main` dalına, GitHub Pages açık.~~ **Tamamlandı (14 Eylül 2026).**
   Sayfa `main` dalında ve yayında:
   <https://mahmuttari.github.io/Yonetmelik-araclari/dwgviewer/gizlilik.html> (HTTP 200,
   sunulan içerik `main:dwgviewer/gizlilik.html` ile bayt bayt aynı). Pages deponun `main`
   dalını sunuyor; yayımlama push'tan yaklaşık yirmi saniye sonra tamamlandı. Bu adres
   Google onay ekranının **Uygulama gizlilik politikası bağlantısı** alanına ve Play
   listelemesinin gizlilik politikası alanına yazılacak adrestir.
3. Gerçek AdMob kimlikleri.
4. Play Console kaydı. Uygulama oluştururken **mevcut imza anahtarını yükleyin**, yoksa
   Play kendi anahtarıyla imzalar, SHA-1 değişir ve Google girişi yayında çalışmaz.
   Mağaza kaydı arayüzle aynı **onbeş dilde** doldurulur; hazır metinler
   [`magaza-metinleri.md`](magaza-metinleri.md) dosyasındadır.
5. `dwg_pro` ürünü ve lisans anahtar çifti.
6. Mağaza görselleri, marka güvenli simge.
7. Doğrulama başvurusu ve CASA.
