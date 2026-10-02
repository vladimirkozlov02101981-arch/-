'use strict';
/* =========================================================
   Ввод (клавиатура + мышь) и локальный контроллер игрока
   ========================================================= */
const Input = {
  keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: [false, false, false], clicked: [false, false, false], moved: false, inside: false },
  wheel: 0, typing: false, drag: null, onClickRight: null, onBinoc: null, onWheel: null,
  // захват указателя в бою: системная стрелка скрыта и не уходит за край окна, мышь двигает внутренний курсор.
  // Esc мышь не отпускает — он только убирает оружие: бой идёт во весь экран, а там Chrome и Edge (Keyboard Lock) отдают Esc игре.
  // Отпускают мышь: меню (Backspace), панель оружия, клавиша Windows / Alt+Tab; клик по полю или клавиша — снова захват
  cv: null, locked: false, wantLock: false, lockPending: false, gestureT: -1e9, selfUnlock: false, escKeyT: -1e9, escLockT: -1e9, failT: -1e9,
  leavingFs: false, escLost: 0, onEscLost: null,
  GAME_KEYS: new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'KeyF', 'Backspace']),
  init(cv) {
    this.cv = cv;
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked; this.locked = document.pointerLockElement === cv; this.lockPending = false;
      if (this.locked) this.mouse.inside = true;
      // захват снял браузер по Esc (окно без полного экрана, браузер без перехвата клавиш): это тоже нажатие Esc — убрать оружие.
      // Проверка чуть позже: при Alt+Tab и клавише Windows окно теряет фокус — это не Esc
      else if (was && !this.selfUnlock) setTimeout(() => {
        if (!document.hasFocus() || document.hidden || performance.now() - this.escKeyT <= 400) return;
        this.pressed.Escape = true; this.escLockT = performance.now();
        if (this.escLost++ === 0 && this.onEscLost) this.onEscLost();   // этот браузер не отдаёт Esc игре — подсказка один раз
      }, 120);
      this.selfUnlock = false;
    });
    document.addEventListener('pointerlockerror', () => { this.locked = false; this.lockPending = false; this.failT = performance.now(); });
    // клик по кнопке «В бой!», «Реванш», «Продолжить», оружию — тоже жест; с кнопок начала боя игра сразу уходит во весь экран
    document.addEventListener('mousedown', (e) => {
      this.gestureT = performance.now();
      if (e.target && e.target.closest && e.target.closest('#btn-start, [data-act="rematch"], [data-act="resume"], [data-act="cpu"], [data-act="hotseat"]')) this.enterFull();
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') { this.gestureT = performance.now(); if (this.wantLock && !document.fullscreenElement) this.enterFull(); }   // Esc браузер жестом не считает
      else if (performance.now() - this.escLockT < 400) { e.preventDefault(); return; }   // этот Esc уже учтён по снятию захвата
      else this.escKeyT = performance.now();
      if (this.typing || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT'))) return;
      if (this.GAME_KEYS.has(e.code) || (typeof Keys !== 'undefined' && Keys.codes.has(e.code))) e.preventDefault();   // клавиши игры браузеру не отдаём
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = [false, false, false]; this.mouse.inside = false; this.releaseRight(); });
    // курсор ушёл с поля (за окно или на кнопки интерфейса) — прокрутка у края экрана останавливается
    cv.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    window.addEventListener('contextmenu', (e) => { if (this.drag || this.binocOn) e.preventDefault(); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousemove', (e) => {
      // при захвате указателя координаты не меняются — внутренний курсор ведут относительные сдвиги, он не выходит за поле
      const nx = this.locked ? clamp(this.mouse.x + (e.movementX || 0), 0, cv.clientWidth - 1) : e.clientX;
      const ny = this.locked ? clamp(this.mouse.y + (e.movementY || 0), 0, cv.clientHeight - 1) : e.clientY;
      const dx = nx - this.mouse.x, dy = ny - this.mouse.y;
      this.mouse.x = nx; this.mouse.y = ny; this.mouse.moved = true; this.mouse.inside = true;
      // кнопку отпустили там, где событие не дошло (за окном, над интерфейсом) — бинокль всё равно выключаем
      if (this.drag && this.drag.btn === 2 && !(e.buttons & 2)) { this.releaseRight(); return; }
      if (this.drag) { this.drag.dist += Math.abs(dx) + Math.abs(dy); this.checkBinoc(); }
    });
    cv.addEventListener('mousedown', (e) => {
      Sfx.resume(); this.gestureT = performance.now();
      // бой без захвата (после Delete, паузы, Alt+Tab): этот клик только возвращает мышь в игру и не стреляет
      if (this.wantLock && !this.locked && this.lockable()) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.lock(); e.preventDefault(); return; }
      if (this.wantLock && !document.fullscreenElement) this.enterFull();
      if (!this.locked) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
      this.mouse.inside = true;
      this.mouse.down[e.button] = true; if (e.button === 0) this.mouse.clicked[0] = true;
      // ПКМ: короткий клик — арсенал, удержание — бинокль
      if (e.button === 2) { this.drag = { btn: 2, dist: 0, t0: performance.now(), binoc: false }; e.preventDefault(); }
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.down[e.button] = false;
      if (e.button === 2) this.releaseRight(true);
      else if (this.drag && this.drag.btn === e.button) this.drag = null;
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); if (this.onWheel) this.onWheel(e.deltaY, this.locked ? this.mouse.x : e.clientX, this.locked ? this.mouse.y : e.clientY); }, { passive: false });
  },
  /** захват указателя: по свежему жесту пользователя (клик, клавиша) — так требует браузер; во весь экран можно и без жеста */
  lock() {
    const cv = this.cv, now = performance.now();
    if (!this.lockable() || this.locked || this.lockPending || now - this.failT < 1000) return;
    if (now - this.gestureT > 4000 && !document.fullscreenElement) return;
    this.lockPending = true;
    try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => { this.lockPending = false; this.failT = performance.now(); }); }
    catch (e) { this.lockPending = false; this.failT = now; }
    if (now - this.gestureT <= 4000) this.enterFull();
  },
  /** захват возможен (в автотестах мышь двигают событиями с координатами — без захвата) */
  lockable() { return !!(this.cv && this.cv.requestPointerLock) && !(navigator.webdriver && !window.__allowLock); },
  unlock() { if (this.locked && document.exitPointerLock) { this.selfUnlock = true; document.exitPointerLock(); } },
  /** бой во весь экран: только так Chrome и Edge отдают Esc игре (Keyboard Lock) — Esc убирает оружие и не отпускает мышь.
      Где перехвата клавиш нет, полный экран не включается: Esc там отпускает мышь сам браузер (тогда подсказка onEscLost) */
  enterFull(force = false) {
    const el = document.documentElement;
    if (navigator.webdriver && !force) return;   // автотесты: окно не разворачиваем
    if (document.fullscreenElement || !el.requestFullscreen || !(navigator.keyboard && navigator.keyboard.lock)) return;
    try {
      // перехват Esc просим заранее и ещё раз после входа: браузер включает его только в полном экране
      navigator.keyboard.lock(['Escape']).catch(() => {});
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => navigator.keyboard.lock(['Escape'])).catch(() => {});
    } catch (e) { /* полный экран недоступен (встроенное окно) */ }
  },
  /** отпускание ПКМ: бинокль выключается всегда (даже включённый клавишей B); короткий клик без бинокля — арсенал */
  releaseRight(click = false) {
    const d = this.drag; this.drag = null;
    if ((d && d.binoc) || this.binocOn) { if (this.onBinoc) this.onBinoc(false); }
    else if (click && d && d.btn === 2 && this.onClickRight) this.onClickRight();
  },
  checkBinoc() {
    const d = this.drag; if (!d || d.binoc || d.btn !== 2) return;
    if (d.dist > 14 || performance.now() - d.t0 > 220) { d.binoc = true; if (this.onBinoc) this.onBinoc(true); }
  },
  endFrame() { this.checkBinoc(); this.pressed = {}; this.mouse.clicked = [false, false, false]; this.mouse.moved = false; },
};

