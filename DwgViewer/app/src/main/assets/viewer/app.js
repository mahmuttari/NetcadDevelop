/*
 * DWG Görüntüleyici – uygulama: yükleme, çizim döngüsü, dokunma, paneller ve araçlar.
 * Çözümleme worker.js'te, geometri geom.js'te, çizim render.js'te.
 */
import { S, toWorld, toScreen, fitView, zoomAtScreen, visibleRect, UNITS, UNIT_TO_M, fmt, fmtUnit, store } from './state.js';
import { RTree, snapPoint, primDist, flatten, pathLength, polyArea, TAU } from './geom.js';
import { FG, primSignature } from './scene.js';
import { drawFrame, rgbCss, bgColor, fgColor, tracePath, renderRegion, gridState, niceStep, worldTransform as renderWorldTransform, worldOrigin } from './render.js';
import * as D from './display.js';
import { DISPLAY_DEFAULTS, setDisplay, getDisplay, toggleDisplay, primVisible, isolateLayers, unisolate, isIsolated, setLayerFaded, openDisplayOptions, closeDisplayOptions, mountNavFabs, gridLabel, refreshNav } from './display.js';
import * as editorMod from './editor.js';
import { setTileCallback, basemapAttribution } from './tiles.js';
import { notes, loadNotes, saveNotes, addNote, removeNote, hitNote, drawNotes } from './notes.js';
import { CRS, GeoRef, BASEMAPS, nameOf } from './proj.js';
import { t, setLang, getLang, applyI18n } from './i18n.js';
import { askText, askConfirm, isOpen as askOpen, cancel as askCancel } from './dialog.js';
import { initEditor, onScene as editorScene, tap as editorTap, back as editorBack, overlay as editorOverlay, onResize as editorResize, onTheme as editorTheme, editor } from './editor.js';
import * as Docs from './docs.js';
import * as Drive from './drive.js';

const $ = (id) => document.getElementById(id);
const A = () => window.Android || null;
/** i18n anahtarı yoksa Türkçe varsayılan */
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
/** C'nin (editor.js) isteğe bağlı dışa aktarımları – guard'lı */
const haptic = (kind) => { try { if (typeof editorMod.haptic === 'function') editorMod.haptic(kind); } catch (_) { /* yok */ } };
const uiPrefs = () => { try { return editorMod.ui || {}; } catch (_) { return {}; } };
const glove = () => !!uiPrefs().glove;
const edCall = (name, ...a) => { try { const f = editor[name]; return typeof f === 'function' ? f.apply(editor, a) : undefined; } catch (e) { console.warn(e); return undefined; } };
/** sürüm dosyası: Android köprüsü derlendiği dalın adresini verir (Bridge.updateUrl); tarayıcıda main */
const VERSION_URL = (A() && A().updateUrl) ? A().updateUrl() : 'https://raw.githubusercontent.com/mahmuttari/NetcadDevelop/main/DwgViewer/release/version.json';

