/*
 * 3B görünüm: WebGL ile çizgi/yüzey/nokta çizimi, yörünge (orbit) kamerası, köşe yakalama ve seçim.
 * Sahne ilkelleri (scene.js) segmentlere ayrılır; yaylar örneklenir; 3DFACE / dolgular üçgenlenir.
 *
 * Görsel stiller (tel kafes, gizli çizgi, gölgeli, gölgeli+kenar, röntgen), renklendirme
 * (nesne / katman / kot / tek renk), zemin ızgarası, eksenler, kesit kutusu, düşey abartı,
 * ön ayarlı kamera açıları (animasyonlu), kamera geçmişi, döner tabla, HUD ve ekran görüntüsü.
 *
 * Seçenekler `opts` içindedir; dışarıdan yalnız `set(key, value)` ile değiştirilir. Kalıcı
 * seçenekler `store 'view3d'` anahtarında tutulur (clip, clipBox, turntable ve zScale hariç).
 */
import { TAU, arcPts, ellipsePts, rayBox3, rayMesh3 } from './geom.js';
import { t } from './i18n.js';
import { FG } from './scene.js';
import { store, fmt as fmtNum } from './state.js';

// ---- gölgelendiriciler ------------------------------------------------------------------------
// Tek program: renk modu (öznitelik / kot rampası / tek renk), aydınlatma, kesit ve derinlik
// solması uniform'larla seçilir. Konumlar sahne merkezine göre (origin) tutulur: büyük UTM
// koordinatlarında float32 hassasiyeti bozulmasın diye.
const VS = `
attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aNrm;
uniform mat4 uMVP; uniform float uZ; uniform float uPointSize; uniform vec2 uOff;
uniform int uColorMode; uniform vec3 uFg; uniform float uZmin; uniform float uZmax;
uniform vec3 uClipMin; uniform vec3 uClipInv; uniform vec3 uEye; uniform vec2 uFadeRange;
uniform float uJitter; uniform float uSeed; uniform float uHull; uniform int uFlat; uniform float uFlatZ;
uniform vec3 uViewDir; uniform int uPersp; uniform float uHullBack;
varying vec4 vCol; varying vec3 vNrm; varying vec3 vClip; varying float vFade; varying vec3 vPos;
vec3 ramp(float t) {
  vec3 c0 = vec3(0.16, 0.36, 0.95), c1 = vec3(0.2, 0.8, 0.9), c2 = vec3(0.25, 0.82, 0.3), c3 = vec3(0.98, 0.85, 0.2), c4 = vec3(0.95, 0.25, 0.2);
  float s = t * 4.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  return mix(c3, c4, clamp(s - 3.0, 0.0, 1.0));
}
void main() {
  vec3 p3 = vec3(aPos.x, aPos.y, aPos.z * uZ);
  // düşey abartıda normal ters-devrikle döner: (nx·s, ny·s, nz); uZ=1 iken değişmez
  vec3 nS = length(aNrm) > 0.0 ? normalize(vec3(aNrm.x * uZ, aNrm.y * uZ, aNrm.z)) : vec3(0.0, 0.0, 1.0);
  if (uFlat == 1) p3.z = uFlatZ;                       // zemin gölgesi: yüzeyler zemine yatırılır
  if (uHull > 0.0) {                                   // siluet: kameradan uzak yöne şişirilmiş kabuk
    vec3 n = nS; if (dot(n, uEye - p3) > 0.0) n = -n;
    p3 += n * uHull;
    // kabuk bakış doğrultusunda yüzün belirgin biçimde ARKASINA alınır (uHullBack x siluet kalınlığı). Böylece derinlik
    // sırası sürücünün polygonOffset davranışına bağlı kalmaz: bazı mobil GPU'larda ofset yetersiz kalıp dik yüzler
    // kabukla siyaha boyanıyordu. Paralelde ekran konumu değişmez, perspektifte kayma piksel altıdır.
    vec3 vd = uPersp == 1 ? normalize(p3 - uEye) : uViewDir;
    p3 += vd * uHull * uHullBack;
  }
  vec4 p = uMVP * vec4(p3, 1.0);
  p.xy += uOff * p.w;
  if (uJitter > 0.0) {                                 // eskiz: konuma bağlı sözde rastgele titreme
    float h1 = fract(sin(dot(aPos.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453);
    float h2 = fract(sin(dot(aPos.yz + uSeed, vec2(39.3468, 11.135))) * 43758.5453);
    p.xy += (vec2(h1, h2) - 0.5) * uJitter * p.w;
  }
  gl_Position = p; gl_PointSize = uPointSize;
  vNrm = nS; vPos = p3;
  vClip = (aPos - uClipMin) * uClipInv;
  // Paralel izdüşümde göz bir NOKTA değildir: uzaklık, bakış doğrultusuna izdüşümdür.
  // Öklit uzaklığı kullanılırsa düz bir planda dairesel bir vinyet doğar (ekrana çakılı leke).
  float uzak = uPersp == 1 ? distance(p3, uEye) : dot(p3 - uEye, uViewDir);
  vFade = clamp((uzak - uFadeRange.x) / max(uFadeRange.y - uFadeRange.x, 1e-6), 0.0, 1.0);
  vec3 rgb = aCol.rgb;
  if (uColorMode == 1) rgb = ramp(clamp((aPos.z - uZmin) / max(uZmax - uZmin, 1e-9), 0.0, 1.0));
  else if (uColorMode == 2) rgb = uFg;
  vCol = vec4(rgb, aCol.a);
}`;
const FS = `
precision mediump float;
varying vec4 vCol; varying vec3 vNrm; varying vec3 vClip; varying float vFade; varying vec3 vPos;
uniform float uAlpha; uniform vec4 uOverride; uniform bool uClip;
uniform bool uLit; uniform vec3 uLightDir; uniform float uAmbient; uniform float uIntensity;
// İKİ AŞAMADA DA bulunan uniform'ların DUYARLILIĞI aynı olmak zorundadır (GLSL ES 1.00, 4.5.3): köşe aşamasında
// öntanımlı duyarlılık float/int için highp'tir, parça aşamasında float için bildirilen (burada mediump), int için
// mediump'tir. uEye/uViewDir/uPersp burada highp yazılmazsa program BAĞLANMAZ ve 3B görünüm hiç açılmaz.
uniform float uFade; uniform vec3 uBg; uniform int uShade; uniform float uGray; uniform highp vec3 uEye; uniform highp vec3 uViewDir; uniform highp int uPersp;
void main() {
  if (uClip && (vClip.x < 0.0 || vClip.y < 0.0 || vClip.z < 0.0 || vClip.x > 1.0 || vClip.y > 1.0 || vClip.z > 1.0)) discard;
  vec3 rgb = uOverride.a > 0.0 ? uOverride.rgb : vCol.rgb;
  if (uLit) {
    vec3 n = normalize(vNrm); float d = abs(dot(n, uLightDir));
    if (uShade == 1) {                                  // kavramsal: Gooch soğuk-sıcak
      float t = dot(n, uLightDir) * 0.5 + 0.5;
      vec3 cool = vec3(0.16, 0.22, 0.5) + 0.3 * rgb, warm = vec3(0.6, 0.5, 0.25) + 0.55 * rgb;
      rgb = mix(cool, warm, t) * (uAmbient + (1.0 - uAmbient) * uIntensity);
    } else {
      rgb *= uAmbient + (1.0 - uAmbient) * d * uIntensity;
      if (uShade == 2) { vec3 v = uPersp == 1 ? normalize(uEye - vPos) : -uViewDir; vec3 h = normalize(uLightDir + v); float sp = pow(max(abs(dot(n, h)), 0.0), 36.0); rgb += vec3(0.28) * sp * uIntensity; }   // gerçekçi: parlama (paralelde bakış doğrultusu sabittir; nokta göz ekrana çakılı leke doğururdu)
    }
  }
  if (uGray > 0.0) { float l = dot(rgb, vec3(0.299, 0.587, 0.114)); rgb = mix(rgb, vec3(l), uGray); }
  if (uFade > 0.0) rgb = mix(rgb, uBg, uFade * vFade);
  gl_FragColor = vec4(rgb, vCol.a * uAlpha);
}`;

/** Siluet kabuğunun bakış doğrultusunda geri itilme payı (siluet kalınlığı katı): polygonOffset'ten bağımsız derinlik sırası */
const HULL_BACK = 6;

// ---- küçük matris kütüphanesi (sütun-öncelikli 4x4) ----
function perspective(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]; }
function ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; }
function lookAt(eye, c, up) {
  let zx = eye[0] - c[0], zy = eye[1] - c[1], zz = eye[2] - c[2]; let L = Math.hypot(zx, zy, zz) || 1; zx /= L; zy /= L; zz /= L;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx; L = Math.hypot(xx, xy, xz) || 1; xx /= L; xy /= L; xz /= L;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
}
function mul4(a, b) { const o = new Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
function xform4(m, x, y, z) { const w = m[3] * x + m[7] * y + m[11] * z + m[15]; return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w]; }
function translate(tx, ty, tz) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]; }

