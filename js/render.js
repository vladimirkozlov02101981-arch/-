'use strict';
/* =========================================================
   Камера и отрисовка кадра: мир, вода/лава, прицел, HUD,
   миникарта
   ========================================================= */
const CAM_PRI = { rocket: 3, homing: 3, mortar: 3, drill: 3, mini: 2, grenade: 3, cluster: 3, sticky: 3, molotov: 3, bholeg: 3, bhole: 3, dynamite: 2, robot: 3, bomb: 2, nukem: 4, orbital: 3, jet: 1, frag: 1, bomblet: 1 };

CAM_PRI.plasma = 3;   // за пулями (до 18 000 ед/с) камера не гоняется — она держит стрелка или кадр выстрела, иначе рывки
const AIM_RETICLE = 78;
/** жёсткость пружины камеры (рад/с): спокойный переход к бойцу, кадр выстрела, слежение за снарядом */
const CAM_W = { calm: 6, shot: 8, track: 7.5 };   // прицел оружия: расстояние от плеча по линии ствола, игровых единиц (около двух ростов бойца)
/** ход уже сделан (отступление, всё оседает, пауза перед следующим ходом, конец боя): обзор не возвращается к сходившему
    бойцу, а стоит там, где показал результат; новый ход — кадр сразу сменяется на следующего бойца */
const CAM_HOLD = { retreat: 1, settle: 1, wait: 1, crate: 1, over: 1 };
const CAM_ATTACK = new Set(['rocket', 'homing', 'mortar', 'drill', 'mini', 'grenade', 'cluster', 'bomblet', 'sticky', 'molotov', 'bholeg', 'bhole', 'dynamite', 'mine', 'robot', 'bomb', 'nukem', 'jet', 'orbital', 'storm', 'bullet', 'plasma', 'acid', 'frag', 'tpg', 'fire', 'flame']);
function cameraAttack(e) { return !e.dead && CAM_ATTACK.has(e.k) && e.busy !== false && !(e.k === 'mine' && e.s === 1) && !(e.k === 'jet' && e.s); }

/* Камера: отдаление заканчивается на полном виде карты; приближение сохраняет прежний предел.
   Скорость ручного обзора приходит из личного контроллера текущего игрока. */
