'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.TERRITORY_TEST_SOURCE || path.join(__dirname,'..'), staged = path.join(__dirname,'..');
function fixture(simul=false) {
  const map={id:'fixture',theme:'fixture',W:6400,H:1800,water:1560,seed:1,ladders:[]};
  class Terrain {
    constructor(){this.touches=[];}
    isSolid(x,y){return y>=100;}
    materialAt(){return 1;}
    normal(){return {x:0,y:-1};}
    normalAt(){return {x:0,y:-1};}
    findTop(){return 100;}
    carve(){}
    tidy(){}
  }
  const ctx=vm.createContext({console,performance:{now:()=>0},MAP_BY_ID:{fixture:map},MAPS:[map],THEMES:{fixture:{}},Terrain,
    rasterizeMap:()=>({mask:[],mat:[]}),resolveProps:()=>[]});
  for(const name of ['util','weapons','soldier','entities','game']) {
    const local=path.join(staged,'js',name+'.js'); vm.runInContext(fs.readFileSync(fs.existsSync(local)?local:path.join(root,'js',name+'.js'),'utf8'),ctx);
  }
  const api=vm.runInContext('({Game,Tomb,Fire,BlackHole,TURN_QUIET_TIME})',ctx);
  api.Game.prototype.spawnCandidates=()=>Array.from({length:6},(_,i)=>({x:i<3?400+i*110:4300+(i-3)*110,y:100}));
  const g=new api.Game({mapId:'fixture',settings:{simul,firstTeam:0,perTeam:3,hp:100,turnTime:0,wind:false,arsenal:'all',walk:'limited'},teams:[{name:'A'},{name:'B'}]});
  if(simul)for(let i=0;i<2;i++)g.inLane(i,()=>g.nextTurn());else g.nextTurn();
  g.events=[];
  return {...api,g,dt:1/60,tick(n=1){for(let i=0;i<n;i++)g.step(1/60);}};
}

test('A long unfinished attack cannot advance after the old 14 second emergency cutoff',()=>{
  for(const simul of [false,true]) {
    const {g,tick}=fixture(simul), sid=g.turn.sid;
    const projectile={id:901,k:'rocket',team:0,busy:true,dead:false,update(){}};g.spawn(projectile);g.endTurn();
    tick(2100);assert.equal(g.turn.sid,sid);assert.equal(g.turn.phase,'settle');assert.equal(g.turn.quiet,0);
    projectile.busy=false;tick(29);assert.equal(g.turn.phase,'settle');assert.equal(g.turn.sid,sid);
    tick();assert.equal(g.turn.phase,'wait');assert.equal(g.turn.sid,sid);
    tick();assert.notEqual(g.turn.sid,sid);assert.equal(g.turn.phase,'aim');
  }
});

test('Every new attack consequence resets the full uninterrupted half-second quiet period',()=>{
  for(const simul of [false,true]) {
    const {g,tick}=fixture(simul),sid=g.turn.sid;g.endTurn();tick(20);assert(g.turn.quiet>.3);
    const delayed={id:902,k:'bomblet',team:0,busy:true,dead:false,update(){}};g.spawn(delayed);tick();assert.equal(g.turn.quiet,0);
    delayed.busy=false;tick(29);assert.equal(g.turn.phase,'settle');assert.equal(g.turn.sid,sid);
    tick(2);assert.equal(g.turn.phase,'aim');assert.notEqual(g.turn.sid,sid);
  }
});

test('An armed quiet mine or an already dead projectile does not hold the turn indefinitely',()=>{
  const {g,tick}=fixture(),sid=g.turn.sid;
  g.spawn({id:903,k:'mine',team:0,busy:false,dead:false,rest:true,update(){}});
  g.spawn({id:904,k:'rocket',team:0,busy:true,dead:true,update(){}});
  g.endTurn();tick(31);assert.equal(g.turn.phase,'aim');assert.notEqual(g.turn.sid,sid);
});

test('Continuous recovery ignores independent enemy attacks while keeping the own half-second quiet timer',()=>{
  const {g,tick}=fixture(true),sid=g.lanes[0].turn.sid,enemySid=g.lanes[1].turn.sid;
  g.spawn({id:905,k:'rocket',team:1,busy:true,dead:false,update(){}});
  g.endTurn();tick(31);assert.notEqual(g.lanes[0].turn.sid,sid);assert.equal(g.lanes[0].turn.phase,'aim');
  assert.equal(g.lanes[1].turn.sid,enemySid);assert.equal(g.lanes[1].turn.phase,'aim');
});

