'use strict';
/* =========================================================
   Частицы (дым, огонь, искры, обломки, брызги) и погода
   ========================================================= */
const FIRE_COLS = ['#fff6c2', '#ffd35a', '#ffa22a', '#ff6a1a', '#d8341a', '#7a1a10'];

class Particles {
  constructor() { this.a = []; this.max = 2800; this.onRest = null; }   // onRest(p) — частица легла на землю: остаётся на карте
  add(p) { if (this.a.length >= this.max) this.a.splice(0, 300); this.a.push(p); return p; }
  smoke(x, y, vx, vy, size, life, col, grow = 2.2, al = 0.8) { return this.add({ t: 0, x, y, vx, vy, s: size, s2: size * grow, life, max: life, col, al, g: -14, drag: 1.3, wind: 0.08 }); }
  fire(x, y, vx, vy, size, life) { return this.add({ t: 1, x, y, vx, vy, s: size, s2: size * 0.3, life, max: life, g: -60, drag: 2.2, wind: 0.05 }); }
  spark(x, y, vx, vy, life, col = '#ffe9a0', g = 520) { return this.add({ t: 2, x, y, vx, vy, life, max: life, col, g, drag: 0.6 }); }
  debris(x, y, vx, vy, size, col, life) { return this.add({ t: 3, x, y, vx, vy, s: size, life, max: life, col, g: 900, drag: 0.3, collide: true, rot: rand(0, TAU), vr: rand(-12, 12) }); }
  drop(x, y, vx, vy, col, size = 2) { return this.add({ t: 4, x, y, vx, vy, s: size, life: 1.6, max: 1.6, col, g: 820, drag: 0.2 }); }
  ring(x, y, r0, r1, life, col = '#ffffff', w = 3) { return this.add({ t: 5, x, y, vx: 0, vy: 0, s: r0, s2: r1, life, max: life, col, w }); }
  glow(x, y, vx, vy, size, life, col, g = 0) { return this.add({ t: 6, x, y, vx, vy, s: size, life, max: life, col, g, drag: 1 }); }
  shell(x, y, vx, vy) { return this.add({ t: 7, x, y, vx, vy, s: 1, life: 2.2, max: 2.2, col: '#d8b04a', g: 900, drag: 0.2, collide: true, rot: rand(0, TAU), vr: rand(-20, 20) }); }
  star(x, y, vx, vy, life) { return this.add({ t: 8, x, y, vx, vy, s: rand(3, 5), life, max: life, col: '#ffe36b', g: 300, drag: 1, rot: 0, vr: rand(-8, 8) }); }
  update(dt, sc) {
    const T = sc.terrain, wind = sc.turn ? sc.turn.wind : 0, wy = sc.waterY;
    const A = this.a;
    for (let i = A.length - 1; i >= 0; i--) {
      const p = A[i]; p.life -= dt;
      if (p.life <= 0) { if (this.onRest && (p.t === 3 || p.t === 7) && p.y < wy) this.onRest(p); A[i] = A[A.length - 1]; A.pop(); continue; }
      if (p.drag) { const k = 1 - p.drag * dt; p.vx *= k; p.vy *= k; }
      if (p.wind) p.vx += wind * p.wind * dt;
      if (p.g) p.vy += p.g * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      if (p.t === 4 && this.onRest && T.isSolid(nx, ny)) { this.onRest(p); A[i] = A[A.length - 1]; A.pop(); continue; }   // капля крови впиталась — пятно
      if (p.collide && T.isSolid(nx, ny)) {
        if (T.isSolid(p.x, ny)) { p.vy *= -0.3; p.vx *= 0.65; } else p.vx *= -0.5;
        if (Math.abs(p.vy) < 40) { p.vy = 0; p.vx *= 0.7; p.vr *= 0.5; }
      } else { p.x = nx; p.y = ny; }
      if (p.rot !== undefined) p.rot += p.vr * dt;
      if ((p.t === 4 || p.t === 3 || p.t === 7) && p.y > wy + 3) p.life = Math.min(p.life, 0.05);
    }
  }
  draw(c, additive) {
    const A = this.a;
    for (let i = 0; i < A.length; i++) {
      const p = A[i]; const k = p.life / p.max;
      switch (p.t) {
        case 0: if (additive) break; {
          const s = lerp(p.s2, p.s, k); c.globalAlpha = p.al * Math.min(1, k * 1.6) * Math.min(1, (1 - k) * 8 + 0.2);
          c.drawImage(puffSprite(p.col), p.x - s, p.y - s, s * 2, s * 2); break;
        }
        case 1: if (!additive) break; {
          const s = lerp(p.s2, p.s, k); const ci = Math.min(FIRE_COLS.length - 1, Math.floor((1 - k) * FIRE_COLS.length));
          c.globalAlpha = Math.min(1, k * 2); c.drawImage(glowSprite(FIRE_COLS[ci]), p.x - s, p.y - s, s * 2, s * 2); break;
        }
        case 2: if (!additive) break;
          c.globalAlpha = Math.min(1, k * 2); c.strokeStyle = p.col; c.lineWidth = 1.6;
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); c.stroke(); break;
        case 3: if (additive) break;
          c.globalAlpha = Math.min(1, k * 3); c.fillStyle = p.col;
          c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.8); c.restore(); break;
        case 4: if (additive) break;
          c.globalAlpha = Math.min(1, k * 2); c.fillStyle = p.col; c.beginPath(); c.arc(p.x, p.y, p.s, 0, TAU); c.fill(); break;
        case 5: if (additive) break; {
          const r = lerp(p.s2, p.s, k); c.globalAlpha = k * 0.7; c.strokeStyle = p.col; c.lineWidth = p.w * k + 0.5;
          c.beginPath(); c.arc(p.x, p.y, r, 0, TAU); c.stroke(); break;
        }
        case 6: if (!additive) break;
          c.globalAlpha = Math.min(1, k * 2.5); c.drawImage(glowSprite(p.col), p.x - p.s, p.y - p.s, p.s * 2, p.s * 2); break;
        case 7: if (additive) break;
          c.globalAlpha = Math.min(1, k * 3); c.fillStyle = p.col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillRect(-1.6, -0.8, 3.2, 1.6); c.restore(); break;
        case 8: if (!additive) break; {
          c.globalAlpha = Math.min(1, k * 2); c.fillStyle = p.col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
          c.beginPath(); for (let j = 0; j < 10; j++) { const a = j * Math.PI / 5; const rr = j % 2 ? p.s * 0.45 : p.s; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill(); c.restore(); break;
        }
      }
    }
    c.globalAlpha = 1;
  }
}

