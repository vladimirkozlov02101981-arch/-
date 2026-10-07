'use strict';
/* =========================================================
   Ввод (клавиатура + мышь) и локальный контроллер игрока
   ========================================================= */
const Input = {
  keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: [false, false, false], clicked: [false, false, false], moved: false, inside: false, dx: 0, dy: 0 },
  wheel: 0, numbers: [], typing: false, drag: null, onClickRight: null, onBinoc: null, onWheel: null,
  isTouch: false, touchKeys: {}, touchPressed: {}, touchStartX: 0, touchStartY: 0, touchLastX: 0, touchLastY: 0,
  touchMoveDist: 0, pinchDist: 0, pinchCenter: null, touchPanning: false, touchRoot: null,
  // захват указателя в бою: системная стрелка скрыта и не уходит за край окна, мышь двигает внутренний курсор.
  // Esc мышь не отпускает — он только убирает оружие: бой идёт во весь экран, а там Chrome и Edge (Keyboard Lock) отдают Esc игре.
  // Отпускают мышь: меню (Backspace), панель оружия, клавиша Windows / Alt+Tab; клик по полю или клавиша — снова захват
  cv: null, locked: false, wantLock: false, lockPending: false, gestureT: -1e9, selfUnlock: false, escKeyT: -1e9, escLockT: -1e9, failT: -1e9,
  fsWanted: true, fsPending: false, fsActual: false, escLost: 0, onEscLost: null,
  GAME_KEYS: new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'KeyF', 'Backspace']),
  init(cv) {
    this.cv = cv; this.fsActual = this.isFullscreen();
    try {
      this.isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch (e) { this.isTouch = false; }
    const unlockTouch = () => {
      this.isTouch = true;
      if (typeof Sfx !== 'undefined') Sfx.resume();
      window.removeEventListener('touchstart', unlockTouch, true);
    };
    window.addEventListener('touchstart', unlockTouch, { capture: true, passive: true });
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
    // браузер может отклонить полный экран без жеста: первый клик или клавиша повторяет попытку
    document.addEventListener('mousedown', () => { this.gestureT = performance.now(); this.enterFull(); }, true);
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) { if (this.fsWanted) this.lockEscape(); }
      else this.fsWanted = false;   // Esc или системный выход также сохраняет оконный режим
      this.fsActual = this.isFullscreen();
    });
    window.addEventListener('resize', () => {
      const full = this.isFullscreen();
      // Системный F11 иногда не приходит странице: переход размеров всё равно сохраняет выбор.
      // Обычное изменение ещё оконного запуска не отменяет ожидающий первого жеста полный экран.
      if (full !== this.fsActual) { this.fsActual = full; this.fsWanted = full; }
      if (this.fsWanted && full) this.lockEscape();
    });
    window.addEventListener('keydown', (e) => {
      // F11 переключает сам браузер — он выходит и из DOM, и из своего полного экрана.
      // После выхода обычные игровые жесты не должны тут же разворачивать окно обратно.
      if (e.code === 'F11') {
        if (!e.repeat) { this.fsWanted = !this.isFullscreen(); if (this.fsWanted) this.gestureT = performance.now(); }
        return;
      }
      if (e.code !== 'Escape') { this.gestureT = performance.now(); this.enterFull(); }   // Esc браузер жестом не считает
      else if (performance.now() - this.escLockT < 400) { e.preventDefault(); return; }   // этот Esc уже учтён по снятию захвата
      else this.escKeyT = performance.now();
      if (this.typing || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT'))) return;
      if (/^(Digit|Numpad)\d$/.test(e.code) || this.GAME_KEYS.has(e.code) || (typeof Keys !== 'undefined' && Keys.codes.has(e.code))) e.preventDefault();   // клавиши игры браузеру не отдаём
      if (!e.repeat && /^(Digit|Numpad)\d$/.test(e.code)) this.numbers.push(e.code);
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
      const dx = this.locked ? (e.movementX || 0) : nx - this.mouse.x, dy = this.locked ? (e.movementY || 0) : ny - this.mouse.y;
      this.mouse.dx += dx; this.mouse.dy += dy;   // сохраняем весь относительный сдвиг, включая движение дальше края окна
      this.mouse.x = nx; this.mouse.y = ny; this.mouse.moved = this.mouse.moved || !!(dx || dy); this.mouse.inside = true;
      if (this.mouse.down[1] && !(e.buttons & 4)) this.mouse.down[1] = false;   // потерянный mouseup вне окна не оставляет колесо зажатым
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
    cv.addEventListener('wheel', (e) => { e.preventDefault(); if (this.onWheel) this.onWheel(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cv.clientHeight : 1), this.locked ? this.mouse.x : e.clientX, this.locked ? this.mouse.y : e.clientY, !!((e.buttons & 4) || this.mouse.down[1])); }, { passive: false });
    cv.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    cv.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    cv.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: false });
    cv.addEventListener('touchcancel', (e) => this.onTouchEnd(e), { passive: false });
    this.initTouchControls();
    if (this.isFullscreen()) this.lockEscape();
    else this.enterFull();   // сразу при открытии игры; если нужен жест, обработчики выше повторят попытку
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
  lockable() { return !this.isTouch && !!(this.cv && this.cv.requestPointerLock) && !(navigator.webdriver && !window.__allowLock); },
  unlock() { if (this.locked && document.exitPointerLock) { this.selfUnlock = true; document.exitPointerLock(); } },
  /** полный экран браузера или документа; F11 сохраняет выбор до следующего запуска игры */
  isFullscreen() {
    return !!document.fullscreenElement || !!(window.screen && Math.abs(window.innerWidth - window.screen.width) <= 4 && Math.abs(window.innerHeight - window.screen.height) <= 4);
  },
  /** Chrome и Edge в полном экране отдают Esc игре: он убирает оружие и не отпускает мышь */
  lockEscape() {
    if (!(navigator.keyboard && navigator.keyboard.lock)) return;
    try { const p = navigator.keyboard.lock(['Escape']); if (p && p.catch) p.catch(() => {}); }
    catch (e) { /* перехват клавиш недоступен */ }
  },
  /** запуск во весь экран; отклонённая попытка без жеста повторяется при первом действии игрока */
  enterFull(force = false) {
    const el = document.documentElement;
    if (!this.fsWanted || (navigator.webdriver && !window.__allowFull && !force)) return;
    if (document.fullscreenElement) { this.lockEscape(); return; }
    if (!el.requestFullscreen || this.fsPending) return;
    this.fsPending = true; this.lockEscape();
    try {
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && p.then) p.then(() => { this.fsPending = false; if (this.fsWanted) this.lockEscape(); }).catch(() => { this.fsPending = false; });
      else this.fsPending = false;
    } catch (e) { this.fsPending = false; /* полный экран недоступен (встроенное окно) */ }
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
  toggleFullscreen() {
    if (document.fullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } else {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  },
  onTouchStart(e) {
    this.isTouch = true;
    this.gestureT = performance.now();
    if (typeof Sfx !== 'undefined') Sfx.resume();
    if (e.touches.length === 2) {
      this.pinchDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      this.pinchCenter = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      this.touchPanning = false;
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.touchStartX = this.touchLastX = t.clientX;
      this.touchStartY = this.touchLastY = t.clientY;
      this.touchMoveDist = 0;
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
      this.mouse.inside = true;
      this.mouse.moved = true;
      if (this.binocOn) {
        this.touchPanning = true;
      }
      e.preventDefault();
    }
  },
  onTouchMove(e) {
    this.isTouch = true;
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const diff = d - this.pinchDist;
      if (Math.abs(diff) > 2) {
        if (this.onWheel) this.onWheel(-diff * 2.2, cx, cy, false);
        this.pinchDist = d;
      }
      if (this.pinchCenter && typeof App !== 'undefined' && App.cam) {
        const pdx = cx - this.pinchCenter.x, pdy = cy - this.pinchCenter.y;
        if (Math.abs(pdx) > 1 || Math.abs(pdy) > 1) {
          App.cam.x -= pdx / App.cam.z;
          App.cam.y -= pdy / App.cam.z;
          App.cam.free = 2;
          App.cam.manualActive = false;
          this.pinchCenter = { x: cx, y: cy };
        }
      }
      e.preventDefault();
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - this.touchLastX, dy = t.clientY - this.touchLastY;
      this.touchMoveDist += Math.abs(dx) + Math.abs(dy);
      this.mouse.dx += dx;
      this.mouse.dy += dy;
      this.touchLastX = t.clientX;
      this.touchLastY = t.clientY;
      this.mouse.x = t.clientX;
      this.mouse.y = t.clientY;
      this.mouse.moved = true;
      this.mouse.inside = true;
      if (this.touchPanning && typeof App !== 'undefined' && App.cam) {
        App.cam.x -= dx / App.cam.z;
        App.cam.y -= dy / App.cam.z;
        App.cam.free = 2;
      }
      e.preventDefault();
    }
  },
  onTouchEnd(e) {
    if (e.touches.length < 2) {
      this.pinchDist = 0;
      this.pinchCenter = null;
    }
    if (e.touches.length === 0) {
      if (this.touchMoveDist < 14) {
        this.mouse.clicked[0] = true;
        this.mouse.x = this.touchLastX;
        this.mouse.y = this.touchLastY;
      }
      this.touchPanning = false;
      this.touchMoveDist = 0;
    }
  },
  initTouchControls() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const root = document.getElementById('touch-controls');
    if (!root) return;
    this.touchRoot = root;
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    const bindTouchBtn = (selector, action, isHold = false) => {
      const el = root.querySelector(selector);
      if (!el) return;
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.isTouch = true;
        if (typeof Sfx !== 'undefined') Sfx.resume();
        el.classList.add('active');
        if (isHold) {
          this.touchKeys[action] = true;
        }
        this.touchPressed[action] = true;
      }, { passive: false });

      const onEnd = (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove('active');
        if (isHold) {
          this.touchKeys[action] = false;
        }
      };
      el.addEventListener('touchend', onEnd, { passive: false });
      el.addEventListener('touchcancel', onEnd, { passive: false });
    };

    bindTouchBtn('[data-touch="left"]', 'left', true);
    bindTouchBtn('[data-touch="right"]', 'right', true);
    bindTouchBtn('[data-touch="jump"]', 'jump', true);
    bindTouchBtn('[data-touch="down"]', 'down', true);

    bindTouchBtn('[data-touch="aimUp"]', 'aimUp', true);
    bindTouchBtn('[data-touch="aimDown"]', 'aimDown', true);
    bindTouchBtn('[data-touch="fire"]', 'fire', true);

    bindTouchBtn('[data-touch="rotate"]', 'rotate', false);
    bindTouchBtn('[data-touch="prev"]', 'prev', false);
    bindTouchBtn('[data-touch="next"]', 'next', false);
    bindTouchBtn('[data-touch="camera"]', 'camera', false);
    bindTouchBtn('[data-touch="binoc"]', 'binoc', false);
    bindTouchBtn('[data-touch="skip"]', 'skip', false);

    const trayBtn = root.querySelector('[data-touch="tray"]');
    if (trayBtn) {
      trayBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.isTouch = true;
        if (typeof App !== 'undefined') App.toggleTray();
      }, { passive: false });
    }

    const menuBtn = root.querySelector('[data-touch="menu"]');
    if (menuBtn) {
      menuBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.isTouch = true;
        if (typeof App !== 'undefined') App.togglePause();
      }, { passive: false });
    }

    const soundBtn = root.querySelector('[data-touch="sound"]');
    if (soundBtn) {
      soundBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.isTouch = true;
        if (typeof Sfx !== 'undefined') Sfx.toggle();
        if (typeof UI !== 'undefined') UI.updateSoundIcon();
        if (typeof App !== 'undefined') App.soundChanged();
        if (typeof UI === 'undefined') soundBtn.textContent = (typeof Sfx !== 'undefined' && Sfx.enabled) ? 'ЗВУК' : 'ТИХО';   // значок ставит UI.updateSoundIcon
      }, { passive: false });
    }

    const fullBtn = root.querySelector('[data-touch="full"]');
    if (fullBtn) {
      fullBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.isTouch = true;
        this.toggleFullscreen();
      }, { passive: false });
    }

    const fighterBtn = root.querySelector('[data-touch="fighter"]');
    if (fighterBtn) {
      fighterBtn.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.isTouch = true;
        this.cycleFighter();
      }, { passive: false });
    }
  },
  updateTouchControls(sc, turn, ctl) {
    if (!this.touchRoot) return;
    const inBattle = !!(sc && (typeof App === 'undefined' || !App.demo) && (typeof UI === 'undefined' || !UI.cur));
    const show = this.isTouch && inBattle;
    this.touchRoot.classList.toggle('hidden', !show);
    if (!show) return;

    const fighterBtn = this.touchRoot.querySelector('[data-touch="fighter"]');
    if (fighterBtn) {
      fighterBtn.classList.toggle('hidden', !(sc.simul && ctl && ctl.mine && turn && turn.phase === 'aim'));
    }

    const rotBtn = this.touchRoot.querySelector('[data-touch="rotate"]');
    if (rotBtn) {
      const showRot = !!(ctl && ctl.mine && turn && turn.phase === 'aim' && (turn.weapon === 'girder' || (typeof SPIN_WEAPONS !== 'undefined' && SPIN_WEAPONS.has(turn.weapon))));
      rotBtn.classList.toggle('hidden', !showRot);
    }

    const fireBtn = this.touchRoot.querySelector('[data-touch="fire"]');
    if (fireBtn && ctl) {
      fireBtn.classList.toggle('active', !!(ctl.charging || this.touchKeys.fire));
    }
  },
  cycleFighter() {
    if (typeof App === 'undefined' || !App.ctl || !App.sc || !App.sc.simul) return;
    const sc = App.sc, T = App.remote ? App.remote.latestTurn : sc.turn;
    if (!T || !App.ctl.mine || T.phase !== 'aim') return;
    const list = sc.soldiers.filter(s => s.team === T.team && s.alive && !s.gone && !(T.usedSids || []).includes(s.id));
    if (list.length <= 1) return;
    const curIdx = list.findIndex(s => s.id === T.sid);
    const next = list[(curIdx + 1) % list.length];
    if (next) App.ctl.selectFighter(sc, T, next.name);
  },
  endFrame() { this.checkBinoc(); this.pressed = {}; this.touchPressed = {}; this.numbers = []; this.mouse.clicked = [false, false, false]; this.mouse.moved = false; this.mouse.dx = this.mouse.dy = 0; },
};

