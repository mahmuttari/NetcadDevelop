/*
 * NESNE YAKALAMA İZLEME (AutoCAD object snap tracking, F11) — SAF hesap.
 *
 * NE İŞE YARAR
 *   Kullanıcı bir yakalama noktasının üstünde kısa bir süre bekleyince (ya da İz noktası / TT düğmesiyle
 *   dokununca) o nokta EDİNİLİR ve küçük bir artı (+) ile işaretlenir. İmleç edinilmiş noktalardan geçen
 *   yatay / düşey (kutupsal izleme açıkken açı adımlı) HİZALAMA YOLLARINA yaklaşınca yola oturur; iki
 *   yolun kesişimine yaklaşınca kesişime oturur. Ortho / kutupsal kilit açıkken imleç taban noktadan
 *   çıkan kilit doğrusunda kalır; yol o doğruyu kestiği yerde kesişim alınır (AutoCAD'de "bir uçla aynı
 *   hizada bitecek çizgi" işi tam böyle yapılır).
 *
 * TASARIM KURALLARI
 *  - Saf modül: DOM'a, S durumuna ve belgeye dokunmaz (desktop.js / gizmo.js sözleşmesi). Edinme,
 *    çizim ve dokunuş app.js'tedir; burası yalnız geometri ve listedir.
 *  - AutoCAD sayıları uydurulmaz: en çok 7 edinilmiş nokta (AutoCAD'in kendi sınırı), yollar 0 / 90 /
 *    180 / 270 (kutupsalda açı adımının katları — POLARMODE "bütün kutupsal açılarla izle").
 *  - Uzaklıklar DÜNYA biriminde alınır; açıklık (px) çağıran tarafından ölçeğe bölünüp verilir.
 */

/** AutoCAD: aynı anda en çok yedi edinilmiş nokta; sekizincisi en eskisini düşürür */
export const MAX_PTS = 7;
/** Gezinen imlecin bir yakalama noktasında edinme için beklemesi gereken süre (ms) */
export const DWELL_MS = 350;

/** Nokta anahtarı: aynı yakalama noktası iki kez edinilmez, yeniden bekleyince BIRAKILIR */
export function keyOf(p) { return (+p[0]).toFixed(6) + ',' + (+p[1]).toFixed(6); }

/**
 * İzleme açıları (derece). Kutupsal izleme kapalıyken yalnız dik eksenler; açıkken açı adımının
 * katları (0, adım, 2·adım … < 360). Adım geçersizse AutoCAD'in varsayılanı 15° alınır.
 */
export function angles(polar, step) {
  if (!polar) return [0, 90, 180, 270];
  const s = step > 0 && step <= 180 ? step : 15;
  const out = [];
  for (let a = 0; a < 360 - 1e-9; a += s) out.push(+a.toFixed(9));
  return out;
}

/**
 * Listeye ekler ya da (zaten varsa) çıkarır — AutoCAD'de edinilmiş noktanın üstünde yeniden beklemek
 * onu bırakır. Sınır aşılırsa en eski düşer. → { list, added }
 */
export function toggle(list, p, kind) {
  const src = Array.isArray(list) ? list : [];
  const key = keyOf(p);
  const i = src.findIndex(q => q.key === key);
  if (i >= 0) { const out = src.slice(); out.splice(i, 1); return { list: out, added: false }; }
  const out = src.concat([{ key, p: [+p[0], +p[1]], kind: kind || 'end' }]);
  while (out.length > MAX_PTS) out.shift();
  return { list: out, added: true };
}

