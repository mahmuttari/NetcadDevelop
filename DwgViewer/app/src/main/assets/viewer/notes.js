/*
 * Notlar (redline): çizimin üstüne kalem, çizgi, ok, dikdörtgen, daire, yazı ve fotoğraf iğnesi.
 * DWG'ye dokunulmaz; notlar dosya anahtarına göre ayrı saklanır (notes:<fileKey>).
 */
import { S, toScreen, store } from './state.js';
import { segDist } from './geom.js';

export const notes = { items: [], key: '', dirty: false };

export function loadNotes(key) {
  notes.key = key;
  notes.items = store.json('notes:' + key, []) || [];
  notes.dirty = false;
}
export function saveNotes() {
  if (!notes.key) return;
  store.set('notes:' + notes.key, JSON.stringify(notes.items));
  notes.dirty = false;
}
export function addNote(n) { n.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); n.t = Date.now(); notes.items.push(n); saveNotes(); return n; }
export function removeNote(id) { notes.items = notes.items.filter(n => n.id !== id); saveNotes(); }

/** ekran noktasına en yakın not (piksel toleransı) */
export function hitNote(sx, sy, tolPx = 14) {
  let best = null, bd = tolPx;
  for (const n of notes.items) {
    const pts = (n.pts || []).map(p => toScreen(p[0], p[1]));
    let d = Infinity;
    if (n.type === 'text' || n.type === 'photo') d = Math.hypot(pts[0][0] - sx, pts[0][1] - sy);
    else if (n.type === 'circle') { const r = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]); d = Math.abs(Math.hypot(sx - pts[0][0], sy - pts[0][1]) - r); }
    else if (n.type === 'rect') {
      const x0 = Math.min(pts[0][0], pts[1][0]), x1 = Math.max(pts[0][0], pts[1][0]), y0 = Math.min(pts[0][1], pts[1][1]), y1 = Math.max(pts[0][1], pts[1][1]);
      d = Math.min(segDist(sx, sy, x0, y0, x1, y0), segDist(sx, sy, x1, y0, x1, y1), segDist(sx, sy, x1, y1, x0, y1), segDist(sx, sy, x0, y1, x0, y0));
    } else for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(sx, sy, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/**
 * Notları çizer. c: 2B bağlam (ekran pikseli, dpr uygulanmış); toS: dünya→ekran; scalePx: dünya→px ölçeği
 * selectedId: vurgulanacak not; draft: çizilmekte olan geçici not
 */
export function drawNotes(c, toS, scalePx, selectedId, draft, photos) {
  const all = draft ? [...notes.items, draft] : notes.items;
  for (const n of all) {
    const pts = (n.pts || []).map(p => toS(p[0], p[1]));
    if (!pts.length) continue;
    const col = n.color || '#ff3b30';
    const lw = (n.width || 2) * (n.worldWidth ? scalePx : 1);
    c.save();
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = Math.max(1.5, lw); c.lineCap = 'round'; c.lineJoin = 'round';
    if (n.id && n.id === selectedId) { c.shadowColor = '#f5b342'; c.shadowBlur = 10; }
    if (n.type === 'pen' || n.type === 'line') {
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    } else if (n.type === 'arrow' && pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 14;
      c.beginPath(); c.moveTo(b[0], b[1]);
      c.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
      c.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
      c.closePath(); c.fill();
    } else if (n.type === 'rect' && pts.length > 1) {
      c.strokeRect(Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.abs(pts[1][0] - pts[0][0]), Math.abs(pts[1][1] - pts[0][1]));
    } else if (n.type === 'circle' && pts.length > 1) {
      c.beginPath(); c.arc(pts[0][0], pts[0][1], Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), 0, Math.PI * 2); c.stroke();
    } else if (n.type === 'text') {
      c.font = 'bold 14px sans-serif';
      const w = c.measureText(n.text || '').width + 12;
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(pts[0][0] - 2, pts[0][1] - 20, w, 22);
      c.fillStyle = col; c.textBaseline = 'middle'; c.fillText(n.text || '', pts[0][0] + 4, pts[0][1] - 9);
      c.beginPath(); c.arc(pts[0][0], pts[0][1], 4, 0, Math.PI * 2); c.fill();
    } else if (n.type === 'photo') {
      const [x, y] = pts[0];
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 10, y - 20); c.arc(x, y - 22, 11, Math.PI * 0.85, Math.PI * 2.15); c.closePath(); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y - 22, 5, 0, Math.PI * 2); c.fill();
      const img = photos && photos.get(n.photo);
      if (img && img.ok) { const s = 48; c.drawImage(img.img, x + 12, y - 60, s, s * img.img.height / Math.max(1, img.img.width)); }
      if (n.text) { c.font = '12px sans-serif'; c.fillStyle = col; c.textBaseline = 'top'; c.fillText(n.text, x + 12, y - 8); }
    }
    c.restore();
  }
}
