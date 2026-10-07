'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function fixture() {
  const handlers = { window: {}, document: {}, canvas: {} }, listen = kind => (name, fn) => (handlers[kind][name] ||= []).push(fn);
  const emit = (kind, name, e = {}) => { for (const fn of handlers[kind][name] || []) fn(e); };
  const window = { addEventListener: listen('window'), innerWidth: 800, innerHeight: 600, screen: { width: 1920, height: 1080 } };
  const document = { addEventListener: listen('document'), documentElement: {}, fullscreenElement: null, hasFocus: () => true };
  const canvas = { addEventListener: listen('canvas'), clientWidth: 800, clientHeight: 600 };
  const weapons = { bazooka: { id: 'bazooka', mode: 'charge' }, sniper: { id: 'sniper', mode: 'instant' }, nuke: { id: 'nuke', mode: 'target' }, girder: { id: 'girder', mode: 'place' }, homing: { id: 'homing', mode: 'tcharge' } };
  const ctx = vm.createContext({ window, document, navigator: { webdriver: true }, setTimeout, performance: { now: () => 100 },
    FX: class {}, Sfx: { play() {}, resume() {}, chargeStop() {} }, UI: { cur: null, chatOpen: false, trayOpen: false },
    WEAPON: weapons, WEAPONS: Object.values(weapons), SPIN_WEAPONS: new Set() });
  for (const file of ['util.js', 'profile.js', 'input.js', 'render.js', 'main.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), ctx);
  const { Input, Camera, Renderer, LocalController, App, Keys, Profile } = vm.runInContext('({Input,Camera,Renderer,LocalController,App,Keys,Profile})', ctx);
  Input.init(canvas); Profile.data = { base: { settings: { preserved: true } }, configs: [] };
  const ctl = new LocalController(() => {}); ctl.myTeams = [0, 1];
  const sc = { W: 6400, H: 1800, waterY: 1550, soldiers: [{ id: 1, team: 0, alive: true, x: 3200, y: 900, aim: -0.4, st: 'stand' }], entities: [], teams: [{ ammo: {} }, { ammo: {} }], map: { ladders: [] }, turn: { sid: 1, team: 0, phase: 'aim', weapon: 'nuke', shots: 0, round: 1 } };
  const cam = new Camera(); Object.assign(cam, { inited: true, x: 3200, y: 460, z: 1, tz: 1, userZ: 1, turnKey: '0:1:1' });
  Object.assign(App, { sc, ctl, cam, demo: false, paused: false, remote: null, ren: { sw: 800, sh: 600 } });
  Input.onWheel = (d, x, y, held) => App.wheel(d, x, y, held);
  return { Input, Camera, Renderer, LocalController, App, Keys, Profile, ctl, cam, sc, emit };
}

function finiteCamera(cam, sw, sh) {
  for (const value of [cam.x, cam.y, cam.z, cam.tz, ...Object.values(cam.view(sw, sh)), ...cam.toWorld(0, 0, sw, sh), ...cam.toWorld(sw, sh, sw, sh)]) assert(Number.isFinite(value), 'nonfinite camera coordinate');
  assert(cam.z > 0);
}

test('Zoom-out stops at the complete map, while zoom-in stops at a reasonable 2.5x of the base scale', () => {
  const { cam, sc } = fixture(), sw = 800, sh = 600, max = cam.baseZoom(sh, sw) * 2.5;
  cam.binoc = true;
  for (let i = 0; i < 7000; i++) cam.zoomAt(0.9, sw / 2, sh / 2, sw, sh);
  assert.equal(cam.userZ, Math.min(sw / sc.W, sh / sc.H)); for(let i=0;i<180;i++)cam.update(1/60,sc,{shake:0,focus:null},sw,sh,null); cam.clampTo(sc, sw, sh); finiteCamera(cam, sw, sh);
  const view = cam.view(sw, sh); assert(view.x0 <= 1e-8 && view.x1 >= sc.W - 1e-8 && view.y0 <= 1e-8 && view.y1 >= sc.H - 1e-8);
  cam.zoomAt(1e308, sw / 2, sh / 2, sw, sh); cam.zoomAt(1e308, sw / 2, sh / 2, sw, sh); assert.equal(cam.userZ, max);
  for (const bad of [0, -1, NaN, Infinity]) cam.zoomAt(bad, 0, 0, sw, sh); assert.equal(cam.userZ, max);
});

test('Whole-map and extreme scales keep every edge visible and all manual pan coordinates finite', () => {
  const { Camera, sc } = fixture(), fx = { shake: 0, focus: null };
  for (const [sw, sh] of [[3840, 1080], [1440, 900], [640, 480], [390, 390]]) for (const waterY of [1480, 1500, 1560, 1600, 1660, 1720, 1760, 1780]) {
    sc.waterY = waterY;
    for (const z of [0.05, 1e-6, 1e-100, new Camera().zoomLimits(sh, sw)[0]]) for (const binoc of [false, true]) {
      const cam = new Camera(); Object.assign(cam, { inited: true, x: 3200, y: 460, z, tz: z, userZ: z, turnKey: '0:1:1', panFactor: 16, edge: !binoc, binoc });
      const clampTo = cam.clampTo; cam.clampTo = function(...args) { assert(Number.isFinite(this.x) && Number.isFinite(this.y), 'manual pan overflow before clamp'); return clampTo.apply(this, args); };
      cam.update(1 / 60, sc, fx, sw, sh, { x: sw - 1, y: sh / 2, inside: true }); finiteCamera(cam, sw, sh);
      const view = cam.view(sw, sh); assert(view.x0 <= 1e-8 && view.x1 >= sc.W - 1e-8 && view.y0 <= 1e-8 && view.y1 >= sc.H - 1e-8);
      assert.equal(cam.y, sc.H / 2);
    }
  }
});

test('Per-player speed survives weapon changes, C and camera reset, while the next battle starts at default', () => {
  const { Input, App, ctl, sc, cam, Keys, LocalController, Profile } = fixture(), before = JSON.stringify(sc), profile = JSON.stringify(Profile.base);
  assert.equal(ctl.panFactor(0), 1); App.wheel(-120, 400, 300, true); assert.equal(ctl.panFactor(0), 1.2); assert.equal(cam.userZ, 1);
  sc.turn.team = 1; assert.equal(ctl.panFactor(ctl.panTeam(sc.turn)), 1); App.wheel(120, 400, 300, true); assert.equal(ctl.panFactor(1), 1 / 1.2);
  sc.turn.team = 0; sc.turn.weapon = 'girder'; assert.equal(ctl.panFactor(ctl.panTeam(sc.turn)), 1.2);
  Keys.set({ camera: ['KeyC'] }); Input.pressed.KeyC = true; App.handleKeys(); assert.equal(cam.userZ, null); assert.equal(ctl.panFactor(0), 1.2);
  cam.reset(); assert.equal(ctl.panFactor(0), 1.2); assert.equal(ctl.panFactor(1), 1 / 1.2);
  const next = new LocalController(() => {}); next.myTeams = [0, 1]; assert.equal(next.panFactor(0), 1); assert.equal(next.panFactor(1), 1);
  sc.turn.weapon = 'nuke'; assert.equal(JSON.stringify(sc), before); assert.equal(JSON.stringify(Profile.base), profile);
});

test('CPU and network speed remains the local player choice even during an enemy turn', () => {
  const { App, ctl, sc } = fixture();
  for (const mine of [0, 1]) {
    ctl.myTeams = [mine]; sc.turn.team = 1 - mine; const before = ctl.panFactor(mine);
    assert.equal(ctl.panTeam(sc.turn), mine); App.wheel(-120, 400, 300, true); assert.equal(ctl.panFactor(mine), before * 1.2);
    App.remote = { latestTurn: { team: 1 - mine, phase: 'aim' } }; App.wheel(120, 400, 300, true); assert.equal(ctl.panFactor(mine), before); App.remote = null;
  }
});

test('Actual wheel handler requires a held middle button; release and blur restore ordinary zoom', () => {
  const { Input, emit, cam, ctl } = fixture(), wheel = (d, buttons = 0) => emit('canvas', 'wheel', { deltaY: d, buttons, clientX: 400, clientY: 300, preventDefault() {} });
  wheel(120); assert.equal(cam.userZ, 0.9); assert.equal(ctl.panFactor(0), 1);
  wheel(-120, 4); assert.equal(cam.userZ, 0.9); assert.equal(ctl.panFactor(0), 1.2);
  emit('canvas', 'mousedown', { button: 1, clientX: 400, clientY: 300, preventDefault() {} }); assert.equal(Input.mouse.down[1], true);
  wheel(120); assert.equal(ctl.panFactor(0), 1); assert.equal(cam.userZ, 0.9);
  emit('window', 'mouseup', { button: 1 }); wheel(-120); assert.equal(cam.userZ, 0.9 / 0.9); assert.equal(ctl.panFactor(0), 1);
  emit('canvas', 'mousedown', { button: 1, clientX: 400, clientY: 300, preventDefault() {} }); emit('window', 'blur'); assert.equal(Input.mouse.down[1], false);
  wheel(120); assert.equal(cam.userZ, 0.9 * (10 / 9) * 0.9); assert.equal(ctl.panFactor(0), 1);
  emit('canvas', 'mousedown', { button: 1, clientX: 400, clientY: 300, preventDefault() {} });
  emit('canvas', 'mousemove', { clientX: 402, clientY: 300, buttons: 0 }); assert.equal(Input.mouse.down[1], false);
  const oldZ = cam.userZ; wheel(-120); assert.equal(cam.userZ, oldZ * (10 / 9)); assert.equal(ctl.panFactor(0), 1);
});

test('Speed factor changes edge and binocular pan but keeps raw sniper mouse sensitivity unchanged', () => {
  const { Camera, sc, ctl, Input } = fixture(), fx = { shake: 0, focus: null }, sw = 800, sh = 600;
  const displacement = (factor, binoc = false, optic = false) => {
    const cam = new Camera(), point = { x: 3300, y: 460 }; Object.assign(cam, { inited: true, x: 3200, y: 460, z: 1, tz: 1, userZ: 1, turnKey: '0:1:1', panFactor: factor, edge: !binoc, binoc, scopeFocus: optic ? { point, locked: false, visible: true } : null });
    cam.update(1 / 60, sc, fx, sw, sh, { x: sw - 1, y: sh / 2, inside: true }); return { dx: cam.x - 3200, point };
  };
  for (const binoc of [false, true]) assert(Math.abs(displacement(2, binoc).dx / displacement(1, binoc).dx - 2) < 1e-12);
  assert(Math.abs((displacement(16, false, true).point.x - 3300) / (displacement(1, false, true).point.x - 3300) - 16) < 1e-10);
  const cam = new Camera(); Object.assign(cam, { x: 3200, y: 460, z: 2 }); sc.turn.weapon = 'sniper'; Input.mouse.x = 500; Input.mouse.y = 300; ctl.update(1 / 60, sc, cam, sw, sh, sc.turn);
  const before = ctl.scopePoint.x; Input.locked = true; Input.mouse.dx = 120; Input.mouse.dy = 0; Input.mouse.moved = true; cam.panFactor = 16;
  ctl.update(1 / 60, sc, cam, sw, sh, sc.turn); assert.equal(ctl.scopePoint.x - before, 60);
});

test('Liquid wave work stays bounded at extreme zoom and subpixel reflections draw no zero-sized source', () => {
  const { Renderer, Camera, sc } = fixture(); let lines = 0, images = 0, transform;
  const grad = { addColorStop() {} }, c = new Proxy({ canvas: { width: 1440, height: 900 }, getTransform: () => transform, createLinearGradient: () => grad, lineTo(...a) { assert(a.every(Number.isFinite)); lines++; }, drawImage() { images++; } }, { get(target, key) { return key in target ? target[key] : (...a) => { for (const v of a) if (typeof v === 'number') assert(Number.isFinite(v)); }; } });
  const ren = new Renderer({ getContext: () => c }); ren.dpr = 1; sc.theme = { liquid: { kind: 'water', top: '#135780', mid: '#112244', deep: '#001122', foam: '#abcdef', alpha: 0.8 } };
  for (const z of [1e-6, 1e-100, 1e-250]) {
    const cam = new Camera(); cam.z = z; cam.clampTo(sc, 1440, 900); transform = { a: z, d: z, e: 720 - cam.x * z, f: 450 - cam.y * z };
    lines = images = 0; ren.drawLiquid(c, sc, cam.view(1440, 900), 1, true); ren.drawLiquid(c, sc, cam.view(1440, 900), 1, false);
    assert(lines < 3700, 'unbounded water tessellation'); assert.equal(images, 0, 'zero height reflection source');
  }
});


test('Full-map zoom opens both edges at the same pace and reaches the center without a final cut',()=>{const {Camera,sc}=fixture(),fx={shake:0,focus:null};for(const [sw,sh] of[[1440,900],[3840,1080],[800,600],[390,844]])for(const x of[700,5700]){
const cam=new Camera(),z0=cam.baseZoom(sh,sw)*1.3;Object.assign(cam,{inited:true,x,y:1100,z:z0,tz:z0,userZ:z0,turnKey:'0:1:1'});const before=cam.view(sw,sh),targetZ=Math.min(sw/sc.W,sh/sc.H),full={x0:3200-sw/2/targetZ,x1:3200+sw/2/targetZ,y0:900-sh/2/targetZ,y1:900+sh/2/targetZ};
cam.zoomAt(1e-9,17,29,sw,sh);assert.equal(cam.x,x);assert.equal(cam.z,z0);const frames=[];for(let i=0;i<180;i++){cam.update(1/60,sc,fx,sw,sh,null);const view=cam.view(sw,sh),progress=['x0','x1','y0','y1'].map(k=>(view[k]-before[k])/(full[k]-before[k]));for(const p of progress)assert(Math.abs(p-progress[0])<1e-8,'unequal border progress');frames.push({x:cam.x,z:cam.z,u:progress[0]});finiteCamera(cam,sw,sh);}
assert.equal(cam.x,3200);assert.equal(cam.y,900);assert.equal(cam.z,targetZ);assert(frames[0].u<.03&&frames[0].u>0);for(let i=1;i<frames.length;i++){assert(frames[i].u>=frames[i-1].u-1e-10);assert(frames[i].u-frames[i-1].u<.05);}
const point={x:6000,y:850};cam.scopeFocus={point,locked:true,visible:true,moving:true};cam.update(1/60,sc,fx,sw,sh,null);assert.equal(cam.mapZoom,null);assert.deepEqual(point,{x:6000,y:850});
}});

test('After arrows, a stationary unlocked edge resumes scope travel all the way to each map boundary',()=>{const {Camera,sc}=fixture(),fx={shake:0,focus:null},sw=1440,sh=900;sc.turn.weapon='sniper';sc.soldiers[0].x=3200;sc.soldiers[0].y=900;for(const [x,y,expect] of[[1439,450,[6399,820]],[0,450,[0,820]],[720,0,[3300,-900]],[720,899,[3300,1799]]]){const point={x:3300,y:820},cam=new Camera();Object.assign(cam,{inited:true,x:3200,y:842,z:2,tz:2,userZ:2,turnKey:'0:1:1',manual:{x:1,y:0},scopeFocus:{point,locked:false,visible:true,moving:false},edge:true});const mouse={x,y,inside:true};cam.update(1/60,sc,fx,sw,sh,mouse);assert.deepEqual(point,{x:3300,y:820});cam.manual={x:0,y:0};for(let i=0;i<600;i++)cam.update(1/60,sc,fx,sw,sh,mouse);assert.equal(cam.manualActive,false);assert.deepEqual([point.x,point.y],expect);}});
