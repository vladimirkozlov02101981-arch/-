'use strict';
/* =========================================================
   Уровни. Все восемь карт нарисованы вручную в итоговых
   координатах и не меняются между раундами. Каждая точка,
   где может стоять боец, проверяется на выход (dev/navcheck.cjs).
   ========================================================= */

/* ---------- заготовки ---------- */
/** тоннель: пол по точкам, потолок на h выше; задняя стена остаётся (вид пещеры) */
function tunnelShape(floor, h = 72, o = {}) {
  const top = floor.map(([x, y], i) => [x, y - h - (o.arch ? Math.sin(i / (floor.length - 1) * Math.PI) * o.arch : 0)]);
  return Sh.cut(Sh.poly(floor.concat(top.reverse()), { rough: o.rough ?? 3 }), !!o.through);
}
/** комната/ниша прямоугольником */
function roomShape(x, y, w, h, through = false) { return Sh.cut(Sh.rect(x, y, w, h), through); }

/** сборщик карты */
function buildLevel(def, fn) {
  const L = { shapes: [], late: [], ladders: [], decor: [], props: [], fixtures: [] };
  const B = {
    W: def.W, H: def.H, water: def.water,
    add(...s) { L.shapes.push(...s.flat()); return B; },
    ground(pts, o) { return B.add(Sh.ground(pts, o)); },
    blob(pts, o) { return B.add(Sh.blob(pts, o)); },
    cave(pts, o = {}) { return B.add(Sh.cut(Sh.blob(pts, Object.assign({ rough: 3 }, o)), !!o.through)); },
    tunnel(floor, h, o) { return B.add(tunnelShape(floor, h, o)); },
    room(x, y, w, h, through) { return B.add(roomShape(x, y, w, h, through)); },
    /** лестница: шахта вырезается в самом конце, поверх всех построек */
    ladder(x, y1, y2) { L.ladders.push({ x, y1, y2 }); L.late.push(Sh.cut(Sh.rect(x - 17, y1 - 30, 34, y2 - y1 + 30))); return B; },
    late(...s) { L.late.push(...s.flat()); return B; },
    decor(...d) { L.decor.push(...d); return B; },
    prop(...p) { L.props.push(...p); return B; },
    fixture(...f) { L.fixtures.push(...f); return B; },
    /** мост-настил (доски/металл), опционально с опорами до воды */
    bridge(x1, y1, x2, y2, o = {}) {
      const mat = o.mat || 'wood', thick = o.thick || 14;
      B.add(Sh.band(x1, y1, x2, y2, { thick, sag: o.sag || 0, mat, pal: o.pal }));
      for (const px of o.posts || []) { const t = (px - x1) / (x2 - x1); const py = y1 + (y2 - y1) * t + (o.sag || 0) * 2 * t * (1 - t) * 2; B.add(Sh.rect(px - 5, py + thick - 2, 10, (o.postTo || def.water + 60) - py, { mat, pal: o.pal })); }
      if (o.rails) L.fixtures.push({ k: 'rail', x1, y1, x2, y2, sag: o.sag || 0, col: o.railCol });
      return B;
    },
    /** здание/башня с этажами изнутри.
        stories — высоты этажей снизу вверх; ladders — x лестниц (отн.) между этажами и на крышу */
    tower(x, gy, w, o = {}) {
      const mat = o.mat || 'brick', pal = o.pal, wall = o.wall ?? 16, slab = o.slab ?? 14;
      const stories = o.stories || [110, 110];
      const h = stories.reduce((a, b) => a + b, 0) + (o.roofSlab ?? slab);
      const top = gy - h;
      B.add(Sh.rect(x, top, w, h + (o.found ?? 60), { mat, pal, back: true }));
      let f = gy; const ls = o.ladders || [];
      stories.forEach((sh, i) => {
        const ceil = f - sh + slab;                 // низ перекрытия над этажом
        if (i === stories.length - 1) { /* верхний этаж: потолок — крыша */ }
        B.room(x + wall, ceil, w - 2 * wall, f - ceil);
        // окна верхних этажей
        if (i > 0 && o.windows !== false) {
          const wy = f - Math.min(52, sh - slab - 8), wh = Math.min(30, sh - slab - 22);
          if (o.windows !== 'right') B.room(x - 1, wy, wall + 2, wh, true);
          if (o.windows !== 'left') B.room(x + w - wall - 1, wy, wall + 2, wh, true);
        }
        const lx = ls[i]; const next = i === stories.length - 1 ? top : f - sh;
        if (lx != null) B.ladder(x + lx, next, f);
        f -= sh;
      });
      // двери первого этажа
      const dh = Math.min(50, stories[0] - slab - 4);
      if (o.doors !== 'right' && o.doors !== 'none') B.room(x - 2, gy - dh, wall + 4, dh);
      if (o.doors !== 'left' && o.doors !== 'none') B.room(x + w - wall - 2, gy - dh, wall + 4, dh);
      if (o.crown) { // зубцы только по краям крыши: пара зубцов с узкой бойницей, середина — ровная площадка
        for (const ex of [x, x + w - 32]) B.add(Sh.rect(ex, top - 18, 13, 19, { mat, pal }), Sh.rect(ex + 19, top - 18, 13, 19, { mat, pal }));
      }
      return top;
    },
  };
  fn(B);
  return Object.assign(def, { shapes: L.shapes.concat(L.late), ladders: L.ladders, decor: L.decor, props: L.props, fixtures: L.fixtures });
}

const P_STONE = { base: '#a09c96', alt: '#b4aea6', mortar: '#2a2b2e', w: 32, h: 16, var: 0.1, tex: 'brick_light' };
const P_TRIM = { base: '#8a8c90', alt: '#7e8084', mortar: '#2a2b2e', w: 32, h: 16, var: 0.06, tex: 'brick_light' };
const P_KEEP = { base: '#5c5f64', alt: '#666a6f', mortar: '#1e1f22', w: 32, h: 16, var: 0.05, tex: 'brick_keep' };
const P_BARN = { base: '#8f4a2e', gap: '#3a1a0e', plank: 9, var: 0.16, tex: 'wood_ship' };

/* =========================================================
   Восточный район (x 4800–6400) — большой интерьер для тактики.
   Мост от старого края, крепость на несколько этажей с перегородками,
   дверями и баррикадами, подвал, подземный ход к бункеру и вышка.
   ========================================================= */
