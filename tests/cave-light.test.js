'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/terrain_visual.js'),'utf8'),ctx);
const {caveWallShade,caveAO}=vm.runInContext('({caveWallShade,caveAO})',ctx);
function grid(W=512,H=160){return {W,H,mask:new Uint8Array(W*H),back:new Uint8Array(W*H).fill(1)};}
test('An open vertical shaft receives symmetric side shading even without a ceiling',()=>{
 const g=grid();for(let y=0;y<g.H;y++){g.mask[y*g.W+100]=1;g.mask[y*g.W+226]=1;}
 const mask=g.mask.slice(),shade=caveWallShade(g.mask,g.back,g.W,g.H),row=80*g.W;
 assert(shade[row+163]<210);assert(shade[row+101]<shade[row+163]);
 for(let x=101;x<226;x++)assert.equal(shade[row+x],shade[row+326-x]);
 assert.equal(caveAO(g.mask,row+163,g.W,80,1,g.H,shade),shade[row+163]/255);
 assert.deepEqual(g.mask,mask,'visual shading must not change collisions');
});
test('Open areas and the middle of wide caves retain their previous light',()=>{
 const g=grid();let shade=caveWallShade(g.mask,g.back,g.W,g.H);assert(shade.every(v=>v===255));
 for(let y=0;y<g.H;y++){g.mask[y*g.W+10]=1;g.mask[y*g.W+500]=1;}
 shade=caveWallShade(g.mask,g.back,g.W,g.H);assert.equal(shade[80*g.W+256],255);
});
test('A solid pixel on another row never casts a side shadow across the row boundary',()=>{
 const g=grid(32,3);g.mask[31]=1;g.mask[64]=1;const shade=caveWallShade(g.mask,g.back,g.W,g.H);
 for(let x=0;x<32;x++)assert.equal(shade[32+x],255);
});
test('Building and metallic back walls remain unchanged',()=>{
 const g=grid(64,4);g.back.fill(3);for(let y=0;y<4;y++){g.mask[y*64+4]=1;g.mask[y*64+55]=1;}
 const shade=caveWallShade(g.mask,g.back,64,4);assert(shade.every(v=>v===255));
 assert.equal(caveAO(g.mask,80,64,1,3,4,shade),1);
});
test('Side shading composes with the existing ceiling shadow and floor bounce',()=>{
 const g=grid(64,100);for(let y=0;y<100;y++){g.mask[y*64+4]=1;g.mask[y*64+55]=1;}
 g.mask[40*64+30]=1;g.mask[65*64+30]=1;
 const shade=caveWallShade(g.mask,g.back,64,100),i=50*64+30;
 assert(Math.abs(caveAO(g.mask,i,64,50,1,100,shade)-caveAO(g.mask,i,64,50,1,100)*shade[i]/255)<1e-12);
});
