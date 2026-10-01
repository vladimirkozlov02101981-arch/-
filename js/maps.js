'use strict';
/* =========================================================
   Карты, нарисованные вручную. Каждая карта статична:
   одна и та же форма, постройки и декор при каждом запуске.
   ========================================================= */
const MAT = { ground: 1, rock: 2, brick: 3, wood: 4, concrete: 5, metal: 6, ice: 7, crystal: 8, basalt: 9 };

/* ---------- конструкторы фигур ---------- */
/* back — за фигурой остаётся тёмная «задняя стена» (пещеры, комнаты);
   through — вырез пробивает и заднюю стену (окна, глазницы) */
const Sh = {
  ground: (pts, o = {}) => ({ kind: 'ground', pts, op: 'add', mat: o.mat || 'ground', rough: o.rough ?? 5, pal: o.pal, back: o.back ?? true }),
  blob: (pts, o = {}) => ({ kind: 'blob', pts, op: o.op || 'add', mat: o.mat || 'ground', rough: o.rough ?? 4, pal: o.pal, back: o.back ?? true, through: o.through }),
  poly: (pts, o = {}) => ({ kind: 'poly', pts, op: o.op || 'add', mat: o.mat || 'brick', rough: o.rough ?? 0, pal: o.pal, params: o.params, back: o.back ?? false, through: o.through }),
  rect: (x, y, w, h, o = {}) => Sh.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], Object.assign({ params: { x0: x, y0: y, w, h } }, o)),
  ellipse: (cx, cy, rx, ry, o = {}) => ({ kind: 'ellipse', cx, cy, rx, ry, rot: o.rot || 0, op: o.op || 'add', mat: o.mat || 'ground', rough: o.rough ?? 3, pal: o.pal, back: o.back ?? false, through: o.through }),
  band: (x1, y1, x2, y2, o = {}) => ({ kind: 'band', x1, y1, x2, y2, thick: o.thick || 12, sag: o.sag || 0, op: o.op || 'add', mat: o.mat || 'wood', rough: o.rough ?? 0, pal: o.pal, back: false }),
  cut: (s, through = false) => { s.op = 'cut'; s.through = through; return s; },
};

/* ---------- сплайны и шероховатость ---------- */
function crPath(pts, closed, step = 6) {
  const n = pts.length, out = [];
  const P = (i) => closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = P(i), p2 = P(i + 1);
    let p0 = P(i - 1), p3 = P(i + 2);
    if (p1[2] || (!closed && i === 0)) p0 = [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]];
    if (p2[2] || (!closed && i === segs - 1)) p3 = [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
function densify(pts, closed, step = 6) {
  const out = []; const n = pts.length; const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n]; const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function roughen(pts, closed, amp, seed) {
  if (!amp) return pts;
  const n = pts.length; const out = new Array(n); let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const d = fbm1(s / 38, seed, 3) * amp + fbm1(s / 9, seed + 99, 2) * amp * 0.35;
    out[i] = [pts[i][0] + ty * d, pts[i][1] - tx * d];
  }
  return out;
}
function shapePoly(sh, seed, H) {
  switch (sh.kind) {
    case 'ground': {
      const p = roughen(crPath(sh.pts, false, 6), false, sh.rough, seed);
      p.push([sh.pts[sh.pts.length - 1][0], H + 30], [sh.pts[0][0], H + 30]);
      return p;
    }
    case 'blob': return roughen(crPath(sh.pts, true, 6), true, sh.rough, seed);
    case 'poly': return sh.rough ? roughen(densify(sh.pts, true, 6), true, sh.rough, seed) : sh.pts;
    case 'ellipse': {
      const n = Math.max(24, Math.ceil(Math.PI * (sh.rx + sh.ry) / 5)); const p = [];
      const cr = Math.cos(sh.rot), sr = Math.sin(sh.rot);
      for (let i = 0; i < n; i++) { const a = i / n * TAU; const x = Math.cos(a) * sh.rx, y = Math.sin(a) * sh.ry; p.push([sh.cx + x * cr - y * sr, sh.cy + x * sr + y * cr]); }
      return roughen(p, true, sh.rough, seed);
    }
    case 'band': {
      const top = [], bot = []; const cx = (sh.x1 + sh.x2) / 2, cy = (sh.y1 + sh.y2) / 2 + sh.sag;
      const len = Math.hypot(sh.x2 - sh.x1, sh.y2 - sh.y1); const n = Math.max(4, Math.ceil(len / 6));
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const x = u * u * sh.x1 + 2 * u * t * cx + t * t * sh.x2, y = u * u * sh.y1 + 2 * u * t * cy + t * t * sh.y2;
        top.push([x, y]); bot.push([x, y + sh.thick]);
      }
      const p = top.concat(bot.reverse());
      return sh.rough ? roughen(p, true, sh.rough, seed) : p;
    }
  }
  return [];
}

