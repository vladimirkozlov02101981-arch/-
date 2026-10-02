'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.TEST_URL||'http://localhost:3000';
const hash=()=>{let h=2166136261;for(const v of App.sc.terrain.mask)h=Math.imul(h^v,16777619);return h>>>0;};
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  try {
    const hostCtx=await browser.newContext({viewport:{width:1440,height:900}}),guestCtx=await browser.newContext({viewport:{width:1440,height:900}});
    const host=await hostCtx.newPage(),guest=await guestCtx.newPage();
    for(const p of [host,guest]){p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));}
    await host.goto(base);await host.waitForSelector('#s-main.show');await host.click('[data-act="online"]');await host.click('[data-act="host"]');await host.waitForSelector('#s-setup.show');
    const code=await host.locator('#room-code').textContent();
    await guest.goto(base+'/#join='+code);await guest.waitForFunction(()=>UI.mode==='guest'&&UI.cur==='s-setup');
    await host.uncheck('#o-turnInf');await host.fill('#o-turnTime','90');await host.dispatchEvent('#o-turnTime','change');
    await host.click('#btn-start');await host.waitForFunction(()=>App.mode==='host'&&App.game?.turn.phase==='aim');await guest.waitForFunction(()=>App.mode==='guest'&&App.remote?.turn.phase==='aim');
    const initial=await host.evaluate(hash);assert.equal(initial,await guest.evaluate(hash));
    assert.equal(await host.evaluate(()=>App.game.soldiers.length),8);
    console.log('Public invitation and initial state PASS',base,code);
    await host.evaluate(()=>{App.ctl.aimMode='keys';App.ctl.aim=Math.PI/2;App.ctl.send({c:'fire',aim:Math.PI/2,pw:.15});});
    await host.waitForFunction(()=>App.game.turn.team===1&&App.game.turn.phase==='aim');
    const hostCrater=await host.evaluate(hash);assert.notEqual(hostCrater,initial);
    await guest.waitForFunction(expected=>{let h=2166136261;for(const v of App.sc.terrain.mask)h=Math.imul(h^v,16777619);return(h>>>0)===expected;},hostCrater);
    await guest.evaluate(()=>{App.ctl.send({c:'weapon',id:'grenade'});});
    await host.waitForFunction(()=>App.game.turn.weapon==='grenade');
    await guest.evaluate(()=>{App.ctl.send({c:'fire',aim:Math.PI/2,pw:.2});});
    await host.waitForFunction(()=>App.game.turn.team===0&&App.game.turn.phase==='aim');
    const guestCrater=await host.evaluate(hash);assert.notEqual(guestCrater,hostCrater);
    await guest.waitForFunction(expected=>{let h=2166136261;for(const v of App.sc.terrain.mask)h=Math.imul(h^v,16777619);return(h>>>0)===expected;},guestCrater);
    await host.screenshot({path:'test-results/public-host.png'});await guest.screenshot({path:'test-results/public-guest.png'});
    assert.deepEqual(errors,[]);fs.writeFileSync('test-results/online.json',JSON.stringify({passed:true,url:base,initial,hostCrater,guestCrater,errors,date:new Date().toISOString()},null,2));
    console.log('Shots by both players, turn rotation and identical terrain through public WebSocket PASS');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
