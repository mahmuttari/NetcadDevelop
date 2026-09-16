/**
 * acad.js — AutoCAD komut adları ve kısaltmaları
 *
 * NE İŞE YARAR
 *   Hedef kullanıcı AutoCAD kaslıdır: TR yazınca budama, F yazınca kavis bekler. Bu tablo o
 *   beklentiyi karşılar. Tek kaynaktır — komut satırı, İngilizce arayüz etiketleri ve yardım
 *   listesi hepsi buradan okur; hiçbir dosya kendi adını yazmaz.
 *
 * ÜÇ KURAL
 *  1. Kısaltmalar UYDURULMAZ. Buradaki kısaltmalar AutoCAD'in kendi komut kısaltma dosyasındaki
 *     (acad.pgp) karşılıklarıdır. Bir komutun AutoCAD'de kısaltması yoksa burada da yoktur.
 *  2. OLMAYAN KOMUT UYDURULMAZ. AutoCAD'de karşılığı bulunmayan yeteneklerimiz `ext: true` ile
 *     işaretlidir ve yardım listesinde ayrı gösterilir. Kullanıcıya "bu AutoCAD komutudur" diye
 *     yanlış bilgi verilmez; uygulamaya özgü olduğu açıkça yazar.
 *  3. Davranış farkı varsa `note` alanına yazılır. Örnek: bizim ZOOM'umuz doğrudan sınırlara
 *     oturur, AutoCAD'inki seçenek sorar. Fark gizlenmez.
 *
 * TÜRKÇE ARAYÜZDE DE ÇALIŞIR. AutoCAD adları her dilde kabul edilir (AutoCAD'in kendi
 * yerelleştirmelerinde İngilizce adın `_` önekiyle çalışması gibi); yalnız ARAYÜZ ETİKETLERİ
 * İngilizce'de AutoCAD adına döner, Türkçe'de Türkçe kalır.
 */

/*
 * id    — uygulamanın kendi eylem kimliği (editor.act buna bakar)
 * cmd   — komut satırına yazılan ad; İngilizce arayüzde etiket de budur
 * alias — AutoCAD'in kendi kısaltmaları (acad.pgp)
 * label — AutoCAD şeridindeki okunur ad (İngilizce ipucu metni)
 * ext   — AutoCAD'de karşılığı YOK, uygulamaya özgü
 * note  — davranış farkı
 */
