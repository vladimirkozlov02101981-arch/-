'use strict';
/* Версия 37: «Арсенал» — классы отдельными блоками без прокрутки; при захваченной мыши свой курсор панели: появляется в её
   центре, не выходит за края, подсвечивает оружие, клик выбирает его и не стреляет, игровой прицел не сдвигается */
const { chromium } = require('playwright'), fs = require('node:fs'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true }), out = { errors: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/profile', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage(); page.setDefaultTimeout(120000); page.on('pageerror', e => out.errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:3001'); await page.waitForSelector('#s-main.show');
    await page.evaluate(() => App.startLocal({ mapId: 'valley', settings: sanitizeSettings({ ...Profile.base.settings, perTeam: 2, turnTime: 0 }), teams: Profile.base.teams }, 'hotseat'));
    await page.waitForFunction(() => App.sc && App.sc.turn && App.sc.turn.phase === 'aim' && App.ctl && App.ctl.mine);
    await page.evaluate(() => { for (const t of App.sc.teams) for (const w of WEAPONS) t.ammo[w.id] = -1; App.ctl.select('bazooka'); });
    await page.waitForTimeout(800);
    out.r = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms)), cv = App.cv, move = (dx, dy) => cv.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy, bubbles: true }));
      Input.locked = true; const game0 = { x: Input.mouse.x, y: Input.mouse.y };
      UI.setTray(true); for (let i = 0; i < 40 && document.querySelectorAll('.tray-group').length < 6; i++) await wait(50); await wait(150);
      const te = document.getElementById('tray'), t = { left: te.offsetLeft, top: te.offsetTop, right: te.offsetLeft + te.offsetWidth, bottom: te.offsetTop + te.offsetHeight }, cur = document.getElementById('tray-cursor');
      const r = { groups: document.querySelectorAll('.tray-group').length, scroll: document.getElementById('tray').scrollHeight > document.getElementById('tray').clientHeight + 1,
        start: { ...Input.boxCur }, center: { x: (t.left + t.right) / 2, y: (t.top + t.bottom) / 2 }, cursorShown: !cur.classList.contains('hidden') };
      move(5000, -5000); await wait(50); r.corner = { ...Input.boxCur }; r.rect = { l: t.left, t: t.top, r: t.right, b: t.bottom };
      // к «Узи»
      const it = document.querySelector('.tray-item[data-weapon="uzi"]').getBoundingClientRect(), tx = (it.left + it.right) / 2, ty = (it.top + it.bottom) / 2;
      move(tx - Input.boxCur.x, ty - Input.boxCur.y); await wait(50);
      r.hover = !!document.querySelector('.tray-item.hover[data-weapon="uzi"]'); r.info = document.getElementById('tray-info').textContent.slice(0, 20);
      const shots = App.sc.turn.shots;
      cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })); await wait(300);
      r.weapon = App.sc.turn.weapon; r.closed = !UI.trayOpen; r.fired = App.sc.turn.shots !== shots || App.sc.turn.phase !== 'aim'; r.game = { x: Input.mouse.x, y: Input.mouse.y }; r.game0 = game0;
      r.cursorHidden = cur.classList.contains('hidden'); Input.locked = false;
      return r;
    });
    const r = out.r;
    assert(r.groups === 6 && !r.scroll, 'six class blocks without scrolling ' + JSON.stringify(r));
    assert(r.cursorShown && Math.abs(r.start.x - r.center.x) < 1 && Math.abs(r.start.y - r.center.y) < 1, 'cursor starts at the tray center ' + JSON.stringify(r));
    assert(r.corner.x <= r.rect.r && r.corner.x >= r.rect.r - 6 && r.corner.y >= r.rect.t && r.corner.y <= r.rect.t + 6, 'cursor stays inside the tray ' + JSON.stringify(r));
    assert(r.hover && /Узи/.test(r.info), 'hover under the tray cursor ' + JSON.stringify(r));
    assert(r.weapon === 'uzi' && r.closed && !r.fired && r.cursorHidden, 'click picks the weapon without firing ' + JSON.stringify(r));
    assert(r.game.x === r.game0.x && r.game.y === r.game0.y, 'game cursor untouched while the tray is open ' + JSON.stringify(r));
    assert.deepEqual(out.errors, []); out.pass = true;
  } finally {
    await browser.close(); fs.mkdirSync('test-results/tray37', { recursive: true }); fs.writeFileSync('test-results/tray37/report.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
