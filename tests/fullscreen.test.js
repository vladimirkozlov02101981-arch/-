'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

function fixture({ allowed = true, native = false, webdriver = false, allowFull = false, keyboard = false } = {}) {
  const handlers = { document: {}, window: {}, canvas: {} }, calls = { full: 0, keyboard: 0 }, state = { allowed };
  const listen = kind => (name, fn) => (handlers[kind][name] ||= []).push(fn);
  const emit = (kind, name, event = {}) => { for (const fn of handlers[kind][name] || []) fn(event); };
  const document = { fullscreenElement: null, addEventListener: listen('document'), hasFocus: () => true, hidden: false };
  document.documentElement = { requestFullscreen() {
    calls.full++;
    if (!state.allowed) return Promise.reject(new Error('No user activation'));
    document.fullscreenElement = document.documentElement; emit('document', 'fullscreenchange'); return Promise.resolve();
  } };
  const window = { addEventListener: listen('window'), innerWidth: native ? 800 : 780, innerHeight: native ? 600 : 540, screen: { width: 800, height: 600 }, __allowFull: allowFull };
  const navigator = { webdriver }; if (keyboard) navigator.keyboard = { lock(keys) { assert.deepEqual(Array.from(keys), ['Escape']); calls.keyboard++; return Promise.resolve(); } };
  const canvas = { addEventListener: listen('canvas'), clientWidth: 800, clientHeight: 600 };
  const ctx = vm.createContext({ window, document, navigator, performance: { now: () => 100 }, Sfx: { resume() {} }, setTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/input.js'), 'utf8'), ctx);
  const Input = vm.runInContext('Input', ctx); Input.init(canvas);
  const key = (code, repeat = false) => { const e = { code, repeat, prevented: false, preventDefault() { this.prevented = true; } }; emit('window', 'keydown', e); return e; };
  const exit = () => { document.fullscreenElement = null; window.innerWidth = 780; window.innerHeight = 540; emit('document', 'fullscreenchange'); };
  return { Input, document, window, calls, state, emit, key, exit };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Fullscreen starts without requiring Keyboard Lock and retries a denied startup on the first click', async () => {
  const f = fixture({ allowed: false }); assert.equal(f.calls.full, 1);
  f.window.innerHeight = 530; f.emit('window', 'resize'); assert.equal(f.Input.fsWanted, true);
  await settle(); assert.equal(f.Input.fsPending, false);
  f.state.allowed = true; f.emit('document', 'mousedown'); await settle();
  assert.equal(f.calls.full, 2); assert.equal(f.document.fullscreenElement, f.document.documentElement); assert.equal(f.Input.fsWanted, true);
});

test('F11 leaves browser default active and keeps ordinary input from restoring fullscreen', async () => {
  const f = fixture(); await settle(); f.Input.GAME_KEYS.add('F11'); f.Input.typing = true;
  const leave = f.key('F11'); assert.equal(leave.prevented, false); assert.equal(f.Input.fsWanted, false); assert.equal(f.Input.keys.F11, undefined);
  f.key('F11', true); assert.equal(f.Input.fsWanted, false); f.exit();
  f.emit('document', 'mousedown'); f.key('KeyF'); f.Input.enterFull(true); assert.equal(f.calls.full, 1);
  const enter = f.key('F11'); assert.equal(enter.prevented, false); assert.equal(f.Input.fsWanted, true);
  f.window.innerWidth = 800; f.window.innerHeight = 600; f.emit('window', 'resize');
  f.emit('document', 'mousedown'); await settle(); assert.equal(f.calls.full, 2); assert.equal(f.document.fullscreenElement, f.document.documentElement);
});

test('Native fullscreen launch avoids a second startup layer, while a gesture enables Escape capture', async () => {
  const f = fixture({ native: true, keyboard: true }); assert.equal(f.Input.isFullscreen(), true); assert.equal(f.calls.full, 0); assert(f.calls.keyboard > 0);
  f.key('KeyF'); await settle(); assert.equal(f.calls.full, 1); assert(f.calls.keyboard >= 3);
  const leave = f.key('F11'); assert.equal(leave.prevented, false); assert.equal(f.Input.fsWanted, false);
});

test('DOM fullscreen exit also preserves windowed mode across subsequent game clicks', async () => {
  const f = fixture(); await settle(); f.exit(); assert.equal(f.Input.fsWanted, false);
  f.emit('document', 'mousedown'); f.key('KeyA'); assert.equal(f.calls.full, 1);
});

test('Headless automation skips fullscreen unless the test explicitly allows it', async () => {
  const skip = fixture({ webdriver: true }); assert.equal(skip.calls.full, 0); skip.emit('document', 'mousedown'); assert.equal(skip.calls.full, 0);
  const allow = fixture({ webdriver: true, allowFull: true }); await settle(); assert.equal(allow.calls.full, 1);
});


test('Native fullscreen resize detects both F11 transitions even without page keydown', async () => {
  const f = fixture({ native: true, keyboard: true }); assert.equal(f.document.fullscreenElement, null); assert.equal(f.calls.full, 0);
  f.window.innerWidth = 780; f.window.innerHeight = 540; f.emit('window', 'resize');
  assert.equal(f.Input.fsActual, false); assert.equal(f.Input.fsWanted, false);
  f.emit('document', 'mousedown'); f.key('KeyA'); assert.equal(f.calls.full, 0);
  f.window.innerHeight = 530; f.emit('window', 'resize'); assert.equal(f.Input.fsWanted, false);
  f.window.innerWidth = 800; f.window.innerHeight = 600; f.emit('window', 'resize');
  assert.equal(f.Input.fsActual, true); assert.equal(f.Input.fsWanted, true);
  f.emit('document', 'mousedown'); await settle(); assert.equal(f.calls.full, 1);
  assert.equal(f.document.fullscreenElement, f.document.documentElement);
});
