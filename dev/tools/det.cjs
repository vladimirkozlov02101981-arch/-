const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:720}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:3000/?v='+Date.now());await p.waitForSelector('#s-main.show');
const map=process.env.MAP||'canyon';
await p.evaluate(m=>App.startLocal({mapId:m,settings:{...App.prefs.settings,perTeam:2,turnTime:90},teams:App.prefs.teams},'hotseat'),map);
await p.waitForFunction(()=>App.game?.turn.phase==='aim',null,{timeout:180000});
for(const on of [0,1]){
 await p.evaluate(on=>{window.__noHiRes=!on;const s=App.sc.soldiers.find(s=>s.id===App.game.turn.sid);const c=App.cam;const L=c.zoomLimits(720,1280);c.userZ=L[1];c.z=c.tz=L[1];c.free=999;c.x=s.x;c.y=s.y+40;},on);
 await p.waitForTimeout(on?5000:1500);await p.screenshot({path:`${process.env.SP}/det-${map}-${on}.png`});}
console.log(errs);await b.close();})();
