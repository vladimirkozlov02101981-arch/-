'use strict';
/* Версия 36 в настоящей игре: после стрелок удары по точке наводятся по всей карте (стрелками и краем экрана), приближение у
   края карты идёт вокруг прицела, после стрелок с обычным оружием масштаб держит бойца на месте, разумный предел приближения,
   подписи сторон на одном ПК */
const { chromium } = require('playwright'), fs = require('node:fs'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true }), out = { errors: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/profile', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage(); page.setDefaultTimeout(120000); page.on('pageerror', e => out.errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:3001'); await page.waitForSelector('#s-main.show');

    // подписи сторон
    out.sides = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)); UI.act('hotseat'); await wait(400);
      const hot = [...document.querySelectorAll('#o-side option')].map(o => o.textContent), label = document.querySelector('#o-side').closest('.setting').querySelector('.setting-label').textContent;
      UI.act('back'); await wait(200); UI.act('cpu'); await wait(400);
      const cpu = [...document.querySelectorAll('#o-side option')].map(o => o.textContent); UI.act('back'); await wait(200);
      return { hot, label, cpu };
    });
    assert(/Слева — игрок 1/.test(out.sides.hot[1]) && /Слева — игрок 2/.test(out.sides.hot[2]) && out.sides.cpu[1] === 'Левая', 'side labels ' + JSON.stringify(out.sides));

    await page.evaluate(() => App.startLocal({ mapId: 'valley', settings: sanitizeSettings({ ...Profile.base.settings, perTeam: 2, turnTime: 0, wind: false, walk: 'free', side: 'left', first: 'team1' }), teams: Profile.base.teams }, 'hotseat'));
    await page.waitForFunction(() => App.mode === 'hotseat' && App.sc && App.sc.turn && App.sc.turn.phase === 'aim' && App.ctl && App.ctl.mine);
    await page.evaluate(() => { App.sc.round = App.sc.turn.round = 20; for (const t of App.sc.teams) for (const w of WEAPONS) t.ammo[w.id] = -1; });
    await page.waitForTimeout(1200);

    // 1. стрелки с базукой, затем авиаудар: стрелки и край экрана ведут обзор далеко от бойца
    out.pick = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), cam = App.cam, sw = App.ren.sw, sh = App.ren.sh, s = App.sc.soldiers.find(o => o.id === App.sc.turn.sid);
      App.ctl.select('bazooka'); await wait(200);
      Input.keys.ArrowRight = true; await wait(400); Input.keys.ArrowRight = false; await wait(300);
      const manual = cam.manualActive;
      App.ctl.select('airstrike'); await wait(300);
      const x0 = cam.x; Input.keys.ArrowRight = true; await wait(1500); Input.keys.ArrowRight = false; await wait(200);
      const x1 = cam.x, [sx] = cam.toScreen(s.x, s.y, sw, sh);
      // край экрана
      Input.mouse.inside = true; Input.mouse.x = sw - 2; Input.mouse.y = sh / 2; Input.mouse.moved = true; await wait(1500);
      const x2 = cam.x; Input.mouse.x = sw / 2; Input.mouse.moved = true; await wait(200);
      return { manual, arrows: Math.round(x1 - x0), edge: Math.round(x2 - x1), soldierOff: sx < 0 || sx > sw, hold: cam.hold };
    });
    assert(out.pick.manual && out.pick.arrows > 400 && out.pick.edge > 300 && out.pick.soldierOff, 'pick weapon view roams the map ' + JSON.stringify(out.pick));

    // 2. у правого края карты: приближение вокруг прицела, мировая точка под курсором остаётся под ним
    out.edgeZoom = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), cam = App.cam, sw = App.ren.sw, sh = App.ren.sh;
      Input.mouse.inside = true; Input.mouse.x = sw - 2; Input.mouse.y = sh / 2; Input.mouse.moved = true;
      for (let i = 0; i < 60 && cam.x < App.sc.W - sw / 2 / cam.z + 200; i++) await wait(100);
      Input.mouse.x = sw - 160; Input.mouse.y = sh * 0.6; Input.mouse.moved = true; await wait(300);
      const p = cam.toWorld(Input.mouse.x, Input.mouse.y, sw, sh), z0 = cam.z;
      for (let i = 0; i < 4; i++) { cam.zoomAt(1.25, Input.mouse.x, Input.mouse.y, sw, sh); await wait(150); }
      await wait(1500);
      const q = cam.toScreen(p[0], p[1], sw, sh), view = cam.view(sw, sh);
      return { z0: +z0.toFixed(3), z: +cam.z.toFixed(3), drift: Math.round(Math.hypot(q[0] - Input.mouse.x, q[1] - Input.mouse.y)), edgeSeen: view.x1 >= App.sc.W - 1, maxZ: +cam.zoomLimits(sh, sw)[1].toFixed(3), base: +cam.baseZoom(sh, sw).toFixed(3) };
    });
    assert(out.edgeZoom.z > out.edgeZoom.z0 * 1.8 && out.edgeZoom.drift <= 6 && out.edgeZoom.edgeSeen, 'zoom at the map edge keeps the aim point ' + JSON.stringify(out.edgeZoom));
    assert(Math.abs(out.edgeZoom.maxZ - out.edgeZoom.base * 2.5) < 1e-3, 'reasonable zoom limit ' + JSON.stringify(out.edgeZoom));

    // 3. обычное оружие после стрелок: масштаб держит бойца на том же месте экрана
    out.manualZoom = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), cam = App.cam, sw = App.ren.sw, sh = App.ren.sh, s = App.sc.soldiers.find(o => o.id === App.sc.turn.sid);
      App.ctl.select('bazooka'); cam.userZ = null; for (let i = 0; i < 40; i++) { await wait(100); const [x] = cam.toScreen(s.x, s.y, sw, sh); if (x > 100 && x < sw - 100 && !cam.glide) break; } await wait(600);
      Input.keys.ArrowLeft = true; await wait(350); Input.keys.ArrowLeft = false; await wait(400);
      const a = cam.toScreen(s.x, s.y - 18, sw, sh), z0 = cam.z;
      for (let i = 0; i < 3; i++) { cam.zoomAt(1.3, sw / 2, sh / 2, sw, sh); await wait(120); }
      await wait(1500); const b = cam.toScreen(s.x, s.y - 18, sw, sh);
      for (let i = 0; i < 3; i++) { cam.zoomAt(0.75, sw / 2, sh / 2, sw, sh); await wait(120); }
      await wait(1500); const c = cam.toScreen(s.x, s.y - 18, sw, sh);
      return { manual: cam.manualActive, z0: +z0.toFixed(3), zIn: +cam.z.toFixed(3), a: a.map(Math.round), b: b.map(Math.round), c: c.map(Math.round), inDrift: Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])), outDrift: Math.round(Math.hypot(c[0] - a[0], c[1] - a[1])) };
    });
    assert(out.manualZoom.inDrift <= 8 && out.manualZoom.outDrift <= 8, 'soldier keeps its screen place while zooming after arrows ' + JSON.stringify(out.manualZoom));

    // 4. боец у края экрана после стрелок, приближение до предела: весь боец с оружием остаётся в кадре
    out.edgeFit = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), cam = App.cam, sw = App.ren.sw, sh = App.ren.sh, s = App.sc.soldiers.find(o => o.id === App.sc.turn.sid);
      App.ctl.select('bazooka'); cam.userZ = null; await wait(1500);
      Input.keys.ArrowRight = true; await wait(2500); Input.keys.ArrowRight = false; await wait(300);
      const box = () => { const a = cam.toScreen(s.x - 16, s.y - 44, sw, sh), b = cam.toScreen(s.x + 16, s.y + 4, sw, sh); return [Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1])]; };
      const before = box(); let worst = 1e9;
      for (let i = 0; i < 8; i++) { cam.zoomAt(1.35, sw / 2, sh / 2, sw, sh); for (let k = 0; k < 6; k++) { await wait(50); const b = box(); worst = Math.min(worst, b[0], b[1], sw - b[2], sh - b[3]); } }
      await wait(1200); const after = box(); worst = Math.min(worst, after[0], after[1], sw - after[2], sh - after[3]);
      return { before, after, worst, z: +cam.z.toFixed(2), manual: cam.manualActive };
    });
    assert(out.edgeFit.worst >= 0, 'whole soldier stays in frame while zooming after arrows ' + JSON.stringify(out.edgeFit));

    assert.deepEqual(out.errors, []); out.pass = true;
  } finally {
    await browser.close(); fs.mkdirSync('test-results/camera37', { recursive: true }); fs.writeFileSync('test-results/camera37/report.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
