/*
 * Dosya Aç merkezi: uygulamanın kendi dosya açma arayüzü (#openPanel).
 *
 *  - Sekmeler: Son (son dosyalar + sık kullanılanlar) · Cihaz (kalıcı izinli klasör ağaçları, SAF) · Çevrimdışı (indirme
 *    kopyaları). Sunucu / Google Drive / QR çipleri mevcut araçlara geçer (sunucu dizini, Drive paneli, QR tarayıcı).
 *  - Köprü (Android, MainActivity.Bridge): fsRoots() · fsAddRoot(hint) · fsRemoveRoot(uri) · fsList(reqId, root, docId)
 *    · fsSearch(reqId, root, q) · fsOpen(root, id, name, size) · fsSlot(root, id) · getRecent() · openRecent(uri)
 *    · removeRecent(uri) · listDownloads() · openDownload(id) · deleteDownload(id) · pickFile(purpose, mime) · sdkInt().
 *    Geri çağrılar: window.dwgApp.onFsRoot(obj|null), window.dwgApp.onFs(reqId, ok, json).
 *  - Tarayıcı: aynı arayüz; klasörler <input type=file webkitdirectory> (#folderInput) ile sanal ağaç olarak kurulur,
 *    Son listesi oturum belleğindedir (File nesneleri aynı oturumda yeniden açılır).
 *  - Seçim kipi: open('device', { pick: { purpose, mime } }) — dosyaya dokununca fsSlot → api.onFilePicked(purpose, slotId, name, size);
 *    tarayıcıda api.fileForPurpose(purpose, File).
 */
import { store, fmt } from './state.js';
import { t } from './i18n.js';
import { kindOf, iconFor, isCad } from './docs.js';
import { askConfirm } from './dialog.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = () => window.Android;
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };
const fmtSize = (n) => n == null || !(n >= 0) ? '' : n < 1024 ? n + ' B' : n < 1048576 ? fmt(n / 1024, 0) + ' KB' : fmt(n / 1048576, 2) + ' MB';
const fmtDate = (ms) => ms > 0 ? new Date(ms).toLocaleDateString('tr-TR') : '';
const hasFs = () => !!(A() && A().fsRoots);
/** Android 11+ (API 30) İndirilenler kökünün kendisini ağaç seçiciyle vermez; sürüm bilinmiyorsa açıklama gösterilir */
const dlHint = () => { const a = A(); if (!(a && a.fsRoots)) return ''; let sdk = 30; if (a.sdkInt) { try { sdk = Number(a.sdkInt()); } catch (_) { /* eski köprü */ } } return sdk >= 30 ? tt('openDlHint', 'Android 11 ve üstünde İndirilenler\'in kendisi seçilemez; içindeki bir alt klasörü seçin (Android/data seçilemez).') : ''; };
const TABS = ['recent', 'device', 'offline'];
const KIND_OF = { cad: ['cad'], pdf: ['pdf'], office: ['docx', 'xlsx', 'office', 'text'], archive: ['zip', 'rar'], image: ['image'] };

let api = null;
/** arayüz durumu: sekme, arama, tür süzgeci, sekme başına sıralama, ızgara, seçim kipi, açık satır menüsü */
const ui = { tab: '', q: '', kind: 'all', sort: { recent: 'time', device: 'name', offline: 'time' }, grid: false, pick: null, menu: null };
/** Cihaz sekmesi: kökler, seçili kök, klasör yolu [{id,name}], liste, arama sonucu */
const dev = { roots: [], root: null, path: [], items: [], search: null, loading: false, error: '', seq: 0 };
const pending = new Map(); let reqSeq = 0;
/** tarayıcı: oturum içi son dosyalar ve sanal klasör ağaçları */
const session = { recent: [], vfs: new Map() };   // vfs: rootUri → { name, nodes: Map<id, {id,name,dir,size,time,file,parent}>, children: Map<id, id[]> }
let searchTimer = 0, pressTimer = 0, pressFired = false, suppressClick = false;   // uzun basış menüyü açtıysa parmak kalkınca gelen click (hedefi ne olursa olsun) yutulur

