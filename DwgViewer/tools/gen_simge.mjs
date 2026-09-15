// Uygulama simgesi ÖNERİSİ — "Plan ve Kalem". Tek kaynaktan SVG, Android vektörü ve mağaza
// görseli üretir. Adoption (mipmap'e taşıma) elle yapılır; bu betik yalnız dosyaları hazırlar.
//
// FİKİR: simge, bekleme canlandırmasının BİRİNCİ PERDESİDİR — iki odalı planın tek çizgide
// çizilmiş hâli ve ucunda duran kalem başı. Yol, canlandırmadaki Euler yolunun aynısıdır
// (M-23 0 V21 H23 V-21 H-23 V0 H23): hiçbir duvar iki kez geçilmez, çizgi kesintisizdir ve
// kalem, çizginin bittiği yerde bekler. Kullanıcı uygulamayı açtığında simgedeki çizginin
// kendini çizdiğini görür; simge ile açılış aynı şeyin iki hâlidir.
//
// NEDEN BU ORANLAR: uyarlanabilir simge 108 dp tuvalde çizilir, başlatıcı 72 dp'lik daireye
// (r=36) kırpar. Markanın en uzak noktası köşelerdir: (23+3, 21+3) → merkeze 35,4 dp. Yani
// daire maskesinde bile köşe kırpılmaz, damla ve yuvarlak kare maskelerinde rahat oturur.
// Kalem başı sağda 23+6,8 = 29,8 dp'de kalır.
//
// NEDEN OKUNUR: mevcut simge fotoğrafik bir yığındır (ZIP+PDF+Word+DWG yaprakları) ve 96 px
// altında tanınmaz hâle gelir; Play'in kendi yönergesi simgenin 48 dp'de okunmasını ister.
// Bu mark üç çizgi ve bir noktadan ibarettir: 36 px'te bile plan olarak okunur.
//
// Kullanım: node tools/gen_simge.mjs
import fs from 'node:fs';
import path from 'node:path';

const M1 = '#054EB1', M2 = '#01215F', AK = '#FFFFFF', SARI = '#F5B342';
const A = 23, B = 21, W = 6.0, HR = 6.8, EY = 2.0;     // yarı en, yarı boy, kalınlık, baş, göz
const YOL = `M-${A} 0 V${B} H${A} V-${B} H-${A} V0 H${A}`;
const dir = 'docs/simge';

/** Dairenin VectorDrawable'da yolu (vektör çiziminde <circle> yoktur) */
const daire = (cx, cy, r) => `M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;

const onYuz = (ak = AK, sari = SARI, goz = M2) => `
  <g transform="translate(54 54)">
    <path d="${YOL}" fill="none" stroke="${ak}" stroke-width="${W}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${A}" cy="0" r="${HR}" fill="${sari}"/>
    <circle cx="${A + 1.9}" cy="-1.7" r="${EY}" fill="${goz}"/>
  </g>`;
const zemin = `<defs><linearGradient id="z" x1="0" y1="0" x2="0" y2="108" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${M1}"/><stop offset="1" stop-color="${M2}"/></linearGradient></defs>
  <rect width="108" height="108" fill="url(#z)"/>`;
const svg = (ic, boy = 108) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${boy}" height="${boy}">${ic}</svg>\n`;

fs.mkdirSync(path.join(dir, 'android'), { recursive: true });
fs.writeFileSync(path.join(dir, 'simge.svg'), svg(zemin + onYuz()));
fs.writeFileSync(path.join(dir, 'on-yuz.svg'), svg(onYuz()));
fs.writeFileSync(path.join(dir, 'tek-renk.svg'), svg(onYuz('#000000', '#000000', '#FFFFFF')));

// --- Android uyarlanabilir simge katmanları -------------------------------------------------
const vd = (govde) => `<?xml version="1.0" encoding="utf-8"?>
<!-- ÖNERİ · "Plan ve Kalem" — tools/gen_simge.mjs üretir, elle düzenlenmez.
     Ön yüz vektördür: her yoğunlukta keskin, PNG yığınına gerek yok. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
${govde}</vector>
`;
const cizgi = (renk) => `    <path android:pathData="M31,54 L31,75 L77,75 L77,33 L31,33 L31,54 L77,54"
        android:strokeColor="${renk}" android:strokeWidth="${W}"
        android:strokeLineCap="round" android:strokeLineJoin="round" />`;
fs.writeFileSync(path.join(dir, 'android/ic_launcher_foreground.xml'), vd(
  cizgi(AK) + '\n' +
  `    <path android:pathData="${daire(54 + A, 54, HR)}" android:fillColor="${SARI}" />\n` +
  `    <path android:pathData="${daire(54 + A + 1.9, 54 - 1.7, EY)}" android:fillColor="${M2}" />\n`));
fs.writeFileSync(path.join(dir, 'android/ic_launcher_monochrome.xml'), vd(
  cizgi('#FFFFFF') + '\n' +
  `    <path android:pathData="${daire(54 + A, 54, HR)}" android:fillColor="#FFFFFF" />\n`));
console.log('simge dosyaları üretildi: ' + dir);