function district(B, o) {
  const gy = o.gy, mat = o.mat, pal = o.pal, X = 5000, Wd = o.w || 760;
  const st = o.stories || [120, 110, 110, 110];
  // фундамент: ровная площадка, на востоке уходит к воде
  // отвесные края: на склонах к воде негде застрять
  B.ground([[4880, 1810], [4884, gy + 26, 1], [4900, gy], [5500, gy], [6262, gy, 1], [6266, gy + 6, 1], [6270, gy + 200], [6280, 1810]], o.ground || {});
  if (o.cut) B.add(...o.cut());
  // мост от старой части карты
  const [bx, by] = o.from, bm = o.bridge || {};
  B.bridge(bx, by, 4906, gy, { mat: bm.mat || 'wood', pal: bm.pal, thick: 14, rails: true, railCol: bm.railCol, posts: bm.posts || [Math.round(bx + (4906 - bx) * 0.5)], postTo: o.water + 40 });
  // крепость: этажи, лестницы попеременно у западной и восточной стены
  const lad = st.map((_, i) => i % 2 ? Wd - 60 : 60);
  B.tower(X, gy, Wd, { mat, pal, stories: st, ladders: lad, crown: o.crown !== false, found: 40 });
  let f = gy;
  st.forEach((h, i) => {
    const ceil = f - h + 14;
    // перегородки с дверными проёмами (укрытие от прямого огня)
    for (const px of [Wd * 0.34, Wd * 0.66]) B.add(Sh.rect(X + Math.round(px), ceil, 14, f - 44 - ceil, { mat, pal }));
    // низкие баррикады, через которые можно перешагнуть
    const bxs = i % 2 ? [Wd * 0.2, Wd * 0.5] : [Wd * 0.48, Wd * 0.82];
    for (const px of bxs) B.add(Sh.rect(X + Math.round(px), f - 12, 36, 12, { mat: o.cover || 'wood', pal: o.coverPal }));
    f -= h;
  });
  // подвал на всю ширину, лестница из центра первого этажа
  B.room(X + 20, gy + 22, Wd - 40, 80);
  B.add(Sh.rect(X + 20, gy + 90, Wd - 40, 14, { mat, pal }));   // мощёный пол подвала, без травы
  B.ladder(X + Math.round(Wd / 2), gy, gy + 102);
  // подземный ход к бункеру и выход на поверхность
  B.tunnel([[X + Wd - 40, gy + 102], [X + Wd + 120, gy + 108], [X + Wd + 240, gy + 110], [X + Wd + 330, gy + 104]], 74, { arch: 6 });
  const bk = X + Wd + 300;
  B.room(bk, gy + 26, 200, 78);
  B.add(Sh.rect(bk, gy + 92, 200, 14, { mat, pal }));
  B.ladder(bk + 150, gy, gy + 104);
  // вышка между крепостью и бункером
  B.tower(X + Wd + 130, gy, 140, { mat: o.tmat || mat, pal: o.tpal || pal, stories: [100, 100, 100], ladders: [30, 110, 30], crown: true, windows: true, found: 20 });
  // окопы и мешки на открытом месте
  B.add(Sh.rect(4950, gy - 14, 44, 14, { mat: o.cover || 'wood', pal: o.coverPal }), Sh.rect(X + Wd + 330, gy - 14, 44, 14, { mat: o.cover || 'wood', pal: o.coverPal }), Sh.rect(X + Wd + 50, gy - 18, 50, 18, { mat, pal }));
  if (o.decor) B.decor(...o.decor);
  if (o.props) B.prop(...o.props);
}


/* =========================================================
   1. Зелёная долина
   ========================================================= */
const MAP_VALLEY = buildLevel({
  id: 'valley', name: 'Зелёная долина', theme: 'valley', W: 6400, H: 1800, water: 1700, seed: 101,
  desc: 'Мельница с тайным погребом, акведук над ущельем, башня и склеп, шахта в Орлиной горе',
}, (B) => {
  // западная бухта, холм с мельницей, фермерская терраса
  B.ground([[-40, 1810], [40, 1716], [160, 1662], [300, 1596], [420, 1520], [540, 1440], [660, 1356], [780, 1284], [900, 1224], [1020, 1180], [1140, 1160], [1260, 1164], [1380, 1196], [1500, 1244], [1620, 1284], [1740, 1300], [1880, 1302], [2040, 1302], [2100, 1310, 1], [2118, 1380], [2124, 1560], [2116, 1790]]);
  // погреб под холмом: вход на склоне, винный зал, выход на террасу, шахта от мельницы
  B.tunnel([[500, 1470], [620, 1474], [800, 1478], [1000, 1472], [1200, 1466], [1380, 1446], [1520, 1402], [1620, 1344], [1700, 1308]], 74, { arch: 12 });
  B.room(1150, 1398, 180, 70);
  B.ladder(1296, 1164, 1470);
  // домик на дереве
  B.add(Sh.rect(608, 1176, 150, 13, { mat: 'wood', pal: PAL.lightWood }), Sh.rect(606, 1150, 8, 27, { mat: 'wood', pal: PAL.lightWood }));
  B.ladder(730, 1176, 1302);
  // амбар с сеновалом
  B.tower(1800, 1302, 190, { mat: 'wood', pal: P_BARN, wall: 12, slab: 12, stories: [86, 70], ladders: [34, null], windows: false, found: 30 });
  B.add(Sh.poly([[1788, 1136], [1895, 1082], [2002, 1136]], { mat: 'wood', pal: P_BARN }));
  // акведук через ущелье: три арки, опоры уходят в реку
  B.add(Sh.rect(2066, 1302, 668, 470, { mat: 'brick', pal: P_STONE }));
  for (const ax of [2206, 2400, 2594]) B.add(Sh.cut(Sh.ellipse(ax, 1640, 76, 296, { rough: 0 }), true));
  for (const px of [2303, 2497]) B.add(Sh.cut(Sh.ellipse(px, 1384, 8, 11, { rough: 0 }), true));
  // центральное плато: башня, руины со склепом, Орлиная гора
  B.ground([[2676, 1790], [2682, 1560], [2688, 1400], [2704, 1318, 1], [2760, 1302], [2860, 1290], [2960, 1266], [3060, 1254], [3180, 1250], [3300, 1256], [3420, 1270], [3540, 1292], [3660, 1296], [3760, 1270], [3860, 1214], [3960, 1150], [4040, 1086], [4120, 1020], [4190, 962], [4260, 916], [4330, 898], [4400, 906], [4480, 944], [4560, 1004], [4630, 1076], [4690, 1150], [4724, 1216, 1], [4744, 1400], [4756, 1600], [4780, 1810]]);
  B.add(Sh.rect(2930, 1262, 150, 30, { mat: 'brick', pal: P_TRIM }));
  B.tower(2940, 1264, 130, { mat: 'brick', pal: P_KEEP, stories: [100, 100, 100, 100], ladders: [34, 96, 34, 96], crown: true });
  // руины часовни: обломки стен как укрытия и склеп под ними
  B.add(Sh.rect(3190, 1206, 18, 50, { mat: 'brick', pal: P_STONE }), Sh.rect(3208, 1206, 40, 14, { mat: 'brick', pal: P_STONE }), Sh.rect(3392, 1222, 18, 36, { mat: 'brick', pal: P_STONE }));
  B.room(3200, 1330, 230, 74);
  B.ladder(3300, 1252, 1404);
  B.tunnel([[3420, 1404], [3500, 1402], [3580, 1392], [3650, 1366], [3720, 1330], [3790, 1306]], 70);
  // шахта: нижний штрек насквозь, верхняя выработка, два ствола
  B.tunnel([[3740, 1308], [3860, 1310], [4000, 1306], [4160, 1302], [4320, 1298], [4460, 1290], [4580, 1278], [4680, 1266], [4760, 1262]], 72, { arch: 8 });
  B.tunnel([[4010, 1110], [4100, 1104], [4220, 1102], [4330, 1104], [4390, 1110]], 76);
  B.ladder(4250, 1102, 1302);
  B.ladder(4352, 900, 1104);
  // укрытия
  B.add(Sh.rect(2800, 1286, 44, 12, { mat: 'wood', pal: P_BARN }), Sh.rect(3560, 1282, 48, 12, { mat: 'wood', pal: P_BARN }));
  B.decor(['oak', 680, null, 2.1], ['pine', 250, null, 0.9], ['oak', 430, null, 1.1], ['windmill', 1110], ['birch', 930, null, 1], ['well', 1470], ['fence', 1600, null, 1], ['haystack', 2040], ['haystack', 1760, null, 0.8],
    ['oak', 2800, null, 1.2], ['pine', 2890, null, 1], ['birch', 3130, null, 1.05], ['column', 3250, null, 0.7], ['oak', 3480, null, 1.5], ['pine', 3700, null, 1.1], ['pine', 3900, null, 1.05], ['pine', 4480, null, 1.15], ['pine', 4600, null, 1]);
  B.prop(['windmill', 1110]);
  district(B, { from: [4700, 1178], gy: 1190, water: 1700, mat: 'brick', pal: P_STONE, bridge: { mat: 'wood', pal: PAL.lightWood }, coverPal: P_BARN, decor: [['pine', 4960, null, 1.1], ['oak', 5880, null, 1.3], ['pine', 6230, null, 1], ['haystack', 6040]], props: [['flag', 5380, 700, { team: 1, h: 46 }], ['torch', 4990, 1190], ['torch', 5770, 1190]] });
});