export function initOpen(a) {
  api = a;
  const p = $('openPanel'); if (!p) return;
  p.addEventListener('click', onClick);
  p.addEventListener('contextmenu', (ev) => { const it = ev.target.closest('[data-open-recent]'); if (!it) return; ev.preventDefault(); if (suppressClick) return; clearTimeout(pressTimer); pressTimer = 0; pressFired = true; suppressClick = true; toggleMenu(it.dataset.uri); });
  bindLongPress(p);
  const q = $('openSearch'); if (q) q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { ui.q = q.value.trim(); onQuery(); }, 250); });
  const k = $('openKind'); if (k) k.addEventListener('change', () => { ui.kind = k.value; render(); });
  const s = $('openSort'); if (s) s.addEventListener('change', () => { ui.sort[ui.tab] = s.value; render(); });
  const f = $('folderInput'); if (f) f.addEventListener('change', () => { const files = [...(f.files || [])]; f.value = ''; if (files.length) addBrowserRoot(files); });
}
export const isOpen = () => { const p = $('openPanel'); return !!p && !p.hidden; };
/** open(tab?, { pick: { purpose, mime } }?) */
export function open(tab, opts = {}) {
  const p = $('openPanel'); if (!p) return;
  ui.pick = opts.pick || null; ui.menu = null;
  if (ui.pick) ui.tab = 'device';
  else if (tab && TABS.includes(tab)) ui.tab = tab;
  else if (!ui.tab) ui.tab = recentList().length ? 'recent' : 'device';
  p.hidden = false;
  call(api.onOpen);
  refresh();
}
export function close() { const p = $('openPanel'); if (!p || p.hidden) return false; p.hidden = true; ui.pick = null; ui.menu = null; return true; }
/** geçerli sekmeyi yeniden çizer (Android son dosya listesi değişince de çağrılır) */
export function refresh() { if (!isOpen()) return; if (ui.tab === 'device' && !dev.root) restoreLast(); renderChips(); renderTools(); render(); }
/** Tarayıcı: #fileInput ile açılan dosyayı oturum "Son" listesine yazar */
export function noteFile(file) {
  if (!file || A()) return;
  const key = (file.name + '_' + file.size).replace(/[^\w.-]+/g, '_');
  session.recent = session.recent.filter(r => r.key !== key);
  session.recent.unshift({ uri: 'session:' + key, key, name: file.name, size: file.size, time: Date.now(), file });
  if (session.recent.length > 30) session.recent.length = 30;
}

// ---- köprü geri çağrıları -------------------------------------------------------------
/** fsAddRoot sonucu: {uri,name,time,ok} ya da null (vazgeçildi) */
export function onFsRoot(obj) {
  if (!obj || !obj.uri) return;
  loadRoots();
  const r = dev.roots.find(x => x.uri === obj.uri) || obj;
  selectRoot(r);
}
export function onFs(reqId, ok, json) {
  const p = pending.get(reqId); if (!p) return; pending.delete(reqId);
  if (ok && typeof json === 'string') { try { json = JSON.parse(json); } catch (_) { /* ham dize */ } }
  if (ok) p.resolve(json || {}); else p.reject(new Error(typeof json === 'string' ? json : JSON.stringify(json)));
}
/** fsList / fsSearch (Promise); tarayıcıda sanal ağaçtan yanıtlar */
function fsCall(op, root, arg) {
  return new Promise((resolve, reject) => {
    if (hasFs()) {
      const id = 'f' + (++reqSeq);
      pending.set(id, { resolve, reject });
      try { if (op === 'list') A().fsList(id, root, arg); else A().fsSearch(id, root, arg); } catch (e) { pending.delete(id); reject(e); }
      return;
    }
    try { resolve(op === 'list' ? vfsList(root, arg) : vfsSearch(root, arg)); } catch (e) { reject(e); }
  });
}

