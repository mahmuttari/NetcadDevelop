/**
 * acad.js — AutoCAD komut adları ve kısaltmaları
 *
 * NE İŞE YARAR
 *   Hedef kullanıcı AutoCAD kaslıdır: TR yazınca budama, F yazınca kavis bekler. Bu tablo o
 *   beklentiyi karşılar. Tek kaynaktır — komut satırı, İngilizce arayüz etiketleri ve yardım
 *   listesi hepsi buradan okur; hiçbir dosya kendi adını yazmaz.
 *
 * DÖRT KURAL
 *  1. Kısaltmalar UYDURULMAZ. Buradaki kısaltmalar AutoCAD'in kendi komut kısaltma dosyasındaki
 *     (acad.pgp) karşılıklarıdır. Bir komutun AutoCAD'de kısaltması yoksa burada da yoktur.
 *  2. OLMAYAN KOMUT UYDURULMAZ. AutoCAD'de karşılığı bulunmayan yeteneklerimiz `ext: true` ile
 *     işaretlidir ve yardım listesinde ayrı gösterilir. Kullanıcıya "bu AutoCAD komutudur" diye
 *     yanlış bilgi verilmez; uygulamaya özgü olduğu açıkça yazar.
 *  3. Davranış farkı varsa `note` alanına yazılır. Örnek: bizim ZOOM'umuz doğrudan sınırlara
 *     oturur, AutoCAD'inki seçenek sorar. Fark gizlenmez.
 *  4. TANINAN AMA BULUNMAYAN komut "bilinmeyen komut" diye geçiştirilmez. Klavye-fare kipinde
 *     AutoCAD kaslı kullanıcı en sık kullandığı ~300 komutu yazar; bunlardan bu uygulamada
 *     karşılığı olmayanlar `avail: false` ile listelenir. Yazıldığında komut satırı "bu AutoCAD
 *     komutu bu uygulamada yok" der ve varsa en yakın karşılığı (`note`) söyler. Böylece
 *     kullanıcı yazım hatası yaptığını sanmaz ve neyi aramayacağını öğrenir.
 *
 * "EN SIK KULLANILAN 300" NASIL SEÇİLDİ — dürüstçe
 *   Autodesk kullanım sıklığı yayımlamaz; kamuya açık, yetkili bir sıralama yoktur. Liste
 *   üç kaynaktan derlendi: acad.pgp'nin öntanımlı kısaltma tablosu (kısaltması olan komut sık
 *   kullanılan komuttur), Home / Annotate / View / Insert şeritlerinin panelleri ve yaygın
 *   eğitim müfredatlarının komut listeleri. Sıralama değil KAPSAM hedeflenir: bu üç kaynağın
 *   kesişimindeki her komut tabloda ya çalışır, ya da neden çalışmadığını söyler.
 *
 * TÜRKÇE ARAYÜZDE DE ÇALIŞIR. AutoCAD adları her dilde kabul edilir (AutoCAD'in kendi
 * yerelleştirmelerinde İngilizce adın `_` önekiyle çalışması gibi); yalnız ARAYÜZ ETİKETLERİ
 * İngilizce'de AutoCAD adına döner, Türkçe'de Türkçe kalır.
 */

/*
 * id    — uygulamanın kendi eylem kimliği (editor.act buna bakar); avail:false kayıtlarda null
 * cmd   — komut satırına yazılan ad; İngilizce arayüzde etiket de budur
 * alias — AutoCAD'in kendi kısaltmaları (acad.pgp)
 * label — AutoCAD şeridindeki okunur ad (İngilizce ipucu metni)
 * ext   — AutoCAD'de karşılığı YOK, uygulamaya özgü
 * syn   — aynı eylemin İKİNCİ adı (MTEXT → TEXT gibi): id birincil kayıtla paylaşılır, arayüz
 *         etiketi birincil kayıttan okunur (cmdOf / namesOf yalnız birincili döndürür)
 * avail — false: AutoCAD komutu tanınır ama bu uygulamada karşılığı yoktur (id yok)
 * noRepeat — açma/kapama ve pencere açan komutlar: boş Enter / sağ tuş bunları YİNELEMEZ
 *         (AutoCAD'de de "son komut" bir çizim komutudur; GRID'i yinelemek ızgarayı geri kapatırdı)
 * note  — davranış farkı ya da en yakın karşılık
 */
const T = (cmd, id, alias, label, o) => ({ id, cmd, alias: alias || [], label, ...(o || {}) });
const NA = (cmd, alias, label, note) => ({ id: null, cmd, alias: alias || [], label, avail: false, ...(note ? { note } : {}) });

