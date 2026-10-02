'use strict';
// Additional weapons share the host-authoritative event/snapshot protocol.
KIND_IDX.plasma = KINDS.length; KINDS.push('plasma');
class PlasmaBall extends Ent {
  constructor(g, s, p) {
    const m = muzzle(s, p.aim, 22), speed = 900 * p.pw;
    super(g, 'plasma', m.x, m.y, Math.cos(p.aim) * speed, Math.sin(p.aim) * speed);
    this.owner = s; this.team = s.team; this.f = 3; this.bounces = 0;
  }
  update(g, dt) {
    this.age += dt; this.f -= dt;
    const res = bounceStep(g, this, dt, { r: 5, rest: .88, fric: 1, grav: .28, onImpact: () => { this.bounces++; g.emit({ t: 'bounce', x: this.x, y: this.y }); } });
    if (res === 'water' || res === 'out') { this.dead = true; g.splash(this.x, 1); return; }
    if (this.f <= 0 || this.bounces >= 5 || g.soldierAt(this.x, this.y, 9, this.age < .25 ? this.owner : null)) {
      this.dead = true; g.explode(this.x, this.y, 49, 46, { owner: this.owner, knock: 350, k: 5 });
    }
  }
}
// Кислотомёт: струя проходит сквозь землю и бойцов, прожигая узкий след; к концу опадает
KIND_IDX.acid = KINDS.length; KINDS.push('acid');
const ACID_RANGE = 280;
class AcidShot extends Ent {
  /** одна капля струи; delay — через сколько секунд после нажатия капля вылетает из ствола (вместе капли дают сплошную струю) */
  constructor(g, s, aim, delay = 0, hit = null) {
    const m = muzzle(s, aim, 22), sp = 950 + (Math.random() - 0.5) * 50;
    super(g, 'acid', m.x, m.y, Math.cos(aim) * sp, Math.sin(aim) * sp);
    this.owner = s; this.team = s.team; this.hit = hit || new Set([s.id]); this.pushable = false; this.a = aim; this.sx = m.x; this.sy = m.y;
    this.delay = delay; this.aim = aim; this.f = delay > 0 ? 0 : 1;
  }
  update(g, dt) {
    if (this.delay > 0) {                                    // ещё в стволе: держится у дула
      this.delay -= dt; const m = muzzle(this.owner, this.aim, 22); this.x = this.sx = m.x; this.y = this.sy = m.y;
      if (this.delay > 0) return; this.f = 1;
    }
    this.age += dt;
    const x0 = this.x, y0 = this.y, grav = this.age < 0.45 ? 0.06 : Math.min(1.3, (this.age - 0.45) * 3);
    this.vy += g.gravity * grav * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.a = Math.atan2(this.vy, this.vx);
    if (g.terrain.segmentHit(x0, y0, this.x, this.y) || g.terrain.isSolid(this.x, this.y)) g.carveLine(x0, y0, this.x, this.y, 4);
    const steps = Math.max(1, Math.ceil(Math.hypot(this.x - x0, this.y - y0) / 3));
    for (let i = 1; i <= steps; i++) {
      const o = g.soldierAt(x0 + (this.x - x0) * i / steps, y0 + (this.y - y0) * i / steps, 3, null);
      if (o && !this.hit.has(o.id)) { this.hit.add(o.id); g.damage(o, 25, this.owner); o.vx += this.vx * 0.08; o.vy -= 40; }
    }
    if (this.y > g.waterY) { g.splash(this.x, 0); this.dead = true; return; }
    // дальность ограничена: струя распадается примерно через 280 px
    if (Math.hypot(this.x - this.sx, this.y - this.sy) > ACID_RANGE) { this.dead = true; return; }
    if (this.age > 1.6 || this.x < -300 || this.x > g.W + 300 || this.y > g.H + 100) this.dead = true;
  }
}
// Телепортер: бросается как граната; боец переносится туда, где устройство остановилось
KIND_IDX.tpg = KINDS.length; KINDS.push('tpg');
class TpGrenade extends Ent {
  constructor(g, x, y, vx, vy, s) { super(g, 'tpg', x, y, vx, vy); this.owner = s; this.team = s.team; this.r = 3.5; this.still = 0; this.spin = 0; this.spinLeft = 1; this.dir = vx >= 0 ? 1 : -1; }
  update(g, dt) {
    this.age += dt;
    const res = bounceStep(g, this, dt, { rest: 0.4, fric: 0.75, r: this.r, onImpact: (imp, nrm) => { if (imp > 70) g.emit({ t: 'bounce', x: R1(this.x), y: R1(this.y) }); applySpin(this, imp, nrm); } });
    if (res === 'water' || res === 'out') { if (res === 'water') g.splash(this.x, 0); this.dead = true; g.emit({ t: 'msg', txt: 'Телепортер потерян', c: '#c080ff' }); return; }
    if (!this.rest) this.a += this.vx * dt * 0.06;
    this.still = this.rest || Math.hypot(this.vx, this.vy) < 25 ? this.still + dt : 0;
    if (this.still > 0.35 || this.age > 5) this.warp(g);
  }
  warp(g) {
    this.dead = true; const s = this.owner; if (!s || !s.alive) return;
    // расчищаем место под бойца, чтобы он не застрял в земле
    g.carve(this.x, this.y - 16, 21, false);
    const x1 = s.x, y1 = s.y; s.x = Math.round(this.x); s.y = Math.round(this.y + this.r); s.vx = 0; s.vy = 0; s.rot = 0; s.st = 'air';
    if (!bodyFree(g.terrain, s.x, s.y)) s.unstick(g.terrain);
    g.emit({ t: 'tp', x1: R1(x1), y1: R1(y1), x2: R1(s.x), y2: R1(s.y) });
  }
}
function rifleFlash(g, s, aim, weapon) {
  const m = muzzle(s, aim, 22); g.emit({ t: 'shot', x: R1(m.x), y: R1(m.y), a: aim, w: weapon });
}
Object.assign(FIRE, {
  assault(g, s, p) {
    let t = 0, n = 0;
    return { usage: { update(gg, dt) {
      t += dt;
      while (n < 5 && t >= n * .12) { const aim = s.aim + rand(-.016, .016); rifleFlash(gg,s,aim,'assault'); bullet(gg,s,aim,1200,9,38,4,0); n++; }
      return t > .62 || !s.alive;
    } } };
  },
  revolver(g,s,p) { rifleFlash(g,s,p.aim,'revolver'); bullet(g,s,p.aim,1500,18,65,5,0); },
  // магнум (как в TW3): бесконечный патрон, 35 урона, в голову — 50
  magnum(g,s,p) { rifleFlash(g,s,p.aim,'sniper'); bullet(g,s,p.aim,1700,35,190,6,1,50); },
  // узи: длинная очередь с разбросом, ствол можно вести
  uzi(g, s, p) {
    let t = 0, n = 0;
    return { usage: { update(gg, dt) {
      t += dt;
      while (n < 10 && t >= n * .07) { const aim = s.aim + rand(-.06, .06); rifleFlash(gg,s,aim,'assault'); bullet(gg,s,aim,900,5,22,3,0); n++; }
      return t > .78 || !s.alive;
    } } };
  },
  // РПГ: без гравитации и ветра, но со спиралью и потерей управления (как в TW3)
  rpg(g,s,p) { shootProj(g,s,{aim:p.aim,pw:1},'rocket',1150,{grav:0,wind:0,r:3,spiral:true}); },
  // ботинок: пинок почти горизонтально, в сторону взгляда
  boot(g,s,p) {
    const dir=Math.cos(p.aim)>=0?1:-1, cx=s.x+dir*11, cy=s.y-12; let hit=false;
    for(const o of g.soldiers){
      if(!o.alive||o===s)continue;
      if(Math.abs(o.x-cx)<16&&Math.abs(o.y-12-cy)<18){o.vx+=dir*640;o.vy-=170;o.fly();g.damage(o,15,s);hit=true;}
    }
    g.emit({t:'bat',x:R1(cx),y:R1(cy),h:hit?1:0});
  },
  // кирка: проход в сторону прицела, высотой в рост бойца
  pickaxe(g,s,p) {
    const dx=Math.cos(p.aim), dy=Math.sin(p.aim), x0=s.x+dx*4, y0=s.y-15+dy*4;
    g.carveLine(x0,y0,x0+dx*38,y0+dy*38,19); g.emit({t:'dig',x:R1(x0+dx*20),y:R1(y0+dy*20)});
    const h=hitscan(g,s.x,s.y-15,p.aim,34,s); if(h.type==='soldier'){g.damage(h.s,10,s);h.s.vx+=dx*160;h.s.vy+=dy*160-60;h.s.fly();}
  },
  // сплошная струя из 24 капель за полсекунды: боец держит кислотомёт, пока бьёт струя, и может вести ею, как шлангом; урон один раз на бойца.
  // Капли выходят ровно через 0,02 с (с поправкой внутри шага игры) — струя без разрывов и слипшихся капель
  acid(g,s,p) {
    const hit = new Set([s.id]); let t = 0, n = 0; g.emit({t:'acidSpray',x:R1(s.x),y:R1(s.y)});
    return { usage: { update(gg, dt) {
      t += dt;
      while (n < 24 && t >= n * 0.02) { const e = new AcidShot(gg, s, s.aim + (Math.random() - 0.5) * 0.02, 0, hit), lead = t - n * 0.02; e.x += e.vx * lead; e.y += e.vy * lead; e.age = lead; gg.spawn(e); n++; }
      return (n >= 24 && t > 0.55) || !s.alive;
    } } };
  },
  tpgrenade(g,s,p) {
    const m=muzzle(s,p.aim,10), sp=780*p.pw, e=new TpGrenade(g,m.x,m.y,Math.cos(p.aim)*sp+s.vx*.3,Math.sin(p.aim)*sp,s);
    e.spin=p.spin|0; g.spawn(e); g.emit({t:'launch',x:R1(m.x),y:R1(m.y),w:'throw'});
    return {usage:{update(){return e.dead;}}};
  },
  plasma(g,s,p) { g.spawn(new PlasmaBall(g,s,p)); g.emit({t:'launch',x:s.x,y:s.y-GUN_Y,w:'plasma'}); },
  autocannon(g,s,p) {
    let t=0,n=0;
    return {usage:{update(gg,dt){
      t+=dt; while(n<3 && t>=n*.2){shootProj(gg,s,{aim:p.aim+(n-1)*.018,pw:1},'mini',1250,{grav:.32,wind:0,r:3,sound:'autocannon'});n++;}
      return t>.65 || !s.alive;
    }}};
  },
  tesla(g,s,p) {
    const m=muzzle(s,p.aim,22), hit=hitscan(g,m.x,m.y,p.aim,500,s);
    g.emit({t:'bolt',pts:boltPath(m.x,m.y,hit.x,hit.y,.14)});
    if(hit.type!=='soldier')return;
    g.damage(hit.s,32,s); const seen=new Set([s,hit.s]); let prev=hit.s;
    for(let i=0;i<2;i++){
      const candidates=g.soldiers.filter(o=>o.alive&&!seen.has(o)&&Math.hypot(o.x-prev.x,o.y-prev.y)<190).sort((a,b)=>Math.hypot(a.x-prev.x,a.y-prev.y)-Math.hypot(b.x-prev.x,b.y-prev.y));
      const next=candidates.find(o=>{const a=Math.atan2(o.y-prev.y,o.x-prev.x), h=hitscan(g,prev.x,prev.y-16,a,190,prev);return h.s===o;});
      if(!next)break;g.emit({t:'bolt',pts:boltPath(prev.x,prev.y-16,next.x,next.y-16,.16)});g.damage(next,20-i*6,s);seen.add(next);prev=next;
    }
  },
  repulsor(g,s,p) {
    rifleFlash(g,s,p.aim,'railgun'); const m=muzzle(s,p.aim,20);
    for(let i=-2;i<=2;i++){const a=p.aim+i*.13;const h=hitscan(g,m.x,m.y,a,180,s);g.emit({t:'trace',x1:m.x,y1:m.y,x2:h.x,y2:h.y,k:2});}
    for(const o of g.soldiers){
      if(o===s||!o.alive)continue; const d=Math.hypot(o.x-s.x,o.y-s.y), a=Math.atan2(o.y-s.y,o.x-s.x);
      if(d>180||Math.abs(angNorm(a-p.aim))>.65)continue;
      const h=hitscan(g,m.x,m.y,Math.atan2(o.y-15-m.y,o.x-m.x),190,s);if(h.s!==o)continue;
      o.vx+=Math.cos(p.aim)*780*(1-d/260);o.vy+=Math.sin(p.aim)*520-230;o.fly();g.damage(o,8,s);
    }
  }
});