// ---- tarayıcı sanal ağacı ------------------------------------------------------------
function addBrowserRoot(files) {
  const first = files[0].webkitRelativePath || files[0].name;
  const top = first.includes('/') ? first.split('/')[0] : tt('openFolder', 'Klasör');
  const uri = 'vfs:' + top + ':' + Date.now();
  const nodes = new Map(), children = new Map([['', []]]);
  for (const f of files) {
    const rel = (f.webkitRelativePath || f.name).split('/'); if (rel.length > 1) rel.shift();
    if (rel.some(s => s.startsWith('.'))) continue;   // gizli girdiler atlanır (Android tarafıyla aynı kural)
    let parent = '';
    for (let i = 0; i < rel.length - 1; i++) {
      const id = (parent ? parent + '/' : '') + rel[i];
      if (!nodes.has(id)) { nodes.set(id, { id, name: rel[i], dir: true, size: 0, time: 0, parent }); children.set(id, []); children.get(parent).push(id); }
      parent = id;
    }
    const id = (parent ? parent + '/' : '') + rel[rel.length - 1];
    nodes.set(id, { id, name: rel[rel.length - 1], dir: false, size: f.size, time: f.lastModified || 0, file: f, parent });
    children.get(parent).push(id);
  }
  session.vfs.set(uri, { name: top, nodes, children });
  dev.roots = [...session.vfs.entries()].map(([u, v]) => ({ uri: u, name: v.name, time: 0, ok: true }));
  selectRoot(dev.roots.find(r => r.uri === uri));
}
const vfsOf = (root) => { const v = session.vfs.get(root); if (!v) throw new Error(tt('openRootGone', 'Erişim izni kaybolmuş')); return v; };
function vfsList(root, docId) {
  const v = vfsOf(root);
  return { items: (v.children.get(docId || '') || []).map(id => { const n = v.nodes.get(id); return { id: n.id, name: n.name, dir: n.dir, size: n.size, time: n.time, mime: '' }; }) };
}
function vfsSearch(root, q) {
  const v = vfsOf(root), ql = q.toLocaleLowerCase('tr'), items = [];
  for (const n of v.nodes.values()) { if (n.dir || !n.name.toLocaleLowerCase('tr').includes(ql)) continue; items.push({ id: n.id, name: n.name, dir: false, size: n.size, time: n.time, mime: '', parent: n.parent }); if (items.length >= 500) break; }
  return { items, truncated: items.length >= 500 };
}
function vfsFile(root, id) { const v = session.vfs.get(root); const n = v && v.nodes.get(id); return n && n.file ? n.file : null; }

// ---- veri --------------------------------------------------------------------------------
function recentList() {
  if (A() && A().getRecent) { try { return JSON.parse(A().getRecent() || '[]'); } catch (_) { return []; } }
  return session.recent.slice();
}
const favs = () => { const f = store.json('open:fav', []); return Array.isArray(f) ? f : []; };
const saveFavs = (f) => store.set('open:fav', JSON.stringify(f));
const isFav = (uri) => favs().some(f => f.uri === uri);
function toggleFav(r) {
  const f = favs(); const i = f.findIndex(x => x.uri === r.uri);
  if (i >= 0) f.splice(i, 1); else f.unshift({ uri: r.uri, name: r.name, size: r.size, key: r.key });
  saveFavs(f);
}
function downloads() {
  if (!(A() && A().listDownloads)) return null;
  try { return JSON.parse(A().listDownloads() || '[]'); } catch (_) { return []; }
}
function loadRoots() {
  if (hasFs()) { try { dev.roots = JSON.parse(A().fsRoots() || '[]'); } catch (_) { dev.roots = []; } }
  else dev.roots = [...session.vfs.entries()].map(([u, v]) => ({ uri: u, name: v.name, time: 0, ok: true }));
  if (dev.root && !dev.roots.some(r => r.uri === dev.root.uri)) { dev.root = null; dev.path = []; dev.items = []; }
}
function restoreLast() {
  loadRoots();
  const last = store.json('open:last', null);
  const r = last && dev.roots.find(x => x.uri === last.root && x.ok !== false);
  if (r) { dev.root = r; dev.path = Array.isArray(last.path) ? last.path : []; loadDir(); }
}
function saveLast() { store.set('open:last', JSON.stringify(dev.root ? { root: dev.root.uri, path: dev.path } : {})); }
const curDocId = () => dev.path.length ? dev.path[dev.path.length - 1].id : '';
function selectRoot(r) {
  if (!r) return;
  dev.root = r; dev.path = []; dev.items = []; dev.search = null; dev.error = '';
  if (r.ok === false) { render(); return; }
  loadDir();
}
async function loadDir() {
  const seq = ++dev.seq;
  dev.loading = true; dev.error = ''; dev.search = null; saveLast(); render();
  try { const r = await fsCall('list', dev.root.uri, curDocId()); if (seq !== dev.seq) return; dev.items = Array.isArray(r.items) ? r.items : []; }
  catch (e) { if (seq !== dev.seq) return; dev.items = []; dev.error = e.message || String(e); }
  dev.loading = false; render();
}
async function runSearch(q) {
  const seq = ++dev.seq;
  dev.loading = true; dev.error = ''; dev.search = { q, items: [], truncated: false }; render();
  try { const r = await fsCall('search', dev.root.uri, q); if (seq !== dev.seq) return; dev.search = { q, items: Array.isArray(r.items) ? r.items : [], truncated: !!r.truncated }; }
  catch (e) { if (seq !== dev.seq) return; dev.search = null; dev.error = e.message || String(e); }
  dev.loading = false; render();
}
function onQuery() {
  if (ui.tab === 'device' && dev.root && dev.root.ok !== false) {
    if (ui.q.length >= 3) { runSearch(ui.q); return; }
    if (dev.search) { dev.search = null; dev.seq++; dev.loading = false; loadDir(); return; }
  }
  render();
}
/** tür süzgeci + ad süzgeci (klasörler süzülmez) */
function passes(name, dir) {
  if (dir) return !ui.q || ui.q.length >= 3 || name.toLocaleLowerCase('tr').includes(ui.q.toLocaleLowerCase('tr'));
  if (ui.kind !== 'all' && !KIND_OF[ui.kind].includes(kindOf(name))) return false;
  if (ui.q && !(ui.tab === 'device' && dev.search) && !name.toLocaleLowerCase('tr').includes(ui.q.toLocaleLowerCase('tr'))) return false;
  return true;
}
function sortItems(list) {
  const s = ui.sort[ui.tab] || 'name';
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'tr');
  return list.sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || (s === 'time' ? (b.time || 0) - (a.time || 0) : s === 'size' ? (b.size || 0) - (a.size || 0) : 0) || byName(a, b));
}

