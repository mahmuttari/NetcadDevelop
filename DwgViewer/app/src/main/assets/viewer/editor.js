/*
 * Düzenleyici ve kabuk bağlayıcısı (v4):
 *   - şerit araç çubuğu: sekmeler › gruplar › karolar (SVG simge + etiket), sık kullanılanlar sekmesi,
 *     uzun basış ipucu/açılır kutu, etkin sekmeye ikinci dokunuşla katlama, yatayda dikey ray
 *   - Ekran sekmesi: 2B (tema, güneş, görünürlük, çizgi, ızgara…) ve 3B (stil, renk, ışık, kesit, Z abartı, döner tabla…)
 *   - komut satırı, ToolManager, EditDoc (geri al/yinele), DXF kaydetme
 *   - 3B görünüm: View3D + görünüm küpü + kamera yer imleri + HUD
 *   - alt sayfa tutamakları, durum çubuğu hızlı düğmeleri, erişilebilirlik ayarları (ui), tanıtım turu, klavye
 * app.js, initEditor(api) ile bağlar; api: { S, requestRender, drawOverlay, toast, pick, snap, showInfo,
 *   openDoc, hide, show, esc, kv, copyText, buildLayerList, fmt, store, RTree, baseName, zoomExtents, tracePath, action,
 *   savePng, zoomBy, zoomWindow, viewHistory, gotoCoord, fitPrims, isolateLayers, unisolate, settings, stamp, haptic,
 *   openDisplayOptions, setDisplay, getDisplay, toggleDisplay, display }
 */
import { ToolManager, TOOLS, rotM, mirrorM } from './tools.js';
import { EditDoc, writeDxf, newId, entsToPrims } from './edit.js';
import { View3D } from './view3d.js';
import { openView3DOptions, buildViewCube, openCameraBookmarks, renderZScale, renderClip } from './view3d_panel.js';
import { FG, ACI } from './scene.js';
import { toScreen, toWorld, fmt, store } from './state.js';
import { bgColor, fgColor } from './render.js';
import { t, applyI18n, addStrings } from './i18n.js';
import { TAU, meshMetrics, mul, flatten, HATCH_PATTERNS } from './geom.js';
import * as D from './display.js';
import { askText, askForm, askConfirm } from './dialog.js';
import { leaderEnts, hatchEnts } from './annot.js';
import * as Gz from './gizmo.js';
import { has, gate, need, rank, tier, tierName, lockAttr, lockBadge, lockBadgeFor, openProPanel } from './edition.js';
import { cmdOf, namesOf, repeatable, resolve as acadResolve, suggest as acadSuggest, COMMANDS as ACAD } from './acad.js';
import * as Desk from './desktop.js';
import * as B from './blocks.js';
import { primToEnt, listBlocks, loadBlock, saveBlock, entsBBox } from './blocklib.js';
/*
 * NESNE YAKALAMA. İşaretleri (kare, üçgen, çember…) 2B ile 3B aynı çiziciden alır: kullanıcı
 * END'i iki boyutta nasıl tanıyorsa üç boyutta da aynı simgeden tanır. osnap3.js saf modüldür —
 * kamera, WebGL ve DOM bilmez; ekran izdüşümünü işlev olarak alır.
 */
import { drawMarker as snapMarker, markerSvg as snapMarkerSvg, nameOf as snapModeName } from './osnap.js';
import { MODES3, DEFAULT_MODES3, snap3 } from './osnap3.js';
import { regionPick3 } from './sel3.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };
let api, S, tools, doc = null, v3 = null;
const ed = { is3D: () => !!(v3 && !$('cv3d').hidden), tools: null, doc: null, curLayer: '0', curColor: 256, tab: 'view', sel: new Set(), result: null, m3: null, curPattern: { name: 'SOLID', scale: 0, angle: 0 } };   // ölçek 0 = otomatik

// ---------------------------------------------------------------------------------
// Kullanım tercihleri (ui) — kalıcı anahtar 'ui'
// ---------------------------------------------------------------------------------
const UI_DEFAULTS = { favs: [], tbCollapsed: { portrait: false, landscape: false }, hints: {}, fontScale: 1, glove: false, leftHand: false, contrast: false, reduceMotion: false, haptics: true, dpad: false, compactStatus: false, denseBars: true, free3: false, snapPick: true, showLocked: true, gizmo: true, infoTap: true, infoFull: false, pick3: 'auto', snap3: true, snap3Modes: DEFAULT_MODES3.slice(), grips: false, palmReject: true, penHover: true, penPressure: true, penDraw: false, penBarrel: 'menu', cmdLine: true, desktop: true, deskRight: 'enter' };
export const ui = (() => {
  const o = JSON.parse(JSON.stringify(UI_DEFAULTS));
  const st = store.json('ui', null);
  if (st && typeof st === 'object') {
    for (const k of Object.keys(UI_DEFAULTS)) {
      if (!(k in st)) continue;
      if (k === 'favs') { if (Array.isArray(st.favs)) o.favs = st.favs.filter(x => typeof x === 'string'); }
      else if (k === 'tbCollapsed') { if (st.tbCollapsed && typeof st.tbCollapsed === 'object') o.tbCollapsed = { portrait: !!st.tbCollapsed.portrait, landscape: !!st.tbCollapsed.landscape }; }
      else if (k === 'hints') { if (st.hints && typeof st.hints === 'object') o.hints = { ...st.hints }; }
      else if (k === 'fontScale') { const n = Number(st.fontScale); if (n >= 0.8 && n <= 1.6) o.fontScale = n; }
      // 3B hedef kipi: 'vertex' (yalnız köşe — eski davranış), 'surface' (yalnız yüzey), 'auto'
      else if (k === 'pick3') { if (['vertex', 'surface', 'auto'].includes(st.pick3)) o.pick3 = st.pick3; }
      // 3B yakalama kipleri: bilinmeyen adlar atılır, sıra KİP ÖNCELİĞİNE göre kurulur (END > MID > CEN > PER > NEA)
      else if (k === 'snap3Modes') { if (Array.isArray(st.snap3Modes)) o.snap3Modes = MODES3.map(m => m.id).filter(id => st.snap3Modes.includes(id)); }
      else o[k] = !!st[k];
    }
  }
  return o;
})();
const landscapeMq = window.matchMedia('(orientation: landscape) and (max-height: 560px)');
const wideMq = window.matchMedia('(min-width: 900px)');
const orient = () => landscapeMq.matches ? 'landscape' : 'portrait';
/** ui nesnesini DOM'a uygular, saklar ve 'dwg:ui' olayını gönderir */
export function applyUi(o = {}) {
  const app = $('app'), b = document.body;
  if (app) { app.style.setProperty('--fs', String(ui.fontScale)); app.style.setProperty('--tile', ui.glove ? '64px' : '58px'); app.style.setProperty('--tb-h', ui.glove ? '64px' : '56px'); }
  b.classList.toggle('glove', !!ui.glove); b.classList.toggle('left-hand', !!ui.leftHand); b.classList.toggle('contrast', !!ui.contrast);
  b.classList.toggle('reduce-motion', !!ui.reduceMotion); b.classList.toggle('compact-status', !!ui.compactStatus);
  // Yoğun çubuklar: komut satırı ve 3B bilgi satırı yarı yüksekliğe iner (bkz. app.css body.dense-bars)
  b.classList.toggle('dense-bars', ui.denseBars !== false);
  syncCmdShow();
  applyCollapse();
  if (o.store !== false) store.set('ui', JSON.stringify(ui));
  try { window.dispatchEvent(new CustomEvent('dwg:ui', { detail: ui })); } catch (_) { /* yok */ }
  if (v3 && cube) cube.update();
}
/** Titreşim: 'snap'|'step'|'toggle'|'long'|'error' */
export function haptic(kind) {
  if (!ui.haptics) return;
  const pat = { snap: 8, step: 12, toggle: 15, long: 25, error: [30, 40, 30] }[kind] || 10;
  try { if (navigator.vibrate) navigator.vibrate(pat); } catch (_) { /* yok */ }
}

// ---------------------------------------------------------------------------------
// Karo tanımları: [act, simge, tr, en, ipucuTr, ipucuEn]
// ---------------------------------------------------------------------------------
const T = (act, icon, tr, en, htr, hen) => ({ act, icon, tr, en, htr: htr || '', hen: hen || htr || '' });
const TABS = [
  { id: 'view', i18n: 'tabView', icon: 'i-eye', groups: [
    { cap: 'grpNav', items: [T('extents', 'i-fit', 'Sığdır', 'Fit', 'Çizimin tamamını ekrana sığdırır', 'Zoom to the drawing extents'), T('zoomwin', 'i-zoom-window', 'Pencere', 'Window', 'Sürüklenen dikdörtgene yakınlaştırır', 'Zoom into a dragged rectangle'), T('prevview', 'i-prev', 'Önceki', 'Previous', 'Önceki görünüme döner', 'Previous view'), T('nextview', 'i-next', 'Sonraki', 'Next', 'Sonraki görünüme geçer', 'Next view'), T('goto', 'i-goto', 'Koordinat', 'Go to', 'X,Y ya da enlem/boylam girerek gider', 'Go to X,Y or lat/lon'), T('home', 'i-home', 'Ana görünüm', 'Home', 'Kaydedilmiş ana görünüme döner', 'Saved home view')] },
    { cap: 'grpPanels', items: [T('layers', 'i-layers', 'Katmanlar', 'Layers', 'Katman görünürlüğü, izolasyon, soldurma', 'Layer visibility, isolate, fade'), T('search', 'i-search', 'Ara', 'Search', 'Yazı, katman, blok, öznitelik ara', 'Find text, layers, blocks'), T('info', 'i-info', 'Bilgi', 'Info', 'Çizim bilgisi', 'Drawing info'), T('count', 'i-count', 'Sayım', 'Count', 'Blok ve varlık sayımı, oransal dağılım', 'Block and entity counts with a bar chart'), T('views', 'i-bookmark', 'Görünümler', 'Views', 'Kayıtlı görünümler ve yer imleri', 'Saved views'), T('layouts', 'i-layout', 'Sayfalar', 'Layouts', 'Model / kâğıt sayfa düzenleri', 'Model / paper layouts'), T('notes', 'i-pen', 'Notlar', 'Notes', 'Kırmızı kalem notları', 'Redline notes'), T('gps', 'i-gps', 'GPS', 'GPS', 'Konumu çizimde gösterir', 'Show position on the drawing'), T('basemap', 'i-map', 'Altlık', 'Basemap', 'Harita altlığı', 'Map basemap'), T('compare', 'i-compare', 'Karşılaştır', 'Compare', 'İki revizyonu karşılaştırır', 'Compare two revisions'), T('drive', 'i-drive', 'Drive', 'Drive', 'Google Drive: dosya aç, yükle', 'Google Drive: open and upload files'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options', 'Tema, ön ayarlar, süzgeçler, çizgiler, ızgara…', 'Theme, presets, filters, lines, grid…')] },
    { cap: 'grpOut', items: [T('pdf', 'i-pdf', 'PDF', 'PDF', 'Ölçekli PDF oluşturur', 'Create a scaled PDF'), T('png', 'i-image', 'PNG', 'PNG', 'Görünümü resim olarak kaydeder', 'Save the view as an image'), T('savedxf', 'i-save', 'DXF kaydet', 'Save DXF', 'Düzenlenmiş çizimi DXF olarak kaydeder', 'Save the edited drawing as DXF'), T('savedelta', 'i-export', 'Değişiklikler', 'Changes', 'Yalnız değişen nesneleri DXF olarak kaydeder', 'Save only changed objects'), T('textout', 'i-textout', 'Metin çıkar', 'Extract text', 'Çizimdeki bütün yazıları CSV olarak dışa aktarır', 'Export every text in the drawing as CSV'), T('mesh3d', 'i-cube', '3B dışa aktar', 'Export 3D', 'Katı ve ağ gövdelerini OBJ ya da STL olarak yazar', 'Write solids and meshes as OBJ or STL'), T('tableout', 'i-table', 'Tablo çıkar', 'Extract table', 'Çizimdeki tabloyu ızgaradan okuyup CSV yapar', 'Read a drawn table grid and export it as CSV'), T('batch', 'i-batch', 'Toplu işlem', 'Batch', 'Birden çok dosyaya aynı işlemi uygular', 'Apply the same operation to many files'), T('pdfcad', 'i-pdfcad', 'PDF→CAD', 'PDF→CAD', 'PDF sayfasının vektör içeriğini çizime çevirir', 'Convert a PDF page vector content into drawing objects')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo'), T('more', 'i-more', 'Diğer', 'More', 'Diğer işlevler menüsü', 'More functions')] } ] },
  { id: 'display', i18n: 'tabDisplay', icon: 'i-sliders', groups: [] },   // satır içeriği 2B/3B'ye göre üretilir
  { id: 'measure', i18n: 'tabMeasure', icon: 'i-dist', groups: [
    { cap: 'grpMeasure', items: [T('t:dist', 'i-dist', 'Mesafe', 'Distance', 'Noktalar arası mesafe, ΔX/ΔY, açı', 'Distance between points'), T('t:area', 'i-area', 'Alan', 'Area', 'Kapalı alan ve çevre', 'Closed area and perimeter'), T('t:angle', 'i-angle', 'Açı', 'Angle', 'Üç noktayla açı', 'Angle by three points'), T('t:radius', 'i-radius', 'Yarıçap', 'Radius', 'Daire / yay yarıçapı', 'Circle / arc radius'), T('t:coord', 'i-coord', 'Koordinat', 'Coordinate', 'Noktanın koordinatını okur', 'Read point coordinates'), T('t:fillarea', 'i-fill', 'Dolgu alanı', 'Fill area', 'Kapalı alanın içine dokunun; alan, çevre ve dönüşümler', 'Tap inside a closed area for its area and perimeter'), T('t:ident', 'i-ident', 'Akıllı ölçüm', 'Smart measure', 'Nesneye dokunun: türüne göre boy, alan, yarıçap ya da hacim', 'Tap an object: length, area, radius or volume by its type'), T('profile', 'i-profile', 'Profil', 'Profile', 'Kot / eğim profili', 'Elevation / slope profile')] },
    { cap: 'grpHelpers', items: [T('osnap', 'i-snap', 'Yakalama', 'Osnap', 'Nesne yakalamayı açar / kapatır', 'Toggle object snap'), T('osnapset', 'i-sliders', 'Yakalama ayarları', 'Osnap settings', 'Yakalama kipleri (14 AutoCAD kipi), bir kerelik yakalama, açıklık', 'Object snap modes (all 14 AutoCAD modes), one-shot overrides, aperture'), T('otrack', 'i-otrack', 'Yakalama izi', 'Osnap tracking', 'Yakalama noktasında bekleyince iz noktası (+) alınır; imleç yatay / düşey yollara ve kesişimlere oturur (F11)', 'Pause over a snap point to acquire a tracking point (+); the cursor snaps to alignment paths and intersections (F11)'), T('grid', 'i-grid', 'Izgara', 'Grid'), T('crosshair', 'i-crosshair', 'Artı imleç', 'Crosshair')] } ] },
  { id: 'draw', i18n: 'tabDraw', icon: 'i-pen', groups: [
    { cap: 'grpDraw2', items: [T('t:line', 'i-line', 'Çizgi', 'Line', 'İki nokta ya da @uzunluk<açı', 'Two points or @length<angle'), T('t:pline', 'i-pline', 'Polyline', 'Polyline', 'Çok köşeli çizgi; Bitir / Kapat', 'Multi-vertex line'), T('t:rect', 'i-rect', 'Dikdörtgen', 'Rectangle'), T('t:circle', 'i-circle', 'Daire', 'Circle', 'Merkez + yarıçap', 'Center + radius'), T('t:arc3', 'i-arc', 'Yay', 'Arc', 'Üç noktadan yay', 'Three-point arc'), T('t:polygon', 'i-polygon', 'Çokgen', 'Polygon', 'Kenar sayısı, merkez ve yarıçap; çembere iç teğet', 'Sides, center and radius; inscribed in a circle'), T('t:point', 'i-point', 'Nokta', 'Point'), T('t:divide', 'i-divide', 'Böl', 'Divide', 'Yolu eşit parçaya böler, bölme yerlerine nokta koyar', 'Places points at equal divisions of a path'), T('t:measure', 'i-measurepts', 'Aralıkla', 'Measure', 'Yol boyunca sabit aralıkla nokta koyar (dokunulan uçtan başlar)', 'Places points at a fixed spacing along a path (from the tapped end)'), T('t:boundary', 'i-boundary', 'Sınır', 'Boundary', 'Kapalı nesnenin sınırını yeni bir polyline olarak kopyalar', 'Copies the outline of a closed object as a new polyline'), T('t:text', 'i-text', 'Yazı', 'Text', 'Konum, metin ve yükseklik', 'Position, text and height'), T('t:wipeout', 'i-wipeout', 'Maske', 'Wipeout', 'Köşeleri seçilen (ya da kapalı polyline\'dan) alan altındakileri örter; çizim sırasıyla öne / arkaya alınır', 'A polygon that masks what is drawn below it; reorder it with Draw order')] },
    { cap: 'grpDraw3', items: [T('t:pline3d', 'i-pline3d', '3B Polyline', '3D Polyline', 'x,y,z köşeli çizgi', 'Vertices with z'), T('t:face3d', 'i-face', '3B Yüzey', '3D Face', 'Üç / dört köşeli yüzey', 'Three / four vertex face')] },
    { cap: 'grpCur', items: [T('layer', 'i-layers', 'Katman', 'Layer', 'Geçerli katman ve yeni katman', 'Current layer'), T('color', 'i-palette', 'Renk', 'Color', 'Geçerli renk (ACI)', 'Current color')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: 'annot', i18n: 'tabAnnot', icon: 'i-dim', groups: [
    { cap: 'grpDim', items: [T('t:dim', 'i-dim', 'Doğrusal ölçü', 'Linear', 'İki nokta + ölçü çizgisi; eğik ölçü', 'Two points + dimension line; aligned'), T('t:dimh', 'i-dim-h', 'Yatay ölçü', 'Horizontal', 'Yatay mesafeyi ölçülendirir', 'Dimension the horizontal distance'), T('t:dimv', 'i-dim-v', 'Düşey ölçü', 'Vertical', 'Düşey mesafeyi ölçülendirir', 'Dimension the vertical distance'), T('t:dimr', 'i-radius', 'Yarıçap', 'Radius', 'Daire ya da yaya dokunun', 'Tap a circle or arc'), T('t:dimd', 'i-diameter', 'Çap', 'Diameter', 'Daire ya da yaya dokunun', 'Tap a circle or arc'), T('t:dima', 'i-angle', 'Açı ölçüsü', 'Angular', 'Tepe + iki kol', 'Vertex + two arms'), T('t:dimedit', 'i-dimedit', 'Ölçüyü düzenle', 'Edit dimension', 'Ölçü yazısı, yükseklik, ok boyu, ondalık, ön / son ek, çarpan; dosyadan gelen ölçüler de', 'Dimension text, height, arrow, decimals, prefix / suffix, scale factor; file dimensions too')] },
    { cap: 'grpMark', items: [T('t:leader', 'i-leader', 'Açıklama', 'Leader', 'Ok başlı kılavuz çizgi ve yazı', 'Leader line with an arrow and text'), T('t:cloud', 'i-cloud', 'Revizyon bulutu', 'Revision cloud', 'Değişen bölgeyi bulutla çevreler', 'Cloud around a revised area'), T('t:balloon', 'i-balloon', 'Numaralandır', 'Numbering', 'Artan numaralı balon; her dokunuşta bir sonraki', 'Balloon with an auto-incrementing number'), T('t:hatch', 'i-hatch', 'Tarama', 'Hatch', 'Kapalı alanın içine dokunun, dolgu ekler', 'Tap inside a closed area to fill it'), T('hatchpat', 'i-hatch', 'Desen', 'Pattern', 'Çizilecek taramanın deseni, ölçeği ve açısı', 'Pattern, scale and angle for new hatches'), T('markdim', 'i-dim', 'Ölçümü işle', 'Mark measurement', 'Son ölçüm sonucunu açıklama olarak çizime yazar', 'Write the last measurement onto the drawing')] },
    { cap: 'grpCur', items: [T('layer', 'i-layers', 'Katman', 'Layer'), T('color', 'i-palette', 'Renk', 'Color')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: 'edit', i18n: 'tabEdit', icon: 'i-select', groups: [
    { cap: 'grpSel', items: [T('t:select', 'i-select', 'Seç', 'Select', 'Dokunarak seçim; Tümü düğmesiyle hepsi', 'Tap to select'), T('props', 'i-props', 'Özellikler', 'Properties', 'Seçimin katmanı ve rengi', 'Layer and color of the selection'), T('grips', 'i-grips', 'Köşe tutamakları', 'Vertex grips', 'Açıkken dokunulan nesne seçilir; seçili yolların her köşesi ayrı ayrı sürüklenir, çakışan köşeler birlikte gider', 'When on, tapping selects the object; drag any vertex of the selected paths, coincident vertices move together'), T('selectsimilar', 'i-similar', 'Benzerini seç', 'Select similar', 'Seçimle aynı tür ve katmandaki bütün nesneleri seçime ekler', 'Adds every object of the same type and layer as the selection'), T('hideobj', 'i-hideobj', 'Gizle', 'Hide objects', 'Seçili nesneleri görünümden kaldırır; çizim değişmez', 'Hides the selected objects; the drawing is not changed'), T('isoobj', 'i-isoobj', 'İzole et', 'Isolate objects', 'Yalnız seçili nesneleri gösterir', 'Shows only the selected objects'), T('unisoobj', 'i-showobj', 'Hepsini göster', 'Show all', 'Gizlenen ve izole edilen nesneleri geri getirir', 'Shows hidden and isolated objects again')] },
    { cap: 'grpXform', items: [T('t:move', 'i-move', 'Taşı', 'Move'), T('t:copy', 'i-copyobj', 'Kopyala', 'Copy'), T('t:rotate', 'i-rotate', 'Döndür', 'Rotate'), T('t:scale', 'i-scale', 'Ölçekle', 'Scale'), T('t:mirror', 'i-mirror', 'Aynala', 'Mirror'), T('t:stretch', 'i-stretch', 'Esnet', 'Stretch', 'Kesen pencerenin içindeki köşeler taşınır, dışındakiler yerinde kalır', 'Vertices inside the crossing window move, the rest stay'), T('t:offset', 'i-offset', 'Ofset', 'Offset', 'Önce Ekran mı Ölçü mü: geçiş noktası ya da yazılan mesafe, sonra nesne', 'Asks Screen or Measure first: through point or typed distance, then the object'), T('t:align', 'i-align', 'Hizala', 'Align', 'Bir ya da iki nokta çiftiyle taşı + döndür; isteğe bağlı ölçek', 'Move and rotate by one or two point pairs; optional scale')] },
    { cap: 'grpModify', items: [T('t:del', 'i-erase', 'Sil', 'Delete'), T('t:setz', 'i-z', 'Kot ata', 'Set Z', 'Seçime Z kotu atar', 'Assign elevation'), T('t:edittext', 'i-edittext', 'Yazı düzenle', 'Edit text'), T('t:array', 'i-array', 'Dizi', 'Array', 'Dikdörtgen, kutupsal (merkez dokunuşla) ya da yol boyunca artımlı kopya; kat artımı', 'Rectangular, polar (tapped center) or along-a-path incremental copy; Z increment'), T('t:thick', 'i-thick', 'Kalınlık', 'Thickness', '2B nesneye yükseklik vererek 3B gövde üretir', 'Extrude 2D objects into 3D bodies'), T('t:explode', 'i-explode', 'Patlat', 'Explode', 'Blok yerleştirmesini parçalarına ayırır', 'Break a block insertion into its parts'), T('t:join', 'i-join', 'Birleştir', 'Join', 'Uçları değen çizgi, yay ve polyline\'ları tek polyline yapar', 'Joins touching lines, arcs and polylines into one polyline'), T('t:matchprop', 'i-matchprop', 'Özellik eşle', 'Match properties', 'Kaynak nesnenin katman, renk ve çizgi tipini hedeflere kopyalar', 'Copies layer, colour and linetype from a source to targets'), T('t:textsize', 'i-textsize', 'Yazı yüksekliği', 'Text height', 'Seçili yazıların yüksekliğini değiştirir', 'Change the height of selected texts'), T('t:attr', 'i-attr', 'Öznitelik', 'Attributes', 'Blok özniteliklerini düzenler', 'Edit block attributes'), T('findrep', 'i-findrep', 'Bul-değiştir', 'Find & replace', 'Çizimdeki yazılarda toplu değiştirme', 'Bulk replace across drawing texts'), T('t:trim', 'i-trim', 'Buda', 'Trim', 'Önce Ekran mı Ölçü mü: kesici kenar + parça, ya da yazılan boy kadar kısalt', 'Asks Screen or Measure first: cutting edge + piece, or cut a typed length off the end'), T('t:extend', 'i-extend', 'Uzat', 'Extend', 'Önce Ekran mı Ölçü mü: sınır + uç, ya da yazılan boy kadar uzat', 'Asks Screen or Measure first: boundary + end, or add a typed length to the end'), T('t:fillet', 'i-fillet', 'Kavis', 'Fillet', 'Önce Ekran mı Ölçü mü: yayın geçeceği nokta ya da yazılan yarıçap, sonra iki doğru', 'Asks Screen or Measure first: where the arc passes or a typed radius, then two lines'), T('t:chamfer', 'i-chamfer', 'Pah', 'Chamfer', 'Önce Ekran mı Ölçü mü: pahın geçeceği nokta ya da yazılan mesafe, sonra iki doğru', 'Asks Screen or Measure first: where the chamfer passes or a typed distance, then two lines'), T('t:draworder', 'i-draworder', 'Çizim sırası', 'Draw order', 'Seçimi öne / arkaya, bir nesnenin üstüne / altına alır', 'Bring the selection to front / send to back, above / below an object')] },
    { cap: 'grpBlock', items: [T('t:block', 'i-block', 'Blok yap', 'Block', 'Seçimden blok tanımı: taban noktası, ad; seçim bloğa çevrilir / korunur / silinir', 'Block definition from the selection: base point, name; convert / retain / delete'), T('t:insert', 'i-insert', 'Blok ekle', 'Insert', 'Çizimdeki ya da kütüphanedeki bloğu ölçek, dönüş ve özniteliklerle yerleştirir; satır / sütun (MINSERT)', 'Insert a drawing or library block with scale, rotation and attributes; rows / columns (MINSERT)'), T('blocks', 'i-blocks', 'Bloklar', 'Blocks', 'Çizimin blok tanımları: düzenle, yeniden adlandır, değiştir, öznitelikler, kütüphaneye kaydet, DXF yaz, temizle', 'Block definitions of the drawing: edit, rename, replace, attributes, save to library, write DXF, purge'), T('t:bedit', 'i-bedit', 'Blok düzenle', 'Block editor', 'Tanımı ayrı bir oturumda düzenler; kaydedince bütün yerleştirmeler değişir (parametreler: dinamik blok)', 'Edit the definition in its own session; saving updates every insertion (parameters: dynamic block)'), T('t:refedit', 'i-refedit', 'Yerinde düzenle', 'Edit reference', 'Yerleştirmeyi olduğu yerde düzenler; öteki nesneler solgun kalır', 'Edit an insertion in place; other objects are faded'), T('t:attdef', 'i-attdef', 'Öznitelik tanımı', 'Attribute definition', 'Etiket, istem ve öntanımlı değerle öznitelik tanımı koyar; blok yapılınca özniteliğe döner', 'Place an attribute definition (tag, prompt, default); it becomes an attribute when blocked'), T('t:ncopy', 'i-ncopy', 'İçten kopyala', 'Copy nested', 'Blok ya da referans içindeki nesnenin kopyasını çizime alır', 'Copy an object out of a block or xref'), T('blocklib', 'i-block', 'Blok kütüphanesi', 'Block library', 'Cihazdaki blok kütüphanesi: çizimler arası blok saklama', 'Device block library: blocks kept across drawings'), T('copyclip', 'i-copy', 'Panoya kopyala', 'Copy to clipboard', 'Seçimi panoya alır; başka çizimde yapıştırılır', 'Copy the selection for pasting into another drawing'), T('cutclip', 'i-cut', 'Kes', 'Cut', 'Seçimi panoya alır ve siler', 'Copies the selection to the clipboard and erases it'), T('pasteclip', 'i-paste', 'Panodan yapıştır', 'Paste', 'Panodaki nesneleri bu çizime ekler', 'Paste clipboard objects into this drawing'), T('xrefs', 'i-link', 'Referanslar', 'Xrefs', 'Harici referansları ekle (XATTACH), kırp, bağla, ayır, soldur', 'Attach external references, clip, bind, detach, fade')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: '3d', i18n: 'tab3d', icon: 'i-cube', groups: [
    { cap: 'grpView3', items: [T('3d', 'i-3d', '3B aç/kapat', '3D on/off', 'Tek parmak döndürür, iki parmak kaydırır / yakınlaştırır', 'One finger orbits, two fingers pan / zoom'), T('fit3', 'i-fit', 'Sığdır', 'Fit'), T('v:iso', 'i-iso', 'İzometrik', 'Isometric'), T('v:top', 'i-top', 'Üst', 'Top'), T('v:front', 'i-front', 'Ön', 'Front'), T('v:left', 'i-left', 'Sol', 'Left'), T('v:right', 'i-right', 'Sağ', 'Right'), T('v:back', 'i-back', 'Arka', 'Back'), T('v:bottom', 'i-bottom', 'Alt', 'Bottom')] },
    { cap: 'grpCam3', items: [T('persp', 'i-eye', 'Perspektif', 'Perspective', 'Perspektif / ortografik', 'Perspective / orthographic'), T('zscale', 'i-zscale', 'Z abartı', 'Z scale', 'Düşey abartı çarpanı', 'Vertical exaggeration'), T('cam3', 'i-camera', 'Yer imleri', 'Bookmarks', 'Kamera konumlarını kaydeder', 'Save camera positions'), T('turn3', 'i-turn', 'Döner tabla', 'Turntable')] },
    { cap: 'grpStyle3', items: [T('vstyle', 'i-vs-wireframe', 'Görsel stil', 'Visual style', 'Tel kafes, gizli çizgi, gölgeli, gerçekçi, kavramsal, gri, eskiz, röntgen', 'Wireframe, hidden, shaded, realistic, conceptual, gray, sketchy, x-ray'), T('edges3', 'i-edges', 'Kenarlar', 'Edges', 'Yüzey kenar çizgilerini aç/kapat (stilin varsayılanını geçersiz kılar)', 'Toggle face edge lines (overrides the style default)'), T('color3', 'i-palette', 'Renk', 'Color', 'Nesne, katman, kot, tek renk', 'Entity, layer, elevation, mono'), T('clip3', 'i-clip', 'Kesit', 'Clip', 'Z aralığı ve kesit kutusu', 'Z range and clip box')] } ] },   // 3B ARAÇLARI VE 3B DOKUNUŞ AYARLARI ÇİZ ŞERİDİNDEDİR (DRAW_3D): bir karo iki şeritte birden durmaz.
];
/*
 * 3B ÇİZİM ARAÇLARI. Ekran satırındaki DISPLAY_2D / DISPLAY_3D ile aynı desen: sekme tanımının
 * dışında durur, aşağıda açıkça kaydedilir ve Çiz şeridi 3B'deyken bunları gösterir. Böylece
 * karolar tek yerde tanımlanır (tek kimlik, tek kısayol, tek kapı basamağı) ve iki şeritte
 * birden görünmez.
 */
const DRAW_3D = [
  { cap: 'grpTools3', items: [
    T('3:select', 'i-select', 'Seç', 'Select', '3B\'de nesne seçer', 'Select objects in 3D'),
    T('3:line', 'i-line', 'Çizgi (3B)', 'Line (3D)', 'İki nokta arasına üç boyutlu çizgi; her yeni nokta bir öncekine bağlanır', 'A 3D line between two points; each new point continues from the last'),
    T('3:pline', 'i-pline3d', '3B Polyline', '3D Polyline', 'Köşelere ve yüzeylere oturan üç boyutlu çizgi', 'A 3D polyline snapped to vertices and surfaces'),
    T('3:note', 'i-note3', '3B açıklama', '3D note', 'Üç boyutlu noktaya açıklama', 'A note at a 3D point'),
    T('3:dist', 'i-dist', '3B mesafe', '3D distance', 'Köşeler arası eğik mesafe, ΔZ, eğim', 'Slope distance between vertices'),
    T('3:geo', 'i-geo3', '3B geometrik ölçüm', '3D geometry measure', 'Açı, düzlem, hacim, alan…', 'Angle, plane, volume, area…'),
  ] },
  /*
   * ÜÇ BOYUTLU DÜZENLEME. AutoCAD'in 3DMOVE / 3DROTATE / 3DSCALE / MIRROR3D ailesiyle aynı işi
   * yapar: taban noktası üç boyutlu yakalamayla alınır, dönüşüm seçime uygulanır. Döndürme Z
   * ekseni çevresindedir (AutoCAD'in geçerli UCS'i), aynalama düşey bir düzleme göredir —
   * ikisi de tek bir 2B afin matrisle tam olarak ifade edilir, yaklaşık hesap yapılmaz.
   */
  { cap: 'grpXform', items: [
    T('3:move', 'i-move', 'Taşı (3B)', 'Move (3D)', 'Seçimi üç boyutta taşır: taban ve hedef noktası', 'Move the selection in 3D: base and target point'),
    T('3:copy', 'i-copyobj', 'Kopyala (3B)', 'Copy (3D)', 'Seçimin üç boyutlu kopyasını taban ve hedef noktasıyla koyar', 'Copy the selection in 3D by base and target point'),
    T('3:rotate', 'i-rotate', 'Döndür (3B)', 'Rotate (3D)', 'Dokunulan noktadan geçen Z ekseni çevresinde döndürür; açı derece olarak yazılır', 'Rotate about the Z axis through the tapped point; the angle is typed in degrees'),
    T('3:scale', 'i-scale', 'Ölçekle (3B)', 'Scale (3D)', 'Dokunulan noktaya göre üç eksende birlikte ölçekler (kot da ölçeklenir)', 'Scale about the tapped point in all three axes (elevation scales too)'),
    T('3:mirror', 'i-mirror', 'Aynala (3B)', 'Mirror (3D)', 'İki noktadan geçen DÜŞEY düzleme göre yansıtır', 'Mirror about the VERTICAL plane through two points'),
    T('3:setz', 'i-z', 'Kot ata', 'Set Z', 'Seçime kot verir', 'Assign an elevation to the selection'),
    T('3:del', 'i-erase', 'Sil', 'Delete', 'Seçimi siler', 'Erase the selection'),
  ] },
  /*
   * DOKUNUŞ AYARLARI. 'Hedef' 3B sekmesinden buraya alındı: dokunuşun neye oturacağı, çizim
   * yapılırken elin altında olmalıdır — ayrı bir sekmeye gitmek gerekmesin.
   */
  { cap: 'grpHelpers', items: [
    T('snap3', 'i-snap', '3B yakalama', '3D osnap', 'Üç boyutta uç, orta, merkez, dik ve en yakın noktaya oturur', 'Snaps to endpoint, midpoint, center, perpendicular and nearest in 3D'),
    T('snap3set', 'i-sliders', '3B yakalama kipleri', '3D osnap settings', 'Hangi yakalama kiplerinin çalışacağı', 'Which 3D object snap modes are active'),
    T('target3', 'i-snap', 'Hedef', 'Target', 'Köşe / yüzey / otomatik: 3B dokunuşu neye oturur', 'Vertex / surface / auto: what a 3D tap snaps to'),
    T('free3', 'i-point', 'Serbest nokta', 'Free point', 'Hiçbir nesne yakalanmazsa nokta çalışma düzlemine konur: önceki noktanın kotu, yoksa zemin ızgarası', 'When nothing is snapped the point lands on the working plane: the previous point\u2019s elevation, else the ground grid'),
  ] },
  /*
   * GEÇERLİ KATMAN / RENK ve GERİ AL / YİNELE — 2B Çiz şeridinin aynısı. 3B'de çizilen çizgi de
   * ed.curLayer ve ed.curColor'a yazılır; onları değiştirecek bir yol olmadan 3B çizim yarım kalırdı.
   * Geri al / yinele durum çubuğunda da durur (v7.81'de 3B'de yeniden görünür oldu); şeritte de
   * bulunması 2B Çiz şeridiyle simetriyi kurar — kullanıcı sekme değiştirince tuş yer değiştirmez.
   */
  { cap: 'grpCur', items: [
    T('layer', 'i-layers', 'Katman', 'Layer', 'Geçerli katman ve yeni katman', 'Current layer'),
    T('color', 'i-palette', 'Renk', 'Color', 'Geçerli renk (ACI)', 'Current color'),
  ] },
  { cap: 'grpHist', items: [
    T('undo', 'i-undo', 'Geri al', 'Undo'),
    T('redo', 'i-redo', 'Yinele', 'Redo'),
  ] },
];
const DISPLAY_2D = [
  { cap: 'grpTheme', items: [T('theme', 'i-theme', 'Koyu / açık', 'Dark / light', 'Arka plan temasını değiştirir', 'Switch the background theme'), T('sun', 'i-sun', 'Güneş', 'Sun', 'Güneş altında okunaklı yüksek kontrast', 'High contrast for sunlight'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options', 'Tema, ön ayarlar, süzgeçler, çizgiler, ızgara…', 'Theme, presets, filters, lines, grid…')] },
  { cap: 'grpVis', items: [T('text', 'i-text', 'Yazı', 'Text'), T('hatch', 'i-hatch', 'Tarama', 'Hatch'), T('dim', 'i-dim', 'Ölçüler', 'Dimensions'), T('points', 'i-point', 'Noktalar', 'Points'), T('images', 'i-image', 'Resimler', 'Images')] },
  { cap: 'grpLines', items: [T('lw', 'i-lw', 'Kalınlık', 'Lineweight', 'Çizgi kalınlıklarını gösterir', 'Show lineweights'), T('mono', 'i-mono', 'Tek renk', 'Mono', 'Tek renk / nesne rengi', 'Monochrome / entity color'), T('ltype', 'i-fade', 'Çizgi tipi', 'Linetype')] },
  { cap: 'grpHelpers', items: [T('grid', 'i-grid', 'Izgara', 'Grid'), T('crosshair', 'i-crosshair', 'Artı imleç', 'Crosshair'), T('cmdline', 'i-cmdline', 'Komut satırı', 'Command line', 'AutoCAD komut adlarıyla çalışır: LINE, TR, F…', 'Type AutoCAD command names: LINE, TR, F…'), T('ortho', 'i-ortho', 'Ortho', 'Ortho', 'Noktayı yatay ya da düşeye kilitler (F8)', 'Locks the point to horizontal or vertical (F8)'), T('polar', 'i-polar', 'Kutupsal', 'Polar', 'Noktayı açı adımına oturtur (F10)', 'Snaps the point to an angle increment (F10)'), T('otrack', 'i-otrack', 'Yakalama izi', 'Osnap tracking', 'Yakalama noktasında bekleyince iz noktası (+) alınır; imleç yatay / düşey yollara ve kesişimlere oturur (F11)', 'Pause over a snap point to acquire a tracking point (+); the cursor snaps to alignment paths and intersections (F11)'), T('rulers', 'i-ruler', 'Cetvel', 'Rulers'), T('fade', 'i-fade', 'Soldur', 'Fade', 'Seçili olmayan katmanları soldurur', 'Fade other layers')] },
];
const DISPLAY_3D = [
  { cap: 'grpStyle3', items: [T('vstyle', 'i-vs-wireframe', 'Görsel stil', 'Visual style'), T('edges3', 'i-edges', 'Kenarlar', 'Edges'), T('color3', 'i-palette', 'Renk', 'Color'), T('light3', 'i-light', 'Işık', 'Light', 'Gölgeli stilde aydınlatma', 'Lighting in shaded styles'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options')] },
  { cap: 'grpHelpers', items: [T('grid3', 'i-grid', 'Izgara', 'Grid'), T('axes3', 'i-axes', 'Eksenler', 'Axes'), T('cube3', 'i-viewcube', 'Küp', 'Cube', 'Görünüm küpü', 'View cube'), T('hud3', 'i-info', 'Bilgi', 'HUD', 'Kamera bilgisi', 'Camera info'), T('shadow3', 'i-sun', 'Gölge', 'Shadow', 'Zemin gölgesi', 'Ground shadow'), T('sil3', 'i-cube', 'Siluet', 'Silhouette', 'Siluet kenarları', 'Silhouette edges')] },
  { cap: 'grpCam3', items: [T('zscale', 'i-zscale', 'Z abartı', 'Z scale'), T('clip3', 'i-clip', 'Kesit', 'Clip'), T('turn3', 'i-turn', 'Döner tabla', 'Turntable'), T('persp', 'i-eye', 'Perspektif', 'Perspective')] },
];
const TILE = {};
function registerTiles() {
  const tr = {}, en = {};
  /*
   * İngilizce karo etiketi AutoCAD komut adıdır; ipucuna da komutun bütün adları eklenir
   * ("TRIM (TR) · Tap the cutting edge…"), böylece kullanıcı komut satırını şeritten öğrenir.
   * Türkçe etiket ve ipucu değişmez.
   */
  const reg = (it) => {
    TILE[it.act] = it;
    const cmd = cmdOf(it.act);
    tr['tl_' + it.act] = it.tr; en['tl_' + it.act] = cmd || it.en;
    tr['th_' + it.act] = it.htr; en['th_' + it.act] = cmd ? (namesOf(it.act) + (it.hen ? ' · ' + it.hen : '')) : it.hen;
  };
  for (const tab of TABS) for (const g of tab.groups) for (const it of g.items) reg(it);
  for (const g of DISPLAY_2D) for (const it of g.items) reg(it);
  for (const g of DISPLAY_3D) for (const it of g.items) reg(it);
  for (const g of DRAW_3D) for (const it of g.items) reg(it);
  tr.perspShort = 'Persp'; en.perspShort = 'Persp'; tr.orthoShort = 'Paralel'; en.orthoShort = 'Ortho';
  addStrings(tr, en);
}
registerTiles();
const tileLabel = (act) => { const it = TILE[act]; return it ? tt('tl_' + act, it.tr) : act; };
const tileHint = (act) => { const it = TILE[act]; return it ? tt('th_' + act, it.htr) : ''; };
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
/** Nesne gizleme / izolasyon durumu (app.js S.hideObj / S.isoObj): gizlenen nesne görünür sayılmaz */
const objShown = (p) => !(S.hideObj && S.hideObj.size && S.hideObj.has(p.key)) && !(S.isoObj && !S.isoObj.has(p.key));

// ---------------------------------------------------------------------------------
// Başlatma
// ---------------------------------------------------------------------------------
export function initEditor(a) {
  api = a; S = a.S;
  tools = new ToolManager({
    snap: (w, o) => api.snap(w, o),
    fromBase: () => (api.fromBase ? api.fromBase() : null),
    pick: (w) => api.pick(w),
    sel: ed.sel,
    prompt: showPrompt,
    run: (cmd) => { if (!doc) return false; const ok = doc.run(cmd); refreshUndo(); return ok; },
    render: () => api.requestRender(),
    overlay: () => api.drawOverlay(),
    toast: (m) => api.toast(m),
    result: showResult,
    layer: () => ed.curLayer,
    color: () => ed.curColor,
    textHeight: () => Math.max(1e-6, (S.ext ? (S.ext[2] - S.ext[0]) : 100) / 200),
    units: () => S.units ? ' ' + S.units : '',
    unitToM: () => S.unitToM,
    // Açı kısıtları (ortho / kutupsal). Araç kendi kısıtını hesaplamaz, durumu buradan okur.
    desk: () => S.desk,
    // Komut satırı kutusu: doğrudan uzaklık girişi dokunma anında kutudaki sayıyı okur, kullanınca siler
    input: () => { const i = $('cmdInput'); return i && !i.hidden ? i.value : ''; },
    clearInput: () => { const i = $('cmdInput'); if (i) i.value = ''; },
    trackClear: () => call(api.trackClear),   // nokta belirlenince / araç bitince edinilmiş iz noktaları silinir (nesne yakalama izleme)
    fmt,
    copy: (t) => api.copyText(t),
    lonLat: (x, y) => S.geo.active ? S.geo.toLonLat(x, y) : null,
    // Gizlenen / izole dışı nesne (HIDEOBJECTS, ISOLATEOBJECTS) çizilmez: bölge seçimi, kapalı alan arama, tümünü seç ve grup da onu görmez
    visiblePrims: () => S.prims.filter(p => !(S.layers.get(p.lay) && !S.layers.get(p.lay).visible) && objShown(p)),
    selectable: () => S.prims.filter(p => { const l = S.layers.get(p.lay); return !(l && (!l.visible || l.locked)) && objShown(p); }),   // bölge seçimi: görünür ve kilitsiz katmanlar
    allPrims: () => (S.scene ? S.scene.layouts[0].prims : []),
    trType: (x) => tt('ety_' + x, x),               // DXF tür adının yerelleşmiş karşılığı (yoksa adın kendisi)
    hatchPattern: () => ed.curPattern,              // çizilecek taramanın deseni (SOLID varsayılan)
    meshMetrics: (p) => { try { return p && p.vtx && p.idx ? meshMetrics(p.vtx, p.idx) : null; } catch (_) { return null; } },
    // v7.72 blok ailesi: tanım tablosu, tanım yapma, kütüphaneden benimseme, düzenleme oturumları, taban noktası, parametreler, kırpma
    primToEnt: (p) => primToEnt(p),
    blockDef: (name) => S.blocks.get(B.keyOf(name)) || null,
    blockNames: () => blockNames(),
    blockFromLib: (name) => blockFromLib(name),
    blockAdopt: (name) => blockAdopt(name),
    blockMake: (name, prims, base, mode, lib) => blockMake(name, prims, base, mode, lib),
    beditStart: (name, h) => beditStart(name, { h }),
    refeditStart: (name, h) => beditStart(name, { h, inplace: true }),
    setBase: (p) => setBase(p),
    bparamAdd: (prm) => bparamAdd(prm), inBedit: () => !!bses && bses.kind === 'bedit',   // parametre araçları yalnız BEDIT oturumunda (REFEDIT'te de değil)
    bparamRadius: (base) => { const bb = Gz.boxOf(S.prims.filter(p => p.k !== 4)); return bb ? Math.max(Math.hypot(bb[2] - base[0], bb[3] - base[1]), Math.hypot(base[0] - bb[0], base[1] - bb[1])) * 0.6 || 1 : 1; },
    bvstateSet: (keys, state) => bvstateSet(keys, state),
    bvstates: () => bvstates(),
    xclip: (name, rect) => call(api.xclip, name, rect),
  });
  ed.tools = tools;
  applyUi({ store: false });
  buildToolbar();
  bindCmdBar();
  sheetInit();
  bindStatusBar();
  bindSideTabs();
  D.setRender3d((body) => v3 ? openView3DOptions(v3, body, host3()) : null);
  window.addEventListener('dwg:display', () => { refreshTiles(); syncQuick(); });
  window.addEventListener('dwg:view3d', (ev) => { refreshTiles(); if (ev.detail && ['cube', 'hud', 'hudPos'].includes(ev.detail.key)) syncCube(); if (ev.detail && ev.detail.key === 'context' && ev.detail.value === 'restored' && ed.is3D()) { overlay3D(); api.toast(tt('ctx3Restored', '3B görünüm yeniden kuruldu'), 1500); } statusMode3D(); });
  window.addEventListener('dwg:viewhist', () => refreshTiles());
  landscapeMq.addEventListener('change', () => { applyCollapse(); closePop(); });
  wideMq.addEventListener('change', () => dockDisplay());
  const bd = $('btnDisplay'); if (bd) bd.addEventListener('click', () => { const p = $('displayPanel'); if (p && !p.hidden) D.closeDisplayOptions(); else call(api.openDisplayOptions); });
}

// ---------------------------------------------------------------------------------
// Sahne bağlandığında
// ---------------------------------------------------------------------------------
export function onScene() {
  ed.sel.clear(); tools.cancel(true); showPrompt(null);
  if (tools.lastVal) tools.lastVal = {};   // Ekran / Ölçü araçlarının son değerleri çizim birimindedir: yeni dosyada bayat kalmasın
  const model = S.scene.layouts[0];
  const counts = new Map();
  for (const L of S.scene.layouts) for (const p of L.prims) { const h = (p.info && p.info.h) || 'x'; const n = counts.get(h) || 0; counts.set(h, n + 1); p.key = h + '#' + n; }
  ed.curLayer = S.layers.has('0') ? '0' : (S.layers.keys().next().value || '0');
  ed.curColor = 256;
  if (bses) { bses = null; S.backdrop = null; S.bedit = null; removeBeditBar(); }   // yeni dosya: açık blok düzenleyici oturumu düşer
  S.blocks = new Map(); S.vars = {};   // blok tablosu ve başlık değişkenleri dosyaya aittir; günlük yeniden oynatılınca kurulur
  doc = makeDoc(S.fileKey);
  ed.doc = doc;
  const n = doc.load();
  if (n) api.toast(n + ' ' + t('editsApplied'));
  refreshUndo();
  updateLayerButton();
  if (ed.is3D()) exit3D();
  setTab(ed.tab);
  refreshTiles(); syncQuick();
  if (!ui.hints.tour) setTimeout(showTour, 600);
}
/** Düzenleme belgesi: model uzayı ilkelleri, katmanlar, blok tablosu ve başlık değişkenleri; key null ise kalıcı değildir (blok düzenleyici oturumu) */
function makeDoc(key) {
  const model = S.scene.layouts[0];
  return new EditDoc({
    prims: () => model.prims,
    layers: S.layers,
    blocks: S.blocks,
    vars: S.vars,
    insert: (p, at) => { if (at == null || at > model.prims.length) model.prims.push(p); else model.prims.splice(at, 0, p); },
    remove: (p) => { const i = model.prims.indexOf(p); if (i >= 0) model.prims.splice(i, 1); return i; },
    rebuild,
    store: api.store,
    key,
    // katman işlemi (çalıştırma, geri alma, yineleme) → sahne önbelleği düşer, katman listesi tazelenir;
    // geçerli katman adı değiştiyse (yeniden adlandırma ya da onun geri alınması) onu izler, silindiyse '0'a düşer
    layersChanged: (cmd) => {
      S.cacheValid = false;
      if (!S.layers.has(ed.curLayer)) {
        const c = cmd || {};
        ed.curLayer = c.op === 'layerprops' && c.newName && S.layers.has(c.newName) ? c.newName : (c.op === 'layerprops' && S.layers.has(c.name) ? c.name : '0');
        updateLayerButton();
      }
      call(api.buildLayerList);
    },
  });
}
function rebuild() {
  const model = S.scene.layouts[0];
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of model.prims) { if (p.inf || p.k === 4 || !p.bb) continue; if (p.bb[0] < bb[0]) bb[0] = p.bb[0]; if (p.bb[1] < bb[1]) bb[1] = p.bb[1]; if (p.bb[2] > bb[2]) bb[2] = p.bb[2]; if (p.bb[3] > bb[3]) bb[3] = p.bb[3]; }
  if (isFinite(bb[0])) model.ext = bb;
  S.modelTree = new api.RTree(model.prims, p => p.bb);
  if (S.scene.layouts[S.layoutIndex].isModel) { S.prims = model.prims; S.tree = S.modelTree; S.ext = model.ext; }
  for (const p of [...ed.sel]) if (!model.prims.includes(p)) ed.sel.delete(p);
  S.cacheValid = false;
  if (ed.is3D()) refresh3D();
}
function refreshUndo() {
  const cu = !(doc && doc.undoStack.length), cr = !(doc && doc.redoStack.length);
  // Kilitli karo ASLA disabled edilmez: disabled düğme ne click ne pointerdown üretir; rozet ölü
  // süse döner ve uzun basış kutusu da açılmaz. (Ücretsizde yığın hep boştur → undo/redo hep ölürdü.)
  document.querySelectorAll('#toolbar [data-act="undo"]').forEach(b => { b.disabled = has('undo') && cu; });
  document.querySelectorAll('#toolbar [data-act="redo"]').forEach(b => { b.disabled = has('redo') && cr; });
  document.querySelectorAll('#toolbar [data-act="savedxf"], #toolbar [data-act="savedelta"]').forEach(b => b.classList.toggle('dirty', !!(doc && doc.dirty)));
  syncQuick();   // durum çubuğundaki geri al / yinele rozetleri
}

// ---------------------------------------------------------------------------------
// Şerit: sekmeler › gruplar › karolar
// ---------------------------------------------------------------------------------
const tileId = (act, tabId) => act === 'undo' && tabId === 'view' ? 'tbUndo' : act === 'redo' && tabId === 'view' ? 'tbRedo' : act === 'savedxf' ? 'tbSave' : act === 'layer' && tabId === 'draw' ? 'tbLayer' : '';
function tileHtml(it, tabId) {
  const id = tileId(it.act, tabId);
  const lock = !has(it.act);
  // Kilitli karoda aria-label YAZILMAZ: aria-label iç metni ezer ve rozetin okunur karşılığı
  // ekran okuyucuya hiç ulaşmaz. Ad içerikten kurulur: ".lb + .lk-vh" → "Çizgi Premium paketinde bulunur."
  // Serbest karoda statik aria-label'a data-i18n-aria eşlik eder: dil değişiminde bayatlamaz.
  return `<button type="button" data-act="${esc(it.act)}"${id ? ` id="${id}"` : ''}${lockAttr(it.act)} class="${ui.favs.includes(it.act) ? 'fav-mark' : ''}" data-i18n-title="tl_${esc(it.act)}" title="${esc(tileLabel(it.act))}"${lock ? '' : ` data-i18n-aria="tl_${esc(it.act)}" aria-label="${esc(tileLabel(it.act))}"`}>${ICON(it.icon)}<span class="lb" data-i18n="tl_${esc(it.act)}">${esc(tileLabel(it.act))}</span>${lockBadge(it.act, 'bar')}</button>`;
}
function groupHtml(g, tabId) {
  return `<div class="tb-group"><div class="tb-tiles">${g.items.map(it => tileHtml(it, tabId)).join('')}</div><div class="tb-caption" data-i18n="${esc(g.cap)}">${esc(t(g.cap))}</div></div>`;
}
/** Kilitli karolar şeritte GÖSTERİLİYOR mu? (Ayarlar › Erişilebilirlik; öntanımlı açık) */
const lockedOn = () => ui.showLocked !== false;
/** Kilitli karo artık elenmez, damgalanır. Ayar kapalıysa bugünkü süzgeç geri gelir. */
function editionGroups(groups) {
  if (lockedOn()) return groups;
  return groups.map(g => ({ ...g, items: g.items.filter(it => has(it.act)) })).filter(g => g.items.length);
}
/*
 * 3B'DE ÇİZ ŞERİDİ. 2B çizim araçları (Çizgi, Polyline, Dikdörtgen, Daire…) ekran düzleminde
 * çalışır; 3B görünümde başlatılınca uygulama 2B'ye dönmek zorundaydı ve bu kullanıcıya
 * "çizmeye kalkışınca görünüm bir anda değişti" gibi görünüyordu. Artık 3B'deyken Çiz şeridi
 * 3B'de GERÇEKTEN çalışan araçları gösterir (3B Polyline, 3B açıklama, kot atama, ölçüm…);
 * 2B araçları o şeritte hiç görünmez, dolayısıyla kaza ile görünüm değiştiren bir dokunuş kalmaz.
 * Ekran satırı gibi burada da karolar YENİDEN TANIMLANMAZ, 3B sekmesindekiler ödünç alınır:
 * tek kayıt, tek kısayol, tek kapı basamağı.
 */
function rowGroups(tab) {
  if (tab.id === 'display') return editionGroups(ed.is3D() ? DISPLAY_3D : DISPLAY_2D);
  if (tab.id === 'draw' && ed.is3D()) return editionGroups(DRAW_3D);
  if (tab.id === 'fav') { const items = ui.favs.filter(a => TILE[a] && (lockedOn() || has(a))).map(a => TILE[a]); return items.length ? [{ cap: 'grpFav', items }] : []; }
  return editionGroups(tab.groups);
}
/**
 * Satırı kullanılır kılan EN DÜŞÜK basamak ('free' → kilitli karo yok).
 * En yüksek DEĞİL en düşük alınır: Çiz satırında 11 karo premium, 2 karo super'dir; en yüksek
 * alınsaydı çağrı karosu mor (Super) çıkar, yanındaki 11 turuncu şeritle ve zaten turuncu olan
 * sekme rozetiyle çelişirdi. En düşük hem rengi tutturur hem de en ucuz adımı gösterir.
 */
const minNeed = (items) => items.reduce((a, it) => {
  if (has(it.act)) return a;
  const n = need(it.act);
  return a === 'free' || rank(n) < rank(a) ? n : a;
}, 'free');
/** Satır başına TEK konuşan karo: şerit metinsizdir, rengin ne demek olduğu burada yazar */
function lockCta(n) {
  return `<div class="tb-group tb-lockg" data-tier="${n}"><div class="tb-tiles">`
    + `<button type="button" class="lk-cta" data-lk="pro" data-tier="${n}" data-i18n-title="goPro" title="${esc(t('goPro'))}">`
    + `${ICON('i-lock')}<span class="lb" data-i18n="proBadge">${esc(t('proBadge'))}</span>`
    + `<span class="vh" data-i18n="goPro">${esc(t('goPro'))}</span></button>`
    + `</div><div class="tb-caption" data-i18n="goPro">${esc(t('goPro'))}</div></div>`;
}
function rowHtml(tab) {
  const gs = rowGroups(tab);
  let inner = gs.length ? gs.map(g => groupHtml(g, tab.id)).join('') : `<div class="tb-empty" data-i18n="favEmpty">${esc(t('favEmpty'))}</div>`;
  const items = gs.flatMap(g => g.items);
  const n = minNeed(items);
  if (n !== 'free') {
    const all = items.every(it => !has(it.act));   // satırın tamamı kilitliyse açıklama BAŞA gelir
    inner = all ? lockCta(n) + inner : inner + lockCta(n);
  }
  return `<div class="tb-row" data-for="${tab.id}" ${tab.id === ed.tab ? '' : 'hidden'}>${inner}</div>`;
}
/** Sekme rozeti: sekmenin kendisi kilitliyse ya da ÇİZİLEN BÜTÜN karoları kilitliyse gereken
 *  basamak, yoksa ''. Bugünkü veriyle draw, annot ve edit rozet alır; view, measure ve 3d almaz. */
function tabNeed(tab) {
  if (!has(tab.id)) return need(tab.id);
  const items = rowGroups(tab).flatMap(g => g.items);
  if (!items.length || items.some(it => has(it.act))) return '';
  return minNeed(items);
}
function tabList() { const tabs = lockedOn() ? TABS.slice() : TABS.filter(x => has(x.id)); return ui.favs.length ? [{ id: 'fav', i18n: 'tabFav', icon: 'i-star', groups: [] }, ...tabs] : tabs; }
function buildToolbar() {
  const tb = $('toolbar');
  const tabs = tabList();
  if (!tabs.some(x => x.id === ed.tab)) ed.tab = 'view';
  tb.innerHTML = `<div class="tb-tabs" role="tablist">${tabs.map(x => { const n = tabNeed(x); return `<button type="button" role="tab" data-tab="${x.id}"${n ? ` data-need="${n}"` : ''} class="${x.id === ed.tab ? 'active' : ''}${x.id === 'fav' ? ' tab-fav' : ''}" aria-selected="${x.id === ed.tab}">${ICON(x.icon)}<span data-i18n="${x.i18n}">${esc(t(x.i18n))}</span>${lockBadgeFor(n, 'bar')}</button>`; }).join('')}<button type="button" class="tb-collapse" aria-label="${esc(tt('collapsed', 'Katla'))}">${ICON('i-chevron')}</button></div>` + tabs.map(rowHtml).join('');
  if (!tb.dataset.bound) {
    tb.dataset.bound = '1';
    tb.addEventListener('click', (ev) => {
      const tabBtn = ev.target.closest('[data-tab]');
      if (tabBtn) { if (tabBtn.dataset.tab === ed.tab && !$('toolbar').classList.contains('collapsed')) collapse(true); else { if ($('toolbar').classList.contains('collapsed')) collapse(false); setTab(tabBtn.dataset.tab); } haptic('step'); return; }
      if (ev.target.closest('.tb-collapse')) { collapse(!$('toolbar').classList.contains('collapsed')); return; }
      const lk = ev.target.closest('[data-lk="pro"]');   // satır çağrı karosu: kutu yok, doğrudan panel
      if (lk) { closePop(); openProPanel(lk.dataset.tier || ''); haptic('step'); return; }
      const b = ev.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.longFired) { delete b.dataset.longFired; return; }
      closePop();
      act(b.dataset.act, b);
    });
    bindLongPress(tb);
  }
  refreshUndo(); refreshTiles(); updateLayerButton(); syncCmdShow(); applyCollapse();
}
function rebuildRow(id) {
  const tab = tabList().find(x => x.id === id); if (!tab) return;
  const old = document.querySelector(`#toolbar .tb-row[data-for="${id}"]`); if (!old) { buildToolbar(); return; }
  const tmp = document.createElement('div'); tmp.innerHTML = rowHtml(tab);
  old.replaceWith(tmp.firstElementChild);
  refreshUndo(); refreshTiles(); updateLayerButton();
}
function setTab(id) {
  if (!tabList().some(x => x.id === id)) id = 'view';
  ed.tab = id;
  document.querySelectorAll('#toolbar [data-tab]').forEach(b => { const on = b.dataset.tab === id; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
  document.querySelectorAll('#toolbar .tb-row').forEach(r => { r.hidden = r.dataset.for !== id; });
  closePop();
}
function collapse(on) {
  ui.tbCollapsed[orient()] = !!on;
  applyUi();
  api && api.toast(on ? t('collapsed') : t('expanded'), 1200);
}
function applyCollapse() { const tb = $('toolbar'); if (tb) tb.classList.toggle('collapsed', !!ui.tbCollapsed[orient()]); }
function markActive(name) {
  const k = name != null && /^t:array/.test(name) ? 't:array' : name;   // dizi alt türleri (arrayrect / arraypolar / arraypath) Dizi karosunda vurgulanır
  document.querySelectorAll('#toolbar [data-act]').forEach(b => b.classList.toggle('active', k != null && b.dataset.act === k));
}
/** Durum karoları (.on): 2B ekran anahtarları, 3B seçenekleri, görünüm geçmişi */
function refreshTiles() {
  const on = {};
  if (S) {
    on.theme = !S.dark; on.sun = !!S.sun; on.text = S.show.text; on.hatch = S.show.hatch; on.dim = S.show.dim; on.points = S.show.point; on.images = S.show.image;
    on.lw = !!S.lw; on.mono = S.colorMode === 'mono'; on.ltype = S.show.ltype; on.grid = S.grid.on; on.crosshair = S.crosshair !== 'off'; on.rulers = !!S.rulers; on.fade = S.fade.on;
    on.osnap = S.snapModes && S.snapModes.size > 0; on.snap3 = snap3On(); on.free3 = !!ui.free3; on['3d'] = ed.is3D(); on.grips = !!ui.grips; on.cmdline = ui.cmdLine !== false; on.ortho = !!(S.desk && S.desk.ortho); on.polar = !!(S.desk && S.desk.polar);
    try { on.otrack = !!(api && api.osnap && api.osnap.opt().otrack); } catch (_) { on.otrack = false; }   // nesne yakalama izleme (F11) karosu
    on.unisoobj = !!(S.hideObj && (S.hideObj.size > 0 || !!S.isoObj));   // gizli / izole nesne varken "Hepsini göster" karosu yanar
    on.wipeframe = S.wipeFrame !== false; on.xreffade = S.xrefFade > 0; on.blocks = !!bses;
  }
  if (v3) { const o = v3.opts; on.grid3 = o.grid; on.axes3 = o.axes; on.cube3 = o.cube; on.hud3 = o.hud; on.light3 = o.light; on.turn3 = o.turntable; on.persp = v3.cam.persp; on.clip3 = !!o.clip; on.shadow3 = o.shadow; on.sil3 = !!v3._styleFx().silhouette; on.edges3 = !!v3._styleFx().edges; }
  document.querySelectorAll('#toolbar [data-act]').forEach(b => { const k = b.dataset.act; if (k in on) { b.classList.toggle('on', !!on[k]); b.setAttribute('aria-pressed', String(!!on[k])); } if (!FREE.has(k) && !HIST.has(k)) b.disabled = has(k) ? !(S && S.hasDoc) : false; });
  const vh = api && api.viewHistory;
  document.querySelectorAll('#toolbar [data-act="prevview"]').forEach(b => { b.disabled = !(vh && vh.canBack && vh.canBack()); });
  document.querySelectorAll('#toolbar [data-act="nextview"]').forEach(b => { b.disabled = !(vh && vh.canForward && vh.canForward()); });
  const bd = $('btnDisplay'); if (bd) bd.classList.toggle('active', !!($('displayPanel') && !$('displayPanel').hidden));
  // görsel stil karosu: simge ve etiket etkin stili gösterir
  const st = v3 ? v3.opts.style : 'wireframe';
  document.querySelectorAll('#toolbar [data-act="vstyle"]').forEach(b => { const u = b.querySelector('use'); if (u) u.setAttribute('href', '#i-vs-' + (VSTYLES.some(x => x[0] === st) ? st : 'wireframe')); const lb = b.querySelector('.lb'); if (lb) lb.textContent = vstyleName(st); b.classList.toggle('on', !!v3 && st !== 'wireframe'); });
}
const VSTYLES = [['wireframe2d', 'v3Wire2d', '2B tel kafes'], ['wireframe', 'v3Wire', 'Tel kafes'], ['hidden', 'v3Hidden', 'Gizli çizgi'], ['shaded', 'v3Shaded', 'Gölgeli'], ['shadedEdges', 'v3ShadedEdges', 'Gölgeli+kenar'], ['realistic', 'v3Realistic', 'Gerçekçi'], ['conceptual', 'v3Conceptual', 'Kavramsal'], ['gray', 'v3Gray', 'Gri tonlar'], ['sketchy', 'v3Sketchy', 'Eskiz'], ['xray', 'v3Xray', 'Röntgen']];
const vstyleName = (id) => { const v = VSTYLES.find(x => x[0] === id); return v ? tt(v[1], v[2]) : id; };
/** Görsel stil açılır kutusu: önizleme simgeli ızgara */
function vstylePop(btn) {
  if (!v3 || !ed.is3D()) { if (!needModel()) return; enter3D(); }
  if (!v3) return;
  const html = `<div class="pop-title">${esc(tileLabel('vstyle'))}</div><div class="vs-grid">${VSTYLES.map(([id, k, tr]) => `<button type="button" data-vs="${id}" class="${v3.opts.style === id ? 'on' : ''}"><svg class="ic" aria-hidden="true"><use href="#i-vs-${id}"/></svg><span>${esc(tt(k, tr))}</span></button>`).join('')}</div>` +
    `<div class="pop-row"><button type="button" class="btn small" data-vs-more="1">${esc(tt('dispTitle', 'Ekran ayarları'))} › 3B</button></div>`;
  const pop = openPop(btn, html);
  pop.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-vs]'); if (b) { v3.set('style', b.dataset.vs); pop.querySelectorAll('[data-vs]').forEach(x => x.classList.toggle('on', x === b)); refreshTiles(); haptic('toggle'); return; }
    if (ev.target.closest('[data-vs-more]')) { closePop(); call(api.openDisplayOptions, { seg: '3d', focus: 'style' }); }
  });
}
/*
 * 3B HEDEF SEÇİCİ. Ölçüden ÖNCE seçilir: kullanıcı köşeye mi yüzeye mi dokunacağını bilmelidir.
 * vstylePop ile birebir aynı düzen — ayrı bir bileşen yazılmaz.
 */
const PICK3 = [['vertex', 'pick3Vertex'], ['surface', 'pick3Surface'], ['auto', 'pick3Auto']];
/*
 * DESEN SEÇİCİ. Çizilecek taramanın deseni, ölçeği ve açısı. Varsayılan SOLID'dir ve öyle
 * kalmalıdır: eski davranış (düz dolgu) hiçbir ayara dokunmayan kullanıcı için değişmez.
 * Desen adları geom.HATCH_PATTERNS'ten gelir — tek tanım, tek çizici.
 */
/** Desen önizlemesi (SVG, 44 px): desen kendi çizicisinden (geom.hatchLines) geçer; en sık çizgi aralığı 7 px olacak ölçekte */
function patSvg(G, name) {
  const S = 44;
  if (name === 'SOLID') return `<svg viewBox="0 0 ${S} ${S}" aria-hidden="true"><rect x="1" y="1" width="${S - 2}" height="${S - 2}" fill="currentColor" opacity=".85"/></svg>`;
  const d1 = G.patternDefs(name, 1); if (!d1.length) return '';
  const offs = d1.map(d => Math.hypot(d.offset.x, d.offset.y)).filter(v => v > 1e-9);
  const sc = 7 / (offs.length ? Math.min(...offs) : 1);
  const r = G.hatchLines([[[0, 0], [S, 0], [S, S], [0, S]]], G.patternDefs(name, sc), { maxSeg: 3000, maxWork: 2e5 });
  let lines = '';
  if (r && r.ops) for (let i = 0; i + 1 < r.ops.length; i += 2) { const a = r.ops[i], b = r.ops[i + 1]; lines += `<line x1="${a[1].toFixed(1)}" y1="${(S - a[2]).toFixed(1)}" x2="${b[1].toFixed(1)}" y2="${(S - b[2]).toFixed(1)}"/>`; }
  return `<svg viewBox="0 0 ${S} ${S}" aria-hidden="true" stroke="currentColor" stroke-width="1" fill="none"><rect x=".5" y=".5" width="${S - 1}" height="${S - 1}" opacity=".35"/>${lines}</svg>`;
}
async function hatchPatPop() {
  if (!gate('t:hatch')) return;
  const G = await import('./geom.js');
  const adlar = Object.keys(G.HATCH_PATTERNS);
  const cur = ed.curPattern || { name: 'SOLID', scale: 0, angle: 0 };
  const r = await askForm(t('hatchPatTitle'), [
    { id: 'name', label: tileLabel('hatchpat'), type: 'grid', value: cur.name,   // kartlı liste: her desenin önizlemesi görünür
      options: adlar.map(n => [n, n === 'SOLID' ? t('patSolid') : n, patSvg(G, n)]) },
    { id: 'scale', label: t('hatchScale') + ' (0 = ' + t('autoWord') + ')', type: 'number', value: String(cur.scale || 0) },
    { id: 'angle', label: t('hatchAngle'), type: 'number', value: String(cur.angle) },
  ], { ok: t('ok') });
  if (!r) return;
  const sc = parseFloat(String(r.scale).replace(',', '.')), an = parseFloat(String(r.angle).replace(',', '.'));
  // ölçek 0 / boş: alan büyüklüğünden türetilir (annot.hatchEnts otomatik ölçek)
  ed.curPattern = { name: adlar.includes(r.name) ? r.name : 'SOLID', scale: isFinite(sc) && sc > 0 ? sc : 0, angle: isFinite(an) ? an : 0 };
  refreshTiles();
  api.toast(ed.curPattern.name === 'SOLID' ? t('patSolid') : ed.curPattern.name);
}
function targetPop(btn) {
  if (!v3 || !ed.is3D()) { if (!needModel()) return; enter3D(); }
  if (!gate('target3')) return;
  const cur = ui.pick3 || 'auto';
  const html = `<div class="pop-title">${esc(t('pick3Title'))}</div><div class="vs-grid">`
    + PICK3.map(([id, k]) => `<button type="button" data-p3="${id}" class="${cur === id ? 'on' : ''}"><svg class="ic" aria-hidden="true"><use href="#i-snap"/></svg><span>${esc(t(k))}</span></button>`).join('')
    + '</div>';
  const pop = openPop(btn, html);
  pop.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-p3]'); if (!b) return;
    ui.pick3 = b.dataset.p3;
    applyUi();
    pop.querySelectorAll('[data-p3]').forEach(x => x.classList.toggle('on', x === b));
    refreshTiles(); haptic('toggle'); prompt3D(); overlay3D();
  });
}
/*
 * ÜÇ BOYUTLU NESNE YAKALAMA (3B OSNAP).
 *
 * 2B'de yakalama olmadan çizim yapılmaz; 3B'de de yapılmaz. Eskiden 3B dokunuş yalnız KÖŞEYE
 * (ya da yüzeye) oturuyordu: bir duvarın ORTASINDAN ölçü almak, bir kirişe DİK inmek ya da bir
 * dairenin MERKEZİNİ yakalamak olanaksızdı. Artık 2B'nin beş temel kipi üç boyutta da çalışır
 * ve işaretleri aynıdır — END karesi, MID üçgeni, CEN çemberi.
 *
 * Kipler kullanıcıdadır (ui.snap3Modes), anahtar ayrıdır (ui.snap3): AutoCAD'de de F3 kipleri
 * silmez, yalnız yakalamayı durdurur.
 */
const snap3On = () => !!ui.snap3 && (ui.snap3Modes || []).length > 0;
function toggleSnap3() {
  if (!gate('snap3')) return;
  if (!needModel()) return;
  if (!ed.is3D()) enter3D();
  ui.snap3 = !ui.snap3;
  // Bütün kipler kapatılmışsa anahtar tek başına işe yaramaz: açılışta öntanımlı üçlü geri gelir.
  if (ui.snap3 && !(ui.snap3Modes || []).length) ui.snap3Modes = DEFAULT_MODES3.slice();
  applyUi(); refreshTiles(); haptic('toggle');
  api.toast(tileLabel('snap3') + ' · ' + t(snap3On() ? 'on' : 'off'), 1400);
  prompt3D(); overlay3D();
}
function snap3Pop(btn) {
  if (!gate('snap3')) return;
  if (!v3 || !ed.is3D()) { if (!needModel()) return; enter3D(); }
  if (!v3) return;
  const html = `<div class="pop-title">${esc(tileLabel('snap3set'))}</div><div class="vs-grid">`
    + MODES3.map(m => `<button type="button" data-s3="${m.id}" class="${(ui.snap3Modes || []).includes(m.id) ? 'on' : ''}">${snapMarkerSvg(m.id, 'ic')}<span>${esc(snapModeName(m.id))}</span></button>`).join('')
    + '</div>';
  const pop = openPop(btn, html);
  pop.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-s3]'); if (!b) return;
    const id = b.dataset.s3, acik = new Set(ui.snap3Modes || []);
    if (acik.has(id)) acik.delete(id); else acik.add(id);
    // Sıra KİP ÖNCELİĞİDİR (MODES3), kullanıcının dokunma sırası değil: END her zaman MID'in önünde kalır.
    ui.snap3Modes = MODES3.map(m => m.id).filter(x => acik.has(x));
    if (ui.snap3Modes.length) ui.snap3 = true;
    applyUi(); b.classList.toggle('on', acik.has(id));
    refreshTiles(); haptic('toggle'); prompt3D(); overlay3D();
  });
}
// ---- uzun basış: ipucu + sık kullanılan ---------------------------------------------------------
function bindLongPress(tb) {
  let timer = 0, start = null, target = null;
  const cancel = () => { clearTimeout(timer); timer = 0; start = null; target = null; };
  tb.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    cancel(); start = [ev.clientX, ev.clientY]; target = b;
    timer = setTimeout(() => { timer = 0; if (!target) return; target.dataset.longFired = '1'; haptic('long'); showTilePop(target); setTimeout(() => { if (target) delete target.dataset.longFired; }, 600); }, ui.glove ? 650 : 550);
  });
  tb.addEventListener('pointermove', (ev) => { if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 8) cancel(); });
  tb.addEventListener('pointerup', cancel); tb.addEventListener('pointercancel', cancel); tb.addEventListener('pointerleave', cancel);
}
let popState = null;
function showTilePop(btn) {
  const actName = btn.dataset.act;
  const fav = ui.favs.includes(actName);
  const lock = !has(actName), n = lock ? need(actName) : '';
  const html = `<div class="pop-title">${esc(tileLabel(actName))}</div>`
    + (tileHint(actName) ? `<div class="pop-hint">${esc(tileHint(actName))}</div>` : '')
    + (lock ? `<div class="pop-lock"><span class="lk lk-pill" data-tier="${n}" aria-hidden="true"><span data-i18n="tier_${n}">${esc(tierName(n))}</span></span><span>${esc(tt('tierOnly', '%s paketinde bulunur.').replace('%s', tierName(n)))}</span></div>` : '')
    + `<div class="pop-row">`
    + (lock ? `<button type="button" class="btn small primary" data-pop="pro"><span data-i18n="goPro">${esc(t('goPro'))}</span></button>` : '')
    + `<button type="button" class="btn small ${fav || lock ? '' : 'primary'}" data-fav="${esc(actName)}">${ICON('i-star')}${esc(fav ? t('favRemove') : t('favAdd'))}</button></div>`;
  openPop(btn, html, { kind: 'tip' });
  const pop = $('tbPop');
  const fb = pop.querySelector('[data-fav]');
  if (fb) fb.addEventListener('click', () => { toggleFav(actName); closePop(); });
  const pb = pop.querySelector('[data-pop="pro"]');
  if (pb) pb.addEventListener('click', () => { closePop(); openProPanel(n); });
}
function toggleFav(actName) {
  const i = ui.favs.indexOf(actName);
  if (i >= 0) ui.favs.splice(i, 1); else ui.favs.push(actName);
  applyUi();
  const cur = ed.tab;
  buildToolbar();
  if (!ui.favs.length && cur === 'fav') setTab('view'); else setTab(cur);
  api.toast(i >= 0 ? t('favRemove') : t('favAdd'), 1200);
}
/** #tbPop: anchor düğmesinin üstünde (dikey) ya da solunda (yatay ray) */
/** Açılır kutunun dayanacağı öge: tıklanan karo, yoksa etkin karo, o da yoksa şerit (komut satırı yolu) */
function popAnchor(anchor) {
  return anchor && typeof anchor.getBoundingClientRect === 'function'
    ? anchor : (document.querySelector('#toolbar .tb-btn.on') || $('toolbar') || $('app'));
}
function openPop(anchor, html, o = {}) {
  closePop();
  const pop = $('tbPop'), app = $('app');
  pop.innerHTML = html; pop.hidden = false; pop.classList.toggle('side', landscapeMq.matches);
  // Komut satırından gelen çağrıda (VS, HIDE, RENDER, SPLANE…) tıklanan bir karo yoktur: açılır kutu
  // o zaman etkin karoya, o da yoksa şeridin ortasına dayanır — çapasız çağrı çökmez.
  const el = popAnchor(anchor);
  const ar = el.getBoundingClientRect(), pr = app.getBoundingClientRect();
  const w = Math.min(pop.offsetWidth, pr.width - 16), h = pop.offsetHeight;
  let x, y;
  if (landscapeMq.matches) { x = ui.leftHand ? ar.right - pr.left + 8 : ar.left - pr.left - w - 8; y = Math.max(8, Math.min(pr.height - h - 8, ar.top - pr.top + ar.height / 2 - h / 2)); }
  else { x = Math.max(8, Math.min(pr.width - w - 8, ar.left - pr.left + ar.width / 2 - w / 2)); y = ar.top - pr.top - h - 10; if (y < 8) y = 8; pop.style.setProperty('--arrow-x', (ar.left - pr.left + ar.width / 2 - x) + 'px'); }
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  popState = { destroy: o.destroy || null, kind: o.kind || 'opt' };
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  return pop;
}
function onDocDown(ev) { const pop = $('tbPop'); if (!pop || pop.hidden) return; if (pop.contains(ev.target)) return; closePop(); }
function closePop() {
  const pop = $('tbPop'); if (!pop || pop.hidden) return;
  if (popState && popState.destroy) call(popState.destroy.destroy || popState.destroy);
  popState = null; pop.hidden = true; pop.innerHTML = '';
  document.removeEventListener('pointerdown', onDocDown, true);
}
/** 3B seçenek bölümünü açılır kutuda gösterir (zscale / clip3) */
function optionPop(btn, renderFn, title) {
  if (!v3) { api.toast(tt('v3NotOpen', '3B görünüm açık değil.')); return; }
  const pop = openPop(btn, `<div class="pop-title">${esc(title)}</div><div class="pop-body"></div>`);
  const body = pop.querySelector('.pop-body');
  const h = renderFn(body, v3, host3());
  popState.destroy = h;
  // içerik yüklendikten sonra konumu tazele
  const ar = popAnchor(btn).getBoundingClientRect(), pr = $('app').getBoundingClientRect();
  if (!landscapeMq.matches) { const hh = pop.offsetHeight; let y = ar.top - pr.top - hh - 10; if (y < 8) y = 8; pop.style.top = y + 'px'; }
}
function needDoc() { if (!S.hasDoc) { api.toast(t('openFirst')); return false; } return true; }
/*
 * 2B araç kimliğinin 3B karşılığı ('t:line' → '3:line'). Liste, üç boyutta bir YAPI DÜZLEMİ
 * gerektirmeden çalışabilen araçlardır: çizgi ve seçim nokta toplar, taşı / kopyala / döndür /
 * ölçekle / aynala seçime dönüşüm uygular. Kavis, buda, tarama gibi araçlar burada YOKTUR —
 * onların girdisi düzlemsel bir kesişimdir, 3B'de anlamı yoktur.
 */
const T2TO3 = { line: 'line', pline3d: 'pline', select: 'select', move: 'move', copy: 'copy', rotate: 'rotate', scale: 'scale', mirror: 'mirror', del: 'del', setz: 'setz' };
/** belge açık olmadan da çalışan karolar; HIST kendi kapalılığını yönetir (refreshUndo / görünüm geçmişi) */
const FREE = new Set(['more', 'display', 'drive', 'undo', 'redo', 'gps', 'basemap', 'theme', 'sun', 'open', 'new', 'about', 'settings', 'cmdhelp', 'closefile', 'osnapset', 'otrack']);
const HIST = new Set(['undo', 'redo', 'prevview', 'nextview']);
function needModel() { if (!needDoc()) return false; if (!S.scene.layouts[S.layoutIndex].isModel) { api.toast(t('modelOnly')); return false; } return true; }
function act(name, btn) {
  if (!gate(name)) return;   // Ücretsiz sürümde Pro özelliği: yükseltme kutusu
  if (!FREE.has(name) && !needDoc()) return;
  /*
   * "Son komut" karodan başlatılanı da sayar. AutoCAD'de sağ tuş / boş Enter, komutun nasıl
   * başlatıldığına bakmadan sonuncusunu yineler; yalnız komut satırından yazılanlar sayılsaydı
   * şeritten çalışan kullanıcı sağ tuşun neden bir şey yapmadığını anlayamazdı.
   */
  if (repeatable(name)) cmdLast = cmdOf(name);   // açma/kapama karoları (GRID, ORTHO…) yinelenmez: geri kapatırdı
  // 2B aracı 3B'den çağrıldıysa (komut satırı, kısayol, sık kullanılan) görünüm SESSİZCE değişmez:
  // neden söylenir. Çiz şeridi 3B'de zaten 2B araçlarını göstermez, bu yol yalnız yazarak gelenler içindir.
  if (name.startsWith('t:')) {
    if (!needModel()) return;
    const tn = name.slice(2);
    /*
     * 2B ARACIN 3B KARŞILIĞI. AutoCAD'de LINE, MOVE, ROTATE, SCALE, MIRROR üç boyutlu görünümde
     * de çalışır; kullanıcı komutu yazdı diye görünümü kaybetmez. Karşılığı olan araç doğrudan
     * 3B aracına gider. Karşılığı OLMAYANLAR (kavis, buda, tarama, ölçülendirme…) bir yapı
     * düzlemi ister — onlarda 2B'ye dönülür ve nedeni söylenir; sessiz değişiklik yapılmaz.
     */
    if (ed.is3D()) {
      const u3 = T2TO3[tn];
      if (u3) { void start3DTool(u3); markActive('3:' + u3); return; }
      const ad = tileLabel(name); exit3D(); api.toast(t('need2d').replace('%s', ad), 3000);
    }
    if (tools.active === tn || (tn === 'array' && /^array/.test(tools.active || ''))) { tools.cancel(); markActive(null); } else { tools.start(tn); markActive(name); }
    return;
  }
  if (name.startsWith('v:')) { if (!v3 || !ed.is3D()) { if (!needModel()) return; enter3D(); } if (v3) { v3.preset(name.slice(2), { animate: !ui.reduceMotion }); v3.render(); overlay3D(); } return; }
  if (name.startsWith('3:')) { if (!needModel()) return; if (!ed.is3D()) enter3D(); void start3DTool(name.slice(2)); markActive(name); return; }
  const tog = { text: 'showText', hatch: 'showHatch', dim: 'showDim', points: 'showPoint', images: 'showImage', lw: 'lw', mono: 'colorMode', ltype: 'showLtype', grid: 'grid', crosshair: 'crosshair', rulers: 'rulers', fade: 'fade', sun: 'sun', theme: 'theme' };
  if (tog[name]) { D.toggleDisplay(tog[name]); haptic('toggle'); refreshTiles(); return; }
  switch (name) {
    case 'extents': api.zoomExtents(); break;
    case 'zoomwin': call(api.zoomWindow); break;
    case 'prevview': if (api.viewHistory) api.viewHistory.back(); break;
    case 'nextview': if (api.viewHistory) api.viewHistory.forward(); break;
    case 'goto': call(api.gotoCoord); break;
    case 'home': if (!D.gotoHome()) { api.zoomExtents(); api.toast(tt('noHome', 'Ana görünüm kaydedilmemiş; Görünümler › Ana görünüm yap'), 2500); } break;
    case 'layers': case 'search': case 'notes': case 'gps': case 'pdf': case 'png': case 'more': case 'profile': case 'info': case 'views': case 'layouts': case 'basemap': case 'compare': case 'drive': case 'count': case 'textout':
    case 'markdim': case 'findrep': case 'blocklib': case 'copyclip': case 'pasteclip': case 'mesh3d': case 'tableout': case 'batch': case 'pdfcad':
    case 'wshare': case 'share': api.action(name); break;
    case 'osnap': toggleOsnap(); break;
    case 'osnapset': api.osnap.openDialog(); break;
    case 'otrack': api.osnap.toggleTrack(); syncQuick(); refreshTiles(); api.drawOverlay(); break;
    case 'selectsimilar': selectSimilar(); break;
    case 'cutclip': if (!ed.sel.size) { api.toast(t('selEmpty')); break; } api.action('cutclip'); break;
    case 'hideobj': hideObjects(false); break;
    case 'isoobj': hideObjects(true); break;
    case 'unisoobj': showAllObjects(); break;
    // --- v7.72 blok ailesi, maske, çizim sırası, harici referans
    case 'blocks': showBlocks(); break;
    case 'bsave': if (bses) void beditSave(false); else api.toast(t('bparamOnlyBedit')); break;
    case 'bclose': case 'refclose': if (bses) void beditClose(); else api.toast(t('bparamOnlyBedit')); break;
    case 'purge': void purgeDialog(); break;
    case 'rename': void renameDialog(); break;
    case 'blockreplace': void blockReplaceDialog(); break;
    case 'attsync': void attSync(); break;
    case 'battman': void battman(); break;
    case 'wblock': void wblockDialog(); break;
    case 'tofront': case 'toback': drawOrderSel(name === 'tofront' ? 'front' : 'back'); break;
    case 'texttofront': drawOrderKind('text'); break;
    case 'hatchtoback': drawOrderKind('hatch'); break;
    case 'wipeframe': S.wipeFrame = S.wipeFrame === false; S.cacheValid = false; api.requestRender(); api.toast(t(S.wipeFrame === false ? 'wipeFrameOff' : 'wipeFrameOn'), 1400); break;
    case 'attdisp': D.toggleDisplay('showAttrib'); haptic('toggle'); break;
    case 'xreffade': S.xrefFade = S.xrefFade > 0 ? 0 : 0.5; S.cacheValid = false; api.requestRender(); api.toast(t(S.xrefFade > 0 ? 'xrefFadeOn' : 'xrefFadeOff'), 1400); break;
    case 'xattach': case 'xbind': case 'xopen': case 'xdetach': api.action(name); break;
    // --- komut satırından gelen AutoCAD karşılıkları (karosu yok)
    case 'regen': S.cacheValid = false; api.requestRender(); if (ed.is3D() && v3) v3.render(); break;
    case 'selectall': if (!needModel()) return; if (ed.is3D()) exit3D(); if (tools.active !== 'select') { tools.start('select'); markActive('t:select'); } tools.selectAll(); break;
    case 'list': { const p = ed.sel.size ? [...ed.sel][0] : null; if (!p) { api.toast(t('noSel')); break; } api.showInfo(p); break; }
    case 'layiso': { const lays = selLayers(); if (!lays) break; call(api.isolateLayers, lays); break; }
    case 'layuniso': call(api.unisolate); break;
    case 'layoff': layerSet(selLayers(), { off: true }); break;
    case 'layon': layerSet([...S.layers.keys()], { off: false, frozen: false }); break;
    case 'laylck': layerSet(selLayers(), { locked: true }); break;
    case 'layulk': layerSet(selLayers(), { locked: false }); break;
    case 'xrefs': case 'about': case 'settings': case 'open': case 'new': api.action(name); break;
    case 'blockmgr': showBlocks(); break;
    case 'closefile': api.action('home'); break;
    case 'grips': toggleGrips(); break;
    case 'cmdline': toggleCmdLine(); break;
    case 'free3': {
      if (!gate('free3')) break;
      ui.free3 = !ui.free3; applyUi(); haptic('toggle'); refreshTiles();
      api.toast(tileLabel('free3') + ' · ' + t(ui.free3 ? 'on' : 'off'), 1400);
      if (ed.m3) prompt3D();
      break;
    }
    case 'ortho': toggleOrtho(); break;
    case 'polar': togglePolar(); break;
    case 'cmdhelp': showCmdList(); break;
    case 'display': call(api.openDisplayOptions, { seg: ed.is3D() ? '3d' : '2d' }); break;
    case 'undo': if (doc && doc.undo()) { refreshUndo(); api.requestRender(); if (ed.is3D()) { refresh3D(); v3.render(); } api.toast(t('undone')); } break;
    case 'redo': if (doc && doc.redo()) { refreshUndo(); api.requestRender(); if (ed.is3D()) { refresh3D(); v3.render(); } api.toast(t('redone')); } break;
    case 'savedxf': saveDxf(false); break;
    case 'savedelta': saveDxf(true); break;
    case 'layer': pickLayer(); break;
    case 'color': pickColor(); break;
    case 'props': showProps(); break;
    case '3d': if (!needModel()) return; if (ed.is3D()) exit3D(); else enter3D(); break;
    case 'persp': if (v3) { v3.set('persp', !v3.cam.persp); overlay3D(); api.toast(v3.cam.persp ? tt('perspective', 'Perspektif') : tt('orthographic', 'Ortografik'), 1200); } break;
    case 'zscale': optionPop(btn, renderZScale, tt('zscaleTitle', 'Düşey abartı')); break;
    case 'vstyle': vstylePop(btn); break;
    case 'target3': targetPop(btn); break;
    case 'snap3': toggleSnap3(); break;
    case 'snap3set': snap3Pop(btn); break;
    case 'hatchpat': void hatchPatPop(); break;
    case 'clip3': optionPop(btn, renderClip, tt('clipTitle', 'Kesit')); break;
    case 'color3': call(api.openDisplayOptions, { seg: '3d', focus: 'colorMode' }); break;
    case 'light3': if (v3) v3.set('light', !v3.opts.light); break;
    case 'grid3': if (v3) v3.set('grid', !v3.opts.grid); break;
    case 'edges3': if (v3) { const onNow = v3._styleFx().edges; v3.set('edges', onNow ? 'none' : 'facet'); api.toast(onNow ? tt('edgesOff', 'Kenarlar kapalı') : tt('edgesOn', 'Kenarlar açık'), 1200); } break;
    case 'axes3': if (v3) v3.set('axes', !v3.opts.axes); break;
    case 'cube3': if (v3) { v3.set('cube', !v3.opts.cube); syncCube(); } break;
    case 'hud3': if (v3) { v3.set('hud', !v3.opts.hud); syncCube(); } break;
    case 'turn3': if (v3) v3.set('turntable', !v3.opts.turntable); break;
    case 'shadow3': if (v3) v3.set('shadow', !v3.opts.shadow); break;
    case 'sil3': if (v3) { const st = View3D.STYLES[v3.opts.style]; if (st && st.silhouette) { api.toast(tt('silByStyle', 'Bu stil siluet içerir; kapatmak için başka stil seçin'), 1500); break; } v3.set('silhouette', !v3.opts.silhouette); } break;
    case 'cam3': showBookmarks(); break;
    case 'fit3': if (v3) { v3.fit({ animate: !ui.reduceMotion }); overlay3D(); } break;
    default: break;
  }
  refreshTiles();
}
/** Seçimdeki nesnelerin katman adları; seçim boşsa uyarır ve null döner (LAYISO, LAYOFF, LAYLCK, LAYULK) */
function selLayers() {
  const lays = [...new Set([...ed.sel].map(p => p.lay).filter(Boolean))];
  if (!lays.length) { api.toast(t('noSel')); return null; }
  return lays;
}
/** Verilen katmanların durumunu (off / frozen / locked) TEK geri alma adımıyla değiştirir */
function layerSet(names, durum) {
  if (!names || !names.length || !doc) return false;
  const items = names.filter(nm => S.layers.has(nm)).map(nm => ({ name: nm, ...durum }));
  if (!items.length) return false;
  const ok = doc.run({ op: 'layerbulk', items });
  if (ok) { refreshUndo(); api.requestRender(); haptic('toggle'); }
  return ok;
}
/** app.js için: aynı toplu işlem (katman panelindeki ampul / kar tanesi / kilit sütunları) */
ed.layerSet = (names, durum) => layerSet(names, durum);
/*
 * Köşe tutamaklarını açar / kapar. Açıldığında seçili yolların düğümleri belirir (çoklu seçimde de);
 * sınır aşılıyorsa tutamak çizilmez ve kullanıcıya nedeni söylenir — sessizce hiçbir şey olmaması
 * "bozuk" gibi görünür.
 */
function toggleGrips() {
  ui.grips = !ui.grips;
  applyUi(); haptic('toggle'); refreshTiles(); api.drawOverlay();
  if (ui.grips && ed.sel.size && [...ed.sel].every(p => p.info && p.info.t === 'DIMENSION')) { api.toast(t('gripsDim'), 2600); return; }
  // seçimde yol var ama düğüm çizilemiyor: nesne başına 200 / toplam 400 düğüm ya da 100 nesne sınırı. Sınırın kendisine
  // bakılır (gizmoVertLayout araç çalışırken / 3B'de / kutu kapalıyken de null döner; o durumlarda bu ileti yanlış olurdu)
  if (ui.grips && [...ed.sel].some(p => p.k === 0 && !(p.info && p.info.t === 'DIMENSION')) && !Gz.vertsOfAll(ed.sel).length) { api.toast(t('gripsTooMany'), 2600); return; }
  api.toast(ui.grips ? t('gripsOnMsg') : t('gripsOffMsg'), 1200);
}
/** F3 / durum çubuğu / şerit karosu: tek kaynak osnap.toggle (liste saklanır, açılınca geri gelir) */
function toggleOsnap() { api.osnap.toggle(); syncQuick(); refreshTiles(); }
/** SELECTSIMILAR / QSELECT: seçimdeki her nesneyle aynı TÜR ve KATMANdaki görünür nesneler seçime eklenir */
function selectSimilar() {
  if (!needModel()) return;
  if (!ed.sel.size) { api.toast(t('noSel')); return; }
  const key = (p) => ((p.info && p.info.t) || p.et || ('k' + p.k)) + '|' + p.lay;
  const want = new Set([...ed.sel].map(key));
  let n = 0;
  for (const p of S.prims) { if (p.k === 4 || p.inf || ed.sel.has(p) || !want.has(key(p))) continue; if (typeof api.primVisible === 'function' && !api.primVisible(p)) continue; ed.sel.add(p); n++; }
  api.drawOverlay(); refreshTiles();
  api.toast(t('selSimilarN').replace('%s', String(n)), 1600);
  if (n) haptic('snap');
}
/** HIDEOBJECTS / ISOLATEOBJECTS: görünüm durumu (çizim değişmez); ileti geri alma düğmesi taşır */
function hideObjects(isolate) {
  if (!needModel()) return;
  if (!ed.sel.size) { api.toast(t('noSel')); return; }
  const keys = [...ed.sel].map(p => p.key);
  call(api.hideObjects, keys, isolate);
  ed.sel.clear();
  refreshTiles(); api.drawOverlay();
  api.toast(t(isolate ? 'isolatedN' : 'hiddenN').replace('%s', String(keys.length)), { ms: 5000, action: { label: t('undoAction'), fn: () => showAllObjects() } });
  haptic('toggle');
}
function showAllObjects() { call(api.showAllObjects); refreshTiles(); api.drawOverlay(); api.toast(t('shownAll'), 1400); }
/** app.js kipleri değiştirdiğinde (ayar kutusu, çip şeridi, -OSNAP) durum çubuğu ve karolar tazelenir */
ed.snapChanged = () => { syncQuick(); refreshTiles(); syncSnapOnce(); };
/** Gezinme yakalaması için: çalışan aracın son noktası (dik / teğet / paralel bunu ister) */
ed.lastToolPoint = () => (tools && tools.running && tools.pts && tools.pts.length ? tools.pts[tools.pts.length - 1] : null);

// ---------------------------------------------------------------------------------
// Durum çubuğu: hızlı düğmeler, kip çipi
// ---------------------------------------------------------------------------------
function bindStatusBar() {
  const q = $('stQuick'); if (!q) return;
  let uzunBasis = 0, uzunOldu = false;
  q.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-quick]'); if (!b) return;
    if (uzunOldu) { uzunOldu = false; return; }   // uzun basış kutuyu açtı; ardından gelen click kipi değiştirmesin
    const k = b.dataset.quick;
    if (k === 'undo' || k === 'redo') { act(k); syncQuick(); return; }   // titreşim ve ileti act içinde
    if (k === 'grid') D.toggleDisplay('grid'); else if (k === 'lw') D.toggleDisplay('lw'); else if (k === 'text') D.toggleDisplay('showText'); else if (k === 'osnap') toggleOsnap();
    haptic('toggle'); syncQuick(); refreshTiles();
  });
  // OSNAP düğmesi: dokunuş açar / kapar (F3), uzun basış ya da sağ tık ayar kutusunu açar (AutoCAD durum çubuğu gibi)
  q.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('[data-quick="osnap"]'); if (!b) return;
    clearTimeout(uzunBasis); uzunOldu = false;
    uzunBasis = setTimeout(() => { uzunOldu = true; haptic('long'); api.osnap.openDialog(); }, 500);
    const iptal = () => { clearTimeout(uzunBasis); b.removeEventListener('pointerup', iptal); b.removeEventListener('pointercancel', iptal); b.removeEventListener('pointerleave', iptal); };
    b.addEventListener('pointerup', iptal); b.addEventListener('pointercancel', iptal); b.addEventListener('pointerleave', iptal);
  });
  q.addEventListener('contextmenu', (ev) => { const b = ev.target.closest('[data-quick="osnap"]'); if (!b) return; ev.preventDefault(); clearTimeout(uzunBasis); uzunOldu = true; api.osnap.openDialog(); });
  syncQuick();
}
function syncQuick() {
  if (!S) return;
  const on = { grid: S.grid.on, lw: !!S.lw, text: S.show.text, osnap: S.snapModes.size > 0 };
  document.querySelectorAll('#stQuick [data-quick]').forEach(b => { const k = b.dataset.quick; if (k === 'undo' || k === 'redo') return; const v = !!on[k]; b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); });
  // geri al / yinele: kalan adım rozeti (10 geri · 10 ileri), adım yoksa devre dışı
  const nU = doc ? doc.undoStack.length : 0, nR = doc ? doc.redoStack.length : 0;
  for (const [k, n] of [['undo', nU], ['redo', nR]]) {
    const b = document.querySelector(`#stQuick [data-quick="${k}"]`); if (!b) continue;
    b.disabled = !n; const ct = b.querySelector('.st-ct'); if (ct) { ct.textContent = String(n); ct.hidden = !n; }
  }
}
let mode3Text = null, modeText = null;
function statusMode(text) { modeText = text || null; renderMode(); }
function statusMode3D() {
  // kısa çip: ayrıntı (yaw / pitch / ızgara) HUD kutusunda; 'Yüzey yok' tanısı noFaces kartında
  mode3Text = ed.is3D() && v3 ? tt('mode3d', '3B') + ' · ' + (v3.cam.persp ? tt('perspShort', 'Persp') : tt('orthoShort', 'Paralel')) : null;
  renderMode();
}
function renderMode() {
  const el = $('stMode'); if (!el) return;
  const txt = mode3Text || modeText;
  el.hidden = !txt; el.textContent = txt || '';
}

// ---------------------------------------------------------------------------------
// Komut satırı
// ---------------------------------------------------------------------------------
const BTN = { finish: ['finishBtn', () => tools.finish()], close: ['close', () => tools.close()], back: ['backBtn', () => tools.back()], selall: ['layersAll', () => tools.selectAll()], selbox: ['selBoxBtn', () => tools.setSelMode('box')], sellasso: ['selLassoBtn', () => tools.setSelMode('lasso')],
  // Ekran / Ölçü: değer isteyen düzenleme araçlarının kipi (ötele, kavis, pah, buda, uzat); araç boyunca görünür, seçili olan vurgulu
  modescreen: ['modeScreenBtn', () => tools.setMode('screen')], modevalue: ['modeValueBtn', () => tools.setMode('value')],
  // Aynala: orijinal kalsın mı? Açık = kopya (AutoCAD "Erase source objects? <N>"), kapalı = kaynak silinir
  mirrorkeep: ['mirrorKeepBtn', () => tools.toggleMirrorKeep()],
  // Aynala: yatay (X) / düşey (Y) ayna çizgisi — ilk noktadan önce seçilir, sonra tek nokta yeter
  mirrorx: ['mirrorXBtn', () => tools.setMirrorAxis('x')], mirrory: ['mirrorYBtn', () => tools.setMirrorAxis('y')],
  // Hizala: nesneler hizalama noktalarına göre ölçeklensin mi (AutoCAD'in son sorusu) · Maske: polyline'dan (WIPEOUT Polyline seçeneği)
  alignscale: ['alignScaleBtn', () => tools.toggleAlignScale()], wipepoly: ['wipePolyBtn', () => tools.setWipePoly()],
  // Tarama: desen seçici komut çubuğundan açılır; seçim bitince istem yeni desen adıyla tazelenir
  hatchpat: ['hatchPatBtn', () => { void hatchPatPop().then(() => { if (tools && tools.active === 'hatch') tools.say(); }); }],
  cancel: ['cancelBtn', () => { tools.cancel(); markActive(null); ed.sel.clear(); api.drawOverlay(); }] };
/*
 * Komut çubuğu düğmesi: SVG simge + etiket. Çeviri metinlerinin başındaki ince Unicode imleri
 * (✓ ↶ ✕) atılır; simgeyi yazı tipi değil SVG çizer, böylece her dilde aynı dolgunlukta görünür.
 * Bitir birincil (vurgu renkli) düğmedir: çubuğun onay eylemi odur.
 */
const CMD_ICON = { finish: 'i-check', close: 'i-closepath', back: 'i-undo', selall: 'i-selectall', cancel: 'i-close', selbox: 'i-selbox', sellasso: 'i-lasso', modescreen: 'i-crosshair', modevalue: 'i-ruler', mirrorkeep: 'i-copyobj', mirrorx: 'i-mirror-x', mirrory: 'i-mirror', alignscale: 'i-scale', wipepoly: 'i-pline', hatchpat: 'i-hatch' };
const CMD_ICON_ONLY = new Set(['selbox', 'sellasso', 'mirrorx', 'mirrory']);   // yalnız simge: beş düğme 412 px'te tek satıra sığsın; ad başlık / aria-label'da
function cmdBtnHtml(attr, k, label) {
  const lbl = String(label == null ? '' : label).replace(/^[✓↶✕⟲←]+\s*/, '');
  const ic = CMD_ICON[k];
  const m3 = ed.m3;
  const on = (m3 ? ((k === 'selbox' && m3.selMode === 'box') || (k === 'sellasso' && m3.selMode === 'lasso')) : false)
    || !!tools && ((k === 'selbox' && tools.selMode === 'box') || (k === 'sellasso' && tools.selMode === 'lasso') || (k === 'modescreen' && tools.mode === 'screen') || (k === 'modevalue' && tools.mode === 'value') || (k === 'mirrorkeep' && tools.mirrorKeep === true) || (k === 'mirrorx' && tools.mirrorAxis === 'x') || (k === 'mirrory' && tools.mirrorAxis === 'y') || (k === 'alignscale' && tools.alignScale === true) || (k === 'wipepoly' && tools.wipePoly === true));
  const cls = k === 'finish' ? 'primary' : (CMD_ICON_ONLY.has(k) ? 'icon' + (on ? ' on' : '') : (on ? 'on' : ''));
  const svg = ic ? `<svg class="ic" aria-hidden="true"><use href="#${ic}"/></svg>` : '';
  if (CMD_ICON_ONLY.has(k)) return `<button type="button" ${attr}="${k}" class="${cls}" title="${esc(lbl)}" aria-label="${esc(lbl)}" aria-pressed="${on}">${svg}</button>`;
  return `<button type="button" ${attr}="${k}"${cls ? ` class="${cls}"` : ''}>${svg}${esc(lbl)}</button>`;
}
function showPrompt(text, opts = {}) {
  const bar = $('cmdBar');
  // Araç bitince çubuk KAPANMAZ, AutoCAD'deki gibi boşta "Command:" istemine döner. Komut
  // satırı kapalıysa eski davranış sürer ve çubuk gizlenir.
  if (!text) { markActive(null); if (cmdLineOn()) { idlePrompt(); return; } bar.hidden = true; closeSuggest(); return; }
  bar.hidden = false;
  cmdIdle = false; closeSuggest();
  bar.classList.remove('idle');   // çalışan komutun istemi uzundur: kendi satırında kalır
  $('cmdText').textContent = text;
  const inp = $('cmdInput');
  inp.hidden = !opts.input;
  { const en = $('cmdEnter'); if (en) en.hidden = !opts.input; }   // giriş yokken Enter da yok: seçim kipinde işlevsizdi, yer kaplıyordu
  syncOrthoBtn(opts.input === 'point');                             // Ortho yalnız NOKTA istenirken: sayı ve seçim istemlerinde anlamsız
  syncTtBtn(opts.input === 'point');                                // İz noktası (TT) de yalnız nokta isteminde
  syncHideBtn(false); syncHelpBtn(false);                           // Gizle ve ? yalnız BOŞTA: çalışan komutun istemi kapatılamaz, satırı da dardır
  inp.placeholder = opts.input === 'number' ? t('numberPh') : t('coordPh');
  inp.type = 'text';
  // Kutudaki tek sayı doğrudan uzaklık girişidir (Çizgi / Polyline): istem tazelenince silinmez, dokunuşta kullanılır
  if (!(opts.keepLen && /^[-+]?\d+(\.\d+)?$/.test(inp.value))) inp.value = '';
  $('cmdBtns').innerHTML = (opts.buttons || []).map(k => cmdBtnHtml('data-cmd', k, t(BTN[k][0]))).join('');
  // Yalnız değer istenen istemde alan odaklanır: kullanıcı kutuya ayrıca dokunmak zorunda kalmaz, klavye
  // (kalemde el yazısı paneli) kendiliğinden gelir. Nokta istemlerinde odaklanmaz — klavye çizimi örterdi.
  if (opts.focus && !inp.hidden) setTimeout(() => { try { if (!inp.hidden && document.activeElement !== inp) inp.focus(); } catch (_) { /* odak yoksa geç */ } }, 0);
}
/* ---- AutoCAD tarzı komut satırı ---------------------------------------------------
 * Boştayken çubuk "Command:" der ve komut adı bekler; bir araç çalışırken o aracın istemini
 * gösterir. İkisi TEK çubuktur — AutoCAD'de de öyledir ve iki ayrı alan olsaydı kullanıcı
 * hangisine yazacağını bilemezdi.
 *
 * AutoCAD'den birebir alınan üç davranış:
 *   · boş Enter son komutu YİNELER
 *   · yukarı / aşağı ok komut geçmişinde gezer
 *   · yazarken ada uyan komutlar listelenir (tam adlar önce, kısaltmalar sonra)
 */
let cmdIdle = false, cmdHist = [], cmdHistI = -1, cmdLast = '';
/*
 * Komut satırı yalnız ÇİZİM üstünde anlamlıdır. Belge kipinde (PDF, Word, Excel görüntüleyici)
 * çizim komutu çalıştırılamaz; çubuk orada durursa hem yer kaplar hem de yazılan komut sessizce
 * hiçbir şey yapmış gibi görünür. Bu yüzden docmode dışlanır.
 */
const cmdLineOn = () => ui.cmdLine !== false && !!(S && S.hasDoc) && !document.body.classList.contains('docmode');
function idlePrompt() {
  const bar = $('cmdBar'); if (!bar) return;
  cmdIdle = true;
  bar.hidden = false;
  $('cmdText').textContent = t('cmdPrompt');
  const inp = $('cmdInput');
  inp.hidden = false; inp.type = 'text'; inp.value = ''; inp.placeholder = t('cmdPh');
  { const en = $('cmdEnter'); if (en) en.hidden = false; }
  syncOrthoBtn(false); syncTtBtn(false); syncHideBtn(true); syncHelpBtn(true);
  bar.classList.add('idle');   // boşta istem satırı girişle aynı satırda durur (bir satır kazanılır)
  /*
   * Komut listesine tek kapı: boştaki çubuğun "?" düğmesi. Menüye gömülseydi komut satırını
   * yeni gören kullanıcı hangi adları yazabileceğini hiç öğrenemezdi.
   *
   * v7.82'de #cmdBtns'ten İSTEM SATIRINA taşındı. Sebep ölçüdür: #cmdBtns'teki düğmeler komut
   * ortasında basılan EYLEM düğmeleridir (Bitir · Geri · İptal) ve 40 px'lik dokunma hedefi
   * sözleşmesindedir; "?" ise kalıcı bir yardım gerecidir ve Ortho / İz noktası / Gizle ile aynı
   * ailedendir. #cmdBtns'te kaldığı sürece BOŞTAKİ çubuk o 40 px yüzünden incelemiyordu.
   */
  $('cmdBtns').innerHTML = '';
  closeSuggest();
}
function closeSuggest() { const el = $('cmdSug'); if (el) { el.hidden = true; el.innerHTML = ''; } }
/*
 * Dil değişince boştaki istem yeniden yazılır. applyI18n yalnız data-i18n taşıyan düğümleri
 * çevirir; komut çubuğunun metni duruma göre değiştiği için (boşta "Komut:", araç çalışırken
 * aracın istemi) o düğüme sabit bir anahtar konamaz — bu yüzden burada elle tazeleniyor.
 * Ayrıca giriş alanının yer tutucusu applyI18n tarafından koordinat metnine döndürülür;
 * boştayken doğru olan komut yer tutucusudur.
 */
window.addEventListener('dwg:lang', () => { if (cmdIdle && !$('cmdBar').hidden) idlePrompt(); });
function showSuggest(text) {
  const el = $('cmdSug'); if (!el) return;
  const list = text ? acadSuggest(text, 8) : [];
  if (!list.length) { closeSuggest(); return; }
  // Bulunmayan komut (avail:false) da listelenir ama soluk: kullanıcı yazdığının tanındığını,
  // yalnız burada olmadığını görür; dokununca komut satırı nedenini söyler.
  el.innerHTML = list.map(c => `<button type="button" data-cmd-run="${esc(c.cmd)}"${c.avail === false ? ' class="na"' : ''}><b>${esc(c.cmd)}</b>${c.alias && c.alias.length ? `<i>${esc(c.alias.join(', '))}</i>` : ''}<span>${esc(c.label || '')}${c.ext ? ' ·' : ''}${c.avail === false ? ' ✕' : ''}</span></button>`).join('');
  el.hidden = false;
}
/** Komut satırına yazılanı çalıştırır. → true işlendi, false tanınmadı */
function runCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  // "Z W", "ZOOM P" gibi seçenekli yazım: ilk sözcük komut, gerisi seçenek. Yalnız ZOOM seçenek alır; ötekilerde fazlalık yok sayılır.
  const sp = raw.search(/\s/);
  const head = sp > 0 ? raw.slice(0, sp) : raw, arg = sp > 0 ? raw.slice(sp + 1).trim() : '';
  const c = acadResolve(head);
  if (!c) { api.toast(t('cmdUnknown').replace('%s', head.toUpperCase()), 2200); return false; }
  /*
   * Tanınan ama bulunmayan AutoCAD komutu: "bilinmeyen" denmez, bulunmadığı ve varsa en yakın
   * karşılığı söylenir. Komut geçmişine de "son komut"a da girmez — yinelenecek bir şey yok.
   */
  if (c.avail === false) { closeSuggest(); api.toast(t('cmdNotAvail').replace('%s', c.cmd) + (c.note ? ' — ' + c.note : ''), 3600); return false; }
  if (c.noRepeat !== true) cmdLast = c.cmd;
  cmdHist = [c.cmd, ...cmdHist.filter(x => x !== c.cmd)].slice(0, 30);
  cmdHistI = -1;
  closeSuggest();
  // AutoCAD'deki gibi '-' öneki komut satırı sürümünü ister: -LAYER (ve -LA) pencere açmaz,
  // seçenekleri sorar. Öteki komutlarda '-' yalnız öneki düşürülmüş ad olarak kabul edilir.
  if (c.id === 'layers' && /^-/.test(head.replace(/^['_]+/, ''))) { layerCli(); return true; }
  if (c.id === 'osnapset' && /^-/.test(head.replace(/^['_]+/, ''))) { osnapCli(); return true; }
  if (c.id === 'extents' && arg) { zoomOption(arg); return true; }
  act(c.id);
  return true;
}
/** ZOOM seçenekleri (AutoCAD): W pencere · P önceki · E / A sınırlar · O seçili nesneler · 2X / 0.5X ölçek */
function zoomOption(arg) {
  const a = String(arg).trim().toUpperCase();
  if (/^(W|WINDOW)$/.test(a)) { call(api.zoomWindow); return; }
  if (/^(P|PREVIOUS)$/.test(a)) { if (api.viewHistory) api.viewHistory.back(); return; }
  if (/^(E|EXTENTS|A|ALL)$/.test(a)) { api.zoomExtents(); return; }
  if (/^(O|OBJECT)$/.test(a)) { if (!ed.sel.size) { api.toast(t('noSel')); return; } call(api.fitPrims, [...ed.sel]); return; }
  const m = a.match(/^(\d*\.?\d+)X?$/);
  if (m && parseFloat(m[1]) > 0) { call(api.zoomBy, parseFloat(m[1])); return; }
  api.toast(t('zoomBadOpt'), 2400);
}
/** Geri getirme yolu: "Ekran ▸ <karo adı>" — adlar çalışma anında okunur, çeviriyle uyumlu kalır */
const geriYolu = (id) => t('tabDisplay') + ' \u25b8 ' + tileLabel(id);
/** Gizle düğmesi yalnız boştaki çubukta görünür (çalışan komutun istemi gizlenemez) */
function syncHideBtn(goster) { const b = $('cmdHide'); if (b) b.hidden = !goster; }
/*
 * GERİ GETİRME DÜĞMESİ. Yalnız çubuğu kullanıcı kapattığında çıkar — belge yokken ya da PDF
 * görüntüleyicide çubuk zaten olmadığı için düğme de olmaz (yoksa boş ekranda anlamsız bir
 * düğme asılı kalırdı).
 */
function syncCmdShow() {
  const b = $('cmdShow'); if (!b) return;
  /*
   * Pil yalnız çubuk GERÇEKTEN kapalıyken çıkar. Yalnız ui.cmdLine'a bakmak yetmiyordu:
   * çubuk gizliyken bir komut başlatılınca showPrompt / prompt3D çubuğu yeniden açıyor
   * (ui.cmdLine false kalıyor) ve pil çubuğun giriş kutusuyla düğmelerinin ÜSTÜNE biniyordu.
   */
  const bar = $('cmdBar');
  b.hidden = !(bar && bar.hidden && ui.cmdLine === false && !!(S && S.hasDoc) && !document.body.classList.contains('docmode'));
}
/** Komut listesi ("?") yalnız BOŞTA görünür: komut çalışırken istem satırının yeri dardır */
function syncHelpBtn(goster) { const b = $('cmdHelp'); if (b) b.hidden = !goster; }
function bindCmdBar() {
  // Komut satırını tek dokunuşla kapatır. Geri getirmek Ekran ▸ Komut satırı karosundadır;
  // kullanıcı kapattığı şeyi nasıl geri açacağını bilsin diye ileti bunu söyler.
  { const hb = $('cmdHide'); if (hb && !hb.dataset.bound) { hb.dataset.bound = '1'; hb.addEventListener('click', () => { toggleCmdLine(); api.toast(t('cmdHidden').replace('%s', geriYolu('cmdline')), 3200); }); } }
  { const sb = $('cmdShow'); if (sb && !sb.dataset.bound) { sb.dataset.bound = '1'; sb.addEventListener('click', () => { toggleCmdLine(); }); } }
  // Çubuğu açıp kapatan yol çoktur (komut başlangıcı, bitişi, iptal, 3B istemi). Hepsini tek tek
  // çağırmak yerine kaynağı izlemek daha güvenli: hidden değişince pil kendiliğinden tazelenir.
  { const bar = $('cmdBar'); if (bar && !bar.dataset.izleniyor) { bar.dataset.izleniyor = '1'; try { new MutationObserver(syncCmdShow).observe(bar, { attributes: true, attributeFilter: ['hidden'] }); } catch (_) { /* yok */ } } }
  { const qb = $('cmdHelp'); if (qb && !qb.dataset.bound) { qb.dataset.bound = '1'; qb.addEventListener('click', () => showCmdList()); } }
  { const ob = $('cmdOrtho'); if (ob && !ob.dataset.bound) { ob.dataset.bound = '1'; ob.addEventListener('click', () => toggleOrtho()); } }   // giriş satırındaki Ortho düğmesi (odak vermez: klavye açılmasın)
  // İz noktası (AutoCAD TT): sonraki dokunuş nokta sayılmaz, iz noktası edinir — izleme kapalıyken de çalışır (geçici iz noktası).
  // İstem satırındadır: komut düğmesi satırına beşinci düğme (Bitir · Kapat · Geri · TT · İptal) 412 px telefonda üçüncü satır açıp tuvali örtüyordu.
  { const tt = $('cmdTt'); if (tt && !tt.dataset.bound) { tt.dataset.bound = '1'; tt.addEventListener('click', () => { if (!tools.running) return; api.osnap.once('tk'); syncSnapOnce(); }); } }
  const bar = $('cmdBar'), vp = $('viewport');
  const syncCmd = () => { document.body.classList.toggle('cmd-open', !bar.hidden); if (!bar.hidden && vp) vp.style.setProperty('--cmd-h', bar.offsetHeight + 'px'); };
  new MutationObserver(syncCmd).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  /*
   * Belge kipine (PDF / Word / Excel görüntüleyici) girilip çıkıldığında çubuk kendiliğinden
   * gizlenir ve geri gelir. Sınıfı docs.js koyar; sıralama garanti edilemediği için tek yönlü
   * bir denetim yetmiyor — gövde sınıfı izleniyor. Böylece docs.js'in editor.js'i tanıması da
   * gerekmiyor, bağ tek yönlü kalıyor.
   */
  new MutationObserver(() => {
    const belge = document.body.classList.contains('docmode');
    if (belge) { if (!bar.hidden) { bar.hidden = true; cmdIdle = false; closeSuggest(); } }
    else if (bar.hidden && cmdLineOn() && !tools.running && !ed.m3) idlePrompt();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncCmd).observe(bar);
  $('cmdBtns').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-cmd-help]')) { showCmdList(); return; }
    if (ev.target.closest('[data-cmdseq]')) { cmdSeqCancel(); return; }
    const b = ev.target.closest('[data-cmd]'); if (b && BTN[b.dataset.cmd]) BTN[b.dataset.cmd][1]();
  });
  const submit = () => {
    const inp = $('cmdInput'), v = inp.value;
    // BOŞTA: yazılan bir komut adıdır. Boş Enter son komutu yineler (AutoCAD'deki gibi).
    if (cmdIdle) { inp.value = ''; const metin = v.trim() || cmdLast; if (metin) runCommand(metin); return; }
    if (cmdSeq) { inp.value = ''; cmdSeqInput(v); return; }   // komut satırı sırası (-LAYER): boş Enter da bir cevaptır
    if (!v) { if (!ed.m3 && tools.active && tools.enterEmpty) tools.enterEmpty(); return; }   // değer isteminde boş Enter <öntanımlı> değeri alır
    inp.value = '';
    if (ed.m3) { if (!gate('3:' + ed.m3.name)) return; typed3D(v); }
    else {
      if (tools.active && !gate('t:' + tools.active)) return;
      // AutoCAD'deki gibi nokta istemine yakalama adı yazılabilir: sonraki nokta o kiple alınır
      const ov = tools.active && api.osnap ? api.osnap.overrideOf(v) : null;
      if (ov) { api.osnap.once(ov); return; }
      tools.typed(v);
    }
  };
  $('cmdEnter').addEventListener('click', submit);
  $('cmdInput').addEventListener('input', () => { if (cmdIdle) showSuggest($('cmdInput').value); });
  $('cmdInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { submit(); return; }
    if (!cmdIdle) return;
    if (ev.key === 'Escape') { $('cmdInput').value = ''; closeSuggest(); return; }
    // Geçmişte gezinme: yukarı geri, aşağı ileri. Liste sonuna gelince alan boşalır.
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      if (!cmdHist.length) return;
      ev.preventDefault();
      cmdHistI = ev.key === 'ArrowUp' ? Math.min(cmdHist.length - 1, cmdHistI + 1) : cmdHistI - 1;
      if (cmdHistI < 0) { cmdHistI = -1; $('cmdInput').value = ''; closeSuggest(); return; }
      $('cmdInput').value = cmdHist[cmdHistI];
      closeSuggest();
    }
  });
  const sug = $('cmdSug');
  if (sug) sug.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cmd-run]'); if (!b) return;
    $('cmdInput').value = '';
    runCommand(b.dataset.cmdRun);
  });
}
/*
 * Komut listesi. Uzun basışla açılır ve iki bölüme ayrılır: AutoCAD karşılığı OLAN komutlar ve
 * uygulamaya özgü olanlar. Ayrım gizlenmez — kullanıcı "bu AutoCAD'de de var mı" sorusunun
 * cevabını burada görür; davranış farkı olan komutlarda o fark da yazar.
 */
function showCmdList() {
  const sat = (c) => `<tr${c.avail === false ? ' class="na"' : ''}><td><code>${esc(c.cmd)}</code></td><td>${esc((c.alias || []).join(', '))}</td><td>${esc(c.label || '')}${c.note ? ` <i>(${esc(c.note)})</i>` : ''}</td></tr>`;
  const tablo = (list) => `<table class="cmd-list"><tbody>${list.map(sat).join('')}</tbody></table>`;
  const sirala = (l) => l.slice().sort((a, b) => a.cmd.localeCompare(b.cmd));
  // Üç bölüm, üç dürüstlük: çalışan AutoCAD adları · uygulamaya özgü adlar · tanınan ama bulunmayanlar
  const acad = sirala(ACAD.filter(c => !c.ext && c.avail !== false));
  const ext = sirala(ACAD.filter(c => c.ext && c.avail !== false));
  const yok = sirala(ACAD.filter(c => c.avail === false));
  api.openDoc(t('cmdHelp'),
    `<div class="full"><div class="opt-title">${esc(t('cmdAcad'))} · ${acad.length}</div>${tablo(acad)}` +
    `<div class="opt-title">${esc(t('cmdExt'))} · ${ext.length}</div>${tablo(ext)}` +
    `<div class="opt-title">${esc(t('cmdKnown'))} · ${yok.length}</div>${tablo(yok)}</div>`);
}
/** Komut satırını açar / kapar; kapanınca çubuk da gider (araç çalışmıyorsa) */
function toggleCmdLine() {
  ui.cmdLine = ui.cmdLine === false;
  applyUi(); haptic('toggle'); refreshTiles();
  if (ui.cmdLine) { if (!tools.running && !ed.m3) idlePrompt(); }
  else if (!tools.running && !ed.m3) { $('cmdBar').hidden = true; cmdIdle = false; closeSuggest(); }
}
function showResult(rows, onCopy) {
  const html = api.kv(rows);
  api.openDoc(t('measureResult'), html);
  if (onCopy) { const b = $('tCopy'); if (b) b.onclick = onCopy; }
}

// ---------------------------------------------------------------------------------
// Katman / renk / özellikler
// ---------------------------------------------------------------------------------
/*
 * GEÇERLİ KATMAN ADI KAROYA YAZILIR — ve karo TEK DEĞİLDİR. 'layer' karosu Çiz şeridinde,
 * Açıklama şeridinde, 3B Çiz şeridinde (v7.82) ve favorilere eklendiyse Favoriler satırında
 * geçer; buildToolbar bütün satırları bir kerede DOM'a basar. getElementById yalnız DOM'daki
 * İLK kopyayı bulduğu için ötekiler 'Katman' diye bayat kalıyordu. refreshUndo() ile aynı
 * desene geçildi: seçici bütün kopyaları alır.
 */
function updateLayerButton() {
  const ad = ed.curLayer.length > 10 ? ed.curLayer.slice(0, 9) + '…' : ed.curLayer;
  document.querySelectorAll('#toolbar [data-act="layer"] .lb').forEach(el => { el.textContent = ad; });
}
function layerSelectHtml(id, cur) { return `<select id="${id}">${[...S.layers.keys()].sort((a, b) => a.localeCompare(b, 'tr')).map(n => `<option ${n === cur ? 'selected' : ''}>${api.esc(n)}</option>`).join('')}</select>`; }
function pickLayer() {
  if (!needDoc()) return;
  api.openDoc(t('curLayerSet'), api.kv([[t('layer'), layerSelectHtml('eLayer', ed.curLayer), 1], [t('newLayer'), `<input id="eNewLayer" placeholder="${esc(t('layerNamePh'))}"> <input id="eNewColor" type="number" min="1" max="255" placeholder="${esc(t('colorPh'))}" style="width:110px">`, 1],
    [`<div class="full btns"><button class="btn primary small" id="eLayerOk">${esc(t('ok'))}</button><button class="btn small" id="eLayerNew">${esc(t('createLayer'))}</button><button class="btn small" id="eLayerMgr"><svg class="ic" aria-hidden="true"><use href="#i-layers"/></svg> ${esc(t('layerManager'))}</button></div>`]]));
  $('eLayerOk').onclick = () => { ed.curLayer = $('eLayer').value; updateLayerButton(); api.hide('docPanel'); };
  $('eLayerMgr').onclick = () => { api.hide('docPanel'); api.action('layers'); };
  $('eLayerNew').onclick = () => {
    const name = $('eNewLayer').value.trim(); if (!name) return;
    const c = parseInt($('eNewColor').value, 10);
    if (doc.run({ op: 'layer', name, color: c >= 1 && c <= 255 ? c : -1 })) { ed.curLayer = name; updateLayerButton(); api.buildLayerList(); refreshUndo(); api.toast(t('layerCreated') + ': ' + name); api.hide('docPanel'); }
    else api.toast(t('layerExists'));
  };
}
function colorSwatches(sel) {
  const ids = [256, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 40, 50, 90, 130, 150, 170, 190, 210, 230, 250, 252, 254];
  return `<div class="swatches">${ids.map(i => `<button type="button" data-ci="${i}" class="${i === sel ? 'active' : ''}" style="background:${i === 256 ? 'transparent' : i === 7 ? '#ffffff' : '#' + (ACI[i] & 0xffffff).toString(16).padStart(6, '0')}" title="${i === 256 ? esc(t('fromLayer')) : i}">${i === 256 ? 'K' : ''}</button>`).join('')}</div>`;
}
function pickColor() {
  if (!needDoc()) return;
  api.openDoc(t('curColor'), `<div class="full">${colorSwatches(ed.curColor)}</div><div class="full muted">${esc(t('colorHint'))} <input id="eCi" type="number" min="1" max="255" style="width:90px" value="${ed.curColor === 256 ? '' : ed.curColor}"> <button class="btn small" id="eCiOk">${esc(t('ok'))}</button></div>`);
  $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-ci]'); if (b) { ed.curColor = Number(b.dataset.ci); api.hide('docPanel'); api.toast(t('color') + ': ' + (ed.curColor === 256 ? t('fromLayerLc') : ed.curColor)); } };
  $('eCiOk').onclick = () => { const c = parseInt($('eCi').value, 10); if (c >= 1 && c <= 255) { ed.curColor = c; api.hide('docPanel'); } };
}
/*
 * ÖZELLİKLER PALETİ (AutoCAD Properties). Üç bölüm:
 *   1. Nesne türü listesi: "Tümü (5)", "Çizgi (3)", "Daire (2)" … — bir tür seçilince seçim o türe DARALIR (öteki nesneler
 *      bırakılır; tutamak ve rozet de daralır), "Tümü" geri getirir; daraltılmış seçim pencere kapanınca kalır.
 *   2. Genel: katman, renk, çizgi tipi, çizgi kalınlığı (props komutu).
 *   3. Nesnenin DÜZENLENEBİLİR alanları (v7.72, kullanıcının isteği): çizgide uç noktalar; daire / yayda merkez, yarıçap,
 *      açılar; polyline'da kapalı ve genişlik; yazıda içerik, yükseklik, dönüş, konum; noktada X Y Z; blok yerleştirmesinde
 *      konum, dönüş, ölçek, öznitelik değerleri ve dinamik parametreler. Alanlar ilk nesneden okunur; yalnız DEĞİŞTİRİLEN
 *      alan uygulanır ve seçimdeki aynı türden bütün nesnelere gider (AutoCAD gibi). Ölçüde kendi kutusu (Ölçüyü düzenle).
 *   Uygulama tek geri alma adımıdır ('group').
 */
const LW_LIST = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const fx12 = (v) => (typeof v === 'number' && isFinite(v) ? String(+v.toPrecision(12)) : '');
/*
 * TARAMANIN PARÇALARI. Bir tarama ekranda tek nesnedir ama SAHNEDE iki ilkelden oluşur:
 *   · SINIR   — kapalı çokgen; desenliyse saydam dolgu (hpFill), SOLID ise tam dolgu
 *   · ÇİZGİLER — desenin kırpılmış parçaları; p.hp (desen aralığı) taşır
 * İkisi de aynı grup kimliğini (gid) taşır: bizim ürettiğimizde annot.hatchEnts, dosyadan
 * okunanda scene.js verir. Aşağıdaki üç yardımcı, paletin ve düzenlemenin tek doğru kaynağıdır.
 */
const hatchLinesPart = (p) => !!p && p.k === 0 && p.hp != null;                 // desen çizgileri ilkeli
const hatchAnyPart = (p) => !!p && p.k === 0 && (hatchLinesPart(p) || ((p.info && p.info.t) || p.et) === 'HATCH');
/** Taramanın parçaları (gid grubu; gid yoksa ilkelin kendisi) */
function hatchGroup(p) {
  const gid = p && p.info && p.info.gid;
  if (!gid) return [p];
  return S.prims.filter(q => q.info && q.info.gid === gid);
}
/**
 * Taramanın SINIR ilkeli: desen çizgileri ASLA sınır sayılmaz (onların ops'u yüzlerce kırpılmış
 * parçanın uçlarıdır; sınır sanılırsa yeniden üretilen tarama kendini kesen çöp bir çokgene oturur).
 * Bulunamazsa null döner ve çağıran işlemi hiç yapmaz.
 */
function hatchBoundary(p) {
  if (!hatchAnyPart(p)) return null;
  const parcalar = hatchGroup(p);
  const sinir = parcalar.find(q => !hatchLinesPart(q) && q.closed && (((q.info && q.info.t) || q.et) === 'HATCH'));
  if (sinir) return sinir;
  return !hatchLinesPart(p) && p.closed ? p : null;
}
/** İlkel bir taramaysa { pattern, scale, angle, bilinen } döner, değilse null */
function hatchInfo(p) {
  if (!hatchAnyPart(p)) return null;
  const k = hatchBoundary(p) || (hatchLinesPart(p) ? null : p);
  if (!k) return null;
  const ki = k.info || {};
  const ad = String(ki.pattern || 'SOLID').toUpperCase();
  return { pattern: ad, scale: ki.hscale > 0 ? ki.hscale : 1, angle: ki.hangle == null ? 0 : ki.hangle, bilinen: !!HATCH_PATTERNS[ad] };
}
function propFields(p) {
  const F = [], inf = p.info || {}, top = inf.t || p.et;
  const num = (id, label, v) => F.push({ id, label, type: 'number', value: fx12(v) });
  if (top === 'INSERT') {
    num('ix', t('insPoint') + ' X', inf.x); num('iy', t('insPoint') + ' Y', inf.y);
    if (inf.blk) { num('irot', t('rotation') + ' (°)', (inf.rot || 0) * 180 / Math.PI); num('isx', t('blockScale') + ' X', inf.sx == null ? 1 : inf.sx); num('isy', t('blockScale') + ' Y', inf.sy == null ? 1 : inf.sy); }
    (inf.attrs || []).forEach((a, i) => F.push({ id: 'att' + i, label: a[0] || ('#' + (i + 1)), type: 'text', value: String(a[1] == null ? '' : a[1]) }));
    if (inf.blk) for (const prm of B.params(S.blocks.get(blkKey(inf.name)) || null)) {
      const v = B.dynValue(prm, inf.dyn);
      if (prm.kind === 'vis') F.push({ id: 'dyn:' + prm.id, label: prm.label, type: 'select', value: v, options: (prm.states || []).map(x => [x, x]) });
      else if (prm.kind === 'flip') F.push({ id: 'dyn:' + prm.id, label: prm.label, type: 'check', value: !!v });
      else if (prm.kind === 'point') { num('dynx:' + prm.id, prm.label + ' ΔX', Array.isArray(v) ? v[0] : 0); num('dyny:' + prm.id, prm.label + ' ΔY', Array.isArray(v) ? v[1] : 0); }
      else num('dyn:' + prm.id, prm.label + (prm.kind === 'rot' ? ' (°)' : ''), v);
    }
    return F;
  }
  if (top === 'DIMENSION') return F;
  if (p.k === 1) { F.push({ id: 'text', label: t('textK'), type: 'multi', value: p.lines.join('\n') }); num('th', t('height'), p.h); num('trot', t('rotation') + ' (°)', p.rot * 180 / Math.PI); num('tx', 'X', p.x); num('ty', 'Y', p.y); return F; }
  if (p.k === 2) { num('px', 'X', p.x); num('py', 'Y', p.y); num('pz', 'Z', p.z || 0); return F; }
  if (p.k !== 0 || !p.ops || p.ops.length < 2) return F;
  const ops = p.ops;
  if (ops.length === 2 && (ops[1][0] === 2 || ops[1][0] === -2)) {
    const o = ops[1], full = o[0] === 2 && Math.abs((o[5] - o[4]) - TAU) < 1e-9;
    num('cx', t('center') + ' X', o[1]); num('cy', t('center') + ' Y', o[2]); num('cr', t('radius'), o[3]);
    if (!full) { num('a0', t('start') + ' (°)', o[4] * 180 / Math.PI); num('a1', t('end') + ' (°)', o[5] * 180 / Math.PI); }
    return F;
  }
  if (hatchInfo(p)) {
    /*
     * TARAMA: desen, ölçek ve açı düzenlenebilir (AutoCAD'in HATCHEDIT'i). Dolgulu (SOLID) tarama
     * da buraya girer — böylece SOLID bir tarama desenliye, desenli olan SOLID'e çevrilebilir.
     * Uygulanınca tarama sınırı korunarak yeniden üretilir (aşağıda propCmds).
     */
    const h = hatchInfo(p);
    /*
     * Dosyadan gelen desen adı bizim tablomuzda olmayabilir (ANGLE, AR-CONC, BRICK…). O ad
     * listeye EKLENİR: yoksa tarayıcı hiçbir seçeneği eşleştiremez, ilk seçeneği (SOLID)
     * işaretler ve kullanıcı desene hiç dokunmadan Uygula'ya bastığında tarama dolguya dönerdi.
     */
    const adlar = Object.keys(HATCH_PATTERNS);
    const secenek = adlar.map(n => [n, n === 'SOLID' ? t('patSolid') : n]);
    if (!h.bilinen) secenek.unshift([h.pattern, h.pattern + ' \u00b7 ' + t('hatchFromFile')]);
    F.push({ id: 'hpat', label: t('hatchPatTitle'), type: 'select', value: h.pattern, options: secenek });
    num('hsc', t('hatchScale'), h.scale); num('hang', t('hatchAngle'), h.angle);
    return F;
  }
  if (p.bg) return F;   // maske (WIPEOUT): sınırı tutamakla düzenlenir, sayısal alanı yok
  if (ops.length === 2 && ops[1][0] === 1 && !p.closed) { num('x1', t('start') + ' X', ops[0][1]); num('y1', t('start') + ' Y', ops[0][2]); num('z1', t('start') + ' Z', ops[0][3] || 0); num('x2', t('end') + ' X', ops[1][1]); num('y2', t('end') + ' Y', ops[1][2]); num('z2', t('end') + ' Z', ops[1][3] || 0); return F; }
  F.push({ id: 'closed', label: t('closed'), type: 'check', value: !!p.closed }); num('width', t('width'), p.w || 0);
  return F;
}
/** Değişen alanlardan komutlar (seçimdeki aynı türden her nesne için); yerleştirme grubu tek nesne sayılır */
function propCmds(sel, F, vals, genel, rapor) {
  const cmds = [], seenIns = new Set(), seenHatch = new Set();
  const basarisiz = (rapor && rapor.basarisiz) || [], uyarlanan = (rapor && rapor.uyarlanan) || [];
  const changed = (id) => vals[id] !== undefined && F.some(f => f.id === id) && String(vals[id]) !== String(F.find(f => f.id === id).value);
  const numv = (id) => { const n = parseFloat(String(vals[id]).replace(',', '.')); return isFinite(n) ? n : null; };
  const D2R = Math.PI / 180;
  for (const p of sel) {
    const inf = p.info || {}, top = inf.t || p.et;
    if (top === 'INSERT') {
      if (!inf.h || seenIns.has(inf.h)) continue; seenIns.add(inf.h);
      const keys = sel.filter(q => q.info && q.info.h === inf.h).map(q => q.key);
      if (changed('ix') || changed('iy')) { const nx = changed('ix') ? numv('ix') : inf.x, ny = changed('iy') ? numv('iy') : inf.y; if (nx != null && ny != null) cmds.push({ op: 'xform', keys, m: [1, 0, 0, 1, nx - inf.x, ny - inf.y] }); }
      if (inf.blk && changed('irot')) { const a = numv('irot'); if (a != null) { const d = a * D2R - (inf.rot || 0), cs = Math.cos(d), sn = Math.sin(d); cmds.push({ op: 'xform', keys, m: [cs, sn, -sn, cs, inf.x - cs * inf.x + sn * inf.y, inf.y - sn * inf.x - cs * inf.y] }); } }
      if (inf.blk && (changed('isx') || changed('isy'))) {
        const sx0 = inf.sx == null ? 1 : inf.sx, sy0 = inf.sy == null ? 1 : inf.sy, kx = changed('isx') ? (numv('isx') || sx0) / sx0 : 1, ky = changed('isy') ? (numv('isy') || sy0) / sy0 : 1;
        if (kx && ky && isFinite(kx) && isFinite(ky)) { const r = inf.rot || 0, R = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], Ri = [Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r), 0, 0]; const m = mul([1, 0, 0, 1, inf.x, inf.y], mul(R, mul([kx, 0, 0, ky, 0, 0], mul(Ri, [1, 0, 0, 1, -inf.x, -inf.y])))); cmds.push({ op: 'xform', keys, m }); }
      }
      const items = (inf.attrs || []).map((a, i) => (changed('att' + i) ? { i, value: String(vals['att' + i]) } : null)).filter(Boolean);
      if (items.length) cmds.push({ op: 'attrib', h: inf.h, items });
      const dv = {};
      for (const prm of B.params(S.blocks.get(blkKey(inf.name)) || null)) {
        if (prm.kind === 'point') { if (changed('dynx:' + prm.id) || changed('dyny:' + prm.id)) { const v = B.dynValue(prm, inf.dyn) || [0, 0]; dv[prm.id] = [changed('dynx:' + prm.id) ? numv('dynx:' + prm.id) : v[0], changed('dyny:' + prm.id) ? numv('dyny:' + prm.id) : v[1]]; } continue; }
        if (!changed('dyn:' + prm.id)) continue;
        dv[prm.id] = prm.kind === 'vis' ? String(vals['dyn:' + prm.id]) : prm.kind === 'flip' ? !!vals['dyn:' + prm.id] : numv('dyn:' + prm.id);
      }
      if (Object.keys(dv).length) cmds.push({ op: 'dynset', h: inf.h, values: dv });
      continue;
    }
    if (top === 'DIMENSION') continue;
    /*
     * TARAMA: desen / ölçek / açı değişince tarama YENİDEN ÜRETİLİR — sınır çokgeni korunur,
     * eski sınır ve desen çizgileri silinip yenileri aynı gid, katman ve renkle eklenir.
     * Grup bir kez işlenir (sınır ve çizgiler aynı seçimde gelir).
     */
    if (hatchInfo(p) && (changed('hpat') || changed('hsc') || changed('hang'))) {
      const sinir = hatchBoundary(p);
      // Sınır bulunamıyorsa (bozuk ya da tanınmayan tarama) işlem HİÇ yapılmaz: desen çizgilerinin
      // uçlarından çokgen örmek çizimde tanınmaz bir leke bırakırdı.
      if (!sinir || !Array.isArray(sinir.ops) || sinir.ops.length < 3) { basarisiz.push('sinir'); continue; }
      const gid = (sinir.info && sinir.info.gid) || null;
      const anahtar = gid || sinir.key;
      if (seenHatch.has(anahtar)) continue; seenHatch.add(anahtar);
      const h = hatchInfo(sinir);
      const ad = String(changed('hpat') ? vals.hpat : h.pattern).toUpperCase();
      // Ölçek: boş ya da 0 => OTOMATİK (alan büyüklüğünden türetilir); sayı olmayan metin hata.
      const scMetin = changed('hsc') ? String(vals.hsc == null ? '' : vals.hsc).trim() : null;
      const sc = scMetin === null ? h.scale : (scMetin === '' ? 0 : (numv('hsc') == null ? null : Math.max(0, numv('hsc'))));
      const an = changed('hang') ? numv('hang') : h.angle;
      if (!HATCH_PATTERNS[ad]) { basarisiz.push('desen'); continue; }          // dosyanın kendi deseni korunur, dolguya çevrilmez
      if (sc == null || an == null) { basarisiz.push('deger'); continue; }
      const pts = sinir.ops.filter(o => o[0] === 0 || o[0] === 1).map(o => [o[1], o[2], o[3] || 0]);
      if (pts.length < 3) { basarisiz.push('sinir'); continue; }
      // Aynı Uygula'da katman / renk de değiştiyse YENİ tarama onlarla üretilir: yoksa önce
      // eski ilkellere uygulanır, hemen ardından silinirlerdi ve değişiklik kaybolurdu.
      const lay = genel && genel.layer != null ? genel.layer : sinir.lay;
      const ci = genel && genel.color != null ? genel.color : (sinir.info ? sinir.info.ci : 256);
      const r = hatchEnts(pts, { pattern: ad, scale: sc, angle: an, gid: gid || newId(), layer: lay, color: ci, alpha: sinir.alpha == null ? 1 : sinir.alpha });
      if (!r) { basarisiz.push('uretim'); continue; }
      if (r.dustu) basarisiz.push('yogun');                                    // desen hiçbir ölçekte sığmadı
      else if (r.oto) uyarlanan.push(r.scale);                                 // ölçek kendiliğinden açıldı
      const eski = gid ? S.prims.filter(q => q.info && q.info.gid === gid).map(q => q.key) : [sinir.key];
      cmds.push({ op: 'delete', keys: eski });
      cmds.push({ op: 'add', ents: r.ents.map(e => ({ ...e, id: newId(), layer: e.layer || lay, color: e.color == null ? ci : e.color })) });
      continue;
    }
    if (p.k === 1) {
      if (changed('text') && String(vals.text).trim()) cmds.push({ op: 'edittext', keys: [p.key], text: String(vals.text) });
      if (changed('th') && numv('th') > 0) cmds.push({ op: 'textheight', keys: [p.key], h: numv('th') });
      if (changed('trot') && numv('trot') != null) { const d = numv('trot') * D2R - p.rot, cs = Math.cos(d), sn = Math.sin(d); cmds.push({ op: 'xform', keys: [p.key], m: [cs, sn, -sn, cs, p.x - cs * p.x + sn * p.y, p.y - sn * p.x - cs * p.y] }); }
      if (changed('tx') || changed('ty')) { const nx = changed('tx') ? numv('tx') : p.x, ny = changed('ty') ? numv('ty') : p.y; if (nx != null && ny != null) cmds.push({ op: 'xform', keys: [p.key], m: [1, 0, 0, 1, nx - p.x, ny - p.y] }); }
      continue;
    }
    if (p.k === 2) {
      if (changed('px') || changed('py')) { const nx = changed('px') ? numv('px') : p.x, ny = changed('py') ? numv('py') : p.y; if (nx != null && ny != null) cmds.push({ op: 'xform', keys: [p.key], m: [1, 0, 0, 1, nx - p.x, ny - p.y] }); }
      if (changed('pz') && numv('pz') != null) cmds.push({ op: 'setz', keys: [p.key], z: numv('pz') });
      continue;
    }
    if (p.k !== 0 || !p.ops || p.ops.length < 2) continue;
    const ops = p.ops;
    if (ops.length === 2 && (ops[1][0] === 2 || ops[1][0] === -2)) {
      if (!['cx', 'cy', 'cr', 'a0', 'a1'].some(changed)) continue;
      const o = ops[1], full = o[0] === 2 && Math.abs((o[5] - o[4]) - TAU) < 1e-9;
      const cx = changed('cx') ? numv('cx') : o[1], cy = changed('cy') ? numv('cy') : o[2], r = changed('cr') ? numv('cr') : o[3];
      const a0 = full ? 0 : (changed('a0') ? numv('a0') * D2R : o[4]), a1 = full ? TAU : (changed('a1') ? numv('a1') * D2R : o[5]);
      if (cx == null || cy == null || !(r > 0) || a0 == null || a1 == null) continue;
      const z = o[6] || 0;
      cmds.push({ op: 'reshape', items: [{ key: p.key, ops: [[0, cx + r * Math.cos(a0), cy + r * Math.sin(a0), z], [o[0], cx, cy, r, a0, a1, z]], closed: !!p.closed }] });
      continue;
    }
    if (p.bg) continue;
    if (ops.length === 2 && ops[1][0] === 1 && !p.closed) {
      if (!['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].some(changed)) continue;
      const g = (id, d) => (changed(id) ? numv(id) : d);
      const x1 = g('x1', ops[0][1]), y1 = g('y1', ops[0][2]), z1 = g('z1', ops[0][3] || 0);
      const x2 = g('x2', ops[1][1]), y2 = g('y2', ops[1][2]), z2 = g('z2', ops[1][3] || 0);
      if ([x1, y1, z1, x2, y2, z2].some(v => v == null)) continue;
      cmds.push({ op: 'reshape', items: [{ key: p.key, ops: [[0, x1, y1, z1], [1, x2, y2, z2]], closed: false }] });
      continue;
    }
    if (changed('closed') || changed('width')) { const it = { key: p.key, ops: ops.map(o => o.slice()) }; if (changed('closed')) it.closed = !!vals.closed; if (changed('width') && numv('width') != null && numv('width') >= 0) it.w = numv('width'); cmds.push({ op: 'reshape', items: [it] }); }
  }
  return cmds;
}
function showProps(all) {
  if (!needModel()) return;
  if (!ed.sel.size) { api.toast(t('selectFirstQ')); return; }
  const tam = all || [...ed.sel];
  /*
   * TÜR, MANTIKSAL NESNENİN TÜRÜDÜR. Tarama sahnede iki ilkeldir (sınır + desen çizgileri);
   * ham tür alınırsa ikisi 'HATCH' ve 'PATH' görünür, "hepsi aynı tür mü" denetimi düşer ve
   * türe özgü alanlar — yani DESEN, ÖLÇEK, AÇI — hiç çizilmez. v7.77'de kusur buydu.
   * Sayım da mantıksal nesne üzerindendir: iki parçalı tarama listede "Tarama (1)" görünür.
   */
  const typeOf = (p) => (p.info && p.info.t === 'HATCH' ? 'HATCH' : (hatchAnyPart(p) ? 'HATCH' : ((p.info && p.info.t) || p.et || ('k' + p.k))));
  const nesneKey = (p) => (p.info && p.info.gid) || ((p.info && p.info.t === 'INSERT' && p.info.h) || p.key);
  const counts = new Map(); { const g = new Set(); for (const p of tam) { const k = typeOf(p) + '|' + nesneKey(p); if (g.has(k)) continue; g.add(k); counts.set(typeOf(p), (counts.get(typeOf(p)) || 0) + 1); } }
  const cur = ed.sel.size === tam.length ? '' : typeOf([...ed.sel][0]);
  const sel = [...ed.sel].filter(p => p.k !== 4);
  // Temsilci ilkel: taramada SINIR (desen çizgileri değil), böylece alanlar gerçek desenden okunur
  const first = sel.find(p => hatchBoundary(p) === p) || sel[0] || [...ed.sel][0];
  const tur = `<select id="pType"><option value=""${cur === '' ? ' selected' : ''}>${esc(t('selAllTypes'))} (${tam.length})</option>${[...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([k, n]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(tt('ety_' + k, k))} (${n})</option>`).join('')}</select>`;
  const ltSel = `<select id="pLt"><option value="">${esc(t('selByLayer'))}</option>${Object.keys(S.ltypes || {}).map(k => `<option value="${esc(k)}"${(first.lt || '') === k ? ' selected' : ''}>${esc((S.ltypes[k] && S.ltypes[k].name) || k)}</option>`).join('')}</select>`;
  const L0 = S.layers.get(first.lay), lwCur = first.lw != null && first.lw >= 0 ? first.lw : (L0 ? L0.lw : 25);
  const lwSel = `<select id="pLw"><option value="-1">${esc(t('selByLayer'))}</option>${LW_LIST.map(v => `<option value="${v}"${v === lwCur ? ' selected' : ''}>${(v / 100).toFixed(2)} mm</option>`).join('')}</select>`;
  const F = propFields(first);
  const same = sel.every(p => typeOf(p) === typeOf(first));   // artık mantıksal tür: taramanın iki parçası da 'HATCH'
  const rows = [[t('selType'), tur, 1], [t('layer'), layerSelectHtml('pLayer', first.lay), 1], [t('color'), colorSwatches(first.info ? first.info.ci : 256), 1], [t('ltype'), ltSel, 1], [t('lweight'), lwSel, 1]];
  if (same && F.length) {
    rows.push([`<div class="full opt-title">${esc(tt('ety_' + typeOf(first), typeOf(first)))}${sel.length > 1 ? ' · ' + sel.length : ''}</div>`]);
    for (const f of F) {
      const id = 'pg_' + f.id.replace(/[^\w]/g, '_');
      const inp = f.type === 'check' ? `<label class="chk"><input type="checkbox" id="${id}" data-pg="${esc(f.id)}"${f.value ? ' checked' : ''}></label>`
        : f.type === 'select' ? `<select id="${id}" data-pg="${esc(f.id)}">${(f.options || []).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
          : f.type === 'multi' ? `<textarea id="${id}" data-pg="${esc(f.id)}" class="opt-text" rows="2">${esc(f.value)}</textarea>`
            : `<input id="${id}" data-pg="${esc(f.id)}" type="text"${f.type === 'number' ? ' inputmode="decimal"' : ''} value="${esc(f.value)}" autocomplete="off">`;
      rows.push([f.label, inp, 1]);
    }
  }
  if (same && (first.info && first.info.t === 'DIMENSION')) rows.push([`<div class="full btns"><button class="btn small" id="pDim">${esc(t('dimSelMenu'))}</button></div>`]);
  rows.push([`<div class="full btns"><button class="btn primary small" id="pOk">${esc(t('apply'))}</button></div>`]);
  api.openDoc(`${t('propsTitle')} (${ed.sel.size} ${t('objectsN')})`, api.kv(rows));
  let ci = null;
  $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-ci]'); if (b) { ci = Number(b.dataset.ci); document.querySelectorAll('#docBody [data-ci]').forEach(x => x.classList.toggle('active', x === b)); } };
  $('pType').onchange = () => {
    const v = $('pType').value;
    // Süzgeç mantıksal nesneye göre daraltır: seçilen türdeki nesnenin BÜTÜN parçaları kalır,
    // yoksa tarama grubu ikiye bölünür ve sonraki Sil / Taşı yarım gruba uygulanırdı.
    const keep = v ? tam.filter(p => typeOf(p) === v) : tam;
    ed.sel.clear(); for (const p of keep) ed.sel.add(p);
    api.drawOverlay(); refreshTiles(); haptic('toggle');
    showProps(tam);   // pencere daraltılmış seçimle yeniden kurulur (başlık, katman ve renk ilk nesneden)
  };
  const pd = $('pDim'); if (pd) pd.onclick = () => { const p = selDimPrim(); api.hide('docPanel'); if (p && gate('t:dimedit')) void tools.editDim(p); };
  $('pOk').onclick = () => {
    const cmds = [];
    const keys = [...ed.sel].map(p => p.key);
    const gen = { op: 'props', keys };
    let genOn = false;
    if ($('pLayer').value !== first.lay) { gen.layer = $('pLayer').value; genOn = true; }
    if (ci != null) { gen.color = ci; genOn = true; }
    if (($('pLt').value || '') !== (first.lt || '')) { gen.lt = $('pLt').value; genOn = true; }
    { const lw = Number($('pLw').value); if (lw !== (first.lw != null && first.lw >= 0 ? first.lw : -1) && !(lw === -1 && first.lw == null)) { gen.lw = lw; genOn = true; } }
    // Katman YALNIZ kullanıcı değiştirdiyse gönderilir: yoksa çok katmanlı seçimde renk değişikliği
    // bütün nesneleri ilk nesnenin katmanına taşırdı (props işlemi cmd.layer'ı hepsine uygular).
    if (genOn) cmds.push(gen);
    const rapor = { basarisiz: [], uyarlanan: [] }, yeniGid = [];
    if (same && F.length) {
      const vals = {};
      document.querySelectorAll('#docBody [data-pg]').forEach(el => { const id = el.dataset.pg; vals[id] = el.type === 'checkbox' ? el.checked : el.value; });
      for (const c of propCmds(sel, F, vals, genOn ? gen : null, rapor)) {
        cmds.push(c);
        if (c.op === 'add') for (const e of c.ents || []) if (e.gid && !yeniGid.includes(e.gid)) yeniGid.push(e.gid);
      }
    }
    if (!cmds.length) {
      // Sessiz kapanış yok: hiçbir şey uygulanmadıysa sebebi söylenir.
      api.hide('docPanel');
      api.toast(rapor.basarisiz.length ? t('hatchFail_' + rapor.basarisiz[0]) : t('noChanges'));
      return;
    }
    const ok = doc.run(cmds.length === 1 ? cmds[0] : { op: 'group', cmds });
    refreshUndo(); api.requestRender(); api.drawOverlay(); api.hide('docPanel');
    if (!ok) { api.toast(t('error')); return; }
    // Yeniden üretilen tarama seçili kalır: rozet kaybolmasın, art arda deneme yapılabilsin.
    if (yeniGid.length) { ed.sel.clear(); for (const q of S.prims) if (q.info && yeniGid.includes(q.info.gid)) ed.sel.add(q); api.drawOverlay(); refreshTiles(); }
    const ek = rapor.uyarlanan.length ? ' \u00b7 ' + t('hatchAutoScale').replace('%s', api.fmt(rapor.uyarlanan[0])) : (rapor.basarisiz.length ? ' \u00b7 ' + t('hatchFail_' + rapor.basarisiz[0]) : '');
    api.toast(t('propsApplied') + ek, ek ? 3200 : 1800);
  };
}

/*
 * SEÇİM MENÜSÜ — rozete dokununca açılır: seçime uygulanan işlemler tek yerde (Sil, Kopyala, Taşı,
 * Blok yap, Döndür, Ayna, Ölçek, Renk, Çizgi tipi, Katman, Özellikler, Seçimi bırak). Dönüşüm
 * araçları seçimi koruyarak başlar ve doğrudan taban noktasını sorar; renk / çizgi tipi / katman
 * tek dokunuşla uygulanır ve tek geri alma adımı üretir.
 */
const SEL_MENU = [['del', 'i-erase'], ['copy', 'i-copyobj'], ['move', 'i-move'], ['block', 'i-block'], ['rotate', 'i-rotate'], ['mirror', 'i-mirror'], ['scale', 'i-scale'], ['color', 'i-palette'], ['ltype', 'i-ltype'], ['layer', 'i-layers'], ['props', 'i-props'], ['similar', 'i-similar'], ['hide', 'i-hideobj'], ['iso', 'i-isoobj'], ['front', 'i-draworder'], ['back', 'i-draworder'], ['cut', 'i-cut'], ['clear', 'i-close']];
const selMenuLabel = (id) => ({ block: t('selMakeBlock'), color: t('color'), ltype: t('ltype'), layer: t('selChangeLayer'), clear: t('selClear'), props: tileLabel('props'), dimedit: t('dimSelMenu'), similar: t('selSimilar'), hide: t('selHideObj'), iso: t('selIsoObj'), cut: tileLabel('cutclip'), front: t('droFront'), back: t('droBack'), bedit: tileLabel('t:bedit') }[id] || tileLabel('t:' + id));
const selDimPrim = () => [...ed.sel].find(p => p.info && p.info.t === 'DIMENSION' && (p.info.gid || p.info.dim));
function selMenu() {
  if (!ed.sel.size) { api.toast(t('selEmpty')); return; }
  // seçimde ölçülendirme varsa "Ölçü özellikleri" kartı da gelir (Özellikler'in önünde)
  let items = selDimPrim() ? [...SEL_MENU.slice(0, 10), ['dimedit', 'i-dimedit'], ...SEL_MENU.slice(10)] : SEL_MENU;
  // seçimde blok yerleştirmesi varsa "Blok düzenle" kartı da gelir (Özellikler'in önünde)
  if ([...ed.sel].some(p => p.info && p.info.t === 'INSERT' && p.info.name)) { const i = items.findIndex(x => x[0] === 'props'); items = [...items.slice(0, i), ['bedit', 'i-bedit'], ...items.slice(i)]; }
  api.openDoc(`${t('selMenuTitle')} · ${ed.sel.size} ${t('objectsN')}`,
    `<div class="full os-grid sel-grid">${items.map(([id, ic]) => `<button type="button" class="os-card" data-sm="${id}"><svg class="ic" aria-hidden="true"><use href="#${ic}"/></svg><span>${esc(selMenuLabel(id))}</span></button>`).join('')}</div>`);
  $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-sm]'); if (!b) return; api.hide('docPanel'); selAction(b.dataset.sm); };
}
function selProps(o) {
  if (!doc || !ed.sel.size || !gate('props')) return false;
  doc.run({ op: 'props', keys: [...ed.sel].map(p => p.key), ...o });
  refreshUndo(); api.requestRender(); api.drawOverlay(); api.toast(t('propsApplied'), 1200); haptic('toggle');
  return true;
}
function selAction(id) {
  if (!ed.sel.size) { api.toast(t('selEmpty')); return; }
  switch (id) {
    case 'del': {
      if (!gate('t:del') || !doc) return;
      const keys = [...ed.sel].map(p => p.key);
      if (tools.running) { tools.cancel(); markActive(null); }
      doc.run({ op: 'delete', keys }); ed.sel.clear();
      refreshUndo(); api.requestRender(); api.drawOverlay(); api.toast(t('deleted')); haptic('toggle');
      break;
    }
    case 'copy': case 'move': case 'rotate': case 'mirror': case 'scale': act('t:' + id); break;   // seçim korunur, araç taban noktasını sorar
    case 'block': act('t:block'); break;   // seçim korunur, araç taban noktasını sorar
    case 'front': drawOrderSel('front'); break;
    case 'back': drawOrderSel('back'); break;
    case 'bedit': { const p = [...ed.sel].find(q => q.info && q.info.t === 'INSERT' && q.info.name); if (!p) { api.toast(t('notBlock')); return; } if (!gate('t:bedit')) return; void beditStart(p.info.name, { h: p.info.h }); break; }
    case 'color': {
      if (!gate('props')) return;
      const first = [...ed.sel][0];
      api.openDoc(t('colorSelect'), `<div class="full">${colorSwatches(first.info ? first.info.ci : 256)}</div><div class="full muted">${esc(t('colorHint'))}</div>`);
      $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-ci]'); if (!b) return; api.hide('docPanel'); selProps({ color: Number(b.dataset.ci) }); };
      break;
    }
    case 'ltype': {
      if (!gate('props')) return;
      const keys = ['', ...Object.keys(S.ltypes || {})];
      const cur = [...ed.sel][0].lt || '';
      api.openDoc(t('ltSelect'), `<div class="full list ctx-list pick-list">${keys.map(k => `<div class="item${k === cur ? ' active' : ''}" data-lt="${esc(k)}"><span class="lt-prev" style="border-top-style:${k ? 'dashed' : 'solid'}"></span>${esc(k ? ((S.ltypes[k] && S.ltypes[k].name) || k) : t('selByLayer'))}</div>`).join('')}</div>`);
      $('docBody').onclick = (ev) => { const it = ev.target.closest('[data-lt]'); if (!it) return; api.hide('docPanel'); selProps({ lt: it.dataset.lt }); };
      break;
    }
    case 'layer': {
      if (!gate('props')) return;
      const cur = [...ed.sel][0].lay;
      api.openDoc(t('selChangeLayer'), `<div class="full list ctx-list pick-list">${[...S.layers.keys()].sort((a, b) => a.localeCompare(b, 'tr')).map(n => `<div class="item${n === cur ? ' active' : ''}" data-lay="${esc(n)}">${esc(n)}</div>`).join('')}</div>`);
      $('docBody').onclick = (ev) => { const it = ev.target.closest('[data-lay]'); if (!it) return; api.hide('docPanel'); selProps({ layer: it.dataset.lay }); };
      break;
    }
    case 'props': showProps(); break;
    case 'similar': selectSimilar(); break;
    case 'hide': hideObjects(false); break;
    case 'iso': hideObjects(true); break;
    case 'cut': act('cutclip'); break;
    case 'dimedit': { const p = selDimPrim(); if (!p) { api.toast(t('notDim')); return; } if (!gate('t:dimedit')) return; void tools.editDim(p); break; }
    case 'clear': if (tools.running && tools.active === 'select') { tools.cancel(); markActive(null); } ed.sel.clear(); api.drawOverlay(); break;
    default: break;
  }
}
ed.selMenu = selMenu; ed.selAction = selAction;
{ const b = $('selBadge'); if (b) b.addEventListener('click', () => selMenu()); }


// ---------------------------------------------------------------------------------
// BLOK TABLOSU (v7.72): tanım yapma, yerleştirme adları, DWG / kütüphaneden benimseme, yönetici, temizleme,
// yeniden adlandırma, değiştirme, öznitelik eşitleme / yöneticisi, WBLOCK, taban noktası, çizim sırası kısayolları
// ---------------------------------------------------------------------------------
const blkKey = B.keyOf;
/** Yerleştirme sayımı: tanım anahtarı → yerleştirme sayısı (DWG'den gelen düzleştirilmişler de sayılır) */
function insCounts() {
  const seen = new Map();
  for (const p of S.scene.layouts[0].prims) { const i = p.info; if (!i || i.t !== 'INSERT' || !i.name || !i.h) continue; const k = blkKey(i.name); if (!seen.has(k)) seen.set(k, new Set()); seen.get(k).add(i.h); }
  const out = new Map(); for (const [k, v] of seen) out.set(k, v.size); return out;
}
/** Çizimde adı geçen ama tanımı tabloda olmayan DWG blokları (benimsenebilir): anahtar → ad */
function dwgBlockNames() {
  const out = new Map();
  for (const p of S.scene.layouts[0].prims) { const i = p.info; if (!i || i.t !== 'INSERT' || !i.name) continue; const k = blkKey(i.name); if (!S.blocks.has(k) && !out.has(k)) out.set(k, i.name); }
  return out;
}
/** INSERT formunun blok listesi: [[değer, etiket]] — çizimdeki tanımlar, benimsenmemiş DWG blokları (dwg:ad), kütüphane (lib:ad) */
function blockNames() {
  const out = [], cnt = insCounts();
  for (const [k, d] of [...S.blocks].sort((a, b) => a[1].name.localeCompare(b[1].name, 'tr'))) out.push([d.name, d.name + ' (' + (cnt.get(k) || 0) + ')']);
  for (const [k, nm] of dwgBlockNames()) out.push(['dwg:' + nm, nm + ' · DWG (' + (cnt.get(k) || 0) + ')']);
  try { for (const b of listBlocks(api.store)) if (!S.blocks.has(blkKey(b.name))) out.push(['lib:' + b.name, b.name + ' · ' + t('blockTitle')]); } catch (_) { /* depo yoksa */ }
  return out;
}
/*
 * DWG YERLEŞTİRMESİNDEN TANIM BENİMSEME. Sahne kurulurken blok düzleştirilmiştir; tanım, bir yerleştirmenin
 * ilkellerinin matris tersiyle tanım uzayına alınmasıdır (blocks.adoptFromPrims; taban 0,0,0). Tanım komut
 * günlüğüne 'blockdef' olarak girer: dosya yeniden açılınca da vardır, DXF'e BLOCKS olarak yazılır.
 */
function blockAdopt(name) {
  const k = blkKey(name);
  if (S.blocks.has(k)) return true;
  if (!doc) return false;
  const prims = S.scene.layouts[0].prims.filter(p => p.info && p.info.t === 'INSERT' && blkKey(p.info.name) === k);
  const h = prims.length ? prims[0].info.h : null;
  const def = h ? B.adoptFromPrims(name, prims.filter(p => p.info.h === h)) : null;
  if (!def) return false;
  const ok = doc.run({ op: 'blockdef', name: def.name, def: { name: def.name, base: def.base, ents: def.ents, dyn: null } });
  refreshUndo();
  return ok;
}
/** Kütüphane bloğunu tanım tablosuna alır (taban kütüphanedeki taban, varlıklar olduğu gibi) */
async function blockFromLib(name) {
  const b = loadBlock(api.store, name);
  if (!b || !b.ents.length || !doc) return false;
  if (S.blocks.has(blkKey(name))) return true;
  const ok = doc.run({ op: 'blockdef', name: b.name, def: { name: b.name, base: b.base || [0, 0, 0], ents: b.ents, dyn: null } });
  refreshUndo();
  return ok;
}
/** İlkelin varlık anahtarı: yerleştirme ilkelleri tanıtıcıyı (grup), ötekiler kendi anahtarını taşır */
const entKeyOf = (p) => (p.info && p.info.t === 'INSERT' && p.info.blk && S.blocks.has(blkKey(p.info.name)) ? p.info.h : p.key);
/**
 * Seçili ilkeller → tanım varlıkları. Uygulama yerleştirmeleri iç içe INSERT varlığı olur (grup tek varlık), ATTDEF yazıları
 * tanım kalır, görünürlük durumları (p.vis) taşınır. keys[i] = i. varlığı üreten ilkelin anahtarı (parametre listeleri için).
 */
function primsToDefEnts(prims) {
  const ents = [], keys = [], seen = new Set();
  for (const p of prims) {
    if (p.k === 4) continue;
    const i = p.info;
    if (i && i.t === 'INSERT' && i.blk && S.blocks.has(blkKey(i.name))) {
      if (seen.has(i.h)) continue; seen.add(i.h);
      ents.push(B.insFromInfo(i)); keys.push(i.h); continue;
    }
    const e = primToEnt(p);
    if (!e) continue;
    if (Array.isArray(p.vis) && p.vis.length) e.vis = p.vis.slice();
    ents.push(e); keys.push(p.key);
  }
  return { ents, keys };
}
/*
 * BLOCK: ad, taban noktası, seçim → tanım. Varlıklar DÜNYA koordinatında saklanır, taban ayrı durur; genişletme T(−taban)
 * uygular. Kip: convert → seçim silinir, yerine birebir aynı görünen yerleştirme gelir (AutoCAD "Convert to block");
 * retain → seçim kalır; delete → seçim silinir. Kütüphaneye de kaydedilebilir. Tek geri alma adımı ('group').
 */
function blockMake(name, prims, base, mode, lib) {
  if (!doc) return 0;
  if (bses) { api.toast(t('beditCloseFirst')); return 0; }   // tanım geçici belgeye yazılıp kaybolmasın
  const { ents } = primsToDefEnts(prims);
  if (!ents.length) return 0;
  // AutoCAD kuralı: bir tanım kendine (doğrudan ya da iç içe bloklar üzerinden) başvuramaz.
  // Böyle bir tanım genişletilirken her düzeyde yeniden açılır ve uygulama kilitlenir.
  if (B.refersTo(name, ents, S.blocks)) { api.toast(t('blkSelfRef'), 3200); return 0; }
  const bz = base[2] || 0;
  const def = { name: String(name).trim(), base: [base[0], base[1], bz], ents, dyn: null };
  const vardi = S.blocks.has(blkKey(def.name));   // ÜZERİNE yazılıyorsa var olan yerleştirmeler yeni tanıma göre tazelenir
  const cmds = [{ op: 'blockdef', name: def.name, def }];
  if (vardi) cmds.push({ op: 'blocksync', name: def.name });
  const keys = prims.filter(p => p.k !== 4).map(p => p.key);
  if (mode === 'convert' || mode === 'delete') cmds.push({ op: 'delete', keys });
  let insId = null;
  if (mode === 'convert') { insId = newId(); cmds.push({ op: 'add', ents: [{ type: 'INSERT', id: insId, name: def.name, layer: ed.curLayer, color: ed.curColor, x: base[0], y: base[1], z: bz, rot: 0, sx: 1, sy: 1, m: [1, 0, 0, 1, base[0], base[1]], attrs: B.attrsFor(def, null) }] }); }
  if (!doc.run({ op: 'group', cmds })) return 0;
  if (lib) saveBlock(api.store, def.name, B.xformEnts(ents, [1, 0, 0, 1, -base[0], -base[1]], -bz), [0, 0, 0]);
  ed.sel.clear();
  if (insId) for (const p of S.prims) if (p.k !== 4 && p.info && p.info.h === insId) ed.sel.add(p);
  refreshUndo(); api.requestRender(); api.drawOverlay();
  return ents.length;
}
/** Bloklar paneli: çizimin tanımları (sayı, öznitelik, parametre), DWG'den benimsenebilecekler, eylem düğmeleri */
function showBlocks() {
  if (!needModel()) return;
  if (!gate('blocks')) return;
  // Blok düzenleyici oturumu ayrı bir belge üzerinde çalışır: tanım tablosuna dokunan her komut
  // (yeniden adlandır, değiştir, sil, temizle) o geçici belgeye yazılır ve oturum kapanınca yok olur.
  if (bses) { api.toast(t('beditCloseFirst')); return; }
  const cnt = insCounts();
  const defs = [...S.blocks.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const dwg = [...dwgBlockNames().values()].sort((a, b) => a.localeCompare(b, 'tr'));
  const btn = (a, name, label, cls = '') => `<button type="button" class="btn small${cls ? ' ' + cls : ''}" data-bk="${esc(a)}" data-name="${esc(name)}">${esc(label)}</button>`;
  let html = `<div class="full btns">${btn('new', '', tileLabel('t:block'), 'primary')}${btn('ins', '', tileLabel('t:insert'))}${btn('purge', '', t('purgeTitle'))}${btn('lib', '', t('blockTitle'))}</div>`;
  if (!defs.length && !dwg.length) html += `<div class="full muted">${esc(t('blkNoneDef'))}</div>`;
  for (const d of defs) {
    const k = blkKey(d.name), n = cnt.get(k) || 0, att = B.attdefsOf(d).length, dyn = B.params(d).length;
    html += `<div class="full blk-row"><div class="blk-name"><b>${esc(d.name)}</b><small>${n} ${esc(t('insertsN'))} · ${(d.ents || []).length} ${esc(t('prims'))}${att ? ' · ' + att + ' ' + esc(t('attrs')) : ''}${dyn ? ' · ' + dyn + ' ' + esc(t('bpParams')) : ''}</small></div><div class="blk-btns">${btn('insert', d.name, t('blockInsert'))}${btn('edit', d.name, t('blkEdit'))}${btn('ren', d.name, t('blkRename'))}${btn('repl', d.name, t('blkReplace'))}${att ? btn('att', d.name, t('attrs')) : ''}${btn('tolib', d.name, t('blkToLib'))}${btn('wblock', d.name, 'WBLOCK')}${n ? '' : btn('del', d.name, t('delete'))}</div></div>`;
  }
  if (dwg.length) {
    html += `<div class="full opt-title">${esc(t('blkDwgTitle'))}</div>`;
    for (const nm of dwg) html += `<div class="full blk-row"><div class="blk-name"><b>${esc(nm)}</b><small>${cnt.get(blkKey(nm)) || 0} ${esc(t('insertsN'))}</small></div><div class="blk-btns">${btn('adopt', nm, t('blkAdopt'))}${btn('insert', nm, t('blockInsert'))}${btn('edit', nm, t('blkEdit'))}</div></div>`;
  }
  api.openDoc(t('blkTitle'), html);
  $('docBody').onclick = async (ev) => {
    const b = ev.target.closest('[data-bk]'); if (!b) return;
    const a = b.dataset.bk, nm = b.dataset.name;
    switch (a) {
      case 'new': api.hide('docPanel'); act('t:block'); break;
      case 'ins': api.hide('docPanel'); act('t:insert'); break;
      case 'lib': api.hide('docPanel'); api.action('blocklib'); break;
      case 'purge': api.hide('docPanel'); void purgeDialog(); break;
      case 'adopt': if (!gate('t:bedit')) break; api.toast(blockAdopt(nm) ? t('blkAdopted').replace('%s', nm) : t('error')); showBlocks(); break;
      case 'insert': api.hide('docPanel'); if (!S.blocks.has(blkKey(nm)) && !blockAdopt(nm)) { api.toast(t('error')); break; } tools.lastVal.insert = { ...(tools.lastVal.insert || {}), name: nm }; act('t:insert'); break;
      case 'edit': api.hide('docPanel'); if (!gate('t:bedit')) break; void beditStart(nm, {}); break;
      case 'ren': await renameBlock(nm); showBlocks(); break;
      case 'repl': api.hide('docPanel'); void blockReplaceDialog(nm); break;
      case 'att': api.hide('docPanel'); void battman(nm); break;
      case 'tolib': { const d = S.blocks.get(blkKey(nm)); const ok = d && saveBlock(api.store, d.name, B.xformEnts(d.ents, [1, 0, 0, 1, -(d.base[0] || 0), -(d.base[1] || 0)], -(d.base[2] || 0)), [0, 0, 0]); api.toast(ok ? t('blockSaved') + ': ' + d.name : t('blockTooBig'), { type: ok ? 'ok' : 'error' }); break; }
      case 'wblock': api.hide('docPanel'); void wblockDialog(nm); break;
      case 'del': if (!(await askConfirm(t('blockDelAsk') + ' ' + nm))) break; if (doc.run({ op: 'blockdel', name: nm })) { refreshUndo(); api.toast(t('blockDeleted')); } showBlocks(); break;
      default: break;
    }
  };
}
async function renameBlock(nm) {
  if (!gate('blocks')) return false;
  const yeni = await askText(t('blkNewName') + ' (' + nm + ')', nm, { maxlength: 60 });
  if (yeni === null) return false;
  const ad = String(yeni).trim();
  if (!ad || blkKey(ad) === blkKey(nm)) return false;
  if (S.blocks.has(blkKey(ad))) { api.toast(t('blkExists')); return false; }
  if (!doc.run({ op: 'blockrename', name: nm, newName: ad })) { api.toast(t('error')); return false; }
  refreshUndo(); api.requestRender(); api.toast(t('blkRenamed').replace('%s', ad));
  return true;
}
/** RENAME: blok ya da katman adı (AutoCAD RENAME kutusunun iki kalemi) */
async function renameDialog() {
  if (!needModel() || !gate('blocks')) return;
  const bl = [...S.blocks.values()].map(d => [d.name, d.name]), la = [...S.layers.keys()].filter(n => n !== '0').map(n => [n, n]);
  const r = await askForm(t('renameTitle'), [
    { id: 'kind', label: t('renameKind'), type: 'select', value: bl.length ? 'block' : 'layer', options: [['block', t('blockN')], ['layer', t('layer')]] },
    { id: 'block', label: t('blockN'), type: 'select', value: bl.length ? bl[0][0] : '', options: bl.length ? bl : [['', '—']] },
    { id: 'layer', label: t('layer'), type: 'select', value: la.length ? la[0][0] : '', options: la.length ? la : [['', '—']] },
    { id: 'name', label: t('blkNewName'), type: 'text', value: '' },
  ], { ok: t('ok') });
  if (!r) return;
  const ad = String(r.name || '').trim(); if (!ad) return;
  if (r.kind === 'block') {
    if (!r.block) return;
    if (S.blocks.has(blkKey(ad))) { api.toast(t('blkExists')); return; }
    if (doc.run({ op: 'blockrename', name: r.block, newName: ad })) { refreshUndo(); api.requestRender(); api.toast(t('blkRenamed').replace('%s', ad)); } else api.toast(t('error'));
  } else {
    if (!r.layer || !gate('layeredit')) return;
    if (doc.run({ op: 'layerprops', name: r.layer, newName: ad })) { refreshUndo(); api.requestRender(); api.toast(t('layerUpdated') + ': ' + ad); } else api.toast(t('layerExists'));
  }
}
/** BLOCKREPLACE: A'nın bütün yerleştirmeleri B olur (aynı ekleme noktası, ölçek, dönüş; öznitelikler etikete göre); A silinebilir */
async function blockReplaceDialog(from) {
  if (!needModel() || !gate('blocks')) return;
  const bl = [...S.blocks.values()].map(d => [d.name, d.name]);
  if (bl.length < 2) { api.toast(t('blkReplaceNeed2')); return; }
  const r = await askForm(t('blkReplace'), [
    { id: 'from', label: t('blkReplaceFrom'), type: 'select', value: from || bl[0][0], options: bl },
    { id: 'to', label: t('blkReplaceTo'), type: 'select', value: bl.find(x => x[0] !== (from || bl[0][0]))[0], options: bl },
    { id: 'purge', label: t('blkReplacePurge'), type: 'check', value: false },
  ], { ok: t('apply') });
  if (!r || blkKey(r.from) === blkKey(r.to)) return;
  const cmds = [{ op: 'blockreplace', from: r.from, to: r.to }];
  if (r.purge) cmds.push({ op: 'blockdel', name: r.from });
  if (doc.run(cmds.length === 1 ? cmds[0] : { op: 'group', cmds })) { refreshUndo(); api.requestRender(); api.drawOverlay(); api.toast(t('blkReplaced').replace('%s', r.from).replace('%t', r.to)); }
  else api.toast(t('blkReplaceNone'));
}
/** ATTSYNC: bütün yerleştirmeler tanımdaki öznitelik tanımlarına göre yeniden kurulur (değerler etikete göre korunur) */
async function attSync() {
  if (!needModel() || !gate('blocks')) return;
  if (!S.blocks.size) { api.toast(t('blkNoneDef')); return; }
  if (doc.run({ op: 'blocksync' })) { refreshUndo(); api.requestRender(); api.drawOverlay(); api.toast(t('attSynced')); } else api.toast(t('attSyncNone'));
}
/** BATTMAN: bir bloğun öznitelik tanımları — etiket, istem, öntanımlı, görünmez, sabit, sil; uygulanınca yerleştirmeler eşitlenir */
async function battman(name) {
  if (!needModel() || !gate('blocks')) return;
  let nm = name;
  if (!nm) {
    const bl = [...S.blocks.values()].filter(d => B.attdefsOf(d).length).map(d => [d.name, d.name]);
    if (!bl.length) { api.toast(t('noAttribs')); return; }
    const r0 = await askForm(t('battmanTitle'), [{ id: 'name', label: t('blockN'), type: 'select', value: bl[0][0], options: bl }], { ok: t('ok') });
    if (!r0) return; nm = r0.name;
  }
  const def = S.blocks.get(blkKey(nm)); if (!def) return;
  const atts = B.attdefsOf(def);
  if (!atts.length) { api.toast(t('noAttribs')); return; }
  const fields = [];
  atts.forEach((a, i) => {
    fields.push({ id: 'tag' + i, label: (i + 1) + '. ' + t('tag'), type: 'text', value: a.tag || '' }, { id: 'prompt' + i, label: t('attPrompt'), type: 'text', value: a.prompt || '' }, { id: 'def' + i, label: t('attDefault'), type: 'text', value: a.text == null ? '' : String(a.text) },
      { id: 'inv' + i, label: t('attInvisible'), type: 'check', value: !!((a.flags | 0) & 1) }, { id: 'con' + i, label: t('attConstant'), type: 'check', value: !!((a.flags | 0) & 2) }, { id: 'del' + i, label: t('delete'), type: 'check', value: false });
  });
  const r = await askForm(t('battmanTitle') + ' — ' + def.name, fields, { ok: t('apply') });
  if (!r) return;
  let ai = 0;
  const ents = def.ents.filter(e => e && e.type !== 'ATTDEF').concat([]);
  const out = [];
  for (const e of def.ents) {
    if (!e || e.type !== 'ATTDEF') { out.push(e); continue; }
    const i = ai++;
    if (r['del' + i]) continue;
    const tag = String(r['tag' + i] || '').trim().toUpperCase().replace(/\s+/g, '_') || e.tag;
    out.push({ ...e, tag, prompt: String(r['prompt' + i] || ''), text: String(r['def' + i] == null ? '' : r['def' + i]), flags: (r['inv' + i] ? 1 : 0) | (r['con' + i] ? 2 : 0) });
  }
  void ents;
  const cmds = [{ op: 'blockdef', name: def.name, def: { ...def, ents: out } }, { op: 'blocksync', name: def.name }];
  if (doc.run({ op: 'group', cmds })) { refreshUndo(); api.requestRender(); api.drawOverlay(); api.toast(t('attSynced')); } else api.toast(t('error'));
}
/** WBLOCK: bloğu (ya da seçimi / bütün çizimi) ayrı bir DXF dosyasına yazar; blokta $INSBASE tabandır */
async function wblockDialog(name) {
  if (!needModel() || !gate('savedxf')) return;
  let src = name ? 'block' : null, nm = name;
  if (!src) {
    const bl = [...S.blocks.values()].map(d => [d.name, d.name]);
    const r = await askForm('WBLOCK', [
      { id: 'src', label: t('wblockSrc'), type: 'select', value: bl.length ? 'block' : (ed.sel.size ? 'sel' : 'all'), options: [['block', t('blockN')], ['sel', t('scopeSel')], ['all', t('scopeAll')]] },
      { id: 'name', label: t('blockN'), type: 'select', value: bl.length ? bl[0][0] : '', options: bl.length ? bl : [['', '—']] },
    ], { ok: t('ok') });
    if (!r) return;
    src = r.src; nm = r.name;
  }
  if (src === 'all') { saveDxf(false); return; }
  let prims, fileName, vars = {};
  if (src === 'sel') { prims = [...ed.sel]; if (!prims.length) { api.toast(t('selEmpty')); return; } fileName = api.baseName() + '_secim.dxf'; }
  else {
    const def = S.blocks.get(blkKey(nm)); if (!def) { api.toast(t('blkNoneDef')); return; }
    prims = []; for (const e of def.ents) for (const p of entsToPrims({ ...e, id: newId() }, S.layers, S.blocks)) prims.push(p);
    vars = { INSBASE: def.base.slice() }; fileName = def.name.replace(/[^\w.-]+/g, '_') + '.dxf';
  }
  const text = writeDxf(prims, S.layers, { ltypes: S.ltypes, units: UNIT_CODE[S.units] || 0, blocks: S.blocks, vars });
  saveDxfText(text, fileName);
}
/** PURGE: kullanılmayan blok tanımları ve boş katmanlar (AutoCAD PURGE'ün iki kalemi), tek geri alma adımı */
async function purgeDialog() {
  if (!needModel() || !gate('blocks')) return;
  if (bses) { api.toast(t('beditCloseFirst')); return; }   // temizleme ana çizimin tablosunu ilgilendirir
  const cnt = insCounts();
  const bl = [...S.blocks.values()].filter(d => !(cnt.get(blkKey(d.name)) || 0));
  const used = new Set(S.scene.layouts[0].prims.map(p => p.lay));
  for (const d of S.blocks.values()) for (const e of d.ents || []) if (e && e.layer) used.add(e.layer);
  const la = [...S.layers.keys()].filter(n => n !== '0' && n !== ed.curLayer && !used.has(n));
  if (!bl.length && !la.length) { api.toast(t('purgeNone')); return; }
  const r = await askForm(t('purgeTitle'), [
    { id: 'blocks', label: t('purgeBlocks').replace('%s', String(bl.length)), type: 'check', value: bl.length > 0 },
    { id: 'layers', label: t('purgeLayers').replace('%s', String(la.length)), type: 'check', value: la.length > 0 },
  ], { ok: t('apply'), hint: [...bl.map(d => d.name), ...la].join(', ').slice(0, 300) });
  if (!r) return;
  const cmds = [];
  if (r.blocks) for (const d of bl) cmds.push({ op: 'blockdel', name: d.name });
  if (r.layers) for (const n of la) cmds.push({ op: 'layerdel', name: n, mode: 'move' });
  if (!cmds.length) return;
  if (doc.run(cmds.length === 1 ? cmds[0] : { op: 'group', cmds })) { refreshUndo(); api.requestRender(); call(api.buildLayerList); api.toast(t('purged').replace('%s', String(cmds.length))); }
}
/** BASE: blok düzenleyicide tanımın taban noktası; çizimde $INSBASE (bu çizim başka çizime blok olarak eklenince ekleme noktası) */
function setBase(p) {
  if (bses) { if (bses.kind !== 'bedit') { api.toast(t('baseOnlyBedit')); return; } bses.base = [p[0], p[1], p[2] || 0]; api.toast(t('baseSet') + ': ' + fmt(p[0]) + ' ; ' + fmt(p[1])); api.drawOverlay(); return; }
  if (!doc) return;
  if (doc.run({ op: 'vars', set: { INSBASE: [p[0], p[1], p[2] || 0] } })) { refreshUndo(); api.toast(t('baseSet') + ': ' + fmt(p[0]) + ' ; ' + fmt(p[1])); }
}
/** Seçimi öne / arkaya (seçim menüsü ve komutlar); dolgu taşınıyorsa "taramalar arkada" ekran sıralaması kapatılır (yoksa değişiklik görünmezdi) */
function drawOrderSel(mode) {
  if (!needModel() || !gate('t:draworder')) return;
  if (!ed.sel.size) { api.toast(t('noSel')); return; }
  drawOrderRun([...ed.sel].map(p => p.key), mode, null);
}
function drawOrderRun(keys, mode, ref) {
  if (!doc || !keys.length) return false;
  const ps = doc.find(keys);
  if (S.hatchBack !== false && ps.some(p => p.k === 0 && p.fill && !p.bg)) { D.setDisplay('hatchBack', false); api.toast(t('droHatchBackOff'), 3000); }
  const ok = doc.run({ op: 'draworder', keys, mode, ref });
  if (ok) { refreshUndo(); api.requestRender(); api.drawOverlay(); haptic('toggle'); api.toast(t('droDone').replace('%s', String(keys.length)), 1400); }
  return ok;
}
/** TEXTTOFRONT (yazılar ve ölçüler öne) · HATCHTOBACK (taramalar ve dolgular arkaya): bütün çizim */
function drawOrderKind(kind) {
  if (!needModel() || !gate('t:draworder')) return;
  const all = S.scene.layouts[0].prims;
  const keys = kind === 'text' ? all.filter(p => p.k === 1 || (p.info && p.info.t === 'DIMENSION')).map(p => p.key) : all.filter(p => p.k === 0 && p.fill && !p.bg && (p.et === 'HATCH' || p.et === 'SOLID' || p.et === 'TRACE')).map(p => p.key);
  if (!keys.length) { api.toast(t('droNone')); return; }
  drawOrderRun(keys, kind === 'text' ? 'front' : 'back', null);
}

// ---------------------------------------------------------------------------------
// BLOK DÜZENLEYİCİ OTURUMU (BEDIT / REFEDIT). Model uzayı ilkelleri ve düzenleme belgesi GEÇİCİ olarak
// oturumunkilerle değiştirilir: bütün çizim araçları, geri al / yinele ve kaplama olduğu gibi çalışır, ana
// belgenin günlüğüne hiçbir şey yazılmaz. Kaydet → ana belgede 'blockdef' + 'blocksync' tek adım; kapat →
// eski ilkeller ve belge geri gelir. BEDIT tanımı tanım uzayında (taban işaretiyle) gösterir, REFEDIT
// yerleştirmeyi olduğu yerde gösterir ve ötekileri solgun (S.backdrop) çizer.
// ---------------------------------------------------------------------------------
let bses = null;
async function beditStart(name, opt = {}) {
  if (!needModel()) return false;
  if (bses) { api.toast(t('beditCloseFirst')); return false; }
  if (!gate(opt.inplace ? 't:refedit' : 't:bedit')) return false;
  const k = blkKey(name);
  if (!S.blocks.has(k) && !blockAdopt(name)) { api.toast(t('blkNoneDef')); return false; }
  const def = S.blocks.get(k), model = S.scene.layouts[0];
  const T = [1, 0, 0, 1, -(def.base[0] || 0), -(def.base[1] || 0)];
  let m = null, inv = null, group = null, z0 = 0;
  if (opt.inplace) {
    group = opt.h ? model.prims.filter(p => p.info && p.info.t === 'INSERT' && p.info.h === opt.h) : [];
    if (!group.length) { api.toast(t('notBlock')); return false; }
    const info = group[0].info;
    m = mul(B.insMatrix(info), T); inv = B.invert(m); z0 = info.z || 0;
    if (!inv) { api.toast(t('error')); return false; }
  }
  if (tools.running) { tools.cancel(); markActive(null); }
  ed.sel.clear();
  const ents = opt.inplace ? B.xformEnts(def.ents, m, z0 - (def.base[2] || 0)) : B.clone(def.ents);
  const prims = [];
  ents.forEach((e, i) => {
    for (const p of entsToPrims({ ...e, id: 'B' + i }, S.layers, S.blocks)) { if (e.type !== 'INSERT') p.key = 'B' + i; if (Array.isArray(e.vis) && e.vis.length) p.vis = e.vis.slice(); prims.push(p); }
  });
  const dyn = B.clone(def.dyn || { params: [] });
  if (!Array.isArray(dyn.params)) dyn.params = [];
  for (const prm of dyn.params) if (Array.isArray(prm.ents)) prm.keys = prm.ents.map(i => 'B' + i);
  bses = { name: def.name, kind: opt.inplace ? 'refedit' : 'bedit', h: opt.h || null, base: def.base.slice(), m, inv, z0, prims0: model.prims, doc0: doc, view0: { ...S.view }, dyn };
  if (opt.inplace) { const gset = new Set(group); const bd = model.prims.filter(p => !gset.has(p)); S.backdrop = { prims: bd, tree: new api.RTree(bd, p => p.bb) }; }
  model.prims = prims;
  doc = makeDoc(null); ed.doc = doc;
  rebuild();
  S.bedit = { kind: bses.kind, name: def.name };
  if (!opt.inplace && model.ext && isFinite(model.ext[0])) { const bb = model.ext, w = Math.max(bb[2] - bb[0], 1e-6), h = Math.max(bb[3] - bb[1], 1e-6); api.zoomExtents([bb[0] - w * 0.15, bb[1] - h * 0.15, bb[2] + w * 0.15, bb[3] + h * 0.15]); }
  showBeditBar();
  statusMode((opt.inplace ? 'REFEDIT' : 'BEDIT') + ' · ' + def.name);
  refreshUndo(); refreshTiles(); S.cacheValid = false; api.requestRender(); api.drawOverlay();
  api.toast(t(opt.inplace ? 'refeditOn' : 'beditOn').replace('%s', def.name), 2800);
  return true;
}
function beditRestore() {
  const s = bses; if (!s) return;
  const model = S.scene.layouts[0];
  model.prims = s.prims0;
  doc = s.doc0; ed.doc = doc;
  bses = null; S.backdrop = null; S.bedit = null;
  ed.sel.clear();
  if (tools.running) { tools.cancel(); markActive(null); }
  rebuild();
  if (s.view0) { S.view.scale = s.view0.scale; S.view.cx = s.view0.cx; S.view.cy = s.view0.cy; }
  removeBeditBar(); statusMode(null);
  refreshUndo(); refreshTiles(); S.cacheValid = false; api.requestRender(); api.drawOverlay();
}
/** BSAVE / REFCLOSE Save: oturum ilkelleri tanım varlığı olur (yerindeyse matris tersiyle), ana belgede tanım + eşitleme tek adım */
async function beditSave() {
  const s = bses; if (!s || !s.doc0) return false;
  const model = S.scene.layouts[0];
  const { ents: ents0, keys } = primsToDefEnts(model.prims);
  if (!ents0.length) { api.toast(t('beditEmpty')); return false; }
  const ents = s.kind === 'refedit' ? B.xformEnts(ents0, s.inv, (s.base[2] || 0) - s.z0) : ents0;
  // Düzenlenen tanımın içine kendisi (ya da onu içeren bir blok) yerleştirilmişse kaydetmek kilitlenmeye yol açar
  if (B.refersTo(s.name, ents, S.blocks)) { api.toast(t('blkSelfRef'), 3200); return false; }
  const params = (s.dyn.params || []).map(prm => { const q = { ...prm }; if (Array.isArray(prm.keys)) { q.ents = prm.keys.map(x => keys.indexOf(x)).filter(i => i >= 0); if (!q.ents.length) q.ents = null; } delete q.keys; return q; });
  const def = { name: s.name, base: s.base.slice(), ents, dyn: params.length ? { params } : null };
  const main = s.doc0;
  beditRestore();
  const ok = main.run({ op: 'group', cmds: [{ op: 'blockdef', name: def.name, def }, { op: 'blocksync', name: def.name }] });
  refreshUndo(); S.cacheValid = false; api.requestRender(); api.drawOverlay();
  api.toast(ok ? t('beditSaved').replace('%s', def.name) : t('error'), 2400);
  return ok;
}
/** BCLOSE / REFCLOSE: değişiklik varsa sorulur (kaydet / at) */
async function beditClose() {
  const s = bses; if (!s) return;
  const dirty = !!(doc && doc.dirty) || JSON.stringify(s.dyn) !== JSON.stringify(S.blocks.get(blkKey(s.name)).dyn || { params: [] }) || s.base.join(',') !== S.blocks.get(blkKey(s.name)).base.join(',');
  if (dirty) { const keep = await askConfirm(t('beditSaveAsk').replace('%s', s.name)); if (keep) { await beditSave(); return; } }
  beditRestore();
  api.toast(t('beditClosed'), 1400);
}
function showBeditBar() {
  let bar = $('beditBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'beditBar'; bar.className = 'bedit-bar hud'; const vp = $('viewport'); if (vp) vp.appendChild(bar); else document.body.appendChild(bar); }
  const s = bses; if (!s) return;
  const b = (a, ic, lbl, cls = '') => `<button type="button" class="btn small${cls ? ' ' + cls : ''}" data-bb="${a}" title="${esc(lbl)}"><svg class="ic" aria-hidden="true"><use href="#${ic}"/></svg><span>${esc(lbl)}</span></button>`;
  bar.innerHTML = `<span class="bb-name"><b>${esc(s.kind === 'refedit' ? 'REFEDIT' : 'BEDIT')}</b> ${esc(s.name)}</span>` + b('save', 'i-check', t('bsave'), 'primary') + b('close', 'i-close', t('bclose')) + (s.kind === 'bedit' ? b('params', 'i-sliders', t('bpParams')) + b('base', 'i-goto', tileLabel('t:base')) : '');
  bar.hidden = false;
  bar.onclick = (ev) => { const x = ev.target.closest('[data-bb]'); if (!x) return; const a = x.dataset.bb; if (a === 'save') void beditSave(); else if (a === 'close') void beditClose(); else if (a === 'params') void bparamsDialog(); else if (a === 'base') act('t:base'); };
}
function removeBeditBar() { const bar = $('beditBar'); if (bar) { bar.hidden = true; bar.innerHTML = ''; } }
/** Oturumdaki parametre listesi: ekle / sil, görünürlük durumları, nesne ataması */
async function bparamsDialog() {
  if (!bses || bses.kind !== 'bedit') { api.toast(t('bparamOnlyBedit')); return; }
  const P = bses.dyn.params;
  let html = `<div class="full btns"><button type="button" class="btn primary small" data-bp="add">${esc(t('bpAdd'))}</button><button type="button" class="btn small" data-bp="vstate">${esc(tileLabel('t:bvstate'))}</button></div>`;
  if (!P.length) html += `<div class="full muted">${esc(t('bpNone'))}</div>`;
  P.forEach((prm, i) => {
    const desc = prm.kind === 'vis' ? (prm.states || []).join(' · ') : prm.kind === 'linear' ? `${fmt(prm.def)} (${prm.mode === 'stretch' ? t('bpStretch') : t('bpMove')})` : prm.kind === 'rot' ? fmt(prm.def) + '°' : prm.kind === 'flip' ? t('bpFlip') : t('bpPoint');
    html += `<div class="full blk-row"><div class="blk-name"><b>${esc(prm.label || prm.id)}</b><small>${esc(t('bp_' + prm.kind))} · ${esc(desc)} · ${Array.isArray(prm.keys) && prm.keys.length ? prm.keys.length + ' ' + esc(t('objectsN')) : esc(t('bpAllObjs'))}</small></div><div class="blk-btns"><button type="button" class="btn small" data-bp="del" data-i="${i}">${esc(t('delete'))}</button></div></div>`;
  });
  api.openDoc(t('bpParams') + ' — ' + bses.name, html);
  $('docBody').onclick = (ev) => {
    const b = ev.target.closest('[data-bp]'); if (!b) return;
    if (b.dataset.bp === 'add') { api.hide('docPanel'); act('t:bparam'); return; }
    if (b.dataset.bp === 'vstate') { api.hide('docPanel'); act('t:bvstate'); return; }
    if (b.dataset.bp === 'del') { P.splice(+b.dataset.i, 1); bparamsDialog(); api.drawOverlay(); }
  };
}
/** Parametre ekleme (tools.bparamNext → buraya): kimlik verilir, nesne anahtarları normalize edilir; görünürlük tek parametredir */
function bparamAdd(prm) {
  if (!bses || bses.kind !== 'bedit') return false;
  const P = bses.dyn.params;
  const keys = Array.isArray(prm.ents) ? [...new Set(prm.ents.map(k => { const p = S.prims.find(q => q.key === k); return p ? entKeyOf(p) : k; }))] : null;
  const q = { ...prm, keys, ents: undefined };
  delete q.ents;
  if (q.kind === 'vis') { const i = P.findIndex(x => x.kind === 'vis'); q.id = i >= 0 ? P[i].id : 'vis'; if (i >= 0) P[i] = q; else P.push(q); }
  else { let n = 1; while (P.some(x => x.id === 'p' + n)) n++; q.id = 'p' + n; P.push(q); }
  api.drawOverlay();
  return true;
}
function bvstates() { if (!bses) return []; const v = (bses.dyn.params || []).find(x => x.kind === 'vis'); return v ? v.states.slice() : []; }
/** Seçili oturum ilkelleri yalnız verilen durumda görünür (null = hepsinde) */
function bvstateSet(keys, state) {
  if (!bses) return 0;
  let n = 0;
  const set = new Set(keys);
  for (const p of S.prims) { if (!set.has(p.key) && !(p.info && p.info.t === 'INSERT' && set.has(p.info.h))) continue; if (state) p.vis = [state]; else delete p.vis; n++; }
  if (doc) doc.log.push({ op: 'vis' });   // oturumu "değişmiş" sayar (kaydet sorusu)
  return n;
}
/*
 * DİNAMİK TUTAMAKLAR: seçili TEK yerleştirmenin parametreleri kutu tutamağından ayrı gliflerle çizilir (AutoCAD'in açık mavi
 * özel tutamakları): ▼ görünürlük (dokun → durum seçici), ⇄ çevirme (dokun → çevir), ● döndürme (sürükle), ▶ doğrusal
 * (sürükle: yön boyunca uzunluk), ■ nokta (sürükle). Bırakışta tek 'dynset' komutu; yerleştirme yeniden genişletilir.
 */
const DYN_COL = '#4da3ff';
function dynLayout() {
  if (!gizmoOn() || bses) return null;
  const sel = [...ed.sel].filter(p => p.k !== 4);
  if (!sel.length) return null;
  const info = sel[0].info;
  if (!info || info.t !== 'INSERT' || !info.blk || !sel.every(p => p.info && p.info.h === info.h)) return null;
  const def = S.blocks.get(blkKey(info.name)); if (!def || !B.params(def).length) return null;
  const m = mul(B.insMatrix(info), [1, 0, 0, 1, -(def.base[0] || 0), -(def.base[1] || 0)]);
  const grips = B.dynGrips(def, info.dyn, m).map(g => { const s = toScreen(g.x, g.y); return { ...g, sx: s[0], sy: s[1] }; });
  return { info, def, m, grips, hitR: Math.round((ui.glove ? 26 : 22) * ui.fontScale) };
}
function drawDynGrips(c, DL) {
  const r = Math.round(7 * ui.fontScale);
  c.save(); c.lineWidth = 2; c.strokeStyle = DYN_COL; c.fillStyle = DYN_COL; c.setLineDash([]);
  c.font = `bold ${Math.round(10 * ui.fontScale)}px sans-serif`; c.textBaseline = 'bottom'; c.textAlign = 'left';
  for (const g of DL.grips) {
    const x = g.sx, y = g.sy;
    c.beginPath();
    if (g.kind === 'vis') { c.moveTo(x - r, y - r * 0.8); c.lineTo(x + r, y - r * 0.8); c.lineTo(x, y + r); c.closePath(); c.fill(); }
    else if (g.kind === 'flip') { const ux = g.ux != null ? -g.uy : 1, uy = g.ux != null ? g.ux : 0; c.moveTo(x - ux * r * 1.4, y + uy * r * 1.4); c.lineTo(x + ux * r * 1.4, y - uy * r * 1.4); c.stroke(); c.beginPath(); c.arc(x, y, r * 0.55, 0, TAU); c.fill(); }
    else if (g.kind === 'rot') { c.arc(x, y, r, 0, TAU); c.fill(); if (g.cx != null) { const s = toScreen(g.cx, g.cy); c.setLineDash([4, 3]); c.moveTo(s[0], s[1]); c.lineTo(x, y); c.stroke(); c.setLineDash([]); } }
    else if (g.kind === 'linear') { const ux = g.ux || 1, uy = -(g.uy || 0); c.moveTo(x + ux * r * 1.5, y + uy * r * 1.5); c.lineTo(x - uy * r, y + ux * r); c.lineTo(x + uy * r, y - ux * r); c.closePath(); c.fill(); }
    else { c.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6); c.fill(); }
    const txt = g.label + (g.kind === 'vis' ? ': ' + g.value : g.kind === 'linear' ? ': ' + fmt(g.value) : g.kind === 'rot' ? ': ' + fmt(g.value, 1) + '°' : '');
    c.fillText(txt, x + r + 3, y - r - 2);
  }
  c.restore();
}
function runDyn(h, values) {
  if (!doc) return false;
  const ok = doc.run({ op: 'dynset', h, values });
  if (ok) { ed.sel.clear(); for (const p of S.prims) if (p.k !== 4 && p.info && p.info.h === h) ed.sel.add(p); refreshUndo(); api.requestRender(); haptic('toggle'); }
  api.drawOverlay();
  return ok;
}
async function dynVisPick(DL, prm) {
  const cur = B.dynValue(prm, DL.info.dyn);
  const r = await askForm(prm.label || t('bpVis'), [{ id: 'state', label: t('bpState'), type: 'select', value: cur, options: (prm.states || []).map(x => [x, x]) }], { ok: t('ok') });
  if (!r || r.state === cur) return;
  runDyn(DL.info.h, { [prm.id]: r.state });
}
/** Sınama ve kabuk: oturum durumu, tanım tablosu, dinamik tutamaklar */
ed.bedit = () => (bses ? { kind: bses.kind, name: bses.name, base: bses.base.slice(), params: (bses.dyn.params || []).length } : null);
ed.beditStart = (name, o) => beditStart(name, o || {});
ed.beditSave = () => beditSave();
ed.beditClose = () => beditClose();
ed.blockAdopt = (name) => blockAdopt(name);
ed.dynGrips = () => { const DL = dynLayout(); return DL ? DL.grips.map(g => ({ id: g.id, kind: g.kind, sx: g.sx, sy: g.sy, value: g.value, label: g.label })) : []; };
ed.runDyn = (h, values) => runDyn(h, values);
ed.drawOrder = (keys, mode, ref) => drawOrderRun(keys, mode, ref);
ed.showBlocks = () => showBlocks();

// ---------------------------------------------------------------------------------
// DXF kaydetme
// ---------------------------------------------------------------------------------
const UNIT_CODE = { mm: 4, cm: 5, m: 6, km: 7, dm: 14, 'inç': 1, ft: 2 };
function saveDxf(onlyEdited) {
  if (!needDoc()) return;
  const model = S.scene.layouts[0];
  if (onlyEdited && !(doc && doc.dirty)) { api.toast(t('noChanges')); return; }
  if (bses) { api.toast(t('beditCloseFirst')); return; }
  const text = writeDxf(model.prims, S.layers, { onlyEdited, ltypes: S.ltypes, units: UNIT_CODE[S.units] || 0, blocks: S.blocks, vars: S.vars });
  const name = api.baseName() + (onlyEdited ? '_degisiklikler' : '_duzenlenmis') + '.dxf';
  saveDxfText(text, name);
}
/** DXF metnini dosyaya yazar (Android: Bridge.saveFile, tarayıcı: indirme); Drive açıksa yükleme eylemi */
function saveDxfText(text, name) {
  const bytes = new TextEncoder().encode(text);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  const drv = window.dwgApp && window.dwgApp.drive;
  const driveAct = drv && drv.signedIn && drv.signedIn() ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => drv.uploadWithPicker({ b64, name, mime: 'application/dxf' }) } : undefined;
  if (window.Android && window.Android.saveFile) { const r = window.Android.saveFile(b64, name, 'application/dxf', true); api.toast(r ? t('dxfSaved') + ': ' + r : t('dxfFail'), { type: r ? 'ok' : 'error', ms: 6000, action: r ? driveAct : undefined }); }
  else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/dxf' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); if (driveAct) api.toast('DXF', { type: 'ok', action: driveAct }); }
}
/** DXF metnini base64 olarak verir (Drive yüklemesi için); {b64, name} */
ed.dxfBase64 = (onlyEdited) => {
  if (!S.hasDoc) return null;
  if (bses) { api.toast(t('beditCloseFirst')); return null; }   // oturum açıkken model uzayı blok içeriğidir: Drive'a o yüklenmesin
  const text = writeDxf(S.scene.layouts[0].prims, S.layers, { onlyEdited: !!onlyEdited, ltypes: S.ltypes, units: UNIT_CODE[S.units] || 0, blocks: S.blocks, vars: S.vars });
  const bytes = new TextEncoder().encode(text);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), name: api.baseName() + (onlyEdited ? '_degisiklikler' : '_duzenlenmis') + '.dxf' };
};

// ---------------------------------------------------------------------------------
// Dokunma, geri ve kaplama (2B)
// ---------------------------------------------------------------------------------
/** app.onTap → true ise araç işledi */
export function tap(w, sx, sy) {
  if (ed.is3D()) return true; // 3B tuvali kendi olaylarını işler
  if (!tools.running) return false;
  return tools.tap(w, [sx, sy]);
}
export function back() {
  if (cmdSeq) { cmdSeqCancel(); return true; }
  const pop = $('tbPop'); if (pop && !pop.hidden) { closePop(); return true; }
  const tour = $('tour'); if (tour && !tour.hidden) { endTour(); return true; }
  if (ed.m3) { ed.m3 = null; showPrompt(null); markActive(null); overlay3D(); return true; }
  if (ed.is3D()) { exit3D(); return true; }
  if (tools.running) { tools.cancel(); markActive(null); return true; }
  if (ed.sel.size) { ed.sel.clear(); api.drawOverlay(); return true; }
  return false;
}
// ---------------------------------------------------------------------------------
// Seçim tutamağı (gizmo): taşı · ölçekle · uzat/kısalt · döndür
// Sürükleme sırasında BELGE DEĞİŞMEZ; yalnız önizleme matrisi tutulur, bırakışta tek bir
// 'xform' komutu işlenir (tek geri alma adımı).
// ---------------------------------------------------------------------------------
let giz = null;   // { kind, bb, w0, m, info }
/** Tutamak ne zaman görünür: 2B, seçim var, araç çalışmıyor, ölçü/not kipinde değil */
function gizmoOn() {
  return !!(S && S.hasDoc && ed.sel.size && !ed.is3D() && !tools.running && S.mode === 'view' && !S.notesOn && ui.gizmo !== false);
}
function gizmoLayout() {
  if (!gizmoOn()) return null;
  const bb = Gz.boxOf(ed.sel);
  return bb ? Gz.layout(bb, toScreen, { fs: ui.fontScale, glove: ui.glove }) : null;
}
/*
 * Köşe (düğüm) tutamakları. VARSAYILAN KAPALIDIR: bir polyline'ın düğümleri çoğu zaman sınır
 * kutusunun köşeleriyle çakışır (dikdörtgende birebir), açık bırakılırsa kutuyla ölçekleme
 * yapılamaz hâle gelir. Kullanıcı karodan açtığında düğüm önceliği kazanır.
 * ÇOKLU SEÇİMDE de görünür (v7.69, AutoCAD gibi): seçili bütün yolların düğümleri tek listededir,
 * her düğüm ilkelini taşır; ölçü parçaları dışarıda kalır (tanımı bozulur, "Ölçüyü düzenle" ile değişir).
 * Sınır: toplam 400 düğüm ya da 100 seçili nesne (AutoCAD GRIPOBJLIMIT) aşılırsa hiç tutamak çizilmez, kutu
 * tutamağı kalır; nesne başına 200'ü aşan yol atlanır, ötekilerin tutamağı kalır. Hiç tutamak kalmıyorsa karo
 * açılırken nedeni söylenir. Daire / yay düğüm almaz (başlangıç noktasını taşımak yayı bozardı).
 */
function gizmoVertLayout() {
  if (!ui.grips || !gizmoOn() || !ed.sel.size) return null;
  const verts = Gz.vertsOfAll(ed.sel);
  if (!verts.length) return null;
  const VL = Gz.layoutVerts(verts, toScreen, { fs: ui.fontScale, glove: ui.glove });
  return VL ? { verts, VL } : null;
}
/*
 * BÖLGE SEÇİMİ SÜRÜKLEMESİ. Seç aracı pencere ya da çokgen kipindeyken tek parmak kaydırmaz,
 * bölge çizer; app.js bunu tutamak jestiyle aynı kapıdan (gizmoDown / Move / Up) alır. Yön AutoCAD
 * kuralıdır: soldan sağa başlayan sürükleme PENCERE (tamamen içindekiler), sağdan sola başlayan
 * KESEN (dokunanlar); çokgende de ilk yatay hareket karar verir. Renk de AutoCAD'deki gibi: pencere
 * mavi dolu, kesen yeşil kesikli.
 */
let selDrag = null;
const selDragArmed = () => !!tools && tools.running && tools.selecting && tools.selMode !== 'tap';   // Seç aracı ve seçim aşamasındaki her araç (Taşı, Sil…): Pencere / Çokgen düğmeleri hepsinde var
function finishSelDrag(d) {
  const crossing = d.crossing === true;
  let n = 0;
  if (d.mode === 'box') {
    if (Math.abs(d.x1 - d.x0) < 6 || Math.abs(d.y1 - d.y0) < 6) return;   // yalnız dokunuş: kutu yok
    const a = toWorld(Math.min(d.x0, d.x1), Math.max(d.y0, d.y1)), b = toWorld(Math.max(d.x0, d.x1), Math.min(d.y0, d.y1));
    n = tools.selectRegion({ rect: [a[0], a[1], b[0], b[1]] }, crossing);
  } else {
    if (d.pts.length < 3) return;
    n = tools.selectRegion({ poly: d.pts.map(p => toWorld(p[0], p[1])) }, crossing);
  }
  api.toast(n ? `${n} ${t('selectedN')}` : t('selRegionNone'), 1400);
  if (n) haptic('snap');
}
/*
 * Bölge seçimi çizimi — AutoCAD renkleri: soldan sağa PENCERE mavi ve düz kenarlı (yalnız içindekiler),
 * sağdan sola KESEN yeşil ve kesik kenarlı (dokunanlar da). Yön ilk yatay hareketten belli olur; belli olana
 * kadar pencere renginde çizilir. İşaretçinin yanında kipin adı yazar ki telefonda renk tek ipucu olmasın.
 */
export const SEL_COLORS = { window: '#4da3ff', crossing: '#3ddc84' };
function drawSelDrag(c, drag) {
  const d = drag === undefined ? selDrag : drag; if (!d) return;
  const crossing = d.crossing === true, col = crossing ? SEL_COLORS.crossing : SEL_COLORS.window;
  const moved = Math.abs(d.x1 - d.x0) >= 6 || Math.abs(d.y1 - d.y0) >= 6 || d.pts.length > 2;
  if (!moved) return;
  c.save(); c.lineWidth = 1.5; c.strokeStyle = col; c.fillStyle = col; c.globalAlpha = 1;
  if (crossing) c.setLineDash([6, 4]); else c.setLineDash([]);
  c.beginPath();
  if (d.mode === 'box') c.rect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
  else { d.pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); }
  c.globalAlpha = 0.18; c.fill(); c.globalAlpha = 1; c.stroke();
  // etiket: işaretçinin sağ üstünde, kutunun rengiyle; kenara taşarsa içeri alınır
  const lbl = crossing ? t('selCrossingLbl') : t('selWindowLbl');
  c.setLineDash([]); c.font = `bold ${Math.round(12 * (ui.fontScale || 1))}px system-ui, sans-serif`; c.textBaseline = 'bottom';
  const tw = c.measureText(lbl).width + 10, th = 18 * (ui.fontScale || 1);
  const lx = Math.min(S.W - tw - 4, Math.max(4, d.x1 + 14)), ly = Math.max(th + 4, d.y1 - 10);
  c.globalAlpha = 0.9; c.fillRect(lx, ly - th, tw, th); c.globalAlpha = 1;
  c.fillStyle = '#0b1020'; c.fillText(lbl, lx + 5, ly - 3);
  c.restore();
}
/** Sınama ve durum çubuğu için: süren bölge seçiminin kipi ({ mode, crossing, implied }) ya da null */
ed.selDragState = () => (selDrag ? { mode: selDrag.mode, crossing: selDrag.crossing, implied: !!selDrag.implied } : null);
/** Sınama için: 3B bölge seçiminin durumu ve 3B yakalama işaretinin varlığı */
ed.sel3DragState = () => (p3.region ? { mode: p3.region.mode, crossing: p3.region.crossing, implied: !!p3.region.implied } : null);
ed.snap3State = () => (p3.snap ? { p: p3.snap.slice(), kind: p3.snapKind, aim: !!p3.aim } : null);
/*
 * Çalışan araç şu an NESNE mi seçiyor (AutoCAD "Select objects:")? app.js imleci ve yakalamayı buna
 * bakarak seçer: nesne isteminde küçük kare (pickbox) çizilir ve yakalama aranmaz. Bölge sürüklemesi
 * de nesne seçimidir — kutu çizilirken yakalama işaretinin belirmesi anlamsızdır.
 */
ed.pickingObject = () => !!(selDrag || (tools && tools.running && tools.pickingObject()));
/** Seçim rozeti: seçimin sol üst köşesinde sayı + kalem; dokununca seçim menüsü (Sil, Taşı, Renk…) */
function updateSelBadge() {
  const el = $('selBadge'); if (!el) return;
  const show = ed.sel.size > 0 && !ed.is3D() && !giz && !selDrag && !S.gestureActive && !(tools.running && !tools.selecting && tools.active !== 'select');
  if (!show) { el.hidden = true; return; }
  const bb = Gz.boxOf(ed.sel);
  if (!bb || !isFinite(bb[0])) { el.hidden = true; return; }
  const s = toScreen(bb[0], bb[3]);
  const x = Math.max(6, Math.min(S.W - 70, s[0] - 20)), y = Math.max(6, Math.min(S.H - 54, s[1] - 58));
  el.style.left = x + 'px'; el.style.top = y + 'px';
  const n = el.querySelector('.n'); if (n) n.textContent = String(ed.sel.size);
  el.hidden = false;
}
/** İşaretçi bir tutamağa indi mi? true dönerse app.js kaydırma/dokunma yapmaz. */
ed.gizmoDown = (sx, sy, o = {}) => {
  // o.handlesOnly: "Kalem çizer, parmak gezinir" kipinde parmak için — bölge seçimi ve örtük pencere parmağa
  // kapalıdır (seçim kalemin işi), ama seçim kutusunun tutamakları ve köşe tutamakları açık hedeflerdir: sürüklenebilir.
  if (!o.handlesOnly && selDragArmed()) { selDrag = { mode: tools.selMode, pts: [[sx, sy]], x0: sx, y0: sy, x1: sx, y1: sy, crossing: null }; return true; }
  /*
   * AutoCAD'in ÖRTÜK PENCERESİ: seçim aşamasında (Seç aracı ya da Taşı / Sil gibi araçların nesne seçimi)
   * BOŞ yere basıp sürüklemek kutu seçer — soldan sağa mavi pencere (içindekiler), sağdan sola yeşil kesen
   * (dokunanlar). Nesneye dokunmak onu seçer, iki parmak kaydırır. Parmak kıpırdamadan kalkarsa bu bir dokunuştur
   * ve olağan dokunma yoluna verilir (boş yere dokunmak zaten bir şey seçmez).
   */
  if (!o.handlesOnly && tools && tools.running && tools.selecting && tools.selMode === 'tap' && !ed.is3D() && !api.pick(toWorld(sx, sy))) {
    selDrag = { mode: 'box', implied: true, pts: [[sx, sy]], x0: sx, y0: sy, x1: sx, y1: sy, crossing: null };
    return true;
  }
  const L = gizmoLayout(); if (!L) return false;
  // Dinamik blok tutamakları kutu tutamağından ÖNCE bakılır (kutunun köşesiyle çakışabilir): dokunuş görünürlük / çevirme, sürükleme değer
  const DL = dynLayout();
  if (DL) { const g = DL.grips.find(q => Math.hypot(sx - q.sx, sy - q.sy) <= DL.hitR); if (g) { if (!gate('t:bparam')) return true; giz = { kind: 'dyn', g, DL, prm: B.params(DL.def).find(x => x.id === g.id), w0: toWorld(sx, sy), p: null, m: null, info: null, moved: false }; haptic('snap'); return true; } }
  const G = gizmoVertLayout();
  const kind = Gz.hit(sx, sy, L, G && G.VL); if (!kind) return false;
  if (!gate(Gz.needOf(kind))) return true;   // yetki yoksa jest yine yutulur: kutu açıldı
  if (String(kind).startsWith('v:')) {
    // Çoklu seçimde AYNI noktadaki düğümler (birleşen duvarların ortak köşesi gibi) birlikte gider: AutoCAD'de bunun için
    // Shift ile birden çok tutamak "sıcak" yapılır, dokunmatikte Shift yok — ortak köşe tek parmakla taşınır. Bir yolun
    // kendi çakışan düğümleri (kapalı polyline'ın başı / sonu) de birlikte gider.
    const vi = +kind.slice(2), v = G.verts[vi]; if (!v) return true;
    const bb = Gz.boxOf(ed.sel), ext = bb ? Math.max(bb[2] - bb[0], bb[3] - bb[1], 1e-9) : 1;
    const act = Gz.coincidentOf(G.verts, vi, ext * 1e-6);   // JOIN'in "uçları değiyor" payıyla aynı: göze bitişik köşe birlikte gider
    const moves = new Map();
    for (const j of act) { const q = G.verts[j]; if (!moves.has(q.p)) moves.set(q.p, { prim: q.p, ops0: q.p.ops.map(o => o.slice()), idx: [] }); moves.get(q.p).idx.push(q.i); }
    giz = { kind, vi, oi: v.i, act, tol: ext * 1e-6, prim: v.p, ops0: v.p.ops.map(o => o.slice()), moves: [...moves.values()], w0: toWorld(sx, sy), p: null, m: null, info: null, sn: null };
    haptic('snap');
    return true;
  }
  giz = { kind, bb: Gz.boxOf(ed.sel), w0: toWorld(sx, sy), m: null, info: null };
  haptic('snap');
  return true;
};
ed.gizmoMove = (sx, sy) => {
  if (selDrag) {
    const d = selDrag; d.x1 = sx; d.y1 = sy;
    if (d.mode === 'lasso') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(sx - l[0], sy - l[1]) > 3) d.pts.push([sx, sy]); }
    if (d.crossing == null && Math.abs(sx - d.x0) > 6) d.crossing = sx < d.x0;   // ilk yatay hareket: sola = kesen
    api.drawOverlay(); return true;
  }
  if (!giz) return false;
  if (giz.kind === 'dyn') {
    const w = toWorld(sx, sy);
    if (Math.hypot(w[0] - giz.w0[0], w[1] - giz.w0[1]) * S.view.scale > 4) giz.moved = true;
    if (giz.prm && (giz.prm.kind === 'rot' || giz.prm.kind === 'linear' || giz.prm.kind === 'point')) { giz.val = B.dynValueAt(giz.DL.def, giz.prm, w, giz.DL.m); giz.p = w; giz.info = { tip: 'dyn', label: giz.g.label, v: giz.val }; }
    api.drawOverlay();
    return true;
  }
  if (giz.vi != null) {
    // Bırakma noktası yakalamaya oturur: düğüm bir başka çizginin ucuna TAM denk gelsin diye.
    // Tutamak sürüklemesi NOKTA işidir: yakalama orada çalışır (uç / orta / merkez / kesişim…), açıklık 1,5 kat.
    // Sürüklenen köşenin KENDİ eski yeri yakalanmaz (elde tutulan düğüm oraya geri yapışırdı); nesnenin öteki
    // köşeleri yine hedef olur. Sürükleme boyunca işaret çizilir (overlay): nereye oturacağı görülür.
    const w = toWorld(sx, sy), o0 = giz.ops0[giz.oi];
    // "eski yer": sürüklenen düğümün VE onunla birlikte giden çakışan düğümlerin eski konumları, çakışma payıyla aynı payda
    const eskiler = giz.moves.flatMap(m => m.idx.map(i => m.ops0[i])), tol = Math.max(1e-9, giz.tol || 0);
    const eski = (q) => eskiler.some(o => Math.hypot(q[0] - o[1], q[1] - o[2]) <= tol);
    let sn = api.snapPeek ? api.snapPeek(w, { grip: true }) : null;
    if (sn && eski(sn.p)) sn = api.snapPeek(w, { grip: true, skip: giz.prim });                                   // kendi öteki köşeleri hedef kalır
    if (sn && eski(sn.p)) sn = api.snapPeek(w, { grip: true, skip: new Set(giz.moves.map(m => m.prim)) });   // çakışan köşeyi taşıyan yolların hepsi atlanır: başka nesnenin ucu yine bulunur
    if (sn && eski(sn.p)) sn = null;   // yine eski yer: yapışma
    const q = sn ? sn.p : w;
    giz.p = [q[0], q[1]]; giz.sn = sn || null;
    giz.info = { tip: 'vertex', dx: q[0] - o0[1], dy: q[1] - o0[2] };
    api.drawOverlay();
    return true;
  }
  const r = Gz.drag(giz.kind, giz.bb, giz.w0, toWorld(sx, sy));
  giz.m = r.m; giz.info = r.info;
  api.drawOverlay();
  return true;
};
/** commit=false ise (pointercancel) değişiklik atılır */
ed.gizmoUp = (commit) => {
  if (selDrag) {
    const d = selDrag; selDrag = null;
    if (commit) { if (d.implied && Math.abs(d.x1 - d.x0) < 6 && Math.abs(d.y1 - d.y0) < 6) tap(toWorld(d.x0, d.y0), d.x0, d.y0); else finishSelDrag(d); }
    api.drawOverlay(); return true;
  }
  const g = giz; giz = null;
  if (!g) return false;
  if (g.kind === 'dyn') {
    const prm = g.prm;
    if (commit && prm) {
      if (prm.kind === 'vis') { if (!g.moved) void dynVisPick(g.DL, prm); }
      else if (prm.kind === 'flip') { if (!g.moved) runDyn(g.DL.info.h, { [prm.id]: !B.dynValue(prm, g.DL.info.dyn) }); }
      else if (g.moved && g.val != null) runDyn(g.DL.info.h, { [prm.id]: g.val });
    }
    api.drawOverlay();
    return true;
  }
  if (g.vi != null) {
    const kip = g.p && (Math.abs(g.p[0] - g.ops0[g.oi][1]) > 0 || Math.abs(g.p[1] - g.ops0[g.oi][2]) > 0);
    if (commit && kip && doc) {
      // çakışan köşeler birlikte: her ilkel için taşınmış ops, tek 'reshape' adımı (tek geri alma)
      doc.run({ op: 'reshape', items: g.moves.map(m => ({ key: m.prim.key, ops: Gz.movedOpsMany(m.ops0, m.idx, g.p[0], g.p[1]) })) });
      refreshUndo(); api.requestRender(); haptic('toggle');
    }
    api.drawOverlay();
    return true;
  }
  if (commit && g.m && !Gz.isIdentity(g.m) && doc) {
    const keys = [...ed.sel].map(p => p.key);
    if (keys.length) { doc.run({ op: 'xform', keys, m: g.m }); refreshUndo(); api.requestRender(); haptic('toggle'); }
  }
  api.drawOverlay();
  return true;
};
ed.gizmoBusy = () => !!giz || !!selDrag;
/** Sürükleme okuması: ölçek yüzdesi / açı / öteleme — durum çubuğu yerine kutunun yanında */
function gizmoText() {
  const i = giz && giz.info; if (!i) return '';
  if (i.tip === 'move' || i.tip === 'vertex') return `${fmt(i.dx)} ; ${fmt(i.dy)}`;
  if (i.tip === 'dyn') return `${i.label}: ${Array.isArray(i.v) ? fmt(i.v[0]) + ' ; ' + fmt(i.v[1]) : fmt(i.v, 2)}`;
  if (i.tip === 'rot') return `${fmt(i.deg, 1)}°` + (i.snap ? ' ⌁' : '');
  return i.uniform ? `%${fmt(i.sx * 100, 1)}` : `%${fmt(i.sx * 100, 1)} × %${fmt(i.sy * 100, 1)}`;
}

/** 2B kaplama: seçim vurgusu, seçim tutamağı ve araç önizlemesi */
export function overlay(c) {
  const acc = S.selColor || '#ff9f0a', sw = S.selWidth || 3;
  if (ed.sel.size) {
    c.save();
    api.worldTransform(c);   // köken görünüm merkezi; tracePath / strokeWorldRect yerel koordinat kullanır (büyük UTM sayıları tuvale girmez)
    // Sürükleme önizlemesi: belge değişmeden seçim, tutamağın matrisiyle çizilir. Matris dünya
    // koordinatındadır, kaplama ise yerel kökende çizer — Gz.localM konjugasyonu bunu çevirir.
    if (giz && giz.m) { const [ox, oy] = api.worldOrigin(); const lm = Gz.localM(giz.m, ox, oy); c.transform(lm[0], lm[1], lm[2], lm[3], lm[4], lm[5]); }
    c.strokeStyle = acc; c.lineWidth = sw / S.view.scale; c.setLineDash([6 / S.view.scale, 4 / S.view.scale]); c.globalAlpha = 0.95;
    // Düğüm sürüklenirken matris YOKTUR (tek köşeyi taşımak afin değildir): o ilkel, taşınmış
    // ops'uyla çizilir. Önizleme ile bırakışta işlenen komut aynı Gz.movedOps'tan gelir.
    const surukVi = giz && giz.vi != null && giz.p ? giz : null;
    const tasinan = surukVi ? new Map(surukVi.moves.map(m => [m.prim, Gz.movedOpsMany(m.ops0, m.idx, surukVi.p[0], surukVi.p[1])])) : null;   // çakışan köşeleri taşınan her yol önizlemede de taşınmış çizilir
    for (const p of ed.sel) {
      if (p.k === 0) {
        c.beginPath();
        api.tracePath(c, tasinan && tasinan.has(p) ? tasinan.get(p) : p.ops);
        if (p.closed) c.closePath();
        c.stroke();
      } else api.strokeWorldRect(c, p.bb);
    }
    c.restore(); c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    const L = gizmoLayout();
    if (L) {
      Gz.draw(c, L, { line: acc, fill: bgColor(), ink: acc }, { fs: ui.fontScale });
      const G = gizmoVertLayout();
      if (G) Gz.drawVerts(c, G.VL, { line: acc, fill: bgColor(), ink: acc }, { fs: ui.fontScale, active: giz && giz.vi != null ? (giz.act || [giz.vi]) : -1 });
      // Köşe sürüklenirken yakalama işareti (dokunuş işaretiyle aynı glif ve renk): neye oturacağı görülsün
      if (giz && giz.vi != null && giz.sn && api.osnap) {
        const s = toScreen(giz.sn.p[0], giz.sn.p[1]);
        c.save(); c.strokeStyle = '#3ddc84'; c.fillStyle = '#3ddc84'; c.lineWidth = 2; c.setLineDash([]);
        api.osnap.drawMarker(c, s[0], s[1], giz.sn.kind, 8);
        c.font = 'bold 10px sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left';
        c.fillText(api.osnap.abbrOf(giz.sn.kind), s[0] + 11, s[1] - 10);
        c.restore();
      }
      const DL = dynLayout();
      if (DL) drawDynGrips(c, DL);
      const txt = gizmoText();
      if (txt) {
        c.font = `bold ${Math.round(12 * ui.fontScale)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom';
        const w = c.measureText(txt).width + 12, x = L.cx, y = L.box[1] - 10 * ui.fontScale;
        c.fillStyle = bgColor(); c.globalAlpha = 0.85; c.fillRect(x - w / 2, y - 18 * ui.fontScale, w, 18 * ui.fontScale);
        c.globalAlpha = 1; c.fillStyle = acc; c.fillText(txt, x, y - 3 * ui.fontScale);
        c.textAlign = 'left';
      }
    }
  }
  drawSelDrag(c); updateSelBadge();
  if (bses && bses.kind === 'bedit') {   // blok düzenleyici: taban noktası işareti (AutoCAD'in BASE noktası)
    const s = toScreen(bses.base[0], bses.base[1]);
    c.save(); c.strokeStyle = DYN_COL; c.lineWidth = 2; c.setLineDash([]);
    c.beginPath(); c.arc(s[0], s[1], 7, 0, TAU); c.stroke(); c.beginPath(); c.moveTo(s[0] - 12, s[1]); c.lineTo(s[0] + 12, s[1]); c.moveTo(s[0], s[1] - 12); c.lineTo(s[0], s[1] + 12); c.stroke();
    c.font = `bold ${Math.round(10 * ui.fontScale)}px sans-serif`; c.fillStyle = DYN_COL; c.textBaseline = 'bottom'; c.fillText('BASE', s[0] + 10, s[1] - 8);
    c.restore();
  }
  const d = tools.draft;
  if (!d || !tools.running && !d.keep) return;
  c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = Math.max(1.5, sw - 1); c.setLineDash([]);
  if (d.segs) for (const s of d.segs) { const a = toScreen(s[0][0], s[0][1]), b = toScreen(s[1][0], s[1][1]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  if (d.close && d.pts && d.pts.length > 2) { const a = toScreen(d.pts[0][0], d.pts[0][1]), b = toScreen(d.pts[d.pts.length - 1][0], d.pts[d.pts.length - 1][1]); c.setLineDash([4, 4]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]); }
  if (d.circle) { const s = toScreen(d.circle.c[0], d.circle.c[1]); c.beginPath(); c.arc(s[0], s[1], d.circle.r * S.view.scale, 0, TAU); c.stroke(); }
  if (d.pts) { c.font = `bold ${Math.round(11 * ui.fontScale)}px sans-serif`; c.textBaseline = 'bottom'; d.pts.forEach((p, i) => { const s = toScreen(p[0], p[1]); c.beginPath(); c.arc(s[0], s[1], 4, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.fillText(String(i + 1), s[0] + 6, s[1] - 5); c.fillStyle = acc; }); }
}

// ---------------------------------------------------------------------------------
// 3B görünüm
// ---------------------------------------------------------------------------------
let cube = null;
function host3() { return { toast: (m, o) => api.toast(m, o), esc, fmt, units: S.units || '', fileKey: S.fileKey, ui, onChange: () => { overlay3D(); refreshTiles(); statusMode3D(); } }; }
function enter3D() {
  const cv = $('cv3d');
  if (!v3) {
    try { v3 = new View3D(cv); } catch (e) { api.toast(t('v3Fail') + ': ' + e.message, { type: 'error' }); return; }
    bind3D(cv);
    v3.onChange = () => { overlay3D(); statusMode3D(); };
  }
  tools.cancel(); markActive(null);
  cv.hidden = false; document.body.classList.add('mode3d');
  resize3D();
  refresh3D();
  v3.fit({ animate: false }); v3.preset('iso', { animate: false }); v3.render();
  if (!cube) { try { cube = buildViewCube($('cube3d'), v3, host3()); } catch (e) { console.warn(e); cube = null; } }
  syncCube();
  api.toast(tileHint('3d'), 2200);
  rebuildRow('display'); rebuildRow('draw'); refreshTiles(); statusMode3D();
  D.refreshNav();
}
export function exit3D() {
  $('cv3d').hidden = true; document.body.classList.remove('mode3d'); ed.m3 = null; showPrompt(null);
  if (v3) v3.stopTurntable();
  const c3 = $('cube3d'); if (c3) c3.hidden = true;
  closePop();
  const p = $('displayPanel'); if (p && !p.hidden && p.querySelector('#displaySeg [data-seg="3d"].on')) D.closeDisplayOptions();
  rebuildRow('display'); rebuildRow('draw'); refreshTiles(); statusMode3D();
  api.drawOverlay();
  D.refreshNav();
}
function syncCube() { const c3 = $('cube3d'); if (!c3) return; c3.hidden = !(ed.is3D() && v3 && v3.opts.cube && cube); if (v3) c3.classList.toggle('below-hud', !!(v3.opts.hud && v3.opts.hudPos === 'tl')); if (!c3.hidden && cube) cube.update(); if (ed.is3D() && v3) overlay3D(); }
function resize3D() { const cv = $('cv3d'); const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * S.dpr); cv.height = Math.round(r.height * S.dpr); }
/*
 * 3B görünümün kaynağı HER ZAMAN Model uzayıdır: kâğıt düzeni tanımı gereği iki boyutludur,
 * gövde geometrisi Model'de durur. Kullanıcı bir pafta sekmesindeyken 3B'ye geçerse ekrandaki
 * çizim değişir; bu sessiz kalmamalı, bir kez söylenir.
 */
function refresh3D() {
  if (!v3) return;
  const model = S.scene.layouts[0];
  if (S.scene.layouts[S.layoutIndex] !== model && ed._3dLayoutWarned !== S.fileKey + ':' + S.layoutIndex) {
    ed._3dLayoutWarned = S.fileKey + ':' + S.layoutIndex;
    api.toast(tt('view3dModelOnly', '3B görünüm Model uzayını gösterir'), 3500);
  }
  const fadeLayers = new Set([...S.layers.values()].filter(l => l.faded).map(l => l.name));
  v3.setScene(model.prims, S.layers, { dark: S.dark, mono: S.mono, bg: bgColor(), fg: fgColor(), fade: S.fade.on && fadeLayers.size ? { pct: S.fade.pct, layers: fadeLayers } : null, selColor: S.selColor });
  v3.setSelection(ed.sel);
  if (!v3.counts.tris && typeof api.noFaces === 'function' && ed._noFaceKey !== S.fileKey) { ed._noFaceKey = S.fileKey; try { api.noFaces(); } catch (_) { /* geç */ } }
}
function render3D() { if (v3 && ed.is3D()) { v3.render(); overlay3D(); statusMode3D(); if (cube) cube.update(); } }
export function onResize() {
  if (!ed.is3D()) return;
  const k0 = v3._fitK(); resize3D(); const k1 = v3._fitK();
  if (k0 > 0 && isFinite(k1 / k0)) v3.cam.dist *= k1 / k0;   // dar kenar değişince sığdırma çarpanını taşı (döndürme)
  v3.render(); overlay3D();
}
export function onTheme() { if (ed.is3D()) { refresh3D(); v3.render(); overlay3D(); } }
const p3 = {
  pointers: new Map(), last: null, d0: 0, mid0: null, ang0: 0, moved: false,
  snap: null, snapKind: null, pts: [], lastTap: 0, lastTapAt: null,
  region: null,      // süren bölge seçimi (2B selDrag ile aynı biçim): { mode, pts, x0, y0, x1, y1, crossing, implied }
  aim: null,         // parmakla nişan: { sx, sy } — imleç parmağın altında, bırakınca nokta oraya işlenir
  aimTimer: 0,
};
/*
 * YAKALAMA İŞARETİ YALNIZ KOMUT SÜRERKEN DURUR. p3.snap bir komutun topladığı son noktayı
 * gösterir; komut bitince ya da iptal edilince işaret de kalkar. Temizlenmediği sürümde
 * (v7.83 ve öncesi) yeşil END karesi ekranda asılı kalıyor, kullanıcıya hâlâ bir şey
 * yakalanıyormuş gibi görünüyordu.
 */
function clearSnap3() { p3.snap = null; p3.snapKind = null; }
/*
 * ÜÇ BOYUTTA BÖLGE SEÇİMİ (v7.84). 2B'deki kuralın aynısı: soldan sağa sürükleme PENCERE
 * (tamamı içindekiler, mavi düz kenar), sağdan sola KESEN (değenler, yeşil kesik kenar).
 * Fark yalnız hesabın yerindedir: 2B'de kutu dünya koordinatındadır, 3B'de EKRANDADIR —
 * kullanıcının çizdiği çerçeve dünyada bir piramittir, bir dikdörtgen değil (bkz. sel3.js).
 *
 * Tek parmak bu sırada döndürmez, bölge çizer; döndürme iki parmakta durur. Boş yerden
 * başlayan sürükleme ÖRTÜK pencere açar (2B'deki gibi), nesnenin üstünden başlayan dokunuş
 * ise o nesneyi seçer.
 */
const bolgeAcik = () => !!(ed.m3 && ed.m3.name === 'select');
/** 3B bölge seçiminde hangi ilkeller aranır: görünür katmanda, gizlenmemiş, yol ya da ağ gövdesi */
const bolgeUygun = (q) => !!q && (q.k === 0 || q.k === 5) && !q.inf && objShown(q) && (() => { const l = S.layers.get(q.lay); return !l || l.visible; })();
function bolgeBaslat(sx, sy) {
  if (!bolgeAcik() || !v3) return false;
  const kip = ed.m3.selMode || 'tap';
  if (kip === 'box' || kip === 'lasso') { p3.region = { mode: kip, pts: [[sx, sy]], x0: sx, y0: sy, x1: sx, y1: sy, crossing: null }; return true; }
  if (pick3At(sx, sy)) return false;   // nesnenin üstü: dokunuş onu seçsin, kutu açılmasın
  p3.region = { mode: 'box', implied: true, pts: [[sx, sy]], x0: sx, y0: sy, x1: sx, y1: sy, crossing: null };
  return true;
}
function bolgeSurukle(sx, sy) {
  const d = p3.region; if (!d) return;
  d.x1 = sx; d.y1 = sy;
  if (d.mode === 'lasso') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(sx - l[0], sy - l[1]) > 3) d.pts.push([sx, sy]); }
  if (d.crossing == null && Math.abs(sx - d.x0) > 6) d.crossing = sx < d.x0;   // ilk yatay hareket karar verir
  overlay3D();
}
function iptalBolge() { if (p3.region) { p3.region = null; overlay3D(); } }
/** Sürüklenmemiş bölge: kutu 6 px'ten dar / alçak ya da çokgen üç noktadan az */
const bolgeKucuk = (d) => (d.mode === 'box' ? (Math.abs(d.x1 - d.x0) < 6 || Math.abs(d.y1 - d.y0) < 6) : d.pts.length < 3);
function bolgeBitir(d) {
  const model = S.scene && S.scene.layouts ? S.scene.layouts[0] : null;
  if (!model || !Array.isArray(model.prims)) return;
  const shape = d.mode === 'box' ? { rect: [d.x0, d.y0, d.x1, d.y1] } : { poly: d.pts.map(q => [q[0], q[1]]) };
  // project: kesit / kamera dışına düşen nokta GÖRÜNMÜYOR sayılır (snapHit3 ile aynı ölçüt).
  const izd = (x, y, z) => { const q = v3.project(x, y, z); return q && q[2] >= -1 && q[2] <= 1 ? q : null; };
  const res = regionPick3(model.prims, izd, shape, { crossing: d.crossing === true, visible: bolgeUygun });
  let n = 0;
  for (const p of res.prims) if (!ed.sel.has(p)) { ed.sel.add(p); n++; }
  api.toast(n ? `${n} ${t('selectedN')}` : t('selRegionNone'), 1400);
  if (n) haptic('snap');
  v3.setSelection(ed.sel); v3.render(); prompt3D();
}
/*
 * PARMAKLA NİŞAN ALMA — 3B (v7.84). 2B'de araç çalışırken uzun basış imleci parmağa bağlar
 * (app.js canAim); o koşulda `!editor.is3D()` yazdığı için 3B'de hiç yoktu ve kullanıcı
 * yakalamanın nereye oturacağını ancak dokunduktan SONRA görebiliyordu — başka bir nesneye
 * yaklaşınca işaretin oraya atlamamasının nedeni buydu. Artık nokta toplayan bir 3B komut
 * sürerken uzun basış nişanı açar: parmak gezdikçe yakalama yeniden hesaplanır, işaret komşu
 * nesneye atlar, parmak kalkınca nokta imlecin durduğu yere işlenir.
 */
const nisanAcik = () => !!(ed.m3 && ed.m3.name !== 'select');
function iptalNisan() { if (p3.aimTimer) { clearTimeout(p3.aimTimer); p3.aimTimer = 0; } if (nisanRaf) { cancelAnimationFrame(nisanRaf); nisanRaf = 0; } if (p3.aim) { p3.aim = null; overlay3D(); } }
function nisanKur(sx, sy, tur) {
  if (!nisanAcik() || !v3 || tur === 'mouse') return;
  clearTimeout(p3.aimTimer);
  p3.aimTimer = setTimeout(() => {
    p3.aimTimer = 0;
    if (p3.moved || p3.pointers.size !== 1 || !nisanAcik()) return;
    haptic('long'); nisanSurukle(sx, sy);
  }, ui.glove ? 600 : 500);
}
/*
 * Nişan hesabı KARE BAŞINA BİR KEZ yapılır. pointermove saniyede 60-120 kez gelir; her birinde
 * tam bir yakalama taraması (RTree sorgusu + osnap3) koşturmak kalabalık çizimde parmağı
 * geciktirirdi. 2B'deki hoverTick de aynı requestAnimationFrame kapısını kullanır.
 */
let nisanRaf = 0;
function nisanSurukle(sx, sy) {
  p3.aim = { sx, sy };
  if (nisanRaf) return;
  const hesapla = () => {
    nisanRaf = 0;
    if (!p3.aim || !v3) return;
    const onceki = ed.m3 && ed.m3.pts.length ? ed.m3.pts[ed.m3.pts.length - 1] : null;
    let hit = pick3At(p3.aim.sx, p3.aim.sy, onceki);
    if (!hit) { const sp = serbestNokta3(p3.aim.sx, p3.aim.sy, onceki); if (sp) hit = { p: sp, kind: 'free' }; }
    if (hit) { p3.snap = hit.p; p3.snapKind = hit.kind; } else clearSnap3();
    overlay3D();
  };
  // Sınama ortamında rAF kareyi beklemeden sonucu okuyabilmek için ilk hesap hemen yapılır;
  // ardışık hareketler kareye bağlanır.
  if (typeof requestAnimationFrame === 'function') { hesapla(); nisanRaf = requestAnimationFrame(() => { nisanRaf = 0; }); }
  else hesapla();
}
/** 3B dokunma: 1 parmak döndür/kaydır · 2 parmak yakınlaştır + kaydır (ya da döndür) · 3 parmak kaydır/döndür · çift dokunuş sığdır/yakınlaştır · tekerlek yakınlaştır */
function bind3D(cv) {
  const geom = () => { const a = [...p3.pointers.values()]; const n = a.length; let mx = 0, my = 0; for (const p of a) { mx += p[0]; my += p[1]; } mx /= n; my /= n; const d = n >= 2 ? Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) : 0; const ang = n >= 2 ? Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0]) : 0; return { n, mid: [mx, my], d, ang }; };
  const touch = () => v3.opts.touch;
  cv.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation(); cv.setPointerCapture(ev.pointerId);
    p3.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]); if (p3.pointers.size === 1) p3.moved = false;
    const g = geom(); p3.d0 = g.d; p3.mid0 = g.mid; p3.ang0 = g.ang;
    p3.last = [ev.clientX, ev.clientY];
    closePop();
    // İkinci parmak: bölge seçimi ve nişan bırakılır, jest yakınlaştırma / kaydırmaya döner.
    if (p3.pointers.size > 1) { iptalBolge(); iptalNisan(); return; }
    if (!ed.m3) clearSnap3();   // komut yokken eski yakalama işareti ekranda asılı kalmaz
    const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    if (bolgeBaslat(sx, sy)) return;
    nisanKur(sx, sy, ev.pointerType);
  });
  cv.addEventListener('pointermove', (ev) => {
    ev.stopPropagation();
    if (!p3.pointers.has(ev.pointerId)) return;
    p3.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const g = geom(), t = touch();
    const rr = cv.getBoundingClientRect(), msx = ev.clientX - rr.left, msy = ev.clientY - rr.top;
    if (g.n === 1 && p3.region) { bolgeSurukle(msx, msy); return; }
    if (g.n === 1 && p3.aim) { nisanSurukle(msx, msy); return; }
    if (g.n === 1) {
      const dx = ev.clientX - p3.last[0], dy = ev.clientY - p3.last[1];
      if (Math.hypot(dx, dy) > 2) { p3.moved = true; iptalNisan(); }   // parmak kaydı: uzun basış sayılmaz, jest döndürmedir
      if (p3.moved) { const sens = t.sensitivity || 1, iy = t.invertY ? -1 : 1; if (t.oneFinger === 'pan') v3.pan(dx, dy); else v3.orbit(dx * sens, dy * sens * iy); }
      p3.last = [ev.clientX, ev.clientY];
    } else if (g.n === 2) {
      p3.moved = true;
      if (p3.d0 > 0) v3.zoom(g.d / p3.d0);
      if (t.twoFinger === 'zoomrotate') { let da = g.ang - p3.ang0; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI; v3.cam.yaw += da; }
      v3.pan(g.mid[0] - p3.mid0[0], g.mid[1] - p3.mid0[1]);
      p3.d0 = g.d; p3.mid0 = g.mid; p3.ang0 = g.ang;
    } else if (g.n >= 3) {
      p3.moved = true;
      const dx = g.mid[0] - p3.mid0[0], dy = g.mid[1] - p3.mid0[1];
      if (t.threeFinger === 'orbit') v3.orbit(dx * (t.sensitivity || 1), dy * (t.sensitivity || 1) * (t.invertY ? -1 : 1)); else if (t.threeFinger === 'pan') v3.pan(dx, dy);
      p3.mid0 = g.mid;
    }
    v3.render(); overlay3D(); if (cube) cube.update(); statusMode3D();
  });
  const up = (ev) => {
    ev.stopPropagation();
    const had = p3.pointers.delete(ev.pointerId);
    if (had && p3.region && p3.pointers.size === 0) {
      /*
       * Parmak kıpırdamadıysa bu bir BÖLGE değil, bir DOKUNUŞTUR: jest yutulmaz, olağan yola
       * (çift dokunuşla sığdırma dâhil) bırakılır. Yutulsaydı Seç komutu açıkken çift dokunuş
       * çalışmaz olurdu — v7.84 taslağında böyleydi.
       */
      const d = p3.region; p3.region = null;
      if (ev.type === 'pointerup' && !bolgeKucuk(d)) { bolgeBitir(d); overlay3D(); return; }
      overlay3D();
    }
    if (had && p3.aim && p3.pointers.size === 0) {
      // Nişan bırakıldı: dokunuş, imlecin DURDUĞU yere işlenir (2B'deki gesture 'aim' ile aynı).
      const a = p3.aim; iptalNisan();
      if (ev.type === 'pointerup') tap3D(a.sx, a.sy);
      overlay3D(); return;
    }
    iptalNisan();
    if (had && !p3.moved && p3.pointers.size === 0 && ev.type === 'pointerup') {
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top, now = performance.now();
      if (p3.lastTapAt && now - p3.lastTap < 320 && Math.hypot(p3.lastTapAt[0] - sx, p3.lastTapAt[1] - sy) < 30) {
        const dt = touch().doubleTap; p3.lastTap = 0; p3.lastTapAt = null;
        if (dt === 'fit') { v3.fit({ animate: !ui.reduceMotion }); haptic('step'); } else if (dt === 'zoom') { v3.zoom(2); v3.render(); v3.pushHistory(); haptic('step'); }
        overlay3D(); refreshTiles(); return;
      }
      p3.lastTap = now; p3.lastTapAt = [sx, sy];
      tap3D(sx, sy);
    }
    if (had && p3.moved && p3.pointers.size === 0) { v3.pushHistory(); refreshTiles(); }
    if (p3.pointers.size >= 1) { const g = geom(); p3.last = [...p3.pointers.values()][0]; p3.d0 = g.d; p3.mid0 = g.mid; p3.ang0 = g.ang; p3.moved = true; }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); ev.stopPropagation(); v3.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15); v3.render(); overlay3D(); statusMode3D(); }, { passive: false });
}
/*
 * YAKALAMA ADAYLARI. Kalabalık bir çizimde her dokunuşta yüz binlerce parça taranamaz; ama
 * bütçeyle ilk N parçayı taramak da yanlıştır — liste sırası geometriye göre değildir, uzaktaki
 * bir parça yakındakinin önüne geçer. Doğru eleme şudur: 3B'de ekran dokunuşu bir NOKTA değil
 * bir IŞINDIR; ışının kot dilimindeki XY izdüşümü bir DOĞRU PARÇASIDIR. Model uzayının 2B
 * indeksinden (S.modelTree) o parçanın kutusu sorgulanır ve aday sayısı yüzlere iner.
 *
 * Üstten bakışta parça kısalır (neredeyse nokta), yandan bakışta modeli boydan boya keser —
 * ikisi de doğrudur: yandan bakan kullanıcı gerçekten de o doğrultudaki her şeyi görür.
 */
function nearPrims3(sx, sy, tolPx) {
  const model = S.scene && S.scene.layouts ? S.scene.layouts[0] : null;
  if (!model || !Array.isArray(model.prims) || !v3) return [];
  const all = model.prims, tree = S.modelTree;
  // Görünmeyen katman ve gizlenmiş nesne yakalanmaz: ekranda olmayan bir noktaya oturmak şaşırtır.
  const uygun = (q) => q && q.k === 0 && !q.inf && objShown(q) && (() => { const l = S.layers.get(q.lay); return !l || l.visible; })();
  if (!tree || all.length <= 3000) return all.filter(uygun);
  let r;
  try {
    const ray = v3.screenRay(sx, sy), o = ray.o, d = ray.d;
    const zs = v3.zScale || 1, zr = v3.zrange || [0, 0];
    const z0 = Math.min(zr[0], zr[1]) * zs, z1 = Math.max(zr[0], zr[1]) * zs;
    let t0, t1;
    if (Math.abs(d[2]) > 1e-12) { t0 = (z0 - o[2]) / d[2]; t1 = (z1 - o[2]) / d[2]; }
    else { t0 = 0; t1 = Math.max(1, v3.radius * 8); }     // yatay bakış: kot dilimi ışını sınırlamaz
    if (t1 < t0) { const w = t0; t0 = t1; t1 = w; }
    const ax = o[0] + d[0] * t0, ay = o[1] + d[1] * t0, bx = o[0] + d[0] * t1, by = o[1] + d[1] * t1;
    if (![ax, ay, bx, by].every(isFinite)) return all.filter(uygun);
    const m = Math.max(1e-9, tolPx * v3._worldPerPixel(v3.cam));
    r = [Math.min(ax, bx) - m, Math.min(ay, by) - m, Math.max(ax, bx) + m, Math.max(ay, by) + m];
  } catch (e) { console.warn(e); return all.filter(uygun); }
  const out = [];
  tree.search(r[0], r[1], r[2], r[3], (i) => { const q = all[i]; if (uygun(q)) out.push(q); });
  return out;
}
/** Üç boyutlu yakalama denemesi; kapalıysa ya da aday yoksa null (çağıran köşe / yüzey yoluna düşer) */
function snapHit3(sx, sy, tol, prev) {
  if (!snap3On() || !has('snap3') || !v3) return null;
  const list = nearPrims3(sx, sy, tol);
  if (!list.length) return null;
  const izd = (x, y, z) => { const q = v3.project(x, y, z); return q && q[2] >= -1 && q[2] <= 1 ? q : null; };
  const h = snap3(list, izd, sx, sy, { tol, modes: ui.snap3Modes, prev: prev || null });
  return h ? { p: h.p, prim: h.prim, kind: h.kind } : null;
}
/*
 * 3B'de nokta toplama, üç basamaklı bir merdivendir ve sıra ANLAMLILIKTAN ham veriye doğrudur:
 *   1) NESNE YAKALAMA — uç, orta, merkez, dik, en yakın (osnap3.js; açıksa ve kapı izin veriyorsa)
 *   2) KÖŞE           — sahnenin ham köşesi (eski davranış; kot ve tutamak işleri için kesin nokta)
 *   3) YÜZEY          — ışın-üçgen kesişimi; yüzeyin üstünde serbest nokta
 * 2. ve 3. basamak arasındaki tercih 'Hedef' ayarıdır (vertex / surface / auto) ve 'target3'
 * kapısına bağlıdır; kapı kapalıysa kip zorla 'vertex' olur, yani ücretsiz sürümde eski
 * davranış birebir korunur.
 *
 * prev, DİK (PER) yakalamanın taban noktasıdır: komut sırasında en son toplanan nokta.
 */
function pick3At(sx, sy, prev) {
  const kip = has('target3') ? (ui.pick3 || 'auto') : 'vertex';
  const tol = ui.glove ? 30 : 22;
  // Nesne yakalama önce gelir: uç / orta / merkez, ham köşeden daha ANLAMLI bir noktadır.
  const sn = snapHit3(sx, sy, tol, prev);
  if (sn) return sn;
  if (kip !== 'surface') {
    const h = v3.pickVertex(sx, sy, tol);
    if (h) return { p: h.p, prim: h.prim, kind: 'vtx' };
    if (kip === 'vertex') return null;
  }
  const s2 = v3.pickSurface(sx, sy);
  return s2 ? { p: s2.p, prim: s2.prim, kind: 'srf', n: s2.n } : null;
}
/*
 * SERBEST NOKTA (v7.85). 3B'de dokunuş eskiden yalnız bir KÖŞEYE, yüzeye ya da yakalama
 * noktasına oturabiliyordu; boş alana dokunmak "Bir köşeye dokunun" diyip reddediliyordu.
 * Oysa çizime yeni bir hat başlatmak çoğu zaman boşluktan başlar. Anahtar açıkken hiçbir
 * nesne tutmazsa dokunuş bir YATAY ÇALIŞMA DÜZLEMİYLE kesiştirilir.
 *
 * DÜZLEMİN KOTU KEYFİ DEĞİLDİR: komutun daha önce aldığı bir nokta varsa onun kotudur
 * (aynı kotta devam etmek en sık istenen davranıştır), yoksa EKRANDA GÖRÜNEN zemin
 * ızgarasının kotudur (v3.gridZ). Böylece kullanıcı noktanın nereye düştüğünü tahmin etmez,
 * bakarak görür.
 *
 * Işın uzayı: view3d._eye kotu zScale ile çarpar (dünya XY, ÖLÇEKLİ Z). Düzlem sınaması da
 * o uzayda yapılır, dönen nokta dünya kotuna geri çevrilir.
 */
function serbestNokta3(sx, sy, onceki) {
  if (!v3 || !ui.free3 || !has('free3')) return null;
  let ray; try { ray = v3.screenRay(sx, sy); } catch (e) { console.warn(e); return null; }
  if (!ray || !ray.o || !ray.d) return null;
  const zs = v3.zScale || 1;
  const zw = onceki && isFinite(onceki[2]) ? onceki[2] : (v3.gridZ != null ? v3.gridZ : (v3.bb ? v3.bb[2] : 0));
  if (Math.abs(ray.d[2]) < 1e-12) return null;      // düzleme tam paralel bakış: kesişim yok
  const tt = (zw * zs - ray.o[2]) / ray.d[2];
  if (!isFinite(tt) || tt <= 0) return null;        // düzlem kameranın arkasında
  const p = [ray.o[0] + ray.d[0] * tt, ray.o[1] + ray.d[1] * tt, zw];
  return p.every(isFinite) ? p : null;
}
/** Serbest nokta kapalıyken reddeden iletiye karonun yolu eklenir: kullanıcı nasıl açacağını okusun */
const serbestYolu = () => t('tabDraw') + ' ▸ ' + tileLabel('free3');
function tap3D(sx, sy) {
  /*
   * BİLGİ SATIRINA DOKUNUŞ ONU GİZLER. Kutu tuvale çizilir, DOM düğmesi değildir; bu yüzden
   * vuruş denetimi burada yapılır. Geri getirmek Ekran ▸ 3B seçenekleri ▸ Bilgi satırı
   * karosundadır ve ileti bunu söyler — kullanıcı kapattığı şeyi geri açamaz durumda kalmasın.
   */
  if (v3 && v3.opts && v3.opts.hud && v3._hudBox) {
    const b = v3._hudBox;
    /*
     * KUTU KÜÇÜLDÜ, HEDEF KÜÇÜLMEDİ (v7.83). Yoğun kipte kutu 16 px yüksekliğe iner; o,
     * komut çubuğunda tutulan tabanın — WCAG 2.2 AA Target Size (Minimum), 24 px — altındadır.
     * Görünen kutu küçük kalır (kullanıcı yeri bunun için istedi) ama vuruş bandı dikeyde
     * 24 px'e tamamlanır. Eldiven kipinde kutunun kendisi zaten büyük çizilir.
     */
    const py = Math.max(0, (24 - b.h) / 2);
    if (sx >= b.x && sx <= b.x + b.w && sy >= b.y - py && sy <= b.y + b.h + py) {
      v3.set('hud', false); syncCube();
      haptic('toggle'); refreshTiles(); render3D();
      api.toast(t('hudHidden').replace('%s', geriYolu('hud3')), 3200);
      return;
    }
  }
  // DİK (PER) yakalama bir taban noktası ister: komut sırasında en son toplanan nokta odur.
  const oncekiNokta = ed.m3 && ed.m3.pts.length ? ed.m3.pts[ed.m3.pts.length - 1] : null;
  let hit = pick3At(sx, sy, oncekiNokta);
  if (!ed.m3) {
    ed.sel.clear();
    if (hit) { ed.sel.add(hit.prim); api.showInfo(hit.prim); haptic('snap'); } else api.hide('infoPanel');
    v3.setSelection(ed.sel); v3.render(); overlay3D();
    return;
  }
  const m = ed.m3;
  if (m.name === 'select') { if (hit) { if (ed.sel.has(hit.prim)) ed.sel.delete(hit.prim); else ed.sel.add(hit.prim); prompt3D(); haptic('snap'); } v3.setSelection(ed.sel); v3.render(); overlay3D(); return; }
  let vurus = hit;
  if (!vurus) {
    const sp = serbestNokta3(sx, sy, oncekiNokta);
    if (sp) vurus = { p: sp, prim: null, kind: 'free' };
  }
  if (!vurus) {
    // Reddeden ileti, açma yolunu da söyler: kullanıcı neden konamadığını ve nasıl izin vereceğini okusun.
    const temel = has('target3') && (ui.pick3 || 'auto') !== 'vertex' ? t('tapVertexOrSurface') : t('tapVertex');
    api.toast(has('free3') ? temel + ' · ' + serbestYolu() : temel, 3200);
    return;
  }
  hit = vurus;
  p3.snap = hit.p; p3.snapKind = hit.kind; haptic('snap');
  m.pts.push(hit.p);
  if (m.name === 'dist' && m.pts.length === 2) {
    const [a, b] = m.pts; const dh = Math.hypot(b[0] - a[0], b[1] - a[1]), dz = b[2] - a[2], d3 = Math.hypot(dh, dz), u = S.units ? ' ' + S.units : '';
    showResult([[t('dist3'), fmt(d3) + u], [t('horizontal'), fmt(dh) + u], ['ΔZ', fmt(dz) + u], [t('slope'), dh > 0 ? fmt(dz / dh * 100, 2) + ' %  (' + fmt(dz / dh * 1000, 1) + ' ‰)' : '–'], [t('point1'), a.map(v => fmt(v)).join(' ; ')], [t('point2'), b.map(v => fmt(v)).join(' ; ')]]);
    m.pts = [];
  } else if (m.name === 'move' && m.pts.length === 2) {
    const [a, b] = m.pts; const keys = [...ed.sel].map(p => p.key);
    if (keys.length) { doc.run({ op: 'xform', keys, m: [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], dz: b[2] - a[2] }); refreshUndo(); api.toast(t('moved')); }
    ed.sel.clear(); ed.m3 = null; showPrompt(null); markActive(null);
    if (keys.length) refresh3D(); else v3.setSelection(ed.sel);   // sahne yalnız taşıma bitince yeniden kurulur
  } else if (m.name === 'line') {
    /*
     * ÇİZGİ (3B). AutoCAD'in LINE'ı gibi zincirlemedir: her yeni nokta bir öncekiyle ayrı bir
     * LINE varlığı kurar ve komut Bitir'e kadar sürer. POLYLINE3D değil LINE üretilir — kullanıcı
     * "çizgi" dediğinde tek parça beklemez, birbirinden ayrı çizilebilen doğrular bekler.
     */
    if (m.pts.length >= 2) {
      const a = m.pts[m.pts.length - 2], b = m.pts[m.pts.length - 1];
      doc.run({ op: 'add', ents: [{ type: 'LINE', pts: [a.slice(), b.slice()], id: newId(), layer: ed.curLayer, color: ed.curColor }] });
      refreshUndo(); refresh3D();
    }
  } else if (m.name === 'copy' && m.pts.length === 2) {
    const [a, b] = m.pts; const keys = [...ed.sel].map(q => q.key);
    if (keys.length) { doc.run({ op: 'copy', keys, newKeys: keys.map(() => newId()), m: [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], dz: b[2] - a[2] }); refreshUndo(); api.toast(t('copied3')); }
    ed.sel.clear(); ed.m3 = null; showPrompt(null); markActive(null);
    if (keys.length) refresh3D(); else v3.setSelection(ed.sel);
  } else if (m.name === 'mirror' && m.pts.length === 2) {
    // Ayna DÜZLEMİ: iki noktadan geçen DÜŞEY düzlem. Kotlar korunur, XY yansır — MIRROR3D'nin
    // en çok kullanılan hâli budur ve tek bir 2B afin matrisle tam olarak ifade edilir.
    const [a, b] = m.pts; const keys = [...ed.sel].map(q => q.key);
    if (keys.length && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) { doc.run({ op: 'xform', keys, m: mirrorM(a, b) }); refreshUndo(); api.toast(t('mirrored3')); }
    else if (keys.length) api.toast(t('mirror3Vertical'), { type: 'warn' });
    ed.sel.clear(); ed.m3 = null; showPrompt(null); markActive(null);
    if (keys.length) refresh3D(); else v3.setSelection(ed.sel);
  } else if ((m.name === 'rotate' || m.name === 'scale') && m.pts.length === 1) {
    void xform3Step();
    return;
  } else if (m.name === 'geo') {
    void geoStep();
    return;
  } else if (m.name === 'note') {
    void noteStep(hit.p);
    return;
  } else if (m.name === 'pline') { /* Bitir ile tamamlanır */ }
  prompt3D();
  v3.render(); overlay3D();
}
/** Çizim birimine göre öntanımlı yazı yüksekliği (araç yöneticisiyle aynı ölçüt) */
const textH = () => Math.max(1e-6, (S.ext ? (S.ext[2] - S.ext[0]) : 100) / 200);
/**
 * Dışarıdan (app.js) açıklama eklemek: ölçüm sonucunu çizime işleme, 3B açıklama, PDF→CAD çıktısı.
 * Kimlik, katman ve renk burada verilir; çağıranın bunları bilmesi gerekmez.
 */
ed.addEnts = (ents) => {
  if (!doc || !ents || !ents.length) return false;
  // Gelen grup kimlikleri YENİLENİR (aynı gid aynı yeni gid'e): panodan iki kez yapıştırılan ölçü iki ayrı
  // grup olsun — aynı kimliği paylaşsalar biri düzenlenince ikisi birden tek ölçüye yeniden kurulurdu
  const gmap = new Map();
  const gidOf = (g) => { if (!g) return undefined; if (!gmap.has(g)) gmap.set(g, newId()); return gmap.get(g); };
  const list = ents.filter(Boolean).map(e => ({ ...e, id: newId(), ...(e.gid ? { gid: gidOf(e.gid) } : {}), layer: e.layer || ed.curLayer, color: e.color == null ? ed.curColor : e.color }));
  if (!list.length) return false;
  const ok = doc.run({ op: 'add', ents: list });
  refreshUndo(); api.requestRender();
  if (ed.is3D()) { refresh3D(); if (v3) v3.render(); }
  return ok;
};
/** Lider (ok + kırık çizgi + yazı) ekler; pts en az iki nokta */
ed.addAnnot = (pts, text) => {
  const r = leaderEnts(pts, text, { h: textH() * 2.2, layer: ed.curLayer, color: ed.curColor, gid: newId() });
  return r ? ed.addEnts(r.ents) : false;
};
/** Ham komut çalıştırma (bul-değiştir, blok yapıştırma): geri alma yığını ve çizim tazelenir */
ed.runCmd = (cmd) => {
  if (!doc) return false;
  const ok = doc.run(cmd);
  refreshUndo(); api.requestRender();
  if (ed.is3D()) { refresh3D(); if (v3) v3.render(); }
  return ok;
};
/** Geçerli seçim (app.js panelleri için) */
ed.selection = () => [...ed.sel];
ed.setSelection = (list) => { ed.sel.clear(); for (const p of list || []) ed.sel.add(p); if (ed.is3D() && v3) v3.setSelection(ed.sel); api.drawOverlay(); };
ed.textHeight = textH;

/** Önce nesne seçimi isteyen 3B araçları (AutoCAD'de de "Select objects:" ilk istemdir) */
const SEC3 = new Set(['move', 'copy', 'rotate', 'scale', 'mirror', 'setz', 'del']);
async function start3DTool(name) {
  if (!gate('3:' + name)) { markActive(null); return; }
  clearSnap3(); iptalBolge();
  ed.m3 = { name, pts: [], selMode: 'tap' };
  // Seçime uygulanan araçlar: seçim yoksa komut hiç başlamaz (AutoCAD'de de "Select objects:"
  // ilk istemdir). Bu kapı setz / del'den ÖNCEDİR — sonra olsaydı boş seçimle kutu açılır,
  // silinecek nesne olmadan "Silindi" denirdi.
  if (SEC3.has(name) && !ed.sel.size) { api.toast(t('select3First')); ed.m3 = null; markActive(null); return; }
  if (name === 'setz') {
    const v = await askText(t('zPrompt'), '', { type: 'number' }); const z = parseFloat(String(v || '').replace(',', '.'));
    if (isFinite(z)) { doc.run({ op: 'setz', keys: [...ed.sel].map(p => p.key), z }); refreshUndo(); refresh3D(); v3.render(); api.toast(t('zSet')); }
    ed.m3 = null; markActive(null); return;
  }
  if (name === 'del') {
    doc.run({ op: 'delete', keys: [...ed.sel].map(p => p.key) }); ed.sel.clear(); refreshUndo(); refresh3D(); v3.render(); overlay3D(); api.toast(t('deleted')); ed.m3 = null; markActive(null); return;
  }
  if (name === 'geo') {
    const M = await geoMod();
    if (!M) { ed.m3 = null; markActive(null); return; }
    const res = await askForm(t('geo3Title'), [{ id: 'mode', label: t('geo3Mode'), type: 'select', value: geoLast, options: M.MODES.map(m => [m.id, t('geo3_' + m.id)]) }], { ok: t('ok') });
    if (!res) { ed.m3 = null; markActive(null); return; }
    geoLast = res.mode;
    const md = M.MODES.find(x => x.id === res.mode);
    ed.m3 = { name: 'geo', mode: res.mode, pts: [], need: M.needsOf(res.mode), min: md ? md.min : M.needsOf(res.mode) };
  }
  prompt3D();
}
/*
 * DÖNDÜR / ÖLÇEKLE (3B). Taban noktası üç boyutlu yakalamayla alınır, değer yazılır.
 *
 * NEDEN İKİNCİ NOKTAYLA DEĞİL: 3B'de ekrana dokunulan ikinci nokta bir açıyı tek anlamlı
 * belirlemez — aynı piksel, kameranın arkasındaki ve önündeki sonsuz noktaya karşılık gelir.
 * AutoCAD bu yüzden 3DROTATE'te bir eksen tutamağı gösterir; burada eksen Z'dir (geçerli UCS)
 * ve açı derece olarak yazılır: tek anlamlı, ölçülebilir, geri alınabilir.
 *
 * Ölçek üç eksende birliktedir: kot da aynı çarpanla büyür (edit.transformPrim'in zs'i). Taban
 * noktasının yerinde kalması için kot ötelemesi dz = z0 * (1 - s) verilir.
 */
async function xform3Step() {
  const m = ed.m3; if (!m || !m.pts.length) return;
  const c0 = m.pts[0], donme = m.name === 'rotate';
  const keys = [...ed.sel].map(q => q.key);
  const v = await askText(t(donme ? 'rot3Prompt' : 'scale3Prompt'), donme ? '' : '1', { type: 'number' });
  const iptal = v == null || String(v).trim() === '';
  const n = parseFloat(String(iptal ? '' : v).replace(',', '.'));
  const gecerli = isFinite(n) && (donme ? n !== 0 : n > 0);
  let uygulandi = false;
  if (keys.length && gecerli) {
    const cmd = donme
      ? { op: 'xform', keys, m: rotM(c0, n * Math.PI / 180) }
      : { op: 'xform', keys, m: [n, 0, 0, n, c0[0] - n * c0[0], c0[1] - n * c0[1]], dz: (c0[2] || 0) * (1 - n), zs: n };
    uygulandi = doc.run(cmd) === true;
    if (uygulandi) { refreshUndo(); api.toast(t(donme ? 'rotated3' : 'scaled3')); }
  } else if (keys.length && !iptal) api.toast(t(donme ? 'rot3Bad' : 'scale3Bad'), { type: 'warn' });
  // İPTAL SEÇİMİ SİLMEZ: kullanıcı yanlış sayı yazdıysa ya da vazgeçtiyse nesneleri yeniden
  // seçmek zorunda kalmasın (AutoCAD'de de iptal edilen komut seçimi bozmaz).
  if (uygulandi) ed.sel.clear();
  ed.m3 = null; showPrompt(null); markActive(null);
  if (uygulandi) refresh3D(); else if (v3) v3.setSelection(ed.sel);
  if (v3) { v3.render(); overlay3D(); }
}
/** 3B ölçüm çekirdeği yalnız kullanıldığında yüklenir */
let geoM = null, geoLast = 'ptline';
async function geoMod() {
  if (geoM) return geoM;
  try { geoM = await import('./measure3d.js'); } catch (e) { console.warn(e); api.toast(t('error'), { type: 'error' }); return null; }
  return geoM;
}
/** 3B ölçüm sonucunu satırlara çevirir: modül i18n ANAHTARI verir, metni burada kurarız */
function geoRows(res) {
  const u = S.units ? ' ' + S.units : '';
  const out = [];
  for (const [key, val, kind] of res.rows || []) {
    const label = t(key);
    if (val == null) { out.push([label, '\u2013']); continue; }
    if (kind === 'deg') out.push([label, fmt(val, 2) + '\u00b0']);
    else if (kind === 'bool') out.push([label, val ? t('yes') : t('no')]);
    else if (kind === 'pt') out.push([label, Array.isArray(val) ? val.map(v => fmt(v)).join(' ; ') : String(val)]);
    else out.push([label, fmt(val) + u]);
  }
  return out;
}
/** Yeterli nokta toplandıysa ölçümü hesaplar ve gösterir; yoksa istem güncellenir */
async function geoStep() {
  const m = ed.m3; if (!m || m.name !== 'geo') return;
  const M = await geoMod(); if (!M) return;
  // 'smartangle' en az üç noktayla (tepe açısı) sonuç verir, dördüncüyle (iki doğru arası açı)
  // sonucu tazeler: min'e ulaşınca gösterilir, need'e ulaşınca noktalar sıfırlanır
  if (m.pts.length < (m.min || m.need)) { prompt3D(); v3.render(); overlay3D(); return; }
  const res = M.compute(m.mode, m.pts.slice());
  if (!res) api.toast(t('geo3Degenerate'), { type: 'warn' });
  else showResult([[t('geo3Mode'), t('geo3_' + m.mode)], ...geoRows(res)]);
  m.guides = res && typeof M.guides === 'function' ? M.guides(m.mode, m.pts.slice()) : null;
  if (m.pts.length >= m.need) m.pts = [];
  prompt3D(); v3.render(); overlay3D();
}
/** 3B açıklama: seçilen köşeye ok başlı etiket konur (etiket o köşenin kotundadır) */
async function noteStep(p) {
  const m = ed.m3; if (!m) return;
  const txt = await askText(t('note3Prompt'), '', { words: true });
  if (txt) {
    const d = Math.max(1e-6, (S.ext ? (S.ext[2] - S.ext[0]) : 100) / 30);
    ed.addAnnot([[p[0], p[1], p[2]], [p[0] + d, p[1] + d, p[2]]], txt);
    api.toast(txt.slice(0, 40));
  }
  m.pts = [];
  prompt3D(); if (v3) v3.render(); overlay3D();
}
function prompt3D() {
  const m = ed.m3; if (!m) return;
  // Altı noktalı düzlem-düzlem ölçümünde "köşelere dokunun" yetmez: hangi parçanın kaçıncı
  // noktasını verdiğini söylemek gerekir. measure3d.stepOf bunu üretiyordu ama hiç çağrılmıyordu.
  const adim = m.name === 'geo' && geoM && geoM.stepOf ? geoM.stepOf(m.mode, m.pts.length) : null;
  // Dokunuşun neye oturacağı HER komutta yazar: kullanıcı yakalamanın açık olup olmadığını
  // denemeden görsün (2B'deki durum çubuğu kipleriyle aynı okuma).
  const hedef = (has('target3') && (ui.pick3 || 'auto') !== 'vertex' ? ' · ' + t(PICK3.find(x => x[0] === (ui.pick3 || 'auto'))[1]) : '')
    + (snap3On() && has('snap3') ? ' · ' + ui.snap3Modes.map(id => id.toUpperCase()).join(' ') : '')
    + (ui.free3 && has('free3') ? ' · ' + tileLabel('free3') : '');
  const txt = m.name === 'geo'
    ? `${t('geo3_' + m.mode)} · ` + (adim
      ? `${t(adim.part)} · ${adim.index + 1}. ${t('pointsN')}${adim.optional ? ' (' + t('optionalPt') + ')' : ''} [${m.pts.length}/${m.need}]`
      : `${t('geo3Pick')} [${m.pts.length}/${m.need}]`)
    : m.name === 'note' ? t('p3Note')
      : {
        select: `${t('p3Select')} [${ed.sel.size} ${t('selCount')}] · ${m.selMode === 'lasso' ? t('selLassoHint') : m.selMode === 'box' ? t('selBoxHint') : `\u2192 ${t('selWindowLbl')}  \u2190 ${t('selCrossingLbl')}`}`,
        dist: m.pts.length ? t('p3Dist2') : t('p3Dist1'),
        move: m.pts.length ? t('p3Move2') : t('p3Move1'),
        copy: m.pts.length ? t('p3Copy2') : t('p3Copy1'),
        rotate: t('p3Rot1'),
        scale: t('p3Scale1'),
        mirror: m.pts.length ? t('p3Mirror2') : t('p3Mirror1'),
        line: `${m.pts.length ? t('p3Line2') : t('p3Line1')} [${Math.max(0, m.pts.length - 1)} ${t('segmentsN')}]`,
        pline: `${t('p3Pline')} [${m.pts.length} ${t('pointsN')}] · ${t('finish')}`,
      }[m.name];
  // 3B istemi çubuğu showPrompt'tan GEÇMEDEN kurar; "boşta" bayrağı elle kapatılmazsa burada
  // yazılan koordinat komut adı sanılır ve 3B polyline'a nokta eklenemez.
  cmdIdle = false; closeSuggest();
  $('cmdBar').hidden = false; $('cmdText').textContent = txt + (m.name === 'select' ? '' : hedef);
  $('cmdInput').hidden = !TYPE3.has(m.name); $('cmdInput').placeholder = 'x,y,z';
  $('cmdBtns').innerHTML = (TYPE3.has(m.name) ? cmdBtnHtml('data-cmd3', 'finish', t('finishBtn')) : '')
    + (m.name === 'select' ? cmdBtnHtml('data-cmd3', 'selbox', t('selBoxBtn')) + cmdBtnHtml('data-cmd3', 'sellasso', t('selLassoBtn')) : '')
    + (m.pts.length ? cmdBtnHtml('data-cmd3', 'back', t('backBtn')) : '') + cmdBtnHtml('data-cmd3', 'cancel', t('cancelBtn'));
  $('cmdBtns').onclick = (ev) => {
    const b = ev.target.closest('[data-cmd3]'); if (!b) return;
    const k = b.dataset.cmd3;
    if (k === 'cancel') { ed.m3 = null; clearSnap3(); iptalBolge(); showPrompt(null); markActive(null); overlay3D(); }
    else if (k === 'selbox' || k === 'sellasso') {
      // Aynı düğmeye ikinci dokunuş kipi kapatır: dokunarak seçime dönülür (2B ile aynı).
      const kip = k === 'selbox' ? 'box' : 'lasso';
      m.selMode = m.selMode === kip ? 'tap' : kip; haptic('toggle'); prompt3D();
    }
    else if (k === 'back') {
      // Çizgi zincirinde son nokta son PARÇAYI yazmıştı: nokta geri alınırken o da geri alınır.
      if (m.name === 'line' && m.pts.length >= 2 && doc && doc.undo()) { refreshUndo(); refresh3D(); if (v3) v3.render(); }
      m.pts.pop(); prompt3D(); overlay3D();
    }
    else if (k === 'finish') {
      // ÇİZGİ parçalarını dokunuş anında yazar (zincir), POLYLINE tek varlığı bitişte yazar.
      if (m.name === 'pline' && m.pts.length >= 2) { doc.run({ op: 'add', ents: [{ type: 'POLYLINE3D', pts: m.pts.slice(), id: newId(), layer: ed.curLayer, color: ed.curColor }] }); refreshUndo(); refresh3D(); v3.render(); api.toast(t('pline3Added')); }
      else if (m.name === 'line' && m.pts.length >= 2) api.toast(t('line3Added').replace('%s', String(m.pts.length - 1)));
      m.pts = []; ed.m3 = null; showPrompt(null); markActive(null); overlay3D();
    }
  };
}
/** Koordinat yazılarak nokta verilebilen 3B araçları (Çizgi ve Polyline) */
const TYPE3 = new Set(['line', 'pline']);
function typed3D(v) {
  const m = ed.m3; if (!m || !TYPE3.has(m.name)) return;
  const parts = v.split(/[;,\s]+/).map(x => parseFloat(x.replace(',', '.'))).filter(x => isFinite(x));
  if (parts.length < 2) { api.toast(t('typeXyz')); return; }
  m.pts.push([parts[0], parts[1], parts[2] || 0]);
  // Yazılan nokta da dokunulan nokta gibidir: çizgi zinciri hemen bir parça yazar.
  if (m.name === 'line' && m.pts.length >= 2) {
    const a = m.pts[m.pts.length - 2], b = m.pts[m.pts.length - 1];
    doc.run({ op: 'add', ents: [{ type: 'LINE', pts: [a.slice(), b.slice()], id: newId(), layer: ed.curLayer, color: ed.curColor }] });
    refreshUndo(); refresh3D(); if (v3) v3.render();
  }
  prompt3D(); overlay3D();
}
/** 3B üstüne 2B kaplama: HUD (kamera, eksen etiketleri, lejant, pusula), toplanan noktalar, yakalama işareti */
function overlay3D() {
  if (!ed.is3D()) return;
  const ov = $('ov'), c = ov.getContext('2d');
  c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); c.clearRect(0, 0, S.W, S.H);
  try { v3.drawHud(c, { fg: fgColor(), W: S.W, H: S.H, units: S.units || '', fmt, sel: ed.sel, gestureActive: S.gestureActive, fontScale: ui.fontScale, dense: ui.denseBars !== false && !ui.glove }); } catch (e) { console.warn(e); }
  c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  const acc = S.selColor || '#ff9f0a';
  c.font = `${Math.round(11 * ui.fontScale)}px sans-serif`; c.textBaseline = 'top'; c.textAlign = 'left';
  if (ed.m3 && ed.m3.pts.length) {
    c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = 2;
    const ps = ed.m3.pts.map(p => v3.project(p[0], p[1], p[2]));
    c.beginPath(); ps.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    ps.forEach((p, i) => { c.beginPath(); c.arc(p[0], p[1], 5, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.fillText(String(i + 1), p[0] + 7, p[1] - 7); c.fillStyle = acc; });
  }
  if (ed.m3 && ed.m3.name === 'geo' && ed.m3.guides && ed.m3.guides.length) {
    // ölçülen dikme / izdüşüm: kesik çizgi, seçim renginden ayrı dursun diye yeşil
    c.save(); c.strokeStyle = '#3ddc84'; c.lineWidth = 2; c.setLineDash([6, 4]);
    for (const g of ed.m3.guides) {
      if (!g || g.length < 2) continue;
      const a = v3.project(g[0][0], g[0][1], g[0][2]), b = v3.project(g[1][0], g[1][1], g[1][2]);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    }
    c.restore();
  }
  /*
   * YAKALANAN NOKTA. Ham köşe karedir, yüzey noktası çemberdir; NESNE YAKALAMA kipleri ise
   * 2B'nin kendi işaretleriyle (osnap.drawMarker) çizilir — END karesi, MID üçgeni, CEN çemberi,
   * PER dik açısı, NEA kum saati. Kullanıcı aynı simgeyi iki boyutta öğrendi; üç boyutta yeni
   * bir dil öğrenmek zorunda kalmasın. Kısaltma da yazılır: neye oturduğu okunabilir olsun.
   */
  if (p3.snap && ed.m3) {
    const s = v3.project(p3.snap[0], p3.snap[1], p3.snap[2]);
    const k = p3.snapKind;
    c.save();
    c.strokeStyle = '#3ddc84'; c.fillStyle = '#3ddc84'; c.lineWidth = 2;
    if (k === 'free') {
      // Serbest nokta bir nesneye değil ÇALIŞMA DÜZLEMİNE oturur; yakalama işaretlerinden
      // ayrı dursun diye artı imleçle gösterilir, kısaltma yazılmaz.
      c.beginPath(); c.moveTo(s[0] - 9, s[1]); c.lineTo(s[0] + 9, s[1]); c.moveTo(s[0], s[1] - 9); c.lineTo(s[0], s[1] + 9); c.stroke();
      c.beginPath(); c.arc(s[0], s[1], 3.5, 0, Math.PI * 2); c.stroke();
    } else if (k === 'srf') { c.beginPath(); c.arc(s[0], s[1], 7, 0, Math.PI * 2); c.stroke(); }
    else if (k && k !== 'vtx') {
      snapMarker(c, s[0], s[1], k, 8);
      c.font = `${Math.round(10 * ui.fontScale)}px sans-serif`; c.textBaseline = 'bottom'; c.textAlign = 'left';
      c.fillText(k.toUpperCase(), s[0] + 11, s[1] - 9);
    } else c.strokeRect(s[0] - 7, s[1] - 7, 14, 14);
    c.restore();
  }
  drawSelDrag(c, p3.region);
}
/** Kamera yer imleri (#docPanel içinde #camName / #camSave) */
function showBookmarks() {
  if (!needModel()) return;
  if (!ed.is3D()) enter3D();
  if (!v3) return;
  api.openDoc(tt('cam3Title', '3B yer imleri'), '<div class="full" id="camBody"></div>');
  const h = openCameraBookmarks(v3, $('camBody'), host3());
  const panel = $('docPanel');
  const mo = new MutationObserver(() => { if (panel.hidden) { call(h.destroy); mo.disconnect(); } });
  mo.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
}

// ---------------------------------------------------------------------------------
// Alt sayfa tutamakları (sürükleyerek kapat / büyüt), yan panel sekmeleri
// ---------------------------------------------------------------------------------
export function sheetInit() {
  document.querySelectorAll('.panel.bottom').forEach(panel => {
    if (panel.querySelector('.sheet-handle')) return;
    const h = document.createElement('div'); h.className = 'sheet-handle'; h.setAttribute('aria-hidden', 'true');
    panel.insertBefore(h, panel.firstChild);
    panel.dataset.detent = 'half';
    let st = null;
    h.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); try { h.setPointerCapture(ev.pointerId); } catch (_) { /* yok */ } st = { y0: ev.clientY, t0: performance.now(), dy: 0 }; panel.classList.add('dragging'); });
    h.addEventListener('pointermove', (ev) => { if (!st) return; st.dy = ev.clientY - st.y0; if (st.dy > 0) panel.style.transform = `translateY(${st.dy}px)`; else panel.style.transform = ''; });
    const end = (ev) => {
      if (!st) return; const dy = st.dy, dt = performance.now() - st.t0; st = null;
      panel.classList.remove('dragging'); panel.style.transform = '';
      if (dy > 90 || (dy > 30 && dt < 250)) { closeSheet(panel); haptic('step'); }
      else if (dy < -50) { panel.dataset.detent = 'full'; haptic('step'); }
      else if (Math.abs(dy) < 6 && ev.type === 'pointerup') { panel.dataset.detent = panel.dataset.detent === 'full' ? 'half' : 'full'; }
    };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    const mo = new MutationObserver(() => { if (panel.hidden) panel.dataset.detent = 'half'; });
    mo.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  });
}
function closeSheet(panel) {
  const btn = panel.querySelector('.panel-head [data-close], .panel-head .close');
  if (btn) { btn.click(); return; }
  if (panel.id === 'displayPanel') D.closeDisplayOptions(); else api.hide(panel.id);
}
function bindSideTabs() {
  const tabs = $('sideTabs'); if (!tabs) return;
  tabs.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-side]'); if (!b) return;
    if (b.dataset.side === 'layers') { if ($('layerPanel').hidden) $('btnLayers').click(); }
    else { dockDisplay(); call(api.openDisplayOptions); }
    syncSide();
  });
  window.addEventListener('dwg:display-open', () => { dockDisplay(); syncSide(); });
  const mo = new MutationObserver(syncSide);
  for (const id of ['layerPanel', 'displayPanel', 'side']) { const el = $(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); }
}
/** Geniş ekranda #displayPanel'i #side'a taşır; dar ekranda geri getirir */
function dockDisplay() {
  const p = $('displayPanel'), side = $('side'); if (!p || !side) return;
  if (wideMq.matches) { if (p.parentElement !== side) side.appendChild(p); }
  else if (p.parentElement === side) $('app').appendChild(p);
}
let syncing = false;
function syncSide() {
  if (syncing) return; syncing = true;
  try {
    const side = $('side'), lp = $('layerPanel'), dp = $('displayPanel');
    if (!side) return;
    if (!wideMq.matches) { if (dp && dp.parentElement === side) $('app').appendChild(dp); return; }
    const lIn = lp && lp.parentElement === side && !lp.hidden, dIn = dp && dp.parentElement === side && !dp.hidden;
    if (lIn && dIn && !lp.hidden) lp.hidden = true;
    const open = (lp && lp.parentElement === side && !lp.hidden) || (dp && dp.parentElement === side && !dp.hidden);
    if (side.hidden !== !open) side.hidden = !open;   // aynı değeri yazmak da mutasyon kaydı üretir → döngü olmasın
    document.querySelectorAll('#sideTabs [data-side]').forEach(b => b.classList.toggle('on', b.dataset.side === 'display' ? !!(dp && !dp.hidden && dp.parentElement === side) : !!(lp && !lp.hidden && lp.parentElement === side)));
  } finally { syncing = false; }
}

// ---------------------------------------------------------------------------------
// Erişilebilirlik bölümü (Ayarlar içine gömülür)
// ---------------------------------------------------------------------------------
export function accessibilitySection() {
  const sw = (key, label) => `<div class="opt-row"><span class="opt-lb">${esc(label)}</span><label class="switch"><input type="checkbox" data-key="${key}" ${ui[key] ? 'checked' : ''}><span class="knob"></span></label></div>`;
  const html = `<div class="opt-sec a11y-sec full"><div class="opt-title">${esc(t('a11yTitle'))}</div>` +
    `<div class="opt-row"><span class="opt-lb">${esc(t('fontScale'))}</span><div class="seg" data-key="fontScale">${[[0.9, 'A−'], [1, 'A'], [1.15, 'A+'], [1.3, 'A++']].map(([v, l]) => `<button type="button" data-val="${v}" class="${Math.abs(ui.fontScale - v) < 0.01 ? 'on' : ''}">${l}</button>`).join('')}</div></div>` +
    sw('glove', t('glove')) + sw('leftHand', t('leftHand')) + sw('contrast', t('contrast')) + sw('reduceMotion', t('reduceMotion')) + sw('haptics', t('haptics')) + sw('dpad', t('dpad')) + sw('compactStatus', t('compactStatus')) + sw('denseBars', t('denseBars')) +
    sw('gizmo', t('gizmoOn')) + sw('grips', t('gripsOn')) + sw('snapPick', t('osPick')) + sw('cmdLine', t('cmdLineOn')) + sw('infoTap', t('infoTap')) +
    (rank(tier()) < rank('super') ? sw('showLocked', t('showLocked')) : '') +
    `<div class="opt-row"><button type="button" class="btn small" data-do="hints">${esc(t('hintsReset'))}</button></div></div>` + penSection();
  return { html, bind(root) {
    const sec = (root || document).querySelector('.a11y-sec'); if (!sec) return;
    sec.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const seg = b.closest('.seg[data-key="fontScale"]');
      if (seg && b.dataset.val) { ui.fontScale = Number(b.dataset.val); seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); applyUi(); return; }
      if (b.dataset.do === 'hints') { ui.hints = {}; applyUi(); api.toast(t('hintsResetDone'), 1500); }
    });
    sec.addEventListener('change', (ev) => {
      const inp = ev.target; if (!(inp instanceof HTMLInputElement) || inp.type !== 'checkbox' || !inp.dataset.key) return;
      ui[inp.dataset.key] = inp.checked; applyUi();
      if (inp.dataset.key === 'dpad') D.refreshNav();
      if (inp.dataset.key === 'showLocked') ed.rebuild();   // şerit yeniden kurulur (sekme + karo + çağrı karosu)
      if (inp.dataset.key === 'gizmo' || inp.dataset.key === 'grips') { refreshTiles(); api.drawOverlay(); }   // tutamak anında görünür / kaybolur
      if (inp.dataset.key === 'cmdLine') { refreshTiles(); if (!tools.running && !ed.m3) { if (ui.cmdLine) idlePrompt(); else { $('cmdBar').hidden = true; cmdIdle = false; closeSuggest(); } } }
    });
    penBind(root);
    deskBind(root);
  } };
}

/*
 * KALEM AYARLARI
 *
 * Bölüm her zaman görünür — kalem daha hiç kullanılmamışken de ayarlanabilsin diye. Üstteki
 * satır cihazda kalem görülüp görülmediğini DÜRÜSTÇE söyler; "kalemim çalışmıyor" diyen
 * kullanıcının bakacağı ilk yer burasıdır. Elenen avuç sayısı da orada yazar, çünkü avuç reddi
 * çalıştığında kullanıcı hiçbir şey görmez ve çalıştığını ancak bu sayaçtan anlar.
 *
 * Avuç reddi ÜCRETSİZDİR; ötekiler Premium'dur ve kilitliyken rozetli görünür, dokunulduğunda
 * yükseltme kutusu açılır (anahtar geri alınır, sessizce açılmış gibi durmaz).
 */
function penSection() {
  const kilit = !has('pen');
  const rozet = kilit ? lockBadge('pen', 'pill') : '';
  const sw = (key, label, pro) => `<div class="opt-row"><span class="opt-lb">${esc(label)}${pro ? ' ' + rozet : ''}</span><label class="switch"><input type="checkbox" data-pen="${key}" ${ui[key] && (!pro || !kilit) ? 'checked' : ''}><span class="knob"></span></label></div>`;
  const acts = ['menu', 'erase', 'snap', 'undo', 'none'];
  const durum = S.pen && S.pen.seen
    ? t('penFound') + (S.pen.real ? ' · ' + t('penPressureOk') : '') + (S.pen.drop ? ' · ' + t('penPalmDropped').replace('%s', String(S.pen.drop)) : '')
    : t('penNotFound');
  return deskSection() + `<div class="opt-sec pen-sec full"><div class="opt-title">${esc(t('penTitle'))}</div>` +
    `<div class="opt-row full muted">${esc(durum)}</div>` +
    sw('palmReject', t('palmReject'), false) +
    sw('penHover', t('penHover'), true) +
    sw('penDraw', t('penDraw'), true) +
    sw('penPressure', t('penPressure'), true) +
    `<div class="opt-row"><span class="opt-lb">${esc(t('penBarrel'))}${kilit ? ' ' + rozet : ''}</span><div class="seg" data-pen-act="1">${acts.map(v => `<button type="button" data-val="${v}" class="${String(ui.penBarrel || 'menu') === v ? 'on' : ''}">${esc(t('penAct_' + v))}</button>`).join('')}</div></div>` +
    `<div class="opt-row full muted">${esc(t('penHint'))}</div></div>`;
}
/*
 * MASAÜSTÜ AYARLARI. Kalem bölümüyle aynı gerekçeyle her zaman görünür: "faremi tanımıyor"
 * diyen kullanıcının bakacağı ilk yer burasıdır ve üstteki satır durumu dürüstçe söyler.
 */
function deskSection() {
  const acts = Desk.RIGHT_ACTIONS;
  const durum = (S.desk && S.desk.mouse) ? t('deskFound') : (Desk.likelyMouse(window) ? t('deskLikely') : t('deskNotFound'));
  const sw = (key, label) => `<div class="opt-row"><span class="opt-lb">${esc(label)}</span><label class="switch"><input type="checkbox" data-desk="${key}" ${ui[key] !== false ? 'checked' : ''}><span class="knob"></span></label></div>`;
  return `<div class="opt-sec desk-sec full"><div class="opt-title">${esc(t('deskTitle'))}</div>` +
    `<div class="opt-row full muted">${esc(durum)}</div>` +
    sw('desktop', t('deskOn')) +
    `<div class="opt-row"><span class="opt-lb">${esc(t('deskRight'))}</span><div class="seg" data-desk-right="1">${acts.map(v => `<button type="button" data-val="${v}" class="${String(ui.deskRight || 'enter') === v ? 'on' : ''}">${esc(t('deskRight_' + v))}</button>`).join('')}</div></div>` +
    `<div class="opt-row"><span class="opt-lb">${esc(t('polarStep'))}</span><div class="seg" data-desk-polar="1">${[5, 10, 15, 30, 45].map(v => `<button type="button" data-val="${v}" class="${Number(S.desk.polarStep) === v ? 'on' : ''}">${v}°</button>`).join('')}</div></div>` +
    `<div class="opt-row full muted">${esc(t('deskHint'))}</div></div>`;
}
function deskBind(root) {
  const sec = (root || document).querySelector('.desk-sec'); if (!sec) return;
  sec.addEventListener('change', (ev) => {
    const inp = ev.target; if (!(inp instanceof HTMLInputElement) || !inp.dataset.desk) return;
    ui[inp.dataset.desk] = inp.checked; applyUi(); refreshTiles(); api.drawOverlay();
  });
  sec.addEventListener('click', (ev) => {
    const b = ev.target.closest('.seg[data-desk-right] button, .seg[data-desk-polar] button');
    if (!b || !b.dataset.val) return;
    if (b.parentElement.dataset.deskRight) ui.deskRight = b.dataset.val;
    else S.desk.polarStep = Number(b.dataset.val) || 15;
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    applyUi(); haptic('toggle');
  });
}
function penBind(root) {
  const sec = (root || document).querySelector('.pen-sec'); if (!sec) return;
  const PRO = new Set(['penHover', 'penDraw', 'penPressure']);
  sec.addEventListener('change', (ev) => {
    const inp = ev.target; if (!(inp instanceof HTMLInputElement) || !inp.dataset.pen) return;
    const key = inp.dataset.pen;
    // Kilitli anahtar açılmaya çalışılırsa yükseltme kutusu açılır ve anahtar ESKİ hâline döner:
    // açık görünüp çalışmayan bir ayar, kilitli görünmekten daha kötüdür.
    if (PRO.has(key) && !gate('pen')) { inp.checked = false; return; }
    ui[key] = inp.checked; applyUi(); api.drawOverlay();
  });
  sec.addEventListener('click', (ev) => {
    const b = ev.target.closest('.seg[data-pen-act] button'); if (!b || !b.dataset.val) return;
    if (!gate('pen')) return;
    ui.penBarrel = b.dataset.val;
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    applyUi(); haptic('toggle');
  });
}

// ---------------------------------------------------------------------------------
// Tanıtım turu (ilk açılış)
// ---------------------------------------------------------------------------------
let tourStep = 0;
function showTour() {
  const el = $('tour'); if (!el || !S.hasDoc) return;
  tourStep = 0; el.hidden = false; renderTour();
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    $('tourSkip').addEventListener('click', endTour);
    $('tourNext').addEventListener('click', () => { if (tourStep >= 2) endTour(); else { tourStep++; renderTour(); } });
    // kart dışına ilk dokunuş turu kapatır (etkileşimi engellemesin)
    document.addEventListener('pointerdown', (ev) => { if (!el.hidden && !ev.target.closest('.tour-card')) endTour(); }, true);
  }
}
function renderTour() {
  $('tourText').textContent = t('tour' + (tourStep + 1));
  $('tourDots').innerHTML = [0, 1, 2].map(i => `<i class="${i === tourStep ? 'on' : ''}"></i>`).join('');
  $('tourNext').textContent = tourStep >= 2 ? t('tourDone') : t('tourNext');
}
function endTour() { const el = $('tour'); if (el) el.hidden = true; ui.hints.tour = true; applyUi(); }

// ---------------------------------------------------------------------------------
// Dışa açılan düzenleyici arayüzü
// ---------------------------------------------------------------------------------
ed.view3d = () => v3;
ed.render3D = render3D;
ed.overlay3D = overlay3D;   // app.drawOverlay 3B'de HUD'u silmek yerine yeniden çizer
ed.statusMode = statusMode;
ed.select = (prim) => { ed.sel.clear(); if (prim) ed.sel.add(prim); if (ed.is3D()) { v3.setSelection(ed.sel); render3D(); } else api.drawOverlay(); };
/*
 * KÖŞE TUTAMAKLARI AÇIKKEN BOŞTA DOKUNUŞ. Tutamaklar seçili nesnede çıkar; boşta dokunuş ise bilgi
 * paneline gidiyordu, nesne seçime girmiyordu — kullanıcı karoyu açıp nesneye dokununca hiçbir şey
 * olmuyordu. AutoCAD'in Command: istemindeki tıklama gibi: dokunulan nesne (grubuyla) SEÇİLİR, seçim
 * kutusu ve tutamakları çıkar; boş yere dokunmak seçimi bırakır. Bilgi paneli seçim rozetinden ya da
 * uzun basış menüsünden açılır. true dönerse app.js bilgi yolunu işletmez.
 */
ed.gripTap = (hit) => {
  if (!ui.grips || tools.running || ed.is3D() || S.mode !== 'view' || S.notesOn) return false;
  ed.sel.clear();
  if (hit) { for (const q of tools.groupOf(hit)) ed.sel.add(q); haptic('snap'); }
  api.drawOverlay();
  return true;
};
/** Sınama: seçili yolların tutamak sayısı (kip kapalıysa ya da yol yoksa 0), ekran konumları, yol anahtarları, nesne sayısı ve sıcak dizinler */
ed.gripInfo = () => { const G = gizmoVertLayout(); return G ? { n: G.verts.length, pts: G.VL.pts.map(q => q.slice(0, 2)), keys: G.verts.map(v => v.p.key), r: G.VL.r, hitR: G.VL.hitR, objs: new Set(G.verts.map(v => v.p)).size, act: giz && giz.act ? giz.act.slice() : null } : { n: 0, pts: [], keys: [], objs: 0, act: null }; };
/** Sınama: seçim kutusu tutamaklarının ekran konumları (taşı / döndür) ve isabet yarıçapı; kutu yoksa null */
ed.gizmoInfo = () => { const L = gizmoLayout(); return L ? { move: L.pts.move.slice(0, 2), rot: L.pts.rot.slice(0, 2), hitR: L.hitR, grip: L.grip, busy: ed.gizmoBusy(), sn: giz && giz.sn ? giz.sn.kind : null, p: giz && giz.p ? giz.p.slice() : null } : null; };
ed.setCurLayer = (name) => { if (!name || !S.layers.has(name)) return false; ed.curLayer = name; updateLayerButton(); return true; };
ed.openTab = (id) => { if ($('toolbar').classList.contains('collapsed')) collapse(false); setTab(id); };
ed.collapse = (on) => collapse(!!on);
ed.refreshTiles = refreshTiles;
/*
 * Komut çubuğunun DEVRİ. Pencere yakınlaştırma gibi app.js'e ait akışlar çubuğu kendileri
 * kurar; bittiğinde çubuğu gizlemek yanlıştır — komut satırı açıksa boştaki "Komut:" istemine
 * dönmesi gerekir, yoksa kullanıcı bir kez pencere yakınlaştırdıktan sonra komut satırını
 * kaybeder. Alma ve bırakma bu iki kapıdan geçer.
 */
ed.cmdTakeOver = () => { cmdIdle = false; closeSuggest(); };
/** Sağ tuş / boş Enter: son komutu yineler. Yoksa sessizce hiçbir şey yapmaz. */
ed.cmdRepeat = () => { if (cmdLast) runCommand(cmdLast); };

/* ---- Komut satırı sırası: art arda sorulan istemler ---------------------------------------
 * AutoCAD'in -LAYER gibi "pencere açmayan" komutları seçenekleri komut satırından sorar. Sıra,
 * çubuğu araçlardan bağımsız devralır: her adım bir istem gösterir, Enter cevabı verir, Esc
 * (back) sırayı iptal eder. Adımlar { istem, cevap(v) → sonraki adım | null (bitti) } nesneleridir.
 */
let cmdSeq = null;
function cmdSeqStart(adim) {
  if (!adim) return;
  cmdSeq = adim;
  const bar = $('cmdBar'); bar.hidden = false; cmdIdle = false; closeSuggest();
  $('cmdText').textContent = adim.istem;
  const inp = $('cmdInput'); inp.hidden = false; inp.type = 'text'; inp.placeholder = adim.ph || ''; inp.value = '';
  $('cmdBtns').innerHTML = cmdBtnHtml('data-cmdseq', 'cancel', t('cancelBtn'));
  try { inp.focus(); } catch (_) { /* odak yoksa geç */ }
}
function cmdSeqInput(v) {
  const a = cmdSeq; if (!a) return;
  let sonraki = null;
  try { sonraki = a.cevap(String(v == null ? '' : v).trim()); } catch (e) { console.warn(e); sonraki = null; }
  if (sonraki) cmdSeqStart(sonraki); else cmdSeqEnd();
}
function cmdSeqCancel() { if (!cmdSeq) return; cmdSeq = null; api.toast(t('cancelled'), 1000); showPrompt(null); }
function cmdSeqEnd() { cmdSeq = null; showPrompt(null); }
ed.cmdSeqActive = () => !!cmdSeq;

/*
 * -LAYER: AutoCAD'in komut satırı katman komutu. Seçenek harfleri AutoCAD'in kendi büyük harfli
 * kısaltmalarıdır (?, M, S, N, R, ON, OFF, C, L, LW, F, T, LO, U); karşılığı olmayanlar (TR
 * saydamlık, MAT malzeme, P çizim, A durum, D açıklama, E uzlaştırma) istemde yazmaz ve
 * "geçersiz seçenek" alır. Katman adı sorularında '*' bütün katmanlar, virgül birden çok ad.
 * Her seçenek tek geri alma adımı üretir; pencere açılmaz.
 */
function layerCli() {
  if (!needDoc() || !doc) return;
  const adlar = (v) => {
    const s = v.trim(); if (!s) return [];
    if (s === '*') return [...S.layers.keys()];
    const out = [], yok = [];
    for (const a of s.split(',').map(x => x.trim()).filter(Boolean)) { if (S.layers.has(a)) out.push(a); else yok.push(a); }
    if (yok.length) api.toast(t('laCliNoLayer').replace('%s', yok.join(', ')), 2500);
    return out;
  };
  const bitti = (msg) => { if (msg) api.toast(msg, 1600); return null; };
  const durumAdimi = (durum, ileti) => ({ istem: t('laCliNames'), ph: '*', cevap: (v) => { const n = adlar(v); if (n.length && layerSet(n, durum)) return bitti(ileti + ': ' + n.join(', ')); return null; } });
  const secenek = {
    istem: t('laCliOpts'), ph: 'N',
    cevap: (v) => {
      const o = v.toUpperCase();
      if (o === '?') { showCmdLayers(); return null; }
      if (o === 'N') return { istem: t('laCliName'), ph: t('layerDefaultName') + '1', cevap: (ad) => { const nm = ad || sonrakiKatmanAdi(); if (!gate('layer')) return null; if (doc.run({ op: 'layer', name: nm, color: -1 })) { refreshUndo(); return bitti(t('layerCreated') + ': ' + nm); } return bitti(t('layerExists')); } };
      if (o === 'M') return { istem: t('laCliName'), cevap: (ad) => { if (!ad) return null; if (!S.layers.has(ad)) { if (!gate('layer')) return null; if (!doc.run({ op: 'layer', name: ad, color: -1 })) return bitti(t('error')); refreshUndo(); } ed.setCurLayer(ad); return bitti(t('curLayerSet') + ': ' + ad); } };
      if (o === 'S') return { istem: t('laCliName'), ph: ed.curLayer, cevap: (ad) => { const nm = ad || ed.curLayer; return ed.setCurLayer(nm) ? bitti(t('curLayerSet') + ': ' + nm) : bitti(t('laCliNoLayer').replace('%s', nm)); } };   // boş Enter = öneri (geçerli katman), AutoCAD'deki <varsayılan> gibi
      if (o === 'R') return { istem: t('laCliName'), cevap: (eski) => (!S.layers.has(eski) ? bitti(t('laCliNoLayer').replace('%s', eski)) : { istem: t('laCliNewName'), cevap: (yeni) => { if (!yeni || !gate('layeredit')) return null; if (doc.run({ op: 'layerprops', name: eski, newName: yeni })) { refreshUndo(); return bitti(t('layerUpdated') + ': ' + yeni); } return bitti(t('layerExists')); } }) };
      if (o === 'ON') return durumAdimi({ off: false }, t('layerOn'));
      if (o === 'OFF') return durumAdimi({ off: true }, t('layerOff'));
      if (o === 'F') return durumAdimi({ frozen: true }, t('layerFreeze'));
      if (o === 'T') return durumAdimi({ frozen: false }, t('layerThaw'));
      if (o === 'LO') return durumAdimi({ locked: true }, t('lock'));
      if (o === 'U') return durumAdimi({ locked: false }, t('unlock'));
      if (o === 'C') return { istem: t('laCliColor'), ph: '1-255', cevap: (c) => { const ci = parseInt(c, 10); if (!(ci >= 1 && ci <= 255)) return bitti(t('laCliBad')); return { istem: t('laCliNames'), ph: ed.curLayer, cevap: (v2) => { const n = adlar(v2 || ed.curLayer); if (!n.length || !gate('layeredit')) return null; for (const nm of n) doc.run({ op: 'layerprops', name: nm, color: ci }); refreshUndo(); return bitti(t('layerUpdated') + ': ' + n.join(', ')); } }; } };
      if (o === 'L') return { istem: t('laCliLt'), ph: 'Continuous', cevap: (lt) => { const ad = lt || 'Continuous'; return { istem: t('laCliNames'), ph: ed.curLayer, cevap: (v2) => { const n = adlar(v2 || ed.curLayer); if (!n.length || !gate('layeredit')) return null; for (const nm of n) doc.run({ op: 'layerprops', name: nm, lt: ad }); refreshUndo(); return bitti(t('layerUpdated') + ': ' + n.join(', ')); } }; } };
      if (o === 'LW') return { istem: t('laCliLw'), ph: '0.25', cevap: (w) => { const mm = parseFloat(String(w).replace(',', '.')); if (!(mm >= 0 && mm <= 2.11)) return bitti(t('laCliBad')); return { istem: t('laCliNames'), ph: ed.curLayer, cevap: (v2) => { const n = adlar(v2 || ed.curLayer); if (!n.length || !gate('layeredit')) return null; for (const nm of n) doc.run({ op: 'layerprops', name: nm, lw: Math.round(mm * 100) }); refreshUndo(); return bitti(t('layerUpdated') + ': ' + n.join(', ')); } }; } };
      api.toast(t('laCliBad') + ': ' + (v || '—'), 1800);
      return secenek;   // aynı istem yeniden
    },
  };
  cmdSeqStart(secenek);
}
/*
 * -OSNAP: AutoCAD'in komut satırı sürümü. "Enter list of object snap modes:" — virgülle ayrılmış
 * kip adları (END,MID,CEN…), NONE / OFF hepsini kapatır. Tanınmayan ad uyarı alır, tanınanlar kurulur.
 */
function osnapCli() {
  const O = api.osnap;
  cmdSeqStart({ istem: t('osCliPrompt'), ph: [...S.snapModes].map(m => O.abbrOf(m)).join(',') || 'END,MID,CEN', cevap: (v) => {
    if (!v) return null;
    const r = O.parseList(v);
    if (r.bad.length) api.toast(t('osCliBad').replace('%s', r.bad.join(', ')), 2200);
    if (r.off && !r.modes.length) { O.setModes([]); api.toast(t('osnapOff'), 1200); }
    else if (r.modes.length) { O.setModes(r.modes); api.toast(t('osnapOn') + ': ' + r.modes.map(m => O.abbrOf(m)).join(', '), 1800); }
    return null;
  } });
}
/** '?' seçeneği: katmanlar ve durumları metin olarak (AutoCAD'in -LAYER ? listesi gibi) */
function showCmdLayers() {
  const rows = [...S.layers.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr')).map(l =>
    `<tr><td><code>${esc(l.name)}</code>${l.name === ed.curLayer ? ' ✓' : ''}</td><td>${l.off ? esc(t('layerOff')) : esc(t('layerOn'))}${l.frozen ? ' · ' + esc(t('layerFreeze')) : ''}${l.locked ? ' · ' + esc(t('lock')) : ''}</td><td>${esc(l.lt || 'Continuous')} · ${((l.lw == null ? 25 : l.lw) / 100).toFixed(2)}</td></tr>`).join('');
  api.openDoc(t('layers'), `<div class="full"><table class="cmd-list"><tbody>${rows}</tbody></table></div>`);
}
/** AutoCAD'deki gibi boş ad: Katman1, Katman2… (ilk boş numara) */
function sonrakiKatmanAdi() {
  const kok = t('layerDefaultName');
  for (let i = 1; i < 10000; i++) if (!S.layers.has(kok + i)) return kok + i;
  return kok + Date.now();
}
ed.nextLayerName = sonrakiKatmanAdi;
ed.cmdRelease = () => { if (!tools.running && !ed.m3) showPrompt(null); };
/*
 * Anahtarla silme (kalem silgisi buradan geçer). Silmek yalnız bir belge komutu değildir:
 * seçim temizlenmeli, geri-al düğmesi tazelenmeli, 3B'deyse sahne yeniden kurulmalıdır. Bu
 * değişmezler editor.js'in sorumluluğudur; app.js onları bilmek zorunda kalmasın diye tek
 * kapıdan geçiriliyor. Yetki kapısı t:del'dir — silgi ucu da aynı kapıdan geçer.
 */
ed.eraseKeys = (keys) => {
  const ks = (keys || []).filter(Boolean);
  if (!ks.length || !doc) return false;
  if (!gate('t:del')) return false;
  if (!doc.run({ op: 'delete', keys: ks })) return false;
  for (const p of [...ed.sel]) if (ks.includes(p.key)) ed.sel.delete(p);
  refreshUndo(); api.requestRender();
  if (ed.is3D()) { refresh3D(); render3D(); overlay3D(); } else api.drawOverlay();
  return true;
};
/** Yetki değişince (edition.onEdition) şeridi yeniden kurar: sekmeler / karolar yeniden çizilir, geçerli sekme korunur (yoksa 'view'), çalışan araç (2B tools ya da 3B ed.m3) işaretli kalır */
ed.rebuild = () => { closePop(); buildToolbar(); if (ed.m3) markActive('3:' + ed.m3.name); else if (tools && tools.running && tools.active) markActive('t:' + tools.active); };
/** Karo eylemi (dolaylı yol: sınama, kabuk); Ücretsiz sürümde gate() uygulanır */
ed.act = (name) => act(String(name || ''));
/** Klavye: Esc geri, Del sil, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z), Enter bitir; true → işlendi */
ed.key = (ev) => {
  if (!ev || typeof ev.key !== 'string') return false;
  const k = ev.key;
  if (k === 'Escape') { closeSuggest(); return back(); }
  if (!S.hasDoc) return false;
  /*
   * MASAÜSTÜ KİPİ. AutoCAD'de kullanıcı çizim alanındayken harf yazdığında metin doğrudan
   * komut satırına düşer; ayrı bir alana tıklamak gerekmez. Burada aynısı yapılır: tuş komut
   * girişine aktarılır ve odak oraya verilir, böylece yazmaya kesintisiz devam edilir.
   */
  if (deskKey(ev)) return true;
  if ((ev.ctrlKey || ev.metaKey) && (k === 'z' || k === 'Z')) { if (ev.shiftKey) act('redo'); else act('undo'); return true; }
  if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || k === 'Y')) { act('redo'); return true; }
  if ((k === 'Delete' || k === 'Backspace') && ed.sel.size && doc && !tools.running) { if (!gate('t:del')) return true; doc.run({ op: 'delete', keys: [...ed.sel].map(p => p.key) }); ed.sel.clear(); refreshUndo(); api.requestRender(); if (ed.is3D()) { refresh3D(); render3D(); } api.toast(t('deleted')); return true; }
  // AutoCAD'de BOŞLUK çalışan bir komutun içinde ENTER'dır (adımı bitirir), son komutu yinelemez;
  // yineleme yalnız komut YOKKEN olur. Boşluk komut satırına yazarken buraya hiç gelmez (odak girişte).
  if ((k === 'Enter' || k === ' ') && tools.running) { if (!(tools.enterEmpty && tools.enterEmpty())) tools.finish(); return true; }   // Ekran / Ölçü araçlarında boş Enter son değeri alır
  // Boş Enter / boşluk son komutu yineler (AutoCAD). Araç çalışırken yukarıdaki dal bitirir.
  if ((k === 'Enter' || k === ' ') && deskAktif() && cmdLast) { ed.cmdRepeat(); return true; }
  return false;
};
/** Masaüstü kipi açık mı (app.js'teki deskOn ile aynı ölçü; burada ui üzerinden okunur) */
function deskAktif() {
  if (ui.desktop === false || !S.hasDoc) return false;
  return !!(S.desk && S.desk.mouse) || Desk.likelyMouse(window);
}
/*
 * Masaüstü tuş yönlendirmesi. İşlev tuşları ve Ctrl kısayolları AutoCAD'in kendi atamalarıdır
 * (desktop.js); harf ve rakam tuşları komut satırına aktarılır. Komut satırı KAPALIYSA harf
 * aktarımı yapılmaz — o zaman uygulamanın eski tek harfli kısayolları (f, z, g, d) çalışmaya
 * devam eder ve kullanıcı ikisinin arasında kalmaz.
 */
function deskKey(ev) {
  if (!deskAktif()) return false;
  const r = Desk.resolveKey(ev, { cmdLine: cmdLineOn() });
  if (r) {
    if (r.special === 'ortho') { toggleOrtho(); return true; }
    if (r.special === 'polar') { togglePolar(); return true; }
    if (r.act) { act(r.act); return true; }
  }
  if (!cmdLineOn() || tools.running || ed.m3) return false;
  if (!Desk.isCommandChar(ev)) return false;
  const inp = $('cmdInput');
  if (!inp || inp.hidden || document.activeElement === inp) return false;
  if (!cmdIdle) idlePrompt();
  inp.value = ev.key;
  inp.focus();
  showSuggest(inp.value);
  return true;
}
/*
 * ORTHO ve KUTUPSAL İZLEME. AutoCAD'de ikisi birden açıkken ortho kazanır; burada da öyle.
 * Durum çubuğunda görünür olmaları şart — görünmeyen bir kısıt, çizimi "bozuk" gösterir.
 */
function toggleOrtho() {
  S.desk.ortho = !S.desk.ortho;
  if (S.desk.ortho) S.desk.polar = false;
  haptic('toggle'); refreshTiles(); syncOrthoBtn(); api.drawOverlay();
  api.toast(t(S.desk.ortho ? 'orthoOn' : 'orthoOff'), 1200);
}
function togglePolar() {
  S.desk.polar = !S.desk.polar;
  if (S.desk.polar) S.desk.ortho = false;
  haptic('toggle'); refreshTiles(); syncOrthoBtn(); api.drawOverlay();
  api.toast(t(S.desk.polar ? 'polarOn' : 'polarOff') + (S.desk.polar ? ' · ' + S.desk.polarStep + '°' : ''), 1400);
}
/*
 * ORTHO KOMUTLA BİRLİKTE. Telefonda F8 yok, Ekran sekmesindeki karo ise çizim sırasında uzaktadır;
 * bu yüzden komut çubuğunun İSTEM SATIRININ sağında, nokta istenen HER adımda aynı yerde bir Ortho
 * düğmesi durur (giriş satırına konduğunda Bitir · Geri · İptal üçüncü satıra taşıyordu). Durum tektir (S.desk.ortho): karo, F8, kutupsal ve bu düğme aynı değeri
 * okur ve yazar. show verilmezse yalnız açık / kapalı görünümü tazelenir.
 */
function syncOrthoBtn(show) {
  const b = $('cmdOrtho'); if (!b) return;
  if (show != null) b.hidden = !show;
  const on = !!(S.desk && S.desk.ortho);
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  const lbl = t('tl_ortho') + ' (F8)'; b.title = lbl; b.setAttribute('aria-label', lbl);
}
ed.syncOrthoBtn = () => syncOrthoBtn();
/*
 * İZ NOKTASI (TT) DÜĞMESİ: Ortho düğmesinin yanında, nokta istenen her adımda; dokunulan (yakalanan) noktayı nokta
 * saymadan edinir (nesne yakalama izleme). Yakalama izinin AÇMA / KAPAMA anahtarı burada DEĞİLDİR: Ölçü ve Ekran
 * sekmelerindeki "Yakalama izi" karosu, F11 ve ayar kutusu tek durumu (settings.snapOpt.otrack) okur / yazar —
 * istem satırına üçüncü düğme konduğunda "Çizgi: İkinci noktayı seçin (devam eder)" gibi istemler ikinci satıra sarıp
 * çubuğu büyütüyordu.
 */
function syncTtBtn(show) {
  const b = $('cmdTt'); if (!b) return;
  if (show != null) b.hidden = !show;
  const l = t('osTk') + ' (TT)'; b.title = l; b.setAttribute('aria-label', l);
}
/** İz noktası (TT) düğmesinin basılı görünümü: bir kerelik kip 'tk' kuruluyken vurgulu, tüketilince söner */
function syncSnapOnce() {
  const on = !!(S && S.snapOnce === 'tk');
  const b = $('cmdTt'); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
}
/** Gezinen imleç / parmakla nişan önizlemesi: nokta isteminde ortho / kutupsal kısıtı uygulanmış nokta (kısıt yoksa aynı nokta) */
ed.constrainPoint = (w) => (tools && tools.running && !tools.selecting && !tools.pickingObject() && typeof tools.previewPoint === 'function') ? tools.previewPoint(w) : w;
export const editor = ed;
