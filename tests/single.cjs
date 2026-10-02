'use strict';
require('../dev/tools/pw-chromium.cjs');
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
(async()=>{
 const root=path.resolve(__dirname,'..'),artifact=path.join(root,'dist/Territory-War.html'),buf=fs.readFileSync(artifact),html=buf.toString('utf8');
 const expectedVersion=String(process.argv[2]||fs.readFileSync(path.join(root,'index.html'),'utf8').match(/id="game-version">[^<]*-(\d+)/)[1]).replace(/^--version=?/,'');
 const report={artifact,bytes:buf.length,version:html.match(/id="game-version">([^<]+)/)?.[1],expectedVersion,embedded:[],errors:[],externalRequests:[],serverRequests:[]};
 const a=html.indexOf('window.__ASSETS=')+'window.__ASSETS='.length,b=html.indexOf(';function ASSET(p)',a),assets=JSON.parse(html.slice(a,b));
 assert(report.version.endsWith('-'+expectedVersion),'expected version '+expectedVersion+' but found '+report.version);
 for(const dir of ['fine','surface'])for(const name of fs.readdirSync(path.join(root,'assets/tex',dir))){
  const relative='assets/tex/'+dir+'/'+name,bytes=fs.readFileSync(path.join(root,relative)),embedded=Buffer.from(assets[relative].split(',')[1],'base64');
  assert(bytes.equals(embedded),relative+' embedded bytes differ');report.embedded.push({path:relative,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),exact:true});
 }
 let browser,server;
 try{
  server=http.createServer((req,res)=>{report.serverRequests.push(req.url);if(req.url!=='/'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(buf);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.route('**/*',route=>{const u=route.request().url();if(u===url||u.startsWith('data:')||u.startsWith('blob:'))return route.continue();report.externalRequests.push(u);return route.abort();});
  await page.goto(url,{waitUntil:'load',timeout:60000});await page.waitForSelector('#s-main.show',{timeout:60000});
  await page.evaluate(()=>App.startLocal({mapId:'valley',settings:{...App.prefs.settings,perTeam:2,turnTime:90,crates:false,sd:0},teams:App.prefs.teams},'hotseat'));
  await page.waitForFunction(()=>App.game?.turn.phase==='aim'&&App.mode==='hotseat',{timeout:60000});
  report.zoom=await page.evaluate(()=>{const s=App.game.active(),z=App.cam.zoomLimits(App.ren.sh,App.ren.sw)[1];Object.assign(App.cam,{userZ:z,z,tz:z,x:s.x,y:s.y-40,free:999,inited:true});return z;});
  await page.waitForFunction(()=>TexLib.fine.dirt_valley?.d.length&&TexLib.surfaceHi.grass_valley?.w===2048&&App.ren.hires?.scale===8&&[...App.ren.hires.tiles.values()].some(t=>t.cv.width===1040),{timeout:60000});
  report.runtime=await page.evaluate(()=>({version:document.getElementById('game-version').textContent,mode:App.mode,phase:App.game.turn.phase,fine:{width:TexLib.fine.dirt_valley.w,height:TexLib.fine.dirt_valley.h,scale:TexLib.fine.dirt_valley.scale},nativeGrass:{width:TexLib.surfaceHi.grass_valley.w,height:TexLib.surfaceHi.grass_valley.h,scale:TexLib.surfaceHi.grass_valley.scale},surfaceCommands:App.sc.terrain.surface.commands?.length??App.sc.terrain.surface.ops?.length,hiresScale:App.ren.hires.scale,tileWidths:[...new Set([...App.ren.hires.tiles.values()].map(t=>t.cv.width))],workers:App.ren.hires.workers.length}));
  report.materials=await page.evaluate(()=>{
   const coefficients=JSON.parse('['+Terrain.prototype.blastRays.toString().match(/const K = \[([^\]]+)/)[1]+']'),erased={};
   for(const [name,id] of Object.entries({soil:1,rock:2,brick:3,wood:4,concrete:5,metal:6,ice:7,crystal:8,basalt:9})){
    const t=Object.create(Terrain.prototype);Object.assign(t,{W:128,H:128,mask:new Uint8Array(128*128).fill(1),materials:new Uint8Array(128*128).fill(id)});t.blastRays(64,64,40);erased[name]=t.mask.reduce((n,v)=>n+(v===0),0);
   }
   return {netVersion:NET_VERSION,coefficients,erased};
  });
  assert.deepEqual(report.materials.coefficients,[1,1.12,.8,.76,1.1,.56,.36,.8,.72,.72]);
  assert(report.materials.erased.soil>report.materials.erased.rock&&report.materials.erased.rock>report.materials.erased.concrete&&report.materials.erased.concrete>report.materials.erased.metal);assert.equal(report.materials.netVersion,7);
  await page.evaluate(()=>App.ctl.select('sniper'));await page.waitForFunction(()=>App.game.turn.weapon==='sniper'&&App.ctl.scopeOn);
  report.sniper={aim:[]};
  async function aimAt(x,y,scope){await page.mouse.move(x,y);await page.waitForTimeout(120);const r=await page.evaluate(()=>{const s=App.game.active();return {base:App.ctl.base,expected:Math.atan2(App.ctl.mouseW.y-(s.y-GUN_Y),App.ctl.mouseW.x-s.x),scopeOn:App.ctl.scopeOn,mode:App.ctl.aimMode};});assert(Math.abs(r.base-r.expected)<1e-8);assert.equal(r.scopeOn,scope);assert.equal(r.mode,'mouse');report.sniper.aim.push({x,y,...r});}
  await aimAt(1040,250,true);await aimAt(390,330,true);
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>!App.ctl.scopeOn);await aimAt(1080,280,false);
  await page.keyboard.press('KeyE');await page.waitForFunction(()=>App.ctl.scopeOn);
  report.sniper.before=await page.evaluate(()=>({ammo:App.game.teams[App.game.turn.team].ammo.sniper,shots:App.game.turn.shots}));
  await page.mouse.click(1080,280);await page.waitForFunction(()=>App.game.turn.shots===1);
  report.sniper.after=await page.evaluate(()=>({ammo:App.game.teams[App.game.turn.team].ammo.sniper,shots:App.game.turn.shots,phase:App.game.turn.phase}));
  assert.equal(report.sniper.after.ammo,report.sniper.before.ammo-1);assert.equal(report.sniper.after.shots,1);
  assert.equal(report.errors.length,0);assert.equal(report.externalRequests.length,0);assert.deepEqual(report.serverRequests,['/']);report.pass=true;
 }catch(e){report.pass=false;report.failure=e.stack;process.exitCode=1;}
 finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));fs.mkdirSync(path.join(root,'test-results/sharpness'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/sharpness/single-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e);process.exitCode=1;});