// ---- çizim ---------------------------------------------------------------------------------
function renderChips() {
  const el = $('openChips'); if (!el) return;
  const chips = [['recent', 'i-prev', tt('openTabRecent', 'Son')], ['device', 'i-sdcard', tt('openTabDevice', 'Cihaz')], ['offline', 'i-save', tt('openTabOffline', 'Çevrimdışı')]];
  const go = [['server', 'i-download', tt('openTabServer', 'Sunucu')], ['drive', 'i-drive', t('drive')], ['qr', 'i-qr', 'QR']];
  let h = chips.map(c => `<button type="button" class="chip ${ui.tab === c[0] ? 'on' : ''}" data-open-tab="${c[0]}" ${ui.pick && c[0] !== 'device' ? 'hidden' : ''}>${ICON(c[1])} ${esc(c[2])}</button>`).join('');
  if (!ui.pick) h += go.map(c => `<button type="button" class="chip" data-open-go="${c[0]}">${ICON(c[1])} ${esc(c[2])}</button>`).join('');
  el.innerHTML = h;
}
function renderTools() {
  const g = $('openGrid'); if (g) { g.hidden = ui.tab !== 'recent'; g.classList.toggle('on', ui.grid); g.title = ui.grid ? tt('openList', 'Liste görünümü') : tt('openGrid', 'Izgara görünümü'); g.setAttribute('aria-label', g.title); }
  const s = $('openSort'); if (s) s.value = ui.sort[ui.tab] || 'name';
  const k = $('openKind'); if (k) k.value = ui.kind;
  const q = $('openSearch'); if (q && q.value.trim() !== ui.q) q.value = ui.q;
}
function render() {
  const body = $('openBody'); if (!body || !isOpen()) return;
  let h = '';
  if (ui.pick) h += `<div class="doc-card pick open-pick"><span>${esc(tt('openPickHint', 'Dosyaya dokunarak seçin'))}: <b>${esc(pickLabel(ui.pick.purpose))}</b></span><button type="button" class="btn small" data-open="close">${esc(t('cancel'))}</button></div>`;
  h += ui.tab === 'device' ? renderDevice() : ui.tab === 'offline' ? renderOffline() : renderRecent();
  body.innerHTML = h;
}
function pickLabel(p) { return p === 'compare' ? t('compare') : p.startsWith('xref:') ? t('xrefs') : p.startsWith('img:') ? t('imgMissing') : p.startsWith('upload:') ? t('driveUpload') : t('open'); }
function metaOf(r) { return [fmtSize(r.size), fmtDate(r.time)].filter(Boolean).join(' · '); }
function actsHtml(r, opts) {
  return `<div class="open-acts" data-open-acts="${esc(r.uri)}"><button type="button" class="chip" data-open-act="open">${ICON('i-open')} ${esc(t('open'))}</button><button type="button" class="chip" data-open-act="fav">${ICON('i-star')} ${esc(isFav(r.uri) ? t('favRemove') : t('favAdd'))}</button>${opts && opts.noRemove ? '' : `<button type="button" class="chip" data-open-act="remove">${ICON('i-trash')} ${esc(tt('openRemove', 'Listeden kaldır'))}</button>`}</div>`;
}
function renderRecent() {
  const all = recentList(), fv = favs();
  const byUri = new Map(all.map(r => [r.uri, r]));
  const favRows = fv.map(f => byUri.get(f.uri) || { ...f, time: 0, gone: !byUri.has(f.uri) }).filter(r => passes(r.name, false));
  const favSet = new Set(fv.map(f => f.uri));
  const rows = sortItems(all.filter(r => !favSet.has(r.uri) && passes(r.name, false)).map(r => ({ ...r, dir: false })));
  if (!favRows.length && !rows.length) return `<div class="doc-card">${ICON('i-prev')}<strong>${esc(t('recent'))}</strong><p>${esc(all.length ? t('noResult') : tt('openNoRecent', 'Henüz dosya açılmadı.'))}</p></div>`;
  const thumb = (r) => r.thumb && r.key ? `<img class="open-thumb" src="/file/thumb_${esc(r.key)}?${Number(r.time) || 0}" alt="">` : `<span class="open-thumb noimg">${iconFor(r.name)}</span>`;
  const row = (r, fav) => `<div class="item arc-item open-item${fav ? ' fav' : ''}${r.gone ? ' dim' : ''}" data-open-recent="1" data-uri="${esc(r.uri)}" data-name="${esc(r.name)}">${thumb(r)}<span class="nm">${esc(r.name)}${fav ? ICON('i-star') : ''}<small class="open-meta">${esc(metaOf(r))}</small></span><button type="button" class="lbtn" data-open="menu" aria-label="${esc(t('more'))}">${ICON('i-more')}</button></div>` + (ui.menu === r.uri ? actsHtml(r) : '');
  const tile = (r, fav) => `<div class="open-tile${fav ? ' fav' : ''}${r.gone ? ' dim' : ''}" data-open-recent="1" data-uri="${esc(r.uri)}" data-name="${esc(r.name)}">${thumb(r)}<span class="nm">${esc(r.name)}</span><small class="open-meta">${esc(metaOf(r))}</small>${fav ? ICON('i-star') : ''}<button type="button" class="lbtn" data-open="menu" aria-label="${esc(t('more'))}">${ICON('i-more')}</button></div>`;
  let h = '';
  if (ui.grid) {
    if (favRows.length) h += `<div class="open-sec">${esc(tt('openFavs', 'Sık kullanılanlar'))}</div><div class="open-grid">${favRows.map(r => tile(r, true)).join('')}</div>`;
    if (rows.length) h += `<div class="open-sec">${esc(t('recent'))}</div><div class="open-grid">${rows.map(r => tile(r, false)).join('')}</div>`;
    const m = ui.menu && [...favRows, ...rows].find(r => r.uri === ui.menu); if (m) h += actsHtml(m);
    return h;
  }
  if (favRows.length) h += `<div class="open-sec">${esc(tt('openFavs', 'Sık kullanılanlar'))}</div><div class="list arc-list">${favRows.map(r => row(r, true)).join('')}</div>`;
  if (rows.length) h += `<div class="open-sec">${esc(t('recent'))}</div><div class="list arc-list">${rows.map(r => row(r, false)).join('')}</div>`;
  return h;
}
function renderDevice() {
  const roots = dev.roots;
  let h = '';
  const hint = dlHint();
  const addBtns = `<button type="button" class="chip" data-open="addroot">${ICON('i-folder-add')} ${esc(tt('openAddFolder', 'Klasör ekle'))}</button>` + (hasFs() ? `<button type="button" class="chip" data-open="adddl" title="${esc(hint)}">${ICON('i-download')} ${esc(tt('openAddDownloads', 'İndirilenler\'den klasör ekle'))}</button>` : '');
  if (!roots.length) return `<div class="doc-card">${ICON('i-sdcard')}<strong>${esc(tt('openTabDevice', 'Cihaz'))}</strong><p>${esc(A() ? tt('openNoRoots', 'Bir klasör ekleyin: erişim izni bir kez istenir ve kalıcıdır; klasördeki dosyalar kopyalanmadan buradan açılır.') + (hint ? ' ' + hint : '') : tt('openBrowserFolder', 'Tarayıcıda bir klasör seçin; dosyalar bu oturumda buradan açılır.'))}</p><div class="chips open-roots">${addBtns}</div></div>`;
  h += `<div class="chips open-roots">${roots.map(r => `<button type="button" class="chip ${dev.root && dev.root.uri === r.uri ? 'on' : ''}${r.ok === false ? ' dim' : ''}" data-open-root="${esc(r.uri)}" title="${esc(r.ok === false ? tt('openRootGone', 'Erişim izni kaybolmuş') : r.name)}">${ICON(r.ok === false ? 'i-close' : 'i-open')} ${esc(r.name)}</button>`).join('')}${addBtns}</div>`;
  if (!dev.root) return h + `<div class="muted">${esc(tt('openPickRoot', 'Bir klasör seçin.'))}</div>`;
  if (dev.root.ok === false) return h + `<div class="doc-card">${ICON('i-close')}<strong>${esc(dev.root.name)}</strong><p>${esc(tt('openRootGoneMsg', 'Bu klasörün erişim izni kaybolmuş (cihaz sıfırlama ya da izin kaldırma). Yeniden ekleyerek izni yenileyin.'))}</p><div class="row"><button type="button" class="btn primary small" data-open="addroot">${esc(tt('openRenew', 'İzni yenile'))}</button><button type="button" class="btn small" data-open="removeroot">${esc(tt('openRemoveRoot', 'Klasörü listeden çıkar'))}</button></div></div>`;
  h += `<div class="doc-crumbs open-crumbs"><button type="button" class="chip" data-open-crumb="-1">${ICON('i-open')} ${esc(dev.root.name)}</button>${dev.path.map((c, i) => `<span>›</span><button type="button" class="chip" data-open-crumb="${i}">${esc(c.name)}</button>`).join('')}<span class="sp"></span><button type="button" class="lbtn" data-open="rootmenu" aria-label="${esc(t('more'))}">${ICON('i-more')}</button></div>`;
  if (ui.menu === 'root:' + dev.root.uri) h += `<div class="open-acts"><button type="button" class="chip" data-open="refresh">${ICON('i-turn')} ${esc(t('refresh'))}</button><button type="button" class="chip" data-open="removeroot">${ICON('i-trash')} ${esc(tt('openRemoveRoot', 'Klasörü listeden çıkar'))}</button></div>`;
  if (dev.error) h += `<div class="doc-card"><strong>${esc(t('error'))}</strong><p>${esc(dev.error)}</p><div class="row"><button type="button" class="btn small" data-open="refresh">${esc(t('refresh'))}</button></div></div>`;
  if (dev.loading) return h + `<div class="muted">${esc(dev.search ? tt('openSearching', 'Aranıyor…') : t('loading'))}</div>`;
  const src = dev.search ? dev.search.items : dev.items;
  const list = sortItems(src.filter(it => passes(it.name, it.dir)).map(it => ({ ...it })));
  if (dev.search) h += `<div class="muted">${esc(t('search'))}: “${esc(dev.search.q)}” · ${list.length} ${esc(t('files'))}</div>` + (dev.search.truncated ? `<div class="open-warn">${esc(tt('openTruncated', 'Arama sonuçları kısaltıldı; daha belirgin bir ad yazın.'))}</div>` : '');
  if (!list.length) return h + `<div class="muted">${esc(src.length ? t('noResult') : tt('openEmptyDir', 'Klasör boş'))}</div>`;
  h += '<div class="list arc-list">';
  for (const it of list) {
    const meta = it.dir ? '' : metaOf(it);
    h += `<div class="item arc-item open-item" data-open-entry="1" data-id="${esc(it.id)}" data-name="${esc(it.name)}" data-dir="${it.dir ? 1 : 0}" data-size="${Number(it.size) || 0}">${it.dir ? ICON('i-open') : iconFor(it.name)}<span class="nm">${esc(it.name)}${it.parent ? `<small class="open-meta">${esc(it.parent)}</small>` : ''}</span>${meta ? `<small>${esc(meta)}</small>` : ''}${it.dir ? '<svg class="ic open-chev" aria-hidden="true"><use href="#i-chevron"/></svg>' : ''}</div>`;
  }
  return h + '</div>';
}
function renderOffline() {
  const dl = downloads();
  if (dl === null) return `<div class="doc-card">${ICON('i-save')}<strong>${esc(t('cached'))}</strong><p>${esc(tt('openOfflineAndroid', 'Çevrimdışı kopyalar Android uygulamasında tutulur: sunucudan indirilen paftalar ve "Çevrimdışı sakla" ile alınan belgeler burada listelenir.'))}</p></div>`;
  const list = sortItems(dl.filter(d => passes(d.name, false)).map(d => ({ ...d, dir: false })));
  if (!list.length) return `<div class="doc-card">${ICON('i-save')}<strong>${esc(t('cached'))}</strong><p>${esc(dl.length ? t('noResult') : tt('openNoOffline', 'Çevrimdışı kopya yok.'))}</p></div>`;
  return `<div class="list arc-list">${list.map(d => `<div class="item arc-item open-item" data-open-dl="${esc(d.id)}" data-name="${esc(d.name)}">${iconFor(d.name)}<span class="nm">${esc(d.name)}<small class="open-meta">${esc(metaOf(d))}</small></span><button type="button" class="lbtn" data-open="deldl" aria-label="${esc(t('delete'))}">${ICON('i-trash')}</button></div>`).join('')}</div>`;
}