/* ---------- растеризация карты в маску + материалы ---------- */
function rasterizeMap(def) {
  const W = def.W, H = def.H, N = W * H;
  const mask = new Uint8Array(N), mat = new Uint8Array(N), sid = new Uint8Array(N);
  const back = new Uint8Array(N), bsid = new Uint8Array(N);
  const cv = makeCanvas(8, 8); const cx = cv.getContext('2d', { willReadFrequently: true });
  def.shapes.forEach((sh, idx) => {
    const poly = shapePoly(sh, (def.seed || 1) + idx * 131, H);
    if (poly.length < 3) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    x0 = Math.max(0, Math.floor(x0) - 1); y0 = Math.max(0, Math.floor(y0) - 1);
    x1 = Math.min(W, Math.ceil(x1) + 1); y1 = Math.min(H, Math.ceil(y1) + 1);
    const bw = x1 - x0, bh = y1 - y0; if (bw <= 0 || bh <= 0) return;
    cv.width = bw; cv.height = bh;
    cx.fillStyle = '#fff'; cx.beginPath(); cx.moveTo(poly[0][0] - x0, poly[0][1] - y0);
    for (let i = 1; i < poly.length; i++) cx.lineTo(poly[i][0] - x0, poly[i][1] - y0);
    cx.closePath(); cx.fill();
    const data = cx.getImageData(0, 0, bw, bh).data;
    const mid = MAT[sh.mat] || 1; const cut = sh.op === 'cut', paint = sh.op === 'paint';
    const hasBack = !!sh.back, through = !!sh.through;
    for (let y = 0; y < bh; y++) {
      const row = (y + y0) * W + x0, drow = y * bw;
      for (let x = 0; x < bw; x++) {
        if (data[(drow + x) * 4 + 3] < 128) continue;
        const i = row + x;
        if (cut) { mask[i] = 0; if (through) back[i] = 0; }
        else if (paint) { if (mask[i]) { mat[i] = mid; sid[i] = idx; } }
        else {
          mask[i] = 1; mat[i] = mid; sid[i] = idx;
          if (hasBack) { back[i] = mid; bsid[i] = idx; } else if (back[i]) back[i] = 0;
        }
      }
    }
  });
  cleanupMask(mask, W, H, 150, 0);
  for (let i = 0; i < N; i++) { if (!mask[i]) mat[i] = 0; else if (!mat[i]) mat[i] = 1; }
  treeClimbs(def, mask, mat, sid, W, H);
  return { mask, mat, sid, back, bsid };
}

/* ---------- строители сооружений ---------- */
const PAL = {
  castleStone: { base: '#a89684', alt: '#8a7a6c', mortar: '#2a221c', w: 28, h: 14, var: 0.13, tex: 'brick_light', texK: 1.12 },
  sandBrick: { base: '#e2b077', alt: '#cf9a62', mortar: '#8a5a32', w: 22, h: 11, var: 0.08 },
  darkStone: { base: '#4a4040', alt: '#3c3434', mortar: '#1a1414', w: 20, h: 10, var: 0.1 },
  shipWood: { base: '#7a4a2a', gap: '#2a160a', plank: 8, var: 0.18, tex: 'wood_ship', texK: [1.45, 1.7, 1.75] },
  lightWood: { base: '#a0703f', gap: '#3a220e', plank: 7, var: 0.16, tex: 'wood_light' },
  ufoMetal: { base: '#9aa3b5', rust: '#6a7080', plate: [34, 18] },
  steel: { base: '#7a8290', rust: '#8a4a2a', plate: [30, 16] },
};
function floatIsland(cx, top, hw, depth, o = {}) {
  return Sh.blob([
    [cx - hw, top + 12], [cx - hw * 0.55, top - 5], [cx, top - 9], [cx + hw * 0.55, top - 4], [cx + hw, top + 13],
    [cx + hw * 0.78, top + depth * 0.33], [cx + hw * 0.38, top + depth * 0.68], [cx + hw * 0.06, top + depth],
    [cx - hw * 0.32, top + depth * 0.62], [cx - hw * 0.78, top + depth * 0.3],
  ], Object.assign({ rough: 6 }, o));
}
function spire(x, base, h, w, lean, mat = 'crystal') {
  return Sh.poly([[x - w / 2, base + 30], [x - w * 0.42 + lean * 0.35, base - h * 0.62], [x + lean, base - h], [x + w * 0.42 + lean * 0.35, base - h * 0.6], [x + w / 2, base + 30]], { mat, pal: { a: '#5ff4ff', b: '#b86cff' } });
}

