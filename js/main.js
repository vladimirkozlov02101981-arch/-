'use strict';
/* =========================================================
   Точка входа: режимы игры, главный цикл, сетевой протокол
   ========================================================= */
const DT = 1 / 60;
/* запасные значения для проверки полей; настройки игрока и их значения по умолчанию — js/profile.js (Profile, FACTORY_SNAP) */
const DEFAULT_PREFS = {
  settings: { mapId: 'arctic', perTeam: 4, hp: 100, turnTime: 0, wind: true, crates: false, sd: 0, arsenal: 'all', ai: 'normal', ammo: null, walk: 'limited', simul: false },
  teams: [{ name: 'Красные', color: '#2fd6e0', hat: 'viking' }, { name: 'Синие', color: '#3d8bff', hat: 'beret' }],
  bot: { name: 'Компьютер', color: '#ff8a2b', hat: 'ushanka' },
};
function sanitizeTeam(t, fb) {
  t = t && typeof t === 'object' ? t : {};
  const name = String(t.name == null ? '' : t.name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return { name: name || fb.name, color: TEAM_COLORS.includes(t.color) ? t.color : fb.color, hat: HAT_IDS.includes(t.hat) ? t.hat : fb.hat };
}
function sanitizeSettings(S) {
  const D = DEFAULT_PREFS.settings; S = S && typeof S === 'object' ? S : {};
  return {
    mapId: MAP_BY_ID[S.mapId] ? S.mapId : D.mapId, perTeam: clamp((S.perTeam | 0) || D.perTeam, 1, 20),
    hp: Number.isFinite(+S.hp) && +S.hp >= 1 ? clamp(Math.round(+S.hp), 1, 1000) : D.hp, turnTime: S.turnTime === 0 ? 0 : Number.isFinite(+S.turnTime) && +S.turnTime >= 5 ? clamp(Math.round(+S.turnTime), 5, 600) : D.turnTime,   // 0 — без ограничения
    wind: S.wind !== false, crates: false, sd: 0,   // ящиков с припасами и внезапной смерти в игре нет
    arsenal: ['classic', 'tw3'].includes(S.arsenal) ? S.arsenal : 'all', ai: ['easy', 'normal', 'hard'].includes(S.ai) ? S.ai : 'normal', side: ['left', 'right', 'random'].includes(S.side) ? S.side : 'random', swap: !!S.swap, ammo: sanitizeAmmo(S.ammo),
    walk: S.walk === 'free' ? 'free' : 'limited',   // ход бойца: ограничен дистанцией или на любую дистанцию
    simul: !!S.simul,                                // непрерывный бой: обе команды ходят одновременно (по сети и против компьютера)
  };
}

const App = {
  mode: 'menu', sc: null, game: null, remote: null, ais: [], ctl: null, fx: new FX(), cam: new Camera(), ren: null,
  last: 0, acc: 0, t: 0, snapAcc: 0, teamsAcc: 0, netEv: [], waitReady: 0, paused: false, overShown: false,
  myTeams: [], demo: false, lastTick: -1, lastSim: 0, guestTeam: null, lastCfg: null, lastLocalMode: null,
  /** основной (постоянный) набор игрока — для мест, которым нужны лишь его настройки боя и команды */
  get prefs() { return Profile.base; },
  savePrefs() { Profile.save(); },
  /** звук включили/выключили или сменили громкость — это личная настройка: в основной набор и в набор на экране */
  soundChanged() {
    const s = { on: Sfx.enabled, volume: Sfx.volume }; Profile.base.sound = s; Profile.save();
    if (UI.work) UI.work.sound = Object.assign({}, s);
  },
  init() {
    this.cv = document.getElementById('game'); this.ren = new Renderer(this.cv); this.ren.resize();
    window.addEventListener('resize', () => this.ren.resize());
    Input.init(this.cv);
    window.addEventListener('blur', () => { if (this.ctl) this.ctl.suspend(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.ctl) this.ctl.suspend(); });
    Input.onClickRight = () => this.toggleTray();
    Input.onBinoc = (on) => { if (this.sc && !this.demo) { this.cam.binoc = on; if (on) UI.setTray(false); else this.cam.free = 0; } };
    // браузер без перехвата Esc (не Chrome/Edge) снял захват мыши — один раз подсказываем, где играть без этого
    Input.onEscLost = () => { if (this.sc && !this.demo) this.fx.banner('Этот браузер отпускает мышь по Esc — играйте в Chrome или Edge («Играть.cmd» открывает игру в них)', '#ffd166', false, 4.5); };
    Input.onWheel = (dy, x, y) => { if (this.sc && !this.demo) this.cam.zoomAt(dy > 0 ? 0.9 : 1.11, x, y, this.ren.sw, this.ren.sh); };
    this.fx.onOver = (ev) => this.onOver(ev);
    this.fx.onTurn = (ev) => this.onTurnEv(ev);
    this.fx.isLocalTeam = (t) => this.myTeams.includes(t);
    this.bindNet();
    Profile.load();
    UI.init(this);
    // на ПК с сервером «Играть» настройки общие для всех браузеров (файл profile.json рядом с игрой)
    Profile.pull().then((changed) => { if (changed && UI.cur === 's-main') UI.featureMap(Profile.base.settings.mapId); });
    window.addEventListener('beforeunload', () => { if (Net.connected) Net.send({ t: 'bye' }); });
    const go = () => {
      this.startDemo(); UI.show('s-main');
      const m = /^#join=([A-Za-z0-9]{5})$/.exec(location.hash || '');
      if (m && Net.available()) { UI.show('s-online'); document.getElementById('join-code').value = m[1].toUpperCase(); this.joinRoom(m[1]); }
    };
    UI.loading(true, 'Загрузка…');
    const fontsReady = document.fonts && document.fonts.load ? Promise.race([Promise.all([document.fonts.load("20px 'Russo One'"), document.fonts.load("14px 'Rubik'")]), new Promise(r => setTimeout(r, 2500))]) : Promise.resolve();
    fontsReady.catch(() => { }).then(() => setTimeout(() => { UI.loading(false); go(); }, 30));
    requestAnimationFrame((t) => this.loop(t));
    setInterval(() => this.bgTick(), 40);
  },
  /* ---------- сцены ---------- */
  clearGame() {
    this.game = null; this.remote = null; this.sc = null; this.ais = []; this.ctl = null; this.fx.reset(null);
    UI.showHud(false); Sfx.stopAmbient(); Sfx.chargeStop(); this.paused = false; this.overShown = false; this.waitReady = 0; this.netEv = []; this.acc = 0;
    this.holstered = null;   // новый бой: убранное оружие прошлого боя забыто
  },
  setScene(sc) {
    Sfx.setScene(sc);
    sc.bg = new Background(sc.theme, sc.map.seed); this.sc = sc; this.fx.reset(sc); this.cam.reset(); this.ren.anim.clear(); this.ren.mini = null;
    if (!this.demo) Sfx.setAmbient(sc.theme.ambientSound);
  },
  startDemo() {
    this.clearGame(); this.mode = 'menu'; this.demo = true; this.myTeams = []; Sfx.setSilent(true);
    const map = MAP_BY_ID[this.prefs.settings.mapId] || MAPS[0];
    const cfg = { mapId: map.id, settings: { perTeam: 3, hp: 100, turnTime: 30, wind: true, crates: false, sd: 0, arsenal: 'all' }, teams: [DEFAULT_PREFS.teams[0], { name: 'Зелёные', color: '#3ecf5a', hat: 'cap' }] };
    try { const g = new Game(cfg); g.buildVisual(); this.game = g; this.setScene(g); this.ais = [new AI(g, 0, 'normal'), new AI(g, 1, 'hard')]; }
    catch (e) { console.error(e); }
  },
  launch(build, done) {
    UI.hideScreens(); UI.loading(true, 'Готовим поле боя…');
    this.clearGame(); this.demo = false; Sfx.setSilent(false);
    const go = () => {
      let g;
      try { g = build(); } catch (e) { console.error(e); UI.loading(false); UI.dialog('Ошибка при создании карты: ' + e.message, () => this.toMenu()); return; }
      UI.loading(false); done(g); UI.showHud(true);
      document.getElementById('chat').classList.toggle('hidden', !(this.mode === 'host' || this.mode === 'guest'));
    };
    // текстуры карт из Blender должны успеть загрузиться (не дольше 3 с)
    Promise.race([TexLib.load(), new Promise((r) => setTimeout(r, 3000))]).then(() => setTimeout(go, 40));
  },
  teamCfgs() { return UI.teamsCfg.map((t, i) => sanitizeTeam(t, DEFAULT_PREFS.teams[i])); },
  /** «В бой!»: бой идёт по набору на экране (UI.work); постоянные настройки игрока при этом не трогаются — их меняют
      только правки набора, связанного с основным (галочка «по умолчанию»), и кнопки конфигураций */
  startFromSetup() {
    const S = sanitizeSettings(UI.readSettings());
    if (UI.mode === 'guest') return;
    if (UI.mode === 'hotseat') S.simul = false;   // на одном экране ходят только по очереди
    S.swap = S.side === 'right' || (S.side === 'random' && Math.random() < 0.5);   // сторона первой команды: выбранная или случайная
    Keys.set(UI.work.keys);   // клавиши этого набора действуют в бою
    if (UI.mode === 'host') { if (!Net.connected) { UI.setNote('Друг ещё не подключился — отправьте ему код комнаты'); Sfx.play('denied'); return; } this.startHostGame(S); return; }
    const teams = this.teamCfgs();
    this.startLocal({ mapId: S.mapId, settings: S, teams }, UI.mode);
  },
  startLocal(cfg, kind) {
    this.lastCfg = cfg; this.lastLocalMode = kind;
    this.launch(() => { const g = new Game(cfg); g.buildVisual(); return g; }, (g) => {
      this.mode = kind; this.game = g; this.setScene(g);
      if (kind === 'cpu') { this.ais = [new AI(g, 1, cfg.settings.ai)]; this.myTeams = [0]; this.ctl = new LocalController((c) => g.cmd(0, c)); g.greenTeam = 0; }
      else { this.myTeams = [0, 1]; this.ctl = new LocalController((c) => g.cmd(g.turn.team, c)); g.greenTeam = Math.random() < 0.5 ? 0 : 1; }   // на одном экране зелёные достаются случайно
      this.ctl.myTeams = this.myTeams;
    });
  },
  /* ---------- сеть ---------- */
  bindNet() {
    Net.on('hosting', (code) => {
      UI.openSetup('host', { simul: UI.wantSimul }); UI.setRoomCode(code); UI.setPeerStatus(false);
      // приглашение: на ПК хоста — публичный адрес туннеля «Играть онлайн.cmd», иначе адрес этого сервера;
      // бесплатный адрес меняется примерно раз в 15 минут — пока друг не подключился, подсказка обновляется
      clearInterval(this.inviteT);
      const show = () => Net.fetchPublic().then(() => { if (Net.code === code && UI.mode === 'host' && UI.cur === 's-setup' && !Net.connected) UI.setNote(Net.inviteOk() ? `Код: ${code}. Ссылка для друга: ${Net.inviteLink(code)} — её можно открыть в браузере или вставить в файл игры.` : `Код: ${code}. Ссылки для друга ещё нет: запустите «Играть онлайн.cmd» — он создаст её (и скопирует), затем нажмите «Ссылка другу».`); });
      show(); this.inviteT = setInterval(() => { if (Net.code !== code || UI.mode !== 'host') { clearInterval(this.inviteT); return; } show(); }, 20000);
    });
    Net.on('connected', () => {
      if (Net.role === 'guest') { UI.status('Соединено! Ждём хоста…'); Net.send({ t: 'hello', v: NET_VERSION, team: Profile.base.teams[0] }); }
    });
    Net.on('data', (d) => { if (Net.role === 'host') this.onNetHost(d); else this.onNetGuest(d); });
    Net.on('error', (e) => this.onNetError(e));
    Net.on('closed', () => this.peerLeft('Соединение с другом потеряно.'));
    Net.on('stall', () => { if (this.sc && !this.demo) this.fx.banner('Связь с другом прерывается…', '#ffb347'); });
  },
  hostRoom() { UI.status('Создаём комнату…'); this.guestTeam = null; Net.host(); },
  joinRoom(code) { UI.status('Подключаемся…'); Net.join(code); },
  sendLobby() { if (Net.role === 'host' && Net.connected) Net.send({ t: 'lobby', settings: UI.settings, teams: UI.teamsCfg.map((t, i) => sanitizeTeam(t, DEFAULT_PREFS.teams[i])) }); },
  onLobbyChanged() { UI.workChanged(); if (UI.mode === 'host') this.sendLobby(); },
  onTeamEdited(i) {
    if (UI.mode === 'guest' && i === 1) { const t = sanitizeTeam(UI.teamsCfg[1], DEFAULT_PREFS.teams[0]); UI.work.teams[0] = Object.assign({}, t); Net.send({ t: 'team', team: t }); }
    UI.workChanged();
    if (UI.mode === 'host' && i === 0) this.sendLobby();
    UI.drawPreviewAll && UI.drawPreviewAll();
  },
  /** команда гостя не должна совпадать с командой хоста ни цветом, ни названием */
  distinctGuest(t) {
    const h = UI.teamsCfg[0];
    if (t.color === h.color) t.color = TEAM_COLORS.find(c => c !== h.color && c !== '#ff4d4d') || '#3d8bff';
    if (t.name.trim().toLowerCase() === String(h.name).trim().toLowerCase()) t.name = h.name === DEFAULT_PREFS.teams[1].name ? DEFAULT_PREFS.teams[0].name : DEFAULT_PREFS.teams[1].name;
    return t;
  },
  onNetHost(d) {
    switch (d.t) {
      case 'hello': {
        if (d.v !== NET_VERSION) { Net.send({ t: 'err', txt: 'У вас разные версии игры. Обновите файлы игры у обоих игроков.' }); setTimeout(() => Net.close(), 400); return; }
        let t = sanitizeTeam(d.team, DEFAULT_PREFS.teams[1]);
        t = this.distinctGuest(t);
        this.guestTeam = t; UI.teamsCfg[1] = Object.assign({}, t);
        if (UI.cur === 's-setup') UI.buildTeams();
        UI.setPeerStatus(true); Sfx.play('pickup'); UI.setNote('Друг в комнате! Выберите карту и жмите «В бой!»'); this.sendLobby();
        break;
      }
      case 'team': {
        const t = this.distinctGuest(sanitizeTeam(d.team, DEFAULT_PREFS.teams[1]));
        this.guestTeam = t; if (this.demo || !this.game) { UI.teamsCfg[1] = Object.assign({}, t); if (UI.cur === 's-setup') UI.buildTeams(); this.sendLobby(); }
        break;
      }
      case 'c': if (this.game && this.mode === 'host' && d.c && typeof d.c === 'object') this.game.cmd(1, d.c); break;
      case 'ready': this.waitReady = 0; break;
      case 'chat': this.chat(1, d.txt); break;
      case 'rematch': document.getElementById('over-note').textContent = 'Друг хочет реванш!'; Sfx.play('pickup'); break;
      case 'bye': this.peerLeft('Друг вышел из игры.'); break;
    }
  },
  onNetGuest(d) {
    switch (d.t) {
      case 'lobby': {
        const S = sanitizeSettings(d.settings); const teams = Array.isArray(d.teams) ? d.teams.slice(0, 2).map((t, i) => sanitizeTeam(t, DEFAULT_PREFS.teams[i])) : null;
        if (!teams || teams.length < 2) return;
        if (!this.demo && (this.game || this.remote)) { this.clearGame(); this.startDemo(); }
        if (UI.cur !== 's-setup' || UI.mode !== 'guest') { UI.openSetup('guest'); UI.setRoomCode(Net.code); UI.setPeerStatus(true, '● подключено к хосту'); }
        // бой настраивает хост: его настройки — временный набор этого боя; свои настройки гостя не трогаются
        UI.work.settings = S; UI.settings = S; UI.applySettings(S); UI.markMap();
        UI.teamsCfg = teams; UI.buildTeams(); UI.refreshCfgBar();
        break;
      }
      case 'start': this.startGuestGame(d); break;
      case 's': if (this.remote) this.remote.onSnap(d); break;
      case 'chat': this.chat(0, d.txt); break;
      case 'full': UI.status('Комната уже занята другим игроком.', true); Net.close(); break;
      case 'err': UI.dialog(String(d.txt || 'Ошибка').slice(0, 200)); Net.close(); break;
      case 'bye': this.peerLeft('Хост вышел из игры.'); break;
    }
  },
  startHostGame(S) {
    const teams = [sanitizeTeam(UI.teamsCfg[0], DEFAULT_PREFS.teams[0]), sanitizeTeam(this.guestTeam || UI.teamsCfg[1], DEFAULT_PREFS.teams[1])];
    const cfg = { mapId: S.mapId, settings: S, teams };
    this.launch(() => { const g = new Game(cfg); g.buildVisual(); return g; }, (g) => {
      this.mode = 'host'; this.game = g; g.greenTeam = 0; this.setScene(g); this.myTeams = [0];
      this.ctl = new LocalController((c) => g.cmd(0, c)); this.ctl.myTeams = [0];
      this.waitReady = 30; this.snapAcc = 0; this.teamsAcc = 0; this.netEv = [];
      Net.sendBig(Object.assign({ t: 'start', you: 1, v: NET_VERSION }, g.startInfo()));
    });
  },
  startGuestGame(d) {
    if (!d || !MAP_BY_ID[d.mapId] || !Array.isArray(d.soldiers) || !Array.isArray(d.teams)) { UI.dialog('Получены неверные данные от хоста.'); return; }
    const start = {
      mapId: d.mapId, settings: sanitizeSettings(d.settings),
      teams: d.teams.slice(0, 2).map((t, i) => sanitizeTeam(t, DEFAULT_PREFS.teams[i])),
      soldiers: d.soldiers.filter(a => Array.isArray(a) && isNum(a[0]) && isNum(a[1]) && isNum(a[3]) && isNum(a[4])).slice(0, 24).map(a => [a[0] | 0, clamp(a[1] | 0, 0, 1), String(a[2]).slice(0, 16), +a[3], +a[4], clamp(a[5] | 0, 1, 999)]),
    };
    this.launch(() => { const r = new RemoteGame(start); r.buildVisual(); return r; }, (r) => {
      this.mode = 'guest'; this.remote = r; r.greenTeam = 1; this.setScene(r); this.myTeams = [1];
      this.ctl = new LocalController((c) => Net.send({ t: 'c', c })); this.ctl.myTeams = [1];
      Net.send({ t: 'ready' });
    });
  },
  onNetError(e) {
    const msg = Net.errorText(e);
    if (UI.cur === 's-online') UI.status(msg, true);
    else if (this.mode === 'host' || this.mode === 'guest' || UI.cur === 's-setup') { if (!Net.connected) UI.dialog(msg, () => { Net.close(); this.toMenu(); }); }
  },
  peerLeft(msg) {
    const inRoom = this.mode === 'host' || this.mode === 'guest' || (UI.cur === 's-setup' && (UI.mode === 'host' || UI.mode === 'guest')) || UI.cur === 's-over';
    if (!inRoom) { Net.close(); return; }
    if (UI.mode === 'host' && this.demo && UI.cur === 's-setup') { this.guestTeam = null; UI.setPeerStatus(false, '○ друг отключился — ждём, пока он вернётся…'); return; }
    Net.close(); UI.dialog(msg, () => this.toMenu());
  },
  chat(teamIdx, txt) {
    txt = String(txt || '').replace(/[\u0000-\u001f]/g, '').slice(0, 120); if (!txt) return;
    const tm = this.sc ? this.sc.teams[teamIdx] : UI.teamsCfg[teamIdx]; if (!tm) return;
    document.getElementById('chat').classList.remove('hidden');
    UI.chatLine(tm.name, tm.color, txt); Sfx.play('select');
  },
  sendChat(txt) { txt = txt.slice(0, 120); if (Net.connected) Net.send({ t: 'chat', txt }); this.chat(this.myTeams[0] ?? 0, txt); },
  /* ---------- навигация ---------- */
  back() {
    if (UI.cur === 's-setup' && (UI.mode === 'host' || UI.mode === 'guest')) { if (Net.connected) Net.send({ t: 'bye' }); Net.close(); UI.show('s-online'); UI.status(''); return; }
    if (UI.cur === 's-online') Net.close();
    UI.show('s-main');
  },
  toMenu() { Net.close(); this.clearGame(); UI.hideScreens(); this.mode = 'menu'; this.startDemo(); UI.show('s-main'); },
  /** вернулись к выбору режима: временный набор боя забыт, действуют постоянные настройки игрока */
  leftToMain() { UI.work = null; Profile.forgetPrev(); Profile.applyDevice(Profile.base); },
  quitToMenu() { if (Net.connected) Net.send({ t: 'bye' }); this.toMenu(); },
  togglePause() {
    if (!this.sc || this.demo) return;
    if (UI.cur === 's-pause') this.resume();
    else if (!UI.cur) { UI.show('s-pause'); UI.updateSoundIcon(); if (this.mode === 'hotseat' || this.mode === 'cpu') this.paused = true; if (this.ctl) this.ctl.suspend(); }
  },
  resume() { UI.hideScreens(); this.paused = false; },
  rematch() {
    if (this.mode === 'guest') { Net.send({ t: 'rematch' }); document.getElementById('over-note').textContent = 'Запрос на реванш отправлен хосту'; return; }
    if (this.mode === 'host') {
      if (!Net.connected) { this.toMenu(); return; }
      const code = Net.code; this.clearGame(); this.startDemo(); UI.openSetup('host', { keep: true }); UI.setRoomCode(code); UI.setPeerStatus(true);   // реванш — тот же набор боя
      UI.teamsCfg[1] = Object.assign({}, this.guestTeam || UI.teamsCfg[1]); UI.buildTeams(); this.sendLobby(); return;
    }
    if (this.lastCfg) this.startLocal(this.lastCfg, this.lastLocalMode);
  },
  toggleTray() { if (!this.sc || this.demo || UI.cur) return; UI.setTray(!UI.trayOpen); },
  onTurnEv(ev) {
    if (this.demo) return;
    if (this.sc && this.sc.simul && !this.myTeams.includes(ev.team)) return;   // одновременные ходы: ход соперника не трогает мой обзор
    UI.setTray(false); this.cam.free = 0;
    if (!(Input.drag && Input.drag.binoc)) this.cam.binoc = false;
    const sc = this.sc; const tm = sc.teams[ev.team]; const s = sc.soldiers.find(o => o.id === ev.sid);
    if (tm) this.fx.banner(`Ход: боец №${s ? s.name : ''} («${tm.name}»)`, tm.color, this.myTeams.length > 1, 1.8);
  },
  onOver(ev) {
    if (this.demo) { setTimeout(() => { if (this.demo && this.mode === 'menu') this.startDemo(); }, 3500); return; }
    if (this.overShown) return; this.overShown = true;
    setTimeout(() => { if (!this.sc || this.demo) return; UI.setTray(false); Sfx.play('victory'); UI.showOver(ev, this.sc, this.myTeams, true); }, 1700);
  },
  handleKeys() {
    if (Keys.hit('holster')) {
      const ctl = this.ctl, T = this.sc && this.sc.turn;
      if (UI.trayOpen) UI.setTray(false);
      else if (UI.cur === 's-help' || UI.cur === 's-online') this.back();
      else if (UI.cur === 's-pause') this.resume();
      // Esc в бою только убирает оружие из рук (зарядку, цель), повторный Esc возвращает убранное. Мышь он не отпускает
      // (это Delete), меню открывается только Backspace
      else if (!UI.cur && ctl && ctl.mine && T && T.phase === 'aim' && T.shots === 0) {
        const key = T.round + ':' + T.sid;
        if (T.weapon) { this.holstered = { key, id: T.weapon }; ctl.cancelCharge(); ctl.pendingTarget = false; ctl.send({ c: 'holster' }); Sfx.play('denied'); }
        else if (this.holstered && this.holstered.key === key) ctl.select(this.holstered.id);
      }
    }
    if (Keys.hit('menu')) this.togglePause();   // меню; заодно отпускает мышь
    // Tab: сначала отменяет взятое оружие (зарядку или выбранную точку), иначе открывает арсенал
    if (Keys.hit('tray')) {
      const ctl = this.ctl, T = this.sc && this.sc.turn;
      if (ctl && ctl.charging) { ctl.cancelCharge(); Sfx.play('denied'); }
      else if (ctl && ctl.mine && T && T.target && T.phase === 'aim') { ctl.send({ c: 'untarget' }); ctl.pendingTarget = false; Sfx.play('denied'); }
      else this.toggleTray();
    }
    if (Keys.hit('sound')) { Sfx.toggle(); UI.updateSoundIcon(); this.soundChanged(); }
    if (!this.sc || this.demo) return;
    if (Keys.hit('binoc')) { this.cam.binoc = !this.cam.binoc; if (this.cam.binoc) UI.setTray(false); else this.cam.free = 0; }
    if (Keys.hit('camera')) { this.cam.binoc = false; this.cam.free = 0; this.cam.userZ = null; this.cam.hold = false; }
    if (Keys.hit('chat') && (this.mode === 'host' || this.mode === 'guest') && !UI.chatOpen) UI.openChat();
  },
  timerTick(turn) {
    if (!this.ctl || !this.ctl.mine || turn.phase !== 'aim' || !(this.sc.settings || this.sc.cfg.settings).turnTime) { this.lastTick = -1; return; }
    const s = Math.ceil(turn.time);
    if (s <= 5 && s > 0 && s !== this.lastTick) { this.lastTick = s; Sfx.play('tick'); }
  },
  /* ---------- цикл ---------- */
  runSim(dt) {
    if (this.mode === 'host' && this.waitReady > 0) { this.waitReady -= dt; this.lastSim = performance.now(); return; }
    this.acc += dt; let n = 0;
    while (this.acc >= DT && n < 6) { this.simStep(DT); this.acc -= DT; n++; }
    if (n >= 6) this.acc = 0;
    this.lastSim = performance.now();
  },
  simStep(dt) {
    const g = this.game;
    for (const o of g.entities) { o.px = o.x; o.py = o.y; } for (const o of g.soldiers) { o.px = o.x; o.py = o.y; }   // для плавной отрисовки между шагами
    for (const ai of this.ais) ai.update(dt);
    g.step(dt);
    if (g.events.length) {
      const evs = g.events; g.events = [];
      for (const ev of evs) { try { this.fx.handle(ev, g, true); } catch (e) { console.warn(e); } }
      if (this.mode === 'host') for (const ev of evs) this.netEv.push(ev);
    }
    if (this.mode === 'host') { this.snapAcc += dt; this.teamsAcc += dt; if (this.snapAcc >= 1 / 30 - 1e-6) { this.snapAcc = 0; this.sendSnap(); } }
  },
  sendSnap() {
    const g = this.game; const m = g.snapshot(); m.V = this.netEv; this.netEv = [];
    if (g.teamsDirty || this.teamsAcc > 1) { m.TM = g.teamsSnap(); g.teamsDirty = false; this.teamsAcc = 0; }
    Net.send(m);
  },
  bgTick() {
    if (!document.hidden || this.mode !== 'host' || !this.game) return;
    const now = performance.now(); const dt = Math.min(0.25, (now - (this.lastSim || now)) / 1000);
    if (dt > 0.02) this.runSim(dt);
  },
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)); this.last = now; this.t += dt;
    this.handleKeys();
    const sc = this.sc; const sw = this.ren.sw, sh = this.ren.sh;
    if (!sc) { const c = this.ren.c; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#0b0f16'; c.fillRect(0, 0, this.cv.width, this.cv.height); Input.endFrame(); return; }
    if (this.game && !this.paused && !this.demo) this.runSim(dt);
    if (this.remote) this.remote.update(dt, this.fx);
    const turn = this.remote ? this.remote.latestTurn : sc.turn;
    if (this.ctl) this.ctl.binoc = this.cam.binoc;
    Input.binocOn = this.cam.binoc;
    // мышь в бою захвачена игрой: не видна и не уходит за край; меню, пауза, панель оружия и чат её отпускают
    Input.wantLock = !!(this.sc && !this.demo && !UI.cur && !UI.trayOpen && !UI.chatOpen && !document.hidden);
    if (!Input.wantLock) Input.unlock(); else if (!Input.locked) Input.lock();
    if (this.ctl && !document.hidden && !this.paused && !UI.chatOpen && !UI.cur) this.ctl.update(dt, sc, this.cam, sw, sh, turn); else if (this.ctl) this.ctl.suspend();
    this.fx.update(this.paused ? 0 : dt, sc, this.cam, sw, sh);
    { const cur = !this.demo && !UI.cur && !this.paused ? 'none' : 'default'; if (this.cv.style.cursor !== cur) this.cv.style.cursor = cur; }   // в бою курсора не видно
    // плавность: симуляция идёт шагами по 1/60 с, а кадры экрана — чаще или неровно; рисуем положение между двумя шагами
    const lerpK = this.game && !this.paused && !this.demo ? clamp(this.acc / DT, 0, 1) : 1, moved = [];
    if (lerpK < 1) for (const o of [...sc.entities, ...sc.soldiers]) {
      if (o.px === undefined || Math.abs(o.x - o.px) > 60 || Math.abs(o.y - o.py) > 60) continue;
      moved.push(o, o.x, o.y); o.x = o.px + (o.x - o.px) * lerpK; o.y = o.py + (o.y - o.py) * lerpK;
    }
    // прокрутка обзора курсором у края — только в свой ход с оружием, которому выбирают точку на карте
    this.cam.edge = !!(this.ctl && this.ctl.mine && this.ctl.edgePan && !this.demo && !this.paused && !UI.cur && !UI.chatOpen && !UI.trayOpen && !document.hidden);
    this.cam.update(dt, sc, this.fx, sw, sh, Input.mouse);
    sc.bg.update(dt, sc.turn.wind, sw);
    Sfx.setListener(this.cam.x, this.cam.y, this.cam.z, sw);
    this.timerTick(turn);
    this.ren.draw(sc, this.cam, this.fx, this.ctl, this.t, dt);
    if (!this.demo) {
      this.ren.drawOverlay(sc, this.cam, this.ctl, this.t);
      this.ren.drawHUD(sc, this.cam, this.ctl, this.t, (this.mode === 'host' || this.mode === 'guest') ? { ping: Net.rtt } : null);
    }
    this.fx.drawScreen(this.ren.c, sc, this.cam, sw, sh);
    for (let i = 0; i < moved.length; i += 3) { moved[i].x = moved[i + 1]; moved[i].y = moved[i + 2]; }
    if (this.waitReady > 0) { const c = this.ren.c; c.save(); c.font = `22px ${FONT_TITLE}`; c.textAlign = 'center'; textOutlined(c, 'Ждём, пока друг загрузит карту…', sw / 2, sh / 2, '#fff', 'rgba(0,0,0,0.85)', 6); c.restore(); }
    UI.updateTray(sc, turn, this.ctl);
    Input.endFrame();
  },
};
window.addEventListener('load', () => App.init());
