/*
 * 2B ekran seçenekleri (display2d): tema, güneş modu, ön ayarlar, görünürlük süzgeçleri, çizgiler,
 * katman izolasyonu / soldurma, ızgara / cetvel / artı imleç, seçim vurgusu, Ekran ayarları sheet'i,
 * gezinti FAB kümesi ve yön tuşları.
 *
 *  - S alanları tek gerçek kaynaktır (state.js); `settings.display` yalnız kalıcı kopyadır.
 *  - Her değişiklik: S.* → S.cacheValid=false → requestRender() → 300 ms sonra settings.display'e yazılır.
 *  - Olaylar: window 'dwg:display' {key,value,all}, 'dwg:display-open' {seg}; dinlenen: 'dwg:ui'.
 *  - editor.js buradan içe aktarılMAZ; düzenleyiciye erişim initDisplay(ctx).editor üzerinden, guard'lıdır.
 */
import { S, store, fmt } from './state.js';
import { THEMES, theme as activeTheme, layerPalette as _layerPalette, passFilters, bgColor, fgColor } from './render.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
/** i18n anahtarı yoksa Türkçe varsayılan */
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const DISPLAY_DEFAULTS = Object.freeze({
  theme: 'dark', bgOverride: null, sun: false, preset: 'custom',
  showText: true, showHatch: true, showDim: true, showPoint: true, showImage: true, showAttrib: true, showBlock: true, showLtype: true,
  colorMode: 'entity', monoColor: 'fg', lw: false, lwScale: 3, minLw: 1, minTextPx: 2.2, hatchAlpha: 1, pointStyle: 'plus', pointPx: 3,
  grid: false, gridStep: 'auto', gridStyle: 'line', rulers: false, crosshair: 'small',
  fade: false, fadePct: 70, selColor: '#ff9f0a', selWidth: 3, smooth: true, fastPan: 'auto',
  scaleBar: true, north: true, northBig: false, navFabs: true, dpad: false, coordInfo: true, vpFrames: true, compareOnlyDiff: false,
  basemapOpacity: 0.8,
});
export const THEME_IDS = ['dark', 'light', 'blueprint', 'sepia', 'hicontrast', 'system'];
const PRESET_IDS = ['field', 'office', 'print', 'custom'];
const BOOL_KEYS = new Set(['sun', 'showText', 'showHatch', 'showDim', 'showPoint', 'showImage', 'showAttrib', 'showBlock', 'showLtype', 'lw', 'grid', 'rulers', 'fade', 'smooth', 'scaleBar', 'north', 'northBig', 'navFabs', 'dpad', 'coordInfo', 'vpFrames', 'compareOnlyDiff']);
/** Düz anahtar → S yolu ([nesne, alan]); listede olmayan anahtar doğrudan S[key] */
const PATH = {
  showText: ['show', 'text'], showHatch: ['show', 'hatch'], showDim: ['show', 'dim'], showPoint: ['show', 'point'], showImage: ['show', 'image'], showAttrib: ['show', 'attrib'], showBlock: ['show', 'block'], showLtype: ['show', 'ltype'],
  grid: ['grid', 'on'], gridStep: ['grid', 'step'], gridStyle: ['grid', 'style'], fade: ['fade', 'on'], fadePct: ['fade', 'pct'],
  scaleBar: ['ui2d', 'scaleBar'], north: ['ui2d', 'north'], northBig: ['ui2d', 'northBig'], navFabs: ['ui2d', 'navFabs'], dpad: ['ui2d', 'dpad'], coordInfo: ['ui2d', 'coordInfo'], vpFrames: ['ui2d', 'vpFrames'], compareOnlyDiff: ['ui2d', 'compareOnlyDiff'],
  basemapOpacity: ['basemap', 'opacity'],
};
/** Yalnız kaplamayı etkileyen anahtarlar (tuval önbelleği geçerli kalır) */
const OVERLAY_ONLY = new Set(['rulers', 'crosshair', 'selColor', 'selWidth', 'scaleBar', 'north', 'northBig', 'navFabs', 'dpad', 'coordInfo', 'preset']);

let ctx = null;
const noop = () => {};
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };

export function initDisplay(c) {
  ctx = Object.assign({ requestRender: noop, drawOverlay: noop, toast: noop, openDoc: noop, show: noop, hide: noop, buildLayerList: noop, settings: {}, saveSettings: noop, editorTheme: noop, zoomExtents: noop, zoomBy: noop, fitPrims: () => false }, c || {});
  injectFallbackCss();
  try { const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', () => { if (S.theme === 'system') applyThemeDom(true); }); } catch (_) { /* yok */ }
  window.addEventListener('dwg:ui', (ev) => { const ui = (ev.detail) || {}; S.glove = !!ui.glove; refreshNav(); });
  window.addEventListener('dwg:viewhist', () => refreshNav());
  applyThemeDom(false);
}

// ---------------------------------------------------------------------------------
// Okuma / yazma
// ---------------------------------------------------------------------------------
export function getDisplay(key) {
  const p = PATH[key];
  return p ? S[p[0]][p[1]] : S[key];
}
function write(key, value) {
  const p = PATH[key];
  if (p) S[p[0]][p[1]] = value; else S[key] = value;
}
function normalize(key, value) {
  if (BOOL_KEYS.has(key)) return !!value;
  if (key === 'theme') return THEME_IDS.includes(value) ? value : 'dark';
  if (key === 'colorMode') return ['entity', 'layer', 'mono'].includes(value) ? value : 'entity';
  if (key === 'gridStep') { if (value === 'auto' || value == null || value === '') return 'auto'; const n = Number(value); return n > 0 && isFinite(n) ? n : 'auto'; }
  if (key === 'gridStyle') return value === 'point' ? 'point' : 'line';
  if (key === 'crosshair') return ['off', 'small', 'full'].includes(value) ? value : 'small';
  if (key === 'pointStyle') return ['plus', 'x', 'o', 'dot'].includes(value) ? value : 'plus';
  if (key === 'fastPan') return value === 'auto' ? 'auto' : !!value;
  if (key === 'preset') return PRESET_IDS.includes(value) ? value : 'custom';
  if (key === 'bgOverride') return value ? String(value) : null;
  if (['lwScale', 'minLw', 'minTextPx', 'hatchAlpha', 'pointPx', 'fadePct', 'selWidth', 'basemapOpacity'].includes(key)) { const n = Number(value); return isFinite(n) ? n : DISPLAY_DEFAULTS[key]; }
  return value;
}
let saveTimer = 0;
function saveDisplay() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = ctx.settings;
    st.version = 2;
    st.display = Object.assign({}, st.display || {}, snapshot());
    // eski okuyucular için yansıtma
    st.dark = S.dark; st.lwScale = S.lwScale; st.opacity = S.basemap.opacity;
    call(ctx.saveSettings);
  }, 300);
}
function emit(key, value) {
  try { window.dispatchEvent(new CustomEvent('dwg:display', { detail: { key, value, all: snapshot() } })); } catch (_) { /* yok */ }
}
/** Tema/güneş sınıflarını gövdeye yazar, düzenleyiciyi ve katman listesini yeniler */
function applyThemeDom(rerender) {
  const th = activeTheme();
  document.body.dataset.theme = th.id;
  document.body.classList.toggle('light', !S.dark);
  document.body.classList.toggle('sun', !!S.sun);
  S.layerPalette.clear();
  if (rerender) { S.cacheValid = false; call(ctx.requestRender); }
  call(ctx.editorTheme);
  const lp = $('layerPanel'); if (lp && !lp.hidden) call(ctx.buildLayerList);
}
/**
 * S'e yazar, tuvali yeniler, 300 ms sonra kalıcı kopyayı günceller.
 * o = { persist:true, silent:false, fast:false }  (fast: sürükleme sırasında hızlı yol)
 */
