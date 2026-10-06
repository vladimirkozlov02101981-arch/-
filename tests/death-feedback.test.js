'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = process.env.TW_GAME_ROOT || path.resolve(__dirname, '..');
function fixture() {
  const ctx = vm.createContext({ Particles: class { smoke() {} }, Sfx: { play() {} } });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/util.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(process.env.TW_DEATH_FX || path.join(root, 'js/fx.js'), 'utf8'), ctx);
  const fx = vm.runInContext('new FX()', ctx), sc = { soldiers: [{ id: 1, team: 0, name: '20' }, { id: 2, team: 1, name: '19' }], turn: { team: 0 } };
  return { fx, sc };
}
function canvas() {
  const log = [], c = new Proxy({ log, font: '16px sans-serif', fillStyle: '', globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return str => ({ width: str.length * (+(/(\d+)px/.exec(c.font) || [0, 16])[1]) * 0.56 });
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args) => log.push({ method: key, args, fill: c.fillStyle, alpha: c.globalAlpha });
    },
  });
  return c;
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
test('Loss cards are red for the local ally and green for the opponent, independent of lane, turn, network role and death cause', () => {
  const { fx, sc } = fixture();
  for (const owner of [0, 1]) {
    fx.localTeams = () => [owner];
    for (const turn of [0, 1]) for (const victim of [0, 1]) for (const lane of [0, 1]) for (const how of ['hit', 'drown']) for (const isHost of [true, false]) {
      sc.turn.team = turn; fx.handle({ t: 'die', id: victim + 1, x: 100, y: 300, L: lane, how }, sc, isHost);
      const b = fx.banners.at(-1), ally = victim === owner;
      assert.equal(b.kind, 'death'); assert.equal(b.relation, ally ? 'ally' : 'enemy');
      assert.equal(b.col, ally ? '#ff9da8' : '#81ffc1'); assert.equal(b.max, 3.6);
      assert.match(b.txt, ally ? /^Ваш боец \d+ / : /^Боец противника \d+ /);
      assert.equal(b.txt.endsWith(how === 'drown' ? 'утонул!' : 'погиб!'), true); assert(!b.txt.includes('№'));
    }
  }
});
test('Unknown teams remain neutral and hotseat perspective follows the active local player', () => {
  const { fx, sc } = fixture(); fx.localTeams = () => [0, 1];
  assert.equal(fx.deathRelation(sc, 1), 'ally'); sc.turn.team = 1; assert.equal(fx.deathRelation(sc, 1), 'enemy');
  fx.localTeams = () => []; assert.equal(fx.deathRelation(sc, 1), 'neutral');
  fx.handle({ t: 'die', id: 1, x: 0, y: 0, how: 'hit' }, sc, false); assert.equal(fx.banners.at(-1).col, '#f5d77b');
  const size = fx.banners.length; fx.handle({ t: 'die', id: 404, x: 0, y: 0 }, sc, true); assert.equal(fx.banners.length, size);
});
test('Loss card text has strong contrast throughout its opaque background and wraps within narrow viewports', () => {
  const { fx } = fixture(), c = canvas();
  for (const [relation, col, bg] of [['ally', '#ff9da8', '#3b1d29'], ['enemy', '#81ffc1', '#16342b'], ['neutral', '#f5d77b', '#302b1b']]) {
    for (const surface of [bg, '#0e1721']) assert((luminance(col) + 0.05) / (luminance(surface) + 0.05) >= 7);
    const b = { txt: 'Боец противника 20 утонул!', relation, col, life: 3.4, max: 3.6 };
    for (const sw of [320, 390, 626, 1440]) {
      const L = fx.deathBannerLayout(c, b, sw); assert(L.w <= sw - 24); assert(L.lines.length >= 1 && L.lines.length <= 2);
      for (const line of L.lines) assert(c.measureText(line).width <= L.available + 0.01);
      assert.equal(fx.drawDeathBanner(c, b, sw, 100, L), L.h);
    }
  }
});
test('Loss notification remains above a bright explosion flash and keeps regular banners intact', () => {
  const { fx, sc } = fixture(); fx.localTeams = () => [0];
  fx.banner('Обычное сообщение', '#fff', false, 2.2); fx.handle({ t: 'die', id: 2, x: 100, y: 300, how: 'hit' }, sc, true);
  fx.flash = 1; fx.banners.forEach(b => b.life -= 0.2);
  const c = canvas(); fx.drawScreen(c, sc, { toScreen: (x, y) => [x, y] }, 1440, 900);
  const flashAt = c.log.findIndex(x => x.method === 'fillRect' && x.args[2] === 1440 && x.fill === '#ffffff');
  const deathAt = c.log.findIndex(x => x.method === 'fillText' && x.args[0] === 'ПРОТИВНИК УСТРАНЁН');
  assert(flashAt >= 0 && deathAt > flashAt); assert(c.log.some(x => x.method === 'fillText' && x.args[0] === 'Обычное сообщение'));
});
test('Four simultaneous losses fit above the lower HUD in short landscapes, and mixed regular messages retain every death row', () => {
  const { fx, sc } = fixture(); fx.localTeams = () => [0]; sc.teams = [{}, {}];
  for (const mixed of [false, true]) for (const [sw, sh] of [[720, 390], [320, 568], [390, 844], [1440, 900]]) for (const simul of [false, true]) for (const wind of [false, true]) {
    fx.banners = []; sc.simul = simul; sc.settings = { wind };
    if (mixed) fx.banner('Следующий ход', '#fff', false, 2.2);
    const n = mixed ? 3 : 4;
    for (let i = 0; i < n; i++) fx.handle({ t: 'die', id: i % 2 + 1, x: 0, y: 0, how: i % 2 ? 'drown' : 'hit' }, sc, true);
    fx.banners.forEach(b => b.life -= 0.2); const c = canvas(), L = fx.screenBannerLayout(c, sc, sw, sh);
    assert(L.y >= L.top); assert(L.y + L.h <= sh - L.bottom + 0.001, [sw, sh, simul, wind, mixed, L.y, L.h].join(','));
    if (L.compact) {
      assert.equal(L.stack.rows.length, n);
      for (const row of L.stack.rows) for (const line of row.lines) assert(c.measureText(line).width <= L.stack.available + 0.01);
    }
    fx.drawScreen(c, sc, { toScreen: (x, y) => [x, y] }, sw, sh);
    const text = c.log.filter(x => x.method === 'fillText').map(x => String(x.args[0])).join(' ');
    for (const b of fx.banners) assert(text.includes(b.txt));
  }
});
