'use strict';
/* Шесты флагов: реальные маски восьми карт, сохранность геометрии и полотнищ, опора и разрушения.
   --baseline выводит прежние разрывы перед runtime-патчем. TEST_URL задаёт отдельный сервер копии. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const base = process.env.TEST_URL || 'http://127.0.0.1:3001', baseline = process.argv.includes('--baseline');
const geometryFiles = ['js/maps.js', 'js/levels.js'];
const geometryHash = () => Object.fromEntries(geometryFiles.map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', p))).digest('hex')]));
(async () => {
  const geometryBefore = geometryHash(), browser = await chromium.launch({ headless: true }), errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/profile', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.waitForSelector('#s-main.show', { timeout: 120000 });
    const report = await page.evaluate(() => {
      const hash = mask => { let h = 2166136261; for (const b of mask) h = Math.imul(h ^ b, 16777619); return h >>> 0; };
      const trace = (sc, flag, t = 1.2) => {
        const paths = [], poles = [], fills = []; let current = [];
        const c = { beginPath() { current = []; }, moveTo(x, y) { current.push(['M', x, y]); }, lineTo(x, y) { current.push(['L', x, y]); },
          stroke() { poles.push(current.map(v => v.slice())); }, fill() { fills.push(current.map(v => v.slice())); }, closePath() { current.push(['Z']); },
          arc() {}, fillRect() {}, save() {}, restore() {}, };
        drawProps(c, { ...sc, props: [flag] }, t, false); return { poles, fills };
      };
      const out = { maps: [], flags: [], boundaries: null };
      for (const map of MAPS) {
        const raster = rasterizeMap(map), T = Object.create(Terrain.prototype); Object.assign(T, { W: map.W, H: map.H, mask: raster.mask });
        const props = resolveProps(T, map).filter(p => p.kind === 'flag');
        const sc = { terrain: T, props, teams: [{ color: '#c33' }, { color: '#33c' }], turn: { wind: -8 } };
        const before = hash(T.mask), layout = JSON.stringify(map);
        for (const flag of props) {
          const ground = T.findTop(Math.floor(flag.x), Math.ceil(flag.y)), drawn = trace(sc, flag), top = flag.y - (flag.o.h || 60);
          const raw = { ...flag, o: { ...flag.o } }, legacy = trace({ ...sc, terrain: null }, raw);
          out.flags.push({ map: map.id, x: flag.x, y: flag.y, ground, gap: ground - flag.y,
            endpoint: drawn.poles[0] ? drawn.poles[0][0].slice(1) : null, top: drawn.poles[0] ? drawn.poles[0][1].slice(1) : null,
            expectedTop: [flag.x, top], clothSame: JSON.stringify(drawn.fills) === JSON.stringify(legacy.fills), propSame: JSON.stringify(flag) === JSON.stringify(raw) });
          // На реальной маске удаляем только колонку опоры тестового T: отсутствие/дальняя опора не удлиняют шест.
          if (!out.boundaries) {
            const x = Math.floor(flag.x), y0 = Math.ceil(flag.y), saved = [];
            for (let y = y0; y < T.H; y++) { saved.push(T.mask[y * T.W + x]); T.mask[y * T.W + x] = 0; }
            const at = gap => { if (gap !== null) T.mask[(y0 + gap) * T.W + x] = 1;
              const r = trace(sc, flag); if (gap !== null) T.mask[(y0 + gap) * T.W + x] = 0; return r.poles[0] ? r.poles[0][0][2] : null; };
            out.boundaries = { map: map.id, y: flag.y, missing: at(null), at64: at(64), at65: at(65) };
            for (let y = y0; y < T.H; y++) T.mask[y * T.W + x] = saved[y - y0];
          }
        }
        out.maps.push({ id: map.id, width: map.W, height: map.H, flags: props.length, before, after: hash(T.mask), layoutSame: JSON.stringify(map) === layout });
      }
      return out;
    });
    const geometryAfter = geometryHash(); assert.deepEqual(geometryBefore, geometryAfter, 'map geometry files changed');
    assert.equal(report.maps.length, 8); for (const m of report.maps) { assert(m.width === 6400 && m.height === 1800); assert.equal(m.before, m.after); assert(m.layoutSame); }
    const targets = report.flags.filter(f => f.x === 5380); assert.equal(targets.length, 3);
    assert.deepEqual(targets.map(f => [f.map, f.gap]), [['valley', 26], ['pirate', 26], ['castles', 28]]);
    for (const f of report.flags) {
      assert(f.propSame, 'renderer mutated flag coordinates/options: ' + JSON.stringify(f));
      if (f.gap >= 0 && f.gap <= 64) {
        assert.deepEqual(f.top, f.expectedTop, 'pole top changed: ' + JSON.stringify(f)); assert(f.clothSame, 'cloth/animation changed');
        if (!baseline) assert.deepEqual(f.endpoint, [f.x, f.ground], 'pole misses real support: ' + JSON.stringify(f));
      }
    }
    if (!baseline) {
      assert.equal(report.boundaries.at64, report.boundaries.y + 64, '64px support limit inclusive');
      assert.equal(report.boundaries.missing, null, 'unsupported flag remains after removing its ground');
      assert.equal(report.boundaries.at65, null, 'pole reaches distant unrelated ground');
    }
    assert.deepEqual(errors, []); fs.mkdirSync('test-results/props', { recursive: true });
    fs.writeFileSync('test-results/props/' + (baseline ? 'support-before.json' : 'support-after.json'), JSON.stringify({ ...report, geometryBefore, geometryAfter }, null, 2));
    console.log((baseline ? 'Flag support baseline' : 'Flag support PASS: 8 real masks, unchanged geometry, cloth/top, deck flags, destruction and bounded support') + '\n' + JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
