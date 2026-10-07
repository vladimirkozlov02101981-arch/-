'use strict';
/* Версия 36: РПГ строго по прямой, пули летят до попадания или края карты, город без дождя */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function world(solid = () => false) {
  const ctx = vm.createContext({ console, performance: { now: () => 0 } });
  for (const f of ['util.js', 'weapons.js', 'entities.js', 'arsenal.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  const api = vm.runInContext('({ FIRE, BallisticBullet })', ctx);
  const terrain = {
    isSolid: solid, materialAt: () => 1,
    segmentHit(x0, y0, x1, y1) { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let i = 1; i <= n; i++) { const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; if (solid(x, y)) return { t, x, y, material: 1 }; } return null; },
  };
  const g = { gravity: 640, turn: { wind: 120 }, terrain, W: 6400, H: 1800, waterY: 1700, entities: [], events: [], nextId: 1,
    emit(e) { this.events.push(e); }, spawn(e) { this.entities.push(e); }, carve() {}, splash() {}, damage() {}, explode() {}, soldierAt() { return null; }, markImpact() {} };
  return { api, g };
}

test('RPG rocket flies along the barrel in a straight line, no spiral and no loss of control', () => {
  const { api, g } = world(), s = { x: 300, y: 1200, aim: -0.12, face: 1, team: 0, alive: true, vx: 0, vy: 0 };
  api.FIRE.rpg(g, s, { aim: -0.12, pw: 1 });
  const e = g.entities[0], x0 = e.x, y0 = e.y, heads = [];
  for (let i = 0; i < 240 && !e.dead; i++) { e.update(g, 1 / 60); heads.push(Math.atan2(e.y - y0, e.x - x0)); }
  assert(heads.length > 200, 'rocket keeps flying');
  for (const h of heads.slice(5)) assert(Math.abs(h - -0.12) < 0.002, 'heading ' + h);
});

test('Bullets of every gun fly until they hit something or leave the map, not vanishing in mid-air', () => {
  for (const [range, kind] of [[650, 0], [900, 0], [1200, 0], [2600, 1]]) {
    const { api, g } = world((x, y) => x > 5000 && y > 1000), s = { x: 200, y: 1100, aim: 0, face: 1, team: 0, alive: true };
    const b = new api.BallisticBullet(g, s, -0.012, range, 10, 10, 4, kind);
    for (let i = 0; i < 600 && !b.dead; i++) b.update(g, 1 / 60);
    const hit = g.events.find(e => e.t === 'impact');
    assert(hit && hit.x > 5000, 'bullet with nominal range ' + range + ' reaches the far wall: ' + JSON.stringify(hit));
  }
});

test('City has no rain', () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', 'themes.js'), 'utf8') + '\n;this.T = THEMES;', ctx);
  assert.equal(ctx.T.city.weather, null); assert.notEqual(ctx.T.city.ambientSound, 'rain');
});
