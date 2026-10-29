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
  valley: ['dirt_valley', 'cave_wall', 'grass_valley', 'stone_valley', 'ivy', 'ivy_crest', 'wood_ship', 'brick_keep', 'wood_light', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'tree_birch1', 'haystack1', 'bush1', 'bush2', 'rock1', 'rock2', 'rock3', 'ladder_wood', 'column_ruin1', 'column_ruin2', 'flower1', 'flower2', 'flower3', 'flower4', 'flower5', 'flower6', 'flower7', 'leaf1', 'leaf2', 'leaf3', 'leaf4', 'roots1', 'roots2', 'roots3', 'lantern1'],   /* v40: декор и россыпь из Blender; v45: колонны */
  canyon: ['dirt_canyon', 'rock_canyon', 'cave_canyon', 'cap_sand', 'stone_sand', 'cactus1', 'cactus2', 'cactus3', 'deadtree1', 'deadtree2', 'watertower1', 'skull1', 'rock1', 'rock2', 'rock3', 'wood_light', 'ladder_wood', 'column1', 'column2', 'pot1', 'pot2', 'drygrass1', 'drygrass2', 'drygrass3', 'drygrass4', 'lantern1'],   /* v40: декор и россыпь из Blender; v45: колонны, кувшины, сухая трава */
  arctic: ['rock_arctic', 'cave_arctic', 'cap_snow', 'tree_pine_snow1', 'tree_pine_snow2', 'snowman1', 'snowman2', 'igloo1', 'icecrystal1', 'icecrystal2', 'rocksnow1', 'rocksnow2', 'wood_light', 'ladder_wood', 'metal_station', 'metal_steel'],   /* с версии 38 у станции тоже заснеженные ели; v40: декор и россыпь из Blender */
  volcano: ['rock_volcano', 'cave_volcano', 'cap_ash', 'stone_dark', 'deadtree_char1', 'deadtree_char2', 'spike1', 'spike2', 'obsidian1', 'obsidian2', 'lavarock1', 'lavarock2', 'bones1', 'wood_light', 'ladder_wood', 'metal_steel', 'lava_surface'],   /* v40: декор и россыпь из Blender */
  alien: ['rock_alien', 'cave_alien', 'grass_alien', 'cap_moss', 'alien_tree1', 'alien_tree2', 'crystal_c1', 'crystal_c2', 'crystal_m1', 'crystal_m2', 'crystal_h1', 'crystal_h2', 'crystal_h3', 'crystal_h4', 'alienplant1', 'alienplant2', 'pod1', 'tentacle1', 'wood_light', 'ladder_steel', 'metal_ufo', 'striplight1', 'alienbush1', 'alienbush2'],   /* v40: декор и россыпь из Blender */
  pirate: ['dirt_tropical', 'cave_wall', 'grass_tropical', 'wood_hull', 'stone_light', 'ivy', 'palm1', 'palm2', 'palm3', 'barrel1', 'barrel2', 'rockb1', 'rockb2', 'wood_light', 'bush1', 'bush2', 'ladder_wood', 'flower1', 'flower2', 'flower3', 'flower4', 'flower5', 'flower6', 'flower7', 'lantern1', 'porthole1', 'sea_body', 'sea_glint'],   /* v40: декор и россыпь из Blender; v111: лента моря (WebP) */
  castles: ['dirt_castle', 'cave_wall', 'grass_valley', 'stone_castle', 'ivy', 'ivy_crest', 'wood_hull', 'wood_light', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'haystack1', 'bush1', 'bush2', 'rock1', 'rock2', 'rock3', 'ladder_wood', 'flower1', 'flower2', 'flower3', 'flower4', 'flower5', 'flower6', 'flower7', 'leaf1', 'leaf2', 'leaf3', 'leaf4', 'roots1', 'roots2', 'roots3', 'cottage1', 'lantern1'],   /* v40: декор и россыпь из Blender */
  city: ['concrete_city', 'facade_city', 'wood_light', 'ladder_steelY', 'metal_steel', 'tree_birch1']   /* v89: берёза в кадке (planter) */   /* v41: металл из Blender (make_metal.py) */
};
for (const [id, names] of Object.entries(expected)) test('Selected ' + id + ' waits for all required map art without unrelated terrain', async () => {
  const f = fixture(), map = f.MAPS.find(m => m.id === id), assets = f.TexLib.mapAssets(map);
  assert.deepEqual(Array.from(assets.names).sort(), names.slice().sort());
  assert.equal(assets.panorama, id);
  /* версия 38: родные версии ×3–4 (assets/tex/surface) — трава, плющ, деревья, кусты и стога, если они есть на карте */
  const SURF = ['grass_valley', 'grass_alien', 'bush1', 'bush2', 'ivy', 'ivy_crest', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'tree_birch1', 'tree_pine_snow1', 'tree_pine_snow2', 'haystack1', 'alien_tree1', 'alien_tree2', 'porthole1', 'snowman1', 'snowman2', 'cactus1', 'cactus2', 'cactus3', 'palm1', 'palm2', 'palm3', 'deadtree1', 'deadtree2', 'deadtree_char1', 'deadtree_char2', 'igloo1', 'icecrystal1', 'icecrystal2', 'watertower1', 'column1', 'column2', 'column_ruin1', 'column_ruin2', 'pot1', 'pot2', 'barrel1', 'barrel2', 'drygrass1', 'drygrass2', 'drygrass3', 'drygrass4', 'flower1', 'flower2', 'flower3', 'flower4', 'flower5', 'flower6', 'flower7', 'leaf1', 'leaf2', 'leaf3', 'leaf4', 'roots1', 'roots2', 'roots3', 'cottage1', 'lantern1', 'striplight1', 'alienbush1', 'alienbush2', 'crystal_c1', 'crystal_c2', 'crystal_m1', 'crystal_m2', 'crystal_h1', 'crystal_h2', 'crystal_h3', 'crystal_h4', 'obsidian1', 'obsidian2', 'lavarock1', 'lavarock2', 'spike1', 'spike2', 'skull1', 'bones1', 'alienplant1', 'alienplant2', 'pod1', 'tentacle1', 'rock1', 'rock2', 'rock3', 'rockb1', 'rockb2', 'rocksnow1', 'rocksnow2'];
  assert.deepEqual(Array.from(assets.surface).sort(), names.filter(n => SURF.includes(n)).sort());
  const ready = f.TexLib.loadForMap(id), again = f.TexLib.loadForMap(map);
  assert.equal(new Set(f.requests).size, f.requests.length);
  const required = Array.from(f.TexLib.commonNames()).concat(names).map(n => 'assets/tex/' + n + (f.TexLib.webp && f.TexLib.webp.has(n) ? '.webp' : '.png'))
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
