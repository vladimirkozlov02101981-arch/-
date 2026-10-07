'use strict';
/* Версия 35 в настоящей игре: выстрел без движения камеры, если попадание видно; попадание за кадром — камера точно по его
   центру; ведение ствола во время очереди мышью с прежним разбросом */
const { chromium } = require('playwright'), fs = require('node:fs'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true }), out = { errors: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/profile', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage(); page.setDefaultTimeout(120000); page.on('pageerror', e => out.errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:3001'); await page.waitForSelector('#s-main.show');
    const start = async () => {
      await page.evaluate(() => App.startLocal({ mapId: 'valley', settings: sanitizeSettings({ ...Profile.base.settings, perTeam: 2, turnTime: 0, wind: false, walk: 'free', side: 'left', first: 'team1' }), teams: Profile.base.teams }, 'hotseat'));
      await page.waitForFunction(() => App.mode === 'hotseat' && App.sc && App.sc.turn && App.sc.turn.phase === 'aim' && App.ctl && App.ctl.mine && App.sc.round < 20);
      await page.evaluate(() => { App.sc.round = App.sc.turn.round = 20; for (const t of App.sc.teams) for (const w of WEAPONS) t.ammo[w.id] = -1; });
      await page.waitForTimeout(1200);
    };

    // 1. обзор сдвинут стрелками, боец целиком в кадре, попадание видно: выстрел сразу, камера не двигается и после выстрела
    await start();
    out.visible = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), cam = App.cam, sw = App.ren.sw, sh = App.ren.sh, s = App.sc.soldiers.find(o => o.id === App.sc.turn.sid);
      App.ctl.select('assault'); await wait(250);
      Input.keys.ArrowRight = true; await wait(300); Input.keys.ArrowRight = false; await wait(500);
      let aim = null, p = null;
      for (let k = 0; k <= 40 && !p; k++) { const a = (s.face || 1) > 0 ? 0.05 + k * 0.02 : Math.PI - 0.05 - k * 0.02, q = predictShot(App.sc, s, a, 'assault'); if (q) { const [qx, qy] = cam.toScreen(q.x, q.y, sw, sh); if (qx > sw * 0.2 && qx < sw * 0.8 && qy > sh * 0.2 && qy < sh * 0.85) { aim = a; p = q; } } }
      const before = { x: cam.x, y: cam.y }, panned = App.ctl.camPanned(cam), body = App.ctl.bodyInView(cam, s, sw, sh);
      const sent = [], send = App.ctl.send; App.ctl.send = c => { sent.push(c.c); return send(c); };
      App.ctl.aim = App.ctl.base = aim; App.ctl.fireFast(App.sc, cam, sw, sh, s, { c: 'fire', aim, pw: 1 }, 'assault');
      const pending = !!App.ctl.pendingShot; App.ctl.send = send;
      let maxMove = 0, frames = 0; const sid0 = App.sc.turn.sid; for (let i = 0; i < 50 && App.sc.turn.sid === sid0; i++) { await wait(50); if (App.sc.turn.sid !== sid0) break; frames++; maxMove = Math.max(maxMove, Math.hypot(cam.x - before.x, cam.y - before.y) * cam.z); }   /* до смены хода: новый ход — это уже другой кадр */
      return { found: !!p, panned, body, pending, fired: sent.includes('fire'), maxMove: Math.round(maxMove * 10) / 10, frames, phase: App.sc.turn.phase };
    });
    assert(out.visible.found && out.visible.body && out.visible.fired && !out.visible.pending, 'visible hit fires at once ' + JSON.stringify(out.visible));
    assert(out.visible.frames >= 10 && out.visible.maxMove < 3, 'camera does not move for a visible hit ' + JSON.stringify(out.visible));

    // 2. снайперка по далёкой точке за кадром: обзор встаёт точно по центру первого попадания, настоящее попадание видно
    await start();
    out.far = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), cam = App.cam, sw = App.ren.sw, sh = App.ren.sh, s = App.sc.soldiers.find(o => o.id === App.sc.turn.sid);
      App.ctl.select('sniper'); await wait(300);
      /* боец на открытой высоте посреди карты: оттуда видно далеко */
      let best = null; for (let x = 1800; x <= 4600; x += 50) { const y = App.sc.terrain.findTop(x, 0); if (y < App.sc.waterY - 40 && (!best || y < best.y)) best = { x, y }; }
      s.x = best.x; s.y = best.y; s.vx = s.vy = 0; cam.cut(App.sc, App.fx, s, sw, sh); await wait(500);
      let aim = null, p = null;
      for (let k = 0; k <= 160 && !p; k++) {
        const d = k % 2 ? 1 : -1, a = d > 0 ? -0.35 + k * 0.006 : Math.PI + 0.35 - k * 0.006, q = predictShot(App.sc, s, a, 'sniper');   /* в обе стороны по очереди */
        if (q && !cam.hitVisible(q.x, q.y, sw, sh) && q.x > 900 && q.x < App.sc.W - 900 && q.y > 300 && Math.hypot(q.x - s.x, q.y - s.y) > 900) { aim = a; p = q; }
      }
      if (!p) return { found: false };
      const sent = [], send = App.ctl.send; App.ctl.send = c => { sent.push({ c: c.c, t: performance.now() }); return send(c); };
      App.ctl.aim = App.ctl.base = aim; App.ctl.fireFast(App.sc, cam, sw, sh, s, { c: 'fire', aim, pw: 1 }, 'sniper');
      const t0 = performance.now(); while (App.ctl.pendingShot && performance.now() - t0 < 3000) await wait(20);
      const [px, py] = cam.toScreen(p.x, p.y, sw, sh); App.ctl.send = send;
      await wait(400); const H = App.fx.firstHit, hitSeen = !!H && cam.hitVisible(H.x, H.y, sw, sh);
      return { found: true, fired: sent.some(x => x.c === 'fire'), look: sent.some(x => x.c === 'look'), off: Math.round(Math.hypot(px - sw / 2, py - sh / 2)), hit: H && [Math.round(H.x), Math.round(H.y)], p: [Math.round(p.x), Math.round(p.y)], hitSeen };
    });
    assert(out.far.found, 'far target found ' + JSON.stringify(out.far));
    assert(out.far.fired && out.far.look && out.far.off <= 6, 'camera centers exactly on the far hit before the shot ' + JSON.stringify(out.far));
    assert(out.far.hitSeen, 'the real first hit is in view ' + JSON.stringify(out.far));

    // 3. очередь узи: ствол ведётся мышью вверх, боец не разворачивается
    await start();
    out.steer = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), s = App.sc.soldiers.find(o => o.id === App.sc.turn.sid), d = (s.face || 1) > 0 ? 1 : -1;
      App.ctl.select('uzi'); await wait(250);
      const aim0 = d > 0 ? 0 : Math.PI; App.ctl.aimMode = 'keys'; App.ctl.aim = App.ctl.base = aim0;
      App.ctl.send({ c: 'fire', aim: aim0, pw: 1 });
      await wait(60); const phase = App.sc.turn.phase, sx = Input.mouse.x;
      // мышь вверх и немного в сторону стрельбы
      const [gx, gy] = App.cam.toScreen(s.x, s.y - GUN_Y, App.ren.sw, App.ren.sh);
      for (let i = 1; i <= 8; i++) { Input.mouse.x = gx + d * 260; Input.mouse.y = gy - i * 22; Input.mouse.moved = true; await wait(40); }
      const aim1 = s.aim; return { phase, up: angNorm(d > 0 ? -aim1 : aim1 - Math.PI), facing: Math.cos(aim1) * d > 0, x: sx };
    });
    assert(out.steer.phase === 'use', 'burst is running ' + JSON.stringify(out.steer));
    assert(out.steer.up > 0.25 && out.steer.facing, 'barrel follows the mouse up during the burst ' + JSON.stringify(out.steer));

    assert.deepEqual(out.errors, []); out.pass = true;
  } finally {
    await browser.close(); fs.mkdirSync('test-results/camera36', { recursive: true }); fs.writeFileSync('test-results/camera36/report.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
