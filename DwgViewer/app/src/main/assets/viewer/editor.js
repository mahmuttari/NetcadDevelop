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
import { ToolManager, TOOLS } from './tools.js';
import { EditDoc, writeDxf, newId } from './edit.js';
import { View3D } from './view3d.js';
import { openView3DOptions, buildViewCube, openCameraBookmarks, renderZScale, renderClip } from './view3d_panel.js';
import { FG, ACI } from './scene.js';
import { toScreen, toWorld, fmt, store } from './state.js';
import { bgColor, fgColor } from './render.js';
import { t, applyI18n, addStrings } from './i18n.js';
import { TAU, meshMetrics } from './geom.js';
import * as D from './display.js';
import { askText, askForm } from './dialog.js';
import { leaderEnts } from './annot.js';
import * as Gz from './gizmo.js';
import { has, gate, need, rank, tier, tierName, lockAttr, lockBadge, lockBadgeFor, openProPanel } from './edition.js';
import { cmdOf, namesOf, repeatable, resolve as acadResolve, suggest as acadSuggest, COMMANDS as ACAD } from './acad.js';
import * as Desk from './desktop.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };
let api, S, tools, doc = null, v3 = null;
const ed = { is3D: () => !!(v3 && !$('cv3d').hidden), tools: null, doc: null, curLayer: '0', curColor: 256, tab: 'view', sel: new Set(), result: null, m3: null, curPattern: { name: 'SOLID', scale: 1, angle: 0 } };

