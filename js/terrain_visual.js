'use strict';
/** прожилки: билинейная выборка сетки 4×4 px — гладкие края вместо «лесенки» */
/** крупномасштабный шум: билинейная выборка тайла с шагом 2^sh px (без ступенек) */
function tileAt(t, x, y, sh, ox = 0) {
  const k = 1 << sh, fx = x / k - 0.5 + ox, fy = y / k - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const r0 = (y0 & 255) << 8, r1 = ((y0 + 1) & 255) << 8, c0 = x0 & 255, c1 = (x0 + 1) & 255;
  return (t[r0 | c0] * (1 - ax) + t[r0 | c1] * ax) * (1 - ay) + (t[r1 | c0] * (1 - ax) + t[r1 | c1] * ax) * ay;
}
function veinAt(tv, x, y) {
  const fx = x / 4 - 0.5, fy = y / 4 - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const r0 = (y0 & 255) << 8, r1 = ((y0 + 1) & 255) << 8, c0 = x0 & 255, c1 = (x0 + 1) & 255;
  return (tv[r0 | c0] * (1 - ax) + tv[r0 | c1] * ax) * (1 - ay) + (tv[r1 | c0] * (1 - ax) + tv[r1 | c1] * ax) * ay;
}
/* =========================================================
   Текстурирование карты в духе мультфильмов с компьютерной
   графикой: мягкие объёмные фаски (тёплый ключевой свет сверху
   слева, холодные тени, контровой ободок), затенение впадин,
   крупные скруглённые камни и плиты, толстая трава с тенью
   под «губой», задние стены пещер и комнат
   ========================================================= */
const MAT_DEFAULT = {
  brick: { base: '#9a9ca6', alt: '#858893', mortar: '#4b4d56', w: 20, h: 10, var: 0.09 },
  wood: { base: '#8a5a32', gap: '#2a160a', plank: 8, var: 0.16 },
  concrete: { base: '#4a4f58' },
  metal: { base: '#8a92a0', rust: '#8a4a2a', plate: [30, 16] },
  crystal: { a: '#5ff4ff', b: '#b86cff' },
};
/** направление на ключевой свет (сверху слева, чуть к зрителю) */
const LIGHT = (() => { const x = -0.52, y = -0.78, z = 0.6, l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; })();

/* ---------- ячеистые тайлы (Вороной): камни в земле, плиты скал ---------- */
let _vor = null;
function getVoronoi() {
  if (_vor) return _vor;
  const make = (N, cell, seed) => {
    const n = N / cell, px = new Float32Array(n * n), py = new Float32Array(n * n), rnd = new Float32Array(n * n), rnd2 = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      px[k] = (i + 0.2 + hash3(i, j, seed) * 0.6) * cell; py[k] = (j + 0.2 + hash3(i, j, seed + 1) * 0.6) * cell;
      rnd[k] = hash3(i, j, seed + 2); rnd2[k] = hash3(i, j, seed + 3);
    }
    const ed = new Uint8Array(N * N), id = new Uint16Array(N * N), vx = new Int8Array(N * N), vy = new Int8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
      let d1 = 1e9, d2 = 1e9, best = 0, bx = 0, by = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        let ii = ci + di, jj = cj + dj, ox = 0, oy = 0;
        if (ii < 0) { ii += n; ox = -N; } else if (ii >= n) { ii -= n; ox = N; }
        if (jj < 0) { jj += n; oy = -N; } else if (jj >= n) { jj -= n; oy = N; }
        const k = jj * n + ii, qx = px[k] + ox - x, qy = py[k] + oy - y, d = qx * qx + qy * qy;
        if (d < d1) { d2 = d1; d1 = d; best = k; bx = qx; by = qy; } else if (d < d2) d2 = d;
      }
      const i = y * N + x;
      ed[i] = Math.min(255, (Math.sqrt(d2) - Math.sqrt(d1)) * 8); id[i] = best;
      vx[i] = clamp(Math.round(bx * 2), -127, 127); vy[i] = clamp(Math.round(by * 2), -127, 127);
    }
    return { N, cell, ed, id, vx, vy, rnd, rnd2, mask: N - 1, sh: Math.log2(N) };
  };
  _vor = { s: make(256, 32, 901), l: make(512, 64, 907) };
  return _vor;
}

/* ---------- размытие (скользящее окно) ---------- */
function boxBlurU8(a, W, H, r) {
  const tmp = new Uint8Array(Math.max(W, H)), d = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W; let s = 0;
    for (let k = -r; k <= r; k++) s += a[o + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) { tmp[x] = (s / d) | 0; s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
    a.set(tmp.subarray(0, W), o);
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) { tmp[y] = (s / d) | 0; s += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x]; }
    for (let y = 0, i = x; y < H; y++, i += W) a[i] = tmp[y];
  }
}
function boxBlurF32(a, W, H, r) {
  const tmp = new Float32Array(Math.max(W, H)), d = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W; let s = 0;
    for (let k = -r; k <= r; k++) s += a[o + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) { tmp[x] = s / d; s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
    a.set(tmp.subarray(0, W), o);
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += a[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) { tmp[y] = s / d; s += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x]; }
    for (let y = 0, i = x; y < H; y++, i += W) a[i] = tmp[y];
  }
}

/** камень в толще земли: неровный контур, грани, мягкий свет сверху слева, тусклый тёплый блик,
    тёплый отсвет почвы снизу и контактная тень. Меняет o.r/o.g/o.b (вне камня — только тень) */
function stoneAt(S, o, ox, oy, rad, ph, pc, n1, n2, r, g, bl) {
  const a = Math.atan2(oy, ox);
  const irr = S.smoothStones ? 0.4 : 1;
  const R = rad * (1 + irr * (0.14 * Math.sin(3 * a + ph) + 0.08 * Math.sin(5 * a + ph * 1.7) + 0.04 * Math.sin(9 * a + ph * 2.3)));
  const e = Math.sqrt(ox * ox + oy * oy) / R;
  if (e < 1 && S.smoothStones) {
    // обкатанный валун как в мультфильме: гладкая сфера, тёмный тон, яркий резкий блик сверху слева, отсвет земли снизу
    const nx = ox / R, ny = oy / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const lam = nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z;
    let f = 0.66 + 0.95 * Math.max(0, lam) + (n1 - 0.5) * 0.08;
    const so = S.soil, lo = ny > 0.2 ? (ny - 0.2) * 0.5 : 0;
    let rr = (pc[0] * (1 - lo) + so[0] * 1.3 * lo) * f, gg = (pc[1] * (1 - lo) + so[1] * 1.1 * lo) * f, bb = (pc[2] * (1 - lo) + so[2] * 0.9 * lo) * f;
    const hx = nx + 0.36, hy = ny + 0.42, hs = hx * hx + hy * hy;
    if (hs < 0.05) { const k = (1 - hs / 0.05); rr += k * k * 190; gg += k * k * 186; bb += k * k * 176; }                  // резкий блик
    else if (hs < 0.2) { const k = (1 - hs / 0.2) * 0.35; rr += k * 60; gg += k * 58; bb += k * 52; }                       // мягкий ореол блика
    if (e > 0.9) { const k = 0.78 + (1 - e) * 2.2; rr *= k; gg *= k; bb *= k; }
    if (S.rimCol && e > 0.78 && ny < -0.2) { const q = Math.min(1, (e - 0.78) / 0.14) * 0.6; rr += (S.rimCol[0] - rr) * q; gg += (S.rimCol[1] - gg) * q; bb += (S.rimCol[2] - bb) * q; }   // цветной ободок (кристальная планета)
    o.r = rr; o.g = gg; o.b = bb; return;
  }
  if (e < 1) {
    // грань: сектор по углу — плоская площадка с собственной нормалью, вершина плоская
    const nf = 5 + ((ph * 3) % 3 | 0), sec = Math.floor((a + Math.PI + ph) / TAU * nf), ca = (sec + 0.5) / nf * TAU - Math.PI - ph;
    const k = e < 0.3 ? e * 0.9 : Math.min(0.92, 0.27 + (e - 0.3) * 1.1);
    const nx = Math.cos(ca) * k * 0.6 + (ox / R) * 0.4, ny = Math.sin(ca) * k * 0.6 + (oy / R) * 0.4, nz = Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny));
    const lam = nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z;
    let f = 0.32 + 1.15 * Math.max(0, lam) + (n1 - 0.5) * 0.18 + (n2 - 0.5) * 0.1;
    { const hx = ox / R + 0.32, hy = oy / R + 0.42, hs = hx * hx + hy * hy; if (hs < 0.08) f += (1 - hs / 0.08) * 0.7; }   // мягкий блик
    if (e > 0.88) f *= 0.72 + (1 - e) * 2.2;
    const so = S.soil, lo = ny > 0.15 ? (ny - 0.15) * 0.35 : 0;                     // отсвет тёплой земли на нижних гранях
    let rr = (pc[0] * (1 - lo) + so[0] * 1.5 * lo) * f, gg = (pc[1] * (1 - lo) + so[1] * 1.25 * lo) * f, bb = (pc[2] * (1 - lo) + so[2] * lo) * f;
    if (lam > 0.86) { const h = (lam - 0.86) * 3.2; rr += h * 60; gg += h * 52; bb += h * 38; }   // тусклый тёплый блик
    if (e > 0.7 && -(ox * LIGHT.x + oy * LIGHT.y) < -0.3 * Math.hypot(ox, oy)) { const q = Math.min(1, (e - 0.7) / 0.2) * 0.75, sc = S.sun || [200, 184, 154]; rr += (sc[0] - rr) * q; gg += (sc[1] - gg) * q; bb += (sc[2] - bb) * q; }   // светлая кромка к солнцу
    if (oy > R * 0.35 && n1 > 0.78) { const so2 = S.soil; rr = so2[0] * 1.1; gg = so2[1] * 1.05; bb = so2[2]; }   // налипшая земля снизу
    o.r = rr; o.g = gg; o.b = bb; return;
  }
  // контактная тень в земле: плотнее снизу справа
  if (e < 1.32) {
    const down = (ox * 0.4 + oy) / (Math.abs(ox) + Math.abs(oy) + 0.01);
    const k = (1 - (e - 1) / 0.32) * (0.45 + Math.max(0, down) * 0.45);
    const so = S.soil; o.r = r + (so[0] * 0.3 - r) * k; o.g = g + (so[1] * 0.3 - g) * k; o.b = bl + (so[2] * 0.32 - bl) * k; return;
  }
  o.r = r; o.g = g; o.b = bl;
}

/** расстояние до рваной прожилки (0 — на прожилке). Плато шума (почти постоянное значение) прожилкой не считается —
    иначе на ровных участках вместо тонкой трещины получается сплошное пятно */
function veinDist(tl, x, y, n2) {
  const px = x * 1.5 + (tileAt(tl.t1, x, y, 1, 3) - 0.5) * 9 + (n2 - 0.5) * 6, py = y * 1.5 + (tileAt(tl.t1, x, y, 1, 11) - 0.5) * 9;
  const v0 = veinAt(tl.tv, px, py), gx = veinAt(tl.tv, px + 4, py) - v0, gy = veinAt(tl.tv, px, py + 4) - v0;
  const gl = Math.abs(gx) + Math.abs(gy); if (gl < 0.01) return 1;
  return Math.abs(v0 - 0.5) * 1.5 * Math.min(3, 0.03 / gl + 0.6);
}
/** глубокая тень под потолком пещеры (до 70 px вниз от свода) и отсвет от пола (до 40 px вверх от пола) */
function caveAO(m, i, W, y, bk, H) {
  if (bk > 2) return 1;
  let k = 1;
  for (let q = 1; q < 70; q++) if (y - q >= 0 && m[i - q * W]) { const t = q / 70; k = 0.52 + 0.48 * t * (2 - t); break; }
  for (let q = 1; q < 40; q++) if (y + q < H && m[i + q * W]) { k *= 1 + 0.22 * (1 - q / 40) * (1 - q / 40); break; }
  return k;
}
/** нерезкое маскирование 3×3 (только внутри непрозрачных областей, без ореолов по краю) */
function sharpen(d, W, H, k) {
  const src = new Uint8ClampedArray(d), R = W * 4;
  for (let y = 1; y < H - 1; y++) for (let x = 1, j = (y * W + 1) * 4; x < W - 1; x++, j += 4) {
    if (src[j + 3] < 255 || src[j - 1] < 255 || src[j + 7] < 255 || src[j - R + 3] < 255 || src[j + R + 3] < 255) continue;
    for (let c = 0; c < 3; c++) { const v = src[j + c], a = (src[j - 4 + c] + src[j + 4 + c] + src[j - R + c] + src[j + R + c]) * 0.25; d[j + c] = v + (v - a) * k; }
  }
}
/** средняя сумма r+g+b текстуры (для модуляции яркостью) */
function texMean(T) {
  if (!T) return 1; if (T.mean) return T.mean;
  let s = 0; const d = T.d; for (let j = 0; j < d.length; j += 4) s += d[j] + d[j + 1] + d[j + 2];
  return (T.mean = s / (d.length / 4));
}
/** пиксель бесшовной текстуры (отрендерена в Blender), координаты мира 1:1 */
function texAt(T, x, y, o) {
  const tx = ((x | 0) % T.w + T.w) % T.w, ty = ((y | 0) % T.h + T.h) % T.h, j = (ty * T.w + tx) * 4, d = T.d;
  o.r = d[j]; o.g = d[j + 1]; o.b = d[j + 2];
  o.tT = T; o.tsx = x; o.tsy = y;   // какая текстура и где взята — для чёткой карты при приближении (js/hires.js)
}