// ---- yardımcılar ----
/** css renk ('#rgb', '#rrggbb', 'rgb(a,b,c)') ya da [r,g,b] (0..1) → [r,g,b] (0..1); tanınmazsa null */
export function parseColor(c) {
  if (c == null) return null;
  if (Array.isArray(c)) return c.length >= 3 ? [c[0], c[1], c[2]] : null;
  if (typeof c === 'number') return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  if (typeof c !== 'string') return null;
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s); if (m) return [parseInt(m[1][0] + m[1][0], 16) / 255, parseInt(m[1][1] + m[1][1], 16) / 255, parseInt(m[1][2] + m[1][2], 16) / 255];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s); if (m) { const v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s); if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
  // hsl(): katman paleti (render.layerPalette) bu biçimi üretir — "hsl(214.5 70% 62%)"
  m = /^hsla?\(\s*([\d.+-]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/i.exec(s);
  if (m) {
    const h = ((+m[1] % 360) + 360) % 360 / 360, sa = +m[2] / 100, l = +m[3] / 100;
    if (sa <= 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + sa) : l + sa - l * sa, pp = 2 * l - q;
    const kanal = (t) => { t = t < 0 ? t + 1 : t > 1 ? t - 1 : t; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
    return [kanal(h + 1 / 3), kanal(h), kanal(h - 1 / 3)];
  }
  return null;
}
const toCss = (c) => '#' + [0, 1, 2].map(i => Math.round(Math.max(0, Math.min(1, c[i])) * 255).toString(16).padStart(2, '0')).join('');
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function niceStep(v) { const p = 10 ** Math.floor(Math.log10(v || 1)); const m = v / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
/** açı farkını en kısa yönde alır */
const angDelta = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const reduceMotion = () => {
  try { if (document.body && document.body.classList.contains('reduce-motion')) return true; } catch (_) { /* geç */ }
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
};

/** büyüyen Float32 dizisi (tampon kurulumu için; per-frame değil) */
class Grow {
  constructor(cap = 1024) { this.a = new Float32Array(cap); this.n = 0; }
  push3(x, y, z) { if (this.n + 3 > this.a.length) this.grow(); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n += 3; }
  push4(x, y, z, w) { if (this.n + 4 > this.a.length) this.grow(); const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = w; this.n += 4; }
  push1(x) { if (this.n + 1 > this.a.length) this.grow(); this.a[this.n++] = x; }
  grow() { const b = new Float32Array(Math.max(1024, this.a.length * 2)); b.set(this.a); this.a = b; }
  out() { return this.a.slice(0, this.n); }   // kopya: kapasite fazlası ölü bellek taşınmaz (setScene tek seferlik)
}

/** 32 bit indeks tamponu (Grow'un Float32 karşılığı) */
class GrowU32 {
  constructor(cap = 1024) { this.a = new Uint32Array(cap); this.n = 0; }
  push1(x) { if (this.n + 1 > this.a.length) { const b = new Uint32Array(Math.max(1024, this.a.length * 2)); b.set(this.a); this.a = b; } this.a[this.n++] = x; }
  out() { return this.a.slice(0, this.n); }
}
/** kırışıklık eşiği: bu açıdan keskin komşu yüzler ayrı köşe alır (düz yüzey düz kalır, kavis yumuşar) */
const COS_CREASE = Math.cos(30 * Math.PI / 180);
/** etkileşim sadeleştirmesi eşikleri: ağ indeksi (üçgen×3), yavaş kare süresi, ardışıklık aralığı, durulma gecikmesi */
const MESH_PICK_V = 8;   // ağ gövdesi başına yakalama/seçim için örneklenen köşe sayısı
const FAST_MESH_IDX = 2000000, FAST_FRAME_MS = 45, FAST_GAP_MS = 350, FAST_SETTLE_MS = 220;
/*
 * Kenar dizisi boş bir gövdeye tel kafes kenarı ÜRETİLİR (bkz. _telKafesKenar); üçgen sayısı bunu
 * aşan gövdede üretilmez. Sınır bellek içindir: kenar haritası üçgen başına üç girdi tutar ve
 * 250 bin üçgende ~750 bin kenar eder. Bu ölçekteki gövdeler zaten kendi kenar listesiyle gelir.
 */
const MESH_WIRE_MAX_TRI = 250000;
/** Üretilen tel kafeste kırışıklık eşiği: scene.meshEdges ile AYNI 20° (COS_CREASE 30°'dir ve
    yumuşak NORMAL gruplaması içindir; kenar kararı onunla karıştırılmaz). */
const COS_WIRE = Math.cos(20 * Math.PI / 180);
/*
 * TEL KAFESTE KAVİSLİ YÜZEYİN YÜZ KENARLARI (v8.9). 20°'lik kırışıklık kuralı düz bir borunun yan
 * yüzlerini elemekteydi: 32 dilimli boruda komşu yüzler 11,25° yapar, kenar sayılmaz, tel kafeste
 * yalnız uç halkaları kalır ve gövde yok olur (kullanıcı: "gerçekçi kipte görünen boru profiller
 * tel kafeste görünmüyor"). Yüzey çizilmeyen stillerde EŞ DÜZLEMLİ olmayan her yüz kenarı çizilir —
 * AutoCAD'in çok yüzlü ağ (PFACE) için 2B tel kafeste yaptığı budur. Eşik 1°: üçgenleme çaprazları
 * (0°) yine elenir, 128 dilimli boru (2,8°) bile çizilir.
 */
const COS_FACET = Math.cos(1 * Math.PI / 180);
/** Tel kafes kenar tamponu için üst sınır (float sayısı): aşan gövdeler 20°'lik kümesiyle kalır */
const WIRE_MAX_FLOATS = 36000000;
/** Bu kadar renk grubundan sonra grup başına çizim çağrısı yerine köşe başına (1 baytlık) renk tamponu kullanılır */
const WIRE_GRUP_MAX = 64;
const BOS_F32 = new Float32Array(0);

const PRESET_ANGLES = {
  /*
   * ÜST VE ALT TAM DİK BAKIŞTIR. Eğim TAM 90° yapılamaz: lookAt'in yukarı vektörü (0,0,1)
   * bakış doğrultusuyla çakışır ve taban kurulamaz. 1e-6'lık pay bunu önler; eski 1e-3'lük
   * pay 200 m'lik bir yapının tepesini planda 20 cm yana kaydırıyordu, 1e-6 ile bu 0,2 mm'ye
   * iner — plan çizimi için ölçülemez.
   */
  top: { yaw: -Math.PI / 2, pitch: Math.PI / 2 - 1e-6 },
  bottom: { yaw: -Math.PI / 2, pitch: -Math.PI / 2 + 1e-6 },
  front: { yaw: -Math.PI / 2, pitch: 0.001 },
  back: { yaw: Math.PI / 2, pitch: 0.001 },
  left: { yaw: Math.PI, pitch: 0.001 },
  right: { yaw: 0, pitch: 0.001 },
  iso: { yaw: -Math.PI / 4, pitch: 0.6 },
  isoNE: { yaw: -Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
  isoNW: { yaw: -3 * Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
  isoSE: { yaw: Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
  isoSW: { yaw: 3 * Math.PI / 4, pitch: 35.264 * Math.PI / 180 },
};
const PERSIST_SKIP = new Set(['clip', 'clipBox', 'turntable', 'zScale']);
const TOUCH_ENUM = { oneFinger: ['orbit', 'pan'], twoFinger: ['zoompan', 'zoomrotate'], threeFinger: ['pan', 'orbit', 'none'], doubleTap: ['fit', 'zoom', 'none'] };
const ENUMS = {
  style: ['wireframe', 'wireframe2d', 'hidden', 'shaded', 'shadedEdges', 'realistic', 'conceptual', 'gray', 'sketchy', 'xray'], colorMode: ['entity', 'layer', 'elevation', 'mono'], lightMode: ['camera', 'fixed'],
  lightQuality: ['faceted', 'smooth'], edges: ['auto', 'facet', 'none'], edgeColor: ['auto', 'black', 'white', 'fg'],
  gridZ: ['min', 'zero', 'custom'], bg: ['theme', 'gradient', 'black', 'white', 'custom'], lineWidth: ['thin', 'normal', 'thick'],
  elevLabels: ['off', 'sel', 'visible'], hudPos: ['tl', 'bl'],
};
const FACE_ETS = new Set(['3DFACE', 'POLYFACE', 'POLYLINE_PFACE', 'POLYLINE_MESH']);

export class View3D {
  static DEFAULTS = Object.freeze({
    style: 'wireframe', colorMode: 'entity',
    light: true, lightMode: 'camera', lightIntensity: 0.8, ambient: 0.45,
    grid: true, gridStep: 'auto', gridZ: 'min', gridZValue: 0,
    axes: true, axisLabels: true, compass: true, cube: true,
    fov: 52, bg: 'theme', bgColor: '#000000',
    pointSize: 6, textPoints: true, lineWidth: 'normal',
    clip: null, clipBox: false, turntable: false, turnSpeed: 15, depthFade: false, dimOthers: false,
    elevLabels: 'off', hud: true, hudPos: 'tl',
    // görsel stil ayrıntıları (AutoCAD görsel stil yöneticisine benzer): yüz, kenar, ortam
    lightQuality: 'faceted', specular: false, faceOpacity: 1,
    edges: 'auto', edgeColor: 'auto', silhouette: false, silhouetteWidth: 2, overhang: 0, jitter: 0,
    shadow: false,
    touch: Object.freeze({ oneFinger: 'orbit', invertY: false, sensitivity: 1, twoFinger: 'zoompan', threeFinger: 'pan', doubleTap: 'fit' }),
  });
  /** stil ön ayarları: seçenek geçersiz kılmaları (kullanıcı ayarı sıfır/yanlış ise stilinki geçerli) */
  static STYLES = Object.freeze({
    wireframe: { faces: 'none', edges: true, depth: true }, wireframe2d: { faces: 'none', edges: true, depth: false },
    hidden: { faces: 'bg', edges: true }, shaded: { faces: 'lit', edges: false }, shadedEdges: { faces: 'lit', edges: true },
    realistic: { faces: 'lit', edges: false, shade: 2, quality: 'smooth', specular: true }, conceptual: { faces: 'lit', edges: true, shade: 1, silhouette: true },
    gray: { faces: 'lit', edges: true, gray: 1 }, sketchy: { faces: 'lit', edges: true, jitter: 2, overhang: 2 }, xray: { faces: 'xray', edges: true },
  });
  static PRESETS = [
    { id: 'top', tr: 'Üst', en: 'Top' }, { id: 'bottom', tr: 'Alt', en: 'Bottom' }, { id: 'front', tr: 'Ön', en: 'Front' }, { id: 'back', tr: 'Arka', en: 'Back' },
    { id: 'left', tr: 'Sol', en: 'Left' }, { id: 'right', tr: 'Sağ', en: 'Right' }, { id: 'iso', tr: 'İzometrik', en: 'Isometric' },
    { id: 'isoNE', tr: 'İzo KD', en: 'Iso NE' }, { id: 'isoNW', tr: 'İzo KB', en: 'Iso NW' }, { id: 'isoSE', tr: 'İzo GD', en: 'Iso SE' }, { id: 'isoSW', tr: 'İzo GB', en: 'Iso SW' },
  ];
  static PRESET_ANGLES = PRESET_ANGLES;

  constructor(canvas) {
    this.cv = canvas;
    // alpha: true — 2B PLAN ALTLIĞI için gerekir: kare saydam temizlenip 2B tuvalinin üstüne basılır
    // (altlık haritası ve ızgara altta kalsın). Normal 3B görünümde temizleme alfası 1'dir, görüntü değişmez.
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL yok');
    this.gl = gl;
    this._lost = false;
    this._initGL();
    // tamponlar: her ad için konum (pos) + renk (col) (+ normal) ayrı
    this.bufs = {};
    this._n = { lines: 0, edges: 0, tris: 0, pts: 0, txt: 0, mesh: 0, grid: 0, axes: 0, sel: 0, clipBox: 0, bgq: 0 };
    this._nIdx = { mesh: 0 };
    this.counts = { lines: 0, tris: 0, pts: 0, grid: 0, axes: 0, sel: 0 };
    this.src = {};            // yeniden renklendirme / yeniden yükleme kaynakları (konum, renk, katman, normal)
    this.layerNames = []; this.layerRGB = new Float32Array(0); this.layerIdx = new Map();
    this.cam = { yaw: -Math.PI / 4, pitch: 0.6, dist: 100, target: [0, 0, 0], persp: false };   // AutoCAD gibi varsayılan paralel izdüşüm
    this.zScale = 1;
    this.center = [0, 0, 0]; this.radius = 1; this.origin = [0, 0, 0];
    this.bb = null; this.zrange = [0, 1];
    // yakalama köşeleri: xyz (Float64, ölçüm hassasiyeti için) + ilkel dizisi; `vertices` görünümü istenince kurulur
    this.vertXYZ = new Float64Array(0); this.vertPrim = []; this._vertsView = null;
    this.meshPrims = [];                                   // yüzey seçimi için ağ ilkelleri (k=5); görünmez katmanlar zaten elenmiş olur
    this.dark = true;
    this.fg = [0.95, 0.96, 0.97]; this.bgTheme = [0.11, 0.13, 0.16]; this.selColor = [1, 0.62, 0.04];
    this.units = ''; this.gridStep = 1;
    this.hist = []; this.histI = -1;
    this.onChange = null; this.onFrame = null;
    this.lastMvp = null; this._mvpF32 = new Float32Array(16);
    this._anim = null; this._turn = null; this._persistT = 0;
    this.sceneOpts = {}; this.fadeSet = null; this.fadePct = 0; this._selCount = 0;
    // seçenekler
    this.opts = JSON.parse(JSON.stringify(View3D.DEFAULTS));
    this._loadOpts();
    this._bindStop();
    this._bindContext();
    this._uploadBgQuad();
  }
  /** program, öznitelik ve uniform konumları — kurucuda ve bağlam geri geldiğinde */
  _initGL() {
    const gl = this.gl;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog; gl.useProgram(prog);
    // 32 bit indeks eklentisi BAĞLAM BAŞINA etkindir: bağlam kaybından sonra yeniden istenmeli
    this.u32 = !!gl.getExtension('OES_element_index_uint');
    this.aPos = gl.getAttribLocation(prog, 'aPos'); this.aCol = gl.getAttribLocation(prog, 'aCol'); this.aNrm = gl.getAttribLocation(prog, 'aNrm');
    this.u = {};
    for (const n of ['uMVP', 'uZ', 'uPointSize', 'uOff', 'uColorMode', 'uFg', 'uZmin', 'uZmax', 'uClipMin', 'uClipInv', 'uEye', 'uFadeRange', 'uAlpha', 'uOverride', 'uClip', 'uLit', 'uLightDir', 'uAmbient', 'uIntensity', 'uFade', 'uBg', 'uJitter', 'uSeed', 'uHull', 'uFlat', 'uFlatZ', 'uShade', 'uGray', 'uViewDir', 'uPersp', 'uHullBack']) this.u[n] = gl.getUniformLocation(prog, n);
  }
  /** WebGL bağlam kaybı: preventDefault ile geri verilmesi istenir; geri gelince her şey yeniden kurulur */
  _bindContext() {
    /*
     * BAĞLAM KAYBI SESSİZ KALMAZ (v8.1). Android WebView bellek baskısında ya da uygulama arka
     * plana alındığında WebGL bağlamını düşürebilir; o anda tuval boşalır ve kullanıcı "3B görüntü
     * kayboldu" der. preventDefault bağlamın geri verilmesini ISTER ama garanti etmez, bu yüzden:
     *   (1) durum dışarı bildirilir ('lost') — kabuk kullanıcıya ne olduğunu söyler,
     *   (2) tarayıcı kendiliğinden geri vermezse WEBGL_lose_context.restoreContext() ile BİR KEZ
     *       denenir (uzantı yoksa ya da yok sayılırsa zarar vermez).
     */
    this.cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._lost = true; this._anim = null; if (this._turn) this.setTurntable(false);
      this._emit('context', 'lost');
      clearTimeout(this._restoreT);
      this._restoreT = setTimeout(() => {
        if (!this._lost) return;
        try { const x = this.gl.getExtension('WEBGL_lose_context'); if (x && x.restoreContext) x.restoreContext(); } catch (_) { /* geri getirilemedi: kabuk sahneyi yeniden kurar */ }
      }, 1200);
    });
    this.cv.addEventListener('webglcontextrestored', () => {
      try { this._initGL(); } catch (_) { return; }   // kurulum başarısızsa _lost açık kalır: ölü programla çizilmez
      this._lost = false;
      clearTimeout(this._restoreT);
      this.bufs = {}; this._smoothReady = false;
      this._uploadBgQuad();
      this._reupload();
      this.render();
      // 32 bit indeks uzantısı yeni bağlamda yoksa ağ tamponu çizilemez: sahne kaynaktan yeniden kurulmalı
      this._emit('context', (!this.u32 && (this._nIdx.mesh || 0) > 0) ? 'rebuild' : 'restored');
    });
  }
  /** sahne tamponlarını `src`ten, yardımcı tamponları (ızgara, eksen, kesit kutusu, seçim) üreticilerinden yeniden yükler */
  _reupload() {
    for (const n of ['lines', 'edges', 'medges', 'tris', 'pts', 'txt', 'mesh']) {
      const s = this.src[n]; if (!s || !s.pos) continue;
      this.uploadPos(n, s.pos); if (s.nrm) this.uploadNrm(n, s.nrm);
      if (s.idx) this.uploadIdx(n, s.idx);
    }
    if (this._wire && this._wire.pos) { this.uploadPos('wedges', this._wire.pos); if (this._wire.colU8) this.uploadCol('wedges', this._wire.colU8); }
    this._applyOverhang();
    this.recolor();
    this.buildGrid(); this.buildAxes(); this.buildClipBox();
    this.setSelection(this._lastSel || []);
  }

  // ---------------------------------------------------------------------------------
  // seçenekler ve kalıcılık
  // ---------------------------------------------------------------------------------
  _loadOpts() {
    const st = store.json('view3d', null);
    if (!st || typeof st !== 'object') return;
    if (typeof st.persp === 'boolean') this.cam.persp = st.persp;
    for (const k of Object.keys(View3D.DEFAULTS)) {
      if (PERSIST_SKIP.has(k) || !(k in st)) continue;
      const v = st[k], def = View3D.DEFAULTS[k];
      if (k === 'touch') { if (v && typeof v === 'object') { for (const tk of Object.keys(TOUCH_ENUM)) if (TOUCH_ENUM[tk].includes(v[tk])) this.opts.touch[tk] = v[tk]; if (typeof v.invertY === 'boolean') this.opts.touch.invertY = v.invertY; if (isFinite(v.sensitivity) && v.sensitivity > 0) this.opts.touch.sensitivity = clamp(+v.sensitivity, 0.25, 4); } continue; }
      if (k === 'colorMode' && ENUMS[k].includes(v)) { this.opts[k] = v; this._renkKayitli = true; continue; }   // kullanıcının önceki 3B seçimi
      if (ENUMS[k]) { if (k === 'edges' && v === 'facet' && st.edgesChosen !== true) { this.opts[k] = 'auto'; continue; } if (ENUMS[k].includes(v)) this.opts[k] = v; continue; }   // eski varsayılan 'facet' → stile göre
      if (k === 'gridStep') { if (v === 'auto' || (isFinite(v) && v > 0)) this.opts[k] = v; continue; }
      if (typeof def === 'boolean') { if (typeof v === 'boolean') this.opts[k] = v; continue; }
      if (typeof def === 'number') { if (typeof v === 'number' && isFinite(v)) this.opts[k] = v; continue; }
      if (typeof def === 'string') { if (typeof v === 'string') this.opts[k] = v; }
    }
  }
  _persist() {
    clearTimeout(this._persistT);
    this._persistT = setTimeout(() => {
      const o = {};
      for (const k of Object.keys(View3D.DEFAULTS)) if (!PERSIST_SKIP.has(k)) o[k] = this.opts[k];
      o.persp = this.cam.persp; o.edgesChosen = true;
      store.set('view3d', JSON.stringify(o));
    }, 300);
  }
  _emit(key, value) {
    try { if (typeof this.onChange === 'function') this.onChange(key, value); } catch (_) { /* dinleyici hatası görünümü durdurmasın */ }
    try { window.dispatchEvent(new CustomEvent('dwg:view3d', { detail: { key, value } })); } catch (_) { /* geç */ }
  }
  /** seçeneği uygular, gerekirse ilgili tamponu yeniler, çizer ve bildirir */
  set(key, value) {
    const o = this.opts;
    if (key === 'zScale') { const f = +value; if (!(f > 0) || !isFinite(f)) return; this.zScale = f; this.render(); this._emit('zScale', f); return; }
    if (key === 'persp') { this.cam.persp = !!value; this._persist(); this.render(); this._emit('persp', this.cam.persp); return; }
    if (key === 'touch') { Object.assign(o.touch, value || {}); this._persist(); this._emit('touch', { ...o.touch }); return; }
    if (key.startsWith('touch.')) { const k = key.slice(6); if (!(k in o.touch)) return; if (k === 'sensitivity') o.touch[k] = clamp(+value || 1, 0.25, 4); else if (k === 'invertY') o.touch[k] = !!value; else { if (!TOUCH_ENUM[k] || !TOUCH_ENUM[k].includes(value)) return; o.touch[k] = value; } this._persist(); this._emit(key, o.touch[k]); return; }
    if (!(key in View3D.DEFAULTS)) return;
    if (ENUMS[key] && !ENUMS[key].includes(value)) return;
    if (key === 'gridStep') { value = value === 'auto' ? 'auto' : +value; if (value !== 'auto' && !(value > 0)) return; }
    else if (key === 'clip') { value = View3D.validClip(value); }
    else if (typeof View3D.DEFAULTS[key] === 'boolean') value = !!value;
    else if (typeof View3D.DEFAULTS[key] === 'number') { value = +value; if (!isFinite(value)) return; if (key === 'fov') value = clamp(value, 10, 120); if (key === 'pointSize') value = clamp(value, 1, 32); if (key === 'ambient') value = clamp(value, 0, 1); if (key === 'lightIntensity') value = clamp(value, 0, 2); if (key === 'turnSpeed') value = clamp(value, 1, 180); if (key === 'faceOpacity') value = clamp(value, 0.05, 1); if (key === 'silhouetteWidth') value = clamp(value, 1, 6); if (key === 'overhang') value = clamp(value, 0, 6); if (key === 'jitter') value = clamp(value, 0, 4); }
    const prev = o[key];
    o[key] = value;
    switch (key) {
      case 'grid': case 'gridStep': case 'gridZ': case 'gridZValue': if (this.bb) this.buildGrid(); break;
      case 'clip': case 'clipBox': this.buildClipBox(); break;
      case 'colorMode': this._renkKullanici = true; if (value === 'layer' || prev === 'layer') this.recolor(); break;   // elle seçim: 2B'nin kipi bunu ezmez
      case 'turntable': this.setTurntable(value, true); value = o.turntable; break;
      case 'overhang': case 'style': this._applyOverhang(); break;
      default: break;
    }
    if (!PERSIST_SKIP.has(key)) this._persist();
    this.render();
    this._emit(key, value);
  }
  static validClip(v) {
    if (!v || !Array.isArray(v) || v.length < 6) return null;
    const a = v.slice(0, 6).map(Number); if (a.some(x => !isFinite(x))) return null;
    for (let i = 0; i < 3; i++) if (a[i] > a[i + 3]) { const t = a[i]; a[i] = a[i + 3]; a[i + 3] = t; }
    return a;
  }

  // ---------------------------------------------------------------------------------
  // sahne
  // ---------------------------------------------------------------------------------
  /** ilkelleri tamponlara yükler; opts: { dark, mono, bg, fg, colorMode, fade:{pct, layers:Set}, selColor } */
  setScene(prims, layers, opts = {}) {
    this.sceneOpts = opts;
    const dark = opts.dark !== false;
    this.dark = dark;
    this.fg = parseColor(opts.fg) || (dark ? [0.95, 0.96, 0.97] : [0.07, 0.07, 0.07]);
    this.bgTheme = parseColor(opts.bg) || (dark ? [0.11, 0.13, 0.16] : [1, 1, 1]);
    this.selColor = parseColor(opts.selColor) || [1, 0.62, 0.04];
    this.monoFg = parseColor(opts.monoColor) || null;   // tek renk kipinin tonu (2B ile ortak); yoksa ön plan rengi
    /*
     * 2B'NİN RENK KİPİ 3B'NİN ÖNTANIMIDIR (v8.5). Eskiden 3B kendi kipini localStorage'da
     * saklıyor ve her dosyada geri yüklüyordu: bir kez 'katman' ya da 'kot' seçen kullanıcı
     * aylar sonra başka bir çizimi açtığında 2B'de gri olan nesneleri 3B'de yeşil buluyor,
     * nedenini de hiçbir yerde göremiyordu. Artık 2B'nin kipi öntanım olur; kullanıcı 3B
     * kipini AÇIKÇA seçmişse (bu oturumda ya da daha önce kaydedilmişse) o seçim korunur
     * ve etkin kip HUD'da yazar — böylece renk farkı hiçbir zaman açıklamasız kalmaz.
     */
    if (opts.colorMode && !this._renkKullanici && !this._renkKayitli && ENUMS.colorMode.includes(opts.colorMode)) this.opts.colorMode = opts.colorMode;
    if (opts.mono) { this.opts.colorMode = 'mono'; this._monoScene = true; }
    else if (this._monoScene && this.opts.colorMode === 'mono') { this.opts.colorMode = 'entity'; this._monoScene = false; }
    this.fadeSet = opts.fade && opts.fade.layers && opts.fade.pct > 0 ? opts.fade.layers : null;
    this.fadePct = opts.fade ? +opts.fade.pct || 0 : 0;
    // katman dizini ve renkleri
    const names = []; const idx = new Map();
    for (const [name, l] of layers) { idx.set(name, names.length); names.push([name, l]); }
    const lrgb = new Float32Array(Math.max(1, names.length + 1) * 3);
    /*
     * "KATMAN PALETİ" RENK KİPİ 2B İLE AYNI PALETİ KULLANIR (v8.6). 2B bu kipte katmanın DXF
     * rengini değil, ada göre üretilen altın-açı HSL paletini çizer (render.layerPalette):
     * amaç katmanları BİRBİRİNDEN AYIRMAKtır, dosyanın kendi renklerini göstermek değil.
     * 3B ise katmanın kendi rengini kullanıyordu; aynı kipte iki görünüş iki ayrı palet
     * veriyordu. Palet işlevi dışarıdan gelir (editor.refresh3D); gelmezse eski davranış sürer.
     */
    const katmanFn = typeof opts.katmanRenk === 'function' ? opts.katmanRenk : null;
    for (let i = 0; i < names.length; i++) {
      let rgb = katmanFn ? parseColor(katmanFn(names[i][0])) : null;
      if (!rgb) { const c = names[i][1].color; rgb = (c == null || c === FG) ? this.fg : parseColor(c) || this.fg; }
      lrgb[i * 3] = rgb[0]; lrgb[i * 3 + 1] = rgb[1]; lrgb[i * 3 + 2] = rgb[2];
    }
    lrgb[names.length * 3] = this.fg[0]; lrgb[names.length * 3 + 1] = this.fg[1]; lrgb[names.length * 3 + 2] = this.fg[2];
    this.layerNames = names.map(n => n[0]); this.layerIdx = idx; this.layerRGB = lrgb;
    const unk = names.length;

    // ön geçiş: kaba boyut tahmini (kapasite)
    const est = Math.min(1 << 18, Math.max(4096, prims.length * 8));
    const B = {};
    for (const n of ['lines', 'edges', 'medges', 'tris', 'pts', 'txt']) B[n] = { pos: new Grow(n === 'lines' ? est * 3 : 4096), rgb: new Grow(n === 'lines' ? est * 3 : 4096), lay: new Grow(n === 'lines' ? est : 1024), alp: new Grow(n === 'lines' ? est : 1024), nrm: n === 'tris' ? new Grow(4096) : null };
    // ağ ilkelleri (k=5) indeksli çizilir: köşeler paylaşılır, üçgen başına köşe kopyalanmaz
    let mv = 0, mi = 0;
    for (const p of prims) if (p.k === 5 && p.vtx) { mv += p.vtx.length; mi += p.idx.length; }
    const useIdx = this.u32 && mi > 0;
    const capV = Math.max(4096, Math.ceil(mv * 1.4));
    B.mesh = { pos: new Grow(capV), rgb: new Grow(capV), lay: new Grow(Math.max(1024, Math.ceil(capV / 3))), alp: new Grow(Math.max(1024, Math.ceil(capV / 3))), nrm: new Grow(capV) };
    const MIDX = new GrowU32(Math.max(1024, mi));
    let gAssign = new Uint16Array(64), cornerOut = new Uint32Array(1024);
    /*
     * Bir ağ ilkelini indeksli tampona ekler. Köşeler paylaşılır; komşu yüzler arasındaki açı kırışıklık
     * eşiğini aşarsa o köşe gruplara ayrılıp her grup için ayrı çıkış köşesi üretilir. Böylece düz yüzeyler
     * düz gölgelenmeye devam eder, kavisli yüzeyler yumuşar ve köşe sayısı üçgen sayısının üçte birine iner.
     */
    const addMesh = (p) => {
      const V = p.vtx, I = p.idx, nt = I.length / 3, nv = V.length / 3;
      if (!nt || !nv) return;
      const fnx = new Float32Array(nt), fny = new Float32Array(nt), fnz = new Float32Array(nt);
      for (let t = 0; t < nt; t++) {
        const a = I[t * 3] * 3, b2 = I[t * 3 + 1] * 3, d = I[t * 3 + 2] * 3;
        const ux = V[b2] - V[a], uy = V[b2 + 1] - V[a + 1], uz = V[b2 + 2] - V[a + 2];
        const vx = V[d] - V[a], vy = V[d + 1] - V[a + 1], vz = V[d + 2] - V[a + 2];
        fnx[t] = uy * vz - uz * vy; fny[t] = uz * vx - ux * vz; fnz[t] = ux * vy - uy * vx;   // boyu = 2 × alan
      }
      const cnt = new Uint32Array(nv + 1);
      for (let i = 0; i < I.length; i++) { const v = I[i]; if (v < nv) cnt[v + 1]++; }
      for (let i = 0; i < nv; i++) cnt[i + 1] += cnt[i];
      const adj = new Uint32Array(I.length), fill = cnt.slice(0, nv);
      for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; if (v < nv) adj[fill[v]++] = t * 3 + k; }
      if (cornerOut.length < I.length) cornerOut = new Uint32Array(I.length);
      const gr = [];
      for (let v = 0; v < nv; v++) {
        const s0 = cnt[v], e0 = cnt[v + 1]; if (s0 === e0) continue;
        if (gAssign.length < e0 - s0) gAssign = new Uint16Array(e0 - s0);
        gr.length = 0;
        for (let a = s0; a < e0; a++) {
          const t = (adj[a] / 3) | 0;
          const nx = fnx[t], ny = fny[t], nz = fnz[t];
          const L = Math.hypot(nx, ny, nz) || 1e-20, ux = nx / L, uy = ny / L, uz = nz / L;
          let gi = -1;
          for (let g = 0; g < gr.length; g++) {
            const G = gr[g], dd = ux * G.rx + uy * G.ry + uz * G.rz;
            if (Math.abs(dd) >= COS_CREASE) { const sg = dd < 0 ? -1 : 1; G.ax += sg * nx; G.ay += sg * ny; G.az += sg * nz; gi = g; break; }
          }
          if (gi < 0) { gr.push({ rx: ux, ry: uy, rz: uz, ax: nx, ay: ny, az: nz, out: 0 }); gi = gr.length - 1; }
          gAssign[a - s0] = gi;
        }
        const x = V[v * 3], y = V[v * 3 + 1], z = V[v * 3 + 2];
        for (const G of gr) {
          const L = Math.hypot(G.ax, G.ay, G.az) || 1;
          G.out = B.mesh.pos.n / 3;
          B.mesh.pos.push3(x, y, z); B.mesh.rgb.push3(c[0], c[1], c[2]); B.mesh.lay.push1(li); B.mesh.alp.push1(alp); B.mesh.nrm.push3(G.ax / L, G.ay / L, G.az / L);
          bbx(x, y, z);
        }
        for (let a = s0; a < e0; a++) cornerOut[adj[a]] = gr[gAssign[a - s0]].out;
      }
      for (let i = 0; i < I.length; i++) MIDX.push1(cornerOut[i]);
    };
    // yakalama köşeleri: xyz düz Float64 + ilkel dizisi (JS dizisi başına ~70 bayt yerine 32)
    let vxyz = new Float64Array(Math.max(3 * 1024, prims.length * 6)), vn = 0; const vprim = [];
    const vert = (x, y, z, p) => { if (vn + 3 > vxyz.length) { const b = new Float64Array(vxyz.length * 2); b.set(vxyz); vxyz = b; } vxyz[vn] = x; vxyz[vn + 1] = y; vxyz[vn + 2] = z; vn += 3; vprim.push(p); };
    let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const fg = this.fg;
    /*
     * NESNE RENGİ 2B İLE AYNI İŞLEVDEN GELİR (v8.6): tema kıstırmaları (koyu temanın parlaklık
     * tabanı, yüksek kontrastın tavanı) 2B'de render.entityCss içinde uygulanıyor, 3B ham tam
     * sayıyı çeviriyordu. Çözücü dışarıdan verilir; verilmezse eski ham çevrim sürer.
     */
    const renkFn = typeof opts.renk === 'function' ? opts.renk : null;
    const col = (p) => {
      if (renkFn) { let css = null; try { css = renkFn(p); } catch (_) { /* geç */ } const r = css ? parseColor(css) : null; if (r) return r; }
      const c = p.col;
      return c === FG || c == null ? fg : [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    };
    /*
     * Sınır kutusuna AYKIRI DEĞER TAVANI (scene.js'teki 1e15 ile aynı). Bozuk bir DWG'de tek bir
     * saçma koordinat kutuyu şişirir; 2B bu tavanı uyguladığı için etkilenmez, 3B uygulamadığı
     * için aynı çizimde kadrajı ve kot aralığını kaybediyordu.
     */
    const SANE = 1e15;
    const bbx = (x, y, z) => { if (!(Math.abs(x) <= SANE && Math.abs(y) <= SANE && Math.abs(z) <= SANE)) return; if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z; };
    let li = 0, c = fg, alp = 1;
    const push = (b, x, y, z) => { b.pos.push3(x, y, z); b.rgb.push3(c[0], c[1], c[2]); b.lay.push1(li); b.alp.push1(alp); bbx(x, y, z); };
    const tri = (a, b2, c2) => {
      const t = B.tris;
      // düz normal
      const ux = b2[0] - a[0], uy = b2[1] - a[1], uz = b2[2] - a[2], vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      push(t, a[0], a[1], a[2]); push(t, b2[0], b2[1], b2[2]); push(t, c2[0], c2[1], c2[2]);
      t.nrm.push3(nx, ny, nz); t.nrm.push3(nx, ny, nz); t.nrm.push3(nx, ny, nz);
    };
    this.meshPrims = [];
    this._meshMeta = []; this._wire = null; this._wireBasarisiz = false;   // tel kafes kenar kümesi (wedges) sahneyle birlikte düşer; ilkel önbellekleri kalır
    /*
     * Ağ ilkellerinin KENDİ kenar köşesi sayısı. Etkileşim sadeleştirmesi (bkz. render) ağ
     * yüzeylerini atlar; geriye o ağın tel kafesi kalmıyorsa model ekrandan tümden silinir.
     * Bu sayaç, sadeleştirmenin ancak geri düşülecek bir tel kafes varken açılmasını sağlar.
     */
    let meshEdgeN = 0;
    for (const p of prims) {
      if (p.inf || p.k === 4 || p.k === 3) continue;
      /*
       * DESENLİ TARAMANIN İKİ NÜSHASI VARDIR (scene.js): desen çizgileri (p.hp) ve uzaktan
       * bakışta onların yerine çizilen saydam dolgu (p.hpFill). 2B bunlardan birini EKRAN
       * ÖLÇEĞİNE göre seçer; 3B'de ölçek kameraya ve kota göre her pikselde değişir, tek bir
       * seçim yapılamaz. İkisi birden çizildiği için tarama iki kat koyu çıkıyor ve opak dolgu
       * desenin üstünü kapatıyordu — 2B'de boş görünen bir alan 3B'de gri bir kütleye dönüyordu.
       * 3B'de her zaman DESEN çizgileri kullanılır, dolgu nüshası atlanır.
       */
      if (p.hpFill != null) continue;
      const lay = layers.get(p.lay); if (lay && !lay.visible) continue;
      li = idx.has(p.lay) ? idx.get(p.lay) : unk;
      c = col(p);
      // Maske (WIPEOUT) nesnenin kendi rengiyle değil ARKA PLAN rengiyle basılır: işi örtmektir
      if (p.bg) c = this.bgTheme;
      // Saydamlık ilkelin kendi değeridir: %18'lik tarama dolgusu 3B'de de %18 kalır
      alp = (p.alpha == null || !isFinite(p.alpha)) ? 1 : Math.max(0, Math.min(1, p.alpha));
      if (p.k === 2) { push(B.pts, p.x, p.y, p.z || 0); vert(p.x, p.y, p.z || 0, p); continue; }
      if (p.k === 1) { push(B.txt, p.x, p.y, p.z || 0); continue; }
      if (p.k === 5) {                                        // ağ ilkeli
        const V = p.vtx, I = p.idx;
        // Kenar listesi boş gelen gövde tel kafeste hiç çizilmezdi: üçgenlerden kenar üretilir
        const S2 = (p.seg && p.seg.length) ? p.seg : this._telKafesKenar(p);
        if (V && I && I.length >= 3) this.meshPrims.push(p);   // yüzey seçimi kaynağı
        this._meshMeta.push({ p, r: c[0], g: c[1], b: c[2], li, alp });   // tel kafes kenar kümesi (_ensureWireEdges) buradan kurulur
        if (useIdx) addMesh(p);                               // paylaşılan köşe + indeks tamponu
        else for (let i = 0; i + 2 < I.length; i += 3) {       // 32 bit indeks yoksa: eski genişletilmiş yol
          const a = I[i] * 3, b2 = I[i + 1] * 3, c2 = I[i + 2] * 3;
          if (a + 2 >= V.length || b2 + 2 >= V.length || c2 + 2 >= V.length) continue;
          tri([V[a], V[a + 1], V[a + 2]], [V[b2], V[b2 + 1], V[b2 + 2]], [V[c2], V[c2 + 1], V[c2 + 2]]);
        }
        // ağ kenarları kendi tamponuna (medges): tel kafes stillerinde yerine yüz kenarları (wedges) çizilir
        for (let i = 0; i + 5 < S2.length; i += 6) { push(B.medges, S2[i], S2[i + 1], S2[i + 2]); push(B.medges, S2[i + 3], S2[i + 4], S2[i + 5]); meshEdgeN += 2; }
        if (!S2.length && !useIdx) for (let i = 0; i + 2 < V.length; i += 3) bbx(V[i], V[i + 1], V[i + 2]);
        // yakalama/seçim köşeleri: bütün köşeler listeye sığmaz (milyonlarca), gövde başına en çok
        // MESH_PICK_V tanesi eşit aralıkla örneklenir — 3B'de gövde seçilebilir kalsın diye
        {
          const nvp = V.length / 3;
          if (nvp) { const st = Math.max(1, Math.ceil(nvp / MESH_PICK_V)); for (let i = 0; i < nvp; i += st) vert(V[i * 3], V[i * 3 + 1], V[i * 3 + 2], p); }
        }
        continue;
      }
      const isFace = !!(p.face || (p.closed && FACE_ETS.has(p.et)) || p.fill);
      const LB = isFace ? B.edges : B.lines;
      let cur = null;
      if (p.tri) {                                  // katı model üçgeni: yalnız yüzey, kenar ve köşe eklenmez
        const q = p.ops; if (q.length >= 3) tri([q[0][1], q[0][2], q[0][3] || 0], [q[1][1], q[1][2], q[1][3] || 0], [q[2][1], q[2][2], q[2][3] || 0]);
        continue;
      }
      const seg = (a, b2) => { push(LB, a[0], a[1], a[2]); push(LB, b2[0], b2[1], b2[2]); };
      const flush = () => {
        if (cur && cur.length > 1) {
          for (let i = 1; i < cur.length; i++) seg(cur[i - 1], cur[i]);
          if (p.closed && cur.length > 2) seg(cur[cur.length - 1], cur[0]);
          if (isFace && cur.length >= 3) for (let i = 1; i < cur.length - 1; i++) tri(cur[0], cur[i], cur[i + 1]);
        }
        cur = null;
      };
      for (const o of p.ops) {
        if (o[0] === 0) { flush(); cur = [[o[1], o[2], o[3] || 0]]; vert(o[1], o[2], o[3] || 0, p); }
        else if (o[0] === 1) { if (!cur) cur = []; cur.push([o[1], o[2], o[3] || 0]); vert(o[1], o[2], o[3] || 0, p); }
        else if (o[0] === 2 || o[0] === -2) {
          const z = o[6] != null ? o[6] : (cur && cur.length ? cur[cur.length - 1][2] : 0);
          const q = []; if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], q); else { arcPts(o[1], o[2], o[3], o[5], o[4], q); q.reverse(); }
          if (!cur) cur = [];
          for (let i = 0; i < q.length; i++) cur.push([q[i][0], q[i][1], z]);
          vert(o[1], o[2], z, p); vert(q[q.length - 1][0], q[q.length - 1][1], z, p);
        } else { const z = cur && cur.length ? cur[cur.length - 1][2] : 0; const q = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], q); if (!cur) cur = []; for (const r of q) cur.push([r[0], r[1], z]); }
      }
      flush();
    }
    if (!isFinite(bb[0])) bb = [0, 0, 0, 1, 1, 1];
    const bbChanged = !this.bb || this.bb.some((v, i) => Math.abs(v - bb[i]) > 1e-9);
    this.bb = bb;
    this.center = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2];
    this.origin = this.center.slice();
    this.radius = Math.max(1e-6, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], (bb[5] - bb[2])) / 2);
    this.zrange = [bb[2], bb[5]];
    this.vertXYZ = vxyz.length === vn ? vxyz : vxyz.slice(0, vn); this.vertPrim = vprim; this._vertsView = null;
    // tamponlar: konumlar merkeze göre
    for (const n of ['lines', 'edges', 'medges', 'tris', 'pts', 'txt', 'mesh']) {
      const b = B[n], pos = b.pos.out(), o = this.origin;
      for (let i = 0; i < pos.length; i += 3) { pos[i] -= o[0]; pos[i + 1] -= o[1]; pos[i + 2] -= o[2]; }
      this.src[n] = { rgb: b.rgb.out(), lay: b.lay.out(), alp: b.alp.out(), alpha: n === 'txt' ? 0.6 : 1, pos, nrm: b.nrm ? b.nrm.out() : null, smooth: null };   // pos: bağlam kaybında yeniden yükleme
      this.uploadPos(n, pos); if (b.nrm) this.uploadNrm(n, this.src[n].nrm);
      this._n[n] = pos.length / 3;
    }
    const midx = MIDX.out();
    this.src.mesh.idx = midx;
    this.uploadIdx('mesh', midx);
    this._nIdx.mesh = midx.length;
    this._nMeshEdge = meshEdgeN;
    this._smoothReady = false;
    this._applyOverhang();
    this.recolor();
    this.counts.lines = this._n.lines + this._n.edges + this._n.medges; this.counts.tris = this._n.tris + this._nIdx.mesh; this.counts.pts = this._n.pts + this._n.txt;
    this.buildGrid(); this.buildAxes(); this.buildClipBox();
    if (bbChanged || !this._sceneOnce) { this._sceneOnce = true; this.fit({ animate: false }); }
    this.setSelection(this._lastSel || []);
  }
  /** yakalama köşeleri [x,y,z,prim] görünümü (uyumluluk; istenince kurulur, sahne değişince düşer) */
  get vertices() {
    if (!this._vertsView) { const a = this.vertXYZ, P = this.vertPrim, out = new Array(P.length); for (let i = 0; i < P.length; i++) out[i] = [a[i * 3], a[i * 3 + 1], a[i * 3 + 2], P[i]]; this._vertsView = out; }
    return this._vertsView;
  }
  /** renk tamponlarını geçerli renk moduna (nesne/katman) ve solgunluğa göre yeniden kurar */
  recolor() {
    const byLayer = this.opts.colorMode === 'layer', fade = this.fadeSet, fa = 1 - this.fadePct / 100, lr = this.layerRGB, names = this.layerNames;
    for (const n of ['lines', 'edges', 'medges', 'tris', 'pts', 'txt', 'mesh']) {
      const s = this.src[n]; if (!s) continue;
      const cnt = s.lay.length, out = new Float32Array(cnt * 4);
      for (let i = 0; i < cnt; i++) {
        const li = s.lay[i];
        if (byLayer) { out[i * 4] = lr[li * 3]; out[i * 4 + 1] = lr[li * 3 + 1]; out[i * 4 + 2] = lr[li * 3 + 2]; }
        else { out[i * 4] = s.rgb[i * 3]; out[i * 4 + 1] = s.rgb[i * 3 + 1]; out[i * 4 + 2] = s.rgb[i * 3 + 2]; }
        out[i * 4 + 3] = (s.alp && i < s.alp.length ? s.alp[i] : 1) * s.alpha * (fade && fade.has(names[li]) ? fa : 1);
      }
      this.uploadCol(n, out);
    }
    if (this._wire && this._wire.colU8) this._wireRenkle();
  }
  /**
   * Sahnede yüzey var mı? Üçgenler İKİ tampona dağılır: kapalı çokgenlerden üretilenler genişletilmiş
   * `tris` tamponunda, ağ ilkellerinden (k=5) gelenler indeksli `mesh` tamponunda. Yalnız birine bakan
   * bir kapı, bütün yüzeyleri ağ ilkelinden gelen bir modelde (ör. çok yüzlü ağlardan oluşan çelik model)
   * yanlışlıkla kapanır ve tek üçgen çizilmez.
   */
  _hasFaces() { return ((this._n.tris | 0) + (this._nIdx.mesh | 0)) > 0; }
  /*
   * KENAR LİSTESİ OLMAYAN GÖVDEYE TEL KAFES KENARI ÜRETİR (v8.7).
   *
   * Kullanıcının bildirimi: "Tel kafes görünümde çizimin tamamını göstermiyor." Ölçüldü: yüzeyi
   * (üçgeni) olan ama KENAR DİZİSİ (p.seg) boş bir gövde tel kafes ve 2B tel kafes stillerinde
   * SIFIR piksel çiziyor, gölgeli stilde tamamen görünüyordu. Sebep yapısal: tel kafes stillerinde
   * yüzeyler hiç çizilmez (STYLES.wireframe.faces === 'none'), çizilecek kenar da yoksa gövde
   * ekrandan yok olur. Okuyucu yollarının çoğu kenarı kendisi üretir (scene.meshEdges), ama kenarı
   * boş gelen ACIS katıları, kenar görünürlüğü tümden sıfır gelen proxy grafikleri ve köşe indeksi
   * eşleşmeyen ağlar bu listeyi boş bırakabiliyor.
   *
   * Kenarlar ÜÇGEN İNDEKSİNDEN kurulur ve scene.meshEdges ile AYNI kural uygulanır: yalnız SINIR
   * kenarları (tek komşusu olan) ve KIRIŞIKLIK kenarları (komşu yüz normalleri arasındaki açı
   * 20°'yi aşan) çizilir. Eş düzlemli üçgenleme çaprazları çizilmez; yazılsalardı bir kutu örümcek
   * ağına dönerdi. Sonuç ilkelde önbelleklenir: sahne her kurulduğunda (katman açıp kapatmada da)
   * yeniden hesaplanmaz.
   */
  _telKafesKenar(p) {
    if (p._telSeg) return p._telSeg;
    p._telSeg = this._kenarUret(p, COS_WIRE);
    return p._telSeg;
  }
  /** Tel kafes stilleri için yüz kenarları: eş düzlemli olmayan HER kenar (COS_FACET) + sınır kenarları */
  _telKafesSik(p) {
    if (p._telSegSik) return p._telSegSik;
    p._telSegSik = this._kenarUret(p, COS_FACET);
    return p._telSegSik;
  }
  /** Üçgen indeksinden kenar dizisi: sınır kenarları + komşu yüz açısı cosT eşiğini aşan kenarlar */
  _kenarUret(p, cosT) {
    const V = p.vtx; let I = p.idx;
    if (!V || !I || I.length < 3) return BOS_F32;
    const nt = (I.length / 3) | 0, nv = (V.length / 3) | 0;
    if (nv < 3 || nt > MESH_WIRE_MAX_TRI) return BOS_F32;
    /*
     * Üçgen ÇORBASI (ACIS katıları: her üçgen kendi üç köşesiyle gelir, köşe paylaşılmaz) kaynaştırılır:
     * kaynaştırılmazsa her kenar "tek komşulu sınır" sayılır ve bütün üçgenleme çizilir. Kaynaştırma
     * aynı konumdaki köşeleri tek indekse toplar; indeksli ağlarda (nv ≈ nt/2) gerek yoktur, atlanır.
     */
    if (nv > nt * 1.5) {
      const yer = new Map(), yeni = new Uint32Array(nv);
      for (let v = 0; v < nv; v++) { const k = V[v * 3] + ',' + V[v * 3 + 1] + ',' + V[v * 3 + 2]; let j = yer.get(k); if (j === undefined) { j = v; yer.set(k, v); } yeni[v] = j; }
      const I2 = new Uint32Array(I.length);
      for (let i = 0; i < I.length; i++) I2[i] = I[i] < nv ? yeni[I[i]] : I[i];
      I = I2;
    }
    // üçgen normalleri (birim); dejenere üçgen sıfır normal alır ve kırışıklık kararına girmez
    const NX = new Float32Array(nt), NY = new Float32Array(nt), NZ = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      if (a + 2 >= V.length || b + 2 >= V.length || c + 2 >= V.length) continue;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
      const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      const L = Math.hypot(x, y, z);
      if (L > 0) { NX[t] = x / L; NY[t] = y / L; NZ[t] = z / L; }
    }
    // kenar tablosu: anahtar → yuva; yuva verileri yazılı dizilerde (kenar başına nesne bellek yer)
    const cap = nt * 3;
    const EA = new Uint32Array(cap), EB = new Uint32Array(cap);
    const EN = new Float32Array(cap * 3), ECNT = new Uint16Array(cap), ECRE = new Uint8Array(cap);
    const yuva = new Map();
    let n = 0;
    const ekle = (u, v, t) => {
      if (u === v) return;
      const lo = u < v ? u : v, hi = u < v ? v : u;
      const k = lo * nv + hi;
      let j = yuva.get(k);
      if (j === undefined) { j = n++; yuva.set(k, j); EA[j] = lo; EB[j] = hi; EN[j * 3] = NX[t]; EN[j * 3 + 1] = NY[t]; EN[j * 3 + 2] = NZ[t]; ECNT[j] = 1; return; }
      if (ECNT[j] < 0xffff) ECNT[j]++;
      // sarım yönü ters olabilir: mutlak değere bakılır (scene.meshEdges ile aynı kural)
      if (!ECRE[j] && Math.abs(EN[j * 3] * NX[t] + EN[j * 3 + 1] * NY[t] + EN[j * 3 + 2] * NZ[t]) < cosT) ECRE[j] = 1;
    };
    for (let t = 0; t < nt; t++) {
      const A = I[t * 3], B = I[t * 3 + 1], C = I[t * 3 + 2];
      if (A >= nv || B >= nv || C >= nv) continue;
      ekle(A, B, t); ekle(B, C, t); ekle(C, A, t);
    }
    let m = 0;
    for (let j = 0; j < n; j++) if (ECNT[j] === 1 || ECRE[j]) m++;
    const out = new Float32Array(m * 6);
    let q = 0;
    for (let j = 0; j < n; j++) {
      if (!(ECNT[j] === 1 || ECRE[j])) continue;
      const a = EA[j] * 3, b = EB[j] * 3;
      out[q] = V[a]; out[q + 1] = V[a + 1]; out[q + 2] = V[a + 2];
      out[q + 3] = V[b]; out[q + 4] = V[b + 1]; out[q + 5] = V[b + 2];
      q += 6;
    }
    return out;
  }
  /*
   * TEL KAFES KENAR KÜMESİ (wedges): her ağ ilkelinin yüz kenarları (_telKafesSik) tek konum
   * tamponunda toplanır. Köşe başına renk tamponu YOKTUR — aynı renk/katman/saydamlıktaki gövdeler
   * gruplanır ve grup rengi çizimde sabit köşe özniteliğiyle verilir (_drawWire). Böylece 3,4 milyon
   * üçgenli bir köprü modelinde kenar başına 24 bayt yeter; köşe başına renk 4 katına çıkarırdı.
   * Kümenin toplamı WIRE_MAX_FLOATS'u aşarsa kalan gövdeler 20°'lik kümesiyle (seg) yazılır.
   * İlkel başına sonuç önbelleklidir (p._telSegSik); sahne yeniden kurulunca yalnız birleştirme yapılır.
   */
  _ensureWireEdges() {
    if (this._wire || this._wireBasarisiz) return;
    const meta = this._meshMeta || [], o = this.origin || [0, 0, 0];
    const grup = new Map(); let toplam = 0, kirpildi = false;
    for (const m of meta) {
      const p = m.p;
      /*
       * Kaynak sırası: (1) okuyucunun yüz poligonlarından ÇALIŞANDA ürettiği segSik (görünmezlik bayrağı
       * ilkesi uygulanmış, burulmuş dörtgenlerin köşegeni yok, ana iş parçacığına yük yok); (2) yüz
       * poligonu olmayan ağlarda (ACIS üçgenleri, blok/pano ağları) üçgen indeksinden _telKafesSik;
       * (3) boş kalırsa ya da tampon sınırı aşılırsa gölgeli stillerin kümesi (medges ile aynı kaynak):
       * okuyucunun seg'i, o da boşsa 20°'lik üretim — gövde tel kafesten hiçbir koşulda tümden silinmez.
       */
      let S = (p.segSik && p.segSik.length) ? p.segSik : ((p.idx && p.idx.length >= 3) ? this._telKafesSik(p) : BOS_F32);
      if (!S.length || toplam + S.length > WIRE_MAX_FLOATS) {
        if (S.length) kirpildi = true;
        S = (p.seg && p.seg.length) ? p.seg : this._telKafesKenar(p);
      }
      if (!S.length) continue;
      const k = m.r + ',' + m.g + ',' + m.b + ',' + m.li + ',' + m.alp;
      let g = grup.get(k); if (!g) { g = { r: m.r, g: m.g, b: m.b, li: m.li, alp: m.alp, parca: [], n: 0 }; grup.set(k, g); }
      g.parca.push(S); g.n += S.length; toplam += S.length;
    }
    let pos;
    try { pos = new Float32Array(toplam); }
    catch (_) {   // birleştirme tamponu ayrılamadı (bellek): bu sahnede tel kafes 20°'lik kümeyle (medges) çizilir
      this._wireBasarisiz = true; this._wire = null;
      console.warn('3B tel kafes: yüz kenarı tamponu ayrılamadı, kırışıklık kenarlarıyla çizilecek');
      return;
    }
    const gruplar = [];
    let q = 0;
    for (const g of grup.values()) {
      const start = q / 3;
      for (const S of g.parca) for (let i = 0; i + 2 < S.length; i += 3) { pos[q] = S[i] - o[0]; pos[q + 1] = S[i + 1] - o[1]; pos[q + 2] = S[i + 2] - o[2]; q += 3; }
      gruplar.push({ start, count: q / 3 - start, r: g.r, g: g.g, b: g.b, li: g.li, alp: g.alp });
    }
    this._wire = { pos, gruplar, n: toplam / 3, kirpildi, colU8: null };
    if (toplam) this.uploadPos('wedges', pos);
    // Renk çeşitliliği yüksek modelde (her gövde ayrı true-color) grup sayısı gövde sayısına yaklaşır ve
    // kare başına o kadar çizim çağrısı olurdu; o zaman köşe başına 4 baytlık renk tamponuna geçilir.
    if (gruplar.length > WIRE_GRUP_MAX) this._wireRenkle();
    if (kirpildi) console.warn('3B tel kafes: yüz kenarı kümesi sınırı aştı, bazı gövdeler kırışıklık kenarlarıyla çizildi');
  }
  /** Çok gruplu wedges için köşe başına renk tamponu (Uint8, normalize): renk kipi / solgunluk değişince yeniden kurulur */
  _wireRenkle() {
    const w = this._wire; if (!w || !w.n) return;
    const byLayer = this.opts.colorMode === 'layer', fade = this.fadeSet, fa = 1 - this.fadePct / 100, lr = this.layerRGB, names = this.layerNames;
    const col = new Uint8Array(w.n * 4);
    const b = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
    for (const g of w.gruplar) {
      const a = g.alp * (fade && names && fade.has(names[g.li]) ? fa : 1);
      const r = byLayer && lr ? lr[g.li * 3] : g.r, gg = byLayer && lr ? lr[g.li * 3 + 1] : g.g, bb = byLayer && lr ? lr[g.li * 3 + 2] : g.b;
      const R = b(r), G = b(gg), B = b(bb), A = b(a);
      for (let v = g.start, e = g.start + g.count; v < e; v++) { const i = v * 4; col[i] = R; col[i + 1] = G; col[i + 2] = B; col[i + 3] = A; }
    }
    w.colU8 = col;
    this.uploadCol('wedges', col);
  }
  /** wedges tamponunu çizer: az grupta grup başına sabit renk özniteliği, çok grupta tek çağrı + Uint8 renk tamponu */
  _drawWire(alpha) {
    const w = this._wire; if (!w || !w.n) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs['wedges:pos']);
    gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    if (this.aNrm >= 0) { gl.disableVertexAttribArray(this.aNrm); gl.vertexAttrib3f(this.aNrm, 0, 0, 1); }
    gl.uniform1f(this.u.uAlpha, alpha);
    if (w.colU8) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs['wedges:col']);
      gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.drawArrays(gl.LINES, 0, w.n);
      return;
    }
    const byLayer = this.opts.colorMode === 'layer', fade = this.fadeSet, fa = 1 - this.fadePct / 100, lr = this.layerRGB, names = this.layerNames;
    gl.disableVertexAttribArray(this.aCol);
    for (const g of w.gruplar) {
      const a = g.alp * (fade && names && fade.has(names[g.li]) ? fa : 1);
      if (byLayer && lr) gl.vertexAttrib4f(this.aCol, lr[g.li * 3], lr[g.li * 3 + 1], lr[g.li * 3 + 2], a);
      else gl.vertexAttrib4f(this.aCol, g.r, g.g, g.b, a);
      gl.drawArrays(gl.LINES, g.start, g.count);
    }
  }
  /** etkin stil bayrakları (stil ön ayarı + kullanıcı geçersiz kılmaları) */
  _styleFx() {
    const o = this.opts, st = View3D.STYLES[o.style] || View3D.STYLES.wireframe;
    return {
      faces: this._hasFaces() ? st.faces : (st.faces === 'xray' ? 'xray' : 'none'), edges: o.edges === 'none' ? false : o.edges === 'facet' ? true : st.edges !== false, depth: st.depth !== false,
      shade: st.shade || 0, gray: st.gray || 0, quality: o.lightQuality === 'smooth' || st.quality === 'smooth' ? 'smooth' : 'faceted',
      specular: o.specular || !!st.specular, silhouette: o.silhouette || !!st.silhouette, jitter: Math.max(o.jitter, st.jitter || 0), overhang: Math.max(o.overhang, st.overhang || 0), shadow: o.shadow,
    };
  }
  /** kenar uzatma (overhang): kenar çizgileri iki uçtan da uzatılarak yeniden yüklenir */
  _applyOverhang() {
    const k = this._styleFx().overhang;
    for (const ad of ['edges', 'medges']) {
      const s = this.src[ad]; if (!s || !s.pos) continue;
      if (!k) { this.uploadPos(ad, s.pos); continue; }
      const e = this.radius * 0.004 * k, src = s.pos, out = new Float32Array(src.length);
      for (let i = 0; i + 5 < src.length; i += 6) {
        const dx = src[i + 3] - src[i], dy = src[i + 4] - src[i + 1], dz = src[i + 5] - src[i + 2], L = Math.hypot(dx, dy, dz) || 1, ex = dx / L * e, ey = dy / L * e, ez = dz / L * e;
        out[i] = src[i] - ex; out[i + 1] = src[i + 1] - ey; out[i + 2] = src[i + 2] - ez; out[i + 3] = src[i + 3] + ex; out[i + 4] = src[i + 4] + ey; out[i + 5] = src[i + 5] + ez;
      }
      this.uploadPos(ad, out);
    }
  }
  /**
   * Yumuşak normaller (gerçekçi stil / yumuşak aydınlatma): aynı konumu paylaşan üçgen normallerinin ortalaması,
   * ama yalnız kırışıklık açısından (30°) küçük açı yapan komşular ortalanır — kutu köşelerinde dik yüzler
   * birbirine karışmaz, düz yüzeyler düz kalır, silindir gibi kavisli yüzeyler yumuşar. Yön tutarsızlığı
   * (ters sarım) için işaret hizalanır.
   */
  _ensureSmooth() {
    const s = this.src.tris; if (!s || !s.pos || !s.nrm || this._smoothReady) return;
    const pos = s.pos, nrm = s.nrm, n = pos.length / 3, groups = new Map(), keys = new Array(n);
    const eps = Math.max(1e-9, this.radius * 1e-6), cosT = Math.cos(30 * Math.PI / 180);
    for (let i = 0; i < n; i++) { const k = Math.round(pos[i * 3] / eps) + ',' + Math.round(pos[i * 3 + 1] / eps) + ',' + Math.round(pos[i * 3 + 2] / eps); keys[i] = k; let g = groups.get(k); if (!g) { g = []; groups.set(k, g); } g.push(i); }
    // üçgen alanları: kıymık (çok ince) üçgenlerin normali koordinat gürültüsüyle eğrilir; ortalama alanla ağırlıklanır ve
    // başvuru yönü köşedeki EN BÜYÜK yüzün normalidir — kıymık, büyük komşusunun yönünü alır
    const area = new Float32Array(n / 3);
    for (let t = 0; t < n / 3; t++) { const a = t * 9; const ux = pos[a + 3] - pos[a], uy = pos[a + 4] - pos[a + 1], uz = pos[a + 5] - pos[a + 2], vx = pos[a + 6] - pos[a], vy = pos[a + 7] - pos[a + 1], vz = pos[a + 8] - pos[a + 2]; area[t] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const g = groups.get(keys[i]);
      let big = i, bigA = area[(i / 3) | 0];
      for (const j of g) { const aj = area[(j / 3) | 0]; if (aj > bigA) { bigA = aj; big = j; } }
      let rx = nrm[big * 3], ry = nrm[big * 3 + 1], rz = nrm[big * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      const own = area[(i / 3) | 0];
      if (own > bigA * 0.02 && Math.abs(nx * rx + ny * ry + nz * rz) < cosT) { rx = nx; ry = ny; rz = nz; }   // gerçek başka yüzey: kendi yönü başvuru
      let ax = 0, ay = 0, az = 0;
      for (const j of g) {
        const mx = nrm[j * 3], my = nrm[j * 3 + 1], mz = nrm[j * 3 + 2];
        const d = rx * mx + ry * my + rz * mz;
        if (Math.abs(d) < cosT) continue;                 // kırışıklık: farklı yüzey, ortalamaya girmez
        const w = area[(j / 3) | 0] || 1e-12, sg = d < 0 ? -1 : 1;   // ters sarımlı komşu: işareti hizala
        ax += sg * w * mx; ay += sg * w * my; az += sg * w * mz;
      }
      if ((nx * ax + ny * ay + nz * az) < 0) { ax = -ax; ay = -ay; az = -az; }   // sonuç kendi yönüyle aynı yarı uzayda
      const L = Math.hypot(ax, ay, az);
      if (L > 1e-12) { out[i * 3] = ax / L; out[i * 3 + 1] = ay / L; out[i * 3 + 2] = az / L; }
      else { out[i * 3] = nx; out[i * 3 + 1] = ny; out[i * 3 + 2] = nz; }
    }
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this._buf('tris', 'nrm2')); gl.bufferData(gl.ARRAY_BUFFER, out, gl.STATIC_DRAW);
    this._smoothReady = true;
  }
  _buf(name, kind) { const k = name + ':' + kind; if (!this.bufs[k]) this.bufs[k] = this.gl.createBuffer(); return this.bufs[k]; }
  uploadPos(name, arr) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this._buf(name, 'pos')); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  uploadCol(name, arr) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this._buf(name, 'col')); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  uploadIdx(name, arr) { const gl = this.gl; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._buf(name, 'idx')); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  uploadNrm(name, arr) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this._buf(name, 'nrm')); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); }
  /** düz [x,y,z,r,g,b,a,…] dizisini (merkeze göre) yükler — ızgara, eksen, seçim, kesit kutusu */
  upload(name, arr, relative = false) {
    const n = arr.length / 7, pos = new Float32Array(n * 3), colr = new Float32Array(n * 4), o = this.origin;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = arr[i * 7] - (relative ? 0 : o[0]); pos[i * 3 + 1] = arr[i * 7 + 1] - (relative ? 0 : o[1]); pos[i * 3 + 2] = arr[i * 7 + 2] - (relative ? 0 : o[2]);
      colr[i * 4] = arr[i * 7 + 3]; colr[i * 4 + 1] = arr[i * 7 + 4]; colr[i * 4 + 2] = arr[i * 7 + 5]; colr[i * 4 + 3] = arr[i * 7 + 6];
    }
    this.uploadPos(name, pos); this.uploadCol(name, colr);
    this._n[name] = n;
    if (name in this.counts) this.counts[name] = n;
  }
  _uploadBgQuad() { this.upload('bgq', [-1, -1, 0, 0, 0, 0, 1, 1, -1, 0, 0, 0, 0, 1, -1, 1, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1], true); }

  /** zemin ızgarası: adım ve kot seçeneklerine göre ayrı tampon */
  buildGrid() {
    const bb = this.bb; if (!bb) return;
    const G = [];
    const w = bb[3] - bb[0], h = bb[4] - bb[1], ext = Math.max(w, h, 1e-9);
    let step = this.opts.gridStep === 'auto' ? niceStep(ext / 10) : +this.opts.gridStep;
    if (!(step > 0)) step = niceStep(ext / 10);
    // eksen başına en çok 200 çizgi
    if (ext / step > 200) step *= Math.pow(2, Math.ceil(Math.log2(ext / step / 200)));
    const x0 = Math.floor(bb[0] / step) * step, x1 = Math.ceil(bb[3] / step) * step, y0 = Math.floor(bb[1] / step) * step, y1 = Math.ceil(bb[4] / step) * step;
    const z = this.opts.gridZ === 'zero' ? 0 : this.opts.gridZ === 'custom' ? (+this.opts.gridZValue || 0) : bb[2];
    const gc = this.dark ? [0.25, 0.3, 0.36] : [0.8, 0.83, 0.87];
    const mc = this.dark ? [0.36, 0.42, 0.5] : [0.68, 0.72, 0.78];
    let k = 0;
    for (let x = x0; x <= x1 + step * 1e-6; x += step, k++) { const cc = k % 5 === 0 ? mc : gc; G.push(x, y0, z, cc[0], cc[1], cc[2], 1, x, y1, z, cc[0], cc[1], cc[2], 1); }
    k = 0;
    for (let y = y0; y <= y1 + step * 1e-6; y += step, k++) { const cc = k % 5 === 0 ? mc : gc; G.push(x0, y, z, cc[0], cc[1], cc[2], 1, x1, y, z, cc[0], cc[1], cc[2], 1); }
    this.gridStep = step; this.gridZ = z;
    this.upload('grid', G);
  }
  /** X (kırmızı) Y (yeşil) Z (mavi) eksenleri, bb köşesinde */
  buildAxes() {
    const bb = this.bb; if (!bb) return;
    const a = Math.max(bb[3] - bb[0], bb[4] - bb[1]) * 0.15 || 1, z = bb[2];
    this.axisLen = a;
    this.upload('axes', [
      bb[0], bb[1], z, 1, 0.27, 0.23, 1, bb[0] + a, bb[1], z, 1, 0.27, 0.23, 1,
      bb[0], bb[1], z, 0.19, 0.86, 0.35, 1, bb[0], bb[1] + a, z, 0.19, 0.86, 0.35, 1,
      bb[0], bb[1], z, 0.26, 0.52, 0.96, 1, bb[0], bb[1], z + a, 0.26, 0.52, 0.96, 1]);
  }
  /** kesit kutusu (12 kenar, vurgu rengi) */
  buildClipBox() {
    const c = this.opts.clip;
    if (!c || !this.opts.clipBox) { this._n.clipBox = 0; return; }
    const s = this.selColor, A = [];
    const P = [[c[0], c[1], c[2]], [c[3], c[1], c[2]], [c[3], c[4], c[2]], [c[0], c[4], c[2]], [c[0], c[1], c[5]], [c[3], c[1], c[5]], [c[3], c[4], c[5]], [c[0], c[4], c[5]]];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [i, j] of E) A.push(P[i][0], P[i][1], P[i][2], s[0], s[1], s[2], 1, P[j][0], P[j][1], P[j][2], s[0], s[1], s[2], 1);
    this.upload('clipBox', A);
  }
  /** seçili ilkellerin vurgusu (renk: setScene opts.selColor) */
  setSelection(prims) {
    this._lastSel = prims;
    const S = [], s = this.selColor; let n = 0;
    const segp = (a, b) => { S.push(a[0], a[1], a[2], s[0], s[1], s[2], 1, b[0], b[1], b[2], s[0], s[1], s[2], 1); };
    for (const p of prims) {
      n++;
      if (p.k === 5) {                                    // ağ ilkeli: kenar dizisi doğrudan vurgulanır
        const S2 = p.seg;
        for (let i = 0; i + 5 < S2.length; i += 6) segp([S2[i], S2[i + 1], S2[i + 2]], [S2[i + 3], S2[i + 4], S2[i + 5]]);
        continue;
      }
      if (p.k !== 0) { if (p.x != null) segp([p.x, p.y, p.z || 0], [p.x, p.y, (p.z || 0) + this.radius * 0.02]); continue; }
      let cur = null;
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) { const q = [o[1], o[2], o[3] || 0]; if (cur && o[0] === 1) segp(cur, q); cur = q; }
        else if (o[0] === 2 || o[0] === -2) { const z = o[6] || 0; const q = []; if (o[0] === 2) arcPts(o[1], o[2], o[3], o[4], o[5], q); else { arcPts(o[1], o[2], o[3], o[5], o[4], q); q.reverse(); } for (let i = 1; i < q.length; i++) segp([q[i - 1][0], q[i - 1][1], z], [q[i][0], q[i][1], z]); cur = [q[q.length - 1][0], q[q.length - 1][1], z]; }
        else { const z = cur ? cur[2] : 0; const q = []; ellipsePts(o[1], o[2], o[3], o[4], o[5], o[6], o[7], q); for (let i = 1; i < q.length; i++) segp([q[i - 1][0], q[i - 1][1], z], [q[i][0], q[i][1], z]); if (q.length) cur = [q[q.length - 1][0], q[q.length - 1][1], z]; }
      }
    }
    this._selCount = n;
    this.upload('sel', S);
  }

  // ---------------------------------------------------------------------------------
  // kamera
  // ---------------------------------------------------------------------------------
  _fovK() { return Math.tan(26 * Math.PI / 180) / Math.tan(clamp(this.opts.fov, 10, 120) * Math.PI / 360); }
  /** sığdırma çarpanı: izdüşüm yüksekliğe göre kurulduğundan dikey (dar) tuvalde genişliğe de sığması için uzaklık büyütülür */
  _fitK() { const asp = this.cv.width / Math.max(1, this.cv.height); return this._fovK() * (asp > 0 && asp < 1 ? 1 / asp : 1); }
  /*
   * GÖRÜNÜŞE GÖRE KADRAJ (v8.4).
   *
   * Eski sığdırma modelin BİÇİMİNİ ve BAKIŞ DOĞRULTUSUNU hiç okumuyordu: uzaklığı yalnız sınır
   * KÜRESİNİN yarıçapından kuruyor (hypot(dx,dy,dz)/2), dar tuvalde de 1/en-boy ile büyütüyordu.
   * Bu iki kuralın birleşik sonucu kapalı biçimde yazılabilir: görünen dünya penceresi her zaman
   * kısa ekran kenarında 2,146·R, uzun kenarında 2,146·R/oran olur. Model hiçbir eksende 2R'yi
   * geçemediğinden UZUN EKSENİN en az %58'i tanımı gereği boş kalıyordu — bir dere güzergâhı gibi
   * uzun ve ince bir paftada model ekranın ortasında ince bir şerit hâlinde duruyor, kullanıcı
   * elle on kat yakınlaşmak zorunda kalıyordu. Üstten bakışta ayrıca GÖRÜNMEYEN kot farkı da
   * küreye girdiği için kadrajı ayrıca büyütüyordu.
   *
   * Yenisi kutunun sekiz köşesini kameranın SAĞ ve YUKARI eksenlerine izdüşürür, iki ekseni ayrı
   * kısıtlar (yatayda en-boy oranına böler) ve uzaklığı bağlayıcı eksenden kurar. Üstten bakışta
   * kot ekran katkısı sıfıra indiği için plan, 2B'deki "Sığdır" ile aynı kadrajı verir.
   */
  _kadraj(bb) {
    const b = bb || this.bb;
    const zs = this.zScale, c = this.cam;
    const varsayilan = { target: this.center.slice(), dist: Math.max(1e-6, this.radius * 2.2 * this._fitK()) };
    if (!b || !isFinite(b[0])) return varsayilan;
    const merkez = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    // lookAt ile aynı taban: sağ = up x z, yukarı = z x sağ  (z = gözden hedefe ters yön)
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const rx = -sy, ry = cy;                       // sağ ekseni (z bileşeni sıfır)
    const ux = -sp * cy, uy = -sp * sy, uz = cp;   // yukarı ekseni
    let hx = 0, hy = 0;
    const mz = merkez[2] * zs;
    for (let i = 0; i < 8; i++) {
      const dx = (i & 1 ? b[3] : b[0]) - merkez[0], dy = (i & 2 ? b[4] : b[1]) - merkez[1], dz = (i & 4 ? b[5] : b[2]) * zs - mz;
      hx = Math.max(hx, Math.abs(dx * rx + dy * ry));
      hy = Math.max(hy, Math.abs(dx * ux + dy * uy + dz * uz));
    }
    const asp = this.cv.width / Math.max(1, this.cv.height);
    const yari = Math.max(hy, asp > 0 ? hx / asp : hx) * 1.07;
    const hh = Math.max(yari, this.radius * 1e-5);
    const dist = hh / Math.tan(clamp(this.opts.fov, 10, 120) * Math.PI / 360);
    return { target: merkez, dist: isFinite(dist) && dist > 0 ? dist : varsayilan.dist };
  }
  /** geçerli bakış ve tuval oranı için sığdırma uzaklığı (yeniden boyutlandırmada taşıma çarpanı) */
  _kadrajUzakligi() { const k = this._kadraj(null); return k && k.dist > 0 && isFinite(k.dist) ? k.dist : this.radius * 2.2; }
  /** sahneyi sığdırır (hedef = merkez, uzaklık bakış doğrultusuna göre) */
  fit({ animate = true } = {}) {
    this.pushHistory();
    this._goto(this._kadraj(null), animate);
    this.pushHistory();
  }
  /** seçime sığdırır; seçim boşsa false */
  fitSelection(prims, { animate = true } = {}) {
    let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const add = (x, y, z) => { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (z < bb[2]) bb[2] = z; if (x > bb[3]) bb[3] = x; if (y > bb[4]) bb[4] = y; if (z > bb[5]) bb[5] = z; };
    for (const p of prims || []) {
      if (!p) continue;
      if (p.k === 1 || p.k === 2) { if (p.x != null) add(p.x, p.y, p.z || 0); continue; }
      if (p.k === 5) { if (p.bb) { add(p.bb[0], p.bb[1], p.zmin != null ? p.zmin : 0); add(p.bb[2], p.bb[3], p.zmax != null ? p.zmax : 0); } continue; }
      if (p.k !== 0 || !p.ops) continue;
      let z = 0;
      for (const o of p.ops) {
        if (o[0] === 0 || o[0] === 1) { z = o[3] || 0; add(o[1], o[2], z); }
        else if (o[0] === 2 || o[0] === -2) { z = o[6] != null ? o[6] : z; add(o[1] - o[3], o[2] - o[3], z); add(o[1] + o[3], o[2] + o[3], z); }
        else { const r = Math.max(o[3], o[4]); add(o[1] - r, o[2] - r, z); add(o[1] + r, o[2] + r, z); }
      }
    }
    if (!isFinite(bb[0])) return false;
    /*
     * Seçime yakınlaşma da aynı yön duyarlı hesabı kullanır (bkz. _kadraj). Kutu, this.bb ile
     * AYNI düzendedir: [minX, minY, minZ, maxX, maxY, maxZ]. Tek noktalı ya da çok ince bir
     * seçimde kutu merkezinden en az yarıçapın %2'sine genişletilir, yoksa uzaklık sıfıra iner.
     */
    const enk = this.radius * 0.02;
    const gen = (a, b2) => { const o = (a + b2) / 2, h = Math.max((b2 - a) / 2, enk / 2); return [o - h, o + h]; };
    const [x0, x1] = gen(bb[0], bb[3]), [y0, y1] = gen(bb[1], bb[4]);
    this.pushHistory();
    this._goto(this._kadraj([x0, y0, bb[2], x1, y1, bb[5]]), animate);
    this.pushHistory();
    return true;
  }
  /*
   * ÖN AYAR GÖRÜNÜŞ, KADRAJI DA KURAR (v8.5).
   *
   * preset() eskiden yalnız AÇIYI yazıyordu; uzaklık ve hedef kullanıcının bıraktığı yerde
   * kalıyordu. v8.4'te sığdırma bakış doğrultusuna bağlandığı için bu artık tutarsız: "Üst"e
   * basan kullanıcı, izometrik bakış için hesaplanmış bir uzaklıkla plana geçiyor ve model
   * ekranın ortasında küçük kalıyordu. AutoCAD'in ViewCube yüzü de öntanımlı olarak sığdırır.
   * Dik görünüşlerde (üst/alt/ön/arka/sol/sağ) kadraj yeniden kurulur; İZOMETRİK geçişlerde
   * kurulmaz, çünkü izometrik çoğu zaman bir ayrıntıyı döndürerek incelemek için seçilir ve
   * oradaki yakınlaşma kullanıcının kararıdır. Çağıran `{ fit: false }` ile her zaman kapatabilir.
   */
  preset(name, { animate = true, fit } = {}) {
    const a = PRESET_ANGLES[name] || PRESET_ANGLES.iso;
    const dik = name === 'top' || name === 'bottom' || name === 'front' || name === 'back' || name === 'left' || name === 'right';
    const kadrajla = fit == null ? dik : !!fit;
    this.pushHistory();
    /*
     * PLAN GÖRÜNÜŞÜ SONSUZ YÜKSEKLİKTENDİR (v8.3). Paralel izdüşümde göz yüksekliğinin
     * görüntüye hiçbir etkisi yoktur: bakış sonsuzdan gelir, model ne kadar yüksek olursa
     * olsun tepeden görünür, düşey kenarlar nokta olur ve ölçü her yerde aynı ölçekte kalır —
     * harita planının tanımı budur. Perspektifte bu mümkün değildir: göz sonlu bir yükseklikte
     * durur, yüksek yapılar dışa yatar ve kullanıcı yakınlaşmışsa göz modelin İÇİNDE kalır.
     * Bu yüzden üst/alt görünüşe geçerken izdüşüm paralele alınır; durum çubuğunda yazar ve
     * kullanıcı isterse perspektifi yeniden açar.
     */
    if ((name === 'top' || name === 'bottom') && this.cam.persp) {
      this.cam.persp = false; this._persist();
      this._emit('persp', false); this._emit('planOrtho', name);
    }
    /*
     * Açı ile kadraj TEK _goto içinde verilir: iki ayrı çağrı 250 ms'lik canlandırmayı ortasından
     * yeniden temellendirir ve görüntü zıplar. _kadraj hedeflenen açıyla hesaplanmalı, o yüzden
     * açılar önce cam'e yazılır, kadraj ondan sonra okunur ve ikisi birlikte gönderilir.
     */
    if (kadrajla) {
      const eski = { yaw: this.cam.yaw, pitch: this.cam.pitch };
      this.cam.yaw = a.yaw; this.cam.pitch = a.pitch;
      const k = this._kadraj(null);
      this.cam.yaw = eski.yaw; this.cam.pitch = eski.pitch;
      this._goto({ yaw: a.yaw, pitch: a.pitch, dist: k.dist, target: k.target }, animate);
    } else this._goto({ yaw: a.yaw, pitch: a.pitch }, animate);
    this.pushHistory();
  }
  getCamera() { const c = this.cam; return { yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: c.target.slice(), persp: c.persp, fov: this.opts.fov }; }
  setCamera(cam, { animate = true } = {}) {
    if (!cam) return;
    this.pushHistory();
    const to = {};
    if (isFinite(cam.yaw)) to.yaw = cam.yaw; if (isFinite(cam.pitch)) to.pitch = clamp(cam.pitch, -1.5708, 1.5708);
    if (cam.dist > 0) to.dist = cam.dist; if (cam.target && cam.target.length >= 3) to.target = [+cam.target[0], +cam.target[1], +cam.target[2]];
    if (typeof cam.persp === 'boolean') this.cam.persp = cam.persp;
    if (isFinite(cam.fov) && cam.fov !== this.opts.fov) { this.opts.fov = clamp(+cam.fov, 10, 120); this._persist(); }
    this._goto(to, animate);
    this.pushHistory();
  }
  /** kamerayı hedefe götürür: hedef değerler hemen cam'e yazılır, görüntü 250 ms'de yumuşar */
  _goto(to, animate) {
    const c = this.cam;
    const from = this._anim ? this._display() : { yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: c.target.slice() };
    if (to.yaw != null) c.yaw = to.yaw; if (to.pitch != null) c.pitch = to.pitch; if (to.dist != null) c.dist = to.dist; if (to.target) c.target = to.target.slice();
    if (!animate || reduceMotion() || !window.requestAnimationFrame) { this._anim = null; this.render(); return; }
    const same = Math.abs(angDelta(from.yaw, c.yaw)) < 1e-6 && Math.abs(from.pitch - c.pitch) < 1e-6 && Math.abs(from.dist - c.dist) < 1e-9 && from.target.every((v, i) => Math.abs(v - c.target[i]) < 1e-9);
    if (same) { this._anim = null; this.render(); return; }
    this._anim = { from, t0: performance.now(), dur: 250 };
    if (!this._animReq) this._animReq = requestAnimationFrame(this._animStep);
    this.render();
  }
  _animStep = () => {
    this._animReq = 0;
    if (!this._anim) return;
    const t = (performance.now() - this._anim.t0) / this._anim.dur;
    if (t >= 1) this._anim = null;
    this.render();
    if (typeof this.onFrame === 'function') { try { this.onFrame(); } catch (_) { /* geç */ } }
    else if (typeof this.onChange === 'function') { try { this.onChange('camera', this.getCamera()); } catch (_) { /* geç */ } }
    if (this._anim) this._animReq = requestAnimationFrame(this._animStep);
  };
  /** çizilen (ara) kamera */
  _display() {
    const c = this.cam, a = this._anim;
    if (!a) return c;
    const t = easeOut(clamp((performance.now() - a.t0) / a.dur, 0, 1)), f = a.from;
    return { yaw: f.yaw + angDelta(f.yaw, c.yaw) * t, pitch: lerp(f.pitch, c.pitch, t), dist: lerp(f.dist, c.dist, t), target: [lerp(f.target[0], c.target[0], t), lerp(f.target[1], c.target[1], t), lerp(f.target[2], c.target[2], t)], persp: c.persp };
  }
  _stopAnim() { if (this._anim) { this._anim = null; } }
  // ---- kamera geçmişi (30) ----
  _camEq(a, b) { return !!a && !!b && Math.abs(a.yaw - b.yaw) < 1e-9 && Math.abs(a.pitch - b.pitch) < 1e-9 && Math.abs(a.dist - b.dist) < 1e-9 && a.persp === b.persp && a.target.every((v, i) => Math.abs(v - b.target[i]) < 1e-9); }
  pushHistory() {
    const cur = this.getCamera();
    if (this.histI >= 0 && this._camEq(this.hist[this.histI], cur)) return;
    this.hist.length = this.histI + 1;
    this.hist.push(cur);
    if (this.hist.length > 30) this.hist.shift();
    this.histI = this.hist.length - 1;
  }
  canHistoryBack() { return this.histI > 0; }
  canHistoryForward() { return this.histI >= 0 && this.histI < this.hist.length - 1; }
  historyBack() {
    if (!this.canHistoryBack()) return false;
    const cur = this.getCamera();
    if (!this._camEq(this.hist[this.histI], cur)) { this.hist.length = this.histI + 1; this.hist.push(cur); if (this.hist.length > 30) this.hist.shift(); this.histI = this.hist.length - 1; }
    this.histI--;
    this._applyHist(this.hist[this.histI]);
    return true;
  }
  historyForward() {
    if (!this.canHistoryForward()) return false;
    this.histI++;
    this._applyHist(this.hist[this.histI]);
    return true;
  }
  _applyHist(h) { const c = this.cam; c.yaw = h.yaw; c.pitch = h.pitch; c.dist = h.dist; c.target = h.target.slice(); c.persp = h.persp; this._anim = null; this.render(); this._emit('camera', this.getCamera()); }

  // ---------------------------------------------------------------------------------
  // çizim
  // ---------------------------------------------------------------------------------
  _eye(c) { const zs = this.zScale; const tgt = [c.target[0], c.target[1], c.target[2] * zs]; return [tgt[0] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), tgt[1] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), tgt[2] + c.dist * Math.sin(c.pitch), tgt]; }
  /** dünya (mutlak) → kırpma matrisi */
  mvp() {
    const cv = this.cv, c = this._display();
    const aspect = cv.width / Math.max(1, cv.height);
    const e = this._eye(c), tgt = e[3], eye = [e[0], e[1], e[2]];
    const view = lookAt(eye, tgt, [0, 0, 1]);
    // yakın düzlem model yarıçapına değil uzaklığa bağlı: km ölçekli paftada ayrıntıya inilebilsin (24 bit derinlik yeter, uzak z-savaşı polygonOffset ile örtülü)
    const near = Math.max(this.radius * 1e-6, c.dist * 0.002), far = c.dist * 10 + this.radius * 10;
    const fov = clamp(this.opts.fov, 10, 120) * Math.PI / 180;
    const hh = c.dist * Math.tan(fov / 2);
    // paralel: derinlik aralığı KUTUNUN kendisinden hesaplanır (bkz. _orthoAralik)
    const oa = c.persp ? null : this._orthoAralik(eye, tgt);
    const proj = c.persp ? perspective(fov, aspect, near, far) : ortho(-hh * aspect, hh * aspect, -hh, hh, oa[0], oa[1]);
    return mul4(proj, view);
  }
  /*
   * PARALEL İZDÜŞÜMÜN DERİNLİK ARALIĞI (v8.3). Eskiden sabitti: göz ± (uzaklık + 2,5 yarıçap).
   * O sabit modelin ÖLÇEKLİ yüksekliğini hesaba katmıyordu; düşey abartı (Z×) 2,5'in üstüne
   * çıkınca ya da hedef modelin dışına kayınca ÜSTTEN BAKIŞTA MODELİN ALTI KIRPILIYORDU —
   * kullanıcı "model ne kadar yüksek olursa olsun en tepeden görünmeli" derken tam bunu
   * kastediyor. Artık sınır kutusunun sekiz köşesi bakış doğrultusuna izdüşürülür ve aralık
   * oradan kurulur: ne eksik kalır (kırpma olmaz) ne de gereksiz genişler — geniş aralık
   * 16/24 bit derinlik tamponunda z-savaşı doğurur ve siluet kabuğunu yüzlere karıştırır.
   * Yarıçapın yüzde biri en küçük yarı aralıktır: bakış doğrultusunda kalınlığı sıfır olan
   * bir model (plandaki düz pafta) derinliği sıfır bir hacme sıkışmasın.
   */
  _orthoAralik(eye, tgt) {
    const bb = this.bb;
    if (!bb) { const r = this.radius * 2.5; return [-r, r]; }
    let fx = tgt[0] - eye[0], fy = tgt[1] - eye[1], fz = tgt[2] - eye[2];
    const L = Math.hypot(fx, fy, fz) || 1; fx /= L; fy /= L; fz /= L;
    const zs = this.zScale;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 8; i++) {
      const x = (i & 1 ? bb[3] : bb[0]) - eye[0], y = (i & 2 ? bb[4] : bb[1]) - eye[1], z = (i & 4 ? bb[5] : bb[2]) * zs - eye[2];
      const t = x * fx + y * fy + z * fz;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    if (!isFinite(lo) || !isFinite(hi)) { const r = this.radius * 2.5; return [-r, r]; }
    const orta = (lo + hi) / 2, yari = Math.max((hi - lo) / 2 * 1.02, this.radius * 0.01, 1e-6);
    return [orta - yari, orta + yari];
  }
  /** hedef uzaklığında bir CSS pikselinin dünya birimi karşılığı (paralelde tam, perspektifte hedef düzleminde) */
  _worldPerPixel(c) {
    const fov = clamp(this.opts.fov, 10, 120) * Math.PI / 180;
    const hh = c.dist * Math.tan(fov / 2);
    return (2 * hh) / Math.max(1, this.cv.clientHeight);
  }
  _bgColor() {
    const b = this.opts.bg;
    if (b === 'black') return [0, 0, 0]; if (b === 'white') return [1, 1, 1];
    if (b === 'custom') return parseColor(this.opts.bgColor) || this.bgTheme;
    if (b === 'gradient') return this.dark ? [0.09, 0.11, 0.15] : [0.9, 0.92, 0.95];
    return this.bgTheme;
  }
  /** etkin arka plan (css) — HUD ve panel için */
  bgCss() { return toCss(this._bgColor()); }
  /** arka plana göre okunur ön plan (FG(-1) nesneleri için) */
  _fgFor(bg) { return lum(bg) > 0.5 ? [0.07, 0.07, 0.07] : [0.95, 0.96, 0.97]; }
  render(kare = {}) {
    const gl = this.gl, cv = this.cv, o = this.opts;
    if (this._lost || gl.isContextLost()) return;   // bağlam kayıp: geri gelince webglcontextrestored yeniden kurar
    /*
     * Etkileşim sadeleştirmesi. Milyonlarca üçgenli bir modelde her kare bütün yüzeyleri çizmek döndürmeyi
     * takar; CAD programlarının çözümü hareket sırasında geçici olarak sadeleşmektir. Ölçüt kendi kendine
     * kurulur: sahne AĞIRSA (indeksli ağ tamponu eşiği aşıyorsa), ÖNCEKİ kare yavaş sürdüyse ve yeni istek
     * hemen ardından geldiyse (yani kullanıcı sürüklüyorsa) o kare yalnız kenarlarla çizilir. Hareket
     * durunca kısa bir gecikmeyle tam kalitede yeniden çizilir.
     *
     * SADELEŞTİRME MODELİ GÖRÜNMEZ KILAMAZ (v8.1). Atlanan şey ağ YÜZEYLERİDİR; geriye o ağın kendi
     * TEL KAFESİ kalmalıdır. İki durumda kalmıyordu ve kullanıcı "görüntü bir ara kayboldu" diyordu:
     *   (a) ağ ilkelinin hiç kenar dizisi (seg) yoksa — geriye çizilecek bir şey kalmaz;
     *   (b) Gölgeli / Gerçekçi gibi KENAR ÇİZMEYEN stillerde (STYLES.shaded.edges === false) —
     *       yüzey atlanır, kenar da zaten çizilmez, ekran boşalır.
     * (a) için sadeleştirme hiç açılmaz; (b) için o karede kenarlar ZORLA çizilir (AutoCAD de
     * döndürürken tel kafese iner) ve kenar rengi geçersiz kılınmaz — koyu kenar koyu zeminde
     * görünmezdi, nesne kendi rengiyle çizilir.
     */
    {
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const heavy = (this._nIdx.mesh || 0) > FAST_MESH_IDX && (this._nMeshEdge || 0) > 0;
      this._fastFrame = heavy && (this._lastFrameMs || 0) > FAST_FRAME_MS && (nowMs - (this._lastRenderAt || 0)) < FAST_GAP_MS;
      this._frameT0 = nowMs;
    }
    // tuval boyutu CSS boyutuyla uyuşmuyorsa (döndürme, panel, klavye) düzelt — en-boy oranı bozulmasın
    /*
     * Tuval ölçüsü CSS ölçüsüyle uyuşmuyorsa (döndürme, panel, klavye) düzeltilir ve kullanıcının
     * yakınlaşması yeni en-boy oranına TAŞINIR. Taşıma çarpanı artık eski `_fitK` değil, yön
     * duyarlı kadrajın kendi uzaklığıdır (v8.5): ikisi ayrı formüllerdi ve v8.4'ten sonra
     * uyuşmuyorlardı — ekran döndürülünce üst görünüş yanlış ölçekte kalıyordu.
     */
    { const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1)); const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr); if (w > 0 && h > 0 && (cv.width !== w || cv.height !== h)) { const k0 = this._kadrajUzakligi(); cv.width = w; cv.height = h; const k1 = this._kadrajUzakligi(); if (k0 > 0 && isFinite(k1 / k0)) this.cam.dist *= k1 / k0; } }
    if (!cv.width || !cv.height) return;
    gl.viewport(0, 0, cv.width, cv.height);
    const bg = this._bgColor();
    /*
     * Saydam kare: 2B plan altlığı olarak basılacaksa arka plan YAZILMAZ (bkz. editor.planAltlik).
     * Temizleme rengi (0,0,0,0) olmalı: bağlam premultipliedAlpha ile kurulduğundan RGB değerleri
     * alfayla ÇARPILMIŞ sayılır; (bg, 0) yazmak geçersiz bir ön-çarpım verir ve tarayıcı kareyi
     * toplamalı harmanlayıp 2B'nin arka planını açar.
     */
    if (kare.saydam) gl.clearColor(0, 0, 0, 0); else gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    const u = this.u;
    // uFg YALNIZ tek renk kipinde kullanılır; o kipte 2B'nin ton seçimi geçerlidir, başka kipte ön plan rengi
    const fgEff = (o.colorMode === 'mono' && this.monoFg) ? this.monoFg : ((o.bg === 'theme') ? this.fg : this._fgFor(bg));
    // gradyan arka plan: tam ekran dörtgen, derinlik yazmadan
    if (o.bg === 'gradient') {
      const top = this.dark ? [0.05, 0.07, 0.11] : [0.98, 0.99, 1], bot = this.dark ? [0.2, 0.25, 0.32] : [0.78, 0.82, 0.88];
      this.uploadCol('bgq', new Float32Array([bot[0], bot[1], bot[2], 1, bot[0], bot[1], bot[2], 1, top[0], top[1], top[2], 1, top[0], top[1], top[2], 1]));
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      gl.uniformMatrix4fv(u.uMVP, false, IDENT4); gl.uniform1f(u.uZ, 1); gl.uniform2f(u.uOff, 0, 0); gl.uniform1i(u.uColorMode, 0); gl.uniform1i(u.uClip, 0); gl.uniform1i(u.uLit, 0); gl.uniform1f(u.uFade, 0); gl.uniform4f(u.uOverride, 0, 0, 0, 0); gl.uniform1f(u.uAlpha, 1);
      this._draw('bgq', gl.TRIANGLE_STRIP, 1);
      gl.depthMask(true);
    }
    gl.enable(gl.DEPTH_TEST);
    const c = this._display();
    const m = this.mvp();
    const mo = mul4(m, translate(this.origin[0], this.origin[1], this.origin[2] * this.zScale));
    for (let i = 0; i < 16; i++) this._mvpF32[i] = mo[i];
    gl.uniformMatrix4fv(u.uMVP, false, this._mvpF32);
    gl.uniform1f(u.uZ, this.zScale);
    gl.uniform2f(u.uOff, 0, 0);
    gl.uniform3f(u.uFg, fgEff[0], fgEff[1], fgEff[2]);
    gl.uniform3f(u.uBg, bg[0], bg[1], bg[2]);
    gl.uniform1f(u.uZmin, this.zrange[0] - this.origin[2]); gl.uniform1f(u.uZmax, this.zrange[1] - this.origin[2]);
    const e = this._eye(c);
    gl.uniform3f(u.uEye, e[0] - this.origin[0], e[1] - this.origin[1], e[2] - this.origin[2] * this.zScale);
    { const tg = e[3]; const vd = [tg[0] - e[0], tg[1] - e[1], tg[2] - e[2]]; const L = Math.hypot(vd[0], vd[1], vd[2]) || 1; gl.uniform3f(u.uViewDir, vd[0] / L, vd[1] / L, vd[2] / L); gl.uniform1i(u.uPersp, c.persp ? 1 : 0); }   // siluet kabuğunun geri itileceği bakış doğrultusu
    gl.uniform2f(u.uFadeRange, Math.max(0, c.dist - this.radius * 0.5), c.dist + this.radius * 1.5);
    gl.uniform1f(u.uFade, o.depthFade ? 0.75 : 0);
    // kesit
    const cl = o.clip;
    if (cl) { const og = this.origin; gl.uniform1i(u.uClip, 1); gl.uniform3f(u.uClipMin, cl[0] - og[0], cl[1] - og[1], cl[2] - og[2]); gl.uniform3f(u.uClipInv, 1 / Math.max(1e-12, cl[3] - cl[0]), 1 / Math.max(1e-12, cl[4] - cl[1]), 1 / Math.max(1e-12, cl[5] - cl[2])); }
    else gl.uniform1i(u.uClip, 0);
    // ışık
    let L;
    if (o.lightMode === 'fixed') L = [-0.5, -0.5, 0.7071]; else { const cp = Math.cos(c.pitch); L = [cp * Math.cos(c.yaw), cp * Math.sin(c.yaw), Math.sin(c.pitch)]; const k = 0.35; L = [L[0] * (1 - k) - k * 0.6, L[1] * (1 - k) - k * 0.6, L[2] * (1 - k) + k]; }
    const LL = Math.hypot(L[0], L[1], L[2]) || 1;
    gl.uniform3f(u.uLightDir, L[0] / LL, L[1] / LL, L[2] / LL);
    gl.uniform1f(u.uAmbient, o.light ? o.ambient : 1); gl.uniform1f(u.uIntensity, o.light ? o.lightIntensity : 0);
    gl.uniform1i(u.uLit, 0); gl.uniform4f(u.uOverride, 0, 0, 0, 0);
    gl.uniform1f(u.uPointSize, 1);
    gl.uniform1f(u.uJitter, 0); gl.uniform1f(u.uSeed, 0); gl.uniform1f(u.uHull, 0); gl.uniform1i(u.uFlat, 0); gl.uniform1f(u.uFlatZ, 0); gl.uniform1i(u.uShade, 0); gl.uniform1f(u.uGray, 0);
    const fx = this._styleFx();
    const dpr = window.devicePixelRatio || 1, dprS = Math.max(1, Math.min(3, Math.round(dpr)));   // çizgi ofsetleri cihaz pikselidir; kalınlık CSS px'e göre seçilir
    // ızgara ve eksenler: renk özniteliğinden, kesitsiz
    gl.uniform1i(u.uColorMode, 0); gl.uniform1i(u.uClip, 0);
    // Izgara bir ALTLIKTIR: derinlik yazmaz. Düz bir paftada çizimle aynı kotta durduğu için
    // yazsaydı üstten bakışta altındaki çizgileri ve dolguları siler (z-savaşı).
    if (o.grid) { gl.depthMask(false); this._draw('grid', gl.LINES, 0.6); gl.depthMask(true); }
    if (o.axes) this._draw('axes', gl.LINES, 1);
    if (cl) gl.uniform1i(u.uClip, 1);
    // nesneler
    const cm = o.colorMode === 'elevation' ? 1 : o.colorMode === 'mono' ? 2 : 0;
    gl.uniform1i(u.uColorMode, cm);
    const dim = o.dimOthers && this._selCount > 0 ? 0.3 : 1;
    const lit = o.light && fx.faces === 'lit';
    const px = 2 / cv.width, py = 2 / cv.height;
    const darkEdge = lum(bg) > 0.5 ? [0.1, 0.1, 0.1] : [0.05, 0.05, 0.05];
    // zemin gölgesi: yüzeyler ızgara kotuna yatırılır
    if (fx.shadow && this._hasFaces()) {
      const gz = (o.gridZ === 'zero' ? 0 : o.gridZ === 'custom' ? (+o.gridZValue || 0) : this.bb[2]) - this.origin[2];
      gl.uniform1i(u.uFlat, 1); gl.uniform1f(u.uFlatZ, gz * this.zScale - this.radius * 1e-4);
      gl.uniform4f(u.uOverride, lum(bg) > 0.5 ? 0.35 : 0.02, lum(bg) > 0.5 ? 0.35 : 0.02, lum(bg) > 0.5 ? 0.38 : 0.04, 1);
      gl.depthMask(false); this._drawFaces(gl.TRIANGLES, 0.45, true); gl.depthMask(true);
      gl.uniform1i(u.uFlat, 0); gl.uniform4f(u.uOverride, 0, 0, 0, 0);
    }
    // siluet: kameradan uzağa şişirilmiş koyu kabuk (yüzeyler üstüne çizilince yalnız çevre kalır)
    if (fx.silhouette && this._hasFaces() && fx.faces !== 'none' && fx.faces !== 'xray') {
      this._ensureSmooth();
      gl.uniform1f(u.uHull, this._worldPerPixel(c) * o.silhouetteWidth);   // piksel cinsinden siluet kalınlığı (yakınlaşınca kalınlaşmaz)
      gl.uniform1f(u.uHullBack, HULL_BACK);                                // kabuk bakış doğrultusunda bu kadar siluet kalınlığı geriye (gölgelendiriciye bkz.)
      gl.uniform4f(u.uOverride, darkEdge[0], darkEdge[1], darkEdge[2], 1);
      // kabuk derinlikte yüzlerin ARKASINA itilir: yüzler (1,1) ofsetiyle çizildiğinden dik yüzlerde kabuk öne geçip yüzü karartmasın
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(4, 8);
      this._drawFaces(gl.TRIANGLES, 1, true, true);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.uniform1f(u.uHull, 0); gl.uniform1f(u.uHullBack, 0); gl.uniform4f(u.uOverride, 0, 0, 0, 0);
    }
    if (fx.faces === 'bg') {
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.uniform4f(u.uOverride, bg[0], bg[1], bg[2], 1);
      this._drawFaces(gl.TRIANGLES, 1, true);
      gl.uniform4f(u.uOverride, 0, 0, 0, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    } else if (fx.faces === 'lit') {
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.uniform1i(u.uLit, lit ? 1 : 0); gl.uniform1i(u.uShade, lit ? (fx.shade === 1 ? 1 : (fx.specular ? 2 : 0)) : 0); gl.uniform1f(u.uGray, fx.gray);
      if (fx.quality === 'smooth') this._ensureSmooth();
      if (o.faceOpacity < 1) gl.depthMask(false);
      this._drawFaces(gl.TRIANGLES, dim * o.faceOpacity, true, fx.quality === 'smooth');
      gl.depthMask(true);
      gl.uniform1i(u.uLit, 0); gl.uniform1i(u.uShade, 0); gl.uniform1f(u.uGray, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    } else if (fx.faces === 'xray') {
      gl.depthMask(false);
      this._drawFaces(gl.TRIANGLES, 0.25 * dim, true);
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);
    }
    if (!fx.depth) gl.disable(gl.DEPTH_TEST);
    if (fx.gray) gl.uniform1f(u.uGray, fx.gray);
    // çizgiler (kalınlık: NDC ofsetli tekrar); kenarlar: renk geçersiz kılma, eskiz titremesi
    /*
     * AĞ KENARLARININ İKİ KÜMESİ (v8.9). `medges`: okuyucunun / _telKafesKenar'ın 20° kırışıklık
     * kenarları — gölgeli stillerde yüzeyin üstüne binen çizgidir, boru gibi kavisli gövde pürüzsüz
     * kalır. Yüzey çizilmeyen stillerde (tel kafes, 2B tel kafes, gizli çizgi) bu küme boruyu yalnız
     * uç halkalarıyla bırakıyordu; o stillerde `wedges` çizilir: kavisli yüzeyin BÜTÜN yüz kenarları
     * (bkz. _ensureWireEdges). Sadeleştirilmiş karede de wedges hazırsa o kullanılır — döndürürken
     * de boru görünür kalsın.
     */
    const telKafes = fx.faces === 'none' || fx.faces === 'bg';
    if (telKafes) this._ensureWireEdges();
    const agKenar = (telKafes || this._fastFrame) && this._wire && this._wire.n ? 'wedges' : 'medges';
    this._agKenarSon = agKenar;   // sınama kancası: bu karede hangi ağ kenar kümesi çizildi
    const segs = (this._n.lines + this._n.edges + (agKenar === 'wedges' ? this._wire.n : (this._n.medges | 0))) / 2;
    const lw = segs > 300000 ? 'thin' : o.lineWidth;
    // ince: 1 cihaz px; normal: ~1 CSS px (dpr cihaz px); kalın: bir kademe daha (dpr 1'de eski 2 px görünüm)
    const offs = lw === 'thick' ? LINE_OFFS[Math.min(4, dprS + 1)] : lw === 'normal' ? LINE_OFFS[dprS] : LINE_OFFS[1];
    const edgeCol = o.edgeColor === 'black' ? [0, 0, 0] : o.edgeColor === 'white' ? [1, 1, 1] : o.edgeColor === 'fg' ? fgEff : (fx.shade || fx.gray || fx.faces === 'lit' && o.style !== 'shadedEdges' ? darkEdge : null);
    const jitterAmt = fx.jitter ? fx.jitter * 1.6 * px : 0;
    // Sadeleştirilmiş karede yüzeyler atlandı: kenar çizmeyen stillerde bile tel kafes görünsün (bkz. render başı)
    const hizliKenar = this._fastFrame && !fx.edges && ((this._n.edges | 0) + (this._n.medges | 0)) > 0;
    const kenarCiz = fx.edges || hizliKenar;
    const edgeColEff = hizliKenar ? null : edgeCol;   // yalnız sadeleştirme için çizilen kenar KENDİ rengiyle çizilir
    const kenarCizim = (ad) => {
      if (ad === 'wedges') { this._drawWire(dim); return; }
      if (jitterAmt) { for (let j = 0; j < 3; j++) { gl.uniform1f(u.uJitter, jitterAmt); gl.uniform1f(u.uSeed, j * 7.13); this._draw(ad, gl.LINES, dim * 0.8); } gl.uniform1f(u.uJitter, 0); }
      else this._draw(ad, gl.LINES, dim);
    };
    for (let i = 0; i < offs.length; i++) {
      gl.uniform2f(u.uOff, offs[i][0] * px, offs[i][1] * py);
      this._draw('lines', gl.LINES, dim);
      if (kenarCiz) {
        if (edgeColEff) gl.uniform4f(u.uOverride, edgeColEff[0], edgeColEff[1], edgeColEff[2], 1);
        kenarCizim('edges'); kenarCizim(agKenar);
        if (edgeColEff) gl.uniform4f(u.uOverride, 0, 0, 0, 0);
      }
    }
    gl.uniform1f(u.uGray, 0);
    gl.uniform2f(u.uOff, 0, 0);
    gl.uniform1f(u.uPointSize, o.pointSize * dpr);
    this._draw('pts', gl.POINTS, dim);
    if (o.textPoints) { gl.uniform1f(u.uPointSize, o.pointSize * 0.7 * dpr); this._draw('txt', gl.POINTS, dim); }
    // seçim, kesit kutusu: derinlik testi kapalı, kesitsiz
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1i(u.uColorMode, 0); gl.uniform1i(u.uClip, 0); gl.uniform1f(u.uFade, 0);
    const selOffs = LINE_OFFS[Math.min(4, dprS + 1)];
    for (let i = 0; i < selOffs.length; i++) { gl.uniform2f(u.uOff, selOffs[i][0] * px, selOffs[i][1] * py); this._draw('sel', gl.LINES, 1); }
    gl.uniform2f(u.uOff, 0, 0);
    if (o.clipBox && cl) this._draw('clipBox', gl.LINES, 0.9);
    gl.enable(gl.DEPTH_TEST);
    this.lastMvp = m;
    {
      const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this._lastFrameMs = nowMs - this._frameT0;
      this._lastRenderAt = nowMs;
      clearTimeout(this._hiTimer);
      if (this._fastFrame) this._hiTimer = setTimeout(() => { this._lastFrameMs = 0; this._lastRenderAt = 0; this.render(); }, FAST_SETTLE_MS);
    }
  }
  /** yüzeyler: genişletilmiş `tris` tamponu + indeksli `mesh` tamponu birlikte çizilir */
  _drawFaces(mode, alpha, withNrm = true, smooth = false) {
    this._draw('tris', mode, alpha, withNrm, smooth);
    if (this._fastFrame) return;                       // hareket sırasında ağ yüzeyleri atlanır, kenarlar kalır
    this._drawIdx('mesh', mode, alpha, withNrm);
  }
  /** indeksli çizim: köşeler paylaşıldığı için köşe gölgelendirici üçgen sayısının üçte biri kadar çalışır */
  _drawIdx(name, mode, alpha, withNrm) {
    const n = this._nIdx[name]; if (!n || !this.u32) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name + ':pos']);
    gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name + ':col']);
    gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 4, gl.FLOAT, false, 0, 0);
    if (this.aNrm >= 0) {
      const nb = this.bufs[name + ':nrm'];
      if (withNrm && nb) { gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.enableVertexAttribArray(this.aNrm); gl.vertexAttribPointer(this.aNrm, 3, gl.FLOAT, false, 0, 0); }
      else { gl.disableVertexAttribArray(this.aNrm); gl.vertexAttrib3f(this.aNrm, 0, 0, 1); }
    }
    gl.uniform1f(this.u.uAlpha, alpha);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.bufs[name + ':idx']);
    gl.drawElements(mode, n, gl.UNSIGNED_INT, 0);
  }
  _draw(name, mode, alpha, withNrm = false, smooth = false) {
    const n = this._n[name]; if (!n) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name + ':pos']);
    gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[name + ':col']);
    gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 4, gl.FLOAT, false, 0, 0);
    if (this.aNrm >= 0) {
      const nb = smooth && this.bufs[name + ':nrm2'] ? this.bufs[name + ':nrm2'] : this.bufs[name + ':nrm'];
      if (withNrm && nb) { gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.enableVertexAttribArray(this.aNrm); gl.vertexAttribPointer(this.aNrm, 3, gl.FLOAT, false, 0, 0); }
      else { gl.disableVertexAttribArray(this.aNrm); gl.vertexAttrib3f(this.aNrm, 0, 0, 1); }
    }
    gl.uniform1f(this.u.uAlpha, alpha);
    gl.drawArrays(mode, 0, n);
  }
  /** dünya → ekran (css px) */
  project(x, y, z) {
    const m = this.lastMvp || this.mvp();
    const p = xform4(m, x, y, (z || 0) * this.zScale);
    const W = this.cv.clientWidth, H = this.cv.clientHeight;
    return [(p[0] + 1) / 2 * W, (1 - p[1]) / 2 * H, p[2]];
  }
  /** ekran noktasına en yakın köşe (yakalama); kesit dışı köşeler yok sayılır */
  pickVertex(sx, sy, tol = 18) {
    let best = null, bd = tol;
    const cl = this.opts.clip;
    const m = this.lastMvp || this.mvp(), W = this.cv.clientWidth, H = this.cv.clientHeight, zs = this.zScale;
    const A = this.vertXYZ, n = this.vertPrim.length;
    for (let i = 0; i < n; i++) {
      const vx = A[i * 3], vy = A[i * 3 + 1], vz = A[i * 3 + 2];
      if (cl && (vx < cl[0] || vy < cl[1] || vz < cl[2] || vx > cl[3] || vy > cl[4] || vz > cl[5])) continue;
      const z = vz * zs;
      const w = m[3] * vx + m[7] * vy + m[11] * z + m[15];
      const pz = (m[2] * vx + m[6] * vy + m[10] * z + m[14]) / w;
      if (pz < -1 || pz > 1) continue;
      const px = ((m[0] * vx + m[4] * vy + m[8] * z + m[12]) / w + 1) / 2 * W, py = (1 - (m[1] * vx + m[5] * vy + m[9] * z + m[13]) / w) / 2 * H;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bd) { bd = d; best = { p: [vx, vy, vz], prim: this.vertPrim[i] }; }
    }
    return best;
  }
  /*
   * EKRAN IŞINI. Ters izdüşüm matrisi KURULMAZ: ışın, kameranın kendi tabanından üretilir ve
   * mvp() ile birebir aynı üç açıdan (yaw, pitch, dist) beslenir; böylece ışın ile ekranda
   * görünen sahne asla ayrışmaz. Canlandırma sürerken de _display() okunur — mvp() de onu okur.
   *
   * Paralel izdüşümde bütün ışınlar aynı yöndedir (bakış doğrultusu) ve başlangıç noktası
   * pikselden kayar; perspektifte başlangıç gözdür ve yön pikselden pikselden değişir.
   * Dönen koordinatlar Z ABARTILI uzaydadır — rayMesh3 aynı uzayda çalışır ve sonucu gerçek
   * kota çevirir.
   */
  screenRay(sx, sy) {
    const c = this._display();
    const e = this._eye(c), tgt = e[3], eye = [e[0], e[1], e[2]];
    let fx = tgt[0] - eye[0], fy = tgt[1] - eye[1], fz = tgt[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    // sağ = ileri × yukarı(0,0,1), yukarı = sağ × ileri  (lookAt ile aynı taban)
    let rx = fy * 1 - fz * 0, ry = fz * 0 - fx * 1, rz = fx * 0 - fy * 0;
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const W = Math.max(1, this.cv.clientWidth), H = Math.max(1, this.cv.clientHeight);
    const ndcX = (sx / W) * 2 - 1, ndcY = 1 - (sy / H) * 2;
    const fov = Math.min(120, Math.max(10, this.opts.fov)) * Math.PI / 180;
    const hh = c.dist * Math.tan(fov / 2), hw = hh * (W / H);
    if (c.persp) {
      const dx = fx * c.dist + rx * ndcX * hw + ux * ndcY * hh;
      const dy = fy * c.dist + ry * ndcX * hw + uy * ndcY * hh;
      const dz = fz * c.dist + rz * ndcX * hw + uz * ndcY * hh;
      const dl = Math.hypot(dx, dy, dz) || 1;
      return { o: eye, d: [dx / dl, dy / dl, dz / dl] };
    }
    // paralel: göz düzleminde kaydırılmış başlangıç, sabit yön. Başlangıç modelin gerisine alınır
    // ki kameranın arkasında kalan gövdeler de taranabilsin (t her zaman pozitif olsun).
    const geri = c.dist + this.radius * 3;
    const ox = eye[0] + rx * ndcX * hw + ux * ndcY * hh - fx * geri;
    const oy = eye[1] + ry * ndcX * hw + uy * ndcY * hh - fy * geri;
    const oz = eye[2] + rz * ndcX * hw + uz * ndcY * hh - fz * geri;
    return { o: [ox, oy, oz], d: [fx, fy, fz] };
  }
  /**
   * Ekran noktasının altındaki YÜZEY noktası: en yakın ışın-üçgen kesişimi.
   * Gövde sınır kutusuyla ön elenir (rayBox3), kesit kutusu dışındaki kesişimler yok sayılır.
   * Dönüş {p:[x,y,z] gerçek kot, n:[birim normal], prim, t} ya da null.
   */
  pickSurface(sx, sy) {
    const list = this.meshPrims;
    if (!list || !list.length) return null;
    const ray = this.screenRay(sx, sy);
    const [ox, oy, oz] = ray.o, [dx, dy, dz] = ray.d;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const zs = this.zScale, cl = this.opts.clip;
    let best = null, bt = Infinity;
    for (const p of list) {
      const bb = p.bb;
      if (!bb) continue;
      const z0 = (p.zmin != null ? p.zmin : 0) * zs, z1 = (p.zmax != null ? p.zmax : 0) * zs;
      if (!rayBox3(ox, oy, oz, ix, iy, iz, bb[0], bb[1], Math.min(z0, z1), bb[2], bb[3], Math.max(z0, z1), bt)) continue;
      const h = rayMesh3(p.vtx, p.idx, ox, oy, oz, dx, dy, dz, zs, bt, cl || null);
      if (h && h.t < bt) { bt = h.t; best = { ...h, prim: p }; }
    }
    return best;
  }
  // ---- hareketler ----
  orbit(dx, dy) {
    this._stopAnim();
    const t = this.opts.touch, k = 0.01 * (t.sensitivity || 1), inv = t.invertY ? -1 : 1;
    this.cam.yaw -= dx * k; this.cam.pitch = Math.max(-1.5, Math.min(1.55, this.cam.pitch + inv * dy * k));
  }
  /** yakınlaşma sınırı: perspektifte yakın düzlem, paralelde float32 hassasiyeti belirler (km paftasında cm ayrıntısı) */
  zoom(f) { this._stopAnim(); const lo = this.radius * (this.cam.persp ? 1e-4 : 1e-5); this.cam.dist = Math.max(lo, Math.min(this.radius * 50, this.cam.dist / f)); }
  pan(dx, dy) {
    this._stopAnim();
    const c = this.cam;
    const k = this._worldPerPixel(c);   // CSS px → dünya: izdüşüm yüksekliğe göre kurulur, parmak modeli birebir izler
    const rx = [-Math.sin(c.yaw), Math.cos(c.yaw), 0];
    const up = [-Math.sin(c.pitch) * Math.cos(c.yaw), -Math.sin(c.pitch) * Math.sin(c.yaw), Math.cos(c.pitch)];
    c.target[0] += (-dx * rx[0] + dy * up[0]) * k; c.target[1] += (-dx * rx[1] + dy * up[1]) * k; c.target[2] += (dy * up[2]) * k / this.zScale;
  }

  // ---------------------------------------------------------------------------------
  // döner tabla
  // ---------------------------------------------------------------------------------
  _bindStop() {
    // kendi dinleyicisi: dokunuş döner tablayı durdurur (kabuğa bağımlı değil)
    this.cv.addEventListener('pointerdown', () => { if (this._turn) this.setTurntable(false); }, true);
    try { document.addEventListener('visibilitychange', () => { if (document.hidden && this._turn) this.setTurntable(false); }); } catch (_) { /* geç */ }
  }
  setTurntable(on, fromSet = false) {
    on = !!on;
    if (on && reduceMotion()) on = false;
    if (on === !!this._turn) { if (this.opts.turntable !== on) { this.opts.turntable = on; if (!fromSet) this._emit('turntable', on); } return; }
    if (!on) {
      if (this._turn) { cancelAnimationFrame(this._turn.req); clearTimeout(this._turn.stopT); }
      this._turn = null; this.opts.turntable = false;
      if (!fromSet) this._emit('turntable', false);
      return;
    }
    this.opts.turntable = true;
    const st = { req: 0, last: performance.now(), stopT: 0 };
    this._turn = st;
    const step = (now) => {
      if (this._turn !== st) return;
      const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
      this.cam.yaw -= this.opts.turnSpeed * Math.PI / 180 * dt;
      this._anim = null;
      this.render();
      if (typeof this.onFrame === 'function') { try { this.onFrame(); } catch (_) { /* geç */ } }
      st.req = requestAnimationFrame(step);
    };
    st.req = requestAnimationFrame(step);
    st.stopT = setTimeout(() => { if (this._turn === st) { this.setTurntable(false); } }, 60000);
    if (!fromSet) this._emit('turntable', true);
  }
  stopTurntable() { this.setTurntable(false); }

  // ---------------------------------------------------------------------------------
  // ekran görüntüsü ve HUD
  // ---------------------------------------------------------------------------------
  /** WebGL tuvali + (varsa) kaplama tuvali cihaz pikselinde birleştirilir → dataURL */
  screenshot({ overlay = null, raw = false } = {}) {
    /*
     * RESİM HER ZAMAN TAM KALİTEDİR. Sadeleştirme ölçütü "önceki kare yavaştı ve hemen ardından
     * yeni istek geldi"dir; kullanıcı modeli döndürüp hemen paylaş düğmesine basarsa bu ölçüt
     * hâlâ doğrudur ve resim ağ yüzeyleri OLMADAN kaydedilirdi. Sayaçlar sıfırlanır: kaydedilen
     * görüntü ekranda duran görüntüden eksik olamaz.
     */
    this._lastFrameMs = 0; this._lastRenderAt = 0; this._fastFrame = false;
    this.render();
    const cv = this.cv, out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    const c = out.getContext('2d');
    c.drawImage(cv, 0, 0);
    if (overlay && overlay.width && overlay.height) c.drawImage(overlay, 0, 0, overlay.width, overlay.height, 0, 0, out.width, out.height);
    return raw ? out : out.toDataURL('image/png');   // raw: kâğıda gömmek için tuvalin kendisi
  }
  /** durum çubuğu / HUD metni */
/*
   * HUD metni. YOĞUN kipte İZDÜŞÜM TÜRÜ yazılmaz: "3B · Paralel" durum çubuğunda (#stMode,
   * editor.statusMode3D) 3B açıkken her zaman durur — aynı bilgiyi iki yerde göstermek kutuyu
   * bir satır uzatıyordu. Bir satır eksilince kutu 32 px'ten 16 px'e iner.
   *
   * IZGARA ADIMI ÇIKARILMAZ, ÇÜNKÜ YİNELENME DEĞİLDİR. Durum çubuğundaki "Izgara" çipi 2B
   * ızgarayı yazar (gridState.step) ve 2B ızgara kapalıyken hiç görünmez; buradaki this.gridStep
   * ise 3B sınır kutusundan türeyen ÜÇ BOYUTLU zemin ızgarasının adımıdır (bkz. yukarıdaki
   * niceStep(ext / 10)). İkisi çoğu çizimde aynı çıkar ama aynı şey değildir; onu atmak
   * kullanıcıdan gerçek bir ölçüyü saklamak olurdu.
   */
  hudText(dense = false) {
    const c = this.cam, u = this.units ? ' ' + this.units : '';
    let s = `${t('hudYaw')} ${fmtNum(c.yaw * 180 / Math.PI, 0)}°  ${t('hudPitch')} ${fmtNum(c.pitch * 180 / Math.PI, 0)}°  Z×${fmtNum(this.zScale, 2)}  ${t('hudGrid')} ${fmtNum(this.gridStep)}${u}`;
    if (!dense) s += `  ${c.persp ? t('hudPersp') : t('hudOrtho')}`;
    if (!this._hasFaces()) s += ' · ' + t('hudNoFaces');
    // Renk kipi nesne renginden başkaysa HUD söyler: 2B ile 3B arasındaki renk farkı açıklamasız kalmasın
    if (this.opts.colorMode && this.opts.colorMode !== 'entity') s += ' · ' + t({ layer: 'v3ColorLayer', elevation: 'v3Elev', mono: 'colorMono' }[this.opts.colorMode] || 'colorMode');
    return s;
  }
  /**
   * #ov üzerine HUD: kamera metni, eksen etiketleri, kot lejantı, kesit aralığı, pusula, kot etiketleri.
   * host: { fg, W, H, units, fmt, sel, gestureActive, fontScale }
   */
  drawHud(c, host = {}) {
    const o = this.opts, W = host.W || this.cv.clientWidth, H = host.H || this.cv.clientHeight, fs = host.fontScale || 1;
    if (host.units != null) this.units = host.units;
    const f = host.fmt || fmtNum;
    const bg = this._bgColor();
    const fg = o.bg === 'theme' && host.fg ? host.fg : toCss(this._fgFor(bg));
    const boxBg = lum(bg) > 0.5 ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.45)';
    const accent = toCss(this.selColor);
    c.save();
    c.textBaseline = 'top'; c.textAlign = 'left';
    const dense = !!host.dense;
    const mono = `${Math.round((dense ? 9 : 10) * fs)}px ui-monospace, "Roboto Mono", monospace`;
    const sans = `${Math.round(12 * fs)}px system-ui, sans-serif`;
    // eksen etiketleri
    if (o.axes && o.axisLabels && this.bb) {
      const bb = this.bb, a = this.axisLen || 1;
      c.font = `bold ${Math.round(12 * fs)}px system-ui, sans-serif`;
      const lab = (p, t, col) => { if (p[2] < -1 || p[2] > 1) return; c.fillStyle = col; c.fillText(t, p[0] + 3, p[1] - 14); };
      lab(this.project(bb[0] + a, bb[1], bb[2]), 'X', '#ff453a'); lab(this.project(bb[0], bb[1] + a, bb[2]), 'Y', '#30d158'); lab(this.project(bb[0], bb[1], bb[2] + a), 'Z', '#4285f4');
    }
    /*
     * HUD KUTUSUNUN GERÇEK YÜKSEKLİĞİ CSS'E BİLDİRİLİR (v8.0). Görünüm küpü HUD açıkken 62 px'e
     * iniyordu; o sayı HUD iki satırlı (32 px) olduğu günden kalmaydı. Yoğun HUD 16 px'e inince
     * küple kutu arasında 30 px'lik boş şerit kaldı ve küple pusula gereksiz yere aşağıdaydı.
     * Artık kutunun kendi alt kenarı yazılır, küp (ve ona bağlı pusula) hemen altına oturur.
     */
    let hudAlt = 0;
    // kamera metni
    if (o.hud) {
      c.font = mono;
      const l1 = this.hudText(dense);
      const bb = this.bb, cl = o.clip;
      const l2 = cl ? `Z: ${f(cl[2])} … ${f(cl[5])}` : bb ? `Z: ${f(bb[2])} … ${f(bb[5])}` : '';
      // İNCE HUD (v7.79): satır yüksekliği 14 → 12, iç boşluk 5 → 4, kutu daha sönük.
      // YOĞUN HUD (v7.82): 12 → 10, 4 → 3, yazı 10 → 9 px ve Z aralığı KENDİ SATIRINI BIRAKIR,
      // kamera satırının sonuna eklenir. Kutu 32 px'ten 16 px'e iner — kullanıcının istediği yarı.
      // Kutu çizimin üstünde durur; kalınlığı azaldıkça altındaki geometri daha çok görünür.
      const lh = Math.round((dense ? 10 : 12) * fs), pad = dense ? 3 : 4;
      // Yoğun kipte tek satır denenir; sığmazsa aşağıdaki bölme eski iki satırlı düzene döner.
      const tek = dense && l2 ? `${l1}  ${l2}` : l1;
      let top = [tek];
      let ayri = !dense || !l2;   // Z aralığı ayrı satırda mı yazılacak
      if (c.measureText(tek).width + pad * 2 > W - 16) {
        if (dense && l2) { top = [l1]; ayri = true; }   // sığmadı: Z aralığı yine kendi satırına
        else { const parts = l1.split('  '); const mid = Math.ceil(parts.length / 2); top = [parts.slice(0, mid).join('  '), parts.slice(mid).join('  ')]; }
      }
      if (dense && l2 && ayri && c.measureText(l1).width + pad * 2 > W - 16) { const parts = l1.split('  '); const mid = Math.ceil(parts.length / 2); top = [parts.slice(0, mid).join('  '), parts.slice(mid).join('  ')]; }
      const lines = (l2 && ayri) ? [...top, l2] : top;
      const w = Math.max(...lines.map(s => c.measureText(s).width)) + pad * 2, h = lh * lines.length + pad * 2;
      const x = 8, y = o.hudPos === 'bl' ? H - 8 - h : 8;
      this._hudBox = { x, y, w, h };   // pusula bu kutudan kaçınır
      hudAlt = o.hudPos === 'bl' ? 0 : y + h;   // küp yalnız ÜSTTEKİ kutunun altına iner
      c.fillStyle = boxBg; c.beginPath();
      if (c.roundRect) c.roundRect(x, y, w, h, 5); else c.rect(x, y, w, h);
      c.fill();
      c.fillStyle = fg; top.forEach((s, i) => c.fillText(s, x + pad, y + pad + lh * i));
      if (l2 && ayri) { c.fillStyle = cl ? accent : fg; c.fillText(l2, x + pad, y + pad + lh * top.length); }
    }
    if (this._hudAlt !== hudAlt) {
      this._hudAlt = hudAlt;
      try { document.documentElement.style.setProperty('--hud3-h', hudAlt + 'px'); } catch (_) { /* CSS değişkeni yoksa .cube kendi varsayılanını kullanır */ }
    }
    // kot lejantı (sağda dikey)
    if (o.colorMode === 'elevation') {
      const bh = Math.max(80, Math.round(H * 0.4)), bw = 18, x = W - 4 - bw, y = Math.round((H - bh) / 2);
      const g = c.createLinearGradient(0, y + bh, 0, y);
      g.addColorStop(0, '#295cf2'); g.addColorStop(0.25, '#33cce6'); g.addColorStop(0.5, '#40d14d'); g.addColorStop(0.75, '#fad933'); g.addColorStop(1, '#f24033');
      c.fillStyle = boxBg; c.fillRect(x - 4, y - 4, bw + 8, bh + 8);
      c.fillStyle = g; c.fillRect(x, y, bw, bh);
      c.font = sans; c.fillStyle = fg; c.textAlign = 'right';
      c.fillText(f(this.zrange[1]), x - 6, y); c.fillText(f(this.zrange[0]), x - 6, y + bh - 12);
      c.textAlign = 'left';
    }
    // pusula (2B'deki kuzey oku; cam.yaw ile döner)
    if (o.compass) {
      let left = false; try { left = document.body.classList.contains('left-hand'); } catch (_) { /* geç */ }
      const r = 16;
      /*
       * PUSULA HER ZAMAN KÜPÜN KÖŞESİNDE KALIR (v8.6).
       *
       * Eski kural "küpün yanına koy" idi ve küpün yerini offsetLeft/offsetTop ile okuyordu.
       * İki şeyi birden kaçırıyordu:
       *   (1) offsetLeft, tuvale değil KONUMLANDIRILMIŞ ATAYA göredir; #cube3d başka bir
       *       konumlandırılmış kapsayıcıya girerse sayı sessizce kayar.
       *   (2) Komut çubuğu açıkken zoom sütunu köşeye dayanır ve küp `right: 72px`e çekilir
       *       (app.css). Pusula bir 40 px daha sola gidince 412 px'lik telefonda merkezi
       *       x ≈ 204'e, yani EKRANIN TAM ORTASINA düşüyor ve çizimin üstünde duruyordu.
       *
       * Artık konum çakışmaya göre seçilir: kutular tuvalin kendi kutusuna göre
       * getBoundingClientRect ile okunur, adaylar sırayla denenir ve küp / zoom sütunu /
       * yön tuşları / HUD kutusuyla çakışmayan İLK aday alınır. Aday sırası küpün ALTIyla
       * başlar (küp içeri çekildiğinde orası boştur), sonra yanı, sonra üstü gelir. Her
       * adayda merkezin ekranın dış üçte birinde kalması aranır — böylece pusula hiçbir
       * yerleşimde ortaya kaçamaz. Son çare kenar boşluğudur.
       */
      const kutu = (id) => {
        try {
          const e = document.getElementById(id);
          if (!e || e.hidden || !e.offsetParent) return null;
          const q = e.getBoundingClientRect(), b = this.cv.getBoundingClientRect();
          if (!q.width || !q.height) return null;
          return { x: q.left - b.left, y: q.top - b.top, w: q.width, h: q.height };
        } catch (_) { return null; }
      };
      const kup = o.cube ? kutu('cube3d') : null;
      const engeller = [kup, kutu('navFabs'), kutu('dpad')].filter(Boolean);
      { const hb = o.hud && o.hudPos === 'tl' ? this._hudBox : null; if (hb) engeller.push(hb); }
      // pusulanın kapladığı kutu: daire + üstüne yazılan 'K' harfi (merkezin 34 px ötesine kadar)
      const pay = 6, R = r + 8;
      const carpisir = (cx, cy) => {
        if (cx - R < pay || cx + R > W - pay || cy - 34 < pay || cy + R > H - pay) return true;
        for (const g of engeller) if (cx + R > g.x - pay && cx - R < g.x + g.w + pay && cy + R > g.y - pay && cy - 34 < g.y + g.h + pay) return true;
        return false;
      };
      const disUcte = (cx) => (left ? cx < W / 3 : cx > W * 2 / 3);
      const adaylar = [];
      if (kup) {
        const km = kup.x + kup.w / 2, ky = kup.y + kup.h / 2;
        adaylar.push([km, kup.y + kup.h + 24 + r]);                               // küpün altı
        adaylar.push([left ? kup.x + kup.w + 24 + r : kup.x - 24 - r, ky]);        // küpün yanı (dışa doğru)
        adaylar.push([km, kup.y - 24 - r]);                                        // küpün üstü
        adaylar.push([left ? kup.x - 24 - r : kup.x + kup.w + 24 + r, ky]);        // küpün öbür yanı
      }
      adaylar.push([left ? 8 + 42 : W - 8 - 42, 8 + r + 6]);                       // küp yokken: köşe
      let cx = null, cy = null;
      for (const [ax, ay] of adaylar) { if (!carpisir(ax, ay) && disUcte(ax)) { cx = ax; cy = ay; break; } }
      if (cx == null) for (const [ax, ay] of adaylar) { if (!carpisir(ax, ay)) { cx = ax; cy = ay; break; } }
      if (cx == null) { cx = left ? 8 + 42 : W - 8 - 42; cy = 8 + r + 6; }
      cx = Math.max(r + 6, Math.min(W - r - 6, cx));
      cy = Math.max(r + 34, Math.min(H - r - 6, cy));   // 34: kuzey yukarıyı gösterdiğinde 'K' harfi ekranın dışına taşmasın
      this._pusula = { cx, cy, r };                     // sınama ve yerleşim denetimi için
      let swap = false; try { swap = !!(window.dwgApp && window.dwgApp.state && window.dwgApp.state.geo && window.dwgApp.state.geo.swap); } catch (_) { /* geç */ }
      // ekranda kuzey (+Y) yönü: kamera yaw'ına göre
      const ang = this.cam.yaw + Math.PI / 2 + (swap ? Math.PI / 2 : 0);
      c.save(); c.translate(cx, cy); c.rotate(ang);
      c.fillStyle = boxBg; c.beginPath(); c.arc(0, 0, r + 4, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.45, r * 0.55); c.lineTo(0, r * 0.2); c.closePath(); c.fillStyle = '#ff453a'; c.fill();
      c.beginPath(); c.moveTo(0, -r); c.lineTo(-r * 0.45, r * 0.55); c.lineTo(0, r * 0.2); c.closePath(); c.fillStyle = fg; c.fill();
      c.restore();
      c.font = `bold ${Math.round(11 * fs)}px system-ui, sans-serif`; c.fillStyle = fg; c.textAlign = 'center';
      c.fillText(t('northLetter'), cx + Math.sin(ang) * (r + 12), cy - Math.cos(ang) * (r + 12) - 6);
      c.textAlign = 'left';
    }
    // kot etiketleri
    if (o.elevLabels !== 'off' && !host.gestureActive && this.vertPrim.length) {
      c.font = sans;
      const cl = o.clip, A = this.vertXYZ, P = this.vertPrim, nv = P.length, m = this.lastMvp || this.mvp(), zs = this.zScale;
      // satır içi izdüşüm (project() tahsisi yok); 8 px hücre başına merkeze en yakın tek aday
      const cols = Math.ceil(W / 8) + 1, cell = new Map();   // hücre → [sx, sy, z, merkez uzaklığı]
      const mode = o.elevLabels;
      const selOnly = mode === 'sel';
      if (!selOnly || (host.sel && host.sel.size)) {
        for (let i = 0; i < nv; i++) {
          if (selOnly && !host.sel.has(P[i])) continue;
          const vx = A[i * 3], vy = A[i * 3 + 1], vz = A[i * 3 + 2];
          if (cl && (selOnly ? (vz < cl[2] || vz > cl[5]) : (vx < cl[0] || vy < cl[1] || vz < cl[2] || vx > cl[3] || vy > cl[4] || vz > cl[5]))) continue;
          const z = vz * zs, w = m[3] * vx + m[7] * vy + m[11] * z + m[15];
          const pz = (m[2] * vx + m[6] * vy + m[10] * z + m[14]) / w; if (pz < -1 || pz > 1) continue;
          const sx = ((m[0] * vx + m[4] * vy + m[8] * z + m[12]) / w + 1) / 2 * W, sy = (1 - (m[1] * vx + m[5] * vy + m[9] * z + m[13]) / w) / 2 * H;
          if (sx < 0 || sy < 0 || sx > W || sy > H) continue;   // ekran dışı etiket çizilmez (hücre anahtarı da negatif olmaz)
          const k = Math.round(sy / 8) * cols + Math.round(sx / 8), d = selOnly ? 0 : Math.hypot(sx - W / 2, sy - H / 2);
          const cur = cell.get(k); if (!cur) cell.set(k, [sx, sy, vz, d]); else if (d < cur[3]) { cur[0] = sx; cur[1] = sy; cur[2] = vz; cur[3] = d; }
        }
      }
      const items = [...cell.values()]; if (!selOnly) items.sort((a, b) => a[3] - b[3]);
      let n = 0;
      for (const it of items) {
        const txt = f(it[2]); const w = c.measureText(txt).width + 6;
        c.fillStyle = boxBg; c.fillRect(it[0] + 4, it[1] - 16, w, 15); c.fillStyle = fg; c.fillText(txt, it[0] + 7, it[1] - 15);
        c.fillStyle = accent; c.fillRect(it[0] - 2, it[1] - 2, 4, 4);
        if (++n >= 150) break;
      }
    }
    c.restore();
  }
}
const IDENT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// çizgi kalınlığı: NDC ofsetli tekrar geçişler, dizin = cihaz pikseli genişlik (1..4)
const LINE_OFFS = { 1: [[0, 0]], 2: [[0, 0], [1, 0], [0, 1], [1, 1]], 3: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2]], 4: [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [3, 0], [0, 3]] };
