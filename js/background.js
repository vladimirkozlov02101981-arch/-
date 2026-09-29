'use strict';
/* =========================================================
   Фон: небо, светила, звёзды, сияние, параллакс-слои, облака
   ========================================================= */
class Background {
  constructor(theme, seed) {
    this.th = theme; this.LW = 2048; this.LH = 720; this.seed = seed;
    this.layers = theme.layers.map((L, i) => makeBgLayer(L, this.LW, this.LH, seed + i * 101));
    const r = makeRng(seed * 13 + 7);
    this.stars = [];
    for (let i = 0; i < (theme.stars || 0); i++) this.stars.push({ x: r(), y: Math.pow(r(), 1.4), s: r() < 0.9 ? 1 : 2, p: r() * TAU, f: r.range(0.5, 2.5) });
    this.cloudSprites = []; for (let i = 0; i < 5; i++) this.cloudSprites.push(makeCloudSprite(theme.clouds, seed + i * 17));
    this.clouds = [];
    const cn = theme.clouds ? theme.clouds.n : 0;
    for (let i = 0; i < cn; i++) this.clouds.push({ x: r() * 3000, y: r.range(0.08, 0.6), k: (r() * 5) | 0, s: r.range(0.6, 1.25), v: r.range(4, 12) });
    this.nebula = theme.nebula ? makeNebula(seed) : null;
    this.sunSprite = theme.sun ? makeSunSprite(theme.sun) : null;
    this.auroraSprites = theme.aurora ? [makeRibbon([80, 255, 170]), makeRibbon([110, 200, 255]), makeRibbon([190, 110, 255])] : null;
    this.birds = []; this.birdT = r.range(3, 10);
    this.smoke = []; this.smokeT = 0;
    this.meteor = null; this.meteorT = 6;
  }
  update(dt, wind, sw = 1600) {
    for (const c of this.clouds) c.x += (c.v + wind * 0.04) * dt;
    if (this.th.birds) {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = rand(14, 30); const dir = Math.random() < 0.5 ? 1 : -1; const n = randInt(4, 8); const y = rand(0.15, 0.45); const sp = rand(55, 75);
        for (let i = 0; i < n; i++) this.birds.push({ x: dir > 0 ? -40 - i * 16 : sw + 40 + i * 16, y: y + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.014, dir, ph: Math.random() * TAU, sp });
      }
      for (const b of this.birds) b.x += b.dir * b.sp * dt;
      this.birds = this.birds.filter(b => b.x > -400 && b.x < sw + 400);
    }
    for (const L of this.layers) if (L.craters.length) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) { this.smokeT = 0.18; const c = pick(L.craters); this.smoke.push({ L, x: c[0] + rand(-6, 6), y: c[1], r: rand(8, 14), vy: rand(-22, -14), vx: rand(2, 8), life: 0, max: rand(6, 9) }); }
    }
    for (const s of this.smoke) { s.life += dt; s.y += s.vy * dt; s.x += (s.vx + wind * 0.02) * dt; s.r += dt * 7; }
    this.smoke = this.smoke.filter(s => s.life < s.max);
    if (this.th.stars > 60) {
      this.meteorT -= dt;
      if (this.meteorT <= 0) { this.meteorT = rand(5, 14); this.meteor = { x: rand(0.1, 0.9), y: rand(0.05, 0.3), t: 0 }; }
      if (this.meteor) { this.meteor.t += dt; if (this.meteor.t > 0.9) this.meteor = null; }
    }
  }
  horizonY(cam, sh, waterY) {
    const p = this.layers.length ? this.th.layers[0].p : 0.1;
    return clamp(sh * 0.8 + (waterY - 320 - cam.y) * cam.z * p, sh * 0.45, sh * 1.6);
  }
  draw(c, cam, sw, sh, t, waterY) {
    if (typeof MapArt !== 'undefined' && MapArt.draw(c, MapArt.themeMap[this.th.id] || 'valley', sw, sh, (cam.x - 2400) * .02)) {
      // живое небо поверх картины: медленные облака и птицы, воздушная дымка у горизонта
      if (this.clouds.length) { const a = this.th.clouds.alpha; this.th.clouds.alpha = a * 0.32; this.drawClouds(c, cam, sw, sh * 0.62); this.th.clouds.alpha = a; }
      this.drawBirds(c, t, sh * 0.62);
      const hz = hex2rgb(this.th.sky[2]); const haze = c.createLinearGradient(0, sh * .3, 0, sh);
      haze.addColorStop(0, `rgba(${hz[0]},${hz[1]},${hz[2]},0)`); haze.addColorStop(0.7, `rgba(${hz[0]},${hz[1]},${hz[2]},0.16)`); haze.addColorStop(1, `rgba(${hz[0]},${hz[1]},${hz[2]},0.3)`);
      c.fillStyle = haze; c.fillRect(0, 0, sw, sh);
      return;
    }
    const th = this.th;
    const hy = this.horizonY(cam, sh, waterY);
    const g = c.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, th.sky[0]); g.addColorStop(0.55, th.sky[1]); g.addColorStop(1, th.sky[2]);
    c.fillStyle = g; c.fillRect(0, 0, sw, Math.max(0, hy));
    c.fillStyle = th.sky[2]; if (hy < sh) c.fillRect(0, hy, sw, sh - hy);
    if (this.nebula) {
      c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.75;
      const nw = Math.max(sw, 1200), nx = -((cam.x * cam.z * 0.02) % nw);
      c.drawImage(this.nebula, nx, 0, nw, hy * 0.9); c.drawImage(this.nebula, nx + nw, 0, nw, hy * 0.9); c.restore();
    }
    if (this.stars.length) {
      const px = cam.x * cam.z * 0.015;
      for (const s of this.stars) {
        const x = ((s.x * sw * 1.3 - px) % (sw * 1.3) + sw * 1.3) % (sw * 1.3); if (x > sw) continue;
        const y = s.y * hy * 0.92; const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * s.f + s.p));
        c.globalAlpha = tw * (1 - s.y * 0.55); c.fillStyle = s.s > 1 ? '#fff6e0' : '#ffffff'; c.fillRect(x, y, s.s, s.s);
      }
      c.globalAlpha = 1;
      if (this.meteor) {
        const m = this.meteor; const k = m.t / 0.9; const x = m.x * sw + k * 260, y = m.y * hy + k * 120;
        const gr = c.createLinearGradient(x - 90, y - 42, x, y); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, `rgba(255,255,255,${0.9 * (1 - k)})`);
        c.strokeStyle = gr; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 90, y - 42); c.lineTo(x, y); c.stroke();
      }
    }
    if (this.auroraSprites) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const spr = this.auroraSprites[k]; const baseY = hy * (0.14 + k * 0.09);
        for (let x = -10; x < sw + 10; x += 7) {
          const y = baseY + Math.sin(x * 0.0032 + t * 0.22 + k * 2.1) * 42 + Math.sin(x * 0.011 - t * 0.37 + k) * 14;
          const len = 110 + Math.sin(x * 0.017 + t * 0.6 + k * 3) * 50;
          c.globalAlpha = clamp(0.1 + 0.09 * Math.sin(x * 0.027 + t * 1.1 + k * 1.7), 0.02, 0.2);
          c.drawImage(spr, x, y, 8, len);
        }
      }
      c.restore();
    }
    if (th.sun && this.sunSprite) {
      const S = th.sun; const sx = sw * S.x - cam.x * cam.z * 0.01;
      let sy = S.kind === 'sunset' ? hy - S.r * 0.35 : hy * S.y;
      const spr = this.sunSprite; c.drawImage(spr, sx - spr.width / 2, sy - spr.height / 2);
      if (S.kind === 'sun') {
        c.save(); c.globalCompositeOperation = 'lighter'; c.translate(sx, sy); c.rotate(t * 0.03);
        const rg = c.createRadialGradient(0, 0, S.r, 0, 0, S.r * 5); rg.addColorStop(0, rgba(S.glow, 0.09)); rg.addColorStop(1, rgba(S.glow, 0));
        c.fillStyle = rg;
        for (let i = 0; i < 10; i++) { c.rotate(TAU / 10); c.beginPath(); c.moveTo(0, 0); c.lineTo(S.r * 5, -S.r * 0.28); c.lineTo(S.r * 5, S.r * 0.28); c.closePath(); c.fill(); }
        c.restore();
      }
      if (S.kind === 'sunset') {
        c.fillStyle = 'rgba(120,40,80,0.55)';
        for (let i = 0; i < 3; i++) { const yy = sy - S.r * 0.5 + i * S.r * 0.28; rrect(c, sx - S.r * 1.6 + i * 30, yy, S.r * 2.4 - i * 40, 5 - i, 3); c.fill(); }
      }
      if (th.moons) {
        for (const [mx, my, mr, col] of [[0.18, 0.2, 14, '#e8d8ff'], [0.35, 0.12, 8, '#ffd9c0']]) {
          const x = sw * mx - cam.x * cam.z * 0.008, y = hy * my;
          const gg = c.createRadialGradient(x - mr * 0.3, y - mr * 0.3, 1, x, y, mr); gg.addColorStop(0, '#fff'); gg.addColorStop(0.6, col); gg.addColorStop(1, '#5a4a7a');
          c.fillStyle = gg; circ(c, x, y, mr);
        }
      }
    }
    if (th.seaHorizon) this.drawSea(c, sw, sh, hy, t, cam);
    this.layers.forEach((L, i) => {
      this.drawLayer(c, L, cam, sw, sh, waterY, t);
      if (i === 0) this.drawClouds(c, cam, sw, hy);
    });
    if (!this.layers.length) this.drawClouds(c, cam, sw, hy);
    this.drawBirds(c, t, hy);
  }
  drawBirds(c, t, hy) {
    if (!this.birds.length) return;
    c.strokeStyle = this.th.id === 'tropical' ? 'rgba(60,20,40,0.75)' : 'rgba(30,30,40,0.75)'; c.lineWidth = 1.4;
    for (const b of this.birds) {
      const X = b.x, Y = b.y * hy + Math.sin(t * 2 + b.ph) * 3;
      const w = Math.sin(t * 10 + b.ph) * 3.5;
      c.beginPath(); c.moveTo(X - 6, Y - w); c.quadraticCurveTo(X - 3, Y - 2, X, Y); c.quadraticCurveTo(X + 3, Y - 2, X + 6, Y - w); c.stroke();
    }
  }
  drawSea(c, sw, sh, hy, t, cam) {
    const L = this.th.liquid; const g = c.createLinearGradient(0, hy, 0, sh);
    g.addColorStop(0, css(mixc(L.top, this.th.sky[2], 0.55))); g.addColorStop(1, L.mid);
    c.fillStyle = g; c.fillRect(0, hy, sw, sh - hy);
    const S = this.th.sun; if (!S) return;
    const sx = sw * S.x - cam.x * cam.z * 0.01;
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let y = hy + 2; y < sh; y += 3) {
      const k = (y - hy) / (sh - hy + 1); const w = (18 + k * 140) * (0.5 + 0.5 * Math.sin(y * 0.7 + t * 3));
      c.fillStyle = rgba(L.glint || '#fff', 0.35 * (1 - k * 0.6));
      c.fillRect(sx - w / 2 + Math.sin(y * 0.3 + t) * 6, y, w, 1.5);
    }
    c.restore();
  }
  drawLayer(c, Ly, cam, sw, sh, waterY, t) {
    const L = Ly.L; const p = L.p; const zl = lerp(1, cam.z, p) * clamp(sh / 950, 0.55, 1.3);
    const W = this.LW * zl, H = this.LH * zl;
    const base = clamp(sh * 0.8 + (waterY - 320 - cam.y) * cam.z * p, sh * 0.45, sh * 1.6);
    const top = base - H;
    let ox = -((cam.x * cam.z * p) % W); if (ox > 0) ox -= W;
    for (let x = ox; x < sw; x += W) c.drawImage(Ly.cv, x, top, W, H);
    if (base < sh) { c.fillStyle = L.fog; c.fillRect(0, base - 1, sw, sh - base + 1); }
    if (Ly.craters.length && this.smoke.length) {
      for (let x = ox; x < sw; x += W) {
        for (const s of this.smoke) {
          if (s.L !== Ly) continue; const k = s.life / s.max;
          c.globalAlpha = Math.min(1, s.life * 2) * (1 - k) * 0.7;
          c.drawImage(puffSprite(k < 0.2 ? '#6a3a2a' : '#3a302e'), x + (s.x - s.r) * zl, top + (s.y - s.r) * zl, s.r * 2 * zl, s.r * 2 * zl);
        }
      }
      c.globalAlpha = 1;
    }
  }
  drawClouds(c, cam, sw, hy) {
    if (!this.clouds.length) return;
    const span = sw + 700; const par = cam.x * cam.z * 0.16; const a = this.th.clouds.alpha;
    c.globalAlpha = a;
    for (const cl of this.clouds) {
      const spr = this.cloudSprites[cl.k]; const w = spr.width * cl.s, h = spr.height * cl.s;
      const x = (((cl.x - par) % span) + span) % span - 350; const y = cl.y * hy * 0.9 - h / 2;
      c.drawImage(spr, x, y, w, h);
    }
    c.globalAlpha = 1;
  }
}

