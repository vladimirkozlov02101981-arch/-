'use strict';
require('../dev/tools/pw-chromium.cjs');
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: `const TAU=Math.PI*2; const TexLib={surfaceHi:{}}; function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}` });
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../js/terrain.js'), 'utf8') });
    const results = await page.evaluate(() => {
      const W=64,H=48, v={x0:0,y0:0,x1:W,y1:H}, zoom=4;
      const terrain = () => {const mask=new Uint8Array(W*H);mask.fill(1,22*W);const t=new Terrain(W,H,mask);t.surface=new TerrainSurface(t);return t;};
      const add = (t,x=20,y=22) => {const c=t.surface.recorder();t.surface.anchor(x,y);c.fillStyle='#0c9aef';c.fillRect(x,y-7,2,7);};
      const draw = t => {const cv=makeCanvas(W*zoom,H*zoom),c=cv.getContext('2d');c.setTransform(zoom,0,0,zoom,0,0);t.drawSurfaceNative(c,v,zoom);return c;};
      const pixel = (c,x,y) => Array.from(c.getImageData(Math.floor((x+.25)*zoom),Math.floor((y+.25)*zoom),1,1).data);
      const check=(ok,message)=>{if(!ok)throw new Error(message);};
      const results=[];
      {
        const t=terrain(),lo=makeCanvas(8,8),hi=makeCanvas(32,32);lo.getContext('2d').fillStyle='#fff';lo.getContext('2d').fillRect(0,0,8,8);
        const hc=hi.getContext('2d');hc.fillStyle='#ff0000';hc.fillRect(0,0,32,32);hc.fillStyle='#0000ff';for(let x=1;x<32;x+=2)hc.fillRect(x,0,1,32);
        TexLib.surfaceHi.test={canvas:hi,w:32,h:32,scale:4};t.surface.sprite(lo,'test');t.surface.anchor(10,22);
        const c=t.surface.recorder();c.drawImage(lo,0,0,8,8,10,14,8,8);const output=draw(t),a=output.getImageData(40,56,2,1).data;
        check(a[0]===255&&a[2]===0&&a[4]===0&&a[6]===255,'native sprite loses its sub-world-pixel color detail');
        check(t.surface.ctx.getImageData(10,14,1,1).data[0]===255,'low fallback was not retained');results.push('source-resolution sprites and 1x fallback');
      }
      {
        const t=terrain();add(t);t.carve(20,18,2,false);check(t.isSolid(20,22),'air blast unexpectedly removed support');
        const c=draw(t);check(pixel(c,20,18)[3]===0,'reached air pixels reappeared during native replay');check(pixel(c,20,21)[3]>200,'blast deleted untouched surface detail');results.push('native damage mask keeps reached-air cuts');
      }
      {
        const t=terrain();for(let y=10;y<=15;y++)t.mask.fill(1,y*W,(y+1)*W);t.materials=new Uint8Array(W*H).fill(6);add(t);t.carve(20,2,24,false);
        check(t.isSolid(20,22),'metal cover failed to preserve support');check(pixel(draw(t),20,18)[3]>200,'surface behind intact metal cover was erased');results.push('blast cover shields retained surface');
      }
      {
        const t=terrain();add(t);t.carveLine(18,18,24,18,1);check(t.isSolid(20,22),'line cut unexpectedly removed support');check(pixel(draw(t),20,18)[3]===0,'line cut reappeared during replay');results.push('carveLine cuts remain erased');
      }
      {
        const t=terrain();t.mask.fill(0);t.mask[22*W+20]=1;add(t);t.tidy([[16,18,24,26]]);check(!t.isSolid(20,22),'tiny support was not removed');check(pixel(draw(t),20,18)[3]===0,'surface floats after tidy removes its anchor');results.push('tidy removes unsupported flowers/bushes');
      }
      {
        const t=terrain();add(t,20);add(t,50);const ids=t.surface.visible({x0:0,y0:0,x1:25,y1:30});check(ids.length>=1,'visible command selection lost surface data');
        const c=makeCanvas(32*zoom,32*zoom).getContext('2d');c.setTransform(zoom,0,0,zoom,0,0);t.drawSurfaceNative(c,{x0:0,y0:0,x1:25,y1:30},zoom);check(pixel(c,20,18)[3]===255,'visible replay failed');results.push('visible commands replay with world transform');
      }
      return results;
    });
    assert.equal(results.length,6);console.log('Surface replay PASS',results.join('; '));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
