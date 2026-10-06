'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = process.env.TERRITORY_TEST_SOURCE || path.join(__dirname, '..');
function fixture({ legs = [3, 3], legacy = false, free = false, budget = 420, terrain } = {}) {
  const ctx = vm.createContext({ console, R1: x => Math.round(x * 10) / 10, WALK_BUDGET: 420 });
  for (const f of ['util', 'soldier']) vm.runInContext(fs.readFileSync(path.join(source, 'js', f+'.js'), 'utf8'), ctx, { filename: f+'.js' });
  const { Soldier, WALK_SPEED } = vm.runInContext('({ Soldier, WALK_SPEED })', ctx);
  const soldier = new Soldier(1, 0, '1', 400, 100, 100);
  soldier.wl[4] = legs[0]; soldier.wl[5] = legs[1];
  const g = { terrain: terrain || { isSolid: (x, y) => y >= 100 }, map: { ladders: [] },
    turn: legacy ? { walk: budget } : { ox: 400, walk: budget }, freeWalk: free, waterY: 1500, H: 1800,
    gravity: 640, events: [], emit(e) { this.events.push(e); }, splash() {}, damage() {} };
  return { g, soldier, WALK_SPEED, step: (dt, ctrl = { r: true }) => soldier.update(g, dt, ctrl) };
}

test('Actual Soldier.update keeps wounded walking pose continuously on subpixel frames at 30/60/120 Hz', () => {
  for (const hz of [30, 60, 120]) for (const legs of [[0,0],[1,0],[2,2],[3,0],[3,3]]) {
    const f = fixture({ legs, free: true }); let accumulated = 0, crossed = 0;
    for (let frame = 0; frame < hz * 3; frame++) {
      const oldX = f.soldier.x; f.step(1 / hz);
      accumulated += f.WALK_SPEED * f.soldier.legFactor() / hz;
      while (accumulated >= 1) { accumulated--; crossed++; }
      assert.equal(f.soldier.st, 'walk', JSON.stringify({ hz, legs, frame, dx: f.soldier.x-oldX }));
      assert.equal(f.soldier.x, 400 + crossed, 'integer movement distance remains at the original speed');
      assert.equal(f.soldier.y, 100); assert.equal(f.soldier.vx, 0); assert.equal(f.soldier.vy, 0);
    }
    assert.equal(f.g.events.filter(e => e.t === 'footstep').length, Math.floor(crossed / 22));
    assert.equal(f.soldier.footDistance || 0, crossed % 22);
  }
});

test('Release, both direction keys and null controls immediately stop and clear fractional carry', () => {
  for (const ctrl of [{}, { l: true, r: true }, null]) {
    const f = fixture(); f.step(1/60); assert.equal(f.soldier.st, 'walk'); assert(f.soldier.walkAcc > 0);
    f.step(1/60, ctrl); assert.equal(f.soldier.st, 'stand'); assert.equal(f.soldier.walkAcc, 0);
    const x = f.soldier.x; f.step(1/60, { l: true }); assert.equal(f.soldier.st, 'walk'); assert.equal(f.soldier.x, x);
  }
});

test('A solid wall stops immediately before the first integer step and when the last possible step reaches it', () => {
  const terrain = { isSolid: (x, y) => y >= 100 || x >= 411 && y >= 30 };
  const f = fixture({ terrain, free: true });
  for (let i = 0; i < 80; i++) { f.step(1/60); assert.equal(f.soldier.st, f.soldier.x < 406 ? 'walk' : 'stand'); }
  assert.equal(f.soldier.x, 406); assert.equal(f.soldier.y, 100);
  f.step(1/60, { l: true }); assert.equal(f.soldier.st, 'walk');
  const blocked = fixture({ terrain: { isSolid: (x,y) => y >= 100 || x >= 405 && y >= 30 } });
  blocked.step(1/120); assert.equal(blocked.soldier.st, 'stand'); assert.equal(blocked.soldier.x, 400);
});