/** цвет материала в точке. Результат в o: r,g,b; свечение ga/gr/gg/gb; блеск spec */
function shadeMaterial(S, mt, x, y, t, capT, d, info, o, isBack) {
  const tl = S.tiles, LX = LIGHT.x, LY = LIGHT.y, LZ = LIGHT.z;
  const ty = (y & 255) << 8, ty2 = ((y >> 1) & 255) << 8, ty3 = ((y >> 2) & 255) << 8;
  const n1 = tl.t1[ty | (x & 255)], n2 = tl.t2[ty2 | ((x >> 1) & 255)], n3 = tl.t3[ty3 | ((x >> 2) & 255)];
  o.n1 = n1; o.ga = 0; o.cap = false; o.spec = 0; o.emit = false; o.tex = false; o.tT = null;
  let r, g, bl;
  if (t < capT) {
    // шапка (трава/снег/песок): светлая кромка, сочная середина, тёмная «губа» снизу
    o.cap = true;
    const k = t / capT; const cc = (S.beach && y - t > S.beachY) ? S.beach : S.rootCols || S.capCols;
    if (k < 0.45) { const q = k / 0.45; r = cc[0][0] + (cc[1][0] - cc[0][0]) * q; g = cc[0][1] + (cc[1][1] - cc[0][1]) * q; bl = cc[0][2] + (cc[1][2] - cc[0][2]) * q; }
    else { const q = (k - 0.45) / 0.55; r = cc[1][0] + (cc[2][0] - cc[1][0]) * q; g = cc[1][1] + (cc[2][1] - cc[1][1]) * q; bl = cc[1][2] + (cc[2][2] - cc[1][2]) * q; }
    // стебли: вертикальные прожилки разной яркости, чуть светлее кончики
    let f;
    if (S.grassy) {
      // трава: отдельные стебли по 2 px, чуть изогнутые; у каждого — своя яркость и тёмный левый край
      const bx = x + Math.round(Math.sin(y * 0.16 + hash3(x >> 3, 5, 1) * 6) * 1.2), bid = bx >> 1, hb = hash3(bid, 0, 3);
      f = 0.8 + hb * 0.36 + (n2 - 0.5) * 0.08;
      if ((bx & 1) === 0) f *= 0.86;
      if (hash3(bid, 1, 3) < 0.3) f *= 0.62;                                                   // тёмные стебли разделяют пучки
      if (t < 1.8) f *= 1.04;
      if (k > 0.72) f *= 1 - (k - 0.72) * 1.3;
      if (hb > 0.72 && t < 2.5) { r += (238 - r) * 0.35; g += (240 - g) * 0.35; bl += (142 - bl) * 0.35; }   // солнце на кончиках
    } else {
      const blade = tl.t1[((y >> 2 & 255) << 8) | (x & 255)];
      f = 0.9 + n2 * 0.1 + (blade - 0.5) * 0.22;
      if (t < 1.8) f *= 1.16;
      if (k > 0.8) f *= 1 - (k - 0.8) * 1.4;
    }
    r *= f; g *= f; bl *= f;
    if (S.tx.cap) { texAt(S.tx.cap, x, y, o); const q = (o.r + o.g + o.b) / S.capMean; r *= q; g *= q; bl *= q; }   // зерно снега/песка/пепла из Blender
  } else if (mt === 1 && S.tx.dirt) {
    // фотореалистичная земля из Blender: цвет и свет уже в текстуре; добавляем тень под травяной губой и глубину
    const sd = t - capT; texAt(S.tx.dirt, x, y, o); r = o.r * S.texGain; g = o.g * S.texGain; bl = o.b * S.texGain; o.tex = true;
    if (capT > 0 && sd < 12) { const k = sd < 5 ? 0.42 : 0.62 + (sd - 5) * 0.054; r *= k; g *= k * 0.96; bl *= k * 0.93; }
    if (sd < 70) { const dvr = Math.abs(veinAt(tl.tv, x * 1.35 + 311, y * 0.75) - 0.5), wr = 0.014 * (1 - sd / 70); if (dvr < wr) { const k = (1 - dvr / wr) * 0.7; r += (48 - r) * k; g += (30 - g) * k; bl += (18 - bl) * k; } }   // корни
    { const dk = Math.max(0, Math.min(1, (y - S.H * 0.35) / (S.H * 0.6))); r *= 1 - 0.08 * dk; g *= 1 - 0.09 * dk; bl *= 1 - 0.08 * dk; }   /* как в эталонах: порода не темнеет с глубиной */
  } else if (mt === 1) {
    const sd = t - capT;
    // крупный масштаб: пятна тона, изгиб пластов и скопления камней (не равномерная сетка)
    const big = tileAt(tl.t3, x, y, 4), big2 = tileAt(tl.t2, x, y, 5, 97);
    const v = (y + S.colOff[x] + (n3 - 0.5) * 70 + (big2 - 0.5) * 120) / S.band;
    const bi = Math.floor(v), fr = v - bi, L = S.L;
    const c0 = S.strata[((bi % L) + L) % L], c1 = S.strata[(((bi + 1) % L) + L) % L];
    let bm = fr < S.st ? 0 : (fr - S.st) / (1 - S.st); bm = bm * bm * (3 - 2 * bm);
    const lv = (0.9 + n3 * 0.1 + (n2 - 0.5) * 0.05 + (big - 0.5) * 0.16) * (1 - Math.min(0.2, sd / 1100));
    r = (c0[0] + (c1[0] - c0[0]) * bm) * lv; g = (c0[1] + (c1[1] - c0[1]) * bm) * lv; bl = (c0[2] + (c1[2] - c0[2]) * bm) * lv;
    if (sd < S.soilDepth) { const k = sd / S.soilDepth, q = k * k; const so = S.soil; r = so[0] + (r - so[0]) * q; g = so[1] + (g - so[1]) * q; bl = so[2] + (bl - so[2]) * q; }
    if (capT > 0 && sd < 12) { const k = sd < 6 ? 0.36 : 0.6 + (sd - 6) * 0.066; r *= k; g *= k * 0.95; bl *= k * 0.92; }        // тень под травяной губой
    // почва: тёплая у поверхности, фактура в двух масштабах (2–3 px и 12–20 px), комья с тенью, крошка
    { const nm = tileAt(tl.t1, x, y, 1, 7), nb = tileAt(tl.t2, x, y, 4, 41);
      let gk = 1 + (nm - 0.5) * 0.2 + (nb - 0.5) * 0.26 + (n1 - 0.5) * 0.08;
      if (n1 < 0.06) gk *= 0.78;
      const warmK = sd < 140 ? 1 - sd / 140 : 0;
      r *= gk * (1 + warmK * 0.14); g *= gk * (1 + warmK * 0.05); bl *= gk * (1 - warmK * 0.08);
      // комья: светлый бугорок, тень снизу справа
      const CL = 7, qx = Math.floor(x / CL), qy = Math.floor(y / CL), hq = hash3(qx, qy, 55);
      if (hq > 0.55 && !S.snowy) {
        const ccx = qx * CL + 1.5 + hash3(qx, qy, 56) * 4, ccy = qy * CL + 1.5 + hash3(qx, qy, 57) * 4, cr2 = 1 + hash3(qx, qy, 58) * 1.8;
        const dx = x - ccx, dy = y - ccy, dd2 = dx * dx + dy * dy;
        if (dd2 < cr2 * cr2) { const k = 1.08 + (-(dx + dy) / cr2) * 0.06; r *= k * 1.03; g *= k; bl *= k * 0.96; }
        else { const sx = dx - 1, sy = dy - 1; if (sx * sx + sy * sy < cr2 * cr2 && dx > -0.5 && dy > -0.5) { r *= 0.85; g *= 0.83; bl *= 0.83; } }
      }
    }
    if (sd > 7) {                                                                             // камни в толще: неровный контур, грани, тёплый отсвет, контактная тень
      const V = S.vs, vi = ((y & 255) << 8) | (x & 255), id = V.id[vi];
      if (V.rnd[id] > 1 - (0.4 + big * 0.42) * S.pebD) {
        const q2 = V.rnd2[id], rad = Math.min(V.cell * 0.42, V.cell * (0.09 + 0.3 * q2 * q2) * (0.75 + big * 0.7));
        const ox = -V.vx[vi] * 0.5, oy = -V.vy[vi] * 0.5 * (1.15 + q2 * 0.3);
        stoneAt(S, o, ox, oy, rad, id * 7.13, S.pebs[id % S.pebs.length], n1, n2, r, g, bl);
        r = o.r; g = o.g; bl = o.b;
      }
    }
    if (sd > 18 && !S.snowy) {                                                                // крупные камни 25–45 px (каждый пятый)
      const V = S.vl, vi = ((y & 511) << 9) | (x & 511), id = V.id[vi];
      if (V.rnd[id] > 0.78) { const q2 = V.rnd2[id]; stoneAt(S, o, -V.vx[vi] * 0.5, -V.vy[vi] * 0.56, 12 + q2 * 10, id * 1.7, S.pebs[(id * 3) % S.pebs.length], n1, n2, r, g, bl); r = o.r; g = o.g; bl = o.b; }
    }
    // разрез как иллюстрация: корни у поверхности, крупные валуны в глубине, порода темнее с глубиной
    if (sd < 70) {
      const dvr = Math.abs(veinAt(tl.tv, x * 1.35 + 311, y * 0.75) - 0.5), wr = 0.016 * (1 - sd / 70);
      if (dvr < wr) { const k = (1 - dvr / wr) * 0.8; r += (58 - r) * k; g += (36 - g) * k; bl += (24 - bl) * k; }
    }
    if (sd > 30) {
      const BC = 118, cx = Math.floor(x / BC), cy = Math.floor(y / BC), hb = hash3(cx, cy, 77);
      if (hb > 0.55) {
        // валун целиком помещается в свою ячейку — без обрезанных краёв
        const rad = 16 + hash3(cx, cy, 78) * 14, bx = cx * BC + BC * (0.38 + hash3(cx, cy, 79) * 0.24), by = cy * BC + BC * (0.38 + hash3(cx, cy, 80) * 0.24);
        const rc0 = S.rockC[(cx + cy * 7) % S.RL], so = S.soil;
        stoneAt(S, o, (x - bx) / 1.25, y - by, rad, hb * 91, [rc0[0] * 0.62 + so[0] * 0.18, rc0[1] * 0.62 + so[1] * 0.14, rc0[2] * 0.62 + so[2] * 0.1], n1, n2, r, g, bl);
        r = o.r; g = o.g; bl = o.b;
      }
    }
    { const dk = Math.min(1, sd / 480); r *= 1 - 0.34 * dk; g *= 1 - 0.38 * dk; bl *= 1 - 0.36 * dk; }
    if (S.veinC && sd > 8) {
      const dv = tileAt(tl.t3, x, y, 5, 61) < (t - capT < 70 ? 0.3 : 0.56) ? 1 : veinDist(tl, x, y, n2);   // рваные трещины, не везде
      if (dv < S.veinW) {
        const vc = n3 > 0.5 ? S.veinC : S.veinC2, k = 1 - dv / S.veinW, kk = k * 0.85 + 0.15;
        r += (vc[0] - r) * kk; g += (vc[1] - g) * kk; bl += (vc[2] - bl) * kk;
        if (S.veinGlow && k > 0.55 && S.hotCore) { const q = (k - 0.55) / 0.45; r += (255 - r) * q; g += (228 - g) * q; bl += (150 - bl) * q; }
        if (S.veinGlow && !isBack) { o.ga = 255 * k; o.gr = vc[0]; o.gg = vc[1]; o.gb = vc[2]; }
      } else if (S.veinGlow && dv < S.veinW * 5) {                                              // отсвет раскалённой трещины на породе вокруг
        const vc = n3 > 0.5 ? S.veinC : S.veinC2, q = 1 - dv / (S.veinW * 5), k = q * q * 0.32;
        r += (vc[0] - r) * k; g += (vc[1] - g) * k * 0.7; bl += (vc[2] - bl) * k * 0.5;
      }
    }
  } else if (mt === 2 && S.tx.rock) {
    // пласты породы из Blender; светящиеся швы (лава, кристаллы) идут в слой свечения
    texAt(S.tx.rock, x, y, o); r = o.r * S.texGain; g = o.g * S.texGain; bl = o.b * S.texGain; o.tex = true;
    if (S.glowTex && !isBack) { const G2 = S.glowTex, dot = (r * G2[0] + g * G2[1] + bl * G2[2]) / (Math.hypot(G2[0], G2[1], G2[2]) * (Math.hypot(r, g, bl) + 1)), br = Math.max(r, g, bl);
      if (dot > 0.93 && br > 150) { o.ga = Math.min(255, (br - 150) * 2.4); o.gr = G2[0]; o.gg = G2[1]; o.gb = G2[2]; o.emit = true; o.r = r; o.g = g; o.b = bl; } }
    if (capT > 0 && t - capT < 10) { const sd = t - capT, k = sd < 4 ? 0.5 : 0.66 + (sd - 4) * 0.057; r *= k; g *= k; bl *= k; }
    { const sd = t - capT, dk = Math.max(0, Math.min(1, (y - S.H * 0.35) / (S.H * 0.6))), up = sd < 60 ? 1.08 - sd / 60 * 0.08 : 1; const k = (1 - 0.08 * dk) * up; r *= k; g *= k * 0.98; bl *= k * 0.96; }   // глубже — темнее, у освещённого верха светлее
  } else if (mt === 2) {
    // скала: пласты осадочной породы разной толщины, волнистые; пласт разбит вертикальными трещинами
    // на глыбы; у глыб — объёмная фаска (светлый верх/левый край, тёмный низ), выветренные карнизы и потёки
    const wy = y + (tileAt(tl.t3, x, y, 5, 3) - 0.5) * 90 + (tileAt(tl.t3, x, y, 6, 51) - 0.5) * 70 + (tileAt(tl.t2, x, y, 3, 9) - 0.5) * 12 + (tileAt(tl.t1, x, y, 1, 5) - 0.5) * 3;
    const sd2 = t - capT, BH = S.rockBand, bi = Math.floor(wy / BH), hb = hash3(bi, 11, 3);
    const th = BH * (0.7 + hb * 0.24) + (tileAt(tl.t2, x, y, 4, 33) - 0.5) * BH * 0.55;                                                   // толщина пласта (часть полосы)
    const fyb = wy - bi * BH;
    let r0, g0, b0;
    const rc0 = S.rockC[((bi % S.RL) + S.RL) % S.RL], bt = 1 + (hash3(bi, 19, 3) - 0.5) * 0.4, bh2 = (hash3(bi, 20, 3) - 0.5) * 0.16;
    const rc = [rc0[0] * bt * (1 + bh2), rc0[1] * bt, rc0[2] * bt * (1 - bh2)];
    if (fyb > th) {                                                                        // тонкая прослойка между пластами — тёмная, мягкая порода
      const fade = tileAt(tl.t3, x, y, 5, 81), k = 0.55 + n2 * 0.15 + Math.max(0, fade - 0.5) * 0.8; r = rc[0] * k; g = rc[1] * k; bl = rc[2] * k;
      const q = (fyb - th) / Math.max(1, BH - th); if (q < 0.35) { const kk = 0.8; r *= kk; g *= kk; bl *= kk; }
    } else {
      const bw = 70 + hash3(bi, 12, 3) * 130, xo = hash3(bi, 13, 3) * 400 + (tileAt(tl.t2, x, y, 2, 21) - 0.5) * 10 + (fyb - th * 0.5) * (hash3(bi, 16, 3) - 0.5) * 0.9;
      const bj = Math.floor((x + xo) / bw), fxb = x + xo - bj * bw, hh = hash3(bi, bj, 14);
      const pv = 0.8 + hh * 0.34 + (n3 - 0.5) * 0.08;
      r = rc[0] * pv; g = rc[1] * pv; bl = rc[2] * pv;
      // не каждый шов — трещина: соседние глыбы часто срастаются
      const sL = hash3(bi, bj, 15) > 0.8, sR = hash3(bi, bj + 1, 15) > 0.8;
      const ex = Math.min(sL ? fxb : 999, sR ? bw - fxb : 999), ey = Math.min(fyb, th - fyb);
      const e = Math.min(ex, ey);
      if (e < 1.3) { const k = (ex < ey ? 0.5 : 0.42) + n1 * 0.12; r *= k; g *= k; bl *= k; }                // трещина / шов
      else if (e < 6) {
        const q = 1 - (e - 1.3) / 4.7, qq = q * q;
        let nx = 0, ny = 0; if (ex < ey) nx = fxb < bw * 0.5 ? -1 : 1; else ny = fyb < th * 0.5 ? -1 : 1;
        const f = 1 + qq * 0.55 * (nx * LX + ny * LY) / Math.hypot(LX, LY); r *= f; g *= f; bl *= f;
      }
      // объём глыбы: верх светлее, низ темнее; выветривание: пятна, поры, вертикальные потёки
      // часть пластов расслоена на 2–3 тонких слоя разного тона — толщина слоёв от 8 до 40 px
      const hs2 = hash3(bi, 17, 3);
      if (hs2 > 0.45) { const ns = hs2 > 0.8 ? 3 : 2, sub = Math.min(ns - 1, Math.floor(fyb / th * ns)), sf = fyb - sub * th / ns;
        const tk = 1 + (hash3(bi, sub, 18) - 0.5) * 0.18; r *= tk; g *= tk; bl *= tk * 0.98;
        if (sub > 0 && sf < 1.2 && tileAt(tl.t3, x, y, 4, 91) > 0.35) { r *= 0.7; g *= 0.7; bl *= 0.7; } }
      const u = fyb / th; const vol = 1.08 - u * 0.18;
      const stain = tileAt(tl.t3, x * 3, y * 0.4, 3, 17);
      let f = vol * (0.9 + (n1 - 0.5) * 0.18 + (n2 - 0.5) * 0.1 + (tileAt(tl.t1, x, y, 1, 29) - 0.5) * 0.12);
      if (stain > 0.64) f *= 1 - (stain - 0.64) * 0.55;
      if (n1 > 0.94) f *= 1.12; else if (n1 < 0.05) f *= 0.78;
      const big = tileAt(tl.t3, x, y, 4);
      const big2 = tileAt(tl.t2, x, y, 5, 71); f *= 0.9 + big2 * 0.2;
      f *= 0.9 + tileAt(tl.t1, x * 1.5, y * 3, 1, 47) * 0.2;                                      // зерно песчаника вдоль слоя
      if (capT > 0 && sd2 < 8) f *= sd2 < 2.5 ? 0.5 : 0.7 + (sd2 - 2.5) * 0.055;                  // тень под шапкой
      { const PK = 26, px2 = Math.floor(x / PK), py2 = Math.floor(y / PK), hp = hash3(px2, py2, 61); if (hp > 0.9 && e > 3) { const cx2 = px2 * PK + PK * 0.5, cy2 = py2 * PK + PK * 0.5, rr2 = 3 + (hp - 0.9) * 40, dx2 = (x - cx2) / (rr2 * 1.6), dy2 = (y - cy2) / rr2, e2 = dx2 * dx2 + dy2 * dy2; if (e2 < 1) f *= 0.55 + e2 * 0.3 + (dy2 > 0 ? 0 : -dy2 * 0.1); } }   // выветренные ниши
      r *= f * (1 + (big - 0.5) * 0.1); g *= f; bl *= f * (1 - (big - 0.5) * 0.1);
      // вкрапления гальки в пласте
      if (e > 4 && sd2 > 6) { const V = S.vs, vi = ((y & 255) << 8) | ((x + 97) & 255), id = V.id[vi];
        if (V.rnd[id] > 0.86) { const q2 = V.rnd2[id]; stoneAt(S, o, -V.vx[vi] * 0.5, -V.vy[vi] * 0.6, V.cell * (0.08 + 0.16 * q2), id * 3.1, [rc[0] * 0.8, rc[1] * 0.78, rc[2] * 0.76], n1, n2, r, g, bl); r = o.r; g = o.g; bl = o.b; } }
      // иней и снег на уступах пластов
      if (S.snowy) { const mg = 1.35 - (y / S.H) * 0.8; r *= mg; g *= mg; bl *= mg * 1.04; }                  // лунный свет: светлее вверху
      if (S.snowy && hash3(bi, 21, 3) > 0.45 && tileAt(tl.t3, x, y, 4, 13) > 0.45 && fyb < 1.5 + n2 * 3 + tileAt(tl.t1, x, y, 2, 77) * 2) { const k = 0.45; r += (236 - r) * k; g += (244 - g) * k; bl += (255 - bl) * k; }
      // тонкие диагональные трещинки внутри глыбы
      if (hh > 0.6 && Math.abs(veinAt(tl.tv, x * 1.6 + bj * 37, y * 1.6) - 0.5) < 0.006 && e > 3) { r *= 0.62; g *= 0.62; bl *= 0.62; }
    }
    if (S.veinC && t - capT > 8) {
      const dv = tileAt(tl.t3, x, y, 5, 61) < (t - capT < 70 ? 0.3 : 0.56) ? 1 : veinDist(tl, x, y, n2);   // рваные трещины, не везде
      if (dv < S.veinW) { const vc = n3 > 0.5 ? S.veinC : S.veinC2, k = 1 - dv / S.veinW; r += (vc[0] - r) * k; g += (vc[1] - g) * k; bl += (vc[2] - bl) * k; if (S.veinGlow && !isBack) { o.ga = 255 * k; o.gr = vc[0]; o.gg = vc[1]; o.gb = vc[2]; } } else if (S.veinGlow && dv < S.veinW * 5) { const vc = n3 > 0.5 ? S.veinC : S.veinC2, q = 1 - dv / (S.veinW * 5), k = q * q * 0.32; r += (vc[0] - r) * k; g += (vc[1] - g) * k * 0.7; bl += (vc[2] - bl) * k * 0.5; }
    }
  } else if (mt === 12 && (S.tx.rock || S.tx.dirt || S.tx.cave)) {
    // задняя стена: та же порода, что и скала вокруг (в скальных картах), иначе — плиты пещеры
    if (S.tx.rock) { texAt(S.tx.rock, x + 517, y + 311, o); const k = 1.05 * S.texGain; r = o.r * k; g = o.g * k; bl = o.b * k; o.ga = 0; }
    else if (S.tx.dirt) { texAt(S.tx.dirt, x + 257, y + 131, o); r = o.r * 0.7; g = o.g * 0.68; bl = o.b * 0.72; }   // земляная пещера: стена из того же грунта с камнями
    else { texAt(S.tx.cave, x, y, o); r = o.r * 1.35; g = o.g * 1.35; bl = o.b * 1.35; }
    o.tex = true;
  } else if (mt === 12) {
    // задняя стена земляной пещеры: неровные скруглённые плиты разного размера с глубокими швами
    const V = S.vl, vi = ((y & 511) << 9) | (x & 511), id = V.id[vi];
    const rc = S.rockC[id % S.RL], pv = 0.84 + V.rnd[id] * 0.3 + (n3 - 0.5) * 0.1;
    r = rc[0] * pv; g = rc[1] * pv; bl = rc[2] * pv;
    const ed = V.ed[vi] + (tileAt(tl.t1, x, y, 1, 13) - 0.5) * 8;
    if (ed < 8) { const k = 0.26 + Math.max(0, ed) * 0.035; r *= k; g *= k; bl *= k; }
    else if (ed < 40) {
      const q = 1 - (ed - 6) / 34, ox = -V.vx[vi], oy = -V.vy[vi], ol = Math.sqrt(ox * ox + oy * oy) || 1;
      const f = 1 + q * q * 0.5 * (ox * LX + oy * LY) / ol; r *= f; g *= f; bl *= f;
    }
    const f = 0.88 + (n1 - 0.5) * 0.2 + (n2 - 0.5) * 0.12; r *= f; g *= f; bl *= f;
  } else {
    const P = info.pal, prm = info.prm;
    switch (mt) {
      case 3: if (P.tex && TexLib.data[P.tex]) {
        texAt(TexLib.data[P.tex], x - (prm ? prm.x0 : 0), y - (prm ? prm.y0 : 0), o); const kb = P.texK || 1.22; r = o.r * kb; g = o.g * kb; bl = o.b * kb; o.tex = true; break;
      } else { // кладка: тёсаные блоки с объёмной фаской, сколами, пятнами, мхом; глубокий раствор
        const lx = x - (prm ? prm.x0 : 0), ly = y - (prm ? prm.y0 : 0);
        const bw = P.w || 20, bh = P.h || 10;
        const row = Math.floor(ly / bh); const off = (row & 1) ? bw * (0.42 + hash3(row, 1, info.idx) * 0.16) : 0;
        const col = Math.floor((lx + off) / bw);
        const fx = lx + off - col * bw, fy = ly - row * bh;
        const h = hash3(col, row, info.idx * 31 + 7), hc = hash3(col, row, info.idx * 17 + 3); let sunK = 0;
        // неровный край блока: шов «гуляет» от шума, углы скруглены
        const wob = (tileAt(tl.t2, x * 2, y * 2, 2, 13) - 0.5) * 2.2;
        const ex = Math.min(fx, bw - fx), ey = Math.min(fy, bh - fy);
        const cr = 3.2, cx2 = Math.max(0, cr - ex), cy2 = Math.max(0, cr - ey);
        const edge = (cx2 > 0 && cy2 > 0 ? cr - Math.hypot(cx2, cy2) : Math.min(ex, ey)) + wob;
        const chip = (hc > 0.78 && fx + fy * 1.3 < 6 + hc * 3) || (hc < 0.14 && (bw - fx) + (bh - fy) * 1.2 < 7);   // сколы углов
        if (edge < 0.9 || chip) {
          const f = (0.55 + n1 * 0.25) * (chip ? 0.85 : 0.75); r = P.mortar[0] * f; g = P.mortar[1] * f; bl = P.mortar[2] * f;
          if (!P.nomoss && S.grassy && tileAt(tl.t3, x * 1.3 + 40, y * 1.3, 3, 57) > 0.66) { const k = 0.75 + n1 * 0.3; r = 62 * k; g = 104 * k; bl = 34 * k; }   // мох в швах
        } else {
          const c = h > 0.8 ? P.alt : P.base;
          const tone = 1 + (h - 0.5) * (P.var || 0.1) * 3.2;
          // фаска: нормаль от ближайшего края, свет сверху слева — светлая верхняя/левая кромка, тёмная нижняя/правая
          const bev = 4.2; let f = tone;
          if (edge < bev) {
            const q = 1 - (edge - 0.9) / (bev - 0.9), qq = q * q;
            let nx = 0, ny = 0;
            if (ex < ey) nx = fx < bw * 0.5 ? -1 : 1; else ny = fy < bh * 0.5 ? -1 : 1;
            if (cx2 > 0 && cy2 > 0) { nx = (fx < bw * 0.5 ? -cx2 : cx2); ny = (fy < bh * 0.5 ? -cy2 : cy2); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; }
            const lit = (nx * LX + ny * LY) / Math.hypot(LX, LY); f *= 1 + qq * 0.62 * lit - qq * 0.06; if (lit > 0.3 && S.sun) sunK = qq * lit * 0.5;
          }
          // камень: крупные пятна, зерно, выветренные раковины, мягкий свет «подушки» блока
          const bl1 = tileAt(tl.t3, x * 1.3 + h * 300, y * 1.3, 2), bl2 = tileAt(tl.t2, x + h * 500, y, 1);
          f *= 0.86 + bl1 * 0.2 + (bl2 - 0.5) * 0.12 + (n1 - 0.5) * 0.14;
          if (n1 > 0.94) f *= 1.14; else if (n1 < 0.05) f *= 0.74;
          if (bl2 < 0.16 && edge > 4) f *= 0.84 + bl2;                                               // раковины
          f *= 1.06 - (fy / bh) * 0.14;
          const streak = tileAt(tl.t3, x * 4, y * 0.35, 3);                                             // потёки сырости сверху вниз
          if (streak > 0.66) f *= 1 - (streak - 0.66) * 0.6;
          if (h > 0.9 && Math.abs(fx - bw * 0.5 - (fy - bh * 0.5) * 0.9 + Math.sin(fy * 1.3) * 0.8) < 0.6 && edge > 2) f *= 0.5;   // трещина
          const warm = (bl1 - 0.5) * 0.1 + (hash3(col, row, info.idx * 5 + 1) - 0.5) * 0.12;
          r = c[0] * f * (1 + warm); g = c[1] * f; bl = c[2] * f * (1 - warm);
          // мох: на верхних кромках и в сырых блоках
          const moss = tileAt(tl.t3, x * 0.7 + 90, y * 0.7, 3);
          const mk = Math.max(0, (moss - 0.62) * 3.2) * (fy < 5 ? 1 : 0.25) + (h < 0.06 ? 0.5 * n3 : 0);
          if (S.sun && edge < 3.6 && (fy < bh * 0.5 && ey < ex || fx < bw * 0.5 && ex < ey)) sunK = Math.max(sunK, 0.6 * (1 - (edge - 1.3) / 2.3));   // тёплая кромка 2 px сверху/слева
          if (sunK > 0) { r += (S.sun[0] - r) * sunK; g += (S.sun[1] - g) * sunK; bl += (S.sun[2] - bl) * sunK; }
          if (S.grassy && !P.nomoss && hash3(col, row, info.idx * 7 + 77) < 0.15) { const mx2 = bw * (0.2 + hash3(col, row, 78) * 0.6), mr = 4 + hash3(col, row, 79) * 5, dmx = (fx - mx2) / (mr * 1.4), dmy = fy / mr, mm = dmx * dmx + dmy * dmy + (n2 - 0.5) * 0.6;
            if (mm < 1) { const k = (0.75 + n1 * 0.4) * (1.05 - fy / bh * 0.3); r = 88 * k; g = 128 * k; bl = 40 * k; } }   // пятна мха на верхних кромках
          if (mk > 0.05 && !P.nomoss) { const k = Math.min(0.85, mk) * (0.7 + n1 * 0.5); r += (58 * f - r) * k; g += (104 * f - g) * k; bl += (34 * f - bl) * k; }
        }
        break;
      }
      case 4: if (P.tex && TexLib.data[P.tex]) {
        texAt(TexLib.data[P.tex], x, y - (prm ? prm.y0 : 0), o); r = o.r; g = o.g; bl = o.b; o.tex = true;
        if (prm && prm.h > 60) { const k = 1.1 - 0.35 * Math.min(1, Math.max(0, (y - prm.y0) / prm.h)); r *= k; g *= k; bl *= k; }
        if (S.glass && !isBack) {
          // корпус судна: железные полосы с заклёпками, мокрая тёмная полоса и водоросли у ватерлинии
          const bx = ((x % 186) + 186) % 186;
          if (bx < 7) { const e = bx < 1 || bx > 5.5 ? 0.55 : 1; r = 58 * e + n1 * 10; g = 56 * e + n1 * 10; bl = 54 * e + n1 * 10; if (bx >= 2 && bx < 5 && ((y % 24) + 24) % 24 < 3) { r = 120; g = 112; bl = 100; } }
          const dw = S.waterY - y;
          if (dw < 70 && dw > -40) {
            const wet = Math.max(0, Math.min(1, 1 - dw / 70)); r *= 1 - 0.35 * wet; g *= 1 - 0.3 * wet; bl *= 1 - 0.3 * wet;
            const alg = dw < 26 && tileAt(tl.t1, x, y * 2, 1, 71) > 0.45 - (26 - dw) / 60;
            if (alg) { const k = 0.6 + n2 * 0.5; r = 46 * k; g = 64 * k; bl = 30 * k; }
          }
        }
        break;
      } else { // доски со скруглёнными краями
        const ph = P.plank || 8; const ly = y - (prm ? prm.y0 : 0);
        const row = Math.floor(ly / ph), fy = ly - row * ph;
        const off = hash3(row, 3, info.idx) * 190; const segL = 60 + hash3(row, 4, info.idx) * 120;
        const seg = Math.floor((x + off) / segL), fx = x + off - seg * segL;
        if (fy < 3 || fx < 1.8) { const k = fy < 1.6 || fx < 0.9 ? 0.6 : 1; r = P.gap[0] * k; g = P.gap[1] * k; bl = P.gap[2] * k; }
        else {
          const h = hash3(seg, row, info.idx + 5);
          const gr = tl.tg[((y & 255) << 8) | ((x >> 1) & 255)];
          // волокна: изогнутые годичные линии; сучок — тёмные кольца вокруг случайной точки доски
          const wv = Math.sin((fy + (gr - 0.5) * 5 + Math.sin(fx * 0.05 + h * 9) * 2) * 2.3);
          let f = 0.8 + h * 0.4 + (gr - 0.5) * 0.34 + wv * 0.08;
          const wth = tileAt(tl.t3, x * 0.6 + h * 300, y * 2, 3, 43); f *= 0.84 + wth * 0.3;                   // выветренные пятна вдоль доски
          const hue = (hash3(seg, row, info.idx + 9) - 0.5) * 0.16;
          { const gl = Math.abs(Math.sin((fy * 1.9 + Math.sin(fx * 0.045 + h * 20) * 2.2 + gr * 3) * 1.6)); if (gl < 0.12) f *= 0.8; }   // тёмные прожилки волокон
          const kx = 10 + h * (segL - 20), kd = Math.hypot((fx - kx) * 0.55, fy - ph * 0.5);
          if (h > 0.55 && kd < 3.2) f *= 0.72 + Math.sin(kd * 3.1) * 0.12;
          if (fx < 7 || fx > segL - 7) f *= 1.05;                                                           // выгоревшие торцы
          if (fy < 2.6) f *= 1.18; else if (fy > ph - 2) f *= 0.72;
          if (fx < 2.4) f *= 1.06; else if (fx > segL - 2) f *= 0.8;
          if (prm && prm.h > 60) f *= 1.06 - 0.3 * Math.min(1, Math.max(0, (y - prm.y0) / prm.h));   // объём корпуса: низ темнее
          else if (!prm && S.glass && !isBack) f *= 1.18 - Math.min(1, Math.max(0, (y - S.hullTop) / 380)) * 0.6;   // выпуклый корпус: светлее у борта, темнее к килю
          r = P.base[0] * f * (1 + hue); g = P.base[1] * f; bl = P.base[2] * f * (1 - hue);
          { const nx2 = Math.min(Math.abs(fx - 3.5), Math.abs(fx - (segL - 3.5))), ny2 = Math.abs(fy - ph * 0.5); if (nx2 * nx2 + ny2 * ny2 < 1.8) { r = 44; g = 36; bl = 30; o.spec = 0.8; } else if (nx2 < 2.2 && ny2 < 2.2 && fy > ph * 0.5) { r *= 0.8; g *= 0.8; bl *= 0.8; } }   // гвозди с тенью
        }
        break;
      }
      case 5: { // бетон, окна, дорога
        const base = P.base; let f = 0.9 + n2 * 0.12 + (n3 - 0.5) * 0.1;
        if (S.tx.concrete) { texAt(S.tx.concrete, x, y, o); f = (o.r + o.g + o.b) / (3 * 150); }   // бетонные панели из Blender, тон — из палитры здания
        f *= 0.88 + tileAt(tl.t1, x * 2, y * 4, 1, 19) * 0.24 + (tileAt(tl.t2, x, y, 3, 29) - 0.5) * 0.12;                                      // фактура штукатурки/плитки
        // бетон: заполнитель (крапинки), швы опалубки, потёки дождя, трещины
        if (n1 > 0.9) f *= 1.1; else if (n1 < 0.08) f *= 0.84;
        const rain = tileAt(tl.t3, x * 5, y * 0.3, 3); if (rain > 0.6) f *= 1 - (rain - 0.6) * 0.5;
        if (((y + 3) % 58) < 1.2) f *= 0.82;
        if (Math.abs(veinAt(tl.tv, x * 1.5, y * 1.5) - 0.5) < 0.006) f *= 0.6;
        r = base[0] * f; g = base[1] * f; bl = base[2] * f;
        if (P.road && prm) {
          const ly = y - prm.y0;
          if (ly < 6) { r = 44 + n1 * 12; g = 46 + n1 * 12; bl = 54 + n1 * 12; if (ly >= 2 && ly < 3.5 && (x % 44) < 22) { r = 240; g = 206; bl = 80; } }
          else if (x % 90 < 2) { r *= 0.68; g *= 0.68; bl *= 0.68; }
        } else if (P.cornice) { r *= 1.18; g *= 1.18; bl *= 1.18; }
        else if (P.win && prm && S.tx.facade) {                                              // фасад из Blender: окна, кондиционеры, водостоки
          texAt(S.tx.facade, x - prm.x0, y - prm.y0, o); r = o.r; g = o.g; bl = o.b; o.tex = true;
          const lum = r * 0.3 + g * 0.59 + bl * 0.11;
          if (lum > 120 && Math.max(r, g, bl) - Math.min(r, g, bl) > 12 || lum > 175) { o.emit = true; o.ga = isBack ? 150 : 230; o.gr = r; o.gg = g; o.gb = bl; o.r = r; o.g = g; o.b = bl; }
          else { r *= 2.0; g *= 2.0; bl *= 1.95; }                                                   // стены под ночным светом города
        } else if (P.win && prm) {
          const lx = x - prm.x0, ly = y - prm.y0;
          const cw = 26, fh = 34, mx = 12, my = 16;
          const cols = Math.max(1, Math.floor((prm.w - 2 * mx + 12) / cw));
          const col = Math.floor((lx - mx) / cw), fl = Math.floor((ly - my) / fh);
          const fx = (lx - mx) - col * cw, fy = (ly - my) - fl * fh;
          if (lx >= mx && col >= 0 && col < cols && fx < 14 && ly >= my && fy < 21) {
            const hw = hash3(col >> 1, fl, info.idx * 13 + 1) * 0.7 + hash3(col, fl, info.idx * 13 + 5) * 0.3, hv = hash3(col, fl, info.idx * 13 + 2);
            if (fy >= 18.5) {                                                                // подоконник с тенью под ним (под светящимся окном — тёплый отсвет)
              if (fy < 19.8) { r = r * 0.4 + 120; g = g * 0.4 + 122; bl = bl * 0.4 + 128; } else { r *= 0.55; g *= 0.55; bl *= 0.58; }
            } else if (fx < 0.9 || fy < 0.9) { r *= 0.42; g *= 0.42; bl *= 0.45; }           // рама: тёмный контур, светлый откос сверху слева
            else if (fx < 2 || fy < 2) { r *= 1.3; g *= 1.3; bl *= 1.3; }
            else if (fx > 12.8) { r *= 0.62; g *= 0.62; bl *= 0.64; }
            else if (hw < Math.min(0.8, P.lit * 1.6)) {
              // свет в окне: тёплый градиент, штора с одной стороны, силуэт лампы/мебели внизу
              const tone = 0.78 + fy / 19 * 0.34, hueW = hv < 0.33 ? [255, 214, 140] : hv < 0.66 ? P.win : [255, 238, 200];
              r = hueW[0] * tone; g = hueW[1] * tone; bl = hueW[2] * tone;
              const cs = hv > 0.5 ? fx < 3 + hv * 3 : fx > 11 - hv * 3;
              if (cs) { const k = 0.62 + Math.sin(fy * 1.3 + fx) * 0.05; r *= k; g *= k * 0.9; bl *= k * 0.8; }
              if (fy > 14 && Math.abs(fx - 4 - hv * 6) < 2.2) { r *= 0.35; g *= 0.3; bl *= 0.3; }
              o.emit = true; o.ga = isBack ? 170 : 255; o.gr = hueW[0]; o.gg = hueW[1]; o.gb = hueW[2];
            } else {
              // тёмное стекло отражает небо: светлее вверху, диагональный блик
              const k = 1 - fy / 19 * 0.5; r = P.dark[0] * k + 26 * (1 - fy / 19); g = P.dark[1] * k + 30 * (1 - fy / 19); bl = P.dark[2] * k + 46 * (1 - fy / 19);
              const dg = (fx + fy * 0.8 + hv * 10) % 16; if (dg < 1.6) { r += 38; g += 42; bl += 54; } else if (dg < 2.6) { r += 14; g += 16; bl += 22; }
            }
            if (fx >= 2 && fx <= 12.8 && fy >= 2 && fy < 18.5 && (Math.abs(fx - 7.4) < 0.7 || Math.abs(fy - 8) < 0.7)) { r = r * 0.35 + 50; g = g * 0.35 + 52; bl = bl * 0.35 + 58; }   // переплёт
          } else if (ly > 0 && (ly - my + 5) % fh < 3) { const u = (ly - my + 5) % fh; const f = u < 1.2 ? 1.22 : 0.9; r *= f; g *= f; bl *= f; }   // междуэтажный пояс
          else if (ly > 0 && (ly - my + 5) % fh < 5) { r *= 0.74; g *= 0.74; bl *= 0.76; }                                                            // тень под поясом
          else if (lx % 60 < 1.5) { r *= 0.86; g *= 0.86; bl *= 0.86; }
          else { const st = tileAt(S.tiles.t3, x * 3, y * 0.3, 3, 23); if (st > 0.66) { const k = 1 - (st - 0.66) * 0.6; r *= k; g *= k; bl *= k; } else if (st < 0.2) { const k = 1 + (0.2 - st) * 0.9; r *= k; g *= k; bl *= k * 1.05; } }   // потёки и мокрые блики на фасаде
          // тёплый отсвет на стене под светящимся окном
          if (lx >= mx && col >= 0 && col < cols && fx < 16 && fy >= 21 && fy < 35 && hash3(col >> 1, fl, info.idx * 13 + 1) * 0.7 + hash3(col, fl, info.idx * 13 + 5) * 0.3 < Math.min(0.8, P.lit * 1.6)) { const k = (1 - (fy - 21) / 14); r += (255 - r) * k * 0.5; g += (190 - g) * k * 0.3; bl += (120 - bl) * k * 0.14; }
          if (prm.h > 80) { const vg = 1.12 - Math.min(1, ly / prm.h) * 0.24; r *= vg; g *= vg; bl *= vg; }
        }
        break;
      }
      case 6: { // металл: панели с фаской, заклёпки, глянцевая полоса
        const pw = (P.plate && P.plate[0]) || 30, phh = (P.plate && P.plate[1]) || 16;
        const fx = ((x % pw) + pw) % pw, fy = ((y % phh) + phh) % phh;
        const u = fy / phh;
        // шлифовка: тонкие горизонтальные штрихи; вмятины — пологие пятна тени
        const brush = tl.t1[((y & 255) << 8) | ((x >> 3) & 255)], dent = tileAt(tl.t2, x, y, 3, 31);
        let f = (0.86 + 0.34 * Math.exp(-(u - 0.3) * (u - 0.3) * 30)) * (0.95 + (brush - 0.5) * 0.1) * (dent < 0.2 ? 0.9 + dent * 0.5 : 1);
        r = P.base[0] * f; g = P.base[1] * f; bl = P.base[2] * f; o.spec = 0.7;
        if (fx < 1.2 || fy < 1.2) { r *= 0.5; g *= 0.5; bl *= 0.5; o.spec = 0; }
        else if (fx < 2.6 || fy < 2.6) { r *= 1.16; g *= 1.16; bl *= 1.16; }
        else if (fx > pw - 2.2 || fy > phh - 2.2) { r *= 0.78; g *= 0.78; bl *= 0.78; }
        const rx = fx < pw / 2 ? fx - 4 : fx - (pw - 4), ry = fy - 4.2, rr = rx * rx + ry * ry;
        if (rr < 2.6) { const k = 1.25 - rr * 0.12 - (rx + ry) * 0.12; r *= k; g *= k; bl *= k; }
        else if (Math.abs(rx) < 1.6 && ry > 1 && ry < 14 && hash3(Math.floor(x / pw), Math.floor(y / phh), 7) > 0.55) {   // ржавый потёк под заклёпкой
          const k = (1 - ry / 14) * 0.55; r += (P.rust[0] - r) * k; g += (P.rust[1] - g) * k; bl += (P.rust[2] - bl) * k; o.spec *= 0.5; }
        if (n3 > 0.66) { const k = Math.min(1, (n3 - 0.66) * 6) * 0.75; r += (P.rust[0] - r) * k; g += (P.rust[1] - g) * k; bl += (P.rust[2] - bl) * k; o.spec *= 1 - k; }
        break;
      }
      case 7: { // лёд: светлый у поверхности, густо-синий в толще, трещинки и искры
        const A = S.iceA, B = S.iceB, k = Math.min(1, d / 64) * 0.75 + n3 * 0.25;
        r = A[0] + (B[0] - A[0]) * k; g = A[1] + (B[1] - A[1]) * k; bl = A[2] + (B[2] - A[2]) * k;
        const dv = Math.abs(tl.tv[ty2 | ((x >> 1) & 255)] - 0.5); if (dv < 0.01) { r = 236; g = 250; bl = 255; }
        if (hash3(x, y, 5) > 0.997) { r = g = bl = 255; }
        // пузырьки воздуха, слои намерзания, иней у поверхности
        { const bx = Math.floor(x / 9), by = Math.floor(y / 9), hb = hash3(bx, by, 21);
          if (hb > 0.86) { const cx = bx * 9 + 4.5, cy = by * 9 + 4.5, rr = (x - cx) * (x - cx) + (y - cy) * (y - cy), rad = 1 + hb * 2.2;
            if (rr < rad * rad) { const k = rr < (rad - 0.8) * (rad - 0.8) ? 0.1 : 0.45; r += (255 - r) * k; g += (255 - g) * k; bl += (255 - bl) * k; } } }
        { const layer = Math.sin(y * 0.18 + tileAt(tl.t3, x, y, 3) * 6); r += layer * 5; g += layer * 6; bl += layer * 4; }
        if (d < 6 && n1 > 0.55) { r += (250 - r) * 0.45; g += (253 - g) * 0.45; bl += (255 - bl) * 0.45; }
        o.spec = 0.9;
        break;
      }
      case 8: { // кристалл: неправильные грани (ячейки Вороного), плавный перелив цвета, светлые рёбра, свечение изнутри
        const V = S.vs, vi = ((y & 255) << 8) | (x & 255), id = V.id[vi];
        const A = P.a || [95, 244, 255], B = P.b || [184, 108, 255];
        const h = V.rnd[id] * 0.15 + tileAt(tl.t3, x, y, 5, 7) * 0.85;
        r = A[0] + (B[0] - A[0]) * h; g = A[1] + (B[1] - A[1]) * h; bl = A[2] + (B[2] - A[2]) * h;
        // грань — плоскость со своим наклоном: освещённость зависит от случайной нормали ячейки и положения в ней
        // стекло/кристалл: плавный объём по расстоянию до края (френель), слабые грани, одна дуга блика
        const tilt = (V.rnd2[id] - 0.5) * 0.22, ox = -V.vx[vi] * 0.5, oy = -V.vy[vi] * 0.5;
        const dn = Math.min(1, d / 30);
        let f = 0.62 + dn * 0.28 + tilt;
        const ed = V.ed[vi];
        if (ed < 3) f += 0.18;                                                                     // тонкое светлое ребро
        if (t > 4 && t < 8 && d > 5 && n2 > 0.3) f += 0.5 * (1 - Math.abs(t - 6) / 2);             // дуга блика под верхней кромкой
        r *= f; g *= f; bl *= f;
        { const core = Math.max(0, 1 - Math.hypot(ox, oy) / 14); r += core * 30; g += core * 34; bl += core * 44; }   // свет изнутри
        if (d < 5) { const k = (1 - d / 5) * 0.5; r += (255 - r) * k; g += (255 - g) * k; bl += (255 - bl) * k; }       // френель по кромке
        if (hash3(x, y, 13) > 0.997) { r = g = bl = 255; }                                                        // искры
        r = Math.min(255, r); g = Math.min(255, g); bl = Math.min(255, bl);
        if (!isBack) { o.ga = 60 + h * 50; o.gr = r; o.gg = g; o.gb = bl; }
        o.spec = 1;
        break;
      }
      case 9: { // базальтовые столбы со скруглёнными гранями
        const cw = 16; const col = Math.floor(x / cw); const hh = hash3(col, 0, 4);
        const fx = x - col * cw; const yy = y + hh * 60; const seg = Math.floor(yy / 46); const fy = yy - seg * 46;
        const c = S.rockC[col % S.RL]; let f = 0.86 + hash3(col, seg, 8) * 0.28;
        if (fx < 1.4) f *= 0.42; else if (fx < 4) f *= 1.22; else if (fx > cw - 3.4) f *= 0.72;
        if (fy < 1.4) f *= 0.5; else if (fy < 3.4) f *= 1.12;
        f *= 0.9 + n1 * 0.14 + (n2 - 0.5) * 0.1;                                                             // шероховатость
        if (Math.abs(veinAt(tl.tv, x * 2, y) - 0.5) < 0.005 && fx > 3) f *= 0.55;                               // трещины в столбах
        r = c[0] * f; g = c[1] * f; bl = c[2] * f;
        break;
      }
      default: r = 120; g = 120; bl = 120;
    }
  }
  o.r = r; o.g = g; o.b = bl;
}

