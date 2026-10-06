'use strict';
require('../dev/tools/pw-chromium.cjs');
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('test-results/cave-light',{recursive:true});
 const browser=await chromium.launch({headless:true});
 const report={errors:[]};
 try{
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  await ctx.route('**/profile',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:3001');await page.waitForSelector('#s-main.show',{timeout:120000});
  await page.evaluate(async()=>{await TexLib.load();App.paused=true;});
  for(const mode of ['before','after']){
   const result=await page.evaluate(async mode=>{
    const current=caveWallShade;
    if(mode==='before')caveWallShade=(m,b,W,H)=>new Uint8Array(W*H).fill(255);
    let g,back;
    const start=performance.now();
    try{g=new Game({mapId:'volcano',settings:sanitizeSettings({mapId:'volcano',perTeam:1,hp:100,turnTime:0,wind:false}),teams:Profile.base.teams});back=g.raster.back;g.buildVisual();}
    finally{caveWallShade=current;}
    const buildMs=performance.now()-start,T=g.terrain,box={x:2300,y:780,w:260,h:480,k:2};
    const cv=makeCanvas(box.w*box.k,box.h*box.k),c=cv.getContext('2d');
    c.fillStyle='#7fa8d8';c.fillRect(0,0,cv.width,cv.height);c.setTransform(box.k,0,0,box.k,-box.x*box.k,-box.y*box.k);
    c.drawImage(T.decor,0,0);c.drawImage(T.canvas,0,0);
    const x0=2388,y0=940,w=70,h=240,d=T.decor.getContext('2d').getImageData(x0,y0,w,h).data;
    let sum=0,count=0,min=255,max=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
     const i=(y0+y)*T.W+x0+x,j=(y*w+x)*4;
     if(T.mask[i]||!back[i]||back[i]>2)continue;
     const L=d[j]*.2126+d[j+1]*.7152+d[j+2]*.0722;sum+=L;count++;min=Math.min(min,L);max=Math.max(max,L);
    }
    const digest=await crypto.subtle.digest('SHA-256',T.mask),maskSHA=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    return {png:cv.toDataURL('image/png'),buildMs,maskSHA,box,light:{mean:sum/count,count,min,max}};
   },mode);
   fs.writeFileSync(`test-results/cave-light/shaft-${mode}.png`,Buffer.from(result.png.split(',')[1],'base64'));delete result.png;report[mode]=result;
  }
  assert.equal(report.after.maskSHA,report.before.maskSHA,'geometry unchanged');
  assert(report.after.light.mean<report.before.light.mean*.9,'shaft must receive its missing side shadow');
  assert(report.after.light.mean>report.before.light.mean*.45,'texture must remain readable');
  assert.deepEqual(report.errors,[]);report.pass=true;
 }catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
 finally{await browser.close();fs.writeFileSync('test-results/cave-light/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e);process.exitCode=1;});
