/*
 * Araç durum makineleri: çizim, düzenleme ve ölçüm.
 *
 * ToolManager, uygulamadan bir "api" nesnesi alır:
 *   snap(w) → {p:[x,y,z],kind}|null    pick(w) → prim|null      sel: Set<prim>
 *   prompt(text, opts)   → komut satırı metni ve giriş alanı ({input:'point'|'number'|'text'|null, buttons:[…]})
 *   run(cmd)             → EditDoc.run
 *   render()  overlay()  toast(msg)  result(rows)  layer()  color()
 *   visiblePrims()  allPrims()  copy(metin)  lonLat(x,y)  textHeight()
 *   fmt(v)   units()     unitToM()   trackClear() (nokta belirlenince edinilmiş iz noktaları silinir)
 * Nokta girişi: dokunma (yakalamalı) ya da yazılı: "x,y" | "x,y,z" | "@dx,dy" | "@L<açı"
 */
import { TAU, flatten, polyArea, pathLength, pathLength3, segDist, opsBBox, enclosingPrim, segmentsOf, segAt, trimPath, extendPath, lengthenPath, filletCorner, chamferCorner, cornerAt, segIntersect, pointInPoly, pathPointsAt, pathFramesAt, traceBoundary, cutterSegs, trimRegion } from './geom.js';
import { newId, offsetPoints } from './edit.js';
import { alignMatrix } from './blocks.js';
import { t, addStrings } from './i18n.js';
import { askText, askForm, askConfirm } from './dialog.js';
import { sepOf } from './state.js';
import { dimLinear, dimRadial, dimAngular, leaderEnts, cloudEnt, balloonEnts, arrayItems, hatchEnts, autoDimStyle } from './annot.js';
import { cmdOf } from './acad.js';
import { constrain as deskConstrain } from './desktop.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;