// ---------------------------------------------------------------------------
// Ayarlar
// ---------------------------------------------------------------------------
const settings = Object.assign({ lang: 'tr', dark: true, lwScale: 3, crs: 'NONE', unit: 'auto', swap: false, dx: 0, dy: 0, basemap: 'none', basemapUrl: '', wms: '', opacity: 0.8, snap: ['end', 'mid', 'cen', 'int', 'ins', 'node'] }, store.json('settings', {}));
/** 3B görünümde hiç yüzey yoksa: dosyadaki varlık türleri ve katı tanılaması bir kartta gösterilir (bir dosya için bir kez) */
function showNoFaces() {
  const c = S.counts || {}, cen = (S.scene && S.scene.census) || {}, d = S.scene && S.scene.solidDiag;
  const list = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k} <b>${v}</b>`).join(', ') || '—';
  const rows = [[t('status'), t('noFacesMsg')],
    [t('entityTypes'), list(c)], [t('dwgTypes'), list(cen)],
    [t('version'), `${S.version} · ${t('appLc')} ${A() && A().versionCode ? 'v' + A().versionCode() : t('browser')}`]];
  if (d) rows.push([t('solidDiag'), `${d.solids} ${t('solidsN')} · ${d.faces} ${t('facesN')} · ${d.skipped} ${t('skippedN')}` + (d.errors.length ? ' · ' + d.errors.slice(0, 3).join('; ') : '')]);
  rows.push([`<div class="full btns"><button class="btn small" id="btnNoFaceShare">${t('solidDiagShare')}</button></div>`]);
  openDoc(t('noFacesTitle'), kv(rows));
  const b = $('btnNoFaceShare'); if (b) b.onclick = () => { const txt = solidDiagText(); if (A() && A().shareText) A().shareText(t('solidDiagTitle'), txt); else copyText(txt); };
}
/** katı tanılama metni: sürümler, AcDs özeti, katı başına ham veri boyutu ve ilk katıların base64 örneği */
function solidDiagText() {
  const d = (S.scene && S.scene.solidDiag) || { solids: 0, faces: 0, approx: 0, skipped: 0, surfaces: {}, versions: [], unknownTags: [], errors: [], acds: null, samples: [] };
  const L = [`DWG Görüntüleyici ${A() && A().versionCode ? 'v' + A().versionCode() : ''} — katı tanılaması`, `Dosya: ${S.fileName}  Sürüm: ${S.version}`,
    `Sahne varlık türleri: ${JSON.stringify(S.counts || {})}`, `DWG nesne türleri (LibreDWG): ${JSON.stringify((S.scene && S.scene.census) || {})}`,
    `Katı: ${d.solids}  Yüzey: ${d.faces} (yaklaşık ${d.approx})  Atlanan: ${d.skipped}`, `Yüzey türleri: ${JSON.stringify(d.surfaces)}`, `ACIS sürümleri: ${d.versions.join(', ') || '-'}`,
    `Bilinmeyen SAB etiketleri: ${d.unknownTags.join(' ') || '-'}`, `AcDs: ${JSON.stringify(d.acds)}`, 'Hatalar:', ...d.errors.map(e => '  ' + e), 'Katılar:'];
  for (const s2 of d.samples || []) L.push(`  ${s2.handle}: acis ${s2.acisType || '-'} ${s2.acisBytes} B, tel ${s2.wires}, mesh ${s2.mesh}`);
  for (const s2 of d.samples || []) if (s2.b64) L.push('', `--- ${s2.handle} ${s2.acisType} ilk ${Math.min(49152, s2.acisBytes)} bayt (base64) ---`, s2.b64);
  return L.join('\n');
}

function saveSettings() { store.set('settings', JSON.stringify(settings)); }
let displayApplied = false;
function applySettings() {
  setLang(settings.lang); applyI18n();
  if (!S.hasDoc) $('fileName').textContent = t('noFile');
  S.basemap.id = settings.basemap || 'none'; S.basemap.url = settings.basemapUrl || ''; S.basemap.wms = settings.wms || '';
  if (!displayApplied) {
    // ekran ayarları göçü (v1 → v2): dark / lwScale / opacity alanları settings.display'e taşınır, eski okuyucular için yansıtılmaya devam eder
    if (!(settings.version >= 2) || !settings.display) {
      settings.display = { ...DISPLAY_DEFAULTS, ...(settings.display || {}), theme: settings.dark === false ? 'light' : 'dark', lwScale: settings.lwScale || 3, basemapOpacity: settings.opacity == null ? 0.8 : settings.opacity };
      settings.version = 2;
    }
    D.restore({ ...DISPLAY_DEFAULTS, ...settings.display, basemapOpacity: settings.display.basemapOpacity == null ? (settings.opacity == null ? 0.8 : settings.opacity) : settings.display.basemapOpacity }, { silent: true, persist: false });
    displayApplied = true;
  } else {
    // sonraki çağrılar (Ayarlar / Altlık kaydet): eski alanlardan gelen değerleri ekran durumuna yansıt
    if (settings.lwScale > 0 && settings.lwScale !== S.lwScale) setDisplay('lwScale', settings.lwScale, { silent: true });
    if (settings.opacity != null && settings.opacity !== S.basemap.opacity) setDisplay('basemapOpacity', settings.opacity, { silent: true });
  }
  settings.dark = S.dark; settings.lwScale = S.lwScale; settings.opacity = S.basemap.opacity; settings.display = { ...(settings.display || {}), ...D.snapshot() };
  S.snapModes = new Set(settings.snap || []);
  document.querySelectorAll('[data-snap]').forEach(cb => { cb.checked = S.snapModes.has(cb.dataset.snap); });
}
function applyGeo() {
  const g = S.fileKey ? store.json('geo:' + S.fileKey, null) : null;
  const src = g || settings;
  const unitToM = src.unit && src.unit !== 'auto' ? Number(src.unit) : (S.unitToM || 1);
  S.geo = new GeoRef({ crs: src.crs || 'NONE', unitToM, swap: !!src.swap, dx: Number(src.dx) || 0, dy: Number(src.dy) || 0 });
}

// ---------------------------------------------------------------------------
// İşçi (worker)
// ---------------------------------------------------------------------------
// Tek işçi; çökünce, yanıt vermeyince ya da kullanıcı vazgeçince sonlandırılıp yeniden kurulur (bekleyen işler reddedilir).
let worker = null;
const jobs = new Map();
let jobSeq = 0;
function onWorkerMsg(ev) {
  const j = jobs.get(ev.data.id);
  if (!j) return;
  if (ev.data.stage) { if (j.onStage) j.onStage(ev.data.stage, ev.data.pct); return; }
  jobs.delete(ev.data.id);
  if (ev.data.ok) j.resolve(ev.data); else j.reject(new Error(ev.data.error));
}
function onWorkerErr(e) { console.error('worker', e); rejectJobs(new Error(e.message || 'işçi hatası')); try { worker.terminate(); } catch (_) { /* geç */ } worker = null; }   // bir sonraki runWorker yeniden kurar (yükleme hatasında döngü olmasın)
function spawnWorker() {
  if (worker) { try { worker.terminate(); } catch (_) { /* geç */ } }
  worker = new Worker('./worker.js', { type: 'module' });
  worker.onmessage = onWorkerMsg; worker.onerror = onWorkerErr;
}
function rejectJobs(err) { const list = [...jobs.values()]; jobs.clear(); for (const j of list) j.reject(err); }
/** bekleyen işleri iptal eder ve işçiyi yeniden kurar; hata nesnesi cancelled bayrağı taşır (fail() sessiz geçer) */
function cancelJobs(reason) { if (!jobs.size && worker) return; rejectJobs(Object.assign(new Error(reason || tt('cancelled', 'İptal edildi')), { cancelled: true })); spawnWorker(); }
function runWorker(msg, onStage) {
  if (msg.cmd === 'parse' && jobs.size) cancelJobs(tt('loadCancelledPrev', 'Önceki yükleme iptal edildi'));   // yeni dosya eskisini beklemez
  if (!worker) spawnWorker();
  const mb = msg.bytes ? msg.bytes.byteLength / 1048576 : 0;
  const timeoutMs = Math.min(15 * 60000, Math.max(120000, 60000 + 10000 * mb));
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    const tm = setTimeout(() => { if (jobs.has(id)) { const err = new Error(tt('parseTimeout', 'Çözümleyici yanıt vermedi (zaman aşımı)')); jobs.delete(id); reject(err); rejectJobs(err); spawnWorker(); } }, timeoutMs);   // işçi sonlandırılır: aynı işçideki öteki işler de sonuçsuz kalmasın
    jobs.set(id, { resolve: (v) => { clearTimeout(tm); resolve(v); }, reject: (e) => { clearTimeout(tm); reject(e); }, onStage });
    worker.postMessage({ ...msg, id }, msg.bytes ? [msg.bytes] : []);
  });
}
spawnWorker();

// ---------------------------------------------------------------------------
// Tuval / çizim döngüsü
// ---------------------------------------------------------------------------
const cv = $('cv'), ov = $('ov'), vp = $('viewport');
const ctx = cv.getContext('2d', { alpha: false });
const octx = ov.getContext('2d');
const off = document.createElement('canvas');

function resize() {
  const r = vp.getBoundingClientRect();
  S.W = Math.max(1, Math.round(r.width)); S.H = Math.max(1, Math.round(r.height));
  S.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  for (const c of [cv, ov, off]) { c.width = Math.round(S.W * S.dpr); c.height = Math.round(S.H * S.dpr); }
  S.cacheValid = false;
  requestRender();
  editorResize();
}
new ResizeObserver(resize).observe(vp);
window.addEventListener('resize', resize);
setTileCallback(() => requestRender());

let renderQueued = false, fullTimer = 0;
function requestRender(fast) {
  if (fast && S.lastRenderMs > 40 && S.cacheValid) {
    presentCache();
    clearTimeout(fullTimer);
    fullTimer = setTimeout(() => render(), 140);
    return;
  }
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}
function render() {
  const t0 = performance.now();
  S.curLayerName = editor.curLayer || '0';
  drawFrame(ctx, cv);
  S.lastRenderMs = performance.now() - t0;
  if (S.hasDoc && S.lastRenderMs > 40) {
    const oc = off.getContext('2d');
    oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, off.width, off.height); oc.drawImage(cv, 0, 0);
    S.cacheValid = true; S.cacheView = { ...S.view };
  } else S.cacheValid = false;
  drawOverlay();
  updateStatus();
}
function presentCache() {
  const v0 = S.cacheView, v = S.view, kk = v.scale / v0.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = bgColor(); ctx.fillRect(0, 0, cv.width, cv.height);
  const dx = (cv.width / 2 + (v0.cx - v.cx) * v.scale * S.dpr) - kk * cv.width / 2;
  const dy = (cv.height / 2 - (v0.cy - v.cy) * v.scale * S.dpr) - kk * cv.height / 2;
  ctx.drawImage(off, dx, dy, off.width * kk, off.height * kk);
  drawOverlay();
  updateStatus();
}
function zoomExtents(bb) { fitView(bb || S.ext); viewHistory.push(); requestRender(); }

// ---- görünüm geçmişi / yakınlaştırma yardımcıları --------------------------------------------
const sameView = (a, b) => !!a && !!b && Math.abs(a.scale - b.scale) <= 1e-9 * Math.max(a.scale, b.scale) && Math.abs(a.cx - b.cx) <= 1e-9 * (Math.abs(a.cx) + 1) && Math.abs(a.cy - b.cy) <= 1e-9 * (Math.abs(a.cy) + 1) && (a.li == null || b.li == null || a.li === b.li);
/** görünüm %2'den fazla değişti mi (geçmişe yazma eşiği) */
function viewChanged(a, b) {
  if (!a || !b) return true;
  if (a.li != null && b.li != null && a.li !== b.li) return true;
  const k = Math.abs(Math.log(a.scale / b.scale));
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy) * b.scale / Math.max(1, Math.min(S.W, S.H));
  return k > 0.02 || d > 0.02;
}
let histNav = false;
const viewHistory = {
  push() {
    if (histNav || !S.hasDoc) return;
    const h = S.viewHist, cur = { ...S.view, li: S.layoutIndex };
    if (h.i >= 0 && sameView(h.stack[h.i], cur)) return;
    h.stack.length = h.i + 1; h.stack.push(cur);
    if (h.stack.length > 50) h.stack.shift();
    h.i = h.stack.length - 1;
    viewHistory.emit();
  },
  apply(v) {
    histNav = true;
    try { if (v.li != null && v.li !== S.layoutIndex && S.scene && S.scene.layouts[v.li]) setLayout(v.li); S.view = { scale: v.scale, cx: v.cx, cy: v.cy }; }
    finally { histNav = false; }
    S.gps.follow = false; requestRender(); viewHistory.emit();
  },
  back() { const h = S.viewHist; if (h.i <= 0) return false; h.i--; viewHistory.apply(h.stack[h.i]); return true; },
  forward() { const h = S.viewHist; if (h.i >= h.stack.length - 1) return false; h.i++; viewHistory.apply(h.stack[h.i]); return true; },
  canBack() { return S.viewHist.i > 0; },
  canForward() { return S.viewHist.i < S.viewHist.stack.length - 1; },
  reset() { S.viewHist = { stack: [], i: -1 }; viewHistory.emit(); },
  emit() { try { window.dispatchEvent(new CustomEvent('dwg:viewhist', { detail: { canBack: viewHistory.canBack(), canForward: viewHistory.canForward() } })); } catch (_) { /* yok */ } },
};
/** merkezde (ya da GPS izlenirken konumda / verilen ekran noktasında) f kat yakınlaştırır */
function zoomBy(f, at) {
  if (!S.hasDoc || !(f > 0)) return;
  let sx = S.W / 2, sy = S.H / 2;
  if (at) { sx = at[0]; sy = at[1]; }
  else if (S.gps.follow && S.gps.lat != null && S.geo.active) { const d = S.geo.toDrawing(S.gps.lon, S.gps.lat); if (d) [sx, sy] = toScreen(d[0], d[1]); }
  zoomAtScreen(sx, sy, f);
  viewHistory.push(); requestRender();
}
/** ilkel listesine sığdırır; boşsa false */
function fitPrims(prims) {
  const list = prims ? [...prims] : [];
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of list) { const b = p && p.bb; if (!b) continue; if (b[0] < bb[0]) bb[0] = b[0]; if (b[1] < bb[1]) bb[1] = b[1]; if (b[2] > bb[2]) bb[2] = b[2]; if (b[3] > bb[3]) bb[3] = b[3]; }
  if (!isFinite(bb[0])) return false;
  const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.3 || 1;
  zoomExtents([bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m]);
  return true;
}
let zoomWin = null; // { pending:true } | { x0,y0,x1,y1 } (ekran px)
function zoomWindow() {
  if (!S.hasDoc) { toast(t('openFirst')); return; }
  if (editor.is3D()) { toast(tt('zoomWin3d', 'Pencere yakınlaştırma 2B görünümde çalışır.')); return; }
  if (editor.tools && editor.tools.running) { toast(tt('toolBusy', 'Önce çalışan aracı bitirin.')); return; }
  zoomWin = { pending: true };
  const bar = $('cmdBar'); bar.hidden = false; $('cmdText').textContent = tt('zoomWinHint', 'Pencere: köşeleri sürükleyin'); $('cmdInput').hidden = true;
  $('cmdBtns').innerHTML = `<button data-zw="cancel">✕ ${t('cancel')}</button>`;
  $('cmdBtns').onclick = (ev) => { if (ev.target.closest('[data-zw]')) cancelZoomWindow(); };
}
function cancelZoomWindow() {
  if (!zoomWin) return false;
  zoomWin = null;
  const bar = $('cmdBar'); if ($('cmdBtns').onclick) { $('cmdBtns').onclick = null; }
  if (!(editor.tools && editor.tools.running) && !editor.m3) bar.hidden = true;
  drawOverlay();
  return true;
}

// ---- kaplama -------------------------------------------------------------------
let noteDraft = null, selectedNote = null;
const photos = new Map(); // photo id → {img, ok}

/** Kaplama için dünya dönüşümü: render.js ile aynı köken (görünüm merkezi); tracePath yerel koordinat üretir */
function worldTransform(c) { renderWorldTransform(c, ov); }
/** Dünya kutusunu yerel koordinatla çizer (bb: [x0, y0, x1, y1]) */
function strokeWorldRect(c, bb) { const [ox, oy] = worldOrigin(); c.strokeRect(bb[0] - ox, bb[1] - oy, bb[2] - bb[0], bb[3] - bb[1]); }
function drawOverlay() {
  const c = octx;
  c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  c.clearRect(0, 0, S.W, S.H);
  if (!S.hasDoc) return;
  if (editor.is3D()) { if (typeof editor.overlay3D === 'function') editor.overlay3D(); return; }   // 3B HUD / pusula silinmesin
  const acc = S.selColor || '#ff9f0a', fg = fgColor();
  editorOverlay(c);
  if (S.selected) {
    const p = S.selected;
    c.save(); worldTransform(c);
    c.strokeStyle = acc; c.lineWidth = (S.selWidth || 3) / S.view.scale; c.globalAlpha = 0.9; c.setLineDash([]);
    if (p.k === 0) { c.beginPath(); tracePath(c, p.ops); if (p.closed) c.closePath(); c.stroke(); }
    else strokeWorldRect(c, p.bb);
    c.restore(); c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  }
  if (notes.items.length || noteDraft) drawNotes(c, toScreen, S.view.scale, selectedNote && selectedNote.id, noteDraft, photos);
  if (S.mode === 'measure' || S.mode === 'profile') {
    const pts = S.measure.map(p => toScreen(p[0], p[1]));
    c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = 2; c.setLineDash([]);
    if (pts.length > 1) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.stroke(); }
    c.font = 'bold 12px sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left';
    for (let i = 0; i < pts.length; i++) {
      c.fillStyle = acc; c.beginPath(); c.arc(pts[i][0], pts[i][1], 5, 0, TAU); c.fill();
      c.fillStyle = S.dark ? '#fff' : '#111'; c.fillText(String(i + 1), pts[i][0] + 7, pts[i][1] - 6);
      if (i > 0) {
        const mx = (pts[i][0] + pts[i - 1][0]) / 2, my = (pts[i][1] + pts[i - 1][1]) / 2;
        const d = Math.hypot(S.measure[i][0] - S.measure[i - 1][0], S.measure[i][1] - S.measure[i - 1][1]);
        label(c, fmtUnit(d), mx, my);
      }
    }
    if (S.snap) {
      const s = toScreen(S.snap.p[0], S.snap.p[1]), k = S.snap.kind;
      c.strokeStyle = '#3ddc84'; c.lineWidth = 2;
      if (k === 'end' || k === 'node') c.strokeRect(s[0] - 7, s[1] - 7, 14, 14);
      else if (k === 'mid') { c.beginPath(); c.moveTo(s[0], s[1] - 8); c.lineTo(s[0] + 8, s[1] + 6); c.lineTo(s[0] - 8, s[1] + 6); c.closePath(); c.stroke(); }
      else if (k === 'cen' || k === 'ins') { c.beginPath(); c.arc(s[0], s[1], 7, 0, TAU); c.stroke(); }
      else { c.beginPath(); c.moveTo(s[0] - 7, s[1] - 7); c.lineTo(s[0] + 7, s[1] + 7); c.moveTo(s[0] + 7, s[1] - 7); c.lineTo(s[0] - 7, s[1] + 7); c.stroke(); }
      c.font = '10px sans-serif'; c.fillStyle = '#3ddc84'; c.fillText(k.toUpperCase(), s[0] + 10, s[1] - 10);
    }
  }
  if (S.gps.on && S.gps.lat != null && S.geo.active && S.scene.layouts[S.layoutIndex].isModel) {
    const d = S.geo.toDrawing(S.gps.lon, S.gps.lat);
    if (d) {
      const s = toScreen(d[0], d[1]);
      const rPx = Math.max(6, (S.gps.acc / S.geo.unitToM) * S.view.scale);
      c.fillStyle = 'rgba(66,133,244,.18)'; c.strokeStyle = 'rgba(66,133,244,.6)'; c.lineWidth = 1;
      c.beginPath(); c.arc(s[0], s[1], Math.min(rPx, 4000), 0, TAU); c.fill(); c.stroke();
      if (S.gps.heading != null) {
        const a = -S.gps.heading * Math.PI / 180 + Math.PI / 2;
        c.fillStyle = 'rgba(66,133,244,.5)'; c.beginPath(); c.moveTo(s[0], s[1]); c.arc(s[0], s[1], 26, -a - 0.4, -a + 0.4); c.closePath(); c.fill();
      }
      c.fillStyle = '#4285f4'; c.strokeStyle = '#fff'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(s[0], s[1], 8, 0, TAU); c.fill(); c.stroke();
    }
  }
  if (S.gotoMarker) {
    const s = toScreen(S.gotoMarker[0], S.gotoMarker[1]);
    c.strokeStyle = '#f5b342'; c.fillStyle = '#f5b342'; c.lineWidth = 2.5; c.setLineDash([]);
    c.beginPath(); c.moveTo(s[0], s[1]); c.lineTo(s[0] - 9, s[1] - 22); c.arc(s[0], s[1] - 24, 9, Math.PI * 0.85, Math.PI * 2.15); c.closePath(); c.fill();
    c.fillStyle = S.dark ? '#1c2129' : '#fff'; c.beginPath(); c.arc(s[0], s[1] - 24, 3.5, 0, TAU); c.fill();
  }
  if (zoomWin && zoomWin.x1 != null) {
    c.strokeStyle = '#f5b342'; c.lineWidth = 1.5; c.setLineDash([6, 4]); c.fillStyle = 'rgba(245,179,66,.12)';
    const x = Math.min(zoomWin.x0, zoomWin.x1), y = Math.min(zoomWin.y0, zoomWin.y1), w = Math.abs(zoomWin.x1 - zoomWin.x0), h = Math.abs(zoomWin.y1 - zoomWin.y0);
    c.fillRect(x, y, w, h); c.strokeRect(x, y, w, h); c.setLineDash([]);
  }
  drawCrosshair(c, fg);
  if (S.ui2d.scaleBar) drawScaleBar(c, fg);
  if (S.ui2d.north) drawNorth(c, fg);
  if (S.rulers) drawRulers(c, fg);
  const attr = basemapAttribution();
  if (attr && S.geo.active && S.basemap.id !== 'none') { c.font = '10px sans-serif'; c.fillStyle = fg; c.globalAlpha = 0.7; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(attr, S.W - 6, S.H - 4); c.globalAlpha = 1; c.textAlign = 'left'; }
}
function drawScaleBar(c, fg) {
  const unitM = S.unitToM || 0;
  const targetPx = Math.min(140, S.W * 0.3);
  const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; };
  const len = nice(targetPx / S.view.scale);
  const px = len * S.view.scale;
  const x0 = uiPrefs().leftHand ? S.W - 12 - px : 12, y0 = S.H - 14;
  c.fillStyle = S.dark ? 'rgba(20,26,34,.7)' : 'rgba(255,255,255,.75)'; c.fillRect(x0 - 6, y0 - 18, px + 12, 24);
  c.strokeStyle = fg; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + px, y0); c.moveTo(x0, y0 - 6); c.lineTo(x0, y0); c.moveTo(x0 + px, y0 - 6); c.lineTo(x0 + px, y0); c.stroke();
  let txt;
  if (unitM) { const m = len * unitM; txt = m >= 1000 ? fmt(m / 1000, 2) + ' km' : m >= 1 ? fmt(m, 2) + ' m' : fmt(m * 100, 2) + ' cm'; }
  else txt = fmt(len) + (S.units ? ' ' + S.units : '');
  c.font = '11px sans-serif'; c.fillStyle = fg; c.textBaseline = 'bottom'; c.textAlign = 'left'; c.fillText(txt, x0 + 4, y0 - 3);
}
function drawNorth(c, fg) {
  const big = S.ui2d.northBig ? 44 / 28 : 1;
  c.save(); c.translate(S.W - 26 * big, 30 * big + (S.rulers ? 18 : 0)); c.scale(big, big);
  if (S.geo.swap) c.rotate(-Math.PI / 2);
  c.fillStyle = S.dark ? 'rgba(20,26,34,.7)' : 'rgba(255,255,255,.75)'; c.beginPath(); c.arc(0, 0, 18, 0, TAU); c.fill();
  c.fillStyle = '#ff453a'; c.beginPath(); c.moveTo(0, -14); c.lineTo(5, 2); c.lineTo(0, -1); c.lineTo(-5, 2); c.closePath(); c.fill();
  c.fillStyle = fg; c.beginPath(); c.moveTo(0, 14); c.lineTo(5, -2); c.lineTo(0, 1); c.lineTo(-5, -2); c.closePath(); c.fill();
  c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('K', 0, -9);
  c.restore();
}
/** 18 px üst/sol cetvel şeritleri (tabular rakam, son dokunma noktasında işaret) */
function drawRulers(c, fg) {
  const H = 18, sc = S.view.scale;
  const r = visibleRect();
  let step = niceStep((r[2] - r[0]) / 8); while (step * sc < 60) step *= 2;
  c.fillStyle = S.dark ? 'rgba(20,26,34,.82)' : 'rgba(255,255,255,.85)';
  c.fillRect(0, 0, S.W, H); c.fillRect(0, 0, H, S.H);
  c.strokeStyle = fg; c.fillStyle = fg; c.lineWidth = 1; c.globalAlpha = 0.85;
  c.font = '9px system-ui, sans-serif'; c.textBaseline = 'top'; c.textAlign = 'left';
  c.beginPath();
  const ix0 = Math.floor(r[0] / step), ix1 = Math.ceil(r[2] / step);
  for (let i = ix0; i <= ix1; i++) { const x = Math.round(toScreen(i * step, 0)[0]) + 0.5; if (x < H) continue; c.moveTo(x, H); c.lineTo(x, H - 7); const sub = step / 5 * sc; if (sub > 6) for (let j = 1; j < 5; j++) { c.moveTo(x + j * sub, H); c.lineTo(x + j * sub, H - 3); } c.fillText(fmt(i * step, 0), x + 2, 2); }
  const iy0 = Math.floor(r[1] / step), iy1 = Math.ceil(r[3] / step);
  for (let i = iy0; i <= iy1; i++) { const y = Math.round(toScreen(0, i * step)[1]) + 0.5; if (y < H) continue; c.moveTo(H, y); c.lineTo(H - 7, y); const sub = step / 5 * sc; if (sub > 6) for (let j = 1; j < 5; j++) { c.moveTo(H, y - j * sub); c.lineTo(H - 3, y - j * sub); } c.save(); c.translate(2, y - 2); c.rotate(-Math.PI / 2); c.fillText(fmt(i * step, 0), 0, 0); c.restore(); }
  c.moveTo(0, H + 0.5); c.lineTo(S.W, H + 0.5); c.moveTo(H + 0.5, 0); c.lineTo(H + 0.5, S.H);
  c.stroke();
  if (S.lastPoint) { const s = toScreen(S.lastPoint[0], S.lastPoint[1]); c.fillStyle = '#f5b342'; c.fillRect(s[0] - 1, 0, 2, H); c.fillRect(0, s[1] - 1, H, 2); }
  c.globalAlpha = 1;
}
/** Artı imleç: araç ya da ölçü modu çalışırken son dokunma/yakalama noktasında */
function drawCrosshair(c, fg) {
  if (S.crosshair === 'off' || !S.lastPoint) return;
  const running = (editor.tools && editor.tools.running) || S.mode === 'measure' || S.mode === 'profile';
  if (!running) return;
  const s = toScreen(S.lastPoint[0], S.lastPoint[1]);
  c.strokeStyle = fg; c.lineWidth = 1; c.setLineDash([]); c.globalAlpha = 0.5;
  c.beginPath();
  if (S.crosshair === 'full') { c.moveTo(0, s[1] + 0.5); c.lineTo(S.W, s[1] + 0.5); c.moveTo(s[0] + 0.5, 0); c.lineTo(s[0] + 0.5, S.H); }
  else { c.moveTo(s[0] - 12, s[1] + 0.5); c.lineTo(s[0] + 12, s[1] + 0.5); c.moveTo(s[0] + 0.5, s[1] - 12); c.lineTo(s[0] + 0.5, s[1] + 12); }
  c.stroke(); c.globalAlpha = 1;
  if (S.crosshair === 'full') { c.font = '11px system-ui, sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left'; const txt = fmt(S.lastPoint[0]) + ' ; ' + fmt(S.lastPoint[1]); const w = c.measureText(txt).width + 8; c.fillStyle = S.dark ? 'rgba(20,26,34,.85)' : 'rgba(255,255,255,.85)'; c.fillRect(s[0] + 8, s[1] - 22, w, 18); c.fillStyle = fg; c.fillText(txt, s[0] + 12, s[1] - 6); }
}
function label(c, text, x, y) {
  c.font = 'bold 12px sans-serif';
  const w = c.measureText(text).width + 10;
  c.fillStyle = 'rgba(20,26,34,.85)'; c.fillRect(x - w / 2, y - 18, w, 18);
  c.fillStyle = '#f5b342'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y - 9);
  c.textAlign = 'left'; c.textBaseline = 'bottom';
}
let lastCoord = null;
const SCALE_K = 3779.53; // px / m (96 dpi)
const scaleN = () => S.unitToM > 0 ? SCALE_K * S.unitToM / S.view.scale : 0;
function updateStatus(sx, sy) {
  const sg = $('stGrid');
  if (!S.hasDoc) { $('stScale').textContent = ''; if (sg) sg.hidden = true; return; }
  $('stScale').textContent = S.unitToM > 0 ? '1:' + fmt(scaleN(), 0) : '1 px = ' + fmtUnit(1 / S.view.scale);
  if (sg) { sg.hidden = !S.grid.on; if (S.grid.on) sg.textContent = gridLabel(gridState.step) || tt('stGrid', 'Izgara'); }
  if (sx != null && S.ui2d.coordInfo) {
    const w = toWorld(sx, sy);
    lastCoord = w;
    let s = 'X: ' + fmt(w[0]) + '  Y: ' + fmt(w[1]);
    if (S.geo.active) { const ll = S.geo.toLonLat(w[0], w[1]); if (ll) s += '  φ ' + ll[1].toFixed(6) + ' λ ' + ll[0].toFixed(6); }
    $('stCoord').textContent = s;
  }
}
function ensureStatusChips() {
  const bar = $('statusbar'); if (!bar) return;
  const mk = (id, cls) => { let el = $(id); if (!el) { el = document.createElement('span'); el.id = id; el.className = cls; el.hidden = true; const after = $('stScale'); if (after && after.parentElement === bar) after.insertAdjacentElement('afterend', el); else bar.appendChild(el); } return el; };
  mk('stSnap', 'st-chip'); mk('stGrid', 'st-chip');
}
let snapChipTimer = 0;
function showSnapChip(kind) {
  const el = $('stSnap'); if (!el) return;
  if (!kind) { el.hidden = true; return; }
  el.textContent = kind.toUpperCase(); el.hidden = false;
  clearTimeout(snapChipTimer); snapChipTimer = setTimeout(() => { el.hidden = true; }, 1500);
}
/** Ölçek seçici: 1:100 … 1:25000 + gerçek boyut */
function showScalePicker() {
  if (!S.hasDoc) return;
  if (!(S.unitToM > 0)) { toast(tt('scaleNeedUnit', 'Ölçek için çizim birimi gerekli (Ayarlar › Çizim birimi).')); return; }
  const list = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000];
  const cur = Math.round(scaleN());
  const html = `<div class="full"><div class="chips">${list.map(n => `<button type="button" class="chip ${cur === n ? 'on' : ''}" data-scale="${n}">1:${fmt(n, 0)}</button>`).join('')}<button type="button" class="chip" data-scale="1">${tt('scaleReal', 'Gerçek boyut 1:1')}</button></div></div><div class="full muted">${tt('scaleNow', 'Şu an')}: 1:${fmt(cur, 0)}</div>`;
  openDoc(tt('scalePick', 'Ölçek'), html);
  $('docBody').onclick = (ev) => {
    const b = ev.target.closest('[data-scale]'); if (!b) return;
    const n = Number(b.dataset.scale); if (!(n > 0)) return;
    S.view.scale = SCALE_K * S.unitToM / n; viewHistory.push(); requestRender(); hide('docPanel');
  };
}

// ---------------------------------------------------------------------------
// Etkileşim
// ---------------------------------------------------------------------------
const pointers = new Map();
let gesture = null, lastTap = 0, lastTapPos = null, longTimer = 0;
const rel = (ev) => { const r = vp.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
// eldiven toleransları (ui.glove; dwg:ui olayında yeniden okunur)
const TOL = { pick: 12, snap: 18, drag: 6, dbl: 320, long: 500 };
function readTolerances() { const g = glove(); TOL.pick = g ? 20 : 12; TOL.snap = g ? 28 : 18; TOL.drag = g ? 10 : 6; TOL.dbl = g ? 450 : 320; TOL.long = g ? 600 : 500; S.glove = g; }
window.addEventListener('dwg:ui', () => { readTolerances(); S.cacheValid = false; requestRender(); });
readTolerances();
const gestureStart = () => { if (!S.gestureActive) { S.gestureActive = true; } };
const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = 0; } };

vp.addEventListener('pointerdown', (ev) => {
  if (!S.hasDoc) return;
  if (ev.target.closest && ev.target.closest('.notesbar, .fab, .empty, .cmdbar, .hud, .docview')) return; // görüntü alanı içindeki düğmeler
  vp.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) gestureView0 = { ...S.view, li: S.layoutIndex };
  closeMenu(); clearLong();
  const arr = [...pointers.values()];
  if (arr.length === 1) {
    const [sx, sy] = rel(ev);
    if (S.notesOn && S.noteTool !== 'select' && S.noteTool !== 'text' && S.noteTool !== 'photo') {
      const w = toWorld(sx, sy);
      noteDraft = { type: S.noteTool, pts: [w, w], color: S.noteColor, width: 2 };
      gesture = { type: 'note' };
      return;
    }
    if (zoomWin && zoomWin.pending) { zoomWin = { x0: sx, y0: sy, x1: null, y1: null }; gesture = { type: 'zoomwin', x0: sx, y0: sy }; S.gestureActive = true; return; }
    const now = performance.now();
    if (lastTapPos && now - lastTap < TOL.dbl && Math.hypot(lastTapPos[0] - sx, lastTapPos[1] - sy) < 30 && !S.notesOn) {
      // çift-dokun-ve-sürükle: ikinci dokunuş basılı kalırsa dikey sürükleme yakınlaştırır; bırakılırsa 2×
      gesture = { type: 'dtap', sx, sy, y0: ev.clientY, view: { ...S.view }, moved: false };
      lastTap = 0;
    } else {
      gesture = { type: 'pan', x0: ev.clientX, y0: ev.clientY, view: { ...S.view }, moved: false, t0: now };
      const canLong = !(editor.tools && editor.tools.running) && S.mode === 'view' && !S.notesOn && !editor.is3D();
      if (canLong) longTimer = setTimeout(() => { longTimer = 0; if (gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 1) { gesture.longFired = true; haptic('long'); longPressMenu(sx, sy); } }, TOL.long);
    }
  } else if (arr.length === 2) {
    noteDraft = null; clearLong();
    const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    const r = vp.getBoundingClientRect();
    gesture = { type: 'pinch', d0: d, mid0: [(arr[0].x + arr[1].x) / 2 - r.left, (arr[0].y + arr[1].y) / 2 - r.top], view: { ...S.view }, moved: true, t0: performance.now(), start: arr.map(p => ({ x: p.x, y: p.y })), maxMove: 0 };
  }
  S.gestureActive = true;
});
vp.addEventListener('pointermove', (ev) => {
  const [sx, sy] = rel(ev);
  if (!pointers.has(ev.pointerId)) { if (S.hasDoc && ev.pointerType === 'mouse') updateStatus(sx, sy); return; }
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (!gesture) return;
  if (gesture.type === 'note' && noteDraft) {
    const w = toWorld(sx, sy);
    if (noteDraft.type === 'pen') noteDraft.pts.push(w); else noteDraft.pts[1] = w;
    drawOverlay();
  } else if (gesture.type === 'zoomwin') {
    zoomWin.x1 = sx; zoomWin.y1 = sy; drawOverlay();
  } else if (gesture.type === 'dtap') {
    const dy = ev.clientY - gesture.y0;
    if (!gesture.moved && Math.abs(dy) < TOL.drag) return;
    gesture.moved = true;
    const f = Math.pow(2, -dy / 100); // yukarı 100 px = 2×, aşağı 100 px = 0,5×
    S.view.scale = gesture.view.scale; S.view.cx = gesture.view.cx; S.view.cy = gesture.view.cy;
    zoomAtScreen(gesture.sx, gesture.sy, f);
    requestRender(true);
  } else if (gesture.type === 'pan') {
    const dx = ev.clientX - gesture.x0, dy = ev.clientY - gesture.y0;
    if (!gesture.moved && Math.hypot(dx, dy) < TOL.drag) return;
    if (gesture.longFired) return;
    gesture.moved = true; clearLong();
    S.view.cx = gesture.view.cx - dx / S.view.scale;
    S.view.cy = gesture.view.cy + dy / S.view.scale;
    S.gps.follow = false;
    requestRender(true);
  } else if (gesture.type === 'pinch' && pointers.size >= 2) {
    const arr = [...pointers.values()];
    if (gesture.start) for (let i = 0; i < 2 && i < arr.length; i++) { const m = Math.hypot(arr[i].x - gesture.start[i].x, arr[i].y - gesture.start[i].y); if (m > gesture.maxMove) gesture.maxMove = m; }
    const r = vp.getBoundingClientRect();
    const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    const mid = [(arr[0].x + arr[1].x) / 2 - r.left, (arr[0].y + arr[1].y) / 2 - r.top];
    const v0 = gesture.view;
    const ns = Math.max(1e-9, Math.min(1e9, v0.scale * d / Math.max(1, gesture.d0)));
    const wx = v0.cx + (gesture.mid0[0] - S.W / 2) / v0.scale, wy = v0.cy - (gesture.mid0[1] - S.H / 2) / v0.scale;
    S.view.scale = ns;
    S.view.cx = wx - (mid[0] - S.W / 2) / ns;
    S.view.cy = wy + (mid[1] - S.H / 2) / ns;
    requestRender(true);
  }
});
let gestureView0 = null; // jest başındaki görünüm (geçmiş için)
function endPointer(ev) {
  const had = pointers.delete(ev.pointerId);
  if (!had) return;
  const [sx, sy] = rel(ev);
  clearLong();
  if (gesture && gesture.type === 'note') {
    if (noteDraft && ev.type === 'pointerup') {
      const a = toScreen(noteDraft.pts[0][0], noteDraft.pts[0][1]), b = toScreen(noteDraft.pts[noteDraft.pts.length - 1][0], noteDraft.pts[noteDraft.pts.length - 1][1]);
      if (noteDraft.type === 'pen' ? noteDraft.pts.length > 2 : Math.hypot(a[0] - b[0], a[1] - b[1]) > 4) addNote(noteDraft);
    }
    noteDraft = null; gesture = null; S.gestureActive = false; drawOverlay(); return;
  }
  if (gesture && gesture.type === 'zoomwin') {
    const zw = zoomWin; gesture = null; S.gestureActive = false;
    cancelZoomWindow();
    if (ev.type === 'pointerup' && zw) {
      const w = Math.abs(sx - zw.x0), h = Math.abs(sy - zw.y0);
      if (w > 20 && h > 20) { const a = toWorld(Math.min(sx, zw.x0), Math.max(sy, zw.y0)), b = toWorld(Math.max(sx, zw.x0), Math.min(sy, zw.y0)); fitView([a[0], a[1], b[0], b[1]], 1); }
      else zoomAtScreen(sx, sy, 2);
      viewHistory.push(); haptic('step');
    }
    requestRender(); return;
  }
  if (gesture && gesture.type === 'dtap' && pointers.size === 0 && ev.type === 'pointerup') {
    if (!gesture.moved) { zoomAtScreen(gesture.sx, gesture.sy, 2); }
    lastTap = 0; lastTapPos = null;
  } else if (gesture && gesture.type === 'pan' && !gesture.moved && !gesture.longFired && pointers.size === 0 && ev.type === 'pointerup') {
    if (gesture.twoTap && performance.now() - gesture.twoTap.t < 250) { zoomAtScreen(gesture.twoTap.mid[0], gesture.twoTap.mid[1], 0.5); lastTap = 0; }
    else if (!gesture.fromPinch) { lastTap = performance.now(); lastTapPos = [sx, sy]; onTap(sx, sy); }
  }
  if (pointers.size === 0) {
    gesture = null; S.gestureActive = false; clearTimeout(fullTimer);
    if (viewChanged(gestureView0, { ...S.view, li: S.layoutIndex })) viewHistory.push();
    gestureView0 = null;
    requestRender();
  } else if (pointers.size === 1) {
    const p = [...pointers.values()][0];
    const wasPinchTap = gesture && gesture.type === 'pinch' && gesture.maxMove < 8 && performance.now() - gesture.t0 < 250;
    gesture = { type: 'pan', x0: p.x, y0: p.y, view: { ...S.view }, moved: false, fromPinch: true, twoTap: wasPinchTap ? { mid: [(p.x + ev.clientX) / 2 - vp.getBoundingClientRect().left, (p.y + ev.clientY) / 2 - vp.getBoundingClientRect().top], t: gesture.t0 } : null };
  }
}
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);
vp.addEventListener('wheel', (ev) => {
  if (!S.hasDoc) return; ev.preventDefault();
  const [x, y] = rel(ev);
  if (ev.shiftKey && ev.deltaY) { S.view.cx += (ev.deltaY > 0 ? 1 : -1) * S.W * 0.1 / S.view.scale; requestRender(true); return; }
  zoomAtScreen(x, y, ev.deltaY < 0 ? 1.2 : 1 / 1.2); requestRender();
  clearTimeout(wheelTimer); wheelTimer = setTimeout(() => viewHistory.push(), 400);
}, { passive: false });
let wheelTimer = 0;

/** Boş tuvale ya da nesneye uzun basış bağlam listesi */
function longPressMenu(sx, sy) {
  const w = toWorld(sx, sy);
  const hit = pick(w, TOL.pick / S.view.scale);
  S.lastPoint = [w[0], w[1]];
  const coordTxt = fmt(w[0]) + ';' + fmt(w[1]);
  const items = hit ? [['info', tt('info', 'Bilgi')], ['zoom', t('zoomTo')], ['select', tt('selectObj', 'Seç')], ['iso', tt('isolate', 'Katmanı izole et')], ['hide', tt('hideLayer', 'Katmanı gizle')], ['copy', t('copyCoord')]]
    : [['copy', t('copyCoord')], ['measure', tt('measureFrom', 'Buradan ölç')], ['note', tt('noteHere', 'Buraya not')], ['goto', tt('gotoCoord', 'Koordinata git')]];
  const title = hit ? trType(hit.info ? hit.info.t : hit.et) + ' · ' + hit.lay : 'X ' + fmt(w[0]) + '  Y ' + fmt(w[1]);
  openDoc(title, `<div class="full list ctx-list">${items.map(i => `<div class="item" data-ctx="${i[0]}">${esc(i[1])}</div>`).join('')}</div>`);
  $('docBody').onclick = (ev) => {
    const it = ev.target.closest('[data-ctx]'); if (!it) return;
    hide('docPanel');
    switch (it.dataset.ctx) {
      case 'info': S.selected = hit; drawOverlay(); showInfo(hit); break;
      case 'zoom': S.selected = hit; fitPrims([hit]); break;
      case 'select': if (edCall('select', hit) === undefined) { S.selected = hit; drawOverlay(); } break;
      case 'iso': isolateLayers([hit.lay]); break;
      case 'hide': { const L = S.layers.get(hit.lay); if (L) { L.visible = false; S.cacheValid = false; buildLayerList(); requestRender(); toast(t('layer') + ' ' + hit.lay + ': ' + tt('hidden', 'gizlendi'), { action: { label: tt('undoAction', 'Geri al'), fn: () => { L.visible = true; S.cacheValid = false; buildLayerList(); requestRender(); } } }); } break; }
      case 'copy': copyText(coordTxt); break;
      case 'measure': setMode('measure'); S.measure.push([w[0], w[1], undefined]); updateMeasure(); drawOverlay(); break;
      case 'note': toggleNotes(true); S.noteTool = 'text'; document.querySelectorAll('#notesBar [data-tool]').forEach(x => x.classList.toggle('active', x.dataset.tool === 'text')); void noteTap(sx, sy, w); break;
      case 'goto': gotoCoord(); break;
      default: break;
    }
  };
}

function candidates(w, tol) {
  const out = [];
  if (S.tree) S.tree.search(w[0] - tol, w[1] - tol, w[0] + tol, w[1] + tol, i => out.push(S.prims[i]));
  else for (const p of S.prims) if (!(w[0] < p.bb[0] - tol || w[0] > p.bb[2] + tol || w[1] < p.bb[1] - tol || w[1] > p.bb[3] + tol)) out.push(p);
  return out.filter(p => primVisible(p) && !(S.layers.get(p.lay) && S.layers.get(p.lay).locked));
}
function pick(w, tol) {
  let best = null, bd = tol;
  for (const p of candidates(w, tol)) {
    if (p.k === 4) continue;
    const d = primDist(p, w);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function doSnap(w) {
  const tol = TOL.snap / S.view.scale;
  const prev = S.measure.length ? S.measure[S.measure.length - 1] : null;
  const sn = snapPoint(candidates(w, tol), w, tol, S.snapModes, prev);
  if (sn) { S.lastPoint = [sn.p[0], sn.p[1]]; showSnapChip(sn.kind); haptic('snap'); }
  else S.lastPoint = [w[0], w[1]];
  return sn;
}

async function onTap(sx, sy) {
  updateStatus(sx, sy);
  const w = toWorld(sx, sy);
  S.lastPoint = [w[0], w[1]];
  if (editorTap(w, sx, sy)) return;
  if (S.notesOn) { await noteTap(sx, sy, w); return; }
  if (S.mode === 'measure' || S.mode === 'profile') {
    const sn = doSnap(w);
    const p = sn ? sn.p.slice() : [w[0], w[1], undefined];
    if (S.mode === 'profile') {
      if (p[2] == null || !isFinite(p[2]) || p[2] === 0) {
        const v = await askText(`${S.measure.length + 1}. ${t('enterElev')} (m):`, '', { type: 'number' });
        if (v === null) return;
        p[2] = parseFloat(String(v).replace(',', '.'));
        if (!isFinite(p[2])) return;
        p.manual = true;
      } else p[2] = p[2] * (S.unitToM || 1);
    }
    S.measure.push(p);
    S.snap = sn;
    updateMeasure();
    drawOverlay();
    return;
  }
  const hit = pick(w, TOL.pick / S.view.scale);
  S.selected = hit;
  drawOverlay();
  if (hit) showInfo(hit); else hide('infoPanel');
}

// ---------------------------------------------------------------------------
// Paneller
// ---------------------------------------------------------------------------
function show(id) { const el = $(id); if (el) el.hidden = false; }
function hide(id) { const el = $(id); if (!el) return; if (id === 'displayPanel') closeDisplayOptions(); else el.hidden = true; }
const PANELS = ['layerPanel', 'infoPanel', 'measurePanel', 'docPanel', 'searchPanel', 'displayPanel', 'drivePanel'];
function openPanels() { return PANELS.filter(id => { const el = $(id); return el && !el.hidden; }); }
function closeMenu() { hide('moreMenu'); }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => hide(b.dataset.close)));
let toastTimer = 0;
/** toast(msg, opts): opts sayı ise ms; nesne ise { ms, type:'info'|'ok'|'warn'|'error', action:{label, fn} } */
function toast(msg, opts) {
  const el = $('toast');
  let tx = el.querySelector('.tx'), act = el.querySelector('.act');
  if (!tx) { el.textContent = ''; tx = document.createElement('span'); tx.className = 'tx'; el.appendChild(tx); }
  if (!act) { act = document.createElement('button'); act.className = 'act'; act.type = 'button'; act.hidden = true; el.appendChild(act); }
  el.setAttribute('aria-live', 'polite');
  const o = typeof opts === 'number' ? { ms: opts } : (opts || {});
  const type = ['ok', 'warn', 'error'].includes(o.type) ? o.type : '';
  el.className = 'toast hud' + (type ? ' ' + type : '');   // hud: görüntü alanı hareket işleyicisi dokunuşu yakalamasın
  tx.textContent = msg;
  if (o.action && typeof o.action.fn === 'function') { act.hidden = false; act.textContent = o.action.label || tt('undoAction', 'Geri al'); act.onclick = (ev) => { ev.stopPropagation(); el.hidden = true; clearTimeout(toastTimer); try { o.action.fn(); } catch (e) { console.warn(e); } }; }
  else { act.hidden = true; act.onclick = null; }
  el.hidden = false;
  const ms = o.ms || (type === 'error' ? 6000 : o.action ? 5000 : 2800);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
/** [k, v] → satır; [html] → tam satır; [k, html, 1] → ham html değer */
function kv(pairs) {
  return pairs.filter(p => p && (p.length === 1 || (p[1] !== null && p[1] !== undefined && p[1] !== ''))).map(p => p.length === 1
    ? `<div class="full">${p[0]}</div>`
    : `<div class="k">${esc(p[0])}</div><div class="v">${p[2] ? p[1] : esc(String(p[1]))}</div>`).join('');
}
function openDoc(title, html) { $('docTitle').textContent = title; $('docBody').innerHTML = html; $('docBody').onclick = null; show('docPanel'); }
function copyText(text) {
  if (A() && A().copy) A().copy(text);
  else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  toast(t('copied'));
}
$('stCoord').addEventListener('click', () => { if (lastCoord) copyText(fmt(lastCoord[0]) + ';' + fmt(lastCoord[1])); });

// ---- nesne bilgisi ---------------------------------------------------------------
const TYPE_TR = { LINE: 'Çizgi', LWPOLYLINE: 'Polyline', POLYLINE2D: 'Polyline (2B)', POLYLINE3D: 'Polyline (3B)', POLYFACE: 'Çok yüzlü ağ', CIRCLE: 'Daire', ARC: 'Yay',
  ELLIPSE: 'Elips', SPLINE: 'Spline', TEXT: 'Yazı', MTEXT: 'Çok satırlı yazı', INSERT: 'Blok', HATCH: 'Tarama', DIMENSION: 'Ölçü',
  POINT: 'Nokta', SOLID: 'Dolgu', '3DFACE': '3B yüzey', LEADER: 'Kılavuz çizgi', MULTILEADER: 'Çoklu kılavuz', MLINE: 'Çoklu çizgi',
  XLINE: 'Sonsuz çizgi', RAY: 'Işın', ATTRIB: 'Öznitelik', ATTDEF: 'Öznitelik tanımı', WIPEOUT: 'Maske', IMAGE: 'Resim', ACAD_TABLE: 'Tablo',
  TOLERANCE: 'Tolerans', '3DSOLID': '3B katı', REGION: 'Bölge', VIEWPORT: 'Görünüm penceresi', TRACE: 'İz' };
const TYPE_EN = { LINE: 'Line', LWPOLYLINE: 'Polyline', POLYLINE2D: 'Polyline (2D)', POLYLINE3D: 'Polyline (3D)', POLYFACE: 'Polyface mesh', CIRCLE: 'Circle', ARC: 'Arc',
  ELLIPSE: 'Ellipse', SPLINE: 'Spline', TEXT: 'Text', MTEXT: 'Multiline text', INSERT: 'Block', HATCH: 'Hatch', DIMENSION: 'Dimension',
  POINT: 'Point', SOLID: 'Solid fill', '3DFACE': '3D face', LEADER: 'Leader', MULTILEADER: 'Multileader', MLINE: 'Multiline',
  XLINE: 'Construction line', RAY: 'Ray', ATTRIB: 'Attribute', ATTDEF: 'Attribute definition', WIPEOUT: 'Wipeout', IMAGE: 'Image', ACAD_TABLE: 'Table',
  TOLERANCE: 'Tolerance', '3DSOLID': '3D solid', REGION: 'Region', VIEWPORT: 'Viewport', TRACE: 'Trace' };
const trType = (x) => (getLang() === 'tr' ? TYPE_TR[x] : TYPE_EN[x]) || x;
const zTxt = (z) => (z != null && isFinite(z) && z !== 0) ? ' ; Z ' + fmt(z) : '';
let infoPrim = null;
function showInfo(p) {
  infoPrim = p;
  const inf = p.info || {}, u = S.units ? ' ' + S.units : '';
  const rows = [];
  const top = inf.t || p.et, sub = p.et;
  $('infoTitle').textContent = trType(top) + (sub !== top ? ' › ' + trType(sub) : '');
  if (top === 'INSERT') {
    rows.push([t('block'), inf.name], [t('insPoint'), fmt(inf.x) + ' ; ' + fmt(inf.y) + zTxt(inf.z)]);
    if (inf.sx !== 1 || inf.sy !== 1) rows.push([t('scale'), fmt(inf.sx) + ' / ' + fmt(inf.sy)]);
    if (inf.rot) rows.push([t('rotation'), fmt(inf.rot * 180 / Math.PI, 2) + '°']);
  }
  if (top === 'DIMENSION') { rows.push([t('measVal'), inf.meas != null ? fmt(inf.meas) + u : null]); if (inf.text && inf.text !== '<>') rows.push([t('measText'), inf.text]); rows.push([t('dimStyle'), inf.style]); }
  rows.push([t('layer'), p.lay]);
  const L = S.layers.get(p.lay);
  const colTxt = p.col === FG ? '7 (' + (S.dark ? t('white') : t('black')).toLocaleLowerCase(getLang() === 'tr' ? 'tr' : 'en') + ')' : rgbCss(p.col, '');
  rows.push([t('color'), (inf.ci === 256 ? t('fromLayer') + ' ' : inf.ci === 0 ? t('fromBlock') + ' ' : '') + colTxt]);
  rows.push([t('ltype'), p.lt || (L ? L.lt : 'Continuous')]);
  if (p.lw != null) rows.push([t('lweight'), fmt(p.lw / 100, 2) + ' mm']);
  if (p.k === 0) {
    const len = pathLength(p.ops, p.closed);
    if (sub === 'CIRCLE' && p.ops[1]) { const o = p.ops[1]; rows.push([t('center'), fmt(o[1]) + ' ; ' + fmt(o[2])], [t('radius'), fmt(o[3]) + u], [t('circumference'), fmt(len) + u], [t('area'), fmt(Math.PI * o[3] * o[3]) + (u ? u + '²' : '')]); }
    else if (sub === 'ARC' && p.ops[1] && p.ops[1][0] === 2) { const o = p.ops[1]; rows.push([t('center'), fmt(o[1]) + ' ; ' + fmt(o[2])], [t('radius'), fmt(o[3]) + u], [t('arcLen'), fmt(len) + u], [t('angle'), fmt(((o[5] - o[4] + TAU) % TAU) * 180 / Math.PI, 2) + '°']); }
    else {
      const pts = flatten(p.ops);
      const first = pts[0], last = pts[pts.length - 1];
      rows.push([t('length'), fmt(len) + u]);
      if (S.unitToM && S.unitToM !== 1) rows.push([t('length') + ' (m)', fmt(len * S.unitToM, 2) + ' m']);
      if (sub === 'LINE' && first && last) rows.push([t('start'), fmt(first[0]) + ' ; ' + fmt(first[1]) + zTxt(p.ops[0][3])], [t('end'), fmt(last[0]) + ' ; ' + fmt(last[1]) + zTxt(p.ops[1][3])], ['ΔX / ΔY', fmt(last[0] - first[0]) + ' / ' + fmt(last[1] - first[1])]);
      else if (first) rows.push([t('vertices'), p.ops.length], [t('start'), fmt(first[0]) + ' ; ' + fmt(first[1])], [t('end'), fmt(last[0]) + ' ; ' + fmt(last[1])]);
      if (p.closed || p.fill) rows.push([t('closed'), t('yes')], [t('area'), fmt(polyArea(pts)) + (u ? u + '²' : '')]);
      if (p.w) rows.push([t('width'), fmt(p.w) + u]);
      if (sub === 'HATCH') rows.push([t('pattern'), inf.pattern]);
    }
  } else if (p.k === 1) {
    rows.push([t('textK'), p.lines.join('\n')], [t('height'), fmt(p.h) + u], [t('rotation'), fmt(p.rot * 180 / Math.PI, 2) + '°'], [t('position'), fmt(p.x) + ' ; ' + fmt(p.y)]);
    if (sub === 'ATTRIB') rows.push([t('tag'), inf.tag]);
  } else if (p.k === 3) rows.push([t('file'), inf.file]);
  else rows.push([t('position'), fmt(p.x) + ' ; ' + fmt(p.y) + zTxt(p.z)]);
  if (inf.attrs && inf.attrs.length) { rows.push(['<strong>' + t('attrs') + '</strong>']); for (const a of inf.attrs) rows.push([a[0] || '–', a[1]]); }
  if (inf.xd && inf.xd.length) { rows.push(['<strong>' + t('xdata') + '</strong>']); for (const x of inf.xd) rows.push([x[0], x[1]]); }
  rows.push([t('handle'), inf.h]);
  $('infoBody').innerHTML = kv(rows);
  ensureInfoActions();
  show('infoPanel');
}
/** Bilgi paneli eylem çipleri (başlık altı): Buradan ölç · Katmanı izole et · Aynı katmandakileri seç */
function ensureInfoActions() {
  const panel = $('infoPanel'); if (!panel || $('infoActions')) return;
  const row = document.createElement('div'); row.id = 'infoActions'; row.className = 'info-actions';
  row.innerHTML = `<button type="button" class="chip" data-ia="measure">${tt('measureFrom', 'Buradan ölç')}</button><button type="button" class="chip" data-ia="iso">${tt('isolate', 'Katmanı izole et')}</button><button type="button" class="chip" data-ia="samelayer">${tt('selectSameLayer', 'Aynı katmandakileri seç')}</button>`;
  const body = $('infoBody'); body.parentElement.insertBefore(row, body);
  row.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ia]'); if (!b || !infoPrim) return;
    const p = infoPrim;
    if (b.dataset.ia === 'measure') { const pts = p.k === 0 ? flatten(p.ops) : [[p.x, p.y]]; hide('infoPanel'); setMode('measure'); if (pts[0]) { S.measure.push([pts[0][0], pts[0][1], undefined]); updateMeasure(); drawOverlay(); } }
    else if (b.dataset.ia === 'iso') isolateLayers([p.lay]);
    else if (b.dataset.ia === 'samelayer') {
      const same = S.prims.filter(q => q.lay === p.lay && q.k !== 4 && primVisible(q));
      if (editor.sel) { editor.sel.clear(); for (const q of same) editor.sel.add(q); }
      drawOverlay(); toast(same.length + ' ' + tt('selectedN', 'nesne seçildi'));
    }
  });
}
$('infoZoom').addEventListener('click', () => { if (infoPrim) { const b = infoPrim.bb; const m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.3 || 1; zoomExtents([b[0] - m, b[1] - m, b[2] + m, b[3] + m]); } });
$('infoCopy').addEventListener('click', () => {
  if (!infoPrim) return;
  const p = infoPrim, inf = p.info || {};
  let txt;
  if (p.k === 0) txt = flatten(p.ops).map(q => fmt(q[0]) + ';' + fmt(q[1])).join('\n');
  else if (inf.t === 'INSERT') txt = fmt(inf.x) + ';' + fmt(inf.y) + (inf.z ? ';' + fmt(inf.z) : '');
  else txt = fmt(p.x) + ';' + fmt(p.y);
  copyText(txt);
});

// ---- ölçü / profil --------------------------------------------------------------------
function setMode(m) {
  if (m !== 'view' && S.notesOn) toggleNotes(false);
  S.mode = m;
  $('btnMeasure').classList.toggle('active', m === 'measure' || m === 'profile');
  edCall('statusMode', m === 'measure' ? tt('measure', 'Ölçü') : m === 'profile' ? t('profile') : null);
  if (m === 'measure' || m === 'profile') {
    S.selected = null; hide('infoPanel'); S.measure = []; S.snap = null;
    $('measureTitle').textContent = m === 'profile' ? t('profile') : t('measure');
    $('measureHint').textContent = m === 'profile' ? t('profileHint') : t('measureHint');
    updateMeasure(); show('measurePanel');
  } else { hide('measurePanel'); S.measure = []; S.snap = null; }
  drawOverlay();
}
function updateMeasure() {
  const u = S.units ? ' ' + S.units : '';
  const m = S.measure;
  if (!m.length) { $('measureBody').innerHTML = `<div class="full">${t('firstPoint')}</div>`; return; }
  const rows = [];
  let total = 0;
  if (S.mode === 'profile') {
    const k = S.unitToM || 1;
    let cum = 0;
    rows.push(['1', `${fmt(m[0][0])} ; ${fmt(m[0][1])}   ${t('elev')} ${fmt(m[0][2], 2)} m${m[0].manual ? ' ' + t('manualElev') : ''}`]);
    for (let i = 1; i < m.length; i++) {
      const L = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]) * k; cum += L;
      const dh = m[i][2] - m[i - 1][2];
      const slope = L > 0 ? dh / L * 1000 : 0;
      rows.push([`${i} → ${i + 1}`, `L ${fmt(L, 2)} m   Δh ${fmt(dh, 3)} m   ${t('slope')} ${fmt(slope, 2)} ‰ (${fmt(slope / 10, 3)} %)   Σ ${fmt(cum, 2)} m`]);
      rows.push([`${i + 1}`, `${fmt(m[i][0])} ; ${fmt(m[i][1])}   ${t('elev')} ${fmt(m[i][2], 2)} m${m[i].manual ? ' ' + t('manualElev') : ''}`]);
    }
    if (m.length > 1) rows.push([t('total'), `${fmt(cum, 2)} m   Δh ${fmt(m[m.length - 1][2] - m[0][2], 3)} m   ${t('slope')} ${fmt((m[m.length - 1][2] - m[0][2]) / cum * 1000, 2)} ‰`]);
  } else {
    for (let i = 1; i < m.length; i++) {
      const d = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]); total += d;
      const ang = Math.atan2(m[i][1] - m[i - 1][1], m[i][0] - m[i - 1][0]) * 180 / Math.PI;
      rows.push([`${i} → ${i + 1}`, `${fmt(d)}${u}   (ΔX ${fmt(m[i][0] - m[i - 1][0])}, ΔY ${fmt(m[i][1] - m[i - 1][1])}, ${fmt(ang, 2)}°)` + (S.unitToM && S.unitToM !== 1 ? `  = ${fmt(d * S.unitToM, 2)} m` : '')]);
    }
    if (m.length > 2) {
      const closing = Math.hypot(m[0][0] - m[m.length - 1][0], m[0][1] - m[m.length - 1][1]);
      rows.push([t('total'), fmt(total) + u], [t('closedPerim'), fmt(total + closing) + u], [t('areaClosed'), fmt(polyArea(m)) + (u ? u + '²' : '') + (S.unitToM && S.unitToM !== 1 ? `  = ${fmt(polyArea(m) * S.unitToM * S.unitToM, 2)} m²` : '')]);
    } else if (m.length === 2) rows.push([t('total'), fmt(total) + u]);
    const last = m[m.length - 1];
    rows.push([t('lastPoint'), fmt(last[0]) + ' ; ' + fmt(last[1]) + zTxt(last[2]) + (S.snap ? `  (${S.snap.kind.toUpperCase()} ${t('snapped')})` : '')]);
    if (m.length === 1) rows.push([t('secondPoint')]);
  }
  $('measureBody').innerHTML = kv(rows);
  updateMeasureBig(rows, total);
}
/** Ölçü panelinde kalın okuma satırı ve panoya kopyala */
function updateMeasureBig(rows, total) {
  const panel = $('measurePanel'); if (!panel) return;
  let big = $('measureBig'), acts = $('measureActions');
  if (!big) {
    big = document.createElement('div'); big.id = 'measureBig'; big.className = 'meas-big';
    acts = document.createElement('div'); acts.id = 'measureActions'; acts.className = 'meas-actions';
    acts.innerHTML = `<button type="button" class="chip" id="measureCopy">${tt('copyClip', 'Panoya kopyala')}</button>`;
    const body = $('measureBody'); body.parentElement.insertBefore(big, body); body.parentElement.insertBefore(acts, body);
    $('measureCopy').addEventListener('click', () => { const txt = [...$('measureBody').querySelectorAll('.k, .v, .full')].reduce((a, el, i, arr) => { if (el.classList.contains('k')) a.push(el.textContent + '\t' + (arr[i + 1] ? arr[i + 1].textContent : '')); else if (el.classList.contains('full')) a.push(el.textContent); return a; }, []).join('\n'); copyText(txt); });
  }
  const m = S.measure, u = S.units ? ' ' + S.units : '';
  if (!m.length) { big.hidden = true; acts.hidden = true; return; }
  big.hidden = false; acts.hidden = false;
  if (S.mode === 'profile') { big.textContent = rows.length ? rows[rows.length - 1][1] : ''; return; }
  const last = m.length > 1 ? Math.hypot(m[m.length - 1][0] - m[m.length - 2][0], m[m.length - 1][1] - m[m.length - 2][1]) : 0;
  let s = m.length > 1 ? fmt(last) + u : fmt(m[0][0]) + ' ; ' + fmt(m[0][1]);
  if (m.length > 2) s += '   Σ ' + fmt(total) + u + '   A ' + fmt(polyArea(m)) + (u ? u + '²' : '');
  else if (m.length === 2 && S.unitToM && S.unitToM !== 1) s += '  = ' + fmt(last * S.unitToM, 2) + ' m';
  big.textContent = s;
}
$('btnMeasure').addEventListener('click', () => setMode(S.mode === 'measure' ? 'view' : 'measure'));
$('btnMeasureClear').addEventListener('click', () => { S.measure = []; S.snap = null; updateMeasure(); drawOverlay(); });
$('btnMeasureUndo').addEventListener('click', () => { S.measure.pop(); S.snap = null; updateMeasure(); drawOverlay(); });
$('btnMeasureClose').addEventListener('click', () => setMode('view'));
document.querySelectorAll('[data-snap]').forEach(cb => cb.addEventListener('change', () => {
  if (cb.checked) S.snapModes.add(cb.dataset.snap); else S.snapModes.delete(cb.dataset.snap);
  settings.snap = [...S.snapModes]; saveSettings();
}));

// ---- katmanlar -----------------------------------------------------------------------
const layerUi = { sort: 'name', onlyVis: false };
function buildLayerList() {
  const q = ($('layerFilter').value || '').toLowerCase();
  const sortSel = $('layerSort'); if (sortSel) layerUi.sort = sortSel.value === 'count' ? 'count' : 'name';
  const ov = $('layerOnlyVis'); const ovIn = ov && ov.querySelector('input'); if (ovIn) layerUi.onlyVis = ovIn.checked;
  const list = [...S.layers.values()].sort((a, b) => layerUi.sort === 'count' ? (b.count - a.count) || a.name.localeCompare(b.name, 'tr') : a.name.localeCompare(b.name, 'tr'));
  $('layerCount').textContent = list.length + ' ' + t('layerCount');
  const fg = fgColor(), pal = S.colorMode === 'layer';
  $('layerList').innerHTML = list.filter(l => (!q || l.name.toLowerCase().includes(q)) && (!layerUi.onlyVis || l.visible)).map(l =>
    `<div class="layer${l.frozen ? ' frozen' : ''}${l.faded ? ' faded' : ''}${l.locked ? ' locked' : ''}" data-layer-row="${esc(l.name)}"><label><input type="checkbox" data-layer="${esc(l.name)}" ${l.visible ? 'checked' : ''}></label>
     <span class="sw" style="background:${pal ? D.layerPalette(l.name) : rgbCss(l.color, fg)}"></span><span class="nm">${esc(l.name)}</span><span class="ct">${l.count}</span><button type="button" class="lbtn${l.faded ? ' on' : ''}" data-lfade="${esc(l.name)}" title="${tt('fadeLayer', 'Soldur')}" aria-label="${tt('fadeLayer', 'Soldur')}">◐</button><button type="button" class="lbtn${S.isoBackup && l.visible ? ' on' : ''}" data-liso="${esc(l.name)}" title="${tt('onlyThis', 'Yalnız bu')}" aria-label="${tt('onlyThis', 'Yalnız bu')}">⦿</button></div>`).join('') || `<div class="muted">${t('noResult')}</div>`;
  const un = $('btnLayersUniso'); if (un) un.hidden = !isIsolated();
}
$('layerList').addEventListener('change', (ev) => {
  const cb = ev.target; if (!cb.dataset.layer) return;
  const l = S.layers.get(cb.dataset.layer); if (l) { l.visible = cb.checked; S.cacheValid = false; requestRender(); }
});
$('layerList').addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.lfade != null) { const l = S.layers.get(b.dataset.lfade); if (l) setLayerFaded(l.name, !l.faded); }
  else if (b.dataset.liso != null) { if (isIsolated() && S.isoBackup && [...S.layers.values()].every(l => l.visible === (l.name === b.dataset.liso))) unisolate(); else isolateLayers([b.dataset.liso]); }
});
// katman satırına uzun basış: küçük menü
let layerLongTimer = 0, layerLongRow = null;
$('layerList').addEventListener('pointerdown', (ev) => {
  const row = ev.target.closest('[data-layer-row]'); if (!row || ev.target.closest('button')) return;
  layerLongRow = row; const x0 = ev.clientX, y0 = ev.clientY;
  clearTimeout(layerLongTimer);
  layerLongTimer = setTimeout(() => { layerLongTimer = 0; haptic('long'); layerMenu(row.dataset.layerRow); }, TOL.long);
  const cancel = (e) => { if (e.type === 'pointermove' && Math.hypot(e.clientX - x0, e.clientY - y0) < 8) return; clearTimeout(layerLongTimer); layerLongTimer = 0; row.removeEventListener('pointermove', cancel); row.removeEventListener('pointerup', cancel); row.removeEventListener('pointercancel', cancel); };
  row.addEventListener('pointermove', cancel); row.addEventListener('pointerup', cancel); row.addEventListener('pointercancel', cancel);
});
$('layerList').addEventListener('contextmenu', (ev) => { const row = ev.target.closest('[data-layer-row]'); if (row) { ev.preventDefault(); layerMenu(row.dataset.layerRow); } });
function layerMenu(name) {
  const l = S.layers.get(name); if (!l) return;
  const items = [['fit', tt('fitLayer', 'Katmana sığdır')], ['cur', tt('makeCurrent', 'Geçerli katman yap')], ['iso', tt('onlyThis', 'Yalnız bu')], ['fade', l.faded ? tt('unfade', 'Soldurmayı kaldır') : tt('fadeLayer', 'Soldur')], ['lock', l.locked ? tt('unlock', 'Kilidi aç') : tt('lock', 'Kilitle')]];
  openDoc(t('layer') + ': ' + name, `<div class="full list ctx-list">${items.map(i => `<div class="item" data-lm="${i[0]}">${esc(i[1])}</div>`).join('')}</div>`);
  $('docBody').onclick = (ev) => {
    const it = ev.target.closest('[data-lm]'); if (!it) return;
    hide('docPanel');
    switch (it.dataset.lm) {
      case 'fit': { const bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of S.prims) { if (p.lay !== name || p.k === 4 || p.inf) continue; const b = p.bb; if (b[0] < bb[0]) bb[0] = b[0]; if (b[1] < bb[1]) bb[1] = b[1]; if (b[2] > bb[2]) bb[2] = b[2]; if (b[3] > bb[3]) bb[3] = b[3]; } if (isFinite(bb[0])) { const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.1 || 1; zoomExtents([bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m]); } else toast(tt('layerEmpty', 'Katmanda nesne yok')); break; }
      case 'cur': if (edCall('setCurLayer', name) === undefined) { editor.curLayer = name; } toast(tt('curLayerSet', 'Geçerli katman') + ': ' + name); S.cacheValid = false; requestRender(); break;
      case 'iso': isolateLayers([name]); break;
      case 'fade': setLayerFaded(name, !l.faded); break;
      case 'lock': l.locked = !l.locked; S.cacheValid = false; buildLayerList(); requestRender(); break;
      default: break;
    }
  };
}
for (const [id, fn] of [['btnLayersUniso', () => unisolate()], ['btnLayersInvert', () => { for (const l of S.layers.values()) l.visible = !l.visible; S.cacheValid = false; buildLayerList(); requestRender(); }]]) { const b = $(id); if (b) b.addEventListener('click', fn); }
{ const ss = $('layerSort'); if (ss) ss.addEventListener('change', buildLayerList); const ov = $('layerOnlyVis'); if (ov) ov.addEventListener('change', buildLayerList); }
$('layerFilter').addEventListener('input', buildLayerList);
$('btnLayersAll').addEventListener('click', () => { for (const l of S.layers.values()) l.visible = true; buildLayerList(); requestRender(); });
$('btnLayersNone').addEventListener('click', () => { for (const l of S.layers.values()) l.visible = false; buildLayerList(); requestRender(); });
const wide = window.matchMedia('(min-width: 900px)');
function dockLayers() {
  const panel = $('layerPanel'), side = $('side');
  if (wide.matches) { if (panel.parentElement !== side) side.appendChild(panel); side.hidden = panel.hidden; }
  else { if (panel.parentElement === side) $('app').appendChild(panel); side.hidden = true; }
}
$('btnLayers').addEventListener('click', () => { if (!S.hasDoc) { toast(t('openFirst')); return; } if ($('layerPanel').hidden) { buildLayerList(); show('layerPanel'); } else hide('layerPanel'); dockLayers(); });
document.querySelector('[data-close="layerPanel"]').addEventListener('click', dockLayers);
wide.addEventListener('change', dockLayers);

// ---- arama -----------------------------------------------------------------------------
$('btnSearch').addEventListener('click', () => { if (!S.hasDoc) { toast(t('openFirst')); return; } show('searchPanel'); $('searchInput').focus(); doSearch(); });
$('searchInput').addEventListener('input', doSearch);
function doSearch() {
  const q = ($('searchInput').value || '').trim().toLowerCase();
  const body = $('searchBody');
  if (!q) { body.innerHTML = ''; return; }
  const res = [];
  const prims = S.prims;
  for (let i = 0; i < prims.length && res.length < 200; i++) {
    const p = prims[i], inf = p.info || {};
    if (p.k === 4 || !primVisible(p)) continue;
    let hit = null;
    if (p.k === 1 && p.lines.join(' ').toLowerCase().includes(q)) hit = p.lines.join(' ');
    else if (inf.h && inf.h.toLowerCase() === q) hit = 'handle ' + inf.h;
    else if (inf.name && inf.name.toLowerCase().includes(q)) hit = t('block') + ': ' + inf.name;
    else if (inf.attrs && inf.attrs.some(a => (a[1] || '').toLowerCase().includes(q) || (a[0] || '').toLowerCase().includes(q))) hit = inf.attrs.filter(a => (a[1] || '').toLowerCase().includes(q) || (a[0] || '').toLowerCase().includes(q)).map(a => a[0] + '=' + a[1]).join(', ');
    else if (inf.xd && inf.xd.some(x => x[1].toLowerCase().includes(q))) hit = 'XDATA: ' + inf.xd.find(x => x[1].toLowerCase().includes(q))[1].slice(0, 80);
    else if (p.k !== 1 && p.lay.toLowerCase().includes(q) && res.length < 60) hit = t('layer') + ': ' + p.lay;
    if (hit) res.push({ p, hit });
  }
  body.innerHTML = res.length ? res.map((r, i) => `<div class="item" data-i="${i}">${esc(r.hit)}<small>${esc(trType(r.p.info ? r.p.info.t : r.p.et))} · ${esc(r.p.lay)}</small></div>`).join('') : `<div class="muted">${t('noResult')}</div>`;
  body.onclick = (ev) => {
    const it = ev.target.closest('.item'); if (!it) return;
    const r = res[Number(it.dataset.i)];
    const b = r.p.bb; const m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.6 || 5;
    S.selected = r.p; zoomExtents([b[0] - m, b[1] - m, b[2] + m, b[3] + m]); showInfo(r.p);
  };
}

// ---- diğer menüsü --------------------------------------------------------------------
$('btnMore').addEventListener('click', () => { $('moreMenu').hidden = !$('moreMenu').hidden; });
$('btnExtents').addEventListener('click', () => zoomExtents());
function menuAction(act) {
  closeMenu();
  const needDoc = ['info', 'layouts', 'notes', 'profile', 'compare', 'xrefs', 'views', 'png', 'pdf'];
  if (needDoc.includes(act) && !S.hasDoc) { toast(t('openFirst')); return; }
  switch (act) {
    case 'info': showDocInfo(); break;
    case 'layouts': showLayouts(); break;
    case 'notes': toggleNotes(!S.notesOn); break;
    case 'profile': setMode(S.mode === 'profile' ? 'view' : 'profile'); break;
    case 'gps': showGps(); break;
    case 'basemap': showBasemap(); break;
    case 'compare': showCompare(); break;
    case 'xrefs': showXrefs(); break;
    case 'views': showViews(); break;
    case 'bg': toggleDisplay('theme'); break;
    case 'mono': toggleDisplay('colorMode'); break;
    case 'lw': toggleDisplay('lw'); break;
    case 'text': toggleDisplay('showText'); break;
    case 'display': openDisplayOptions(); break;
    case 'drive': Drive.open(); break;
    case 'goto': gotoCoord(); break;
    case 'zoomwin': zoomWindow(); break;
    case 'prevview': viewHistory.back(); break;
    case 'nextview': viewHistory.forward(); break;
    case 'extents': zoomExtents(); break;
    case 'png': savePng(); break;
    case 'pdf': showPdf(); break;
    case 'server': showServer(); break;
    case 'qr': startQr(); break;
    case 'settings': showSettings(); break;
    case 'about': showAbout(); break;
    default: break;
  }
}
$('moreMenu').addEventListener('click', (ev) => { const b = ev.target.closest('[data-act]'); if (b) menuAction(b.dataset.act); });

function showDocInfo() {
  const c = S.counts;
  const rows = [[t('file'), S.fileName], [t('version'), S.version], [t('unit'), S.units || t('undefinedUnit')], [t('entityCount'), S.entityCount], [t('primCount'), S.prims.length],
    [t('layerN'), S.layers.size], [t('blockN'), S.blockCount], [t('layouts'), S.scene.layouts.map(l => l.name).join(', ')],
    [t('xRange'), S.ext ? fmt(S.ext[0]) + ' … ' + fmt(S.ext[2]) : ''], [t('yRange'), S.ext ? fmt(S.ext[1]) + ' … ' + fmt(S.ext[3]) : ''],
    [t('size'), S.ext ? fmt(S.ext[2] - S.ext[0]) + ' × ' + fmt(S.ext[3] - S.ext[1]) + (S.units ? ' ' + S.units : '') : '']];
  { const c2 = S.counts || {}; const list = Object.entries(c2).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => k + ' ' + v).join(', '); if (list) rows.push([t('entityTypes'), list]);
    const cen = S.scene && S.scene.census; if (cen) { const l2 = Object.entries(cen).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => k + ' ' + v).join(', '); if (l2) rows.push([t('dwgTypes'), l2]); } }
  { const d = S.scene && S.scene.solidDiag; if (d) {
    const surf = Object.entries(d.surfaces || {}).map(([k, v]) => k + ' ' + v).join(', ');
    rows.push([t('solidDiag'), `${d.solids} ${t('solidsN')} · ${d.faces} ${t('facesN')}${d.approx ? ' (' + d.approx + ' ' + t('approxN') + ')' : ''} · ${d.skipped} ${t('skippedN')}` + (surf ? ' · ' + surf : '') + (d.versions.length ? ' · ACIS ' + d.versions.join('/') : '') + (d.unknownTags.length ? ' · ' + t('unknownTag') + ' ' + d.unknownTags.join(' ') : '') + (d.errors.length ? ' · ' + d.errors.join('; ') : '')]);
  } }
  if (S.geo.active && S.ext) { const ll = S.geo.toLonLat((S.ext[0] + S.ext[2]) / 2, (S.ext[1] + S.ext[3]) / 2); if (ll) rows.push([t('crs'), S.geo.crs.name + ` (${t('centerLbl')} φ ${ll[1].toFixed(5)}, λ ${ll[0].toFixed(5)})`]); }
  rows.push(['<strong>' + t('types') + '</strong>']);
  for (const k of Object.keys(c).sort((a, b) => c[b] - c[a])) rows.push([trType(k), c[k]]);
  openDoc(t('info'), kv(rows));
}
/** derleme kimliği (kısa git SHA; Bridge.buildId) — Hakkında satırına ve hata kaydı başlığına eklenir */
function buildIdText() { try { return A() && A().buildId ? ' · ' + A().buildId() : ''; } catch (_) { return ''; } }
function showAbout() {
  const ver = (A() && A().appVersion ? A().appVersion() : 'web') + (A() && A().versionCode ? ` (${A().versionCode()})` : '') + buildIdText();
  const rows = [[t('aboutApp'), t('welcomeTitle') + ' ' + ver], [t('aboutParser'), t('aboutParserText')],
    [t('aboutSupported'), t('aboutSupportedText')],
    [t('aboutLimits'), t('aboutLimitsText')],
    [t('aboutUsage'), t('aboutUsageText')],
    [t('aboutKeys'), t('aboutKeysText')],
    [t('aboutThirdParty'), t('aboutThirdPartyText')],
    [t('aboutLicense'), t('aboutLicenseText')],
    [`<div class="full btns"><button class="btn small" id="btnErrLog">${t('errorLog')}</button>${S.scene ? `<button class="btn small" id="btnSolidDiag">${t('solidDiagShare')}</button>` : ''}<button class="btn small" id="btnUpdate">${t('update')}?</button></div>`]];
  openDoc(t('about'), kv(rows));
  { const b = $('btnSolidDiag'); if (b) b.onclick = () => { const txt = solidDiagText(); if (A() && A().shareText) A().shareText(t('solidDiagTitle'), txt); else copyText(txt); }; }
  $('btnErrLog').onclick = () => { const log = A() && A().getErrorLog ? A().getErrorLog() : (store.get('errlog') || ''); if (!log) { toast(t('noError')); return; } if (A() && A().shareText) A().shareText(t('errLogTitle') + buildIdText(), log); else copyText(log); };
  $('btnUpdate').onclick = () => checkUpdate(true);
}

// ---- sayfa düzenleri --------------------------------------------------------------------
function buildLayoutTabs() {
  const tabs = $('layoutTabs');
  const ls = S.scene ? S.scene.layouts : [];
  tabs.hidden = ls.length < 2;
  tabs.innerHTML = ls.map((l, i) => `<button data-i="${i}" class="${i === S.layoutIndex ? 'active' : ''}">${esc(l.name)}</button>`).join('');
  tabs.onclick = (ev) => { const b = ev.target.closest('button'); if (b) setLayout(Number(b.dataset.i)); };
}
function setLayout(i) {
  const L = S.scene.layouts[i]; if (!L) return;
  S.layoutIndex = i; S.prims = L.prims; S.ext = L.ext;
  S.tree = L.isModel ? S.modelTree : (L.tree || (L.tree = new RTree(L.prims, p => p.bb)));
  S.selected = null; S.cacheValid = false;
  buildLayoutTabs();
  zoomExtents();
}
function showLayouts() {
  const ls = S.scene.layouts;
  openDoc(t('layouts'), `<div class="full list">` + ls.map((l, i) => `<div class="item" data-i="${i}">${esc(l.name)}${i === S.layoutIndex ? ' ✓' : ''}<small>${l.prims.length} ${t('prims')} · ${l.viewports.length} ${t('viewportsN')}</small></div>`).join('') + `</div>`);
  $('docBody').onclick = (ev) => { const it = ev.target.closest('.item'); if (it) { setLayout(Number(it.dataset.i)); hide('docPanel'); } };
}

// ---- notlar -----------------------------------------------------------------------------
function toggleNotes(on) {
  S.notesOn = on;
  $('notesBar').hidden = !on;
  refreshNav();
  if (on && S.mode !== 'view') setMode('view');
  if (!on) { selectedNote = null; noteDraft = null; }
  drawOverlay();
}
$('notesBar').addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.tool) { S.noteTool = b.dataset.tool; document.querySelectorAll('#notesBar [data-tool]').forEach(x => x.classList.toggle('active', x === b)); refreshNav(); return; }
  if (b.id === 'noteUndo') { const last = notes.items[notes.items.length - 1]; if (last) removeNote(last.id); selectedNote = null; drawOverlay(); }
  else if (b.id === 'noteDelete') { if (selectedNote) { removeNote(selectedNote.id); selectedNote = null; drawOverlay(); } }
  else if (b.id === 'noteClose') toggleNotes(false);
});
$('noteColor').addEventListener('input', (ev) => { S.noteColor = ev.target.value; });
let pendingPhotoPoint = null;
async function noteTap(sx, sy, w) {
  if (S.noteTool === 'text') {
    const txt = await askText(t('notePrompt'), '', { multiline: true });
    if (txt) addNote({ type: 'text', pts: [w], color: S.noteColor, text: txt });
  } else if (S.noteTool === 'photo') {
    pendingPhotoPoint = w;
    pickFile('photo', 'image/*');
  } else {
    selectedNote = hitNote(sx, sy);
    if (selectedNote && selectedNote.type === 'photo' && selectedNote.photo) openPhoto(selectedNote);
    else if (selectedNote && selectedNote.type === 'text') { const txt = await askText(t('notePrompt'), selectedNote.text || '', { multiline: true }); if (txt !== null) { selectedNote.text = txt; saveNotes(); } }
  }
  drawOverlay();
}
function loadPhoto(id, url) {
  if (photos.has(id)) return photos.get(id);
  const rec = { img: new Image(), ok: false };
  rec.img.onload = () => { rec.ok = true; drawOverlay(); };
  rec.img.src = url || ('/file/' + id);
  photos.set(id, rec);
  return rec;
}
function openPhoto(n) {
  const rec = photos.get(n.photo);
  const src = rec ? rec.img.src : '/file/' + n.photo;
  openDoc(t('photo'), `<div class="full"><img src="${esc(src)}" style="max-width:100%;border-radius:8px"></div><div class="full muted">${esc(n.text || '')} · ${new Date(n.t).toLocaleString('tr-TR')}</div>`);
}

// ---- GPS --------------------------------------------------------------------------------
let geoWatch = null;
function gpsToggle(on) {
  S.gps.on = on;
  $('gpsBtn').classList.toggle('on', on);
  $('stGps').hidden = !on;
  if (on) {
    if (!S.geo.active) toast(t('gpsNoCrs'), 4000);
    if (A() && A().startLocation) A().startLocation();
    else if (navigator.geolocation) geoWatch = navigator.geolocation.watchPosition(p => onLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.coords.heading, p.coords.speed), e => toast('GPS: ' + e.message), { enableHighAccuracy: true, maximumAge: 1000 });
    toast(t('gpsWait'));
  } else {
    if (A() && A().stopLocation) A().stopLocation();
    if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
    S.gps.follow = false;
  }
  drawOverlay();
}
function onLocation(lat, lon, acc, heading, speed) {
  S.gps.lat = lat; S.gps.lon = lon; S.gps.acc = acc || 0; S.gps.heading = heading != null && heading >= 0 ? heading : null; S.gps.t = Date.now();
  $('stGps').textContent = '● ±' + fmt(acc, 0) + ' m';
  if (S.gps.follow && S.geo.active && S.hasDoc) { const d = S.geo.toDrawing(lon, lat); if (d) { S.view.cx = d[0]; S.view.cy = d[1]; requestRender(); return; } }
  drawOverlay();
}
function gpsGoto() {
  if (S.gps.lat == null) { toast(t('gpsWait')); return; }
  if (!S.geo.active) { toast(t('gpsNoCrs'), 4000); return; }
  const d = S.geo.toDrawing(S.gps.lon, S.gps.lat);
  if (!d) return;
  S.view.cx = d[0]; S.view.cy = d[1];
  const e = S.ext, ew = e[2] - e[0], eh = e[3] - e[1];
  const inside = d[0] >= e[0] - ew && d[0] <= e[2] + ew && d[1] >= e[1] - eh && d[1] <= e[3] + eh;
  if (!inside) toast(t('gpsOutside') + ': ' + fmt(d[0]) + ' ; ' + fmt(d[1]) + ' — ' + t('gpsCheckCrs'), 6000);
  requestRender();
}
$('gpsBtn').addEventListener('click', () => { if (!S.gps.on) gpsToggle(true); else gpsGoto(); });
function showGps() {
  const rows = [[t('crs'), S.geo.active ? S.geo.crs.name : t('gpsNoCrs')],
    [t('positionLbl'), S.gps.lat != null ? `φ ${S.gps.lat.toFixed(6)}  λ ${S.gps.lon.toFixed(6)}  ±${fmt(S.gps.acc, 0)} m` : (S.gps.on ? t('gpsWait') : t('gpsOff'))]];
  if (S.gps.lat != null && S.geo.active) { const d = S.geo.toDrawing(S.gps.lon, S.gps.lat); if (d) rows.push([t('drawingCoord'), fmt(d[0]) + ' ; ' + fmt(d[1])]); }
  rows.push([`<div class="full btns"><button class="btn small" id="gOn">${S.gps.on ? t('gpsOff') : t('gpsOn')}</button><button class="btn small" id="gGo">${t('gpsHere')}</button><label class="chk"><input type="checkbox" id="gFollow" ${S.gps.follow ? 'checked' : ''}> ${t('gpsFollow')}</label><button class="btn small" id="gSet">${t('settings')}</button></div>`]);
  openDoc(t('gps'), kv(rows));
  $('gOn').onclick = () => { gpsToggle(!S.gps.on); showGps(); };
  $('gGo').onclick = () => { if (!S.gps.on) gpsToggle(true); gpsGoto(); };
  $('gFollow').onchange = (ev) => { S.gps.follow = ev.target.checked; if (S.gps.follow) { if (!S.gps.on) gpsToggle(true); gpsGoto(); } };
  $('gSet').onclick = showSettings;
}

// ---- ayarlar ---------------------------------------------------------------------------
function showSettings() {
  const g = S.fileKey ? (store.json('geo:' + S.fileKey, null) || {}) : {};
  const cur = { crs: g.crs || settings.crs, unit: g.unit || settings.unit, swap: g.swap != null ? g.swap : settings.swap, dx: g.dx || settings.dx || 0, dy: g.dy || settings.dy || 0 };
  const unitOpts = [['auto', t('unitFromDrawing') + (S.units ? ': ' + S.units : '') + ')'], ['0.001', 'mm'], ['0.01', 'cm'], ['1', 'm'], ['0.1', 'dm'], ['1000', 'km']];
  const html = kv([
    [t('language'), `<select id="sLang"><option value="tr" ${settings.lang === 'tr' ? 'selected' : ''}>Türkçe</option><option value="en" ${settings.lang === 'en' ? 'selected' : ''}>English</option></select>`, 1],
    [t('crs'), `<select id="sCrs">${CRS.map(c => `<option value="${c.id}" ${c.id === cur.crs ? 'selected' : ''}>${esc(nameOf(c))}</option>`).join('')}</select>`, 1],
    [t('drawingUnit'), `<select id="sUnit">${unitOpts.map(o => `<option value="${o[0]}" ${String(cur.unit) === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`, 1],
    [t('axisSwap'), `<label class="chk"><input type="checkbox" id="sSwap" ${cur.swap ? 'checked' : ''}> ${esc(t('axisSwapHint'))}</label>`, 1],
    [t('offset') + ' X', `<input id="sDx" type="number" step="any" value="${cur.dx}">`, 1],
    [t('offset') + ' Y', `<input id="sDy" type="number" step="any" value="${cur.dy}">`, 1],
    [t('lwScale'), `<input id="sLw" type="number" step="0.5" min="1" max="10" value="${S.lwScale}">`, 1],
    [`<div class="full muted">${S.fileKey ? esc(t('geoPerFile')) + ' ' : ''}${esc(t('ed50Note'))}</div>`],
    [`<div class="full btns"><button class="btn primary small" id="sSave">${t('save')}</button><button class="btn small" id="sDisplay">${tt('dispTitle', 'Ekran ayarları')}</button></div>`]]);
  let a11y = null;
  try { if (typeof editorMod.accessibilitySection === 'function') a11y = editorMod.accessibilitySection(); } catch (e) { console.warn(e); a11y = null; }
  openDoc(t('settings'), html + (a11y && a11y.html ? a11y.html : ''));
  if (a11y && typeof a11y.bind === 'function') { try { a11y.bind($('docBody')); } catch (e) { console.warn(e); } }
  $('sDisplay').onclick = () => { hide('docPanel'); openDisplayOptions(); };
  $('sSave').onclick = () => {
    settings.lang = $('sLang').value; settings.lwScale = Number($('sLw').value) || 3;
    const geo = { crs: $('sCrs').value, unit: $('sUnit').value, swap: $('sSwap').checked, dx: Number($('sDx').value) || 0, dy: Number($('sDy').value) || 0 };
    if (S.fileKey) store.set('geo:' + S.fileKey, JSON.stringify(geo));
    Object.assign(settings, geo); saveSettings(); applySettings(); applyGeo();
    S.cacheValid = false; requestRender(); hide('docPanel'); toast(t('save') + ' ✓');
  };
}