export function setDisplay(key, value, o = {}) {
  if (!(key in DISPLAY_DEFAULTS)) { console.warn('display: bilinmeyen anahtar', key); return; }
  value = normalize(key, value);
  const prev = getDisplay(key);
  if (key === 'sun') applySun(value); else write(key, value);
  if (key !== 'preset' && !o.keepPreset && S.preset !== 'custom') S.preset = 'custom';
  if (key === 'theme' || key === 'bgOverride' || key === 'sun') applyThemeDom(false);
  if (key === 'basemapOpacity' && ctx.settings) ctx.settings.opacity = value;
  if (!OVERLAY_ONLY.has(key)) S.cacheValid = false;
  if (OVERLAY_ONLY.has(key)) call(ctx.drawOverlay); else call(ctx.requestRender, !!o.fast);
  if (key === 'navFabs' || key === 'dpad') refreshNav();
  if (key === 'grid' || key === 'gridStep') syncGridChip();
  if (o.persist !== false) saveDisplay();
  if (!o.silent) emit(key, value);
  return prev;
}
export function toggleDisplay(key) {
  if (key === 'colorMode') { setDisplay('colorMode', S.colorMode === 'mono' ? 'entity' : 'mono'); return S.colorMode === 'mono'; }
  if (key === 'theme') { setDisplay('theme', S.dark ? 'light' : 'dark'); return !S.dark; }
  if (key === 'crosshair') { setDisplay('crosshair', S.crosshair === 'off' ? 'small' : 'off'); return S.crosshair !== 'off'; }
  if (!BOOL_KEYS.has(key)) return getDisplay(key);
  const v = !getDisplay(key);
  setDisplay(key, v);
  const msgs = { showText: [t('textShown'), t('textHidden')], showHatch: ['Tarama gösteriliyor', 'Tarama gizlendi'], showDim: ['Ölçülendirme gösteriliyor', 'Ölçülendirme gizlendi'], showPoint: ['Noktalar gösteriliyor', 'Noktalar gizlendi'], showImage: ['Resimler gösteriliyor', 'Resimler gizlendi'], showAttrib: ['Öznitelikler gösteriliyor', 'Öznitelikler gizlendi'], showBlock: ['Bloklar gösteriliyor', 'Bloklar gizlendi'], showLtype: ['Çizgi tipleri açık', 'Çizgi tipleri kapalı'], lw: [t('lw') + ': açık', t('lw') + ': kapalı'], grid: ['Izgara açık', 'Izgara kapalı'], sun: ['Güneş modu açık', 'Güneş modu kapalı'], fade: ['Diğer katmanlar soluk', 'Soldurma kapalı'] };
  if (msgs[key]) call(ctx.toast, v ? msgs[key][0] : msgs[key][1]);
  return v;
}
/** Anlık düz kopya (settings.display biçimi) */
export function snapshot() {
  const o = {};
  for (const k of Object.keys(DISPLAY_DEFAULTS)) o[k] = getDisplay(k);
  return o;
}
/** Düz kopyayı S'e uygular (sessiz, tek render) */
export function restore(obj, o = {}) {
  if (!obj) return;
  const src = { ...obj };
  const sun = !!src.sun; delete src.sun;
  for (const k of Object.keys(DISPLAY_DEFAULTS)) if (k in src) write(k, normalize(k, src[k]));
  S.sun = false;
  if (sun) applySun(true);
  if (ctx) { applyThemeDom(false); S.cacheValid = false; call(ctx.requestRender); refreshNav(); syncGridChip(); }
  if (o.persist !== false) saveDisplay();
  if (!o.silent) emit('*', null);
}
export function resetDisplay() {
  const before = snapshot();
  restore({ ...DISPLAY_DEFAULTS, basemapOpacity: S.basemap.opacity });
  call(ctx.toast, tt('dispResetDone', 'Ekran ayarları sıfırlandı'), { action: { label: tt('undoAction', 'Geri al'), fn: () => restore(before) } });
  refreshPanel();
}
export function themeInfo() { return activeTheme(); }

// ---- güneş modu ve ön ayarlar -------------------------------------------------------------
function applySun(on) {
  const st = ctx ? ctx.settings : {};
  if (on && !S.sun) {
    st.display = st.display || {};
    st.display.prevSun = { theme: S.theme, minLw: S.minLw, hatchAlpha: S.hatchAlpha, selColor: S.selColor, lw: S.lw };
    S.sun = true; S.theme = 'hicontrast'; S.minLw = 1.5; S.hatchAlpha = 0.6; S.selColor = '#ff2d95';
  } else if (!on && S.sun) {
    const p = (st.display && st.display.prevSun) || {};
    S.sun = false;
    S.theme = THEME_IDS.includes(p.theme) ? p.theme : 'dark'; S.minLw = p.minLw != null ? p.minLw : 1; S.hatchAlpha = p.hatchAlpha != null ? p.hatchAlpha : 1; S.selColor = p.selColor || '#ff9f0a'; if (p.lw != null) S.lw = p.lw;
    if (st.display) delete st.display.prevSun;
  } else S.sun = !!on;
}
export function applyPreset(name) {
  if (!PRESET_IDS.includes(name)) return;
  if (name === 'field') { if (!S.sun) applySun(true); }
  else if (name === 'office') { if (S.sun) applySun(false); S.theme = 'dark'; for (const k of Object.keys(S.show)) S.show[k] = true; S.lw = false; S.grid.on = false; }
  else if (name === 'print') { if (S.sun) applySun(false); S.theme = 'light'; S.colorMode = 'mono'; S.lw = true; S.grid.on = false; S.bgOverride = null; }
  S.preset = name;
  applyThemeDom(false);
  S.cacheValid = false; call(ctx.requestRender); syncGridChip();
  saveDisplay(); emit('preset', name); refreshPanel();
}

