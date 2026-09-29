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
  // магнум: один тяжёлый выстрел, сильный толчок
  magnum(g,s,p) { rifleFlash(g,s,p.aim,'sniper'); bullet(g,s,p.aim,1700,42,190,6,1); },
  // узи: длинная очередь с разбросом, ствол можно вести
  uzi(g, s, p) {
    let t = 0, n = 0;
    return { usage: { update(gg, dt) {
      t += dt;
      while (n < 10 && t >= n * .07) { const aim = s.aim + rand(-.06, .06); rifleFlash(gg,s,aim,'assault'); bullet(gg,s,aim,900,5,22,3,0); n++; }
      return t > .78 || !s.alive;
    } } };
  },
  // РПГ: ракета летит строго по прямой — без гравитации и без ветра
  rpg(g,s,p) { shootProj(g,s,{aim:p.aim,pw:1},'rocket',1150,{grav:0,wind:0,r:3}); },
  plasma(g,s,p) { g.spawn(new PlasmaBall(g,s,p)); g.emit({t:'launch',x:s.x,y:s.y-17,w:'plasma'}); },
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
