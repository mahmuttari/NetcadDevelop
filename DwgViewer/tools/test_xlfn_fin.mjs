// Excel formül motoru — FİNANS sınaması.
// Playwright kullanmaz; depo kökünden "node tools/test_xlfn_fin.mjs" ile koşar.
// Beklenen değerlerin çoğu Microsoft'un kendi belgelenmiş örnekleridir; uydurulmuş sayı
// kullanılmadı, türetilenler (özdeşlikler, ters çevirmeler) yorumda belirtildi.
import * as X from '../app/src/main/assets/viewer/xlfn.js';
import '../app/src/main/assets/viewer/xlfn_fin.js';

let g = 0, k = 0;
const ok = (ad, kosul, ek) => { if (kosul) { g++; console.log('PASS ' + ad); } else { k++; console.log('FAIL ' + ad + (ek ? ' ' + ek : '')); } };

// --------------------------------------------------------------------------------
// Sahte bağlam: nakit akışı sütunları, metin ve boş hücreyle birlikte
// --------------------------------------------------------------------------------
const T = (y, ay, gun) => X.tarihSeri(y, ay, gun);
const SAYFA = {
  S1: [
    [-70000, 3000, -10000, T(2008, 1, 1)],
    [12000, null, 2750, T(2008, 3, 1)],
    [15000, 'metin', 4250, T(2008, 10, 30)],
    [18000, 4200, 3250, T(2009, 2, 15)],
    [21000, 6800, 2750, T(2009, 4, 1)],
    [26000, true, null, null],
  ],
};
const ctx = {
  sayfa: 'S1',
  hucre: { r: 0, c: 0 },
  oku: (sh, r, c) => { const s = SAYFA[sh || 'S1']; const sat = s && s[r]; const v = sat ? sat[c] : null; return v === undefined ? null : v; },
  boyut: (sh) => ({ r: (SAYFA[sh || 'S1'] || []).length, c: 4 }),
  simdi: () => T(2026, 9, 19),
  rastgele: () => 0.5,
};
const h = (f) => X.hesapla(f, ctx);
/** Göreli hoşgörüyle karşılaştırır: sonuç yuvarlanmaz, yalnız kayan nokta artığı bağışlanır */
const yak = (a, b, t = 1e-7) => typeof a === 'number' && isFinite(a) && Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const hataMi = (v, kod) => X.hata(v) && v.e === kod;
const tarihMi = (v, y, ay, gun) => { if (typeof v !== 'number') return false; const p = X.seriParca(v); return p.y === y && p.ay === ay && p.gun === gun; };

