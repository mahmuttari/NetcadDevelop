/*
 * Bulut hizmetleri (ana ekran Dosya › Bulut ve Bulut sekmesi): Google Drive, WebDAV / Nextcloud, sunucu dizini.
 *
 *  - Hizmet kartları: simge + ad + sağda durum düğmesi ("Oturum aç" / hesap + "Aç" / "Çıkış").
 *  - WebDAV köprüsü (Android, MainActivity.Bridge; GoogleDrive'daki gDrive → onDrive kalıbının aynısı):
 *      wdAccounts() → JSON [{id,name,url,user}] (parola dönmez) · wdSave(json {id?,name,url,user,pass}) → id, hatada "" · wdRemove(id)
 *      wd(reqId, op, argsJson) → sonuç window.dwgApp.onWebDav(reqId, ok, json)
 *      op: "list" {id, path} → {items:[{name,path,dir,size,time,mime}]} · "download" {id, path, name} → docs.info {id,name,size,ext}
 *          · "test" {url,user,pass} → {ok:true}
 *  - Tarayıcıda köprü yokken WebDAV kartı yalnız açıklama gösterir (Android uygulamasında).
 *  - Dropbox / OneDrive / Box listelenmez: geliştirici uygulaması kaydı gerektirir (README).
 */
import { t } from './i18n.js';
import { S, fmt } from './state.js';
import { kindOf, iconFor } from './docs.js';
import * as Drive from './drive.js';
import { askConfirm, askText, askForm } from './dialog.js';
import { gate, lockAttr } from './edition.js';
import { skelList, emptyBox } from './skel.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = () => window.Android;
const ICON = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn(e); return undefined; } };
const fmtSize = (n) => !(n >= 0) ? '' : n < 1024 ? n + ' B' : n < 1048576 ? fmt(n / 1024, 1) + ' KB' : fmt(n / 1048576, 2) + ' MB';
let api = null;
const pending = new Map(); let reqSeq = 0;
/** WebDAV gezgini durumu: seçili hesap, yol, liste */
const nav = { acc: null, path: '/', items: [], loading: false, error: '' };
let hosts = { services: null, explorer: null };

export function initCloud(a) { api = a; }
export const wdAvailable = () => !!(A() && typeof A().wd === 'function' && typeof A().wdAccounts === 'function');
/** Kayıtlı WebDAV hesapları [{id,name,url,user}] */
export function wdAccounts() {
  if (!wdAvailable()) return [];
  try { const r = JSON.parse(A().wdAccounts() || '[]'); return Array.isArray(r) ? r : []; } catch (_) { return []; }
}
/** WebDAV işlemi (Promise) */
export function wd(op, args = {}, onProgress) {
  return new Promise((resolve, reject) => {
    if (!wdAvailable()) { reject(new Error(tt('webdavAndroidOnly', 'WebDAV yalnız Android uygulamasında kullanılabilir.'))); return; }
    const id = 'w' + (++reqSeq);
    pending.set(id, { resolve, reject, onProgress });
    try { A().wd(id, op, JSON.stringify(args)); } catch (e) { pending.delete(id); reject(e); }
  });
}
/** Android → ilerleme (indirme ve yükleme; Java tarafı reqId ile çağırır) */
export function onProgress(reqId, done, total) {
  const p = pending.get(reqId);
  if (p && p.onProgress) { try { p.onProgress(done, total); } catch (_) { /* geç */ } }
}
/** Android → sonuç */
export function onWebDav(reqId, ok, json) {
  const p = pending.get(reqId); if (!p) return; pending.delete(reqId);
  if (ok && typeof json === 'string') { try { json = JSON.parse(json); } catch (_) { /* ham dize */ } }
  if (ok) p.resolve(json || {}); else p.reject(new Error(typeof json === 'string' ? json : (json && json.error) || JSON.stringify(json)));
}
/** Oturum açılmış hizmet var mı (Bulut sekmesi) */
export const anySignedIn = () => Drive.signedIn() || wdAccounts().length > 0;