/* =========================================================
   2. Каньон Сухой Кости
   ========================================================= */
const P_SAND = { base: '#e2b077', alt: '#cf9a62', mortar: '#8a5a32', w: 24, h: 12, var: 0.08 };
const MAP_CANYON = buildLevel({
  id: 'canyon', name: 'Каньон Сухой Кости', theme: 'desert', W: 6400, H: 1800, water: 1700, seed: 202,
  desc: 'Храм в скале, Великая арка над каньоном, расщелина с верёвочным мостом и старая шахта',
}, (B) => {
  // западная столовая гора с храмом и террасами
  B.ground([[-40, 1810], [30, 1690], [58, 1400], [76, 1120], [92, 960, 1], [140, 912], [300, 902], [500, 898], [700, 904], [900, 898], [1100, 902], [1250, 900], [1316, 908, 1], [1334, 1000], [1344, 1128, 1], [1400, 1150], [1520, 1152], [1580, 1156, 1], [1600, 1250], [1612, 1380, 1], [1660, 1400], [1760, 1404], [1840, 1420], [1900, 1466], [1960, 1516], [2060, 1538], [2200, 1546], [2300, 1546], [2346, 1552, 1], [2356, 1700], [2352, 1790]], { mat: 'rock', rough: 4 });
  // храм: нижний зал, верхний зал, крипта, лестницы на плато
  B.room(880, 1070, 470, 80); B.room(940, 960, 330, 70); B.room(1000, 1226, 260, 74);
  B.add(Sh.rect(1300, 1054, 60, 16, { mat: 'brick', pal: P_SAND }), Sh.poly([[1292, 1056], [1332, 1030], [1372, 1056]], { mat: 'brick', pal: P_SAND }));
  B.ladder(990, 1030, 1150); B.ladder(1210, 900, 1030); B.ladder(1130, 1150, 1300);
  B.ladder(1596, 1152, 1400);
  // глиняный дом на плато
  B.tower(420, 900, 150, { mat: 'brick', pal: P_SAND, wall: 14, slab: 14, stories: [88], ladders: [118], windows: false, found: 30 });
  // каньон: расщелина с верёвочным мостом, валуны и брошенная повозка
  B.add(Sh.ellipse(2090, 1548, 40, 14, { mat: 'rock', rough: 2 }), Sh.ellipse(2660, 1542, 34, 12, { mat: 'rock', rough: 2 }));
  B.add(Sh.rect(2900, 1498, 70, 12, { mat: 'wood', pal: PAL.lightWood }));
  // останцы по краям плато — снайперские вышки с лестницами
  B.add(Sh.poly([[66, 970], [78, 800], [90, 720], [110, 690], [146, 694], [162, 730], [172, 820], [182, 910]], { mat: 'rock', rough: 3 }), Sh.ellipse(126, 684, 40, 18, { mat: 'rock', rough: 3 }));
  B.ladder(206, 668, 902);
  B.add(Sh.poly([[4540, 962], [4550, 860], [4562, 780], [4582, 748], [4618, 752], [4630, 790], [4636, 880], [4630, 962]], { mat: 'rock', rough: 3 }), Sh.ellipse(4598, 742, 40, 18, { mat: 'rock', rough: 3 }));
  B.ladder(4516, 726, 956);
  B.bridge(2330, 1548, 2470, 1548, { mat: 'wood', thick: 10, sag: 14, pal: PAL.lightWood, rails: true });
  // Великая арка
  B.add(Sh.band(1236, 904, 3514, 952, { thick: 100, sag: -470, mat: 'rock', rough: 5 }));
  // восточная столовая гора со старой шахтой
  B.ground([[2446, 1790], [2450, 1700], [2456, 1556, 1], [2520, 1546], [2640, 1540], [2780, 1534], [2900, 1512], [2990, 1470], [3070, 1420], [3140, 1374], [3200, 1320], [3240, 1250], [3262, 1170, 1], [3320, 1152], [3420, 1150], [3470, 1146, 1], [3488, 1040], [3500, 962, 1], [3560, 950], [3800, 946], [4000, 950], [4200, 944], [4400, 950], [4560, 958], [4630, 976, 1], [4644, 1100], [4652, 1400], [4660, 1600], [4668, 1810]], { mat: 'rock', rough: 4 });
  B.ladder(3494, 948, 1148);
  B.tunnel([[3440, 1150], [3600, 1152], [3800, 1154], [4000, 1152], [4200, 1150], [4330, 1152]], 76, { arch: 10 });
  B.tunnel([[3150, 1356], [3300, 1360], [3500, 1364], [3700, 1362], [3900, 1358], [4000, 1356]], 72, { arch: 8 });
  B.ladder(3940, 1152, 1358); B.ladder(4260, 946, 1152);
  B.tower(3700, 946, 150, { mat: 'wood', pal: PAL.lightWood, wall: 12, slab: 12, stories: [80], windows: false, found: 30 });
  B.decor(['cactus', 240, null, 1.1], ['watertower', 760], ['cactus', 980, null, 0.9], ['deadtree', 1180, null, 1], ['column', 1310, 1150, 1], ['column', 1270, 1150, 1], ['pot', 1100, 1150], ['pot', 1140, 1150, 0.8], ['skull', 1680, 1400],
    ['cactus', 2100, null, 1], ['skull', 2600, null], ['cactus', 2960, null, 0.9], ['tumbleweed', 2700, null, 1], ['cactus', 3600, null, 1.2], ['deadtree', 4050, null, 0.9], ['watertower', 4450], ['cactus', 4560, null, 0.8]);
  district(B, { from: [4650, 956], gy: 960, water: 1700, mat: 'brick', pal: P_SAND, cut: () => [Sh.cut(Sh.rect(4490, 902, 180, 52))], bridge: { mat: 'wood', pal: PAL.lightWood }, decor: [['cactus', 4970], ['cactus', 6190, null, 1.2], ['skull', 5900]], props: [['torch', 4990, 960], ['torch', 5770, 960]] });
});

