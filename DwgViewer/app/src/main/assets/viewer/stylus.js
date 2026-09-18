/**
 * stylus.js — kalem desteği (Samsung S Pen, Apple Pencil, Wacom AES/EMR ve genel Android kalemleri)
 *
 * NE YAPAR
 *   Kalemi parmaktan ve fareden ayırır, silgi ucunu ve yan düğmeyi tanır, avuç reddine karar
 *   verir, basıncı değerlendirir ve eğimi okur.
 *
 * TASARIM KURALLARI
 *  - Bu modül SAF'tır: DOM'a, S durumuna ve çizim belgesine dokunmaz. Girdisi bir işaretçi
 *    olayı, çıktısı bir karardır; kararı uygulayan app.js'tir. Böylece sınanması kolaydır ve
 *    app.js şişmez (gizmo.js ile aynı sözleşme).
 *  - Hiçbir yerde cihaz adı ya da üretici denetimi YOKTUR. "Samsung ise şunu yap" biçiminde bir
 *    kural yazılmaz: İşaretçi Olayları (Pointer Events) standardı ne diyorsa o uygulanır, böylece
 *    adını bilmediğimiz kalemler de çalışır. Standart neyi garanti etmiyorsa (basınç, eğim,
 *    temas büyüklüğü) ÖLÇÜLEREK öğrenilir, varsayılmaz.
 *
 * STANDARDIN VERDİKLERİ
 *   ev.pointerType  'pen' | 'touch' | 'mouse'
 *   ev.pressure     0..1 — basınç bildirmeyen kalem temas ettiğinde SABİT 0,5 verir
 *   ev.tiltX/tiltY  −90..90 derece
 *   ev.width/height temas alanının CSS pikseli — çoğu Android cihazda 0 ya da 1'dir, güvenilmez
 *   ev.buttons      bit 1 = uç teması, bit 2 = yan (barrel) düğme, bit 32 = SİLGİ ucu
 *   ev.button       basış/bırakışta: 0 = uç, 2 = yan düğme, 5 = silgi
 */

/** Yan düğmeye atanabilecek görevler (editor.js ayar listesi buradan okur) */
export const BARREL_ACTIONS = ['menu', 'erase', 'snap', 'undo', 'none'];

/*
 * buttons alanı BIRAKIŞTA sıfırlanır; o yüzden bırakma olayında button alanına bakılır.
 * İkisi birlikte denetlenmezse silgiyle çizilen bir şey bırakışta sıradan kaleme dönerdi.
 */
export const eraserOf = (ev) => !!ev && (((ev.buttons | 0) & 32) !== 0 || ev.button === 5);
export const barrelOf = (ev) => !!ev && (((ev.buttons | 0) & 2) !== 0 || ev.button === 2);

/** İşaretçinin türü: 'eraser' | 'pen' | 'touch' | 'mouse' */
export function kindOf(ev) {
  if (!ev) return 'mouse';
  if (ev.pointerType === 'pen') return eraserOf(ev) ? 'eraser' : 'pen';
  if (ev.pointerType === 'touch') return 'touch';
  return 'mouse';
}

/** Eğim: { tx, ty, deg, dir } ya da null (cihaz eğim bildirmiyorsa) */
export function tiltOf(ev) {
  if (!ev || ev.pointerType !== 'pen') return null;
  const tx = ev.tiltX || 0, ty = ev.tiltY || 0;
  if (!tx && !ty) return null;
  return {
    tx, ty,
    deg: Math.min(90, Math.round(Math.hypot(tx, ty))),
    dir: Math.round(Math.atan2(ty, tx) * 180 / Math.PI),
  };
}

/**
 * AVUÇ REDDİ
 *
 * Kural, kalem uygulamalarında kendini kanıtlamış olanıdır: **kalem ekrana değdiği sürece
 * hiçbir dokunuş dinlenmez.** Elin kenarı kalemden önce de sonra da inebildiği için iki yön
 * de kapatılır — kalem inerken basılı duran dokunuşlar İPTAL EDİLİR, kalem kalktıktan sonra
 * kısa bir süre (hold) yeni dokunuş kabul edilmez.
 *
 * HAVADA GEZİNME BLOKLAMAZ. Kalem havadayken iki parmakla yakınlaştırmak yaygın ve meşru bir
 * harekettir; orada dokunuşu engellemek "uygulama takıldı" hissi verir. Yalnız TEMAS bloklar.
 *
 * Temas büyüklüğü (width/height) yalnız EK bir imdir: çoğu Android cihazda 0 ya da 1 gelir,
 * o yüzden yalnız anlamlı bir değer geldiğinde ve cihazda daha önce kalem görülmüşken sayılır.
 */
