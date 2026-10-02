'use strict';
/* =========================================================
   Боец (симуляция на хосте): ходьба, прыжки, полёт, джетпак
   ========================================================= */
const WALK_SPEED = 88;
const MAX_CLIMB = 4;
const JUMP_VX = 155, JUMP_VY = 265;
const FALL_SAFE = 560;
const ST = ['stand', 'walk', 'air', 'fly', 'jet', 'dead', 'climb'];
const ST_IDX = Object.fromEntries(ST.map((s, i) => [s, i]));

function bodyFree(T, x, y) {
  for (let dy = 2; dy <= 26; dy += 4) {
    const yy = y - dy;
    if (T.isSolid(x - 4, yy) || T.isSolid(x, yy) || T.isSolid(x + 4, yy)) return false;
  }
  return true;
}
function onGround(T, x, y) { return T.isSolid(x - 3, y) || T.isSolid(x, y) || T.isSolid(x + 3, y); }
/** уступ до MANTLE px с ровным верхом боец преодолевает шагом (ступени, края мостов, плиты);
    крутой склон так не взять — впереди должна быть площадка */
const MANTLE = 22;
/** запас хода — радиус по горизонтали от точки начала хода: назад и по лестницам можно сколько угодно */
function walkOk(g, s, nx) { if (g.freeWalk) return true; const o = g.turn.ox, d = Math.abs(nx - o); return d <= WALK_BUDGET || d < Math.abs(s.x - o); }   // «на любую дистанцию» — без предела
function mantleFrom(T, x, y, dir) {
  for (let up = MAX_CLIMB + 1; up <= MANTLE; up++) {
    if (!bodyFree(T, x, y - up)) return null;
    for (let k = 2; k <= 9; k++) {
      const nx = x + dir * k, ny = y - up;
      if (!bodyFree(T, nx, ny) || !onGround(T, nx, ny)) continue;
      const ax = nx + dir * 6;
      if (T.isSolid(ax, ny + 2) && !T.isSolid(ax, ny - 4) && bodyFree(T, ax, ny - 1)) return { x: nx, y: ny, m: 1 };
    }
  }
  return null;
}
/** один шаг ходьбы (общий для бойца и проверки проходимости карт) */
function stepFrom(T, x, y, dir) {
  const nx = x + dir;
  for (let up = 0; up <= MAX_CLIMB; up++) {
    if (bodyFree(T, nx, y - up)) {
      let ny = y - up, k = 0;
      while (k < MAX_CLIMB + 2 && !onGround(T, nx, ny) && bodyFree(T, nx, ny + 1)) { ny++; k++; }
      return { x: nx, y: ny, m: 0 };
    }
  }
  return mantleFrom(T, x, y, dir);
}
/** точка схода с лестницы наверху: площадка рядом с шахтой */
function ladderTopExit(T, l, dir) {
  for (const d of [dir, -dir]) {
    for (let dx = 20; dx <= 34; dx += 2) {
      const x = l.x + d * dx;
      for (let y = l.y1 - 16; y <= l.y1 + 16; y++) if (bodyFree(T, x, y) && onGround(T, x, y)) return { x, y };
    }
  }
  return null;
}

