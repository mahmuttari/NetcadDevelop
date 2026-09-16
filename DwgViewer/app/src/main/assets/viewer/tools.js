/*
 * Araç durum makineleri: çizim, düzenleme ve ölçüm.
 *
 * ToolManager, uygulamadan bir "api" nesnesi alır:
 *   snap(w) → {p:[x,y,z],kind}|null    pick(w) → prim|null      sel: Set<prim>
 *   prompt(text, opts)   → komut satırı metni ve giriş alanı ({input:'point'|'number'|'text'|null, buttons:[…]})
 *   run(cmd)             → EditDoc.run
 *   render()  overlay()  toast(msg)  result(rows)  layer()  color()
 *   visiblePrims()  allPrims()  copy(metin)  lonLat(x,y)  textHeight()
 *   fmt(v)   units()     unitToM()
 * Nokta girişi: dokunma (yakalamalı) ya da yazılı: "x,y" | "x,y,z" | "@dx,dy" | "@L<açı"
 */
import { TAU, flatten, polyArea, pathLength, pathLength3, segDist, opsBBox, enclosingPrim } from './geom.js';
import { newId, offsetPoints } from './edit.js';
import { t, addStrings } from './i18n.js';
import { askText, askConfirm, askForm } from './dialog.js';
import { dimLinear, dimRadial, dimAngular, leaderEnts, cloudEnt, balloonEnts, arrayItems, hatchEnts } from './annot.js';

const R2D = 180 / Math.PI, D2R = Math.PI / 180;

