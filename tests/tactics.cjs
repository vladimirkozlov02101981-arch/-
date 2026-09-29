'use strict';
const {chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});await page.goto('http://localhost:3000');await page.waitForSelector('#s-main.show');
    const maps=await page.evaluate(()=>MAPS.map(m=>{
      const cfg={mapId:m.id,settings:{...App.prefs.settings,perTeam:6,crates:false,sd:0},teams:App.prefs.teams};
      const g=new Game(cfg);
      const ladders=m.ladders.map(l=>{for(let y=l.y1;y<=l.y2;y++)if(!bodyFree(g.terrain,l.x,y))return false;return true;});
      return {id:m.id,safe:g.soldiers.length===12&&g.soldiers.every(s=>bodyFree(g.terrain,s.x,s.y)&&onGround(g.terrain,s.x,s.y)),ladders};
    }));
    assert(maps.every(m=>m.safe&&m.ladders.every(Boolean)));console.log('All 8 maps: 12 safe spawns and unobstructed ladder shafts PASS',maps);
    assert(await page.evaluate(()=>{
      const g=new Game({mapId:'valley',settings:{...App.prefs.settings,perTeam:2,crates:false,sd:0},teams:App.prefs.teams});
      const s=g.soldiers[0],l=g.map.ladders[0];s.x=l.x;s.y=(l.y1+l.y2)/2;s.st='climb';s.die(g,'hit');
      for(let i=0;i<600;i++)g.step(1/60);
      return !s.alive&&s.gone;
    }),'A dead climber falls and leaves the battlefield');
    await page.evaluate(()=>App.startLocal({mapId:'valley',settings:{...App.prefs.settings,perTeam:2,turnTime:90,crates:false,sd:0},teams:App.prefs.teams},'cpu'));
    await page.waitForFunction(()=>App.mode==='cpu'&&App.game?.turn.phase==='aim');
    await page.evaluate(async()=>{await MapArt.get('valley').decode();App.cam.overview=true;});await page.waitForTimeout(2000);await page.screenshot({path:'test-results/map-valley.png'});
    await page.evaluate(()=>{const g=App.game,cmd=g.cmd;window.aiFireCount=0;g.cmd=function(team,c){if(team===1&&c.c==='fire')window.aiFireCount++;return cmd.call(this,team,c);};g.cmd(0,{c:'skip'});});
    await page.waitForFunction(()=>window.aiFireCount>0,{},{timeout:45000});await page.waitForFunction(()=>App.game.turn.team===0&&App.game.turn.phase==='aim',{},{timeout:45000});
    await page.screenshot({path:'test-results/cpu.png'});console.log('AI chooses, fires and completes its turn PASS');
    fs.writeFileSync('test-results/tactics.json',JSON.stringify({passed:true,maps,ai:true,date:new Date().toISOString()},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
