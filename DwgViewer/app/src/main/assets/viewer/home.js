/*
 * Ana ekran (#home): çizim ya da belge açık DEĞİLKEN #main'i kaplar; alt gezinme (#homeNav) dört bölüm sunar.
 *
 *  - Ev: uygulama adı, "Dosya aç" (Dosya Aç merkezi), Son dosyalar ızgarası (#recentList, en çok 8, "Tümü…" → merkez Son),
 *    hızlı işlemler (QR · Sunucu · Google Drive), ücretsizde Pro tanıtım satırı (#proLine).
 *  - Dosya: Yerel | Bulut sekmeleri. Yerel: open.js'in Cihaz görünümü gömülür (Open.mount) + sistem seçici + Çevrimdışı.
 *    Bulut: cloud.js hizmet kartları (Google Drive · WebDAV / Nextcloud · Sunucu dizini).
 *  - Bulut: oturum açılmış hizmetlerin gezgini (cloud.js renderExplorer).
 *  - Araçlar: 4 sütun ızgara; tanımlar tek listede (TOOLS: id, icon, i18n, pro, needsDoc, run). Ücretsizde Pro araçlar PRO rozeti
 *    taşır ve Pro panelini açar; çizim gerektiren araçlar belge yokken "Önce bir çizim açın" der.
 *  - show(): body.homemode (üst çubuk, şerit, durum çubuğu gizli — başlık ana ekranın içindedir); hide(): eski düzen döner.
 *    Seçili bölüm store('home:tab') ile hatırlanır. Geri tuşu: sekme Ev değilse Ev'e (true), Ev'deyse false (uygulama kapanır).
 */
import { S, store } from './state.js';
import { t } from './i18n.js';
import * as Open from './open.js';
import * as Cloud from './cloud.js';
import { isPro, PRO_ONLY } from './edition.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };
const TABS = ['ev', 'files', 'cloud', 'tools'];
let api = null;
const ui = { tab: 'ev', fseg: 'local', shown: false };

/** Araç tanımları: run(api) — menü eylemi, şerit eylemi ya da üst çubuk düğmesi */
export const TOOLS = [
  { id: 'pdf', icon: 'i-pdf', i18n: 'toolPdf', pro: true, needsDoc: true, run: (a) => a.menuAction('pdf') },
  { id: 'png', icon: 'i-image', i18n: 'toolPng', needsDoc: true, run: (a) => a.menuAction('png') },
  { id: 'savedxf', icon: 'i-save', i18n: 'toolDxf', pro: true, needsDoc: true, run: (a) => a.editorAct('savedxf') },
  { id: 'savedelta', icon: 'i-export', i18n: 'toolDelta', pro: true, needsDoc: true, run: (a) => a.editorAct('savedelta') },
  { id: 'compare', icon: 'i-compare', i18n: 'toolCompare', pro: true, needsDoc: true, run: (a) => a.menuAction('compare') },
  { id: 'profile', icon: 'i-profile', i18n: 'toolProfile', pro: true, needsDoc: true, run: (a) => a.menuAction('profile') },
  { id: 'notes', icon: 'i-pen', i18n: 'toolNotes', pro: true, needsDoc: true, run: (a) => a.menuAction('notes') },
  { id: 'measure', icon: 'i-dist', i18n: 'measure', needsDoc: true, run: (a) => a.click('btnMeasure') },
  { id: 'layers', icon: 'i-layers', i18n: 'layers', needsDoc: true, run: (a) => a.click('btnLayers') },
  { id: 'search', icon: 'i-search', i18n: 'search', needsDoc: true, run: (a) => a.click('btnSearch') },
  { id: 'gps', icon: 'i-gps', i18n: 'gps', run: (a) => a.menuAction('gps') },
  { id: 'basemap', icon: 'i-map', i18n: 'basemap', run: (a) => a.menuAction('basemap') },
  { id: 'views', icon: 'i-bookmark', i18n: 'toolViews', needsDoc: true, run: (a) => a.menuAction('views') },
  { id: 'qr', icon: 'i-qr', i18n: 'qr', run: (a) => a.menuAction('qr') },
  { id: 'server', icon: 'i-download', i18n: 'server', run: (a) => a.menuAction('server') },
  { id: 'drive', icon: 'i-drive', i18n: 'drive', run: (a) => a.menuAction('drive') },
  { id: 'settings', icon: 'i-props', i18n: 'settings', run: (a) => a.menuAction('settings') },
  { id: 'about', icon: 'i-info', i18n: 'about', run: (a) => a.menuAction('about') },
  { id: 'pro', icon: 'i-star', i18n: 'editionPro', run: (a) => a.openProPanel() },
];