// ---------------------------------------------------------------------------------
// Süzgeç / katman yardımcıları
// ---------------------------------------------------------------------------------
/** Süzgeçler + katman görünürlüğü (seçim, arama, yakalama bunu kullanır) */
export function primVisible(p) {
  if (!p || p.inf) return false;
  const L = S.layers.get(p.lay);
  if (L && !L.visible) return false;
  return passFilters(p);
}
export const layerPalette = _layerPalette;
export function isolateLayers(names) {
  const set = new Set(Array.isArray(names) ? names : [names]);
  if (!S.isoBackup) { S.isoBackup = new Map(); for (const l of S.layers.values()) S.isoBackup.set(l.name, l.visible); }
  for (const l of S.layers.values()) l.visible = set.has(l.name);
  afterLayerChange();
  call(ctx.toast, tt('isolated', 'Katman izole edildi') + ': ' + [...set].join(', '), { action: { label: tt('undoAction', 'Geri al'), fn: unisolate } });
}
export function unisolate() {
  if (!S.isoBackup) return;
  for (const [name, vis] of S.isoBackup) { const l = S.layers.get(name); if (l) l.visible = vis; }
  S.isoBackup = null;
  afterLayerChange();
}
export const isIsolated = () => !!S.isoBackup;
export function setLayerFaded(name, faded) { const l = S.layers.get(name); if (!l) return; l.faded = !!faded; afterLayerChange(); }
function afterLayerChange() {
  const b = $('btnLayersUniso'); if (b) b.hidden = !S.isoBackup;
  call(ctx.buildLayerList);
  S.cacheValid = false; call(ctx.requestRender);
  emit('layers', null);
}