/* =========================================================
   3. Ледяной перевал
   ========================================================= */
const P_STATION = { base: '#d8563a', rust: '#7a2a1a', plate: [40, 20] };
const MAP_ARCTIC = buildLevel({
  id: 'arctic', name: 'Ледяной перевал', theme: 'arctic', W: 6400, H: 1800, water: 1700, seed: 303,
  desc: 'Деревня иглу, ледяная пещера сквозь гору, метеостанция на пике, ледник с трещиной и полярная станция',
}, (B) => {
  // деревня иглу и гора с перевалом
  B.ground([[-40, 1810], [58, 1700], [70, 1500], [80, 1340], [96, 1284, 1], [160, 1262], [340, 1254], [540, 1250], [740, 1254], [940, 1262], [1100, 1276], [1200, 1290], [1300, 1308], [1400, 1270], [1500, 1210], [1600, 1140], [1700, 1070], [1800, 1000], [1900, 930], [2000, 856], [2080, 790], [2160, 744], [2240, 732], [2320, 750], [2420, 810], [2520, 880], [2620, 958], [2720, 1036], [2820, 1112], [2920, 1190], [3000, 1250], [3080, 1296], [3160, 1316], [3222, 1332, 1], [3238, 1480], [3244, 1700], [3240, 1810]]);
  // ледяная пещера насквозь, грот и шахта к метеостанции
  B.tunnel([[1150, 1286], [1300, 1334], [1450, 1382], [1650, 1414], [1850, 1424], [2050, 1422], [2250, 1416], [2450, 1402], [2650, 1372], [2800, 1326], [2920, 1284], [3010, 1262]], 92, { arch: 46 });
  B.room(2140, 990, 230, 76);
  B.ladder(2186, 1066, 1418); B.ladder(2344, 752, 1066);
  B.tower(2186, 740, 118, { mat: 'metal', pal: P_STATION, wall: 12, slab: 12, stories: [84], windows: false, found: 40, doors: 'both' });
  // ледник с трещиной и ледяным мостиком
  B.bridge(3200, 1334, 3450, 1326, { mat: 'ice', thick: 16, sag: 22 });
  B.ground([[3396, 1810], [3400, 1700], [3404, 1500], [3412, 1352, 1], [3470, 1326], [3600, 1300], [3700, 1284], [3800, 1256], [3900, 1216], [4000, 1186], [4100, 1172], [4300, 1170], [4500, 1174], [4600, 1192], [4660, 1214], [4690, 1238, 1], [4700, 1400], [4708, 1600], [4716, 1810]], { mat: 'rock', rough: 4 });
  B.blob([[3400, 1356], [3500, 1318], [3640, 1296], [3760, 1272], [3860, 1236], [3900, 1270], [3820, 1330], [3680, 1370], [3520, 1390], [3420, 1400]], { mat: 'ice', rough: 5 });
  // полярная станция: два модуля и переход
  B.tower(3960, 1172, 240, { mat: 'metal', pal: P_STATION, wall: 14, slab: 14, stories: [96, 90], ladders: [40, 206], found: 40 });
  B.room(4184, 1024, 20, 50);
  B.tower(4380, 1172, 200, { mat: 'metal', pal: P_STATION, wall: 14, slab: 14, stories: [100], ladders: [170], found: 40 });
  B.bridge(4196, 1076, 4384, 1058, { mat: 'metal', thick: 10, rails: true, railCol: 'rgba(180,200,220,0.8)' });
  B.add(Sh.ellipse(4060, 960, 46, 34, { mat: 'metal', rough: 0, pal: P_STATION }));
  B.decor(['igloo', 360], ['igloo', 600, null, 0.85], ['snowman', 820], ['pineSnow', 200, null, 1], ['pineSnow', 1000, null, 1.1], ['sled', 480], ['pineSnow', 1350, null, 0.9], ['pineSnow', 1540, null, 1.05], ['iceCrystal', 1900, 1424], ['iceCrystal', 2500, 1402],
    ['pineSnow', 2700, null, 1.1], ['pineSnow', 2860, null, 0.95], ['pineSnow', 3700, null, 1.1], ['antenna', 4480, 1058], ['snowman', 4640, null, 0.9]);
  B.prop(['smoke', 360, null, { dy: -34 }], ['beacon', 4480, 990]);
  district(B, { from: [4660, 1210], gy: 1210, water: 1700, mat: 'metal', pal: P_STATION, cover: 'ice', bridge: { mat: 'metal', pal: PAL.steel, railCol: 'rgba(200,210,220,0.8)' }, decor: [['pine', 4970, null, 1], ['pine', 6220, null, 1.1]], props: [['beacon', 5380, 720]] });
});

/* =========================================================
   4. Жерло вулкана
   ========================================================= */