export const TOOLS = {
  // çizim  (name/steps Türkçe; en/stepsEn İngilizce — sözlüğe tool_<ad> / tstep_<ad>_<i> anahtarlarıyla kaydedilir)
  line: { name: 'Çizgi', en: 'Line', steps: ['Birinci noktayı seçin', 'İkinci noktayı seçin (devam eder)'], stepsEn: ['Pick the first point', 'Pick the second point (continues)'] },
  pline: { name: 'Polyline', en: 'Polyline', steps: ['Birinci noktayı seçin', 'Sonraki noktayı seçin · Bitir / Kapat'], stepsEn: ['Pick the first point', 'Pick the next point · Finish / Close'] },
  rect: { name: 'Dikdörtgen', en: 'Rectangle', steps: ['Birinci köşeyi seçin', 'Karşı köşeyi seçin'], stepsEn: ['Pick the first corner', 'Pick the opposite corner'] },
  circle: { name: 'Daire', en: 'Circle', steps: ['Merkezi seçin', 'Yarıçap noktasını seçin ya da yarıçapı yazın'], stepsEn: ['Pick the center', 'Pick a radius point or type the radius'] },
  arc3: { name: 'Yay (3 nokta)', en: 'Arc (3 points)', steps: ['Başlangıç noktası', 'Yay üzerinde bir nokta', 'Bitiş noktası'], stepsEn: ['Start point', 'A point on the arc', 'End point'] },
  point: { name: 'Nokta', en: 'Point', steps: ['Noktayı seçin'], stepsEn: ['Pick the point'] },
  text: { name: 'Yazı', en: 'Text', steps: ['Yazı konumunu seçin'], stepsEn: ['Pick the text position'] },
  pline3d: { name: '3B Polyline', en: '3D Polyline', steps: ['Birinci noktayı seçin (kot sorulur)', 'Sonraki noktayı seçin · Bitir'], stepsEn: ['Pick the first point (elevation is asked)', 'Pick the next point · Finish'] },
  face3d: { name: '3B Yüzey', en: '3D Face', steps: ['1. köşe', '2. köşe', '3. köşe', '4. köşe (isteğe bağlı) · Bitir'], stepsEn: ['Vertex 1', 'Vertex 2', 'Vertex 3', 'Vertex 4 (optional) · Finish'] },
  // düzenleme
  select: { name: 'Seç', en: 'Select', steps: ['Dokun · sürükle → pencere ← kesen'], stepsEn: ['Tap · drag → window ← crossing'] },   // tek satır: komut çubuğu iki satırı aşmasın
  move: { name: 'Taşı', en: 'Move', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Hedef nokta (ya da @dx,dy)'], stepsEn: ['Select objects · Finish', 'Base point', 'Target point (or @dx,dy)'] },
  copy: { name: 'Kopyala', en: 'Copy', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Hedef nokta (yineler) · Bitir'], stepsEn: ['Select objects · Finish', 'Base point', 'Target point (repeats) · Finish'] },
  rotate: { name: 'Döndür', en: 'Rotate', steps: ['Nesneleri seçin · Bitir', 'Dönme merkezi', 'Açıyı yazın (°) ya da ikinci noktayı seçin'], stepsEn: ['Select objects · Finish', 'Rotation center', 'Type the angle (°) or pick a second point'] },
  scale: { name: 'Ölçekle', en: 'Scale', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Çarpanı yazın'], stepsEn: ['Select objects · Finish', 'Base point', 'Type the factor'] },
  mirror: { name: 'Aynala', en: 'Mirror', steps: ['Nesneleri seçin · Bitir', 'Ayna çizgisi 1. nokta', 'Ayna çizgisi 2. nokta'], stepsEn: ['Select objects · Finish', 'Mirror line point 1', 'Mirror line point 2'] },
  // Ekran / Ölçü soran araçlar (MODE_TOOLS): steps Ekran kipinin, stepsVal Ölçü kipinin adımlarıdır (tstep_<ad>_v<i>)
  offset: { name: 'Ofset', en: 'Offset', steps: ['Nesneye dokunun', 'Geçiş noktasına dokunun (kopya buradan geçer)'], stepsEn: ['Tap the object', 'Tap the through point (the copy passes through it)'], stepsVal: ['Nesneye dokunun', 'Tarafı seçin (nokta)'], stepsValEn: ['Tap the object', 'Pick the side (point)'] },
  del: { name: 'Sil', en: 'Delete', steps: ['Nesneleri seçin · Bitir'], stepsEn: ['Select objects · Finish'] },
  setz: { name: 'Kot ata', en: 'Set Z', steps: ['Nesneleri seçin · Bitir', 'Kotu (Z) yazın'], stepsEn: ['Select objects · Finish', 'Type the elevation (Z)'] },
  edittext: { name: 'Yazı düzenle', en: 'Edit text', steps: ['Yazıya dokunun'], stepsEn: ['Tap the text'] },
  dimedit: { name: 'Ölçüyü düzenle', en: 'Edit dimension', steps: ['Ölçüye dokunun'], stepsEn: ['Tap a dimension'] },
  // ölçüm
  dist: { name: 'Mesafe', en: 'Distance', steps: ['Noktalara dokunun'], stepsEn: ['Tap points'] },
  area: { name: 'Alan', en: 'Area', steps: ['Köşelere dokunun · Bitir'], stepsEn: ['Tap vertices · Finish'] },
  angle: { name: 'Açı', en: 'Angle', steps: ['Köşe (tepe) noktası', 'Birinci kol noktası', 'İkinci kol noktası'], stepsEn: ['Vertex point', 'First arm point', 'Second arm point'] },
  radius: { name: 'Yarıçap', en: 'Radius', steps: ['Daire ya da yaya dokunun'], stepsEn: ['Tap a circle or arc'] },
  coord: { name: 'Koordinat', en: 'Coordinate', steps: ['Noktaya dokunun'], stepsEn: ['Tap a point'] },
  fillarea: { name: 'Dolgu alanı', en: 'Fill area', steps: ['Kapalı alanın içine dokunun'], stepsEn: ['Tap inside a closed area'] },
  ident: { name: 'Akıllı ölçüm', en: 'Smart measure', steps: ['Nesneye dokunun'], stepsEn: ['Tap an object'] },
  // ölçülendirme ve açıklama
  dim: { name: 'Doğrusal ölçü', en: 'Linear dimension', steps: ['Birinci ölçü noktası', 'İkinci ölçü noktası', 'Ölçü çizgisinin yerini seçin'], stepsEn: ['First extension point', 'Second extension point', 'Pick the dimension line position'] },
  dimh: { name: 'Yatay ölçü', en: 'Horizontal dimension', steps: ['Birinci ölçü noktası', 'İkinci ölçü noktası', 'Ölçü çizgisinin yerini seçin'], stepsEn: ['First extension point', 'Second extension point', 'Pick the dimension line position'] },
  dimv: { name: 'Düşey ölçü', en: 'Vertical dimension', steps: ['Birinci ölçü noktası', 'İkinci ölçü noktası', 'Ölçü çizgisinin yerini seçin'], stepsEn: ['First extension point', 'Second extension point', 'Pick the dimension line position'] },
  dimr: { name: 'Yarıçap ölçüsü', en: 'Radius dimension', steps: ['Daire ya da yaya dokunun'], stepsEn: ['Tap a circle or arc'] },
  dimd: { name: 'Çap ölçüsü', en: 'Diameter dimension', steps: ['Daire ya da yaya dokunun'], stepsEn: ['Tap a circle or arc'] },
  dima: { name: 'Açı ölçüsü', en: 'Angular dimension', steps: ['Tepe (köşe) noktası', 'Birinci kol noktası', 'İkinci kol noktası'], stepsEn: ['Vertex point', 'First arm point', 'Second arm point'] },
  leader: { name: 'Açıklama', en: 'Leader note', steps: ['Ok ucunu seçin', 'Kırılma noktası seçin · Bitir'], stepsEn: ['Pick the arrow tip', 'Pick a bend point · Finish'] },
  cloud: { name: 'Revizyon bulutu', en: 'Revision cloud', steps: ['Köşeleri seçin · Bitir'], stepsEn: ['Pick the corners · Finish'] },
  balloon: { name: 'Numaralandırma', en: 'Numbering', steps: ['Balon konumunu seçin (numara artarak sürer)'], stepsEn: ['Pick the balloon position (the number keeps increasing)'] },
  hatch: { name: 'Tarama', en: 'Hatch', steps: ['Doldurulacak kapalı alanın içine dokunun'], stepsEn: ['Tap inside the closed area to fill'] },
  // düzenleme
  array: { name: 'Dizi', en: 'Array', steps: ['Nesneleri seçin · Bitir', 'Dizi türünü seçin'], stepsEn: ['Select objects · Finish', 'Choose the array type'] },
  arrayrect: { name: 'Dikdörtgen dizi', en: 'Rectangular array', steps: ['Nesneleri seçin · Bitir', 'Sütun, satır ve aralıkları yazın'], stepsEn: ['Select objects · Finish', 'Type columns, rows and spacing'] },
  arraypolar: { name: 'Kutupsal dizi', en: 'Polar array', steps: ['Nesneleri seçin · Bitir', 'Dizinin merkez noktasını seçin'], stepsEn: ['Select objects · Finish', 'Pick the center point of the array'] },
  arraypath: { name: 'Yol dizisi', en: 'Path array', steps: ['Nesneleri seçin · Bitir', 'Yola dokunun (dizi dokunulan uçtan başlar)'], stepsEn: ['Select objects · Finish', 'Tap the path (the array starts at the tapped end)'] },
  thick: { name: 'Kalınlık', en: 'Thickness', steps: ['Nesneleri seçin · Bitir', 'Yüksekliği yazın'], stepsEn: ['Select objects · Finish', 'Type the height'] },
  textsize: { name: 'Yazı yüksekliği', en: 'Text height', steps: ['Yazıları seçin · Bitir', 'Yüksekliği yazın'], stepsEn: ['Select texts · Finish', 'Type the height'] },
  explode: { name: 'Patlat', en: 'Explode', steps: ['Blok yerleştirmesine dokunun'], stepsEn: ['Tap a block insertion'] },
  attr: { name: 'Öznitelik düzenle', en: 'Edit attributes', steps: ['Blok yerleştirmesine dokunun'], stepsEn: ['Tap a block insertion'] },
  trim: { name: 'Buda', en: 'Trim', steps: ['Kesici kenara dokunun', 'Atılacak parçaya dokunun (sürer)'], stepsEn: ['Tap the cutting edge', 'Tap the piece to remove (repeats)'], stepsVal: ['Kısaltılacak uca dokunun (sürer)'], stepsValEn: ['Tap the end to shorten (repeats)'] },
  extend: { name: 'Uzat', en: 'Extend', steps: ['Sınıra dokunun', 'Uzatılacak uca dokunun (sürer)'], stepsEn: ['Tap the boundary', 'Tap the end to extend (repeats)'], stepsVal: ['Uzatılacak uca dokunun (sürer)'], stepsValEn: ['Tap the end to lengthen (repeats)'] },
  fillet: { name: 'Kavis', en: 'Fillet', steps: ['Birinci doğruya dokunun', 'İkinci doğruya dokunun', 'Kavisin geçeceği noktaya dokunun · ya da yarıçapı yazın'], stepsEn: ['Tap the first line', 'Tap the second line', 'Tap where the arc should pass · or type the radius'], stepsVal: ['Birinci doğruya dokunun', 'İkinci doğruya dokunun'], stepsValEn: ['Tap the first line', 'Tap the second line'] },
  chamfer: { name: 'Pah', en: 'Chamfer', steps: ['Birinci doğruya dokunun', 'İkinci doğruya dokunun', 'Pahın geçeceği noktaya dokunun · ya da mesafeyi yazın'], stepsEn: ['Tap the first line', 'Tap the second line', 'Tap where the chamfer should pass · or type the distance'], stepsVal: ['Birinci doğruya dokunun', 'İkinci doğruya dokunun'], stepsValEn: ['Tap the first line', 'Tap the second line'] },
  // sık kullanılan AutoCAD komutları (v7.67): POLYGON · DIVIDE · MEASURE · JOIN · MATCHPROP · STRETCH · BOUNDARY
  polygon: { name: 'Çokgen', en: 'Polygon', steps: ['Kenar sayısını yazın (3-1024)', 'Merkezi seçin', 'Köşe noktasını seçin ya da yarıçapı yazın'], stepsEn: ['Type the number of sides (3-1024)', 'Pick the center', 'Pick a vertex point or type the radius'] },
  divide: { name: 'Böl', en: 'Divide', steps: ['Bölünecek yola dokunun', 'Parça sayısını yazın'], stepsEn: ['Tap the path to divide', 'Type the number of segments'] },
  measure: { name: 'Aralıkla', en: 'Measure', steps: ['Yola dokunun (noktalar dokunulan uçtan başlar)', 'Aralık uzunluğunu yazın'], stepsEn: ['Tap the path (points start from the tapped end)', 'Type the spacing'] },
  join: { name: 'Birleştir', en: 'Join', steps: ['Uçları değen yolları seçin · Bitir'], stepsEn: ['Select paths whose ends touch · Finish'] },
  matchprop: { name: 'Özellik eşle', en: 'Match properties', steps: ['Kaynak nesneye dokunun', 'Hedef nesnelere dokunun (sürer) · Bitir'], stepsEn: ['Tap the source object', 'Tap the target objects (repeats) · Finish'] },
  stretch: { name: 'Esnet', en: 'Stretch', steps: ['Kesen pencereyle seçin (sağdan sola sürükleyin) · Bitir', 'Taban noktası', 'Hedef nokta (ya da @dx,dy)'], stepsEn: ['Select with a crossing window (drag right to left) · Finish', 'Base point', 'Target point (or @dx,dy)'] },
  boundary: { name: 'Sınır', en: 'Boundary', steps: ['Kapalı alanın içine dokunun (sürer)'], stepsEn: ['Tap inside a closed area (repeats)'] },
  // v7.72 — blok ailesi: ALIGN · BLOCK · INSERT · BEDIT · REFEDIT · ATTDEF · BASE · NCOPY · BPARAMETER · BVSTATE · XCLIP; WIPEOUT · DRAWORDER
  align: { name: 'Hizala', en: 'Align', steps: ['Nesneleri seçin · Bitir', '1. kaynak noktası', '1. hedef noktası', '2. kaynak noktası · ya da Bitir (yalnız taşı)', '2. hedef noktası'], stepsEn: ['Select objects · Finish', '1st source point', '1st destination point', '2nd source point · or Finish (move only)', '2nd destination point'] },
  block: { name: 'Blok yap', en: 'Block', steps: ['Nesneleri seçin · Bitir', 'Taban noktasını seçin'], stepsEn: ['Select objects · Finish', 'Pick the base point'] },
  insert: { name: 'Blok ekle', en: 'Insert', steps: ['Blok, ölçek ve dönüşü seçin', 'Ekleme noktasını seçin'], stepsEn: ['Choose the block, scale and rotation', 'Pick the insertion point'] },
  bedit: { name: 'Blok düzenle', en: 'Block editor', steps: ['Blok yerleştirmesine dokunun (ya da Bloklar panelinden seçin)'], stepsEn: ['Tap a block insertion (or pick it in the Blocks panel)'] },
  refedit: { name: 'Yerinde düzenle', en: 'Edit reference', steps: ['Yerinde düzenlenecek blok yerleştirmesine dokunun'], stepsEn: ['Tap the block insertion to edit in place'] },
  attdef: { name: 'Öznitelik tanımı', en: 'Attribute definition', steps: ['Öznitelik konumunu seçin'], stepsEn: ['Pick the attribute position'] },
  wipeout: { name: 'Maske', en: 'Wipeout', steps: ['Maske köşelerini seçin · Bitir', 'Sonraki köşe · Bitir / Kapat'], stepsEn: ['Pick the wipeout corners · Finish', 'Next corner · Finish / Close'] },
  draworder: { name: 'Çizim sırası', en: 'Draw order', steps: ['Nesneleri seçin · Bitir', 'Başvuru nesnesine dokunun'], stepsEn: ['Select objects · Finish', 'Tap the reference object'] },
  ncopy: { name: 'İçten kopyala', en: 'Copy nested', steps: ['Blok ya da referans içindeki nesneye dokunun (kopyası çizime girer)'], stepsEn: ['Tap an object inside a block or xref (a copy is added to the drawing)'] },
  base: { name: 'Taban noktası', en: 'Base point', steps: ['Taban noktasını seçin'], stepsEn: ['Pick the base point'] },
  bparam: { name: 'Blok parametresi', en: 'Block parameter', steps: ['Etkilenecek nesneleri seçin · Bitir (boş = hepsi)', 'Parametre noktasını seçin'], stepsEn: ['Select the affected objects · Finish (empty = all)', 'Pick the parameter point'] },
  bvstate: { name: 'Görünürlük durumu', en: 'Visibility state', steps: ['Nesneleri seçin · Bitir', 'Durumu seçin'], stepsEn: ['Select objects · Finish', 'Choose the state'] },
  xclip: { name: 'Referans kırp', en: 'Clip xref', steps: ['Harici referansa dokunun', 'Kırpma penceresinin 1. köşesi', 'Karşı köşe'], stepsEn: ['Tap the external reference', 'First corner of the clip window', 'Opposite corner'] },
};
/*
 * İngilizce arayüzde araç adı AutoCAD komut adıdır (LINE, TRIM, ERASE…): hedef kullanıcı
 * AutoCAD kaslıdır ve "Delete" yazan bir düğmeyi ERASE ile bağdaştırmakta zorlanır. Ad tek
 * kaynaktan, acad.js'ten gelir; burada yazılmaz. Türkçe ad olduğu gibi kalır.
 */
{ const tr = {}, en = {}; for (const [k, d] of Object.entries(TOOLS)) { tr['tool_' + k] = d.name; en['tool_' + k] = cmdOf('t:' + k) || d.en || d.name; d.steps.forEach((st, i) => { tr[`tstep_${k}_${i}`] = st; en[`tstep_${k}_${i}`] = (d.stepsEn && d.stepsEn[i]) || st; }); (d.stepsVal || []).forEach((st, i) => { tr[`tstep_${k}_v${i}`] = st; en[`tstep_${k}_v${i}`] = (d.stepsValEn && d.stepsValEn[i]) || st; }); } addStrings(tr, en); }
/*
 * Araç kimliklerinin listesi. acad.js'teki AutoCAD komut tablosu bu adlara bağlanır; yanlış
 * yazılmış bir kimlik sessizce hiçbir şey yapmaz, o yüzden sınama ikisini burada karşılaştırır
 * (measure3d'nin ROW_KEYS'i ile aynı gerekçe: yapısal körlüğü kapatmak).
 */
export const TOOL_IDS = Object.keys(TOOLS);
const toolName = (k) => t('tool_' + k);
const toolStep = (k, i) => t(`tstep_${k}_${i}`);
/** Ölçü kipinin adımı (stepsVal); araçta Ölçü adımı yoksa Ekran adımı */
const toolStepVal = (k, i) => (TOOLS[k] && TOOLS[k].stepsVal && TOOLS[k].stepsVal.length ? t(`tstep_${k}_v${i}`) : toolStep(k, i));
const SELECT_TOOLS = new Set(['move', 'copy', 'rotate', 'scale', 'mirror', 'del', 'setz', 'array', 'arrayrect', 'arraypolar', 'arraypath', 'thick', 'textsize', 'stretch', 'join', 'align', 'block', 'draworder', 'bparam', 'bvstate']);
/** Dizi ailesi (AutoCAD ARRAY, ARRAYRECT, ARRAYPOLAR, ARRAYPATH): seçim bitince tür / merkez / yol adımına geçer */
const ARRAY_TOOLS = new Set(['array', 'arrayrect', 'arraypolar', 'arraypath']);
/*
 * EKRAN / ÖLÇÜ SORAN ARAÇLAR. Değer isteyen düzenleme araçları nesne seçilmeden ÖNCE sorar:
 * Ekran → değer çizimde dokunarak verilir (ötelede geçiş noktası, kavis / pahta yayın geçeceği nokta,
 * buda / uzatta kesici kenar ya da sınır); Ölçü → değer önce yazılır, sonra nesne seçilir. Dokunmak
 * Ekran'ı, sayı yazmak Ölçü'yü seçmiş sayılır — soru akışı kesmez. Değer: Ölçü kipinde istenen sayının
 * istem anahtarı. Buda / uzatta Ölçü kipi AutoCAD LENGTHEN DElta'sıdır (yazılan boy kadar kısalt / uzat).
 */
const MODE_TOOLS = { offset: 'typeDist', fillet: 'filletRadius', chamfer: 'chamferDist', trim: 'trimLen', extend: 'extendLen' };
/*
 * DOĞRUDAN UZAKLIK GİRİŞİ (AutoCAD direct distance entry) — Çizgi ve Polyline'da bir taban nokta varken kutuya
 * yazılan tek sayı bir UZUNLUKTUR: sonraki dokunuş yalnız YÖNÜ verir, nokta tabandan o yönde o kadar ileride
 * alınır. Kutudaki sayı dokunma anında okunur (Enter gerekmez); Enter'la da bekletilir ve istem yönü ister.
 * Ortho / kutupsal yönü kısıtlar. Virgüllü sayı ("500,360") nokta isteminde koordinattır, uzunluk değil.
 */
const DIRECT_DIST_TOOLS = new Set(['line', 'pline']);
const LEN_RE = /^[-+]?\d+(\.\d+)?$/;
/** Sayı girişi bekleyen araçlar ve hangi adımda beklediği — TEK kaynak (say / typed / tap buraya bakar) */
const NUMBER_STEP = { circle: 1, rotate: 2, scale: 2, setz: 1, thick: 1, textsize: 1, polygon: 2, divide: 1, measure: 1 };
/** Nokta değil NESNE (ya da kapalı alan) seçilerek çalışan araçlar */
const OBJECT_TOOLS = new Set(['radius', 'edittext', 'dimedit', 'dimr', 'dimd', 'explode', 'attr', 'hatch', 'fillarea', 'ident', 'trim', 'extend', 'fillet', 'chamfer', 'offset', 'divide', 'measure', 'matchprop', 'boundary', 'arraypath', 'bedit', 'refedit', 'ncopy']);
/** Çok noktalı ölçülendirme / açıklama araçları: taslakları çizgi olarak gösterilir */
/** Renk indeksi: 0 bloktan, 1-255 ACI, 256 katmandan (null / -1 / taşkın → 256) — scene.normCi ile aynı kural */
const normColor = (ci) => (ci === 0 ? 0 : ci >= 1 && ci <= 255 ? ci : 256);
const PATH_TOOLS = new Set(['dim', 'dimh', 'dimv', 'dima', 'leader', 'cloud']);
/** Sonraki numara: sayıysa artar, harfle bitiyorsa harf ilerler ("A1"→"A2", "B"→"C") */
function nextLabel(sN) {
  const m = String(sN).match(/^(.*?)(\d+)$/);
  if (m) return m[1] + String(parseInt(m[2], 10) + 1);
  const c = String(sN).trim();
  if (/^[A-Za-z]$/.test(c)) return String.fromCharCode(c.charCodeAt(0) + 1);
  return c + '2';
}

/*
 * BÖLGE SEÇİMİ (AutoCAD pencere / kesen kuralı). Pencere: nesne bölgenin TAMAMEN içinde olmalı;
 * kesen: bölgeye dokunan her nesne girer. Dikdörtgende pencere sınaması kutu kutusu ile kesindir;
 * çokgende kutu köşeleri çokgenin içinde ve hiçbir kenar çokgen kenarını kesmiyorsa içeridedir.
 * Kesen sınaması yolun kendi parçalarına bakar (kutu değil): çapraz bir çizgi, kutusu bölgeye
 * değdiği hâlde kendisi değmiyorsa seçilmez.
 */
const bboxInRect = (bb, r) => bb[0] >= r[0] && bb[1] >= r[1] && bb[2] <= r[2] && bb[3] <= r[3];
const bboxHitsRect = (bb, r) => !(bb[2] < r[0] || bb[0] > r[2] || bb[3] < r[1] || bb[1] > r[3]);
const inRect = (q, r) => q[0] >= r[0] && q[0] <= r[2] && q[1] >= r[1] && q[1] <= r[3];
function primPts(p) { const pts = p.k === 0 ? flatten(p.ops) : [[p.bb[0], p.bb[1]], [p.bb[2], p.bb[1]], [p.bb[2], p.bb[3]], [p.bb[0], p.bb[3]]]; if (pts.length && (p.k !== 0 || p.closed)) pts.push(pts[0]); return pts; }
function primCrossesRect(p, r) {
  if (!bboxHitsRect(p.bb, r)) return false;
  if (p.k !== 0) return true;
  const pts = primPts(p), edges = [[r[0], r[1], r[2], r[1]], [r[2], r[1], r[2], r[3]], [r[2], r[3], r[0], r[3]], [r[0], r[3], r[0], r[1]]];
  for (let i = 0; i < pts.length; i++) {
    if (inRect(pts[i], r)) return true;
    if (i) { const s = [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]; for (const e of edges) if (segIntersect(s, e)) return true; }
  }
  return !!(p.closed && pts.length > 2 && pointInPoly(pts, r[0], r[1]));   // bölge kapalı yolun içinde kalıyor
}
function polyEdges(poly) { const e = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; e.push([a[0], a[1], b[0], b[1]]); } return e; }
function primCrossesPoly(p, poly) {
  const pts = primPts(p), edges = polyEdges(poly);
  for (let i = 0; i < pts.length; i++) {
    if (pointInPoly(poly, pts[i][0], pts[i][1])) return true;
    if (i) { const s = [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]; for (const e of edges) if (segIntersect(s, e)) return true; }
  }
  return !!(p.k === 0 && p.closed && pts.length > 2 && pointInPoly(pts, poly[0][0], poly[0][1]));
}
function primInPoly(p, poly) {
  const bb = p.bb;
  if (![[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].every(c => pointInPoly(poly, c[0], c[1]))) return false;
  if (p.k !== 0) return true;
  const pts = primPts(p), edges = polyEdges(poly);
  for (let i = 1; i < pts.length; i++) { const s = [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]; for (const e of edges) if (segIntersect(s, e)) return false; }
  return true;
}

export class ToolManager {
  constructor(api) {
    this.api = api;
    this.active = null;
    this.selMode = 'tap';   // seç aracı: 'tap' dokunarak · 'box' pencere / kesen kutu · 'lasso' çokgen
    this.pts = [];       // toplanan noktalar [x,y,z]
    this.step = 0;
    this.selecting = false;
    this.last = null;    // son nokta (göreli giriş için)
    this.number = null;
    this.draft = null;   // kaplama için önizleme: { segs:[[p,q]…], pts:[…], circle:{c,r}, text }
    this.results = [];
    this.mode = null;    // Ekran / Ölçü soran araçlarda seçilen kip: null (sorulmadı) · 'screen' · 'value'
    this.val = null;     // Ölçü kipinde yazılan değer
    this.lastVal = {};   // araç başına son değer: bir sonraki istemde <öntanımlı> olarak sunulur, boş Enter onu alır
  }
  get running() { return !!this.active; }

  start(name) {
    const def = TOOLS[name];
    if (!def) return;
    this.cancel(true);
    this.active = name; this.pts = []; this.step = 0; this.draft = null; this.results = []; this.balloonNext = null;
    this.cut = null; this.c1 = null; this.corner = null; this.selMode = 'tap'; this.mode = null; this.val = null;
    this.pendLen = null;      // doğrudan uzaklık: Enter'la bekletilen uzunluk (Çizgi / Polyline)
    this.mirrorKeep = true;   // AutoCAD MIRROR "Erase source objects? <N>": her başlangıçta orijinal kalır; komut çubuğundaki düğme değiştirir
    this.mirrorAxis = null;   // 'x' | 'y': ayna çizgisi eksene paralel, tek noktayla (AutoCAD'de ikinci noktada ORTHO'nun karşılığı)
    this.sides = null;        // çokgen: kenar sayısı (boş Enter = son değer ya da 6)
    this.src = null;          // özellik eşle: kaynak nesnenin katman / renk / çizgi tipi
    this.region = null;       // esnet: kesen pencere (dünya) — içindeki köşeler taşınır
    this.ins = null;          // blok ekle: formdan gelen ad / ölçek / dönüş / satır-sütun
    this.dro = null;          // çizim sırası: seçilen kip (above / below başvuru nesnesi bekler)
    this.wipePoly = false;    // maske: polyline'dan (kapalı yola dokunulur)
    this.alignScale = false;  // hizala: nesneler hizalama noktalarına göre ölçeklensin mi (AutoCAD "Scale objects…? <N>")
    this.prm = null;          // blok parametresi: form sonucu ve toplanan noktalar
    this.xref = null;         // referans kırp: dokunulan referansın adı
    if (SELECT_TOOLS.has(name)) {
      this.selecting = this.api.sel.size === 0;
      if (!this.selecting) { this.step = 1; }
    }
    if (name === 'select') this.selecting = true;
    if (name === 'stretch') this.selMode = 'box';   // AutoCAD STRETCH pencere ister: seçim doğrudan kutu kipinde başlar (sağdan sola = kesen)
    if (ARRAY_TOOLS.has(name) && !this.selecting) { void this.arrayNext(); return; }   // seçim hazırsa dizi hemen sorar: tür / merkez / yol
    if (name === 'insert') { void this.insertStart(); return; }                          // blok, ölçek, dönüş önce sorulur; sonra ekleme noktası
    if (name === 'draworder' && !this.selecting) { void this.drawOrderNext(); return; }
    if (name === 'bparam' && !this.selecting) { void this.bparamNext(); return; }
    if (name === 'bvstate' && !this.selecting) { void this.bvstateNext(); return; }
    this.say();
  }
  cancel(silent) {
    if (this.active && this.active !== 'select' && this.pts.length && ['pline', 'pline3d', 'face3d', 'area', 'cloud'].includes(this.active)) this.finish();
    this.active = null; this.pts = []; this.step = 0; this.draft = null; this.selecting = false; this.cut = null; this.c1 = null; this.corner = null; this.selMode = 'tap'; this.mode = null; this.val = null; this.pendLen = null;
    this.ins = null; this.dro = null; this.wipePoly = false; this.prm = null; this.xref = null;
    if (this.api.trackClear) this.api.trackClear();   // edinilmiş iz noktaları araçla birlikte gider
    if (!silent) { this.api.prompt(null); this.api.overlay(); }
  }
  say() {
    const def = TOOLS[this.active];
    if (!def) return;
    let text = toolName(this.active) + ': ';
    if (MODE_TOOLS[this.active]) {
      // Ekran / Ölçü sorusu → (Ölçü ise) değer istemi → aracın kendi adımları. Kip düğmeleri araç boyunca kalır.
      const last = this.lastVal[this.active];
      const hint = last != null ? ` <${this.api.fmt(last)}>` : '';
      if (!this.mode) text += t('modeAsk') + hint;
      else if (this.mode === 'value' && this.val == null) text += t(MODE_TOOLS[this.active]) + hint;
      else if (this.mode === 'value') text += toolStepVal(this.active, Math.min(this.step, (def.stepsVal || def.steps).length - 1));
      else text += toolStep(this.active, Math.min(this.step, def.steps.length - 1));
      // giriş alanı: soruda ve değer isteminde sayı; kavis / pahın nokta adımında sayı (yarıçap) — koordinat da yazılabilir;
      // ötelenin geçiş / taraf noktasında koordinat (sayı yazılırsa mesafe olur)
      const num = !this.mode || (this.mode === 'value' && this.val == null) || (this.wantsPoint() && this.active !== 'offset');
      // Ölçü seçildi ve değer isteniyor: yalnız sayı beklenir → giriş alanı odaklanır, klavye kendiliğinden açılır.
      // Soru adımında odaklanmaz: dokunmak Ekran'ı seçer, klavye çizimi örtmemeli.
      this.api.prompt(text, { input: num ? 'number' : 'point', buttons: ['modescreen', 'modevalue', 'cancel'], focus: this.mode === 'value' && this.val == null });
      return;
    }
    if (this.selecting) text += (this.selMode === 'box' ? t('selBoxHint') : this.selMode === 'lasso' ? t('selLassoHint') : toolStep(this.active, 0)) + `  [${this.api.objCount ? this.api.objCount() : this.api.sel.size} ${t('selCount')}]`;   // nesne sayısı: tek ölçü "1 seçili"dir, 4 değil
    else if (this.active === 'mirror' && this.mirrorAxis && !this.pts.length) text += t(this.mirrorAxis === 'x' ? 'mirrorAxisX' : 'mirrorAxisY');   // eksen seçildi: tek nokta yeter
    else if (this.active === 'wipeout' && this.wipePoly) text += t('wipePolyHint');   // polyline'dan maske: kapalı yola dokunulur
    else text += toolStep(this.active, Math.min(this.step, def.steps.length - 1));
    if (this.active === 'polygon' && this.step === 0) text += ` <${this.api.fmt(this.lastVal.polygon || 6, 0)}>`;   // AutoCAD <öntanımlı>: boş Enter son kenar sayısını alır
    if (this.active === 'hatch') { const hp = (this.api.hatchPattern && this.api.hatchPattern()) || null; if (hp) text += ' \u00b7 ' + (hp.name === 'SOLID' ? t('patSolid') : hp.name) + (hp.scale && hp.scale !== 1 ? ' \u00d7' + this.api.fmt(hp.scale) : '') + (hp.angle ? ' ' + this.api.fmt(hp.angle) + '\u00b0' : ''); }
    if (this.pendLen > 0 && DIRECT_DIST_TOOLS.has(this.active) && this.pts.length) text += ' \u00b7 ' + t('dirTapHint').replace('%s', this.api.fmt(this.pendLen));
    const sidesStep = this.active === 'polygon' && this.step === 0;   // kenar sayısı: sayı istemi, klavye açık; dokunuş öntanımlı kenar sayısıyla merkezi alır
    const wantsNumber = (NUMBER_STEP[this.active] != null && this.step === NUMBER_STEP[this.active] && !this.selecting) || sidesStep;
    const buttons = [];
    if (this.selecting || ['pline', 'pline3d', 'face3d', 'area', 'copy', 'line', 'dist', 'leader', 'cloud', 'wipeout'].includes(this.active) || (this.active === 'matchprop' && this.step === 1) || (this.active === 'align' && this.pts.length >= 2)) buttons.push('finish');
    // Seç aracında ölçü seçiliyse "Ölçü özellikleri" Bitir'in hemen yanında (kullanıcının ekranındaki çubuk)
    if (this.selecting && this.active === 'select' && [...this.api.sel].some(p => p.info && p.info.t === 'DIMENSION' && (p.info.gid || p.info.dim))) buttons.push('dimedit');
    if (['pline', 'area', 'cloud', 'wipeout'].includes(this.active) && this.pts.length > 2) buttons.push('close');
    if (this.active === 'wipeout' && !this.pts.length && !this.wipePoly) buttons.push('wipepoly');   // AutoCAD WIPEOUT "Polyline" seçeneği
    if (this.active === 'align' && !this.selecting) buttons.push('alignscale');                    // "Scale objects based on alignment points?"
    // AutoCAD'de HATCH komutu deseni kendi şeridinde sorar. Burada desen KOMUT ÇUBUĞUNDAN seçilir:
    // araç çalışırken "Desen" düğmesi seçiciyi açar, istemde geçerli desen adı yazar.
    if (this.active === 'hatch') buttons.push('hatchpat');

    if (this.pts.length) buttons.push('back');
    if (this.selecting) buttons.push('selbox', 'sellasso', 'selall');
    if (this.active === 'mirror' && !this.selecting) {
      if (!this.pts.length) buttons.push('mirrorx', 'mirrory');   // ilk noktadan önce: yatay (X) / düşey (Y) ayna çizgisi — sonra tek nokta yeter
      buttons.push('mirrorkeep');                                   // seçimden sonra: orijinal kalsın mı? (AutoCAD'in sondaki sorusu, düğme olarak)
    }
    buttons.push('cancel');
    // Yalnız sayı kabul eden adımlar (kot, kalınlık, yazı yüksekliği): giriş alanı odaklanır, klavye kendiliğinden açılır.
    // Döndür / ölçekle / daire yarıçapı nokta da kabul eder: orada klavye çizimi örtmesin diye odaklanmaz.
    const focus = wantsNumber && (['setz', 'thick', 'textsize', 'divide', 'measure'].includes(this.active) || sidesStep);
    // keepLen: Çizgi / Polyline'da kutuda duran tek sayı bir uzunluktur; istem tazelenince (ilk noktadan sonra) silinmesin
    this.api.prompt(text, { input: wantsNumber ? 'number' : (this.selecting ? null : 'point'), buttons, focus, keepLen: DIRECT_DIST_TOOLS.has(this.active) });
  }

  // ---- giriş -----------------------------------------------------------------------
  /** yazılı giriş: koordinat ya da sayı */
  typed(text) {
    const s = String(text).trim().replace(/,/g, (m, i, str) => (str.indexOf(',') !== str.lastIndexOf(',') || /\d,\d{1,3}$/.test(str) && !/,.*,/.test(str) && false) ? ',' : ',');
    if (!s) return;
    if (this.selecting) return;
    if (MODE_TOOLS[this.active]) {
      // Tek sayı yazmak her adımda değeri verir: soruda Ölçü'yü seçer, değer isteminde değeri alır, sonraki adımlarda
      // değeri değiştirir. Kavis / pahın Ekran kipindeki üçüncü adımında yazılan sayı doğrudan yarıçap / mesafedir;
      // ötelede taraf noktası beklenirken yazılan sayı mesafeyi değiştirir, seçili nesne bırakılmaz.
      // Soruda ve değer isteminde ondalık virgül de sayıdır ("12,5"); nokta ya da nesne beklenen adımlarda virgül
      // koordinat ayracıdır ("500,360" bir noktadır), sayı yalnız tam sayı ya da ondalık noktayla yazılır.
      const askingValue = !this.mode || (this.mode === 'value' && this.val == null);
      if (askingValue ? /^[-+]?\d+([.,]\d+)?$/.test(s) : /^[-+]?\d+(\.\d+)?$/.test(s)) {
        const v = parseFloat(s.replace(',', '.'));
        if (!(v > 0)) { this.api.toast(t('numberExpected')); return; }
        if (this.mode === 'screen' && this.wantsPoint() && (this.active === 'fillet' || this.active === 'chamfer')) { this.lastVal[this.active] = v; void this.cornerApply(v); return; }
        if (this.active === 'offset' && this.step === 1 && this.c1) { this.mode = 'value'; this.val = v; this.lastVal.offset = v; this.say(); return; }
        this.setValue(v);
        return;
      }
      if (!this.mode || (this.mode === 'value' && this.val == null)) { this.api.toast(t('numberExpected')); return; }   // soruda / değer isteminde sayı dışı giriş
    }
    if (this.active === 'polygon' && this.step === 0) {
      const n = parseInt(s, 10);
      if (!(n >= 3 && n <= 1024) || String(n) !== s.trim()) { this.api.toast(t('polygonSides')); return; }
      this.sides = n; this.lastVal.polygon = n; this.step = 1; this.say(); this.api.overlay();
      return;
    }
    if (NUMBER_STEP[this.active] != null && this.step === NUMBER_STEP[this.active]) {
      const v = parseFloat(s.replace(',', '.'));
      if (!isFinite(v)) { this.api.toast(t('numberExpected')); return; }
      this.number = v;
      this.onNumber(v);
      return;
    }
    if (DIRECT_DIST_TOOLS.has(this.active) && this.pts.length && LEN_RE.test(s)) {
      const v = parseFloat(s);
      if (!(v > 0)) { this.api.toast(t('numberExpected')); return; }
      this.pendLen = v; this.say(); this.api.overlay();
      return;
    }
    const p = this.parsePoint(s);
    if (!p) { this.api.toast(t('coordFormat')); return; }
    void this.point(p, null);
  }
  /** Bekleyen uzunluk: Enter'la bekletilen ya da kutuda o an yazılı duran tek sayı (> 0), yoksa 0 */
  directLen() {
    if (this.pendLen > 0) return this.pendLen;
    const s = this.api.input ? String(this.api.input() || '').trim() : '';
    if (!LEN_RE.test(s)) return 0;
    const v = parseFloat(s);
    return v > 0 ? v : 0;
  }
  /**
   * Doğrudan uzaklık noktası: taban (son nokta) + uzunluk × dokunuş yönü. Yön önce ortho / kutupsal kısıtından
   * geçer; dokunuş bir noktaya yakalandıysa yön o noktaya doğrudur. Uzunluk yoksa, taban yoksa ya da dokunuş
   * tabanın üstündeyse null: dokunuş olağan nokta olarak işlenir.
   */
  directPoint(p, sn) {
    if (!DIRECT_DIST_TOOLS.has(this.active) || !this.pts.length) return null;
    const L = this.directLen(); if (!(L > 0)) return null;
    const base = this.pts[this.pts.length - 1];
    const q = this.kisitla(p, sn);
    const dx = q[0] - base[0], dy = q[1] - base[1], d = Math.hypot(dx, dy);
    if (!(d > 1e-9)) return null;
    return [base[0] + dx / d * L, base[1] + dy / d * L, base[2] || 0];
  }
  /** Gezinen imleç / parmakla nişan önizlemesi: bekleyen uzunluk varsa hedef nokta, yoksa kısıtlı nokta */
  previewPoint(w) { return this.directPoint([w[0], w[1], 0], null) || this.kisitla([w[0], w[1], 0], null); }
  parsePoint(s) {
    const rel = s.startsWith('@');
    const body = rel ? s.slice(1) : s;
    const norm = (v) => parseFloat(v.trim().replace(',', '.'));
    if (body.includes('<')) {
      const [L, A] = body.split('<');
      const l = norm(L), a = norm(A) * D2R;
      if (!isFinite(l) || !isFinite(a)) return null;
      const base = (this.api.fromBase && this.api.fromBase()) || this.last || [0, 0, 0];   // FROM tabanı bir kez, sonra son nokta
      return [base[0] + l * Math.cos(a), base[1] + l * Math.sin(a), base[2] || 0];
    }
    // "x;y" ya da "x y" ya da "x,y" — ondalık ayırıcı nokta kabul edilir
    const parts = body.split(/[;\s]+|,(?=\s*-?\d)/).filter(Boolean);
    if (parts.length < 2) return null;
    const v = parts.map(norm);
    if (v.some(x => !isFinite(x))) return null;
    if (rel) { const b = (this.api.fromBase && this.api.fromBase()) || this.last || [0, 0, 0]; return [b[0] + v[0], b[1] + v[1], (b[2] || 0) + (v[2] || 0)]; }
    return [v[0], v[1], v[2] || 0];
  }
  /** dokunma: w = dünya [x,y]; prim = dokunulan nesne (seçim için) */
  tap(w, screen) {
    if (!this.active) return false;
    if (this.selecting) {
      const p = this.api.pick(w);
      if (p) {
        // Grup damgası taşıyan parçalar (ölçülendirme, balon, lider) birlikte seçilir: biri taşınırsa hepsi taşınır.
        // Dosyadan gelen DIMENSION varlığının parçaları da (aynı tanıtıcı) bütün olarak seçilir — AutoCAD'de de ölçü tek nesnedir
        const group = this.groupOf(p);
        const on = this.api.sel.has(p);
        for (const q of group) { if (on) this.api.sel.delete(q); else this.api.sel.add(q); }
        this.say(); this.api.overlay();
      }
      return true;
    }
    if (MODE_TOOLS[this.active]) {
      if (!this.mode) { this.mode = 'screen'; this.say(); }                                   // dokunmak Ekran'ı seçer
      else if (this.mode === 'value' && this.val == null) { this.api.toast(t('modeTypeFirst')); return true; }
    }
    if (this.active === 'polygon' && this.step === 0) { this.sides = this.lastVal.polygon || 6; this.step = 1; }   // kenar sayısı yazılmadan dokunuş: öntanımlı kenar, dokunuş merkezdir
    if (this.wantsObject()) { void this.objectTap(w); return true; }
    // Önceki nokta dik / teğet / paralel / uzantı kipleri içindir; iki dokunuşlu geçersiz kılmalar
    // (M2P, FROM, TK) ilk dokunuşta { pending } döner ve o dokunuş nokta sayılmaz.
    const sn = this.api.snap(w, { prev: this.pts.length ? this.pts[this.pts.length - 1] : (this.last || null) });
    if (sn && sn.pending) { this.api.overlay(); return true; }
    const p = sn ? [sn.p[0], sn.p[1], sn.p[2] != null ? sn.p[2] : 0] : [w[0], w[1], 0];
    // Doğrudan uzaklık: kutuda (ya da Enter'la bekletilmiş) bir uzunluk varsa dokunuş yalnız yönü verir
    const dp = this.directPoint(p, sn);
    if (dp) { this.pendLen = null; if (this.api.clearInput) this.api.clearInput(); void this.point(dp, null); return true; }
    if (NUMBER_STEP[this.active] === this.step) {
      const need = { scale: 'typeFactor', setz: 'typeZ', thick: 'typeHeight', textsize: 'typeHeight' }[this.active];
      if (need) { this.api.toast(t(need)); return true; }
    }
    void this.point(p, sn);
    return true;
  }
  /** yazı düzenleme kutusu (uygulama içi diyalog) */
  async editText(p) {
    const old = p.lines.join('\n');
    const txt = await askText(t('textPrompt'), old, { multiline: true, words: true });
    if (txt !== null && txt !== old) this.api.run({ op: 'edittext', keys: [p.key], text: txt });
    this.api.render();
  }
  /*
   * AKILLI ÖLÇÜM. Kullanıcı hangi ölçüyü istediğini önceden seçmez: nesneye dokunur, araç türünü
   * anlar ve o türün ANLAMLI ölçüsünü verir — daireden yarıçap/çap/çevre/alan, yaydan yay boyu ve
   * açı, doğrudan eğik ve yatay boy, kapalı yoldan alan ve çevre, yazıdan içerik ve yükseklik,
   * ağdan yüzey ve hacim. Bilgi panelinden farkı: yalnız ÖLÇÜ verir (renk, katman, çizgi tipi yok),
   * sonuç ölçüm sonucu olarak basılır, taslağı çizilir ve panodan/CSV'den dışarı çıkabilir.
   */
  identify(p) {
    const A = this.api, u = A.units(), k = A.unitToM() || 1;
    const rows = [], inf = p.info || {};
    const tur = inf.t || (p.k === 5 ? 'MESH' : p.k === 1 ? 'TEXT' : p.k === 2 ? 'POINT' : 'ENTITY');
    rows.push([t('entityTypes'), A.trType ? A.trType(tur) : tur]);
    if (p.k === 0) {
      const yay = p.ops.find(q => q[0] === 2 || q[0] === -2);
      const kapali = !!(p.closed || p.fill);
      const pts = flatten(p.ops);
      const boy = pathLength3(p.ops, p.closed), boyH = pathLength(p.ops, p.closed);
      if (yay && p.ops.length <= 2) {
        const tam = Math.abs(((yay[5] - yay[4]) % TAU)) < 1e-9;
        rows.push([t('radius'), A.fmt(yay[3]) + u], [t('diameter'), A.fmt(2 * yay[3]) + u]);
        rows.push([tam ? t('circumference') : t('arcLen'), A.fmt(boy) + u]);
        if (!tam) rows.push([t('angle'), A.fmt(((yay[5] - yay[4] + TAU) % TAU) * 180 / Math.PI, 2) + '°']);
        if (tam) rows.push([t('area'), A.fmt(Math.PI * yay[3] * yay[3]) + (u ? u + '\u00b2' : '')]);
        rows.push([t('center'), A.fmt(yay[1]) + ' ; ' + A.fmt(yay[2])]);
        this.draft = { circle: { c: [yay[1], yay[2]], r: yay[3] } };
      } else {
        rows.push([kapali ? t('perimeter') : t('length'), A.fmt(boy) + u]);
        if (Math.abs(boy - boyH) > Math.max(1e-9, boy * 1e-9)) rows.push([t('lengthH'), A.fmt(boyH) + u]);
        if (k !== 1) rows.push([t('length') + ' (m)', A.fmt(boy * k, 2) + ' m']);
        if (kapali && pts.length >= 3) {
          const al = Math.abs(polyArea(pts));
          rows.push([t('area'), A.fmt(al) + (u ? u + '\u00b2' : '')]);
          if (k !== 1) rows.push([t('areaM2'), A.fmt(al * k * k, 2) + ' m\u00b2'], [t('areaDa'), A.fmt(al * k * k / 1000, 3) + ' da']);
          else rows.push([t('areaDa'), A.fmt(al / 1000, 3) + ' da']);
        }
        rows.push([t('vertices'), pts.length]);
        if (pts.length) {
          const f0 = pts[0], l0 = pts[pts.length - 1];
          rows.push([t('start'), A.fmt(f0[0]) + ' ; ' + A.fmt(f0[1])], [t('end'), A.fmt(l0[0]) + ' ; ' + A.fmt(l0[1])]);
          if (pts.length === 2) rows.push([t('angle'), A.fmt(Math.atan2(l0[1] - f0[1], l0[0] - f0[0]) * 180 / Math.PI, 2) + '°']);
        }
        this.draft = { pts, segs: pts.slice(1).map((q, i) => [pts[i], q]), close: kapali, keep: true };
      }
    } else if (p.k === 1) {
      rows.push([t('textK'), (p.lines || []).join(' ').slice(0, 120)], [t('height'), A.fmt(p.h) + u],
        [t('position'), A.fmt(p.x) + ' ; ' + A.fmt(p.y)]);
    } else if (p.k === 5) {
      const m = A.meshMetrics ? A.meshMetrics(p) : null;
      if (m) {
        rows.push([t('surfTotal'), A.fmt(m.total) + (u ? u + '\u00b2' : '')]);
        if (m.lateral) rows.push([t('surfLateral'), A.fmt(m.lateral) + (u ? u + '\u00b2' : '')]);
        if (m.volume) rows.push([t('volume'), A.fmt(m.volume) + (u ? u + '\u00b3' : '')]);
      }
      rows.push([t('triCount'), (p.idx ? p.idx.length / 3 : 0)]);
      if (p.zmin != null) rows.push([t('elev'), A.fmt(p.zmin) + ' … ' + A.fmt(p.zmax) + u]);
    } else if (p.k === 2) {
      rows.push([t('position'), A.fmt(p.x) + ' ; ' + A.fmt(p.y)]);
    }
    const bb = p.bb;
    if (bb && isFinite(bb[0])) rows.push([t('size'), A.fmt(bb[2] - bb[0]) + ' × ' + A.fmt(bb[3] - bb[1]) + u]);
    if (inf.name) rows.push([t('blockN'), inf.name]);
    if (inf.lay) rows.push([t('layer'), inf.lay]);
    A.result(rows);
    A.overlay();
  }
  /**
   * Nesneye (ya da kapalı alana) dokunarak çalışan araçlar. Ölçülendirmede dokunulan daireden
   * yarıçap okunur, patlatmada ve öznitelikte dokunulan ilkelin BLOK bilgisi kullanılır.
   */
  async objectTap(w) {
    const A = this.api, act = this.active;
    if (act === 'hatch' || act === 'fillarea' || act === 'boundary') { await this.regionTap(w); return; }
    if (act === 'divide' || act === 'measure' || act === 'arraypath') { this.pathTap(w); return; }
    if (act === 'matchprop') { this.matchTap(w); return; }
    if ((act === 'trim' || act === 'extend') && this.mode === 'value') { this.lengthTap(w); return; }
    if (act === 'trim' || act === 'extend') { await this.cutTap(w); return; }
    if (act === 'fillet' || act === 'chamfer') { await this.cornerTap(w); return; }
    if (act === 'offset') { this.offsetTap(w); return; }
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (act === 'ident') { this.identify(p); return; }
    if (act === 'draworder') { this.drawOrderRef(p); return; }
    if (act === 'wipeout') { await this.wipeFromPoly(p); return; }
    if (act === 'xclip') { if (!p.xref) { A.toast(t('notXref')); return; } this.xref = p.xref; this.step = 1; this.say(); A.overlay(); return; }
    if (act === 'ncopy') {
      // AutoCAD NCOPY: blok ya da referans içindeki nesnenin bağımsız kopyası aynı yere, geçerli katmana girer
      const e = A.primToEnt ? A.primToEnt(p) : null;
      if (!e) { A.toast(t('noObject')); return; }
      if (A.run({ op: 'add', ents: [{ ...e, id: newId(), layer: A.layer(), color: e.color == null ? 256 : e.color, gid: undefined }] })) { A.render(); A.toast(t('ncopyDone')); }
      return;
    }
    if (act === 'bedit' || act === 'refedit') {
      if (!p.info || p.info.t !== 'INSERT' || !p.info.name) { A.toast(t('notBlock')); return; }
      const f = act === 'bedit' ? A.beditStart : A.refeditStart;
      this.cancel();
      if (typeof f === 'function') void f(p.info.name, p.info.h);
      return;
    }
    if (act === 'radius' || act === 'dimr' || act === 'dimd') {
      const o = p.k === 0 ? p.ops.find(q => q[0] === 2 || q[0] === -2) : null;
      if (!o) { A.toast(t('notCircle')); return; }
      const u = A.units();
      if (act === 'radius') {
        A.result([[t('radius'), A.fmt(o[3]) + u], [t('diameter'), A.fmt(2 * o[3]) + u], [t('center'), A.fmt(o[1]) + ' ; ' + A.fmt(o[2])], [t('circumference'), A.fmt(pathLength3(p.ops, p.closed)) + u]]);
        this.draft = { circle: { c: [o[1], o[2]], r: o[3] } }; A.overlay();
        return;
      }
      const kind = act === 'dimd' ? 'diameter' : 'radius';
      const def = { ...this.dimDefaults(), kind: 'radial', sub: kind, pts: [[o[1], o[2], o[6] || 0], [w[0], w[1], o[6] || 0]], r: o[3], prefix: kind === 'diameter' ? '\u2300 ' : 'R ' };
      const res = this.buildDim(def, this.dimOpts());
      if (res) { this.commitMany(res.ents); A.toast(res.label); } else A.toast(t('dimFail'));
      return;
    }
    if (act === 'dimedit') { await this.editDim(p); return; }
    if (act === 'edittext') {
      // ölçünün yazısı ölçünün tanımından kurulur: elle değiştirilirse sonraki ölçü düzenlemesinde sessizce geri
      // dönerdi. Ölçü yazısına dokunulunca "Ölçü özellikleri" açılır (Ölçü yazısı alanı orada)
      if (p.info && p.info.t === 'DIMENSION' && (p.info.gid || p.info.dim)) { await this.editDims([p]); return; }
      if (p.k !== 1) { A.toast(t('notText')); return; }
      await this.editText(p);
      return;
    }
    const inf = p.info;
    if (act === 'explode') {
      if (!inf || inf.t !== 'INSERT') { A.toast(t('notBlock')); return; }
      const group = A.allPrims().filter(q => q.info && q.info.h === inf.h && q.info.t === 'INSERT');
      if (!group.length) { A.toast(t('notBlock')); return; }
      const ids = group.map(() => newId());
      if (A.run({ op: 'explode', h: inf.h, ids })) { A.toast(t('exploded') + ' \u00b7 ' + group.length); A.render(); }
      return;
    }
    if (act === 'attr') {
      if (!inf || !inf.attrs || !inf.attrs.length) { A.toast(t('noAttribs')); return; }
      const fields = inf.attrs.map((a, i) => ({ id: 'a' + i, label: a[0] || ('#' + (i + 1)), type: 'text', value: a[1] }));
      const res = await askForm(t('attrEdit') + (inf.name ? ' \u2014 ' + inf.name : ''), fields, { ok: t('apply') });
      if (!res) return;
      const items = [];
      inf.attrs.forEach((a, i) => { const v = res['a' + i]; if (v != null && String(v) !== String(a[1])) items.push({ i, value: String(v) }); });
      if (!items.length) return;
      if (A.run({ op: 'attrib', h: inf.h, items })) { A.toast(t('applied')); A.render(); }
    }
  }
  /*
   * Budama ve uzatma. İki dokunuş: önce kesici kenar / sınır, sonra hedef. Kesici korunur ve
   * araç 1. adımda KALIR — AutoCAD'de olduğu gibi aynı kesiciyle arka arkaya budanabilir.
   *
   * KESİCİ HER NESNE OLABİLİR (v7.92). Eskiden kesici de hedef de yalnız DÜZ segmenti olan bir
   * yoldu: daireye, yaya, taramaya ya da yazıya dokunmak "bu nesnede düz kenar yok" diyordu.
   * Artık kesici geom.cutterSegs'ten gelir — yol, yay, daire, elips, spline, tarama sınırı,
   * desen çizgileri, resim ve yazı (sınır kutusuyla, AutoCAD'deki gibi) kesebilir.
   *
   * HEDEF bir YOL olmalıdır (k = 0): yazının ya da resmin "budanmış" hâli yoktur, AutoCAD de
   * onları kesmez. Ama yolun budanan öğesi artık düz segment YA DA YAY olabilir — daire ve yay
   * budanır, kalan parça yine yaydır.
   */
  async cutTap(w) {
    const A = this.api, act = this.active;
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (this.step === 0) {
      const segs = cutterSegs(p);
      if (!segs.length) { A.toast(t('notPath')); return; }
      this.cut = { key: p.key, segs };
      this.draft = { segs: segs.map(q => [[q[0], q[1], 0], [q[2], q[3], 0]]), keep: true };
      this.step = 1; this.say(); A.overlay();
      return;
    }
    if (p.key === this.cut.key) { A.toast(t('trimSelf')); return; }
    if (p.k !== 0 || !p.ops || p.ops.length < 2) { A.toast(t('notPath')); return; }
    if (act === 'trim') {
      /*
       * DOLGULU KAPALI ALAN (tarama · solid) başka türlü budanır: kullanıcı sınıra değil İÇERİ
       * dokunur ve "şu parçayı at" der. Çizgi kuralı burada işlemez — alan açılırsa dolgu
       * taşar. Kalan parça kapalı kalır, yeni kenarı kesicinin KENDİ biçimidir.
       */
      const th = this.taramaOf(p);
      if (th) { await this.taramaBuda(th, w); return; }
      if (p.fill && p.closed) {
        const rr = trimRegion(p.ops, this.cut.segs, w);
        if (!rr) { A.toast(t('trimNoHit')); return; }
        if (A.run({ op: 'reshape', items: [{ key: p.key, ops: rr.ops, closed: true }] })) A.render(); else A.toast(t('error'));
        return;
      }
      const r = trimPath(p.ops, p.closed, this.cut.segs, w);
      if (!r) { A.toast(t('trimNoHit')); return; }
      const ci = (p.info && p.info.ci != null) ? p.info.ci : 256;
      let ok;
      if (r.parts.length === 1) {
        ok = A.run({ op: 'reshape', items: [{ key: p.key, ops: r.parts[0].ops, closed: r.parts[0].closed }] });
      } else {
        // Ortadan budama yolu İKİYE böler: kalanı yeniden şekillendir, ikinci yarıyı yeni
        // ilkel olarak ekle. 'group' ikisini tek geri alma adımı yapar.
        ok = A.run({ op: 'group', cmds: [
          { op: 'reshape', items: [{ key: p.key, ops: r.parts[0].ops, closed: false }] },
          { op: 'add', ents: [{ id: newId(), type: 'PATH', ops: r.parts[1].ops, closed: false, layer: p.lay || A.layer(), color: ci }] },
        ] });
        if (ok) A.toast(t('trimSplit'));
      }
      if (ok) A.render(); else A.toast(t('error'));
      return;
    }
    const r = extendPath(p.ops, p.closed, this.cut.segs, w);
    if (!r) { A.toast(t('extendNoHit')); return; }
    if (A.run({ op: 'reshape', items: [{ key: p.key, ops: r.ops }] })) A.render(); else A.toast(t('error'));
  }

  /*
   * TARAMA BÜTÜN OLARAK BUDANIR (v7.93).
   *
   * Desenli bir tarama ekranda İKİ ilkeldir: sınır (saydam dolgu) ve desen çizgileri. Kullanıcı
   * desen çizgilerinden birine dokunduğunda eskiden yalnız O ÇİZGİ budanıyordu — tarama tek tek
   * parçalara ayrılıyor, sınır olduğu yerde kalıyordu. Oysa tarama TEK nesnedir: sınırı budanır,
   * desen o yeni sınıra göre YENİDEN ÜRETİLİR.
   *
   * İki tür tarama vardır ve ikisi de burada toplanır:
   *   - uygulamanın kendi ürettiği tarama: sınır ile çizgiler ortak `info.gid` taşır
   *   - dosyadan (DWG / DXF) okunan tarama: ortak olan `info.h` tutamağıdır
   * Sınır ilkeli her ikisinde de `et === 'HATCH'` olandır.
   */
  taramaOf(p) {
    const A = this.api;
    if (!p || p.k !== 0) return null;
    const inf = p.info || {};
    const grup = (q) => {
      const qi = q.info || {};
      return (inf.gid && qi.gid === inf.gid) || (inf.h != null && qi.h === inf.h && qi.t === 'HATCH');
    };
    const hepsi = typeof A.allPrims === 'function' ? A.allPrims() : [];
    const uyeler = (inf.gid || inf.h != null) ? hepsi.filter(grup) : [p];
    const sinir = (p.et === 'HATCH' && p.ops) ? p : uyeler.find(q => q.et === 'HATCH' && q.k === 0 && q.ops);
    if (!sinir) return null;
    return { sinir, uyeler: uyeler.length ? uyeler : [sinir] };
  }
  /** Sınırı kesiciyle böler, dokunulan parçayı atar ve taramayı yeni sınıra göre yeniden kurar */
  async taramaBuda(th, w) {
    const A = this.api;
    const rr = trimRegion(th.sinir.ops, this.cut.segs, w);
    if (!rr) { A.toast(t('trimNoHit')); return; }
    const inf = th.sinir.info || {}, ent = th.sinir.ent || {};
    const ad = inf.pattern || ent.pattern || ent.patternName || (inf.solid === false ? 'ANSI31' : 'SOLID');
    /*
     * Yeni sınır KİRİŞLENMEDEN geçer: rr.ops yay taşıyabilir (daire ya da yay kenarlı tarama) ve
     * eskiden buradaki `o[1], o[2]` eşlemesi yay işleminin MERKEZİNİ köşe sanıyordu. Nokta listesi
     * desen hesabı için düzleştirmeden, yay bilgisi ise ops olarak ayrıca taşınır.
     */
    const z0 = (rr.ops[0] && rr.ops[0][3]) || 0;
    const noktalar = flatten(rr.ops).map(q => [q[0], q[1], z0]);
    if (noktalar.length < 3) { A.toast(t('trimNoHit')); return; }
    const r2 = hatchEnts(noktalar, {
      pattern: ad,
      scale: inf.hscale != null ? inf.hscale : ent.hscale,
      angle: inf.hangle != null ? inf.hangle : ent.hangle,
      layer: th.sinir.lay || A.layer(),
      color: inf.ci == null ? 256 : inf.ci,
      alpha: th.sinir.alpha,
      gid: newId(),
      ops: rr.ops,
      hrec: inf.hrec || ent.hrec,     // ada kipi, desen türü, çift, tohum, geçiş: budama bunları düşürmez
      hdefs: inf.hdefs || ent.hdefs,  // tablomuzda olmayan dosya deseni budandıktan sonra da dokusunu korur
    });
    if (!r2 || !r2.ents.length) { A.toast(t('error')); return; }
    /*
     * Deseni ÜRETEMEDİYSEK bunu sessizce SOLID'e çevirmeyiz: kullanıcı budadığı taramanın
     * dokusunu kaybettiğini bilmelidir (AutoCAD'de de desen adı korunur, düz dolguya düşmez).
     */
    if (r2.dustu) A.toast(t('hatchFail_yogun'), 3000);
    const ents = r2.ents.map(e => ({ ...e, id: newId() }));
    /*
     * Eski tarama silinip yenisi eklenir; 'group' ikisini TEK geri alma adımı yapar. Yerinde
     * 'reshape' olmaz: desen çizgilerinin sayısı da yeri de değişir, düğüm düğüm eşlenemez.
     */
    const ok = A.run({ op: 'group', cmds: [
      { op: 'delete', keys: th.uyeler.map(q => q.key) },
      { op: 'add', ents },
    ] });
    if (ok) A.render(); else A.toast(t('error'));
  }
  /*
   * Kavis ve pah. İki doğruya dokunulur, yarıçap / mesafe sorulur.
   * Aynı yolun iki ARDIŞIK segmentinde köşe yolun içinde kalır (tek reshape, polyline tek parça).
   * İki AYRI ilkelde her iki doğrunun ucu teğet noktasına çekilir, yay ya da pah kenarı ayrı
   * ilkel olarak eklenir; hepsi tek 'group' içindedir.
   */
  async cornerTap(w) {
    const A = this.api, act = this.active;
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (p.k !== 0 || !p.ops || p.ops.length < 2) { A.toast(t('notPath')); return; }
    if (!segAt(p.ops, p.closed, w)) { A.toast(t('notPath')); return; }
    if (this.step === 0) {
      const { segs } = segmentsOf(p);
      this.c1 = { key: p.key, ops: p.ops, closed: p.closed, lay: p.lay, ci: (p.info && p.info.ci != null) ? p.info.ci : 256, w: [w[0], w[1]] };
      this.draft = { segs: segs.map(q => [[q[0], q[1], 0], [q[2], q[3], 0]]), keep: true };
      this.step = 1; this.say(); A.overlay();
      return;
    }
    const c1 = this.c1;
    const ayni = p.key === c1.key;
    const k = cornerAt(ayni ? p.ops : c1.ops, ayni ? p.closed : c1.closed, c1.w, p.ops, p.closed, w);
    /*
     * BAŞARISIZLIĞIN SEBEBİ SÖYLENİR (v7.92). Tek bir "kavis kurulamadı" iletisi kullanıcıya
     * ne yanlış yaptığını göstermiyordu: aynı doğruya iki kez dokunmak, paralel iki doğru
     * seçmek ve yolu kendi üstüne katlamak aynı görünüyordu.
     */
    if (!k.kind) {
      const ileti = { sameSeg: 'filletSameSeg', parallel: 'filletParallel', badOrder: 'filletOrder', noSeg: 'notPath' }[k.neden] || 'filletFail';
      A.toast(t(ileti), { type: 'warn' });
      return;
    }
    this.corner = { k, p: { key: p.key, ops: p.ops, closed: p.closed } };
    if (this.mode === 'value') { await this.cornerApply(this.val); return; }
    // Ekran: yarıçap / mesafe üçüncü dokunuştan (ya da o adımda yazılan sayıdan) gelir
    this.step = 2; this.say(); A.overlay();
  }
  /**
   * Ekran kipinde kavis / pah değeri dokunulan noktadan: nokta köşenin açıortayına izdüşürülür (d).
   * Kavis yayının orta noktası açıortayda köşeden r·(1/sin φ − 1) uzaktadır (φ = yarım açı) → r = d·sin φ / (1 − sin φ).
   * Eşit mesafeli pah kenarının ortası köşeden x·cos φ uzaktadır → x = d / cos φ.
   * Köşenin gerisine dokunulursa (d ≤ 0) değer kurulamaz.
   */
  async cornerPoint(pt) {
    const A = this.api, k = this.corner && this.corner.k;
    if (!k) { this.step = 0; this.say(); return; }
    const u0 = [k.p0[0] - k.c[0], k.p0[1] - k.c[1]], u1 = [k.p1[0] - k.c[0], k.p1[1] - k.c[1]];
    const l0 = Math.hypot(u0[0], u0[1]), l1 = Math.hypot(u1[0], u1[1]);
    if (!(l0 > 1e-12) || !(l1 > 1e-12)) { A.toast(t('filletFail')); return; }
    const a0 = [u0[0] / l0, u0[1] / l0], a1 = [u1[0] / l1, u1[1] / l1];
    const bis = [a0[0] + a1[0], a0[1] + a1[1]], lb = Math.hypot(bis[0], bis[1]);
    if (!(lb > 1e-9)) { A.toast(t('filletFail')); return; }
    const phi = Math.acos(Math.max(-1, Math.min(1, a0[0] * a1[0] + a0[1] * a1[1]))) / 2;
    const d = ((pt[0] - k.c[0]) * bis[0] + (pt[1] - k.c[1]) * bis[1]) / lb;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const v = this.active === 'fillet' ? (sp < 1 - 1e-9 ? d * sp / (1 - sp) : 0) : (cp > 1e-9 ? d / cp : 0);
    if (!(d > 1e-9) || !(v > 0)) { A.toast(t('cornerBehind')); return; }
    this.lastVal[this.active] = v;
    await this.cornerApply(v);
  }
  /** Kavis / pahı kurar ve uygular (her iki kipin ortak sonu) */
  async cornerApply(r0) {
    const A = this.api, act = this.active, c1 = this.c1, k = this.corner && this.corner.k, p = this.corner && this.corner.p;
    if (!c1 || !k || !p) { this.step = 0; this.say(); return; }
    if (!(r0 > 0)) { A.toast(t('numberExpected')); return; }
    const r1 = r0;
    const g = act === 'fillet' ? filletCorner(k.p0, k.c, k.p1, r0) : chamferCorner(k.p0, k.c, k.p1, r0, r1);
    if (!g) { A.toast(t('filletFail')); return; }
    const z = (p.ops[0] && p.ops[0][3]) || 0;
    const yayOp = () => (act === 'fillet'
      ? [g.ccw ? 2 : -2, g.cx, g.cy, g.r, g.a0, g.a1, z]
      : [1, g.t1[0], g.t1[1], z]);
    let ok;
    if (k.kind === 'same' || k.kind === 'sameFar') {
      // Köşe düğümü teğet noktasına çekilir, ardına yay (ya da pah kenarı) girer: ops +1.
      const yeni = c1.ops.map(o => o.slice());
      yeni[k.i] = [yeni[k.i][0], g.t0[0], g.t0[1], z];
      /*
       * 'sameFar': iki kol arasındaki işlemler ATILIR (AutoCAD FILLET'in çoklu segmentli
       * polyline davranışı). Atma önce yapılır, yay atılan aralığın yerine girer; böylece
       * ikinci kol yayın bittiği noktadan (t1) başlar.
       */
      let at = k.i + 1;
      if (k.kind === 'sameFar') { yeni.splice(k.drop[0], k.drop[1] - k.drop[0] + 1); at = k.drop[0]; }
      yeni.splice(at, 0, yayOp());
      // Yaydan sonraki düğüme dokunulmaz: o segment zaten t1'den başlayıp p1'de bitiyor.
      ok = A.run({ op: 'reshape', items: [{ key: c1.key, ops: yeni, closed: c1.closed }] });
    } else {
      /*
       * Dokunulan segmentin KÖŞEYE YAKIN ucu teğet noktasına çekilir; uzak uç yerinde kalır.
       * Böylece kavis kullanıcının dokunduğu tarafa oturur. Uç bir yay işlemiyse taşınamaz,
       * o zaman null döner ve araç 'filletFail' basar.
       */
      const cek = (ops, i, q) => {
        if (i < 1 || i >= ops.length) return null;
        const d = (j) => Math.hypot(ops[j][1] - k.c[0], ops[j][2] - k.c[1]);
        const uc = (ops[i - 1][0] === 0 || ops[i - 1][0] === 1) && d(i - 1) < d(i) ? i - 1 : i;
        if (ops[uc][0] !== 0 && ops[uc][0] !== 1) return null;
        const n = ops.map(o => o.slice());
        n[uc] = [n[uc][0], q[0], q[1], z];
        return n;
      };
      const n1 = cek(c1.ops, k.i, g.t0), n2 = cek(p.ops, k.j, g.t1);
      if (!n1 || !n2) { A.toast(t('filletFail')); return; }
      const ekOps = act === 'fillet'
        ? [[0, g.t0[0], g.t0[1], z], [g.ccw ? 2 : -2, g.cx, g.cy, g.r, g.a0, g.a1, z]]
        : [[0, g.t0[0], g.t0[1], z], [1, g.t1[0], g.t1[1], z]];
      ok = A.run({ op: 'group', cmds: [
        { op: 'reshape', items: [
          { key: c1.key, ops: n1, closed: c1.closed },
          { key: p.key, ops: n2, closed: p.closed },
        ] },
        { op: 'add', ents: [{ id: newId(), type: 'PATH', ops: ekOps, closed: false, layer: c1.lay || A.layer(), color: c1.ci }] },
      ] });
    }
    if (ok) { A.render(); A.toast(toolName(act) + ' ' + t('applied') + ' \u00b7 ' + A.fmt(r0)); this.c1 = null; this.corner = null; this.draft = null; this.step = 0; this.say(); A.overlay(); }
    else A.toast(t('error'));
  }
  /*
   * Ötele. Ekran: nesneye dokun, sonra kopyanın GEÇECEĞİ noktaya dokun — mesafe o noktanın nesneye uzaklığı,
   * taraf noktanın tarafıdır (AutoCAD OFFSET "Through"). Ölçü: yazılan mesafe, nesne, taraf noktası.
   * Araç aynı değerle sürer; Vazgeç bitirir.
   */
  offsetTap(w) {
    const A = this.api;
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (p.k !== 0 || !p.ops || p.ops.length < 2) { A.toast(t('notPath')); return; }
    const { segs } = segmentsOf(p);
    this.c1 = { key: p.key, ops: p.ops, closed: !!p.closed, lay: p.lay, ci: (p.info && p.info.ci != null) ? p.info.ci : 256 };
    this.draft = { segs: segs.map(q => [[q[0], q[1], 0], [q[2], q[3], 0]]), keep: true };
    this.step = 1; this.say(); A.overlay();
  }
  async offsetPoint(pt) {
    const A = this.api, c1 = this.c1;
    if (!c1) { this.step = 0; this.say(); return; }
    const pts = flatten(c1.ops).map(q => [q[0], q[1], 0]);
    const distTo = (arr, cl) => { let m = Infinity; for (let i = 1; i < arr.length; i++) m = Math.min(m, segDist(pt[0], pt[1], arr[i - 1][0], arr[i - 1][1], arr[i][0], arr[i][1])); if (cl && arr.length > 2) m = Math.min(m, segDist(pt[0], pt[1], arr[arr.length - 1][0], arr[arr.length - 1][1], arr[0][0], arr[0][1])); return m; };
    const d = this.mode === 'value' ? Math.abs(this.val || 0) : distTo(pts, c1.closed);
    if (!(d > 1e-9)) { A.toast(t('offsetFail')); return; }
    const o1 = offsetPoints(pts, d, c1.closed), o2 = offsetPoints(pts, -d, c1.closed);
    if (!o1 || !o2) { A.toast(t('offsetFail')); return; }
    const pick = distTo(o1, c1.closed) < distTo(o2, c1.closed) ? o1 : o2;
    const ent = { type: pts.length === 2 ? 'LINE' : 'LWPOLYLINE', pts: pick, closed: c1.closed, layer: c1.lay, color: c1.ci, id: newId() };
    if (A.run({ op: 'add', ents: [ent] })) { this.lastVal.offset = d; A.toast(toolName('offset') + ' ' + t('applied') + ' \u00b7 ' + A.fmt(d)); } else A.toast(t('offsetFail'));
    A.render();
    this.c1 = null; this.draft = null; this.step = 0; this.say(); A.overlay();
  }
  /** Buda / uzat, Ölçü kipi: dokunulan uç yazılan boy kadar kısalır (buda) ya da uzar (uzat) — LENGTHEN DElta */
  lengthTap(w) {
    const A = this.api, act = this.active;
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (p.k !== 0 || !p.ops || p.ops.length < 2) { A.toast(t('notPath')); return; }
    const L = Math.abs(this.val || 0);
    const r = lengthenPath(p.ops, !!p.closed, w, act === 'trim' ? -L : L);
    if (!r) { A.toast(t(p.closed || !p.ops.every(o => o[0] === 0 || o[0] === 1) ? 'lenClosed' : 'lenTooLong')); return; }
    if (A.run({ op: 'reshape', items: [{ key: p.key, ops: r.ops, closed: false }] })) { A.render(); A.toast(toolName(act) + ' ' + t('applied') + ' \u00b7 ' + A.fmt(L)); }
    else A.toast(t('error'));
  }
  /** Kip araçlarında nokta (nesne değil) beklenen adım: ötelede geçiş / taraf noktası, kavis / pahta Ekran kipinin üçüncü dokunuşu */
  wantsPoint() {
    if (this.active === 'offset') return this.step === 1 && !!this.c1;
    if (this.active === 'fillet' || this.active === 'chamfer') return this.mode === 'screen' && this.step === 2 && !!this.corner;
    return false;
  }
  /*
   * AutoCAD'in "Select objects:" istemi. Bu adımda NESNE seçilir, nokta değil — ve AutoCAD'de bu iki
   * istemin İMLECİ de YAKALAMASI da farklıdır: nokta isteminde artı imleç çıkar ve nesne yakalama
   * (osnap) çalışır; nesne isteminde imleç küçük bir kareye (pickbox) döner ve yakalama hiç çalışmaz.
   * Yakalamanın orada bir anlamı yoktur: kullanıcı bir uç noktaya oturmuyor, bir nesneye dokunuyordur;
   * işaret hem gereksiz yere ekranı doldurur hem de dokunulan yeri kaydırıyormuş izlenimi verir.
   * app.js yakalamayı ve imleci buna bakarak seçer (findSnap / drawCrosshair / drawPenHover).
   */
  pickingObject() {
    if (!this.running) return false;
    if (this.selecting) return true;                                   // Seç aracı ve Taşı / Sil / Döndür… araçlarının seçim aşaması
    return this.wantsObject();                                         // Buda, Uzat, Kavis, Pah, Ötele, Patlat, Yazı düzenle…
  }
  /** Bu adımda NESNE mi bekleniyor (nokta değil): nesne araçları, çizim sırasının başvuru nesnesi, polyline'dan maske, kırpılacak referans */
  wantsObject() {
    if (this.selecting) return false;
    if (this.active === 'draworder') return this.step === 1 && !!this.dro;
    if (this.active === 'wipeout') return !!this.wipePoly;
    if (this.active === 'xclip') return this.step === 0;
    return OBJECT_TOOLS.has(this.active) && !this.wantsPoint();
  }
  /** Ekran / Ölçü düğmesi. Kip değişince araç nesne seçimine döner; Ölçü seçilince değer (yeniden) istenir. */
  setMode(m) {
    if (!MODE_TOOLS[this.active]) return;
    this.mode = m === 'value' ? 'value' : 'screen';
    this.val = null; this.step = 0; this.pts = []; this.cut = null; this.c1 = null; this.corner = null; this.draft = null;
    this.say(); this.api.overlay();
  }
  /** Ölçü kipinde yazılan değer */
  setValue(v) {
    this.mode = 'value'; this.val = v; this.lastVal[this.active] = v;
    this.step = 0; this.pts = []; this.cut = null; this.c1 = null; this.corner = null; this.draft = null;
    this.say(); this.api.overlay();
  }
  /** Boş Enter: değer isteminde son değer öntanımlıdır (AutoCAD <öntanımlı>); tüketildiyse true */
  enterEmpty() {
    if (this.active === 'polygon' && this.step === 0) { this.sides = this.lastVal.polygon || 6; this.step = 1; this.say(); this.api.overlay(); return true; }   // <öntanımlı> kenar sayısı
    if (!MODE_TOOLS[this.active]) return false;
    const last = this.lastVal[this.active];
    if ((!this.mode || (this.mode === 'value' && this.val == null)) && last > 0) { this.setValue(last); return true; }
    if (this.mode === 'screen' && this.wantsPoint() && last > 0) { if (this.active === 'fillet' || this.active === 'chamfer') { void this.cornerApply(last); return true; } }
    return false;
  }

  /** Kapalı alana dokunma: tarama ekler ya da alanı ölçer */
  async regionTap(w) {
    const A = this.api;
    // AutoCAD gibi: alan tek bir kapalı nesne olmak zorunda değil — ayrı çizgi / yay / polyline parçalarından oluşan kapalı
    // alan (kesişimlerde bölünmüş düzlemsel çizgenin noktayı içeren en küçük yüzü) izlenir; bulunamazsa tek kapalı nesne
    const vis = A.visiblePrims();
    const reg = traceBoundary(vis, w[0], w[1]) || enclosingPrim(vis, w[0], w[1]);
    if (!reg) { A.toast(t('noRegion')); return; }
    const u = A.units(), k = A.unitToM() || 1;
    const z = reg.prim ? ((reg.prim.ops[0] && reg.prim.ops[0][3]) || 0) : 0;
    const pts = reg.pts.map(q => [q[0], q[1], z]);
    if (this.active === 'fillarea') {
      const per = reg.prim ? pathLength3(reg.prim.ops, true) : reg.pts.reduce((acc, q, i, arr) => { const n = arr[(i + 1) % arr.length]; return acc + Math.hypot(n[0] - q[0], n[1] - q[1]); }, 0);
      const rows = [[t('area'), A.fmt(reg.area) + (u ? u + '\u00b2' : '')], [t('perimeter'), A.fmt(per) + u], [t('cornersN'), pts.length]];
      if (k !== 1) rows.push([t('areaM2'), A.fmt(reg.area * k * k, 2) + ' m\u00b2'], [t('areaDa'), A.fmt(reg.area * k * k / 1000, 3) + ' da']);
      else rows.push([t('areaDa'), A.fmt(reg.area / 1000, 3) + ' da'], [t('areaHa'), A.fmt(reg.area / 10000, 4) + ' ha']);
      A.result(rows);
      this.draft = { pts, segs: pts.slice(1).map((q, i) => [pts[i], q]), close: true, keep: true };
      A.overlay();
      return;
    }
    if (this.active === 'boundary') {
      // AutoCAD BOUNDARY: kapalı nesnenin sınırı geçerli katman ve renkte yeni bir kapalı polyline olur; araç sürer
      this.commit({ type: 'LWPOLYLINE', closed: true, pts });
      A.toast(t('boundaryAdded') + ' \u00b7 ' + A.fmt(reg.area) + (u ? u + '\u00b2' : ''));
      this.draft = { pts, segs: pts.slice(1).map((q, i) => [pts[i], q]), close: true, keep: true };
      A.overlay();
      return;
    }
    // Desen, araç çubuğundaki "Desen" karosundan gelir; SOLID varsayılandır (eski davranış).
    const hp = (A.hatchPattern && A.hatchPattern()) || { name: 'SOLID', scale: 0, angle: 0 };
    const r = hatchEnts(pts, { pattern: hp.name, scale: hp.scale, angle: hp.angle, gid: newId(), layer: A.layer(), color: A.color(), alpha: 1 });
    if (!r) { A.toast(t('error')); return; }
    this.commitMany(r.ents);
    // Desen istendiği hâlde uygulanamadıysa ya da ölçek kendiliğinden açıldıysa KULLANICIYA SÖYLENİR:
    // sessizce düz dolgu vermek, "desen uygulanmıyor" diye görünen asıl kusurdu.
    const ek = r.dustu ? ' \u00b7 ' + t('hatchFail_yogun') : (r.oto ? ' \u00b7 ' + t('hatchAutoScale').replace('%s', A.fmt(r.scale)) : '');
    A.toast(t('hatchAdded') + ' \u00b7 ' + (r.pattern === 'SOLID' ? t('patSolid') : r.pattern) + ek + ' \u00b7 ' + A.fmt(reg.area) + (u ? u + '\u00b2' : ''), ek ? 3600 : 2200);
  }
  /** Açıklama üreticilerine verilen ortak seçenekler (yazı yüksekliği, katman, renk, grup) */
  annotOpts(extra) {
    const A = this.api;
    // lider, balon ve bulut yazısı ölçülerle aynı boyda (v8.9.8: ölçü varsayılanı çizimden gelir)
    let h; try { const d = this.dimDefaults(); h = d.h * (d.scale > 0 ? d.scale : 1); } catch (_) { h = A.textHeight(); }
    return { h, layer: A.layer(), color: A.color(), gid: newId(), ...(extra || {}) };
  }
  /** Birden çok varlığı TEK komutla ekler: tek geri alma, tek kayıt satırı */
  commitMany(ents) {
    const A = this.api;
    const list = (ents || []).filter(Boolean).map(e => ({ ...e, id: newId(), layer: e.layer || A.layer(), color: e.color == null ? A.color() : e.color }));
    if (!list.length) return false;
    const ok = A.run({ op: 'add', ents: list });
    A.render();
    return ok;
  }
  /** Doğrusal / yatay / düşey ölçülendirme (üç nokta toplandığında) */
  makeLinearDim() {
    const A = this.api;
    const kind = this.active === 'dimh' ? 'horizontal' : this.active === 'dimv' ? 'vertical' : 'aligned';
    const [p1, p2, q] = this.pts;
    const res = this.buildDim({ ...this.dimDefaults(), kind: 'linear', sub: kind, pts: [p1, p2, q] }, this.dimOpts());
    if (!res) { A.toast(t('dimFail')); return; }
    this.commitMany(res.ents);
    A.toast(res.label);
  }
  /*
   * ÖLÇÜ TANIMI (def). Her ölçülendirme, DIMENSION parçasının ent.def alanında tanımını taşır:
   *   kind 'linear' (sub aligned / horizontal / vertical; pts p1, p2, q) · 'radial' (sub radius / diameter;
   *   pts merkez, işaret noktası; r) · 'angular' (pts tepe, kol a, kol b; r yay yarıçapı)
   *   'linear' altında sub 'rotated' + rot: DXF tip 0'ın açılı hâli, ölçülen değer izdüşümdür
   *   h yazı yüksekliği · arrow ok boyu · exo / exe uzatma çizgisi boşluğu ve taşması (DIMEXO / DIMEXE) ·
   *   prec ondalık (null = ayarlardaki) · prefix / suffix · factor (DIMLFAC) · text geçersiz kılma
   *   ('' = ölçülen; içindeki <> ölçülen değerle değişir)
   * Özellikler düzenlenince ölçü bu tanımdan yeniden kurulur; taşıma / döndürme / ölçekleme tanımı da
   * dönüştürür (edit.transformPrim). Dosyadan gelen DIMENSION varlıkları ilk düzenlemede tanım
   * noktalarından (info.dim) bu biçime çevrilir.
   */
  /*
   * YENİ ÖLÇÜNÜN TANIM VARSAYILANLARI (v8.9.8). Sıra:
   *   0. Bu çizimde kullanıcının son seçtiği ayarlar (özellik kutusunda "Yeni ölçüler de bu ayarlarla çizilsin";
   *      çizimin başlık değişkenlerinde, geri alınabilir — A.dimStyleGet)
   *   1. Çizimin kendisinden (annot.autoDimStyle): dosyadaki ölçülerin ekrandaki boyu → çizime uyan geçerli ölçü
   *      stili → yazıların ortancası → sağlam çizim genişliği. Dosyadaki bir ölçü örnek alındıysa ondalık, ön / son ek
   *      ve çarpan da ondan okunur.
   * scale: genel ölçek (DIMSCALE) — yazı, ok, uzatma boşluğu ve taşması onunla çarpılır; ölçülen değer değişmez.
   * Eskiden yazı çizimin tam kutusunun 1/91'iydi: birkaç uzak nesne kutuyu şişirince 1120 mm'lik ölçüye 450–820 mm yazı çıkıyordu.
   */
  dimDefaults() {
    const A = this.api;
    const st = A.dimStyleGet ? A.dimStyleGet() : null;
    if (st && st.h > 0) {
      const d = this.dimNeutral();
      for (const k of ['h', 'arrow', 'scale', 'factor']) if (typeof st[k] === 'number' && st[k] > 0) d[k] = st[k];
      for (const k of ['exo', 'exe']) if (typeof st[k] === 'number' && st[k] >= 0) d[k] = st[k];
      if (!(st.arrow > 0)) d.arrow = d.h;
      d.prec = st.prec === null || (typeof st.prec === 'number' && st.prec >= 0 && st.prec <= 6) ? st.prec : null;
      d.prefix = typeof st.prefix === 'string' ? st.prefix : ''; d.suffix = typeof st.suffix === 'string' ? st.suffix : '';
      if (st.dsep > 0) d.dsep = st.dsep;
      return d;
    }
    try {
      const inp = A.dimAuto ? A.dimAuto() : null;
      if (!inp) return this.dimNeutral();
      const r = autoDimStyle({ ...inp, units: A.units() });
      const d = { h: r.h, arrow: r.arrow, exo: r.exo, exe: r.exe, scale: 1, prec: r.prec, prefix: r.prefix, suffix: r.suffix, factor: r.factor, text: '' };
      if (r.adec != null) d.adec = r.adec;
      if (r.dsep > 0) d.dsep = r.dsep;
      if (r.repKey != null) {
        // örnek ölçünün yazı biçimi: ondalık, ön / son ek, çarpan (yarıçap / çap önekleri araçlar kendileri ekler)
        const rep = A.allPrims().find(q => q.key === r.repKey);
        const inf = rep && rep.info;
        if (inf && inf.dim) {
          const parts = A.allPrims().filter(q => q.info && q.info.h === inf.h && q.info.t === 'DIMENSION');
          const fd = this.dimDefFromFile(inf.dim, parts, this.dimNeutral());
          if (fd) {
            d.prec = fd.kind === 'angular' ? null : fd.prec;
            d.prefix = /^(R |⌀ )$/.test(fd.prefix || '') ? '' : (fd.prefix || '');
            d.suffix = fd.kind === 'angular' ? '' : (fd.suffix || '');
            d.factor = fd.kind === 'angular' ? 1 : (fd.factor > 0 ? fd.factor : 1);
            if (inf.dim.sty && inf.dim.sty.dsep > 0) d.dsep = inf.dim.sty.dsep;
          }
        }
      }
      return d;
    } catch (_) { return this.dimNeutral(); }
  }
  /** Tarafsız temel: çizimden hiçbir şey okunmadan (dosya ölçüsü dönüştürülürken; kullanıcı ayarı sızmasın) */
  dimNeutral() { const A = this.api, h = A.textHeight(); return { h, arrow: h, exo: h * 0.25, exe: h * 0.5, scale: 1, prec: null, prefix: '', suffix: A.units(), factor: 1, text: '' }; }
  /** Ölçü üreticisine verilen seçenekler: saklanan stilde katman / renk varsa onlar (AutoCAD DIMLAYER), yoksa geçerli olanlar */
  dimOpts() {
    const A = this.api, o = this.annotOpts(), st = A.dimStyleGet ? A.dimStyleGet() : null;
    if (st && typeof st.layer === 'string' && st.layer && (!A.layerNames || A.layerNames().includes(st.layer))) o.layer = st.layer;
    if (st && typeof st.color === 'number') o.color = st.color;
    return o;
  }
  /** Etiket: geçersiz kılma varsa o (<> ölçülen değerle değişir), yoksa ön ek + biçimli ölçü + son ek */
  dimLabel(def, measure) {
    const A = this.api;
    const val = measure * (def.factor > 0 ? def.factor : 1);
    // ölçü yazısında binlik ayırıcı yok, ondalık ayırıcı stilin DIMDSEP'i ya da arayüz dilininki (A.fmtDim; sınamalarda A.fmt)
    const F = A.fmtDim ? (v, d) => A.fmtDim(v, d, def.dsep) : (v, d) => A.fmt(v, d);
    const num = def.prec == null ? (def.kind === 'angular' ? F(val, 2) : F(val)) : F(val, Math.max(0, Math.min(6, def.prec | 0)));   // en çok 6 ondalık
    const auto = (def.prefix || '') + num + (def.suffix || '');
    const ov = def.text == null ? '' : String(def.text).trim();
    return ov ? ov.replace(/<>/g, auto) : auto;
  }
  /** Tanımdan varlıklar: { ents, measure, label } ya da null */
  buildDim(def0, o) {
    const def = { ...def0 };
    const P = def.pts || [];
    // açısal ölçüde yay yarıçapı tanımda saklanır (annot.dimAngular'ın varsayılanı: kısa kolun %70'i) ki taşıma /
    // düzenleme sonrası yeniden kurulan yay aynı kalsın
    if (def.kind === 'angular' && P.length >= 3 && !(def.r > 0)) def.r = Math.min(Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), Math.hypot(P[2][0] - P[0][0], P[2][1] - P[0][1])) * 0.7;
    // genel ölçek (DIMSCALE): yazı, ok, uzatma boşluğu ve taşması onunla çarpılır; geometri ve ölçülen değer değişmez
    const k = def.scale > 0 ? def.scale : 1, h = (def.h > 0 ? def.h : 2.5) * k;
    const opts = { ...o, h, arrow: (def.arrow > 0 ? def.arrow : def.h > 0 ? def.h : 2.5) * k, gap: def.exo >= 0 ? def.exo * k : undefined, ext: def.exe >= 0 ? def.exe * k : undefined, rot: def.rot || 0, label: '', def,
      tp: def.kind === 'linear' && Array.isArray(def.tp) ? def.tp : undefined };   // tutamakla taşınmış yazı (yalnız doğrusal)
    let res = null;
    if (def.kind === 'linear' && P.length >= 3) {
      res = dimLinear(def.sub || 'aligned', P[0], P[1], P[2], opts);
      // yazı uzatma çizgilerinin dışına taşındıysa ölçü çizgisi yazının altına kadar uzasın: yazı genişliği etiketle bilinir
      if (res && res.geo && res.geo.out) res = dimLinear(def.sub || 'aligned', P[0], P[1], P[2], { ...opts, tw: this.dimLabel(def, res.measure).length * h * 0.6 });
    }
    else if (def.kind === 'radial' && P.length >= 2 && def.r > 0) res = dimRadial(def.sub === 'diameter' ? 'diameter' : 'radius', P[0], def.r, P[1], opts);
    else if (def.kind === 'angular' && P.length >= 3) res = dimAngular(P[0], P[1], P[2], { ...opts, r: def.r > 0 ? def.r : 0 });
    if (!res) return null;
    const label = this.dimLabel(def, res.measure);
    for (const e of res.ents) if (e.type === 'TEXT') e.text = label;
    return { ents: res.ents, measure: res.measure, label, geo: res.geo || null };
  }
  /**
   * Dokunulan parçanın ölçü grubu: { keys, def, gid, layer, color, file } ya da null.
   * Uygulamada kurulan ölçüde tanım DIMENSION parçasının ent.def'idir; dosyadan gelen ölçüde (info.dim)
   * tanım noktalarından türetilir; ondalık, ön / son ek ve çarpan etkin ölçü stilinden, stilde yazılı değilse
   * görünen yazıdan ve dosyanın ölçümünden okunur ki yeniden kurulan ölçü dosyadakine benzesin.
   */
  dimGroup(p) {
    const A = this.api, inf = p && p.info;
    if (!inf || inf.t !== 'DIMENSION') return null;
    const all = A.allPrims();
    if (inf.gid) {
      const parts = all.filter(q => q.info && q.info.gid === inf.gid);
      const core = parts.find(q => q.ent && q.ent.def);
      if (!core) return null;
      return { keys: parts.map(q => q.key), def: JSON.parse(JSON.stringify(core.ent.def)), gid: inf.gid, layer: core.lay, color: core.info && core.info.ci != null ? core.info.ci : 256, file: false };
    }
    if (!inf.dim || !inf.h) return null;
    const parts = all.filter(q => q.info && q.info.h === inf.h && q.info.t === 'DIMENSION');
    const def = this.dimDefFromFile(inf.dim, parts);
    if (!def) return null;
    // renk: dosyadaki ACI indeksi korunur; katmandan (256), bloktan (0) ve gerçek renk (indeks yok) katman rengine (-1) düşer —
    // entToPrim 256'yı ön plan rengi sayar, oysa dosyadaki parçalar katman rengiyle çizilmişti
    return { keys: parts.map(q => q.key), def, gid: newId(), layer: p.lay, color: inf.ci >= 1 && inf.ci <= 255 ? inf.ci : -1, file: true };
  }
  dimDefFromFile(d, parts, base0) {
    const base = { ...(base0 || this.dimNeutral()) }, sty = d.sty || {};   // tarafsız temel: kullanıcının ön / son eki dosya ölçüsüne sızmaz
    if (sty.dsep > 0) base.dsep = sty.dsep;
    const txt = parts.find(q => q.k === 1);
    const angular = d.type === 2 || d.type === 5;
    // yazı yüksekliği, ok boyu, uzatma boşluğu / taşması: etkin ölçü stilinden; stil yoksa yazı parçasından
    if (sty.txt > 0) base.h = sty.txt; else if (txt && txt.h > 0) base.h = txt.h;
    base.arrow = sty.asz > 0 ? sty.asz : base.h;
    base.exo = sty.exo >= 0 ? sty.exo : base.h * 0.25;
    base.exe = sty.exe >= 0 ? sty.exe : base.h * 0.5;
    if (typeof sty.dec === 'number') {
      // ondalık, ön / son ek ve çarpan DIMSTYLE'dan: DIMDEC / DIMADEC (-1 = DIMDEC), DIMPOST "<>" kalıbı, DIMLFAC
      base.prec = Math.max(0, Math.min(6, angular ? (sty.adec >= 0 ? sty.adec : sty.dec) : sty.dec));
      const post = angular ? '' : String(sty.post || '');
      const i = post.indexOf('<>');
      if (i >= 0) { base.prefix = post.slice(0, i); base.suffix = post.slice(i + 2); } else { base.prefix = ''; base.suffix = post; }
      if (!angular && sty.lfac > 0) base.factor = sty.lfac;
      // yarıçap / çap ölçüsü AutoCAD'de kendiliğinden "R" / "⌀" alır (DIMPOST'tan değil); dosyadaki görünüm korunsun
      if (d.type === 4 && !base.prefix) base.prefix = 'R ';
      if (d.type === 3 && !base.prefix) base.prefix = '\u2300 ';
    } else {
      // stil yoksa görünen yazıdan: "R 12.50 mm" → 'R ', 2 ondalık, ' mm'. Binlik ayracı ("1.234" mi 1,234 mü?)
      // ölçülen değerle ayrıştırılır: hangi okuma dosyadaki ölçüme yakınsa o
      const shown = txt ? txt.lines.join(' ') : '';
      const m = shown.match(/^(.*?)([-+]?\d[\d.,]*\d|[-+]?\d)(.*)$/);
      if (m) {
        base.prefix = m[1]; base.suffix = m[3];
        const tok = m[2], dot = tok.lastIndexOf('.'), com = tok.lastIndexOf(',');
        let prec = 0;
        if (dot >= 0 && com >= 0) prec = tok.length - Math.max(dot, com) - 1;
        else if (dot >= 0 || com >= 0) {
          const sep = dot >= 0 ? '.' : ',', parts2 = tok.split(sep);
          if (parts2.length > 2) prec = 0;                                     // "1.234.567": binlik
          else {
            const asDec = parseFloat(tok.replace(',', '.')), asGrp = parseFloat(tok.replace(/[.,]/g, ''));
            prec = (d.meas > 0 && parts2[1].length === 3 && Math.abs(asGrp - d.meas) < Math.abs(asDec - d.meas)) ? 0 : parts2[1].length;
          }
        }
        base.prec = Math.max(0, Math.min(6, prec));
      }
    }
    if (d.ov) base.text = d.ov;   // dosyadaki geçersiz kılma, biçim kodları ayıklanmış (<> ölçülen değer)
    let def = null;
    if ((d.type === 0 || d.type === 1) && d.p1 && d.p2 && d.d) {
      let sub = 'aligned', rot = 0;
      if (d.type === 0) {                                                        // dönük: 0° yatay, 90° düşey, başka açı 'rotated'
        const r = (((d.rot || 0) % Math.PI) + Math.PI) % Math.PI;
        if (Math.abs(Math.sin(r)) < 1e-6) sub = 'horizontal'; else if (Math.abs(Math.cos(r)) < 1e-6) sub = 'vertical'; else { sub = 'rotated'; rot = r; }
      }
      def = { ...base, kind: 'linear', sub, rot, pts: [d.p1, d.p2, d.d] };
    } else if (d.type === 4 && d.d && d.cp) {                     // yarıçap: merkez (10) → çevre (15)
      def = { ...base, kind: 'radial', sub: 'radius', pts: [d.d, d.cp], r: Math.hypot(d.cp[0] - d.d[0], d.cp[1] - d.d[1]) };
    } else if (d.type === 3 && d.d && d.cp) {                     // çap: iki karşı çevre noktası (10 ↔ 15)
      const c = [(d.d[0] + d.cp[0]) / 2, (d.d[1] + d.cp[1]) / 2, d.d[2] || 0];
      def = { ...base, kind: 'radial', sub: 'diameter', pts: [c, d.cp], r: Math.hypot(d.cp[0] - d.d[0], d.cp[1] - d.d[1]) / 2 };
    } else if (d.type === 5 && d.cp && d.p1 && d.p2) {            // 3 noktalı açısal: 15 tepe, 13 / 14 kollar, 10 yay noktası
      const [pa, pb] = this.angularArms(d.cp, d.p1, d.p2, d.d);
      def = { ...base, kind: 'angular', pts: [d.cp, pa, pb], r: d.d ? Math.hypot(d.d[0] - d.cp[0], d.d[1] - d.cp[1]) : 0 };
    } else if (d.type === 2 && d.x1s && d.x1e && d.x2s && d.cp) { // 2 çizgili açısal
      /*
       * İki okuma vardır. (A) DXF sözleşmesi: birinci çizgi 13→14, ikinci çizgi 15→10, tepe iki çizginin
       * kesişimi, yay noktası 16. (B) Bazı dönüştürücülerin yazdığı düzen: 13 tepe, 14 ve 15 kollar, 10 yay
       * noktası — pface_full.dxf'in *D7 bloğu tam bu düzeni çizer. Dosyanın kendi ölçümü (kod 42, radyan)
       * hangisine yakınsa o alınır; ölçüm yoksa sözleşme (A) geçerlidir.
       */
      const a = d.x1s, b = d.x1e, c = d.x2s, e = d.cp, cands = [];
      const den = (b[0] - a[0]) * (e[1] - c[1]) - (b[1] - a[1]) * (e[0] - c[0]);
      if (Math.abs(den) > 1e-12) {
        const tt = ((c[0] - a[0]) * (e[1] - c[1]) - (c[1] - a[1]) * (e[0] - c[0])) / den;
        const v = [a[0] + tt * (b[0] - a[0]), a[1] + tt * (b[1] - a[1]), a[2] || 0];
        const [pa, pb] = this.angularArms(v, b, e, d.d);
        cands.push({ v, pa, pb, arc: d.d });
      }
      { const [pa, pb] = this.angularArms(a, b, c, e); cands.push({ v: a, pa, pb, arc: e }); }
      const degOf = (k) => { let sw = Math.atan2(k.pb[1] - k.v[1], k.pb[0] - k.v[0]) - Math.atan2(k.pa[1] - k.v[1], k.pa[0] - k.v[0]); while (sw <= -Math.PI) sw += TAU; while (sw > Math.PI) sw -= TAU; return Math.abs(sw) * R2D; };
      let best = cands[0];
      if (d.meas > 0 && cands.length > 1) { const deg = d.meas * R2D; best = cands.reduce((m, k) => (Math.abs(degOf(k) - deg) < Math.abs(degOf(m) - deg) ? k : m)); }
      def = { ...base, kind: 'angular', pts: [best.v, best.pa, best.pb], r: best.arc ? Math.hypot(best.arc[0] - best.v[0], best.arc[1] - best.v[1]) : 0 };
    }
    if (!def) return null;
    if (def.kind === 'angular') { if (def.prec == null) def.prec = 2; def.prefix = ''; def.suffix = '\u00b0'; def.factor = 1; }
    // DIMLFAC dosyada yazılı değilse: dosyadaki ölçüm bizim hesapladığımızdan farklıysa çarpan oradan çıkarılır
    if (!(sty.lfac > 0) && def.kind !== 'angular') {
      const built = this.buildDim({ ...def, text: '' }, { layer: '0', color: 256, gid: 'tmp' });
      if (built && d.meas > 0 && built.measure > 0) { const f = d.meas / built.measure; if (Math.abs(f - 1) > 1e-6) def.factor = Math.round(f * 1e6) / 1e6; }
    }
    return def;
  }
  /**
   * Açısal ölçünün kolları: iki çizgi dört açı yapar; dosyadaki yay noktası (kod 16 / 10) hangisinin içindeyse o
   * ölçülür. Kollar tepe noktasına göre ters çevrilerek (a' = 2v − a) yay noktasını kapsayan çift seçilir; yay
   * noktası yoksa verilen kollar olduğu gibi kalır.
   */
  angularArms(v, a, b, arcPt) {
    if (!arcPt) return [a, b];
    const ang = (p) => Math.atan2(p[1] - v[1], p[0] - v[0]);
    const norm = (x) => { while (x <= -Math.PI) x += TAU; while (x > Math.PI) x -= TAU; return x; };
    const flip = (p) => [2 * v[0] - p[0], 2 * v[1] - p[1], p[2] || 0];
    const inside = (p, q) => { const s = norm(ang(q) - ang(p)), t = norm(ang(arcPt) - ang(p)); return s >= 0 ? (t >= 0 && t <= s) : (t <= 0 && t >= s); };
    for (const [pa, pb] of [[a, b], [flip(a), b], [a, flip(b)], [flip(a), flip(b)]]) if (inside(pa, pb)) return [pa, pb];
    return [a, b];
  }
  /** Tek ölçünün özellik kutusu (Ölçüyü düzenle aracı, sınamalar) — editDims'in tek ölçülü hâli */
  async editDim(p) { return this.editDims([p]); }
  /** Parçalardan ölçü grupları: her ölçü (uygulamanınki gid'iyle, dosyanınki tanıtıcısıyla) bir kez */
  dimGroupsOf(parts) {
    const out = [], seen = new Set();
    for (const p of parts || []) {
      const inf = p && p.info;
      if (!inf || inf.t !== 'DIMENSION') continue;
      const key = inf.gid ? 'g:' + inf.gid : inf.h ? 'h:' + inf.h : null;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const g = this.dimGroup(p);
      if (g) out.push(g);
    }
    return out;
  }
  /*
   * ÖLÇÜ ÖZELLİKLERİ KUTUSU (v8.9.8). Kullanıcı istekleri: "Burada renk ve katman ayarı olsun, ayrıca tüm
   * özellikle ölçekleme yani mevcut yazı boyutu ve ok boyutunu küçültme AutoCAD'de olduğu gibi ölçü ölçeği
   * değişmeden."
   *   - Katman ve renk: ölçünün bütün parçaları birlikte taşınır / boyanır.
   *   - Genel ölçek (DIMSCALE): yazı, ok, uzatma boşluğu ve taşması birlikte büyür / küçülür; ölçülen değer ve
   *     çarpan (DIMLFAC) değişmez. Tanımda ayrı alandır (def.scale): 0,5 yapılıp geri 1 yapılınca ölçü eski hâline döner.
   *   - Birden çok ölçü seçiliyse hepsi birlikte düzenlenir (AutoCAD Özellikler paleti): değeri ölçüden ölçüye değişen
   *     alan boş gelir, boş bırakılırsa her ölçüde olduğu gibi kalır; hepsi tek geri alma adımıdır.
   * Sayılar arayüz dilinin ondalık ayırıcısıyla ve en çok 6 anlamlı basamakla yazılır ("112.406432482" TR'de yüz on
   * iki bin okunuyordu); dokunulmayan alan yuvarlanmış değeri değil TAM değeri korur. Yazı yüksekliği değişip ok /
   * uzatma alanlarına dokunulmadıysa, yüksekliğe bağlı varsayılanlarda duranlar (ok = h, boşluk = h/4, taşma = h/2)
   * yükseklikle birlikte değişir: yalnız yazı küçültülünce uzatma çizgileri eski büyük boyda kalmasın.
   */
  async editDims(parts) {
    const A = this.api;
    const gs = this.dimGroupsOf(parts);
    if (!gs.length) { const p = (parts || [])[0]; A.toast(t(p && p.info && p.info.t === 'DIMENSION' ? 'dimUnsupported' : 'notDim')); return false; }
    const many = gs.length > 1, dec = sepOf().ondalik || ',';
    const disp = (v) => (typeof v === 'number' && isFinite(v) ? String(+v.toPrecision(6)).replace('.', dec) : '');
    const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));
    const common = (fn) => { const v0 = fn(gs[0]); return gs.every(g => same(fn(g), v0)) ? v0 : undefined; };
    const D = (g) => g.def;
    const V = {
      text: common(g => D(g).text || ''), layer: common(g => g.layer), color: common(g => normColor(g.color)),
      scale: common(g => (D(g).scale > 0 ? D(g).scale : 1)), h: common(g => D(g).h), arrow: common(g => D(g).arrow),
      prec: common(g => (D(g).prec == null ? 'auto' : String(Math.max(0, Math.min(6, D(g).prec | 0))))),
      prefix: common(g => D(g).prefix || ''), suffix: common(g => D(g).suffix || ''),
      factor: common(g => (D(g).factor > 0 ? D(g).factor : 1)),
      exo: common(g => (D(g).exo >= 0 ? D(g).exo : D(g).h * 0.25)), exe: common(g => (D(g).exe >= 0 ? D(g).exe : D(g).h * 0.5)),
    };
    const VAR = '\u0000';   // "değer ölçüden ölçüye değişiyor" seçeneği (select alanlarında)
    const sel = (cur, opts) => (cur === undefined ? [[VAR, t('dimVariesOpt')], ...opts] : opts);
    const layers = A.layerNames ? A.layerNames() : [];
    if (V.layer !== undefined && !layers.includes(V.layer)) layers.unshift(V.layer);
    const anyLinear = gs.some(g => D(g).kind === 'linear'), anyExe = gs.some(g => D(g).kind === 'linear' || D(g).kind === 'angular');
    const allAngular = gs.every(g => D(g).kind === 'angular');
    const fields = [
      { id: 'text', label: t('dimText'), type: 'text', value: V.text === undefined ? '' : V.text },
      { id: 'layer', label: t('layer'), type: 'select', value: V.layer === undefined ? VAR : V.layer, options: sel(V.layer, layers.map(n => [n, n])) },
      { id: 'color', label: t('color'), type: 'swatch', value: V.color === undefined ? '' : String(V.color), options: A.colorOptions ? A.colorOptions(V.layer === undefined ? null : V.layer, V.color) : [] },
      { id: 'scale', label: t('dimScale'), type: 'number', value: disp(V.scale) },
      { id: 'h', label: t('dimTextH'), type: 'number', value: disp(V.h) },
      { id: 'arrow', label: t('dimArrow'), type: 'number', value: disp(V.arrow) },
      { id: 'prec', label: t('dimPrec'), type: 'select', value: V.prec === undefined ? VAR : V.prec, options: sel(V.prec, [['auto', t('dimPrecAuto')], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']]) },
      { id: 'prefix', label: t('dimPrefix'), type: 'text', value: V.prefix === undefined ? '' : V.prefix },
      { id: 'suffix', label: t('dimSuffix'), type: 'text', value: V.suffix === undefined ? '' : V.suffix },
    ];
    if (!allAngular) fields.push({ id: 'factor', label: t('dimFactor'), type: 'number', value: disp(V.factor) });
    if (anyLinear) fields.push({ id: 'exo', label: t('dimExo'), type: 'number', value: disp(V.exo) });
    if (anyExe) fields.push({ id: 'exe', label: t('dimExe'), type: 'number', value: disp(V.exe) });
    fields.push({ id: 'asDefault', label: t('dimAsDefault'), type: 'check', value: true });
    const hint = t('dimScaleHint') + ' ' + t('dimTextHint') + (many ? ' ' + t('dimVaries') : '');
    const r = await askForm(many ? t('dimEditMany').replace('%s', gs.length) : t('dimEditTitle'), fields, { ok: t('apply'), hint });
    if (!r) return false;
    // Alan değişti mi? Sayı alanı: kutunun gösterdiği (yuvarlanmış) değerden farklı bir sayı girildiyse; metin: farklıysa.
    // Sıraya konmuş cevap (sınama) sayı ya da dizgi verebilir; ondalık virgül de kabul edilir.
    const parse = (v) => (typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).trim().replace(',', '.')));
    const numCh = (id, cur, min0) => {
      if (!(id in r)) return undefined;
      const n = parse(r[id]);
      if (!isFinite(n) || (min0 ? n < 0 : n <= 0)) return undefined;             // boş ya da geçersiz: dokunulmamış sayılır
      const shown = parse(disp(cur));
      return cur !== undefined && isFinite(shown) && Math.abs(n - shown) <= 1e-12 * Math.max(1, Math.abs(shown)) ? undefined : n;
    };
    const txtCh = (id, cur) => { if (!(id in r)) return undefined; const v = String(r[id] == null ? '' : r[id]); return (cur === undefined && v === '') || v === cur ? undefined : v; };
    const ch = {
      text: txtCh('text', V.text), prefix: txtCh('prefix', V.prefix), suffix: txtCh('suffix', V.suffix),
      scale: numCh('scale', V.scale), h: numCh('h', V.h), arrow: numCh('arrow', V.arrow), factor: numCh('factor', V.factor),
      exo: numCh('exo', V.exo, true), exe: numCh('exe', V.exe, true),
      prec: r.prec === VAR || r.prec === V.prec || r.prec == null ? undefined : (r.prec === 'auto' ? null : parseInt(r.prec, 10)),
      layer: r.layer === VAR || r.layer === V.layer || !r.layer ? undefined : String(r.layer),
      color: r.color === '' || r.color == null || String(r.color) === String(V.color) ? undefined : Number(r.color),
    };
    // hiçbir alan değişmediyse uygulamanın ölçüsü yeniden kurulmaz ve stil de yazılmaz: dokunmadan "Uygula" hiçbir şey
    // yapmaz (boş bir geri alma adımı, "kaydedilmemiş değişiklik" uyarısı üretilmez)
    const degisti = Object.values(ch).some(v => v !== undefined);
    const items = gs.map(g => {
      const d = g.def, nd = { ...d };
      if (ch.text !== undefined) nd.text = ch.text.trim();
      if (ch.prefix !== undefined) nd.prefix = ch.prefix;
      if (ch.suffix !== undefined) nd.suffix = ch.suffix;
      if (ch.prec !== undefined) nd.prec = ch.prec;
      if (ch.scale !== undefined) nd.scale = ch.scale;
      if (ch.factor !== undefined && d.kind !== 'angular') nd.factor = ch.factor;
      if (ch.h !== undefined) {
        nd.h = ch.h;
        // yüksekliğe bağlı varsayılanda duran ok / uzatma değerleri yükseklikle birlikte değişir (kullanıcı onlara dokunmadıysa)
        const k = d.h > 0 ? ch.h / d.h : 1, rel = (v, f) => typeof v === 'number' && d.h > 0 && Math.abs(v - d.h * f) <= 1e-9 * Math.max(1, d.h);
        if (ch.arrow === undefined && rel(d.arrow, 1)) nd.arrow = d.arrow * k;
        if (ch.exo === undefined && rel(d.exo, 0.25)) nd.exo = d.exo * k;
        if (ch.exe === undefined && rel(d.exe, 0.5)) nd.exe = d.exe * k;
      }
      if (ch.arrow !== undefined) nd.arrow = ch.arrow;
      if (ch.exo !== undefined && d.kind === 'linear') nd.exo = ch.exo;
      if (ch.exe !== undefined && (d.kind === 'linear' || d.kind === 'angular')) nd.exe = ch.exe;
      return { g: { ...g, layer: ch.layer !== undefined ? ch.layer : g.layer, color: ch.color !== undefined ? ch.color : g.color }, def: nd };
    });
    // "Yeni ölçüler de bu ayarlarla": ilk ölçünün sonuç tanımı ve katman / renk çizimin başlık değişkenlerine yazılır —
    // ölçünün yeniden kurulmasıyla AYNI komutta (tek geri alma ikisini birden geri alır)
    let stilCmd = null;
    if (r.asDefault && A.dimStyleCmd) {
      const f = items[0], d = f.def, lin = d.kind === 'linear';
      stilCmd = A.dimStyleCmd({ h: d.h, arrow: d.arrow, exo: d.exo, exe: d.exe, scale: d.scale > 0 ? d.scale : 1, prec: d.kind === 'angular' ? null : d.prec,
        prefix: lin ? d.prefix : '', suffix: lin ? d.suffix : A.units(), factor: lin && d.factor > 0 ? d.factor : 1, layer: f.g.layer, color: f.g.color, dsep: d.dsep });
    }
    // dosyadan gelen ölçüde "Uygula" dönüştürmedir (tanımdan yeniden kurulur), değişiklik olmasa da
    if (!degisti && !gs.some(g => g.file)) return true;
    return this.regenDims(items, stilCmd ? [stilCmd] : []);
  }
  /** Tek grubu tanımdan yeniden kurar (eski çağıranlar için) */
  regenDim(g, def) { return this.regenDims([{ g, def }]); }
  /*
   * Grupları tanımlarından yeniden kurar: eski parçalar silinir, yeniler aynı grup kimliğiyle eklenir. Hepsi TEK
   * komuttur (birden çok ölçüde 'group'), yani tek geri alma. Yeniden kurulan ölçüler seçili kalır: kullanıcı
   * sonucu görür ve kutuyu yeniden açıp ince ayar yapabilir.
   */
  regenDims(items, extra = []) {
    const A = this.api, cmds = [], gids = [];
    let label = '', file = false;
    for (const { g, def } of items) {
      const built = this.buildDim(def, { layer: g.layer, color: g.color, gid: g.gid });
      if (!built) { A.toast(t('dimFail')); return false; }
      const ents = built.ents.map(e => ({ ...e, id: newId(), layer: g.layer || e.layer, color: g.color == null ? e.color : g.color }));
      cmds.push({ op: 'replace', keys: g.keys, ents });
      gids.push(g.gid); label = label || built.label; file = file || g.file;
    }
    cmds.push(...extra);
    const ok = A.run(cmds.length === 1 ? cmds[0] : { op: 'group', cmds });
    if (ok) {
      A.sel.clear();
      for (const q of A.allPrims()) if (q.info && gids.includes(q.info.gid)) A.sel.add(q);
      A.render(); A.overlay();
      if (this.active) this.say();   // Seç aracının istemindeki "[n seçili]" ve komut çubuğu tazelenir
      A.toast((file ? t('dimFromFile') + ' · ' : '') + (items.length > 1 ? t('dimUpdatedN').replace('%s', items.length) : t('dimUpdated') + ': ' + label));
    }
    return ok;
  }
  /** Açı ölçülendirmesi (tepe + iki kol) */
  makeAngularDim() {
    const A = this.api;
    const [v, a, b] = this.pts;
    let sweep = Math.atan2(b[1] - v[1], b[0] - v[0]) - Math.atan2(a[1] - v[1], a[0] - v[0]);
    while (sweep <= -Math.PI) sweep += TAU;
    while (sweep > Math.PI) sweep -= TAU;
    const deg = Math.abs(sweep) * R2D;
    if (!(deg > 1e-9)) { A.toast(t('dimFail')); return; }
    const dd = this.dimDefaults();
    const res = this.buildDim({ ...dd, kind: 'angular', pts: [v, a, b], prec: dd.adec != null ? dd.adec : 2, prefix: '', suffix: '\u00b0', factor: 1 }, this.dimOpts());
    if (!res) { A.toast(t('dimFail')); return; }
    this.commitMany(res.ents);
    A.toast(res.label);
  }
  /** Numaralandırma balonu; ilk dokunuşta başlangıç numarası sorulur, sonra kendiliğinden artar */
  async makeBalloon(p) {
    const A = this.api;
    if (this.balloonNext == null) {
      const v = await askText(t('balloonStart'), '1');
      if (v === null) { this.cancel(); return; }
      this.balloonNext = String(v).trim() || '1';
    }
    const ents = balloonEnts(p, this.balloonNext, this.annotOpts({}));
    this.commitMany(ents);
    A.toast(String(this.balloonNext));
    this.balloonNext = nextLabel(this.balloonNext);
  }
  /** Dizi: seçim bitince tür sorulur (ARRAY) ya da doğrudan türün kendi adımına geçilir (ARRAYRECT: form · ARRAYPOLAR: merkez · ARRAYPATH: yol) */
  async arrayNext() {
    const A = this.api;
    if (!A.sel.size) { A.toast(t('selEmpty')); this.cancel(); return; }
    if (this.active === 'array') {
      this.step = 1; this.say();
      const r = await askForm(toolName('array'), [{ id: 'kind', label: t('arrayKind'), type: 'select', value: this.lastVal.arrayKind || 'rect', options: [['rect', t('arrayRect')], ['polar', t('arrayPolar')], ['path', t('arrayPath')]] }], { ok: t('ok'), hint: t('arrayKindHint') });
      if (!r) { this.cancel(); return; }
      if (this.active !== 'array') return;   // form açıkken araç değişti
      this.lastVal.arrayKind = r.kind === 'polar' || r.kind === 'path' ? r.kind : 'rect';
      this.active = 'array' + this.lastVal.arrayKind;
    }
    if (this.active === 'arrayrect') { await this.runArray({}); return; }
    this.step = 1; this.say(); A.overlay();
  }
  /*
   * Dizi (AutoCAD ARRAY ailesi): bütün kopyalar TEK komutta oluşur, tek geri almayla kalkar.
   *   Dikdörtgen: sütun × satır, X / Y aralığı.  Kutupsal: DOKUNULAN merkez, kopya sayısı, toplam açı, kopyalar dönsün.
   *   Yol: dokunulan yol boyunca sayıyla (yol eşit bölünür, iki uçta da öge) ya da aralıkla (sığdığı kadar); kopyalar yola
   *        döner (ilk ögenin yönüne göre); KAYNAK NESNE yolun dokunulan ucuna taşınır — AutoCAD'de de ilk öge yolun başındadır.
   *   Z artımı (kat): her kopya bir öncekinden o kadar yukarıda — 3DARRAY'in düzlemdeki karşılığı. Uygulanan sayı / açı / yöntem /
   *   hizalama / Z artımı tür başına hatırlanır; aralıklar her seferinde seçimin boyutundan önerilir.
   */
  async runArray(opt = {}) {
    const A = this.api;
    const kind = this.active === 'arraypolar' ? 'polar' : this.active === 'arraypath' ? 'path' : 'rect';
    const keys = [...A.sel].map(q => q.key);
    if (!keys.length) { A.toast(t('selEmpty')); this.cancel(); return; }
    const bb = [...A.sel].reduce((acc, q) => [Math.min(acc[0], q.bb[0]), Math.min(acc[1], q.bb[1]), Math.max(acc[2], q.bb[2]), Math.max(acc[3], q.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const w = isFinite(bb[0]) ? Math.max(bb[2] - bb[0], 1e-6) : 1, h = isFinite(bb[1]) ? Math.max(bb[3] - bb[1], 1e-6) : 1;
    const base = isFinite(bb[0]) ? [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] : [0, 0];
    const last = this.lastVal['array:' + kind] || {};   // tür başına hatırlanan sayı / açı / yöntem / hizalama / Z artımı (aralıklar seçimden önerilir)
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const dzF = { id: 'dz', label: t('arrayDz'), type: 'number', value: last.dz || 0 };
    const fields = kind === 'rect' ? [
      { id: 'nx', label: t('arrayCols'), type: 'number', value: last.nx || 3 },
      { id: 'ny', label: t('arrayRows'), type: 'number', value: last.ny || 1 },
      { id: 'dx', label: t('arrayDx'), type: 'number', value: r3(w * 1.2) },
      { id: 'dy', label: t('arrayDy'), type: 'number', value: r3(h * 1.2) }, dzF]
      : kind === 'polar' ? [
        { id: 'n', label: t('arrayCount'), type: 'number', value: last.n || 6 },
        { id: 'total', label: t('arrayAngle'), type: 'number', value: last.total || 360 },
        { id: 'rotate', label: t('arrayRotate'), type: 'check', value: last.rotate !== false }, dzF]
        : [
          { id: 'method', label: t('arrayMethod'), type: 'select', value: last.method === 'spacing' ? 'spacing' : 'count', options: [['count', t('arrayByCount')], ['spacing', t('arrayBySpacing')]] },
          { id: 'n', label: t('arrayCount'), type: 'number', value: last.n || 6 },
          { id: 'd', label: t('arraySpacing'), type: 'number', value: r3(Math.max(w, h) * 1.2) },
          { id: 'align', label: t('arrayAlign'), type: 'check', value: last.align !== false }, dzF];
    const res = await askForm(toolName(this.active), fields, { ok: t('apply'), hint: t(kind === 'path' ? 'arrayPathHint' : 'arrayHint') });
    if (!res) { this.cancel(); return; }
    const dz = isFinite(res.dz) ? res.dz : 0;
    const CAP = 20000;   // kopya sınırı (kaynak hariç)
    // Geçersiz değer: dikdörtgen kapanır (formu yeniden açacak adım yok); kutupsal merkez, yol ise yol yeniden istenir
    const retry = () => { if (kind === 'rect') { this.cancel(); return; } this.pts = []; this.step = 1; this.say(); A.overlay(); };
    let items, cmds;
    if (kind === 'path') {
      const path = opt.path; if (!path || !path.pts || path.pts.length < 2) { this.cancel(); return; }
      let L = 0; for (let i = 1; i < path.pts.length; i++) L += Math.hypot(path.pts[i][0] - path.pts[i - 1][0], path.pts[i][1] - path.pts[i - 1][1]);
      // Kapalı yolda son nokta başlangıçtır: öge oraya konmaz (AutoCAD kapalı yolu n eşit aralığa böler, 12 cıvata 12 ayrı yerde)
      const closed = !!path.closed, dists = [];
      if (res.method === 'spacing') {
        if (!(res.d > 0)) { A.toast(t('numberExpected')); retry(); return; }
        if (Math.floor(L / res.d) * keys.length > CAP) { A.toast(t('arrayTooMany')); retry(); return; }
        for (let d = 0; closed ? d < L - 1e-9 : d <= L + 1e-9; d += res.d) dists.push(d);
      } else {
        const n = Math.round(res.n);
        if (!(n >= 2)) { A.toast(t('arrayMin2')); retry(); return; }
        if ((n - 1) * keys.length > CAP) { A.toast(t('arrayTooMany')); retry(); return; }
        for (let i = 0; i < n; i++) dists.push(L * i / (closed ? n : n - 1));
      }
      const frames = pathFramesAt(path.pts, dists);
      if (frames.length < 2) { A.toast(t('arrayNone')); retry(); return; }
      // Ögeler yolun kotuna oturur (AutoCAD yol dizisi 3B yolu izler): kaynağın kotu ile yolun kotu arasındaki fark her ögeye eklenir
      const src0 = [...A.sel][0], o0 = src0 && src0.ops && src0.ops[0];
      const srcZ = o0 && isFinite(o0[3]) ? o0[3] : (src0 && isFinite(src0.z) ? src0.z : 0);
      const lift = (isFinite(path.z) ? path.z : 0) - srcZ;
      items = arrayItems('path', { frames, base, align: res.align, dz });
      for (const it of items) it.dz = (it.dz || 0) + lift;
      const first = items.shift();
      cmds = [{ op: 'array', keys, items: items.map(it => ({ ...it, newKeys: keys.map(() => newId()) })) }, { op: 'xform', keys, m: first.m, dz: first.dz || 0 }];
    } else {
      const want = kind === 'polar' ? Math.round(res.n) : Math.round(res.nx) * Math.round(res.ny);
      if ((want - 1) * keys.length > CAP) { A.toast(t('arrayTooMany')); retry(); return; }   // sınır, dizi üretilmeden denetlenir (1e8 öge belleği bitirirdi)
      const prm = kind === 'polar'
        ? { n: res.n, total: res.total, rotate: res.rotate, center: opt.center || base, base, dz }
        : { nx: res.nx, ny: res.ny, dx: res.dx, dy: res.dy, dz };
      items = arrayItems(kind, prm).map(it => ({ ...it, newKeys: keys.map(() => newId()) }));
      cmds = [{ op: 'array', keys, items }];
    }
    if (!items.length) { A.toast(t('arrayNone')); retry(); return; }
    if (items.length * keys.length > CAP) { A.toast(t('arrayTooMany')); retry(); return; }
    if (!A.run(cmds.length === 1 ? cmds[0] : { op: 'group', cmds })) { A.toast(t('error')); this.cancel(); return; }
    this.lastVal['array:' + kind] = { ...last, ...res };   // yalnız uygulanan değerler hatırlanır; reddedilen değer öntanımlı olmaz
    A.render();
    A.toast(t('arrayDone') + ' \u00b7 ' + (items.length + 1), 2200);
    this.pts = []; this.step = 0; A.sel.clear();
    this.cancel();
  }
  onNumber(v) {
    const A = this.api;
    switch (this.active) {
      case 'polygon': { const c = this.pts[0]; if (c) this.buildPolygon(c, Math.abs(v), 0); break; }
      case 'divide': case 'measure': this.placePoints(v); break;
      case 'circle': { const c = this.pts[0]; this.commit({ type: 'CIRCLE', pts: [c], r: Math.abs(v) }); this.pts = []; this.step = 0; break; }
      case 'rotate': { const c = this.pts[0]; this.xform(rotM(c, v * D2R)); this.done(); break; }
      case 'scale': { const c = this.pts[0]; if (!(v > 0)) { A.toast(t('factorPositive')); return; } this.xform([v, 0, 0, v, c[0] * (1 - v), c[1] * (1 - v)]); this.done(); break; }
      case 'setz': { A.run({ op: 'setz', keys: [...A.sel].map(p => p.key), z: v }); A.toast(t('zSet') + ': ' + A.fmt(v)); this.done(); break; }
      case 'thick': {
        if (!isFinite(v) || v === 0) { A.toast(t('numberExpected')); return; }
        const ents = [];
        for (const q of A.sel) {
          if (q.k !== 0 || !q.ops || q.ops.length < 2) continue;
          const z = (q.ops[0] && q.ops[0][3]) || 0;
          const pts = flatten(q.ops).map(c => [c[0], c[1], z]);
          if (pts.length < 2) continue;
          const cl = !!(q.closed || q.fill);
          ents.push({ type: 'EXTRUDE', pts, h: v, closed: cl, cap: cl, layer: q.lay, color: q.info && q.info.ci != null ? q.info.ci : 256 });
        }
        if (ents.length) { this.commitMany(ents); A.toast(t('thickDone') + ' \u00b7 ' + ents.length); } else A.toast(t('thickNone'));
        this.done(); break;
      }
      case 'textsize': {
        if (!(v > 0)) { A.toast(t('numberExpected')); return; }
        const keys = [...A.sel].filter(q => q.k === 1).map(q => q.key);
        if (keys.length) { A.run({ op: 'textheight', keys, h: v }); A.toast(t('applied') + ' \u00b7 ' + keys.length); } else A.toast(t('notText'));
        this.done(); break;
      }
      default: break;
    }
    A.render();
  }
  /*
   * Ortho / kutupsal kısıtı. AutoCAD'deki öncelik korunur: YAKALAMA her şeyi yener (kullanıcı
   * belirli bir noktaya oturmak istemiştir), sonra ortho, sonra kutupsal. Taban nokta, o ana
   * kadar toplanmış son noktadır; ilk noktada kısıt uygulanmaz çünkü kısıtlanacak bir yön yoktur.
   */
  kisitla(p, sn) {
    const d = this.api.desk && this.api.desk();
    if (!d || (!d.ortho && !d.polar)) return p;
    // Dikdörtgenin ikinci noktası bir KÖŞEdir, doğrultu değil: ortho onu eksene indirse
    // dikdörtgen sıfır genişliğe çökerdi. AutoCAD da RECTANG'ın karşı köşesine ortho uygulamaz.
    if (this.active === 'rect') return p;
    const taban = this.pts.length ? this.pts[this.pts.length - 1] : null;
    if (!taban) return p;
    const q = deskConstrain(taban, p, { snapped: !!sn, ortho: d.ortho, polar: d.polar, polarStep: d.polarStep });
    return [q[0], q[1], p[2]];
  }
  /** toplanan nokta (kot / yazı / ayna onayı sorulabildiğinden async; çağıranlar beklemez) */
  async point(p, sn) {
    const A = this.api;
    if (A.trackClear) A.trackClear();   // AutoCAD: nokta belirlenince edinilmiş iz noktaları silinir
    p = this.kisitla(p, sn);
    this.pts.push(p); this.last = p;
    const n = this.pts.length;
    switch (this.active) {
      case 'line':
        if (n >= 2) { this.commit({ type: 'LINE', pts: [this.pts[n - 2], this.pts[n - 1]] }); this.pts = [p]; }
        this.step = 1; break;
      case 'pline': case 'area': this.step = 1; break;
      case 'pline3d': case 'face3d': {
        if (!sn || sn.p[2] == null) {
          const v = await askText(`${n}. ${t('pointZ')}`, this.last && n > 1 ? String(this.pts[n - 2][2]) : '0', { type: 'number' });
          if (v === null) { this.pts.pop(); return; }
          p[2] = parseFloat(String(v).replace(',', '.')) || 0;
        }
        if (this.active === 'face3d' && n === 4) { this.finish(); return; }
        this.step = Math.min(n, TOOLS[this.active].steps.length - 1); break;
      }
      case 'rect': if (n === 2) { const [a, b] = this.pts; this.commit({ type: 'LWPOLYLINE', closed: true, pts: [[a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]]] }); this.pts = []; this.step = 0; } else this.step = 1; break;
      case 'polygon': if (n === 2) { const [c, q] = this.pts; this.buildPolygon(c, Math.hypot(q[0] - c[0], q[1] - c[1]), Math.atan2(q[1] - c[1], q[0] - c[0])); } else this.step = 2; break;
      case 'circle': if (n === 2) { const [c, q] = this.pts; this.commit({ type: 'CIRCLE', pts: [c], r: Math.hypot(q[0] - c[0], q[1] - c[1]) }); this.pts = []; this.step = 0; } else this.step = 1; break;
      case 'arc3': if (n === 3) { const arc = arc3(this.pts[0], this.pts[1], this.pts[2]); if (arc) this.commit({ type: 'ARC', pts: [[arc.cx, arc.cy, this.pts[0][2]]], r: arc.r, a0: arc.a0, a1: arc.a1 }); else A.toast(t('collinear')); this.pts = []; this.step = 0; } else this.step = n; break;
      case 'point': this.commit({ type: 'POINT', pts: [p] }); this.pts = []; break;
      case 'text': {
        const txt = await askText(t('textPrompt'), '', { multiline: true, words: true });
        if (txt) { const h = await askText(t('textHeightPrompt'), String(A.textHeight()), { type: 'number' }); const hv = parseFloat(String(h || '').replace(',', '.')); this.commit({ type: 'TEXT', pts: [p], text: txt, h: hv > 0 ? hv : A.textHeight() }); }
        this.pts = []; break;
      }
      case 'dim': case 'dimh': case 'dimv': {
        if (n === 3) { this.makeLinearDim(); this.pts = []; this.step = 0; } else this.step = n;
        break;
      }
      case 'dima': {
        if (n === 3) { this.makeAngularDim(); this.pts = []; this.step = 0; } else this.step = n;
        break;
      }
      case 'leader': case 'cloud': this.step = 1; break;
      case 'balloon': { await this.makeBalloon(p); this.pts = []; break; }
      case 'arraypolar': if (n === 1) void this.runArray({ center: p }); break;   // dokunulan merkez (AutoCAD "Specify center point of array")
      case 'align': if (n >= 4) { this.alignApply(); return; } this.step = n + 1; break;
      case 'block': this.pts = []; await this.blockMake(p); return;
      case 'insert': this.pts = []; await this.insertPlace(p); return;
      case 'attdef': this.pts = []; await this.attdefAt(p); return;
      case 'wipeout': this.step = 1; break;
      case 'base': this.pts = []; if (A.setBase) A.setBase(p); this.cancel(); return;
      case 'bparam': await this.bparamPoint(p); return;
      case 'xclip': if (n === 2) { const [a, b] = this.pts; if (A.xclip) A.xclip(this.xref, [a[0], a[1], b[0], b[1]]); this.cancel(); return; } this.step = 2; break;
      case 'move': case 'copy': case 'rotate': case 'scale': case 'mirror': case 'stretch': await this.modifyPoint(); break;
      case 'offset': this.pts = []; await this.offsetPoint(p); return;
      case 'fillet': case 'chamfer': this.pts = []; await this.cornerPoint(p); return;
      case 'dist': this.step = 1; this.showDist(); break;
      case 'angle': if (n === 3) { const [v, a, b] = this.pts; const ang = Math.abs(angDiff(Math.atan2(a[1] - v[1], a[0] - v[0]), Math.atan2(b[1] - v[1], b[0] - v[0]))) * R2D; A.result([[t('angle'), A.fmt(ang, 2) + '°'], [t('supplement'), A.fmt(360 - ang, 2) + '°'], [t('arm1'), A.fmt(Math.hypot(a[0] - v[0], a[1] - v[1])) + A.units()], [t('arm2'), A.fmt(Math.hypot(b[0] - v[0], b[1] - v[1])) + A.units()]]); this.draft = { segs: [[v, a], [v, b]], pts: this.pts.slice() }; this.pts = []; this.step = 0; } else this.step = n; break;
      case 'coord': {
        const rows = [['X', A.fmt(p[0])], ['Y', A.fmt(p[1])], ['Z', A.fmt(p[2] || 0)]];
        if (sn) rows.push([t('snapLbl'), sn.kind.toUpperCase()]);
        const ll = A.lonLat ? A.lonLat(p[0], p[1]) : null;
        if (ll) rows.push([t('latLon'), ll[1].toFixed(6) + ' / ' + ll[0].toFixed(6)]);
        rows.push([`<div class="full btns"><button class="btn small" id="tCopy">${t('copy')}</button></div>`]);
        A.result(rows, () => A.copy(A.fmt(p[0]) + ';' + A.fmt(p[1]) + ';' + A.fmt(p[2] || 0)));
        this.draft = { pts: [p] }; this.pts = []; break;
      }
      default: break;
    }
    this.updateDraft();
    this.say();
    A.overlay();
  }
  async modifyPoint() {
    const A = this.api;
    const n = this.pts.length;
    if (this.active === 'move' && n === 2) { const [a, b] = this.pts; this.xform([1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], (b[2] || 0) - (a[2] || 0)); this.done(); return; }
    if (this.active === 'copy' && n >= 2) { const a = this.pts[0], b = this.pts[n - 1]; const keys = [...A.sel].map(p => p.key); A.run({ op: 'copy', keys, newKeys: keys.map(() => newId()), m: [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], dz: (b[2] || 0) - (a[2] || 0) }); A.render(); this.step = 2; return; }
    if (this.active === 'stretch' && n === 2) { this.runStretch(); return; }
    if (this.active === 'rotate' && n === 2) { const [c, q] = this.pts; this.xform(rotM(c, Math.atan2(q[1] - c[1], q[0] - c[0]))); this.done(); return; }
    // Ayna çizgisi: iki nokta, ya da eksen seçildiyse TEK nokta (çizgi o noktadan X'e / Y'ye paralel geçer).
    // Orijinal kalsın mı: komut çubuğundaki düğme (soru kutusu kalktı).
    if (this.active === 'mirror' && (n === 2 || (n === 1 && this.mirrorAxis))) {
      const a = this.pts[0], b = n === 2 ? this.pts[1] : (this.mirrorAxis === 'x' ? [a[0] + 1, a[1], a[2]] : [a[0], a[1] + 1, a[2]]);
      const keys = [...A.sel].map(p => p.key); const m = mirrorM(a, b);
      if (this.mirrorKeep) A.run({ op: 'copy', keys, newKeys: keys.map(() => newId()), m }); else A.run({ op: 'xform', keys, m });
      A.render(); this.done(); return;
    }
    this.step = Math.min(n + 1, TOOLS[this.active].steps.length - 1);
  }
  xform(m, dz = 0) { const keys = [...this.api.sel].map(p => p.key); if (!keys.length) return; this.api.run({ op: 'xform', keys, m, dz }); this.api.render(); }
  done() { this.pts = []; this.step = 0; this.api.sel.clear(); this.api.toast(toolName(this.active) + ' ' + t('applied')); this.cancel(); }
  commit(ent) {
    const A = this.api;
    ent.id = newId(); ent.layer = ent.layer || A.layer(); if (ent.color == null) ent.color = A.color();
    A.run({ op: 'add', ents: [ent] });
    A.render();
  }
  /** Bitir düğmesi */
  finish() {
    this.pendLen = null;   // bekleyen uzunluk parçayla birlikte biter
    const A = this.api;
    if (A.trackClear) A.trackClear();
    if (MODE_TOOLS[this.active]) { if (!this.enterEmpty()) this.say(); return; }   // Bitir / Enter: son değeri alır; kesici ve ilk doğru önizlemesi silinmez
    if (this.selecting) {
      if (!A.sel.size && this.active !== 'bparam') { A.toast(t('selEmpty')); return; }
      this.selecting = false;
      if (this.active === 'select') { this.cancel(); return; }
      if (this.active === 'del') { A.run({ op: 'delete', keys: [...A.sel].map(p => p.key) }); A.render(); A.toast(t('deleted')); this.done(); return; }
      if (ARRAY_TOOLS.has(this.active)) { void this.arrayNext(); return; }
      if (this.active === 'join') { this.runJoin(); return; }
      if (this.active === 'draworder') { void this.drawOrderNext(); return; }
      if (this.active === 'bparam') { void this.bparamNext(); return; }
      if (this.active === 'bvstate') { void this.bvstateNext(); return; }
      this.step = 1; this.say(); return;
    }
    if (this.active === 'align') { if (this.pts.length >= 2) this.alignApply(); else A.toast(t('alignNeed')); return; }
    if (this.active === 'wipeout') { if (this.pts.length >= 3) this.wipeCommit(); else if (this.pts.length) A.toast(t('wipeMin3')); else this.cancel(); return; }
    const n = this.pts.length;
    if (this.active === 'pline' && n >= 2) { this.commit({ type: 'LWPOLYLINE', pts: this.pts.slice(), closed: false }); this.pts = []; this.step = 0; }
    else if (this.active === 'pline3d' && n >= 2) { this.commit({ type: 'POLYLINE3D', pts: this.pts.slice() }); this.pts = []; this.step = 0; }
    else if (this.active === 'face3d' && n >= 3) { this.commit({ type: '3DFACE', pts: this.pts.slice(0, 4) }); this.pts = []; this.step = 0; }
    else if (this.active === 'area' && n >= 3) { this.showArea(); this.pts = []; this.step = 0; }
    else if (this.active === 'leader' && n >= 2) { void this.finishLeader(); return; }
    else if (this.active === 'cloud' && n >= 3) { this.finishCloud(); }
    else if (this.active === 'line' || this.active === 'dist') { this.pts = []; this.step = 0; }
    else if (this.active === 'copy') { this.done(); return; }
    else if (this.active === 'matchprop') { this.cancel(); return; }   // Bitir: eşleme biter (AutoCAD'de Enter)
    this.draft = null; this.say(); A.overlay();
  }
  /** Lider: yol tamamlandığında metin sorulur, ok + kırık çizgi + yazı tek komutta eklenir */
  async finishLeader() {
    const A = this.api;
    const pts = this.pts.slice();
    const txt = await askText(t('leaderPrompt'), '', { words: true });
    if (txt) {
      const r = leaderEnts(pts, txt, this.annotOpts({}));
      if (r) this.commitMany(r.ents);
    }
    this.pts = []; this.step = 0; this.draft = null; this.say(); A.overlay();
  }
  /** Revizyon bulutu: yay yarıçapı çevrilen alanın büyüklüğünden türetilir */
  finishCloud() {
    const A = this.api;
    const pts = this.pts.slice();
    const bb = pts.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    const r = Math.max(1e-9, Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 22);
    const e = cloudEnt(pts, r, { layer: A.layer(), color: A.color(), gid: newId() });
    if (e) { this.commitMany(e); A.toast(t('cloudAdded')); } else A.toast(t('dimFail'));
    this.pts = []; this.step = 0;
  }
  close() {
    if (this.active === 'pline' && this.pts.length > 2) { this.commit({ type: 'LWPOLYLINE', pts: this.pts.slice(), closed: true }); this.pts = []; this.step = 0; this.draft = null; this.say(); this.api.overlay(); }
    else if (this.active === 'area' || this.active === 'cloud' || this.active === 'wipeout') this.finish();
  }
  /** Hizala: "Nesneler hizalama noktalarına göre ölçeklensin mi?" düğmesi (AutoCAD'in son sorusu) */
  toggleAlignScale() { if (this.active !== 'align') return; this.alignScale = !this.alignScale; this.say(); }
  /** Maske: polyline'dan (AutoCAD WIPEOUT Polyline seçeneği) — kapalı yola dokunulur */
  setWipePoly() { if (this.active !== 'wipeout' || this.pts.length) return; this.wipePoly = !this.wipePoly; this.say(); this.api.overlay(); }
  back() { this.pts.pop(); this.step = Math.max(0, this.step - 1); this.updateDraft(); this.say(); this.api.overlay(); }
  selectAll() { for (const p of this.api.visiblePrims()) if (p.k !== 4) this.api.sel.add(p); this.say(); this.api.overlay(); }
  /** Seç aracının kipi: aynı kip yeniden seçilirse dokunma kipine döner */
  setSelMode(m) { if (!this.selecting) return; this.selMode = this.selMode === m ? 'tap' : m; this.say(); this.api.overlay(); }
  /*
   * Dokunulan parçanın seçim GRUBU: grup damgası taşıyan parçalar (ölçülendirme, balon, lider) birlikte,
   * dosyadan gelen DIMENSION varlığının parçaları (aynı tanıtıcı) birlikte seçilir; öteki her şey tek başına.
   * Seç aracı da, tutamak kipindeki boşta dokunuş da bu tek tanımı kullanır.
   */
  groupOf(p) {
    const gid = p.info && p.info.gid, fdim = !gid && p.info && p.info.t === 'DIMENSION' && p.info.h;
    // Blok yerleştirmesi AutoCAD'de de tek nesnedir: bütün ilkelleri (ekleme noktası işareti hariç) birlikte seçilir
    const ins = !gid && p.info && p.info.t === 'INSERT' && p.info.h;
    return gid ? this.api.visiblePrims().filter(q => q.info && q.info.gid === gid)
      : fdim ? this.api.visiblePrims().filter(q => q.info && q.info.t === 'DIMENSION' && q.info.h === p.info.h)
        : ins ? this.api.visiblePrims().filter(q => q.k !== 4 && q.info && q.info.t === 'INSERT' && q.info.h === p.info.h) : [p];
  }
  /** Aynala: "Orijinal kalsın" düğmesi — açıkken kopya (AutoCAD <N>), kapalıyken kaynak silinir (Yes) */
  toggleMirrorKeep() { if (this.active !== 'mirror') return; this.mirrorKeep = !this.mirrorKeep; this.say(); }
  /** Aynala: X (yatay) / Y (düşey) ayna çizgisi düğmesi — aynı düğme yeniden basılınca serbest çizgiye döner */
  setMirrorAxis(ax) { if (this.active !== 'mirror' || this.selecting) return; this.mirrorAxis = this.mirrorAxis === ax ? null : ax; this.say(); this.api.overlay(); }
  /** Bölge seçimi: { rect:[x0,y0,x1,y1] } ya da { poly:[[x,y]…] }; crossing → dokunanlar da girer. Eklenen sayı döner. */
  selectRegion(shape, crossing) {
    if (this.active === 'stretch') this.region = { shape, crossing };   // AutoCAD STRETCH: pencerenin İÇİNDEKİ köşeler taşınır
    const A = this.api, list = A.selectable ? A.selectable() : A.visiblePrims();
    let n = 0;
    for (const p of list) {
      if (p.k === 4 || p.inf || A.sel.has(p) || !p.bb || !isFinite(p.bb[0])) continue;
      const hit = shape.rect ? (crossing ? primCrossesRect(p, shape.rect) : bboxInRect(p.bb, shape.rect)) : (crossing ? primCrossesPoly(p, shape.poly) : primInPoly(p, shape.poly));
      if (hit) { A.sel.add(p); n++; }
    }
    this.say(); A.overlay();
    return n;
  }

  /*
   * ÇOKGEN (AutoCAD POLYGON, Inscribed): çembere iç teğet düzgün çokgen. Kenar sayısı önce sorulur
   * (boş Enter = son değer ya da 6), merkez dokunuşla, yarıçap köşe dokunuşuyla (ilk köşe o yönde) ya
   * da yazılan sayıyla (ilk köşe 0°'de). Sonuç kapalı LWPOLYLINE; araç sürer.
   */
  buildPolygon(c, r, a0) {
    const n = this.sides || this.lastVal.polygon || 6;
    if (!(r > 0)) { this.api.toast(t('numberExpected')); return; }
    const pts = [];
    for (let i = 0; i < n; i++) { const a = a0 + i * TAU / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2] || 0]); }
    this.commit({ type: 'LWPOLYLINE', closed: true, pts });
    this.pts = []; this.step = 0; this.draft = null;
  }
  /** Böl / Aralıkla: dokunulan yol saklanır (yaylar düzleştirilir), sayı istenir; MEASURE dokunulan uca yakın taraftan başlar (AutoCAD) */
  pathTap(w) {
    const A = this.api;
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (p.k !== 0 || !p.ops || p.ops.length < 2) { A.toast(t('notPath')); return; }
    const pts = flatten(p.ops).map(q => [q[0], q[1]]);
    if (p.closed && pts.length > 1) pts.push([pts[0][0], pts[0][1]]);
    if (pts.length < 2) { A.toast(t('notPath')); return; }
    const d0 = Math.hypot(w[0] - pts[0][0], w[1] - pts[0][1]), d1 = Math.hypot(w[0] - pts[pts.length - 1][0], w[1] - pts[pts.length - 1][1]);
    if ((this.active === 'measure' || this.active === 'arraypath') && !p.closed && d1 < d0) pts.reverse();   // dokunulan uçtan başlar
    const z = (p.ops[0] && typeof p.ops[0][3] === 'number' && isFinite(p.ops[0][3])) ? p.ops[0][3] : 0;
    this.c1 = { key: p.key, pts, z, closed: !!p.closed };
    this.draft = { segs: pts.slice(1).map((q, i) => [[pts[i][0], pts[i][1], z], [q[0], q[1], z]]), keep: true };
    this.step = 1; this.say(); A.overlay();
    if (this.active === 'arraypath') void this.runArray({ path: this.c1 });   // yol seçildi: sayı / aralık formu
  }
  /*
   * DIVIDE: n eşit parça → n−1 iç nokta (kapalı yolda n nokta, başlangıç köşesi dâhil).
   * MEASURE: d, 2d, 3d … uzaklıklarında noktalar (yol boyunu aşmaz). Noktalar POINT nesnesidir, geçerli katmandadır (AutoCAD gibi).
   */
  placePoints(v) {
    const A = this.api, c = this.c1;
    if (!c) { this.step = 0; this.say(); return; }
    let L = 0; for (let i = 1; i < c.pts.length; i++) L += Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1]);
    const dists = [];
    if (this.active === 'divide') {
      const n = Math.round(v);
      if (!(n >= 2)) { A.toast(t('divideMin')); return; }
      for (let i = 1; i < n + (c.closed ? 1 : 0); i++) dists.push(L * i / n);
    } else {
      if (!(v > 0)) { A.toast(t('numberExpected')); return; }
      for (let d = v; d < L - 1e-9; d += v) { dists.push(d); if (dists.length > 100000) break; }
      if (!dists.length) { A.toast(t('spacingTooLong')); return; }
    }
    const pts = pathPointsAt(c.pts, dists);
    if (!pts.length) { A.toast(t('notPath')); return; }
    this.commitMany(pts.map(q => ({ type: 'POINT', pts: [[q[0], q[1], c.z]] })));
    this.lastVal[this.active] = v;
    A.toast(t('pointsPlaced').replace('%s', A.fmt(pts.length, 0)));
    this.c1 = null; this.draft = null; this.step = 0; this.say(); A.overlay();
  }
  /** Özellik eşle (MATCHPROP): ilk dokunuş kaynak (katman, renk, çizgi tipi), sonrakiler hedef; ölçü grubu bütün olarak alır */
  /*
   * KAYNAĞI DOĞRUDAN ALMA. Uzun basış menüsünden ÖZELLİK EŞLE gelince kullanıcı nesneyi zaten
   * seçmiştir; AutoCAD'de de MATCHPROP seçimi kaynak sayar. Dokunuş yolu ile menü yolu aynı
   * gövdeyi kullansın diye kaynak kurulumu buraya ayrıldı.
   */
  matchSrc(p) {
    const A = this.api;
    if (!p || this.active !== 'matchprop') return false;
    this.src = { key: p.key, layer: p.lay, color: p.info && p.info.ci != null ? p.info.ci : 256, lt: p.lt || '' };
    this.draft = p.k === 0 ? { segs: segmentsOf(p).segs.map(q => [[q[0], q[1], 0], [q[2], q[3], 0]]), keep: true } : null;
    this.step = 1; this.say(); A.overlay();
    A.toast(t('matchSource').replace('%s', p.lay), 1600);
    return true;
  }
  matchTap(w) {
    const A = this.api;
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (this.step === 0 || !this.src) { this.matchSrc(p); return; }
    const keys = this.groupOf(p).map(q => q.key).filter(k => k !== this.src.key);
    if (!keys.length) return;
    if (A.run({ op: 'props', keys, layer: this.src.layer, color: this.src.color, lt: this.src.lt })) { A.render(); A.toast(t('applied') + ' · ' + keys.length, 1200); }
    else A.toast(t('error'));
  }
  // ---- v7.72: hizalama, blok, öznitelik, maske, çizim sırası, dinamik parametre -------------------------------
  /** ALIGN: 1 çift → taşı; 2 çift → taşı + döndür (+ ölçek düğmesi açıksa hedef / kaynak aralığı oranında ölçek) */
  alignApply() {
    const A = this.api, P = this.pts;
    const pairs = [[P[0], P[1]]]; if (P.length >= 4) pairs.push([P[2], P[3]]);
    const m = alignMatrix(pairs, this.alignScale);
    if (!m) { A.toast(t('alignFail')); this.pts = []; this.step = 1; this.say(); A.overlay(); return; }
    this.xform(m, (P[1][2] || 0) - (P[0][2] || 0));
    this.done();
  }
  /** BLOCK: seçim + taban noktası → ad ve kip formu → tanım (+ seçimi bloğa çevir / koru / sil) */
  async blockMake(base) {
    const A = this.api;
    const sel = [...A.sel].filter(p => p.k !== 4);
    if (!sel.length) { A.toast(t('selEmpty')); this.cancel(); return; }
    const last = this.lastVal.block || {};
    const r = await askForm(toolName('block'), [
      { id: 'name', label: t('blockName'), type: 'text', value: '' },
      { id: 'mode', label: t('blkMode'), type: 'select', value: last.mode || 'convert', options: [['convert', t('blkConvert')], ['retain', t('blkRetain')], ['delete', t('blkDelete')]] },
      { id: 'lib', label: t('blkAlsoLib'), type: 'check', value: false },
    ], { ok: t('ok'), hint: t('blkMakeHint') });
    if (!r || this.active !== 'block') { this.cancel(); return; }
    const name = String(r.name || '').trim();
    if (!name) { A.toast(t('blkNameNeeded')); this.cancel(); return; }
    if (A.blockDef && A.blockDef(name) && !(await askConfirm(t('blkOverwriteAsk').replace('%s', name)))) { this.cancel(); return; }
    this.lastVal.block = { mode: r.mode };
    const n = A.blockMake ? A.blockMake(name, sel, base, r.mode, !!r.lib) : 0;
    if (n) A.toast(t('blkMade').replace('%s', name) + ' \u00b7 ' + n); else A.toast(t('error'));
    A.render();
    this.cancel();
  }
  /** INSERT: blok (çizimdeki tanımlar + kütüphane), ölçek, dönüş, patlat, satır / sütun (MINSERT) formu; sonra ekleme noktası */
  async insertStart() {
    const A = this.api;
    const names = A.blockNames ? A.blockNames() : [];
    if (!names.length) { A.toast(t('blkNoneDef')); this.cancel(); return; }
    const last = this.lastVal.insert || {};
    const cur = names.some(x => x[0] === last.name) ? last.name : names[0][0];
    this.say();
    const r = await askForm(toolName('insert'), [
      { id: 'name', label: t('blockName'), type: 'select', value: cur, options: names },
      { id: 'scale', label: t('blockScale'), type: 'number', value: last.scale || 1 },
      { id: 'rot', label: t('blockRot'), type: 'number', value: last.rot || 0 },
      { id: 'explode', label: t('blkExplodeOnInsert'), type: 'check', value: false },
      { id: 'cols', label: t('arrayCols'), type: 'number', value: 1 },
      { id: 'rows', label: t('arrayRows'), type: 'number', value: 1 },
      { id: 'dx', label: t('arrayDx'), type: 'number', value: 0 },
      { id: 'dy', label: t('arrayDy'), type: 'number', value: 0 },
    ], { ok: t('ok'), hint: t('blkInsertHint2') });
    if (!r || this.active !== 'insert') { if (this.active === 'insert') this.cancel(); return; }
    let name = String(r.name || '');
    if (name.startsWith('lib:')) {   // kütüphane bloğu önce çizime benimsenir (tanım tablosuna girer), sonra yerleştirilir
      name = name.slice(4);
      const ok = A.blockFromLib ? await A.blockFromLib(name) : false;
      if (!ok) { A.toast(t('error')); this.cancel(); return; }
    } else if (name.startsWith('dwg:')) {   // DWG'den gelen (düzleştirilmiş) blok: bir yerleştirmesinden tanım benimsenir
      name = name.slice(4);
      const ok = A.blockAdopt ? A.blockAdopt(name) : false;
      if (!ok) { A.toast(t('error')); this.cancel(); return; }
    }
    if (!(A.blockDef && A.blockDef(name))) { A.toast(t('blkNoneDef')); this.cancel(); return; }
    this.ins = { name, scale: r.scale, rot: r.rot, explode: !!r.explode, cols: r.cols, rows: r.rows, dx: r.dx, dy: r.dy };
    this.lastVal.insert = { name, scale: r.scale, rot: r.rot };
    this.step = 1; this.say(); A.overlay();
  }
  async insertPlace(p) {
    const A = this.api, o = this.ins;
    if (!o) { this.cancel(); return; }
    const def = A.blockDef(o.name);
    if (!def) { A.toast(t('blkNoneDef')); this.cancel(); return; }
    const sc = isFinite(o.scale) && o.scale ? o.scale : 1, rot = (isFinite(o.rot) ? o.rot : 0) * D2R;
    // Öznitelikler: sabit (bayrak 2) olmayan her tanım sorulur (AutoCAD ATTDIA=1 kutusu)
    const attdefs = (def.ents || []).filter(e => e && e.type === 'ATTDEF');
    const ask = attdefs.filter(a => !((a.flags | 0) & 2));
    let attrs;
    if (ask.length) {
      const fields = ask.map((a, i) => ({ id: 'a' + i, label: a.prompt || a.tag || ('#' + (i + 1)), type: 'text', value: a.text == null ? '' : String(a.text) }));
      const r = await askForm(t('attrEdit') + ' \u2014 ' + def.name, fields, { ok: t('ok') });
      if (!r) { this.say(); return; }   // vazgeçildi: ekleme noktası yeniden beklenir
      attrs = attdefs.map(a => { const i = ask.indexOf(a); return [a.tag || '', i >= 0 ? String(r['a' + i] == null ? '' : r['a' + i]) : String(a.text == null ? '' : a.text)]; });
    }
    const cols = Math.max(1, Math.round(o.cols || 1)), rows = Math.max(1, Math.round(o.rows || 1));
    if (cols * rows > 10000) { A.toast(t('arrayTooMany')); return; }
    const cs = Math.cos(rot), sn = Math.sin(rot), ents = [];
    for (let ri = 0; ri < rows; ri++) for (let ci = 0; ci < cols; ci++) {
      // MINSERT: satır / sütun aralıkları bloğun (dönmüş) eksenleri boyunca ölçülür
      const ox = ci * (o.dx || 0), oy = ri * (o.dy || 0);
      const x = p[0] + ox * cs - oy * sn, y = p[1] + ox * sn + oy * cs;
      ents.push({ type: 'INSERT', id: newId(), name: def.name, layer: A.layer(), color: A.color(), x, y, z: p[2] || 0, rot, sx: sc, sy: sc, m: [cs * sc, sn * sc, -sn * sc, cs * sc, x, y], attrs });
    }
    const cmd = o.explode ? { op: 'group', cmds: [{ op: 'add', ents }, ...ents.map(e => ({ op: 'explode', h: e.id }))] } : { op: 'add', ents };
    if (!A.run(cmd)) { A.toast(t('error')); this.cancel(); return; }
    A.render();
    A.toast(t('blockInserted') + ' \u00b7 ' + def.name + (ents.length > 1 ? ' \u00d7 ' + ents.length : ''));
    this.cancel();   // AutoCAD INSERT tek yerleştirmeyle biter
  }
  /** ATTDEF: konum dokunuşu → etiket, istem, öntanımlı değer, yükseklik, dönüş, görünmez / sabit bayrakları → ATTDEF varlığı */
  async attdefAt(p) {
    const A = this.api;
    const r = await askForm(toolName('attdef'), [
      { id: 'tag', label: t('tag'), type: 'text', value: '' },
      { id: 'prompt', label: t('attPrompt'), type: 'text', value: '' },
      { id: 'text', label: t('attDefault'), type: 'text', value: '' },
      { id: 'h', label: t('textHeightPrompt'), type: 'number', value: A.textHeight() },
      { id: 'rot', label: t('rotation'), type: 'number', value: 0 },
      { id: 'invisible', label: t('attInvisible'), type: 'check', value: false },
      { id: 'constant', label: t('attConstant'), type: 'check', value: false },
    ], { ok: t('ok'), hint: t('attdefHint') });
    if (!r || this.active !== 'attdef') return;
    const tag = String(r.tag || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!tag) { A.toast(t('attTagNeeded')); this.say(); return; }
    const flags = (r.invisible ? 1 : 0) | (r.constant ? 2 : 0);
    this.commit({ type: 'ATTDEF', tag, prompt: String(r.prompt || ''), text: String(r.text == null ? '' : r.text), pts: [p], h: r.h > 0 ? r.h : A.textHeight(), rot: (isFinite(r.rot) ? r.rot : 0) * D2R, flags });
    A.toast(t('attdefAdded') + ': ' + tag);
    this.say(); A.overlay();
  }
  /** WIPEOUT: köşelerden maske (kapalı çokgen, arka plan rengiyle dolu) */
  wipeCommit() {
    const A = this.api;
    this.commit({ type: 'WIPEOUT', pts: this.pts.slice() });
    A.toast(t('wipeAdded'));
    this.pts = []; this.step = 0; this.draft = null; this.say(); A.overlay();
  }
  /** WIPEOUT Polyline: kapalı yol maske olur; polyline silinsin mi sorulur (AutoCAD "Erase polyline? <No>") */
  async wipeFromPoly(p) {
    const A = this.api;
    if (p.k !== 0 || !p.closed || !p.ops || p.ops.length < 3) { A.toast(t('wipeNotClosed')); return; }
    const pts = flatten(p.ops).map(q => [q[0], q[1], (p.ops[0] && p.ops[0][3]) || 0]);
    if (pts.length < 3) { A.toast(t('wipeNotClosed')); return; }
    const erase = await askConfirm(t('wipeErasePoly'));
    const ent = { id: newId(), type: 'WIPEOUT', pts, layer: A.layer(), color: A.color() };
    const ok = erase ? A.run({ op: 'group', cmds: [{ op: 'add', ents: [ent] }, { op: 'delete', keys: [p.key] }] }) : A.run({ op: 'add', ents: [ent] });
    if (ok) { A.render(); A.toast(t('wipeAdded')); }
    this.wipePoly = false; this.say(); A.overlay();
  }
  /** DRAWORDER: seçim bitince kip sorulur; öne / arkaya hemen uygulanır, üstüne / altına başvuru nesnesi ister */
  async drawOrderNext() {
    const A = this.api;
    if (!A.sel.size) { A.toast(t('selEmpty')); this.cancel(); return; }
    this.step = 1; this.say();
    const r = await askForm(toolName('draworder'), [{ id: 'mode', label: t('droMode'), type: 'select', value: this.lastVal.droMode || 'front', options: [['front', t('droFront')], ['back', t('droBack')], ['above', t('droAbove')], ['below', t('droBelow')]] }], { ok: t('ok'), hint: t('droHint') });
    if (!r || this.active !== 'draworder') { this.cancel(); return; }
    this.lastVal.droMode = r.mode;
    if (r.mode === 'front' || r.mode === 'back') { this.drawOrderRun(r.mode, null); return; }
    this.dro = r.mode; this.step = 1; this.say(); A.overlay();
  }
  drawOrderRef(p) {
    if (this.api.sel.has(p)) { this.api.toast(t('droSelfRef')); return; }
    this.drawOrderRun(this.dro, p.key);
  }
  drawOrderRun(mode, ref) {
    const A = this.api, keys = [...A.sel].map(p => p.key);
    if (!keys.length) { this.cancel(); return; }
    if (A.run({ op: 'draworder', keys, mode, ref })) { A.render(); A.toast(t('droDone').replace('%s', String(keys.length))); }
    else A.toast(t('error'));
    this.done();
  }
  /*
   * BLOK PARAMETRESİ (yalnız blok düzenleyicide): seçim (etkilenecek nesneler; boş = hepsi) → tür / ad formu →
   * türe göre noktalar: çevirme ekseni (2), döndürme merkezi (1), doğrusal taban + uç (2) + esnetmede çerçeve (2),
   * nokta tabanı (1); görünürlük durumları formdan (nokta yok). Parametre tanımın dyn.params listesine girer,
   * yerleştirmelerde tutamak olarak görünür.
   */
  async bparamNext() {
    const A = this.api;
    if (!A.bparamAdd || (A.inBedit && !A.inBedit())) { A.toast(t('bparamOnlyBedit')); this.cancel(); return; }   // ana belgede form açılmaz, hemen uyarır
    const keys = [...A.sel].filter(p => p.k !== 4).map(p => p.key);
    this.step = 1; this.say();
    const last = this.lastVal.bparam || {};
    const r = await askForm(toolName('bparam'), [
      { id: 'kind', label: t('bpKind'), type: 'select', value: last.kind || 'linear', options: [['linear', t('bpLinear')], ['rot', t('bpRot')], ['flip', t('bpFlip')], ['point', t('bpPoint')], ['vis', t('bpVis')]] },
      { id: 'label', label: t('bpLabel'), type: 'text', value: '' },
      { id: 'mode', label: t('bpMode'), type: 'select', value: last.mode || 'stretch', options: [['stretch', t('bpStretch')], ['move', t('bpMove')]] },
      { id: 'states', label: t('bpStates'), type: 'text', value: 'A, B' },
    ], { ok: t('ok'), hint: t('bpHint') });
    if (!r || this.active !== 'bparam') { this.cancel(); return; }
    this.lastVal.bparam = { kind: r.kind, mode: r.mode };
    const prm = { kind: r.kind, label: String(r.label || '').trim() || r.kind, ents: keys.length ? keys : null, mode: r.mode, pts: [] };
    if (r.kind === 'vis') {
      const states = String(r.states || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
      if (states.length < 2) { A.toast(t('bpStatesMin')); this.cancel(); return; }
      prm.states = states; prm.def = states[0];
      this.bparamCommit(prm); return;
    }
    this.prm = prm; this.pts = []; this.step = 1; this.say(); A.overlay();
    A.toast(t(r.kind === 'flip' ? 'bpFlipPts' : r.kind === 'linear' ? 'bpLinearPts' : r.kind === 'rot' ? 'bpRotPt' : 'bpPointPt'), 2600);
  }
  async bparamPoint(p) {
    const A = this.api, prm = this.prm;
    if (!prm) { this.cancel(); return; }
    prm.pts.push([p[0], p[1]]);
    const n = prm.pts.length;
    const need = prm.kind === 'flip' ? 2 : prm.kind === 'linear' ? (prm.mode === 'stretch' ? 4 : 2) : 1;
    if (n < need) { this.draft = { pts: prm.pts.map(q => [q[0], q[1], 0]) }; this.say(); A.overlay(); if (prm.kind === 'linear' && n === 2) A.toast(t('bpFramePts'), 2600); return; }
    if (prm.kind === 'flip') { prm.a = prm.pts[0]; prm.b = prm.pts[1]; prm.def = false; }
    else if (prm.kind === 'rot') { prm.base = prm.pts[0]; prm.def = 0; prm.r = A.bparamRadius ? A.bparamRadius(prm.base) : 1; }
    else if (prm.kind === 'point') { prm.base = prm.pts[0]; prm.def = [0, 0]; }
    else { prm.base = prm.pts[0]; prm.end = prm.pts[1]; prm.def = Math.hypot(prm.end[0] - prm.base[0], prm.end[1] - prm.base[1]); if (prm.mode === 'stretch') { const [c, d] = [prm.pts[2], prm.pts[3]]; prm.frame = [Math.min(c[0], d[0]), Math.min(c[1], d[1]), Math.max(c[0], d[0]), Math.max(c[1], d[1])]; } }
    this.bparamCommit(prm);
  }
  bparamCommit(prm) {
    const A = this.api;
    delete prm.pts;
    const ok = A.bparamAdd(prm);
    A.toast(ok ? t('bpAdded').replace('%s', prm.label) : t('error'));
    A.sel.clear(); this.cancel();
  }
  /** Görünürlük durumu ataması: seçili nesneler yalnız seçilen durumda görünür ("hepsi" → her durumda) */
  async bvstateNext() {
    const A = this.api;
    if (!A.bvstateSet || (A.inBedit && !A.inBedit())) { A.toast(t('bparamOnlyBedit')); this.cancel(); return; }
    const states = A.bvstates ? A.bvstates() : [];
    if (!states.length) { A.toast(t('bpNoVis')); this.cancel(); return; }
    const keys = [...A.sel].filter(p => p.k !== 4).map(p => p.key);
    if (!keys.length) { A.toast(t('selEmpty')); this.cancel(); return; }
    this.step = 1; this.say();
    const r = await askForm(toolName('bvstate'), [{ id: 'state', label: t('bpState'), type: 'select', value: states[0], options: [['*', t('bpAllStates')], ...states.map(s => [s, s])] }], { ok: t('ok') });
    if (!r || this.active !== 'bvstate') { this.cancel(); return; }
    const n = A.bvstateSet(keys, r.state === '*' ? null : r.state);
    A.toast(t('bpStateSet').replace('%s', String(n)));
    A.sel.clear(); this.cancel();
  }
  /*
   * BİRLEŞTİR (AutoCAD JOIN): uçları değen açık yollar (çizgi, polyline, yay) tek yol olur. Zincir greedy kurulur:
   * ucuna değen parça eklenir, gerekirse ters çevrilir (yaylarda yön de döner); zincir başa dönerse kapanır.
   * Değmeyen parçalar dışarıda kalır ve söylenir. Sonuç ilk parçanın katman ve rengini alır; tek geri alma adımı ('replace').
   */
  runJoin() {
    const A = this.api;
    const paths = [...A.sel].filter(p => p.k === 0 && !p.closed && !p.fill && p.ops && p.ops.length >= 2 && !p.ops.some(o => o[0] === 3) && !(p.info && p.info.t === 'DIMENSION'));
    if (paths.length < 2) { A.toast(t('joinNone')); return; }
    const ext = paths.reduce((m, p) => Math.max(m, p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]), 1);
    const tol = Math.max(1e-9, ext * 1e-6);
    const endsOf = (ops) => { const pts = flatten(ops); return [pts[0], pts[pts.length - 1]]; };
    const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
    let chain = paths[0].ops.map(o => o.slice());
    const used = new Set([paths[0]]);
    let grew = true;
    while (grew) {
      grew = false;
      const [cs, ce] = endsOf(chain);
      for (const p of paths) {
        if (used.has(p)) continue;
        const [ps, pe] = endsOf(p.ops);
        if (same(ce, ps)) { chain = chain.concat(p.ops.slice(1).map(o => o.slice())); }
        else if (same(ce, pe)) { chain = chain.concat(reverseOps(p.ops).slice(1)); }
        else if (same(cs, pe)) { chain = p.ops.map(o => o.slice()).concat(chain.slice(1)); }
        else if (same(cs, ps)) { chain = reverseOps(p.ops).concat(chain.slice(1)); }
        else continue;
        used.add(p); grew = true; break;
      }
    }
    if (used.size < 2) { A.toast(t('joinNone')); return; }
    const [s0, e0] = endsOf(chain);
    let closed = false;
    if (chain.length > 2 && same(s0, e0)) { closed = true; const last = chain[chain.length - 1]; if (last[0] === 1) chain.pop(); }
    const first = paths[0];
    const keys = [...used].map(p => p.key);
    const ent = { id: newId(), type: 'PATH', ops: chain, closed, layer: first.lay, color: first.info && first.info.ci != null ? first.info.ci : 256 };
    if (!A.run({ op: 'replace', keys, ents: [ent] })) { A.toast(t('error')); return; }
    A.render();
    const left = paths.length - used.size;
    A.toast(t('joinDone').replace('%s', String(used.size)) + (left ? ' · ' + t('joinLeft').replace('%s', String(left)) : ''), 2600);
    A.sel.clear();
    this.cancel();
  }
  /*
   * ESNET (AutoCAD STRETCH): kesen pencerenin içindeki köşeler (moveTo / lineTo uçları, yay ve elips merkezleri)
   * taşınır, dışındakiler yerinde kalır. Bütün köşeleri içerde olan ya da dokunarak seçilmiş (pencere yok) nesne
   * bütün olarak taşınır. Yol dışı nesneler (yazı, nokta, resim, ağ) tutamak noktası içerdeyse; ölçü grubu bir parçası
   * içerdeyse bütün olarak. Tek geri alma adımı ('group': xform + reshape).
   */
  runStretch() {
    const A = this.api, [a, b] = this.pts, dx = b[0] - a[0], dy = b[1] - a[1];
    const shape = this.region && this.region.shape;
    const inside = (x, y) => !shape || (shape.rect ? (x >= shape.rect[0] && x <= shape.rect[2] && y >= shape.rect[1] && y <= shape.rect[3]) : pointInPoly(shape.poly, x, y));
    const anchor = (p) => (p.k === 1 || p.k === 2 ? [p.x, p.y] : [(p.bb[0] + p.bb[2]) / 2, (p.bb[1] + p.bb[3]) / 2]);
    const gidIn = new Map();
    for (const p of A.sel) { const g = p.info && p.info.gid; if (!g) continue; const q = anchor(p); if (inside(q[0], q[1]) || (p.k === 0 && p.ops.some(o => inside(o[1], o[2])))) gidIn.set(g, true); }
    const keys = [], items = [];
    for (const p of A.sel) {
      const g = p.info && p.info.gid;
      if (g) { if (gidIn.get(g)) keys.push(p.key); continue; }
      if (p.k === 0) {
        let moved = 0;
        const ops = p.ops.map(o => { if (!inside(o[1], o[2])) return o.slice(); moved++; const q = o.slice(); q[1] += dx; q[2] += dy; return q; });
        if (moved === p.ops.length) keys.push(p.key); else if (moved) items.push({ key: p.key, ops });
        continue;
      }
      const q = anchor(p);
      if (inside(q[0], q[1])) keys.push(p.key);
    }
    const cmds = [];
    if (keys.length) cmds.push({ op: 'xform', keys, m: [1, 0, 0, 1, dx, dy], dz: 0 });
    if (items.length) cmds.push({ op: 'reshape', items });
    if (!cmds.length) { A.toast(t('stretchNone')); this.pts = []; this.step = 1; this.say(); A.overlay(); return; }
    if (!A.run(cmds.length === 1 ? cmds[0] : { op: 'group', cmds })) { A.toast(t('error')); return; }
    A.render();
    this.done();
  }

  updateDraft() {
    const pts = this.pts;
    if (['pline', 'pline3d', 'area', 'line', 'dist', 'face3d', 'mirror', 'leader', 'cloud', 'dim', 'dimh', 'dimv', 'wipeout', 'xclip'].includes(this.active)) this.draft = { pts: pts.slice(), segs: pts.slice(1).map((q, i) => [pts[i], q]), close: ['area', 'face3d', 'cloud', 'wipeout'].includes(this.active) };
    else if (this.active === 'align') this.draft = { pts: pts.slice(), segs: pts.length >= 2 ? [[pts[0], pts[1]], ...(pts.length >= 4 ? [[pts[2], pts[3]]] : [])] : [] };   // kaynak → hedef okları
    else if (this.active === 'rect' && pts.length === 1) this.draft = { pts: pts.slice() };
    else if ((this.active === 'circle' || this.active === 'polygon') && pts.length === 1) this.draft = { pts: pts.slice() };
    else if (this.active === 'arc3') this.draft = { pts: pts.slice(), segs: pts.slice(1).map((q, i) => [pts[i], q]) };
    else if (['move', 'copy', 'rotate', 'scale', 'stretch'].includes(this.active)) this.draft = { pts: pts.slice() };
    else if (this.active === 'angle' || this.active === 'dima') this.draft = { pts: pts.slice(), segs: pts.slice(1).map(q => [pts[0], q]) };
  }
  showDist() {
    const A = this.api, m = this.pts, u = A.units();
    if (m.length < 2) return;
    const rows = []; let total = 0, total3 = 0;
    for (let i = 1; i < m.length; i++) {
      const d = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]), dz = (m[i][2] || 0) - (m[i - 1][2] || 0), d3 = Math.hypot(d, dz);
      total += d; total3 += d3;
      const ang = Math.atan2(m[i][1] - m[i - 1][1], m[i][0] - m[i - 1][0]) * R2D;
      rows.push([`${i} → ${i + 1}`, `${A.fmt(d)}${u}  ΔX ${A.fmt(m[i][0] - m[i - 1][0])}  ΔY ${A.fmt(m[i][1] - m[i - 1][1])}` + (dz ? `  ΔZ ${A.fmt(dz)}  3B ${A.fmt(d3)}${u}` : '') + `  ${A.fmt(ang, 2)}°` + (A.unitToM() && A.unitToM() !== 1 ? `  = ${A.fmt(d * A.unitToM(), 2)} m` : '')]);
    }
    if (m.length > 2) rows.push([t('total'), A.fmt(total) + u + (total3 !== total ? ` (3B ${A.fmt(total3)}${u})` : '')]);
    A.result(rows);
  }
  showArea() {
    const A = this.api, m = this.pts, u = A.units();
    const area = polyArea(m), per = pathLength3(m.map((q, i) => [i ? 1 : 0, q[0], q[1]]), true);
    const rows = [[t('area'), A.fmt(area) + (u ? u + '²' : '')], [t('perimeter'), A.fmt(per) + u], [t('cornersN'), m.length]];
    if (A.unitToM() && A.unitToM() !== 1) rows.push([t('areaM2'), A.fmt(area * A.unitToM() ** 2, 2) + ' m²'], [t('areaDa'), A.fmt(area * A.unitToM() ** 2 / 1000, 3) + ' da']);
    else if (A.unitToM() === 1) rows.push([t('areaDa'), A.fmt(area / 1000, 3) + ' da'], [t('areaHa'), A.fmt(area / 10000, 4) + ' ha']);
    A.result(rows);
    this.draft = { pts: m.slice(), segs: m.slice(1).map((q, i) => [m[i], q]), close: true, keep: true };
  }
}

