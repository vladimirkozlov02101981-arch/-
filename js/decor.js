'use strict';
/* =========================================================
   Декор карт: деревья, дома, мачты, машины, кристаллы...
   Рисуется на отдельный слой позади земли, разрушается взрывами
   ========================================================= */
let DECOR_THEME = 'valley';
const OAK_PALS = [['#1e3212', '#3e6420', '#7e9e30', '#d0dc60'], ['#1c3414', '#386024', '#72983a', '#c4d868'], ['#223412', '#44681e', '#88a42e', '#dadf64']];
const CASTLE_PALS = [['#233e14', '#4a7a22', '#8fb83a', '#d8e670'], ['#2e4216', '#5e7e26', '#a0b844', '#e0e27a']];

function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, TAU); c.fill(); }
/** крона из листвы: каждое облачко — сотни мелких листьев, освещённых по своей нормали
    (солнце сверху слева): светлые жёлто-зелёные верхушки, сочная середина, глубокая тень снизу */
/** крона: облачка из «кочанов» листвы. Каждый кочан — фестончатый шар с собственным светом
    (солнце сверху слева): глубокая тень снизу, сочная середина, жёлто-зелёная освещённая шапка
    и отдельные листья по кромке. Верх кроны светлее, низ уходит в тень */
function foliage(c, blobs, pal) {
  const rnd = makeRng(7129 + Math.round(blobs[0].x * 11));
  const P = pal.map(hex2rgb); if (P.length < 4) P.push(P[2].map(v => Math.min(255, v * 1.22 + 22)));
  const ramp = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; const k = t * 3, i = Math.min(2, k | 0), f = k - i, A = P[i], B = P[i + 1];
    return `rgb(${(A[0] + (B[0] - A[0]) * f) | 0},${(A[1] + (B[1] - A[1]) * f) | 0},${(A[2] + (B[2] - A[2]) * f) | 0})`; };
  const scallop = (x, y, r, k, ph) => { c.beginPath(); for (let i = 0; i <= 36; i++) { const a = i / 36 * TAU, rr = r * (0.9 + 0.1 * Math.abs(Math.sin(a * k * 0.5 + ph))); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (i) c.lineTo(px, py); else c.moveTo(px, py); } c.closePath(); c.fill(); };
  let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9; const rims = [];
  for (const b of blobs) { minY = Math.min(minY, b.y - b.r); maxY = Math.max(maxY, b.y + b.r); minX = Math.min(minX, b.x - b.r); maxX = Math.max(maxX, b.x + b.r); }
  const span = Math.max(1, maxY - minY), cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2, hw = Math.max(1, (maxX - minX) / 2), hh = span / 2;
  // кочаны по всем облачкам
  const clumps = [];
  for (const b of blobs) {
    const m = Math.max(1, Math.round((b.r * b.r) / 130));
    for (let i = 0; i < m; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * b.r * 0.5; clumps.push({ x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, r: Math.max(2.4, b.r * (0.5 + rnd() * 0.22)) }); }
  }
  // сзади вперёд: сначала верхние и дальние, нижние ложатся поверх
  clumps.sort((p, q) => p.y - q.y);
  // тёмная подложка всей кроны — глубина между кочанами
  c.fillStyle = ramp(0.02); for (const b of blobs) scallop(b.x, b.y, b.r * 0.96, 9, b.x);
  for (const q of clumps) {
    const gx = (q.x - cxm) / hw, gy = (q.y - cym) / hh;                         // положение в кроне
    const glob = -(gx * 0.45 + gy * 0.8) * 0.5;                                  // крона освещена сверху слева
    const base = 0.24 + glob * 0.7 + (rnd() - 0.5) * 0.1;
    const k = 7 + (rnd() * 4 | 0), ph = rnd() * 6;
    c.fillStyle = ramp(base - 0.26); scallop(q.x, q.y, q.r, k, ph);                                             // тень кочана
    c.fillStyle = ramp(base + 0.14); scallop(q.x - q.r * 0.14, q.y - q.r * 0.16, q.r * 0.8, k, ph + 1);          // середина
    c.fillStyle = ramp(base + 0.42); scallop(q.x - q.r * 0.3, q.y - q.r * 0.34, q.r * 0.46, k + 2, ph + 2);   // освещённая шапка
    if (glob > 0.05) rims.push(q);
    // листья по освещённой кромке и прожилки-тени внизу
    const ls = Math.max(1.1, Math.min(2.8, q.r * 0.16));
    for (let i = 0, n = Math.round(q.r * 1.6); i < n; i++) {
      const a = -2.4 + rnd() * 2.2, d = q.r * (0.55 + rnd() * 0.45), px = q.x + Math.cos(a) * d, py = q.y + Math.sin(a) * d;
      c.fillStyle = ramp(base + 0.3 + rnd() * 0.35); c.beginPath(); c.ellipse(px, py, ls * 1.2, ls * 0.6, a + 1.2 + (rnd() - 0.5), 0, TAU); c.fill();
    }
    for (let i = 0, n = Math.round(q.r * 0.8); i < n; i++) {
      const a = 0.4 + rnd() * 2.2, d = q.r * (0.5 + rnd() * 0.4), px = q.x + Math.cos(a) * d, py = q.y + Math.sin(a) * d;
      c.fillStyle = ramp(base - 0.28); c.beginPath(); c.ellipse(px, py, ls, ls * 0.5, a + 1.2, 0, TAU); c.fill();
    }
  }
  // тёплый солнечный ободок на верхних кочанах
  c.save(); c.lineCap = 'round'; c.strokeStyle = 'rgba(236,244,150,0.55)';
  for (const q of rims) { c.lineWidth = Math.max(1, q.r * 0.14); c.beginPath(); c.arc(q.x, q.y, q.r * 0.86, -2.6, -1.5); c.stroke(); }
  c.restore();
  // просветы неба сквозь большую крону: рваные дырочки с тёмной кромкой листвы
  if (blobs.length >= 10) {
    for (let i = 0, k = 3 + (rnd() * 3 | 0); i < k; i++) {
      const hx = cxm + (rnd() - 0.5) * hw * 1.1, hy = cym + (rnd() - 0.7) * hh * 0.9, hr = 2 + rnd() * 2.6;
      c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath();
      for (let j = 0; j <= 10; j++) { const a = j / 10 * TAU, rr = hr * (0.7 + rnd() * 0.5); if (j) c.lineTo(hx + Math.cos(a) * rr * 1.3, hy + Math.sin(a) * rr); else c.moveTo(hx + Math.cos(a) * rr * 1.3, hy + Math.sin(a) * rr); }
      c.closePath(); c.fill(); c.restore();
    }
  }
}
function hgrad(c, x0, x1, cols) { const g = c.createLinearGradient(x0, 0, x1, 0); cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col)); return g; }
function vgrad(c, y0, y1, cols) { const g = c.createLinearGradient(0, y0, 0, y1); cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col)); return g; }