class LocalController {
  constructor(send) {
    this.send = send; this.myTeams = []; this.aim = -0.5; this.aimMode = 'mouse'; this.charging = false; this.chargeByMouse = false;
    this.power = 0; this.key = null; this.lastSig = ''; this.sendT = 0; this.mouseW = { x: 0, y: 0 }; this.mine = false; this.pendingTarget = false; this.scopeOn = false; this.scopeWeapon = null;
  }
  available(sc, T) {
    const tm = sc.teams[T.team]; if (!tm) return [];
    return WEAPONS.filter(w => tm.ammo[w.id] !== undefined && tm.ammo[w.id] !== 0 && !(w.minRound && (sc.round || T.round) < w.minRound));
  }
  select(id) { this.send({ c: 'weapon', id }); this.pendingTarget = false; Sfx.play('select'); }
  cycle(sc, T, dir) {
    const list = this.available(sc, T); if (!list.length) return;
    let i = list.findIndex(w => w.id === T.weapon); i = (i + dir + list.length) % list.length; this.select(list[i].id);
  }
  category(sc, T, cat) {
    const list = this.available(sc, T).filter(w => w.cat === cat); if (!list.length) return;
    const i = list.findIndex(w => w.id === T.weapon); this.select(list[(i + 1) % list.length].id);
  }
  hint(sc, T) {
    const W = WEAPON[T.weapon]; if (!W) return '';
    if (T.phase === 'retreat') return 'Отступайте! A/D — ходьба, Пробел — прыжок';
    if (T.phase === 'use') {
      if (T.weapon === 'robot') return 'Пробел — прыжок робота, ЛКМ / Enter — взорвать';
      if (T.weapon === 'jetpack') return 'W / Пробел — тяга, A/D — в стороны, ЛКМ — выключить';
      if (T.weapon === 'airstrike') return 'ЛКМ / F — сброс на глаз с упреждением: бомбы летят вперёд. Не успели — у края экрана';
      if (T.weapon === 'orbital') return 'A / D — ведите луч к цели';
      return 'Огонь!';
    }
    if (W.id === 'sniper') return this.breath <= 0.05 ? 'Руки дрожат — отпустите Shift и отдышитесь' : `Мышь — прицел, ЛКМ или F — выстрел. Shift — задержать дыхание. E — ${this.scopeOn ? 'убрать' : 'показать'} оптику`;
    if (W.id === 'airstrike') return 'Кликните по цели: самолёт пройдёт над ней, сброс — ЛКМ или F';
    if (W.id === 'lightning') return 'Кликните: туча уйдёт по ветру и ударит в самую высокую точку';
    if (W.id === 'orbital') return 'Кликните: спутник наведётся с ошибкой, луч доводите клавишами A/D';
    if (W.id === 'nuke') return 'Кликните по району: ракету сносит ветром, есть разброс — цельтесь с поправкой';
    switch (W.mode) {
      case 'charge': return '↑/↓ — прицел. Зажмите F или ЛКМ и отпустите для выстрела';
      case 'tcharge': return T.target ? 'Цель захвачена с ошибкой. Зажмите ЛКМ для выстрела' : 'Кликните по цели на карте';
      case 'instant': return W.shots ? `↑/↓ — прицел. Выстрел ${Math.min(T.shots + 1, W.shots)} из ${W.shots} — F или ЛКМ` : '↑/↓ — прицел. F или ЛКМ — огонь';
      case 'target': return 'Кликните по точке на карте';
      case 'place': return 'ЛКМ — поставить, R — повернуть';
      case 'drop': return 'ЛКМ или Enter — положить под ноги';
      case 'self': return W.id === 'skip' ? 'ЛКМ или Enter — пропустить ход' : 'ЛКМ или Enter — применить';
      case 'active': return 'ЛКМ — включить джетпак';
    }
    return '';
  }
  cancelCharge() { if (this.charging) { this.charging = false; Sfx.chargeStop(); } }
  /** скорострельное оружие с быстрыми пулями: камера за ними не успевает, поэтому сначала обзор переходит туда, куда они
      попадут, а потом выстрел. Если и свой боец, и место попадания уже в кадре — камера стоит, выстрел сразу */
  fireFast(sc, cam, sw, sh, s, cmd, id) {
    const p = predictShot(sc, s, cmd.aim, id);
    if (!p || (cam.sees(p.x, p.y, sw, sh) && cam.sees(s.x, s.y - 20, sw, sh))) { this.send(cmd); return; }
    this.send({ c: 'look', x: Math.round(p.x), y: Math.round(p.y) });
    cam.shot = Object.assign(cam.shotFrame(s.x, s.y - 20, p.x, p.y, sw, sh), { t: 2.2 });   // свой экран не ждёт ответа хоста
    this.pendingShot = { cmd, t: 0, f: cam.shot, p };
  }
  suspend() {
    this.cancelCharge();
    if (this.suspended) return;
    this.suspended = true; this.lastSig = '';
    this.send({ c: 'ctrl', l: false, r: false, u: false, pw: -1 });
  }
  update(dt, sc, cam, sw, sh, T) {
    this.suspended = false;
    const w = cam.toWorld(Input.mouse.x, Input.mouse.y, sw, sh); this.mouseW.x = w[0]; this.mouseW.y = w[1];
    const s = sc.soldiers.find(o => o.id === T.sid);
    this.mine = !!(s && s.alive && !s.gone && this.myTeams.includes(T.team) && T.phase !== 'over');
    if (!this.mine) { this.cancelCharge(); this.key = null; this.scopeOn = false; this.scopeWeapon = null; this.edgePan = false; return; }
    const key = T.round + ':' + T.sid;
    if (this.key !== key) { this.scopeOn = false; this.scopeWeapon = null; this.key = key; this.aim = this.base = s.aim; this.power = 0; this.cancelCharge(); this.pendingTarget = false; this.lastSig = ''; this.breath = 2.5; this.pendingShot = null; }
    if (this.base === undefined) this.base = this.aim;
    if (T.target) this.pendingTarget = false;
    const W = WEAPON[T.weapon] || WEAPON.bazooka; const phase = T.phase;
    const canAct = phase === 'aim' && !!WEAPON[T.weapon]; const jet = phase === 'use' && T.weapon === 'jetpack';
    const canMove = phase === 'aim' || phase === 'retreat' || jet;
    // клавиши — по таблице Keys (настраиваются; по физической клавише, раскладка не важна)
    const left = Keys.down('left'), right = Keys.down('right');
    // W/S — лазание по лестницам и тяга джетпака; стрелки ↑/↓ — только наклон ствола
    const up = Keys.down('up'), down = Keys.down('down'), aimUp = Keys.down('aimUp'), aimDown = Keys.down('aimDown'), precise = Keys.down('precise');
    // мышь также выбирает точку для авиаудара, молнии и т. п.
    const pickPoint = W.mode === 'target' || W.mode === 'place' || (W.mode === 'tcharge' && !T.target);
    // цель дальнобойного оружия может быть за экраном: курсор у края экрана сам ведёт обзор (render.js, Camera.edgeDir)
    this.edgePan = canAct && (W.mode === 'target' || (W.mode === 'tcharge' && !T.target));
    // прежняя оптика ×3 появляется сразу при выборе снайперки; E только скрывает или показывает её
    const sniperScope = T.weapon === 'sniper' && canAct;
    if (sniperScope && this.scopeWeapon !== 'sniper') { this.scopeOn = true; this.aimMode = 'mouse'; }
    if (!sniperScope) this.scopeOn = false;
    this.scopeWeapon = sniperScope ? 'sniper' : null;
    if (sniperScope && Keys.hit('next') && T.shots === 0 && !this.charging) { this.scopeOn = !this.scopeOn; Sfx.play('select'); Keys.eat('next'); }
    // наведение мышью или стрелками ↑/↓ — работает то, чем пользовались последним, даже со скрытой оптикой
    if (Input.mouse.moved || (sniperScope && Input.mouse.clicked[0])) this.aimMode = 'mouse';
    if (aimUp || aimDown) this.aimMode = 'keys';
    const mouseAim = canAct && this.aimMode === 'mouse';
    if (mouseAim && (!this.binoc || pickPoint)) this.base = Math.atan2(this.mouseW.y - (s.y - GUN_Y), this.mouseW.x - s.x);
    else {
      let face = Math.cos(this.base) >= 0 ? 1 : -1;
      if (left !== right && !jet) face = left ? -1 : 1;
      let elev = angNorm(face > 0 ? -this.base : this.base - Math.PI);
      const sp = precise ? 0.35 : 1.3;
      if (aimUp) elev += dt * sp; if (aimDown) elev -= dt * sp;
      elev = clamp(elev, -1.55, 1.55);
      this.base = face > 0 ? -elev : Math.PI + elev;
    }
    // снайперский прицел «дышит»; Shift ненадолго задерживает дыхание
    let sway = 0;
    if (T.weapon === 'sniper' && canAct) {
      this.swayT = (this.swayT || 0) + dt;
      const hold = precise;
      if (hold && this.breath > 0) this.breath = Math.max(0, this.breath - dt);
      else if (!hold) this.breath = Math.min(2.5, this.breath + dt * 0.7);
      const amp = hold && this.breath > 0 ? 0.005 : this.breath <= 0.05 ? 0.058 : 0.03;
      this.swayAmp = approach(this.swayAmp ?? amp, amp, 4, dt);
      sway = this.swayAmp * (Math.sin(this.swayT * 1.4) * 0.8 + Math.sin(this.swayT * 3.1 + 1.3) * 0.45);
    }
    // раненая рука: ствол гуляет, тем сильнее, чем тяжелее рана
    const aw = s.wl ? Math.max(s.wl[2], s.wl[3]) : 0;
    if (aw && canAct) { this.woundT = (this.woundT || 0) + dt; sway += [0, 0.012, 0.03, 0.055][aw] * (Math.sin(this.woundT * 2.3) * 0.7 + Math.sin(this.woundT * 5.1 + 0.7) * 0.4); }
    this.aim = this.base + sway;
    // выстрел быстрыми пулями ждёт, пока обзор дойдёт до места попадания; ствол всё это время смотрит туда же
    if (this.pendingShot) {
      const ps = this.pendingShot, f = ps.f; ps.t += dt; this.aim = this.base = ps.cmd.aim;
      const step = ps.cx !== undefined ? Math.hypot(cam.x - ps.cx, cam.y - ps.cy) * cam.z : 1e9; ps.cx = cam.x; ps.cy = cam.y;
      // обзор дошёл: место попадания уже хорошо видно и камера почти остановилась (или упёрлась в край карты)
      const near = Math.abs(cam.x - f.x) * cam.z < 26 && Math.abs(cam.y - f.y) * cam.z < 26;
      const seen = cam.sees(ps.p.x, ps.p.y, sw, sh, 0.14) && step < 7;
      if (near || seen || (step < 1.2 && ps.t > 0.3) || ps.t > 1.1 || phase !== 'aim') { if (phase === 'aim') this.send(ps.cmd); this.pendingShot = null; }
    }
    if (phase === 'aim' && T.shots === 0 && !this.charging && !this.pendingShot) {
      if (Keys.hit('prev')) this.cycle(sc, T, -1); if (Keys.hit('next')) this.cycle(sc, T, 1);
      for (let i = 1; i <= 6; i++) if (Keys.hit('cat' + i)) this.category(sc, T, i - 1);
    }
    if (Keys.hit('rotate') && T.weapon === 'girder' && canAct) this.send({ c: 'rot', d: 1 });
    if (Keys.hit('rotate') && SPIN_WEAPONS.has(T.weapon) && canAct && !this.charging) { this.send({ c: 'spin' }); Sfx.play('select'); }
    // быстрый пропуск хода (по умолчанию «Ё» слева от 1 и P): сделал всё, что хотел, — ход заканчивается сразу
    if (Keys.hit('skip') && (phase === 'aim' || phase === 'retreat')) { this.cancelCharge(); this.pendingShot = null; this.send({ c: 'skip' }); }
    if (Keys.hit('jump') && (phase === 'aim' || phase === 'retreat') && !this.charging) this.send({ c: 'jump', d: left ? -1 : right ? 1 : 0 });
    else if (Keys.hit('jump') && phase === 'use' && T.weapon === 'robot') this.send({ c: 'jump' });
    // в бинокль клик не стреляет: мышь ведёт обзор (кроме оружия с выбором точки)
    const mFire = Input.mouse.clicked[0] && (!this.binoc || pickPoint), kFire = Keys.hit('fire');   // выстрел: ЛКМ или клавиша выстрела (F, Enter)
    if (phase === 'use') {
      // авиаудар: сброс — ЛКМ, F или Enter; не сбросили — бомбы уходят сами, когда самолёт долетает до края экрана
      const jet = T.weapon === 'airstrike' ? sc.entities.find(e => e.k === 'jet' && !e.s && e.team === T.team) : null;
      if (jet) {
        const dir = Math.cos(jet.a) >= 0 ? 1 : -1, sx = cam.toScreen(jet.x, jet.y, sw, sh)[0], nose = 42 * cam.z;
        if (sx >= 0 && sx <= sw) this.jetSeen = jet.id;
        // край экрана считается, когда самолёт уже прошёл над точкой курса (f): пока обзор едет к цели, самолёт может мелькнуть у края раньше
        const passed = !jet.f || dir * (jet.x - jet.f) > 0;
        const atEdge = !this.binoc && passed && this.jetSeen === jet.id && (dir > 0 ? sx >= sw - nose : sx <= nose);
        // точка сброса — где самолёт нарисован на экране (между шагами симуляции, как в main.js)
        const seenX = jet.px !== undefined && typeof App !== 'undefined' ? jet.px + (jet.x - jet.px) * clamp(App.acc / DT, 0, 1) : jet.x;
        if ((mFire || kFire || atEdge) && this.jetSent !== jet.id) { this.jetSent = jet.id; this.send({ c: 'fire', x: Math.round(seenX * 10) / 10 }); }
      } else if (mFire || kFire) this.send({ c: 'fire' });
    }
    else if (canAct) {
      switch (W.mode) {
        case 'charge': case 'tcharge': {
          if (W.mode === 'tcharge' && !T.target) {
            if ((mFire || kFire) && !this.pendingTarget) { this.send({ c: 'target', x: Math.round(this.mouseW.x), y: Math.round(this.mouseW.y) }); this.pendingTarget = true; Sfx.play('select'); }
            break;
          }
          if (!this.charging) { if (mFire || kFire) { this.charging = true; this.power = 0; this.chargeDir = 1; this.chargeByMouse = mFire; Sfx.chargeStart(); } }
          else {
            const held = this.chargeByMouse ? Input.mouse.down[0] : Keys.down('fire');
            // сила «пульсирует»: до максимума и обратно, пока кнопка зажата; выстрел — только при отпускании
            this.power += (this.chargeDir || 1) * dt / 1.15;
            const cap = s.armFactor ? s.armFactor() : s.wl ? [2, 3].reduce((f, i) => f * [1, 0.95, 0.85, 0.7][s.wl[i]], 1) : 1;   // раненые руки: предел силы
            if (this.power >= cap) { this.power = cap; this.chargeDir = -1; } else if (this.power <= 0.06) { this.power = 0.06; this.chargeDir = 1; }
            Sfx.chargeSet(this.power);
            if (!held) { this.send({ c: 'fire', aim: this.aim, pw: Math.max(0.06, this.power) }); this.cancelCharge(); }
          }
          break;
        }
        case 'instant': case 'drop': case 'self': case 'active':
          if ((mFire || kFire) && !this.pendingShot) { const cmd = { c: 'fire', aim: this.aim, pw: 1 }; if (typeof FAST_SHOT !== 'undefined' && FAST_SHOT[W.id] && cam.sees) this.fireFast(sc, cam, sw, sh, s, cmd, W.id); else this.send(cmd); }
          break;
        case 'target': case 'place':
          if (mFire || kFire) this.send({ c: 'fire', aim: this.aim, pw: 1, tx: Math.round(this.mouseW.x), ty: Math.round(this.mouseW.y) }); break;
      }
    }
    const climbing = !jet && !precise && (sc.map.ladders || []).some(l => Math.abs(l.x-s.x)<19 && s.y>=l.y1-8 && s.y<=l.y2+8);
    const steer = phase === 'use' && T.weapon === 'orbital';
    const ctrl = { c: 'ctrl', l: (canMove || steer) && left, r: (canMove || steer) && right, u: canMove && (jet ? (up || Keys.down('jump')) : climbing && up), d: canMove && climbing && down, aim: Math.round(this.aim * 1000) / 1000, pw: this.charging ? Math.round(this.power * 100) / 100 : -1 };
    const sig = ctrl.l + '|' + ctrl.r + '|' + ctrl.u + '|' + ctrl.aim + '|' + ctrl.pw;
    this.sendT -= dt;
    if (this.sendT <= 0) { this.send(ctrl); this.lastSig = sig; this.sendT = 1 / 30; }
  }
}
