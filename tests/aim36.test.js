'use strict';
/* Версия 36: прицел без колебаний, ведение ствола во время очереди, выстрел без центровки камеры, обзор за бойцом со
   снайперкой, разнообразные ходы компьютера */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const GUN_Y_TEST = 24;

function fixture() {
  const context = vm.createContext({
    Sfx: { play() {}, chargeStop() {}, chargeStart() {}, chargeSet() {} },
    WEAPON: { sniper: { id: 'sniper', mode: 'instant' }, bazooka: { id: 'bazooka', mode: 'charge' }, uzi: { id: 'uzi', mode: 'instant' } },
    WEAPONS: [], SPIN_WEAPONS: new Set(), STEER_FIRE: new Set(['assault', 'uzi', 'minigun', 'flamer', 'acid', 'railgun', 'autocannon', 'salvo']),
    performance: { now: () => 0 },
  });
  for (const file of ['util.js', 'profile.js', 'input.js', 'render.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
  const { Input, LocalController, Camera } = vm.runInContext('({Input,LocalController,Camera})', context), sent = [];
  const ctl = new LocalController(c => sent.push(c)); ctl.myTeams = [0];
  const s = { id: 1, x: 100, y: 124, aim: -0.4, alive: true, st: 'stand' }, T = { round: 1, sid: 1, team: 0, phase: 'aim', weapon: 'bazooka', shots: 0 };
  const sc = { soldiers: [s], map: { ladders: [] }, teams: [{ ammo: {} }], W: 6400, H: 1800, waterY: 1750, turn: T, entities: [] };
  const cam = { z: 1, x: 100, y: 66, sx: 0, sy: 0, toWorld: (x, y) => [x, y] };
  cam.toScreen = (x, y, sw, sh) => [(x - cam.x) * cam.z + sw / 2, (y - cam.y) * cam.z + sh / 2];
  Input.mouse.x = 250; Input.mouse.y = 50;
  const tick = () => ctl.update(1 / 60, sc, cam, 800, 600, T);
  tick();
  return { Input, ctl, s, T, sc, cam, sent, tick, Camera };
}

test('No weapon sways while aiming: wounded arms and the sniper scope keep the barrel exactly on the aim', () => {
  for (const weapon of ['bazooka', 'sniper']) {
    const f = fixture(); f.s.wl = [0, 0, 3, 3, 0, 0]; f.T.weapon = weapon; f.tick();
    for (let i = 0; i < 90; i++) {
      if (i % 3 === 0) { f.Input.mouse.dx = 3; f.Input.mouse.dy = -2; f.Input.mouse.x += 3; f.Input.mouse.moved = true; }
      f.tick(); f.Input.endFrame();
      assert.equal(f.ctl.aim, f.ctl.base, weapon + ' frame ' + i);
    }
    assert.equal(f.ctl.swayAmp, 0); assert.equal(f.ctl.scopeSway, 0);
  }
});

test('During a burst the barrel follows the mouse up and down, but never turns around', () => {
  const f = fixture(); f.T.weapon = 'uzi'; f.Input.mouse.x = 300; f.Input.mouse.y = 100; f.Input.mouse.moved = true; f.tick(); f.Input.endFrame();
  f.T.phase = 'use'; f.T.shots = 1; f.s.aim = f.ctl.aim; f.tick();
  const start = f.ctl.aim;
  f.Input.mouse.x = 300; f.Input.mouse.y = 20; f.Input.mouse.moved = true; f.tick(); f.Input.endFrame();
  assert(f.ctl.aim < start - 0.05, 'mouse up raises the barrel during the burst');
  f.tick(); f.tick();   /* управление уходит в игру 30 раз в секунду */
  const ctrl = f.sent.filter(c => c.c === 'ctrl').pop(); assert(Math.abs(ctrl.aim - Math.round(f.ctl.aim * 1000) / 1000) < 1e-9, 'aim is sent to the game');
  f.Input.mouse.x = -400; f.Input.mouse.y = 100; f.Input.mouse.moved = true; f.tick(); f.Input.endFrame();
  assert(Math.cos(f.ctl.aim) > 0, 'the soldier keeps facing the same way');
  // клавиши A/D во время очереди не разворачивают бойца
  f.ctl.aimMode = 'keys'; f.Input.keys.KeyA = true; f.tick(); f.Input.keys = {};
  assert(Math.cos(f.ctl.aim) > 0);
  // клавиши прицела тоже ведут ствол
  const before = f.ctl.aim; f.Input.keys.KeyI = true; for (let i = 0; i < 20; i++) f.tick(); f.Input.keys = {};
  assert(f.ctl.aim < before - 0.2, 'aim keys steer during the burst');
});

test('The camera does not center before a shot when the whole soldier is already in frame, even after arrows', () => {
  const f = fixture(); f.cam.manualActive = true; f.cam.offsetX = 120; f.cam.offsetY = 0; f.cam.x = 220;   // обзор сдвинут стрелками, боец в кадре
  f.cam.homeOf = (a) => ({ x: a.x, y: a.y - 58 });
  assert.equal(f.ctl.bodyInView(f.cam, f.s, 800, 600), true);
  assert.equal(f.ctl.needsCenter(f.sc, f.cam, f.s, 800, 600), false);
  f.ctl.fireHere(f.sc, f.cam, f.s, 800, 600, { c: 'fire', aim: -0.3, pw: 0.5 });
  assert.equal(f.ctl.pendingShot, null); assert(f.sent.some(c => c.c === 'fire'));
  assert(f.cam.postHold && f.cam.postHold.x === 220, 'the moved frame stays after the shot');
  // боец за кадром — обзор сначала возвращается к нему
  f.cam.x = 900; assert.equal(f.ctl.bodyInView(f.cam, f.s, 800, 600), false); assert.equal(f.ctl.needsCenter(f.sc, f.cam, f.s, 800, 600), true);
});

test('A frame kept at the shot lasts until the soldier moves or the next turn starts', () => {
  const f = fixture(), cam = new f.Camera();
  cam.postHold = { x: 400, y: 300, k: 'ph', key: '1:1' };
  f.T.phase = 'retreat'; f.T.shots = 1;
  assert.equal(cam.postHoldTarget(f.sc, f.T), cam.postHold);
  f.s.st = 'walk'; assert.equal(cam.postHoldTarget(f.sc, f.T), null); assert.equal(cam.postHold, null);
  cam.postHold = { x: 400, y: 300, k: 'ph', key: '1:1' }; f.s.st = 'stand'; f.T.round = 2;
  assert.equal(cam.postHoldTarget(f.sc, f.T), null);
});

test('With the sniper in hand the lens walks with the soldier and the camera follows him', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick();
  const p0 = { ...f.ctl.scopePoint }; f.s.st = 'walk';
  for (let i = 0; i < 10; i++) { f.s.x += 2; f.tick(); }
  assert(Math.abs(f.ctl.scopePoint.x - (p0.x + 20)) < 1e-9 && Math.abs(f.ctl.scopePoint.y - p0.y) < 1e-9, 'lens keeps its offset from the walking soldier');
  // камера: в движении цель обзора — у бойца, линза остаётся в кадре
  const cam = new f.Camera(); Object.assign(cam, { inited: true, x: 1500, y: 300, z: 1, tz: 1, userZ: 1, turnKey: '0:1:1', edge: true,
    scopeFocus: { point: f.ctl.scopePoint, locked: true, visible: true } });
  for (let i = 0; i < 240; i++) cam.update(1 / 60, f.sc, { shake: 0, focus: null }, 800, 600, f.Input.mouse);
  const [sx, sy] = cam.toScreen(f.s.x, f.s.y - 20, 800, 600);
  assert(sx > 60 && sx < 740 && sy > 60 && sy < 540, 'walking soldier is followed: ' + [sx, sy]);
});

test('Computer varies its moves instead of always repeating the single best one', () => {
  const ctx = vm.createContext({ Math, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', 'util.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', 'ai.js'), 'utf8') + '\n;this.AI = AI;', ctx);
  const g = { teams: [{ ammo: {} }, { ammo: { railgun: 1, bazooka: -1, grenade: -1, sniper: 3 } }], round: 1 };
  const ai = new ctx.AI(g, 1, 'normal');
  const byW = new Map([['railgun', { w: 'railgun', score: 52 }], ['bazooka', { w: 'bazooka', score: 47 }], ['grenade', { w: 'grenade', score: 41 }], ['sniper', { w: 'sniper', score: 37 }], ['uzi', { w: 'uzi', score: 3 }]]);
  const search = { byW, best: byW.get('railgun') }, counts = {};
  for (let i = 0; i < 400; i++) { const c = ai.choose(search); counts[c.w] = (counts[c.w] || 0) + 1; }
  assert(Object.keys(counts).length >= 3, JSON.stringify(counts));
  assert(!counts.uzi, 'a poor move is never chosen');
  assert(counts.railgun < 300, 'the rare railgun is not the automatic opening move ' + JSON.stringify(counts));
  // тот же ход подряд — реже
  ai.recent = ['bazooka']; const again = {}; for (let i = 0; i < 400; i++) { const c = ai.choose(search); again[c.w] = (again[c.w] || 0) + 1; }
  assert((again.bazooka || 0) < (counts.bazooka || 0), 'repeating the previous weapon is less likely ' + JSON.stringify([counts, again]));
  // решающий ход (сильно лучше остальных) остаётся почти всегда
  const strong = new Map([['bazooka', { w: 'bazooka', score: 140 }], ['grenade', { w: 'grenade', score: 30 }]]); ai.recent = [];
  let wins = 0; for (let i = 0; i < 200; i++) if (ai.choose({ byW: strong, best: strong.get('bazooka') }).w === 'bazooka') wins++;
  assert(wins === 200, 'decisive move kept: ' + wins);
});

test('The camera predicts the real first hit of a dropping bullet, and a hit out of frame is centered exactly', () => {
  class Ground {
    constructor(top) { this.top = top; }
    isSolid(x, y) { return y >= this.top(x); }
    materialAt() { return 1; }
    segmentHit(x0, y0, x1, y1) {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let i = 1; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; if (this.isSolid(x, y)) return { t, x, y, material: 1 }; }
      return null;
    }
  }
  const ctx = vm.createContext({ console, performance: { now: () => 0 } });
  for (const f of ['util.js', 'weapons.js', 'entities.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  const api = vm.runInContext('({ predictShot, BallisticBullet, bullet })', ctx);
  // далёкий холм: прямая линия ствола проходит над его вершиной, а снижающаяся пуля попадает в склон
  const terrain = new Ground((x) => x > 2200 && x < 2400 ? 990 - (x - 2200) * 0.36 : 1000);
  const shooter = { x: 100, y: 1000, aim: -0.0262, alive: true, team: 0 };
  for (const [id, aim] of [['sniper', -0.0262], ['assault', -0.0275], ['magnum', -0.021]]) {
    const events = [], g = { gravity: 640, turn: { wind: 0 }, terrain, soldiers: [shooter], W: 6400, H: 1800, waterY: 1700, entities: [],
      emit(e) { events.push(e); }, carve() {}, splash() {}, damage() {}, spawn(e) { this.entities.push(e); }, nextId: 1,
      soldierAt() { return null; } };
    const p = api.predictShot(g, shooter, aim, id);
    const range = { sniper: 2600, assault: 1200, magnum: 1700 }[id], kind = id === 'assault' ? 0 : 1;
    const b = new api.BallisticBullet(g, shooter, aim, range, 10, 10, 4, kind);
    for (let i = 0; i < 80 && !b.dead; i++) b.update(g, 1 / 60);
    const hit = events.find(e => e.t === 'impact');
    if (hit) { assert(p, id + ' predicted no hit, real hit at ' + JSON.stringify(hit)); assert(Math.hypot(p.x - hit.x, p.y - hit.y) < 3, id + ' predicted ' + JSON.stringify(p) + ' real ' + JSON.stringify(hit)); }
    else assert.equal(p, null, id + ' predicted a hit that does not happen');
  }
  // первое настоящее попадание за кадром — обзор точно по центру
  const f = fixture(), cam = new f.Camera(); Object.assign(cam, { inited: true, x: 100, y: 66, z: 1, tz: 1, userZ: 1, turnKey: '0:1:1' });
  const fx = { shake: 0, focus: null, firstHit: { x: 2600, y: 900, n: 1, time: 0 } };
  f.T.phase = 'retreat'; f.T.shots = 1;
  for (let i = 0; i < 180; i++) cam.update(1 / 60, f.sc, fx, 800, 600, f.Input.mouse);
  assert(Math.abs(cam.x - 2600) < 1 && Math.abs(cam.y - 900) < 1, 'camera centered on the first hit: ' + [cam.x, cam.y]);
});