const DECOR = {
  /* ---------- деревья ---------- */
  oak(c, g, x, y, s, r) {
    const h = r.range(58, 76) * s, tw = r.range(7, 9.5) * s, lean = r.range(-0.1, 0.1);
    const tx = x + lean * h, ty = y - h;
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.ellipse(x + 10 * s, y + 2, 34 * s, 5 * s, 0, 0, TAU); c.fill();   // тень кроны на земле
    c.fillStyle = hgrad(c, x - tw, x + tw, ['#6b4a2e', '#523620', '#2f1d10']);
    c.beginPath(); c.moveTo(x - tw * 1.2, y + 4); c.quadraticCurveTo(x - tw * 0.4, y - h * 0.35, tx - tw * 0.32, ty + h * 0.15);
    c.lineTo(tx + tw * 0.32, ty + h * 0.15); c.quadraticCurveTo(x + tw * 0.4, y - h * 0.35, x + tw * 1.2, y + 4); c.closePath(); c.fill();
    // кора: продольные борозды, светлые гребни на солнечной стороне
    c.save(); c.clip(); c.lineCap = 'round';
    for (let i = 0; i < 9; i++) { const u = -1 + (i + r() * 0.6) / 4.5, x0 = x + u * tw, x1 = tx + u * tw * 0.3; c.strokeStyle = u < -0.2 && i % 2 ? 'rgba(160,120,80,0.45)' : 'rgba(30,16,8,0.5)'; c.lineWidth = (0.8 + r() * 0.8) * s;
      c.beginPath(); c.moveTo(x0, y + 4); c.bezierCurveTo(x0 + (r() - 0.5) * 3, y - h * 0.3, x1 + (r() - 0.5) * 3, ty + h * 0.4, x1, ty + h * 0.15); c.stroke(); }
    c.restore();
    c.strokeStyle = '#4a2f1b'; c.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const k = r.range(0.45, 0.85); const bx = lerp(x, tx, k), by = y - h * k; const dir = i % 2 ? 1 : -1; const len = r.range(16, 28) * s;
      c.lineWidth = r.range(1.8, 3.2) * s; c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(bx + dir * len * 0.6, by - len * 0.15, bx + dir * len, by - len * r.range(0.35, 0.7)); c.stroke();
    }
    const R = r.range(30, 40) * s; const cx = tx, cy = ty - R * 0.2;
    const blobs = [{ x: cx, y: cy, r: R * 0.72 }, { x: cx - R * 0.55, y: cy + R * 0.12, r: R * 0.55 }, { x: cx + R * 0.55, y: cy + R * 0.1, r: R * 0.55 }, { x: cx, y: cy - R * 0.4, r: R * 0.55 }];
    for (let i = 0; i < 14; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R * 0.75; blobs.push({ x: cx + Math.cos(a) * d * 1.3, y: cy + Math.sin(a) * d * 0.72, r: R * r.range(0.3, 0.46) }); }
    foliage(c, blobs, DECOR_THEME === 'castle' ? r.pick(CASTLE_PALS) : r.pick(OAK_PALS));
  },
  birch(c, g, x, y, s, r) {
    const h = r.range(80, 100) * s, tw = 5 * s;
    c.fillStyle = hgrad(c, x - tw, x + tw, ['#ffffff', '#e8e6de', '#b8b4a8']);
    c.beginPath(); c.moveTo(x - tw, y + 4); c.lineTo(x - tw * 0.5, y - h); c.lineTo(x + tw * 0.5, y - h); c.lineTo(x + tw, y + 4); c.closePath(); c.fill();
    c.fillStyle = '#2a2a2a';
    for (let yy = y - 8; yy > y - h + 10; yy -= r.range(7, 14) * s) c.fillRect(x - tw * 0.7 + r() * tw * 0.5, yy, r.range(2, 5) * s, 1.4 * s);
    const blobs = [{ x, y: y - h + 6 * s, r: 16 * s }, { x, y: y - h + 22 * s, r: 13 * s }]; for (let i = 0; i < 12; i++) { const a = r() * TAU, d = Math.sqrt(r()) * 20 * s; blobs.push({ x: x + Math.cos(a) * d * 0.9, y: y - h + 8 * s + Math.sin(a) * d * 1.2, r: r.range(8, 12) * s }); }
    foliage(c, blobs, ['#1f3f1c', '#3f7a2e', '#86b84a', '#d6ec80']);
  },
  pine(c, g, x, y, s, r, snowy = false) {
    const h = r.range(78, 108) * s, w = h * r.range(0.3, 0.36);
    c.fillStyle = hgrad(c, x - 3 * s, x + 3 * s, ['#6b4a30', '#4a3020', '#2a1a10']); c.fillRect(x - 3 * s, y - h * 0.24, 6 * s, h * 0.24 + 5);
    const tiers = 6, cols = snowy ? ['#4f8a7c', '#2f5e54', '#173a32'] : ['#5aa85a', '#2f7440', '#123a22'];
    for (let i = 0; i < tiers; i++) {
      const k = i / tiers; const by = y - h * 0.12 - k * h * 0.76; const tw = w * (1 - k * 0.8); const th = h * 0.28;
      // ярус: вогнутые бока, рваная провисающая кромка из пучков хвои
      const path = new Path2D(); path.moveTo(x, by - th);
      path.quadraticCurveTo(x + tw * 0.35, by - th * 0.35, x + tw, by + 2 * s);
      const n = 9 + (tw / (6 * s) | 0);
      for (let j = n; j >= 0; j--) { const px = x - tw + 2 * tw * j / n, dip = (j % 2 ? 4.5 : 0.5) * s * (0.7 + r() * 0.6); path.lineTo(px, by + dip - Math.abs(j / n - 0.5) * 3 * s); }
      path.quadraticCurveTo(x - tw * 0.35, by - th * 0.35, x, by - th); path.closePath();
      c.fillStyle = hgrad(c, x - tw, x + tw, cols); c.fill(path);
      c.save(); c.clip(path); c.lineCap = 'round';
      // хвоя: много коротких штрихов от оси вниз-наружу; слева — на свету, справа — в тени
      for (let q = 0; q < 70; q++) {
        const u = r() * 2 - 1, yy = by - th * (0.05 + r() * 0.85), len = tw * (0.25 + r() * 0.35);
        const lit = u < 0 ? 1 - (u + 1) * 0.5 : 0;
        c.strokeStyle = u < -0.1 ? `rgba(${180 + lit * 40},${230},${150},${0.18 + lit * 0.3})` : `rgba(6,26,14,${0.2 + r() * 0.25})`;
        c.lineWidth = (0.7 + r() * 0.6) * s; const x0 = x + u * tw * 0.5;
        c.beginPath(); c.moveTo(x0, yy); c.lineTo(x0 + Math.sign(u || 1) * len * 0.5, yy + len * 0.45); c.stroke();
      }
      const sh = c.createLinearGradient(0, by - 7 * s, 0, by + 4 * s); sh.addColorStop(0, 'rgba(5,20,10,0)'); sh.addColorStop(1, 'rgba(5,20,10,0.5)');
      c.fillStyle = sh; c.fillRect(x - tw, by - 7 * s, tw * 2, 12 * s);
      c.restore();
      if (snowy) {
        c.fillStyle = '#f4f8ff';
        c.beginPath(); c.moveTo(x, by - th); c.lineTo(x + tw * 0.8, by - 2 * s); c.lineTo(x + tw * 0.45, by - 4.5 * s); c.lineTo(x, by - th + 9 * s);
        c.lineTo(x - tw * 0.5, by - 4 * s); c.lineTo(x - tw * 0.85, by - 1 * s); c.closePath(); c.fill();
      }
    }
  },
  pineSnow(c, g, x, y, s, r) { DECOR.pine(c, g, x, y, s, r, true); },
  palm(c, g, x, y, s, r) {
    const h = r.range(90, 120) * s; const bend = r.range(-0.3, 0.3) * h;
    const P0 = [x, y + 4], P1 = [x + bend * 0.15, y - h * 0.55], P2 = [x + bend, y - h];
    const q = (t) => { const u = 1 - t; return [u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]]; };
    const seg = 16;
    for (let i = 0; i < seg; i++) {
      const a = q(i / seg), b = q((i + 1) / seg); const w = lerp(7.5, 4.5, i / seg) * s;
      c.strokeStyle = i % 2 ? '#8a6a44' : '#7a5a38'; c.lineWidth = w * 2; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      c.strokeStyle = 'rgba(40,25,10,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(a[0] - w, a[1]); c.lineTo(a[0] + w, a[1]); c.stroke();
    }
    const top = P2; const n = 8;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.46 + r.range(-0.08, 0.08); const len = r.range(40, 54) * s;
      const ex = top[0] + Math.cos(a) * len, ey = top[1] + Math.sin(a) * len * 0.35 + len * 0.55 * Math.abs(Math.cos(a));
      const mx = top[0] + Math.cos(a) * len * 0.55, my = top[1] + Math.sin(a) * len * 0.6 - 8 * s;
      const col = i % 2 ? '#2f7d32' : '#3f9a3a';
      c.strokeStyle = col; c.lineWidth = 2 * s; c.lineCap = 'round';
      c.beginPath(); c.moveTo(top[0], top[1]); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
      c.lineWidth = 1.4 * s;
      for (let t = 0.12; t < 1; t += 0.07) {
        const u = 1 - t; const px = u * u * top[0] + 2 * u * t * mx + t * t * ex, py = u * u * top[1] + 2 * u * t * my + t * t * ey;
        const tx = 2 * u * (mx - top[0]) + 2 * t * (ex - mx), ty = 2 * u * (my - top[1]) + 2 * t * (ey - my); const tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl; const L = (1 - t * 0.7) * 9 * s;
        c.beginPath(); c.moveTo(px, py); c.lineTo(px + nx * L + tx / tl * 2, py + ny * L + 3 * s); c.stroke();
        c.beginPath(); c.moveTo(px, py); c.lineTo(px - nx * L + tx / tl * 2, py - ny * L + 3 * s); c.stroke();
      }
    }
    c.fillStyle = '#5a3a1a'; for (let i = 0; i < 3; i++) circ(c, top[0] + (i - 1) * 4 * s, top[1] + 4 * s, 3.2 * s);
  },
  deadtree(c, g, x, y, s, r) {
    const charred = DECOR_THEME === 'volcano';
    const col = charred ? '#1c1412' : '#8c7862';
    const br = (x0, y0, a, len, w, d) => {
      const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      if (charred && g && d < 3 && r() < 0.5) { g.fillStyle = 'rgba(255,100,20,0.8)'; circ(g, lerp(x0, x1, 0.5), lerp(y0, y1, 0.5), 2.5); c.fillStyle = '#ff7a2a'; circ(c, lerp(x0, x1, 0.5), lerp(y0, y1, 0.5), 0.9); }
      if (d > 0) { const n = r() < 0.3 ? 3 : 2; for (let i = 0; i < n; i++) br(x1, y1, a + r.range(-0.7, 0.7), len * r.range(0.55, 0.75), w * 0.65, d - 1); }
    };
    br(x, y + 4, -Math.PI / 2 + r.range(-0.15, 0.15), r.range(28, 38) * s, 6 * s, 4);
  },
  cactus(c, g, x, y, s, r) {
    const h = r.range(48, 72) * s, w = r.range(10, 13) * s;
    const body = hgrad(c, x - w, x + w, ['#7cc05c', '#4a9440', '#2a5e26']);
    c.fillStyle = body; rrect(c, x - w / 2, y - h, w, h + 6, w / 2); c.fill();
    for (const dir of [-1, 1]) {
      if (r() < 0.25) continue;
      const ay = y - h * r.range(0.35, 0.6), ah = h * r.range(0.25, 0.42), ax = x + dir * w * 1.25, aw = w * 0.72;
      c.fillStyle = body; rrect(c, Math.min(x, ax) - aw / 2 + (dir > 0 ? 0 : 0), ay - aw / 2, Math.abs(ax - x) + aw / 2, aw, aw / 2); c.fill();
      rrect(c, ax - aw / 2, ay - ah, aw, ah + aw / 2, aw / 2); c.fill();
    }
    c.strokeStyle = 'rgba(20,55,20,0.35)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - w * 0.18, y - h + 4); c.lineTo(x - w * 0.18, y); c.moveTo(x + w * 0.18, y - h + 4); c.lineTo(x + w * 0.18, y); c.stroke();
    c.fillStyle = 'rgba(255,255,220,0.7)'; for (let i = 0; i < 12; i++) c.fillRect(x + r.range(-w / 2, w / 2), y - r() * h, 1, 1);
    if (r() < 0.4) { c.fillStyle = '#ff6b9a'; circ(c, x, y - h, 3 * s); }
  },
  cactusSmall(c, g, x, y, s, r) {
    const R = r.range(6, 9) * s;
    c.fillStyle = hgrad(c, x - R, x + R, ['#86c966', '#4f9a44', '#2a5e26']); c.beginPath(); c.ellipse(x, y - R * 0.8, R, R * 1.1, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(20,55,20,0.4)'; c.lineWidth = 0.8; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x + i * R * 0.35, y - R * 1.8); c.quadraticCurveTo(x + i * R * 0.5, y - R * 0.8, x + i * R * 0.35, y); c.stroke(); }
    if (r() < 0.5) { c.fillStyle = '#ffd23a'; circ(c, x, y - R * 1.85, 2 * s); }
  },
  /* ---------- постройки ---------- */
  windmill(c, g, x, y, s) {
    const h = 105 * s, bw = 36 * s, tw = 20 * s;
    c.fillStyle = hgrad(c, x - bw / 2, x + bw / 2, ['#f5e8cf', '#dcc7a4', '#a98f6a']);
    c.beginPath(); c.moveTo(x - bw / 2, y + 4); c.lineTo(x - tw / 2, y - h); c.lineTo(x + tw / 2, y - h); c.lineTo(x + bw / 2, y + 4); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(90,70,50,0.22)'; c.lineWidth = 1;
    for (let yy = y - 8; yy > y - h + 4; yy -= 9 * s) { const k = (y - yy) / h; const hw = lerp(bw, tw, k) / 2; c.beginPath(); c.moveTo(x - hw, yy); c.lineTo(x + hw, yy); c.stroke(); }
    c.fillStyle = '#8a3b26'; c.beginPath(); c.moveTo(x - tw * 0.8, y - h + 3); c.quadraticCurveTo(x, y - h - 24 * s, x + tw * 0.8, y - h + 3); c.closePath(); c.fill();
    c.fillStyle = '#5a3a22'; rrect(c, x - 5 * s, y - 17 * s, 10 * s, 17 * s + 3, 5 * s); c.fill();
    c.fillStyle = '#2e3c4c'; c.fillRect(x - 3.5 * s, y - 62 * s, 7 * s, 10 * s);
    c.fillStyle = '#ffd98a'; c.fillRect(x - 3.5 * s, y - 40 * s, 7 * s, 9 * s);
  },
  farmhouse(c, g, x, y, s) {
    const w = 110 * s, wh = 50 * s, rh = 40 * s;
    c.fillStyle = hgrad(c, x - w / 2, x + w / 2, ['#f3e2bd', '#e2cc9f', '#bda57a']); c.fillRect(x - w / 2, y - wh, w, wh + 5);
    c.strokeStyle = '#6b4226'; c.lineWidth = 3 * s; c.strokeRect(x - w / 2, y - wh, w, wh + 5);
    c.beginPath(); c.moveTo(x - w / 4, y - wh); c.lineTo(x - w / 4, y + 4); c.moveTo(x + w / 4, y - wh); c.lineTo(x + w / 4, y + 4);
    c.moveTo(x - w / 2, y - wh); c.lineTo(x - w / 4, y - wh / 2); c.moveTo(x + w / 2, y - wh); c.lineTo(x + w / 4, y - wh / 2); c.stroke();
    c.fillStyle = '#8a5a4a'; c.fillRect(x - 35 * s, y - 86 * s, 11 * s, 30 * s);
    c.fillStyle = hgrad(c, x - w / 2, x + w / 2, ['#c85a3a', '#a8412a', '#7a2a1a']);
    c.beginPath(); c.moveTo(x - w / 2 - 9 * s, y - wh + 3); c.lineTo(x, y - wh - rh); c.lineTo(x + w / 2 + 9 * s, y - wh + 3); c.closePath(); c.fill();
    c.save(); c.clip(); c.strokeStyle = 'rgba(60,15,5,0.4)'; c.lineWidth = 1;
    for (let yy = y - wh; yy > y - wh - rh; yy -= 6 * s) { c.beginPath(); c.moveTo(x - w, yy); c.lineTo(x + w, yy); c.stroke(); } c.restore();
    c.fillStyle = '#5a3620'; c.fillRect(x - 8 * s, y - 27 * s, 16 * s, 27 * s + 4);
    c.fillStyle = '#e8b04a'; circ(c, x + 4 * s, y - 13 * s, 1.2 * s);
    for (const wx of [x - 38 * s, x + 26 * s]) { c.fillStyle = '#ffdb8a'; c.fillRect(wx, y - 38 * s, 13 * s, 12 * s); c.strokeStyle = '#6b4226'; c.lineWidth = 1.5 * s; c.strokeRect(wx, y - 38 * s, 13 * s, 12 * s); c.beginPath(); c.moveTo(wx + 6.5 * s, y - 38 * s); c.lineTo(wx + 6.5 * s, y - 26 * s); c.stroke(); }
  },
  cottage(c, g, x, y, s) {
    const w = 76 * s, wh = 38 * s, rh = 28 * s;
    c.fillStyle = hgrad(c, x - w / 2, x + w / 2, ['#d9c7a8', '#c4ae8a', '#9a8464']); c.fillRect(x - w / 2, y - wh, w, wh + 5);
    c.fillStyle = '#7a6a5a'; c.fillRect(x + 17 * s, y - 62 * s, 10 * s, 24 * s);
    c.fillStyle = hgrad(c, x - w / 2, x + w / 2, ['#7a5a3a', '#5a3f28', '#3a2818']);
    c.beginPath(); c.moveTo(x - w / 2 - 7 * s, y - wh + 3); c.lineTo(x, y - wh - rh); c.lineTo(x + w / 2 + 7 * s, y - wh + 3); c.closePath(); c.fill();
    c.fillStyle = '#4a2e1a'; c.fillRect(x - 20 * s, y - 22 * s, 12 * s, 22 * s + 4);
    c.fillStyle = '#ffd98a'; c.fillRect(x + 6 * s, y - 28 * s, 14 * s, 11 * s);
    c.strokeStyle = '#4a2e1a'; c.lineWidth = 1.5 * s; c.strokeRect(x + 6 * s, y - 28 * s, 14 * s, 11 * s);
  },
  well(c, g, x, y, s) {
    c.fillStyle = hgrad(c, x - 16 * s, x + 16 * s, ['#b0a898', '#8a8272', '#5a5448']); rrect(c, x - 16 * s, y - 16 * s, 32 * s, 20 * s, 3 * s); c.fill();
    c.strokeStyle = 'rgba(40,35,30,0.4)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 16 * s, y - 8 * s); c.lineTo(x + 16 * s, y - 8 * s); c.stroke();
    c.fillStyle = '#5a3a22'; c.fillRect(x - 14 * s, y - 42 * s, 3 * s, 28 * s); c.fillRect(x + 11 * s, y - 42 * s, 3 * s, 28 * s);
    c.fillStyle = '#8a3b26'; c.beginPath(); c.moveTo(x - 20 * s, y - 38 * s); c.lineTo(x, y - 52 * s); c.lineTo(x + 20 * s, y - 38 * s); c.closePath(); c.fill();
    c.strokeStyle = '#3a2a1a'; c.beginPath(); c.moveTo(x, y - 40 * s); c.lineTo(x, y - 26 * s); c.stroke(); c.fillStyle = '#6b4a2e'; c.fillRect(x - 3 * s, y - 27 * s, 6 * s, 6 * s);
  },
  haystack(c, g, x, y, s) {
    c.fillStyle = vgrad(c, y - 30 * s, y, ['#f2d06a', '#d9a93a', '#a8791e']);
    c.beginPath(); c.moveTo(x - 22 * s, y + 4); c.quadraticCurveTo(x - 24 * s, y - 30 * s, x, y - 32 * s); c.quadraticCurveTo(x + 24 * s, y - 30 * s, x + 22 * s, y + 4); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(120,80,20,0.45)'; c.lineWidth = 1;
    for (let i = 0; i < 9; i++) { const a = -2.6 + i * 0.28; c.beginPath(); c.moveTo(x + Math.cos(a) * 8 * s, y - 20 * s + Math.sin(a) * 6 * s); c.lineTo(x + Math.cos(a) * 20 * s, y - 6 * s + Math.sin(a) * 4 * s); c.stroke(); }
  },
  fence(c, g, x, y, s) {
    const len = 80 * s; c.fillStyle = '#8a6040';
    for (let i = 0; i <= 4; i++) c.fillRect(x - len / 2 + i * len / 4 - 2 * s, y - 20 * s, 4 * s, 22 * s);
    c.fillRect(x - len / 2, y - 16 * s, len, 3 * s); c.fillRect(x - len / 2, y - 8 * s, len, 3 * s);
  },
  watertower(c, g, x, y, s) {
    const h = 110 * s; c.strokeStyle = '#5a3a22'; c.lineWidth = 4 * s;
    for (const dx of [-26, -9, 9, 26]) { c.beginPath(); c.moveTo(x + dx * s, y + 4); c.lineTo(x + dx * 0.8 * s, y - h); c.stroke(); }
    c.lineWidth = 1.6 * s; c.beginPath();
    for (let k = 0; k < 3; k++) { const y0 = y - k * h / 3, y1 = y - (k + 1) * h / 3; c.moveTo(x - 25 * s, y0); c.lineTo(x + 24 * s, y1); c.moveTo(x + 25 * s, y0); c.lineTo(x - 24 * s, y1); }
    c.stroke();
    const tw = 56 * s, th = 44 * s, ty = y - h - th;
    c.fillStyle = hgrad(c, x - tw / 2, x + tw / 2, ['#b07a48', '#8a5a32', '#5a3a1e']); c.fillRect(x - tw / 2, ty, tw, th);
    c.strokeStyle = 'rgba(40,20,5,0.5)'; c.lineWidth = 1; for (let xx = x - tw / 2 + 7 * s; xx < x + tw / 2; xx += 7 * s) { c.beginPath(); c.moveTo(xx, ty); c.lineTo(xx, ty + th); c.stroke(); }
    c.fillStyle = '#3a3a3a'; c.fillRect(x - tw / 2 - 1, ty + 8 * s, tw + 2, 3 * s); c.fillRect(x - tw / 2 - 1, ty + th - 11 * s, tw + 2, 3 * s);
    c.fillStyle = '#7a4a2a'; c.beginPath(); c.moveTo(x - tw / 2 - 5 * s, ty); c.lineTo(x, ty - 20 * s); c.lineTo(x + tw / 2 + 5 * s, ty); c.closePath(); c.fill();
  },
  column(c, g, x, y, s) {
    const w = 18 * s, h = 70 * s;
    c.fillStyle = hgrad(c, x - w / 2, x + w / 2, ['#f4d6a6', '#dcb07a', '#a87a4a']); c.fillRect(x - w / 2, y - h, w, h + 4);
    c.strokeStyle = 'rgba(120,80,40,0.4)'; c.lineWidth = 1; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x + i * w / 6, y - h + 2); c.lineTo(x + i * w / 6, y); c.stroke(); }
    c.fillStyle = '#dcb07a'; c.fillRect(x - w * 0.75, y - 6 * s, w * 1.5, 7 * s);
    c.fillStyle = '#f4d6a6'; c.beginPath(); c.moveTo(x - w / 2, y - h); c.lineTo(x - w * 0.2, y - h - 7 * s); c.lineTo(x + w * 0.1, y - h - 2 * s); c.lineTo(x + w / 2, y - h - 9 * s); c.lineTo(x + w / 2, y - h); c.closePath(); c.fill();
  },
  pot(c, g, x, y, s) {
    c.fillStyle = hgrad(c, x - 9 * s, x + 9 * s, ['#d9824a', '#b0582a', '#6a3014']);
    c.beginPath(); c.moveTo(x - 4 * s, y + 2); c.quadraticCurveTo(x - 12 * s, y - 10 * s, x - 5 * s, y - 20 * s); c.lineTo(x - 4 * s, y - 25 * s); c.lineTo(x + 4 * s, y - 25 * s); c.lineTo(x + 5 * s, y - 20 * s); c.quadraticCurveTo(x + 12 * s, y - 10 * s, x + 4 * s, y + 2); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(40,15,5,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 8 * s, y - 12 * s); c.lineTo(x + 8 * s, y - 12 * s); c.stroke();
  },
  igloo(c, g, x, y, s) {
    const R = 34 * s;
    c.fillStyle = vgrad(c, y - R, y, ['#ffffff', '#e0ecfa', '#a9c2e0']); c.beginPath(); c.arc(x, y + 2, R, Math.PI, 0); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(120,150,190,0.55)'; c.lineWidth = 1;
    for (let k = 1; k <= 3; k++) { const yy = y + 2 - k * R / 4; const hw = Math.sqrt(R * R - (k * R / 4) * (k * R / 4)); c.beginPath(); c.moveTo(x - hw, yy); c.lineTo(x + hw, yy); c.stroke(); for (let j = -3; j <= 3; j++) { const xx = x + (j + (k % 2) * 0.5) * hw / 3.5; c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + R / 4); c.stroke(); } }
    c.fillStyle = vgrad(c, y - 16 * s, y, ['#f4f8ff', '#b8cde6']); c.beginPath(); c.arc(x + R * 0.78, y + 2, 15 * s, Math.PI, 0); c.closePath(); c.fill();
    c.fillStyle = '#2a3a55'; c.beginPath(); c.arc(x + R * 0.86, y + 2, 9 * s, Math.PI, 0); c.closePath(); c.fill();
  },
  snowman(c, g, x, y, s) {
    const balls = [[0, -11, 13], [0, -31, 10], [0, -47, 7.5]];
    for (const [dx, dy, r0] of balls) { const R = r0 * s; c.fillStyle = hgrad(c, x - R, x + R, ['#ffffff', '#eef4fb', '#b6c6dc']); circ(c, x + dx * s, y + dy * s, R); }
    c.fillStyle = '#1a1a1a'; circ(c, x - 2.6 * s, y - 49 * s, 1.1 * s); circ(c, x + 2.6 * s, y - 49 * s, 1.1 * s);
    for (let i = 0; i < 3; i++) circ(c, x, y - (26 + i * 5) * s, 1.1 * s);
    c.fillStyle = '#ff7a1a'; c.beginPath(); c.moveTo(x, y - 47 * s); c.lineTo(x + 9 * s, y - 45.5 * s); c.lineTo(x, y - 44.5 * s); c.closePath(); c.fill();
    c.fillStyle = '#d42a2a'; c.fillRect(x - 8 * s, y - 41.5 * s, 16 * s, 3.5 * s); c.fillRect(x + 3 * s, y - 40 * s, 3.5 * s, 10 * s);
    c.strokeStyle = '#5a3a22'; c.lineWidth = 1.6 * s; c.beginPath(); c.moveTo(x - 8 * s, y - 32 * s); c.lineTo(x - 22 * s, y - 42 * s); c.moveTo(x + 8 * s, y - 32 * s); c.lineTo(x + 21 * s, y - 38 * s); c.stroke();
    c.fillStyle = '#2a2a2a'; c.fillRect(x - 7 * s, y - 56 * s, 14 * s, 3 * s); c.fillRect(x - 5 * s, y - 66 * s, 10 * s, 11 * s);
  },
  sled(c, g, x, y, s) {
    c.strokeStyle = '#6b4a2e'; c.lineWidth = 2 * s; c.beginPath(); c.moveTo(x - 18 * s, y); c.lineTo(x + 14 * s, y); c.quadraticCurveTo(x + 22 * s, y, x + 20 * s, y - 7 * s); c.stroke();
    c.fillStyle = '#a0522d'; c.fillRect(x - 16 * s, y - 8 * s, 30 * s, 4 * s);
    c.fillStyle = '#6b4a2e'; c.fillRect(x - 12 * s, y - 5 * s, 2 * s, 5 * s); c.fillRect(x + 6 * s, y - 5 * s, 2 * s, 5 * s);
  },
  mast(c, g, x, y, s) {
    const h = 330 * s;
    c.fillStyle = hgrad(c, x - 5 * s, x + 5 * s, ['#8a5a32', '#6b4226', '#3a2210']); c.fillRect(x - 4.5 * s, y - h, 9 * s, h + 6);
    c.strokeStyle = 'rgba(60,40,20,0.8)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y - h + 6); c.lineTo(x - 150 * s, y); c.moveTo(x, y - h + 6); c.lineTo(x + 150 * s, y); c.moveTo(x, y - h * 0.55); c.lineTo(x - 120 * s, y); c.moveTo(x, y - h * 0.55); c.lineTo(x + 120 * s, y); c.stroke();
    const yards = [[0.85, 70], [0.55, 95]];
    for (const [k, half] of yards) {
      const yy = y - h * k; c.fillStyle = '#5a3a1e'; c.fillRect(x - half * s, yy - 2.5 * s, half * 2 * s, 5 * s);
      const sh = h * 0.24; c.fillStyle = vgrad(c, yy, yy + sh, ['#f2e6c8', '#d9c9a0', '#b8a27a']);
      c.beginPath(); c.moveTo(x - half * 0.95 * s, yy + 2 * s); c.lineTo(x + half * 0.95 * s, yy + 2 * s);
      c.quadraticCurveTo(x + half * 1.05 * s, yy + sh * 0.6, x + half * 0.85 * s, yy + sh);
      for (let i = 6; i >= 0; i--) c.lineTo(x - half * 0.85 * s + i / 6 * half * 1.7 * s, yy + sh + (i % 2 ? -8 : 2) * s);
      c.quadraticCurveTo(x - half * 1.05 * s, yy + sh * 0.6, x - half * 0.95 * s, yy + 2 * s); c.closePath(); c.fill();
      // объём паруса: наполнен ветром — светлая середина, тени к краям, швы полотнищ
      c.save(); c.clip();
      { const gx = c.createLinearGradient(x - half * s, 0, x + half * s, 0); gx.addColorStop(0, 'rgba(60,40,20,0.35)'); gx.addColorStop(0.35, 'rgba(255,250,235,0.12)'); gx.addColorStop(0.5, 'rgba(255,255,245,0.22)'); gx.addColorStop(0.75, 'rgba(90,60,30,0.08)'); gx.addColorStop(1, 'rgba(50,30,15,0.4)'); c.fillStyle = gx; c.fillRect(x - half * 1.1 * s, yy, half * 2.2 * s, sh + 10 * s); }
      { const gy = c.createLinearGradient(0, yy, 0, yy + sh); gy.addColorStop(0, 'rgba(40,25,10,0.28)'); gy.addColorStop(0.18, 'rgba(0,0,0,0)'); gy.addColorStop(1, 'rgba(60,40,20,0.18)'); c.fillStyle = gy; c.fillRect(x - half * 1.1 * s, yy, half * 2.2 * s, sh + 10 * s); }
      c.strokeStyle = 'rgba(110,80,45,0.28)'; c.lineWidth = 0.8; c.beginPath();
      for (let j = 1; j < 4; j++) { const sy = yy + sh * j / 4; c.moveTo(x - half * s, sy - 3 * s); c.quadraticCurveTo(x, sy + 4 * s, x + half * s, sy - 3 * s); }
      c.stroke(); c.restore();
      c.strokeStyle = 'rgba(80,55,30,0.55)'; c.lineWidth = 1; c.stroke();
      c.strokeStyle = 'rgba(120,90,50,0.35)'; c.beginPath(); c.moveTo(x, yy + 2); c.lineTo(x, yy + sh); c.stroke();
    }
    c.fillStyle = '#5a3a1e'; c.fillRect(x - 12 * s, y - h * 0.93, 24 * s, 9 * s);
  },
  chest(c, g, x, y, s) {
    c.fillStyle = hgrad(c, x - 14 * s, x + 14 * s, ['#9a6030', '#7a4420', '#4a2610']); c.fillRect(x - 14 * s, y - 16 * s, 28 * s, 18 * s);
    c.fillStyle = '#ffd23a'; c.beginPath(); c.ellipse(x, y - 17 * s, 12 * s, 5 * s, 0, Math.PI, 0); c.fill();
    if (g) { g.fillStyle = 'rgba(255,210,60,0.8)'; circ(g, x, y - 18 * s, 14 * s); }
    c.fillStyle = '#7a4420'; c.save(); c.translate(x - 14 * s, y - 17 * s); c.rotate(-0.9); c.fillRect(0, -14 * s, 28 * s, 14 * s); c.restore();
    c.fillStyle = '#c9a23a'; c.fillRect(x - 14 * s, y - 10 * s, 28 * s, 2.5 * s); c.fillRect(x - 2 * s, y - 13 * s, 4 * s, 6 * s);
  },
  barrel(c, g, x, y, s) {
    c.fillStyle = hgrad(c, x - 9 * s, x + 9 * s, ['#a0703f', '#7a4a22', '#4a2a10']);
    c.beginPath(); c.moveTo(x - 8 * s, y + 2); c.quadraticCurveTo(x - 11 * s, y - 11 * s, x - 8 * s, y - 24 * s); c.lineTo(x + 8 * s, y - 24 * s); c.quadraticCurveTo(x + 11 * s, y - 11 * s, x + 8 * s, y + 2); c.closePath(); c.fill();
    c.fillStyle = '#3a3a3a'; c.fillRect(x - 10 * s, y - 20 * s, 20 * s, 2 * s); c.fillRect(x - 10 * s, y - 4 * s, 20 * s, 2 * s);
  },
  /* ---------- пустыня, лёд, вулкан ---------- */
  skull(c, g, x, y, s) {
    c.fillStyle = '#efe6d2'; c.beginPath(); c.ellipse(x, y - 6 * s, 8 * s, 6 * s, 0, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(x - 7 * s, y - 9 * s); c.quadraticCurveTo(x - 16 * s, y - 14 * s, x - 18 * s, y - 20 * s); c.quadraticCurveTo(x - 12 * s, y - 13 * s, x - 5 * s, y - 11 * s); c.fill();
    c.beginPath(); c.moveTo(x + 7 * s, y - 9 * s); c.quadraticCurveTo(x + 16 * s, y - 14 * s, x + 18 * s, y - 20 * s); c.quadraticCurveTo(x + 12 * s, y - 13 * s, x + 5 * s, y - 11 * s); c.fill();
    c.fillStyle = '#3a2a1a'; circ(c, x - 3 * s, y - 7 * s, 1.8 * s); circ(c, x + 3 * s, y - 7 * s, 1.8 * s);
  },
  tumbleweed(c, g, x, y, s, r) {
    c.strokeStyle = 'rgba(140,100,50,0.85)'; c.lineWidth = 1;
    const R = 11 * s; for (let i = 0; i < 18; i++) { const a = r() * TAU, b = a + r.range(1, 3); c.beginPath(); c.arc(x + r.range(-3, 3) * s, y - R, R * r.range(0.5, 1), a, b); c.stroke(); }
  },
  drygrass(c, g, x, y, s, r) {
    c.strokeStyle = '#b8945a'; c.lineWidth = 1;
    for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + r.range(-0.6, 0.6); const l = r.range(6, 12) * s; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  },
  spike(c, g, x, y, s, r) {
    const h = r.range(50, 70) * s, w = 14 * s;
    c.fillStyle = hgrad(c, x - w, x + w, ['#4a3a5a', '#1a1420', '#0a0708']);
    c.beginPath(); c.moveTo(x - w, y + 4); c.lineTo(x + r.range(-4, 4), y - h); c.lineTo(x + w, y + 4); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(180,150,220,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - w * 0.6, y); c.lineTo(x - 1, y - h + 6); c.stroke();
    if (g) { g.strokeStyle = 'rgba(255,90,20,0.8)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 2, y - h * 0.2); g.lineTo(x - 2, y - h * 0.5); g.lineTo(x + 3, y - h * 0.7); g.stroke(); }
    c.strokeStyle = '#ff7a2a'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x + 2, y - h * 0.2); c.lineTo(x - 2, y - h * 0.5); c.lineTo(x + 3, y - h * 0.7); c.stroke();
  },
  bones(c, g, x, y, s) {
    c.strokeStyle = '#d9cfb8'; c.lineWidth = 2.2 * s; c.lineCap = 'round';
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(x, y + 2, (8 + i * 4) * s, Math.PI * 1.1, Math.PI * 1.45); c.stroke(); }
    c.beginPath(); c.moveTo(x - 20 * s, y); c.lineTo(x + 6 * s, y - 2 * s); c.stroke();
  },
  obsidian(c, g, x, y, s, r) {
    c.fillStyle = hgrad(c, x - 10 * s, x + 10 * s, ['#3a2e4a', '#16121c', '#050407']);
    c.beginPath(); c.moveTo(x - 10 * s, y + 3); c.lineTo(x - 6 * s, y - r.range(8, 16) * s); c.lineTo(x + 1 * s, y - r.range(14, 22) * s); c.lineTo(x + 8 * s, y - r.range(6, 12) * s); c.lineTo(x + 11 * s, y + 3); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(200,180,255,0.45)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 5 * s, y - 4 * s); c.lineTo(x, y - 14 * s); c.stroke();
  },
  lavarock(c, g, x, y, s, r) {
    c.fillStyle = hgrad(c, x - 12 * s, x + 12 * s, ['#4a3a36', '#2a201e', '#140e0d']);
    c.beginPath(); c.ellipse(x, y - 5 * s, 12 * s, 8 * s, 0, 0, TAU); c.fill();
    c.strokeStyle = '#ff8a2a'; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 7 * s, y - 5 * s); c.lineTo(x - 1 * s, y - 8 * s); c.lineTo(x + 5 * s, y - 3 * s); c.stroke();
    if (g) { g.fillStyle = 'rgba(255,110,20,0.7)'; circ(g, x, y - 6 * s, 9 * s); }
  },
  iceCrystal(c, g, x, y, s, r) {
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + r.range(-0.5, 0.5); const l = r.range(10, 22) * s; const w = r.range(3, 5) * s;
      const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l; const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      c.fillStyle = 'rgba(210,245,255,0.85)'; c.beginPath(); c.moveTo(x + nx, y + ny); c.lineTo(ex + nx * 0.4, ey + ny * 0.4); c.lineTo(ex + Math.cos(a) * 4 * s, ey + Math.sin(a) * 4 * s); c.lineTo(ex - nx * 0.4, ey - ny * 0.4); c.lineTo(x - nx, y - ny); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
    }
  },
  /* ---------- чужая планета ---------- */
  alientree(c, g, x, y, s, r) {
    const h = r.range(70, 90) * s; const bend = r.range(-12, 12) * s;
    c.strokeStyle = hgrad(c, x - 8 * s, x + 8 * s, ['#b28ae0', '#6a3fa0', '#3a1f66']); c.lineWidth = 9 * s; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y + 4); c.quadraticCurveTo(x + bend * 2, y - h * 0.5, x + bend, y - h); c.stroke();
    const cx = x + bend, cy = y - h; const R = 36 * s;
    c.fillStyle = vgrad(c, cy - R * 0.7, cy + R * 0.3, ['#ff8af0', '#c43fb0', '#6a1a60']);
    c.beginPath(); c.moveTo(cx - R, cy + 4 * s); c.quadraticCurveTo(cx - R * 0.95, cy - R * 0.75, cx, cy - R * 0.8); c.quadraticCurveTo(cx + R * 0.95, cy - R * 0.75, cx + R, cy + 4 * s);
    c.quadraticCurveTo(cx, cy - R * 0.15, cx - R, cy + 4 * s); c.fill();
    for (let i = 0; i < 9; i++) {
      const sx = cx + r.range(-R * 0.75, R * 0.75), sy = cy - r.range(R * 0.15, R * 0.6); const sr = r.range(2, 4.5) * s;
      c.fillStyle = '#fff2a0'; circ(c, sx, sy, sr); if (g) { g.fillStyle = 'rgba(255,240,140,0.9)'; circ(g, sx, sy, sr * 2.4); }
    }
    c.strokeStyle = 'rgba(255,140,240,0.7)'; c.lineWidth = 1.2 * s;
    for (let i = 0; i < 7; i++) { const tx = cx - R * 0.85 + i * R * 0.28; const l = r.range(8, 22) * s; c.beginPath(); c.moveTo(tx, cy + 2 * s); c.quadraticCurveTo(tx + 3 * s, cy + l * 0.5, tx, cy + l); c.stroke(); if (g) { g.fillStyle = 'rgba(255,120,240,0.8)'; circ(g, tx, cy + l, 3 * s); } }
  },
  tentacle(c, g, x, y, s, r) {
    for (let i = 0; i < 4; i++) {
      const h = r.range(28, 50) * s, sw = r.range(-16, 16) * s; const x0 = x + (i - 1.5) * 7 * s;
      c.strokeStyle = i % 2 ? '#7a3fb0' : '#5a2a8a'; c.lineWidth = r.range(4, 6) * s; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x0, y + 3); c.bezierCurveTo(x0 + sw, y - h * 0.4, x0 - sw, y - h * 0.7, x0 + sw * 0.5, y - h); c.stroke();
      c.fillStyle = '#e0b0ff'; circ(c, x0 + sw * 0.5, y - h, 2 * s);
    }
  },
  alienplant(c, g, x, y, s, r) {
    for (let i = 0; i < 3; i++) {
      const h = r.range(14, 26) * s, a = r.range(-0.4, 0.4); const ex = x + Math.sin(a) * h, ey = y - Math.cos(a) * h;
      c.strokeStyle = '#2fa08a'; c.lineWidth = 1.5 * s; c.beginPath(); c.moveTo(x, y + 2); c.quadraticCurveTo(x, y - h * 0.5, ex, ey); c.stroke();
      c.fillStyle = '#9affea'; circ(c, ex, ey, 3 * s); if (g) { g.fillStyle = 'rgba(120,255,230,0.9)'; circ(g, ex, ey, 7 * s); }
    }
  },
  pod(c, g, x, y, s) {
    c.fillStyle = vgrad(c, y - 22 * s, y, ['#ffb0f0', '#c040b0', '#5a1a50']); c.beginPath(); c.ellipse(x, y - 10 * s, 9 * s, 13 * s, 0, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,220,250,0.6)'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y - 10 * s, 5 * s, 11 * s, 0, 0, TAU); c.stroke();
    if (g) { g.fillStyle = 'rgba(255,120,230,0.8)'; circ(g, x, y - 10 * s, 16 * s); }
  },
  crystal(c, g, x, y, s, r) {
    const cols = r() < 0.5 ? ['#bffcff', '#5ff4ff', '#1a8fa8'] : ['#ffd0ff', '#ff6ef6', '#9a2a9a'];
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.45 + r.range(-0.1, 0.1); const l = r.range(12, 22) * s * (i === 1 ? 1.3 : 1); const w = r.range(3, 5) * s;
      const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l, nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
      c.fillStyle = cols[1]; c.beginPath(); c.moveTo(x + nx, y + ny); c.lineTo(ex + nx, ey + ny); c.lineTo(ex + Math.cos(a) * 5 * s, ey + Math.sin(a) * 5 * s); c.lineTo(ex - nx, ey - ny); c.lineTo(x - nx, y - ny); c.closePath(); c.fill();
      c.fillStyle = cols[0]; c.beginPath(); c.moveTo(x + nx, y + ny); c.lineTo(ex + nx, ey + ny); c.lineTo(ex + Math.cos(a) * 5 * s, ey + Math.sin(a) * 5 * s); c.lineTo(x, y); c.closePath(); c.fill();
      if (g) { g.fillStyle = cols[1]; g.globalAlpha = 0.7; circ(g, (x + ex) / 2, (y + ey) / 2, l * 0.7); g.globalAlpha = 1; }
    }
  },
  crystalBig(c, g, x, y, s, r) { DECOR.crystal(c, g, x, y, s * 2.4, r); },
  /* ---------- город ---------- */
  lamp(c, g, x, y, s) {
    c.fillStyle = '#2a2e36'; c.fillRect(x - 2 * s, y - 78 * s, 4 * s, 80 * s); c.fillRect(x - 5 * s, y - 6 * s, 10 * s, 7 * s);
    c.strokeStyle = '#2a2e36'; c.lineWidth = 3 * s; c.beginPath(); c.moveTo(x, y - 76 * s); c.quadraticCurveTo(x, y - 86 * s, x + 14 * s, y - 84 * s); c.stroke();
    c.fillStyle = '#3a3e46'; c.beginPath(); c.moveTo(x + 8 * s, y - 86 * s); c.lineTo(x + 22 * s, y - 86 * s); c.lineTo(x + 19 * s, y - 80 * s); c.lineTo(x + 11 * s, y - 80 * s); c.closePath(); c.fill();
    c.fillStyle = '#fff2c0'; c.fillRect(x + 11 * s, y - 81 * s, 8 * s, 2 * s);
  },
  car(c, g, x, y, s, r) {
    const col = r.pick(['#c0392b', '#2e86de', '#f1c40f', '#d9dde3', '#27ae60', '#8e44ad', '#e67e22']);
    const body = vgrad(c, y - 20 * s, y - 4 * s, [col, col, '#222']);
    c.fillStyle = body; rrect(c, x - 34 * s, y - 20 * s, 68 * s, 15 * s, 5 * s); c.fill();
    c.beginPath(); c.moveTo(x - 20 * s, y - 19 * s); c.lineTo(x - 11 * s, y - 31 * s); c.lineTo(x + 12 * s, y - 31 * s); c.lineTo(x + 22 * s, y - 19 * s); c.closePath(); c.fill();
    c.fillStyle = '#1c2a44'; c.beginPath(); c.moveTo(x - 16 * s, y - 20 * s); c.lineTo(x - 9.5 * s, y - 28.5 * s); c.lineTo(x - 0.5 * s, y - 28.5 * s); c.lineTo(x - 0.5 * s, y - 20 * s); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(x + 1.5 * s, y - 20 * s); c.lineTo(x + 1.5 * s, y - 28.5 * s); c.lineTo(x + 11 * s, y - 28.5 * s); c.lineTo(x + 18 * s, y - 20 * s); c.closePath(); c.fill();
    c.fillStyle = 'rgba(160,200,255,0.35)'; c.fillRect(x - 8 * s, y - 27 * s, 3 * s, 6 * s);
    for (const wx of [-21, 21]) { c.fillStyle = '#111'; circ(c, x + wx * s, y - 5 * s, 6.5 * s); c.fillStyle = '#8a8f99'; circ(c, x + wx * s, y - 5 * s, 3 * s); }
    c.fillStyle = '#fff4b0'; c.fillRect(x + 31 * s, y - 16 * s, 3 * s, 4 * s); c.fillStyle = '#ff3030'; c.fillRect(x - 34 * s, y - 16 * s, 3 * s, 4 * s);
    if (g) { g.fillStyle = 'rgba(255,240,170,0.7)'; circ(g, x + 34 * s, y - 14 * s, 8 * s); g.fillStyle = 'rgba(255,40,40,0.7)'; circ(g, x - 34 * s, y - 14 * s, 6 * s); }
  },
  planter(c, g, x, y, s, r) {
    c.fillStyle = '#6a6e76'; c.fillRect(x - 14 * s, y - 12 * s, 28 * s, 14 * s);
    c.fillStyle = '#4a3020'; c.fillRect(x - 1.5 * s, y - 40 * s, 3 * s, 30 * s);
    const blobs = []; for (let i = 0; i < 9; i++) blobs.push({ x: x + r.range(-12, 12) * s, y: y - 46 * s + r.range(-8, 8) * s, r: r.range(7, 10) * s });
    foliage(c, blobs, ['#1e4a2a', '#2f6a3a', '#4f8a4a']);
  },
  antenna(c, g, x, y, s) {
    c.strokeStyle = '#3a3e46'; c.lineWidth = 2.5 * s; c.beginPath(); c.moveTo(x, y + 2); c.lineTo(x, y - 80 * s); c.stroke();
    c.lineWidth = 1.5 * s; for (let k = 1; k <= 3; k++) { const yy = y - k * 18 * s; const w = (4 - k) * 7 * s; c.beginPath(); c.moveTo(x - w, yy); c.lineTo(x + w, yy); c.stroke(); }
    c.beginPath(); c.moveTo(x - 14 * s, y + 2); c.lineTo(x, y - 30 * s); c.lineTo(x + 14 * s, y + 2); c.stroke();
  },
  billboard(c, g, x, y, s) {
    c.fillStyle = '#2a2e36'; c.fillRect(x - 40 * s, y - 22 * s, 4 * s, 24 * s); c.fillRect(x + 36 * s, y - 22 * s, 4 * s, 24 * s);
    c.fillStyle = '#12141c'; rrect(c, x - 58 * s, y - 66 * s, 116 * s, 46 * s, 4 * s); c.fill();
    c.strokeStyle = '#3a3e4a'; c.lineWidth = 2 * s; c.stroke();
  },
  bench(c, g, x, y, s) {
    c.fillStyle = '#7a4a2a'; c.fillRect(x - 16 * s, y - 10 * s, 32 * s, 3 * s); c.fillRect(x - 16 * s, y - 17 * s, 32 * s, 3 * s);
    c.fillStyle = '#2a2e36'; c.fillRect(x - 14 * s, y - 10 * s, 2 * s, 12 * s); c.fillRect(x + 12 * s, y - 10 * s, 2 * s, 12 * s); c.fillRect(x - 14 * s, y - 18 * s, 2 * s, 8 * s); c.fillRect(x + 12 * s, y - 18 * s, 2 * s, 8 * s);
  },
  trash(c, g, x, y, s) {
    c.fillStyle = hgrad(c, x - 7 * s, x + 7 * s, ['#7a8290', '#4a5260', '#2a3040']); c.fillRect(x - 7 * s, y - 18 * s, 14 * s, 20 * s);
    c.fillStyle = '#3a4050'; c.fillRect(x - 8.5 * s, y - 20 * s, 17 * s, 3 * s);
  },
  /* ---------- мелочь ---------- */
  bush(c, g, x, y, s, r) {
    const blobs = []; const n = r.int(5, 8); for (let i = 0; i < n; i++) blobs.push({ x: x + r.range(-13, 13) * s, y: y - r.range(4, 12) * s, r: r.range(6, 10) * s });
    foliage(c, blobs, DECOR_THEME === 'castle' ? ['#26401a', '#4a7a26', '#8fb840', '#d8e670'] : ['#1c3410', '#3c6a1c', '#7aa42c', '#cce060']);
  },
  bushFlower(c, g, x, y, s, r) {
    DECOR.bush(c, g, x, y, s, r); const col = r.pick(['#ff4f7b', '#ffcf3d', '#ff8a3d', '#ffffff']);
    c.fillStyle = col; for (let i = 0; i < 6; i++) circ(c, x + r.range(-12, 12) * s, y - r.range(6, 18) * s, 1.8 * s);
  },
  bushSnow(c, g, x, y, s, r) {
    const blobs = []; for (let i = 0; i < 6; i++) blobs.push({ x: x + r.range(-11, 11) * s, y: y - r.range(3, 10) * s, r: r.range(5, 8) * s });
    foliage(c, blobs, ['#1f3e36', '#2f5a4c', '#4a7a66']);
    c.fillStyle = '#f4f8ff'; for (const b of blobs) { c.beginPath(); c.ellipse(b.x - b.r * 0.1, b.y - b.r * 0.55, b.r * 0.8, b.r * 0.45, 0, 0, TAU); c.fill(); }
  },
  rock(c, g, x, y, s, r, pal) {
    const w = r.range(9, 16) * s, h = r.range(6, 11) * s;
    const cols = pal || (DECOR_THEME === 'tropical' ? ['#a89880', '#7a6c58', '#4a4034'] : ['#a9a296', '#7c766c', '#4c4740']);
    // гранёный валун: контур из 7 точек, каждая грань (центр → ребро) освещена по своей нормали
    const pts = [[-w, 3], [-w * r.range(0.75, 0.9), -h * r.range(0.45, 0.65)], [-w * r.range(0.15, 0.35), -h], [w * r.range(0.3, 0.55), -h * r.range(0.75, 0.92)], [w, -h * r.range(0.15, 0.35)], [w * 0.92, 3]];
    const cx = x + w * r.range(-0.2, 0.05), cy = y - h * r.range(0.45, 0.6);
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(x + 2, y + 3, w * 1.1, 2.6 * s, 0, 0, TAU); c.fill();
    const C = cols.map(hex2rgb), shade = (k) => { k = clamp(k, 0, 1); const i = k < 0.5 ? 0 : 1, f = k < 0.5 ? k * 2 : (k - 0.5) * 2, A = C[2 - i], B = C[1 - i]; return `rgb(${(A[0] + (B[0] - A[0]) * f) | 0},${(A[1] + (B[1] - A[1]) * f) | 0},${(A[2] + (B[2] - A[2]) * f) | 0})`; };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const mxp = (ax + bx) / 2, myp = (ay + by) / 2;
      const nl = Math.hypot(mxp - (cx - x), myp - (cy - y)) || 1, nx = (mxp - (cx - x)) / nl, ny = (myp - (cy - y)) / nl;
      c.fillStyle = shade(0.5 + (-(nx * 0.55 + ny * 0.83)) * 0.55);
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(x + ax, y + ay); c.lineTo(x + bx, y + by); c.closePath(); c.fill();
    }
    // верхняя площадка и светлые рёбра
    c.fillStyle = shade(0.9); c.beginPath(); c.moveTo(cx, cy); c.lineTo(x + pts[1][0], y + pts[1][1]); c.lineTo(x + pts[2][0], y + pts[2][1]); c.lineTo(x + pts[3][0], y + pts[3][1]); c.closePath(); c.globalAlpha = 0.55; c.fill(); c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,245,220,0.45)'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + pts[1][0], y + pts[1][1]); c.lineTo(x + pts[2][0], y + pts[2][1]); c.lineTo(x + pts[3][0], y + pts[3][1]); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < 8; i++) circ(c, x + r.range(-w, w) * 0.7, y - r.range(0, h) * 0.8, r.range(0.5, 1.2) * s);
    if (DECOR_THEME === 'valley' && r() < 0.5) { c.fillStyle = 'rgba(90,150,50,0.8)'; c.beginPath(); c.ellipse(x - w * 0.1, y - h * 0.85, w * 0.45, h * 0.22, 0, 0, TAU); c.fill(); }
  },
  rockSnow(c, g, x, y, s, r) { DECOR.rock(c, g, x, y, s, r, ['#9fb0c6', '#6f8098', '#3f4c60']); c.fillStyle = '#f4f8ff'; c.beginPath(); c.ellipse(x - 2 * s, y - 8 * s, 9 * s, 3.5 * s, 0, 0, TAU); c.fill(); },
  flowers(c, g, x, y, s, r) {
    for (let i = 0; i < 5; i++) {
      const fx = x + r.range(-10, 10) * s, h = r.range(6, 12) * s; c.strokeStyle = '#3f8f2a'; c.lineWidth = 1; c.beginPath(); c.moveTo(fx, y + 1); c.lineTo(fx, y - h); c.stroke();
      c.fillStyle = r.pick(['#ff5d8f', '#ffd93d', '#ffffff', '#b28dff', '#ff9a3d']); for (let p = 0; p < 5; p++) { const a = p / 5 * TAU; circ(c, fx + Math.cos(a) * 1.8 * s, y - h + Math.sin(a) * 1.8 * s, 1.4 * s); }
      c.fillStyle = '#ffe36b'; circ(c, fx, y - h, 1 * s);
    }
  },
  mushroom(c, g, x, y, s, r) {
    for (let i = 0; i < r.int(1, 3); i++) {
      const mx = x + r.range(-8, 8) * s, h = r.range(5, 9) * s, R = r.range(4, 6) * s;
      c.fillStyle = '#f2ead8'; c.fillRect(mx - 1.5 * s, y - h, 3 * s, h + 2);
      c.fillStyle = '#d93a2a'; c.beginPath(); c.ellipse(mx, y - h, R, R * 0.7, 0, Math.PI, 0); c.fill();
      c.fillStyle = '#fff'; circ(c, mx - R * 0.4, y - h - R * 0.35, 0.9 * s); circ(c, mx + R * 0.3, y - h - R * 0.45, 0.8 * s);
    }
  },
  tuft(c, g, x, y, s, r) {
    const cols = DECOR_THEME === 'city' ? ['#4a6a3a', '#3a5a2a'] : ['#5fb236', '#79cf45', '#3d8426'];
    for (let i = 0; i < 9; i++) { c.strokeStyle = r.pick(cols); c.lineWidth = 1.2; const a = -Math.PI / 2 + r.range(-0.7, 0.7); const l = r.range(6, 13) * s; c.beginPath(); c.moveTo(x + r.range(-3, 3), y + 1); c.quadraticCurveTo(x + Math.cos(a) * l * 0.4, y + Math.sin(a) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  },
  shell(c, g, x, y, s) {
    c.fillStyle = '#ffd9c4'; c.beginPath(); c.moveTo(x, y); c.arc(x, y, 6 * s, Math.PI, 0); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(180,100,80,0.6)'; c.lineWidth = 0.8; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + i * 2.6 * s, y - 5.5 * s); c.stroke(); }
  },
  /* ---------- детали замков ---------- */
  roof(c, g, x, y, s, r, o = {}) {
    const w = (o.w || 90) * s, h = w * 1.05; const col = o.col || '#b0413a';
    c.fillStyle = hgrad(c, x - w / 2, x + w / 2, [css(shadec(col, 1.3)), col, css(shadec(col, 0.55))]);
    c.beginPath(); c.moveTo(x - w / 2 - 5, y); c.lineTo(x, y - h); c.lineTo(x + w / 2 + 5, y); c.closePath(); c.fill();
    c.save(); c.clip(); c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 1;
    for (let yy = y - 6; yy > y - h; yy -= 7) { c.beginPath(); c.moveTo(x - w, yy); c.lineTo(x + w, yy); c.stroke(); }
    for (let k = -6; k <= 6; k++) { c.beginPath(); c.moveTo(x + k * w / 12, y); c.lineTo(x, y - h); c.stroke(); }
    c.restore();
    c.fillStyle = css(shadec(col, 0.45)); c.fillRect(x - w / 2 - 7, y - 3, w + 14, 5);
    c.fillStyle = '#e0bb55'; circ(c, x, y - h - 2, 3.2);
  },
  litwin(c, g, x, y, s, r, o = {}) {
    const w = (o.w || 16) * s, h = (o.h || 24) * s;
    if (o.dim) {
      if (g) { const gr = g.createRadialGradient(x, y + h * 0.55, 1, x, y + h * 0.55, w * 0.55); gr.addColorStop(0, 'rgba(255,170,70,0.75)'); gr.addColorStop(1, 'rgba(255,140,40,0)'); g.fillStyle = gr; g.fillRect(x - w, y, w * 2, h * 1.2); }
      c.fillStyle = 'rgba(15,8,4,0.7)'; c.fillRect(x - w * 0.34, y + h * 0.62, w * 0.46, 3); c.fillRect(x - w * 0.3, y + h * 0.62, 2.5, h * 0.38); c.fillRect(x + w * 0.08, y + h * 0.62, 2.5, h * 0.38);
      c.fillRect(x + w * 0.2, y + h * 0.28, w * 0.22, h * 0.72);
      c.fillStyle = '#ffd27a'; c.fillRect(x - w * 0.14, y + h * 0.5, 2, 4);
      return;
    }
    c.fillStyle = vgrad(c, y, y + h, ['#fff0b8', '#ffb347']); c.fillRect(x - w / 2, y, w, h);
    if (g) { g.fillStyle = 'rgba(255,190,90,0.85)'; g.fillRect(x - w / 2 - 3, y - 2, w + 6, h + 4); }
    c.fillStyle = 'rgba(80,40,10,0.75)'; c.fillRect(x - 1, y, 2, h); c.fillRect(x - w / 2, y + h * 0.5, w, 2);
  },
  banner(c, g, x, y, s, r, o = {}) {
    const w = 26 * s, h = 38 * s; const col = o.col || '#b0413a';
    c.fillStyle = '#3a2a1a'; c.fillRect(x - w / 2 - 3, y - 2, w + 6, 3);
    c.fillStyle = vgrad(c, y, y + h, [css(shadec(col, 1.15)), col]);
    c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.lineTo(x, y + h - 8 * s); c.lineTo(x - w / 2, y + h); c.closePath(); c.fill();
    c.fillStyle = '#f2d36b'; c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? 3.2 * s : 7.5 * s; c.lineTo(x + Math.cos(a) * rr, y + h * 0.42 + Math.sin(a) * rr); }
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1; c.strokeRect(x - w / 2 + 2, y + 2, w - 4, h - 12);
  },
};
const DECOR_EXACT = new Set(['roof', 'litwin', 'banner']);
const DECOR_FRONT = new Set(['banner']);

