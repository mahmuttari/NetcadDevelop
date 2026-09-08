/*
 * Düzenleyici bağlayıcısı: araç çubuğu (sekmeli düğmeler), komut satırı, ToolManager,
 * EditDoc (geri al/yinele, kalıcılık), DXF kaydetme ve 3B görünüm.
 * app.js, initEditor(api) ile bağlar; api: { S, requestRender, drawOverlay, toast, pick, snap, showInfo,
 *   openDoc, hide, show, esc, kv, copyText, buildLayerList, fmt, store, RTree, saveText, baseName }
 */
import { ToolManager, TOOLS } from './tools.js';
import { EditDoc, writeDxf, newId } from './edit.js';
import { View3D } from './view3d.js';
import { FG, ACI } from './scene.js';
import { toScreen, toWorld, fmt } from './state.js';
import { TAU } from './geom.js';

const $ = (id) => document.getElementById(id);
let api, S, tools, doc = null, v3 = null;
const ed = { is3D: () => !!(v3 && !$('cv3d').hidden), tools: null, doc: null, curLayer: '0', curColor: 256, tab: 'view', sel: new Set(), result: null, m3: null };

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
  buildToolbar();
  bindCmdBar();
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
  const u = $('tbUndo'), r = $('tbRedo');
  if (u) u.disabled = !(doc && doc.undoStack.length);
  if (r) r.disabled = !(doc && doc.redoStack.length);
  const b = $('tbSave'); if (b) b.classList.toggle('dirty', !!(doc && doc.dirty));
}