/** cos / sin'in 90° katlarındaki 1e-16'lık artıkları atar: dik yolların izdüşümü ve sırası tam sayı kalsın */
function temiz(v) { return Math.abs(v) < 1e-12 ? 0 : Math.abs(v - 1) < 1e-12 ? 1 : Math.abs(v + 1) < 1e-12 ? -1 : v; }
/** İki doğrunun kesişimi: A + t·d ve B + s·u; paralelse null */
function intersect(A, d, B, u) {
  const den = d[0] * u[1] - d[1] * u[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((B[0] - A[0]) * u[1] - (B[1] - A[1]) * u[0]) / den;
  return [A[0] + d[0] * t, A[1] + d[1] * t];
}

/**
 * Hizalama. list: edinilmiş noktalar [{ key, p, kind }] · w: imleç (dünya) · tol: açıklık (dünya birimi)
 * · angs: izleme açıları (derece) · lock: { base, dir } ortho / kutupsal kilit (taban ve birim yön) ya da null.
 *
 * → null (yol yakınında değil) ya da
 *   { p: [x, y], cross: bool, lock: bool, paths: [{ pt, kind, deg, dx, dy, dist }] }
 *   paths: imlecin oturduğu yol(lar): pt edinilmiş nokta, deg yolun açısı, dist noktadan sonuca uzaklık.
 *
 * Kilit YOKKEN: en yakın yola dik izdüşüm; başka bir noktanın yolu da imlece açıklık içinde yakınsa ve iki
 * yol imlecin yakınında kesişiyorsa KESİŞİM (cross). Aynı noktanın iki yolu birbirini noktanın kendisinde
 * keser; o, yakalamanın işidir, burada alınmaz.
 * Kilit VARKEN: imleç kilit doğrusundadır; yalnız yolun kilit doğrusunu KESTİĞİ nokta imlecin kilitli
 * konumuna açıklık içinde yakınsa oraya oturulur; yoksa null (kısıt olduğu gibi kalır).
 */
export function align(list, w, tol, angs, lock) {
  if (!Array.isArray(list) || !list.length || !(tol > 0) || !w) return null;
  const rad = (angs && angs.length ? angs : [0, 90, 180, 270]).map(a => ({ deg: a, th: a * Math.PI / 180 }));
  const paths = [];
  for (const q of list) {
    const A = q.p, vx = w[0] - A[0], vy = w[1] - A[1];
    if (Math.hypot(vx, vy) < 1e-12) continue;   // imleç noktanın tam üstünde: yol seçilemez, yakalama zaten oradadır
    for (const a of rad) {
      const dx = temiz(Math.cos(a.th)), dy = temiz(Math.sin(a.th));
      const along = vx * dx + vy * dy;
      if (along < 0) continue;                    // noktanın gerisi: karşı açının önüdür, orada sayılır
      const perp = Math.abs(vx * dy - vy * dx);
      paths.push({ pt: A, kind: q.kind, deg: a.deg, dx, dy, along, perp });
    }
  }
  if (!paths.length) return null;
  if (lock && lock.base && lock.dir) {
    const B = lock.base, ux = lock.dir[0], uy = lock.dir[1];
    const tL = (w[0] - B[0]) * ux + (w[1] - B[1]) * uy;   // imlecin kilit doğrusundaki konumu
    let best = null;
    for (const p of paths) {
      const X = intersect(p.pt, [p.dx, p.dy], B, [ux, uy]);
      if (!X) continue;
      const tX = (X[0] - B[0]) * ux + (X[1] - B[1]) * uy;
      const d = Math.abs(tX - tL);
      // kesişim yolun İLERİ yönünde olmalı (edinilmiş noktadan imlece doğru), gerisinde değil
      const ahead = (X[0] - p.pt[0]) * p.dx + (X[1] - p.pt[1]) * p.dy;
      if (d <= tol && ahead >= -tol && (!best || d < best.d)) best = { d, X, p };
    }
    if (!best) return null;
    const bp = best.p;
    return { p: best.X, cross: true, lock: true, lockLine: { base: [B[0], B[1]], dir: [ux, uy] }, paths: [{ pt: bp.pt, kind: bp.kind, deg: bp.deg, dx: bp.dx, dy: bp.dy, dist: Math.hypot(best.X[0] - bp.pt[0], best.X[1] - bp.pt[1]) }] };
  }
  const near = paths.filter(p => p.perp <= tol).sort((a, b) => a.perp - b.perp);
  if (!near.length) return null;
  const b0 = near[0];
  for (let k = 1; k < near.length; k++) {
    const c = near[k];
    if (c.pt === b0.pt || keyOf(c.pt) === keyOf(b0.pt)) continue;
    const X = intersect(b0.pt, [b0.dx, b0.dy], c.pt, [c.dx, c.dy]);
    if (!X) continue;
    if (Math.hypot(X[0] - w[0], X[1] - w[1]) <= tol * 1.5) {
      const mk = (p) => ({ pt: p.pt, kind: p.kind, deg: p.deg, dx: p.dx, dy: p.dy, dist: Math.hypot(X[0] - p.pt[0], X[1] - p.pt[1]) });
      return { p: X, cross: true, lock: false, paths: [mk(b0), mk(c)] };
    }
  }
  const P = [b0.pt[0] + b0.dx * b0.along, b0.pt[1] + b0.dy * b0.along];
  return { p: P, cross: false, lock: false, paths: [{ pt: b0.pt, kind: b0.kind, deg: b0.deg, dx: b0.dx, dy: b0.dy, dist: b0.along }] };
}
