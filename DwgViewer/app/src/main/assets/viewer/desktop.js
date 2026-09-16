/**
 * desktop.js — klavye ve fare bağlıyken masaüstü CAD davranışı
 *
 * NE İŞE YARAR
 *   Tablete ya da DeX'e klavye-fare bağlandığında uygulama bir masaüstü CAD istasyonu gibi
 *   kullanılabilmeli: orta tuş kaydırır, sağ tuş Enter'dır, harfler doğrudan komut satırına
 *   gider, F8 ortho açar. Bu modül o davranışın SAF parçasını taşır: cihaz sezimi, tuş
 *   çözümü ve açı kısıtları. Olayları bağlayan ve ekranı çizen app.js ile editor.js'tir.
 *
 * TASARIM KURALLARI
 *  - Saf modül: DOM'a, S durumuna ve belgeye dokunmaz (gizmo.js / stylus.js ile aynı sözleşme).
 *  - Tuş atamaları AutoCAD'in kendi atamalarıdır, uydurulmaz. AutoCAD'de karşılığı olmayan
 *    işlev kısayolu boş bırakılır; "benzer bir şey" atanmaz, çünkü kullanıcı F9'a basıp
 *    beklemediği bir şeyin olmasını, hiçbir şey olmamasından daha bozuk bulur.
 *  - Cihaz TAHMİN EDİLMEZ, ÖLÇÜLÜR. Ortam sorgusu yalnız ilk tahmindir; kesin bilgi gerçek
 *    fare olayının gelmesidir (kalem desteğindeki ile aynı gerekçe).
 */

/** Ortam sorgusu ile ilk tahmin: ince işaretçi (fare / touchpad) var mı */
export function likelyMouse(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || typeof w.matchMedia !== 'function') return false;
  try { return w.matchMedia('(any-pointer: fine)').matches && w.matchMedia('(any-hover: hover)').matches; }
  catch (_) { return false; }
}

/*
 * FARE TUŞLARI — AutoCAD düzeni
 *   sol (0)   → seçim / nokta
 *   orta (1)  → KAYDIR; çift tıklama sınırlara oturtur
 *   sağ (2)   → Enter (son komutu yinele) ya da bağlam menüsü, ayara göre
 */
export const BTN_LEFT = 0, BTN_MIDDLE = 1, BTN_RIGHT = 2;
export const RIGHT_ACTIONS = ['enter', 'menu', 'none'];

/*
 * İŞLEV TUŞLARI — AutoCAD'in kendi atamaları.
 * Karşılığı OLMAYANLAR bilerek yoktur: F4 (3B yakalama), F5 (izometrik düzlem), F6 (dinamik
 * UCS), F9 (ızgara adımı), F12 (dinamik giriş) bu uygulamada karşılıksız.
 */
export const FKEYS = {
  F1: { act: 'cmdhelp' },     // yardım → komut listesi
  F3: { act: 'osnap' },       // nesne yakalama
  F7: { act: 'grid' },        // ızgara
  F8: { special: 'ortho' },   // ortho kipi
  F10: { special: 'polar' },  // kutupsal izleme
  F11: { act: 'otrack' },     // nesne yakalama izi (son yakalanan noktayla yatay / düşey hiza)
};

/*
 * KISAYOL TUŞLARI (Ctrl / Cmd). AutoCAD ile aynı olanlar alınmıştır; Ctrl+0 AutoCAD'de
 * "temiz ekran"dır, bizde şeridi katlar — aynı amaca hizmet eder.
 */
export const CTRL = {
  z: { act: 'undo' }, y: { act: 'redo' },
  c: { act: 'copyclip' }, v: { act: 'pasteclip' },
  s: { act: 'savedxf' }, p: { act: 'pdf' },
  '0': { act: 'collapse' },
};

/**
 * Tuş olayını çözer. → { act } | { special } | null
 * opts.cmdLine: komut satırı açık mı (açıksa harfler komuta gider, kısayola değil)
 */
export function resolveKey(ev, opts = {}) {
  if (!ev || typeof ev.key !== 'string') return null;
  const k = ev.key;
  if (FKEYS[k]) return { ...FKEYS[k], key: k };
  if (ev.ctrlKey || ev.metaKey) {
    const c = CTRL[k.toLowerCase()];
    // Shift+Ctrl+Z AutoCAD'de de yinelemedir
    if (k.toLowerCase() === 'z' && ev.shiftKey) return { act: 'redo', key: k };
    return c ? { ...c, key: k } : null;
  }
  return null;
}

/**
 * Yazılan tuş komut satırına mı gitmeli? AutoCAD'de kullanıcı çizim alanına odaklıyken
 * harf yazdığında metin doğrudan komut satırına düşer — ayrı bir yere tıklamak gerekmez.
 * Değiştirici tuşlu birleşimler ve gezinme tuşları dışarıda kalır.
 */
export function isCommandChar(ev) {
  if (!ev || typeof ev.key !== 'string') return false;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  return ev.key.length === 1 && /[A-Za-z0-9\-_.]/.test(ev.key);
}

/**
 * ORTHO — noktayı taban noktasına göre yatay ya da düşeye kilitler (AutoCAD F8).
 * Hangi eksene kilitleneceği daha BÜYÜK bileşene göre seçilir; kullanıcı imleci hangi yöne
 * daha çok götürdüyse o eksen kazanır.
 */
export function orthoPoint(base, p) {
  if (!base || !p) return p;
  const dx = p[0] - base[0], dy = p[1] - base[1];
  return Math.abs(dx) >= Math.abs(dy) ? [p[0], base[1], p[2]] : [base[0], p[1], p[2]];
}

/**
 * KUTUPSAL İZLEME — noktayı taban noktası etrafında açı adımına oturtur (AutoCAD F10).
 * Uzaklık korunur, yalnız açı yuvarlanır; böylece kullanıcının verdiği boy bozulmaz.
 */
export function polarPoint(base, p, stepDeg = 15) {
  if (!base || !p) return p;
  const dx = p[0] - base[0], dy = p[1] - base[1];
  const r = Math.hypot(dx, dy);
  if (r < 1e-12) return p;
  const step = (stepDeg > 0 ? stepDeg : 15) * Math.PI / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return [base[0] + r * Math.cos(a), base[1] + r * Math.sin(a), p[2]];
}

/**
 * Kısıtı uygular. Öncelik AutoCAD'deki gibidir: YAKALAMA her şeyi yener (kullanıcı belirli
 * bir noktaya oturmak istemiştir), sonra ortho, sonra kutupsal. İkisi birden açıksa ortho
 * kazanır — AutoCAD'de de öyledir.
 */
export function constrain(base, p, opt = {}) {
  if (!base || !p || opt.snapped) return p;
  if (opt.ortho) return orthoPoint(base, p);
  if (opt.polar) return polarPoint(base, p, opt.polarStep);
  return p;
}
