/*
 * TANITIM FONU — ffmpeg ile sentezlenen sade bir altlık.
 *
 * Neden sentez: makinede hazır müzik yok, ağdan hazır parça indirmek telif sorunudur. Sentez
 * telifsizdir ve tamamen denetlenebilir. Karşılığında "gerçek enstrüman" tınısı yoktur; bu
 * yüzden parça bilerek SEYREK ve SAKİN tutulur — kalabalık bir aranjman sentezde ucuz duyulur,
 * yumuşak bir yastık duyulmaz bile. Amaç dikkat çekmek değil, sessizliği doldurmaktır.
 *
 * Yapı: 70 vuruş/dk, la minör alanında dört akor (Am - F - C - G), her biri 5 sn. Üstte üç
 * sinüs (akor sesleri), altta sürekli bir la oktavı. Her ses uzun açılış/kapanışla girer:
 * sinüsün sert başlangıcı "bip" gibi duyulur, uzun zarf onu yastığa çevirir. Alçak geçiren
 * süzgeç tiz uçları alır, yankı derinlik verir.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const FF = process.env.FFMPEG || '/tmp/claude-0/-home-user/e9a4c8c0-386b-5fb0-86a7-83457273d23c/scratchpad/ff/node_modules/ffmpeg-static/ffmpeg';
const cikti = process.argv[2] || path.join(process.cwd(), 'fon.wav');
const SURE = Number(process.argv[3] || 20);   // tek döngü uzunluğu (sn)

const AKOR = [
  [220.00, 261.63, 329.63],   // Am
  [174.61, 220.00, 261.63],   // F
  [261.63, 329.63, 392.00],   // C
  [196.00, 246.94, 293.66],   // G
];
const AKOR_SN = SURE / AKOR.length;

const girdiler = [], suzgec = [], etiketler = [];
let n = 0;
AKOR.forEach((akor, ai) => {
  akor.forEach((hz, ni) => {
    girdiler.push('-f', 'lavfi', '-t', String(AKOR_SN + 1.2), '-i', `sine=frequency=${hz}:sample_rate=48000`);
    const e = 'n' + n;
    // en üstteki ses biraz daha sessiz: akorun tepesi öne çıkarsa melodi gibi duyulur, istenmez
    const vol = (ni === 2 ? 0.10 : 0.14).toFixed(3);
    suzgec.push(`[${n}:a]afade=t=in:st=0:d=1.4:curve=qsin,afade=t=out:st=${(AKOR_SN - 0.6).toFixed(2)}:d=1.8:curve=qsin,volume=${vol},adelay=${Math.round(ai * AKOR_SN * 1000)}|${Math.round(ai * AKOR_SN * 1000)}[${e}]`);
    etiketler.push('[' + e + ']');
    n++;
  });
});
// sürekli alt ses: akor değişimlerini birbirine bağlar
girdiler.push('-f', 'lavfi', '-t', String(SURE), '-i', 'sine=frequency=110:sample_rate=48000');
suzgec.push(`[${n}:a]afade=t=in:st=0:d=3:curve=qsin,afade=t=out:st=${SURE - 3}:d=3:curve=qsin,volume=0.075[dr]`);
etiketler.push('[dr]');
n++;

const mix = `${etiketler.join('')}amix=inputs=${etiketler.length}:duration=longest:normalize=0[mx];`
  + `[mx]lowpass=f=3200,aecho=0.8:0.85:320|540:0.22|0.14,atrim=0:${SURE},asetpts=N/SR/TB,`
  + `aformat=channel_layouts=stereo,volume=1.0[out]`;

execFileSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', ...girdiler,
  '-filter_complex', suzgec.join(';') + ';' + mix, '-map', '[out]', '-t', String(SURE), cikti], { stdio: 'inherit' });
console.log('fon döngüsü yazıldı:', cikti, SURE + ' sn');
