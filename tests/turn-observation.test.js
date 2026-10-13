'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = process.env.TERRITORY_TEST_SOURCE || path.join(__dirname, '..');
const staged = path.join(__dirname, '..');
function fixture(simul = false, count = 3) {
  const map = { id: 'fixture', theme: 'fixture', W: 6400, H: 1800, water: 1560, seed: 1, ladders: [] };
  class FlatTerrain {
    constructor() { this.touches = []; this.holes = []; }
    isSolid(x, y) { return y >= 100 && !this.holes.some(h => Math.hypot(x - h.x, y - h.y) < h.r); }
    materialAt() { return 1; }
    findTop() { return 100; }
    carve(x, y, r) { this.holes.push({ x, y, r }); }
    tidy() {}
  }
  const math = Object.create(Math); math.random = () => 0.5;
  const ctx = vm.createContext({ Math: math, console, performance: { now: () => 500 }, MAP_BY_ID: { fixture: map },
    MAPS: [map], THEMES: { fixture: {} }, Terrain: FlatTerrain, rasterizeMap: () => ({ mask: [], mat: [] }), resolveProps: () => [] });
  for (const name of ['util', 'weapons', 'soldier', 'entities', 'game', 'remote', 'ai']) {
    const local = path.join(staged, 'js', name + '.js');
    vm.runInContext(fs.readFileSync(fs.existsSync(local) ? local : path.join(source, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
  }
  const localCamera = path.join(staged, 'camera-prefix.js');
  let camera = fs.existsSync(localCamera) ? fs.readFileSync(localCamera, 'utf8') : fs.readFileSync(path.join(source, 'js/render.js'), 'utf8');
  camera = camera.split('/** яркий чёткий прицел выбора точки')[0]; vm.runInContext(camera, ctx);
  const api = vm.runInContext('({Game, RemoteGame, AI, Camera, WALK_BUDGET, RETREAT_TIME, walkOk})', ctx);
  api.Game.prototype.spawnCandidates = () => Array.from({ length: count * 2 }, (_, i) => ({ x: i < count ? 400 + i * 100 : 4300 + (i - count) * 100, y: 100 }));
  const g = new api.Game({ mapId: 'fixture', settings: { perTeam: count, hp: 100, walk: 'limited', simul, turnTime: 0, arsenal: 'all', wind: false, sd: 0 }, teams: [{ name: 'A' }, { name: 'B' }] });
  if (simul) for (let k = 0; k < 2; k++) g.inLane(k, () => g.nextTurn()); else g.nextTurn();
  g.events = [];
  return { ...api, g, ctx, first: g.active(), enemy: g.soldiers.find(s => s.team === 1), plain: v => JSON.parse(JSON.stringify(v)) };
}

test('The same retreat/settle timing waits for a struck enemy in continuous and alternating battle', () => {
  const duration = simul => {
    const f = fixture(simul), { g, first, enemy } = f, original = g.turn.sid;
    first.x = 600; enemy.x = 620; enemy.y = first.y;
    g.cmd(0, { c: 'weapon', id: 'bat' }); g.cmd(0, { c: 'fire', aim: -0.7, pw: 1 });
    assert.equal(g.turn.phase, 'retreat'); assert.equal(g.turn.retreat, f.RETREAT_TIME); assert.equal(enemy.st, 'fly');
    let seconds = 0;
    for (let i = 0; i < 1100 && g.turn.sid === original; i++) { g.step(1 / 60); seconds += 1 / 60; }
    assert.notEqual(g.turn.sid, original); assert(seconds > 0.85, 'enemy knockback/death is shown before the next member');
    return seconds;
  };
  const ordinary = duration(false), continuous = duration(true);
  assert(Math.abs(ordinary - continuous) <= 1 / 60 + 1e-8, JSON.stringify({ ordinary, continuous }));
});

test('An independent enemy jump/projectile cannot delay the own continuous lane; caused enemy reactions can', () => {
  const { g, enemy } = fixture(true);
  enemy.st = 'air'; g.entities.push({ id: 900, team: 1, busy: true });
  assert.equal(g.anyBusy(), false);
  g.markImpact(enemy, { team: 0 }); assert.equal(g.anyBusy(), true);
  enemy.gone = true; assert.equal(g.anyBusy(), false);
  g.markImpact(g.entities[0], { team: 0 }); assert.equal(g.anyBusy(), true);
  g.entities[0].busy = false; assert.equal(g.anyBusy(), false);
});

test('Damage and loss of support retain the attack cause until the enemy settles', () => {
  const { g, first, enemy } = fixture(true);
  g.damage(enemy, 1, first); enemy.st = 'fly'; assert.equal(g.anyBusy(), true);
  enemy.st = 'stand'; g.entities = []; g.step(1 / 60); assert.equal(enemy.settleTeams, 0);
  g.carve(enemy.x, enemy.y, 25, false); g.step(1 / 60); assert.equal(enemy.st, 'air'); assert.equal(g.anyBusy(), true);
});

test('An enemy attack detonating an explosive crate keeps the chain cause when pending explosions leave the entity update', () => {
  const { g, enemy, plain } = fixture(true);
  const x = enemy.x, y = enemy.y - 20;
  g.entities.push({ id: 901, k: 'crate', x, y, s: 1, team: -1, dead: false, push() {} });
  g.inLane(1, () => g.explode(x, y, 4, 0, { owner: enemy, knock: 0 }));
  assert.deepEqual(plain(g.pending), [[x, y, 'crate', 2]]);
  g.step(1 / 60);
  assert.equal(enemy.settleTeams, 2); assert.equal(g.anyBusy(), false);
  assert.equal(g.inLane(1, () => g.anyBusy()), true);
});

test('Wounded walking sprites keep the same whole-body transforms as healthy sprites at every step phase', () => {
  const { ctx } = fixture(false);
  ctx.SoldierArt = { K: 1, CELL: 256, FOOT: [120, 220], SHOULDER: [120, 100], MPP: 1,
    ok: () => true, sheet: () => ({}) };
  ctx.HATS = { helmet: {} };
  vm.runInContext(fs.readFileSync(path.join(source, 'js/draw.js'), 'utf8'), ctx);
  const result = vm.runInContext(`(() => {
    const s = { x: 50, y: 100, face: 1, st: 'walk', alive: true, hurt: 0, wpn: null, wl: [0,0,0,0,0,0] };
    const team = { color: '#99aabb', hat: 'helmet' };
    const calls = [];
    const c = new Proxy({}, { get(target, key) { return key === 'translate' ? (x,y) => calls.push([x,y]) : () => {}; }, set() { return true; } });
    const record = wounded => { calls.length = 0; s.wl = wounded ? [0,0,0,0,2,2] : [0,0,0,0,0,0];
      for (let k=0;k<48;k++) drawSoldier(c,s,team,.1,{walk:k*.25,blink:0}); return JSON.stringify(calls); };
    return record(false) === record(true);
  })()`, ctx);
  assert.equal(result, true);
});

test('A fighter displaced before first activation receives a fresh full budget; reselect retains spent movement', () => {
  const { g, WALK_BUDGET, walkOk } = fixture(true);
  const second = g.soldiers.find(s => s.team === 0 && s.name === '2');
  assert.equal(g.teams[0].cycleOrigins[second.id], undefined);
  second.x += WALK_BUDGET + 300;
  assert.equal(g.cmd(0, { c: 'soldier', number: 2 }), true);
  assert.equal(g.turn.ox, second.x); assert.equal(g.turn.walk, WALK_BUDGET); assert(walkOk(g, second, second.x + 20));
  const origin = second.x; second.x += 120;
  g.cmd(0, { c: 'soldier', number: 1 }); g.cmd(0, { c: 'soldier', number: 2 });
  assert.equal(g.turn.ox, origin); assert.equal(g.turn.walk, WALK_BUDGET - 120);
});

test('Automatic first activation and each alternating new turn use the current resting position', () => {
  for (const simul of [false, true]) {
    const { g, WALK_BUDGET } = fixture(simul);
    const next = g.soldiers.find(s => s.team === 0 && s.name === '2'); next.x += 700;
    g.endTurn(); g.nextTurn();
    if (!simul) { g.endTurn(); g.nextTurn(); }
    assert.equal(g.active(), next); assert.equal(g.turn.ox, next.x); assert.equal(g.turn.walk, WALK_BUDGET);
  }
  const { g, WALK_BUDGET } = fixture(false, 1); const first = g.active(); first.x += 310;
  g.endTurn(); g.nextTurn(); g.endTurn(); g.nextTurn();
  assert.equal(g.active(), first); assert.equal(g.turn.ox, first.x); assert.equal(g.turn.walk, WALK_BUDGET);
});

test('Preview commands are bounded live state and never commit a shot or target; new choice clears them', () => {
  const { g, plain } = fixture(true);
  g.cmd(0, { c: 'weapon', id: 'lightning' });
  const ammo = g.teams[0].ammo.lightning;
  g.cmd(1, { c: 'ctrl', tx: 2000, ty: 10 }); assert.equal(g.turn.preview, null);
  g.cmd(0, { c: 'ctrl', tx: 1e7, ty: -1e7 });
  assert.deepEqual(plain(g.turn.preview), { x: 6900, y: -1500 }); assert.equal(g.turn.target, null); assert.equal(g.turn.shots, 0); assert.equal(g.entities.length, 0); assert.equal(g.teams[0].ammo.lightning, ammo);
  assert.deepEqual(plain(g.turnSnap().pv), [6900, -1500]);
  g.cmd(0, { c: 'ctrl', tx: NaN, ty: Infinity }); assert.deepEqual(plain(g.turn.preview), { x: 6900, y: -1500 });
  g.cmd(0, { c: 'weapon', id: 'sniper' }); assert.equal(g.turn.preview, null);
  g.cmd(0, { c: 'ctrl', tx: 2200, ty: 70 }); g.cmd(0, { c: 'soldier', number: 2 }); assert.equal(g.turn.preview, null);
});

test('Guest interpolates enemy preview on the same timeline as the gun, without mutating latest ACK', () => {
  const { g, RemoteGame, plain } = fixture(false);
  g.endTurn(); g.nextTurn(); const turn = g.turn;
  const remote = new RemoteGame({ mapId: 'fixture', settings: g.cfg.settings, teams: g.cfg.teams, soldiers: g.soldiers.map(s => [s.id, s.team, s.name, s.x, s.y, s.hp]) });
  turn.weapon = 'nuke'; turn.preview = { x: 1000, y: 100 }; g.time = 1; remote.onSnap(g.snapshot());
  turn.preview = { x: 2000, y: 500 }; g.time = 1.1; remote.onSnap(g.snapshot());
  remote.clock = 1050; remote.update(0, { handle() {} });
  assert.deepEqual(plain(remote.turn.preview), { x: 1500, y: 300 });
  assert.deepEqual(plain(remote.latestTurn.preview), { x: 2000, y: 500 }); assert.equal(remote.turn.weapon, 'nuke');
});

test('AI shows moving target selection and a settled aim before all world-point weapons execute', () => {
  for (const weapon of ['nuke', 'lightning', 'airstrike', 'orbital', 'homing', 'teleport']) {
    const { g, AI, plain } = fixture(false);
    g.endTurn(); g.nextTurn(); g.round = 5; g.turn.round = 5;
    const ai = new AI(g, 1, 'normal'), s = g.active(); ai.L = { aim: 0, pw: 0 };
    ai.key = g.turn.round + ':' + g.turn.sid; ai.state = 'select'; ai.t = 0;
    ai.plan = { w: weapon, aim: s.aim, pw: 0.4, tx: 900, ty: 75 };
    const emitted = [], cmd = g.cmd.bind(g); g.cmd = (team, c) => { emitted.push(plain(c)); return cmd(team, c); };
    for (let i = 0; i < 420 && !emitted.some(c => c.c === 'fire'); i++) ai.update(1 / 60);
    const fire = emitted.findIndex(c => c.c === 'fire'); assert(fire > 0, weapon);
    const previews = emitted.slice(0, fire).filter(c => c.c === 'ctrl' && Number.isFinite(c.tx));
    assert(previews.length >= 40, weapon + ' has a visible aiming phase');
    assert(previews.some(c => Math.abs(c.tx - 900) > 30));
    const held = previews.filter(c => Math.abs(c.tx - 900) < 1e-7); assert(held.length >= 35, weapon + ' holds completed aim before firing');
  }
});

test('Alternating spectator camera follows live target smoothly before firing (the shooter stays in frame), while continuous camera ignores it', () => {
  const f = fixture(false), { g, Camera } = f;
  g.endTurn(); g.nextTurn(); const cam = new Camera(), fx = { focus: null, shake: 0 };
  cam.observeAim = true; cam.update(1 / 60, g, fx, 1280, 720, null);
  const home = cam.x; g.turn.weapon = 'nuke';
  let maxStep = 0, before = cam.x;
  for (let i = 0; i < 240; i++) { g.turn.preview = { x: g.active().x + (900 - g.active().x) * Math.min(1, i / 180), y: 80 }; cam.update(1 / 60, g, fx, 1280, 720, null); maxStep = Math.max(maxStep, Math.abs(cam.x - before)); before = cam.x; }
  // далёкая цель: обзор смещён к ней, но стреляющий остаётся в кадре (не меньше десятой части экрана от края)
  const vw = 1280 / cam.z; assert(cam.x < home - vw * 0.3, 'camera turns toward the live target'); assert(Math.abs(g.active().x - cam.x) <= vw * 0.4 + 1, 'the shooter stays in frame');
  assert(maxStep < 100, 'no teleport to the target while aiming'); assert.equal(g.entities.length, 0);
  const continuous = fixture(true), other = new Camera(); other.observeAim = true; other.update(1 / 60, continuous.g, fx, 1280, 720, null);
  const start = other.x; continuous.g.turn.preview = { x: 6200, y: 40 };
  for (let i = 0; i < 240; i++) other.update(1 / 60, continuous.g, fx, 1280, 720, null);
  assert(Math.abs(other.x - start) < 1, 'continuous lane has no enemy-preview tracking mode');
});

test('Consecutive shooters can request prefire frames with the same look nonce without losing the second frame', () => {
  const { g, Camera } = fixture(false), cam = new Camera(), fx = { focus: null, shake: 0 };
  g.turn.look = [5500, 100, 101]; cam.update(1 / 60, g, fx, 1280, 720, null); assert(cam.shot);
  g.endTurn(); g.nextTurn();
  g.turn.look = [700, 100, 101]; cam.update(1 / 60, g, fx, 1280, 720, null);
  assert(cam.shot, 'team/soldier/round is part of the look identity'); assert(cam.shot.x < 2000);
});
