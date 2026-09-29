'use strict';
/* Проверка проходимости всех карт (нужен запущенный сервер: npm start).
   node dev/navcheck.cjs [mapId ...] [--img]  — отчёт в консоль, картинки в test-results/nav-*.png */
const { chromium } = require('playwright'); const fs = require('node:fs');
const args = process.argv.slice(2); const IMG = args.includes('--img'); const PLAIN = args.includes('--plain'); const only = args.filter(a => !a.startsWith('--'));
const CROP = (args.find(a => a.startsWith('--crop=')) || '').slice(7).split(',').filter(Boolean).map(Number); const SC = Number((args.find(a => a.startsWith('--scale=')) || '--scale=0.4').slice(8));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => console.error('PAGE ERROR', e.message));
    await page.goto('http://localhost:3000/?nocache=' + Date.now()); await page.waitForSelector('#s-main.show');
    if (!await page.evaluate(() => typeof NavCheck !== 'undefined')) await page.addScriptTag({ url: '/js/navcheck.js?v=' + Date.now() });
    const ids = only.length ? only : await page.evaluate(() => MAPS.map(m => m.id));
    fs.mkdirSync('test-results', { recursive: true });
    let bad = 0;
    for (const id of ids) {
      const r = await page.evaluate(({ id, IMG, CROP, SC, PLAIN }) => {
        const cfg = { mapId: id, settings: { ...App.prefs.settings, perTeam: 6, crates: false, sd: 0 }, teams: App.prefs.teams };
        const g = new Game(cfg); const t0 = performance.now();
        const res = NavCheck.analyze(g); const ms = Math.round(performance.now() - t0);
        const out = { id, W: g.W, H: g.H, ms, total: res.total, main: res.mainSize, traps: res.traps.map(t => ({ x: Math.round(t.x0), y: Math.round(t.y0), w: Math.round(t.x1 - t.x0), h: Math.round(t.y1 - t.y0), n: t.n })), isolated: res.isolated.length, unreach: res.nodes.filter((nd, i) => !nd.v && !res.fromMain[i]).length };
        if (IMG || CROP.length) {
          g.buildVisual();
          const [cx0, cy0, cw, ch] = CROP.length ? CROP : [0, 0, g.W, g.H]; const s = CROP.length ? SC : SC;
          const cv = document.createElement('canvas'); cv.width = Math.ceil(cw * s); cv.height = Math.ceil(ch * s);
          const c = cv.getContext('2d'); c.fillStyle = '#1b2230'; c.fillRect(0, 0, cv.width, cv.height);
          c.scale(s, s); c.translate(-cx0, -cy0); c.drawImage(g.terrain.decor, 0, 0); c.drawImage(g.terrain.canvas, 0, 0);
          if (PLAIN) { const gr = c.createLinearGradient(0, cy0, 0, cy0 + ch); gr.addColorStop(0, '#6fb2ea'); gr.addColorStop(1, '#d8ecf8'); c.fillStyle = gr; c.fillRect(cx0, cy0, cw, ch); c.drawImage(g.terrain.decor, 0, 0); c.drawImage(g.terrain.canvas, 0, 0); drawTacticalRoutes(c, g.map); out.img = cv.toDataURL('image/png'); return out; }
          c.fillStyle = 'rgba(40,120,255,0.35)'; c.fillRect(0, g.waterY, g.W, g.H - g.waterY);
          for (const l of g.map.ladders || []) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.moveTo(l.x, l.y1); c.lineTo(l.x, l.y2); c.stroke(); }
          for (let i = 0; i < res.nodes.length; i++) { const nd = res.nodes[i]; c.fillStyle = !res.reach[i] ? '#ff2020' : !res.fromMain[i] ? '#ffd000' : '#30ff70'; const q = CROP.length ? 2 : 6; c.fillRect(nd.x - q / 2, nd.y - q, q, q); }
          c.strokeStyle = '#ff2020'; c.lineWidth = 6; for (const t of res.traps) c.strokeRect(t.x0 - 24, t.y0 - 44, t.x1 - t.x0 + 48, t.y1 - t.y0 + 56);
          c.fillStyle = '#fff'; c.font = 'bold 36px sans-serif'; res.traps.forEach((t, k) => c.fillText(String(k), t.x0 - 20, t.y0 - 50));
          out.img = cv.toDataURL('image/png');
        }
        return out;
      }, { id, IMG, CROP, SC, PLAIN });
      const bigTraps = r.traps.filter(t => t.n >= 1);
      if (bigTraps.length) bad++;
      console.log(`${r.id}: ${r.W}x${r.H} nodes=${r.total} main=${r.main} traps=${r.traps.length} unreachable=${r.unreach} (${r.ms}ms)`);
      r.traps.forEach((t, k) => console.log(`   #${k} x=${t.x}..${t.x + t.w} y=${t.y}..${t.y + t.h} n=${t.n}`));
      if (r.img) fs.writeFileSync(`test-results/nav-${r.id}${CROP.length ? '-crop' : ''}.png`, Buffer.from(r.img.split(',')[1], 'base64'));
    }
    process.exitCode = bad ? 1 : 0;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 2; });
