'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.TERRITORY_TEST_SOURCE || path.join(__dirname, '..');
const plain = a => JSON.parse(JSON.stringify(a));
function fixture() {
  let queue = [], calls = 0;
  const math = Object.create(Math); math.random = () => { calls++; return queue.length ? queue.shift() : .5; };
  const map = { id: 'arctic' }, elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { value: '', checked: false, disabled: false, textContent: '', classList: { toggle() {} } }); return elements.get(id); };
  const ctx = vm.createContext({ Math: math, NET_VERSION: 8, MAPS: [map], MAP_BY_ID: { arctic: map },
    FX: class {}, Camera: class {}, AI: class {}, LocalController: class {}, window: { addEventListener() {} },
    document: { getElementById: element }, TEAM_COLORS: [], HAT_IDS: [], sanitizeAmmo: a => a || null, makeAmmo: () => ({}),
    Sfx: {}, Net: { connected: true, sendBig(s) { ctx.packet = s; }, send() {} },
    Game: class { constructor(cfg) { this.cfg = cfg; this.turn = { team: cfg.settings.firstTeam }; } buildVisual() {} cmd() {} startInfo() { return { mapId: this.cfg.mapId, settings: this.cfg.settings, teams: this.cfg.teams, soldiers: [] }; } },
    RemoteGame: class { constructor(start) { this.start = start; } buildVisual() {} } });
  for (const f of ['util', 'main', 'profile', 'ui']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx);
  const api = vm.runInContext('({App,UI,Profile,FACTORY_SNAP,DEFAULT_PREFS,sanitizeSettings,resolveBattleStart,snapCopy})', ctx);
  api.App.launch = (build, done) => done(build()); api.App.setScene = () => {};
  api.UI.teamsCfg = api.DEFAULT_PREFS.teams; api.UI.readAmmo = () => ({}); api.UI.fillAmmo = () => {};
  return { ...api, ctx, element, queue(...v) { queue = v; }, calls: () => calls };
}

test('First-turn preference defaults to random, accepts only named choices, and preserves only integer resolved fields', () => {
  const f = fixture(); assert.equal(f.FACTORY_SNAP.settings.first, 'random'); assert.equal(f.DEFAULT_PREFS.settings.first, 'random');
  for (const first of [undefined, null, 'left', 'bad', 0, {}, true]) assert.equal(f.sanitizeSettings({ first }).first, 'random');
  for (const first of ['random', 'team1', 'team2']) assert.equal(f.sanitizeSettings({ first }).first, first);
  for (const firstTeam of ['1', -1, 2, null, undefined, true, NaN]) assert.equal(Object.hasOwn(f.sanitizeSettings({ firstTeam }), 'firstTeam'), false);
  for (const firstTeam of [0, 1]) assert.equal(f.sanitizeSettings({ firstTeam }).firstTeam, firstTeam);
});

test('Physical side never selects the starting team; fixed first team never consumes a toss', () => {
  const f = fixture();
  for (const side of ['left', 'right']) for (const [first, expected] of [['team1', 0], ['team2', 1]]) {
    const draft = { mapId: 'arctic', settings: { side, first, firstTeam: 1 - expected }, teams: [] }, before = plain(draft), calls = f.calls();
    const cfg = f.resolveBattleStart(draft); assert.equal(cfg.settings.swap, side === 'right'); assert.equal(cfg.settings.firstTeam, expected);
    assert.deepEqual(plain(draft), before); assert.equal(f.calls(), calls);
  }
});

test('Random first team is a fresh genuine coin toss, can repeat, and is independent of random placement', () => {
  const f = fixture(), draft = { mapId: 'arctic', settings: { side: 'left', first: 'random' } };
  f.queue(.1, .9, .9, .9); assert.deepEqual([0, 1, 2, 3].map(() => f.resolveBattleStart(draft).settings.firstTeam), [0, 1, 1, 1]); assert.equal(f.calls(), 4);
  f.queue(.1, .9); const a = f.resolveBattleStart({ ...draft, settings: { side: 'random', first: 'random' } });
  assert.equal(a.settings.swap, true); assert.equal(a.settings.firstTeam, 1);
  f.queue(.9, .1); const b = f.resolveBattleStart({ ...draft, settings: { side: 'random', first: 'random' } });
  assert.equal(b.settings.swap, false); assert.equal(b.settings.firstTeam, 0); assert.equal(f.calls(), 8);
});

test('Continuous mode ignores initiative without spending a toss and retains preference for later ordinary play', () => {
  const f = fixture();
  for (const first of ['random', 'team1', 'team2']) {
    const cfg = f.resolveBattleStart({ mapId: 'arctic', settings: { side: 'right', first, simul: true } });
    assert.equal(cfg.settings.firstTeam, 0); assert.equal(cfg.settings.first, first); assert.equal(cfg.settings.swap, true);
  }
  assert.equal(f.calls(), 0);
});