// ================================================================================
// Yıllık ödeme ailesi
// ================================================================================
ok('PMT temel örnek', yak(h('=PMT(0.08/12,10,10000)'), -1037.0320893591668));
ok('PMT nakit çıkışı NEGATİF', h('=PMT(0.05/12,60,10000)') < 0);
ok('PMT dönem başı (tip 1)', yak(h('=PMT(0.08/12,10,10000,0,1)'), -1030.1643271779785));
ok('PMT gelecek değer için birikim', yak(h('=PMT(0.06/12,18,0,50000)'), -2661.5865264844515));
ok('PMT ile FV birbirini tutar', yak(h('=FV(0.06/12,18,PMT(0.06/12,18,0,50000))'), 50000, 1e-9));
ok('PMT faiz sıfır', yak(h('=PMT(0,12,1200)'), -100));
ok('PMT nper 0 → #NUM!', hataMi(h('=PMT(0.1,0,1000)'), '#NUM!'));
ok('PV temel örnek', yak(h('=PV(0.08/12,240,500)'), -59777.145851187765));
ok('PV faiz sıfır', yak(h('=PV(0,10,-100,0)'), 1000));
// Dönem başı ödemeli anüite, dönem sonu ödemelinin (1+r) katıdır — türetilmiş özdeşlik
ok('PV dönem başı', yak(h('=PV(0.08/12,240,500,0,1)'), -59777.145851187765 * (1 + 0.08 / 12)));
ok('FV temel örnek', yak(h('=FV(0.06/12,10,-200,-500,1)'), 2581.4033740601367));
ok('FV yıllık birikim', yak(h('=FV(0.12/12,12,-1000)'), 12682.503013196972));
ok('FV faiz sıfır', yak(h('=FV(0,10,-100,-50)'), 1050));
ok('NPER temel örnek', yak(h('=NPER(0.12/12,-100,-1000,10000,1)'), 59.673865674294554));
ok('NPER faiz sıfır', yak(h('=NPER(0,-100,1000)'), 10));
ok('NPER faizsiz ve ödemesiz → #NUM!', hataMi(h('=NPER(0,0,1000)'), '#NUM!'));
// Ödeme tam olarak faizi karşılıyorsa anapara hiç azalmaz: denklemin kökü yoktur
ok('NPER yalnız faiz ödeniyor → #NUM!', hataMi(h('=NPER(0.1,-100,1000)'), '#NUM!'));
ok('NPER ters işaretli akış negatif dönem verir', yak(h('=NPER(0.1,100,1000)'), -7.272540897341713, 1e-9));
ok('RATE temel örnek', yak(h('=RATE(48,-200,8000)'), 0.007701472488202265, 1e-6));
ok('RATE yıllığa çevrim', yak(h('=RATE(48,-200,8000)*12'), 0.09241766985842718, 1e-6));
// Excel'in kendi RATE'i de 1e-7 hassasiyetle durur; sıfır faiz bu bandın içinde bulunur
ok('RATE sıfır faizi bulur', Math.abs(h('=RATE(10,-100,1000)')) < 1e-7);
ok('RATE tahminle aynı kökü bulur', yak(h('=PV(RATE(4,-1000,3000,0,0,0.5),4,-1000)'), 3000, 1e-8));
ok('RATE nper<=0 → #NUM!', hataMi(h('=RATE(0,-200,8000)'), '#NUM!'));
ok('IPMT ilk ay', yak(h('=IPMT(0.1/12,1,36,8000)'), -66.66666666666667));
ok('IPMT son yıl', yak(h('=IPMT(0.1,3,3,8000)'), -292.4471299093657));
ok('IPMT tip 1 ilk dönem sıfır', h('=IPMT(0.1,1,3,8000,0,1)') === 0);
// Tip 1'de ikinci dönemin faizi, dönem başı ödemesinden SONRAKİ bakiyenin faizidir
ok('IPMT tip 1 ikinci dönem', yak(h('=IPMT(0.1,2,3,1000,0,1)'), (1000 + h('=PMT(0.1,3,1000,0,1)')) * -0.1));
ok('IPMT per > nper → #NUM!', hataMi(h('=IPMT(0.1,4,3,8000)'), '#NUM!'));
ok('IPMT per < 1 → #NUM!', hataMi(h('=IPMT(0.1,0,3,8000)'), '#NUM!'));
ok('PPMT ilk dönem', yak(h('=PPMT(0.1,1,2,2000)'), -952.3809523809516));
ok('PPMT son dönem', yak(h('=PPMT(0.08,10,10,200000)'), -27598.05346242135));
ok('PPMT + IPMT = PMT', yak(h('=PPMT(0.09/12,7,24,50000)+IPMT(0.09/12,7,24,50000)'), h('=PMT(0.09/12,24,50000)')));
ok('ISPMT ilk ay', yak(h('=ISPMT(0.1/12,1,36,8000000)'), -64814.81481481482));
ok('ISPMT son dönem sıfır', h('=ISPMT(0.1,4,4,1000)') === 0);
ok('ISPMT nper 0 → #DIV/0!', hataMi(h('=ISPMT(0.1,1,0,1000)'), '#DIV/0!'));
ok('CUMIPMT ikinci yıl', yak(h('=CUMIPMT(0.09/12,360,125000,13,24,0)'), -11135.232130750844));
ok('CUMIPMT ilk ay', yak(h('=CUMIPMT(0.09/12,360,125000,1,1,0)'), -937.5));
ok('CUMPRINC ikinci yıl', yak(h('=CUMPRINC(0.09/12,360,125000,13,24,0)'), -934.1071234208782));
ok('CUMPRINC ilk ay', yak(h('=CUMPRINC(0.09/12,360,125000,1,1,0)'), -68.27827118097684));
ok('CUMPRINC tamamı = -anapara', yak(h('=CUMPRINC(0.09/12,360,125000,1,360,0)'), -125000, 1e-9));
ok('CUMIPMT oran<=0 → #NUM!', hataMi(h('=CUMIPMT(0,360,125000,1,12,0)'), '#NUM!'));
ok('CUMIPMT başlangıç > bitiş → #NUM!', hataMi(h('=CUMIPMT(0.09/12,360,125000,24,13,0)'), '#NUM!'));
ok('CUMIPMT tip 2 → #NUM!', hataMi(h('=CUMIPMT(0.09/12,360,125000,1,12,2)'), '#NUM!'));
ok('CUMPRINC bitiş > nper → #NUM!', hataMi(h('=CUMPRINC(0.09/12,12,125000,1,13,0)'), '#NUM!'));
ok('eksik argüman → #VALUE!', hataMi(h('=PMT(0.1,10)'), '#VALUE!'));
ok('fazla argüman → #VALUE!', hataMi(h('=PMT(0.1,10,1000,0,0,0)'), '#VALUE!'));
ok('hata argümanı yayılır', hataMi(h('=PMT(1/0,10,1000)'), '#DIV/0!'));
ok('çevrilemeyen metin → #VALUE!', hataMi(h('=PMT("abc",10,1000)'), '#VALUE!'));
ok('doğrudan metin sayıya çevrilir', yak(h('=PMT(0.08/12,"10",10000)'), -1037.0320893591668));

