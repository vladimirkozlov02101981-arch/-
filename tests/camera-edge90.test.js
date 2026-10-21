'use strict';
// Просьба 21.10: у края карты обзор стрелками доходит ровно до положения «край карты посередине экрана» (половина кадра —
// карта, половина — пропасть) и дальше не идёт; обычное слежение за бойцом — в прежних пределах (за краем не больше 250 ед.)
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(x) {
  const ctx = vm.createContext({ console, performance: { now: () => 0 } });
  for (const n of ['util', 'render']) vm.runInContext(fs.readFileSync(__dirname + '/../js/' + n + '.js', 'utf8'), ctx);
  const Camera = vm.runInContext('Camera', ctx);
  const sc = { W: 6400, H: 1800, waterY: 1600, simul: false, entities: [], soldiers: [{ id: 1, team: 0, x, y: 1000, alive: true, st: 'stand' }], turn: { team: 0, sid: 1, round: 1, phase: 'aim', shots: 0 }, terrain: { findTop: () => 1200 } };
  return { Camera, sc, fx: { shake: 0, focus: null } };
}

for (const [dir, edge] of [[-1, 0], [1, 6400]]) for (const [sw, sh, z] of [[1440, 900, 1], [1440, 900, 2], [1920, 1080, 1080 / 560], [390, 844, 1.5]])
  test(`Arrows put the ${dir < 0 ? 'left' : 'right'} map edge exactly at the screen centre (${sw}×${sh}, zoom ${z.toFixed(2)})`, () => {
    const hw = sw / 2 / z, sx = dir < 0 ? hw * 0.6 : 6400 - hw * 0.6;   // боец у края: ближе половины экрана
    const { Camera, sc, fx } = fixture(sx), cam = new Camera();
    Object.assign(cam, { inited: true, x: 3200, y: 942, z, tz: z, userZ: z, turnKey: '', manual: { x: 0, y: 0 } });   // новый ход: кадр сразу у бойца
    for (let i = 0; i < 60; i++) cam.update(1 / 60, sc, fx, sw, sh, null);
    const tracked = cam.x;
    // слежение без стрелок: за краем видно не больше 250 ед.
    const lo = Math.min(sc.W / 2, Math.max(0, hw - 250)), hi = Math.max(sc.W / 2, Math.min(sc.W, sc.W - hw + 250));
    assert(Math.abs(tracked - Math.min(Math.max(sx, lo), hi)) < 1e-9, 'слежение: ' + tracked);
    cam.manual.x = dir;
    let reached = -1;
    for (let i = 0; i < 600; i++) {
      cam.update(1 / 60, sc, fx, sw, sh, null);
      assert(dir < 0 ? cam.x >= edge : cam.x <= edge, 'обзор ушёл за край дальше середины экрана: ' + cam.x);
      if (reached < 0 && cam.x === edge) reached = i;
    }
    assert(reached >= 0, 'край карты не дошёл до середины экрана: ' + cam.x);
    assert.equal(cam.x, edge);
    const [px] = cam.toScreen(edge, 0, sw, sh); assert(Math.abs(px - sw / 2) < 1e-9, 'край не посередине экрана');
    // боец остаётся в кадре
    const [bx] = cam.toScreen(sx, 1000, sw, sh); assert(bx > 0 && bx < sw);
    // отпущенные стрелки: обзор стоит на месте; обратное нажатие сразу ведёт назад, без «отмотки» лишнего сдвига
    cam.manual.x = 0; for (let i = 0; i < 30; i++) cam.update(1 / 60, sc, fx, sw, sh, null); assert.equal(cam.x, edge);
    cam.manual.x = -dir; cam.update(1 / 60, sc, fx, sw, sh, null); assert(dir < 0 ? cam.x > edge : cam.x < edge, 'обратное нажатие не сдвинуло обзор');
  });

test('A soldier far from the edge stays in frame: arrows stop where the soldier would leave the screen', () => {
  const { Camera, sc, fx } = fixture(1500), cam = new Camera(), sw = 1440, sh = 900;
  Object.assign(cam, { inited: true, x: 1500, y: 942, z: 1, tz: 1, userZ: 1, turnKey: '0:1:1', manual: { x: -1, y: 0 } });
  for (let i = 0; i < 600; i++) cam.update(1 / 60, sc, fx, sw, sh, null);
  const [bx] = cam.toScreen(1500, 1000, sw, sh); assert(bx > 0 && bx < sw, 'боец ушёл из кадра'); assert(cam.x > 0);
});