// ---------------------------------------------------------------------------------
// Araç çubuğu
// ---------------------------------------------------------------------------------
const TABS = [
  { id: 'view', name: 'Görünüm', items: [
    ['extents', '⤢', 'Sığdır'], ['layers', '☰', 'Katmanlar'], ['search', '🔍', 'Ara'], ['notes', '✏️', 'Notlar'], ['gps', '🧭', 'GPS'], ['pdf', '📑', 'PDF'], ['png', '🖼️', 'PNG'],
    ['undo', '↶', 'Geri al'], ['redo', '↷', 'Yinele'], ['savedxf', '💾', 'DXF kaydet'], ['savedelta', '📤', 'Değişiklikler'], ['more', '⋮', 'Diğer']] },
  { id: 'measure', name: 'Ölçü', items: [
    ['t:dist', '📏', 'Mesafe'], ['t:area', '⬠', 'Alan'], ['t:angle', '∠', 'Açı'], ['t:radius', '◔', 'Yarıçap'], ['t:coord', '⌖', 'Koordinat'], ['profile', '📈', 'Profil']] },
  { id: 'draw', name: 'Çiz', items: [
    ['t:line', '╱', 'Çizgi'], ['t:pline', '⌇', 'Polyline'], ['t:rect', '▭', 'Dikdörtgen'], ['t:circle', '◯', 'Daire'], ['t:arc3', '◠', 'Yay'], ['t:point', '·', 'Nokta'], ['t:text', 'T', 'Yazı'],
    ['t:pline3d', '⛓', '3B Polyline'], ['t:face3d', '◈', '3B Yüzey'], ['layer', '▤', 'Katman'], ['color', '🎨', 'Renk']] },
  { id: 'edit', name: 'Düzenle', items: [
    ['t:select', '👆', 'Seç'], ['t:move', '✥', 'Taşı'], ['t:copy', '⧉', 'Kopyala'], ['t:rotate', '⟳', 'Döndür'], ['t:scale', '⤡', 'Ölçekle'], ['t:mirror', '⇔', 'Aynala'], ['t:offset', '≡', 'Ofset'],
    ['t:del', '🗑', 'Sil'], ['t:setz', 'Z', 'Kot ata'], ['t:edittext', 'Tₑ', 'Yazı düzenle'], ['props', '⚙', 'Özellikler'], ['undo', '↶', 'Geri al'], ['redo', '↷', 'Yinele']] },
  { id: '3d', name: '3B', items: [
    ['3d', '🧊', '3B aç/kapat'], ['v:iso', '⬡', 'İzometrik'], ['v:top', '⬒', 'Üst'], ['v:front', '⬓', 'Ön'], ['v:left', '◧', 'Sol'], ['persp', '👁', 'Perspektif'], ['zscale', '↕', 'Z abartı'], ['fit3', '⤢', 'Sığdır'],
    ['3:select', '👆', 'Seç'], ['3:dist', '📏', '3B mesafe'], ['3:move', '✥', 'Taşı (3B)'], ['3:pline', '⛓', '3B Polyline'], ['3:setz', 'Z', 'Kot ata'], ['3:del', '🗑', 'Sil'], ['undo', '↶', 'Geri al']] },
];
function buildToolbar() {
  const tb = $('toolbar');
  tb.innerHTML = `<div class="tb-tabs">${TABS.map(t => `<button data-tab="${t.id}" class="${t.id === ed.tab ? 'active' : ''}">${t.name}</button>`).join('')}</div>` +
    TABS.map(t => `<div class="tb-row" data-for="${t.id}" ${t.id === ed.tab ? '' : 'hidden'}>${t.items.map(it => `<button data-act="${it[0]}" id="${it[0] === 'undo' && t.id === 'view' ? 'tbUndo' : it[0] === 'redo' && t.id === 'view' ? 'tbRedo' : it[0] === 'savedxf' ? 'tbSave' : it[0] === 'layer' ? 'tbLayer' : ''}" title="${it[2]}"><span class="ic">${it[1]}</span><span class="lb">${it[2]}</span></button>`).join('')}</div>`).join('');
  tb.addEventListener('click', (ev) => {
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const b = ev.target.closest('[data-act]'); if (!b) return;
    act(b.dataset.act, b);
  });
}
function setTab(id) {
  ed.tab = id;
  document.querySelectorAll('#toolbar [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('#toolbar .tb-row').forEach(r => { r.hidden = r.dataset.for !== id; });
}
function markActive(name) {
  document.querySelectorAll('#toolbar [data-act]').forEach(b => b.classList.toggle('active', b.dataset.act === name));
}
function needDoc() { if (!S.hasDoc) { api.toast('Önce bir dosya açın.'); return false; } return true; }
function needModel() { if (!needDoc()) return false; if (!S.scene.layouts[S.layoutIndex].isModel) { api.toast('Düzenleme yalnız model uzayında yapılır.'); return false; } return true; }
function act(name, btn) {
  if (name.startsWith('t:')) { if (!needModel()) return; if (ed.is3D()) exit3D(); const tn = name.slice(2); if (tools.active === tn) { tools.cancel(); markActive(null); } else { tools.start(tn); markActive(name); } return; }
  if (name.startsWith('v:')) { if (v3) { v3.preset(name.slice(2)); v3.render(); overlay3D(); } return; }
  if (name.startsWith('3:')) { if (!needModel()) return; if (!ed.is3D()) enter3D(); start3DTool(name.slice(2)); markActive(name); return; }
  switch (name) {
    case 'extents': api.zoomExtents(); break;
    case 'layers': api.action('layers'); break;
    case 'search': api.action('search'); break;
    case 'notes': api.action('notes'); break;
    case 'gps': api.action('gps'); break;
    case 'pdf': api.action('pdf'); break;
    case 'png': api.action('png'); break;
    case 'more': api.action('more'); break;
    case 'profile': api.action('profile'); break;
    case 'undo': if (doc && doc.undo()) { refreshUndo(); api.requestRender(); api.toast('Geri alındı'); } break;
    case 'redo': if (doc && doc.redo()) { refreshUndo(); api.requestRender(); api.toast('Yinelendi'); } break;
    case 'savedxf': saveDxf(false); break;
    case 'savedelta': saveDxf(true); break;
    case 'layer': pickLayer(); break;
    case 'color': pickColor(); break;
    case 'props': showProps(); break;
    case '3d': if (!needModel()) return; if (ed.is3D()) exit3D(); else enter3D(); break;
    case 'persp': if (v3) { v3.cam.persp = !v3.cam.persp; v3.render(); overlay3D(); api.toast(v3.cam.persp ? 'Perspektif' : 'Ortografik'); } break;
    case 'zscale': if (v3) { const v = prompt('Z abartı çarpanı (1 = gerçek):', String(v3.zScale)); const f = parseFloat(String(v || '').replace(',', '.')); if (f > 0) { v3.zScale = f; v3.render(); overlay3D(); } } break;
    case 'fit3': if (v3) { v3.fit(); v3.render(); overlay3D(); } break;
    default: break;
  }
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
  $('cmdBtns').innerHTML = (opts.buttons || []).map(k => `<button data-cmd="${k}">${BTN[k][0]}</button>`).join('');
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
  return `<div class="swatches">${ids.map(i => `<button data-ci="${i}" class="${i === sel ? 'active' : ''}" style="background:${i === 256 ? 'transparent' : i === 7 ? '#ffffff' : '#' + (ACI[i] & 0xffffff).toString(16).padStart(6, '0')}" title="${i === 256 ? 'Katmandan' : i}">${i === 256 ? 'K' : ''}</button>`).join('')}</div>`;
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
  if (window.Android && window.Android.saveFile) { const r = window.Android.saveFile(b64, name, 'application/dxf', true); api.toast(r ? 'DXF kaydedildi: ' + r : 'DXF kaydedilemedi'); }
  else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/dxf' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
}

// ---------------------------------------------------------------------------------
// Dokunma ve kaplama (2B)
// ---------------------------------------------------------------------------------
/** app.onTap → true ise araç işledi */
export function tap(w, sx, sy) {
  if (ed.is3D()) return true; // 3B tuvali kendi olaylarını işler
  if (!tools.running) return false;
  return tools.tap(w, [sx, sy]);
}
export function back() {
  if (ed.m3) { ed.m3 = null; showPrompt(null); markActive(null); overlay3D(); return true; }
  if (ed.is3D()) { exit3D(); return true; }
  if (tools.running) { tools.cancel(); markActive(null); return true; }
  if (ed.sel.size) { ed.sel.clear(); api.drawOverlay(); return true; }
  return false;
}
/** 2B kaplama: seçim vurgusu ve araç önizlemesi */
export function overlay(c) {
  if (ed.sel.size) {
    const k = S.view.scale * S.dpr;
    c.save();
    c.setTransform(k, 0, 0, -k, c.canvas.width / 2 - k * S.view.cx, c.canvas.height / 2 + k * S.view.cy);
    c.strokeStyle = '#ff9f0a'; c.lineWidth = 2.5 / S.view.scale; c.setLineDash([6 / S.view.scale, 4 / S.view.scale]); c.globalAlpha = 0.95;
    for (const p of ed.sel) { if (p.k === 0) { c.beginPath(); api.tracePath(c, p.ops); if (p.closed) c.closePath(); c.stroke(); } else c.strokeRect(p.bb[0], p.bb[1], p.bb[2] - p.bb[0], p.bb[3] - p.bb[1]); }
    c.restore(); c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  }
  const d = tools.draft;
  if (!d || !tools.running && !d.keep) return;
  c.strokeStyle = '#ff9f0a'; c.fillStyle = '#ff9f0a'; c.lineWidth = 2; c.setLineDash([]);
  if (d.segs) for (const s of d.segs) { const a = toScreen(s[0][0], s[0][1]), b = toScreen(s[1][0], s[1][1]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
  if (d.close && d.pts && d.pts.length > 2) { const a = toScreen(d.pts[0][0], d.pts[0][1]), b = toScreen(d.pts[d.pts.length - 1][0], d.pts[d.pts.length - 1][1]); c.setLineDash([4, 4]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.setLineDash([]); }
  if (d.circle) { const s = toScreen(d.circle.c[0], d.circle.c[1]); c.beginPath(); c.arc(s[0], s[1], d.circle.r * S.view.scale, 0, TAU); c.stroke(); }
  if (d.pts) { c.font = 'bold 11px sans-serif'; c.textBaseline = 'bottom'; d.pts.forEach((p, i) => { const s = toScreen(p[0], p[1]); c.beginPath(); c.arc(s[0], s[1], 4, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.fillText(String(i + 1), s[0] + 6, s[1] - 5); c.fillStyle = '#ff9f0a'; }); }
}

// ---------------------------------------------------------------------------------
// 3B görünüm
// ---------------------------------------------------------------------------------
function enter3D() {
  const cv = $('cv3d');
  if (!v3) { try { v3 = new View3D(cv); } catch (e) { api.toast('3B görünüm açılamadı: ' + e.message); return; } bind3D(cv); }
  tools.cancel(); markActive(null);
  cv.hidden = false;
  resize3D();
  refresh3D();
  v3.fit(); v3.preset('iso'); v3.render(); overlay3D();
  api.toast('3B: tek parmak döndürür, iki parmak kaydırır / yakınlaştırır');
  document.querySelector('#toolbar [data-act="3d"]').classList.add('active');
}
export function exit3D() {
  $('cv3d').hidden = true; ed.m3 = null; showPrompt(null);
  document.querySelector('#toolbar [data-act="3d"]').classList.remove('active');
  api.drawOverlay();
}
function resize3D() { const cv = $('cv3d'); const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * S.dpr); cv.height = Math.round(r.height * S.dpr); }
function refresh3D() { if (!v3) return; v3.setScene(S.scene.layouts[0].prims, S.layers, { dark: S.dark, mono: S.mono }); v3.setSelection(ed.sel); }
export function onResize() { if (ed.is3D()) { resize3D(); v3.render(); overlay3D(); } }
export function onTheme() { if (ed.is3D()) { refresh3D(); v3.render(); overlay3D(); } }
const p3 = { pointers: new Map(), last: null, d0: 0, mid0: null, moved: false, snap: null, pts: [] };
function bind3D(cv) {
  cv.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation(); cv.setPointerCapture(ev.pointerId);
    p3.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]); p3.moved = false;
    const arr = [...p3.pointers.values()];
    if (arr.length === 2) { p3.d0 = Math.hypot(arr[0][0] - arr[1][0], arr[0][1] - arr[1][1]); p3.mid0 = [(arr[0][0] + arr[1][0]) / 2, (arr[0][1] + arr[1][1]) / 2]; }
    p3.last = [ev.clientX, ev.clientY];
  });
  cv.addEventListener('pointermove', (ev) => {
    ev.stopPropagation();
    if (!p3.pointers.has(ev.pointerId)) return;
    p3.pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const arr = [...p3.pointers.values()];
    if (arr.length === 1) {
      const dx = ev.clientX - p3.last[0], dy = ev.clientY - p3.last[1];
      if (Math.hypot(dx, dy) > 2) p3.moved = true;
      if (p3.moved) v3.orbit(dx, dy);
      p3.last = [ev.clientX, ev.clientY];
    } else if (arr.length >= 2) {
      p3.moved = true;
      const d = Math.hypot(arr[0][0] - arr[1][0], arr[0][1] - arr[1][1]);
      const mid = [(arr[0][0] + arr[1][0]) / 2, (arr[0][1] + arr[1][1]) / 2];
      if (p3.d0 > 0) v3.zoom(d / p3.d0);
      v3.pan(mid[0] - p3.mid0[0], mid[1] - p3.mid0[1]);
      p3.d0 = d; p3.mid0 = mid;
    }
    v3.render(); overlay3D();
  });
  const up = (ev) => {
    ev.stopPropagation();
    const had = p3.pointers.delete(ev.pointerId);
    if (had && !p3.moved && p3.pointers.size === 0 && ev.type === 'pointerup') { const r = cv.getBoundingClientRect(); tap3D(ev.clientX - r.left, ev.clientY - r.top); }
    if (p3.pointers.size === 1) { const p = [...p3.pointers.values()][0]; p3.last = p; p3.moved = true; }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); ev.stopPropagation(); v3.zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15); v3.render(); overlay3D(); }, { passive: false });
}
function tap3D(sx, sy) {
  const hit = v3.pickVertex(sx, sy, 22);
  if (!ed.m3) {
    ed.sel.clear();
    if (hit) { ed.sel.add(hit.prim); api.showInfo(hit.prim); } else api.hide('infoPanel');
    v3.setSelection(ed.sel); v3.render(); overlay3D();
    return;
  }
  const m = ed.m3;
  if (m.name === 'select') { if (hit) { if (ed.sel.has(hit.prim)) ed.sel.delete(hit.prim); else ed.sel.add(hit.prim); prompt3D(); } v3.setSelection(ed.sel); v3.render(); overlay3D(); return; }
  if (!hit) { api.toast('Bir köşeye dokunun (köşeler yakalanır)'); return; }
  p3.snap = hit.p;
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
  $('cmdBtns').innerHTML = (m.name === 'pline' ? `<button data-cmd3="finish">✓ Bitir</button>` : '') + (m.pts.length ? `<button data-cmd3="back">↶ Geri</button>` : '') + `<button data-cmd3="cancel">✕ İptal</button>`;
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
/** 3B üstüne 2B kaplama: yakalama işareti, toplanan noktalar, eksen etiketleri */
function overlay3D() {
  if (!ed.is3D()) return;
  const ov = $('ov'), c = ov.getContext('2d');
  c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); c.clearRect(0, 0, S.W, S.H);
  const fg = S.dark ? '#f2f4f7' : '#111';
  c.font = '11px sans-serif'; c.fillStyle = fg; c.textBaseline = 'top';
  c.fillText(`Yaw ${fmt(v3.cam.yaw * 180 / Math.PI, 0)}°  Pitch ${fmt(v3.cam.pitch * 180 / Math.PI, 0)}°  Z×${v3.zScale}  Izgara ${fmt(v3.gridStep)}${S.units ? ' ' + S.units : ''}  ${v3.cam.persp ? 'Persp.' : 'Orto.'}`, 8, 8);
  const bb = v3.bb; if (bb) c.fillText(`Z: ${fmt(bb[2])} … ${fmt(bb[5])}`, 8, 24);
  // eksen etiketleri
  const o = v3.project(bb[0], bb[1], bb[2]); const a = Math.max(bb[3] - bb[0], bb[4] - bb[1]) * 0.15 || 1;
  const lab = (p, t, col) => { c.fillStyle = col; c.fillText(t, p[0] + 3, p[1] - 12); };
  lab(v3.project(bb[0] + a, bb[1], bb[2]), 'X', '#ff453a'); lab(v3.project(bb[0], bb[1] + a, bb[2]), 'Y', '#30d158'); lab(v3.project(bb[0], bb[1], bb[2] + a), 'Z', '#4285f4');
  if (ed.m3 && ed.m3.pts.length) {
    c.strokeStyle = '#ff9f0a'; c.fillStyle = '#ff9f0a'; c.lineWidth = 2;
    const ps = ed.m3.pts.map(p => v3.project(p[0], p[1], p[2]));
    c.beginPath(); ps.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
    ps.forEach((p, i) => { c.beginPath(); c.arc(p[0], p[1], 5, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.fillText(String(i + 1), p[0] + 7, p[1] - 7); c.fillStyle = '#ff9f0a'; });
  }
  if (p3.snap) { const s = v3.project(p3.snap[0], p3.snap[1], p3.snap[2]); c.strokeStyle = '#3ddc84'; c.lineWidth = 2; c.strokeRect(s[0] - 7, s[1] - 7, 14, 14); }
}
ed.view3d = () => v3;
export const editor = ed;
