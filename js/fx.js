'use strict';
/* =========================================================
   Эффекты: обработка игровых событий (у хоста и у гостя),
   частицы, освещение, всплывающий урон, баннеры, тряска
   ========================================================= */
const TRAIL_RATE = { rocket: 0.012, mini: 0.02, homing: 0.012, nukem: 0.008, drill: 0.02, mortar: 0.03, frag: 0.05, bomb: 0.035, bomblet: 0.05, dynamite: 0.03, fire: 0.07, bhole: 0.008, jet: 0.02, orbital: 0.02, molotov: 0.04 };
const ENT_LIGHT = { rocket: ['#ffae3a', 70], homing: ['#9fd8ff', 70], mini: ['#ffae3a', 45], nukem: ['#ffd070', 120], fire: ['#ff7a1a', 60], flame: ['#ffa22a', 40], bhole: ['#a060ff', 160], molotov: ['#ffa22a', 40], orbital: ['#ff5ae0', 200], dynamite: ['#ffd35a', 26], jet: ['#ffa23a', 50] };

TRAIL_RATE.plasma = .014; ENT_LIGHT.plasma = ['#80e6ff', 95];

class FX {
  constructor() { this.isLocalTeam = () => true; this.onOver = null; this.onTurn = null; this.reset(null); }
  reset(sc) {
    this.P = new Particles(); this.lights = []; this.texts = []; this.banners = []; this.traces = []; this.bolts = [];
    this.shake = 0; this.flash = 0; this.flashCol = '#ffffff'; this.focus = null; this.trailAcc = new Map(); this.frameLights = [];
    this.weather = sc ? new Weather(sc.theme.weather) : null; this.propAcc = 0; this.t = 0; this.lightCv = null;
  }
  banner(txt, col = '#fff', big = false, life = 2.2) { this.banners.push({ txt, col, big, life, max: life }); if (this.banners.length > 4) this.banners.shift(); }
  text(txt, x, y, col, size = 18, id) { const o = { txt, x, y, vy: -38, life: 1.4, max: 1.4, col, size, id }; this.texts.push(o); return o; }
  name(sc, id) { const s = sc.soldiers.find(o => o.id === id); return s ? s.name : ''; }
  /* ---------- события ---------- */
  handle(ev, sc, isHost) {
    const P = this.P;
    switch (ev.t) {
      case 'footstep': Sfx.play('footstep',ev); break;
      case 'impact':
        Sfx.play(ev.material===6?'metalImpact':ev.material===4?'woodImpact':'stoneImpact',ev);
        for(let i=0;i<4;i++)P.spark(ev.x,ev.y,rand(-80,80),rand(-110,-20),.2,ev.material===6?'#ffe9ad':'#b8ad96');break;
      case 'carve': if (!isHost) sc.terrain.carve(ev.x, ev.y, ev.r, ev.s !== 0); break;
      case 'cline': if (!isHost) sc.terrain.carveLine(ev.x1, ev.y1, ev.x2, ev.y2, ev.r); break;
      case 'girder':
        if (!isHost) sc.terrain.addGirder(ev.x, ev.y, ev.a);
        Sfx.play('build', ev); for (let i = 0; i < 8; i++) P.smoke(ev.x + rand(-40, 40), ev.y + rand(-6, 6), rand(-20, 20), rand(-30, -5), rand(5, 9), rand(0.6, 1.2), '#b8b0a0', 2, 0.5);
        break;
      case 'boom': this.explosion(ev.x, ev.y, ev.r, ev.k, sc); if (ev.w > ev.r * 2.7) P.ring(ev.x, ev.y, ev.r, ev.w, 0.55, 'rgba(255,230,190,0.55)', 1.5); break;
      case 'frags':
        // осколки: короткие раскалённые трассы и искры там, где осколок ударился
        for (const [x2, y2] of ev.e || []) {
          const f = 0.35 + Math.random() * 0.4; this.traces.push({ x1: ev.x + (x2 - ev.x) * f * 0.5, y1: ev.y + (y2 - ev.y) * f * 0.5, x2: ev.x + (x2 - ev.x) * f, y2: ev.y + (y2 - ev.y) * f, k: 3, life: 0.12, max: 0.12 });
          if (Math.random() < 0.5) P.spark(x2, y2, rand(-60, 60), rand(-90, -10), 0.25, '#ffd08a');
        }
        break;
      case 'nuke': this.nukeFx(ev.x, ev.y, sc); break;
      case 'dmg': {
        for (let i = 0, n = Math.min(10, 2 + (ev.v >> 3)); i < n; i++) this.P.drop(ev.x + rand(-3, 3), ev.y - rand(8, 30), rand(-90, 90), rand(-160, -30), i % 2 ? '#8a0c0c' : '#b31414', rand(1, 1.8));   // кровь из раны
        const now = this.t; let o = this.texts.find(x => x.id === ev.id && now - x.born < 0.4 && x.dmg);
        if (o) { o.v += ev.v; o.txt = '-' + o.v; o.life = o.max; }
        else { o = this.text('-' + ev.v, ev.x, ev.y - 42, '#ff5a4a', 18, ev.id); o.dmg = true; o.v = ev.v; o.born = now; }
        Sfx.play('hurt', ev);
        if (ev.v >= 20) for (let i = 0; i < 5; i++) P.star(ev.x, ev.y - 26, rand(-90, 90), rand(-160, -60), 0.7);
        break;
      }
      case 'heal': this.text('+' + ev.v, ev.x, ev.y - 42, '#5dff8a', 18); Sfx.play('pickup', ev); for (let i = 0; i < 12; i++) P.glow(ev.x + rand(-10, 10), ev.y - rand(0, 30), 0, rand(-60, -20), 3, rand(0.5, 1), '#5dff8a'); break;
      case 'die': {
        const nm = this.name(sc, ev.id);
        for (let i = 0; i < 10; i++) P.smoke(ev.x + rand(-8, 8), ev.y - rand(5, 25), rand(-20, 20), rand(-40, -10), rand(5, 9), rand(0.8, 1.5), '#9a9a9a', 2, 0.6);
        Sfx.play('die', ev);
        if (nm) this.banner(ev.how === 'drown' ? `${nm} утонул!` : `${nm} выбывает!`, '#ff8a7a', false, 1.8);
        break;
      }
      case 'splash': this.splash(ev.x, sc.waterY, ev.s || 0, sc); break;
      case 'shot': {
        const a = ev.a || 0; const big = ev.w === 'sniper' || ev.w === 'railgun' || ev.w === 'shotgun';
        P.glow(ev.x, ev.y, 0, 0, big ? 18 : 11, 0.07, ev.w === 'railgun' ? '#7ff0ff' : '#ffe07a');
        P.smoke(ev.x + Math.cos(a) * 4, ev.y + Math.sin(a) * 4, Math.cos(a) * 40, Math.sin(a) * 40 - 10, big ? 6 : 3.5, 0.7, '#cfcfcf', 2.2, 0.45);
        if (ev.w !== 'railgun') P.shell(ev.x - Math.cos(a) * 8, ev.y - Math.sin(a) * 8, -Math.cos(a) * 40 + rand(-30, 30), rand(-180, -110));
        this.lights.push({ x: ev.x, y: ev.y, r: big ? 120 : 70, life: 0.07, max: 0.07, col: '#ffcf7a' });
        Sfx.play(['shotgun','sniper','revolver','autocannon'].includes(ev.w) ? ev.w : ev.w === 'railgun' ? 'laser' : 'shot', ev);
        if (big) this.shake = Math.max(this.shake, ev.w === 'railgun' ? 7 : 3);
        break;
      }
      case 'trace': {
        const life = ev.k === 2 ? 0.6 : ev.k === 1 ? 0.4 : 0.09; this.traces.push(Object.assign({ life, max: life }, ev));
        if (ev.k === 2) { const n = Math.min(60, Math.hypot(ev.x2 - ev.x1, ev.y2 - ev.y1) / 30); for (let i = 0; i < n; i++) { const u = Math.random(); P.glow(lerp(ev.x1, ev.x2, u), lerp(ev.y1, ev.y2, u), rand(-40, 40), rand(-40, 40), rand(2, 4), rand(0.4, 0.9), pick(['#7ff0ff', '#ffffff'])); } }
        break;
      }
      case 'bolt': {
        this.bolts.push({ pts: ev.pts, life: 0.5, max: 0.5 }); this.flash = Math.max(this.flash, 0.35); this.flashCol = '#cfe6ff';
        const e = ev.pts[ev.pts.length - 1]; this.lights.push({ x: e[0], y: e[1], r: 260, life: 0.4, max: 0.4, col: '#9fd0ff' });
        for (let i = 0; i < 14; i++) P.spark(e[0], e[1], rand(-260, 260), rand(-320, -40), rand(0.3, 0.6), '#bfe6ff');
        Sfx.play('zap', { x: e[0], y: e[1] }); this.shake = Math.max(this.shake, 8);
        break;
      }
      case 'launch': Sfx.play(ev.w === 'throw' ? 'throw' : 'launch', ev); if (ev.w !== 'throw') for (let i = 0; i < 4; i++) P.smoke(ev.x, ev.y, rand(-30, 30), rand(-30, 10), rand(4, 7), rand(0.5, 0.9), '#d0d0d0', 2, 0.5); break;
      case 'bounce': Sfx.play('bounce', ev); break;
      case 'jump': Sfx.play('jump', ev); break;
      case 'land': if (ev.h) { Sfx.play('land', ev); for (let i = 0; i < 6; i++) P.smoke(ev.x + rand(-8, 8), ev.y - 2, rand(-40, 40), rand(-20, -5), rand(3, 5), rand(0.4, 0.8), '#b8a890', 1.8, 0.5); } break;
      case 'beep': Sfx.play('beep', ev); this.lights.push({ x: ev.x, y: ev.y, r: 40, life: 0.1, max: 0.1, col: '#ff3030' }); break;
      case 'tp':
        for (const [x, y] of [[ev.x1, ev.y1], [ev.x2, ev.y2]]) { for (let i = 0; i < 26; i++) P.glow(x + rand(-10, 10), y - rand(0, 30), rand(-60, 60), rand(-120, 20), rand(2, 4), rand(0.5, 1), pick(['#e0b0ff', '#b06cff', '#ffffff'])); P.ring(x, y - 14, 4, 40, 0.4, '#c080ff', 3); }
        Sfx.play('teleport', { x: ev.x2, y: ev.y2 }); break;
      case 'pickup': this.text(ev.txt, ev.x, ev.y - 20, '#ffd23a', 16); Sfx.play('pickup', ev); break;
      case 'msg': if (ev.to === undefined || this.isLocalTeam(ev.to)) { this.banner(ev.txt, ev.c || '#fff', !!ev.big); if (ev.to !== undefined) Sfx.play('denied'); } break;
      case 'turn': if (this.onTurn) this.onTurn(ev, sc); Sfx.play('turn'); break;
      case 'water': sc.waterY = ev.y; break;
      case 'siren': Sfx.play('siren'); this.banner('☢ ЯДЕРНЫЙ УДАР! ☢', '#ffd23a', true, 2.4); break;
      case 'plane': Sfx.play('plane'); break;
      case 'bombs': Sfx.play('bombdrop', ev); break;
      case 'storm': Sfx.play('thunder', ev); for (let i = 0; i < 10; i++) this.P.smoke(ev.x + rand(-60, 60), ev.y + rand(-15, 15), rand(-10, 10), rand(-6, 6), rand(18, 30), rand(1.6, 2.4), '#3a4152', 1.4, 0.55); break;
      case 'bat': Sfx.play('bat', ev); if (ev.h) for (let i = 0; i < 8; i++) P.star(ev.x, ev.y, rand(-150, 150), rand(-200, -40), 0.8); break;
      case 'flame': Sfx.play('flame', ev); break;
      case 'acidSpray': Sfx.play('acidSpray', ev); break;
      case 'gib': {   // оторванная конечность отлетает, брызги крови
        const leg = ev.p >= 4, y0 = ev.y - (leg ? 6 : 24), dir = (ev.p % 2 ? 1 : -1);
        this.P.debris(ev.x, y0, dir * rand(90, 190), rand(-260, -160), leg ? 3.4 : 2.8, '#4e5a36', 3.5);
        for (let i = 0; i < 18; i++) this.P.drop(ev.x + rand(-3, 3), y0 + rand(-3, 3), dir * rand(20, 160) + rand(-40, 40), rand(-220, -40), i % 3 ? '#8a0c0c' : '#c01818', rand(1.2, 2.2));
        this.text(leg ? 'Оторвало ногу!' : 'Оторвало руку!', ev.x, ev.y - 60, '#ff6a5a', 15);
        Sfx.play('hurt', ev);
        break;
      }
      case 'charge': Sfx.play('charge', ev); for (let i = 0; i < 20; i++) { const a = rand(0, TAU), r = rand(30, 60); P.glow(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r, -Math.cos(a) * r * 2.2, -Math.sin(a) * r * 2.2, 2.5, 0.45, '#7ff0ff'); } break;
      case 'dig': Sfx.play('dig', ev); break;
      case 'bh': Sfx.play('blackhole', ev); break;
      case 'laser': Sfx.play('laser', ev); this.shake = Math.max(this.shake, 6); break;
      case 'fuse': Sfx.play('fuse', ev); break;
      case 'jet': Sfx.play('jet', ev); break;
      case 'crate': this.banner('Ящик с припасами!', '#ffd23a', false, 1.6); break;
      case 'over': if (this.onOver) this.onOver(ev, sc); break;
    }
  }
  explosion(x, y, r, k, sc) {
    const P = this.P; const G = sc.theme.ground;
    const deb = [G.cap.cols[1], G.strata[0], G.strata[1] || G.strata[0], G.soil];
    this.hitProps(sc, x, y, r);
    if (k === 4) { // коктейль
      for (let i = 0; i < 14; i++) P.fire(x + rand(-8, 8), y + rand(-8, 4), rand(-80, 80), rand(-120, -20), rand(6, 12), rand(0.3, 0.6));
      Sfx.play('small', { x, y }); this.lights.push({ x, y, r: 140, life: 0.4, max: 0.4, col: '#ff8a2a' }); return;
    }
    const n = Math.min(60, 10 + r * 0.8);
    this.lights.push({ x, y, r: r * 4.5 + 40, life: 0.35, max: 0.35, col: k === 3 ? '#b36cff' : k === 5 ? '#9fd0ff' : '#ffb347' });
    // клубящийся огненный шар: крупные долгоживущие языки пламени, поднимаются вверх
    for (let i = 0; i < 12 + r / 3; i++) P.fire(x + rand(-r * 0.4, r * 0.4), y + rand(-r * 0.4, r * 0.3), rand(-90, 90), rand(-160, 10), rand(r * 0.55, r * 0.95) + 4, rand(0.35, 0.8));
    if (k !== 5) for (let i = 0; i < 5 + r / 5; i++) P.smoke(x + rand(-r * 0.4, r * 0.4), y + rand(-r * 0.4, r * 0.2), rand(-40, 40), rand(-70, -10), rand(r * 0.25, r * 0.45) + 3, rand(1.1, 2.4), pick(['#3a3a3a', '#555555', '#6a6a6a']), 2.2, 0.75);
    for (let i = 0; i < n; i++) { const a = rand(-Math.PI, 0.3); const sp = rand(120, 420) * (0.6 + r / 70); P.debris(x + rand(-r * 0.3, r * 0.3), y + rand(-r * 0.3, r * 0.3), Math.cos(a) * sp, Math.sin(a) * sp, rand(1.6, 4.2), pick(deb), rand(1.2, 2.6)); }
    for (let i = 0; i < 10 + r / 4; i++) { const a = rand(0, TAU); const sp = rand(200, 520); P.spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 100, rand(0.2, 0.5), k === 3 ? '#e0b0ff' : k === 5 ? '#bfe6ff' : '#ffe9a0'); }
    if (r > 14) P.ring(x, y, r * 0.4, r * 1.9, 0.32, '#ffffff', 3);
    // мощь: раскалённое ядро, вспышка экрана, пыль по земле, тёплая ударная волна, тлеющие угольки
    if (k !== 5 && k !== 3) {
      P.fire(x, y, 0, -25, r * 1.4 + 8, 0.28);
      if (r > 30) { this.flash = Math.max(this.flash || 0, Math.min(0.3, r / 240)); this.flashCol = '#fff1d0'; }
      const dust = [G.soil, G.strata[0], G.strata[1] || G.strata[0]];
      for (let i = 0; i < 8 + r / 6; i++) { const sd = i % 2 ? 1 : -1; P.smoke(x + sd * rand(0, r * 0.6), y + r * 0.25, sd * rand(60, 190), rand(-18, 4), rand(r * 0.3, r * 0.55) + 4, rand(1.2, 2.3), pick(dust), 1.7, 0.55); }
      if (r > 14) P.ring(x, y, r * 0.3, r * 2.7, 0.5, '#ffb060', 2);
      for (let i = 0; i < 8 + r / 5; i++) P.spark(x + rand(-r / 2, r / 2), y, rand(-120, 120), rand(-280, -80), rand(0.9, 1.7), pick(['#ff9a3a', '#ffcf6a', '#ff6a2a']));
    }
    this.shake = Math.max(this.shake, Math.min(22, r * 0.28));
    Sfx.play(r > 35 ? 'explosion' : 'small', { x, y }, r / 45);
    if (r > 25) this.focus = { x, y, t: 0.9 };
    if (y > sc.waterY - 30) this.splash(x, sc.waterY, 1, sc);
  }
  nukeFx(x, y, sc) {
    const P = this.P;
    this.flash = 1; this.flashCol = '#fff8e0'; this.shake = 30;
    this.lights.push({ x, y, r: 900, life: 2.5, max: 2.5, col: '#ffcf7a' });
    for (let i = 0; i < 70; i++) { const h = rand(0, 360); P.smoke(x + rand(-25, 25), y - h, rand(-8, 8), rand(-90, -40), rand(18, 34), rand(3, 5.5), pick(['#5a4a44', '#7a6a60', '#3a302c']), 1.8, 0.8); }
    for (let i = 0; i < 60; i++) { const a = rand(0, TAU); const R = rand(40, 150); P.smoke(x + Math.cos(a) * R, y - 380 + Math.sin(a) * R * 0.45, Math.cos(a) * 30, Math.sin(a) * 12 - 30, rand(26, 46), rand(4, 6.5), pick(['#6a5a50', '#8a7a6a', '#4a3a34']), 1.6, 0.85); }
    for (let i = 0; i < 50; i++) P.fire(x + rand(-50, 50), y - rand(0, 300), rand(-40, 40), rand(-160, -40), rand(20, 40), rand(0.6, 1.4));
    P.ring(x, y, 40, 900, 1.2, '#ffffff', 10);
    Sfx.play('rumble', { x, y }); Sfx.play('explosion', { x, y }, 3);
  }
  splash(x, wy, size, sc) {
    const P = this.P; const L = sc.theme.liquid; const lava = L.kind === 'lava';
    const n = 14 + size * 14;
    for (let i = 0; i < n; i++) P.drop(x + rand(-8, 8), wy - 2, rand(-150, 150) * (1 + size * 0.3), rand(-420, -160) * (0.7 + size * 0.25), lava ? '#ffb347' : L.top, rand(1.4, 2.8));
    for (let i = 0; i < 5; i++) P.smoke(x + rand(-12, 12), wy - 4, rand(-20, 20), rand(-40, -10), rand(6, 10), rand(0.6, 1.1), lava ? '#5a4a44' : '#eaf6ff', 1.8, 0.4);
    P.ring(x, wy, 4, 36 + size * 16, 0.5, lava ? '#ffd070' : L.foam, 2);
    if (lava) this.lights.push({ x, y: wy, r: 120, life: 0.5, max: 0.5, col: '#ff8a2a' });
    Sfx.play(lava ? 'lavasplash' : 'splash', { x, y: wy });
  }
  hitProps(sc, x, y, r) {
    for (const p of sc.props || []) {
      if (!p.alive || !p.hitR) continue;
      const cy = p.y + (p.kind === 'windmill' ? -101 : p.kind === 'flag' ? -(p.o.h || 60) / 2 : p.kind === 'lamp' ? -70 : p.kind === 'neon' ? -42 : p.kind === 'torch' ? -16 : 0);
      if (Math.hypot(p.x - x, cy - y) < r + p.hitR) {
        p.alive = false;
        for (let i = 0; i < 16; i++) this.P.debris(p.x + rand(-10, 10), cy + rand(-10, 10), rand(-200, 200), rand(-300, -60), rand(2, 4), pick(['#6b4a2e', '#8a8f99', '#e8dcc0']), rand(1, 2));
      }
    }
  }
  /* ---------- кадр ---------- */
  update(dt, sc, cam, sw, sh) {
    this.t += dt; const P = this.P;
    P.update(dt, sc);
    for (const e of sc.entities) {
      const rate = TRAIL_RATE[e.k]; if (!rate) continue;
      if (e.k === 'drill' && e.s === 1) { if (Math.random() < dt * 30) P.debris(e.x, e.y, rand(-80, 80), rand(-120, -20), rand(1.5, 3), pick(sc.theme.ground.strata), 0.8); continue; }
      let acc = (this.trailAcc.get(e.id) || 0) + dt;
      while (acc >= rate) { acc -= rate; this.trail(e, sc); }
      this.trailAcc.set(e.id, acc);
    }
    if (this.trailAcc.size > 300) { const ids = new Set(sc.entities.map(e => e.id)); for (const k of this.trailAcc.keys()) if (!ids.has(k)) this.trailAcc.delete(k); }
    for (const s of sc.soldiers) if (s.thrust && !s.gone && Math.random() < dt * 40) { const bx = s.x - (s.face || 1) * 7.5; P.fire(bx, s.y - 10, rand(-20, 20), rand(60, 140), rand(3, 5), 0.25); P.smoke(bx, s.y - 6, rand(-10, 10), rand(40, 80), 3, 0.6, '#aaaaaa', 2.4, 0.35); }
    this.propAcc += dt;
    if (this.propAcc > 0.22) {
      this.propAcc = 0;
      for (const p of sc.props || []) {
        if (!p.alive) continue;
        if (p.kind === 'smoke') P.smoke(p.x + rand(-3, 3), p.y, rand(-4, 4) + (sc.turn ? sc.turn.wind * 0.05 : 0), rand(-26, -14), p.o.big ? rand(14, 22) : rand(4, 7), p.o.big ? rand(4, 6) : rand(2.5, 4), p.o.big ? '#4a3a36' : '#c8c8c8', 2.6, p.o.big ? 0.7 : 0.45);
        else if ((p.kind === 'torch' || p.kind === 'fire') && Math.random() < 0.5) P.spark(p.x + rand(-3, 3), p.y - (p.kind === 'torch' ? 30 : 26), rand(-20, 20), rand(-90, -40), rand(0.4, 0.9), '#ffb347', -40);
      }
    }
    if (sc.theme.liquid.kind === 'lava' && Math.random() < dt * 5) { const v = cam.view(sw, sh); const x = rand(v.x0, v.x1); if (!sc.terrain.isSolid(x, sc.waterY - 2)) { P.fire(x, sc.waterY, 0, rand(-60, -20), rand(4, 8), 0.5); if (Math.random() < 0.3) P.spark(x, sc.waterY, rand(-50, 50), rand(-200, -100), 0.8, '#ffcf6a'); } }
    for (const a of [this.lights, this.texts, this.banners, this.traces, this.bolts]) { for (const o of a) o.life -= dt; }
    this.lights = this.lights.filter(o => o.life > 0); this.texts = this.texts.filter(o => o.life > 0); this.banners = this.banners.filter(o => o.life > 0);
    this.traces = this.traces.filter(o => o.life > 0); this.bolts = this.bolts.filter(o => o.life > 0);
    for (const o of this.texts) o.y += o.vy * dt * (o.life / o.max);
    this.shake *= Math.exp(-dt * 7); if (this.shake < 0.1) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 1.4);
    if (this.focus) { this.focus.t -= dt; if (this.focus.t <= 0) this.focus = null; }
    if (this.weather) this.weather.update(dt, cam.view(sw, sh, 20), sc.turn ? sc.turn.wind : 0);
    // источники света кадра
    const L = this.frameLights = [];
    for (const l of this.lights) L.push({ x: l.x, y: l.y, r: l.r * (0.6 + 0.4 * l.life / l.max), a: l.life / l.max, col: l.col });
    for (const e of sc.entities) { const d = ENT_LIGHT[e.k]; if (!d) continue; if (e.k === 'orbital' && e.s === 0) continue; L.push({ x: e.x, y: e.k === 'orbital' ? e.v : e.y, r: d[1], a: 0.85, col: d[0] }); }
    for (const p of sc.props || []) {
      if (!p.alive) continue;
      if (p.kind === 'lamp') L.push({ x: p.x + 15, y: p.y - 60, r: 150, a: 0.9, col: '#ffe0a0' });
      else if (p.kind === 'torch' || p.kind === 'fire') L.push({ x: p.x, y: p.y - 26, r: 110 + Math.sin(this.t * 17 + p.seed) * 8, a: 0.9, col: '#ff9a3a' });
      else if (p.kind === 'neon') L.push({ x: p.x, y: p.y - 42, r: 130, a: 0.7, col: p.o.color || '#ff4fa8' });
      else if (p.kind === 'beacon' && Math.sin(this.t * 3 + p.seed) > 0.3) L.push({ x: p.x, y: p.y, r: 40, a: 0.9, col: '#ff3030' });
    }
    for (const s of sc.soldiers) if (s.thrust && !s.gone) L.push({ x: s.x, y: s.y - 8, r: 60, a: 0.8, col: '#ffa23a' });
  }
  trail(e, sc) {
    const P = this.P;
    switch (e.k) {
      case 'rocket': case 'mini': case 'homing': case 'nukem': case 'drill': {
        const k = e.k === 'nukem' ? 2.2 : e.k === 'mini' ? 0.7 : 1; const bx = e.x - Math.cos(e.a) * 8 * k, by = e.y - Math.sin(e.a) * 8 * k;
        P.smoke(bx, by, rand(-10, 10), rand(-10, 10), rand(3, 5) * k, rand(0.6, 1.1) * (k > 1 ? 1.6 : 1), e.k === 'homing' ? '#c8d8ec' : '#b8b8b8', 2.4, 0.5);
        P.fire(bx, by, -Math.cos(e.a) * 60, -Math.sin(e.a) * 60, rand(3, 5) * k, 0.16); break;
      }
      case 'mortar': case 'frag': case 'bomb': case 'bomblet': P.smoke(e.x, e.y, 0, 0, 2.5, 0.5, '#9a9a9a', 2, 0.35); break;
      case 'acid': for (let i = 0; i < 2; i++) P.glow(e.x + rand(-3, 3), e.y + rand(-2, 2), rand(-25, 25), rand(10, 60), rand(2, 3.5), rand(0.25, 0.5), pick(['#b8ff3a', '#7ad62a', '#e8ffb0'])); break;
      case 'tpg': if (Math.random() < 0.5) P.glow(e.x, e.y, rand(-20, 20), rand(-30, 0), 2, 0.4, pick(['#e0b0ff', '#b06cff'])); break;
      case 'dynamite': P.spark(e.x + 3.5, e.y - 9.5, rand(-60, 60), rand(-100, -20), 0.25, '#ffd35a'); break;
      case 'molotov': P.fire(e.x, e.y - 8, rand(-10, 10), rand(-30, -10), 3, 0.25); break;
      case 'fire': P.fire(e.x + rand(-3, 3), e.y - 2, rand(-10, 10), rand(-60, -25), rand(3, 6) * (e.v || 100) / 100, rand(0.3, 0.6)); if (Math.random() < 0.15) P.smoke(e.x, e.y - 8, rand(-5, 5), rand(-40, -20), 3, 1.2, '#4a4a4a', 3, 0.35); break;
      case 'bhole': { const a = rand(0, TAU), r = rand(60, 190); const px = e.x + Math.cos(a) * r, py = e.y + Math.sin(a) * r; const sp = r * 1.4; P.glow(px, py, -Math.cos(a) * sp - Math.sin(a) * sp * 0.6, -Math.sin(a) * sp + Math.cos(a) * sp * 0.6, rand(2, 4), r / sp, pick(['#c080ff', '#ffffff', '#8a3aff'])); if (Math.random() < 0.3) P.debris(px, py, -Math.cos(a) * sp, -Math.sin(a) * sp, 2, pick(sc.theme.ground.strata), r / sp); break; }
      case 'jet': P.smoke(e.x - Math.cos(e.a) * 34, e.y + 2, 0, 0, 3, 1.4, '#e8e8e8', 2.5, 0.4); break;
      case 'orbital': if (e.s === 1) { P.spark(e.x + rand(-10, 10), e.v, rand(-220, 220), rand(-320, -60), 0.45, '#ffc0f0'); if (Math.random() < 0.4) P.smoke(e.x + rand(-14, 14), e.v, rand(-20, 20), rand(-60, -20), rand(5, 9), 1, '#5a4a5a', 2, 0.5); } break;
    }
  }
  /* ---------- рисование ---------- */
  drawWorld(c, sc, t) {
    this.P.draw(c, false);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const e of sc.entities) drawEntityAdditive(c, e, t, sc);
    drawProps(c, sc, t, true);
    for (const tr of this.traces) {
      const k = tr.life / tr.max;
      if (tr.k === 0) { c.strokeStyle = `rgba(255,230,150,${0.8 * k})`; c.lineWidth = 1.3; c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke(); }
      else if (tr.k === 3) { c.strokeStyle = `rgba(255,190,90,${0.9 * k})`; c.lineWidth = 1.2; c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke(); }
      else if (tr.k === 1) { c.strokeStyle = `rgba(255,255,255,${0.9 * k})`; c.lineWidth = 1.6; c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke(); c.strokeStyle = `rgba(255,180,120,${0.3 * k})`; c.lineWidth = 5; c.stroke(); }
      else { for (const [w, col] of [[16 * k + 4, `rgba(40,200,255,${0.35 * k})`], [7 * k + 2, `rgba(120,240,255,${0.8 * k})`], [2.5 * k + 1, `rgba(255,255,255,${k})`]]) { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(tr.x1, tr.y1); c.lineTo(tr.x2, tr.y2); c.stroke(); } }
    }
    for (const b of this.bolts) {
      const k = b.life / b.max; const fl = 0.5 + 0.5 * Math.sin(t * 60);
      for (const [w, col] of [[10, `rgba(120,170,255,${0.35 * k * fl})`], [4, `rgba(190,220,255,${0.8 * k})`], [1.6, `rgba(255,255,255,${k})`]]) {
        c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.beginPath(); b.pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
      }
    }
    this.P.draw(c, true);
    c.restore();
  }
  drawLights(c, sc, cam, sw, sh, dpr, t) {
    const amb = sc.theme.ambient;
    const z = cam.z, ox = sw / 2 - cam.x * z + cam.sx, oy = sh / 2 - cam.y * z + cam.sy;
    if (amb) {
      const W = Math.max(1, Math.ceil(sw / 2)), H = Math.max(1, Math.ceil(sh / 2));
      if (!this.lightCv || this.lightCv.width !== W || this.lightCv.height !== H) this.lightCv = makeCanvas(W, H);
      const L = this.lightCv.getContext('2d');
      // ночное освещение затемняет только землю и постройки, панорама неба остаётся в исходной яркости
      if (!this.maskCv || this.maskCv.width !== W || this.maskCv.height !== H) this.maskCv = makeCanvas(W, H);
      const v = cam.view(sw, sh, 40), M = this.maskCv.getContext('2d');
      M.setTransform(1, 0, 0, 1, 0, 0); M.globalCompositeOperation = 'source-over'; M.clearRect(0, 0, W, H);
      M.setTransform(z * 0.5, 0, 0, z * 0.5, ox * 0.5, oy * 0.5);
      {
        const x0 = Math.max(0, Math.floor(v.x0)), y0 = Math.max(0, Math.floor(v.y0)), x1 = Math.min(sc.W, Math.ceil(v.x1)), y1 = Math.min(sc.H, Math.ceil(v.y1));
        if (x1 > x0 && y1 > y0) for (const cv of [sc.terrain.decor, sc.terrain.canvas]) if (cv) M.drawImage(cv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      }
      M.setTransform(1, 0, 0, 1, 0, 0); M.globalCompositeOperation = 'source-in'; M.fillStyle = amb; M.fillRect(0, 0, W, H);
      L.setTransform(1, 0, 0, 1, 0, 0); L.globalCompositeOperation = 'source-over'; L.globalAlpha = 1; L.fillStyle = '#fff'; L.fillRect(0, 0, W, H); L.drawImage(this.maskCv, 0, 0);
      L.globalCompositeOperation = 'lighter';
      L.setTransform(z * 0.5, 0, 0, z * 0.5, ox * 0.5, oy * 0.5);
      if (sc.terrain.glow) {
        const x0 = Math.max(0, Math.floor(v.x0)), y0 = Math.max(0, Math.floor(v.y0)), x1 = Math.min(sc.W, Math.ceil(v.x1)), y1 = Math.min(sc.H, Math.ceil(v.y1));
        if (x1 > x0 && y1 > y0) { L.globalAlpha = 0.85; L.drawImage(sc.terrain.glow, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0); L.globalAlpha = 1; }
      }
      const liq = sc.theme.liquid;
      if (liq.kind === 'lava' || liq.kind === 'acid') {
        const g = L.createLinearGradient(0, sc.waterY - 260, 0, sc.waterY + 20); const col = hex2rgb(liq.kind === 'lava' ? '#ff7a2a' : '#8aff5a');
        g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0.75)`);
        L.fillStyle = g; L.fillRect(v.x0, sc.waterY - 260, v.x1 - v.x0, 400);
      }
      // мягкий ореол вокруг бойцов: на тёмных картах их всегда видно
      for (const s of sc.soldiers) { if (!s.alive || s.gone) continue; L.globalAlpha = 0.55; L.drawImage(glowSprite('#fff4e0'), s.x - 70, s.y - 95, 140, 140); }
      for (const l of this.frameLights) { L.globalAlpha = Math.min(1, l.a); L.drawImage(glowSprite(l.col), l.x - l.r, l.y - l.r, l.r * 2, l.r * 2); }
      L.globalAlpha = 1;
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = 'multiply'; c.drawImage(this.lightCv, 0, 0, c.canvas.width, c.canvas.height); c.restore();
    }
    // мягкое свечение ярких источников поверх
    c.save(); c.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy); c.globalCompositeOperation = 'lighter';
    for (const l of this.frameLights) { if (l.r < 60 && !amb) continue; c.globalAlpha = Math.min(1, l.a) * (amb ? 0.28 : 0.4); c.drawImage(glowSprite(l.col), l.x - l.r * 0.6, l.y - l.r * 0.6, l.r * 1.2, l.r * 1.2); }
    c.restore();
  }
  drawScreen(c, sc, cam, sw, sh) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const o of this.texts) {
      const [x, y] = cam.toScreen(o.x, o.y, sw, sh); const k = o.life / o.max;
      c.globalAlpha = Math.min(1, k * 2.5); c.font = `${o.size + (1 - k) * 2}px ${FONT_TITLE}`;
      textOutlined(c, o.txt, x, y, o.col, 'rgba(0,0,0,0.85)', 4);
    }
    let by = sh * 0.3;
    for (const b of this.banners) {
      const k = b.life / b.max; const inn = Math.min(1, (1 - k) * b.max * 5); const a = Math.min(inn, k * b.max * 2.5);
      c.globalAlpha = clamp(a, 0, 1); c.font = `${b.big ? 36 : 24}px ${FONT_TITLE}`;
      const s = 0.9 + 0.1 * easeOutBack(clamp(inn, 0, 1));
      c.save(); c.translate(sw / 2, by); c.scale(s, s); textOutlined(c, b.txt, 0, 0, b.col, 'rgba(0,0,0,0.8)', 6); c.restore();
      by += b.big ? 48 : 36;
    }
    c.globalAlpha = 1; c.restore();
    if (this.flash > 0) { c.save(); c.globalAlpha = Math.min(1, this.flash); c.fillStyle = this.flashCol; c.fillRect(0, 0, sw, sh); c.restore(); }
  }
}
