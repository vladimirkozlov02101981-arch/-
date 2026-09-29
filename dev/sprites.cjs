'use strict';
/* Крупный рендер бойцов во всех позах и шапках (нужен запущенный сервер): node dev/sprites.cjs → test-results/sprites.png */
const { chromium } = require('playwright'); const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => console.error('PAGE ERROR', e.message));
    await page.goto('http://localhost:3000/?nocache=' + Date.now()); await page.waitForSelector('#s-main.show');
    const url = await page.evaluate(() => {
      const S = 5, cw = 60, chh = 56, hats = HAT_IDS, states = ['stand', 'walk', 'air', 'climb', 'jet', 'fly', 'dead'];
      const cv = document.createElement('canvas'); cv.width = cw * S * Math.max(hats.length, states.length + 2); cv.height = chh * S * 3;
      const c = cv.getContext('2d'); const g = c.createLinearGradient(0, 0, 0, cv.height); g.addColorStop(0, '#8fc8f0'); g.addColorStop(1, '#e8f4fb'); c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
      const cols = TEAM_COLORS;
      hats.forEach((h, i) => { c.save(); c.scale(S, S); c.translate(i * cw + cw / 2, 44); drawSoldier(c, { x: 0, y: 0, id: i, face: i % 2 ? -1 : 1, st: 'stand', alive: true, aim: i % 2 ? Math.PI + 0.3 : -0.3, wpn: null }, { color: cols[i % cols.length], hat: h }, 1.3, { walk: 0, blink: 0 }); c.restore(); });
      states.forEach((st, i) => { c.save(); c.scale(S, S); c.translate(i * cw + cw / 2, chh + 44); drawSoldier(c, { x: 0, y: 0, id: i, face: 1, st, rot: 0.6, alive: st !== 'dead', aim: -0.4, wpn: st === 'jet' ? 'jetpack' : null, thrust: st === 'jet' }, { color: cols[1], hat: 'helmet' }, 1.3, { walk: 1.1, blink: 0 }); c.restore(); });
      ['bazooka', 'sniper', 'grenade', 'shotgun', 'assault', 'plasma', 'airstrike', 'minigun'].forEach((w, i) => { c.save(); c.scale(S, S); c.translate(i * cw + cw / 2, chh * 2 + 44); drawSoldier(c, { x: 0, y: 0, id: i, face: i % 2 ? -1 : 1, st: 'stand', alive: true, aim: i % 2 ? Math.PI + 0.35 : -0.35, wpn: w }, { color: cols[0], hat: 'helmet' }, 1.3, { walk: 0, blink: 0 }); c.restore(); });
      return cv.toDataURL('image/png');
    });
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/sprites.png', Buffer.from(url.split(',')[1], 'base64'));
    console.log('ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
