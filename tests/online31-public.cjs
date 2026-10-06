'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_URL||'http://127.0.0.1:3001';
const hash=()=>{let h=2166136261;for(const v of App.sc.terrain.mask)h=Math.imul(h^v,16777619);return h>>>0;};
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  try {
    const hostCtx=await browser.newContext({viewport:{width:1440,height:900}}),guestCtx=await browser.newContext({viewport:{width:1440,height:900}});
    for(const c of [hostCtx,guestCtx])await c.route('**/profile',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
    const host=await hostCtx.newPage(),guest=await guestCtx.newPage();
    for(const p of [host,guest]){p.setDefaultTimeout(180000);p.on('pageerror',e=>errors.push(e.message));}
    await host.goto('http://127.0.0.1:3001',{waitUntil:'domcontentloaded'});await host.waitForSelector('#s-main.show');await host.click('[data-act="online"]');await host.click('[data-act="host"]');await host.waitForSelector('#s-setup.show');
    const code=await host.locator('#room-code').textContent();
    await guest.goto(base+'/#join='+code,{waitUntil:'domcontentloaded'});await guest.waitForFunction(()=>UI.mode==='guest'&&UI.cur==='s-setup');
    await host.click('.map-card[data-map="random"]');await guest.waitForFunction(()=>UI.settings.mapId==='random');
    await host.uncheck('#o-turnInf');await host.fill('#o-turnTime','90');await host.dispatchEvent('#o-turnTime','change');
    await host.selectOption('#o-side','left');await host.selectOption('#o-first','team2');
    for(const width of [1440,390]){await host.setViewportSize({width,height:900});await host.locator('#o-first').scrollIntoViewIfNeeded();await host.screenshot({path:'test-results/first-turn31-settings-'+width+'.png'});const layout=await host.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,choice:document.getElementById('o-first').value,bounds:[...document.querySelectorAll('#opts select,#opts input[type="number"]')].filter(el=>el.getClientRects().length>0).map(el=>{const b=el.getBoundingClientRect();return{id:el.id,x:b.x,r:b.right,w:b.width};})}));assert.equal(layout.overflow,false);assert.equal(layout.choice,'team2');for(const b of layout.bounds){assert(b.w>0&&b.x>=0&&b.r<=width+1,JSON.stringify(b));}}
    await host.setViewportSize({width:1440,height:900});await host.click('#btn-start');await host.waitForFunction(()=>App.mode==='host'&&App.game?.turn.phase==='aim');await guest.waitForFunction(()=>App.mode==='guest'&&App.remote?.turn.phase==='aim');
    const map=await host.evaluate(()=>App.sc.map.id);assert.equal(map,await guest.evaluate(()=>App.sc.map.id));assert.equal(await host.evaluate(()=>UI.settings.mapId),'random');console.log('Random map shared by host and guest PASS',map);
    assert.equal(await host.evaluate(()=>App.game.turn.team),1);assert.equal(await guest.evaluate(()=>App.remote.turn.team),1);
    assert.equal(await host.evaluate(()=>App.game.cfg.settings.firstTeam),await guest.evaluate(()=>App.remote.settings.firstTeam));
    await host.screenshot({path:'test-results/first-turn31-host.png'});
    const initial=await host.evaluate(hash);assert.equal(initial,await guest.evaluate(hash));
    assert.equal(await host.evaluate(()=>App.game.soldiers.length),8);
    console.log('Public invitation and initial state PASS',base,code);
    await guest.evaluate(()=>{App.ctl.aimMode='keys';App.ctl.aim=Math.PI/2;App.ctl.send({c:'fire',aim:Math.PI/2,pw:.15});});
    await host.waitForFunction(()=>App.game.turn.team===0&&App.game.turn.phase==='aim');
    const hostCrater=await host.evaluate(hash);assert.notEqual(hostCrater,initial);
    await guest.waitForFunction(expected=>{let h=2166136261;for(const v of App.sc.terrain.mask)h=Math.imul(h^v,16777619);return(h>>>0)===expected;},hostCrater);
    await host.evaluate(()=>{App.ctl.send({c:'weapon',id:'grenade'});});
    await host.waitForFunction(()=>App.game.turn.weapon==='grenade');
    await host.evaluate(()=>{App.ctl.send({c:'fire',aim:Math.PI/2,pw:.2});});
    await host.waitForFunction(()=>App.game.turn.team===1&&App.game.turn.phase==='aim');
    const guestCrater=await host.evaluate(hash);assert.notEqual(guestCrater,hostCrater);
    await guest.waitForFunction(expected=>{let h=2166136261;for(const v of App.sc.terrain.mask)h=Math.imul(h^v,16777619);return(h>>>0)===expected;},guestCrater);
    await host.screenshot({path:'test-results/public-host.png'});await guest.screenshot({path:'test-results/public-guest.png'});
    await host.evaluate(()=>App.rematch());await host.waitForFunction(()=>UI.mode==='host'&&UI.cur==='s-setup');assert.equal(await host.evaluate(()=>UI.settings.mapId),'random');await guest.waitForFunction(()=>UI.settings.mapId==='random');console.log('Random map preference retained for online rematch PASS');
    assert.deepEqual(errors,[]);fs.writeFileSync('test-results/online31-public.json',JSON.stringify({passed:true,url:base,initial,guestFirstCrater:hostCrater,hostSecondCrater:guestCrater,first:'team2',firstTeam:1,side:'left',errors,date:new Date().toISOString()},null,2));
    console.log('Shots by both players, turn rotation and identical terrain through public WebSocket PASS');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
