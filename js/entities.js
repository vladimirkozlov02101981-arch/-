'use strict';
/* =========================================================
   Сущности на стороне хоста (симуляция): снаряды, гранаты,
   мины, огонь, робо-бомба, чёрная дыра, ящики, надгробия
   ========================================================= */
const KINDS = ['rocket', 'homing', 'mortar', 'frag', 'drill', 'mini', 'grenade', 'cluster', 'bomblet', 'sticky', 'molotov', 'fire', 'flame',
  'bholeg', 'bhole', 'dynamite', 'mine', 'robot', 'bomb', 'jet', 'orbital', 'nukem', 'crate', 'tomb', 'storm', 'barrel'];
/** нормальное распределение: для разброса ударов с воздуха */
function gaussRand() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }
const KIND_IDX = Object.fromEntries(KINDS.map((k, i) => [k, i]));
const BLAST = {
  rocket: { R: 42, D: 48, K: 330 }, homing: { R: 40, D: 45, K: 320 }, mortar: { R: 46, D: 55, K: 350 }, frag: { R: 17, D: 12, K: 150 },
  drill: { R: 38, D: 42, K: 320 }, mini: { R: 22, D: 18, K: 190 }, grenade: { R: 46, D: 50, K: 350 }, cluster: { R: 30, D: 24, K: 260 },
  bomblet: { R: 20, D: 16, K: 180 }, sticky: { R: 42, D: 46, K: 330 }, dynamite: { R: 76, D: 72, K: 520 }, mine: { R: 42, D: 45, K: 340 },
  robot: { R: 62, D: 56, K: 460 }, bomb: { R: 32, D: 26, K: 280 }, nukem: { R: 135, D: 82, K: 760 }, crate: { R: 36, D: 25, K: 300 },
};
const R1 = (v) => Math.round(v * 10) / 10;

/* ---------- физика ---------- */
function flyStep(g, e, dt, grav, windF, r, ignore) {
  e.vx += g.turn.wind * windF * dt; e.vy += g.gravity * grav * dt;
  const drag=1/(1+Math.hypot(e.vx,e.vy)*.000012*dt);
  e.vx*=drag;e.vy*=drag;
  const sp = Math.hypot(e.vx, e.vy); const n = Math.max(1, Math.ceil(sp * dt / 2.5));
  const sx = e.vx * dt / n, sy = e.vy * dt / n;
  for (let i = 0; i < n; i++) {
    e.x += sx; e.y += sy;
    if (g.terrain.isSolid(e.x, e.y)) return { type: 'terrain' };
    const s = g.soldierAt(e.x, e.y, r, ignore); if (s) return { type: 'soldier', s };
    if (e.y > g.waterY) return { type: 'water' };
  }
  if (e.x < -900 || e.x > g.W + 900 || e.y > g.H + 300) return { type: 'out' };
  return null;
}
/** мина миномёта отскакивает от стен и потолка; от пола — нет (там она взрывается) */
function mortarBounce(g, e) {
  const T = g.terrain, sp = Math.hypot(e.vx, e.vy) || 1;
  const n = T.normalAt(e.x - e.vx / sp * 2, e.y - e.vy / sp * 2, 4);
  if (n.y < -0.55) return false;
  const vn = e.vx * n.x + e.vy * n.y; if (vn >= 0) return false;
  e.vx -= 1.7 * vn * n.x; e.vy -= 1.7 * vn * n.y;
  for (let k = 0; k < 10 && T.isSolid(e.x, e.y); k++) { e.x += n.x; e.y += n.y; }
  return true;
}
function supported(T, x, y, r) { return T.isSolid(x, y + r + 1) || T.isSolid(x - 2, y + r + 1) || T.isSolid(x + 2, y + r + 1); }
function bounceStep(g, e, dt, o) {
  const T = g.terrain, r = o.r || 3;
  if (e.rest) {
    if (supported(T, e.x, e.y, r)) { e.vx = 0; e.vy = 0; return null; }
    e.rest = false;
  }
  e.vx += g.turn.wind * (o.wind || 0) * dt; e.vy += g.gravity * (o.grav ?? 1) * dt;
  const drag=1/(1+Math.hypot(e.vx,e.vy)*.000025*dt);e.vx*=drag;e.vy*=drag;
  const n = Math.max(1, Math.ceil(Math.hypot(e.vx, e.vy) * dt / 2));
  for (let i = 0; i < n; i++) {
    const nx = e.x + e.vx * dt / n, ny = e.y + e.vy * dt / n;
    const spd = Math.hypot(e.vx, e.vy) || 1;
    const lx = nx + e.vx / spd * r, ly = ny + e.vy / spd * r;
    if (T.isSolid(lx, ly) || T.isSolid(nx, ny)) {
      const nrm = T.normalAt(lx, ly, 4);
      const vn = e.vx * nrm.x + e.vy * nrm.y;
      if (vn < 0) {
        const tx = e.vx - vn * nrm.x, ty = e.vy - vn * nrm.y;
        const material = T.materialAt ? T.materialAt(lx,ly) : 1;
        const response = {1:.55,2:.9,3:.82,4:.6,5:.85,6:1,7:1.22,8:1.05,9:.85}[material] || .8;
        const restitution = Math.min(.94,(o.rest ?? .45)*response);
        const friction = material === 7 ? .96 : material === 1 ? (o.fric ?? .8) * .92 : (o.fric ?? .8);
        e.vx = tx * friction - vn * nrm.x * restitution;
        e.vy = ty * friction - vn * nrm.y * restitution;
        if (o.onImpact && o.onImpact(-vn, nrm) === 'stop') return 'stop';
      }
      for (let k = 0; k < 8 && (T.isSolid(e.x, e.y) || T.isSolid(e.x - nrm.x * r, e.y - nrm.y * r)); k++) { e.x += nrm.x; e.y += nrm.y; }
      // качение: вращение от скорости по касательной; замирает только на почти ровном месте, со склона скатывается
      { const tv = e.vx * -nrm.y + e.vy * nrm.x; e.spinV = tv / Math.max(2, r); }
      if (Math.hypot(e.vx, e.vy) < 18 && nrm.y < -0.88) { e.vx = 0; e.vy = 0; e.rest = true; e.spinV = 0; }
      else if (Math.hypot(e.vx, e.vy) < 40 && nrm.y < -0.45) { e.vx -= nrm.x * g.gravity * 0.35 * dt * n; }
      return 'bounce';
    }
    e.x = nx; e.y = ny;
    if (e.y > g.waterY) return 'water';
  }
  if (e.x < -900 || e.x > g.W + 900) return 'out';
  return null;
}
function muzzle(s, aim, d) { return { x: s.x + Math.cos(aim) * d, y: s.y - GUN_Y + Math.sin(aim) * d }; }
function hitscan(g, x0, y0, ang, range, ignore) {
  const dx = Math.cos(ang), dy = Math.sin(ang), T = g.terrain;
  for (let d = 0; d <= range; d += 2) {
    const x = x0 + dx * d, y = y0 + dy * d;
    if (y > g.waterY) return { type: 'water', x, y };
    if (T.isSolid(x, y)) return { type: 'terrain', x, y };
    const s = g.soldierAt(x, y, 0, ignore); if (s) return { type: 'soldier', x, y, s };
    if (x < -300 || x > g.W + 300 || y < -1500) break;
  }
  return { type: 'none', x: x0 + dx * range, y: y0 + dy * range };
}