/* ---------- превью карты для меню ---------- */
function drawMapPreview(cv, map) {
  const th = THEMES[map.theme]; const w = cv.width, h = cv.height; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, th.sky[0]); g.addColorStop(0.6, th.sky[1]); g.addColorStop(1, th.sky[2]);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const s = w / map.W; const oy = h - map.H * s;
  const lay = makeCanvas(w, h); const lc = lay.getContext('2d');
  lc.setTransform(s, 0, 0, s, 0, oy);
  const colFor = (sh) => {
    if (sh.mat === 'ground') return th.ground.strata[0];
    if (sh.mat === 'rock' || sh.mat === 'basalt') return (th.ground.rock || th.ground.strata)[0];
    if (sh.mat === 'brick') return (sh.pal && sh.pal.base) || '#999';
    if (sh.mat === 'wood') return (sh.pal && sh.pal.base) || '#7a4a2a';
    if (sh.mat === 'concrete') return (sh.pal && sh.pal.base) || '#555';
    if (sh.mat === 'ice') return '#bfe6ff';
    if (sh.mat === 'crystal') return '#6ff0ff';
    if (sh.mat === 'metal') return '#9aa3b5';
    return '#777';
  };
  map.shapes.forEach((sh, idx) => {
    const poly = shapePoly(sh, (map.seed || 1) + idx * 131, map.H); if (poly.length < 3) return;
    lc.beginPath(); lc.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) lc.lineTo(poly[i][0], poly[i][1]); lc.closePath();
    if (sh.op === 'cut') { lc.globalCompositeOperation = 'destination-out'; lc.fill(); lc.globalCompositeOperation = 'source-over'; }
    else {
      lc.fillStyle = colFor(sh); lc.fill();
      if (sh.mat === 'ground' || (th.ground.capMats || []).includes(MAT[sh.mat])) {
        lc.save(); lc.clip(); lc.strokeStyle = th.ground.cap.cols[1]; lc.lineWidth = 14 / Math.max(0.3, s * 4); lc.lineJoin = 'round';
        lc.beginPath(); lc.moveTo(poly[0][0], poly[0][1] - 1); for (let i = 1; i < poly.length; i++) lc.lineTo(poly[i][0], poly[i][1] - 1); lc.stroke(); lc.restore();
      }
    }
  });
  c.drawImage(lay, 0, 0);
  const wy = oy + map.water * s; const L = th.liquid;
  const wg = c.createLinearGradient(0, wy, 0, h); wg.addColorStop(0, L.top); wg.addColorStop(1, L.deep);
  c.globalAlpha = 0.9; c.fillStyle = wg; c.fillRect(0, wy, w, h - wy); c.globalAlpha = 1;
}

/** большие деревья, на которые можно залезть: к стволу прибита лестница, в кроне — дощатый помост (настоящая опора:
    на нём можно стоять и стрелять, его можно разрушить). Помост ставится только там, где над ним свободно */
function treeClimbs(def, mask, mat, sid, W, H) {
  const woodSid = Math.max(0, def.shapes.findIndex(sh => sh.mat === 'wood'));
  const add = !def._treeClimbs; def._treeClimbs = true;
  for (const d of def.decor || []) {
    if (d[0] !== 'oak') continue;
    const x = Math.round(d[1]), s = d[3] || 1;
    let gy = -1; for (let y = d[2] != null ? Math.max(0, d[2] - 40) : 0; y < H - 1; y++) if (mask[y * W + x]) { gy = y; break; }
    if (gy < 0 || gy > def.water - 20) continue;
    const py = Math.round(gy - 165 * s * 0.36), x0 = x - 30, x1 = x + 30;
    if (py < 40) continue;
    let free = true;
    for (let y = py - 44; y < py + 8 && free; y++) for (let xx = x0 - 4; xx <= x1 + 4; xx++) if (mask[y * W + xx]) { free = false; break; }
    for (let y = py + 8; y < gy - 2 && free; y++) if (mask[y * W + x]) free = false;
    if (!free) continue;
    for (let y = py; y < py + 7; y++) for (let xx = x0; xx <= x1; xx++) { if (Math.abs(xx - x) < 12) continue; /* люк для лестницы */ const i = y * W + xx; mask[i] = 1; mat[i] = 4; sid[i] = woodSid; }
    // низ лестницы — там, где боец целиком помещается у ствола (на склоне — чуть выше корней)
    const bf = (yy) => { for (let dy = 2; dy <= 26; dy += 4) for (const ox of [-4, 0, 4]) if (mask[(yy - dy) * W + x + ox]) return false; return true; };
    let y2 = gy; while (y2 > py + 20 && !bf(y2)) y2--;
    if (y2 <= py + 20) { for (let y = py; y < py + 7; y++) for (let xx = x0; xx <= x1; xx++) mask[y * W + xx] = 0; continue; }
    if (add) def.ladders.push({ x, y1: py, y2, tree: true });
  }
}