// ================================================================================
// Nakit akışı ölçütleri
// ================================================================================
ok('NPV belgelenmiş örnek', yak(h('=NPV(0.1,-10000,3000,4200,6800)'), 1188.4434123352207));
ok('NPV aralıkta metin/boş/mantık atlanır', yak(h('=NPV(0.1,B1:B6)'), h('=NPV(0.1,3000,4200,6800)')));
ok('NPV atlanan hücre dönemi kaydırır', yak(h('=NPV(0.1,B1:B6)'), 3000 / 1.1 + 4200 / 1.21 + 6800 / 1.331));
ok('NPV doğrudan metin çevrilir', yak(h('=NPV(0.1,"1100")'), 1000));
ok('NPV oran -1 → #DIV/0!', hataMi(h('=NPV(-1,100)'), '#DIV/0!'));
ok('IRR beş yıl', yak(h('=IRR(A1:A6)'), 0.08663094803653171, 1e-7));
ok('IRR dört yıl', yak(h('=IRR(A1:A5)'), -0.021244848273411334, 1e-7));
ok('IRR tahminle', yak(h('=IRR(A1:A3,-0.1)'), -0.44350694133474067, 1e-7));
ok('IRR NPV sıfırlar', Math.abs(h('=NPV(IRR(A1:A6),A2:A6)') - 70000) < 1e-4);
ok('IRR tek işaret → #NUM!', hataMi(h('=IRR({1;2;3})'), '#NUM!'));
ok('MIRR beş yıl', yak(h('=MIRR({-120000;39000;30000;21000;37000;46000},0.1,0.12)'), 0.1260941303659051, 1e-7));
ok('MIRR üç yıl', yak(h('=MIRR({-120000;39000;30000;21000},0.1,0.12)'), -0.048044655249980516, 1e-7));
ok('MIRR yeniden yatırım %14', yak(h('=MIRR({-120000;39000;30000;21000;37000;46000},0.1,0.14)'), 0.13475911082831482, 1e-7));
ok('MIRR tek işaret → #DIV/0!', hataMi(h('=MIRR({1;2;3},0.1,0.12)'), '#DIV/0!'));
ok('XNPV belgelenmiş örnek', yak(h('=XNPV(0.09,C1:C5,D1:D5)'), 2086.6476020315346, 1e-9));
ok('XNPV ilk tarih iskonto edilmez', yak(h('=XNPV(0.09,{-10000},{' + T(2008, 1, 1) + '})'), -10000));
ok('XNPV geriye tarih → #NUM!', hataMi(h('=XNPV(0.09,{100;200},{' + T(2008, 5, 1) + ';' + T(2008, 1, 1) + '})'), '#NUM!'));
ok('XNPV uzunluklar farklı → #NUM!', hataMi(h('=XNPV(0.09,{100;200},{' + T(2008, 1, 1) + '})'), '#NUM!'));
ok('XIRR belgelenmiş örnek', yak(h('=XIRR(C1:C5,D1:D5)'), 0.37336253351883177, 1e-7));
ok('XIRR bulduğu oran XNPV sıfırlar', Math.abs(h('=XNPV(XIRR(C1:C5,D1:D5),C1:C5,D1:D5)')) < 1e-6);
ok('XIRR tek işaret → #NUM!', hataMi(h('=XIRR({100;200},{' + T(2008, 1, 1) + ';' + T(2009, 1, 1) + '})'), '#NUM!'));
ok('FVSCHEDULE', yak(h('=FVSCHEDULE(1,{0.09;0.11;0.1})'), 1.33089));
ok('FVSCHEDULE boş hücre 0 faiz', yak(h('=FVSCHEDULE(100,B1:B2)'), 100 * (1 + 3000)));
ok('PDURATION', yak(h('=PDURATION(0.025,2000,2200)'), 3.8598661626226545));
ok('PDURATION bulduğu süre fv verir', yak(h('=1000*(1+0.025/12)^PDURATION(0.025/12,1000,1200)'), 1200, 1e-9));
ok('PDURATION oran 0 → #NUM!', hataMi(h('=PDURATION(0,2000,2200)'), '#NUM!'));
ok('PDURATION pv<=0 → #NUM!', hataMi(h('=PDURATION(0.025,0,2200)'), '#NUM!'));
ok('RRI', yak(h('=RRI(96,10000,11000)'), 0.0009933073762913684));
ok('RRI ile FV birbirini tutar', yak(h('=10000*(1+RRI(96,10000,11000))^96'), 11000, 1e-9));
ok('RRI nper<=0 → #NUM!', hataMi(h('=RRI(0,10000,11000)'), '#NUM!'));
ok('RRI pv 0 → #NUM!', hataMi(h('=RRI(10,0,11000)'), '#NUM!'));
ok('EFFECT', yak(h('=EFFECT(0.0525,4)'), 0.05354266737075821));
ok('EFFECT aylık', yak(h('=EFFECT(0.12,12)'), 0.12682503013196977));
ok('NOMINAL', yak(h('=NOMINAL(0.053543,4)'), 0.05250031986835646));
ok('NOMINAL EFFECT tersidir', yak(h('=NOMINAL(EFFECT(0.0525,4),4)'), 0.0525, 1e-12));
ok('EFFECT dönem<1 → #NUM!', hataMi(h('=EFFECT(0.0525,0)'), '#NUM!'));
ok('NOMINAL oran<=0 → #NUM!', hataMi(h('=NOMINAL(0,4)'), '#NUM!'));
ok('EFFECT dönem kesri kesilir', h('=EFFECT(0.0525,4.9)') === h('=EFFECT(0.0525,4)'));
ok('DOLLARDE 16lık', yak(h('=DOLLARDE(1.02,16)'), 1.125));
ok('DOLLARDE 32lik', yak(h('=DOLLARDE(1.1,32)'), 1.3125));
ok('DOLLARDE negatif', yak(h('=DOLLARDE(-1.02,16)'), -1.125));
ok('DOLLARFR 16lık', yak(h('=DOLLARFR(1.125,16)'), 1.02));
ok('DOLLARFR 32lik', yak(h('=DOLLARFR(1.125,32)'), 1.04));
ok('DOLLARFR DOLLARDE tersidir', yak(h('=DOLLARDE(DOLLARFR(1.3125,32),32)'), 1.3125, 1e-12));
ok('DOLLARDE payda 0 → #DIV/0!', hataMi(h('=DOLLARDE(1.02,0)'), '#DIV/0!'));
ok('DOLLARFR payda negatif → #NUM!', hataMi(h('=DOLLARFR(1.125,-2)'), '#NUM!'));

