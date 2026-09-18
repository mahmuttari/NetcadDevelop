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
  T('LINE', 't:line', ['L'], 'Line', { note: 'Direct distance entry: type a length in the box, then tap the direction (or press Enter first; the prompt then asks for the direction). Ortho / polar constrain the direction.' }),
  T('PLINE', 't:pline', ['PL'], 'Polyline', { note: 'Direct distance entry: type a length in the box, then tap the direction (or press Enter first; the prompt then asks for the direction). Ortho / polar constrain the direction.' }),
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
  T('WIPEOUT', 't:wipeout', [], 'Wipeout', { note: 'corners, or the Polyline button for a closed polyline; masks what is drawn below it' }),
  T('WIPEOUTFRAME', 'wipeframe', [], 'Wipeout frames', { noRepeat: true, note: 'toggles the frames (WIPEOUTFRAME 1 / 0)' }),
  T('TEXTMASK', 't:wipeout', [], 'Text mask (Express)', { syn: true, note: 'draw a WIPEOUT around the text, then send it below with DRAWORDER' }),
  T('POLYGON', 't:polygon', ['POL'], 'Polygon', { note: 'inscribed in a circle (AutoCAD Inscribed): number of sides (Enter = last / 6), center, then a vertex point or a typed radius' }),
  T('BOUNDARY', 't:boundary', ['BO'], 'Boundary', { note: 'tap inside a closed object: its outline becomes a new closed polyline on the current layer; an area enclosed by several separate objects is not traced' }),
  T('DIVIDE', 't:divide', ['DIV'], 'Divide', { note: 'tap a path, type the number of segments; POINT objects are placed at the divisions (n-1 points, n on a closed path)' }),
  T('MEASURE', 't:measure', ['ME'], 'Measure (place points)', { note: 'tap a path, type the spacing; POINT objects are placed along it starting from the tapped end. DIST measures a distance' }),

  // --- değiştirme
  T('SELECT', 't:select', [], 'Select objects'),
  T('AI_SELALL', 'selectall', [], 'Select all', { note: 'Ctrl+A; selects every visible object' }),
  T('SELECTSIMILAR', 'selectsimilar', [], 'Select similar', { note: 'select one or more objects first; every visible object of the same type on the same layer is added' }),
  T('QSELECT', 'selectsimilar', [], 'Quick select', { syn: true, note: 'same type and layer as the current selection; there is no filter dialog' }),
  T('HIDEOBJECTS', 'hideobj', [], 'Hide objects', { noRepeat: true, note: 'hides the selection until UNISOLATEOBJECTS; a display state, the drawing is not changed' }),
  T('ISOLATEOBJECTS', 'isoobj', ['ISOLATE'], 'Isolate objects', { noRepeat: true, note: 'shows only the selection; a display state' }),
  T('UNISOLATEOBJECTS', 'unisoobj', ['UNISOLATE', 'UNHIDE'], 'End object isolation', { noRepeat: true, note: 'shows hidden and isolated objects again' }),
  T('MOVE', 't:move', ['M'], 'Move', { note: 'works in the 3D view too: it then runs 3DMOVE and the points are snapped in 3D' }),
  T('COPY', 't:copy', ['CO', 'CP'], 'Copy'),
  T('ROTATE', 't:rotate', ['RO'], 'Rotate'),
  T('SCALE', 't:scale', ['SC'], 'Scale'),
  T('MIRROR', 't:mirror', ['MI'], 'Mirror', { note: 'AutoCAD asks "Erase source objects?" at the end; here it is the Keep original button on the command bar after the selection (default on, like AutoCAD\'s <N>). The X / Y buttons make the mirror line horizontal / vertical through a single point (what ORTHO does for the second point).' }),
  T('OFFSET', 't:offset', ['O'], 'Offset', { note: 'asks Screen or Measure first: Screen = through point, Measure = typed distance' }),
  T('ARRAY', 't:array', ['AR'], 'Array', { note: 'asks the type after the selection: rectangular, polar (tap the center) or path (tap the path); a Z increment stacks levels' }),
  T('ARRAYRECT', 't:arrayrect', [], 'Rectangular array', { note: 'columns, rows, X / Y spacing and a Z increment' }),
  T('ARRAYPOLAR', 't:arraypolar', [], 'Polar array', { note: 'tap the center point, then the copy count, total angle and whether the copies rotate' }),
  T('ARRAYPATH', 't:arraypath', [], 'Path array', { note: 'tap the path: by count (evenly divided, items at both ends) or by spacing; copies align to the path; the source moves to the tapped end' }),
  T('ARRAYCLASSIC', 't:array', [], 'Classic array dialog', { syn: true, note: 'the same form' }),
  T('3DARRAY', 't:array', ['3A'], '3D array', { syn: true, note: 'rectangular / polar in the plan with a Z increment per copy (levels)' }),
  T('ERASE', 't:del', ['E'], 'Erase'),
  T('TRIM', 't:trim', ['TR'], 'Trim', { note: 'asks Screen or Measure first: Screen = cutting edge, Measure = cut a typed length off the tapped end (LENGTHEN DElta)' }),
  T('EXTEND', 't:extend', ['EX'], 'Extend', { note: 'asks Screen or Measure first: Screen = boundary, Measure = add a typed length to the tapped end (LENGTHEN DElta)' }),
  T('FILLET', 't:fillet', ['F'], 'Fillet', { note: 'asks Screen or Measure first: Screen = tap where the arc should pass, Measure = radius first' }),
  T('CHAMFER', 't:chamfer', ['CHA'], 'Chamfer', { note: 'asks Screen or Measure first: Screen = tap where the chamfer should pass, Measure = equal distance first' }),
  T('EXPLODE', 't:explode', ['X'], 'Explode', { note: 'nested blocks are flattened in one step' }),
  T('ALIGN', 't:align', ['AL'], 'Align', { note: 'one point pair moves, two pairs move and rotate; the Scale button scales by the pair distance ratio' }),
  T('DRAWORDER', 't:draworder', ['DR'], 'Draw order', { note: 'front, back, above or below a reference object' }),
  T('TEXTTOFRONT', 'texttofront', [], 'Bring text to front', { noRepeat: true, note: 'texts and dimensions of the whole drawing' }),
  T('HATCHTOBACK', 'hatchtoback', [], 'Send hatches to back', { noRepeat: true }),
  T('STRETCH', 't:stretch', ['S'], 'Stretch', { note: 'select with a crossing window (drag right to left), then base and target point: vertices inside the window move, the rest stay; objects selected by tapping and texts / arcs whose anchor is inside move whole' }),
  T('LENGTHEN', 't:extend', ['LEN'], 'Lengthen', { syn: true, note: 'DElta only: EXTEND in Measure mode adds the typed length to the tapped end, TRIM in Measure mode cuts it off' }),
  T('JOIN', 't:join', ['J'], 'Join', { note: 'select lines, arcs and polylines whose ends touch; they become one polyline (closed when the chain returns to its start). Pieces whose ends do not touch are left out' }),
  T('MATCHPROP', 't:matchprop', ['MA'], 'Match properties', { note: 'tap the source object, then the targets (repeats until Finish): layer, colour and linetype are copied' }),
  T('TEXTEDIT', 't:edittext', ['ED', 'DDEDIT', 'TEDIT'], 'Edit text'),
  T('MTEDIT', 't:edittext', [], 'Edit multiline text', { syn: true }),
  T('ATTEDIT', 't:attr', ['ATE', 'ATTE'], 'Edit attributes'),
  T('EATTEDIT', 't:attr', [], 'Enhanced attribute editor', { syn: true }),
  T('THICKNESS', 't:thick', ['TH'], 'Thickness', { note: 'a system variable in AutoCAD; here it extrudes the selection' }),
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
  T('CUTCLIP', 'cutclip', [], 'Cut to clipboard', { note: 'copies the selection to the clipboard and erases it' }),

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
  T('RENAME', 'rename', ['REN'], 'Rename', { noRepeat: true, note: 'blocks and layers' }),
  T('DWGPROPS', 'info', [], 'Drawing properties', { noRepeat: true, note: 'the drawing info panel' }),

  // --- görünüm
  T('ZOOM', 'extents', ['Z', 'ZE'], 'Zoom extents', { note: 'ZOOM alone goes to extents; options are typed after it: Z W (window), Z P (previous), Z E / Z A (extents), Z O (selected objects), Z 2X / Z 0.5X (scale)' }),
  T('REGEN', 'regen', ['RE'], 'Regenerate', { noRepeat: true }),
  T('REGENALL', 'regen', ['REA'], 'Regenerate all', { syn: true, noRepeat: true }),
  T('REDRAW', 'regen', ['R'], 'Redraw', { syn: true, noRepeat: true }),
  T('REDRAWALL', 'regen', ['RA'], 'Redraw all', { syn: true, noRepeat: true }),
  T('VIEW', 'views', ['V'], 'Named views', { noRepeat: true }),
  T('DDVIEW', 'views', [], 'View dialog', { syn: true, noRepeat: true }),
  T('PLAN', 'v:top', [], 'Plan view'),
  T('VPOINT', 'v:iso', ['-VP'], 'Isometric view', { note: 'goes to the SW isometric preset' }),
  T('DDVPOINT', 'v:iso', ['VP'], 'Viewpoint presets', { syn: true, note: 'goes to the SW isometric preset; the 3D tab has six presets' }),
  T('3DORBIT', '3d', ['3DO', 'ORBIT'], '3D orbit', { noRepeat: true }),
  T('3DFORBIT', '3d', [], 'Free orbit', { syn: true, noRepeat: true }),
  T('3DCORBIT', '3d', [], 'Continuous orbit', { syn: true, noRepeat: true, note: 'the 3D view has a turntable toggle' }),
  T('3DZOOM', '3d', [], '3D zoom', { syn: true, noRepeat: true, note: 'pinch / wheel in the 3D view' }),
  T('3DPAN', '3d', [], '3D pan', { syn: true, noRepeat: true, note: 'two-finger / middle-button drag in the 3D view' }),
  T('3DDISTANCE', '3d', [], '3D adjust distance', { syn: true, noRepeat: true }),
  T('3DSWIVEL', '3d', [], '3D swivel', { syn: true, noRepeat: true }),
  T('3DMOVE', '3:move', ['3M'], '3D move'),
  T('ROTATE3D', '3:rotate', [], 'Rotate 3D', { syn: true, note: 'same as 3DROTATE here: the axis is Z through the tapped base point' }),
  T('3DROTATE', '3:rotate', ['3R'], '3D rotate', { note: 'rotates about the Z axis through the tapped base point; the angle is typed in degrees' }),
  T('3DSCALE', '3:scale', ['3S'], '3D scale', { note: 'uniform scale about the tapped base point; the elevation scales too' }),
  T('MIRROR3D', '3:mirror', [], '3D mirror', { note: 'mirrors about the vertical plane through two tapped points' }),
  T('3DLINE', '3:line', [], '3D line', { note: 'LINE also starts this while the 3D view is open' }),
  T('3DOSNAP', 'snap3set', ['3DOS'], '3D object snap settings', { noRepeat: true, note: 'which snap modes (END, MID, CEN, PER, NEA) a 3D tap obeys' }),
  T('VISUALSTYLES', 'vstyle', ['VSM'], 'Visual styles', { noRepeat: true }),
  T('VSCURRENT', 'vstyle', ['VS'], 'Current visual style', { syn: true, noRepeat: true }),
  T('SHADEMODE', 'vstyle', ['SHA'], 'Shade mode', { syn: true, noRepeat: true }),
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
  T('GEOGRAPHICLOCATION', 'basemap', ['GEO', 'NORTH'], 'Geographic location', { syn: true, noRepeat: true, note: 'the coordinate system is set in Settings' }),
  T('GEOMARKME', 'gps', [], 'Mark my location', { syn: true, noRepeat: true, note: 'shows the GPS position on the drawing; a note can be placed there' }),

  // --- ortam ve ayarlar
  T('OSNAP', 'osnapset', ['OS', 'DDOSNAP'], 'Object snap settings', { noRepeat: true, note: '-OSNAP asks for the mode list on the command line' }),
  T('OTRACK', 'otrack', [], 'Object snap tracking', { ext: true, noRepeat: true, note: 'F11 or the button next to Ortho · pause over a snap point (or tap it after the TT button) to acquire a tracking point; the cursor snaps to alignment paths through acquired points and to their intersections' }),
  T('GRID', 'grid', [], 'Grid', { noRepeat: true }),
  T('ORTHO', 'ortho', [], 'Ortho', { noRepeat: true, note: 'F8, the Ortho tile on the Display tab, or the Ortho button in the command bar input row whenever a point is requested (phones have no F8).' }),
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
  T('COMMANDLINE', 'cmdline', ['CLI'], 'Command line', { noRepeat: true }),
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
  T('PLOT', 'pdf', ['PRINT', 'EXPORTPDF', 'EPDF'], 'Plot to PDF'),
  T('PUBLISH', 'batch', [], 'Publish', { syn: true, noRepeat: true, note: 'batch conversion to PDF' }),
  T('PNGOUT', 'png', [], 'Save PNG'),
  T('SAVEIMG', 'png', [], 'Save image', { syn: true }),
  // --- bloklar ve harici referanslar (v7.72: çizim içi blok tablosu)
  T('INSERT', 't:insert', ['I'], 'Insert block', { note: 'block (drawing, DWG or library), scale, rotation, rows / columns; then tap the insertion point; attributes are asked' }),
  T('CLASSICINSERT', 't:insert', [], 'Classic insert', { syn: true }),
  T('MINSERT', 't:insert', [], 'Multiple insert', { syn: true, note: 'rows / columns in the INSERT form; separate insertions, not one MINSERT entity' }),
  T('BLOCK', 't:block', ['B'], 'Block', { note: 'select objects, tap the base point, then name and Convert / Retain / Delete; attribute definitions become attributes' }),
  T('BLOCKS', 'blocks', [], 'Blocks', { noRepeat: true, note: 'AutoCAD 2020+ Blocks palette: definitions of the drawing — insert, edit, rename, replace, attributes, library, WBLOCK, purge' }),
  T('BLOCKSPALETTE', 'blocks', [], 'Blocks palette', { syn: true, noRepeat: true }),
  T('BEDIT', 't:bedit', ['BE'], 'Block editor', { noRepeat: true, note: 'tap an insertion (or pick in Blocks): the definition opens in its own session; BSAVE / BCLOSE; parameters make it dynamic' }),
  T('BSAVE', 'bsave', ['BS'], 'Save block', { noRepeat: true }),
  T('BCLOSE', 'bclose', ['BC'], 'Close block editor', { noRepeat: true }),
  T('BPARAMETER', 't:bparam', [], 'Block parameter', { noRepeat: true, note: 'in the block editor: visibility, flip, rotation, linear (move / stretch) or point parameter; instances get grips. AutoCAD dynamic blocks read from DWG are not evaluated' }),
  T('BVSTATE', 't:bvstate', [], 'Visibility state', { noRepeat: true, note: 'in the block editor: assign the selected objects to a visibility state' }),
  T('REFEDIT', 't:refedit', [], 'Edit reference in place', { noRepeat: true, note: 'other objects fade; REFCLOSE saves or discards; the definition and every insertion change' }),
  T('REFCLOSE', 'refclose', [], 'Close reference editing', { noRepeat: true }),
  T('ATTDEF', 't:attdef', ['ATT'], 'Attribute definition'),
  T('ATTSYNC', 'attsync', [], 'Synchronise attributes', { noRepeat: true, note: 'rebuilds every insertion from its definition; values are kept by tag' }),
  T('BATTMAN', 'battman', [], 'Block attribute manager', { noRepeat: true, note: 'tag, prompt, default, invisible / constant, delete; insertions are synchronised' }),
  T('BATTORDER', 'battman', [], 'Attribute order', { syn: true, noRepeat: true, note: 'attributes keep the definition order' }),
  T('ATTDISP', 'attdisp', [], 'Attribute display', { noRepeat: true, note: 'toggles attribute visibility (Display › Attributes)' }),
  T('ATTIPEDIT', 't:attr', ['ATI'], 'Edit attribute in place', { syn: true }),
  T('BLOCKREPLACE', 'blockreplace', [], 'Replace block', { noRepeat: true, note: 'every insertion of a block becomes another block; the old definition can be purged' }),
  T('WBLOCK', 'wblock', ['W'], 'Write block', { noRepeat: true, note: 'writes a block, the selection or the whole drawing to a DXF file; $INSBASE is the block base' }),
  T('BASE', 't:base', [], 'Base point', { note: 'in the block editor the definition base; otherwise $INSBASE of the drawing' }),
  T('PURGE', 'purge', ['PU'], 'Purge', { noRepeat: true, note: 'unused block definitions and empty layers' }),
  T('NCOPY', 't:ncopy', [], 'Copy nested objects'),
  T('XPLODE', 't:explode', [], 'Explode with options', { syn: true }),
  T('BURST', 't:explode', [], 'Burst block (Express)', { syn: true, note: 'attribute values stay as text' }),
  T('DESIGNCENTER', 'blocklib', ['ADC', 'DC'], 'DesignCenter', { noRepeat: true, note: 'the device block library (blocks kept across drawings)' }),
  T('TOOLPALETTES', 'blocklib', ['TP'], 'Tool palettes', { syn: true, noRepeat: true }),
  T('XREF', 'xrefs', ['XR'], 'External references', { noRepeat: true, note: 'attach, reload, unload, detach, bind, clip, fade; missing references of the file are picked from the list' }),
  T('EXTERNALREFERENCES', 'xrefs', ['ER'], 'External references palette', { syn: true, noRepeat: true }),
  T('XATTACH', 'xattach', ['XA'], 'Attach xref', { noRepeat: true, note: 'pick a DWG / DXF, insertion point, scale and rotation' }),
  T('ATTACH', 'xattach', [], 'Attach', { syn: true, noRepeat: true }),
  T('XCLIP', 't:xclip', ['XC'], 'Clip xref', { note: 'rectangular window; the clip is kept on reload' }),
  T('XBIND', 'xbind', ['XB'], 'Bind xref', { noRepeat: true, note: 'the reference becomes a block definition and an insertion of this drawing' }),
  T('XOPEN', 'xopen', [], 'Open xref', { noRepeat: true }),
  T('XDWGFADECTL', 'xreffade', [], 'Xref fade', { noRepeat: true, note: 'toggles fading of attached references' }),
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
  T('CROSSHAIR', 'crosshair', [], 'Crosshair', { ext: true, noRepeat: true, note: 'AutoCAD: the CURSORSIZE variable. The pickbox (PICKBOX) is separate and always on: at an object prompt the crosshair is replaced by a small square and object snap is suppressed.' }),
  T('DRIVE', 'drive', [], 'Google Drive', { ext: true, noRepeat: true }),

  // =============================================================================================
  // TANINAN AMA BULUNMAYAN AutoCAD komutları (avail:false): komut satırı bunları "bilinmeyen"
  // saymaz; yazılınca bulunmadığını ve varsa en yakın karşılığı söyler.
  // =============================================================================================
  // --- çizim
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
  NA('REGION', ['REG'], 'Region'),
  NA('GRADIENT', ['GD'], 'Gradient fill', 'solid fill only (HATCH)'),
  NA('TABLE', ['TB'], 'Table', 'tables in files are read with TABLEEXPORT'),
  NA('FIELD', [], 'Field'),
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
  NA('BREAK', ['BR'], 'Break', 'TRIM removes a piece between two edges'),
  NA('BREAKATPOINT', [], 'Break at point'),
  NA('PEDIT', ['PE'], 'Edit polyline', 'JOIN joins pieces into one polyline; vertices are edited with GRIPS'),
  NA('SPLINEDIT', ['SPE'], 'Edit spline'),
  NA('MLEDIT', [], 'Edit multiline'),
  NA('3DALIGN', ['3AL'], '3D align'),
  NA('REVERSE', [], 'Reverse direction'),
  NA('OVERKILL', [], 'Delete duplicate objects'),
  NA('BLEND', [], 'Blend curves', 'use FILLET'),
  NA('CHANGE', ['-CH'], 'Change', 'use PROPERTIES or MATCHPROP'),
  NA('CHPROP', [], 'Change properties', 'use PROPERTIES'),
  NA('CHSPACE', [], 'Change space'),
  NA('ARRAYEDIT', [], 'Edit array', 'arrays are plain copies here: undo and run ARRAY again'),
  NA('COPYTOLAYER', [], 'Copy to layer', 'COPY, then MATCHPROP or the layer from PROPERTIES'),
  NA('FLATTEN', [], 'Flatten (Express)', 'SETZ assigns a single elevation'),
  NA('TXT2MTXT', [], 'Convert text to mtext (Express)'),
  NA('TCOUNT', [], 'Number text (Express)', 'BALLOON numbers positions'),
  NA('TEXTFIT', [], 'Fit text (Express)'),
  NA('EXTRIM', [], 'Extended trim (Express)', 'use TRIM'),
  NA('MOCORO', [], 'Move-copy-rotate (Express)'),
  NA('PASTESPEC', ['PA'], 'Paste special', 'use PASTECLIP'),
  NA('COPYLINK', [], 'Copy link'),
  NA('ADDSELECTED', [], 'Add selected'),
  NA('FILTER', ['FI'], 'Object selection filter'),
  NA('GROUP', ['G'], 'Group', 'grouped objects in files select together; creating groups is not available'),
  NA('UNGROUP', [], 'Ungroup'),
  NA('CLASSICGROUP', [], 'Classic group dialog'),

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
  NA('FLATSHOT', ['FSHOT'], 'Flatshot'),
  NA('LIVESECTION', [], 'Live section', 'SECTIONPLANE clips the 3D view'),
  NA('VIEWBASE', [], 'Base view'),
  NA('VIEWSECTION', [], 'Section view'),
  NA('VIEWDETAIL', [], 'Detail view'),

  // --- ölçülendirme ve açıklama
  NA('DIMBASELINE', ['DBA'], 'Baseline dimension', 'place separate DIMLINEAR dimensions'),
  NA('DIMCONTINUE', ['DCO'], 'Continue dimension', 'place separate DIMLINEAR dimensions'),
  NA('DIMORDINATE', ['DOR'], 'Ordinate dimension', 'ID shows a coordinate; MARKDIM writes it'),
  NA('DIMARC', ['DAR'], 'Arc length dimension'),
  NA('DIMJOGGED', ['DJO', 'JOG'], 'Jogged dimension'),
  NA('DIMJOGLINE', ['DJL'], 'Jog line'),
  NA('DIMCENTER', ['DCE'], 'Center mark dimension'),
  T('DIMEDIT', 't:dimedit', ['DED'], 'Edit dimension', { note: 'opens the dimension properties: text, height, arrow, decimals, prefix / suffix, factor' }),
  NA('DIMTEDIT', [], 'Edit dimension text position'),
  NA('DIMSPACE', [], 'Adjust dimension spacing'),
  NA('DIMBREAK', [], 'Dimension break'),
  NA('DIMREASSOCIATE', ['DRE'], 'Reassociate dimensions'),
  NA('DIMDISASSOCIATE', ['DDA'], 'Disassociate dimensions'),
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
  NA('ATTEXT', [], 'Attribute extraction', 'TEXTOUT extracts texts and attributes'),
  NA('ATTIN', [], 'Attribute import (Express)'),
  NA('ATTOUT', [], 'Attribute export (Express)', 'use TEXTOUT'),
  NA('TINSERT', [], 'Insert block in table cell'),
  NA('BACTION', [], 'Block action', 'parameters carry their action here (BPARAMETER)'),
  NA('BLOOKUPTABLE', [], 'Block lookup table'),
  NA('BCYCLEORDER', [], 'Grip cycling order'),
  NA('BAUTHORPALETTE', [], 'Block authoring palettes', 'BPARAMETER in the block editor'),
  NA('BLOCKICON', [], 'Block icons'),
  NA('REFSET', [], 'Add to / remove from working set', 'REFEDIT edits the whole definition'),
  NA('XREFTYPE', [], 'Xref type (attach / overlay)', 'references are attached'),
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
  NA('STEERINGWHEELS', ['WHEEL'], 'SteeringWheels'),
  NA('SHOWMOTION', [], 'ShowMotion', 'VIEW keeps named views'),
  NA('NEWSHOT', [], 'New shot', 'VIEW keeps named views'),
  NA('VIEWRES', [], 'View resolution'),
  NA('CLEANSCREENON', [], 'Clean screen on', 'collapse the toolbar with the handle'),
  NA('CLEANSCREENOFF', [], 'Clean screen off'),
  NA('RIBBON', [], 'Ribbon'),
  NA('RIBBONCLOSE', [], 'Close ribbon'),
  NA('SHEETSET', ['SSM'], 'Sheet set manager'),
  NA('LAYERSTATE', ['LAS'], 'Layer states'),
  NA('LAYWALK', [], 'Layer walk', 'isolate a layer from the layer list'),
  NA('LAYERP', [], 'Previous layer state'),
  NA('LAYTRANS', [], 'Layer translator'),
  NA('LAYVPI', [], 'Layer viewport isolate'),
  NA('RENDERPRESETS', ['RP'], 'Render presets'),
  NA('RENDERWIN', ['RW'], 'Render window'),
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
  NA('SETVAR', ['SET'], 'Set variable'),
  NA('SYSVARMONITOR', [], 'System variable monitor'),
  NA('STATUS', [], 'Status', 'DWGPROPS shows drawing info'),
  NA('TIME', [], 'Time'),
  NA('MASSPROP', [], 'Mass properties', 'AREA and the surface area tool measure geometry'),
  NA('QUICKCALC', ['QC'], 'Quick calculator'),
  NA('CAL', [], 'Geometry calculator'),
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
  NA('IMAGECLIP', ['ICL'], 'Clip image'),
  NA('IMAGEADJUST', ['IAD'], 'Adjust image'),
  NA('IMAGEFRAME', [], 'Image frame'),
  NA('DATALINK', ['DL'], 'Data link'),
  NA('DATALINKUPDATE', ['DLU'], 'Update data link'),
  NA('UPDATEFIELD', [], 'Update field'),
  NA('GEOMCONSTRAINT', ['GCON'], 'Geometric constraint'),
  NA('DIMCONSTRAINT', ['DCON'], 'Dimensional constraint'),
  NA('CONSTRAINTBAR', ['CBAR'], 'Constraint bar'),
  NA('PARAMETERS', ['PAR'], 'Parameters manager'),
  NA('DELCONSTRAINT', [], 'Delete constraints'),
  NA('AUTOCONSTRAIN', [], 'Auto constrain'),
  NA('QUIT', ['EXIT'], 'Quit', 'use the system back button'),
  NA('SHARE', [], 'Share drawing', 'DRIVE uploads; the Android share sheet is under More'),
  NA('PROPERTIESCLOSE', ['PRCLOSE'], 'Close properties', 'close the panel with its × button'),
  NA('QUICKPROPERTIES', ['QP'], 'Quick properties', 'PROPERTIES, or the selection badge menu'),
  NA('TEXTALIGN', ['TA'], 'Align text', 'move texts with MOVE or the selection handle'),
  NA('TILEMODE', ['TI', 'TM'], 'Tile mode', 'LAYOUT switches between Model and the layouts'),
  NA('TOOLBAR', ['TO'], 'Toolbar', 'the ribbon tabs'),
  NA('TEXTSCR', [], 'Text window', 'the ↑ / ↓ keys browse the command history'),
  NA('INSERTOBJ', ['IO'], 'Insert OLE object'),
  NA('COPYM', [], 'Multiple copy (Express)', 'COPY repeats until Finish'),
  NA('MPEDIT', [], 'Multiple polyline edit (Express)', 'JOIN'),
  NA('SAVEALL', [], 'Save all (Express)', 'QSAVE'),
  NA('TXTEXP', [], 'Explode text (Express)'),
  NA('LAYMCH', [], 'Match layer', 'MATCHPROP copies the layer too'),
  NA('GEOMARKPOSITION', [], 'Mark position', 'GEOMARKME shows the GPS position; NOTES place a marker'),
  NA('DRAWINGRECOVERY', ['DRM'], 'Drawing recovery', 'the last session is resumed from the home screen'),
  NA('CTABLESTYLE', ['CT'], 'Current table style'),
  NA('QVDRAWING', ['QVD'], 'Quick view drawings', 'the home screen lists recent files'),
  NA('QVLAYOUT', ['QVL'], 'Quick view layouts', 'LAYOUT'),
  NA('DSVIEWER', ['AV'], 'Aerial view', 'ZOOM W'),
  NA('PUBLISHTOWEB', ['PTW'], 'Publish to web', 'PLOT writes a PDF; DRIVE uploads it'),
  NA('MESHSMOOTHMORE', ['MORE'], 'Smooth mesh more'),
  NA('MESHSMOOTHLESS', ['LESS'], 'Smooth mesh less'),
  NA('LAYOUTWIZARD', [], 'Layout wizard'),
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