// ---- harita altlığı -----------------------------------------------------------------------
function showBasemap() {
  const html = kv([
    [t('basemap'), `<select id="bmSel">${BASEMAPS.map(b => `<option value="${b.id}" ${b.id === S.basemap.id ? 'selected' : ''}>${esc(nameOf(b))}</option>`).join('')}</select>`, 1],
    ['XYZ', `<input id="bmUrl" placeholder="https://…/{z}/{x}/{y}.png" value="${esc(S.basemap.url)}">`, 1],
    ['WMS', `<input id="bmWms" placeholder="https://sunucu/wms?LAYERS=katman" value="${esc(S.basemap.wms)}">`, 1],
    [t('basemapOpacity'), `<input id="bmOp" type="range" min="0.1" max="1" step="0.05" value="${S.basemap.opacity}" oninput="window.dwgApp.display.setDisplay('basemapOpacity', Number(this.value), {fast:true})">`, 1],
    [`<div class="full muted">${S.geo.active ? S.geo.crs.name : t('basemapNeedCrs')}</div>`],
    [`<div class="full btns"><button class="btn primary small" id="bmSave">${t('save')}</button></div>`]]);
  openDoc(t('basemap'), html);
  $('bmSave').onclick = () => {
    settings.basemap = $('bmSel').value; settings.basemapUrl = $('bmUrl').value.trim(); settings.wms = $('bmWms').value.trim(); settings.opacity = Number($('bmOp').value);
    saveSettings(); applySettings(); S.cacheValid = false; requestRender(); hide('docPanel');
    if (settings.basemap !== 'none' && !S.geo.active) toast(t('basemapNeedCrs'), 4000);
  };
}