class Camera {
  constructor() { this.x = 1600; this.y = 900; this.z = 1; this.tz = 1; this.sx = 0; this.sy = 0; this.free = 0; this.userZ = null; this.inited = false; this.binoc = false; this.binocK = 0; this.edge = false; this.hold = false; this.shot = null; this.lookId = 0; this.lx = 0; this.ly = 0; this.leadE = null; this.vx = 0; this.vy = 0; this.track = false;
    this.turnKey = ''; this.lastT = null; this.aKey = ''; this.ay = 0; this.tKey = ''; this.glide = null; this.foe = false; this.fN = 0; this.scopeFocus = null; this.ownHold = 0; this.foeFocus = null; this.foeHold = 0; this.panFactor = 1; this.mapW = 6400; this.mapH = 1800; this.mapZoom = null; this.manual = null; this.manualKey = ''; this.offsetX = this.offsetY = 0; this.manualActive = false; this.observeAim = false; this.zoomV = 0; this.zoomAnchor = null; this.zoomPark = null; this.wasBinoc = false; }
  toScreen(wx, wy, sw, sh) { return [(wx - this.x) * this.z + sw / 2 + this.sx, (wy - this.y) * this.z + sh / 2 + this.sy]; }
  toWorld(px, py, sw, sh) { return [(px - sw / 2 - this.sx) / this.z + this.x, (py - sh / 2 - this.sy) / this.z + this.y]; }
  view(sw, sh, m = 0) { const hw = sw / 2 / this.z, hh = sh / 2 / this.z; return { x0: this.x - hw - m, y0: this.y - hh - m, x1: this.x + hw + m, y1: this.y + hh + m }; }
  /** стартовый масштаб на широких мониторах сохраняет привычную видимую ширину */
  baseZoom(sh, sw = 0) { return Math.max(clamp(sh / 560, 0.9, 2.4), sw / 1500); }   // меньше увеличение — текстуры ближе к 1:1, резче
  zoomLimits(sh, sw = 0) { const b = this.baseZoom(sh, sw); return [Math.min((sw || sh * 16 / 9) / this.mapW, sh / this.mapH), b * ZOOM_MAX_K]; }   // до полного вида карты; приближение — до разумного (боец ~1/6 высоты экрана), не до отдельных пикселей
  reset() { this.inited = false; this.free = 0; this.userZ = null; this.binoc = false; this.binocK = 0; this.edge = false; this.hold = false; this.shot = null; this.lookId = 0; this.lx = this.ly = 0; this.leadE = null; this.vx = this.vy = 0; this.track = false;
    this.turnKey = ''; this.lastT = null; this.aKey = ''; this.ay = 0; this.tKey = ''; this.glide = null; this.ptx = undefined; this.scopeFocus = null; this.ownHold = 0; this.foeFocus = null; this.foeHold = 0; this.panFactor = 1; this.mapW = 6400; this.mapH = 1800; this.mapZoom = null; this.manual = null; this.manualKey = ''; this.offsetX = this.offsetY = 0; this.manualActive = false; this.observeAim = false; this.zoomV = 0; this.zoomAnchor = null; this.zoomPark = null; this.wasBinoc = false; this.postHold = null; }
  /** мгновенная смена кадра (новый ход): обзор сразу у бойца — без перелёта через карту и без накопленной скорости */
  cut(sc, fx, a, sw, sh) {
    this.mapZoom = null; this.zoomPark = null; this.zoomV = 0; this.zoomAnchor = null; this.shot = null; this.hold = false; this.postHold = null; this.free = 0; this.lx = this.ly = 0; this.leadE = null; this.glide = null; this.lastT = null; this.aKey = '';
    this.vx = this.vy = this.tvx = this.tvy = 0; if (fx) { fx.focus = null; if (fx.firstHit) this.hitN = fx.firstHit.n; }   // попадания прошлого хода не в счёт
    const t = this.soldierTarget(a, sh); this.x = t.x; this.y = t.y; this.tKey = t.k; this.ptx = t.x; this.pty = t.y; this.z = this.tz;
    this.clampTo(sc, sw, sh);
  }
  /** смена эпизода атаки: готовый кадр без перелёта и остаточной скорости */
  frameCut(target, sc, sw, sh) {
    this.mapZoom = null; this.zoomPark = null; this.x = target.x; this.y = target.y; this.vx = this.vy = this.tvx = this.tvy = 0;
    this.lx = this.ly = 0; this.leadE = null; this.glide = null; this.tKey = target.k || ''; this.ptx = target.x; this.pty = target.y;
    this.clampTo(sc, sw, sh, null, target);
  }
  /** обзор у бойца: прыжок не качает камеру вверх-вниз — по высоте держится место прыжка, пока боец не упал ниже него
      или не взлетел выше обычного прыжка; на земле, на лестнице, в полёте от взрыва — обычное слежение */
  soldierTarget(a, sh) {
    const k = 's' + a.id; if (this.aKey !== k) { this.aKey = k; this.ay = a.y; }
    if (a.st === 'air') { const up = clamp(sh / this.z * 0.3, 50, 140); if (a.y > this.ay) this.ay = a.y; else if (a.y < this.ay - up) this.ay = a.y + up; }
    // после приземления положение стопы меняется на несколько пикселей из-за рельефа и округления коллизий;
    // такой сдвиг опоры у стоящего бойца не переносим на обзор, настоящие перепады высоты продолжают вести камеру
    else if (a.st !== 'stand' || Math.abs(a.y - this.ay) > 4) this.ay = a.y;
    return { x: a.x, y: this.ay - 58, k };
  }
  /** удар по выбранной точке (авиаудар, молния, орбитальный лазер, ядерный удар): обзор по центру клика; масштаб — чтобы
      самолёт, туча, луч или ракета и земля под ними были видны целиком (сверху — запас под панель хода и ветер, снизу —
      под панель команд). Авиаудар: край экрана ближе запасного сброса (1400 ед. за целью), иначе бомбы не уйдут у края экрана;
      если тогда точно по клику самолёт не помещается, по высоте кадр — середина участка «самолёт…земля», по ширине — клик */
  pickFrame(sc, T, sw, sh) {
    const P = T && T.pick; if (!P || !PICK_STRIKE.has(P[2]) || T.phase === 'aim') return null;   // удар запущен: ход уже не в прицеливании
    const x = P[0], y = P[1], ground = Math.min(sc.waterY, sc.terrain.findTop(clamp(Math.round(x), 0, sc.W - 1), 0));
    let top = Math.min(y, ground) - 40, bot = Math.max(y, ground) + 60, live = false;
    for (const e of sc.entities) {
      if (e.dead || e.team !== T.team) continue;
      if (e.k === 'jet' && !e.s) { live = true; top = Math.min(top, e.y - 70); bot = Math.max(bot, (e.v || ground) + 90); }
      else if (e.k === 'bomb') { live = true; top = Math.min(top, e.y - 40); bot = Math.max(bot, ground + 90); }
      else if (e.k === 'storm') { live = true; top = Math.min(top, e.y - 80); bot = Math.max(bot, (e.v || ground) + 70); }
      else if (e.k === 'orbital') { live = true; top = Math.min(top, (e.v || ground) - 360); bot = Math.max(bot, (e.v || ground) + 80); }
      else if (e.k === 'nukem') { live = true; top = Math.min(top, ground - 520); bot = Math.max(bot, ground + 140); }
    }
    const TOP = 125, BOT = 50, zMin = P[2] === 'airstrike' ? (sw / 2) / 1250 : 0;
    let z = Math.min((sh / 2 - TOP) / Math.max(1, y - top), (sh / 2 - BOT) / Math.max(1, bot - y)), cy = y;
    // по высоте кадр — середина участка «самолёт (туча, ракета)…земля», а не точка клика: оба видны, а отдаление вдвое меньше
    // (раньше кадр держал клик в центре и отдалялся так, что бойцов было не разглядеть)
    const zFit = (sh - TOP - BOT) / Math.max(1, bot - top); if (zFit > z) { z = zFit; cy = top + (sh / 2 - TOP) / z; }
    if (z < zMin) { z = Math.max(zMin, (sh - TOP - BOT) / Math.max(1, bot - top)); cy = top + (sh / 2 - TOP) / z; }
    return { x, y: cy, k: 'pick', live, z, key: T.team + ':' + T.sid + ':' + T.round + ':' + P[2] + ':' + x + ':' + y };
  }
  /** обычный кадр у бойца без побочных действий (с учётом высоты прыжка и края карты) — откуда камеру увели стрелками или оптикой */
  homeOf(a, sc, sw, sh) {
    const y = (this.aKey === 's' + a.id ? this.ay : a.y) - 58, hw = sw / 2 / this.z, hh = sh / 2 / this.z;
    const minX = hw - 250, maxX = sc.W - hw + 250, minY = -900 + hh, maxY = sc.waterY + 270 - hh;
    return { x: minX > maxX ? sc.W / 2 : clamp(a.x, minX, maxX), y: minY > maxY ? maxY : clamp(y, minY, maxY) };
  }
  /** куда смотреть при выстреле быстрыми пулями: свой боец и место попадания вместе, если помещаются в кадр, иначе — место
      попадания (чуть сдвинутое к стрелку, чтобы было видно, откуда летят пули) */
  shotFrame(sx, sy, px, py, sw, sh) {
    // соперник и точка его прицела помещаются — середина между ними; далёкая точка (ядерный удар, авиаудар, снайперка через
    // полкарты) — обзор идёт за ней до конца: точка у края кадра с отступом, кадр сдвинут к сопернику (видно, откуда удар).
    // v44 держал соперника в кадре — обзор упирался и за дальним прицелом не шёл. Кадр меняется непрерывно — без скачков
    const mx = sw / this.z * 0.38, my = sh / this.z * 0.34;
    const fit = (s, p, m) => Math.abs(p - s) <= 2 * m ? (s + p) / 2 : p - Math.sign(p - s) * m;
    return { x: fit(sx, px, mx), y: fit(sy - 20, py, my) };
  }
  /** кадр, оставленный на месте при выстреле (Controller.fireHere): держится до конца хода, пока боец стоит, а камере не
      нужно вести снаряд или показывать взрыв */
  postHoldTarget(sc, T) {
    const P = this.postHold; if (!P) return null;
    const a = T && sc.soldiers.find(s => s.id === T.sid);
    if (!T || P.key !== T.round + ':' + T.sid || !a || a.gone || (a.st !== 'stand' && a.st !== 'dead') || this.binoc) { this.postHold = null; return null; }
    return T.phase === 'aim' && T.shots === 0 ? null : P;   // выстрел ещё в пути к хосту — пока обычный обзор
  }
  /** весь боец с оружием — в кадре с отступом m px от краёв: обзор сдвигается ровно настолько, насколько нужно
      (после стрелок при любом масштабе, в том числе во время плавного перехода масштаба) */
  fitBody(a, sw, sh, m = 14) {
    // обзор уведён далеко (оптика, у цели) — к бойцу не прыгаем: стрелки возвращают его плавно
    const [cx, cy] = this.toScreen(a.x, a.y - 20, sw, sh); if (cx < -sw * 0.3 || cx > sw * 1.3 || cy < -sh * 0.3 || cy > sh * 1.3) return;
    const hw = sw / 2 / this.z, hh = sh / 2 / this.z, p = m / this.z;
    const loX = a.x + 18 - hw + p, hiX = a.x - 18 + hw - p; if (loX <= hiX) this.x = clamp(this.x, loX, hiX); else this.x = a.x;
    const loY = a.y + 4 - hh + p, hiY = a.y - 46 + hh - p; if (loY <= hiY) this.y = clamp(this.y, loY, hiY); else this.y = a.y - 21;
  }
  /** место попадания видно на экране: не у самого края и не под панелью хода сверху */
  hitVisible(x, y, sw, sh) { const [px, py] = this.toScreen(x, y, sw, sh); return px > sw * 0.05 && px < sw * 0.95 && py > Math.max(sh * 0.06, 104) && py < sh * 0.94; }
  /** точка в кадре с запасом m (доля экрана) */
  sees(x, y, sw, sh, m = 0.08) { const [px, py] = this.toScreen(x, y, sw, sh); return px > sw * m && px < sw * (1 - m) && py > sh * m && py < sh * (1 - m); }
  /** За пределами обычного кадра у бойца можно плавно вернуться, но нельзя увести обзор ещё дальше. */
  panOffset(value, delta, lo, hi) {
    if (value < lo) return delta > 0 ? Math.min(value + delta, hi) : value;
    if (value > hi) return delta < 0 ? Math.max(value + delta, lo) : value;
    return clamp(value + delta, lo, hi);
  }
  update(dt, sc, fx, sw, sh, mouse) {
    const previousZoom = this.z;
    if (this.wasBinoc && !this.binoc) {
      this.free = 0; this.hold = false; this.manualActive = false; this.offsetX = this.offsetY = 0;
      this.mapZoom = null; this.zoomPark = null; this.zoomAnchor = null; this.vx = this.vy = 0; this.ptx = undefined;
      this.glide = null; this.aKey = ''; this.leadE = null; this.lx = this.ly = 0; this.lookId = 0;
    }
    this.wasBinoc = this.binoc;
    this.mapW = sc.W; this.mapH = sc.H;
    if (!this.inited) { this.inited = true; this.x = sc.W / 2; this.y = sc.waterY - 420; this.z = this.tz = this.baseZoom(sh, sw); }
    const startFrame = { x: this.x, y: this.y };
    const [zmin, zmax] = this.zoomLimits(sh, sw);
    if (this.userZ !== null) this.userZ = clamp(this.userZ, zmin, zmax);
    this.binocK = approach(this.binocK, this.binoc ? 1 : 0, 9, dt);
    // бинокль не приближает: он плавно ведёт обзор за мышью
    this.tz = this.userZ ?? this.baseZoom(sh, sw);
    const T = sc.turn;
    if (this.mapZoom) {
      const M = this.mapZoom, turnKey = T ? T.team + ':' + T.sid + ':' + T.round : '';
      if (M.sw !== sw || M.sh !== sh) {
        // F11/поворот окна меняют реальные пределы масштаба: путь продолжается из текущего кадра.
        const bounded = clamp(this.z, zmin, zmax);
        if (bounded !== this.z) { this.z = bounded; this.zoomV = 0; }
        M.z1 = M.full ? zmin : clamp(M.z1, zmin, zmax); M.full = M.z1 <= zmin * (1 + 1e-8);
        this.userZ = this.tz = M.z1;
        if (this.z <= zmin * (1 + 1e-8)) { this.x = sc.W / 2; this.y = sc.H / 2; }
        if (this.zoomAnchor) { this.zoomAnchor.x *= sw / M.sw; this.zoomAnchor.y *= sh / M.sh; }
        if (M.mode === 'center') { M.x0 = this.x; M.y0 = this.y; M.q0 = 1 / this.z; M.q1 = 1 / M.z1; }
        else { M.hx = this.x; M.hy = this.y; M.qh = 1 / this.z; M.sx *= sw / M.sw; M.sy *= sh / M.sh; }
        M.sw = sw; M.sh = sh;
      }
      const actor = T && sc.soldiers.find(s => s.id === T.sid);
      const interrupted = !T || (actor && ['walk', 'climb', 'air', 'fly', 'jet'].includes(actor.st)) || (fx.focus && (fx.focus.L === undefined || fx.focus.L === T.team || this.foe)) || T.phase !== 'aim' || T.shots > 0 || turnKey !== M.key || this.binoc !== M.binoc || this.shot || this.foeFocus ||
        (this.manual && (this.manual.x || this.manual.y)) || (mouse && mouse.moved && (M.kind === 'free' || this.free > 0 || (this.edge && mouse.inside && !!this.edgeDir(mouse, sw, sh)))) || (this.scopeFocus && this.scopeFocus.moving) ||   /* наведение мышью (и после стрелок) кадр масштаба не сбивает; курсор у края (обзор к цели) и палец — ведут обзор */
        (this.observeAim && T && T.preview) ||   // соперник наводит удар: масштаб меняется, а обзор продолжает следить за его прицелом
        sc.entities.some(e => cameraAttack(e) && (e.team === T.team || this.foe));
      if (interrupted) {
        if (M.full && this.manual && (this.manual.x || this.manual.y)) this.userZ = this.tz = this.z;
        if (this.manualActive && actor) {
          const home = this.soldierTarget(actor, sh); this.offsetX = this.x - home.x; this.offsetY = this.y - home.y;
        }
        if (M.full && this.manual && (this.manual.x || this.manual.y)) this.zoomV = 0;
        this.mapZoom = null; this.zoomPark = null;
      }
      else {
        const q = this.smoothZoom(dt, M.z1, M.w);
        this.z = clamp(1 / q, zmin, zmax); this.tz = M.z1;
        if (q > 1 / zmin || q < 1 / zmax) this.zoomV = 0;
        [this.x, this.y] = this.zoomPathAt(M, 1 / this.z, 1 / zmin, sc);
        if (this.z <= zmin * (1 + 1e-8)) { this.x = sc.W / 2; this.y = sc.H / 2; }
        if (this.manualActive && actor && !this.binoc && !(this.edge && !this.scopeFocus)) this.fitBody(actor, sw, sh);   // обзор сдвинут стрелками: боец целиком в кадре и во время перехода
        if (this.manualActive && actor) { const home = this.soldierTarget(actor, sh); this.offsetX = this.x - home.x; this.offsetY = this.y - home.y; }
        this.vx = this.vy = 0; this.sx = this.sy = 0; this.glide = null;
        // масштаб дошёл до нужного: приближение отпускает камеру к обычному слежению (без паузы до следующего действия)
        // (и вокруг точки — у цели, после стрелок): камера остаётся там, где масштаб её оставил, и дальше слушается как обычно.
        // Отдаление дальше исходного кадра держит обзор, как и раньше. Путь запоминается: следующий поворот колеса,
        // пока обзор никто не сдвигал, идёт по нему же — туда-сюда без ухода в сторону
        if (Math.abs(this.z - M.z1) <= M.z1 * 1e-5 && Math.abs(this.zoomV || 0) < 1e-6 && !M.full && !(M.mode !== 'anchor' && 1 / this.z > (M.mode === 'center' ? M.q0 : M.qh) * (1 + 1e-9))) {
          this.mapZoom = null; this.ptx = undefined;
          if (M.mode === 'anchor' && this.manualActive && actor) { const home = this.soldierTarget(actor, sh); this.offsetX = this.x - home.x; this.offsetY = this.y - home.y; }
          this.zoomPark = { ...M, px: this.x, py: this.y };
        }
        return;
      }
    }
    const manualKey = T ? T.team + ':' + T.sid + ':' + T.round : '';
    if (this.manualKey !== manualKey || !T || T.phase !== 'aim') {
      if (this.manualActive) this.hold = false;
      this.manualKey = manualKey; this.offsetX = this.offsetY = 0; this.manualActive = false;
    }
    const mine = sc.simul && T ? T.team : -1;
    const ownActive = mine >= 0 && (this.shot || T.phase === 'use' || (T.shots > 0 && (T.phase === 'retreat' || T.phase === 'settle')) || sc.entities.some(e => e.team === mine && cameraAttack(e)) || (fx.focus && fx.focus.L === mine));
    this.ownHold = ownActive ? 0.65 : Math.max(0, this.ownHold - dt);
    const ownLock = ownActive || this.ownHold > 0;
    const foeAttention = mine >= 0 && this.foe && !ownLock && (this.foeFocus || sc.entities.some(e => e.team >= 0 && e.team !== mine && cameraAttack(e)) || (fx.focus && fx.focus.L !== undefined && fx.focus.L !== mine));
    // новый ход: один кадр сменяется другим — сразу боец, который ходит, без перелёта и без рывка в сторону
    if (T && T.sid && (T.phase === 'aim' || T.phase === 'use')) {
      const key = T.team + ':' + T.sid + ':' + T.round;
      if (key !== this.turnKey) { this.turnKey = key; const a = sc.soldiers.find(s => s.id === T.sid); if (a && !a.gone && !this.binoc && !(sc.simul && this.foeFocus)) this.cut(sc, fx, a, sw, sh); }
    }
    let target = null, foeTeam = null; this.track = false;
    const pickF = !this.binoc ? this.pickFrame(sc, T, sw, sh) : null;
    // масштаб удара: при запуске камера отдаляется ровно настолько, чтобы самолёт (туча, луч, ракета) и земля под ним были в кадре;
    // держится до конца хода, чтобы кадр не «дышал» между самолётом, бомбами и взрывами
    // сверху — запас под панель хода и ветер (самолёт над целью не прячется за ними), снизу — под панель команд
    if (pickF && pickF.live) { const zf = pickF.z; if (!this.pickZ || this.pickZ.key !== pickF.key) this.pickZ = { key: pickF.key, z: zf }; else this.pickZ.z = Math.min(this.pickZ.z, zf); }
    else if (this.pickZ && (!pickF || this.pickZ.key !== pickF.key)) this.pickZ = null;
    const look = T && T.look, lookKey = look ? T.team + ':' + T.sid + ':' + T.round + ':' + look[2] : null;
    if (look && lookKey !== this.lookId) {
      this.lookId = lookKey; const a = sc.soldiers.find(s => s.id === T.sid);
      // попадание за кадром: обзор встаёт точно по центру первого попадания (по всем четырём сторонам экрана)
      if (a && !a.gone && !this.hitVisible(look[0], look[1], sw, sh)) this.shot = { x: look[0], y: look[1], t: 2.2, k: 'shot' };
    }
    // настоящее первое попадание выстрела (FX.firstHit) за кадром — тоже точно по его центру: так видно и то попадание,
    // которое не удалось предсказать заранее
    { const H = fx.firstHit;
      if (H && H.n !== this.hitN) {
        this.hitN = H.n;
        const fresh = !(Number.isFinite(fx.t) && Number.isFinite(H.time)) || fx.t - H.time < 1.5;   // не прошлого боя или хода
        const mineHit = fresh && (mine < 0 || H.L === undefined || H.L === mine || (this.foe && !ownLock));
        // запас: перед выстрелом нужен отступ от края (hitVisible), а здесь — лишь бы попадание было на экране; иначе разброс
        // пули на пару пикселей за отступ дёргал бы камеру, которая по предсказанию правильно осталась на месте
        const [hx, hy] = this.toScreen(H.x, H.y, sw, sh), onScreen = hx > 4 && hx < sw - 4 && hy > 4 && hy < sh - 4;
        if (mineHit && !this.binoc && sc.turn && !onScreen) this.shot = { x: H.x, y: H.y, t: 2.2, k: 'shot' };
      } }
    if (this.shot) {
      // пока летят быстрые пули, кадр держится; после них — ещё немного, чтобы был виден результат
      if (!sc.entities.some(e => e.k === 'bullet' || e.k === 'mini' || e.k === 'acid')) this.shot.t -= dt;
      if (this.shot.t <= 0 || this.binoc) this.shot = null;
    }
    {
      // дальнобойное оружие с выбором точки (авиаудар, молния, лазер, ядерный удар…): курсор у края экрана сам ведёт обзор,
      // и обзор остаётся там, куда его увели, пока оружие в руках — цель за экраном выбирается без бинокля
      if (!this.edge) this.hold = false;
      const manual = this.manual, actor = manual && T && sc.soldiers.find(s => s.id === T.sid);
      // оружие с выбором точки на карте (удары, телепорт, балка…): стрелки, как и курсор у края экрана, ведут обзор свободно
      // по всей карте — бойца в кадре держать не нужно, нужна цель. Прежний сдвиг стрелками переходит в свободный обзор
      const pickView = this.edge && !this.scopeFocus;
      if (pickView && this.manualActive) { this.manualActive = false; this.offsetX = this.offsetY = 0; this.hold = true; }
      const arrows = pickView && manual && (manual.x || manual.y) && !this.binoc && !this.shot && !foeAttention ? [manual.x, manual.y] : null;
      const pan = arrows || (this.edge && mouse && mouse.inside && !this.binoc && !this.shot && !foeAttention ? this.edgeDir(mouse, sw, sh) : null);
      // Стрелки меняют только обзор. Новое наведение мышью снова разрешает оптике вести камеру по всей карте.
      if (this.scopeFocus && (this.scopeFocus.moving || (!this.scopeFocus.locked && pan)) && !(manual && (manual.x || manual.y))) {
        this.manualActive = false; this.offsetX = this.offsetY = 0;
      }
      if (!pickView && manual && actor && actor.alive && T.phase === 'aim' && !this.binoc && !this.shot && !foeAttention && (manual.x || manual.y || this.manualActive)) {
        const home = this.soldierTarget(actor, sh); this.manualHome = { x: actor.x, y: actor.y - 18 };
        if (!this.manualActive) { this.offsetX = this.x - home.x; this.offsetY = this.y - home.y; }
        this.manualActive = true; const speed = 620 * this.panFactor / this.z;
        const hw = sw / 2 / this.z, hh = sh / 2 / this.z, margin = 16 / this.z;
        this.offsetX = this.panOffset(this.offsetX, manual.x * speed * dt, -Math.max(0, hw - 20 - margin), Math.max(0, hw - 20 - margin));
        this.offsetY = this.panOffset(this.offsetY, manual.y * speed * dt, Math.min(0, 64 - hh + margin), Math.max(0, hh - 14 - margin));
        this.x = home.x + this.offsetX; this.y = home.y + this.offsetY; this.hold = true;
      } else if (this.scopeFocus && !this.binoc && !this.shot && !foeAttention && (() => { const o = T && sc.soldiers.find(s => s.id === T.sid); return o && !o.gone && SCOPE_WALK.has(o.st); })()) {
        // боец идёт (прыгает, лезет по лестнице) со снайперкой: обзор следует за ним, как с любым оружием; линза остаётся
        // в кадре, если вместе с бойцом помещается
        const focus = this.scopeFocus, p = focus.point, a = sc.soldiers.find(s => s.id === T.sid), home = this.soldierTarget(a, sh), z = this.z;
        const pad = (focus.visible ? Math.round(Math.min(sw, sh) * 0.16) + 16 : 30) / z, m = 70 / z;
        const fit = (h, lens, body, half) => { const lo = Math.max(lens - (half - pad), body - (half - m)), hi = Math.min(lens + (half - pad), body + (half - m)); return lo <= hi ? clamp(h, lo, hi) : h; };
        target = { x: fit(home.x, p.x, a.x, sw / 2 / z), y: fit(home.y, p.y, a.y - 20, sh / 2 / z), k: home.k };
        this.hold = false; this.free = 0;
      } else if (this.scopeFocus && !this.binoc && !this.shot && !foeAttention) {
        const focus = this.scopeFocus, p = focus.point;
        // Без захвата край окна ведёт мировую точку вплоть до границы карты, независимо от ограничений камеры.
        if (!focus.locked && pan) {
          const sp = 1500 * this.panFactor / this.z;
          p.x = clamp(p.x + pan[0] * sp * dt, 0, sc.W - 1); p.y = clamp(p.y + pan[1] * sp * dt, -900, sc.H - 1);
        }
        // вся линза остаётся в кадре: относительное движение продолжается за край экрана по всей карте
        const pad = focus.visible ? Math.round(Math.min(sw, sh) * 0.16) + 16 : 30;
        const [px, py] = this.toScreen(p.x, p.y, sw, sh);
        this.x += (px - clamp(px, pad, sw - pad)) / this.z; this.y += (py - clamp(py, pad, sh - pad)) / this.z;
        this.hold = true;
      } else if (this.binoc && mouse) {
        const R = Math.min(sw, sh) * 0.5;
        const ox = (mouse.x - sw / 2) / R, oy = (mouse.y - sh / 2) / R; const m = Math.hypot(ox, oy);
        if (m > 0.1) { const k = Math.min(1.7, (m - 0.1) / 0.9); const sp = 1450 * this.panFactor * Math.pow(k, 1.35) / this.z; this.x += ox / m * sp * dt; this.y += oy / m * sp * dt; }
        this.free = 1.3;
      } else if (pickF && pickF.live) { target = pickF; this.hold = false; this.free = 0; this.track = true; }   // удар по точке клика: обзор по её центру
      else if (pan) { const sp = (arrows ? 620 : 1500) * this.panFactor / this.z;   /* стрелки — с той же плавной скоростью, что и всегда */ this.x += pan[0] * sp * dt; this.y += pan[1] * sp * dt; this.hold = true; }
      else if (this.hold && !this.shot && !foeAttention && !(T && T.phase === 'use' && T.weapon === 'airstrike') && !sc.entities.some(e => e.k === 'jet' && !e.s)) { /* обзор стоит там, куда его увели к цели */ }
      else if (this.free > 0 && !this.shot && !foeAttention) this.free -= dt;
      else if (this.observeAim && !sc.simul && T && T.phase === 'aim' && T.preview) {
        const a = sc.soldiers.find(s => s.id === T.sid);
        if (a && a.alive && !a.gone) target = { ...this.shotFrame(a.x, a.y - 20, T.preview.x, T.preview.y, sw, sh), k: 'aim' + a.id };
      }
      else if (this.shot) target = this.shot;
      else {
        let best = null, bp = 0;
        for (const e of sc.entities) {
          if (e.dead) continue;
          let p = CAM_PRI[e.k] || 0; if (e.k === 'mine' && e.s === 2) p = 2; if (e.k === 'crate' && e.v) p = 2;
          if (e.k === 'jet') p = e.s ? 0 : 3; if (e.k === 'storm') p = 3;   // улетающий после сброса самолёт камере не интересен — смотрим на взрывы
          // одновременные ходы: снаряды соперника обзор показывает, только если игрок выбрал «следить за атаками соперника», и свои важнее
          if (mine >= 0 && e.team >= 0 && e.team !== mine) { if (!this.foe || ownLock) continue; p -= 0.5; }
          // из одинаково важных — самый ранний снаряд (залп, очередь снарядов): камера ведёт первый, а не скачет к каждому новому
          if (p > bp || (p === bp && p > 0 && best && e.id < best.id)) { bp = p; best = e; }
        }
        if (best && bp >= 2 && mine >= 0 && best.team >= 0 && best.team !== mine) foeTeam = best.team;
        // самолёт до сброса: обзор стоит над районом цели (f — точка курса, v — земля под ней), самолёт пролетает через экран
        // и у края экрана сбрасывает бомбы сам; после сброса камера идёт за бомбами. Туча: она и земля под ней
        if (best && best.k === 'jet' && !best.s && best.f) {
          // заход самолёта: цель ближе к дальнему краю экрана, а самолёт и земля оба в кадре — он виден дольше, успеть сбросить с упреждением
          const dir = Math.cos(best.a) >= 0 ? 1 : -1, vw = sw / this.z, vh = sh / this.z, gy = best.v || best.y + 430, span = gy - best.y;
          target = { x: best.f - dir * vw * 0.12, y: span < vh - 150 ? (best.y + gy) / 2 + 25 : gy - vh / 2 + 120, k: 'e' + best.id }; this.track = true;
        }
        else if (best && best.k === 'nukem') {
          // ядерная ракета: обзор плавно идёт за ней (ракета около середины экрана, внизу видна земля), у земли
          // останавливается над местом падения — ракета влетает в кадр и падает, без рывков
          const vh = sh / this.z, gy = Math.min(sc.waterY, sc.terrain.findTop(clamp(Math.round(best.x), 0, sc.W - 1), 0));
          target = { x: best.x, y: Math.min(best.y + vh * 0.3, gy - vh / 2 + 120), k: 'e' + best.id }; this.track = true;
        }
        else if (best && best.k === 'bomb') {
          // падающие бомбы и земля под ними — оба в кадре, видно, куда ляжет серия
          const vh = sh / this.z, gy = Math.min(sc.waterY, sc.terrain.findTop(clamp(Math.round(best.x), 0, sc.W - 1), 0)), span = gy - best.y;
          target = { x: best.x, y: span < vh - 150 ? (best.y + gy) / 2 + 25 : gy - vh / 2 + 120, k: 'e' + best.id }; this.track = true;
        }
        else if (best && best.k === 'storm') target = { x: best.x, y: best.v ? (best.y + best.v) / 2 + 20 : best.y + 250, k: 'e' + best.id };   // туча и земля под ней — оба в кадре
        else if (best && bp >= 2) {
          // упреждение по скорости (сглаженное): быстрый снаряд не отстаёт к краю экрана, впереди видно, куда он летит
          const vw = sw / this.z, vh = sh / this.z, L = this.leadE;
          let vx = best.vx, vy = best.vy;
          if (vx === undefined) { vx = L && L.id === best.id && dt > 0 ? (best.x - L.x) / dt : 0; vy = L && L.id === best.id && dt > 0 ? (best.y - L.y) / dt : 0; }   // снаряды друга по сети: скорость по сдвигу
          this.leadE = { id: best.id, x: best.x, y: best.y };
          // небольшое упреждение: впереди по полёту видно, куда летит снаряд
          const kk = 1 - Math.exp(-dt * 3), lead = 0.15;   // взгляд чуть вперёд по полёту
          this.lx += (clamp(vx * lead, -vw * 0.27, vw * 0.27) - this.lx) * kk; this.ly += (clamp(vy * lead, -vh * 0.24, vh * 0.24) - this.ly) * kk;
          if (best.k === 'orbital') target = { x: best.x, y: best.v, k: 'e' + best.id };
          else {
            // подпрыгивающие предметы (граната, мина, робот, динамит…) не качают обзор: по высоте он сдвигается, только когда
            // предмет выходит из средней полосы экрана
            const ek = 'e' + best.id, ty = best.y + this.ly, band = clamp(vh * 0.14, 28, 110);
            if (this.aKey !== ek) { this.aKey = ek; this.ay = ty; }
            if (ty > this.ay + band) this.ay = ty - band; else if (ty < this.ay - band) this.ay = ty + band;
            target = { x: best.x + this.lx, y: this.ay, k: ek };
          }
          this.track = true;
        }
        else if (fx.focus && (mine < 0 || fx.focus.L === undefined || fx.focus.L === mine || (this.foe && !ownLock))) {
          if (!fx.focus.k) fx.focus.k = 'f' + (++this.fN); target = fx.focus;
          if (mine >= 0 && fx.focus.L !== undefined && fx.focus.L !== mine) foeTeam = fx.focus.L;
        }
        else if (this.postHoldTarget(sc, T)) target = this.postHold;   // выстрел из сдвинутого обзора: кадр стоит
        else if (ownLock && this.lastT && !this.foeFocus) target = this.lastT;
        else {
          const a = T && sc.soldiers.find(s => s.id === T.sid), moving = a && !a.gone && a.st !== 'stand' && a.st !== 'dead';
          // ход сделан: обзор остаётся там, где показан результат, к сходившему бойцу не возвращается (иначе после хода камера
          // шла к нему и тут же разворачивалась к следующему); боец сам пошёл или его отбросило — обзор за ним
          if (ownLock && this.foeFocus && a && !a.gone) target = this.soldierTarget(a, sh);
          else if (T && CAM_HOLD[T.phase] && this.lastT && !moving && this.lastT.k !== 's' + T.sid) target = this.lastT;
          else if (a && !a.gone) target = this.soldierTarget(a, sh);
        }
      }
    }
    // одна чужая атака (снаряды, осколки и взрыв) — один cut; короткие разрывы между её частями кадр не переключают
    if (target && foeTeam !== null && !ownLock && this.foe) {
      if (!this.foeFocus || this.foeFocus.team !== foeTeam) this.frameCut(target, sc, sw, sh);
      this.foeFocus = { team: foeTeam }; this.foeHold = 0.7;
    } else if (this.foeFocus) {
      if (ownLock || !this.foe || this.binoc || mine < 0) {
        this.foeFocus = null; this.foeHold = 0;
        if (ownLock && target) this.frameCut(target, sc, sw, sh);
      } else {
        const tail = sc.entities.some(e => e.team === this.foeFocus.team && cameraAttack(e));
        this.foeHold = tail ? 0.7 : Math.max(0, this.foeHold - dt);
        if (this.foeHold > 0) { target = null; this.track = false; }
        else {
          this.foeFocus = null; const a = sc.soldiers.find(s => s.id === T.sid);
          if (a && !a.gone) { target = this.soldierTarget(a, sh); this.frameCut(target, sc, sw, sh); }
        }
      }
    }
    // камера ведёт снаряд, удар или взрыв — оставленный при выстреле кадр больше не нужен
    if (this.postHold && target && target !== this.postHold && (this.track || target === fx.focus || target === this.shot || target === pickF)) this.postHold = null;
    this.shotTook = target && target === this.shot ? this.shot : null;   // кадр выстрела действительно ведёт обзор (для выстрела после перелёта)
    if (target && target !== this.lastT) this.lastT = { x: target.x, y: target.y, k: target.k || '' };
    if (!target || this.shot === target) { this.lx *= Math.exp(-dt * 3); this.ly *= Math.exp(-dt * 3); this.leadE = null; }
    if (target) {
      // слежение — пружина с критическим затуханием: камера плавно разгоняется и плавно тормозит (переход к цели перед
      // очередью, смена хода, полёт снаряда), без рывка в первом кадре и без переключения скоростей
      const w = target === this.shot ? CAM_W.shot : this.track ? CAM_W.track : CAM_W.calm, cap = 5600;
      // скорость самой цели (летящий снаряд, падающая ракета): пружина гасит разницу скоростей, а не скорость камеры —
      // за движущейся целью камера идёт без отставания; при переходе к другой цели скорость цели сбрасывается
      const jump = this.ptx === undefined || !(dt > 0) || (target.k || '') !== this.tKey || Math.hypot(target.x - this.ptx, target.y - this.pty) > 90;
      if (jump) {
        this.tvx = 0; this.tvy = 0;
        // далёкая новая цель (кадр выстрела, снаряд соперника, возврат после бинокля): перелёт по плавной кривой — мягкий разгон
        // и мягкое торможение, без рывка в начале и в конце; скорость камеры в начале перелёта сохраняется
        // к кадру выстрела — всегда этот перелёт, даже на небольшое расстояние: одинаковая скорость и момент выстрела
        // для места попадания за кадром и для возврата к бойцу после стрелок
        const d = Math.hypot(target.x - this.x, target.y - this.y) * this.z, minGlide = target === this.shot ? 6 : 260;
        this.glide = dt > 0 && d > minGlide ? { x0: this.x, y0: this.y, vx: this.vx, vy: this.vy, u: 0, T: clamp(0.3 + d / 3000, 0.4, 0.95) } : null;
      }
      else { const kv = 1 - Math.exp(-dt * 12); this.tvx += ((target.x - this.ptx) / dt - this.tvx) * kv; this.tvy += ((target.y - this.pty) / dt - this.tvy) * kv; }
      this.ptx = target.x; this.pty = target.y; this.tKey = target.k || '';
      const G = this.glide;
      if (G) {
        G.u = Math.min(1, G.u + dt / G.T); const u = G.u, e = u * u * u * (u * (u * 6 - 15) + 10), h = u * (1 - u) * (1 - u) * G.T;
        const nx = G.x0 + (target.x - G.x0) * e + G.vx * h, ny = G.y0 + (target.y - G.y0) * e + G.vy * h;
        this.vx = (nx - this.x) / dt; this.vy = (ny - this.y) / dt; this.x = nx; this.y = ny;
        if (u >= 1) { this.glide = null; this.vx = this.tvx; this.vy = this.tvy; }   // дальше — обычное слежение с той же скоростью
      } else {
        this.vx += (w * w * (target.x - this.x) + 2 * w * (this.tvx - this.vx)) * dt; this.vy += (w * w * (target.y - this.y) + 2 * w * (this.tvy - this.vy)) * dt;
        const sp = Math.hypot(this.vx, this.vy); if (sp > cap) { this.vx *= cap / sp; this.vy *= cap / sp; }
        this.x += this.vx * dt; this.y += this.vy * dt;
      }
    } else { this.vx = 0; this.vy = 0; this.ptx = undefined; this.glide = null; }   // бинокль, прокрутка у края, свободный обзор — без накопленной инерции
    // авиаудар: пока самолёт заходит и бомбы падают, обзор чуть шире (не дальше пределов колеса)
    if (this.pickZ) this.tz = Math.max(zmin, Math.min(this.tz, this.pickZ.z));
    else if (sc.entities.some(e => (e.k === 'jet' && !e.s) || e.k === 'bomb')) this.tz = Math.max(zmin, Math.min(this.tz, this.baseZoom(sh, sw) * 0.78));
    const oldQ = 1 / this.z; this.z = clamp(1 / this.smoothZoom(dt, this.tz), zmin, zmax);
    if (this.zoomAnchor) {
      const dq = oldQ - 1 / this.z;
      this.x += this.zoomAnchor.x * dq; this.y += this.zoomAnchor.y * dq;
      if (this.manualActive && T) {
        const actor = sc.soldiers.find(s => s.id === T.sid); if (actor) { const home = this.soldierTarget(actor, sh); this.offsetX = this.x - home.x; this.offsetY = this.y - home.y; }
      }
      if (Math.abs(this.z - this.tz) < 1e-9) this.zoomAnchor = null;
    }
    if (this.manualActive && this.manual && T && T.phase === 'aim' && !this.binoc && !this.shot && !foeAttention) {
      const actor = sc.soldiers.find(s => s.id === T.sid);
      if (actor) { const hw = sw / 2 / this.z, hh = sh / 2 / this.z, margin = 16 / this.z;
        const oldHW = sw / 2 / previousZoom, oldHH = sh / 2 / previousZoom, oldMargin = 16 / previousZoom;
        const oldX = Math.max(0, oldHW - 20 - oldMargin), oldY0 = Math.min(0, 64 - oldHH + oldMargin), oldY1 = Math.max(0, oldHH - 14 - oldMargin);
        // Масштаб удерживает уже видимого бойца; дальний исходный обзор не возвращаем скачком.
        if (Math.abs(this.offsetX) <= oldX + 1e-8) this.offsetX = clamp(this.offsetX, -Math.max(0, hw - 20 - margin), Math.max(0, hw - 20 - margin));
        if (this.offsetY >= oldY0 - 1e-8 && this.offsetY <= oldY1 + 1e-8) this.offsetY = clamp(this.offsetY, Math.min(0, 64 - hh + margin), Math.max(0, hh - 14 - margin));
        const home = this.soldierTarget(actor, sh); this.x = home.x + this.offsetX; this.y = home.y + this.offsetY;
        // и в любом случае весь боец остаётся в кадре (раньше при масштабе после стрелок он мог уйти за край)
        this.fitBody(actor, sw, sh); this.offsetX = this.x - home.x; this.offsetY = this.y - home.y;
      }
    }
    { const x0 = this.x, y0 = this.y; this.clampTo(sc, sw, sh, startFrame, target); if (this.x !== x0) this.vx = 0; if (this.y !== y0) this.vy = 0;   // у края карты инерция не копится
      // стрелки у края карты: сдвиг обзора — от того места, где камера реально стоит, иначе обратное нажатие сначала «отматывало»
      // накопленный за краем сдвиг и камера отзывалась с задержкой
      if (this.manualActive && T && (this.x !== x0 || this.y !== y0)) { const actor = sc.soldiers.find(s => s.id === T.sid); if (actor) { const home = this.soldierTarget(actor, sh); this.offsetX = this.x - home.x; this.offsetY = this.y - home.y; } } }
    // тряска — плавное колебание (несколько синусов), а не случайный скачок каждый кадр: при очередях и взрывах без дёрганья
    const s = fx.shake, tt = performance.now() / 1000;
    this.sx = s ? s * (Math.sin(tt * 47) * 0.62 + Math.sin(tt * 71 + 1.3) * 0.38) : 0; this.sy = s ? s * (Math.sin(tt * 53 + 0.7) * 0.62 + Math.sin(tt * 83 + 2.1) * 0.38) : 0;
  }
  /** курсор в полосе у края экрана: направление и сила прокрутки (0…1 по глубине захода в полосу), иначе null */
  edgeDir(mouse, sw, sh) {
    const m = Math.max(36, Math.min(sw, sh) * 0.07);
    const f = (p, size) => p < m ? -(1 - Math.max(0, p) / m) : p > size - m ? 1 - Math.max(0, size - p) / m : 0;
    const ex = f(mouse.x, sw), ey = f(mouse.y, sh); if (!ex && !ey) return null;
    const k = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.25) * 0.85 + Math.sign(v) * 0.15;   // плавный старт у границы полосы, быстрее у самого края
    return [ex ? k(ex) : 0, ey ? k(ey) : 0];
  }
  clampTo(sc, sw, sh, from = null, reach = null) {
    if (this.z <= this.zoomLimits(sh, sw)[0] * (1 + 1e-8)) { this.x = sc.W / 2; this.y = sc.H / 2; return; }
    const hw = sw / 2 / this.z, hh = sh / 2 / this.z;
    let minX = Math.min(sc.W / 2, hw - 250), maxX = Math.max(sc.W / 2, sc.W - hw + 250);
    // свободный обзор (прицел с выбором точки, оптика, бинокль): край карты можно поставить в центр экрана и разглядеть вблизи
    if (this.edge || this.scopeFocus || this.binoc) { minX = Math.min(minX, 0); maxX = Math.max(maxX, sc.W); }
    // удар по точке, попадание, снаряд, взрыв, прицел соперника — по центру кадра в любой точке карты, и у самого её края
    // (за краем — фон); обычный кадр у бойца — в прежних пределах
    if (reach && !(typeof reach.k === 'string' && reach.k[0] === 's') && Number.isFinite(reach.x)) { minX = Math.min(minX, Math.max(0, reach.x)); maxX = Math.max(maxX, Math.min(sc.W, reach.x)); }
    this.x = from ? this.panOffset(from.x, this.x - from.x, minX, maxX) : clamp(this.x, minX, maxX);
    const scopePad = this.scopeFocus ? (Math.round(Math.min(sw, sh) * 0.16) + 16) / this.z : 0;
    const top = -900, bottom = this.scopeFocus ? Math.max(sc.H, sc.waterY + 270) : sc.waterY + 270;
    const minY = Math.min(sc.H / 2, top + hh - scopePad), maxY = Math.max(sc.H / 2, bottom + scopePad - hh);
    // Общий вид уже мог выйти из обычной полосы слежения: следующий кадр не возвращаем скачком.
    this.y = from ? this.panOffset(from.y, this.y - from.y, minY, maxY) : clamp(this.y, minY, maxY);
  }
  /** колесо мыши: небольшое приближение/отдаление. Когда камера за кем-то следит (боец, снаряд, кадр выстрела), масштаб плавно
      меняется вокруг середины экрана и слежение не прерывается; свободный обзор (бинокль, обзор у цели) — вокруг курсора */
  /** Аналитическая пружина: одинаковое движение при 30/60/144 Гц, без мгновенного шага колеса. */
  smoothZoom(dt, target, w = 14) {
    const q = 1 / this.z, end = 1 / target, e = q - end, v = this.zoomV || 0;
    if (!(dt > 0)) return q;
    const h = v + w * e, decay = Math.exp(-w * dt);
    let next = end + (e + h * dt) * decay; this.zoomV = (v - w * h * dt) * decay;
    if (Math.abs(next - end) < Math.max(1e-9, end * 1e-6) && Math.abs(this.zoomV) < 1e-4) { next = end; this.zoomV = 0; }
    return next;
  }
  /** центр кадра на пути масштаба при q = 1/z: 'path' — от исходного кадра (hx, hy при 1/qh) отдаление равномерно раскрывает
      оба края до полного вида карты, приближение — вокруг точки (sx, sy от середины экрана); 'anchor' — вокруг точки в обе
      стороны (боец после стрелок); 'center' — переход к тому, за кем камера следила (x0 → x1 по ходу масштаба) */
  zoomPathAt(M, q, qmin, sc) {
    const hx = M.mode === 'center' ? M.x0 : M.hx, hy = M.mode === 'center' ? M.y0 : M.hy, qh = M.mode === 'center' ? M.q0 : M.qh;
    if (M.mode !== 'anchor' && q >= qh) { const t = clamp((q - qh) / (qmin - qh || 1), 0, 1); return [hx + (sc.W / 2 - hx) * t, hy + (sc.H / 2 - hy) * t]; }
    if (M.mode === 'center') { const k = clamp((q - M.q0) / (M.q1 - M.q0 || 1), 0, 1); return [M.x0 + (M.x1 - M.x0) * k, M.y0 + (M.y1 - M.y0) * k]; }
    const ax = M.hx + M.sx * (M.qh - q), ay = M.hy + M.sy * (M.qh - q);
    if (q <= qh) return [ax, ay];
    // боец после стрелок: при отдалении он почти не сдвигается на экране, у полного вида кадр плавно приходит к середине карты
    const t = Math.pow(clamp((q - qh) / (qmin - qh || 1), 0, 1), 3);
    return [ax + (sc.W / 2 - ax) * t, ay + (sc.H / 2 - ay) * t];
  }
  zoomAt(f, px, py, sw, sh) {
    if (!(f > 0) || !Number.isFinite(f)) return;
    const [zmin, zmax] = this.zoomLimits(sh, sw), z = clamp((this.userZ ?? this.baseZoom(sh, sw)) * f, zmin, zmax);
    this.userZ = this.tz = z;
    if (Math.abs(z - this.z) < 1e-12 && !this.mapZoom) return;
    if (this.scopeFocus) [px, py] = this.toScreen(this.scopeFocus.point.x, this.scopeFocus.point.y, sw, sh);
    // обзор сдвинут стрелками (боец в кадре): масштаб вокруг бойца — его место на экране не меняется
    else if (this.manualActive && this.manualHome) [px, py] = this.toScreen(this.manualHome.x, this.manualHome.y, sw, sh);
    const free = this.binoc || this.hold || this.free > 0 || this.scopeFocus || this.manualActive, full = z <= zmin * (1 + 1e-8);
    // вокруг чего приближать: оптика, боец после стрелок, курсор свободного обзора; при слежении — середина экрана
    const kind = this.scopeFocus ? 'scope' : this.manualActive && this.manualHome ? 'manual' : free ? 'free' : 'track';
    const sx = kind === 'track' ? 0 : px - sw / 2, sy = kind === 'track' ? 0 : py - sh / 2;
    const w = Math.max(z / this.z, this.z / z) > 2 ? 8 : 14;
    if (this.manual && (this.manual.x || this.manual.y)) {
      // стрелки зажаты: обзор ведут они, масштаб идёт следом вокруг той же точки
      this.mapZoom = null; this.zoomPark = null; this.zoomAnchor = kind === 'track' ? null : { x: sx, y: sy }; return;
    }
    // Колесо туда-сюда — по одному пути, пока обзор ничто другое не сдвигало: отдаление и обратное приближение
    // возвращают ровно прежний кадр, камера не уходит от бойца или прицела всё дальше
    // (после стрелок допуск — пиксель экрана: удержание бойца в кадре могло сдвинуть обзор на доли пикселя)
    const tol = kind === 'manual' ? 0.6 / this.z : 0.01;
    const P = this.mapZoom || (this.zoomPark && Math.abs(this.zoomPark.px - this.x) < tol && Math.abs(this.zoomPark.py - this.y) < tol ? this.zoomPark : null);
    // опора пути: оптика и боец после стрелок — мировые точки (боец стоит на месте — путь тот же, даже если кадр его подвинул)
    const pivotW = kind === 'scope' ? this.scopeFocus.point : kind === 'manual' ? this.manualHome : null;
    const pivotSame = P && (kind === 'track' || (pivotW ? Math.abs(P.hx + P.sx * P.qh - pivotW.x) < 0.01 && Math.abs(P.hy + P.sy * P.qh - pivotW.y) < 0.01 : Math.abs(P.sx - sx) < 0.5 && Math.abs(P.sy - sy) < 0.5));
    if (P && (P.mode === 'path' || P.mode === 'center' || (P.mode === 'anchor' && kind === 'manual')) && P.kind === kind && P.key === this.turnKey && P.binoc === this.binoc && P.sw === sw && P.sh === sh && pivotSame) {
      this.mapZoom = P; P.z1 = z; P.full = full; P.w = w; this.zoomPark = null;
      this.zoomAnchor = P.mode === 'path' && 1 / z < P.qh && kind !== 'track' ? { x: P.sx, y: P.sy } : null;
      return;
    }
    const M = { key: this.turnKey, full, binoc: this.binoc, sw, sh, w, z1: z, kind, mode: 'path', hx: this.x, hy: this.y, qh: 1 / this.z, sx, sy };
    if (kind === 'manual') { M.mode = 'anchor'; this.zoomAnchor = { x: sx, y: sy }; }
    else if (kind === 'track' && f > 1) {
      // приближение: путь масштаба ведёт обзор обратно к тому, за кем камера следила до отдаления (обычно к бойцу) —
      // кадр не остаётся сдвинутым к середине карты там, где бойца не видно
      const home = this.lastT, ok = home && Number.isFinite(home.x) && Number.isFinite(home.y);
      Object.assign(M, { mode: 'center', x0: this.x, y0: this.y, q0: 1 / this.z, q1: 1 / z, x1: ok ? home.x : this.x, y1: ok ? home.y : this.y });
      this.zoomAnchor = null;
    } else this.zoomAnchor = z > this.z && kind !== 'track' ? { x: sx, y: sy } : null;
    this.mapZoom = M; this.zoomPark = null;
  }
}

