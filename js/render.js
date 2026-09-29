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
  constructor() { this.x = 1600; this.y = 900; this.z = 1; this.tz = 1; this.sx = 0; this.sy = 0; this.free = 0; this.userZ = null; this.inited = false; this.binoc = false; this.binocK = 0; }
  toScreen(wx, wy, sw, sh) { return [(wx - this.x) * this.z + sw / 2 + this.sx, (wy - this.y) * this.z + sh / 2 + this.sy]; }
  toWorld(px, py, sw, sh) { return [(px - sw / 2 - this.sx) / this.z + this.x, (py - sh / 2 - this.sy) / this.z + this.y]; }
  view(sw, sh, m = 0) { const hw = sw / 2 / this.z, hh = sh / 2 / this.z; return { x0: this.x - hw - m, y0: this.y - hh - m, x1: this.x + hw + m, y1: this.y + hh + m }; }
  /** на широких мониторах ширина обзора тоже ограничена (не больше ~2000 px карты) */
  baseZoom(sh, sw = 0) { return Math.max(clamp(sh / 680, 0.72, 1.9), sw / 1800); }
  zoomLimits(sh, sw = 0) { const b = this.baseZoom(sh, sw); return [Math.max(b * 0.84, sw / 2300), b * 1.7]; }
  reset() { this.inited = false; this.free = 0; this.userZ = null; this.binoc = false; this.binocK = 0; }
  update(dt, sc, fx, sw, sh, mouse) {
    if (!this.inited) { this.inited = true; this.x = sc.W / 2; this.y = sc.waterY - 420; this.z = this.tz = this.baseZoom(sh, sw); }
    const [zmin, zmax] = this.zoomLimits(sh, sw);
    if (this.userZ !== null) this.userZ = clamp(this.userZ, zmin, zmax);
    this.binocK = approach(this.binocK, this.binoc ? 1 : 0, 9, dt);
    // бинокль не приближает: он плавно ведёт обзор за мышью
    this.tz = this.userZ ?? this.baseZoom(sh, sw);
    let target = null;
    {
      if (this.binoc && mouse) {
        const R = Math.min(sw, sh) * 0.5;
        const ox = (mouse.x - sw / 2) / R, oy = (mouse.y - sh / 2) / R; const m = Math.hypot(ox, oy);
        if (m > 0.1) { const k = Math.min(1.7, (m - 0.1) / 0.9); const sp = 1450 * Math.pow(k, 1.35) / this.z; this.x += ox / m * sp * dt; this.y += oy / m * sp * dt; }
        this.free = 1.3;
      } else if (this.free > 0) this.free -= dt;
      else {
        let best = null, bp = 0;
        for (const e of sc.entities) {
          let p = CAM_PRI[e.k] || 0; if (e.k === 'mine' && e.s === 2) p = 2; if (e.k === 'crate' && e.v) p = 2;
          if (e.k === 'jet' && !e.s) p = 3; if (e.k === 'storm') p = 3;
          if (p > bp || (p === bp && p > 0 && best && e.id > best.id)) { bp = p; best = e; }
        }
        // самолёт: смотрим вперёд по курсу, между самолётом и землёй; туча: под неё
        if (best && best.k === 'jet') target = { x: best.x + Math.cos(best.a) * 260, y: (best.y + (best.v || best.y + 500)) / 2 };
        else if (best && best.k === 'storm') target = { x: best.x, y: best.y + 250 };
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
    this.z += (this.tz - this.z) * (1 - Math.exp(-dt * 7));
    this.clampTo(sc, sw, sh);
    const s = fx.shake; this.sx = s ? (Math.random() * 2 - 1) * s : 0; this.sy = s ? (Math.random() * 2 - 1) * s : 0;
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

/** цветокоррекция по темам: [свет сверху, тени снизу] (режим soft-light) */
const GRADE = {
  valley: ['rgba(255,214,150,0.55)', 'rgba(50,80,150,0.5)'],
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
    const depth = Math.min(sy, cv.height - sy, Math.round(260 * m.d)), band = Math.max(3, Math.round(4 * this.dpr));
    if (!this.reflCv || this.reflCv.width !== cv.width || this.reflCv.height < depth) this.reflCv = makeCanvas(cv.width, Math.max(depth, 8));
    const r = this.reflCv.getContext('2d'); r.setTransform(1, 0, 0, 1, 0, 0); r.clearRect(0, 0, cv.width, depth);
    r.drawImage(cv, 0, sy - depth, cv.width, depth, 0, 0, cv.width, depth);       // снимок полосы над водой
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = 0; k < depth; k += band) {
      const a = 0.46 * (1 - k / depth), dx = Math.sin(t * 2.2 + k * 0.09) * (1 + k * 0.035) * this.dpr;
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
      for (let i = 0; i < 46; i++) {
        const gx = x0 + (((i * 137.5 + Math.floor(t * 0.6 + i * 0.37) * 57.3) % span) + span) % span; const gy = wy + 5 + (i * 13 % 70);
        c.fillStyle = rgba(L.glint || '#ffffff', 0.22 * (0.5 + 0.5 * Math.sin(t * 3 + i))); c.fillRect(gx, gy, 6 + (i % 4) * 3, 1.2);
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
    this.blit(c, sc.terrain.decor, v, sc);
    this.blit(c, sc.terrain.canvas, v, sc);
    drawTacticalRoutes(c, sc.map);
    if (window.NAV_DEBUG && typeof NavCheck !== 'undefined' && NAV_DEBUG.map === sc.map.id) NavCheck.draw(c, NAV_DEBUG.res);
    if (sc.terrain.glow) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 + 0.22 * Math.sin(t * 1.6); this.blit(c, sc.terrain.glow, v, sc); c.restore(); }
    drawProps(c, sc, t, false);
    this.drawWorldAids(c, sc, ctl, t);
    for (const e of sc.entities) if (e.x > v.x0 - 80 && e.x < v.x1 + 80) drawEntity(c, e, t, sc);
    for (const s of sc.soldiers) {
      if (s.gone) continue; const an = this.animFor(s, dt);
      if (s.x < v.x0 - 40 || s.x > v.x1 + 40 || s.y < v.y0 - 40 || s.y > v.y1 + 60) continue;
      drawSoldier(c, s, sc.teams[s.team], t, an);
    }
    fx.drawWorld(c, sc, t);
    this.drawLiquid(c, sc, v, t, false);
    if (fx.weather) fx.weather.draw(c, t);
    fx.drawLights(c, sc, cam, sw, sh, dpr, t);
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    this.drawGrade(c, sc, sw, sh);
    this.drawVignette(c, sw, sh);
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
    } else if (T.weapon === 'airstrike') {
      // только курс самолёта: где упадут бомбы — решает момент сброса
      const dir = mx >= s.x ? 1 : -1; const ay = my - 230;
      c.save(); c.strokeStyle = 'rgba(255,120,80,0.8)'; c.lineWidth = 2; c.setLineDash([14, 10]);
      c.beginPath(); c.moveTo(mx - dir * 420, ay); c.lineTo(mx + dir * 420, ay); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.moveTo(mx + dir * 420, ay); c.lineTo(mx + dir * 400, ay - 9); c.moveTo(mx + dir * 420, ay); c.lineTo(mx + dir * 400, ay + 9); c.stroke();
      c.globalAlpha = 0.5; c.beginPath(); c.ellipse(mx, my, 90, 16, 0, 0, TAU); c.stroke(); c.restore();
    } else if (T.weapon === 'orbital' || T.weapon === 'lightning' || T.weapon === 'nuke') {
      const col = T.weapon === 'nuke' ? 'rgba(255,210,60,0.9)' : T.weapon === 'lightning' ? 'rgba(160,210,255,0.9)' : 'rgba(255,90,230,0.9)';
      const spread = T.weapon === 'nuke' ? 124 : T.weapon === 'lightning' ? 70 : 72;
      const drift = T.weapon === 'lightning' ? T.wind * 1.0 : T.weapon === 'nuke' ? T.wind * 0.5 : 0;
      c.save(); c.strokeStyle = col; c.lineWidth = 2;
      c.setLineDash([8, 6]); c.beginPath(); c.arc(mx, my, spread, 0, TAU); c.stroke(); c.setLineDash([]);
      c.globalAlpha = 0.18; c.fillStyle = col; c.beginPath(); c.arc(mx, my, spread, 0, TAU); c.fill(); c.globalAlpha = 1;
      if (Math.abs(drift) > 6) { const ex = mx + drift; c.beginPath(); c.moveTo(mx, my - spread - 16); c.lineTo(ex, my - spread - 16); c.lineTo(ex - Math.sign(drift) * 8, my - spread - 24); c.moveTo(ex, my - spread - 16); c.lineTo(ex - Math.sign(drift) * 8, my - spread - 8); c.stroke(); }
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
      const [x, y] = cam.toScreen(s.x, s.y - 46, sw, sh);
      if (x < -60 || x > sw + 60 || y < -60 || y > sh + 60) continue;
      const team = sc.teams[s.team]; const col = team ? team.color : '#fff';
      const hpTxt = String(s.hp); c.font = `600 13px ${FONT_UI}`;
      const w = Math.max(28, c.measureText(hpTxt).width + 12);
      rrect(c, x - w / 2, y - 8, w, 16, 5); c.fillStyle = 'rgba(10,12,18,0.72)'; c.fill(); c.strokeStyle = col; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = '#fff'; c.fillText(hpTxt, x, y + 0.5);
      c.font = `11px ${FONT_UI}`; textOutlined(c, s.name, x, y - 16, col, 'rgba(0,0,0,0.8)', 3);
      if (s.id === T.sid && (T.phase === 'aim' || T.phase === 'wait') && t - this.turnStart < 4) {
        const b = Math.abs(Math.sin((t - this.turnStart) * 5)) * 7;
        c.fillStyle = col; c.beginPath(); c.moveTo(x - 8, y - 42 - b); c.lineTo(x + 8, y - 42 - b); c.lineTo(x, y - 30 - b); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1.5; c.stroke();
      }
    }
    // прицел и сила у активного бойца
    const s = sc.soldiers.find(o => o.id === T.sid);
    const W = WEAPON[T.weapon];
    if (s && s.alive && !s.gone && T.phase === 'aim' && W && T.weapon !== 'sniper' && (W.mode === 'charge' || W.mode === 'tcharge' || W.mode === 'instant')) {   // у снайперки — только оптика
      const mine = ctl && ctl.mine; const aim = mine ? ctl.aim : s.aim;
      const [sx, sy] = cam.toScreen(s.x, s.y - GUN_Y, sw, sh); const R = 62 * cam.z;
      const cx = sx + Math.cos(aim) * R, cy = sy + Math.sin(aim) * R;
      const col = sc.teams[s.team] ? sc.teams[s.team].color : '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 4; c.beginPath(); c.arc(cx, cy, 7, 0, TAU); c.stroke();
      c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 7, 0, TAU); c.moveTo(cx - 11, cy); c.lineTo(cx - 4, cy); c.moveTo(cx + 4, cy); c.lineTo(cx + 11, cy); c.moveTo(cx, cy - 11); c.lineTo(cx, cy - 4); c.moveTo(cx, cy + 4); c.lineTo(cx, cy + 11); c.stroke();
      const pw = mine ? (ctl.charging ? ctl.power : -1) : T.charge;
      if (pw >= 0) {
        const n = 16; const L = 95 * cam.z;
        for (let i = 0; i < n; i++) {
          const k = (i + 1) / n; if (k > pw + 0.001) break;
          const px = sx + Math.cos(aim) * (18 * cam.z + L * k), py = sy + Math.sin(aim) * (18 * cam.z + L * k);
          c.fillStyle = `hsl(${120 - k * 120},95%,55%)`; circ(c, px, py, (2.5 + k * 6) * Math.min(1.2, cam.z));
        }
      }
    }
    if (T.target && T.phase !== 'over') {
      const [x, y] = cam.toScreen(T.target.x, T.target.y, sw, sh); const p = 1 + 0.15 * Math.sin(t * 8);
      c.strokeStyle = '#ff3030'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 12 * p, 0, TAU); c.moveTo(x - 18, y); c.lineTo(x + 18, y); c.moveTo(x, y - 18); c.lineTo(x, y + 18); c.stroke();
    }
    c.restore();
  }
  /* ---------- HUD ---------- */
  drawHUD(sc, cam, ctl, t, extra) {
    const c = this.c, sw = this.sw, sh = this.sh; const T = sc.turn;
    this.drawScope(c, sc, cam, ctl, sw, sh);
    this.drawBinoculars(c, cam, sw, sh, t, sc);
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
      const val = T.phase === 'retreat' ? T.retreat : T.time; const max = T.phase === 'retreat' ? RETREAT_TIME : (sc.settings || sc.cfg.settings).turnTime;
      const cx = x + w - 32, cy = y + h / 2;
      c.beginPath(); c.arc(cx, cy, 20, 0, TAU); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill();
      c.strokeStyle = val <= 5 && T.phase === 'aim' ? '#ff4d4d' : team.color; c.lineWidth = 4;
      c.beginPath(); c.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(val / max, 0, 1)); c.stroke();
      c.textAlign = 'center'; c.font = `18px ${FONT_TITLE}`; c.fillStyle = val <= 5 && T.phase === 'aim' && Math.sin(t * 10) > 0 ? '#ff6b6b' : '#fff';
      c.fillText(String(Math.ceil(Math.max(0, val))), cx, cy + 1);
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
      c.fillStyle = tm.color; rrect(c, 120, by - 6, Math.max(6, 108 * hp / mx), 12, 6); c.fill();
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
      }
      const wk = clamp(T.walk / WALK_BUDGET, 0, 1);
      c.fillStyle = 'rgba(255,255,255,0.12)'; rrect(c, x + 66, y + 51, w - 80, 5, 2.5); c.fill();
      c.fillStyle = wk > 0.25 ? '#6fd0ff' : '#ff7a4a'; rrect(c, x + 66, y + 51, (w - 80) * wk, 5, 2.5); c.fill();
    }
    // подсказки внизу справа
    // подсказка про бинокль — на подложке и только пока игрок им ни разу не пользовался
    if (cam.binocK > 0.5) this.binocUsed = true;
    const hint = cam.binoc ? 'Бинокль: ведите мышь к краю' : this.binocUsed ? '' : 'Бинокль — удерживайте ПКМ или B';
    c.textAlign = 'right'; c.font = `12px ${FONT_UI}`;
    if (hint) { const hw = c.measureText(hint).width + 20; hudPanel(c, sw - 14 - hw, sh - 88, hw, 24, 8); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillText(hint, sw - 24, sh - 76); }
    if (extra && extra.ping !== undefined) { c.font = `11px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillText(`пинг ${extra.ping} мс`, sw - 106, sh - 34); }
    c.restore();
  }
  /** оверлей бинокля: две линзы, шкала и затемнение по краям */
  /** оптический прицел снайперки: линза ×3 на линии ствола в точке курсора, сетка с дальномерными метками */
  drawScope(c, sc, cam, ctl, sw, sh) {
    const T = sc.turn; if (T.weapon !== 'sniper' || T.phase !== 'aim' || !ctl || !ctl.mine || cam.binocK > 0.5) return;
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