// ---- yardımcılar ------------------------------------------------------------------------
/**
 * Yolun yönünü ters çevirir (JOIN için). Her opun bitiş noktası bir öncekinin başlangıcı olur; yaylar yön değiştirir:
 * [2,…,a0,a1] (saat yönünün tersi a0→a1) → [-2,…,a1,a0] ve tersi. Elips (3) taşınmaz; çağıran onları eler.
 */
export function reverseOps(ops) {
  const ends = []; let lx = 0, ly = 0, lz = 0;
  for (const o of ops) {
    if (o[0] === 0 || o[0] === 1) { lx = o[1]; ly = o[2]; lz = o[3] || 0; }
    else if (o[0] === 2 || o[0] === -2) { lx = o[1] + o[3] * Math.cos(o[5]); ly = o[2] + o[3] * Math.sin(o[5]); lz = o[6] || 0; }
    ends.push([lx, ly, lz]);
  }
  const last = ends[ends.length - 1];
  const out = [[0, last[0], last[1], last[2]]];
  for (let i = ops.length - 1; i >= 1; i--) {
    const o = ops[i], prev = ends[i - 1];
    if (o[0] === 1) out.push([1, prev[0], prev[1], prev[2]]);
    else if (o[0] === 2) out.push([-2, o[1], o[2], o[3], o[5], o[4], o[6] || 0]);
    else if (o[0] === -2) out.push([2, o[1], o[2], o[3], o[5], o[4], o[6] || 0]);
  }
  return out;
}
export function rotM(c, a) { const cs = Math.cos(a), sn = Math.sin(a); return [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]]; }
export function mirrorM(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const A = (dx * dx - dy * dy) / L2, B = 2 * dx * dy / L2;
  // yansıma: p' = R (p - a) + a
  return [A, B, B, -A, a[0] - A * a[0] - B * a[1], a[1] - B * a[0] + A * a[1]];
}
export function arc3(p1, p2, p3) {
  const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  let a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  // orta nokta yay üzerinde olacak şekilde yön seç (saat yönü tersi a0→a1)
  const n = (v) => ((v % TAU) + TAU) % TAU;
  const inCcw = n(am - a0) <= n(a1 - a0);
  if (!inCcw) [a0, a1] = [a1, a0];
  return { cx: ux, cy: uy, r, a0, a1 };
}
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
