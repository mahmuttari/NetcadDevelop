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
import { openView3DOptions, buildViewCube, openCameraBookmarks, renderStyle, renderZScale, renderClip, renderPresets } from './view3d_panel.js';
import { FG, ACI } from './scene.js';
import { toScreen, toWorld, fmt, store } from './state.js';
import { bgColor, fgColor } from './render.js';
import { t, getLang, applyI18n, addStrings } from './i18n.js';
import { TAU } from './geom.js';
import * as D from './display.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };
let api, S, tools, doc = null, v3 = null;
const ed = { is3D: () => !!(v3 && !$('cv3d').hidden), tools: null, doc: null, curLayer: '0', curColor: 256, tab: 'view', sel: new Set(), result: null, m3: null };

// ---------------------------------------------------------------------------------
// Kullanım tercihleri (ui) — kalıcı anahtar 'ui'
// ---------------------------------------------------------------------------------
const UI_DEFAULTS = { favs: [], tbCollapsed: { portrait: false, landscape: false }, hints: {}, fontScale: 1, glove: false, leftHand: false, contrast: false, reduceMotion: false, haptics: true, dpad: false, compactStatus: false };
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
    { cap: 'grpPanels', items: [T('layers', 'i-layers', 'Katmanlar', 'Layers', 'Katman görünürlüğü, izolasyon, soldurma', 'Layer visibility, isolate, fade'), T('search', 'i-search', 'Ara', 'Search', 'Yazı, katman, blok, öznitelik ara', 'Find text, layers, blocks'), T('info', 'i-info', 'Bilgi', 'Info', 'Çizim bilgisi', 'Drawing info'), T('views', 'i-bookmark', 'Görünümler', 'Views', 'Kayıtlı görünümler ve yer imleri', 'Saved views'), T('layouts', 'i-layout', 'Sayfalar', 'Layouts', 'Model / kâğıt sayfa düzenleri', 'Model / paper layouts'), T('notes', 'i-pen', 'Notlar', 'Notes', 'Kırmızı kalem notları', 'Redline notes'), T('gps', 'i-gps', 'GPS', 'GPS', 'Konumu çizimde gösterir', 'Show position on the drawing'), T('basemap', 'i-map', 'Altlık', 'Basemap', 'Harita altlığı', 'Map basemap'), T('compare', 'i-compare', 'Karşılaştır', 'Compare', 'İki revizyonu karşılaştırır', 'Compare two revisions'), T('drive', 'i-map', 'Drive', 'Drive', 'Google Drive: dosya aç, yükle', 'Google Drive: open and upload files'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options', 'Tema, ön ayarlar, süzgeçler, çizgiler, ızgara…', 'Theme, presets, filters, lines, grid…')] },
    { cap: 'grpOut', items: [T('pdf', 'i-pdf', 'PDF', 'PDF', 'Ölçekli PDF oluşturur', 'Create a scaled PDF'), T('png', 'i-image', 'PNG', 'PNG', 'Görünümü resim olarak kaydeder', 'Save the view as an image'), T('savedxf', 'i-save', 'DXF kaydet', 'Save DXF', 'Düzenlenmiş çizimi DXF olarak kaydeder', 'Save the edited drawing as DXF'), T('savedelta', 'i-export', 'Değişiklikler', 'Changes', 'Yalnız değişen nesneleri DXF olarak kaydeder', 'Save only changed objects')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo'), T('more', 'i-more', 'Diğer', 'More', 'Diğer işlevler menüsü', 'More functions')] } ] },
  { id: 'display', i18n: 'tabDisplay', icon: 'i-sliders', groups: [] },   // satır içeriği 2B/3B'ye göre üretilir
  { id: 'measure', i18n: 'tabMeasure', icon: 'i-dist', groups: [
    { cap: 'grpMeasure', items: [T('t:dist', 'i-dist', 'Mesafe', 'Distance', 'Noktalar arası mesafe, ΔX/ΔY, açı', 'Distance between points'), T('t:area', 'i-area', 'Alan', 'Area', 'Kapalı alan ve çevre', 'Closed area and perimeter'), T('t:angle', 'i-angle', 'Açı', 'Angle', 'Üç noktayla açı', 'Angle by three points'), T('t:radius', 'i-radius', 'Yarıçap', 'Radius', 'Daire / yay yarıçapı', 'Circle / arc radius'), T('t:coord', 'i-coord', 'Koordinat', 'Coordinate', 'Noktanın koordinatını okur', 'Read point coordinates'), T('profile', 'i-profile', 'Profil', 'Profile', 'Kot / eğim profili', 'Elevation / slope profile')] },
    { cap: 'grpHelpers', items: [T('osnap', 'i-snap', 'Yakalama', 'Osnap', 'Nesne yakalamayı açar / kapatır', 'Toggle object snap'), T('grid', 'i-grid', 'Izgara', 'Grid'), T('crosshair', 'i-crosshair', 'Artı imleç', 'Crosshair')] } ] },
  { id: 'draw', i18n: 'tabDraw', icon: 'i-pen', groups: [
    { cap: 'grpDraw2', items: [T('t:line', 'i-line', 'Çizgi', 'Line', 'İki nokta ya da @uzunluk<açı', 'Two points or @length<angle'), T('t:pline', 'i-pline', 'Polyline', 'Polyline', 'Çok köşeli çizgi; Bitir / Kapat', 'Multi-vertex line'), T('t:rect', 'i-rect', 'Dikdörtgen', 'Rectangle'), T('t:circle', 'i-circle', 'Daire', 'Circle', 'Merkez + yarıçap', 'Center + radius'), T('t:arc3', 'i-arc', 'Yay', 'Arc', 'Üç noktadan yay', 'Three-point arc'), T('t:point', 'i-point', 'Nokta', 'Point'), T('t:text', 'i-text', 'Yazı', 'Text', 'Konum, metin ve yükseklik', 'Position, text and height')] },
    { cap: 'grpDraw3', items: [T('t:pline3d', 'i-pline3d', '3B Polyline', '3D Polyline', 'x,y,z köşeli çizgi', 'Vertices with z'), T('t:face3d', 'i-face', '3B Yüzey', '3D Face', 'Üç / dört köşeli yüzey', 'Three / four vertex face')] },
    { cap: 'grpCur', items: [T('layer', 'i-layers', 'Katman', 'Layer', 'Geçerli katman ve yeni katman', 'Current layer'), T('color', 'i-palette', 'Renk', 'Color', 'Geçerli renk (ACI)', 'Current color')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: 'edit', i18n: 'tabEdit', icon: 'i-select', groups: [
    { cap: 'grpSel', items: [T('t:select', 'i-select', 'Seç', 'Select', 'Dokunarak seçim; Tümü düğmesiyle hepsi', 'Tap to select'), T('props', 'i-props', 'Özellikler', 'Properties', 'Seçimin katmanı ve rengi', 'Layer and color of the selection')] },
    { cap: 'grpXform', items: [T('t:move', 'i-move', 'Taşı', 'Move'), T('t:copy', 'i-copy', 'Kopyala', 'Copy'), T('t:rotate', 'i-rotate', 'Döndür', 'Rotate'), T('t:scale', 'i-scale', 'Ölçekle', 'Scale'), T('t:mirror', 'i-mirror', 'Aynala', 'Mirror'), T('t:offset', 'i-offset', 'Ofset', 'Offset')] },
    { cap: 'grpModify', items: [T('t:del', 'i-trash', 'Sil', 'Delete'), T('t:setz', 'i-z', 'Kot ata', 'Set Z', 'Seçime Z kotu atar', 'Assign elevation'), T('t:edittext', 'i-edittext', 'Yazı düzenle', 'Edit text')] },
    { cap: 'grpHist', items: [T('undo', 'i-undo', 'Geri al', 'Undo'), T('redo', 'i-redo', 'Yinele', 'Redo')] } ] },
  { id: '3d', i18n: 'tab3d', icon: 'i-cube', groups: [
    { cap: 'grpView3', items: [T('3d', 'i-3d', '3B aç/kapat', '3D on/off', 'Tek parmak döndürür, iki parmak kaydırır / yakınlaştırır', 'One finger orbits, two fingers pan / zoom'), T('fit3', 'i-fit', 'Sığdır', 'Fit'), T('v:iso', 'i-iso', 'İzometrik', 'Isometric'), T('v:top', 'i-top', 'Üst', 'Top'), T('v:front', 'i-front', 'Ön', 'Front'), T('v:left', 'i-left', 'Sol', 'Left'), T('v:right', 'i-right', 'Sağ', 'Right'), T('v:back', 'i-back', 'Arka', 'Back'), T('v:bottom', 'i-bottom', 'Alt', 'Bottom')] },
    { cap: 'grpCam3', items: [T('persp', 'i-eye', 'Perspektif', 'Perspective', 'Perspektif / ortografik', 'Perspective / orthographic'), T('zscale', 'i-zscale', 'Z abartı', 'Z scale', 'Düşey abartı çarpanı', 'Vertical exaggeration'), T('cam3', 'i-camera', 'Yer imleri', 'Bookmarks', 'Kamera konumlarını kaydeder', 'Save camera positions'), T('turn3', 'i-turn', 'Döner tabla', 'Turntable')] },
    { cap: 'grpStyle3', items: [T('vstyle', 'i-vs-wireframe', 'Görsel stil', 'Visual style', 'Tel kafes, gizli çizgi, gölgeli, gerçekçi, kavramsal, gri, eskiz, röntgen', 'Wireframe, hidden, shaded, realistic, conceptual, gray, sketchy, x-ray'), T('color3', 'i-palette', 'Renk', 'Color', 'Nesne, katman, kot, tek renk', 'Entity, layer, elevation, mono'), T('clip3', 'i-clip', 'Kesit', 'Clip', 'Z aralığı ve kesit kutusu', 'Z range and clip box'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options')] },
    { cap: 'grpTools3', items: [T('3:select', 'i-select', 'Seç', 'Select'), T('3:dist', 'i-dist', '3B mesafe', '3D distance', 'Köşeler arası eğik mesafe, ΔZ, eğim', 'Slope distance between vertices'), T('3:move', 'i-move', 'Taşı (3B)', 'Move (3D)'), T('3:pline', 'i-pline3d', '3B Polyline', '3D Polyline'), T('3:setz', 'i-z', 'Kot ata', 'Set Z'), T('3:del', 'i-trash', 'Sil', 'Delete'), T('undo', 'i-undo', 'Geri al', 'Undo')] } ] },
];
const DISPLAY_2D = [
  { cap: 'grpTheme', items: [T('theme', 'i-theme', 'Koyu / açık', 'Dark / light', 'Arka plan temasını değiştirir', 'Switch the background theme'), T('sun', 'i-sun', 'Güneş', 'Sun', 'Güneş altında okunaklı yüksek kontrast', 'High contrast for sunlight'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options', 'Tema, ön ayarlar, süzgeçler, çizgiler, ızgara…', 'Theme, presets, filters, lines, grid…')] },
  { cap: 'grpVis', items: [T('text', 'i-text', 'Yazı', 'Text'), T('hatch', 'i-hatch', 'Tarama', 'Hatch'), T('dim', 'i-dim', 'Ölçüler', 'Dimensions'), T('points', 'i-point', 'Noktalar', 'Points'), T('images', 'i-image', 'Resimler', 'Images')] },
  { cap: 'grpLines', items: [T('lw', 'i-lw', 'Kalınlık', 'Lineweight', 'Çizgi kalınlıklarını gösterir', 'Show lineweights'), T('mono', 'i-mono', 'Tek renk', 'Mono', 'Tek renk / nesne rengi', 'Monochrome / entity color'), T('ltype', 'i-fade', 'Çizgi tipi', 'Linetype')] },
  { cap: 'grpHelpers', items: [T('grid', 'i-grid', 'Izgara', 'Grid'), T('crosshair', 'i-crosshair', 'Artı imleç', 'Crosshair'), T('rulers', 'i-ruler', 'Cetvel', 'Rulers'), T('fade', 'i-fade', 'Soldur', 'Fade', 'Seçili olmayan katmanları soldurur', 'Fade other layers')] },
];
const DISPLAY_3D = [
  { cap: 'grpStyle3', items: [T('vstyle', 'i-vs-wireframe', 'Görsel stil', 'Visual style'), T('color3', 'i-palette', 'Renk', 'Color'), T('light3', 'i-light', 'Işık', 'Light', 'Gölgeli stilde aydınlatma', 'Lighting in shaded styles'), T('display', 'i-sliders', 'Ekran ayarları', 'Display options')] },
  { cap: 'grpHelpers', items: [T('grid3', 'i-grid', 'Izgara', 'Grid'), T('axes3', 'i-axes', 'Eksenler', 'Axes'), T('cube3', 'i-3d', 'Küp', 'Cube', 'Görünüm küpü', 'View cube'), T('hud3', 'i-info', 'Bilgi', 'HUD', 'Kamera bilgisi', 'Camera info'), T('shadow3', 'i-sun', 'Gölge', 'Shadow', 'Zemin gölgesi', 'Ground shadow'), T('sil3', 'i-cube', 'Siluet', 'Silhouette', 'Siluet kenarları', 'Silhouette edges')] },
  { cap: 'grpCam3', items: [T('zscale', 'i-zscale', 'Z abartı', 'Z scale'), T('clip3', 'i-clip', 'Kesit', 'Clip'), T('turn3', 'i-turn', 'Döner tabla', 'Turntable'), T('persp', 'i-eye', 'Perspektif', 'Perspective')] },
];
const TILE = {};
function registerTiles() {
  const tr = {}, en = {};
  const reg = (it) => { TILE[it.act] = it; tr['tl_' + it.act] = it.tr; en['tl_' + it.act] = it.en; tr['th_' + it.act] = it.htr; en['th_' + it.act] = it.hen; };
  for (const tab of TABS) for (const g of tab.groups) for (const it of g.items) reg(it);
  for (const g of DISPLAY_2D) for (const it of g.items) reg(it);
  for (const g of DISPLAY_3D) for (const it of g.items) reg(it);
  addStrings(tr, en);
}
registerTiles();
const tileLabel = (act) => { const it = TILE[act]; if (!it) return act; return getLang() === 'en' ? it.en : it.tr; };
const tileHint = (act) => { const it = TILE[act]; if (!it) return ''; return getLang() === 'en' ? it.hen : it.htr; };
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;

// ---------------------------------------------------------------------------------
// Başlatma
// ---------------------------------------------------------------------------------
export function initEditor(a) {
  api = a; S = a.S;
  tools = new ToolManager({
    snap: (w) => api.snap(w),
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
    fmt,
    copy: (t) => api.copyText(t),
    lonLat: (x, y) => S.geo.active ? S.geo.toLonLat(x, y) : null,
    visiblePrims: () => S.prims.filter(p => !(S.layers.get(p.lay) && !S.layers.get(p.lay).visible)),
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
  window.addEventListener('dwg:view3d', (ev) => { refreshTiles(); if (ev.detail && ['cube', 'hud', 'hudPos'].includes(ev.detail.key)) syncCube(); statusMode3D(); });
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
  });
  ed.doc = doc;
  const n = doc.load();
  if (n) api.toast(`${n} kayıtlı düzenleme uygulandı`);
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
  document.querySelectorAll('#toolbar [data-act="undo"]').forEach(b => { b.disabled = cu; });
  document.querySelectorAll('#toolbar [data-act="redo"]').forEach(b => { b.disabled = cr; });
  document.querySelectorAll('#toolbar [data-act="savedxf"], #toolbar [data-act="savedelta"]').forEach(b => b.classList.toggle('dirty', !!(doc && doc.dirty)));
}

// ---------------------------------------------------------------------------------
// Şerit: sekmeler › gruplar › karolar
// ---------------------------------------------------------------------------------
const tileId = (act, tabId) => act === 'undo' && tabId === 'view' ? 'tbUndo' : act === 'redo' && tabId === 'view' ? 'tbRedo' : act === 'savedxf' ? 'tbSave' : act === 'layer' ? 'tbLayer' : '';
function tileHtml(it, tabId) {
  const id = tileId(it.act, tabId);
  return `<button type="button" data-act="${esc(it.act)}"${id ? ` id="${id}"` : ''} class="${ui.favs.includes(it.act) ? 'fav-mark' : ''}" data-i18n-title="tl_${esc(it.act)}" title="${esc(tileLabel(it.act))}" aria-label="${esc(tileLabel(it.act))}">${ICON(it.icon)}<span class="lb" data-i18n="tl_${esc(it.act)}">${esc(tileLabel(it.act))}</span></button>`;
}
function groupHtml(g, tabId) {
  return `<div class="tb-group"><div class="tb-tiles">${g.items.map(it => tileHtml(it, tabId)).join('')}</div><div class="tb-caption" data-i18n="${esc(g.cap)}">${esc(t(g.cap))}</div></div>`;
}
function rowGroups(tab) {
  if (tab.id === 'display') return ed.is3D() ? DISPLAY_3D : DISPLAY_2D;
  if (tab.id === 'fav') { const items = ui.favs.filter(a => TILE[a]).map(a => TILE[a]); return items.length ? [{ cap: 'grpFav', items }] : []; }
  return tab.groups;
}
function rowHtml(tab) {
  const gs = rowGroups(tab);
  const inner = gs.length ? gs.map(g => groupHtml(g, tab.id)).join('') : `<div class="tb-empty" data-i18n="favEmpty">${esc(t('favEmpty'))}</div>`;
  return `<div class="tb-row" data-for="${tab.id}" ${tab.id === ed.tab ? '' : 'hidden'}>${inner}</div>`;
}
function tabList() { return ui.favs.length ? [{ id: 'fav', i18n: 'tabFav', icon: 'i-star', groups: [] }, ...TABS] : TABS; }
function buildToolbar() {
  const tb = $('toolbar');
  const tabs = tabList();
  if (!tabs.some(x => x.id === ed.tab)) ed.tab = 'view';
  tb.innerHTML = `<div class="tb-tabs" role="tablist">${tabs.map(x => `<button type="button" role="tab" data-tab="${x.id}" class="${x.id === ed.tab ? 'active' : ''}${x.id === 'fav' ? ' tab-fav' : ''}" aria-selected="${x.id === ed.tab}">${ICON(x.icon)}<span data-i18n="${x.i18n}">${esc(t(x.i18n))}</span></button>`).join('')}<button type="button" class="tb-collapse" aria-label="${esc(tt('collapsed', 'Katla'))}">${ICON('i-chevron')}</button></div>` + tabs.map(rowHtml).join('');
  if (!tb.dataset.bound) {
    tb.dataset.bound = '1';
    tb.addEventListener('click', (ev) => {
      const tabBtn = ev.target.closest('[data-tab]');
      if (tabBtn) { if (tabBtn.dataset.tab === ed.tab && !$('toolbar').classList.contains('collapsed')) collapse(true); else { if ($('toolbar').classList.contains('collapsed')) collapse(false); setTab(tabBtn.dataset.tab); } haptic('step'); return; }
      if (ev.target.closest('.tb-collapse')) { collapse(!$('toolbar').classList.contains('collapsed')); return; }
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
  api && api.toast(tt(on ? 'collapsed' : 'expanded', on ? 'Araç çubuğu katlandı' : 'Araç çubuğu açıldı'), 1200);
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
    on.osnap = S.snapModes && S.snapModes.size > 0; on['3d'] = ed.is3D();
  }
  if (v3) { const o = v3.opts; on.grid3 = o.grid; on.axes3 = o.axes; on.cube3 = o.cube; on.hud3 = o.hud; on.light3 = o.light; on.turn3 = o.turntable; on.persp = v3.cam.persp; on.clip3 = !!o.clip; on.shadow3 = o.shadow; on.sil3 = o.silhouette; }
  document.querySelectorAll('#toolbar [data-act]').forEach(b => { const k = b.dataset.act; if (k in on) { b.classList.toggle('on', !!on[k]); b.setAttribute('aria-pressed', String(!!on[k])); } });
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
  const html = `<div class="pop-title">${esc(tileLabel(actName))}</div>${tileHint(actName) ? `<div class="pop-hint">${esc(tileHint(actName))}</div>` : ''}<div class="pop-row"><button type="button" class="btn small ${fav ? '' : 'primary'}" data-fav="${esc(actName)}">${ICON('i-star')}${esc(fav ? t('favRemove') : t('favAdd'))}</button></div>`;
  openPop(btn, html, { kind: 'tip' });
  const fb = $('tbPop').querySelector('[data-fav]');
  if (fb) fb.addEventListener('click', () => { toggleFav(actName); closePop(); });
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
/** 3B seçenek bölümünü açılır kutuda gösterir (zscale / style3 / clip3 / color3) */
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
function needModel() { if (!needDoc()) return false; if (!S.scene.layouts[S.layoutIndex].isModel) { api.toast('Düzenleme yalnız model uzayında yapılır.'); return false; } return true; }
function act(name, btn) {
  if (name.startsWith('t:')) { if (!needModel()) return; if (ed.is3D()) exit3D(); const tn = name.slice(2); if (tools.active === tn) { tools.cancel(); markActive(null); } else { tools.start(tn); markActive(name); } return; }
  if (name.startsWith('v:')) { if (!v3 || !ed.is3D()) { if (!needModel()) return; enter3D(); } if (v3) { v3.preset(name.slice(2), { animate: !ui.reduceMotion }); v3.render(); overlay3D(); } return; }
  if (name.startsWith('3:')) { if (!needModel()) return; if (!ed.is3D()) enter3D(); start3DTool(name.slice(2)); markActive(name); return; }
  const tog = { text: 'showText', hatch: 'showHatch', dim: 'showDim', points: 'showPoint', images: 'showImage', lw: 'lw', mono: 'colorMode', ltype: 'showLtype', grid: 'grid', crosshair: 'crosshair', rulers: 'rulers', fade: 'fade', sun: 'sun', theme: 'theme' };
  if (tog[name]) { D.toggleDisplay(tog[name]); haptic('toggle'); refreshTiles(); return; }
  switch (name) {
    case 'extents': api.zoomExtents(); break;
    case 'zoomwin': call(api.zoomWindow); break;
    case 'prevview': if (api.viewHistory) api.viewHistory.back(); break;
    case 'nextview': if (api.viewHistory) api.viewHistory.forward(); break;
    case 'goto': call(api.gotoCoord); break;
    case 'home': if (!D.gotoHome()) { api.zoomExtents(); api.toast(tt('noHome', 'Ana görünüm kaydedilmemiş; Görünümler › Ana görünüm yap'), 2500); } break;
    case 'layers': case 'search': case 'notes': case 'gps': case 'pdf': case 'png': case 'more': case 'profile': case 'info': case 'views': case 'layouts': case 'basemap': case 'compare': case 'drive': api.action(name); break;
    case 'osnap': toggleOsnap(); break;
    case 'display': call(api.openDisplayOptions, { seg: ed.is3D() ? '3d' : '2d' }); break;
    case 'undo': if (doc && doc.undo()) { refreshUndo(); api.requestRender(); if (ed.is3D()) { refresh3D(); v3.render(); } api.toast('Geri alındı'); } break;
    case 'redo': if (doc && doc.redo()) { refreshUndo(); api.requestRender(); if (ed.is3D()) { refresh3D(); v3.render(); } api.toast('Yinelendi'); } break;
    case 'savedxf': saveDxf(false); break;
    case 'savedelta': saveDxf(true); break;
    case 'layer': pickLayer(); break;
    case 'color': pickColor(); break;
    case 'props': showProps(); break;
    case '3d': if (!needModel()) return; if (ed.is3D()) exit3D(); else enter3D(); break;
    case 'persp': if (v3) { v3.set('persp', !v3.cam.persp); overlay3D(); api.toast(v3.cam.persp ? tt('perspective', 'Perspektif') : tt('orthographic', 'Ortografik'), 1200); } break;
    case 'zscale': optionPop(btn, renderZScale, tt('zscaleTitle', 'Düşey abartı')); break;
    case 'style3': optionPop(btn, renderStyle, tt('styleTitle', 'Stil')); break;
    case 'vstyle': vstylePop(btn); break;
    case 'clip3': optionPop(btn, renderClip, tt('clipTitle', 'Kesit')); break;
    case 'color3': call(api.openDisplayOptions, { seg: '3d', focus: 'colorMode' }); break;
    case 'light3': if (v3) v3.set('light', !v3.opts.light); break;
    case 'grid3': if (v3) v3.set('grid', !v3.opts.grid); break;
    case 'axes3': if (v3) v3.set('axes', !v3.opts.axes); break;
    case 'cube3': if (v3) { v3.set('cube', !v3.opts.cube); syncCube(); } break;
    case 'hud3': if (v3) { v3.set('hud', !v3.opts.hud); syncCube(); overlay3D(); } break;
    case 'turn3': if (v3) v3.set('turntable', !v3.opts.turntable); break;
    case 'shadow3': if (v3) v3.set('shadow', !v3.opts.shadow); break;
    case 'sil3': if (v3) v3.set('silhouette', !v3.opts.silhouette); break;
    case 'cam3': showBookmarks(); break;
    case 'fit3': if (v3) { v3.fit({ animate: !ui.reduceMotion }); overlay3D(); } break;
    default: break;
  }
  refreshTiles();
}
let osnapBackup = null;
function toggleOsnap() {
  if (S.snapModes.size) { osnapBackup = [...S.snapModes]; S.snapModes.clear(); api.toast(t('osnapOff'), 1200); }
  else { for (const m of (osnapBackup && osnapBackup.length ? osnapBackup : ['end', 'mid', 'cen', 'int', 'ins', 'node'])) S.snapModes.add(m); api.toast(t('osnapOn'), 1200); }
  document.querySelectorAll('[data-snap]').forEach(cb => { cb.checked = S.snapModes.has(cb.dataset.snap); });
  if (api.settings) { api.settings.snap = [...S.snapModes]; }
  haptic('toggle'); syncQuick(); refreshTiles();
}

// ---------------------------------------------------------------------------------
// Durum çubuğu: hızlı düğmeler, kip çipi
// ---------------------------------------------------------------------------------
function bindStatusBar() {
  const q = $('stQuick'); if (!q) return;
  q.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-quick]'); if (!b) return;
    const k = b.dataset.quick;
    if (k === 'grid') D.toggleDisplay('grid'); else if (k === 'lw') D.toggleDisplay('lw'); else if (k === 'text') D.toggleDisplay('showText'); else if (k === 'osnap') toggleOsnap();
    haptic('toggle'); syncQuick(); refreshTiles();
  });
  syncQuick();
}
function syncQuick() {
  if (!S) return;
  const on = { grid: S.grid.on, lw: !!S.lw, text: S.show.text, osnap: S.snapModes.size > 0 };
  document.querySelectorAll('#stQuick [data-quick]').forEach(b => { const v = !!on[b.dataset.quick]; b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); });
}
let mode3Text = null, modeText = null;
function statusMode(text) { modeText = text || null; renderMode(); }
function statusMode3D() {
  mode3Text = ed.is3D() && v3 ? v3.hudText() : null;
  if (mode3Text && /Yüzey yok/.test(mode3Text)) { const d = S && S.scene && S.scene.solidDiag; if (d && d.solids) mode3Text += ` (${d.solids} katı: ${d.errors[0] ? d.errors[0].replace(/^\S+ \S+: /, '') : 'yüzey çözülemedi'})`; else { const c = S && S.counts || {}; mode3Text += ` (katı/yüzey varlığı yok; ${Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + v).join(', ')})`; } }
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
const BTN = { finish: ['✓ Bitir', () => tools.finish()], close: ['Kapat', () => tools.close()], back: ['↶ Geri', () => tools.back()], selall: ['Tümü', () => tools.selectAll()], cancel: ['✕ İptal', () => { tools.cancel(); markActive(null); ed.sel.clear(); api.drawOverlay(); }] };
function showPrompt(text, opts = {}) {
  const bar = $('cmdBar');
  if (!text) { bar.hidden = true; markActive(null); return; }
  bar.hidden = false;
  $('cmdText').textContent = text;
  const inp = $('cmdInput');
  inp.hidden = !opts.input;
  inp.placeholder = opts.input === 'number' ? 'sayı' : 'x,y | @dx,dy | @L<açı';
  inp.type = 'text'; inp.value = '';
  $('cmdBtns').innerHTML = (opts.buttons || []).map(k => `<button type="button" data-cmd="${k}">${BTN[k][0]}</button>`).join('');
}
function bindCmdBar() {
  $('cmdBtns').addEventListener('click', (ev) => { const b = ev.target.closest('[data-cmd]'); if (b && BTN[b.dataset.cmd]) BTN[b.dataset.cmd][1](); });
  const submit = () => { const v = $('cmdInput').value; if (!v) return; $('cmdInput').value = ''; if (ed.m3) typed3D(v); else tools.typed(v); };
  $('cmdEnter').addEventListener('click', submit);
  $('cmdInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });
}
function showResult(rows, onCopy) {
  const html = api.kv(rows);
  api.openDoc('Ölçüm', html);
  if (onCopy) { const b = $('tCopy'); if (b) b.onclick = onCopy; }
}

// ---------------------------------------------------------------------------------
// Katman / renk / özellikler
// ---------------------------------------------------------------------------------
function updateLayerButton() { const b = $('tbLayer'); if (b) b.querySelector('.lb').textContent = ed.curLayer.length > 10 ? ed.curLayer.slice(0, 9) + '…' : ed.curLayer; }
function layerSelectHtml(id, cur) { return `<select id="${id}">${[...S.layers.keys()].sort((a, b) => a.localeCompare(b, 'tr')).map(n => `<option ${n === cur ? 'selected' : ''}>${api.esc(n)}</option>`).join('')}</select>`; }
function pickLayer() {
  if (!needDoc()) return;
  api.openDoc('Geçerli katman', api.kv([['Katman', layerSelectHtml('eLayer', ed.curLayer), 1], ['Yeni katman', `<input id="eNewLayer" placeholder="ad"> <input id="eNewColor" type="number" min="1" max="255" placeholder="renk 1-255" style="width:110px">`, 1],
    [`<div class="full btns"><button class="btn primary small" id="eLayerOk">Tamam</button><button class="btn small" id="eLayerNew">Katman oluştur</button></div>`]]));
  $('eLayerOk').onclick = () => { ed.curLayer = $('eLayer').value; updateLayerButton(); api.hide('docPanel'); };
  $('eLayerNew').onclick = () => {
    const name = $('eNewLayer').value.trim(); if (!name) return;
    const c = parseInt($('eNewColor').value, 10);
    if (doc.run({ op: 'layer', name, color: c >= 1 && c <= 255 ? c : -1 })) { ed.curLayer = name; updateLayerButton(); api.buildLayerList(); refreshUndo(); api.toast('Katman oluşturuldu: ' + name); api.hide('docPanel'); }
    else api.toast('Katman zaten var');
  };
}
function colorSwatches(sel) {
  const ids = [256, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30, 40, 50, 90, 130, 150, 170, 190, 210, 230, 250, 252, 254];
  return `<div class="swatches">${ids.map(i => `<button type="button" data-ci="${i}" class="${i === sel ? 'active' : ''}" style="background:${i === 256 ? 'transparent' : i === 7 ? '#ffffff' : '#' + (ACI[i] & 0xffffff).toString(16).padStart(6, '0')}" title="${i === 256 ? 'Katmandan' : i}">${i === 256 ? 'K' : ''}</button>`).join('')}</div>`;
}
function pickColor() {
  if (!needDoc()) return;
  api.openDoc('Geçerli renk', `<div class="full">${colorSwatches(ed.curColor)}</div><div class="full muted">K = katmandan (ByLayer). ACI numarası: <input id="eCi" type="number" min="1" max="255" style="width:90px" value="${ed.curColor === 256 ? '' : ed.curColor}"> <button class="btn small" id="eCiOk">Tamam</button></div>`);
  $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-ci]'); if (b) { ed.curColor = Number(b.dataset.ci); api.hide('docPanel'); api.toast('Renk: ' + (ed.curColor === 256 ? 'katmandan' : ed.curColor)); } };
  $('eCiOk').onclick = () => { const c = parseInt($('eCi').value, 10); if (c >= 1 && c <= 255) { ed.curColor = c; api.hide('docPanel'); } };
}
function showProps() {
  if (!needModel()) return;
  if (!ed.sel.size) { api.toast('Önce "Seç" ile nesne seçin.'); return; }
  const first = [...ed.sel][0];
  api.openDoc(`Özellikler (${ed.sel.size} nesne)`, api.kv([['Katman', layerSelectHtml('pLayer', first.lay), 1], ['Renk', colorSwatches(first.info ? first.info.ci : 256), 1],
    [`<div class="full btns"><button class="btn primary small" id="pOk">Uygula</button></div>`]]));
  let ci = null;
  $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-ci]'); if (b) { ci = Number(b.dataset.ci); document.querySelectorAll('#docBody [data-ci]').forEach(x => x.classList.toggle('active', x === b)); } };
  $('pOk').onclick = () => {
    const cmd = { op: 'props', keys: [...ed.sel].map(p => p.key), layer: $('pLayer').value };
    if (ci != null) cmd.color = ci;
    doc.run(cmd); refreshUndo(); api.requestRender(); api.hide('docPanel'); api.toast('Özellikler uygulandı');
  };
}

// ---------------------------------------------------------------------------------
// DXF kaydetme
// ---------------------------------------------------------------------------------
const UNIT_CODE = { mm: 4, cm: 5, m: 6, km: 7, dm: 14, 'inç': 1, ft: 2 };
function saveDxf(onlyEdited) {
  if (!needDoc()) return;
  const model = S.scene.layouts[0];
  if (onlyEdited && !(doc && doc.dirty)) { api.toast('Kaydedilecek değişiklik yok.'); return; }
  const text = writeDxf(model.prims, S.layers, { onlyEdited, ltypes: S.ltypes, units: UNIT_CODE[S.units] || 0 });
  const name = api.baseName() + (onlyEdited ? '_degisiklikler' : '_duzenlenmis') + '.dxf';
  const bytes = new TextEncoder().encode(text);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  const drv = window.dwgApp && window.dwgApp.drive;
  const driveAct = drv && drv.signedIn && drv.signedIn() ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => drv.uploadWithPicker({ b64, name, mime: 'application/dxf' }) } : undefined;
  if (window.Android && window.Android.saveFile) { const r = window.Android.saveFile(b64, name, 'application/dxf', true); api.toast(r ? 'DXF kaydedildi: ' + r : 'DXF kaydedilemedi', { type: r ? 'ok' : 'error', ms: 6000, action: r ? driveAct : undefined }); }
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
  const pop = $('tbPop'); if (pop && !pop.hidden) { closePop(); return true; }
  const tour = $('tour'); if (tour && !tour.hidden) { endTour(); return true; }
  if (ed.m3) { ed.m3 = null; showPrompt(null); markActive(null); overlay3D(); return true; }
  if (ed.is3D()) { exit3D(); return true; }
  if (tools.running) { tools.cancel(); markActive(null); return true; }
  if (ed.sel.size) { ed.sel.clear(); api.drawOverlay(); return true; }
  return false;
}
/** 2B kaplama: seçim vurgusu ve araç önizlemesi */
export function overlay(c) {
  const acc = S.selColor || '#ff9f0a', sw = S.selWidth || 3;
  if (ed.sel.size) {
    const k = S.view.scale * S.dpr;
    c.save();
    c.setTransform(k, 0, 0, -k, c.canvas.width / 2 - k * S.view.cx, c.canvas.height / 2 + k * S.view.cy);
    c.strokeStyle = acc; c.lineWidth = sw / S.view.scale; c.setLineDash([6 / S.view.scale, 4 / S.view.scale]); c.globalAlpha = 0.95;
    for (const p of ed.sel) { if (p.k === 0) { c.beginPath(); api.tracePath(c, p.ops); if (p.closed) c.closePath(); c.stroke(); } else c.strokeRect(p.bb[0], p.bb[1], p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]); }
    c.restore(); c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
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
    try { v3 = new View3D(cv); } catch (e) { api.toast('3B görünüm açılamadı: ' + e.message, { type: 'error' }); return; }
    bind3D(cv);
    v3.onChange = () => { overlay3D(); statusMode3D(); };
  }
  tools.cancel(); markActive(null);
  cv.hidden = false;
  resize3D();
  refresh3D();
  v3.fit({ animate: false }); v3.preset('iso', { animate: false }); v3.render(); overlay3D();
  if (!cube) { try { cube = buildViewCube($('cube3d'), v3, host3()); } catch (e) { console.warn(e); cube = null; } }
  syncCube();
  api.toast(tileHint('3d'), 2200);
  rebuildRow('display'); refreshTiles(); statusMode3D();
  D.refreshNav();
}
export function exit3D() {
  $('cv3d').hidden = true; ed.m3 = null; showPrompt(null);
  if (v3) v3.stopTurntable();
  const c3 = $('cube3d'); if (c3) c3.hidden = true;
  closePop();
  const p = $('displayPanel'); if (p && !p.hidden && p.querySelector('#displaySeg [data-seg="3d"].on')) D.closeDisplayOptions();
  rebuildRow('display'); refreshTiles(); statusMode3D();
  api.drawOverlay();
  D.refreshNav();
}
function syncCube() { const c3 = $('cube3d'); if (!c3) return; c3.hidden = !(ed.is3D() && v3 && v3.opts.cube && cube); if (v3) c3.classList.toggle('below-hud', !!(v3.opts.hud && v3.opts.hudPos === 'tl')); if (!c3.hidden && cube) cube.update(); }
function resize3D() { const cv = $('cv3d'); const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * S.dpr); cv.height = Math.round(r.height * S.dpr); }
function refresh3D() {
  if (!v3) return;
  const fadeLayers = new Set([...S.layers.values()].filter(l => l.faded).map(l => l.name));
  v3.setScene(S.scene.layouts[0].prims, S.layers, { dark: S.dark, mono: S.mono, bg: bgColor(), fg: fgColor(), fade: S.fade.on && fadeLayers.size ? { pct: S.fade.pct, layers: fadeLayers } : null, selColor: S.selColor });
  v3.setSelection(ed.sel);
}
function render3D() { if (v3 && ed.is3D()) { v3.render(); overlay3D(); } }
export function onResize() { if (ed.is3D()) { resize3D(); v3.render(); overlay3D(); } }
export function onTheme() { if (ed.is3D()) { refresh3D(); v3.render(); overlay3D(); } }
const p3 = { pointers: new Map(), last: null, d0: 0, mid0: null, ang0: 0, moved: false, snap: null, pts: [], lastTap: 0, lastTapAt: null };
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
function tap3D(sx, sy) {
  const hit = v3.pickVertex(sx, sy, ui.glove ? 30 : 22);
  if (!ed.m3) {
    ed.sel.clear();
    if (hit) { ed.sel.add(hit.prim); api.showInfo(hit.prim); haptic('snap'); } else api.hide('infoPanel');
    v3.setSelection(ed.sel); v3.render(); overlay3D();
    return;
  }
  const m = ed.m3;
  if (m.name === 'select') { if (hit) { if (ed.sel.has(hit.prim)) ed.sel.delete(hit.prim); else ed.sel.add(hit.prim); prompt3D(); haptic('snap'); } v3.setSelection(ed.sel); v3.render(); overlay3D(); return; }
  if (!hit) { api.toast('Bir köşeye dokunun (köşeler yakalanır)'); return; }
  p3.snap = hit.p; haptic('snap');
  m.pts.push(hit.p);
  if (m.name === 'dist' && m.pts.length === 2) {
    const [a, b] = m.pts; const dh = Math.hypot(b[0] - a[0], b[1] - a[1]), dz = b[2] - a[2], d3 = Math.hypot(dh, dz), u = S.units ? ' ' + S.units : '';
    showResult([['3B mesafe', fmt(d3) + u], ['Yatay', fmt(dh) + u], ['ΔZ', fmt(dz) + u], ['Eğim', dh > 0 ? fmt(dz / dh * 100, 2) + ' %  (' + fmt(dz / dh * 1000, 1) + ' ‰)' : '–'], ['1. nokta', a.map(v => fmt(v)).join(' ; ')], ['2. nokta', b.map(v => fmt(v)).join(' ; ')]]);
    m.pts = [];
  } else if (m.name === 'move' && m.pts.length === 2) {
    const [a, b] = m.pts; const keys = [...ed.sel].map(p => p.key);
    if (keys.length) { doc.run({ op: 'xform', keys, m: [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], dz: b[2] - a[2] }); refreshUndo(); api.toast('Taşındı'); }
    ed.sel.clear(); ed.m3 = null; showPrompt(null); markActive(null);
  } else if (m.name === 'pline') { /* Bitir ile tamamlanır */ }
  prompt3D();
  refresh3D(); v3.render(); overlay3D();
}
function start3DTool(name) {
  ed.m3 = { name, pts: [] };
  if (name === 'setz') {
    if (!ed.sel.size) { api.toast('Önce nesne seçin (3B › Seç).'); ed.m3 = null; return; }
    const v = prompt('Kot (Z):', ''); const z = parseFloat(String(v || '').replace(',', '.'));
    if (isFinite(z)) { doc.run({ op: 'setz', keys: [...ed.sel].map(p => p.key), z }); refreshUndo(); refresh3D(); v3.render(); api.toast('Kot atandı'); }
    ed.m3 = null; markActive(null); return;
  }
  if (name === 'del') {
    if (!ed.sel.size) { api.toast('Önce nesne seçin (3B › Seç).'); ed.m3 = null; return; }
    doc.run({ op: 'delete', keys: [...ed.sel].map(p => p.key) }); ed.sel.clear(); refreshUndo(); refresh3D(); v3.render(); overlay3D(); api.toast('Silindi'); ed.m3 = null; markActive(null); return;
  }
  if (name === 'move' && !ed.sel.size) { api.toast('Önce nesne seçin (3B › Seç).'); ed.m3 = null; return; }
  prompt3D();
}
function prompt3D() {
  const m = ed.m3; if (!m) return;
  const txt = { select: `Seç: köşelere dokunun [${ed.sel.size} seçili]`, dist: m.pts.length ? '3B mesafe: ikinci köşe' : '3B mesafe: birinci köşe', move: m.pts.length ? 'Taşı: hedef köşe' : 'Taşı: taban köşesi', pline: `3B Polyline: köşelere dokunun ya da x,y,z yazın [${m.pts.length} nokta] · Bitir` }[m.name];
  $('cmdBar').hidden = false; $('cmdText').textContent = txt;
  $('cmdInput').hidden = m.name !== 'pline'; $('cmdInput').placeholder = 'x,y,z';
  $('cmdBtns').innerHTML = (m.name === 'pline' ? `<button type="button" data-cmd3="finish">✓ Bitir</button>` : '') + (m.pts.length ? `<button type="button" data-cmd3="back">↶ Geri</button>` : '') + `<button type="button" data-cmd3="cancel">✕ İptal</button>`;
  $('cmdBtns').onclick = (ev) => {
    const b = ev.target.closest('[data-cmd3]'); if (!b) return;
    const k = b.dataset.cmd3;
    if (k === 'cancel') { ed.m3 = null; showPrompt(null); markActive(null); overlay3D(); }
    else if (k === 'back') { m.pts.pop(); prompt3D(); overlay3D(); }
    else if (k === 'finish') { if (m.pts.length >= 2) { doc.run({ op: 'add', ents: [{ type: 'POLYLINE3D', pts: m.pts.slice(), id: newId(), layer: ed.curLayer, color: ed.curColor }] }); refreshUndo(); refresh3D(); v3.render(); api.toast('3B polyline eklendi'); } m.pts = []; ed.m3 = null; showPrompt(null); markActive(null); overlay3D(); }
  };
}
function typed3D(v) {
  const m = ed.m3; if (!m || m.name !== 'pline') return;
  const parts = v.split(/[;,\s]+/).map(x => parseFloat(x.replace(',', '.'))).filter(x => isFinite(x));
  if (parts.length < 2) { api.toast('x,y,z yazın'); return; }
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
  if (p3.snap) { const s = v3.project(p3.snap[0], p3.snap[1], p3.snap[2]); c.strokeStyle = '#3ddc84'; c.lineWidth = 2; c.strokeRect(s[0] - 7, s[1] - 7, 14, 14); }
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
    `<div class="opt-row"><button type="button" class="btn small" data-do="hints">${esc(t('hintsReset'))}</button></div></div>`;
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
    });
  } };
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
ed.statusMode = statusMode;
ed.select = (prim) => { ed.sel.clear(); if (prim) ed.sel.add(prim); if (ed.is3D()) { v3.setSelection(ed.sel); render3D(); } else api.drawOverlay(); };
ed.setCurLayer = (name) => { if (!name || !S.layers.has(name)) return false; ed.curLayer = name; updateLayerButton(); return true; };
ed.openTab = (id) => { if ($('toolbar').classList.contains('collapsed')) collapse(false); setTab(id); };
ed.collapse = (on) => collapse(!!on);
ed.refreshTiles = refreshTiles;
/** Klavye: Esc geri, Del sil, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z), Enter bitir; true → işlendi */
ed.key = (ev) => {
  if (!ev || typeof ev.key !== 'string') return false;
  const k = ev.key;
  if (k === 'Escape') { return back(); }
  if (!S.hasDoc) return false;
  if ((ev.ctrlKey || ev.metaKey) && (k === 'z' || k === 'Z')) { if (ev.shiftKey) act('redo'); else act('undo'); return true; }
  if ((ev.ctrlKey || ev.metaKey) && (k === 'y' || k === 'Y')) { act('redo'); return true; }
  if ((k === 'Delete' || k === 'Backspace') && ed.sel.size && doc && !tools.running) { doc.run({ op: 'delete', keys: [...ed.sel].map(p => p.key) }); ed.sel.clear(); refreshUndo(); api.requestRender(); if (ed.is3D()) { refresh3D(); render3D(); } api.toast('Silindi'); return true; }
  if (k === 'Enter' && tools.running) { tools.finish(); return true; }
  return false;
};
export const editor = ed;
