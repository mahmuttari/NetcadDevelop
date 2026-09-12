/* Harita altlığı: XYZ / WMS karolarını yükler, önbellekler ve çizim koordinatına yerleştirir. */
import { S, visibleRect } from './state.js';
import { lonLatToTile, tileToLonLat, zoomForResolution, BASEMAPS, toCrs, attrOf } from './proj.js';
import { fromPoints } from './geom.js';

const cache = new Map();   // url → { img, ok, err }
let pending = 0;
let onLoaded = null;
export function setTileCallback(fn) { onLoaded = fn; }

function tileUrl(bm, x, y, z) {
  if (bm.wms) {
    const n = 2 ** z, R = 20037508.342789244;
    const x0 = -R + x / n * 2 * R, x1 = -R + (x + 1) / n * 2 * R;
    const y1 = R - y / n * 2 * R, y0 = R - (y + 1) / n * 2 * R;
    const base = S.basemap.wms || '';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&STYLES=&BBOX=${x0},${y0},${x1},${y1}` + (base.toUpperCase().includes('LAYERS=') ? '' : '&LAYERS=0');
  }
  const url = bm.custom ? S.basemap.url : bm.url;
  return (url || '').replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{-y}', (2 ** z - 1 - y)).replace('{s}', 'abc'[(x + y) % 3]);
}

function load(url) {
  let c = cache.get(url);
  if (c) return c;
  c = { img: new Image(), ok: false, err: false };
  c.img.crossOrigin = 'anonymous';
  pending++;
  c.img.onload = () => { c.ok = true; pending--; if (onLoaded) onLoaded(); };
  c.img.onerror = () => { c.err = true; pending--; };
  c.img.src = url;
  cache.set(url, c);
  if (cache.size > 600) { const k = cache.keys().next().value; cache.delete(k); }
  return c;
}

/**
 * Görünür karoları çizer. ctx dünya dönüşümünde olmalı.
 * Yalnız model uzayında ve coğrafi referans tanımlıyken çalışır.
 */
export function drawBasemap(ctx) {
  const bm = BASEMAPS.find(b => b.id === S.basemap.id);
  if (!bm || bm.id === 'none' || !S.geo.active) return 0;
  if (bm.custom && !S.basemap.url) return 0;
  if (bm.wms && !S.basemap.wms) return 0;
  const vr = visibleRect();
  const c = S.geo.toLonLat((vr[0] + vr[2]) / 2, (vr[1] + vr[3]) / 2);
  if (!c || !isFinite(c[0]) || Math.abs(c[1]) > 85) return 0;
  const mPerPx = S.geo.unitToM / S.view.scale;
  const z = Math.min(bm.max || 19, zoomForResolution(mPerPx, c[1]));
  // köşeleri karo aralığına çevir
  const corners = [[vr[0], vr[1]], [vr[2], vr[1]], [vr[0], vr[3]], [vr[2], vr[3]]].map(p => S.geo.toLonLat(p[0], p[1])).filter(Boolean);
  if (corners.length < 4) return 0;
  const tx = corners.map(p => lonLatToTile(p[0], p[1], z));
  const x0 = Math.floor(Math.min(...tx.map(t => t[0]))), x1 = Math.floor(Math.max(...tx.map(t => t[0])));
  const y0 = Math.floor(Math.min(...tx.map(t => t[1]))), y1 = Math.floor(Math.max(...tx.map(t => t[1])));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return 0;
  ctx.save();
  ctx.globalAlpha = S.basemap.opacity;
  let drawn = 0;
  const n = 2 ** z;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= n) continue;
    const xx = ((x % n) + n) % n;
    const url = tileUrl(bm, xx, y, z);
    if (!url) continue;
    const c2 = load(url);
    if (!c2.ok) continue;
    const nw = tileToLonLat(x, y, z), ne = tileToLonLat(x + 1, y, z), sw = tileToLonLat(x, y + 1, z);
    const p0 = S.geo.toDrawing(nw[0], nw[1]), p1 = S.geo.toDrawing(ne[0], ne[1]), p2 = S.geo.toDrawing(sw[0], sw[1]);
    if (!p0 || !p1 || !p2) continue;
    const m = fromPoints(p0, p1, p2);
    ctx.save();
    ctx.transform(m[0] / 256, m[1] / 256, m[2] / 256, m[3] / 256, m[4], m[5]);
    ctx.drawImage(c2.img, 0, 0, 256, 256);
    ctx.restore();
    drawn++;
  }
  ctx.restore();
  return drawn;
}
export const tilesPending = () => pending;
export const basemapAttribution = () => { const bm = BASEMAPS.find(b => b.id === S.basemap.id); return bm ? attrOf(bm) : ''; };
export { toCrs };