export const TOOLS = {
  // çizim  (name/steps Türkçe; en/stepsEn İngilizce — sözlüğe tool_<ad> / tstep_<ad>_<i> anahtarlarıyla kaydedilir)
  line: { name: 'Çizgi', en: 'Line', steps: ['Birinci noktayı seçin', 'İkinci noktayı seçin (devam eder)'], stepsEn: ['Pick the first point', 'Pick the second point (continues)'] },
  pline: { name: 'Polyline', en: 'Polyline', steps: ['Birinci noktayı seçin', 'Sonraki noktayı seçin · Bitir / Kapat'], stepsEn: ['Pick the first point', 'Pick the next point · Finish / Close'] },
  rect: { name: 'Dikdörtgen', en: 'Rectangle', steps: ['Birinci köşeyi seçin', 'Karşı köşeyi seçin'], stepsEn: ['Pick the first corner', 'Pick the opposite corner'] },
  circle: { name: 'Daire', en: 'Circle', steps: ['Merkezi seçin', 'Yarıçap noktasını seçin ya da yarıçapı yazın'], stepsEn: ['Pick the center', 'Pick a radius point or type the radius'] },
  arc3: { name: 'Yay (3 nokta)', en: 'Arc (3 points)', steps: ['Başlangıç noktası', 'Yay üzerinde bir nokta', 'Bitiş noktası'], stepsEn: ['Start point', 'A point on the arc', 'End point'] },
  point: { name: 'Nokta', en: 'Point', steps: ['Noktayı seçin'], stepsEn: ['Pick the point'] },
  text: { name: 'Yazı', en: 'Text', steps: ['Yazı konumunu seçin'], stepsEn: ['Pick the text position'] },
  pline3d: { name: '3B Polyline', en: '3D Polyline', steps: ['Birinci noktayı seçin (kot sorulur)', 'Sonraki noktayı seçin · Bitir'], stepsEn: ['Pick the first point (elevation is asked)', 'Pick the next point · Finish'] },
  face3d: { name: '3B Yüzey', en: '3D Face', steps: ['1. köşe', '2. köşe', '3. köşe', '4. köşe (isteğe bağlı) · Bitir'], stepsEn: ['Vertex 1', 'Vertex 2', 'Vertex 3', 'Vertex 4 (optional) · Finish'] },
  // düzenleme
  select: { name: 'Seç', en: 'Select', steps: ['Nesnelere dokunun (ekle/çıkar) · Bitir'], stepsEn: ['Tap objects (add/remove) · Finish'] },
  move: { name: 'Taşı', en: 'Move', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Hedef nokta (ya da @dx,dy)'], stepsEn: ['Select objects · Finish', 'Base point', 'Target point (or @dx,dy)'] },
  copy: { name: 'Kopyala', en: 'Copy', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Hedef nokta (yineler) · Bitir'], stepsEn: ['Select objects · Finish', 'Base point', 'Target point (repeats) · Finish'] },
  rotate: { name: 'Döndür', en: 'Rotate', steps: ['Nesneleri seçin · Bitir', 'Dönme merkezi', 'Açıyı yazın (°) ya da ikinci noktayı seçin'], stepsEn: ['Select objects · Finish', 'Rotation center', 'Type the angle (°) or pick a second point'] },
  scale: { name: 'Ölçekle', en: 'Scale', steps: ['Nesneleri seçin · Bitir', 'Taban noktası', 'Çarpanı yazın'], stepsEn: ['Select objects · Finish', 'Base point', 'Type the factor'] },
  mirror: { name: 'Aynala', en: 'Mirror', steps: ['Nesneleri seçin · Bitir', 'Ayna çizgisi 1. nokta', 'Ayna çizgisi 2. nokta'], stepsEn: ['Select objects · Finish', 'Mirror line point 1', 'Mirror line point 2'] },
  offset: { name: 'Ofset', en: 'Offset', steps: ['Nesneleri seçin · Bitir', 'Mesafeyi yazın', 'Tarafı seçin (nokta)'], stepsEn: ['Select objects · Finish', 'Type the distance', 'Pick the side (point)'] },
  del: { name: 'Sil', en: 'Delete', steps: ['Nesneleri seçin · Bitir'], stepsEn: ['Select objects · Finish'] },
  setz: { name: 'Kot ata', en: 'Set Z', steps: ['Nesneleri seçin · Bitir', 'Kotu (Z) yazın'], stepsEn: ['Select objects · Finish', 'Type the elevation (Z)'] },
  edittext: { name: 'Yazı düzenle', en: 'Edit text', steps: ['Yazıya dokunun'], stepsEn: ['Tap the text'] },
  // ölçüm
  dist: { name: 'Mesafe', en: 'Distance', steps: ['Noktalara dokunun'], stepsEn: ['Tap points'] },
  area: { name: 'Alan', en: 'Area', steps: ['Köşelere dokunun · Bitir'], stepsEn: ['Tap vertices · Finish'] },
  angle: { name: 'Açı', en: 'Angle', steps: ['Köşe (tepe) noktası', 'Birinci kol noktası', 'İkinci kol noktası'], stepsEn: ['Vertex point', 'First arm point', 'Second arm point'] },
  radius: { name: 'Yarıçap', en: 'Radius', steps: ['Daire ya da yaya dokunun'], stepsEn: ['Tap a circle or arc'] },
  coord: { name: 'Koordinat', en: 'Coordinate', steps: ['Noktaya dokunun'], stepsEn: ['Tap a point'] },
  fillarea: { name: 'Dolgu alanı', en: 'Fill area', steps: ['Kapalı alanın içine dokunun'], stepsEn: ['Tap inside a closed area'] },
  ident: { name: 'Akıllı ölçüm', en: 'Smart measure', steps: ['Nesneye dokunun'], stepsEn: ['Tap an object'] },
  // ölçülendirme ve açıklama
  dim: { name: 'Doğrusal ölçü', en: 'Linear dimension', steps: ['Birinci ölçü noktası', 'İkinci ölçü noktası', 'Ölçü çizgisinin yerini seçin'], stepsEn: ['First extension point', 'Second extension point', 'Pick the dimension line position'] },
  dimh: { name: 'Yatay ölçü', en: 'Horizontal dimension', steps: ['Birinci ölçü noktası', 'İkinci ölçü noktası', 'Ölçü çizgisinin yerini seçin'], stepsEn: ['First extension point', 'Second extension point', 'Pick the dimension line position'] },
  dimv: { name: 'Düşey ölçü', en: 'Vertical dimension', steps: ['Birinci ölçü noktası', 'İkinci ölçü noktası', 'Ölçü çizgisinin yerini seçin'], stepsEn: ['First extension point', 'Second extension point', 'Pick the dimension line position'] },
  dimr: { name: 'Yarıçap ölçüsü', en: 'Radius dimension', steps: ['Daire ya da yaya dokunun'], stepsEn: ['Tap a circle or arc'] },
  dimd: { name: 'Çap ölçüsü', en: 'Diameter dimension', steps: ['Daire ya da yaya dokunun'], stepsEn: ['Tap a circle or arc'] },
  dima: { name: 'Açı ölçüsü', en: 'Angular dimension', steps: ['Tepe (köşe) noktası', 'Birinci kol noktası', 'İkinci kol noktası'], stepsEn: ['Vertex point', 'First arm point', 'Second arm point'] },
  leader: { name: 'Açıklama', en: 'Leader note', steps: ['Ok ucunu seçin', 'Kırılma noktası seçin · Bitir'], stepsEn: ['Pick the arrow tip', 'Pick a bend point · Finish'] },
  cloud: { name: 'Revizyon bulutu', en: 'Revision cloud', steps: ['Köşeleri seçin · Bitir'], stepsEn: ['Pick the corners · Finish'] },
  balloon: { name: 'Numaralandırma', en: 'Numbering', steps: ['Balon konumunu seçin (numara artarak sürer)'], stepsEn: ['Pick the balloon position (the number keeps increasing)'] },
  hatch: { name: 'Tarama', en: 'Hatch', steps: ['Doldurulacak kapalı alanın içine dokunun'], stepsEn: ['Tap inside the closed area to fill'] },
  // düzenleme
  array: { name: 'Dizi', en: 'Array', steps: ['Nesneleri seçin · Bitir'], stepsEn: ['Select objects · Finish'] },
  thick: { name: 'Kalınlık', en: 'Thickness', steps: ['Nesneleri seçin · Bitir', 'Yüksekliği yazın'], stepsEn: ['Select objects · Finish', 'Type the height'] },
  textsize: { name: 'Yazı yüksekliği', en: 'Text height', steps: ['Yazıları seçin · Bitir', 'Yüksekliği yazın'], stepsEn: ['Select texts · Finish', 'Type the height'] },
  explode: { name: 'Patlat', en: 'Explode', steps: ['Blok yerleştirmesine dokunun'], stepsEn: ['Tap a block insertion'] },
  attr: { name: 'Öznitelik düzenle', en: 'Edit attributes', steps: ['Blok yerleştirmesine dokunun'], stepsEn: ['Tap a block insertion'] },
};
{ const tr = {}, en = {}; for (const [k, d] of Object.entries(TOOLS)) { tr['tool_' + k] = d.name; en['tool_' + k] = d.en || d.name; d.steps.forEach((st, i) => { tr[`tstep_${k}_${i}`] = st; en[`tstep_${k}_${i}`] = (d.stepsEn && d.stepsEn[i]) || st; }); } addStrings(tr, en); }
const toolName = (k) => t('tool_' + k);
const toolStep = (k, i) => t(`tstep_${k}_${i}`);
const SELECT_TOOLS = new Set(['move', 'copy', 'rotate', 'scale', 'mirror', 'offset', 'del', 'setz', 'array', 'thick', 'textsize']);
/** Sayı girişi bekleyen araçlar ve hangi adımda beklediği — TEK kaynak (say / typed / tap buraya bakar) */
const NUMBER_STEP = { circle: 1, rotate: 2, scale: 2, offset: 1, setz: 1, thick: 1, textsize: 1 };
/** Nokta değil NESNE (ya da kapalı alan) seçilerek çalışan araçlar */
const OBJECT_TOOLS = new Set(['radius', 'edittext', 'dimr', 'dimd', 'explode', 'attr', 'hatch', 'fillarea', 'ident']);
/** Çok noktalı ölçülendirme / açıklama araçları: taslakları çizgi olarak gösterilir */
const PATH_TOOLS = new Set(['dim', 'dimh', 'dimv', 'dima', 'leader', 'cloud']);
/** Sonraki numara: sayıysa artar, harfle bitiyorsa harf ilerler ("A1"→"A2", "B"→"C") */
function nextLabel(sN) {
  const m = String(sN).match(/^(.*?)(\d+)$/);
  if (m) return m[1] + String(parseInt(m[2], 10) + 1);
  const c = String(sN).trim();
  if (/^[A-Za-z]$/.test(c)) return String.fromCharCode(c.charCodeAt(0) + 1);
  return c + '2';
}

export class ToolManager {
  constructor(api) {
    this.api = api;
    this.active = null;
    this.pts = [];       // toplanan noktalar [x,y,z]
    this.step = 0;
    this.selecting = false;
    this.last = null;    // son nokta (göreli giriş için)
    this.number = null;
    this.draft = null;   // kaplama için önizleme: { segs:[[p,q]…], pts:[…], circle:{c,r}, text }
    this.results = [];
  }
  get running() { return !!this.active; }

  start(name) {
    const def = TOOLS[name];
    if (!def) return;
    this.cancel(true);
    this.active = name; this.pts = []; this.step = 0; this.draft = null; this.results = []; this.balloonNext = null;
    if (SELECT_TOOLS.has(name)) {
      this.selecting = this.api.sel.size === 0;
      if (!this.selecting) { this.step = 1; }
    }
    if (name === 'select') this.selecting = true;
    this.say();
  }
  cancel(silent) {
    if (this.active && this.active !== 'select' && this.pts.length && ['pline', 'pline3d', 'face3d', 'area', 'cloud'].includes(this.active)) this.finish();
    this.active = null; this.pts = []; this.step = 0; this.draft = null; this.selecting = false;
    if (!silent) { this.api.prompt(null); this.api.overlay(); }
  }
  say() {
    const def = TOOLS[this.active];
    if (!def) return;
    let text = toolName(this.active) + ': ';
    if (this.selecting) text += toolStep(this.active, 0) + `  [${this.api.sel.size} ${t('selCount')}]`;
    else text += toolStep(this.active, Math.min(this.step, def.steps.length - 1));
    const wantsNumber = NUMBER_STEP[this.active] != null && this.step === NUMBER_STEP[this.active] && !this.selecting;
    const buttons = [];
    if (this.selecting || ['pline', 'pline3d', 'face3d', 'area', 'copy', 'line', 'dist', 'leader', 'cloud'].includes(this.active)) buttons.push('finish');
    if (['pline', 'area', 'cloud'].includes(this.active) && this.pts.length > 2) buttons.push('close');
    if (this.pts.length) buttons.push('back');
    if (this.selecting) buttons.push('selall');
    buttons.push('cancel');
    this.api.prompt(text, { input: wantsNumber ? 'number' : (this.selecting ? null : 'point'), buttons });
  }

  // ---- giriş -----------------------------------------------------------------------
  /** yazılı giriş: koordinat ya da sayı */
  typed(text) {
    const s = String(text).trim().replace(/,/g, (m, i, str) => (str.indexOf(',') !== str.lastIndexOf(',') || /\d,\d{1,3}$/.test(str) && !/,.*,/.test(str) && false) ? ',' : ',');
    if (!s) return;
    if (this.selecting) return;
    if (NUMBER_STEP[this.active] != null && this.step === NUMBER_STEP[this.active]) {
      const v = parseFloat(s.replace(',', '.'));
      if (!isFinite(v)) { this.api.toast(t('numberExpected')); return; }
      this.number = v;
      this.onNumber(v);
      return;
    }
    const p = this.parsePoint(s);
    if (!p) { this.api.toast(t('coordFormat')); return; }
    void this.point(p, null);
  }
  parsePoint(s) {
    const rel = s.startsWith('@');
    const body = rel ? s.slice(1) : s;
    const norm = (v) => parseFloat(v.trim().replace(',', '.'));
    if (body.includes('<')) {
      const [L, A] = body.split('<');
      const l = norm(L), a = norm(A) * D2R;
      if (!isFinite(l) || !isFinite(a)) return null;
      const base = this.last || [0, 0, 0];
      return [base[0] + l * Math.cos(a), base[1] + l * Math.sin(a), base[2] || 0];
    }
    // "x;y" ya da "x y" ya da "x,y" — ondalık ayırıcı nokta kabul edilir
    const parts = body.split(/[;\s]+|,(?=\s*-?\d)/).filter(Boolean);
    if (parts.length < 2) return null;
    const v = parts.map(norm);
    if (v.some(x => !isFinite(x))) return null;
    if (rel) { const b = this.last || [0, 0, 0]; return [b[0] + v[0], b[1] + v[1], (b[2] || 0) + (v[2] || 0)]; }
    return [v[0], v[1], v[2] || 0];
  }
  /** dokunma: w = dünya [x,y]; prim = dokunulan nesne (seçim için) */
  tap(w, screen) {
    if (!this.active) return false;
    if (this.selecting) {
      const p = this.api.pick(w);
      if (p) {
        // Grup damgası taşıyan parçalar (ölçülendirme, balon, lider) birlikte seçilir: biri taşınırsa hepsi taşınır
        const gid = p.info && p.info.gid;
        const group = gid ? this.api.visiblePrims().filter(q => q.info && q.info.gid === gid) : [p];
        const on = this.api.sel.has(p);
        for (const q of group) { if (on) this.api.sel.delete(q); else this.api.sel.add(q); }
        this.say(); this.api.overlay();
      }
      return true;
    }
    if (OBJECT_TOOLS.has(this.active)) { void this.objectTap(w); return true; }
    const sn = this.api.snap(w);
    const p = sn ? [sn.p[0], sn.p[1], sn.p[2] != null ? sn.p[2] : 0] : [w[0], w[1], 0];
    if (NUMBER_STEP[this.active] === this.step) {
      const need = { scale: 'typeFactor', setz: 'typeZ', offset: 'typeDist', thick: 'typeHeight', textsize: 'typeHeight' }[this.active];
      if (need) { this.api.toast(t(need)); return true; }
    }
    void this.point(p, sn);
    return true;
  }
  /** yazı düzenleme kutusu (uygulama içi diyalog) */
  async editText(p) {
    const old = p.lines.join('\n');
    const txt = await askText(t('textPrompt'), old, { multiline: true, words: true });
    if (txt !== null && txt !== old) this.api.run({ op: 'edittext', keys: [p.key], text: txt });
    this.api.render();
  }
  /*
   * AKILLI ÖLÇÜM. Kullanıcı hangi ölçüyü istediğini önceden seçmez: nesneye dokunur, araç türünü
   * anlar ve o türün ANLAMLI ölçüsünü verir — daireden yarıçap/çap/çevre/alan, yaydan yay boyu ve
   * açı, doğrudan eğik ve yatay boy, kapalı yoldan alan ve çevre, yazıdan içerik ve yükseklik,
   * ağdan yüzey ve hacim. Bilgi panelinden farkı: yalnız ÖLÇÜ verir (renk, katman, çizgi tipi yok),
   * sonuç ölçüm sonucu olarak basılır, taslağı çizilir ve panodan/CSV'den dışarı çıkabilir.
   */
  identify(p) {
    const A = this.api, u = A.units(), k = A.unitToM() || 1;
    const rows = [], inf = p.info || {};
    const tur = inf.t || (p.k === 5 ? 'MESH' : p.k === 1 ? 'TEXT' : p.k === 2 ? 'POINT' : 'ENTITY');
    rows.push([t('entityTypes'), A.trType ? A.trType(tur) : tur]);
    if (p.k === 0) {
      const yay = p.ops.find(q => q[0] === 2 || q[0] === -2);
      const kapali = !!(p.closed || p.fill);
      const pts = flatten(p.ops);
      const boy = pathLength3(p.ops, p.closed), boyH = pathLength(p.ops, p.closed);
      if (yay && p.ops.length <= 2) {
        const tam = Math.abs(((yay[5] - yay[4]) % TAU)) < 1e-9;
        rows.push([t('radius'), A.fmt(yay[3]) + u], [t('diameter'), A.fmt(2 * yay[3]) + u]);
        rows.push([tam ? t('circumference') : t('arcLen'), A.fmt(boy) + u]);
        if (!tam) rows.push([t('angle'), A.fmt(((yay[5] - yay[4] + TAU) % TAU) * 180 / Math.PI, 2) + '°']);
        if (tam) rows.push([t('area'), A.fmt(Math.PI * yay[3] * yay[3]) + (u ? u + '\u00b2' : '')]);
        rows.push([t('center'), A.fmt(yay[1]) + ' ; ' + A.fmt(yay[2])]);
        this.draft = { circle: { c: [yay[1], yay[2]], r: yay[3] } };
      } else {
        rows.push([kapali ? t('perimeter') : t('length'), A.fmt(boy) + u]);
        if (Math.abs(boy - boyH) > Math.max(1e-9, boy * 1e-9)) rows.push([t('lengthH'), A.fmt(boyH) + u]);
        if (k !== 1) rows.push([t('length') + ' (m)', A.fmt(boy * k, 2) + ' m']);
        if (kapali && pts.length >= 3) {
          const al = Math.abs(polyArea(pts));
          rows.push([t('area'), A.fmt(al) + (u ? u + '\u00b2' : '')]);
          if (k !== 1) rows.push([t('areaM2'), A.fmt(al * k * k, 2) + ' m\u00b2'], [t('areaDa'), A.fmt(al * k * k / 1000, 3) + ' da']);
          else rows.push([t('areaDa'), A.fmt(al / 1000, 3) + ' da']);
        }
        rows.push([t('vertices'), pts.length]);
        if (pts.length) {
          const f0 = pts[0], l0 = pts[pts.length - 1];
          rows.push([t('start'), A.fmt(f0[0]) + ' ; ' + A.fmt(f0[1])], [t('end'), A.fmt(l0[0]) + ' ; ' + A.fmt(l0[1])]);
          if (pts.length === 2) rows.push([t('angle'), A.fmt(Math.atan2(l0[1] - f0[1], l0[0] - f0[0]) * 180 / Math.PI, 2) + '°']);
        }
        this.draft = { pts, segs: pts.slice(1).map((q, i) => [pts[i], q]), close: kapali, keep: true };
      }
    } else if (p.k === 1) {
      rows.push([t('textK'), (p.lines || []).join(' ').slice(0, 120)], [t('height'), A.fmt(p.h) + u],
        [t('position'), A.fmt(p.x) + ' ; ' + A.fmt(p.y)]);
    } else if (p.k === 5) {
      const m = A.meshMetrics ? A.meshMetrics(p) : null;
      if (m) {
        rows.push([t('surfTotal'), A.fmt(m.total) + (u ? u + '\u00b2' : '')]);
        if (m.lateral) rows.push([t('surfLateral'), A.fmt(m.lateral) + (u ? u + '\u00b2' : '')]);
        if (m.volume) rows.push([t('volume'), A.fmt(m.volume) + (u ? u + '\u00b3' : '')]);
      }
      rows.push([t('triCount'), (p.idx ? p.idx.length / 3 : 0)]);
      if (p.zmin != null) rows.push([t('elev'), A.fmt(p.zmin) + ' … ' + A.fmt(p.zmax) + u]);
    } else if (p.k === 2) {
      rows.push([t('position'), A.fmt(p.x) + ' ; ' + A.fmt(p.y)]);
    }
    const bb = p.bb;
    if (bb && isFinite(bb[0])) rows.push([t('size'), A.fmt(bb[2] - bb[0]) + ' × ' + A.fmt(bb[3] - bb[1]) + u]);
    if (inf.name) rows.push([t('blockN'), inf.name]);
    if (inf.lay) rows.push([t('layer'), inf.lay]);
    A.result(rows);
    A.overlay();
  }
  /**
   * Nesneye (ya da kapalı alana) dokunarak çalışan araçlar. Ölçülendirmede dokunulan daireden
   * yarıçap okunur, patlatmada ve öznitelikte dokunulan ilkelin BLOK bilgisi kullanılır.
   */
  async objectTap(w) {
    const A = this.api, act = this.active;
    if (act === 'hatch' || act === 'fillarea') { await this.regionTap(w); return; }
    const p = A.pick(w);
    if (!p) { A.toast(t('noObject')); return; }
    if (act === 'ident') { this.identify(p); return; }
    if (act === 'radius' || act === 'dimr' || act === 'dimd') {
      const o = p.k === 0 ? p.ops.find(q => q[0] === 2 || q[0] === -2) : null;
      if (!o) { A.toast(t('notCircle')); return; }
      const u = A.units();
      if (act === 'radius') {
        A.result([[t('radius'), A.fmt(o[3]) + u], [t('diameter'), A.fmt(2 * o[3]) + u], [t('center'), A.fmt(o[1]) + ' ; ' + A.fmt(o[2])], [t('circumference'), A.fmt(pathLength3(p.ops, p.closed)) + u]]);
        this.draft = { circle: { c: [o[1], o[2]], r: o[3] } }; A.overlay();
        return;
      }
      const kind = act === 'dimd' ? 'diameter' : 'radius';
      const label = (kind === 'diameter' ? '\u2300 ' : 'R ') + A.fmt(kind === 'diameter' ? 2 * o[3] : o[3]) + u;
      const res = dimRadial(kind, [o[1], o[2], o[6] || 0], o[3], [w[0], w[1], o[6] || 0], this.annotOpts({ label }));
      if (res) { this.commitMany(res.ents); A.toast(label); } else A.toast(t('dimFail'));
      return;
    }
    if (act === 'edittext') {
      if (p.k !== 1) { A.toast(t('notText')); return; }
      await this.editText(p);
      return;
    }
    const inf = p.info;
    if (act === 'explode') {
      if (!inf || inf.t !== 'INSERT') { A.toast(t('notBlock')); return; }
      const group = A.allPrims().filter(q => q.info && q.info.h === inf.h && q.info.t === 'INSERT');
      if (!group.length) { A.toast(t('notBlock')); return; }
      const ids = group.map(() => newId());
      if (A.run({ op: 'explode', h: inf.h, ids })) { A.toast(t('exploded') + ' \u00b7 ' + group.length); A.render(); }
      return;
    }
    if (act === 'attr') {
      if (!inf || !inf.attrs || !inf.attrs.length) { A.toast(t('noAttribs')); return; }
      const fields = inf.attrs.map((a, i) => ({ id: 'a' + i, label: a[0] || ('#' + (i + 1)), type: 'text', value: a[1] }));
      const res = await askForm(t('attrEdit') + (inf.name ? ' \u2014 ' + inf.name : ''), fields, { ok: t('apply') });
      if (!res) return;
      const items = [];
      inf.attrs.forEach((a, i) => { const v = res['a' + i]; if (v != null && String(v) !== String(a[1])) items.push({ i, value: String(v) }); });
      if (!items.length) return;
      if (A.run({ op: 'attrib', h: inf.h, items })) { A.toast(t('applied')); A.render(); }
    }
  }
  /** Kapalı alana dokunma: tarama ekler ya da alanı ölçer */
  async regionTap(w) {
    const A = this.api;
    const reg = enclosingPrim(A.visiblePrims(), w[0], w[1]);
    if (!reg) { A.toast(t('noRegion')); return; }
    const u = A.units(), k = A.unitToM() || 1;
    const z = (reg.prim.ops[0] && reg.prim.ops[0][3]) || 0;
    const pts = reg.pts.map(q => [q[0], q[1], z]);
    if (this.active === 'fillarea') {
      const per = pathLength3(reg.prim.ops, true);
      const rows = [[t('area'), A.fmt(reg.area) + (u ? u + '\u00b2' : '')], [t('perimeter'), A.fmt(per) + u], [t('cornersN'), pts.length]];
      if (k !== 1) rows.push([t('areaM2'), A.fmt(reg.area * k * k, 2) + ' m\u00b2'], [t('areaDa'), A.fmt(reg.area * k * k / 1000, 3) + ' da']);
      else rows.push([t('areaDa'), A.fmt(reg.area / 1000, 3) + ' da'], [t('areaHa'), A.fmt(reg.area / 10000, 4) + ' ha']);
      A.result(rows);
      this.draft = { pts, segs: pts.slice(1).map((q, i) => [pts[i], q]), close: true, keep: true };
      A.overlay();
      return;
    }
    // Desen, araç çubuğundaki "Desen" karosundan gelir; SOLID varsayılandır (eski davranış).
    const hp = (A.hatchPattern && A.hatchPattern()) || { name: 'SOLID', scale: 1, angle: 0 };
    const r = hatchEnts(pts, { pattern: hp.name, scale: hp.scale, angle: hp.angle, layer: A.layer(), color: A.color(), alpha: 1 });
    if (!r) { A.toast(t('error')); return; }
    this.commitMany(r.ents);
    A.toast(t('hatchAdded') + ' \u00b7 ' + (r.pattern === 'SOLID' ? t('patSolid') : r.pattern) + ' \u00b7 ' + A.fmt(reg.area) + (u ? u + '\u00b2' : ''));
  }
  /** Açıklama üreticilerine verilen ortak seçenekler (yazı yüksekliği, katman, renk, grup) */
  annotOpts(extra) {
    const A = this.api;
    return { h: A.textHeight() * 2.2, layer: A.layer(), color: A.color(), gid: newId(), ...(extra || {}) };
  }
  /** Birden çok varlığı TEK komutla ekler: tek geri alma, tek kayıt satırı */
  commitMany(ents) {
    const A = this.api;
    const list = (ents || []).filter(Boolean).map(e => ({ ...e, id: newId(), layer: e.layer || A.layer(), color: e.color == null ? A.color() : e.color }));
    if (!list.length) return false;
    const ok = A.run({ op: 'add', ents: list });
    A.render();
    return ok;
  }
  /** Doğrusal / yatay / düşey ölçülendirme (üç nokta toplandığında) */
  makeLinearDim() {
    const A = this.api;
    const kind = this.active === 'dimh' ? 'horizontal' : this.active === 'dimv' ? 'vertical' : 'aligned';
    const [p1, p2, q] = this.pts;
    const measure = kind === 'horizontal' ? Math.abs(p2[0] - p1[0]) : kind === 'vertical' ? Math.abs(p2[1] - p1[1]) : Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (!(measure > 1e-12)) { A.toast(t('dimFail')); return; }
    const label = A.fmt(measure) + A.units();
    const res = dimLinear(kind, p1, p2, q, this.annotOpts({ label }));
    if (!res) { A.toast(t('dimFail')); return; }
    this.commitMany(res.ents);
    A.toast(label);
  }
  /** Açı ölçülendirmesi (tepe + iki kol) */
  makeAngularDim() {
    const A = this.api;
    const [v, a, b] = this.pts;
    let sweep = Math.atan2(b[1] - v[1], b[0] - v[0]) - Math.atan2(a[1] - v[1], a[0] - v[0]);
    while (sweep <= -Math.PI) sweep += TAU;
    while (sweep > Math.PI) sweep -= TAU;
    const deg = Math.abs(sweep) * R2D;
    if (!(deg > 1e-9)) { A.toast(t('dimFail')); return; }
    const label = A.fmt(deg, 2) + '\u00b0';
    const res = dimAngular(v, a, b, this.annotOpts({ label }));
    if (!res) { A.toast(t('dimFail')); return; }
    this.commitMany(res.ents);
    A.toast(label);
  }
  /** Numaralandırma balonu; ilk dokunuşta başlangıç numarası sorulur, sonra kendiliğinden artar */
  async makeBalloon(p) {
    const A = this.api;
    if (this.balloonNext == null) {
      const v = await askText(t('balloonStart'), '1');
      if (v === null) { this.cancel(); return; }
      this.balloonNext = String(v).trim() || '1';
    }
    const ents = balloonEnts(p, this.balloonNext, this.annotOpts({}));
    this.commitMany(ents);
    A.toast(String(this.balloonNext));
    this.balloonNext = nextLabel(this.balloonNext);
  }
  /** Dizi (artımlı kopya): seçim bittiğinde sayı kutusu açılır, bütün kopyalar tek komutta oluşur */
  async runArray() {
    const A = this.api;
    const keys = [...A.sel].map(q => q.key);
    if (!keys.length) { A.toast(t('selEmpty')); this.cancel(); return; }
    const bb = [...A.sel].reduce((acc, q) => [Math.min(acc[0], q.bb[0]), Math.min(acc[1], q.bb[1]), Math.max(acc[2], q.bb[2]), Math.max(acc[3], q.bb[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const w = isFinite(bb[0]) ? Math.max(bb[2] - bb[0], 1e-6) : 1, h = isFinite(bb[1]) ? Math.max(bb[3] - bb[1], 1e-6) : 1;
    const res = await askForm(t('arrayTitle'), [
      { id: 'kind', label: t('arrayKind'), type: 'select', value: 'rect', options: [['rect', t('arrayRect')], ['polar', t('arrayPolar')]] },
      { id: 'nx', label: t('arrayCols'), type: 'number', value: 3 },
      { id: 'ny', label: t('arrayRows'), type: 'number', value: 1 },
      { id: 'dx', label: t('arrayDx'), type: 'number', value: Math.round(w * 1.2 * 1000) / 1000 },
      { id: 'dy', label: t('arrayDy'), type: 'number', value: Math.round(h * 1.2 * 1000) / 1000 },
      { id: 'n', label: t('arrayCount'), type: 'number', value: 6 },
      { id: 'total', label: t('arrayAngle'), type: 'number', value: 360 },
      { id: 'rotate', label: t('arrayRotate'), type: 'check', value: true },
    ], { ok: t('apply'), hint: t('arrayHint') });
    if (!res) { this.cancel(); return; }
    const prm = res.kind === 'polar'
      ? { n: res.n, total: res.total, rotate: res.rotate, center: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], base: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] }
      : { nx: res.nx, ny: res.ny, dx: res.dx, dy: res.dy };
    const items = arrayItems(res.kind === 'polar' ? 'polar' : 'rect', prm).map(it => ({ ...it, newKeys: keys.map(() => newId()) }));
    if (!items.length) { A.toast(t('arrayNone')); this.cancel(); return; }
    if (items.length * keys.length > 20000) { A.toast(t('arrayTooMany')); this.cancel(); return; }
    if (A.run({ op: 'array', keys, items })) A.toast(t('arrayDone') + ' \u00b7 ' + (items.length + 1));
    A.render();
    this.done();
  }
  onNumber(v) {
    const A = this.api;
    switch (this.active) {
      case 'circle': { const c = this.pts[0]; this.commit({ type: 'CIRCLE', pts: [c], r: Math.abs(v) }); this.pts = []; this.step = 0; break; }
      case 'rotate': { const c = this.pts[0]; this.xform(rotM(c, v * D2R)); this.done(); break; }
      case 'scale': { const c = this.pts[0]; if (!(v > 0)) { A.toast(t('factorPositive')); return; } this.xform([v, 0, 0, v, c[0] * (1 - v), c[1] * (1 - v)]); this.done(); break; }
      case 'setz': { A.run({ op: 'setz', keys: [...A.sel].map(p => p.key), z: v }); A.toast(t('zSet') + ': ' + A.fmt(v)); this.done(); break; }
      case 'offset': { this.number = v; this.step = 2; this.say(); break; }
      case 'thick': {
        if (!isFinite(v) || v === 0) { A.toast(t('numberExpected')); return; }
        const ents = [];
        for (const q of A.sel) {
          if (q.k !== 0 || !q.ops || q.ops.length < 2) continue;
          const z = (q.ops[0] && q.ops[0][3]) || 0;
          const pts = flatten(q.ops).map(c => [c[0], c[1], z]);
          if (pts.length < 2) continue;
          const cl = !!(q.closed || q.fill);
          ents.push({ type: 'EXTRUDE', pts, h: v, closed: cl, cap: cl, layer: q.lay, color: q.info && q.info.ci != null ? q.info.ci : 256 });
        }
        if (ents.length) { this.commitMany(ents); A.toast(t('thickDone') + ' \u00b7 ' + ents.length); } else A.toast(t('thickNone'));
        this.done(); break;
      }
      case 'textsize': {
        if (!(v > 0)) { A.toast(t('numberExpected')); return; }
        const keys = [...A.sel].filter(q => q.k === 1).map(q => q.key);
        if (keys.length) { A.run({ op: 'textheight', keys, h: v }); A.toast(t('applied') + ' \u00b7 ' + keys.length); } else A.toast(t('notText'));
        this.done(); break;
      }
      default: break;
    }
    A.render();
  }
  /** toplanan nokta (kot / yazı / ayna onayı sorulabildiğinden async; çağıranlar beklemez) */
  async point(p, sn) {
    const A = this.api;
    this.pts.push(p); this.last = p;
    const n = this.pts.length;
    switch (this.active) {
      case 'line':
        if (n >= 2) { this.commit({ type: 'LINE', pts: [this.pts[n - 2], this.pts[n - 1]] }); this.pts = [p]; }
        this.step = 1; break;
      case 'pline': case 'area': this.step = 1; break;
      case 'pline3d': case 'face3d': {
        if (!sn || sn.p[2] == null) {
          const v = await askText(`${n}. ${t('pointZ')}`, this.last && n > 1 ? String(this.pts[n - 2][2]) : '0', { type: 'number' });
          if (v === null) { this.pts.pop(); return; }
          p[2] = parseFloat(String(v).replace(',', '.')) || 0;
        }
        if (this.active === 'face3d' && n === 4) { this.finish(); return; }
        this.step = Math.min(n, TOOLS[this.active].steps.length - 1); break;
      }
      case 'rect': if (n === 2) { const [a, b] = this.pts; this.commit({ type: 'LWPOLYLINE', closed: true, pts: [[a[0], a[1], a[2]], [b[0], a[1], a[2]], [b[0], b[1], a[2]], [a[0], b[1], a[2]]] }); this.pts = []; this.step = 0; } else this.step = 1; break;
      case 'circle': if (n === 2) { const [c, q] = this.pts; this.commit({ type: 'CIRCLE', pts: [c], r: Math.hypot(q[0] - c[0], q[1] - c[1]) }); this.pts = []; this.step = 0; } else this.step = 1; break;
      case 'arc3': if (n === 3) { const arc = arc3(this.pts[0], this.pts[1], this.pts[2]); if (arc) this.commit({ type: 'ARC', pts: [[arc.cx, arc.cy, this.pts[0][2]]], r: arc.r, a0: arc.a0, a1: arc.a1 }); else A.toast(t('collinear')); this.pts = []; this.step = 0; } else this.step = n; break;
      case 'point': this.commit({ type: 'POINT', pts: [p] }); this.pts = []; break;
      case 'text': {
        const txt = await askText(t('textPrompt'), '', { multiline: true, words: true });
        if (txt) { const h = await askText(t('textHeightPrompt'), String(A.textHeight()), { type: 'number' }); const hv = parseFloat(String(h || '').replace(',', '.')); this.commit({ type: 'TEXT', pts: [p], text: txt, h: hv > 0 ? hv : A.textHeight() }); }
        this.pts = []; break;
      }
      case 'dim': case 'dimh': case 'dimv': {
        if (n === 3) { this.makeLinearDim(); this.pts = []; this.step = 0; } else this.step = n;
        break;
      }
      case 'dima': {
        if (n === 3) { this.makeAngularDim(); this.pts = []; this.step = 0; } else this.step = n;
        break;
      }
      case 'leader': case 'cloud': this.step = 1; break;
      case 'balloon': { await this.makeBalloon(p); this.pts = []; break; }
      case 'move': case 'copy': case 'rotate': case 'scale': case 'mirror': case 'offset': await this.modifyPoint(); break;
      case 'dist': this.step = 1; this.showDist(); break;
      case 'angle': if (n === 3) { const [v, a, b] = this.pts; const ang = Math.abs(angDiff(Math.atan2(a[1] - v[1], a[0] - v[0]), Math.atan2(b[1] - v[1], b[0] - v[0]))) * R2D; A.result([[t('angle'), A.fmt(ang, 2) + '°'], [t('supplement'), A.fmt(360 - ang, 2) + '°'], [t('arm1'), A.fmt(Math.hypot(a[0] - v[0], a[1] - v[1])) + A.units()], [t('arm2'), A.fmt(Math.hypot(b[0] - v[0], b[1] - v[1])) + A.units()]]); this.draft = { segs: [[v, a], [v, b]], pts: this.pts.slice() }; this.pts = []; this.step = 0; } else this.step = n; break;
      case 'coord': {
        const rows = [['X', A.fmt(p[0])], ['Y', A.fmt(p[1])], ['Z', A.fmt(p[2] || 0)]];
        if (sn) rows.push([t('snapLbl'), sn.kind.toUpperCase()]);
        const ll = A.lonLat ? A.lonLat(p[0], p[1]) : null;
        if (ll) rows.push([t('latLon'), ll[1].toFixed(6) + ' / ' + ll[0].toFixed(6)]);
        rows.push([`<div class="full btns"><button class="btn small" id="tCopy">${t('copy')}</button></div>`]);
        A.result(rows, () => A.copy(A.fmt(p[0]) + ';' + A.fmt(p[1]) + ';' + A.fmt(p[2] || 0)));
        this.draft = { pts: [p] }; this.pts = []; break;
      }
      default: break;
    }
    this.updateDraft();
    this.say();
    A.overlay();
  }
  async modifyPoint() {
    const A = this.api;
    const n = this.pts.length;
    if (this.active === 'move' && n === 2) { const [a, b] = this.pts; this.xform([1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], (b[2] || 0) - (a[2] || 0)); this.done(); return; }
    if (this.active === 'copy' && n >= 2) { const a = this.pts[0], b = this.pts[n - 1]; const keys = [...A.sel].map(p => p.key); A.run({ op: 'copy', keys, newKeys: keys.map(() => newId()), m: [1, 0, 0, 1, b[0] - a[0], b[1] - a[1]], dz: (b[2] || 0) - (a[2] || 0) }); A.render(); this.step = 2; return; }
    if (this.active === 'rotate' && n === 2) { const [c, q] = this.pts; this.xform(rotM(c, Math.atan2(q[1] - c[1], q[0] - c[0]))); this.done(); return; }
    if (this.active === 'mirror' && n === 2) { const [a, b] = this.pts; const keys = [...A.sel].map(p => p.key); const m = mirrorM(a, b); const keep = await askConfirm(t('keepOriginals')); if (keep) A.run({ op: 'copy', keys, newKeys: keys.map(() => newId()), m }); else A.run({ op: 'xform', keys, m }); A.render(); this.done(); return; }
    if (this.active === 'offset' && this.step === 2) {
      const side = this.pts[n - 1]; const d = Math.abs(this.number || 0);
      const ents = [];
      for (const p of A.sel) {
        if (p.k !== 0) continue;
        const pts = flatten(p.ops).map((q, i) => [q[0], q[1], 0]);
        const o1 = offsetPoints(pts, d, p.closed), o2 = offsetPoints(pts, -d, p.closed);
        if (!o1 || !o2) continue;
        const dist = (arr) => Math.min(...arr.map((q, i) => i ? segDist(side[0], side[1], arr[i - 1][0], arr[i - 1][1], q[0], q[1]) : Infinity));
        const pick = dist(o1) < dist(o2) ? o1 : o2;
        ents.push({ type: pts.length === 2 ? 'LINE' : 'LWPOLYLINE', pts: pick, closed: p.closed, layer: p.lay, color: p.info && p.info.ci != null ? p.info.ci : 256, id: newId() });
      }
      if (ents.length) A.run({ op: 'add', ents }); else A.toast(t('offsetFail'));
      A.render(); this.done(); return;
    }
    this.step = Math.min(n + 1, TOOLS[this.active].steps.length - 1);
  }
  xform(m, dz = 0) { const keys = [...this.api.sel].map(p => p.key); if (!keys.length) return; this.api.run({ op: 'xform', keys, m, dz }); this.api.render(); }
  done() { this.pts = []; this.step = 0; this.api.sel.clear(); this.api.toast(toolName(this.active) + ' ' + t('applied')); this.cancel(); }
  commit(ent) {
    const A = this.api;
    ent.id = newId(); ent.layer = ent.layer || A.layer(); if (ent.color == null) ent.color = A.color();
    A.run({ op: 'add', ents: [ent] });
    A.render();
  }
  /** Bitir düğmesi */
  finish() {
    const A = this.api;
    if (this.selecting) {
      if (!A.sel.size) { A.toast(t('selEmpty')); return; }
      this.selecting = false;
      if (this.active === 'select') { this.cancel(); return; }
      if (this.active === 'del') { A.run({ op: 'delete', keys: [...A.sel].map(p => p.key) }); A.render(); A.toast(t('deleted')); this.done(); return; }
      if (this.active === 'array') { void this.runArray(); return; }
      this.step = 1; this.say(); return;
    }
    const n = this.pts.length;
    if (this.active === 'pline' && n >= 2) { this.commit({ type: 'LWPOLYLINE', pts: this.pts.slice(), closed: false }); this.pts = []; this.step = 0; }
    else if (this.active === 'pline3d' && n >= 2) { this.commit({ type: 'POLYLINE3D', pts: this.pts.slice() }); this.pts = []; this.step = 0; }
    else if (this.active === 'face3d' && n >= 3) { this.commit({ type: '3DFACE', pts: this.pts.slice(0, 4) }); this.pts = []; this.step = 0; }
    else if (this.active === 'area' && n >= 3) { this.showArea(); this.pts = []; this.step = 0; }
    else if (this.active === 'leader' && n >= 2) { void this.finishLeader(); return; }
    else if (this.active === 'cloud' && n >= 3) { this.finishCloud(); }
    else if (this.active === 'line' || this.active === 'dist') { this.pts = []; this.step = 0; }
    else if (this.active === 'copy') { this.done(); return; }
    this.draft = null; this.say(); A.overlay();
  }
  /** Lider: yol tamamlandığında metin sorulur, ok + kırık çizgi + yazı tek komutta eklenir */
  async finishLeader() {
    const A = this.api;
    const pts = this.pts.slice();
    const txt = await askText(t('leaderPrompt'), '', { words: true });
    if (txt) {
      const r = leaderEnts(pts, txt, this.annotOpts({}));
      if (r) this.commitMany(r.ents);
    }
    this.pts = []; this.step = 0; this.draft = null; this.say(); A.overlay();
  }
  /** Revizyon bulutu: yay yarıçapı çevrilen alanın büyüklüğünden türetilir */
  finishCloud() {
    const A = this.api;
    const pts = this.pts.slice();
    const bb = pts.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    const r = Math.max(1e-9, Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 22);
    const e = cloudEnt(pts, r, { layer: A.layer(), color: A.color(), gid: newId() });
    if (e) { this.commitMany(e); A.toast(t('cloudAdded')); } else A.toast(t('dimFail'));
    this.pts = []; this.step = 0;
  }
  close() {
    if (this.active === 'pline' && this.pts.length > 2) { this.commit({ type: 'LWPOLYLINE', pts: this.pts.slice(), closed: true }); this.pts = []; this.step = 0; this.draft = null; this.say(); this.api.overlay(); }
    else if (this.active === 'area' || this.active === 'cloud') this.finish();
  }
  back() { this.pts.pop(); this.step = Math.max(0, this.step - 1); this.updateDraft(); this.say(); this.api.overlay(); }
  selectAll() { for (const p of this.api.visiblePrims()) if (p.k !== 4) this.api.sel.add(p); this.say(); this.api.overlay(); }

  updateDraft() {
    const pts = this.pts;
    if (['pline', 'pline3d', 'area', 'line', 'dist', 'face3d', 'mirror', 'leader', 'cloud', 'dim', 'dimh', 'dimv'].includes(this.active)) this.draft = { pts: pts.slice(), segs: pts.slice(1).map((q, i) => [pts[i], q]), close: ['area', 'face3d', 'cloud'].includes(this.active) };
    else if (this.active === 'rect' && pts.length === 1) this.draft = { pts: pts.slice() };
    else if (this.active === 'circle' && pts.length === 1) this.draft = { pts: pts.slice() };
    else if (this.active === 'arc3') this.draft = { pts: pts.slice(), segs: pts.slice(1).map((q, i) => [pts[i], q]) };
    else if (['move', 'copy', 'rotate', 'scale', 'offset'].includes(this.active)) this.draft = { pts: pts.slice() };
    else if (this.active === 'angle' || this.active === 'dima') this.draft = { pts: pts.slice(), segs: pts.slice(1).map(q => [pts[0], q]) };
  }
  showDist() {
    const A = this.api, m = this.pts, u = A.units();
    if (m.length < 2) return;
    const rows = []; let total = 0, total3 = 0;
    for (let i = 1; i < m.length; i++) {
      const d = Math.hypot(m[i][0] - m[i - 1][0], m[i][1] - m[i - 1][1]), dz = (m[i][2] || 0) - (m[i - 1][2] || 0), d3 = Math.hypot(d, dz);
      total += d; total3 += d3;
      const ang = Math.atan2(m[i][1] - m[i - 1][1], m[i][0] - m[i - 1][0]) * R2D;
      rows.push([`${i} → ${i + 1}`, `${A.fmt(d)}${u}  ΔX ${A.fmt(m[i][0] - m[i - 1][0])}  ΔY ${A.fmt(m[i][1] - m[i - 1][1])}` + (dz ? `  ΔZ ${A.fmt(dz)}  3B ${A.fmt(d3)}${u}` : '') + `  ${A.fmt(ang, 2)}°` + (A.unitToM() && A.unitToM() !== 1 ? `  = ${A.fmt(d * A.unitToM(), 2)} m` : '')]);
    }
    if (m.length > 2) rows.push([t('total'), A.fmt(total) + u + (total3 !== total ? ` (3B ${A.fmt(total3)}${u})` : '')]);
    A.result(rows);
  }
  showArea() {
    const A = this.api, m = this.pts, u = A.units();
    const area = polyArea(m), per = pathLength3(m.map((q, i) => [i ? 1 : 0, q[0], q[1]]), true);
    const rows = [[t('area'), A.fmt(area) + (u ? u + '²' : '')], [t('perimeter'), A.fmt(per) + u], [t('cornersN'), m.length]];
    if (A.unitToM() && A.unitToM() !== 1) rows.push([t('areaM2'), A.fmt(area * A.unitToM() ** 2, 2) + ' m²'], [t('areaDa'), A.fmt(area * A.unitToM() ** 2 / 1000, 3) + ' da']);
    else if (A.unitToM() === 1) rows.push([t('areaDa'), A.fmt(area / 1000, 3) + ' da'], [t('areaHa'), A.fmt(area / 10000, 4) + ' ha']);
    A.result(rows);
    this.draft = { pts: m.slice(), segs: m.slice(1).map((q, i) => [m[i], q]), close: true, keep: true };
  }
}

// ---- yardımcılar ------------------------------------------------------------------------
export function rotM(c, a) { const cs = Math.cos(a), sn = Math.sin(a); return [cs, sn, -sn, cs, c[0] - cs * c[0] + sn * c[1], c[1] - sn * c[0] - cs * c[1]]; }
export function mirrorM(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const A = (dx * dx - dy * dy) / L2, B = 2 * dx * dy / L2;
  // yansıma: p' = R (p - a) + a
  return [A, B, B, -A, a[0] - A * a[0] - B * a[1], a[1] - B * a[0] + A * a[1]];
}
export function arc3(p1, p2, p3) {
  const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  let a0 = Math.atan2(ay - uy, ax - ux), am = Math.atan2(by - uy, bx - ux), a1 = Math.atan2(cy - uy, cx - ux);
  // orta nokta yay üzerinde olacak şekilde yön seç (saat yönü tersi a0→a1)
  const n = (v) => ((v % TAU) + TAU) % TAU;
  const inCcw = n(am - a0) <= n(a1 - a0);
  if (!inCcw) [a0, a1] = [a1, a0];
  return { cx: ux, cy: uy, r, a0, a1 };
}
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