// ---------------------------------------------------------------------------------
// Hizmet kartları (Dosya › Bulut)
// ---------------------------------------------------------------------------------
function card(icon, cls, name, sub, acts, attrs = '') {
  return `<div class="cloud-card" ${attrs}><span class="cloud-ic ${cls}">${ICON(icon)}</span><span class="cloud-nm"><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="cloud-acts">${acts}</span></div>`;
}
export function renderServices(host) {
  if (host) hosts.services = host;
  const el = hosts.services; if (!el) return;
  let h = '<div class="cloud-list">';
  // Google Drive
  {
    const u = Drive.account();
    const acts = u ? `<button type="button" class="btn link" data-cloud="drive-open">${esc(t('open'))}</button><button type="button" class="btn icon link" data-cloud="drive-out" title="${esc(tt('signOut', 'Çıkış'))}" aria-label="${esc(tt('signOut', 'Çıkış'))}">${ICON('i-close')}</button>`
      : `<button type="button" class="btn link" data-cloud="drive-in">${esc(tt('signInShort', 'Oturum aç'))}</button>`;
    h += card('i-drive', 'tool-c1', t('drive'), u ? (u.email || u.name || tt('signedInAs', 'Oturum açık')) : '', acts, 'data-cloud-svc="drive"');
  }
  // WebDAV / Nextcloud: kayıtlı hesaplar + hesap ekle
  {
    const accs = wdAccounts();
    for (const a of accs) h += card('i-link', 'tool-c7', a.name || a.url, (a.user ? a.user + ' · ' : '') + a.url, `<button type="button" class="btn link" data-cloud="wd-open" data-id="${esc(a.id)}">${esc(t('open'))}</button><button type="button" class="btn icon link" data-cloud="wd-remove" data-id="${esc(a.id)}" title="${esc(tt('webdavRemove', 'Hesabı kaldır'))}" aria-label="${esc(tt('webdavRemove', 'Hesabı kaldır'))}">${ICON('i-close')}</button>`, `data-cloud-svc="webdav" data-wd-id="${esc(a.id)}"`);
    h += card('i-link', 'tool-c7', tt('webdav', 'WebDAV / Nextcloud'), accs.length ? '' : (wdAvailable() ? '' : tt('webdavAndroidOnly', 'WebDAV yalnız Android uygulamasında kullanılabilir.')), `<button type="button" class="btn link" data-cloud="wd-add">${esc(accs.length ? tt('webdavAdd', 'Hesap ekle') : tt('signInShort', 'Oturum aç'))}</button>`, 'data-cloud-svc="webdav-add"');
  }
  // Sunucu dizini (paftalar.json)
  h += card('i-download', 'tool-c8', tt('serverDir', 'Sunucu dizini'), tt('serverDirSub', 'paftalar.json ya da dizin listesi'), `<button type="button" class="btn link" data-cloud="server">${esc(t('open'))}</button>`, 'data-cloud-svc="server"');
  h += '</div>';
  el.innerHTML = h;
  if (!el.dataset.cloudBound) { el.dataset.cloudBound = '1'; el.addEventListener('click', onServiceClick); }
}
async function onServiceClick(ev) {
  const b = ev.target.closest('[data-cloud]'); if (!b) return;
  ev.stopPropagation();
  const k = b.dataset.cloud;
  if (k === 'drive-in') { Drive.signIn(); return; }
  if (k === 'drive-out') { Drive.signOut(); renderServices(); renderExplorer(); return; }
  if (k === 'drive-open') { call(api.openDrive); return; }
  if (k === 'server') { call(api.showServer); return; }
  if (k === 'wd-add') { if (!wdAvailable()) { api.toast(tt('webdavAndroidOnly', 'WebDAV yalnız Android uygulamasında kullanılabilir.'), { type: 'warn', ms: 4000 }); return; } openForm(null); return; }
  if (k === 'wd-open') { const a = wdAccounts().find(x => x.id === b.dataset.id); if (a) { call(api.gotoCloud); openAccount(a); } return; }
  if (k === 'wd-remove') {
    const a = wdAccounts().find(x => x.id === b.dataset.id); if (!a) return;
    if (!(await askConfirm(tt('webdavRemove', 'Hesabı kaldır') + ': ' + (a.name || a.url) + '?'))) return;
    try { A().wdRemove(a.id); } catch (e) { api.toast(String(e.message || e), { type: 'error' }); }
    if (nav.acc && nav.acc.id === a.id) { nav.acc = null; nav.items = []; }
    renderServices(); renderExplorer();
  }
}

