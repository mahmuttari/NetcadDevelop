/**
 * skel.js — bekleme iskeletleri ve boş durum kartları
 *
 * Yalnız HTML DİZESİ üretir; DOM'a dokunmaz, olay bağlamaz, durum tutmaz. Çağıran modül
 * (open.js · docs.js · cloud.js · drive.js · app.js) dizeyi kendi kabının innerHTML'ine yazar.
 *
 * NEDEN İSKELET
 *   Liste ya da belge gelene kadar tek satırlık "Yükleniyor…" yazısı boşluğu anlatmaz; gelecek
 *   içeriğin BİÇİMİNİ önceden göstermek beklemeyi kısaltmaz ama kısa gösterir ve içerik
 *   gelince yerleşim sıçramaz. İskelet süstür: hepsi aria-hidden'dır, okuyucuya yanındaki
 *   görünmez metin ("Yükleniyor…") okunur.
 *
 * BİÇEM
 *   Bütün sınıflar app.css'in iskelet bölümünde tanımlıdır (.skel-item · .skel-thumb ·
 *   .skel-doc · .empty). Renk ve ölçü buradan değil, oradan gelir.
 */
import { t } from './i18n.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Okunur ama görünmez bekleme metni: iskelet süs olduğu için bilgi buradan verilir. */
const busy = () => `<span class="vh" role="status">${esc(t('loading'))}</span>`;

const row = (plain) => `<div class="skel-item${plain ? ' plain' : ''}"><span class="skel-b skel-ic"></span><span class="skel-tx"><span class="skel-b skel-l1"></span><span class="skel-b skel-l2"></span></span></div>`;

/** Sütun biçimli liste iskeleti (.list / .open-item yerine): çerçevesiz, alt kıl çizgili satırlar. */
export function skelList(n = 4) {
  return busy() + `<div class="skel-list" aria-hidden="true">${row(true).repeat(Math.max(1, n))}</div>`;
}

/** Izgara biçimli iskelet (.recent / .open-grid yerine): çerçeveli kartlar. */
export function skelGrid(n = 6) {
  return busy() + `<div class="skel-grid" aria-hidden="true">${row(false).repeat(Math.max(1, n))}</div>`;
}

/** Belge gövdesi iskeleti: başlık bandı + metin satırları. */
export function skelDoc(lines = 8) {
  const b = `<span class="skel-b"></span>`.repeat(Math.max(2, lines));
  return busy() + `<div class="skel-doc" aria-hidden="true"><span class="skel-b skel-h"></span>${b}</div>`;
}

/** Çizim önizlemesi iskeleti: ızgaralı kart + beliren soluk plan izi. */
export function skelThumb(small) {
  return `<span class="skel-thumb${small ? ' sm' : ''}" aria-hidden="true"><svg class="skel-plan" viewBox="0 0 120 120" aria-hidden="true"><use href="#ill-plan-trace"/></svg></span>`;
}

/**
 * Boş durum kartı.
 * @param {'cad'|'search'|'cloud'|'folder'} ill  çizim adı (#ill-empty-… simgesi)
 * @param {string} title  başlık (düz metin)
 * @param {string} text   açıklama (düz metin); boşsa satır hiç basılmaz
 * @param {string} acts   düğme(ler) — HAZIR HTML, çağıran kaçışlar
 */
export function emptyBox(ill, title, text, acts = '') {
  return `<div class="empty empty-${esc(ill)}">`
    + `<svg class="empty-ill" viewBox="0 0 120 120" aria-hidden="true"><use href="#ill-empty-${esc(ill)}"/></svg>`
    + `<b class="empty-title">${esc(title)}</b>`
    + `<p class="empty-text">${esc(text)}</p>`
    + `<div class="empty-acts">${acts}</div></div>`;
}
