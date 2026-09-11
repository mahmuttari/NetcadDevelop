/*
 * 3B seçenek paneli, görünüm küpü ve kamera yer imleri (view3d.js için arayüz katmanı).
 *
 * Dışa açılanlar:
 *   openView3DOptions(v3, bodyEl, host)   → { destroy() }   tüm bölümler (Ekran sheet'i › 3B)
 *   renderStyle / renderPresets / renderZScale / renderClip(el, v3, host) → { destroy() }  popover için tek bölüm
 *   buildViewCube(containerEl, v3, host)  → { el, update(), destroy() }
 *   openCameraBookmarks(v3, bodyEl, host) → { destroy() }
 *   listBookmarks(fileKey)                → [{name, cam, zScale, style, colorMode, clip, thumb}]
 *
 * Widget işaretlemesi sözleşmedeki §W biçimindedir (.opt-sec / .opt-row / .seg / .switch / .slider /
 * .range2 / .chips / .opt-sel); her widget hem sarmalayıcıda hem girişte `data-key` taşır.
 * Kabuk (editor.js) stil verir; bu modül yalnız içerik ve olay bağlar.
 */
import { View3D } from './view3d.js';
import { store, fmt as fmtDef } from './state.js';
import { t, getLang } from './i18n.js';

const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ESC[ch]);
const fmtOf = (host) => (host && typeof host.fmt === 'function') ? host.fmt : fmtDef;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------------
// widget üreticileri (html)
// ---------------------------------------------------------------------------------
const W = {
  sec: (id, title, body) => `<div class="opt-sec" data-sec="${id}"><div class="opt-title">${esc(title)}</div>${body}</div>`,
  row: (label, ctrl, extra = '') => `<div class="opt-row"${extra}><span class="opt-lb">${esc(label)}</span>${ctrl}</div>`,
  sw: (key, cur, label) => W.row(label, `<label class="switch"><input type="checkbox" data-key="${key}"${cur ? ' checked' : ''}><span class="knob"></span></label>`),
  seg: (key, opts, cur, label) => (label ? `<div class="opt-row opt-row-lb"><span class="opt-lb">${esc(label)}</span></div>` : '') +
    `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button type="button" data-val="${esc(v)}"${String(v) === String(cur) ? ' class="on"' : ''} aria-pressed="${String(v) === String(cur)}">${esc(l)}</button>`).join('')}</div>`,
  slider: (key, min, max, step, cur, unit, label, extra = '') => (label ? `<div class="opt-row opt-row-lb"><span class="opt-lb">${esc(label)}</span></div>` : '') +
    `<div class="slider" data-key="${key}"><button type="button" class="dec" aria-label="${esc(tt('decrease', 'Azalt'))}">−</button><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${cur}"${extra} aria-label="${esc(label || key)}"><output>${esc(fmtDef(cur, 2))}${unit ? ' ' + esc(unit) : ''}</output><button type="button" class="inc" aria-label="${esc(tt('increase', 'Artır'))}">+</button></div>`,
  select: (key, opts, cur, label) => W.row(label, `<select class="opt-sel" data-key="${key}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`),
  note: (txt) => `<div class="opt-note">${esc(txt)}</div>`,
};

/** seçenek değerini okur (touch.x / persp / zScale dâhil) */
function getOpt(v3, key) {
  if (key === 'zScale') return v3.zScale;
  if (key === 'persp') return v3.cam.persp;
  if (key.startsWith('touch.')) return v3.opts.touch[key.slice(6)];
  return v3.opts[key];
}
/** ham giriş değerini seçeneğin türüne çevirir */
function coerce(v3, key, raw, el) {
  if (key === 'zScale') { const v = el && el.dataset.log ? Math.pow(10, +raw) : +String(raw).replace(',', '.'); return isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null; }
  if (key === 'gridStep') return raw === 'auto' ? 'auto' : +raw;
  if (key === 'bgColor') return String(raw);
  const cur = getOpt(v3, key);
  if (typeof cur === 'boolean') return raw === true || raw === 'true' || raw === 'on';
  if (typeof cur === 'number') { const v = +String(raw).replace(',', '.'); return isFinite(v) ? v : null; }
  return raw;
}

/**
 * Bir kökteki widget olaylarını v3.set'e bağlar; `dwg:view3d` olayında durumu tazeler.
 * Dönen destroy() dinleyicileri kaldırır.
 */
