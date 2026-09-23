/*
 * DWG OfficeZip – uygulama: yükleme, çizim döngüsü, dokunma, paneller ve araçlar.
 * Çözümleme worker.js'te, geometri geom.js'te, çizim render.js'te.
 */
import { S, toWorld, toScreen, fitView, zoomAtScreen, visibleRect, UNITS, UNIT_TO_M, fmt, fmtUnit, store, clampPrec, PREC_MIN, PREC_MAX } from './state.js';
import { RTree, snapPoint, snapCandidates, primDist, flatten, pathLength, pathLength3, polyArea, meshMetrics, TAU, segmentsOf, segIntersect } from './geom.js';
import { FG, ACI, primSignature } from './scene.js';
import { drawFrame, rgbCss, bgColor, fgColor, tracePath, renderRegion, gridState, niceStep, worldTransform as renderWorldTransform, worldOrigin, plotRgb, plotKey } from './render.js';
import * as D from './display.js';
import { DISPLAY_DEFAULTS, setDisplay, getDisplay, toggleDisplay, primVisible, isolateLayers, unisolate, isIsolated, setLayerFaded, openDisplayOptions, closeDisplayOptions, mountNavFabs, gridLabel, refreshNav } from './display.js';
import * as editorMod from './editor.js';
import { setTileCallback, basemapAttribution } from './tiles.js';
import { notes, loadNotes, saveNotes, addNote, removeNote, hitNote, drawNotes } from './notes.js';
import { CRS, GeoRef, BASEMAPS, nameOf, crsById } from './proj.js';
import { t, setLang, getLang, applyI18n, LANGS, langInfo, resolveLang } from './i18n.js';
import { askText, askConfirm, askForm, isOpen as askOpen, cancel as askCancel } from './dialog.js';
import { initEditor, onScene as editorScene, tap as editorTap, back as editorBack, overlay as editorOverlay, onResize as editorResize, onTheme as editorTheme, editor } from './editor.js';
import * as Docs from './docs.js';
import * as New from './newdoc.js';
import * as Drive from './drive.js';
import * as Open from './open.js';
import * as Arsiv from './arsiv.js';
import * as Ed from './edition.js';
import { pdfBelge, ilkelleriBas, kagit as PK, PT } from './pdfvec.js';
import * as Home from './home.js';
import * as Cloud from './cloud.js';
import * as Pen from './stylus.js';
import * as Desk from './desktop.js';
import { writeDxf, aciOf } from './edit.js';
import { dwgObjectCount } from './dwgstat.js';
import { skelList, emptyBox } from './skel.js';
import * as Osnap from './osnap.js';
import * as Trk from './otrack.js';

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
const settings = Object.assign({ lang: 'auto', dark: true, lwScale: 3, crs: 'NONE', unit: 'auto', swap: false, dx: 0, dy: 0, basemap: 'none', basemapUrl: '', wms: '', opacity: 0.8, prec: 3, precPad: false, snap: Osnap.DEFAULT_MODES.slice(), snapOpt: { ...Osnap.OPT_DEFAULTS } }, store.json('settings', {}));
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
  const L = [`DWG OfficeZip ${A() && A().versionCode ? 'v' + A().versionCode() : ''} — katı tanılaması`, `Dosya: ${S.fileName}  Sürüm: ${S.version}`,
    `Sahne varlık türleri: ${JSON.stringify(S.counts || {})}`, `DWG nesne türleri (LibreDWG): ${JSON.stringify((S.scene && S.scene.census) || {})}`,
    `Katı: ${d.solids}  Yüzey: ${d.faces} (yaklaşık ${d.approx})  Atlanan: ${d.skipped}`, `Yüzey türleri: ${JSON.stringify(d.surfaces)}`, `ACIS sürümleri: ${d.versions.join(', ') || '-'}`,
    `Bilinmeyen SAB etiketleri: ${d.unknownTags.join(' ') || '-'}`, `AcDs: ${JSON.stringify(d.acds)}`, 'Hatalar:', ...d.errors.map(e => '  ' + e), 'Katılar:'];
  for (const s2 of d.samples || []) L.push(`  ${s2.handle}: acis ${s2.acisType || '-'} ${s2.acisBytes} B, tel ${s2.wires}, mesh ${s2.mesh}`);
  for (const s2 of d.samples || []) if (s2.b64) L.push('', `--- ${s2.handle} ${s2.acisType} ilk ${Math.min(49152, s2.acisBytes)} bayt (base64) ---`, s2.b64);
  return L.join('\n');
}

function saveSettings() { store.set('settings', JSON.stringify(settings)); }
let displayApplied = false;
/** Sözlükle kurulan, data-i18n dışında kalan kabuk metinleri. Dil dosyası sonradan geldiğinde de çalışır. */
function relocalize() {
  if (Ed.isProPanelOpen()) Ed.openProPanel();   // açık Pro paneli gövdesi (özellik listesi, fiyat, düğmeler) t() ile kurulur: dil değişince yeniden çizilir
  if (!S.hasDoc) $('fileName').textContent = t('noFile');
}
// Türkçe ile İngilizce gömülüdür; öteki diller lang/<kod>.js ile sonradan gelir ve i18n 'dwg:lang'i yeniden yayınlar
window.addEventListener('dwg:lang', relocalize);
function applySettings() {
  const lang = setLang(settings.lang); applyI18n();
  try { window.dispatchEvent(new CustomEvent('dwg:lang', { detail: { lang } })); } catch (_) { relocalize(); }   // olay: ana ekran (araç adları, bulut kartları) ve kabuk metinleri yeniden çizilir
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
  S.prec = clampPrec(settings.prec); S.precPad = !!settings.precPad;
  if (!settings.snapExt) {   // v7.70 öncesi kaydedilmiş yakalama listesinde EXT yoktu (AutoCAD varsayılanı 4133'te vardır): bir kez eklenir
    if (Array.isArray(settings.snap) && settings.snap.length && !settings.snap.includes('ext')) settings.snap.push('ext');
    settings.snapExt = true; saveSettings();
  }
  S.snapModes = new Set((settings.snap || []).filter(m => Osnap.MODES.some(x => x.id === m)));
  Osnap.renderBar($('snapBar'));
}
/** birim çarpanı → kısa ad (ayarlardaki seçeneklerle aynı küme) */
const BIRIM_ADI = { 0.001: 'mm', 0.01: 'cm', 0.1: 'dm', 1: 'm', 1000: 'km' };
/*
 * ÇİZİM BİRİMİ AYARI ÇİZİMİN KENDİSİNE DE UYGULANIR.
 *
 * Eskiden bu seçim yalnız GeoRef'e gidiyordu: ölçek çipi (1:N), ızgara etiketi, ölçüm sonuçlarının
 * metre karşılığı ve PDF ölçeği S.unitToM'dan beslendiği için OLDUĞU GİBİ KALIYORDU. Yani INSUNITS
 * yazmayan bir DWG'de uygulama "Ölçek için çizim birimi gerekli (Ayarlar › Çizim birimi)" diyor,
 * kullanıcı oradan birimi seçiyor ve hiçbir şey değişmiyordu. Artık seçim S.unitToM'u da kurar;
 * "Çizimden" seçeneği dosyanın kendi INSUNITS değerine döner.
 */
function applyGeo() {
  const g = S.fileKey ? store.json('geo:' + S.fileKey, null) : null;
  const src = g || settings;
  const secilen = src.unit && src.unit !== 'auto' ? Number(src.unit) : 0;
  if (secilen > 0) { S.unitToM = secilen; S.units = BIRIM_ADI[secilen] || S.units; }
  else if (S.unitToMDosya != null) { S.unitToM = S.unitToMDosya; S.units = S.unitsDosya || ''; }
  const unitToM = secilen > 0 ? secilen : (S.unitToM || 1);
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
  statusFit();
}
/*
 * Her düğme dokunulduğunda kısa bir vurgu halkası alır (bkz. app.css .tap-flash). Tek bir
 * yakalama aşaması dinleyicisi bütün düğmeleri kapsar: şerit karoları, sekmeler, kalıcı Seç
 * düğmesi, durum çubuğu düğmeleri, yüzen düğmeler ve çipler. Dinleyici edilgendir ve hiçbir
 * olayı yutmaz; yalnız sınıf ekler. Sınıf, canlandırma bitince — canlandırma hiç çalışmazsa
 * (durgun kip, düşük güç) zaman aşımıyla — kaldırılır, yoksa halka takılı kalırdı.
 */
const TAP_SEC = 'button, .fab, .chip, [role="button"]';
document.addEventListener('pointerdown', (ev) => {
  const b = ev.target && ev.target.closest ? ev.target.closest(TAP_SEC) : null;
  if (!b || b.disabled || b.classList.contains('tap-flash')) return;
  b.classList.add('tap-flash');
  let zaman = 0;
  const bit = () => { clearTimeout(zaman); b.classList.remove('tap-flash'); b.removeEventListener('animationend', bit); };
  b.addEventListener('animationend', bit);
  zaman = setTimeout(bit, 700);
}, { capture: true, passive: true });
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
let zoomWin = null; // { pending:true, cb?, iptal? } | { x0,y0,x1,y1, cb?, iptal? } (ekran px)
/**
 * Ekranda dikdörtgen seçtirir. Tek kullanıcısı YAKINLAŞTIRMA DEĞİLDİR: cb verilirse seçilen
 * dünya dikdörtgeni ona gider ve görünüm değişmez — PDF'te "basılacak alanı pencereyle seç"
 * (AutoCAD PLOT › Window) bu yolla çalışır.
 * @param cb (bb:[x0,y0,x1,y1]) => void — verilmezse seçilen pencereye yakınlaşılır
 * @param o  { ipucu, iptal }
 */
function alanSec(cb, o = {}) {
  if (!S.hasDoc) { toast(t('openFirst')); return false; }
  if (editor.tools && editor.tools.running) { toast(tt('toolBusy', 'Önce çalışan aracı bitirin.')); return false; }
  /*
   * 3B GÖRÜNÜMDE DE ÇALIŞIR (v8.0). 3B tuvali işaretçi olaylarını kendi tutar (stopPropagation),
   * bu yüzden dikdörtgeni orada editor çizer (ed.alan3) ve köşeleri zemin düzlemine düşürerek
   * dünya dikdörtgenini verir. Komut çubuğundaki istem, "köşeyi geri al" ve iptal iki görünümde
   * de buradadır — kullanıcı için tek akıştır.
   */
  const uc = editor.is3D();
  if (uc) {
    const ok = edCall('alan3', {
      cb: (bb) => { const f = zoomWin && zoomWin.cb; cancelZoomWindow(); if (f) f(bb); },
      iptal: o.iptal || null,
      adim: () => { if (zoomWin) { zoomWin = { ...zoomWin, pending: false, iki: true }; zwIstem(); } },
    });
    if (!ok) { toast(tt('zoomWin3d', 'Pencere yakınlaştırma 2B görünümde çalışır.')); return false; }
  }
  zoomWin = { pending: true, iki: false, uc, x0: null, y0: null, x1: null, y1: null, bas: null, cb: cb || null, iptal: o.iptal || null, ipucu: o.ipucu || '' };
  edCall('cmdTakeOver');
  zwIstem();
  return true;
}
/*
 * PENCERE İKİ KÖŞEYE DOKUNARAK DA KURULUR. Sürükleme küçük ekranda zordur: parmak hedefi örter
 * ve uzun kenar boyunca sürüklerken köşe kaçar. Artık köşeye DOKUNMAK yeter — birinci dokunuş
 * köşeyi bırakır, ikinci dokunuş pencereyi kapatır; arada lastik dikdörtgen parmağı izler.
 * İki yol da aynı yerde biter (zwBitir), böylece sürükleme ile dokunuş aynı pencereyi verir.
 * Köşe konarken BÜYÜTEÇLİ NİŞAN çalışır: parmak kıpırdamadan beklerse imleç parmağın dışına
 * çıkar, altındaki yer büyüteçte görünür (aimMove / drawPenHover) ve bırakışta nokta oradan
 * alınır. Nesne yakalama da açıksa köşe yakalama noktasına oturur — "pastanın üst köşesinden
 * alt köşesine" dendiğinde kastedilen budur.
 */
/** Komut çubuğu istemi: birinci köşeden önce ve sonra ayrı metin, ayrı düğmeler */
function zwIstem() {
  if (!zoomWin) return;
  const bar = $('cmdBar'); bar.hidden = false;
  $('cmdText').textContent = zoomWin.iki ? tt('zoomWinHint2', 'Pencere: ikinci köşeye dokunun')
    : (zoomWin.ipucu || tt('zoomWinHint', 'Pencere: köşeleri sürükleyin ya da iki köşeye dokunun'));
  $('cmdInput').hidden = true;
  $('cmdBtns').innerHTML = (zoomWin.iki ? `<button data-zw="geri">↶ ${esc(tt('zoomWinBack', 'Köşeyi geri al'))}</button>` : '')
    + `<button data-zw="cancel">✕ ${esc(t('cancel'))}</button>`;
  $('cmdBtns').onclick = (ev) => {
    const b = ev.target.closest('[data-zw]'); if (!b) return;
    if (b.dataset.zw === 'geri') {
      if (zoomWin) {
        if (zoomWin.uc) edCall('alan3Geri');
        zoomWin = { ...zoomWin, pending: true, iki: false, x0: null, y0: null, x1: null, y1: null, bas: null }; zwIstem(); drawOverlay();
      }
      return;
    }
    const f = zoomWin && zoomWin.iptal; cancelZoomWindow(); if (f) f();
  };
}
/** Köşenin ekran noktası: nesne yakalama açıksa köşe yakalanan noktaya oturur */
function zwNokta(sx, sy) {
  if (!(S.snapModes && S.snapModes.size)) return [sx, sy];
  let sn = null;
  try { sn = findSnap(toWorld(sx, sy), { hover: true }); } catch (_) { sn = null; }
  if (sn && sn.p && isFinite(sn.p[0]) && isFinite(sn.p[1])) { const q = toScreen(sn.p[0], sn.p[1]); return [q[0], q[1]]; }
  return [sx, sy];
}
/** Köşe dokunuşu: birincisini bırakır, ikincisiyle pencereyi kapatır */
function zwKose(sx, sy) {
  if (!zoomWin) return false;
  const [px, py] = zwNokta(sx, sy);
  if (!zoomWin.iki) {
    zoomWin = { ...zoomWin, pending: false, iki: true, x0: px, y0: py, x1: px, y1: py, bas: null };
    haptic('step'); zwIstem(); drawOverlay(); return true;
  }
  zwBitir(px, py);
  return true;
}
/** Pencereyi kapatır: yeterince büyükse çağırana gider, değilse söyler */
function zwBitir(sx, sy) {
  const zw = zoomWin;
  if (!zw || zw.x0 == null) { cancelZoomWindow(); return; }
  cancelZoomWindow();
  const g = Math.abs(sx - zw.x0), y = Math.abs(sy - zw.y0);
  const a = toWorld(Math.min(sx, zw.x0), Math.max(sy, zw.y0)), b = toWorld(Math.max(sx, zw.x0), Math.min(sy, zw.y0));
  if (!(g > 20 && y > 20)) {
    toast(tt('pdfWinSmall', 'Pencere çok küçük; köşeleri biraz daha ayırın.'), { type: 'warn' });
    if (zw.cb && zw.iptal) zw.iptal();
    requestRender(); return;
  }
  haptic('step');
  if (zw.cb) zw.cb([a[0], a[1], b[0], b[1]]);          // alan seçimi: görünüm DEĞİŞMEZ
  else { fitView([a[0], a[1], b[0], b[1]], 1); viewHistory.push(); }
  requestRender();
}
function zoomWindow() { alanSec(null); }
/*
 * KAYDIR (PAN) — AutoCAD'in PAN komutu (kısaltması P), dokunmatikte asıl karşılığı olan düğme.
 * Parmak zaten boşlukta sürükleyince kaydırır; kip şunun için vardır: bir ARAÇ ya da SEÇİM
 * sürerken sürükleme artık kaydırmaz (tutamak taşır, örtük pencere açılır, not çizer). Kip
 * açıkken sürükleme yeniden YALNIZ görünümü kaydırır, bırakışta seçim de yapılmaz; AutoCAD'in
 * saydam PAN'ı gibi, kullanıcı kapatana dek (düğme, karo ya da Esc) sürer.
 * 3B'de kip yoktur: orada tek parmağın işi zaten bir ayardır (view3d touch.oneFinger), düğme
 * onu döndür ↔ kaydır arasında çevirir ve ayar kalıcıdır.
 */
function panOn() {
  if (editor.is3D()) { const v = edCall('view3d'); return !!(v && v.opts && v.opts.touch && v.opts.touch.oneFinger === 'pan'); }
  return !!S.panMode;
}
function togglePan(on) {
  const hedef = on === undefined || on === null ? !panOn() : !!on;
  /*
   * Kaydır AÇILIRKEN çalışan ne varsa düşer: pencere seçimi, 2B aracı, 3B komutu. Üçü de aynı
   * sürüklemeyi ister; birlikte açık kalırlarsa kaydırma çalışmıyor görünür. Kapatırken hiçbir
   * şeye dokunulmaz — kullanıcı kaydırmayı bırakıp kaldığı yerden devam edebilsin.
   */
  if (hedef) { if (zoomWin) cancelZoomWindow(); edCall('komutIptal'); }
  if (editor.is3D()) {
    const v = edCall('view3d');
    if (!v) return false;
    v.set('touch.oneFinger', hedef ? 'pan' : 'orbit');
    toast(hedef ? tt('panOn3', 'Kaydır: tek parmak görünümü kaydırır') : tt('panOff3', 'Döndür: tek parmak görünümü döndürür'), 2000);
  } else {
    if (!S.hasDoc) { toast(t('openFirst')); return false; }
    if (hedef === S.panMode) return hedef;
    S.panMode = hedef;
    toast(hedef ? tt('panOnMsg', 'Kaydır açık: sürükleyin. Kapatmak için düğmeye yeniden dokunun (Esc).') : tt('panOffMsg', 'Kaydır kapalı'), 2200);
  }
  haptic('toggle');
  edCall('refreshTiles'); edCall('syncQuick'); refreshNav(); drawOverlay();
  return hedef;
}
function cancelZoomWindow() {
  if (!zoomWin) return false;
  const uc = zoomWin.uc;
  zoomWin = null;
  if (uc) edCall('alan3Iptal');   // 3B dikdörtgeni de kalkar (iptal işlevi çağrılmaz, çağıran karar verir)
  const bar = $('cmdBar'); if ($('cmdBtns').onclick) { $('cmdBtns').onclick = null; }
  // Çubuğu gizlemek yerine devri geri ver: komut satırı açıksa boştaki isteme döner.
  if (!(editor.tools && editor.tools.running) && !editor.m3) { bar.hidden = true; edCall('cmdRelease'); }
  drawOverlay();
  return true;
}

// ---- kaplama -------------------------------------------------------------------
let noteDraft = null, selectedNote = null;
const photos = new Map(); // photo id → {img, ok}

/** Kaplama için dünya dönüşümü: render.js ile aynı köken (görünüm merkezi); tracePath yerel koordinat üretir */
function worldTransform(c) { renderWorldTransform(c, ov); }
/** Dünya kutusunu yerel koordinatla çizer (bb: [x0, y0, x1, y1]) */
/*
 * VURGU KUTUSU. Nokta ilkelinin sınır kutusu SIFIR BOYUTLUDUR (POINT → bb: [x, y, x, y]);
 * olduğu gibi çizilen dikdörtgen ekranda hiç görünmez ve kullanıcı noktayı seçip seçmediğini
 * anlayamaz — v7.85'e kadarki davranış buydu. Kutu, EKRANDA en az VURGU_PX olacak biçimde
 * ortasından şişirilir; kendi kutusu zaten büyük olan nesneler etkilenmez. Üç çağıran da
 * (seçim, tek seçim, üzerine gelme) buradan geçtiği için düzeltme hepsinde geçerlidir.
 */
const VURGU_PX = 18;
function strokeWorldRect(c, bb) {
  const [ox, oy] = worldOrigin();
  const en = VURGU_PX / (S.view.scale || 1);
  let x0 = bb[0], y0 = bb[1], x1 = bb[2], y1 = bb[3];
  if (!(x1 - x0 >= en)) { const cx = (x0 + x1) / 2; x0 = cx - en / 2; x1 = cx + en / 2; }
  if (!(y1 - y0 >= en)) { const cy = (y0 + y1) / 2; y0 = cy - en / 2; y1 = cy + en / 2; }
  c.strokeRect(x0 - ox, y0 - oy, x1 - x0, y1 - y0);
}
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
  drawSnapPick(c);
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
    if (S.snap) drawSnapMark(c, S.snap, '#3ddc84');
  }
  // Dokunuşla yakalanan nokta kısa süre işaretli kalır (AutoCAD'in AutoSnap işareti): parmak kalkınca
  // kullanıcı neyin yakalandığını görsün. Her kipte (çizim, ölçü, düzenleme) aynı işaret.
  if (S.snapFlash && S.snapFlash.until > performance.now() && !(S.mode === 'measure' && S.snap) && !pickingObject()) { drawSnapMark(c, S.snapFlash, '#3ddc84'); if (S.snapFlash.trk) drawTrackPaths(c, S.snapFlash.trk, '#3ddc84', 0.55); }   // izle oturan dokunuşta yol da kısa süre görünür (parmakla dokunan kullanıcı hangi hizaya oturduğunu görsün)
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
  if (zoomWin && zoomWin.x0 != null) {
    c.strokeStyle = '#f5b342'; c.lineWidth = 1.5; c.fillStyle = 'rgba(245,179,66,.12)';
    if (zoomWin.x1 != null) {
      c.setLineDash([6, 4]);
      const x = Math.min(zoomWin.x0, zoomWin.x1), y = Math.min(zoomWin.y0, zoomWin.y1), w = Math.abs(zoomWin.x1 - zoomWin.x0), h = Math.abs(zoomWin.y1 - zoomWin.y0);
      c.fillRect(x, y, w, h); c.strokeRect(x, y, w, h); c.setLineDash([]);
    }
    // Konmuş birinci köşe: ikinci köşe beklenirken nerede olduğu görünsün
    if (zoomWin.iki) { const k = 8; c.beginPath(); c.moveTo(zoomWin.x0 - k, zoomWin.y0); c.lineTo(zoomWin.x0 + k, zoomWin.y0); c.moveTo(zoomWin.x0, zoomWin.y0 - k); c.lineTo(zoomWin.x0, zoomWin.y0 + k); c.stroke(); }
  }
  drawTrack(c);
  drawCrosshair(c, fg);
  drawPenHover(c, fg);
  if (S.ui2d.scaleBar) drawScaleBar(c, fg);
  if (S.ui2d.north) drawNorth(c, fg);
  if (S.rulers) drawRulers(c, fg);
  const attr = basemapAttribution();
  if (attr && S.geo.active && S.basemap.id !== 'none') { c.font = '10px sans-serif'; c.fillStyle = fg; c.globalAlpha = 0.7; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(attr, S.W - 6, S.H - 4 - kaplamaPayi().alt); c.globalAlpha = 1; c.textAlign = 'left'; }
}
/*
 * KAPLAMANIN GÜVENLİ PAYI.
 *
 * Ölçek çubuğu, kuzey oku ve altlık künyesi #ov tuvalinin KENARINA çizilir. Komut çubuğu, komut
 * önerisi şeridi ve "Komut satırı" düğmesi ise tuvali kısaltmaz, ÜSTÜNE biner (position: absolute,
 * #viewport içinde). Bu yüzden S.H - 14'e çizilen ölçek çubuğu komut çubuğunun altında kalıyor,
 * kullanıcıya yalnız "2 m" yazısının tepesi görünüyordu. Pay her karede DOM'dan okunur: hangi öğe
 * açıksa o kadar yer bırakılır, kapanınca kendiliğinden sıfırlanır — sabit sayı yazılmaz, çünkü
 * çubuğun yüksekliği yazı ölçeğine ve satır sayısına göre değişir.
 */
const KAPLAMA_ORTEN = ['cmdBar', 'cmdSug', 'cmdShow'];
function kaplamaPayi() {
  let ust = 0, alt = 0;
  try {
    const b = vp.getBoundingClientRect();
    for (const id of KAPLAMA_ORTEN) {
      const e = $(id); if (!e || e.hidden || !e.offsetParent) continue;
      const q = e.getBoundingClientRect(); if (!(q.height > 0)) continue;
      const y0 = q.top - b.top, y1 = q.bottom - b.top, orta = (y0 + y1) / 2;
      if (orta > S.H * 0.6) alt = Math.max(alt, S.H - y0 + 6);
      else if (orta < S.H * 0.4) ust = Math.max(ust, y1 + 6);
    }
  } catch (_) { /* ölçülemedi: pay yok */ }
  return { ust, alt };
}
function drawScaleBar(c, fg) {
  const unitM = S.unitToM || 0;
  const targetPx = Math.min(140, S.W * 0.3);
  const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; };
  const len = nice(targetPx / S.view.scale);
  const px = len * S.view.scale;
  const x0 = uiPrefs().leftHand ? S.W - 12 - px : 12, y0 = S.H - 14 - kaplamaPayi().alt;   // komut çubuğunun altında kalmasın
  c.fillStyle = S.dark ? 'rgba(20,26,34,.7)' : 'rgba(255,255,255,.75)'; c.fillRect(x0 - 6, y0 - 18, px + 12, 24);
  c.strokeStyle = fg; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + px, y0); c.moveTo(x0, y0 - 6); c.lineTo(x0, y0); c.moveTo(x0 + px, y0 - 6); c.lineTo(x0 + px, y0); c.stroke();
  let txt;
  if (unitM) { const m = len * unitM; txt = m >= 1000 ? fmt(m / 1000, 2) + ' km' : m >= 1 ? fmt(m, 2) + ' m' : fmt(m * 100, 2) + ' cm'; }
  else txt = fmt(len) + (S.units ? ' ' + S.units : '');
  c.font = '11px sans-serif'; c.fillStyle = fg; c.textBaseline = 'bottom'; c.textAlign = 'left'; c.fillText(txt, x0 + 4, y0 - 3);
}
/*
 * KUZEY OKUNUN TARAFI SOL EL DÜZENİNİ İZLER (v8.6).
 *
 * Ölçek çubuğu (drawScaleBar) ve 3B pusulası (view3d.drawHud) sol el düzeninde taraf
 * değiştiriyor, 2B kuzey oku ise sağ üst köşede çakılı kalıyordu: kullanıcı 2B ile 3B arasında
 * gidip geldiğinde pusula bir sağda bir solda çıkıyordu. Artık ikisi de aynı kuralı kullanır —
 * ok ekranın DIŞ ÜÇTE BİRİNDE, sol el düzeninde solda durur.
 *
 * İki pay eklenir: cetveller açıkken şerit 18 px yer kaplar (üstte y'ye, solda x'e de) ve
 * komut çubuğu tuvalin üstüne bindiğinde kaplamaPayi().ust kadar aşağı inilir.
 *
 * Gezinti sütunu (#navFabs) alttan yukarı büyür; yatay ekranda yedi düğme köşeye dayanabilir.
 * Seçilen tarafta çakışma varsa ve öbür taraf boşsa ok öbür tarafa geçer — 3B pusulasındaki
 * aday sırasının 2B karşılığı. İki taraf da doluysa seçilen tarafta kalır (ok her hâlükârda
 * çizilir; çizilmemesi kullanıcıya kuzeyi kaybettirirdi).
 */
function kuzeyYeri() {
  const big = S.ui2d.northBig ? 44 / 28 : 1;
  const cetvel = S.rulers ? 18 : 0;
  const r = 18 * big, cy = 30 * big + cetvel + kaplamaPayi().ust;
  const sol = !!uiPrefs().leftHand;
  const solX = 26 * big + cetvel, sagX = S.W - 26 * big;
  const engeller = [];
  try {
    const b = vp.getBoundingClientRect();
    for (const id of ['navFabs', 'dpad']) {
      const e = $(id); if (!e || e.hidden || !e.offsetParent) continue;
      const q = e.getBoundingClientRect(); if (!(q.width > 0 && q.height > 0)) continue;
      engeller.push({ x: q.left - b.left, y: q.top - b.top, w: q.width, h: q.height });
    }
  } catch (_) { /* ölçülemedi: engel yok sayılır */ }
  const pay = 6;
  const carpisir = (cx) => engeller.some(g => cx + r + pay > g.x && cx - r - pay < g.x + g.w && cy + r + pay > g.y && cy - r - pay < g.y + g.h);
  let cx = sol ? solX : sagX;
  const oteki = sol ? sagX : solX;
  if (carpisir(cx) && !carpisir(oteki)) cx = oteki;
  return { cx, cy, r, big };
}
function drawNorth(c, fg) {
  const { cx, cy, big } = kuzeyYeri();
  c.save(); c.translate(cx, cy); c.scale(big, big);
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
/*
 * İMLEÇ — AutoCAD'in üç hâli aynen alınmıştır:
 *   NOKTA istemi (çizim, taban noktası, ötele tarafı…) → artı imleç, nesne yakalama ÇALIŞIR
 *   NESNE istemi ("Select objects:")                   → küçük kare (pickbox), yakalama ÇALIŞMAZ
 *   boşta (komut yok)                                  → artı + pickbox (sonraki dokunuş nesne seçer)
 * Karenin yarı boyu gerçek seçim toleransıdır (TOL.pick): kare neyin üstündeyse o seçilir, kullanıcı
 * dokunmadan önce görür. Eldivende tolerans büyür, kare de onunla büyür.
 */
function pickingObject() { return !!edCall('pickingObject'); }
/** Kare yarı boyu: seçim toleransının YARISI (AutoCAD PICKBOX 3 ≈ 6 px). Parmak toleransı geniş kalır, imleç küçük. */
function pickBoxR() { return Math.max(4, Math.round(TOL.pick / 2 * Math.max(1, uiPrefs().fontScale || 1))); }
/*
 * Pickbox — AutoCAD imleci: küçük kare + kareye DEĞMEYEN artı kolları (kare içi boş kalır, altındaki
 * nesne görünür). Kollar "Artı imleç" ayarına uyar: Kapalı → yalnız kare · Küçük → kısa kollar ·
 * Tam ekran → kenara kadar. Çift çizgi (halo + çizgi) koyu zeminde de açık zeminde de okunur.
 * k: büyütme (büyüteç içinde 2).
 */
function drawPickBox(c, x, y, fg, k = 1) {
  const r = pickBoxR() * k, X = Math.round(x) + 0.5, Y = Math.round(y) + 0.5;
  const gap = r + 3 * k, arm = S.crosshair === 'full' ? Math.max(S.W, S.H) : S.crosshair === 'off' ? 0 : 12 * k;
  const kollar = () => { c.beginPath(); c.moveTo(X - gap, Y); c.lineTo(X - gap - arm, Y); c.moveTo(X + gap, Y); c.lineTo(X + gap + arm, Y); c.moveTo(X, Y - gap); c.lineTo(X, Y - gap - arm); c.moveTo(X, Y + gap); c.lineTo(X, Y + gap + arm); c.stroke(); };
  c.save(); c.setLineDash([]);
  c.strokeStyle = S.dark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.8)'; c.lineWidth = 3;
  c.strokeRect(X - r, Y - r, r * 2, r * 2); if (arm && S.crosshair !== 'full') kollar();
  c.strokeStyle = fg; c.lineWidth = 1; c.globalAlpha = 0.95;
  c.strokeRect(X - r, Y - r, r * 2, r * 2); if (arm) { if (S.crosshair === 'full') c.globalAlpha = 0.5; kollar(); }
  c.restore();
}
/** Karenin altındaki nesnenin kesik çizgiyle vurgulanması (AutoCAD rollover): hangisi seçilecek belli olsun */
function drawRollover(c, p) {
  c.save(); worldTransform(c);
  c.strokeStyle = S.selColor || '#ff9f0a'; c.lineWidth = 1.8 / S.view.scale; c.globalAlpha = 0.85;
  c.setLineDash([6 / S.view.scale, 4 / S.view.scale]);
  if (p.k === 0) { c.beginPath(); tracePath(c, p.ops); if (p.closed) c.closePath(); c.stroke(); }
  else strokeWorldRect(c, p.bb);
  c.restore(); c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
}
/** Artı imleç: araç ya da ölçü modu çalışırken son dokunma/yakalama noktasında */
function drawCrosshair(c, fg) {
  if (!S.lastPoint) return;
  if (penHover && penHover.w) return;   // TEK imleç: kalem / fare / parmak gezinirken canlı imleç odur, son dokunuşta ikinci bir kare durmaz
  const running = (editor.tools && editor.tools.running) || S.mode === 'measure' || S.mode === 'profile';
  if (!running) return;
  const s = toScreen(S.lastPoint[0], S.lastPoint[1]);
  // Nesne seçiliyor: artı yok, kare var. Dokunmatikte imleç parmağı izlemez; kare son dokunuşta
  // durur ve seçimin ne kadar yakınından tuttuğunu gösterir. Ayardaki "Artı imleç: Kapalı" kareyi
  // kapatmaz — AutoCAD'de de CURSORSIZE ile PICKBOX ayrı değişkenlerdir.
  if (pickingObject()) { drawPickBox(c, s[0], s[1], fg); return; }
  if (S.crosshair === 'off') return;
  c.strokeStyle = fg; c.lineWidth = 1; c.setLineDash([]); c.globalAlpha = 0.5;
  c.beginPath();
  if (S.crosshair === 'full') { c.moveTo(0, s[1] + 0.5); c.lineTo(S.W, s[1] + 0.5); c.moveTo(s[0] + 0.5, 0); c.lineTo(s[0] + 0.5, S.H); }
  else { c.moveTo(s[0] - 12, s[1] + 0.5); c.lineTo(s[0] + 12, s[1] + 0.5); c.moveTo(s[0] + 0.5, s[1] - 12); c.lineTo(s[0] + 0.5, s[1] + 12); }
  c.stroke(); c.globalAlpha = 1;
  if (S.crosshair === 'full') { c.font = '11px system-ui, sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left'; const txt = fmt(S.lastPoint[0]) + ' ; ' + fmt(S.lastPoint[1]); const w = c.measureText(txt).width + 8; c.fillStyle = S.dark ? 'rgba(20,26,34,.85)' : 'rgba(255,255,255,.85)'; c.fillRect(s[0] + 8, s[1] - 22, w, 18); c.fillStyle = fg; c.fillText(txt, s[0] + 12, s[1] - 6); }
}
/*
 * HAVADA GEZİNEN KALEM UCU. Üç şey gösterilir: nereye düşeceği (artı), hangi noktaya
 * yakalanacağı (yakalama işareti) ve o noktanın koordinatı. Kesikli çizilir — bu bir SEÇİM
 * ya da ölçüm değil, henüz yapılmamış bir dokunuşun önizlemesidir; dolu çizgi "oldu" derdi.
 */
/** Yakalama işareti + kısaltma etiketi (glif osnap.js'ten: menüdekiyle aynı çizim) */
function drawSnapMark(c, sn, col) {
  const s = toScreen(sn.p[0], sn.p[1]);
  c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2; c.setLineDash([]);
  Osnap.drawMarker(c, s[0], s[1], sn.kind, 8);
  c.font = 'bold 10px sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left';
  c.fillText(Osnap.abbrOf(sn.kind), s[0] + 11, s[1] - 10);
  c.restore();
}
/*
 * NESNE YAKALAMA İZLEME (AutoCAD object snap tracking, F11). Geometri otrack.js'te (saf); burada edinme,
 * temizleme ve çizim vardır. EDİNME: gezinen imleç (kalem / fare / parmakla nişan) bir yakalama noktasının
 * üstünde DWELL_MS bekleyince nokta edinilir ve küçük bir artı (+) ile işaretlenir; aynı noktada yeniden
 * bekleyince bırakılır (AutoCAD'deki gibi). Dokunmatikte İz noktası (TT) düğmesi dokunuşla edinir. Edinilmiş
 * noktalar nokta verilince, araç bitince / iptalde, kip değişince ve iz kapatılınca silinir — AutoCAD'de de
 * nokta belirlenince temizlenir. Hizalama findSnap içindedir: nesne yakalaması (en yakın dışında) izi yener.
 */
let dwell = null, dwellTimer = 0;
const TRK_SKIP = new Set(['nea', 'ext', 'par', 'trk', 'tk']);   // kayan / türetilmiş noktalar edinilmez: sabit bir nokta değildir
function trackClear() { if (S.track.pts.length) { S.track.pts = []; drawOverlay(); } trackDwell(null); }
/** Noktayı edinir ya da (addOnly değilse ve zaten varsa) bırakır; en çok 7 nokta (otrack.js). → eklendi mi */
/*
 * Edinilen noktanın UZANTI geometrisi (AutoCAD Extension): noktada biten doğru parçalarının dışa doğrultuları ve ucu
 * olduğu yayların çemberleri. Nokta bir köşeyse (polyline) iki doğrultu çıkar; parçanın öteki ucundan bu uca doğru
 * yön, uçtan dışarı devam eder — parçanın kendisi nesnedir, oraya yakalama bakar. Adayalar noktanın çevresinden alınır.
 */
function trackGeo(p) {
  const eps = Math.max(1e-9, (TOL.snap / S.view.scale) * 0.05), dirs = [], arcs = [];
  const near = (x, y) => Math.hypot(x - p[0], y - p[1]) <= eps;
  for (const q of candidates(p, eps)) {
    if (q.k !== 0 || !q.ops) continue;
    let sg; try { sg = segmentsOf(q); } catch (_) { continue; }
    for (const s of sg.segs) {
      const a = [s[0], s[1]], b = [s[2], s[3]], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-9) continue;
      if (near(b[0], b[1])) dirs.push(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI);
      if (near(a[0], a[1])) dirs.push(Math.atan2(a[1] - b[1], a[0] - b[0]) * 180 / Math.PI);
    }
    for (const o of sg.arcs) {
      const cx = o[1], cy = o[2], r = o[3];
      if (!(r > 0)) continue;
      if (near(cx + r * Math.cos(o[4]), cy + r * Math.sin(o[4])) || near(cx + r * Math.cos(o[5]), cy + r * Math.sin(o[5]))) arcs.push({ c: [cx, cy], r });
    }
  }
  return { dirs, arcs };
}
/*
 * ÖRTÜK UZANTI (v7.73): aracın TABAN noktası (son alınan nokta; ölçümde önceki nokta) bir parçanın ucuysa o parçanın
 * uzantısı edinme gerekmeden yoldur. Masaüstünde AutoCAD kullanıcısı ucun üstünde bekleyip edinir; dokunmatikte
 * bekleme yoktur, uca dokunup çizgiyi kendi doğrultusunda sürdürmek istenir. Yalnız EXT kipi açıkken; nokta zaten
 * edinilmişse (TT ya da bekleme) o kayıt esastır, örtük olan eklenmez. Geometri taban ve ağaç değişmedikçe önbellekte.
 */
let baseExt = null;
function trackBase(prev) {
  if (!Osnap.opt().otrack) return null;   // yakalama izi (F11) kapalıysa örtük uzantı da yok; EXT kipine bağlı değil (v7.74)
  const base = prev || edCall('lastToolPoint');
  if (!base || !isFinite(base[0]) || !isFinite(base[1])) return null;
  const key = Trk.keyOf(base);
  if (S.track.pts.some(q => q.key === key)) return null;
  if (!baseExt || baseExt.key !== key || baseExt.tree !== S.tree || baseExt.n !== S.prims.length) baseExt = { key, tree: S.tree, n: S.prims.length, geo: trackGeo(base) };
  const g = baseExt.geo;
  if (!g.dirs.length && !g.arcs.length) return null;
  return { key: 'base:' + key, p: [base[0], base[1]], kind: 'end', dirs: g.dirs, arcs: g.arcs, extOnly: true, implicit: true };
}
function trackToggle(p, kind, addOnly) {
  const cur = S.track.pts;
  if (addOnly && cur.some(q => q.key === Trk.keyOf(p))) return false;
  const r = Trk.toggle(cur, p, kind, trackGeo(p));
  S.track.pts = r.list;
  haptic('snap');
  drawOverlay();
  return r.added;
}
/** Gezinen imlecin bekleme sayacı: aynı yakalama noktasında DWELL_MS kalınca edinme / bırakma; nokta değişince sıfırlanır */
function trackDwell(sn) {
  const ok = !!(sn && sn.p && Osnap.opt().otrack && !TRK_SKIP.has(sn.kind) && pointPrompt());
  const key = ok ? Trk.keyOf(sn.p) : null;
  if (dwell && dwell.key === key) return;            // aynı noktada bekleme sürüyor; tetiklendiyse yeniden tetiklenmez
  clearTimeout(dwellTimer); dwellTimer = 0; dwell = null;
  if (!key) return;
  dwell = { key, p: [sn.p[0], sn.p[1]], kind: sn.kind };
  dwellTimer = setTimeout(() => { dwellTimer = 0; if (!dwell || dwell.key !== key || !penHover) return; trackToggle(dwell.p, dwell.kind, false); }, Trk.DWELL_MS);
}
/**
 * Hizalama (findSnap'ten). Ortho / kutupsal açıkken ve aracın bir taban noktası varken imleç kilit doğrusundadır
 * (tools.kisitla); o zaman yalnız yolun kilit doğrusunu kestiği nokta alınır — "şu uçla aynı hizada bitecek çizgi".
 */
function trackAlign(w, tol, o) {
  const pts = o.imp ? S.track.pts.concat([o.imp]) : S.track.pts; if (!pts.length) return null;   // o.imp: örtük taban uzantısı (trackBase)
  // Uzantı yolları (doğrultu / çember) EXT yakalama kipine BAĞLI DEĞİLDİR (v7.74): edinilmiş noktanın uzantısı, kullanıcı o noktayı
  // bilerek edindiği için her zaman yoldur; EXT kipi yalnız geom.js'in edinmesiz uzantı yakalamasını yönetir. (v7.70–v7.73'te EXT
  // kapalıyken yol çıkmıyordu; v7.70 öncesi kaydedilmiş ayarlarda EXT kapalı kaldığından kullanıcı uzantı izini hiç göremedi.)
  const d = S.desk, opt = { ext: true }, angs = Trk.angles(!!d.polar, d.polarStep);
  let lock = null;
  if ((d.ortho || d.polar) && !o.grip && S.mode === 'view' && editor.tools && editor.tools.running) {
    const base = o.prev || edCall('lastToolPoint');
    const q = base ? edCall('constrainPoint', w) : null;
    if (base && q && (Math.abs(q[0] - w[0]) > 1e-12 || Math.abs(q[1] - w[1]) > 1e-12)) {
      const dx = q[0] - base[0], dy = q[1] - base[1], L = Math.hypot(dx, dy);
      if (L > 1e-9) lock = { base: [base[0], base[1]], dir: [dx / L, dy / L] };
    }
  }
  // KUTUPSAL izleme AutoCAD'de kısıt değil yardımdır (F10): imleç bir hizalama yoluna (uzantı, kesişim, edinilmiş noktanın
  // yolu) yakınsa o yol kazanır, kutupsal açı sonra gelir. ORTHO (F8) ise gerçek kısıttır: yalnız yolun kilit doğrusunu
  // kestiği nokta alınır. Kutupsalda önce serbest hizalama denenir; yoksa kilit doğrusuyla kesişim.
  if (lock && d.polar && !d.ortho) { const free = Trk.align(pts, w, tol, angs, null, opt); if (free) return free; }
  return Trk.align(pts, w, tol, angs, lock, opt);
}
/*
 * GENİŞLETİLMİŞ KESİŞİM (AutoCAD extended intersection): tek bir yol üstündeyken o yolun imleç yakınında gerçek bir
 * nesne parçasını kestiği nokta — INT (ya da APP) kipi açıkken. Çember yolları için alınmaz.
 */
function trackObjCross(tr, w, tol, cands) {
  if (!tr || tr.cross || !tr.paths || tr.paths.length !== 1 || tr.paths[0].arc || !(S.snapModes.has('int') || S.snapModes.has('app'))) return tr;
  const p = tr.paths[0], reach = Math.hypot(w[0] - p.pt[0], w[1] - p.pt[1]) + tol * 4;
  const ray = [p.pt[0], p.pt[1], p.pt[0] + p.dx * reach, p.pt[1] + p.dy * reach];
  let best = null;
  for (const q of cands) {
    if (q.k !== 0 || !q.ops) continue;
    let sg; try { sg = segmentsOf(q); } catch (_) { continue; }
    for (const s of sg.segs) {
      const X = segIntersect(ray, s); if (!X) continue;
      const dw = Math.hypot(X[0] - w[0], X[1] - w[1]);
      if (dw <= tol && Math.hypot(X[0] - p.pt[0], X[1] - p.pt[1]) > tol && (!best || dw < best.dw)) best = { X, dw };
    }
  }
  if (!best) return tr;
  return { ...tr, p: best.X, cross: true, obj: true, paths: [{ ...p, dist: Math.hypot(best.X[0] - p.pt[0], best.X[1] - p.pt[1]) }] };
}
/** Edinilmiş iz noktaları: küçük artı (AutoCAD'in "+" işareti), yalnız nokta isteminde */
function drawTrack(c) {
  const pts = S.track.pts;
  if (!pts.length || !pointPrompt()) return;
  c.save(); c.strokeStyle = S.selColor || '#ff9f0a'; c.lineWidth = 1.5; c.setLineDash([]); c.globalAlpha = 0.95;
  c.beginPath();
  for (const q of pts) { const s = toScreen(q.p[0], q.p[1]); const X = Math.round(s[0]) + 0.5, Y = Math.round(s[1]) + 0.5; c.moveTo(X - 6, Y); c.lineTo(X + 6, Y); c.moveTo(X, Y - 6); c.lineTo(X, Y + 6); }
  c.stroke();
  c.restore();
}
/** Hizalama yolları: edinilmiş noktadan geçen kesik çizgi, tam ekran (AutoCAD TRACKPATH 0); kilit doğrusu da çizilir */
function drawTrackPaths(c, tr, col, alpha) {
  if (!tr || !tr.paths || !tr.paths.length) return;
  const L = S.W + S.H;
  const dirS = (pt, dx, dy) => { const a = toScreen(pt[0], pt[1]), b = toScreen(pt[0] + dx, pt[1] + dy); const vx = b[0] - a[0], vy = b[1] - a[1], n = Math.hypot(vx, vy) || 1; return [a, vx / n, vy / n]; };
  c.save(); c.strokeStyle = col; c.lineWidth = 1; c.setLineDash([5, 4]); c.globalAlpha = alpha == null ? 0.8 : alpha;
  c.beginPath();
  for (const p of tr.paths) {
    if (p.arc) { const s = toScreen(p.arc.c[0], p.arc.c[1]), r = Math.min(p.arc.r * S.view.scale, 1e5); c.moveTo(s[0] + r, s[1]); c.arc(s[0], s[1], r, 0, TAU); continue; }   // yayın çemberi (uzantı)
    const [a, ux, uy] = dirS(p.pt, p.dx, p.dy);
    if (p.ext) { c.moveTo(a[0], a[1]); c.lineTo(a[0] + ux * L, a[1] + uy * L); continue; }   // uzantı yolu yalnız uçtan dışarı (AutoCAD)
    c.moveTo(a[0] - ux * L, a[1] - uy * L); c.lineTo(a[0] + ux * L, a[1] + uy * L);
  }
  if (tr.lockLine) { const [a, ux, uy] = dirS(tr.lockLine.base, tr.lockLine.dir[0], tr.lockLine.dir[1]); c.moveTo(a[0] - ux * L, a[1] - uy * L); c.lineTo(a[0] + ux * L, a[1] + uy * L); }
  c.stroke();
  c.restore();
}
/** İpucu metni (AutoCAD "Endpoint: 245.3 < 0°"): yolun kipi, edinilmiş noktadan uzaklık, yolun açısı; kesişimde iki yol */
function trkText(tr) {
  const one = (p) => (p.ext ? Osnap.abbrOf('ext') : Osnap.abbrOf(p.kind)) + ' ' + fmt(p.dist) + (p.deg == null ? '' : ' < ' + fmt(p.deg, 0) + '°');
  return tr.paths.map(one).join(' · ') + (tr.obj ? ' × ' + Osnap.abbrOf('int') : '');   // uzantı yolu EXT; nesneyle genişletilmiş kesişim × INT
}
/*
 * DİNAMİK OKUMA (AutoCAD dynamic input): bir taban nokta varken (çalışan aracın son noktası ya da ölçümün önceki noktası)
 * imlecin yanındaki kutuya taban noktadan uzaklık ve açı da yazılır ("↔ 250,00 mm ∠ 36,87°"); taban ile imleç arasına ince
 * lastik bant çizilir. Açı +x'ten saat yönünün tersine, 0–360 (AutoCAD ANGDIR / ANGBASE varsayılanı).
 */
function hoverBase() {
  if (editor.tools && editor.tools.running) return edCall('lastToolPoint') || null;
  if ((S.mode === 'measure' || S.mode === 'profile') && S.measure.length) return S.measure[S.measure.length - 1];
  return null;
}
function hoverReadout(p) {
  const base = hoverBase(); if (!base) return { txt: '', base: null };
  const dx = p[0] - base[0], dy = p[1] - base[1], L = Math.hypot(dx, dy);
  if (!(L > 1e-12)) return { txt: '', base };
  let deg = Math.atan2(dy, dx) * 180 / Math.PI; if (deg < 0) deg += 360; if (deg >= 359.995) deg = 0;
  return { txt: '  \u2194 ' + fmt(L) + (S.units ? ' ' + S.units : '') + '  \u2220 ' + fmt(deg, 2) + '\u00b0', base, L, deg };
}
/** İmleç etiketi: koordinat, yakalama kipi / izleme ipucu / ORTHO, taban noktadan uzaklık ve açı */
function hoverLabel(sn, q, w) {
  const p = sn ? sn.p : (q || w);
  return fmt(p[0]) + ' ; ' + fmt(p[1]) + (sn ? '  ' + (sn.trk ? trkText(sn.trk) : Osnap.abbrOf(sn.kind)) : q ? '  ' + (S.desk.polar ? 'POLAR' : 'ORTHO') : '') + hoverReadout(p).txt;
}
function drawRubber(c, base, s, fg) {
  const b = toScreen(base[0], base[1]);
  c.save(); c.setLineDash([4, 4]); c.lineWidth = 1; c.strokeStyle = fg; c.globalAlpha = 0.5;
  c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(s[0], s[1]); c.stroke(); c.restore();
}
/*
 * PARMAKTAN İMLECE İNCE KILAVUZ (v7.88). Ofset yana kaçtığında hangi parmağın hangi imleci
 * sürüklediği yönden okunamaz; yukarı ofsette alışkanlıkla bilinen bağ burada görünür kılınır.
 */
function drawAimLink(c, fg, s) {
  const h = penHover;
  if (!h || !h.aim || h.fx == null || Math.hypot(s[0] - h.fx, s[1] - h.fy) <= 8) return;
  c.save(); c.setLineDash([2, 4]); c.lineWidth = 1; c.strokeStyle = fg; c.globalAlpha = 0.35;
  c.beginPath(); c.moveTo(h.fx, h.fy); c.lineTo(s[0], s[1]); c.stroke(); c.restore();
}
function drawPenHover(c, fg) {
  if (!penHover || !penHover.w) return;
  // Nesne isteminde yakalama aranmaz (findSnap boş döner): imleç karedir ve karenin altındaki nesne
  // vurgulanır. Koordinat kutusu da çıkmaz — seçilen bir nokta değil, bir NESNEdir.
  if (pickingObject()) {
    const hit = pick(penHover.w, TOL.pick / S.view.scale);
    if (hit) drawRollover(c, hit);
    drawAimLink(c, fg, [penHover.sx, penHover.sy]);
    drawPickBox(c, penHover.sx, penHover.sy, fg);
    if (penHover.aim) drawLoupe(c, fg);
    return;
  }
  const sn = penHover.snap, q = penHover.q;
  const s = sn ? toScreen(sn.p[0], sn.p[1]) : q ? toScreen(q[0], q[1]) : [penHover.sx, penHover.sy];   // kısıtlı nokta: imleç oraya, parmağa / kaleme değil
  const acc = S.selColor || '#ff9f0a';
  if (sn && sn.trk) drawTrackPaths(c, sn.trk, acc, 0.8);   // izleme yolları: imleç hangi hizaya / kesişime oturdu
  { const b = hoverBase(); if (b) drawRubber(c, b, s, fg); }   // taban noktadan imlece lastik bant
  drawAimLink(c, fg, s);
  c.save();
  c.setLineDash([3, 3]); c.lineWidth = 1; c.strokeStyle = fg; c.globalAlpha = 0.55;
  c.beginPath();
  c.moveTo(s[0] - 14, s[1] + 0.5); c.lineTo(s[0] + 14, s[1] + 0.5);
  c.moveTo(s[0] + 0.5, s[1] - 14); c.lineTo(s[0] + 0.5, s[1] + 14);
  c.stroke();
  c.setLineDash([]); c.globalAlpha = 1;
  if (sn) {
    // Yakalanan nokta kipin kendi glifiyle (kare uç, üçgen orta, daire merkez…): dokunulduğunda
    // tam oraya oturacağı ve HANGİ noktaya oturacağı belli olsun.
    c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = 2;
    Osnap.drawMarker(c, s[0], s[1], sn.kind, 7);
  }
  // Koordinat kutusu imlecin yanında; parmakla nişan alırken büyüteç zaten imlecin çevresini ve
  // koordinatı gösterdiğinden (drawLoupe etiketi) burada yazılmaz — aynı sayı iki yerde durmasın.
  if (!penHover.aim) {
    const txt = hoverLabel(sn, q, penHover.w);
    c.font = '11px system-ui, sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'left';
    const w = c.measureText(txt).width + 10;
    // Kutu imlecin sağına sığmıyorsa soluna geçer; iki yana da sığmıyorsa (iki yollu izleme ipucu) kenara dayanır — yazı kırpılmasın.
    const bx = Math.max(4, Math.min(S.W - w - 4, s[0] + 14 + w > S.W ? s[0] - 14 - w : s[0] + 14));
    c.fillStyle = S.dark ? 'rgba(20,26,34,.88)' : 'rgba(255,255,255,.88)';
    c.fillRect(bx, s[1] - 24, w, 18);
    c.fillStyle = sn ? acc : fg; c.fillText(txt, bx + 5, s[1] - 8);
  }
  c.restore();
  if (penHover.aim) drawLoupe(c, fg);
  // Boştayken (çalışan komut yok) AutoCAD imleci artı + pickbox'tır: bir sonraki dokunuş nokta değil
  // NESNE seçer. Kare imlecin kendi yerinde durur, yakalanan noktada değil.
  if (!(editor.tools && editor.tools.running) && S.mode !== 'measure' && S.mode !== 'profile' && !S.notesOn) drawPickBox(c, penHover.sx, penHover.sy, fg);
}
/*
 * BÜYÜTEÇ — parmakla nişan alırken (araç çalışırken uzun basıp sürükleme) imleç parmaktan ofset
 * kadar uzaktadır; büyüteç imlecin çevresini 2 kat büyütür: yakalanan nokta, kare ve koordinat
 * GÖRÜLEREK bırakılır. Kaynak ana tuvaldir (cv), kaplama değil — çizim ne ise o büyütülür.
 * Büyütecin YERİ imlece göredir; İÇERİĞİ ise yakalanan noktaya ortalanır (varsa) — ikisi
 * ayrı şeydir ve ayrı kalmalıdır, yoksa yakalama noktası değiştikçe büyüteç yerinden oynar.
 */
/** Büyütecin yeri: imlecin üstünde, yer yoksa YANA (nişanda asla aşağı: aşağısı elin kendisidir), ekran içinde ve zoom düğmelerinin (#navFabs) üstüne binmeden */
function loupeGeom(h) {
  const fs = uiPrefs().fontScale || 1, R = Math.round(60 * fs), gap = Math.round(34 * fs);
  let cx = h.sx, cy = h.sy - R - gap;
  /*
   * v7.88: eskiden burada büyüteç imlecin ALTINA inerdi. İmleç aşağı kaçmayı bıraktığına göre
   * tepede aşağı kaçan tek şey büyüteç olurdu ve doğrudan elin üstüne otururdu — şikâyet yer
   * değiştirmiş olurdu.
   *
   * Büyüteç imleçten ÇOK ÖNCE sıkışır: imleç 56 px ister, büyüteç 2R + boşluk = 154 px. Bu yüzden
   * sıkışma ekranın yalnız tepesinde değil, üst 214 px'inin tamamında yaşanır. Sıra şudur:
   *   1) tepeye dayanıp yine imlecin ÜSTÜNDE kalabiliyorsa orada kalır (duruş doğal olsun),
   *   2) kalamıyorsa YANA kaçar — imlecin parmaktan kaçtığı yan (o yan zaten elden uzaktır),
   *      imleç parmağın tam üstündeyse elden uzak yan; sığmazsa öbür yan,
   *   3) hiçbiri olmuyorsa (kalem / fare, ya da iki yana da sığmayan dar kadraj) eski davranış.
   */
  if (cy - R < 4) {
    if (2 * R + 12 <= h.sy - 8) cy = R + 4;
    else {
      // Yan yerleşim PARMAĞA göre ölçülür: imlece göre ölçülseydi ofsetin ters yanına sıçrayan
      // büyüteç parmağa yaklaşır, diski eli örterdi (412 px genişlikte birebir görüldü).
      const ax = h.fx != null ? h.fx : h.sx;
      const k = h.aim ? (h.fx != null && Math.abs(h.sx - h.fx) > 1 ? Math.sign(h.sx - h.fx) : elYonu()) : 0;
      const yan = k ? [ax + k * (R + gap), ax - k * (R + gap)].find(v => v - R >= 4 && v + R <= S.W - 4) : undefined;
      if (k && yan != null) { cx = yan; cy = Math.max(R + 4, Math.min(S.H - R - 4, h.sy)); }
      else cy = h.sy + R + gap;
    }
  }
  cx = Math.max(R + 4, Math.min(S.W - R - 4, cx));
  cy = Math.max(R + 4, Math.min(S.H - R - 4, cy));
  /*
   * Kaplayan düğme kümelerinden kaçınma. İKİ küme vardır ve ikisi de #viewport içindedir:
   * sağ alttaki zoom sütunu (#navFabs) ve sol alttaki yön tuşları (#dpad, eldiven kipinde
   * kendiliğinden açılır). Sol el düzeninde ikisi YER DEĞİŞTİRİR (app.css: body.left-hand),
   * bu yüzden eski "her zaman sola it" kuralı sol el kipinde büyüteci düğmelerin tam üstüne
   * oturtuyordu (nl = 12 iken max(R+4, 12-6-R) = R+4). Karar artık kümenin hangi yarıda
   * durduğuna bakar. Alçak ekranda navFabs yatay bir şerit ve ortadadır; orada yana kaçmak
   * işe yaramaz, YUKARI çıkılır.
   */
  for (const id of ['navFabs', 'dpad']) {
    const el = $(id);
    if (!el || el.hidden) continue;
    const a = el.getBoundingClientRect(); if (!(a.width > 0)) continue;
    const v = vp.getBoundingClientRect();
    const nl = a.left - v.left, nr = a.right - v.left, nt = a.top - v.top, nb = a.bottom - v.top;
    if (!(cx + R > nl - 4 && cx - R < nr + 4 && cy + R > nt && cy - R < nb)) continue;
    if (a.width > a.height * 1.5) cy = Math.max(R + 4, nt - 6 - R);
    else cx = (nl + nr) / 2 > S.W / 2 ? Math.max(R + 4, nl - 6 - R) : Math.min(S.W - R - 4, nr + 6 + R);
  }
  return { cx, cy, R };
}
function drawLoupe(c, fg) {
  const h = penHover, fs = uiPrefs().fontScale || 1, acc = S.selColor || '#ff9f0a';
  const Z = 2, { cx, cy, R } = loupeGeom(h);
  const sn = h.snap, p = sn ? toScreen(sn.p[0], sn.p[1]) : h.q ? toScreen(h.q[0], h.q[1]) : [h.sx, h.sy];
  const d = S.dpr, src = R / Z;
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.closePath();
  c.fillStyle = S.dark ? '#141a22' : '#ffffff'; c.fill();
  c.clip();
  try { c.drawImage(cv, (p[0] - src) * d, (p[1] - src) * d, src * 2 * d, src * 2 * d, cx - R, cy - R, R * 2, R * 2); } catch (_) { /* tuval boşsa büyüteç boş kalır */ }
  // merkezde imleç: nesne isteminde kare (2 kat: çizimdeki kareyle aynı alanı kapsar), nokta isteminde artı ve yakalama glifi
  if (pickingObject()) drawPickBox(c, cx, cy, fg, Z);
  else {
    c.setLineDash([]); c.lineWidth = 1; c.strokeStyle = fg; c.globalAlpha = 0.7;
    c.beginPath(); c.moveTo(cx - R, cy + 0.5); c.lineTo(cx + R, cy + 0.5); c.moveTo(cx + 0.5, cy - R); c.lineTo(cx + 0.5, cy + R); c.stroke();
    c.globalAlpha = 1;
    if (sn) { c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = 2.5; Osnap.drawMarker(c, cx, cy, sn.kind, 12); }
  }
  c.restore();
  c.save();
  c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.lineWidth = 2; c.strokeStyle = acc; c.globalAlpha = 0.9; c.stroke(); c.globalAlpha = 1;
  // etiket büyütecin PARMAKTAN UZAK yüzünde: nokta isteminde koordinat (+ yakalama kipi), nesne isteminde altındaki nesnenin türü ve katmanı
  let txt = '';
  if (pickingObject()) { const hit = pick(h.w, TOL.pick / S.view.scale); if (hit) txt = trType(hit.info ? hit.info.t : hit.et) + ' \u00b7 ' + hit.lay; }
  else txt = hoverLabel(sn, h.q, h.w);
  if (txt) {
    c.font = `${Math.round(11 * fs)}px system-ui, sans-serif`; c.textBaseline = 'top'; c.textAlign = 'center';
    const w = c.measureText(txt).width + 12, th = Math.round(18 * fs);
    /*
     * v7.88: etiket eskiden HER ZAMAN büyütecin altındaydı; bu, "büyüteç parmaktan ~150 px
     * yukarıdadır" varsayımına dayanıyordu. Yan ofsette büyüteç parmağa yaklaşır ve etiket elin
     * üstüne düşerdi — üstelik nişanda koordinatı gösteren TEK yer bu etikettir (drawPenHover
     * kutuyu kapatır). Büyüteç parmağın yeterince üstündeyse etiket altta kalır; değilse üste
     * alınır, üstte de yer yoksa (tepeye yapışık büyüteç) alta düşer.
     */
    const fy = h.fy != null ? h.fy : h.sy, ust = cy - R - 6 - th;
    const ly = (cy - fy <= -(R + 40) || ust < 4) ? cy + R + 6 : ust;
    c.fillStyle = S.dark ? 'rgba(20,26,34,.9)' : 'rgba(255,255,255,.9)'; c.fillRect(cx - w / 2, ly, w, th);
    c.fillStyle = sn ? acc : fg; c.fillText(txt, cx, ly + 3);
  }
  c.restore();
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
    /*
     * Koordinat çipi AZALAN UZUNLUKTA dört nüsha taşır; hangisinin yazılacağına statusFit karar
     * verir. Eskiden tek bir uzun metin yazılıyor, çip `overflow: hidden` ile "X: 15.257,27…"
     * diye kesiliyor ve Y HİÇ GÖRÜNMÜYORDU — çubuğun "hiçbir şeyi yarım gösterme" ilkesinin tam
     * tersi. Kısaltma sırası bilgiyi en az kaybedecek biçimdedir: önce coğrafi ek, sonra X/Y
     * etiketleri (sayıların sırası zaten X;Y'dir), en son ondalıklar. Kopyalama bundan
     * etkilenmez: stCoord tıklaması lastCoord'daki TAM değeri kopyalar.
     */
    const el = $('stCoord');
    const xy = 'X: ' + fmt(w[0]) + '  Y: ' + fmt(w[1]);
    let tam = xy;
    if (S.geo.active) { const ll = S.geo.toLonLat(w[0], w[1]); if (ll) tam += '  φ ' + ll[1].toFixed(6) + ' λ ' + ll[0].toFixed(6); }
    el.dataset.k0 = tam;
    el.dataset.k1 = xy;
    el.dataset.k2 = fmt(w[0]) + ' ; ' + fmt(w[1]);
    el.dataset.k3 = fmt(w[0], 0) + ' ; ' + fmt(w[1], 0);
    el.textContent = tam;
  }
  statusFit();
}
/*
 * DURUM ÇUBUĞU HİÇBİR ŞEYİ YARIM GÖSTERMEZ.
 *
 * Çubuk tek satırdır ve içeriği ekranı aşabilir: 2B'de sekiz hızlı düğme (8 x 40 = 320 px) tek
 * başına 412 px'lik bir telefonun neredeyse tamamını yer; geriye kalan koordinat, ızgara, ölçek,
 * kip ve sayaç çipleri `overflow: hidden` ile KIRPILIYORDU. Kullanıcı bunu "ölçeğin sağındaki
 * bilgi yazıları biçimsiz kalıyor" diye bildirdi: ekranda yarım bir "3B" rozeti ve kesik bir
 * "291" duruyordu.
 *
 * Çözüm kırpmayı değil YERLEŞİMİ düzeltmektir. Geçişler sırayla denenir, hangisinde sığarsa
 * orada durulur:
 *   1) SIKIŞIK KİP — düğmeler 40 → 34 px, boşluklar ve çip iç boşluğu daralır.
 *   2) SAYAÇ KISA YAZIMI — "2917 varlık · 42 katman" → "2917".
 *   3) BAŞKA YERDE KARŞILIĞI OLAN ÇİPLER DÜŞER — yakalama ve ızgara kendi hızlı düğmelerinde
 *      zaten görünür, GPS'in kendi düğmesi vardır.
 *   4) KOORDİNAT KISALIR — önce coğrafi ek, sonra X/Y etiketleri, en son ondalıklar
 *      (bkz. updateStatus, dataset.k0..k3). Bu adım 3'ten SONRAdır: yinelenen bir çipi düşürmek,
 *      koordinatın basamağını kaybetmekten ucuzdur.
 *   5) KAYAN DÜĞME ŞERİDİ — hızlı düğmeler çubuğun en çok %42'sini kaplar, gerisi yatay kayar
 *      (sağ kenardaki solma bunu belli eder). Bilgi çipleri böylece yerini korur.
 *   6) KALAN BİLGİLER DÜŞER — sayaç, koordinat, kip, ölçek. Ölçek en sonda kalır: haritacı için
 *      çubuktaki en değerli sayı odur.
 * Kendi sebebiyle gizlenmiş bir çip (ızgara kapalıysa #stGrid) zaten `hidden`'dır; bu geçiş
 * yalnız `st-squeeze` sınıfını ekler, `hidden`a dokunmaz — iki karar birbirine karışmaz.
 *
 * "SIĞDI" ÖLÇÜTÜ ÇUBUĞUN GENİŞLİĞİ DEĞİLDİR. Koordinat çipi `flex: 1 1 auto` olduğundan taşmayı
 * kendi içine çeker: çubuk sığıyor görünür, koordinat ise üç noktayla kesilir ve Y hiç görünmez.
 * Bu yüzden ölçüt "çubuk taşmıyor VE koordinat kırpılmamış"tır.
 */
const ST_DUSME = ['stSnap', 'stGrid', 'stGps', 'stCount', 'stCoord', 'stMode', 'stScale'];
let stFitRaf = 0;
const ST_KOORD = ['k1', 'k2', 'k3'];       // koordinatın azalan uzunlukta nüshaları (k0 = tam)
const ST_ONCE_DUSEN = ['stSnap', 'stGrid', 'stGps'];   // başka yerde karşılığı olanlar
const ST_SONRA_DUSEN = ['stCount', 'stCoord', 'stMode', 'stScale'];
function statusFit() {
  if (stFitRaf) return;
  stFitRaf = requestAnimationFrame(() => {
    stFitRaf = 0;
    const bar = $('statusbar'); if (!bar || bar.hidden || !bar.clientWidth) return;
    const q = $('stQuick'), co = $('stCoord');
    /*
     * Koordinat çipi `flex: 1 1 auto` olduğu için taşmayı KENDİ İÇİNE ÇEKER: çubuk sığıyor
     * görünür ama çipin metni üç noktayla kesilir. Bu yüzden "sığdı" ölçütü yalnız çubuğun
     * genişliği değildir — koordinat kırpılmışsa da sığmamış sayılır.
     */
    const koordVar = !!(co && !co.hidden && co.dataset.k0 && getComputedStyle(co).display !== 'none');
    const koordKirpik = () => koordVar && !co.classList.contains('st-squeeze') && co.scrollWidth > co.clientWidth + 1;
    const sigar = () => bar.scrollWidth <= bar.clientWidth + 1 && !koordKirpik();
    const dusur = (id) => {
      const e = $(id);
      if (!e || e.hidden || getComputedStyle(e).display === 'none') return false;
      e.classList.add('st-squeeze');
      return true;
    };
    for (const id of ST_DUSME) { const e = $(id); if (e) e.classList.remove('st-squeeze'); }
    { const c = $('stCount'); if (c && c.dataset.uzun) c.textContent = c.dataset.uzun; }
    if (koordVar) co.textContent = co.dataset.k0;
    document.body.classList.remove('st-tight');
    if (q) q.classList.remove('st-scroll');
    if (sigar()) return;
    document.body.classList.add('st-tight');
    if (sigar()) return;
    { const c = $('stCount'); if (c && c.dataset.kisa) c.textContent = c.dataset.kisa; }   // sayaç kısa yazıma iner
    if (sigar()) return;
    for (const id of ST_ONCE_DUSEN) { if (dusur(id) && sigar()) return; }                  // yakalama, ızgara, GPS
    if (koordVar) for (const k of ST_KOORD) { if (!co.dataset[k]) continue; co.textContent = co.dataset[k]; if (sigar()) return; }
    if (q) { q.classList.add('st-scroll'); if (sigar()) return; }
    for (const id of ST_SONRA_DUSEN) { if (dusur(id) && sigar()) return; }
  });
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
window.addEventListener('dwg:ui', () => { readTolerances(); syncDeskClass(); S.cacheValid = false; requestRender(); });
readTolerances();
const gestureStart = () => { if (!S.gestureActive) { S.gestureActive = true; } };
const clearLong = () => { if (longTimer) { clearTimeout(longTimer); longTimer = 0; } };

// ---- kalem (S Pen / Apple Pencil / genel kalemler) ----------------------------------
let midLast = 0;   // orta tuş çift tıklama zamanı
const palm = new Pen.PalmGuard();
const press = new Pen.Pressure();
let penHover = null, penHoverRaf = 0;
/** Avuç reddi ve kalem kipi ÜCRETSİZDİR: bunlar özellik değil, kalemli cihazda doğru çalışmadır. */
const penPrefs = () => uiPrefs();
const palmOn = () => penPrefs().palmReject !== false;
/** Gelişmiş kalem yetenekleri (havada önizleme, silgi, yan düğme, basınç) Premium'dadır. */
const penPro = () => Ed.has('pen');
/** "Kalem çizer, parmak gezinir": açıkken dokunuş yalnız kaydırır/yakınlaştırır, seçmez, çizmez */
const penNavOnly = () => S.pen.seen && penPrefs().penDraw === true && penPro();
function penClearHover() {
  if (!penHover) return;
  penHover = null; S.pen.hover = null;
  trackDwell(null);
  showSnapChip(null);
  drawOverlay();
}
// ---- masaüstü kipi (klavye + fare) --------------------------------------------------
/*
 * Cihaz TAHMİN EDİLMEZ, ÖLÇÜLÜR. Ortam sorgusu ilk tahmindir (bazı tabletler "ince işaretçi"
 * bildirir ama fare yoktur); kesin bilgi gerçek bir fare olayının gelmesidir. İkisi birlikte
 * kullanılıyor: sorgu açılışta kipi hazırlar, ilk fare olayı onu doğrular ve kalıcılaştırır.
 */
function deskSeen() {
  // Sınıf HER çağrıda eşitlenir: fare çizim açılmadan önce görülmüşse (ana ekranda gezinme)
  // deskOn() o an yanlış döner; ilk fare hareketinde erken dönülseydi sınıf hiç konmazdı.
  const ilk = !S.desk.mouse;
  S.desk.mouse = true;
  syncDeskClass();
  if (ilk) { edCall('refreshTiles'); drawOverlay(); }
}
/*
 * Gövde sınıfı "fare GÖRÜLDÜ"yü değil ETKİN KİPİ gösterir: kullanıcı masaüstü kipini
 * kapattığında artı imlecin de kalkması gerekir, yoksa kapattığı şeyin kapandığını görmez.
 */
function syncDeskClass() { document.body.classList.toggle('has-mouse', deskOn()); }
/** Masaüstü kipi açık mı: fare görüldü (ya da sorgu öyle diyor) ve kullanıcı kapatmadı */
const deskOn = () => uiPrefs().desktop !== false && (S.desk.mouse || Desk.likelyMouse(window)) && S.hasDoc;
/** Basılı duran DOKUNUŞ işaretçilerinin kimlikleri (avuç reddi kalem inince bunları iptal eder) */
const touchIds = () => [...pointers.entries()].filter(([, p]) => p.pt === 'touch').map(([id]) => id);
/** Kalem inince elin kenarıyla başlamış jest atılır: işaretçiler düşürülür, jest sıfırlanır */
function dropTouches(ids) {
  if (!ids || !ids.length) return;
  for (const id of ids) { pointers.delete(id); try { vp.releasePointerCapture(id); } catch (_) { /* yakalama yoksa önemsiz */ } }
  // Düşürülen parmak bir tutamağı sürüklüyorsa jest editörde de kapatılır (değişiklik atılır); yoksa giz
  // takılı kalır, gizmoBusy hep true döner ve kalem indikten sonra hiçbir dokunuş işlenmezdi.
  if (gesture && gesture.type === 'gizmo' && (pointers.size === 0 || ids.length)) { edCall('gizmoUp', false); gesture = null; S.gestureActive = false; }
  if (gesture && gesture.type === 'zoomwin' && pointers.size === 0) { cancelZoomWindow(); gesture = null; S.gestureActive = false; }
  if (pointers.size === 0 || (gesture && (gesture.type === 'pinch' || gesture.type === 'aim'))) { gesture = null; S.gestureActive = false; }
  if (penHover && penHover.aim) penClearHover();
  if (noteDraft) { noteDraft = null; drawOverlay(); }
  S.pen.drop = palm.dropped;
}

vp.addEventListener('pointerdown', (ev) => {
  if (!S.hasDoc) return;
  if (ev.target.closest && ev.target.closest('.notesbar, .fab, .home, .cmdbar, .hud, .docview, .snappick')) return; // görüntü alanı içindeki düğmeler
  if (snapPickOpen()) closeSnapPick();   // tuvale dokunmak açık aday seçicisini kapatır (nokta işlenmez)
  /*
   * Seçiciden gelen zorlanmış nokta doSnap'ta TÜKETİLİR. Tüketilmediği bir yol kalırsa (araç
   * o dokunuşu nokta saymadıysa) sonraki dokunuşu kaçırırdı; yeni bir işaretçi inişinde
   * kesinlikle temizlenir.
   */
  S.snapForce = null;
  // AVUÇ REDDİ — kalem ekrana değdiği sürece dokunuş dinlenmez. El kenarı kalemden önce de
  // sonra da inebildiği için iki yön de kapatılır; karar stylus.js'te, uygulaması burada.
  palm.enabled = palmOn();
  const penKind = Pen.kindOf(ev);
  const pd = palm.down(ev, performance.now(), touchIds());
  if (pd.block) { S.pen.drop = palm.dropped; return; }
  if (pd.drop.length) dropTouches(pd.drop);
  if (ev.pointerType === 'mouse') {
    deskSeen();
    if (deskOn()) {
      // ORTA TUŞ = KAYDIR (AutoCAD'in en çok kullanılan fare hareketi). Çift tıklama
      // sınırlara oturtur. Tarayıcının kendi otomatik kaydırması engellenir.
      if (ev.button === Desk.BTN_MIDDLE) {
        ev.preventDefault();
        const su = performance.now();
        if (midLast && su - midLast < TOL.dbl) { midLast = 0; zoomExtents(); viewHistory.push(); return; }
        midLast = su;
        try { vp.setPointerCapture(ev.pointerId); } catch (_) { /* yakalama yoksa jest yine çalışır */ }
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, pt: 'mouse', kind: 'mouse' });
        gesture = { type: 'pan', x0: ev.clientX, y0: ev.clientY, view: { ...S.view }, moved: false, t0: performance.now(), mid: true };
        gestureView0 = { ...S.view, li: S.layoutIndex };
        S.gestureActive = true;
        return;
      }
      // SAĞ TUŞ = Enter (son komutu yinele) ya da bağlam menüsü, ayara göre.
      if (ev.button === Desk.BTN_RIGHT) { ev.preventDefault(); const [rx, ry] = rel(ev); deskRight(rx, ry); return; }
    }
  }
  if (ev.pointerType === 'pen') {
    S.pen.seen = true; S.pen.kind = penKind;
    S.pen.pressure = press.feed(ev); S.pen.real = press.real; S.pen.tilt = Pen.tiltOf(ev);
    penClearHover();
    // YAN DÜĞME: basılıyken kalem indiyse atanan görev çalışır ve çizim YAPILMAZ.
    if (Pen.barrelOf(ev) && penPro()) { const [bx, by] = rel(ev); if (penBarrel(bx, by)) return; }
  }
  // Yakalama başarısız olabilir (işaretçi çoktan bırakılmışsa NotFoundError atar); jest yine
  // yürümelidir, yakalama yalnız parmağın öğeden çıkmasına karşı bir kolaylıktır.
  try { vp.setPointerCapture(ev.pointerId); } catch (_) { /* yakalama yoksa jest yine çalışır */ }
  // Son giren aygıt kazanır: parmak inince fareden / kalemden kalan gezinen imleç kalkar (tek imleç kuralı)
  if (ev.pointerType === 'touch' && penHover && !penHover.aim) penClearHover();
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, pt: ev.pointerType, kind: penKind });
  if (pointers.size === 1) gestureView0 = { ...S.view, li: S.layoutIndex };
  closeMenu(); clearLong();
  const arr = [...pointers.values()];
  // Tutamak sürüklenirken ikinci parmak yakınlaştırmaya geçmesin. Ama basılı BAŞKA işaretçi yokken giz'in
  // dolu olması bayat bir durumdur (bırakış olayı hiç gelmemiştir): kapatılır, dokunuş olağan yoldan işlenir.
  if (edCall('gizmoBusy')) { if (pointers.size > 1 || (gesture && gesture.type === 'gizmo')) return; edCall('gizmoUp', false); gesture = null; }
  if (arr.length === 1) {
    const [sx, sy] = rel(ev);
    if (zoomWin) {
      // Pencere seçimi sürerken BÜTÜN işaretçi inişleri ona aittir (birinci köşe, ikinci köşe, sürükleme).
      if (zoomWin.iki) zoomWin = { ...zoomWin, x1: sx, y1: sy, bas: [sx, sy] };
      else zoomWin = { ...zoomWin, pending: false, x0: sx, y0: sy, x1: null, y1: null, bas: [sx, sy] };
      gesture = { type: 'zoomwin', x0: sx, y0: sy }; S.gestureActive = true;
      /*
       * Parmak kıpırdamadan beklerse jest BÜYÜTEÇLİ NİŞANA döner: imleç parmağın dışına çıkar,
       * altındaki yer büyüteçte görünür ve köşe tam istenen noktaya konur. Sürüklemeye geçen
       * parmakta zamanlayıcı iptal edilir (aşağıda, hareket denetiminde).
       */
      if (ev.pointerType === 'touch') {
        const bx = sx, by = sy, pid = ev.pointerId;
        longTimer = setTimeout(() => {
          longTimer = 0;
          if (!zoomWin || !gesture || gesture.type !== 'zoomwin' || pointers.size !== 1) return;
          gesture = { type: 'aim', id: pid, ofs: aimOfs0(bx, by), fx: bx, fy: by };
          haptic('long'); aimMove(bx, by);
        }, TOL.long);
      }
      return;
    }
    // KAYDIR KİPİ, kalem / parmak / fare ayrımından ÖNCE: kip açıkken hiçbir araç, tutamak,
    // not ya da silgi dokunuşu almaz — sürükleme kaydırır, bırakış seçmez (navOnly).
    if (S.panMode) { gesture = { type: 'pan', x0: ev.clientX, y0: ev.clientY, view: { ...S.view }, moved: false, t0: performance.now(), navOnly: true }; return; }
    // "Kalem çizer, parmak gezinir": açıkken parmak yalnız kaydırır ve yakınlaştırır. Çizim,
    // seçim ve tutamak yalnız kalemin işidir; masaüstü CAD'deki fare/klavye ayrımının karşılığı.
    const navOnly = penNavOnly() && ev.pointerType === 'touch';
    // SİLGİ UCU: ters çevrilen kalem nesneyi ya da notu siler; çizime hiç girmez.
    if (penKind === 'eraser' && penPro() && !navOnly) { gesture = { type: 'erase', sx, sy }; S.gestureActive = true; return; }
    if (!navOnly && S.notesOn && S.noteTool !== 'select' && S.noteTool !== 'text' && S.noteTool !== 'photo') {
      const w = toWorld(sx, sy);
      const pr = ev.pointerType === 'pen' ? press.feed(ev) : 0;
      noteDraft = { type: S.noteTool, pts: [w, w], color: S.noteColor, width: 2 };
      // Basınç yalnız serbest çizgide ve gerçek basınç ölçüldüyse kaydedilir; yoksa dizi hiç
      // kurulmaz ve not eski biçiminde (tek kalınlık) kalır.
      if (S.noteTool === 'pen' && press.real && penPrefs().penPressure !== false && penPro()) noteDraft.pr = [pr, pr];
      gesture = { type: 'note' };
      return;
    }
    // Seçim tutamağı: parmak bir tutamağa indiyse jest kaydırmaya değil dönüşüme gider. "Kalem çizer, parmak gezinir"
    // kipinde de tutamak sürüklenir (açık hedef), yalnız bölge seçimi ve örtük pencere parmağa kapalı kalır.
    if (edCall('gizmoDown', sx, sy, { handlesOnly: navOnly })) {
      gesture = { type: 'gizmo', sx, sy }; S.gestureActive = true;
      /*
       * TUTAMAĞIN ÜSTÜNDE UZUN BASIŞ DA MENÜYÜ AÇAR. Seçim kutusunun TAŞIMA tutamağı kutunun tam
       * ortasındadır: seçili nesnenin üstüne uzun basan kullanıcı çoğu kez oraya denk gelir ve menü
       * hiç açılmazdı. Parmak kıpırdamadan süre dolarsa tutamak jesti İŞLENMEDEN iptal edilir
       * (hiçbir şey taşınmaz) ve menü açılır. Bölge seçimi sürüklemesi dışarıdadır — orada kullanıcı
       * bilerek kutu çiziyordur, menü onu bölerdi.
       */
      const gk = edCall('gizmoKind');
      if (gk && gk !== 'region' && !navOnly && S.mode === 'view' && !S.notesOn && !editor.is3D()) {
        const cx = ev.clientX, cy = ev.clientY;
        longTimer = setTimeout(() => {
          longTimer = 0;
          if (!gesture || gesture.type !== 'gizmo' || pointers.size !== 1) return;
          edCall('gizmoUp', false);
          gesture = { type: 'pan', x0: cx, y0: cy, view: { ...S.view }, moved: false, t0: performance.now(), longFired: true };
          haptic('long'); longPressMenu(sx, sy);
        }, TOL.long);
      }
      return;
    }
    const now = performance.now();
    if (lastTapPos && now - lastTap < TOL.dbl && Math.hypot(lastTapPos[0] - sx, lastTapPos[1] - sy) < 30 && !S.notesOn) {
      // çift-dokun-ve-sürükle: ikinci dokunuş basılı kalırsa dikey sürükleme yakınlaştırır; bırakılırsa 2×
      gesture = { type: 'dtap', sx, sy, y0: ev.clientY, view: { ...S.view }, moved: false };
      lastTap = 0;
    } else {
      gesture = { type: 'pan', x0: ev.clientX, y0: ev.clientY, view: { ...S.view }, moved: false, t0: now, navOnly };
      /*
       * Seç aracı sürerken de uzun basış menüsü gelir — ama yalnız NESNENİN üstünde. Boş yerde
       * nişan büyüteci kalır: ince seçim parmakla onunla yapılır, menü orada zaten boş çıkardı.
       * pick yalnız araç çalışıyorken hesaplanır (kısa devre), her basışta ağaç taranmaz.
       */
      const calisan = !!(editor.tools && editor.tools.running);
      const canLong = !navOnly && S.mode === 'view' && !S.notesOn && !editor.is3D()
        && (!calisan || (editor.tools.active === 'select' && !!pick(toWorld(sx, sy), TOL.pick / S.view.scale)));
      // Parmakla nişan alma: araç ya da ölçü çalışırken (menünün olmadığı yerde) uzun basış imleci parmağa bağlar
      const canAim = !canLong && !navOnly && ev.pointerType === 'touch' && ((editor.tools && editor.tools.running) || S.mode === 'measure' || S.mode === 'profile') && !S.notesOn && !editor.is3D();
      if (canLong) longTimer = setTimeout(() => { longTimer = 0; if (gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 1) { gesture.longFired = true; haptic('long'); longPressMenu(sx, sy); } }, TOL.long);
      else if (canAim) longTimer = setTimeout(() => { longTimer = 0; if (gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 1) { gesture = { type: 'aim', id: [...pointers.keys()][0], ofs: aimOfs0(sx, sy), fx: sx, fy: sy }; haptic('long'); aimMove(sx, sy); } }, TOL.long);
    }
  } else if (arr.length === 2) {
    noteDraft = null; clearLong();
    /*
     * NİŞANDA İKİNCİ PARMAK = İNCE AYAR (v7.87). Eskiden ikinci parmak nişanı iptal edip
     * yakınlaştırmaya geçiyordu. Oysa parmakla en zor iş ince ayardır: ikinci parmak artık
     * imleci 1/5 duyarlılıkla kaydırır, jest nişan olarak sürer.
     */
    if (gesture && gesture.type === 'aim') { gesture.fine = { id: ev.pointerId, x: ev.clientX, y: ev.clientY }; S.gestureActive = true; return; }
    if (penHover && penHover.aim) penClearHover();   // nişan dışında: yakınlaştırmaya geçilir, imleç bırakılır
    const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
    const r = vp.getBoundingClientRect();
    gesture = { type: 'pinch', d0: d, mid0: [(arr[0].x + arr[1].x) / 2 - r.left, (arr[0].y + arr[1].y) / 2 - r.top], view: { ...S.view }, moved: true, t0: performance.now(), start: arr.map(p => ({ x: p.x, y: p.y })), maxMove: 0 };
  }
  S.gestureActive = true;
});
vp.addEventListener('pointermove', (ev) => {
  const [sx, sy] = rel(ev);
  if (!pointers.has(ev.pointerId)) {
    if (!S.hasDoc) return;
    // İki nokta kipinde lastik dikdörtgen parmak/kalem inmeden de imleci izler (fare ve kalem)
    if (zoomWin && zoomWin.iki && ev.pointerType !== 'touch') { zoomWin.x1 = sx; zoomWin.y1 = sy; drawOverlay(); }
    // HAVADA GEZİNME: kalem ekrana değmeden de konum bildirir (buttons === 0). CAD'de en çok
    // işe yarayan kalem yeteneği budur — dokunmadan önce nereye düşeceği ve hangi noktaya
    // yakalanacağı görülür, böylece nokta seçimi el yordamıyla değil bakarak yapılır.
    if (ev.pointerType === 'pen') { palm.watch(ev, performance.now()); S.pen.seen = true; penHoverMove(sx, sy, ev); return; }
    if (ev.pointerType === 'mouse') { deskSeen(); updateStatus(sx, sy); if (deskOn()) { penHoverMove(sx, sy, ev); return; } }
    return;
  }
  if (ev.pointerType === 'pen') { S.pen.pressure = press.feed(ev); S.pen.real = press.real; palm.watch(ev, performance.now()); }
  pointers.set(ev.pointerId, { ...(pointers.get(ev.pointerId) || {}), x: ev.clientX, y: ev.clientY });
  if (!gesture) return;
  if (gesture.type === 'gizmo') {
    if (longTimer && Math.hypot(sx - gesture.sx, sy - gesture.sy) > 6) clearLong();   // parmak sürüklemeye geçti: uzun basış menüsü iptal
    edCall('gizmoMove', sx, sy);
  } else if (gesture.type === 'aim') {
    if (gesture.fine && ev.pointerId === gesture.fine.id) {
      const k = 0.2;   // 1/5 duyarlılık: 50 px parmak hareketi imleci 10 px kaydırır
      gesture.ofs = aimAsgari([gesture.ofs[0] + (ev.clientX - gesture.fine.x) * k, gesture.ofs[1] + (ev.clientY - gesture.fine.y) * k]);
      gesture.fine.x = ev.clientX; gesture.fine.y = ev.clientY;
      aimMove(gesture.fx, gesture.fy);
      return;
    }
    if (gesture.id != null && ev.pointerId !== gesture.id) return;   // ince ayar parmağı dışındaki üçüncü işaretçi imleci kaçırmasın
    aimMove(sx, sy);   // birincil parmak imleci sürükler; kaydırma yok
  } else if (gesture.type === 'erase') {
    gesture.sx = sx; gesture.sy = sy;   // silgi sürüklenebilir: bırakışta son noktadaki nesne silinir
  } else if (gesture.type === 'note' && noteDraft) {
    const w = toWorld(sx, sy);
    if (noteDraft.type === 'pen') { noteDraft.pts.push(w); if (noteDraft.pr) noteDraft.pr.push(S.pen.pressure); }
    else noteDraft.pts[1] = w;
    drawOverlay();
  } else if (gesture.type === 'zoomwin') {
    if (!zoomWin) return;
    if (longTimer && Math.hypot(sx - gesture.x0, sy - gesture.y0) > TOL.drag) clearLong();   // sürüklemeye geçildi: nişan kurulmaz
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
/*
 * Havada gezinen kalem ucu. Olay saniyede yüzlerce kez gelir; yakalama araması ve yeniden
 * çizim bir kare ile sınırlanır (rAF), yoksa gezinme tek başına çizimi yavaşlatırdı.
 */
function penHoverMove(sx, sy, ev) {
  // Kalemde havada önizleme Premium'dur; FAREDE masaüstü kipinin temelidir ve ücretsizdir —
  // fareyle çalışan kullanıcı zaten sürekli bir imleç görür, biz onu CAD artı imleci yapıyoruz.
  const fare = ev && ev.pointerType === 'mouse';
  if (fare ? !deskOn() : (!penPro() || penPrefs().penHover === false)) { if (penHover) penClearHover(); return; }
  const tilt = fare ? null : Pen.tiltOf(ev);
  penHover = { sx, sy, tilt, snap: penHover ? penHover.snap : null, w: null, fare };
  S.pen.tilt = tilt;
  hoverTick();
}
/*
 * PARMAKLA NİŞAN ALMA. Parmağın havada konumu yoktur; araç çalışırken UZUN BASIP sürüklemek imleci
 * parmağa bağlar: imleç parmağın altında, büyüteç üstünde gider, bırakınca dokunuş imlecin durduğu
 * yere işlenir. Gezinen kalem ucuyla aynı imleç ve aynı yakalama yolu kullanılır (penHover.aim).
 */
/*
 * YAKALAMA ADAY SEÇİCİ (v7.87).
 *
 * NEDEN VAR: parmakla çizerken kullanıcı hedefi piksel piksel bulamaz. Ama yakalama noktaları
 * AYRIK ve azdır — doğru çözüm hassasiyet istemek değil, açıklık içindeki adayları LİSTELEYİP
 * seçtirmektir (AutoCAD'in TAB ile aday değiştirmesinin dokunmatik karşılığı).
 *
 * NE ZAMAN ÇIKAR: yalnız uzun basışla NİŞAN alındıktan sonra, parmak kalkınca ve açıklıkta
 * BİRDEN ÇOK aday varsa. Tek aday varsa (ya da hiç yoksa) akış eskisi gibidir, nokta hemen
 * işlenir: ek adım tam da belirsizlik olduğunda çıkar, başka hiçbir zaman.
 *
 * Çiplerdeki numaralar tuvale çizilen işaretlerin numaralarıyla aynıdır; kullanıcı hangi çipin
 * hangi noktaya karşılık geldiğini renkten değil sayıdan okur (renk körlüğüne de dayanıklı).
 */
let snapPick = null;   // { list, i, sx, sy }
function snapPickOpen() { return !!snapPick; }
function closeSnapPick(cizim = true) {
  if (!snapPick) return;
  snapPick = null; S.snapForce = null;
  const el = $('snapPick'); if (el) { el.hidden = true; el.innerHTML = ''; }
  if (cizim) drawOverlay();
}
function openSnapPick(cx, cy, list, fx, fy) {
  const el = $('snapPick'); if (!el || !list || list.length < 2) return false;
  snapPick = { list, i: 0, sx: cx, sy: cy };
  el.innerHTML = list.map((c, i) => `<button type="button" data-sp="${i}" class="${i === 0 ? 'on' : ''}" title="${esc(Osnap.nameOf(c.kind))}">`
    + `<span class="no">${i + 1}</span>${Osnap.markerSvg(c.kind)}<span>${esc(Osnap.nameOf(c.kind))}</span></button>`).join('')
    + `<button type="button" data-sp="x" class="x" title="${esc(t('close'))}" aria-label="${esc(t('close'))}">✕</button>`;
  el.hidden = false;
  /*
   * Yerleşim: imlecin ALTINA, ekranın alt yarısındaysa ÜSTÜNE — seçici adayları örtmesin.
   * v7.88: boşluk imlece değil, imleç ile PARMAĞIN uçtakine göre ölçülür. Yan ofsette imleç
   * parmakla aynı yükseklikte olur; yalnız imlece bakan eski hesap şeridi tam elin durduğu
   * yere açardı. (Şeridin YÜKSEKLİĞİ zaten offsetHeight ile gerçek ölçüden okunuyor; eksik olan
   * ofsetin İŞARETİYDİ.) Boşluk yazı ölçeğiyle büyür.
   */
  const gw = el.offsetWidth || 240, gh = el.offsetHeight || 52;
  const ay = fy == null ? cy : fy, bosluk = Math.round(46 * (uiPrefs().fontScale || 1));
  const x = Math.max(8, Math.min(S.W - gw - 8, cx - gw / 2));
  const y = cy < S.H * 0.55 ? Math.min(S.H - gh - 8, Math.max(cy, ay) + bosluk) : Math.max(8, Math.min(cy, ay) - gh - bosluk);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  drawOverlay();
  return true;
}
/** Çipe dokunuldu: o nokta KESİN olarak işlenir (doSnap yeniden aramaz) */
function pickSnapCand(i) {
  const sp = snapPick; if (!sp) return;
  const c = sp.list[i]; if (!c) { closeSnapPick(); return; }
  const s = toScreen(c.p[0], c.p[1]);
  snapPick = null;
  const el = $('snapPick'); if (el) { el.hidden = true; el.innerHTML = ''; }
  S.snapForce = { p: c.p.slice(), kind: c.kind };
  lastTap = 0; lastTapPos = null;
  void onTap(s[0], s[1]);
}
{ const el = $('snapPick'); if (el) el.addEventListener('click', (ev) => { const b = ev.target.closest('[data-sp]'); if (!b) return; const v = b.dataset.sp; if (v === 'x') closeSnapPick(); else pickSnapCand(+v); }); }
/** Seçici açıkken adayların hepsi numaralı işaretle çizilir; seçili olan vurgulu */
function drawSnapPick(c) {
  const sp = snapPick; if (!sp) return;
  // Araç bitti ya da iptal edildi: artık nokta istenmiyorsa seçici ekranda ASILI KALMAZ.
  // closeSnapPick(false): burası zaten çizim içidir, yeniden çizim istenmez (özyineleme olurdu).
  if (!pointPrompt()) { closeSnapPick(false); return; }
  c.save();
  c.font = `bold ${Math.round(11 * (uiPrefs().fontScale || 1))}px sans-serif`;
  c.textBaseline = 'middle'; c.textAlign = 'center';
  sp.list.forEach((q, i) => {
    const s = toScreen(q.p[0], q.p[1]);
    const secili = i === sp.i;
    c.globalAlpha = secili ? 1 : 0.75;
    c.strokeStyle = '#3ddc84'; c.fillStyle = '#3ddc84'; c.lineWidth = secili ? 2.4 : 1.6;
    c.setLineDash([]);
    Osnap.drawMarker(c, s[0], s[1], q.kind, secili ? 10 : 8);
    // numara: işaretin sağ üstünde, koyu zemin üzerinde okunur
    const r = 8, nx = s[0] + 14, ny = s[1] - 14;
    c.beginPath(); c.arc(nx, ny, r, 0, TAU); c.fill();
    c.fillStyle = '#0b1020'; c.fillText(String(i + 1), nx, ny + 0.5);
  });
  c.restore();
}
const SUREKLI_KIP = new Set(['nea', 'ext', 'par']);   // nesnenin her yerinde bulunan aileler: aday seçiciye girmez
const AIM_OFS = 56;    // imlecin parmaktan uzaklığı (px): parmak hedefi örtmesin
const AIM_ASG = 24;    // en küçük uzaklık: ince ayar imleci parmağın ALTINA sokamaz
const AIM_KEN = 4;     // imleç ekranın kenarından en az bu kadar içeride durur
const AIM_GERI = 28;   // çevrilen yön ancak bu kadar yer açılınca geri döner (kenarda titremesin)
/** El gövdesinin geldiği yanın TERSİ: sağ el düzeninde sola, sol el düzeninde sağa kaçılır */
const elYonu = () => (uiPrefs().leftHand ? 1 : -1);
/** Ofset uygulanınca imleç ekranın içinde (pay kadar içeride) kalıyor mu */
function aimSigar(fx, fy, o, pay) {
  const x = fx + o[0], y = fy + o[1];
  return x >= AIM_KEN + pay && x <= S.W - AIM_KEN - pay && y >= AIM_KEN + pay && y <= S.H - AIM_KEN - pay;
}
/*
 * KAÇIŞ YÖNÜ — TEK KARAR YERİ (v7.88). Üstte yer yoksa imleç AŞAĞI İNMEZ: aşağısı elin
 * kendisidir, imleç parmağın altında kalır ve aparat işe yaramaz. Sıra: yukarı → elden uzak
 * yan → öbür yan → en son çare aşağı. Büyüteç de (loupeGeom) aynı yanı kullanır; "yer yoksa
 * nereye" kuralının iki ayrı kopyası bırakılmaz.
 */
function aimYon(fx, fy, L) {
  const k = elYonu();
  for (const o of [[0, -L], [k * L, 0], [-k * L, 0], [0, L]]) if (aimSigar(fx, fy, o, 0)) return o;
  // Hiçbir yön sığmıyor (çok dar kadraj): yeri en çok olan yöne, asgari uzaklıktan az olmamak üzere.
  const en = [[0, -1, fy], [k, 0, k < 0 ? fx : S.W - fx], [-k, 0, k < 0 ? S.W - fx : fx], [0, 1, S.H - fy]]
    .sort((a, b) => b[2] - a[2])[0];
  const m = Math.max(AIM_ASG, Math.min(L, en[2] - AIM_KEN));
  return [en[0] * m, en[1] * m];
}
/** Başlangıç ofseti: yer varsa yukarı, yoksa yana (aşağı değil) */
function aimOfs0(fx, fy) { const d = uiPrefs().aimOffset == null ? AIM_OFS : +uiPrefs().aimOffset || 0; return aimYon(fx, fy, Math.max(AIM_ASG, d)); }
/** İnce ayar ofseti sıfıra indirmesin: imleç parmağın altına girerse nereye dokunulduğu yine görünmez */
function aimAsgari(o) {
  const L = Math.hypot(o[0], o[1]);
  if (L >= AIM_ASG) return o;
  if (L < 1e-6) return [0, -AIM_ASG];
  return [o[0] * (AIM_ASG / L), o[1] * (AIM_ASG / L)];
}
/*
 * KENARDA YÖN ÇEVRİLİR, KELEPÇE YOK. Ofseti kenara kelepçelemek imleci sessizce parmağın altına
 * sürüklerdi (v7.87'de düşeyde öyleydi, yan ofsetle her yatay sürüklemede olurdu). Yön jest
 * boyunca gözden geçirilir; geri dönüş daha geniş bir eşikledir (AIM_GERI) ki kenarda titremesin.
 */
function aimEtkin(g, fx, fy, ofs) {
  const cev = g ? g.cev : null;
  if (aimSigar(fx, fy, ofs, cev ? AIM_GERI : 0)) { if (g) g.cev = null; return ofs; }
  const d = cev && aimSigar(fx, fy, cev, 0) ? cev : aimYon(fx, fy, Math.hypot(ofs[0], ofs[1]) || AIM_OFS);
  if (g) g.cev = d;
  return d;
}
/*
 * PARMAKLA NİŞAN (v7.87). İmleç artık parmağın TAM ALTINDA değil, ofset kadar uzağındadır:
 * parmak hedefi örtmez, nereye düşeceği doğrudan görülür. Ofset jestte tutulur; ikinci parmak
 * onu 1/5 duyarlılıkla değiştirerek ince ayar yapar ve ayar parmak kalkınca da korunur.
 */
function aimMove(fx, fy) {
  const g = gesture && gesture.type === 'aim' ? gesture : null;
  const ofs = aimEtkin(g, fx, fy, g && g.ofs ? g.ofs : [0, 0]);
  if (g) { g.fx = fx; g.fy = fy; }
  // Kelepçe yalnız yukarıdaki dar kadraj çaresinin son emniyetidir; olağan akışta aimEtkin zaten içeride tutar.
  const cx = Math.max(AIM_KEN, Math.min(S.W - AIM_KEN, fx + ofs[0])), cy = Math.max(AIM_KEN, Math.min(S.H - AIM_KEN, fy + ofs[1]));
  penHover = { sx: cx, sy: cy, fx, fy, ofs: [cx - fx, cy - fy], tilt: null, snap: penHover ? penHover.snap : null, w: null, aim: true };
  hoverTick();
}
function hoverTick() {
  if (penHoverRaf) return;
  penHoverRaf = requestAnimationFrame(() => {
    penHoverRaf = 0;
    if (!penHover || !S.hasDoc) return;
    const w = toWorld(penHover.sx, penHover.sy);
    penHover.w = w;
    // Yakalama, dokunuştaki ile AYNI yolu kullanır (doSnap değil: o S.lastPoint'i ve titreşimi
    // değiştirir; gezinme belgeye ve duruma hiç dokunmamalıdır).
    penHover.snap = findSnap(w, { prev: edCall('lastToolPoint'), hover: true });
    trackDwell(penHover.snap);   // yakalama noktasında bekleyince iz noktası edinilir (nesne yakalama izleme)
    // Ortho / kutupsal: yakalama yoksa önizleme de dokunuşun düşeceği kısıtlı noktayı gösterir (tools.kisitla ile aynı hesap)
    penHover.q = null;
    if (!penHover.snap) { const q = edCall('constrainPoint', w); if (q && (q[0] !== w[0] || q[1] !== w[1])) penHover.q = [q[0], q[1]]; }
    S.pen.hover = penHover.snap ? penHover.snap.p.slice(0, 2) : penHover.q ? penHover.q.slice() : [w[0], w[1]];
    showSnapChip(penHover.snap ? penHover.snap.kind : null);
    updateStatus(penHover.sx, penHover.sy);
    drawOverlay();
  });
}
/*
 * SAĞ TUŞ. AutoCAD'de varsayılan davranış Enter'dır: çalışan komutu onaylar, boştayken son
 * komutu yineler. Menü isteyen kullanıcı için ikinci seçenek vardır; üçüncüsü sağ tuşu tümden
 * serbest bırakır (tarayıcının kendi menüsü açılsın diye değil — hiçbir şey yapmasın diye).
 */
function deskRight(sx, sy) {
  const act = uiPrefs().deskRight || 'enter';
  if (act === 'none') return;
  if (act === 'menu') { longPressMenu(sx, sy); return; }
  // 'enter': çalışan araç varsa bitirir, yoksa son komutu yineler
  if (editor.tools && editor.tools.running) { editor.tools.finish(); return; }
  edCall('cmdRepeat');
}
/** Yan (barrel) düğme görevi. true dönerse kalem indiği hâlde çizim yapılmaz. */
function penBarrel(sx, sy) {
  const act = penPrefs().penBarrel || 'menu';
  if (act === 'none') return false;
  haptic('long');
  if (act === 'menu') { longPressMenu(sx, sy); return true; }
  if (act === 'undo') { editor.act('undo'); return true; }
  if (act === 'snap') { editor.act('osnap'); return true; }
  if (act === 'erase') { penErase(sx, sy); return true; }
  return false;
}
/*
 * SİLGİ. Notlar açıkken önce notu siler (kullanıcı orada notla uğraşıyordur), yoksa çizim
 * nesnesini siler. Silme her zaman belge komutudur — tek geri alma adımı olur.
 */
function penErase(sx, sy) {
  const w = toWorld(sx, sy);
  if (S.notesOn) {
    const n = hitNote(sx, sy, TOL.pick * 1.4);
    if (n) { removeNote(n.id); haptic('step'); toast(t('deleted')); drawOverlay(); return true; }
  }
  const hit = pick(w, TOL.pick / S.view.scale);
  if (!hit) { toast(t('noObject')); return false; }
  if (!editor.eraseKeys([hit.key])) return false;
  S.selected = null;
  haptic('step'); toast(t('deleted'));
  return true;
}
let gestureView0 = null; // jest başındaki görünüm (geçmiş için)
function endPointer(ev) {
  const elenen = palm.up(ev, performance.now());
  if (ev.pointerType === 'pen') { S.pen.kind = null; S.pen.pressure = 0; }
  const had = pointers.delete(ev.pointerId);
  if (!had) { if (elenen) S.pen.drop = palm.dropped; return; }
  const [sx, sy] = rel(ev);
  clearLong();
  if (gesture && gesture.type === 'erase') {
    gesture = null; S.gestureActive = false;
    if (ev.type === 'pointerup') penErase(sx, sy);
    if (pointers.size === 0) { gestureView0 = null; requestRender(); }
    return;
  }
  if (gesture && gesture.type === 'note') {
    if (noteDraft && ev.type === 'pointerup') {
      const a = toScreen(noteDraft.pts[0][0], noteDraft.pts[0][1]), b = toScreen(noteDraft.pts[noteDraft.pts.length - 1][0], noteDraft.pts[noteDraft.pts.length - 1][1]);
      if (noteDraft.type === 'pen' ? noteDraft.pts.length > 2 : Math.hypot(a[0] - b[0], a[1] - b[1]) > 4) addNote(noteDraft);
    }
    noteDraft = null; gesture = null; S.gestureActive = false; drawOverlay(); return;
  }
  if (gesture && gesture.type === 'aim') {
    // İnce ayar parmağı kalktı: nişan SÜRER ve ayar korunur; nokta yalnız birincil parmak kalkınca işlenir.
    if (gesture.fine && ev.pointerId === gesture.fine.id) { gesture.fine = null; return; }
    const h = penHover; gesture = null; S.gestureActive = false;
    penClearHover();
    if (ev.type === 'pointerup' && h) {   // iptalde (pointercancel) dokunuş yok
      /*
       * Açıklıkta BİRDEN ÇOK aday varsa nokta hemen işlenmez: seçici donar ve kullanıcı çipe
       * dokunarak seçer. Tek aday varsa (ya da seçici kapalıysa) akış eskisi gibidir — ek adım
       * yalnız belirsizlik olduğunda çıkar.
       */
      /*
       * SÜREKLİ AİLELER SEÇİCİYE GİRMEZ. EN YAKIN, UZANTI ve PARALEL bir "nokta" değil, bir
       * nesnenin HER yerinde bulunan bir ailedir; listeye alınsalardı seçici neredeyse her
       * dokunuşta açılır ve ek adım bir kazanç değil engel olurdu. Seçici yalnız AYRIK nitelik
       * noktaları (uç, orta, merkez, kesişim, düğüm, çeyrek…) birden çoksa çıkar.
       */
      const adaylar = uiPrefs().snapPick === false ? []
        : findSnapList(toWorld(h.sx, h.sy), { prev: edCall('lastToolPoint'), max: 6 }).filter(c => !SUREKLI_KIP.has(c.kind));
      if (adaylar.length >= 2 && openSnapPick(h.sx, h.sy, adaylar, h.fx, h.fy)) { if (pointers.size === 0) { gestureView0 = null; requestRender(); } return; }
      lastTap = 0; lastTapPos = null; void onTap(h.sx, h.sy);
    }
    if (pointers.size === 0) { gestureView0 = null; requestRender(); }
    return;
  }
  if (gesture && gesture.type === 'gizmo') {
    edCall('gizmoUp', ev.type === 'pointerup');
    gesture = null; S.gestureActive = false;
    if (pointers.size === 0) { gestureView0 = null; requestRender(); }
    return;
  }
  if (gesture && gesture.type === 'zoomwin') {
    const zw = zoomWin, bas = zw && zw.bas ? zw.bas : [sx, sy];
    gesture = null; S.gestureActive = false; clearLong();
    if (!zw) { requestRender(); return; }
    // İptal (pointercancel): seçim BİTMEZ, yalnız bu sürükleme geri alınır — kullanıcı yeniden dener.
    if (ev.type !== 'pointerup') { zoomWin = { ...zw, x1: zw.iki ? zw.x1 : null, bas: null }; drawOverlay(); requestRender(); return; }
    // Kıpırdamayan dokunuş köşe bırakır (iki nokta kipi); sürükleme pencereyi doğrudan kapatır.
    if (Math.hypot(sx - bas[0], sy - bas[1]) <= TOL.drag) zwKose(sx, sy);
    else zwBitir(sx, sy);
    requestRender(); return;
  }
  if (gesture && gesture.type === 'dtap' && pointers.size === 0 && ev.type === 'pointerup') {
    if (!gesture.moved) { zoomAtScreen(gesture.sx, gesture.sy, 2); }
    lastTap = 0; lastTapPos = null;
  } else if (gesture && gesture.type === 'pan' && !gesture.moved && !gesture.longFired && pointers.size === 0 && ev.type === 'pointerup') {
    if (gesture.twoTap && performance.now() - gesture.twoTap.t < 250) { zoomAtScreen(gesture.twoTap.mid[0], gesture.twoTap.mid[1], 0.5); lastTap = 0; }
    else if (gesture.navOnly) { lastTap = 0; lastTapPos = null; }   // kalem kipi: parmak seçmez
    else if (gesture.mid) { lastTap = 0; lastTapPos = null; }        // orta tuş yalnız kaydırır, seçmez
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
// Kalem menzilden çıkınca havadaki imleç kalkar; kalmasa "orada bir şey var" sanılırdı.
// Çizim alanında tarayıcının kendi bağlam menüsü açılmaz: sağ tuş CAD'de Enter'dır.
vp.addEventListener('contextmenu', (ev) => { if (deskOn()) ev.preventDefault(); });
vp.addEventListener('pointerout', (ev) => { if (ev.pointerType === 'pen') penClearHover(); });
vp.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'pen' || ev.pointerType === 'mouse') penClearHover(); });
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
  /*
   * NESNEDE UZUN BASIŞ / SAĞ TUŞ = DÜZENLEME MENÜSÜ (v7.93). AutoCAD'de nesnenin üstünde sağ tuş
   * Sil, Taşı, Döndür, Kopyala… getirir; "bilgi / katmanı izole et" listesi değil. Bu kapı üç yolu
   * birden karşılar: parmakla uzun basış, kalemin yan düğmesi ve masaüstünde sağ tuş — üçü de
   * buraya iner. Editör menüyü alamazsa (3B, not kipi, çalışan araç) eski bağlam listesi açılır.
   */
  if (hit && edCall('selMenuAt', hit)) return;
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
      case 'hide': { if (layerState([hit.lay], { off: true })) toast(t('layer') + ' ' + hit.lay + ': ' + tt('hidden', 'gizlendi'), { action: { label: tt('undoAction', 'Geri al'), fn: () => layerState([hit.lay], { off: false }) } }); break; }
      case 'copy': copyText(coordTxt); break;
      case 'measure': setMode('measure'); S.measure.push([w[0], w[1], undefined]); updateMeasure(); drawOverlay(); break;
      case 'note': toggleNotes(true); S.noteTool = 'text'; document.querySelectorAll('#notesBar [data-tool]').forEach(x => x.classList.toggle('active', x.dataset.tool === 'text')); void noteTap(sx, sy, w); break;
      case 'goto': gotoCoord(); break;
      default: break;
    }
  };
}

/*
 * NESNE GİZLEME / İZOLASYON (AutoCAD HIDEOBJECTS / ISOLATEOBJECTS / UNISOLATEOBJECTS). Görünüm durumudur: çizim
 * değişmez, DXF'e yazılmaz, yeni dosyada sıfırlanır. render.passFilters ve seçim (candidates → primVisible) aynı
 * kümeye bakar: gizlenen nesne çizilmez ve dokunuşla seçilemez.
 */
function hideObjects(keys, isolate) {
  if (isolate) S.isoObj = new Set(keys); else for (const k of keys) S.hideObj.add(k);
  S.selected = null; hide('infoPanel');
  S.cacheValid = false; requestRender(); drawOverlay(); edCall('yenile3B');   // 3B sahnesi de aynı gizleme kümesinden türer
}
function showAllObjects() { S.hideObj = new Set(); S.isoObj = null; S.cacheValid = false; requestRender(); drawOverlay(); edCall('yenile3B'); }

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
/*
 * YAKALAMA ARAMASI (duruma dokunmaz). o.prev: önceki nokta (dik / teğet / paralel / uzantı için;
 * araçlar kendi son noktasını verir, ölçü kipi ölçü listesinden alır) · o.once: bir kerelik kip ·
 * o.hover: gezinme (izleme noktası güncellenmez). Seçenekler settings.snapOpt'tan: açıklık (px),
 * taramaları yoksayma, Z yerine geçerli kot, yakalama izi.
 */
/** Şu an bir NOKTA mı isteniyor: çalışan araç nokta adımında ya da ölçü / profil kipi. Boşta (Komut:) ve nesne isteminde yakalama yoktur. */
function pointPrompt() {
  if (S.mode === 'measure' || S.mode === 'profile') return true;
  if (zoomWin) return true;   // pencere seçimi de bir NOKTA istemidir: köşe yakalama noktasına oturur
  return !!(editor.tools && editor.tools.running) && !pickingObject();
}
/*
 * findSnap ile findSnapList'in ORTAK hazırlığı: yakalama kapısı, açıklık, kipler, taban nokta ve
 * aday ilkeller. İki yol aynı kuralla çalışmalı — kapı iki kopyaya bölünürse zamanla ayrışır.
 * null dönerse yakalama hiç aranmaz.
 */
function snapSetup(w, o = {}) {
  // AutoCAD'de yakalama YALNIZ nokta isteminde çalışır: "Select objects:" isteminde işaret çıkmaz,
  // imleç pickbox olur. Tutamak (grip) sürüklemesi nokta işidir; o muaftır ({ grip: true }).
  if (!o.grip && pickingObject()) return null;
  // Boşta (komut yok) kalem / fare / parmak gezinirken de işaret çıkmaz: kullanıcı bir nokta seçmiyor,
  // yalnızca ekranda dolaşıyor — kalemli cihazda her uç ve orta noktada beliren glifler rahatsız ediyordu.
  if (o.hover && !o.grip && !pointPrompt()) return null;
  const opt = Osnap.opt();
  // Tutamak sürüklemesinde açıklık 1,5 kat: parmak hedefi örter, kalem ucu ise hızlı gider; köşeyi başka nesnenin
  // ucuna / ortasına oturtmak ince nişan istememeli.
  const tol = (opt.aperture > 0 ? opt.aperture : TOL.snap) * (o.grip ? 1.5 : 1) / S.view.scale;
  const modes = o.once ? new Set([o.once]) : S.snapModes;
  if (!modes.size && !S.track.pts.length) return null;
  const prev = o.prev || (S.mode === 'measure' || S.mode === 'profile' ? (S.measure.length ? S.measure[S.measure.length - 1] : null) : null);
  let cands = candidates(w, tol);
  if (opt.ignoreHatch) cands = cands.filter(p => !(p.info && p.info.t === 'HATCH'));
  if (o.skip) { const sk = o.skip instanceof Set ? o.skip : new Set(Array.isArray(o.skip) ? o.skip : [o.skip]); cands = cands.filter(p => !sk.has(p)); }   // sürüklenen nesne(ler): kendi eski köşesine yapışmasın (çoklu seçimde çakışan köşeyi taşıyan bütün yollar)
  return { opt, tol, modes, prev, cands };
}
/*
 * YAKALAMA ADAY LİSTESİ (v7.87). Parmakla nişan alırken tek "en iyi" nokta yetmez: kullanıcı
 * hedefi piksel piksel bulamaz ama açıklık içindeki adaylar ayrık ve azdır. Liste, seçicide
 * çip olarak gösterilir. Açıklık burada biraz geniş tutulur (tolK) — kaba dokunuşun altındaki
 * bütün anlamlı noktalar listeye girsin.
 */
function findSnapList(w, o = {}) {
  const st = snapSetup(w, o); if (!st || !st.modes.size) return [];
  return snapCandidates(st.cands, w, st.tol, st.modes, st.prev, { max: o.max || 6 });
}
function findSnap(w, o = {}) {
  const st = snapSetup(w, o); if (!st) return null;
  const { opt, tol, modes, prev, cands } = st;
  let sn = null;
  if (modes.size) {
    const wide = modes.has('par') && prev ? candidates(w, tol * 40).filter(p => p.k === 0).slice(0, 300) : null;
    sn = snapPoint(cands, w, tol, modes, prev, { wide });
  }
  // NESNE YAKALAMA İZLEME (OTRACK): edinilmiş iz noktalarından geçen hizalama yolları ve kesişimleri (otrack.js);
  // nesne yakalaması (en yakın dışında) her zaman izi yener — kullanıcı belirli bir noktaya oturmak istemiştir.
  const imp = !o.grip && !o.once ? trackBase(prev) : null;   // taban noktanın örtük uzantı yolları (v7.73); bir kerelik kipte istenen kip esastır
  if ((S.track.pts.length || imp) && (!sn || sn.kind === 'nea')) {
    const tr = trackObjCross(trackAlign(w, tol, { ...o, prev, imp }), w, tol, cands);
    if (tr && (!sn || Math.hypot(tr.p[0] - w[0], tr.p[1] - w[1]) < Math.hypot(sn.p[0] - w[0], sn.p[1] - w[1]))) sn = { p: [tr.p[0], tr.p[1], undefined], kind: 'trk', trk: tr };
  }
  if (sn && opt.zElev) sn.p[2] = 0;
  return sn;
}
/*
 * DOKUNUŞ YAKALAMASI (durumu değiştirir): son noktayı, durum çipini, titreşimi, izleme noktasını ve
 * dokunuş sonrası işareti günceller. Bir kerelik geçersiz kılmalar (menüden ya da nokta istemine
 * yazılan END / MID / M2P / FROM / TK / NON) burada tüketilir; iki dokunuş isteyenler ilkinde
 * { pending:true } döner ve araç o dokunuşu nokta saymaz.
 */
function doSnap(w, o = {}) {
  const once = S.snapOnce;
  const bitir = (sn) => {
    if (sn) { S.lastPoint = [sn.p[0], sn.p[1]]; showSnapChip(Osnap.abbrOf(sn.kind)); haptic('snap'); snapFlash(sn); }
    else S.lastPoint = [w[0], w[1]];
    return sn;
  };
  /*
   * SEÇİCİDEN GELEN NOKTA (v7.87). Kullanıcı aday çip sırasından bir nokta seçtiyse o nokta
   * kesindir ve yeniden ARANMAZ: aynı piksele düşen daha öncelikli bir kip (ör. UÇ, EN YAKIN'ı)
   * onu ezerdi ve kullanıcı seçtiğinden başka bir noktaya oturmuş olurdu.
   */
  if (S.snapForce) { const f = S.snapForce; S.snapForce = null; return bitir({ p: f.p.slice(), kind: f.kind }); }
  if (!once) return bitir(findSnap(w, o));
  if (once === 'non') { Osnap.clearOnce(); showSnapChip('NON'); S.lastPoint = [w[0], w[1]]; return null; }
  if (once === 'm2p') {
    const q = findSnap(w, o), pt = q ? q.p.slice() : [w[0], w[1], undefined];
    const tmp = S.snapTemp || (S.snapTemp = { pts: [] });
    tmp.pts.push(pt); if (q) snapFlash(q);
    if (tmp.pts.length < 2) { toast(t('osM2pSecond'), 1800); haptic('snap'); return { pending: true }; }
    const [a, b] = tmp.pts; Osnap.clearOnce();
    const z = a[2] != null && b[2] != null ? (a[2] + b[2]) / 2 : undefined;
    return bitir({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z], kind: 'm2p' });
  }
  if (once === 'tk') {
    // İZ NOKTASI (AutoCAD TT): dokunulan (yakalanan) nokta EDİNİLİR, nokta sayılmaz; sonraki dokunuşlar ondan geçen
    // hizalama yollarına oturur (nesne yakalama izleme, otrack.js). Yakalama izi kapalıyken de çalışır: geçici iz noktasıdır.
    const q = findSnap(w, o), pt = q ? q.p.slice() : [w[0], w[1], undefined];
    Osnap.clearOnce();
    trackToggle([pt[0], pt[1]], q && !TRK_SKIP.has(q.kind) ? q.kind : 'tk', true);
    if (q) snapFlash(q);
    toast(t('osTkFirst'), 2200);
    edCall('snapChanged');
    return { pending: true };
  }
  if (once === 'from') {
    const q = findSnap(w, o), pt = q ? q.p.slice() : [w[0], w[1], undefined];
    S.snapTemp = { from: pt }; S.snapOnce = null; if (q) snapFlash(q);
    toast(t('osFromBase'), 2600); haptic('snap');
    return { pending: true };
  }
  Osnap.clearOnce();
  return bitir(findSnap(w, { ...o, once }));
}
/** FROM tabanı: '@dx,dy' yazılınca bir kez kullanılır (tools.parsePoint) */
function fromBase() { const b = S.snapTemp && S.snapTemp.from; if (b) { S.snapTemp = null; return b; } return null; }
let snapFlashTimer = 0;
function snapFlash(sn) {
  S.snapFlash = { p: sn.p, kind: sn.kind, trk: sn.trk || null, until: performance.now() + 900 };
  clearTimeout(snapFlashTimer); snapFlashTimer = setTimeout(() => { S.snapFlash = null; drawOverlay(); }, 950);
}

async function onTap(sx, sy) {
  // Pencere seçimi sürüyorsa dokunuş bir KÖŞEDİR: büyüteçli nişanla konan nokta da buraya düşer.
  if (zoomWin) { updateStatus(sx, sy); zwKose(sx, sy); return; }
  updateStatus(sx, sy);
  const w = toWorld(sx, sy);
  S.lastPoint = [w[0], w[1]];
  if (editorTap(w, sx, sy)) return;
  if (S.notesOn) { await noteTap(sx, sy, w); return; }
  if (S.mode === 'measure' || S.mode === 'profile') {
    const sn = doSnap(w);
    if (sn && sn.pending) { drawOverlay(); return; }
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
    trackClear();   // nokta belirlendi: edinilmiş iz noktaları silinir (AutoCAD)
    S.snap = sn;
    updateMeasure();
    drawOverlay();
    return;
  }
  const hit = pick(w, TOL.pick / S.view.scale);
  // Köşe tutamakları açıkken boşta dokunuş nesneyi SEÇER (AutoCAD'in Command: istemindeki tıklama): tutamaklar
  // seçili nesnede çıkar, bilgi paneli açılmaz. Kip kapalıyken eski yol: vurgu + (ayara göre) bilgi paneli.
  if (edCall('gripTap', hit)) { S.selected = null; hide('infoPanel'); drawOverlay(); return; }
  S.selected = hit;
  drawOverlay();
  // Panelin dokunuşta açılması isteğe bağlıdır (Ayarlar › "Dokununca bilgi panelini aç").
  // Kapalıyken nesne yine vurgulanır; panel uzun basış menüsündeki "Çizim bilgisi" ile açılır.
  if (hit && uiPrefs().infoTap !== false) showInfo(hit); else hide('infoPanel');
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
/**
 * Etiket / değer satırları. Öğe: [etiket, değer, ham?, satırKimliği?]
 *  - ham verilirse değer HTML olarak konur (kaçışsız)
 *  - satırKimliği verilirse iki hücreye de data-row yazılır: koşullu satırlar
 *    (özel kâğıt ölçüsü, çözünürlük…) tek satırla gizlenip gösterilebilir
 *  - tek öğeli dizi tam genişlik bir blok üretir
 */
function kv(pairs) {
  return pairs.filter(p => p && (p.length === 1 || (p[1] !== null && p[1] !== undefined && p[1] !== ''))).map(p => {
    if (p.length === 1) return `<div class="full">${p[0]}</div>`;
    const r = p[3] ? ` data-row="${esc(p[3])}"` : '';
    return `<div class="k"${r}>${esc(p[0])}</div><div class="v"${r}>${p[2] ? p[1] : esc(String(p[1]))}</div>`;
  }).join('');
}
// Tek alt sayfa kuralı: #docPanel açılırken paket paneli kapanır. İkisi de .panel.bottom'dır ve paket paneli
// üç kartla ekranın yarısını kaplar; açık kalırsa altındaki panelin düğmelerini örter (Ayarlar › Kaydet erişilemez olur).
function openDoc(title, html) { Ed.closeProPanel(); $('docTitle').textContent = title; $('docBody').innerHTML = html; $('docBody').onclick = null; show('docPanel'); }
function copyText(text) {
  if (A() && A().copy) A().copy(text);
  else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  toast(t('copied'));
}
$('stCoord').addEventListener('click', () => { if (lastCoord) copyText(fmt(lastCoord[0]) + ';' + fmt(lastCoord[1])); });

// ---- nesne bilgisi ---------------------------------------------------------------
const trType = (x) => tt('ety_' + x, x);   // sözlükte yoksa DXF adının kendisi (LINE, HATCH…)
const zTxt = (z) => (z != null && isFinite(z) && z !== 0) ? ' ; Z ' + fmt(z) : '';
let infoPrim = null;
/**
 * Nesne bilgisi. İki görünüm vardır: KISA (öntanımlı) yalnız işi olan satırları verir,
 * AYRINTILI hepsini. Ayrım yerinde yapılır: temel satırlar 'rows'a, ikincil olanlar 'more'a
 * yazılır; panelin başındaki çip ikisini değiştirir ve seçim ui.infoFull'de saklanır.
 * Uzun listenin dokunur dokunmaz ekranı kaplaması bu yüzden son bulur.
 */
function showInfo(p) {
  infoPrim = p;
  const inf = p.info || {}, u = S.units ? ' ' + S.units : '';
  const rows = [], more = [];
  const top = inf.t || p.et, sub = p.et;
  $('infoTitle').textContent = trType(top) + (sub !== top ? ' › ' + trType(sub) : '');
  if (top === 'INSERT') {
    rows.push([t('block'), inf.name + (inf.blk ? '' : ' · DWG')], [t('insPoint'), fmt(inf.x) + ' ; ' + fmt(inf.y) + zTxt(inf.z)]);
    if (inf.sx !== 1 || inf.sy !== 1) more.push([t('scale'), fmt(inf.sx) + ' / ' + fmt(inf.sy)]);
    if (inf.rot) more.push([t('rotation'), fmt(inf.rot * 180 / Math.PI, 2) + '°']);
    if (inf.dyn && Object.keys(inf.dyn).length) more.push([t('bpParams'), Object.entries(inf.dyn).map(([k, v]) => k + ' = ' + (Array.isArray(v) ? v.map(q => fmt(q)).join(' ; ') : (typeof v === 'number' ? fmt(v) : String(v)))).join(', ')]);
  }
  if (p.xref) rows.push([t('xrefs'), p.xref]);
  if (top === 'DIMENSION') { rows.push([t('measVal'), inf.meas != null ? fmt(inf.meas) + u : null]); if (inf.text && inf.text !== '<>') rows.push([t('measText'), inf.text]); more.push([t('dimStyle'), inf.style]); }
  rows.push([t('layer'), p.lay]);
  const L = S.layers.get(p.lay);
  const colTxt = p.col === FG ? '7 (' + (S.dark ? t('white') : t('black')).toLocaleLowerCase(getLang()) + ')' : rgbCss(p.col, '');
  more.push([t('color'), (inf.ci === 256 ? t('fromLayer') + ' ' : inf.ci === 0 ? t('fromBlock') + ' ' : '') + colTxt]);
  more.push([t('ltype'), p.lt || (L ? L.lt : 'Continuous')]);
  if (p.lw != null) more.push([t('lweight'), fmt(p.lw / 100, 2) + ' mm']);
  if (p.k === 0) {
    const len = pathLength3(p.ops, p.closed);            // eğik (gerçek) boy
    const lenH = pathLength(p.ops, p.closed);            // yatay izdüşüm
    if (sub === 'CIRCLE' && p.ops[1]) { const o = p.ops[1]; rows.push([t('center'), fmt(o[1]) + ' ; ' + fmt(o[2])], [t('radius'), fmt(o[3]) + u], [t('area'), fmt(Math.PI * o[3] * o[3]) + (u ? u + '²' : '')]); more.push([t('circumference'), fmt(len) + u]); }
    else if (sub === 'ARC' && p.ops[1] && p.ops[1][0] === 2) { const o = p.ops[1]; rows.push([t('radius'), fmt(o[3]) + u], [t('arcLen'), fmt(len) + u], [t('angle'), fmt(((o[5] - o[4] + TAU) % TAU) * 180 / Math.PI, 2) + '°']); more.push([t('center'), fmt(o[1]) + ' ; ' + fmt(o[2])]); }
    else {
      const pts = flatten(p.ops);
      const first = pts[0], last = pts[pts.length - 1];
      rows.push([t('length'), fmt(len) + u]);
      // Kotlu bir yolda eğik boy ile yatay izdüşüm ayrışır; ikisi de okunmalıdır (boru boyu ↔ plan boyu)
      if (Math.abs(len - lenH) > Math.max(1e-9, len * 1e-9)) more.push([t('lengthH'), fmt(lenH) + u]);
      if (S.unitToM && S.unitToM !== 1) more.push([t('length') + ' (m)', fmt(len * S.unitToM, 2) + ' m']);
      if (sub === 'LINE' && first && last) { rows.push([t('start'), fmt(first[0]) + ' ; ' + fmt(first[1]) + zTxt(p.ops[0][3])], [t('end'), fmt(last[0]) + ' ; ' + fmt(last[1]) + zTxt(p.ops[1][3])]); more.push(['ΔX / ΔY', fmt(last[0] - first[0]) + ' / ' + fmt(last[1] - first[1])]); }
      else if (first) { rows.push([t('start'), fmt(first[0]) + ' ; ' + fmt(first[1])], [t('end'), fmt(last[0]) + ' ; ' + fmt(last[1])]); more.push([t('vertices'), p.ops.length]); }
      if (p.closed || p.fill) { rows.push([t('area'), fmt(polyArea(pts)) + (u ? u + '²' : '')]); more.push([t('closed'), t('yes')]); }
      if (p.w) more.push([t('width'), fmt(p.w) + u]);
      if (sub === 'HATCH') more.push([t('pattern'), inf.pattern]);
    }
  } else if (p.k === 1) {
    rows.push([t('textK'), p.lines.join('\n')], [t('position'), fmt(p.x) + ' ; ' + fmt(p.y)]);
    more.push([t('height'), fmt(p.h) + u], [t('rotation'), fmt(p.rot * 180 / Math.PI, 2) + '°']);
    if (sub === 'ATTRIB') more.push([t('tag'), inf.tag]);
  } else if (p.k === 3) rows.push([t('file'), inf.file]);
  else if (p.k === 5) {                                   // ağ gövdesi: konum yok, geometrisi dizilerde
    const b = p.bb;
    rows.push([t('size'), fmt(b[2] - b[0]) + ' × ' + fmt(b[3] - b[1]) + u],
      [t('center'), fmt((b[0] + b[2]) / 2) + ' ; ' + fmt((b[1] + b[3]) / 2)],
      [t('elev'), fmt(p.zmin) + ' … ' + fmt(p.zmax) + u]);
    more.push([t('triCount'), fmt(p.idx.length / 3, 0)], [t('vertices'), fmt(p.vtx.length / 3, 0)]);
  } else rows.push([t('position'), fmt(p.x) + ' ; ' + fmt(p.y) + zTxt(p.z)]);
  if (inf.attrs && inf.attrs.length) { more.push(['<strong>' + t('attrs') + '</strong>']); for (const a of inf.attrs) more.push([a[0] || '–', a[1]]); }
  if (inf.xd && inf.xd.length) { more.push(['<strong>' + t('xdata') + '</strong>']); for (const x of inf.xd) more.push([x[0], x[1]]); }
  more.push([t('handle'), inf.h]);
  const full = uiPrefs().infoFull === true;
  $('infoBody').innerHTML = kv(full ? rows.concat(more) : rows);
  ensureInfoActions();
  { const db = $('iaDetail'); if (db) { db.hidden = !more.length; db.classList.toggle('on', full); db.textContent = full ? tt('infoLess', 'Daha az') : tt('infoMore', 'Ayrıntılar') + ' (' + more.filter(r => r.length > 1).length + ')'; } }
  { const ab = $('iaArea'); if (ab) { ab.hidden = !(p.k === 5 && p.idx && p.idx.length >= 3); Ed.lockMark(ab, 'area3d', 'pill'); } }   // yüzey ölçüsü yalnız üçgen ağı olan gövdede; kilitliyse rozetli
  show('infoPanel');
}
/** Bilgi paneli eylem çipleri (başlık altı): Buradan ölç · Katmanı izole et · Aynı katmandakileri seç */
function ensureInfoActions() {
  const panel = $('infoPanel'); if (!panel || $('infoActions')) return;
  const row = document.createElement('div'); row.id = 'infoActions'; row.className = 'info-actions';
  row.innerHTML = `<button type="button" class="chip" data-ia="measure">${tt('measureFrom', 'Buradan ölç')}</button><button type="button" class="chip" data-ia="iso">${tt('isolate', 'Katmanı izole et')}</button><button type="button" class="chip" data-ia="samelayer">${tt('selectSameLayer', 'Aynı katmandakileri seç')}</button>`
    + `<button type="button" class="chip" id="iaArea" data-ia="area" hidden>${esc(t('surfArea'))}</button>`
    + `<button type="button" class="chip" id="iaDetail" data-ia="detail" hidden></button>`;
  const body = $('infoBody'); body.parentElement.insertBefore(row, body);
  row.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ia]'); if (!b || !infoPrim) return;
    const p = infoPrim;
    if (b.dataset.ia === 'measure') { const pts = p.k === 0 ? flatten(p.ops) : p.k === 5 ? [[(p.bb[0] + p.bb[2]) / 2, (p.bb[1] + p.bb[3]) / 2]] : [[p.x, p.y]]; hide('infoPanel'); setMode('measure'); if (pts[0]) { S.measure.push([pts[0][0], pts[0][1], undefined]); updateMeasure(); drawOverlay(); } }
    else if (b.dataset.ia === 'detail') { const u = uiPrefs(); u.infoFull = !u.infoFull; try { editorMod.applyUi(); } catch (_) { /* yok */ } showInfo(p); }
    else if (b.dataset.ia === 'area') showMeshArea(p);
    else if (b.dataset.ia === 'iso') isolateLayers([p.lay]);
    else if (b.dataset.ia === 'samelayer') {
      const same = S.prims.filter(q => q.lay === p.lay && q.k !== 4 && primVisible(q));
      if (editor.sel) { editor.sel.clear(); for (const q of same) editor.sel.add(q); }
      drawOverlay(); toast(same.length + ' ' + tt('selectedN', 'nesne seçildi'));
    }
  });
}
/**
 * Seçili üçgen ağın yüzey ölçüleri: toplam yüzey, yanal (düşey) yüzey, üst/alt plan izdüşümü ve
 * kapalı ağda hacim. Hesap geom.meshMetrics'tedir; burada yalnız birim çevirimi ve sunum vardır.
 * Hacim yalnız KAPALI (delik bırakmayan) ağda geçerlidir; panelde bu koşul açıkça yazılır.
 */
function showMeshArea(p) {
  if (!Ed.gate('area3d')) return;
  if (!p || p.k !== 5 || !p.idx || p.idx.length < 3) { toast(t('noResult')); return; }
  const m = meshMetrics(p.vtx, p.idx);
  const u = S.units ? ' ' + S.units : '';
  const a2 = u ? u + '²' : '', a3 = u ? u + '³' : '';
  const k = S.unitToM || 1, mm = k !== 1;
  // metrik karşılık küçük değerlerde iki basamakta sıfıra düşer; basamak değere göre açılır
  const met = (x, u2) => '  = ' + fmt(x, x >= 1 ? 2 : x >= 0.01 ? 4 : 6) + ' ' + u2;
  const ar = (v) => fmt(v) + a2 + (mm ? met(v * k * k, 'm²') : '');
  const vo = (v) => fmt(v) + a3 + (mm ? met(v * k * k * k, 'm³') : '');
  const rows = [
    [t('surfTotal'), ar(m.total)],
    [t('surfLateral'), ar(m.lateral)],
    [t('surfFlat'), ar(m.flat)],
    [t('surfTop'), ar(m.top)],
    [t('surfBottom'), ar(m.bottom)],
    [t('volume'), vo(m.volume)],
    [t('triCount'), fmt(m.tris, 0)],
    [`<div class="full muted">${esc(t('surfNote'))}</div>`],
    [`<div class="full btns"><button class="btn small" id="saCopy">${esc(tt('copyClip', 'Panoya kopyala'))}</button><button class="btn small" id="saShare">${esc(t('share'))}</button></div>`]];
  openDoc(t('surfArea'), kv(rows));
  const txt = [t('surfArea') + ' — ' + (S.fileName || ''), ...rows.slice(0, 7).map(r => r[0] + '\t' + r[1])].join('\n');
  $('saCopy').onclick = () => copyText(txt);
  $('saShare').onclick = () => { if (A() && A().shareText) A().shareText(t('surfArea'), txt); else copyText(txt); };
}
$('infoZoom').addEventListener('click', () => { if (infoPrim) { const b = infoPrim.bb; const m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.3 || 1; zoomExtents([b[0] - m, b[1] - m, b[2] + m, b[3] + m]); } });
$('infoCopy').addEventListener('click', () => {
  if (!infoPrim) return;
  const p = infoPrim, inf = p.info || {};
  let txt;
  if (p.k === 0) txt = flatten(p.ops).map(q => fmt(q[0]) + ';' + fmt(q[1])).join('\n');
  else if (p.k === 5) txt = fmt((p.bb[0] + p.bb[2]) / 2) + ';' + fmt((p.bb[1] + p.bb[3]) / 2) + ';' + fmt((p.zmin + p.zmax) / 2);
  else if (inf.t === 'INSERT') txt = fmt(inf.x) + ';' + fmt(inf.y) + (inf.z ? ';' + fmt(inf.z) : '');
  else txt = fmt(p.x) + ';' + fmt(p.y);
  copyText(txt);
});

// ---- ölçü / profil --------------------------------------------------------------------
function setMode(m) {
  if (m === 'profile' && !Ed.gate('profile')) return;
  if (m !== 'view' && S.notesOn) toggleNotes(false);
  S.mode = m;
  trackClear();   // kip değişince edinilmiş iz noktaları kalmaz
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
/*
 * İki ölçüm noktası arasındaki mesafe. Yakalama (osnap) kotu getirdiğinde eğik mesafe verilir;
 * serbest dokunuşta kot bilinmediği için Δz sıfır sayılır ve sonuç 2B ölçümle birebir aynı kalır.
 */
function segLen(a, b) {
  const za = a[2], zb = b[2];
  const dz = (za != null && isFinite(za) && zb != null && isFinite(zb)) ? zb - za : 0;
  const dxy = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { dxy, dz, d: dz ? Math.hypot(dxy, dz) : dxy };
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
      const sl = segLen(m[i - 1], m[i]), d = sl.d; total += d;
      const ang = Math.atan2(m[i][1] - m[i - 1][1], m[i][0] - m[i - 1][0]) * 180 / Math.PI;
      rows.push([`${i} → ${i + 1}`, `${fmt(d)}${u}   (ΔX ${fmt(m[i][0] - m[i - 1][0])}, ΔY ${fmt(m[i][1] - m[i - 1][1])}` + (sl.dz ? `, ΔZ ${fmt(sl.dz)}` : '') + `, ${fmt(ang, 2)}°)` + (sl.dz ? `   ${t('lengthH')} ${fmt(sl.dxy)}${u}` : '') + (S.unitToM && S.unitToM !== 1 ? `  = ${fmt(d * S.unitToM, 2)} m` : '')]);
    }
    if (m.length > 2) {
      const closing = segLen(m[m.length - 1], m[0]).d;
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
    acts.innerHTML = `<button type="button" class="chip" id="measureCopy">${tt('copyClip', 'Panoya kopyala')}</button>`
      + `<button type="button" class="chip" id="measureShare">${esc(t('share'))}</button>`
      + `<button type="button" class="chip" id="measureCsv">${esc(t('exportCsv'))}</button>`;
    const body = $('measureBody'); body.parentElement.insertBefore(big, body); body.parentElement.insertBefore(acts, body);
    $('measureCopy').addEventListener('click', () => copyText(measureText()));
    $('measureShare').addEventListener('click', () => shareMeasure());
    $('measureCsv').addEventListener('click', () => saveTextFile('\ufeff' + measureCsv(), baseName() + '_olcum_' + stamp() + '.csv', 'text/csv'));
  }
  const m = S.measure, u = S.units ? ' ' + S.units : '';
  if (!m.length) { big.hidden = true; acts.hidden = true; return; }
  big.hidden = false; acts.hidden = false;
  if (S.mode === 'profile') { big.textContent = rows.length ? rows[rows.length - 1][1] : ''; return; }
  const last = m.length > 1 ? segLen(m[m.length - 2], m[m.length - 1]).d : 0;
  let s = m.length > 1 ? fmt(last) + u : fmt(m[0][0]) + ' ; ' + fmt(m[0][1]);
  if (m.length > 2) s += '   Σ ' + fmt(total) + u + '   A ' + fmt(polyArea(m)) + (u ? u + '²' : '');
  else if (m.length === 2 && S.unitToM && S.unitToM !== 1) s += '  = ' + fmt(last * S.unitToM, 2) + ' m';
  big.textContent = s;
}
/**
 * Ölçüm panelinin metin dökümü: başlık, dosya adı ve panelde yazılı ne varsa.
 * Kopyalama da paylaşım da aynı metni kullanır; iki yerde ayrı biçim tutulmaz.
 */
function measureText() {
  const head = (S.mode === 'profile' ? t('profile') : t('measure')) + (S.fileName ? ' — ' + S.fileName : '');
  const body = [...$('measureBody').querySelectorAll('.k, .v, .full')].reduce((a, el, i, arr) => {
    if (el.classList.contains('k')) a.push(el.textContent + '\t' + (arr[i + 1] ? arr[i + 1].textContent : ''));
    else if (el.classList.contains('full')) a.push(el.textContent);
    return a;
  }, []).join('\n');
  const big = $('measureBig');
  return [head, big && !big.hidden ? big.textContent : '', body].filter(Boolean).join('\n');
}
/*
 * Ölçüm dökümünün CSV'si. Metin dökümü (measureText) panelden kazınır ve okunmak içindir;
 * CSV hesap tablosuna girer, o yüzden PANELDEN DEĞİL ÖLÇÜM VERİSİNDEN üretilir: her parça
 * kendi satırında, koordinatlar ve Δ'lar ayrı sütunlarda. Ayraç noktalı virgüldür (Excel'in
 * Türkçe yerelinde sütunlara doğru düşer), ondalık ayracı fmt() ile yerelden gelir.
 */
function measureCsv() {
  const m = S.measure, u = S.units || '';
  const L = [];
  L.push([t('measure'), S.fileName || ''].map(csvCell).join(';'));
  L.push([t('unit'), u].map(csvCell).join(';'));
  L.push('');
  if (S.mode === 'profile') {
    const k = S.unitToM || 1;
    L.push(['#', 'X', 'Y', t('elev') + ' (m)', 'L (m)', 'Δh (m)', t('slopeLbl') + ' (‰)', 'Σ (m)'].map(csvCell).join(';'));
    let cum = 0;
    for (let i = 0; i < m.length; i++) {
      const Lm = i ? Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]) * k : 0;
      cum += Lm;
      const dh = i ? m[i][2] - m[i - 1][2] : 0;
      L.push([i + 1, fmt(m[i][0]), fmt(m[i][1]), fmt(m[i][2], 2), i ? fmt(Lm, 2) : '', i ? fmt(dh, 3) : '',
        i && Lm > 0 ? fmt(dh / Lm * 1000, 2) : '', fmt(cum, 2)].map(csvCell).join(';'));
    }
    return L.join('\r\n');
  }
  L.push([t('segmentN'), 'X1', 'Y1', 'Z1', 'X2', 'Y2', 'Z2', 'ΔX', 'ΔY', 'ΔZ',
    t('lengthH') + (u ? ' (' + u + ')' : ''), t('length') + (u ? ' (' + u + ')' : ''), t('angle') + ' (°)'].map(csvCell).join(';'));
  let total = 0;
  const zs = (v) => (v != null && isFinite(v) ? fmt(v) : '');
  for (let i = 1; i < m.length; i++) {
    const a2 = m[i - 1], b2 = m[i], sl = segLen(a2, b2);
    total += sl.d;
    L.push([i, fmt(a2[0]), fmt(a2[1]), zs(a2[2]), fmt(b2[0]), fmt(b2[1]), zs(b2[2]),
      fmt(b2[0] - a2[0]), fmt(b2[1] - a2[1]), sl.dz ? fmt(sl.dz) : '',
      fmt(sl.dxy), fmt(sl.d), fmt(Math.atan2(b2[1] - a2[1], b2[0] - a2[0]) * 180 / Math.PI, 2)].map(csvCell).join(';'));
  }
  if (m.length === 1) L.push([1, fmt(m[0][0]), fmt(m[0][1]), zs(m[0][2])].map(csvCell).join(';'));
  L.push('');
  if (m.length > 1) L.push([t('total'), fmt(total)].map(csvCell).join(';'));
  if (m.length > 2) {
    L.push([t('closedPerim'), fmt(total + segLen(m[m.length - 1], m[0]).d)].map(csvCell).join(';'));
    L.push([t('areaClosed'), fmt(polyArea(m))].map(csvCell).join(';'));
  }
  return L.join('\r\n');
}
/** Ölçümü başka uygulamaya gönderir (köprü yoksa panoya kopyalar) */
function shareMeasure() {
  const txt = measureText();
  if (A() && A().shareText) { A().shareText(S.mode === 'profile' ? t('profile') : t('measure'), txt); return; }
  if (navigator.share) { navigator.share({ title: t('measure'), text: txt }).catch(() => copyText(txt)); return; }
  copyText(txt);
}
$('btnMeasure').addEventListener('click', () => setMode(S.mode === 'measure' ? 'view' : 'measure'));
$('btnMeasureClear').addEventListener('click', () => { S.measure = []; S.snap = null; updateMeasure(); drawOverlay(); });
$('btnMeasureUndo').addEventListener('click', () => { S.measure.pop(); S.snap = null; updateMeasure(); drawOverlay(); });
$('btnMeasureClose').addEventListener('click', () => setMode('view'));
/*
 * Nesne yakalama modülü: çalışan kipler, bir kerelik geçersiz kılma, ayar kutusu. Kipler değişince
 * ölçü panelindeki çip şeridi, durum çubuğu düğmesi ve şerit karosu birlikte tazelenir.
 */
Osnap.init({ S, t, esc, openDoc, hide, toast, haptic, settings, saveSettings, widgets: D.widgets,
  changed: () => { Osnap.renderBar($('snapBar')); edCall('snapChanged'); } });

// ---- katmanlar -----------------------------------------------------------------------
const layerUi = { sort: 'name', onlyVis: false, sel: null };   // sel: yöneticide seçili satır (Sil / Geçerli yap / İzole et hedefi)
/*
 * KATMAN YÖNETİCİSİ — AutoCAD Layer Properties Manager düzeni.
 * Her satır: Durum (geçerli katman ✓) · Ad · Açık (ampul) · Dondur (güneş/kar tanesi) · Kilit ·
 * Renk · Çizgi tipi · Kalınlık · Sayı. Her hücre doğrudan düzenlenir: ampul, kar tanesi ve kilit
 * dokununca değişir; renk, çizgi tipi ve kalınlık kendi seçicisini açar; ada dokunmak satırı
 * SEÇER (Sil / Geçerli yap / İzole et bu seçime uygulanır), uzun basış menüyü, çift dokunuş
 * yeniden adlandırmayı açar. Bütün değişiklikler düzenleme günlüğünden geçer: geri alınır,
 * DXF'e yazılır. Görünürlük türetilir (bkz. display.syncLayerVisible); satır "hid" sınıfıyla
 * soluk görünür ama hangi bayrağın gizlediği (kapalı / donuk / izolasyon) simgelerden okunur.
 */
const LW_LIST = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];   // AutoCAD standart kalınlıkları (0,01 mm)
const lwText = (lw) => ((lw == null ? 25 : lw) / 100).toFixed(2);
function buildLayerList() {
  const q = ($('layerFilter').value || '').toLowerCase();
  const sortSel = $('layerSort'); if (sortSel) layerUi.sort = sortSel.value === 'count' ? 'count' : 'name';
  const ov = $('layerOnlyVis'); const ovIn = ov && ov.querySelector('input'); if (ovIn) layerUi.onlyVis = ovIn.checked;
  const list = [...S.layers.values()].sort((a, b) => layerUi.sort === 'count' ? (b.count - a.count) || a.name.localeCompare(b.name, 'tr') : a.name.localeCompare(b.name, 'tr'));
  $('layerCount').textContent = list.length + ' ' + t('layerCount');
  if (layerUi.sel && !S.layers.has(layerUi.sel)) layerUi.sel = null;
  const fg = fgColor(), pal = S.colorMode === 'layer', cur = (editor && editor.curLayer) || '0';
  const ic = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
  // sütun başlığı (yalnız geniş panelde görünür): 40 px'lik hücrelere metin sığmaz, dört durum sütunu simgeyle başlıklanır
  const hl = (id, key) => `<span title="${esc(t(key))}">${ic(id)}</span>`;
  const head = `<div class="lhead" aria-hidden="true"><span class="lc-cur">${esc(t('status'))}</span><span class="lc-name">${esc(t('layer'))}</span><span class="lctl">${hl('i-bulb', 'layerOn')}${hl('i-snow', 'layerFreeze')}${hl('i-lock', 'lock')}${hl('i-palette', 'color')}<span class="hl-lt">${esc(t('ltype'))}</span><span class="hl-lw">${esc(t('lweight'))}</span></span><span class="lc-ct">${esc(t('count'))}</span></div>`;
  const rows = list.filter(l => (!q || l.name.toLowerCase().includes(q)) && (!layerUi.onlyVis || l.visible)).map(l => {
    const n = esc(l.name), isCur = l.name === cur;
    return `<div class="lrow${isCur ? ' cur' : ''}${l.name === layerUi.sel ? ' sel' : ''}${l.visible ? '' : ' hid'}${l.frozen ? ' frozen' : ''}${l.locked ? ' locked' : ''}${l.faded ? ' faded' : ''}" data-layer-row="${n}" role="row">`
      + `<button type="button" class="lc-cur" data-lcur="${n}" title="${esc(t('makeCurrent'))}" aria-label="${esc(t('makeCurrent'))}${isCur ? ' ✓' : ''}" aria-pressed="${isCur}">${isCur ? ic('i-check') : ''}</button>`
      + `<span class="lc-name" data-lname="${n}" tabindex="0">${n}</span><span class="lc-ct">${l.count}</span>`
      + `<span class="lctl">`
      + `<button type="button" class="lc ${l.off ? 'st-off' : 'st-on'}" data-lon="${n}" title="${esc(l.off ? t('layerOff') : t('layerOn'))}" aria-label="${esc(t('layerOn'))}" aria-pressed="${!l.off}">${ic(l.off ? 'i-bulb-off' : 'i-bulb')}</button>`
      + `<button type="button" class="lc ${l.frozen ? 'st-frozen' : ''}" data-lfrz="${n}" title="${esc(l.frozen ? t('layerThaw') : t('layerFreeze'))}" aria-label="${esc(t('layerFreeze'))}" aria-pressed="${!!l.frozen}">${ic(l.frozen ? 'i-snow' : 'i-sunny')}</button>`
      + `<button type="button" class="lc ${l.locked ? 'st-locked' : ''}" data-llock="${n}" title="${esc(l.locked ? t('unlock') : t('lock'))}" aria-label="${esc(t('lock'))}" aria-pressed="${!!l.locked}">${ic(l.locked ? 'i-lock' : 'i-unlock')}</button>`
      + `<button type="button" class="lc lc-sw" data-lcolor="${n}" title="${esc(t('color'))}" aria-label="${esc(t('color'))}"><i class="sw" style="background:${pal ? D.layerPalette(l.name) : rgbCss(l.color, fg)}"></i></button>`
      + `<button type="button" class="lc lc-lt" data-llt="${n}" title="${esc(t('ltype'))}: ${esc(l.lt || 'Continuous')}">${esc(l.lt || 'Continuous')}</button>`
      + `<button type="button" class="lc lc-lw" data-llw="${n}" title="${esc(t('lweight'))} (mm)">${lwText(l.lw)}</button>`
      + `</span></div>`;
  }).join('');
  $('layerList').innerHTML = head + (rows || `<div class="muted">${t('noResult')}</div>`);
  const un = $('btnLayersUniso'); if (un) un.hidden = !isIsolated();
  syncLayerActions();
}
/** Seçime bağlı düğmeler (Sil / Geçerli yap / İzole et) ve seçili ad etiketi */
function syncLayerActions() {
  const sn = $('layerSelName'); if (sn) sn.textContent = layerUi.sel ? layerUi.sel : '';
  const del = $('btnLayerDel'), curB = $('btnLayerCur'), isoB = $('btnLayerIso');
  if (del) del.disabled = !layerUi.sel; if (curB) curB.disabled = !layerUi.sel; if (isoB) isoB.disabled = !layerUi.sel;
}
/** Katman durumunu toplu işlemle değiştirir (geri alınabilir); düzenleme belgesi yoksa uyarır */
function layerState(names, durum) {
  const ok = edCall('layerSet', names, durum);
  if (!ok) { toast(t('error'), { type: 'error' }); return false; }
  S.cacheValid = false; buildLayerList(); requestRender();
  return true;
}
/** Satır seçimi listeyi YENİDEN KURMAZ: çift dokunuşun ikinci dokunuşu ve F2 aynı öğede kalır, kaydırma sıçramaz */
function layerSelect(name) {
  layerUi.sel = name;
  for (const r of document.querySelectorAll('#layerList .lrow')) r.classList.toggle('sel', r.dataset.layerRow === name);
  syncLayerActions();
}
function layerSetCurrent(name) {
  if (!S.layers.has(name)) return;
  if (edCall('setCurLayer', name) === undefined) editor.curLayer = name;
  toast(tt('curLayerSet', 'Geçerli katman') + ': ' + name, 1400);
  S.cacheValid = false; buildLayerList(); requestRender();
}
/** Yeni katman: AutoCAD'deki gibi Katman1, Katman2… önerilir; seçili satır varsa rengi, çizgi tipi ve kalınlığı ondan alınır */
async function layerNew() {
  if (!S.hasDoc) { toast(t('openFirst')); return; }
  if (!Ed.gate('layer')) return;
  const def = edCall('nextLayerName') || (t('layerDefaultName') + '1');
  const ad = await askText(t('newLayer'), def, { ph: t('layerNamePh') });
  const name = String(ad == null ? '' : ad).trim();
  if (!name) return;
  if (S.layers.has(name)) { toast(t('layerExists'), { type: 'warn' }); return; }
  const kaynak = layerUi.sel ? S.layers.get(layerUi.sel) : null;
  const cmd = { op: 'layer', name, color: kaynak ? aciOf(kaynak.color, null) : -1 };
  if (kaynak) { cmd.lt = kaynak.lt || 'Continuous'; cmd.lw = kaynak.lw == null ? 25 : kaynak.lw; }
  if (!edCall('runCmd', cmd)) { toast(t('error'), { type: 'error' }); return; }
  layerUi.sel = name;
  S.cacheValid = false; buildLayerList(); requestRender();
  toast(t('layerCreated') + ': ' + name, { type: 'ok' });
}
/** Seçili katmanı siler: '0' ve geçerli katman korunur (AutoCAD kuralı); boş katman sorulmadan silinir */
async function layerDeleteSel() {
  const name = layerUi.sel; if (!name) { toast(t('layerSelectFirst')); return; }
  const cur = (editor && editor.curLayer) || '0';
  if (name === cur) { toast(t('layerCurrentNoDel'), { type: 'warn' }); return; }
  if (name === '0') { toast(t('layer0Protected'), { type: 'warn' }); return; }
  const n = S.prims.filter(p => p.lay === name && p.k !== 4 && !p.inf).length;
  if (n > 0) { await layerDelete(name); return; }
  if (!Ed.gate('layeredit')) return;
  if (!edCall('runCmd', { op: 'layerdel', name, mode: 'move' })) { toast(t('error'), { type: 'error' }); return; }
  layerUi.sel = null;
  S.cacheValid = false; buildLayerList(); requestRender();
  toast(t('layerDeleted') + ': ' + name, { type: 'ok' });
}
async function layerRename(name) {
  if (name === '0') { toast(t('layer0Protected'), { type: 'warn' }); return; }
  if (!Ed.gate('layeredit')) return;
  const ad = await askText(t('layerRename') + ': ' + name, name);
  const yeni = String(ad == null ? '' : ad).trim();
  if (!yeni || yeni === name) return;
  if (S.layers.has(yeni)) { toast(t('layerExists'), { type: 'warn' }); return; }
  const seciliydi = layerUi.sel === name;   // komut çalışırken layersChanged kancası listeyi kurar ve eski adı bulamayınca seçimi düşürür; önce ölçülür
  if (!edCall('runCmd', { op: 'layerprops', name, newName: yeni })) { toast(t('error'), { type: 'error' }); return; }
  if (seciliydi) layerUi.sel = yeni;
  S.cacheValid = false; buildLayerList(); requestRender();
  toast(t('layerUpdated') + ': ' + yeni, { type: 'ok' });
}
/** Renk seçici: AutoCAD "Select Color › Index Color" gibi 255 ACI rengi; üstte 1-9 standart renkler büyük */
function layerPickColor(name) {
  const l = S.layers.get(name); if (!l) return;
  if (!Ed.gate('layeredit')) return;
  const cur = aciOf(l.color, null);
  const hex = (i) => (i === 7 ? '#ffffff' : '#' + (ACI[i] & 0xffffff).toString(16).padStart(6, '0'));
  const std = ACI_SECIM.slice(0, 9).map(([i, ad]) => `<button type="button" data-ci="${i}" class="${+i === cur ? 'active' : ''}" style="background:${hex(+i)}" title="${esc(ad)}">${i}</button>`).join('');
  let grid = '';
  for (let i = 10; i <= 255; i++) grid += `<button type="button" data-ci="${i}" class="${i === cur ? 'active' : ''}" style="background:${hex(i)}" title="${i}"></button>`;
  openDoc(t('colorSelect') + ': ' + name, `<div class="full aci-std">${std}</div><div class="full aci-grid">${grid}</div>`
    + `<div class="full muted" style="margin-top:8px">${esc(t('colorHint'))} <input id="lcCi" type="number" min="1" max="255" style="width:90px" value="${cur >= 1 && cur <= 255 ? cur : ''}"> <button class="btn small" id="lcCiOk">${esc(t('ok'))}</button></div>`);
  const uygula = (ci) => {
    if (!(ci >= 1 && ci <= 255)) return;
    hide('docPanel');
    if (!edCall('runCmd', { op: 'layerprops', name, color: ci })) { toast(t('error'), { type: 'error' }); return; }
    S.cacheValid = false; buildLayerList(); requestRender();
  };
  $('docBody').onclick = (ev) => { const b = ev.target.closest('[data-ci]'); if (b) uygula(Number(b.dataset.ci)); };
  $('lcCiOk').onclick = () => uygula(parseInt($('lcCi').value, 10));
}
/** Çizgi tipi seçici: dosyanın LTYPE tablosundaki adlar (DXF'e ancak tanımlı tip yazılabilir) */
function layerPickLt(name) {
  const l = S.layers.get(name); if (!l) return;
  if (!Ed.gate('layeredit')) return;
  const adlar = ['Continuous', ...Object.values(S.ltypes || {}).map(x => x.name).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);
  const cur = l.lt || 'Continuous';
  openDoc(t('ltSelect') + ': ' + name, `<div class="full list ctx-list pick-list">${adlar.map(a => `<div class="item${a === cur ? ' active' : ''}" data-lt="${esc(a)}"><span class="lt-prev" style="border-top-style:${a === 'Continuous' ? 'solid' : 'dashed'}"></span>${esc(a)}</div>`).join('')}</div>`);
  $('docBody').onclick = (ev) => {
    const it = ev.target.closest('[data-lt]'); if (!it) return;
    hide('docPanel');
    if (it.dataset.lt === cur) return;
    if (!edCall('runCmd', { op: 'layerprops', name, lt: it.dataset.lt })) { toast(t('error'), { type: 'error' }); return; }
    S.cacheValid = false; buildLayerList(); requestRender();
  };
}
/** Kalınlık seçici: AutoCAD'in standart kalınlık listesi (mm), çizgi kalınlığı örneğiyle */
function layerPickLw(name) {
  const l = S.layers.get(name); if (!l) return;
  if (!Ed.gate('layeredit')) return;
  const cur = l.lw == null ? 25 : l.lw;
  openDoc(t('lwSelect') + ': ' + name, `<div class="full list ctx-list pick-list">${LW_LIST.map(w => `<div class="item${w === cur ? ' active' : ''}" data-lw="${w}"><span class="lw-bar" style="height:${Math.max(1, Math.round(w / 20))}px"></span>${lwText(w)} mm${w === 25 ? ' · ' + esc(t('lwDefault')) : ''}</div>`).join('')}</div>`);
  $('docBody').onclick = (ev) => {
    const it = ev.target.closest('[data-lw]'); if (!it) return;
    hide('docPanel');
    const w = Number(it.dataset.lw); if (w === cur) return;
    if (!edCall('runCmd', { op: 'layerprops', name, lw: w })) { toast(t('error'), { type: 'error' }); return; }
    S.cacheValid = false; buildLayerList(); requestRender();
  };
}
$('layerList').addEventListener('click', (ev) => {
  const b = ev.target.closest('button, [data-lname]'); if (!b) return;
  const d = b.dataset;
  if (d.lname != null) { layerSelect(d.lname); return; }
  if (d.lcur != null) { layerSetCurrent(d.lcur); return; }
  if (d.lon != null) { const l = S.layers.get(d.lon); if (l) layerState([d.lon], { off: !l.off }); return; }
  if (d.lfrz != null) { const l = S.layers.get(d.lfrz); if (l) layerState([d.lfrz], { frozen: !l.frozen }); return; }
  if (d.llock != null) { const l = S.layers.get(d.llock); if (l) layerState([d.llock], { locked: !l.locked }); return; }
  if (d.lcolor != null) { layerPickColor(d.lcolor); return; }
  if (d.llt != null) { layerPickLt(d.llt); return; }
  if (d.llw != null) { layerPickLw(d.llw); return; }
});
$('layerList').addEventListener('dblclick', (ev) => { const n = ev.target.closest('[data-lname]'); if (n) void layerRename(n.dataset.lname); });
$('layerList').addEventListener('keydown', (ev) => { const n = ev.target.closest('[data-lname]'); if (!n) return; if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); layerSelect(n.dataset.lname); } else if (ev.key === 'F2') { ev.preventDefault(); void layerRename(n.dataset.lname); } });
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
  layerUi.sel = name;
  const items = [['fit', tt('fitLayer', 'Katmana sığdır')], ['cur', tt('makeCurrent', 'Geçerli katman yap')], ['iso', tt('onlyThis', 'Yalnız bu')], ['fade', l.faded ? tt('unfade', 'Soldurmayı kaldır') : tt('fadeLayer', 'Soldur')], ['lock', l.locked ? tt('unlock', 'Kilidi aç') : tt('lock', 'Kilitle')],
    ['rename', t('layerRename')], ['props', t('layerEdit')], ['del', t('layerDelete')]];
  openDoc(t('layer') + ': ' + name, `<div class="full list ctx-list">${items.map(i => `<div class="item" data-lm="${i[0]}">${esc(i[1])}</div>`).join('')}</div>`);
  $('docBody').onclick = (ev) => {
    const it = ev.target.closest('[data-lm]'); if (!it) return;
    hide('docPanel');
    switch (it.dataset.lm) {
      case 'fit': { const bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of S.prims) { if (p.lay !== name || p.k === 4 || p.inf) continue; const b = p.bb; if (b[0] < bb[0]) bb[0] = b[0]; if (b[1] < bb[1]) bb[1] = b[1]; if (b[2] > bb[2]) bb[2] = b[2]; if (b[3] > bb[3]) bb[3] = b[3]; } if (isFinite(bb[0])) { const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.1 || 1; zoomExtents([bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m]); } else toast(tt('layerEmpty', 'Katmanda nesne yok')); break; }
      case 'cur': layerSetCurrent(name); break;
      case 'iso': isolateLayers([name]); break;
      case 'fade': setLayerFaded(name, !l.faded); break;
      case 'lock': layerState([name], { locked: !l.locked }); break;
      case 'rename': void layerRename(name); break;
      case 'props': void layerProps(name); break;
      case 'del': void layerDelete(name); break;
      default: break;
    }
  };
}
// Standart ACI renkleri: kutuda ad yerine numara ve örnek gösterilir; 256 "değiştirme" demektir
const ACI_SECIM = [[1, 'Kırmızı'], [2, 'Sarı'], [3, 'Yeşil'], [4, 'Camgöbeği'], [5, 'Mavi'], [6, 'Macenta'], [7, 'Siyah / beyaz'], [8, 'Koyu gri'], [9, 'Açık gri'], [30, 'Turuncu'], [140, 'Çelik mavisi'], [250, 'Gri']]
  .map(([i, ad]) => [String(i), i + ' · ' + ad]);
/*
 * KATMANIN KENDİSİNİ DÜZENLEME. Bugüne kadar katman paneli yalnız görünürlük ve izolasyon
 * yapıyordu; katmanın adı, rengi, çizgi tipi, kalınlığı ve dondurma durumu değiştirilemiyordu.
 * Hepsi TEK kutuda toplanır ve tek geri alma adımı üretir. '0' katmanı yeniden adlandırılamaz:
 * DXF'te ayrılmış addır ve "katmandan" renk çözümlemesinin dayanağıdır.
 */
async function layerProps(name) {
  const l = S.layers.get(name); if (!l) return;
  if (!Ed.gate('layeredit')) return;
  const lts = ['Continuous', ...Object.keys(S.ltypes || {})].filter((v, i, a) => a.indexOf(v) === i).slice(0, 40);
  const r = await askForm(t('layer') + ': ' + name, [
    { id: 'name', label: t('layerNewName'), value: name, hint: name === '0' ? t('layer0Protected') : '' },
    { id: 'color', label: t('color'), type: 'select', value: '256',
      options: [['256', t('noChange')], ...ACI_SECIM] },
    { id: 'lt', label: t('ltype'), type: 'select', value: l.lt || 'Continuous', options: lts.map(x => [x, x]) },
    { id: 'lw', label: t('lweight') + ' (mm)', type: 'number', value: String(((l.lw == null ? 25 : l.lw) / 100).toFixed(2)) },
    { id: 'frozen', label: t('layerFreeze'), type: 'check', value: !!l.frozen },
    { id: 'locked', label: t('lock'), type: 'check', value: !!l.locked },
  ], { ok: t('save') });
  if (!r) return;
  const cmd = { op: 'layerprops', name };
  const yeni = String(r.name || '').trim();
  if (name !== '0' && yeni && yeni !== name) {
    if (S.layers.has(yeni)) { toast(t('layerExists'), { type: 'warn' }); return; }
    cmd.newName = yeni;
  }
  const ci = parseInt(r.color, 10);
  if (isFinite(ci) && ci !== 256) cmd.color = ci;
  if (r.lt && r.lt !== l.lt) cmd.lt = r.lt;
  const lw = parseFloat(String(r.lw).replace(',', '.'));
  if (isFinite(lw) && lw >= 0) cmd.lw = Math.round(lw * 100);
  cmd.frozen = !!r.frozen; cmd.locked = !!r.locked;
  if (!edCall('runCmd', cmd)) { toast(t('error'), { type: 'error' }); return; }
  S.cacheValid = false; buildLayerList(); requestRender();
  toast(t('layerUpdated') + ': ' + (cmd.newName || name), { type: 'ok' });
}
/** Katman silme: içindeki nesneler '0'a taşınır (varsayılan) ya da birlikte silinir */
async function layerDelete(name) {
  if (name === '0') { toast(t('layer0Protected'), { type: 'warn' }); return; }
  const l = S.layers.get(name); if (!l) return;
  if (!Ed.gate('layeredit')) return;
  const n = S.prims.filter(p => p.lay === name && p.k !== 4 && !p.inf).length;
  const r = await askForm(t('layerDelete') + ': ' + name, [
    { id: 'mode', label: t('layerDelMode'), type: 'select', value: 'move',
      options: [['move', t('layerDelMove')], ['ents', t('layerDelEnts') + (n ? ' (' + fmt(n, 0) + ')' : '')]] },
  ], { ok: t('delete') });
  if (!r) return;
  if (r.mode === 'ents' && n > 0 && !(await askConfirm(t('layerDelAsk') + ' ' + name + ' · ' + fmt(n, 0)))) return;
  if (!edCall('runCmd', { op: 'layerdel', name, mode: r.mode })) { toast(t('error'), { type: 'error' }); return; }
  S.cacheValid = false; buildLayerList(); requestRender();
  toast(t('layerDeleted') + ': ' + name, { type: 'ok' });
}
for (const [id, fn] of [['btnLayersUniso', () => unisolate()], ['btnLayersInvert', () => { const on = [], off = []; for (const l of S.layers.values()) (l.off ? on : off).push(l.name); layerInvert(on, off); }],
  ['btnLayerNew', () => void layerNew()], ['btnLayerDel', () => void layerDeleteSel()], ['btnLayerCur', () => { if (layerUi.sel) layerSetCurrent(layerUi.sel); else toast(t('layerSelectFirst')); }], ['btnLayerIso', () => { if (layerUi.sel) isolateLayers([layerUi.sel]); else toast(t('layerSelectFirst')); }]]) { const b = $(id); if (b) b.addEventListener('click', fn); }
/** Ters çevir: açıkları kapatır, kapalıları açar — tek geri alma adımı */
function layerInvert(acilacak, kapanacak) {
  const items = [...acilacak.map(name => ({ name, off: false })), ...kapanacak.map(name => ({ name, off: true }))];
  if (!items.length) return;
  if (!edCall('runCmd', { op: 'layerbulk', items })) { toast(t('error'), { type: 'error' }); return; }
  S.cacheValid = false; buildLayerList(); requestRender();
}
{ const ss = $('layerSort'); if (ss) ss.addEventListener('change', buildLayerList); const ov = $('layerOnlyVis'); if (ov) ov.addEventListener('change', buildLayerList); }
$('layerFilter').addEventListener('input', buildLayerList);
$('btnLayersAll').addEventListener('click', () => { if (isIsolated()) unisolate(); layerState([...S.layers.keys()], { off: false, frozen: false }); });
$('btnLayersNone').addEventListener('click', () => layerState([...S.layers.keys()], { off: true }));
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
/*
 * Arama katlaması. Düz toLowerCase Türkçe'de yanlış eşleştirir: 'İ' → 'i̇' (i + birleşen nokta)
 * olur ve 'i' ile eşleşmez, 'I' ise 'i' olur ama Türkçe'de 'ı' olmalıdır. Bu yüzden 'DEĞİŞECEK'
 * yazan bir not "değişecek" aramasında bulunamıyordu. Türkçe kuralıyla küçültülür, birleşen
 * nokta atılır ve 'ı' ile 'i' aynı sayılır: aramada fazla eşleşmek, kaçırmaktan iyidir.
 * (Bul-değiştir aynı kuralı kullanmaz — orada konum kayması olmaması için dizi uzunluğu korunur.)
 */
const araKatla = (x) => String(x == null ? '' : x).toLocaleLowerCase('tr').replace(/\u0307/g, '').replace(/ı/g, 'i');
function doSearch() {
  const q = araKatla(($('searchInput').value || '').trim());
  const body = $('searchBody');
  if (!q) { body.innerHTML = ''; return; }
  const res = [];
  const prims = S.prims;
  for (let i = 0; i < prims.length && res.length < 200; i++) {
    const p = prims[i], inf = p.info || {};
    if (p.k === 4 || !primVisible(p)) continue;
    let hit = null;
    if (p.k === 1 && araKatla(p.lines.join(' ')).includes(q)) hit = p.lines.join(' ');   // gösterilen metin ÖZGÜN hâlidir, katlanmış değil
    else if (inf.h && araKatla(inf.h) === q) hit = 'handle ' + inf.h;
    else if (inf.name && araKatla(inf.name).includes(q)) hit = t('block') + ': ' + inf.name;
    else if (inf.attrs && inf.attrs.some(a => araKatla(a[1]).includes(q) || araKatla(a[0]).includes(q))) hit = inf.attrs.filter(a => araKatla(a[1]).includes(q) || araKatla(a[0]).includes(q)).map(a => a[0] + '=' + a[1]).join(', ');
    else if (inf.xd && inf.xd.some(x => araKatla(x[1]).includes(q))) hit = 'XDATA: ' + inf.xd.find(x => araKatla(x[1]).includes(q))[1].slice(0, 80);
    else if (p.k !== 1 && araKatla(p.lay).includes(q) && res.length < 60) hit = t('layer') + ': ' + p.lay;
    if (hit) res.push({ p, hit });
  }
  /*
   * Kırmızı kalem notları da aranır. Notlar DWG'de değil, dosya anahtarına göre ayrı saklanır
   * (notes.js); arama yalnız S.prims'i taradığı için sahada yazılan "vana değişecek" notu
   * bulunamıyordu — oysa kullanıcının kendi yazdığı metin, çizimdeki metinden daha çok aranır.
   * Not sonuçları listenin BAŞINA konur ve ayrı bir etiketle işaretlenir.
   */
  const nres = [];
  for (const n of notes.items) {
    if (nres.length >= 40) break;
    const txt = (n.text || '').trim();
    if (!txt || !araKatla(txt).includes(q)) continue;
    const pt = (n.pts && n.pts[0]) || null;
    if (!pt) continue;
    nres.push({ note: n, hit: txt.slice(0, 120), pt });
  }
  const tumu = [...nres.map(r => ({ ...r, not: true })), ...res];
  body.innerHTML = tumu.length
    ? tumu.map((r, i) => r.not
      ? `<div class="item" data-i="${i}">${esc(r.hit)}<small>${esc(t('notes'))} · ${esc(new Date(r.note.t).toLocaleDateString())}</small></div>`
      : `<div class="item" data-i="${i}">${esc(r.hit)}<small>${esc(trType(r.p.info ? r.p.info.t : r.p.et))} · ${esc(r.p.lay)}</small></div>`).join('')
    : `<div class="muted">${t('noResult')}</div>`;
  body.onclick = (ev) => {
    const it = ev.target.closest('.item'); if (!it) return;
    const r = tumu[Number(it.dataset.i)];
    if (r.not) {
      const sp = (S.ext ? (S.ext[2] - S.ext[0]) : 100) / 20;
      zoomExtents([r.pt[0] - sp, r.pt[1] - sp, r.pt[0] + sp, r.pt[1] + sp]);
      return;
    }
    const b = r.p.bb; const m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.6 || 5;
    S.selected = r.p; zoomExtents([b[0] - m, b[1] - m, b[2] + m, b[3] + m]); showInfo(r.p);
  };
}

// ---- metin çıkarma ------------------------------------------------------------------
/**
 * Çizimdeki bütün yazıları toplar: TEXT / MTEXT / ATTDEF gövdeleri (k 1) ve blok yerleşimlerinin
 * öznitelikleri (INSERT → info.attrs). Her satır metin, tür, katman, konum, yükseklik, açı ve tutamaktır.
 * Görünürlük süzgeci uygulanmaz — çıkarım belgenin tamamını vermelidir, ekranın gösterdiğini değil.
 */
function collectTexts(prims) {
  const out = [], seenIns = new Set();
  for (const p of prims) {
    if (p.k === 4) continue;
    const inf = p.info || {};
    if (p.k === 1 && p.lines && p.lines.length) {
      const txt = p.lines.join('\n').trim();
      if (txt) out.push({ txt, type: inf.t || p.et || 'TEXT', tag: inf.tag || '', lay: p.lay, x: p.x, y: p.y, z: p.z || 0, h: p.h || 0, rot: (p.rot || 0) * 180 / Math.PI, hnd: inf.h || '' });
    }
    if (inf.attrs && inf.attrs.length) {
      // bir blok yerleştirmesi onlarca ilkele yayılır ve hepsi aynı info nesnesini taşır:
      // öznitelikler tutamak başına bir kez yazılır, yoksa her öznitelik onlarca kez tekrarlanır
      const key = (inf.h || '') + '\u0000' + inf.attrs.length;
      if (inf.h && seenIns.has(key)) continue;
      if (inf.h) seenIns.add(key);
      for (const a of inf.attrs) {
        const v = String(a[1] == null ? '' : a[1]).trim();
        if (!v) continue;
        out.push({ txt: v, type: 'ATTRIB', tag: a[0] || '', lay: p.lay, x: inf.x != null ? inf.x : p.x, y: inf.y != null ? inf.y : p.y, z: inf.z || 0, h: 0, rot: 0, hnd: inf.h || '' });
      }
    }
  }
  return out;
}
/** Bir CSV hücresi: ayraç, tırnak ya da satır sonu varsa tırnak içine alınır, iç tırnak ikilenir */
const csvCell = (v) => { const x = String(v == null ? '' : v); return /[";\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
/** UTF-8 metni base64'e çevirir (köprü saveFile base64 ister) */
function b64utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
/** Dosyayı kaydeder / paylaşır; köprü yoksa tarayıcıda indirir */
function saveTextFile(text, name, mime) {
  const b64 = b64utf8(text);
  const driveAct = Drive.signedIn() && Ed.has('driveUpload') ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => Drive.uploadWithPicker({ b64, name, mime }) } : undefined;
  if (A() && A().saveFile) { const r = A().saveFile(b64, name, mime, true); toast(r ? t('saved') + ': ' + r : t('error'), { type: r ? 'ok' : 'error', ms: 6000, action: r ? driveAct : undefined }); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(t('saved'), { type: 'ok', action: driveAct });
}
function showTextOut() {
  if (!Ed.gate('textout')) return;
  const all = S.scene && S.scene.layouts.length > 1;
  const html = kv([
    [t('scope'), all
      ? `<label class="chk"><input type="checkbox" id="txAll"> ${esc(t('allLayouts'))}</label>`
      : `<span class="muted">${esc(S.scene ? S.scene.layouts[S.layoutIndex].name : '')}</span>`, 1],
    [t('outFormat'), `<select id="txFmt"><option value="csv">CSV (${esc(t('withCoords'))})</option><option value="txt">${esc(t('plainText'))}</option></select>`, 1],
    [`<div class="full" id="txInfo"></div>`],
    [`<div class="full btns"><button class="btn primary small" id="txSave">${esc(t('save'))}</button><button class="btn small" id="txCopy">${esc(tt('copyClip', 'Panoya kopyala'))}</button><button class="btn small" id="txShare">${esc(t('share'))}</button></div>`]]);
  openDoc(t('textOut'), html);
  const build = () => {
    const useAll = all && $('txAll').checked;
    const src = useAll ? S.scene.layouts.flatMap(L => L.prims) : S.prims;
    const rows = collectTexts(src);
    const fmtSel = $('txFmt').value;
    let body;
    if (fmtSel === 'csv') {
      const head = [t('textK'), t('tag'), t('typeCol'), t('layer'), 'X', 'Y', 'Z', t('height'), t('rotation'), t('handle')];
      body = '\ufeff' + [head.map(csvCell).join(';'), ...rows.map(r => [r.txt, r.tag, r.type, r.lay, fmt(r.x), fmt(r.y), fmt(r.z), fmt(r.h), fmt(r.rot, 2), r.hnd].map(csvCell).join(';'))].join('\r\n');
    } else body = rows.map(r => r.txt).join('\n');
    return { rows, body, ext: fmtSel === 'csv' ? '.csv' : '.txt', mime: fmtSel === 'csv' ? 'text/csv' : 'text/plain' };
  };
  const refresh = () => {
    const { rows } = build();
    const prev = rows.slice(0, 12).map(r => esc(r.txt.replace(/\n/g, ' ↵ ').slice(0, 60))).join('<br>');
    $('txInfo').innerHTML = rows.length
      ? `<strong>${fmt(rows.length, 0)}</strong> ${esc(t('textsN'))}<div class="muted" style="margin-top:6px">${prev}${rows.length > 12 ? '<br>…' : ''}</div>`
      : `<span class="muted">${esc(t('noResult'))}</span>`;
  };
  if (all) $('txAll').onchange = refresh;
  $('txFmt').onchange = refresh;
  refresh();
  $('txSave').onclick = () => { const b = build(); if (!b.rows.length) { toast(t('noResult')); return; } saveTextFile(b.body, baseName() + '_metin_' + stamp() + b.ext, b.mime); hide('docPanel'); };
  $('txCopy').onclick = () => { const b = build(); copyText(b.body); };
  $('txShare').onclick = () => { const b = build(); if (A() && A().shareText) A().shareText(t('textOut'), b.body); else copyText(b.body); };
}

// ---- ölçümü çizime işleme -----------------------------------------------------------------
/**
 * Son ölçüm sonucunu çizime kalıcı açıklama olarak yazar (ok başlı lider + değer).
 * Kaynak, ölçü panelindeki son iki noktadır; ölçü kipi kapalıysa ya da tek nokta varsa uyarır.
 * Ölçüm penceresi kapatıldığında sayı uçup gidiyordu — bu, ölçüyü paftaya sabitler.
 */
function markMeasurement() {
  if (!Ed.gate('markdim')) return;
  const m = S.measure;
  if (m.length < 2) { toast(t('markNeedMeasure'), { type: 'warn' }); return; }
  const a = m[m.length - 2], b = m[m.length - 1];
  const d = segLen(a, b).d;
  if (!(d > 0)) { toast(t('markNeedMeasure'), { type: 'warn' }); return; }
  const label = fmt(d) + (S.units ? ' ' + S.units : '');
  // Açıklama ölçülen parçanın kotuna konur; eskiden a[2] her zaman tanımsız olduğu için Z=0 düzlemine düşüyordu
  const zf = (v) => (v != null && isFinite(v) ? v : null);
  const za = zf(a[2]), zb = zf(b[2]);
  const mz = za != null && zb != null ? (za + zb) / 2 : (za != null ? za : (zb != null ? zb : 0));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, mz];
  const off = Math.max(d * 0.25, (S.ext ? (S.ext[2] - S.ext[0]) : 100) / 40);
  if (editor.addAnnot([mid, [mid[0] + off, mid[1] + off, mid[2]]], label)) toast(label, { type: 'ok' });
  else toast(t('error'), { type: 'error' });
}

// ---- çizimde bul-değiştir -------------------------------------------------------------------
/**
 * Metin içinde tüm eşleşmeleri değiştirir. Büyük/küçük harf duyarsız aramada Türkçe kurallar geçerlidir
 * (`toLocaleLowerCase('tr')` — I→ı, İ→i) ve dizi uzunluğu korunduğu için konumlar kaymaz.
 * wholeWord: eşleşmenin iki yanında harf/rakam bulunmamalıdır.
 */
/** Uzunluk koruyan Türkçe katlama: İ→i, I→ı→i; boyu değişen bir karakter olduğu gibi kalır */
function foldTr(s) {
  let r = '';
  for (const ch of s) { let l = ch.toLocaleLowerCase('tr'); if (l.length !== ch.length) l = ch; r += l === 'ı' ? 'i' : l; }
  return r;
}
function replaceIn(src, find, rep, caseSensitive, wholeWord) {
  const S0 = String(src == null ? '' : src);
  const F = String(find == null ? '' : find);
  if (!F) return { out: S0, n: 0 };
  /*
   * Harf duyarsız katlama TÜRKÇE'YE GÖRE yapılır ama noktasız ı da i'ye indirilir. Yalnız
   * toLocaleLowerCase('tr') ile "ID" → "ıd" olur ve metindeki "id" ile eşleşmezdi (ölçüldü);
   * Latin metinde büyük I'nın karşılığı i'dir. Katlama karakter karakter yapılır ve uzunluk
   * korunur: eşleşme konumları (j) özgün dizgede de aynı yere düşer.
   */
  const hay = caseSensitive ? S0 : foldTr(S0);
  const nee = caseSensitive ? F : foldTr(F);
  const isW = (ch) => ch != null && /[\p{L}\p{N}_]/u.test(ch);
  let out = '', i = 0, n = 0;
  for (;;) {
    const j = hay.indexOf(nee, i);
    if (j < 0) break;
    const okL = !wholeWord || !isW(S0[j - 1]);
    const okR = !wholeWord || !isW(S0[j + nee.length]);
    if (okL && okR) { out += S0.slice(i, j) + rep; i = j + nee.length; n++; }
    else { out += S0.slice(i, j + 1); i = j + 1; }
  }
  return { out: out + S0.slice(i), n };
}
/** Bul-değiştir taraması: yazı ilkelleri ve blok öznitelikleri */
function frScan(find, rep, opts) {
  const texts = [], attrs = new Map();
  let hits = 0;
  if (!find) return { texts, attrs, hits };
  const wantText = opts.scope !== 'attr', wantAttr = opts.scope !== 'text';
  const seenIns = new Set();
  for (const p of S.prims) {
    if (p.k === 4) continue;
    const inf = p.info || {};
    const isAttr = p.et === 'ATTRIB' || p.et === 'ATTDEF';
    if (wantText && p.k === 1 && !isAttr && p.lines && p.lines.length) {
      const src = p.lines.join('\n');
      const r = replaceIn(src, find, rep, opts.caseSensitive, opts.wholeWord);
      if (r.n) { texts.push({ key: p.key, from: src, to: r.out, n: r.n, lay: p.lay }); hits += r.n; }
    }
    if (wantAttr && inf.attrs && inf.attrs.length && inf.h && !seenIns.has(inf.h)) {
      seenIns.add(inf.h);
      const items = [];
      inf.attrs.forEach((a, i) => {
        const r = replaceIn(a[1], find, rep, opts.caseSensitive, opts.wholeWord);
        if (r.n) { items.push({ i, value: r.out, from: a[1], tag: a[0] }); hits += r.n; }
      });
      if (items.length) attrs.set(inf.h, { name: inf.name || '', items });
    }
  }
  return { texts, attrs, hits };
}
function showFindReplace() {
  if (!Ed.gate('findrep')) return;
  const html = kv([
    [t('findWhat'), `<input id="frFind" autocomplete="off" value="">`, 1],
    [t('replaceWith'), `<input id="frRep" autocomplete="off" value="">`, 1],
    [t('matchCase'), `<label class="chk"><input type="checkbox" id="frCase"> ${esc(t('matchCaseHint'))}</label>`, 1],
    [t('wholeWord'), `<label class="chk"><input type="checkbox" id="frWord"> ${esc(t('wholeWordHint'))}</label>`, 1],
    [t('scope'), `<select id="frScope"><option value="both">${esc(t('frBoth'))}</option><option value="text">${esc(t('frTexts'))}</option><option value="attr">${esc(t('frAttrs'))}</option></select>`, 1],
    [`<div class="full" id="frInfo"><span class="muted">${esc(t('frHint'))}</span></div>`],
    [`<div class="full btns"><button class="btn small" id="frScanBtn">${esc(t('frScan'))}</button><button class="btn primary small" id="frGo">${esc(t('frReplaceAll'))}</button></div>`]]);
  openDoc(t('findRep'), html);
  const read = () => ({
    find: $('frFind').value, rep: $('frRep').value,
    caseSensitive: $('frCase').checked, wholeWord: $('frWord').checked, scope: $('frScope').value,
  });
  const preview = () => {
    const o = read();
    if (!o.find) { $('frInfo').innerHTML = `<span class="muted">${esc(t('frHint'))}</span>`; return null; }
    const r = frScan(o.find, o.rep, o);
    const rows = [];
    for (const x of r.texts.slice(0, 12)) rows.push(`${esc(x.from.replace(/\n/g, ' ').slice(0, 40))} → <b>${esc(x.to.replace(/\n/g, ' ').slice(0, 40))}</b>`);
    for (const [, g] of [...r.attrs].slice(0, 6)) for (const it of g.items.slice(0, 2)) rows.push(`${esc(g.name)}.${esc(it.tag)}: ${esc(String(it.from).slice(0, 30))} → <b>${esc(String(it.value).slice(0, 30))}</b>`);
    const total = r.texts.length + [...r.attrs.values()].reduce((a, g) => a + g.items.length, 0);
    $('frInfo').innerHTML = total
      ? `<strong>${fmt(r.hits, 0)}</strong> ${esc(t('frHits'))} · ${fmt(total, 0)} ${esc(t('frObjects'))}<div class="muted" style="margin-top:6px">${rows.join('<br>')}${total > rows.length ? '<br>…' : ''}</div>`
      : `<span class="muted">${esc(t('noResult'))}</span>`;
    return r;
  };
  $('frScanBtn').onclick = preview;
  $('frFind').addEventListener('input', () => { if ($('frFind').value.length >= 2) preview(); });
  $('frGo').onclick = () => {
    const o = read();
    if (!o.find) { toast(t('frHint'), { type: 'warn' }); return; }
    const r = frScan(o.find, o.rep, o);
    const cmds = [];
    if (r.texts.length) cmds.push({ op: 'settexts', items: r.texts.map(x => ({ key: x.key, text: x.to })) });
    for (const [h, g] of r.attrs) cmds.push({ op: 'attrib', h, items: g.items.map(it => ({ i: it.i, value: it.value })) });
    if (!cmds.length) { toast(t('noResult'), { type: 'warn' }); return; }
    if (editor.runCmd({ op: 'group', cmds })) { toast(t('frDone') + ' · ' + fmt(r.hits, 0)); hide('docPanel'); }
    else toast(t('error'), { type: 'error' });
  };
}


// ---- 3B dışa aktarma (OBJ / STL) ------------------------------------------------------------
const fmtSize = (n) => (n == null || !(n >= 0) ? '' : n < 1024 ? n + ' B' : n < 1048576 ? fmt(n / 1024, 1) + ' KB' : fmt(n / 1048576, 2) + ' MB');
/** Uint8Array → base64 (köprünün saveFile'ı base64 ister) */
function b64bytes(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
/** İkili dosyayı kaydeder / paylaşır; köprü yoksa tarayıcıda indirir */
function saveBinFile(u8, name, mime) {
  const b64 = b64bytes(u8);
  const driveAct = Drive.signedIn() && Ed.has('driveUpload') ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => Drive.uploadWithPicker({ b64, name, mime }) } : undefined;
  if (A() && A().saveFile) { const r = A().saveFile(b64, name, mime, true); toast(r ? t('saved') + ': ' + r : t('error'), { type: r ? 'ok' : 'error', ms: 6000, action: r ? driveAct : undefined }); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([u8], { type: mime })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(t('saved'), { type: 'ok', action: driveAct });
}
/**
 * Katı ve ağ gövdelerini OBJ ya da STL olarak yazar. Üçgen sayısı ve tahminî dosya boyutu
 * ÖNCE gösterilir: 9 milyon üçgenlik bir modelde ikili STL 450 MB eder ve telefonda
 * kaydedilemez; kullanıcı bunu kaydete basmadan önce görmelidir.
 */
async function showMeshExport() {
  if (!Ed.gate('mesh3d')) return;
  let E3;
  try { E3 = await import('./export3d.js'); } catch (e) { console.warn(e); toast(t('error'), { type: 'error' }); return; }
  const st = E3.meshStats(S.prims);
  if (!st.tris) { toast(t('mesh3None'), { type: 'warn' }); return; }
  const html = kv([
    [t('outFormat'), `<select id="m3Fmt"><option value="obj">OBJ</option><option value="stl">STL</option><option value="stla">STL (ASCII)</option></select>`, 1],
    [t('mesh3Bodies'), fmt(st.bodies, 0)],
    [t('triCount'), fmt(st.tris, 0)],
    [t('vertices'), fmt(st.verts, 0)],
    [t('mesh3Size'), `OBJ ≈ ${fmtSize(st.bytesObj)} · STL ${fmtSize(st.bytesStl)}`],
    [t('mesh3ByLayer'), `<label class="chk"><input type="checkbox" id="m3Lay" checked> ${esc(t('mesh3ByLayerHint'))}</label>`, 1],
    [`<div class="full muted">${esc(t('mesh3Note'))}</div>`],
    [`<div class="full btns"><button class="btn primary small" id="m3Go">${esc(t('save'))}</button></div>`]]);
  openDoc(t('mesh3Title'), html);
  $('m3Go').onclick = async () => {
    const kind = $('m3Fmt').value, byLayer = $('m3Lay').checked;
    setLoading(t('mesh3Title'), fmt(st.tris, 0), undefined, 'out');
    await new Promise(r => setTimeout(r, 30));
    try {
      const opts = { name: baseName(), byLayer, unitToM: 1, maxTris: 3000000 };
      const name = baseName() + '_' + stamp() + (kind === 'obj' ? '.obj' : '.stl');
      if (kind === 'obj') {
        const txt = E3.objText(S.prims, opts);
        if (!txt) { toast(t('mesh3TooBig'), { type: 'error', ms: 6000 }); return; }
        saveTextFile(txt, name, 'model/obj');
      } else if (kind === 'stla') {
        const txt = E3.stlText(S.prims, opts);
        if (!txt) { toast(t('mesh3TooBig'), { type: 'error', ms: 6000 }); return; }
        saveTextFile(txt, name, 'model/stl');
      } else {
        const buf = E3.stlBinary(S.prims, opts);
        if (!buf) { toast(t('mesh3TooBig'), { type: 'error', ms: 6000 }); return; }
        saveBinFile(buf, name, 'model/stl');
      }
      hide('docPanel');
    } catch (e) { fail(e); }
    finally { setLoading(null); }
  };
}


// ---- PDF → CAD -------------------------------------------------------------------------------
/*
 * Bir PDF sayfasının vektör içeriğini çizim nesnelerine çevirir. Rehber, keşif eki ya da idareden
 * gelen pafta çoğu zaman yalnız PDF olarak gelir; bu, o paftadaki çizgileri ölçülebilir ve
 * düzenlenebilir hâle getirir. Dönüşüm pdfcad.js'te; burada yalnız dosya seçimi, ölçek ve sunum var.
 */
let pdfCad = null;                    // { bytes, name, pages }
const PDFCAD_UNITS = [['0.352778', 'mm'], ['0.0352778', 'cm'], ['0.000352778', 'm'], ['1', 'pt'], ['0.0138889', 'inç']];
async function pdfCadFromBytes(buf, name) {
  let PC;
  try { PC = await import('./pdfcad.js'); } catch (e) { console.warn(e); toast(t('error'), { type: 'error' }); return; }
  setLoading(t('pdfcadTitle'), name, undefined, 'doc');
  let pages = 0;
  try { pages = await PC.pdfPageCount(buf); } catch (e) { console.warn(e); }
  setLoading(null);
  if (!pages) { toast(t('pdfcadNoPages'), { type: 'error', ms: 5000 }); return; }
  pdfCad = { bytes: buf, name, pages };
  pdfCadDialog(PC);
}
function pdfCadDialog(PC) {
  const d = pdfCad;
  const html = kv([
    [t('file'), esc(d.name)],
    [t('pageN'), `<input id="pcPage" type="number" min="1" max="${d.pages}" value="1"> / ${d.pages}`, 1],
    [t('pdfcadUnit'), `<select id="pcUnit">${PDFCAD_UNITS.map(u => `<option value="${u[0]}"${u[1] === 'mm' ? ' selected' : ''}>1 pt = ${u[0]} ${u[1]}</option>`).join('')}</select>`, 1],
    [t('pdfcadScale'), `<input id="pcScale" type="number" step="any" value="1">`, 1],
    [t('layer'), `<input id="pcLayer" value="PDF">`, 1],
    [t('pdfcadText'), `<label class="chk"><input type="checkbox" id="pcText" checked> ${esc(t('pdfcadTextHint'))}</label>`, 1],
    [`<div class="full muted">${esc(t('pdfcadNote'))}</div>`],
    [`<div class="full" id="pcInfo"></div>`],
    [`<div class="full btns"><button class="btn primary small" id="pcGo">${esc(t('create'))}</button></div>`]]);
  openDoc(t('pdfcadTitle'), html);
  $('pcGo').onclick = () => void pdfCadRun(PC);
}
async function pdfCadRun(PC) {
  const d = pdfCad; if (!d) return;
  const page = Math.max(1, Math.min(d.pages, Number($('pcPage').value) || 1)) - 1;
  const unit = Number($('pcUnit').value) || 1;
  const extra = Number($('pcScale').value) || 1;
  const layer = ($('pcLayer').value || 'PDF').trim() || 'PDF';
  const wantText = $('pcText').checked;
  setLoading(t('pdfcadTitle'), String(page + 1), undefined, 'doc');
  await new Promise(r => setTimeout(r, 30));
  try {
    if (!S.hasDoc) {
      // Elde çizim yoksa boş bir DXF açılır: dönüşümün nesneleri bir belgeye eklenmek zorundadır
      const u8 = new Uint8Array(await New.newBytes('dxf'));
      await loadBytes(u8.buffer, baseNameOf(d.name) + '.dxf', u8.length);
      if (!S.hasDoc) { toast(t('openFirst'), { type: 'warn' }); return; }
    }
    const scale = unit * extra;
    const res = await PC.pdfToEnts(d.bytes, page, { scale, layer, color: 256, text: wantText, tol: scale * 0.05 });
    if (!res) { toast(t('pdfcadFail'), { type: 'error', ms: 6000 }); return; }
    const st = res.stats || {};
    if (!res.ents.length) {
      const why = st.inflate === false ? t('pdfcadNoInflate') : t('pdfcadNoVector');
      toast(why, { type: 'warn', ms: 7000 });
      const info = $('pcInfo'); if (info) info.innerHTML = `<span class="muted">${esc(why)}</span>`;
      return;
    }
    if (!S.layers.has(layer)) editor.runCmd({ op: 'layer', name: layer, color: -1 });   // 256 ACI dizisinde yoktur; -1 = öntanımlı ön plan rengi
    if (!editor.addEnts(res.ents)) { toast(t('error'), { type: 'error' }); return; }
    zoomExtents();
    toast(`${t('pdfcadDone')} · ${fmt(res.ents.length, 0)} ${t('prims')}`, { type: 'ok', ms: 5000 });
    hide('docPanel');
  } catch (e) { fail(e); }
  finally { setLoading(null); }
}
const baseNameOf = (n) => String(n || 'pdf').replace(/\.[^.]+$/, '');
async function showPdfCad() {
  if (!Ed.gate('pdfcad')) return;
  // Ekranda zaten bir PDF açıksa onu kullan: kullanıcının belgeyi kapatıp aynı dosyayı
  // yeniden seçmesi anlamsız bir adımdır (bu işlev Diğer menüsünde belge kipinde de durur).
  const d = Docs.isOpen() ? Docs.current() : null;
  if (d && d.kind === 'pdf' && (d.bytes || d.id)) {
    try {
      const buf = d.bytes ? (d.bytes.buffer || d.bytes) : await fetchFile(d.id);
      await pdfCadFromBytes(buf, d.name || 'belge.pdf');
      return;
    } catch (e) { console.warn(e); }
  }
  if (pdfCad) { let PC; try { PC = await import('./pdfcad.js'); } catch (e) { console.warn(e); return; } pdfCadDialog(PC); return; }
  pickFile('pdfcad', 'application/pdf');
}


// ---- tablo çıkarma ---------------------------------------------------------------------------
/*
 * Çizime ÇİZİLMİŞ tabloyu (ızgara çizgileri + hücre yazıları) okuyup CSV'ye çevirir. Arama alanı
 * ekrandaki görünümdür: kullanıcı tabloya yakınlaşır ve düğmeye basar. Böylece paftadaki onlarca
 * çizgi arasından hangisinin tablo olduğunu tahmin etmek gerekmez — kadraj kararı kullanıcınındır.
 */
async function showTableOut() {
  if (!Ed.gate('tableout')) return;
  let TX;
  try { TX = await import('./tablex.js'); } catch (e) { console.warn(e); toast(t('error'), { type: 'error' }); return; }
  const rect = visibleRect();
  const res = TX.extractTable(S.prims.filter(p => primVisible(p)), rect, {});
  if (!res || !res.rows || !res.rows.length) { toast(t('tableNone'), { type: 'warn', ms: 6000 }); return; }
  const rows = res.rows;
  const prev = rows.slice(0, 10).map(r => `<tr>${r.slice(0, 8).map(c => `<td>${esc(String(c).slice(0, 24))}</td>`).join('')}</tr>`).join('');
  const html = kv([
    [t('tableSize'), `${fmt(res.ny, 0)} × ${fmt(res.nx, 0)}`],
    [`<div class="full tbl-prev"><table>${prev}</table>${rows.length > 10 ? `<div class="muted">…</div>` : ''}</div>`],
    [`<div class="full muted">${esc(t('tableNote'))}</div>`],
    [`<div class="full btns"><button class="btn primary small" id="tbSave">${esc(t('save'))}</button><button class="btn small" id="tbCopy">${esc(tt('copyClip', 'Panoya kopyala'))}</button><button class="btn small" id="tbShare">${esc(t('share'))}</button></div>`]]);
  openDoc(t('tableTitle'), html);
  const csv = '﻿' + TX.tableCsv(rows, ';');
  $('tbSave').onclick = () => { saveTextFile(csv, baseName() + '_tablo_' + stamp() + '.csv', 'text/csv'); hide('docPanel'); };
  $('tbCopy').onclick = () => copyText(TX.tableCsv(rows, '\t'));
  $('tbShare').onclick = () => { const txt = TX.tableCsv(rows, '\t'); if (A() && A().shareText) A().shareText(t('tableTitle'), txt); else copyText(txt); };
}


// ---- toplu işlem -----------------------------------------------------------------------------
/*
 * Birden çok dosyaya aynı işlemi uygular. Dosyalar çoklu seçiciyle alınır (Android'de
 * ACTION_OPEN_DOCUMENT + EXTRA_ALLOW_MULTIPLE, tarayıcıda <input multiple>).
 *
 * Her dosya SIRAYLA açılır: çözümleme işçide (worker) yapılır, sahne uygulamaya kurulur, işlem
 * uygulanır ve sıradakine geçilir. Sahneyi kurmak yerine "arka planda" iş görmek daha zarif
 * görünürdü ama PDF çıktısı çizim ardalanının tamamını (katman görünürlüğü, tema, ölçek çubuğu)
 * kullanır; ayrı bir yol açmak iki ayrı doğruluk kaynağı demekti. Bitince açık olan çizim
 * geri yüklenir.
 */
let batchFiles = null;
const BATCH_OPS = ['report', 'text', 'dxf', 'pdf'];
async function showBatch() {
  if (!Ed.gate('batch')) return;
  if (A() && A().pickFiles) { try { A().pickFiles('batch', '*/*'); return; } catch (e) { console.warn(e); } }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
  inp.onchange = () => {
    const list = [...(inp.files || [])].map(f => ({ file: f, name: f.name, size: f.size }));
    inp.remove();
    if (list.length) batchDialog(list);
  };
  document.body.appendChild(inp); inp.click();
}
/** Android çoklu seçici sonucu */
function onFilesPicked(purpose, json) {
  let list = [];
  try { list = JSON.parse(json || '[]'); } catch (e) { console.warn(e); }
  if (purpose !== 'batch' || !list.length) return;
  batchDialog(list.map(f => ({ id: f.id, name: f.name, size: f.size })));
}
function batchDialog(list) {
  batchFiles = list.filter(f => Docs.isCad(f.name));
  const skipped = list.length - batchFiles.length;
  if (!batchFiles.length) { toast(t('batchNoCad'), { type: 'warn', ms: 5000 }); return; }
  const html = kv([
    [t('batchFiles'), `${fmt(batchFiles.length, 0)}${skipped ? ` (${fmt(skipped, 0)} ${t('batchSkipped')})` : ''}`],
    [t('batchOp'), `<select id="btOp">
      <option value="report">${esc(t('batchReport'))}</option>
      <option value="text">${esc(t('batchText'))}</option>
      <option value="dxf">${esc(t('batchDxf'))}</option>
      <option value="pdf">${esc(t('batchPdf'))}</option></select>`, 1],
    [t('paper'), `<select id="btPaper">${Object.keys(PAPERS).map(k => `<option ${k === 'A3' ? 'selected' : ''}>${k}</option>`).join('')}</select>`, 1],
    [`<div class="full list">${batchFiles.map(f => `<div class="item">${esc(f.name)}<small>${fmtSize(f.size)}</small></div>`).join('')}</div>`],
    [`<div class="full muted">${esc(t('batchNote'))}</div>`],
    [`<div class="full btns"><button class="btn primary small" id="btGo">${esc(t('batchRun'))}</button></div>`]]);
  openDoc(t('batchTitle'), html);
  $('btGo').onclick = () => void runBatch($('btOp').value, $('btPaper').value);
}
async function runBatch(op, paper) {
  if (!batchFiles || !batchFiles.length || !BATCH_OPS.includes(op)) return;
  hide('docPanel');
  const files = batchFiles.slice();
  const keep = S.hasDoc ? { scene: S.scene, name: S.fileName, size: (S.fileKey.split('_').pop() | 0) } : null;
  const report = [], texts = [];
  let done = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    setLoading(t('batchTitle'), `${f.name} (${i + 1}/${files.length})`, 100 * i / files.length, op === 'pdf' ? 'out' : 'cad');
    try {
      const buf = f.file ? await f.file.arrayBuffer() : await fetchFile(f.id);
      const res = await runWorker({ cmd: 'parse', bytes: buf, name: f.name, objects: 0 });
      const scene = res.scene;
      await setScene(scene, f.name, f.size || buf.byteLength);
      zoomExtents();
      if (op === 'report') {
        const e = S.ext || [0, 0, 0, 0];
        report.push([f.name, f.size || '', S.version, S.units, S.entityCount, S.layers.size, S.blockCount,
          fmt(e[0]), fmt(e[1]), fmt(e[2]), fmt(e[3])]);
      } else if (op === 'text') {
        for (const r of collectTexts(S.prims)) texts.push([f.name, r.txt, r.tag, r.type, r.lay, fmt(r.x), fmt(r.y), fmt(r.z)]);
      } else if (op === 'dxf') {
        const txt = writeDxf(S.scene.layouts[0].prims, S.layers, { ltypes: S.ltypes });
        saveTextFile(txt, baseName() + '.dxf', 'application/dxf');
      } else if (op === 'pdf') {
        await makePdf({ title: baseName(), paper: paper || 'A3', orient: 'l', area: 'ext', scale: 0, dpi: 150, margin: 10, frame: true, lw: true, all: false, vector: true });
      }
      done++;
    } catch (e) { console.warn('batch', f.name, e); failed++; }
  }
  // toplu çıktılar tek dosyada
  try {
    if (op === 'report' && report.length) {
      const head = [t('file'), t('size'), t('version'), t('drawingUnit'), t('entity'), t('layerN'), t('blockN'), 'Xmin', 'Ymin', 'Xmax', 'Ymax'];
      saveTextFile('﻿' + [head, ...report].map(r => r.map(csvCell).join(';')).join('\r\n'), 'toplu_rapor_' + stamp() + '.csv', 'text/csv');
    } else if (op === 'text' && texts.length) {
      const head = [t('file'), t('textK'), t('tag'), t('typeCol'), t('layer'), 'X', 'Y', 'Z'];
      saveTextFile('﻿' + [head, ...texts].map(r => r.map(csvCell).join(';')).join('\r\n'), 'toplu_metin_' + stamp() + '.csv', 'text/csv');
    }
  } catch (e) { console.warn(e); }
  // açık olan çizimi geri getir
  try { if (keep && keep.scene) await setScene(keep.scene, keep.name, keep.size); } catch (e) { console.warn(e); }
  setLoading(null);
  batchFiles = null;
  toast(`${t('batchDone')} · ${fmt(done, 0)}/${fmt(files.length, 0)}` + (failed ? ` · ${fmt(failed, 0)} ${t('batchFailed')}` : ''), { type: failed ? 'warn' : 'ok', ms: 7000 });
}


// ---- blok kütüphanesi ve pano -----------------------------------------------------------------
/*
 * Blok kütüphanesi ve pano CİHAZDA saklanır, dosyada değil: amaç zaten aynı detayı başka çizimlere
 * taşımaktır. Eklenen blok, iç modelimizde bir INSERT değil bileşen nesnelerdir — DXF yazıcımız
 * blokları zaten patlatılmış yazdığı için sonuç her okuyucuda aynıdır ve nesneler tek tek düzenlenebilir.
 *
 * Yerleştirme noktası: nesneler GÖRÜNÜMÜN ORTASINA konur ve hemen seçili kalır; kullanıcı Taşı
 * aracıyla yerine sürükler. Ekranda ayrı bir "yerleştirme kipi" açmak, mobilde fazladan bir adım
 * ve fazladan bir iptal yolu demekti.
 */
let BL = null;
async function blockLib() {
  if (BL) return BL;
  try { BL = await import('./blocklib.js'); } catch (e) { console.warn(e); toast(t('error'), { type: 'error' }); return null; }
  return BL;
}
/** Seçili ilkelleri taşınabilir varlıklara çevirir; çevrilemeyenler (resim, ekleme noktası) atlanır */
function selectionEnts(L) {
  const sel = editor.selection();
  const ents = sel.map(p => L.primToEnt(p)).filter(Boolean);
  return { sel, ents };
}
/** Varlıkları görünümün ortasına yerleştirip ekler ve seçili bırakır */
/*
 * Blok / pano içeriğini görünümün ortasına koyar. Ölçek ve dönüş isteğe bağlıdır: 1 ve 0°
 * verildiğinde geometriye hiç dokunulmaz. Dönüşümler yerleştirmeden ÖNCE, içeriğin kendi
 * merkezinde uygulanır — böylece ölçeklenen blok yine ortada kalır, kenara kaymaz. Ölçek
 * negatifse merkeze göre nokta yansımasıdır (blocklib.scaleEnts bunu açıklıyor), ayna değildir.
 */
function placeEntsAtCenter(L, ents0, base, opts) {
  const sc = opts && isFinite(opts.scale) && opts.scale !== 0 ? opts.scale : 1;
  const rot = opts && isFinite(opts.rot) ? opts.rot : 0;
  let ents = ents0;
  if (sc !== 1 || rot !== 0) {
    const b0 = L.entsBBox(ents);
    const cx0 = (b0[0] + b0[2]) / 2, cy0 = (b0[1] + b0[3]) / 2;
    if (sc !== 1) ents = L.scaleEnts(ents, sc, cx0, cy0);
    if (rot !== 0) ents = L.rotateEnts(ents, rot * Math.PI / 180, cx0, cy0);
    if (!ents.length) return 0;
  }
  const c = [S.view.cx, S.view.cy];
  const b = sc !== 1 || rot !== 0 ? L.entsBBox(ents) : (base && isFinite(base[0]) ? base : L.entsBBox(ents));
  const bx = b.length === 4 ? (b[0] + b[2]) / 2 : b[0], by = b.length === 4 ? (b[1] + b[3]) / 2 : b[1];
  const moved = L.moveEnts(ents, c[0] - bx, c[1] - by, 0);
  const n0 = S.prims.length;
  if (!editor.addEnts(moved)) return 0;
  const added = S.prims.slice(n0);
  editor.setSelection(added);
  requestRender();                     // nesneler görünümün ortasına kondu: görünüm değiştirilmez
  return added.length;
}
async function showBlockLib() {
  const L = await blockLib(); if (!L) return;
  if (!Ed.gate('blocklib')) return;
  const list = L.listBlocks(store);
  const items = list.length
    ? list.map(b => `<div class="item" data-blk="${esc(b.name)}">${esc(b.name)}<small>${fmt(b.n, 0)} ${esc(t('prims'))} · ${fmt(b.w, 0)}×${fmt(b.h, 0)} · <a href="#" data-del="${esc(b.name)}">${esc(t('delete'))}</a></small></div>`).join('')
    : `<div class="muted">${esc(t('blockNone'))}</div>`;
  const html = kv([
    [`<div class="full btns"><button class="btn primary small" id="blkNew">${esc(t('blockSave'))}</button></div>`],
    [`<div class="full muted">${esc(t('blockInsertHint'))}</div>`],
    [`<div class="full list">${items}</div>`]]);
  openDoc(t('blockTitle'), html);
  $('blkNew').onclick = async () => {
    const { sel, ents } = selectionEnts(L);
    if (!ents.length) { toast(sel.length ? t('error') : t('blockNoSel'), { type: 'warn' }); return; }
    const name = await askText(t('blockName'), '', { maxlength: 60 });
    if (!name || !name.trim()) return;
    const bb = L.entsBBox(ents);
    if (!L.saveBlock(store, name, ents, [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2])) { toast(t('blockTooBig'), { type: 'error', ms: 5000 }); return; }
    toast(t('blockSaved') + ': ' + name.trim(), { type: 'ok' });
    showBlockLib();
  };
  $('docBody').onclick = async (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) {
      ev.preventDefault();
      if (!(await askConfirm(t('blockDelAsk') + ' ' + del.dataset.del))) return;
      L.deleteBlock(store, del.dataset.del); toast(t('blockDeleted')); showBlockLib(); return;
    }
    const it = ev.target.closest('[data-blk]');
    if (!it) return;
    const b = L.loadBlock(store, it.dataset.blk);
    if (!b || !b.ents.length) { toast(t('error'), { type: 'error' }); return; }
    // Ölçek ve dönüş sorulur; boş bırakılırsa 1 ve 0° ile birebir yerleştirilir.
    const f = await askForm(it.dataset.blk, [
      { id: 'scale', label: t('blockScale'), type: 'number', value: '1' },
      { id: 'rot', label: t('blockRot'), type: 'number', value: '0' }], { ok: t('blockInsert') });
    if (f === null) return;
    const sc = parseFloat(String(f.scale).replace(',', '.'));
    const rt = parseFloat(String(f.rot).replace(',', '.'));
    const n = placeEntsAtCenter(L, b.ents, b.base, { scale: isFinite(sc) ? sc : 1, rot: isFinite(rt) ? rt : 0 });
    hide('docPanel');
    toast(n ? `${t('blockInserted')} · ${fmt(n, 0)}` : t('error'), { type: n ? 'ok' : 'error' });
  };
}
async function clipCopySelection() {
  const L = await blockLib(); if (!L) return;
  if (!Ed.gate('copyclip')) return;
  const { sel, ents } = selectionEnts(L);
  if (!ents.length) { toast(sel.length ? t('error') : t('blockNoSel'), { type: 'warn' }); return; }
  const bb = L.entsBBox(ents);
  if (!L.clipWrite(store, ents, [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2])) { toast(t('blockTooBig'), { type: 'error', ms: 5000 }); return; }
  toast(`${t('clipCopied')} · ${fmt(ents.length, 0)}`, { type: 'ok' });
  return true;
}
/** CUTCLIP (AutoCAD Ctrl+X): panoya kopyala ve sil. Silme tek geri alma adımıdır; pano ayrı durur. */
async function clipCut() {
  const sel = editor.selection();
  if (!sel.length) { toast(t('blockNoSel'), { type: 'warn' }); return; }
  if (await clipCopySelection() !== true) return;
  if (editor.eraseKeys(sel.map(p => p.key))) toast(t('cutDone').replace('%s', fmt(sel.length, 0)), 1800);
}
async function clipPaste() {
  const L = await blockLib(); if (!L) return;
  if (!Ed.gate('pasteclip')) return;
  const c = L.clipRead(store);
  if (!c || !c.ents || !c.ents.length) { toast(t('clipEmpty'), { type: 'warn' }); return; }
  const n = placeEntsAtCenter(L, c.ents, c.base);
  toast(n ? `${t('clipPasted')} · ${fmt(n, 0)}` : t('error'), { type: n ? 'ok' : 'error' });
}

// ---- diğer menüsü --------------------------------------------------------------------
$('btnMore').addEventListener('click', () => { $('moreMenu').hidden = !$('moreMenu').hidden; });
/** Belge kipinde (PDF / Word / Excel / arşiv / resim / metin) Diğer menüsünde yalnız genel eylemler kalır; çizim eylemleri gizlenir */
const MENU_GENERAL = new Set(['drive', 'server', 'qr', 'settings', 'about', 'pro', 'home', 'pdfcad', 'batch']);
/** Diğer menüsü görünürlüğü TEK yerde: yetki (edition.js) + belge kipi + belge varlığı. edition.js applyEdition de buraya gelir. */
function refreshMenu() {
  const doc = document.body.classList.contains('docmode');
  document.querySelectorAll('#moreMenu [data-act]').forEach(b => {
    const k = b.dataset.act;
    // İKİ GİZLEME AYRI TUTULUR: yetki artık gizlemez (rozetler), belge kipi gizlemesi AYNEN KALIR —
    // yoksa belge kipinde rozetli ama dokunulduğunda hiçbir şey yapmayan çizim satırları çıkar.
    let hidden = Ed.menuHiddenByEdition(k);
    if (doc && !MENU_GENERAL.has(k)) hidden = true;
    if (k === 'home' && !S.hasDoc && !doc) hidden = true;   // zaten ana ekrandayken anlamsız
    b.hidden = hidden;
    Ed.lockMark(b, k, 'pill');
  });
}
function menuAction(act) {
  closeMenu();
  if (!Ed.gate(act)) return;   // Ücretsiz sürümde Pro eylemi (notes / profile / compare / pdf): yükseltme kutusu
  const needDoc = ['info', 'layouts', 'notes', 'profile', 'compare', 'xrefs', 'views', 'png', 'pdf', 'textout', 'markdim', 'findrep', 'blocklib', 'copyclip', 'pasteclip', 'mesh3d', 'tableout', 'blocks', 'xattach', 'xbind', 'xopen', 'xdetach'];
  if (needDoc.includes(act) && !S.hasDoc) { toast(t('openFirst')); return; }
  switch (act) {
    case 'info': showDocInfo(); break;
    case 'count': showCount(); break;
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
    case 'wshare': paylasGorunum('com.whatsapp', 'WhatsApp'); break;
    case 'share': paylasGorunum('', ''); break;
    case 'pdf': showPdf(); break;
    case 'textout': showTextOut(); break;
    case 'markdim': markMeasurement(); break;
    case 'findrep': showFindReplace(); break;
    case 'blocklib': showBlockLib(); break;
    case 'blocks': edCall('showBlocks'); break;
    case 'xattach': pickFile('xattach', '*/*'); break;
    case 'xbind': void xrefBindPick(); break;
    case 'xopen': void xrefOpenPick(); break;
    case 'xdetach': void xrefDetachPick(); break;
    case 'copyclip': clipCopySelection(); break;
    case 'cutclip': void clipCut(); break;
    case 'pasteclip': void clipPaste(); break;
    case 'mesh3d': showMeshExport(); break;
    case 'tableout': showTableOut(); break;
    case 'batch': void showBatch(); break;
    case 'pdfcad': void showPdfCad(); break;
    case 'server': showServer(); break;
    case 'qr': startQr(); break;
    case 'settings': showSettings(); break;
    case 'about': showAbout(); break;
    case 'pro': Ed.openProPanel(); break;
    case 'home': goHome(); break;
    default: break;
  }
}
/*
 * Ana ekran. AÇIK DOSYA KAPANMAZ — ne çizim ne de belge. Ana ekran yalnız üste gelir; çizim
 * sahnesi (S.scene), görünüm, katmanlar, notlar ve açık belge bellekte durur. Geri dönüş yolu
 * Ev sekmesinin en üstündeki "Kaldığınız yerden devam edin" kartıdır (home.js renderResume).
 *
 * Eskiden burada Docs.close() vardı: belge kapanıyor, kullanıcı ana ekrana düştüğünde dosyanın
 * kapandığını görüyordu. Artık belge de gizlenir, kapanmaz.
 */
function goHome() { closeMenu(); Home.show(); }
/**
 * Uygulamayla gelen örnek çizimi açar. Dosya APK'nın içindedir; yol GÖRECELİdir, böylece hem
 * uygulamada (/assets/viewer/ornekler/...) hem tarayıcı sınamasında (/ornekler/...) çözülür.
 * Açılış, kullanıcının seçtiği bir dosyayla tıpatıp aynı yoldan geçer (loadBytes): aynı
 * açılış ekranı, aynı kestirim, aynı son dosya kaydı.
 */
async function openSample(ad) {
  const dosya = String(ad || '').replace(/[^\w.-]/g, '');
  if (!dosya) return;
  const key = 'ornek|' + dosya;
  if (loadingKey === key) return;
  loadingKey = key;
  try {
    setLoading(t('loading'), dosya, 0, 'cad');
    const r = await fetch('./ornekler/' + dosya, { cache: 'force-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    await loadBytes(buf, dosya, buf.byteLength);
  } catch (e) { fail(e); }
  finally { if (loadingKey === key) loadingKey = null; }
}
/*
 * Ana ekrandaki "Kaldığınız yerden devam edin" kartı iki kaynaktan beslenir:
 *
 *  bellek — çizim ya da belge şu an AÇIK, yalnız ana ekran üstüne gelmiş. Karta dokunmak
 *           ana ekranı kapatır; yeniden çözümleme yoktur, görünüm olduğu gibi döner.
 *  oturum — uygulama kapanmış, ama son açılan dosya kalıcı olarak kayıtlı. Karta dokunmak
 *           dosyayı normal yoldan açar.
 *
 * Son oturum AÇILIŞTA KENDİLİĞİNDEN yüklenmez. Bir süre öyleydi ve yanlıştı: 27 MB'lık bir
 * modeli bir kez açan kullanıcı, uygulamayı her açtığında onu yeniden çözümlenirken buluyordu.
 * Karar kullanıcıya bırakıldı; otomatik açılış isteyen için ayar duruyor (varsayılanı kapalı).
 */
function resumeInfo() {
  if (Docs.isOpen && Docs.isOpen()) { const n = Docs.currentName && Docs.currentName(); if (n) return { ad: n, bellek: true }; }
  if (S.hasDoc && S.fileName) return { ad: S.fileName, bellek: true };
  try {
    const a = A();
    if (a && a.lastSessionInfo) { const j = a.lastSessionInfo(); if (j) { const o = JSON.parse(j); if (o && o.name) return { ad: o.name, bellek: false, boyut: o.size }; } }
  } catch (e) { /* köprü yok */ }
  return null;
}
/** Devam kartına dokunuldu */
function resumeOpen() {
  const r = resumeInfo();
  if (!r) return;
  if (r.bellek) { Home.hide(); return; }
  try { const a = A(); if (a && a.openLastSession) { a.openLastSession(); return; } } catch (e) { /* köprü yok */ }
  toast(t('openRecentGone') || 'Dosya artık yok', { type: 'warn' });
}
$('moreMenu').addEventListener('click', (ev) => { const b = ev.target.closest('[data-act]'); if (b) menuAction(b.dataset.act); });

function showDocInfo() {
  const c = S.counts;
  const rows = [[t('file'), S.fileName], [t('version'), S.version], [t('unit'), S.units || t('undefinedUnit')], [t('entityCount'), S.entityCount], [t('primCount'), S.prims.length],
    [t('layerN'), S.layers.size], [t('blockN'), S.blockCount], [t('layouts'), S.scene.layouts.map(l => l.name).join(', ')],
    [t('xRange'), S.ext ? fmt(S.ext[0]) + ' … ' + fmt(S.ext[2]) : ''], [t('yRange'), S.ext ? fmt(S.ext[1]) + ' … ' + fmt(S.ext[3]) : ''],
    [t('size'), S.ext ? fmt(S.ext[2] - S.ext[0]) + ' × ' + fmt(S.ext[3] - S.ext[1]) + (S.units ? ' ' + S.units : '') : '']];
  { const c2 = S.counts || {}; const list = Object.entries(c2).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => k + ' ' + v).join(', '); if (list) rows.push([t('entityTypes'), list]);
    const cen = S.scene && S.scene.census; if (cen) { const l2 = Object.entries(cen).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => k + ' ' + v).join(', '); if (l2) rows.push([S.scene.dgn ? t('objTypes') : t('dwgTypes'), l2]); } }
  { const d = S.scene && S.scene.solidDiag; if (d) {
    const surf = Object.entries(d.surfaces || {}).map(([k, v]) => k + ' ' + v).join(', ');
    rows.push([t('solidDiag'), `${d.solids} ${t('solidsN')} · ${d.faces} ${t('facesN')}${d.approx ? ' (' + d.approx + ' ' + t('approxN') + ')' : ''} · ${d.skipped} ${t('skippedN')}` + (surf ? ' · ' + surf : '') + (d.versions.length ? ' · ACIS ' + d.versions.join('/') : '') + (d.unknownTags.length ? ' · ' + t('unknownTag') + ' ' + d.unknownTags.join(' ') : '') + (d.errors.length ? ' · ' + d.errors.join('; ') : '')]);
  } }
  if (S.geo.active && S.ext) { const ll = S.geo.toLonLat((S.ext[0] + S.ext[2]) / 2, (S.ext[1] + S.ext[3]) / 2); if (ll) rows.push([t('crs'), S.geo.crs.name + ` (${t('centerLbl')} φ ${ll[1].toFixed(5)}, λ ${ll[0].toFixed(5)})`]); }
  rows.push(['<strong>' + t('types') + '</strong>']);
  for (const k of Object.keys(c).sort((a, b) => c[b] - c[a])) rows.push([trType(k), c[k]]);
  openDoc(t('info'), kv(rows));
}

/**
 * Sayım paneli: blok adına göre yerleştirme sayısı ve varlık türü dağılımı, yanlarında oransal çubuk.
 * Blok yerleştirmeleri ilkellerden değil TANITICIDAN sayılır: bir INSERT patlatıldığında onlarca ilkel
 * üretir, hepsi aynı tanıtıcıyı taşır; tanıtıcı kümesi gerçek yerleştirme sayısını verir.
 */
function countScope(scope) {
  if (scope === 'sel') { const sel = (editor && editor.sel) ? [...editor.sel] : []; return sel.length ? sel : null; }
  if (scope === 'vis') return S.prims.filter(p => primVisible(p));
  if (scope === 'win') {
    const r = visibleRect(), out = [];
    if (S.tree) S.tree.search(r[0], r[1], r[2], r[3], i => { const p = S.prims[i]; if (primVisible(p)) out.push(p); });
    else for (const p of S.prims) { const bb = p.bb; if (primVisible(p) && bb && bb[2] >= r[0] && bb[0] <= r[2] && bb[3] >= r[1] && bb[1] <= r[3]) out.push(p); }
    return out;
  }
  return S.prims;
}
/*
 * Sayım verisi. Blok yerleştirmeleri ilkellerden değil TANITICIDAN sayılır: bir INSERT
 * patlatıldığında onlarca ilkel üretir, hepsi aynı tanıtıcıyı taşır; tanıtıcı kümesi gerçek
 * yerleştirme sayısını verir. Aynı sayım katman × tür çaprazını da üretir — hangi katmanda kaç
 * çizgi, kaç yazı olduğu keşif ve metraj kontrolünde ilk sorulan şeydir.
 */
function countData(prims) {
  const blocks = new Map(), seen = new Set(), types = new Map(), byLayer = new Map();
  let n = 0;
  for (const p of prims) {
    const i = p.info;
    if (!i) continue;
    n++;
    const et = i.t || '?';
    const lay = p.lay || '0';
    let L = byLayer.get(lay); if (!L) { L = new Map(); byLayer.set(lay, L); }
    const key = i.t === 'INSERT' && i.name ? i.name + '\u0000' + (i.h || '') : (i.h != null ? et + '\u0000' + i.h : null);
    if (key == null || !seen.has(key)) {
      if (key != null) seen.add(key);
      types.set(et, (types.get(et) || 0) + 1);
      L.set(et, (L.get(et) || 0) + 1);
      if (i.t === 'INSERT' && i.name) blocks.set(i.name, (blocks.get(i.name) || 0) + 1);
    }
  }
  return { blocks, types, byLayer, prims: n };
}
function countCsv(d, scope) {
  const L = [];
  L.push([t('count'), S.fileName || ''].map(csvCell).join(';'));
  L.push([t('scope'), t('scope' + scope.charAt(0).toUpperCase() + scope.slice(1))].map(csvCell).join(';'));
  L.push('');
  L.push([t('countBlocks'), t('count')].map(csvCell).join(';'));
  for (const [name, n] of [...d.blocks].sort((a, b) => b[1] - a[1])) L.push([name, n].map(csvCell).join(';'));
  L.push('');
  L.push([t('countTypes'), t('count')].map(csvCell).join(';'));
  for (const [k, n] of [...d.types].sort((a, b) => b[1] - a[1])) L.push([trType(k), n].map(csvCell).join(';'));
  L.push('');
  const tl = [...d.types].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  L.push([t('countByLayer'), ...tl.map(trType), t('total')].map(csvCell).join(';'));
  for (const [lay, m] of [...d.byLayer].sort((a, b) => a[0].localeCompare(b[0]))) {
    let tot = 0; for (const v of m.values()) tot += v;
    L.push([lay, ...tl.map(k => m.get(k) || ''), tot].map(csvCell).join(';'));
  }
  return L.join('\r\n');
}
function showCount(scope) {
  const sc = scope || 'all';
  const prims = countScope(sc);
  if (!prims) { toast(t('selectFirstQ'), { type: 'warn' }); return; }
  const d = countData(prims);
  const bar = (n, max) => `<div class="cbar"><i style="width:${Math.max(2, Math.round(100 * n / (max || 1)))}%"></i></div>`;
  const rows = [];
  const opt = (id) => `<option value="${id}"${id === sc ? ' selected' : ''}>${esc(t('scope' + id.charAt(0).toUpperCase() + id.slice(1)))}</option>`;
  rows.push([t('scope'), `<select id="cntScope">${opt('all')}${opt('sel')}${opt('vis')}${opt('win')}</select>`, 1]);
  const bl = [...d.blocks].sort((a, b) => b[1] - a[1]);
  const bmax = bl.length ? bl[0][1] : 0;
  rows.push([`<div class="cnt-h"><strong>${esc(t('countBlocks'))}</strong> <span>${bl.length ? bl.reduce((n, x) => n + x[1], 0) : 0}</span></div>`]);
  if (!bl.length) rows.push([t('countNone')]);
  for (const [name, n] of bl.slice(0, 200)) rows.push([name, n + bar(n, bmax), 1]);
  const tl = [...d.types].sort((a, b) => b[1] - a[1]);
  const tmax = tl.length ? tl[0][1] : 0;
  rows.push([`<div class="cnt-h"><strong>${esc(t('countTypes'))}</strong> <span>${tl.reduce((n, x) => n + x[1], 0)}</span></div>`]);
  for (const [k, n] of tl) rows.push([trType(k), n + bar(n, tmax), 1]);
  const ll = [...d.byLayer].sort((a, b) => a[0].localeCompare(b[0]));
  if (ll.length > 1) {
    rows.push([`<div class="cnt-h"><strong>${esc(t('countByLayer'))}</strong> <span>${ll.length}</span></div>`]);
    for (const [lay, m] of ll.slice(0, 200)) {
      let tot = 0; for (const v of m.values()) tot += v;
      const dok = [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => trType(k) + ' ' + v).join(', ');
      rows.push([lay, tot + (dok ? ' <span class="muted">(' + esc(dok) + ')</span>' : ''), 1]);
    }
  }
  rows.push([`<div class="full btns"><button class="btn small" id="cntCsv">${esc(t('exportCsv'))}</button><button class="btn small" id="cntCopy">${esc(tt('copyClip', 'Panoya kopyala'))}</button></div>`]);
  openDoc(t('count'), kv(rows));
  const sel = $('cntScope'); if (sel) sel.onchange = () => showCount(sel.value);
  $('cntCsv').onclick = () => { saveTextFile('\ufeff' + countCsv(d, sc), baseName() + '_sayim_' + stamp() + '.csv', 'text/csv'); hide('docPanel'); };
  $('cntCopy').onclick = () => copyText(countCsv(d, sc).replace(/;/g, '\t'));
}
/** derleme kimliği (kısa git SHA; Bridge.buildId) — Hakkında satırına ve hata kaydı başlığına eklenir */
function buildIdText() { try { return A() && A().buildId ? ' · ' + A().buildId() : ''; } catch (_) { return ''; } }
function showAbout() {
  const ver = (A() && A().appVersion ? A().appVersion() : 'web') + (A() && A().versionCode ? ` (${A().versionCode()})` : '') + buildIdText() + ' · ' + Ed.tierName(Ed.tier());
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
  // Model uzayı ile kâğıt düzeninin koordinatları ayrı dünyalardır: seçili PDF alanı taşınamaz
  pdfWin = null; if (pdfAyar.area === 'win') pdfAyar.area = 'view';
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
  if (on && !Ed.gate('notes')) return;
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
    const txt = await askText(t('notePrompt'), '', { multiline: true, words: true });
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

// ---- yeni dosya ------------------------------------------------------------------------
/**
 * Yeni boş belge: tür seçilir, ad sorulur, dosya üretilip normal açma yolundan açılır.
 * Düzenleme Pro özelliği olduğundan oluşturma da Pro'ya bağlıdır; ücretsizde Pro paneli açılır.
 */
function showNewDoc() {
  if (!Ed.gate('new')) return;   // rozet de bu kimliği okur (home TOOLS 'new'); ikisi ayrışmasın
  const html = `<div class="new-grid">${New.NEW_KINDS.map(k => `<button type="button" class="new-item" data-new="${k.id}"><svg class="ic" aria-hidden="true"><use href="#${k.icon}"/></svg><span>${esc(t(k.i18n))}</span><small>.${k.ext}</small></button>`).join('')}</div>`;
  openDoc(tt('newFile', 'Yeni dosya'), html);
  let busy = false;
  $('docBody').onclick = async (ev) => {
    const b = ev.target.closest('[data-new]'); if (!b || busy) return;
    const id = b.dataset.new;
    busy = true;
    try { await createNew(id); } finally { busy = false; }
  };
  async function createNew(id) {
    const name = await askText(tt('newFile', 'Yeni dosya'), New.defaultName(id), { ph: tt('newNamePh', 'dosya adı') });
    if (!name) return;
    const k = New.kindOfNew(id);
    const full = name.toLowerCase().endsWith('.' + k.ext) ? name : name + '.' + k.ext;
    hide('docPanel');
    setLoading(t('loading'), full, undefined, Docs.isCad(full) ? 'cad' : 'doc');
    try { await New.createAndOpen(id, full, { openBlob: (f, n) => Docs.openBlob(f, n) }); }
    catch (e) { console.warn(e); toast(tt('newFail', 'Yeni dosya oluşturulamadı') + ': ' + e.message, { type: 'error', ms: 6000 }); }
    finally { setLoading(null); }
  }
}

// ---- ayarlar ---------------------------------------------------------------------------
/** Dil listesi: "Cihaz dili" + desteklenen diller (kendi yazımlarıyla). Seçim yoksa cihazın dili kullanılır. */
function langOptions() {
  const cur = settings.lang || 'auto';
  const sel = (v) => (v === cur ? ' selected' : '');
  const auto = `${t('langAuto')} — ${langInfo(resolveLang('auto')).native}`;
  return `<option value="auto"${sel('auto')}>${esc(auto)}</option>` +
    LANGS.map(l => `<option value="${l.id}"${sel(l.id)}>${esc(l.native)}</option>`).join('');
}

/*
 * Ayarlar. `ek`, projeksiyon seçicisinden dönerken formun yazılmamış değerlerini geri getirir:
 * kullanıcı birim ya da kaydırma yazdıysa harita kutusuna gidip gelmek onları silmemelidir.
 */
function showSettings(ek) {
  const g = S.fileKey ? (store.json('geo:' + S.fileKey, null) || {}) : {};
  const cur = { crs: g.crs || settings.crs, unit: g.unit || settings.unit, swap: g.swap != null ? g.swap : settings.swap, dx: g.dx || settings.dx || 0, dy: g.dy || settings.dy || 0, ...(ek || {}) };
  const unitOpts = [['auto', t('unitFromDrawing') + (S.units ? ': ' + S.units : '') + ')'], ['0.001', 'mm'], ['0.01', 'cm'], ['1', 'm'], ['0.1', 'dm'], ['1000', 'km']];
  const html = kv([
    [t('language'), `<select id="sLang">${langOptions()}</select>`, 1],
    [t('crs'), `<select id="sCrs">${CRS.map(c => `<option value="${c.id}" ${c.id === cur.crs ? 'selected' : ''}>${esc(nameOf(c))}</option>`).join('')}</select>`, 1],
    // Dilim ve datumu kullanıcı hesaplamasın: yerden (il/ilçe, harita, adres, koordinat ya da çizimin kendisi) seçilsin
    [`<div class="full btns"><button type="button" class="btn small" id="sCrsPick">${esc(tt('psOpen', 'Yerden seç: il / ilçe · harita · adres'))}</button></div>`],
    [t('drawingUnit'), `<select id="sUnit">${unitOpts.map(o => `<option value="${o[0]}" ${String(cur.unit) === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`, 1],
    [t('axisSwap'), `<label class="chk"><input type="checkbox" id="sSwap" ${cur.swap ? 'checked' : ''}> ${esc(t('axisSwapHint'))}</label>`, 1],
    [t('offset') + ' X', `<input id="sDx" type="number" step="any" value="${cur.dx}">`, 1],
    [t('offset') + ' Y', `<input id="sDy" type="number" step="any" value="${cur.dy}">`, 1],
    [t('lwScale'), `<input id="sLw" type="number" step="0.5" min="1" max="10" value="${S.lwScale}">`, 1],
    [t('decimals'), `<select id="sPrec">${Array.from({ length: PREC_MAX - PREC_MIN + 1 }, (_, i) => PREC_MIN + i).map(n => `<option value="${n}" ${n === S.prec ? 'selected' : ''}>${n}</option>`).join('')}</select>`, 1],
    [t('decimalsPad'), `<label class="chk"><input type="checkbox" id="sPrecPad" ${S.precPad ? 'checked' : ''}> ${esc(t('decimalsPadHint'))}</label>`, 1],
    // Oturum sürekliliği: yalnız köprü varken anlamlı (tarayıcıda dosya erişimi kalıcı değil)
    ...(A() && A().getResumeLast ? [[t('resumeKeep'), `<label class="chk"><input type="checkbox" id="sResume" ${A().getResumeLast() ? 'checked' : ''}> ${esc(t('resumeAuto'))}</label>`, 1]] : []),
    [`<div class="full muted">${S.fileKey ? esc(t('geoPerFile')) + ' ' : ''}${esc(t('ed50Note'))}</div>`],
    [`<div class="full btns"><button class="btn primary small" id="sSave">${t('save')}</button><button class="btn small" id="sDisplay">${tt('dispTitle', 'Ekran ayarları')}</button></div>`]]);
  let a11y = null;
  try { if (typeof editorMod.accessibilitySection === 'function') a11y = editorMod.accessibilitySection(); } catch (e) { console.warn(e); a11y = null; }
  openDoc(t('settings'), html + (a11y && a11y.html ? a11y.html : ''));
  if (a11y && typeof a11y.bind === 'function') { try { a11y.bind($('docBody')); } catch (e) { console.warn(e); } }
  $('sCrsPick').onclick = () => {
    // Form değerleri korunur: seçiciden dönünce kullanıcı yazdığı birim ve kaydırmayı yeniden yazmasın
    const form = { unit: $('sUnit').value, swap: $('sSwap').checked, dx: Number($('sDx').value) || 0, dy: Number($('sDy').value) || 0 };
    const birim = form.unit && form.unit !== 'auto' ? Number(form.unit) : (S.unitToM || 1);
    const ext = S.ext && isFinite(S.ext[0]) ? S.ext.map(v => v * birim) : null;
    /*
     * Haritanın karoları kullanıcının seçtiği altlıktan gelir (uydu seçiliyse uydudan seçer);
     * altlık yoksa ya da özel adres girilmemişse OpenStreetMap kullanılır. `window.__psKaro`
     * sınama kancasıdır: karolar yerel sunucudan verilsin diye.
     */
    const bm = BASEMAPS.find(b => b.id === S.basemap.id);
    const sablon = (bm && bm.custom ? S.basemap.url : (bm && bm.url)) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const karoUrl = window.__psKaro || ((x, y, z) => sablon.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{-y}', (2 ** z - 1 - y)).replace('{s}', 'abc'[(x + y) % 3]));
    import('./projsec.js').then((m) => {
      m.acProjSecici({
        openDoc, toast, ext, karoUrl,
        lonLat0: (S.gps && S.gps.lon != null) ? [S.gps.lon, S.gps.lat] : (S.geo.active ? S.geo.toLonLat((S.ext[0] + S.ext[2]) / 2, (S.ext[1] + S.ext[3]) / 2) : null),
        uygula: (id) => { showSettings({ ...form, crs: id }); toast(tt('psSelected', 'Koordinat sistemi seçildi') + ': ' + nameOf(crsById(id)), 2600); },
      });
    }).catch((e) => { console.warn(e); toast(t('error') + ': ' + e.message, { type: 'error' }); });
  };
  $('sDisplay').onclick = () => { hide('docPanel'); openDisplayOptions(); };
  $('sSave').onclick = () => {
    settings.lang = $('sLang').value; settings.lwScale = Number($('sLw').value) || 3;
    settings.prec = clampPrec($('sPrec').value); settings.precPad = $('sPrecPad').checked;
    { const r = $('sResume'); if (r && A() && A().setResumeLast) { try { A().setResumeLast(!!r.checked); } catch (e) { /* köprü yok */ } } }
    const geo = { crs: $('sCrs').value, unit: $('sUnit').value, swap: $('sSwap').checked, dx: Number($('sDx').value) || 0, dy: Number($('sDy').value) || 0 };
    if (S.fileKey) store.set('geo:' + S.fileKey, JSON.stringify(geo));
    Object.assign(settings, geo); saveSettings(); applySettings(); applyGeo();
    D.syncGridChip && D.syncGridChip(); edCall("yenile3B");   // birim değişince ızgara etiketi, ölçek ve 3B sahnesi yeniden kurulur
    S.cacheValid = false; requestRender(); drawOverlay();
    if (!$('measurePanel').hidden) updateMeasure();
    hide('docPanel'); toast(t('save') + ' ✓');
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
  setLoading(t('loading'), name, undefined, 'cad');
  try {
    const res = await runWorker({ cmd: 'parse', bytes: buf, name }, (st, pct) => setLoading(stageText(st), name, pct));
    /*
     * Karşılaştırma ETKİN DÜZEN üzerinden yapılır. Eskiden iki tarafta da layouts[0] (Model)
     * okunuyordu: paftası kâğıt düzeninde duran iki sürüm karşılaştırıldığında ekranda düzen
     * görünürken Model karşılaştırılıyor ve "fark yok" deniyordu. Karşı dosyada aynı adlı düzen
     * aranır; yoksa aynı sıradaki, o da yoksa Model kullanılır.
     */
    const curLay = S.scene.layouts[S.layoutIndex] || S.scene.layouts[0];
    const bLays = res.scene.layouts;
    const bLay = bLays.find(l => l.name === curLay.name) || bLays[S.layoutIndex] || bLays[0];
    const B = bLay.prims.filter(p => p.k !== 4);
    const Aprims = curLay.prims;
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
/*
 * HARİCİ REFERANSLAR (v7.72). İki kaynak: dosyanın kendi eksik xref kayıtları (scene.xrefs: ad + ekleme matrisleri;
 * dosya seçilince yüklenir) ve XATTACH ile eklenenler (ekleme noktası, ölçek, dönüş formdan). Yüklenen referansın
 * ilkelleri model uzayına girer (p.xref = ad; katmanlar "ad|katman"), soldurulur (XDWGFADECTL), kırpılabilir (XCLIP:
 * dikdörtgen; yeniden yüklemede korunur), boşaltılıp yeniden yüklenebilir (önbellek), ayrılır (DETACH), bağlanır
 * (XBIND: blok tanımı + yerleştirme) ya da ayrı dosya olarak açılır (XOPEN). Ekleme kalıcı değildir: dosyaya
 * erişim oturumluktur, DXF'e referansın ilkelleri değil (bağlanmadıysa) hiçbir şey yazılmaz.
 */
function showXrefs() {
  const xr = S.scene.xrefs || [], im = S.scene.images || [];
  const b = (a, i, lbl, cls = '') => `<button type="button" class="btn small${cls ? ' ' + cls : ''}" data-xa="${a}" data-i="${i}">${esc(lbl)}</button>`;
  let html = `<div class="full btns"><button type="button" class="btn primary small" data-xa="attach">${esc(t('xattachTitle'))}</button><button type="button" class="btn small${S.xrefFade > 0 ? ' on' : ''}" data-xa="fade">${esc(t('xrefFade'))}</button></div>`;
  if (!xr.length && !im.length) html += `<div class="full muted">${esc(t('noXrefs'))}</div>`;
  xr.forEach((x, i) => {
    const st = x.loaded ? t('loadedMark') + ' · ' + (x.keys ? x.keys.length : 0) + ' ' + t('prims') + (x.clip ? ' · ' + t('xrefClipped') : '') : (x.unloaded ? t('xrefUnloadedMark') : t('xrefMissing'));
    const acts = x.loaded
      ? b('unload', i, t('xrefUnload')) + b('clip', i, t('xrefClip')) + (x.clip ? b('unclip', i, t('xrefClipClear')) : '') + b('bind', i, t('xrefBind')) + (x.buf ? b('open', i, t('xrefOpen')) : '') + b('detach', i, t('xrefDetach'))
      : (x.prims || x.buf ? b('reload', i, t('xrefReload')) : b('pick', i, t('pickXref'))) + b('detach', i, t('xrefDetach'));
    html += `<div class="full blk-row"><div class="blk-name"><b>${esc(x.name)}</b><small>${esc(st)} · ${x.inserts.length} ${esc(t('insertsN'))}${x.file ? ' · ' + esc(x.file) : ''}</small></div><div class="blk-btns">${acts}</div></div>`;
  });
  if (im.length) html += `<div class="full opt-title">${esc(t('imgMissing'))}</div>` + im.map((x, i) => `<div class="full blk-row"><div class="blk-name"><b>${esc((x.fileName || x.handle).replace(/^.*[\\/]/, ''))}</b></div><div class="blk-btns">${S.images.has(x.handle) && S.images.get(x.handle).ok ? '✓' : `<button type="button" class="btn small" data-img="${i}">${esc(t('pickXref'))}</button>`}</div></div>`).join('');
  openDoc(t('xrefs'), html);
  $('docBody').onclick = async (ev) => {
    const bt = ev.target.closest('button'); if (!bt) return;
    if (bt.dataset.img != null) { pickFile('img:' + im[Number(bt.dataset.img)].handle, 'image/*'); return; }
    const a = bt.dataset.xa, i = Number(bt.dataset.i), x = xr[i];
    if (a === 'attach') { if (!Ed.gate('xattach')) return; hide('docPanel'); pickFile('xattach', '*/*'); return; }
    if (a === 'fade') { edCall('act', 'xreffade'); showXrefs(); return; }
    if (!x) return;
    if (a === 'pick') { pickFile('xref:' + i, '*/*'); return; }
    if (a === 'unload') { xrefRemovePrims(x); x.loaded = false; x.unloaded = true; toast(t('xrefUnloaded').replace('%s', x.name), 1600); showXrefs(); return; }
    if (a === 'reload') { if (x.prims) { xrefPushPrims(x, x.prims); toast(t('xrefReloaded').replace('%s', x.name), 1600); showXrefs(); } else if (x.buf) await loadXref(i, x.buf.slice(0), x.file || x.name); return; }
    if (a === 'detach') { if (!(await askConfirm(t('xrefDetachAsk').replace('%s', x.name)))) return; xrefRemovePrims(x); if (x.attached) xr.splice(i, 1); else { x.loaded = false; x.unloaded = false; x.prims = null; } toast(t('xrefDetached').replace('%s', x.name), 1600); showXrefs(); return; }
    if (a === 'clip') { if (!Ed.gate('t:xclip')) return; hide('docPanel'); editor.act('t:xclip'); return; }
    if (a === 'unclip') { x.clip = null; if (x.prims) { xrefPushPrims(x, x.prims); toast(t('xrefClipClear'), 1400); } showXrefs(); return; }
    if (a === 'bind') { hide('docPanel'); await xrefBind(x); return; }
    if (a === 'open') { hide('docPanel'); await xrefOpen(x); return; }
  };
}
/** Referansın ilkellerini model uzayından çıkarır (yeniden yükleme için önbellek x.prims'te kalır) */
function xrefRemovePrims(x) {
  const model = S.scene.layouts[0];
  const set = new Set(x.keys || []);
  if (set.size) { const kept = model.prims.filter(p => !set.has(p.key)); model.prims.length = 0; for (const p of kept) model.prims.push(p); }
  x.keys = [];
  xrefRebuild();
}
/** Referans ilkellerini (kırpma varsa kırparak) model uzayına koyar; anahtar 'X<ad>#<n>', p.xref = ad */
function xrefPushPrims(x, prims) {
  xrefRemovePrims(x);
  const model = S.scene.layouts[0];
  const list = x.clip ? B_clipPrims(prims, x.clip) : prims;
  const keys = [];
  list.forEach((p, i) => { p.xref = x.name; p.key = 'X' + x.name + '#' + i; keys.push(p.key); model.prims.push(p); });
  x.keys = keys; x.loaded = true; x.unloaded = false;
  xrefRebuild();
}
let BLK = null;
function B_clipPrims(prims, rect) { return BLK ? BLK.clipPrims(prims, rect) : prims; }
function xrefRebuild() {
  const model = S.scene.layouts[0];
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of model.prims) { if (p.inf || p.k === 4 || !p.bb || !isFinite(p.bb[0])) continue; if (p.bb[0] < bb[0]) bb[0] = p.bb[0]; if (p.bb[1] < bb[1]) bb[1] = p.bb[1]; if (p.bb[2] > bb[2]) bb[2] = p.bb[2]; if (p.bb[3] > bb[3]) bb[3] = p.bb[3]; }
  if (isFinite(bb[0])) model.ext = bb;
  S.modelTree = new RTree(model.prims, p => p.bb);
  if (S.scene.layouts[S.layoutIndex].isModel) { S.prims = model.prims; S.tree = S.modelTree; S.ext = model.ext; }
  S.cacheValid = false; requestRender(); drawOverlay();
}
async function loadXref(idx, buf, name) {
  const x = S.scene.xrefs[idx];
  if (!BLK) { try { BLK = await import('./blocks.js'); } catch (e) { console.warn(e); } }
  setLoading(t('loading'), name, undefined, 'cad');
  try {
    const keep = buf.slice(0);   // işçi tamponu devralır; yeniden yükleme ve XOPEN için kopya kalır
    const res = await runWorker({ cmd: 'xref', bytes: buf, name, inserts: x.inserts, prefix: x.name }, (st, pct) => setLoading(stageText(st), name, pct));
    for (const l of res.xref.layers) if (!S.layers.has(l.name)) S.layers.set(l.name, { ...l });
    Object.assign(S.ltypes, res.xref.ltypes);
    x.prims = res.xref.prims; x.buf = keep; x.file = name;
    xrefPushPrims(x, x.prims);
    toast(t('xrefAttached').replace('%s', x.name) + ' · ' + x.keys.length + ' ' + t('prims'), 2200);
    showXrefs();
  } catch (e) { fail(e); }
  setLoading(null);
}
/** XATTACH: dosya seçildi → ekleme noktası, ölçek, dönüş ve ad formu → yükleme */
async function xattachLoad(buf, name) {
  if (!S.hasDoc || !S.scene.layouts[S.layoutIndex].isModel) { toast(t('modelOnly')); return; }
  if (!Ed.gate('xattach')) return;
  const base = String(name || 'xref').replace(/\.[^.]+$/, '');
  const r = await askForm(t('xattachTitle') + ' — ' + name, [
    { id: 'name', label: t('xrefName'), type: 'text', value: base },
    { id: 'x', label: t('insPoint') + ' X', type: 'number', value: String(+S.view.cx.toPrecision(12)) },
    { id: 'y', label: t('insPoint') + ' Y', type: 'number', value: String(+S.view.cy.toPrecision(12)) },
    { id: 'scale', label: t('blockScale'), type: 'number', value: 1 },
    { id: 'rot', label: t('blockRot'), type: 'number', value: 0 },
  ], { ok: t('ok'), hint: t('xattachHint') });
  if (!r) return;
  let nm = String(r.name || base).trim() || base;
  const xr = S.scene.xrefs;
  if (xr.some(x => x.name.toUpperCase() === nm.toUpperCase())) { let k = 2; while (xr.some(x => x.name.toUpperCase() === (nm + '_' + k).toUpperCase())) k++; nm = nm + '_' + k; }
  const rot = (isFinite(r.rot) ? r.rot : 0) * Math.PI / 180, sc = isFinite(r.scale) && r.scale ? r.scale : 1, cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
  const m = [cs, sn, -sn, cs, isFinite(r.x) ? r.x : 0, isFinite(r.y) ? r.y : 0];
  xr.push({ name: nm, inserts: [{ m, layer: '0', color: FG }], loaded: false, attached: true, keys: [] });
  await loadXref(xr.length - 1, buf, name);
}
/** XCLIP (t:xclip → editor api): dikdörtgen kırpma; yeniden yüklemede korunur */
function xrefClip(name, rect) {
  const x = (S.scene.xrefs || []).find(q => q.name === name);
  if (!x || !x.prims) { toast(t('notXref')); return false; }
  x.clip = rect.slice();
  xrefPushPrims(x, x.prims);
  toast(t('xrefClipped') + ' · ' + x.keys.length + ' ' + t('prims'), 1800);
  return true;
}
/** XBIND: referans blok tanımı + yerleştirme olur (ilkeller matris tersiyle tanım uzayına; katman adları "ad|katman" kalır) */
async function xrefBind(x) {
  if (!Ed.gate('xbind') || !x || !x.loaded || !x.keys || !x.keys.length) { toast(t('notXref')); return false; }
  if (!BLK) { try { BLK = await import('./blocks.js'); } catch (e) { console.warn(e); return false; } }
  const L = await blockLib(); if (!L) return false;
  const model = S.scene.layouts[0], set = new Set(x.keys);
  const prims = model.prims.filter(p => set.has(p.key));
  const m0 = (x.inserts[0] && x.inserts[0].m) || [1, 0, 0, 1, 0, 0], inv = BLK.invert(m0);
  if (!inv) { toast(t('error')); return false; }
  const ents = BLK.xformEnts(prims.map(p => L.primToEnt(p)).filter(Boolean), inv, 0);
  if (!ents.length) { toast(t('error')); return false; }
  let name = x.name; if (S.blocks.has(BLK.keyOf(name))) name = name + '$0';
  const ins = BLK.withMatrix({ type: 'INSERT', id: 'E' + Date.now().toString(36) + 'x', name, layer: '0', color: 256, z: 0 }, m0, 0);
  const ok = editor.runCmd({ op: 'group', cmds: [{ op: 'blockdef', name, def: { name, base: [0, 0, 0], ents, dyn: null } }, { op: 'add', ents: [ins] }] });
  if (!ok) { toast(t('error')); return false; }
  xrefRemovePrims(x);
  const i = S.scene.xrefs.indexOf(x); if (i >= 0) S.scene.xrefs.splice(i, 1);
  toast(t('xrefBound').replace('%s', name), 2400);
  return true;
}
/** XOPEN: referans dosyasını bu çizimin yerine açar (onaylı) */
async function xrefOpen(x) {
  if (!x || !x.buf) { toast(t('xrefNoBuf')); return; }
  if (!(await askConfirm(t('xrefOpenAsk').replace('%s', x.file || x.name)))) return;
  await loadBytes(x.buf.slice(0), x.file || x.name + '.dwg', x.buf.byteLength);
}
const xrefLoadedList = () => (S.scene && S.scene.xrefs ? S.scene.xrefs.filter(x => x.loaded) : []);
async function xrefPickOne(title) {
  const list = xrefLoadedList();
  if (!list.length) { toast(t('notXref')); return null; }
  if (list.length === 1) return list[0];
  const r = await askForm(title, [{ id: 'n', label: t('xrefName'), type: 'select', value: list[0].name, options: list.map(x => [x.name, x.name]) }], { ok: t('ok') });
  return r ? list.find(x => x.name === r.n) : null;
}
async function xrefBindPick() { const x = await xrefPickOne(t('xrefBind')); if (x) await xrefBind(x); }
async function xrefOpenPick() { const x = await xrefPickOne(t('xrefOpen')); if (x) await xrefOpen(x); }
async function xrefDetachPick() { const x = await xrefPickOne(t('xrefDetach')); if (!x) return; if (!(await askConfirm(t('xrefDetachAsk').replace('%s', x.name)))) return; xrefRemovePrims(x); const i = S.scene.xrefs.indexOf(x); if (x.attached && i >= 0) S.scene.xrefs.splice(i, 1); else { x.loaded = false; x.prims = null; } toast(t('xrefDetached').replace('%s', x.name), 1600); }
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
  const html = kv([[t('serverUrl'), `<input id="srvUrl" value="${esc(last)}" placeholder="https://…/paftalar.json">`, 1], [`<div class="full btns"><button class="btn primary small" id="srvGo">${t('download')}</button></div>`], [`<div class="full" id="srvList"></div>`],
    [`<div class="full btns"><button type="button" class="btn small" id="srvOffline">${tt('openOfflineLink', 'Çevrimdışı kopyalar → Dosya Aç')}</button></div>`]]);   // çevrimdışı kopyalar artık Dosya Aç merkezinde (open.js)
  openDoc(t('server'), html);
  $('srvGo').onclick = () => fetchIndex($('srvUrl').value.trim());
  $('srvOffline').onclick = () => { hide('docPanel'); Open.open('offline'); };
}
async function fetchIndex(url) {
  if (!url) return;
  store.set('serverUrl', url);
  if (/\.(dwg|dxf|dgn)(\?.*)?$/i.test(url)) { downloadDwg(url, decodeURIComponent(url.split('/').pop().split('?')[0])); return; }
  const list = $('srvList');
  list.innerHTML = skelList(4);
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
      const re = /href="([^"]+\.(?:dwg|dxf|dgn))"/ig; let m;
      while ((m = re.exec(html))) files.push({ name: decodeURIComponent(m[1].split('/').pop()), url: new URL(m[1], url).href });
    }
    list.innerHTML = files.length ? `<div class="list">` + files.map((f, i) => `<div class="item" data-f="${i}">${esc(f.name)}<small>${esc(f.url)}</small></div>`).join('') + `</div>`
      : emptyBox('cloud', t('noResult'), tt('srvNoFiles', 'Bu adreste DWG, DXF ya da DGN dosyası bulunamadı.'));
    list.onclick = (ev) => { const it = ev.target.closest('[data-f]'); if (it) { const f = files[Number(it.dataset.f)]; downloadDwg(f.url, f.name); } };
  } catch (e) { list.innerHTML = `<div class="muted">${esc(t('error'))}: ${esc(e.message)}</div>`; }
}
async function downloadDwg(url, name) {
  setLoading(t('download'), name, 0, 'cloud');
  try {
    const buf = await fetchBuf(url, (p) => setLoading(t('download'), name, p));
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
/*
 * Geçerli görünümün resmi. Kaydetmekten AYRI tutulur: paylaşmak için dosyaya yazmak gerekmez
 * (bkz. paylasGorunum). 3B'de görünümün kendi ekran görüntüsü alınır, 2B'de tuval ile kaplama
 * (notlar, ölçüler, işaretler) üst üste bindirilir — ekranda ne görünüyorsa o.
 */
function gorunumPng() {
  let data = null;
  if (editor.is3D()) {
    const v = editor.view3d();
    if (v && typeof v.screenshot === 'function') { try { data = v.screenshot({ overlay: ov }); } catch (e) { console.warn(e); data = null; } }
    if (!data && v) { const c = document.createElement('canvas'); c.width = v.cv.width; c.height = v.cv.height; const g = c.getContext('2d'); g.drawImage(v.cv, 0, 0); g.drawImage(ov, 0, 0, c.width, c.height); data = c.toDataURL('image/png'); }
  }
  if (!data) {
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d'); g.drawImage(cv, 0, 0); g.drawImage(ov, 0, 0);
    try { data = c.toDataURL('image/png'); } catch (e) { console.warn(e); return null; }
  }
  return data;
}
const gorunumAdi = (ek) => baseName() + '_' + stamp() + (editor.is3D() ? '_3d' : '') + (ek || '') + '.png';
function savePng(dataUrl, name) {
  let data = typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl : null;
  name = name || gorunumAdi();
  if (!data) { data = gorunumPng(); if (!data) { toast(t('pngFail'), { ms: 5000, type: 'error' }); return; } }
  if (A() && A().savePng) A().savePng(data.split(',')[1], name);
  else { const a = document.createElement('a'); a.href = data; a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000); }
  lastPng = { b64: data.split(',')[1], name };
  toast(tt('pngSaved', 'PNG kaydedildi'), { type: 'ok', action: Drive.signedIn() && Ed.has('driveUpload') ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => Drive.uploadWithPicker({ b64: lastPng.b64, name: lastPng.name, mime: 'image/png' }) } : undefined });
}
/*
 * EKRANDAKİ GÖRÜNTÜYÜ PAYLAŞMA (v7.89).
 *
 * Sahada en çok yapılan iş, bakılan yeri birine göstermektir: "şu bacanın kotu ne?", "bu hat
 * buradan mı geçiyor?" Bunun için çizimi dışa aktarmak, dosyayı bulmak ve eklemek gerekiyordu.
 * Artık tek dokunuş: ekranda ne varsa (2B görünüm, 3B model, ölçü çizgileri, kırmızı kalem
 * notları) resim olur ve paylaşıma gider.
 *
 * pkg verilirse niyet doğrudan o uygulamaya gider ve kişi seçimini o uygulama yapar. Kurulu
 * değilse KENDİLİĞİNDEN genel seçiciye düşmeyiz: düğmenin üstünde belirli bir uygulamanın
 * işareti varken başka bir pencere açmak, kullanıcının beklediği şey değildir. Önce söylenir,
 * sonra genel paylaşım önerilir.
 *
 * Belge kipinde (PDF / Word / Excel / ZIP) tuval yoktur; orada paylaşılan şey belgenin
 * KENDİSİdir — ekranda duran da odur.
 */
function paylasGorunum(pkg, etiket) {
  const ad = etiket || tt('shareTarget', 'paylaşım');
  /*
   * Belge kipinde ekranda ÇİZİM yoktur. Belge gönderilemiyorsa (tarayıcı yapısında belgenin
   * Android tarafında bir kimliği olmaz) çizimin resmini göndermek yanlış olur: kullanıcı
   * ekranda belgeyi görürken karşı tarafa bambaşka bir şey giderdi. Söylenir, gönderilmez.
   */
  if (Docs.isOpen && Docs.isOpen()) {
    if (Docs.shareTo(pkg, ad)) return;
    toast(tt('shareDocFail', 'Bu belge bu cihazdan paylaşılamıyor'), { type: 'error' });
    return;
  }
  if (!S.hasDoc) { toast(tt('shareNoDoc', 'Önce bir çizim açın'), { type: 'error' }); return; }
  const data = gorunumPng();
  if (!data) { toast(t('pngFail'), { ms: 5000, type: 'error' }); return; }
  const b64 = data.split(',')[1], name = gorunumAdi();
  const alt = tt('shareCaption', 'DWG OfficeZip ile paylaşıldı') + ' · ' + (S.fileName || '');
  if (A() && A().shareImage) {
    const r = A().shareImage(b64, name, alt, pkg || '');
    if (r === 'yok') { toast(tt('shareNotInstalled', '%s bu cihazda kurulu değil').replace('%s', ad), { type: 'error', ms: 4000, action: { label: tt('shareOther', 'Başka uygulama'), fn: () => paylasGorunum('', '') } }); return; }
    if (!r) { toast(tt('shareFail', 'Görüntü paylaşılamadı'), { type: 'error' }); return; }
    haptic('tap');
    return;
  }
  // Tarayıcı yapısı: dosya paylaşımını destekleyen tarayıcıda sistem paylaşımı, yoksa indirme.
  void paylasTarayici(data, name, alt);
}
async function paylasTarayici(data, name, alt) {
  try {
    const bin = atob(data.split(',')[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const f = new File([u8], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], text: alt }); return; }
  } catch (e) { console.warn(e); }
  savePng(data, name);
  toast(tt('shareSaved', 'Görüntü kaydedildi; paylaşmak için telefondaki uygulamayı kullanın'), { ms: 5000 });
}
let lastPng = null;
const baseName = () => (S.fileName || 'cizim').replace(/\.(dwg|dxf|dgn)$/i, '');
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
/*
 * Kâğıt ölçüleri (mm, DİKEY: genişlik × yükseklik). AutoCAD'in çizici kâğıt listesinin
 * mühendislikte kullanılan bölümüdür: ISO A ve B serileri, ANSI ve ARCH. 'Özel' listede
 * yoktur — kullanıcı ölçüyü kendi yazar (bkz. showPdf).
 */
const PAPERS = {
  A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189],
  B4: [250, 353], B3: [353, 500], B2: [500, 707], B1: [707, 1000], B0: [1000, 1414],
  'ANSI A': [216, 279], 'ANSI B': [279, 432], 'ANSI C': [432, 559], 'ANSI D': [559, 864], 'ANSI E': [864, 1118],
  'ARCH A': [229, 305], 'ARCH B': [305, 457], 'ARCH C': [457, 610], 'ARCH D': [610, 914], 'ARCH E1': [762, 1067], 'ARCH E': [914, 1219],
};
const PAPER_GRUP = [['ISO A', ['A4', 'A3', 'A2', 'A1', 'A0']], ['ISO B', ['B4', 'B3', 'B2', 'B1', 'B0']],
  ['ANSI', ['ANSI A', 'ANSI B', 'ANSI C', 'ANSI D', 'ANSI E']], ['ARCH', ['ARCH A', 'ARCH B', 'ARCH C', 'ARCH D', 'ARCH E1', 'ARCH E']]];
/** En son seçilen alan penceresi (dünya dikdörtgeni) — PDF kutusu kapansa da hatırlanır */
let pdfWin = null;
/*
 * PDF KUTUSU — AutoCAD'in "Plot" penceresinin mobil karşılığı.
 *
 * Dört yeni karar kullanıcıya bırakılır: (1) basılacak ALAN (ekran / çizim sınırları /
 * ekrandan pencereyle seçilen dikdörtgen), (2) KÂĞIT ölçüsü — ISO A ve B, ANSI, ARCH ya da
 * elle yazılan ÖZEL ölçü, (3) kenar boşluğu, (4) ÇIKTI BİÇİMİ: vektör mü raster mı.
 * Vektör çıktı katman taşır (bkz. pdfvec.js), raster çıktı eski davranıştır.
 */
const pdfAyar = { paper: 'A3', wmm: 420, hmm: 297, orient: 'l', area: 'view', scale: '', dpi: 150,
  margin: 10, mode: 'vektor', renk: 'nesne', ctb: {}, frame: true, lw: true, all: false };
/*
 * KÂĞIDIN RENK KARARI. Dört seçenek AutoCAD'in çizici ayarlarının karşılığıdır:
 *   nesne — nesne renkleri (çizim stili yok)
 *   gri   — gri tonlama (AutoCAD'in "Grayscale" kutusu): her renk kendi parlaklığına iner
 *   mono  — tümü siyah (monochrome.ctb)
 *   tablo — RENGE GÖRE çıktı rengi (renge bağlı çizim stili tablosu, .ctb): hangi rengin
 *           hangi renkle basılacağını kullanıcı seçer; seçilmeyen renk nesne rengiyle basılır
 * Eşlemenin kendisi render.js'tedir (plotRgb) — vektör, raster ve önizleme aynı işlevi kullanır,
 * böylece kâğıt ile önizleme ayrışamaz.
 */
const pdfPlan = (o) => (o.renk === 'gri' ? { mod: 'gri' } : o.renk === 'tablo' ? { mod: 'tablo', tablo: o.ctb || {} } : null);

/*
 * KUTUNUN GÖRSELLEŞTİRİLMESİ (v7.99).
 *
 * PDF kutusu bir form listesiydi: kâğıt adı, iki sayı, "Pencere" yazan bir açılır liste.
 * Kullanıcı Oluştur'a basmadan ne alacağını göremiyordu — kâğıt yatay mı duruyor, seçilen
 * alan kâğıda nasıl oturuyor, künye nereye geliyor, ölçek kaç çıkıyor. Üçü eklendi:
 *   1. CANLI SAYFA ÖNİZLEMESİ — gerçek kâğıt oranında bir pafta; içinde kenar boşluğu,
 *      künye bandı ve BASILACAK ALANIN KENDİ küçük resmi (renderRegion ile, PNG çıktısıyla
 *      aynı çizici). Her ayar değişiminde yenilenir, altında ölçü ve 1:N ölçeği yazar.
 *   2. KÂĞIT SEÇİCİ — açılır listenin yanındaki küçük düğme, kâğıtları ORANLARIYLA kart kart
 *      gösterir (A3 dikdörtgeni gerçekten A3 oranındadır); "Özel ölçü" de listededir.
 *   3. PENCERE DÜĞMESİ SİMGELİ — hangi düğmenin alan seçtirdiği yazıya değil şekle bakarak
 *      anlaşılır.
 * Önizleme ağır bir işe dönüşmesin diye 220 ms geciktirilir ve tek kare ile sınırlanır.
 */
let pdfOnizZaman = 0;
/** Kâğıt kartı: dikdörtgen gerçek en/boy oranındadır (44 px kutuya oturtulmuş) */
function pdfKagitSvg(w, h) {
  const k = 38 / Math.max(w, h), a = Math.max(6, w * k), b = Math.max(6, h * k);
  return `<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="${((44 - a) / 2).toFixed(1)}" y="${((44 - b) / 2).toFixed(1)}" width="${a.toFixed(1)}" height="${b.toFixed(1)}" rx="1.5" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.6"/></svg>`;
}
/** Kâğıt seçici: kartlı, oranlı liste (askForm 'grid') */
async function pdfKagitSec() {
  pdfAyarOku();
  const yon = pdfYon({ ...pdfAyar, win: pdfWin }, !!pdfAyar.all);
  const kart = (w, h) => pdfKagitSvg(yon === 'l' ? Math.max(w, h) : Math.min(w, h), yon === 'l' ? Math.min(w, h) : Math.max(w, h));
  const secenek = Object.keys(PAPERS).map(k => [k, `${k} · ${PAPERS[k][0]}×${PAPERS[k][1]}`, kart(PAPERS[k][0], PAPERS[k][1])]);
  secenek.push(['ozel', t('pdfCustom'), `<svg viewBox="0 0 44 44" aria-hidden="true"><rect x="4" y="9" width="36" height="26" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2.4"/></svg>`]);
  const r = await askForm(t('paper'), [{ id: 'p', label: t('paper'), type: 'grid', value: pdfAyar.paper, options: secenek }], { ok: t('ok') });
  if (!r || !r.p) { showPdf(); return; }
  pdfAyar.paper = r.p;
  showPdf();
}
/** Canlı önizleme: kâğıt, kenar boşluğu, künye ve basılacak alanın küçük resmi */
function pdfOnizle() { clearTimeout(pdfOnizZaman); pdfOnizZaman = setTimeout(pdfOnizCiz, 220); }
/*
 * 3B GÖRÜNÜŞÜN KÂĞIT GÖRÜNTÜSÜ. Üç boyutlu bir görünüş vektöre çevrilemez — ekranda görünen şey
 * derinlik sıralı, aydınlatılmış bir RESİMDİR; onu yollara indirmek gölgeyi, gizli çizgiyi ve
 * kesişimi kaybettirir. Bu yüzden 3B sayfası her zaman rasterdir ve kaynağı WebGL tuvalinin
 * kendisidir (preserveDrawingBuffer ile okunabilir). screenshot() sadeleştirme sayaçlarını
 * sıfırlar, yani kâğıda giden resim ekrandakinden eksik olamaz.
 */
function ucBoyutGorsel({ taze = true } = {}) {
  if (!editor.is3D()) return null;
  const v = edCall('view3d');
  if (!v || typeof v.screenshot !== 'function') return null;
  /*
   * ÖNİZLEME KAMERAYI KIPIRDATMAZ. screenshot() tazeler, tazeleme de gerekirse tuvali yeniden
   * boyutlandırır ve kamera uzaklığını en-boy oranına taşır — küçük bir önizleme için bu bedel
   * ödenmez, üstelik kullanıcının seçtiği pencere ile o pencereyi kuran ışınlar ayrışır.
   * preserveDrawingBuffer açık olduğundan son kare tuvalde durur; önizleme onu okur.
   */
  try {
    if (taze) return v.screenshot({ raw: true });
    const c3 = v.cv; if (!c3 || !c3.width || !c3.height) return null;
    const out = document.createElement('canvas'); out.width = c3.width; out.height = c3.height;
    out.getContext('2d').drawImage(c3, 0, 0);
    return out;
  } catch (e) { console.warn(e); return null; }
}
/** 3B sayfasının künye satırı: ölçek yerine BAKIŞ yazılır (yaw / pitch / izdüşüm / stil) */
function ucBoyutBilgi() {
  const v = edCall('view3d'); if (!v) return '';
  const d = (r) => fmt(r * 180 / Math.PI, 0);
  return [`${t('hudYaw')} ${d(v.cam.yaw)}°`, `${t('hudPitch')} ${d(v.cam.pitch)}°`,
    v.cam.persp ? t('hudPersp') : t('hudOrtho'), `Z×${fmt(v.zScale, 2)}`].join('   ·   ');
}
function pdfOnizCiz() {
  const cv = $('pPrev'); if (!cv || !cv.isConnected) return;
  pdfAyarOku();
  const o = { ...pdfAyar, win: pdfWin };
  const [wmm, hmm] = pdfSayfaMm(o, !!o.all);
  const kw = Math.max(80, Math.round(cv.clientWidth || 260)), kh = Math.max(60, Math.round(cv.clientHeight || 150));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(kw * dpr); cv.height = Math.round(kh * dpr);
  const c = cv.getContext('2d'); if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, kw, kh);
  if (!(wmm > 0 && hmm > 0)) return;
  const pad = 8, k = Math.min((kw - 2 * pad) / wmm, (kh - 2 * pad) / hmm);
  const pw = wmm * k, ph = hmm * k, px = Math.round((kw - pw) / 2), py = Math.round((kh - ph) / 2);
  c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(px + 3, py + 3, pw, ph);
  c.fillStyle = '#fff'; c.fillRect(px, py, pw, ph);
  const kenar = Math.max(0, Math.min(Math.min(wmm, hmm) / 3, Number(o.margin) || 0)) * k;
  const kunye = (o.frame === false ? 0 : 18) * k;
  const aw = pw - 2 * kenar, ah = ph - 2 * kenar - kunye;
  let olcek = 0;
  if (aw > 3 && ah > 3 && o.area === '3d') {
    // 3B sayfası: tuvalin görüntüsü oranı korunarak çizim alanına oturur
    const g3 = ucBoyutGorsel({ taze: false });
    if (g3 && g3.width && g3.height) {
      const kk = Math.min(aw / g3.width, ah / g3.height), dw = g3.width * kk, dh = g3.height * kk;
      c.drawImage(g3, px + kenar + (aw - dw) / 2, py + kenar + (ah - dh) / 2, dw, dh);
    }
    c.strokeStyle = '#9aa3ad'; c.lineWidth = 1;
    if (kenar > 0.5) { c.setLineDash([3, 3]); c.strokeRect(px + kenar, py + kenar, aw, ah + kunye); c.setLineDash([]); }
    if (kunye > 1.5) { c.strokeStyle = '#555'; c.strokeRect(px + kenar, py + kenar + ah, aw, kunye); }
  } else if (aw > 3 && ah > 3) {
    const alan = pdfAlani(o, !!o.all, Math.max(1, aw / k), Math.max(1, ah / k));
    olcek = alan.sayfaOlcek || 0;
    const kip = { mode: S.colorMode, mono: S.monoColor, plot: S.plot };
    S.colorMode = o.renk === 'mono' ? 'mono' : 'entity'; S.monoColor = 'fg'; S.plot = pdfPlan(o);
    try {
      const img = renderRegion(alan.bb, Math.max(8, Math.round(aw * dpr)), Math.max(8, Math.round(ah * dpr)), { light: true });
      c.drawImage(img, px + kenar, py + kenar, aw, ah);
    } catch (_) { /* önizleme çizilemedi: kâğıt yine görünür */ }
    finally { S.colorMode = kip.mode; S.monoColor = kip.mono; S.plot = kip.plot; }
    c.strokeStyle = '#9aa3ad'; c.lineWidth = 1;
    if (kenar > 0.5) { c.setLineDash([3, 3]); c.strokeRect(px + kenar, py + kenar, aw, ah + kunye); c.setLineDash([]); }
    if (kunye > 1.5) { c.strokeStyle = '#555'; c.strokeRect(px + kenar, py + kenar + ah, aw, kunye); }
  }
  c.strokeStyle = '#666'; c.lineWidth = 1; c.strokeRect(px + 0.5, py + 0.5, pw, ph);
  const bilgi = $('pPrevInfo');
  if (bilgi) {
    const yon = pdfYon(o, !!o.all) === 'l' ? t('landscape') : t('portrait');
    bilgi.textContent = `${fmt(wmm)} × ${fmt(hmm)} mm · ${yon}` + (olcek > 0 ? ` · 1:${fmt(olcek)}` : '');
  }
}
/*
 * RENK TABLOSU DÜZENLEYİCİSİ — AutoCAD'in çizim stili (.ctb) kutusunun karşılığı.
 *
 * AutoCAD 255 ACI rengini listeler; telefonda bu liste kullanılamaz. Bunun yerine ÇİZİMDE
 * GERÇEKTEN KULLANILAN renkler, çok kullanılandan aza doğru listelenir (en çok 64 satır): her
 * satırda rengin kendisi, ACI numarası, kaç nesnede geçtiği ve basılacak renk vardır. Tabloda
 * karşılığı olmayan renk AutoCAD'deki gibi kendi rengiyle basılır ("Use object color").
 */
function pdfKullanilanRenkler() {
  const say = new Map();
  for (const p of S.prims) {
    if (!p || p.k === 4 || p.bg) continue;
    if (!primVisible(p)) continue;                       // gizli / dondurulmuş nesne kâğıda gitmez
    const k = plotKey(p.col);
    const r = say.get(k);
    if (r) r.n++; else say.set(k, { key: k, col: p.col === FG ? 0 : (p.col & 0xffffff), n: 1 });
  }
  return [...say.values()].sort((a, b) => b.n - a.n).slice(0, 64);
}
function pdfCtbDuzenle() {
  const liste = pdfKullanilanRenkler();
  const hx = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
  const satir = (r) => {
    const kaynak = hx(r.col), hedef = pdfAyar.ctb[r.key] || kaynak;
    const ad = /^#/.test(r.key) ? t('pdfCtbTrue') : `${t('pdfCtbAci')} ${r.key}`;
    return [`<div class="full ctb-row"><i class="sw" style="background:${esc(kaynak)}"></i><b>${esc(ad)}</b><small class="muted">${r.n}</small><span class="ar">→</span><input type="color" data-ctb="${esc(r.key)}" value="${esc(hedef)}" aria-label="${esc(ad)}"></div>`];
  };
  const html = kv([
    [`<div class="full muted">${esc(t('pdfCtbHint'))}</div>`],
    ...(liste.length ? liste.map(satir) : [[`<div class="full muted">${esc(t('noObject'))}</div>`]]),
    [`<div class="full btns"><button type="button" class="btn small" data-ctba="siyah">${esc(t('pdfCtbAllBlack'))}</button><button type="button" class="btn small" data-ctba="gri">${esc(t('pdfCtbGray'))}</button><button type="button" class="btn small" data-ctba="sifirla">${esc(t('pdfCtbReset'))}</button><button type="button" class="btn primary small" data-ctba="bitti">${esc(t('ok'))}</button></div>`],
  ]);
  openDoc(t('pdfCtbTitle'), html);
  const yaz = () => { for (const el of document.querySelectorAll('#docBody [data-ctb]')) pdfAyar.ctb[el.dataset.ctb] = el.value; };
  $('docBody').oninput = (ev) => { const el = ev.target.closest('[data-ctb]'); if (el) pdfAyar.ctb[el.dataset.ctb] = el.value; };
  $('docBody').onclick = (ev) => {
    const b = ev.target.closest('[data-ctba]'); if (!b) return;
    const a = b.dataset.ctba;
    if (a === 'bitti') { yaz(); $('docBody').oninput = null; pdfAyar.renk = 'tablo'; showPdf(); return; }
    for (const el of document.querySelectorAll('#docBody [data-ctb]')) {
      if (a === 'sifirla') { const r = liste.find(x => x.key === el.dataset.ctb); el.value = hx(r ? r.col : 0); delete pdfAyar.ctb[el.dataset.ctb]; continue; }
      const kay = parseInt(el.value.replace('#', ''), 16) || 0;
      el.value = a === 'siyah' ? '#000000' : hx(plotRgb(kay, { mod: 'gri' }));
      pdfAyar.ctb[el.dataset.ctb] = el.value;
    }
    haptic('toggle');
  };
}
function showPdf() {
  const multi = !!(S.scene && S.scene.layouts.length > 1);
  const kagitSecenek = PAPER_GRUP.map(([g, ks]) => `<optgroup label="${g}">`
    + ks.map(k => `<option value="${esc(k)}"${k === pdfAyar.paper ? ' selected' : ''}>${esc(k)} · ${PAPERS[k][0]}×${PAPERS[k][1]}</option>`).join('')
    + `</optgroup>`).join('')
    + `<option value="ozel"${pdfAyar.paper === 'ozel' ? ' selected' : ''}>${esc(t('pdfCustom'))}</option>`;
  /*
   * BASILACAK ALAN. 3B görünümdeyken listeye "3B görünüş" eklenir ve ÖNTANIMLI olur: kullanıcı
   * üç boyutlu modele bakarken PDF'e bastığında gördüğü şeyi bekler, paftanın planını değil.
   * 3B seçili değilken bu değer listede yoktur; eski bir ayardan geliyorsa ekran görünümüne düşer.
   */
  const ucBoyut = editor.is3D();
  // Kullanıcı 3B'de PENCERE seçtiyse o seçim korunur; yoksa 3B görünüş öntanımlıdır
  if (ucBoyut && !(pdfAyar.area === 'win' && pdfWin)) pdfAyar.area = '3d';
  else if (pdfAyar.area === '3d') pdfAyar.area = 'view';
  const alanSecenek = [...(ucBoyut ? [['3d', tt('pdfArea3d', '3B görünüş (resim)')]] : []), ['view', t('pdfAreaView')], ['ext', t('pdfAreaExt')], ['win', t('pdfAreaWin')]]
    .map(([v, l]) => `<option value="${v}"${v === pdfAyar.area ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const html = kv([
    [`<div class="full pdf-prev"><canvas id="pPrev" role="img" aria-label="${esc(tt('pdfPreview', 'Sayfa önizlemesi'))}"></canvas><div id="pPrevInfo" class="muted"></div></div>`],
    [t('title'), `<input id="pTitle" value="${esc(pdfAyar.title || baseName())}">`, 1],
    [t('paper'), `<span class="pair"><select id="pPaper">${kagitSecenek}</select><button type="button" class="btn icon" id="pPaperPick" title="${esc(tt('pdfPaperPick', 'Kâğıtları göster'))}" aria-label="${esc(tt('pdfPaperPick', 'Kâğıtları göster'))}"><svg class="ic" aria-hidden="true"><use href="#i-layout"/></svg></button></span>`, 1],
    [t('pdfCustomSize'), `<span class="pair"><input id="pW" type="number" min="10" max="5000" step="1" value="${pdfAyar.wmm}"> × <input id="pH" type="number" min="10" max="5000" step="1" value="${pdfAyar.hmm}"> mm</span>`, 1, 'ozel'],
    [t('orient'), `<span class="pair"><select id="pOrient">${[['auto', t('orientAuto')], ['l', t('landscape')], ['p', t('portrait')]].map(([v, l]) => `<option value="${v}"${v === pdfAyar.orient ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select> <small id="pSize" class="muted"></small></span>`, 1, 'yon'],
    [t('pdfArea'), `<select id="pArea">${alanSecenek}</select>`, 1],
    ['', `<span class="pair"><button class="btn small" id="pPick"><svg class="ic" aria-hidden="true"><use href="#i-zoom-window"/></svg> ${esc(t('pdfPickWin'))}</button> <small id="pWinInfo" class="muted">${esc(pdfWinMetni())}</small></span>`, 1, 'win'],
    [t('pdfScale'), `<input id="pScale" type="number" min="1" step="1" placeholder="${esc(t('pdfFit'))}" value="${esc(pdfAyar.scale)}">`, 1, 'olcek'],
    [t('pdfMargin'), `<input id="pMargin" type="number" min="0" max="60" step="1" value="${pdfAyar.margin}">`, 1],
    [t('pdfMode'), `<select id="pMode"><option value="vektor"${pdfAyar.mode === 'vektor' ? ' selected' : ''}>${esc(t('pdfModeVector'))}</option><option value="raster"${pdfAyar.mode === 'raster' ? ' selected' : ''}>${esc(t('pdfModeRaster'))}</option></select>`, 1],
    [t('pdfColor'), `<span class="pair"><select id="pColor">${[['nesne', t('pdfColorObj')], ['gri', t('pdfColorGray')], ['mono', t('pdfColorMono')], ['tablo', t('pdfColorTable')]].map(([v, l]) => `<option value="${v}"${v === pdfAyar.renk ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select><button type="button" class="btn icon" id="pCtb" title="${esc(t('pdfCtbTitle'))}" aria-label="${esc(t('pdfCtbTitle'))}"><svg class="ic" aria-hidden="true"><use href="#i-palette"/></svg></button></span>`, 1],
    [t('dpi'), `<select id="pDpi">${[100, 150, 200, 300, 400].map(v => `<option${v === pdfAyar.dpi ? ' selected' : ''}>${v}</option>`).join('')}</select>`, 1, 'dpi'],
    ['', `<label class="chk"><input type="checkbox" id="pFrame"${pdfAyar.frame ? ' checked' : ''}> ${esc(t('pdfFrame'))}</label>`, 1],
    ['', `<label class="chk"><input type="checkbox" id="pLw"${pdfAyar.lw ? ' checked' : ''}> ${esc(t('pdfLw'))}</label>`, 1],
    ...(multi ? [['', `<label class="chk"><input type="checkbox" id="pAll"${pdfAyar.all ? ' checked' : ''}> ${esc(t('pdfAllLayouts'))}</label>`, 1]] : []),
    [`<div class="full muted" id="pNot">${esc(t('pdfHintVector'))}</div>`],
    [`<div class="full btns"><button class="btn primary small" id="pGo">${t('create')}</button></div>`]]);
  openDoc(t('pdfTitle'), html);
  const satir = (ad, ac) => document.querySelectorAll(`#docBody [data-row="${ad}"]`).forEach(e => { e.hidden = !ac; });
  /*
   * Kutunun canlı yanı. Yön satırı ARTIK HER KÂĞITTA görünür (eskiden özel ölçüde gizlenirdi):
   * özel ölçüde de yön anlamlıdır, yalnız orada iki sayının SIRASI yönü belirler. Bu yüzden
   * kullanıcı yön seçtiğinde sayılar ona göre sıralanır, sayıları değiştirdiğinde de seçim
   * onlara uyar — kutuda görünen ölçü ile kâğıda giden ölçü hiçbir durumda ayrışmaz.
   */
  const sayfaYaz = () => { const el = $('pSize'); if (!el) return; pdfAyarOku(); const [w, h] = pdfSayfaMm(pdfAyar, pdfAyar.all); el.textContent = `${fmt(w)} × ${fmt(h)} mm`; pdfOnizle(); };   // kutu kapandıysa (kâğıt seçici) sessizce çık
  const tazele = () => {
    const ozel = $('pPaper').value === 'ozel';
    const u3 = $('pArea').value === '3d';
    // 3B sayfası vektöre çevrilemez: biçim rastere sabitlenir, 1:N ölçeği ve pencere satırı kalkar
    if (u3 && $('pMode').value !== 'raster') $('pMode').value = 'raster';
    $('pMode').disabled = u3;
    satir('ozel', ozel);
    satir('dpi', $('pMode').value === 'raster');
    satir('win', !u3 && $('pArea').value === 'win');
    satir('olcek', !u3);
    $('pNot').textContent = u3 ? tt('pdfHint3d', '3B görünüş kâğıda resim olarak basılır: ekranda görünen bakış, aydınlatma ve gizli çizgi olduğu gibi gider. Ölçek verilemez; künyeye bakış açıları yazılır.') : ($('pMode').value === 'vektor' ? t('pdfHintVector') : t('pdfHintRaster'));
    const ctb = $('pCtb'); if (ctb) ctb.hidden = $('pColor').value !== 'tablo';   // renk tablosu yalnız kendi kipinde düzenlenir
    sayfaYaz();
  };
  /** Özel ölçüde yazılan iki sayıyı seçilen yöne göre sıralar (Otomatik'te sayılara dokunulmaz) */
  const ozelSirala = () => {
    if ($('pPaper').value !== 'ozel') return;
    const yon = $('pOrient').value; if (yon !== 'l' && yon !== 'p') return;
    const w = Number($('pW').value) || 0, h = Number($('pH').value) || 0;
    if (yon === 'l' ? h > w : w > h) { $('pW').value = String(h); $('pH').value = String(w); }
  };
  /** Özel ölçüde sayılar değişince yön seçimi onlara uyar: yazılan ölçü her zaman geçerlidir */
  const yonuSayidanAl = () => {
    if ($('pPaper').value !== 'ozel' || $('pOrient').value === 'auto') return;
    const w = Number($('pW').value) || 0, h = Number($('pH').value) || 0;
    if (w && h) $('pOrient').value = w >= h ? 'l' : 'p';
  };
  $('pPaper').onchange = () => { yonuSayidanAl(); tazele(); };
  $('pMode').onchange = tazele; $('pArea').onchange = tazele;
  $('pOrient').onchange = () => { ozelSirala(); tazele(); };
  $('pW').oninput = $('pH').oninput = () => { yonuSayidanAl(); tazele(); };
  // Önizlemeyi etkileyen öteki alanlar: ölçek, kenar boşluğu, renk, çerçeve, başlık
  for (const id of ['pScale', 'pMargin', 'pTitle']) { const el = $(id); if (el) el.oninput = sayfaYaz; }
  for (const id of ['pFrame', 'pLw', 'pAll']) { const el = $(id); if (el) el.onchange = sayfaYaz; }
  $('pColor').onchange = tazele;   // renk kipi tablo düğmesinin görünürlüğünü de değiştirir
  $('pPaperPick').onclick = () => { void pdfKagitSec(); };
  $('pCtb').onclick = () => { pdfAyarOku(); pdfCtbDuzenle(); };
  yonuSayidanAl();
  tazele();
  $('pPick').onclick = () => {
    pdfAyarOku();
    hide('docPanel');
    const basladi = alanSec((bb) => { pdfWin = bb; pdfAyar.area = 'win'; showPdf(); },
      { ipucu: t('pdfPickHint'), iptal: () => showPdf() });
    if (!basladi) showPdf();   // seçim başlamadıysa (3B görünüm, çalışan araç) kutu geri gelir
  };
  $('pGo').onclick = () => {
    pdfAyarOku();
    if (pdfAyar.area === 'win' && !pdfWin) { toast(t('pdfNoWin'), { type: 'warn' }); return; }
    if (pdfAyar.area === '3d' && !editor.is3D()) { toast(t('pdfFail'), { type: 'error' }); return; }
    makePdf({ ...pdfAyar, win: pdfWin, vector: pdfAyar.mode === 'vektor' });
  };
}
/** Kutudaki değerleri pdfAyar'a alır (pencere seçmeye gidip dönerken kaybolmasınlar) */
function pdfAyarOku() {
  if (!$('pPaper')) return;
  pdfAyar.title = $('pTitle').value;
  pdfAyar.paper = $('pPaper').value;
  pdfAyar.wmm = Math.max(10, Math.min(5000, Number($('pW').value) || 420));
  pdfAyar.hmm = Math.max(10, Math.min(5000, Number($('pH').value) || 297));
  pdfAyar.orient = $('pOrient').value;
  pdfAyar.area = $('pArea').value;
  pdfAyar.scale = $('pScale').value;
  pdfAyar.margin = Math.max(0, Math.min(60, Number($('pMargin').value) || 0));
  pdfAyar.mode = $('pMode').value;
  pdfAyar.renk = $('pColor').value;
  pdfAyar.dpi = Number($('pDpi').value) || 150;
  pdfAyar.frame = $('pFrame').checked;
  pdfAyar.lw = $('pLw').checked;
  pdfAyar.all = !!($('pAll') && $('pAll').checked);
}
const pdfWinMetni = () => (pdfWin ? `${fmt(pdfWin[2] - pdfWin[0])} × ${fmt(pdfWin[3] - pdfWin[1])}` : t('pdfNoWinYet'));

/**
 * Basılacak dünya dikdörtgenini bulur. Kaynak: seçilen pencere, çizim sınırları ya da ekran;
 * çok düzenli kipte her düzenin kendi sınırları. Ölçek verilmişse kâğıdın o ölçekteki dünya
 * karşılığı kaynağın MERKEZİNE oturtulur, verilmemişse kaynak kâğıdın oranına genişletilir.
 */
function pdfKaynakDik(o, all) {
  let vr;
  // 3B görünüş bir RESİMDİR: otomatik yön kararını veren oran, dünya dikdörtgeni değil tuvalin oranıdır
  if (!all && o.area === '3d') { const v = edCall('view3d'); if (v && v.cv && v.cv.width > 0 && v.cv.height > 0) return [0, 0, v.cv.width, v.cv.height]; }
  if (all) vr = (S.ext || visibleRect()).slice();
  else if (o.area === 'win' && o.win) vr = o.win.slice();
  else if (o.area === 'ext') vr = (S.ext || visibleRect()).slice();
  else vr = visibleRect();
  if (!(isFinite(vr[0]) && vr[2] > vr[0] && vr[3] > vr[1])) vr = visibleRect();
  return vr;
}
/*
 * SAYFA YÖNÜ. Kâğıt ölçüleri PAPERS'ta DİKEY yazılıdır (A3 = 297 × 420); yön onları çevirir.
 * 'auto' seçilirse kararı basılacak alanın kendi oranı verir — geniş çizim yatay, uzun çizim
 * dikey kâğıda gider, kullanıcı her seferinde düşünmek zorunda kalmaz. Özel ölçüde de aynı
 * kural işler: yazılan iki sayı yöne göre sıralanır, böylece kutuda görünen ile kâğıda giden
 * ayrışmaz. Çok düzenli çıktıda (bütün sayfa düzenleri) yön belge boyunca tektir ve o anki
 * düzenin alanına göre seçilir; sayfa başına ayrı yön kâğıt ölçüsünü de sayfa başına
 * değiştirirdi, bu da tek kâğıt bekleyen çizicide sorun olur.
 */
function pdfYon(o, all) {
  if (o.orient === 'l' || o.orient === 'p') return o.orient;
  const vr = pdfKaynakDik(o, all);
  return (vr[2] - vr[0]) >= (vr[3] - vr[1]) ? 'l' : 'p';
}
/** Kâğıdın milimetre ölçüsü, yönü uygulanmış olarak: [genişlik, yükseklik] */
function pdfSayfaMm(o, all) {
  let w, h;
  if (o.paper === 'ozel') { w = Number(o.wmm) || 0; h = Number(o.hmm) || 0; }
  else [w, h] = PAPERS[o.paper] || PAPERS.A3;
  if (pdfYon(o, all) === 'l' ? h > w : w > h) { const q = w; w = h; h = q; }
  return [w, h];
}
function pdfAlani(o, all, cizimGmm, cizimYmm) {
  let vr = pdfKaynakDik(o, all);
  const cx = (vr[0] + vr[2]) / 2, cy = (vr[1] + vr[3]) / 2;
  const olcek = Number(o.scale) || 0;
  if (!all && olcek > 0 && S.unitToM) {
    const ww = (cizimGmm / 1000) * olcek / S.unitToM, hh = (cizimYmm / 1000) * olcek / S.unitToM;
    return { bb: [cx - ww / 2, cy - hh / 2, cx + ww / 2, cy + hh / 2], sayfaOlcek: olcek };
  }
  if (all || o.area === 'ext') { const m = Math.max(vr[2] - vr[0], vr[3] - vr[1]) * 0.03 || 1; vr = [vr[0] - m, vr[1] - m, vr[2] + m, vr[3] + m]; }
  const ar = cizimGmm / cizimYmm, vw = Math.max(vr[2] - vr[0], 1e-9), vh = Math.max(vr[3] - vr[1], 1e-9);
  const c2x = (vr[0] + vr[2]) / 2, c2y = (vr[1] + vr[3]) / 2;
  let bb;
  if (vw / vh > ar) { const nh = vw / ar; bb = [vr[0], c2y - nh / 2, vr[2], c2y + nh / 2]; }
  else { const nw = vh * ar; bb = [c2x - nw / 2, vr[1], c2x + nw / 2, vr[3]]; }
  return { bb, sayfaOlcek: S.unitToM ? Math.round(((bb[2] - bb[0]) * S.unitToM * 1000) / cizimGmm) : 0 };
}

/**
 * PDF oluşturur.
 *
 * İKİ ÇIKTI BİÇİMİ vardır ve ikisi de aynı alan / kâğıt / ölçek hesabını kullanır:
 *  · VEKTÖR (öntanımlı): sahne ilkelleri doğrudan PDF yollarına çevrilir. Sonsuz büyütülebilir,
 *    yazı seçilebilir ve aranabilir, ÇİZİM KATMANLARI PDF'in içinde katman (OCG) olarak durur —
 *    okuyucu katmanı açıp kapatabilir. Çizgi kalınlığı kâğıtta gerçekten yazıldığı kadardır.
 *  · RASTER: sayfa JPEG olarak gömülür (eski davranış). Ekranda ne görünüyorsa o basılır;
 *    PDF yazı tipinde bulunmayan alfabeler (Kiril, Yunan, CJK) için doğru seçenek budur.
 *
 * all verilirse belgedeki BÜTÜN düzenler ayrı sayfalar olarak tek dosyaya yazılır; her sayfa
 * kendi sınırlarına sığdırılır ve kendi ölçeğini taşır (farklı büyüklükteki düzenlere tek ölçek
 * dayatılamaz).
 */
async function makePdf(o) {
  const vec = o.vector !== false && o.area !== '3d';   // 3B görünüş resimdir: vektör belgesi kurulmaz
  const kagitAdi = o.paper === 'ozel' ? `${o.wmm}×${o.hmm} mm` : o.paper;
  setLoading(t('pdfTitle'), kagitAdi, undefined, 'out');
  await new Promise(r => setTimeout(r, 30));
  const keep = { li: S.layoutIndex, prims: S.prims, tree: S.tree, ext: S.ext, sel: S.selected };
  try {
    const [wmm, hmm] = pdfSayfaMm(o, !!o.all);
    if (!(wmm > 0 && hmm > 0)) { toast(t('pdfFail'), { type: 'error' }); return; }
    const dpi = Number(o.dpi) || 150, pxPerMm = dpi / 25.4;
    const kenarMm = Math.max(0, Math.min(Math.min(wmm, hmm) / 3, o.margin == null ? 10 : Number(o.margin)));
    const kunyeMm = o.frame === false ? 0 : 18;
    const cizimGmm = wmm - 2 * kenarMm, cizimYmm = hmm - 2 * kenarMm - kunyeMm;
    if (!(cizimGmm > 5 && cizimYmm > 5)) { toast(t('pdfTooSmall'), { type: 'error' }); return; }
    const layouts = S.scene.layouts;
    const all = !!o.all;
    const idxs = all ? layouts.map((_, i) => i).filter(i => layouts[i].prims.length && layouts[i].ext && isFinite(layouts[i].ext[0])) : [S.layoutIndex];
    if (!idxs.length) { toast(t('pdfFail'), { type: 'error' }); return; }
    if (all) S.selected = null;

    const belge = vec ? pdfBelge({ baslik: o.title || baseName() }) : null;
    const pages = [];
    let basilan = 0;
    for (const li of idxs) {
      if (all) {
        const L = layouts[li];
        S.layoutIndex = li; S.prims = L.prims; S.ext = L.ext;
        S.tree = L.isModel ? S.modelTree : (L.tree || (L.tree = new RTree(L.prims, q => q.bb)));
        setLoading(t('pdfTitle'), `${L.name} (${pages.length + 1}/${idxs.length})`, 100 * pages.length / idxs.length);
        await new Promise(r => setTimeout(r, 0));
      }
      const uc3 = o.area === '3d';
      const gorsel = uc3 ? ucBoyutGorsel() : null;
      if (uc3 && !gorsel) { toast(t('pdfFail'), { type: 'error' }); return; }
      const { bb, sayfaOlcek } = uc3 ? { bb: S.ext || visibleRect(), sayfaOlcek: 0 } : pdfAlani(o, all, cizimGmm, cizimYmm);
      const bilgi = [`${t('file')}: ${S.fileName}`, uc3 ? tt('pdfArea3d', '3B görünüş (resim)') : layouts[S.layoutIndex].name, idxs.length > 1 ? `${pages.length + 1} / ${idxs.length}` : '',
        uc3 ? ucBoyutBilgi() : (sayfaOlcek ? `${t('pdfScale')}${sayfaOlcek}` : ''), S.units ? `${t('drawingUnit')}: ${S.units}` : '',
        S.geo.active ? S.geo.crs.name : '', new Date().toLocaleString('tr-TR')].filter(Boolean).join('   ·   ');
      if (uc3) { pages.push(rasterSayfa({ wmm, hmm, kenarMm, kunyeMm, cizimGmm, cizimYmm, bb, sayfaOlcek: 0, bilgi, pxPerMm, o, gorsel })); }
      else if (vec) {
        basilan += vektorSayfa(belge, { wmm, hmm, kenarMm, kunyeMm, cizimGmm, cizimYmm, bb, sayfaOlcek, bilgi, o });
        pages.push(1);
      } else {
        pages.push(rasterSayfa({ wmm, hmm, kenarMm, kunyeMm, cizimGmm, cizimYmm, bb, sayfaOlcek, bilgi, pxPerMm, o }));
      }
    }
    const pdf = vec ? await belge.bitir() : buildPdf(pages, wmm, hmm, o.title || baseName());
    const name = baseName() + '_' + stamp() + '.pdf';
    const driveAct = Drive.signedIn() && Ed.has('driveUpload') ? { label: tt('driveUpload', "Drive'a yükle"), fn: () => Drive.uploadWithPicker({ b64: pdf, name, mime: 'application/pdf' }) } : undefined;
    let done = t('pdfDone') + (pages.length > 1 ? ` (${pages.length} ${t('pagesN')})` : '');
    if (vec) done += ` · ${t('pdfLayersN')}: ${belge.katmanSayisi}`;
    if (A() && A().saveFile) { const r = A().saveFile(pdf, name, 'application/pdf', true); toast(r ? done + ': ' + r : t('pdfFail'), { type: r ? 'ok' : 'error', ms: 6000, action: r ? driveAct : undefined }); }
    else { const a = document.createElement('a'); a.href = 'data:application/pdf;base64,' + pdf; a.download = name; a.click(); toast(done, { type: 'ok', action: driveAct }); }
    // PDF yazı tipinde karşılığı olmayan harf kaldıysa sessiz geçilmez: raster kipi onları olduğu gibi basar
    if (vec && belge.eksikHarf > 0) setTimeout(() => toast(`${t('pdfGlyphMiss')} (${belge.eksikHarf}) · ${t('pdfGlyphHint')}`, { type: 'warn', ms: 9000 }), 1400);
    if (vec && !basilan) setTimeout(() => toast(t('pdfEmpty'), { type: 'warn', ms: 7000 }), 900);
    hide('docPanel');
  } catch (e) { fail(e); }
  finally {
    S.layoutIndex = keep.li; S.prims = keep.prims; S.tree = keep.tree; S.ext = keep.ext; S.selected = keep.sel;
    if (o.all) { S.cacheValid = false; requestRender(); }
    setLoading(null);
  }
}

/** Vektör sayfa: çizim alanı, kâğıt düzeninin görünüm pencereleri ve künye */
function vektorSayfa(belge, g) {
  const { wmm, hmm, kenarMm, kunyeMm, cizimGmm, cizimYmm, bb, sayfaOlcek, bilgi, o } = g;
  const sayfa = belge.sayfaEkle(wmm, hmm);
  const px = kenarMm * PT, py = (kenarMm + kunyeMm) * PT, pw = cizimGmm * PT, ph = cizimYmm * PT;
  const k = pw / Math.max(1e-12, bb[2] - bb[0]);
  const ortak = {
    layers: S.layers, ltypes: S.ltypes || {}, show: S.show, hideObj: S.hideObj, isoObj: S.isoObj,
    ltOn: S.show.ltype, lwOn: o.lw !== false, lwDefault: (S.scene.header && S.scene.header.LWDEFAULT) || 25,
    pointStyle: S.pointStyle, hatchAlpha: S.hatchAlpha, hatchBack: S.hatchBack !== false,
    /*
     * ÇIKTININ RENGİ EKRAN AYARINA BAĞLI DEĞİLDİR. Ekrandaki "katman paleti" / "tek renk" kipleri
     * bir GÖRÜNTÜLEME yardımıdır; AutoCAD'de de ekran ayarı çizicinin rengini belirlemez, çizim
     * stili (monochrome.ctb) belirler. Burada karar kullanıcıya kutudan sorulur.
     */
    renkOf: o.renk === 'mono' ? ((p) => (p.bg ? 0xffffff : 0))
      : (pdfPlan(o) ? ((p) => (p.bg ? 0xffffff : plotRgb(p.col, pdfPlan(o)))) : null),
    resimJpeg: pdfResim,
  };
  let n = 0;
  const L = S.scene.layouts[S.layoutIndex];
  // kâğıt düzeni: model uzayı önce görünüm pencerelerinin içine kırpılarak basılır (ekrandaki sırayla)
  if (L && !L.isModel && L.viewports && L.viewports.length) {
    const model = S.scene.layouts[0];
    for (const vp of L.viewports) {
      if (!vp.on || !(vp.scale > 0)) continue;
      const mcx = (vp.x0 + vp.x1) / 2, mcy = (vp.y0 + vp.y1) / 2, tw = vp.twist || 0;
      const cs = Math.cos(tw), sn = Math.sin(tw), sc = vp.scale;
      const don = (mx, my) => {
        const dx = mx - vp.cx, dy = my - vp.cy;
        return [px + (mcx + sc * (cs * dx - sn * dy) - bb[0]) * k, py + (mcy + sc * (sn * dx + cs * dy) - bb[1]) * k];
      };
      const cx0 = px + (vp.x0 - bb[0]) * k, cy0 = py + (vp.y0 - bb[1]) * k;
      const kx = Math.max(px, cx0), ky = Math.max(py, cy0);
      const kw = Math.min(px + pw, cx0 + (vp.x1 - vp.x0) * k) - kx, kh = Math.min(py + ph, cy0 + (vp.y1 - vp.y0) * k) - ky;
      if (!(kw > 0 && kh > 0)) continue;
      const hw = (vp.x1 - vp.x0) / 2 / sc, hh = (vp.y1 - vp.y0) / 2 / sc, rr = Math.hypot(hw, hh);
      const psLt = !(S.scene.header && S.scene.header.PSLTSCALE === 0);
      n += ilkelleriBas(sayfa, belge, { ...ortak, prims: model.prims,
        bb: tw ? [vp.cx - rr, vp.cy - rr, vp.cx + rr, vp.cy + rr] : [vp.cx - hw, vp.cy - hh, vp.cx + hw, vp.cy + hh],
        x: kx, y: ky, w: kw, h: kh,
        donusum: { don, k: k * sc, lin: [k * sc * cs, k * sc * sn, -k * sc * sn, k * sc * cs] },
        frozen: vp.frozen && vp.frozen.length ? new Set(vp.frozen) : null,
        ltK: psLt ? 1 / sc : 1 });
    }
  }
  n += ilkelleriBas(sayfa, belge, { ...ortak, prims: S.prims, bb, x: px, y: py, w: pw, h: ph });
  if (o.frame !== false) kunyeVektor(sayfa, belge, { wmm, hmm, kenarMm, kunyeMm, cizimGmm, cizimYmm, bb, sayfaOlcek, bilgi, baslik: o.title || baseName() });
  return n;
}

/** Çerçeve, künye bandı, kuzey oku ve ölçek çubuğu (hepsi vektör) */
function kunyeVektor(sayfa, belge, g) {
  const px = g.kenarMm * PT, py = (g.kenarMm + g.kunyeMm) * PT, pw = g.cizimGmm * PT, ph = g.cizimYmm * PT;
  const tb = g.kunyeMm * PT;
  PK.dikdortgen(sayfa, px, py, pw, ph, { kalin: 0.35 * PT });
  PK.dikdortgen(sayfa, px, py - tb, pw, tb, { kalin: 0.35 * PT });
  PK.yazi(sayfa, belge, px + 3 * PT, py - tb * 0.42, 4.5 * PT, g.baslik);
  PK.yazi(sayfa, belge, px + 3 * PT, py - tb * 0.78, 3 * PT, g.bilgi);
  const nx = px + pw - 8 * PT, ny = py - tb / 2;
  PK.kuzey(sayfa, belge, nx, ny, 4 * PT);
  if (g.sayfaOlcek && S.unitToM) {
    const dunyaPerPt = (g.bb[2] - g.bb[0]) / pw;
    const barM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(v => v / (dunyaPerPt * S.unitToM) > 25 * PT) || 1000;
    const boy = barM / (dunyaPerPt * S.unitToM);
    const bx = nx - 20 * PT - boy, by = py - tb * 0.72;
    PK.dikdortgen(sayfa, bx, by, boy / 2, 1.5 * PT, { doldur: true });
    PK.dikdortgen(sayfa, bx, by, boy, 1.5 * PT, { kalin: 0.3 * PT });
    PK.yazi(sayfa, belge, bx, by + 2.4 * PT, 2.5 * PT, '0');
    PK.yazi(sayfa, belge, bx + boy, by + 2.4 * PT, 2.5 * PT, barM + ' m', { hiza: 2 });
  }
}

/** Bir resim ilkelinin JPEG baytları (vektör PDF'e gömmek için) */
function pdfResim(p) {
  const im = S.images.get(p.img);
  if (!im || !im.ok || !im.img) return null;
  try {
    const w = Math.min(p.pw || im.img.naturalWidth || 0, 4096), h = Math.min(p.ph || im.img.naturalHeight || 0, 4096);
    if (!(w > 0 && h > 0)) return null;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.drawImage(im.img, 0, 0, w, h);
    const b64 = cv.toDataURL('image/jpeg', 0.9).split(',')[1];
    const bin = atob(b64), veri = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) veri[i] = bin.charCodeAt(i);
    return { veri, w, h };
  } catch (_) { return null; }   // kirlenmiş tuval (başka kökenden gelen resim)
}

/** Raster sayfa (eski yol): çizim ayrı tuvale çizilir, kâğıda yapıştırılır, JPEG olur */
function rasterSayfa(g) {
  const { wmm, hmm, kenarMm, kunyeMm, cizimGmm, cizimYmm, bb, sayfaOlcek, bilgi, pxPerMm, o, gorsel } = g;
  const W = Math.round(wmm * pxPerMm), H = Math.round(hmm * pxPerMm);
  const margin = kenarMm * pxPerMm, tb = kunyeMm * pxPerMm;
  const aw = Math.round(cizimGmm * pxPerMm), ah = Math.round(cizimYmm * pxPerMm);
  // Raster yolda renk kararı çizicinin kendi ayarındadır; kutudaki seçim geçici olarak dayatılır
  const kip = { mode: S.colorMode, mono: S.monoColor, plot: S.plot };
  S.colorMode = o.renk === 'mono' ? 'mono' : 'entity'; S.monoColor = 'fg'; S.plot = pdfPlan(o);
  let img = null;
  if (!gorsel) {
    try { img = renderRegion(bb, aw, ah, { light: true, overlay: overlayForExport }); }
    finally { S.colorMode = kip.mode; S.monoColor = kip.mono; S.plot = kip.plot; }
  } else { S.colorMode = kip.mode; S.monoColor = kip.mono; S.plot = kip.plot; }
  const page = document.createElement('canvas'); page.width = W; page.height = H;
  const c = page.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
  // Hazır görsel (3B görünüş): oranı korunur ve çizim alanına ortalanır; renderRegion alanı zaten doldurur
  if (gorsel) { const kk = Math.min(aw / gorsel.width, ah / gorsel.height), dw = gorsel.width * kk, dh = gorsel.height * kk; c.drawImage(gorsel, margin + (aw - dw) / 2, margin + (ah - dh) / 2, dw, dh); }
  else c.drawImage(img, margin, margin);
  if (o.frame !== false) {
    c.strokeStyle = '#000'; c.lineWidth = Math.max(1, pxPerMm * 0.35); c.strokeRect(margin, margin, aw, ah);
    const y0 = margin + ah;
    c.strokeRect(margin, y0, aw, tb);
    c.fillStyle = '#000'; c.textBaseline = 'middle';
    c.font = `bold ${Math.round(4.5 * pxPerMm)}px sans-serif`; c.fillText(o.title || baseName(), margin + 3 * pxPerMm, y0 + tb * 0.32);
    c.font = `${Math.round(3 * pxPerMm)}px sans-serif`;
    c.fillText(bilgi, margin + 3 * pxPerMm, y0 + tb * 0.72);
    const nx = W - margin - 8 * pxPerMm, ny = y0 + tb / 2;
    // Kuzey oku PLANIN okudur; 3B görünüşte bakış döndüğü için yazılmaz (künyede yaw / pitch durur)
    if (!gorsel) {
      c.beginPath(); c.moveTo(nx, ny - 5 * pxPerMm); c.lineTo(nx + 2.5 * pxPerMm, ny + 4 * pxPerMm); c.lineTo(nx, ny + 2 * pxPerMm); c.lineTo(nx - 2.5 * pxPerMm, ny + 4 * pxPerMm); c.closePath(); c.fill();
      c.font = `bold ${Math.round(3 * pxPerMm)}px sans-serif`; c.textAlign = 'center'; c.fillText('K', nx, ny - 7 * pxPerMm); c.textAlign = 'left';
    }
    if (!gorsel && sayfaOlcek && S.unitToM) {
      const worldPerPx = (bb[2] - bb[0]) / aw;
      const barM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(v => v / (worldPerPx * S.unitToM) > 25 * pxPerMm) || 1000;
      const bpx = barM / (worldPerPx * S.unitToM);
      const bx = nx - 20 * pxPerMm - bpx, by = y0 + tb * 0.7;
      c.fillRect(bx, by, bpx / 2, 1.5 * pxPerMm); c.strokeRect(bx, by, bpx, 1.5 * pxPerMm);
      c.font = `${Math.round(2.5 * pxPerMm)}px sans-serif`; c.fillText('0', bx, by - 2 * pxPerMm); c.fillText(barM + ' m', bx + bpx - 3 * pxPerMm, by - 2 * pxPerMm);
    }
  }
  return { jpeg: page.toDataURL('image/jpeg', 0.92).split(',')[1], pw: W, ph: H };
}

/**
 * JPEG gömülü PDF (base64). pages: [{jpeg, pw, ph}] — her öğe bir sayfadır, hepsi aynı kâğıt ölçüsünde.
 * Nesne numaraları sayfa sayısına göre üretilir: 1 katalog, 2 sayfa ağacı, sonra sayfa başına üç nesne
 * (sayfa, içerik, resim), en sonda künye.
 */
function buildPdf(pages, wmm, hmm, title) {
  const list = Array.isArray(pages) ? pages : [pages];
  const Wpt = wmm * 72 / 25.4, Hpt = hmm * 72 / 25.4;
  const parts = [];
  const enc = new TextEncoder();
  let offset = 0; const xref = [];
  const push = (s) => { const b = typeof s === 'string' ? enc.encode(s) : s; parts.push(b); offset += b.length; };
  push('%PDF-1.4\n');
  const obj = (n, body) => { xref[n] = offset; push(`${n} 0 obj\n${body}\nendobj\n`); };
  const pageObj = (i) => 3 + i * 3;                 // sayfa i → 3+3i, içeriği 4+3i, resmi 5+3i
  const infoObj = 3 + list.length * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${list.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${list.length} >>`);
  for (let i = 0; i < list.length; i++) {
    const pg = list[i], bin = atob(pg.jpeg);
    obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Wpt.toFixed(2)} ${Hpt.toFixed(2)}] /Contents ${pageObj(i) + 1} 0 R /Resources << /XObject << /Im1 ${pageObj(i) + 2} 0 R >> >> >>`);
    const content = `q ${Wpt.toFixed(2)} 0 0 ${Hpt.toFixed(2)} 0 0 cm /Im1 Do Q`;
    obj(pageObj(i) + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    xref[pageObj(i) + 2] = offset;
    push(`${pageObj(i) + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.pw} /Height ${pg.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n`);
    const img = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) img[j] = bin.charCodeAt(j);
    push(img); push('\nendstream\nendobj\n');
  }
  const esc2 = (s) => s.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '\\$&');
  obj(infoObj, `<< /Title (${esc2(title)}) /Producer (DWG OfficeZip) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}) >>`);
  const xrefPos = offset;
  let x = `xref\n0 ${infoObj + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= infoObj; i++) x += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${infoObj + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------------------
// Yükleme
// ---------------------------------------------------------------------------
/**
 * Yükleme örtüsü. pct verilirse (0-100) ilerleme çubuğu ve yüzde görünür; verilmezse çubuk gizlenir ve
 * yalnız dönen gösterge kalır. Ölçülemeyen aşamada uydurma yüzde gösterilmez — bekleyen kullanıcıya
 * yanlış bilgi vermek, hiç bilgi vermemekten kötüdür.
 */
const LOAD_KINDS = ['cad', 'doc', 'out', 'd3', 'cloud'];
let loadKind = '';
/*
 * 'cad' görseli bir DÖNGÜ DEĞİL, gerçek ilerlemenin resmidir. Yüzde şu beş aşamaya bölünür ve
 * hem ÇİZİM hem BAŞLIK aynı sayıdan türer — böylece ikisi asla birbiriyle çelişemez:
 *   < 30  dosya okunuyor · < 50 katmanlar · < 72 geometri · < 97 optimize · ≥ 97 görünüm
 * Aşamanın kendi içindeki oran --t (0..1) olarak yazılır; çizim onunla açılır.
 */
const CAD_STG = [
  { b: 30, t: 'stgRead', s: 'stgReadSub' }, { b: 50, t: 'stgLayer', s: 'stgLayerSub' },
  { b: 72, t: 'stgGeom', s: 'stgGeomSub' }, { b: 97, t: 'stgOpt', s: 'stgOptSub' },
  { b: 100, t: 'stgView', s: 'stgViewSub' },
];
/*
 * Çizim açılış ekranı Android'de YERLİ (native) katmandadır: başvuru sahibinin gönderdiği
 * Jetpack Compose ekranı (com.example.dwgloader) WebView'ın üstünde gösterilir ve buradan
 * yalnız gerçek yüzde beslenir. Ekranın kendisi gönderildiği gibidir, tek satırı değişmemiştir.
 * Köprü yoksa (tarayıcı, sınama) aşağıdaki WebView örtüsü yedek olarak kullanılır.
 */
let yerliAcilis = false;
// İptal ya da hata ile kapanıyoruz: yerli açılış ekranı geçişini TAMAMLAMADAN kalkar.
let yerliKes = false;
const yerliVar = () => { const a = A(); return !!(a && typeof a.loadingScreen === 'function'); };
const yerliIlerlemeVar = () => { const a = A(); return !!(a && typeof a.loadingProgress === 'function'); };
let yerliSonGonderim = 0, yerliSonBant = -1;
/** Çizim açılışının tek giriş noktası: yüzdeyi verir, başlığı da görseli de o belirler */
function setLoadingCad(pct, file) {
  const v = Math.max(0, Math.min(100, pct));
  if (yerliVar()) {
    try {
      A().loadingScreen(true, file || '');
      yerliAcilis = true;
      // Yerli ekrana GERÇEK yüzde, bulunulan bandın sınırları ve o bant için beklenen süre
      // gönderilir; ekran bu üçünden donmayan, sıçramayan bir sayı üretir (bkz. aşağıdaki
      // "Açılış kestirimcisi" açıklaması ve DwgLoadingOverlay.kt).
      if (yerliIlerlemeVar()) {
        const b = bandOf(v);
        const simdi = performance.now();
        acilisBantGec(b.ad, simdi);
        // Köprü çağrısını boğmamak için saniyede ~25 gönderim yeter; bant değişimi ve
        // bandın son değeri her hâlde gönderilir, yoksa ekran bir bandı eksik görür.
        if (b.i !== yerliSonBant || simdi - yerliSonGonderim > 40 || v >= 99) {
          yerliSonGonderim = simdi; yerliSonBant = b.i;
          A().loadingProgress(Math.round(v * 100), Math.round(b.alt * 100), Math.round(b.ust * 100), Math.round(bantBeklenenMs(b)));
        }
      }
      hide('loading');                     // iki örtü üst üste gelmesin
      return;
    } catch (e) { yerliAcilis = false; }   // köprü hata verirse WebView örtüsüne düş
  }
  let k = 0; while (k < CAD_STG.length - 1 && v >= CAD_STG[k].b) k++;
  const bitti = v >= 99.95;
  setLoading(t(bitti ? 'stgDone' : CAD_STG[k].t), t(bitti ? 'stgDoneSub' : CAD_STG[k].s), v, 'cad', file);
}
function setLoading(text, sub, pct, kind, file) {
  if (text == null) {
    // Normal kapanış: yerli ekran yüzdeyi önce 100'e tamamlar, sonra solar — geçiş tek parça
    // sıfırdan yüzedir, ortadan kesilmez. İPTAL ve HATA başkadır: dosya açılmadığı için yüzde
    // 100'e koşmak yanlış bilgi olur, örtü olduğu yerde kalkar.
    if (yerliAcilis || yerliVar()) {
      try {
        if (yerliKes && A().loadingScreenAbort) A().loadingScreenAbort();
        else A().loadingScreen(false, '');
      } catch (e) { /* köprü yok */ }
      yerliAcilis = false;
    }
    yerliKes = false;
    // Örtü kapanırken çeşit sınıfı da silinir: bir sonraki bekleme kendi görselini seçmezse
    // öncekinin çizimi kalmasın.
    const el = $('loading');
    if (el) { el.classList.remove(...LOAD_KINDS.map(k => 'load-' + k)); delete el.dataset.cad; }
    loadKind = '';
    hide('loading'); return;
  }
  // Bekleme görseli yapılan işe göre değişir: çizim okunurken kalem planı çizer, belgede sayfa
  // dizilir, dışa aktarmada sayfa cihazdan çıkar. Çeşit verilmezse önceki korunur — aynı işin
  // ortasında görselin değişmesi, ilerleme sıfırlanmış gibi durur.
  if (kind && LOAD_KINDS.includes(kind)) {
    loadKind = kind;
    const el = $('loading');
    if (el) for (const k of LOAD_KINDS) el.classList.toggle('load-' + k, k === kind);
  }
  { const fl = $('loadingFile'); if (fl) { fl.textContent = file || ''; fl.hidden = !file; } }
  $('loadingText').textContent = text;
  $('loadingSub').textContent = sub || '';
  const prog = $('loadingProg');
  if (prog) {
    const on = typeof pct === 'number' && isFinite(pct);
    prog.hidden = !on;
    if (on) {
      const v = Math.max(0, Math.min(100, Math.round(pct)));
      $('loadingFill').style.width = v + '%';
      $('loadingPct').textContent = '%' + v;
      prog.querySelector('.lbar').setAttribute('aria-valuenow', String(v));
    }
  }
  // Aşamalı görsel ve aşama noktaları yalnız ölçülebilir bir 'cad' yüklemesinde çalışır;
  // yüzde yoksa görsel 0. aşamada durur ve uydurma bir ilerleme gösterilmez.
  {
    const el = $('loading');
    const on = loadKind === 'cad' && typeof pct === 'number' && isFinite(pct);
    if (el) {
      if (on) {
        const v = Math.max(0, Math.min(100, pct));
        let k = 0; while (k < CAD_STG.length - 1 && v >= CAD_STG[k].b) k++;
        // data-cad YALNIZ aşama noktaları içindir. Çizimin kendisi buna bakmaz: o, kendi
        // 9 s'lik döngüsünü baştan sona ve kesintisiz oynar (bkz. app.css bölüm 3). Görsel
        // anlatır, metin ile çubuk bilgilendirir — ikisini birbirine bağlamak anlatıyı
        // bozuyordu: hızlı açılışta resimler sıçrıyor, yavaş aşamada tek kare donuyordu.
        el.dataset.cad = String(v >= 99.95 ? 4 : k);
      } else {
        delete el.dataset.cad;
      }
    }
    const dots = $('loadingDots'); if (dots) dots.hidden = !on;
  }
  show('loading');
}
/**
 * Akıştan okuyarak indirir ve yüzdeyi bildirir. Content-Length yoksa ya da gövde akış vermiyorsa
 * doğrudan arrayBuffer'a düşer (yüzde gösterilmez, çubuk da çıkmaz).
 */
async function fetchBuf(url, onPct) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const total = Number(r.headers.get('content-length') || 0);
  if (!onPct || !total || !r.body || typeof r.body.getReader !== 'function') return r.arrayBuffer();
  const reader = r.body.getReader();
  const chunks = [];
  let done = 0, last = -1;
  for (;;) {
    const { value, done: fin } = await reader.read();
    if (fin) break;
    chunks.push(value); done += value.length;
    const p = Math.min(99, Math.round(100 * done / total));   // 100 yalnız iş bitince yazılır
    if (p !== last) { last = p; onPct(p); }
  }
  const out = new Uint8Array(done);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}
/** Yüklemeyi iptal eder. Örtüdeki Vazgeç düğmesi de, yerli açılış ekranındayken geri tuşu da
 *  buraya gelir — gönderilen ekranda Vazgeç düğmesi yoktur, çıkış yolu geri tuşudur. */
function cancelLoading() {
  cancelJobs(tt('cancelled', 'İptal edildi'));
  yerliKes = true;                       // vazgeçildi: açılış ekranı 100'e koşmasın
  acilisBasladi = 0;                     // yarıda kesilen süre kestirimi kirletmesin
  setLoading(null);
  toast(tt('cancelled', 'İptal edildi'));
}
{ const b = $('loadingCancel'); if (b) b.addEventListener('click', cancelLoading); }
function fail(err) {
  if (err && err.cancelled) { console.warn(err.message); return; }   // iptal: yeni yükleme sürüyor, modal ona ait
  console.error(err);
  yerliKes = true;                       // dosya açılamadı: açılış ekranı 100'e koşmasın
  acilisBasladi = 0;                     // yarıda kesilen süre kestirimi kirletmesin
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
/*
 * Açılışın gerçek aşamaları TEK bir 0-100 ölçeğine oturur, böylece çubuk hiç geri gitmez ve
 * kullanıcı "nerede kaldı" sorusunun cevabını görür. Bantlar işin gerçek ağırlığına göredir:
 * çözümleyici yüklenmesi kısa, dosya çözümlemesi ve sahne kurulumu uzun, indeks ile görünüm
 * hazırlığı sonda. İşçi kendi aşamasının yüzdesini verir, o da bandın içine ölçeklenir.
 */
const OPEN_BAND = { lib: [1, 14], parse: [14, 45], scene: [45, 70], index: [70, 92], view: [92, 99] };
const openPct = (st, pct) => {
  const b = OPEN_BAND[st] || [0, 0];
  const k = typeof pct === 'number' && isFinite(pct) ? Math.max(0, Math.min(100, pct)) / 100 : 0;
  return b[0] + (b[1] - b[0]) * k;
};
/*
 * ------------------------------------------------------------------------------------------
 * AÇILIŞ KESTİRİMCİSİ
 * ------------------------------------------------------------------------------------------
 * Sorun şuydu: açılış yüzdesi ya gerçek ilerlemeye bağlanıyor (o zaman sessiz aşamalarda
 * dakikalarca kıpırdamıyor), ya da gerçekten koparılıyor (o zaman dosyayla ilgisi kalmıyor).
 * İkisi de yanlış. Doğrusu, iki kaynağı BİRLEŞTİRMEKTİR:
 *
 *   1) GERÇEK yüzde. Açılış hattı beş banda ayrılmıştır (OPEN_BAND) ve bunların üçünde
 *      bildirim ayrıntılıdır: pencereli çözümleme her pencerede (worker.js), sahne kurulumu
 *      her 5.000 varlıkta (scene.js), uzamsal indeks her ~10 ms'de (geom.js). İkisinde ise
 *      seyrektir: 32 MB altındaki dosyalarda LibreDWG tek blok hâlinde çalışır ve HİÇ
 *      bildirmez; görünüm hazırlığı yalnız üç noktada bildirir. Kullanıcının gördüğü donma
 *      tam olarak bu sessiz aralıklardır.
 *
 *   2) SÜRE kestirimi. Dosyanın boyutu ve nesne sayısı çözümlemeden ÖNCE bilinir
 *      (dwgObjectCount). Beklenen süre bunlardan çıkarılır ve sessiz aralıkta yüzdeyi
 *      ilerleten bu olur. Kestirim cihazdan cihaza değişir, bu yüzden SABİT DEĞİLDİR:
 *      her başarılı açılıştan sonra ölçülen gerçek süre ile karşılaştırılıp ölçek düzeltilir
 *      (üstel ortalama). Birkaç açılıştan sonra kestirim o cihaza ve o kullanıcının
 *      dosyalarına oturur.
 *
 * Yerli ekran bu ikisinin büyüğünü alır, bandın tavanını aşmaz ve hızını sınırlar; böylece
 * sayı ne geri gider, ne sıçrar, ne de durur. Ayrıntı: DwgLoadingOverlay.kt.
 */
const BANT_SIRA = ['lib', 'parse', 'scene', 'index', 'view'];
/** Yüzdenin hangi banda düştüğü: alt ve üst sınırıyla birlikte */
function bandOf(v) {
  for (let i = 0; i < BANT_SIRA.length; i++) {
    const b = OPEN_BAND[BANT_SIRA[i]];
    if (v < b[1] || i === BANT_SIRA.length - 1) return { i, ad: BANT_SIRA[i], alt: b[0], ust: b[1] };
  }
  return { i: 0, ad: 'lib', alt: 1, ust: 14 };
}
/*
 * Beklenen toplam süre. Katsayılar bu depodaki örneklerle ölçüldü (0,5-0,9 MB'lık DWG'ler
 * masaüstünde 100-500 ms); telefon bundan kat kat yavaştır, farkı ÖLÇEK kapatır. Taban
 * 600 ms'dir: çok küçük dosyada bile yüzde bir anda uçmasın, geçiş görülsün.
 */
const TAHMIN_MS_NESNE = 0.05;      // nesne başına ms
const TAHMIN_MS_MB = 120;          // megabayt başına ms
const TAHMIN_TABAN_MS = 600;
const tahminTaban = (nesne, mb) => Math.max(TAHMIN_TABAN_MS, (nesne || 0) * TAHMIN_MS_NESNE + (mb || 0) * TAHMIN_MS_MB);
/*
 * BANT PAYLARI. Bir bandın beklenen süresi, bandın GENİŞLİĞİNDEN çıkarılamaz — ölçüldüğünde
 * ikisi birbirini tutmuyor: bu depodaki üç örnekte çözümleme (parse) sürenin %85-89'unu
 * tutarken çubuğun yalnız %31,6'sını, uzamsal indeks ise sürenin ~%1'ini tutarken çubuğun
 * %22,4'ünü alıyor. Bütçe genişliğe göre dağıtılırsa çözümleme bandının bütçesi 2,7 kat
 * küçük kalır, zaman ekseni hemen kuyruğa girer ve sayı bandın tavanına yapışır — yani
 * kullanıcının bildirdiği donma, bu kez %96 yerine %44'te tekrarlar.
 *
 * Bu yüzden paylar AYRI tutulur ve her açılışta ölçülüp düzeltilir: hangi bandın ne kadar
 * sürdüğü cihaza, dosyaya ve yola (tek parça / pencereli) göre değişir; birkaç açılıştan
 * sonra paylar kullanıcının kendi dosyalarına oturur.
 */
const PAY_VARSAYILAN = { lib: 0.06, parse: 0.62, scene: 0.18, index: 0.10, view: 0.04 };
function acilisPaylar() {
  const p = store.json('acilisPay', null);
  if (!p) return { ...PAY_VARSAYILAN };
  let t = 0; for (const k of BANT_SIRA) t += (isFinite(p[k]) && p[k] > 0) ? p[k] : 0;
  if (!(t > 0)) return { ...PAY_VARSAYILAN };
  const out = {};
  // Hiçbir pay %2'nin altına inmesin: bir açılışta hiç sürmemiş bir bant, sonraki açılışta
  // uzun sürerse bütçesiz kalmamalı.
  for (const k of BANT_SIRA) out[k] = Math.max(0.02, ((isFinite(p[k]) && p[k] > 0) ? p[k] : 0) / t);
  let t2 = 0; for (const k of BANT_SIRA) t2 += out[k];
  for (const k of BANT_SIRA) out[k] /= t2;
  return out;
}
/** Cihazın öğrenilmiş ölçeği: gerçek süre / taban kestirim. 1 = taban doğru. */
const acilisOlcek = () => { const o = Number(store.get('acilisOlcek')); return isFinite(o) && o > 0 ? Math.max(0.2, Math.min(12, o)) : 1; };
let acilisTahminMs = TAHMIN_TABAN_MS;   // bu açılış için beklenen toplam süre
let acilisTabanMs = TAHMIN_TABAN_MS;    // ölçeksiz taban (öğrenme bunun üzerinden yapılır)
let acilisBasladi = 0;
let acilisPay = { ...PAY_VARSAYILAN };
let acilisSure = {};                    // bu açılışta bantların ölçülen süreleri
let acilisBantAd = '', acilisBantBasi = 0;
/** Açılış başlarken kestirimi kurar */
function acilisKestirimBasla(nesne, mb) {
  acilisTabanMs = tahminTaban(nesne, mb);
  acilisTahminMs = acilisTabanMs * acilisOlcek();
  acilisPay = acilisPaylar();
  acilisBasladi = performance.now();
  acilisSure = {}; acilisBantAd = ''; acilisBantBasi = acilisBasladi;
  yerliSonGonderim = 0; yerliSonBant = -1;
}
/** Bant değişimini ve süresini kaydeder (öğrenme bununla besleniyor) */
function acilisBantGec(ad, simdi) {
  if (!acilisBasladi) return;
  if (acilisBantAd && acilisBantAd !== ad) acilisSure[acilisBantAd] = (acilisSure[acilisBantAd] || 0) + (simdi - acilisBantBasi);
  if (acilisBantAd !== ad) { acilisBantAd = ad; acilisBantBasi = simdi; }
}
/**
 * Açılış bittiğinde hem toplam ölçeği hem bant paylarını düzeltir. Üstel ortalama: tek bir
 * aykırı dosya kestirimi savurmaz, ama cihaz gerçekten yavaşsa birkaç açılışta oraya oturur.
 */
function acilisKestirimOgren() {
  if (!acilisBasladi || acilisTabanMs <= 0) return;
  const simdi = performance.now();
  const gercek = simdi - acilisBasladi;
  if (acilisBantAd) acilisSure[acilisBantAd] = (acilisSure[acilisBantAd] || 0) + (simdi - acilisBantBasi);
  acilisBasladi = 0;
  if (gercek < 150) return;                       // ölçülemeyecek kadar kısa: öğrenme kirlenmesin
  const yeni = Math.max(0.2, Math.min(12, 0.65 * acilisOlcek() + 0.35 * (gercek / acilisTabanMs)));
  store.set('acilisOlcek', String(Math.round(yeni * 1000) / 1000));
  let t = 0; for (const k of BANT_SIRA) t += acilisSure[k] || 0;
  if (t < 150) return;
  const eski = acilisPaylar(), pay = {};
  for (const k of BANT_SIRA) pay[k] = Math.round((0.65 * eski[k] + 0.35 * ((acilisSure[k] || 0) / t)) * 10000) / 10000;
  store.set('acilisPay', JSON.stringify(pay));
}
/** Bir bandın beklenen süresi: payı ölçümden gelir, genişliğinden değil */
function bantBeklenenMs(b) {
  return Math.max(120, acilisTahminMs * (acilisPay[b.ad] || 0.05));
}
/** Ana iş parçacığını nefes aldırır: bekleme görseli aksın, Vazgeç düğmesi basılabilsin */
const nefes = () => new Promise(r => setTimeout(r));
const BIG_FILE_MB = 80;   // bu boyutun üstünde açmadan önce onay istenir (bellek / süre)
/*
 * Nesne sayısı eşiği. LibreDWG nesne başına ölçülen ~800 bayt yer tutar (7.088.013 nesneli bir dosya 64 bit
 * yerel derlemede 5.680 MB tepe bellekle okundu); WebAssembly 32 bit olduğu için yığın hiçbir cihazda
 * 4096 MB'ı geçemez, yani tavan yaklaşık 4,7 milyon nesnedir. 2 milyon nesne bu bütçenin yarısına yakınını
 * yer ve Android WebView'ın işleyici başına koyduğu tavan birçok telefonda daha da düşüktür — bu sayının
 * üstünde açma denemesi dakikalar sürüp bellek hatasıyla bitebilir, o yüzden başlamadan önce sorulur.
 */
const HUGE_OBJ = 2000000;
let loadSeq = 0;
async function loadBytes(buf, name, size) {
  const t0 = performance.now();
  const bytes = size || buf.byteLength;
  const mb = fmt(bytes / 1024 / 1024, 2) + ' MB';
  if (bytes > BIG_FILE_MB * 1048576 && !(await askConfirm(`${name} · ${mb}. ${t('bigFileAsk')}`))) { setLoading(null); return; }
  // ön yoklama: nesne sayısı çözümlemeden önce okunur (R13 – R2000); bilinmiyorsa null döner
  let stat = null;
  try { stat = dwgObjectCount(new Uint8Array(buf, 0, bytes)); } catch (_) { stat = null; }
  const objN = stat ? stat.objects : 0;
  const sub = name + ' · ' + mb + (objN ? ' · ' + fmt(objN, 0) + ' ' + t('objectsN') : '');
  if (objN > HUGE_OBJ && !(await askConfirm(`${name} · ${fmt(objN, 0)} ${t('objectsN')}. ${t('hugeObjAsk')}`))) { setLoading(null); return; }
  const my = ++loadSeq;
  acilisKestirimBasla(objN, bytes / 1048576);
  setLoadingCad(1, sub);
  try {
    let res = await runWorker({ cmd: 'parse', bytes: buf, name, objects: objN },
      (st, pct) => { if (my === loadSeq) setLoadingCad(openPct(st, pct), sub); });
    const scene = res.scene; res = null;   // yapısal klon: büyük dosyada referansı erken düşür
    await setScene(scene, name, bytes, (p) => { if (my === loadSeq) setLoadingCad(p, sub); });
    // özet toast'ından sonra (toast tek satırdır, hemen üstüne yazılırsa görünmez)
    if (scene.readWarn) setTimeout(() => toast(`${tt('readWarn', 'Dosya eksik/bozuk okunmuş olabilir')} (LibreDWG ${scene.readWarn}); ${tt('readWarnSub', 'çizim eksik olabilir.')}`, { type: 'warn', ms: 8000 }), 1200);
    // DGN'de çizilmeyen eleman türleri sessiz geçilmez: hangisinden kaç tane atlandığı yazılır
    if (scene.dgn && scene.dgn.desteksiz && Object.keys(scene.dgn.desteksiz).length) {
      const d = Object.entries(scene.dgn.desteksiz).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(', ');
      setTimeout(() => toast(`${t('dgnSkipped')}: ${d}`, { type: 'warn', ms: 8000 }), 1600);
    }
    const ms = Math.round(performance.now() - t0);
    const hidden = [...S.layers.values()].filter(l => !l.visible).length;
    toast(`${name} · ${S.entityCount} ${t('entity')} · ${ms} ms` + (hidden ? ` · ${hidden} ${t('layersHiddenN')}` : ''));
    if (!S.prims.length) toast(t('noModelPrims'), 5000);
    if (S.scene.xrefs.length || S.scene.images.length) setTimeout(() => toast(t('xrefMissing') + ': ' + [...S.scene.xrefs.map(x => x.name), ...S.scene.images.map(i => (i.fileName || '').split(/[\\/]/).pop())].filter(Boolean).join(', ') + ' — ' + t('seeXrefs'), 6000), 3000);
    acilisKestirimOgren();               // ölçülen süre kestirimi bir sonraki açılış için düzeltir
  } catch (e) { fail(e); }
  if (my === loadSeq) setLoading(null);   // iptal edilen eski yükleme yenisinin modalını kapatmasın
}
/*
 * Uzamsal indeks. Eskiden tek blok hâlinde kurulurdu ve büyük çizimde ana iş parçacığını
 * saniyelerce kilitlerdi: bekleme görseli donar (stroke-* özellikleri bileşik katmanda
 * çalışamaz), Vazgeç düğmesi basılmaz, kullanıcı uygulamanın çöktüğünü sanırdı. Artık
 * RTree.build aradan çıkabilen bir kurucudur — her ~10 ms'de denetimi tarayıcıya bırakır ve
 * gerçek yüzdeyi bildirir. Küçük çizimde tek blok zaten göze görünmez, eski yol korunur.
 */
async function buildTree(prims, onPct) {
  if (prims.length < 20000) return new RTree(prims, p => p.bb);
  return RTree.build(prims, p => p.bb, 16, { onPct });
}
async function setScene(scene, name, size, rep) {
  const bildir = typeof rep === 'function' ? rep : () => { };
  S.modelTree = await buildTree(scene.layouts[0].prims, (p) => bildir(openPct('index', p)));
  S.scene = scene; S.fileName = name; S.fileKey = (name + '_' + size).replace(/[^\w.-]+/g, '_');
  S.layers = new Map(scene.layers.map(l => [l.name, l]));
  S.ltypes = scene.ltypes; S.styles = scene.styles; S.counts = scene.counts; S.entityCount = scene.entityCount; S.blockCount = scene.blockCount;
  { const d = scene.solidDiag; if (d && d.solids > 0 && !d.faces) setTimeout(() => toast(`${d.solids} ${t('solidsUnresolved')} (${(d.errors[0] || '').slice(0, 80)}). ${t('seeSolidDiag')}`, { type: 'warn', ms: 9000 }), 800); }
  S.version = ({ AC1012: 'R13', AC1014: 'R14', AC1015: 'AutoCAD 2000', AC1018: 'AutoCAD 2004', AC1021: 'AutoCAD 2007', AC1024: 'AutoCAD 2010', AC1027: 'AutoCAD 2013', AC1032: 'AutoCAD 2018' })[scene.version] || scene.version || '';
  if (/\.dxf$/i.test(name)) S.version = 'DXF ' + S.version;
  if (/\.dgn$/i.test(name) && !/^DGN/.test(S.version)) S.version = 'DGN ' + S.version;
  const iu = scene.header.INSUNITS;
  // Dosyanın KENDİ birimi ayrıca saklanır: kullanıcı ayarı "Çizimden"e döndürdüğünde buraya dönülür
  S.units = UNITS[iu] || ''; S.unitToM = UNIT_TO_M[iu] || 0;
  S.unitsDosya = S.units; S.unitToMDosya = S.unitToM;
  S.images = new Map(); S.compare = null; S.selected = null; S.cacheValid = false;
  S.hideObj = new Set(); S.isoObj = null;   // nesne gizleme / izolasyon dosyaya özeldir
  pdfWin = null; pdfAyar.title = ''; pdfAyar.area = pdfAyar.area === 'win' ? 'view' : pdfAyar.area;   // PDF alanı ve başlığı dosyaya özeldir
  S.hasDoc = true;
  syncDeskClass();   // masaüstü kipi çizim açıkken geçerlidir: sınıf burada da tazelenir
  Docs.suspend();
  if (S.mode !== 'view') setMode('view');
  if (S.notesOn) toggleNotes(false);
  Home.hide(); hide('infoPanel'); hide('docPanel'); hide('searchPanel'); Open.close(); refreshMenu();
  showFileName(name);
  /*
   * Sayaç iki boyda yazılır: geniş çubukta "2917 varlık · 42 katman", dar çubukta yalnız sayı.
   * Kısaltma statusFit'in işidir; burada iki metin de hazırlanır ki geçiş metni yeniden kurmasın.
   */
  {
    const el = $('stCount');
    el.dataset.uzun = S.entityCount + ' ' + t('entity') + ' · ' + S.layers.size + ' ' + t('layerCount');
    el.dataset.kisa = String(S.entityCount);
    el.textContent = el.dataset.uzun;
  }
  { const sub = $('fileSub'); if (sub) sub.textContent = [S.entityCount + ' ' + t('entity'), S.units || null, S.version || null].filter(Boolean).join(' · '); }
  document.body.classList.add('hasdoc');
  $('gpsBtn').hidden = S.ui2d.fabGps === false;   // görünürlüğü Ekran ayarları > Ekrandaki düğmeler belirler
  S.isoBackup = null; S.lastPoint = null; S.gotoMarker = null; S.layerPalette.clear(); S.panMode = false;   // kaydır kipi dosyayla birlikte sıfırlanır
  viewHistory.reset();
  applyGeo();
  loadNotes(S.fileKey);
  for (const n of notes.items) if (n.type === 'photo' && n.photo) loadPhoto(n.photo);
  // Görünüm hazırlığının üç ağır adımı arasında nefes verilir: büyük çizimde bunlar da
  // yüzlerce milisaniye sürer ve arka arkaya koşarsa bekleme görseli yine donardı.
  bildir(openPct('view', 0)); await nefes();
  setLayout(0);
  bildir(openPct('view', 40)); await nefes();
  editorScene();
  bildir(openPct('view', 75)); await nefes();
  if (!$('layerPanel').hidden) buildLayerList();
  refreshNav();
  bildir(100);
  setTimeout(saveThumb, 400);
  Ed.onDocOpen();   // ücretsiz sürüm: açılış reklamı
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
async function fetchFile(id, onPct) {
  try { return await fetchBuf('/file/' + id, onPct); }
  catch (e) { throw new Error('dosya okunamadı (' + e.message + ')'); }
}
let loadingKey = null;   // Android'den aynı dosya iki kez gelirse (intent + onResume) ikincisi yok sayılır
async function loadCurrent(name, size) {
  const key = name + '|' + (size || 0);
  if (loadingKey === key) return;
  loadingKey = key;
  try {
    if (!Docs.isCad(name) && Docs.kindOf(name) !== 'other') { setLoading(t('loading'), name, undefined, 'doc'); const ok = await Docs.openCurrent(name, size); setLoading(null); if (ok) return; }
    setLoading(t('loading'), name, 0, 'cad');
    const buf = await fetchFile('current', (p) => setLoading(t('loading'), name, p));
    await loadBytes(buf, name, size);
  } catch (e) { fail(e); }
  finally { if (loadingKey === key) loadingKey = null; }
}
/** Android dosya seçici sonucu */
async function onFilePicked(purpose, id, name, size) {
  try {
    if (purpose === 'open') { await loadCurrent(name, size); return; }
    if (purpose.startsWith('upload:')) { const info = JSON.parse(A().docOpen(id) || '{}'); if (info.error) throw new Error(info.error); Drive.upload({ fileId: info.id, name, mime: Docs.kindOf(name) === 'cad' ? 'application/acad' : 'application/octet-stream', folder: purpose.slice(7) }); return; }
    if (purpose === 'wdupload') { const info = JSON.parse(A().docOpen(id) || '{}'); if (info.error) throw new Error(info.error); await Cloud.uploadPicked({ fileId: info.id }, name); return; }
    if (purpose === 'compare') { await setCompare(await fetchFile(id), name); return; }
    if (purpose === 'pdfcad') { await pdfCadFromBytes(await fetchFile(id), name); return; }
    if (purpose.startsWith('xref:')) { await loadXref(Number(purpose.slice(5)), await fetchFile(id), name); return; }
    if (purpose === 'xattach') { await xattachLoad(await fetchFile(id), name); return; }
    if (purpose.startsWith('img:')) { loadImageFile(purpose.slice(4), '/file/' + id); return; }
    if (purpose === 'photo' && pendingPhotoPoint) {
      const txt = (await askText(t('notePrompt'), '', { multiline: true, words: true })) || '';
      addNote({ type: 'photo', pts: [pendingPhotoPoint], color: S.noteColor, photo: id, text: txt });
      loadPhoto(id); pendingPhotoPoint = null; drawOverlay();
    }
  } catch (e) { fail(e); }
}
/** Dosya seçimi: fotoğraf doğrudan sistem seçicisine (kamera/galeri); ötekiler Android'de Dosya Aç merkezinin seçim kipine (köprü fsRoots varsa), tarayıcıda <input type=file> */
function pickFile(purpose, mime) {
  if (A() && A().pickFile) {
    if (purpose !== 'photo' && A().fsRoots) { Open.open('device', { pick: { purpose, mime: mime || '*/*' } }); return; }
    A().pickFile(purpose, mime || '*/*'); return;
  }
  browserPick(purpose, mime);
}
function browserPick(purpose, mime) {
  const inp = document.createElement('input'); inp.type = 'file'; if (mime && mime !== '*/*') inp.accept = mime;
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) fileForPurpose(purpose, f); };
  inp.click();
}
/** Tarayıcıda seçilen File nesnesini amacına göre işler (Android'deki onFilePicked karşılığı) */
async function fileForPurpose(purpose, f) {
  try {
    if (purpose === 'open') { Open.noteFile(f); if (Docs.isCad(f.name) || Docs.kindOf(f.name) === 'other') await loadBytes(await f.arrayBuffer(), f.name, f.size); else await Docs.openBlob(f); }
    else if (purpose === 'compare') await setCompare(await f.arrayBuffer(), f.name);
    else if (purpose === 'pdfcad') await pdfCadFromBytes(await f.arrayBuffer(), f.name);
    else if (purpose.startsWith('xref:')) await loadXref(Number(purpose.slice(5)), await f.arrayBuffer(), f.name);
    else if (purpose === 'xattach') await xattachLoad(await f.arrayBuffer(), f.name);
    else if (purpose === 'wdupload') await Cloud.uploadPicked({ b64: b64bytes(new Uint8Array(await f.arrayBuffer())) }, f.name);
    else if (purpose.startsWith('img:')) loadImageFile(purpose.slice(4), URL.createObjectURL(f));
    else if (purpose === 'photo' && pendingPhotoPoint) {
      const id = 'blob_' + Date.now();
      loadPhoto(id, URL.createObjectURL(f));
      addNote({ type: 'photo', pts: [pendingPhotoPoint], color: S.noteColor, photo: id, text: (await askText(t('notePrompt'), '', { multiline: true, words: true })) || '' });
      pendingPhotoPoint = null; drawOverlay();
    }
  } catch (e) { fail(e); }
}
/** Sistem dosya seçicisi (Dosya Aç merkezindeki düğme): Android'de Bridge.pickFile, tarayıcıda #fileInput ya da amaca özel <input> */
function systemPick(purpose, mime) {
  if (A() && A().pickFile) { A().pickFile(purpose || 'open', mime || '*/*'); return; }
  if (!purpose || purpose === 'open') $('fileInput').click(); else browserPick(purpose, mime);
}
$('btnOpen').addEventListener('click', () => Open.open());
$('btnOpen2').addEventListener('click', () => Open.open());
$('btnNew2').addEventListener('click', showNewDoc);
{ const b = $('recentAll'); if (b) b.addEventListener('click', () => Open.open('recent')); }
$('fileInput').addEventListener('change', async (ev) => { const f = ev.target.files && ev.target.files[0]; if (!f) return; await fileForPurpose('open', f); ev.target.value = ''; });

// ---- son dosyalar --------------------------------------------------------------------------
function buildRecent() {
  const list = Open.recentList().slice(0, 8);   // Android: Bridge.getRecent; tarayıcı: oturum listesi
  $('recentWrap').hidden = !list.length;
  $('recentList').innerHTML = list.map((r, i) => `<div class="item" data-i="${i}" data-name="${esc(r.name)}">${r.thumb ? `<img src="/file/thumb_${esc(r.key)}?${r.time}" alt="">` : `<div class="noimg">${Docs.iconFor(r.name)}</div>`}<div class="nm">${esc(r.name)}<div class="meta">${fmt(r.size / 1024 / 1024, 2)} MB · ${new Date(r.time).toLocaleString('tr-TR')}</div></div></div>`).join('');
  $('recentList').onclick = (ev) => { const it = ev.target.closest('.item'); if (it) Open.openRecent(list[Number(it.dataset.i)].uri); };
  Open.refresh();
}

// ---- geri tuşu --------------------------------------------------------------------------------
function onBack() {
  if (askOpen()) { askCancel(); return true; }
  if (!$('qrPanel').hidden) { stopQr(); return true; }
  if (!$('moreMenu').hidden) { closeMenu(); return true; }
  if (zoomWin) { cancelZoomWindow(); return true; }
  if (Ed.isProPanelOpen()) { Ed.closeProPanel(); return true; }
  if (!$('drivePanel').hidden) { Drive.close(); return true; }
  if (Open.isOpen()) { Open.close(); return true; }
  // Ana ekran belgenin ÜSTÜNDE de açılabilir (dosya kapanmıyor, yalnız üste geliniyor);
  // bu yüzden önce ana ekran denetlenir, yoksa görünmeyen belgenin geri tuşu işlerdi.
  if (Home.isShown()) { const open0 = openPanels(); if (open0.length) { for (const id of open0) hide(id); return true; } return Home.back(); }   // Ev'de false: uygulama kapanır
  if (Docs.isOpen()) { const open0 = openPanels(); if (open0.length) { for (const id of open0) hide(id); return true; } Docs.back(); return true; }
  if (S.gotoMarker) { S.gotoMarker = null; drawOverlay(); return true; }
  const open = openPanels();
  if (open.length) { for (const id of open) hide(id); dockLayers(); if (S.mode !== 'view') setMode('view'); return true; }
  if (S.panMode) { togglePan(false); return true; }   // kaydır kipi araç iptalinden önce, panellerden sonra kapanır
  if (editorBack()) return true;
  if (S.notesOn) { toggleNotes(false); return true; }
  if (S.mode !== 'view') { setMode('view'); return true; }
  if (S.selected) { S.selected = null; drawOverlay(); return true; }
  return false;
}
/*
 * SİSTEM GERİ TUŞU ve üst çubuktaki Geri düğmesi. onBack ile arasındaki fark bilinçlidir:
 * onBack "en üstteki şeyi kapat, kapatacak bir şey yoksa false" sözleşmesini korur (paneller,
 * kipler, seçim, ölçü, notlar bunun üzerine kuruludur). Buradaki ek adım gezinmedir: kapatacak
 * bir şey kalmadıysa ve elde açık bir dosya varsa uygulamadan çıkılmaz, ANA EKRANA dönülür.
 * Dosya kapanmaz; Ev sekmesindeki "Kaldığınız yerden devam edin" kartıyla geri alınır.
 * Uygulamadan çıkış ana ekranın Ev sekmesindeki geri tuşuyladır (Home.back false döner), yani
 * iki ekran arasında döngü oluşmaz.
 */
function onBackSystem() {
  if (onBack()) return true;
  // Zaten ana ekrandaysak bir daha ana ekrana gitmeyiz: yoksa Ev sekmesinde geri tuşu sonsuza
  // dek true döner ve uygulamadan çıkılamaz (sınama bunu yakaladı).
  if (!Home.isShown() && (S.hasDoc || Docs.isOpen())) { goHome(); return true; }
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
window.dwgApp = { osnap: Osnap, paylasGorunum, gorunumPng, loadCurrent, onFilePicked, onLocation, onBack, onBackSystem, loadBytes, zoomExtents, render, toScreen, toWorld, state: S, notes, editor, setMode, setLayout, refreshRecent: buildRecent, showInfo,
  onFilesPicked, onQr: (text) => { try { const s = String(text || '').trim(); if (s) onQr(s); } catch (e) { console.warn(e); } },   // Android ACTION_SEND / EXTRA_TEXT
  onLocationError: (m) => { const perm = /kalıcı olarak reddedildi|permanently denied/i.test(String(m)); const openSet = A() && A().openAppSettings ? () => A().openAppSettings() : null;
    toast('GPS: ' + m, perm && openSet ? { ms: 8000, action: { label: tt('settings', 'Ayarlar'), fn: openSet } } : undefined); },
  // sınama tutamağı: aşamalı açılış görselini gerçek dosya açmadan yüzde yüzde sürer
  __cadLoad: (pct, file) => setLoadingCad(pct, file), setLoading, cancelLoading,
  // PDF'te basılacak dünya dikdörtgeni (bkz. tools/test_pdf_plot.mjs): kapsam seçiminin
  // kâğıt oranına nasıl oturduğu dosya üretmeden denetlenebilsin
  __pdfAlan: (o, gmm, ymm) => pdfAlani(o, false, gmm, ymm),
  __pan: (on) => (on === undefined ? panOn() : togglePan(on)),
  __stFit: () => { const b = $('statusbar'); return { tasma: b.scrollWidth - b.clientWidth, tight: document.body.classList.contains('st-tight'), scroll: $('stQuick').classList.contains('st-scroll'), dusen: ST_DUSME.filter(i => $(i) && $(i).classList.contains('st-squeeze')) }; },
  // Pencere seçiminin iç durumu ve seçilen dünya dikdörtgeni (bkz. tools/test_pdf_plot.mjs):
  // iki nokta kipi, konmuş birinci köşe ve lastik dikdörtgen sınanabilsin
  __zw: () => (zoomWin ? { iki: !!zoomWin.iki, pending: !!zoomWin.pending, x0: zoomWin.x0, y0: zoomWin.y0, x1: zoomWin.x1, y1: zoomWin.y1 } : null),
  __pdfWin: () => (pdfWin ? pdfWin.slice() : null),
  __kaplamaPayi: () => kaplamaPayi(),   // kaplamanın alt/üst güvenli payı (ölçek çubuğu, kuzey oku, künye)
  __kuzey: () => kuzeyYeri(),           // 2B kuzey okunun merkezi ve yarıçapı (bkz. tools/test_yerlesim.mjs)
  // Çıktı rengi eşlemesi (bkz. tools/test_pdf_plot.mjs): kullanılan renkler, tablo ve eşlemenin kendisi
  __pdfCtb: (t) => { if (t) Object.assign(pdfAyar.ctb, t); return { tablo: { ...pdfAyar.ctb }, renkler: pdfKullanilanRenkler().map(r => ({ k: r.key, col: r.col, n: r.n })) }; },
  __plotRgb: (col, plan) => plotRgb(col, plan),
  // Kâğıdın yönü ve mm ölçüsü (bkz. tools/test_pdf_plot.mjs): 'auto' yönün basılacak alandan
  // çıktığı dosya üretmeden denetlenebilsin
  __pdfSayfa: (o) => pdfSayfaMm({ paper: 'A3', orient: 'auto', area: 'view', ...(o || {}) }, !!(o && o.all)),
  // İmleç ve yakalama durumu (bkz. tools/test_pickbox.mjs): nesne istemi mi, kare kaç piksel,
  // o noktada yakalama ne buluyor (nesne isteminde null olmalıdır)
  __pickbox: () => ({ on: pickingObject(), r: pickBoxR(), tol: TOL.pick, hover: penHover ? { sx: penHover.sx, sy: penHover.sy, fx: penHover.fx == null ? null : penHover.fx, fy: penHover.fy == null ? null : penHover.fy, ofs: penHover.ofs ? penHover.ofs.slice() : null, aim: !!penHover.aim, snap: penHover.snap ? penHover.snap.kind : null } : null, loupe: penHover && penHover.aim ? loupeGeom(penHover) : null }),
  __snapAt: (x, y, o) => { const sn = findSnap([x, y], o || {}); return sn ? { kind: sn.kind, p: sn.p.slice(0, 2) } : null; },
  // Nesne yakalama izleme (bkz. tools/test_izleme.mjs): açık mı, edinilmiş noktalar, süren bekleme, gezinen imlecin oturduğu yol
  __track: () => { const h = penHover && penHover.snap && penHover.snap.trk ? penHover.snap.trk : null; return { on: !!Osnap.opt().otrack, pts: S.track.pts.map(q => ({ p: q.p.slice(), kind: q.kind, dirs: (q.dirs || []).slice(), arcs: (q.arcs || []).map(a => ({ c: a.c.slice(), r: a.r })) })), dwell: dwell ? dwell.key : null, hover: h ? { p: penHover.snap.p.slice(0, 2), cross: !!h.cross, lock: !!h.lock, obj: !!h.obj, n: h.paths.length, ext: h.paths.map(p => !!p.ext), arc: h.paths.map(p => !!p.arc), text: trkText(h) } : null }; },
  __trackAdd: (x, y, kind) => trackToggle([x, y], kind || 'end', true), __trackClear: () => trackClear(),
  __trackBase: () => { const b = trackBase(edCall('lastToolPoint')); return b ? { p: b.p.slice(), dirs: b.dirs.slice(), arcs: b.arcs.map(a => ({ c: a.c.slice(), r: a.r })) } : null; },
  __xattach: (buf, name) => xattachLoad(buf, name), __xrefs: () => (S.scene && S.scene.xrefs ? S.scene.xrefs.map(x => ({ name: x.name, loaded: !!x.loaded, unloaded: !!x.unloaded, attached: !!x.attached, keys: (x.keys || []).length, clip: x.clip ? x.clip.slice() : null, cached: !!x.prims, buf: !!x.buf })) : []), __xclip: (name, rect) => xrefClip(name, rect), __xrefBind: (name) => xrefBind((S.scene.xrefs || []).find(x => x.name === name)),
  __hoverLabel: () => (penHover && penHover.w ? { text: hoverLabel(penHover.snap, penHover.q, penHover.w), base: hoverBase(), ...(function () { const p = penHover.snap ? penHover.snap.p : (penHover.q || penHover.w); const r = hoverReadout(p); return { L: r.L, deg: r.deg }; }()) } : null),
  // Açılış kestirimcisinin sınanabilir parçaları (bkz. tools/test_ilerleme.mjs)
  __band: (v) => bandOf(v), __tahminTaban: (n, mb) => tahminTaban(n, mb),
  __bantBeklenen: (b) => bantBeklenenMs(b), __olcek: () => acilisOlcek(),
  __kestirimBasla: (nesne, mb) => acilisKestirimBasla(nesne, mb),
  display: D, toast, zoomBy, zoomWindow, viewHistory, gotoCoord, fitPrims, savePng, getSettings: () => settings, requestRender, openDisplayOptions, showSettings, showNewDoc,
  docs: Docs, drive: Drive, onGoogle: (ok, json) => Drive.onGoogle(ok, json), onDrive: (id, ok, json) => Drive.onDrive(id, ok, json), onDriveProgress: (id, d, tot) => Drive.onProgress(id, d, tot), openDrive: () => Drive.open(),
  open: Open, openCenter: (tab) => Open.open(tab), onFsRoot: (obj) => Open.onFsRoot(obj), onFs: (id, ok, json) => Open.onFs(id, ok, json),
  // Arşiv çıkarma köprüsünün yanıtı ve ilerlemesi (MainActivity.arcSave)
  onArc: (id, ok, json) => Arsiv.onArc(id, ok, json), onArcProgress: (id, d, tot, ad) => Arsiv.onArcProgress(id, d, tot, ad),
  home: Home, cloud: Cloud, openSample, refreshResume: () => Home.renderResume(), onWebDav: (id, ok, json) => Cloud.onWebDav(id, ok, json), goHome, refreshMenu,
  onWebDavProgress: (id, d, tot) => Cloud.onProgress(id, d, tot),
  edition: () => Ed.tier(), tier: () => Ed.tier(), has: (id) => Ed.has(id), isPro: () => Ed.isPro(), openProPanel: (x) => Ed.openProPanel(x), proInfo: () => Ed.proInfo(), onEdition: (ed, reason) => Ed.onEdition(String(ed || ''), String(reason || '')), onAd: (reason, shown) => Ed.onAd(String(reason || ''), !!shown), __ads: Ed.__ads,
  // sınama kancaları: çok sayfalı PDF kurucusu, metin toplayıcı ve ölçüm dökümü
  __pdf: { build: (pages, wmm, hmm, title) => buildPdf(pages, wmm, hmm, title) },
  __text: { collect: (prims) => collectTexts(prims || S.prims), csvCell },
  __measure: { text: () => measureText(), csv: () => measureCsv() },
  __notes: { add: (n) => addNote(n), clear: () => { notes.items.length = 0; saveNotes(); } },
  __count: { data: (scope) => { const p = countScope(scope || 'all'); return p ? countData(p) : null; }, csv: (scope) => { const p = countScope(scope || 'all'); return p ? countCsv(countData(p), scope || 'all') : ''; } },
  __fr: { scan: (find, rep, opts) => frScan(find, rep, opts || {}), replace: (src, f, r, cs, ww) => replaceIn(src, f, r, cs, ww) },
  action: (a) => menuAction(a) };
ensureStatusChips();
Ed.initEdition({ toast, rebuildToolbar: () => editor.rebuild(), refreshMenu });   // Ücretsiz / Pro: menü, karşılama kartı, Pro paneli, Drive düğmeleri; reklam zamanlayıcısı; onEdition → şerit yeniden kurulur
D.initDisplay({ requestRender, drawOverlay, toast, openDoc, show, hide, buildLayerList, settings, saveSettings, editorTheme, zoomExtents, zoomBy, fitPrims, viewHistory, setLayout, editor, ui: uiPrefs(), basemaps: BASEMAPS, haptic, paylasGorunum, togglePan, panOn, plot: () => showPdf() });
mountNavFabs(vp);
initEditor({ S, requestRender, drawOverlay, toast, noFaces: showNoFaces, pick: (w) => pick(w, TOL.pick / S.view.scale), snap: doSnap, snapPeek: findSnap, fromBase, trackClear, hideObjects, showAllObjects, primVisible, osnap: Osnap, xclip: xrefClip, showInfo, openDoc, hide, show, esc, kv, copyText, buildLayerList, fmt, store, RTree, baseName, zoomExtents, tracePath, worldTransform, strokeWorldRect, worldOrigin,
  action: (a) => { if (a === 'layers') $('btnLayers').click(); else if (a === 'search') $('btnSearch').click(); else if (a === 'more') $('btnMore').click(); else if (a === 'open') Open.open(); else if (a === 'new') showNewDoc(); else menuAction(a); },
  savePng, zoomBy, zoomWindow, togglePan, panOn, viewHistory, gotoCoord, fitPrims, isolateLayers, unisolate, settings, saveSettings, stamp, haptic, openDisplayOptions, setDisplay, getDisplay, toggleDisplay, statusFit, display: D });
$('stScale').addEventListener('click', showScalePicker);
// belgeler (PDF / Word / ZIP / RAR) ve Google Drive
Docs.initDocs({ toast, loadBytes, openDoc, hide, show, esc, kv, goHome, driveAvailable: () => Drive.signedIn(), driveUpload: (d) => { if (d && d.id) Drive.uploadWithPicker({ fileId: d.id, name: d.name, mime: 'application/octet-stream' }); }, driveConvert: (d) => Drive.convertToPdf(d),
  onOpen: () => { closeMenu(); Open.close(); Home.hide(); if (S.notesOn) toggleNotes(false); if (S.mode !== 'view') setMode('view'); cancelZoomWindow(); for (const id of openPanels()) hide(id); dockLayers(); refreshMenu(); },   // belge kipi: çizime ait paneller, ölçü, notlar ve komut çubuğu kapanır
  onClose: () => { refreshMenu(); if (!S.hasDoc) Home.show(); else requestRender(); Home.renderResume(); },   // çizim yoksa ana ekran, varsa şerit ve durum çubuğu geri gelir
  onCadFromArchive: () => { toast(tt('backToArchive', 'Arşive dön') + '?', { ms: 6000, action: { label: tt('backToArchive', 'Arşive dön'), fn: () => Docs.reopenLast() } }); } });
Drive.initDrive({ toast, openDoc, hide, show, esc, kv, hideToast: () => { $('toast').hidden = true; }, openRegistered: (info) => Docs.openRegistered(info), openConverted: (info) => Docs.openConverted(info),
  dxfBytes: () => (editor.dxfBase64 ? editor.dxfBase64(false) : null), pngBytes: () => { savePng(); return lastPng; },
  pickForUpload: (folder) => pickFile('upload:' + folder, '*/*') });
$('btnDrive').addEventListener('click', () => Drive.open());
/*
 * Her ekranda geri ve ana sayfa. Üst çubuktaki Geri, sistem geri tuşuyla AYNI yolu izler
 * (onBack): açık panel / kip / seçim varsa onu kapatır, hiçbiri yoksa ana ekrana döner —
 * dosyayı kapatmadan. Ana sayfa düğmesi doğrudan ana ekrana götürür.
 */
$('btnBack').addEventListener('click', onBackSystem);
$('btnHome').addEventListener('click', goHome);
Open.initOpen({ toast, loadBytes, openBlob: (f) => Docs.openBlob(f), fileForPurpose, onFilePicked, showServer, startQr, openDrive: () => Drive.open(), systemPick, refreshRecent: buildRecent, goHome,
  onOpen: () => { closeMenu(); Drive.close(); hide('docPanel'); } });
Home.initHome({ toast, openDoc, hide, kv, newDoc: showNewDoc, resumeInfo, resumeOpen, openSample, hideToast: () => { $('toast').hidden = true; }, menuAction, editorAct: (a) => edCall('act', a),
  // WebDAV'a cihazdan dosya yükleme (Drive'daki "upload:" yolunun eşi)
  pickForCloud: () => pickFile('wdupload', '*/*'),
  click: (id) => { const b = $(id); if (b) b.click(); }, openProPanel: (x) => Ed.openProPanel(x),
  openCenter: (tab) => Open.open(tab), systemPick, openDrive: () => Drive.open(), showServer, openRegistered: (info) => Docs.openRegistered(info), refreshRecent: buildRecent,
  onShow: () => { closeMenu(); Drive.close(); Open.close(); for (const id of openPanels()) hide(id); if (S.notesOn) toggleNotes(false); if (S.mode !== 'view') setMode('view'); cancelZoomWindow(); refreshMenu(); buildRecent(); },   // Son dosyalar ızgarası her gösterimde tazelenir (tarayıcıda oturum listesi)
  onHide: () => { refreshMenu(); requestRender(); } });
// klavye (odak bir giriş alanında değilken): önce düzenleyici, sonra gezinti
window.addEventListener('keydown', (ev) => {
  const tg = ev.target;
  const yazi = !!(tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable));
  /*
   * Metin alanına yazarken kısayollar susar — ama İŞLEV TUŞLARI susmaz: AutoCAD'de komut
   * satırına yazarken de F8 ortho'yu açar, F3 yakalamayı değiştirir. Ctrl birleşimleri metin
   * alanında tarayıcıya bırakılır (Ctrl+C orada kopyalamadır, bizim komutumuz değil).
   */
  // Esc de her zaman geçer: komut satırına yazarken çalışan aracı iptal etmek AutoCAD'de de
  // tek tuştur. Odak girişteyken Esc tuzağa düşerse kullanıcı aracı bırakamaz.
  if (yazi && !(typeof ev.key === 'string' && (/^F\d{1,2}$/.test(ev.key) || ev.key === 'Escape'))) return;
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
Home.show();   // çizim / belge yokken ana ekran; setScene ve belge açılışı gizler
buildRecent();
/*
 * Marka açılış örtüsü (Android, SplashOverlay): ilk ekran çizildi, yerli taraf örtüyü kaldırabilir.
 * İki kare beklenir ki örtü solarken altında boş bir tuval değil, çizilmiş ana ekran dursun.
 * Köprü yoksa (tarayıcı) ya da eski bir APK'daysa hiçbir şey yapılmaz.
 */
if (A() && typeof A().splashDone === 'function') requestAnimationFrame(() => requestAnimationFrame(() => { try { A().splashDone(); } catch (e) { /* köprü yok */ } }));
/*
 * OTURUM SÜREKLİLİĞİ. Açılışta yalnız GERÇEKTEN bekleyen bir dosya açılır ve neyin beklediğine
 * Java karar verir (getPendingFile): (a) bu açılışta gelen paylaşım / "ile aç" intent'i, (b) render
 * süreci çöktükten sonraki tek seferlik kurtarma, (c) kullanıcı "son oturumu geri yükle" ayarını
 * açtıysa saklanan oturum (o.resume) — bu ayarın varsayılanı KAPALIDIR. Bellekte kalmış ya da
 * durum paketinden geri kurulmuş bir dosya bekleyen sayılmaz; yoksa uygulama her açılışta son
 * çizimi kendiliğinden yükler ve kullanıcı ana ekrana ulaşamazdı. Son oturum normalde ana
 * ekrandaki "kaldığınız yerden devam edin" kartıyla, tek dokunuşla açılır.
 * Geri yükleme başarısız olursa kayıt silinir, bir dahaki açılışta denenmez ve kullanıcı ana
 * ekranda kalır.
 */
if (A() && A().getPendingFile) {
  try {
    const pf = A().getPendingFile();
    if (pf) {
      const o = JSON.parse(pf);
      if (o.resume && A().forgetLastSession) {
        // Geri yükleme denemesi. loadCurrent hatayı kendi içinde yutar (fail), bu yüzden
        // sonuç DURUMDAN okunur: hiçbir şey açılmadıysa kayıt silinir, bir daha denenmez.
        loadCurrent(o.name, o.size).then(() => {
          if (!S.hasDoc && !Docs.isOpen()) { try { A().forgetLastSession(); } catch (e2) { /* köprü yok */ } }
        });
      } else loadCurrent(o.name, o.size);
    }
  } catch (e) { console.warn(e); }
}
setTimeout(() => checkUpdate(false), 4000);
