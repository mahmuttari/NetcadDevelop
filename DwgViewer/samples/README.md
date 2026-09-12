# Örnek dosyalar

Sınama betiklerinin (`tools/test_*.mjs`) kullandığı çizimler. Betikler
örnek klasörünü varsayılan olarak buradan okur; `node tools/test_x.mjs
[çıktı] [örnekler]` ile başka bir klasör verilebilir.

| Dosya | Köken | Lisans | Kullanan betik |
|---|---|---|---|
| `example_r14.dwg` | LibreDWG `test/test-data/example_r14.dwg` (AC1014) | GPL-3.0 | `test_core` |
| `example_2000.dwg` | LibreDWG `test/test-data/example_2000.dwg` (AC1015) | GPL-3.0 | `test_core`, `test_editor`, `test_features`, `test_display2d`, `test_shell`, `test_docs` |
| `example_2004.dwg` | LibreDWG `test/test-data/example_2004.dwg` (AC1018) | GPL-3.0 | `test_core` |
| `example_2007.dwg` | LibreDWG `test/test-data/example_2007.dwg` (AC1021) | GPL-3.0 | `test_core` |
| `example_2010.dwg` | LibreDWG `test/test-data/example_2010.dwg` (AC1024) | GPL-3.0 | `test_core` |
| `example_2013.dwg` | LibreDWG `test/test-data/example_2013.dwg` (AC1027; AcDs katı verisi) | GPL-3.0 | `test_core`, `test_solids` |
| `example_2018.dwg` | LibreDWG `test/test-data/example_2018.dwg` (AC1032; AcDs katı verisi) | GPL-3.0 | `test_core`, `test_solids`, `test_features` (karşılaştırma) |
| `Surface_2004.dwg` | LibreDWG `test/test-data/2004/Surface.dwg` (ACIS 20800 yüzey varlıkları), adı sürümle eklenerek kopyalandı | GPL-3.0 | `test_solids` |
| `pface.dxf` | Bu proje için elle yazılmış küçük ASCII DXF: POLYLINE_PFACE (çok yüzlü ağ) | proje lisansı | `test_solids` |
| `pface_2000.dwg` | `pface_full.dxf`'ten LibreDWG `dwgwrite` ile R2000 (AC1015) olarak üretildi | proje lisansı | `test_solids` |
| `pface_2018.dwg` | `pface_full.dxf`'ten LibreDWG `dwgwrite` ile R2018 (AC1032) olarak üretildi | proje lisansı | `test_solids` |
| `pface_full.dxf` | `pface.dxf`'in `dwgwrite`/`dwg2dxf` ile tam tablolu (bütün bölümler) DXF hâli | proje lisansı | `test_solids` (yalnız üretim kaynağı; betik doğrudan açmaz) |
| `dos857_2000.dwg` | `test_tr.dxf`'ten `dwgwrite` ile R2000; başlıktaki kod sayfası baytı 15'e (DOS857) çevrildi, metinler CP857 (CRC bu yüzden uyuşmaz, uyarı beklenir) | proje lisansı | `test_io` |
| `Leader_2004.dwg` | LibreDWG `test/test-data/2004/Leader.dwg` (AC1018; MULTILEADER metni kod sayfalı) | GPL-3.0 | `test_io` |
| `test_tr.dxf` | Bu proje için elle yazılmış ASCII DXF (AC1015, `$DWGCODEPAGE` ANSI_1254): Türkçe yazılar, kapalı katmanlar, kot çizgileri | proje lisansı | `test_core`, `test_3d`, `test_features`, `test_display2d` |

LibreDWG kaynaklı dosyalar GNU LibreDWG deposundan (https://www.gnu.org/software/libredwg/)
alınmıştır ve o projenin lisansına (GPL-3.0-or-later) tabidir; yalnız sınama
amacıyla bulunur, APK'ya gömülmez.

`test_proxy.mjs` örnek dosya kullanmaz (sentetik proxy grafik akışı);
`test_docs.mjs` ZIP/DOCX/XLSX örneklerini çalışırken kendisi üretir.