export const COMMANDS = [
  // --- çizim
  { id: 't:line', cmd: 'LINE', alias: ['L'], label: 'Line' },
  { id: 't:pline', cmd: 'PLINE', alias: ['PL'], label: 'Polyline' },
  { id: 't:rect', cmd: 'RECTANG', alias: ['REC'], label: 'Rectangle' },
  { id: 't:circle', cmd: 'CIRCLE', alias: ['C'], label: 'Circle' },
  { id: 't:arc3', cmd: 'ARC', alias: ['A'], label: 'Arc', note: 'three points' },
  { id: 't:point', cmd: 'POINT', alias: ['PO'], label: 'Point' },
  { id: 't:text', cmd: 'TEXT', alias: ['DT'], label: 'Single line text' },
  { id: 't:hatch', cmd: 'HATCH', alias: ['H', 'BH'], label: 'Hatch' },
  { id: 't:pline3d', cmd: '3DPOLY', alias: [], label: '3D polyline' },
  { id: 't:face3d', cmd: '3DFACE', alias: [], label: '3D face' },
  { id: 't:cloud', cmd: 'REVCLOUD', alias: [], label: 'Revision cloud' },

  // --- değiştirme
  { id: 't:select', cmd: 'SELECT', alias: [], label: 'Select objects' },
  { id: 't:move', cmd: 'MOVE', alias: ['M'], label: 'Move' },
  { id: 't:copy', cmd: 'COPY', alias: ['CO', 'CP'], label: 'Copy' },
  { id: 't:rotate', cmd: 'ROTATE', alias: ['RO'], label: 'Rotate' },
  { id: 't:scale', cmd: 'SCALE', alias: ['SC'], label: 'Scale' },
  { id: 't:mirror', cmd: 'MIRROR', alias: ['MI'], label: 'Mirror' },
  { id: 't:offset', cmd: 'OFFSET', alias: ['O'], label: 'Offset' },
  { id: 't:array', cmd: 'ARRAY', alias: ['AR'], label: 'Array' },
  { id: 't:del', cmd: 'ERASE', alias: ['E'], label: 'Erase' },
  { id: 't:trim', cmd: 'TRIM', alias: ['TR'], label: 'Trim' },
  { id: 't:extend', cmd: 'EXTEND', alias: ['EX'], label: 'Extend' },
  { id: 't:fillet', cmd: 'FILLET', alias: ['F'], label: 'Fillet' },
  { id: 't:chamfer', cmd: 'CHAMFER', alias: ['CHA'], label: 'Chamfer' },
  { id: 't:explode', cmd: 'EXPLODE', alias: ['X'], label: 'Explode' },
  { id: 't:edittext', cmd: 'TEXTEDIT', alias: ['ED', 'DDEDIT'], label: 'Edit text' },
  { id: 't:attr', cmd: 'ATTEDIT', alias: ['ATE', 'EATTEDIT'], label: 'Edit attributes' },
  { id: 't:thick', cmd: 'THICKNESS', alias: [], label: 'Thickness' },
  { id: 'findrep', cmd: 'FIND', alias: [], label: 'Find and replace' },
  { id: 'props', cmd: 'PROPERTIES', alias: ['PR', 'CH', 'MO'], label: 'Properties' },
  { id: 'grips', cmd: 'GRIPS', alias: [], label: 'Vertex grips', note: 'a system variable in AutoCAD' },

  // --- ölçülendirme ve açıklama
  { id: 't:dim', cmd: 'DIMALIGNED', alias: ['DAL'], label: 'Aligned dimension' },
  { id: 't:dimh', cmd: 'DIMLINEAR', alias: ['DLI'], label: 'Linear dimension', note: 'horizontal; DIMVERTICAL gives the vertical one' },
  { id: 't:dimr', cmd: 'DIMRADIUS', alias: ['DRA'], label: 'Radius dimension' },
  { id: 't:dimd', cmd: 'DIMDIAMETER', alias: ['DDI'], label: 'Diameter dimension' },
  { id: 't:dima', cmd: 'DIMANGULAR', alias: ['DAN'], label: 'Angular dimension' },
  { id: 't:leader', cmd: 'MLEADER', alias: ['MLD', 'LEADER', 'LE'], label: 'Multileader' },

  // --- sorgulama
  { id: 't:dist', cmd: 'DIST', alias: ['DI'], label: 'Distance' },
  { id: 't:area', cmd: 'AREA', alias: ['AA'], label: 'Area' },
  { id: 't:coord', cmd: 'ID', alias: [], label: 'ID point' },

  // --- görünüm ve ortam
  { id: 'extents', cmd: 'ZOOM', alias: ['Z', 'ZE'], label: 'Zoom extents', note: 'goes straight to extents; AutoCAD asks for an option' },
  { id: 'zoomwin', cmd: 'ZOOMWIN', alias: [], label: 'Zoom window', note: 'AutoCAD: ZOOM Window' },
  { id: 'layers', cmd: 'LAYER', alias: ['LA'], label: 'Layer' },
  { id: 'osnap', cmd: 'OSNAP', alias: ['OS'], label: 'Object snap' },
  { id: 'grid', cmd: 'GRID', alias: [], label: 'Grid' },
  { id: 'ltype', cmd: 'LINETYPE', alias: ['LT'], label: 'Linetype' },
  { id: 'lw', cmd: 'LWEIGHT', alias: ['LW'], label: 'Lineweight' },
  { id: 'color', cmd: 'COLOR', alias: ['COL'], label: 'Colour' },
  { id: 'undo', cmd: 'UNDO', alias: ['U'], label: 'Undo' },
  { id: 'redo', cmd: 'REDO', alias: ['MREDO'], label: 'Redo' },
  { id: 'blocklib', cmd: 'INSERT', alias: ['I'], label: 'Insert block' },
  { id: 'copyclip', cmd: 'COPYCLIP', alias: [], label: 'Copy to clipboard' },
  { id: 'pasteclip', cmd: 'PASTECLIP', alias: [], label: 'Paste from clipboard' },
  { id: 'savedxf', cmd: 'DXFOUT', alias: ['SAVEAS'], label: 'Save as DXF' },
  { id: 'pdf', cmd: 'PLOT', alias: ['PRINT', 'EXPORTPDF'], label: 'Plot to PDF' },
  { id: 'layouts', cmd: 'LAYOUT', alias: [], label: 'Layout' },
  { id: 'vstyle', cmd: 'VISUALSTYLES', alias: [], label: 'Visual style' },
  { id: 'v:top', cmd: 'PLAN', alias: [], label: 'Plan view' },
  { id: 'v:iso', cmd: 'VPOINT', alias: ['-VP'], label: 'Isometric view', note: 'goes to the SW isometric preset' },
  { id: '3d', cmd: '3DORBIT', alias: ['3DO', 'ORBIT'], label: '3D orbit' },

  // --- uygulamaya özgü: AutoCAD'de karşılığı YOK
  { id: 't:setz', cmd: 'SETZ', alias: [], label: 'Set elevation', ext: true, note: 'assigns Z to the selection; AutoCAD does this from PROPERTIES' },
  { id: 't:dimv', cmd: 'DIMVERTICAL', alias: [], label: 'Vertical dimension', ext: true, note: 'AutoCAD gets this from DIMLINEAR by drag direction' },
  { id: 't:angle', cmd: 'ANGLE', alias: [], label: 'Measure angle', ext: true, note: 'AutoCAD: MEASUREGEOM Angle' },
  { id: 't:radius', cmd: 'RADIUS', alias: [], label: 'Measure radius', ext: true, note: 'AutoCAD: MEASUREGEOM Radius' },
  { id: 't:fillarea', cmd: 'FILLAREA', alias: [], label: 'Enclosed area', ext: true, note: 'AutoCAD: AREA with the Object option' },
  { id: 't:ident', cmd: 'IDENT', alias: [], label: 'Smart measure', ext: true },
  { id: 't:balloon', cmd: 'BALLOON', alias: [], label: 'Numbering balloon', ext: true },
  { id: 't:textsize', cmd: 'TEXTSIZE', alias: [], label: 'Text height', ext: true, note: 'changes existing texts; in AutoCAD TEXTSIZE is a system variable' },
  { id: 'hatchpat', cmd: 'HATCHPAT', alias: [], label: 'Hatch pattern', ext: true },
  { id: 'search', cmd: 'SEARCH', alias: [], label: 'Search text', ext: true },
  { id: 'notes', cmd: 'NOTES', alias: [], label: 'Redline notes', ext: true },
  { id: 'profile', cmd: 'PROFILE', alias: [], label: 'Elevation profile', ext: true },
  { id: 'compare', cmd: 'COMPARE', alias: [], label: 'Compare drawings', ext: true },
  { id: 'gps', cmd: 'GPS', alias: [], label: 'GPS position', ext: true },
  { id: 'basemap', cmd: 'BASEMAP', alias: [], label: 'Base map', ext: true },
  { id: 'count', cmd: 'COUNT', alias: [], label: 'Count objects', ext: true },
  { id: 'textout', cmd: 'TEXTOUT', alias: [], label: 'Export text', ext: true },
  { id: 'tableout', cmd: 'TABLEOUT', alias: [], label: 'Export tables', ext: true },
  { id: 'batch', cmd: 'BATCH', alias: [], label: 'Batch convert', ext: true },
  { id: 'pdfcad', cmd: 'PDFCAD', alias: [], label: 'PDF to CAD', ext: true },
  { id: 'mesh3d', cmd: 'MESHOUT', alias: [], label: 'Export OBJ / STL', ext: true },
  { id: 'savedelta', cmd: 'SAVEDELTA', alias: [], label: 'Save changes only', ext: true },
  { id: 'markdim', cmd: 'MARKDIM', alias: [], label: 'Mark measurement', ext: true },
  { id: 'crosshair', cmd: 'CROSSHAIR', alias: [], label: 'Crosshair', ext: true },
  { id: 'drive', cmd: 'DRIVE', alias: [], label: 'Google Drive', ext: true },
  { id: 'display', cmd: 'DISPLAY', alias: ['DSETTINGS', 'SE'], label: 'Display settings' },
];