export const COMMANDS = [
  // =============================================================================================
  // ÇALIŞAN AUTOCAD KOMUTLARI
  // =============================================================================================
  // --- çizim
  T('LINE', 't:line', ['L'], 'Line'),
  T('PLINE', 't:pline', ['PL'], 'Polyline'),
  T('RECTANG', 't:rect', ['REC', 'RECTANGLE'], 'Rectangle'),
  T('CIRCLE', 't:circle', ['C'], 'Circle'),
  T('ARC', 't:arc3', ['A'], 'Arc', { note: 'three points' }),
  T('POINT', 't:point', ['PO'], 'Point'),
  T('TEXT', 't:text', ['DT'], 'Single line text'),
  T('MTEXT', 't:text', ['T', 'MT'], 'Multiline text', { syn: true, note: 'creates single-line text; line breaks are kept' }),
  T('DTEXT', 't:text', [], 'Dynamic text', { syn: true }),
  T('HATCH', 't:hatch', ['H'], 'Hatch'),
  T('BHATCH', 't:hatch', ['BH'], 'Boundary hatch', { syn: true }),
  T('3DPOLY', 't:pline3d', ['3P'], '3D polyline'),
  T('3DFACE', 't:face3d', ['3F'], '3D face'),
  T('REVCLOUD', 't:cloud', [], 'Revision cloud'),

  // --- değiştirme
  T('SELECT', 't:select', [], 'Select objects'),
  T('AI_SELALL', 'selectall', [], 'Select all', { note: 'Ctrl+A; selects every visible object' }),
  T('MOVE', 't:move', ['M'], 'Move'),
  T('COPY', 't:copy', ['CO', 'CP'], 'Copy'),
  T('ROTATE', 't:rotate', ['RO'], 'Rotate'),
  T('SCALE', 't:scale', ['SC'], 'Scale'),
  T('MIRROR', 't:mirror', ['MI'], 'Mirror'),
  T('OFFSET', 't:offset', ['O'], 'Offset'),
  T('ARRAY', 't:array', ['AR'], 'Array'),
  T('ERASE', 't:del', ['E'], 'Erase'),
  T('TRIM', 't:trim', ['TR'], 'Trim'),
  T('EXTEND', 't:extend', ['EX'], 'Extend'),
  T('FILLET', 't:fillet', ['F'], 'Fillet'),
  T('CHAMFER', 't:chamfer', ['CHA'], 'Chamfer'),
  T('EXPLODE', 't:explode', ['X'], 'Explode'),
  T('TEXTEDIT', 't:edittext', ['ED', 'DDEDIT'], 'Edit text'),
  T('MTEDIT', 't:edittext', [], 'Edit multiline text', { syn: true }),
  T('ATTEDIT', 't:attr', ['ATE'], 'Edit attributes'),
  T('EATTEDIT', 't:attr', [], 'Enhanced attribute editor', { syn: true }),
  T('THICKNESS', 't:thick', [], 'Thickness', { note: 'a system variable in AutoCAD; here it extrudes the selection' }),
  T('ELEV', 't:setz', [], 'Elevation', { syn: true, note: 'AutoCAD sets it for NEW objects; here it assigns Z to the selection' }),
  T('SCALETEXT', 't:textsize', [], 'Scale text', { syn: true, note: 'sets an absolute height instead of a factor' }),
  T('FIND', 'findrep', [], 'Find and replace'),
  T('PROPERTIES', 'props', ['PR', 'CH', 'MO', 'PROPS'], 'Properties'),
  T('GRIPS', 'grips', [], 'Vertex grips', { noRepeat: true, note: 'a system variable in AutoCAD' }),
  T('DDGRIPS', 'grips', ['GR'], 'Grip settings', { syn: true, noRepeat: true }),
  T('UNDO', 'undo', ['U'], 'Undo'),
  T('OOPS', 'undo', [], 'Restore erased objects', { syn: true, note: 'plain undo; the last erase is not tracked separately' }),
  T('REDO', 'redo', ['MREDO'], 'Redo'),
  T('COPYCLIP', 'copyclip', [], 'Copy to clipboard'),
  T('COPYBASE', 'copyclip', [], 'Copy with base point', { syn: true, note: 'the base point is the lower-left corner of the selection' }),
  T('PASTECLIP', 'pasteclip', [], 'Paste from clipboard'),
  T('PASTEORIG', 'pasteclip', [], 'Paste to original coordinates', { syn: true, note: 'a placement point is asked' }),
  T('PASTEBLOCK', 'pasteclip', [], 'Paste as block', { syn: true, note: 'objects are pasted, not wrapped in a block' }),

  // --- katmanlar
  T('LAYER', 'layers', ['LA'], 'Layer'),
  T('LAYDEL', 'layers', [], 'Delete layer', { syn: true, note: 'from the layer list: Edit layer › Delete' }),
  T('LAYMRG', 'layers', [], 'Merge layers', { syn: true, note: 'delete the layer and move its objects to "0"' }),
  T('LAYMCUR', 'layer', [], 'Make object\'s layer current', { noRepeat: true, note: 'the current layer is picked from a list' }),
  T('LAYCUR', 'layer', [], 'Change to current layer', { syn: true, noRepeat: true }),
  T('LAYISO', 'layiso', [], 'Isolate layers', { note: 'select objects first (SELECT), then LAYISO' }),
  T('LAYUNISO', 'layuniso', [], 'Unisolate layers', { noRepeat: true }),
  T('LAYOFF', 'layoff', [], 'Turn a layer off', { note: 'select objects first, then LAYOFF' }),
  T('LAYFRZ', 'layoff', [], 'Freeze a layer', { syn: true, note: 'the layer is turned off; freezing and off are the same here' }),
  T('LAYON', 'layon', [], 'Turn all layers on', { noRepeat: true }),
  T('LAYTHW', 'layon', [], 'Thaw all layers', { syn: true, noRepeat: true }),
  T('LAYLCK', 'laylck', [], 'Lock a layer', { note: 'select objects first, then LAYLCK' }),
  T('LAYULK', 'layulk', [], 'Unlock a layer', { note: 'select objects first, then LAYULK' }),

  // --- ölçülendirme ve açıklama
  T('DIMALIGNED', 't:dim', ['DAL', 'DIMALI'], 'Aligned dimension'),
  T('DIMLINEAR', 't:dimh', ['DLI', 'DIMLIN'], 'Linear dimension', { note: 'horizontal; DIMVERTICAL gives the vertical one' }),
  T('DIMRADIUS', 't:dimr', ['DRA', 'DIMRAD'], 'Radius dimension'),
  T('DIMDIAMETER', 't:dimd', ['DDI', 'DIMDIA'], 'Diameter dimension'),
  T('DIMANGULAR', 't:dima', ['DAN', 'DIMANG'], 'Angular dimension'),
  T('MLEADER', 't:leader', ['MLD'], 'Multileader'),
  T('LEADER', 't:leader', ['LEAD'], 'Leader', { syn: true }),
  T('QLEADER', 't:leader', ['LE'], 'Quick leader', { syn: true }),

  // --- sorgulama
  T('DIST', 't:dist', ['DI'], 'Distance'),
  T('AREA', 't:area', ['AA'], 'Area'),
  T('ID', 't:coord', [], 'ID point'),
  T('MEASUREGEOM', 't:ident', ['MEA'], 'Measure geometry', { syn: true, note: 'tap an object; distance / radius / angle / area are separate tools' }),
  T('LIST', 'list', ['LI', 'LS'], 'List', { note: 'select an object first; shows the info panel' }),
  T('DBLIST', 'list', [], 'Database list', { syn: true, note: 'shows the selected object only' }),
  T('COUNT', 'count', [], 'Count', { note: 'AutoCAD 2022+; counts blocks and entity types' }),
  T('DWGPROPS', 'info', [], 'Drawing properties', { noRepeat: true, note: 'the drawing info panel' }),

  // --- görünüm
  T('ZOOM', 'extents', ['Z', 'ZE'], 'Zoom extents', { note: 'goes straight to extents; AutoCAD asks for an option' }),
  T('REGEN', 'regen', ['RE'], 'Regenerate', { noRepeat: true }),
  T('REGENALL', 'regen', ['REA'], 'Regenerate all', { syn: true, noRepeat: true }),
  T('REDRAW', 'regen', ['R'], 'Redraw', { syn: true, noRepeat: true }),
  T('REDRAWALL', 'regen', ['RA'], 'Redraw all', { syn: true, noRepeat: true }),
  T('VIEW', 'views', ['V'], 'Named views', { noRepeat: true }),
  T('DDVIEW', 'views', [], 'View dialog', { syn: true, noRepeat: true }),
  T('PLAN', 'v:top', [], 'Plan view'),
  T('VPOINT', 'v:iso', ['-VP'], 'Isometric view', { note: 'goes to the SW isometric preset' }),
  T('3DORBIT', '3d', ['3DO', 'ORBIT'], '3D orbit', { noRepeat: true }),
  T('3DFORBIT', '3d', [], 'Free orbit', { syn: true, noRepeat: true }),
  T('3DCORBIT', '3d', [], 'Continuous orbit', { syn: true, noRepeat: true, note: 'the 3D view has a turntable toggle' }),
  T('3DZOOM', '3d', [], '3D zoom', { syn: true, noRepeat: true, note: 'pinch / wheel in the 3D view' }),
  T('3DPAN', '3d', [], '3D pan', { syn: true, noRepeat: true, note: 'two-finger / middle-button drag in the 3D view' }),
  T('3DDISTANCE', '3d', [], '3D adjust distance', { syn: true, noRepeat: true }),
  T('3DSWIVEL', '3d', [], '3D swivel', { syn: true, noRepeat: true }),
  T('3DMOVE', '3:move', ['3M'], '3D move'),
  T('VISUALSTYLES', 'vstyle', ['VSM'], 'Visual styles', { noRepeat: true }),
  T('VSCURRENT', 'vstyle', ['VS'], 'Current visual style', { syn: true, noRepeat: true }),
  T('SHADEMODE', 'vstyle', [], 'Shade mode', { syn: true, noRepeat: true }),
  T('HIDE', 'vstyle', ['HI'], 'Hide', { syn: true, noRepeat: true, note: 'pick the Hidden style' }),
  T('RENDER', 'vstyle', ['RR'], 'Render', { syn: true, noRepeat: true, note: 'pick the Realistic style; there is no ray tracer' }),
  T('NAVVCUBE', 'cube3', [], 'ViewCube', { noRepeat: true }),
  T('SECTIONPLANE', 'clip3', ['SPLANE'], 'Section plane', { noRepeat: true, note: 'a clip box in the 3D view' }),
  T('CAMERA', 'cam3', ['CAM'], 'Camera', { noRepeat: true, note: '3D camera bookmarks' }),
  T('LAYOUT', 'layouts', ['LO'], 'Layout', { noRepeat: true }),
  T('MODEL', 'layouts', [], 'Model space', { syn: true, noRepeat: true, note: 'pick Model in the layout list' }),
  T('MSPACE', 'layouts', ['MS'], 'Model space (in layout)', { syn: true, noRepeat: true }),
  T('PSPACE', 'layouts', ['PS'], 'Paper space', { syn: true, noRepeat: true }),
  T('GEOMAP', 'basemap', [], 'Online map', { noRepeat: true }),
  T('GEOGRAPHICLOCATION', 'basemap', ['GEO'], 'Geographic location', { syn: true, noRepeat: true, note: 'the coordinate system is set in Settings' }),

  // --- ortam ve ayarlar
  T('OSNAP', 'osnap', ['OS'], 'Object snap', { noRepeat: true }),
  T('GRID', 'grid', [], 'Grid', { noRepeat: true }),
  T('ORTHO', 'ortho', [], 'Ortho', { noRepeat: true }),
  T('LINETYPE', 'ltype', ['LT', 'LTYPE'], 'Linetype', { noRepeat: true, note: 'toggles linetype display' }),
  T('LWEIGHT', 'lw', ['LW', 'LINEWEIGHT'], 'Lineweight', { noRepeat: true, note: 'toggles lineweight display' }),
  T('LTSCALE', 'display', ['LTS'], 'Linetype scale', { syn: true, noRepeat: true, note: 'Display options › Lines' }),
  T('CELTSCALE', 'display', [], 'Current linetype scale', { syn: true, noRepeat: true }),
  T('COLOR', 'color', ['COL', 'COLOUR'], 'Colour', { noRepeat: true }),
  T('QTEXT', 'text', [], 'Quick text', { noRepeat: true, note: 'hides text instead of boxing it' }),
  T('FILL', 'hatch', [], 'Fill', { noRepeat: true, note: 'toggles hatch display' }),
  T('DSETTINGS', 'display', ['DS', 'SE', 'DDRMODES'], 'Drafting settings', { noRepeat: true, note: 'the display options panel' }),
  T('OPTIONS', 'settings', ['OP'], 'Options', { noRepeat: true }),
  T('CONFIG', 'settings', [], 'Configuration', { syn: true, noRepeat: true }),
  T('UNITS', 'settings', ['UN'], 'Units', { syn: true, noRepeat: true, note: 'Settings › Drawing unit' }),
  T('DDUNITS', 'settings', [], 'Units dialog', { syn: true, noRepeat: true }),
  T('COMMANDLINE', 'cmdline', [], 'Command line', { noRepeat: true }),
  T('COMMANDLINEHIDE', 'cmdline', [], 'Hide command line', { syn: true, noRepeat: true }),
  T('HELP', 'cmdhelp', [], 'Help', { noRepeat: true, note: 'the command list' }),
  T('ABOUT', 'about', [], 'About', { noRepeat: true }),

  // --- dosya
  T('OPEN', 'open', [], 'Open', { noRepeat: true }),
  T('DXFIN', 'open', [], 'Import DXF', { syn: true, noRepeat: true, note: 'DXF opens like any drawing' }),
  T('NEW', 'new', [], 'New', { noRepeat: true }),
  T('QNEW', 'new', [], 'Quick new', { syn: true, noRepeat: true }),
  T('CLOSE', 'closefile', [], 'Close', { noRepeat: true, note: 'returns to the home screen; the drawing stays in memory' }),
  T('CLOSEALL', 'closefile', [], 'Close all', { syn: true, noRepeat: true }),
  T('DXFOUT', 'savedxf', ['SAVEAS'], 'Save as DXF'),
  T('QSAVE', 'savedxf', [], 'Quick save', { syn: true, note: 'saves a DXF; DWG cannot be written' }),
  T('SAVE', 'savedxf', [], 'Save', { syn: true, note: 'saves a DXF; DWG cannot be written' }),
  T('PLOT', 'pdf', ['PRINT', 'EXPORTPDF'], 'Plot to PDF'),
  T('PUBLISH', 'batch', [], 'Publish', { syn: true, noRepeat: true, note: 'batch conversion to PDF' }),
  T('PNGOUT', 'png', [], 'Save PNG'),
  T('SAVEIMG', 'png', [], 'Save image', { syn: true }),
  T('INSERT', 'blocklib', ['I'], 'Insert block', { noRepeat: true }),
  T('BLOCK', 'blocklib', ['B'], 'Block', { syn: true, noRepeat: true, note: 'Block library › Create block from selection' }),
  T('WBLOCK', 'blocklib', ['W'], 'Write block', { syn: true, noRepeat: true, note: 'blocks are kept in the library, not in files' }),
  T('BEDIT', 'blocklib', ['BE'], 'Block editor', { syn: true, noRepeat: true }),
  T('DESIGNCENTER', 'blocklib', ['ADC', 'DC'], 'DesignCenter', { syn: true, noRepeat: true, note: 'the block library' }),
  T('XREF', 'xrefs', ['XR'], 'External references', { noRepeat: true }),
  T('EXTERNALREFERENCES', 'xrefs', ['ER'], 'External references palette', { syn: true, noRepeat: true }),
  T('XATTACH', 'xrefs', ['XA'], 'Attach xref', { syn: true, noRepeat: true, note: 'missing references are picked from the list' }),
  T('ATTACH', 'xrefs', [], 'Attach', { syn: true, noRepeat: true }),
  T('IMAGE', 'xrefs', ['IM'], 'Image', { syn: true, noRepeat: true, note: 'image underlays are listed with the references' }),
  T('IMAGEATTACH', 'xrefs', ['IAT'], 'Attach image', { syn: true, noRepeat: true }),
  T('PDFIMPORT', 'pdfcad', [], 'Import PDF', { noRepeat: true }),
  T('PDFATTACH', 'pdfcad', [], 'Attach PDF', { syn: true, noRepeat: true, note: 'the PDF is converted to geometry, not underlaid' }),
  T('TABLEEXPORT', 'tableout', [], 'Export table', { noRepeat: true }),
  T('DATAEXTRACTION', 'textout', ['DX'], 'Data extraction', { syn: true, noRepeat: true, note: 'text extraction to CSV' }),
  T('COMPARE', 'compare', [], 'DWG compare', { noRepeat: true, note: 'AutoCAD 2019+' }),

  // =============================================================================================
  // UYGULAMAYA ÖZGÜ: AutoCAD'de karşılığı YOK (ext)
  // =============================================================================================
  T('ZOOMWIN', 'zoomwin', [], 'Zoom window', { ext: true, note: 'AutoCAD: ZOOM Window' }),
  T('ZOOMPREV', 'prevview', [], 'Previous view', { ext: true, noRepeat: true, note: 'AutoCAD: ZOOM Previous' }),
  T('ZOOMNEXT', 'nextview', [], 'Next view', { ext: true, noRepeat: true }),
  T('GOTO', 'goto', [], 'Go to coordinate', { ext: true, note: 'AutoCAD: no equivalent (ID only reports)' }),
  T('DISPLAY', 'display', [], 'Display settings', { ext: true, syn: true, noRepeat: true }),
  T('POLAR', 'polar', [], 'Polar tracking', { ext: true, noRepeat: true, note: 'AutoCAD: F10 / the POLARMODE variable' }),
  T('PERSPECTIVE', 'persp', [], 'Perspective', { ext: true, noRepeat: true, note: 'a system variable in AutoCAD' }),
  T('SETZ', 't:setz', [], 'Set elevation', { ext: true, note: 'assigns Z to the selection; AutoCAD does this from PROPERTIES' }),
  T('DIMVERTICAL', 't:dimv', [], 'Vertical dimension', { ext: true, note: 'AutoCAD gets this from DIMLINEAR by drag direction' }),
  T('ANGLE', 't:angle', [], 'Measure angle', { ext: true, note: 'AutoCAD: MEASUREGEOM Angle' }),
  T('RADIUS', 't:radius', [], 'Measure radius', { ext: true, note: 'AutoCAD: MEASUREGEOM Radius' }),
  T('FILLAREA', 't:fillarea', [], 'Enclosed area', { ext: true, note: 'AutoCAD: AREA with the Object option' }),
  T('IDENT', 't:ident', [], 'Smart measure', { ext: true }),
  T('BALLOON', 't:balloon', [], 'Numbering balloon', { ext: true }),
  T('TEXTSIZE', 't:textsize', [], 'Text height', { ext: true, note: 'changes existing texts; in AutoCAD TEXTSIZE is a system variable' }),
  T('HATCHPAT', 'hatchpat', [], 'Hatch pattern', { ext: true, noRepeat: true }),
  T('HATCHEDIT', 'hatchpat', ['HE'], 'Hatch edit', { syn: true, noRepeat: true, note: 'sets the pattern for NEW hatches; existing ones are not edited' }),
  T('SEARCH', 'search', [], 'Search text', { ext: true, noRepeat: true }),
  T('NOTES', 'notes', [], 'Redline notes', { ext: true, noRepeat: true }),
  T('PROFILE', 'profile', [], 'Elevation profile', { ext: true }),
  T('GPS', 'gps', [], 'GPS position', { ext: true, noRepeat: true }),
  T('BASEMAP', 'basemap', [], 'Base map', { ext: true, syn: true, noRepeat: true, note: 'AutoCAD: GEOMAP' }),
  T('TEXTOUT', 'textout', [], 'Export text', { ext: true, noRepeat: true }),
  T('TABLEOUT', 'tableout', [], 'Export tables', { ext: true, syn: true, noRepeat: true, note: 'AutoCAD: TABLEEXPORT' }),
  T('BATCH', 'batch', [], 'Batch convert', { ext: true, noRepeat: true }),
  T('PDFCAD', 'pdfcad', [], 'PDF to CAD', { ext: true, syn: true, noRepeat: true, note: 'AutoCAD: PDFIMPORT' }),
  T('MESHOUT', 'mesh3d', [], 'Export OBJ / STL', { ext: true, noRepeat: true }),
  T('SAVEDELTA', 'savedelta', [], 'Save changes only', { ext: true }),
  T('MARKDIM', 'markdim', [], 'Mark measurement', { ext: true }),
  T('CROSSHAIR', 'crosshair', [], 'Crosshair', { ext: true, noRepeat: true, note: 'AutoCAD: the CURSORSIZE variable' }),
  T('DRIVE', 'drive', [], 'Google Drive', { ext: true, noRepeat: true }),

  // =============================================================================================
  // TANINAN AMA BULUNMAYAN AutoCAD komutları (avail:false): komut satırı bunları "bilinmeyen"
  // saymaz; yazılınca bulunmadığını ve varsa en yakın karşılığı söyler.
  // =============================================================================================
  // --- çizim
  NA('POLYGON', ['POL'], 'Polygon', 'draw it with PLINE'),
  NA('ELLIPSE', ['EL'], 'Ellipse', 'ellipses in files are displayed; drawing is not available'),
  NA('SPLINE', ['SPL'], 'Spline', 'splines in files are displayed; drawing is not available'),
  NA('XLINE', ['XL'], 'Construction line'),
  NA('RAY', [], 'Ray'),
  NA('DONUT', ['DO', 'DOUGHNUT'], 'Donut', 'draw two circles'),
  NA('MLINE', ['ML'], 'Multiline', 'draw with PLINE and OFFSET'),
  NA('SKETCH', [], 'Sketch', 'freehand lines are redline NOTES'),
  NA('HELIX', [], 'Helix'),
  NA('SOLID', ['SO'], '2D solid', 'use HATCH with solid fill'),
  NA('TRACE', [], 'Trace'),
  NA('BOUNDARY', ['BO'], 'Boundary', 'FILLAREA measures an enclosed area; HATCH fills it'),
  NA('REGION', ['REG'], 'Region'),
  NA('WIPEOUT', [], 'Wipeout'),
  NA('GRADIENT', ['GD'], 'Gradient fill', 'solid fill only (HATCH)'),
  NA('TABLE', ['TB'], 'Table', 'tables in files are read with TABLEEXPORT'),
  NA('FIELD', [], 'Field'),
  NA('ATTDEF', ['ATT'], 'Attribute definition', 'existing attributes are edited with ATTEDIT'),
  NA('3DMESH', [], '3D mesh', 'meshes in files are displayed; 3DFACE draws single faces'),
  NA('PFACE', [], 'Polyface mesh'),
  NA('MESH', [], 'Mesh primitive'),
  NA('REVSURF', [], 'Revolved surface'),
  NA('TABSURF', [], 'Tabulated surface'),
  NA('RULESURF', [], 'Ruled surface'),
  NA('EDGESURF', [], 'Edge surface'),
  NA('PLANESURF', [], 'Planar surface', 'use 3DFACE'),
  NA('SURFNETWORK', [], 'Network surface'),
  NA('CONVTOSOLID', [], 'Convert to solid'),
  NA('CONVTOSURFACE', [], 'Convert to surface'),
  NA('CONVTOMESH', [], 'Convert to mesh'),
  NA('CONVTONURBS', [], 'Convert to NURBS'),
  NA('MESHSMOOTH', [], 'Smooth mesh'),
  NA('CENTERMARK', [], 'Center mark'),
  NA('CENTERLINE', [], 'Centerline'),
  NA('BREAKLINE', [], 'Break line (Express)'),
  NA('ARCTEXT', [], 'Arc-aligned text (Express)'),
  NA('SUPERHATCH', [], 'Super hatch (Express)'),

  // --- değiştirme
  NA('STRETCH', ['S'], 'Stretch', 'move single vertices with GRIPS'),
  NA('LENGTHEN', ['LEN'], 'Lengthen', 'use EXTEND or GRIPS'),
  NA('BREAK', ['BR'], 'Break', 'TRIM removes a piece between two edges'),
  NA('BREAKATPOINT', [], 'Break at point'),
  NA('JOIN', ['J'], 'Join'),
  NA('PEDIT', ['PE'], 'Edit polyline', 'vertices are edited with GRIPS'),
  NA('SPLINEDIT', ['SPE'], 'Edit spline'),
  NA('MLEDIT', [], 'Edit multiline'),
  NA('ALIGN', ['AL'], 'Align', 'use MOVE then ROTATE'),
  NA('3DALIGN', ['3AL'], '3D align'),
  NA('3DROTATE', ['3R'], '3D rotate', 'ROTATE works in the plan view'),
  NA('3DSCALE', ['3S'], '3D scale', 'SCALE works in the plan view'),
  NA('ROTATE3D', [], 'Rotate 3D'),
  NA('MIRROR3D', [], 'Mirror 3D'),
  NA('REVERSE', [], 'Reverse direction'),
  NA('OVERKILL', [], 'Delete duplicate objects'),
  NA('BLEND', [], 'Blend curves', 'use FILLET'),
  NA('MATCHPROP', ['MA'], 'Match properties', 'set layer and colour from PROPERTIES'),
  NA('CHANGE', ['-CH'], 'Change', 'use PROPERTIES'),
  NA('CHPROP', [], 'Change properties', 'use PROPERTIES'),
  NA('CHSPACE', [], 'Change space'),
  NA('ARRAYRECT', [], 'Rectangular array', 'ARRAY asks for the type'),
  NA('ARRAYPOLAR', [], 'Polar array', 'ARRAY asks for the type'),
  NA('ARRAYPATH', [], 'Path array', 'rectangular and polar arrays only (ARRAY)'),
  NA('ARRAYEDIT', [], 'Edit array', 'arrays are plain copies here'),
  NA('ARRAYCLASSIC', [], 'Classic array dialog', 'use ARRAY'),
  NA('DIVIDE', ['DIV'], 'Divide'),
  NA('MEASURE', ['ME'], 'Measure (place points)', 'DIST measures a distance'),
  NA('XPLODE', [], 'Explode with options', 'use EXPLODE'),
  NA('NCOPY', [], 'Copy nested objects', 'EXPLODE the block, then COPY'),
  NA('COPYTOLAYER', [], 'Copy to layer', 'COPY, then change the layer from PROPERTIES'),
  NA('FLATTEN', [], 'Flatten (Express)', 'SETZ assigns a single elevation'),
  NA('TXT2MTXT', [], 'Convert text to mtext (Express)'),
  NA('TCOUNT', [], 'Number text (Express)', 'BALLOON numbers positions'),
  NA('TEXTFIT', [], 'Fit text (Express)'),
  NA('TEXTMASK', [], 'Text mask (Express)'),
  NA('BURST', [], 'Burst block (Express)', 'use EXPLODE'),
  NA('EXTRIM', [], 'Extended trim (Express)', 'use TRIM'),
  NA('MOCORO', [], 'Move-copy-rotate (Express)'),
  NA('CUTCLIP', [], 'Cut to clipboard', 'COPYCLIP then ERASE'),
  NA('PASTESPEC', ['PA'], 'Paste special', 'use PASTECLIP'),
  NA('COPYLINK', [], 'Copy link'),
  NA('ADDSELECTED', [], 'Add selected'),
  NA('QSELECT', [], 'Quick select', 'long-press an object › Select same layer'),
  NA('SELECTSIMILAR', [], 'Select similar', 'long-press an object › Select same layer'),
  NA('FILTER', ['FI'], 'Object selection filter'),
  NA('GROUP', ['G'], 'Group', 'grouped objects in files select together; creating groups is not available'),
  NA('UNGROUP', [], 'Ungroup'),
  NA('CLASSICGROUP', [], 'Classic group dialog'),
  NA('DRAWORDER', ['DR'], 'Draw order', 'the file\'s draw order is honoured; it cannot be changed'),
  NA('TEXTTOFRONT', [], 'Bring text to front'),
  NA('HATCHTOBACK', [], 'Send hatches to back'),

  // --- 3B katı modelleme (yalnız görüntülenir)
  NA('EXTRUDE', ['EXT'], 'Extrude', 'THICKNESS extrudes 2D objects'),
  NA('PRESSPULL', [], 'Press or pull'),
  NA('REVOLVE', ['REV'], 'Revolve'),
  NA('SWEEP', [], 'Sweep'),
  NA('LOFT', [], 'Loft'),
  NA('UNION', ['UNI'], 'Union'),
  NA('SUBTRACT', ['SU'], 'Subtract'),
  NA('INTERSECT', ['IN'], 'Intersect'),
  NA('SLICE', ['SL'], 'Slice', 'SECTIONPLANE clips the 3D view'),
  NA('SECTION', ['SEC'], 'Section', 'SECTIONPLANE clips the 3D view'),
  NA('INTERFERE', ['INF'], 'Interference check'),
  NA('THICKEN', [], 'Thicken surface'),
  NA('FILLETEDGE', [], 'Fillet edge'),
  NA('CHAMFEREDGE', [], 'Chamfer edge'),
  NA('SOLIDEDIT', [], 'Solid editing'),
  NA('BOX', [], 'Box', '3D solids in files are displayed; modelling is not available'),
  NA('CYLINDER', ['CYL'], 'Cylinder'),
  NA('SPHERE', [], 'Sphere'),
  NA('CONE', [], 'Cone'),
  NA('WEDGE', ['WE'], 'Wedge'),
  NA('TORUS', ['TOR'], 'Torus'),
  NA('PYRAMID', ['PYR'], 'Pyramid'),
  NA('POLYSOLID', ['PSOLID'], 'Polysolid'),
  NA('FLATSHOT', [], 'Flatshot'),
  NA('LIVESECTION', [], 'Live section', 'SECTIONPLANE clips the 3D view'),
  NA('VIEWBASE', [], 'Base view'),
  NA('VIEWSECTION', [], 'Section view'),
  NA('VIEWDETAIL', [], 'Detail view'),

  // --- ölçülendirme ve açıklama
  NA('DIMBASELINE', ['DBA'], 'Baseline dimension', 'place separate DIMLINEAR dimensions'),
  NA('DIMCONTINUE', ['DCO'], 'Continue dimension', 'place separate DIMLINEAR dimensions'),
  NA('DIMORDINATE', ['DOR'], 'Ordinate dimension', 'ID shows a coordinate; MARKDIM writes it'),
  NA('DIMARC', ['DAR'], 'Arc length dimension'),
  NA('DIMJOGGED', ['DJO'], 'Jogged dimension'),
  NA('DIMJOGLINE', ['DJL'], 'Jog line'),
  NA('DIMCENTER', ['DCE'], 'Center mark dimension'),
  NA('DIMEDIT', ['DED'], 'Edit dimension', 'the dimension text is edited with TEXTEDIT'),
  NA('DIMTEDIT', [], 'Edit dimension text position'),
  NA('DIMSPACE', [], 'Adjust dimension spacing'),
  NA('DIMBREAK', [], 'Dimension break'),
  NA('DIMREASSOCIATE', ['DRE'], 'Reassociate dimensions'),
  NA('DIMDISASSOCIATE', [], 'Disassociate dimensions'),
  NA('DIMREGEN', [], 'Regenerate dimensions', 'use REGEN'),
  NA('DIMOVERRIDE', ['DOV'], 'Dimension override'),
  NA('QDIM', [], 'Quick dimension'),
  NA('TOLERANCE', ['TOL'], 'Geometric tolerance'),
  NA('DIMSTYLE', ['D', 'DST', 'DDIM'], 'Dimension style', 'one built-in style'),
  NA('MLEADERSTYLE', ['MLS'], 'Multileader style'),
  NA('MLEADEREDIT', ['MLE'], 'Edit multileader'),
  NA('MLEADERALIGN', ['MLA'], 'Align multileaders'),
  NA('MLEADERCOLLECT', ['MLC'], 'Collect multileaders'),
  NA('STYLE', ['ST'], 'Text style', 'one built-in style'),
  NA('SPELL', ['SP'], 'Spell check'),
  NA('JUSTIFYTEXT', [], 'Justify text'),
  NA('TABLESTYLE', ['TS'], 'Table style'),
  NA('TABLEDIT', [], 'Edit table cell'),
  NA('MLSTYLE', [], 'Multiline style'),
  NA('ATTSYNC', [], 'Synchronise attributes'),
  NA('BATTMAN', [], 'Block attribute manager'),
  NA('ATTDISP', [], 'Attribute display'),
  NA('ATTEXT', [], 'Attribute extraction', 'TEXTOUT extracts texts and attributes'),
  NA('ATTIN', [], 'Attribute import (Express)'),
  NA('ATTOUT', [], 'Attribute export (Express)', 'use TEXTOUT'),
  NA('TINSERT', [], 'Insert block in table cell'),
  NA('MARKUP', ['MSM'], 'Markup set manager', 'redline NOTES are the markup here'),
  NA('MARKUPIMPORT', [], 'Import markup'),
  NA('MARKUPASSIST', [], 'Markup assist'),
  NA('HYPERLINK', [], 'Hyperlink'),

  // --- görünüm ve gezinme
  NA('PAN', ['P', '-PAN'], 'Pan', 'drag with the middle button, or with a finger'),
  NA('RTPAN', [], 'Real-time pan', 'drag with the middle button'),
  NA('RTZOOM', [], 'Real-time zoom', 'wheel, or pinch'),
  NA('DVIEW', ['DV'], 'Dynamic view', 'use 3DORBIT'),
  NA('3DWALK', ['3DW'], '3D walk'),
  NA('3DFLY', [], '3D fly'),
  NA('UCS', [], 'User coordinate system', 'the world system is used'),
  NA('UCSICON', [], 'UCS icon', 'the 3D view has an axes toggle'),
  NA('UCSMAN', ['UC'], 'UCS manager'),
  NA('VPORTS', [], 'Viewports', 'a single viewport'),
  NA('MVIEW', ['MV'], 'Make viewport', 'layout viewports in files are displayed'),
  NA('VPLAYER', [], 'Viewport layer'),
  NA('VPCLIP', [], 'Clip viewport'),
  NA('VPMAX', [], 'Maximise viewport'),
  NA('VPMIN', [], 'Minimise viewport'),
  NA('NAVBAR', [], 'Navigation bar'),
  NA('STEERINGWHEELS', [], 'SteeringWheels'),
  NA('SHOWMOTION', [], 'ShowMotion', 'VIEW keeps named views'),
  NA('NEWSHOT', [], 'New shot', 'VIEW keeps named views'),
  NA('VIEWRES', [], 'View resolution'),
  NA('CLEANSCREENON', [], 'Clean screen on', 'collapse the toolbar with the handle'),
  NA('CLEANSCREENOFF', [], 'Clean screen off'),
  NA('RIBBON', [], 'Ribbon'),
  NA('RIBBONCLOSE', [], 'Close ribbon'),
  NA('TOOLPALETTES', ['TP'], 'Tool palettes', 'INSERT opens the block library'),
  NA('SHEETSET', ['SSM'], 'Sheet set manager'),
  NA('LAYERSTATE', ['LAS'], 'Layer states'),
  NA('LAYWALK', [], 'Layer walk', 'isolate a layer from the layer list'),
  NA('LAYERP', [], 'Previous layer state'),
  NA('LAYTRANS', [], 'Layer translator'),
  NA('LAYVPI', [], 'Layer viewport isolate'),
  NA('RENDERPRESETS', ['RP'], 'Render presets'),
  NA('RENDERWIN', [], 'Render window'),
  NA('LIGHT', [], 'Light', 'the 3D view has a light toggle'),
  NA('SUNPROPERTIES', [], 'Sun properties'),
  NA('MATERIALS', ['MAT'], 'Materials'),
  NA('MATBROWSEROPEN', [], 'Material browser'),
  NA('ANIPATH', [], 'Animation path'),

  // --- ayar, sorgu, dosya
  NA('SNAP', ['SN'], 'Grid snap', 'OSNAP snaps to objects; grid snap is not available'),
  NA('DDPTYPE', ['PTYPE'], 'Point style'),
  NA('LIMITS', [], 'Drawing limits'),
  NA('ISOPLANE', [], 'Isometric plane'),
  NA('APERTURE', [], 'Snap aperture'),
  NA('BLIPMODE', [], 'Blip mode'),
  NA('DRAGMODE', [], 'Drag mode'),
  NA('SETVAR', [], 'Set variable'),
  NA('SYSVARMONITOR', [], 'System variable monitor'),
  NA('STATUS', [], 'Status', 'DWGPROPS shows drawing info'),
  NA('TIME', [], 'Time'),
  NA('MASSPROP', [], 'Mass properties', 'AREA and the surface area tool measure geometry'),
  NA('QUICKCALC', ['QC'], 'Quick calculator'),
  NA('CAL', [], 'Geometry calculator'),
  NA('PURGE', ['PU'], 'Purge', 'unused layers are dropped when saving DXF'),
  NA('AUDIT', [], 'Audit'),
  NA('RECOVER', [], 'Recover', 'damaged files are read on a best-effort basis when opened'),
  NA('RECOVERALL', [], 'Recover all'),
  NA('ETRANSMIT', [], 'eTransmit'),
  NA('ARCHIVE', [], 'Archive'),
  NA('SECURITYOPTIONS', [], 'Security options'),
  NA('CUI', [], 'Customise user interface'),
  NA('CUSTOMIZE', [], 'Customise'),
  NA('MENU', [], 'Menu'),
  NA('MENULOAD', [], 'Load menu'),
  NA('APPLOAD', ['AP'], 'Load application'),
  NA('NETLOAD', [], 'Load .NET application'),
  NA('SCRIPT', ['SCR'], 'Run script', 'BATCH runs the same operation over many files'),
  NA('VBARUN', [], 'Run VBA macro'),
  NA('VLISP', [], 'Visual LISP'),
  NA('ACTRECORD', [], 'Action recorder'),
  NA('ACTSTOP', [], 'Stop action recorder'),
  NA('WORKSPACE', [], 'Workspace'),
  NA('WSSAVE', [], 'Save workspace'),
  NA('PAGESETUP', [], 'Page setup', 'PLOT asks for paper and scale'),
  NA('PREVIEW', ['PRE'], 'Plot preview', 'PLOT writes the PDF directly'),
  NA('PLOTSTYLE', [], 'Plot style'),
  NA('PLOTTERMANAGER', [], 'Plotter manager'),
  NA('STYLESMANAGER', [], 'Plot styles manager'),
  NA('EXPORT', ['EXP'], 'Export', 'DXFOUT, PLOT, PNGOUT, MESHOUT'),
  NA('IMPORT', ['IMP'], 'Import', 'PDFIMPORT'),
  NA('EXPORTDWF', [], 'Export DWF'),
  NA('EXPORTLAYOUT', [], 'Export layout to model'),
  NA('JPGOUT', [], 'Save JPEG', 'PNGOUT'),
  NA('BMPOUT', [], 'Save BMP', 'PNGOUT'),
  NA('TIFOUT', [], 'Save TIFF', 'PNGOUT'),
  NA('WMFOUT', [], 'Save WMF'),
  NA('DWFATTACH', [], 'Attach DWF'),
  NA('DGNATTACH', [], 'Attach DGN'),
  NA('POINTCLOUDATTACH', [], 'Attach point cloud'),
  NA('XBIND', ['XB'], 'Bind xref'),
  NA('XCLIP', ['XC'], 'Clip xref'),
  NA('XOPEN', [], 'Open xref'),
  NA('REFEDIT', [], 'Edit reference in place'),
  NA('REFCLOSE', [], 'Close reference editing'),
  NA('IMAGECLIP', ['ICL'], 'Clip image'),
  NA('IMAGEADJUST', ['IAD'], 'Adjust image'),
  NA('IMAGEFRAME', [], 'Image frame'),
  NA('DATALINK', [], 'Data link'),
  NA('UPDATEFIELD', [], 'Update field'),
  NA('GEOMCONSTRAINT', ['GCON'], 'Geometric constraint'),
  NA('DIMCONSTRAINT', ['DCON'], 'Dimensional constraint'),
  NA('CONSTRAINTBAR', [], 'Constraint bar'),
  NA('PARAMETERS', ['PAR'], 'Parameters manager'),
  NA('DELCONSTRAINT', [], 'Delete constraints'),
  NA('AUTOCONSTRAIN', [], 'Auto constrain'),
  NA('BASE', [], 'Base point'),
  NA('QUIT', ['EXIT'], 'Quit', 'use the system back button'),
  NA('SHARE', [], 'Share drawing', 'DRIVE uploads; the Android share sheet is under More'),
  NA('PROPERTIESCLOSE', ['PRCLOSE'], 'Close properties', 'close the panel with its × button'),
  NA('LAYOUTWIZARD', [], 'Layout wizard'),
  NA('BCLOSE', [], 'Close block editor'),
  NA('BSAVE', [], 'Save block'),
  NA('CLIPIT', [], 'Clip it (Express)'),
  NA('ALIASEDIT', [], 'Edit aliases (Express)'),
  NA('DBCONNECT', ['DBC', 'AAD'], 'Database connect'),
];

