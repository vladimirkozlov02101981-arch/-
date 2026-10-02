'use strict';
/* Проверка карт на «висящие» объекты: декор (деревья, дома, камни, кусты…) должен опираться на землю.
   NODE_PATH=node_modules node -r ./dev/tools/pw-chromium.cjs dev/tools/decor-check.cjs [карта ...]
   Для каждой карты: слой объектов до наложения на заднюю стену, связные области объектов; у каждой — нижняя кромка
   и зазор до земли под ней. Отчёт: test-results/decor-check/<карта>.json и вырезки подозрительных мест (<карта>-N.png). */
const { chromium } = require('playwright');
const fs = require('node:fs');
const base = process.env.TEST_URL || 'http://localhost:3000';
const maps = process.argv.slice(2).length ? process.argv.slice(2) : ['valley', 'canyon', 'arctic', 'volcano', 'alien', 'pirate', 'castles', 'city'];
(async () => {
  fs.mkdirSync('test-results/decor-check', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const all = {};
  try {
    for (const mapId of maps) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base); await page.waitForSelector('#s-main.show', { timeout: 120000 });
      const res = await page.evaluate(async (mapId) => {
        await TexLib.load();
        const orig = lightDecorLayer; let obj = null;
        lightDecorLayer = function (cv) { orig(cv); obj = cv; };   // слой объектов до наложения на заднюю стену
        App.startLocal({ mapId, settings: { ...App.prefs.settings, perTeam: 1, turnTime: 0, wind: false }, teams: App.prefs.teams }, 'hotseat');
        for (let i = 0; i < 600 && !(App.game && App.game.turn.phase === 'aim'); i++) await new Promise((r) => setTimeout(r, 100));
        lightDecorLayer = orig;
        const T = App.sc.terrain, W = T.W, H = T.H, m = T.mask;
        if (!obj) return { error: 'no object layer' };
        const d = obj.getContext('2d').getImageData(0, 0, W, H).data, A = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) A[i] = d[i * 4 + 3] > 140 ? 1 : 0;
        // связные области (8-связность) — отдельные объекты
        const lab = new Int32Array(W * H), comps = []; let n = 0; const st = new Int32Array(W * H);
        for (let i = 0; i < W * H; i++) {
          if (!A[i] || lab[i]) continue;
          n++; let sp = 0; st[sp++] = i; lab[i] = n; let x0 = W, y0 = H, x1 = 0, y1 = 0, cnt = 0;
          while (sp) {
            const j = st[--sp], x = j % W, y = (j / W) | 0; cnt++;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              const k = yy * W + xx; if (A[k] && !lab[k]) { lab[k] = n; st[sp++] = k; }
            }
          }
          if (cnt >= 40) comps.push({ id: n, x0, y0, x1, y1, cnt });
        }
        // нижняя кромка: для каждого столбца — самый нижний пиксель объекта; зазор — сколько пустоты под ним до земли
        const solid = (x, y) => y >= H || (x >= 0 && x < W && m[y * W + x]);
        const out = [];
        for (const c of comps) {
          const bottoms = [];
          for (let x = c.x0; x <= c.x1; x++) { for (let y = c.y1; y >= c.y0; y--) if (lab[y * W + x] === c.id) { bottoms.push([x, y]); break; } }
          // опора: пиксели низа объекта (в 4 px от самой нижней точки) с землёй не дальше 3 px под ними
          const base = bottoms.filter(([, y]) => y >= c.y1 - 4);
          let touch = 0; for (const [x, y] of base) { for (let k = 1; k <= 3; k++) if (solid(x, y + k) || lab[(y + k) * W + x] && lab[(y + k) * W + x] !== c.id) { touch++; break; } }
          // наибольший зазор под нижней кромкой (по столбцам у самого низа) — объект завис над склоном
          let gapMax = 0, gapAt = null;
          for (const [x, y] of base) { let g = 0; while (g < 80 && !solid(x, y + 1 + g)) g++; if (g > gapMax) { gapMax = g; gapAt = [x, y]; } }
          const w = c.x1 - c.x0 + 1;
          if (touch === 0 || (gapMax >= 8 && base.length >= 6 && touch / base.length < 0.5)) out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, w, cnt: c.cnt, base: base.length, touch, gapMax, gapAt, floating: touch === 0 });
        }
        return { W, H, comps: comps.length, suspects: out };
      }, mapId);
      // вырезки подозрительных мест с готовой картой (декор + ландшафт)
      if (res.suspects) {
        res.suspects.sort((a, b) => (b.floating - a.floating) || b.gapMax - a.gapMax);
        for (let i = 0; i < Math.min(14, res.suspects.length); i++) {
          const s = res.suspects[i], pad = 40;
          const png = await page.evaluate(([s, pad]) => {
            const T = App.sc.terrain, x0 = Math.max(0, s.x0 - pad), y0 = Math.max(0, s.y0 - pad), w = Math.min(T.W - x0, s.x1 - s.x0 + 2 * pad), h = Math.min(T.H - y0, s.y1 - s.y0 + 2 * pad);
            const k = Math.max(1, Math.min(3, Math.floor(420 / Math.max(w, h)))), cv = makeCanvas(w * k, h * k), c = cv.getContext('2d');
            c.fillStyle = '#7fa8d8'; c.fillRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
            c.drawImage(T.decor, x0, y0, w, h, 0, 0, w * k, h * k); c.drawImage(T.canvas, x0, y0, w, h, 0, 0, w * k, h * k);
            if (T.surface) c.drawImage(T.surface.canvas, x0, y0, w, h, 0, 0, w * k, h * k);
            c.strokeStyle = '#ff2a2a'; c.lineWidth = 2; c.strokeRect((s.x0 - x0) * k, (s.y0 - y0) * k, (s.x1 - s.x0 + 1) * k, (s.y1 - s.y0 + 1) * k);
            return cv.toDataURL('image/png');
          }, [s, pad]);
          fs.writeFileSync(`test-results/decor-check/${mapId}-${i}.png`, Buffer.from(png.split(',')[1], 'base64'));
          s.crop = `${mapId}-${i}.png`;
        }
      }
      res.errors = errors; all[mapId] = res;
      fs.writeFileSync(`test-results/decor-check/${mapId}.json`, JSON.stringify(res, null, 1));
      console.log(mapId, 'objects', res.comps, 'suspects', res.suspects ? res.suspects.length : res.error, res.suspects ? res.suspects.filter((s) => s.floating).length + ' floating' : '');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
