'use strict';
/* =========================================================
   Зеркало игры у гостя: получает снимки хоста, плавно
   интерполирует позиции и проигрывает события в нужный момент
   ========================================================= */
const NET_DELAY = 110; // мс буфера интерполяции

class RemoteGame {
  constructor(start) {
    const map = MAP_BY_ID[start.mapId] || MAPS[0]; this.map = map; this.theme = THEMES[map.theme];
    this.W = map.W; this.H = map.H; this.waterY = map.water; this.gravity = 640 * (this.theme.gravity || 1);
    this.raster = rasterizeMap(map);
    this.terrain = new Terrain(this.W, this.H, this.raster.mask);
    this.terrain.materials = this.raster.mat;
    this.props = resolveProps(this.terrain, map);
    this.settings = start.settings;
    this.teams = start.teams.map((t, i) => ({ idx: i, name: t.name, color: t.color, hat: t.hat, ammo: makeAmmo(start.settings.arsenal, start.settings.ammo), dmg: 0, kills: 0 }));
    this.info = new Map(); this.sView = new Map();
    for (const [id, team, name, x, y, hp] of start.soldiers) {
      this.info.set(id, { team, name, maxHp: hp });
      this.sView.set(id, { id, team, name, maxHp: hp, x, y, aim: team % 2 ? Math.PI + 0.5 : -0.5, face: team % 2 ? -1 : 1, hp, st: 'stand', rot: 0, wpn: null, alive: true, gone: false, thrust: false, hurt: 0 });
    }
    this.soldiers = [...this.sView.values()];
    this.entities = []; this.eView = new Map();
    this.time = 0; this.round = 0; this.over = null;
    this.turn = { team: -1, sid: 0, time: 0, phase: 'wait', wind: 0, weapon: 'bazooka', walk: WALK_BUDGET, retreat: 0, shots: 0, target: null, charge: -1, rot: 0, round: 0 };
    this.latestTurn = this.turn;
    this.buf = []; this.clock = null; this.lastRecv = performance.now();
  }
  buildVisual() { buildTerrainVisual(this.terrain, this.theme, this.map, this.raster, this.waterY); this.raster = null; }
  active() { return this.sView.get(this.turn.sid) || null; }
  decodeTurn(T) {
    return { team: T.tm, sid: T.sid, time: T.t / 10, phase: T.ph, wind: T.wd, weapon: T.w, walk: T.wk, ox: T.ox, retreat: T.rt / 10, shots: T.sh, charge: T.ch >= 0 ? T.ch / 100 : -1, rot: T.ro, spin: T.sp | 0, round: T.rd, target: T.tg ? { x: T.tg[0], y: T.tg[1] } : null };
  }
  onSnap(m) {
    this.lastRecv = performance.now();
    const S = new Map(), E = new Map();
    for (const a of m.S || []) {
      const fl = a[9];
      S.set(a[0], { x: a[1] / 10, y: a[2] / 10, aim: a[3] / 100, face: a[4], hp: a[5], st: ST[a[6]] || 'stand', rot: a[7] / 100, wpn: a[8] >= 0 && WEAPONS[a[8]] ? WEAPONS[a[8]].id : null, alive: !!(fl & 1), gone: !!(fl & 2), thrust: !!(fl & 4), hurt: (fl & 8) ? 0.2 : 0 });
    }
    for (const a of m.E || []) E.set(a[0], { id: a[0], k: KINDS[a[1]], x: a[2] / 10, y: a[3] / 10, a: a[4] / 100, f: a[5] / 10, s: a[6], team: a[7], v: a[8] || 0 });
    const turn = m.T ? this.decodeTurn(m.T) : null;
    if (turn) this.latestTurn = turn;
    if (m.TM) this.applyTeams(m.TM);
    this.buf.push({ ht: m.ht, S, E, T: turn, V: m.V || [], done: false });
    // Compact positions but retain ordered, unapplied world events. A hidden tab
    // must not lose craters, constructed girders or the end-of-match event.
    if (this.buf.length > 90) {
      const removed = this.buf.splice(0, this.buf.length - 90);
      const pending = removed.filter(f => !f.done).flatMap(f => f.V);
      this.buf[0].V = pending.concat(this.buf[0].V);
    }
  }
  applyTeams(TM) { TM.forEach((t, i) => { const tt = this.teams[i]; if (!tt) return; tt.ammo = t.a || tt.ammo; tt.dmg = t.d || 0; tt.kills = t.k || 0; }); }
  update(dt, fx) {
    if (!this.buf.length) return;
    const latest = this.buf[this.buf.length - 1];
    if (this.clock === null) this.clock = latest.ht - NET_DELAY;
    this.clock += dt * 1000;
    const target = latest.ht - NET_DELAY; const err = target - this.clock;
    if (Math.abs(err) > 700) this.clock = target; else this.clock += err * Math.min(1, dt * 2.5);
    this.time = this.clock / 1000;
    for (const f of this.buf) {
      if (f.done || f.ht > this.clock) continue;
      f.done = true;
      for (const ev of f.V) { try { fx.handle(ev, this, false); } catch (e) { console.warn(e); } }
      if (f.T) { this.turn = f.T; this.round = f.T.round; }
    }
    let a = null, b = null;
    for (let i = 0; i < this.buf.length; i++) { if (this.buf[i].ht <= this.clock) a = this.buf[i]; else { b = this.buf[i]; break; } }
    if (!a) a = this.buf[0]; if (!b) b = a;
    const t = b.ht > a.ht ? clamp((this.clock - a.ht) / (b.ht - a.ht), 0, 1) : 0;
    this.interp(a, b, t);
    while (this.buf.length > 2 && this.buf[1].ht <= this.clock && this.buf[0].done) this.buf.shift();
  }
  interp(a, b, t) {
    for (const [id, sb] of b.S) {
      const sa = a.S.get(id) || sb; const v = this.sView.get(id); if (!v) continue;
      v.x = lerp(sa.x, sb.x, t); v.y = lerp(sa.y, sb.y, t);
      v.aim = sa.aim + angNorm(sb.aim - sa.aim) * t; v.rot = sa.rot + angNorm(sb.rot - sa.rot) * t;
      const src = t < 0.5 ? sa : sb;
      v.face = src.face; v.st = src.st; v.wpn = src.wpn; v.thrust = src.thrust; v.hp = sb.hp;
      v.alive = src.alive; v.gone = sb.gone && t > 0.5 ? true : src.gone; if (src.hurt) v.hurt = 0.2;
    }
    const list = [];
    const seen = new Set();
    for (const [id, eb] of b.E) {
      const ea = a.E.get(id); let v = this.eView.get(id);
      if (!v) { v = Object.assign({}, eb); this.eView.set(id, v); }
      if (ea) { v.x = lerp(ea.x, eb.x, t); v.y = lerp(ea.y, eb.y, t); v.a = ea.a + angNorm(eb.a - ea.a) * t; v.f = lerp(ea.f, eb.f, t); }
      else { v.x = eb.x; v.y = eb.y; v.a = eb.a; v.f = eb.f; }
      v.k = eb.k; v.s = (t < 0.5 && ea) ? ea.s : eb.s; v.team = eb.team; v.v = eb.v;
      list.push(v); seen.add(id);
    }
    if (a !== b) for (const [id, ea] of a.E) if (!seen.has(id)) { const v = this.eView.get(id) || Object.assign({}, ea); Object.assign(v, ea); list.push(v); seen.add(id); }
    for (const id of this.eView.keys()) if (!seen.has(id)) this.eView.delete(id);
    this.entities = list;
  }
}