function buildTerrainVisual(T, theme, map, raster, waterY) {
  const W = T.W, H = T.H, m = T.mask, N = W * H;
  const mat = raster.mat, sid = raster.sid, back = raster.back, bsid = raster.bsid;
  const G = theme.ground;
  T.scorch = hex2rgb(G.outline).map(v => Math.max(4, v * 0.8));
  if (theme.glow) { T.glow = makeCanvas(W, H); T.gctx = T.glow.getContext('2d'); }
  const infos = map.shapes.map((sh, idx) => {
    const p = Object.assign({}, MAT_DEFAULT[sh.mat] || {}, sh.pal || {}); const rp = {};
    for (const k in p) rp[k] = (typeof p[k] === 'string' && p[k][0] === '#') ? hex2rgb(p[k]) : p[k];
    return { idx, pal: rp, prm: sh.params || null };
  });
  if (!infos.length) infos.push({ idx: 0, pal: {}, prm: null });

  // --- поле расстояний до воздуха (chamfer 3-4) ---
  const D = new Uint16Array(N);
  for (let i = 0; i < N; i++) D[i] = m[i] ? 65000 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x; let d = D[i]; if (!d) continue;
      const l = x > 0 ? D[i - 1] : 0; if (l + 3 < d) d = l + 3;
      if (y > 0) {
        const u = D[i - W]; if (u + 3 < d) d = u + 3;
        const ul = x > 0 ? D[i - W - 1] : 0; if (ul + 4 < d) d = ul + 4;
        const ur = x < W - 1 ? D[i - W + 1] : 0; if (ur + 4 < d) d = ur + 4;
      } else if (3 < d) d = 3;
      D[i] = d;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x; let d = D[i]; if (!d) continue;
      const r = x < W - 1 ? D[i + 1] : 0; if (r + 3 < d) d = r + 3;
      if (y < H - 1) {
        const dn = D[i + W]; if (dn + 3 < d) d = dn + 3;
        const dl = x > 0 ? D[i + W - 1] : 0; if (dl + 4 < d) d = dl + 4;
        const dr = x < W - 1 ? D[i + W + 1] : 0; if (dr + 4 < d) d = dr + 4;
      }
      D[i] = d;
    }
  }
  // --- глубина от поверхности (TD) и до потолка (BD) ---
  const TD = new Uint16Array(N), BD = new Uint16Array(N);
  for (let x = 0; x < W; x++) {
    let run = 0;
    for (let y = 0, i = x; y < H; y++, i += W) { if (m[i]) { TD[i] = run < 60000 ? run : 60000; run++; } else run = 0; }
    run = 60000;
    for (let y = H - 1, i = (H - 1) * W + x; y >= 0; y--, i -= W) { if (m[i]) { BD[i] = run < 60000 ? run : 60000; run++; } else run = 0; }
  }
  // --- мягкий рельеф для фасок: высота = расстояние до края, размытая ---
  const BEV = 15, HF = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const dd = D[i]; HF[i] = dd >= BEV * 3 ? 255 : (dd * 85 / BEV) | 0; }
  boxBlurU8(HF, W, H, 2); boxBlurU8(HF, W, H, 2);
  // --- окклюзия: доля твёрдого вокруг (сетка 1/4, радиус ~40 px) ---
  const OW = (W >> 2) + 2, OH = (H >> 2) + 2, OCC = new Float32Array(OW * OH);
  for (let y = 0; y < H; y++) { const oy = (y >> 2) * OW, row = y * W; for (let x = 0; x < W; x++) if (m[row + x]) OCC[oy + (x >> 2)] += 0.0625; }
  boxBlurF32(OCC, OW, OH, 5); boxBlurF32(OCC, OW, OH, 5);

  // --- тени от солнца: луч из точки у поверхности к солнцу; встретил камень — точка в тени.
  //     Считаем на сетке 1/2, затем размываем — получается мягкая полутень ---
  const SS = 3, SW2 = Math.ceil(W / SS), SH2 = Math.ceil(H / SS), SHD = new Float32Array(SW2 * SH2);
  {
    const ll = Math.hypot(LIGHT.x, LIGHT.y), sx = LIGHT.x / ll, sy = LIGHT.y / ll;
    const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[(y | 0) * W + (x | 0)];
    for (let y2 = 0; y2 < SH2; y2++) for (let x2 = 0; x2 < SW2; x2++) {
      const x = Math.min(W - 1, x2 * SS), y = Math.min(H - 1, y2 * SS), i = y * W + x;
      if (!(m[i] ? D[i] <= 30 : back[i])) continue;
      let px0 = x + 0.5, py0 = y + 0.5, k = 0;
      while (k < 10 && solid(px0, py0)) { px0 += sx * 1.5; py0 += sy * 1.5; k++; }   // выходим из своего массива
      if (k >= 10) { SHD[y2 * SW2 + x2] = 0.6; continue; }
      for (let st = 4; st < 280; st += 4) if (solid(px0 + sx * st, py0 + sy * st)) { SHD[y2 * SW2 + x2] = st < 60 ? 1 : 1 - (st - 60) / 460; break; }
    }
    boxBlurF32(SHD, SW2, SH2, 2); boxBlurF32(SHD, SW2, SH2, 1);
  }
  const shadowAt = (x, y) => { const fx = x / SS, fy = y / SS, x0 = Math.min(SW2 - 2, fx | 0), y0 = Math.min(SH2 - 2, fy | 0), ax = Math.min(1, fx - x0), ay = Math.min(1, fy - y0), r0 = y0 * SW2, r1 = r0 + SW2;
    return (SHD[r0 + x0] * (1 - ax) + SHD[r0 + x0 + 1] * ax) * (1 - ay) + (SHD[r1 + x0] * (1 - ax) + SHD[r1 + x0 + 1] * ax) * ay; };
  const seed = map.seed || 1;
  const colOff = new Float32Array(W), capN = new Float32Array(W), capS = new Float32Array(W);
  // рваный нижний край травяной шапки: стебли свисают на землю зубцами разной длины
  const fringe = new Float32Array(W); for (let x = 0; x < W; x++) { const ph = (x + hash3(x >> 2, 0, seed) * 3) % 4, tip = 1 - Math.abs(ph - 2) / 2; fringe[x] = tip * tip * (G.cap.blades ? 4 + hash3(x >> 2, 1, seed) * 11 : hash3(x >> 2, 1, seed) * 2.5); }
  for (let x = 0; x < W; x++) { colOff[x] = fbm1(x / 420, seed + 5, 3) * 28; capN[x] = (fbm1(x / 55, seed + 7, 2) + 1) * 0.5; capS[x] = Math.abs(Math.sin(x * 0.2 + capN[x] * 9)); }
  const capMat = new Uint8Array(16); for (const k of (G.capMats || [1])) capMat[k] = 1;
  const V = getVoronoi();
  const S = {
    tiles: getTiles(), colOff, vs: V.s, vl: V.l, grassy: !!G.cap.blades && !G.cap.snow, glowTex: G.tex && G.tex.glowTex, rootCols: G.tex && G.tex.grass && TexLib.data[G.tex.grass] ? [[82, 102, 34], [60, 76, 24], [54, 42, 24]] : null, tx: { dirt: G.tex && TexLib.data[G.tex.dirt], cave: G.tex && TexLib.data[G.tex.cave], rock: G.tex && TexLib.data[G.tex.rock], concrete: G.tex && TexLib.data[G.tex.concrete], facade: G.tex && TexLib.data[G.tex.facade], cap: G.tex && TexLib.data[G.tex.cap] }, capMean: texMean(G.tex && TexLib.data[G.tex.cap]), texGain: (G.tex && G.tex.gain) || 1, smoothStones: !!G.smoothStones, rimCol: G.stoneRim ? hex2rgb(G.stoneRim) : null, H, pebD: G.pebDensity || 1, snowy: !!G.cap.snow, hotCore: !!(G.veins && G.veins.hot), rockDirt: !!G.rockDirt, rimK: G.rimK || 0.2, hullTop: waterY - 300, waterY, backK: G.backK || 1, glass: theme.id === 'tropical', neon: G.neonRim ? G.neonRim.map(hex2rgb) : null, sun: G.sun ? hex2rgb(G.sun) : null,
    capCols: G.cap.cols.map(hex2rgb), beach: G.cap.beach ? G.cap.beach.cols.map(hex2rgb) : null,
    beachY: G.cap.beach ? waterY - G.cap.beach.range : 1e9,
    strata: G.strata.map(hex2rgb), L: G.strata.length,
    rockC: (G.rock || G.strata).map(hex2rgb), RL: (G.rock || G.strata).length,
    soil: hex2rgb(G.soil), soilDepth: G.soilDepth, pebs: G.pebbles.map(hex2rgb),
    veinC: G.veins ? hex2rgb(G.veins.color) : null, veinC2: G.veins ? hex2rgb(G.veins.color2 || G.veins.color) : null,
    veinW: G.veins ? G.veins.w : 0, veinGlow: !!(G.veins && G.veins.glow),
    band: G.band, st: 1 - (1 - G.bandSharp) * 0.6, rockBand: G.rockBand || Math.max(26, G.band * 1.2),
    iceA: [226, 246, 255], iceB: [92, 158, 214],
  };
  const outl = hex2rgb(G.outline); const capThick = G.cap.thick * 1.45;
  const rim = hex2rgb(G.rim || theme.sky[1]);
  const tint = hex2rgb(theme.backTint || '#0a0e1a');
  const bounce = hex2rgb(theme.sky[2] || theme.sky[1]);
  const img = T.ctx.createImageData(W, H); const px = img.data;
  // откуда взят цвет каждого пикселя (текстура и её сдвиг) — по этим ссылкам при приближении подставляются мелкие детали
  const refF = new Uint8Array(W * H), refB = new Uint8Array(W * H), refTab = [null], refMap = new Map();
  const texRefId = (o, x, y) => {
    const T2 = o.tT, dx = ((Math.round(o.tsx - x) % T2.w) + T2.w) % T2.w, dy = ((Math.round(o.tsy - y) % T2.h) + T2.h) % T2.h, key = T2.name + ':' + dx + ':' + dy;
    let id = refMap.get(key); if (id === undefined) { if (refTab.length > 254) return 0; id = refTab.length; refTab.push({ name: T2.name, dx, dy, w: T2.w, h: T2.h }); refMap.set(key, id); }
    return id;
  };
  T.texRef = { F: refF, B: refB, tab: refTab };
  let hasBack = false; for (let i = 0; i < N; i++) if (back[i] && !m[i]) { hasBack = true; break; }
  const bimg = hasBack ? T.dctx.createImageData(W, H) : null; const bpx = bimg ? bimg.data : null;
  const gimg = T.gctx ? new Uint8ClampedArray(N * 4) : null;
  const o = { r: 0, g: 0, b: 0, n1: 0, ga: 0, gr: 0, gg: 0, gb: 0, cap: false, spec: 0 };
  const t2 = S.tiles.t2;
  const LX = LIGHT.x, LY = LIGHT.y, LZ = LIGHT.z, KN = 1 / 26;
  const hl0 = Math.hypot(LX, LY, LZ + 1), HX = LX / hl0, HY = LY / hl0, HZ = (LZ + 1) / hl0;
  for (let y = 0; y < H; y++) {
    const ty2 = ((y >> 1) & 255) << 8;
    const oyf = y / 4 - 0.5, oy0 = Math.max(0, Math.floor(oyf)), fy = Math.max(0, oyf - oy0), oyR = oy0 * OW, oyR1 = Math.min(OH - 1, oy0 + 1) * OW;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const isSolid = m[i];
      if (!isSolid && !(bpx && back[i])) {
        // маленькие сквозные окна в деревянных стенах: тёплое стекло с переплётом и свечением
        if (S.glass && bpx && x > 14 && y > 14 && x < W - 14 && y < H - 14) {
          const wl = (k) => m[k] || back[k];
          let l = 0, rr = 0, u = 0, dn = 0; for (let q = 1; q <= 14; q++) { if (!l && wl(i - q)) l = q; if (!rr && wl(i + q)) rr = q; if (!u && wl(i - q * W)) u = q; if (!dn && wl(i + q * W)) dn = q; }
          const wm = (k) => m[k] ? mat[k] : back[k];
          if (l && rr && u && dn && l + rr < 24 && u + dn < 26 && wm(i - l) === 4 && wm(i + rr) === 4) {
            const fx = l / (l + rr), fy = u / (u + dn), j = i * 4, tone = 0.8 + fy * 0.3;
            let gr = 255 * tone, gg = 196 * tone, gb = 110 * tone;
            if (Math.abs(fx - 0.5) < 0.07 || Math.abs(fy - 0.45) < 0.06) { gr = 70; gg = 44; gb = 22; }
            if (fx < 0.3 && fy < 0.35) { gr += 30; gg += 30; gb += 30; }
            bpx[j] = gr; bpx[j + 1] = gg; bpx[j + 2] = gb; bpx[j + 3] = 255;
            if (gimg) { gimg[j] = 255; gimg[j + 1] = 170; gimg[j + 2] = 80; gimg[j + 3] = 200; }
          }
        }
        continue;
      }
      const oxf = x / 4 - 0.5, ox0 = Math.max(0, Math.floor(oxf)), fx = Math.max(0, oxf - ox0), ox1 = Math.min(OW - 1, ox0 + 1);
      const occ = (OCC[oyR + ox0] * (1 - fx) + OCC[oyR + ox1] * fx) * (1 - fy) + (OCC[oyR1 + ox0] * (1 - fx) + OCC[oyR1 + ox1] * fx) * fy;
      if (isSolid) {
        const mt0 = mat[i] || 1, mt = mt0 === 1 && S.rockDirt ? 2 : mt0; const dd = D[i], d = dd / 3, t = TD[i];
        const capT = capMat[mt] ? capThick * (S.grassy ? 0.78 + 0.44 * capN[x] : 0.5 + capN[x] * capN[x] * 1.3) + capS[x] * 2.6 + (t2[ty2 | ((x >> 1) & 255)] - 0.5) * 4 + fringe[x] : 0;
        shadeMaterial(S, mt, x, y, t, capT, d, infos[sid[i]] || infos[0], o, false);
        // пол внутри здания: над поверхностью — задняя стена помещения. Верх перекрытия выстлан досками (или плиткой в бетоне),
        // со светлой кромкой и тёмным швом снизу — чтобы пол не сливался со стенами
        if (mt >= 3 && mt <= 6 && t < 8 && back && y - t - 2 >= 0 && back[i - (t + 2) * W] && !m[i - (t + 2) * W] && !o.emit) {
          const WT = TexLib.data.wood_light;
          if (mt === 5 || mt === 6) { const tl2 = ((x >> 4) + (y >> 3)) & 1; const v = 118 + tl2 * 16 + o.n1 * 14; o.r = v; o.g = v * 0.97; o.b = v * 0.92; if ((x & 15) === 0) { o.r *= 0.6; o.g *= 0.6; o.b *= 0.6; } }
          else if (WT) { texAt(WT, x * 1.0, y * 2 + 37, o); o.r *= 1.05; o.g *= 0.98; o.b *= 0.9; }
          else { o.r = 150; o.g = 104; o.b = 62; }
          if (t < 1.2) { o.r = o.r * 0.6 + 255 * 0.4; o.g = o.g * 0.6 + 236 * 0.4; o.b = o.b * 0.6 + 200 * 0.4; }   // освещённая кромка пола
          else if (t >= 6.5) { o.r *= 0.35; o.g *= 0.35; o.b *= 0.35; }   // тёмный шов между полом и перекрытием
          o.tex = true; o.tT = null;
        }
        let r = o.r, g = o.g, bl = o.b;
        // объём: нормаль из размытой высоты
        const hl = x > 0 ? HF[i - 1] : 0, hr = x < W - 1 ? HF[i + 1] : 0, hu = y > 0 ? HF[i - W] : 0, hd = y < H - 1 ? HF[i + W] : 255;
        let nx = (hl - hr) * KN, ny = (hu - hd) * KN; const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1); nx *= inv; ny *= inv; const nz = inv;
        const lam = nx * LX + ny * LY + nz * LZ;
        let f = 1 + (lam - LZ) * 1.05; if (f < 0.5) f = 0.5;
        // затенение впадин и глубина массива
        const aoW = d < 36 ? 1 : d > 90 ? 0 : 1 - (d - 36) / 54;
        f *= 1 + aoW * (occ < 0.5 ? (0.5 - occ) * 0.34 : -(occ - 0.5) * (mt === 3 ? 0.3 : 0.62));
        if (d > 14) f *= 1 - Math.min(1, (d - 14) / 260) * (mt === 1 ? 0.26 : mt >= 3 && mt <= 6 ? 0.12 : 0.4);                 // глубина массива заметно темнее — объём как в CGI
        if (BD[i] < 10 && mt !== 8) f *= 0.7 + BD[i] * 0.03;                  // низ навесов темнее
        const shd = dd <= 30 ? shadowAt(x, y) : 0;                              // отброшенная тень
        if (shd > 0.02) f *= 1 - shd * (mt === 3 ? 0.18 : 0.42);
        // блик на гладких материалах
        if (o.spec > 0) { const sp = nx * HX + ny * HY + nz * HZ, base = HZ; if (sp > base) { const k = Math.min(1, (sp - base) / (1 - base)); const s = k * k * 120 * o.spec; r += s; g += s; bl += s; } }
        if (o.tex) f = 1 + (f - 1) * 0.55;                                     // в текстуре из Blender свет уже есть — наш только поддерживает форму
        // тёплый свет — холодная тень
        const w = f - 1;
        if (w > 0) { r = r * f + w * 24; g = g * f + w * 12; bl = bl * f - w * 6; }
        else { r = r * f + w * 8; g = g * f + w * 6; bl = bl * f - w * 5; }
        if (shd > 0.02) { r -= shd * 6; g -= shd * 3; bl += shd * 5; }     // тень холоднее: отражённый свет неба
        // контур и контровой ободок
        if (dd <= 3) {
          if (o.cap && t < 2) { r *= 1.08; g *= 1.08; bl *= 1.08; }
          else { r = r * 0.45 + outl[0] * 0.55; g = g * 0.45 + outl[1] * 0.55; bl = bl * 0.45 + outl[2] * 0.55; }
        } else if (dd <= 9 && !o.cap && lam < LZ - 0.12) {
          const k = (1 - (dd - 3) / 6) * Math.min(1, (LZ - 0.12 - lam) * 2.2) * S.rimK;
          r += (rim[0] - r) * k; g += (rim[1] - g) * k; bl += (rim[2] - bl) * k;
        }
        // неоновая подсветка кромок зданий (ночной город): розовая и голубая по кварталам
        if (S.neon && dd > 3 && dd <= 9 && !o.cap) { const nc = S.neon[(x >> 8) & 1], q = 1 - (dd - 3) / 6, k = q * q * 0.85; r += (nc[0] - r) * k; g += (nc[1] - g) * k; bl += (nc[2] - bl) * k; if (gimg && q > 0.5) { const j2 = i * 4; gimg[j2] = nc[0]; gimg[j2 + 1] = nc[1]; gimg[j2 + 2] = nc[2]; gimg[j2 + 3] = 150 * q; } }
        // отражённый свет неба: поверхность получает оттенок горизонта — передний план в тон картине
        if (dd < 60 && ny < 0 && !(o.cap && S.grassy)) { const kb = (1 - dd / 60) * Math.min(1, -ny * 2.5) * 0.16; r += (bounce[0] - r) * kb; g += (bounce[1] - g) * kb; bl += (bounce[2] - bl) * kb; }
        if (!o.tex) r += (r - 118) * 0.12, g += (g - 118) * 0.12, bl += (bl - 118) * 0.12;   // S-кривая: глубже тени, ярче свет
        // солнечный тёплый тон у освещённой поверхности
        if (dd < 50) { const kw = (1 - dd / 50) * (1 - shd) * 0.9; r *= 1 + kw * 0.08; g *= 1 + kw * 0.025; bl *= 1 - kw * 0.08; }
        if (o.emit) { r = o.r * 1.05; g = o.g * 1.02; bl = o.b; }                    // светящиеся окна не темнеют от теней и глубины
        const j = i * 4; px[j] = r; px[j + 1] = g; px[j + 2] = bl; px[j + 3] = 255;
        if (o.tT && !o.emit) refF[i] = texRefId(o, x, y);
        if (o.ga > 0 && gimg) { gimg[j] = o.gr; gimg[j + 1] = o.gg; gimg[j + 2] = o.gb; gimg[j + 3] = o.ga; }
      } else {
        shadeMaterial(S, back[i] === 1 || back[i] === 2 ? 12 : back[i], x, y, 60000, 0, 99, infos[bsid[i]] || infos[0], o, true);   // земляные пещеры — стены из плитняка
        let wd = 24; for (let q = 1; q < 24; q++) { if ((y - q >= 0 && m[i - q * W]) ) { wd = Math.min(wd, q); break; } } for (let q = 1; q < wd; q++) { if ((x - q >= 0 && m[i - q]) || (x + q < W && m[i + q])) { wd = Math.min(wd, q * 1.3); break; } }
        const k = back[i] === 3 ? 0.97 * (0.86 + 0.14 * Math.min(1, wd / 24)) * (1 - shadowAt(x, y) * 0.12) * (1 + o.n1 * 0.04) : (back[i] <= 2 ? (0.3 + (1 - occ) * 0.5) * S.backK : back[i] === 3 ? 0.78 + (1 - occ) * 0.2 : 0.56 + (1 - occ) * 0.4) * (1 + o.n1 * 0.05) * (1 - shadowAt(x, y) * 0.3) * (back[i] === 3 ? 0.7 + 0.3 * Math.min(1, wd / 24) : 0.4 + 0.6 * Math.min(1, wd / 24)) * caveAO(m, i, W, y, back[i], H) * (back[i] <= 2 ? 1.3 : 1); const j = i * 4;
        bpx[j] = o.r * k + tint[0] * 0.12; bpx[j + 1] = o.g * k + tint[1] * 0.12; bpx[j + 2] = o.b * k + tint[2] * 0.14; bpx[j + 3] = 255;
        if (o.tT && !o.emit) refB[i] = texRefId(o, x, y);
        if (o.emit) { bpx[j] = o.r * 0.88; bpx[j + 1] = o.g * 0.86; bpx[j + 2] = o.b * 0.84; if (gimg) { gimg[j] = o.gr; gimg[j + 1] = o.gg; gimg[j + 2] = o.gb; gimg[j + 3] = o.ga; } }
      }
    }
  }
  sharpen(img.data, W, H, 0.55); if (bimg) sharpen(bimg.data, W, H, 0.4);   // камера увеличивает карту — заранее подчёркиваем мелкую фактуру
  T.ctx.putImageData(img, 0, 0);
  if (bimg) {
    T.dctx.putImageData(bimg, 0, 0);
    const sw2 = Math.ceil(W / 2), sh2 = Math.ceil(H / 2);
    const sil = makeCanvas(sw2, sh2); const sc = sil.getContext('2d');
    sc.filter = 'blur(5px) brightness(0)'; sc.drawImage(T.canvas, 0, 0, sw2, sh2); sc.filter = 'none';
    const dc = T.dctx; dc.save(); dc.globalCompositeOperation = 'source-atop'; dc.globalAlpha = 0.42; dc.drawImage(sil, 6, 8, W, H); dc.restore();
  }
  if (gimg) {
    const tmp = makeCanvas(W, H); tmp.getContext('2d').putImageData(new ImageData(gimg, W, H), 0, 0);
    const g = T.gctx; g.save(); g.filter = 'blur(4px)'; g.drawImage(tmp, 0, 0); g.filter = 'none'; g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55; g.drawImage(tmp, 0, 0); g.restore();
  }
  const tops = [], ceils = [];
  for (let x = 0; x < W; x++) {
    for (let y = 1, i = W + x; y < H - 1; y++, i += W) {
      if (m[i]) { if (!m[i - W]) tops.push(x, y); if (!m[i + W]) ceils.push(x, y); }
    }
  }
  drawSurfaceDetails(T, theme, seed, waterY, tops, ceils, mat);
  placeDecor(T, theme, map, waterY, tops, mat);
  T.version++;
}

