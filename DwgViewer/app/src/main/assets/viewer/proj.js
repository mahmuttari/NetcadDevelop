/*
 * Projeksiyon: Transversal Merkator (TM/UTM) ileri-geri dönüşüm, datum kaydırması
 * (ED50 ↔ WGS84, 3 parametreli Helmert), Türkiye'de kullanılan CRS ön tanımları
 * ve Web Merkator karo hesabı.
 *
 * Doğruluk: TM serileri < 1 mm; ED50 datum kaydırması ülke ortalamasıdır
 * (Türkiye için yaklaşık ±2-5 m). Sahada "buradayım" için yeterlidir; jeodezik
 * hesap için değildir.
 */
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export const ELLIPSOIDS = {
  GRS80: { a: 6378137, f: 1 / 298.257222101 },
  WGS84: { a: 6378137, f: 1 / 298.257223563 },
  INTL1924: { a: 6378388, f: 1 / 297 },
};

/** ED50 → WGS84 (EPSG:1133 Avrupa ortalaması); ters yönde işaret değişir */
const ED50_TO_WGS84 = { dx: -87, dy: -98, dz: -121 };

export const CRS = [
  { id: 'NONE', name: 'Tanımsız / yerel', tm: null },
  ...[27, 30, 33, 36, 39, 42, 45].map(l => ({ id: 'ITRF96_TM' + l, name: `ITRF96 / TM${l} (3°)  EPSG:${5253 + (l - 27) / 3}`, ell: 'GRS80', lon0: l, k0: 1, fe: 500000, fn: 0, datum: 'WGS84' })),
  ...[35, 36, 37].map(z => ({ id: 'WGS84_UTM' + z, name: `WGS84 / UTM ${z}N (6°)  EPSG:326${z}`, ell: 'WGS84', lon0: z * 6 - 183, k0: 0.9996, fe: 500000, fn: 0, datum: 'WGS84' })),
  ...[27, 30, 33, 36, 39, 42, 45].map(l => ({ id: 'ED50_TM' + l, name: `ED50 / TM${l} (3°)  EPSG:${2319 + (l - 27) / 3}`, ell: 'INTL1924', lon0: l, k0: 1, fe: 500000, fn: 0, datum: 'ED50' })),
  ...[35, 36, 37].map(z => ({ id: 'ED50_UTM' + z, name: `ED50 / UTM ${z}N (6°)  EPSG:230${z}`, ell: 'INTL1924', lon0: z * 6 - 183, k0: 0.9996, fe: 500000, fn: 0, datum: 'ED50' })),
  { id: 'WEBMERC', name: 'Web Merkator  EPSG:3857', merc: true, datum: 'WGS84' },
];
export const crsById = (id) => CRS.find(c => c.id === id) || CRS[0];

// ---- jeodezik ↔ ECEF, Helmert ----------------------------------------------------------
function geoToEcef(lat, lon, h, E) {
  const e2 = 2 * E.f - E.f * E.f, sl = Math.sin(lat), N = E.a / Math.sqrt(1 - e2 * sl * sl);
  return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * sl];
}
function ecefToGeo(X, Y, Z, E) {
  const e2 = 2 * E.f - E.f * E.f, p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - e2)), h = 0;
  for (let i = 0; i < 6; i++) {
    const sl = Math.sin(lat), N = E.a / Math.sqrt(1 - e2 * sl * sl);
    h = p / Math.cos(lat) - N;
    lat = Math.atan2(Z, p * (1 - e2 * N / (N + h)));
  }
  return [lat, Math.atan2(Y, X), h];
}
/** WGS84 (rad) → ED50 (rad) ya da tersi */
function datumShift(lat, lon, from, to) {
  if (from === to) return [lat, lon];
  const src = from === 'WGS84' ? ELLIPSOIDS.WGS84 : ELLIPSOIDS.INTL1924, dst = to === 'WGS84' ? ELLIPSOIDS.WGS84 : ELLIPSOIDS.INTL1924;
  const sgn = from === 'ED50' ? 1 : -1;
  const [X, Y, Z] = geoToEcef(lat, lon, 0, src);
  const [la, lo] = ecefToGeo(X + sgn * ED50_TO_WGS84.dx, Y + sgn * ED50_TO_WGS84.dy, Z + sgn * ED50_TO_WGS84.dz, dst);
  return [la, lo];
}

