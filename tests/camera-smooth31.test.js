'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){const ctx=vm.createContext({console,performance:{now:()=>0}});for(const n of ['util','render'])vm.runInContext(fs.readFileSync(__dirname+'/../js/'+n+'.js','utf8'),ctx);const Camera=vm.runInContext('Camera',ctx),sc={W:6400,H:1800,waterY:1600,simul:false,entities:[],soldiers:[{id:1,team:0,x:3200,y:1000,alive:true,st:'stand'}],turn:{team:0,sid:1,round:1,phase:'aim',shots:0},terrain:{findTop:()=>1200}};return{Camera,sc,fx:{shake:0,focus:null}};}
test('Tiny wheel movement is deferred and smoothly scales a camera previously shifted with arrows',()=>{
 for(const [sw,sh] of [[1440,900],[390,844]])for(const scoped of [false,true]){
  const {Camera,sc,fx}=fixture(),cam=new Camera();Object.assign(cam,{inited:true,x:3200,y:942,z:2,tz:2,userZ:2,turnKey:'0:1:1',manual:{x:1,y:0}});if(scoped)cam.scopeFocus={point:{x:3330,y:1000},visible:true,locked:true,moving:false};
  for(let i=0;i<30;i++)cam.update(1/60,sc,fx,sw,sh,null);cam.manual.x=0;
  const before={x:cam.x,y:cam.y,z:cam.z};cam.zoomAt(Math.pow(.9,3/120),sw*.72,sh*.41,sw,sh);assert.deepEqual({x:cam.x,y:cam.y,z:cam.z},before);
  let last=before,max=0;for(let i=0;i<110;i++){cam.update(1/60,sc,fx,sw,sh,null);max=Math.max(max,Math.hypot(cam.x-last.x,cam.y-last.y)*cam.z);assert(cam.z<=last.z+1e-10);last={x:cam.x,y:cam.y,z:cam.z};}
  assert(max<1,'tiny-wheel frame shifted '+max+' CSS pixels');const settled={x:cam.x,y:cam.y};cam.mapZoom=null;cam.update(1/60,sc,fx,sw,sh,null);assert(Math.hypot(cam.x-settled.x,cam.y-settled.y)*cam.z<.1,'old arrow offset restored');
 }
});
test('Retargeting an active wheel transition preserves scale velocity; interruption does not restore the arrow origin',()=>{
 const {Camera,sc,fx}=fixture(),cam=new Camera();Object.assign(cam,{inited:true,x:3330,y:942,z:2,tz:2,userZ:2,turnKey:'0:1:1',manual:{x:0,y:0},manualActive:true,offsetX:130,offsetY:0,manualKey:'0:1:1'});
 cam.zoomAt(.9,900,300,1440,900);for(let i=0;i<12;i++)cam.update(1/60,sc,fx,1440,900,null);assert(cam.zoomV>0);const v=cam.zoomV,p={x:cam.x,y:cam.y,z:cam.z};cam.zoomAt(.9,900,300,1440,900);assert.equal(cam.zoomV,v);assert.deepEqual({x:cam.x,y:cam.y,z:cam.z},p);
 cam.update(1/144,sc,fx,1440,900,{moved:true,inside:false});assert.equal(cam.mapZoom,null);assert(Math.hypot(cam.x-p.x,cam.y-p.y)*cam.z<10);assert(cam.userZ<cam.z);
});
test('Binocular release immediately selects an ongoing enemy rocket and returns smoothly despite stale free-view latches',()=>{
 const {Camera,sc,fx}=fixture(),cam=new Camera();sc.turn={team:1,sid:2,round:1,phase:'retreat',shots:1};sc.soldiers.push({id:2,team:1,x:5300,y:1000,alive:true,st:'stand'});sc.entities=[{id:7,k:'rocket',team:1,x:4900,y:850,vx:-100,vy:0,busy:true}];
 Object.assign(cam,{inited:true,x:900,y:500,z:1,tz:1,userZ:1,binoc:true,wasBinoc:true,free:1.3,hold:true,manualActive:true,offsetX:900,offsetY:300,turnKey:'1:2:1'});
 cam.binoc=false;cam.update(1/60,sc,fx,1440,900,null);assert.equal(cam.free,0);assert.equal(cam.manualActive,false);assert.equal(cam.track,true);assert(cam.x>900&&cam.x<1000,'release must start without a cut');
 for(let i=0;i<100;i++){sc.entities[0].x-=100/60;cam.update(1/60,sc,fx,1440,900,null);}assert(Math.abs(cam.x-sc.entities[0].x)<120);
 sc.simul=true;cam.foe=false;cam.update(1/60,sc,fx,1440,900,null);assert.equal(cam.foeFocus,null);
});
test('Wheel zoom follows the same path at 30, 60 and 144 Hz, while its endpoints keep the original map limits',()=>{
 const results=[];for(const hz of [30,60,144]){const{Camera,sc,fx}=fixture(),cam=new Camera();Object.assign(cam,{inited:true,x:3200,y:942,z:2,tz:2,userZ:2,turnKey:'0:1:1'});cam.zoomAt(.9,0,0,1440,900);for(let i=0;i<hz/2;i++)cam.update(1/hz,sc,fx,1440,900,null);results.push(cam.z);assert(cam.z>=cam.zoomLimits(900,1440)[0]);assert(cam.z<=cam.zoomLimits(900,1440)[1]);}for(const z of results)assert(Math.abs(z-results[0])<1e-10);
});
test('A held arrow does not discard a wheel request and both pan and scale continue smoothly',()=>{
 const{Camera,sc,fx}=fixture(),cam=new Camera();Object.assign(cam,{inited:true,x:3200,y:942,z:2,tz:2,userZ:2,turnKey:'0:1:1',manual:{x:1,y:0}});cam.update(1/60,sc,fx,1440,900,null);cam.zoomAt(1.11,900,300,1440,900);const requested=cam.userZ,z=cam.z;for(let i=0;i<20;i++)cam.update(1/60,sc,fx,1440,900,null);assert.equal(cam.userZ,requested);assert(cam.z>z);assert(cam.z<requested);assert(cam.x>3200);
});

