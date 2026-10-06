'use strict';
/* Камера (версия 21): после хода кадр сразу сменяется на нового бойца (без перелёта и рывка в сторону), после выстрела
   обзор не возвращается к сходившему бойцу, прыжок бойца не качает камеру, в непрерывном бою атаки соперника камера
   показывает только по выбору игрока: cut к атаке и обратно после выдержки, своя атака всегда важнее.
   При сервере: node -r ./dev/tools/pw-chromium.cjs tests/camera.cjs */
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs');
const base = process.env.TEST_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/profile', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base); await page.waitForSelector('#s-main.show', { timeout: 120000 });
    const R = await page.evaluate(() => {
      const SW = 1440, SH = 900, dt = 1 / 60, out = {};
      // свой бой и своя камера: шаги симуляции и кадры камеры по очереди, события — в свои эффекты
      const make = (extra) => {
        const S = sanitizeSettings(Object.assign({ mapId: 'valley', perTeam: 2, hp: 100, turnTime: 0, wind: false, walk: 'free' }, extra));
        const g = new Game({ mapId: 'valley', settings: S, teams: Profile.base.teams });
        const cam = new Camera(), fx = new FX(); fx.reset(g);
        const tick = (n = 1, each) => { for (let i = 0; i < n; i++) {
          g.step(dt); const evs = g.events; g.events = [];
          for (const ev of evs) { if (ev.t === 'boom') out.boomT = (out.boomT || 0) + 1; try { fx.handle(ev, g, true); } catch (e) { /* звук и частицы без окна */ } }
          if (fx.focus) { fx.focus.t -= dt; if (fx.focus.t <= 0) fx.focus = null; }
          cam.update(dt, g, fx, SW, SH, null); if (each) each();
        } };
        return { g, cam, fx, tick };
      };
      // 1. смена хода: стоп-кадр до смены, затем сразу новый боец, дальше — без движения
      {
        const { g, cam, tick } = make({});
        for (let i = 0; i < 600 && !(g.turn.phase === 'aim' && g.turn.sid); i++) tick();
        tick(30);
        const sid0 = g.turn.sid; g.cmd(g.turn.team, { c: 'skip' });
        let px = cam.x, py = cam.y, before = 0, cutStep = 0, after = 0, n = 0, cutAt = null;
        for (let i = 0; i < 900; i++) {
          tick(); const d = Math.hypot(cam.x - px, cam.y - py); px = cam.x; py = cam.y;
          if (cutAt === null && g.turn.sid !== sid0 && g.turn.phase === 'aim') { cutAt = i; cutStep = d; const s = g.active(); out.cutErr = Math.round(Math.abs(cam.x - Math.max(Math.min(s.x, g.W - SW / 2 / cam.z + 250), SW / 2 / cam.z - 250))); continue; }
          if (cutAt === null) before = Math.max(before, d); else if (++n <= 90) after = Math.max(after, d); else break;
        }
        out.turn = { cutAt, before: +before.toFixed(2), cutStep: Math.round(cutStep), after: +after.toFixed(2), cutErr: out.cutErr };
      }
      // 2. прыжок на месте: камера по высоте не качается
      {
        const { g, cam, tick } = make({});
        for (let i = 0; i < 600 && !(g.turn.phase === 'aim' && g.turn.sid); i++) tick();
        tick(60); const s = g.active(), y0 = cam.y; let dy = 0, top = s.y, air = false;
        g.cmd(g.turn.team, { c: 'jump', d: 0 });
        for (let i = 0; i < 90; i++) { tick(); dy = Math.max(dy, Math.abs(cam.y - y0)); top = Math.min(top, s.y); if (s.st === 'air') air = true; }
        out.jump = { air, rise: Math.round(s.y - top), camDy: +dy.toFixed(2) };
      }
      // 3. после выстрела обзор не возвращается к стрелку: держится у взрыва до смены хода
      {
        const { g, cam, tick } = make({});
        for (let i = 0; i < 600 && !(g.turn.phase === 'aim' && g.turn.sid); i++) tick();
        tick(30); const s = g.active(), sid0 = s.id, foe = g.soldiers.filter(o => o.team !== s.team && o.alive).sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
        g.turn.weapon = 'bazooka'; g.teams[g.turn.team].ammo.bazooka = -1;
        const a = Math.atan2(-(Math.abs(foe.x - s.x) * 0.55), foe.x - s.x); g.fire(s, { aim: a, pw: 0.85 });
        let boomAt = null, minD = Infinity, d0 = null, changed = false; out.boomT = 0;
        for (let i = 0; i < 60 * 14; i++) {
          tick();
          if (boomAt === null && out.boomT > 0) boomAt = i;
          if (g.turn.sid !== sid0 && g.turn.phase === 'aim') { changed = true; break; }
          if (boomAt !== null && i > boomAt + 60) { const d = Math.hypot(cam.x - s.x, cam.y - (s.y - 58)); if (d0 === null) d0 = d; minD = Math.min(minD, d); }
        }
        out.hold = { boom: boomAt !== null, changed, back: d0 === null ? 0 : Math.round(d0 - minD), far: d0 === null ? 0 : Math.round(d0) };
      }
      // 4. непрерывный бой: ракета соперника — камера стоит у своего бойца; с выбором «показывать» — сразу переключается к ней
      const foeRun = (foeOn) => {
        const { g, cam, tick } = make({ simul: true });
        cam.foe = foeOn;
        for (let i = 0; i < 900 && !(g.lanes.every(l => l.turn.phase === 'aim')); i++) tick();
        tick(40);
        const mine = g.soldierById(g.lanes[0].turn.sid);
        let rocket = null;
        g.inLane(1, () => { const s = g.active(); g.turn.weapon = 'bazooka'; g.teams[1].ammo.bazooka = -1; g.fire(s, { aim: s.x > g.W / 2 ? -Math.PI + 0.6 : -0.6, pw: 0.9 }); });
        rocket = g.entities.find(e => e.team === 1 && e.k === 'rocket');
        const xs = []; let nearRocket = Infinity, offMine = 0, firstError = null, firstGlide = null; const before = [cam.x, cam.y];
        for (let i = 0; i < 150; i++) {
          tick(); xs.push([cam.x, cam.y, !!cam.foeFocus, cam.track]);
          if (i === 0 && rocket) { firstError = Math.hypot(cam.x - rocket.x, cam.y - rocket.y); firstGlide = !!cam.glide; }
          if (rocket && !rocket.dead) nearRocket = Math.min(nearRocket, Math.hypot(cam.x - rocket.x, cam.y - rocket.y));
          offMine = Math.max(offMine, Math.hypot(cam.x - mine.x, cam.y - (mine.y - 58)));
        }
        let dv = 0; for (let i = 2; i < xs.length; i++) if (xs[i][2] && xs[i][3] && xs[i - 1][2] && xs[i - 1][3] && xs[i - 2][2] && xs[i - 2][3]) dv = Math.max(dv, Math.hypot(xs[i][0] - 2 * xs[i - 1][0] + xs[i - 2][0], xs[i][1] - 2 * xs[i - 1][1] + xs[i - 2][1]) / dt);
        return { rocket: !!rocket, nearRocket: Math.round(nearRocket), offMine: Math.round(offMine), dv: Math.round(dv), firstError, firstGlide, firstJump: Math.hypot(xs[0][0] - before[0], xs[0][1] - before[1]) };
      };
      out.foeOff = foeRun(false); out.foeOn = foeRun(true);
      // 5. Настоящие две параллельные атаки: чужая nuke (больший CAM_PRI) не перехватывает свою гранату/последствия.
      {
        const { g, cam, fx, tick } = make({ simul: true }); cam.foe = true;
        for (let i = 0; i < 900 && !g.lanes.every(l => l.turn.phase === 'aim'); i++) tick(); tick(30);
        g.inLane(0, () => { g.turn.weapon = 'grenade'; g.teams[0].ammo.grenade = -1; g.fire(g.active(), { aim: -0.7, pw: 0.8 }); });
        g.inLane(1, () => { g.turn.round = 3; g.turn.weapon = 'nuke'; g.teams[1].ammo.nuke = -1; g.fire(g.active(), { aim: 0, pw: 1, tx: 4900, ty: 800 }); });
        const enemy = g.entities.some(e => e.team === 1 && e.k === 'nukem'); let steals = 0, observed = 0; const mine = g.lanes[0].turn;
        for (let i = 0; i < 170; i++) { tick(); if (mine.phase === 'use' || mine.phase === 'retreat' || mine.phase === 'settle' || g.entities.some(e => e.team === 0 && cameraAttack(e))) { observed++; if (cam.foeFocus) steals++; } }
        out.priority = { steals, observed, shots: mine.shots, enemy };
      }
      // 6. Реальная чужая ракета: исчезновение -> неподвижный кадр >=0.6с -> cut к своему бойцу.
      {
        const { g, cam, fx, tick } = make({ simul: true }); cam.foe = true;
        for (let i = 0; i < 900 && !g.lanes.every(l => l.turn.phase === 'aim'); i++) tick(); tick(30);
        let cuts = 0; const frameCut = cam.frameCut.bind(cam); cam.frameCut = (...args) => { cuts++; return frameCut(...args); };
        g.inLane(1, () => { g.turn.weapon = 'bazooka'; g.teams[1].ammo.bazooka = -1; g.fire(g.active(), { aim: -Math.PI + 0.6, pw: 0.9 }); });
        tick(); let seen = !!cam.foeFocus;
        for (let i = 0; i < 900 && (g.entities.some(e => e.team === 1 && cameraAttack(e)) || fx.focus); i++) tick();
        const held = [cam.x, cam.y]; let maxDrift = 0;
        for (let i = 0; i < 34; i++) { tick(); maxDrift = Math.max(maxDrift, Math.hypot(cam.x - held[0], cam.y - held[1])); }
        const afterHold = !!cam.foeFocus; tick(15); const own = g.soldierById(g.lanes[0].turn.sid), expected = new Camera(); expected.z = cam.z; const target = expected.soldierTarget(own, SH); expected.frameCut(target, g, SW, SH);
        out.foeReturn = { seen, maxDrift, afterHold, returned: !cam.foeFocus, error: Math.hypot(cam.x - expected.x, cam.y - expected.y), glide: !!cam.glide, cuts };
      }
      return out;
    });
    fs.mkdirSync('test-results/camera', { recursive: true }); fs.writeFileSync('test-results/camera/continuous-v23.json', JSON.stringify(R, null, 2));
    console.log(JSON.stringify(R));
    assert(R.turn.cutAt !== null && R.turn.before < 0.6 && R.turn.after < 0.6 && R.turn.cutErr <= 2, 'turn change: still frame, instant cut to the new soldier, no flight ' + JSON.stringify(R.turn));
    assert(R.jump.air && R.jump.rise > 30 && R.jump.camDy < 2, 'camera does not bounce with a jump ' + JSON.stringify(R.jump));
    assert(R.hold.boom && R.hold.changed && R.hold.back < 25, 'after the shot the view does not return to the shooter ' + JSON.stringify(R.hold));
    assert(R.foeOff.rocket && R.foeOff.offMine < 40, 'continuous battle: enemy rocket ignored by default ' + JSON.stringify(R.foeOff));
    assert(R.foeOn.rocket && R.foeOn.firstError < 30 && R.foeOn.firstJump > 1000 && !R.foeOn.firstGlide, 'enemy attack starts with a hard cut ' + JSON.stringify(R.foeOn));
    assert(R.priority.enemy && R.priority.observed > 120 && R.priority.shots > 0 && R.priority.steals === 0, 'own attack retains absolute priority ' + JSON.stringify(R.priority));
    assert(R.foeReturn.seen && R.foeReturn.afterHold && R.foeReturn.maxDrift < 1e-6 && R.foeReturn.returned && R.foeReturn.error < 2 && !R.foeReturn.glide && R.foeReturn.cuts === 2, 'foe completion holds the frame then cuts home ' + JSON.stringify(R.foeReturn));
    assert.deepEqual(errors, []);
    console.log('Camera v21: instant cut on turn change, no return after the shot, no jump bounce, enemy cuts, own priority, completion hold and return cut PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