// ---- Transversal Merkator (Krüger serisi, ~nm doğruluk) ------------------------------------
function tmConsts(E) {
  const n = E.f / (2 - E.f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const A = E.a / (1 + n) * (1 + n2 / 4 + n4 / 64);
  const alpha = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16, 13 * n2 / 48 - 3 * n3 / 5, 61 * n3 / 240];
  const beta = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96, n2 / 48 + n3 / 15, 17 * n3 / 480];
  const delta = [2 * n - 2 * n2 / 3 - 2 * n3, 7 * n2 / 3 - 8 * n3 / 5, 56 * n3 / 15];
  return { n, A, alpha, beta, delta, e: Math.sqrt(2 * E.f - E.f * E.f) };
}
export function tmForward(lat, lon, crs) {
  const E = ELLIPSOIDS[crs.ell], C = tmConsts(E);
  const lon0 = crs.lon0 * D2R;
  const t = Math.sinh(Math.atanh(Math.sin(lat)) - 2 * Math.sqrt(C.n) / (1 + C.n) * Math.atanh(2 * Math.sqrt(C.n) / (1 + C.n) * Math.sin(lat)));
  const xi0 = Math.atan2(t, Math.cos(lon - lon0)), eta0 = Math.atanh(Math.sin(lon - lon0) / Math.sqrt(1 + t * t));
  let xi = xi0, eta = eta0;
  for (let j = 1; j <= 3; j++) { xi += C.alpha[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0); eta += C.alpha[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0); }
  return [crs.fe + crs.k0 * C.A * eta, crs.fn + crs.k0 * C.A * xi];
}
export function tmInverse(east, north, crs) {
  const E = ELLIPSOIDS[crs.ell], C = tmConsts(E);
  const xi = (north - crs.fn) / (crs.k0 * C.A), eta = (east - crs.fe) / (crs.k0 * C.A);
  let xi1 = xi, eta1 = eta;
  for (let j = 1; j <= 3; j++) { xi1 -= C.beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); eta1 -= C.beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let lat = chi;
  for (let j = 1; j <= 3; j++) lat += C.delta[j - 1] * Math.sin(2 * j * chi);
  const lon = crs.lon0 * D2R + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return [lat, lon];
}

// ---- Web Merkator ------------------------------------------------------------------------
const R_MERC = 6378137;
export const mercForward = (lat, lon) => [R_MERC * lon, R_MERC * Math.log(Math.tan(Math.PI / 4 + lat / 2))];
export const mercInverse = (x, y) => [2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2, x / R_MERC];

// ---- genel arayüz: WGS84 derece ↔ CRS metre ----------------------------------------------------
/** [lonDeg, latDeg] → [E, N] (metre) */
export function toCrs(lonDeg, latDeg, crs) {
  if (!crs || !crs.datum) return null;
  let lat = latDeg * D2R, lon = lonDeg * D2R;
  if (crs.merc) return mercForward(lat, lon);
  [lat, lon] = datumShift(lat, lon, 'WGS84', crs.datum);
  return tmForward(lat, lon, crs);
}
/** [E, N] → [lonDeg, latDeg] */
export function fromCrs(E, N, crs) {
  if (!crs || !crs.datum) return null;
  let lat, lon;
  if (crs.merc) [lat, lon] = mercInverse(E, N);
  else { [lat, lon] = tmInverse(E, N, crs); [lat, lon] = datumShift(lat, lon, crs.datum, 'WGS84'); }
  return [lon * R2D, lat * R2D];
}

/**
 * Çizim ↔ CRS eşlemesi. Çizim birimi (mm/cm/m) ve eksen sırası (X=Doğu ya da X=Kuzey)
 * ile isteğe bağlı ek kaydırma.  unitToM: 1 çizim birimi kaç metre.
 */
export class GeoRef {
  constructor(opt = {}) {
    this.crs = crsById(opt.crs || 'NONE');
    this.unitToM = opt.unitToM || 1;
    this.swap = !!opt.swap;       // çizimde X=Kuzey, Y=Doğu
    this.dx = opt.dx || 0; this.dy = opt.dy || 0; // çizim birimi cinsinden ek kaydırma
  }
  get active() { return !!this.crs.datum; }
  /** çizim (x,y) → [lon, lat] */
  toLonLat(x, y) {
    if (!this.active) return null;
    let ex = (x - this.dx) * this.unitToM, ny = (y - this.dy) * this.unitToM;
    if (this.swap) [ex, ny] = [ny, ex];
    return fromCrs(ex, ny, this.crs);
  }
  /** [lon, lat] → çizim (x,y) */
  toDrawing(lon, lat) {
    if (!this.active) return null;
    let [ex, ny] = toCrs(lon, lat, this.crs);
    if (this.swap) [ex, ny] = [ny, ex];
    return [ex / this.unitToM + this.dx, ny / this.unitToM + this.dy];
  }
}

// ---- karo matematiği (XYZ / OSM) -----------------------------------------------------------------
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const x = (lon + 180) / 360 * n;
  const la = lat * D2R;
  const y = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
  return [x, y];
}
export function tileToLonLat(x, y, z) {
  const n = 2 ** z;
  const lon = x / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * R2D;
  return [lon, lat];
}
/** metre/piksel çözünürlüğüne uygun yakınlaştırma düzeyi */
export function zoomForResolution(mPerPx, lat) {
  const z = Math.log2(156543.03392 * Math.cos(lat * D2R) / Math.max(1e-9, mPerPx));
  return Math.max(0, Math.min(20, Math.round(z)));
}
export const BASEMAPS = [
  { id: 'none', name: 'Altlık yok' },
  { id: 'osm', name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '© OpenStreetMap katkıda bulunanlar' },
  { id: 'esri_sat', name: 'Esri Uydu (World Imagery)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 19, attr: 'Esri, Maxar, Earthstar Geographics' },
  { id: 'esri_topo', name: 'Esri Topografik', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', max: 19, attr: 'Esri' },
  { id: 'esri_street', name: 'Esri Sokak', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', max: 19, attr: 'Esri' },
  { id: 'wms', name: 'Özel WMS (EPSG:3857)', wms: true },
  { id: 'xyz', name: 'Özel XYZ karo adresi', custom: true },
];
