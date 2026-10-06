'use strict';
require('./pw-chromium.cjs');
const { chromium } = require('playwright');
const fs = require('node:fs');
const label = process.argv[2] || 'after';
const mapId = process.argv[3] || 'valley';
const targetMode = process.argv[4] || 'ground';
let base = process.env.TEST_URL, localServer = null;
(async () => {
  if (!base) {
    const { createServer } = require('../../server.js');
    await new Promise((resolve) => {
      const http = require('node:http');
      const req = http.get('http://localhost:3001/', () => { base = 'http://localhost:3001'; resolve(); });
      req.on('error', () => {
        const { server } = createServer(); localServer = server;
        server.listen(0, '127.0.0.1', () => { base = 'http://localhost:' + server.address().port; resolve(); });
      });
    });
  }
  const browser = await chromium.launch({headless:true});
  const errors = [];
  try {
    const page = await browser.newPage({viewport:{width:1580,height:890}});
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.waitForSelector('#s-main.show', {timeout:120000});
    await page.evaluate(async (mapId) => {
      await TexLib.load();
      App.startLocal({mapId,settings:{...App.prefs.settings,perTeam:2,turnTime:90,wind:false},teams:App.prefs.teams},'hotseat');
    }, mapId);
    await page.waitForFunction(() => App.game?.turn.phase === 'aim', null, {timeout:120000});
    await page.evaluate(async (targetMode) => {
      await MapArt.get(App.sc.map.id).decode();
      App.paused = true;
      window.__sharpNames=[...new Set(App.sc.terrain.texRef.tab.filter(Boolean).map(e=>e.name))];
      for(const n of window.__sharpNames){TexLib.loadHi(n);if(TexLib.loadFine)TexLib.loadFine(n);if(TexLib.loadNative)TexLib.loadNative(n);}
      if (targetMode === 'cave') {
        App.cam.x = 1146;
        App.cam.y = 1352;
      } else if (targetMode === 'cap') {
        let gx = 1200;
        for (let x = 400; x < 2500; x += 50) {
          const y = App.sc.terrain.findTop(x, 0);
          if (App.sc.terrain.materialAt(x, y + 5) === 1) { gx = x; break; }
        }
        const gy = App.sc.terrain.findTop(gx, 0);
        App.cam.x = gx;
        App.cam.y = gy;
      } else {
        const s = App.sc.soldiers.find(o => o.id === App.game.turn.sid);
        App.cam.x = s.x;
        App.cam.y = s.y - 115;
      }
      App.cam.inited = true; App.cam.free = 999; App.cam.sx = App.cam.sy = 0;
    }, targetMode);
    await page.waitForFunction(()=>window.__sharpNames.every(n=>(!TexLib.hiAvail.has(n)||TexLib.hi[n])&&(!TexLib.fineAvail?.has(n)||TexLib.fine[n])&&(!TexLib.nativeAvail?.has(n)||TexLib.native[n])),null,{timeout:60000});
    fs.mkdirSync('test-results/sharpness', {recursive:true});
    const views = [];
    for (const zoom of [2.5, 6.35]) {
      await page.evaluate(z => {App.cam.userZ = App.cam.z = App.cam.tz = z;}, zoom);
      await page.waitForFunction(() => {
        const hr=App.ren.hires;
        if(!hr || !hr.tiles.size || hr.pending.size || !hr.workers.every(w=>w.idle)) return false;
        const v=App.cam.view(App.ren.sw,App.ren.sh,30),T=128;
        for(let y=Math.max(0,Math.floor(v.y0/T));y<=Math.min(Math.ceil(App.sc.H/T)-1,Math.floor(v.y1/T));y++)
          for(let x=Math.max(0,Math.floor(v.x0/T));x<=Math.min(Math.ceil(App.sc.W/T)-1,Math.floor(v.x1/T));x++) if(!hr.tiles.has(x+','+y)) return false;
        return true;
      }, null, {timeout:60000});
      await page.waitForTimeout(500);
      const state=await page.evaluate(() => ({zoom:App.cam.z,x:App.cam.x,y:App.cam.y,tiles:App.ren.hires.tiles.size,resolution:[...App.ren.hires.tiles.values()][0].cv.width,details:App.ren.hires.hc,version:document.querySelector('#game-version')?.textContent}));
      await page.screenshot({path:`test-results/sharpness/${label}-${zoom}.png`});
      views.push(state);
    }
    if(errors.length) throw Error(errors.join('\n'));
    fs.writeFileSync(`test-results/sharpness/${label}.json`,JSON.stringify({views,errors},null,2));
    console.log(JSON.stringify({views,errors}));
  } finally { await browser.close(); process.exit(0); }
})().catch(e=>{console.error(e);process.exitCode=1;});
