'use strict';
/* Реальный обработчик мыши: оптика проходит всю карту, успокаивается, сохраняет цель при масштабе/бинокле.
   При отдельном сервере копии: TEST_URL=http://127.0.0.1:3001 node -r ./dev/tools/pw-chromium.cjs tests/scope.cjs */
const { chromium } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs');
const base = process.env.TEST_URL || 'http://127.0.0.1:3001';
(async () => {
  const browser = await chromium.launch({ headless: true }); const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/profile', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.waitForSelector('#s-main.show', { timeout: 120000 });
    const report = await page.evaluate(() => {
      const sw = 1440, sh = 900, dt = 1 / 60, cv = document.getElementById('game'), out = {};
      const settings = sanitizeSettings({ mapId: 'valley', perTeam: 2, hp: 100, turnTime: 0, wind: false, walk: 'free' });
      const sc = new Game({ mapId: 'valley', settings, teams: Profile.base.teams });
      for (let i = 0; i < 600 && sc.turn.phase !== 'aim'; i++) sc.step(dt);
      const s = sc.active(); sc.turn.weapon = 'sniper'; sc.teams[sc.turn.team].ammo.sniper = -1;
      const sent = [], ctl = new LocalController(c => sent.push(c)); ctl.myTeams = [sc.turn.team];
      const cam = new Camera(), fx = { shake: 0, focus: null }; cam.update(dt, sc, fx, sw, sh, Input.mouse);
      const saved = { locked: Input.locked, wantLock: Input.wantLock, mouse: { ...Input.mouse }, keys: Input.keys, pressed: Input.pressed, onWheel: Input.onWheel };
      const tick = (n = 1) => { for (let i = 0; i < n; i++) {
        ctl.binoc = cam.binoc; ctl.update(dt, sc, cam, sw, sh, sc.turn); cam.edge = ctl.edgePan;
        cam.scopeFocus = ctl.scopePoint && !ctl.binoc && !ctl.pendingShot ? { point: ctl.scopePoint, locked: Input.locked, visible: ctl.scopeOn, moving: Input.mouse.moved || Keys.down('aimUp') || Keys.down('aimDown') } : null;
        cam.update(dt, sc, fx, sw, sh, Input.mouse); if (cam.scopeFocus) ctl.syncScope(sc, cam, sw, sh); Input.endFrame();
      } };
      const move = (dx, dy) => { cv.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true })); tick(); };
      try {
        Input.locked = true; Input.wantLock = false; Input.keys = {}; Input.pressed = {}; Input.mouse.x = sw / 2; Input.mouse.y = sh / 2; Input.mouse.dx = Input.mouse.dy = 0; tick();
        out.corners = [];
        for (const [dx, dy] of [[-20000, -20000], [20000, 0], [0, 20000], [-20000, 0]]) {
          move(dx, dy); tick(30); const p = ctl.scopePoint, screen = cam.toScreen(p.x, p.y, sw, sh);
          out.corners.push({ x: p.x, y: p.y, sx: screen[0], sy: screen[1], z: cam.z });
        }
        move(4400 * cam.z, -700 * cam.z); const fixed = { ...ctl.scopePoint }; tick(30);
        out.rest = { target: { ...ctl.scopePoint }, fixed, error: Math.abs(ctl.aim - ctl.base), amp: ctl.swayAmp };
        const p = ctl.scopePoint, before = cam.toScreen(p.x, p.y, sw, sh); cam.zoomAt(1.7, 0, 0, sw, sh); const after = cam.toScreen(p.x, p.y, sw, sh);
        out.zoom = { before, after, target: { ...p } }; tick(30);
        const original = { ...p }; cam.binoc = true; move(500, -250); tick(30); cam.binoc = false; tick(30);
        out.binoc = { original, after: { ...ctl.scopePoint }, error: Math.abs(ctl.aim - ctl.base) };
        Input.pressed.ControlLeft = true; tick(); out.hidden = !ctl.scopeOn;
        Input.keys.KeyI = true; tick(10); Input.keys = {}; tick(30); const keyboard = ctl.base;
        cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 1, clientY: 1, bubbles: true })); tick();
        const expected = ctl.aim; tick(90); const shot = sent.filter(c => c.c === 'fire').pop(); out.click = { keyboard, base: ctl.base, aim: shot && shot.aim, expected };
        ctl.pendingShot = null;
        // Без захвата: неподвижная точка внутри кадра стабильна; край ведёт обзор до дальнего участка.
        Input.locked = false; cam.shot = null; Input.mouse.x = sw / 2; Input.mouse.y = sh / 2;
        cv.dispatchEvent(new MouseEvent('mousemove', { clientX: sw / 2, clientY: sh / 2, bubbles: true })); tick(30);
        const center = { ...ctl.scopePoint }; tick(30); out.absoluteRest = { before: center, after: { ...ctl.scopePoint } };
        cv.dispatchEvent(new MouseEvent('mousemove', { clientX: sw - 1, clientY: sh / 2, bubbles: true })); const x0 = cam.x; tick(120);
        out.edge = { shift: cam.x - x0, target: { ...ctl.scopePoint } };
        cv.dispatchEvent(new MouseEvent('mousemove', { clientX: sw / 2, clientY: sh / 2, bubbles: true })); tick(30);
        const stopped = [cam.x, cam.y], target = { ...ctl.scopePoint }; tick(30); out.edgeStop = { stopped, after: [cam.x, cam.y], target, afterTarget: { ...ctl.scopePoint } };
        // Настоящие события колеса с обычным оружием: угол/ствол не меняются, наведение возобновляет только движение мыши.
        sc.turn.weapon = 'bazooka'; cam.shot = null; cv.dispatchEvent(new MouseEvent('mousemove', { clientX: 950, clientY: 430, bubbles: true })); tick(30);
        const baseAim = ctl.base, aimPoint = { ...ctl.aimPoint }; out.weaponZoom = { baseAim, aimPoint, angles: [] };
        Input.onWheel = (d, x, y) => cam.zoomAt(Math.exp(-d * 0.001), x, y, sw, sh);
        for (const d of [-450, 620, -900, 730]) { cv.dispatchEvent(new WheelEvent('wheel', { deltaY: d, clientX: 950, clientY: 430, bubbles: true })); tick(30); out.weaponZoom.angles.push(ctl.base); }
        out.weaponZoom.afterPoint = { ...ctl.aimPoint };
        cv.dispatchEvent(new MouseEvent('mousemove', { clientX: 980, clientY: 445, bubbles: true })); tick(); out.weaponZoom.adjusted = ctl.base;
      } finally {
        Input.locked = saved.locked; Input.wantLock = saved.wantLock; Object.assign(Input.mouse, saved.mouse); Input.keys = saved.keys; Input.pressed = saved.pressed; Input.onWheel = saved.onWheel;
      }
      return out;
    });
    fs.mkdirSync('test-results/scope', { recursive: true }); fs.writeFileSync('test-results/scope/input-report.json', JSON.stringify(report, null, 2));
    const pad = Math.round(900 * 0.16) + 16;
    assert.deepEqual(report.corners.map(p => [p.x, p.y]), [[0, -900], [6399, -900], [6399, 1799], [0, 1799]]);
    for (const p of report.corners) assert(p.sx >= pad - 0.01 && p.sx <= 1440 - pad + 0.01 && p.sy >= pad - 0.01 && p.sy <= 900 - pad + 0.01, 'lens clipped: ' + JSON.stringify(p));
    assert.deepEqual(report.rest.target, report.rest.fixed); assert.equal(report.rest.error, 0); assert.equal(report.rest.amp, 0);
    assert(Math.hypot(report.zoom.before[0] - report.zoom.after[0], report.zoom.before[1] - report.zoom.after[1]) < 1e-7, 'scope point anchored during zoom'); assert.deepEqual(report.binoc.original, report.binoc.after); assert.equal(report.binoc.error, 0); assert(report.hidden);
    assert(Number.isFinite(report.click.aim) && Math.abs(report.click.aim - report.click.expected) < 1e-10, 'click fires current scope aim');
    assert.deepEqual(report.absoluteRest.before, report.absoluteRest.after); assert(report.edge.shift > 200, 'unlocked edge pan');
    assert.deepEqual(report.edgeStop.target, report.edgeStop.afterTarget); assert(Math.hypot(report.edgeStop.stopped[0] - report.edgeStop.after[0], report.edgeStop.stopped[1] - report.edgeStop.after[1]) < 1e-7, 'edge pan stops');
    for (const a of report.weaponZoom.angles) assert(Math.abs(a - report.weaponZoom.baseAim) < 1e-10, 'wheel tilts weapon'); assert.deepEqual(report.weaponZoom.aimPoint, report.weaponZoom.afterPoint); assert.notEqual(report.weaponZoom.adjusted, report.weaponZoom.baseAim);
    assert.deepEqual(errors, []); fs.mkdirSync('test-results/scope', { recursive: true }); fs.writeFileSync('test-results/scope/input-report.json', JSON.stringify(report, null, 2));
    console.log('Scope: real pointer deltas, map corners, lens bounds, complete rest, zoom, binoculars, Ctrl, keys/click and unlocked edge pan PASS');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
