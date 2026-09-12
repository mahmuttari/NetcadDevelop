/*
 * ASCII DXF çözümleyici → SceneBuilder'ın beklediği DwgDatabase biçimi.
 * Açılar DXF'te derece, libredwg'de radyan olduğundan burada radyana çevrilir.
 */
import { OEM_TABLES, decodeCp } from './codepage.js';

const D2R = Math.PI / 180;
// DXF çizgi kalınlığı 1/100 mm → DWG kodu (scene.js LW_TABLE ile aynı sıra); -1/-2/-3 → 29/30/31
const LWT = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const lwCode = (v) => v === -3 ? 31 : v === -2 ? 30 : v === -1 ? 29 : (LWT.indexOf(v) >= 0 ? LWT.indexOf(v) : 31);
const hasBom = (b) => b.length > 2 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;

const CODEPAGES = { ANSI_1254: 'windows-1254', ANSI_1252: 'windows-1252', ANSI_1251: 'windows-1251', ANSI_1250: 'windows-1250', ANSI_1253: 'windows-1253',
  ANSI_1255: 'windows-1255', ANSI_1256: 'windows-1256', ANSI_1257: 'windows-1257', ANSI_1258: 'windows-1258', ANSI_874: 'windows-874', ANSI_932: 'shift_jis',
  ANSI_936: 'gbk', ANSI_949: 'euc-kr', ANSI_950: 'big5', ISO8859_9: 'iso-8859-9', ISO8859_1: 'iso-8859-1', ISO8859_2: 'iso-8859-2', DOS857: 'ibm857', DOS850: 'ibm850' };

export function isDxf(bytes0) {
  const bytes = hasBom(bytes0) ? bytes0.subarray(3) : bytes0;   // UTF-8 BOM (Not Defteri, GIS dışa aktarıcıları)
  const head = String.fromCharCode(...bytes.slice(0, 64));
  return /^\s*0\s*\r?\n\s*SECTION/.test(head) || /^\s*999/.test(head) || head.startsWith('AutoCAD Binary DXF');
}

function decodeText(bytes0) {
  const bom = hasBom(bytes0), bytes = bom ? bytes0.subarray(3) : bytes0;
  const head = String.fromCharCode(...bytes.slice(0, 64));
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error('İkili (binary) DXF desteklenmiyor; ASCII DXF olarak kaydedin.');
  const latin = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 200000)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(latin);
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*([A-Za-z0-9_]+)/.exec(latin);
  let enc = 'utf-8';
  if (ver && ver[1] < 'AC1021' && cp) enc = CODEPAGES[cp[1].toUpperCase()] || 'windows-1254';
  else if (!ver && cp) enc = CODEPAGES[cp[1].toUpperCase()] || 'utf-8';
  if (bom) enc = 'utf-8';                                        // BOM varsa dosya UTF-8'dir, kod sayfası başlığına bakılmaz
  if (OEM_TABLES[enc]) return { text: decodeCp(bytes, OEM_TABLES[enc]), version: ver ? ver[1] : '' };   // DOS857/DOS850: tarayıcı tanımaz
  try { return { text: new TextDecoder(enc, { fatal: false }).decode(bytes), version: ver ? ver[1] : '' }; }
  catch (_) { return { text: new TextDecoder('utf-8').decode(bytes), version: ver ? ver[1] : '' }; }
}

/** \U+XXXX ve %%nnn dizilerini çözer */
function unescapeText(s) {
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\M\+\w{5}/g, '?');
}

class Reader {
  constructor(text) {
    this.lines = text.split(/\r?\n/);
    this.i = 0;
    this.code = null; this.value = null;
  }
  next() {
    while (this.i + 1 < this.lines.length) {
      const c = parseInt(this.lines[this.i].trim(), 10);
      const v = this.lines[this.i + 1];
      this.i += 2;
      if (Number.isNaN(c)) continue;
      this.code = c;
      this.value = v.trim();
      return true;
    }
    this.code = null; this.value = null;
    return false;
  }
  peek() { const save = this.i; const ok = this.next(); const r = ok ? [this.code, this.value] : null; this.i = save; return r; }
  num() { const n = parseFloat(this.value); return Number.isNaN(n) ? 0 : n; }
}

