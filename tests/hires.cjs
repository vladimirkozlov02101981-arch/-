'use strict';
require('../dev/tools/pw-chromium.cjs');
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: `function makeCanvas(w,h) { const c=document.createElement('canvas');c.width=w;c.height=h;return c; } const TexLib={hi:{}, loadHi(n){return this.hi[n] || null;}};` });
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../js/hires.js'), 'utf8') });
    const results = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const results = [], W=512,H=512,T=HIRES_T,S=HIRES_S,G=typeof HIRES_G==='undefined'?0:HIRES_G;
      const hiData=new Uint8Array(64*64); for(let y=0;y<64;y++) for(let x=0;x<64;x++) hiData[y*64+x]=Math.round(128+18*Math.sin(x*.43)*Math.cos(y*.37));
      TexLib.hi.test={name:'test',w:64,h:64,d:hiData};
      for(const kind of ['opaque','translucent','texture','opaque-mixed','translucent-mixed']) {
        const canvas=makeCanvas(W,H), decor=makeCanvas(W,H), ctx=canvas.getContext('2d'), image=ctx.createImageData(W,H);
        for(let y=0;y<H;y++) for(let x=0;x<W;x++) {const i=(y*W+x)*4;image.data[i]=kind==='texture'?Math.round(110+30*Math.sin(x*.17)):127;image.data[i+1]=kind==='texture'?Math.round(90+22*Math.cos(y*.13)):95;image.data[i+2]=63;image.data[i+3]=kind.startsWith('translucent')?128:255;}
        ctx.putImageData(image,0,0);
        const mask=new Uint8Array(W*H);mask.fill(1);
        const texRef=kind==='texture'?{tab:[null,{name:'test',w:32,dx:7.375,dy:-11.125}],F:new Uint8Array(W*H).fill(1),B:new Uint8Array(W*H)}:null;
        const terrain={canvas,decor,mask,texRef,version:0,touches:[]},sc={W,H,terrain},hr=new HiResTerrain();hr.pool();hr.sync(terrain);
        for(let step=0;hr.tiles.size<16&&step<600;step++){for(let ty=0;ty<4;ty++)for(let tx=0;tx<4;tx++){const key=tx+','+ty;if(!hr.tiles.has(key)&&!hr.pending.has(key))hr.request(sc,tx,ty);}await wait(10);}
        if(hr.tiles.size!==16) throw new Error('Worker tiles did not finish');
        // Reuse pixels computed by the real workers, then draw them once as a continuous reference.
        // This compares compositing and sampling without duplicating the terrain algorithm.
        const full=makeCanvas(W*S,H*S),fc=full.getContext('2d');
        for(let ty=0;ty<4;ty++)for(let tx=0;tx<4;tx++){const cv=hr.tiles.get(tx+','+ty).cv;const core=cv.getContext('2d').getImageData(G*S,G*S,T*S,T*S);fc.putImageData(core,tx*T*S,ty*T*S);}
        let overlapError=0;
        if(G) for(let ty=0;ty<4;ty++)for(let tx=0;tx<3;tx++){const a=hr.tiles.get(tx+','+ty).cv.getContext('2d').getImageData((G+T)*S,G*S,G*S,T*S).data,b=hr.tiles.get((tx+1)+','+ty).cv.getContext('2d').getImageData(G*S,G*S,G*S,T*S).data;for(let i=0;i<a.length;i++)overlapError=Math.max(overlapError,Math.abs(a[i]-b[i]));}
        if(G) for(let ty=0;ty<3;ty++)for(let tx=0;tx<4;tx++){const a=hr.tiles.get(tx+','+ty).cv.getContext('2d').getImageData(G*S,(G+T)*S,T*S,G*S).data,b=hr.tiles.get(tx+','+(ty+1)).cv.getContext('2d').getImageData(G*S,G*S,T*S,G*S).data;for(let i=0;i<a.length;i++)overlapError=Math.max(overlapError,Math.abs(a[i]-b[i]));}
        // Missing cached tiles exercise the fallback while neighboring tiles already use the workers.
        if(kind.endsWith('-mixed')) { for(let ty=0;ty<4;ty++)for(let tx=0;tx<4;tx++)if((tx+ty)%2)hr.tiles.delete(tx+','+ty);hr.request=()=>false; }
        let maxError=0,badPixels=0,seamPixels=0,cases=0, worst=null;
        for(const dpr of [1,1.25,1.5,2])for(const zoom of [1.17,1.33,1.875,2.1,3.27,5.142857142857143])for(const shift of [.13,.37,.71]){
          const out=makeCanvas(Math.round(256*dpr),Math.round(192*dpr)),ref=makeCanvas(out.width,out.height),zp=zoom*dpr,ox=out.width/2-256*zp+shift*dpr,oy=out.height/2-256*zp+(1-shift)*dpr;
          const fill=c=>{const cc=c.getContext('2d');cc.fillStyle='#204060';cc.fillRect(0,0,c.width,c.height);cc.imageSmoothingEnabled=true;cc.imageSmoothingQuality='high';cc.setTransform(zp,0,0,zp,ox,oy);return cc;};
          const oc=fill(out),rc=fill(ref);hr.draw(oc,sc,{x0:0,y0:0,x1:W,y1:H},zp);rc.drawImage(full,0,0,full.width,full.height,0,0,W,H);
          const a=oc.getImageData(0,0,out.width,out.height).data,b=rc.getImageData(0,0,out.width,out.height).data;let local=0,localBad=0,localSeam=0;
          for(let y=2;y<out.height-2;y++)for(let x=2;x<out.width-2;x++){const i=(y*out.width+x)*4;let e=0;for(let q=0;q<4;q++)e=Math.max(e,Math.abs(a[i+q]-b[i+q]));if(e>local)local=e;if(e>1)localBad++;if(e>1&&(Math.abs(x-(256*zp+ox))<2||Math.abs(y-(256*zp+oy))<2))localSeam++;}
          if(local>maxError){maxError=local;worst={dpr,zoom,shift,error:local};}badPixels+=localBad;seamPixels+=localSeam;cases++;
        }
        results.push({kind,cases,maxError,badPixels,seamPixels,overlapError,worst,tileSize:hr.tiles.get('0,0').cv.width});for(const wk of hr.workers)wk.terminate();
      }
      return results;
    });
    const reportDir=path.join(__dirname,'../test-results');fs.mkdirSync(reportDir,{recursive:true});
    // GPU sampling may round textured colors by two levels; uniform alpha must match exactly.
    const passed=results.every(r=>r.maxError<=(r.kind==='texture'?2:0)&&r.overlapError===0);
    fs.writeFileSync(path.join(reportDir,'hires-seams-report.json'),JSON.stringify({passed,date:new Date().toISOString(),results},null,2));
    console.log(JSON.stringify(results));
    for(const result of results) {assert(result.maxError <= (result.kind==='texture'?2:0),JSON.stringify(result));assert.equal(result.overlapError,0,JSON.stringify(result));}
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
