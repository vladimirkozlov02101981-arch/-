'use strict';
/* Игра с другом из файла: хост — в браузере с сервера, гость — открывает dist/Territory-War.html с диска
   и вставляет ссылку-приглашение. Картинки у гостя из файла, через сервер идут только ходы. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const base = process.env.TEST_URL || 'http://localhost:3000';
const file = pathToFileURL(path.join(__dirname, '..', 'dist', 'Territory-War.html')).href;
const hash = () => { let h = 2166136261; for (const v of App.sc.terrain.mask) h = Math.imul(h ^ v, 16777619); return h >>> 0; };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const guest = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    for (const p of [host, guest]) { p.setDefaultTimeout(90000); p.on('pageerror', e => errors.push(e.message)); }
    await host.goto(base); await host.waitForSelector('#s-main.show');
    await host.click('[data-act="online"]'); await host.click('[data-act="host"]'); await host.waitForSelector('#s-setup.show');
    const code = await host.locator('#room-code').textContent();
    const note = await host.locator('#setup-note').textContent();
    assert.match(note, new RegExp('#join=' + code), 'host sees an invite link');
    // гость: файл с диска, ссылка вставлена в поле «Ссылка от друга»
    const served = [];
    guest.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) served.push(r.url()); });
    await guest.goto(file); await guest.waitForSelector('#s-main.show');
    await guest.click('[data-act="online"]'); await guest.waitForSelector('#s-online.show');
    assert.equal(await guest.locator('#srv-box').isVisible(), true, 'link field is shown in the file version');
    await guest.fill('#srv-link', `${base}/#join=${code}`);
    await guest.click('[data-act="join"]');
    await guest.waitForFunction(() => UI.mode === 'guest' && UI.cur === 's-setup');
    await host.waitForFunction(() => UI.teamsCfg[1] && document.getElementById('peer-status').classList.contains('ok'));
    await host.click('#btn-start');
    await host.waitForFunction(() => App.mode === 'host' && App.game?.turn.phase === 'aim');
    await guest.waitForFunction(() => App.mode === 'guest' && App.remote?.turn.phase === 'aim');
    await host.waitForTimeout(800);
    assert.equal(await host.evaluate(hash), await guest.evaluate(hash), 'same terrain');
    await host.evaluate(() => { App.ctl.aimMode = 'keys'; App.ctl.send({ c: 'fire', aim: Math.PI / 2, pw: 0.22 }); });
    await host.waitForFunction(() => App.game.turn.team === 1 && App.game.turn.phase === 'aim', {}, { timeout: 60000 });
    await guest.waitForFunction(() => App.remote.turn.team === 1 && App.remote.turn.phase === 'aim', {}, { timeout: 60000 });
    assert.equal(await host.evaluate(hash), await guest.evaluate(hash), 'same crater');
    // ход гостя по сети
    await guest.evaluate(() => { App.ctl.aimMode = 'keys'; App.ctl.send({ c: 'fire', aim: Math.PI / 2, pw: 0.22 }); });
    await host.waitForFunction(() => App.game.turn.team === 0 && App.game.turn.phase === 'aim', {}, { timeout: 60000 });
    const remembered = await guest.evaluate(() => localStorage.getItem('tw_server'));
    assert.equal(remembered, new URL(base).origin, 'server remembered in the file version');
    assert(served.every(u => u.startsWith(base.replace(/\/$/, '')) === false || /\/room$/.test(u) || u.endsWith('/public')), 'guest loads no game files from the server: ' + served.join(', '));
    assert.deepEqual(errors, []);
    console.log('Game file + invite link: lobby, battle, shots of both players over the relay PASS', { code, served: served.length });
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
