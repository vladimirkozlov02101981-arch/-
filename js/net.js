'use strict';
/* Same-origin WebSocket relay. The host owns the simulation. */
const NET_VERSION = 4;
const Net = {
  socket: null, role: null, code: null, h: {}, pingT: null, rtt: 0,
  lastData: 0, chunks: new Map(), joinTimer: null, linked: false,
  available() { return typeof WebSocket === 'function' && /^https?:$/.test(location.protocol); },
  on(ev, fn) { this.h[ev] = fn; },
  emit(ev, ...args) { try { if (this.h[ev]) this.h[ev](...args); } catch (e) { console.error(e); } },
  host() { this.connect('host'); },
  join(code) { this.connect('guest', String(code).trim().toUpperCase()); },
  connect(role, code) {
    this.close(); this.role = role; this.code = code || null;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/room`);
    this.socket = ws;
    this.joinTimer = setTimeout(() => { if (this.socket === ws && !this.linked && !(role === 'host' && this.code)) { this.emit('error', { type: 'timeout' }); this.close(); } }, 15000);
    ws.onopen = () => { if (this.socket === ws) ws.send(JSON.stringify(role === 'host' ? { type: 'create' } : { type: 'join', code })); };
    ws.onmessage = event => {
      if (this.socket !== ws) return;
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'created') { clearTimeout(this.joinTimer); this.code = m.code; this.emit('hosting', m.code); }
      if (m.type === 'connected') { clearTimeout(this.joinTimer); this.linked = true; this.lastData = performance.now(); this.emit('connected'); this.startPing(); }
      if (m.type === 'left') { this.linked = false; this.stopPing(); this.emit('closed'); }
      if (m.type === 'error') { clearTimeout(this.joinTimer); this.emit('error', { type: m.code }); }
      if (m.type === 'data') this.receive(m.data);
    };
    ws.onerror = () => { if (this.socket === ws) this.emit('error', { type: 'network' }); };
    ws.onclose = () => { if (this.socket === ws) { const linked = this.linked; this.socket = null; this.linked = false; this.stopPing(); clearTimeout(this.joinTimer); this.emit(linked ? 'closed' : 'error', { type: 'network' }); } };
  },
  receive(d) {
    if (!d || typeof d !== 'object') return;
    this.lastData = performance.now();
    if (d.t === 'ping') { this.send({ t: 'pong', ts: d.ts }); return; }
    if (d.t === 'pong') { if (isNum(d.ts)) this.rtt = Math.max(0, Math.round(performance.now() - d.ts)); return; }
    if (d.t === 'chunk') { this.onChunk(d); return; }
    this.emit('data', d);
  },
  send(data) { if (this.connected) this.socket.send(JSON.stringify({ type: 'relay', data })); },
  sendBig(data) {
    const s = JSON.stringify(data); if (s.length < 50000) { this.send(data); return; }
    const id = Math.random().toString(36).slice(2), n = Math.ceil(s.length / 50000);
    for (let i = 0; i < n; i++) this.send({ t: 'chunk', id, i, n, d: s.slice(i * 50000, (i + 1) * 50000) });
  },
  onChunk(d) {
    const now = performance.now();
    for (const [id, entry] of this.chunks) if (now - entry.at > 15000) this.chunks.delete(id);
    if (typeof d.id !== 'string' || d.id.length > 40 || !Number.isInteger(d.i) || !Number.isInteger(d.n) || d.n < 1 || d.n > 100 || d.i < 0 || d.i >= d.n || typeof d.d !== 'string' || d.d.length > 50000) return;
    let e = this.chunks.get(d.id);
    if (!e) { if (this.chunks.size >= 4) return; e = { n: d.n, parts: [], got: 0, at: now }; this.chunks.set(d.id, e); }
    if (e.n !== d.n) return;
    if (e.parts[d.i] === undefined) { e.parts[d.i] = d.d; e.got++; }
    if (e.got === e.n) { this.chunks.delete(d.id); try { this.receive(JSON.parse(e.parts.join(''))); } catch {} }
  },
  startPing() { this.stopPing(); this.pingT = setInterval(() => { this.send({ t: 'ping', ts: performance.now() }); if (performance.now() - this.lastData > 12000) this.emit('stall'); }, 2000); },
  stopPing() { clearInterval(this.pingT); this.pingT = null; },
  close() { this.stopPing(); clearTimeout(this.joinTimer); const ws = this.socket; this.socket = null; this.linked = false; this.role = null; this.code = null; this.chunks.clear(); if (ws) ws.close(); },
  get connected() { return this.linked && this.socket && this.socket.readyState === WebSocket.OPEN; },
  errorText(e) {
    const messages = {
      'peer-unavailable': 'Комната не найдена. Проверьте код: возможно, друг уже вышел.',
      full: 'В этой комнате уже играют двое. Создайте новую комнату.',
      busy: 'Сервер занят. Попробуйте подключиться чуть позже.',
      timeout: 'Время подключения истекло. Проверьте интернет и повторите попытку.',
      network: 'Нет связи с игровым сервером. Откройте игру через запущенный сервер или общую ссылку.'
    };
    return messages[e && e.type] || 'Соединение прервалось. Попробуйте ещё раз.';
  }
};
