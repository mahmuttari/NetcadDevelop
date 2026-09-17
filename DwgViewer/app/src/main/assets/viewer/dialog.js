/*
 * Uygulama içi giriş ve onay kutuları (tarayıcının prompt()/confirm() yerine).
 *   askText(label, def, { type:'text'|'number', multiline, ph, ok, cancel, words }) → Promise<string|null>
 *   words:true → kutunun üstünde hazır ifade çipleri (son kullanılanlar önde); onaylanan metin listeye yazılır
 *   askConfirm(msg, { ok, cancel })                                       → Promise<boolean>
 *   askForm(label, fields, { ok, cancel })                                → Promise<obj|null>
 *     fields: [{ id, label, type:'number'|'text'|'select'|'check', value, options:[[deger,etiket]], min, max, step, hint }]
 *   isOpen() · cancel()   geri tuşu için (app.onBack)
 * Kutu #app içinde durur: tema, yazı ölçeği (--fs) ve eldiven modu kendiliğinden uygulanır.
 * Enter / Tamam onaylar, Esc / Vazgeç / geri tuşu kapatır. Aynı anda tek kutu açık kalır.
 * Sınama kancası: window.__ask.queue[] doluysa kutu açılmaz, sıradaki cevap hemen döner;
 * her istek window.__ask.log'a {type, label} olarak yazılır.
 */
