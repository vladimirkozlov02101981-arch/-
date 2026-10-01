const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});await p.goto('http://localhost:3000/?v='+Date.now());await p.waitForSelector('#s-main.show');
const map=process.env.MAP||'canyon';
await p.evaluate(m=>App.startLocal({mapId:m,settings:{...App.prefs.settings,perTeam:2},teams:App.prefs.teams},'hotseat'),map);await p.waitForFunction(()=>App.game?.turn.phase==='aim',null,{timeout:180000});
for(const off of [1,0]){await p.evaluate(o=>{window.__noHiRes=!!o;},off);await p.waitForTimeout(5000);await p.screenshot({path:`${process.env.SP}/ab-${map}-${off?'off':'on'}.png`,clip:{x:0,y:560,width:600,height:260}});}
await b.close();})();
