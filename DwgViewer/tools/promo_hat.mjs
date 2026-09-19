/*
 * ÇEKİM HATTI — kare kare yakalama ve doğrudan ffmpeg'e besleme.
 *
 * NEDEN VİDEO KAYDI DEĞİL. Playwright'ın recordVideo'su ekranı CSS PİKSEL çözünürlüğünde
 * yakalar: 360x800'lük bir telefon görünümünde video da 360x800 çıkar, istenen boyut verilse
 * bile sayfa çerçevenin sol üst köşesine konur, gerisi gri kalır (ölçüldü). Ekran görüntüsü
 * ise deviceScaleFactor'ü onurlandırır — dsf 3 ile 1080x2400 keskin kare verir. Bu yüzden
 * video, ekran görüntüsü dizisinden kurulur.
 *
 * MALİYET VE ÇARE. Bir kare ~150 ms sürer; 30 kare/sn'lik 80 saniyelik video 2.400 kare eder.
 * Ama videonun çoğu DURAĞANdır: sabit duran bir görüntü için tek kare alınıp ffmpeg'e N kez
 * yazmak yeter. Yalnız HAREKETLİ kareler gerçekten yakalanır. Böylece çekim dakikalar sürer,
 * saatler değil, ve hareket tamamen düzgün olur — kare atlaması olamaz, çünkü zamanı betik
 * belirler, makinenin o anki yükü değil.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export const FPS = 30;

export function hatKur(ffmpeg, cikti, { fps = FPS, crf = 20 } = {}) {
  const ff = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart', cikti]);
  ff.stderr.on('data', (d) => process.stderr.write('[ffmpeg] ' + d));
  let n = 0;
  const yaz = (buf) => new Promise((res) => { n++; if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });
  return {
    yaz,
    get kareSayisi() { return n; },
    bitir: () => new Promise((res, rej) => { ff.stdin.end(); ff.on('close', (c) => (c === 0 ? res(n) : rej(new Error('ffmpeg çıkış ' + c)))); }),
  };
}

/** Çekim yüzeyi: sayfadan kare alır, hattı besler, sahne günlüğü tutar */
export function cekim(page, hat, { fps = FPS, kalite = 92 } = {}) {
  const t0 = Date.now();
  let sonKare = null;
  const gunluk = [];
  const kare = async () => { sonKare = await page.screenshot({ type: 'jpeg', quality: kalite }); await hat.yaz(sonKare); return sonKare; };
  return {
    fps,
    /** Tek kare yakala ve videoya N kare olarak yaz (durağan görüntü ucuzdur) */
    async tut(sn) {
      const b = await page.screenshot({ type: 'jpeg', quality: kalite });
      sonKare = b;
      const n = Math.max(1, Math.round(sn * fps));
      for (let i = 0; i < n; i++) await hat.yaz(b);
    },
    /** Hareket: n kare boyunca her karede fn(t) uygulanır (t 0..1) ve kare yakalanır */
    async hareket(sn, fn) {
      const n = Math.max(1, Math.round(sn * fps));
      for (let i = 1; i <= n; i++) { await fn(i / n, i, n); await kare(); }
    },
    kare,
    sahne(ad) { const v = hat.kareSayisi / fps; gunluk.push({ ad, sn: v }); console.log(v.toFixed(1).padStart(6) + ' sn  ' + ad + '   (gerçek ' + ((Date.now() - t0) / 1000).toFixed(0) + ' sn)'); },
    get sure() { return hat.kareSayisi / fps; },
    gunluk,
  };
}
/** Yumuşak giriş-çıkış: hareket başta ve sonda yavaşlar, ortada hızlanır */
export const yumusak = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const kaydet = (p, s) => fs.writeFileSync(p, s);