/** яркий чёткий прицел выбора точки: тёмная обводка под цветной линией читается на любом фоне, кольцо слегка пульсирует */
function brightCross(c, x, y, t, col, k = 1) {
  const r = (15 + 1.6 * Math.sin(t * 7)) * k;
  c.save(); c.lineCap = 'round';
  const a = 11 * k, g = 5 * k;
  for (const [s, w] of [['rgba(0,0,0,0.78)', 5.5 * k], [col, 2.6 * k]]) {
    c.strokeStyle = s; c.lineWidth = w;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.beginPath(); c.moveTo(x - r - a, y); c.lineTo(x - g, y); c.moveTo(x + g, y); c.lineTo(x + r + a, y); c.moveTo(x, y - r - a); c.lineTo(x, y - g); c.moveTo(x, y + g); c.lineTo(x, y + r + a); c.stroke();
  }
  c.fillStyle = 'rgba(0,0,0,0.78)'; c.beginPath(); c.arc(x, y, 3.4 * k, 0, TAU); c.fill();
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, 2 * k, 0, TAU); c.fill();
  c.restore();
}
/** цветокоррекция по темам: [свет сверху, тени снизу] (режим soft-light) */
/** зелёные — свои (в сети — моя команда, против ИИ — я, на одном экране — случайно назначенная команда), красные — противник */
function hpFriend(sc, team) { const g = sc.greenTeam ?? 0; return team === g; }
const GRADE = {
  valley: ['rgba(255,214,140,0.5)', 'rgba(110,70,40,0.4)'],
  desert: ['rgba(255,200,130,0.55)', 'rgba(110,60,120,0.45)'],
  arctic: ['rgba(210,230,255,0.45)', 'rgba(30,40,110,0.5)'],
  volcano: ['rgba(255,150,80,0.5)', 'rgba(40,10,40,0.55)'],
  alien: ['rgba(120,255,240,0.35)', 'rgba(60,0,110,0.5)'],
  tropical: ['rgba(255,190,140,0.55)', 'rgba(60,30,110,0.5)'],
  castle: ['rgba(255,200,140,0.55)', 'rgba(60,50,120,0.5)'],
  city: ['rgba(255,120,220,0.3)', 'rgba(10,20,80,0.55)'],
};