const MAP_VOLCANO = buildLevel({
  id: 'volcano', name: 'Жерло вулкана', theme: 'volcano', W: 6400, H: 1800, water: 1690, seed: 404,
  desc: 'Обсидиановый храм, мост над лавой, лавовый тоннель и природный мост прямо внутри жерла',
}, (B) => {
  // базальтовое плато с храмом
  B.ground([[-40, 1810], [40, 1700], [60, 1500], [76, 1300], [96, 1100, 1], [160, 1060], [400, 1052], [600, 1048], [800, 1054], [1000, 1062], [1120, 1082], [1200, 1110], [1256, 1150, 1], [1274, 1300], [1284, 1500], [1280, 1810]], { mat: 'basalt', rough: 3 });
  B.tower(520, 1052, 240, { mat: 'brick', pal: PAL.darkStone, stories: [110, 100, 96], ladders: [40, 200, 40], crown: true });
  B.room(560, 1110, 170, 70); B.ladder(700, 1052, 1180);
  // первый лавовый канал: железная эстакада
  B.bridge(1220, 1118, 1660, 1300, { mat: 'metal', thick: 14, pal: PAL.steel, posts: [1440], rails: true, railCol: 'rgba(150,150,160,0.85)' });
  // конус вулкана, жерло и лавовый тоннель с мостом внутри
  B.ground([[1600, 1810], [1606, 1700], [1612, 1500], [1620, 1318, 1], [1640, 1306], [1680, 1300], [1780, 1252], [1880, 1182], [1980, 1112], [2080, 1042], [2180, 962], [2260, 892], [2330, 842], [2372, 826, 1], [2478, 826, 1], [2520, 842], [2590, 892], [2670, 962], [2770, 1042], [2870, 1112], [2970, 1182], [3070, 1252], [3144, 1296, 1], [3160, 1400], [3166, 1600], [3160, 1810]], { rough: 6 });
  B.add(Sh.cut(Sh.poly([[2362, 790], [2488, 790], [2474, 900], [2460, 1100], [2468, 1400], [2476, 1820], [2374, 1820], [2382, 1400], [2390, 1100], [2376, 900]], { rough: 4 })));
  B.add(Sh.band(2330, 1250, 2520, 1250, { thick: 34, mat: 'basalt', rough: 2 }));
  B.tunnel([[1690, 1300], [1800, 1298], [1950, 1290], [2100, 1278], [2250, 1262], [2425, 1252], [2600, 1262], [2750, 1270], [2900, 1262], [3060, 1258]], 72, { arch: 10 });
  B.ladder(2396, 830, 1252);
  // второй канал: природный базальтовый мост
  B.add(Sh.band(3110, 1300, 3470, 1292, { thick: 44, sag: -36, mat: 'basalt', rough: 3 }));
  // базальтовое нагорье с рудником
  B.ground([[3420, 1810], [3426, 1600], [3434, 1400], [3444, 1300, 1], [3500, 1282], [3600, 1252], [3700, 1212], [3800, 1172], [3900, 1152], [4100, 1148], [4300, 1152], [4450, 1160], [4560, 1170], [4640, 1180, 1], [4652, 1300], [4660, 1500], [4668, 1810]], { mat: 'basalt', rough: 3 });
  B.tower(3960, 1150, 220, { mat: 'metal', pal: PAL.steel, wall: 14, slab: 14, stories: [100, 90], ladders: [40, 186], found: 40 });
  B.add(Sh.poly([[4560, 1180], [4566, 1000], [4584, 960], [4620, 956], [4640, 1000], [4652, 1180]], { mat: 'basalt', rough: 1 }));
  B.ladder(4536, 952, 1170);
  B.tunnel([[3500, 1290], [3640, 1330], [3800, 1340], [3960, 1336], [4100, 1330], [4200, 1320]], 70, { arch: 6 });
  B.ladder(4150, 1150, 1322);
  B.decor(['deadtree', 260, null, 1.1], ['spike', 400, null, 1], ['obsidian', 900], ['deadtree', 1060, null, 0.9], ['bones', 1780], ['deadtree', 2000, null, 0.8], ['spike', 2800, null, 1.2], ['deadtree', 2950, null, 0.9], ['obsidian', 3600], ['deadtree', 3760, null, 1], ['bones', 4250], ['spike', 4560, null, 1.1]);
  B.prop(['smoke', 2425, 790, { big: true }], ['torch', 500, 1052], ['torch', 780, 1052], ['torch', 3940, 1150]);
  district(B, { from: [4660, 1160], gy: 1160, water: 1690, mat: 'basalt', cut: () => [Sh.cut(Sh.rect(4535, 1104, 140, 54))], tmat: 'brick', tpal: PAL.darkStone, cover: 'basalt', bridge: { mat: 'metal', pal: PAL.steel, railCol: 'rgba(120,110,110,0.9)' }, props: [['torch', 4990, 1160], ['torch', 5770, 1160], ['fire', 6150, 1160]] });
});

/* =========================================================
   5. Кристальная планета (низкая гравитация)
   ========================================================= */
const MAP_ALIEN = buildLevel({
  id: 'alien', name: 'Кристальная планета', theme: 'alien', W: 6400, H: 1800, water: 1700, seed: 505,
  desc: 'Парящие острова, кристальные мосты, лоза к небесному острову и разбитая летающая тарелка. Низкая гравитация',
}, (B) => {
  B.add(floatIsland(520, 1250, 380, 300), floatIsland(1320, 1130, 250, 250), floatIsland(2250, 1150, 560, 340), floatIsland(2300, 850, 170, 150), floatIsland(3200, 1000, 230, 240), floatIsland(4180, 1150, 420, 320));
  B.bridge(892, 1264, 1082, 1134, { mat: 'crystal', thick: 13 });
  B.bridge(1550, 1140, 1706, 1156, { mat: 'crystal', thick: 13, sag: 12 });
  B.bridge(2794, 1156, 2986, 1008, { mat: 'crystal', thick: 13 });
  B.bridge(3416, 1006, 3776, 1158, { mat: 'crystal', thick: 13, sag: 20 });
  B.ladder(2240, 842, 1144);
  // разбитая тарелка: корпус, купол, отсек с ровным полом
  B.add(Sh.ellipse(2520, 1122, 236, 62, { mat: 'metal', rot: -0.04, rough: 0, pal: PAL.ufoMetal }), Sh.ellipse(2512, 1070, 92, 46, { mat: 'crystal', rot: -0.04, rough: 0 }));
  B.room(2270, 1094, 500, 52);
  // кристальные шпили по краям островов
  B.add(spire(4592, 1166, 170, 44, 12));
  B.decor(['alientree', 560, null, 1.6], ['tentacle', 700], ['alienplant', 1320], ['crystalBig', 190, null, 1.1], ['pod', 1850], ['alientree', 2050, null, 2.2], ['pod', 2860], ['crystalBig', 3200, null, 0.9], ['alientree', 4050, null, 1.3], ['tentacle', 4300], ['alienplant', 380]);
  B.prop(['beacon', 2440, 1050], ['beacon', 2600, 1034]);
  B.decor(['glassdome', 2512, 1070, 1, false, [92, 46, -0.04]]);
  district(B, { from: [4560, 1150], gy: 1150, water: 1700, mat: 'metal', pal: PAL.ufoMetal, cover: 'crystal', bridge: { mat: 'crystal' }, cut: () => [Sh.cut(Sh.rect(4540, 960, 130, 186))], decor: [['crystalBig', 4960, null, 0.9], ['alientree', 6200, null, 1.4], ['alienplant', 5900]], props: [['beacon', 5380, 690], ['beacon', 6100, 1150]] });
});

/* =========================================================
   6. Пиратская бухта
   ========================================================= */
