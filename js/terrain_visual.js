'use strict';
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

/** цвет материала в точке. Результат в o: r,g,b; свечение ga/gr/gg/gb; блеск spec */
function shadeMaterial(S, mt, x, y, t, capT, d, info, o, isBack) {
  const tl = S.tiles, LX = LIGHT.x, LY = LIGHT.y, LZ = LIGHT.z;
  const ty = (y & 255) << 8, ty2 = ((y >> 1) & 255) << 8, ty3 = ((y >> 2) & 255) << 8;
  const n1 = tl.t1[ty | (x & 255)], n2 = tl.t2[ty2 | ((x >> 1) & 255)], n3 = tl.t3[ty3 | ((x >> 2) & 255)];
  o.n1 = n1; o.ga = 0; o.cap = false; o.spec = 0;
  let r, g, bl;
  if (t < capT) {
    // шапка (трава/снег/песок): светлая кромка, сочная середина, тёмная «губа» снизу
    o.cap = true;
    const k = t / capT; const cc = (S.beach && y - t > S.beachY) ? S.beach : S.capCols;
    if (k < 0.45) { const q = k / 0.45; r = cc[0][0] + (cc[1][0] - cc[0][0]) * q; g = cc[0][1] + (cc[1][1] - cc[0][1]) * q; bl = cc[0][2] + (cc[1][2] - cc[0][2]) * q; }
    else { const q = (k - 0.45) / 0.55; r = cc[1][0] + (cc[2][0] - cc[1][0]) * q; g = cc[1][1] + (cc[2][1] - cc[1][1]) * q; bl = cc[1][2] + (cc[2][2] - cc[1][2]) * q; }
    let f = 0.95 + n2 * 0.1;
    if (t < 1.8) f *= 1.16;
    if (k > 0.8) f *= 1 - (k - 0.8) * 1.4;
    r *= f; g *= f; bl *= f;
  } else if (mt === 1) {
    const sd = t - capT;
    const v = (y + S.colOff[x] + (n3 - 0.5) * 56) / S.band;
    const bi = Math.floor(v), fr = v - bi, L = S.L;
    const c0 = S.strata[((bi % L) + L) % L], c1 = S.strata[(((bi + 1) % L) + L) % L];
    let bm = fr < S.st ? 0 : (fr - S.st) / (1 - S.st); bm = bm * bm * (3 - 2 * bm);
    const lv = 0.93 + n3 * 0.12 + (n2 - 0.5) * 0.05;
    r = (c0[0] + (c1[0] - c0[0]) * bm) * lv; g = (c0[1] + (c1[1] - c0[1]) * bm) * lv; bl = (c0[2] + (c1[2] - c0[2]) * bm) * lv;
    if (sd < S.soilDepth) { const k = sd / S.soilDepth, q = k * k; const so = S.soil; r = so[0] + (r - so[0]) * q; g = so[1] + (g - so[1]) * q; bl = so[2] + (bl - so[2]) * q; }
    if (capT > 0 && sd < 8) { const k = 0.58 + 0.42 * sd / 8; r *= k; g *= k; bl *= k; }        // тень под травяной губой
    if (sd > 10) {                                                                            // скруглённые камни в толще
      const V = S.vs, vi = ((y & 255) << 8) | (x & 255), id = V.id[vi];
      if (V.rnd[id] > 0.62) {
        const rad = V.cell * (0.13 + 0.24 * V.rnd2[id]);
        const ox = -V.vx[vi] * 0.5, oy = -V.vy[vi] * 0.66;
        const e2 = (ox * ox + oy * oy) / (rad * rad);
        if (e2 < 1) {
          const pc = S.pebs[id % S.pebs.length];
          const nz = Math.sqrt(1 - e2), lam = (ox * LX + oy * LY) / rad + nz * LZ;
          let f = 0.6 + 0.55 * lam; if (e2 > 0.74) f *= 0.7; if (lam > 0.93) f += (lam - 0.93) * 4;
          r = pc[0] * f; g = pc[1] * f; bl = pc[2] * f;
        } else if (e2 < 1.7 && oy > rad * 0.2) { const k = 0.72 + (e2 - 1) * 0.4; r *= k; g *= k; bl *= k; }   // тень под камнем
      }
    }
    if (S.veinC && sd > 8) {
      const dv = Math.abs(tl.tv[ty3 | ((x >> 2) & 255)] - 0.5);
      if (dv < S.veinW) {
        const vc = n3 > 0.5 ? S.veinC : S.veinC2, k = 1 - dv / S.veinW, kk = k * 0.85 + 0.15;
        r += (vc[0] - r) * kk; g += (vc[1] - g) * kk; bl += (vc[2] - bl) * kk;
        if (S.veinGlow && !isBack) { o.ga = 255 * k; o.gr = vc[0]; o.gg = vc[1]; o.gb = vc[2]; }
      }
    }
  } else if (mt === 2) {
    // скала: крупные скруглённые плиты с трещинами
    const V = S.vl, vi = ((y & 511) << 9) | (x & 511), id = V.id[vi];
    const rc = S.rockC[id % S.RL], pv = 0.86 + V.rnd[id] * 0.26 + (n3 - 0.5) * 0.08;
    r = rc[0] * pv; g = rc[1] * pv; bl = rc[2] * pv;
    const ed = V.ed[vi];
    if (ed < 7) { const k = 0.42 + ed * 0.03; r *= k; g *= k; bl *= k; }
    else if (ed < 46) {
      const q = 1 - (ed - 7) / 39, ox = -V.vx[vi], oy = -V.vy[vi], ol = Math.sqrt(ox * ox + oy * oy) || 1;
      const f = 1 + q * q * 0.46 * (ox * LX + oy * LY) / ol; r *= f; g *= f; bl *= f;
    }
    const f = 0.97 + (n1 - 0.5) * 0.06; r *= f; g *= f; bl *= f;
    if (S.veinC && t - capT > 8) {
      const dv = Math.abs(tl.tv[ty3 | ((x >> 2) & 255)] - 0.5);
      if (dv < S.veinW) { const vc = n3 > 0.5 ? S.veinC : S.veinC2, k = 1 - dv / S.veinW; r += (vc[0] - r) * k; g += (vc[1] - g) * k; bl += (vc[2] - bl) * k; if (S.veinGlow && !isBack) { o.ga = 255 * k; o.gr = vc[0]; o.gg = vc[1]; o.gb = vc[2]; } }
    }
  } else {
    const P = info.pal, prm = info.prm;
    switch (mt) {
      case 3: { // кладка: скруглённые кирпичи, утопленный раствор
        const lx = x - (prm ? prm.x0 : 0), ly = y - (prm ? prm.y0 : 0);
        const bw = P.w || 20, bh = P.h || 10;
        const row = Math.floor(ly / bh); const off = (row & 1) ? bw * 0.5 : 0;
        const col = Math.floor((lx + off) / bw);
        const fx = lx + off - col * bw, fy = ly - row * bh;
        if (fx < 1.5 || fy < 1.5) { const f = 0.78 + n1 * 0.16; r = P.mortar[0] * f; g = P.mortar[1] * f; bl = P.mortar[2] * f; }
        else {
          const h = hash3(col, row, info.idx * 31 + 7); const c = h > 0.82 ? P.alt : P.base;
          let f = 1 + (h - 0.5) * (P.var || 0.1) * 2 + (n2 - 0.5) * 0.08;
          if (fy < 3.4) f *= 1.17; else if (fy > bh - 2.4) f *= 0.72;
          if (fx < 3) f *= 1.07; else if (fx > bw - 2.2) f *= 0.82;
          f *= 1.05 - (fy / bh) * 0.1;
          r = c[0] * f; g = c[1] * f; bl = c[2] * f;
          if (h < 0.05 && n3 > 0.5) { r = r * 0.7 + 30; g = g * 0.7 + 52; bl = bl * 0.7 + 18; }  // мох
        }
        break;
      }
      case 4: { // доски со скруглёнными краями
        const ph = P.plank || 8; const ly = y - (prm ? prm.y0 : 0);
        const row = Math.floor(ly / ph), fy = ly - row * ph;
        const off = hash3(row, 3, info.idx) * 90; const segL = 70;
        const seg = Math.floor((x + off) / segL), fx = x + off - seg * segL;
        if (fy < 1.1 || fx < 1.2) { r = P.gap[0]; g = P.gap[1]; bl = P.gap[2]; }
        else {
          const h = hash3(seg, row, info.idx + 5);
          const gr = tl.tg[((y & 255) << 8) | ((x >> 1) & 255)];
          let f = 0.9 + h * (P.var || 0.16) * 1.4 + (gr - 0.5) * 0.3;
          if (fy < 2.6) f *= 1.18; else if (fy > ph - 2) f *= 0.72;
          if (fx < 2.4) f *= 1.06; else if (fx > segL - 2) f *= 0.8;
          r = P.base[0] * f; g = P.base[1] * f; bl = P.base[2] * f;
          if (((fx > 2.5 && fx < 4.2) || (fx > segL - 4.2 && fx < segL - 2.5)) && fy > ph * 0.5 - 1 && fy < ph * 0.5 + 0.8) { r = 60; g = 52; bl = 46; o.spec = 0.6; }
        }
        break;
      }
      case 5: { // бетон, окна, дорога
        const base = P.base; const f = 0.9 + n2 * 0.12 + (n3 - 0.5) * 0.1;
        r = base[0] * f; g = base[1] * f; bl = base[2] * f;
        if (P.road && prm) {
          const ly = y - prm.y0;
          if (ly < 6) { r = 44 + n1 * 12; g = 46 + n1 * 12; bl = 54 + n1 * 12; if (ly >= 2 && ly < 3.5 && (x % 44) < 22) { r = 240; g = 206; bl = 80; } }
          else if (x % 90 < 2) { r *= 0.68; g *= 0.68; bl *= 0.68; }
        } else if (P.cornice) { r *= 1.18; g *= 1.18; bl *= 1.18; }
        else if (P.win && prm) {
          const lx = x - prm.x0, ly = y - prm.y0;
          const cw = 26, fh = 34, mx = 12, my = 16;
          const cols = Math.max(1, Math.floor((prm.w - 2 * mx + 12) / cw));
          const col = Math.floor((lx - mx) / cw), fl = Math.floor((ly - my) / fh);
          const fx = (lx - mx) - col * cw, fy = (ly - my) - fl * fh;
          if (lx >= mx && col >= 0 && col < cols && fx < 14 && ly >= my && fy < 19) {
            if (hash3(col, fl, info.idx * 13 + 1) < P.lit) {
              const k = 0.82 + fy / 19 * 0.3; r = P.win[0] * k; g = P.win[1] * k; bl = P.win[2] * k;
              if (!isBack) { o.ga = 160; o.gr = P.win[0]; o.gg = P.win[1]; o.gb = P.win[2]; }
              if (fx > 6 && fx < 7.4) { r *= 0.75; g *= 0.75; bl *= 0.75; }
            } else {
              r = P.dark[0]; g = P.dark[1]; bl = P.dark[2];
              if ((fx + fy) % 17 < 2) { r += 30; g += 34; bl += 48; }
            }
            if (fx < 1 || fy < 1) { r *= 0.6; g *= 0.6; bl *= 0.6; }
            else if (fy > 17.6) { r = r * 0.5 + 60; g = g * 0.5 + 62; bl = bl * 0.5 + 68; }       // подоконник
          } else if (ly > 0 && (ly - my + 1) % fh > fh - 4) { r *= 0.8; g *= 0.8; bl *= 0.8; }
          else if (lx % 60 < 1.5) { r *= 0.86; g *= 0.86; bl *= 0.86; }
        }
        break;
      }
      case 6: { // металл: панели с фаской, заклёпки, глянцевая полоса
        const pw = (P.plate && P.plate[0]) || 30, phh = (P.plate && P.plate[1]) || 16;
        const fx = ((x % pw) + pw) % pw, fy = ((y % phh) + phh) % phh;
        const u = fy / phh;
        let f = (0.86 + 0.34 * Math.exp(-(u - 0.3) * (u - 0.3) * 30)) * (0.97 + (n1 - 0.5) * 0.05);
        r = P.base[0] * f; g = P.base[1] * f; bl = P.base[2] * f; o.spec = 0.7;
        if (fx < 1.2 || fy < 1.2) { r *= 0.5; g *= 0.5; bl *= 0.5; o.spec = 0; }
        else if (fx < 2.6 || fy < 2.6) { r *= 1.16; g *= 1.16; bl *= 1.16; }
        else if (fx > pw - 2.2 || fy > phh - 2.2) { r *= 0.78; g *= 0.78; bl *= 0.78; }
        const rx = fx < pw / 2 ? fx - 4 : fx - (pw - 4), ry = fy - 4.2, rr = rx * rx + ry * ry;
        if (rr < 2.6) { const k = 1.25 - rr * 0.12 - (rx + ry) * 0.12; r *= k; g *= k; bl *= k; }
        if (n3 > 0.66) { const k = Math.min(1, (n3 - 0.66) * 6) * 0.75; r += (P.rust[0] - r) * k; g += (P.rust[1] - g) * k; bl += (P.rust[2] - bl) * k; o.spec *= 1 - k; }
        break;
      }
      case 7: { // лёд: светлый у поверхности, густо-синий в толще, трещинки и искры
        const A = S.iceA, B = S.iceB, k = Math.min(1, d / 64) * 0.75 + n3 * 0.25;
        r = A[0] + (B[0] - A[0]) * k; g = A[1] + (B[1] - A[1]) * k; bl = A[2] + (B[2] - A[2]) * k;
        const dv = Math.abs(tl.tv[ty2 | ((x >> 1) & 255)] - 0.5); if (dv < 0.01) { r = 236; g = 250; bl = 255; }
        if (hash3(x, y, 5) > 0.997) { r = g = bl = 255; }
        o.spec = 0.9;
        break;
      }
      case 8: { // кристалл: грани и свечение
        const cs = 18; const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
        const h = hash3(cx, cy, 9); const A = P.a || [95, 244, 255], B = P.b || [184, 108, 255];
        r = A[0] + (B[0] - A[0]) * h; g = A[1] + (B[1] - A[1]) * h; bl = A[2] + (B[2] - A[2]) * h;
        const u = (x - cx * cs) / cs, v = (y - cy * cs) / cs;
        const facet = (u + v < 1) ? 0.66 + (u + v) * 0.3 : 1.06 - (u + v - 1) * 0.36;
        r *= facet; g *= facet; bl *= facet;
        if (Math.abs(u - v) < 0.05) { r = Math.min(255, r * 1.35); g = Math.min(255, g * 1.35); bl = Math.min(255, bl * 1.35); }
        if (!isBack) { o.ga = 70 + h * 60; o.gr = r; o.gg = g; o.gb = bl; }
        o.spec = 1;
        break;
      }
      case 9: { // базальтовые столбы со скруглёнными гранями
        const cw = 16; const col = Math.floor(x / cw); const hh = hash3(col, 0, 4);
        const fx = x - col * cw; const yy = y + hh * 60; const seg = Math.floor(yy / 46); const fy = yy - seg * 46;
        const c = S.rockC[col % S.RL]; let f = 0.86 + hash3(col, seg, 8) * 0.28;
        if (fx < 1.4) f *= 0.42; else if (fx < 4) f *= 1.22; else if (fx > cw - 3.4) f *= 0.72;
        if (fy < 1.4) f *= 0.5; else if (fy < 3.4) f *= 1.12;
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

  const seed = map.seed || 1;
  const colOff = new Float32Array(W), capN = new Float32Array(W), capS = new Float32Array(W);
  for (let x = 0; x < W; x++) { colOff[x] = fbm1(x / 420, seed + 5, 3) * 28; capN[x] = (fbm1(x / 55, seed + 7, 2) + 1) * 0.5; capS[x] = Math.abs(Math.sin(x * 0.2 + capN[x] * 9)); }
  const capMat = new Uint8Array(16); for (const k of (G.capMats || [1])) capMat[k] = 1;
  const V = getVoronoi();
  const S = {
    tiles: getTiles(), colOff, vs: V.s, vl: V.l,
    capCols: G.cap.cols.map(hex2rgb), beach: G.cap.beach ? G.cap.beach.cols.map(hex2rgb) : null,
    beachY: G.cap.beach ? waterY - G.cap.beach.range : 1e9,
    strata: G.strata.map(hex2rgb), L: G.strata.length,
    rockC: (G.rock || G.strata).map(hex2rgb), RL: (G.rock || G.strata).length,
    soil: hex2rgb(G.soil), soilDepth: G.soilDepth, pebs: G.pebbles.map(hex2rgb),
    veinC: G.veins ? hex2rgb(G.veins.color) : null, veinC2: G.veins ? hex2rgb(G.veins.color2 || G.veins.color) : null,
    veinW: G.veins ? G.veins.w : 0, veinGlow: !!(G.veins && G.veins.glow),
    band: G.band, st: 1 - (1 - G.bandSharp) * 0.6,
    iceA: [226, 246, 255], iceB: [92, 158, 214],
  };
  const outl = hex2rgb(G.outline); const capThick = G.cap.thick * 1.45;
  const rim = hex2rgb(G.rim || theme.sky[1]);
  const tint = hex2rgb(theme.backTint || '#0a0e1a');
  const img = T.ctx.createImageData(W, H); const px = img.data;
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
      if (!isSolid && !(bpx && back[i])) continue;
      const oxf = x / 4 - 0.5, ox0 = Math.max(0, Math.floor(oxf)), fx = Math.max(0, oxf - ox0), ox1 = Math.min(OW - 1, ox0 + 1);
      const occ = (OCC[oyR + ox0] * (1 - fx) + OCC[oyR + ox1] * fx) * (1 - fy) + (OCC[oyR1 + ox0] * (1 - fx) + OCC[oyR1 + ox1] * fx) * fy;
      if (isSolid) {
        const mt = mat[i] || 1; const dd = D[i], d = dd / 3, t = TD[i];
        const capT = capMat[mt] ? capThick * (0.78 + 0.44 * capN[x]) + capS[x] * 2.6 + (t2[ty2 | ((x >> 1) & 255)] - 0.5) * 4 : 0;
        shadeMaterial(S, mt, x, y, t, capT, d, infos[sid[i]] || infos[0], o, false);
        let r = o.r, g = o.g, bl = o.b;
        // объём: нормаль из размытой высоты
        const hl = x > 0 ? HF[i - 1] : 0, hr = x < W - 1 ? HF[i + 1] : 0, hu = y > 0 ? HF[i - W] : 0, hd = y < H - 1 ? HF[i + W] : 255;
        let nx = (hl - hr) * KN, ny = (hu - hd) * KN; const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1); nx *= inv; ny *= inv; const nz = inv;
        const lam = nx * LX + ny * LY + nz * LZ;
        let f = 1 + (lam - LZ) * 1.05; if (f < 0.5) f = 0.5;
        // затенение впадин и глубина массива
        const aoW = d < 36 ? 1 : d > 90 ? 0 : 1 - (d - 36) / 54;
        f *= 1 + aoW * (occ < 0.5 ? (0.5 - occ) * 0.34 : -(occ - 0.5) * 0.62);
        if (d > 22) f *= 1 - Math.min(1, (d - 22) / 280) * 0.3;
        if (BD[i] < 10 && mt !== 8) f *= 0.7 + BD[i] * 0.03;                  // низ навесов темнее
        // блик на гладких материалах
        if (o.spec > 0) { const sp = nx * HX + ny * HY + nz * HZ, base = HZ; if (sp > base) { const k = Math.min(1, (sp - base) / (1 - base)); const s = k * k * 120 * o.spec; r += s; g += s; bl += s; } }
        // тёплый свет — холодная тень
        const w = f - 1;
        if (w > 0) { r = r * f + w * 24; g = g * f + w * 12; bl = bl * f - w * 6; }
        else { r = r * f + w * 16; g = g * f + w * 6; bl = bl * f - w * 22; }
        // контур и контровой ободок
        if (dd <= 3) {
          if (o.cap && t < 2) { r *= 1.08; g *= 1.08; bl *= 1.08; }
          else { r = r * 0.45 + outl[0] * 0.55; g = g * 0.45 + outl[1] * 0.55; bl = bl * 0.45 + outl[2] * 0.55; }
        } else if (dd <= 9 && !o.cap && lam < LZ - 0.12) {
          const k = (1 - (dd - 3) / 6) * Math.min(1, (LZ - 0.12 - lam) * 2.2) * 0.42;
          r += (rim[0] - r) * k; g += (rim[1] - g) * k; bl += (rim[2] - bl) * k;
        }
        const j = i * 4; px[j] = r; px[j + 1] = g; px[j + 2] = bl; px[j + 3] = 255;
        if (o.ga > 0 && gimg) { gimg[j] = o.gr; gimg[j + 1] = o.gg; gimg[j + 2] = o.gb; gimg[j + 3] = o.ga; }
      } else {
        shadeMaterial(S, back[i], x, y, 60000, 0, 99, infos[bsid[i]] || infos[0], o, true);
        const k = 0.26 + (1 - occ) * 0.3 + o.n1 * 0.05; const j = i * 4;
        bpx[j] = o.r * k + tint[0] * 0.2; bpx[j + 1] = o.g * k + tint[1] * 0.2; bpx[j + 2] = o.b * k * 1.06 + tint[2] * 0.24; bpx[j + 3] = 255;
      }
    }
  }
  T.ctx.putImageData(img, 0, 0);
  if (bimg) {
    T.dctx.putImageData(bimg, 0, 0);
    const sw2 = Math.ceil(W / 2), sh2 = Math.ceil(H / 2);
    const sil = makeCanvas(sw2, sh2); const sc = sil.getContext('2d');
    sc.filter = 'blur(5px) brightness(0)'; sc.drawImage(T.canvas, 0, 0, sw2, sh2); sc.filter = 'none';
    const dc = T.dctx; dc.save(); dc.globalCompositeOperation = 'source-atop'; dc.globalAlpha = 0.7; dc.drawImage(sil, 7, 10, W, H); dc.restore();
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
  if (G.cap.blades) {
    // пучки травы: три слоя (тёмный задний, средний, светлый передний), лезвия — сужающиеся листья
    const cols = G.cap.blades; const layers = [new Path2D(), new Path2D(), new Path2D()];
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (y > waterY - 4 || y > beachY || matAt(x, y) !== 1 || !flatTop(x, y)) continue;
      const clump = fbm1(x / 38, seed + 3, 2);
      if (rng() > 0.42 + Math.max(0, clump) * 0.5) continue;
      const nb = 1 + ((rng() * (clump > 0.1 ? 3 : 2)) | 0);
      for (let j = 0; j < nb; j++) {
        const h = 4 + rng() * 6 + Math.max(0, clump) * 10, lean = (rng() - 0.5) * 6, w = 0.9 + rng() * 0.9;
        const bx = x + (rng() - 0.5) * 2, L = layers[(rng() * 3) | 0];
        L.moveTo(bx - w, y + 2.5); L.quadraticCurveTo(bx - w * 0.2 + lean * 0.35, y - h * 0.55, bx + lean, y - h);
        L.quadraticCurveTo(bx + w * 0.4 + lean * 0.35, y - h * 0.45, bx + w, y + 2.5); L.closePath();
      }
    }
    const pick = (i) => cols[Math.min(cols.length - 1, i)];
    c.save();
    c.fillStyle = css(shadec(pick(3), 0.8)); c.fill(layers[0]);
    c.fillStyle = pick(0); c.fill(layers[1]);
    c.fillStyle = css(shadec(pick(2), 1.08)); c.fill(layers[2]);
    c.restore();
    if (G.cap.glowBlades && gc) { gc.save(); gc.globalAlpha = 0.55; gc.fillStyle = pick(2); gc.fill(layers[2]); gc.fill(layers[1]); gc.restore(); }
  }
  if (G.cap.flowers) {
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (y > waterY - 6 || y > beachY || rng() > 0.016 || matAt(x, y) !== 1 || !flatTop(x, y)) continue;
      const h = 5 + rng() * 6; const col = rng.pick(G.cap.flowers);
      c.strokeStyle = '#3f8f2a'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y + 1); c.quadraticCurveTo(x + (rng() - 0.5) * 3, y - h * 0.5, x + (rng() - 0.5) * 2, y - h); c.stroke();
      c.fillStyle = css(shadec(col, 0.75));
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + 0.3; c.beginPath(); c.arc(x + Math.cos(a) * 2.1, y - h + Math.sin(a) * 2.1 + 0.4, 1.7, 0, TAU); c.fill(); }
      c.fillStyle = col;
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + 0.3; c.beginPath(); c.arc(x + Math.cos(a) * 2 - 0.3, y - h + Math.sin(a) * 2 - 0.3, 1.35, 0, TAU); c.fill(); }
      c.fillStyle = '#ffe36b'; c.beginPath(); c.arc(x, y - h, 1.2, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.arc(x - 0.4, y - h - 0.4, 0.45, 0, TAU); c.fill();
    }
  }
  // камешки на поверхности
  if (!G.cap.snow) {
    const pebs = G.pebbles;
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1];
      if (y > waterY - 4 || rng() > 0.012 || !flatTop(x, y)) continue;
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
      const rx = 2.4 + rng() * 3, ry = 1.3 + rng() * 1.4;
      c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(x, y + 0.6, rx, ry, 0, 0, TAU); c.fill();
    }
    c.fillStyle = 'rgba(210,240,255,0.95)';
    for (let k = 0; k < tops.length; k += 2) { if (rng() > 0.05) continue; c.fillRect(tops[k] + (rng() - 0.5) * 3, tops[k + 1] + 1 + rng() * 10, 1.2, 1.2); }
  }
  if (G.cap.ash) {
    for (let k = 0; k < tops.length; k += 2) {
      const x = tops[k], y = tops[k + 1]; if (rng() > 0.03 || y > waterY) continue;
      c.fillStyle = '#ffb347'; c.beginPath(); c.arc(x, y + 1 + rng() * 3, 0.9 + rng() * 0.9, 0, TAU); c.fill();
      if (gc) { gc.fillStyle = 'rgba(255,120,30,0.9)'; gc.beginPath(); gc.arc(x, y + 2, 2.8, 0, TAU); gc.fill(); }
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
    } else if (kind === 'icicles' && x - lastX > 2 && rng() < 0.4) {
      lastX = x; const len = 4 + rng() * 13; const w = 1.4 + rng() * 1.6;
      const g = c.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, 'rgba(255,255,255,0.98)'); g.addColorStop(0.5, 'rgba(200,236,255,0.9)'); g.addColorStop(1, 'rgba(120,180,230,0.7)');
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