// ---- kayıtlı görünümler ----------------------------------------------------------------------
function showViews() {
  const views = store.json('views:' + S.fileKey, []);
  const home = store.json('home:' + S.fileKey, null);
  const html = `<div class="full btns"><button class="btn primary small" id="vSave">${t('viewSave')}</button><button class="btn small" id="vHome">${tt('setHome', 'Ana görünüm yap')}</button>${home ? `<button class="btn small" id="vGoHome">${tt('homeView', 'Ana görünüm')}</button>` : ''}</div><div class="full list">` +
    (views.length ? views.map((v, i) => `<div class="item" data-i="${i}">${esc(v.name)}<small>${esc(v.layout || 'Model')} · 1 px = ${fmt(1 / v.view.scale)} · <a href="#" data-del="${i}">${t('delete')}</a></small></div>`).join('') : `<div class="muted">${t('noViews')}</div>`) + `</div><div class="full" id="vBookmarks3d"></div>`;
  openDoc(t('views'), html);
  $('vSave').onclick = async () => { const name = await askText(t('viewName'), t('viewDefault') + ' ' + (views.length + 1)); if (!name) return; views.push({ name, view: { ...S.view }, layout: S.scene.layouts[S.layoutIndex].name, li: S.layoutIndex }); store.set('views:' + S.fileKey, JSON.stringify(views)); showViews(); };
  $('vHome').onclick = () => { D.setHome(); showViews(); };
  if ($('vGoHome')) $('vGoHome').onclick = () => { D.gotoHome(); hide('docPanel'); };
  import('./view3d_panel.js').then(m => {
    const el = $('vBookmarks3d'); if (!el || typeof m.listBookmarks !== 'function') return;
    const bm = m.listBookmarks(S.fileKey) || [];
    if (bm.length) el.innerHTML = `<strong>3B</strong><div class="list">${bm.map(b => `<div class="item muted">${esc(b.name)}<small>${esc(b.style || '')} ${b.cam ? '· yaw ' + fmt(b.cam.yaw * 180 / Math.PI, 0) + '°' : ''}</small></div>`).join('')}</div>`;
  }).catch(() => {});
  $('docBody').onclick = (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) { ev.preventDefault(); views.splice(Number(del.dataset.del), 1); store.set('views:' + S.fileKey, JSON.stringify(views)); showViews(); return; }
    const it = ev.target.closest('.item[data-i]'); if (!it) return;
    const v = views[Number(it.dataset.i)];
    if (v.li != null && v.li !== S.layoutIndex && S.scene.layouts[v.li]) setLayout(v.li);
    S.view = { ...v.view }; viewHistory.push(); requestRender(); hide('docPanel');
  };
}
/** Koordinata git (X/Y ya da φ/λ) */
function gotoCoord() {
  if (!S.hasDoc) { toast(t('openFirst')); return; }
  const swap = !!S.geo.swap, lx = swap ? t('yNorth') : 'X', ly = swap ? t('xEast') : 'Y';
  const rows = [[lx, `<input id="gotoX" type="text" inputmode="decimal" placeholder="412345.67">`, 1], [ly, `<input id="gotoY" type="text" inputmode="decimal" placeholder="4512345.89">`, 1]];
  if (S.geo.active) rows.push([t('latLbl'), `<input id="gotoLat" type="text" inputmode="decimal" placeholder="40.7654 ya da 40°45'55.4&quot;">`, 1], [t('lonLbl'), `<input id="gotoLon" type="text" inputmode="decimal" placeholder="29.9408">`, 1]);
  rows.push([`<div class="full btns"><button class="btn primary small" id="gotoGo">${tt('go', 'Git')}</button><button class="btn small" id="gotoMark">${tt('markPoint', 'İşaretle')}</button><button class="btn small" id="gotoPaste">${tt('paste', 'Yapıştır')}</button></div>`]);
  openDoc(tt('gotoCoord', 'Koordinata git'), kv(rows));
  const num = (s) => { s = String(s || '').trim().replace(',', '.'); const m = /^(-?)(\d+(?:\.\d+)?)[°\s]+(\d+(?:\.\d+)?)?['\s]*(\d+(?:\.\d+)?)?"?\s*([NSEWKDGB])?$/i.exec(s); if (m && (m[3] != null || m[4] != null)) { let v = Number(m[2]) + (Number(m[3]) || 0) / 60 + (Number(m[4]) || 0) / 3600; if (m[1] === '-' || /[SWB]/i.test(m[5] || '')) v = -v; return v; } const v = parseFloat(s); return isFinite(v) ? v : NaN; };
  const target = () => {
    if (S.geo.active && $('gotoLat').value.trim() && $('gotoLon').value.trim()) { const d = S.geo.toDrawing(num($('gotoLon').value), num($('gotoLat').value)); return d || null; }
    const x = num($('gotoX').value), y = num($('gotoY').value);
    return isFinite(x) && isFinite(y) ? [x, y] : null;
  };
  const go = (mark) => { const d = target(); if (!d) { toast(tt('badCoord', 'Koordinat okunamadı'), { type: 'warn' }); return; } S.view.cx = d[0]; S.view.cy = d[1]; S.gotoMarker = mark ? [d[0], d[1]] : null; S.gps.follow = false; viewHistory.push(); requestRender(); hide('docPanel'); };
  $('gotoGo').onclick = () => go(false);
  $('gotoMark').onclick = () => go(true);
  $('gotoPaste').onclick = async () => {
    let txt = '';
    try { txt = navigator.clipboard ? await navigator.clipboard.readText() : ''; } catch (_) { txt = ''; }
    if (!txt && A() && A().paste) { try { txt = A().paste() || ''; } catch (_) { txt = ''; } }
    const parts = txt.split(/[;\s]+|,(?=\s)/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) { $('gotoX').value = parts[0]; $('gotoY').value = parts[1]; } else toast(tt('badCoord', 'Koordinat okunamadı'), { type: 'warn' });
  };
  $('gotoX').focus();
}

// ---- karşılaştırma ---------------------------------------------------------------------------
function showCompare() {
  if (S.compare) {
    const st = S.compare.stats;
    openDoc(t('compare'), kv([[t('file'), S.compare.name],
      [`<div class="legend full"><span><i style="background:#ff453a"></i>${t('onlyA')}: ${st.removed}</span></div>`],
      [`<div class="legend full"><span><i style="background:#30d158"></i>${t('onlyB')}: ${st.added}</span></div>`],
      [`<div class="legend full"><span><i style="background:#6b7683"></i>${t('both')}: ${st.common}</span></div>`],
      [`<div class="full btns"><button class="btn small" id="cmpOff">${t('compareOff')}</button></div>`]]));
    $('cmpOff').onclick = () => { S.compare = null; S.cacheValid = false; requestRender(); hide('docPanel'); };
    return;
  }
  toast(t('compareLoad'));
  pickFile('compare', '*/*');
}
async function setCompare(buf, name) {
  setLoading(t('loading'), name);
  try {
    const res = await runWorker({ cmd: 'parse', bytes: buf, name }, st => setLoading(stageText(st), name));
    const B = res.scene.layouts[0].prims.filter(p => p.k !== 4);
    const Aprims = S.scene.layouts[0].prims;
    const sigB = new Set(), sigA = new Set();
    for (const p of B) { const s = primSignature(p); if (s) sigB.add(s); }
    for (const p of Aprims) { const s = primSignature(p); if (s) sigA.add(s); }
    const mark = new Map();
    const stats = { removed: 0, added: 0, common: 0 };
    for (const p of Aprims) { if (p.k === 4) continue; const st = sigB.has(primSignature(p)) ? 'common' : 'removed'; mark.set(p, st); stats[st]++; }
    for (const p of B) { if (!sigA.has(primSignature(p))) { mark.set(p, 'added'); stats.added++; } }
    for (const l of res.scene.layers) if (!S.layers.has(l.name)) S.layers.set(l.name, { ...l });
    S.compare = { prims: B, tree: new RTree(B, p => p.bb), mark, stats, name };
    S.cacheValid = false; requestRender(); showCompare();
  } catch (e) { fail(e); }
  setLoading(null);
}

// ---- xref ve resimler ------------------------------------------------------------------------
function showXrefs() {
  const xr = S.scene.xrefs || [], im = S.scene.images || [];
  if (!xr.length && !im.length) { openDoc(t('xrefs'), `<div class="full muted">${esc(t('noXrefs'))}</div>`); return; }
  let html = '';
  if (xr.length) html += `<div class="full"><strong>XREF</strong></div>` + xr.map((x, i) => `<div class="k">${esc(x.name)}</div><div class="v">${x.loaded ? '✓ ' + t('loadedMark') : `<button class="btn small" data-xref="${i}">${t('pickXref')}</button> <span class="muted">${x.inserts.length} ${t('insertsN')}</span>`}</div>`).join('');
  if (im.length) html += `<div class="full"><strong>${t('imgMissing')}</strong></div>` + im.map((x, i) => `<div class="k">${esc((x.fileName || x.handle).replace(/^.*[\\/]/, ''))}</div><div class="v">${S.images.has(x.handle) && S.images.get(x.handle).ok ? '✓' : `<button class="btn small" data-img="${i}">${t('pickXref')}</button>`}</div>`).join('');
  openDoc(t('xrefs'), html);
  $('docBody').onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.xref != null) pickFile('xref:' + b.dataset.xref, '*/*');
    if (b.dataset.img != null) pickFile('img:' + im[Number(b.dataset.img)].handle, 'image/*');
  };
}
async function loadXref(idx, buf, name) {
  const x = S.scene.xrefs[idx];
  setLoading(t('loading'), name);
  try {
    const res = await runWorker({ cmd: 'xref', bytes: buf, name, inserts: x.inserts, prefix: x.name }, st => setLoading(stageText(st), name));
    const model = S.scene.layouts[0];
    for (const l of res.xref.layers) if (!S.layers.has(l.name)) S.layers.set(l.name, { ...l });
    Object.assign(S.ltypes, res.xref.ltypes);
    model.prims.push(...res.xref.prims);
    if (res.xref.ext) model.ext = [Math.min(model.ext[0], res.xref.ext[0]), Math.min(model.ext[1], res.xref.ext[1]), Math.max(model.ext[2], res.xref.ext[2]), Math.max(model.ext[3], res.xref.ext[3])];
    S.modelTree = new RTree(model.prims, p => p.bb);
    if (S.scene.layouts[S.layoutIndex].isModel) { S.prims = model.prims; S.tree = S.modelTree; S.ext = model.ext; }
    x.loaded = true;
    S.cacheValid = false; requestRender(); showXrefs();
  } catch (e) { fail(e); }
  setLoading(null);
}
function loadImageFile(handle, src) {
  const rec = { img: new Image(), ok: false };
  rec.img.onload = () => { rec.ok = true; S.cacheValid = false; requestRender(); };
  rec.img.onerror = () => toast(t('imgLoadFail'));
  rec.img.src = src;
  S.images.set(handle, rec);
}