const P_LIGHT = { base: '#e9e4d8', alt: '#d6cfbf', mortar: '#9a9282', w: 22, h: 11, var: 0.06 };
const P_RED = { base: '#c0392b', alt: '#a93226', mortar: '#6e1d16', w: 22, h: 11, var: 0.06 };
const MAP_PIRATE = buildLevel({
  id: 'pirate', name: 'Пиратская бухта', theme: 'tropical', W: 6400, H: 1800, water: 1690, seed: 606,
  desc: 'Форт на утёсе, пристань, галеон с трюмом и вороньим гнездом, скала-череп с пещерой сокровищ и маяк',
}, (B) => {
  // западный остров: форт, джунгли, пляж
  B.ground([[-40, 1810], [40, 1700], [70, 1560], [90, 1400], [110, 1290, 1], [180, 1262], [320, 1252], [480, 1248], [640, 1252], [780, 1262], [880, 1290], [960, 1340], [1040, 1400], [1110, 1458], [1180, 1516], [1250, 1566], [1300, 1594], [1330, 1604, 1], [1342, 1700], [1348, 1810]]);
  B.tower(300, 1252, 130, { mat: 'wood', pal: PAL.shipWood, wall: 12, slab: 12, stories: [96, 90], ladders: [30, 100], found: 40, crown: true });
  B.tower(560, 1250, 150, { mat: 'wood', pal: PAL.lightWood, wall: 12, slab: 12, stories: [84], windows: false, found: 30 });
  B.add(Sh.poly([[548, 1156], [635, 1112], [722, 1156]], { mat: 'wood', pal: PAL.lightWood }));
  // пристань
  B.bridge(1290, 1598, 1470, 1598, { mat: 'wood', thick: 12, pal: PAL.lightWood, posts: [1330, 1420] });
  // галеон: корпус, ют с каютой, бак, орудийная палуба, трюм, воронье гнездо, бушприт
  B.blob([[1470, 1388, 1], [1700, 1392], [2100, 1396], [2500, 1394], [2740, 1386], [2880, 1350, 1], [2860, 1450], [2790, 1570], [2660, 1700], [2400, 1776], [2000, 1790], [1660, 1756], [1520, 1680], [1474, 1560], [1462, 1460]], { mat: 'wood', rough: 0, pal: PAL.shipWood, back: true });
  B.add(Sh.rect(1462, 1298, 234, 94, { mat: 'wood', pal: PAL.shipWood, back: true }), Sh.rect(2640, 1336, 214, 56, { mat: 'wood', pal: PAL.shipWood, back: true }));
  B.room(1480, 1316, 176, 74); B.room(1650, 1340, 50, 50);
  for (let k = 0; k < 3; k++) B.room(1500 + k * 52, 1330, 16, 18, true);
  B.room(1700, 1420, 940, 70); B.room(1550, 1520, 1100, 76); B.room(1440, 1540, 130, 56);
  B.ladder(1716, 1300, 1392); B.ladder(1830, 1392, 1490); B.ladder(2330, 1392, 1490); B.ladder(2560, 1490, 1596); B.ladder(2618, 1338, 1392);
  B.add(Sh.rect(2104, 1116, 92, 12, { mat: 'wood', pal: PAL.lightWood }));
  B.ladder(2170, 1116, 1392);
  B.add(Sh.band(2860, 1346, 3010, 1286, { thick: 10, mat: 'wood', pal: PAL.lightWood }));
  B.add(Sh.cut(Sh.ellipse(2230, 1690, 40, 34, { rough: 6 }), true));
  // верёвочный мост с бака на скалу
  B.bridge(2846, 1338, 3070, 1334, { mat: 'wood', thick: 10, sag: 26, pal: PAL.lightWood, rails: true });
  // скала-череп: пасть-пещера, глазницы, нос, лестницы
  B.ground([[2990, 1810], [2996, 1700], [3004, 1500], [3012, 1360, 1], [3060, 1338], [3130, 1330], [3190, 1320, 1], [3204, 1200], [3226, 1100], [3262, 1010], [3310, 940], [3380, 888], [3460, 858], [3560, 846], [3660, 850], [3760, 870], [3840, 910], [3900, 956], [3960, 992], [4060, 1002], [4200, 1004], [4320, 1002], [4420, 1012], [4520, 1042], [4600, 1090], [4650, 1130, 1], [4660, 1300], [4668, 1500], [4676, 1810]], { mat: 'rock', rough: 5 });
  B.cave([[3170, 1332], [3300, 1334], [3500, 1336], [3700, 1332], [3830, 1316], [3850, 1240], [3780, 1190], [3620, 1172], [3440, 1170], [3280, 1182], [3190, 1210], [3166, 1270]], { rough: 4 });
  for (const tx of [3236, 3292, 3350]) B.add(Sh.poly([[tx - 9, 1176], [tx + 9, 1176], [tx, 1206]], { mat: 'rock' }));
  B.room(3370, 1000, 120, 60); B.room(3590, 1000, 120, 60);
  B.add(Sh.cut(Sh.ellipse(3430, 1004, 62, 40, { rough: 3 }), true), Sh.cut(Sh.ellipse(3650, 1004, 62, 40, { rough: 3 }), true));
  B.add(Sh.rect(3370, 1060, 120, 14, { mat: 'rock' }), Sh.rect(3590, 1060, 120, 14, { mat: 'rock' }));
  B.add(Sh.cut(Sh.poly([[3540, 1090], [3570, 1090], [3555, 1122]]), true));
  B.ladder(3470, 1060, 1334); B.ladder(3610, 1060, 1334); B.ladder(3690, 850, 1060);
  // маяк
  B.tower(4140, 1004, 120, { mat: 'brick', pal: P_LIGHT, stories: [100, 96, 96, 90], ladders: [30, 90, 30, 90], found: 40 });
  for (const sy of [930, 740]) B.add({ kind: 'poly', pts: [[4130, sy], [4270, sy], [4270, sy + 40], [4130, sy + 40]], op: 'paint', mat: 'brick', pal: P_RED, rough: 0, params: { x0: 4130, y0: sy, w: 140, h: 40 } });
  B.decor(['palm', 220, null, 1.1], ['palm', 480, null, 1.3], ['palm', 760, null, 0.9], ['chest', 700], ['palm', 930, null, 1.2], ['barrel', 1600, 1392], ['barrel', 1624, 1392, 0.9], ['mast', 1850, 1392, 1.15], ['mast', 2150, 1392, 1.3], ['mast', 2470, 1392, 1.1], ['barrel', 2000, 1596], ['chest', 3600, 1334], ['chest', 3520, 1334, 0.8], ['palm', 3980, null, 1.1], ['palm', 4400, null, 1], ['palm', 4560, null, 0.9]);
  B.prop(['flag', 2150, 1116, { h: 150, color: '#111', skull: true }], ['torch', 1250, 1566], ['torch', 3200, 1330], ['torch', 3820, 1320], ['beacon', 4200, 596]);
  district(B, { from: [4660, 1135], gy: 1140, water: 1690, mat: 'wood', pal: PAL.shipWood, tmat: 'brick', tpal: P_LIGHT, cover: 'wood', bridge: { mat: 'wood', pal: PAL.lightWood }, decor: [['palm', 4980, null, 1.1], ['palm', 6220, null, 1.2], ['barrel', 5900]], props: [['torch', 4990, 1140], ['torch', 5770, 1140], ['flag', 5380, 650, { team: 1, h: 46 }]] });
});

/* =========================================================
   7. Два замка
   ========================================================= */
