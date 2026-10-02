'use strict';
/* =========================================================
   Компьютерный противник: перебирает траектории (с учётом
   ветра и рельефа), оценивает урон и выбирает лучший ход
   ========================================================= */
const AI_LEVELS = {
  easy: { aim: 0.1, pw: 0.1 },
  normal: { aim: 0.035, pw: 0.035 },
  hard: { aim: 0.01, pw: 0.01 },
};
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

class AISearch {
  constructor(g, s, team) {
    this.g = g; this.s = s; this.team = team; this.tasks = []; this.i = 0; this.best = null; this.fallback = null; this.fbDist = Infinity;
    this.enemies = g.soldiers.filter(o => o.alive && o.team !== team);
    let nd = Infinity; this.nearestDir = 1;
    for (const e of this.enemies) { const d = Math.abs(e.x - s.x); if (d < nd) { nd = d; this.nearestDir = e.x < s.x ? -1 : 1; } }
    const avail = (w) => g.canUse(g.teams[team], w);
    const kinds = [['bazooka', 'rocket', 1050, 0], ['grenade', 'grenade', 780, 3], ['mortar', 'mortar', 960, 0], ['cluster', 'grenade', 780, 3]];
    for (const [w, sim, speed, fuse] of kinds) {
      if (!avail(w)) continue;
      for (let a = -178; a <= 34; a += 4) for (let p = 0.2; p <= 1.0001; p += 0.08) this.tasks.push([w, sim, speed, fuse, a * DEG, p]);
    }
    this.direct(avail); this.heal(avail);
  }
  heal(avail) { if (this.s.hp < 40 && avail('medkit')) this.consider({ w: 'medkit', aim: this.s.aim, pw: 1, score: 26 }); }
  consider(c) { if (!this.best || c.score > this.best.score) this.best = c; }
  blastScore(x, y, R, D) {
    let sc = 0;
    for (const o of this.g.soldiers) {
      if (!o.alive) continue;
      const d = Math.hypot(o.x - x, o.y - 13 - y); if (d >= R + 12) continue;
      const f = 1 - d / (R + 12); const dmg = D * (0.25 + 0.75 * f); const kill = dmg >= o.hp;
      if (o.team === this.team) sc -= (dmg + (kill ? 60 : 0)) * (o === this.s ? 2.2 : 1.4);
      else sc += dmg + (kill ? 40 : 0) + (o.y > this.g.waterY - 120 ? 8 : 0);
    }
    return sc;
  }
  run(n) {
    const g = this.g, s = this.s;
    for (let k = 0; k < n && this.i < this.tasks.length; k++, this.i++) {
      const [w, sim, speed, fuse, a, p] = this.tasks[this.i];
      const m = muzzle(s, a, sim === 'grenade' ? 10 : 15);
      if (g.terrain.isSolid(m.x, m.y)) continue;
      const r = simulateShot(g, sim, m.x, m.y, Math.cos(a) * speed * p, Math.sin(a) * speed * p, s, fuse);
      if (!r) continue;
      const B = BLAST[w === 'bazooka' ? 'rocket' : w];
      let sc = this.blastScore(r.x, r.y, B.R, B.D);
      if (w === 'cluster') sc *= 1.1;
      this.consider({ w, aim: a, pw: p, score: sc - (WEAPON[w].ammo > 0 ? 6 : 0), ix: r.x });
      if (w === 'bazooka') for (const e of this.enemies) { const d = Math.hypot(e.x - r.x, e.y - 13 - r.y); if (d < this.fbDist) { this.fbDist = d; this.fallback = { w, aim: a, pw: p, score: 0, ix: r.x }; } }
    }
    return this.i >= this.tasks.length;
  }
  direct(avail) {
    const g = this.g, s = this.s;
    const own = (x, r) => g.soldiers.some(o => o.alive && o.team === this.team && Math.abs(o.x - x) < r);
    for (const e of this.enemies) {
      const ex = e.x, ey = e.y - 14;
      const a = Math.atan2(ey - (s.y - GUN_Y), ex - s.x); const dist = Math.hypot(ex - s.x, ey - s.y + GUN_Y);
      const m = muzzle(s, a, 16); const h = hitscan(g, m.x, m.y, a, 2600, s);
      const clear = h.type === 'soldier' && h.s === e;
      const kb = (dmg) => dmg >= e.hp ? 40 : 0;
      if (clear && avail('sniper')) this.consider({ w: 'sniper', aim: a, pw: 1, score: 45 + kb(45) - 8 });
      // прямой огонь: небольшой случайный бонус, чтобы компьютер не повторял одно и то же оружие
      const vary = () => Math.random() * 10;
      if (clear && dist < 750 && avail('assault')) { const dmg = dist < 350 ? 26 : 18; this.consider({ w: 'assault', aim: a, pw: 1, score: dmg + kb(dmg) + vary() }); }
      if (clear && dist < 900 && avail('magnum')) this.consider({ w: 'magnum', aim: a, pw: 1, score: 35 + kb(35) + vary() });
      // кислота проходит сквозь землю: достаточно, чтобы цель была на прямой недалеко
      if (dist < 650 && avail('acid')) { let sc = 0; const cx = Math.cos(a), cy = Math.sin(a); for (const o of g.soldiers) { if (!o.alive || o === s) continue; const rx = o.x - s.x, ry = o.y - 14 - (s.y - GUN_Y), along = rx * cx + ry * cy; if (along < 0 || along > 650 || Math.abs(rx * cy - ry * cx) > 14) continue; sc += o.team === this.team ? -25 : 15 + (o.hp <= 15 ? 40 : 0); } if (sc > 0) this.consider({ w: 'acid', aim: a, pw: 1, score: sc - 4 + vary() }); }
      if (clear && dist < 380 && avail('uzi')) this.consider({ w: 'uzi', aim: a, pw: 1, score: 30 + kb(30) - 6 + vary() });
      // РПГ: прямой полёт — нужна чистая линия до цели; дальше ~900 px ракета теряет управление
      if (avail('rpg') && dist < 900) { const hh = hitscan(g, m.x, m.y, a, 2600, s); if (hh.type === 'soldier' && hh.s.team !== this.team || Math.hypot((hh.x ?? 1e9) - ex, (hh.y ?? 1e9) - ey) < 30) this.consider({ w: 'rpg', aim: a, pw: 1, score: this.blastScore(ex, ey, BLAST.rocket.R, BLAST.rocket.D) - 6 + vary(), ix: ex }); }
      if (clear && dist < 600 && avail('revolver')) this.consider({ w: 'revolver', aim: a, pw: 1, score: 40 + kb(45) - 6 + vary() });
      if (clear && dist < 550 && avail('minigun')) this.consider({ w: 'minigun', aim: a, pw: 1, score: 34 + kb(34) - 6 + vary() });
      if (clear && dist < 520 && avail('tesla')) { const chain = this.enemies.filter(o => o !== e && Math.hypot(o.x - e.x, o.y - e.y) < 160).length; this.consider({ w: 'tesla', aim: a, pw: 1, score: 32 + 14 * chain + kb(32) - 6 + vary() }); }
      if (clear && dist < 190 && avail('flamer')) this.consider({ w: 'flamer', aim: a, pw: 1, score: 30 + kb(30) - 6 + vary() });
      if (avail('railgun')) {
        // луч пробивает землю: считаем всех бойцов на линии
        let sc = 0; const cx = Math.cos(a), cy = Math.sin(a);
        for (const o of g.soldiers) { if (!o.alive || o === s) continue; const rx = o.x - s.x, ry = o.y - 14 - (s.y - GUN_Y), along = rx * cx + ry * cy; if (along < 0 || Math.abs(rx * cy - ry * cx) > 16) continue; sc += o.team === this.team ? -70 : 40 + (o.hp <= 45 ? 40 : 0); }
        if (sc > 0) this.consider({ w: 'railgun', aim: a, pw: 1, score: sc - 10 + vary() });
      }
      if (clear && dist < 420 && avail('shotgun')) { const dmg = dist < 150 ? 40 : dist < 280 ? 30 : 18; this.consider({ w: 'shotgun', aim: a, pw: 1, score: dmg + kb(dmg) }); }
      // ботинок: сбросить врага в воду или с обрыва — главная цель пинка
      if (Math.abs(ex - s.x) < 24 && Math.abs(e.y - s.y) < 18 && avail('boot')) { const dir = ex >= s.x ? 1 : -1; let drop = 0; for (let k = 60; k <= 360; k += 60) { const top = g.terrain.findTop(Math.round(e.x + dir * k), Math.round(e.y - 40)); if (top >= g.waterY) drop = 50; } this.consider({ w: 'boot', aim: dir > 0 ? 0 : Math.PI, pw: 1, score: 15 + kb(15) + drop }); }
      if (Math.abs(ex - s.x) < 22 && Math.abs(e.y - s.y) < 18 && avail('bat')) { const dir = ex >= s.x ? 1 : -1; this.consider({ w: 'bat', aim: dir > 0 ? -0.6 : Math.PI + 0.6, pw: 1, score: 55 + kb(30) }); }
      if (avail('airstrike') && !own(ex, 110)) { const n = this.enemies.filter(o => Math.abs(o.x - ex) < 90).length; this.consider({ w: 'airstrike', aim: s.aim, pw: 1, tx: ex, ty: ey, score: 24 * n + kb(26) - 14 }); }
      if (avail('lightning') && !own(ex, 80)) this.consider({ w: 'lightning', aim: s.aim, pw: 1, tx: ex - g.turn.wind * 1.0, ty: ey, score: 30 + kb(38) - 12 });
      if (avail('orbital') && !own(ex, 90)) this.consider({ w: 'orbital', aim: s.aim, pw: 1, tx: ex, ty: ey, score: 38 + kb(45) - 12 });
      if (avail('homing') && dist > 250) this.consider({ w: 'homing', aim: -Math.PI / 2 + (ex > s.x ? 0.5 : -0.5), pw: 0.65, tx: ex, ty: ey, score: 36 + kb(45) - 10 });
      if (avail('nuke')) { const n = this.enemies.filter(o => Math.hypot(o.x - ex, o.y - e.y) < 140).length; if (n >= 2 && !own(ex, 230)) this.consider({ w: 'nuke', aim: s.aim, pw: 1, tx: ex, ty: ey, score: 60 * n }); }
    }
  }
}