function drawSurfaceDetails(T, theme, seed, waterY, tops, ceils, mat) {
  const c = T.ctx, gc = T.gctx, G = theme.ground; const rng = makeRng(seed ^ 0x1234567);
  const W = T.W;
  const beachY = G.cap.beach ? waterY - G.cap.beach.range : 1e9;
  const flatTop = (x, y) => T.isSolid(x - 2, y + 3) && T.isSolid(x + 2, y + 3);
  const matAt = (x, y) => mat[y * W + x];
  const grassTex = G.tex && G.tex.grass && TexLib.data[G.tex.grass];
  if (grassTex) {
    // фотореалистичная трава из Blender: столбик полосы на каждый пиксель поверхности, корни уходят в землю
    const gh = grassTex.h, gw = grassTex.w, img = grassTex.canvas;
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (y > waterY - 4 || y > beachY || matAt(x, y) !== 1) continue;
      c.drawImage(img, ((x % gw) + gw) % gw, 0, 1, gh, x, y + 7 - gh, 1, gh);
    }
  }
  if (G.cap.blades && !grassTex) {
    // пучки травы: три слоя (тёмный задний, средний, светлый передний), лезвия — сужающиеся листья
    const cols = G.cap.blades; const layers = [new Path2D(), new Path2D(), new Path2D()];
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (y > waterY - 4 || y > beachY || matAt(x, y) !== 1 || !flatTop(x, y)) continue;
      const clump = fbm1(x / 38, seed + 3, 2);
      if (rng() > 0.9 + Math.max(0, clump) * 0.2) continue;
      // пышная трава: высокие густые пучки
      const nb = 3 + ((rng() * (clump > 0.1 ? 6 : 4)) | 0);
      for (let j = 0; j < nb; j++) {
        const h = 11 + rng() * 13 + Math.max(0, clump) * 16, lean = (rng() - 0.5) * 11, w = 1.1 + rng() * 1.3;
        const bx = x + (rng() - 0.5) * 2, L = layers[(rng() * 3) | 0];
        L.moveTo(bx - w, y + 2.5); L.quadraticCurveTo(bx - w * 0.2 + lean * 0.35, y - h * 0.55, bx + lean, y - h);
        L.quadraticCurveTo(bx + w * 0.4 + lean * 0.35, y - h * 0.45, bx + w, y + 2.5); L.closePath();
      }
    }
    // высокие пучки через 20–40 px: травяной край не ровной полосой
    { let nx = -1; for (let k = 0; k < tops.length; k += 2) { const x = tops[k], y = tops[k + 1]; if (x < nx || y > waterY - 4 || y > beachY || matAt(x, y) !== 1 || !flatTop(x, y)) continue; nx = x + 20 + rng() * 20;
      for (let j = 0, nb = 6 + (rng() * 6 | 0); j < nb; j++) { const h = 18 + rng() * 14, lean = (rng() - 0.5) * 14, w = 1.2 + rng() * 1.2, bx = x + (rng() - 0.5) * 7, L = layers[(rng() * 3) | 0];
        L.moveTo(bx - w, y + 2.5); L.quadraticCurveTo(bx - w * 0.2 + lean * 0.35, y - h * 0.55, bx + lean, y - h); L.quadraticCurveTo(bx + w * 0.4 + lean * 0.35, y - h * 0.45, bx + w, y + 2.5); L.closePath(); } } }
    const pick = (i) => cols[Math.min(cols.length - 1, i)];
    c.save();
    c.fillStyle = css(shadec(pick(3), 0.8)); c.fill(layers[0]);
    c.fillStyle = pick(0); c.fill(layers[1]);
    c.fillStyle = css(shadec(pick(2), 1.08)); c.fill(layers[2]);
    c.restore();
    if (G.cap.glowBlades && gc) { gc.save(); gc.globalAlpha = 0.9; gc.fillStyle = pick(2); for (let k = 0; k < tops.length; k += 2) { if (rng() > 0.05) continue; const x = tops[k], y = tops[k + 1]; if (matAt(x, y) !== 1) continue; gc.beginPath(); gc.arc(x + (rng() - 0.5) * 6, y - 8 - rng() * 12, 1.4 + rng() * 1.2, 0, TAU); gc.fill(); } gc.restore(); }
  }
  // кусты: объёмные кроны из нескольких шаров с бликом и тенью у земли
  if (G.cap.blades && !G.cap.snow) {
    const leaf = G.cap.blades; let lastX = -999;
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (x - lastX < 110 || y > waterY - 8 || y > beachY || matAt(x, y) !== 1 || !flatTop(x, y) || rng() > 0.03) continue;
      lastX = x; const R = 13 + rng() * 9, n = 4 + ((rng() * 3) | 0);
      c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(x, y + 1.5, R * 1.5, R * 0.3, 0, 0, TAU); c.fill();
      const blobs = [];
      for (let j = 0; j < n; j++) blobs.push({ x: x + (j / (n - 1) - 0.5) * R * 1.8 + (rng() - 0.5) * 4, y: y - R * (0.45 + Math.sin(j / (n - 1) * Math.PI) * 0.55) + (rng() - 0.5) * 3, r: R * (0.5 + rng() * 0.3) });
      blobs.push({ x: x + (rng() - 0.5) * R * 0.5, y: y - R * 1.05, r: R * 0.55 });
      const bs = !G.cap.bushPal && ['bush1', 'bush2'].map((n) => TexLib.data[n]).filter(Boolean);
      if (bs && bs.length) { const T = bs[(rng() * bs.length) | 0], D = R * 3.6; c.drawImage(T.canvas, x - D / 2, y + 3 - D, D, D); }
      else foliage(c, blobs, G.cap.bushPal || ['#1c3410', '#3c6a1c', '#7aa42c', '#cce060']);
      if (G.cap.flowers && rng() < 0.6) { c.fillStyle = rng.pick(G.cap.flowers); for (let j = 0; j < 6; j++) { c.beginPath(); c.arc(x + (rng() - 0.5) * R * 1.8, y - R * (0.4 + rng() * 0.8), 1.4, 0, TAU); c.fill(); } }
    }
  }
  if (G.cap.flowers) {
    // цветы кучками по 3–7 штук, крупные головки на заметных стеблях
    const flower = (x, y, h, col, sc) => {
      c.strokeStyle = '#3a7a24'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(x, y + 1); c.quadraticCurveTo(x + (rng() - 0.5) * 3, y - h * 0.5, x + (rng() - 0.5) * 2, y - h); c.stroke();
      c.fillStyle = '#4f9a30'; c.beginPath(); c.ellipse(x + 2, y - h * 0.4, 2.4, 1, -0.5, 0, TAU); c.fill();
      c.fillStyle = css(shadec(col, 0.7));
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + 0.3; c.beginPath(); c.arc(x + Math.cos(a) * 2.6 * sc, y - h + Math.sin(a) * 2.6 * sc + 0.5, 2 * sc, 0, TAU); c.fill(); }
      c.fillStyle = col;
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + 0.3; c.beginPath(); c.arc(x + Math.cos(a) * 2.4 * sc - 0.3, y - h + Math.sin(a) * 2.4 * sc - 0.3, 1.65 * sc, 0, TAU); c.fill(); }
      c.fillStyle = '#6a3a10'; c.beginPath(); c.arc(x, y - h, 1.3 * sc, 0, TAU); c.fill();
      c.fillStyle = '#ffd84a'; c.beginPath(); c.arc(x - 0.3, y - h - 0.3, 0.9 * sc, 0, TAU); c.fill();
    };
    if (!grassTex)
    // россыпь мелких полевых цветов по всей траве: цветные точки-головки на коротких стеблях
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (y > waterY - 6 || y > beachY || matAt(x, y) !== 1 || rng() > 0.16 || !flatTop(x, y)) continue;
      const h = 8 + rng() * 14, fx = x + (rng() - 0.5) * 3, col = rng.pick(G.cap.flowers), rr = 1.6 + rng() * 1.4;
      c.strokeStyle = '#3e6e1e'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(fx, y + 1); c.lineTo(fx + (rng() - 0.5) * 2, y - h); c.stroke();
      c.fillStyle = css(shadec(col, 0.7)); c.beginPath(); c.arc(fx + 0.4, y - h + 0.4, rr, 0, TAU); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(fx, y - h, rr * 0.85, 0, TAU); c.fill();
      if (rr > 1.6) { c.fillStyle = '#ffe36b'; c.beginPath(); c.arc(fx, y - h, 0.6, 0, TAU); c.fill(); }
    }
    let nextX = -1;
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (x < nextX || y > waterY - 6 || y > beachY || matAt(x, y) !== 1 || !flatTop(x, y)) continue;
      nextX = x + 40 + rng() * 60; if (rng() < 0.3) continue;
      const col = rng.pick(G.cap.flowers), n = 3 + (rng() * 5 | 0);
      for (let j = 0; j < n; j++) { const fx = x + (rng() - 0.5) * 16; if (!T.isSolid(fx, y + 3) || T.isSolid(fx, y - 3)) continue; flower(fx, y + (rng() - 0.5) * 2, 7 + rng() * 11, rng() < 0.75 ? col : rng.pick(G.cap.flowers), 0.9 + rng() * 0.4); }
    }
  }
  // плющ на кладке: плети свисают с верхней кромки стен и мостов
  if (G.cap.blades && !G.cap.snow && !G.cap.glowBlades) {
    let lastX = -99;
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (matAt(x, y + 2) !== 3 || y > waterY - 8 || x - lastX < 22 + rng() * 26 || rng() > 0.5) continue;
      lastX = x; let len = 18 + rng() * 44; for (let q = 4; q < len; q += 2) if (!T.isSolid(x, y + q)) { len = q - 2; break; }
      if (len < 10) continue;
      const sw = (rng() - 0.5) * 8;
      c.strokeStyle = '#2c4a18'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y + 1); c.quadraticCurveTo(x + sw, y + len * 0.5, x + sw * 0.4, y + len); c.stroke();
      for (let tt = 2; tt < len; tt += 3 + rng() * 2) {
        const u = tt / len, lx = x + sw * 2 * u * (1 - u) + sw * 0.4 * u * u, side = rng() < 0.5 ? -1 : 1, lr = 2.2 + rng() * 1.6 * (1 - u * 0.5);
        const lc = ['#3e6e22', '#4f8a2a', '#64982e', '#7aa83a'][(rng() * 4) | 0];
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(lx + side * 2.6 + 1, y + tt + 1.2, lr, lr * 0.6, side * 0.6, 0, TAU); c.fill();
        c.fillStyle = lc; c.beginPath(); c.ellipse(lx + side * 2.4, y + tt, lr, lr * 0.62, side * 0.6, 0, TAU); c.fill();
        c.fillStyle = 'rgba(220,240,140,0.35)'; c.beginPath(); c.ellipse(lx + side * 2.4 - 0.6, y + tt - 0.5, lr * 0.5, lr * 0.25, side * 0.6, 0, TAU); c.fill();
      }
    }
  }
  // иллюминаторы на корпусе корабля у ватерлинии
  if (theme.id === 'tropical') {
    const py = waterY - 46; let lastP = -999;
    for (let x = 0; x < W; x += 6) {
      if (x - lastP < 150 || py < 0 || matAt(x, py) !== 4) continue;
      let ok = true; for (const [dx, dy] of [[-12, 0], [12, 0], [0, -12], [0, 12]]) if (!T.isSolid(x + dx, py + dy) || matAt(x + dx, py + dy) !== 4) ok = false;
      if (!ok) continue; lastP = x;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.arc(x + 1.5, py + 2, 9, 0, TAU); c.fill();
      const br = c.createLinearGradient(x - 9, py - 9, x + 9, py + 9); br.addColorStop(0, '#d8b068'); br.addColorStop(0.5, '#b08a40'); br.addColorStop(1, '#5a3c16');
      c.fillStyle = br; c.beginPath(); c.arc(x, py, 8.5, 0, TAU); c.fill();
      const gl = c.createRadialGradient(x - 2, py - 2, 1, x, py, 6); gl.addColorStop(0, '#4a6a70'); gl.addColorStop(0.6, '#1a2a30'); gl.addColorStop(1, '#0a1216');
      c.fillStyle = gl; c.beginPath(); c.arc(x, py, 5.8, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(x - 2.2, py - 2.4, 2, 1, -0.6, 0, TAU); c.fill();
      c.fillStyle = '#3a2410'; for (let q = 0; q < 6; q++) { const a = q / 6 * TAU; c.beginPath(); c.arc(x + Math.cos(a) * 7.2, py + Math.sin(a) * 7.2, 0.8, 0, TAU); c.fill(); }
    }
  }
  // крыши и карнизы ночного города: кондиционеры, трубы, антенны
  if (theme.id === 'city') {
    let nextX = -1;
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (x < nextX || y > waterY - 20 || !(matAt(x, y + 2) === 5 || matAt(x, y + 2) === 6 || matAt(x, y + 2) === 1) || !flatTop(x, y) || T.isSolid(x, y - 40) || T.isSolid(x + 24, y - 20) || T.isSolid(x - 8, y - 20)) continue;
      nextX = x + 50 + rng() * 90; const kind = rng();
      if (kind < 0.45) {                                                                     // кондиционер: корпус, решётка, вентилятор
        const w = 22 + rng() * 8, h = 15;
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x - 1, y - 1, w + 3, 2);
        const bg = c.createLinearGradient(0, y - h, 0, y); bg.addColorStop(0, '#8a90a0'); bg.addColorStop(1, '#4a4e5c'); c.fillStyle = bg; c.fillRect(x, y - h, w, h);
        c.fillStyle = '#2a2d36'; c.beginPath(); c.arc(x + w * 0.64, y - h / 2, 5, 0, TAU); c.fill(); c.strokeStyle = '#555a68'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + w * 0.64 - 4, y - h / 2); c.lineTo(x + w * 0.64 + 4, y - h / 2); c.moveTo(x + w * 0.64, y - h / 2 - 4); c.lineTo(x + w * 0.64, y - h / 2 + 4); c.stroke();
        c.strokeStyle = '#6a7080'; c.lineWidth = 0.8; for (let q = 0; q < 4; q++) { c.beginPath(); c.moveTo(x + 2, y - h + 2.5 + q * 2); c.lineTo(x + w * 0.4, y - h + 2.5 + q * 2); c.stroke(); }
        c.fillStyle = '#6a6a90'; c.fillRect(x, y - h, w, 1.5);
      } else if (kind < 0.75) {                                                              // антенна с мигающим огоньком
        const h = 26 + rng() * 20; c.strokeStyle = '#4a4e5c'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.stroke();
        c.lineWidth = 1; for (let q = 1; q < 3; q++) { c.beginPath(); c.moveTo(x - 5 + q, y - h * (0.4 + q * 0.2)); c.lineTo(x + 5 - q, y - h * (0.4 + q * 0.2)); c.stroke(); }
        c.fillStyle = '#ff4060'; c.beginPath(); c.arc(x, y - h, 2.4, 0, TAU); c.fill();
        if (gc) { gc.fillStyle = 'rgba(255,60,90,1)'; gc.beginPath(); gc.arc(x, y - h, 7, 0, TAU); gc.fill(); }
      } else {                                                                               // вытяжная труба с колпаком
        const h = 18 + rng() * 10; const pg = c.createLinearGradient(x - 5, 0, x + 5, 0); pg.addColorStop(0, '#8a90a0'); pg.addColorStop(1, '#3a3e48');
        c.fillStyle = pg; c.fillRect(x - 5, y - h, 10, h); c.fillStyle = '#6a6a90'; c.fillRect(x - 8, y - h - 3, 16, 3); c.fillStyle = '#2e323c'; c.fillRect(x - 8, y - h, 16, 1.5);
      }
    }
  }
  // фонари под деревянными потолками: висят на верёвке, заливают заднюю стену тёплым светом
  {
    let lastL = -999; const dc = T.dctx;
    for (let k = 0; k < ceils.length; k += 2) {
      const x = ceils[k], y = ceils[k + 1];
      if (x - lastL < 230 || matAt(x, y) !== 4 || y > waterY - 60) continue;
      let air = 0; for (let q = 1; q < 50; q++) { if (T.isSolid(x, y + q)) break; air = q; }
      if (air < 44 || T.isSolid(x - 14, y + 20) || T.isSolid(x + 14, y + 20)) continue;
      lastL = x; const ly = y + 16;
      c.strokeStyle = '#3a2614'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x, ly - 5); c.stroke();
      c.fillStyle = '#2a1a0e'; c.fillRect(x - 4, ly - 6, 8, 2); c.fillRect(x - 4, ly + 5, 8, 2);
      const lg = c.createRadialGradient(x, ly, 0.5, x, ly, 5); lg.addColorStop(0, '#fff6c8'); lg.addColorStop(0.6, '#ffc24a'); lg.addColorStop(1, '#d0701e');
      c.fillStyle = lg; c.fillRect(x - 3.5, ly - 4, 7, 9);
      c.strokeStyle = '#2a1a0e'; c.lineWidth = 1; c.strokeRect(x - 3.5, ly - 4, 7, 9); c.beginPath(); c.moveTo(x, ly - 4); c.lineTo(x, ly + 5); c.stroke();
      if (gc) { gc.fillStyle = 'rgba(255,190,90,0.85)'; gc.beginPath(); gc.arc(x, ly, 9, 0, TAU); gc.fill(); }
      if (dc) { dc.save(); dc.globalCompositeOperation = 'source-atop'; const pg = dc.createRadialGradient(x, ly, 4, x, ly + 10, 110);
        pg.addColorStop(0, 'rgba(255,200,110,0.55)'); pg.addColorStop(0.45, 'rgba(255,160,70,0.2)'); pg.addColorStop(1, 'rgba(255,140,60,0)');
        dc.fillStyle = pg; dc.fillRect(x - 120, ly - 110, 240, 230); dc.restore(); }
    }
  }
  // камешки на поверхности
  if (!G.cap.snow) {
    const pebs = G.pebbles;
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (y > waterY - 4 || rng() > 0.012 || !flatTop(x, y) || !(matAt(x, y + 2) === 1 || matAt(x, y + 2) === 2)) continue;
      const rx = 2 + rng() * 3.2, ry = rx * (0.55 + rng() * 0.2), col = rng.pick(pebs);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(x + 1, y + 1.2, rx * 1.1, ry * 0.6, 0, 0, TAU); c.fill();
      const gr = c.createRadialGradient(x - rx * 0.35, y - ry * 0.9, 0.3, x, y - ry * 0.4, rx * 1.2);
      gr.addColorStop(0, css(shadec(col, 1.35))); gr.addColorStop(0.55, col); gr.addColorStop(1, css(shadec(col, 0.55)));
      c.fillStyle = gr; c.beginPath(); c.ellipse(x, y - ry * 0.4, rx, ry, 0, 0, TAU); c.fill();
    }
  }
  if (G.cap.snow) {
    // снежные подушки с бликом
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1]; if (y > waterY - 2 || rng() > 0.3) continue;
      // сугробы: комья разной высоты с голубой тенью снизу и искрами
      const lump = Math.max(0, fbm1(x / 26, seed + 51, 2)) * 5, rx = 3 + rng() * 4, ry = 1.3 + rng() * 1.4 + lump;
      c.fillStyle = '#8aa0c8'; c.beginPath(); c.ellipse(x + 0.8, y + 1.6, rx, ry, 0, 0, TAU); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(x, y + 0.6 - lump * 0.3, rx, ry, 0, 0, TAU); c.fill();
      if (rng() < 0.08) { c.fillStyle = '#e8f6ff'; c.fillRect(x - 0.5, y - ry * 0.6, 1, 1); }
    }
    c.fillStyle = 'rgba(210,240,255,0.95)';
    for (let k = 0; k < tops.length; k += 2) { if (rng() > 0.05) continue; c.fillRect(tops[k] + (rng() - 0.5) * 3, tops[k + 1] + 1 + rng() * 10, 1.2, 1.2); }
  }
  if (G.cap.ash) {
    for (let k = 0; k < tops.length; k += 2) {
      // тлеющая корка: рваные раскалённые трещинки с разрывами, а не бусины
      const x = tops[k], y = tops[k + 1]; if (y > waterY) continue;
      const hot = fbm1(x / 34, seed + 17, 2); if (hot < 0.25 || rng() > 0.35) continue;
      const len = 2 + rng() * 5, yy = y + 1.5 + rng() * 2.5, th = 0.7 + rng() * 1.3 * hot;
      c.strokeStyle = hot > 0.5 ? '#ffc060' : '#ff8a30'; c.lineWidth = th; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - len * 0.5, yy + (rng() - 0.5) * 1.5); c.lineTo(x, yy + (rng() - 0.5) * 1.5); c.lineTo(x + len * 0.5, yy + (rng() - 0.5) * 1.5); c.stroke();
      if (gc && rng() < 0.3) { gc.fillStyle = `rgba(255,110,30,${0.25 + hot * 0.4})`; gc.beginPath(); gc.ellipse(x, yy, len, 2.2, 0, 0, TAU); gc.fill(); }
    }
  }
  if (G.cap.ripples) {
    c.fillStyle = 'rgba(120,70,30,0.45)';
    for (let k = 0; k < tops.length; k += 2) { if (rng() > 0.03) continue; c.beginPath(); c.ellipse(tops[k], tops[k + 1] + 1, 1.6, 1, 0, 0, TAU); c.fill(); }
    c.strokeStyle = 'rgba(160,100,40,0.2)'; c.lineWidth = 1.2;
    for (let k = 0; k < tops.length; k += 2) { if (rng() > 0.05) continue; const x = tops[k], y = tops[k + 1] + 3 + rng() * 5; c.beginPath(); c.moveTo(x - 4, y); c.quadraticCurveTo(x, y - 1.5, x + 4, y); c.stroke(); }
  }
  if (G.cap.curb) {
    c.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = 0; k < tops.length; k += 2) { const x = tops[k], y = tops[k + 1]; if (matAt(x, y) === 1 && x % 48 === 0) c.fillRect(x, y + 1, 1, 6); }
    // мокрые карнизы: блики от неона и фонарей, лужи на крышах, потёки вниз по фасаду
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1]; if (y > waterY - 4) continue;
      const wet = fbm1(x / 60, seed + 29, 2);
      if (wet > 0.05) { c.fillStyle = `rgba(${wet > 0.4 ? '255,130,230' : '154,176,255'},${0.35 + wet * 0.4})`; c.fillRect(x, y + 0.3, 1, 2); }
      if (flatTop(x, y) && rng() < 0.004) {
        const pw = 10 + rng() * 26, g2 = c.createLinearGradient(x - pw, 0, x + pw, 0);
        g2.addColorStop(0, 'rgba(120,160,220,0)'); g2.addColorStop(0.5, 'rgba(170,200,255,0.4)'); g2.addColorStop(1, 'rgba(120,160,220,0)');
        c.fillStyle = g2; c.beginPath(); c.ellipse(x, y + 1, pw, 1.6, 0, 0, TAU); c.fill();
      }
      if (rng() < 0.01) { const len = 6 + rng() * 26; const g3 = c.createLinearGradient(0, y + 2, 0, y + 2 + len); g3.addColorStop(0, 'rgba(0,0,0,0.3)'); g3.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g3; c.fillRect(x, y + 2, 1.5, len); }
    }
  }
  const kind = G.ceiling; let lastX = -99;
  for (let k = 0; k < ceils.length; k += 2) {
    const x = ceils[k], y = ceils[k + 1];
    if (y > waterY - 4) continue;
    const cm = matAt(x, y);
    if (!(cm === 1 || cm === 2 || cm === 9 || cm === 7)) continue;
    if (kind === 'roots' && cm === 1 && rng() < 0.035) {
      const len = 6 + rng() * 18; c.strokeStyle = rng() < 0.5 ? '#5a3a22' : '#6e4a2c'; c.lineWidth = 1.2 + rng() * 0.9; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + (rng() - 0.5) * 8, y + len * 0.4, x + (rng() - 0.5) * 8, y + len * 0.7, x + (rng() - 0.5) * 6, y + len); c.stroke();
    } else if (kind === 'vines' && rng() < 0.03) {
      const len = 10 + rng() * 34; c.strokeStyle = '#2f7a2a'; c.lineWidth = 1.3;
      const sw = (rng() - 0.5) * 10;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + sw, y + len * 0.6, x + sw * 0.3, y + len); c.stroke();
      for (let tt = 5; tt < len; tt += 5) {
        const u = tt / len; const lx = x + sw * 2 * u * (1 - u) * 1.2 + sw * 0.3 * u * u;
        c.fillStyle = (tt / 5) % 2 ? '#4caf3a' : '#63c24a'; c.beginPath(); c.ellipse(lx + ((tt / 5) % 2 ? 2.2 : -2.2), y + tt, 2.6, 1.3, (tt / 5) % 2 ? 0.5 : -0.5, 0, TAU); c.fill();
      }
    } else if (kind === 'icicles' && x - lastX > 3 + rng() * 9 && rng() < (fbm1(x / 60, seed + 41, 2) > 0.2 ? 0.6 : 0)) {
      lastX = x; const q = rng(), len = 4 + q * q * 22; const w = 1.2 + rng() * 1.4 + len * 0.04;
      const g = c.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.35, 'rgba(207,230,255,0.7)'); g.addColorStop(1, 'rgba(120,170,225,0.45)');
      c.fillStyle = g; c.beginPath(); c.moveTo(x - w, y - 0.5); c.lineTo(x + w, y - 0.5); c.quadraticCurveTo(x + w * 0.3, y + len * 0.6, x + 0.2, y + len); c.quadraticCurveTo(x - w * 0.4, y + len * 0.6, x - w, y - 0.5); c.fill();
    } else if (kind === 'drips' && rng() < 0.05) {
      const len = 3 + rng() * 5; c.fillStyle = theme.id === 'city' ? '#3a3632' : '#b8683a'; c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x + 2, y); c.lineTo(x, y + len); c.closePath(); c.fill();
    } else if (kind === 'stalactites' && rng() < 0.06) {
      const len = 4 + rng() * 12; c.fillStyle = '#1e1817'; c.beginPath(); c.moveTo(x - 2.8, y); c.lineTo(x + 2.8, y); c.quadraticCurveTo(x + 0.8, y + len * 0.6, x, y + len); c.quadraticCurveTo(x - 0.8, y + len * 0.6, x - 2.8, y); c.fill();
      if (gc && rng() < 0.35) { gc.fillStyle = 'rgba(255,110,20,0.9)'; gc.beginPath(); gc.arc(x, y + len - 1, 2.4, 0, TAU); gc.fill(); c.fillStyle = '#ff9a3a'; c.beginPath(); c.arc(x, y + len - 1, 1, 0, TAU); c.fill(); }
    } else if (kind === 'crystals' && rng() < 0.035) {
      const len = 5 + rng() * 10; const col = rng() < 0.5 ? '#5ff4ff' : '#ff6ef6';
      c.fillStyle = col; c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x + 2, y); c.lineTo(x + 1.5, y + len * 0.7); c.lineTo(x, y + len); c.lineTo(x - 1.5, y + len * 0.7); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(x - 1, y, 0.8, len * 0.6);
      if (gc) { gc.fillStyle = col; gc.globalAlpha = 0.6; gc.beginPath(); gc.arc(x, y + len * 0.5, 5, 0, TAU); gc.fill(); gc.globalAlpha = 1; }
    }
  }
}
