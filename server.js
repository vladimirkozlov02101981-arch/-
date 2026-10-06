'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');


/** Bound the relay's own transport queue; never drop ordered world events. */
function createRelayQueue(ws, options = {}) {
  const maxBytes = options.maxBytes || 8 * 1024 * 1024, highWater = options.highWater || 64 * 1024;
  const now = options.now || Date.now, timeout = options.timeout || 30000;
  let fifo = [], priority = [], state = null, busy = false, busyAt = null, closed = false, queuedBytes = 0, waitingAt = null;
  const encode = data => ({ data, text: JSON.stringify(data), at: now() });
  const slow = () => { if (!closed) { dispose(); ws.close(1013, 'Connection too slow'); } };
  function dispose() { closed = true; clearInterval(timer); fifo = []; priority = []; state = null; queuedBytes = 0; }
  function stats() { return { reliable: fifo.length, priority: priority.length, latestState: !!state, queuedBytes, busy, buffered: ws.bufferedAmount || 0 }; }
  function flush() {
    if (closed || ws.readyState !== WebSocket.OPEN) return;
    if (busy) { if (now() - busyAt > timeout) slow(); return; }
    if ((ws.bufferedAmount || 0) > highWater) { if (waitingAt === null) waitingAt = now(); if (now() - waitingAt > timeout) slow(); return; }
    waitingAt = null;
    const entry = priority.shift() || fifo.shift() || state;
    if (!entry) return;
    if (entry === state) state = null;
    queuedBytes -= Buffer.byteLength(entry.text); busy = true; busyAt = now();
    try { ws.send(entry.text, err => { busy = false; busyAt = null; if (err) { slow(); return; } flush(); }); }
    catch { busy = false; slow(); }
  }
  function push(data) {
    if (closed || ws.readyState !== WebSocket.OPEN) return false;
    const d = data && data.type === 'data' && data.data;
    let entry;
    if (d && d.t === 's') {
      const old = state && state.data.data;
      const latest = { ...d, V: (old && old.V || []).concat(d.V || []) };
      if (!d.TM && old && old.TM) latest.TM = old.TM;
      if (state) queuedBytes -= Buffer.byteLength(state.text);
      state = entry = encode({ ...data, data: latest }); queuedBytes += Buffer.byteLength(entry.text);
    } else {
      // A new lobby/start is a boundary: a queued old state belongs to the old game.
      if (d && (d.t === 'lobby' || d.t === 'start' || d.t === 'net' && d.items && d.items.some(i => i && (i.t === 'lobby' || i.t === 'start')))) {
        if (state) queuedBytes -= Buffer.byteLength(state.text); state = null;
      }
      entry = encode(data);
      const urgent = d && ['ping', 'pong', 'net-ack'].includes(d.t);
      const tail = fifo[fifo.length - 1], previous = tail && tail.data.data;
      if (!urgent && d && d.t === 'c' && d.c && d.c.c === 'ctrl' && previous && previous.t === 'c' && previous.c && previous.c.c === 'ctrl') {
        queuedBytes -= Buffer.byteLength(tail.text); fifo[fifo.length - 1] = entry;
      } else (urgent ? priority : fifo).push(entry);
      queuedBytes += Buffer.byteLength(entry.text);
    }
    if (queuedBytes > maxBytes || fifo.length > 512 || priority.length > 64) { slow(); return false; }
    flush(); return true;
  }
  const timer = setInterval(flush, 25); timer.unref();
  return { push, flush, dispose, stats };
}