class AI {
  constructor(g, team, level) { this.g = g; this.team = team; this.L = AI_LEVELS[level] || AI_LEVELS.normal; this.key = null; }
  update(dt) {
    const g = this.g, T = g.turn;
    if (g.over || T.team !== this.team) { this.key = null; return; }
    const s = g.active(); if (!s || !s.alive) return;
    const key = T.round + ':' + T.sid;
    if (this.key !== key) { this.key = key; this.state = 'think'; this.t = 0; this.plan = null; this.search = null; this.walked = false; this.pw = 0; this.aim = s.aim; this.goalAim = undefined; this.goalTx = undefined; this.goalTy = undefined; this.dropAim = undefined; }
    this.t += dt;
    const send = (c) => g.cmd(this.team, c);
    if (T.phase === 'retreat') { this.retreat(s, send); return; }
    if (T.phase === 'use') { this.during(s, send); return; }
    if (T.phase !== 'aim') return;
    switch (this.state) {
      case 'think': {
        if (this.t < 0.4) return;
        if (!this.search) this.search = new AISearch(g, s, this.team);
        if (!this.search.run(160)) return;
        const best = this.search.best;
        if ((!best || best.score < 10) && !this.walked && T.walk > 60) { this.state = 'walk'; this.walkT = 0; this.walkDir = this.search.nearestDir; return; }
        this.plan = best && best.score > 0 ? best : (this.search.fallback || best);
        if (!this.plan) { send({ c: 'skip' }); this.state = 'done'; return; }
        this.state = 'select'; this.t = 0;
        break;
      }
      case 'walk': {
        this.walkT += dt;
        send({ c: 'ctrl', l: this.walkDir < 0, r: this.walkDir > 0, aim: this.walkDir > 0 ? -0.5 : Math.PI + 0.5, pw: -1 });
        if (this.walkT > 1.3 || T.walk <= 0) { send({ c: 'ctrl', l: false, r: false, aim: s.aim, pw: -1 }); this.walked = true; this.search = null; this.state = 'think'; this.t = 0.2; }
        break;
      }
      case 'select': {
        send({ c: 'weapon', id: this.plan.w });
        const L = this.L;
        this.goalAim = this.plan.aim + gauss() * L.aim; this.goalPw = clamp(this.plan.pw + gauss() * L.pw, 0.08, 1);
        if (this.plan.tx !== undefined) { this.goalTx = this.plan.tx + gauss() * L.aim * 500; this.goalTy = this.plan.ty; }
        if (this.plan.w === 'homing') send({ c: 'target', x: this.goalTx, y: this.goalTy });
        this.aim = s.aim; this.state = 'aim'; this.t = 0;
        break;
      }
      case 'aim': {
        const d = angNorm(this.goalAim - this.aim); const stepA = 2.4 * dt;
        this.aim = Math.abs(d) < stepA ? this.goalAim : this.aim + Math.sign(d) * stepA;
        send({ c: 'ctrl', l: false, r: false, aim: this.aim, pw: -1 });
        if (Math.abs(angNorm(this.goalAim - this.aim)) < 0.001 && this.t > 0.5) {
          const W = WEAPON[this.plan.w];
          if (W.mode === 'charge' || W.mode === 'tcharge') { this.state = 'charge'; this.pw = 0; }
          else {
            // быстрые пули: сперва обзор к месту попадания (как у игрока), потом очередь
            const p = FAST_SHOT[W.id] ? predictShot(g, s, this.aim, W.id) : null;
            if (p && Math.hypot(p.x - s.x, p.y - s.y) > 380) { send({ c: 'look', x: Math.round(p.x), y: Math.round(p.y) }); this.state = 'frame'; this.t = 0; }
            else { send({ c: 'fire', aim: this.aim, pw: 1, tx: this.goalTx, ty: this.goalTy }); this.state = 'done'; }
          }
        }
        break;
      }
      case 'frame': {
        send({ c: 'ctrl', l: false, r: false, aim: this.aim, pw: -1 });
        if (this.t > 0.75) { send({ c: 'fire', aim: this.aim, pw: 1, tx: this.goalTx, ty: this.goalTy }); this.state = 'done'; this.t = 0; }
        break;
      }
      case 'charge': {
        this.pw = Math.min(1, this.pw + dt / 1.15);
        send({ c: 'ctrl', l: false, r: false, aim: this.aim, pw: this.pw });
        if (this.pw >= this.goalPw) { send({ c: 'fire', aim: this.aim, pw: this.goalPw }); this.state = 'done'; }
        break;
      }
      case 'done': {
        const weapon = WEAPON[T.weapon];
        if (T.shots > 0 && T.shots < (weapon.shots || 1) && this.t > .6) {
          send({ c: 'fire', aim: this.aim, pw: 1 }); this.t = 0; break;
        }
        // выстрел не состоялся (например, ошибка) — пропускаем ход через пару секунд
        if (this.t > 3) { send({ c: 'skip' }); this.t = 0; }
        break;
      }
    }
  }
  during(s, send) {
    const g = this.g;
    // авиаудар: прицел сброса бежит по земле под самолётом — жмём сброс, когда он дошёл до точки (ошибка ИИ — в самой точке и в реакции)
    if (this.plan && this.plan.w === 'airstrike' && this.goalTx !== undefined) {
      const jet = g.entities.find(e => e.k === 'jet' && !e.dropped && e.owner === s);
      if (jet) {
        if (this.dropAim === undefined) this.dropAim = this.goalTx + gauss() * this.L.aim * 300;
        const hit = bombImpact(g, jet.x, jet.y, jet.dir);
        if (hit && (jet.dir > 0 ? hit.x >= this.dropAim : hit.x <= this.dropAim)) send({ c: 'fire' });
      }
    }
    // орбитальный лазер: подводим луч к цели клавишами
    if (this.plan && this.plan.w === 'orbital' && this.goalTx !== undefined) {
      const beam = g.entities.find(e => e.k === 'orbital' && e.owner === s);
      if (beam) { const d = this.goalTx - beam.x; send({ c: 'ctrl', l: d < -5, r: d > 5, aim: s.aim, pw: -1 }); return; }
    }
    if (this.plan && this.plan.w === 'robot') {
      const r = g.entities.find(e => e.k === 'robot');
      if (r) for (const o of g.soldiers) if (o.alive && o.team !== this.team && Math.hypot(o.x - r.x, o.y - r.y) < 40) { send({ c: 'fire' }); break; }
    }
    send({ c: 'ctrl', l: false, r: false, aim: this.goalAim ?? s.aim, pw: -1 });
  }
  retreat(s, send) {
    const ix = this.plan ? (this.plan.ix ?? this.plan.tx) : undefined;
    if (ix === undefined) { send({ c: 'ctrl', l: false, r: false, aim: s.aim, pw: -1 }); return; }
    const dir = s.x < ix ? -1 : 1; const near = Math.abs(ix - s.x) < 150;
    send({ c: 'ctrl', l: near && dir < 0, r: near && dir > 0, aim: dir > 0 ? -0.4 : Math.PI + 0.4, pw: -1 });
  }
}