test('Host resolves initiative once, transmits it, and guest sanitizes without rerolling', () => {
  const f = fixture(), draft = f.sanitizeSettings({ side: 'right', first: 'random' });
  f.queue(.9); f.App.startHostGame(draft); const packet = f.ctx.packet;
  assert.equal(f.calls(), 1); assert.equal(packet.settings.firstTeam, 1); assert.equal(packet.settings.swap, true); assert.equal(Object.hasOwn(draft, 'firstTeam'), false);
  f.queue(.1); f.App.startGuestGame(packet); assert.equal(f.calls(), 1);
  assert.equal(f.App.remote.start.settings.firstTeam, packet.settings.firstTeam); assert.equal(f.App.remote.start.settings.first, 'random');
});

test('New battle and each local rematch resolve again without mutating the stored selection', () => {
  const f = fixture(), draft = { mapId: 'arctic', settings: { side: 'left', first: 'random' }, teams: f.DEFAULT_PREFS.teams };
  f.queue(.1, .9, .9); f.App.startLocal(draft, 'cpu'); assert.equal(f.App.game.cfg.settings.firstTeam, 0);
  f.App.rematch(); assert.equal(f.App.game.cfg.settings.firstTeam, 1); f.App.rematch(); assert.equal(f.App.game.cfg.settings.firstTeam, 1);
  assert.equal(f.calls(), 3); assert.deepEqual(plain(f.App.lastCfg.settings), { side: 'left', first: 'random' }); assert.deepEqual(plain(draft.settings), { side: 'left', first: 'random' });
});

test('Legacy low-level battle cfg without preference retains explicit firstTeam, otherwise safely defaults to team 0', () => {
  const f = fixture();
  for (const settings of [{ swap: true }, { swap: false }, { swap: true, firstTeam: 0 }, { swap: false, firstTeam: 1 }]) {
    const cfg = f.resolveBattleStart({ mapId: 'arctic', settings }); assert.equal(cfg.settings.firstTeam, settings.firstTeam === 1 ? 1 : 0); assert.equal(cfg.settings.swap, settings.swap);
  }
  assert.equal(f.calls(), 0);
});

test('UI reads and displays initiative separately, disables it for simultaneous combat and guests, then restores editing', () => {
  const f = fixture(), UI = f.UI; UI.mode = 'cpu'; UI.settings = f.sanitizeSettings({ side: 'right', first: 'team2', firstTeam: 1 });
  UI.applySettings(UI.settings); assert.equal(f.element('o-first').value, 'team2'); assert.equal(f.element('o-side').value, 'right'); assert.equal(f.element('o-first').disabled, false);
  f.element('o-first').value = 'team1'; const S = UI.readSettings(); assert.equal(S.first, 'team1'); assert.equal(S.side, 'right'); assert.equal(Object.hasOwn(S, 'firstTeam'), false);
  f.element('o-simul').value = '1'; UI.syncFirstTurn(); assert.equal(f.element('o-first').disabled, true); assert.match(f.element('o-first-note').textContent, /одновременно/);
  f.element('o-simul').value = '0'; UI.syncFirstTurn(); assert.equal(f.element('o-first').disabled, false); assert.equal(f.element('o-first').value, 'team1');
  UI.mode = 'guest'; UI.syncFirstTurn(); assert.equal(f.element('o-first').disabled, true);
  UI.mode = 'hotseat'; f.element('o-simul').value = '1'; UI.syncFirstTurn(); assert.equal(f.element('o-first').disabled, false);
});

test('Default checkbox stays initially off; repeated saved edits and uncheck restore permanent settings without changing current draft', () => {
  const f = fixture(), P = f.Profile, UI = f.UI;
  P.data = P.clean({ base: f.FACTORY_SNAP, configs: [], defaultId: null }); P.save = () => {};
  UI.refreshCfgBar = () => {}; UI.syncKeyHints = () => {}; UI.cfgNote = () => {};
  UI.work = f.snapCopy(P.base); assert.equal(UI.linked, false); const original = plain(P.base);
  UI.work.settings.first = 'team2'; UI.setDefaultChecked(true);
  for (const [first, n] of [['team1', 2], ['random', 8], ['team2', 3]]) { UI.work.settings.first = first; UI.work.settings.ammo = { shotgun: n }; UI.workChanged(); }
  const active = plain(UI.work); UI.setDefaultChecked(false);
  assert.deepEqual(plain(P.base), original); assert.deepEqual(plain(UI.work), active); assert.equal(UI.linked, false);
  const nextBattle = f.snapCopy(P.base); assert.equal(nextBattle.settings.first, 'random'); assert.equal(nextBattle.settings.ammo, null);
});

test('Menu markup offers first turn independently and defaults to random', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const first = html.match(/<select id="o-first"[^>]*>(.*?)<\/select>/s)[1];
  assert.match(first, /value="random" selected/); assert.match(first, /value="team1"/); assert.match(first, /value="team2"/);
  assert.match(html, /<select id="o-side"/); assert.match(html, /id="o-first-note"/);
});