// ================================================================================
// Amortisman
// ================================================================================
ok('SLN', h('=SLN(30000,7500,10)') === 2250);
ok('SLN ömür 0 → #DIV/0!', hataMi(h('=SLN(30000,7500,0)'), '#DIV/0!'));
ok('SYD ilk yıl', yak(h('=SYD(30000,7500,10,1)'), 4090.909090909091));
ok('SYD son yıl', yak(h('=SYD(30000,7500,10,10)'), 409.0909090909091));
let sydT = 0; for (let i = 1; i <= 10; i++) sydT += h(`=SYD(30000,7500,10,${i})`);
ok('SYD toplamı = maliyet - hurda', yak(sydT, 22500, 1e-9));
ok('SYD per > ömür → #NUM!', hataMi(h('=SYD(30000,7500,10,11)'), '#NUM!'));
ok('SYD per 0 → #NUM!', hataMi(h('=SYD(30000,7500,10,0)'), '#NUM!'));
ok('SYD ömür 0 → #NUM!', hataMi(h('=SYD(30000,7500,0,1)'), '#NUM!'));
ok('DB 1. dönem (7 ay)', yak(h('=DB(1000000,100000,6,1,7)'), 186083.33333333334));
ok('DB 2. dönem', yak(h('=DB(1000000,100000,6,2,7)'), 259639.41666666666));
ok('DB son (ömür+1) dönem', yak(h('=DB(1000000,100000,6,7,7)'), 15845.098473848071));
ok('DB ay varsayılanı 12', yak(h('=DB(1000000,100000,6,1)'), 319000));
ok('DB oranı üç ondalığa yuvarlanır', yak(h('=DB(1000000,100000,6,1)/1000000'), 0.319));
ok('DB dönem > ömür+1 → #NUM!', hataMi(h('=DB(1000000,100000,6,8,7)'), '#NUM!'));
ok('DB ay 13 → #NUM!', hataMi(h('=DB(1000000,100000,6,1,13)'), '#NUM!'));
ok('DDB ilk gün', yak(h('=DDB(2400,300,3650,1)'), 1.3150684931506476));
ok('DDB ilk ay', yak(h('=DDB(2400,300,120,1,2)'), 40));
ok('DDB ilk yıl', yak(h('=DDB(2400,300,10,1)'), 480));
ok('DDB çarpan 1,5', yak(h('=DDB(2400,300,10,2,1.5)'), 306, 1e-12));
ok('DDB son yıl hurdada durur', yak(h('=DDB(2400,300,10,10)'), 22.122547200000156));
let ddbT = 0; for (let i = 1; i <= 10; i++) ddbT += h(`=DDB(2400,300,10,${i})`);
ok('DDB toplamı hurdanın altına inmez', ddbT <= 2100 + 1e-9);
ok('DDB dönem > ömür → #NUM!', hataMi(h('=DDB(2400,300,10,11)'), '#NUM!'));
ok('DDB dönem < 1 → #NUM!', hataMi(h('=DDB(2400,300,10,0)'), '#NUM!'));
ok('VDB ilk gün', yak(h('=VDB(2400,300,3650,0,1)'), 1.3150684931506476));
ok('VDB ilk ay', yak(h('=VDB(2400,300,120,0,1)'), 40));
ok('VDB ilk yıl', yak(h('=VDB(2400,300,10,0,1)'), 480));
ok('VDB 6.-18. ay', yak(h('=VDB(2400,300,120,6,18)'), 396.3060532647519));
ok('VDB 6.-18. ay çarpan 1,5', yak(h('=VDB(2400,300,120,6,18,1.5)'), 311.80893665823305));
ok('VDB kısmi ilk dönem', yak(h('=VDB(2400,300,10,0,0.875,1.5)'), 315));
ok('VDB tam ömür = maliyet - hurda', yak(h('=VDB(2400,300,10,0,10)'), 2100, 1e-9));
// Hurda 0 iken azalan bakiye maliyetin tamamını hiç tüketemez; doğrusala geçiş tüketir
ok('VDB geçişsiz daha az amortisman verir', h('=VDB(2400,0,10,0,10,2,TRUE)') < h('=VDB(2400,0,10,0,10,2,FALSE)'));
ok('VDB geçişli tam ömürde maliyeti tüketir', yak(h('=VDB(2400,0,10,0,10,2,FALSE)'), 2400, 1e-9));
ok('VDB geçişsiz kalıntı bırakır', yak(h('=VDB(2400,0,10,0,10,2,TRUE)'), 2400 * (1 - Math.pow(0.8, 10)), 1e-9));
ok('VDB geçişsiz ilk yıl DDB ile aynı', yak(h('=VDB(2400,300,10,0,1,2,TRUE)'), h('=DDB(2400,300,10,1)')));
ok('VDB bitiş > ömür → #NUM!', hataMi(h('=VDB(2400,300,10,0,11)'), '#NUM!'));
ok('AMORDEGRC 1. dönem', h(`=AMORDEGRC(2400,${T(2008, 8, 19)},${T(2008, 12, 31)},300,1,0.15)`) === 776);
ok('AMORDEGRC 0. dönem (kıst)', h(`=AMORDEGRC(2400,${T(2008, 8, 19)},${T(2008, 12, 31)},300,0,0.15)`) === 330);
ok('AMORDEGRC tutarlar tam birime yuvarlanır', Number.isInteger(h(`=AMORDEGRC(2400,${T(2008, 8, 19)},${T(2008, 12, 31)},300,2,0.15)`)));
ok('AMORDEGRC oran 0 → #NUM!', hataMi(h(`=AMORDEGRC(2400,${T(2008, 8, 19)},${T(2008, 12, 31)},300,1,0)`), '#NUM!'));
ok('AMORLINC 1. dönem', yak(h(`=AMORLINC(2400,${T(2008, 8, 19)},${T(2008, 12, 31)},300,1,0.15)`), 360));
ok('AMORLINC 0. dönem (kıst)', yak(h(`=AMORLINC(2400,${T(2008, 8, 19)},${T(2008, 12, 31)},300,0,0.15)`), 132));
ok('AMORLINC ömür bitince 0', h(`=AMORLINC(2400,${T(2008, 8, 19)},${T(2008, 12, 31)},300,9,0.15)`) === 0);
ok('AMORLINC alım > ilk dönem → #NUM!', hataMi(h(`=AMORLINC(2400,${T(2009, 1, 1)},${T(2008, 12, 31)},300,1,0.15)`), '#NUM!'));