function drawDecorItem(fn, c, g, x, y, s, r, flip, o) {
  c.save(); if (g) g.save();
  if (flip) { c.translate(x, 0); c.scale(-1, 1); c.translate(-x, 0); if (g) { g.translate(x, 0); g.scale(-1, 1); g.translate(-x, 0); } }
  try { fn(c, g, x, y, s, r, o); } catch (e) { console.warn('decor', e); }
  c.restore(); if (g) g.restore();
}

/** общий свет для всех объектов карты: края силуэта, обращённые к солнцу, светлеют, противоположные уходят в тень */
function lightDecorLayer(cv) {
  const W = cv.width, H = cv.height, x = cv.getContext('2d', { willReadFrequently: true }), S = 192, P = 4;
  const ll = Math.hypot(LIGHT.x, LIGHT.y), lx = LIGHT.x / ll, ly = LIGHT.y / ll;
  for (let y0 = 0; y0 < H; y0 += S) {
    const ya = Math.max(0, y0 - P), yb = Math.min(H, y0 + S + P), h = yb - ya;
    const img = x.getImageData(0, ya, W, h), d = img.data;
    let any = false; for (let i = 3; i < d.length; i += 64) if (d[i]) { any = true; break; }
    if (!any) continue;
    const A = new Float32Array(W * h); for (let i = 0; i < W * h; i++) A[i] = d[i * 4 + 3] / 255;
    boxBlurF32(A, W, h, 2);
    const r0 = Math.max(1, y0 - ya), r1 = Math.min(h - 1, y0 - ya + S);
    for (let yy = r0; yy < r1; yy++) for (let xx = 1; xx < W - 1; xx++) {
      const i = yy * W + xx, j = i * 4; if (!d[j + 3]) continue;
      const lit = -((A[i + 1] - A[i - 1]) * lx + (A[i + W] - A[i - W]) * ly);
      const f = 1 + Math.max(-0.42, Math.min(0.5, lit * 1.25));
      if (f > 1) { const w = f - 1; d[j] = Math.min(255, d[j] * f + w * 40); d[j + 1] = Math.min(255, d[j + 1] * f + w * 26); d[j + 2] = Math.min(255, d[j + 2] * f + w * 6); }
      else { d[j] *= f; d[j + 1] *= f; d[j + 2] = d[j + 2] * f + (1 - f) * 18; }
    }
    x.putImageData(img, 0, ya);
  }
}
function placeDecor(T, theme, map, waterY, tops, mat) {
  // объекты рисуются на отдельный слой, освещаются одним солнцем и переносятся на слой декора
  const layer = makeCanvas(T.W, T.H), c = layer.getContext('2d', { willReadFrequently: true });
  placeDecorOn(T, theme, map, waterY, tops, mat, c);
  lightDecorLayer(layer); T.dctx.drawImage(layer, 0, 0);
}
function placeDecorOn(T, theme, map, waterY, tops, mat, c) {
  const g = T.gctx; const r = makeRng((map.seed || 1) * 7919 + 13);
  DECOR_THEME = theme.id;
  for (const d of map.decor || []) {
    const [kind, x, y0, s = 1, flip = false, opts] = d;
    const fn = DECOR[kind]; if (!fn) continue;
    const y = DECOR_EXACT.has(kind) ? y0 : T.findTop(x, y0 == null ? 0 : y0 - 40) + 2;
    if (y >= T.H) continue;
    drawDecorItem(fn, DECOR_FRONT.has(kind) ? T.ctx : c, g, x, y, s, r, flip, opts);
  }
  const kinds = theme.scatter || [];
  if (!kinds.length) return;
  const occupied = (map.decor || []).map(d => d[1]);
  let lastX = -999;
  for (let k = 0; k < tops.length; k += 2) {
    const x = tops[k], y = tops[k + 1];
    if (x - lastX < 30 || y > waterY - 12 || x < 40 || x > T.W - 40) continue;
    if (mat[y * T.W + x] !== 1) continue;
    if (!T.isSolid(x - 6, y + 4) || !T.isSolid(x + 6, y + 4) || T.isSolid(x - 6, y - 8) || T.isSolid(x + 6, y - 8) || T.isSolid(x, y - 20)) continue;
    if (r() > 0.3) continue;
    if (occupied.some(ox => Math.abs(ox - x) < 45)) continue;
    lastX = x;
    const fn = DECOR[r.pick(kinds)]; if (fn) drawDecorItem(fn, c, g, x, y + 2, r.range(0.75, 1.1), r, r() < 0.5);
  }
}

/** анимированные объекты карт (мельница, флаги, фонари, неон...) */
function resolveProps(T, map) {
  const list = [];
  for (const p of map.props || []) {
    const [kind, x, y0, o = {}] = p;
    let y = y0 == null ? T.findTop(x, 0) : y0;
    if (o.dy) y += o.dy;
    const hitR = { windmill: 60, flag: 20, torch: 14, lamp: 16, neon: 40, beacon: 12, smoke: 0, fire: 14 }[kind] ?? 16;
    list.push({ kind, x, y, o, alive: true, hitR, seed: list.length * 1.7 });
  }
  return list;
}