/** id → BİRİNCİL kayıt (syn kayıtlar buraya girmez: etiket ve ipucu birincil addan okunur) */
export const BY_ID = new Map();
for (const c of COMMANDS) if (c.id && !c.syn && !BY_ID.has(c.id)) BY_ID.set(c.id, c);

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
    if (BY_NAME.has(k)) CAKISMA.push(`${k}: ${BY_NAME.get(k).cmd} / ${c.cmd}`);
    else BY_NAME.set(k, c);
  }
}

/** Tablonun kendi sağlığı: çakışan ad ve eksik alan listesi (sınama ve geliştirme içindir) */
export function dogrula() {
  const hata = [...CAKISMA];
  const gorulen = new Set();
  for (const c of COMMANDS) {
    if (!c.cmd) hata.push(`eksik komut adı: ${JSON.stringify(c)}`);
    if (c.avail === false) { if (c.id) hata.push(`bulunmayan komutun kimliği olamaz: ${c.cmd}`); }
    else if (!c.id) hata.push(`kimliksiz komut: ${c.cmd}`);
    if (c.syn && !BY_ID.has(c.id)) hata.push(`eşanlamlının birincil kaydı yok: ${c.cmd} → ${c.id}`);
    if (c.id && !c.syn) { if (gorulen.has(c.id)) hata.push(`yinelenen id (syn değil): ${c.id} (${c.cmd})`); gorulen.add(c.id); }
    if (!/^[A-Z0-9-_]+$/.test(c.cmd)) hata.push(`komut adı büyük harf değil: ${c.cmd}`);
    for (const a of (c.alias || [])) if (!/^[A-Z0-9-]+$/.test(a)) hata.push(`kısaltma büyük harf değil: ${a}`);
    if (!c.label) hata.push(`etiketsiz komut: ${c.cmd}`);
  }
  return hata;
}

