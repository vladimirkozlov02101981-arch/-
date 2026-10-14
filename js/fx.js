'use strict';
/* =========================================================
   Эффекты: обработка игровых событий (у хоста и у гостя),
   частицы, освещение, всплывающий урон, баннеры, тряска
   ========================================================= */
const TRAIL_RATE = { acid: 0.045, rocket: 0.012, mini: 0.02, homing: 0.012, nukem: 0.008, drill: 0.02, mortar: 0.03, frag: 0.05, bomb: 0.035, bomblet: 0.05, dynamite: 0.03, fire: 0.07, bhole: 0.008, jet: 0.02, orbital: 0.02, molotov: 0.04 };
const ENT_LIGHT = { rocket: ['#ffae3a', 70], homing: ['#9fd8ff', 70], mini: ['#ffae3a', 45], nukem: ['#ffd070', 120], fire: ['#ff7a1a', 60], flame: ['#ffa22a', 40], bhole: ['#a060ff', 160], molotov: ['#ffa22a', 40], orbital: ['#ff5ae0', 200], dynamite: ['#ffd35a', 26], jet: ['#ffa23a', 50] };

/** высота плашки начала хода (экранные px) */
const TURN_BANNER_H = 76, TURN_BANNER_PAD = 40;
TRAIL_RATE.plasma = .014; ENT_LIGHT.plasma = ['#80e6ff', 95];