function castle(B, x0, flip, pal) {
  const X = (x, w) => flip ? 2 * x0 + 1000 - x - w : x;           // зеркало в пределах 1000 px
  const L = (w, lx) => lx == null ? null : (flip ? w - lx : lx);
  const T = (x, w, o) => B.tower(X(x, w), 1148, w, Object.assign({}, o, { mat: 'brick', pal, ladders: (o.ladders || []).map(v => L(w, v)) }));
  T(x0 + 50, 200, { stories: [110, 100, 100, 100], ladders: [30, 170, 30, 170], crown: true });      // донжон
  T(x0 + 250, 400, { stories: [126], ladders: [200], crown: true, windows: false });                 // стена-галерея
  T(x0 + 650, 160, { stories: [110, 100], ladders: [30, 130], crown: true });                        // надвратная башня
  B.room(X(x0 + 70, 160), 1190, 160, 70); B.ladder(X(x0 + 150, 0), 1148, 1260);                     // подземелье
  const tx = (x) => flip ? 2 * x0 + 1000 - x : x;
  const pts = [[x0 + 230, 1260], [x0 + 550, 1266], [x0 + 850, 1276], [x0 + 1150, 1300], [x0 + 1350, 1326], [x0 + 1510, 1346], [x0 + 1590, 1364]].map(([x, y]) => [tx(x), y]);
  B.tunnel(flip ? pts.reverse() : pts, 72, { arch: 8 });
}
const MAP_CASTLES = buildLevel({
  id: 'castles', name: 'Два замка', theme: 'castle', W: 6400, H: 1800, water: 1700, seed: 707,
  desc: 'Замки с донжонами и подземельями, галереи на стенах, подкопы к реке и каменный мост',
}, (B) => {
  B.ground([[-40, 1810], [40, 1700], [70, 1500], [90, 1300], [110, 1180, 1], [180, 1158], [300, 1150], [500, 1148], [700, 1148], [900, 1148], [1100, 1150], [1300, 1156], [1420, 1170], [1540, 1200], [1660, 1250], [1760, 1310], [1860, 1380], [1960, 1440], [2060, 1480], [2140, 1500], [2182, 1508, 1], [2196, 1600], [2200, 1810]]);
  B.ground([[2600, 1810], [2604, 1600], [2618, 1508, 1], [2660, 1500], [2740, 1480], [2840, 1440], [2940, 1380], [3040, 1310], [3140, 1250], [3260, 1200], [3380, 1170], [3500, 1156], [3700, 1150], [3900, 1148], [4100, 1148], [4300, 1148], [4500, 1150], [4620, 1158], [4690, 1180, 1], [4710, 1300], [4730, 1500], [4760, 1700], [4840, 1810]]);
  castle(B, 250, false, PAL.castleStone);
  castle(B, 3550, true, PAL.castleStone);
  // таверны у ворот
  B.tower(1140, 1152, 150, { mat: 'wood', pal: PAL.lightWood, wall: 12, slab: 12, stories: [86, 72], ladders: [30], windows: false, found: 30 });
  B.add(Sh.poly([[1128, 984], [1215, 936], [1302, 984]], { mat: 'wood', pal: PAL.shipWood }));
  B.tower(3510, 1154, 150, { mat: 'wood', pal: PAL.lightWood, wall: 12, slab: 12, stories: [86, 72], ladders: [120], windows: false, found: 30 });
  B.add(Sh.poly([[3498, 986], [3585, 938], [3672, 986]], { mat: 'wood', pal: PAL.shipWood }));
  // каменный мост через реку
  B.add(Sh.rect(2150, 1504, 500, 300, { mat: 'brick', pal: PAL.castleStone }));
  B.add(Sh.cut(Sh.ellipse(2400, 1800, 214, 262, { rough: 0 }), true));
  B.decor(['oak', 150, null, 1], ['pine', 1400, null, 1.1], ['oak', 1560, null, 1.2], ['cottage', 1720], ['haystack', 1850], ['oak', 1990, null, 1], ['oak', 2820, null, 1.1], ['cottage', 3000], ['pine', 3300, null, 1.1], ['oak', 4660, null, 1],
    ['banner', 400, 900, 1, false, { col: '#b0413a' }], ['banner', 4400, 900, 1, false, { col: '#3a5ab0' }]);
  B.prop(['flag', 400, 724, { team: 0, h: 50 }], ['flag', 980, 920, { team: 0 }], ['flag', 4400, 724, { team: 1, h: 50 }], ['flag', 3820, 920, { team: 1 }], ['torch', 1080, 1148], ['torch', 3720, 1148], ['smoke', 1250, 960, { dy: 0 }], ['smoke', 3550, 962, { dy: 0 }]);
  district(B, { from: [4696, 1182], gy: 1182, water: 1700, mat: 'brick', pal: PAL.castleStone, bridge: { mat: 'wood', pal: PAL.lightWood }, decor: [['oak', 4970, null, 1], ['pine', 6220, null, 1.1], ['haystack', 5900]], props: [['flag', 5380, 690, { team: 1, h: 50 }], ['torch', 4990, 1182], ['torch', 5770, 1182]] });
});

/* =========================================================
   8. Ночной мегаполис
   ========================================================= */
// фасады ночного города светлее исходного тона — здания читаются на фоне ночного неба
const liftHex = (h, k) => '#' + [1, 3, 5].map(i => Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * k + 14)).toString(16).padStart(2, '0')).join('');
const P_TOWER = (base, win, lit) => ({ base: liftHex(base, 1.55), win, dark: '#1a2238', lit });
const MAP_CITY = buildLevel({
  id: 'city', name: 'Ночной мегаполис', theme: 'city', W: 6400, H: 1800, water: 1700, seed: 808,
  desc: 'Дома с этажами и крышами, парковка, эстакада над каналом, метро и небоскрёб-вышка',
}, (B) => {
  B.ground([[-40, 1810], [30, 1700], [40, 1522, 1], [60, 1500, 1], [2200, 1500, 1], [2220, 1522, 1], [2226, 1810]], { rough: 0 });
  B.ground([[2574, 1810], [2580, 1522, 1], [2600, 1500, 1], [4740, 1500, 1], [4760, 1522, 1], [4770, 1700], [4840, 1810]], { rough: 0 });
  // метро под обоими кварталами
  B.room(300, 1552, 1700, 90); B.ladder(345, 1500, 1642); B.ladder(1540, 1500, 1642);
  B.room(2800, 1552, 1700, 90); B.ladder(2915, 1500, 1642); B.ladder(4200, 1500, 1642);
  const house = (x, w, n, st, lad) => B.tower(x, 1500, w, { mat: 'concrete', pal: st, wall: 14, slab: 14, stories: [100, ...Array(n - 1).fill(96)], ladders: Array.from({ length: n }, (_, i) => i % 2 ? w - lad : lad), found: 6 });
  house(90, 220, 4, P_TOWER('#3a4150', '#ffd27a', 0.4), 30);
  house(380, 240, 6, P_TOWER('#2b3140', '#9fe0ff', 0.35), 30);
  house(690, 180, 2, P_TOWER('#4a4038', '#ffb86b', 0.5), 30);
  house(940, 280, 5, P_TOWER('#34384a', '#ff9ce0', 0.3), 30);
  house(1300, 200, 3, P_TOWER('#3c3a4a', '#ffcf70', 0.4), 30);
  // парковка: открытые перекрытия
  for (const y of [1420, 1340, 1260]) B.add(Sh.rect(1580, y, 380, 14, { mat: 'concrete', pal: { base: '#5a5e66', road: true } }));
  B.ladder(1606, 1420, 1500); B.ladder(1934, 1340, 1420); B.ladder(1606, 1260, 1340);
  // эстакада над каналом
  B.add(Sh.rect(1480, 1194, 1200, 26, { mat: 'concrete', pal: { base: '#5a5e66', road: true } }));
  for (const px of [2290, 2490]) B.add(Sh.rect(px, 1220, 34, 560, { mat: 'concrete', pal: { base: '#55595f' } }));
  B.fixture({ k: 'rail', x1: 1480, y1: 1194, x2: 2680, y2: 1194, sag: 0, col: 'rgba(150,160,180,0.8)' });
  // восточный квартал
  house(2640, 240, 3, P_TOWER('#303848', '#ffd27a', 0.4), 30);
  house(2950, 200, 2, P_TOWER('#46403e', '#ffe0a0', 0.45), 30);
  house(3220, 300, 8, P_TOWER('#262c3c', '#8fe8ff', 0.35), 36);
  house(3600, 220, 4, P_TOWER('#3c3a4a', '#ffcf70', 0.4), 30);
  house(3900, 260, 5, P_TOWER('#2e3446', '#ff9ce0', 0.3), 30);
  house(4240, 220, 3, P_TOWER('#3a3f4c', '#9fe0ff', 0.4), 30);
  B.decor(['lamp', 340], ['car', 650, 1500], ['lamp', 900], ['planter', 1260], ['car', 1720, 1500, 1, true], ['lamp', 2160], ['lamp', 2620], ['car', 2920, 1500], ['planter', 3570], ['lamp', 3880], ['car', 4180, 1500, 0.9, true], ['lamp', 4520], ['bench', 4620],
    ['antenna', 3370, 714], ['billboard', 1080, 994], ['billboard', 4030, 1002], ['antenna', 500, 906]);
  B.prop(['lamp', 340], ['lamp', 900], ['lamp', 2160], ['lamp', 2620], ['lamp', 3880], ['lamp', 4520], ['beacon', 3370, 640], ['beacon', 500, 840], ['neon', 1080, 960, { text: 'ПИЦЦА', color: '#ff4fa8' }], ['neon', 4030, 968, { text: 'КИНО', color: '#4ff0ff' }], ['fire', 2100, 1500]);
  district(B, { from: [4750, 1500], gy: 1500, water: 1700, mat: 'concrete', pal: P_TOWER('#2e3446', '#ffd27a', 0.4), crown: false, cover: 'metal', coverPal: PAL.steel, bridge: { mat: 'concrete', pal: { base: '#5a5e66', road: true }, railCol: 'rgba(150,160,180,0.8)' }, ground: { rough: 0 }, decor: [['lamp', 4960], ['car', 5900, 1500], ['lamp', 6200], ['bench', 6120]], props: [['lamp', 4960], ['lamp', 6200], ['beacon', 5380, 1010]] });
});

