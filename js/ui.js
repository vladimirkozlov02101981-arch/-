'use strict';
/* =========================================================
   Интерфейс: меню, лобби, настройки, панель оружия, чат
   ========================================================= */
const $ = (id) => document.getElementById(id);
const UI = {
  app: null, cur: null, mode: 'hotseat', teamsCfg: null, settings: null, trayOpen: false, traySig: '', chatOpen: false,
  /* набор настроек на экране настройки боя: work — копия; workSrc — откуда он ('base' — основной, иначе id конфигурации);
     linked — набор связан с основным (галочка «по умолчанию»): правки сразу сохраняются в основной. В своих режимах
     (против компьютера, на одном экране) основной открывается связанным, в комнате по сети — временным */
  work: null, workSrc: 'base', linked: false, wantSimul: false, keyWait: null,
  init(app) {
    this.app = app;
    $('volume').value=Math.round(Sfx.volume*100);$('volume').addEventListener('input',e=>{Sfx.setVolume(+e.target.value/100);this.app.soundChanged();});
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      Sfx.resume(); Sfx.play('click'); this.act(b.dataset.act, b);
    });
    $('dialog-ok').addEventListener('click', () => { $('dialog').classList.add('hidden'); if (this.dialogCb) { const f = this.dialogCb; this.dialogCb = null; f(); } });
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.act('join'); });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    // вставили в поле кода всю ссылку-приглашение — берём из неё код (а для файла игры и сервер)
    $('join-code').addEventListener('paste', (e) => { const t = (e.clipboardData || window.clipboardData).getData('text') || ''; if (!/#join=/.test(t)) return; e.preventDefault(); const c = Net.useLink(t); if (c) e.target.value = c; if (Net.fromFile()) $('srv-link').value = t.trim(); });
    for (const id of ['o-perTeam', 'o-hp', 'o-turnTime', 'o-wind', 'o-ai', 'o-side', 'o-walk', 'o-simul']) $(id).addEventListener('change', () => this.onSettingsChanged());
    $('cfg-select').addEventListener('change', (e) => this.selectConfig(e.target.value));
    $('cfg-default').addEventListener('change', (e) => this.setDefaultChecked(e.target.checked));
    $('cfg-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.act('cfg-name-ok'); e.preventDefault(); } else if (e.key === 'Escape') { this.act('cfg-name-cancel'); e.preventDefault(); } e.stopPropagation(); });
    // назначение клавиши: следующее нажатие (любая физическая клавиша) становится клавишей действия
    window.addEventListener('keydown', (e) => { if (this.keyWait) { e.preventDefault(); e.stopImmediatePropagation(); this.assignKey(e.code); } }, true);
    $('o-turnTime').addEventListener('input', () => this.onSettingsChanged());
    $('o-turnInf').addEventListener('change', () => { this.syncTurnInf(); this.onSettingsChanged(); });
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
      case 'online': this.wantSimul = false; if (!Net.available()) { this.dialog('Игра с другом по сети работает через сервер: запустите «Играть онлайн.cmd» из папки игры. В этом файле доступны «Против компьютера» и «На одном экране».'); return; } this.show('s-online'); this.status(''); this.syncServerBox(); break;
      case 'map-prev': case 'map-next': { const i = MAPS.findIndex(m => m.id === app.prefs.settings.mapId); this.featureMap(MAPS[(i + (a === 'map-next' ? 1 : -1) + MAPS.length) % MAPS.length].id); break; }
      // адрес бесплатного туннеля меняется примерно раз в 15 минут (начатая партия при этом не рвётся) — ссылку берём свежую в момент нажатия
      case 'invite': Net.fetchPublic().then(() => { if (!Net.inviteOk()) { this.setNote('Ссылки для друга ещё нет: запустите «Играть онлайн.cmd» — он создаст её и скопирует. Потом нажмите «Ссылка другу» ещё раз.'); return; } const link = Net.inviteLink(Net.code); if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => this.setNote('Приглашение скопировано — отправьте другу: ' + link), () => this.setNote(link)); else this.setNote(link); }); break;
      case 'hotseat': this.openSetup('hotseat'); break;
      case 'cpu': this.openSetup('cpu'); break;
      // «Непрерывный бой»: обе команды ходят одновременно — против компьютера и по сети с другом
      case 'cpu-simul': this.openSetup('cpu', { simul: true }); break;
      case 'online-simul': this.wantSimul = true; this.act('online'); this.wantSimul = true; break;
      case 'cfg-new': this.askName('new'); break;
      case 'cfg-rename': if (Profile.config(this.workSrc)) this.askName('rename', Profile.config(this.workSrc).name); break;
      case 'cfg-name-ok': this.nameDone(); break;
      case 'cfg-name-cancel': $('cfg-name-box').classList.add('hidden'); this.nameMode = null; break;
      case 'cfg-save': if (Profile.saveConfig(this.workSrc, this.work)) { this.cfgNote('Сохранено в «' + Profile.config(this.workSrc).name + '»'); if (this.linked) Profile.setBase(this.work); this.refreshCfgBar(); } break;
      case 'cfg-del': {
        const c = Profile.config(this.workSrc); if (!c) break;
        if (this.delArm !== c.id) { this.delArm = c.id; this.cfgNote('Нажмите «Удалить» ещё раз, чтобы удалить «' + c.name + '»'); setTimeout(() => { if (this.delArm === c.id) this.delArm = null; }, 4000); break; }
        this.delArm = null; Profile.deleteConfig(c.id); this.workSrc = 'base'; this.cfgNote('Конфигурация «' + c.name + '» удалена'); this.refreshCfgBar(); break;
      }
      case 'keys-reset': this.work.keys = sanitizeKeys(null); Keys.set(this.work.keys); this.buildKeys(); this.workChanged(); break;
      case 'help': this.show('s-help'); break;
      case 'back': app.back(); break;
      case 'sound': case 'sound2': Sfx.toggle(); this.updateSoundIcon(); this.app.soundChanged(); break;
      case 'host': if (Net.fromFile() && this.takeServerLink() === null) return; app.hostRoom(); break;
      case 'join': {
        let code = $('join-code').value.trim();
        if (Net.fromFile()) { const c = this.takeServerLink(); if (c === null) return; if (c) { code = c; $('join-code').value = c; } }
        if (code.length < 5) { this.status('Введите код из 5 символов', true); return; } app.joinRoom(code); break;
      }
      case 'copy': { const code = $('room-code').textContent; const done = () => this.setNote('Код скопирован — отправьте его другу'); if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => this.setNote('Скопируйте код вручную: ' + code)); else this.setNote('Код: ' + code); break; }
      case 'start': app.startFromSetup(); break;
      case 'resume': app.resume(); break;
      case 'pause': app.togglePause(); break;
      case 'quit': app.quitToMenu(); break;
      case 'rematch': app.rematch(); break;
      case 'tray': app.toggleTray(); break;
    }
  },
  /** файл игры: поле «Ссылка от друга» — сервер для игры по сети (запоминается) */
  syncServerBox() {
    const f = Net.fromFile(); $('srv-box').classList.toggle('hidden', true);
    if (!f) return;
    // на ПК хоста (запущен «Играть онлайн.cmd») файл сам находит свой сервер — поле со ссылкой не нужно
    Net.probeLocal().then((local) => {
      if (this.cur !== 's-online') return;
      if (local) { this.status('Найден сервер «Играть онлайн» на этом ПК: создавайте комнату, ссылку для друга даст «Ссылка другу».'); return; }
      $('srv-box').classList.remove('hidden'); if (!$('srv-link').value) $('srv-link').value = Net.serverBase() || '';
    });
  },
  /** код комнаты из ссылки ('' — в ссылке кода нет), null — ссылки нет или она неверная */
  takeServerLink() {
    const v = $('srv-link').value.trim();
    if (!v) { if (Net.serverBase()) return ''; this.status('Вставьте ссылку от друга (https://…)', true); return null; }
    const c = Net.useLink(v); if (c === null) { this.status('Это не похоже на ссылку: нужна строка вида https://….lhr.life/#join=КОД', true); return null; }
    return c;
  },
  show(id) {
    // вернулись к выбору режима — временный набор боя и возможность вернуть прежний основной забываются
    if (id === 's-main' && this.cur !== 's-main' && this.app && this.app.leftToMain) this.app.leftToMain();
    if (id === 's-main') this.wantSimul = false;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('show', s.id === id));
    this.cur = id;
    if (id === 's-help') this.buildHelpKeys();
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
  openSetup(mode, opts = {}) {
    this.mode = mode;
    // реванш в комнате — прежний набор боя остаётся; иначе — копия основного набора игрока
    if (!(opts.keep && this.work)) {
      this.work = snapCopy(Profile.base); this.workSrc = Profile.data.defaultId || 'base'; this.linked = mode === 'cpu' || mode === 'hotseat';
      this.work.settings.simul = !!opts.simul && mode !== 'hotseat';   // вход из «Непрерывный бой» — одновременные ходы
    }
    this.bindWork(!!opts.keep);
    this.applySettings(this.settings);
    $('setup-title').textContent = mode === 'cpu' ? 'Бой против компьютера' : mode === 'hotseat' ? 'Бой вдвоём на одном компьютере' : mode === 'host' ? 'Комната: вы — хост' : 'Комната друга';
    $('room-box').classList.toggle('hidden', !(mode === 'host' || mode === 'guest'));
    $('o-ai-wrap').classList.toggle('hidden', mode !== 'cpu');
    $('o-simul-wrap').classList.toggle('hidden', mode === 'hotseat');   // на одном экране — только по очереди
    const guest = mode === 'guest';
    document.querySelectorAll('#opts select, #opts input, #ammo-box input, #ammo-box button').forEach(s => { s.disabled = guest; }); this.syncTurnInf();
    $('btn-start').classList.toggle('hidden', guest);
    this.setNote(guest ? 'Хост выбирает карту и настройки. Вы можете настроить свою команду.' : mode === 'host' ? 'Отправьте код другу. Когда он подключится — жмите «В бой!»' : '');
    this.buildTeams(); this.markMap(); this.buildKeys(); this.refreshCfgBar(); this.show('s-setup');
    Keys.set(this.work.keys);
    if (mode === 'host' || mode === 'guest') this.cfgNote('Настройки этого боя временные: после боя у вас и у друга остаются свои. Сохранить их можно кнопками выше.');
    if (mode === 'host' && !opts.keep) this.setPeerStatus(false);
  },
  /** команды на экране — объекты набора (правки сразу в work); чужая команда в комнате — временная */
  bindWork(keepOthers = true) {
    const w = this.work, m = this.mode, prev = keepOthers ? this.teamsCfg || [] : [];
    this.settings = w.settings;
    if (m === 'cpu') this.teamsCfg = [w.teams[0], w.bot];   // окрас и снаряжение бота настраиваются отдельно
    else if (m === 'hotseat') this.teamsCfg = [w.teams[0], w.teams[1]];
    else if (m === 'host') this.teamsCfg = [w.teams[0], prev[1] && this.boundMode === 'host' ? prev[1] : Object.assign({}, DEFAULT_PREFS.teams[1])];
    else this.teamsCfg = [prev[0] && this.boundMode === 'guest' ? prev[0] : Object.assign({}, DEFAULT_PREFS.teams[0]), Object.assign({}, w.teams[0])];
    this.boundMode = m;
  },
  /** любая правка набора на экране: связанный с основным — сразу в основной; конфигурация — помечается изменённой */
  workChanged() {
    if (!this.work) return;
    if (this.linked) Profile.setBase(this.work);
    this.refreshCfgBar();
  },
  cfgNote(t) { $('cfg-note').textContent = t || ''; },
  /** список конфигураций и состояние кнопок; ★ — основной набор */
  refreshCfgBar() {
    if (!this.work) return;
    const sel = $('cfg-select'), def = Profile.data.defaultId; sel.innerHTML = '';
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    add('base', 'Основные настройки' + (def ? '' : ' ★'));
    for (const c of Profile.data.configs) add(c.id, c.name + (c.id === def ? ' ★' : ''));
    if (!Profile.config(this.workSrc)) this.workSrc = 'base';
    sel.value = this.workSrc;
    const isCfg = this.workSrc !== 'base';
    $('cfg-default').checked = !!this.linked;
    document.querySelector('[data-act="cfg-save"]').disabled = !isCfg;
    document.querySelector('[data-act="cfg-rename"]').disabled = !isCfg;
    document.querySelector('[data-act="cfg-del"]').disabled = !isCfg;
  },
  /** выбрать конфигурацию для боя: её настройки становятся набором на экране (у гостя бой по-прежнему настраивает хост) */
  selectConfig(id) {
    const src = id === 'base' ? Profile.base : Profile.config(id) && Profile.config(id).data; if (!src) return;
    const w = snapCopy(src);
    if (this.mode === 'guest') w.settings = this.work.settings;
    w.settings.simul = this.mode !== 'hotseat' && !!this.work.settings.simul;   // режим ходов задаёт вход в бой
    this.work = w; this.workSrc = id;
    this.linked = (this.mode === 'cpu' || this.mode === 'hotseat') && (id === 'base' || id === Profile.data.defaultId);
    this.bindWork(); this.applySettings(this.settings); this.buildTeams(); this.markMap(); this.buildKeys();
    Keys.set(w.keys); Sfx.apply && Sfx.apply(w.sound); this.updateSoundIcon(); $('volume').value = Math.round(Sfx.volume * 100);
    if (this.mode === 'guest') this.app.onTeamEdited(1); else if (this.mode === 'host') this.app.sendLobby();
    this.refreshCfgBar(); this.cfgNote(id === 'base' ? 'Основные настройки' : 'Конфигурация «' + Profile.config(id).name + '»');
  },
  /** галочка «Использовать по умолчанию»: набор на экране становится основным; снята — возвращается прежний основной */
  setDefaultChecked(on) {
    if (!this.work) return;
    if (on) { Profile.makeDefault(this.work, this.workSrc !== 'base' ? this.workSrc : null); this.linked = true; this.cfgNote('Эти настройки теперь основные: загрузятся при запуске и в новых боях'); }
    else {
      this.linked = false;
      this.cfgNote(Profile.undoDefault() ? 'Возвращены прежние основные настройки' : 'Набор больше не сохраняется в основные: правки — только для этого боя');
    }
    this.refreshCfgBar();
  },
  askName(mode, value = '') { this.nameMode = mode; $('cfg-name-box').classList.remove('hidden'); const i = $('cfg-name'); i.value = value; i.focus(); i.select(); },
  nameDone() {
    const name = $('cfg-name').value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 28);
    if (!name) { $('cfg-name').focus(); return; }
    $('cfg-name-box').classList.add('hidden');
    if (this.nameMode === 'rename') { Profile.renameConfig(this.workSrc, name); this.cfgNote('Переименовано: «' + name + '»'); }
    else {
      const wasLinked = this.linked;
      this.workSrc = Profile.createConfig(name, this.work);
      if (wasLinked) Profile.setBase(this.work, this.workSrc);   // основной набор теперь — эта конфигурация
      this.cfgNote('Создана конфигурация «' + name + '»');
    }
    this.nameMode = null; this.refreshCfgBar();
  },
  /* ---------- клавиши управления ---------- */
  buildKeys() {
    const g = $('keys-grid'); if (!g || !this.work) return; g.innerHTML = '';
    const K = this.work.keys;
    for (const [id, title] of KEY_ACTIONS) {
      const row = document.createElement('div'); row.className = 'key-row';
      const t = document.createElement('span'); t.className = 'key-act'; t.textContent = title; row.appendChild(t);
      (K[id] || []).forEach((code, i) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'key-chip' + (this.keyWait && this.keyWait.id === id && this.keyWait.i === i ? ' wait' : '');
        b.textContent = this.keyWait && this.keyWait.id === id && this.keyWait.i === i ? 'нажмите клавишу…' : keyLabel(code);
        b.title = 'Щёлкните и нажмите новую клавишу';
        b.addEventListener('click', (e) => { if (e.target.classList.contains('x')) return; this.keyWait = { id, i }; this.buildKeys(); });
        const x = document.createElement('span'); x.className = 'x'; x.textContent = '✕'; x.title = 'Убрать эту клавишу';
        x.addEventListener('click', (e) => { e.stopPropagation(); K[id].splice(i, 1); this.keyWait = null; Keys.set(K); this.buildKeys(); this.workChanged(); });
        b.appendChild(x); row.appendChild(b);
      });
      if ((K[id] || []).length < 3) {
        const add = document.createElement('button'); add.type = 'button'; add.className = 'key-add' + (this.keyWait && this.keyWait.id === id && this.keyWait.i === -1 ? ' wait' : '');
        add.textContent = this.keyWait && this.keyWait.id === id && this.keyWait.i === -1 ? 'нажмите клавишу…' : '+'; add.title = 'Добавить ещё одну клавишу';
        add.addEventListener('click', () => { this.keyWait = { id, i: -1 }; this.buildKeys(); });
        row.appendChild(add);
      }
      g.appendChild(row);
    }
  },
  /** нажатая клавиша назначается действию; если она была у другого действия — там снимается (одна клавиша — одно действие) */
  assignKey(code) {
    const w = this.keyWait; this.keyWait = null; if (!w || !this.work) return;
    const K = this.work.keys; let moved = '';
    for (const [id, title] of KEY_ACTIONS) { const L = K[id] || []; const j = L.indexOf(code); if (j >= 0 && id !== w.id) { L.splice(j, 1); moved = title; } }
    const L = K[w.id] || (K[w.id] = []);
    if (w.i >= 0 && w.i < L.length) L[w.i] = code; else if (!L.includes(code)) L.push(code);
    Keys.set(K); this.buildKeys(); this.workChanged();
    $('keys-note').textContent = keyLabel(code) + (moved ? ` — снята с «${moved}»` : ' назначена');
  },
  setRoomCode(code) { $('room-code').textContent = code; },
  setPeerStatus(ok, txt) { const s = $('peer-status'); s.textContent = txt || (ok ? '● друг подключился' : '○ ждём друга…'); s.classList.toggle('ok', !!ok); },
  readSettings() {
    const S = this.settings;
    S.walk = $('o-walk').value === 'free' ? 'free' : 'limited'; S.simul = this.mode !== 'hotseat' && $('o-simul').value === '1';
    S.perTeam = +$('o-perTeam').value; { const hp = Math.round(+$('o-hp').value); if (Number.isFinite(hp) && hp >= 1) S.hp = Math.min(1000, hp); } S.wind = $('o-wind').value === '1'; S.side = $('o-side').value;
    // время хода: 0 — без ограничения (ход длится до выстрела или пропуска)
    const tt = Math.round(+$('o-turnTime').value);
    if ($('o-turnInf').checked) S.turnTime = 0;
    else if (Number.isFinite(tt) && tt >= 5) S.turnTime = Math.min(600, tt);
    else if (!(S.turnTime > 0)) S.turnTime = 45;
    S.crates = false; S.sd = 0; S.arsenal = $('o-arsenal').value; S.ai = $('o-ai').value;
    S.ammo = this.readAmmo();
    return S;
  },
  /** «без лимита» выключает поле секунд (у гостя настройки и так недоступны) */
  syncTurnInf() { $('o-turnTime').disabled = this.mode === 'guest' || $('o-turnInf').checked; },
  applySettings(S) {
    const inf = !(S.turnTime > 0); $('o-turnInf').checked = inf; if (!inf || !$('o-turnTime').value) $('o-turnTime').value = String(inf ? 45 : S.turnTime); this.syncTurnInf();
    $('o-perTeam').value = String(S.perTeam); $('o-hp').value = String(S.hp); $('o-wind').value = S.wind ? '1' : '0';
    $('o-arsenal').value = S.arsenal; $('o-ai').value = S.ai || 'normal'; $('o-side').value = S.side || 'random';
    $('o-walk').value = S.walk === 'free' ? 'free' : 'limited'; $('o-simul').value = S.simul ? '1' : '0';
    this.fillAmmo(S.ammo || makeAmmo(S.arsenal));
  },
  /** редактор атак: галочка — оружие есть в бою, число — сколько раз его можно применить (пусто — без ограничения) */
  buildAmmo() {
    const g = $('ammo-grid'); g.innerHTML = '';
    // по классам (как в панели оружия в бою); под названием — что делает оружие
    for (let ci = 0; ci < WEAPON_CATS.length; ci++) {
      const list = WEAPONS.filter(w => w.cat === ci); if (!list.length) continue;
      const head = document.createElement('div'); head.className = 'ammo-cat'; head.textContent = `${WEAPON_CATS[ci]} · ${list.length}`; g.appendChild(head);
      for (const w of list) this.ammoRow(g, w);
    }
  },
  /** строка редактора атак: галочка, название, количество и описание того, что делает оружие */
  ammoRow(g, w) {
    const row = document.createElement('label'); row.className = 'ammo-row'; row.dataset.w = w.id;
    row.innerHTML = '<input type="checkbox"><span class="ammo-name"></span><input type="number" min="0" max="99" placeholder="∞"><small class="ammo-desc"></small>';
    row.querySelector('.ammo-name').textContent = w.name;
    row.querySelector('.ammo-desc').textContent = w.desc || '';
    const cb = row.querySelector('input[type=checkbox]'), num = row.querySelector('input[type=number]');
    cb.addEventListener('change', () => { if (cb.checked && num.value === '0') num.value = String(w.ammo > 0 ? w.ammo : ''); row.classList.toggle('off', !cb.checked); this.onSettingsChanged(); });
    num.addEventListener('input', () => { if (num.value === '0') { cb.checked = false; row.classList.add('off'); } else if (!cb.checked) { cb.checked = true; row.classList.remove('off'); } this.onSettingsChanged(); });
    g.appendChild(row);
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
  /** справка: клавиши — из текущей таблицы (после перенастройки в «Клавиши управления» видны новые) */
  buildHelpKeys() {
    const t = $('help-keys'); if (!t) return; t.textContent = '';
    const row = (keys, text) => {
      const tr = document.createElement('tr'), a = document.createElement('td'), b = document.createElement('td');
      for (const part of keys) {
        if (typeof part === 'string' && part.startsWith('#')) { a.appendChild(document.createTextNode(part.slice(1))); continue; }
        const L = Keys.map[part] || []; if (!L.length) { a.appendChild(document.createTextNode('—')); continue; }
        L.forEach((c, i) => { if (i) a.appendChild(document.createTextNode(' / ')); const k = document.createElement('kbd'); k.textContent = keyLabel(c); a.appendChild(k); });
        a.appendChild(document.createTextNode(' '));
      }
      b.textContent = text; tr.appendChild(a); tr.appendChild(b); t.appendChild(tr);
    };
    row(['left', 'right'], 'Ходьба (запас шагов ограничен, если ход не «на любую дистанцию»)');
    row(['jump'], 'Прыжок; пока бежит робо-бомба — её прыжок');
    row(['up', 'down', '#у лестницы'], 'Подъём / спуск; влево/вправо — сойти, прыжок — отпрыгнуть');
    row(['aimUp', 'aimDown', '#, ', 'precise'], 'Прицел (с «точнее» — медленнее). У снайперки «следующее оружие» включает и выключает оптику, в оптике наводите мышью');
    row(['fire', '#/ ЛКМ'], 'Выстрел. Для базуки и гранат зажмите: сила — на шкале слева и на кольце прицела');
    row(['#Мышь в бою'], 'Захвачена игрой: стрелки не видно, за край экрана она не уходит; бой идёт во весь экран (Chrome, Edge — «Играть.cmd» открывает игру в них). Отпустить мышь — клавиша меню; вернуть — клик по полю боя');
    row(['tray', '#/ ПКМ'], 'Панель оружия');
    row(['prev', 'next', '#, ', 'cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6'], 'Сменить оружие / категорию');
    row(['binoc', '#/ удерживать ПКМ'], 'Бинокль: обзор плавно едет туда, куда ведёте мышь');
    row(['camera', '#/ колесо'], 'Вернуть камеру к бойцу / немного приблизить или отдалить');
    row(['rotate'], 'Повернуть балку / подкрутка гранаты');
    row(['skip'], 'Пропустить ход (сделал всё, что хотел)');
    row(['holster'], 'Убрать оружие из рук; ещё раз — вернуть (мышь остаётся в игре)');
    row(['menu'], 'Меню (пауза), мышь свободна');
    row(['chat', '#/ ', 'sound'], 'Чат по сети / звук');
    row(['#Клавиши'], 'Меняются в настройке боя: «Клавиши управления» (сохраняются вместе с конфигурацией)');
  },
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
    this.fitTrayInfo();
  },
  /** поле описания высотой по самому длинному описанию: при наведении на другое оружие список не прыгает вверх-вниз */
  fitTrayInfo() {
    const inf = $('tray-info'), w = inf.clientWidth; if (!w || this.trayInfoW === w) return;
    const keep = [...inf.childNodes]; let h = 0; inf.style.minHeight = '0px';
    for (const wp of WEAPONS) {
      inf.textContent = ''; const b = document.createElement('b'); b.textContent = wp.name;
      inf.appendChild(b); inf.appendChild(document.createElement('br')); inf.appendChild(document.createTextNode(wp.desc)); h = Math.max(h, inf.offsetHeight);
    }
    inf.textContent = ''; for (const n of keep) inf.appendChild(n);
    inf.style.minHeight = h + 'px'; this.trayInfoW = w;
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
    const head = document.createElement('div'); head.className = 'over-row muted'; head.innerHTML = '<span>Команда</span><span>Урон</span><span>Убийства</span><span>Живых</span>'; st.appendChild(head);
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
