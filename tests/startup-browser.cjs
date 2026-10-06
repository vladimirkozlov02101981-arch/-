'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
const browser=await chromium.launch({channel:'chrome',headless:true}),result={pass:false,cases:[],errors:[]};
try{
for(const cancel of[false,true]){
 const ctx=await browser.newContext({viewport:{width:1280,height:720}}),pending=[],requests=[];
 await ctx.route('**/profile',r=>r.fulfill({contentType:'application/json',body:'{}'}));
 await ctx.route('**/assets/tex/rock_arctic.png',r=>{pending.push(r);return new Promise(()=>{});});
 const page=await ctx.newPage();page.on('pageerror',e=>result.errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 const started=Date.now();await page.goto(process.env.TEST_URL||'http://127.0.0.1:3001',{waitUntil:'domcontentloaded'});await page.waitForSelector('#s-main.show',{timeout:5000});
 const menuMs=Date.now()-started;assert.equal(await page.evaluate(()=>App.sc===null),true);assert.equal(requests.some(p=>p==='/assets/tex/rock_volcano.png'),false);
 await page.evaluate(()=>App.startLocal({mapId:'arctic',settings:sanitizeSettings({mapId:'arctic',perTeam:2,simul:false}),teams:DEFAULT_PREFS.teams},'cpu'));
 await page.waitForTimeout(3700);assert.equal(await page.evaluate(()=>App.sc===null),true);assert.equal(await page.locator('#loading').evaluate(e=>!e.classList.contains('hidden')),true);
 if(cancel)await page.evaluate(()=>App.toMenu());
 assert.ok(pending.length);for(const route of pending)await route.continue();
 await page.waitForFunction(expected=>App.sc&&App.demo===expected,cancel,{timeout:30000});
 const state=await page.evaluate(()=>({mode:App.mode,demo:App.demo,map:App.sc.map.id,materials:TexLib.mapAssets('arctic').names.filter(n=>!TexLib.data[n])}));
 assert.equal(state.mode,cancel?'menu':'cpu');assert.equal(state.map,'arctic');assert.deepEqual(state.materials,[]);
 assert.equal(await page.locator('#loading').evaluate(e=>e.classList.contains('hidden')),true);
 result.cases.push({cancel,menuMs,heldMs:3700,...state});await ctx.close();
}
assert.deepEqual(result.errors,[]);result.pass=true;
}finally{await browser.close();fs.writeFileSync('test-results/startup29-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
})().catch(e=>{console.error(e);process.exitCode=1;});
