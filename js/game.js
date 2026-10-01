'use strict';
/* =========================================================
   Игра (авторитетная симуляция на хосте): ходы, оружие,
   взрывы, урон, ящики, внезапная смерть, снимки для сети
   ========================================================= */
const RETREAT_TIME = 3;
const WALK_BUDGET = 420;
const MAX_WIND = 170;

class Game {
  constructor(cfg) {
    this.cfg = cfg; const map = MAP_BY_ID[cfg.mapId] || MAPS[0]; this.map = map; this.theme = THEMES[map.theme];
    this.W = map.W; this.H = map.H; this.waterY = map.water; this.gravity = 640 * (this.theme.gravity || 1);
    this.raster = rasterizeMap(map);
    this.terrain = new Terrain(this.W, this.H, this.raster.mask);
    this.terrain.materials = this.raster.mat;
    this.props = resolveProps(this.terrain, map);
    const S = cfg.settings;
    this.teams = cfg.teams.map((t, i) => ({ idx: i, name: t.name, color: t.color, hat: t.hat, ammo: makeAmmo(S.arsenal, S.ammo), next: 0, lastW: 'bazooka', dmg: 0, kills: 0, order: [] }));
    this.soldiers = []; this.entities = []; this.events = []; this.pending = [];
    this.nextId = 1; this.time = 0; this.round = 0; this.over = null; this.teamsDirty = true; this.sdStarted = false;
    this.turn = { team: -1, sid: 0, time: 0, phase: 'wait', delay: 1.8, wind: 0, weapon: 'bazooka', walk: WALK_BUDGET, retreat: 0, shots: 0, target: null, charge: -1, rot: 0, spin: 0, round: 0 };
    this.usage = null; this.ctrl = null;
    this.spawnSoldiers();
  }
  buildVisual() { buildTerrainVisual(this.terrain, this.theme, this.map, this.raster, this.waterY); this.raster = null; }
  /* ---------- расстановка ---------- */
  spawnCandidates() {
    const T = this.terrain, out = [];
    for (let x = 36; x < this.W - 36; x += 5) {
      for (let y = 40; y < this.waterY - 24; y++) {
        if (T.isSolid(x, y) && !T.isSolid(x, y - 1)) {
          if (bodyFree(T, x, y) && bodyFree(T, x, y - 8) && T.isSolid(x - 5, y + 3) && T.isSolid(x + 5, y + 3)) out.push({ x, y });
          y += 32;
        }
      }
    }
    return out;
  }
  spawnSoldiers() {
    const S = this.cfg.settings; const n = S.perTeam; const total = n * this.teams.length;
    // Reproducible deployments: opposing sides, safe footing, spaced squad members.
    const rng = makeRng(this.map.seed + 404), all = this.spawnCandidates();
    const names = SOLDIER_NAMES.slice();
    let nameIndex = 0;
    for (const team of this.teams) {
      const left = (team.idx === 0) !== !!S.swap;   // S.swap — первая команда (я / хост) начинает справа
      const cands = shuffleArr(all.filter(c => left ? c.x < this.W * .44 : c.x > this.W * .56), rng);
      const chosen = [];
      for (const spacing of [150, 100, 65, 35, 12]) {
        for (const c of cands) {
          if (chosen.length >= n) break;
          if (chosen.every(o => Math.hypot(o.x-c.x,o.y-c.y) > spacing)) chosen.push(c);
        }
      }
      for (let i=0;i<n;i++) {
        const c=chosen[i] || all[(i*23)%Math.max(1,all.length)] || {x:this.W/2,y:100};
        const soldier=new Soldier(this.nextId++,team.idx,names[nameIndex++%names.length],c.x,c.y,S.hp);
        this.soldiers.push(soldier);team.order.push(soldier.id);
      }
    }
  }
  /* ---------- утилиты ---------- */
  emit(ev) { this.events.push(ev); }
  spawn(e) { this.entities.push(e); }
  active() { return this.soldierById(this.turn.sid); }
  soldierById(id) { for (const s of this.soldiers) if (s.id === id) return s; return null; }
  fallbackWeapon(team) { return this.canUse(team, 'bazooka') ? 'bazooka' : (WEAPONS.find(w => this.canUse(team, w.id)) || WEAPON.skip).id; }
  canUse(team, id) { const a = team.ammo[id]; const w = WEAPON[id]; return !!w && a !== undefined && a !== 0 && !(w.minRound && this.round < w.minRound); }
  soldierAt(x, y, r, ignore) {
    for (const s of this.soldiers) {
      if (!s.alive || s === ignore) continue;
      // зона попадания совпадает с фигурой бойца (рост ~36 px)
      if (x < s.x - 7 - r || x > s.x + 7 + r || y < s.y - 40 - r || y > s.y + 1 + r) continue;
      if (pointSegDist2(x, y, s.x, s.y - 4, s.x, s.y - 33) <= (5.5 + r) * (5.5 + r)) return s;
    }
    return null;
  }
  /** после хода: убрать крошку и занозы там, где ландшафт менялся (и у гостя онлайн — тем же событием) */
  tidyTerrain() {
    const T = this.terrain, n = T.touches.length; if (this.tidyN === undefined) this.tidyN = 0;
    if (n <= this.tidyN) return;
    const boxes = T.touches.slice(this.tidyN).map(b => [Math.round(b[0]) - 6, Math.round(b[1]) - 6, Math.round(b[2]) + 6, Math.round(b[3]) + 6]);
    T.tidy(boxes); this.tidyN = T.touches.length; this.emit({ t: 'tidy', b: boxes });
  }
  carve(x, y, r, scorch = true) { x = Math.round(x); y = Math.round(y); r = Math.round(r); if (r <= 0) return; this.terrain.carve(x, y, r, scorch); this.emit({ t: 'carve', x, y, r, s: scorch ? 1 : 0 }); }
  carveLine(x1, y1, x2, y2, r) { x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2); r = Math.round(r); this.terrain.carveLine(x1, y1, x2, y2, r); this.emit({ t: 'cline', x1, y1, x2, y2, r }); }
  splash(x, size) { this.emit({ t: 'splash', x: R1(x), s: size }); }
  explode(x, y, R, D, o = {}) {
    x = Math.round(x); y = Math.round(y);
    // Sample cover BEFORE carving, so a wall absorbs this blast even if it breaks.
    const exposure = new Map();
    for (const s of this.soldiers) {
      if (!s.gone && Math.hypot(s.x-x,s.y-13-y)<Math.max((R+12)*1.6,(o.frag&&FRAGS[o.frag]?FRAGS[o.frag].L:0)+20)) {
        exposure.set(s, (this.blastTransmission(x,y,s.x,s.y-25)+this.blastTransmission(x,y,s.x,s.y-13)+this.blastTransmission(x,y,s.x,s.y-3))/3);
      }
    }
    const material = this.terrain.materialAt(x,y) || this.terrain.materialAt(x,y+3);
    const craterScale = 1;   // прочность учитывается попиксельно в terrain.carve
    this.carve(x, y, Math.max(3,R*craterScale), true);
    // радиус поражения: ударная волна дотягивается до места, где падают осколки
    const FR = o.frag && FRAGS[o.frag], RD = Math.max((R + 12) * 1.6, FR ? FR.L : 0);
    this.emit({ t: 'boom', x, y, r: R, k: o.k || 0, w: Math.round(RD) });
    const knock = o.knock ?? R * 8;
    for (const s of this.soldiers) {
      if (s.gone) continue;
      // ударная волна: радиус RW; расстояние считается до ближайшей точки тела бойца (попадание в упор — полный урон)
      const cx = s.x, cy = s.y - 17, by = clamp(y, s.y - 33, s.y - 4); const d = Math.max(0, Math.hypot(s.x - x, by - y) - 6); const RR = R + 12, RW = RR * 1.6;
      if (d >= RD) continue;
      const fw = Math.max(0, 1 - d / RW), fd = 1 - d / RD;
      let dx = cx - x, dy = cy - y - 8; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const shielding = exposure.get(s) ?? 1;
      // взрывная волна отбрасывает сильно — бойцы разлетаются, как в классических артиллерийских играх
      // тело весит ~80 кг: вблизи его подбрасывает и крутит, на среднем расстоянии сбивает с ног, вдали — лишь толкает
      const imp = Math.min(760, knock * 1.35) * Math.pow(fw, 1.35) * shielding;
      if (imp >= 140) { s.vx += dx * imp; s.vy += dy * imp - imp * 0.18; s.fly(); s.vrot = (s.vrot || 0) + (dx >= 0 ? 1 : -1) * Math.min(14, imp / 45); }
      else if (imp >= 40) { s.vx += dx * imp * 0.8; s.vy += Math.min(0, dy * imp) - 60; s.fly(); s.vrot = (dx >= 0 ? 1 : -1) * imp / 60; }
      else if (imp >= 8 && s.st !== 'fly') s.x += dx * Math.min(3, imp / 12);   // слабая волна — лишь качнуло
      // урон: максимум D в эпицентре, линейно убывает с расстоянием до нуля на краю волны
      // точка удара волны — ближайшая к взрыву часть тела: взрыв под ногами ранит ноги, рядом с головой — голову
      if (D > 0 && s.alive && fd > 0) this.damage(s, Math.round(D * fd * shielding), o.owner, clamp(x, s.x - 5, s.x + 5), by, fd > 0.55);
    }
    if (o.frag && FRAGS[o.frag]) this.fragments(x, y - 3, FRAGS[o.frag], o.owner, o.vx, o.vy);
    for (const e of this.entities) {
      if (e.dead) continue; const d = Math.hypot(e.x - x, e.y - y); if (d > (R + 20) * 1.6) continue;
      if (e.k === 'mine') { e.trigger(this, true); }
      else if (e.k === 'crate') { e.dead = true; if (e.s === 1) this.pending.push([e.x, e.y, 'crate']); else this.emit({ t: 'boom', x: R1(e.x), y: R1(e.y), r: 12, k: 1 }); continue; }
      const f = 1 - d / ((R + 20) * 1.6); let dx = e.x - x, dy = e.y - y - 6; const l = Math.hypot(dx, dy) || 1;
      e.push(dx / l * knock * f * 0.8, dy / l * knock * f * 0.8);
    }
  }
  /** осколки: лучи во все стороны, останавливаются о камень; попавший осколок ранит тем слабее, чем дальше пролетел.
      Урон от всех осколков по бойцу суммируется — чем ближе к взрыву, тем больше осколков в него попадает */
  /** осколки: у каждого своя энергия. В воздухе она падает с дистанцией; в преграде тормозит по плотности материала
      (земля и дерево пробиваются, металл и бетон почти сразу останавливают); от твёрдых поверхностей под острым углом —
      рикошет; в мягком материале осколок сбивается с курса. Урон — по оставшейся энергии и по той части тела, куда попал */
  fragments(x, y, F, owner, ivx = 0, ivy = 0) {
    const hits = new Map(), ends = [], T = this.terrain;
    // направление разлёта зависит от удара: нормаль поверхности (осколки уходят от земли, а не в неё) и скорость снаряда (сноп вперёд)
    let snx = 0, sny = 0;
    for (let a = 0; a < 16; a++) { const ca = Math.cos(a / 16 * TAU), sa = Math.sin(a / 16 * TAU); if (T.isSolid(x + ca * 9, y + sa * 9)) { snx -= ca; sny -= sa; } }
    const sl = Math.hypot(snx, sny), sp = Math.hypot(ivx, ivy);
    const fwd = sp > 60 ? Math.min(0.45, sp / 2400) : 0, fx0 = sp > 0 ? ivx / sp : 0, fy0 = sp > 0 ? ivy / sp : 0;
    // потеря энергии на 3 px пути в материале и шанс рикошета: 1 земля, 2 скала, 3 кирпич, 4 дерево, 5 бетон, 6 металл, 7 лёд, 8 кристалл, 9 базальт
    // потеря энергии за 3 px: доска пробивается, 10 см земли или кирпича осколок уже не проходит
    const ABS = [0, 0.35, 0.9, 0.8, 0.12, 1.2, 2, 0.3, 0.6, 0.9], RIC = [0, 0.05, 0.35, 0.25, 0.04, 0.4, 0.7, 0.3, 0.45, 0.35];
    for (let i = 0; i < F.n; i++) {
      const a = (i + Math.random()) / F.n * TAU; let cx = Math.cos(a), cy = Math.sin(a);
      // уводим луч от поверхности и вперёд по ходу снаряда
      if (sl > 0.5) { const d = cx * snx / sl + cy * sny / sl; if (d < 0) { cx -= 1.6 * d * snx / sl; cy -= 1.6 * d * sny / sl; } }
      cx += fx0 * fwd * 2; cy += fy0 * fwd * 2; { const l = Math.hypot(cx, cy) || 1; cx /= l; cy /= l; }
      // у каждого осколка своя масса: тяжёлые летят дальше и бьют сильнее, мелкие быстро теряют скорость
      const mass = Math.pow(Math.random(), 1.8) * 2.2 + 0.35;
      const L = F.L * (0.55 + 0.45 * Math.sqrt(mass)) * (0.85 + Math.random() * 0.3);
      let px = x, py = y, e = 1, t = 0, inside = false, bounces = 0; const path = [[Math.round(x), Math.round(y)]]; const hitSet = new Set();
      while (e > 0.04 && t < L * 1.6) {
        px += cx * 3; py += cy * 3; t += 3;
        cy += 0.004;                                                      // осколок проседает под своим весом
        e -= 3 / L * 0.9;                                                  // сопротивление воздуха
        if (px < 0 || px >= this.W || py < 0 || py >= this.H) break;
        const solid = T.isSolid(px, py);
        if (solid) {
          const m = T.materialAt(px, py) || 2;
          if (!inside) {
            // вход в преграду: у твёрдой поверхности под острым углом — рикошет
            const nx = (T.isSolid(px - 3, py) ? 1 : 0) - (T.isSolid(px + 3, py) ? 1 : 0), ny = (T.isSolid(px, py - 3) ? 1 : 0) - (T.isSolid(px, py + 3) ? 1 : 0);
            const nl = Math.hypot(nx, ny);
            if (nl > 0 && bounces < 2) {
              const ux = nx / nl, uy = ny / nl, dot = cx * ux + cy * uy;   // нормаль смотрит из материала наружу
              if (dot < 0 && -dot < 0.55 && Math.random() < RIC[m] * 1.6) {
                cx -= 2 * dot * ux; cy -= 2 * dot * uy; const cl = Math.hypot(cx, cy); cx /= cl; cy /= cl;
                px += cx * 3; py += cy * 3; e *= 0.55; bounces++; path.push([Math.round(px), Math.round(py)]); continue;
              }
            }
            inside = true; path.push([Math.round(px), Math.round(py)]);
          }
          e -= ABS[m] / Math.sqrt(mass);   // тяжёлый осколок пробивает глубже
          if (ABS[m] < 0.25) { const d = (Math.random() - 0.5) * 0.25; const c0 = cx; cx = cx * Math.cos(d) - cy * Math.sin(d); cy = c0 * Math.sin(d) + cy * Math.cos(d); }   // в мягком материале уводит в сторону
          continue;
        }
        if (inside) { inside = false; path.push([Math.round(px), Math.round(py)]); }   // пробил насквозь — летит дальше ослабленным
        for (const s of this.soldiers) {
          if (!s.alive || s.gone || hitSet.has(s) || px < s.x - 7 || px > s.x + 7 || py < s.y - 36 || py > s.y + 1) continue;
          const dmg = F.d * e * 1.15 * Math.min(2.2, 0.6 + mass * 0.55);
          const h = hits.get(s) || { d: 0, vx: 0, vy: 0, parts: [0, 0, 0, 0, 0, 0] }; h.d += dmg; h.vx += cx * 16 * e; h.vy += cy * 16 * e; h.parts[s.partAt(px, py)] += dmg; hits.set(s, h);
          hitSet.add(s); e *= 0.25;                                        // застрял в теле или прошёл навылет сильно ослабленным
          break;
        }
      }
      path.push([Math.round(px), Math.round(py)]);
      ends.push(path.length > 2 ? path : path[path.length - 1]);
    }
    this.emit({ t: 'frags', x: R1(x), y: R1(y), e: ends });
    for (const [s, h] of hits) {
      if (!s.alive) continue; s.vx += h.vx; s.vy += h.vy;
      // каждый осколок ранит ту часть тела, куда попал; урон по здоровью — суммой
      const v = Math.round(h.d); if (v <= 0) continue;
      let best = 1; for (let i = 0; i < 6; i++) if (h.parts[i] > h.parts[best]) best = i;
      for (let i = 0; i < 6; i++) if (i !== best && h.parts[i] > 0 && s.wound(i, h.parts[i], false)) this.emit({ t: 'gib', id: s.id, p: i, x: R1(s.x), y: R1(s.y), f: s.face });
      const bx = s.x + (best === 2 || best === 4 ? -4 : best === 3 || best === 5 ? 4 : 0), by = s.y - [32, 21, 21, 21, 7, 7][best];
      this.damage(s, Math.min(v, Math.round(h.parts[best]) || v), owner, bx, by, false);
      const rest = v - Math.min(v, Math.round(h.parts[best]) || v); if (rest > 0 && s.alive) { s.hp = Math.max(0, s.hp - rest); this.emit({ t: 'dmg', id: s.id, v: rest, x: R1(s.x), y: R1(s.y) }); const ot = owner ? owner.team : -1; if (ot >= 0 && ot !== s.team) this.teams[ot].dmg += rest; if (s.hp <= 0) { s.die(this, 'hit'); if (ot >= 0 && ot !== s.team) this.teams[ot].kills++; this.teamsDirty = true; } }
    }
  }
  blastTransmission(x,y,tx,ty) {
    const d=Math.hypot(tx-x,ty-y);if(d<8)return 1;
    let thickness=0;
    for(let r=7;r<d-3;r+=3){const px=x+(tx-x)*r/d,py=y+(ty-y)*r/d;
      if(this.terrain.isSolid(px,py)){const m=this.terrain.materialAt(px,py);thickness+=3*({4:.5,5:1.5,6:2.3,7:.7}[m]||1);}}
    return Math.max(.025,Math.exp(-thickness/15));
  }
  nuke(x, y, owner) { this.emit({ t: 'nuke', x: R1(x), y: R1(y) }); this.explode(x, y, 135, 82, { owner, knock: 760, k: 2 }); }
  /** hx, hy — точка попадания (для ранений); без неё урон идёт в торс */
  damage(s, v, owner, hx, hy, heavy) {
    if (!s.alive || v <= 0) return;
    if (s.wound) { const part = isNum(hx) ? s.partAt(hx, hy) : 1; if (s.wound(part, Math.min(v, s.hp), heavy)) this.emit({ t: 'gib', id: s.id, p: part, x: R1(s.x), y: R1(s.y), f: s.face }); }
    v = Math.min(Math.round(v), s.hp); s.hp -= v; s.hurt = 0.3;
    const ot = owner ? owner.team : -1; if (ot >= 0 && ot !== s.team) this.teams[ot].dmg += v;
    this.emit({ t: 'dmg', id: s.id, v, x: R1(s.x), y: R1(s.y) });
    if (s.hp <= 0) { s.die(this, 'hit'); if (ot >= 0 && ot !== s.team) this.teams[ot].kills++; this.teamsDirty = true; }
  }
  heal(s, v) { if (!s.alive) return; const n = Math.min(v, s.maxHp - s.hp); if (n <= 0) return; s.hp += n; this.emit({ t: 'heal', id: s.id, v: n, x: R1(s.x), y: R1(s.y) }); }
  anyBusy() {
    for (const s of this.soldiers) if (!s.gone && (s.st === 'air' || s.st === 'fly' || s.st === 'jet' || s.st === 'dead')) return true;
    for (const e of this.entities) if (e.busy) return true;
    return false;
  }
  /* ---------- команды игрока ---------- */
  cmd(team, c) {
    const T = this.turn; if (!c || typeof c !== 'object' || this.over) return;
    if (T.team !== team) return;
    const s = this.active(); if (!s) return;
    switch (c.c) {
      case 'ctrl':
        this.ctrl = { l: !!c.l, r: !!c.r, u: !!c.u, d: !!c.d };
        if (isNum(c.aim) && (T.phase === 'aim' || T.phase === 'use' || T.phase === 'retreat')) s.setAim(c.aim);
        T.charge = (isNum(c.pw) && c.pw >= 0 && T.phase === 'aim') ? clamp(c.pw, 0, 1) : -1;
        break;
      case 'jump': if (T.phase === 'aim' || T.phase === 'retreat') s.jump(this, c.d === -1 || c.d === 1 ? c.d : 0); break;
      case 'weapon':
        if (T.phase === 'aim' && T.shots === 0 && typeof c.id === 'string' && this.canUse(this.teams[team], c.id)) { T.weapon = c.id; T.target = null; }
        break;
      case 'target': if (T.phase === 'aim' && isNum(c.x) && isNum(c.y)) T.target = { x: clamp(c.x, -500, this.W + 500), y: clamp(c.y, -1500, this.H) }; break;
      case 'untarget': if (T.phase === 'aim') T.target = null; break;   // Tab: отменить выбранную точку
      case 'holster': if (T.phase === 'aim' && T.shots === 0) { T.weapon = null; T.target = null; T.charge = -1; } break;   // Esc: убрать оружие из рук
      case 'rot': T.rot = ((T.rot + (c.d > 0 ? 1 : -1)) % 8 + 8) % 8; break;
      // подкрутка броска: 0 — нет, 1 — вперёд, -1 — назад
      case 'spin': if (T.phase === 'aim') T.spin = T.spin === 0 ? 1 : T.spin === 1 ? -1 : 0; break;
      case 'fire':
        if (T.phase === 'aim') { if (isNum(c.pw) && s.armFactor) c.pw = Math.min(c.pw, s.armFactor()); this.fire(s, c); }   // раненые руки не дают бросить в полную силу
        else if (T.phase === 'use' && this.usage && this.usage.fire) this.usage.fire(this, c);
        break;
      case 'skip': if (T.phase === 'aim' || T.phase === 'retreat') this.endTurn(); break;
    }
  }
  fire(s, c) {
    const T = this.turn; const W = WEAPON[T.weapon]; const team = this.teams[T.team];
    if (!W || !s.alive || (T.shots === 0 && !this.canUse(team, W.id))) return;
    if (isNum(c.aim)) s.setAim(c.aim);
    const p = { aim: s.aim, pw: clamp(isNum(c.pw) ? c.pw : 1, 0.06, 1), tx: isNum(c.tx) ? c.tx : undefined, ty: isNum(c.ty) ? c.ty : undefined, spin: T.spin | 0 };
    let res;
    try { res = FIRE[W.id](this, s, p); } catch (e) { console.error(e); return; }
    if (res === false) return;
    if (T.shots === 0 && team.ammo[W.id] > 0) { team.ammo[W.id]--; this.teamsDirty = true; }
    T.shots++; team.lastW = W.id; T.charge = -1;
    if (res && res.usage) { this.usage = res.usage; T.phase = 'use'; return; }
    this.afterUse();
  }
  afterUse() {
    const T = this.turn; const W = WEAPON[T.weapon]; const s = this.active();
    this.usage = null;
    if (!s || !s.alive) { this.endTurn(); return; }
    if (W.shots && T.shots < W.shots) { T.phase = 'aim'; return; }
    if (W.free) { T.phase = 'aim'; T.shots = 0; if (!this.canUse(this.teams[T.team], W.id)) T.weapon = this.fallbackWeapon(this.teams[T.team]); return; }
    if (W.ends) { this.endTurn(); return; }
    T.phase = 'retreat'; T.retreat = RETREAT_TIME; T.idle = 0;
  }
  /* ---------- цикл ---------- */
  step(dt) {
    this.time += dt;
    const T = this.turn; const act = this.active();
    const ctrlOk = act && (T.phase === 'aim' || T.phase === 'retreat' || T.phase === 'use');
    // пока игрок ведёт орбитальный луч или ждёт самолёт, A/D не двигают бойца
    const lockFeet = T.phase === 'use' && (T.weapon === 'orbital' || T.weapon === 'airstrike');
    const sctrl = lockFeet && this.ctrl ? { l: false, r: false, u: false, d: false } : this.ctrl;
    for (const s of this.soldiers) s.update(this, dt, ctrlOk && s === act ? sctrl : null);
    for (let i = 0; i < this.entities.length; i++) { const e = this.entities[i]; if (!e.dead) e.update(this, dt); }
    if (this.pending.length) { const p = this.pending; this.pending = []; for (const [x, y, k] of p) { const B = BLAST[k]; this.explode(x, y, B.R, B.D, { knock: B.K, frag: k }); } }
    this.entities = this.entities.filter(e => !e.dead);
    for (const s of this.soldiers) s.wpn = (s === act && s.alive && (T.phase === 'aim' || T.phase === 'use')) ? T.weapon : null;
    if (this.usage) {
      let done = false; try { done = this.usage.update(this, dt); } catch (e) { console.error(e); done = true; }
      if (done && T.phase === 'use') this.afterUse(); else if (done) this.usage = null;
    }
    // запас хода — оставшийся радиус по горизонтали от точки начала хода
    if (T.ox !== undefined && act && act.alive && (T.phase === 'aim' || T.phase === 'retreat')) T.walk = Math.max(0, WALK_BUDGET - Math.abs(act.x - T.ox));
    const limited = this.cfg.settings.turnTime > 0;
    switch (T.phase) {
      case 'wait': T.delay -= dt; if (T.delay <= 0) this.beginTurn(); break;
      case 'crate': T.delay -= dt; if ((T.delay <= 0 && !this.anyBusy()) || T.delay < -6) this.nextTurn(); break;
      // время хода 0 — без ограничения: ход длится до выстрела или пропуска
      case 'aim': if (limited) T.time -= dt; if (!act || !act.alive) this.endTurn(); else if (limited && T.time <= 0) { T.time = 0; this.endTurn(); } break;
      case 'use':
        if (T.weapon === 'jetpack' && limited) { T.time -= dt; if (T.time <= 0) { T.time = 0; if (act && act.st === 'jet') act.st = 'air'; } }
        if (!act || !act.alive) { this.usage = null; this.endTurn(); }
        break;
      case 'retreat': {
        // отступление заканчивается сразу, как всё успокоилось и игрок не двигается
        T.retreat -= dt; const c = this.ctrl, moving = c && (c.l || c.r || c.u || c.d);
        T.idle = !moving && act && act.st === 'stand' && !this.anyBusy() ? (T.idle || 0) + dt : 0;
        if (T.retreat <= 0 || !act || !act.alive || T.idle > 0.6) this.endTurn(); break;
      }
      case 'settle': T.delay -= dt; if ((T.delay <= 0 && !this.anyBusy()) || T.delay < -14) { T.phase = 'wait'; T.delay = 0; } break;
    }
  }
  endTurn() {
    const T = this.turn; if (T.phase === 'settle' || T.phase === 'over' || T.phase === 'wait' || T.phase === 'crate') return;
    T.phase = 'settle'; T.delay = 0.1; T.charge = -1; this.usage = null; this.ctrl = null;
    const a = this.active(); if (a && a.st === 'jet') a.st = 'air';
  }
  aliveTeams() { return this.teams.filter(t => this.soldiers.some(s => s.team === t.idx && s.alive)); }
  beginTurn() {
    const alive = this.aliveTeams();
    if (alive.length <= 1) { this.finish(alive[0] || null); return; }
    if (false && this.cfg.settings.crates && this.round > 0 && Math.random() < 0.35 && this.dropCrate()) { this.turn.phase = 'crate'; this.turn.delay = 0.6; return; }
    this.nextTurn();
  }
  dropCrate() {
    for (let k = 0; k < 25; k++) {
      const x = rand(140, this.W - 140); const y = this.terrain.findTop(Math.round(x), 0);
      if (y < this.waterY - 30) {
        const health = Math.random() < 0.4;
        const pool = WEAPONS.filter(w => w.ammo > 0 && w.id !== 'nuke' && this.teams[0].ammo[w.id] !== undefined);
        const wid = health || !pool.length ? null : pick(pool).id;
        this.spawn(new Crate(this, x, wid ? 'weapon' : 'health', wid)); this.emit({ t: 'crate', x: R1(x) });
        return true;
      }
    }
    return false;
  }
  nextTurn() {
    this.tidyTerrain();
    const T = this.turn; const alive = this.aliveTeams();
    if (alive.length <= 1) { this.finish(alive[0] || null); return; }
    let ti = T.team;
    for (let k = 0; k < this.teams.length; k++) { ti = (ti + 1) % this.teams.length; if (alive.includes(this.teams[ti])) break; }
    if (T.team < 0 || ti <= T.team) this.round++;
    const team = this.teams[ti]; let s = null;
    for (let k = 0; k < team.order.length; k++) {
      const o = this.soldierById(team.order[(team.next + k) % team.order.length]);
      if (o && o.alive) { s = o; team.next = (team.next + k + 1) % team.order.length; break; }
    }
    if (!s) { this.finish(null); return; }
    const sd = this.cfg.settings.sd;
    if (sd && this.round > sd) {
      this.waterY -= 16; this.emit({ t: 'water', y: this.waterY });
      if (!this.sdStarted) { this.sdStarted = true; this.emit({ t: 'msg', txt: 'ВНЕЗАПНАЯ СМЕРТЬ: вода поднимается!', c: '#4fc3ff', big: 1 }); }
    }
    const wind = this.cfg.settings.wind ? Math.round(rand(-1, 1) * MAX_WIND) : 0;
    Object.assign(T, { team: ti, sid: s.id, time: this.cfg.settings.turnTime, phase: 'aim', delay: 0, wind, weapon: this.canUse(team, team.lastW) ? team.lastW : this.fallbackWeapon(team), walk: WALK_BUDGET, ox: s.x, retreat: 0, shots: 0, target: null, charge: -1, rot: 0, spin: 0, round: this.round });
    this.ctrl = null; this.usage = null;
    this.emit({ t: 'turn', team: ti, sid: s.id });
  }
  finish(team) {
    this.turn.phase = 'over';
    this.over = { win: team ? team.idx : -1 };
    this.emit({ t: 'over', win: this.over.win, stats: this.teams.map(t => ({ dmg: t.dmg, kills: t.kills, alive: this.soldiers.filter(s => s.team === t.idx && s.alive).length })) });
  }
  /* ---------- сеть ---------- */
  startInfo() {
    return {
      mapId: this.map.id, settings: this.cfg.settings,
      teams: this.teams.map(t => ({ name: t.name, color: t.color, hat: t.hat })),
      soldiers: this.soldiers.map(s => [s.id, s.team, s.name, Math.round(s.x), Math.round(s.y), s.hp]),
    };
  }
  turnSnap() {
    const T = this.turn;
    return { tm: T.team, sid: T.sid, t: Math.round(T.time * 10), ph: T.phase, wd: T.wind, w: T.weapon, wk: Math.round(T.walk), ox: T.ox === undefined ? undefined : Math.round(T.ox), rt: Math.round(T.retreat * 10), sh: T.shots, ch: T.charge >= 0 ? Math.round(T.charge * 100) : -1, rd: this.round, ro: T.rot, sp: T.spin | 0, tg: T.target ? [Math.round(T.target.x), Math.round(T.target.y)] : 0 };
  }
  teamsSnap() { return this.teams.map(t => ({ a: t.ammo, d: t.dmg, k: t.kills })); }
  snapshot() {
    const S = [];
    for (const s of this.soldiers) S.push(s.snap());
    return { t: 's', ht: Math.round(this.time * 1000), S, E: this.entities.map(e => e.snap()), T: this.turnSnap() };
  }
}
