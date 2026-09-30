'use strict';
/* =========================================================
   Интерфейс: меню, лобби, настройки, панель оружия, чат
   ========================================================= */
const $ = (id) => document.getElementById(id);
const UI = {
  app: null, cur: null, mode: 'hotseat', teamsCfg: null, settings: null, trayOpen: false, traySig: '', chatOpen: false,
  init(app) {
    this.app = app;
    $('volume').value=Math.round(Sfx.volume*100);$('volume').addEventListener('input',e=>Sfx.setVolume(+e.target.value/100));
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      Sfx.resume(); Sfx.play('click'); this.act(b.dataset.act, b);
    });
    $('dialog-ok').addEventListener('click', () => { $('dialog').classList.add('hidden'); if (this.dialogCb) { const f = this.dialogCb; this.dialogCb = null; f(); } });
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.act('join'); });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    for (const id of ['o-perTeam', 'o-hp', 'o-turnTime', 'o-wind', 'o-ai', 'o-side']) $(id).addEventListener('change', () => this.onSettingsChanged());
    $('o-turnTime').addEventListener('input', () => this.onSettingsChanged());
    $('o-hp').addEventListener('input', () => this.onSettingsChanged());
    $('o-arsenal').addEventListener('change', () => { this.fillAmmo(makeAmmo($('o-arsenal').value)); this.onSettingsChanged(); });
    $('ammo-all').addEventListener('click', () => { const m = {}; for (const w of WEAPONS) m[w.id] = w.ammo; this.fillAmmo(m); this.onSettingsChanged(); });
    $('ammo-none').addEventListener('click', () => { this.fillAmmo({}); this.onSettingsChanged(); });
    $('ammo-reset').addEventListener('click', () => { this.fillAmmo(makeAmmo($('o-arsenal').value)); this.onSettingsChanged(); });
    this.buildAmmo();
    $('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) this.app.sendChat(v); e.target.value = ''; this.closeChat(); e.preventDefault(); }
      else if (e.key === 'Escape') { this.closeChat(); e.preventDefault(); }
      e.stopPropagation();
    });
    this.buildMaps(); this.buildHelp(); this.updateSoundIcon(); this.featureMap(app.prefs.settings.mapId);
  },
  act(a, el) {
    const app = this.app;
    switch (a) {
      case 'online': if (!Net.available()) { this.dialog('Игра с другом по сети работает через сервер: запустите «Играть онлайн.cmd» из папки игры. В этом файле доступны «Против компьютера» и «На одном экране».'); return; } this.show('s-online'); this.status(''); break;
      case 'map-prev': case 'map-next': { const i = MAPS.findIndex(m => m.id === app.prefs.settings.mapId); this.featureMap(MAPS[(i + (a === 'map-next' ? 1 : -1) + MAPS.length) % MAPS.length].id); break; }
      case 'invite': { const link = `${location.origin}${location.pathname}#join=${Net.code}`; if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => this.setNote('Приглашение скопировано — отправьте другу'), () => this.setNote(link)); else this.setNote(link); break; }
      case 'hotseat': this.openSetup('hotseat'); break;
      case 'cpu': this.openSetup('cpu'); break;
      case 'help': this.show('s-help'); break;
      case 'back': app.back(); break;
      case 'sound': case 'sound2': Sfx.toggle(); this.updateSoundIcon(); break;
      case 'host': app.hostRoom(); break;
      case 'join': { const code = $('join-code').value.trim(); if (code.length < 5) { this.status('Введите код из 5 символов', true); return; } app.joinRoom(code); break; }
      case 'copy': { const code = $('room-code').textContent; const done = () => this.setNote('Код скопирован — отправьте его другу'); if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => this.setNote('Скопируйте код вручную: ' + code)); else this.setNote('Код: ' + code); break; }
      case 'start': app.startFromSetup(); break;
      case 'resume': app.resume(); break;
      case 'pause': app.togglePause(); break;
      case 'quit': app.quitToMenu(); break;
      case 'rematch': app.rematch(); break;
      case 'tray': app.toggleTray(); break;
    }
  },
  show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id));
    this.cur = id;
  },
  featureMap(id) {
    const m = MAP_BY_ID[id] || MAPS[0]; this.app.prefs.settings.mapId = m.id; this.app.savePrefs();
    $('menu-art').style.backgroundImage = `url("assets/maps/${m.id}.png")`;
    $('featured-name').textContent = m.name; $('featured-desc').textContent = m.desc;
    $('featured-number').textContent = String(MAPS.indexOf(m) + 1).padStart(2, '0') + ' / 08';
    $('map-dots').innerHTML = '';
    MAPS.forEach(map => { const b = document.createElement('button'); b.className = 'map-dot' + (map === m ? ' on' : ''); b.title = map.name; b.setAttribute('aria-label', map.name); b.onclick = () => this.featureMap(map.id); $('map-dots').appendChild(b); });
  },
  hideScreens() { document.querySelectorAll('.screen').forEach(s => s.classList.remove('show')); this.cur = null; },
  status(txt, err) { const s = $('online-status'); s.textContent = txt; s.classList.toggle('err', !!err); },
  setNote(txt) { $('setup-note').textContent = txt; },
  dialog(txt, cb) { $('dialog-text').textContent = txt; $('dialog').classList.remove('hidden'); this.dialogCb = cb || null; },
  loading(on, txt) { $('loading').classList.toggle('hidden', !on); if (txt) $('loading-text').textContent = txt; },
  updateSoundIcon() { document.querySelectorAll('[data-act="sound"]').forEach(b => { b.textContent = Sfx.enabled ? '🔊' : '🔇'; }); const b2 = document.querySelector('[data-act="sound2"]'); if (b2) b2.textContent = Sfx.enabled ? 'Звук: вкл' : 'Звук: выкл'; },
  showHud(on) { $('hud-btns').classList.toggle('hidden', !on); if (!on) { this.setTray(false); $('chat').classList.add('hidden'); } },
  /* ---------- настройка ---------- */
  openSetup(mode) {
    this.mode = mode; const app = this.app;
    this.settings = Object.assign({}, app.prefs.settings); this.teamsCfg = app.prefs.teams.map(t => Object.assign({}, t));
    if (mode === 'cpu') this.teamsCfg[1] = Object.assign({}, app.prefs.bot || DEFAULT_PREFS.bot);   // окрас и снаряжение бота настраиваются отдельно
    this.applySettings(this.settings);
    $('setup-title').textContent = mode === 'cpu' ? 'Бой против компьютера' : mode === 'hotseat' ? 'Бой вдвоём на одном компьютере' : mode === 'host' ? 'Комната: вы — хост' : 'Комната друга';
    $('room-box').classList.toggle('hidden', !(mode === 'host' || mode === 'guest'));
    $('o-ai-wrap').classList.toggle('hidden', mode !== 'cpu');
    const guest = mode === 'guest';
    document.querySelectorAll('#opts select, #opts input, #ammo-box input, #ammo-box button').forEach(s => { s.disabled = guest; });
    $('btn-start').classList.toggle('hidden', guest);
    this.setNote(guest ? 'Хост выбирает карту и настройки. Вы можете настроить свою команду.' : mode === 'host' ? 'Отправьте код другу. Когда он подключится — жмите «В бой!»' : '');
    this.buildTeams(); this.markMap(); this.show('s-setup');
    if (mode === 'host') this.setPeerStatus(false);
  },
  setRoomCode(code) { $('room-code').textContent = code; },
  setPeerStatus(ok, txt) { const s = $('peer-status'); s.textContent = txt || (ok ? '● друг подключился' : '○ ждём друга…'); s.classList.toggle('ok', !!ok); },
  readSettings() {
    const S = this.settings;
    S.perTeam = +$('o-perTeam').value; { const hp = Math.round(+$('o-hp').value); if (Number.isFinite(hp) && hp >= 1) S.hp = Math.min(1000, hp); } S.wind = $('o-wind').value === '1'; S.side = $('o-side').value;
    const tt = Math.round(+$('o-turnTime').value); if (Number.isFinite(tt) && tt >= 5) S.turnTime = Math.min(600, tt);
    S.crates = false; S.sd = 0; S.arsenal = $('o-arsenal').value; S.ai = $('o-ai').value;
    S.ammo = this.readAmmo();
    return S;
  },
  applySettings(S) {
    $('o-perTeam').value = String(S.perTeam); $('o-hp').value = String(S.hp); $('o-turnTime').value = String(S.turnTime); $('o-wind').value = S.wind ? '1' : '0';
    $('o-arsenal').value = S.arsenal; $('o-ai').value = S.ai || 'normal'; $('o-side').value = S.side || 'random';
    this.fillAmmo(S.ammo || makeAmmo(S.arsenal));
  },
  /** редактор атак: галочка — оружие есть в бою, число — сколько раз его можно применить (пусто — без ограничения) */
  buildAmmo() {
    const g = $('ammo-grid'); g.innerHTML = '';
    for (const w of WEAPONS) {
      const row = document.createElement('label'); row.className = 'ammo-row'; row.dataset.w = w.id; row.title = w.desc || w.name;
      row.innerHTML = '<input type="checkbox"><span></span><input type="number" min="0" max="99" placeholder="∞">';
      row.querySelector('span').textContent = w.name;
      const cb = row.querySelector('input[type=checkbox]'), num = row.querySelector('input[type=number]');
      cb.addEventListener('change', () => { if (cb.checked && num.value === '0') num.value = String(w.ammo > 0 ? w.ammo : ''); row.classList.toggle('off', !cb.checked); this.onSettingsChanged(); });
      num.addEventListener('input', () => { if (num.value === '0') { cb.checked = false; row.classList.add('off'); } else if (!cb.checked) { cb.checked = true; row.classList.remove('off'); } this.onSettingsChanged(); });
      g.appendChild(row);
    }
  },
  fillAmmo(m) {
    for (const row of document.querySelectorAll('#ammo-grid .ammo-row')) {
      const n = m[row.dataset.w], cb = row.querySelector('input[type=checkbox]'), num = row.querySelector('input[type=number]');
      const on = n === -1 || n > 0; cb.checked = on; num.value = n > 0 ? String(n) : ''; row.classList.toggle('off', !on);
    }
  },
  readAmmo() {
    const m = {};
    for (const row of document.querySelectorAll('#ammo-grid .ammo-row')) {
      const cb = row.querySelector('input[type=checkbox]'), v = row.querySelector('input[type=number]').value.trim();
      m[row.dataset.w] = !cb.checked ? 0 : v === '' ? -1 : Math.max(0, Math.min(99, Math.floor(+v) || 0));
    }
    return m;
  },
  onSettingsChanged() { if (this.mode === 'guest') return; this.readSettings(); this.app.onLobbyChanged(); },
  buildMaps() {
    const g = $('map-grid'); g.innerHTML = '';
    for (const m of MAPS) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'map-card'; card.dataset.map = m.id; card.title = m.desc;
      const img = document.createElement('img'); img.src = `assets/maps/${m.id}-thumb.webp`; img.alt = m.name; card.appendChild(img);
      const cv = makeCanvas(240, Math.round(240 * m.H / m.W)); drawMapPreview(cv, m); cv.className = 'map-layout'; card.appendChild(cv);
      const nm = document.createElement('div'); nm.className = 'mc-name'; nm.textContent = m.name; card.appendChild(nm);
      card.addEventListener('click', () => { if (this.mode === 'guest') return; Sfx.play('select'); this.settings.mapId = m.id; this.markMap(); this.app.onLobbyChanged(); });
      g.appendChild(card);
    }
    const d = document.createElement('div'); d.className = 'map-desc muted small'; d.id = 'map-desc'; g.after(d);
  },
  markMap() {
    const id = this.settings ? this.settings.mapId : 'valley';
    document.querySelectorAll('.map-card').forEach(c => c.classList.toggle('on', c.dataset.map === id));
    const m = MAP_BY_ID[id]; if (m && $('map-desc')) $('map-desc').textContent = `${m.W} × ${m.H} · ${m.desc}`;
  },
  buildTeams() {
    const focused = document.activeElement;
    const focusedTeam = focused && focused.classList.contains('tc-name') ? focused.closest('.team-card').dataset.team : null;
    const selection = focusedTeam !== null ? [focused.selectionStart, focused.selectionEnd] : null;
    // Keep the local draft, including a trailing space, while lobby echoes arrive.
    if (focusedTeam !== null && this.teamsCfg[focusedTeam]) this.teamsCfg[focusedTeam].name = focused.value.slice(0, 16);
    const box = $('team-cards'); box.innerHTML = '';
    this.teamsCfg.forEach((t, i) => {
      const card = document.createElement('div'); card.className = 'team-card'; card.dataset.team = i;
      const editable = this.mode === 'hotseat' || this.mode === 'cpu' || (this.mode === 'host' && i === 0) || (this.mode === 'guest' && i === 1);
      if (!editable) card.classList.add('locked');
      const role = this.mode === 'cpu' ? (i ? 'Компьютер' : 'Вы') : this.mode === 'hotseat' ? `Игрок ${i + 1}` : (this.mode === 'host' ? (i ? 'Друг' : 'Вы (хост)') : (i ? 'Вы' : 'Хост'));
      card.innerHTML = `<div class="tc-head"><canvas class="tc-preview" width="140" height="168"></canvas><div style="flex:1"><div class="tc-role"></div><input class="tc-name" maxlength="16"></div></div><div class="tc-colors"></div><div class="tc-hats"></div>`;
      card.querySelector('.tc-role').textContent = role;
      const inp = card.querySelector('.tc-name'); inp.value = t.name;
      inp.addEventListener('input', () => { t.name = inp.value.slice(0, 16); this.app.onTeamEdited(i); });
      const cols = card.querySelector('.tc-colors');
      for (const c of TEAM_COLORS) {
        const sw = document.createElement('div'); sw.className = 'swatch' + (c === t.color ? ' on' : ''); sw.style.background = c;
        sw.addEventListener('click', () => { t.color = c; this.buildTeams(); this.app.onTeamEdited(i); Sfx.play('select'); });
        cols.appendChild(sw);
      }
      const hats = card.querySelector('.tc-hats');
      for (const h of HAT_IDS) {
        const b = document.createElement('button'); b.className = 'hat-btn' + (h === t.hat ? ' on' : ''); b.textContent = HATS[h];
        b.addEventListener('click', () => { t.hat = h; this.buildTeams(); this.app.onTeamEdited(i); Sfx.play('select'); });
        hats.appendChild(b);
      }
      box.appendChild(card);
      this.drawPreview(card.querySelector('canvas'), t, i);
    });
    if (focusedTeam !== null) {
      const input = box.querySelector(`[data-team="${focusedTeam}"] .tc-name`);
      if (input) { input.focus(); input.setSelectionRange(...selection); }
    }
  },
  drawPreview(cv, t, i) {
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
    c.save(); c.scale(3.2, 3.2);
    const s = { id: i + 1, x: 21, y: 46, aim: -0.35, face: 1, st: 'stand', rot: 0, wpn: i ? 'shotgun' : 'bazooka', alive: true, hurt: 0 };
    drawSoldier(c, s, { color: t.color, hat: t.hat }, 1.2, { walk: 0, blink: 0 });
    c.restore();
  },
  refreshTeams(teams) { this.teamsCfg = teams.map(t => Object.assign({}, t)); if (this.cur === 's-setup') this.buildTeams(); },
  buildHelp() {
    const box = $('help-weapons'); box.innerHTML = '';
    for (const w of WEAPONS) {
      const row = document.createElement('div'); row.className = 'hw';
      const ic = weaponIcon(w.id, 72); const cv = makeCanvas(72, 72); cv.getContext('2d').drawImage(ic, 0, 0); row.appendChild(cv);
      const txt = document.createElement('div'); const b = document.createElement('b'); b.textContent = w.name + (w.ammo < 0 ? ' · ∞' : ` · ×${w.ammo}`); const sp = document.createElement('span'); sp.textContent = w.desc;
      txt.appendChild(b); txt.appendChild(sp); row.appendChild(txt); box.appendChild(row);
    }
  },
  /* ---------- панель оружия ---------- */
  setTray(on) { this.trayOpen = on; $('tray').classList.toggle('hidden', !on); this.traySig = ''; },
  updateTray(sc, T, ctl) {
    if (!this.trayOpen || !sc) return;
    const tm = sc.teams[T.team]; const mine = ctl && ctl.mine && T.phase === 'aim' && T.shots === 0;
    const round = sc.round || T.round;
    const sig = JSON.stringify(tm ? tm.ammo : {}) + T.weapon + mine + round;
    if (sig === this.traySig) return; this.traySig = sig;
    const g = $('tray-grid'); g.innerHTML = '';
    WEAPON_CATS.forEach((cn, ci) => {
      const lab = document.createElement('div'); lab.className = 'tray-cat'; lab.textContent = cn; g.appendChild(lab);
      const list = WEAPONS.filter(w => w.cat === ci);
      for (let k = 0; k < Math.ceil(list.length / 6) * 6; k++) {
        const w = list[k]; const it = document.createElement('div');
        if (!w) { g.appendChild(document.createElement('div')); continue; }
        const am = tm ? tm.ammo[w.id] : undefined; const locked = w.minRound && round < w.minRound;
        const off = am === undefined || am === 0 || locked;
        it.className = 'tray-item' + (off ? ' off' : '') + (T.weapon === w.id ? ' on' : '');
        it.title = w.name + ' — ' + w.desc; it.setAttribute('role', 'button'); it.setAttribute('aria-label', w.name); it.tabIndex = off ? -1 : 0;
        it.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.click(); } });
        const cv = makeCanvas(44, 44); cv.getContext('2d').drawImage(weaponIcon(w.id, 44), 0, 0); it.appendChild(cv);
        const a = document.createElement('span'); a.className = 'am'; a.textContent = am === undefined ? '' : am < 0 ? '∞' : am; it.appendChild(a);
        if (locked) { const l = document.createElement('span'); l.className = 'lock'; l.textContent = `с ${w.minRound} р.`; it.appendChild(l); }
        it.addEventListener('mouseenter', () => { const inf = $('tray-info'); inf.innerHTML = ''; const b = document.createElement('b'); b.textContent = w.name; inf.appendChild(b); inf.appendChild(document.createElement('br')); inf.appendChild(document.createTextNode(w.desc)); });
        it.addEventListener('click', () => { if (off || !mine) { Sfx.play('denied'); return; } ctl.select(w.id); this.setTray(false); });
        g.appendChild(it);
      }
    });
  },
  /* ---------- чат ---------- */
  openChat() { this.chatOpen = true; Input.typing = true; const i = $('chat-input'); i.classList.remove('hidden'); i.focus(); },
  closeChat() { this.chatOpen = false; Input.typing = false; const i = $('chat-input'); i.classList.add('hidden'); i.blur(); },
  chatLine(name, color, txt) {
    const log = $('chat-log'); const line = document.createElement('div'); line.className = 'chat-line';
    const b = document.createElement('b'); b.textContent = name + ':'; b.style.color = color; line.appendChild(b); line.appendChild(document.createTextNode(txt));
    log.appendChild(line); while (log.children.length > 6) log.firstChild.remove();
    setTimeout(() => { line.style.transition = 'opacity 1s'; line.style.opacity = '0'; setTimeout(() => line.remove(), 1000); }, 12000);
  },
  /* ---------- итоги ---------- */
  showOver(ev, sc, myTeams, canRematch) {
    const win = sc.teams[ev.win];
    const title = $('over-title');
    if (!win) { title.textContent = 'Ничья!'; title.style.color = '#fff'; }
    else { title.textContent = (myTeams.length === 1 ? (myTeams[0] === ev.win ? 'Победа! ' : 'Поражение… ') : '') + `Победили «${win.name}»`; title.style.color = win.color; }
    const st = $('over-stats'); st.innerHTML = '';
    const head = document.createElement('div'); head.className = 'over-row muted'; head.innerHTML = '<span>Команда</span><span>Урон</span><span>Убийства</span><span>Живы</span>'; st.appendChild(head);
    (ev.stats || []).forEach((s, i) => {
      const tm = sc.teams[i]; if (!tm) return; const row = document.createElement('div'); row.className = 'over-row';
      const n = document.createElement('b'); n.textContent = tm.name; n.style.color = tm.color; row.appendChild(n);
      for (const v of [s.dmg, s.kills, s.alive]) { const sp = document.createElement('span'); sp.textContent = v; row.appendChild(sp); }
      st.appendChild(row);
    });
    $('btn-rematch').classList.toggle('hidden', !canRematch);
    $('over-note').textContent = '';
    this.show('s-over');
  },
};