// ---------------------------------------------------------------------------------
// Kullanım tercihleri (ui) — kalıcı anahtar 'ui'
// ---------------------------------------------------------------------------------
const UI_DEFAULTS = { favs: [], tbCollapsed: { portrait: false, landscape: false }, hints: {}, fontScale: 1, glove: false, leftHand: false, contrast: false, reduceMotion: false, haptics: true, dpad: false, compactStatus: false, showLocked: true, gizmo: true, infoTap: true, infoFull: false, pick3: 'auto', grips: false, palmReject: true, penHover: true, penPressure: true, penDraw: false, penBarrel: 'menu', cmdLine: true, desktop: true, deskRight: 'enter' };
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
    { cap: 'grpHelpers', items: [T('osnap', 'i-snap', 'Yakalama', 'Osnap', 'Nesne yakalamayı açar / kapatır', 'Toggle object snap'), T('osnapset', 'i-sliders', 'Yakalama ayarları', 'Osnap settings', 'Yakalama kipleri (14 AutoCAD kipi), bir kerelik yakalama, açıklık', 'Object snap modes (all 14 AutoCAD modes), one-shot overrides, aperture'), T('grid', 'i-grid', 'Izgara', 'Grid'), T('crosshair', 'i-crosshair', 'Artı imleç', 'Crosshair')] } ] },
  { id: 'draw', i18n: 'tabDraw', icon: 'i-pen', groups: [
    { cap: 'grpDraw2', items: [T('t:line', 'i-line', 'Çizgi', 'Line', 'İki nokta ya da @uzunluk<açı', 'Two points or @length<angle'), T('t:pline', 'i-pline', 'Polyline', 'Polyline', 'Çok köşeli çizgi; Bitir / Kapat', 'Multi-vertex line'), T('t:rect', 'i-rect', 'Dikdörtgen', 'Rectangle'), T('t:circle', 'i-circle', 'Daire', 'Circle', 'Merkez + yarıçap', 'Center + radius'), T('t:arc3', 'i-arc', 'Yay', 'Arc', 'Üç noktadan yay', 'Three-point arc'), T('t:point', 'i-point', 'Nokta', 'Point'), T('t:text', 'i-text', 'Yazı', 'Text', 'Konum, metin ve yükseklik', 'Position, text and height')] },
    { cap: 'grpDraw3', items: [T('t:pline3d', 'i-pline3d', '3B Polyline', '3D Polyline', 'x,y,z köşeli çizgi', 'Vertices with z'), T('t:face3d', 'i-face', '3B Yüzey', '3D Face', 'Üç / dört köşeli yüzey', 'Three / four vertex face')] },
    { cap: 'grpCur', items: [T('layer', 'i-layers', 'Katman', 'Layer', 'Geçerli katman ve yeni katman', 'Current layer'), T('color', 'i-palette', 'Renk', 'Color', 'Geçerli renk (ACI)', 'Current color')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: 'annot', i18n: 'tabAnnot', icon: 'i-dim', groups: [
    { cap: 'grpDim', items: [T('t:dim', 'i-dim', 'Doğrusal ölçü', 'Linear', 'İki nokta + ölçü çizgisi; eğik ölçü', 'Two points + dimension line; aligned'), T('t:dimh', 'i-dim-h', 'Yatay ölçü', 'Horizontal', 'Yatay mesafeyi ölçülendirir', 'Dimension the horizontal distance'), T('t:dimv', 'i-dim-v', 'Düşey ölçü', 'Vertical', 'Düşey mesafeyi ölçülendirir', 'Dimension the vertical distance'), T('t:dimr', 'i-radius', 'Yarıçap', 'Radius', 'Daire ya da yaya dokunun', 'Tap a circle or arc'), T('t:dimd', 'i-diameter', 'Çap', 'Diameter', 'Daire ya da yaya dokunun', 'Tap a circle or arc'), T('t:dima', 'i-angle', 'Açı ölçüsü', 'Angular', 'Tepe + iki kol', 'Vertex + two arms'), T('t:dimedit', 'i-dimedit', 'Ölçüyü düzenle', 'Edit dimension', 'Ölçü yazısı, yükseklik, ok boyu, ondalık, ön / son ek, çarpan; dosyadan gelen ölçüler de', 'Dimension text, height, arrow, decimals, prefix / suffix, scale factor; file dimensions too')] },
    { cap: 'grpMark', items: [T('t:leader', 'i-leader', 'Açıklama', 'Leader', 'Ok başlı kılavuz çizgi ve yazı', 'Leader line with an arrow and text'), T('t:cloud', 'i-cloud', 'Revizyon bulutu', 'Revision cloud', 'Değişen bölgeyi bulutla çevreler', 'Cloud around a revised area'), T('t:balloon', 'i-balloon', 'Numaralandır', 'Numbering', 'Artan numaralı balon; her dokunuşta bir sonraki', 'Balloon with an auto-incrementing number'), T('t:hatch', 'i-hatch', 'Tarama', 'Hatch', 'Kapalı alanın içine dokunun, dolgu ekler', 'Tap inside a closed area to fill it'), T('hatchpat', 'i-hatch', 'Desen', 'Pattern', 'Çizilecek taramanın deseni, ölçeği ve açısı', 'Pattern, scale and angle for new hatches'), T('markdim', 'i-dim', 'Ölçümü işle', 'Mark measurement', 'Son ölçüm sonucunu açıklama olarak çizime yazar', 'Write the last measurement onto the drawing')] },
    { cap: 'grpCur', items: [T('layer', 'i-layers', 'Katman', 'Layer'), T('color', 'i-palette', 'Renk', 'Color')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: 'edit', i18n: 'tabEdit', icon: 'i-select', groups: [
    { cap: 'grpSel', items: [T('t:select', 'i-select', 'Seç', 'Select', 'Dokunarak seçim; Tümü düğmesiyle hepsi', 'Tap to select'), T('props', 'i-props', 'Özellikler', 'Properties', 'Seçimin katmanı ve rengi', 'Layer and color of the selection'), T('grips', 'i-grips', 'Köşe tutamakları', 'Vertex grips', 'Seçili yolun her köşesini ayrı ayrı sürükleyin', 'Drag each vertex of the selected path')] },
    { cap: 'grpXform', items: [T('t:move', 'i-move', 'Taşı', 'Move'), T('t:copy', 'i-copyobj', 'Kopyala', 'Copy'), T('t:rotate', 'i-rotate', 'Döndür', 'Rotate'), T('t:scale', 'i-scale', 'Ölçekle', 'Scale'), T('t:mirror', 'i-mirror', 'Aynala', 'Mirror'), T('t:offset', 'i-offset', 'Ofset', 'Offset', 'Önce Ekran mı Ölçü mü: geçiş noktası ya da yazılan mesafe, sonra nesne', 'Asks Screen or Measure first: through point or typed distance, then the object')] },
    { cap: 'grpModify', items: [T('t:del', 'i-erase', 'Sil', 'Delete'), T('t:setz', 'i-z', 'Kot ata', 'Set Z', 'Seçime Z kotu atar', 'Assign elevation'), T('t:edittext', 'i-edittext', 'Yazı düzenle', 'Edit text'), T('t:array', 'i-array', 'Dizi', 'Array', 'Dikdörtgen ya da kutupsal artımlı kopya', 'Rectangular or polar incremental copy'), T('t:thick', 'i-thick', 'Kalınlık', 'Thickness', '2B nesneye yükseklik vererek 3B gövde üretir', 'Extrude 2D objects into 3D bodies'), T('t:explode', 'i-explode', 'Patlat', 'Explode', 'Blok yerleştirmesini parçalarına ayırır', 'Break a block insertion into its parts'), T('t:textsize', 'i-textsize', 'Yazı yüksekliği', 'Text height', 'Seçili yazıların yüksekliğini değiştirir', 'Change the height of selected texts'), T('t:attr', 'i-attr', 'Öznitelik', 'Attributes', 'Blok özniteliklerini düzenler', 'Edit block attributes'), T('findrep', 'i-findrep', 'Bul-değiştir', 'Find & replace', 'Çizimdeki yazılarda toplu değiştirme', 'Bulk replace across drawing texts'), T('t:trim', 'i-trim', 'Buda', 'Trim', 'Önce Ekran mı Ölçü mü: kesici kenar + parça, ya da yazılan boy kadar kısalt', 'Asks Screen or Measure first: cutting edge + piece, or cut a typed length off the end'), T('t:extend', 'i-extend', 'Uzat', 'Extend', 'Önce Ekran mı Ölçü mü: sınır + uç, ya da yazılan boy kadar uzat', 'Asks Screen or Measure first: boundary + end, or add a typed length to the end'), T('t:fillet', 'i-fillet', 'Kavis', 'Fillet', 'Önce Ekran mı Ölçü mü: yayın geçeceği nokta ya da yazılan yarıçap, sonra iki doğru', 'Asks Screen or Measure first: where the arc passes or a typed radius, then two lines'), T('t:chamfer', 'i-chamfer', 'Pah', 'Chamfer', 'Önce Ekran mı Ölçü mü: pahın geçeceği nokta ya da yazılan mesafe, sonra iki doğru', 'Asks Screen or Measure first: where the chamfer passes or a typed distance, then two lines')] },
    { cap: 'grpBlock', items: [T('blocklib', 'i-block', 'Blok kütüphanesi', 'Block library', 'Seçimden blok oluştur, kaydet, çizime ekle', 'Create, save and insert blocks'), T('copyclip', 'i-copy', 'Panoya kopyala', 'Copy to clipboard', 'Seçimi panoya alır; başka çizimde yapıştırılır', 'Copy the selection for pasting into another drawing'), T('pasteclip', 'i-paste', 'Panodan yapıştır', 'Paste', 'Panodaki nesneleri bu çizime ekler', 'Paste clipboard objects into this drawing')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: '3d', i18n: 'tab3d', icon: 'i-cube', groups: [
    { cap: 'grpView3', items: [T('3d', 'i-3d', '3B aç/kapat', '3D on/off', 'Tek parmak döndürür, iki parmak kaydırır / yakınlaştırır', 'One finger orbits, two fingers pan / zoom'), T('fit3', 'i-fit', 'Sığdır', 'Fit'), T('v:iso', 'i-iso', 'İzometrik', 'Isometric'), T('v:top', 'i-top', 'Üst', 'Top'), T('v:front', 'i-front', 'Ön', 'Front'), T('v:left', 'i-left', 'Sol', 'Left'), T('v:right', 'i-right', 'Sağ', 'Right'), T('v:back', 'i-back', 'Arka', 'Back'), T('v:bottom', 'i-bottom', 'Alt', 'Bottom')] },
    { cap: 'grpCam3', items: [T('persp', 'i-eye', 'Perspektif', 'Perspective', 'Perspektif / ortografik', 'Perspective / orthographic'), T('zscale', 'i-zscale', 'Z abartı', 'Z scale', 'Düşey abartı çarpanı', 'Vertical exaggeration'), T('cam3', 'i-camera', 'Yer imleri', 'Bookmarks', 'Kamera konumlarını kaydeder', 'Save camera positions'), T('turn3', 'i-turn', 'Döner tabla', 'Turntable')] },
    { cap: 'grpStyle3', items: [T('vstyle', 'i-vs-wireframe', 'Görsel stil', 'Visual style', 'Tel kafes, gizli çizgi, gölgeli, gerçekçi, kavramsal, gri, eskiz, röntgen', 'Wireframe, hidden, shaded, realistic, conceptual, gray, sketchy, x-ray'), T('edges3', 'i-edges', 'Kenarlar', 'Edges', 'Yüzey kenar çizgilerini aç/kapat (stilin varsayılanını geçersiz kılar)', 'Toggle face edge lines (overrides the style default)'), T('color3', 'i-palette', 'Renk', 'Color', 'Nesne, katman, kot, tek renk', 'Entity, layer, elevation, mono'), T('clip3', 'i-clip', 'Kesit', 'Clip', 'Z aralığı ve kesit kutusu', 'Z range and clip box')] },
    { cap: 'grpTools3', items: [T('3:select', 'i-select', 'Seç', 'Select'), T('target3', 'i-snap', 'Hedef', 'Target', 'Köşe / yüzey / otomatik: 3B dokunuşu neye oturur', 'Vertex / surface / auto: what a 3D tap snaps to'), T('3:dist', 'i-dist', '3B mesafe', '3D distance', 'Köşeler arası eğik mesafe, ΔZ, eğim', 'Slope distance between vertices'), T('3:move', 'i-move', 'Taşı (3B)', 'Move (3D)'), T('3:pline', 'i-pline3d', '3B Polyline', '3D Polyline'), T('3:geo', 'i-geo3', '3B geometrik ölçüm', '3D geometry measure', 'Nokta-doğru, nokta-düzlem, doğru-doğru, doğru-düzlem, düzlem-düzlem uzaklığı ve açı', 'Point-line, point-plane, line-line, line-plane, plane-plane distance and angle'), T('3:note', 'i-note3', '3B açıklama', '3D note', 'Seçilen 3B noktaya açıklama etiketi koyar', 'Place an annotation at a picked 3D point'), T('3:setz', 'i-z', 'Kot ata', 'Set Z'), T('3:del', 'i-erase', 'Sil', 'Delete'), T('undo', 'i-undo', 'Geri al', 'Undo')] } ] },
];
const DISPLAY_2D = [
  { cap: 'grpTheme', items: [T('theme', 'i-theme', 'Koyu / açık', 'Dark / light', 'Arka plan temasını değiştirir', 'Switch the background theme'), T('sun', 'i-sun', 'Güneş', 'Sun', 'Güneş altında okunaklı yüksek kontrast', 'High contrast for sunlight'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options', 'Tema, ön ayarlar, süzgeçler, çizgiler, ızgara…', 'Theme, presets, filters, lines, grid…')] },
  { cap: 'grpVis', items: [T('text', 'i-text', 'Yazı', 'Text'), T('hatch', 'i-hatch', 'Tarama', 'Hatch'), T('dim', 'i-dim', 'Ölçüler', 'Dimensions'), T('points', 'i-point', 'Noktalar', 'Points'), T('images', 'i-image', 'Resimler', 'Images')] },
  { cap: 'grpLines', items: [T('lw', 'i-lw', 'Kalınlık', 'Lineweight', 'Çizgi kalınlıklarını gösterir', 'Show lineweights'), T('mono', 'i-mono', 'Tek renk', 'Mono', 'Tek renk / nesne rengi', 'Monochrome / entity color'), T('ltype', 'i-fade', 'Çizgi tipi', 'Linetype')] },
  { cap: 'grpHelpers', items: [T('grid', 'i-grid', 'Izgara', 'Grid'), T('crosshair', 'i-crosshair', 'Artı imleç', 'Crosshair'), T('cmdline', 'i-cmdline', 'Komut satırı', 'Command line', 'AutoCAD komut adlarıyla çalışır: LINE, TR, F…', 'Type AutoCAD command names: LINE, TR, F…'), T('ortho', 'i-ortho', 'Ortho', 'Ortho', 'Noktayı yatay ya da düşeye kilitler (F8)', 'Locks the point to horizontal or vertical (F8)'), T('polar', 'i-polar', 'Kutupsal', 'Polar', 'Noktayı açı adımına oturtur (F10)', 'Snaps the point to an angle increment (F10)'), T('rulers', 'i-ruler', 'Cetvel', 'Rulers'), T('fade', 'i-fade', 'Soldur', 'Fade', 'Seçili olmayan katmanları soldurur', 'Fade other layers')] },
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
  tr.perspShort = 'Persp'; en.perspShort = 'Persp'; tr.orthoShort = 'Paralel'; en.orthoShort = 'Ortho';
  addStrings(tr, en);
}
registerTiles();
const tileLabel = (act) => { const it = TILE[act]; return it ? tt('tl_' + act, it.tr) : act; };
const tileHint = (act) => { const it = TILE[act]; return it ? tt('th_' + act, it.htr) : ''; };
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;

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
    fmt,
    copy: (t) => api.copyText(t),
    lonLat: (x, y) => S.geo.active ? S.geo.toLonLat(x, y) : null,
    visiblePrims: () => S.prims.filter(p => !(S.layers.get(p.lay) && !S.layers.get(p.lay).visible)),
    selectable: () => S.prims.filter(p => { const l = S.layers.get(p.lay); return !(l && (!l.visible || l.locked)); }),   // bölge seçimi: görünür ve kilitsiz katmanlar
    allPrims: () => (S.scene ? S.scene.layouts[0].prims : []),
    trType: (x) => tt('ety_' + x, x),               // DXF tür adının yerelleşmiş karşılığı (yoksa adın kendisi)
    hatchPattern: () => ed.curPattern,              // çizilecek taramanın deseni (SOLID varsayılan)
    meshMetrics: (p) => { try { return p && p.vtx && p.idx ? meshMetrics(p.vtx, p.idx) : null; } catch (_) { return null; } },
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
  doc = new EditDoc({
    prims: () => model.prims,
    layers: S.layers,
    insert: (p, at) => { if (at == null || at > model.prims.length) model.prims.push(p); else model.prims.splice(at, 0, p); },
    remove: (p) => { const i = model.prims.indexOf(p); if (i >= 0) model.prims.splice(i, 1); return i; },
    rebuild,
    store: api.store,
    key: S.fileKey,
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
const tileId = (act, tabId) => act === 'undo' && tabId === 'view' ? 'tbUndo' : act === 'redo' && tabId === 'view' ? 'tbRedo' : act === 'savedxf' ? 'tbSave' : act === 'layer' ? 'tbLayer' : '';
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
function rowGroups(tab) {
  if (tab.id === 'display') return editionGroups(ed.is3D() ? DISPLAY_3D : DISPLAY_2D);
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
  refreshUndo(); refreshTiles(); updateLayerButton(); applyCollapse();
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
  document.querySelectorAll('#toolbar [data-act]').forEach(b => b.classList.toggle('active', name != null && b.dataset.act === name));
}
/** Durum karoları (.on): 2B ekran anahtarları, 3B seçenekleri, görünüm geçmişi */
function refreshTiles() {
  const on = {};
  if (S) {
    on.theme = !S.dark; on.sun = !!S.sun; on.text = S.show.text; on.hatch = S.show.hatch; on.dim = S.show.dim; on.points = S.show.point; on.images = S.show.image;
    on.lw = !!S.lw; on.mono = S.colorMode === 'mono'; on.ltype = S.show.ltype; on.grid = S.grid.on; on.crosshair = S.crosshair !== 'off'; on.rulers = !!S.rulers; on.fade = S.fade.on;
    on.osnap = S.snapModes && S.snapModes.size > 0; on['3d'] = ed.is3D(); on.grips = !!ui.grips; on.cmdline = ui.cmdLine !== false; on.ortho = !!(S.desk && S.desk.ortho); on.polar = !!(S.desk && S.desk.polar);
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
async function hatchPatPop() {
  if (!gate('t:hatch')) return;
  const G = await import('./geom.js');
  const adlar = Object.keys(G.HATCH_PATTERNS);
  const cur = ed.curPattern || { name: 'SOLID', scale: 1, angle: 0 };
  const r = await askForm(t('hatchPatTitle'), [
    { id: 'name', label: tileLabel('hatchpat'), type: 'select', value: cur.name,
      options: adlar.map(n => [n, n === 'SOLID' ? t('patSolid') : n]) },
    { id: 'scale', label: t('hatchScale'), type: 'number', value: String(cur.scale) },
    { id: 'angle', label: t('hatchAngle'), type: 'number', value: String(cur.angle) },
  ], { ok: t('ok') });
  if (!r) return;
  const sc = parseFloat(String(r.scale).replace(',', '.')), an = parseFloat(String(r.angle).replace(',', '.'));
  ed.curPattern = { name: adlar.includes(r.name) ? r.name : 'SOLID', scale: isFinite(sc) && sc > 0 ? sc : 1, angle: isFinite(an) ? an : 0 };
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
function openPop(anchor, html, o = {}) {
  closePop();
  const pop = $('tbPop'), app = $('app');
  pop.innerHTML = html; pop.hidden = false; pop.classList.toggle('side', landscapeMq.matches);
  const ar = anchor.getBoundingClientRect(), pr = app.getBoundingClientRect();
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
  const anchor = btn; const ar = anchor.getBoundingClientRect(), pr = $('app').getBoundingClientRect();
  if (!landscapeMq.matches) { const hh = pop.offsetHeight; let y = ar.top - pr.top - hh - 10; if (y < 8) y = 8; pop.style.top = y + 'px'; }
}
function needDoc() { if (!S.hasDoc) { api.toast(t('openFirst')); return false; } return true; }
/** belge açık olmadan da çalışan karolar; HIST kendi kapalılığını yönetir (refreshUndo / görünüm geçmişi) */
const FREE = new Set(['more', 'display', 'drive', 'undo', 'redo', 'gps', 'basemap', 'theme', 'sun', 'open', 'new', 'about', 'settings', 'cmdhelp', 'closefile', 'osnapset']);
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
  if (name.startsWith('t:')) { if (!needModel()) return; if (ed.is3D()) exit3D(); const tn = name.slice(2); if (tools.active === tn) { tools.cancel(); markActive(null); } else { tools.start(tn); markActive(name); } return; }
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
    case 'markdim': case 'findrep': case 'blocklib': case 'copyclip': case 'pasteclip': case 'mesh3d': case 'tableout': case 'batch': case 'pdfcad': api.action(name); break;
    case 'osnap': toggleOsnap(); break;
    case 'osnapset': api.osnap.openDialog(); break;
    case 'otrack': api.osnap.toggleTrack(); syncQuick(); refreshTiles(); break;
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
    case 'closefile': api.action('home'); break;
    case 'grips': toggleGrips(); break;
    case 'cmdline': toggleCmdLine(); break;
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
 * Köşe tutamaklarını açar / kapar. Açıldığında tek bir yol seçiliyse düğümler belirir; düğüm
 * sayısı sınırı aşıyorsa tutamak çizilmez ve kullanıcıya nedeni söylenir — sessizce hiçbir şey
 * olmaması "bozuk" gibi görünür.
 */
function toggleGrips() {
  ui.grips = !ui.grips;
  applyUi(); haptic('toggle'); refreshTiles(); api.drawOverlay();
  if (ui.grips && ed.sel.size && [...ed.sel].every(p => p.info && p.info.t === 'DIMENSION')) { api.toast(t('gripsDim'), 2600); return; }
  if (ui.grips && ed.sel.size === 1) {
    const p = [...ed.sel][0];
    if (p && p.k === 0 && !Gz.vertsOf(p).length) api.toast(t('gripsTooMany'), 2200);
  }
  api.toast(ui.grips ? t('gripsOnMsg') : t('gripsOffMsg'), 1200);
}
/** F3 / durum çubuğu / şerit karosu: tek kaynak osnap.toggle (liste saklanır, açılınca geri gelir) */
function toggleOsnap() { api.osnap.toggle(); syncQuick(); refreshTiles(); }
/** app.js kipleri değiştirdiğinde (ayar kutusu, çip şeridi, -OSNAP) durum çubuğu ve karolar tazelenir */
ed.snapChanged = () => { syncQuick(); refreshTiles(); };
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
  cancel: ['cancelBtn', () => { tools.cancel(); markActive(null); ed.sel.clear(); api.drawOverlay(); }] };
/*
 * Komut çubuğu düğmesi: SVG simge + etiket. Çeviri metinlerinin başındaki ince Unicode imleri
 * (✓ ↶ ✕) atılır; simgeyi yazı tipi değil SVG çizer, böylece her dilde aynı dolgunlukta görünür.
 * Bitir birincil (vurgu renkli) düğmedir: çubuğun onay eylemi odur.
 */
const CMD_ICON = { finish: 'i-check', close: 'i-closepath', back: 'i-undo', selall: 'i-selectall', cancel: 'i-close', selbox: 'i-selbox', sellasso: 'i-lasso', modescreen: 'i-crosshair', modevalue: 'i-ruler', mirrorkeep: 'i-copyobj', mirrorx: 'i-mirror-x', mirrory: 'i-mirror' };
const CMD_ICON_ONLY = new Set(['selbox', 'sellasso', 'mirrorx', 'mirrory']);   // yalnız simge: beş düğme 412 px'te tek satıra sığsın; ad başlık / aria-label'da
function cmdBtnHtml(attr, k, label) {
  const lbl = String(label == null ? '' : label).replace(/^[✓↶✕⟲←]+\s*/, '');
  const ic = CMD_ICON[k];
  const on = !!tools && ((k === 'selbox' && tools.selMode === 'box') || (k === 'sellasso' && tools.selMode === 'lasso') || (k === 'modescreen' && tools.mode === 'screen') || (k === 'modevalue' && tools.mode === 'value') || (k === 'mirrorkeep' && tools.mirrorKeep === true) || (k === 'mirrorx' && tools.mirrorAxis === 'x') || (k === 'mirrory' && tools.mirrorAxis === 'y'));
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
  $('cmdText').textContent = text;
  const inp = $('cmdInput');
  inp.hidden = !opts.input;
  { const en = $('cmdEnter'); if (en) en.hidden = !opts.input; }   // giriş yokken Enter da yok: seçim kipinde işlevsizdi, yer kaplıyordu
  inp.placeholder = opts.input === 'number' ? t('numberPh') : t('coordPh');
  inp.type = 'text'; inp.value = '';
  $('cmdBtns').innerHTML = (opts.buttons || []).map(k => cmdBtnHtml('data-cmd', k, t(BTN[k][0]))).join('');
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
  // Komut listesine tek kapı: boştaki çubuğun "?" düğmesi. Menüye gömülseydi komut satırını
  // yeni gören kullanıcı hangi adları yazabileceğini hiç öğrenemezdi.
  $('cmdBtns').innerHTML = `<button type="button" class="icon" data-cmd-help="1" aria-label="${esc(t('cmdHelp'))}" title="${esc(t('cmdHelp'))}"><svg class="ic" aria-hidden="true"><use href="#i-help"/></svg></button>`;
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
  const c = acadResolve(raw);
  if (!c) { api.toast(t('cmdUnknown').replace('%s', raw.toUpperCase()), 2200); return false; }
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
  if (c.id === 'layers' && /^-/.test(raw.replace(/^['_]+/, ''))) { layerCli(); return true; }
  if (c.id === 'osnapset' && /^-/.test(raw.replace(/^['_]+/, ''))) { osnapCli(); return true; }
  act(c.id);
  return true;
}
function bindCmdBar() {
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
function updateLayerButton() { const b = $('tbLayer'); if (b) b.querySelector('.lb').textContent = ed.curLayer.length > 10 ? ed.curLayer.slice(0, 9) + '…' : ed.curLayer; }
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
function showProps() {
  if (!needModel()) return;
  if (!ed.sel.size) { api.toast(t('selectFirstQ')); return; }
  const first = [...ed.sel][0];
  api.openDoc(`${t('propsTitle')} (${ed.sel.size} ${t('objectsN')})`, api.kv([[t('layer'), layerSelectHtml('pLayer', first.lay), 1], [t('color'), colorSwatches(first.info ? first.info.ci : 256), 1],
    [`<div class="full btns"><button class="btn primary small" id="pOk">${esc(t('apply'))}</button></div>`]]));
  let ci = null;
  $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-ci]'); if (b) { ci = Number(b.dataset.ci); document.querySelectorAll('#docBody [data-ci]').forEach(x => x.classList.toggle('active', x === b)); } };
  $('pOk').onclick = () => {
    const cmd = { op: 'props', keys: [...ed.sel].map(p => p.key), layer: $('pLayer').value };
    if (ci != null) cmd.color = ci;
    doc.run(cmd); refreshUndo(); api.requestRender(); api.hide('docPanel'); api.toast(t('propsApplied'));
  };
}

/*
 * SEÇİM MENÜSÜ — rozete dokununca açılır: seçime uygulanan işlemler tek yerde (Sil, Kopyala, Taşı,
 * Blok yap, Döndür, Ayna, Ölçek, Renk, Çizgi tipi, Katman, Özellikler, Seçimi bırak). Dönüşüm
 * araçları seçimi koruyarak başlar ve doğrudan taban noktasını sorar; renk / çizgi tipi / katman
 * tek dokunuşla uygulanır ve tek geri alma adımı üretir.
 */
const SEL_MENU = [['del', 'i-erase'], ['copy', 'i-copyobj'], ['move', 'i-move'], ['block', 'i-block'], ['rotate', 'i-rotate'], ['mirror', 'i-mirror'], ['scale', 'i-scale'], ['color', 'i-palette'], ['ltype', 'i-ltype'], ['layer', 'i-layers'], ['props', 'i-props'], ['clear', 'i-close']];
const selMenuLabel = (id) => ({ block: t('selMakeBlock'), color: t('color'), ltype: t('ltype'), layer: t('selChangeLayer'), clear: t('selClear'), props: tileLabel('props'), dimedit: t('dimSelMenu') }[id] || tileLabel('t:' + id));
const selDimPrim = () => [...ed.sel].find(p => p.info && p.info.t === 'DIMENSION' && (p.info.gid || p.info.dim));
function selMenu() {
  if (!ed.sel.size) { api.toast(t('selEmpty')); return; }
  // seçimde ölçülendirme varsa "Ölçü özellikleri" kartı da gelir (Özellikler'in önünde)
  const items = selDimPrim() ? [...SEL_MENU.slice(0, 10), ['dimedit', 'i-dimedit'], ...SEL_MENU.slice(10)] : SEL_MENU;
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
    case 'block': api.action('blocklib'); break;
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
    case 'dimedit': { const p = selDimPrim(); if (!p) { api.toast(t('notDim')); return; } if (!gate('t:dimedit')) return; void tools.editDim(p); break; }
    case 'clear': if (tools.running && tools.active === 'select') { tools.cancel(); markActive(null); } ed.sel.clear(); api.drawOverlay(); break;
    default: break;
  }
}
ed.selMenu = selMenu; ed.selAction = selAction;
{ const b = $('selBadge'); if (b) b.addEventListener('click', () => selMenu()); }

// ---------------------------------------------------------------------------------
// DXF kaydetme
// ---------------------------------------------------------------------------------
const UNIT_CODE = { mm: 4, cm: 5, m: 6, km: 7, dm: 14, 'inç': 1, ft: 2 };
function saveDxf(onlyEdited) {
  if (!needDoc()) return;
  const model = S.scene.layouts[0];
  if (onlyEdited && !(doc && doc.dirty)) { api.toast(t('noChanges')); return; }
  const text = writeDxf(model.prims, S.layers, { onlyEdited, ltypes: S.ltypes, units: UNIT_CODE[S.units] || 0 });
  const name = api.baseName() + (onlyEdited ? '_degisiklikler' : '_duzenlenmis') + '.dxf';
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
  const text = writeDxf(S.scene.layouts[0].prims, S.layers, { onlyEdited: !!onlyEdited, ltypes: S.ltypes, units: UNIT_CODE[S.units] || 0 });
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
 * Yalnız TEK bir yol ilkeli seçiliyken görünür; çoklu seçimde hangi yolun düğümü olduğu
 * anlaşılmaz ve tutamaklar birbirine girer.
 */
function gizmoVertLayout() {
  if (!ui.grips || !gizmoOn() || ed.sel.size !== 1) return null;
  const p = [...ed.sel][0];
  if (!p || p.k !== 0) return null;
  if (p.info && p.info.t === 'DIMENSION') return null;   // ölçü parçası tutamakla bükülmez: tanımı bozulur, "Ölçüyü düzenle" ile değişir
  const vs = Gz.vertsOf(p);
  if (!vs.length) return null;
  const VL = Gz.layoutVerts(vs, toScreen, { fs: ui.fontScale, glove: ui.glove });
  return VL ? { p, vs, VL } : null;
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
function drawSelDrag(c) {
  const d = selDrag; if (!d) return;
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
ed.gizmoDown = (sx, sy) => {
  if (selDragArmed()) { selDrag = { mode: tools.selMode, pts: [[sx, sy]], x0: sx, y0: sy, x1: sx, y1: sy, crossing: null }; return true; }
  /*
   * AutoCAD'in ÖRTÜK PENCERESİ: seçim aşamasında (Seç aracı ya da Taşı / Sil gibi araçların nesne seçimi)
   * BOŞ yere basıp sürüklemek kutu seçer — soldan sağa mavi pencere (içindekiler), sağdan sola yeşil kesen
   * (dokunanlar). Nesneye dokunmak onu seçer, iki parmak kaydırır. Parmak kıpırdamadan kalkarsa bu bir dokunuştur
   * ve olağan dokunma yoluna verilir (boş yere dokunmak zaten bir şey seçmez).
   */
  if (tools && tools.running && tools.selecting && tools.selMode === 'tap' && !ed.is3D() && !api.pick(toWorld(sx, sy))) {
    selDrag = { mode: 'box', implied: true, pts: [[sx, sy]], x0: sx, y0: sy, x1: sx, y1: sy, crossing: null };
    return true;
  }
  const L = gizmoLayout(); if (!L) return false;
  const G = gizmoVertLayout();
  const kind = Gz.hit(sx, sy, L, G && G.VL); if (!kind) return false;
  if (!gate(Gz.needOf(kind))) return true;   // yetki yoksa jest yine yutulur: kutu açıldı
  if (String(kind).startsWith('v:')) {
    const vi = +kind.slice(2);
    giz = { kind, vi, prim: G.p, ops0: G.p.ops.map(o => o.slice()), w0: toWorld(sx, sy), p: null, m: null, info: null };
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
  if (giz.vi != null) {
    // Bırakma noktası yakalamaya oturur: düğüm bir başka çizginin ucuna TAM denk gelsin diye.
    const w = toWorld(sx, sy), sn = api.snapPeek ? api.snapPeek(w, { grip: true }) : api.snap(w), q = sn ? sn.p : w;   // tutamak sürüklemesi NOKTA işidir: yakalama orada çalışır
    giz.p = [q[0], q[1]];
    giz.info = { tip: 'vertex', dx: q[0] - giz.ops0[giz.vi][1], dy: q[1] - giz.ops0[giz.vi][2] };
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
  if (g.vi != null) {
    const kip = g.p && (Math.abs(g.p[0] - g.ops0[g.vi][1]) > 0 || Math.abs(g.p[1] - g.ops0[g.vi][2]) > 0);
    if (commit && kip && doc) {
      doc.run({ op: 'reshape', items: [{ key: g.prim.key, ops: Gz.movedOps(g.ops0, g.vi, g.p[0], g.p[1]) }] });
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
    for (const p of ed.sel) {
      if (p.k === 0) {
        c.beginPath();
        api.tracePath(c, surukVi && surukVi.prim === p ? Gz.movedOps(surukVi.ops0, surukVi.vi, surukVi.p[0], surukVi.p[1]) : p.ops);
        if (p.closed) c.closePath();
        c.stroke();
      } else api.strokeWorldRect(c, p.bb);
    }
    c.restore(); c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    const L = gizmoLayout();
    if (L) {
      Gz.draw(c, L, { line: acc, fill: bgColor(), ink: acc }, { fs: ui.fontScale });
      const G = gizmoVertLayout();
      if (G) Gz.drawVerts(c, G.VL, { line: acc, fill: bgColor(), ink: acc }, { fs: ui.fontScale, active: giz && giz.vi != null ? giz.vi : -1 });
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
  rebuildRow('display'); refreshTiles(); statusMode3D();
  D.refreshNav();
}
export function exit3D() {
  $('cv3d').hidden = true; document.body.classList.remove('mode3d'); ed.m3 = null; showPrompt(null);
  if (v3) v3.stopTurntable();
  const c3 = $('cube3d'); if (c3) c3.hidden = true;
  closePop();
  const p = $('displayPanel'); if (p && !p.hidden && p.querySelector('#displaySeg [data-seg="3d"].on')) D.closeDisplayOptions();
  rebuildRow('display'); refreshTiles(); statusMode3D();
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
const p3 = { pointers: new Map(), last: null, d0: 0, mid0: null, ang0: 0, moved: false, snap: null, snapKind: null, pts: [], lastTap: 0, lastTapAt: null };
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
  });
  cv.addEventListener('pointermove', (ev) => {
    ev.stopPropagation();
    if (!p3.pointers.has(ev.pointerId)) return;
    p3.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const g = geom(), t = touch();
    if (g.n === 1) {
      const dx = ev.clientX - p3.last[0], dy = ev.clientY - p3.last[1];
      if (Math.hypot(dx, dy) > 2) p3.moved = true;
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
 * 3B'de nokta toplama. Eskiden tek yol KÖŞEYE dokunmaktı: eğrisel bir yüzeyin ortasından ölçü
 * alınamıyordu, kullanıcı en yakın köşeye razı olmak zorundaydı. Artık üç kip var:
 *   vertex  — yalnız köşe (eski davranış; kot ve tutamak işleri için kesin nokta gerekir)
 *   surface — yalnız yüzey (ışın-üçgen kesişimi; yüzeyin üstünde serbest nokta)
 *   auto    — önce köşe, köşe yoksa yüzey (varsayılan)
 * Yüzey seçimi 'target3' kapısına bağlıdır; kapı kapalıysa kip zorla 'vertex' olur, yani
 * ücretsiz sürümde bugünkü davranış birebir korunur.
 */
function pick3At(sx, sy) {
  const kip = has('target3') ? (ui.pick3 || 'auto') : 'vertex';
  const tol = ui.glove ? 30 : 22;
  if (kip !== 'surface') {
    const h = v3.pickVertex(sx, sy, tol);
    if (h) return { p: h.p, prim: h.prim, kind: 'vtx' };
    if (kip === 'vertex') return null;
  }
  const s2 = v3.pickSurface(sx, sy);
  return s2 ? { p: s2.p, prim: s2.prim, kind: 'srf', n: s2.n } : null;
}
function tap3D(sx, sy) {
  const hit = pick3At(sx, sy);
  if (!ed.m3) {
    ed.sel.clear();
    if (hit) { ed.sel.add(hit.prim); api.showInfo(hit.prim); haptic('snap'); } else api.hide('infoPanel');
    v3.setSelection(ed.sel); v3.render(); overlay3D();
    return;
  }
  const m = ed.m3;
  if (m.name === 'select') { if (hit) { if (ed.sel.has(hit.prim)) ed.sel.delete(hit.prim); else ed.sel.add(hit.prim); prompt3D(); haptic('snap'); } v3.setSelection(ed.sel); v3.render(); overlay3D(); return; }
  if (!hit) { api.toast(has('target3') && (ui.pick3 || 'auto') !== 'vertex' ? t('tapVertexOrSurface') : t('tapVertex')); return; }
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

async function start3DTool(name) {
  if (!gate('3:' + name)) { markActive(null); return; }
  ed.m3 = { name, pts: [] };
  if (name === 'setz') {
    if (!ed.sel.size) { api.toast(t('select3First')); ed.m3 = null; return; }
    const v = await askText(t('zPrompt'), '', { type: 'number' }); const z = parseFloat(String(v || '').replace(',', '.'));
    if (isFinite(z)) { doc.run({ op: 'setz', keys: [...ed.sel].map(p => p.key), z }); refreshUndo(); refresh3D(); v3.render(); api.toast(t('zSet')); }
    ed.m3 = null; markActive(null); return;
  }
  if (name === 'del') {
    if (!ed.sel.size) { api.toast(t('select3First')); ed.m3 = null; return; }
    doc.run({ op: 'delete', keys: [...ed.sel].map(p => p.key) }); ed.sel.clear(); refreshUndo(); refresh3D(); v3.render(); overlay3D(); api.toast(t('deleted')); ed.m3 = null; markActive(null); return;
  }
  if (name === 'move' && !ed.sel.size) { api.toast(t('select3First')); ed.m3 = null; return; }
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
  const hedef = has('target3') && (ui.pick3 || 'auto') !== 'vertex' ? ' · ' + t(PICK3.find(x => x[0] === (ui.pick3 || 'auto'))[1]) : '';
  const txt = m.name === 'geo'
    ? `${t('geo3_' + m.mode)} · ` + (adim
      ? `${t(adim.part)} · ${adim.index + 1}. ${t('pointsN')}${adim.optional ? ' (' + t('optionalPt') + ')' : ''} [${m.pts.length}/${m.need}]`
      : `${t('geo3Pick')} [${m.pts.length}/${m.need}]`)
    : m.name === 'note' ? t('p3Note')
      : { select: `${t('p3Select')} [${ed.sel.size} ${t('selCount')}]`, dist: m.pts.length ? t('p3Dist2') : t('p3Dist1'), move: m.pts.length ? t('p3Move2') : t('p3Move1'), pline: `${t('p3Pline')} [${m.pts.length} ${t('pointsN')}] · ${t('finish')}` }[m.name];
  // 3B istemi çubuğu showPrompt'tan GEÇMEDEN kurar; "boşta" bayrağı elle kapatılmazsa burada
  // yazılan koordinat komut adı sanılır ve 3B polyline'a nokta eklenemez.
  cmdIdle = false; closeSuggest();
  $('cmdBar').hidden = false; $('cmdText').textContent = txt + (m.name === 'geo' || m.name === 'dist' ? hedef : '');
  $('cmdInput').hidden = m.name !== 'pline'; $('cmdInput').placeholder = 'x,y,z';
  $('cmdBtns').innerHTML = (m.name === 'pline' ? cmdBtnHtml('data-cmd3', 'finish', t('finishBtn')) : '') + (m.pts.length ? cmdBtnHtml('data-cmd3', 'back', t('backBtn')) : '') + cmdBtnHtml('data-cmd3', 'cancel', t('cancelBtn'));
  $('cmdBtns').onclick = (ev) => {
    const b = ev.target.closest('[data-cmd3]'); if (!b) return;
    const k = b.dataset.cmd3;
    if (k === 'cancel') { ed.m3 = null; showPrompt(null); markActive(null); overlay3D(); }
    else if (k === 'back') { m.pts.pop(); prompt3D(); overlay3D(); }
    else if (k === 'finish') { if (m.pts.length >= 2) { doc.run({ op: 'add', ents: [{ type: 'POLYLINE3D', pts: m.pts.slice(), id: newId(), layer: ed.curLayer, color: ed.curColor }] }); refreshUndo(); refresh3D(); v3.render(); api.toast(t('pline3Added')); } m.pts = []; ed.m3 = null; showPrompt(null); markActive(null); overlay3D(); }
  };
}
function typed3D(v) {
  const m = ed.m3; if (!m || m.name !== 'pline') return;
  const parts = v.split(/[;,\s]+/).map(x => parseFloat(x.replace(',', '.'))).filter(x => isFinite(x));
  if (parts.length < 2) { api.toast(t('typeXyz')); return; }
  m.pts.push([parts[0], parts[1], parts[2] || 0]); prompt3D(); overlay3D();
}
/** 3B üstüne 2B kaplama: HUD (kamera, eksen etiketleri, lejant, pusula), toplanan noktalar, yakalama işareti */
function overlay3D() {
  if (!ed.is3D()) return;
  const ov = $('ov'), c = ov.getContext('2d');
  c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); c.clearRect(0, 0, S.W, S.H);
  try { v3.drawHud(c, { fg: fgColor(), W: S.W, H: S.H, units: S.units || '', fmt, sel: ed.sel, gestureActive: S.gestureActive, fontScale: ui.fontScale }); } catch (e) { console.warn(e); }
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
  // Yakalanan nokta: KÖŞE kare, YÜZEY çemberdir — kullanıcı neye oturduğunu ayırt edebilmelidir
  if (p3.snap) {
    const s = v3.project(p3.snap[0], p3.snap[1], p3.snap[2]);
    c.strokeStyle = '#3ddc84'; c.lineWidth = 2;
    if (p3.snapKind === 'srf') { c.beginPath(); c.arc(s[0], s[1], 7, 0, Math.PI * 2); c.stroke(); }
    else c.strokeRect(s[0] - 7, s[1] - 7, 14, 14);
  }
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
    sw('glove', t('glove')) + sw('leftHand', t('leftHand')) + sw('contrast', t('contrast')) + sw('reduceMotion', t('reduceMotion')) + sw('haptics', t('haptics')) + sw('dpad', t('dpad')) + sw('compactStatus', t('compactStatus')) +
    sw('gizmo', t('gizmoOn')) + sw('grips', t('gripsOn')) + sw('cmdLine', t('cmdLineOn')) + sw('infoTap', t('infoTap')) +
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
  if (k === 'Enter' && tools.running) { if (!(tools.enterEmpty && tools.enterEmpty())) tools.finish(); return true; }   // Ekran / Ölçü araçlarında boş Enter son değeri alır
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
  haptic('toggle'); refreshTiles(); api.drawOverlay();
  api.toast(t(S.desk.ortho ? 'orthoOn' : 'orthoOff'), 1200);
}
function togglePolar() {
  S.desk.polar = !S.desk.polar;
  if (S.desk.polar) S.desk.ortho = false;
  haptic('toggle'); refreshTiles(); api.drawOverlay();
  api.toast(t(S.desk.polar ? 'polarOn' : 'polarOff') + (S.desk.polar ? ' · ' + S.desk.polarStep + '°' : ''), 1400);
}
export const editor = ed;
