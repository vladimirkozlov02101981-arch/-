'use strict';
/* Вырезки готовой карты (декор + ландшафт + поверхность) для осмотра артефактов.
   NODE_PATH=node_modules node -r ./dev/tools/pw-chromium.cjs dev/tools/map-crop.cjs <карта> x0,y0,x1,y1[,k] [...]
   или <карта> full [k] — вся карта (k — масштаб, по умолчанию 0.5). Файлы: test-results/map-crop/<карта>-<x0>-<y0>.png */
const { chromium } = require('playwright');
const fs = require('node:fs');
const base = process.env.TEST_URL || 'http://localhost:3000';
const [mapId, ...boxes] = process.argv.slice(2);
(async () => {
  fs.mkdirSync('test-results/map-crop', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => console.log('ERR', e.message));
    await page.goto(base); await page.waitForSelector('#s-main.show', { timeout: 120000 });
    await page.evaluate(async (mapId) => {
      await TexLib.load();
      App.startLocal({ mapId, settings: { ...App.prefs.settings, perTeam: 1, turnTime: 0, wind: false }, teams: App.prefs.teams }, 'hotseat');
      for (let i = 0; i < 600 && !(App.game && App.game.turn.phase === 'aim'); i++) await new Promise((r) => setTimeout(r, 100));
      await MapArt.get(App.sc.map.id).decode();
    }, mapId);
    const list = boxes[0] === 'full' ? [[0, 0, 6400, 1800, +(boxes[1] || 0.5)]] : boxes.map((b) => b.split(',').map(Number));
    for (const [x0, y0, x1, y1, k = 2] of list) {
      const png = await page.evaluate(([x0, y0, x1, y1, k]) => {
        const T = App.sc.terrain, w = x1 - x0, h = y1 - y0, cv = makeCanvas(Math.round(w * k), Math.round(h * k)), c = cv.getContext('2d');
        // ровный фон неба: на нём хорошо видно висящие в воздухе объекты и лишние пиксели
        c.fillStyle = '#7fa8d8'; c.fillRect(0, 0, cv.width, cv.height);
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
        c.drawImage(T.decor, 0, 0); c.drawImage(T.canvas, 0, 0);
        if (T.drawSurfaceNative) T.drawSurfaceNative(c, { x0, y0, x1, y1 }, k);
        if (typeof drawProps === 'function') try { drawProps(c, App.sc, 0, false); } catch (e) { /* */ }
        return cv.toDataURL('image/png');
      }, [x0, y0, x1, y1, k]);
      const out = `test-results/map-crop/${mapId}-${x0}-${y0}.png`;
      fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64')); console.log(out);
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