test('Spawned graves inherit the victim attack cause and pending chains postpone the relevant lane',()=>{
  const {g,Tomb}=fixture(true),victim=g.soldiers.find(s=>s.team===1);
  victim.settleTeams=1;const grave=new Tomb(g,victim.x,victim.y,victim.team);g.spawn(grave,victim);
  assert.equal(grave.settleTeams,1);assert.equal(g.anyBusy(),true);
  grave.busy=false;assert.equal(g.anyBusy(),false);
  g.pending.push([1000,50,'crate',2]);assert.equal(g.anyBusy(),false);
  g.pending.push([1000,50,'crate',1]);assert.equal(g.anyBusy(),true);
});

test('A persistent damaging fire remains part of its attack after the old busy flag stops',()=>{
  const {g,tick}=fixture(true),sid=g.turn.sid;
  const fire={id:906,k:'fire',team:0,age:4,f:3,busy:false,dead:false,update(game,dt){this.f-=dt;if(this.f<=0)this.dead=true;}};
  g.spawn(fire);g.endTurn();tick(150);assert.equal(g.turn.phase,'settle');assert.equal(g.turn.sid,sid);assert.equal(g.turn.quiet,0);
  tick(61);assert.equal(g.turn.phase,'aim');assert.notEqual(g.turn.sid,sid);
});

test('Real death, falling grave and its rest finish before the next turn, followed by a half-second quiet hold',()=>{
  for(const simul of [false,true]) {
    const {g,tick,TURN_QUIET_TIME}=fixture(simul),shooter=g.active(),sid=g.turn.sid,victim=g.soldiers.find(s=>s.team===1);
    g.damage(victim,1000,shooter);g.endTurn();let goneAt=null,graveRestAt=null,nextAt=null;
    for(let frame=0;frame<1800&&nextAt===null;frame++) {
      tick();const grave=g.entities.find(e=>e.k==='tomb'&&e.team===1);
      if(victim.gone&&goneAt===null)goneAt=g.time;
      if(grave&&!grave.busy&&graveRestAt===null)graveRestAt=g.time;
      if(graveRestAt===null)assert.equal(g.turn.sid,sid,'camera cut cannot happen before the physical grave settles');
      if(g.turn.sid!==sid)nextAt=g.time;
    }
    assert(goneAt!==null);assert(graveRestAt!==null);assert(nextAt!==null);
    assert(nextAt-graveRestAt>=TURN_QUIET_TIME-1/60-1e-8,JSON.stringify({simul,goneAt,graveRestAt,nextAt}));
    assert(nextAt-graveRestAt<TURN_QUIET_TIME+.08,JSON.stringify({simul,graveRestAt,nextAt}));
  }
});

test('An actual quick bat swing does not add a second recovery timer after an already quiet retreat',()=>{
  for(const simul of [false,true]) {
    const {g,tick}=fixture(simul),sid=g.turn.sid,start=g.time;
    g.cmd(0,{c:'weapon',id:'bat'});g.cmd(0,{c:'fire',aim:-.35,pw:1});
    assert.equal(g.turn.phase,'retreat');tick(29);assert.equal(g.turn.sid,sid);
    tick(3);assert.notEqual(g.turn.sid,sid);assert(g.time-start<.56);
  }
});

test('Active retreat movement retains its opportunity and starts quiet recovery only once the fighter stops',()=>{
  const {g,tick}=fixture(true),sid=g.turn.sid;
  g.cmd(0,{c:'weapon',id:'bat'});g.cmd(0,{c:'fire',aim:-.35,pw:1});g.cmd(0,{c:'ctrl',r:true});
  tick(60);assert.equal(g.turn.sid,sid);assert.equal(g.turn.phase,'retreat');assert.equal(g.turn.idle,0);
  g.cmd(0,{c:'ctrl',r:false});tick(29);assert.equal(g.turn.sid,sid);tick(3);assert.notEqual(g.turn.sid,sid);
});

test('A black hole keeps distant enemy knockback in the firing lane even without damaging that enemy',()=>{
  const {g,BlackHole}=fixture(true),owner=g.active(),victim=g.soldiers.find(s=>s.team===1);
  victim.x=owner.x+200;const hp=victim.hp,hole=new BlackHole(g,owner.x,owner.y-13,owner);
  hole.carveT=hole.dmgT=100;hole.update(g,1/60);
  assert.equal(victim.hp,hp);assert.equal(victim.st,'fly');assert.equal(victim.settleTeams,1);
  assert.equal(g.anyBusy(),true,'own attack must keep its distant surviving victim in view after the hole disappears');
});

test('A blast pushing an existing enemy grave waits for that grave in the causal lane without changing its force',()=>{
  const {g,Tomb,tick}=fixture(true),owner=g.active(),grave=new Tomb(g,2000,100,1);
  grave.rest=true;grave.busy=false;g.spawn(grave);assert.equal(g.anyBusy(),false);
  g.explode(2000,105,20,0,{owner,knock:200});
  assert.equal(grave.settleTeams,1);assert.equal(grave.rest,false);assert(grave.vy<0);
  tick();assert.equal(grave.busy,true);assert.equal(g.anyBusy(),true);
});
