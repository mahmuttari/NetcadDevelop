/*
 * Google ile giriş ve Google Drive gezgini.
 *
 *  - Kimlik doğrulama ve REST çağrıları Android tarafındadır (GoogleDrive.java); burası yalnız arayüz.
 *  - Köprü: Android.gConfigured(), gSignIn(), gSignOut(), gAccount() → JSON, gDrive(reqId, op, argsJson)
 *    → sonuç window.dwgApp.onDrive(reqId, ok, json); ilerleme onDriveProgress(reqId, done, total);
 *    giriş sonucu onGoogle(ok, json).
 *  - Panel: #drivePanel — hesap satırı, kısayol çipleri (Drive'ım / Paylaşılanlar / Son / Yıldızlı), arama,
 *    kırıntı, liste, "daha fazla", yükleme (geçerli çizim / DXF / PDF), klasör oluşturma, dosya menüsü.
 */
import { S, store, fmt } from './state.js';
import { t } from './i18n.js';
import { kindOf, iconFor } from './docs.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = () => window.Android;
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const FOLDER = 'application/vnd.google-apps.folder';
const GDOC = 'application/vnd.google-apps.';
let api = null;
const pending = new Map(); let reqSeq = 0;
const nav = { folder: 'root', crumbs: [], q: '', pageToken: '', items: [], loading: false };
const fmtSize = (n) => !(n >= 0) ? '' : n < 1024 ? n + ' B' : n < 1048576 ? fmt(n / 1024, 1) + ' KB' : fmt(n / 1048576, 2) + ' MB';

export function initDrive(a) {
  api = a;
  const p = $('drivePanel'); if (!p) return;
  p.addEventListener('click', onClick);
  const inp = $('driveSearch'); if (inp) { let tm = 0; inp.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { nav.q = inp.value.trim(); nav.pageToken = ''; load(); }, 350); }); }
  window.addEventListener('dwg:google', renderAccount);
}
export const available = () => !!(A() && A().gDrive);
export const signedIn = () => { try { return !!(A() && A().gAccount && A().gAccount()); } catch (_) { return false; } };
export function account() { try { const s = A() && A().gAccount ? A().gAccount() : ''; return s ? JSON.parse(s) : null; } catch (_) { return null; } }
export function signIn() {
  if (!A() || !A().gSignIn) { api.toast(tt('driveAndroidOnly', 'Google Drive yalnız Android uygulamasında kullanılabilir.')); return; }
  if (A().gConfigured && !A().gConfigured()) { api.toast(tt('driveNotConfigured', 'Google istemci kimliği bu sürüme henüz işlenmedi.'), { type: 'warn', ms: 5000 }); return; }
  const r = A().gSignIn(); if (r) api.toast(r, { type: 'error' });
}
export function signOut() { if (A() && A().gSignOut) A().gSignOut(); nav.folder = 'root'; nav.crumbs = []; nav.items = []; renderAccount(); renderList(); api.toast(tt('signedOut', 'Oturum kapatıldı')); }
/** Android → giriş sonucu */
export function onGoogle(ok, json) {
  if (ok) { api.toast(tt('signedIn', 'Giriş yapıldı') + ': ' + (json && json.email ? json.email : ''), { type: 'ok' }); renderAccount(); if (!$('drivePanel').hidden) load(); }
  else api.toast(tt('signInFail', 'Giriş başarısız') + ': ' + (typeof json === 'string' ? json : JSON.stringify(json)), { type: 'error', ms: 6000 });
  try { window.dispatchEvent(new CustomEvent('dwg:google', { detail: { ok } })); } catch (_) { /* yok */ }
}
/** Drive işlemi (Promise) */
export function call(op, args = {}, onProgress) {
  return new Promise((resolve, reject) => {
    if (!available()) { reject(new Error(tt('driveAndroidOnly', 'Google Drive yalnız Android uygulamasında kullanılabilir.'))); return; }
    const id = 'r' + (++reqSeq);
    pending.set(id, { resolve, reject, onProgress });
    try { A().gDrive(id, op, JSON.stringify(args)); } catch (e) { pending.delete(id); reject(e); }
  });
}
export function onDrive(reqId, ok, json) {
  const p = pending.get(reqId); if (!p) return; pending.delete(reqId);
  if (ok) p.resolve(json); else p.reject(new Error(typeof json === 'string' ? json : JSON.stringify(json)));
}
export function onProgress(reqId, done, total) { const p = pending.get(reqId); if (p && p.onProgress) p.onProgress(done, total); }