import { t } from './i18n.js';
import { store } from './state.js';

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
    const wb = ev.target.closest('[data-word]');
    if (wb) {                                   // hazır ifade: imleci bozmadan sona ekle, kutu açık kalır
      const inp = d.querySelector('#askIn');
      if (inp) { const v = inp.value || ''; inp.value = v && !/\s$/.test(v) ? v + ' ' + wb.dataset.word : v + wb.dataset.word; inp.focus(); }
      return;
    }
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
  else if (c.kind === 'form') value = okPressed ? true : null;   // alanları askForm okur; kutu kapanmadan önce DOM duruyor
  else if (okPressed) { const inp = d.querySelector('#askIn'); value = inp ? inp.value : ''; if (c.words) rememberWord(value); }
  d.hidden = true;
  try { if (c.prevFocus && typeof c.prevFocus.focus === 'function') c.prevFocus.focus(); } catch (_) { /* yok */ }
  c.resolve(value);
}
function open(kind, label, fieldHtml, o) {
  if (cur) finish(false);   // önceki kutu vazgeçilmiş sayılır
  const d = el();
  $('askLabel').textContent = label || '';
  $('askField').innerHTML = fieldHtml || '';
  d.querySelectorAll('.ask-grid').forEach(g => { g.onclick = (ev) => { const b = ev.target.closest('.ask-cell'); if (!b) return; g.querySelectorAll('.ask-cell').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); }; });
  $('askOk').textContent = o.ok || t('ok');
  $('askNo').textContent = o.cancel || t('cancel');
  d.classList.toggle('confirm', kind === 'confirm');
  d.hidden = false;
  return new Promise((resolve) => {
    cur = { resolve, kind, words: !!o.words, prevFocus: document.activeElement };
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
  if (kind === 'form') return v === null || v === false ? null : v;      // form cevabı nesnedir, metne çevrilmez
  return v === null || v === false ? null : String(v);
}
const escA = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Metin / sayı girişi; vazgeçilirse null */
export function askText(label, def = '', opts = {}) {
  const q = fromQueue('text', label); if (q !== undefined) return Promise.resolve(q);
  const o = opts || {};
  const val = escA(def == null ? '' : def);
  const ph = o.ph ? ` placeholder="${escA(o.ph)}"` : '';
  const field = (o.words ? wordsHtml(presetWords()) : '') + (o.multiline
    ? `<textarea id="askIn" class="opt-text" rows="3"${ph}>${val}</textarea>`
    : `<input id="askIn" class="opt-text" type="text" value="${val}" autocomplete="off"${ph} ${o.type === 'number' ? 'inputmode="decimal"' : ''}${o.maxlength ? ` maxlength="${o.maxlength}"` : ''}>`);
  return open('text', label, field, o);
}
/**
 * Çok alanlı giriş (dizi sayıları, bul-değiştir, toplu işlem seçenekleri…).
 * Vazgeçilirse null; onaylanırsa alan kimliklerinden değerlere bir nesne döner
 * (number alanları sayıya çevrilir, check alanları boolean'dır).
 * Sınama kancası: __ask.queue'ya nesne konursa kutu açılmadan o nesne döner.
 */
export function askForm(label, fields, opts = {}) {
  const list = (fields || []).filter(f => f && f.id);
  const q = fromQueue('form', label);
  if (q !== undefined) {
    if (q === null) return Promise.resolve(null);
    const def = {}; for (const f of list) def[f.id] = f.value;
    return Promise.resolve(typeof q === 'object' ? { ...def, ...q } : def);
  }
  const o = opts || {};
  const row = (f) => {
    const id = 'askF_' + f.id;
    if (f.type === 'check') return `<label class="chk"><input type="checkbox" id="${id}" data-f="${escA(f.id)}" ${f.value ? 'checked' : ''}> ${escA(f.label)}</label>`;
    // Kartlı seçim: her seçenek [değer, ad, html] — html önizlemedir (tarama deseni gibi); dokunuş kartı seçer
    if (f.type === 'grid') return `<div class="ask-row ask-row-grid"><span class="ask-lb">${escA(f.label)}</span><div class="ask-grid" id="${id}" data-f="${escA(f.id)}" role="radiogroup">${(f.options || []).map(([v, t2, html]) => `<button type="button" class="ask-cell${String(v) === String(f.value) ? ' on' : ''}" data-v="${escA(v)}" role="radio" aria-checked="${String(v) === String(f.value)}" title="${escA(t2)}">${html || ''}<span>${escA(t2)}</span></button>`).join('')}</div></div>`;
    let inp;
    if (f.type === 'select') inp = `<select id="${id}" data-f="${escA(f.id)}">${(f.options || []).map(([v, t2]) => `<option value="${escA(v)}"${String(v) === String(f.value) ? ' selected' : ''}>${escA(t2)}</option>`).join('')}</select>`;
    else inp = `<input id="${id}" data-f="${escA(f.id)}" type="text"${f.type === 'number' ? ' inputmode="decimal"' : ''} value="${escA(f.value == null ? '' : f.value)}" autocomplete="off">`;
    return `<div class="ask-row"><span class="ask-lb">${escA(f.label)}</span>${inp}</div>`;
  };
  const html = `<div class="ask-form">${list.map(row).join('')}</div>`
    + (o.hint ? `<div class="muted ask-hint">${escA(o.hint)}</div>` : '');
  const pr = open('form', label, html, o);
  return pr.then((v) => {
    if (v === null) return null;
    const out = {};
    for (const f of list) {
      const el = document.getElementById('askF_' + f.id);
      if (!el) { out[f.id] = f.value; continue; }
      if (f.type === 'check') out[f.id] = !!el.checked;
      else if (f.type === 'grid') { const on = el.querySelector('.ask-cell.on'); out[f.id] = on ? on.dataset.v : f.value; }
      else if (f.type === 'number') { const n = parseFloat(String(el.value).replace(',', '.')); out[f.id] = isFinite(n) ? n : (f.value == null ? 0 : f.value); }
      else out[f.id] = el.value;
    }
    return out;
  });
}

/** Evet / hayır onayı */
export function askConfirm(msg, opts = {}) {
  const q = fromQueue('confirm', msg); if (q !== undefined) return Promise.resolve(q);
  return open('confirm', msg, '', opts || {});
}
export const isOpen = () => !!cur;
/** Açık kutuyu vazgeçerek kapatır; kapatıldıysa true */
export function cancel() { if (!cur) return false; finish(false); return true; }

// ---------------------------------------------------------------------------------
// Hazır ifadeler
// ---------------------------------------------------------------------------------
/*
 * Yazı ve not kutularında tek dokunuşla eklenen kısa ifadeler. Liste iki kaynaktan gelir:
 * dilin kendi öntanımlı listesi (i18n 'presetList', "|" ile ayrılmış) ve kullanıcının son yazdıkları.
 * Son kullanılanlar önde durur; aynı ifade iki kez görünmez. Liste cihazda saklanır, hiçbir yere gönderilmez.
 */
const WORDS_KEY = 'words:recent';
const WORDS_MAX = 8;          // son kullanılan en fazla bu kadar tutulur
const WORDS_SHOW = 20;        // çip olarak en fazla bu kadarı gösterilir
const WORD_LEN = 40;          // uzun metin çip olmaz (ifade değil, cümledir)
export function recentWords() {
  const v = store.json(WORDS_KEY, []);
  return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];
}
/** Onaylanan metni son kullanılanların başına alır (tekrar etmez, uzun metin alınmaz) */
export function rememberWord(txt) {
  const w = String(txt == null ? '' : txt).trim();
  if (!w || w.length > WORD_LEN || w.includes('\n')) return;
  const list = recentWords().filter(x => x.toLowerCase() !== w.toLowerCase());
  list.unshift(w);
  try { store.set(WORDS_KEY, JSON.stringify(list.slice(0, WORDS_MAX))); } catch (_) { /* yoksay */ }
}
/** Gösterilecek ifadeler: son kullanılanlar + dilin öntanımlı listesi */
export function presetWords() {
  const raw = t('presetList');
  const base = raw && raw !== 'presetList' ? String(raw).split('|').map(x => x.trim()).filter(Boolean) : [];
  const out = [], seen = new Set();
  for (const w of [...recentWords(), ...base]) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(w);
    if (out.length >= WORDS_SHOW) break;
  }
  return out;
}
const wordsHtml = (list) => (list && list.length)
  ? `<div class="ask-words">${list.map(w => `<button type="button" class="chip" data-word="${escA(w)}">${escA(w)}</button>`).join('')}</div>`
  : '';