// ---------------------------------------------------------------------------------
// Widget'lar (html üretir; olaylar renderDisplaySection içinde bağlanır)
// ---------------------------------------------------------------------------------
export const widgets = {
  seg(key, opts, cur, labels) { return `<div class="seg" data-key="${esc(key)}">${opts.map((v, i) => `<button type="button" data-val="${esc(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${esc(labels ? labels[i] : v)}</button>`).join('')}</div>`; },
  sw(key, cur, label) { return `<div class="opt-row"><span class="opt-lb">${esc(label)}</span><label class="switch"><input type="checkbox" data-key="${esc(key)}" ${cur ? 'checked' : ''}><span class="knob"></span></label></div>`; },
  slider(key, min, max, step, cur, unit) { return `<div class="slider" data-key="${esc(key)}" data-unit="${esc(unit || '')}"><button type="button" class="dec" aria-label="${tt('decrease', 'Azalt')}">−</button><input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"><output>${fmtVal(cur, unit)}</output><button type="button" class="inc" aria-label="${tt('increase', 'Artır')}">+</button></div>`; },
  chips(items) { return `<div class="chips">${items.map(it => `<button type="button" class="chip ${it.on ? 'on' : ''}" data-key="${esc(it.key)}" ${it.val != null ? `data-val="${esc(it.val)}"` : ''} aria-pressed="${it.on ? 'true' : 'false'}">${esc(it.label)}${it.count ? ` <b class="ct">${it.count}</b>` : ''}</button>`).join('')}</div>`; },
  swatches(key, colors, cur) { return `<div class="swatches" data-key="${esc(key)}">${colors.map(c => `<button type="button" data-val="${esc(c.val == null ? '' : c.val)}" class="${(c.val || '') === (cur || '') ? 'active' : ''}" title="${esc(c.name || c.val || '')}" style="background:${c.val || 'transparent'}">${c.val ? '' : esc(c.name || '')}</button>`).join('')}</div>`; },
  select(key, opts, cur) { return `<select class="opt-sel" data-key="${esc(key)}">${opts.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(cur) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`; },
  row(label, inner) { return `<div class="opt-row"><span class="opt-lb">${esc(label)}</span>${inner}</div>`; },
  sec(title, inner, id) { return `<div class="opt-sec" ${id ? `data-sec="${esc(id)}"` : ''}><div class="opt-title">${esc(title)}</div>${inner}</div>`; },
};
function fmtVal(v, unit) { const n = Number(v); const s = Number.isInteger(n) ? String(n) : fmt(n, 2); return s + (unit === '%' ? ' %' : unit ? ' ' + unit : ''); }

const SEC_IDS = ['preset', 'theme', 'filters', 'lines', 'helpers', 'layers', 'selection', 'points', 'basemap'];
function typeCount(keys) { let n = 0; for (const k of keys) n += (S.counts && S.counts[k]) || 0; return n; }
function sectionHtml(id) {
  const W = widgets;
  switch (id) {
    case 'preset':
      return W.sec(tt('dispPreset', 'Ön ayar'), W.chips([
        { key: 'preset', val: 'field', label: tt('presetField', 'Saha'), on: S.preset === 'field' }, { key: 'preset', val: 'office', label: tt('presetOffice', 'Ofis'), on: S.preset === 'office' },
        { key: 'preset', val: 'print', label: tt('presetPrint', 'Baskı önizleme'), on: S.preset === 'print' }, { key: 'preset', val: 'custom', label: tt('presetCustom', 'Özel'), on: S.preset === 'custom' }]), id);
    case 'theme':
      return W.sec(tt('dispTheme', 'Tema'),
        W.seg('theme', THEME_IDS, S.theme, [tt('themeDark', 'Koyu'), tt('themeLight', 'Açık'), tt('themeBlueprint', 'Blueprint'), tt('themeSepia', 'Sepya'), tt('themeHc', 'Yüksek kontrast'), tt('themeSystem', 'Sisteme uy')]) +
        W.row(tt('bgColor', 'Arka plan'), W.swatches('bgOverride', [{ val: '', name: tt('fromTheme', 'Temadan') }, { val: '#000000', name: 'Siyah' }, { val: '#202020', name: 'Koyu gri' }, { val: '#ffffff', name: 'Beyaz' }, { val: '#f7f2e6', name: 'Krem' }, { val: '#e8f0fa', name: 'Açık mavi' }, { val: '#0d1a0d', name: 'Yeşil-siyah' }], S.bgOverride) +
          `<input type="color" class="opt-color" data-key="bgOverride" value="${esc(S.bgOverride || bgColor())}" aria-label="${tt('bgCustom', 'Özel renk')}">`) +
        W.sw('sun', S.sun, tt('sunMode', 'Güneş modu')), id);
    case 'filters':
      return W.sec(tt('dispVis', 'Görünürlük'), W.chips([
        { key: 'showText', label: tt('showText', 'Yazı'), on: S.show.text, count: typeCount(['TEXT', 'MTEXT']) }, { key: 'showHatch', label: tt('showHatch', 'Tarama'), on: S.show.hatch, count: typeCount(['HATCH']) },
        { key: 'showDim', label: tt('showDim', 'Ölçülendirme'), on: S.show.dim, count: typeCount(['DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION']) }, { key: 'showPoint', label: tt('showPoint', 'Nokta'), on: S.show.point, count: typeCount(['POINT']) },
        { key: 'showImage', label: tt('showImage', 'Resim'), on: S.show.image, count: typeCount(['IMAGE']) }, { key: 'showAttrib', label: tt('showAttrib', 'Öznitelik'), on: S.show.attrib, count: typeCount(['ATTRIB', 'ATTDEF']) },
        { key: 'showBlock', label: tt('showBlock', 'Blok'), on: S.show.block, count: typeCount(['INSERT']) }, { key: 'showLtype', label: tt('showLtype', 'Çizgi tipleri'), on: S.show.ltype, count: S.ltypes ? Object.keys(S.ltypes).length : 0 }]), id);
    case 'lines':
      return W.sec(tt('dispLines', 'Çizgiler'),
        W.sw('lw', S.lw, tt('lw', 'Çizgi kalınlıkları')) +
        W.row(tt('lwScale', 'Kalınlık ölçeği (px/mm)'), W.slider('lwScale', 1, 10, 0.5, S.lwScale, 'px')) +
        W.row(tt('minLw', 'En az kalınlık'), W.slider('minLw', 0.5, 3, 0.25, S.minLw, 'px')) +
        W.row(tt('colorMode', 'Renk modu'), W.seg('colorMode', ['entity', 'layer', 'mono'], S.colorMode, [tt('colorEntity', 'Nesne rengi'), tt('colorLayer', 'Katman paleti'), tt('colorMono', 'Tek renk')])) +
        W.row(tt('monoTone', 'Tek renk tonu'), W.seg('monoColor', ['fg', 'accent', 'custom'], S.monoColor === 'fg' || S.monoColor === 'accent' ? S.monoColor : 'custom', [tt('toneFg', 'Ön plan'), tt('toneAccent', 'Vurgu'), tt('toneCustom', 'Özel')]) + `<input type="color" class="opt-color" data-key="monoColor" value="${esc(/^#/.test(S.monoColor || '') ? S.monoColor : '#4ea1ff')}" aria-label="${tt('toneCustom', 'Özel')}">`) +
        W.sw('smooth', S.smooth, tt('smooth', 'Çizgi yumuşatma')) +
        W.row(tt('fastPan', 'Kaydırırken sadeleştir'), W.seg('fastPan', ['auto', 'true', 'false'], S.fastPan === 'auto' ? 'auto' : String(!!S.fastPan), [tt('auto', 'Otomatik'), tt('on', 'Açık'), tt('off', 'Kapalı')])), id);
    case 'helpers':
      return W.sec(tt('dispHelpers', 'Yardımcılar'),
        W.sw('grid', S.grid.on, tt('grid', 'Izgara')) +
        W.row(tt('gridStep', 'Adım'), W.select('gridStep', [['auto', tt('auto', 'Otomatik')], ['1', '1'], ['5', '5'], ['10', '10'], ['50', '50'], ['100', '100'], ['1000', '1000']], S.grid.step)) +
        W.row(tt('gridStyle', 'Biçim'), W.seg('gridStyle', ['line', 'point'], S.grid.style, [tt('gridLine', 'Çizgi'), tt('gridPoint', 'Nokta')])) +
        W.sw('rulers', S.rulers, tt('rulers', 'Cetveller')) +
        W.row(tt('crosshair', 'Artı imleç'), W.seg('crosshair', ['off', 'small', 'full'], S.crosshair, [tt('crossOff', 'Kapalı'), tt('crossSmall', 'Küçük'), tt('crossFull', 'Tam ekran')])) +
        W.sw('scaleBar', S.ui2d.scaleBar, tt('scaleBar', 'Ölçek çubuğu')) +
        W.sw('north', S.ui2d.north, tt('northArrow', 'Kuzey oku')) +
        W.sw('northBig', S.ui2d.northBig, tt('northBig', 'Büyük kuzey oku')) +
        W.sw('coordInfo', S.ui2d.coordInfo, tt('coordInfo', 'Koordinat bilgisi')) +
        W.sw('navFabs', S.ui2d.navFabs, tt('navFabs', 'Ekran zoom düğmeleri')) +
        W.sw('dpad', S.ui2d.dpad, tt('dpad', 'Yön tuşları')) +
        (S.scene && S.scene.layouts.length > 1 ? W.sw('vpFrames', S.ui2d.vpFrames, tt('vpFrames', 'Görünüm penceresi çerçeveleri')) : '') +
        (S.compare ? W.sw('compareOnlyDiff', S.ui2d.compareOnlyDiff, tt('compareOnlyDiff', 'Karşılaştırma: yalnız farklar')) : ''), id);
    case 'layers':
      return W.sec(tt('dispLayers', 'Katmanlar'),
        W.sw('fade', S.fade.on, tt('fadeOthers', 'Diğer katmanları soldur')) +
        W.row(tt('fadePct', 'Solgunluk'), W.slider('fadePct', 10, 90, 5, S.fade.pct, '%')) +
        `<div class="opt-row"><button type="button" class="btn small" data-do="unisolate" ${S.isoBackup ? '' : 'disabled'}>${tt('unisolate', 'İzolasyonu kaldır')}</button><button type="button" class="btn small" data-do="unfade">${tt('unfadeAll', 'Soldurmaları kaldır')}</button></div>`, id);
    case 'selection':
      return W.sec(tt('dispSel', 'Seçim'),
        W.row(tt('selColor', 'Vurgu rengi'), W.swatches('selColor', [{ val: '#ff9f0a', name: 'Turuncu' }, { val: '#ff2d95', name: 'Macenta' }, { val: '#32ade6', name: 'Cam göbeği' }, { val: '#30d158', name: 'Yeşil' }, { val: '#ff453a', name: 'Kırmızı' }], S.selColor)) +
        W.row(tt('selWidth', 'Kalınlık'), W.slider('selWidth', 2, 5, 0.5, S.selWidth, 'px')), id);
    case 'points':
      return W.sec(tt('dispPoints', 'Noktalar ve yazı'),
        W.row(tt('pointStyle', 'Nokta biçimi'), W.seg('pointStyle', ['plus', 'x', 'o', 'dot'], S.pointStyle, ['+', '×', '○', '●'])) +
        W.row(tt('pointPx', 'Nokta boyutu'), W.slider('pointPx', 3, 10, 1, S.pointPx, 'px')) +
        W.row(tt('minTextPx', 'Yazı eşiği'), W.slider('minTextPx', 1, 8, 0.5, S.minTextPx, 'px')) +
        W.row(tt('hatchAlpha', 'Tarama saydamlığı'), W.slider('hatchAlpha', 0, 100, 5, Math.round(S.hatchAlpha * 100), '%')), id);
    case 'basemap': {
      let opts = [['none', tt('basemapNone', 'Yok')]];
      try { if (ctx.basemaps) opts = ctx.basemaps.map(b => [b.id, b.name]); } catch (_) { /* yok */ }
      return W.sec(tt('dispBasemap', 'Altlık'),
        W.row(tt('basemap', 'Harita altlığı'), W.select('basemapId', opts, S.basemap.id)) +
        W.row(tt('basemapOpacity', 'Saydamlık'), W.slider('basemapOpacity', 0, 100, 5, Math.round(S.basemap.opacity * 100), '%')) +
        `<div class="opt-note">${S.geo && S.geo.active ? esc(S.geo.crs.name) : tt('basemapNeedCrs', 'Altlık için önce koordinat sistemini seçin.')}</div>`, id);
    }
    default: return '';
  }
}
/** Slider değeri → S değeri (yüzde tabanlı olanlar 0..1) */
const PCT_KEYS = { hatchAlpha: 100, basemapOpacity: 100 };
function fromSlider(key, v) { return PCT_KEYS[key] ? v / PCT_KEYS[key] : v; }
function toSlider(key, v) { return PCT_KEYS[key] ? Math.round(v * PCT_KEYS[key]) : v; }

/** Tek bölümü verilen öğeye basar ve olaylarını bağlar; {destroy()} döner */
export function renderDisplaySection(el, id) {
  if (!el) return { destroy: noop };
  el.innerHTML = sectionHtml(id);
  const onClick = (ev) => {
    const b = ev.target.closest('button'); if (!b || !el.contains(b)) return;
    const seg = b.closest('.seg[data-key]');
    if (seg && b.dataset.val != null) {
      const key = seg.dataset.key; let val = b.dataset.val;
      if (key === 'fastPan') val = val === 'auto' ? 'auto' : val === 'true';
      if (key === 'monoColor' && val === 'custom') { const inp = el.querySelector('input[type=color][data-key="monoColor"]'); val = inp ? inp.value : '#4ea1ff'; }
      setDisplay(key, val);
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      return;
    }
    const sw = b.closest('.swatches[data-key]');
    if (sw && b.dataset.val != null) { setDisplay(sw.dataset.key, b.dataset.val || null); sw.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); return; }
    if (b.classList.contains('chip') && b.dataset.key) {
      if (b.dataset.key === 'preset') { applyPreset(b.dataset.val); return; }
      const on = toggleDisplay(b.dataset.key);
      b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      return;
    }
    const sl = b.closest('.slider[data-key]');
    if (sl && (b.classList.contains('dec') || b.classList.contains('inc'))) {
      const inp = sl.querySelector('input[type=range]');
      const step = Number(inp.step) || 1, v = Math.min(Number(inp.max), Math.max(Number(inp.min), Number(inp.value) + (b.classList.contains('inc') ? step : -step)));
      inp.value = String(v); sl.querySelector('output').textContent = fmtVal(v, sl.dataset.unit);
      setDisplay(sl.dataset.key, fromSlider(sl.dataset.key, v));
      return;
    }
    if (b.dataset.do === 'unisolate') { unisolate(); b.disabled = true; }
    else if (b.dataset.do === 'unfade') { for (const l of S.layers.values()) l.faded = false; afterLayerChange(); }
  };
  const onInput = (ev) => {
    const inp = ev.target;
    if (inp.type === 'range') {
      const sl = inp.closest('.slider[data-key]'); if (!sl) return;
      const v = Number(inp.value); sl.querySelector('output').textContent = fmtVal(v, sl.dataset.unit);
      setDisplay(sl.dataset.key, fromSlider(sl.dataset.key, v), { fast: true, persist: ev.type === 'change' });
    } else if (inp.type === 'color' && inp.dataset.key) {
      if (inp.dataset.key === 'monoColor') { const seg = el.querySelector('.seg[data-key="monoColor"]'); if (seg) seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.val === 'custom')); }
      setDisplay(inp.dataset.key, inp.value, { fast: ev.type === 'input' });
      const sw = el.querySelector(`.swatches[data-key="${inp.dataset.key}"]`); if (sw) sw.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    }
  };
  const onChange = (ev) => {
    const inp = ev.target;
    if (inp.type === 'checkbox' && inp.dataset.key) { setDisplay(inp.dataset.key, inp.checked); return; }
    if (inp.tagName === 'SELECT' && inp.dataset.key) {
      if (inp.dataset.key === 'basemapId') { S.basemap.id = inp.value; if (ctx.settings) { ctx.settings.basemap = inp.value; call(ctx.saveSettings); } S.cacheValid = false; call(ctx.requestRender); return; }
      setDisplay(inp.dataset.key, inp.value); return;
    }
    if (inp.type === 'range' || inp.type === 'color') onInput(ev);
  };
  el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('change', onChange);
  const sync = () => {
    el.querySelectorAll('.seg[data-key]').forEach(seg => { const k = seg.dataset.key; let cur = getDisplay(k); if (k === 'fastPan') cur = cur === 'auto' ? 'auto' : String(!!cur); if (k === 'monoColor') cur = cur === 'fg' || cur === 'accent' ? cur : 'custom'; seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.val === String(cur))); });
    el.querySelectorAll('.switch input[data-key]').forEach(i => { i.checked = !!getDisplay(i.dataset.key); });
    el.querySelectorAll('.chip[data-key]').forEach(c => { const on = c.dataset.key === 'preset' ? S.preset === c.dataset.val : !!getDisplay(c.dataset.key); c.classList.toggle('on', on); c.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    el.querySelectorAll('.slider[data-key]').forEach(sl => { const v = toSlider(sl.dataset.key, getDisplay(sl.dataset.key)); const inp = sl.querySelector('input'); if (document.activeElement !== inp) { inp.value = String(v); sl.querySelector('output').textContent = fmtVal(v, sl.dataset.unit); } });
    el.querySelectorAll('.swatches[data-key]').forEach(sw => { const cur = getDisplay(sw.dataset.key) || ''; sw.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.val === cur)); });
    el.querySelectorAll('select.opt-sel[data-key]').forEach(s => { if (s.dataset.key === 'basemapId') s.value = S.basemap.id; else s.value = String(getDisplay(s.dataset.key)); });
    const u = el.querySelector('[data-do="unisolate"]'); if (u) u.disabled = !S.isoBackup;
  };
  const onDisp = () => sync();
  window.addEventListener('dwg:display', onDisp);
  return { destroy() { el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); window.removeEventListener('dwg:display', onDisp); el.innerHTML = ''; }, sync };
}

