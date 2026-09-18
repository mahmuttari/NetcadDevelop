/*
 * ÜÇ BOYUTLU NESNE YAKALAMA ÇEKİRDEĞİ (viewer/osnap3.js).
 *
 * osnap3.js saf bir modüldür: kamera, WebGL ve DOM bilmez, ekran izdüşümünü bir işlev olarak
 * alır. Bu yüzden tarayıcıya gerek yoktur — modül doğrudan node ile içe aktarılır ve geometrisi
 * sayı sayı sınanır. Burada sınanan şey ARAYÜZ DEĞİL, KARARIN KENDİSİDİR: aynı dokunuşta hangi
 * noktanın kazandığı, yayın merkezinin bulunup bulunmadığı, kapalı yolun son kenarının sayılıp
 * sayılmadığı, dik ayağın parça dışına düştüğünde reddedilip reddedilmediği.
 *
 * Kullanım: node tools/test_osnap3.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checker, projectRoot } from './harness.mjs';

const C = checker(), ok = C.ok;
const V = path.join(projectRoot, 'app', 'src', 'main', 'assets', 'viewer', 'osnap3.js');
const M = await import(pathToFileURL(V).href);

/*
 * İzdüşüm: dünya (x, y, z) → ekran. Üstten bakış gibi davranır (x sağa, y aşağı), kot ekranı
 * etkilemez. Böylece "ekranda yakınlık" sınanabilir ve beklenen piksel elle hesaplanabilir.
 */
const ust = (x, y) => [x, y];
/** Yandan bakış: x sağa, z yukarı — kotu olan noktaların ayrıştığı görünüm */
const yan = (x, y, z) => [x, -z];
const yakin = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const p3e = (p, q, e = 1e-6) => p && q && yakin(p[0], q[0], e) && yakin(p[1], q[1], e) && yakin(p[2], q[2], e);
/** k = 0 yol ilkeli kurar */
const yol = (ops, o = {}) => ({ k: 0, ops, ...o });

// ---- A) primGeom3: işlemlerden parça ve merkez çıkarma --------------------------------------
{
  const p = yol([[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 10, 0]]);
  const g = M.primGeom3(p);
  ok('A1 açık yolda parça sayısı', g.segs.length === 2, `(${g.segs.length})`);
  ok('A1b ilk parça uçları', p3e([g.segs[0][0], g.segs[0][1], g.segs[0][2]], [0, 0, 0]) && p3e([g.segs[0][3], g.segs[0][4], g.segs[0][5]], [10, 0, 0]));

  const k = M.primGeom3(yol([[0, 0, 0, 0], [1, 10, 0, 0], [1, 10, 10, 0]], { closed: true }));
  ok('A2 kapalı yol son kenarı ekler', k.segs.length === 3, `(${k.segs.length})`);
  const son = k.segs[k.segs.length - 1];
  ok('A2b kapanış kenarı başa döner', p3e([son[3], son[4], son[5]], [0, 0, 0]));

  // kot taşıyan üç boyutlu yol: z olduğu gibi gelmeli
  const z = M.primGeom3(yol([[0, 0, 0, 5], [1, 10, 0, 9]]));
  ok('A3 kot taşınır', z.segs.length === 1 && yakin(z.segs[0][2], 5) && yakin(z.segs[0][5], 9));

  // yay: merkez cens'e girer, çevre düzleştirilir
  const y = M.primGeom3(yol([[2, 5, 5, 3, 0, Math.PI, 7]]));
  ok('A4 yay merkezi bulunur', y.cens.length === 1 && p3e(y.cens[0], [5, 5, 7]));
  ok('A4b yay düzleştirilir', y.segs.length >= 8, `(${y.segs.length})`);
  const uc = y.segs[y.segs.length - 1];
  ok('A4c yay son noktası 180°', yakin(uc[3], 2, 1e-9) && yakin(uc[4], 5, 1e-9) && yakin(uc[5], 7));

  ok('A5 yol olmayan ilkel boş döner', M.primGeom3({ k: 2, x: 1, y: 1 }).segs.length === 0);
  ok('A5b null güvenli', M.primGeom3(null).segs.length === 0);
}