/* ---------- базовая сущность ---------- */
class Ent {
  constructor(g, k, x, y, vx = 0, vy = 0) {
    this.id = g.nextId++; this.k = k; this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.a = 0; this.f = 0; this.s = 0; this.v = 0; this.team = -1; this.owner = null;
    this.age = 0; this.dead = false; this.busy = true; this.rest = false; this.pushable = true;
  }
  snap() { return [this.id, KIND_IDX[this.k], Math.round(this.x * 10), Math.round(this.y * 10), Math.round(this.a * 100), Math.round(this.f * 10), this.s | 0, this.team, Math.round(this.v)]; }
  push(vx, vy) { if (!this.pushable) return; this.vx += vx; this.vy += vy; this.rest = false; }
  update() { }
}

/* ---------- ракеты и снаряды ---------- */
class Proj extends Ent {
  constructor(g, k, x, y, vx, vy, owner, o = {}) {
    super(g, k, x, y, vx, vy); this.owner = owner; this.team = owner ? owner.team : -1; this.o = o;
    this.wind = o.wind ?? 0; this.grav = o.grav ?? 1; this.r = o.r ?? 2.5; this.a = Math.atan2(vy, vx); this.pushable = false;
  }
  update(g, dt) {
    this.age += dt;
    if (this.k === 'homing' && this.o.tx != null) {
      // Головка наведения поворачивает ракету с ограниченной скоростью и видит цель
      // только в переднем секторе; топлива хватает на 4 секунды.
      if (this.age > 0.4 && this.age < 4.4) {
        const dx = this.o.tx - this.x, dy = this.o.ty - this.y;
        const a = Math.atan2(this.vy, this.vx), want = Math.atan2(dy, dx), diff = angNorm(want - a);
        const sp = Math.min(720, Math.hypot(this.vx, this.vy) + 520 * dt);
        const turn = Math.abs(diff) < 1.75 ? clamp(diff, -2.3 * dt, 2.3 * dt) : 0;
        const na = a + turn; this.vx = Math.cos(na) * sp; this.vy = Math.sin(na) * sp; this.grav = 0; this.s = 1;
      } else if (this.age >= 4.4) { this.grav = 1; this.s = 0; }
    }
    if (this.k === 'drill' && this.s === 1) return this.drillUpdate(g, dt);
    if (this.o.spiral) this.spiralStep(dt);
    const hit = flyStep(g, this, dt, this.grav, this.wind, this.r, this.age < 0.3 ? this.owner : null);
    this.a = Math.atan2(this.vy, this.vx);
    if (!hit) { if (this.age > 16) this.boom(g); return; }
    if (hit.type === 'water') { if (this.k === 'nukem') { this.y = g.waterY; this.boom(g); return; } g.splash(this.x, 1); this.dead = true; return; }
    if (hit.type === 'out') { this.dead = true; return; }
    if (this.k === 'mortar' && hit.type === 'terrain' && (this.bn | 0) < 4 && mortarBounce(g, this)) { this.bn = (this.bn | 0) + 1; g.emit({ t: 'bounce', x: R1(this.x), y: R1(this.y) }); return; }
    if (this.k === 'drill' && hit.type === 'terrain') {
      const sp = Math.hypot(this.vx, this.vy) || 1; this.dx = this.vx / sp; this.dy = this.vy / sp; this.s = 1; this.drillT = 1.25; this.acc = 0;
      g.emit({ t: 'dig', x: R1(this.x), y: R1(this.y) }); return;
    }
    this.boom(g);
  }
  // РПГ: ракету закручивает по спирали, а примерно через секунду она теряет управление
  spiralStep(dt) {
    const sp = Math.hypot(this.vx, this.vy) || 1;
    if (this.base === undefined) { this.base = Math.atan2(this.vy, this.vx); this.drift = 0; this.ph = rand(0, TAU); }
    if (this.age > 0.85) { this.drift = clamp(this.drift + rand(-14, 14) * dt, -3.2, 3.2); this.base += this.drift * dt; this.grav = 0.45; }
    const amp = 0.035 + Math.min(this.age, 1.4) * 0.09;
    const a = this.base + amp * Math.sin(this.age * 19 + this.ph);
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
  }
  drillUpdate(g, dt) {
    this.age += 0; const step = 250 * dt; this.x += this.dx * step; this.y += this.dy * step; this.drillT -= dt; this.acc += step;
    if (this.acc >= 6) { this.acc = 0; g.carve(this.x, this.y, 10, false); }
    const s = g.soldierAt(this.x, this.y, 5, null); if (s) { this.boom(g); return; }
    if (this.drillT <= 0 || this.y > g.waterY || this.x < -50 || this.x > g.W + 50) this.boom(g);
  }
  boom(g) {
    if (this.dead) return; this.dead = true;
    if (this.k === 'nukem') { g.nuke(this.x, this.y, this.owner); return; }
    const B = BLAST[this.k];
    g.explode(this.x, this.y, B.R, B.D, { owner: this.owner, knock: B.K, k: (this.k === 'frag' || this.k === 'bomblet' || this.k === 'mini') ? 1 : 0 });
  }
}

