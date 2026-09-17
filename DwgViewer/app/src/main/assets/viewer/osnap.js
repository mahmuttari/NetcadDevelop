/*
 * NESNE YAKALAMA (OSNAP) — kip tablosu, işaret glifleri, ayar kutusu, bir kerelik geçersiz kılma,
 * komut satırı listesi (-OSNAP) ve ölçü panelindeki çip şeridi. Geometri geom.snapPoint'tedir;
 * burası kullanıcıya bakan yüzdür ve TEK KAYNAKTIR: glifler hem SVG (menü) hem tuval (imleç
 * işareti) olarak aynı tanımdan çizilir, böylece menüde görülen simge ile çizimde beliren işaret
 * birbirinden ayrışamaz.
 *
 * Durum (state.js):  S.snapModes Set<kip> · S.snapOnce bir kerelik kip · S.snapTemp ara nokta(lar) ·
 *                    S.track.pts edinilmiş iz noktaları (nesne yakalama izleme, otrack.js) · S.snapFlash dokunuş sonrası işaret
 * Seçenekler:        settings.snapOpt { aperture (px), ignoreHatch, zElev, otrack }
 */
let api = null;   // { S, t, esc, openDoc, hide, toast, haptic, settings, saveSettings, changed, widgets }

/** AutoCAD'in çalışan yakalama kipleri, AutoCAD sırasıyla (Drafting Settings › Object Snap) */
export const MODES = [
  { id: 'end', abbr: 'END', key: 'osEnd', names: ['END', 'ENDP', 'ENDPOINT'] },
  { id: 'mid', abbr: 'MID', key: 'osMid', names: ['MID', 'MIDPOINT'] },
  { id: 'cen', abbr: 'CEN', key: 'osCen', names: ['CEN', 'CENTER'] },
  { id: 'gcen', abbr: 'GCE', key: 'osGcen', names: ['GCE', 'GCEN', 'GEOMETRICCENTER'] },
  { id: 'node', abbr: 'NOD', key: 'osNode', names: ['NOD', 'NODE'] },
  { id: 'qua', abbr: 'QUA', key: 'osQua', names: ['QUA', 'QUAD', 'QUADRANT'] },
  { id: 'int', abbr: 'INT', key: 'osInt', names: ['INT', 'INTERSECTION'] },
  { id: 'ext', abbr: 'EXT', key: 'osExt', names: ['EXT', 'EXTENSION'] },
  { id: 'ins', abbr: 'INS', key: 'osIns', names: ['INS', 'INSERT', 'INSERTION'] },
  { id: 'per', abbr: 'PER', key: 'osPer', names: ['PER', 'PERP', 'PERPENDICULAR'] },
  { id: 'tan', abbr: 'TAN', key: 'osTan', names: ['TAN', 'TANGENT'] },
  { id: 'nea', abbr: 'NEA', key: 'osNea', names: ['NEA', 'NEAR', 'NEAREST'] },
  { id: 'app', abbr: 'APP', key: 'osApp', names: ['APP', 'APPINT', 'APPARENT'] },
  { id: 'par', abbr: 'PAR', key: 'osPar', names: ['PAR', 'PARALLEL'] },
];
/** Yalnız bir kerelik kullanılan geçersiz kılmalar (AutoCAD'in nokta istemine yazılan adları) */
export const ONCE_ONLY = [
  { id: 'm2p', abbr: 'M2P', key: 'osM2p', names: ['M2P', 'MTP'] },
  { id: 'from', abbr: 'FRO', key: 'osFrom', names: ['FRO', 'FROM'] },
  { id: 'tk', abbr: 'TK', key: 'osTk', names: ['TK', 'TT', 'TRACK', 'TRACKING'] },
  { id: 'non', abbr: 'NON', key: 'osNon', names: ['NON', 'NONE'] },
];
export const DEFAULT_MODES = ['end', 'mid', 'cen', 'int', 'ext', 'ins', 'node'];   // EXT AutoCAD'in varsayılan OSMODE'unda da (4133) vardır: uzantı yolları
export const OPT_DEFAULTS = { aperture: 18, ignoreHatch: false, zElev: false, otrack: true };   // otrack: AutoCAD'de de açık gelir (AUTOSNAP bit 16)
const BY_ID = new Map([...MODES, ...ONCE_ONLY].map(m => [m.id, m]));
const BY_NAME = new Map();
for (const m of [...MODES, ...ONCE_ONLY]) for (const n of m.names) BY_NAME.set(n, m.id);
/** İşaret adı (İZ hizası ve dönen ara sonuçlar için ek etiketler) */
const EXTRA_KEY = { trk: 'osTrk' };

