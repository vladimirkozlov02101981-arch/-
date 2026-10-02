'use strict';
/* Проверки по просьбам игрока (версия 2026.10.01-15):
   шапки на 3D-бойце, время хода без лимита, камера на ударе молнии, лазер ×3 без отталкивания,
   бомбы самолёта ровно в прицел, прокрутка обзора курсором у края для оружия с выбором точки. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.TEST_URL || 'http://localhost:3000';
(async () => {
  fs.mkdirSync('test-results', { recursive: true });
  const browser = await chromium.launch({ channel: process.env.TEST_BROWSER || 'chrome', headless: true });
  const errors = [], report = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.waitForSelector('#s-main.show', { timeout: 60000 });
    await page.waitForFunction(() => SoldierArt.ok(), {}, { timeout: 30000 });

    // 1. Шапки: в режиме 3D-спрайта каждая шапка меняет рисунок бойца, каска — встроенная в модель
    report.hats = await page.evaluate(() => {
      const sig = (hat, st, wpn) => {
        const cv = makeCanvas(160, 200), c = cv.getContext('2d'); c.scale(3, 3);
        drawSoldier(c, { id: 1, x: 26, y: 60, aim: -0.3, face: 1, st, rot: 0, wpn, alive: true, hurt: 0 }, { color: '#ff4d4d', hat }, 1.2, { walk: 2, blink: 0 });
        const d = c.getImageData(0, 0, cv.width, cv.height).data; let h = 2166136261; for (let i = 0; i < d.length; i += 4) h = Math.imul(h ^ (d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11), 16777619);
        return h >>> 0;
      };
      const out = {};
      for (const st of [['stand', 'bazooka'], ['walk', null], ['climb', null], ['air', null]]) out[st[0]] = new Set(HAT_IDS.map(h => sig(h, st[0], st[1]))).size;
      // голова в кадрах с прицелом совпадает с кадрами без оружия (шапка не «плавает»)
      const a = SoldierArt.head('aim', 6, 0), f = SoldierArt.head('free', 0, 0), w = SoldierArt.head('aim', 3, 4), fw = SoldierArt.head('free', 1, 3);
      return { distinct: out, n: HAT_IDS.length, aimHead: [a.x, a.y], idleHead: [f.x, f.y], walkAim: [w.x, w.y], walk: [fw.x, fw.y] };
    });
    for (const k of Object.keys(report.hats.distinct)) assert.equal(report.hats.distinct[k], report.hats.n, 'every hat visible on the 3D soldier: ' + k);
    assert.deepEqual(report.hats.aimHead, report.hats.idleHead); assert.deepEqual(report.hats.walkAim, report.hats.walk);
    console.log('Hats on the 3D soldier PASS', report.hats);

    // шапки в окне настройки: превью меняется при выборе шапки
    await page.click('[data-act="hotseat"]'); await page.waitForSelector('#s-setup.show');
    const p0 = await page.evaluate(() => document.querySelector('[data-team="0"] .tc-preview').toDataURL());
    await page.click('[data-team="0"] .hat-btn:nth-child(5)');
    const p1 = await page.evaluate(() => ({ url: document.querySelector('[data-team="0"] .tc-preview').toDataURL(), hat: UI.teamsCfg[0].hat, want: HAT_IDS[4] }));
    assert.notEqual(p0, p1.url, 'setup preview shows the chosen hat'); assert.equal(p1.hat, p1.want);
    await page.screenshot({ path: 'test-results/hats-setup.png', clip: { x: 0, y: 0, width: 1440, height: 900 } });

    // 2. Время хода без лимита: галочка, сохранение настроек, ход не кончается сам, ∞ на табло
    await page.check('#o-turnInf');
    report.unlimited = await page.evaluate(() => ({ s: UI.settings.turnTime, disabled: document.getElementById('o-turnTime').disabled, kept: sanitizeSettings({ turnTime: 0 }).turnTime, missing: sanitizeSettings({}).turnTime }));
    assert.deepEqual(report.unlimited, { s: 0, disabled: true, kept: 0, missing: 45 });
    await page.click('#btn-start'); await page.waitForFunction(() => App.mode === 'hotseat' && App.game && App.game.turn.phase === 'aim', {}, { timeout: 60000 });
    report.unlimitedTurn = await page.evaluate(() => {
      const g = App.game, sid = g.turn.sid; for (let i = 0; i < 60 * 200; i++) g.step(1 / 60);
      return { phase: g.turn.phase, same: g.turn.sid === sid, setting: g.cfg.settings.turnTime };
    });
    assert.deepEqual(report.unlimitedTurn, { phase: 'aim', same: true, setting: 0 });
    await page.waitForTimeout(300); await page.screenshot({ path: 'test-results/turn-unlimited.png', clip: { x: 520, y: 0, width: 400, height: 110 } });
    report.limited = await page.evaluate(() => sanitizeSettings({ turnTime: 30 }).turnTime);
    assert.equal(report.limited, 30);
    console.log('Unlimited turn time PASS', report.unlimited, report.unlimitedTurn);

    // общая «арена» для оружия
    const arena = `(() => {
      const W = 3000, H = 900, mask = new Uint8Array(W * H); mask.fill(1, 600 * W);
      const g = Object.create(Game.prototype); Object.assign(g, { W, H, waterY: 860, gravity: 640, map: { ladders: [] }, terrain: new Terrain(W, H, mask), round: 4, time: 0, nextId: 3, over: null, events: [], entities: [], pending: [], props: [], usage: null, ctrl: null, teamsDirty: true, sdStarted: false, cfg: { settings: { turnTime: 90, crates: false, wind: true, sd: 0 } } });
      g.teams = [0, 1].map(idx => ({ idx, name: String(idx), ammo: makeAmmo('all'), dmg: 0, kills: 0, order: [idx + 1], next: 0, lastW: 'bazooka' }));
      g.soldiers = [new Soldier(1, 0, 'A', 300, 600, 100), new Soldier(2, 1, 'B', 1800, 600, 1000)];
      g.turn = { team: 0, sid: 1, phase: 'aim', weapon: 'bazooka', shots: 0, walk: 420, time: 90, wind: 0, rot: 0, round: 4, retreat: 0, charge: -1 };
      return g;
    })()`;

    // 4. Орбитальный лазер: урон втрое выше прежнего, боец не отлетает
    report.orbital = await page.evaluate((arena) => {
      // глубокая земля: луч не доходит до воды, боец не тонет — считается только урон луча
      const g = eval(arena.replace('H = 900', 'H = 1800').replace('waterY: 860', 'waterY: 1760')), b = g.soldiers[1]; g.turn.weapon = 'orbital';
      const orig = Math.random; Math.random = () => 0.5;   // без ошибки наведения
      try { g.fire(g.active(), { aim: 0, pw: 1, tx: b.x, ty: b.y }); } finally { Math.random = orig; }
      const e = g.entities.find(o => o.k === 'orbital'); e.x = b.x;
      let maxVx = 0, maxUp = 0, beam = 0; const x0 = b.x, dmg = g.damage.bind(g);
      g.damage = (s, v, ...r) => { if (s === b) beam += Math.min(v, s.hp); return dmg(s, v, ...r); };   // только урон луча (не утопление)
      for (let i = 0; i < 60 * 4 && g.entities.some(o => o.k === 'orbital'); i++) { g.step(1 / 60); maxVx = Math.max(maxVx, Math.abs(b.vx)); maxUp = Math.max(maxUp, -b.vy); }
      return { dmg: beam, ticks: g.events.filter(ev => ev.t === 'dmg' && ev.id === b.id).map(ev => ev.v), maxVx, maxUp, dx: Math.abs(b.x - x0), st: b.st };
    }, arena);
    assert(report.orbital.ticks.filter(v => v === 15).length >= 10 && report.orbital.dmg >= 150, 'orbital burns 15 per tick (was 5): ' + JSON.stringify(report.orbital));
    assert(report.orbital.maxVx < 1 && report.orbital.maxUp < 1 && report.orbital.dx < 1, 'orbital never pushes: ' + JSON.stringify(report.orbital));
    console.log('Orbital laser x3, no push PASS', report.orbital);

    // 5. Авиаудар: сброс вручную — бомбы летят вперёд по инерции самолёта и ложатся ровно туда, куда ведёт физика; у цели самолёт сам не бомбит
    report.airstrike = await page.evaluate((arena) => {
      const runs = [];
      for (const [tx, wind, sx] of [[1500, 0, 300], [1500, 170, 300], [1500, -170, 300], [900, 120, 2500], [2100, -90, 2500], [1200, 60, 300]]) {
        const g = eval(arena); g.turn.weapon = 'airstrike'; g.turn.wind = wind; g.active().x = sx; g.soldiers[1].x = 2900;
        // ступенька рельефа у цели: прицел сброса считает настоящую землю
        for (let y = 520; y < 600; y++) for (let x = tx - 200; x < tx - 60; x++) g.terrain.mask[y * g.W + x] = 1;
        g.fire(g.active(), { aim: 0, pw: 1, tx, ty: 590 });
        const jet = g.entities.find(e => e.k === 'jet');
        const booms = []; const ex = g.explode.bind(g); g.explode = (x, y, R, D, o) => { booms.push(x); return ex(x, y, R, D, o); };
        let pred = null, rel = null;
        for (let i = 0; i < 60 * 8; i++) {
          if (pred === null && !jet.dropped) { const h = bombImpact(g, jet.x, jet.y, jet.dir); if (h && (jet.dir > 0 ? h.x >= tx : h.x <= tx)) { pred = h.x; rel = jet.x; g.cmd(0, { c: 'fire', x: jet.x }); } }
          g.step(1 / 60);
        }
        const first = booms.find(x => Math.abs(x - pred) < 40); booms.sort((a, b) => a - b);
        runs.push({ tx, wind, n: booms.length, pred, first, mid: booms[2], err: Math.max(Math.abs(first - pred), Math.abs(booms[2] - pred)), offTarget: Math.abs(pred - tx), drift: Math.abs(pred - rel), spread: booms[booms.length - 1] - booms[0] });
      }
      // без нажатия у цели бомбы не падают: запасной сброс — лишь далеко за ней (обычно раньше срабатывает край экрана)
      const g = eval(arena); g.turn.weapon = 'airstrike'; g.fire(g.active(), { aim: 0, pw: 1, tx: 1200, ty: 590 });
      const jet = g.entities.find(e => e.k === 'jet'); let dropAt = null;
      for (let i = 0; i < 60 * 6; i++) { g.step(1 / 60); if (jet.dropped && dropAt === null) dropAt = jet.x - 1200; }
      // гость видит самолёт с запаздыванием: серия уходит из точки, где он нажал
      const h = eval(arena); h.turn.weapon = 'airstrike'; h.fire(h.active(), { aim: 0, pw: 1, tx: 1500, ty: 590 });
      const hj = h.entities.find(e => e.k === 'jet'); for (let i = 0; i < 100; i++) h.step(1 / 60);
      const seen = hj.x - 90, want = bombImpact(h, seen, hj.y, 1).x; const hb = []; const hx = h.explode.bind(h); h.explode = (x, y, R, D, o) => { hb.push(x); return hx(x, y, R, D, o); };
      h.cmd(0, { c: 'fire', x: seen }); for (let i = 0; i < 60 * 4; i++) h.step(1 / 60);
      return { runs, failsafe: dropAt, lag: { want, got: hb.find(x => Math.abs(x - want) < 40) } };
    }, arena);
    for (const r of report.airstrike.runs) { assert.equal(r.n, 5, 'five bombs ' + JSON.stringify(r)); assert(r.err <= 8, 'middle bomb lands in the drop sight ' + JSON.stringify(r)); assert(r.offTarget <= 14 && r.drift >= 150 && r.drift <= 330 && r.spread <= 170, 'bombs keep the plane inertia ' + JSON.stringify(r)); }
    assert(report.airstrike.failsafe >= 1300, 'no automatic drop at the target ' + JSON.stringify(report.airstrike.failsafe));
    assert(Math.abs(report.airstrike.lag.got - report.airstrike.lag.want) <= 8, 'lag compensation ' + JSON.stringify(report.airstrike.lag));
    console.log('Airstrike: manual drop with plane inertia PASS', report.airstrike);

    // 3. Молния: камера держит удар в кадре
    await page.evaluate(() => { const g = App.game; g.turn.weapon = 'lightning'; g.teams[g.turn.team].ammo.lightning = 1; });
    report.lightning = await page.evaluate(async () => {
      const g = App.game, s = g.active(), enemy = g.soldiers.find(o => o.team !== s.team && o.alive);
      g.fire(s, { aim: 0, pw: 1, tx: enemy.x, ty: enemy.y });
      const frames = [];
      await new Promise(res => { const t0 = performance.now(); (function f() { const st = g.entities.find(e => e.k === 'storm'); const bolt = App.fx.bolts.length; const [x, y] = App.cam.toScreen(App.fx.focus ? App.fx.focus.x : (st ? st.x : 0), App.fx.focus ? App.fx.focus.y + 110 : (st ? st.v : 0), App.ren.sw, App.ren.sh); frames.push({ t: performance.now() - t0, storm: !!st, bolt, x, y, focus: !!App.fx.focus }); if (performance.now() - t0 < 3200) requestAnimationFrame(f); else res(); })(); });
      const strike = frames.filter(f => f.bolt > 0);
      return { strikes: strike.length, onScreen: strike.filter(f => f.x > 0 && f.x < App.ren.sw && f.y > 0 && f.y < App.ren.sh).length, focus: strike.some(f => f.focus) };
    });
    assert(report.lightning.strikes > 3 && report.lightning.onScreen === report.lightning.strikes && report.lightning.focus, 'lightning strike stays on screen ' + JSON.stringify(report.lightning));
    await page.screenshot({ path: 'test-results/lightning.png' });
    console.log('Lightning strike shown on screen PASS', report.lightning);

    // 6. Прокрутка обзора курсором у края: только с оружием, которому выбирают точку
    await page.evaluate(() => { const g = App.game; g.usage = null; g.entities.length = 0; g.turn.phase = 'aim'; g.turn.shots = 0; App.fx.focus = null; App.cam.free = 0; });
    await page.waitForFunction(() => App.game.turn.phase === 'aim');
    report.edge = await page.evaluate(async () => {
      const g = App.game, T = g.turn, wait = (ms) => new Promise(r => setTimeout(r, ms));
      const tm = g.teams[T.team]; tm.ammo.airstrike = 1; tm.ammo.bazooka = -1;
      const move = (x, y) => document.getElementById('game').dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
      const res = {};
      // к середине карты: там есть куда прокручивать
      const dir = App.cam.x < g.W / 2 ? 1 : -1, ex = dir > 0 ? 1439 : 0, back = dir > 0 ? 0 : 1439;
      T.weapon = 'bazooka'; move(720, 450); await wait(500); let x0 = App.cam.x; move(ex, 450); await wait(700); res.bazooka = App.cam.x - x0;
      move(720, 450); await wait(900);
      T.weapon = 'airstrike'; await wait(100); x0 = App.cam.x; move(ex, 450); await wait(700); res.forward = (App.cam.x - x0) * dir; res.hold = App.cam.hold;
      const xp = App.cam.x; move(720, 450); await wait(900); res.held = Math.abs(App.cam.x - xp) < 30; res.edgeFlag = App.cam.edge;
      move(back, 450); await wait(500); res.back = (App.cam.x - xp) * dir;
      document.getElementById('game').dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })); const xl = App.cam.x; await wait(400); res.leaveStops = Math.abs(App.cam.x - xl) < 1;
      T.weapon = 'bazooka'; await wait(800); res.release = !App.cam.hold;
      return res;
    });
    assert(Math.abs(report.edge.bazooka) < 40, 'no edge scrolling with ordinary weapons ' + JSON.stringify(report.edge));
    assert(report.edge.forward > 250 && report.edge.hold && report.edge.held && report.edge.back < -150 && report.edge.leaveStops && report.edge.release, 'edge scrolling for target weapons ' + JSON.stringify(report.edge));
    await page.screenshot({ path: 'test-results/edge-pan.png' });
    console.log('Edge scrolling for long-range target weapons PASS', report.edge);

    // 7. Авиаудар настоящим вводом: клавиша F сбрасывает в прицел; без нажатия — сброс, когда самолёт долетел до края экрана
    const strike = async (pressF) => {
      await page.waitForFunction(() => App.game.turn.phase === 'aim' && App.ctl.mine, {}, { timeout: 60000 });
      await page.waitForTimeout(400);
      return page.evaluate(async (pressF) => {
        const g = App.game, T = g.turn, s = g.active(), enemy = g.soldiers.filter(o => o.alive && o.team !== T.team).sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
        g.teams[T.team].ammo.airstrike = 1; T.weapon = 'airstrike';
        const sent = [], send = App.ctl.send; App.ctl.send = (c) => { if (c.c === 'fire' && isNum(c.x)) { const jet = g.entities.find(e => e.k === 'jet' && !e.dropped); sent.push({ x: c.x, sx: App.cam.toScreen(c.x, jet ? jet.y : 0, App.ren.sw, App.ren.sh)[0], pred: jet ? bombImpact(g, c.x, jet.y, jet.dir).x : null, dir: jet ? jet.dir : 0, z: App.cam.z }); } return send.call(App.ctl, c); };
        const booms = []; const ex = g.explode.bind(g); g.explode = (x, y, R, D, o) => { booms.push(x); return ex(x, y, R, D, o); };
        App.ctl.send({ c: 'fire', aim: s.aim, pw: 1, tx: Math.round(enemy.x), ty: Math.round(enemy.y - 10) });
        const tx = g.entities.filter(e => e.k === 'jet' && !e.dropped).pop().tx; let camDev = 0, pressed = false; const t0 = performance.now();
        await new Promise(res => { (function f() {
          const jet = g.entities.find(e => e.k === 'jet' && !e.dropped);
          if (jet && performance.now() - t0 > 900) camDev = Math.max(camDev, Math.abs(App.cam.x - tx));
          if (jet && pressF && !pressed) { const h = bombImpact(g, jet.x, jet.y, jet.dir); if (h && (jet.dir > 0 ? h.x >= enemy.x - 8 : h.x <= enemy.x + 8)) { pressed = true; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })); setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF' })), 80); } }
          if (performance.now() - t0 < 6500 && !(booms.length >= 5)) requestAnimationFrame(f); else res();
        })(); });
        App.ctl.send = send; g.explode = ex;
        const r = sent[0] || {}; const first = booms.reduce((b, x) => Math.abs(x - r.pred) < Math.abs(b - r.pred) ? x : b, Infinity);   // ближайший взрыв к расчётной точке — средняя бомба
        return { pressF, tx, enemy: Math.round(enemy.x), sent: sent.length, sx: r.sx, sw: App.ren.sw, nose: 42 * (r.z || 1), dir: r.dir, pred: r.pred, first, booms: booms.length, camDev, noSight: typeof App.ren.drawBombSight === 'undefined', all: booms.map(Math.round) };
      }, pressF);
    };
    report.manual = await strike(true);
    assert(report.manual.sent === 1 && report.manual.noSight && Math.abs(report.manual.first - report.manual.pred) <= 10 && Math.abs(report.manual.pred - report.manual.enemy) <= 40, 'F with lead drops onto the target ' + JSON.stringify(report.manual));
    report.auto = await strike(false);
    const A = report.auto, edge = A.dir > 0 ? A.sw - A.nose : A.nose;
    assert(A.sent === 1 && Math.abs(A.sx - edge) <= 24 && A.booms === 5 && A.camDev < 260, 'auto drop at the screen edge ' + JSON.stringify(A));
    console.log('Airstrike with real input: F drop, auto drop at the screen edge PASS', report.manual, report.auto);

    // 8. Версия 17: прицел у оружия, список атак по классам с описаниями, захват мыши в бою
    await page.waitForFunction(() => App.game.turn.phase === 'aim' && App.game.active() && App.game.active().alive, {}, { timeout: 60000 });
    report.v17 = await page.evaluate(() => {
      const cats = [...document.querySelectorAll('#ammo-grid .ammo-cat')].map(e => e.textContent);
      const rows = [...document.querySelectorAll('#ammo-grid .ammo-row')];
      const described = rows.filter(r => r.querySelector('.ammo-desc').textContent.length > 10).length;
      // прицел: рисуется для оружия с направлением, не рисуется для ударов с воздуха
      const T = App.game.turn, saved = T.weapon, cv = makeCanvas(400, 300), c = cv.getContext('2d');
      const calls = {}; const spy = (w) => { T.weapon = w; let n = 0; const arc = c.arc; c.arc = function () { n++; return arc.apply(this, arguments); }; App.ren.drawAimReticle(c, App.sc, App.cam, App.ctl, 1, 400, 300); c.arc = arc; return n; };
      for (const w of ['bazooka', 'grenade', 'shotgun', 'airstrike', 'medkit']) calls[w] = spy(w);
      T.weapon = saved;
      // захват указателя: внутренний курсор от относительных сдвигов, упирается в край поля
      const game = document.getElementById('game');
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => game });
      document.dispatchEvent(new Event('pointerlockchange'));
      Input.mouse.x = 300; Input.mouse.y = 300;
      game.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1, movementX: 25, movementY: -10, bubbles: true }));
      const moved = [Input.mouse.x, Input.mouse.y];
      for (let i = 0; i < 30; i++) game.dispatchEvent(new MouseEvent('mousemove', { movementX: -400, movementY: 900, bubbles: true }));
      const clamped = [Input.mouse.x, Input.mouse.y, game.clientHeight];
      delete document.pointerLockElement; Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => null });
      document.dispatchEvent(new Event('pointerlockchange'));
      return { cats, rows: rows.length, described, calls, moved, clamped, unlocked: !Input.locked };
    });
    const V = report.v17;
    assert.equal(V.cats.length, 6, 'six weapon classes'); assert.equal(V.rows, 41); assert(V.described >= 40, 'descriptions under weapons');
    assert(V.calls.bazooka > 4 && V.calls.grenade > 4 && V.calls.shotgun > 4 && V.calls.airstrike === 0 && V.calls.medkit === 0, 'reticle only for aimed weapons ' + JSON.stringify(V.calls));
    assert.deepEqual(V.moved, [325, 290]); assert(V.clamped[0] === 0 && V.clamped[1] === V.clamped[2] - 1 && V.unlocked, 'locked cursor stays inside ' + JSON.stringify(V));
    console.log('Version 17: weapon reticle, ammo by class with descriptions, pointer lock PASS', V);

    assert.deepEqual(errors, []);
    fs.writeFileSync('test-results/gameplay.json', JSON.stringify({ passed: true, ...report, date: new Date().toISOString() }, null, 2));
    console.log('Gameplay requests: all PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
