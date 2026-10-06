'use strict';
/* Личные настройки, конфигурации, «по умолчанию» с возвратом прежнего, временные настройки боя по сети, клавиши,
   одновременные ходы (непрерывный бой), ход на любую дистанцию, номера бойцов.
   При сервере: node -r ./dev/tools/pw-chromium.cjs tests/profile.cjs */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    // профиль сервера не трогаем: тест работает только с localStorage своего контекста
    await ctx.route('**/profile', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base); await page.waitForSelector('#s-main.show', { timeout: 120000 });

    // 1. первый запуск: значения по умолчанию — нынешние настройки игрока. Галочка «Использовать по умолчанию» всегда
    // открывается снятой: без неё правки только для этого боя; с ней — сохраняются сами; снята — вернулись прежние основные,
    // а настройки на экране (текущего боя) не меняются
    const first = await page.evaluate(() => ({ map: Profile.base.settings.mapId, time: Profile.base.settings.turnTime, hat: Profile.base.teams[0].hat, bot: Profile.base.bot.hat, keys: Keys.map.skip }));
    assert.deepEqual(first, { map: 'arctic', time: 0, hat: 'viking', bot: 'ushanka', keys: ['Backquote', 'KeyP'] }, 'factory = current user settings');
    await page.click('[data-act="cpu"]'); await page.waitForSelector('#s-setup.show');
    assert.equal(await page.isChecked('#cfg-default'), false, 'default checkbox starts unchecked');
    await page.selectOption('#o-perTeam', '6');
    await page.reload(); await page.waitForSelector('#s-main.show');
    assert.equal(await page.evaluate(() => Profile.base.settings.perTeam), 4, 'edits without the checkbox are not saved');
    await page.click('[data-act="cpu"]'); await page.waitForSelector('#s-setup.show');
    await page.check('#cfg-default'); await page.selectOption('#o-perTeam', '6'); await page.selectOption('#o-perTeam', '7');
    const chk = await page.evaluate(() => ({ base: Profile.base.settings.perTeam, linked: UI.linked }));
    await page.uncheck('#cfg-default');
    const unchk = await page.evaluate(() => ({ base: Profile.base.settings.perTeam, shown: UI.settings.perTeam, sel: document.getElementById('o-perTeam').value }));
    assert.deepEqual(chk, { base: 7, linked: true }, 'checked: every edit saved into the main set');
    assert.deepEqual(unchk, { base: 4, shown: 7, sel: '7' }, 'unchecked: main set restored, current battle settings unchanged');
    await page.check('#cfg-default'); await page.selectOption('#o-perTeam', '6');
    await page.reload(); await page.waitForSelector('#s-main.show');
    assert.equal(await page.evaluate(() => Profile.base.settings.perTeam), 6, 'checked edits survive a restart');
    await page.click('[data-act="cpu"]'); await page.waitForSelector('#s-setup.show');
    assert.equal(await page.isChecked('#cfg-default'), false, 'checkbox unchecked again on the next visit');
    await page.evaluate(() => UI.show('s-main'));

    // Снятие галочки после многократных правок разных видов оружия возвращает весь прежний
    // постоянный набор. Текущий бой остаётся с теми же выбранными настройками.
    const ammoUndo = await page.evaluate(() => {
      UI.act('cpu');
      const base = JSON.stringify(Profile.base);
      UI.setDefaultChecked(true);
      const setAmmo = (id, n) => {
        const num = document.querySelector('[data-w="' + id + '"] input[type="number"]');
        num.value = String(n); num.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setAmmo('sniper', 2); setAmmo('sniper', 7); setAmmo('bazooka', 3); setAmmo('grenade', 11);
      const current = JSON.stringify(UI.work);
      const saved = Profile.base.settings.ammo.sniper === 7 && Profile.base.settings.ammo.bazooka === 3 && Profile.base.settings.ammo.grenade === 11;
      UI.setDefaultChecked(false);
      const restored = JSON.stringify(Profile.base) === base;
      const unchanged = JSON.stringify(UI.work) === current;
      UI.show('s-main'); UI.act('cpu');
      const next = JSON.stringify(UI.work) === base, unchecked = !document.getElementById('cfg-default').checked;
      UI.show('s-main');
      return { saved, restored, unchanged, next, unchecked };
    });
    assert.deepEqual(ammoUndo, { saved: true, restored: true, unchanged: true, next: true, unchecked: true }, 'many edits on several weapons, uncheck, and start a new battle');

    // 2. конфигурации: создать из текущих, переключать, «по умолчанию» и возврат прежнего основного
    const cfg = await page.evaluate(async () => {
      UI.act('cpu');
      document.getElementById('o-perTeam').value = '3'; UI.onSettingsChanged();
      UI.act('cfg-new'); document.getElementById('cfg-name').value = 'Быстрый бой'; UI.act('cfg-name-ok');
      const id = UI.workSrc;
      const made = { id, name: Profile.config(id).name, per: Profile.config(id).data.settings.perTeam };
      // без галочки набор временный: поменять — основной не меняется
      document.getElementById('o-perTeam').value = '9'; UI.onSettingsChanged();
      const baseAfterTemp = Profile.base.settings.perTeam;
      // сделать по умолчанию → основной = 9; снять → вернулся прежний (6 из шага 1)
      UI.setDefaultChecked(true); const baseDefault = Profile.base.settings.perTeam;
      UI.setDefaultChecked(false); const baseRestored = Profile.base.settings.perTeam;
      // переключение на основной набор и обратно
      UI.selectConfig('base'); const perBase = UI.settings.perTeam;
      UI.selectConfig(id); const perCfg = UI.settings.perTeam;
      // выход в главное меню: прежний основной больше не восстанавливается
      UI.setDefaultChecked(true); UI.show('s-main'); const prevAfterMenu = Profile.prev;
      return { made, baseAfterTemp, baseDefault, baseRestored, perBase, perCfg, prevAfterMenu };
    });
    assert.equal(cfg.made.name, 'Быстрый бой'); assert.equal(cfg.made.per, 3);
    assert.equal(cfg.baseAfterTemp, 6, 'unlinked edits are temporary');
    assert.equal(cfg.baseDefault, 9, 'checked default makes the set main');
    assert.equal(cfg.baseRestored, 6, 'unchecking restores the previous main set');
    assert(cfg.perBase === 6 && cfg.perCfg === 3, 'switching configs ' + JSON.stringify(cfg));
    assert.equal(cfg.prevAfterMenu, null, 'previous main is forgotten after leaving to the main menu');

    // 3. сетевой бой: настройки хоста временные, у гостя свои не меняются
    const guest = await ctx.newPage(); guest.on('pageerror', (e) => errors.push(e.message));
    await page.evaluate(() => { UI.act('online'); UI.act('host'); });
    await page.waitForFunction(() => UI.cur === 's-setup' && UI.mode === 'host' && Net.code);
    const code = await page.evaluate(() => Net.code);
    await guest.goto(base); await guest.waitForSelector('#s-main.show');
    const guestBase = await guest.evaluate(() => Profile.base.settings.perTeam);
    await guest.evaluate((code) => { UI.act('online'); document.getElementById('join-code').value = code; UI.act('join'); }, code);
    await guest.waitForFunction(() => UI.mode === 'guest' && UI.cur === 's-setup');
    await page.waitForFunction(() => Net.connected);
    const hostBefore = await page.evaluate(() => Profile.base.settings.perTeam);
    await page.evaluate(() => { document.getElementById('o-perTeam').value = '2'; UI.onSettingsChanged(); });
    await guest.waitForFunction(() => UI.settings.perTeam === 2);
    const net = await page.evaluate(() => ({ hostBase: Profile.base.settings.perTeam, linked: UI.linked }));
    const gnet = await guest.evaluate(() => ({ base: Profile.base.settings.perTeam, shown: UI.settings.perTeam }));
    assert.equal(net.linked, false, 'lobby settings are temporary'); assert.equal(net.hostBase, hostBefore, 'host personal settings untouched');
    assert.deepEqual(gnet, { base: guestBase, shown: 2 }, 'guest sees host settings, own kept');
    await guest.evaluate(() => { UI.act('back'); UI.show('s-main'); });
    assert.equal(await guest.evaluate(() => Profile.base.settings.perTeam), guestBase, 'guest settings restored after the room');

    // 4. клавиши: назначение по физической клавише, сохраняются в наборе (в основной — с галочкой)
    const keys = await page.evaluate(() => {
      UI.act('back'); UI.show('s-main'); UI.act('cpu');
      UI.keyWait = { id: 'skip', i: -1 }; UI.assignKey('KeyK');
      const r = { map: UI.work.keys.skip.slice(), active: Keys.map.skip.slice(), base: Profile.base.keys.skip.slice() };
      UI.setDefaultChecked(true); r.saved = Profile.base.keys.skip.slice();
      return r;
    });
    assert(keys.map.includes('KeyK') && keys.active.includes('KeyK') && !keys.base.includes('KeyK') && keys.saved.includes('KeyK'), 'key rebinding ' + JSON.stringify(keys));

    // 5. одновременные ходы и ход на любую дистанцию: у каждой команды свой ход, следующий — тот же игрок
    const sim = await page.evaluate(() => {
      const S = sanitizeSettings({ ...Profile.base.settings, perTeam: 3, simul: true, walk: 'free', turnTime: 0 });
      const g = new Game({ mapId: 'valley', settings: S, teams: Profile.base.teams });
      for (let i = 0; i < 60 * 3; i++) g.step(1 / 60);
      const ph = g.lanes.map(l => l.turn.phase), sids = g.lanes.map(l => l.turn.sid);
      const names = g.soldiers.filter(s => s.team === 0).map(s => s.name);
      // ход команды 0 пропущен — её следующий боец начинает ход, ход команды 1 продолжается
      g.cmd(0, { c: 'skip' }); for (let i = 0; i < 60 * 2; i++) g.step(1 / 60);
      const after = g.lanes.map(l => ({ ph: l.turn.phase, sid: l.turn.sid }));
      // свободная дистанция: шаг далеко за обычный предел разрешён, в обычном режиме — нет
      const s = g.soldierById(g.lanes[1].turn.sid);
      const freeOk = g.inLane(1, () => walkOk(g, s, s.x + 2000));
      const g2 = new Game({ mapId: 'valley', settings: sanitizeSettings({ ...S, walk: 'limited', simul: false }), teams: Profile.base.teams });
      for (let i = 0; i < 60 * 3; i++) g2.step(1 / 60);
      const s2 = g2.active(), limOk = walkOk(g2, s2, s2.x + 2000);
      return { ph, sids, names, after, freeOk, limOk, free: g.freeWalk, snapTL: (g.snapshot().TL || []).length };
    });
    assert.deepEqual(sim.ph, ['aim', 'aim'], 'both teams move at once'); assert.notEqual(sim.sids[0], sim.sids[1]);
    assert.deepEqual(sim.names, ['1', '2', '3'], 'soldiers numbered 1..N');
    assert(sim.after[0].ph === 'aim' && sim.after[0].sid !== sim.sids[0] && sim.after[1].sid === sim.sids[1], 'next own soldier, other team continues ' + JSON.stringify(sim));
    assert(sim.free && sim.freeOk && !sim.limOk, 'free walk beyond the limit, limited otherwise ' + JSON.stringify(sim));
    assert.equal(sim.snapTL, 2, 'both turns in the network snapshot');
    // 6. непрерывный бой по сети: хост и гость ходят одновременно, каждый своей командой
    const h2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage(), g2 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    for (const p of [h2, g2]) { p.on('pageerror', (e) => errors.push(e.message)); await p.route('**/profile', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })); }
    await h2.goto(base); await h2.waitForSelector('#s-main.show');
    await h2.evaluate(() => { UI.act('online-simul'); UI.act('host'); });
    await h2.waitForFunction(() => UI.cur === 's-setup' && UI.mode === 'host' && Net.code);
    const code2 = await h2.evaluate(() => Net.code), simulSel = await h2.evaluate(() => document.getElementById('o-simul').value);
    await g2.goto(base + '/#join=' + code2); await g2.waitForFunction(() => UI.mode === 'guest' && UI.cur === 's-setup');
    await h2.waitForFunction(() => Net.connected);
    await h2.evaluate(() => { document.getElementById('o-perTeam').value = '2'; UI.onSettingsChanged(); UI.act('start'); });
    await h2.waitForFunction(() => App.game && App.game.simul && App.game.lanes.every(l => l.turn.phase === 'aim'), null, { timeout: 90000 });
    await g2.waitForFunction(() => App.remote && App.remote.simul && App.remote.turn.team === 1 && App.remote.turn.phase === 'aim', null, { timeout: 90000 });
    const sid1 = await h2.evaluate(() => App.game.lanes[1].turn.sid), sid0 = await h2.evaluate(() => App.game.lanes[0].turn.sid);
    await g2.evaluate(() => App.ctl.send({ c: 'skip' }));
    await h2.waitForFunction((s) => App.game.lanes[1].turn.sid !== s && App.game.lanes[1].turn.phase === 'aim', sid1, { timeout: 30000 });
    const on = await h2.evaluate(() => ({ l0: App.game.lanes[0].turn.sid, phase0: App.game.lanes[0].turn.phase, l1: App.game.lanes[1].turn.sid }));
    assert.equal(simulSel, '1', 'online continuous battle preset'); assert(on.l0 === sid0 && on.phase0 === 'aim' && on.l1 !== sid1, 'guest skip advances only the guest team ' + JSON.stringify(on));
    assert.deepEqual(errors, []);
    console.log('Profile, configs, default with restore, temporary room settings, keys, simultaneous turns, free walk, numbers PASS', { first, cfg, net, gnet, keys, sim });
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
