'use strict';
require('../dev/tools/pw-chromium.cjs');
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{let browser;const report={pass:false,errors:[]};try{
 browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:1280,height:720},screen:{width:1920,height:1080}});
 await ctx.addInitScript(()=>window.__allowFull=true);await ctx.route('**/profile',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.goto(process.env.TEST_URL||'http://127.0.0.1:3001');await page.waitForSelector('#s-main.show',{timeout:120000});await page.evaluate(()=>{App.paused=true;});
 // A real browser gesture enables the DOM Fullscreen API when startup has no activation.
 await page.mouse.click(12,12);await page.waitForFunction(()=>!!document.fullscreenElement,{timeout:10000});
 report.gesture=await page.evaluate(()=>({full:!!document.fullscreenElement,wanted:Input.fsWanted,width:innerWidth,height:innerHeight}));assert(report.gesture.full&&report.gesture.wanted);
 // The event remains available to the native browser shortcut; simulate its window exit in headless mode.
 report.leave=await page.evaluate(async()=>{const e=new KeyboardEvent('keydown',{code:'F11',key:'F11',bubbles:true,cancelable:true});window.dispatchEvent(e);const r={prevented:e.defaultPrevented,wanted:Input.fsWanted,gameKey:!!Input.keys.F11};await document.exitFullscreen();return r;});
 await page.waitForFunction(()=>!document.fullscreenElement);assert.equal(report.leave.prevented,false);assert.equal(report.leave.wanted,false);assert.equal(report.leave.gameKey,false);
 await page.mouse.click(15,15);await page.keyboard.press('KeyA');await page.waitForTimeout(250);report.windowed=await page.evaluate(()=>({full:!!document.fullscreenElement,wanted:Input.fsWanted}));assert.deepEqual(report.windowed,{full:false,wanted:false});
 await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'F11',key:'F11',bubbles:true,cancelable:true})));await page.mouse.click(15,15);await page.waitForFunction(()=>!!document.fullscreenElement,{timeout:10000});
 report.reenter=await page.evaluate(()=>({full:!!document.fullscreenElement,wanted:Input.fsWanted}));assert(report.reenter.full&&report.reenter.wanted);
 report.launchers=Object.fromEntries(['start-game.ps1','start-online.ps1'].map(name=>{const s=fs.readFileSync(name,'utf8');assert(s.includes("'--start-fullscreen'"));assert(s.includes("('--app=' + $url)"));assert(s.includes('dev/browser-profile'));assert(!s.includes("'--kiosk'"));return[name,true];}));
 report.nativeF11='Browser default preserved; actual Windows chrome not simulated by this headless test';assert.deepEqual(report.errors,[]);report.pass=true;
 }catch(e){report.failure=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();fs.mkdirSync('test-results/fullscreen',{recursive:true});fs.writeFileSync('test-results/fullscreen/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();