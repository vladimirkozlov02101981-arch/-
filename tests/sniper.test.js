'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function fixture() {
  const context = vm.createContext({
    Sfx: { play() {}, chargeStop() {}, chargeStart() {}, chargeSet() {} },
    WEAPON: { sniper: { id: 'sniper', mode: 'instant' }, bazooka: { id: 'bazooka', mode: 'charge' } },
    WEAPONS: [], SPIN_WEAPONS: new Set(),
  });
  for (const file of ['util.js', 'input.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
  const { Input, LocalController } = vm.runInContext('({Input,LocalController})', context), sent = [];
  const ctl = new LocalController(c => sent.push(c)); ctl.myTeams = [0];
  const s = { id: 1, x: 100, y: 124, aim: -0.4, alive: true }, T = { round: 1, sid: 1, team: 0, phase: 'aim', weapon: 'bazooka', shots: 0 };
  const sc = { soldiers: [s], map: { ladders: [] }, teams: [{ ammo: {} }] }, cam = { toWorld: (x, y) => [x, y] };
  Input.mouse.x = 250; Input.mouse.y = 50;
  const tick = () => ctl.update(1 / 60, sc, cam, 800, 600, T);
  return { Input, ctl, s, T, sc, sent, tick };
}
function angle(actual, expected) { assert(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`); }

test('Selecting sniper opens the historical scope and immediately aims at the mouse', () => {
  const f = fixture(); f.ctl.aimMode = 'keys'; f.tick(); f.T.weapon = 'sniper'; f.tick();
  assert.equal(f.ctl.scopeOn, true); assert.equal(f.ctl.aimMode, 'mouse');
  angle(f.ctl.base, Math.atan2(-50, 150));
});

test('E hides only the optic: mouse control remains active and E never cycles weapons', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.pressed.KeyE = true; f.tick();
  assert.equal(f.ctl.scopeOn, false); assert.equal(f.Input.pressed.KeyE, false);
  f.Input.mouse.x = 20; f.Input.mouse.y = 40; f.Input.mouse.moved = true; f.tick();
  angle(f.ctl.base, Math.atan2(-60, -80)); assert.equal(f.sent.some(c => c.c === 'weapon'), false);
  assert.match(f.ctl.hint(f.sc, f.T), /Мышь.*ЛКМ.*F.*Shift.*показать/);
});

test('Left click after keyboard aiming fires at its current mouse position, including hidden scope', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.pressed.KeyE = true; f.tick();
  f.ctl.aimMode = 'keys'; f.Input.mouse.x = 170; f.Input.mouse.y = 170; f.Input.mouse.clicked[0] = true; f.tick();
  angle(f.ctl.base, Math.PI / 4); assert.equal(f.ctl.scopeOn, false);
  const shot = f.sent.find(c => c.c === 'fire'); assert(shot); angle(shot.aim, f.ctl.aim);
});

test('Scope is restored when sniper is selected again or the next turn starts; breath still limits steadiness', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.pressed.KeyE = true; f.tick();
  f.T.weapon = null; f.tick(); assert.equal(f.ctl.scopeOn, false);
  f.T.weapon = 'sniper'; f.tick(); assert.equal(f.ctl.scopeOn, true);
  f.Input.keys.ShiftLeft = true; f.tick(); assert(f.ctl.breath < 2.5);
  f.Input.keys = {}; f.Input.pressed.KeyE = true; f.tick(); assert.equal(f.ctl.scopeOn, false);
  f.T.round++; f.tick(); assert.equal(f.ctl.scopeOn, true); assert.equal(f.ctl.breath, 2.5);
  f.T.phase = 'retreat'; f.tick(); assert.equal(f.ctl.scopeOn, false);
});

test('Non-sniper keyboard and mouse aiming, and binocular click protection, keep their behavior', () => {
  const f = fixture(); f.Input.keys.ArrowUp = true; f.tick(); assert.equal(f.ctl.aimMode, 'keys'); assert.equal(f.ctl.scopeOn, false);
  const keyboardAngle = f.ctl.base; f.Input.keys = {}; f.Input.mouse.x = 10; f.Input.mouse.y = 200; f.tick(); angle(f.ctl.base, keyboardAngle);
  f.Input.mouse.moved = true; f.tick(); angle(f.ctl.base, Math.atan2(100, -90));
  f.T.weapon = 'sniper'; f.tick(); const sniperAngle = f.ctl.base; f.ctl.binoc = true;
  f.Input.mouse.x = 200; f.Input.mouse.y = 10; f.Input.mouse.clicked[0] = true; f.tick();
  angle(f.ctl.base, sniperAngle); assert.equal(f.sent.some(c => c.c === 'fire'), false);
});
