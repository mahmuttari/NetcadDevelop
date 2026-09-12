# Üçüncü taraf bileşenler ve lisansları

DWG Görüntüleyici aşağıdaki bileşenleri kullanır. Bu dosya yalnız kaynak
ağacında durur; APK'ya girmez (`ignoreAssetsPattern` ile `*.md` dışlanır).

| Bileşen | Sürüm | Lisans | Kullanım |
|---|---|---|---|
| @mlightcad/libredwg-web (`dist/`, `wasm/`) | 0.7.10 | GPL-3.0 (LibreDWG) | DWG/DXF ayrıştırma (WebAssembly) |
| LibreDWG | libredwg-web ile derlenen sürüm | GPL-3.0 | DWG okuma çekirdeği |
| jsQR (`jsQR.js`) | — | Apache-2.0 | QR kod okuma (kamera) |
| junrar | 7.5.5 | MIT | RAR 2/3/4 arşivleri (Android tarafı) |
| AndroidX Core | 1.13.1 | Apache-2.0 | FileProvider (paylaşım) |

- libredwg-web: https://github.com/mlightcad/libredwg-web
- LibreDWG: https://www.gnu.org/software/libredwg/
- jsQR: https://github.com/cozmo/jsQR
- junrar: https://github.com/junrar/junrar
- AndroidX: https://developer.android.com/jetpack/androidx