/*
 * GLİFLER — AutoCAD AutoSnap işaretleri, birim karede (−1..1, y aşağı). poly: çizgi dizileri
 * (closed kapalı çokgen), circ: [cx, cy, r], dots: dolu küçük noktalar.
 */
const G = {
  end: { poly: [{ pts: [[-.8, -.8], [.8, -.8], [.8, .8], [-.8, .8]], closed: true }] },
  mid: { poly: [{ pts: [[0, -.9], [.9, .75], [-.9, .75]], closed: true }] },
  cen: { circ: [[0, 0, .8]] },
  gcen: { circ: [[0, 0, .8]], poly: [{ pts: [[-.42, 0], [.42, 0]] }, { pts: [[0, -.42], [0, .42]] }, { pts: [[-.3, -.3], [.3, .3]] }, { pts: [[-.3, .3], [.3, -.3]] }] },
  node: { circ: [[0, 0, .75]], poly: [{ pts: [[-.5, -.5], [.5, .5]] }, { pts: [[-.5, .5], [.5, -.5]] }] },
  qua: { poly: [{ pts: [[0, -.95], [.95, 0], [0, .95], [-.95, 0]], closed: true }] },
  int: { poly: [{ pts: [[-.85, -.85], [.85, .85]] }, { pts: [[-.85, .85], [.85, -.85]] }] },
  app: { poly: [{ pts: [[-.85, -.85], [.85, -.85], [.85, .85], [-.85, .85]], closed: true }, { pts: [[-.55, -.55], [.55, .55]] }, { pts: [[-.55, .55], [.55, -.55]] }] },
  ext: { dots: [[-.8, 0], [0, 0], [.8, 0]] },
  ins: { poly: [{ pts: [[-.9, -.2], [.2, -.2], [.2, .9], [-.9, .9]], closed: true }, { pts: [[-.2, -.9], [.9, -.9], [.9, .2], [-.2, .2]], closed: true }] },
  per: { poly: [{ pts: [[-.8, -.9], [-.8, .8], [.9, .8]] }, { pts: [[-.8, .15], [-.15, .15], [-.15, .8]] }] },
  tan: { circ: [[0, .2, .7]], poly: [{ pts: [[-.9, -.55], [.9, -.55]] }] },
  nea: { poly: [{ pts: [[-.85, -.8], [.85, -.8], [-.85, .8], [.85, .8]], closed: true }] },
  par: { poly: [{ pts: [[-.7, .9], [.1, -.9]] }, { pts: [[.1, .9], [.9, -.9]] }] },
  m2p: { poly: [{ pts: [[0, -.35], [.55, .65], [-.55, .65]], closed: true }], dots: [[-.85, -.6], [.85, -.6]] },
  from: { poly: [{ pts: [[-.85, .85], [-.85, -.2]] }, { pts: [[-.85, .85], [.2, .85]] }, { pts: [[-.4, .4], [.6, -.6]] }, { pts: [[.15, -.6], [.6, -.6], [.6, -.15]] }] },
  tk: { poly: [{ pts: [[-.9, 0], [-.3, 0]] }, { pts: [[.3, 0], [.9, 0]] }, { pts: [[0, -.9], [0, -.3]] }, { pts: [[0, .3], [0, .9]] }], dots: [[0, 0]] },
  non: { circ: [[0, 0, .8]], poly: [{ pts: [[-.55, -.55], [.55, .55]] }] },
};
G.trk = G.tk;