// ---------------------------------------------------------------------------------
// WebDAV hesap formu (#wdForm, genel amaçlı belge panelinde)
// ---------------------------------------------------------------------------------
export function openForm(acc) {
  const a = acc || { id: '', name: '', url: '', user: '' };
  const html = `<div class="full" id="wdForm"></div>` + api.kv([
    [tt('webdavName', 'Görünen ad'), `<input id="wdName" type="text" value="${esc(a.name)}" placeholder="Nextcloud" autocomplete="off">`, 1],
    [tt('webdavUrl', 'Sunucu adresi'), `<input id="wdUrl" type="url" value="${esc(a.url)}" placeholder="${esc(tt('webdavUrlHint', 'https://…/remote.php/dav/files/kullanici/'))}" autocomplete="off" inputmode="url">`, 1],
    [tt('webdavUser', 'Kullanıcı adı'), `<input id="wdUser" type="text" value="${esc(a.user)}" autocomplete="username">`, 1],
    [tt('webdavPass', 'Parola'), `<input id="wdPass" type="password" value="" autocomplete="current-password">`, 1],
    [`<div class="full btns"><button type="button" class="btn small" id="wdTest">${esc(tt('webdavTest', 'Bağlantıyı sına'))}</button><button type="button" class="btn primary small" id="wdSave">${esc(t('save'))}</button><button type="button" class="btn small" id="wdCancel">${esc(t('cancel'))}</button></div>`]]);
  api.openDoc(tt('webdav', 'WebDAV / Nextcloud'), html);
  const read = () => ({ id: a.id || undefined, name: $('wdName').value.trim(), url: $('wdUrl').value.trim(), user: $('wdUser').value.trim(), pass: $('wdPass').value });
  const valid = (v) => { if (!v.url || !v.user) { api.toast(tt('webdavNeedUrl', 'Sunucu adresi ve kullanıcı adı gerekli'), { type: 'warn' }); return false; } return true; };
  $('wdCancel').onclick = () => api.hide('docPanel');
  $('wdTest').onclick = async () => {
    const v = read(); if (!valid(v)) return;
    api.toast(tt('webdavTest', 'Bağlantıyı sına') + '…', 30000);
    try { const r = await wd('test', { url: v.url, user: v.user, pass: v.pass }); api.toast(r && r.ok === false ? tt('webdavFail', 'WebDAV bağlantısı kurulamadı') : tt('webdavOk', 'Bağlantı başarılı'), { type: r && r.ok === false ? 'error' : 'ok' }); }
    catch (e) { api.toast(tt('webdavFail', 'WebDAV bağlantısı kurulamadı') + ': ' + e.message, { type: 'error', ms: 6000 }); }
  };
  $('wdSave').onclick = () => {
    const v = read(); if (!valid(v)) return;
    if (!v.name) v.name = v.url.replace(/^https?:\/\//, '').split('/')[0];
    // Köprü hesap id'sini döner; hatada "" (Java iletisini Toast ile zaten göstermiştir): form açık kalır, başarı bildirilmez
    let id = '';
    try { id = A().wdSave(JSON.stringify(v)); } catch (e) { api.toast(String(e.message || e), { type: 'error' }); return; }
    if (!id) { api.toast(tt('webdavSaveFail', 'WebDAV hesabı kaydedilemedi'), { type: 'error', ms: 5000 }); return; }
    api.hide('docPanel'); api.toast(tt('webdavSaved', 'WebDAV hesabı kaydedildi'), { type: 'ok' });
    renderServices(); renderExplorer();
  };
  $('wdUrl').focus();
}

// ---------------------------------------------------------------------------------
// Bulut sekmesi: oturum açılmış hizmetlerin gezgini
// ---------------------------------------------------------------------------------
export function renderExplorer(host) {
  if (host) hosts.explorer = host;
  const el = hosts.explorer; if (!el) return;
  const accs = wdAccounts(), u = Drive.account();
  if (!accs.length && !u) {
    el.innerHTML = `<div class="doc-card cloud-empty">${ICON('i-drive')}<p>${esc(tt('cloudNone', 'Henüz oturum açılmış bulut hesabı yok.'))}</p><button type="button" class="btn small primary" data-cloud="gofiles">${esc(tt('cloudGoFiles', 'Dosya › Bulut'))}</button></div>`;
    bindExplorer(el); return;
  }
  if (nav.acc && !accs.some(a => a.id === nav.acc.id)) { nav.acc = null; nav.items = []; }
  let h = '<div class="chips">';
  if (u) h += `<button type="button" class="chip" data-cloud="drive-open">${ICON('i-drive')} ${esc(t('drive'))}${u.email ? ' · ' + esc(u.email) : ''}</button>`;
  for (const a of accs) h += `<button type="button" class="chip ${nav.acc && nav.acc.id === a.id ? 'on' : ''}" data-cloud="wd-sel" data-id="${esc(a.id)}">${ICON('i-link')} ${esc(a.name || a.url)}</button>`;
  h += '</div>';
  if (!nav.acc && accs.length) { nav.acc = accs[0]; nav.path = '/'; nav.items = []; el.innerHTML = h; bindExplorer(el); list(); return; }
  if (nav.acc) h += explorerHtml();
  else h += `<div class="cloud-empty muted">${esc(u ? tt('openDrivePanel', "Drive'ı aç") : '')}</div>`;
  el.innerHTML = h;
  bindExplorer(el);
}
function bindExplorer(el) { if (!el.dataset.cloudBound) { el.dataset.cloudBound = '1'; el.addEventListener('click', onExplorerClick); } }
function explorerHtml() {
  const parts = nav.path.split('/').filter(Boolean);
  let h = `<div class="cloud-explorer"><div class="doc-crumbs"><button type="button" class="chip" data-cloud="crumb" data-path="/">${ICON('i-link')} ${esc(nav.acc.name || nav.acc.url)}</button>` + parts.map((c, i) => `<span>›</span><button type="button" class="chip" data-cloud="crumb" data-path="${esc('/' + parts.slice(0, i + 1).join('/') + '/')}">${esc(c)}</button>`).join('') + `<span class="sp"></span><button type="button" class="lbtn" data-cloud="wd-upload" aria-label="${esc(t('webdavUpload'))}"${lockAttr('webdavWrite')}>${ICON('i-export')}</button><button type="button" class="lbtn" data-cloud="wd-mkdir" aria-label="${esc(t('webdavNewFolder'))}"${lockAttr('webdavWrite')}>${ICON('i-plus')}</button><button type="button" class="lbtn" data-cloud="refresh" aria-label="${esc(t('refresh'))}">${ICON('i-turn')}</button></div>`;
  if (nav.error) h += `<div class="doc-card"><strong>${esc(tt('webdavError', 'WebDAV hatası'))}</strong><p>${esc(nav.error)}</p><div class="row"><button type="button" class="btn small" data-cloud="refresh">${esc(t('refresh'))}</button></div></div>`;
  if (nav.loading) return h + skelList(5) + '</div>';
  const items = nav.items.slice().sort((a, b) => (b.dir ? 1 : 0) - (a.dir ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'tr'));
  if (!items.length && !nav.error) h += emptyBox('folder', tt('openEmptyDir', 'Klasör boş'), tt('openEmptyDirText', 'Bu klasörde gösterilecek dosya yok.'));
  h += '<div class="list arc-list">';
  for (const it of items) {
    const meta = it.dir ? '' : [fmtSize(+it.size), it.time > 0 ? new Date(it.time).toLocaleDateString('tr-TR') : ''].filter(Boolean).join(' · ');
    h += `<div class="item arc-item open-item wd-item" data-cloud="entry" data-path="${esc(it.path)}" data-name="${esc(it.name)}" data-dir="${it.dir ? 1 : 0}" data-size="${Number(it.size) || 0}">${it.dir ? ICON('i-open') : iconFor(it.name)}<span class="nm">${esc(it.name)}</span>${meta ? `<small>${esc(meta)}</small>` : ''}${it.dir ? '<svg class="ic open-chev" aria-hidden="true"><use href="#i-chevron"/></svg>' : ''}<button type="button" class="lbtn" data-cloud="menu" aria-label="${esc(t('more'))}">${ICON('i-more')}</button></div>`;
  }
  return h + '</div></div>';
}
export function openAccount(a) { nav.acc = a; nav.path = '/'; nav.items = []; nav.error = ''; renderExplorer(); list(); }
let listSeq = 0;
async function list() {
  if (!nav.acc) return;
  const seq = ++listSeq;
  nav.loading = true; nav.error = ''; renderExplorer();
  try { const r = await wd('list', { id: nav.acc.id, path: nav.path }); if (seq !== listSeq) return; nav.items = Array.isArray(r.items) ? r.items : []; }
  catch (e) { if (seq !== listSeq) return; nav.items = []; nav.error = e.message || String(e); }
  nav.loading = false; renderExplorer();
}
async function onExplorerClick(ev) {
  const b = ev.target.closest('[data-cloud]'); if (!b) return;
  ev.stopPropagation();
  const k = b.dataset.cloud;
  if (k === 'gofiles') { call(api.gotoFilesCloud); return; }
  if (k === 'drive-open') { call(api.openDrive); return; }
  if (k === 'wd-sel') { const a = wdAccounts().find(x => x.id === b.dataset.id); if (a) openAccount(a); return; }
  if (k === 'crumb') { nav.path = b.dataset.path || '/'; list(); return; }
  if (k === 'refresh') { list(); return; }
  if (k === 'wd-upload') { await uploadMenu(); return; }
  if (k === 'wd-mkdir') { await newFolder(); return; }
  if (k === 'menu') { const it = b.closest('.wd-item'); if (it) itemMenu(it); return; }
  if (k === 'entry') {
    if (b.dataset.dir === '1') { nav.path = b.dataset.path.endsWith('/') ? b.dataset.path : b.dataset.path + '/'; list(); return; }
    await download(b.dataset.path, b.dataset.name);
  }
}
/*
 * YAZMA. WebDAV'ın atomik yazma garantisi yoktur; Java tarafı önce geçici ada yazıp MOVE ile
 * gerçek adına alır (WebDav.upload açıklamasına bakınız). Çakışma HATA DEĞİL SORUDUR: sunucuda
 * aynı adlı dosya varsa Java {exists:true} döner, burada kullanıcıya üç seçenek sunulur.
 */
async function uploadDo(args, ad) {
  if (!nav.acc) return;
  const bar = (done, total) => api.toast(t('webdavUpload') + ': ' + ad + (total > 0 ? '  %' + Math.round(100 * done / total) : ''), 60000);
  bar(0, 0);
  try {
    let r = await wd('upload', { id: nav.acc.id, path: nav.path, name: ad, ...args }, bar);
    if (r && r.exists) {
      const sec = await askChoice(t('webdavExists') + ': ' + ad, [
        ['over', t('webdavOverwrite')], ['rename', t('webdavRename')], ['cancel', t('cancel')]]);
      if (!sec || sec === 'cancel') { api.toast(''); return; }
      if (sec === 'rename') {
        const yeni = await askText(t('webdavRename'), ad);
        if (!yeni) { api.toast(''); return; }
        return uploadDo(args, String(yeni).trim());
      }
      bar(0, 0);
      r = await wd('upload', { id: nav.acc.id, path: nav.path, name: ad, overwrite: true, ...args }, bar);
    }
    api.toast(t('webdavUploaded') + ': ' + (r && r.name ? r.name : ad), { type: 'ok' });
    list();
  } catch (e) { api.toast(t('webdavNoWrite') + ': ' + (e.message || e), { type: 'error', ms: 7000 }); }
}
/** Üç seçenekli kutu; askForm'un select alanıyla kurulur (ayrı bir bileşen yazılmaz) */
async function askChoice(label, opts) {
  const v = await askForm(label, [{ id: 'k', label: '', type: 'select', value: opts[0][0], options: opts }], { ok: t('ok') });
  return v ? v.k : null;
}
async function uploadMenu() {
  if (!gate('webdavWrite')) return;
  if (!nav.acc) return;
  const has = !!(S && S.hasDoc);
  const html = `<div class="full btns">${has ? `<button type="button" class="btn small primary" id="wuCur">${esc(tt('uploadCurrent', 'Geçerli dosyayı yükle'))} (${esc(S.fileName)})</button>` : ''}`
    + `<button type="button" class="btn small" id="wuPick">${esc(tt('uploadPick', 'Cihazdan dosya seç ve yükle'))}</button></div>`
    + `<div class="full muted">${esc(tt('uploadTarget', 'Hedef'))}: ${esc(nav.acc.name || nav.acc.url)}${esc(nav.path)}</div>`;
  api.openDoc(t('webdavUpload'), html);
  if ($('wuCur')) $('wuCur').onclick = () => { api.hide('docPanel'); uploadDo({ src: 'current' }, S.fileName); };
  $('wuPick').onclick = () => { api.hide('docPanel'); if (api.pickForCloud) api.pickForCloud('webdav'); else api.toast(tt('uploadPick', 'Cihazdan dosya seç ve yükle')); };
}
async function newFolder() {
  if (!gate('webdavWrite')) return;
  if (!nav.acc) return;
  const ad = await askText(t('webdavNewFolder'), '');
  if (!ad || !String(ad).trim()) return;
  try { await wd('mkdir', { id: nav.acc.id, path: nav.path, name: String(ad).trim() }); api.toast(tt('folderCreated', 'Klasör oluşturuldu'), { type: 'ok' }); list(); }
  catch (e) { api.toast(t('webdavNoWrite') + ': ' + (e.message || e), { type: 'error', ms: 7000 }); }
}
function itemMenu(it) {
  const d = it.dataset;
  const html = `<div class="full"><strong>${esc(d.name)}</strong></div><div class="full btns">`
    + (d.dir === '1' ? '' : `<button type="button" class="btn small primary" id="wmOpen">${esc(t('open'))}</button>`)
    + `<button type="button" class="btn small" id="wmRen"${lockAttr('webdavWrite')}>${esc(t('webdavRename'))}</button>`
    + `<button type="button" class="btn small" id="wmDel"${lockAttr('webdavWrite')}>${esc(t('delete'))}</button></div>`;
  api.openDoc(d.dir === '1' ? tt('folder', 'Klasör') : tt('driveFile', 'Dosya'), html);
  if ($('wmOpen')) $('wmOpen').onclick = () => { api.hide('docPanel'); download(d.path, d.name); };
  $('wmRen').onclick = async () => {
    api.hide('docPanel');
    if (!gate('webdavWrite')) return;
    const yeni = await askText(t('webdavRename'), d.name);
    if (!yeni || String(yeni).trim() === d.name) return;
    const ust = d.path.slice(0, d.path.replace(/\/$/, '').lastIndexOf('/') + 1);
    try { await wd('move', { id: nav.acc.id, from: d.path, to: ust + String(yeni).trim(), overwrite: false }); api.toast(tt('renamed', 'Yeniden adlandırıldı'), { type: 'ok' }); list(); }
    catch (e) { api.toast(t('webdavNoWrite') + ': ' + (e.message || e), { type: 'error', ms: 7000 }); }
  };
  $('wmDel').onclick = async () => {
    api.hide('docPanel');
    if (!gate('webdavWrite')) return;
    if (!(await askConfirm(tt('confirmDelete', 'Silinsin mi?') + ' ' + d.name))) return;
    try { await wd('delete', { id: nav.acc.id, path: d.path }); api.toast(t('webdavDeleted'), { type: 'ok' }); list(); }
    catch (e) { api.toast(t('webdavNoWrite') + ': ' + (e.message || e), { type: 'error', ms: 7000 }); }
  };
}
/** Dışarıdan çağrılır (app.js dosya seçici sonucu): seçilen içeriği geçerli klasöre yükler */
export function uploadBytes(b64, name) { return uploadDo({ b64 }, name); }
async function download(path, name) {
  if (!nav.acc) return;
  api.toast(tt('downloading', 'İndiriliyor') + ': ' + name, 60000);
  try {
    const info = await wd('download', { id: nav.acc.id, path, name });
    api.hideToast && api.hideToast();
    if (!info || !info.id) throw new Error(tt('docFail', 'Belge açılamadı'));
    await api.openRegistered({ id: info.id, name: info.name || name, size: info.size, ext: info.ext || kindOf(name) });
  } catch (e) { api.toast(tt('webdavError', 'WebDAV hatası') + ': ' + e.message, { type: 'error', ms: 6000 }); }
}
/** Dış yenileme: Google girişi / yetki değişimi sonrası kartlar ve gezgin */
export function refresh() { renderServices(); renderExplorer(); }