// ---- sunucu / indirme --------------------------------------------------------------------
function showServer() {
  const last = store.get('serverUrl') || '';
  let html = kv([[t('serverUrl'), `<input id="srvUrl" value="${esc(last)}" placeholder="https://…/paftalar.json">`, 1], [`<div class="full btns"><button class="btn primary small" id="srvGo">${t('download')}</button></div>`], [`<div class="full" id="srvList"></div>`]]);
  if (A() && A().listDownloads) {
    let dl = [];
    try { dl = JSON.parse(A().listDownloads() || '[]'); } catch (_) { dl = []; }
    if (dl.length) html += `<div class="full"><strong>${t('cached')}</strong></div><div class="full list">` + dl.map(d => `<div class="item" data-dl="${esc(d.id)}">${esc(d.name)}<small>${fmt(d.size / 1024 / 1024, 2)} MB · ${new Date(d.time).toLocaleDateString('tr-TR')} · <a href="#" data-del="${esc(d.id)}">${t('delete')}</a></small></div>`).join('') + `</div>`;
  }
  openDoc(t('server'), html);
  $('srvGo').onclick = () => fetchIndex($('srvUrl').value.trim());
  $('docBody').onclick = (ev) => {
    const del = ev.target.closest('[data-del]'); if (del) { ev.preventDefault(); A().deleteDownload(del.dataset.del); showServer(); return; }
    const it = ev.target.closest('[data-dl]'); if (it) { A().openDownload(it.dataset.dl); hide('docPanel'); }
  };
}
async function fetchIndex(url) {
  if (!url) return;
  store.set('serverUrl', url);
  if (/\.(dwg|dxf)(\?.*)?$/i.test(url)) { downloadDwg(url, decodeURIComponent(url.split('/').pop().split('?')[0])); return; }
  const list = $('srvList');
  list.innerHTML = `<div class="muted">${t('loading')}</div>`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = r.headers.get('content-type') || '';
    let files = [];
    if (ct.includes('json') || /\.json(\?.*)?$/i.test(url)) {
      const j = await r.json();
      const arr = j.files || j.paftalar || j.dosyalar || (Array.isArray(j) ? j : []);
      files = arr.map(f => ({ name: f.name || f.ad || String(f.url || f.adres).split('/').pop(), url: new URL(f.url || f.adres, url).href }));
    } else {
      const html = await r.text();
      const re = /href="([^"]+\.(?:dwg|dxf))"/ig; let m;
      while ((m = re.exec(html))) files.push({ name: decodeURIComponent(m[1].split('/').pop()), url: new URL(m[1], url).href });
    }
    list.innerHTML = files.length ? `<div class="list">` + files.map((f, i) => `<div class="item" data-f="${i}">${esc(f.name)}<small>${esc(f.url)}</small></div>`).join('') + `</div>` : `<div class="muted">${t('noResult')}</div>`;
    list.onclick = (ev) => { const it = ev.target.closest('[data-f]'); if (it) { const f = files[Number(it.dataset.f)]; downloadDwg(f.url, f.name); } };
  } catch (e) { list.innerHTML = `<div class="muted">${esc(t('error'))}: ${esc(e.message)}</div>`; }
}
async function downloadDwg(url, name) {
  setLoading(t('download'), name);
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    if (A() && A().saveBytes) {
      const id = A().saveBytes(name, await bufToB64(buf));
      if (id) { toast(t('downloaded') + ': ' + name); A().openDownload(id); }
    } else await loadBytes(buf, name);
    hide('docPanel');
  } catch (e) { fail(e); }
  setLoading(null);
}
const bufToB64 = (buf) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(new Blob([buf])); });

