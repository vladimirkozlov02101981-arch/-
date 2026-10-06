'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.TERRITORY_TEST_SOURCE || path.join(__dirname, '..'), staged = path.join(__dirname, '..');
function game(swap, simul = false, firstTeam = 0) {
  const map = { id: 'fixture', theme: 'fixture', W: 6400, H: 1800, water: 1560, seed: 1, ladders: [] };
  class Terrain { constructor() { this.touches = []; } isSolid(x,y) { return y >= 100; } materialAt() { return 1; } }
  const ctx = vm.createContext({ console, performance: { now: () => 0 }, MAP_BY_ID: { fixture: map }, MAPS: [map], THEMES: { fixture: {} }, Terrain,
    rasterizeMap: () => ({ mask: [], mat: [] }), resolveProps: () => [] });
  for (const f of ['util', 'weapons', 'soldier', 'entities', 'game', 'remote']) {
    const local = path.join(staged, 'js', f + '.js'); vm.runInContext(fs.readFileSync(fs.existsSync(local) ? local : path.join(root, 'js', f + '.js'), 'utf8'), ctx);
  }
  const api = vm.runInContext('({Game,RemoteGame})', ctx);
  api.Game.prototype.spawnCandidates = () => Array.from({ length: 8 }, (_,i) => ({ x: i < 4 ? 400+i*100 : 4300+(i-4)*100, y: 100 }));
  const g = new api.Game({ mapId: 'fixture', settings: { swap, simul, firstTeam, perTeam: 3, hp: 100, turnTime: 0, wind: false, arsenal: 'all', walk: 'limited' }, teams: [{ name: 'A' },{ name: 'B' }] });
  return { g, ...api };
}

test('Ordinary battle starts with the separately resolved team on either physical side and shares round numbers', () => {
  for (const swap of [false,true]) for (const start of [0,1]) {
    const { g } = game(swap,false,start), turns = [];
    for (let i=0;i<12;i++) { g.nextTurn(); turns.push([g.turn.team,g.active().name,g.round]); g.endTurn(); }
    assert.deepEqual(turns, Array.from({ length:12 }, (_,i) => [i%2 ? 1-start : start,String((Math.floor(i/2)%3)+1),Math.floor(i/2)+1]));
    const first = g.soldiers.find(s => s.team === start); assert.equal(first.x < g.W*.44, Boolean(start === (swap ? 1 : 0)));
  }
});

test('Only a strict resolved integer firstTeam selects the second team; side cannot implicitly change initiative', () => {
  for (const value of [undefined,null,'random','1',-1,2,NaN,Infinity]) {
    const { g } = game(true,false,value);g.nextTurn();assert.equal(g.turn.team,0);
  }
  const {g}=game(false,false,1);g.nextTurn();assert.equal(g.turn.team,1);
});

test('The online guest follows the authoritative initiative independently of deployment and cannot reroll it', () => {
  for (const swap of [false,true]) for (const firstTeam of [0,1]) {
    const { g, RemoteGame } = game(swap,false,firstTeam); g.nextTurn();
    const remote = new RemoteGame({ mapId:'fixture',settings:g.cfg.settings,teams:g.cfg.teams,soldiers:g.soldiers.map(s=>[s.id,s.team,s.name,s.x,s.y,s.hp]) });
    g.time=1; remote.onSnap(g.snapshot()); assert.equal(remote.latestTurn.team,firstTeam); assert.equal(remote.latestTurn.round,1);
    assert.equal(remote.settings.firstTeam,firstTeam);assert.equal(remote.settings.swap,swap);
  }
});

test('Continuous lanes activate both own fighter 1 and keep independent rounds regardless of side or initiative', () => {
  for (const swap of [false,true]) for (const firstTeam of [0,1]) {
    const { g }=game(swap,true,firstTeam); for (let i=0;i<2;i++) g.inLane(i,()=>g.nextTurn());
    assert.deepEqual(g.lanes.map(l=>[l.turn.team,g.soldierById(l.turn.sid).name,l.turn.round]),[[0,'1',1],[1,'1',1]]);
    g.inLane(1,()=>{g.endTurn();g.nextTurn();}); assert.equal(g.lanes[0].turn.round,1); assert.equal(g.lanes[1].turn.round,2);
  }
});

test('Third-round weapon unlocking is symmetric for both teams under either initiative', () => {
  for(const firstTeam of [0,1]) {
    const {g}=game(false,false,firstTeam),seen=[];
    for(let i=0;i<6;i++){g.nextTurn();seen.push([g.turn.team,g.turn.round,g.canUse(g.teams[g.turn.team],'nuke')]);g.endTurn();}
    assert.deepEqual(seen,Array.from({length:6},(_,i)=>[i%2?1-firstTeam:firstTeam,Math.floor(i/2)+1,i>=4]));
  }
});