/* ---------- бросаемое: гранаты, липучка, коктейль, динамит ---------- */
class Thrown extends Ent {
  constructor(g, k, x, y, vx, vy, owner, fuse) {
    super(g, k, x, y, vx, vy); this.owner = owner; this.team = owner ? owner.team : -1; this.f = fuse; this.r = k === 'dynamite' ? 4 : 3.5;
    this.spin = 0; this.spinLeft = 1; this.dir = vx >= 0 ? 1 : -1;
  }
  update(g, dt) {
    this.age += dt;
    if (this.stuckTo) {
      const s = this.stuckTo;
      if (s.gone) this.stuckTo = null; else { this.x = s.x + this.sx; this.y = s.y + this.sy; }
    } else if (!this.stuck) {
      const res = bounceStep(g, this, dt, { rest: this.k === 'dynamite' ? 0.22 : 0.46, fric: 0.78, r: this.r, onImpact: (imp, nrm) => this.onImpact(g, imp, nrm) });
      if (this.dead) return;
      if (res === 'water') { g.splash(this.x, 0); this.dead = true; return; }
      if (res === 'out') { this.dead = true; return; }
      if ((this.k === 'sticky' || this.k === 'molotov') && !this.stuck) {
        const s = g.soldierAt(this.x, this.y, 4, this.age < 0.25 ? this.owner : null);
        if (s) {
          if (this.k === 'molotov') { this.shatter(g); return; }
          this.stuckTo = s; this.sx = this.x - s.x; this.sy = this.y - s.y; this.stuck = true; g.emit({ t: 'bounce', x: R1(this.x), y: R1(this.y) });
        }
      }
      if (!this.rest) this.a += (this.spinV !== undefined ? clamp(this.spinV, -25, 25) : this.vx * 0.06) * dt;
    }
    if (this.k !== 'molotov') { this.f -= dt; if (this.f <= 0) this.boom(g); }
    else if (this.age > 8) this.dead = true;
  }
  onImpact(g, imp, nrm) {
    if (this.k === 'molotov') { this.shatter(g); return 'stop'; }
    if (this.k === 'sticky' && !this.stuck) { this.stuck = true; this.vx = this.vy = 0; this.rest = true; g.emit({ t: 'bounce', x: R1(this.x), y: R1(this.y) }); return 'stop'; }
    if (imp > 70) g.emit({ t: 'bounce', x: R1(this.x), y: R1(this.y) });
    applySpin(this, imp, nrm);
    return null;
  }
  push(vx, vy) { if (this.stuck) return; super.push(vx, vy); }
  shatter(g) {
    if (this.dead) return; this.dead = true;
    g.emit({ t: 'boom', x: R1(this.x), y: R1(this.y), r: 16, k: 4 });
    for (let i = 0; i < 16; i++) g.spawn(new Fire(g, this.x + rand(-4, 4), this.y - 4, rand(-170, 170), rand(-260, -60), this.owner, rand(3.5, 6)));
  }
  boom(g) {
    if (this.dead) return; this.dead = true;
    if (this.k === 'bholeg') { g.spawn(new BlackHole(g, this.x, this.y - 14, this.owner)); return; }
    const B = BLAST[this.k];
    g.explode(this.x, this.y, B.R, B.D, { owner: this.owner, knock: B.K, k: this.k === 'dynamite' ? 6 : 0 });
    if (this.k === 'cluster') for (let i = 0; i < 5; i++) g.spawn(new Proj(g, 'bomblet', this.x, this.y - 5, rand(-210, 210), rand(-460, -280), this.owner, { r: 2 }));
  }
}

/* ---------- мина ---------- */
class Mine extends Ent {
  constructor(g, x, y, vx, vy, owner, armed = false) {
    super(g, 'mine', x, y, vx, vy); this.owner = owner; this.team = owner ? owner.team : -1; this.s = armed ? 1 : 0; this.f = armed ? 0 : 2; this.r = 3;
  }
  update(g, dt) {
    this.age += dt;
    const res = bounceStep(g, this, dt, { rest: 0.3, fric: 0.65, r: 3 });
    if (res === 'water') { g.splash(this.x, 0); this.dead = true; return; }
    if (res === 'out') { this.dead = true; return; }
    if (this.s === 0) { this.f -= dt; if (this.f <= 0) { this.s = 1; this.f = 0; } }
    else if (this.s === 1) {
      for (const s of g.soldiers) if (s.alive && Math.abs(s.x - this.x) < 30 && Math.abs(s.y - 12 - this.y) < 24) { this.trigger(g); break; }
    } else {
      const before = Math.floor(this.f * 5); this.f -= dt;
      if (Math.floor(this.f * 5) !== before) g.emit({ t: 'beep', x: R1(this.x), y: R1(this.y) });
      if (this.f <= 0) this.boom(g);
    }
    this.busy = this.s !== 1 || !this.rest;
  }
  trigger(g, fast) { if (this.s === 2) return; this.s = 2; this.f = fast ? 0.25 : 1.2; g.emit({ t: 'beep', x: R1(this.x), y: R1(this.y) }); }
  boom(g) { if (this.dead) return; this.dead = true; const B = BLAST.mine; g.explode(this.x, this.y, B.R, B.D, { owner: this.owner, knock: B.K }); }
}

/* ---------- робо-бомба ---------- */
class Robot extends Ent {
  constructor(g, x, y, dir, owner) {
    super(g, 'robot', x, y); this.dir = dir; this.owner = owner; this.team = owner.team; this.f = 9; this.walkAcc = 0; this.air = true; this.jumps = 0; this.a = dir;
  }
  free(T, x, y) { return !T.isSolid(x - 4, y - 3) && !T.isSolid(x + 4, y - 3) && !T.isSolid(x, y - 9) && !T.isSolid(x, y - 15); }
  ground(T, x, y) { return T.isSolid(x - 3, y) || T.isSolid(x, y) || T.isSolid(x + 3, y); }
  update(g, dt) {
    const T = g.terrain; this.age += dt; this.f -= dt;
    if (this.air) {
      this.vy += g.gravity * dt;
      const n = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vy) * dt / 2));
      for (let i = 0; i < n; i++) {
        const nx = this.x + this.vx * dt / n, ny = this.y + this.vy * dt / n;
        if (this.free(T, nx, ny)) { this.x = nx; this.y = ny; if (this.vy > 0 && this.ground(T, this.x, this.y)) { this.air = false; this.vx = this.vy = 0; break; } }
        else if (this.free(T, this.x, ny)) { this.y = ny; this.vx = -this.vx * 0.3; }
        else { if (this.vy > 0) { this.air = false; this.vx = this.vy = 0; } else this.vy = 0; break; }
      }
      if (this.y > g.waterY) { g.splash(this.x, 0); this.dead = true; return; }
    } else {
      if (!this.ground(T, this.x, this.y)) { this.air = true; this.vx = this.dir * 40; this.vy = 0; }
      else {
        this.walkAcc += 85 * dt;
        while (this.walkAcc >= 1) {
          this.walkAcc -= 1; const nx = this.x + this.dir; let moved = false;
          for (let up = 0; up <= 5; up++) if (this.free(T, nx, this.y - up)) { this.x = nx; this.y -= up; moved = true; break; }
          if (moved) {
            let k = 0; while (k < 6 && !this.ground(T, this.x, this.y) && this.free(T, this.x, this.y + 1)) { this.y++; k++; }
            if (!this.ground(T, this.x, this.y)) { this.air = true; this.vx = this.dir * 60; this.vy = 0; break; }
          } else {
            this.air = true; this.vx = this.dir * 110; this.vy = -310; this.jumps++; this.y -= 1;
            if (this.jumps > 3) { this.dir = -this.dir; this.jumps = 0; }
            g.emit({ t: 'jump', x: R1(this.x), y: R1(this.y) }); break;
          }
        }
      }
    }
    this.a = this.dir; this.s = this.air ? 1 : 0;
    const s = g.soldierAt(this.x, this.y - 7, 7, this.owner);
    if (s && this.age > 0.4) { this.boom(g); return; }
    if (this.f <= 0) this.boom(g);
  }
  push(vx, vy) { this.vx += vx; this.vy += vy; this.air = true; }
  boom(g) { if (this.dead) return; this.dead = true; const B = BLAST.robot; g.explode(this.x, this.y - 6, B.R, B.D, { owner: this.owner, knock: B.K }); }
}

