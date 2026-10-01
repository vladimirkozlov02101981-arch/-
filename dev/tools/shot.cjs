// SHOTS=map:x:y (x=auto -> default camera). OUT=prefix
const {chromium}=require('playwright');const SP=process.env.SP;
(async()=>{const b=await chromium.launch({headless:true});const p=await b.newPage({viewport:{width:1440,height:900}});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:3000/?v='+Date.now());await p.waitForSelector('#s-main.show',{timeout:60000});
for(const spec of (process.env.SHOTS||'valley:auto').split(',')){const [id,x,y]=spec.split(':');
await p.evaluate(id=>App.startLocal({mapId:id,settings:{...App.prefs.settings,perTeam:2,turnTime:90,crates:false,sd:0},teams:App.prefs.teams},'hotseat'),id);
await p.waitForFunction(id=>App.sc?.map.id===id&&App.game?.turn.phase==='aim',id,{timeout:180000});
await p.evaluate(async()=>{await MapArt.get(App.sc.map.id).decode();});
if(x!=='auto') await p.evaluate(([x,y])=>{const c=App.cam;c.free=999;c.x=+x;c.y=+y;},[x,y]);
await p.waitForTimeout(6000);const cam=await p.evaluate(()=>[Math.round(App.cam.x),Math.round(App.cam.y)]);
await p.screenshot({path:`${SP}/${process.env.OUT||'s'}-${id}-${x}.png`});if(process.env.CLIP){const [cx,cy,cw,ch]=process.env.CLIP.split(':').map(Number);await p.screenshot({path:`${SP}/${process.env.OUT||'s'}-${id}-${x}-crop.png`,clip:{x:cx,y:cy,width:cw,height:ch}});}console.log(id,x,'cam',cam);}
console.log('errors',errs);await b.close();})();
