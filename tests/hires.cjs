'use strict';
require('../dev/tools/pw-chromium.cjs');
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  // An isolated developer HTTP origin; no user tabs, browser profile, or file:// state.
  const source = fs.readFileSync(path.join(__dirname, '../js/hires.js'), 'utf8');
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/hires.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/hires.js' ? source : '<!doctype html><title>Terrain rendering regression</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base);
    await page.addScriptTag({ content: `function makeCanvas(w,h) { const c=document.createElement('canvas');c.width=w;c.height=h;return c; } const TexLib={hi:{},fine:{},loadHi(n){return this.hi[n]||null;},loadFine(n){return this.fine[n]||null;}};` });
    await page.addScriptTag({ url: base + '/hires.js' });
    const report = await page.evaluate(async () => {
      const W = 512, H = 512, T = HIRES_T, G = HIRES_G, results = [];
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const hiData = new Uint8Array(64 * 64), fineData = new Uint8Array(64 * 64 * 3);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        hiData[y * 64 + x] = Math.round(128 + 18 * Math.sin(x * .43) * Math.cos(y * .37));
        const i = (y * 64 + x) * 3;
        fineData[i] = Math.round(128 + 14 * Math.sin(x * .17) * Math.cos(y * .13));
        fineData[i + 1] = Math.round(128 + 9 * Math.cos(y * .2));
        fineData[i + 2] = Math.round(128 - 11 * Math.sin(x * .17));
      }
      TexLib.hi.test = { name: 'test', w: 64, h: 64, d: hiData };
      const mip = new Uint8Array(32 * 32 * 3);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) for (let c = 0; c < 3; c++) {
        const a = (y * 2 * 64 + x * 2) * 3 + c, b = a + 64 * 3;
        mip[(y * 32 + x) * 3 + c] = Math.round((fineData[a] + fineData[a + 3] + fineData[b] + fineData[b + 3]) / 4);
      }
      TexLib.fine.photo = { name: 'photo', w: 64, h: 64, scale: 8, d: fineData, mip: { w: 32, h: 32, scale: 4, d: mip } };
      TexLib.fine.neutral = { name: 'neutral', w: 64, h: 64, scale: 8, d: new Uint8Array(64 * 64 * 3).fill(128) };
      const fillTiles = async (hr, sc, scale) => {
        hr.sync(sc.terrain, scale);
        const nx = Math.ceil(sc.W / T), ny = Math.ceil(sc.H / T);
        for (let step = 0; hr.tiles.size < nx * ny && step < 2000; step++) {
          for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
            const key = tx + ',' + ty;
            if (!hr.tiles.has(key) && !hr.pending.has(key)) hr.request(sc, tx, ty);
          }
          await wait(10);
        }
        if (hr.tiles.size !== nx * ny) throw new Error('Real worker tiles did not finish');
      };
      const stop = hr => { for (const worker of hr.workers) worker.terminate(); };
      for (const kind of ['opaque', 'translucent', 'texture', 'fine', 'neutral', 'opaque-mixed', 'translucent-mixed']) {
        const canvas = makeCanvas(W, H), decor = makeCanvas(W, H), ctx = canvas.getContext('2d'), image = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          image.data[i] = kind === 'texture' ? Math.round(110 + 30 * Math.sin(x * .17)) : 127;
          image.data[i + 1] = kind === 'texture' ? Math.round(90 + 22 * Math.cos(y * .13)) : 95;
          image.data[i + 2] = 63; image.data[i + 3] = kind.startsWith('translucent') ? 128 : 255;
        }
        ctx.putImageData(image, 0, 0);
        const name = kind === 'texture' ? 'test' : kind === 'fine' ? 'photo' : kind === 'neutral' ? 'neutral' : null;
        const texRef = name ? { tab: [null, { name, w: 32, dx: 7.375, dy: -11.125 }], F: new Uint8Array(W * H).fill(1), B: new Uint8Array(W * H) } : null;
        const sc = { W, H, terrain: { canvas, decor, mask: new Uint8Array(W * H).fill(1), texRef, version: 0, touches: [] } };
        const hr = new HiResTerrain(); hr.pool();
        for (const S of [4, 8]) {
          await fillTiles(hr, sc, S);
          // Draw the real worker pixels once as a continuous reference: no duplicate terrain algorithm.
          const full = makeCanvas(W * S, H * S), fc = full.getContext('2d');
          for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
            const cv = hr.tiles.get(tx + ',' + ty).cv;
            fc.putImageData(cv.getContext('2d').getImageData(G * S, G * S, T * S, T * S), tx * T * S, ty * T * S);
          }
          let overlapError = 0;
          for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
            const c = hr.tiles.get(tx + ',' + ty).cv.getContext('2d');
            if (tx < 3) {
              const a = c.getImageData((G + T) * S, G * S, G * S, T * S).data;
              const b = hr.tiles.get((tx + 1) + ',' + ty).cv.getContext('2d').getImageData(G * S, G * S, G * S, T * S).data;
              for (let i = 0; i < a.length; i++) overlapError = Math.max(overlapError, Math.abs(a[i] - b[i]));
            }
            if (ty < 3) {
              const a = c.getImageData(G * S, (G + T) * S, T * S, G * S).data;
              const b = hr.tiles.get(tx + ',' + (ty + 1)).cv.getContext('2d').getImageData(G * S, G * S, T * S, G * S).data;
              for (let i = 0; i < a.length; i++) overlapError = Math.max(overlapError, Math.abs(a[i] - b[i]));
            }
          }
          const central = full.getContext('2d').getImageData(128 * S, 128 * S, 128 * S, 128 * S).data;
          let minRed = 255, maxRed = 0, neutralError = 0;
          for (let i = 0; i < central.length; i += 4) {
            minRed = Math.min(minRed, central[i]); maxRed = Math.max(maxRed, central[i]);
            if (kind === 'neutral') neutralError = Math.max(neutralError, Math.abs(central[i] - 127), Math.abs(central[i + 1] - 95), Math.abs(central[i + 2] - 63));
          }
          // Some tiles are still waiting: their alpha must composite exactly as the continuous field.
          if (kind.endsWith('-mixed')) {
            for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) if ((tx + ty) % 2) {
              const key = tx + ',' + ty; hr.bytes -= hr.tiles.get(key).bytes; hr.tiles.delete(key);
            }
            hr.request = () => false;
          }
          let maxError = 0, cases = 0;
          for (const dpr of [1, 1.25, 1.5, 2]) for (const zoom of [1.17, 1.33, 1.875, 2.1, 3.27, 5.142857142857143]) for (const shift of [.13, .37, .71]) {
            const zp = zoom * dpr; if ((zp > 3.5 ? 8 : 4) !== S) continue;
            const out = makeCanvas(Math.round(256 * dpr), Math.round(192 * dpr)), ref = makeCanvas(out.width, out.height);
            const ox = out.width / 2 - 256 * zp + shift * dpr, oy = out.height / 2 - 256 * zp + (1 - shift) * dpr;
            const fill = cv => { const c = cv.getContext('2d'); c.fillStyle = '#204060'; c.fillRect(0, 0, cv.width, cv.height); c.imageSmoothingQuality = 'high'; c.setTransform(zp, 0, 0, zp, ox, oy); return c; };
            const oc = fill(out), rc = fill(ref);
            hr.draw(oc, sc, { x0: 0, y0: 0, x1: W, y1: H }, zp);
            rc.drawImage(full, 0, 0, full.width, full.height, 0, 0, W, H);
            const a = oc.getImageData(0, 0, out.width, out.height).data, b = rc.getImageData(0, 0, out.width, out.height).data;
            for (let y = 2; y < out.height - 2; y++) for (let x = 2; x < out.width - 2; x++) {
              const i = (y * out.width + x) * 4;
              for (let c = 0; c < 4; c++) maxError = Math.max(maxError, Math.abs(a[i + c] - b[i + c]));
            }
            cases++;
          }
          results.push({ kind, scale: S, cases, maxError, overlapError, neutralError, fineRedRange: maxRed - minRed, tileSize: hr.tiles.get('0,0').cv.width });
          // Restore the request method for the next scale.
          if (kind.endsWith('-mixed')) hr.request = HiResTerrain.prototype.request;
        }
        stop(hr);
      }
      // An actual opaque step measures edge width and verifies bounded interpolation without halos.
      const canvas = makeCanvas(W, 256), decor = makeCanvas(W, 256), c = canvas.getContext('2d');
      c.fillStyle = 'rgb(64,64,64)'; c.fillRect(0, 0, 256, 256); c.fillStyle = 'rgb(192,192,192)'; c.fillRect(256, 0, 256, 256);
      const sc = { W, H: 256, terrain: { canvas, decor, mask: new Uint8Array(W * 256).fill(1), texRef: null, version: 0, touches: [] } };
      const hr = new HiResTerrain(); hr.pool(); await fillTiles(hr, sc, 8);
      const row = new Uint8Array(W * 8);
      for (let tx = 0; tx < 4; tx++) {
        const d = hr.tiles.get(tx + ',0').cv.getContext('2d').getImageData(G * 8, (G + 64) * 8, T * 8, 1).data;
        for (let x = 0; x < T * 8; x++) row[tx * T * 8 + x] = d[x * 4];
      }
      const linear = makeCanvas(W * 8, 1), lc = linear.getContext('2d'); lc.imageSmoothingEnabled = true; lc.imageSmoothingQuality = 'low';
      lc.drawImage(canvas, 0, 64, W, 1, 0, 0, W * 8, 1);
      const ld = lc.getImageData(0, 0, W * 8, 1).data, linearRow = Uint8Array.from(row, (_, i) => ld[i * 4]);
      const crossing = (a, value) => { for (let i = 16; i < a.length - 16; i++) if (a[i] >= value && a[i - 1] < value) return i - 1 + (value - a[i - 1]) / (a[i] - a[i - 1]); throw new Error('Step did not cross threshold'); };
      const width = a => crossing(a, 64 + 128 * .9) - crossing(a, 64 + 128 * .1);
      const interior = row.slice(16, row.length - 16);
      const sharpness = { cubicEdgeWidth: width(row), linearEdgeWidth: width(linearRow), min: Math.min(...interior), max: Math.max(...interior) };
      stop(hr);
      // Viewport-based scale selection prevents S8 cache thrash on large DPR2 views.
      const budgetHR = new HiResTerrain(); budgetHR.workers = []; budgetHR.request = () => false;
      const budgetSC = { ...sc, W: 4096, H: 1800 }, cv = makeCanvas(256, 192), bc = cv.getContext('2d'); bc.setTransform(3.6, 0, 0, 3.6, .37, .71);
      budgetHR.draw(bc, budgetSC, { x0: 100, y0: 100, x1: 960, y1: 660 }, 3.6); const largeViewScale = budgetHR.scale;
      budgetHR.draw(bc, budgetSC, { x0: 0, y0: 0, x1: 512, y1: 512 }, 4.5); const smallViewScale = budgetHR.scale;
      const tile = makeCanvas(1040, 1040), bytes = 1040 * 1040 * 4;
      for (let i = 0; i < 40; i++) budgetHR.tiles.set(i + ',9', { cv: tile, bytes, used: 0, dist: i });
      budgetHR.bytes = 40 * bytes;
      budgetHR.draw(bc, budgetSC, { x0: 0, y0: 0, x1: 512, y1: 512 }, 4.5);
      const cacheBytes = budgetHR.bytes, cacheTiles = budgetHR.tiles.size;
      budgetHR.sync(budgetSC.terrain, 4); budgetHR.pending.add('0,0');
      budgetHR.done({ idle: false }, { key: '0,0', ep: budgetHR.epoch - 1, g: 0, out: null });
      const staleReplyPreservesPending = budgetHR.pending.has('0,0');
      return { results, sharpness, budget: { largeViewScale, smallViewScale, cacheBytes, cacheTiles, limit: HIRES_BUDGET, staleReplyPreservesPending } };
    });
    const reportDir = path.join(__dirname, '../test-results'); fs.mkdirSync(reportDir, { recursive: true });
    const passed = errors.length === 0 && report.results.every(r => r.maxError <= (['texture', 'fine'].includes(r.kind) ? 3 : 0) && r.overlapError === 0 && r.neutralError === 0) && report.sharpness.cubicEdgeWidth < report.sharpness.linearEdgeWidth * .96 && report.sharpness.min === 64 && report.sharpness.max === 192 && report.budget.largeViewScale === 4 && report.budget.smallViewScale === 8 && report.budget.cacheBytes <= report.budget.limit && report.budget.staleReplyPreservesPending;
    fs.writeFileSync(path.join(reportDir, 'hires-seams-report.json'), JSON.stringify({ passed, date: new Date().toISOString(), errors, ...report }, null, 2));
    console.log(JSON.stringify({ passed, scenarios: report.results.reduce((n, r) => n + r.cases, 0), sharpness: report.sharpness, budget: report.budget, comparisons: report.results.map(r => ({ kind: r.kind, scale: r.scale, error: r.maxError, overlap: r.overlapError })) }));
    assert(passed, 'Terrain interpolation/compositing regression: see test-results/hires-seams-report.json');
    assert(report.results.filter(r => r.kind === 'fine').every(r => r.fineRedRange >= 20), 'RGB fine texture must preserve visible color detail at both scales');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