test('Legacy exhausted budget and modern radius stop without flicker; retreat and free walking remain possible', () => {
  for (const legacy of [false, true]) {
    const f = fixture({ legacy, budget: 1 });
    if (!legacy) f.soldier.x = f.g.turn.ox + 420 - 1;
    const start = f.soldier.x;
    for (let i=0;i<20;i++) { f.step(1/60); assert.equal(f.soldier.st, f.soldier.x === start ? 'walk' : 'stand'); }
    assert.equal(f.soldier.x, start + 1);
    if (legacy) { assert.equal(f.g.turn.walk, 0); f.step(1/60,{l:true}); assert.equal(f.soldier.st,'stand'); }
    else { f.step(1/60,{l:true}); assert.equal(f.soldier.st,'walk'); }
  }
  const free = fixture({ free: true }); free.soldier.x += 1000; free.step(1/60); assert.equal(free.soldier.st, 'walk');
});

test('Walking still climbs terrain and transitions to air at a ledge; pose probing never moves the body early', () => {
  const stair = fixture({ free: true, terrain: { isSolid: (x,y) => y >= (x >= 406 ? 97 : 100) } });
  stair.step(1/120); assert.equal(stair.soldier.x,400); assert.equal(stair.soldier.y,100); assert.equal(stair.soldier.st,'walk');
  for (let i=0;i<50;i++) stair.step(1/60);
  assert(stair.soldier.x > 407); assert(stair.soldier.y < 100, 'the original stepping and landing physics still climb the raised ground');
  const ledge = fixture({ free: true, terrain: { isSolid: (x,y) => x < 408 && y >= 100 } });
  for (let i=0;i<80 && ledge.soldier.st !== 'air';i++) ledge.step(1/60);
  assert.equal(ledge.soldier.st,'air'); assert.equal(ledge.soldier.vx,45); assert(ledge.soldier.y>100);
});

test('Death hands the exact victim to Game.spawn so a causal grave stays part of the attack', () => {
  const f = fixture(); const calls = [];
  // Tomb creation remains synchronous; no new death timer or physics is introduced here.
  const ctx = vm.createContext({ console, Tomb: class Tomb { constructor(g,x,y,team) { Object.assign(this,{x,y,team}); } } });
  for (const n of ['util','soldier']) vm.runInContext(fs.readFileSync(path.join(source,'js',n+'.js'),'utf8'),ctx);
  const Soldier = vm.runInContext('Soldier',ctx); const s = new Soldier(2,1,'2',600,100,0);
  s.alive = false; s.st = 'dead'; s.settleTeams = 1;
  f.g.spawn = (e, origin) => calls.push({e,origin});
  for(let i=0;i<44;i++) s.update(f.g,1/60,null);
  assert.equal(s.gone,true); assert.equal(calls.length,1); assert.equal(calls[0].origin,s); assert.equal(calls[0].origin.settleTeams,1);
  assert.deepEqual({x:calls[0].e.x,y:calls[0].e.y,team:calls[0].e.team},{x:600,y:100,team:1});
});

test('Severed arm and leg sprites and fallback are masked when wound level is 3', () => {
  const rects = [];
  const mockCtx = {
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, closePath() {},
    fill() {}, stroke() {},
    fillRect(x, y, w, h) { rects.push({ x, y, w, h }); },
    drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    globalCompositeOperation: 'source-over'
  };
  const ctx = vm.createContext({
    console, Math,
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => mockCtx }) },
    window: {}
  });
  for (const f of ['util', 'themes', 'draw']) {
    vm.runInContext(fs.readFileSync(path.join(source, 'js', f + '.js'), 'utf8'), ctx);
  }
  ctx.SoldierArt = {
    CELL: 144, FOOT: [72, 126], MPP: 2.3 / 144, SHOULDER: [72.8, 38.5], K: 0.40,
    sheet: () => ({}), head: () => ({ x: 72, y: 30 }), ok: () => true
  };
  const s = { id: 1, x: 100, y: 100, alive: true, st: 'stand', face: 1, wl: [0, 0, 3, 0, 3, 0] };
  ctx.drawSoldierSprite(mockCtx, s, { color: '#f00', hat: 'helmet' }, 0, { walk: 0 });
  const legRect = rects.find(r => r.y === ctx.SoldierArt.FOOT[1] - 22);
  const armRect = rects.find(r => r.y === ctx.SoldierArt.SHOULDER[1] + 2);
  assert.ok(legRect, 'severed leg must be masked out on sprite canvas');
  assert.ok(armRect, 'severed arm must be masked out on sprite canvas');
});