const MAPS = [MAP_VALLEY, MAP_CANYON, MAP_ARCTIC, MAP_VOLCANO, MAP_ALIEN, MAP_PIRATE, MAP_CASTLES, MAP_CITY];
const MAP_BY_ID = Object.fromEntries(MAPS.map(m => [m.id, m]));

/* ---------- лестницы, перила и прочая «арматура» поверх земли ---------- */
function drawTacticalRoutes(c, map) {
  c.save();
  for (const f of map.fixtures || []) {
    if (f.k === 'rail') {
      c.strokeStyle = f.col || 'rgba(60,40,24,0.9)'; c.lineWidth = 2;
      const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2 + f.sag;
      c.beginPath(); c.moveTo(f.x1, f.y1 - 16); c.quadraticCurveTo(cx, cy - 16, f.x2, f.y2 - 16); c.stroke();
    }
  }
  const kind = map.theme === 'city' ? 'steelY' : map.theme === 'alien' ? 'steel' : 'wood';
  for (const { x, y1, y2 } of map.ladders || []) { const L = ladderSprite(Math.round(y2 - y1 + 12), kind); c.drawImage(L, x - 14, y1 - 12); }
  c.restore();
}

/** реалистичная лестница (кэш по высоте и виду): две тетивы с объёмом и волокнами, круглые перекладины с тенью,
    металлические скобы крепления, тень на стене. wood — дерево, steel — сталь, steelY — сталь с жёлтой краской (город) */
const _ladderCache = new Map();
function ladderSprite(h, kind) {
  const key = kind + h; let cv = _ladderCache.get(key); if (cv) return cv;
  cv = makeCanvas(28, h + 4); const c = cv.getContext('2d');
  const P = kind === 'wood' ? { hi: '#d8a86a', mid: '#9a6a3c', lo: '#5a3a1e', rung: ['#e2b87c', '#a8763f', '#6a4424'] }
    : kind === 'steelY' ? { hi: '#ffe27a', mid: '#e0b020', lo: '#8a6408', rung: ['#ffe68c', '#d4a41c', '#7a5806'] }
    : { hi: '#e2e6ee', mid: '#8a929e', lo: '#3e444e', rung: ['#eef0f4', '#9aa2ae', '#4a505a'] };
  // тень на стене за лестницей
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(7, 3, 3, h); c.fillRect(22, 3, 3, h);
  for (let y = 10; y < h - 2; y += 12) c.fillRect(8, y + 3, 16, 2.5);
  // перекладины: цилиндр — светлый верх, тёмный низ, торцы уходят в тетиву
  for (let y = 8; y < h - 2; y += 12) {
    const g = c.createLinearGradient(0, y - 1.6, 0, y + 1.6); g.addColorStop(0, P.rung[0]); g.addColorStop(0.45, P.rung[1]); g.addColorStop(1, P.rung[2]);
    c.fillStyle = g; c.fillRect(6, y - 1.6, 16, 3.2);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(6, y + 1.2, 16, 0.6);
    if (kind === 'wood') { c.fillStyle = 'rgba(60,36,16,0.6)'; c.fillRect(9 + ((y * 7) % 9), y - 0.5, 2, 1); }   // потёртость от ботинок
  }
  // тетивы: объёмные бруски
  for (const x0 of [3, 21]) {
    const g = c.createLinearGradient(x0, 0, x0 + 4, 0); g.addColorStop(0, P.lo); g.addColorStop(0.3, P.hi); g.addColorStop(0.7, P.mid); g.addColorStop(1, P.lo);
    c.fillStyle = g; c.fillRect(x0, 0, 4, h);
    if (kind === 'wood') {   // волокна и сучки
      c.strokeStyle = 'rgba(70,40,18,0.35)'; c.lineWidth = 0.5;
      for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x0 + 1 + k, 0); for (let y = 0; y < h; y += 8) c.lineTo(x0 + 1 + k + Math.sin(y * 0.07 + k * 2 + x0) * 0.4, y); c.stroke(); }
      for (let y = 30 + x0 * 3; y < h; y += 97) { c.fillStyle = 'rgba(60,34,14,0.7)'; c.beginPath(); c.ellipse(x0 + 2, y, 1.2, 2.2, 0, 0, TAU); c.fill(); }
    } else {   // краска облупилась: пятна голого металла
      for (let y = 14 + x0; y < h; y += 41) { c.fillStyle = 'rgba(90,90,96,0.7)'; c.fillRect(x0 + 1, y, 2, 3); }
    }
  }
  // стальные скобы крепления к стене
  for (let y = 20; y < h - 10; y += 60) for (const x0 of [3, 21]) { c.fillStyle = '#4a4e56'; c.fillRect(x0 - 1, y, 6, 3); c.fillStyle = '#9aa0aa'; c.fillRect(x0 - 1, y, 6, 1); c.fillStyle = '#2a2c30'; c.fillRect(x0 + 1.5, y + 0.8, 1, 1.2); }
  _ladderCache.set(key, cv); return cv;
}