// ---- etkileşim ---------------------------------------------------------------------------
function toggleMenu(uri) { ui.menu = ui.menu === uri ? null : uri; render(); }
async function onClick(ev) {
  // Uzun basış menüyü açınca alt sayfa büyür ve içerik parmağın altında kayar: bırakınca gelen click artık başka bir öğeye
  // (eylem çipi, komşu satır) iner; bu yüzden hedefe bakılmadan yutulur.
  if (suppressClick) { suppressClick = false; ev.stopPropagation(); return; }
  const b = ev.target.closest('[data-open], [data-open-tab], [data-open-go], [data-open-root], [data-open-crumb], [data-open-act]');
  if (b) {
    ev.stopPropagation();
    if (b.dataset.openTab) { ui.tab = b.dataset.openTab; ui.menu = null; if (ui.tab === 'device') { loadRoots(); if (!dev.root) restoreLast(); } renderChips(); renderTools(); render(); return; }
    if (b.dataset.openGo) { const g = b.dataset.openGo; close(); if (g === 'drive') call(api.openDrive); else if (g === 'server') call(api.showServer); else if (g === 'qr') call(api.startQr); return; }
    if (b.dataset.openRoot) { selectRoot(dev.roots.find(r => r.uri === b.dataset.openRoot)); return; }
    if (b.dataset.openCrumb != null) { const i = Number(b.dataset.openCrumb); dev.path = dev.path.slice(0, i + 1); ui.q = ''; renderTools(); loadDir(); return; }
    if (b.dataset.openAct) { const acts = b.closest('[data-open-acts]'); const uri = acts ? acts.dataset.openActs : ui.menu; recentAction(b.dataset.openAct, uri); return; }
    const k = b.dataset.open;
    if (k === 'close') close();
    else if (k === 'system') { const p = ui.pick; close(); call(api.systemPick, p ? p.purpose : 'open', p ? p.mime : '*/*'); }
    else if (k === 'grid') { ui.grid = !ui.grid; renderTools(); render(); }
    else if (k === 'menu') { const it = b.closest('[data-open-recent]'); if (it) toggleMenu(it.dataset.uri); }
    else if (k === 'rootmenu') { toggleMenu(dev.root ? 'root:' + dev.root.uri : null); }
    else if (k === 'addroot' || k === 'adddl') { if (hasFs()) A().fsAddRoot(k === 'adddl' ? 'download' : ''); else { const f = $('folderInput'); if (f) f.click(); } }
    else if (k === 'removeroot') { if (dev.root) removeRoot(dev.root); }
    else if (k === 'refresh') { ui.menu = null; if (dev.root) loadDir(); }
    else if (k === 'deldl') { const it = b.closest('[data-open-dl]'); if (it && await askConfirm(tt('confirmDelete', 'Silinsin mi?') + ' ' + it.dataset.name)) { if (A() && A().deleteDownload) A().deleteDownload(it.dataset.openDl); render(); } }
    return;
  }
  const rec = ev.target.closest('[data-open-recent]'); if (rec) { openRecent(rec.dataset.uri); return; }
  const dl = ev.target.closest('[data-open-dl]'); if (dl) { close(); if (A() && A().openDownload) A().openDownload(dl.dataset.openDl); return; }
  const it = ev.target.closest('[data-open-entry]'); if (it) { onEntry(it.dataset); }
}
function removeRoot(r) {
  if (hasFs()) { try { A().fsRemoveRoot(r.uri); } catch (e) { console.warn(e); } }
  else session.vfs.delete(r.uri);
  ui.menu = null; dev.root = null; dev.path = []; dev.items = []; dev.search = null; saveLast(); loadRoots(); render();
}
function onEntry(d) {
  if (d.dir === '1') {
    if (dev.search) { dev.search = null; }
    dev.path = dev.path.concat([{ id: d.id, name: d.name }]); ui.q = ''; renderTools(); loadDir(); return;
  }
  const root = dev.root.uri, size = Number(d.size) || 0;
  if (ui.pick) {
    const p = ui.pick; close();
    if (hasFs()) { let slot = ''; try { slot = A().fsSlot(root, d.id) || ''; } catch (e) { api.toast(String(e.message || e), { type: 'error' }); return; } call(api.onFilePicked, p.purpose, slot, d.name, size); }
    else { const f = vfsFile(root, d.id); if (f) call(api.fileForPurpose, p.purpose, f); }
    return;
  }
  close();
  if (hasFs()) { try { A().fsOpen(root, d.id, d.name, size); } catch (e) { api.toast(String(e.message || e), { type: 'error' }); } return; }
  const f = vfsFile(root, d.id); if (f) openBrowserFile(f);
}
async function openBrowserFile(f) {
  noteFile(f);
  try { if (isCad(f.name) || kindOf(f.name) === 'other') await api.loadBytes(await f.arrayBuffer(), f.name, f.size); else await api.openBlob(f); } catch (e) { api.toast(t('error') + ': ' + (e.message || e), { type: 'error' }); }
}
function openRecent(uri) {
  if (ui.pick) return;
  // sık kullanılan Son listesinden düşmüş olabilir (RECENT_MAX): Android'de URI yaşadığı sürece açılır — geçersiz URI'yi
  // Java tarafı (Bridge.openRecent) kendisi yakalayıp listeyi yeniler; "artık yok" yalnız tarayıcı yolunda (File nesnesi gitmiş) söylenir
  const r = recentList().find(x => x.uri === uri) || favs().find(x => x.uri === uri);
  if (r && A() && A().openRecent) { close(); A().openRecent(uri); return; }
  if (!r || !r.file) { api.toast(tt('openRecentGone', 'Bu dosya bu oturumda artık yok.'), { type: 'warn' }); return; }
  close();
  openBrowserFile(r.file);
}
function recentAction(act, uri) {
  ui.menu = null;
  if (!uri) { render(); return; }
  if (act === 'open') { openRecent(uri); return; }
  const r = recentList().find(x => x.uri === uri) || favs().find(x => x.uri === uri);
  if (act === 'fav' && r) toggleFav(r);
  else if (act === 'remove') {
    if (A() && A().removeRecent) { try { A().removeRecent(uri); } catch (e) { console.warn(e); } }
    else session.recent = session.recent.filter(x => x.uri !== uri);
    const f = favs().filter(x => x.uri !== uri); saveFavs(f);
    call(api.refreshRecent);
  }
  render();
}
/** satıra uzun basış → aynı menü (Android'de contextmenu olayı güvenilir değil) */
function bindLongPress(p) {
  p.addEventListener('pointerdown', (ev) => {
    suppressClick = false; pressFired = false;   // yeni dokunuş: önceki uzun basışın bayrağı (click hiç gelmediyse) temizlenir
    const it = ev.target.closest('[data-open-recent]'); if (!it || ev.target.closest('button')) return;
    const x0 = ev.clientX, y0 = ev.clientY, uri = it.dataset.uri;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { pressTimer = 0; pressFired = true; suppressClick = true; toggleMenu(uri); }, 500);
    const off = () => { it.removeEventListener('pointermove', cancel); it.removeEventListener('pointerup', cancel); it.removeEventListener('pointercancel', cancel); };
    const cancel = (e) => {
      if (e.type === 'pointermove' && Math.hypot(e.clientX - x0, e.clientY - y0) < 8) return;
      clearTimeout(pressTimer); pressTimer = 0; off();
      if (pressFired && e.type !== 'pointermove') setTimeout(() => { suppressClick = false; }, 400);   // bırakıştan sonra click gelmezse bayrak asılı kalmaz
    };
    it.addEventListener('pointermove', cancel); it.addEventListener('pointerup', cancel); it.addEventListener('pointercancel', cancel);
  });
}