// ---- B) perpFoot3: dik ayak ve parça dışı reddi ---------------------------------------------
{
  const a = [0, 0, 0], b = [10, 0, 0];
  ok('B1 dik ayak', p3e(M.perpFoot3([4, 7, 0], a, b), [4, 0, 0]));
  ok('B2 parça dışına düşen ayak reddedilir', M.perpFoot3([-3, 7, 0], a, b) === null);
  ok('B2b öteki uçtan taşan da reddedilir', M.perpFoot3([13, 7, 0], a, b) === null);
  ok('B3 sıfır boylu parça null', M.perpFoot3([1, 1, 1], [2, 2, 2], [2, 2, 2]) === null);
  ok('B4 kotlu dik ayak', p3e(M.perpFoot3([0, 0, 5], [0, 0, 0], [0, 0, 10]), [0, 0, 5]));
}

// ---- C) snap3: kip seçimi ve öncelik ---------------------------------------------------------
{
  const cizgi = yol([[0, 0, 0, 0], [1, 100, 0, 0]]);
  const hepsi = ['end', 'mid', 'cen', 'per', 'nea'];

  const uc = M.snap3([cizgi], ust, 1, 1, { tol: 10, modes: hepsi });
  ok('C1 uca yakın dokunuş UÇ verir', uc && uc.kind === 'end' && p3e(uc.p, [0, 0, 0]));

  const orta = M.snap3([cizgi], ust, 50, 2, { tol: 10, modes: hepsi });
  ok('C2 ortaya yakın dokunuş ORTA verir', orta && orta.kind === 'mid' && p3e(orta.p, [50, 0, 0]));

  const en = M.snap3([cizgi], ust, 30, 3, { tol: 10, modes: hepsi });
  ok('C3 uç / orta uzaktayken EN YAKIN', en && en.kind === 'nea' && p3e(en.p, [30, 0, 0]));

  // Öncelik: dokunuş UÇ ile ORTA arasında eşit uzaklıkta değil ama ikisi de açıklık içinde.
  // Cezalı puan (d + öncelik * tol / 4) UÇ'u biraz geriden de olsa öne alır.
  const iki = yol([[0, 0, 0, 0], [1, 8, 0, 0]]);
  const y1 = M.snap3([iki], ust, 3.6, 0, { tol: 20, modes: ['end', 'mid'] });
  ok('C4 eşite yakın uzaklıkta UÇ, ORTA\'yı yener', y1 && y1.kind === 'end', y1 ? y1.kind : '(yok)');

  // Kip kapalıysa o nokta hiç üretilmez
  const yalnizOrta = M.snap3([cizgi], ust, 1, 1, { tol: 10, modes: ['mid'] });
  ok('C5 kapalı kip aday üretmez', yalnizOrta === null);

  // Açıklık dışı: hiçbir şey
  ok('C6 açıklık dışında null', M.snap3([cizgi], ust, 50, 40, { tol: 10, modes: hepsi }) === null);

  // Merkez
  const daire = yol([[2, 20, 20, 5, 0, 2 * Math.PI, 0]]);
  const mer = M.snap3([daire], ust, 20, 20, { tol: 10, modes: ['cen'] });
  ok('C7 yay / daire MERKEZİ yakalanır', mer && mer.kind === 'cen' && p3e(mer.p, [20, 20, 0]));

  // Dik: taban nokta verilmezse PER üretilmez
  const dikYok = M.snap3([cizgi], ust, 40, 1, { tol: 10, modes: ['per'] });
  ok('C8 taban nokta yoksa DİK yok', dikYok === null);
  const dik = M.snap3([cizgi], ust, 40, 1, { tol: 10, modes: ['per'], prev: [40, 25, 0] });
  ok('C8b taban noktayla DİK ayak', dik && dik.kind === 'per' && p3e(dik.p, [40, 0, 0]));

  // İzdüşümü olmayan (görünmeyen) nokta aday değildir
  const gormez = M.snap3([cizgi], () => null, 0, 0, { tol: 10, modes: hepsi });
  ok('C9 izdüşüm null ise aday yok', gormez === null);

  // Dönen nesne, dokunulan ilkeldir
  ok('C10 kazanan ilkel döner', uc.prim === cizgi);
}

