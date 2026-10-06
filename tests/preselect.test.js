'use strict';
/* Версия 34: оружие на свой следующий ход выбирается в любой момент, в том числе во время хода соперника */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function game(simul = false) {
  const map = { id: 'fixture', theme: 'fixture', W: 6400, H: 1800, water: 1560, seed: 1, ladders: [] };
  class Terrain { constructor() { this.touches = []; } isSolid(x, y) { return y >= 100; } materialAt() { return 1; } }
  const ctx = vm.createContext({ console, performance: { now: () => 0 }, MAP_BY_ID: { fixture: map }, MAPS: [map], THEMES: { fixture: {} }, Terrain,
    rasterizeMap: () => ({ mask: [], mat: [] }), resolveProps: () => [] });
  for (const f of ['util', 'weapons', 'soldier', 'entities', 'game', 'remote']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'), ctx);
  const api = vm.runInContext('({Game,RemoteGame})', ctx);
  api.Game.prototype.spawnCandidates = () => Array.from({ length: 8 }, (_, i) => ({ x: i < 4 ? 400 + i * 100 : 4300 + (i - 4) * 100, y: 100 }));
  const g = new api.Game({ mapId: 'fixture', settings: { swap: false, simul, firstTeam: 0, perTeam: 2, hp: 100, turnTime: 0, wind: false, arsenal: 'all', walk: 'limited' }, teams: [{ name: 'A' }, { name: 'B' }] });
  return { g, ...api };
}

test('A weapon chosen during the opponent turn is in hand when the own turn starts, then the choice is consumed', () => {
  const { g } = game();
  g.nextTurn(); assert.equal(g.turn.team, 0);
  g.endTurn(); g.nextTurn(); assert.equal(g.turn.team, 1);
  g.cmd(0, { c: 'nextw', id: 'sniper' });   // ход команды 1, команда 0 выбирает заранее
  assert.equal(g.teams[0].nextW, 'sniper'); assert.notEqual(g.turn.weapon, 'sniper', 'the opponent turn is not affected');
  assert.equal(g.teamsSnap()[0].n, 'sniper', 'the choice travels to the guest with team data');
  g.endTurn(); g.nextTurn(); assert.equal(g.turn.team, 0); assert.equal(g.turn.weapon, 'sniper'); assert.equal(g.teams[0].nextW, null);
});

test('Unknown or unavailable weapons are rejected; null clears; an empty arsenal falls back as before', () => {
  const { g } = game();
  g.nextTurn(); g.cmd(1, { c: 'nextw', id: 'nonexistent' }); assert.equal(g.teams[1].nextW, undefined);
  g.teams[1].ammo.nuke = 0; g.cmd(1, { c: 'nextw', id: 'nuke' }); assert.equal(g.teams[1].nextW, undefined);
  g.cmd(1, { c: 'nextw', id: 'shotgun' }); assert.equal(g.teams[1].nextW, 'shotgun'); g.cmd(1, { c: 'nextw', id: null }); assert.equal(g.teams[1].nextW, null);
  g.cmd(1, { c: 'nextw', id: 'shotgun' }); g.teams[1].ammo.shotgun = 0; g.endTurn(); g.nextTurn();
  assert.equal(g.turn.team, 1); assert.notEqual(g.turn.weapon, 'shotgun', 'spent weapon is not forced into hand');
});

test('The guest sees its own advance choice through the team snapshot', () => {
  const { g, RemoteGame } = game();
  g.nextTurn(); g.cmd(1, { c: 'nextw', id: 'grenade' });
  const r = Object.create(RemoteGame.prototype); r.teams = [{ ammo: {} }, { ammo: {} }]; r.applyTeams(g.teamsSnap());
  assert.equal(r.teams[1].nextW, 'grenade'); assert.equal(r.teams[0].nextW, null);
});
