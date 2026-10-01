'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');

// Exercise the actual simulation without loading graphics or a browser.
const source = ['util.js', 'terrain.js', 'entities.js', 'game.js']
  .map(file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8')).join('\n');
const sandbox = {};
vm.runInNewContext(source + '\nglobalThis.simulation = { Terrain, Game, BLAST };', sandbox);
const { Terrain, Game, BLAST } = sandbox.simulation;
const W = 200, H = 200, R = BLAST.rocket.R;

function terrain(material, wall = null) {
  const t = Object.create(Terrain.prototype);
  Object.assign(t, { W, H, mask: new Uint8Array(W * H), materials: new Uint8Array(W * H).fill(material),
    ctx: null, dctx: null, gctx: null, surface: null, version: 0, touches: [], scorch: [20, 10, 5] });
  if (wall) for (let y = 0; y < H; y++) t.mask.fill(1, y * W + wall.x, y * W + wall.x + wall.width);
  else t.mask.fill(1);
  return t;
}

function craterRadius(material) {
  const t = terrain(material); t.blastRays(100, 100, R);
  const removed = t.mask.reduce((count, solid) => count + (solid ? 0 : 1), 0);
  return Math.sqrt(removed / Math.PI);
}

test('Rocket craters retain a clear ground / masonry / concrete / steel strength gradient', () => {
  const radii = Object.fromEntries([[1, 'ground'], [2, 'rock'], [3, 'brick'], [9, 'basalt'], [5, 'concrete'], [6, 'metal']]
    .map(([id, name]) => [name, craterRadius(id)]));
  assert(radii.rock > 33 && radii.brick > 31 && radii.basalt > 29, JSON.stringify(radii));
  assert(radii.concrete > 23 && radii.metal > 14, JSON.stringify(radii));
  assert(radii.ground > radii.rock && radii.rock > radii.brick && radii.brick > radii.basalt);
  assert(radii.basalt > radii.concrete && radii.concrete > radii.metal);
  assert(radii.rock < radii.ground * .9 && radii.concrete < radii.rock * .8 && radii.metal < radii.concrete * .7,
    'Hard materials must not collapse as widely as soil: ' + JSON.stringify(radii));
});

test('One rocket makes a real opening through a 30px rock or brick wall', () => {
  for (const material of [2, 3]) {
    const t = terrain(material, { x: 90, width: 30 });
    assert(t.isSolid(119, 100)); t.carve(90, 100, R, false);
    for (let x = 90; x < 120; x++) assert(!t.isSolid(x, 100), 'Wall remains at material ' + material + ', x=' + x);
    assert(t.isSolid(119, 150), 'The same shot must leave distant parts of the wall intact');
    assert.equal(t.version, 1); assert.equal(t.touches.length, 1);
  }
});

test('Concrete loses substantial thickness but a 30px wall needs a second rocket', () => {
  const t = terrain(5, { x: 90, width: 30 }); t.carve(90, 100, R, false);
  let depth = 0; while (depth < 30 && !t.isSolid(90 + depth, 100)) depth++;
  assert(depth >= 23 && depth < 30, 'Expected a deep concrete crater, got ' + depth);
  assert(t.isSolid(119, 100), 'Concrete cover should survive one shot');
  t.carve(90, 100, R, false); assert(!t.isSolid(119, 100), 'Repeated hits must open the concrete wall');
});

test('Brittle crystal fractures deeply and a rocket opens a 30px crystal wall', () => {
  const radius = craterRadius(8);
  assert(radius > 30 && radius < craterRadius(2), 'Crystal must be destructible but retain a material-sized crater');
  const t = terrain(8, { x: 90, width: 30 }); t.carve(90, 100, R, false);
  for (let x = 90; x < 120; x++) assert(!t.isSolid(x, 100), 'Crystal wall did not open at x=' + x);
  assert(t.isSolid(119, 150), 'The blast must leave distant crystal wall sections intact');
});

test('A rocket cuts a 12px steel beam but cannot erase a 30px steel wall', () => {
  const beam = terrain(6, { x: 90, width: 12 }); beam.carve(90, 100, R, false);
  for (let x = 90; x < 102; x++) assert(!beam.isSolid(x, 100), 'Beam did not break at x=' + x);
  const wall = terrain(6, { x: 90, width: 30 }); wall.carve(90, 100, R, false);
  assert(wall.isSolid(119, 100), 'Thick steel must remain useful as cover');
  assert(beam.isSolid(101, 140), 'Beam sections far from the blast must survive');
});

test('Soil, wood and ice crater masks match the unchanged previous behavior', () => {
  // Recorded from the same 200x200 arena before the hard-material adjustment.
  const unchanged = [[1, '59a89ec9e0ad1b76fad09ae70dd00c8cda3dd5647e66b3bcfc09f031994b2887'],
    [4, '59a89ec9e0ad1b76fad09ae70dd00c8cda3dd5647e66b3bcfc09f031994b2887'],
    [7, 'd4a56844b34b74c273ae1481acbf0564db6c7e135664bd0fe05d5d32de0fcbf2']];
  for (const [material, hash] of unchanged) {
    const t = terrain(material); t.blastRays(100, 100, R);
    assert.equal(createHash('sha256').update(t.mask).digest('hex'), hash, 'Unchanged material ' + material);
  }
});

test('Intact thick steel stops the destruction wave before the room behind it', () => {
  const cover = terrain(6, { x: 100, width: 24 }); const hit = cover.blastRays(90, 100, R);
  const behind = B => B.reached[(100 - B.y0) * B.w + 125 - B.x0];
  assert(cover.isSolid(123, 100)); assert.equal(behind(hit), 0);
  const open = terrain(6); open.mask.fill(0);
  assert.equal(behind(open.blastRays(90, 100, R)), 1, 'This point is in blast range without cover');
});

test('A wall shields a soldier during the explosion that demolishes it', () => {
  function arena(covered) {
    const t = terrain(3, { x: 90, width: 30 }); if (!covered) t.mask.fill(0);
    const soldier = { x: 128, y: 100, hp: 100, alive: true, gone: false, vx: 0, vy: 0, st: 'stand',
      fly() { this.st = 'fly'; } };
    const game = Object.create(Game.prototype);
    Object.assign(game, { terrain: t, soldiers: [soldier], entities: [], events: [], pending: [] });
    return { game, t, soldier };
  }
  const open = arena(false); open.game.explode(90, 83, R, BLAST.rocket.D);
  const protectedArena = arena(true); protectedArena.game.explode(90, 83, R, BLAST.rocket.D);
  const firstDamage = 100 - protectedArena.soldier.hp;
  assert(!protectedArena.t.isSolid(119, 83), 'The protective wall should actually be demolished');
  assert(firstDamage < (100 - open.soldier.hp) * .5, 'Cover must be sampled before carving');
  const hpAfterFirst = protectedArena.soldier.hp;
  protectedArena.game.explode(90, 83, R, BLAST.rocket.D);
  assert(hpAfterFirst - protectedArena.soldier.hp > firstDamage * 2, 'A later shot should use the opened wall');
});

test('Host and guest repeat the same mixed-material destruction after mask transfer', () => {
  const host = terrain(1), guest = terrain(1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) host.materials[y * W + x] =
    x < 80 ? 1 : x < 100 ? 2 : x < 120 ? 3 : x < 140 ? 5 : 6;
  guest.mask = Terrain.decodeMask(host.encodeMask(), W, H); guest.materials.set(host.materials);
  for (const [x, y, r] of [[75, 100, R], [112, 96, BLAST.grenade.R], [136, 102, R]]) {
    host.carve(x, y, r, false); guest.carve(x, y, r, false);
    assert.equal(host.encodeMask(), guest.encodeMask());
    assert.equal(host.version, guest.version);
  }
});