// ---------------------------------------------------------------------------------
// Ekran ayarları sheet'i
// ---------------------------------------------------------------------------------
let panelState = { seg: '2d', sections: [], render3d: null, dispose3d: null };
/** #displayPanel yoksa aynı işaretlemeyi oluşturur */
export function ensureDisplayPanel() {
  let p = $('displayPanel');
  if (!p) {
    p = document.createElement('aside');
    p.id = 'displayPanel'; p.className = 'panel bottom'; p.hidden = true; p.setAttribute('role', 'dialog');
    p.innerHTML = `<div class="panel-head"><div id="displaySeg" class="seg"><button type="button" data-seg="2d" class="on">2B</button><button type="button" data-seg="3d">3B</button></div><strong data-i18n="dispTitle">${tt('dispTitle', 'Ekran ayarları')}</strong><button type="button" class="btn small" id="displayReset" data-i18n="dispReset">${tt('dispReset', 'Sıfırla')}</button><button type="button" class="btn icon close" data-close="displayPanel" aria-label="${t('close')}">✕</button></div><div id="displayBody" class="panel-body"></div>`;
    ($('app') || document.body).appendChild(p);
  }
  if (!p.dataset.bound) {
    p.dataset.bound = '1';
    p.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.close === 'displayPanel') { closeDisplayOptions(); return; }
      if (b.id === 'displayReset') { resetDisplay(); return; }
      if (b.dataset.seg && b.closest('#displaySeg')) { setSeg(b.dataset.seg); }
    });
  }
  return p;
}
function setSeg(seg) {
  panelState.seg = seg;
  const p = ensureDisplayPanel();
  p.querySelectorAll('#displaySeg [data-seg]').forEach(b => b.classList.toggle('on', b.dataset.seg === seg));
  renderBody();
}
function renderBody() {
  const body = $('displayBody'); if (!body) return;
  for (const s of panelState.sections) s.destroy();
  panelState.sections = [];
  if (panelState.dispose3d) { call(panelState.dispose3d.destroy || panelState.dispose3d); panelState.dispose3d = null; }
  body.innerHTML = '';
  if (panelState.seg === '3d') {
    if (typeof panelState.render3d === 'function') { try { panelState.dispose3d = panelState.render3d(body) || null; } catch (e) { console.warn(e); } }
    if (!body.childElementCount) body.innerHTML = `<div class="opt-note">${tt('v3NotOpen', '3B görünüm açık değil.')}</div>`;
    return;
  }
  for (const id of SEC_IDS) {
    const el = document.createElement('div'); el.className = 'opt-wrap'; el.dataset.section = id; body.appendChild(el);
    panelState.sections.push(renderDisplaySection(el, id));
  }
}
function refreshPanel() { const p = $('displayPanel'); if (p && !p.hidden && panelState.seg === '2d') for (const s of panelState.sections) if (s.sync) s.sync(); }
/** 3B bölümünü basan işlevi kaydeder (editor.js, panel açılmadan önce) */
export function setRender3d(fn) { panelState.render3d = typeof fn === 'function' ? fn : null; }
/** o = { seg:'2d'|'3d', focus?:key, render3d?:(bodyEl)=>void } */
export function openDisplayOptions(o = {}) {
  const p = ensureDisplayPanel();
  if (o.render3d !== undefined) panelState.render3d = o.render3d;
  let seg = o.seg;
  if (!seg) { try { seg = ctx.editor && ctx.editor.is3D() ? '3d' : '2d'; } catch (_) { seg = '2d'; } }
  p.hidden = false;
  setSeg(seg);
  try { window.dispatchEvent(new CustomEvent('dwg:display-open', { detail: { seg } })); } catch (_) { /* yok */ }
  if (o.focus) {
    const el = p.querySelector(`[data-key="${o.focus}"]`);
    const row = el && (el.closest('.opt-row') || el);
    if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('focus'); setTimeout(() => row.classList.remove('focus'), 1000); }
  }
  return p;
}
export function closeDisplayOptions() {
  const p = $('displayPanel'); if (!p) return;
  p.hidden = true;
  for (const s of panelState.sections) s.destroy();
  panelState.sections = [];
  if (panelState.dispose3d) { call(panelState.dispose3d.destroy || panelState.dispose3d); panelState.dispose3d = null; }
}