class Soldier {
  constructor(id, team, name, x, y, hp) {
    this.id = id; this.team = team; this.name = name;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.hp = hp; this.maxHp = hp; this.alive = true; this.gone = false;
    this.st = 'stand'; this.face = team % 2 ? -1 : 1; this.aim = this.face > 0 ? -0.5 : Math.PI + 0.5;
    this.rot = 0; this.vrot = 0; this.walkAcc = 0; this.hurt = 0; this.wpn = null; this.thrust = false;
    this.fuel = 0; this.restT = 0; this.maxVy = 0;
    // ранения по частям тела: 0 голова, 1 торс, 2 левая рука, 3 правая рука, 4 левая нога, 5 правая нога (стороны — по карте)
    this.wd = [0, 0, 0, 0, 0, 0]; this.wl = [0, 0, 0, 0, 0, 0];
  }
  /** часть тела по точке попадания */
  partAt(px, py) {
    const h = this.y - py, side = px < this.x ? 0 : 1;
    if (h >= 28) return 0;
    if (h >= 15) return Math.abs(px - this.x) >= 3.5 ? 2 + side : 1;
    return 4 + side;
  }
  /** ранение: урон копится по частям тела; тяжёлое попадание в руку или ногу может её оторвать. Возвращает true, если конечность потеряна */
  wound(part, dmg, heavy) {
    if (!(dmg > 0)) return false;
    this.wd[part] += dmg; const w = this.wd[part];
    let lost = false;
    if (part >= 2 && this.wl[part] < 3 && ((w >= 42 && dmg >= 16 && Math.random() < (heavy ? 0.7 : 0.4)) || w >= 70)) { this.wl[part] = 3; lost = true; }
    else if (this.wl[part] < 3) this.wl[part] = w >= 34 ? 2 : w >= 14 ? 1 : 0;
    return lost;
  }
  /** насколько бодро ходит: каждая раненая нога замедляет, потерянная — сильно */
  legFactor() { let f = 1; for (const i of [4, 5]) f *= [1, 0.86, 0.68, 0.42][this.wl[i]]; return f; }
  /** предел силы броска и точность: раненые и потерянные руки */
  armFactor() { let f = 1; for (const i of [2, 3]) f *= [1, 0.95, 0.85, 0.7][this.wl[i]]; return f; }
  woundCode() { let c = 0; for (let i = 0; i < 6; i++) c |= (this.wl[i] & 3) << (i * 2); return c; }
  snap() {
    const fl = (this.alive ? 1 : 0) | (this.gone ? 2 : 0) | (this.thrust ? 4 : 0) | (this.hurt > 0 ? 8 : 0);
    return [this.id, Math.round(this.x * 10), Math.round(this.y * 10), Math.round(this.aim * 100), this.face, this.hp, ST_IDX[this.st], Math.round(this.rot * 100), this.wpn ? WEAPON[this.wpn].idx : -1, fl, this.woundCode()];
  }
  fly() { if (this.st === 'dead' && !this.alive) { this.st = 'fly'; } else if (this.st !== 'fly') { this.st = 'fly'; this.vrot = rand(-7, 7); } this.y -= 1; }
  setAim(a) { this.aim = angNorm(a); const c = Math.cos(this.aim); if (Math.abs(c) > 0.02) this.face = c > 0 ? 1 : -1; }
  jump(g, dir) {
    let d = dir || this.face;
    // «почти на земле» тоже считается: на кочках и краях воронок боец на миг отрывается от поверхности
    const coyote = this.st === 'air' && this.vy > -40 && this.vy < 160 && (onGround(g.terrain, this.x, this.y + 2) || onGround(g.terrain, this.x, this.y + 5));
    if ((!['stand','walk','climb'].includes(this.st) && !coyote) || !this.alive || (this.wl[4] === 3 && this.wl[5] === 3)) return;
    if (g.turn.ox === undefined && g.turn.walk < 36) return;
    // запас хода кончился — прыгнуть всё равно можно, но только на месте (вверх), а не вперёд за границу
    const inPlace = g.turn.ox !== undefined && !walkOk(g, this, this.x + d * 40);

    this.face = d;
    const lf = Math.sqrt(this.legFactor()); this.st = 'air'; this.vx = inPlace ? 0 : d * JUMP_VX * lf; this.vy = -JUMP_VY * (0.55 + 0.45 * lf); this.y -= 1;
    if (g.turn.ox === undefined) g.turn.walk = Math.max(0, g.turn.walk - 36);
    g.emit({ t: 'jump', x: R1(this.x), y: R1(this.y) });
  }
  tryStep(T, dir) {
    const p = stepFrom(T, this.x, this.y, dir);
    if (!p) return false;
    this.x = p.x; this.y = p.y;
    return true;
  }
  unstick(T) {
    for (let k = 1; k <= 26; k++) if (bodyFree(T, this.x, this.y - k)) { this.y -= k; return; }
    for (let k = 1; k <= 14; k++) { if (bodyFree(T, this.x - k, this.y)) { this.x -= k; return; } if (bodyFree(T, this.x + k, this.y)) { this.x += k; return; } }
  }
  die(g, how) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this.thrust = false;
    g.emit({ t: 'die', id: this.id, x: R1(this.x), y: R1(this.y), how });
    if (this.st === 'jet' || this.st === 'climb') this.st = 'fly';
    else if (this.st === 'stand' || this.st === 'walk') this.st = 'dead';
    this.restT = 0;
  }
  drown(g) {
    if (this.gone) return;
    g.splash(this.x, 2);
    if (this.alive) { this.alive = false; this.hp = 0; g.emit({ t: 'die', id: this.id, x: R1(this.x), y: R1(g.waterY), how: 'drown' }); }
    this.gone = true; this.thrust = false;
  }
  update(g, dt, ctrl) {
    if (this.gone) return;
    const T = g.terrain;
    if (this.hurt > 0) this.hurt -= dt;
    if (this.y - 8 > g.waterY || this.y > g.H + 40) { this.drown(g); return; }
    this.thrust = false;
    const ladder = (g.map.ladders || []).find(l => Math.abs(l.x-this.x)<19 && this.y>=l.y1-8 && this.y<=l.y2+8);
    if (this.alive && ladder && ctrl && ctrl.u !== ctrl.d && this.st !== 'jet' && this.st !== 'fly' && this.st !== 'climb' && (g.turn.ox !== undefined || g.turn.walk > 0)) {
      // наверху «вверх» ничего не делает, внизу «вниз» — тоже
      const atTop = this.y <= ladder.y1 + 4 && this.st !== 'air', atBottom = this.y >= ladder.y2 - 2 && onGround(T, this.x, this.y);
      if ((ctrl.u && !atTop) || (ctrl.d && !atBottom)) { if (bodyFree(T, ladder.x, this.y)) { this.x = ladder.x; this.st = 'climb'; } }
    }
    if (this.st==='climb') {
      if (!ladder) { this.st='air'; this.vx=0; this.vy=0; return; }
      this.vx=0;this.vy=0;
      if(ctrl && ctrl.l!==ctrl.r){
        const d = ctrl.l ? -1 : 1; this.face = d;
        if (bodyFree(T, ladder.x + d * 12, this.y)) this.x = ladder.x + d * 12;
        this.st='air'; this.vx = d * 75; return;
      }
      // по лестнице запас хода не тратится: он считается только по горизонтали от точки начала хода
      const legacy = g.turn.ox === undefined;
      if(ctrl && ctrl.u!==ctrl.d && (!legacy || g.turn.walk>0)){
        const dist=legacy?Math.min(65*dt,g.turn.walk):65*dt; let ny=this.y+(ctrl.u?-dist:dist);
        if (ctrl.u && ny <= ladder.y1 - 4) {
          // выбрались наверх: шагаем на площадку рядом с шахтой
          const p = ladderTopExit(T, ladder, this.face);
          if (p) { this.face = p.x > ladder.x ? 1 : -1; this.x = p.x; this.y = p.y; this.st = 'stand'; if (legacy) g.turn.walk -= dist; return; }
          ny = Math.max(ny, ladder.y1 - 8);
        }
        if(bodyFree(T,ladder.x,ny)){this.x=ladder.x;this.y=ny;if(legacy)g.turn.walk-=dist;}
        else if (ctrl.d && onGround(T, this.x, this.y)) this.st = 'stand';
      }
      return;
    }
    switch (this.st) {
      case 'stand': case 'walk': {
        if (!onGround(T, this.x, this.y) && bodyFree(T, this.x, this.y + 1)) { this.st = 'air'; this.vx = 0; this.vy = 0; this.maxVy = 0; break; }
        if (!bodyFree(T, this.x, this.y)) this.unstick(T);
        let moving = false;
        const legacy = g.turn.ox === undefined;
        if (ctrl && ctrl.l !== ctrl.r && this.alive && (!legacy || g.turn.walk > 0)) {
          const dir = ctrl.l ? -1 : 1;
          this.walkAcc += WALK_SPEED * this.legFactor() * dt;   // с раненой ногой — медленнее, с потерянной — ковыляет
          while (this.walkAcc >= 1) {
            this.walkAcc -= 1;
            if (legacy ? g.turn.walk <= 0 : !walkOk(g, this, this.x + dir)) { this.walkAcc = 0; break; }
            if (this.tryStep(T, dir)) {
              moving = true; if (legacy) g.turn.walk -= 1;
              this.footDistance=(this.footDistance||0)+1;
              if(this.footDistance>=22){this.footDistance=0;g.emit({t:'footstep',x:R1(this.x),y:R1(this.y)});}
              if (!onGround(T, this.x, this.y)) { this.st = 'air'; this.vx = dir * 45; this.vy = 0; this.maxVy = 0; break; }
            } else { this.walkAcc = 0; break; }
          }
        } else this.walkAcc = 0;
        if (this.st === 'stand' || this.st === 'walk') this.st = moving ? 'walk' : 'stand';
        break;
      }
      case 'air': case 'fly': this.updateAir(g, dt); break;
      case 'jet': this.updateJet(g, dt, ctrl); break;
      case 'dead': {
        if (!onGround(T, this.x, this.y) && bodyFree(T, this.x, this.y + 1)) { this.st = 'fly'; this.vx = 0; this.vy = 0; break; }
        this.restT += dt;
        if (this.restT > 0.7) { this.gone = true; g.spawn(new Tomb(g, this.x, this.y, this.team)); }
        break;
      }
    }
  }
  updateAir(g, dt) {
    const T = g.terrain;
    this.vy = Math.min(this.vy + g.gravity * dt, 1500);
    if (this.st === 'fly') { this.rot += this.vrot * dt; this.vx *= 1 - 0.15 * dt; }
    if (this.vy > this.maxVy) this.maxVy = this.vy;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy)) * dt / 2));
    for (let i = 0; i < n; i++) {
      const sx = this.vx * dt / n, sy = this.vy * dt / n;
      const nx = this.x + sx, ny = this.y + sy;
      if (bodyFree(T, nx, ny)) {
        this.x = nx; this.y = ny;
        if (this.vy > 0 && onGround(T, this.x, this.y)) { this.land(g); return; }
        continue;
      }
      if (bodyFree(T, this.x, ny)) { this.y = ny; this.vx = this.st === 'fly' ? -this.vx * 0.35 : 0; if (this.st === 'fly') this.vrot = -this.vrot * 0.6; continue; }
      if (bodyFree(T, nx, this.y)) { this.x = nx; if (this.vy < 0) this.vy = -this.vy * 0.15; else { this.land(g); return; } continue; }
      if (this.vy > 0) { this.land(g); return; }
      this.vx *= -0.3; this.vy *= -0.3; break;
    }
  }
  land(g) {
    const impact = this.vy;
    if (this.st === 'fly' && impact > 240) {
      if (impact > FALL_SAFE) this.fallDamage(g, impact);
      this.vy = -impact * 0.12; this.vx *= 0.38; this.vrot *= 0.35; this.y -= 1;
      g.emit({ t: 'land', x: R1(this.x), y: R1(this.y), h: 1 });
      return;
    }
    const wasFly = this.st === 'fly';
    if (impact > FALL_SAFE) this.fallDamage(g, impact);
    this.vx = 0; this.vy = 0; this.rot = 0; this.vrot = 0;
    this.st = this.alive ? 'stand' : 'dead'; this.restT = 0;
    if (!bodyFree(g.terrain, this.x, this.y)) this.unstick(g.terrain);
    if (impact > 200 || wasFly) g.emit({ t: 'land', x: R1(this.x), y: R1(this.y), h: impact > 450 ? 1 : 0 });
  }
  fallDamage(g, impact) {
    const d = Math.min(40, Math.round((impact - FALL_SAFE) / 11));
    if (d > 0 && this.alive) g.damage(this, d, null);
  }
  updateJet(g, dt, ctrl) {
    const T = g.terrain;
    let ax = 0, ay = g.gravity * 0.55;
    if (ctrl && this.fuel > 0 && this.alive) {
      if (ctrl.u) { ay -= 1150; this.fuel -= dt; this.thrust = true; }
      if (ctrl.l) { ax -= 560; this.fuel -= dt * 0.4; this.thrust = true; }
      if (ctrl.r) { ax += 560; this.fuel -= dt * 0.4; this.thrust = true; }
      if (ctrl.l !== ctrl.r) this.face = ctrl.l ? -1 : 1;
    }
    if (this.fuel <= 0) { this.st = 'air'; this.thrust = false; return; }
    this.vx = clamp((this.vx + ax * dt) * (1 - 1.1 * dt), -240, 240);
    this.vy = clamp((this.vy + ay * dt) * (1 - 0.6 * dt), -260, 620);
    if (this.thrust && Math.random() < dt * 11) g.emit({ t: 'jet', x: R1(this.x), y: R1(this.y) });
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy)) * dt / 2));
    for (let i = 0; i < n; i++) {
      const nx = this.x + this.vx * dt / n, ny = this.y + this.vy * dt / n;
      if (bodyFree(T, nx, ny)) { this.x = nx; this.y = ny; if (this.vy > 0 && onGround(T, this.x, this.y)) { this.vx = 0; this.vy = 0; this.st = 'stand'; this.thrust = false; return; } continue; }
      if (bodyFree(T, this.x, ny)) { this.y = ny; this.vx = 0; continue; }
      if (bodyFree(T, nx, this.y)) { this.x = nx; if (this.vy > 0) { this.vy = 0; this.st = 'stand'; this.thrust = false; return; } this.vy = 0; continue; }
      this.vx = 0; this.vy = 0; break;
    }
  }
}