// ================================================================================
// Kupon takvimi ve gün sayma temelleri
// ================================================================================
const KO = `${T(2011, 1, 25)},${T(2011, 11, 15)},2`;
ok('COUPDAYBS temel 1', h(`=COUPDAYBS(${KO},1)`) === 71);
ok('COUPDAYS temel 1', h(`=COUPDAYS(${KO},1)`) === 181);
ok('COUPDAYSNC temel 1', h(`=COUPDAYSNC(${KO},1)`) === 110);
ok('COUPDAYBS + NC = COUPDAYS (temel 1)', h(`=COUPDAYBS(${KO},1)+COUPDAYSNC(${KO},1)`) === h(`=COUPDAYS(${KO},1)`));
ok('COUPNCD temel 1', tarihMi(h(`=COUPNCD(${KO},1)`), 2011, 5, 15));
ok('COUPPCD temel 1', tarihMi(h(`=COUPPCD(${KO},1)`), 2010, 11, 15));
ok('COUPNUM temel 1', h(`=COUPNUM(${KO},1)`) === 2);
ok('COUPDAYBS temel 0', h(`=COUPDAYBS(${KO},0)`) === 70);
ok('COUPDAYS temel 0', h(`=COUPDAYS(${KO},0)`) === 180);
ok('COUPDAYS temel 3', h(`=COUPDAYS(${KO},3)`) === 182.5);
ok('COUPDAYSNC temel 2 gerçek gün sayar', h(`=COUPDAYSNC(${KO},2)`) === 110);
ok('temel 2de BS + NC dönemi tutmaz', h(`=COUPDAYBS(${KO},2)+COUPDAYSNC(${KO},2)`) !== h(`=COUPDAYS(${KO},2)`));
ok('COUPNCD ay sonu kırpması (29 Şubat)', tarihMi(h(`=COUPNCD(${T(2008, 1, 15)},${T(2011, 8, 31)},2)`), 2008, 2, 29));
ok('COUPPCD ay sonundan geriye', tarihMi(h(`=COUPPCD(${T(2008, 1, 15)},${T(2011, 8, 31)},2)`), 2007, 8, 31));
ok('COUPNUM çeyrek dönem', h(`=COUPNUM(${T(2011, 1, 25)},${T(2012, 1, 15)},4)`) === 4);
ok('COUP sıklık 3 → #NUM!', hataMi(h(`=COUPNUM(${KO.replace(',2', ',3')},1)`), '#NUM!'));
ok('COUP ödeme >= vade → #NUM!', hataMi(h(`=COUPNUM(${T(2012, 1, 25)},${T(2011, 11, 15)},2,1)`), '#NUM!'));
ok('COUP temel 5 → #NUM!', hataMi(h(`=COUPNUM(${KO},5)`), '#NUM!'));
ok('30/360 ABD Şubat sonu kuralı', yak(h(`=ACCRINTM(${T(2008, 2, 29)},${T(2008, 8, 31)},0.1,1000,0)`), 50));
ok('30/360 ABD 28 Şubat (artık yıl) 183 gün', yak(h(`=ACCRINTM(${T(2008, 2, 28)},${T(2008, 8, 31)},0.1,1000,0)`), 1000 * 0.1 * 183 / 360));
// Avrupa kuralında 31 her zaman 30'a iner, Şubat'a dokunulmaz: 182 gün
ok('30/360 Avrupa 31i 30a indirir', yak(h(`=ACCRINTM(${T(2008, 2, 28)},${T(2008, 8, 31)},0.1,1000,4)`), 1000 * 0.1 * 182 / 360));
ok('gerçek/360 (temel 2)', yak(h(`=ACCRINTM(${T(2008, 1, 1)},${T(2008, 7, 1)},0.1,1000,2)`), 1000 * 0.1 * 182 / 360));
ok('gerçek/365 (temel 3)', yak(h(`=ACCRINTM(${T(2008, 1, 1)},${T(2008, 7, 1)},0.1,1000,3)`), 1000 * 0.1 * 182 / 365));
ok('gerçek/gerçek artık yılda 366 böler', yak(h(`=ACCRINTM(${T(2008, 1, 1)},${T(2008, 7, 1)},0.1,1000,1)`), 1000 * 0.1 * 182 / 366));

