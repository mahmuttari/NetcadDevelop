/*
 * TANITIM KAPLAMASI — kayıt sırasında sayfaya enjekte edilen katman.
 *
 * Neden sayfanın İÇİNE: altyazı sonradan ffmpeg ile de basılabilirdi, ama o yol font dosyası
 * seçmeyi, Türkçe karakterleri, satır kırmayı ve zamanlamayı elle yönetmeyi gerektirir. Sayfaya
 * enjekte edilen katman tarayıcının kendi dizgisini kullanır ve kayda doğrudan girer.
 *
 * Neden CSS GEÇİŞİ YOK: kayıt kare karedir (ekran görüntüsü dizisi). Zamana bağlı bir geçiş,
 * kareler arasında geçen GERÇEK süreye göre ilerler ve videoda düzensiz görünür. Bu yüzden her
 * animasyonun ilerlemesini çekim betiği verir: opaklık, ölçek ve konum doğrudan yazılır.
 *
 * pointer-events: none — kaplama uygulamanın kendi dokunuşlarını yutmamalıdır.
 */
window.__promo = (function () {
  const eski = document.getElementById('promoLayer'); if (eski) eski.remove();
  const R = document.createElement('div');
  R.id = 'promoLayer';
  R.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
  R.innerHTML = `
    <style>
      #promoLayer * { box-sizing:border-box; }
      #promoLayer .alt { position:absolute; left:14px; right:14px;
        background:rgba(10,15,21,.9); color:#e6eaf0; border-left:5px solid #f5b342;
        border-radius:10px; padding:12px 16px; font-size:26px; line-height:1.24; font-weight:650;
        letter-spacing:-.01em; box-shadow:0 12px 34px rgba(0,0,0,.55); opacity:0; }
      #promoLayer .alt small { display:block; font-size:17px; font-weight:500; color:#9bb8d2; margin-top:3px; letter-spacing:0; }
      #promoLayer .kart { position:absolute; inset:0; background:#0d141d; color:#e6eaf0;
        display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px;
        padding:44px; text-align:center; opacity:0; }
      #promoLayer .kart .mark { font-size:46px; font-weight:800; letter-spacing:-.025em; line-height:1.1; }
      #promoLayer .kart .mark i { font-style:normal; color:#f5b342; }
      #promoLayer .kart .cizgi { width:84px; height:4px; border-radius:2px; background:#46cdf2; }
      #promoLayer .kart .alt1 { font-size:25px; line-height:1.38; color:#cbd6e2; font-weight:500; }
      #promoLayer .kart .kucuk { font-size:16px; color:#7e93a8; line-height:1.45; margin-top:6px; }
      #promoLayer .ring { position:absolute; border:4px solid #f5b342; border-radius:50%; opacity:0; }
      #promoLayer .dot { position:absolute; width:30px; height:30px; margin:-15px 0 0 -15px;
        background:rgba(245,179,66,.3); border:2px solid #f5b342; border-radius:50%; opacity:0; }
      #promoLayer .rozet { position:absolute; top:58px; left:14px;
        background:rgba(10,15,21,.86); border:1px solid #33455a; border-radius:999px; padding:6px 13px;
        font-size:16px; color:#cbd6e2; opacity:0; }
      #promoLayer .rozet b { color:#f5b342; font-weight:700; }
      #promoLayer .karart { position:absolute; inset:0; background:#000; opacity:0; }
    </style>
    <div class="kart" id="pKart"></div>
    <div class="alt" id="pAlt"></div>
    <div class="dot" id="pDot"></div>
    <div class="ring" id="pRing"></div>
    <div class="rozet" id="pRozet"></div>
    <div class="karart" id="pKarart"></div>
  `;
  document.documentElement.appendChild(R);
  const $ = (id) => R.querySelector('#' + id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  return {
    /** Altyazı metnini kurar (görünürlük ayrı verilir) */
    altMetin(tr, en, yer) {
      const el = $('pAlt');
      el.innerHTML = esc(tr) + (en ? '<small>' + esc(en) + '</small>' : '');
      if (yer === 'ust') { el.style.top = '86px'; el.style.bottom = 'auto'; }
      else { el.style.bottom = '118px'; el.style.top = 'auto'; }
    },
    /** 0..1 — betiğin verdiği ilerleme; kayma da opaklıkla birlikte yapılır */
    alt(p) { const el = $('pAlt'); el.style.opacity = String(p); el.style.transform = 'translateY(' + ((1 - p) * 12).toFixed(2) + 'px)'; },
    kartMetin(html) { $('pKart').innerHTML = html; },
    kart(p) { $('pKart').style.opacity = String(p); },
    rozetMetin(html) { $('pRozet').innerHTML = html; },
    rozet(p) { $('pRozet').style.opacity = String(p); },
    karart(p) { $('pKarart').style.opacity = String(p); },
    /** Dokunuş halkası: p 0..1 boyunca büyüyüp söner */
    halka(x, y, p) {
      const el = $('pRing');
      if (p == null) { el.style.opacity = '0'; return; }
      const r = 26 + 26 * p;
      el.style.width = el.style.height = (r * 2) + 'px';
      el.style.left = (x - r) + 'px'; el.style.top = (y - r) + 'px';
      el.style.opacity = String(Math.max(0, 1 - p) * 0.95);
    },
    nokta(x, y) { const el = $('pDot'); if (x == null) { el.style.opacity = '0'; return; } el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.opacity = '1'; },
  };
}());