/* ---------- погода в пределах экрана ---------- */
class Weather {
  constructor(kind) { this.kind = kind; this.p = []; this.t = 0; }
  density() { return { snow: 1 / 3200, rain: 1 / 1800, leaves: 1 / 60000, dust: 1 / 14000, embers: 1 / 9000, spores: 1 / 11000, fireflies: 1 / 26000 }[this.kind] || 0; }
  spawn(v, anywhere) {
    const x = rand(v.x0, v.x1), y = anywhere ? rand(v.y0, v.y1) : (this.kind === 'embers' || this.kind === 'spores' ? v.y1 + 10 : v.y0 - 10);
    const p = { x, y, ph: rand(0, TAU), s: 1 };
    switch (this.kind) {
      case 'snow': p.vy = rand(28, 70); p.vx = rand(-8, 8); p.s = rand(1, 2.6); break;
      case 'rain': p.vy = rand(700, 900); p.vx = 0; p.s = rand(10, 18); break;
      case 'leaves': p.vy = rand(18, 40); p.vx = rand(-10, 10); p.s = rand(2.5, 4); p.col = pick(['#7fbf3a', '#c9a23a', '#d9772a', '#5f9a2e']); p.rot = rand(0, TAU); break;
      case 'dust': p.vy = rand(-4, 4); p.vx = rand(10, 30); p.s = rand(0.8, 1.8); break;
      case 'embers': p.vy = rand(-70, -30); p.vx = rand(-10, 10); p.s = rand(1, 2.4); p.life = rand(3, 7); break;
      case 'spores': p.vy = rand(-18, -6); p.vx = rand(-6, 6); p.s = rand(1.5, 3); p.col = pick(['#5ff4ff', '#ff6ef6', '#b6ff5a']); break;
      case 'fireflies': p.vy = rand(-8, 8); p.vx = rand(-8, 8); p.s = rand(1.4, 2.4); break;
    }
    return p;
  }
  update(dt, v, wind) {
    if (!this.kind) return;
    this.t += dt;
    const area = (v.x1 - v.x0) * (v.y1 - v.y0); const want = Math.min(900, Math.round(area * this.density()));
    while (this.p.length < want) this.p.push(this.spawn(v, true));
    if (this.p.length > want + 40) this.p.length = want;
    const mx = 60;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      const w = wind * (this.kind === 'rain' ? 0.9 : this.kind === 'snow' ? 0.25 : 0.12);
      switch (this.kind) {
        case 'snow': p.x += (p.vx + w + Math.sin(this.t * 1.3 + p.ph) * 10) * dt; p.y += p.vy * dt; break;
        case 'rain': p.x += (w + 60) * dt; p.y += p.vy * dt; break;
        case 'leaves': p.x += (p.vx + w + Math.sin(this.t * 1.7 + p.ph) * 22) * dt; p.y += (p.vy + Math.cos(this.t * 2.1 + p.ph) * 8) * dt; p.rot += dt * 2; break;
        case 'dust': p.x += (p.vx + w) * dt; p.y += (p.vy + Math.sin(this.t + p.ph) * 4) * dt; break;
        case 'embers': p.x += (p.vx + w + Math.sin(this.t * 3 + p.ph) * 10) * dt; p.y += p.vy * dt; break;
        default: p.x += (p.vx + w * 0.3 + Math.sin(this.t * 0.8 + p.ph) * 8) * dt; p.y += (p.vy + Math.cos(this.t * 0.9 + p.ph) * 6) * dt;
      }
      if (p.x < v.x0 - mx || p.x > v.x1 + mx || p.y < v.y0 - mx * 2 || p.y > v.y1 + mx) this.p[i] = this.spawn(v, p.x < v.x0 - mx || p.x > v.x1 + mx);
    }
  }
  draw(c, t) {
    if (!this.kind || !this.p.length) return;
    switch (this.kind) {
      case 'snow': c.fillStyle = 'rgba(255,255,255,0.85)'; for (const p of this.p) { c.beginPath(); c.arc(p.x, p.y, p.s, 0, TAU); c.fill(); } break;
      case 'rain': c.strokeStyle = 'rgba(170,190,255,0.35)'; c.lineWidth = 1; c.beginPath(); for (const p of this.p) { c.moveTo(p.x, p.y); c.lineTo(p.x - 1.2, p.y - p.s); } c.stroke(); break;
      case 'leaves': for (const p of this.p) { c.fillStyle = p.col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, Math.abs(Math.sin(p.rot * 1.3)) * 0.8 + 0.2); c.beginPath(); c.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, TAU); c.fill(); c.restore(); } break;
      case 'dust': c.fillStyle = 'rgba(255,230,190,0.35)'; for (const p of this.p) c.fillRect(p.x, p.y, p.s, p.s); break;
      default: {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (const p of this.p) {
          const col = this.kind === 'embers' ? '#ff8a2a' : this.kind === 'fireflies' ? '#d8ff6a' : p.col;
          const a = this.kind === 'fireflies' ? Math.max(0, Math.sin(t * 2 + p.ph)) : 0.6 + 0.4 * Math.sin(t * 5 + p.ph);
          c.globalAlpha = a; const s = p.s * 3; c.drawImage(glowSprite(col), p.x - s, p.y - s, s * 2, s * 2);
        }
        c.restore();
      }
    }
  }
}