// ================================================================================
// Tahvil ve iskontolu kâğıt
// ================================================================================
ok('PRICE belgelenmiş örnek', yak(h(`=PRICE(${T(2008, 2, 15)},${T(2017, 11, 15)},0.0575,0.065,100,2,0)`), 94.63436162132213));
ok('YIELD belgelenmiş örnek', yak(h(`=YIELD(${T(2008, 2, 15)},${T(2016, 11, 15)},0.0575,95.04287,100,2,0)`), 0.065, 1e-6));
ok('YIELD PRICE tersidir', yak(h(`=PRICE(${T(2008, 2, 15)},${T(2017, 11, 15)},0.0575,YIELD(${T(2008, 2, 15)},${T(2017, 11, 15)},0.0575,94.63436162,100,2,0),100,2,0)`), 94.63436162, 1e-7));
// Son kupon dönemindeyken Excel BASİT faiz kullanır: (itfa + kupon) / (1 + DSC/E * y/f) - işlemiş
ok('PRICE son dönemde basit faiz', yak(h(`=PRICE(${T(2008, 2, 15)},${T(2008, 5, 15)},0.0575,0.065,100,2,0)`), (100 + 2.875) / (1 + (90 / 180) * 0.065 / 2) - 2.875 * 90 / 180));
ok('PRICE itfa <= 0 → #NUM!', hataMi(h(`=PRICE(${T(2008, 2, 15)},${T(2017, 11, 15)},0.0575,0.065,0,2,0)`), '#NUM!'));
ok('DISC belgelenmiş örnek', yak(h(`=DISC(${T(2007, 1, 25)},${T(2007, 6, 15)},97.975,100,1)`), 0.05242021276595747));
ok('INTRATE belgelenmiş örnek', yak(h(`=INTRATE(${T(2008, 2, 15)},${T(2008, 5, 15)},1000000,1014420,2)`), 0.05768));
ok('RECEIVED belgelenmiş örnek', yak(h(`=RECEIVED(${T(2008, 2, 15)},${T(2008, 5, 15)},1000000,0.0575,2)`), 1014584.6544071021));
ok('RECEIVED DISC ile tutarlı', yak(h(`=DISC(${T(2008, 2, 15)},${T(2008, 5, 15)},1000000,RECEIVED(${T(2008, 2, 15)},${T(2008, 5, 15)},1000000,0.0575,2),2)`), 0.0575, 1e-9));
ok('PRICEDISC belgelenmiş örnek', yak(h(`=PRICEDISC(${T(2008, 2, 16)},${T(2008, 3, 1)},0.0525,100,2)`), 99.79583333333333));
ok('YIELDDISC belgelenmiş örnek', yak(h(`=YIELDDISC(${T(2008, 2, 16)},${T(2008, 3, 1)},99.795,100,2)`), 0.05282257198685834));
ok('PRICEDISC YIELDDISC tersi değildir ama DISC ile tutarlıdır', yak(h(`=DISC(${T(2008, 2, 16)},${T(2008, 3, 1)},PRICEDISC(${T(2008, 2, 16)},${T(2008, 3, 1)},0.0525,100,2),100,2)`), 0.0525, 1e-12));
ok('PRICEMAT belgelenmiş örnek', yak(h(`=PRICEMAT(${T(2008, 2, 15)},${T(2008, 4, 13)},${T(2007, 11, 11)},0.061,0.061,0)`), 99.98449887555694));
ok('YIELDMAT belgelenmiş örnek', yak(h(`=YIELDMAT(${T(2008, 3, 15)},${T(2008, 11, 3)},${T(2007, 11, 8)},0.0625,100.0123,0)`), 0.06095433369153847));
ok('YIELDMAT PRICEMAT tersidir', yak(h(`=YIELDMAT(${T(2008, 2, 15)},${T(2008, 4, 13)},${T(2007, 11, 11)},0.061,PRICEMAT(${T(2008, 2, 15)},${T(2008, 4, 13)},${T(2007, 11, 11)},0.061,0.061,0),0)`), 0.061, 1e-12));
ok('PRICEMAT ihraç >= ödeme → #NUM!', hataMi(h(`=PRICEMAT(${T(2007, 11, 11)},${T(2008, 4, 13)},${T(2007, 11, 11)},0.061,0.061,0)`), '#NUM!'));
ok('DURATION belgelenmiş örnek', yak(h(`=DURATION(${T(2008, 1, 1)},${T(2016, 1, 1)},0.08,0.09,2,1)`), 5.993774955545185));
ok('MDURATION belgelenmiş örnek', yak(h(`=MDURATION(${T(2008, 1, 1)},${T(2016, 1, 1)},0.08,0.09,2,1)`), 5.735669813918838));
ok('MDURATION = DURATION / (1+y/f)', yak(h(`=MDURATION(${T(2008, 1, 1)},${T(2016, 1, 1)},0.08,0.09,2,1)*1.045`), h(`=DURATION(${T(2008, 1, 1)},${T(2016, 1, 1)},0.08,0.09,2,1)`)));
ok('DURATION dönem içinde kısalır', h(`=DURATION(${T(2008, 4, 1)},${T(2016, 1, 1)},0.08,0.09,2,1)`) < h(`=DURATION(${T(2008, 1, 1)},${T(2016, 1, 1)},0.08,0.09,2,1)`));
ok('DURATION kuponsuz kâğıt = kalan süre', yak(h(`=DURATION(${T(2008, 1, 1)},${T(2016, 1, 1)},0,0.09,2,1)`), 8, 1e-12));
ok('DURATION getiri < 0 → #NUM!', hataMi(h(`=DURATION(${T(2008, 1, 1)},${T(2016, 1, 1)},0.08,-0.01,2,1)`), '#NUM!'));
ok('ACCRINT 30/360 ile 60 gün', yak(h(`=ACCRINT(${T(2008, 3, 1)},${T(2008, 8, 31)},${T(2008, 5, 1)},0.1,1000,2,0)`), 1000 * 0.1 * 60 / 360));
ok('ACCRINT 61 günlük aralık', yak(h(`=ACCRINT(${T(2008, 3, 1)},${T(2008, 8, 31)},${T(2008, 5, 2)},0.1,1000,2,0)`), 16.944444444444446));
ok('ACCRINT 5 Mart ihraç', yak(h(`=ACCRINT(${T(2008, 3, 5)},${T(2008, 8, 31)},${T(2008, 5, 1)},0.1,1000,2,0)`), 15.555555555555555));
ok('ACCRINT 5 Nisan ihraç', yak(h(`=ACCRINT(${T(2008, 4, 5)},${T(2008, 8, 31)},${T(2008, 5, 1)},0.1,1000,2,0,TRUE)`), 7.222222222222221));
ok('ACCRINT nominal varsayılanı 1000', yak(h(`=ACCRINT(${T(2008, 3, 1)},${T(2008, 8, 31)},${T(2008, 5, 1)},0.1,,2,0)`), h(`=ACCRINT(${T(2008, 3, 1)},${T(2008, 8, 31)},${T(2008, 5, 1)},0.1,1000,2,0)`)));
ok('ACCRINT hesap yöntemi YANLIŞ ilk kupondan sayar', yak(h(`=ACCRINT(${T(2008, 3, 1)},${T(2008, 4, 1)},${T(2008, 6, 1)},0.1,1000,2,0,FALSE)`), 1000 * 0.1 * 60 / 360));
ok('ACCRINT oran <= 0 → #NUM!', hataMi(h(`=ACCRINT(${T(2008, 3, 1)},${T(2008, 8, 31)},${T(2008, 5, 1)},0,1000,2,0)`), '#NUM!'));
ok('ACCRINTM belgelenmiş örnek', yak(h(`=ACCRINTM(${T(2008, 4, 1)},${T(2008, 6, 15)},0.1,1000,3)`), 20.54794520547945));
ok('ACCRINTM temel varsayılanı 30/360', yak(h(`=ACCRINTM(${T(2008, 4, 1)},${T(2008, 6, 15)},0.1,1000)`), 1000 * 0.1 * 74 / 360));
ok('ACCRINTM nominalsiz çağrı → #VALUE!', hataMi(h(`=ACCRINTM(${T(2008, 4, 1)},${T(2008, 6, 15)},0.1)`), '#VALUE!'));
ok('ACCRINTM nominal varsayılanı 1000', yak(h(`=ACCRINTM(${T(2008, 4, 1)},${T(2008, 6, 15)},0.1,,3)`), 20.54794520547945));
ok('ACCRINTM ihraç >= ödeme → #NUM!', hataMi(h(`=ACCRINTM(${T(2008, 6, 15)},${T(2008, 4, 1)},0.1,1000,3)`), '#NUM!'));
ok('TBILLEQ belgelenmiş örnek', yak(h(`=TBILLEQ(${T(2008, 3, 31)},${T(2008, 6, 1)},0.0914)`), 0.09415149356594302));
ok('TBILLPRICE belgelenmiş örnek', yak(h(`=TBILLPRICE(${T(2008, 3, 31)},${T(2008, 6, 1)},0.09)`), 98.45));
ok('TBILLYIELD belgelenmiş örnek', yak(h(`=TBILLYIELD(${T(2008, 3, 31)},${T(2008, 6, 1)},98.45)`), 0.09141696292534261));
ok('TBILLPRICE TBILLYIELD tutarlı', yak(h(`=TBILLPRICE(${T(2008, 3, 31)},${T(2008, 6, 1)},0.09)`), 98.45, 1e-12));
ok('TBILL vade 1 yıldan uzun → #NUM!', hataMi(h(`=TBILLPRICE(${T(2008, 3, 31)},${T(2009, 6, 1)},0.09)`), '#NUM!'));
ok('TBILLEQ iskonto <= 0 → #NUM!', hataMi(h(`=TBILLEQ(${T(2008, 3, 31)},${T(2008, 6, 1)},0)`), '#NUM!'));
ok('ODDFPRICE belgelenmiş örnek', yak(h(`=ODDFPRICE(${T(2008, 11, 11)},${T(2021, 3, 1)},${T(2008, 10, 15)},${T(2009, 3, 1)},0.0785,0.0625,100,2,1)`), 113.59771747407883));
ok('ODDFYIELD belgelenmiş örnek', yak(h(`=ODDFYIELD(${T(2008, 11, 11)},${T(2021, 3, 1)},${T(2008, 10, 15)},${T(2009, 3, 1)},0.0575,84.5,100,2,0)`), 0.07724554159781755, 1e-7));
ok('ODDFYIELD ODDFPRICE tersidir', yak(h(`=ODDFPRICE(${T(2008, 11, 11)},${T(2021, 3, 1)},${T(2008, 10, 15)},${T(2009, 3, 1)},0.0575,ODDFYIELD(${T(2008, 11, 11)},${T(2021, 3, 1)},${T(2008, 10, 15)},${T(2009, 3, 1)},0.0575,84.5,100,2,0),100,2,0)`), 84.5, 1e-7));
ok('ODDFPRICE uzun ilk dönem de hesaplanır', typeof h(`=ODDFPRICE(${T(2008, 11, 11)},${T(2021, 3, 1)},${T(2008, 2, 15)},${T(2009, 3, 1)},0.0785,0.0625,100,2,1)`) === 'number');
ok('ODDFPRICE ihraç >= ödeme → #NUM!', hataMi(h(`=ODDFPRICE(${T(2008, 10, 15)},${T(2021, 3, 1)},${T(2008, 11, 11)},${T(2009, 3, 1)},0.0785,0.0625,100,2,1)`), '#NUM!'));
ok('ODDLPRICE belgelenmiş örnek', yak(h(`=ODDLPRICE(${T(2008, 2, 7)},${T(2008, 6, 15)},${T(2007, 10, 15)},0.0375,0.0405,100,2,0)`), 99.87828601472134));
ok('ODDLYIELD belgelenmiş örnek', yak(h(`=ODDLYIELD(${T(2008, 4, 20)},${T(2008, 6, 15)},${T(2007, 12, 24)},0.0375,99.875,100,2,0)`), 0.04519223562916894));
ok('ODDLYIELD ODDLPRICE tersidir', yak(h(`=ODDLYIELD(${T(2008, 2, 7)},${T(2008, 6, 15)},${T(2007, 10, 15)},0.0375,ODDLPRICE(${T(2008, 2, 7)},${T(2008, 6, 15)},${T(2007, 10, 15)},0.0375,0.0405,100,2,0),100,2,0)`), 0.0405, 1e-12));
ok('ODDLPRICE son faiz >= ödeme → #NUM!', hataMi(h(`=ODDLPRICE(${T(2007, 10, 1)},${T(2008, 6, 15)},${T(2007, 10, 15)},0.0375,0.0405,100,2,0)`), '#NUM!'));

