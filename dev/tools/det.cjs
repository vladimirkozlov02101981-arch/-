// Максимальное приближение. MAP=карта; VW/VH — окно (1920×1080 — как у игрока); FORCEGL=1 — ландшафт на видеокарте (как у
// игрока с GPU; headless здесь — программный рендер); PTS=x:y,x:y — точки мира в центре кадра (иначе — активный боец);
// ONLY=1 — только снимок с чёткой картой (без снимка «как есть»); Z=k — масштаб в долях максимального (по умолчанию 1)
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const VW=+(process.env.VW||1280),VH=+(process.env.VH||720);const p=await b.newPage({viewport:{width:VW,height:VH}});
if(process.env.FORCEGL)await p.addInitScript(()=>{window.__forceTerrainGL=true;});
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:3000/?v='+Date.now());await p.waitForSelector('#s-main.show');
const map=process.env.MAP||'canyon';
await p.evaluate(m=>App.startLocal({mapId:m,settings:{...App.prefs.settings,perTeam:2,turnTime:90},teams:App.prefs.teams},'hotseat'),map);
await p.waitForFunction(()=>App.game?.turn.phase==='aim',null,{timeout:180000});
const pts=process.env.PTS?process.env.PTS.split(',').map(s=>s.split(':').map(Number)):[null];const zk=+(process.env.Z||1);
for(const pt of pts)for(const on of process.env.ONLY?[1]:[0,1]){
 await p.evaluate(([on,pt,zk])=>{window.__noHiRes=!on;const s=App.sc.soldiers.find(s=>s.id===App.game.turn.sid);const c=App.cam;const L=c.zoomLimits(innerHeight,innerWidth);c.userZ=L[1]*zk;c.z=c.tz=L[1]*zk;c.free=999;c.x=pt?pt[0]:s.x;c.y=pt?pt[1]:s.y+40;},[on,pt,zk]);
 await p.waitForTimeout(on?5000:1500);await p.screenshot({path:`${process.env.SP}/det-${map}-${pt?pt.join('_')+'-':''}${on}.png`});}
console.log(errs);await b.close();})();