test('A resize during or after full-map zoom rebases to the new map limits without restoring the old frame',()=>{
 for(const settled of [false,true]){
  const {Camera,sc,fx}=fixture(),cam=new Camera();Object.assign(cam,{inited:true,x:4200,y:800,z:2,tz:2,userZ:2,turnKey:'0:1:1'});
  cam.zoomAt(.001,500,300,1280,720);for(let i=0;i<(settled?200:15);i++)cam.update(1/60,sc,fx,1280,720,null);
  const before={x:cam.x,y:cam.y,z:cam.z};cam.update(1/60,sc,fx,1920,1080,null);
  assert(cam.z>=.3);assert.equal(cam.userZ,.3);assert.equal(cam.tz,.3);
  if(before.z>.3&&cam.z>.3){assert(cam.x<=before.x&&cam.x>3200,'resize cut to the old actor or final center');assert(cam.y>=before.y&&cam.y<900);}
  for(let i=0;i<200;i++)cam.update(1/60,sc,fx,1920,1080,null);assert.equal(cam.z,.3);assert.equal(cam.x,3200);assert.equal(cam.y,900);
  const large=cam.z;cam.update(1/60,sc,fx,390,844,null);assert(cam.z<large&&cam.z>390/6400);
  for(let i=0;i<220;i++)cam.update(1/60,sc,fx,390,844,null);assert.equal(cam.z,390/6400);assert.equal(cam.x,3200);assert.equal(cam.y,900);
 }
 const {Camera,sc,fx}=fixture(),cam=new Camera();Object.assign(cam,{inited:true,x:3200,y:942,z:2,tz:2,userZ:2,turnKey:'0:1:1'});
 cam.zoomAt(100,700,400,1440,900);for(let i=0;i<150;i++)cam.update(1/60,sc,fx,1440,900,null);
 cam.update(1/60,sc,fx,1440,700,null);const zmax=cam.zoomLimits(700,1440)[1];assert.equal(cam.userZ,zmax);assert.equal(cam.tz,zmax);assert.equal(cam.z,zmax);
});

test('Resizing at every stage of full-map zoom cannot overshoot the map center with retained scale momentum',()=>{
 for(let tick=0;tick<100;tick++)for(const [sw,sh] of [[1920,1080],[3840,2160],[390,844]]){
  const {Camera,sc,fx}=fixture(),cam=new Camera();Object.assign(cam,{inited:true,x:800,y:942,z:2,tz:2,userZ:2,turnKey:'0:1:1'});
  cam.zoomAt(1e-9,640,360,1280,720);for(let i=0;i<tick;i++)cam.update(1/60,sc,fx,1280,720,null);
  const [min,max]=cam.zoomLimits(sh,sw);for(let i=0;i<100;i++){cam.update(1/60,sc,fx,sw,sh,null);assert(cam.z>=min&&cam.z<=max);if(cam.z<=min*(1+1e-8)){assert.equal(cam.x,3200,'right-edge overshoot at resize tick '+tick);assert.equal(cam.y,900);}}
 }
});