/** opts.onProgress(oran 0..1): ENTITIES/BLOCKS okunurken her 2000 varlıkta bir çağrılır */
export function parseDxf(bytes, opts = {}) {
  const { text, version } = decodeText(bytes);
  const rd = new Reader(text);
  const prog = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  let progN = 0;
  const db = {
    header: { ACADVER: version },
    tables: { LAYER: { entries: [] }, LTYPE: { entries: [] }, STYLE: { entries: [] }, DIMSTYLE: { entries: [] }, BLOCK_RECORD: { entries: [] }, APPID: { entries: [] }, VPORT: { entries: [] } },
    objects: { LAYOUT: [], IMAGEDEF: [], DICTIONARY: [] },
    entities: [], classes: [],
  };
  const blocks = [];
  let handleSeq = 1;
  const nextHandle = () => 'X' + (handleSeq++).toString(16).toUpperCase();

  // ---- ortak varlık okuyucu -------------------------------------------------------
  function readEntity(type) {
    const e = { type, handle: '', layer: '0', colorIndex: 256, lineType: '', lineweight: -1, lineTypeScale: 1, isVisible: true, xdata: [], ownerBlockRecordSoftId: '', isInPaperSpace: false };
    const P = {};   // kod → değer listesi (sıralı)
    const seq = []; // (kod,değer) sırası — HATCH, LWPOLYLINE gibi sıralı yapılar için
    let xapp = null;
    while (rd.next()) {
      if (rd.code === 0) break;
      const c = rd.code, v = rd.value;
      if (c >= 1000) {
        if (c === 1001) { xapp = { appName: v, value: [] }; e.xdata.push(xapp); }
        else if (xapp) xapp.value.push({ code: c, value: c >= 1010 && c < 1060 ? parseFloat(v) : (c >= 1060 ? parseFloat(v) : unescapeText(v)) });
        continue;
      }
      switch (c) {
        case 5: e.handle = v; break;
        case 8: e.layer = v; break;
        case 6: e.lineType = v; break;
        case 62: e.colorIndex = parseInt(v, 10); break;
        case 420: e.color = parseInt(v, 10) & 0xffffff; break;
        case 370: e.lineweight = lwCode(parseInt(v, 10)); break;   // DXF 1/100 mm → DWG kodu (scene.js lwOf kod bekler)
        case 48: e.lineTypeScale = parseFloat(v); break;
        case 60: e.isVisible = parseInt(v, 10) === 0; break;
        case 67: e.isInPaperSpace = parseInt(v, 10) === 1; break;
        case 330: if (!e.ownerBlockRecordSoftId) e.ownerBlockRecordSoftId = v; break;
        default: break;
      }
      (P[c] || (P[c] = [])).push(v);
      seq.push([c, v]);
    }
    if (!e.handle) e.handle = nextHandle();
    return { e, P, seq };
  }
  const f = (P, c, i = 0, d = 0) => { const a = P[c]; if (!a || a[i] == null) return d; const n = parseFloat(a[i]); return Number.isNaN(n) ? d : n; };
  const s = (P, c, i = 0, d = '') => { const a = P[c]; return a && a[i] != null ? unescapeText(a[i]) : d; };
  const pt = (P, c, i = 0) => ({ x: f(P, c, i), y: f(P, c + 10, i), z: f(P, c + 20, i) });
  const textBase = (P) => ({
    text: s(P, 1), thickness: f(P, 39), startPoint: pt(P, 10), endPoint: pt(P, 11), textHeight: f(P, 40), rotation: f(P, 50) * D2R,
    xScale: f(P, 41, 0, 1), obliqueAngle: f(P, 51) * D2R, styleName: s(P, 7, 0, 'STANDARD'), generationFlag: f(P, 71), halign: f(P, 72), valign: f(P, 73),
    extrusionDirection: { x: f(P, 210), y: f(P, 220), z: f(P, 230, 0, 1) } });

  function finishEntity(type, r) {
    const { e, P, seq } = r;
    if (P[210] || P[230]) e.extrusionDirection = { x: f(P, 210), y: f(P, 220), z: f(P, 230, 0, 1) };
    switch (type) {
      case '3DSOLID': case 'REGION': case 'BODY': {
        // ACIS SAT metni: 1 ve 3 kodlu satırlar, her karakter 159 - kod ile gizlenmiştir (33..126)
        const lines = seq.filter(q => q[0] === 1 || q[0] === 3).map(q => q[1]);
        if (lines.length) e.acisText = lines.join('\n').replace(/[\x21-\x7e]/g, ch => String.fromCharCode(159 - ch.charCodeAt(0)));
        // R2013+: veri ACDSDATA bölümündeki ACDSRECORD'dadır (290 bayrağı); bölüm okununca db.raw3d[handle].acis dolar
        return e;
      }
      case 'MESH': {                                            // AcDbSubDMesh: 92 köşe sayısı, 10/20/30; 93 yüz listesi boyu, 90 (sayı, indeksler…); 94 kenarlar (atlanır)
        const verts = [], faces = []; let mode = 0, cur = null;
        for (const [c, v] of seq) {
          if (c === 92) mode = 1; else if (c === 93) mode = 2; else if (c === 94 || c === 95) mode = 3;
          else if (mode === 1 && c === 10) { cur = [parseFloat(v), 0, 0]; verts.push(cur); }
          else if (mode === 1 && cur && c === 20) cur[1] = parseFloat(v);
          else if (mode === 1 && cur && c === 30) cur[2] = parseFloat(v);
          else if (mode === 2 && c === 90) faces.push(parseInt(v, 10));
        }
        if (verts.length && faces.length) (db.raw3d || (db.raw3d = {}))[e.handle] = { mesh: { verts, faces } };   // DWG yoluyla aynı biçim (worker.js collectRaw3D)
        return e;
      }
      case 'ACAD_TABLE': {                                      // AcDbBlockReference: geometri 2/340'taki *T bloğunda; INSERT gibi çizilir
        e.type = 'INSERT'; e.name = s(P, 2); e.blockRecordHandle = s(P, 340); e.insertionPoint = pt(P, 10);
        e.xScale = e.yScale = e.zScale = 1; e.rotation = P[11] ? Math.atan2(f(P, 21), f(P, 11, 0, 1)) : 0;
        e.columnCount = e.rowCount = 0; e.attribs = []; e.tableRows = f(P, 91); e.tableCols = f(P, 92);
        if (!e.name && e.blockRecordHandle) { const br = [...brHandles.entries()].find(q => q[1] === e.blockRecordHandle); if (br) e.name = br[0]; }
        return e;
      }
      case 'TOLERANCE': e.text = s(P, 1); e.insertionPoint = pt(P, 10); e.direction = P[11] ? pt(P, 11) : undefined; e.styleName = s(P, 3, 0, 'STANDARD'); return e;
      case 'MULTILEADER': case 'MLEADER': return finishMleader(e, P, seq);
      case 'ACAD_PROXY_ENTITY': e.graphicsData = proxyGraphics(seq); return e;
      case 'LINE': e.startPoint = pt(P, 10); e.endPoint = pt(P, 11); return e;
      case 'POINT': e.position = pt(P, 10); return e;
      case 'CIRCLE': e.center = pt(P, 10); e.radius = f(P, 40); return e;
      case 'ARC': e.center = pt(P, 10); e.radius = f(P, 40); e.startAngle = f(P, 50) * D2R; e.endAngle = f(P, 51) * D2R; return e;
      case 'ELLIPSE': e.center = pt(P, 10); e.majorAxisEndPoint = pt(P, 11); e.axisRatio = f(P, 40, 0, 1); e.startAngle = f(P, 41); e.endAngle = f(P, 42, 0, Math.PI * 2); return e;
      case 'LWPOLYLINE': {
        const fl70 = f(P, 70); e.flag = (fl70 & 1 ? 512 : 0) | (fl70 & 128 ? 256 : 0);   // DWG kuruluşu: 512 kapalı, 256 plinegen (scene.js 512'ye bakar)
        e.constantWidth = f(P, 43); e.elevation = f(P, 38);
        const vs = []; let cur = null;
        for (const [c, v] of seq) {
          if (c === 10) { cur = { id: vs.length, x: parseFloat(v), y: 0, bulge: 0 }; vs.push(cur); }
          else if (cur && c === 20) cur.y = parseFloat(v);
          else if (cur && c === 42) cur.bulge = parseFloat(v);
          else if (cur && c === 40) cur.startWidth = parseFloat(v);
          else if (cur && c === 41) cur.endWidth = parseFloat(v);
        }
        e.vertices = vs; e.numberOfVertices = vs.length; return e;
      }
      case 'SPLINE': {
        e.flag = f(P, 70); e.degree = f(P, 71, 0, 3); e.knots = (P[40] || []).map(parseFloat); e.weights = (P[41] || []).map(parseFloat);
        e.controlPoints = (P[10] || []).map((v, i) => pt(P, 10, i)); e.fitPoints = (P[11] || []).map((v, i) => pt(P, 11, i));
        if (!e.weights.length) delete e.weights;
        return e;
      }
      case 'TEXT': Object.assign(e, textBase(P)); return e;
      case 'ATTDEF': e.text = textBase(P); e.tag = s(P, 2); e.prompt = s(P, 3); e.flags = f(P, 70); if (P[74]) e.text.valign = f(P, 74); if (P[3]) e.text.text = s(P, 1); return e;
      case 'ATTRIB': e.text = textBase(P); e.tag = s(P, 2); e.flags = f(P, 70); if (P[74]) e.text.valign = f(P, 74); return e;
      case 'MTEXT': {
        let t = (P[3] || []).join('') + s(P, 1);
        e.text = unescapeText(t); e.insertionPoint = pt(P, 10); e.textHeight = f(P, 40); e.rectWidth = f(P, 41); e.attachmentPoint = f(P, 71, 0, 1);
        e.rotation = f(P, 50) * D2R; e.direction = P[11] ? pt(P, 11) : undefined; e.styleName = s(P, 7, 0, 'STANDARD'); e.lineSpacing = f(P, 44, 0, 1);
        return e;
      }
      case 'INSERT': e.name = s(P, 2); e.insertionPoint = pt(P, 10); e.xScale = f(P, 41, 0, 1); e.yScale = f(P, 42, 0, 1); e.zScale = f(P, 43, 0, 1); e.rotation = f(P, 50) * D2R;
        e.columnCount = f(P, 70); e.rowCount = f(P, 71); e.columnSpacing = f(P, 44); e.rowSpacing = f(P, 45); e.attribs = []; e._attribsFollow = f(P, 66) === 1; return e;
      case 'SOLID': case 'TRACE': e.corner1 = pt(P, 10); e.corner2 = pt(P, 11); e.corner3 = pt(P, 12); e.corner4 = P[13] ? pt(P, 13) : undefined; return e;
      case '3DFACE': e.corner1 = pt(P, 10); e.corner2 = pt(P, 11); e.corner3 = pt(P, 12); e.corner4 = P[13] ? pt(P, 13) : undefined; e.flag = f(P, 70); return e;
      case 'LEADER': e.vertices = (P[10] || []).map((v, i) => pt(P, 10, i)); e.styleName = s(P, 3, 0, 'STANDARD'); e.isArrowheadEnabled = f(P, 71, 0, 1) === 1; e.isSpline = f(P, 72) === 1; e.isHooklineExists = f(P, 75) === 1; return e;
      case 'XLINE': case 'RAY': e.firstPoint = pt(P, 10); e.unitDirection = pt(P, 11); return e;
      case 'DIMENSION': {
        e.name = s(P, 2); e.definitionPoint = pt(P, 10); e.textPoint = { x: f(P, 11), y: f(P, 21) }; e.dimensionType = f(P, 70); e.text = s(P, 1); e.measurement = P[42] ? f(P, 42) : undefined;
        e.styleName = s(P, 3, 0, 'STANDARD'); e.textRotation = f(P, 53) * D2R;
        if (P[12]) e.insertionPoint = pt(P, 12);   // paylaşılan *D bloğu için ekleme noktası
        e.subDefinitionPoint1 = pt(P, 13); e.subDefinitionPoint2 = pt(P, 14); e.centerPoint = P[15] ? pt(P, 15) : undefined; e.rotationAngle = f(P, 50) * D2R;
        // 2 çizgili açısal (dönüştürücüyle aynı adlar): 13→14 birinci çizgi, 15→10 ikinci çizgi (centerPoint = 10), 16 yay noktası (definitionPoint)
        if ((e.dimensionType & 15) === 2) { e.xline1Start = pt(P, 13); e.xline1End = pt(P, 14); e.xline2Start = e.centerPoint; e.centerPoint = e.definitionPoint; if (P[16]) e.definitionPoint = pt(P, 16); }
        return e;
      }
      case 'POLYLINE': {
        const fl = f(P, 70);
        e.type = (fl & 8) ? 'POLYLINE3D' : (fl & 64) ? 'POLYFACE' : (fl & 16) ? 'POLYLINE_MESH' : 'POLYLINE2D';
        if (fl & 16) { e.mCount = f(P, 71); e.nCount = f(P, 72); }
        e.flag = fl; e.elevation = f(P, 30); e.startWidth = f(P, 40); e.endWidth = f(P, 41); e.vertices = []; e._seq = true; return e;
      }
      case 'VIEWPORT': e.viewportCenter = pt(P, 10); e.width = f(P, 40); e.height = f(P, 41); e.status = f(P, 68); e.viewportId = f(P, 69); e.displayCenter = { x: f(P, 12), y: f(P, 22) };
        e.viewHeight = f(P, 45); e.viewTwistAngle = f(P, 51) * D2R; e.statusBitFlags = f(P, 90); e.frozenLayers = (P[331] || []).slice(); return e;
      case 'IMAGE': case 'WIPEOUT': {
        e.position = pt(P, 10); e.uPixel = pt(P, 11); e.vPixel = pt(P, 12); e.imageSize = { x: f(P, 13), y: f(P, 23) }; e.imageDefHandle = s(P, 340); e.flags = f(P, 70);
        e.clippingBoundaryType = f(P, 71); e.clippingBoundaryPath = (P[14] || []).map((v, i) => ({ x: f(P, 14, i), y: f(P, 24, i) }));
        if (type === 'WIPEOUT' && e.clippingBoundaryPath.length === 2) { const [a, b] = e.clippingBoundaryPath; e.clippingBoundaryPath = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }]; }
        return e;
      }
      case 'HATCH': return finishHatch(e, P, seq);
      case 'MLINE': return finishMline(e, P, seq);
      default: { const g = proxyGraphics(seq); if (g) e.graphicsData = g; return e; }   // bilinmeyen sınıf: 92/310 önizleme grafiği varsa scene.proxy çizer
    }
  }

  /** 92 (ya da 160) boyutundan sonraki 310 parçaları: proxy önizleme grafiği (onaltılık); 93/161 sonrası varlık verisidir, alınmaz */
  function proxyGraphics(seq) {
    let on = false, hex = '';
    for (const [c, v] of seq) {
      if (c === 92 || c === 160) { on = true; continue; }
      if (c === 93 || c === 161 || c === 95 || c === 96) { if (on) break; continue; }
      if (on && c === 310) hex += v;
    }
    return hex || undefined;
  }

  /**
   * MULTILEADER: 300 CONTEXT_DATA{ … 302 LEADER{ … 304 LEADER_LINE{ 10/20 … 305 } 303 } 301 }. Bağlam içinde 304 varsayılan metin,
   * 40 içerik ölçeği, 41 yazı yüksekliği, 10 içerik tabanı, 12 yazı konumu, 42 yazı açısı, 140 ok boyu; kılavuzda 10 son nokta,
   * 11 dogleg yönü, 40 dogleg boyu. Bağlam dışında 41 dogleg, 42 ok boyu. Alan adları dönüştürücüyle (libredwg-web) aynı.
   * LibreDWG dwg2dxf yalnız 92/310 proxy grafiği yazar; o durumda graphicsData dolar.
   */
  function finishMleader(e, P, seq) {
    const secs = []; let st = 0, sec = null, line = null, tp = null;   // st: 0 varlık, 1 bağlam, 2 kılavuz, 3 kılavuz çizgisi
    const vec = (o, k, v, ax) => { if (!o[k]) o[k] = { x: 0, y: 0 }; o[k][ax] = parseFloat(v); };
    for (const [c, v] of seq) {
      if (c === 300) { st = 1; continue; }
      if (c === 301) { st = 0; continue; }
      if (c === 302) { sec = { leaderLines: [] }; secs.push(sec); st = 2; continue; }
      // kılavuz çizgisi başlangıcı 304 (ODA belgesi, LibreDWG) ya da 303 (bazı yazıcılar); kılavuz sonu öteki kod ile '}'
      if ((c === 303 || c === 304) && v === 'LEADER_LINE{') { line = { vertices: [] }; if (sec) sec.leaderLines.push(line); st = 3; continue; }
      if (c === 305) { line = null; st = 2; continue; }
      if ((c === 303 || c === 304) && v === '}' && st >= 2) { sec = null; line = null; st = 1; continue; }
      if (c === 304) { if (st === 1) e.textContent = unescapeText(v); continue; }
      if (st === 3 && line) { if (c === 10) line.vertices.push({ x: parseFloat(v), y: 0 }); else if (c === 20 && line.vertices.length) line.vertices[line.vertices.length - 1].y = parseFloat(v); }
      else if (st === 2 && sec) {
        if (c === 10) vec(sec, 'lastLeaderLinePoint', v, 'x'); else if (c === 20) vec(sec, 'lastLeaderLinePoint', v, 'y');
        else if (c === 11) vec(sec, 'doglegVector', v, 'x'); else if (c === 21) vec(sec, 'doglegVector', v, 'y');
        else if (c === 40) sec.doglegLength = parseFloat(v);
      } else if (st === 1) {
        if (c === 40) e.scale = parseFloat(v); else if (c === 41) e.textHeight = parseFloat(v); else if (c === 140) e.arrowheadSize = parseFloat(v);
        else if (c === 10) vec(e, 'contentBasePosition', v, 'x'); else if (c === 20) vec(e, 'contentBasePosition', v, 'y');
        else if (c === 12) vec(e, 'textAnchor', v, 'x'); else if (c === 22) vec(e, 'textAnchor', v, 'y');
        else if (c === 42) e.textRotation = parseFloat(v);
        else if (c === 296) tp = parseInt(v, 10) ? (e.blockContent = {}) : null;
        else if (tp && c === 341) tp.blockContentId = v; else if (tp && c === 15) vec(tp, 'position', v, 'x'); else if (tp && c === 25) vec(tp, 'position', v, 'y');
        else if (tp && c === 16) vec(tp, 'scale', v, 'x'); else if (tp && c === 26) vec(tp, 'scale', v, 'y'); else if (tp && c === 46) tp.rotation = parseFloat(v);
      } else if (st === 0) {
        if (c === 41) e.doglegLength = parseFloat(v); else if (c === 42 && !(e.arrowheadSize > 0)) e.arrowheadSize = parseFloat(v);
      }
    }
    if (secs.length) e.leaderSections = secs;
    if (!secs.length && !e.textContent) { const g = proxyGraphics(seq); if (g) e.graphicsData = g; }
    return e;
  }

  function finishHatch(e, P, seq) {
    e.patternName = s(P, 2); e.solidFill = f(P, 70); e.hatchStyle = f(P, 75); e.patternType = f(P, 76); e.boundaryPaths = [];
    let i = 0;
    const get = (c) => { while (i < seq.length && seq[i][0] !== c) i++; return i < seq.length ? parseFloat(seq[i++][1]) : 0; };
    const at = () => i < seq.length ? seq[i][0] : -1;
    // 91: yol sayısı
    while (i < seq.length && seq[i][0] !== 91) i++;
    const npaths = i < seq.length ? parseInt(seq[i++][1], 10) : 0;
    for (let p = 0; p < npaths; p++) {
      const flag = get(92);
      const path = { boundaryPathTypeFlag: flag };
      if (flag & 2) {
        path.hasBulge = get(72) === 1; path.isClosed = get(73) === 1;
        const n = get(93); path.vertices = [];
        for (let k = 0; k < n; k++) {
          const v = { x: get(10), y: get(20), bulge: 0 };
          if (path.hasBulge && at() === 42) v.bulge = get(42);
          path.vertices.push(v);
        }
      } else {
        const n = get(93); path.edges = [];
        for (let k = 0; k < n; k++) {
          const t = get(72);
          if (t === 1) path.edges.push({ type: 1, start: { x: get(10), y: get(20) }, end: { x: get(11), y: get(21) } });
          else if (t === 2) path.edges.push({ type: 2, center: { x: get(10), y: get(20) }, radius: get(40), startAngle: get(50) * D2R, endAngle: get(51) * D2R, isCCW: get(73) === 1 });
          else if (t === 3) path.edges.push({ type: 3, center: { x: get(10), y: get(20) }, end: { x: get(11), y: get(21) }, lengthOfMinorAxis: get(40), startAngle: get(50) * D2R, endAngle: get(51) * D2R, isCCW: get(73) === 1 });
          else if (t === 4) {
            const ed = { type: 4, degree: get(94), knots: [], controlPoints: [], fitDatum: [] };
            get(73); get(74);
            const nk = get(95), nc = get(96);
            for (let q = 0; q < nk; q++) ed.knots.push(get(40));
            for (let q = 0; q < nc; q++) { const cp = { x: get(10), y: get(20) }; if (at() === 42) cp.weight = get(42); ed.controlPoints.push(cp); }
            if (at() === 97) { const nf = get(97); for (let q = 0; q < nf; q++) ed.fitDatum.push({ x: get(11), y: get(21) }); }
            path.edges.push(ed);
          }
        }
      }
      // kaynak nesne sayısı ve 330 referansları
      if (at() === 97) { const ns = get(97); for (let q = 0; q < ns; q++) get(330); }
      e.boundaryPaths.push(path);
    }
    // desen: 52 açı, 41 ölçek, 78 tanım satırı sayısı; satır başına 53 açı, 43/44 taban, 45/46 offset, 79 parça sayısı, 49 parçalar
    // (dönüştürücüyle aynı adlar: patternAngle, patternScale, definitionLines[{angle, base, offset, dashLengths}]; açılar radyan)
    e.patternAngle = f(P, 52) * D2R; e.patternScale = f(P, 41, 0, 1); e.definitionLines = [];
    let dl = null;
    for (; i < seq.length; i++) {
      const [c, v] = seq[i];
      if (c === 53) { dl = { angle: parseFloat(v) * D2R, base: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, dashLengths: [] }; e.definitionLines.push(dl); }
      else if (dl && c === 43) dl.base.x = parseFloat(v); else if (dl && c === 44) dl.base.y = parseFloat(v);
      else if (dl && c === 45) dl.offset.x = parseFloat(v); else if (dl && c === 46) dl.offset.y = parseFloat(v);
      else if (dl && c === 49) dl.dashLengths.push(parseFloat(v));
      else if (c === 47 || c === 98) break;                     // piksel boyu / tohum noktaları: desen bitti
    }
    for (const d of e.definitionLines) d.numberOfDashLengths = d.dashLengths.length;
    e.numberOfDefinitionLines = e.definitionLines.length;
    return e;
  }

  function finishMline(e, P, seq) {
    e.scale = f(P, 40); e.justification = f(P, 70); e.flags = f(P, 71); e.numberOfLines = f(P, 73); e.startPoint = pt(P, 10);
    const vs = []; let cur = null, line = null;
    for (const [c, v] of seq) {
      if (c === 11) { cur = { vertex: { x: parseFloat(v), y: 0, z: 0 }, vertexDirection: { x: 0, y: 0 }, miterDirection: { x: 0, y: 0 }, lines: [] }; vs.push(cur); line = null; }
      else if (cur && c === 21) cur.vertex.y = parseFloat(v);
      else if (cur && c === 12) cur.vertexDirection.x = parseFloat(v);
      else if (cur && c === 22) cur.vertexDirection.y = parseFloat(v);
      else if (cur && c === 13) cur.miterDirection.x = parseFloat(v);
      else if (cur && c === 23) cur.miterDirection.y = parseFloat(v);
      else if (cur && c === 74) { line = { numberOfSegmentParams: parseInt(v, 10), segmentParams: [] }; cur.lines.push(line); }
      else if (line && c === 41) line.segmentParams.push(parseFloat(v));
    }
    e.vertices = vs; e.numberOfVertices = vs.length;
    return e;
  }

  /** Bir varlık dizisini (ENTITIES ya da BLOCK içi) okur; sonlandırıcı tipe kadar */
  function readEntities(stopTypes) {
    const out = [];
    let type = rd.value; // rd konumu: 0 kodlu satır okunmuş durumda
    while (type != null && !stopTypes.includes(type)) {
      const r = readEntity(type);
      const e = finishEntity(type, r);
      const nextType = rd.code === 0 ? rd.value : null;
      if (prog && (++progN % 2000) === 0) prog(rd.i / rd.lines.length);
      if (e._seq) { // POLYLINE: VERTEX … SEQEND
        delete e._seq;
        let t = nextType;
        while (t === 'VERTEX') {
          const vr = readEntity('VERTEX');
          const v = { x: f(vr.P, 10), y: f(vr.P, 20), z: f(vr.P, 30), bulge: f(vr.P, 42), flag: f(vr.P, 70), startWidth: f(vr.P, 40), endWidth: f(vr.P, 41),
            polyfaceIndex0: f(vr.P, 71), polyfaceIndex1: f(vr.P, 72), polyfaceIndex2: f(vr.P, 73), polyfaceIndex3: f(vr.P, 74), id: e.vertices.length };
          e.vertices.push(v);
          t = rd.code === 0 ? rd.value : null;
        }
        if (t === 'SEQEND') { readEntity('SEQEND'); t = rd.code === 0 ? rd.value : null; }
        type = t;
      } else if (e.type === 'INSERT' && e._attribsFollow) {
        delete e._attribsFollow;
        let t = nextType;
        while (t === 'ATTRIB') {
          const ar = readEntity('ATTRIB');
          e.attribs.push(finishEntity('ATTRIB', ar));
          t = rd.code === 0 ? rd.value : null;
        }
        if (t === 'SEQEND') { readEntity('SEQEND'); t = rd.code === 0 ? rd.value : null; }
        type = t;
      } else {
        if (e.type === 'INSERT') delete e._attribsFollow;
        type = nextType;
      }
      out.push(e);
    }
    return out;
  }

  // ---- bölümler ----------------------------------------------------------------------
  const brHandles = new Map(); // blok adı → BLOCK_RECORD tanıtıcısı
  while (rd.next()) {
    if (rd.code !== 0 || rd.value !== 'SECTION') continue;
    rd.next();
    const sec = rd.value;
    if (sec === 'HEADER') {
      let key = null;
      while (rd.next()) {
        if (rd.code === 0 && rd.value === 'ENDSEC') break;
        if (rd.code === 9) { key = rd.value.slice(1); continue; }
        if (!key) continue;
        const h = db.header;
        if (rd.code === 10 || rd.code === 20 || rd.code === 30) { h[key] = h[key] || { x: 0, y: 0, z: 0 }; h[key][rd.code === 10 ? 'x' : rd.code === 20 ? 'y' : 'z'] = rd.num(); }
        else if (rd.code === 1 || rd.code === 2 || rd.code === 3 || rd.code === 7 || rd.code === 8) h[key] = rd.value;
        else h[key] = rd.num();
      }
    } else if (sec === 'TABLES') {
      let table = null;
      while (rd.next()) {
        if (rd.code === 0 && rd.value === 'ENDSEC') break;
        if (rd.code === 0 && rd.value === 'TABLE') { rd.next(); table = rd.value; continue; }
        if (rd.code === 0 && rd.value === 'ENDTAB') { table = null; continue; }
        if (rd.code === 0 && table) {
          const r = readEntity(rd.value);
          const P = r.P;
          const name = s(P, 2);
          if (table === 'LAYER') {
            const ci = f(P, 62, 0, 7);
            // color: 420 gerçek renk (yoksa undefined; scene.layerColor 62'ye düşer), lineweight: DWG kodu (31 = varsayılan)
            db.tables.LAYER.entries.push({ name, handle: r.e.handle, colorIndex: Math.abs(ci) || 7, color: P[420] ? parseInt(P[420][0], 10) & 0xffffff : undefined, lineType: s(P, 6, 0, 'Continuous'),
              frozen: !!(f(P, 70) & 1), off: ci < 0, locked: !!(f(P, 70) & 4), lineweight: P[370] ? lwCode(parseInt(P[370][0], 10)) : 31, plotFlag: f(P, 290, 0, 1) });
          } else if (table === 'LTYPE') {
            db.tables.LTYPE.entries.push({ name, handle: r.e.handle, description: s(P, 3), totalPatternLength: f(P, 40), pattern: (P[49] || []).map(v => ({ elementLength: parseFloat(v) })) });
          } else if (table === 'STYLE') {
            db.tables.STYLE.entries.push({ name, handle: r.e.handle, font: s(P, 3), bigFont: s(P, 4), widthFactor: f(P, 41, 0, 1), obliqueAngle: f(P, 50) * D2R, fixedTextHeight: f(P, 40), lastHeight: f(P, 42) });
          } else if (table === 'DIMSTYLE') {
            db.tables.DIMSTYLE.entries.push({ name, handle: r.e.handle, DIMTXT: f(P, 140, 0, 2.5), DIMSCALE: f(P, 40, 0, 1), DIMASZ: f(P, 41, 0, 2.5),
              DIMEXO: f(P, 42, 0, 0.625), DIMEXE: f(P, 44, 0, 1.25), DIMTSZ: f(P, 142), DIMGAP: f(P, 147, 0, 0.625), DIMTAD: f(P, 77), DIMSE1: f(P, 75), DIMSE2: f(P, 76), DIMSD1: f(P, 281), DIMSD2: f(P, 282) });
          } else if (table === 'BLOCK_RECORD') {
            brHandles.set(name.toUpperCase(), r.e.handle);
          }
          // readEntity 0 kodunda durdu; döngü aynı satırı yeniden değerlendirsin
          rd.i -= 2;
        }
      }
    } else if (sec === 'BLOCKS') {
      while (rd.next()) {
        if (rd.code === 0 && rd.value === 'ENDSEC') break;
        if (rd.code === 0 && rd.value === 'BLOCK') {
          const r = readEntity('BLOCK');
          const P = r.P;
          const blk = { name: s(P, 2) || s(P, 3), handle: brHandles.get((s(P, 2) || '').toUpperCase()) || r.e.handle, flags: f(P, 70), basePoint: pt(P, 10), xrefPath: s(P, 1), layout: '', entities: [] };
          // rd 0 kodunda: ya ENDBLK ya bir varlık
          if (rd.code === 0 && rd.value !== 'ENDBLK') blk.entities = readEntities(['ENDBLK']);
          if (rd.code === 0 && rd.value === 'ENDBLK') readEntity('ENDBLK');
          blocks.push(blk);
          rd.i -= 2;
        }
      }
    } else if (sec === 'ENTITIES') {
      rd.next();
      if (rd.code === 0) db.entities = readEntities(['ENDSEC']);
    } else if (sec === 'OBJECTS') {
      while (rd.next()) {
        if (rd.code === 0 && rd.value === 'ENDSEC') break;
        if (rd.code === 0) {
          const t = rd.value;
          const r = readEntity(t);
          const P = r.P;
          if (t === 'LAYOUT') db.objects.LAYOUT.push({ handle: r.e.handle, layoutName: s(P, 1), tabOrder: f(P, 71), paperSpaceTableId: s(P, 330) });
          else if (t === 'IMAGEDEF') db.objects.IMAGEDEF.push({ handle: r.e.handle, fileName: s(P, 1), size: { x: f(P, 10), y: f(P, 20) } });
          else if (t === 'SORTENTSTABLE') {
            // Çizim sırası: 100 AcDbSortentsTable'dan sonra 330 sahip blok kaydı, 331 varlık tanıtıcıları, 5 sıra tanıtıcıları (aynı sırada eşleşir)
            let inTab = false, owner = ''; const ents = [], sorts = [];
            for (const [c, v] of r.seq) {
              if (c === 100) { inTab = v === 'AcDbSortentsTable'; continue; }
              if (!inTab) continue;
              if (c === 330 && !owner) owner = String(v).toUpperCase();
              else if (c === 331) ents.push(String(v).toUpperCase());
              else if (c === 5) sorts.push(parseInt(v, 16));
            }
            if (owner && ents.length) {
              const m = (db.sortents || (db.sortents = {}))[owner] || ((db.sortents[owner] = new Map()));
              for (let k = 0; k < ents.length && k < sorts.length; k++) if (isFinite(sorts[k])) m.set(ents[k], sorts[k]);
            }
          }
          rd.i -= 2;
        }
      }
    } else if (sec === 'ACDSDATA') {
      // R2013+: 3DSOLID/REGION/BODY'nin ASM (SAB) verisi: ACDSRECORD { 2 AcDbDs::ID, 320 varlık tanıtıcısı, 2 ASM_Data, 94 boy, 310 onaltılık… }
      let id = null, hex = '', asm = false;
      const flush = () => {
        if (id && asm && hex) { const n = hex.length >> 1; const u = new Uint8Array(n); for (let k = 0; k < n; k++) u[k] = parseInt(hex.substr(k * 2, 2), 16); (db.raw3d || (db.raw3d = {})); (db.raw3d[id] || (db.raw3d[id] = {})).acis = u; }
        id = null; hex = ''; asm = false;
      };
      while (rd.next()) {
        if (rd.code === 0 && rd.value === 'ENDSEC') break;
        if (rd.code === 0) { flush(); continue; }
        if (rd.code === 320) id = rd.value;                         // aynı yazıcının 5 kodundaki tanıtıcıyla birebir
        else if (rd.code === 2 && rd.value === 'ASM_Data') asm = true;
        else if (rd.code === 310 && asm) hex += rd.value;
      }
      flush();
    } else {
      while (rd.next()) if (rd.code === 0 && rd.value === 'ENDSEC') break;
    }
  }

  // ---- blok kayıtları ---------------------------------------------------------------------
  const byName = new Map();
  for (const b of blocks) byName.set(b.name.toUpperCase(), b);
  let ms = byName.get('*MODEL_SPACE');
  if (!ms) { ms = { name: '*Model_Space', handle: brHandles.get('*MODEL_SPACE') || 'MS', flags: 0, basePoint: { x: 0, y: 0, z: 0 }, layout: '', entities: [] }; blocks.unshift(ms); byName.set('*MODEL_SPACE', ms); }
  let ps = byName.get('*PAPER_SPACE');
  if (!ps) { ps = { name: '*Paper_Space', handle: brHandles.get('*PAPER_SPACE') || 'PS', flags: 0, basePoint: { x: 0, y: 0, z: 0 }, layout: '', entities: [] }; blocks.push(ps); byName.set('*PAPER_SPACE', ps); }
  for (const e of db.entities) {
    if (e.isInPaperSpace) { ps.entities.push(e); e.ownerBlockRecordSoftId = ps.handle; }
    else { ms.entities.push(e); e.ownerBlockRecordSoftId = ms.handle; }
  }
  for (const b of blocks) {
    if (/^\*(MODEL|PAPER)_SPACE/i.test(b.name)) {
      const lo = db.objects.LAYOUT.find(l => l.paperSpaceTableId === b.handle);
      b.layout = lo ? lo.handle : (/^\*MODEL_SPACE$/i.test(b.name) ? 'M' : b.name);
    }
  }
  db.tables.BLOCK_RECORD.entries = blocks.map(b => ({ name: b.name, handle: b.handle, flags: b.flags, basePoint: b.basePoint, layout: b.layout, entities: b.entities, xrefPath: b.xrefPath }));
  if (!db.tables.LTYPE.entries.length) db.tables.LTYPE.entries.push({ name: 'Continuous', pattern: [], totalPatternLength: 0 });
  return db;
}
