'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function fixture(isTouchDevice = true) {
  const handlers = { window: {}, document: {}, canvas: {} }, listen = kind => (name, fn) => (handlers[kind][name] ||= []).push(fn);
  const emit = (kind, name, e = {}) => { for (const fn of handlers[kind][name] || []) fn(e); };
  const mockClassList = () => {
    const classes = new Set();
    return {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) { if (classes.has(c)) classes.delete(c); else classes.add(c); }
        else if (force) classes.add(c); else classes.delete(c);
        return classes.has(c);
      },
      contains: c => classes.has(c)
    };
  };
  const mockElement = () => ({
    classList: mockClassList(),
    addEventListener: () => {},
    querySelector: () => mockElement(),
    querySelectorAll: () => []
  });
  const window = {
    addEventListener: listen('window'),
    removeEventListener: () => {},
    innerWidth: 800,
    innerHeight: 400,
    ontouchstart: isTouchDevice ? {} : undefined,
    matchMedia: () => ({ matches: isTouchDevice }),
    screen: { width: 800, height: 400 }
  };
  let fullscreenEl = null;
  const document = {
    addEventListener: listen('document'),
    documentElement: {
      requestFullscreen: async () => { fullscreenEl = document.documentElement; }
    },
    get fullscreenElement() { return fullscreenEl; },
    exitFullscreen: async () => { fullscreenEl = null; },
    getElementById: id => (id === 'touch-controls' ? mockElement() : null),
    hasFocus: () => true
  };
  const canvas = {
    addEventListener: listen('canvas'),
    clientWidth: 800,
    clientHeight: 400,
    requestPointerLock: () => {}
  };
  const weapons = {
    bazooka: { id: 'bazooka', mode: 'charge', ammo: 5 },
    sniper: { id: 'sniper', mode: 'instant', ammo: 5 },
    nuke: { id: 'nuke', mode: 'target', ammo: 1 }
  };
  const sentCmds = [];
  const ctx = vm.createContext({
    window, document, navigator: { maxTouchPoints: isTouchDevice ? 5 : 0 },
    setTimeout, performance: { now: () => 100 },
    FX: class {}, Sfx: { play() {}, resume() {}, chargeStart() {}, chargeSet() {}, chargeStop() {}, enabled: true, toggle() {} },
    UI: { cur: null, chatOpen: false, trayOpen: false, updateSoundIcon() {} },
    WEAPON: weapons, WEAPONS: Object.values(weapons), SPIN_WEAPONS: new Set()
  });
  for (const file of ['util.js', 'profile.js', 'input.js', 'render.js', 'main.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), ctx);
  }
  const { Input, Camera, LocalController, App, Keys } = vm.runInContext('({Input,Camera,LocalController,App,Keys})', ctx);
  Input.init(canvas);
  const ctl = new LocalController(cmd => sentCmds.push(cmd));
  ctl.myTeams = [0];
  const sc = {
    W: 6400, H: 1800, waterY: 1550, simul: false, round: 1,
    soldiers: [
      { id: 1, name: 1, team: 0, alive: true, x: 1000, y: 500, aim: 0, st: 'stand' },
      { id: 2, name: 2, team: 0, alive: true, x: 1200, y: 500, aim: 0, st: 'stand' },
      { id: 3, name: 3, team: 1, alive: true, x: 2000, y: 500, aim: 0, st: 'stand' }
    ],
    entities: [],
    teams: [{ ammo: { bazooka: 5, sniper: 5 } }, { ammo: {} }],
    map: { ladders: [] },
    turn: { sid: 1, team: 0, phase: 'aim', weapon: 'bazooka', shots: 0, round: 1 }
  };
  const cam = new Camera();
  Object.assign(cam, { inited: true, x: 1000, y: 500, z: 1, tz: 1, userZ: 1 });
  Object.assign(App, { sc, ctl, cam, demo: false, paused: false, ren: { sw: 800, sh: 400 } });
  Input.onWheel = (d, x, y, held) => App.wheel(d, x, y, held);

  return { Input, Camera, LocalController, App, Keys, ctl, cam, sc, emit, canvas, sentCmds, document };
}

test('Touch controls: detection and Keys integration on mobile', () => {
  const f = fixture(true);
  assert.strictEqual(f.Input.isTouch, true, 'isTouch should be true on touch device');

  // Input.touchKeys maps to Keys.down
  assert.strictEqual(f.Keys.down('left'), false);
  f.Input.touchKeys.left = true;
  assert.strictEqual(f.Keys.down('left'), true, 'Keys.down should reflect Input.touchKeys');
  f.Input.touchKeys.left = false;
  assert.strictEqual(f.Keys.down('left'), false);

  // Input.touchPressed maps to Keys.hit and clears in endFrame
  f.Input.touchPressed.jump = true;
  assert.strictEqual(f.Keys.hit('jump'), true, 'Keys.hit should reflect Input.touchPressed');
  f.Input.endFrame();
  assert.strictEqual(f.Keys.hit('jump'), false, 'touchPressed should clear after endFrame');
});