/* ---------- чёрная дыра ---------- */
class BlackHole extends Ent {
  constructor(g, x, y, owner) {
    super(g, 'bhole', x, y); this.owner = owner; this.team = owner ? owner.team : -1; this.f = 2.8; this.carveT = 0; this.dmgT = 0; this.pushable = false;
    g.emit({ t: 'bh', x: R1(x), y: R1(y) });
  }
  update(g, dt) {
    this.age += dt; this.f -= dt; this.y -= dt * 5; this.v = Math.round(this.age / 2.8 * 100);
    const R = 250;
    for (const s of g.soldiers) {
      if (s.gone) continue; const dx = this.x - s.x, dy = this.y - (s.y - 13); const d = Math.hypot(dx, dy);
      if (d < R && d > 2) { const f = 1300 * (1 - d / R); s.vx += dx / d * f * dt; s.vy += dy / d * f * dt - g.gravity * dt * 0.55; if (s.st !== 'fly' && s.st !== 'dead') s.fly(); }
    }
    for (const e of g.entities) {
      if (e === this || e.dead || !e.pushable || e.k === 'tomb') continue; const dx = this.x - e.x, dy = this.y - e.y; const d = Math.hypot(dx, dy);
      if (d < R && d > 2) { const f = 900 * (1 - d / R); e.push(dx / d * f * dt, dy / d * f * dt - g.gravity * dt * 0.8); }
    }
    this.carveT -= dt; if (this.carveT <= 0) { this.carveT = 0.18; g.carve(this.x, this.y, 10 + 36 * (this.age / 2.8), false); }
    this.dmgT -= dt; if (this.dmgT <= 0) { this.dmgT = 0.2; for (const s of g.soldiers) if (s.alive && Math.hypot(this.x - s.x, this.y - s.y + 13) < 36) g.damage(s, 4, this.owner); }
    if (this.f <= 0) { this.dead = true; g.explode(this.x, this.y, 60, 30, { owner: this.owner, knock: 540, k: 3 }); }
  }
}

/* ---------- огонь ---------- */
class Fire extends Ent {
  constructor(g, x, y, vx, vy, owner, life) {
    super(g, 'fire', x, y, vx, vy); this.owner = owner; this.team = owner ? owner.team : -1; this.f = life; this.hit = new Map(); this.burnT = rand(0.3, 0.9); this.v = Math.round(rand(70, 120));
  }
  update(g, dt) {
    this.age += dt; this.f -= dt;
    if (this.f <= 0) { this.dead = true; return; }
    const res = bounceStep(g, this, dt, { rest: 0.08, fric: 0.45, r: 2 });
    if (res === 'water' || res === 'out') { this.dead = true; return; }
    for (const s of g.soldiers) {
      if (!s.alive || Math.abs(s.x - this.x) > 9 || this.y < s.y - 30 || this.y > s.y + 4) continue;
      const last = this.hit.get(s.id);
      if (last === undefined || this.age - last > 0.5) { this.hit.set(s.id, this.age); g.damage(s, 3, this.owner); }
    }
    this.burnT -= dt; if (this.burnT <= 0) { this.burnT = rand(0.8, 1.4); if (Math.random() < 0.45) g.carve(this.x, this.y + 2, 4, true); }
    this.busy = this.age < 3.2;
  }
}
class Flame extends Ent {
  constructor(g, x, y, vx, vy, owner) { super(g, 'flame', x, y, vx, vy); this.owner = owner; this.team = owner ? owner.team : -1; this.f = 0.55; this.hit = new Set(); this.pushable = false; }
  update(g, dt) {
    this.age += dt; this.f -= dt; if (this.f <= 0) { this.dead = true; return; }
    this.vx *= 1 - 1.4 * dt; this.vy = this.vy * (1 - 1.4 * dt) - 150 * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.a = Math.atan2(this.vy, this.vx);
    if (g.terrain.isSolid(this.x, this.y)) {
      if (Math.random() < 0.3) g.carve(this.x, this.y, 3, true);
      if (Math.random() < 0.12) g.spawn(new Fire(g, this.x, this.y - 4, 0, 0, this.owner, rand(2, 3.5)));
      this.dead = true; return;
    }
    for (const s of g.soldiers) {
      if (!s.alive || s === this.owner || this.hit.has(s.id)) continue;
      if (Math.abs(s.x - this.x) < 8 && this.y > s.y - 29 && this.y < s.y + 2) { this.hit.add(s.id); g.damage(s, 2, this.owner); s.vx += this.vx * 0.04; }
    }
    if (this.y > g.waterY) this.dead = true;
  }
}

