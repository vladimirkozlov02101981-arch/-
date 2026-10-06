'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

// Staged Game/Remote files can run with the unchanged remaining project sources.
const localRoot = path.join(__dirname, '..');
const sourceRoot = process.env.TERRITORY_TEST_SOURCE || localRoot;
function fixture({ simul = false, count = 4, free = false } = {}) {
  const map = { id: 'fixture', theme: 'fixture', W: 6400, H: 1800, water: 1560, seed: 1, ladders: [] };
  class FlatTerrain {
    constructor() { this.touches = []; }
    isSolid(x, y) { return y >= 100; }
    materialAt() { return 1; }
  }
  const ctx = vm.createContext({ console, performance: { now: () => 0 },
    MAP_BY_ID: { fixture: map }, MAPS: [map], THEMES: { fixture: {} }, Terrain: FlatTerrain,
    rasterizeMap: () => ({ mask: [], mat: [] }), resolveProps: () => [] });
  for (const f of ['util.js', 'weapons.js', 'soldier.js', 'entities.js', 'game.js', 'remote.js']) {
    const staged = path.join(localRoot, 'js', f);
    vm.runInContext(fs.readFileSync(fs.existsSync(staged) ? staged : path.join(sourceRoot, 'js', f), 'utf8'), ctx, { filename: f });
  }
  const api = vm.runInContext('({ Game, RemoteGame, Soldier, WALK_BUDGET, walkOk })', ctx);
  api.Game.prototype.spawnCandidates = () => Array.from({ length: 40 }, (_, i) => ({ x: i < 20 ? 200 + i * 105 : 3700 + (i - 20) * 105, y: 100 }));
  const g = new api.Game({ mapId: 'fixture', settings: { perTeam: count, hp: 100, walk: free ? 'free' : 'limited', simul, turnTime: 90, arsenal: 'all', wind: false, sd: 0 }, teams: [{ name: 'A' }, { name: 'B' }] });
  if (simul) for (let i = 0; i < 2; i++) g.inLane(i, () => g.nextTurn()); else g.nextTurn();
  g.events = [];
  return { ...api, g, soldier(team, n) { return g.soldiers.find(s => s.team === team && s.name === String(n)); } };
}
function nextOwn(g, team = 0) {
  if (g.simul) return g.inLane(team, () => { g.endTurn(); g.nextTurn(); });
  g.endTurn(); g.nextTurn();
  while (g.turn.team !== team && !g.over) { g.endTurn(); g.nextTurn(); }
}
const plain = v => JSON.parse(JSON.stringify(v));

 test('Soldier command accepts only integer numbers 1..20, keeps stable names and rejects foreign/dead/gone targets', () => {
  const f = fixture({ count: 20 }), { g } = f;
  const before = plain(g.turn);
  for (const number of [0, 21, -1, 2.5, NaN, Infinity, '2', null, undefined, {}, true]) g.cmd(0, { c: 'soldier', number });
  assert.deepEqual(plain(g.turn), before);
  g.cmd(1, { c: 'soldier', number: 2 }); assert.deepEqual(plain(g.turn), before);
  f.soldier(0, 2).alive = false;
  f.soldier(0, 4).gone = true;
  g.cmd(0, { c: 'soldier', number: 2 }); g.cmd(0, { c: 'soldier', number: 4 });
  assert.equal(g.turn.sid, before.sid);
  g.cmd(0, { c: 'soldier', number: 3 }); assert.equal(g.turn.sid, f.soldier(0, 3).id);
  g.cmd(0, { c: 'soldier', number: 12 }); assert.equal(g.turn.sid, f.soldier(0, 12).id);
  g.cmd(0, { c: 'soldier', number: 20 }); assert.equal(g.turn.sid, f.soldier(0, 20).id);
  assert.equal(f.soldier(0, 3).name, '3'); assert.equal(f.soldier(0, 12).name, '12'); assert.equal(f.soldier(0, 20).name, '20');
  assert.deepEqual(plain(g.teams[0].usedSids), []);
 });

 test('Selection preserves the timer, round, weapon and ammunition, clears old control/targets and emits a camera turn', () => {
  const f = fixture(), { g } = f, old = g.active(), target = f.soldier(0, 3), T = g.turn;
  Object.assign(T, { time: 17.25, weapon: 'sniper', target: { x: 1, y: 2 }, look: [3, 4, 5] });
  g.ctrl = { r: true }; old.wpn = 'sniper';
  const round = g.round, laneRound = T.round, ammo = plain(g.teams[0].ammo);
  assert.equal(g.cmd(0, { c: 'soldier', number: 3 }), true);
  assert.equal(T.time, 17.25); assert.equal(g.round, round); assert.equal(T.round, laneRound); assert.equal(T.weapon, 'sniper');
  assert.deepEqual(plain(g.teams[0].ammo), ammo); assert.equal(g.ctrl, null);
  assert.equal(T.target, null); assert.equal(T.look, null); assert.equal(T.charge, -1);
  assert.equal(old.wpn, null); assert.equal(target.wpn, 'sniper');
  assert.deepEqual(plain(g.events), [{ t: 'turn', team: 0, sid: target.id }]);
  const emitted = g.events.length; g.cmd(0, { c: 'soldier', number: 3 }); assert.equal(g.events.length, emitted);
 });

 test('Retreat, burst shots, charging, own projectiles, active usage and flight prevent switching', () => {
  const blockers = [
    g => { g.turn.phase = 'retreat'; },
    g => { g.turn.weapon = 'revolver'; g.turn.shots = 1; },
    g => { g.turn.charge = 0; }, g => { g.turn.charge = .6; },
    g => { g.entities.push({ busy: true, team: 0, dead: false }); },
    g => { g.entities.push({ busy: true, team: -1, owner: { team: 0 }, dead: false }); },
    g => { g.usage = { update() {} }; },
    ...['air', 'fly', 'jet'].map(st => g => { g.active().st = st; }),
    g => { g.soldiers.find(s => s.team === 0 && s.name === '2').st = 'fly'; },
  ];
  for (const block of blockers) {
    const { g } = fixture(); block(g); const before = plain(g.turn), events = g.events.length;
    assert.equal(g.cmd(0, { c: 'soldier', number: 2 }), false);
    assert.deepEqual(plain(g.turn), before); assert.equal(g.events.length, events);
  }
  for (const projectile of [{ busy: true, team: 1 }, { busy: true, team: 0, dead: true }, { busy: false, team: 0 }]) {
    const f = fixture(); f.g.entities.push(projectile);
    assert.equal(f.g.cmd(0, { c: 'soldier', number: 2 }), true);
  }
 });

 test('Simultaneous selection affects only the issuing lane and enemy attacks/usage do not block it', () => {
  const f = fixture({ simul: true }), { g } = f, enemy = plain(g.lanes[1].turn), cur = g.cur;
  g.lanes[1].usage = { update() {} }; g.entities.push({ busy: true, team: 1 });
  assert.equal(g.cmd(0, { c: 'soldier', number: 2 }), true);
  assert.equal(g.cur, cur); assert.equal(g.lanes[0].turn.sid, f.soldier(0, 2).id);
  assert.deepEqual(plain(g.lanes[1].turn), enemy);
  assert.deepEqual(plain(g.events.at(-1)), { t: 'turn', team: 0, sid: f.soldier(0, 2).id, L: 0 });
  g.entities = []; g.lanes[1].usage = null;
  assert.equal(g.cmd(1, { c: 'soldier', number: 3 }), true);
  assert.equal(g.lanes[1].turn.sid, f.soldier(1, 3).id); assert.equal(g.lanes[0].turn.sid, f.soldier(0, 2).id);
 });

 test('A switched squad member may act once per cycle, circular automatic order skips used members and resets only after every survivor', () => {
  for (const simul of [false, true]) {
    const f = fixture({ simul }), { g } = f, chosen = [];
    g.cmd(0, { c: 'soldier', number: 3 });
    for (let i = 0; i < 4; i++) {
      chosen.push(g.active().name); const used = g.active().id;
      nextOwn(g);
      if (i < 3) {
        assert(g.teams[0].usedSids.includes(used));
        const before = g.turn.sid; assert.equal(g.cmd(0, { c: 'soldier', number: Number(chosen[0]) }), false); assert.equal(g.turn.sid, before);
      }
    }
    assert.deepEqual(chosen, ['3', '2', '4', '1']);
    assert.deepEqual(plain(g.teams[0].usedSids), []); assert.deepEqual(plain(g.turn.usedSids), []);
    assert.equal(new Set(chosen).size, 4);
  }
 });

 test('Without selection the original alternating teams and numbered circular order remain intact', () => {
  const { g } = fixture(); const order = [];
  for (let i = 0; i < 18; i++) { order.push([g.turn.team, g.active().name]); g.endTurn(); g.nextTurn(); }
  assert.deepEqual(order, Array.from({ length: 18 }, (_, i) => [i % 2, String((Math.floor(i / 2) % 4) + 1)]));
 });

 test('A death cannot leave the survivor cycle stuck and repeated endTurn does not double-consume a member', () => {
  const f = fixture({ count: 3 }), { g } = f;
  g.cmd(0, { c: 'soldier', number: 2 });
  f.soldier(0, 1).alive = false; f.soldier(0, 3).alive = false;
  const id = g.active().id; g.endTurn(); g.endTurn();
  assert.deepEqual(plain(g.teams[0].usedSids), [id]);
  g.nextTurn(); g.endTurn(); g.nextTurn();
  assert.equal(g.turn.sid, id); assert.deepEqual(plain(g.turn.usedSids), []); assert.equal(g.active().name, '2');
 });

 test('Switching away and back retains each fighter horizontal budget, including before its automatic turn', () => {
  const f = fixture({ simul: true }), { g } = f, first = g.active(), second = f.soldier(0, 2), origin = first.x, secondOrigin = second.x;
  first.x += 310; g.turnTick(0, first); assert.equal(g.turn.walk, 110);
  g.cmd(0, { c: 'soldier', number: 2 }); second.x += 140; g.turnTick(0, second);
  g.cmd(0, { c: 'soldier', number: 1 }); assert.equal(g.turn.ox, origin); assert.equal(g.turn.walk, 110);
  first.x = origin + f.WALK_BUDGET;
  for (let i = 0; i < 10; i++) first.update(g, 1 / 60, { r: true });
  assert.equal(first.x, origin + f.WALK_BUDGET);
  nextOwn(g); assert.equal(g.active(), second); assert.equal(g.turn.ox, secondOrigin); assert.equal(g.turn.walk, 280);
 });

 test('A fresh simultaneous cycle captures origins on first activation and free walk stays unlimited', () => {
  const f = fixture({ simul: true, count: 2 }), { g } = f;
  g.active().x += 150; nextOwn(g);
  const last = g.active(); last.x += 220; const newOrigin = last.x; nextOwn(g);
  assert.equal(g.teams[0].cycleOrigins[last.id], undefined);
  g.cmd(0, { c: 'soldier', number: Number(last.name) }); assert.equal(g.turn.ox, newOrigin); assert.equal(g.turn.walk, f.WALK_BUDGET);
  const free = fixture({ free: true }); free.g.active().x += 1200;
  free.g.cmd(0, { c: 'soldier', number: 2 }); free.g.cmd(0, { c: 'soldier', number: 1 });
  assert.equal(free.g.turn.walk, free.WALK_BUDGET); assert(free.walkOk(free.g, free.g.active(), free.g.active().x + 5000));
 });

 test('Network turns carry spent IDs by value, and remote input follows latest acknowledged SID before interpolation', () => {
  const f = fixture({ simul: true }), { g } = f;
  const spent = g.active().id; nextOwn(g); const snap = g.turnSnap();
  assert.deepEqual(plain(snap.us), [spent]); snap.us.push(999); assert.deepEqual(plain(g.turn.usedSids), [spent]);
  const r = new f.RemoteGame(g.startInfo());
  const decoded = r.decodeTurn(g.turnSnap()); assert.deepEqual(plain(decoded.usedSids), [spent]);
  const legacy = { ...g.turnSnap() }; delete legacy.us; assert.deepEqual(plain(r.decodeTurn(legacy).usedSids), []);
  r.viewLane = 0; r.turn = r.decodeTurn(g.turnSnap()); r.latestTurn = r.turn;
  const old = r.active(), before = r.turn.sid;
  g.cmd(0, { c: 'soldier', number: 3 });
  r.onSnap(g.snapshot());
  assert.notEqual(r.turn.sid, before); assert.notEqual(r.active(), old);
  assert.equal(r.active().id, f.soldier(0, 3).id);
  assert.equal(r.controlled().id, f.soldier(0, 3).id); assert.equal(r.latestTurn.sid, f.soldier(0, 3).id);
  assert.deepEqual(plain(r.latestTurn.usedSids), [spent]);
 });

 test('Manual ACK cuts immediately, old turn frames cannot revert it and ordered terrain events wait for interpolation', () => {
  const f = fixture({ simul: true }), { g } = f;
  const r = new f.RemoteGame(g.startInfo()); r.viewLane = 0;
  const first = g.snapshot(); first.ht = 100;
  first.V = [{ t: 'carve', x: 1 }, { t: 'turn', team: 0, sid: g.turn.sid }, { t: 'girder', x: 2 }];
  r.onSnap(first);
  const oldSid = g.turn.sid;
  g.cmd(0, { c: 'soldier', number: 2 });
  const ack = g.snapshot(); ack.ht = 200;
  ack.V = [{ t: 'tidy', x: 3 }, { t: 'turn', team: 0, sid: oldSid }, { t: 'turn', team: 0, sid: g.turn.sid }, { t: 'carve', x: 4 }];
  r.onSnap(ack); assert.equal(r.active().id, g.turn.sid);
  const handled = [], fx = { handle(ev) { handled.push(plain(ev)); } };
  assert.equal(handled.length, 0);
  r.clock = 100; r.update(0, fx);
  assert.equal(r.turn.sid, g.turn.sid); assert.equal(r.active().wpn, g.turn.weapon);
  assert.deepEqual(handled.map(e => e.t), ['carve', 'girder']);
  r.clock = 200; r.update(0, fx);
  assert.deepEqual(handled.map(e => e.t), ['carve', 'girder', 'tidy', 'turn', 'carve']);
  assert.equal(handled.find(e => e.t === 'turn').sid, g.turn.sid);
  const later = g.snapshot(); later.ht = 300;
  later.TL[0] = { ...later.TL[0], sid: oldSid, rd: later.TL[0].rd + 1 };
  later.V = [{ t: 'turn', team: 0, sid: oldSid }, { t: 'over', win: 0 }];
  r.onSnap(later); assert.equal(r.turn.sid, g.turn.sid);
  r.clock = 300; r.update(0, fx);
  assert.equal(r.turn.sid, oldSid); assert.deepEqual(handled.slice(-2).map(e => e.t), ['turn', 'over']);
 });

 test('Repeated manual ACKs retain the latest fighter through compacted old world events', () => {
  const f = fixture({ simul: true }), { g } = f;
  const r = new f.RemoteGame(g.startInfo()); r.viewLane = 0;
  r.onSnap({ ...g.snapshot(), ht: 0, V: [{ t: 'turn', team: 0, sid: g.turn.sid }] });
  g.cmd(0, { c: 'soldier', number: 2 }); r.onSnap({ ...g.snapshot(), ht: 100, V: [{ t: 'turn', team: 0, sid: g.turn.sid }] });
  const secondSid = g.turn.sid;
  g.cmd(0, { c: 'soldier', number: 3 }); r.onSnap({ ...g.snapshot(), ht: 200 });
  const latestSid = g.turn.sid;
  for (let i = 0; i < 92; i++) r.onSnap({ ...g.snapshot(), ht: 201 + i, V: [{ t: 'carve', x: i }, ...(i === 0 ? [{ t: 'turn', team: 1, sid: g.lanes[1].turn.sid }] : [])] });
  const events = [], fx = { handle(e) { events.push(plain(e)); } };
  r.clock = 200; r.update(0, fx); assert.equal(r.turn.sid, latestSid); assert.notEqual(r.turn.sid, secondSid);
  r.clock = 400; r.update(0, fx);
  assert.deepEqual(events.filter(e => e.t === 'carve').map(e => e.x), Array.from({ length: 92 }, (_, i) => i));
  assert.equal(events.filter(e => e.t === 'turn' && e.team === 1).length, 1);
  assert.equal(events.filter(e => e.t === 'turn' && e.team === 0 && e.sid !== latestSid).length, 0);
 });