function bindWidgets(root, v3, host, hooks = {}) {
  const fmt = fmtOf(host);
  const setOutput = (sl, key) => {
    const out = sl.querySelector('output'); if (!out) return;
    const v = getOpt(v3, key), unit = sl.dataset.unit || '';
    out.textContent = (key === 'zScale' ? '×' : '') + fmt(+v, 2) + (unit ? ' ' + unit : '');
  };
  const onClick = (ev) => {
    const b = ev.target.closest('button, [data-preset]'); if (!b || !root.contains(b)) return;
    const seg = b.closest('.seg[data-key]');
    if (seg && b.dataset.val != null) { const key = seg.dataset.key; const v = coerce(v3, key, b.dataset.val, b); if (v != null) v3.set(key, v); hooks.after && hooks.after(key); return; }
    if (b.dataset.preset) { v3.preset(b.dataset.preset, { animate: !(host && host.ui && host.ui.reduceMotion) }); hooks.after && hooks.after('preset'); return; }
    const sl = b.closest('.slider[data-key]');
    if (sl && (b.classList.contains('dec') || b.classList.contains('inc'))) {
      const inp = sl.querySelector('input[type=range]'); if (!inp) return;
      const step = +inp.step || 1, dir = b.classList.contains('inc') ? 1 : -1;
      inp.value = String(clamp(+inp.value + dir * step, +inp.min, +inp.max));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (b.dataset.z) { v3.set('zScale', +b.dataset.z); return; }
    if (b.dataset.clip === 'reset') { v3.set('clip', null); return; }
    if (b.classList.contains('chip') && b.dataset.key) { const key = b.dataset.key; const cur = getOpt(v3, key); if (typeof cur === 'boolean') v3.set(key, !cur); }
  };
  const onInput = (ev) => {
    const inp = ev.target; if (!(inp instanceof HTMLInputElement) || inp.type !== 'range' || !inp.dataset.key) return;
    if (inp.dataset.axis != null) { hooks.range2 && hooks.range2(inp); return; }
    const key = inp.dataset.key; const v = coerce(v3, key, inp.value, inp); if (v == null) return;
    v3.set(key, v);
    const sl = inp.closest('.slider'); if (sl) setOutput(sl, key);
  };
  const onChange = (ev) => {
    const el = ev.target; if (!el.dataset || !el.dataset.key) return;
    const key = el.dataset.key;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') { v3.set(key, el.checked); hooks.after && hooks.after(key); return; }
    if (el instanceof HTMLSelectElement) { const v = coerce(v3, key, el.value, el); if (v != null) v3.set(key, v); hooks.after && hooks.after(key); return; }
    if (el instanceof HTMLInputElement && (el.type === 'color' || el.type === 'number' || el.type === 'text')) { const v = coerce(v3, key, el.value, el); if (v != null) v3.set(key, v); hooks.after && hooks.after(key); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  /** widget durumlarını v3'ten tazeler */
  const refresh = () => {
    root.querySelectorAll('.seg[data-key]').forEach(seg => { const cur = String(getOpt(v3, seg.dataset.key)); seg.querySelectorAll('button[data-val]').forEach(b => { const on = b.dataset.val === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); });
    root.querySelectorAll('input[type=checkbox][data-key]').forEach(cb => { const v = getOpt(v3, cb.dataset.key); if (typeof v === 'boolean') cb.checked = v; });
    root.querySelectorAll('.slider[data-key]').forEach(sl => { const key = sl.dataset.key, inp = sl.querySelector('input[type=range]'); if (!inp) return; const v = getOpt(v3, key); if (v == null) return; if (document.activeElement !== inp) inp.value = String(inp.dataset.log ? Math.log10(v) : v); setOutput(sl, key); });
    root.querySelectorAll('select[data-key]').forEach(se => { const v = getOpt(v3, se.dataset.key); if (v != null) se.value = String(v); });
    root.querySelectorAll('input[type=number][data-key], input[type=color][data-key]').forEach(inp => { const v = getOpt(v3, inp.dataset.key); if (v != null && document.activeElement !== inp) inp.value = String(v); });
    root.querySelectorAll('.chip[data-key]').forEach(ch => { const v = getOpt(v3, ch.dataset.key); if (typeof v === 'boolean') ch.classList.toggle('on', v); });
    hooks.refresh && hooks.refresh();
  };
  const onEvt = () => refresh();
  window.addEventListener('dwg:view3d', onEvt);
  refresh();
  return { refresh, destroy() { root.removeEventListener('click', onClick); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); window.removeEventListener('dwg:view3d', onEvt); } };
}

// ---------------------------------------------------------------------------------
// tek bölüm renderer'ları (popover için)
// ---------------------------------------------------------------------------------
const STYLE_OPTS = () => [['wireframe2d', tt('v3Wire2d', '2B tel kafes')], ['wireframe', tt('v3Wire', 'Tel kafes')], ['hidden', tt('v3Hidden', 'Gizli çizgi')], ['shaded', tt('v3Shaded', 'Gölgeli')], ['shadedEdges', tt('v3ShadedEdges', 'Gölgeli+kenar')], ['realistic', tt('v3Realistic', 'Gerçekçi')], ['conceptual', tt('v3Conceptual', 'Kavramsal')], ['gray', tt('v3Gray', 'Gri tonlar')], ['sketchy', tt('v3Sketchy', 'Eskiz')], ['xray', tt('v3Xray', 'Röntgen')]];
const COLOR_OPTS = () => [['entity', tt('colorEntity', 'Nesne')], ['layer', tt('colorLayer', 'Katman')], ['elevation', tt('v3Elev', 'Kot')], ['mono', tt('colorMono', 'Tek renk')]];
const noFaces = (v3) => !v3.counts.tris;

export function renderStyle(el, v3, host) {
  el.innerHTML = W.sec('style', tt('v3Style', 'Stil'), W.seg('style', STYLE_OPTS(), v3.opts.style) + (noFaces(v3) ? W.note(tt('v3NoFaces', 'Bu çizimde yüzey yok (3DFACE/dolgu) — tel kafes gösteriliyor')) : ''));
  let warned = false;
  const b = bindWidgets(el, v3, host, { after: (key) => { if (key === 'style' && noFaces(v3) && v3.opts.style !== 'wireframe' && v3.opts.style !== 'xray' && !warned && host && host.toast) { warned = true; host.toast(tt('v3NoFaces', 'Bu çizimde yüzey yok (3DFACE/dolgu) — tel kafes gösteriliyor')); } } });
  return { destroy: b.destroy };
}

export function renderPresets(el, v3, host) {
  const lang = getLang();
  el.innerHTML = W.sec('presets', tt('v3Presets', 'Görünümler'), `<div class="chips preset-grid" data-key="presets">${View3D.PRESETS.map(p => `<button type="button" class="chip" data-preset="${p.id}">${esc(lang === 'en' ? (p.en || p.tr) : p.tr)}</button>`).join('')}</div>`);
  const b = bindWidgets(el, v3, host);
  return { destroy: b.destroy };
}

export function renderZScale(el, v3, host) {
  const z = v3.zScale;
  el.innerHTML = W.sec('zscale', tt('v3ZScale', 'Düşey abartı'),
    `<div class="slider" data-key="zScale"><button type="button" class="dec" aria-label="${esc(tt('decrease', 'Azalt'))}">−</button><input type="range" data-key="zScale" data-log="10" min="-1" max="1.301" step="0.01" value="${Math.log10(z)}" aria-label="${esc(tt('v3ZScale', 'Düşey abartı'))}"><output>×${esc(fmtDef(z, 2))}</output><button type="button" class="inc" aria-label="${esc(tt('increase', 'Artır'))}">+</button></div>` +
    `<div class="chips" data-key="zScaleChips">${[1, 2, 5, 10].map(v => `<button type="button" class="chip${z === v ? ' on' : ''}" data-z="${v}">×${v}</button>`).join('')}</div>` +
    W.row(tt('multiplier', 'Çarpan'), `<input type="number" class="opt-num" data-key="zScale" min="0.1" max="20" step="0.1" inputmode="decimal" value="${z}" aria-label="${esc(tt('v3ZScale', 'Düşey abartı'))}">`));
  const b = bindWidgets(el, v3, host, { refresh: () => { el.querySelectorAll('[data-z]').forEach(c => c.classList.toggle('on', +c.dataset.z === v3.zScale)); } });
  return { destroy: b.destroy };
}

export function renderClip(el, v3, host) {
  const fmt = fmtOf(host), bb = v3.bb || [0, 0, 0, 1, 1, 1];
  const cur = () => v3.opts.clip || bb.slice();
  const r2 = (key, lo, hi, axis) => {
    const min = bb[axis], max = bb[axis + 3], step = Math.max(1e-9, (max - min) / 200) || 1e-9;
    return `<div class="range2" data-key="${key}"><input type="range" class="lo" data-key="${key}" data-axis="${axis}" min="${min}" max="${max}" step="${step}" value="${lo}" aria-label="${key} min"><input type="range" class="hi" data-key="${key}" data-axis="${axis + 3}" min="${min}" max="${max}" step="${step}" value="${hi}" aria-label="${key} max"><output class="lo-v">${esc(fmt(lo))}</output><output class="hi-v">${esc(fmt(hi))}</output></div>`;
  };
  const c0 = cur();
  el.innerHTML = W.sec('clip', tt('v3Clip', 'Kesit'),
    W.row(tt('zRangeLb', 'Z aralığı'), `<button type="button" class="btn small" data-clip="reset">${esc(tt('reset', 'Sıfırla'))}</button>`) +
    r2('clipZ', c0[2], c0[5], 2) +
    `<details class="opt-more"><summary>${esc(tt('v3ClipBox', 'Kesit kutusu'))}</summary>` +
    W.row('X', '') + r2('clipX', c0[0], c0[3], 0) + W.row('Y', '') + r2('clipY', c0[1], c0[4], 1) +
    W.sw('clipBox', v3.opts.clipBox, tt('drawBox', 'Kutuyu çiz')) + `</details>`);
  const apply = (inp) => {
    const c = cur(); const ax = +inp.dataset.axis; c[ax] = +inp.value;
    const i = ax % 3; if (c[i] > c[i + 3]) { if (ax < 3) c[i + 3] = c[i]; else c[i] = c[i + 3]; }
    const full = [0, 1, 2, 3, 4, 5].every(k => Math.abs(c[k] - bb[k]) <= Math.max(1e-9, (bb[k % 3 + 3] - bb[k % 3]) * 1e-6));
    v3.set('clip', full ? null : c);
  };
  const b = bindWidgets(el, v3, host, {
    range2: apply,
    refresh: () => {
      const c = cur();
      el.querySelectorAll('.range2').forEach(r => {
        const lo = r.querySelector('input.lo'), hi = r.querySelector('input.hi');
        if (document.activeElement !== lo) lo.value = String(c[+lo.dataset.axis]); if (document.activeElement !== hi) hi.value = String(c[+hi.dataset.axis]);
        r.querySelector('.lo-v').textContent = fmt(c[+lo.dataset.axis]); r.querySelector('.hi-v').textContent = fmt(c[+hi.dataset.axis]);
      });
    },
  });
  return { destroy: b.destroy };
}

// ---------------------------------------------------------------------------------
// tam panel
// ---------------------------------------------------------------------------------
export function openView3DOptions(v3, bodyEl, host = {}) {
  const o = v3.opts, parts = [];
  const isShaded = () => o.style === 'shaded' || o.style === 'shadedEdges';
  const subs = [];
  const mk = (id) => { const d = document.createElement('div'); d.dataset.part = id; return d; };
  bodyEl.innerHTML = '';
  const root = document.createElement('div'); root.className = 'v3opts'; root.id = 'view3dOpts';
  // Stil
  const elStyle = mk('style'); root.appendChild(elStyle); subs.push(renderStyle(elStyle, v3, host));
  // Renk
  parts.push(W.sec('color', tt('v3Color', 'Renk'), W.seg('colorMode', COLOR_OPTS(), o.colorMode)));
  // Işık
  parts.push(W.sec('light', tt('v3Light', 'Işık'),
    W.sw('light', o.light, tt('v3LightOn', 'Aydınlatma')) +
    W.seg('lightMode', [['camera', tt('lightCamera', 'Kameradan')], ['fixed', tt('lightFixed', 'Sabit (KB-üst)')]], o.lightMode, tt('lightDir', 'Yön')) +
    W.slider('lightIntensity', 0, 1.5, 0.05, o.lightIntensity, '', tt('lightIntensity', 'Yoğunluk')) +
    W.slider('ambient', 0, 1, 0.05, o.ambient, '', tt('ambient', 'Ortam ışığı')) +
    (noFaces(v3) ? W.note(tt('v3NoFaces', 'Bu çizimde yüzey yok (3DFACE/dolgu) — tel kafes gösteriliyor')) : '')));
  // Yüz ayarları (AutoCAD görsel stil yöneticisi › Yüz)
  parts.push(W.sec('face', tt('v3Face', 'Yüz ayarları'),
    W.seg('lightQuality', [['faceted', tt('lqFaceted', 'Yüzeyli')], ['smooth', tt('lqSmooth', 'Yumuşak')]], o.lightQuality, tt('lightQuality', 'Aydınlatma kalitesi')) +
    W.sw('specular', o.specular, tt('specular', 'Parlama (specular)')) +
    W.slider('faceOpacity', 0.1, 1, 0.05, o.faceOpacity, '', tt('faceOpacity', 'Yüz saydamlığı'))));
  // Kenar ayarları
  parts.push(W.sec('edge', tt('v3Edges', 'Kenar ayarları'),
    W.seg('edges', [['facet', tt('edgesFacet', 'Yüzey kenarları')], ['none', tt('edgesNone', 'Yok')]], o.edges, tt('edgeMode', 'Kenar kipi')) +
    W.seg('edgeColor', [['auto', tt('auto', 'Otomatik')], ['black', tt('black', 'Siyah')], ['white', tt('white', 'Beyaz')], ['fg', tt('toneFg', 'Ön plan')]], o.edgeColor, tt('edgeColor', 'Kenar rengi')) +
    W.sw('silhouette', o.silhouette, tt('silhouette', 'Siluet kenarları')) +
    W.slider('silhouetteWidth', 1, 6, 0.5, o.silhouetteWidth, '', tt('silhouetteWidth', 'Siluet kalınlığı')) +
    W.slider('overhang', 0, 6, 0.5, o.overhang, '', tt('overhang', 'Çizgi uzatma (taşma)')) +
    W.slider('jitter', 0, 4, 0.5, o.jitter, '', tt('jitter', 'Titreme (eskiz)'))));
  // Ortam
  parts.push(W.sec('env', tt('v3Env', 'Ortam'),
    W.sw('shadow', o.shadow, tt('groundShadow', 'Zemin gölgesi')) +
    W.sw('depthFade', o.depthFade, tt('depthFade', 'Derinlik solması'))));
  // Zemin
  const stepOpts = [['auto', tt('gridAuto', 'Otomatik')], ...[1, 5, 10, 50, 100, 1000].map(v => [String(v), String(v)])];
  parts.push(W.sec('ground', tt('v3Ground', 'Zemin'),
    W.sw('grid', o.grid, tt('grid', 'Izgara')) +
    W.select('gridStep', stepOpts, o.gridStep, tt('gridStep', 'Izgara adımı')) +
    W.seg('gridZ', [['min', tt('gridZMin', 'En alt kot')], ['zero', tt('gridZZero', 'Sıfır')], ['custom', tt('gridZCustom', 'Özel')]], o.gridZ, tt('gridZ', 'Izgara kotu')) +
    W.row(tt('gridZValue', 'Özel kot'), `<input type="number" class="opt-num" data-key="gridZValue" step="any" inputmode="decimal" value="${o.gridZValue}" aria-label="${esc(tt('gridZValue', 'Özel kot'))}">`) +
    W.sw('axes', o.axes, tt('v3Axes', 'Eksenler')) +
    W.sw('axisLabels', o.axisLabels, tt('axisLabels', 'Eksen etiketleri')) +
    W.sw('compass', o.compass, tt('v3Compass', 'Pusula')) +
    W.sw('cube', o.cube, tt('v3Cube', 'Görünüm küpü')) +
    W.seg('bg', [['theme', tt('bgTheme', 'Tema')], ['gradient', tt('bgGradient', 'Gradyan')], ['black', tt('bgBlack', 'Siyah')], ['white', tt('bgWhite', 'Beyaz')], ['custom', tt('bgCustom', 'Özel')]], o.bg, tt('v3Bg', 'Arka plan')) +
    W.row(tt('bgCustomColor', 'Özel renk'), `<input type="color" data-key="bgColor" value="${esc(o.bgColor)}" aria-label="${esc(tt('bgCustomColor', 'Özel renk'))}">`)));
  // Kamera
  parts.push(W.sec('camera', tt('v3Camera', 'Kamera'),
    W.seg('persp', [['true', tt('perspective', 'Perspektif')], ['false', tt('orthographic', 'Ortografik')]], v3.cam.persp) +
    W.slider('fov', 20, 90, 1, o.fov, '°', tt('v3Fov', 'Görüş açısı (FOV)')) +
    W.sw('turntable', o.turntable, tt('v3Turntable', 'Döner tabla')) +
    W.slider('turnSpeed', 5, 60, 1, o.turnSpeed, '°/s', tt('turnSpeed', 'Dönüş hızı')) +
    W.seg('touch.oneFinger', [['orbit', tt('touchOrbit', 'Döndür')], ['pan', tt('touchPan', 'Kaydır')]], o.touch.oneFinger, tt('v3Touch', 'Tek parmak')) +
    W.seg('touch.twoFinger', [['zoompan', tt('touchZoomPan', 'Yakınlaştır + kaydır')], ['zoomrotate', tt('touchZoomRotate', 'Yakınlaştır + döndür')]], o.touch.twoFinger, tt('twoFinger', 'İki parmak')) +
    W.seg('touch.threeFinger', [['pan', tt('touchPan', 'Kaydır')], ['orbit', tt('touchOrbit', 'Döndür')], ['none', tt('off', 'Kapalı')]], o.touch.threeFinger, tt('threeFinger', 'Üç parmak')) +
    W.seg('touch.doubleTap', [['fit', tt('fit', 'Sığdır')], ['zoom', tt('zoomIn', 'Yakınlaştır')], ['none', tt('off', 'Kapalı')]], o.touch.doubleTap, tt('doubleTap', 'Çift dokunuş')) +
    W.sw('touch.invertY', o.touch.invertY, tt('invertY', 'Dikey ters')) +
    W.slider('touch.sensitivity', 0.5, 2, 0.1, o.touch.sensitivity, '×', tt('sensitivity', 'Hassasiyet'))));
  const mid = document.createElement('div'); mid.innerHTML = parts.join(''); root.appendChild(mid);
  // Düşey abartı, Kesit, Görünümler
  const elZ = mk('zscale'); root.appendChild(elZ); subs.push(renderZScale(elZ, v3, host));
  const elC = mk('clip'); root.appendChild(elC); subs.push(renderClip(elC, v3, host));
  const elP = mk('presets'); root.appendChild(elP); subs.push(renderPresets(elP, v3, host));
  // Etiketler / HUD
  const tail = document.createElement('div');
  tail.innerHTML = W.sec('hud', tt('v3Hud', 'Etiketler / HUD'),
    W.seg('elevLabels', [['off', tt('elevOff', 'Kapalı')], ['sel', tt('elevSel', 'Seçili')], ['visible', tt('elevVisible', 'Görünür')]], o.elevLabels, tt('v3ElevLabels', 'Kot etiketleri')) +
    W.sw('hud', o.hud, tt('hudShow', 'Kamera bilgisi')) +
    W.seg('hudPos', [['tl', tt('hudTl', 'Sol üst')], ['bl', tt('hudBl', 'Sol alt')]], o.hudPos, tt('hudPos', 'Konum')) +
    W.slider('pointSize', 2, 14, 1, o.pointSize, 'px', tt('v3PointSize', 'Nokta boyu')) +
    W.sw('textPoints', o.textPoints, tt('textPoints', 'Yazı noktaları')) +
    W.seg('lineWidth', [['thin', tt('lwThin', 'İnce')], ['normal', tt('lwNormal', 'Normal')], ['thick', tt('lwThick', 'Kalın')]], o.lineWidth, tt('lineWidth3', 'Çizgi kalınlığı')) +
    W.sw('dimOthers', o.dimOthers, tt('dimOthers', 'Seçileni öne çıkar')));
  root.appendChild(tail);
  // Yer imleri
  const elB = mk('bookmarks'); root.appendChild(elB);
  bodyEl.appendChild(root);
  subs.push(openCameraBookmarks(v3, elB, host));
  const dimLight = () => { const sec = mid.querySelector('[data-sec="light"]'); if (sec) { const on = isShaded(); sec.classList.toggle('dim', !on); sec.querySelectorAll('.opt-row, .seg, .slider').forEach(r => { r.style.opacity = on ? '' : '0.5'; }); } };
  const b = bindWidgets(mid, v3, host, { refresh: dimLight });
  const bt = bindWidgets(tail, v3, host);
  const onEvt = () => dimLight();
  window.addEventListener('dwg:view3d', onEvt);
  dimLight();
  return { el: root, destroy() { window.removeEventListener('dwg:view3d', onEvt); b.destroy(); bt.destroy(); for (const s of subs) s.destroy(); } };
}

// ---------------------------------------------------------------------------------
// görünüm küpü
// ---------------------------------------------------------------------------------
const CUBE_FACES = [
  { id: 'top', n: [0, 0, 1], tr: 'Ü', en: 'T' }, { id: 'bottom', n: [0, 0, -1], tr: 'Al', en: 'Bo' }, { id: 'front', n: [0, -1, 0], tr: 'Ö', en: 'F' },
  { id: 'back', n: [0, 1, 0], tr: 'A', en: 'Ba' }, { id: 'left', n: [-1, 0, 0], tr: 'S', en: 'L' }, { id: 'right', n: [1, 0, 0], tr: 'Sğ', en: 'R' },
];
const SGN = (v) => v < 0 ? -1 : 1;
/** köşe id'si: (+x,-y,+z) → isoNE, (-x,-y,+z) → isoNW, (+x,+y,+z) → isoSE, (-x,+y,+z) → isoSW; altlar "-low" */
function cornerId(x, y, z) { const top = z > 0; const id = y < 0 ? (x > 0 ? 'isoNE' : 'isoNW') : (x > 0 ? 'isoSE' : 'isoSW'); return top ? id : id + '-low'; }
function faceOf(id) { return CUBE_FACES.find(f => f.id === id); }

export function buildViewCube(container, v3, host = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const lang = getLang();
  container.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-1.45 -1.45 2.9 2.9'); svg.setAttribute('width', '84'); svg.setAttribute('height', '84');
  svg.setAttribute('class', 'cube-svg'); svg.style.display = 'block'; svg.style.touchAction = 'none'; svg.style.userSelect = 'none';
  const gFaces = document.createElementNS(NS, 'g'), gEdges = document.createElementNS(NS, 'g'), gCorners = document.createElementNS(NS, 'g'), gLabels = document.createElementNS(NS, 'g'), gNorth = document.createElementNS(NS, 'g');
  svg.append(gFaces, gEdges, gCorners, gLabels, gNorth);
  const stroke = 'currentColor';
  const faceEls = new Map(), labelEls = new Map();
  const corners = [];  // [x,y,z]
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push([x, y, z]);
  const faceCorners = (f) => corners.filter(c => c[0] * f.n[0] + c[1] * f.n[1] + c[2] * f.n[2] > 0);
  // yüzler
  for (const f of CUBE_FACES) {
    const poly = document.createElementNS(NS, 'polygon');
    poly.dataset.face = f.id; poly.setAttribute('fill', 'currentColor'); poly.setAttribute('fill-opacity', '0.18'); poly.setAttribute('stroke', stroke); poly.setAttribute('stroke-width', '0.03'); poly.setAttribute('stroke-linejoin', 'round');
    gFaces.appendChild(poly); faceEls.set(f.id, poly);
    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('dominant-baseline', 'central'); tx.setAttribute('font-size', '0.42'); tx.setAttribute('font-weight', '700'); tx.setAttribute('font-family', 'system-ui, sans-serif'); tx.setAttribute('fill', 'currentColor'); tx.setAttribute('pointer-events', 'none');
    tx.textContent = lang === 'en' ? f.en : f.tr; gLabels.appendChild(tx); labelEls.set(f.id, tx);
  }
  // kenarlar: iki yüzü paylaşan köşe çiftleri
  const edgeEls = [];
  for (let i = 0; i < CUBE_FACES.length; i++) for (let j = i + 1; j < CUBE_FACES.length; j++) {
    const a = CUBE_FACES[i], b = CUBE_FACES[j];
    if (a.n[0] + b.n[0] === 0 && a.n[1] + b.n[1] === 0 && a.n[2] + b.n[2] === 0) continue; // karşıt yüzler
    const pts = corners.filter(c => c[0] * a.n[0] + c[1] * a.n[1] + c[2] * a.n[2] > 0 && c[0] * b.n[0] + c[1] * b.n[1] + c[2] * b.n[2] > 0);
    const ln = document.createElementNS(NS, 'line');
    ln.dataset.edge = a.id + '-' + b.id; ln.setAttribute('stroke', 'currentColor'); ln.setAttribute('stroke-opacity', '0.001'); ln.setAttribute('stroke-width', '0.28'); ln.setAttribute('stroke-linecap', 'round'); ln.style.pointerEvents = 'stroke';
    gEdges.appendChild(ln); edgeEls.push({ el: ln, pts, faces: [a, b], dir: [a.n[0] + b.n[0], a.n[1] + b.n[1], a.n[2] + b.n[2]] });
  }
  // köşeler
  const cornerEls = corners.map(c => {
    const ci = document.createElementNS(NS, 'circle');
    ci.dataset.corner = cornerId(c[0], c[1], c[2]); ci.setAttribute('r', '0.16'); ci.setAttribute('fill', 'currentColor'); ci.setAttribute('fill-opacity', '0.35'); ci.setAttribute('stroke', stroke); ci.setAttribute('stroke-width', '0.02');
    gCorners.appendChild(ci); return { el: ci, c };
  });
  // kuzey işareti
  const north = document.createElementNS(NS, 'text');
  north.setAttribute('text-anchor', 'middle'); north.setAttribute('dominant-baseline', 'central'); north.setAttribute('font-size', '0.34'); north.setAttribute('font-weight', '700'); north.setAttribute('font-family', 'system-ui, sans-serif'); north.setAttribute('fill', '#ff453a'); north.setAttribute('pointer-events', 'none'); north.textContent = 'K';
  gNorth.appendChild(north);
  container.appendChild(svg);
  // mini düğmeler
  const btns = document.createElement('div'); btns.className = 'cube-btns';
  btns.style.cssText = 'display:flex;gap:4px;justify-content:center;margin-top:2px';
  const bPersp = document.createElement('button'); bPersp.type = 'button'; bPersp.dataset.cube = 'persp'; bPersp.className = 'cube-btn';
  const bHome = document.createElement('button'); bHome.type = 'button'; bHome.dataset.cube = 'home'; bHome.className = 'cube-btn'; bHome.setAttribute('aria-label', tt('fit3', 'Sığdır'));
  bHome.innerHTML = document.getElementById('i-home') ? '<svg class="ic" width="16" height="16" aria-hidden="true"><use href="#i-home"/></svg>' : '⌂';
  for (const b of [bPersp, bHome]) b.style.cssText = 'min-width:40px;height:26px;padding:0 6px;border:1px solid var(--line,#888);border-radius:6px;background:var(--btn,#333);color:var(--fg,#eee);font:600 11px system-ui,sans-serif';
  btns.append(bPersp, bHome); container.appendChild(btns);

  const emit = (k, v) => { try { host.onChange && host.onChange(k, v); } catch (_) { /* geç */ } };
  const after = () => { v3.render(); update(); };
  const doPreset = (id, pitchOverride) => {
    const anim = !(host.ui && host.ui.reduceMotion);
    if (View3D.PRESET_ANGLES[id] && pitchOverride == null) v3.preset(id, { animate: anim });
    else { const base = View3D.PRESET_ANGLES[id.replace('-low', '')]; if (base) v3.setCamera({ yaw: base.yaw, pitch: pitchOverride != null ? pitchOverride : -base.pitch }, { animate: anim }); }
    emit('preset', id); update();
  };
  let last = { yaw: null, pitch: null, persp: null };
  function update() {
    const c = v3.cam;
    if (c.yaw === last.yaw && c.pitch === last.pitch && c.persp === last.persp) return;
    last = { yaw: c.yaw, pitch: c.pitch, persp: c.persp };
    bPersp.textContent = c.persp ? tt('perspShort', 'Persp') : tt('orthoShort', 'Paralel');
    // çizim açıları: yüzler kenardan görünmesin diye sınırlanır (her zaman 3 yüz tıklanabilir)
    let p = c.pitch, y = c.yaw;
    const amin = 22 * Math.PI / 180, amax = 68 * Math.PI / 180;
    p = (Math.abs(p) < 1e-6 ? 1 : SGN(p)) * clamp(Math.abs(p), amin, amax);
    const q = Math.PI / 2, r = ((y % q) + q) % q, lim = 12 * Math.PI / 180;
    if (r < lim) y += lim - r; else if (r > q - lim) y -= r - (q - lim);
    const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
    const d = [cp * cy, cp * sy, sp];                      // kameraya doğru
    const right = [-sy, cy, 0], up = [-sp * cy, -sp * sy, cp];
    const proj = (v) => [v[0] * right[0] + v[1] * right[1], -(v[0] * up[0] + v[1] * up[1] + v[2] * up[2])];
    const P = corners.map(v => proj(v));
    const vis = new Map();
    for (const f of CUBE_FACES) {
      const dot = f.n[0] * d[0] + f.n[1] * d[1] + f.n[2] * d[2];
      const on = dot > 0.02; vis.set(f.id, on);
      const el = faceEls.get(f.id), lb = labelEls.get(f.id);
      el.setAttribute('visibility', on ? 'visible' : 'hidden'); lb.setAttribute('visibility', on ? 'visible' : 'hidden');
      if (!on) continue;
      const fc = faceCorners(f);
      // saat yönünde sırala (yüz merkezine göre açı)
      const cen = proj(f.n); const pts = fc.map(v => proj(v));
      pts.sort((a, b) => Math.atan2(a[1] - cen[1], a[0] - cen[0]) - Math.atan2(b[1] - cen[1], b[0] - cen[0]));
      el.setAttribute('points', pts.map(v => v[0].toFixed(3) + ',' + v[1].toFixed(3)).join(' '));
      el.setAttribute('fill-opacity', String(0.12 + 0.28 * dot));
      lb.setAttribute('x', cen[0].toFixed(3)); lb.setAttribute('y', cen[1].toFixed(3));
    }
    for (const e of edgeEls) {
      const on = vis.get(e.faces[0].id) || vis.get(e.faces[1].id);
      e.el.setAttribute('visibility', on ? 'visible' : 'hidden');
      if (!on) continue;
      const a = proj(e.pts[0]), b = proj(e.pts[1]);
      e.el.setAttribute('x1', a[0].toFixed(3)); e.el.setAttribute('y1', a[1].toFixed(3)); e.el.setAttribute('x2', b[0].toFixed(3)); e.el.setAttribute('y2', b[1].toFixed(3));
    }
    cornerEls.forEach((ce, i) => {
      const c3 = ce.c; const on = CUBE_FACES.some(f => vis.get(f.id) && c3[0] * f.n[0] + c3[1] * f.n[1] + c3[2] * f.n[2] > 0);
      ce.el.setAttribute('visibility', on ? 'visible' : 'hidden');
      if (on) { ce.el.setAttribute('cx', P[i][0].toFixed(3)); ce.el.setAttribute('cy', P[i][1].toFixed(3)); }
    });
    let swap = false; try { swap = !!(window.dwgApp && window.dwgApp.state && window.dwgApp.state.geo && window.dwgApp.state.geo.swap); } catch (_) { /* geç */ }
    const nv = swap ? [1.3, 0, -1] : [0, 1.3, -1];
    const np = proj(nv); north.setAttribute('x', np[0].toFixed(3)); north.setAttribute('y', np[1].toFixed(3));
  }
  // dokunma: sürükle → yörünge, dokun → ön ayar, çift dokun → sığdır
  let pd = null, lastTap = 0, lastTapEl = null;
  const onDown = (ev) => { ev.stopPropagation(); ev.preventDefault(); try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* geç */ } pd = { x: ev.clientX, y: ev.clientY, lx: ev.clientX, ly: ev.clientY, moved: false, target: ev.target }; };
  const onMove = (ev) => {
    if (!pd) return; ev.stopPropagation();
    const dx = ev.clientX - pd.lx, dy = ev.clientY - pd.ly;
    if (!pd.moved && Math.hypot(ev.clientX - pd.x, ev.clientY - pd.y) > 4) pd.moved = true;
    if (pd.moved) { v3.orbit(dx * 1.6, dy * 1.6); v3.render(); update(); emit('camera', v3.getCamera()); }
    pd.lx = ev.clientX; pd.ly = ev.clientY;
  };
  const onUp = (ev) => {
    if (!pd) return; ev.stopPropagation();
    const st = pd; pd = null;
    if (st.moved) { v3.pushHistory(); return; }
    const now = performance.now();
    const tEl = (st.target && st.target.closest) ? st.target.closest('[data-face],[data-corner],[data-edge]') : null;
    // aynı yüze çift dokunuş → sığdır
    if (now - lastTap < 320 && lastTapEl === tEl) { lastTap = 0; lastTapEl = null; v3.fit({ animate: !(host.ui && host.ui.reduceMotion) }); emit('fit', null); update(); return; }
    lastTap = now; lastTapEl = tEl;
    if (!tEl) return;
    if (tEl.dataset.face) doPreset(tEl.dataset.face);
    else if (tEl.dataset.corner) { const id = tEl.dataset.corner; if (id.endsWith('-low')) doPreset(id, -View3D.PRESET_ANGLES[id.replace('-low', '')].pitch); else doPreset(id); }
    else if (tEl.dataset.edge) {
      const [fa, fb] = tEl.dataset.edge.split('-').map(faceOf); if (!fa || !fb) return;
      const dir = [fa.n[0] + fb.n[0], fa.n[1] + fb.n[1], fa.n[2] + fb.n[2]];
      const yaw = (dir[0] === 0 && dir[1] === 0) ? v3.cam.yaw : Math.atan2(dir[1], dir[0]);
      const pitch = dir[2] === 0 ? 0.001 : dir[2] > 0 ? Math.PI / 4 : -Math.PI / 4;
      v3.setCamera({ yaw, pitch }, { animate: !(host.ui && host.ui.reduceMotion) }); emit('preset', tEl.dataset.edge); update();
    }
  };
  svg.addEventListener('pointerdown', onDown); svg.addEventListener('pointermove', onMove); svg.addEventListener('pointerup', onUp); svg.addEventListener('pointercancel', onUp);
  const onBtn = (ev) => {
    const b = ev.target.closest('[data-cube]'); if (!b) return; ev.stopPropagation();
    if (b.dataset.cube === 'persp') { v3.set('persp', !v3.cam.persp); update(); emit('persp', v3.cam.persp); }
    else if (b.dataset.cube === 'home') { v3.fit({ animate: false }); v3.preset('iso', { animate: !(host.ui && host.ui.reduceMotion) }); emit('preset', 'iso'); update(); }
  };
  btns.addEventListener('click', onBtn);
  const stop = (ev) => ev.stopPropagation();
  btns.addEventListener('pointerdown', stop);
  const onEvt = () => update();
  window.addEventListener('dwg:view3d', onEvt);
  update();
  return { el: svg, update, destroy() { svg.removeEventListener('pointerdown', onDown); svg.removeEventListener('pointermove', onMove); svg.removeEventListener('pointerup', onUp); svg.removeEventListener('pointercancel', onUp); btns.removeEventListener('click', onBtn); window.removeEventListener('dwg:view3d', onEvt); container.innerHTML = ''; } };
}

// ---------------------------------------------------------------------------------
// kamera yer imleri
// ---------------------------------------------------------------------------------
const bmKey = (fileKey) => 'cam3:' + (fileKey || '');
export function listBookmarks(fileKey) { const a = store.json(bmKey(fileKey), []); return Array.isArray(a) ? a : []; }
function saveBookmarks(fileKey, list) { store.set(bmKey(fileKey), JSON.stringify(list.slice(0, 50))); }
function thumbOf(v3) {
  try {
    const c = document.createElement('canvas'); c.width = 96; c.height = 72;
    const g = c.getContext('2d'); const cv = v3.cv;
    const s = Math.max(96 / cv.width, 72 / cv.height), w = cv.width * s, h = cv.height * s;
    g.drawImage(cv, (96 - w) / 2, (72 - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.6);
  } catch (_) { return ''; }
}

export function openCameraBookmarks(v3, bodyEl, host = {}) {
  const fileKey = host.fileKey != null ? host.fileKey : (window.dwgApp && window.dwgApp.state ? window.dwgApp.state.fileKey : '');
  const fmt = fmtOf(host);
  const render = () => {
    const list = listBookmarks(fileKey);
    bodyEl.innerHTML = W.sec('bookmarks', tt('v3Bookmarks', 'Yer imleri'),
      `<div class="opt-row cam-add"><input id="camName" type="text" class="opt-text" placeholder="${esc(tt('viewName', 'Görünüm adı'))}" aria-label="${esc(tt('viewName', 'Görünüm adı'))}" maxlength="40"><button type="button" id="camSave" class="btn primary small">${esc(tt('save', 'Kaydet'))}</button></div>` +
      `<div class="full list cam-list">` + (list.length ? list.map((b, i) => `<div class="item cam-item" data-i="${i}" role="button" tabindex="0">${b.thumb ? `<img class="cam-thumb" src="${esc(b.thumb)}" alt="" width="48" height="36">` : ''}<span class="nm">${esc(b.name)}</span><small>${esc(`Yaw ${fmt(b.cam.yaw * 180 / Math.PI, 0)}° · Pitch ${fmt(b.cam.pitch * 180 / Math.PI, 0)}° · Z×${fmt(b.zScale || 1, 2)}`)} · <a href="#" data-del="${i}">${esc(tt('delete', 'Sil'))}</a></small></div>`).join('') : `<div class="muted">${esc(tt('noViews', 'Kayıtlı görünüm yok.'))}</div>`) + `</div>`);
  };
  const onClick = (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) { ev.preventDefault(); ev.stopPropagation(); const list = listBookmarks(fileKey); list.splice(+del.dataset.del, 1); saveBookmarks(fileKey, list); render(); host.toast && host.toast(tt('deleted', 'Silindi')); return; }
    if (ev.target.closest('#camSave')) {
      ev.stopPropagation();
      const inp = bodyEl.querySelector('#camName'); const list = listBookmarks(fileKey);
      const name = (inp && inp.value.trim()) || `${tt('view3dName', '3B görünüm')} ${list.length + 1}`;
      list.unshift({ name, cam: v3.getCamera(), zScale: v3.zScale, style: v3.opts.style, colorMode: v3.opts.colorMode, clip: v3.opts.clip ? v3.opts.clip.slice() : null, thumb: thumbOf(v3), t: Date.now() });
      saveBookmarks(fileKey, list); render();
      host.toast && host.toast(tt('viewSaved', 'Görünüm kaydedildi'));
      return;
    }
    const it = ev.target.closest('.cam-item'); if (!it || !bodyEl.contains(it)) return;
    ev.stopPropagation();
    const b = listBookmarks(fileKey)[+it.dataset.i]; if (!b) return;
    if (b.style) v3.set('style', b.style); if (b.colorMode) v3.set('colorMode', b.colorMode);
    v3.set('clip', b.clip || null);
    if (b.zScale > 0) v3.set('zScale', b.zScale);
    v3.setCamera(b.cam, { animate: !(host.ui && host.ui.reduceMotion) });
    try { host.onChange && host.onChange('bookmark', b); } catch (_) { /* geç */ }
  };
  const onKey = (ev) => { if (ev.key === 'Enter' && ev.target && ev.target.id === 'camName') { ev.preventDefault(); const b = bodyEl.querySelector('#camSave'); if (b) b.click(); } else if (ev.key === 'Enter' && ev.target && ev.target.classList && ev.target.classList.contains('cam-item')) { ev.target.click(); } };
  render();
  bodyEl.addEventListener('click', onClick); bodyEl.addEventListener('keydown', onKey);
  return { destroy() { bodyEl.removeEventListener('click', onClick); bodyEl.removeEventListener('keydown', onKey); } };
}
