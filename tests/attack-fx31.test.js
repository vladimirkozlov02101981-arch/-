'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(simul=false){
 const map={id:'fixture',theme:'fixture',W:6400,H:1800,water:1560,seed:1,ladders:[]},theme={ground:{cap:{cols:['#123','#234']},strata:['#345','#456'],soil:'#654'},liquid:{kind:'water',top:'#123',foam:'#eee'}};
 class Terrain{constructor(){this.touches=[];}isSolid(x,y){return y>=100;}materialAt(){return 1;}normal(){return{x:0,y:-1};}normalAt(){return{x:0,y:-1};}findTop(){return 100;}carve(){}tidy(){}}
 const ctx=vm.createContext({console,performance:{now:()=>0},MAP_BY_ID:{fixture:map},MAPS:[map],THEMES:{fixture:theme},Terrain,rasterizeMap:()=>({mask:[],mat:[]}),resolveProps:()=>[],Sfx:new Proxy({},{get:()=>()=>{}})});
 for(const n of ['util','weapons','soldier','entities','game','particles','fx'])vm.runInContext(fs.readFileSync(__dirname+'/../js/'+n+'.js','utf8'),ctx);
 const {Game,FX,Tomb}=vm.runInContext('({Game,FX,Tomb})',ctx);Game.prototype.spawnCandidates=()=>Array.from({length:6},(_,i)=>({x:i<3?400+i*110:4300+(i-3)*110,y:100}));
 const g=new Game({mapId:'fixture',settings:{simul,firstTeam:0,perTeam:3,hp:100,turnTime:0,wind:false,arsenal:'all',walk:'limited'},teams:[{name:'A'},{name:'B'}]});if(simul)for(let i=0;i<2;i++)g.inLane(i,()=>g.nextTurn());else g.nextTurn();g.events=[];
 const fx=new FX();fx.reset(g);g.visualBusy=team=>fx.combatBusy(team);const cam={view:()=>({x0:0,y0:0,x1:1440,y1:900})};
 return{g,fx,Tomb,tick(){g.step(1/60);const evs=g.events;g.events=[];for(const e of evs)fx.handle(e,g,true);fx.update(1/60,g,cam,1440,900);}};
}
test('Actual impact smoke and sparks finish before the full half-second pause when no grave exists',()=>{
 for(const simul of [false,true]){const{g,fx,tick}=fixture(simul),sid=g.turn.sid;g.emit({t:'boom',x:500,y:80,r:20,k:0});for(const e of g.events)fx.handle(e,g,true);g.events=[];g.endTurn();let last=0,next=null,seen=0;
  for(let i=0;i<400;i++){if(fx.combatBusy(0)){last=g.time;seen++;}tick();if(g.turn.sid!==sid){next=g.time;break;}}
  assert(seen>60,'real explosion particles did not run');assert(next!==null);assert(next-last>=.5-1/60-1e-8);assert(next-last<.56);assert.equal(fx.combatBusy(0),false);
 }
});
test('Once the causal grave is physically planted it takes precedence over lingering smoke, with a fresh half-second delay',()=>{
 for(const simul of [false,true]){const{g,fx,Tomb,tick}=fixture(simul),sid=g.turn.sid,grave=new Tomb(g,500,100,1);g.spawn(grave,{settleTeams:1});g.emit({t:'nuke',x:500,y:80});for(const e of g.events)fx.handle(e,g,true);g.events=[];g.endTurn();let rest=null,next=null;
  for(let i=0;i<500;i++){tick();if(grave.rest&&rest===null)rest=g.time;if(g.turn.sid!==sid){next=g.time;break;}}
  assert(rest!==null&&next!==null);assert(next-rest>=.5-1/60-1e-8);assert(next-rest<.56);assert(fx.P.a.some(p=>p.life>0),'grave rule should not wait for unrelated smoke fade');
 }
});
test('Parallel enemy effects and ambient fire do not delay a player, but a causal enemy casualty does',()=>{
 const{g,fx,tick}=fixture(true);fx.handle({t:'boom',x:4500,y:80,r:20,k:0,L:1,M:2},g,true);fx.P.spark(20,20,0,0,20);assert.equal(fx.combatBusy(0),false);assert.equal(fx.combatBusy(1),true);g.endTurn();const sid=g.turn.sid;for(let i=0;i<31;i++)tick();assert.notEqual(g.turn.sid,sid);
 fx.handle({t:'die',id:4,x:4500,y:80,L:1,M:1},g,true);assert.equal(fx.combatBusy(0),true);assert(fx.P.a.some(p=>p.settleMask===1));
});
test('Long visual fragment paths terminate and their final sparks remain part of the attack',()=>{
 const{g,fx,tick}=fixture();fx.handle({t:'frags',x:400,y:70,e:[[[400,70],[3400,70]]],M:1},g,true);g.endTurn();const sid=g.turn.sid;let sawFinal=false;for(let i=0;i<1400;i++){tick();if(!fx.flyers.length&&fx.P.a.some(p=>p.settleMask===1&&p.t===2))sawFinal=true;if(g.turn.sid!==sid)break;}assert(sawFinal);assert.notEqual(g.turn.sid,sid,'visual fragment stalled forever');
});
test('A new mine explosion on the last quiet tick or next-turn boundary restarts the complete recovery',()=>{
 for(const silent of [29,30]){const{g,fx,tick}=fixture(),sid=g.turn.sid;g.endTurn();for(let i=0;i<silent;i++)tick();g.spawn({id:777,k:'mine',team:0,busy:false,dead:false,update(game){game.emit({t:'boom',x:500,y:80,r:20,k:0});this.dead=true;}});tick();assert.equal(g.turn.sid,sid);assert.equal(g.turn.phase,'settle');assert.equal(g.turn.quiet,0);assert(fx.combatBusy(0));let last=g.time,next=null;for(let i=0;i<400;i++){if(fx.combatBusy(0))last=g.time;tick();if(g.turn.sid!==sid){next=g.time;break;}}assert(next!==null&&next-last>=.5-1/60-1e-8);}
});
test('A simultaneous final victory waits for an unfinished attack in the other lane and a shared half-second',()=>{
 const{g,tick}=fixture(true);for(const s of g.soldiers.filter(s=>s.team===1))g.damage(s,1000,g.soldiers[0]);const projectile={id:778,k:'rocket',team:0,busy:true,dead:false,update(){}};g.spawn(projectile);g.endTurn();for(let i=0;i<300;i++)tick();assert.equal(g.over,null);assert.equal(g.finalQuiet,0);projectile.dead=true;const release=g.time;let won=null;for(let i=0;i<80;i++){tick();if(g.over){won=g.time;break;}}assert.equal(g.over?.win,0);assert(won-release>=.5-1e-8&&won-release<.6);
});
test('A new simultaneous turn preserves the other player visual fragments and its causal wait',()=>{
 const{g,fx,tick}=fixture(true);fx.handle({t:'frags',x:4500,y:70,e:[[[4500,70],[6400,70]]],L:1,M:2},g,true);g.endTurn();g.inLane(1,()=>g.endTurn());const sid0=g.lanes[0].turn.sid,sid1=g.lanes[1].turn.sid;for(let i=0;i<32;i++)tick();assert.notEqual(g.lanes[0].turn.sid,sid0);assert.equal(g.lanes[1].turn.sid,sid1);assert(fx.flyers.length>0);assert(fx.combatBusy(1));assert.equal(fx.combatBusy(0),false);for(let i=0;i<1000&&g.lanes[1].turn.sid===sid1;i++)tick();assert.notEqual(g.lanes[1].turn.sid,sid1);
});
