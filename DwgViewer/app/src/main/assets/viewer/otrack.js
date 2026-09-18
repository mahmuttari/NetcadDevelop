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
 *  - UZANTI YOLLARI (AutoCAD Extension / EXT yakalaması, v7.70): edinilen nokta bir doğru parçasının ucuysa
 *    o parçanın DOĞRULTUSU da yoldur — uçtan dışarı doğru (parçanın kendisi nesnedir, oraya yakalama bakar);
 *    bir yayın ucuysa yayın çemberi yoldur. Açılı bir çizginin uzantısı, iki uzantının kesişimi, uzantı ile
 *    çemberin kesişimi böyle bulunur. AutoCAD'de olduğu gibi yalnız EXT kipi açıkken (opt.ext).
 *  - ÖRTÜK UZANTI (v7.73, dokunmatik): aracın taban noktası (son alınan nokta) bir parçanın ucuysa o parçanın
 *    uzantısı EDİNME GEREKMEDEN yoldur — masaüstünde imleç ucun üstünde bekleyip edinir, dokunmatikte bekleme
 *    yoktur; "çizgiyi kendi doğrultusunda sürdür" dokunuşla da olsun diye. Böyle bir nokta extOnly: true ile
 *    listeye girer; yalnız uzantı (doğrultu / çember) yolları vardır, dik / kutupsal yolları yoktur — onlar
 *    kutupsal izlemenin işidir, taban noktadan geçen yatay / düşey yol edinilmeden çıkmaz.
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
export function toggle(list, p, kind, geo) {
  const src = Array.isArray(list) ? list : [];
  const key = keyOf(p);
  const i = src.findIndex(q => q.key === key);
  if (i >= 0) { const out = src.slice(); out.splice(i, 1); return { list: out, added: false }; }
  // geo: noktada biten doğru parçalarının DIŞA doğrultuları (derece) ve ucu olduğu yayların çemberleri — uzantı yolları
  const dirs = geo && Array.isArray(geo.dirs) ? geo.dirs.map(a => ((+a % 360) + 360) % 360).filter((a, k, arr) => arr.findIndex(b => Math.abs(b - a) < 1e-6) === k) : [];
  const arcs = geo && Array.isArray(geo.arcs) ? geo.arcs.filter(a => a && a.c && a.r > 0).map(a => ({ c: [+a.c[0], +a.c[1]], r: +a.r })) : [];
  const out = src.concat([{ key, p: [+p[0], +p[1]], kind: kind || 'end', dirs, arcs }]);
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
/** Doğru (A + t·d, t ≥ 0 yalnız ileri) ile çemberin kesişimleri; imlece en yakını döner */
function lineCircle(A, d, c, r, w) {
  const fx = A[0] - c[0], fy = A[1] - c[1];
  const b = 2 * (fx * d[0] + fy * d[1]), cc = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let best = null;
  for (const t of [(-b - sq) / 2, (-b + sq) / 2]) {
    if (t < -1e-9) continue;
    const X = [A[0] + d[0] * t, A[1] + d[1] * t], dw = Math.hypot(X[0] - w[0], X[1] - w[1]);
    if (!best || dw < best.dw) best = { X, dw };
  }
  return best;
}

/**
 * Hizalama. list: edinilmiş noktalar [{ key, p, kind, dirs, arcs }] · w: imleç (dünya) · tol: açıklık (dünya birimi)
 * · angs: izleme açıları (derece) · lock: { base, dir } ortho / kutupsal kilit (taban ve birim yön) ya da null
 * · opt: { ext } — EXT kipi açıkken edinilmiş noktanın uzantı yolları (doğrultu ve çember) da yoldur.
 *
 * → null (yol yakınında değil) ya da
 *   { p: [x, y], cross: bool, lock: bool, paths: [{ pt, kind, deg, dx, dy, dist, ext, arc }] }
 *   paths: imlecin oturduğu yol(lar): pt edinilmiş nokta, deg yolun açısı (çemberde null), dist noktadan sonuca
 *   uzaklık, ext uzantı yolu mu, arc { c, r } çember yoluysa.
 *
 * Kilit YOKKEN: en yakın yola dik izdüşüm (çemberde merkezden ışınsal izdüşüm); başka bir noktanın yolu da imlece
 * açıklık içinde yakınsa ve iki yol imlecin yakınında kesişiyorsa KESİŞİM (cross) — doğru × doğru ya da doğru × çember.
 * Aynı noktanın iki yolu birbirini noktanın kendisinde keser; o, yakalamanın işidir, burada alınmaz.
 * Kilit VARKEN: imleç kilit doğrusundadır; yalnız yolun kilit doğrusunu KESTİĞİ nokta imlecin kilitli
 * konumuna açıklık içinde yakınsa oraya oturulur; yoksa null (kısıt olduğu gibi kalır).
 */
export function align(list, w, tol, angs, lock, opt) {
  if (!Array.isArray(list) || !list.length || !(tol > 0) || !w) return null;
  const ext = !!(opt && opt.ext);
  const rad = (angs && angs.length ? angs : [0, 90, 180, 270]).map(a => ({ deg: a, th: a * Math.PI / 180 }));
  const paths = [], circs = [];
  for (const q of list) {
    const A = q.p, vx = w[0] - A[0], vy = w[1] - A[1];
    if (Math.hypot(vx, vy) < 1e-12) continue;   // imleç noktanın tam üstünde: yol seçilemez, yakalama zaten oradadır
    const dirs = ext && q.dirs && q.dirs.length ? q.dirs.map(a => ({ deg: a, th: a * Math.PI / 180, ext: true })) : [];
    for (const a of (q.extOnly ? dirs : rad.concat(dirs))) {   // örtük taban noktası: yalnız uzantı yolları
      const dx = temiz(Math.cos(a.th)), dy = temiz(Math.sin(a.th));
      const along = vx * dx + vy * dy;
      if (along < 0) continue;                    // noktanın gerisi: karşı açının önüdür, orada sayılır (uzantı yalnız dışa doğru)
      const perp = Math.abs(vx * dy - vy * dx);
      paths.push({ pt: A, kind: q.kind, deg: a.deg, dx, dy, along, perp, ext: !!a.ext });
    }
    if (ext && q.arcs) for (const c of q.arcs) circs.push({ pt: A, kind: q.kind, arc: c, perp: Math.abs(Math.hypot(w[0] - c.c[0], w[1] - c.c[1]) - c.r) });
  }
  if (!paths.length && !circs.length) return null;
  const mk = (p, X) => ({ pt: p.pt, kind: p.kind, deg: p.arc ? null : p.deg, dx: p.dx, dy: p.dy, dist: Math.hypot(X[0] - p.pt[0], X[1] - p.pt[1]), ext: !!p.ext || !!p.arc, arc: p.arc || null });
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
    for (const c of circs) {   // çember × kilit doğrusu
      const lc = lineCircle(B, [ux, uy], c.arc.c, c.arc.r, w); if (!lc) continue;
      const lc2 = lineCircle(B, [-ux, -uy], c.arc.c, c.arc.r, w);
      for (const h of [lc, lc2]) { if (!h) continue; const tX = (h.X[0] - B[0]) * ux + (h.X[1] - B[1]) * uy, d = Math.abs(tX - tL); if (d <= tol && (!best || d < best.d)) best = { d, X: h.X, p: c }; }
    }
    if (!best) return null;
    return { p: best.X, cross: true, lock: true, lockLine: { base: [B[0], B[1]], dir: [ux, uy] }, paths: [mk(best.p, best.X)] };
  }
  const near = paths.filter(p => p.perp <= tol).concat(circs.filter(c => c.perp <= tol)).sort((a, b) => a.perp - b.perp);
  if (!near.length) return null;
  const b0 = near[0];
  for (let k = 1; k < near.length; k++) {
    const c = near[k];
    if (c.pt === b0.pt || keyOf(c.pt) === keyOf(b0.pt)) continue;
    let X = null;
    if (!b0.arc && !c.arc) X = intersect(b0.pt, [b0.dx, b0.dy], c.pt, [c.dx, c.dy]);
    else if (!b0.arc || !c.arc) { const ln = b0.arc ? c : b0, ci = b0.arc ? b0 : c; const h = lineCircle(ln.pt, [ln.dx, ln.dy], ci.arc.c, ci.arc.r, w); X = h ? h.X : null; }
    if (!X) continue;   // çember × çember burada alınmaz
    if (Math.hypot(X[0] - w[0], X[1] - w[1]) <= tol * 1.5) return { p: X, cross: true, lock: false, paths: [mk(b0, X), mk(c, X)] };
  }
  if (b0.arc) {
    const cx = b0.arc.c[0], cy = b0.arc.c[1], dx = w[0] - cx, dy = w[1] - cy, L = Math.hypot(dx, dy) || 1;
    const P = [cx + dx / L * b0.arc.r, cy + dy / L * b0.arc.r];
    return { p: P, cross: false, lock: false, paths: [mk(b0, P)] };
  }
  const P = [b0.pt[0] + b0.dx * b0.along, b0.pt[1] + b0.dy * b0.along];
  return { p: P, cross: false, lock: false, paths: [mk(b0, P)] };
}