// ---- QR -------------------------------------------------------------------------------------
let qrStream = null, qrTimer = 0;
async function startQr() {
  if (!navigator.mediaDevices || !window.jsQR) { toast(t('noCamera')); return; }
  try {
    if (A() && A().requestCamera) A().requestCamera();
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) { toast(t('cameraFail') + ': ' + e.message); return; }
  const video = $('qrVideo'); video.srcObject = qrStream; show('qrPanel');
  const c = document.createElement('canvas');
  qrTimer = setInterval(() => {
    if (!video.videoWidth) return;
    c.width = video.videoWidth; c.height = video.videoHeight;
    const g = c.getContext('2d'); g.drawImage(video, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    const code = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
    if (code && code.data) { stopQr(); onQr(code.data.trim()); }
  }, 350);
}
function stopQr() { clearInterval(qrTimer); if (qrStream) { qrStream.getTracks().forEach(tr => tr.stop()); qrStream = null; } hide('qrPanel'); }
$('qrStop').addEventListener('click', stopQr);
function onQr(text) {
  toast('QR: ' + text.slice(0, 80));
  // biçimler: https://…/pafta.dwg#B-127   |   dwg://pafta.dwg#B-127   |   B-127
  if (/^https?:\/\//i.test(text)) {
    const u = new URL(text); const frag = decodeURIComponent(u.hash.slice(1)); u.hash = '';
    downloadDwg(u.href, decodeURIComponent(u.pathname.split('/').pop())).then(() => { if (frag) setTimeout(() => searchAndZoom(frag), 1500); });
    return;
  }
  const m = /^dwg:\/\/(.+?)(?:#(.+))?$/i.exec(text);
  if (m) { toast(t('sheet') + ': ' + m[1] + (m[2] ? ' · ' + m[2] : '')); if (m[2] && S.hasDoc) searchAndZoom(m[2]); return; }
  if (S.hasDoc) searchAndZoom(text);
}
function searchAndZoom(q) { show('searchPanel'); $('searchInput').value = q; doSearch(); const first = $('searchBody').querySelector('.item'); if (first) first.click(); }
$('btnQr').addEventListener('click', startQr);
$('btnServer').addEventListener('click', showServer);

// ---- dışa aktarma ------------------------------------------------------------------------------
function overlayForExport(c) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  drawNotes(c, toScreen, S.view.scale, null, null, photos);
}
function savePng(dataUrl, name) {
  let data = typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl : null;
  name = name || (baseName() + '_' + stamp() + (editor.is3D() ? '_3d' : '') + '.png');
  if (!data) {
    if (editor.is3D()) {
      const v = editor.view3d();
      if (v && typeof v.screenshot === 'function') { try { data = v.screenshot({ overlay: ov }); } catch (e) { console.warn(e); data = null; } }
      if (!data && v) { const c = document.createElement('canvas'); c.width = v.cv.width; c.height = v.cv.height; const g = c.getContext('2d'); g.drawImage(v.cv, 0, 0); g.drawImage(ov, 0, 0, c.width, c.height); data = c.toDataURL('image/png'); }
    }
    if (!data) {
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
      const g = c.getContext('2d'); g.drawImage(cv, 0, 0); g.drawImage(ov, 0, 0);
      try { data = c.toDataURL('image/png'); } catch (e) { toast(t('pngFail'), { ms: 5000, type: 'error' }); return; }
    }
  }
  if (A() && A().savePng) A().savePng(data.split(',')[1], name);
  else { const a = document.createElement('a'); a.href = data; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000); }
  lastPng = { b64: data.split(',')[1], name };
  toast(tt('pngSaved', 'PNG kaydedildi'), { type: 'ok', action: Drive.signedIn() ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => Drive.uploadWithPicker({ b64: lastPng.b64, name: lastPng.name, mime: 'image/png' }) } : undefined });
}
let lastPng = null;
const baseName = () => (S.fileName || 'cizim').replace(/\.(dwg|dxf)$/i, '');
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
const PAPERS = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
function showPdf() {
  const html = kv([
    [t('title'), `<input id="pTitle" value="${esc(baseName())}">`, 1],
    [t('paper'), `<select id="pPaper">${Object.keys(PAPERS).map(k => `<option ${k === 'A3' ? 'selected' : ''}>${k}</option>`).join('')}</select>`, 1],
    [t('orient'), `<select id="pOrient"><option value="l">${t('landscape')}</option><option value="p">${t('portrait')}</option></select>`, 1],
    [t('pdfScale'), `<input id="pScale" type="number" min="1" step="1" placeholder="${t('pdfFit')}" value="">`, 1],
    [t('dpi'), `<select id="pDpi"><option>100</option><option selected>150</option><option>200</option><option>300</option></select>`, 1],
    [`<div class="full muted">Ölçek boş bırakılırsa mevcut görünüm sayfaya sığdırılır. Ölçek verilirse görünüm merkezi esas alınır (çizim birimi: ${S.units || '?'}).</div>`],
    [`<div class="full btns"><button class="btn primary small" id="pGo">${t('create')}</button></div>`]]);
  openDoc(t('pdfTitle'), html);
  $('pGo').onclick = () => makePdf($('pTitle').value, $('pPaper').value, $('pOrient').value, Number($('pScale').value) || 0, Number($('pDpi').value) || 150);
}
async function makePdf(title, paper, orient, scaleN, dpi) {
  setLoading(t('pdfTitle'), paper);
  await new Promise(r => setTimeout(r, 30));
  try {
    let [wmm, hmm] = PAPERS[paper]; if (orient === 'l') [wmm, hmm] = [hmm, wmm];
    const pxPerMm = dpi / 25.4;
    const W = Math.round(wmm * pxPerMm), H = Math.round(hmm * pxPerMm);
    const margin = 10 * pxPerMm, tb = 18 * pxPerMm;
    const aw = Math.round(W - 2 * margin), ah = Math.round(H - 2 * margin - tb);
    let bb;
    if (scaleN > 0 && S.unitToM) {
      const ww = (aw / pxPerMm / 1000) * scaleN / S.unitToM, hh = (ah / pxPerMm / 1000) * scaleN / S.unitToM;
      bb = [S.view.cx - ww / 2, S.view.cy - hh / 2, S.view.cx + ww / 2, S.view.cy + hh / 2];
    } else {
      const vr = visibleRect();
      const ar = aw / ah, vw = vr[2] - vr[0], vh = vr[3] - vr[1];
      if (vw / vh > ar) { const nh = vw / ar; bb = [vr[0], S.view.cy - nh / 2, vr[2], S.view.cy + nh / 2]; } else { const nw = vh * ar; bb = [S.view.cx - nw / 2, vr[1], S.view.cx + nw / 2, vr[3]]; }
      scaleN = S.unitToM ? Math.round(((bb[2] - bb[0]) * S.unitToM * 1000) / (aw / pxPerMm)) : 0;
    }
    const img = renderRegion(bb, aw, ah, { light: true, overlay: overlayForExport });
    const page = document.createElement('canvas'); page.width = W; page.height = H;
    const g = page.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.drawImage(img, margin, margin);
    g.strokeStyle = '#000'; g.lineWidth = Math.max(1, pxPerMm * 0.35); g.strokeRect(margin, margin, aw, ah);
    const y0 = margin + ah;
    g.strokeRect(margin, y0, aw, tb);
    g.fillStyle = '#000'; g.textBaseline = 'middle';
    g.font = `bold ${Math.round(4.5 * pxPerMm)}px sans-serif`; g.fillText(title || baseName(), margin + 3 * pxPerMm, y0 + tb * 0.32);
    g.font = `${Math.round(3 * pxPerMm)}px sans-serif`;
    const info = [`${t('file')}: ${S.fileName}`, S.scene.layouts[S.layoutIndex].name, scaleN ? `${t('pdfScale')}${scaleN}` : '', S.units ? `${t('drawingUnit')}: ${S.units}` : '', S.geo.active ? S.geo.crs.name : '', new Date().toLocaleString('tr-TR')].filter(Boolean).join('   ·   ');
    g.fillText(info, margin + 3 * pxPerMm, y0 + tb * 0.72);
    const nx = W - margin - 8 * pxPerMm, ny = y0 + tb / 2;
    g.beginPath(); g.moveTo(nx, ny - 5 * pxPerMm); g.lineTo(nx + 2.5 * pxPerMm, ny + 4 * pxPerMm); g.lineTo(nx, ny + 2 * pxPerMm); g.lineTo(nx - 2.5 * pxPerMm, ny + 4 * pxPerMm); g.closePath(); g.fill();
    g.font = `bold ${Math.round(3 * pxPerMm)}px sans-serif`; g.textAlign = 'center'; g.fillText('K', nx, ny - 7 * pxPerMm); g.textAlign = 'left';
    if (scaleN && S.unitToM) {
      const worldPerPx = (bb[2] - bb[0]) / aw;
      const barM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(v => v / (worldPerPx * S.unitToM) > 25 * pxPerMm) || 1000;
      const px = barM / (worldPerPx * S.unitToM);
      const bx = nx - 20 * pxPerMm - px, by = y0 + tb * 0.7;
      g.fillRect(bx, by, px / 2, 1.5 * pxPerMm); g.strokeRect(bx, by, px, 1.5 * pxPerMm);
      g.font = `${Math.round(2.5 * pxPerMm)}px sans-serif`; g.fillText('0', bx, by - 2 * pxPerMm); g.fillText(barM + ' m', bx + px - 3 * pxPerMm, by - 2 * pxPerMm);
    }
    const jpeg = page.toDataURL('image/jpeg', 0.92).split(',')[1];
    const pdf = buildPdf(jpeg, W, H, wmm, hmm, title || baseName());
    const name = baseName() + '_' + stamp() + '.pdf';
    const driveAct = Drive.signedIn() ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => Drive.uploadWithPicker({ b64: pdf, name, mime: 'application/pdf' }) } : undefined;
    if (A() && A().saveFile) { const r = A().saveFile(pdf, name, 'application/pdf', true); toast(r ? t('pdfDone') + ': ' + r : t('pdfFail'), { type: r ? 'ok' : 'error', ms: 6000, action: r ? driveAct : undefined }); }
    else { const a = document.createElement('a'); a.href = 'data:application/pdf;base64,' + pdf; a.download = name; a.click(); toast(t('pdfDone'), { type: 'ok', action: driveAct }); }
    hide('docPanel');
  } catch (e) { fail(e); }
  setLoading(null);
}
/** Tek sayfalık, JPEG gömülü PDF (base64) */
function buildPdf(jpegB64, pw, ph, wmm, hmm, title) {
  const bin = atob(jpegB64);
  const Wpt = wmm * 72 / 25.4, Hpt = hmm * 72 / 25.4;
  const parts = [];
  const enc = new TextEncoder();
  let offset = 0; const xref = [];
  const push = (s) => { const b = typeof s === 'string' ? enc.encode(s) : s; parts.push(b); offset += b.length; };
  push('%PDF-1.4\n');
  const obj = (n, body) => { xref[n] = offset; push(`${n} 0 obj\n${body}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Wpt.toFixed(2)} ${Hpt.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`);
  const content = `q ${Wpt.toFixed(2)} 0 0 ${Hpt.toFixed(2)} 0 0 cm /Im1 Do Q`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  xref[5] = offset;
  push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n`);
  const img = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) img[i] = bin.charCodeAt(i);
  push(img); push('\nendstream\nendobj\n');
  const esc2 = (s) => s.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '\\$&');
  obj(6, `<< /Title (${esc2(title)}) /Producer (DWG Goruntuleyici) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`);
  const xrefPos = offset;
  let x = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) x += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------------------
// Yükleme
// ---------------------------------------------------------------------------
function setLoading(text, sub) { if (text == null) { hide('loading'); return; } $('loadingText').textContent = text; $('loadingSub').textContent = sub || ''; show('loading'); }
{ const b = $('loadingCancel'); if (b) b.addEventListener('click', () => { cancelJobs(tt('cancelled', 'İptal edildi')); setLoading(null); toast(tt('cancelled', 'İptal edildi')); }); }
function fail(err) {
  if (err && err.cancelled) { console.warn(err.message); return; }   // iptal: yeni yükleme sürüyor, modal ona ait
  console.error(err);
  setLoading(null);
  const msg = (err && err.message) || String(err);
  toast(t('error') + ': ' + msg, 6000);
  logError(msg + '\n' + (err && err.stack ? err.stack : ''));
}
function logError(text) {
  const line = new Date().toISOString() + ' ' + text;
  if (A() && A().logError) A().logError(line); else store.set('errlog', ((store.get('errlog') || '') + '\n' + line).slice(-20000));
}
window.addEventListener('error', (ev) => logError((ev.message || '') + ' @' + (ev.filename || '') + ':' + (ev.lineno || '')));
window.addEventListener('unhandledrejection', (ev) => logError('promise: ' + ((ev.reason && ev.reason.message) || ev.reason)));

const STAGES = { lib: 'stageLib', parse: 'stageParse', scene: 'stageScene' };   // i18n anahtarları
const stageText = (st) => STAGES[st] ? t(STAGES[st]) : st;
const BIG_FILE_MB = 80;   // bu boyutun üstünde açmadan önce onay istenir (bellek / süre)
let loadSeq = 0;
async function loadBytes(buf, name, size) {
  const t0 = performance.now();
  const bytes = size || buf.byteLength;
  const mb = fmt(bytes / 1024 / 1024, 2) + ' MB';
  if (bytes > BIG_FILE_MB * 1048576 && !(await askConfirm(`${name} · ${mb}. ${t('bigFileAsk')}`))) { setLoading(null); return; }
  const my = ++loadSeq;
  setLoading(t('loading'), name + ' · ' + mb);
  try {
    let res = await runWorker({ cmd: 'parse', bytes: buf, name }, (st, pct) => setLoading(stageText(st), name + ' · ' + mb + (pct != null ? ' · %' + pct : '')));
    const scene = res.scene; res = null;   // yapısal klon: büyük dosyada referansı erken düşür
    await setScene(scene, name, bytes);
    // özet toast'ından sonra (toast tek satırdır, hemen üstüne yazılırsa görünmez)
    if (scene.readWarn) setTimeout(() => toast(`${tt('readWarn', 'Dosya eksik/bozuk okunmuş olabilir')} (LibreDWG ${scene.readWarn}); ${tt('readWarnSub', 'çizim eksik olabilir.')}`, { type: 'warn', ms: 8000 }), 1200);
    const ms = Math.round(performance.now() - t0);
    const hidden = [...S.layers.values()].filter(l => !l.visible).length;
    toast(`${name} · ${S.entityCount} ${t('entity')} · ${ms} ms` + (hidden ? ` · ${hidden} ${t('layersHiddenN')}` : ''));
    if (!S.prims.length) toast(t('noModelPrims'), 5000);
    if (S.scene.xrefs.length || S.scene.images.length) setTimeout(() => toast(t('xrefMissing') + ': ' + [...S.scene.xrefs.map(x => x.name), ...S.scene.images.map(i => (i.fileName || '').split(/[\\/]/).pop())].filter(Boolean).join(', ') + ' — ' + t('seeXrefs'), 6000), 3000);
  } catch (e) { fail(e); }
  if (my === loadSeq) setLoading(null);   // iptal edilen eski yükleme yenisinin modalını kapatmasın
}
/** R-ağacı: büyük sahnede önce bir kare bırakılır ki 'İndeks kuruluyor' yazısı çizilsin ve dokunma/geri tuşu işlensin */
async function buildTree(prims) {
  if (prims.length < 100000) return new RTree(prims, p => p.bb);
  setLoading(tt('indexing', 'İndeks kuruluyor…'), prims.length + ' ' + tt('prims', 'ilkel'));
  await new Promise(r => setTimeout(r));
  return new RTree(prims, p => p.bb);
}
async function setScene(scene, name, size) {
  S.modelTree = await buildTree(scene.layouts[0].prims);
  S.scene = scene; S.fileName = name; S.fileKey = (name + '_' + size).replace(/[^\w.-]+/g, '_');
  S.layers = new Map(scene.layers.map(l => [l.name, l]));
  S.ltypes = scene.ltypes; S.styles = scene.styles; S.counts = scene.counts; S.entityCount = scene.entityCount; S.blockCount = scene.blockCount;
  { const d = scene.solidDiag; if (d && d.solids > 0 && !d.faces) setTimeout(() => toast(`${d.solids} ${t('solidsUnresolved')} (${(d.errors[0] || '').slice(0, 80)}). ${t('seeSolidDiag')}`, { type: 'warn', ms: 9000 }), 800); }
  S.version = ({ AC1012: 'R13', AC1014: 'R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018' })[scene.version] || scene.version || '';
  if (/\.dxf$/i.test(name)) S.version = 'DXF ' + S.version;
  const iu = scene.header.INSUNITS;
  S.units = UNITS[iu] || ''; S.unitToM = UNIT_TO_M[iu] || 0;
  S.images = new Map(); S.compare = null; S.selected = null; S.cacheValid = false;
  S.hasDoc = true;
  Docs.suspend();
  if (S.mode !== 'view') setMode('view');
  if (S.notesOn) toggleNotes(false);
  hide('empty'); hide('infoPanel'); hide('docPanel'); hide('searchPanel');
  showFileName(name);
  $('stCount').textContent = S.entityCount + ' ' + t('entity') + ' · ' + S.layers.size + ' ' + t('layerCount');
  { const sub = $('fileSub'); if (sub) sub.textContent = [S.entityCount + ' ' + t('entity'), S.units || null, S.version || null].filter(Boolean).join(' · '); }
  document.body.classList.add('hasdoc');
  $('gpsBtn').hidden = false;
  S.isoBackup = null; S.lastPoint = null; S.gotoMarker = null; S.layerPalette.clear();
  viewHistory.reset();
  applyGeo();
  loadNotes(S.fileKey);
  for (const n of notes.items) if (n.type === 'photo' && n.photo) loadPhoto(n.photo);
  setLayout(0);
  editorScene();
  if (!$('layerPanel').hidden) buildLayerList();
  refreshNav();
  setTimeout(saveThumb, 400);
}
/** üst çubuk dosya adı: dar başlıkta ortadan kısaltılır, uzantı görünür kalır */
function showFileName(name) { $('fileName').textContent = name.length > 22 ? name.slice(0, 10) + '…' + name.slice(-10) : name; $('fileName').title = name; }
function saveThumb() {
  if (!S.hasDoc || !A() || !A().saveThumb) return;
  try {
    const c = renderRegion(S.scene.layouts[0].ext, 192, 144, {});
    A().saveThumb(S.fileKey, c.toDataURL('image/png').split(',')[1]);
    buildRecent();
  } catch (_) { /* yoksay */ }
}
async function fetchFile(id) {
  const r = await fetch('/file/' + id, { cache: 'no-store' });
  if (!r.ok) throw new Error('dosya okunamadı (HTTP ' + r.status + ')');
  return r.arrayBuffer();
}
let loadingKey = null;   // Android'den aynı dosya iki kez gelirse (intent + onResume) ikincisi yok sayılır
async function loadCurrent(name, size) {
  const key = name + '|' + (size || 0);
  if (loadingKey === key) return;
  loadingKey = key;
  try {
    if (!Docs.isCad(name) && Docs.kindOf(name) !== 'other') { setLoading(t('loading'), name); const ok = await Docs.openCurrent(name, size); setLoading(null); if (ok) return; }
    setLoading(t('loading'), name); await loadBytes(await fetchFile('current'), name, size);
  } catch (e) { fail(e); }
  finally { if (loadingKey === key) loadingKey = null; }
}
/** Android dosya seçici sonucu */
async function onFilePicked(purpose, id, name, size) {
  try {
    if (purpose === 'open') { await loadCurrent(name, size); return; }
    if (purpose.startsWith('upload:')) { const info = JSON.parse(A().docOpen(id) || '{}'); if (info.error) throw new Error(info.error); Drive.upload({ fileId: info.id, name, mime: Docs.kindOf(name) === 'cad' ? 'application/acad' : 'application/octet-stream', folder: purpose.slice(7) }); return; }
    if (purpose === 'compare') { await setCompare(await fetchFile(id), name); return; }
    if (purpose.startsWith('xref:')) { await loadXref(Number(purpose.slice(5)), await fetchFile(id), name); return; }
    if (purpose.startsWith('img:')) { loadImageFile(purpose.slice(4), '/file/' + id); return; }
    if (purpose === 'photo' && pendingPhotoPoint) {
      const txt = (await askText(t('notePrompt'), '', { multiline: true })) || '';
      addNote({ type: 'photo', pts: [pendingPhotoPoint], color: S.noteColor, photo: id, text: txt });
      loadPhoto(id); pendingPhotoPoint = null; drawOverlay();
    }
  } catch (e) { fail(e); }
}
function pickFile(purpose, mime) {
  if (A() && A().pickFile) { A().pickFile(purpose, mime || '*/*'); return; }
  const inp = document.createElement('input'); inp.type = 'file'; if (mime && mime !== '*/*') inp.accept = mime;
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    if (purpose === 'open') { if (Docs.isCad(f.name)) await loadBytes(await f.arrayBuffer(), f.name, f.size); else await Docs.openBlob(f); }
    else if (purpose === 'compare') await setCompare(await f.arrayBuffer(), f.name);
    else if (purpose.startsWith('xref:')) await loadXref(Number(purpose.slice(5)), await f.arrayBuffer(), f.name);
    else if (purpose.startsWith('img:')) loadImageFile(purpose.slice(4), URL.createObjectURL(f));
    else if (purpose === 'photo' && pendingPhotoPoint) {
      const id = 'blob_' + Date.now();
      loadPhoto(id, URL.createObjectURL(f));
      addNote({ type: 'photo', pts: [pendingPhotoPoint], color: S.noteColor, photo: id, text: (await askText(t('notePrompt'), '', { multiline: true })) || '' });
      pendingPhotoPoint = null; drawOverlay();
    }
  };
  inp.click();
}
function openPicker() { if (A() && A().pickFile) A().pickFile('open', '*/*'); else $('fileInput').click(); }
$('btnOpen').addEventListener('click', openPicker);
$('btnOpen2').addEventListener('click', openPicker);
$('fileInput').addEventListener('change', async (ev) => { const f = ev.target.files && ev.target.files[0]; if (!f) return; try { if (Docs.isCad(f.name) || Docs.kindOf(f.name) === 'other') await loadBytes(await f.arrayBuffer(), f.name, f.size); else await Docs.openBlob(f); } catch (e) { fail(e); } ev.target.value = ''; });

// ---- son dosyalar --------------------------------------------------------------------------
function buildRecent() {
  if (!A() || !A().getRecent) return;
  let list = [];
  try { list = JSON.parse(A().getRecent() || '[]'); } catch (_) { list = []; }
  $('recentWrap').hidden = !list.length;
  $('recentList').innerHTML = list.map((r, i) => `<div class="item" data-i="${i}">${r.thumb ? `<img src="/file/thumb_${esc(r.key)}?${r.time}">` : '<div class="noimg"></div>'}<div class="nm">${esc(r.name)}<div class="meta">${fmt(r.size / 1024 / 1024, 2)} MB · ${new Date(r.time).toLocaleString('tr-TR')}</div></div></div>`).join('');
  $('recentList').onclick = (ev) => { const it = ev.target.closest('.item'); if (it) A().openRecent(list[Number(it.dataset.i)].uri); };
}

// ---- geri tuşu --------------------------------------------------------------------------------
function onBack() {
  if (askOpen()) { askCancel(); return true; }
  if (!$('qrPanel').hidden) { stopQr(); return true; }
  if (!$('moreMenu').hidden) { closeMenu(); return true; }
  if (zoomWin) { cancelZoomWindow(); return true; }
  if (!$('drivePanel').hidden) { Drive.close(); return true; }
  if (Docs.isOpen()) { const open0 = openPanels(); if (open0.length) { for (const id of open0) hide(id); return true; } Docs.back(); return true; }
  if (S.gotoMarker) { S.gotoMarker = null; drawOverlay(); return true; }
  const open = openPanels();
  if (open.length) { for (const id of open) hide(id); dockLayers(); if (S.mode !== 'view') setMode('view'); return true; }
  if (editorBack()) return true;
  if (S.notesOn) { toggleNotes(false); return true; }
  if (S.mode !== 'view') { setMode('view'); return true; }
  if (S.selected) { S.selected = null; drawOverlay(); return true; }
  return false;
}

// ---- sürüm denetimi ---------------------------------------------------------------------------
async function checkUpdate(manual) {
  if (window.__noUpdate) return;                                   // sınama bayrağı (tools/harness.mjs)
  if (!manual && !(A() && A().versionCode)) return;                // otomatik denetim yalnız Android'de: tarayıcıda confirm açılmasın
  try {
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(VERSION_URL, { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const mine = A() && A().versionCode ? Number(A().versionCode()) : 0;
    if (j.versionCode > mine) {
      if (manual || await askConfirm(`${t('update')}: ${j.versionName}. ${t('updateAsk')}`)) { if (A() && A().openUrl) A().openUrl(j.url); else window.open(j.url, '_blank'); }
    } else if (manual) toast(t('upToDate'));
  } catch (e) { if (manual) toast(t('updateFail') + ': ' + e.message); }
}

// ---------------------------------------------------------------------------
// Başlangıç
// ---------------------------------------------------------------------------
window.dwgApp = { loadCurrent, onFilePicked, onLocation, onBack, loadBytes, zoomExtents, render, toScreen, toWorld, state: S, notes, editor, setMode, setLayout, refreshRecent: buildRecent,
  onQr: (text) => { try { const s = String(text || '').trim(); if (s) onQr(s); } catch (e) { console.warn(e); } },   // Android ACTION_SEND / EXTRA_TEXT
  onLocationError: (m) => { const perm = /kalıcı olarak reddedildi|permanently denied/i.test(String(m)); const openSet = A() && A().openAppSettings ? () => A().openAppSettings() : null;
    toast('GPS: ' + m, perm && openSet ? { ms: 8000, action: { label: tt('settings', 'Ayarlar'), fn: openSet } } : undefined); },
  display: D, toast, zoomBy, zoomWindow, viewHistory, gotoCoord, fitPrims, savePng, getSettings: () => settings, requestRender, openDisplayOptions,
  docs: Docs, drive: Drive, onGoogle: (ok, json) => Drive.onGoogle(ok, json), onDrive: (id, ok, json) => Drive.onDrive(id, ok, json), onDriveProgress: (id, d, tot) => Drive.onProgress(id, d, tot), openDrive: () => Drive.open() };
ensureStatusChips();
D.initDisplay({ requestRender, drawOverlay, toast, openDoc, show, hide, buildLayerList, settings, saveSettings, editorTheme, zoomExtents, zoomBy, fitPrims, viewHistory, setLayout, editor, ui: uiPrefs(), basemaps: BASEMAPS, haptic });
mountNavFabs(vp);
initEditor({ S, requestRender, drawOverlay, toast, noFaces: showNoFaces, pick: (w) => pick(w, TOL.pick / S.view.scale), snap: doSnap, showInfo, openDoc, hide, show, esc, kv, copyText, buildLayerList, fmt, store, RTree, baseName, zoomExtents, tracePath, worldTransform, strokeWorldRect,
  action: (a) => { if (a === 'layers') $('btnLayers').click(); else if (a === 'search') $('btnSearch').click(); else if (a === 'more') $('btnMore').click(); else menuAction(a); },
  savePng, zoomBy, zoomWindow, viewHistory, gotoCoord, fitPrims, isolateLayers, unisolate, settings, saveSettings, stamp, haptic, openDisplayOptions, setDisplay, getDisplay, toggleDisplay, display: D });
$('stScale').addEventListener('click', showScalePicker);
// belgeler (PDF / Word / ZIP / RAR) ve Google Drive
Docs.initDocs({ toast, loadBytes, openDoc, hide, show, esc, kv, driveAvailable: () => Drive.signedIn(), driveUpload: (d) => { if (d && d.id) Drive.uploadWithPicker({ fileId: d.id, name: d.name, mime: 'application/octet-stream' }); }, driveConvert: (d) => Drive.convertToPdf(d),
  onOpen: () => { closeMenu(); if (S.notesOn) toggleNotes(false); if (S.mode !== 'view') setMode('view'); hide('infoPanel'); }, onClose: () => { requestRender(); },
  onCadFromArchive: () => { toast(tt('backToArchive', 'Arşive dön') + '?', { ms: 6000, action: { label: tt('backToArchive', 'Arşive dön'), fn: () => Docs.reopenLast() } }); } });
Drive.initDrive({ toast, openDoc, hide, show, esc, kv, hideToast: () => { $('toast').hidden = true; }, openRegistered: (info) => Docs.openRegistered(info), openConverted: (info) => Docs.openConverted(info),
  dxfBytes: () => (editor.dxfBase64 ? editor.dxfBase64(false) : null), pngBytes: () => { savePng(); return lastPng; },
  pickForUpload: (folder) => pickFile('upload:' + folder, '*/*') });
$('btnDrive').addEventListener('click', () => Drive.open());
// klavye (odak bir giriş alanında değilken): önce düzenleyici, sonra gezinti
window.addEventListener('keydown', (ev) => {
  const tg = ev.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
  if (edCall('key', ev) === true) { ev.preventDefault(); return; }
  if (!S.hasDoc) return;
  const k = ev.key; if (typeof k !== 'string') return;
  let done = true;
  if (k === '+' || k === '=') zoomBy(1.5); else if (k === '-') zoomBy(1 / 1.5);
  else if (k === 'f' || k === 'F') zoomExtents(); else if (k === 'Home') { if (!D.gotoHome()) zoomExtents(); }
  else if (k === 'PageUp') viewHistory.back(); else if (k === 'PageDown') viewHistory.forward();
  else if (k.startsWith('Arrow')) { const f = ev.shiftKey ? 0.02 : 0.1; if (k === 'ArrowLeft') S.view.cx -= S.W * f / S.view.scale; else if (k === 'ArrowRight') S.view.cx += S.W * f / S.view.scale; else if (k === 'ArrowUp') S.view.cy += S.H * f / S.view.scale; else S.view.cy -= S.H * f / S.view.scale; requestRender(); clearTimeout(wheelTimer); wheelTimer = setTimeout(() => viewHistory.push(), 400); }
  else if (k === 'z' || k === 'Z') zoomWindow(); else if (k === 'g' || k === 'G') toggleDisplay('grid'); else if (k === 'd' || k === 'D') { const p = $('displayPanel'); if (p && !p.hidden) closeDisplayOptions(); else openDisplayOptions(); }
  else if (k === 'Escape') { if (!onBack()) done = false; }
  else done = false;
  if (done) ev.preventDefault();
});
applySettings();
applyGeo();
resize();
requestRender();
buildRecent();
if (A() && A().getPendingFile) {
  try { const pf = A().getPendingFile(); if (pf) { const o = JSON.parse(pf); loadCurrent(o.name, o.size); } } catch (e) { console.warn(e); }
}
setTimeout(() => checkUpdate(false), 4000);