class LocalController {
  constructor(send) {
    this.send = send; this.myTeams = []; this.aim = -0.5; this.aimMode = 'mouse'; this.charging = false; this.chargeByMouse = false;
    this.power = 0; this.key = null; this.lastSig = ''; this.sendT = 0; this.mouseW = { x: 0, y: 0 }; this.mine = false; this.pendingTarget = false; this.scopeOn = false; this.scopeWeapon = null; this.scopePoint = null; this.scopeIdle = 0; this.scopeSway = 0; this.aimPoint = null; this.aimWeapon = null; this.numberInput = ''; this.numberEntry = false; this.fighterNumberInput = ''; this.fighterNumberEntry = false; this.choice = null; this.panSpeeds = new Map();
  }
  available(sc, T) {
    const tm = sc.teams[T.team]; if (!tm) return [];
    return (typeof WEAPON_ORDER !== 'undefined' ? WEAPON_ORDER : WEAPONS).filter(w => tm.ammo[w.id] !== undefined && tm.ammo[w.id] !== 0 && !(w.minRound && (sc.round || T.round) < w.minRound));
  }
  /** скорость обзора — личный выбор команды только в текущем бою; смена оружия и возврат камеры его сохраняют */
  panTeam(turn) { return this.myTeams.length === 1 ? this.myTeams[0] : turn && this.myTeams.includes(turn.team) ? turn.team : null; }
  panFactor(team) { return this.panSpeeds.get(team) ?? 1; }
  adjustPanSpeed(team, dy) {
    const factor = clamp(this.panFactor(team) * (dy < 0 ? 1.2 : 1 / 1.2), 1 / 16, 16);
    this.panSpeeds.set(team, factor); return factor;
  }
  /** чья команда выбирает оружие заранее: против компьютера и по сети — своя; на одном экране обе команды ходят с одной
      клавиатуры, поэтому заранее не выбирают */
  preTeamOf(sc, T) {
    if (sc.simul) return this.myTeams.includes(T.team) ? T.team : null;
    return this.myTeams.length === 1 ? this.myTeams[0] : null;
  }
  /** во время хода соперника (или после своего выстрела) Q/E, цифры и панель оружия выбирают оружие на свой следующий ход */
  preselect(sc, T) {
    const team = T && T.phase !== 'over' ? this.preTeamOf(sc, T) : null; this.preTeam = team;
    if (team === null) return;
    const tm = sc.teams[team]; if (!tm) return;
    const list = (typeof WEAPON_ORDER !== 'undefined' ? WEAPON_ORDER : WEAPONS).filter(w => tm.ammo[w.id] !== undefined && tm.ammo[w.id] !== 0);
    if (!list.length) return;
    const pick = (id) => { if (!list.some(w => w.id === id)) { Sfx.play('denied'); return; } this.preselectId(id); };
    const cur = (this.preChoice && performance.now() - this.preChoice.time < 1500 ? this.preChoice.id : null) || tm.nextW || tm.lastW || list[0].id;
    for (const dir of [Keys.hit('prev') ? -1 : 0, Keys.hit('next') ? 1 : 0]) {
      if (!dir) continue; let i = list.findIndex(w => w.id === cur); i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length; pick(list[i].id);
    }
    const codes = Input.numbers.length ? Input.numbers.splice(0) : [];
    for (const code of codes) {
      const m = /^(Digit|Numpad)(\d)$/.exec(code); if (!m || (m[1] === 'Digit' && sc.simul)) continue;
      const d = m[2];
      if (this.preEntry) { this.preInput += d; if (this.preInput.length < 2) continue; const n = +this.preInput; this.preEntry = false; this.preInput = ''; const w = WEAPON_ORDER[n - 1]; if (w) pick(w.id); else Sfx.play('denied'); }
      else if (d === '0') { this.preEntry = true; this.preInput = ''; }
      else { const w = WEAPON_ORDER[+d - 1]; if (w) pick(w.id); }
    }
  }
  preselectId(id) { this.preChoice = { id, time: performance.now() }; this.send({ c: 'nextw', id }); Sfx.play('select'); }
  select(id) { this.numberEntry = false; this.numberInput = ''; this.fighterNumberEntry = false; this.fighterNumberInput = ''; this.choice = { id, time: performance.now() }; this.send({ c: 'weapon', id }); this.pendingTarget = false; Sfx.play('select'); }
  cycle(sc, T, dir) {
    const list = this.available(sc, T); if (!list.length) return;
    const current = this.choice && performance.now() - this.choice.time < 1200 ? this.choice.id : T.weapon;
    let i = list.findIndex(w => w.id === current); i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length; this.select(list[i].id); this.numberInput = '';
  }
  selectFighter(sc, T, number) {
    const fighter = sc.soldiers.find(s => s.team === T.team && String(s.name) === String(number));
    if (!sc.simul || !this.myTeams.includes(T.team) || T.phase !== 'aim' || T.shots !== 0 || T.charge >= 0 || this.charging || this.pendingShot || !fighter || !fighter.alive || fighter.gone || (T.usedSids || []).includes(fighter.id)) { Sfx.play('denied'); return false; }
    if (fighter.id === T.sid && !sc.latestTurn) return false;
    this.numberEntry = this.fighterNumberEntry = false; this.numberInput = this.fighterNumberInput = '';
    this.send({ c: 'ctrl', l: false, r: false, u: false, d: false, pw: -1 });
    this.send({ c: 'soldier', number }); this.lastSig = ''; Sfx.play('select'); return true;
  }
  chooseNumber(sc, T) {
    const queued = Input.numbers.length > 0, codes = queued ? Input.numbers.splice(0) : Object.keys(Input.pressed);
    let changedFighter = false;
    for (const code of codes) {
      const m = /^(Digit|Numpad)(\d)$/.exec(code); if (!m || (!queued && !Input.pressed[code])) continue;
      Input.pressed[code] = false;
      // верхние цифры выбирают бойца только в непрерывном бою; в обычном бою они, как и Num, выбирают оружие по номеру
      // (на клавиатуре без цифрового блока иначе оружие по номеру не выбрать)
      const fighter = m[1] === 'Digit' && !!sc.simul, digit = m[2]; let number;
      const entry = fighter ? 'fighterNumberEntry' : 'numberEntry', input = fighter ? 'fighterNumberInput' : 'numberInput';
      if (this[entry]) {
        this[input] += digit;
        if (this[input].length < 2) continue;
        number = +this[input]; this[entry] = false; this[input] = '';
      } else if (digit === '0') { this[entry] = true; this[input] = ''; continue; }
      else number = +digit;
      if (fighter) { changedFighter = this.selectFighter(sc, T, number) || changedFighter; continue; }
      const list = typeof WEAPON_ORDER !== 'undefined' ? WEAPON_ORDER : WEAPONS, weapon = list[number - 1];
      if (weapon && this.available(sc, T).some(w => w.id === weapon.id)) this.select(weapon.id);
      else Sfx.play('denied');
    }
    return changedFighter;
  }
  hint(sc, T) {
    if (this.fighterNumberEntry && sc.simul && T.phase === 'aim') return `Номер бойца: ${this.fighterNumberInput || '…'} — введите ещё ${this.fighterNumberInput ? 'одну цифру' : 'две цифры'}`;
    if (this.numberEntry && T.phase === 'aim') return `Номер оружия: ${this.numberInput || '…'} — введите ещё ${this.numberInput ? 'одну цифру' : 'две цифры'} (01–41). Q/E — отменить и листать`;
    const W = WEAPON[T.weapon], text = this.weaponHint(sc, T);
    return text && T.phase === 'aim' && W && (W.mode === 'target' || W.mode === 'place' || W.mode === 'tcharge' && !T.target) ? text + '. Зажмите колесо и прокручивайте — скорость обзора' : text;
  }
  weaponHint(sc, T) {
    const W = WEAPON[T.weapon]; if (!W) return '';
    const key = id => Keys.label(id), walk = `${key('left')} / ${key('right')}`, fire = key('fire');
    if (T.phase === 'retreat') return `Отступайте! ${walk} — ходьба, ${key('jump')} — прыжок`;
    if (T.phase === 'use') {
      if (T.weapon === 'robot') return `${key('jump')} — прыжок робота, ЛКМ / ${fire} — взорвать`;
      if (T.weapon === 'jetpack') return `${key('up')} / ${key('jump')} — тяга, ${walk} — в стороны, ЛКМ — выключить`;
      if (T.weapon === 'airstrike') return `ЛКМ / ${fire} — сброс с упреждением: бомбы летят вперёд. Не успели — сброс у края экрана`;
      if (T.weapon === 'orbital') return `${walk} — ведите луч к цели`;
      if (typeof STEER_FIRE !== 'undefined' && STEER_FIRE.has(T.weapon)) return `Огонь! Мышь или ${key('aimUp')} / ${key('aimDown')} — ведите ствол вверх-вниз`;
      return 'Огонь!';
    }
    if (W.id === 'sniper') return `Мышь — прицел по всей карте. ЛКМ или ${fire} — выстрел. ${key('precise')} — точнее клавишами. ${key('optic')} — ${this.scopeOn ? 'убрать' : 'показать'} оптику`;
    if (W.id === 'airstrike') return `Кликните по цели: самолёт пройдёт над ней, сброс — ЛКМ или ${fire}`;
    if (W.id === 'lightning') return 'Кликните: туча уйдёт по ветру и ударит в самую высокую точку';
    if (W.id === 'orbital') return `Кликните: спутник наведётся с ошибкой, луч доводите клавишами ${walk}`;
    if (W.id === 'nuke') return 'Кликните по району: ракету сносит ветром, есть разброс — цельтесь с поправкой';
    switch (W.mode) {
      case 'charge': return `${key('aimUp')} / ${key('aimDown')} — прицел. Зажмите ${fire} или ЛКМ и отпустите для выстрела`;
      case 'tcharge': return T.target ? 'Цель захвачена с ошибкой. Зажмите ЛКМ для выстрела' : 'Кликните по цели на карте';
      case 'instant': return W.shots ? `${key('aimUp')} / ${key('aimDown')} — прицел. Выстрел ${Math.min(T.shots + 1, W.shots)} из ${W.shots} — ${fire} или ЛКМ` : `${key('aimUp')} / ${key('aimDown')} — прицел. ${fire} или ЛКМ — огонь`;
      case 'target': return W.id === 'lightning' ? 'Кликните над целью: туча появится там, ветер снесёт её по стрелке, через 2 с молния ударит в самую высокую точку под тучей' : 'Кликните по точке на карте';
      case 'place': return `ЛКМ — поставить, ${key('rotate')} — повернуть`;
      case 'drop': return `ЛКМ или ${fire} — положить под ноги`;
      case 'self': return W.id === 'skip' ? `ЛКМ или ${fire} — пропустить ход` : `ЛКМ или ${fire} — применить`;
      case 'active': return 'ЛКМ — включить джетпак';
    }
    return '';
  }
  /** точка оптики хранится в мире: движение обзора и масштаб не меняют выбранную цель */
  clampScope(sc) {
    if (!this.scopePoint) return;
    if (Number.isFinite(sc.W)) this.scopePoint.x = clamp(this.scopePoint.x, 0, sc.W - 1);
    if (Number.isFinite(sc.H)) this.scopePoint.y = clamp(this.scopePoint.y, -900, sc.H - 1);
  }
  syncScope(sc, cam, sw, sh) {
    const p = this.scopePoint, s = sc.soldiers.find(o => o.id === (sc.latestTurn || sc.turn).sid);
    if (!p || !s || this.binoc || this.pendingShot) return;
    this.mouseW.x = p.x; this.mouseW.y = p.y;
    if (this.aimMode === 'mouse') this.base = Math.atan2(p.y - (s.y - GUN_Y), p.x - s.x);
    this.aim = this.base + this.scopeSway;
    if (Input.locked && cam.toScreen) {
      const [x, y] = cam.toScreen(p.x, p.y, sw, sh);
      Input.mouse.x = clamp(x, 0, sw - 1); Input.mouse.y = clamp(y, 0, sh - 1);
    }
  }
  returnScope(sc, cam, sw, sh) {
    const s = sc.soldiers.find(o => o.id === (sc.latestTurn || sc.turn).sid); if (!s || !this.scopePoint) return;
    const d = Math.min(sw, sh) * 0.24 / cam.z;
    this.scopePoint.x = s.x + Math.cos(this.base) * d; this.scopePoint.y = s.y - GUN_Y + Math.sin(this.base) * d;
    this.clampScope(sc); this.scopeSway = this.swayAmp = 0; this.scopeIdle = 1;
    this.syncScope(sc, cam, sw, sh);
  }
  cancelCharge() { if (this.charging) { this.charging = false; Sfx.chargeStop(); } }
  /** скорострельное оружие с быстрыми пулями: камера за ними не успевает, поэтому сначала обзор переходит туда, куда они
      попадут, а потом выстрел. Если и свой боец, и место попадания уже в кадре — камера стоит, выстрел сразу */
  fireFast(sc, cam, sw, sh, s, cmd, id) {
    const p = predictShot(sc, s, cmd.aim, id);
    // место попадания уже видно (в кадре или через оптику снайперки) — камера не двигается и не центруется, выстрел сразу
    if (p && (cam.hitVisible ? cam.hitVisible(p.x, p.y, sw, sh) : cam.sees(p.x, p.y, sw, sh, 0.05))) { this.fireHere(sc, cam, s, sw, sh, cmd); return; }
    // пули уйдут в пустоту: боец в кадре — выстрел сразу, иначе сначала обзор к бойцу
    if (!p) { if (this.needsCenter(sc, cam, s, sw, sh)) this.centerThenFire(cam, s, sh, cmd); else this.fireHere(sc, cam, s, sw, sh, cmd); return; }
    // попадание за кадром: обзор плавно встаёт точно по центру первого попадания, выстрел — когда камера остановилась
    cam.manualActive = false; cam.offsetX = 0; cam.offsetY = 0;
    this.send({ c: 'look', x: Math.round(p.x), y: Math.round(p.y) });
    cam.shot = { x: p.x, y: p.y, t: 2.2, k: 'shot' };   // свой экран не ждёт ответа хоста
    this.pendingShot = { cmd, t: 0, f: cam.shot, p, fromPan: true };
  }
  /** обзор уведён стрелками от бойца */
  camPanned(cam) { return !!(cam.manualActive || Math.abs(cam.offsetX || 0) > 3 || Math.abs(cam.offsetY || 0) > 3); }
  /** перед выстрелом обзор надо сначала вернуть: его увели стрелками или он стоит там, куда его увели оптикой/краем экрана
      (дальше 24 px от обычного кадра у бойца) */
  needsCenter(sc, cam, s, sw, sh) {
    if (this.bodyInView(cam, s, sw, sh)) return false;   // боец и так целиком в кадре: обзор не трогаем
    if (this.camPanned(cam)) return true;
    if (!cam.hold || !cam.homeOf) return false;
    const h = cam.homeOf(s, sc, sw, sh); return Math.hypot(cam.x - h.x, cam.y - h.y) * cam.z > 24;
  }
  /** весь боец в кадре (с запасом в несколько пикселей от краёв экрана) */
  bodyInView(cam, s, sw, sh, m = 6) {
    if (!cam || !cam.toScreen || !s) return false;
    const [x0, y0] = cam.toScreen(s.x - 12, s.y - 40, sw, sh), [x1, y1] = cam.toScreen(s.x + 12, s.y + 2, sw, sh);
    return x0 >= m && y0 >= m && x1 <= sw - m && y1 <= sh - m;
  }
  /** выстрел без перелёта камеры. Если обзор был сдвинут (стрелками, оптикой, краем экрана), кадр остаётся на месте и после
      выстрела: камера не возвращается к бойцу, пока он сам не пошёл, его не отбросило или камере не нужно вести снаряд */
  fireHere(sc, cam, s, sw, sh, cmd) {
    if (cam && cam.homeOf && sc) {
      const h = cam.homeOf(s, sc, sw, sh);
      cam.postHold = Math.hypot(cam.x - h.x, cam.y - h.y) * cam.z > 24 ? { x: cam.x, y: cam.y, k: 'ph', key: this.key } : null;
    }
    this.send(cmd);
  }
  /** после стрелок: сначала обзор возвращается к бойцу (тем же плавным перелётом, что и к месту попадания), выстрел — когда
      камера остановилась */
  centerThenFire(cam, s, sh, cmd) {
    cam.manualActive = false; cam.offsetX = 0; cam.offsetY = 0;
    const home = cam.homeOf && typeof App !== 'undefined' && App.sc ? cam.homeOf(s, App.sc, App.ren.sw, App.ren.sh) : { x: s.x, y: s.y - 58 };
    cam.shot = { x: home.x, y: home.y, t: 2.2, k: 'shot' };
    this.pendingShot = { cmd, t: 0, f: cam.shot, p: { x: s.x, y: s.y }, fromPan: true };
  }
  suspend() {
    this.cancelCharge();
    if (this.suspended) return;
    this.suspended = true; this.lastSig = '';
    this.send({ c: 'ctrl', l: false, r: false, u: false, pw: -1 });
  }
  update(dt, sc, cam, sw, sh, T) {
    this.suspended = false;
    const w = cam.toWorld(Input.mouse.x, Input.mouse.y, sw, sh);
    if (!this.scopePoint || T.weapon !== 'sniper' || T.phase !== 'aim') { this.mouseW.x = w[0]; this.mouseW.y = w[1]; }
    const s = sc.soldiers.find(o => o.id === T.sid);
    this.mine = !!(s && s.alive && !s.gone && this.myTeams.includes(T.team) && T.phase !== 'over');
    if (!this.mine) { this.cancelCharge(); this.key = null; this.scopeOn = false; this.scopeWeapon = null; this.scopePoint = null; this.edgePan = false; this.preselect(sc, T); return; }
    this.preTeam = null;
    const key = T.round + ':' + T.sid, newTurn = this.key !== key;
    if (this.scopeAfter > 0) this.scopeAfter = Math.max(0, this.scopeAfter - dt);
    if (this.key !== key) this.scopeAfter = 0;
    else if (T.weapon === 'sniper' && T.shots > (this.sniperShots || 0) && this.scopeLast) this.scopeAfter = 1.3;   // выстрел снайперки: оптика остаётся на месте выстрела
    this.sniperShots = T.weapon === 'sniper' ? T.shots : 0;
    if (this.key !== key) { this.scopeOn = false; this.scopeWeapon = null; this.scopePoint = null; this.aimPoint = null; this.aimWeapon = null; this.key = key; this.aim = this.base = s.aim; this.power = 0; this.cancelCharge(); this.pendingTarget = false; this.lastSig = ''; this.breath = 2.5; this.pendingShot = null; this.numberInput = ''; this.numberEntry = false; this.fighterNumberInput = ''; this.fighterNumberEntry = false; this.choice = null; }
    if (this.base === undefined) this.base = this.aim;
    if (T.target) this.pendingTarget = false;
    const W = WEAPON[T.weapon] || WEAPON.bazooka; const phase = T.phase;
    const canAct = phase === 'aim' && !!WEAPON[T.weapon]; const jet = phase === 'use' && T.weapon === 'jetpack';
    // очередь, струя, залп: пока оружие стреляет, ствол ведётся вверх-вниз мышью или клавишами прицела (развернуться назад
    // нельзя). Разброс и отдачу каждой пули по-прежнему добавляет сама игра — к тому направлению, куда сейчас смотрит ствол
    const steerFire = phase === 'use' && typeof STEER_FIRE !== 'undefined' && STEER_FIRE.has(T.weapon);
    const canMove = phase === 'aim' || phase === 'retreat' || jet;
    // клавиши — по таблице Keys (настраиваются; по физической клавише, раскладка не важна)
    const left = Keys.down('left'), right = Keys.down('right');
    // W/S — лестница/тяга; I/K — наклон ствола. Стрелки зарезервированы для камеры.
    const up = Keys.down('up'), down = Keys.down('down'), aimUp = Keys.down('aimUp'), aimDown = Keys.down('aimDown'), precise = Keys.down('precise');
    // мышь также выбирает точку для авиаудара, молнии и т. п.
    const pickPoint = W.mode === 'target' || W.mode === 'place' || (W.mode === 'tcharge' && !T.target);
    // цель дальнобойного оружия может быть за экраном: курсор у края экрана сам ведёт обзор (render.js, Camera.edgeDir)
    this.edgePan = canAct && (W.id === 'sniper' || pickPoint);
    // Прежняя оптика ×3 появляется при выборе снайперки; Ctrl скрывает/показывает, Q/E всегда листают оружие.
    const sniperScope = T.weapon === 'sniper' && canAct;
    const scopeStart = sniperScope && this.scopeWeapon !== 'sniper';
    // начало хода: оптика в исходной позиции — у бойца по направлению ствола. Точка под мышью сюда не годится: в первом кадре
    // нового хода камера ещё смотрит туда, где был прошлый ход (за километр от бойца). Выбор снайперки в ходе — к мыши
    if (scopeStart) {
      this.scopeOn = true; this.aimMode = 'mouse';
      if (newTurn) { const d = Math.min(sw, sh) * 0.24 / (cam.tz || cam.z || 1); this.scopePoint = { x: s.x + Math.cos(this.base) * d, y: s.y - GUN_Y + Math.sin(this.base) * d }; this.clampScope(sc); }
      else this.scopePoint = { x: w[0], y: w[1] };
      this.scopeIdle = 1; this.swayAmp = this.scopeSway = 0;
    }
    if (!sniperScope) { this.scopeOn = false; this.scopePoint = null; this.swayAmp = this.scopeSway = 0; }
    this.scopeWeapon = sniperScope ? 'sniper' : null;
    // боец идёт со снайперкой: линза идёт вместе с ним (направление ствола не меняется), а обзор следует за бойцом
    // (render.js). Если вместе с бойцом линза в кадр не помещается, она возвращается на исходную позицию у бойца по стволу
    const scopeWalk = sniperScope && !!this.scopePoint && SCOPE_WALK.has(s.st);
    if (scopeWalk && !newTurn && this.scopeSx !== undefined) {
      this.scopePoint.x += s.x - this.scopeSx; this.scopePoint.y += s.y - this.scopeSy;
      const z = cam.z || 1, pad = (Math.round(Math.min(sw, sh) * 0.16) + 16) / z, m = 70 / z;
      if (!this.scopeWalking && (Math.abs(this.scopePoint.x - s.x) > sw / z - pad - m || Math.abs(this.scopePoint.y - (s.y - 20)) > sh / z - pad - m)) {
        const d = Math.min(sw, sh) * 0.24 / z; this.scopePoint.x = s.x + Math.cos(this.base) * d; this.scopePoint.y = s.y - GUN_Y + Math.sin(this.base) * d;
      }
      this.clampScope(sc);
    }
    this.scopeWalking = scopeWalk; this.scopeSx = s.x; this.scopeSy = s.y;
    if (sniperScope && Keys.hit('optic') && T.shots === 0 && !this.charging) { this.scopeOn = !this.scopeOn; Sfx.play('select'); Keys.eat('optic'); }
    if (sniperScope && this.scopeOn && this.scopePoint) this.scopeLast = { x: this.scopePoint.x, y: this.scopePoint.y, aim: this.aim };
    else if (!(T.weapon === 'sniper' && this.scopeAfter > 0)) this.scopeLast = null;
    // наведение мышью или клавишами I/K — работает то, чем пользовались последним, даже со скрытой оптикой
    const previousAimMode = this.aimMode;
    if (Input.mouse.moved || (sniperScope && Input.mouse.clicked[0])) this.aimMode = 'mouse';
    if (aimUp || aimDown) this.aimMode = 'keys';
    const mouseAim = (canAct || steerFire) && this.aimMode === 'mouse';
    if (sniperScope && !this.binoc) {
      if (mouseAim) {
        if ((scopeStart && !newTurn) || (Input.mouse.clicked[0] && previousAimMode === 'keys')) {
          this.scopePoint.x = w[0]; this.scopePoint.y = w[1];
        } else {
          // Сдвиг мыши ведёт прежнюю мировую точку и без захвата: движение камеры не переопределяет цель.
          this.scopePoint.x += (Input.mouse.dx || 0) / cam.z; this.scopePoint.y += (Input.mouse.dy || 0) / cam.z;
        }
      }
      this.clampScope(sc); this.mouseW.x = this.scopePoint.x; this.mouseW.y = this.scopePoint.y;
      if (mouseAim) this.scopeRange = Math.max(1, Math.hypot(this.mouseW.x - s.x, this.mouseW.y - (s.y - GUN_Y)));
    }
    // экранный курсор при масштабе меняет мировые координаты; направление оружия меняет только новое наведение
    if (mouseAim && !sniperScope && !pickPoint && !this.binoc) {
      if (!this.aimPoint || this.aimWeapon !== T.weapon || Input.mouse.moved) this.aimPoint = { x: w[0], y: w[1] };
      this.mouseW.x = this.aimPoint.x; this.mouseW.y = this.aimPoint.y;
    }
    this.aimWeapon = canAct || steerFire ? T.weapon : null;
    if (mouseAim && (!this.binoc || pickPoint)) this.base = Math.atan2(this.mouseW.y - (s.y - GUN_Y), this.mouseW.x - s.x);
    else {
      let face = Math.cos(this.base) >= 0 ? 1 : -1;
      if (left !== right && !jet && !steerFire) face = left ? -1 : 1;
      let elev = angNorm(face > 0 ? -this.base : this.base - Math.PI);
      const sp = precise ? 0.35 : 1.3;
      if (aimUp) elev += dt * sp; if (aimDown) elev -= dt * sp;
      elev = clamp(elev, -1.55, 1.55);
      this.base = face > 0 ? -elev : Math.PI + elev;
    }
    if (sniperScope && !this.binoc && this.aimMode === 'keys') {
      const d = this.scopeRange || Math.max(1, Math.hypot(this.scopePoint.x - s.x, this.scopePoint.y - (s.y - GUN_Y)));
      this.scopePoint.x = s.x + Math.cos(this.base) * d; this.scopePoint.y = s.y - GUN_Y + Math.sin(this.base) * d;
      this.clampScope(sc); this.mouseW.x = this.scopePoint.x; this.mouseW.y = this.scopePoint.y;
      this.base = Math.atan2(this.mouseW.y - (s.y - GUN_Y), this.mouseW.x - s.x);
    }
    // ни одно оружие не колеблется при прицеливании (ни оптика, ни раненая рука): ствол смотрит ровно туда, куда наведён
    if (steerFire) {
      // во время очереди — только вверх-вниз в ту сторону, куда боец стрелял
      const sk = key + ':' + T.shots; if (this.steerKey !== sk) { this.steerKey = sk; this.steerFace = Math.cos(s.aim) >= 0 ? 1 : -1; }
      const f = this.steerFace, elev = clamp(angNorm(f > 0 ? -this.base : this.base - Math.PI), -1.55, 1.55);
      this.base = f > 0 ? -elev : Math.PI + elev;
    }
    const edgeMove = sniperScope && !Input.locked && Input.mouse.inside && !this.binoc && cam.edgeDir && cam.edgeDir(Input.mouse, sw, sh);
    const aiming = !this.binoc && (Input.mouse.moved || aimUp || aimDown || edgeMove);
    if (sniperScope) {
      if (precise && this.breath > 0) this.breath = Math.max(0, this.breath - dt);
      else if (!precise) this.breath = Math.min(2.5, this.breath + dt * 0.7);
      this.scopeIdle = aiming ? 0 : this.scopeIdle + dt;
    }
    this.swayAmp = this.scopeSway = 0;
    this.aim = this.base;
    // выстрел ждёт, пока обзор дойдёт до кадра выстрела (к месту попадания за кадром или обратно к бойцу после стрелок):
    // один и тот же плавный перелёт, выстрел — когда камера закончила его и стоит; ствол всё это время смотрит туда же
    if (this.pendingShot) {
      const ps = this.pendingShot; ps.t += dt; this.aim = this.base = ps.cmd.aim;
      const step = ps.cx !== undefined ? Math.hypot(cam.x - ps.cx, cam.y - ps.cy) * cam.z : 1e9; ps.cx = cam.x; ps.cy = cam.y;
      const arrived = !!cam.shotTook && !cam.glide && step < 0.8;   // обзор ведёт кадр выстрела, перелёт закончен, камера стоит (или упёрлась в край карты)
      if (arrived || ps.t > 1.6 || phase !== 'aim') { if (phase === 'aim') this.send(ps.cmd); this.pendingShot = null; }
    }
    if (phase === 'aim' && T.shots === 0 && !this.charging && !this.pendingShot) {
      if (Keys.hit('prev')) this.cycle(sc, T, -1); if (Keys.hit('next')) this.cycle(sc, T, 1);
      if (this.chooseNumber(sc, T)) return;
    } else if (phase !== 'aim' && phase !== 'use') this.preselect(sc, T);   // свой ход уже сделан: выбор — на следующий ход
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
            if (!held) {
              const cmd = { c: 'fire', aim: this.aim, pw: Math.max(0.06, this.power) };
              if (this.needsCenter(sc, cam, s, sw, sh)) this.centerThenFire(cam, s, sh, cmd);
              else this.fireHere(sc, cam, s, sw, sh, cmd);
              this.cancelCharge();
            }
          }
          break;
        }
        case 'instant': case 'drop': case 'self': case 'active':
          if ((mFire || kFire) && !this.pendingShot) {
            const cmd = { c: 'fire', aim: this.aim, pw: 1 };
            if (typeof FAST_SHOT !== 'undefined' && FAST_SHOT[W.id] && cam.sees) this.fireFast(sc, cam, sw, sh, s, cmd, W.id);
            else if (this.needsCenter(sc, cam, s, sw, sh)) this.centerThenFire(cam, s, sh, cmd);
            else this.fireHere(sc, cam, s, sw, sh, cmd);
          }
          break;
        case 'target': case 'place':
          if (mFire || kFire) this.send({ c: 'fire', aim: this.aim, pw: 1, tx: Math.round(this.mouseW.x), ty: Math.round(this.mouseW.y) }); break;
      }
    }
    const climbing = !jet && !precise && (sc.map.ladders || []).some(l => Math.abs(l.x-s.x)<19 && s.y>=l.y1-8 && s.y<=l.y2+8);
    const steer = phase === 'use' && T.weapon === 'orbital';
    const ctrl = { c: 'ctrl', l: (canMove || steer) && left, r: (canMove || steer) && right, u: canMove && (jet ? (up || Keys.down('jump')) : climbing && up), d: canMove && climbing && down, aim: Math.round(this.aim * 1000) / 1000, pw: this.charging ? Math.round(this.power * 100) / 100 : -1 };
    if (canAct && (pickPoint || W.id === 'sniper')) {
      const preview = W.id === 'sniper' && this.scopePoint ? this.scopePoint : this.mouseW;
      ctrl.tx = Math.round(preview.x); ctrl.ty = Math.round(preview.y);
    }
    const sig = ctrl.l + '|' + ctrl.r + '|' + ctrl.u + '|' + ctrl.aim + '|' + ctrl.pw;
    this.sendT -= dt;
    if (this.sendT <= 0) { this.send(ctrl); this.lastSig = sig; this.sendT = 1 / 30; }
  }
}