export class PalmGuard {
  constructor(opts = {}) {
    this.hold = opts.hold == null ? 700 : opts.hold;        // kalem kalktıktan sonraki sağır süre (ms)
    this.palmPx = opts.palmPx == null ? 40 : opts.palmPx;    // bu genişlikteki temas avuçtur
    this.enabled = opts.enabled !== false;
    this.reset();
  }
  reset() {
    this.pens = new Set();     // temas hâlindeki kalem işaretçileri
    this.blocked = new Set();  // elenmiş dokunuş işaretçileri
    this.penAt = -1e9;         // son kalem olayının zamanı
    this.seen = false;         // bu cihazda hiç kalem görüldü mü
    this.dropped = 0;          // ölçüm: kaç dokunuş elendi (durum çubuğunda gösterilir)
  }
  /**
   * Her işaretçi olayında çağrılır: kalem etkinliğini ve "bu cihazda kalem var" bilgisini kaydeder.
   * Sağır süreyi (penAt) YALNIZ TEMAS başlatır — havada gezinme değil. Havadayken de sağır kalsaydı
   * kalemi elinde tutan kullanıcı iki parmakla yakınlaştıramazdı; modülün sözleşmesi de bunu yasaklar.
   * contact verilmezse olaydan çıkarılır: kalem ucu basılıyken buttons > 0 gelir, gezinmede 0.
   */
  watch(ev, now, contact) {
    if (!ev || ev.pointerType !== 'pen') return false;
    this.seen = true;
    if (contact == null ? (ev.buttons > 0 || this.pens.has(ev.pointerId)) : !!contact) this.penAt = now;
    return true;
  }
  /**
   * pointerdown kararı.
   * touchIds: şu anda basılı duran DOKUNUŞ işaretçilerinin kimlikleri.
   * → { block, drop } · block: bu işaretçi tümden yok sayılsın · drop: iptal edilecek dokunuşlar
   */
  down(ev, now, touchIds) {
    this.watch(ev, now, ev.pointerType === 'pen');
    if (ev.pointerType === 'pen') {
      this.pens.add(ev.pointerId);
      if (!this.enabled) return { block: false, drop: [] };
      // Kalem indi: elin kenarı daha önce inmiş olabilir, o dokunuşlar iptal edilir.
      const drop = [...(touchIds || [])];
      for (const id of drop) this.blocked.add(id);
      return { block: false, drop };
    }
    if (ev.pointerType !== 'touch' || !this.enabled) return { block: false, drop: [] };
    const temas = this.pens.size > 0 || (now - this.penAt) < this.hold;
    const genis = this.seen && ev.width > this.palmPx && ev.height > this.palmPx;
    if (temas || genis) { this.blocked.add(ev.pointerId); this.dropped++; return { block: true, drop: [] }; }
    return { block: false, drop: [] };
  }
  /**
   * pointerup / pointercancel: kayıtları temizler, bu işaretçi elenmiş miydi onu döndürür.
   * Kalem kalkarken sağır süre TAM O ANDA başlar (now verilirse): elin kenarı kalemden sonra da iner.
   */
  up(ev, now) {
    if (ev && ev.pointerType === 'pen') { this.pens.delete(ev.pointerId); if (now != null) this.penAt = now; }
    else if (ev) this.pens.delete(ev.pointerId);
    return ev ? this.blocked.delete(ev.pointerId) : false;
  }
  isBlocked(id) { return this.blocked.has(id); }
  /** Kalem şu anda ekrana değiyor mu */
  penActive() { return this.pens.size > 0; }
}

/**
 * BASINÇ
 *
 * Basınç bildirmeyen kalem temas ettiği sürece SABİT 0,5 verir; bildirense sürekli değişen bir
 * değer verir. Hangisi olduğu cihaz adından anlaşılamaz, ÖLÇÜLEREK anlaşılır: değerin gerçekten
 * oynadığı görülene kadar "gerçek basınç var" denmez. Denseydi, basınçsız bir kalemde çizgi
 * kalınlığı sahte biçimde tek bir değere kilitlenirdi.
 */
export class Pressure {
  constructor(opts = {}) {
    this.esik = opts.esik == null ? 0.02 : opts.esik;   // gerçek sayılması için gereken oynama
    this.reset();
  }
  reset() { this.real = false; this.lo = 1; this.hi = 0; this.n = 0; this.last = 0; }
  /** Olayı besler, ham basıncı döndürür (kalem değilse 0) */
  feed(ev) {
    if (!ev || ev.pointerType !== 'pen') return 0;
    const p = typeof ev.pressure === 'number' && isFinite(ev.pressure) ? ev.pressure : 0;
    this.last = p;
    if (p > 0) {
      this.n++;
      if (p < this.lo) this.lo = p;
      if (p > this.hi) this.hi = p;
      if (this.hi - this.lo > this.esik) this.real = true;
    }
    return p;
  }
}

/**
 * Basınçtan çizgi kalınlığı. Gerçek basınç yoksa taban kalınlık olduğu gibi döner — bu, "basınç
 * açık ama cihaz desteklemiyor" durumunda çizginin incelip kalınlaşmamasını garanti eder.
 * Üs (gamma) 1'in altındadır: hafif dokunuşta bile çizgi görünür kalsın diye eğri yukarı bükülür.
 */
export function widthFor(base, p, opts = {}) {
  const lo = opts.lo == null ? 0.35 : opts.lo;
  const hi = opts.hi == null ? 1.8 : opts.hi;
  const g = opts.gamma == null ? 0.75 : opts.gamma;
  if (opts.real === false) return base;
  const q = Math.max(0, Math.min(1, typeof p === 'number' && isFinite(p) ? p : 0));
  return base * (lo + (hi - lo) * Math.pow(q, g));
}

/**
 * Basınçlı serbest çizgiyi değişken kalınlıkta çizer. Tek bir yol (path) kalınlığı boyunca
 * değişemediği için her parça ayrı çizilir; parça kalınlığı iki ucun ortalamasıdır, böylece
 * kalınlık sıçramaz. pr yoksa ya da basınç gerçek değilse tek yol çizilir (eski davranış).
 */
export function strokeVarying(c, pts, pr, base, opts = {}) {
  if (!pts || pts.length < 2) return false;
  if (!pr || pr.length !== pts.length || opts.real === false) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
    return false;
  }
  for (let i = 1; i < pts.length; i++) {
    c.lineWidth = Math.max(0.6, widthFor(base, (pr[i - 1] + pr[i]) / 2, opts));
    c.beginPath(); c.moveTo(pts[i - 1][0], pts[i - 1][1]); c.lineTo(pts[i][0], pts[i][1]); c.stroke();
  }
  return true;
}
