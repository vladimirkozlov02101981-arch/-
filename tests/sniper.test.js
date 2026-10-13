'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const GUN_Y_TEST = 24;   // высота ствола над стопой (js/util.js, GUN_Y)

function fixture() {
  const context = vm.createContext({
    Sfx: { play() {}, chargeStop() {}, chargeStart() {}, chargeSet() {} },
    WEAPON: { sniper: { id: 'sniper', mode: 'instant' }, bazooka: { id: 'bazooka', mode: 'charge' } },
    WEAPONS: [], SPIN_WEAPONS: new Set(), performance: { now: () => 0 },
  });
  for (const file of ['util.js', 'profile.js', 'input.js', 'render.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
  const { Input, LocalController, Camera, Keys } = vm.runInContext('({Input,LocalController,Camera,Keys})', context), sent = [];
  const ctl = new LocalController(c => sent.push(c)); ctl.myTeams = [0];
  const s = { id: 1, x: 100, y: 124, aim: -0.4, alive: true }, T = { round: 1, sid: 1, team: 0, phase: 'aim', weapon: 'bazooka', shots: 0 };
  const sc = { soldiers: [s], map: { ladders: [] }, teams: [{ ammo: {} }], W: 6400, H: 1800, waterY: 1750, turn: T, entities: [] }, cam = { z: 1, toWorld: (x, y) => [x, y] };
  Input.mouse.x = 250; Input.mouse.y = 50;
  const tick = () => ctl.update(1 / 60, sc, cam, 800, 600, T);
  // ход уже начался (с базукой): дальше снайперку выбирают в ходе — оптика открывается у мыши.
  // В первом кадре нового хода оптика стоит в исходной позиции у бойца (отдельный тест ниже)
  if (!fixture.fresh) tick();
  return { Input, ctl, s, T, sc, cam, sent, tick, Camera, Keys };
}
function angle(actual, expected) { assert(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`); }

test('A new turn always starts the sniper scope on the barrel line at the edge of the soldier frame, never at a stale far point', () => {
  fixture.fresh = true; const f = fixture(); fixture.fresh = false;
  f.T.weapon = 'sniper'; f.Input.mouse.x = 5000; f.Input.mouse.y = 50; f.tick();
  const p = f.ctl.scopePoint, gx = f.s.x, gy = f.s.y - GUN_Y_TEST, pad = Math.round(600 * 0.16) + 16;
  angle(Math.atan2(p.y - gy, p.x - gx), f.s.aim);
  // кадр у бойца 800×600 (z = 1): вся линза в кадре, у его края по стволу
  assert(Math.abs(p.x - f.s.x) <= 400 - pad + 1e-6 && Math.abs(p.y - (f.s.y - 20)) <= 300 - Math.min(300, pad + 40) + 1e-6, 'scope ' + JSON.stringify(p) + ' is out of the soldier frame');
  assert(Math.abs(p.x - f.s.x) > 400 - pad - 1 || Math.abs(p.y - (f.s.y - 20)) > 300 - Math.min(300, pad + 40) - 1, 'scope ' + JSON.stringify(p) + ' is not at the frame edge');
  // следующий ход того же бойца с далёкой прошлой точкой — снова в кадре у бойца
  f.ctl.scopePoint.x = 6000; f.T.round++; f.tick(); assert(Math.abs(f.ctl.scopePoint.x - f.s.x) <= 400 && Math.abs(f.ctl.scopePoint.y - f.s.y) <= 320);
});
test('Selecting the sniper during a turn puts the scope on the current barrel line at the screen edge, not under the cursor', () => {
  const f = fixture(); f.ctl.aimMode = 'keys'; f.ctl.base = 0.3; f.tick(); const base = f.ctl.base;
  f.cam.x = 100; f.cam.y = 104; f.cam.tz = 1; f.cam.sx = f.cam.sy = 0; f.Input.mouse.x = 700; f.Input.mouse.y = 40;
  f.T.weapon = 'sniper'; f.tick();
  const p = f.ctl.scopePoint; angle(Math.atan2(p.y - (f.s.y - GUN_Y_TEST), p.x - f.s.x), base); angle(f.ctl.base, base);
  const pad = Math.round(600 * 0.16) + 16; assert(Math.abs((p.x - 100) - (400 - pad)) < 1e-6 || Math.abs((p.y - 104) - (300 - pad)) < 1e-6, 'scope ' + JSON.stringify(p) + ' is not at the edge');
});

test('Selecting sniper opens the historical scope and immediately aims at the mouse', () => {
  const f = fixture(); f.ctl.aimMode = 'keys'; f.tick(); f.T.weapon = 'sniper'; f.tick();
  assert.equal(f.ctl.scopeOn, true); assert.equal(f.ctl.aimMode, 'mouse');
  angle(f.ctl.base, Math.atan2(-50, 150));
});

test('Ctrl hides only the optic: mouse control remains active and Ctrl never cycles weapons', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); const p0 = { ...f.ctl.scopePoint }; f.Input.pressed.ControlLeft = true; f.tick();
  assert.equal(f.ctl.scopeOn, false); assert.equal(f.Input.pressed.ControlLeft, false);
  f.Input.mouse.x = 20; f.Input.mouse.y = 40; f.Input.mouse.dx = -230; f.Input.mouse.dy = -10; f.Input.mouse.moved = true; f.tick();
  angle(f.ctl.base, Math.atan2(p0.y - 10 - (f.s.y - GUN_Y_TEST), Math.max(0, p0.x - 230) - f.s.x));   // точка не уходит за край карты assert.equal(f.sent.some(c => c.c === 'weapon'), false);
  assert.match(f.ctl.hint(f.sc, f.T), /по всей карте.*ЛКМ.*показать/);
});

test('Left click after keyboard aiming fires at its current mouse position, including hidden scope', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.pressed.ControlLeft = true; f.tick();
  f.ctl.aimMode = 'keys'; f.Input.mouse.x = 170; f.Input.mouse.y = 170; f.Input.mouse.clicked[0] = true; f.tick();
  angle(f.ctl.base, Math.PI / 4); assert.equal(f.ctl.scopeOn, false);
  const shot = f.sent.find(c => c.c === 'fire'); assert(shot); angle(shot.aim, f.ctl.aim);
});

test('Scope is restored when sniper is selected again or the next turn starts; breath still limits steadiness', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.pressed.ControlLeft = true; f.tick();
  f.T.weapon = null; f.tick(); assert.equal(f.ctl.scopeOn, false);
  f.T.weapon = 'sniper'; f.tick(); assert.equal(f.ctl.scopeOn, true);
  f.Input.keys.ShiftLeft = true; f.tick(); assert(f.ctl.breath < 2.5);
  f.Input.keys = {}; f.Input.pressed.ControlLeft = true; f.tick(); assert.equal(f.ctl.scopeOn, false);
  f.T.round++; f.tick(); assert.equal(f.ctl.scopeOn, true); assert.equal(f.ctl.breath, 2.5);
  f.T.phase = 'retreat'; f.tick(); assert.equal(f.ctl.scopeOn, false);
});

test('Non-sniper keyboard and mouse aiming, and binocular click protection, keep their behavior', () => {
  const f = fixture(); f.Input.keys.KeyI = true; f.tick(); assert.equal(f.ctl.aimMode, 'keys'); assert.equal(f.ctl.scopeOn, false);
  const keyboardAngle = f.ctl.base; f.Input.keys = {}; f.Input.mouse.x = 10; f.Input.mouse.y = 200; f.tick(); angle(f.ctl.base, keyboardAngle);
  f.Input.mouse.moved = true; f.tick(); angle(f.ctl.base, Math.atan2(100, -90));
  f.T.weapon = 'sniper'; f.tick(); const sniperAngle = f.ctl.base; f.ctl.binoc = true;
  f.Input.mouse.x = 200; f.Input.mouse.y = 10; f.Input.mouse.clicked[0] = true; f.tick();
  angle(f.ctl.base, sniperAngle); assert.equal(f.sent.some(c => c.c === 'fire'), false);
});


test('Locked sniper retains all relative motion beyond the screen and reaches every map boundary', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.locked = true; const p0 = { ...f.ctl.scopePoint };
  const move = (dx, dy) => { f.Input.mouse.dx = dx; f.Input.mouse.dy = dy; f.Input.mouse.moved = true; f.tick(); f.Input.endFrame(); };
  move(5000, 1000); assert.equal(f.ctl.mouseW.x, Math.min(6399, p0.x + 5000)); assert.equal(f.ctl.mouseW.y, Math.min(1799, p0.y + 1000));
  move(10000, 10000); assert.equal(f.ctl.mouseW.x, 6399); assert.equal(f.ctl.mouseW.y, 1799);
  move(-20000, -20000); assert.equal(f.ctl.mouseW.x, 0); assert.equal(f.ctl.mouseW.y, -900);
  move(6000, 2200); assert.equal(f.ctl.mouseW.x, 6000); assert.equal(f.ctl.mouseW.y, 1300);
});

test('Stationary scope keeps its world target when the camera moves or zooms and settles completely', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.locked = true; f.s.wl = [0, 0, 3, 3];
  f.Input.mouse.dx = 5200; f.Input.mouse.dy = 500; f.Input.mouse.moved = true; f.tick();
  const point = { ...f.ctl.scopePoint }, range = Math.hypot(point.x - f.s.x, point.y - (f.s.y - 24));
  assert(Math.abs(f.ctl.aim - f.ctl.base) * range <= 1.5 + 1e-8);
  f.Input.endFrame(); f.cam.z = 6; f.cam.toWorld = (x, y) => [x + 3300, y + 900];
  for (let i = 0; i < 30; i++) f.tick();
  assert.deepEqual({ ...f.ctl.scopePoint }, point); angle(f.ctl.aim, f.ctl.base); assert.equal(f.ctl.swayAmp, 0);
  f.Input.keys.ShiftLeft = true; f.ctl.breath = 0;
  for (let i = 0; i < 30; i++) f.tick();
  angle(f.ctl.aim, f.ctl.base);
});

test('Scope sensitivity follows zoom and binocular movement preserves the selected world target', () => {
  const f = fixture(); f.T.weapon = 'sniper'; f.tick(); f.Input.locked = true; f.cam.z = 4; const p0 = { ...f.ctl.scopePoint };
  f.Input.mouse.dx = 120; f.Input.mouse.dy = -40; f.Input.mouse.moved = true; f.tick(); f.Input.endFrame();
  assert(Math.abs(f.ctl.scopePoint.x - (p0.x + 30)) < 1e-9); assert(Math.abs(f.ctl.scopePoint.y - (p0.y - 10)) < 1e-9);
  const point = { ...f.ctl.scopePoint }; f.ctl.binoc = true;
  f.Input.mouse.dx = 2000; f.Input.mouse.dy = 3000; f.Input.mouse.moved = true; f.tick(); f.Input.endFrame();
  assert.deepEqual({ ...f.ctl.scopePoint }, point);
  f.ctl.binoc = false; f.tick(); assert.deepEqual({ ...f.ctl.scopePoint }, point);
});

test('Optic camera keeps the whole historical lens in view at every map corner without idle drift', () => {
  const f = fixture(), sw = 800, sh = 600, pad = Math.round(Math.min(sw, sh) * 0.16) + 16;
  for (const z of [0.86, 2, 4.28]) for (const [x, y] of [[0, -900], [6399, -900], [0, 1799], [6399, 1799]]) {
    const cam = new f.Camera(), point = { x, y }; Object.assign(cam, { inited: true, x: 3200, y: 600, z, tz: z, userZ: z, turnKey: '0:1:1', scopeFocus: { point, locked: true, visible: true } });
    cam.update(1 / 60, f.sc, { shake: 0, focus: null }, sw, sh, f.Input.mouse);
    const screen = cam.toScreen(x, y, sw, sh);
    assert(screen[0] >= pad - 1e-7 && screen[0] <= sw - pad + 1e-7, 'horizontal lens clipping: ' + screen);
    assert(screen[1] >= pad - 1e-7 && screen[1] <= sh - pad + 1e-7, 'vertical lens clipping: ' + screen);
    const pos = [cam.x, cam.y]; for (let i = 0; i < 30; i++) cam.update(1 / 60, f.sc, { shake: 0, focus: null }, sw, sh, f.Input.mouse);
    assert(Math.hypot(cam.x - pos[0], cam.y - pos[1]) < 1e-8); assert.deepEqual(point, { x, y });
  }
});

test('Scope zoom anchors its world point and live hints reflect remapped keys', () => {
  const f = fixture(), cam = new f.Camera(), p = { x: 2300, y: 500 };
  Object.assign(cam, { x: 2000, y: 400, z: 1, tz: 1, userZ: 1, scopeFocus: { point: p, locked: true, visible: true } });
  const before = cam.toScreen(p.x, p.y, 800, 600); cam.zoomAt(2, 10, 10, 800, 600);
  assert.deepEqual(cam.toScreen(p.x, p.y, 800, 600), before); assert.deepEqual(p, { x: 2300, y: 500 });
  f.T.weapon = 'sniper'; f.tick(); f.Keys.set({ fire: ['KeyX'], optic: ['ControlLeft', 'ControlRight'], precise: ['KeyZ'] });
  const hint = f.ctl.hint(f.sc, f.T); assert.match(hint, /ЛКМ или X/); assert.match(hint, /Z —/); assert.match(hint, /Ctrl.*—/);
});


test('Zoom preserves directional weapon aim until a real mouse adjustment', () => {
  const f = fixture(); f.tick(); const base = f.ctl.base, point = { ...f.ctl.aimPoint };
  for (const z of [0.65, 1.3, 4.2, 1]) {
    f.cam.z = z; f.cam.toWorld = (x, y) => [(x - 400) / z + 2100, (y - 300) / z + 700]; f.tick();
    angle(f.ctl.base, base); assert.deepEqual({ ...f.ctl.aimPoint }, point);
  }
  f.Input.mouse.clicked[0] = true; f.tick(); angle(f.ctl.base, base); f.Input.endFrame();
  f.Input.mouse.x += 17; f.Input.mouse.moved = true; f.tick(); assert.notEqual(f.ctl.base, base);
});