// ---------------------------------------------------------------------------------
// Durum çubuğu ızgara çipi
// ---------------------------------------------------------------------------------
/** Izgara adımı metni: "Izgara 10 m" (metre çevrimi varsa) */
export function gridLabel(step) {
  if (!step) return '';
  const u = S.unitToM || 0;
  let txt;
  if (u) { const m = step * u; txt = m >= 1000 ? fmt(m / 1000, 2) + ' km' : m >= 1 ? fmt(m, 2) + ' m' : m >= 0.01 ? fmt(m * 100, 2) + ' cm' : fmt(m * 1000, 2) + ' mm'; }
  else txt = fmt(step) + (S.units ? ' ' + S.units : '');
  return tt('stGrid', 'Izgara') + ' ' + txt;
}
function syncGridChip() { const el = $('stGrid'); if (el) el.hidden = !S.grid.on; }

// ---------------------------------------------------------------------------------
// Gezinti FAB kümesi ve yön tuşları
// ---------------------------------------------------------------------------------
const hasIcon = (id) => !!document.getElementById(id);
const icon = (id, txt) => hasIcon(id) ? `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>` : `<span class="ic">${txt}</span>`;
let navEl = null, dpadEl = null, idleTimer = 0;
function v3() { try { return ctx.editor && ctx.editor.is3D() ? ctx.editor.view3d() : null; } catch (_) { return null; } }
function render3D() { if (ctx.editor && typeof ctx.editor.render3D === 'function') ctx.editor.render3D(); else { const v = v3(); if (v) v.render(); } }
/** idempotent: #navFabs ve #dpad oluşturur, #gpsBtn'i içine taşır */
export function mountNavFabs(viewportEl) {
  const vp = viewportEl || $('viewport'); if (!vp) return null;
  if (!navEl) {
    navEl = document.createElement('div'); navEl.id = 'navFabs'; navEl.className = 'hud navfabs';
    navEl.innerHTML = `<button type="button" class="fab" data-nav="in" aria-label="${tt('zoomIn', 'Yakınlaştır')}" title="${tt('zoomIn', 'Yakınlaştır')}">${icon('i-zoom-in', '+')}</button>` +
      `<button type="button" class="fab" data-nav="out" aria-label="${tt('zoomOut', 'Uzaklaştır')}" title="${tt('zoomOut', 'Uzaklaştır')}">${icon('i-zoom-out', '−')}</button>` +
      `<button type="button" class="fab" data-nav="fit" aria-label="${t('fit')}" title="${t('fit')}">${icon('i-fit', '⌂')}</button>` +
      `<button type="button" class="fab" data-nav="prev" aria-label="${tt('prevView', 'Önceki görünüm')}" title="${tt('prevView', 'Önceki görünüm')}" disabled>${icon('i-prev', '↶')}</button>`;
    vp.appendChild(navEl);
    const gps = $('gpsBtn'); if (gps) navEl.appendChild(gps);
    bindNav(navEl);
    dpadEl = document.createElement('div'); dpadEl.id = 'dpad'; dpadEl.className = 'hud dpad'; dpadEl.hidden = true;
    dpadEl.innerHTML = ['up', 'left', 'right', 'down'].map(d => `<button type="button" data-pan="${d}" aria-label="${{ up: 'Yukarı', down: 'Aşağı', left: 'Sola', right: 'Sağa' }[d]}">${icon('i-arrow-' + d, { up: '▲', down: '▼', left: '◀', right: '▶' }[d])}</button>`).join('');
    vp.appendChild(dpadEl);
    bindDpad(dpadEl);
    const wake = () => { navEl.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => navEl.classList.add('idle'), 2000); };
    vp.addEventListener('pointerdown', wake, { passive: true }); vp.addEventListener('wheel', wake, { passive: true });
    wake();
  }
  refreshNav();
  return navEl;
}
function refreshNav() {
  if (!navEl) return;
  const notesDrawing = S.notesOn && S.noteTool !== 'select';
  navEl.hidden = !S.ui2d.navFabs || notesDrawing;
  let canBack = false;
  try { const v = v3(); if (v) canBack = typeof v.canHistoryBack === 'function' ? v.canHistoryBack() : false; else canBack = ctx.viewHistory ? ctx.viewHistory.canBack() : S.viewHist.i > 0; } catch (_) { canBack = false; }
  const prev = navEl.querySelector('[data-nav="prev"]'); if (prev) prev.disabled = !canBack;
  if (dpadEl) {
    let uiDpad = false; try { uiDpad = !!(ctx.ui && (ctx.ui.dpad || ctx.ui.glove)); } catch (_) { uiDpad = false; }
    dpadEl.hidden = !(S.ui2d.dpad || uiDpad) || !S.hasDoc;
  }
}
export { refreshNav };
/** düğme: dokunuş / basılı tutma (400 ms sonra repeatMs aralıkla) / uzun basış / çift dokunuş */
function hold(btn, onTap, onRepeat, repeatMs, onLong, longMs, onDbl) {
  let timer = 0, delay = 0, longTimer = 0, fired = false, lastUp = 0, down = false;
  const stop = () => { clearInterval(timer); clearTimeout(delay); clearTimeout(longTimer); timer = 0; delay = 0; longTimer = 0; };
  btn.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    try { btn.setPointerCapture(ev.pointerId); } catch (_) { /* yok */ }
    down = true; fired = false; stop();
    if (onRepeat) delay = setTimeout(() => { fired = true; onRepeat(); timer = setInterval(onRepeat, repeatMs || 80); }, 400);
    if (onLong) longTimer = setTimeout(() => { fired = true; stop(); onLong(); }, longMs || 500);
  });
  const up = (ev) => {
    if (!down) return; down = false; stop(); ev.stopPropagation();
    if (ev.type !== 'pointerup') return;
    if (fired) return;
    const now = performance.now();
    if (onDbl && now - lastUp < 320) { lastUp = 0; onDbl(); return; }
    lastUp = now;
    if (!btn.disabled) onTap();
  };
  btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); if (ev.detail === 0 && !btn.disabled) onTap(); }); // klavye / sentetik tıklama
}
function zoom2(f) { const v = v3(); if (v) { v.zoom(f); render3D(); } else call(ctx.zoomBy, f); }
function bindNav(el) {
  hold(el.querySelector('[data-nav="in"]'), () => zoom2(1.5), () => zoom2(1.03), 80);
  hold(el.querySelector('[data-nav="out"]'), () => zoom2(1 / 1.5), () => zoom2(1 / 1.03), 80);
  hold(el.querySelector('[data-nav="fit"]'), () => { const v = v3(); if (v) { v.fit(); render3D(); } else call(ctx.zoomExtents); }, null, 0,
    () => { const v = v3(); if (v) { v.fit(); render3D(); return; } if (!gotoHome()) call(ctx.zoomExtents); }, 500,
    () => { let sel = []; try { sel = ctx.editor && ctx.editor.sel ? [...ctx.editor.sel] : []; } catch (_) { sel = []; } if (!sel.length && S.selected) sel = [S.selected]; if (!call(ctx.fitPrims, sel)) call(ctx.zoomExtents); });
  hold(el.querySelector('[data-nav="prev"]'), () => { const v = v3(); if (v) { if (typeof v.historyBack === 'function' && v.historyBack()) render3D(); } else call(ctx.viewHistory && ctx.viewHistory.back); },
    null, 0, () => { const v = v3(); if (v) { if (typeof v.historyForward === 'function' && v.historyForward()) render3D(); } else call(ctx.viewHistory && ctx.viewHistory.forward); }, 500);
}
/** home:<fileKey> ana görünümüne gider; yoksa false */
export function gotoHome() {
  const h = S.fileKey ? store.json('home:' + S.fileKey, null) : null;
  if (!h || !h.view) return false;
  if (ctx.setLayout && h.li != null && h.li !== S.layoutIndex) call(ctx.setLayout, h.li);
  S.view = { ...h.view };
  if (ctx.viewHistory) call(ctx.viewHistory.push); call(ctx.requestRender);
  return true;
}
export function setHome() {
  if (!S.fileKey) return false;
  store.set('home:' + S.fileKey, JSON.stringify({ view: { ...S.view }, li: S.layoutIndex }));
  call(ctx.toast, tt('homeSet', 'Ana görünüm kaydedildi'));
  return true;
}
function panDir(dir) {
  const v = v3();
  if (v) { const a = 26.2; if (dir === 'left') v.orbit(a, 0); else if (dir === 'right') v.orbit(-a, 0); else if (dir === 'up') v.orbit(0, a); else v.orbit(0, -a); render3D(); return; }
  const dx = (dir === 'left' ? -1 : dir === 'right' ? 1 : 0) * S.W * 0.25, dy = (dir === 'up' ? -1 : dir === 'down' ? 1 : 0) * S.H * 0.25;
  S.view.cx += dx / S.view.scale; S.view.cy -= dy / S.view.scale; S.gps.follow = false;
  call(ctx.requestRender, true);
}
function bindDpad(el) {
  el.querySelectorAll('[data-pan]').forEach(b => hold(b, () => { panDir(b.dataset.pan); if (ctx.viewHistory) call(ctx.viewHistory.push); }, () => panDir(b.dataset.pan), 120));
}