/*
 * Yazılan metni komuta çevirir. AutoCAD'in kendi davranışları korunur:
 *  - büyük/küçük harf ayrımı yoktur
 *  - baştaki '_' (dil bağımsız önek) ve "'" (saydam komut öneki) atılır
 *  - baştaki '-' komut satırı sürümünü ister; adın parçasıysa korunur (-VP), değilse atılır
 * Dönen kayıt avail:false olabilir; çağıran buna bakıp "bulunmuyor" der.
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

/**
 * Boş Enter / sağ tuş bu eylemi yineleyebilir mi. Tabloda olmayan eylemler ve noRepeat
 * işaretliler yinelenmez; tabloda olmayan bir eylem "son komut" olarak da kaydedilmez.
 */
export function repeatable(id) {
  const c = BY_ID.get(id);
  return !!c && c.noRepeat !== true;
}

/** Bir kimliğin bütün adları: "TRIM (TR)" biçiminde ipucu metni */
export function namesOf(id) {
  const c = BY_ID.get(id);
  if (!c) return '';
  return c.alias && c.alias.length ? `${c.cmd} (${c.alias.join(', ')})` : c.cmd;
}

/** Sayım: { total, acad (çalışan AutoCAD adı), ext, known (tanınan ama bulunmayan), names } */
export function stats() {
  let acad = 0, ext = 0, known = 0;
  for (const c of COMMANDS) { if (c.avail === false) known++; else if (c.ext) ext++; else acad++; }
  return { total: COMMANDS.length, acad, ext, known, names: BY_NAME.size };
}

