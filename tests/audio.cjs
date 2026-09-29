'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  try {
    const page=await browser.newPage();
    await page.addInitScript(()=>{
      const connect=AudioNode.prototype.connect;
      AudioNode.prototype.connect=function(destination,...rest){
        if(destination===this.context.destination){
          const analyser=this.context.createAnalyser();analyser.fftSize=2048;
          connect.call(this,analyser);window.soundMeter=analyser;
        }
        return connect.call(this,destination,...rest);
      };
    });
    await page.goto('http://localhost:3000');await page.waitForSelector('#s-main.show');await page.click('[data-act="hotseat"]');
    const levels=await page.evaluate(async()=>{
      Sfx.setSilent(false);Sfx.toggle(true);Sfx.setVolume(.7);Sfx.setScene(null);
      // Disable camera listener updates so distance measurements stay reproducible.
      Sfx.setListener(0,0,1,1440);Sfx.setListener=()=>{};
      const results={},samples=new Float32Array(2048);
      for(const kind of ['shot','revolver','shotgun','sniper','autocannon','explosion','footstep','metalImpact','woodImpact','stoneImpact']){
        let peak=0,energy=0,n=0;Sfx.play(kind,{x:0,y:0},1);
        const end=performance.now()+650;
        while(performance.now()<end){
          soundMeter.getFloatTimeDomainData(samples);
          for(const v of samples){peak=Math.max(peak,Math.abs(v));energy+=v*v;n++;}
          await new Promise(r=>setTimeout(r,15));
        }
        results[kind]={peak,rms:Math.sqrt(energy/n)};
        await new Promise(r=>setTimeout(r,1300));
      }
      Sfx.setVolume(0);await new Promise(r=>setTimeout(r,450));Sfx.play('shot',{x:0,y:0});await new Promise(r=>setTimeout(r,60));
      soundMeter.getFloatTimeDomainData(samples);results.muted={peak:Math.max(...samples.map(Math.abs))};return results;
    });
    for(const [kind,level] of Object.entries(levels))if(kind!=='muted')assert(level.peak>0.0001&&level.peak<=1,kind+' emits valid audio');
    assert(levels.muted.peak<0.0001,'Volume zero mutes the output');
    fs.writeFileSync('test-results/audio.json',JSON.stringify(levels,null,2));console.log('10 sound events and volume control PASS',levels);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