function makeBgLayer(L, LW, LH, seed) {
  const cv = makeCanvas(LW, LH); const c = cv.getContext('2d');
  const r = makeRng(seed);
  const craters = [];
  const N = LW / 4; const ridge = new Float32Array(N + 1);
  const P = { peaks: 6, ice: 7, hills: 4, mesa: 5, dunes: 4, volcano: 3, spires: 5, islands: 5, castles: 4, city: 4 }[L.kind] || 4;
  let spires = [];
  if (L.kind === 'spires') { const n = 9; for (let i = 0; i < n; i++) spires.push({ c: (i + r.range(0.1, 0.9)) / n, w: r.range(0.012, 0.026), h: r.range(0.45, 1) }); }
  const cones = L.kind === 'volcano' ? [0.28, 0.74] : [];
  for (let i = 0; i <= N; i++) {
    const u = i / N * P, fx = i / N; let v;
    switch (L.kind) {
      case 'peaks': case 'ice': { const n = fbm1(u, seed, 4, P); v = Math.max(0, 1 - Math.abs(n) * 1.25); v = v * (0.35 + 0.65 * v); if (L.kind === 'ice') v += fbm1(u * 8, seed + 3, 1, P * 8) * 0.015; break; }
      case 'mesa': { const n = clamp((fbm1(u, seed, 3, P) + 1) * 0.5, 0, 0.999); const q = Math.floor(n * 3); const fr = n * 3 - q; v = (q + smoothstep(0.78, 1, fr)) / 3; break; }
      case 'dunes': { const n = (fbm1(u * 2, seed, 2, P * 2) + 1) * 0.5; v = n * n * (3 - 2 * n); break; }
      case 'volcano': {
        v = (fbm1(u, seed, 3, P) + 1) * 0.22;
        for (const cc of cones) { const d = Math.abs(fx - cc); const w = 0.16; if (d < w) { const k = 1 - d / w; v = Math.max(v, k * k * (3 - 2 * k)); } if (d < 0.014) v -= (0.014 - d) * 5; }
        break;
      }
      case 'spires': { v = (fbm1(u, seed, 3, P) + 1) * 0.18; for (const s of spires) { const d = Math.abs(fx - s.c); if (d < s.w) { const k = 1 - d / s.w; v = Math.max(v, s.h * k * k); } } break; }
      case 'islands': { const n = fbm1(u, seed, 3, P); v = Math.max(0, n - 0.12) * 1.8; break; }
      case 'city': v = 0; break;
      default: v = (fbm1(u, seed, 4, P) + 1) * 0.5;
    }
    ridge[i] = LH - (L.base + L.amp * clamp(v, 0, 1.2)) * LH;
  }
  const grad = c.createLinearGradient(0, LH * (1 - L.base - L.amp), 0, LH);
  grad.addColorStop(0, L.color); grad.addColorStop(1, L.fog);
  if (L.kind === 'city') {
    let x = 0;
    while (x < LW) {
      const w = Math.min(LW - x, r.range(40, 120)); const h = (L.base + L.amp * Math.pow(r(), 1.3)) * LH;
      c.fillStyle = grad; c.fillRect(x, LH - h, w + 1, h);
      if (r() < 0.25) { c.fillRect(x + w * 0.4, LH - h - 26, w * 0.2, 26); c.fillRect(x + w * 0.49, LH - h - 50, 2, 26); }
      for (let wy = LH - h + 8; wy < LH - 6; wy += 9) for (let wx = x + 5; wx < x + w - 6; wx += 8) {
        if (r() < 0.22) { c.fillStyle = rgba(L.win, r.range(0.35, 0.9)); c.fillRect(wx, wy, 3, 4); }
      }
      x += w + (r() < 0.3 ? r.range(2, 10) : 0);
    }
    return { L, cv, craters };
  }
  c.beginPath(); c.moveTo(0, LH);
  for (let i = 0; i <= N; i++) c.lineTo(i * 4, ridge[i]);
  c.lineTo(LW, LH); c.closePath(); c.fillStyle = grad; c.fill();
  c.save(); c.clip();
  if (L.snow) {
    const lim = LH - (L.base + L.amp * 0.5) * LH;
    c.beginPath(); c.moveTo(0, ridge[0]);
    for (let i = 0; i <= N; i++) c.lineTo(i * 4, ridge[i]);
    for (let i = N; i >= 0; i--) {
      const above = lim - ridge[i];
      const dpt = above > 0 ? Math.min(95, above * 0.8 + Math.sin(i * 0.9) * 6 + Math.sin(i * 2.3 + 1) * 4) : 0;
      c.lineTo(i * 4, ridge[i] + Math.max(0, dpt));
    }
    c.closePath(); c.fillStyle = L.snow; c.fill();
  }
  // подсветка гребня и дымка у подножия
  c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 2.5; c.lineJoin = 'round';
  c.beginPath(); for (let i = 0; i <= N; i++) { if (i) c.lineTo(i * 4, ridge[i] + 1.5); else c.moveTo(0, ridge[0] + 1.5); } c.stroke();
  const fog = c.createLinearGradient(0, LH * (1 - L.base - L.amp * 0.4), 0, LH);
  fog.addColorStop(0, rgba(L.fog, 0)); fog.addColorStop(1, rgba(L.fog, 0.85));
  c.fillStyle = fog; c.fillRect(0, 0, LW, LH);
  if (L.kind === 'mesa') {
    for (let y = 0; y < LH; y += 12) { c.fillStyle = (y / 12) % 2 ? 'rgba(120,50,20,0.1)' : 'rgba(255,230,190,0.08)'; c.fillRect(0, y, LW, 6); }
  }
  if (L.kind === 'volcano') {
    for (const cc of cones) {
      const x = cc * LW; const i = Math.round(cc * N); const y = ridge[i] + 4; craters.push([x, y]);
      const gg = c.createRadialGradient(x, y, 2, x, y, 60); gg.addColorStop(0, 'rgba(255,200,80,0.95)'); gg.addColorStop(0.4, 'rgba(255,90,20,0.5)'); gg.addColorStop(1, 'rgba(255,60,0,0)');
      c.fillStyle = gg; c.fillRect(x - 60, y - 60, 120, 120);
      c.lineCap = 'round';
      for (let k = 0; k < 5; k++) {
        let lx = x + r.range(-10, 10), ly = y; c.strokeStyle = `rgba(255,${r.int(90, 170)},30,0.85)`; c.lineWidth = r.range(1.5, 3); c.beginPath(); c.moveTo(lx, ly);
        const dir = r() < 0.5 ? -1 : 1;
        for (let s = 0; s < 14; s++) { lx += dir * r.range(2, 9); ly += r.range(6, 14); c.lineTo(lx, ly); }
        c.stroke();
      }
    }
  }
  if (L.kind === 'spires') {
    for (const s of spires) {
      const x = s.c * LW, i = Math.round(s.c * N), y = ridge[i];
      const gg = c.createRadialGradient(x, y, 1, x, y, 16); gg.addColorStop(0, L.glow); gg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gg; c.fillRect(x - 16, y - 16, 32, 32); c.fillStyle = '#fff'; circ(c, x, y, 1.6);
    }
  }
  c.restore();
  if (L.trees) {
    c.fillStyle = L.trees; c.strokeStyle = L.trees;
    for (let i = 2; i < N - 2; i += r.int(2, 4)) {
      const x = i * 4, y = ridge[i] + 2; const h = r.range(10, 22);
      if (L.treeKind === 'pine') { c.beginPath(); c.moveTo(x - h * 0.28, y); c.lineTo(x, y - h); c.lineTo(x + h * 0.28, y); c.closePath(); c.fill(); if (L.snowy) { c.fillStyle = 'rgba(240,246,255,0.7)'; c.beginPath(); c.moveTo(x - h * 0.12, y - h * 0.55); c.lineTo(x, y - h); c.lineTo(x + h * 0.12, y - h * 0.55); c.closePath(); c.fill(); c.fillStyle = L.trees; } }
      else if (L.treeKind === 'round') { circ(c, x, y - h * 0.55, h * 0.38); circ(c, x + h * 0.2, y - h * 0.4, h * 0.3); c.fillRect(x - 1, y - h * 0.3, 2, h * 0.3); }
      else if (L.treeKind === 'palm') { if (r() < 0.5) continue; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 3, y - h, x + 5, y - h * 1.6); c.stroke(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.6; c.beginPath(); c.moveTo(x + 5, y - h * 1.6); c.quadraticCurveTo(x + 5 + Math.cos(a) * 8, y - h * 1.6 + Math.sin(a) * 8, x + 5 + Math.cos(a) * 12, y - h * 1.6 + 6); c.stroke(); } }
      else if (L.treeKind === 'dead') { c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.moveTo(x, y - h * 0.6); c.lineTo(x - h * 0.3, y - h * 0.9); c.moveTo(x, y - h * 0.5); c.lineTo(x + h * 0.35, y - h * 0.75); c.stroke(); }
      else if (L.treeKind === 'shroom') { c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 2, y - h); c.stroke(); c.beginPath(); c.ellipse(x + 2, y - h, h * 0.45, h * 0.22, 0, Math.PI, 0); c.fill(); }
    }
  }
  // лёгкое размытие дальних слоёв: убирает ступеньки и даёт ощущение глубины
  const blur = (1 - Math.min(1, L.p * 2.2)) * 1.4 + 0.5;
  const copy = makeCanvas(LW, LH); const cc = copy.getContext('2d'); cc.drawImage(cv, 0, 0);
  c.clearRect(0, 0, LW, LH); c.filter = `blur(${blur.toFixed(2)}px)`; c.drawImage(copy, 0, 0); c.filter = 'none';
  if (L.kind === 'castles') {
    c.fillStyle = css(shadec(L.color, 0.8));
    for (const cx0 of [0.22, 0.61, 0.86]) {
      const x = cx0 * LW, i = Math.round(cx0 * N), y = ridge[i] + 6;
      const tower = (tx, w, h) => { c.fillRect(tx, y - h, w, h); for (let k = 0; k < w; k += 6) c.fillRect(tx + k, y - h - 5, 3.5, 5); };
      tower(x - 30, 16, 54); tower(x - 12, 40, 36); tower(x + 26, 14, 64); c.beginPath(); c.moveTo(x + 24, y - 64); c.lineTo(x + 33, y - 84); c.lineTo(x + 42, y - 64); c.fill();
      c.fillRect(x + 32, y - 98, 1.5, 16); c.beginPath(); c.moveTo(x + 33.5, y - 98); c.lineTo(x + 44, y - 94); c.lineTo(x + 33.5, y - 90); c.fill();
    }
  }
  return { L, cv, craters };
}