/* ---------- ящик с припасами ---------- */
class Crate extends Ent {
  constructor(g, x, kind, wid) { super(g, 'crate', x, -60); this.s = kind === 'health' ? 0 : 1; this.wid = wid; this.chute = true; this.v = 1; this.r = 9; }
  update(g, dt) {
    this.age += dt;
    if (this.chute) {
      this.vy = Math.min(this.vy + g.gravity * dt, 80); this.vx = g.turn.wind * 0.12;
      this.x += this.vx * dt; this.y += this.vy * dt;
      if (g.terrain.isSolid(this.x, this.y + 10) || g.terrain.isSolid(this.x - 6, this.y + 10) || g.terrain.isSolid(this.x + 6, this.y + 10)) { this.chute = false; this.v = 0; this.vy = 0; }
      if (this.y > g.waterY) { g.splash(this.x, 0); this.dead = true; return; }
    } else {
      const res = bounceStep(g, this, dt, { rest: 0.2, fric: 0.6, r: 9 });
      if (res === 'water' || res === 'out') { if (res === 'water') g.splash(this.x, 0); this.dead = true; return; }
    }
    for (const s of g.soldiers) if (s.alive && Math.abs(s.x - this.x) < 16 && Math.abs(s.y - 12 - this.y) < 22) { this.pick(g, s); return; }
    this.busy = this.chute || !this.rest;
  }
  push(vx, vy) { this.chute = false; this.v = 0; super.push(vx, vy); }
  pick(g, s) {
    this.dead = true;
    if (this.s === 0) { g.heal(s, 30); g.emit({ t: 'pickup', x: R1(this.x), y: R1(this.y), txt: '+30 ❤' }); }
    else {
      const t = g.teams[s.team];
      if (t.ammo[this.wid] === undefined) t.ammo[this.wid] = 1; else if (t.ammo[this.wid] >= 0) t.ammo[this.wid]++;
      g.teamsDirty = true; g.emit({ t: 'pickup', x: R1(this.x), y: R1(this.y), txt: '+ ' + WEAPON[this.wid].name });
    }
  }
}
class Tomb extends Ent {
  constructor(g, x, y, team) { super(g, 'tomb', x, y - 9); this.team = team; this.r = 8; this.busy = true; }
  update(g, dt) {
    const res = bounceStep(g, this, dt, { rest: 0.15, fric: 0.5, r: 8 });
    if (res === 'water' || res === 'out') { this.dead = true; return; }
    this.busy = !this.rest;
  }
}

/* ---------- самолёт авиаудара ----------
   Клик задаёт только курс и район. Бомбы сбрасывает сам игрок (ЛКМ/Enter),
   пока самолёт летит: нужно взять упреждение с учётом скорости и ветра. */
function groundTop(g, x) { return Math.min(g.waterY, g.terrain.findTop(clamp(Math.round(x), 0, g.W - 1), 0)); }
class Jet extends Ent {
  constructor(g, tx, dir, owner) {
    super(g, 'jet', tx - dir * 1650, 0); this.dir = dir; this.vx = dir * rand(700, 820); this.a = dir > 0 ? 0 : Math.PI;
    this.owner = owner; this.team = owner.team; this.pushable = false; this.tx = tx; this.dropped = false;
    let top = groundTop(g, tx);
    for (let x = tx - 1700; x <= tx + 1700; x += 40) top = Math.min(top, groundTop(g, x));
    this.gy = groundTop(g, tx);
    this.y = Math.max(-420, Math.min(this.gy - 430, top - 150)) + rand(-25, 25);
    this.v = Math.round(this.gy);
    g.emit({ t: 'plane' });
  }
  release(g) {
    if (this.dropped) return; this.dropped = true; this.s = 1;
    for (let i = 0; i < 5; i++) {
      const off = (i - 2) * 24 * this.dir + rand(-7, 7);
      g.spawn(new Proj(g, 'bomb', this.x - off, this.y + 14 + rand(-3, 3), this.vx * rand(0.34, 0.44), rand(25, 70), this.owner, { wind: 0.45, r: 3 }));
    }
    g.emit({ t: 'bombs', x: R1(this.x), y: R1(this.y) });
  }
  update(g, dt) {
    this.age += dt; this.x += this.vx * dt;
    if (!this.dropped && (this.dir > 0 ? this.x > this.tx + 900 : this.x < this.tx - 900)) this.release(g);
    if (this.dropped && (this.age > 9 || this.x < -1800 || this.x > g.W + 1800)) this.dead = true;
    this.busy = !this.dropped;
  }
}
/* ---------- грозовая туча молнии ----------
   Туча появляется над точкой, дрейфует по ветру и бьёт в самую высокую точку
   под собой — туда, где цель выше и заметнее. */
class Storm extends Ent {
  constructor(g, tx, owner) {
    super(g, 'storm', tx, groundTop(g, tx) - 390); this.owner = owner; this.team = owner.team; this.pushable = false;
    this.f = 1.7; this.vx = g.turn.wind * 0.6 + rand(-30, 30);
    g.emit({ t: 'storm', x: R1(this.x), y: R1(this.y) });
  }
  update(g, dt) {
    this.age += dt; this.f -= dt; this.x += this.vx * dt;
    if (this.f <= 0) { this.dead = true; lightningStrike(g, this.x + gaussRand() * 16, this.owner); }
  }
}
function lightningStrike(g, cx, owner) {
  // выбираем самую высокую точку (голову бойца или рельеф) в пределах 44 px
  let best = null;
  for (let dx = -44; dx <= 44; dx += 4) {
    const x = clamp(Math.round(cx + dx), 0, g.W - 1); let y = -300, who = null;
    for (; y < g.waterY; y += 3) { if (g.terrain.isSolid(x, y)) break; const o = g.soldierAt(x, y, 4, null); if (o) { who = o; break; } }
    const score = y + Math.abs(dx) * 0.9 + (who ? -14 : 0);
    if (!best || score < best.score) best = { x, y, score };
  }
  const tx = best.x, y = best.y;
  g.emit({ t: 'bolt', pts: boltPath(tx + rand(-50, 50), y - 420, tx, y, 0.35) });
  g.carve(tx, y, 16, true); g.emit({ t: 'boom', x: tx, y, r: 18, k: 5 });
  const hit = new Set();
  for (const o of g.soldiers) if (o.alive && Math.hypot(o.x - tx, o.y - 13 - y) < 30) { hit.add(o); o.vy -= 180; o.vx += (o.x < tx ? -1 : 1) * 80; o.fly(); g.damage(o, 38, owner); }
  const near = g.soldiers.filter(o => o.alive && !hit.has(o) && Math.hypot(o.x - tx, o.y - y) < 200).sort((a, b) => Math.hypot(a.x - tx, a.y - y) - Math.hypot(b.x - tx, b.y - y)).slice(0, 2);
  let px = tx, py = y;
  for (const o of near) { g.emit({ t: 'bolt', pts: boltPath(px, py, o.x, o.y - 14, 0.25) }); o.vy -= 120; o.fly(); g.damage(o, 20, owner); px = o.x; py = o.y - 14; }
}

