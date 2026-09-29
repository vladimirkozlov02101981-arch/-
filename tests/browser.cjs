'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_URL||'http://localhost:3000';
const errors=[];
async function ready(page){page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForSelector('#s-main.show',{timeout:60000});}
async function imageReady(page){await page.waitForFunction(()=>[...document.querySelectorAll('#map-grid img')].every(im=>im.complete&&im.naturalWidth));}
async function mapHash(page){return page.evaluate(()=>{let h=2166136261;for(const v of App.sc.terrain.mask)h=Math.imul(h^v,16777619);return h>>>0;});}
(async()=>{
  fs.mkdirSync('test-results',{recursive:true});
  const browser=await chromium.launch({channel:process.env.TEST_BROWSER||'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  try {
    const ctx=await browser.newContext({viewport:{width:1440,height:900}}),host=await ctx.newPage();await ready(host);
    await host.screenshot({path:'test-results/menu.png'});
    await host.click('[data-act="hotseat"]');await imageReady(host);await host.screenshot({path:'test-results/setup.png'});
    const dimensions=await host.evaluate(()=>MAPS.map(m=>({id:m.id,W:m.W,H:m.H,shafts:m.ladders.length})));assert.equal(dimensions.length,8);assert(dimensions.every(m=>m.W>=4800&&m.shafts>=2));
    console.log('Map sizes',dimensions);
    const deterministic=await host.evaluate(()=>{
      const result=[];
      for(const m of MAPS){const a=rasterizeMap(m).mask,b=rasterizeMap(m).mask;let same=true,count=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])same=false;count+=a[i];}result.push({id:m.id,same,solid:count});}return result;
    });assert(deterministic.every(m=>m.same&&m.solid>100000));console.log('All 8 geometry masks repeat exactly');
    await host.click('#s-setup [data-act="back"]');await host.click('[data-act="online"]');await host.click('[data-act="host"]');await host.waitForSelector('#s-setup.show');
    const code=await host.locator('#room-code').textContent();assert.match(code,/^[A-Z2-9]{5}$/);
    const guestCtx=await browser.newContext({viewport:{width:1440,height:900}}),guest=await guestCtx.newPage();await ready(guest);
    await guest.click('[data-act="online"]');await guest.fill('#join-code',code);await guest.click('[data-act="join"]');await guest.waitForFunction(()=>UI.cur==='s-setup'&&UI.mode==='guest');
    await guest.locator('[data-team="1"] .tc-name').fill('Друг');await guest.waitForFunction(()=>UI.teamsCfg[1].name==='Друг');await host.waitForFunction(()=>UI.teamsCfg[1].name==='Друг');
    await guest.locator('[data-team="1"] .tc-name').pressSequentially(' онлайн',{delay:90});await host.waitForFunction(()=>UI.teamsCfg[1].name==='Друг онлайн');
    console.log('Lobby and editable team names PASS');
    assert.equal(await guest.locator('[data-team="1"] .tc-name').inputValue(),'Друг онлайн');
    await host.selectOption('#o-perTeam','2');await host.selectOption('#o-turnTime','90');await host.selectOption('#o-crates','0');await host.selectOption('#o-sd','0');
    await guest.waitForFunction(()=>UI.settings.perTeam===2&&UI.settings.turnTime===90);
    await host.click('#btn-start');await host.waitForFunction(()=>App.mode==='host'&&App.game.turn.phase==='aim',{timeout:60000});await guest.waitForFunction(()=>App.mode==='guest'&&App.remote.turn.phase==='aim',{timeout:60000});
    await host.waitForTimeout(800);assert.equal(await mapHash(host),await mapHash(guest));
    await host.keyboard.press('Tab');await host.waitForSelector('#tray:not(.hidden)');assert.equal(await host.locator('.tray-item').count(),34);await host.screenshot({path:'test-results/arsenal.png'});await host.keyboard.press('Tab');await host.waitForSelector('#tray.hidden',{state:'attached'});
    // A real input action and pause must neutralize movement on the authoritative host.
    await host.keyboard.down('KeyD');await host.waitForTimeout(160);await host.keyboard.press('Escape');await host.keyboard.up('KeyD');
    await host.waitForSelector('#s-pause.show');assert.equal(await host.evaluate(()=>!!App.game.ctrl?.r),false);await host.click('[data-act="resume"]');
    await guest.keyboard.press('KeyT');await guest.fill('#chat-input','Проверка связи');await guest.keyboard.press('Enter');await host.waitForFunction(()=>document.getElementById('chat-log').textContent.includes('Проверка связи'));
    const before=await mapHash(host);
    // Fire via the normal game command path. Vertical downward rocket must change terrain.
    await host.evaluate(()=>{App.ctl.aimMode='keys';App.ctl.aim=Math.PI/2;App.ctl.send({c:'fire',aim:Math.PI/2,pw:.22});});
    await host.waitForFunction(()=>App.game.turn.phase==='settle'||App.game.turn.team===1,{timeout:20000});await host.waitForTimeout(350);
    assert.notEqual(await mapHash(host),before);assert.equal(await mapHash(host),await mapHash(guest));
    // Keep the network active while preventing guest rendering for >90 snapshots.
    await guest.evaluate(()=>{window.savedRemoteUpdate=App.remote.update;App.remote.update=()=>{};});
    await host.evaluate(()=>{const g=App.game;g.carve(1200,1450,27);const s=g.soldiers.find(s=>s.team===1);s.drown(g);});
    await host.waitForTimeout(4500);await guest.evaluate(()=>{App.remote.update=window.savedRemoteUpdate;});await host.waitForTimeout(500);
    assert.equal(await mapHash(host),await mapHash(guest));
    const goneHost=await host.evaluate(()=>App.game.soldiers.filter(s=>s.gone).map(s=>s.id));
    const goneGuest=await guest.evaluate(()=>App.remote.soldiers.filter(s=>s.gone).map(s=>s.id));assert.deepEqual(goneGuest,goneHost);
    await host.screenshot({path:'test-results/online-host.png'});await guest.screenshot({path:'test-results/online-guest.png'});
    await host.evaluate(()=>{const g=App.game;for(const s of g.soldiers.filter(s=>s.team===1))s.drown(g);g.finish(g.teams[0]);});
    await host.waitForSelector('#s-over.show',{timeout:10000});await guest.waitForSelector('#s-over.show',{timeout:10000});
    await host.click('[data-act="rematch"]');await guest.waitForFunction(()=>UI.cur==='s-setup');await host.click('#btn-start');
    await guest.waitForFunction(()=>App.mode==='guest'&&App.remote.turn.phase==='aim',{timeout:60000});assert.equal(await mapHash(host),await mapHash(guest));
    console.log('Two clients: lobby, name editing, 34 weapon buttons, input reset, shot, terrain sync, hidden-tab recovery, chat, victory, rematch PASS');
    await guestCtx.close();await ctx.close();
    const checks=await browser.newContext({viewport:{width:1440,height:900}}),page=await checks.newPage();await ready(page);
    const physics=await page.evaluate(()=>{
      function arena(){
        const W=1000,H=600,mask=new Uint8Array(W*H);mask.fill(1,420*W);
        const g=Object.create(Game.prototype);Object.assign(g,{W,H,waterY:570,gravity:640,map:{ladders:[]},terrain:new Terrain(W,H,mask),round:4,time:0,nextId:3,over:null,events:[],entities:[],pending:[],props:[],usage:null,ctrl:null,teamsDirty:true,sdStarted:false,cfg:{settings:{turnTime:90,crates:false,wind:false,sd:0}}});
        g.teams=[0,1].map(idx=>({idx,name:String(idx),ammo:makeAmmo('all'),dmg:0,kills:0,order:[idx+1],next:0,lastW:'bazooka'}));
        g.soldiers=[new Soldier(1,0,'A',200,420,100),new Soldier(2,1,'B',450,420,100)];
        g.turn={team:0,sid:1,phase:'aim',weapon:'bazooka',shots:0,walk:420,time:90,wind:0,rot:0,round:4,retreat:0,charge:-1};return g;
      }
      const g=arena();g.turn.weapon='revolver';g.teams[0].ammo.revolver=1;for(let i=0;i<3;i++)g.fire(g.active(),{aim:0,pw:1});
      const burst={shots:g.turn.shots,ammo:g.teams[0].ammo.revolver,phase:g.turn.phase};
      const j=arena();j.turn.walk=0;j.active().jump(j,1);const noFreeJump=j.active().st==='stand';
      const shoot=arena();bullet(shoot,shoot.active(),0,2000,20,20,3,0);const delayed=shoot.soldiers[1].hp===100;for(let i=0;i<6;i++)shoot.step(1/60);const bulletHit=shoot.soldiers[1].hp<100;
      const coverTest=wall=>{const a=arena();a.soldiers[1].x=450;if(wall)for(let y=250;y<420;y++)for(let x=405;x<425;x++)a.terrain.mask[y*a.W+x]=1;a.explode(365,400,120,100,{owner:a.soldiers[0],knock:100});return 100-a.soldiers[1].hp;};
      const openDamage=coverTest(false),coveredDamage=coverTest(true);
      const thin=arena();for(let y=250;y<420;y++)thin.terrain.mask[y*thin.W+300]=1;bullet(thin,thin.active(),0,2000,20,20,0,0);for(let i=0;i<6;i++)thin.step(1/60);const noTunneling=thin.soldiers[1].hp===100;
      const effects={};for(const id of WEAPONS.map(w=>w.id)){
        const a=arena();a.turn.weapon=id;a.turn.target={x:450,y:400};a.fire(a.active(),{aim:-.08,pw:.4,tx:450,ty:400});
        for(let i=0;i<120;i++)a.step(1/60);
        effects[id]={events:a.events.length,finite:a.soldiers.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.y)),handler:typeof FIRE[id]==='function'};
      }
      const ladder=arena();ladder.map.ladders=[{x:200,y1:300,y2:420}];const ls=ladder.active();ls.update(ladder,.1,{u:true,d:false,l:false,r:false});const climbed=ls.st==='climb'&&ls.y<420&&ladder.turn.walk<420;
      return {burst,noFreeJump,delayed,bulletHit,openDamage,coveredDamage,noTunneling,effects,climbed};
    });
    assert.deepEqual(physics.burst,{shots:3,ammo:0,phase:'retreat'});for(const key of ['noFreeJump','delayed','bulletHit','noTunneling','climbed'])assert(physics[key],key);assert(physics.coveredDamage<physics.openDamage*.5);assert(Object.values(physics.effects).every(e=>e.handler&&e.finite));
    console.log('Physics and 34 weapon simulations',physics);
    fs.writeFileSync('test-results/physics.json',JSON.stringify(physics,null,2));
    for(const id of dimensions.map(m=>m.id)) {
      await page.evaluate(id=>{const settings={...App.prefs.settings,mapId:id,perTeam:2,turnTime:90,sd:0,crates:false};App.startLocal({mapId:id,settings,teams:App.prefs.teams},'hotseat');},id);
      await page.waitForFunction(id=>App.mode==='hotseat'&&App.sc?.map.id===id&&App.game?.turn.phase==='aim',id,{timeout:60000});
      await page.evaluate(async()=>{await MapArt.get(App.sc.map.id).decode();App.cam.overview=true;});await page.waitForTimeout(800);await page.screenshot({path:`test-results/map-${id}.png`});
      assert(await page.evaluate(()=>App.game.soldiers.every(s=>s.alive&&bodyFree(App.game.terrain,s.x,s.y))),'Safe spawns '+id);
      console.log('Rendered and deployed on',id);
    }
    assert.deepEqual(errors,[]);console.log('8 maps: loaded, rendered, safe deployments; no JavaScript errors PASS');
    await checks.close();
    fs.writeFileSync('test-results/report.json',JSON.stringify({passed:true,dimensions,deterministic,errors,date:new Date().toISOString()},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