class FX {
  constructor() { this.localTeams = null; this.isLocalTeam = () => true; this.onOver = null; this.onTurn = null; this.reset(null); }
  reset(sc) {
    this.P = new Particles(); this.P.onRest = (p) => this.withCombat(p.settleMask || 0, () => this.litterAdd(p.t === 4 ? 2 : p.t === 7 ? 3 : 4, p.x, p.y, p.rot || 0, p.col, p.s));
    this.litter = []; this.flyers = [];   // всё, что упало на карту, убирается в начале следующего хода; летящие осколки
    this.lights = []; this.texts = []; this.banners = []; this.traces = []; this.bolts = [];
    this.shake = 0; this.flash = 0; this.flashCol = '#ffffff'; this.focus = null; this.trailAcc = new Map(); this.frameLights = [];
    this.weather = sc ? new Weather(sc.theme.weather) : null; this.propAcc = 0; this.t = 0; this.lightCv = null;
    this.hitWatch = null; this.firstHit = null;   // первое попадание выстрела — только в этом бою (часы эффектов начинаются заново)
  }
  /** предмет на карте до конца боя: 0 осколок, 1 пуля в преграде, 2 пятно крови, 3 гильза, 4 обломок */
  litterAdd(k, x, y, rot = 0, col, s = 2) { if (this.litter.length > 9000) this.litter.splice(0, 500); this.litter.push({ k, x, y, rot, col, s, vy: 0, settleMask: this.P.settleMask || 0 }); }
  /** после разрушения земли то, что лежало на ней, падает вниз; застрявшее в стене выпадает вместе с куском */
  litterSettle(sc, dt) {
    const T = sc.terrain, wy = sc.waterY;
    for (let i = this.litter.length - 1; i >= 0; i--) {
      const o = this.litter[i]; if (o.k === 2 && !o.falling && T.isSolid(o.x, o.y + 1)) continue;
      if (o.k !== 2 && (T.isSolid(o.x, o.y + 1) || T.isSolid(o.x, o.y))) { o.vy = 0; continue; }
      if (o.k === 2) { this.litter.splice(i, 1); continue; }   // кровь, у которой пропала опора, — исчезает с землёй
      o.vy = Math.min(900, o.vy + 900 * dt); o.y += o.vy * dt;
      if (o.y > wy + 4 || o.y > T.H) this.litter.splice(i, 1);
    }
  }
  banner(txt, col = '#fff', big = false, life = 2.2, detail = null) { this.banners.push(Object.assign({ txt, col, big, life, max: life }, detail)); if (this.banners.length > 4) this.banners.shift(); }
  text(txt, x, y, col, size = 18, id) { const o = { txt, x, y, vy: -38, life: 1.4, max: 1.4, col, size, id }; this.texts.push(o); return o; }
  name(sc, id) { const s = sc.soldiers.find(o => o.id === id); return s ? s.name : ''; }
  /** Цвет потери определяется командой погибшего и личной стороной игрока, а не ходом или автором атаки. */
  deathRelation(sc, id) {
    const s = sc.soldiers.find(o => o.id === id);
    const teams = typeof this.localTeams === 'function' ? this.localTeams() : [];
    const owner = Array.isArray(teams) && teams.length === 1 ? teams[0] : Array.isArray(teams) && teams.length > 1 && sc.turn && teams.includes(sc.turn.team) ? sc.turn.team : null;
    if (!s || !Number.isInteger(owner) || owner < 0 || !Number.isInteger(s.team) || s.team < 0) return 'neutral';
    return s.team === owner ? 'ally' : 'enemy';
  }
  deathNotice(sc, ev) {
    const s = sc.soldiers.find(o => o.id === ev.id); if (!s || !s.name) return '';
    const relation = this.deathRelation(sc, ev.id), who = relation === 'ally' ? 'Ваш боец' : relation === 'enemy' ? 'Боец противника' : 'Боец';
    return `${who} ${s.name} ${ev.how === 'drown' ? 'утонул' : 'погиб'}!`;
  }
  /** Только последствия атаки задерживают ход; погода, факелы и надписи — нет. */
  withCombat(mask, fn) {
    const P = this.P, previous = P.settleMask || 0;
    const lists = [this.flyers, this.lights, this.traces, this.bolts, this.litter], starts = lists.map(a => a.length);
    P.settleMask = mask;
    try { return fn(); }
    finally {
      for (let k = 0; k < lists.length; k++) for (let i = starts[k]; i < lists[k].length; i++) if (mask) lists[k][i].settleMask = mask;
      P.settleMask = previous;
    }
  }
  combatBusy(team = -1) {
    const relevant = o => o.settleMask && (team < 0 || (o.settleMask & (1 << team)));
    const activeP = p => {
      if (p.t === 1 || p.t === 5 || p.t === 2) return true;
      if (p.t === 3 || p.t === 4) return Math.hypot(p.vx, p.vy) > 30;
      if (p.t === 0) return (p.max - p.life) < 0.65 || Math.hypot(p.vx, p.vy) > 50;
      return false;
    };
    return (this.P.a || []).some(p => p.life > 0 && relevant(p) && activeP(p)) || this.flyers.some(relevant) ||
      [this.lights, this.traces, this.bolts].some(a => a.some(o => o.life > 0 && relevant(o))) ||
      this.litter.some(o => relevant(o) && Math.abs(o.vy || 0) > 0);
  }
  /* ---------- события ---------- */
  /** отдача: оружие в руках бойца, у чьего ствола вспышка, коротко уходит назад и вверх (только картинка — пули летят по
      настоящему наведению) */
  kick(sc, x, y, w) {
    if (!sc || !sc.soldiers) return;
    let best = null, bd = 46;
    for (const s of sc.soldiers) { if (!s.alive || s.gone) continue; const d = Math.hypot(s.x - x, s.y - 24 - y); if (d < bd) { bd = d; best = s; } }
    if (best) { best.kick = performance.now() / 1000; best.kickW = w || 'shot'; }
  }
  handle(ev, sc, isHost) {
    const cosmetic = ['footstep', 'turn', 'msg', 'siren', 'crate', 'over', 'water', 'carve', 'tidy', 'cline'];
    const team = Number.isInteger(ev.L) ? ev.L : sc.turn && sc.turn.team;
    const mask = cosmetic.includes(ev.t) ? 0 : (ev.M || (Number.isInteger(team) && team >= 0 ? 1 << team : 0));
    return this.withCombat(mask, () => this.handleEvent(ev, sc, isHost));
  }
  handleEvent(ev, sc, isHost) {
    const P = this.P; this.evL = ev.L;   // чей ход (одновременные ходы): обзор не бросается к чужим взрывам, если игрок так выбрал
    // первое попадание выстрела быстрыми пулями (лучом, снарядом автопушки): если оно за кадром, обзор встанет точно по его
    // центру (Camera.update). Очередь — одно попадание: до следующего выстрела через 1,6 с новых не ждём
    if (ev.t === 'shot') { if (!this.hitWatch && !(this.firstHit && this.t >= this.firstHit.time && this.t - this.firstHit.time < 1.6)) this.hitWatch = { time: this.t, L: ev.L }; }
    else if (this.hitWatch && (ev.t === 'impact' || ev.t === 'dmg' || ev.t === 'boom' || ev.t === 'splash') && Number.isFinite(ev.x)) {
      this.firstHit = { x: ev.x, y: ev.t === 'dmg' ? ev.y - 18 : ev.t === 'splash' ? sc.waterY : ev.y, time: this.t, L: ev.L, n: (this.firstHit ? this.firstHit.n : 0) + 1 };
      this.hitWatch = null;
    }
    if (this.hitWatch && this.t - this.hitWatch.time > 1.5) this.hitWatch = null;
    switch (ev.t) {
      case 'footstep': Sfx.play('footstep',ev); break;
      case 'impact':
        Sfx.play(ev.material===6?'metalImpact':ev.material===4?'woodImpact':'stoneImpact',ev);
        this.litterAdd(1, ev.x, ev.y);   // пуля застряла в преграде
        for(let i=0;i<4;i++)P.spark(ev.x,ev.y,rand(-80,80),rand(-110,-20),.2,ev.material===6?'#ffe9ad':'#b8ad96');break;
      case 'carve': if (!isHost) sc.terrain.carve(ev.x, ev.y, ev.r, ev.s !== 0); break;
      case 'tidy': if (!isHost) sc.terrain.tidy(ev.b); break;
      case 'cline': if (!isHost) sc.terrain.carveLine(ev.x1, ev.y1, ev.x2, ev.y2, ev.r); break;
      case 'girder':
        if (!isHost) sc.terrain.addGirder(ev.x, ev.y, ev.a);
        Sfx.play('build', ev); for (let i = 0; i < 8; i++) P.smoke(ev.x + rand(-40, 40), ev.y + rand(-6, 6), rand(-20, 20), rand(-30, -5), rand(5, 9), rand(0.6, 1.2), '#b8b0a0', 2, 0.5);
        break;
      case 'boom': this.explosion(ev.x, ev.y, ev.r, ev.k, sc); if (ev.w > ev.r * 2.7) P.ring(ev.x, ev.y, ev.r, ev.w, 0.55, 'rgba(255,230,190,0.55)', 1.5); break;
      case 'frags':
        // осколки: короткие раскалённые трассы и искры там, где осколок ударился
        // у каждого осколка — ломаная траектория: рикошеты, пробитие преград; искры и пыль там, где он ударил или застрял
        for (const e of ev.e || []) {
          const path = Array.isArray(e[0]) ? e : [[ev.x, ev.y], e];
          // каждый осколок виден в полёте: раскалённая точка идёт по своей траектории со своей скоростью
          this.flyers.push({ path, seg: 1, u: 0, sp: rand(900, 1500), x: path[0][0], y: path[0][1], px: path[0][0], py: path[0][1] });
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
        const nm = this.deathNotice(sc, ev);
        for (let i = 0; i < 10; i++) P.smoke(ev.x + rand(-8, 8), ev.y - rand(5, 25), rand(-20, 20), rand(-40, -10), rand(5, 9), rand(0.8, 1.5), '#9a9a9a', 2, 0.6);
        Sfx.play('die', ev);
        if (nm) {
          const relation = this.deathRelation(sc, ev.id), col = relation === 'enemy' ? '#81ffc1' : relation === 'ally' ? '#ff9da8' : '#f5d77b';
          this.banner(nm, col, false, 3.6, { kind: 'death', relation });
        }
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
        this.kick(sc, ev.x, ev.y, ev.w);
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
        // главный удар молнии камера показывает: место удара и разряд над ним остаются в кадре, пока не осядут бойцы
        if (ev.m) this.focus = { x: e[0], y: e[1] - 110, t: 1.8, L: this.evL };
        for (let i = 0; i < 14; i++) P.spark(e[0], e[1], rand(-260, 260), rand(-320, -40), rand(0.3, 0.6), '#bfe6ff');
        Sfx.play('zap', { x: e[0], y: e[1] }); this.shake = Math.max(this.shake, 8);
        break;
      }
      case 'launch': if (ev.w !== 'throw') this.kick(sc, ev.x, ev.y, 'rocket'); Sfx.play(ev.w === 'throw' ? 'throw' : 'launch', ev); if (ev.w !== 'throw') for (let i = 0; i < 4; i++) P.smoke(ev.x, ev.y, rand(-30, 30), rand(-30, 10), rand(4, 7), rand(0.5, 0.9), '#d0d0d0', 2, 0.5); break;
      case 'bounce': Sfx.play('bounce', ev); break;
      case 'jump': Sfx.play('jump', ev); break;
      case 'land': if (ev.h) { Sfx.play('land', ev); for (let i = 0; i < 6; i++) P.smoke(ev.x + rand(-8, 8), ev.y - 2, rand(-40, 40), rand(-20, -5), rand(3, 5), rand(0.4, 0.8), '#b8a890', 1.8, 0.5); } break;
      case 'beep': Sfx.play('beep', ev); this.lights.push({ x: ev.x, y: ev.y, r: 40, life: 0.1, max: 0.1, col: '#ff3030' }); break;
      case 'tp':
        for (const [x, y] of [[ev.x1, ev.y1], [ev.x2, ev.y2]]) { for (let i = 0; i < 26; i++) P.glow(x + rand(-10, 10), y - rand(0, 30), rand(-60, 60), rand(-120, 20), rand(2, 4), rand(0.5, 1), pick(['#e0b0ff', '#b06cff', '#ffffff'])); P.ring(x, y - 14, 4, 40, 0.4, '#c080ff', 3); }
        Sfx.play('teleport', { x: ev.x2, y: ev.y2 }); break;
      case 'pickup': this.text(ev.txt, ev.x, ev.y - 20, '#ffd23a', 16); Sfx.play('pickup', ev); break;
      case 'msg': if (ev.to === undefined || this.isLocalTeam(ev.to)) { this.banner(ev.txt, ev.c || '#fff', !!ev.big); if (ev.to !== undefined) Sfx.play('denied'); } break;
      case 'turn': {
        const ended = sc.simul && Number.isInteger(ev.team) ? 1 << ev.team : -1;
        const retain = o => { o.settleMask = (o.settleMask || 0) & ~ended; return !!o.settleMask; };
        if (sc.simul) { this.litter = this.litter.filter(retain); this.flyers = this.flyers.filter(retain); }
        else { this.litter.length = 0; this.flyers.length = 0; }
        for (const list of [this.P.a || [], this.lights, this.traces, this.bolts]) for (const o of list) retain(o);
        if (this.onTurn) this.onTurn(ev, sc); Sfx.play('turn'); break;
      }   // обломки и осколки исчезают после хода
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
    if (r > 25) this.focus = { x, y, t: 0.9, L: this.evL };
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
    // полёт осколков: по ломаной (рикошеты, пробития), на изломах — искры; в конце осколок остаётся на карте
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i]; P.settleMask = f.settleMask || 0; f.px = f.x; f.py = f.y; let step = f.sp * dt; f.sp = Math.max(180, f.sp * Math.exp(-0.9 * dt));
      while (step > 0 && f.seg < f.path.length) {
        const [x1, y1] = f.path[f.seg - 1], [x2, y2] = f.path[f.seg], L = Math.hypot(x2 - x1, y2 - y1) || 1, left = L * (1 - f.u);
        if (step < left) { f.u += step / L; step = 0; f.x = x1 + (x2 - x1) * f.u; f.y = y1 + (y2 - y1) * f.u; }
        else { step -= left; f.seg++; f.u = 0; f.x = x2; f.y = y2; if (f.seg < f.path.length) P.spark(x2, y2, rand(-80, 80), rand(-110, -10), 0.3, '#ffe0a0'); }
      }
      if (f.seg >= f.path.length) {
        P.spark(f.x, f.y, rand(-50, 50), rand(-80, -10), 0.22, '#ffd08a');
        this.litterAdd(0, f.x, f.y, rand(0, TAU), null, rand(1.2, 2.4));
        this.flyers[i] = this.flyers[this.flyers.length - 1]; this.flyers.pop();
      }
    }
    P.settleMask = 0;
    this.litterSettle(sc, dt);
    for (const e of sc.entities) {
      const rate = TRAIL_RATE[e.k]; if (!rate) continue;
      P.settleMask = (e.settleTeams || 0) | (e.team >= 0 ? 1 << e.team : 0);
      if (e.k === 'drill' && e.s === 1) { if (Math.random() < dt * 30) P.debris(e.x, e.y, rand(-80, 80), rand(-120, -20), rand(1.5, 3), pick(sc.theme.ground.strata), 0.8); continue; }
      let acc = (this.trailAcc.get(e.id) || 0) + dt;
      while (acc >= rate) { acc -= rate; this.trail(e, sc); }
      this.trailAcc.set(e.id, acc);
    }
    P.settleMask = 0;
    if (this.trailAcc.size > 300) { const ids = new Set(sc.entities.map(e => e.id)); for (const k of this.trailAcc.keys()) if (!ids.has(k)) this.trailAcc.delete(k); }
    for (const s of sc.soldiers) if (s.thrust && !s.gone && Math.random() < dt * 40) { P.settleMask = (s.settleTeams || 0) | (1 << s.team); const bx = s.x - (s.face || 1) * 7.5; P.fire(bx, s.y - 10, rand(-20, 20), rand(60, 140), rand(3, 5), 0.25); P.smoke(bx, s.y - 6, rand(-10, 10), rand(40, 80), 3, 0.6, '#aaaaaa', 2.4, 0.35); }
    P.settleMask = 0;
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
      case 'acid': {
        if (!e.f) break;
        // кислота разъедает землю: едкий пар и шипящие брызги там, где струя входит в породу; в воздухе с неё срываются капли
        const ca = Math.cos(e.a || 0), sa = Math.sin(e.a || 0);
        if (sc.terrain.isSolid(e.x + ca * 6, e.y + sa * 6)) {
          P.smoke(e.x, e.y, rand(-14, 14), rand(-45, -15), rand(2.5, 4.2), rand(0.7, 1.2), pick(['#c3dc7a', '#9cbf55', '#e0eeb0']), 2.8, 0.42);
          if (Math.random() < 0.6) P.glow(e.x, e.y, rand(-70, 70), rand(-110, -30), rand(1, 1.7), rand(0.2, 0.4), '#dcff86', 420);
        } else if (Math.random() < 0.28) P.glow(e.x + rand(-2, 2), e.y + rand(0, 2), (e.vx || 0) * 0.05 + rand(-10, 10), rand(20, 70), rand(1, 1.6), rand(0.35, 0.6), pick(['#8fd432', '#b9ec52']), 720);
        break;
      }
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
    // то, что осталось на поле боя: осколки, пули, гильзы, обломки, кровь
    for (const o of this.litter) {
      if (o.k === 2) { c.fillStyle = 'rgba(96,8,8,0.75)'; c.beginPath(); c.ellipse(o.x, o.y, o.s * 1.2, o.s * 0.55, 0, 0, TAU); c.fill(); continue; }
      c.save(); c.translate(o.x, o.y); c.rotate(o.rot);
      if (o.k === 0) { c.fillStyle = '#3a3634'; c.fillRect(-o.s * 0.6, -o.s * 0.35, o.s * 1.2, o.s * 0.7); c.fillStyle = 'rgba(200,190,170,0.6)'; c.fillRect(-o.s * 0.6, -o.s * 0.35, o.s * 0.6, 0.4); }
      else if (o.k === 1) { c.fillStyle = 'rgba(20,16,14,0.85)'; c.beginPath(); c.arc(0, 0, 1.3, 0, TAU); c.fill(); c.fillStyle = '#b08a3a'; c.fillRect(-0.5, -0.5, 1, 1); }
      else if (o.k === 3) { c.fillStyle = '#b8903a'; c.fillRect(-1.3, -0.5, 2.6, 1); c.fillStyle = '#e8c870'; c.fillRect(-1.3, -0.5, 2.6, 0.35); }
      else { c.fillStyle = o.col || '#6a5a48'; c.fillRect(-o.s / 2, -o.s / 2, o.s, o.s * 0.8); }
      c.restore();
    }
    this.P.draw(c, false);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const e of sc.entities) drawEntityAdditive(c, e, t, sc);
    drawProps(c, sc, t, true);
    for (const f of this.flyers) {   // летящие осколки: короткий раскалённый след
      c.strokeStyle = 'rgba(255,200,110,0.95)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(f.px - (f.x - f.px) * 1.5, f.py - (f.y - f.py) * 1.5); c.lineTo(f.x, f.y); c.stroke();
      c.fillStyle = '#fff2c0'; c.fillRect(f.x - 0.8, f.y - 0.8, 1.6, 1.6);
    }
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
        if (x1 > x0 && y1 > y0) for (const cv of [sc.terrain.decor, sc.terrain.canvas, sc.terrain.surface && sc.terrain.surface.canvas]) if (cv) M.drawImage(cv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
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
  /** Плашка потери — экранный слой поверх вспышки, с постоянной тёмной подложкой на любой карте. */
  deathBannerLayout(c, b, sw) {
    const w = Math.min(440, Math.max(1, sw - 32)), compact = sw < 440, font = compact ? 16 : 18, pad = compact ? 14 : 18;
    const textX = pad + 46, available = Math.max(1, w - textX - pad), lines = [];
    c.font = `700 ${font}px ${FONT_UI}`;
    let line = '';
    for (const word of b.txt.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && c.measureText(next).width > available) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    const lineH = font + 5, h = 43 + lines.length * lineH;
    return { w, h, pad, font, textX, available, lineH, lines, title: b.relation === 'enemy' ? 'ПРОТИВНИК УСТРАНЁН' : b.relation === 'ally' ? 'ПОТЕРЯ В КОМАНДЕ' : 'БОЕЦ ПОГИБ' };
  }
  drawDeathBanner(c, b, sw, y, layout) {
    const L = layout || this.deathBannerLayout(c, b, sw), age = b.max - b.life;
    const alpha = clamp(Math.min(age / 0.14, b.life / 0.35), 0, 1), lift = 6 * (1 - easeOut(clamp(age / 0.18, 0, 1)));
    const enemy = b.relation === 'enemy', ally = b.relation === 'ally', accent = enemy ? '#65f2a0' : ally ? '#ff7586' : '#f5d77b';
    c.save(); c.globalAlpha = alpha; c.translate((sw - L.w) / 2, y - lift);
    c.shadowColor = 'rgba(0,0,0,0.65)'; c.shadowBlur = 18; c.shadowOffsetY = 5;
    rrect(c, 0, 0, L.w, L.h, 14); c.fillStyle = '#0e1721'; c.fill(); c.shadowBlur = 0; c.shadowOffsetY = 0;
    const fill = c.createLinearGradient(0, 0, L.w, 0); fill.addColorStop(0, enemy ? '#16342b' : ally ? '#3b1d29' : '#302b1b'); fill.addColorStop(1, '#0e1721');
    rrect(c, 0.5, 0.5, L.w - 1, L.h - 1, 13.5); c.fillStyle = fill; c.fill(); c.strokeStyle = accent; c.lineWidth = 1; c.stroke();
    c.fillStyle = accent; rrect(c, 0, 12, 4, L.h - 24, 2); c.fill();
    const ix = L.pad + 16, iy = L.h / 2;
    c.fillStyle = enemy ? '#1c4b37' : ally ? '#572431' : '#514524'; c.beginPath(); c.arc(ix, iy, 17, 0, TAU); c.fill();
    c.strokeStyle = accent; c.lineWidth = 1.5; c.stroke();
    // Небольшой одинаковый знак гибели; сторону передают цвет и явная подпись.
    c.fillStyle = b.col; rrect(c, ix - 7, iy - 9, 14, 12, 5); c.fill(); rrect(c, ix - 4, iy + 1, 8, 7, 2); c.fill();
    c.fillStyle = '#0e1721'; for (const dx of [-3, 3]) { c.beginPath(); c.arc(ix + dx, iy - 3, 1.7, 0, TAU); c.fill(); }
    c.strokeStyle = '#0e1721'; c.lineWidth = 1; for (const dx of [-2, 1]) { c.beginPath(); c.moveTo(ix + dx, iy + 4); c.lineTo(ix + dx, iy + 8); c.stroke(); }
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `700 11px ${FONT_UI}`; c.fillStyle = accent; c.fillText(L.title, L.textX, 19);
    c.font = `700 ${L.font}px ${FONT_UI}`; c.fillStyle = b.col;
    L.lines.forEach((line, i) => c.fillText(line, L.textX, 43 + i * L.lineH));
    c.restore(); return L.h;
  }
  deathStackLayout(c, entries, sw) {
    const w = Math.min(440, Math.max(1, sw - 32)), font = 16, textX = 36, available = Math.max(1, w - textX - 18), rows = [];
    c.font = `700 ${font}px ${FONT_UI}`;
    let y = 43;
    for (const b of entries) {
      const lines = []; let line = '';
      for (const word of b.txt.split(/\s+/)) {
        const next = line ? line + ' ' + word : word;
        if (line && c.measureText(next).width > available) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      rows.push({ b, lines, y }); y += lines.length * 21 + 5;
    }
    return { w, h: y - 6, font, textX, available, rows };
  }
  screenBannerLayout(c, sc, sw, sh) {
    const entries = this.banners.filter(b => b.kind === 'death');
    const isTurn = (b) => b.kind === 'turn' || (typeof b.txt === 'string' && b.txt.startsWith('Ход:')), hasTurn = this.banners.some(isTurn);
    const ordinary = this.banners.filter(b => b.kind !== 'death').reduce((h, b) => h + (isTurn(b) ? TURN_BANNER_H + 12 : b.big ? 48 : 36), 0);
    const normal = entries.reduce((h, b) => h + this.deathBannerLayout(c, b, sw).h + 10, ordinary);
    const settings = sc.settings || sc.cfg && sc.cfg.settings || {}, bottom = Math.max(90, sc.teams ? sc.teams.length * 30 + 26 : 90);
    const top = Math.max(90, settings.wind !== false ? (sc.simul ? 138 : 106) : sc.simul ? 110 : 90);
    const compact = entries.length > 0 && normal > sh - top - bottom;
    const stack = compact ? this.deathStackLayout(c, entries, sw) : null, h = compact ? ordinary + stack.h : normal;
    // плашка хода — сразу под верхней панелью хода и ветром (где игрок и так смотрит, чей ход); остальное — ниже неё
    return { compact, stack, entries, bottom, top, h, y: hasTurn ? top + 6 : Math.max(top, Math.min(sh * 0.25, sh - bottom - h)) };
  }
  drawDeathStack(c, L, sw, y) {
    const alphaFor = b => clamp(Math.min((b.max - b.life) / 0.14, b.life / 0.35), 0, 1);
    const alpha = Math.max(0, ...L.rows.map(r => alphaFor(r.b)));
    c.save(); c.globalAlpha = alpha; c.translate((sw - L.w) / 2, y);
    c.shadowColor = 'rgba(0,0,0,0.65)'; c.shadowBlur = 18; c.shadowOffsetY = 5;
    rrect(c, 0, 0, L.w, L.h, 14); c.fillStyle = '#0e1721'; c.fill(); c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.strokeStyle = '#466079'; c.lineWidth = 1; c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `700 11px ${FONT_UI}`; c.fillStyle = '#d1dfed'; c.fillText('СОБЫТИЯ БОЯ', 18, 20);
    c.font = `700 ${L.font}px ${FONT_UI}`;
    for (const row of L.rows) {
      c.globalAlpha = alphaFor(row.b); c.fillStyle = row.b.col;
      c.beginPath(); c.arc(21, row.y, 4, 0, TAU); c.fill();
      row.lines.forEach((line, i) => c.fillText(line, L.textX, row.y + i * 21));
    }
    c.restore();
  }
  /** начало хода: широкая плашка под верхней панелью хода. Слева — цветной знак команды с номером бойца, в середине — чей ход
      и команда, справа — раунд и время хода; плашка раскрывается от середины, полоса внизу показывает, сколько она ещё видна.
      Неподвижная часть рисуется один раз в отдельный холст (тень и градиенты не пересчитываются каждый кадр) */
  drawTurnBanner(c, b, sw, y) {
    const W = Math.round(Math.min(600, sw - 24)), H = TURN_BANNER_H, age = b.max - b.life;
    const tin = clamp(age / 0.4, 0, 1), tout = clamp(b.life / 0.5, 0, 1), ein = 1 - Math.pow(1 - tin, 3), eout = tout * tout * (3 - 2 * tout);
    const alpha = Math.min(1, ein * 1.5) * eout; if (alpha <= 0.01) return H;
    const dpr = Math.max(1, Math.min(3, Math.abs(c.getTransform().a) || 1)), img = this.turnBannerImage(b, W, H, dpr), P = TURN_BANNER_PAD;
    const x0 = Math.round((sw - W) / 2), yy = Math.round(y - 12 * (1 - ein) - 10 * (1 - eout)), r = 10, bw = W < 420 ? 74 : 92, slant = 16;
    c.save(); c.globalAlpha = alpha;
    // раскрытие от середины
    const cw = W * (0.3 + 0.7 * ein); c.beginPath(); c.rect(sw / 2 - cw / 2, yy - P, cw, H + 2 * P); c.clip();
    c.drawImage(img, x0 - P, yy - P, W + 2 * P, H + 2 * P);
    // полоса показа: тает слева направо, пока плашка на экране
    const pk = clamp((b.life - 0.5) / Math.max(0.1, b.max - 0.9), 0, 1), px0 = x0 + bw + slant * 0.2, pw = (x0 + W - px0 - r) * pk;
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(px0, yy + H - 3, x0 + W - px0 - r, 2);
    c.fillStyle = b.teamColor || b.col || '#ffd166'; c.fillRect(px0, yy + H - 3, pw, 2);
    c.restore();
    return H;
  }
  /** неподвижная часть плашки хода (с запасом TURN_BANNER_PAD под тень), кэшируется в самой плашке */
  turnBannerImage(b, W, H, dpr) {
    const P = TURN_BANNER_PAD, key = W + 'x' + H + '@' + dpr;
    if (b.img && b.imgKey === key) return b.img;
    const cv = makeCanvas(Math.ceil((W + 2 * P) * dpr), Math.ceil((H + 2 * P) * dpr)), c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, P * dpr, P * dpr);
    const col = b.teamColor || b.col || '#ffd166', rgb = hex2rgb(col), lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const num = String(b.soldier || (typeof b.txt === 'string' && /(\d+)/.test(b.txt) ? b.txt.match(/(\d+)/)[1] : ''));
    const tmName = b.teamName || (typeof b.txt === 'string' && b.txt.match(/«([^»]+)»/) ? b.txt.match(/«([^»]+)»/)[1] : '');
    const isMine = b.isMine !== undefined ? b.isMine : b.relation === 'ally';
    const over = b.hotseat ? 'ХОД КОМАНДЫ' : isMine ? 'ВАШ ХОД' : 'ХОД СОПЕРНИКА';
    const x0 = 0, yy = 0, r = 10, bw = W < 420 ? 74 : 92, slant = 16;
    const spaced = (s) => { if ('letterSpacing' in c) c.letterSpacing = s; };
    c.textBaseline = 'middle';
    // подложка: тёмное стекло, мягкая тень, тонкая рамка
    c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 26; c.shadowOffsetY = 8;
    rrect(c, x0, yy, W, H, r); const bg = c.createLinearGradient(x0, yy, x0 + W, yy + H);
    bg.addColorStop(0, 'rgba(7,12,19,0.96)'); bg.addColorStop(1, 'rgba(15,23,34,0.93)'); c.fillStyle = bg; c.fill(); c.restore();
    c.save(); rrect(c, x0, yy, W, H, r); c.clip();
    // свечение цвета команды из-под знака
    const glow = c.createRadialGradient(x0 + bw * 0.6, yy + H / 2, 4, x0 + bw * 0.6, yy + H / 2, W * 0.55);
    glow.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.20)`); glow.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    c.fillStyle = glow; c.fillRect(x0, yy, W, H);
    // знак команды: скошенный край, градиент цвета команды, «БОЕЦ» и крупный номер
    c.beginPath(); c.moveTo(x0, yy); c.lineTo(x0 + bw + slant, yy); c.lineTo(x0 + bw - slant * 0.25, yy + H); c.lineTo(x0, yy + H); c.closePath();
    const bg2 = c.createLinearGradient(x0, yy, x0 + bw, yy + H); bg2.addColorStop(0, css(shadec(rgb, 1.12))); bg2.addColorStop(1, css(shadec(rgb, 0.72)));
    c.fillStyle = bg2; c.fill();
    const hl = c.createLinearGradient(0, yy, 0, yy + H); hl.addColorStop(0, 'rgba(255,255,255,0.28)'); hl.addColorStop(0.45, 'rgba(255,255,255,0)'); c.fillStyle = hl; c.fill();
    const ink = lum > 150 ? '#08111a' : '#ffffff', inkSoft = lum > 150 ? 'rgba(8,17,26,0.72)' : 'rgba(255,255,255,0.78)';
    const mid = x0 + (bw + slant * 0.4) / 2;
    c.textAlign = 'center'; c.fillStyle = inkSoft; c.font = `700 10px ${FONT_UI}`; spaced('2.5px');
    c.fillText('БОЕЦ', mid + 1, yy + 17); spaced('0px');
    c.fillStyle = ink; c.font = `${num.length > 1 ? 36 : 40}px ${FONT_TITLE}`; c.fillText(num || '—', mid, yy + H / 2 + 9);
    c.restore();
    // рамка и верхний блик
    rrect(c, x0 + 0.5, yy + 0.5, W - 1, H - 1, r - 0.5); c.strokeStyle = 'rgba(255,255,255,0.11)'; c.lineWidth = 1; c.stroke();
    const top = c.createLinearGradient(x0, 0, x0 + W, 0); top.addColorStop(0, 'rgba(255,255,255,0)'); top.addColorStop(0.5, 'rgba(255,255,255,0.22)'); top.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = top; c.fillRect(x0 + r, yy + 0.5, W - 2 * r, 1);
    // текст: чей ход (цвет команды, разрядка), название команды, справа — раунд и время хода
    const tx = x0 + bw + slant + 18, wide = W >= 470;
    c.textAlign = 'left'; c.fillStyle = col; c.font = `700 11px ${FONT_UI}`; spaced('3px');
    c.fillText(over, tx, yy + 22); spaced('0px');
    c.fillStyle = '#ffffff'; c.font = `${W < 420 ? 22 : 26}px ${FONT_TITLE}`;
    let name = tmName || (b.txt || ''); const maxName = (wide ? x0 + W - 150 : x0 + W - 18) - tx;
    while (name.length > 3 && c.measureText(name).width > maxName) name = name.slice(0, -2) + '…';
    c.fillText(name, tx, yy + H / 2 + 9);
    if (wide) {
      const rx = x0 + W - 20; c.textAlign = 'right';
      c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(rx - 118, yy + 16, 1, H - 32);
      c.font = `600 10px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.5)'; spaced('2px');
      c.fillText('РАУНД', rx, yy + 22); spaced('0px');
      c.font = `20px ${FONT_TITLE}`; c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillText(String(b.round || 1), rx, yy + 43);
      c.font = `500 11px ${FONT_UI}`; c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillText(b.time > 0 ? `${b.time} с на ход` : 'время без лимита', rx, yy + 61);
    }
    b.img = cv; b.imgKey = key; return cv;
  }
  drawScreen(c, sc, cam, sw, sh) {
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const o of this.texts) {
      const [x, y] = cam.toScreen(o.x, o.y, sw, sh); const k = o.life / o.max;
      c.globalAlpha = Math.min(1, k * 2.5); c.font = `${o.size + (1 - k) * 2}px ${FONT_TITLE}`;
      textOutlined(c, o.txt, x, y, o.col, 'rgba(0,0,0,0.85)', 4);
    }
    const plan = this.screenBannerLayout(c, sc, sw, sh); let by = plan.y; const deaths = [];
    for (const b of this.banners) {
      if (b.kind === 'death') { if (!plan.compact) { const layout = this.deathBannerLayout(c, b, sw); deaths.push({ b, y: by, layout }); by += layout.h + 10; } continue; }
      if (b.kind === 'turn' || (typeof b.txt === 'string' && b.txt.startsWith('Ход:'))) {
        const th = this.drawTurnBanner(c, b, sw, by);
        by += th + 12;
        continue;
      }
      const k = b.life / b.max; const inn = Math.min(1, (1 - k) * b.max * 5); const a = Math.min(inn, k * b.max * 2.5);
      c.globalAlpha = clamp(a, 0, 1); c.font = `${b.big ? 36 : 24}px ${FONT_TITLE}`;
      const s = 0.9 + 0.1 * easeOutBack(clamp(inn, 0, 1));
      c.save(); c.translate(sw / 2, by); c.scale(s, s); textOutlined(c, b.txt, 0, 0, b.col, 'rgba(0,0,0,0.8)', 6); c.restore();
      by += b.big ? 48 : 36;
    }
    c.globalAlpha = 1; c.restore();
    if (this.flash > 0) { c.save(); c.globalAlpha = Math.min(1, this.flash); c.fillStyle = this.flashCol; c.fillRect(0, 0, sw, sh); c.restore(); }
    for (const o of deaths) this.drawDeathBanner(c, o.b, sw, o.y, o.layout);
    if (plan.compact) this.drawDeathStack(c, plan.stack, sw, by);
  }
}
