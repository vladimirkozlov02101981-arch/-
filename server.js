'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

function createServer() {
  const rooms = new Map(), root = __dirname;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.ogg': 'audio/ogg' };
  const server = http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end('{"ok":true,"transport":"relay"}'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    if (url === '/') url = '/index.html';
    if (url !== '/index.html' && !/^\/(js|css|assets)\/[\w./-]+$/.test(url)) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, '.' + url);
    if (!file.startsWith(root + path.sep) || !types[path.extname(file)]) { res.writeHead(404).end(); return; }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let sameOrigin = false;
    try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch { /* tests may omit Origin */ }
    if (req.url !== '/room' || (req.headers.origin && !sameOrigin) || wss.clients.size >= 400) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (ws, data) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 4 * 1024 * 1024) { ws.close(1013, 'Connection too slow'); return; }
    ws.send(JSON.stringify(data));
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
    ws.on('error', () => {}); ws.on('close', () => leave(ws));
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
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Территория войны: http://localhost:${port}`));
}
module.exports = { createServer };