function createServer(options = {}) {
  const rooms = new Map(), root = options.root || __dirname;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.ogg': 'audio/ogg' };
  const server = http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    // файл игры на этом же ПК (адрес file://) спрашивает свой сервер и ссылку туннеля — разрешаем ему эти два ответа
    if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end('{"ok":true,"transport":"relay","project":"territory-war-copy1"}'); return; }
    // публичный адрес туннеля «Играть онлайн.cmd» (бесплатный адрес иногда меняется — берём последний) — для приглашения другу
    if (url === '/public') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify({ url: publicUrl() })); return; }
    // личные настройки игрока этого ПК (profile.json рядом с игрой): только с самого ПК — не через туннель для друга
    if (url === '/profile') {
      const host = String(req.headers.host || ''), local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) && !req.headers['x-forwarded-for'];
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Private-Network': 'true', 'Cache-Control': 'no-store' };
      if (!local) { res.writeHead(403, cors).end(); return; }
      if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
      const file = path.join(root, 'profile.json');
      if (req.method === 'GET') { fs.readFile(file, (e, b) => res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)).end(e ? '{}' : b)); return; }
      if (req.method === 'POST') {
        let body = ''; req.setEncoding('utf8');
        req.on('data', (c) => { body += c; if (body.length > 600000) req.destroy(); });
        req.on('end', () => {
          let d; try { d = JSON.parse(body); } catch { d = null; }
          if (!d || typeof d !== 'object' || !d.base) { res.writeHead(400, cors).end(); return; }
          fs.writeFile(file + '.tmp', JSON.stringify(d), (e) => { if (e) { res.writeHead(500, cors).end(); return; } fs.rename(file + '.tmp', file, () => res.writeHead(204, cors).end()); });
        });
        return;
      }
      res.writeHead(405, cors).end(); return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (url === '/') url = '/index.html';
    if (url !== '/index.html' && !/^\/(js|css|assets)\/[\w./-]+$/.test(url)) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, '.' + url);
    if (!file.startsWith(root + path.sep) || !types[path.extname(file)]) { res.writeHead(404).end(); return; }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404).end(); return; }
      // no-cache + ETag: браузер каждый раз сверяется с сервером, но неизменённый файл не скачивает заново (304) —
      // через туннель для игры с другом повторные загрузки идут мгновенно, а обновления видны сразу
      const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
      const head = { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-cache', ETag: etag, 'Last-Modified': stat.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, head).end(); return; }
      res.writeHead(200, Object.assign(head, { 'Content-Length': stat.size }));
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    });
  });
  const publicUrl = () => {
    try {
      const pid = +fs.readFileSync(path.join(root, 'dev', 'tunnel.pid'), 'utf8').trim(); process.kill(pid, 0);   // туннель ещё работает
      const found = fs.readFileSync(path.join(root, 'dev', 'tunnel-ssh-out.txt'), 'latin1').match(/https:\/\/[a-z0-9]+\.lhr\.life/g);
      return found ? found[found.length - 1] : null;
    } catch { return null; }
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let sameOrigin = false;
    try { sameOrigin = req.headers.origin === 'null' || new URL(req.headers.origin).host === req.headers.host; } catch { /* tests may omit Origin */ }   // 'null' — файл игры, открытый с диска
    if (req.url !== '/room' || (req.headers.origin && !sameOrigin) || wss.clients.size >= 400) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const queues = new WeakMap();
  const send = (ws, data) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let q = queues.get(ws); if (!q) { q = createRelayQueue(ws); queues.set(ws, q); }
    q.push(data);
  };
  const leave = ws => {
    const room = rooms.get(ws.code); ws.code = null;
    if (!room) return;
    if (room.host === ws) { rooms.delete(room.code); if (room.guest) { room.guest.code = null; send(room.guest, { type: 'left' }); } }
    else if (room.guest === ws) { room.guest = null; send(room.host, { type: 'left' }); }
  };
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = () => Array.from(crypto.randomBytes(5), b => alphabet[b % alphabet.length]).join('');
  wss.on('connection', ws => {
    ws.alive = true; ws.bucket = 0; ws.bucketAt = Date.now();
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {}); ws.on('close', () => { const q = queues.get(ws); if (q) q.dispose(); leave(ws); });
    ws.on('message', raw => {
      if (Date.now() - ws.bucketAt > 1000) { ws.bucketAt = Date.now(); ws.bucket = 0; }
      if (++ws.bucket > 180) { ws.close(1008, 'Rate limit'); return; }
      let m; try { m = JSON.parse(raw); } catch { ws.close(1007, 'Invalid JSON'); return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'create') {
        if (ws.code) return;
        if (rooms.size >= 200) { send(ws, { type: 'error', code: 'busy' }); return; }
        let id; do { id = code(); } while (rooms.has(id));
        rooms.set(id, { code: id, host: ws, guest: null }); ws.code = id;
        send(ws, { type: 'created', code: id });
      } else if (m.type === 'join') {
        if (ws.code) return;
        const room = rooms.get(String(m.code || '').toUpperCase());
        if (!room) { send(ws, { type: 'error', code: 'peer-unavailable' }); return; }
        if (room.guest) { send(ws, { type: 'error', code: 'full' }); return; }
        room.guest = ws; ws.code = room.code;
        send(room.host, { type: 'connected' }); send(ws, { type: 'connected' });
      } else if (m.type === 'relay') {
        const room = rooms.get(ws.code);
        if (!room || !m.data || typeof m.data !== 'object') return;
        send(room.host === ws ? room.guest : room.host, { type: 'data', data: m.data });
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  }, 15000);
  heartbeat.unref();
  server.on('close', () => { clearInterval(heartbeat); wss.close(); });
  return { server, wss, rooms };
}
if (require.main === module) {
  const { server } = createServer();
  const port = Number(process.env.PORT) || 3001;
  server.listen(port, '0.0.0.0', () => console.log(`Территория войны: http://localhost:${port}`));
}
module.exports = { createServer, createRelayQueue };