// ================================================================================
// Kayıt
// ================================================================================
const ADLAR = ('PMT IPMT PPMT PV FV NPER RATE NPV IRR XNPV XIRR MIRR CUMIPMT CUMPRINC SLN SYD DB DDB VDB '
  + 'AMORDEGRC AMORLINC EFFECT NOMINAL ISPMT FVSCHEDULE PDURATION RRI DOLLARDE DOLLARFR INTRATE RECEIVED DISC '
  + 'PRICE PRICEDISC PRICEMAT YIELD YIELDDISC YIELDMAT DURATION MDURATION ACCRINT ACCRINTM COUPDAYBS COUPDAYS '
  + 'COUPDAYSNC COUPNCD COUPNUM COUPPCD TBILLEQ TBILLPRICE TBILLYIELD ODDFPRICE ODDFYIELD ODDLPRICE ODDLYIELD').split(' ');
ok('kategorinin 55 işlevi de kayıtlı (' + ADLAR.length + ')', ADLAR.every((a) => X.bilinen(a)),
  '→ eksik: ' + ADLAR.filter((a) => !X.bilinen(a)).join(', '));
ok('_xlfn öneki soyuluyor', yak(h('=_xlfn.PDURATION(0.025,2000,2200)'), 3.8598661626226545));
ok('kaydedilmemiş ad #NAME? verir', hataMi(h('=BOYLEBIRFINANSYOK(1)'), '#NAME?'));

console.log('\nSONUÇ: ' + g + ' geçti, ' + k + ' kaldı');
process.exit(k ? 1 : 0);
