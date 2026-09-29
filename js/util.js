'use strict';
/** высота плеча бойца над ногами: отсюда вылетают пули и снаряды */
const GUN_Y = 24;
/* =========================================================
   Общие утилиты: математика, сидированный ГСЧ, шум, цвета
   ========================================================= */
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; const u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };
function angNorm(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
function approach(v, target, rate, dt) { return v + (target - v) * (1 - Math.exp(-rate * dt)); }
function pointSegDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = clamp(t, 0, 1);
  const qx = ax + dx * t - px, qy = ay + dy * t - py; return qx * qx + qy * qy;
}
function shuffleArr(a, r = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function isNum(v) { return typeof v === 'number' && isFinite(v); }

/* ---------- сидированный ГСЧ (mulberry32) ---------- */
function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + r() * (b - a);
  r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

/* ---------- детерминированный шум (только арифметика) ---------- */
function hash3(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const GRADS = [1, 0, -1, 0, 0, 1, 0, -1, 0.70710678, 0.70710678, -0.70710678, 0.70710678, 0.70710678, -0.70710678, -0.70710678, -0.70710678];
function perlin2(x, y, s, px = 0, py = 0) {
  let ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  let ix1 = ix + 1, iy1 = iy + 1;
  if (px) { ix = ((ix % px) + px) % px; ix1 = ((ix1 % px) + px) % px; }
  if (py) { iy = ((iy % py) + py) % py; iy1 = ((iy1 % py) + py) % py; }
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let g = ((hash3(ix, iy, s) * 8) | 0) << 1; const n00 = GRADS[g] * fx + GRADS[g + 1] * fy;
  g = ((hash3(ix1, iy, s) * 8) | 0) << 1; const n10 = GRADS[g] * (fx - 1) + GRADS[g + 1] * fy;
  g = ((hash3(ix, iy1, s) * 8) | 0) << 1; const n01 = GRADS[g] * fx + GRADS[g + 1] * (fy - 1);
  g = ((hash3(ix1, iy1, s) * 8) | 0) << 1; const n11 = GRADS[g] * (fx - 1) + GRADS[g + 1] * (fy - 1);
  const a = n00 + u * (n10 - n00), b = n01 + u * (n11 - n01);
  return a + v * (b - a);
}
function fbm2(x, y, s, oct, px = 0, py = 0) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * perlin2(x * f, y * f, s + i * 7919, px * f, py * f); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function noise1(x, s, p = 0) {
  let ix = Math.floor(x); const fx = x - ix; let ix1 = ix + 1;
  if (p) { ix = ((ix % p) + p) % p; ix1 = ((ix1 % p) + p) % p; }
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const g0 = hash3(ix, 0, s) * 2 - 1, g1 = hash3(ix1, 0, s) * 2 - 1;
  const a = g0 * fx, b = g1 * (fx - 1);
  return (a + u * (b - a)) * 2;
}
function fbm1(x, s, oct, p = 0) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * noise1(x * f, s + i * 7919, p * f); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

/* ---------- цвета ---------- */
function hex2rgb(h) {
  if (Array.isArray(h)) return h;
  h = h.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(c, a = 1) { c = hex2rgb(c); return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function mixc(a, b, t) { a = hex2rgb(a); b = hex2rgb(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function shadec(c, f) { c = hex2rgb(c); return [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)]; }
function css(c) { c = hex2rgb(c); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }

/* ---------- canvas ---------- */
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
function rrect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
const _spriteCache = new Map();
/** мягкий светящийся спрайт (для аддитивного смешивания) */
function glowSprite(color, soft = 1) {
  const key = 'g' + color + soft;
  let c = _spriteCache.get(key); if (c) return c;
  c = makeCanvas(64, 64); const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  const [r, gg, b] = hex2rgb(color);
  g.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  g.addColorStop(soft > 1 ? 0.15 : 0.25, `rgba(${r},${gg},${b},0.7)`);
  g.addColorStop(0.55, `rgba(${r},${gg},${b},0.18)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _spriteCache.set(key, c); return c;
}
/** мягкий клуб дыма */
function puffSprite(color) {
  const key = 'p' + color;
  let c = _spriteCache.get(key); if (c) return c;
  c = makeCanvas(64, 64); const x = c.getContext('2d');
  const [r, gg, b] = hex2rgb(color);
  const g = x.createRadialGradient(28, 26, 2, 32, 32, 32);
  g.addColorStop(0, `rgba(${Math.min(255, r + 25)},${Math.min(255, gg + 25)},${Math.min(255, b + 25)},0.95)`);
  g.addColorStop(0.5, `rgba(${r},${gg},${b},0.75)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _spriteCache.set(key, c); return c;
}
function textOutlined(ctx, text, x, y, color = '#fff', outline = 'rgba(0,0,0,0.85)', ow = 4) {
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  ctx.strokeStyle = outline; ctx.lineWidth = ow; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
const FONT_TITLE = "'Russo One', 'Arial Black', sans-serif";
const FONT_UI = "'Rubik', 'Segoe UI', sans-serif";
