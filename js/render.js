'use strict';
/* =========================================================
   Камера и отрисовка кадра: мир, вода/лава, прицел, HUD,
   миникарта
   ========================================================= */
const CAM_PRI = { rocket: 3, homing: 3, mortar: 3, drill: 3, mini: 2, grenade: 3, cluster: 3, sticky: 3, molotov: 3, bholeg: 3, bhole: 3, dynamite: 2, robot: 3, bomb: 2, nukem: 4, orbital: 3, jet: 1, frag: 1, bomblet: 1 };

CAM_PRI.plasma = 3; CAM_PRI.bullet = 2;   // камера следит и за пулями

/* Камера. Отдалиться до всей карты нельзя: масштаб ограничен рядом с базовым,
   а дальние участки осматриваются биноклем — вид плавно едет туда, куда ведут мышь. */
class Camera {
  constructor() { this.x = 1600; this.y = 900; this.z = 1; this.tz = 1; this.sx = 0; this.sy = 0; this.free = 0; this.userZ = null; this.inited = false; this.binoc = false; this.binocK = 0; this.edge = false; this.hold = false; }
  toScreen(wx, wy, sw, sh) { return [(wx - this.x) * this.z + sw / 2 + this.sx, (wy - this.y) * this.z + sh / 2 + this.sy]; }
  toWorld(px, py, sw, sh) { return [(px - sw / 2 - this.sx) / this.z + this.x, (py - sh / 2 - this.sy) / this.z + this.y]; }
  view(sw, sh, m = 0) { const hw = sw / 2 / this.z, hh = sh / 2 / this.z; return { x0: this.x - hw - m, y0: this.y - hh - m, x1: this.x + hw + m, y1: this.y + hh + m }; }
  /** на широких мониторах ширина обзора тоже ограничена (не больше ~2000 px карты) */
  baseZoom(sh, sw = 0) { return Math.max(clamp(sh / 560, 0.9, 2.4), sw / 1500); }   // меньше увеличение — текстуры ближе к 1:1, резче
  zoomLimits(sh, sw = 0) { const b = this.baseZoom(sh, sw); return [Math.max(b * 0.6, sw / 2300), b * 4]; }   // колесом можно приблизить в 4 раза
  reset() { this.inited = false; this.free = 0; this.userZ = null; this.binoc = false; this.binocK = 0; this.edge = false; this.hold = false; }
  update(dt, sc, fx, sw, sh, mouse) {
    if (!this.inited) { this.inited = true; this.x = sc.W / 2; this.y = sc.waterY - 420; this.z = this.tz = this.baseZoom(sh, sw); }
    const [zmin, zmax] = this.zoomLimits(sh, sw);
    if (this.userZ !== null) this.userZ = clamp(this.userZ, zmin, zmax);
    this.binocK = approach(this.binocK, this.binoc ? 1 : 0, 9, dt);
    // бинокль не приближает: он плавно ведёт обзор за мышью
    this.tz = this.userZ ?? this.baseZoom(sh, sw);
    let target = null;
    {
      // дальнобойное оружие с выбором точки (авиаудар, молния, лазер, ядерный удар…): курсор у края экрана сам ведёт обзор,
      // и обзор остаётся там, куда его увели, пока оружие в руках — цель за экраном выбирается без бинокля
      if (!this.edge) this.hold = false;
      const pan = this.edge && mouse && mouse.inside && !this.binoc ? this.edgeDir(mouse, sw, sh) : null;
      if (this.binoc && mouse) {
        const R = Math.min(sw, sh) * 0.5;
        const ox = (mouse.x - sw / 2) / R, oy = (mouse.y - sh / 2) / R; const m = Math.hypot(ox, oy);
        if (m > 0.1) { const k = Math.min(1.7, (m - 0.1) / 0.9); const sp = 1450 * Math.pow(k, 1.35) / this.z; this.x += ox / m * sp * dt; this.y += oy / m * sp * dt; }
        this.free = 1.3;
      } else if (pan) { const sp = 1500 / this.z; this.x += pan[0] * sp * dt; this.y += pan[1] * sp * dt; this.hold = true; }
      else if (this.hold) { /* обзор стоит там, куда его увели к цели */ }
      else if (this.free > 0) this.free -= dt;
      else {
        let best = null, bp = 0;
        for (const e of sc.entities) {
          let p = CAM_PRI[e.k] || 0; if (e.k === 'mine' && e.s === 2) p = 2; if (e.k === 'crate' && e.v) p = 2;
          if (e.k === 'jet') p = e.s ? 0 : 3; if (e.k === 'storm') p = 3;   // улетающий после сброса самолёт камере не интересен — смотрим на взрывы
          if (p > bp || (p === bp && p > 0 && best && e.id > best.id)) { bp = p; best = e; }
        }
        // самолёт до сброса: обзор стоит над районом цели (f — точка курса, v — земля под ней), самолёт пролетает через экран
        // и у края экрана сбрасывает бомбы сам; после сброса камера идёт за бомбами. Туча: она и земля под ней
        if (best && best.k === 'jet' && !best.s && best.f) {
          // заход самолёта: цель ближе к дальнему краю экрана, а самолёт и земля оба в кадре — он виден дольше, успеть сбросить с упреждением
          const dir = Math.cos(best.a) >= 0 ? 1 : -1, vw = sw / this.z, vh = sh / this.z, gy = best.v || best.y + 430, span = gy - best.y;
          target = { x: best.f - dir * vw * 0.12, y: span < vh - 150 ? (best.y + gy) / 2 + 25 : gy - vh / 2 + 120 };
        }
        else if (best && best.k === 'bomb') {
          // падающие бомбы и земля под ними — оба в кадре, видно, куда ляжет серия
          const vh = sh / this.z, gy = Math.min(sc.waterY, sc.terrain.findTop(clamp(Math.round(best.x), 0, sc.W - 1), 0)), span = gy - best.y;
          target = { x: best.x, y: span < vh - 150 ? (best.y + gy) / 2 + 25 : gy - vh / 2 + 120 };
        }
        else if (best && best.k === 'storm') target = { x: best.x, y: best.v ? (best.y + best.v) / 2 + 20 : best.y + 250 };   // туча и земля под ней — оба в кадре
        else if (best && bp >= 2) target = { x: best.x, y: best.k === 'orbital' ? best.v : best.y };
        else if (fx.focus) target = fx.focus;
        else { const a = sc.soldiers.find(s => s.id === sc.turn.sid); if (a && !a.gone) target = { x: a.x, y: a.y - 58 }; }
      }
    }
    if (target) {
      // снаряд у края или за экраном — камера догоняет его быстро, иначе плавно
      const far = Math.abs(target.x - this.x) * this.z > sw * 0.3 || Math.abs(target.y - this.y) * this.z > sh * 0.3;
      const k = 1 - Math.exp(-dt * (far ? 10 : 3.4)); this.x += (target.x - this.x) * k; this.y += (target.y - this.y) * k;
    }
    // авиаудар: пока самолёт заходит и бомбы падают, обзор чуть шире (не дальше пределов колеса)
    if (sc.entities.some(e => (e.k === 'jet' && !e.s) || e.k === 'bomb')) this.tz = Math.max(zmin, Math.min(this.tz, this.baseZoom(sh, sw) * 0.78));
    this.z += (this.tz - this.z) * (1 - Math.exp(-dt * 7));
    this.clampTo(sc, sw, sh);
    const s = fx.shake; this.sx = s ? (Math.random() * 2 - 1) * s : 0; this.sy = s ? (Math.random() * 2 - 1) * s : 0;
  }
  /** курсор в полосе у края экрана: направление и сила прокрутки (0…1 по глубине захода в полосу), иначе null */
  edgeDir(mouse, sw, sh) {
    const m = Math.max(36, Math.min(sw, sh) * 0.07);
    const f = (p, size) => p < m ? -(1 - Math.max(0, p) / m) : p > size - m ? 1 - Math.max(0, size - p) / m : 0;
    const ex = f(mouse.x, sw), ey = f(mouse.y, sh); if (!ex && !ey) return null;
    const k = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.25) * 0.85 + Math.sign(v) * 0.15;   // плавный старт у границы полосы, быстрее у самого края
    return [ex ? k(ex) : 0, ey ? k(ey) : 0];
  }
  clampTo(sc, sw, sh) {
    const hw = sw / 2 / this.z, hh = sh / 2 / this.z;
    const minX = hw - 250, maxX = sc.W - hw + 250;
    this.x = minX > maxX ? sc.W / 2 : clamp(this.x, minX, maxX);
    const minY = -900 + hh, maxY = sc.waterY + 270 - hh; // запас снизу, чтобы бойцы у воды не прятались под нижним HUD
    this.y = minY > maxY ? maxY : clamp(this.y, minY, maxY);
  }
  /** колесо мыши: только небольшое приближение/отдаление вокруг курсора */
  zoomAt(f, px, py, sw, sh) {
    const [wx, wy] = this.toWorld(px, py, sw, sh); const [zmin, zmax] = this.zoomLimits(sh, sw);
    this.userZ = clamp((this.userZ ?? this.baseZoom(sh, sw)) * f, zmin, zmax); this.z = this.tz = this.userZ;
    const [wx2, wy2] = this.toWorld(px, py, sw, sh); this.x += wx - wx2; this.y += wy - wy2; this.free = Math.max(this.free, 2.5);
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

function hudPanel(c, x, y, w, h, r = 12) {
  c.save(); rrect(c, x, y, w, h, r); c.fillStyle = 'rgba(12,16,26,0.72)'; c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 1; c.stroke(); c.restore();
}

class Renderer {
  constructor(cv) { this.cv = cv; this.c = cv.getContext('2d'); this.dpr = 1; this.sw = 1; this.sh = 1; this.anim = new Map(); this.mini = null; this.miniVer = -1; this.miniT = 0; this.miniRect = null; this.vig = null; this.turnStart = 0; this.lastSid = -1; }
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
  blit(c, img, v, sc) {
    const x0 = Math.max(0, Math.floor(v.x0)), y0 = Math.max(0, Math.floor(v.y0)), x1 = Math.min(sc.W, Math.ceil(v.x1)), y1 = Math.min(sc.H, Math.ceil(v.y1));
    if (x1 > x0 && y1 > y0) c.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }
  wave(x, t, ph) { return Math.sin(x * 0.018 + t * 1.5 + ph) * 3 + Math.sin(x * 0.047 - t * 2.1 + ph * 2) * 1.8 + Math.sin(x * 0.11 + t * 3.2) * 0.7; }
  /** отражение в воде: полосы кадра над линией воды зеркально переносятся вниз, дрожат по волнам и гаснут с глубиной */
  drawReflection(c, wy, t) {
    const m = c.getTransform(), cv = c.canvas, sy = Math.round(wy * m.d + m.f);
    if (sy <= 0 || sy >= cv.height - 2) return;
    const depth = Math.min(sy, cv.height - sy, Math.round(260 * m.d)), band = Math.max(1, Math.round(2 * this.dpr));
    if (!this.reflCv || this.reflCv.width !== cv.width || this.reflCv.height < depth) this.reflCv = makeCanvas(cv.width, Math.max(depth, 8));
    const r = this.reflCv.getContext('2d'); r.setTransform(1, 0, 0, 1, 0, 0); r.clearRect(0, 0, cv.width, depth);
    r.filter = 'blur(' + (1.2 * this.dpr).toFixed(1) + 'px)'; r.drawImage(cv, 0, sy - depth, cv.width, depth, 0, 0, cv.width, depth); r.filter = 'none';   // снимок полосы над водой, чуть размыт — вода не зеркало
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = 0; k < depth; k += band) {
      const q = 1 - k / depth, a = 0.42 * q * Math.sqrt(q), dx = (Math.sin(t * 1.6 + k * 0.05) * 0.8 + Math.sin(t * 2.7 + k * 0.17) * 0.45) * (1 + k * 0.03) * this.dpr;   // плавная рябь, отражение гаснет с глубиной
      c.globalAlpha = a; c.drawImage(this.reflCv, 0, depth - k - band, cv.width, band, dx, sy + k, cv.width, band);
    }
    c.restore();
  }
  drawLiquid(c, sc, v, t, back) {
    const L = sc.theme.liquid, wy = sc.waterY; if (v.y1 < wy - 20) return;
    const lava = L.kind === 'lava'; const tt = lava ? t * 0.35 : t; const amp = lava ? 1.4 : 1;
    const x0 = v.x0 - 20, x1 = v.x1 + 20, bot = Math.max(v.y1 + 20, wy + 40), step = 12;
    c.beginPath(); c.moveTo(x0, bot);
    for (let x = x0; x <= x1 + step; x += step) c.lineTo(x, wy + (back ? -6 : 0) + this.wave(x, tt, back ? 2.3 : 0) * amp);
    c.lineTo(x1 + step, bot); c.closePath();
    if (back) { c.fillStyle = css(shadec(L.mid, lava ? 1 : 0.8)); c.fill(); return; }
    const g = c.createLinearGradient(0, wy - 6, 0, wy + 280); g.addColorStop(0, L.top); g.addColorStop(0.22, L.mid); g.addColorStop(1, L.deep);
    c.save(); c.globalAlpha = L.alpha; c.fillStyle = g; c.fill(); c.restore();
    if (!lava) this.drawReflection(c, wy, t);
    c.save();
    c.lineWidth = lava ? 3 : 2; c.strokeStyle = lava ? 'rgba(255,240,170,0.9)' : rgba(L.foam, 0.85); c.beginPath();
    for (let x = x0; x <= x1 + step; x += step) { const y = wy + this.wave(x, tt, 0) * amp; if (x === x0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke();
    const span = Math.max(1, x1 - x0);
    if (lava) {
      c.fillStyle = 'rgba(90,20,5,0.45)';
      for (let i = 0; i < 24; i++) { const gx = x0 + (((i * 173.3 + t * 9 * (i % 3 + 1)) % span) + span) % span; c.beginPath(); c.ellipse(gx, wy + 8 + (i * 7 % 40), 12 + (i % 5) * 5, 3, 0, 0, TAU); c.fill(); }
      c.globalCompositeOperation = 'lighter'; const g2 = c.createLinearGradient(0, wy - 50, 0, wy + 40); g2.addColorStop(0, 'rgba(255,120,30,0)'); g2.addColorStop(1, 'rgba(255,150,50,0.35)'); c.fillStyle = g2; c.fillRect(x0, wy - 50, span, 90);
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
      // рябь и солнечные блики: много коротких бликов у поверхности, сгущаются в «солнечную дорожку»
      const sunX = x0 + span * 0.72;
      for (let i = 0; i < 160; i++) {
        const gx = x0 + (((i * 137.5 + Math.floor(t * 0.8 + i * 0.37) * 57.3) % span) + span) % span, gy = wy + 3 + Math.pow((i * 7 % 23) / 23, 1.6) * 60;
        const near = Math.exp(-Math.pow((gx - sunX) / (span * 0.12), 2)), a = (0.12 + 0.55 * near) * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.7));
        c.fillStyle = rgba(L.glint || '#ffffff', a); c.fillRect(gx, gy, 3 + (i % 5) * 2 + near * 6, 1 + near * 0.6);
      }
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
    if (!this.hires.draw(c, sc, v, z * dpr)) { this.blit(c, sc.terrain.decor, v, sc); this.blit(c, sc.terrain.canvas, v, sc); }
    if (sc.terrain.drawSurfaceNative) sc.terrain.drawSurfaceNative(c, v, z * dpr);
    drawTacticalRoutes(c, sc.map);
    if (window.NAV_DEBUG && typeof NavCheck !== 'undefined' && NAV_DEBUG.map === sc.map.id) NavCheck.draw(c, NAV_DEBUG.res);
    if (sc.terrain.glow) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 + 0.22 * Math.sin(t * 1.6); this.blit(c, sc.terrain.glow, v, sc); c.restore(); }
    drawProps(c, sc, t, false);
    this.drawWorldAids(c, sc, ctl, t);
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
    // границы запаса хода: радиус по горизонтали от точки начала хода
    if (T.ox !== undefined) {
      c.save(); c.setLineDash([6, 6]); c.lineWidth = 2;
      for (const bx of [T.ox - WALK_BUDGET, T.ox + WALK_BUDGET]) {
        const near = Math.abs(s.x - bx) < 160;
        c.strokeStyle = near ? 'rgba(255,190,90,0.85)' : 'rgba(255,255,255,0.28)';
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
    if (!mine) return;
    const mx = ctl.mouseW.x, my = ctl.mouseW.y;
    if (T.weapon === 'girder') {
      c.save(); c.globalAlpha = 0.55; c.translate(mx, my); c.rotate(Math.atan2(SIN8[T.rot & 7], COS8[T.rot & 7]));
      const far = Math.hypot(mx - s.x, my - s.y + 14) > 300;
      c.fillStyle = far ? '#ff4040' : '#ffb347'; c.fillRect(-48, -6, 96, 12); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(-48, -6, 96, 12); c.restore();
      c.save(); c.strokeStyle = 'rgba(255,255,255,0.18)'; c.setLineDash([5, 6]); c.beginPath(); c.arc(s.x, s.y - 14, 300, 0, TAU); c.stroke(); c.restore();
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
      c.font = `600 11px ${FONT_UI}`; textOutlined(c, s.name, x, y - 14, col, 'rgba(0,0,0,0.85)', 3);
      if (s.id === T.sid && (T.phase === 'aim' || T.phase === 'wait') && t - this.turnStart < 4) {
        const b = Math.abs(Math.sin((t - this.turnStart) * 5)) * 7;
        c.fillStyle = col; c.beginPath(); c.moveTo(x - 8, y - 42 - b); c.lineTo(x + 8, y - 42 - b); c.lineTo(x, y - 30 - b); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.5; c.stroke();
      }
    }
    // прицела у бойца нет: направление видно по оружию в руках; сила броска — шкала слева в HUD
    if (T.target && T.phase !== 'over') {
      const [x, y] = cam.toScreen(T.target.x, T.target.y, sw, sh); brightCross(c, x, y, t, '#ff6a3a', 1.2);   // захваченная цель самонаводки
    }
    // прицел выбора точки для ударов с воздуха: поверх всего и без цветокоррекции — яркий и чёткий; пока самолёт летит, его нет (сброс на глаз)
    const AIM_COL = { airstrike: '#ffe23a', lightning: '#8fd8ff', orbital: '#ff6af0', nuke: '#ffd23a', homing: '#ff8a3a' };
    if (ctl && ctl.mine && T.phase === 'aim' && AIM_COL[T.weapon] && !(T.weapon === 'homing' && T.target)) {
      const [mx, my] = cam.toScreen(ctl.mouseW.x, ctl.mouseW.y, sw, sh), act = sc.soldiers.find(o => o.id === T.sid);
      if (T.weapon === 'airstrike' && act) {
        // курс самолёта: пройдёт над выбранной точкой в сторону от бойца
        const dir = ctl.mouseW.x >= act.x ? 1 : -1, L = 420 * cam.z, ay = my - 230 * cam.z;
        c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
        for (const [col, w] of [['rgba(0,0,0,0.72)', 6], ['#fff27a', 3]]) {
          c.strokeStyle = col; c.lineWidth = w; c.setLineDash([18, 12]);
          c.beginPath(); c.moveTo(mx - dir * L, ay); c.lineTo(mx + dir * L, ay); c.stroke(); c.setLineDash([]);
          c.beginPath(); c.moveTo(mx + dir * (L - 26), ay - 13); c.lineTo(mx + dir * L, ay); c.lineTo(mx + dir * (L - 26), ay + 13); c.stroke();
          c.setLineDash([4, 9]); c.beginPath(); c.moveTo(mx, ay + 10); c.lineTo(mx, my - 40); c.stroke(); c.setLineDash([]);
        }
        c.restore();
      }
      brightCross(c, mx, my, t, AIM_COL[T.weapon], 1.35);
    }
    // самолёт выше экрана (над горами летит выше): метка у верхнего края над тем местом, где он сейчас
    if (T.phase === 'use' && T.weapon === 'airstrike') {
      const jet = sc.entities.find(e => e.k === 'jet' && !e.s);
      if (jet) {
        const [x, y] = cam.toScreen(jet.x, jet.y, sw, sh), dir = Math.cos(jet.a) >= 0 ? 1 : -1;
        if (y < 8 && x > -40 && x < sw + 40) {
          c.save(); c.translate(clamp(x, 14, sw - 14), 18); c.scale(dir, 1); c.fillStyle = '#ff7850'; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.lineWidth = 1.5;
          c.beginPath(); c.moveTo(16, 0); c.lineTo(-10, -5); c.lineTo(-14, -11); c.lineTo(-18, -11); c.lineTo(-15, -2); c.lineTo(-15, 3); c.lineTo(-10, 5); c.closePath(); c.fill(); c.stroke();
          c.beginPath(); c.moveTo(-2, 1); c.lineTo(-9, 10); c.lineTo(-4, 10); c.lineTo(5, 2); c.closePath(); c.fill(); c.stroke(); c.restore();
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
  /** шкала силы броска: слева у края экрана, только пока зажата кнопка выстрела */
  drawPowerBar(c, sc, ctl, sw, sh) {
    const T = sc.turn; if (T.phase !== 'aim') return;
    const pw = ctl && ctl.mine ? (ctl.charging ? ctl.power : -1) : T.charge;
    if (!(pw >= 0)) return;
    const w = 26, h = Math.min(320, sh * 0.42), x = 22, y = sh / 2 - h / 2;
    c.save();
    hudPanel(c, x - 8, y - 34, w + 16, h + 68, 12);
    c.fillStyle = 'rgba(0,0,0,0.45)'; rrect(c, x, y, w, h, 6); c.fill();
    const g = c.createLinearGradient(0, y + h, 0, y); g.addColorStop(0, '#3ad06a'); g.addColorStop(0.55, '#f2d23a'); g.addColorStop(1, '#ff4a3a');
    const fh = h * clamp(pw, 0, 1);
    c.save(); rrect(c, x, y, w, h, 6); c.clip(); c.fillStyle = g; c.fillRect(x, y + h - fh, w, fh); c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
    for (let k = 1; k < 10; k++) { const yy = y + h - h * k / 10; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + (k % 5 ? 7 : w), yy); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; rrect(c, x, y, w, h, 6); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    c.font = `15px ${FONT_TITLE}`; c.fillText(Math.round(pw * 100) + '%', x + w / 2, y - 17);
    c.font = `11px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillText('до макс. ' + Math.max(0, 100 - Math.round(pw * 100)) + '%', x + w / 2, y + h + 17);
    c.restore();
  }
  /* ---------- HUD ---------- */
  drawHUD(sc, cam, ctl, t, extra) {
    const c = this.c, sw = this.sw, sh = this.sh; const T = sc.turn;
    this.drawScope(c, sc, cam, ctl, sw, sh);
    this.drawBinoculars(c, cam, sw, sh, t, sc);
    this.drawPowerBar(c, sc, ctl, sw, sh);
    c.save(); c.textBaseline = 'middle';
    const team = sc.teams[T.team]; const act = sc.soldiers.find(s => s.id === T.sid);
    // панель хода
    if (team && T.phase !== 'over') {
      const w = 320, h = 56, x = sw / 2 - w / 2, y = 10;
      hudPanel(c, x, y, w, h, 14);
      c.fillStyle = team.color; rrect(c, x + 8, y + 8, 6, h - 16, 3); c.fill();
      c.textAlign = 'left'; c.font = `18px ${FONT_TITLE}`; c.fillStyle = '#fff';
      c.fillText(act ? act.name : '—', x + 24, y + 21);
      c.font = `13px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.7)';
      const phaseTxt = T.phase === 'retreat' ? 'Отступайте!' : T.phase === 'use' ? 'Действие...' : T.phase === 'settle' || T.phase === 'wait' ? 'Ожидание...' : T.phase === 'crate' ? 'Сброс припасов' : (ctl && ctl.mine ? 'Ваш ход' : 'Ход соперника');
      c.fillText(`${team.name} · ${phaseTxt}`, x + 24, y + 40);
      // время хода 0 — без ограничения: полное кольцо и знак ∞ (отступление по-прежнему считается)
      const inf = T.phase !== 'retreat' && !((sc.settings || sc.cfg.settings).turnTime > 0);
      const val = T.phase === 'retreat' ? T.retreat : T.time; const max = T.phase === 'retreat' ? RETREAT_TIME : (sc.settings || sc.cfg.settings).turnTime;
      const cx = x + w - 32, cy = y + h / 2, low = !inf && val <= 5 && T.phase === 'aim';
      c.beginPath(); c.arc(cx, cy, 20, 0, TAU); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill();
      c.strokeStyle = low ? '#ff4d4d' : team.color; c.lineWidth = 4;
      c.beginPath(); c.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + TAU * (inf ? 1 : clamp(val / max, 0, 1))); c.stroke();
      c.textAlign = 'center'; c.font = `${inf ? 24 : 18}px ${FONT_TITLE}`; c.fillStyle = low && Math.sin(t * 10) > 0 ? '#ff6b6b' : '#fff';
      c.fillText(inf ? '∞' : String(Math.ceil(Math.max(0, val))), cx, cy + 1);
      // ветер
      // стрелки растут от своей оси, подпись стоит слева от них и не перекрывается
      const wy = y + h + 16, ax = sw / 2 + 22;
      hudPanel(c, ax - 136, wy - 12, 231, 24, 10);
      const k = clamp(T.wind / MAX_WIND, -1, 1); const segs = 8;
      for (let i = 0; i < segs; i++) {
        const on = Math.abs(k) * segs > i; const dir = k >= 0 ? 1 : -1;
        const bx = ax + dir * (8 + i * 10); c.fillStyle = on ? (Math.abs(k) > 0.66 ? '#ff7a4a' : '#6fd0ff') : 'rgba(255,255,255,0.12)';
        c.beginPath(); c.moveTo(bx, wy - 6); c.lineTo(bx + dir * 7, wy); c.lineTo(bx, wy + 6); c.lineTo(bx + dir * 3, wy); c.closePath(); c.fill();
      }
      c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = `10px ${FONT_UI}`; c.textAlign = 'right'; c.fillText('ВЕТЕР', ax - 94, wy); c.textAlign = 'center';
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(ax - 0.5, wy - 7, 1, 14);
    }
    // команды
    let by = sh - 16 - sc.teams.length * 30;
    for (const tm of sc.teams) {
      const members = sc.soldiers.filter(s => s.team === tm.idx);
      const hp = members.reduce((a, s) => a + (s.alive ? s.hp : 0), 0), mx = members.reduce((a, s) => a + s.maxHp, 0) || 1;
      const alive = members.filter(s => s.alive).length;
      hudPanel(c, 12, by - 12, 250, 26, 9);
      c.textAlign = 'left'; c.font = `13px ${FONT_TITLE}`; c.fillStyle = tm.color; c.fillText(tm.name, 22, by + 1);
      c.fillStyle = 'rgba(255,255,255,0.12)'; rrect(c, 120, by - 6, 108, 12, 6); c.fill();
      c.fillStyle = hpFriend(sc, tm.idx ?? sc.teams.indexOf(tm)) ? '#3ddc6a' : '#ff4d4d'; rrect(c, 120, by - 6, Math.max(6, 108 * hp / mx), 12, 6); c.fill();
      c.fillStyle = '#fff'; c.font = `11px ${FONT_UI}`; c.textAlign = 'right'; c.fillText(`${alive}`, 250, by + 1);
      by += 30;
    }
    // оружие
    if (ctl && ctl.mine && (T.phase === 'aim' || T.phase === 'use' || T.phase === 'retreat')) {
      const W = WEAPON[T.weapon]; const tm = sc.teams[T.team];
      const w = 390, h = 64, x = sw / 2 - w / 2, y = sh - h - 14;
      hudPanel(c, x, y, w, h, 14);
      if (W) {
        c.drawImage(weaponIcon(W.id, 48), x + 10, y + 8);
        c.textAlign = 'left'; c.font = `17px ${FONT_TITLE}`; c.fillStyle = '#fff'; c.fillText(W.name, x + 66, y + 20);
        const am = tm && tm.ammo[W.id]; c.font = `13px ${FONT_UI}`; c.fillStyle = '#ffd166';
        c.textAlign = 'right'; c.fillText(am < 0 ? '∞' : `×${am}`, x + w - 14, y + 20);
        c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,0.72)'; c.font = `12px ${FONT_UI}`;
        c.fillText(ctl.hint(sc, T), x + 66, y + 40);
      } else {
        c.textAlign = 'left'; c.font = `17px ${FONT_TITLE}`; c.fillStyle = '#fff'; c.fillText('Руки пусты', x + 66, y + 20);
        c.fillStyle = 'rgba(255,255,255,0.72)'; c.font = `12px ${FONT_UI}`; c.fillText('Tab — арсенал, Q/E или 1–6 — взять оружие, Esc — пауза', x + 66, y + 40);
      }
      const wk = clamp(T.walk / WALK_BUDGET, 0, 1);
      c.fillStyle = 'rgba(255,255,255,0.12)'; rrect(c, x + 66, y + 51, w - 80, 5, 2.5); c.fill();
      c.fillStyle = wk > 0.25 ? '#6fd0ff' : '#ff7a4a'; rrect(c, x + 66, y + 51, (w - 80) * wk, 5, 2.5); c.fill();
    }
    // подсказки внизу справа
    // подсказка про бинокль — на подложке и только пока игрок им ни разу не пользовался
    if (cam.binocK > 0.5) this.binocUsed = true;
    const hint = cam.binoc ? 'Бинокль: ведите мышь к краю' : cam.edge ? (cam.hold ? 'Обзор у цели · C — вернуться к бойцу' : 'Цель за экраном? Ведите курсор к краю экрана') : this.binocUsed ? '' : 'Бинокль — удерживайте ПКМ или B';
    c.textAlign = 'right'; c.font = `12px ${FONT_UI}`;
    if (hint) { const hw = c.measureText(hint).width + 20; hudPanel(c, sw - 14 - hw, sh - 88, hw, 24, 8); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillText(hint, sw - 24, sh - 76); }
    if (extra && extra.ping !== undefined) { c.font = `11px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillText(`пинг ${extra.ping} мс`, sw - 106, sh - 34); }
    c.restore();
  }
  /** оверлей бинокля: две линзы, шкала и затемнение по краям */
  /** оптический прицел снайперки: линза ×3 на линии ствола в точке курсора, сетка с дальномерными метками */
  drawScope(c, sc, cam, ctl, sw, sh) {
    const T = sc.turn; if (T.weapon !== 'sniper' || T.phase !== 'aim' || !ctl || !ctl.mine || !ctl.scopeOn || cam.binocK > 0.5) return;
    const s = sc.soldiers.find(o => o.id === T.sid); if (!s || !s.alive) return;
    const [gx, gy] = cam.toScreen(s.x, s.y - GUN_Y, sw, sh), [mx, my] = cam.toScreen(ctl.mouseW.x, ctl.mouseW.y, sw, sh);
    const dist = Math.max(90, Math.hypot(mx - gx, my - gy)), cx = gx + Math.cos(ctl.aim) * dist, cy = gy + Math.sin(ctl.aim) * dist;
    const R = Math.round(Math.min(sw, sh) * 0.16), Z = 3, dpr = this.dpr, src = this.c.canvas;
    if (!this.scopeCv || this.scopeCv.width !== Math.ceil(2 * R * dpr)) this.scopeCv = makeCanvas(Math.ceil(2 * R * dpr), Math.ceil(2 * R * dpr));
    const tc = this.scopeCv.getContext('2d'); tc.setTransform(1, 0, 0, 1, 0, 0); tc.fillStyle = '#000'; tc.fillRect(0, 0, this.scopeCv.width, this.scopeCv.height);
    const r0 = R / Z; tc.imageSmoothingQuality = 'high';
    tc.drawImage(src, (cx - r0) * dpr, (cy - r0) * dpr, 2 * r0 * dpr, 2 * r0 * dpr, 0, 0, this.scopeCv.width, this.scopeCv.height);
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
    c.font = `11px ${FONT_TITLE}`; c.fillStyle = 'rgba(220,235,255,0.8)'; c.textAlign = 'left'; c.fillText(`×${Z}  ${Math.round(Math.hypot(ctl.mouseW.x - s.x, ctl.mouseW.y - s.y) / 10)} м`, cx + R * 0.45, cy + R * 0.82);
    c.restore();
  }
  drawBinoculars(c, cam, sw, sh, t, sc) {
    const k = cam.binocK; if (k < 0.02) return;
    const R = Math.min(sh * 0.47, sw * 0.29);
    if (!this.binMask || this.binMask.w !== sw || this.binMask.h !== sh) {
      const cv = makeCanvas(sw, sh); const m = cv.getContext('2d');
      m.fillStyle = '#05070a'; m.fillRect(0, 0, sw, sh);
      m.globalCompositeOperation = 'destination-out';
      for (const cx of [sw / 2 - R * 0.6, sw / 2 + R * 0.6]) {
        const g = m.createRadialGradient(cx, sh / 2, R * 0.82, cx, sh / 2, R);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        m.fillStyle = g; m.beginPath(); m.arc(cx, sh / 2, R, 0, TAU); m.fill();
      }
      m.globalCompositeOperation = 'source-over';
      const tint = m.createRadialGradient(sw / 2, sh / 2, R * 0.2, sw / 2, sh / 2, R * 1.6);
      tint.addColorStop(0, 'rgba(120,170,220,0)'); tint.addColorStop(1, 'rgba(40,70,110,0.28)');
      m.fillStyle = tint; m.fillRect(0, 0, sw, sh);
      this.binMask = cv; cv.w = sw; cv.h = sh;
    }
    c.save(); c.globalAlpha = k; c.drawImage(this.binMask, 0, 0, sw, sh);
    c.strokeStyle = 'rgba(210,235,255,0.35)'; c.lineWidth = 1;
    const cx = sw / 2, cy = sh / 2;
    c.beginPath(); c.moveTo(cx - R * 0.9, cy); c.lineTo(cx + R * 0.9, cy); c.moveTo(cx, cy - R * 0.55); c.lineTo(cx, cy + R * 0.55); c.stroke();
    for (let i = -8; i <= 8; i++) { if (!i) continue; const x = cx + i * R * 0.1; const h = i % 4 ? 4 : 9; c.beginPath(); c.moveTo(x, cy - h); c.lineTo(x, cy + h); c.stroke(); }
    c.font = `12px ${FONT_TITLE}`; c.fillStyle = 'rgba(210,235,255,0.6)'; c.textAlign = 'left'; c.fillText('×8', cx + R * 0.62, cy - R * 0.62);
    // оправа линз: тёмный металл с бликом сверху, только по внешнему контуру «восьмёрки»
    const lx = [cx - R * 0.6, cx + R * 0.6];
    lx.forEach((ex, i) => {
      const ox = lx[1 - i];
      c.save(); c.beginPath(); c.rect(0, 0, sw, sh); c.arc(ox, cy, R * 0.93, 0, TAU, true); c.clip('evenodd');
      c.lineWidth = R * 0.07; c.strokeStyle = 'rgba(8,10,14,0.9)'; c.beginPath(); c.arc(ex, cy, R * 0.955, 0, TAU); c.stroke();
      const rim = c.createLinearGradient(ex, cy - R, ex, cy + R);
      rim.addColorStop(0, 'rgba(160,178,196,0.55)'); rim.addColorStop(0.35, 'rgba(60,68,80,0.35)'); rim.addColorStop(1, 'rgba(20,24,30,0.2)');
      c.lineWidth = 2; c.strokeStyle = rim; c.beginPath(); c.arc(ex, cy, R * 0.92, 0, TAU); c.stroke();
      c.restore();
      // отсвет стекла
      c.save(); c.beginPath(); c.arc(ex, cy, R * 0.9, 0, TAU); c.clip();
      const gl = c.createLinearGradient(ex - R, cy - R, ex + R * 0.2, cy + R * 0.2);
      gl.addColorStop(0, 'rgba(255,255,255,0.10)'); gl.addColorStop(0.45, 'rgba(255,255,255,0.025)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)');
      c.fillStyle = gl; c.fillRect(ex - R, cy - R, R * 2, R * 2); c.restore();
    });
    // дальномер: расстояние и направление до активного бойца, чтобы не потеряться в бинокле
    const a = sc && sc.soldiers.find(s => s.id === sc.turn.sid);
    if (a && !a.gone) {
      const dx = a.x - cam.x, dy = a.y - cam.y, d = Math.hypot(dx, dy);
      c.font = `13px ${FONT_TITLE}`; c.textAlign = 'center'; c.fillStyle = 'rgba(210,235,255,0.75)';
      c.fillText(`${Math.round(d / 10)} м`, cx, cy + R * 0.62);
      if (d > 120) {
        const ang = Math.atan2(dy, dx), px = cx + Math.cos(ang) * R * 0.78, py = cy + Math.sin(ang) * R * 0.5;
        c.save(); c.translate(px, py); c.rotate(ang); c.fillStyle = sc.teams[a.team]?.color || '#fff'; c.globalAlpha *= 0.85;
        c.beginPath(); c.moveTo(10, 0); c.lineTo(-6, -7); c.lineTo(-2, 0); c.lineTo(-6, 7); c.closePath(); c.fill(); c.restore();
      }
    }
    c.restore();
  }
}