/** id → kayıt */
export const BY_ID = new Map(COMMANDS.map(c => [c.id, c]));

/*
 * Ad → kayıt. Kısaltmalar da buraya girer. Aynı adın iki komuta bağlanması bir KUSURDUR:
 * ikinci yazan sessizce birinciyi ezerdi ve kullanıcı yanlış komutu çalıştırırdı. Bu yüzden
 * çakışma sessizce geçilmez, tablo kurulurken toplanır ve dogrula() ile görünür kılınır.
 */
export const BY_NAME = new Map();
const CAKISMA = [];
for (const c of COMMANDS) {
  for (const ad of [c.cmd, ...(c.alias || [])]) {
    const k = String(ad).toUpperCase();
    if (BY_NAME.has(k)) CAKISMA.push(`${k}: ${BY_NAME.get(k).id} / ${c.id}`);
    else BY_NAME.set(k, c);
  }
}

/** Tablonun kendi sağlığı: çakışan ad ve eksik alan listesi (sınama ve geliştirme içindir) */
export function dogrula() {
  const hata = [...CAKISMA];
  const gorulen = new Set();
  for (const c of COMMANDS) {
    if (!c.id || !c.cmd) hata.push(`eksik alan: ${JSON.stringify(c)}`);
    if (gorulen.has(c.id)) hata.push(`yinelenen id: ${c.id}`);
    gorulen.add(c.id);
    if (!/^[A-Z0-9-]+$/.test(c.cmd)) hata.push(`komut adı büyük harf değil: ${c.cmd}`);
    for (const a of (c.alias || [])) if (!/^[A-Z0-9-]+$/.test(a)) hata.push(`kısaltma büyük harf değil: ${a}`);
  }
  return hata;
}