// ---- panel ---------------------------------------------------------------------------
export function open(o = {}) {
  const p = $('drivePanel'); if (!p) return;
  if (o.folder) { nav.folder = o.folder; nav.crumbs = o.crumbs || []; }
  if (o.pick) { nav.pick = o.pick; } else nav.pick = null;
  p.hidden = false;
  renderAccount();
  if (!available()) { $('driveList').innerHTML = `<div class="doc-card"><strong>Google Drive</strong><p>${esc(tt('driveAndroidOnly', 'Google Drive yalnız Android uygulamasında kullanılabilir.'))}</p></div>`; return; }
  if (!signedIn()) { $('driveList').innerHTML = `<div class="doc-card">${ICON('i-map')}<strong>Google Drive</strong><p>${esc(tt('driveIntro', 'Drive\'daki DWG, DXF, PDF, Word ve arşiv dosyalarını açmak, çizimlerinizi ve çıktılarınızı Drive\'a yüklemek için Google hesabınızla giriş yapın.'))}</p><button type="button" class="btn primary" data-drive="signin">${ICON('i-gps')} ${esc(tt('signIn', 'Google ile giriş yap'))}</button></div>`; return; }
  load();
}
export function close() { const p = $('drivePanel'); if (p) p.hidden = true; nav.pick = null; }
function renderAccount() {
  const el = $('driveAccount'); if (!el) return;
  const u = account();
  if (!u) { el.innerHTML = available() ? `<button type="button" class="btn small primary" data-drive="signin">${esc(tt('signIn', 'Google ile giriş yap'))}</button>` : ''; return; }
  el.innerHTML = `${u.picture ? `<img class="avatar" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : ICON('i-gps')}<span class="acc"><b>${esc(u.name || '')}</b><small>${esc(u.email || '')}</small></span><button type="button" class="btn small" data-drive="signout">${esc(tt('signOut', 'Çıkış'))}</button>`;
}
async function load(more) {
  if (!signedIn()) { open(); return; }
  const list = $('driveList');
  if (!more) { nav.pageToken = ''; nav.items = []; list.innerHTML = `<div class="muted">${esc(t('loading'))}</div>`; }
  nav.loading = true; renderCrumbs();
  try {
    const r = await call('list', { folder: nav.folder, q: nav.q, pageToken: nav.pageToken });
    nav.items = more ? nav.items.concat(r.files || []) : (r.files || []);
    nav.pageToken = r.nextPageToken || '';
  } catch (e) { list.innerHTML = `<div class="doc-card"><strong>${esc(tt('driveError', 'Drive hatası'))}</strong><p>${esc(e.message)}</p>${/401|Oturum/.test(e.message) ? `<button type="button" class="btn primary small" data-drive="signin">${esc(tt('signIn', 'Google ile giriş yap'))}</button>` : ''}</div>`; nav.loading = false; return; }
  nav.loading = false;
  renderList();
}
function renderCrumbs() {
  const el = $('driveCrumbs'); if (!el) return;
  const roots = [['root', tt('myDrive', "Drive'ım"), 'i-home'], ['shared', tt('sharedWithMe', 'Paylaşılanlar'), 'i-export'], ['recent', tt('recentDrive', 'Son'), 'i-prev'], ['starred', tt('starred', 'Yıldızlı'), 'i-star']];
  const rootId = nav.crumbs.length ? nav.crumbs[0].root : nav.folder;
  let h = `<div class="chips">${roots.map(r => `<button type="button" class="chip ${rootId === r[0] && !nav.q ? 'on' : ''}" data-drive="root" data-id="${r[0]}">${ICON(r[2])} ${esc(r[1])}</button>`).join('')}</div>`;
  if (nav.crumbs.length) h += `<div class="doc-crumbs">${nav.crumbs.map((c, i) => `${i ? '<span>›</span>' : ''}<button type="button" class="chip" data-drive="crumb" data-i="${i}">${esc(c.name)}</button>`).join('')}</div>`;
  if (nav.q) h += `<div class="muted">${esc(t('search'))}: “${esc(nav.q)}”</div>`;
  el.innerHTML = h;
}
function renderList() {
  const list = $('driveList'); if (!list) return;
  const items = nav.items;
  let h = '';
  if (nav.pick) h += `<div class="doc-card pick"><span>${esc(nav.pick.label || tt('pickFolderHere', 'Bu klasöre yükle'))}</span><button type="button" class="btn primary small" data-drive="pickhere">${esc(tt('uploadHere', 'Buraya yükle'))}</button></div>`;
  if (!items.length) h += `<div class="muted">${esc(t('noResult'))}</div>`;
  h += '<div class="list arc-list">';
  for (const f of items) {
    const isDir = f.mimeType === FOLDER, gdoc = !isDir && f.mimeType && f.mimeType.startsWith(GDOC);
    const meta = [gdoc ? gdocLabel(f.mimeType) : fmtSize(+f.size), f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('tr-TR') : '', f.shared ? tt('shared', 'paylaşılan') : ''].filter(Boolean).join(' · ');
    h += `<div class="item arc-item drive-item" data-id="${esc(f.id)}" data-name="${esc(f.name)}" data-mime="${esc(f.mimeType || '')}" data-size="${esc(f.size || '')}" data-dir="${isDir ? 1 : 0}" data-link="${esc(f.webViewLink || '')}">${isDir ? ICON('i-open') : gdoc ? ICON('i-text') : iconFor(f.name)}<span class="nm">${esc(f.name)}</span><small>${esc(meta)}</small><button type="button" class="lbtn" data-drive="menu" aria-label="${esc(t('more'))}">${ICON('i-more')}</button></div>`;
  }
  h += '</div>';
  if (nav.pageToken) h += `<div class="row"><button type="button" class="btn small" data-drive="more">${esc(tt('loadMore', 'Daha fazla'))}</button></div>`;
  list.innerHTML = h;
}
function gdocLabel(m) { return m.endsWith('document') ? 'Google Dokümanlar' : m.endsWith('spreadsheet') ? 'Google E-Tablolar' : m.endsWith('presentation') ? 'Google Slaytlar' : m.endsWith('shortcut') ? tt('shortcut', 'Kısayol') : 'Google'; }
async function onClick(ev) {
  const b = ev.target.closest('[data-drive]');
  if (b) {
    const k = b.dataset.drive;
    if (k === 'signin') signIn(); else if (k === 'signout') signOut();
    else if (k === 'root') { nav.folder = b.dataset.id; nav.crumbs = []; nav.q = ''; const inp = $('driveSearch'); if (inp) inp.value = ''; load(); }
    else if (k === 'crumb') { const i = +b.dataset.i; const c = nav.crumbs[i]; nav.crumbs = nav.crumbs.slice(0, i + 1); nav.folder = c.id; load(); }
    else if (k === 'more') load(true);
    else if (k === 'upload') uploadMenu();
    else if (k === 'mkdir') { const name = prompt(tt('folderName', 'Klasör adı:'), ''); if (name) { try { await call('mkdir', { name, parent: nav.folder }); api.toast(tt('folderCreated', 'Klasör oluşturuldu'), { type: 'ok' }); load(); } catch (e) { api.toast(e.message, { type: 'error' }); } } }
    else if (k === 'refresh') load();
    else if (k === 'pickhere') { const p = nav.pick; nav.pick = null; if (p && p.fn) p.fn(nav.folder === 'shared' || nav.folder === 'recent' || nav.folder === 'starred' ? 'root' : nav.folder); }
    else if (k === 'menu') { ev.stopPropagation(); fileMenu(b.closest('.drive-item')); }
    return;
  }
  const it = ev.target.closest('.drive-item'); if (!it) return;
  if (it.dataset.dir === '1') { nav.crumbs = nav.crumbs.length ? nav.crumbs.concat([{ id: it.dataset.id, name: it.dataset.name }]) : [{ id: nav.folder, name: rootName(nav.folder), root: nav.folder }, { id: it.dataset.id, name: it.dataset.name }]; nav.folder = it.dataset.id; nav.q = ''; load(); return; }
  openFile(it.dataset);
}
function rootName(id) { return { root: tt('myDrive', "Drive'ım"), shared: tt('sharedWithMe', 'Paylaşılanlar'), recent: tt('recentDrive', 'Son'), starred: tt('starred', 'Yıldızlı') }[id] || id; }
async function openFile(d) {
  const name = d.name, mime = d.mime || '';
  if (mime.endsWith('shortcut')) { api.toast(tt('shortcutNo', 'Kısayollar açılamıyor; hedef dosyayı seçin.')); return; }
  api.toast(tt('downloading', 'İndiriliyor') + ': ' + name, 60000);
  try {
    const info = await call('download', { id: d.id, name, mime, size: +d.size || 0 }, (done, total) => { const el = $('toast'); if (el && !el.hidden) el.querySelector('.tx').textContent = tt('downloading', 'İndiriliyor') + ': ' + name + ' · ' + fmtSize(done) + (total > 0 ? ' / ' + fmtSize(total) : ''); });
    api.hideToast && api.hideToast();
    close();
    await api.openRegistered(info);
    store.set('drive:last', JSON.stringify({ folder: nav.folder, crumbs: nav.crumbs }));
  } catch (e) { api.toast(tt('driveError', 'Drive hatası') + ': ' + e.message, { type: 'error', ms: 6000 }); }
}
function fileMenu(it) {
  if (!it) return;
  const d = it.dataset;
  const html = `<div class="full"><strong>${esc(d.name)}</strong></div><div class="full btns"><button type="button" class="btn small primary" id="dmOpen">${esc(t('open'))}</button><button type="button" class="btn small" id="dmKeep">${esc(tt('docKeep', 'Çevrimdışı sakla'))}</button>${d.link ? `<button type="button" class="btn small" id="dmLink">${esc(tt('openInDrive', "Drive'da aç"))}</button>` : ''}<button type="button" class="btn small" id="dmDel">${esc(t('delete'))}</button></div>`;
  api.openDoc(tt('driveFile', 'Drive dosyası'), html);
  $('dmOpen').onclick = () => { api.hide('docPanel'); openFile(d); };
  $('dmKeep').onclick = async () => { api.hide('docPanel'); try { const info = await call('download', { id: d.id, name: d.name, mime: d.mime, size: +d.size || 0 }); if (A() && A().docKeep) A().docKeep(info.id); api.toast(tt('docKept', 'Çevrimdışı kopya alındı (Sunucudan indir › Çevrimdışı kopyalar)'), { type: 'ok' }); } catch (e) { api.toast(e.message, { type: 'error' }); } };
  if ($('dmLink')) $('dmLink').onclick = () => { api.hide('docPanel'); if (A() && A().openUrl) A().openUrl(d.link); else window.open(d.link, '_blank'); };
  $('dmDel').onclick = async () => { api.hide('docPanel'); if (!confirm(tt('confirmDelete', 'Silinsin mi?') + ' ' + d.name)) return; try { await call('delete', { id: d.id }); api.toast(tt('deleted', 'Silindi')); load(); } catch (e) { api.toast(e.message, { type: 'error' }); } };
}
// ---- yükleme -------------------------------------------------------------------------
function uploadMenu() {
  const has = !!(S && S.hasDoc);
  const html = `<div class="full btns">${has ? `<button type="button" class="btn small primary" id="upCur">${esc(tt('uploadCurrent', 'Geçerli dosyayı yükle'))} (${esc(S.fileName)})</button><button type="button" class="btn small" id="upDxf">${esc(tt('uploadDxf', 'Düzenlenmiş DXF olarak yükle'))}</button><button type="button" class="btn small" id="upPng">${esc(tt('uploadPng', 'Görünümü PNG olarak yükle'))}</button>` : ''}<button type="button" class="btn small" id="upPick">${esc(tt('uploadPick', 'Cihazdan dosya seç ve yükle'))}</button></div><div class="full muted">${esc(tt('uploadTarget', 'Hedef'))}: ${esc(nav.crumbs.length ? nav.crumbs.map(c => c.name).join(' › ') : rootName(nav.folder))}</div>`;
  api.openDoc(tt('driveUpload', "Drive'a yükle"), html);
  const target = () => (nav.folder === 'shared' || nav.folder === 'recent' || nav.folder === 'starred') ? 'root' : nav.folder;
  if ($('upCur')) $('upCur').onclick = () => { api.hide('docPanel'); upload({ src: 'current', name: S.fileName, mime: mimeOf(S.fileName), folder: target() }); };
  if ($('upDxf')) $('upDxf').onclick = () => { api.hide('docPanel'); const d = api.dxfBytes && api.dxfBytes(); if (d) upload({ b64: d.b64, name: d.name, mime: 'application/dxf', folder: target() }); };
  if ($('upPng')) $('upPng').onclick = () => { api.hide('docPanel'); const d = api.pngBytes && api.pngBytes(); if (d) upload({ b64: d.b64, name: d.name, mime: 'image/png', folder: target() }); };
  $('upPick').onclick = () => { api.hide('docPanel'); api.pickForUpload && api.pickForUpload(target()); };
}
function mimeOf(name) { const e = String(name).toLowerCase().split('.').pop(); return { dwg: 'application/acad', dxf: 'application/dxf', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', zip: 'application/zip' }[e] || 'application/octet-stream'; }
/** args: { b64 | src:'current' | fileId, name, mime, folder } */
export async function upload(args) {
  api.toast(tt('uploading', 'Yükleniyor') + ': ' + args.name, 60000);
  try {
    const r = await call('upload', args);
    api.toast(tt('uploaded', "Drive'a yüklendi") + ': ' + (r.name || args.name), { type: 'ok', ms: 5000, action: r.webViewLink ? { label: tt('openInDrive', "Drive'da aç"), fn: () => { if (A() && A().openUrl) A().openUrl(r.webViewLink); } } : undefined });
    if (!$('drivePanel').hidden) load();
    return r;
  } catch (e) { api.toast(tt('uploadFail', 'Yükleme başarısız') + ': ' + e.message, { type: 'error', ms: 6000 }); return null; }
}
/** Klasör seçtirerek yükler */
export function uploadWithPicker(args) {
  const last = store.json('drive:last', null);
  open({ folder: last ? last.folder : 'root', crumbs: last ? last.crumbs : [], pick: { label: tt('pickFolderFor', 'Yükleme hedefi') + ': ' + args.name, fn: (folder) => { close(); upload({ ...args, folder }); } } });
}
/** Ofis belgesini Drive ile PDF'e çevirir ve açar */
export async function convertToPdf(doc) {
  if (!doc || !doc.id) { api.toast(tt('driveAndroidOnly', 'Google Drive yalnız Android uygulamasında kullanılabilir.')); return; }
  if (!signedIn()) { signIn(); return; }
  api.toast(tt('converting', 'PDF\'e dönüştürülüyor') + ': ' + doc.name, 90000);
  try { const info = await call('convertPdf', { fileId: doc.id }); api.hideToast && api.hideToast(); await api.openConverted(info); }
  catch (e) { api.toast(tt('convertFail', 'Dönüştürülemedi') + ': ' + e.message, { type: 'error', ms: 6000 }); }
}