test('Touch controls: canvas single tap and drag aiming', () => {
  const f = fixture(true);
  const preventDefault = () => {};

  // Touch down and drag
  f.emit('canvas', 'touchstart', {
    touches: [{ identifier: 0, clientX: 200, clientY: 150 }],
    preventDefault
  });
  assert.strictEqual(f.Input.mouse.x, 200);
  assert.strictEqual(f.Input.mouse.y, 150);

  // Touch move
  f.emit('canvas', 'touchmove', {
    touches: [{ identifier: 0, clientX: 250, clientY: 180 }],
    preventDefault
  });
  assert.strictEqual(f.Input.mouse.x, 250);
  assert.strictEqual(f.Input.mouse.y, 180);
  assert.strictEqual(f.Input.mouse.moved, true);

  // Touch end short tap generates click
  f.emit('canvas', 'touchstart', {
    touches: [{ identifier: 1, clientX: 300, clientY: 300 }],
    preventDefault
  });
  f.emit('canvas', 'touchend', {
    touches: [],
    preventDefault
  });
  assert.strictEqual(f.Input.mouse.clicked[0], true, 'Short tap should produce mouse click for target weapon');
});

test('Touch controls: pinch gesture changes zoom', () => {
  const f = fixture(true);
  let wheelDelta = 0;
  f.Input.onWheel = (d) => { wheelDelta = d; };
  const preventDefault = () => {};

  // Two fingers start 100px apart
  f.emit('canvas', 'touchstart', {
    touches: [
      { identifier: 0, clientX: 200, clientY: 200 },
      { identifier: 1, clientX: 300, clientY: 200 }
    ],
    preventDefault
  });
  assert.strictEqual(f.Input.pinchDist, 100);

  // Fingers spread to 150px apart (zoom in)
  f.emit('canvas', 'touchmove', {
    touches: [
      { identifier: 0, clientX: 175, clientY: 200 },
      { identifier: 1, clientX: 325, clientY: 200 }
    ],
    preventDefault
  });
  assert.ok(wheelDelta < 0, 'Spreading fingers should produce zoom-in wheel event');
});

test('Touch controls: charge weapon fires on touch fire release', () => {
  const f = fixture(true);
  const { ctl, sc, cam, Input } = f;
  ctl.myTeams = [0];

  // Touch fire button pressed
  Input.touchKeys.fire = true;
  Input.touchPressed.fire = true;
  ctl.update(0.016, sc, cam, 800, 400, sc.turn);
  Input.endFrame();

  assert.strictEqual(ctl.charging, true, 'Controller should start charging');

  // Hold fire for 0.5 sec
  for (let i = 0; i < 30; i++) {
    ctl.update(0.016, sc, cam, 800, 400, sc.turn);
    Input.endFrame();
  }
  assert.ok(ctl.power > 0.2, 'Power should increase while held');

  // Release touch fire button
  Input.touchKeys.fire = false;
  ctl.update(0.016, sc, cam, 800, 400, sc.turn);
  Input.endFrame();

  assert.strictEqual(ctl.charging, false, 'Charging should stop after release');
  const fireCmd = f.sentCmds.find(c => c.c === 'fire');
  assert.ok(fireCmd, 'Fire command should be sent on touch release');
  assert.ok(fireCmd.pw > 0.2, 'Fire command should have accumulated power');
});

test('Touch controls: cycle fighter in simultaneous mode', () => {
  const f = fixture(true);
  f.sc.simul = true;
  f.sc.turn.sid = 1;
  f.ctl.myTeams = [0];
  f.ctl.update(0.016, f.sc, f.cam, 800, 400, f.sc.turn);

  f.Input.cycleFighter();
  const soldierCmd = f.sentCmds.find(c => c.c === 'soldier');
  assert.ok(soldierCmd, 'cycleFighter should emit soldier switch in simultaneous mode');
  assert.strictEqual(soldierCmd.number, 2, 'Should cycle to next team soldier');
});

test('Touch controls: toggle fullscreen', async () => {
  const f = fixture(true);
  assert.strictEqual(f.document.fullscreenElement, null);
  await f.Input.toggleFullscreen();
  assert.ok(f.document.fullscreenElement !== null, 'Fullscreen should be active');
  await f.Input.toggleFullscreen();
  assert.strictEqual(f.document.fullscreenElement, null, 'Fullscreen should be exited');
});