export function initHome(a) {
  api = a;
  const home = $('home'); if (!home) return;
  const saved = store.get('home:tab'); if (TABS.includes(saved)) ui.tab = saved;
  const nav = $('homeNav'); if (nav) nav.addEventListener('click', (ev) => { const b = ev.target.closest('[data-home-tab]'); if (b) setTab(b.dataset.homeTab); });
  const seg = $('filesSeg'); if (seg) seg.addEventListener('click', (ev) => { const b = ev.target.closest('[data-fseg]'); if (b) setFilesSeg(b.dataset.fseg); });
  home.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-home]'); if (!b) return;
    if (b.dataset.home === 'system') call(api.systemPick, 'open', '*/*');
    else if (b.dataset.home === 'offline') call(api.openCenter, 'offline');
  });
  const grid = $('toolsGrid'); if (grid) grid.addEventListener('click', (ev) => { const b = ev.target.closest('[data-tool]'); if (b) runTool(b.dataset.tool); });
  Cloud.initCloud({ toast: api.toast, openDoc: api.openDoc, hide: api.hide, kv: api.kv, hideToast: api.hideToast, openDrive: api.openDrive, showServer: api.showServer, openRegistered: api.openRegistered,
    gotoCloud: () => { if (ui.shown) setTab('cloud'); }, gotoFilesCloud: () => { setTab('files'); setFilesSeg('cloud'); } });
  window.addEventListener('dwg:edition', () => { if (ui.shown) renderTools(); });
  window.addEventListener('dwg:google', () => { if (ui.shown) Cloud.refresh(); });
  window.addEventListener('dwg:lang', () => { if (ui.shown) { renderTools(); Cloud.refresh(); Open.refresh(); } });   // gömülü Cihaz gezgini de (arama yer tutucusu dâhil)
}
export const isShown = () => ui.shown;
export const tab = () => ui.tab;
/** Ana ekranı gösterir: body.homemode; çizim varsa bellekte kalır (S.hasDoc korunur) */
export function show() {
  const home = $('home'); if (!home) return;
  ui.shown = true;
  home.hidden = false; document.body.classList.add('homemode');
  call(api.onShow);
  setTab(ui.tab, true);
}
export function hide() {
  const home = $('home'); if (!home) return;
  if (ui.shown) Open.unmount();
  ui.shown = false;
  home.hidden = true; document.body.classList.remove('homemode');
  call(api.onHide);
}
/** Geri tuşu: Ev değilse Ev'e döner (true); Ev'deyse false */
export function back() { if (!ui.shown) return false; if (ui.tab !== 'ev') { setTab('ev'); return true; } return false; }
export function setTab(id, force) {
  if (!TABS.includes(id)) id = 'ev';
  if (ui.tab === id && !force && ui.shown && !$('home').hidden) { renderTab(id); return; }
  ui.tab = id; store.set('home:tab', id);
  document.querySelectorAll('#homeNav [data-home-tab]').forEach(b => b.classList.toggle('on', b.dataset.homeTab === id));
  document.querySelectorAll('#home .home-page').forEach(p => { p.hidden = p.dataset.page !== id; });
  const pages = $('home').querySelector('.home-pages'); if (pages) pages.scrollTop = 0;
  renderTab(id);
}
function renderTab(id) {
  if (id === 'ev') renderHome();
  else if (id === 'files') renderFiles();
  else if (id === 'cloud') renderCloud();
  else if (id === 'tools') renderTools();
}
export function renderHome() { call(api.refreshRecent); }
export function renderFiles() {
  setFilesSeg(ui.fseg, true);
}
function setFilesSeg(seg, force) {
  seg = seg === 'cloud' ? 'cloud' : 'local';
  if (ui.fseg === seg && !force) return;
  ui.fseg = seg;
  document.querySelectorAll('#filesSeg [data-fseg]').forEach(b => b.classList.toggle('on', b.dataset.fseg === seg));
  const loc = $('filesLocal'), cl = $('filesCloud');
  if (loc) loc.hidden = seg !== 'local'; if (cl) cl.hidden = seg !== 'cloud';
  if (seg === 'local') { const host = $('filesDevice'); if (host) Open.mount(host, 'device'); }
  else Cloud.renderServices($('filesCloud'));
}
export function renderCloud() { Cloud.renderExplorer($('cloudBody')); }
export function renderTools() {
  const grid = $('toolsGrid'); if (!grid) return;
  const pro = isPro();
  grid.innerHTML = TOOLS.filter(x => !(x.id === 'pro' && pro)).map((x, i) => {
    const locked = !!x.pro && !pro, dim = !!x.needsDoc && !(S && S.hasDoc);
    return `<button type="button" class="tool${dim ? ' dim' : ''}" data-tool="${x.id}" data-pro="${locked ? 1 : 0}" aria-label="${esc(t(x.i18n))}"><span class="tool-ic tool-c${(i % 8) + 1}">${ICON(x.icon)}</span><span class="lb">${esc(t(x.i18n))}</span>${locked ? `<span class="pro-badge">${esc(tt('proBadge', 'PRO'))}</span>` : ''}</button>`;
  }).join('');
}
function runTool(id) {
  const x = TOOLS.find(y => y.id === id); if (!x) return;
  if (x.pro && !isPro()) { call(api.openProPanel); return; }   // ana ekran tanıtım yüzeyidir: Pro aracı Pro panelini açar
  if (x.needsDoc && !(S && S.hasDoc)) { call(api.toast, t('openFirst')); return; }
  if (x.needsDoc) hide();   // çizim bellekte: araç çizim üzerinde çalışır
  call(x.run, api);
}
/** PRO_ONLY ile tutarlılık denetimi (sınama): pro işaretli araçlar PRO_ONLY'de olmalı */
export const proToolIds = () => TOOLS.filter(x => x.pro).map(x => x.id).filter(id => PRO_ONLY.has(id));