/** стеклянная панель HUD в стиле меню: тёмный графит, тонкая рамка, верхний блик; accent — янтарный уголок слева сверху.
    Тень без размытия (смещённая подложка) — дёшево в каждом кадре */
function hudPanel(c, x, y, w, h, r = 12, accent = null) {
  c.save();
  rrect(c, x, y + 2, w, h, r); c.fillStyle = 'rgba(0,0,0,0.24)'; c.fill();
  rrect(c, x, y, w, h, r); const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(25,31,43,0.88)'); g.addColorStop(1, 'rgba(10,13,19,0.9)'); c.fillStyle = g; c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 1; rrect(c, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(1, r - 0.5)); c.stroke();
  const hl = c.createLinearGradient(x, 0, x + w, 0); hl.addColorStop(0, 'rgba(255,255,255,0)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.18)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = hl; c.fillRect(x + r, y + 1, Math.max(0, w - 2 * r), 1);
  if (accent) {
    c.strokeStyle = accent; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + 1, y + r + 7); c.lineTo(x + 1, y + r); c.arcTo(x + 1, y + 1, x + r, y + 1, r - 1); c.lineTo(x + r + 7, y + 1); c.stroke();
  }
  c.restore();
}
/** разрядка букв (если браузер её поддерживает) */
function hudSpacing(c, v) { if ('letterSpacing' in c) c.letterSpacing = v; }
/** строка, урезанная до ширины max с многоточием */
function hudFit(c, s, max) { s = String(s); if (c.measureText(s).width <= max) return s; while (s.length > 1 && c.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; }

class Renderer {
  constructor(cv) { this.cv = cv; this.c = cv.getContext('2d', { alpha: false });   // кадр всегда закрашен целиком: непрозрачный холст браузер не смешивает со страницей
    this.dpr = 1; this.sw = 1; this.sh = 1; this.anim = new Map(); this.mini = null; this.miniVer = -1; this.miniT = 0; this.miniRect = null; this.vig = null; this.turnStart = 0; this.lastSid = -1; }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr; this.sw = window.innerWidth; this.sh = window.innerHeight;
    this.cv.width = Math.round(this.sw * dpr); this.cv.height = Math.round(this.sh * dpr); this.vig = null;
  }
  animFor(s, dt) {
    let a = this.anim.get(s.id);
    if (!a) { a = { walk: 0, lastX: s.x, blink: 0, nextBlink: rand(2, 5) }; this.anim.set(s.id, a); }
    const dx = s.x - a.lastX; a.lastX = s.x;
    if (s.st === 'walk') a.walk += Math.abs(dx) * 0.42;
    a.nextBlink -= dt; if (a.nextBlink <= 0) { a.blink = 0.12; a.nextBlink = rand(2, 5.5); }
    if (a.blink > 0) a.blink -= dt;
    return a;
  }
  /** деревья и другие спрайты декора при приближении — из версий ×3: рисуются в отдельный кадр, земля вырезает их
      (декор стоит позади ландшафта), кадр ложится поверх размытой 1× копии в слое декора */
  drawSpriteLayer(c, sc, v, scale) {
    const L = sc.terrain.spriteLayer, cv = c.canvas; if (!cv || typeof cv.width !== 'number') return;
    if (!this.spriteCv || this.spriteCv.width !== cv.width || this.spriteCv.height !== cv.height) this.spriteCv = makeCanvas(cv.width, cv.height);
    const d = this.spriteCv.getContext('2d'); d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = 'source-over'; d.clearRect(0, 0, cv.width, cv.height);
    d.setTransform(c.getTransform()); d.imageSmoothingEnabled = true;
    if (!L.draw(d, v, Math.max(1.0001, scale))) return;
    d.globalCompositeOperation = 'destination-out'; this.blit(d, sc.terrain.canvas, v, sc); d.globalCompositeOperation = 'source-over';
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.spriteCv, 0, 0); c.restore();
  }
  /** ландшафт на видеокарте (js/terrain_gl.js); null — нет WebGL2 */
  terrainGL() {
    if (this.tgl === undefined) {
      this.tgl = typeof TerrainGL !== 'undefined' ? TerrainGL.create() : null;
      if (this.tgl && typeof TexLib !== 'undefined') {
        TexLib.onNative = (nat) => { if (this.tgl) this.tgl.nativeTexture(nat); };
        for (const n in TexLib.native) if (TexLib.native[n]) this.tgl.nativeTexture(TexLib.native[n]);   // уже загруженные (экран настроек)
      }
    }
    return this.tgl;
  }
  /** перед первым кадром боя (виден экран загрузки): данные карты уже на видеокарте */
  prepareTerrain(sc) { if (this.terrainGL()) this.tgl.prepare(sc); }
  blit(c, img, v, sc) {
    const x0 = Math.max(0, Math.floor(v.x0)), y0 = Math.max(0, Math.floor(v.y0)), x1 = Math.min(sc.W, Math.ceil(v.x1)), y1 = Math.min(sc.H, Math.ceil(v.y1));
    if (x1 > x0 && y1 > y0) c.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }
  wave(x, t, ph) { return Math.sin(x * 0.018 + t * 1.5 + ph) * 3 + Math.sin(x * 0.047 - t * 2.1 + ph * 2) * 1.8 + Math.sin(x * 0.11 + t * 3.2) * 0.7; }
  /** отражение в воде: полосы кадра над линией воды зеркально переносятся вниз, дрожат по волнам и гаснут с глубиной */
  drawReflection(c, wy, t) {
    const m = c.getTransform(), cv = c.canvas, sy = Math.round(wy * m.d + m.f);
    if (sy <= 0 || sy >= cv.height - 2) return;
    const depth = Math.min(sy, cv.height - sy, Math.round(200 * m.d)), band = Math.max(1, Math.round(2 * this.dpr));
    if (depth <= 0) return;   // отражение меньше физического пикселя не создаёт нулевой источник drawImage
    // снимок полосы над водой вчетверо мельче: при растяжении обратно он мягко размыт (вода не зеркало, мелкие детали вроде
    // иллюминаторов не отражаются чёткими кольцами) — без дорогого фильтра каждый кадр
    const HW = Math.ceil(cv.width / 4), HD = Math.max(1, Math.ceil(depth / 4));
    if (!this.reflCv || this.reflCv.width !== HW || this.reflCv.height < HD) this.reflCv = makeCanvas(HW, Math.max(HD, 8));
    const r = this.reflCv.getContext('2d'); r.setTransform(1, 0, 0, 1, 0, 0); r.imageSmoothingEnabled = true; r.clearRect(0, 0, HW, HD);
    r.drawImage(cv, 0, sy - depth, cv.width, depth, 0, 0, HW, HD);   // снимок полосы над водой, размыт — вода не зеркало
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = 0; k < depth; k += band) {
      const q = 1 - k / depth, a = (0.06 + 0.3 * Math.pow(q, 1.6)) * (0.86 + 0.14 * Math.sin(t * 2.4 + k * 0.08));
      const dx = (Math.sin(t * 1.8 + k * 0.065) * 2.2 + Math.sin(t * 3.1 + k * 0.16) * 1.3 + Math.cos(k * 0.28 - t * 0.9) * 0.8) * (1 + (k / depth) * 2) * m.d;
      c.globalAlpha = Math.max(0, Math.min(1, a));
      c.drawImage(this.reflCv, 0, (depth - k - band) / 4, HW, band / 4, dx, sy + k, cv.width, band);
    }
    c.restore();
  }
  /** плитка каустики: сеть светлых линий по границам ячеек Ворлея (бесшовная), рисуется один раз */
  causticTile() {
    if (this.caustic !== undefined) return this.caustic;
    this.caustic = null;
    try {
      const N = 128, cv = makeCanvas(N, N), x = cv.getContext('2d'), img = x.createImageData(N, N), d = img.data, P = [];
      for (let i = 0; i < 14; i++) P.push([hash3(i, 1, 91) * N, hash3(i, 2, 91) * N]);
      for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
        let f1 = 1e9, f2 = 1e9;
        // искривлённые координаты (периодические): границы ячеек — волнистые линии, а не многоугольная «сетка»
        const K = TAU / N, wx = xx + Math.sin(y * K * 2 + 1.3) * 5 + Math.sin(xx * K * 3) * 2.5, wy = y + Math.sin(xx * K * 2 + 0.7) * 5 + Math.sin(y * K * 3 + 2) * 2.5;
        for (const [px, py] of P) for (let oy = -N; oy <= N; oy += N) for (let ox = -N; ox <= N; ox += N) { const dd = Math.hypot(wx - px - ox, wy - py - oy); if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd; }
        const v = Math.max(0, 1 - (f2 - f1) / 5), j = (y * N + xx) * 4; d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = v * v * v * 210;
      }
      x.putImageData(img, 0, 0); this.caustic = cv;
    } catch (e) { this.caustic = null; }
    return this.caustic;
  }
  /** каустика под водой: два слоя сети разного масштаба плывут навстречу, гаснут с глубиной; ночью почти не видна */
  drawCaustics(c, L, x0, x1, wy, t) {
    const tile = this.causticTile(); if (!tile || typeof c.createPattern !== 'function' || typeof DOMMatrix === 'undefined') return;
    const pat = c.createPattern(tile, 'repeat'); if (!pat || typeof pat.setTransform !== 'function') return;
    const col = hex2rgb(L.top), lum = (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11) / 255;
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = pat;
    for (let b = 0; b < 2; b++) {
      const s = b ? 1.7 : 1.15, sp = b ? -7 : 10;
      pat.setTransform(new DOMMatrix([s, 0, 0, s * 0.5, t * sp, wy + t * (b ? 3 : -2)]));
      for (let k = 0; k < 8; k++) { c.globalAlpha = lum * (b ? 0.055 : 0.085) * Math.pow(1 - k / 8, 1.5); c.fillRect(x0, wy + 5 + k * 26, x1 - x0, 26); }
    }
    c.restore();
  }
  drawLiquid(c, sc, v, t, back) {
    const L = sc.theme.liquid, wy = sc.waterY; if (v.y1 < wy - 20) return;
    const lava = L.kind === 'lava'; const tt = lava ? t * 0.35 : t; const amp = lava ? 1.4 : 1;
    const x0 = v.x0 - 20, x1 = v.x1 + 20, bot = Math.max(v.y1 + 20, wy + 40), step = Math.max(12, (x1 - x0) / 1200);   // дальний обзор не умножает число сегментов воды
    c.beginPath(); c.moveTo(x0, bot);
    for (let x = x0; x <= x1 + step; x += step) c.lineTo(x, wy + (back ? -6 : 0) + this.wave(x, tt, back ? 2.3 : 0) * amp);
    c.lineTo(x1 + step, bot); c.closePath();
    if (back) { c.fillStyle = css(shadec(L.mid, lava ? 1 : 0.8)); c.fill(); return; }
    const g = c.createLinearGradient(0, wy - 6, 0, wy + 280); g.addColorStop(0, L.top); g.addColorStop(0.22, L.mid); g.addColorStop(1, L.deep);
    c.save(); c.globalAlpha = L.alpha; c.fillStyle = g; c.fill(); c.restore();
    // лава: настоящая корка — тёмные плиты и светящиеся трещины расплава (dev/tools/make_lava.py), медленно дрейфует;
    // к глубине темнее. Без текстуры — прежняя заливка с плитами-эллипсами
    const LT = lava && typeof TexLib !== 'undefined' && TexLib.data.lava_surface;
    if (LT) {
      if (!this.lavaPat || this.lavaPatC !== c || this.lavaPatS !== LT.canvas) { this.lavaPat = c.createPattern(LT.canvas, 'repeat'); this.lavaPatC = c; this.lavaPatS = LT.canvas; }
      const k = 512 / LT.canvas.width; this.lavaPat.setTransform(new DOMMatrix([k, 0, 0, k * 0.55, t * 4, wy + t * 1.2]));
      c.save(); c.fillStyle = this.lavaPat; c.globalAlpha = 0.94; c.fill();
      const gd = c.createLinearGradient(0, wy, 0, wy + 300); gd.addColorStop(0, 'rgba(40,6,0,0)'); gd.addColorStop(1, 'rgba(30,4,0,0.7)'); c.fillStyle = gd; c.globalAlpha = 1; c.fill(); c.restore();
    }
    if (!lava) this.drawReflection(c, wy, t);
    c.save();
    const span = Math.max(1, x1 - x0), far = span > 9000, fc = hex2rgb(L.foam);
    const edge = (dy) => { c.beginPath(); for (let x = x0; x <= x1 + step; x += step) { const y = wy + dy + this.wave(x, tt, 0) * amp; if (x === x0) c.moveTo(x, y); else c.lineTo(x, y); } c.stroke(); };
    if (lava) { c.lineWidth = 3; c.strokeStyle = 'rgba(255,240,170,0.9)'; edge(0); }
    else if (far) { c.lineWidth = 1.5; c.strokeStyle = rgba(L.foam, 0.45); edge(0); }
    else {
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,22,38,0.2)'; edge(2.4);                                  // мениск: у самой кромки вода темнее
      // тонкий блик по кромке, прерывистый: участки по 36 ед. мира с разной яркостью, медленно переливаются
      const seg = 36; c.lineWidth = 1.2;
      for (let sx = Math.floor(x0 / seg) * seg; sx < x1 + step; sx += seg) {
        const a = 0.1 + 0.55 * Math.max(0, Math.sin(sx * 0.031 + t * 0.6) * 0.55 + Math.sin(sx * 0.0117 - t * 0.33) * 0.45);
        if (a < 0.17) continue;
        c.strokeStyle = `rgba(${fc[0]},${fc[1]},${fc[2]},${a.toFixed(3)})`; c.beginPath();
        for (let x = sx, n = 0; n < 5; x += seg / 4, n++) { const y = wy - 0.4 + this.wave(x, tt, 0) * amp; if (!n) c.moveTo(x, y); else c.lineTo(x, y); }
        c.stroke();
      }
      this.drawCaustics(c, L, x0, x1, wy, t);
      // рябь у поверхности: короткие тёмные и светлые дуги, привязаны к миру (не ездят вместе с камерой), к глубине реже и бледнее
      c.lineCap = 'round';
      const P = 520;
      for (let tx = Math.floor(x0 / P), nR = span > 4000 ? 18 : 40; tx * P < x1; tx++) for (let i = 0; i < nR; i++) {
        const h1 = hash3(tx, i, 31), h2 = hash3(tx, i, 32), dep = h2 * h2, dark = i % 3 !== 0;
        const gx = tx * P + h1 * P + Math.sin(t * (0.5 + h2) + i) * 6, gy = wy + this.wave(gx, tt, 0) * amp + 3 + dep * 60, len = (5 + hash3(tx, i, 33) * 16) * (1 - dep * 0.5);
        c.lineWidth = dark ? 1.3 : 0.9;
        c.strokeStyle = dark ? `rgba(0,20,36,${(0.2 * (1 - dep * 0.7)).toFixed(3)})` : `rgba(${fc[0]},${fc[1]},${fc[2]},${(0.2 * (1 - dep)).toFixed(3)})`;
        c.beginPath(); c.moveTo(gx - len, gy); c.quadraticCurveTo(gx, gy + (dark ? 1.3 : -1.1), gx + len, gy); c.stroke();
      }
    }
    if (lava) {
      c.fillStyle = 'rgba(90,20,5,0.45)';
      if (!LT) for (let i = 0; i < 24; i++) { const gx = x0 + (((i * 173.3 + t * 9 * (i % 3 + 1)) % span) + span) % span; c.beginPath(); c.ellipse(gx, wy + 8 + (i * 7 % 40), 12 + (i % 5) * 5, 3, 0, 0, TAU); c.fill(); }
      c.globalCompositeOperation = 'lighter'; const g2 = c.createLinearGradient(0, wy - 50, 0, wy + 70); g2.addColorStop(0, 'rgba(255,120,30,0)'); g2.addColorStop(0.42, 'rgba(255,150,50,0.35)'); g2.addColorStop(1, 'rgba(255,150,50,0)'); c.fillStyle = g2; c.fillRect(x0, wy - 50, span, 120);   /* жар над лавой — без резкой нижней границы */
    } else {
      // лучи света в толще воды: мягкие наклонные клинья, медленно колышутся
      c.save(); c.globalCompositeOperation = 'lighter';
      const rayCol = hex2rgb(L.top);
      for (let i = 0; i < 9; i++) {
        const rx = x0 + ((((i * 311.7 + Math.sin(t * 0.25 + i) * 40) % span) + span) % span), w = 26 + (i % 3) * 18, len = 170 + (i % 4) * 60;
        const g = c.createLinearGradient(0, wy, 0, wy + len); g.addColorStop(0, `rgba(${rayCol[0]},${rayCol[1]},${rayCol[2]},${0.10 + 0.05 * Math.sin(t * 0.7 + i)})`); g.addColorStop(1, `rgba(${rayCol[0]},${rayCol[1]},${rayCol[2]},0)`);
        c.fillStyle = g; c.beginPath(); c.moveTo(rx, wy + 2); c.lineTo(rx + w, wy + 2); c.lineTo(rx + w * 0.6 + len * 0.35, wy + len); c.lineTo(rx + len * 0.35 - w * 0.4, wy + len); c.closePath(); c.fill();
      }
      c.restore();
      // рябь и солнечные блики: прерывистые мерцающие эллиптические блики, сгущающиеся в солнечную дорожку
      const sunX = x0 + span * 0.72;
      const glintCol = hex2rgb(L.glint || '#ffffff');
      c.save();
      for (let i = 0; i < 170; i++) {
        const drift = t * (8 + (i % 7) * 2.2);
        const gx = x0 + (((i * 157.3 + drift) % span) + span) % span;
        const depthFrac = Math.pow((i * 11 % 31) / 30, 1.7);
        const waveY = wy + this.wave(gx, tt, (i % 5) * 0.8) * amp;
        const gy = waveY + 2 + depthFrac * 55;
        if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
        const sDist = (gx - sunX) / (span * 0.13);
        const nearSun = Math.exp(-sDist * sDist);
        const phase = t * (2.8 + (i % 4) * 0.9) + gx * 0.04 + i * 1.618;
        const shimmer = Math.sin(phase);
        if (shimmer < 0.15 && nearSun < 0.6) continue;
        const bright = Math.max(0, (shimmer - 0.15) / 0.85);
        const alpha = (0.10 + 0.65 * nearSun) * bright * (1 - depthFrac * 0.75);
        if (alpha <= 0.02) continue;
        const rw = (1.6 + (i % 6) * 1.0 + nearSun * 5) * (0.8 + 0.4 * bright);
        const rh = Math.max(0.3, (0.35 + nearSun * 0.4) * (0.6 + 0.5 * (1 - depthFrac)));
        c.fillStyle = `rgba(${glintCol[0]},${glintCol[1]},${glintCol[2]},${Math.min(1, alpha).toFixed(3)})`;
        c.beginPath();
        c.ellipse(gx, gy, rw, rh, Math.sin(gx * 0.02 + t) * 0.08, 0, TAU);
        c.fill();
        if (nearSun > 0.65 && bright > 0.82 && depthFrac < 0.25) {
          const sparkSize = 0.7 + (bright - 0.82) * 3;
          c.fillStyle = `rgba(255,255,255,${Math.min(0.95, alpha * 1.4).toFixed(2)})`;
          c.beginPath();
          c.arc(gx, gy, sparkSize, 0, TAU);
          c.fill();
        }
      }
      c.restore();
    }
    c.restore();
  }
  draw(sc, cam, fx, ctl, t, dt) {
    const c = this.c, sw = this.sw, sh = this.sh, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.imageSmoothingEnabled = true; c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    sc.bg.draw(c, cam, sw, sh, t, sc.waterY);
    const z = cam.z, ox = sw / 2 - cam.x * z + cam.sx, oy = sh / 2 - cam.y * z + cam.sy;
    c.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    const v = cam.view(sw, sh, 30);
    this.drawLiquid(c, sc, v, t, true);
    if (!this.hires) this.hires = new HiResTerrain();
    // ландшафт при приближении: на видеокарте (сразу чёткий), иначе — плитки в фоновых потоках, иначе — как есть
    if (!(this.terrainGL() && this.tgl.draw(c, sc, v, z * dpr, fx.frameLights)) && !this.hires.draw(c, sc, v, z * dpr)) { this.blit(c, sc.terrain.decor, v, sc); this.blit(c, sc.terrain.canvas, v, sc); }
    if (sc.terrain.spriteLayer && z * dpr > 1) this.drawSpriteLayer(c, sc, v, z * dpr);
    if (sc.terrain.drawSurfaceNative) sc.terrain.drawSurfaceNative(c, v, z * dpr);
    drawTacticalRoutes(c, sc.map, sc.terrain);
    if (window.NAV_DEBUG && typeof NavCheck !== 'undefined' && NAV_DEBUG.map === sc.map.id) NavCheck.draw(c, NAV_DEBUG.res);
    if (sc.terrain.glow) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 + 0.22 * Math.sin(t * 1.6); this.blit(c, sc.terrain.glow, v, sc); c.restore(); }
    drawProps(c, sc, t, false);
    this.drawWorldAids(c, sc, ctl, t);
    drawAcidStream(c, sc, t);
    for (const e of sc.entities) if (e.x > v.x0 - 80 && e.x < v.x1 + 80) drawEntity(c, e, t, sc);
    for (const s of sc.soldiers) {
      if (s.gone) continue; const an = this.animFor(s, dt);
      if (s.x < v.x0 - 40 || s.x > v.x1 + 40 || s.y < v.y0 - 40 || s.y > v.y1 + 60) continue;
      // по неровной земле (рваные края воронок, щебень) ступни идут по каждому пикселю, а тело — плавно: как у настоящего шага
      const ground = s.st === 'walk' || s.st === 'stand';
      if (!ground || an.sy === undefined || Math.abs(s.y - an.sy) > 14) an.sy = s.y; else an.sy += (s.y - an.sy) * Math.min(1, dt * 14);
      const ry = s.y; s.y = an.sy; drawSoldier(c, s, sc.teams[s.team], t, an); s.y = ry;
    }
    fx.drawWorld(c, sc, t);
    this.drawLiquid(c, sc, v, t, false);
    if (fx.weather) fx.weather.draw(c, t);
    fx.drawLights(c, sc, cam, sw, sh, dpr, t);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    this.drawGrade(c, sc, sw, sh);
    this.drawVignette(c, sw, sh);
  }
  /** детальная текстура: карта хранится 1 пиксель на единицу, и при приближении она мылилась. Поверх земли и камня
      накладывается мелкий рельеф материала (высокочастотная часть фото-текстуры, 4 текселя на единицу) в режиме
      «перекрытие» — он меняет только светотень, цвет карты остаётся прежним; на дальнем плане эффекта нет */
  detailPattern(sc) {
    const id = sc.theme.id; if (this.detKey === id) return this.detPat;
    const tx = (sc.theme.ground && sc.theme.ground.tex) || {}, T = TexLib.data[tx.rock || tx.dirt || tx.concrete || tx.cave];
    if (!T) return null;
    this.detKey = id; this.detPat = null;
    const W = T.w, H = T.h, d = T.d, n = W * H, g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    // размытие окном 9×9 (по строкам, затем по столбцам, с заворотом — текстура бесшовная)
    const R = 4, tmp = new Float32Array(n), bl = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let k = -R; k <= R; k++) a += g[y * W + ((x + k + W) % W)]; tmp[y * W + x] = a / (2 * R + 1); }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0; for (let k = -R; k <= R; k++) a += tmp[((y + k + H) % H) * W + x]; bl[y * W + x] = a / (2 * R + 1); }
    let v2 = 0; for (let i = 0; i < n; i++) { const h = g[i] - bl[i]; v2 += h * h; }
    const amp = 34 / Math.max(4, Math.sqrt(v2 / n));   // одинаковая сила рельефа для всех тем
    const cv = makeCanvas(W, H), x = cv.getContext('2d'), im = x.createImageData(W, H);
    for (let i = 0; i < n; i++) { const vv = Math.max(0, Math.min(255, 128 + (g[i] - bl[i]) * amp)); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = vv; im.data[i * 4 + 3] = 255; }
    x.putImageData(im, 0, 0);
    const pat = this.c.createPattern(cv, 'repeat'); if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(0.25));
    this.detPat = pat; return pat;
  }
  drawDetail(c, sc, v, z) {
    if (window.__noDet) return; const zp = z * this.dpr, k = clamp((zp - 1.25) / 1.6, 0, 1); if (k <= 0) return;
    const pat = this.detailPattern(sc); if (!pat) return;
    const cv = c.canvas; if (!this.detCv || this.detCv.width !== cv.width || this.detCv.height !== cv.height) this.detCv = makeCanvas(cv.width, cv.height);
    const d = this.detCv.getContext('2d'); d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = 'source-over'; d.clearRect(0, 0, cv.width, cv.height);
    d.setTransform(c.getTransform()); d.imageSmoothingEnabled = true;
    this.blit(d, sc.terrain.decor, v, sc); this.blit(d, sc.terrain.canvas, v, sc);
    if (sc.terrain.surface) this.blit(d, sc.terrain.surface.canvas, v, sc);
    d.globalCompositeOperation = 'source-in'; d.fillStyle = pat; d.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'overlay'; c.globalAlpha = 0.55 * k; c.drawImage(this.detCv, 0, 0); c.restore();
  }
  /** кинематографичная цветокоррекция: тёплый свет сверху, прохладные тени снизу */
  drawGrade(c, sc, sw, sh) {
    const G = GRADE[sc.theme.id] || GRADE.valley;
    if (!this.gradeG || this.gradeKey !== sc.theme.id + sw + 'x' + sh) {
      const g = c.createLinearGradient(sw * 0.15, 0, sw * 0.5, sh); g.addColorStop(0, G[0]); g.addColorStop(0.55, 'rgba(128,128,128,0)'); g.addColorStop(1, G[1]);
      this.gradeG = g; this.gradeKey = sc.theme.id + sw + 'x' + sh;
    }
    c.save(); c.globalCompositeOperation = 'soft-light'; c.fillStyle = this.gradeG; c.fillRect(0, 0, sw, sh); c.restore();
  }
  drawVignette(c, sw, sh) {
    if (!this.vig) {
      this.vig = makeCanvas(256, 256); const x = this.vig.getContext('2d');
      const g = x.createRadialGradient(128, 128, 70, 128, 128, 182); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.42)');
      x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    }
    c.drawImage(this.vig, 0, 0, sw, sh);
  }
  /* ---------- подсказки в мире (лазер снайперки, превью балки, телепорта) ---------- */
  drawWorldAids(c, sc, ctl, t) {
    const T = sc.turn; if (T.phase !== 'aim') return;
    const s = sc.soldiers.find(o => o.id === T.sid); if (!s || !s.alive) return;
    // границы запаса хода: радиус по горизонтали от точки начала хода (при ходе «на любую дистанцию» их нет)
    if (T.ox !== undefined && !sc.freeWalk) {
      c.save(); c.setLineDash([6, 6]); c.lineWidth = 2;
      for (const bx of [T.ox - WALK_BUDGET, T.ox + WALK_BUDGET]) {
        const near = Math.abs(s.x - bx) < 160;
        c.strokeStyle = near ? 'rgba(255,190,90,0.85)' : 'rgba(255,255,255,0.15)';   // вдали — едва заметно, вблизи бойца — ярко
        c.beginPath(); c.moveTo(bx, s.y - 90); c.lineTo(bx, s.y + 30); c.stroke();
      }
      c.restore();
    }
    const mine = ctl && ctl.mine;
    const aim = mine ? ctl.aim : s.aim;
    // снайперка: без линии — целятся через оптический прицел (drawScope)
    // подкрутка броска: круговая стрелка у бойца (вперёд — по ходу броска)
    if (T.spin && SPIN_WEAPONS.has(T.weapon)) {
      const dir = Math.cos(aim) >= 0 ? 1 : -1, cw = T.spin * dir > 0, cx = s.x + dir * 20, cy = s.y - 50, a0 = cw ? -2.4 : -0.7, a1 = cw ? -0.2 : -2.9;
      c.save(); c.strokeStyle = T.spin > 0 ? '#ffd23a' : '#7fd0ff'; c.fillStyle = c.strokeStyle; c.lineWidth = 2.2;
      c.beginPath(); c.arc(cx, cy, 8, a0, a1, !cw); c.stroke();
      const ex = cx + Math.cos(a1) * 8, ey = cy + Math.sin(a1) * 8, ta = a1 + (cw ? Math.PI / 2 : -Math.PI / 2);
      c.beginPath(); c.moveTo(ex + Math.cos(ta) * 5, ey + Math.sin(ta) * 5); c.lineTo(ex + Math.cos(ta + 2.4) * 4, ey + Math.sin(ta + 2.4) * 4); c.lineTo(ex + Math.cos(ta - 2.4) * 4, ey + Math.sin(ta - 2.4) * 4); c.closePath(); c.fill();
      c.restore();
    }
    const preview = mine ? ctl.mouseW : !sc.simul ? T.preview : null;
    if (!preview) return;
    const mx = preview.x, my = preview.y;
    if (T.weapon === 'girder') {
      // где можно поставить балку: круг 300 ед. вокруг бойца (как проверяет игра) — светлая заливка и чёткая бегущая рамка;
      // призрак балки зелёный, если её можно поставить здесь, красный — слишком далеко или мешает боец
      const ca = COS8[T.rot & 7], sa = SIN8[T.rot & 7], far = Math.hypot(mx - s.x, my - s.y + 14) > 300;
      const blocked = !far && sc.soldiers.some(o => !o.gone && Math.abs((o.x - mx) * ca + (o.y - 13 - my) * sa) < 54 && Math.abs(-(o.x - mx) * sa + (o.y - 13 - my) * ca) < 22);
      const okCol = '#7dff9a', badCol = '#ff5a52', zone = '#ffcf6a';
      c.save();
      c.globalAlpha = 0.07; c.fillStyle = zone; c.beginPath(); c.arc(s.x, s.y - 14, 300, 0, TAU); c.fill(); c.globalAlpha = 1;
      c.lineDashOffset = -t * 18;
      for (const [col, w] of [['rgba(0,0,0,0.6)', 4.6], [zone, 2.2]]) { c.strokeStyle = col; c.lineWidth = w; c.setLineDash([12, 8]); c.beginPath(); c.arc(s.x, s.y - 14, 300, 0, TAU); c.stroke(); }
      c.setLineDash([]); c.restore();
      c.save(); c.translate(mx, my); c.rotate(Math.atan2(sa, ca));
      const col = far || blocked ? badCol : okCol;
      c.globalAlpha = 0.42; c.fillStyle = col; c.fillRect(-48, -6, 96, 12);
      c.globalAlpha = 0.95; c.strokeStyle = 'rgba(0,0,0,0.65)'; c.lineWidth = 3.4; c.strokeRect(-48, -6, 96, 12);
      c.strokeStyle = col; c.lineWidth = 1.6; c.strokeRect(-48, -6, 96, 12); c.restore();
    } else if (T.weapon === 'teleport') {
      const ok = my < sc.waterY - 10 && !sc.terrain.isSolid(mx, my) && !sc.terrain.isSolid(mx, my - 20);
      c.save(); c.globalAlpha = 0.45 + 0.2 * Math.sin(t * 8); c.strokeStyle = ok ? '#c080ff' : '#ff4040'; c.lineWidth = 2.5;
      c.beginPath(); c.arc(mx, my - 24, 5.5, 0, TAU); c.moveTo(mx, my - 18); c.lineTo(mx, my - 8); c.lineTo(mx - 4, my + 1); c.moveTo(mx, my - 8); c.lineTo(mx + 4, my + 1); c.moveTo(mx - 6, my - 14); c.lineTo(mx + 6, my - 14); c.stroke(); c.restore();
    } else if (T.weapon === 'orbital' || T.weapon === 'lightning' || T.weapon === 'nuke') {
      const col = T.weapon === 'nuke' ? '#ffd23a' : T.weapon === 'lightning' ? '#8fd8ff' : '#ff6af0';
      const spread = T.weapon === 'nuke' ? 124 : T.weapon === 'lightning' ? 70 : 72;
      const drift = T.weapon === 'lightning' ? T.wind * 1.0 : T.weapon === 'nuke' ? T.wind * 0.5 : 0;
      c.save(); c.lineCap = 'round';
      c.globalAlpha = 0.16; c.fillStyle = col; c.beginPath(); c.arc(mx, my, spread, 0, TAU); c.fill(); c.globalAlpha = 1;
      for (const [sc2, w] of [['rgba(0,0,0,0.65)', 4.5], [col, 2.2]]) {
        c.strokeStyle = sc2; c.lineWidth = w; c.setLineDash([9, 6]); c.beginPath(); c.arc(mx, my, spread, 0, TAU); c.stroke(); c.setLineDash([]);
        if (Math.abs(drift) > 6) { const ex = mx + drift; c.beginPath(); c.moveTo(mx, my - spread - 16); c.lineTo(ex, my - spread - 16); c.lineTo(ex - Math.sign(drift) * 8, my - spread - 24); c.moveTo(ex, my - spread - 16); c.lineTo(ex - Math.sign(drift) * 8, my - spread - 8); c.stroke(); }
      }
      c.restore();
    }
  }
  /* ---------- экранные подсказки: подписи, прицел, сила ---------- */
  drawOverlay(sc, cam, ctl, t) {
    const c = this.c, sw = this.sw, sh = this.sh; const T = sc.turn;
    if (T.sid !== this.lastSid) { this.lastSid = T.sid; this.turnStart = t; }
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const s of sc.soldiers) {
      if (s.gone || !s.alive) continue;
      // плашка здоровья висит над бойцом выше, чем может подняться ствол (оружие вверх — до ~60 px над ступнями), и ещё на 14 px экрана выше
      const top = Math.min(-42, s.wpn ? -26 + Math.sin(s.aim) * 38 - 4 : -42);   // верх головы или конец поднятого ствола — что выше
      const [hx, hy] = cam.toScreen(s.x, s.y + top, sw, sh), x = hx, y = hy - 12;
      if (x < -60 || x > sw + 60 || y < -60 || y > sh + 60) continue;
      const friend = hpFriend(sc, s.team), col = friend ? '#3ddc6a' : '#ff4d4d', colD = friend ? '#1c7a36' : '#8a1e1e';
      const k = clamp(s.hp / (s.maxHp || 100), 0, 1), w = 46, h = 13;
      c.save(); c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 5; c.shadowOffsetY = 1.5;
      rrect(c, x - w / 2, y - h / 2, w, h, 6.5); c.fillStyle = 'rgba(12,16,24,0.82)'; c.fill(); c.restore();
      if (k > 0) { c.save(); rrect(c, x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 4.5); c.clip(); const gr = c.createLinearGradient(0, y - h / 2, 0, y + h / 2); gr.addColorStop(0, col); gr.addColorStop(1, colD); c.fillStyle = gr; c.fillRect(x - w / 2 + 2, y - h / 2 + 2, (w - 4) * k, h - 4); c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(x - w / 2 + 2, y - h / 2 + 2, (w - 4) * k, 2.5); c.restore(); }
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1; rrect(c, x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1, 6); c.stroke();
      c.font = `700 11px ${FONT_UI}`; textOutlined(c, String(s.hp), x, y + 0.5, '#fff', 'rgba(0,0,0,0.85)', 3);
      c.font = `700 12px ${FONT_TITLE}`; textOutlined(c, String(s.name), x, y - 15, col, 'rgba(0,0,0,0.85)', 3);   // номер бойца в порядке хода
      if (s.id === T.sid && (T.phase === 'aim' || T.phase === 'wait') && t - this.turnStart < 4) {
        const b = Math.abs(Math.sin((t - this.turnStart) * 5)) * 7;
        c.fillStyle = col; c.beginPath(); c.moveTo(x - 8, y - 42 - b); c.lineTo(x + 8, y - 42 - b); c.lineTo(x, y - 30 - b); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.5; c.stroke();
      }
    }
    // прицел оружия: на постоянном коротком расстоянии от ствола строго по направлению прицеливания (мышь его не двигает)
    this.drawAimReticle(c, sc, cam, ctl, t, sw, sh);
    if (T.target && T.phase !== 'over') {
      const [x, y] = cam.toScreen(T.target.x, T.target.y, sw, sh); brightCross(c, x, y, t, '#ff6a3a', 1.2);   // захваченная цель самонаводки
    }
    // прицел выбора точки для ударов с воздуха: поверх всего и без цветокоррекции — яркий и чёткий; пока самолёт летит, его нет (сброс на глаз)
    const AIM_COL = { airstrike: '#ffe23a', lightning: '#8fd8ff', orbital: '#ff6af0', nuke: '#ffd23a', homing: '#ff8a3a' };
    const ownPoint = ctl && ctl.mine ? ctl.mouseW : null;
    const preview = ownPoint || (!sc.simul && T.phase === 'aim' ? T.preview : null);
    const pointCol = AIM_COL[T.weapon] || (!ownPoint && T.weapon === 'sniper' ? '#fff6d8' : null);
    if (preview && T.phase === 'aim' && pointCol && !(T.weapon === 'homing' && T.target)) {
      const [mx, my] = cam.toScreen(preview.x, preview.y, sw, sh), act = sc.soldiers.find(o => o.id === T.sid);
      if (T.weapon === 'airstrike' && act) {
        // курс самолёта: пройдёт над выбранной точкой в сторону от бойца
        const dir = preview.x >= act.x ? 1 : -1, L = 420 * cam.z, ay = my - 230 * cam.z;
        c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
        for (const [col, w] of [['rgba(0,0,0,0.72)', 6], ['#fff27a', 3]]) {
          c.strokeStyle = col; c.lineWidth = w; c.setLineDash([18, 12]);
          c.beginPath(); c.moveTo(mx - dir * L, ay); c.lineTo(mx + dir * L, ay); c.stroke(); c.setLineDash([]);
          c.beginPath(); c.moveTo(mx + dir * (L - 26), ay - 13); c.lineTo(mx + dir * L, ay); c.lineTo(mx + dir * (L - 26), ay + 13); c.stroke();
          c.setLineDash([4, 9]); c.beginPath(); c.moveTo(mx, ay + 10); c.lineTo(mx, my - 40); c.stroke(); c.setLineDash([]);
        }
        c.restore();
      }
      if (ownPoint) brightCross(c, mx, my, t, pointCol, 1.35);
      else {
        // прицел соперника всегда целиком на экране: точка за кадром — прицел у края, стрелка показывает, где она на самом деле
        const m = 34, top = 112, qx = clamp(mx, m, sw - m), qy = clamp(my, top, sh - m);
        brightCross(c, qx, qy, t, pointCol, 1.35);
        if (Math.hypot(qx - mx, qy - my) > 1) {
          const a = Math.atan2(my - qy, mx - qx), ax = qx + Math.cos(a) * 26, ay = qy + Math.sin(a) * 26;
          c.save(); c.translate(ax, ay); c.rotate(a);
          for (const [col, w] of [['rgba(0,0,0,0.7)', 5], [pointCol, 2.4]]) { c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.beginPath(); c.moveTo(-6, -8); c.lineTo(4, 0); c.lineTo(-6, 8); c.stroke(); }
          c.restore();
        }
      }
    }
    // противники за экраном: стрелки у края, пока в руках оружие с выбором точки, — видно, куда вести обзор курсором
    if (cam.edge && (T.phase === 'aim')) {
      const m = 34, cx = sw / 2, cy = sh / 2;
      for (const s of sc.soldiers) {
        if (s.gone || !s.alive || s.team === T.team) continue;
        const [x, y] = cam.toScreen(s.x, s.y - 18, sw, sh);
        if (x >= 0 && x <= sw && y >= 0 && y <= sh) continue;
        const dx = x - cx, dy = y - cy, k = Math.min((cx - m) / Math.max(1e-6, Math.abs(dx)), (cy - m) / Math.max(1e-6, Math.abs(dy)));
        const ax = cx + dx * k, ay = cy + dy * k, a = Math.atan2(dy, dx);
        c.save(); c.translate(ax, ay); c.rotate(a); c.fillStyle = '#ff4d4d'; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(13, 0); c.lineTo(-7, -9); c.lineTo(-2, 0); c.lineTo(-7, 9); c.closePath(); c.fill(); c.stroke(); c.restore();
        c.font = `600 10px ${FONT_UI}`; textOutlined(c, `${Math.round(Math.hypot(s.x - cam.x, s.y - cam.y) / 10)} м`, ax - Math.cos(a) * 22, ay - Math.sin(a) * 22, '#fff', 'rgba(0,0,0,0.85)', 3);
      }
    }
    c.restore();
  }
  /** прицел у каждого оружия, которое целится направлением (ракеты, гранаты, огнестрел…): кольцо на расстоянии AIM_RETICLE
      от плеча по линии ствола. Во время зарядки кольцо заполняется по силе броска. Оружию с выбором точки на карте,
      установке и «применить на себя» направление не нужно — у них свой прицел или его нет */
  drawAimReticle(c, sc, cam, ctl, t, sw, sh) {
    const T = sc.turn; if (T.phase !== 'aim') return;
    const W = WEAPON[T.weapon]; if (!W || !(W.mode === 'charge' || W.mode === 'instant' || (W.mode === 'tcharge' && T.target))) return;
    const s = sc.soldiers.find(o => o.id === T.sid); if (!s || !s.alive || s.gone) return;
    const mine = ctl && ctl.mine;
    if (W.id === 'sniper' && mine && ctl.scopeOn) return;                 // в оптике свой прицел
    const aim = mine ? ctl.aim : s.aim, D = AIM_RETICLE, ca = Math.cos(aim), sa = Math.sin(aim);
    const [x, y] = cam.toScreen(s.x + ca * D, s.y - GUN_Y + sa * D, sw, sh);
    const pw = mine ? (ctl.charging ? ctl.power : -1) : T.charge;
    const r = 13, gap = 0.42;
    c.save(); c.lineCap = 'round';
    // мягкое свечение, чтобы прицел читался и на светлом небе, и в тёмной пещере
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.beginPath(); c.arc(x, y, r + 6, 0, TAU); c.fill();
    for (const [col, w] of [['rgba(0,0,0,0.8)', 5.2], ['#fff6d8', 2.4]]) {
      c.strokeStyle = col; c.lineWidth = w;
      for (let k = 0; k < 4; k++) { const a0 = k * Math.PI / 2 + aim + gap, a1 = (k + 1) * Math.PI / 2 + aim - gap; c.beginPath(); c.arc(x, y, r, a0, a1); c.stroke(); }
      // штрихи внутрь по оси ствола и поперёк неё
      c.beginPath();
      for (let k = 0; k < 4; k++) { const a = aim + k * Math.PI / 2, cx = Math.cos(a), cy = Math.sin(a); c.moveTo(x + cx * (r + 4), y + cy * (r + 4)); c.lineTo(x + cx * (r - 4), y + cy * (r - 4)); }
      c.stroke();
    }
    if (pw >= 0) {   // сила броска: дуга по кольцу от зелёного к красному
      const k = clamp(pw, 0, 1);
      c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 5.6; c.beginPath(); c.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * k); c.stroke();
      c.strokeStyle = k < 0.55 ? '#5ee07a' : k < 0.85 ? '#ffd23a' : '#ff5a3a'; c.lineWidth = 3.4;
      c.beginPath(); c.arc(x, y, r + 8, -Math.PI / 2, -Math.PI / 2 + TAU * k); c.stroke();
    }
    const team = sc.teams[s.team];
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.beginPath(); c.arc(x, y, 3.8, 0, TAU); c.fill();
    c.fillStyle = team ? team.color : '#ff4d4d'; c.beginPath(); c.arc(x, y, 2.6, 0, TAU); c.fill();
    c.restore();
  }
  /** шкала силы броска: слева у края экрана, только пока зажата кнопка выстрела */
  drawPowerBar(c, sc, ctl, sw, sh, touch = false) {
    const T = sc.turn; if (T.phase !== 'aim') return;
    const pw = ctl && ctl.mine ? (ctl.charging ? ctl.power : -1) : T.charge;
    if (!(pw >= 0)) return;
    if (touch) {   // с пультом — горизонтальная шкала внизу по центру, между крестовиной и кнопкой огня
      const w = clamp(sw - 470, 160, 320), h = 16, x = Math.round(sw / 2 - w / 2), y = sh - 46, k = clamp(pw, 0, 1);
      c.save(); hudPanel(c, x - 12, y - 26, w + 24, h + 38, 11, '#ffb43c');
      c.fillStyle = 'rgba(0,0,0,0.42)'; rrect(c, x, y, w, h, 8); c.fill();
      const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#34c769'); g.addColorStop(0.55, '#ffc23a'); g.addColorStop(1, '#ff4d3a');
      c.save(); rrect(c, x, y, w, h, 8); c.clip(); c.fillStyle = g; c.fillRect(x, y, w * k, h); c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1.5; rrect(c, x, y, w, h, 8); c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.font = `14px ${FONT_TITLE}`; c.fillText(Math.round(pw * 100) + '%', sw / 2, y - 12);
      c.restore(); return;
    }
    const w = 20, h = Math.min(300, sh * 0.4), x = 30, y = Math.round(sh / 2 - h / 2);
    c.save();
    hudPanel(c, x - 16, y - 40, w + 32, h + 78, 12, '#ffb43c');
    c.fillStyle = 'rgba(0,0,0,0.42)'; rrect(c, x, y, w, h, 10); c.fill();
    const g = c.createLinearGradient(0, y + h, 0, y); g.addColorStop(0, '#34c769'); g.addColorStop(0.55, '#ffc23a'); g.addColorStop(1, '#ff4d3a');
    const fh = h * clamp(pw, 0, 1);
    c.save(); rrect(c, x, y, w, h, 10); c.clip(); c.fillStyle = g; c.fillRect(x, y + h - fh, w, fh);
    c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(x + 3, y + h - fh, 3, fh); c.restore();
    c.fillStyle = 'rgba(255,255,255,0.4)';
    for (let k = 1; k < 10; k++) { const yy = Math.round(y + h - h * k / 10) + 0.5; c.fillRect(x + w + 4, yy - 0.5, k % 5 ? 4 : 8, 1); }
    c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1.5; rrect(c, x, y, w, h, 10); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    c.font = `16px ${FONT_TITLE}`; c.fillText(Math.round(pw * 100) + '%', x + w / 2, y - 19);
    c.font = `500 10.5px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.7)'; c.fillText('до макс. ' + Math.max(0, 100 - Math.round(pw * 100)) + '%', x + w / 2, y + h + 20);
    c.restore();
  }
  /* ---------- HUD ---------- */
  drawHUD(sc, cam, ctl, t, extra) {
    const c = this.c, sw = this.sw, sh = this.sh; const T = sc.turn;
    // сенсорный пульт на экране: внизу слева крестовина, внизу справа огонь, сверху кнопки — панели HUD их обходят
    const touch = typeof Input !== 'undefined' && !!Input.isTouch && !!Input.touchRoot && !Input.touchRoot.classList.contains('hidden');
    this.drawScope(c, sc, cam, ctl, sw, sh);
    this.drawPowerBar(c, sc, ctl, sw, sh, touch);
    c.save(); c.textBaseline = 'middle';
    const team = sc.teams[T.team]; const act = sc.soldiers.find(s => s.id === T.sid);
    // панель хода
    if (team && T.phase !== 'over') {
      const w = 344, h = 58, x = Math.round(sw / 2 - w / 2), y = touch && sw < 720 ? 64 : 10, rgb = hex2rgb(team.color), lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      hudPanel(c, x, y, w, h, 12);
      // знак бойца: номер на цвете команды (как на плашке хода)
      const bs = h - 16, bx = x + 8, bY = y + 8, num = act ? String(act.name) : '—';
      rrect(c, bx, bY, bs, bs, 9); const tg = c.createLinearGradient(bx, bY, bx + bs, bY + bs); tg.addColorStop(0, css(shadec(rgb, 1.15))); tg.addColorStop(1, css(shadec(rgb, 0.68))); c.fillStyle = tg; c.fill();
      const tl = c.createLinearGradient(0, bY, 0, bY + bs); tl.addColorStop(0, 'rgba(255,255,255,0.32)'); tl.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = tl; c.fill();
      c.textAlign = 'center'; c.fillStyle = lum > 150 ? '#0b1219' : '#ffffff'; c.font = `${num.length > 1 ? 19 : 23}px ${FONT_TITLE}`; c.fillText(num, bx + bs / 2, bY + bs / 2 + 1);
      const tx = bx + bs + 12, room = x + w - 64 - tx;
      c.textAlign = 'left'; c.font = `17px ${FONT_TITLE}`; c.fillStyle = '#fff';
      c.fillText(act ? `Боец ${act.name}` : '—', tx, y + 21);
      const mineTurn = !!(ctl && ctl.mine), phaseTxt = T.phase === 'crate' ? 'Сброс припасов' : (mineTurn ? 'Ваш ход' : 'Ход соперника');
      // команда и чей ход — мелкими прописными с разрядкой; «ваш ход» янтарный
      c.font = `600 10.5px ${FONT_UI}`; hudSpacing(c, '1.2px');
      const ph = phaseTxt.toUpperCase(), sep = '  ·  ', phw = c.measureText(ph + sep).width, tn = hudFit(c, team.name.toUpperCase(), Math.max(40, room - phw));
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillText(tn + sep, tx, y + 41); const tnw = c.measureText(tn + sep).width;
      c.fillStyle = T.phase === 'crate' ? '#9fd6ff' : mineTurn ? '#ffc86a' : 'rgba(255,255,255,0.82)'; c.fillText(ph, tx + tnw, y + 41); hudSpacing(c, '0px');
      // время хода 0 — без ограничения: полное кольцо и знак ∞. После выстрела отсчёт отступления не показывается:
      // кольцо остаётся как в ходе (∞ или оставшееся время хода), отступление по-прежнему длится, как в оригинале
      const inf = !((sc.settings || sc.cfg.settings).turnTime > 0);
      const val = T.time; const max = (sc.settings || sc.cfg.settings).turnTime;
      const cx = x + w - 31, cy = y + h / 2, low = !inf && val <= 5 && T.phase === 'aim';
      c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(cx - 31, y + 12, 1, h - 24);
      c.beginPath(); c.arc(cx, cy, 19, 0, TAU); c.fillStyle = 'rgba(0,0,0,0.3)'; c.fill();
      c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,0.09)'; c.beginPath(); c.arc(cx, cy, 19, 0, TAU); c.stroke();
      c.strokeStyle = low ? '#ff5a5f' : team.color; c.lineCap = 'round';
      c.beginPath(); c.arc(cx, cy, 19, -Math.PI / 2, -Math.PI / 2 + TAU * (inf ? 1 : Math.max(0.001, clamp(val / max, 0, 1)))); c.stroke(); c.lineCap = 'butt';
      c.textAlign = 'center'; c.font = `${inf ? 22 : 17}px ${FONT_TITLE}`; c.fillStyle = low && Math.sin(t * 10) > 0 ? '#ff7b7b' : '#fff';
      c.fillText(inf ? '∞' : String(Math.ceil(Math.max(0, val))), cx, cy + 1);
      // ветер (если он отключён в настройках, плашки нет); стрелки растут от своей оси, подпись слева от них
      if ((sc.settings || sc.cfg.settings).wind !== false) {
      const wy = y + h + 17, ww = 252, wx = Math.round(sw / 2 - ww / 2), ax = wx + 64 + (ww - 64 - 12) / 2;
      hudPanel(c, wx, wy - 11, ww, 22, 11);
      const k = clamp(T.wind / MAX_WIND, -1, 1); const segs = 8;
      for (let i = 0; i < segs; i++) {
        const on = Math.abs(k) * segs > i; const dir = k >= 0 ? 1 : -1;
        const bx = ax + dir * (7 + i * 10); c.fillStyle = on ? (Math.abs(k) > 0.66 ? '#ff6a3d' : '#ffb43c') : 'rgba(255,255,255,0.1)';
        c.beginPath(); c.moveTo(bx, wy - 5.5); c.lineTo(bx + dir * 6.5, wy); c.lineTo(bx, wy + 5.5); c.lineTo(bx + dir * 2.6, wy); c.closePath(); c.fill();
      }
      c.fillStyle = 'rgba(255,255,255,0.62)'; c.font = `600 9.5px ${FONT_UI}`; c.textAlign = 'left'; hudSpacing(c, '1.8px'); c.fillText('ВЕТЕР', wx + 13, wy + 0.5); hudSpacing(c, '0px'); c.textAlign = 'center';
      c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(wx + 58, wy - 6, 1, 12);
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(ax - 0.5, wy - 7, 1, 14);
      }
      // непрерывный бой: что делает соперник (он ходит одновременно с вами)
      const ot = sc.simul ? (sc.lanes ? sc.lanes[1 - T.team] && sc.lanes[1 - T.team].turn : sc.turns && sc.turns[1 - T.team]) : null;
      if (ot && sc.teams[ot.team]) {
        const os = sc.soldiers.find(o => o.id === ot.sid), otm = sc.teams[ot.team];
        const ph = 'ходит';
        const txt = `${otm.name}: ${os ? 'боец ' + os.name : '—'} ${ph}`, oy = y + h + ((sc.settings || sc.cfg.settings).wind !== false ? 44 : 16);
        c.font = `12px ${FONT_UI}`; const tw = c.measureText(txt).width + 24;
        hudPanel(c, sw / 2 - tw / 2, oy - 11, tw, 22, 9);
        c.fillStyle = otm.color; c.beginPath(); c.arc(sw / 2 - tw / 2 + 11, oy, 3.5, 0, TAU); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.82)'; c.textAlign = 'center'; c.fillText(txt, sw / 2 + 5, oy + 0.5);
      }
    }
    // команды
    // команды: одна панель внизу слева — цвет команды, название, общее здоровье, бойцов в строю
    const RH = 24, tpw = 270, tph = sc.teams.length * RH + 12, tpx = 12, tpy = touch ? (sw < 720 ? 168 : 64) : sh - 14 - tph;
    hudPanel(c, tpx, tpy, tpw, tph, 11);
    sc.teams.forEach((tm, i) => {
      const members = sc.soldiers.filter(s => s.team === tm.idx);
      const hp = members.reduce((a, s) => a + (s.alive ? s.hp : 0), 0), mx = members.reduce((a, s) => a + s.maxHp, 0) || 1;
      const alive = members.filter(s => s.alive).length, ry = tpy + 6 + i * RH + RH / 2;
      if (i) { c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(tpx + 10, ry - RH / 2, tpw - 20, 1); }
      c.fillStyle = tm.color; rrect(c, tpx + 10, ry - 7, 4, 14, 2); c.fill();
      c.textAlign = 'left'; c.font = `600 12px ${FONT_UI}`; c.fillStyle = '#eef2f6'; c.fillText(hudFit(c, tm.name, 88), tpx + 22, ry + 0.5);
      const bx = tpx + 118, bw = 106, bh = 8, k = clamp(hp / mx, 0, 1), friend = hpFriend(sc, tm.idx ?? sc.teams.indexOf(tm));
      c.fillStyle = 'rgba(255,255,255,0.09)'; rrect(c, bx, ry - bh / 2, bw, bh, 4); c.fill();
      if (k > 0) {
        const g = c.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, friend ? '#22a957' : '#c72f36'); g.addColorStop(1, friend ? '#5cf08f' : '#ff6b6b');
        c.fillStyle = g; rrect(c, bx, ry - bh / 2, Math.max(bh, bw * k), bh, 4); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(bx + 3, ry - bh / 2 + 1, Math.max(0, bw * k - 6), 1.5);
      }
      // бойцы в строю: значок фигуры и число
      const ix = tpx + tpw - 34; c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.arc(ix, ry - 4, 2.6, 0, TAU); c.fill(); rrect(c, ix - 3.4, ry - 0.6, 6.8, 6.2, 2.4); c.fill();
      c.fillStyle = '#fff'; c.font = `13px ${FONT_TITLE}`; c.textAlign = 'right'; c.fillText(`${alive}`, tpx + tpw - 11, ry + 1);
    });
    // оружие, выбранное заранее на свой следующий ход (во время хода соперника)
    if (ctl && ctl.preTeam !== null && ctl.preTeam !== undefined && sc.teams[ctl.preTeam]) {
      const tmp = sc.teams[ctl.preTeam], id = (ctl.preChoice && performance.now() - ctl.preChoice.time < 1500 ? ctl.preChoice.id : null) || tmp.nextW, W = id && WEAPON[id];
      const label = W ? 'На ваш ход: ' + W.name : 'Оружие на ваш ход: Q / E, цифры или Tab';
      c.font = `600 12px ${FONT_UI}`; const tw = c.measureText(label).width, pw = tw + (W ? 54 : 24), px = 12, py = touch ? tpy + tph + 8 : tpy - 8 - 34;
      hudPanel(c, px, py, pw, 34, 10, '#ffb43c');
      if (W) { const ic = weaponIcon(id, 28); c.drawImage(ic, px + 9, py + 3, 28, 28); }
      c.fillStyle = W ? '#ffc86a' : 'rgba(255,255,255,0.7)'; c.textAlign = 'left'; c.fillText(label, px + (W ? 44 : 12), py + 17);
    }
    // Подсказки выбора точки появляются только для соответствующего оружия.
    const hint = !cam.binoc && cam.edge ? (cam.hold ? `Обзор у цели · ${Keys.label('camera')} — вернуться к бойцу` : 'Цель за экраном? Ведите курсор к краю экрана') : '';
    c.textAlign = 'right'; c.font = `12px ${FONT_UI}`;
    if (hint) {
      const hw = c.measureText(hint).width + 34, hx = touch ? Math.round(sw / 2 + hw / 2) : sw - 14, hy = touch ? (sw < 720 ? 64 : 10) + 104 : sh - 77;
      hudPanel(c, hx - hw, hy - 13, hw, 26, 9); c.fillStyle = '#ffb43c'; c.beginPath(); c.arc(hx - hw + 13, hy, 3, 0, TAU); c.fill(); c.fillStyle = 'rgba(255,255,255,0.88)'; c.fillText(hint, hx - 11, hy);
    }
    if (extra && extra.ping !== undefined) { c.font = `11px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.6)'; c.textAlign = 'right'; c.fillText(Number.isFinite(extra.ping) ? `пинг ${extra.ping} мс` : extra.pingStatus === 'timeout' ? 'пинг — нет ответа' : 'пинг —', sw - 20, touch ? 66 : sh - 34); c.textAlign = 'left'; }
    c.restore();
  }
  /** оптический прицел снайперки: линза ×3 на линии ствола в точке курсора, сетка с дальномерными метками */
  drawScope(c, sc, cam, ctl, sw, sh) {
    const T = sc.turn;
    // после выстрела оптика ещё видна на месте выстрела (пока летит пуля и виден результат)
    const after = !!(ctl && ctl.scopeAfter > 0 && ctl.scopeLast && T.weapon === 'sniper');
    if (cam.foeFocus || !ctl || cam.binocK > 0.5 || (!after && (T.weapon !== 'sniper' || T.phase !== 'aim' || !ctl.mine || !ctl.scopeOn))) return;
    const s = sc.soldiers.find(o => o.id === T.sid); if (!s || !s.alive) return;
    const P = after ? ctl.scopeLast : ctl.mouseW, AIM = after ? ctl.scopeLast.aim : ctl.aim;
    const [gx, gy] = cam.toScreen(s.x, s.y - GUN_Y, sw, sh), [mx, my] = cam.toScreen(P.x, P.y, sw, sh);
    const dist = Math.max(1, Math.hypot(mx - gx, my - gy)), aimX = gx + Math.cos(AIM) * dist, aimY = gy + Math.sin(AIM) * dist;
    const R = Math.round(Math.min(sw, sh) * 0.16), Z = 3, dpr = this.dpr, src = this.c.canvas;
    const cx = aimX, cy = aimY;   // При ручном обзоре линза остаётся на своей мировой цели, даже за краем кадра.
    if (!this.scopeCv || this.scopeCv.width !== Math.ceil(2 * R * dpr)) this.scopeCv = makeCanvas(Math.ceil(2 * R * dpr), Math.ceil(2 * R * dpr));
    const tc = this.scopeCv.getContext('2d'); tc.setTransform(1, 0, 0, 1, 0, 0); tc.fillStyle = '#000'; tc.fillRect(0, 0, this.scopeCv.width, this.scopeCv.height);
    const r0 = R / Z; tc.imageSmoothingQuality = 'high';
    tc.drawImage(src, (aimX - r0) * dpr, (aimY - r0) * dpr, 2 * r0 * dpr, 2 * r0 * dpr, 0, 0, this.scopeCv.width, this.scopeCv.height);
    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.save(); c.clip();
    c.drawImage(this.scopeCv, cx - R, cy - R, 2 * R, 2 * R);
    const v = c.createRadialGradient(cx, cy, R * 0.55, cx, cy, R); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.65)'); c.fillStyle = v; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.strokeStyle = 'rgba(10,10,10,0.9)'; c.lineWidth = 1.4; c.beginPath();
    c.moveTo(cx - R, cy); c.lineTo(cx - 7, cy); c.moveTo(cx + 7, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy - 7); c.moveTo(cx, cy + 7); c.lineTo(cx, cy + R); c.stroke();
    c.lineWidth = 3.2; c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx - R * 0.55, cy); c.moveTo(cx + R * 0.55, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy + R * 0.55); c.lineTo(cx, cy + R); c.stroke();
    c.fillStyle = 'rgba(10,10,10,0.9)'; for (let k = 1; k <= 4; k++) { const d = k * R * 0.11; for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) { c.beginPath(); c.arc(cx + dx, cy + dy, 1.3, 0, TAU); c.fill(); } }
    c.fillStyle = 'rgba(255,40,40,0.9)'; c.beginPath(); c.arc(cx, cy, 1.4, 0, TAU); c.fill();
    c.restore();
    c.lineWidth = 7; c.strokeStyle = '#0c0e10'; c.beginPath(); c.arc(cx, cy, R + 3, 0, TAU); c.stroke();
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(180,200,220,0.35)'; c.beginPath(); c.arc(cx, cy, R + 6.5, -2.6, -0.9); c.stroke();
    c.font = `11px ${FONT_TITLE}`; c.fillStyle = 'rgba(220,235,255,0.8)'; c.textAlign = 'left'; c.fillText(`×${Z}  ${Math.round(Math.hypot(P.x - s.x, P.y - s.y) / 10)} м`, cx + R * 0.45, cy + R * 0.82);
    c.restore();
  }
}
