/*
 * PROJEKSİYON (DİLİM) SEÇİCİ — bir YERDEN doğru koordinat sistemine.
 *
 * Türkiye'de büyük ölçekli harita ve altyapı projeleri iki datum ve iki dilim genişliğiyle
 * çalışır: ITRF96 (TUREF, GRS80) ve ED50 (Hayford/Uluslararası 1924); 3 derecelik dilimler
 * (orta meridyen 27°…45°, ölçek katsayısı 1) ve 6 derecelik UTM dilimleri (35N…38N, ölçek
 * katsayısı 0,9996). Kullanıcının bildiği şey çoğu zaman datum değil YERDİR: "Kocaeli, Gebze".
 * Bu modül yerden dilime giden yolu kurar — dilim numarasını, orta meridyeni ve EPSG kodunu
 * kullanıcı hesaplamaz, seçtiği yerden çıkar.
 *
 * Konum beş yoldan gelir: il/ilçe dizini (çevrim dışı çalışır), harita üzerinde nokta, adres
 * araması (Nominatim, çevrim içi), elle enlem-boylam, ve AÇIK ÇİZİMİN KENDİ KOORDİNATLARI.
 * Sonuncusu en çok işe yarayanıdır: elindeki paftanın hangi dilimde olduğunu bilmeyen kullanıcı
 * için koordinatın kendisi zaten cevabı taşır (bkz. proj.crsTahmin).
 *
 * DİLİM SINIRI BİR KARARDIR, ÖLÇÜ DEĞİL. 3° dilim sınırı orta meridyenden 1,5° (~125 km),
 * 6° dilim sınırı 3° uzaktadır. Çalışma alanı sınıra yakınsa alanın bir ucu öbür dilime
 * düşebilir; bu durumda doğru dilim projenin kararıdır (idare hangi dilimde istiyorsa).
 * Bu yüzden sınıra kalan pay her zaman metre cinsinden yazılır ve yakınsa uyarılır.
 *
 * Dışa açılan tek işlev:
 *   acProjSecici(host)   host = { openDoc(baslik, html), geri(), uygula(crsId), toast(msg, o),
 *                                 esc(s), fmt(n, p), lonLat0?: [lon, lat], ext?: [x0,y0,x1,y1],
 *                                 karoUrl?: (x, y, z) => string }
 */
import { t } from './i18n.js';
import { CRS, crsOner, crsTahmin, dilim3, dilim6, lonLatToTile, tileToLonLat, inTR } from './proj.js';
import { IL, ILCE, ara as idariAra } from './tr_idari.js';