// ---- D) kot: yakınlık EKRANDA ölçülür, dünyada değil ------------------------------------------
{
  // Üstten bakışta üst üste duran iki çizgi (z = 0 ve z = 50); yandan bakışta ayrışırlar.
  const alt = yol([[0, 0, 0, 0], [1, 100, 0, 0]]);
  const ust2 = yol([[0, 0, 0, 50], [1, 100, 0, 50]]);
  const a = M.snap3([alt, ust2], yan, 0, 0, { tol: 10, modes: ['end'] });
  ok('D1 yandan bakışta ekrana yakın olan kazanır (z=0)', a && p3e(a.p, [0, 0, 0]), a ? String(a.p) : '(yok)');
  const b = M.snap3([alt, ust2], yan, 0, -50, { tol: 10, modes: ['end'] });
  ok('D2 kotlu uç ekranda ayrı yerdedir (z=50)', b && p3e(b.p, [0, 0, 50]), b ? String(b.p) : '(yok)');
}

// ---- E) bütçe ve savunma ---------------------------------------------------------------------
{
  const cok = [];
  for (let i = 0; i < 500; i++) cok.push(yol([[0, i, 0, 0], [1, i, 100, 0]]));
  const hepsiVar = M.snap3(cok, ust, 499, 0, { tol: 6, modes: ['end'] });
  ok('E1 bütçe yetince son ilkel de taranır', hepsiVar && yakin(hepsiVar.p[0], 499));
  const kesik = M.snap3(cok, ust, 499, 0, { tol: 6, modes: ['end'], maxWork: 3 });
  ok('E2 bütçe bitince tarama durur', kesik === null);

  ok('E3 kip listesi boşsa null', M.snap3([cizgiVar()], ust, 0, 0, { tol: 10, modes: [] }) === null);
  ok('E4 ilkel listesi dizi değilse null', M.snap3(null, ust, 0, 0, { tol: 10 }) === null);
  ok('E5 izdüşüm işlev değilse null', M.snap3([cizgiVar()], null, 0, 0, { tol: 10 }) === null);
  ok('E6 görünürlük süzgeci uygulanır', M.snap3([cizgiVar()], ust, 0, 0, { tol: 10, modes: ['end'], visible: () => false }) === null);
  function cizgiVar() { return yol([[0, 0, 0, 0], [1, 10, 0, 0]]); }
}

// ---- F) kip listesi ve varsayılanlar ----------------------------------------------------------
{
  ok('F1 beş kip tanımlı', M.MODES3.length === 5);
  ok('F2 öncelik sırası END > MID > CEN > PER > NEA', M.MODES3.map(m => m.id).join(',') === 'end,mid,cen,per,nea');
  ok('F3 öntanımlı kipler', M.DEFAULT_MODES3.join(',') === 'end,mid,cen');
  ok('F4 öncelikler artan', M.MODES3.every((m, i) => m.pri === i));
  // Kipler Set olarak da verilebilmeli (arayüz dizi tutuyor, çekirdek ikisini de almalı)
  const s = M.snap3([yol([[0, 0, 0, 0], [1, 10, 0, 0]])], ust, 0, 0, { tol: 10, modes: new Set(['end']) });
  ok('F5 Set olarak kip listesi', s && s.kind === 'end');
}

C.summary();
C.exit();