/** Tuval işareti: (x, y) ekran, s yarı boy (px). Geçerli strokeStyle / fillStyle kullanılır. */
export function drawMarker(c, x, y, kind, s = 7) {
  const g = G[kind] || G.end;
  c.beginPath();
  for (const pl of g.poly || []) {
    pl.pts.forEach((q, i) => { const X = x + q[0] * s, Y = y + q[1] * s; if (i) c.lineTo(X, Y); else c.moveTo(X, Y); });
    if (pl.closed) c.closePath();
  }
  for (const [cx, cy, r] of g.circ || []) { c.moveTo(x + cx * s + r * s, y + cy * s); c.arc(x + cx * s, y + cy * s, r * s, 0, Math.PI * 2); }
  c.stroke();
  if (g.dots) { for (const [dx, dy] of g.dots) { c.beginPath(); c.arc(x + dx * s, y + dy * s, Math.max(1.5, s * 0.22), 0, Math.PI * 2); c.fill(); } }
}
/** Aynı glifin SVG'si (menü ve çipler için); currentColor ile boyanır */
export function markerSvg(kind, cls = 'os-ic') {
  const g = G[kind] || G.end, f = (v) => (12 + v * 8).toFixed(2);
  let d = '';
  for (const pl of g.poly || []) d += pl.pts.map((q, i) => `${i ? 'L' : 'M'}${f(q[0])} ${f(q[1])}`).join(' ') + (pl.closed ? ' Z ' : ' ');
  let extra = '';
  for (const [cx, cy, r] of g.circ || []) extra += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${(r * 8).toFixed(2)}"/>`;
  for (const [dx, dy] of g.dots || []) extra += `<circle cx="${f(dx)}" cy="${f(dy)}" r="1.7" fill="currentColor" stroke="none"/>`;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${d ? `<path d="${d.trim()}"/>` : ''}${extra}</svg>`;
}

export function init(a) { api = a; renderBar(document.getElementById('snapBar')); }
const S = () => api.S;
const t = (k) => api.t(k);
/** Kipin okunur adı ("Uç nokta"); bilinmeyen kip için büyük harf kısaltma */
export function nameOf(id) { const m = BY_ID.get(id); if (m) return t(m.key); if (EXTRA_KEY[id]) return t(EXTRA_KEY[id]); return String(id || '').toUpperCase(); }
export function abbrOf(id) { const m = BY_ID.get(id); return m ? m.abbr : String(id || '').toUpperCase(); }
export function isOn() { return S().snapModes.size > 0; }
/** settings.snapOpt — eksik alanlar varsayılanla tamamlanır (eski ayar dosyaları) */
export function opt() {
  const st = api.settings;
  if (!st.snapOpt || typeof st.snapOpt !== 'object') st.snapOpt = {};
  for (const k of Object.keys(OPT_DEFAULTS)) if (st.snapOpt[k] == null) st.snapOpt[k] = OPT_DEFAULTS[k];
  return st.snapOpt;
}
function persist() { api.settings.snap = [...S().snapModes]; api.saveSettings(); }
/** Çalışan kipleri toptan kurar (bilinmeyen adlar atılır), kaydeder, arayüzü tazeler */
export function setModes(list) {
  const set = S().snapModes; set.clear();
  for (const m of list || []) if (BY_ID.has(m) && MODES.some(x => x.id === m)) set.add(m);
  persist(); api.changed();
}
export function toggleMode(id) { const set = S().snapModes; if (set.has(id)) set.delete(id); else set.add(id); persist(); api.changed(); }
let backup = null;
/** F3: kapatırken liste saklanır, açarken aynı liste (yoksa varsayılan) döner */
export function toggle() {
  if (isOn()) { backup = [...S().snapModes]; setModes([]); api.toast(t('osnapOff'), 1200); }
  else { setModes(backup && backup.length ? backup : DEFAULT_MODES); api.toast(t('osnapOn'), 1200); }
  api.haptic('toggle');
}
export function setOpt(k, v) { opt()[k] = v; api.saveSettings(); api.changed(); }
/** F11 / komut çubuğu düğmesi / ayar kutusu: nesne yakalama izleme. Kapatınca edinilmiş iz noktaları da bırakılır. */
export function toggleTrack() { const on = !opt().otrack; setOpt('otrack', on); if (!on && S().track) S().track.pts = []; api.toast(t(on ? 'osTrackOn' : 'osTrackOff'), 1200); api.haptic('toggle'); }
/** Bir kerelik geçersiz kılma: sonraki nokta bu kiple alınır (m2p / from / tk iki dokunuş ister) */
export function once(id) {
  if (!BY_ID.has(id)) return false;
  S().snapOnce = id; S().snapTemp = null;
  api.toast(t('osOnceSet').replace('%s', abbrOf(id) + ' · ' + nameOf(id)), 1600);
  api.haptic('toggle');
  return true;
}
export function clearOnce() { S().snapOnce = null; S().snapTemp = null; }
/** Nokta isteminde yazılan sözcük bir yakalama adı mı? ("end", "MID", "m2p", "none"…) → kip ya da null */
export function overrideOf(text) {
  const s = String(text || '').trim().toUpperCase().replace(/^_/, '');
  return BY_NAME.get(s) || null;
}
/** -OSNAP listesi: "end,mid,cen" → { modes:[…], off, bad:[…] }; NONE / OFF kapatır */
export function parseList(text) {
  const out = { modes: [], off: false, bad: [] };
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const s = raw.trim().toUpperCase(); if (!s) continue;
    if (s === 'NONE' || s === 'OFF' || s === 'NON') { out.off = true; continue; }
    const id = BY_NAME.get(s);
    if (id && MODES.some(m => m.id === id)) { if (!out.modes.includes(id)) out.modes.push(id); } else out.bad.push(raw);
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Ölçü panelindeki çip şeridi: dişli (ayar kutusu) + 14 kip; dokunmak kipi açar / kapar
// ---------------------------------------------------------------------------------
export function renderBar(el) {
  if (!el || !api) return;   // ayarlar modül kurulmadan uygulanabilir; kurulumda yeniden çizilir
  const set = S().snapModes;
  el.innerHTML = `<button type="button" class="os-chip os-gear" data-os-set="1" title="${api.esc(t('osSettings'))}" aria-label="${api.esc(t('osSettings'))}"><svg class="ic" aria-hidden="true"><use href="#i-sliders"/></svg></button>`
    + MODES.map(m => `<button type="button" class="os-chip${set.has(m.id) ? ' on' : ''}" data-os="${m.id}" aria-pressed="${set.has(m.id)}" title="${api.esc(nameOf(m.id))}">${markerSvg(m.id)}<span>${m.abbr}</span></button>`).join('');
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.osSet) { openDialog(); return; }
      if (b.dataset.os) { toggleMode(b.dataset.os); api.haptic('toggle'); }
    });
  }
}

// ---------------------------------------------------------------------------------
// Ayar kutusu — AutoCAD "Drafting Settings › Object Snap" düzeni, dokunmaya uygun
// ---------------------------------------------------------------------------------
export function openDialog() {
  const st = S(), o = opt(), W = api.widgets, esc = api.esc;
  const kart = (m, attr) => `<button type="button" class="os-card${st.snapModes.has(m.id) && attr === 'data-os' ? ' on' : ''}" ${attr}="${m.id}" aria-pressed="${attr === 'data-os' ? String(st.snapModes.has(m.id)) : 'false'}">${markerSvg(m.id)}<b>${m.abbr}</b><span>${esc(nameOf(m.id))}</span></button>`;
  const ap = o.aperture <= 13 ? 12 : o.aperture >= 24 ? 26 : 18;
  api.openDoc(t('osTitle'),
    `<div class="full os-head">${W.sw('osMaster', st.snapModes.size > 0, t('osMaster'))}${W.sw('osTrack', !!o.otrack, t('osTrack'))}<div class="opt-note">${esc(t('osTrackHint'))}</div></div>`
    + `<div class="full opt-title">${esc(t('osRunning'))}</div>`
    + `<div class="full os-grid" id="osGrid">${MODES.map(m => kart(m, 'data-os')).join('')}</div>`
    + `<div class="full btns os-btns"><button type="button" class="btn small" data-os-all="1">${esc(t('osAll'))}</button><button type="button" class="btn small" data-os-clear="1">${esc(t('osNone'))}</button><button type="button" class="btn small" data-os-default="1">${esc(t('osDefault'))}</button></div>`
    + `<div class="full opt-title">${esc(t('osOnce'))}</div><div class="full opt-note">${esc(t('osOnceHint'))}</div>`
    + `<div class="full os-grid os-once" id="osOnce">${[...MODES, ...ONCE_ONLY].map(m => kart(m, 'data-os-once')).join('')}</div>`
    + `<div class="full opt-title">${esc(t('osAperture'))}</div><div class="full">${W.seg('osAperture', [12, 18, 26], ap, [t('osApSmall'), t('osApMid'), t('osApLarge')])}</div>`
    + `<div class="full">${W.sw('osIgnoreHatch', !!o.ignoreHatch, t('osIgnoreHatch'))}${W.sw('osZElev', !!o.zElev, t('osZElev'))}</div>`);
  const body = document.getElementById('docBody');
  const kartlariTazele = () => {
    body.querySelectorAll('#osGrid [data-os]').forEach(b => { const on = st.snapModes.has(b.dataset.os); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const m = body.querySelector('input[data-key="osMaster"]'); if (m) m.checked = st.snapModes.size > 0;
  };
  body.onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.os) { toggleMode(b.dataset.os); api.haptic('toggle'); kartlariTazele(); return; }
    if (b.dataset.osOnce) { once(b.dataset.osOnce); api.hide('docPanel'); return; }
    if (b.dataset.osAll) { setModes(MODES.map(m => m.id)); kartlariTazele(); return; }
    if (b.dataset.osClear) { setModes([]); kartlariTazele(); return; }
    if (b.dataset.osDefault) { setModes(DEFAULT_MODES); kartlariTazele(); return; }
    const sg = b.closest('.seg[data-key="osAperture"]');
    if (sg && b.dataset.val) { setOpt('aperture', Number(b.dataset.val)); sg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }
  };
  body.onchange = (ev) => {
    const inp = ev.target.closest('input[data-key]'); if (!inp) return;
    const k = inp.dataset.key;
    if (k === 'osMaster') { if (inp.checked !== isOn()) toggle(); kartlariTazele(); }
    else if (k === 'osTrack') { if (inp.checked !== !!opt().otrack) toggleTrack(); }
    else if (k === 'osIgnoreHatch') setOpt('ignoreHatch', inp.checked);
    else if (k === 'osZElev') setOpt('zElev', inp.checked);
  };
}