const $ = (id) => document.getElementById(id);
const tt = (k, tr) => { const v = t(k); return v === k ? tr : v; };
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** metreyi okunur yazar: 850 m / 12,4 km */
function mesafe(m) {
  const a = Math.abs(m);
  if (a < 1000) return Math.round(a) + ' m';
  return (a / 1000).toFixed(a < 10000 ? 1 : 0).replace('.', ',') + ' km';
}
/** "40.7654, 29.9187" · "40°45'55\"N 29°55'07\"E" · "29.9187 40.7654" → [lon, lat] | null */
export function koordCoz(s) {
  const txt = String(s || '').trim();
  if (!txt) return null;
  const dms = [...txt.matchAll(/(-?\d+(?:[.,]\d+)?)\s*[°d]\s*(?:(\d+(?:[.,]\d+)?)\s*['′m]\s*)?(?:(\d+(?:[.,]\d+)?)\s*["″s]?\s*)?([NSEWKGDB])?/gi)];
  const say = (m) => {
    const d = parseFloat(String(m[1]).replace(',', '.')), dk = m[2] ? parseFloat(String(m[2]).replace(',', '.')) : 0, sn = m[3] ? parseFloat(String(m[3]).replace(',', '.')) : 0;
    let v = Math.abs(d) + dk / 60 + sn / 3600;
    if (d < 0 || /[SWGB]/i.test(m[4] || '')) v = -v;
    return { v, yon: (m[4] || '').toUpperCase() };
  };
  if (dms.length >= 2) {
    const a = say(dms[0]), b = say(dms[1]);
    const enlem = /[NSK G]/.test(a.yon) && !/[EWD]/.test(a.yon) ? a : (/[NSK]/.test(b.yon) ? b : a);
    const boylam = enlem === a ? b : a;
    if (isFinite(enlem.v) && isFinite(boylam.v)) return [boylam.v, enlem.v];
  }
  const say2 = txt.replace(/[;]/g, ',').match(/-?\d+(?:[.,]\d+)?/g);
  if (!say2 || say2.length < 2) return null;
  const n = say2.slice(0, 2).map(x => parseFloat(x.replace(',', '.')));
  if (!n.every(isFinite)) return null;
  // İkisi de enlem aralığındaysa sıra "enlem, boylam"dır (yaygın yazım); değilse büyük olan boylamdır
  const [a, b] = n;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && Math.abs(b) > 90) return [b, a];
  if (Math.abs(a) <= 90 && Math.abs(b) <= 90) return [b, a];
  if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return [a, b];
  return null;
}

/** Konum → altı CRS önerisi; kutunun alt yarısını kuran HTML */
function sonucHtml(lon, lat, yer) {
  const o = crsOner(lon, lat);
  const kart = (c, etiket) => {
    const epsg = (/EPSG:(\d+)/.exec(c.name) || [])[1] || '';
    const fe = c.fe >= 1e6 ? (c.fe / 1e6 | 0) + '.' + String(c.fe % 1e6).padStart(6, '0') : String(c.fe);
    return `<button type="button" class="ps-card" data-crs="${esc(c.id)}">
      <b>${esc(etiket)}</b>
      <small>OM ${c.lon0}° · ${tt('psScale', 'ölçek katsayısı')} ${c.k0} · ${tt('psFalseE', 'sağa değer')} ${fe}</small>
      <em>EPSG:${esc(epsg)}</em></button>`;
  };
  const ad = (i) => o.liste[i] ? o.liste[i] : null;
  const etiketler = [
    `ITRF96 / TM${o.d3.om} (3°)`, `ITRF96 / ${o.d3.dilim}. dilim (3°)`, `ITRF96 / UTM ${o.d6.dilim}N (6°)`,
    `ED50 / TM${o.d3.om} (3°)`, `ED50 / ${o.d3.dilim}. dilim (3°)`, `ED50 / UTM ${o.d6.dilim}N (6°)`];
  const kartlar = o.liste.map((c, i) => kart(c, etiketler[i])).join('');
  const yakin3 = o.pay3.metre < 15000, yakin6 = o.pay6.metre < 15000;
  const uyari = [];
  if (!o.turkiye) uyari.push(tt('psOutside', 'Seçilen nokta Türkiye sınırlarının dışında; dilim önerisi Türkiye dilimleriyle sınırlıdır.'));
  if (yakin3 || yakin6) uyari.push(tt('psEdgeWarn', 'Çalışma alanı dilim sınırına yakın (%s). Alanın tamamı tek dilimde kalmıyorsa dilimi proje kararına göre seçin.')
    .replace('%s', (yakin3 ? '3°: ' + mesafe(o.pay3.metre) : '') + (yakin3 && yakin6 ? ' · ' : '') + (yakin6 ? '6°: ' + mesafe(o.pay6.metre) : '')));
  return `<div class="ps-yer">${yer ? `<b>${esc(yer)}</b><br>` : ''}
      ${lat.toFixed(5)}° K · ${lon.toFixed(5)}° D</div>
    <div class="ps-dilim">
      <span>${tt('psZone3', '3° dilim')}: <b>${o.d3.dilim}</b> (${tt('psCM', 'orta meridyen')} ${o.d3.om}°) · ${tt('psEdge', 'Dilim sınırına uzaklık')} ${mesafe(o.pay3.metre)}</span>
      <span>${tt('psZone6', '6° dilim (UTM)')}: <b>${o.d6.dilim}N</b> (${tt('psCM', 'orta meridyen')} ${o.d6.om}°) · ${tt('psEdge', 'Dilim sınırına uzaklık')} ${mesafe(o.pay6.metre)}</span>
    </div>
    ${uyari.map(u => `<div class="ps-uyari">${esc(u)}</div>`).join('')}
    <div class="ps-kartlar">${kartlar}</div>
    <div class="muted small">${esc(tt('psDatumNote', 'Datum koordinattan anlaşılmaz: ED50 ile ITRF96 aynı dilimde birkaç yüz metre ayrılır. Doğru datumu projenin kendi belgesinden alın.'))}</div>`;
}

/** Küçük karo haritası: sürükle, yakınlaştır; ortadaki artı seçilen noktadır */
function harita(cv, bas, karoUrl) {
  const durum = { lon: bas[0], lat: bas[1], z: 11 };
  const onbellek = new Map();
  let raf = 0;
  const ciz = () => {
    raf = 0;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (w > 0 && h > 0 && (cv.width !== w || cv.height !== h)) { cv.width = w; cv.height = h; }
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#8ea3b8'; c.fillRect(0, 0, cv.width, cv.height);
    const [tx, ty] = lonLatToTile(durum.lon, durum.lat, durum.z);
    const ts = 256 * dpr;
    const x0 = Math.floor(tx - cv.width / 2 / ts), x1 = Math.floor(tx + cv.width / 2 / ts);
    const y0 = Math.floor(ty - cv.height / 2 / ts), y1 = Math.floor(ty + cv.height / 2 / ts);
    const n = 2 ** durum.z;
    for (let X = x0; X <= x1; X++) for (let Y = y0; Y <= y1; Y++) {
      if (Y < 0 || Y >= n) continue;
      const XX = ((X % n) + n) % n;
      const url = karoUrl(XX, Y, durum.z);
      let im = onbellek.get(url);
      if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => iste(); im.onerror = () => { im.bozuk = true; }; im.src = url; onbellek.set(url, im); }
      if (im.complete && im.naturalWidth) c.drawImage(im, Math.round(cv.width / 2 + (X - tx) * ts), Math.round(cv.height / 2 + (Y - ty) * ts), ts, ts);
    }
    // nişan
    const mx = cv.width / 2, my = cv.height / 2, r = 11 * dpr;
    c.strokeStyle = '#ff3b30'; c.lineWidth = 2 * dpr;
    c.beginPath(); c.arc(mx, my, r, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(mx - r * 1.8, my); c.lineTo(mx + r * 1.8, my); c.moveTo(mx, my - r * 1.8); c.lineTo(mx, my + r * 1.8); c.stroke();
    if (onbellek.size > 400) { const k = onbellek.keys().next().value; onbellek.delete(k); }
  };
  const iste = () => { if (!raf) raf = requestAnimationFrame(ciz); };
  let sur = null;
  cv.addEventListener('pointerdown', (ev) => { try { cv.setPointerCapture(ev.pointerId); } catch (_) { /* yakalama yok */ } sur = { x: ev.clientX, y: ev.clientY, lon: durum.lon, lat: durum.lat }; });
  cv.addEventListener('pointermove', (ev) => {
    if (!sur) return;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const [tx, ty] = lonLatToTile(sur.lon, sur.lat, durum.z);
    const p = tileToLonLat(tx - (ev.clientX - sur.x) * dpr / (256 * dpr), ty - (ev.clientY - sur.y) * dpr / (256 * dpr), durum.z);
    durum.lon = p[0]; durum.lat = Math.max(-85, Math.min(85, p[1]));
    iste(); if (durum.onMove) durum.onMove(durum.lon, durum.lat);
  });
  const birak = () => { sur = null; };
  cv.addEventListener('pointerup', birak); cv.addEventListener('pointercancel', birak);
  durum.yakin = (d) => { durum.z = Math.max(3, Math.min(18, durum.z + d)); iste(); };
  durum.git = (lon, lat, z) => { durum.lon = lon; durum.lat = lat; if (z) durum.z = z; iste(); if (durum.onMove) durum.onMove(lon, lat); };
  durum.ciz = iste;
  iste();
  return durum;
}

export function acProjSecici(host) {
  const H = host || {};
  const karoUrl = H.karoUrl || ((x, y, z) => OSM.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  let lon = null, lat = null, yer = '';
  let hrt = null, sekme = 'il';

  const seg = (id, ad) => `<button type="button" class="seg-b${sekme === id ? ' on' : ''}" data-ps="${id}">${esc(ad)}</button>`;
  const html = () => `<div class="ps">
    <div class="seg ps-seg">
      ${seg('il', tt('psProvince', 'İl / ilçe'))}${seg('harita', tt('psMap', 'Harita'))}${seg('adres', tt('psAddress', 'Adres'))}${seg('koord', tt('psCoord', 'Koordinat'))}${seg('cizim', tt('psDrawing', 'Çizimden'))}
    </div>
    <div id="psGovde"></div>
    <div id="psSonuc" class="ps-sonuc"></div>
  </div>`;

  const sonucCiz = () => {
    const el = $('psSonuc'); if (!el) return;
    el.innerHTML = (lon == null) ? '' : sonucHtml(lon, lat, yer);
  };
  const konum = (l, b, ad) => { lon = l; lat = b; yer = ad || ''; sonucCiz(); };

  const govdeler = {
    il() {
      const ilOpt = IL.map(r => `<option value="${r[0]}">${esc(r[1])}</option>`).join('');
      return `<div class="kv">
        <label class="pair"><span>${tt('psPickIl', 'İl')}</span><select id="psIl">${ilOpt}</select></label>
        <label class="pair"><span>${tt('psPickIlce', 'İlçe')}</span><select id="psIlce"></select></label>
      </div>`;
    },
    harita() {
      return `<div class="ps-map"><canvas id="psCv"></canvas>
        <div class="ps-map-btns"><button type="button" class="btn small" data-zoom="1">+</button><button type="button" class="btn small" data-zoom="-1">−</button></div>
        <div class="ps-map-attr">${esc(tt('osmAttr', '© OpenStreetMap katkıda bulunanlar'))}</div></div>
        <div class="row"><button type="button" class="btn small" id="psGps">${tt('psGps', 'Konumum')}</button><span class="muted small" id="psCvTxt"></span></div>`;
    },
    adres() {
      return `<div class="row"><input id="psQ" placeholder="${esc(tt('psSearchPh', 'Mahalle, cadde, yer adı…'))}"><button type="button" class="btn small primary" id="psAra">${tt('psSearch', 'Ara')}</button></div>
        <div class="list" id="psSonuclar"></div>`;
    },
    koord() {
      return `<div class="row"><input id="psK" placeholder="${esc(tt('psCoordPh', '40.7654, 29.9187'))}"><button type="button" class="btn small primary" id="psKOk">${tt('psApply', 'Seç')}</button></div>`;
    },
    cizim() {
      const ext = H.ext;
      if (!ext || !isFinite(ext[0])) return `<div class="muted">${esc(tt('psDrawNone', 'Çizimdeki koordinatlar bir Türkiye dilimine oturmuyor; konumu il/ilçe ya da haritadan seçin.'))}</div>`;
      const E = (ext[0] + ext[2]) / 2, N = (ext[1] + ext[3]) / 2;
      const r = crsTahmin(E, N);
      if (!r.aday.length) return `<div class="muted">${esc(tt('psDrawNone', 'Çizimdeki koordinatlar bir Türkiye dilimine oturmuyor; konumu il/ilçe ya da haritadan seçin.'))}</div>`;
      konum(r.aday[0].lon, r.aday[0].lat, tt('psDrawGuess', 'Çizim koordinatından tahmin'));
      return `<div class="muted small">X = ${Math.round(E)} · Y = ${Math.round(N)}</div>
        <div class="list">${r.aday.slice(0, 6).map(a => `<div class="item">${esc(a.crs.name)}<small>${a.lat.toFixed(5)}° K · ${a.lon.toFixed(5)}° D</small></div>`).join('')}</div>`;
    },
  };

  const ilceDoldur = () => {
    const il = Number($('psIl').value), liste = ILCE[il] || [];
    const kayit = IL.find(r => r[0] === il);
    $('psIlce').innerHTML = `<option value="-1">${esc(tt('psIlCenter', 'İl geneli (merkez)'))}</option>` + liste.map((d, i) => `<option value="${i}">${esc(d[0])}</option>`).join('');
    const sec = () => {
      const i = Number($('psIlce').value);
      if (i < 0) konum((kayit[2] + kayit[4]) / 2, (kayit[3] + kayit[5]) / 2, kayit[1]);
      else konum(liste[i][1], liste[i][2], kayit[1] + ' / ' + liste[i][0]);
    };
    $('psIlce').onchange = sec;
    sec();
  };

  const govdeCiz = () => {
    const g = $('psGovde'); if (!g) return;
    g.innerHTML = (govdeler[sekme] || govdeler.il)();
    if (sekme === 'il') { $('psIl').onchange = ilceDoldur; ilceDoldur(); }
    if (sekme === 'harita') {
      const bas = [lon != null ? lon : (H.lonLat0 ? H.lonLat0[0] : 32.85), lat != null ? lat : (H.lonLat0 ? H.lonLat0[1] : 39.93)];
      hrt = harita($('psCv'), bas, karoUrl);
      const yaz = (l, b) => { const e = $('psCvTxt'); if (e) e.textContent = `${b.toFixed(5)}° K · ${l.toFixed(5)}° D`; };
      hrt.onMove = (l, b) => { yaz(l, b); konum(l, b, tt('psPicked', 'Seçilen konum')); };
      yaz(bas[0], bas[1]);
      konum(bas[0], bas[1], tt('psPicked', 'Seçilen konum'));
      $('psGps').onclick = () => {
        if (!navigator.geolocation) { H.toast(tt('psNoNet', 'Adres araması için çevrim içi olmak gerekir.')); return; }
        navigator.geolocation.getCurrentPosition(
          (p) => hrt.git(p.coords.longitude, p.coords.latitude, 14),
          () => H.toast(tt('psNoResult', 'Sonuç bulunamadı.'), { type: 'warn' }), { timeout: 8000 });
      };
    }
    if (sekme === 'adres') {
      const ara = async () => {
        const q = $('psQ').value.trim(); if (!q) return;
        const kutu = $('psSonuclar');
        // Önce ÇEVRİM DIŞI dizin: il ve ilçe adları ağ olmadan da bulunur
        const yerel = idariAra(q, 12);
        kutu.innerHTML = yerel.map(r => `<div class="item" data-lon="${r.lon}" data-lat="${r.lat}" data-ad="${esc(r.il + ' / ' + r.ilce)}">${esc(r.ilce)}<small>${esc(r.il)}</small></div>`).join('');
        try {
          const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=tr&q=' + encodeURIComponent(q);
          const r = await fetch(u, { headers: { 'Accept-Language': 'tr' } });
          if (!r.ok) throw new Error('http ' + r.status);
          const j = await r.json();
          kutu.innerHTML += j.map(x => `<div class="item" data-lon="${+x.lon}" data-lat="${+x.lat}" data-ad="${esc(x.display_name)}">${esc((x.name || x.display_name).slice(0, 60))}<small>${esc(String(x.display_name).slice(0, 90))}</small></div>`).join('');
        } catch (_) {
          if (!yerel.length) kutu.innerHTML = `<div class="muted">${esc(tt('psNoNet', 'Adres araması için çevrim içi olmak gerekir.'))}</div>`;
        }
        if (!kutu.innerHTML) kutu.innerHTML = `<div class="muted">${esc(tt('psNoResult', 'Sonuç bulunamadı.'))}</div>`;
      };
      $('psAra').onclick = ara;
      $('psQ').onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ara(); } };
    }
    if (sekme === 'koord') {
      const oku = () => {
        const p = koordCoz($('psK').value);
        if (!p) { H.toast(tt('psBadCoord', 'Koordinat okunamadı.'), { type: 'warn' }); return; }
        konum(p[0], p[1], '');
      };
      $('psKOk').onclick = oku;
      $('psK').onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); oku(); } };
    }
    sonucCiz();
  };

  H.openDoc(tt('psTitle', 'Projeksiyon seç'), html());
  const kok = $('docBody');
  kok.onclick = (ev) => {
    const s = ev.target.closest('[data-ps]');
    if (s) { sekme = s.dataset.ps; kok.querySelectorAll('.ps-seg .seg-b').forEach(b => b.classList.toggle('on', b.dataset.ps === sekme)); govdeCiz(); return; }
    const z = ev.target.closest('[data-zoom]');
    if (z && hrt) { hrt.yakin(Number(z.dataset.zoom)); return; }
    const it = ev.target.closest('[data-lon]');
    if (it) { konum(+it.dataset.lon, +it.dataset.lat, it.dataset.ad || ''); return; }
    const c = ev.target.closest('[data-crs]');
    if (c) {
      const crs = CRS.find(x => x.id === c.dataset.crs);
      if (crs) H.uygula(crs.id, { lon, lat, yer });
      return;
    }
  };
  govdeCiz();
  return { govdeCiz, konum: () => (lon == null ? null : [lon, lat]) };
}