/**
 * Yazılan öneke uyan komutlar (komut satırı önerisi). AutoCAD'in otomatik tamamlamasında
 * olduğu gibi önce TAM ad başlangıçları, sonra kısaltmalar gelir; her ad bir kez görünür.
 * Çalışan komutlar bulunmayanlardan önce sıralanır: kullanıcı önce yapabildiğini görsün.
 */
export function suggest(text, limit = 8) {
  const s = String(text == null ? '' : text).trim().toUpperCase().replace(/^['_-]+/, '');
  if (!s) return [];
  const tam = [], kisa = [], gorulen = new Set();
  for (const c of COMMANDS) {
    if (c.cmd.startsWith(s)) { tam.push(c); gorulen.add(c.cmd); }
  }
  for (const c of COMMANDS) {
    if (gorulen.has(c.cmd)) continue;
    if ((c.alias || []).some(a => a.startsWith(s))) { kisa.push(c); gorulen.add(c.cmd); }
  }
  const na = (c) => (c.avail === false ? 1 : 0);
  tam.sort((a, b) => na(a) - na(b) || a.cmd.length - b.cmd.length || a.cmd.localeCompare(b.cmd));
  kisa.sort((a, b) => na(a) - na(b));
  return [...tam, ...kisa].slice(0, limit);
}
