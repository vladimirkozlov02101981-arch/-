'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.TW_PROJECT_ROOT || path.join(__dirname, '..');
const artFile = process.env.TW_ART_STAGE || path.join(root, 'js/art.js');

function fixture() {
  const requests = [], images = [];
  class MockImage {
    constructor() { this.complete = false; this.naturalWidth = this.naturalHeight = 0; images.push(this); }
    set src(value) { this._src = value; requests.push(value); }
    get src() { return this._src; }
    finish(ok = true) {
      this.complete = true; this.naturalWidth = this.naturalHeight = ok ? 2 : 0;
      if (ok) this.onload?.(); else this.onerror?.();
    }
  }
  const canvas = (w, h) => ({ width: w, height: h, getContext: () => ({
    drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) })
  }) });
  const ctx = vm.createContext({ Image: MockImage, performance: { now: () => 0 }, console,
    document: { createElement: () => canvas(2, 2) }, window: { addEventListener() {} } });
  for (const name of ['util', 'themes', 'maps', 'levels', 'terrain_visual'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js/' + name + '.js'), 'utf8'), ctx);
  vm.runInContext('makeCanvas = ' + canvas.toString(), ctx);
  vm.runInContext(fs.readFileSync(artFile, 'utf8'), ctx);
  const api = vm.runInContext('({ TexLib, MapArt, MAPS, THEMES, MAT_DEFAULT })', ctx);
  return { ...api, requests, images, finishAll: () => images.filter(i => !i.complete).forEach(i => i.finish()) };
}

test('Startup requests only common artwork and battle promotion shares pending requests', async () => {
  const f = fixture(), common = f.TexLib.commonNames();
  assert.equal(common.length, 52);
  assert.equal(f.requests.length, common.length);
  assert(f.requests.every(p => /^assets\/tex\/(soldier_|wpn_|ent_)/.test(p)));
  assert(f.images.every(i => i.fetchPriority === 'low'));
  assert.equal(f.TexLib.ready, null);
  const a = f.TexLib.loadCommon('high'), b = f.TexLib.loadCommon('high');
  assert.equal(a, b);
  assert.equal(f.requests.length, common.length);
  assert(f.images.every(i => i.fetchPriority === 'high'));
  f.finishAll(); await a;
  assert.equal(Object.keys(f.TexLib.data).length, common.length);
});

const expected = {
  valley: ['dirt_valley', 'cave_wall', 'grass_valley', 'brick_light', 'wood_ship', 'brick_keep', 'wood_light', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'tree_birch1', 'haystack1', 'bush1', 'bush2'],
  canyon: ['dirt_canyon', 'rock_canyon', 'cave_canyon', 'cap_sand', 'wood_light'],
  arctic: ['rock_arctic', 'cave_arctic', 'cap_snow', 'tree_pine_snow1', 'tree_pine_snow2', 'tree_pine1', 'tree_pine2', 'wood_light'],
  volcano: ['rock_volcano', 'cave_volcano', 'cap_ash', 'wood_light'],
  alien: ['dirt_alien', 'rock_alien', 'cave_alien', 'grass_alien', 'alien_tree1', 'alien_tree2', 'wood_light'],
  pirate: ['dirt_tropical', 'cave_wall', 'grass_tropical', 'wood_ship', 'wood_light', 'bush1', 'bush2'],
  castles: ['dirt_castle', 'cave_wall', 'grass_valley', 'brick_light', 'wood_ship', 'wood_light', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'haystack1', 'bush1', 'bush2'],
  city: ['concrete_city', 'facade_city', 'wood_light']
};
for (const [id, names] of Object.entries(expected)) test('Selected ' + id + ' waits for all required map art without unrelated terrain', async () => {
  const f = fixture(), map = f.MAPS.find(m => m.id === id), assets = f.TexLib.mapAssets(map);
  assert.deepEqual(Array.from(assets.names).sort(), names.slice().sort());
  assert.equal(assets.panorama, id);
  assert.deepEqual(Array.from(assets.surface).sort(), ['valley', 'castles'].includes(id) ? ['bush1', 'bush2', 'grass_valley'] : []);
  const ready = f.TexLib.loadForMap(id), again = f.TexLib.loadForMap(map);
  assert.equal(new Set(f.requests).size, f.requests.length);
  const required = Array.from(f.TexLib.commonNames()).concat(names).map(n => 'assets/tex/' + n + '.png')
    .concat(Array.from(assets.surface, n => 'assets/tex/surface/' + n + '.png'), 'assets/maps/' + id + '.png');
  assert.deepEqual(f.requests.slice().sort(), required.sort());
  assert(f.images.every(i => i.fetchPriority === 'high'));
  assert(f.requests.every(p => !/\/hi\/|\/native\/|\/fine\//.test(p)));
  f.finishAll(); const result = await ready; await again;
  assert.deepEqual(Array.from(result.failed), []);
});

test('A required image delayed beyond three seconds still blocks map readiness', async () => {
  const f = fixture(), ready = f.TexLib.loadForMap('castles'); let settled = false;
  ready.then(() => { settled = true; });
  const held = f.images.find(i => i.src === 'assets/tex/dirt_castle.png');
  f.images.filter(i => i !== held).forEach(i => i.finish());
  await new Promise(resolve => setTimeout(resolve, 3100));
  assert.equal(settled, false);
  assert.equal(f.TexLib.data.dirt_castle, undefined);
  held.finish(); await ready; assert.equal(settled, true);
});

test('Missing texture/panorama resolves explicit failure and does not duplicate requests', async () => {
  const f = fixture(), ready = f.TexLib.loadForMap('canyon');
  f.images.forEach(i => i.finish(!/rock_canyon|maps\/canyon/.test(i.src)));
  const result = await ready;
  assert.deepEqual(Array.from(result.failed).sort(), ['maps/canyon', 'rock_canyon']);
  const count = f.requests.length; await f.TexLib.loadForMap('canyon');
  assert.equal(f.requests.length, count);
  assert.equal(f.TexLib.data.rock_canyon, undefined);
});

test('Full-library tooling API waits for every base and surface texture and remains cached', async () => {
  const f = fixture(), ready = f.TexLib.load(); assert.equal(f.TexLib.load(), ready);
  assert.equal(f.requests.length, f.TexLib.names.length + f.TexLib.surfaceNames.length);
  assert.equal(new Set(f.requests).size, f.requests.length);
  f.finishAll(); await ready;
  assert.equal(Object.keys(f.TexLib.data).length, f.TexLib.names.length);
  assert.equal(Object.keys(f.TexLib.surfaceHi).length, f.TexLib.surfaceNames.length);
  assert.equal(f.MapArt.images.size, 0);
});

test('Unknown map rejects explicitly; optional invalid texture does not issue a request', async () => {
  const f = fixture(), count = f.requests.length;
  await assert.rejects(f.TexLib.loadForMap('random'), /Не найдена карта/);
  assert.equal(await f.TexLib.loadOne('missing'), false);
  assert.equal(await f.TexLib.loadSurface('missing'), false);
  assert.equal(f.requests.length, count);
});