/* ---------- орбитальный лазер ---------- */
class Orbital extends Ent {
  constructor(g, tx, owner) {
    super(g, 'orbital', tx, 0); this.owner = owner; this.team = owner.team; this.s = 0; this.f = 1.0; this.pushable = false;
    this.v = Math.min(g.waterY, g.terrain.findTop(clamp(Math.round(tx), 0, g.W - 1), 0)); this.y = this.v; this.dmgT = 0; this.cutY = this.v;
  }
  update(g, dt) {
    this.age += dt; this.f -= dt;
    // спутник наводится с ошибкой; A/D ведут луч, но медленно — нужно успеть довести
    const c = g.turn.phase === 'use' && g.turn.weapon === 'orbital' ? g.ctrl : null;
    const steer = c ? (c.r ? 1 : 0) - (c.l ? 1 : 0) : 0;
    const nx = clamp(this.x + steer * 64 * dt + Math.sin(this.age * 6.3) * 9 * dt, 0, g.W - 1);
    if (Math.abs(nx - this.x) > 0.01) {
      this.x = nx;
      if (this.s === 0) this.v = groundTop(g, this.x);
      else { let k = 0; while (this.v > 0 && k < 40 && !g.terrain.isSolid(this.x, this.v - 1) && this.v > groundTop(g, this.x)) { this.v -= 1; k++; } }
    }
    if (this.s === 0) { if (this.f <= 0) { this.s = 1; this.f = 1.6; this.cutY = this.v; g.emit({ t: 'laser', x: R1(this.x), y: R1(this.v) }); } return; }
    const px = this.px ?? this.x; this.px = this.x;
    if (Math.abs(px - this.x) > 3) { g.carveLine(px, this.v - 30, this.x, this.v, 16); this.cutY = this.v; }
    this.v = Math.min(g.waterY + 10, this.v + 330 * dt); this.y = this.v;
    if (this.v - this.cutY >= 14 || this.f <= 0) { g.carveLine(this.x, this.cutY - 20, this.x, this.v, 16); this.cutY = this.v; }
    this.dmgT -= dt;
    if (this.dmgT <= 0) {
      this.dmgT = 0.1;
      for (const s of g.soldiers) {
        if (s.gone || Math.abs(s.x - this.x) > 24 || s.y - 30 > this.v) continue;
        if (s.alive) g.damage(s, 5, this.owner);
        s.vx += (s.x < this.x ? -1 : 1) * 60; s.vy -= 40; s.fly();
      }
    }
    if (this.f <= 0) { this.dead = true; g.explode(this.x, this.v, 28, 20, { owner: this.owner, knock: 260 }); }
  }
}

