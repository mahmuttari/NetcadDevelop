/*
 * Uygulama içi giriş ve onay kutuları (tarayıcının prompt()/confirm() yerine).
 *   askText(label, def, { type:'text'|'number', multiline, ok, cancel }) → Promise<string|null>
 *   askConfirm(msg, { ok, cancel })                                       → Promise<boolean>
 *   isOpen() · cancel()   geri tuşu için (app.onBack)
 * Kutu #app içinde durur: tema, yazı ölçeği (--fs) ve eldiven modu kendiliğinden uygulanır.
 * Enter / Tamam onaylar, Esc / Vazgeç / geri tuşu kapatır. Aynı anda tek kutu açık kalır.
 * Sınama kancası: window.__ask.queue[] doluysa kutu açılmaz, sıradaki cevap hemen döner;
 * her istek window.__ask.log'a {type, label} olarak yazılır.
 */
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const hook = (window.__ask = window.__ask || { queue: [], log: [] });
let cur = null;   // { resolve, kind }

function el() {
  let d = $('askDlg');
  if (d) return d;
  d = document.createElement('div');
  d.id = 'askDlg'; d.className = 'modal ask'; d.hidden = true; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'askLabel');
  d.innerHTML = `<div class="ask-card"><div class="ask-label" id="askLabel"></div><div class="ask-field" id="askField"></div><div class="row ask-btns"><button type="button" class="btn" id="askNo"></button><button type="button" class="btn primary" id="askOk"></button></div></div>`;
  ($('app') || document.body).appendChild(d);
  d.addEventListener('click', (ev) => {
    if (ev.target.closest('#askOk')) finish(true);
    else if (ev.target.closest('#askNo')) finish(false);
    else if (ev.target === d) finish(false);   // kart dışına dokunuş = vazgeç
  });
  d.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
    else if (ev.key === 'Enter' && !(ev.target && ev.target.tagName === 'TEXTAREA' && !ev.ctrlKey)) { ev.preventDefault(); ev.stopPropagation(); finish(true); }
    else ev.stopPropagation();   // kabuk kısayolları (F, G, D…) kutu açıkken çalışmasın
  });
  return d;
}
function finish(okPressed) {
  if (!cur) return;
  const d = $('askDlg'), c = cur; cur = null;
  let value = null;
  if (c.kind === 'confirm') value = !!okPressed;
  else if (okPressed) { const inp = d.querySelector('#askIn'); value = inp ? inp.value : ''; }
  d.hidden = true;
  try { if (c.prevFocus && typeof c.prevFocus.focus === 'function') c.prevFocus.focus(); } catch (_) { /* yok */ }
  c.resolve(value);
}
function open(kind, label, fieldHtml, o) {
  if (cur) finish(false);   // önceki kutu vazgeçilmiş sayılır
  const d = el();
  $('askLabel').textContent = label || '';
  $('askField').innerHTML = fieldHtml || '';
  $('askOk').textContent = o.ok || t('ok');
  $('askNo').textContent = o.cancel || t('cancel');
  d.classList.toggle('confirm', kind === 'confirm');
  d.hidden = false;
  return new Promise((resolve) => {
    cur = { resolve, kind, prevFocus: document.activeElement };
    const inp = d.querySelector('#askIn');
    setTimeout(() => { try { (inp || $('askOk')).focus(); if (inp && inp.select && !o.multiline) inp.select(); } catch (_) { /* yok */ } }, 0);
  });
}
/** Sınama kuyruğundan cevap: dönen değer undefined ise kuyruk boştur */
function fromQueue(kind, label) {
  hook.log.push({ type: kind, label: String(label || '') });
  if (!Array.isArray(hook.queue) || !hook.queue.length) return undefined;
  const v = hook.queue.shift();
  if (kind === 'confirm') return !(v === false || v === null || v === 'false' || v === '0' || v === '' || v === 0);
  return v === null || v === false ? null : String(v);
}
const escA = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Metin / sayı girişi; vazgeçilirse null */
export function askText(label, def = '', opts = {}) {
  const q = fromQueue('text', label); if (q !== undefined) return Promise.resolve(q);
  const o = opts || {};
  const val = escA(def == null ? '' : def);
  const field = o.multiline
    ? `<textarea id="askIn" class="opt-text" rows="3">${val}</textarea>`
    : `<input id="askIn" class="opt-text" type="text" value="${val}" autocomplete="off" ${o.type === 'number' ? 'inputmode="decimal"' : ''}${o.maxlength ? ` maxlength="${o.maxlength}"` : ''}>`;
  return open('text', label, field, o);
}
/** Evet / hayır onayı */
export function askConfirm(msg, opts = {}) {
  const q = fromQueue('confirm', msg); if (q !== undefined) return Promise.resolve(q);
  return open('confirm', msg, '', opts || {});
}
export const isOpen = () => !!cur;
/** Açık kutuyu vazgeçerek kapatır; kapatıldıysa true */
export function cancel() { if (!cur) return false; finish(false); return true; }
