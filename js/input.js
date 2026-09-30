'use strict';
/* =========================================================
   Ввод (клавиатура + мышь) и локальный контроллер игрока
   ========================================================= */
const Input = {
  keys: {}, pressed: {}, mouse: { x: 0, y: 0, down: [false, false, false], clicked: [false, false, false], moved: false },
  wheel: 0, typing: false, drag: null, onClickRight: null, onBinoc: null, onWheel: null,
  GAME_KEYS: new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'KeyF']),
  init(cv) {
    window.addEventListener('keydown', (e) => {
      if (this.typing || (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT'))) return;
      if (this.GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = [false, false, false]; this.releaseRight(); });
    window.addEventListener('contextmenu', (e) => { if (this.drag || this.binocOn) e.preventDefault(); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousemove', (e) => {
      const dx = e.clientX - this.mouse.x, dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = true;
      // кнопку отпустили там, где событие не дошло (за окном, над интерфейсом) — бинокль всё равно выключаем
      if (this.drag && this.drag.btn === 2 && !(e.buttons & 2)) { this.releaseRight(); return; }
      if (this.drag) { this.drag.dist += Math.abs(dx) + Math.abs(dy); this.checkBinoc(); }
    });
    cv.addEventListener('mousedown', (e) => {
      Sfx.resume();
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
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
    cv.addEventListener('wheel', (e) => { e.preventDefault(); if (this.onWheel) this.onWheel(e.deltaY, e.clientX, e.clientY); }, { passive: false });
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
    this.power = 0; this.key = null; this.lastSig = ''; this.sendT = 0; this.mouseW = { x: 0, y: 0 }; this.mine = false; this.pendingTarget = false;
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
      if (T.weapon === 'robot') return 'ЛКМ / Enter — взорвать робота';
      if (T.weapon === 'jetpack') return 'W / Пробел — тяга, A/D — в стороны, ЛКМ — выключить';
      if (T.weapon === 'airstrike') return 'ЛКМ / Enter — СБРОС! Бомбы летят вперёд: берите упреждение';
      if (T.weapon === 'orbital') return 'A / D — ведите луч к цели';
      return 'Огонь!';
    }
    if (W.id === 'sniper') return this.breath <= 0.05 ? 'Руки дрожат — отпустите Shift и отдышитесь' : 'Мышь — прицел, ЛКМ или F — выстрел. Shift — задержать дыхание';
    if (W.id === 'airstrike') return 'Кликните по району: самолёт пройдёт над ним, бомбы сбрасываете сами';
    if (W.id === 'lightning') return 'Кликните: туча уйдёт по ветру и ударит в самую высокую точку';
    if (W.id === 'orbital') return 'Кликните: спутник наведётся с ошибкой, луч доводите клавишами A/D';
    if (W.id === 'nuke') return 'Кликните по району: разброс и снос ветром — целься с поправкой';
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
    if (!this.mine) { this.cancelCharge(); this.key = null; return; }
    const key = T.round + ':' + T.sid;
    if (this.key !== key) { this.key = key; this.aim = this.base = s.aim; this.power = 0; this.cancelCharge(); this.pendingTarget = false; this.lastSig = ''; this.breath = 2.5; }
    if (this.base === undefined) this.base = this.aim;
    if (T.target) this.pendingTarget = false;
    const W = WEAPON[T.weapon] || WEAPON.bazooka; const phase = T.phase;
    const canAct = phase === 'aim' && !!WEAPON[T.weapon]; const jet = phase === 'use' && T.weapon === 'jetpack';
    const canMove = phase === 'aim' || phase === 'retreat' || jet;
    const K = Input.keys, P = Input.pressed;
    const left = !!(K.KeyA || K.ArrowLeft), right = !!(K.KeyD || K.ArrowRight);
    // W/S — лазание по лестницам и тяга джетпака; стрелки ↑/↓ — только наклон ствола
    const up = !!K.KeyW, down = !!K.KeyS, aimUp = !!K.ArrowUp, aimDown = !!K.ArrowDown;
    // мышью наводится только снайперка; мышь также выбирает точку для авиаудара, молнии и т. п.
    const pickPoint = W.mode === 'target' || W.mode === 'place' || (W.mode === 'tcharge' && !T.target);
    const mouseAim = T.weapon === 'sniper' && canAct;
    if (mouseAim && !this.binoc) this.base = Math.atan2(this.mouseW.y - (s.y - GUN_Y), this.mouseW.x - s.x);
    else {
      let face = Math.cos(this.base) >= 0 ? 1 : -1;
      if (left !== right && !jet) face = left ? -1 : 1;
      let elev = angNorm(face > 0 ? -this.base : this.base - Math.PI);
      const sp = K.ShiftLeft || K.ShiftRight ? 0.35 : 1.3;
      if (aimUp) elev += dt * sp; if (aimDown) elev -= dt * sp;
      elev = clamp(elev, -1.55, 1.55);
      this.base = face > 0 ? -elev : Math.PI + elev;
    }
    // снайперский прицел «дышит»; Shift ненадолго задерживает дыхание
    let sway = 0;
    if (T.weapon === 'sniper' && canAct) {
      this.swayT = (this.swayT || 0) + dt;
      const hold = !!(K.ShiftLeft || K.ShiftRight);
      if (hold && this.breath > 0) this.breath = Math.max(0, this.breath - dt);
      else if (!hold) this.breath = Math.min(2.5, this.breath + dt * 0.7);
      const amp = hold && this.breath > 0 ? 0.005 : this.breath <= 0.05 ? 0.058 : 0.03;
      this.swayAmp = approach(this.swayAmp ?? amp, amp, 4, dt);
      sway = this.swayAmp * (Math.sin(this.swayT * 1.4) * 0.8 + Math.sin(this.swayT * 3.1 + 1.3) * 0.45);
    }
    this.aim = this.base + sway;
    if (phase === 'aim' && T.shots === 0 && !this.charging) {
      if (P.KeyQ) this.cycle(sc, T, -1); if (P.KeyE) this.cycle(sc, T, 1);
      for (let i = 1; i <= 6; i++) if (P['Digit' + i]) this.category(sc, T, i - 1);
    }
    if (P.KeyR && T.weapon === 'girder' && canAct) this.send({ c: 'rot', d: 1 });
    if (P.KeyR && SPIN_WEAPONS.has(T.weapon) && canAct && !this.charging) { this.send({ c: 'spin' }); Sfx.play('select'); }
    if (P.KeyP && (phase === 'aim' || phase === 'retreat')) this.send({ c: 'skip' });
    if (P.Space && (phase === 'aim' || phase === 'retreat') && !this.charging) this.send({ c: 'jump', d: left ? -1 : right ? 1 : 0 });
    // в бинокль клик не стреляет: мышь ведёт обзор (кроме оружия с выбором точки)
    const mFire = Input.mouse.clicked[0] && (!this.binoc || pickPoint), kFire = !!(P.Enter || P.KeyF);   // выстрел: ЛКМ, Enter или F
    if (phase === 'use') { if (mFire || kFire) this.send({ c: 'fire' }); }
    else if (canAct) {
      switch (W.mode) {
        case 'charge': case 'tcharge': {
          if (W.mode === 'tcharge' && !T.target) {
            if ((mFire || kFire) && !this.pendingTarget) { this.send({ c: 'target', x: Math.round(this.mouseW.x), y: Math.round(this.mouseW.y) }); this.pendingTarget = true; Sfx.play('select'); }
            break;
          }
          if (!this.charging) { if (mFire || kFire) { this.charging = true; this.power = 0; this.chargeDir = 1; this.chargeByMouse = mFire; Sfx.chargeStart(); } }
          else {
            const held = this.chargeByMouse ? Input.mouse.down[0] : !!(K.Enter || K.KeyF);
            // сила «пульсирует»: до максимума и обратно, пока кнопка зажата; выстрел — только при отпускании
            this.power += (this.chargeDir || 1) * dt / 1.15;
            if (this.power >= 1) { this.power = 1; this.chargeDir = -1; } else if (this.power <= 0.06) { this.power = 0.06; this.chargeDir = 1; }
            Sfx.chargeSet(this.power);
            if (!held) { this.send({ c: 'fire', aim: this.aim, pw: Math.max(0.06, this.power) }); this.cancelCharge(); }
          }
          break;
        }
        case 'instant': case 'drop': case 'self': case 'active':
          if (mFire || kFire) this.send({ c: 'fire', aim: this.aim, pw: 1 }); break;
        case 'target': case 'place':
          if (mFire || kFire) this.send({ c: 'fire', aim: this.aim, pw: 1, tx: Math.round(this.mouseW.x), ty: Math.round(this.mouseW.y) }); break;
      }
    }
    const climbing = !jet && !(K.ShiftLeft || K.ShiftRight) && (sc.map.ladders || []).some(l => Math.abs(l.x-s.x)<19 && s.y>=l.y1-8 && s.y<=l.y2+8);
    const steer = phase === 'use' && T.weapon === 'orbital';
    const ctrl = { c: 'ctrl', l: (canMove || steer) && left, r: (canMove || steer) && right, u: canMove && (jet ? (up || !!K.Space) : climbing && up), d: canMove && climbing && down, aim: Math.round(this.aim * 1000) / 1000, pw: this.charging ? Math.round(this.power * 100) / 100 : -1 };
    const sig = ctrl.l + '|' + ctrl.r + '|' + ctrl.u + '|' + ctrl.aim + '|' + ctrl.pw;
    this.sendT -= dt;
    if (this.sendT <= 0) { this.send(ctrl); this.lastSig = sig; this.sendT = 1 / 30; }
  }
}