/* ---------- логика выстрелов (хост) ---------- */
/** подкрутка: при ударе добавляет скорость вдоль поверхности — вперёд (по ходу броска, на стене — вверх) или назад */
function applySpin(e, imp, nrm) {
  if (!e.spin || !nrm || imp < 25 || e.spinLeft < 0.1) return;
  let tx = -nrm.y, ty = nrm.x;
  if (Math.abs(tx) > 0.3 ? tx * e.dir < 0 : ty > 0) { tx = -tx; ty = -ty; }
  const k = e.spin * 165 * e.spinLeft; e.vx += tx * k; e.vy += ty * k; e.spinLeft *= 0.55;
}
function throwObj(g, s, p, k, fuse, speed) {
  const m = muzzle(s, p.aim, 10); const sp = speed * p.pw;
  const e = new Thrown(g, k, m.x, m.y, Math.cos(p.aim) * sp + s.vx * 0.3, Math.sin(p.aim) * sp, s, fuse);
  if (SPIN_WEAPONS.has(k)) e.spin = p.spin | 0;
  g.spawn(e);
  g.emit({ t: 'launch', x: R1(m.x), y: R1(m.y), w: 'throw' });
}
function shootProj(g, s, p, k, speed, o) {
  const m = muzzle(s, p.aim, 15); const sp = speed * p.pw;
  const e = new Proj(g, k, m.x, m.y, Math.cos(p.aim) * sp, Math.sin(p.aim) * sp, s, o); g.spawn(e);
  g.emit({ t: o && o.sound === 'autocannon' ? 'shot' : 'launch', x: R1(m.x), y: R1(m.y), a: Math.round(p.aim * 100) / 100, w: o && o.sound || k });
  return e;
}
KIND_IDX.bullet = KINDS.length; KINDS.push('bullet');
class BallisticBullet extends Ent {
  constructor(g,s,aim,range,damage,knock,crater,kind,head) {
    const m=muzzle(s,aim,10), speed=kind===1?18000:12500;
    super(g,'bullet',m.x,m.y,Math.cos(aim)*speed,Math.sin(aim)*speed);
    this.owner=s;this.team=s.team;this.range=range;this.damage=damage;this.knock=knock;this.crater=crater;this.kind=kind;this.head=head;this.travel=0;this.a=aim;this.pushable=false;
  }
  update(g,dt) {
    this.age+=dt;const x0=this.x,y0=this.y;
    this.vy+=g.gravity*dt;
    const drag=1/(1+.000014*Math.hypot(this.vx,this.vy)*dt);this.vx*=drag;this.vy*=drag;
    this.vx+=g.turn.wind*.008*dt;
    let distance=Math.min(Math.hypot(this.vx,this.vy)*dt,this.range-this.travel);
    const a=Math.atan2(this.vy,this.vx);
    const wall=g.terrain.segmentHit(this.x,this.y,this.x+Math.cos(a)*distance,this.y+Math.sin(a)*distance);
    if(wall)distance*=wall.t;
    const steps=Math.max(1,Math.ceil(distance/2)),dx=Math.cos(a)*distance/steps,dy=Math.sin(a)*distance/steps;
    for(let i=0;i<steps;i++) {
      this.x+=dx;this.y+=dy;this.travel+=distance/steps;
      if(g.terrain.isSolid(this.x,this.y)) {
        const mat=g.terrain.materialAt(this.x,this.y);
        g.carve(this.x,this.y,this.crater*(mat===6?.35:mat===5?.6:1),true);
        g.emit({t:'impact',x:R1(this.x),y:R1(this.y),material:mat});this.dead=true;break;
      }
      const target=g.soldierAt(this.x,this.y,0,this.owner);
      if(target) {
        const head=this.kind===1 && this.y<target.y-21;
        const energy=Math.max(.62,1-this.travel/this.range*.25);
        g.damage(target,(head?(this.head??this.damage+20):this.damage)*energy,this.owner);
        target.vx+=Math.cos(a)*this.knock*.45;target.vy+=Math.sin(a)*this.knock*.45-this.knock*.08;
        if(this.knock>100)target.fly();
        if(head)g.emit({t:'msg',txt:'ХЕДШОТ!',c:'#dfed79'});
        this.dead=true;break;
      }
      if(this.y>g.waterY){g.splash(this.x,0);this.dead=true;break;}
      if(this.x<-300||this.x>g.W+300||this.y<-1500){this.dead=true;break;}
    }
    if(wall&&!this.dead){
      this.x=wall.x;this.y=wall.y;
      g.carve(this.x,this.y,this.crater*(wall.material===6?.35:wall.material===5?.6:1),true);
      g.emit({t:'impact',x:R1(this.x),y:R1(this.y),material:wall.material});this.dead=true;
    }
    g.emit({t:'trace',x1:R1(x0),y1:R1(y0),x2:R1(this.x),y2:R1(this.y),k:this.kind});
    if(this.travel>=this.range-.01||this.age>1)this.dead=true;
    this.a=a;
  }
}
function bullet(g,s,aim,range,damage,knock,crater,kind,head) {
  const projectile=new BallisticBullet(g,s,aim,range,damage,knock,crater,kind,head);g.spawn(projectile);return projectile;
}
function boltPath(x1, y1, x2, y2, rough) {
  let pts = [[x1, y1], [x2, y2]];
  for (let it = 0; it < 5; it++) {
    const np = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      np.push([(a[0] + b[0]) / 2 + rand(-1, 1) * len * rough, (a[1] + b[1]) / 2 + rand(-0.4, 0.4) * len * rough * 0.5], b);
    }
    pts = np;
  }
  return pts.map(p => [Math.round(p[0]), Math.round(p[1])]);
}
const FIRE = {
  bazooka(g, s, p) { shootProj(g, s, p, 'rocket', 1050, { wind: 1, r: 3 }); },
  homing(g, s, p) {
    const t = g.turn.target; if (!t) return false;
    // захват цели с ошибкой: чем дальше цель, тем больше промах головки
    const err = 14 + Math.hypot(t.x - s.x, t.y - s.y) * 0.02;
    shootProj(g, s, p, 'homing', 820, { wind: 0.3, r: 3, tx: t.x + gaussRand() * err, ty: t.y + gaussRand() * err });
  },
  mortar(g, s, p) { shootProj(g, s, p, 'mortar', 960, { wind: 1, r: 3 }); },
  drill(g, s, p) { shootProj(g, s, p, 'drill', 900, { wind: 0, r: 3 }); },
  salvo(g, s, p) {
    let n = 0, t = 0;
    return { usage: { update(gg, dt) { t += dt; while (n < 5 && t >= n * 0.13) { const pp = { aim: p.aim + rand(-0.05, 0.05), pw: p.pw * rand(0.95, 1.03) }; shootProj(gg, s, pp, 'mini', 900, { wind: 0.7, r: 2 }); n++; } return n >= 5 && t > 0.7; } } };
  },
  grenade(g, s, p) { throwObj(g, s, p, 'grenade', 3, 780); },
  cluster(g, s, p) { throwObj(g, s, p, 'cluster', 3, 780); },
  sticky(g, s, p) { throwObj(g, s, p, 'sticky', 2.5, 820); },
  molotov(g, s, p) { throwObj(g, s, p, 'molotov', 99, 760); },
  blackhole(g, s, p) { throwObj(g, s, p, 'bholeg', 1.8, 700); },
  shotgun(g, s, p) {
    const m = muzzle(s, p.aim, 16); g.emit({ t: 'shot', x: R1(m.x), y: R1(m.y), a: Math.round(p.aim * 100) / 100, w: 'shotgun' });
    for (let i = 0; i < 7; i++) bullet(g, s, p.aim + (i - 3) * 0.022 + rand(-0.01, 0.01), 650, 6, 70, 5, 0);
  },
  sniper(g, s, p) {
    const m = muzzle(s, p.aim, 16); g.emit({ t: 'shot', x: R1(m.x), y: R1(m.y), a: Math.round(p.aim * 100) / 100, w: 'sniper' });
    bullet(g, s, p.aim, 2600, 45, 170, 6, 1, 60);
  },
  minigun(g, s, p) {
    let n = 0, t = 0;
    return { usage: { update(gg, dt) {
      t += dt;
      while (n < 20 && t >= n * 0.06) {
        const a = s.aim + rand(-0.045, 0.045); const m = muzzle(s, a, 16);
        gg.emit({ t: 'shot', x: R1(m.x), y: R1(m.y), a: Math.round(a * 100) / 100, w: 'minigun' });
        bullet(gg, s, a, 900, 3, 45, 4, 0); n++;
      }
      return n >= 20 && t > 1.3 || !s.alive;
    } } };
  },
  flamer(g, s, p) {
    let t = 0, acc = 0;
    return { usage: { update(gg, dt) {
      t += dt; acc += dt;
      while (acc >= 0.035) {
        acc -= 0.035; const a = s.aim + rand(-0.08, 0.08); const m = muzzle(s, a, 17); const sp = rand(380, 470);
        gg.spawn(new Flame(gg, m.x, m.y, Math.cos(a) * sp + s.vx * 0.5, Math.sin(a) * sp, s));
      }
      if (Math.random() < dt * 6) gg.emit({ t: 'flame', x: R1(s.x), y: R1(s.y) });
      return t > 1.5 || !s.alive;
    } } };
  },
  railgun(g, s, p) {
    let t = 0; g.emit({ t: 'charge', x: R1(s.x), y: R1(s.y - GUN_Y) });
    return { usage: { update(gg, dt) {
      t += dt; if (t < 0.45) return false;
      const a = s.aim; const m = muzzle(s, a, 18); const dx = Math.cos(a), dy = Math.sin(a); const L = 2800;
      const T = gg.terrain; let segStart = -1; let endD = L;
      for (let d = 0; d <= L; d += 3) {
        const x = m.x + dx * d, y = m.y + dy * d;
        if (y > gg.waterY + 60 || x < -200 || x > gg.W + 200 || y < -800) { endD = d; break; }
        const solid = T.isSolid(x, y);
        if (solid && segStart < 0) segStart = d;
        if (!solid && segStart >= 0) { gg.carveLine(m.x + dx * segStart, m.y + dy * segStart, x, y, 9); segStart = -1; }
      }
      if (segStart >= 0) gg.carveLine(m.x + dx * segStart, m.y + dy * segStart, m.x + dx * endD, m.y + dy * endD, 9);
      const x2 = m.x + dx * endD, y2 = m.y + dy * endD;
      gg.emit({ t: 'trace', x1: R1(m.x), y1: R1(m.y), x2: R1(x2), y2: R1(y2), k: 2 });
      gg.emit({ t: 'shot', x: R1(m.x), y: R1(m.y), a: Math.round(a * 100) / 100, w: 'railgun' });
      for (const o of gg.soldiers) {
        if (!o.alive || o === s) continue;
        const d2 = Math.min(pointSegDist2(o.x, o.y - 8, m.x, m.y, x2, y2), pointSegDist2(o.x, o.y - 22, m.x, m.y, x2, y2));
        if (d2 < 11 * 11) { o.vx += dx * 260; o.vy += dy * 260 - 90; o.fly(); gg.damage(o, 45, s); }
      }
      return true;
    } } };
  },
  dynamite(g, s, p) { const e = new Thrown(g, 'dynamite', s.x + s.face * 7, s.y - 7, s.face * 60, -90, s, 4); g.spawn(e); g.emit({ t: 'fuse', x: R1(e.x), y: R1(e.y) }); },
  mine(g, s, p) { g.spawn(new Mine(g, s.x + s.face * 9, s.y - 8, s.face * 90, -110, s)); g.emit({ t: 'launch', x: R1(s.x), y: R1(s.y - 10), w: 'throw' }); },
  robot(g, s, p) {
    const r = new Robot(g, s.x + s.face * 12, s.y - 2, s.face, s); g.spawn(r);
    return { usage: { update() { return r.dead; }, fire(gg) { r.boom(gg); } } };
  },
  bat(g, s, p) {
    const cx = s.x + s.face * 12, cy = s.y - 14; let hitAny = false;
    let a = p.aim; if (Math.sin(a) > -0.25) a = Math.atan2(-0.35, Math.cos(a) >= 0 ? 1 : -1);
    for (const o of g.soldiers) {
      if (!o.alive || o === s) continue;
      if (Math.abs(o.x - cx) < 18 && Math.abs(o.y - 14 - cy) < 20) { o.vx += Math.cos(a) * 720; o.vy += Math.sin(a) * 720; o.fly(); g.damage(o, 30, s); hitAny = true; }
    }
    g.emit({ t: 'bat', x: R1(cx), y: R1(cy), h: hitAny ? 1 : 0 });
  },
  airstrike(g, s, p) {
    if (!isNum(p.tx)) return false;
    const jet = new Jet(g, clamp(p.tx, 60, g.W - 60), p.tx >= s.x ? 1 : -1, s); g.spawn(jet);
    return { usage: { update() { return jet.dropped || jet.dead; }, fire(gg) { jet.release(gg); } } };
  },
  lightning(g, s, p) {
    if (!isNum(p.tx)) return false;
    g.spawn(new Storm(g, clamp(p.tx + gaussRand() * 26, 20, g.W - 20), s));
  },
  orbital(g, s, p) {
    if (!isNum(p.tx)) return false;
    const e = new Orbital(g, clamp(Math.round(p.tx + gaussRand() * 36), 0, g.W - 1), s); g.spawn(e);
    return { usage: { update() { return e.dead; } } };
  },
  nuke(g, s, p) {
    if (!isNum(p.tx)) return false;
    const e = new Proj(g, 'nukem', clamp(p.tx + gaussRand() * 62, 0, g.W), -600, rand(-20, 20), 280, s, { r: 5, wind: 0.32 }); g.spawn(e); g.emit({ t: 'siren' });
  },
  teleport(g, s, p) {
    if (!isNum(p.tx) || !isNum(p.ty)) return false;
    const tx = Math.round(p.tx), ty = Math.round(p.ty);
    if (tx < 10 || tx > g.W - 10 || ty > g.waterY - 10 || ty < -200) { g.emit({ t: 'msg', txt: 'Туда нельзя!', c: '#ff6b6b', to: s.team }); return false; }
    let ok = -1; for (let dy = 0; dy <= 34; dy += 2) if (bodyFree(g.terrain, tx, ty - dy + 14)) { ok = ty - dy + 14; break; }
    if (ok < 0) { g.emit({ t: 'msg', txt: 'Туда нельзя!', c: '#ff6b6b', to: s.team }); return false; }
    g.emit({ t: 'tp', x1: R1(s.x), y1: R1(s.y), x2: tx, y2: ok });
    s.x = tx; s.y = ok; s.vx = 0; s.vy = 0; s.st = 'air'; s.rot = 0;
  },
  jetpack(g, s, p) {
    s.st = 'jet'; s.fuel = 3.6; s.vy = -80; s.y -= 2;
    return { usage: { update() { return !s.alive || s.st === 'stand' || s.st === 'walk'; }, fire() { if (s.st === 'jet') s.st = 'air'; } } };
  },
  girder(g, s, p) {
    if (!isNum(p.tx) || !isNum(p.ty)) return false;
    const tx = Math.round(p.tx), ty = Math.round(p.ty);
    if (Math.hypot(tx - s.x, ty - s.y + 14) > 300) { g.emit({ t: 'msg', txt: 'Слишком далеко', c: '#ff6b6b', to: s.team }); return false; }
    for (const o of g.soldiers) if (!o.gone && Math.abs(o.x - tx) < 58 && Math.abs(o.y - 13 - ty) < 30) {
      const ca = COS8[(g.turn.rot | 0) & 7], sa = SIN8[(g.turn.rot | 0) & 7]; const dx = o.x - tx, dy = o.y - 13 - ty;
      if (Math.abs(dx * ca + dy * sa) < 54 && Math.abs(-dx * sa + dy * ca) < 22) { g.emit({ t: 'msg', txt: 'Мешает боец', c: '#ff6b6b', to: s.team }); return false; }
    }
    g.terrain.addGirder(tx, ty, g.turn.rot | 0); g.emit({ t: 'girder', x: tx, y: ty, a: g.turn.rot | 0 });
  },
  medkit(g, s, p) { g.heal(s, 35); },
  skip(g, s, p) { },
};

/* ---------- симуляция для ИИ (без побочных эффектов) ---------- */
function simulateShot(g, kind, x, y, vx, vy, owner, fuse) {
  const e = { x, y, vx, vy, rest: false }; const dt = 1 / 60;
  if (kind === 'grenade' || kind === 'cluster') {
    let f = fuse;
    for (let t = 0; t < 6; t += dt) {
      const res = bounceStep(g, e, dt, { rest: 0.46, fric: 0.78, r: 3.5 });
      if (res === 'water' || res === 'out') return null;
      f -= dt; if (f <= 0) return { x: e.x, y: e.y };
    }
    return { x: e.x, y: e.y };
  }
  const wind = kind === 'rocket' || kind === 'mortar' ? 1 : 0; let bn = 0;
  for (let t = 0; t < 8; t += dt) {
    const hit = flyStep(g, e, dt, 1, wind, 3, t < 0.3 ? owner : null);
    if (kind === 'mortar' && hit && hit.type === 'terrain' && bn < 4 && mortarBounce(g, e)) { bn++; continue; }
    if (hit) return (hit.type === 'terrain' || hit.type === 'soldier') ? { x: e.x, y: e.y } : null;
  }
  return null;
}