// ---------------------------------------------------------------------------------
// Yedek stil: C'nin app.css'i sonradan yüklendiği için aynı özgüllükteki kurallar onu geçemez.
// ---------------------------------------------------------------------------------
function injectFallbackCss() {
  if (document.getElementById('displayFallbackCss')) return;
  const st = document.createElement('style'); st.id = 'displayFallbackCss';
  st.textContent = `
.navfabs{position:absolute;right:12px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:5;transition:opacity .3s}
.navfabs.idle{opacity:.4}
.navfabs .fab{position:static;width:48px;height:48px;padding:0;font-size:22px;cursor:pointer;color:var(--fg)}
.navfabs .fab:disabled{opacity:.35}
.navfabs .ic,.dpad .ic{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.75;display:inline-block}
.dpad{position:absolute;left:12px;bottom:16px;display:grid;grid-template-columns:44px 44px 44px;grid-template-rows:44px 44px 44px;gap:2px;z-index:5}
.dpad button{width:44px;height:44px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--fg);font-size:16px}
.dpad [data-pan=up]{grid-column:2;grid-row:1}.dpad [data-pan=left]{grid-column:1;grid-row:2}.dpad [data-pan=right]{grid-column:3;grid-row:2}.dpad [data-pan=down]{grid-column:2;grid-row:3}
.opt-sec{padding:6px 0 10px;border-bottom:1px solid var(--line)}
.opt-title{font-weight:700;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:6px 0}
.opt-row{display:flex;align-items:center;gap:8px;min-height:44px;flex-wrap:wrap}
.opt-row.focus{outline:2px solid var(--accent);border-radius:8px}
.opt-lb{flex:1 1 120px;font-size:14px}
.opt-note{color:var(--muted);font-size:12px;padding:4px 0}
.seg{display:inline-flex;flex-wrap:wrap;gap:2px;border:1px solid var(--line);border-radius:10px;padding:2px;background:var(--bg)}
.seg button{min-width:64px;height:40px;border:0;border-radius:8px;background:transparent;color:var(--muted);padding:0 10px;font-size:13px}
.seg button.on{background:var(--accent);color:#1a1a1a;font-weight:600}
.switch{position:relative;display:inline-block;width:52px;height:32px;flex:0 0 auto}
.switch input{opacity:0;width:0;height:0;position:absolute}
.switch .knob{position:absolute;inset:0;border-radius:16px;background:var(--btn);transition:background .15s}
.switch .knob::after{content:"";position:absolute;left:3px;top:3px;width:26px;height:26px;border-radius:50%;background:var(--muted);transition:transform .15s}
.switch input:checked+.knob{background:var(--accent)}
.switch input:checked+.knob::after{transform:translateX(20px);background:#1a1a1a}
.slider{display:flex;align-items:center;gap:6px;flex:1 1 200px;min-width:0}
.slider input[type=range]{flex:1 1 auto;min-width:80px;accent-color:var(--accent);height:44px;margin:0}
.slider output{min-width:52px;text-align:right;font-variant-numeric:tabular-nums;font-size:13px}
.slider .dec,.slider .inc{width:40px;height:40px;border:0;border-radius:8px;background:var(--btn);color:var(--fg);font-size:18px}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 0}
.chip{height:40px;border:1px solid var(--line);border-radius:20px;background:transparent;color:var(--muted);padding:0 12px;font-size:13px}
.chip.on{background:var(--accent);color:#1a1a1a;border-color:var(--accent)}
.chip .ct{font-weight:600;opacity:.75}
.opt-row .swatches button{width:40px;height:40px;font-size:10px;color:var(--fg)}
.opt-color{width:44px;height:40px;border:1px solid var(--line);border-radius:8px;background:transparent;padding:2px}
.opt-sel{padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:14px;min-height:40px}
#displaySeg{margin-right:4px}
#displaySeg button{min-width:48px;height:36px}
.toast .act{margin-left:12px;border:0;border-radius:6px;background:var(--accent);color:#1a1a1a;padding:6px 10px;font-weight:600;font-size:13px}
.toast.error{border-left:4px solid #ff453a}.toast.warn{border-left:4px solid #f5b342}.toast.ok{border-left:4px solid #30d158}
.st-chip{padding:2px 8px;border-radius:10px;border:1px solid var(--line);color:var(--muted);background:transparent;font:inherit;flex:0 0 auto}
.layer .lbtn{width:40px;height:40px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:16px;flex:0 0 auto}
.layer .lbtn.on{color:var(--accent)}
.layer.faded .nm{opacity:.5}
.info-actions,.meas-actions{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid var(--line)}
.meas-big{font-size:20px;font-weight:700;padding:8px 12px;font-variant-numeric:tabular-nums;border-bottom:1px solid var(--line)}
.ctx-list .item{min-height:44px;display:flex;align-items:center}
`;
  document.head.prepend(st);
}
