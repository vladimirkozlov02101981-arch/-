'use strict';
/* WebSocket relay. The host owns the simulation.
   Страница с сервера соединяется со своим сервером; файл игры (Territory-War.html) — с сервером из ссылки-приглашения:
   картинки грузятся из файла мгновенно, а через интернет идут только ходы. */
const NET_VERSION = 8;
const NET_LIMITS = { wire: 192 * 1024, buffered: 64 * 1024, queue: 8 * 1024 * 1024, messages: 512, pingTimeout: 12000, ackTimeout: 30000, controlLease: 1000 };
const Net = {
  socket: null, role: null, code: null, h: {}, pingT: null, pumpT: null, rtt: null, rttStatus: 'pending', rttAt: 0,
  lastData: 0, chunks: new Map(), joinTimer: null, linked: false, server: null, publicBase: null,
  outbox: [], priority: [], statePending: null, stateFlight: null, reliableFlight: null,
  seq: 0, receivedReliable: 0, receivedState: 0, receivedEpoch: null, epoch: '', gameSession: null, pingPending: null, pingSeq: 0, controlAt: null,
  /** страница открыта с сервера или это файл игры (сервер берётся из ссылки) */
  available() { return typeof WebSocket === 'function' && (/^https?:$/.test(location.protocol) || location.protocol === 'file:'); },
  fromFile() { return location.protocol === 'file:'; },
  serverBase() {
    if (/^https?:$/.test(location.protocol)) return location.origin;
    if (this.server) return this.server;
    try { return localStorage.getItem('tw_server_copy1') || null; } catch { return null; }
  },
  /** ссылка-приглашение (https://….lhr.life/#join=КОД) или адрес сервера: запоминает сервер, возвращает код комнаты ('' — кода нет, null — не ссылка) */
  useLink(text) {
    let u; try { u = new URL(String(text || '').trim()); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    this.server = u.origin; try { localStorage.setItem('tw_server_copy1', u.origin); } catch { /* без запоминания */ }
    const m = /#join=([A-Za-z0-9]{5})/.exec(u.hash || ''); return m ? m[1].toUpperCase() : '';
  },
  /** файл игры на ПК, где запущен «Играть онлайн.cmd»: свой сервер находится сам — создавать комнату можно без ссылки */
  async probeLocal() {
    if (!this.fromFile()) return false;
    if (this.localBase) return true;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), 1200);
      const r = await fetch('http://127.0.0.1:3001/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }); if (t) clearTimeout(t);
      const j = await r.json(); if (!j || !j.ok) return false;
      this.localBase = 'http://127.0.0.1:3001'; this.server = this.localBase; return true;
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
    this.role = role; this.code = code || null; this.epoch = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const b = new URL(base), ws = new WebSocket(`${b.protocol === 'https:' ? 'wss:' : 'ws:'}//${b.host}/room`);
    this.socket = ws;
    this.joinTimer = setTimeout(() => { if (this.socket === ws && !this.linked && !(role === 'host' && this.code)) { this.emit('error', { type: 'timeout' }); this.close(); } }, 15000);
    ws.onopen = () => { if (this.socket === ws) ws.send(JSON.stringify(role === 'host' ? { type: 'create' } : { type: 'join', code })); };
    ws.onmessage = event => {
      if (this.socket !== ws) return;
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'created') { clearTimeout(this.joinTimer); this.code = m.code; this.emit('hosting', m.code); }
      if (m.type === 'connected') { clearTimeout(this.joinTimer); this.resetPeer(); this.linked = true; this.lastData = performance.now(); this.startPing(); this.emit('connected'); }
      if (m.type === 'left') { this.linked = false; this.resetPeer(); this.emit('closed'); }
      if (m.type === 'error') { clearTimeout(this.joinTimer); this.emit('error', { type: m.code }); }
      if (m.type === 'data') this.receive(m.data);
    };
    ws.onerror = () => { if (this.socket === ws) this.emit('error', { type: 'network' }); };
    ws.onclose = () => { if (this.socket === ws) { const linked = this.linked; this.socket = null; this.linked = false; this.stopPing(); clearTimeout(this.joinTimer); this.emit(linked ? 'closed' : 'error', { type: 'network' }); } };
  },
  receive(d) {
    if (!d || typeof d !== 'object') return;
    this.lastData = performance.now();
    if (d.t === 'ping') { if (typeof d.n === 'string' && d.n.length <= 80) this.sendPriority({ t: 'pong', n: d.n }); return; }
    if (d.t === 'pong') {
      const p = this.pingPending;
      if (p && d.n === p.n) {
        const elapsed = performance.now() - p.at; this.pingPending = null;
        if (elapsed <= NET_LIMITS.pingTimeout) { this.rtt = Math.round(Math.max(0, elapsed)); this.rttAt = performance.now(); this.rttStatus = 'ok'; }
        else { this.rtt = null; this.rttStatus = 'timeout'; }
      }
      return;
    }
    if (d.t === 'net-ack') {
      if (d.lane === 'state' && this.stateFlight && d.q === this.stateFlight.q && d.e === this.stateFlight.e) this.stateFlight = null;
      if (d.lane === 'reliable' && this.reliableFlight && d.q === this.reliableFlight.q && d.e === this.reliableFlight.e) this.reliableFlight = null;
      this.flush(); return;
    }
    if (d.t === 'net') {
      if (!Number.isSafeInteger(d.q) || d.q < 1 || typeof d.e !== 'string' || d.e.length > 80 || !Array.isArray(d.items) || d.items.length > 64) return;
      if (this.receivedEpoch && d.e !== this.receivedEpoch) return;
      this.receivedEpoch = d.e;
      if (d.q > this.receivedReliable) { this.receivedReliable = d.q; for (const item of d.items) this.receive(item); }
      this.sendPriority({ t: 'net-ack', lane: 'reliable', q: d.q, e: d.e }); return;
    }
    if (d.t === 'chunk') { this.onChunk(d); return; }
    if (d.t === 'start') {
      this.clearState(); this.outbox = this.outbox.filter(e => e.data.t !== 'c'); this.releaseControl();
      this.gameSession = typeof d.ns === 'string' ? d.ns : null; this.chunks.clear();
    }
    if (d.t === 'lobby') { this.clearState(); this.releaseControl(); this.outbox = this.outbox.filter(e => e.data.t !== 'c'); }
    if (d.t === 's') {
      if (this.gameSession && d.ns !== this.gameSession) return;
      if (this.receivedEpoch && d.e !== this.receivedEpoch) return;
      if (Number.isSafeInteger(d.q)) {
        this.sendPriority({ t: 'net-ack', lane: 'state', q: d.q, e: d.e });
        if (d.q <= this.receivedState) return;
        this.receivedState = d.q;
      }
    }
    if (d.t === 'c') {
      if (this.gameSession && d.ns !== this.gameSession) return;
      if (d.c && d.c.c === 'ctrl') this.controlAt = performance.now();
    }
    this.emit('data', d);
  },
  /** State is replaceable; ordered V and the latest TM are not discarded. */
  mergeState(old, next) {
    const m = { ...next, V: (old && old.V || []).concat(next.V || []) };
    if (!next.TM && old && old.TM) m.TM = old.TM;
    return m;
  },
  clearState() { this.statePending = null; this.stateFlight = null; this.outbox = this.outbox.filter(e => !e.state); },
  prepare(data) {
    if (data.t === 'start') { this.clearState(); this.gameSession = this.epoch + ':g' + (++this.seq); return { ...data, ns: this.gameSession }; }
    if (data.t === 'lobby') this.clearState();
    return data.t === 'c' ? { ...data, ns: this.gameSession } : data;
  },
  send(data) {
    if (!this.connected || !data || typeof data !== 'object') return false;
    if (data.t === 's') {
      this.statePending = this.mergeState(this.statePending, { ...data, ns: this.gameSession });
      if (JSON.stringify(this.statePending).length > NET_LIMITS.queue) { this.failSlow(); return false; }
    } else this.enqueue(this.prepare(data));
    this.flush(); return this.connected;
  },
  sendBig(data) { return this.send(data); },
  enqueue(data, state = false) {
    const s = JSON.stringify(data);
    if (s.length > 50000) {
      const id = this.epoch + ':b' + (++this.seq), n = Math.ceil(s.length / 50000);
      if (n > 100) { this.failSlow(); return; }
      for (let i = 0; i < n; i++) this.outbox.push({ data: { t: 'chunk', id, i, n, d: s.slice(i * 50000, (i + 1) * 50000) }, state });
    } else {
      const last = this.outbox[this.outbox.length - 1], ctrl = data.t === 'c' && data.c && data.c.c === 'ctrl';
      // Coalesce only inside the current control segment. A discrete command is a barrier.
      if (ctrl && last && last.data.t === 'c' && last.data.c && last.data.c.c === 'ctrl') last.data = data;
      else this.outbox.push({ data, state });
    }
    if (this.outbox.length > NET_LIMITS.messages || JSON.stringify(this.outbox).length > NET_LIMITS.queue) this.failSlow();
  },
  sendPriority(data) {
    if (!this.connected) return;
    if (this.priority.length >= 64) { this.failSlow(); return; }
    this.priority.push(data); this.flush();
  },
  wire(data) { return JSON.stringify({ type: 'relay', data }); },
  wireBytes(s) { return new TextEncoder().encode(s).byteLength; },
  write(data) {
    if (!this.connected || this.socket.bufferedAmount > NET_LIMITS.buffered) return false;
    try { this.socket.send(this.wire(data)); return true; } catch { this.failSlow(); return false; }
  },
  flush() {
    if (!this.connected || this.flushing) return;
    this.flushing = true;
    try {
      while (this.priority.length && this.socket.bufferedAmount <= NET_LIMITS.buffered) {
        if (!this.write(this.priority[0])) return; this.priority.shift();
      }
      if (this.priority.length || this.socket.bufferedAmount > NET_LIMITS.buffered) return;
      if (!this.reliableFlight && this.outbox.length) {
        const q = ++this.seq, items = []; let take = 0;
        for (const item of this.outbox) {
          const candidate = { t: 'net', q, e: this.epoch, items: items.concat(item.data) };
          if (items.length && this.wireBytes(this.wire(candidate)) > NET_LIMITS.wire) break;
          if (this.wireBytes(this.wire(candidate)) > 256 * 1024) { this.failSlow(); return; }
          items.push(item.data); take++; if (take === 32) break;
        }
        this.reliableFlight = { q, e: this.epoch, at: performance.now() };
        if (this.write({ t: 'net', q, e: this.epoch, items })) this.outbox.splice(0, take); else this.reliableFlight = null;
      }
      if (!this.stateFlight && !this.outbox.length && !this.reliableFlight && this.statePending) {
        const m = this.statePending; m.q = ++this.seq; m.e = this.epoch; this.statePending = null;
        this.stateFlight = { q: m.q, e: this.epoch, at: performance.now() };
        if (JSON.stringify(m).length > 50000) this.enqueue(m, true);
        else if (!this.write(m)) { this.statePending = m; this.stateFlight = null; }
      }
    } finally { this.flushing = false; }
  },
  onChunk(d) {
    const now = performance.now();
    for (const [id, entry] of this.chunks) if (now - entry.at > 15000) this.chunks.delete(id);
    if (typeof d.id !== 'string' || d.id.length > 80 || !Number.isInteger(d.i) || !Number.isInteger(d.n) || d.n < 1 || d.n > 100 || d.i < 0 || d.i >= d.n || typeof d.d !== 'string' || d.d.length > 50000) return;
    let e = this.chunks.get(d.id);
    if (!e) { if (this.chunks.size >= 4) return; e = { n: d.n, parts: [], got: 0, at: now }; this.chunks.set(d.id, e); }
    if (e.n !== d.n) return; e.at = now; // Timeout is idle time, not total transfer time.
    if (e.parts[d.i] === undefined) { e.parts[d.i] = d.d; e.got++; }
    if (e.got === e.n) { this.chunks.delete(d.id); try { this.receive(JSON.parse(e.parts.join(''))); } catch {} }
  },
  ping() {
    const now = performance.now();
    if (this.pingPending && now - this.pingPending.at >= NET_LIMITS.pingTimeout) {
      const n = this.pingPending.n; this.priority = this.priority.filter(d => d.t !== 'ping' || d.n !== n);
      this.pingPending = null; this.rtt = null; this.rttStatus = 'timeout'; this.emit('stall');
    }
    if (!this.pingPending && this.connected) {
      const n = this.epoch + ':p' + (++this.pingSeq); this.pingPending = { n, at: now };
      this.sendPriority({ t: 'ping', n });
    }
  },
  releaseControl() {
    const hadControl = this.controlAt !== null; this.controlAt = null;
    if (hadControl && this.role === 'host') this.emit('data', { t: 'c', c: { c: 'ctrl', l: false, r: false, u: false, d: false, pw: -1 } });
  },
  pump() {
    const now = performance.now();
    if (this.controlAt !== null && now - this.controlAt > NET_LIMITS.controlLease) this.releaseControl();
    if ((this.stateFlight && now - this.stateFlight.at > NET_LIMITS.ackTimeout) || (this.reliableFlight && now - this.reliableFlight.at > NET_LIMITS.ackTimeout)) { this.failSlow(); return; }
    if (this.pingPending && now - this.pingPending.at >= NET_LIMITS.pingTimeout) this.ping();
    this.flush();
  },
  failSlow() { this.close(); this.rttStatus = 'timeout'; this.emit('error', { type: 'slow' }); },
  startPing() { this.stopPing(); this.pingT = setInterval(() => this.ping(), 2000); this.pumpT = setInterval(() => this.pump(), 25); },
  stopPing() { clearInterval(this.pingT); clearInterval(this.pumpT); this.pingT = this.pumpT = null; this.pingPending = null; this.releaseControl(); },
  /** Keep the host's room/socket, but discard all transport state belonging to the previous peer. */
  resetPeer() {
    this.stopPing(); this.chunks.clear(); this.outbox = []; this.priority = [];
    this.statePending = this.stateFlight = this.reliableFlight = null;
    this.seq = this.receivedReliable = this.receivedState = this.pingSeq = 0; this.receivedEpoch = null; this.gameSession = null;
    this.epoch = Date.now().toString(36) + Math.random().toString(36).slice(2);
    this.rtt = null; this.rttAt = 0; this.rttStatus = 'pending';
  },
  close() {
    clearTimeout(this.joinTimer); const ws = this.socket; this.socket = null; this.linked = false;
    this.resetPeer(); this.role = null; this.code = null; if (ws) ws.close();
  },
  get connected() { return this.linked && this.socket && this.socket.readyState === WebSocket.OPEN; },
  errorText(e) {
    const messages = {
      'peer-unavailable': 'Комната не найдена. Проверьте код: возможно, друг уже вышел.',
      full: 'В этой комнате уже играют двое. Создайте новую комнату.',
      busy: 'Сервер занят. Попробуйте подключиться чуть позже.',
      slow: 'Связь слишком медленная: очередь боя достигла предела. Проверьте соединение и подключитесь снова.',
      timeout: 'Время подключения истекло. Проверьте интернет и повторите попытку.',
      network: 'Нет связи с игровым сервером. Проверьте ссылку: у бесплатного туннеля адрес иногда меняется — попросите у друга свежую.',
      noserver: 'Вставьте ссылку-приглашение от друга (https://…) в поле «Ссылка от друга».'
    };
    return messages[e && e.type] || 'Соединение прервалось. Попробуйте ещё раз.';
  }
};