const _shadeSprites = [];
function getShadeSprite(light) {
  if (_shadeSprites[light]) return _shadeSprites[light];
  const cv = makeCanvas(4, 128); const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128);
  const col = light ? '255,255,255' : '10,10,30';
  g.addColorStop(0, `rgba(${col},1)`); g.addColorStop(0.35, `rgba(${col},0.55)`); g.addColorStop(1, `rgba(${col},0)`);
  c.fillStyle = g; c.fillRect(0, 0, 4, 128);
  return (_shadeSprites[light] = cv);
}
function makeCloudSprite(conf, seed) {
  const r = makeRng(seed); const w = 280, h = 120;
  const cv = makeCanvas(w, h); const c = cv.getContext('2d');
  if (!conf) return cv;
  const tmp = makeCanvas(w, h); const t = tmp.getContext('2d');
  t.fillStyle = conf.color;
  const n = r.int(8, 13);
  for (let i = 0; i < n; i++) { const x = w * 0.18 + r() * w * 0.64, y = h * 0.62 - Math.sin((x / w) * Math.PI) * h * r.range(0.1, 0.32); circ(t, x, y, r.range(16, 32)); }
  t.fillRect(w * 0.16, h * 0.6, w * 0.68, h * 0.14);
  t.globalCompositeOperation = 'source-atop';
  const g = t.createLinearGradient(0, h * 0.2, 0, h * 0.78); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, conf.shade);
  t.fillStyle = g; t.fillRect(0, 0, w, h);
  if (conf.lit) { const g2 = t.createLinearGradient(0, h * 0.5, 0, h * 0.8); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, rgba(conf.lit, 0.55)); t.fillStyle = g2; t.fillRect(0, 0, w, h); }
  c.filter = 'blur(2px)'; c.drawImage(tmp, 0, 0); c.filter = 'none';
  return cv;
}
function makeNebula(seed) {
  const r = makeRng(seed + 99); const w = 1024, h = 512; const cv = makeCanvas(w, h); const c = cv.getContext('2d');
  c.globalCompositeOperation = 'lighter';
  const cols = ['#5a1a8a', '#1a3a8a', '#8a1a6a', '#1a6a8a', '#3a1a6a'];
  for (let i = 0; i < 22; i++) {
    const x = r() * w, y = r() * h * 0.8, R = r.range(60, 220); const g = c.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rgba(r.pick(cols), 0.28)); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - R, y - R, R * 2, R * 2);
  }
  for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(255,255,255,${r.range(0.1, 0.5)})`; c.fillRect(r() * w, r() * h, 1, 1); }
  return cv;
}
function makeRibbon(col) {
  const cv = makeCanvas(8, 128); const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`); g.addColorStop(0.2, `rgba(${col[0]},${col[1]},${col[2]},0.9)`);
  g.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},0.4)`); g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
  c.fillStyle = g; c.fillRect(0, 0, 8, 128); return cv;
}
function makeSunSprite(S) {
  if (S.kind === 'planet') {
    const R = S.r; const cv = makeCanvas(R * 5, R * 3.2); const c = cv.getContext('2d'); const cx = cv.width / 2, cy = cv.height / 2;
    const ring = (front) => { c.save(); c.translate(cx, cy); c.rotate(-0.35); c.scale(1, 0.26); c.beginPath(); c.arc(0, 0, R * 2.1, front ? 0 : Math.PI, front ? Math.PI : TAU); c.lineWidth = R * 0.35; c.strokeStyle = 'rgba(255,200,150,0.55)'; c.stroke(); c.lineWidth = R * 0.12; c.strokeStyle = 'rgba(255,230,200,0.7)'; c.stroke(); c.restore(); };
    ring(false);
    const g = c.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.1, cx, cy, R); g.addColorStop(0, '#ffd0a0'); g.addColorStop(0.5, '#e0708a'); g.addColorStop(1, '#4a1a4a');
    c.fillStyle = g; circ(c, cx, cy, R);
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.clip();
    for (let i = -4; i <= 4; i++) { c.fillStyle = i % 2 ? 'rgba(255,220,180,0.12)' : 'rgba(90,20,60,0.14)'; c.fillRect(cx - R, cy + i * R * 0.22, R * 2, R * 0.12); }
    const sh = c.createLinearGradient(cx - R, 0, cx + R, 0); sh.addColorStop(0.45, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(10,0,20,0.7)'); c.fillStyle = sh; c.fillRect(cx - R, cy - R, R * 2, R * 2);
    c.restore(); ring(true);
    return cv;
  }
  const R = S.r; const G = S.kind === 'sunset' ? 7 : S.kind === 'moon' ? 4 : 6; const size = R * G * 2;
  const cv = makeCanvas(size, size); const c = cv.getContext('2d'); const cx = size / 2;
  const glow = c.createRadialGradient(cx, cx, R * 0.5, cx, cx, size / 2);
  glow.addColorStop(0, rgba(S.glow, S.kind === 'moon' ? 0.35 : 0.6)); glow.addColorStop(0.3, rgba(S.glow, S.kind === 'moon' ? 0.1 : 0.22)); glow.addColorStop(1, rgba(S.glow, 0));
  c.fillStyle = glow; c.fillRect(0, 0, size, size);
  const core = c.createRadialGradient(cx - R * 0.25, cx - R * 0.25, R * 0.1, cx, cx, R);
  if (S.kind === 'sunset') { core.addColorStop(0, '#fff6d8'); core.addColorStop(0.5, '#ffc46b'); core.addColorStop(1, '#ff7a4a'); }
  else if (S.kind === 'moon') { core.addColorStop(0, '#ffffff'); core.addColorStop(1, '#b8c4e0'); }
  else { core.addColorStop(0, '#ffffff'); core.addColorStop(1, S.core); }
  c.fillStyle = core; circ(c, cx, cx, R);
  if (S.kind === 'moon') {
    const r = makeRng(5); c.fillStyle = 'rgba(120,130,170,0.35)';
    for (let i = 0; i < 7; i++) { const a = r() * TAU, d = r() * R * 0.7; circ(c, cx + Math.cos(a) * d, cx + Math.sin(a) * d, r.range(2, 6)); }
  }
  return cv;
}
