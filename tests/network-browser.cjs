'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const base = process.env.TEST_URL || 'http://127.0.0.1:3001';
const output = process.env.NETWORK_RESULTS || path.resolve(__dirname, '../test-results/network');
const replacementNet = process.env.NETWORK_NET;
const hash = () => { let h = 2166136261; for (const v of App.sc.terrain.mask) h = Math.imul(h ^ v, 16777619); return h >>> 0; };
const transport = () => ({ role: Net.role, linked: !!Net.connected, rtt: Net.rtt, status: Net.rttStatus, pending: Net.outbox.length, priority: Net.priority.length, state: !!Net.stateFlight, reliable: !!Net.reliableFlight, buffered: Net.socket?.bufferedAmount || 0, delayed: window.networkDelay?.pending || 0 });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], report = { passed: false, url: base, replacementNet: replacementNet || null, steps: [], errors, date: new Date().toISOString() };
  let host, guest;
  const newPage = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    if (replacementNet) await context.route('**/js/net.js', route => route.fulfill({ path: replacementNet, contentType: 'application/javascript' }));
    const page = await context.newPage(); page.setDefaultTimeout(60000); page.on('pageerror', e => errors.push(e.message));
    return page;
  };
  try {
    host = await newPage(); guest = await newPage();
    await host.goto(base); await host.waitForSelector('#s-main.show');
    await host.click('[data-act="online"]'); await host.click('[data-act="host"]'); await host.waitForSelector('#s-setup.show');
    const code = (await host.locator('#room-code').textContent()).trim();
    await guest.goto(base + '/#join=' + code); await guest.waitForFunction(() => UI.mode === 'guest' && UI.cur === 's-setup');
    await host.waitForFunction(() => !!App.guestTeam && Net.connected);
    // Use the actual lobby/start flow. Both teams can issue commands in this mode.
    await host.evaluate(() => { Object.assign(UI.settings, { mapId: 'valley', perTeam: 2, hp: 200, turnTime: 0, wind: false, walk: 'free', simul: true }); UI.applySettings(UI.settings); UI.markMap(); App.onLobbyChanged(); });
    await guest.waitForFunction(() => UI.settings.simul && UI.settings.perTeam === 2 && UI.settings.mapId === 'valley');
    await host.click('#btn-start');
    await host.waitForFunction(() => App.mode === 'host' && App.game?.simul && App.game.lanes.every(l => l.turn.phase === 'aim'));
    await guest.waitForFunction(() => App.mode === 'guest' && App.remote?.simul && App.remote.latestTurn?.phase === 'aim');
    await host.waitForFunction(() => Net.rttStatus === 'ok'); await guest.waitForFunction(() => Net.rttStatus === 'ok');
    const initial = await host.evaluate(hash); assert.equal(initial, await guest.evaluate(hash));
    report.steps.push({ name: 'start and baseline RTT', initial, host: await host.evaluate(transport), guest: await guest.evaluate(transport) });
    console.log('Baseline battle and RTT PASS');
    for (const page of [host, guest]) await page.evaluate(() => {
      window.networkSeen = []; const receive = Net.h.data;
      Net.on('data', d => { window.networkSeen.push({ t: d.t, c: d.c && { ...d.c }, txt: d.txt, V: d.V && d.V.map(e => ({ ...e })), payload: d.t === 'network-mask-check' ? d.payload : undefined }); receive(d); });
    });
    await host.evaluate(() => { window.networkCommands = []; const cmd = App.game.cmd.bind(App.game); App.game.cmd = (team, c) => { if (team === 1) window.networkCommands.push({ ...c }); return cmd(team, c); }; });
    // Delay peer processing, including ACKs. WebSocket.bufferedAmount stays zero,
    // reproducing a hidden proxy/SSH queue that bufferedAmount alone cannot detect.
    await guest.evaluate(() => {
      const receive = Net.receive.bind(Net); window.networkDelay = { receive, pending: 0, maximum: 0, ms: 600 };
      Net.receive = d => { const q = window.networkDelay; q.pending++; q.maximum = Math.max(q.maximum, q.pending); setTimeout(() => { q.pending--; const current = Net.receive; Net.receive = receive; try { receive(d); } finally { Net.receive = current; } }, q.ms); };
      App.ctl.myTeams = []; // The test sends explicit intent; stop automatic mouse updates.
    });
    await host.evaluate(() => {
      const g = App.game;
      for (let i = 0; i < 35; i++) g.carve(2500 + i * 13, 1450, 9, false);
      g.carveLine(3000, 1450, 3080, 1470, 7);
      g.terrain.addGirder(3200, 500, 2); g.emit({ t: 'girder', x: 3200, y: 500, a: 2 });
      g.teams[0].ammo.grenade = 37; g.teamsDirty = true;
      Net.sendBig({ t: 'network-mask-check', payload: '01'.repeat(125000) });
      Net.send({ t: 'chat', txt: 'Проверка очереди: разрушения, балка и чат' });
    });
    const expected = await host.evaluate(hash);
    await guest.waitForFunction(expectedHash => { let h = 2166136261; for (const v of App.sc.terrain.mask) h = Math.imul(h ^ v, 16777619); return (h >>> 0) === expectedHash; }, expected);
    await guest.waitForFunction(() => window.networkSeen.some(d => d.t === 'network-mask-check') && App.remote.teams[0].ammo.grenade === 37);
    const received = await guest.evaluate(() => ({ mask: window.networkSeen.find(d => d.t === 'network-mask-check').payload, chat: window.networkSeen.some(d => d.t === 'chat' && d.txt.includes('Проверка очереди')), events: window.networkSeen.flatMap(d => d.V || []).filter(e => ['carve', 'cline', 'girder'].includes(e.t)).map(e => e.t) }));
    assert.equal(received.mask, '01'.repeat(125000)); assert.equal(received.chat, true);
    assert.deepEqual(received.events, [...Array(35).fill('carve'), 'cline', 'girder']);
    report.steps.push({ name: 'delayed world events, TM, chunked payload and chat', initial, expected, receivedEvents: received.events.length });
    console.log('Delayed terrain/events/TM/chunks/chat PASS');
    const queued = await guest.evaluate(() => {
      Net.send({ t: 'c', c: { c: 'ctrl', l: true, aim: 0, pw: -1 } });
      for (let i = 0; i < 2000; i++) Net.send({ t: 'c', c: { c: 'ctrl', l: true, aim: i / 2000, pw: -1 } });
      Net.send({ t: 'c', c: { c: 'ctrl', l: false, r: false, u: false, d: false, pw: -1 } });
      Net.send({ t: 'c', c: { c: 'weapon', id: 'grenade' } });
      Net.send({ t: 'c', c: { c: 'ctrl', l: false, aim: -Math.PI / 2, pw: .1 } });
      Net.send({ t: 'c', c: { c: 'fire', aim: -Math.PI / 2, pw: .1 } });
      Net.send({ t: 'c', c: { c: 'soldier', number: 2 } }); Net.send({ t: 'c', c: { c: 'jump' } }); Net.send({ t: 'c', c: { c: 'holster' } });
      return { pending: Net.outbox.length, buffered: Net.socket.bufferedAmount };
    });
    assert.ok(queued.pending <= 8, JSON.stringify(queued));
    await host.waitForFunction(() => window.networkCommands.some(c => c.c === 'holster'));
    const commands = await host.evaluate(() => window.networkCommands);
    const discrete = commands.filter(c => c.c !== 'ctrl').map(c => c.c);
    assert.deepEqual(discrete, ['weapon', 'fire', 'soldier', 'jump', 'holster']);
    assert.ok(commands.some((c, i) => c.c === 'weapon' && commands.slice(0, i).some(p => p.c === 'ctrl' && p.l === false)), 'Release must arrive before weapon/fire');
    await host.waitForFunction(() => !App.game.lanes[1].ctrl?.l && !App.game.lanes[1].ctrl?.r);
    const samples = [];
    for (let i = 0; i < 5; i++) { await sleep(700); samples.push({ host: await host.evaluate(transport), guest: await guest.evaluate(transport) }); }
    for (const sample of samples) for (const role of ['host', 'guest']) { const v = sample[role]; assert.ok(v.pending <= 8 && v.priority <= 4 && v.delayed <= 12, JSON.stringify(sample)); assert.equal(v.status, 'ok'); assert.ok(v.rtt >= 450 && v.rtt < 5000, JSON.stringify(sample)); }
    report.steps.push({ name: 'slow controls keep release and action order, real RTT includes delay', queued, discrete, samples });
    await host.screenshot({ path: path.join(output, 'delayed-host.png') }); await guest.screenshot({ path: path.join(output, 'delayed-guest.png') });
    console.log('Delayed controls and honest RTT PASS');
    // Restore normal processing. RTT should recover by a fresh matching nonce.
    await guest.evaluate(() => { Net.receive = window.networkDelay.receive; });
    await host.waitForFunction(() => Net.rttStatus === 'ok' && Net.rtt < 450);
    await guest.waitForFunction(() => Net.rttStatus === 'ok' && Net.rtt < 450);
    await guest.evaluate(() => { App.ctl.suspended = false; App.ctl.suspend(); Net.send({ t: 'rematch' }); });
    await host.waitForFunction(() => document.getElementById('over-note').textContent.includes('реванш'));
    await host.evaluate(() => App.rematch()); await host.waitForFunction(() => UI.mode === 'host' && UI.cur === 's-setup'); await guest.waitForFunction(() => UI.mode === 'guest' && UI.cur === 's-setup');
    assert.equal(await host.evaluate(() => UI.settings.simul), true);
    const oldEpoch = await host.evaluate(() => Net.epoch);
    await guest.context().close(); await host.waitForFunction(() => !Net.connected && App.guestTeam === null);
    assert.equal(await host.evaluate(() => Net.code), code);
    guest = await newPage(); await guest.goto(base + '/#join=' + code);
    await guest.waitForFunction(() => UI.mode === 'guest' && UI.cur === 's-setup'); await host.waitForFunction(() => !!App.guestTeam && Net.connected);
    assert.notEqual(await host.evaluate(() => Net.epoch), oldEpoch);
    await guest.evaluate(() => App.sendChat('Новый гость подключился'));
    await host.waitForFunction(() => window.networkSeen.some(d => d.t === 'chat' && d.txt === 'Новый гость подключился'));
    await guest.waitForFunction(() => Net.rttStatus === 'ok'); await host.waitForFunction(() => Net.rttStatus === 'ok');
    report.steps.push({ name: 'rematch and replacement guest in retained host room', code, host: await host.evaluate(transport), guest: await guest.evaluate(transport) });
    assert.deepEqual(errors, []); await host.screenshot({ path: path.join(output, 'host.png') }); await guest.screenshot({ path: path.join(output, 'guest.png') });
    report.passed = true; console.log('Network browser QA PASS:', JSON.stringify(report.steps.map(s => s.name)));
  } catch (e) { report.failure = e.stack; if (host && !host.isClosed()) await host.screenshot({ path: path.join(output, 'failure-host.png') }).catch(() => {}); throw e; }
  finally { fs.writeFileSync(path.join(output, 'qa.json'), JSON.stringify(report, null, 2)); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