/*
 * Yazılan metni komuta çevirir. AutoCAD'in kendi davranışları korunur:
 *  - büyük/küçük harf ayrımı yoktur
 *  - baştaki '_' (dil bağımsız önek) ve "'" (saydam komut öneki) atılır
 *  - baştaki '-' komut satırı sürümünü ister; adın parçasıysa korunur (-VP), değilse atılır
 */
export function resolve(text) {
  let s = String(text == null ? '' : text).trim().toUpperCase();
  if (!s) return null;
  s = s.replace(/^['_]+/, '');
  if (BY_NAME.has(s)) return BY_NAME.get(s);
  if (s.startsWith('-') && BY_NAME.has(s.slice(1))) return BY_NAME.get(s.slice(1));
  return null;
}

/** İngilizce arayüz etiketi: AutoCAD komut adı. Tabloda yoksa null (çağıran kendi adını kullanır). */
export const cmdOf = (id) => { const c = BY_ID.get(id); return c ? c.cmd : null; };

/** Bir kimliğin bütün adları: "TRIM (TR)" biçiminde ipucu metni */
export function namesOf(id) {
  const c = BY_ID.get(id);
  if (!c) return '';
  return c.alias && c.alias.length ? `${c.cmd} (${c.alias.join(', ')})` : c.cmd;
}

/**
 * Yazılan öneke uyan komutlar (komut satırı önerisi). AutoCAD'in otomatik tamamlamasında
 * olduğu gibi önce TAM ad başlangıçları, sonra kısaltmalar gelir; her kimlik bir kez görünür.
 */
export function suggest(text, limit = 8) {
  const s = String(text == null ? '' : text).trim().toUpperCase().replace(/^['_-]+/, '');
  if (!s) return [];
  const tam = [], kisa = [], gorulen = new Set();
  for (const c of COMMANDS) {
    if (c.cmd.startsWith(s)) { tam.push(c); gorulen.add(c.id); }
  }
  for (const c of COMMANDS) {
    if (gorulen.has(c.id)) continue;
    if ((c.alias || []).some(a => a.startsWith(s))) { kisa.push(c); gorulen.add(c.id); }
  }
  tam.sort((a, b) => a.cmd.length - b.cmd.length || a.cmd.localeCompare(b.cmd));
  return [...tam, ...kisa].slice(0, limit);
}
