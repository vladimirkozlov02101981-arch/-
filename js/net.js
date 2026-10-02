'use strict';
/* WebSocket relay. The host owns the simulation.
   Страница с сервера соединяется со своим сервером; файл игры (Territory-War.html) — с сервером из ссылки-приглашения:
   картинки грузятся из файла мгновенно, а через интернет идут только ходы. */
const NET_VERSION = 7;
const Net = {
  socket: null, role: null, code: null, h: {}, pingT: null, rtt: 0,
  lastData: 0, chunks: new Map(), joinTimer: null, linked: false, server: null, publicBase: null,
  /** страница открыта с сервера или это файл игры (сервер берётся из ссылки) */
  available() { return typeof WebSocket === 'function' && (/^https?:$/.test(location.protocol) || location.protocol === 'file:'); },
  fromFile() { return location.protocol === 'file:'; },
  serverBase() {
    if (/^https?:$/.test(location.protocol)) return location.origin;
    if (this.server) return this.server;
    try { return localStorage.getItem('tw_server') || null; } catch { return null; }
  },
  /** ссылка-приглашение (https://….lhr.life/#join=КОД) или адрес сервера: запоминает сервер, возвращает код комнаты ('' — кода нет, null — не ссылка) */
  useLink(text) {
    let u; try { u = new URL(String(text || '').trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    this.server = u.origin; try { localStorage.setItem('tw_server', u.origin); } catch { /* без запоминания */ }
    const m = /#join=([A-Za-z0-9]{5})/.exec(u.hash || ''); return m ? m[1].toUpperCase() : '';
  },
  /** файл игры на ПК, где запущен «Играть онлайн.cmd»: свой сервер находится сам — создавать комнату можно без ссылки */
  async probeLocal() {
    if (!this.fromFile()) return false;
    if (this.localBase) return true;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), 1200);
      const r = await fetch('http://127.0.0.1:3000/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }); if (t) clearTimeout(t);
      const j = await r.json(); if (!j || !j.ok) return false;
      this.localBase = 'http://127.0.0.1:3000'; this.server = this.localBase; return true;
    } catch { return false; }
  },
  /** у хоста: публичный адрес туннеля «Играть онлайн.cmd» — для приглашения другу (страница с сервера или файл на том же ПК) */
  async fetchPublic() {
    const base = /^https?:$/.test(location.protocol) ? '' : this.localBase;
    if (base == null) { this.publicBase = null; return null; }
    try { const r = await fetch(base + '/public', { cache: 'no-store' }); const j = await r.json(); this.publicBase = j && /^https:\/\/[\w.-]+$/.test(j.url) ? j.url : null; } catch { this.publicBase = null; }
    return this.publicBase;
  },
  inviteLink(code) { return `${this.publicBase || this.serverBase() || location.origin}/#join=${code}`; },
  /** ссылка годится другу: публичный адрес туннеля, а не localhost этого ПК */
  inviteOk() { return !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(this.publicBase || this.serverBase() || location.origin); },
  on(ev, fn) { this.h[ev] = fn; },
  emit(ev, ...args) { try { if (this.h[ev]) this.h[ev](...args); } catch (e) { console.error(e); } },
  host() { this.connect('host'); },
  join(code) { this.connect('guest', String(code).trim().toUpperCase()); },
  connect(role, code) {
    this.close();
    const base = this.serverBase(); if (!base) { this.emit('error', { type: 'noserver' }); return; }
    this.role = role; this.code = code || null;
    const b = new URL(base), ws = new WebSocket(`${b.protocol === 'https:' ? 'wss:' : 'ws:'}//${b.host}/room`);
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
      network: 'Нет связи с игровым сервером. Проверьте ссылку: у бесплатного туннеля адрес иногда меняется — попросите у друга свежую.',
      noserver: 'Вставьте ссылку-приглашение от друга (https://…) в поле «Ссылка от друга».'
    };
    return messages[e && e.type] || 'Соединение прервалось. Попробуйте ещё раз.';
  }
};
