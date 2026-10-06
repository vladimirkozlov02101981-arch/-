with open('js/terrain_visual.js', 'rb') as f:
    tv = f.read().decode('utf-8')

# 1. Update alien bush -> moss and crystals in drawSurfaceDetails
target_tv = """      const bs = !G.cap.bushPal && ['bush1', 'bush2'].map((n) => TexLib.data[n]).filter(Boolean);
      if (bs && bs.length) { const T = bs[(rng() * bs.length) | 0], D = R * 3.6; if (surface) surface.sprite(T.canvas, T === TexLib.data.bush1 ? 'bush1' : 'bush2'); c.drawImage(T.canvas, x - D / 2, y + 3 - D, D, D); }
      else foliage(c, blobs, G.cap.bushPal || ['#1c3410', '#3c6a1c', '#7aa42c', '#cce060']);
      if (G.cap.flowers && rng() < 0.6) { c.fillStyle = rng.pick(G.cap.flowers); for (let j = 0; j < 6; j++) { c.beginPath(); c.arc(x + (rng() - 0.5) * R * 1.8, y - R * (0.4 + rng() * 0.8), 1.4, 0, TAU); c.fill(); } }"""

replacement_tv = """      if (theme.id === 'alien') {
        const isDruze = rng() < 0.52;
        if (isDruze) {
          const cols = rng() < 0.5 ? ['#bffcff', '#5ff4ff', '#1a8fa8'] : ['#ffd0ff', '#ff6ef6', '#9a2a9a'];
          const numCryst = 3 + ((rng() * 4) | 0);
          for (let ci = 0; ci < numCryst; ci++) {
            const a = -Math.PI / 2 + (ci - (numCryst - 1) / 2) * 0.35 + (rng() - 0.5) * 0.2;
            const clen = (8 + rng() * 16) * (R / 16), cw = 2.5 + rng() * 2.2;
            const ex = x + Math.cos(a) * clen, ey = y + Math.sin(a) * clen;
            const nx = -Math.sin(a) * cw, ny = Math.cos(a) * cw;
            c.fillStyle = cols[1]; c.beginPath(); c.moveTo(x + nx * 0.5, y + 2); c.lineTo(ex + nx, ey + ny); c.lineTo(ex + Math.cos(a) * 4, ey + Math.sin(a) * 4); c.lineTo(ex - nx, ey - ny); c.lineTo(x - nx * 0.5, y + 2); c.closePath(); c.fill();
            c.fillStyle = cols[0]; c.beginPath(); c.moveTo(x + nx * 0.5, y + 2); c.lineTo(ex + nx, ey + ny); c.lineTo(ex + Math.cos(a) * 4, ey + Math.sin(a) * 4); c.lineTo(x, y + 2); c.closePath(); c.fill();
            c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ex + Math.cos(a) * 3, ey + Math.sin(a) * 3, 0.9, 0, TAU); c.fill();
            if (gc) { gc.save(); gc.fillStyle = cols[1]; gc.globalAlpha = 0.35; c.beginPath(); gc.arc((x + ex) / 2, (y + ey) / 2, clen * 0.45, 0, TAU); gc.fill(); gc.restore(); }
          }
        } else {
          const mw = R * 1.6, mh = R * 0.65;
          const mossGrad = c.createRadialGradient(x, y - mh * 0.4, mh * 0.2, x, y - mh * 0.3, mw);
          mossGrad.addColorStop(0, '#3ad0c0'); mossGrad.addColorStop(0.45, '#16706e'); mossGrad.addColorStop(1, '#0c3538');
          c.fillStyle = mossGrad; c.beginPath(); c.ellipse(x, y + 1, mw, mh, 0, Math.PI, TAU); c.fill();
          c.fillStyle = '#5ffff0';
          for (let vi = 0; vi < 14; vi++) {
            const vx = x + (rng() - 0.5) * mw * 1.7, vy = y - mh * Math.sqrt(Math.max(0, 1 - Math.pow((vx - x) / mw, 2))) + (rng() - 0.5) * 2;
            c.beginPath(); c.arc(vx, vy, 1.1 + rng() * 0.8, 0, TAU); c.fill();
          }
          if (gc) { gc.save(); gc.fillStyle = '#3ad0c0'; gc.globalAlpha = 0.28; gc.beginPath(); gc.ellipse(x, y - mh * 0.3, mw * 1.1, mh * 1.1, 0, 0, TAU); gc.fill(); gc.restore(); }
        }
      } else {
        const bs = !G.cap.bushPal && ['bush1', 'bush2'].map((n) => TexLib.data[n]).filter(Boolean);
        if (bs && bs.length) { const T = bs[(rng() * bs.length) | 0], D = R * 3.6; if (surface) surface.sprite(T.canvas, T === TexLib.data.bush1 ? 'bush1' : 'bush2'); c.drawImage(T.canvas, x - D / 2, y + 3 - D, D, D); }
        else foliage(c, blobs, G.cap.bushPal || ['#1c3410', '#3c6a1c', '#7aa42c', '#cce060']);
        if (G.cap.flowers && rng() < 0.6) { c.fillStyle = rng.pick(G.cap.flowers); for (let j = 0; j < 6; j++) { c.beginPath(); c.arc(x + (rng() - 0.5) * R * 1.8, y - R * (0.4 + rng() * 0.8), 1.4, 0, TAU); c.fill(); } }
      }"""

tv_norm = tv.replace('\r\n', '\n')
target_tv_norm = target_tv.replace('\r\n', '\n')
assert target_tv_norm in tv_norm, "target_tv not found"
tv_norm = tv_norm.replace(target_tv_norm, replacement_tv.replace('\r\n', '\n'), 1)
with open('js/terrain_visual.js', 'wb') as f:
    f.write(tv_norm.replace('\n', '\r\n').encode('utf-8'))
print("js/terrain_visual.js updated!")

# 2. Update levels.js for bridge truss and tactical routes
with open('js/levels.js', 'rb') as f:
    lv = f.read().decode('utf-8')

target_lv1 = "if (o.rails) L.fixtures.push({ k: 'rail', x1, y1, x2, y2, sag: o.sag || 0, col: o.railCol });"
replacement_lv1 = """if (o.rails) L.fixtures.push({ k: 'rail', x1, y1, x2, y2, sag: o.sag || 0, col: o.railCol });
      if (o.truss || (def.theme === 'alien' && (o.mat === 'crystal' || o.mat === 'metal'))) {
        L.fixtures.push({ k: 'truss', x1, y1, x2, y2, sag: o.sag || 0, thick });
      }"""

target_lv2 = """  for (const f of map.fixtures || []) {
    if (f.k === 'rail') {
      c.strokeStyle = f.col || 'rgba(60,40,24,0.9)'; c.lineWidth = 2;
      const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2 + f.sag;
      c.beginPath(); c.moveTo(f.x1, f.y1 - 16); c.quadraticCurveTo(cx, cy - 16, f.x2, f.y2 - 16); c.stroke();
    }
  }"""

replacement_lv2 = """  for (const f of map.fixtures || []) {
    if (f.k === 'rail') {
      c.strokeStyle = f.col || 'rgba(60,40,24,0.9)'; c.lineWidth = 2;
      const cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2 + f.sag;
      c.beginPath(); c.moveTo(f.x1, f.y1 - 16); c.quadraticCurveTo(cx, cy - 16, f.x2, f.y2 - 16); c.stroke();
    } else if (f.k === 'truss') {
      const x1 = f.x1, y1 = f.y1, x2 = f.x2, y2 = f.y2, sag = f.sag || 0, thick = f.thick || 13;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      const segs = Math.max(4, Math.round(len / 34));
      const ptAt = (t) => [x1 + dx * t, y1 + dy * t + sag * 4 * t * (1 - t)];
      const trussDepth = 18 + Math.min(14, len * 0.05);
      c.save();
      c.lineWidth = 2.2; c.strokeStyle = 'rgba(70,85,110,0.85)';
      c.beginPath();
      for (let s = 0; s <= segs; s++) { const [px, py] = ptAt(s / segs); if (s === 0) c.moveTo(px, py + thick); else c.lineTo(px, py + thick); }
      c.stroke();
      c.beginPath();
      for (let s = 0; s <= segs; s++) { const [px, py] = ptAt(s / segs); if (s === 0) c.moveTo(px, py + thick + trussDepth); else c.lineTo(px, py + thick + trussDepth); }
      c.stroke();
      c.lineWidth = 1.6; c.strokeStyle = 'rgba(95,120,150,0.78)';
      c.beginPath();
      for (let s = 0; s < segs; s++) {
        const [px0, py0] = ptAt(s / segs), [px1, py1] = ptAt((s + 1) / segs);
        const top0 = py0 + thick, bot0 = top0 + trussDepth, top1 = py1 + thick, bot1 = top1 + trussDepth;
        c.moveTo(px0, top0); c.lineTo(px0, bot0);
        if (s % 2 === 0) { c.moveTo(px0, top0); c.lineTo(px1, bot1); }
        else { c.moveTo(px0, bot0); c.lineTo(px1, top1); }
      }
      const [lastPx, lastPy] = ptAt(1);
      c.moveTo(lastPx, lastPy + thick); c.lineTo(lastPx, lastPy + thick + trussDepth);
      c.stroke();
      c.fillStyle = 'rgba(160,200,240,0.9)';
      for (let s = 0; s <= segs; s++) {
        const [px, py] = ptAt(s / segs);
        c.beginPath(); c.arc(px, py + thick, 1.8, 0, TAU); c.fill();
        c.beginPath(); c.arc(px, py + thick + trussDepth, 1.8, 0, TAU); c.fill();
      }
      c.restore();
    }
  }"""

lv_norm = lv.replace('\r\n', '\n')
assert target_lv1 in lv_norm, "target_lv1 not found"
lv_norm = lv_norm.replace(target_lv1, replacement_lv1.replace('\r\n', '\n'), 1)
assert target_lv2.replace('\r\n', '\n') in lv_norm, "target_lv2 not found"
lv_norm = lv_norm.replace(target_lv2.replace('\r\n', '\n'), replacement_lv2.replace('\r\n', '\n'), 1)
with open('js/levels.js', 'wb') as f:
    f.write(lv_norm.replace('\n', '\r\n').encode('utf-8'))
print("js/levels.js updated!")

# 3. Update decor.js for glassdome and alientree
with open('js/decor.js', 'rb') as f:
    dc = f.read().decode('utf-8')

target_dc_dome = """  glassdome(c, g, x, y, s, r, o) {
    const [rx, ry, rot] = o || [92, 46, -0.04];
    if (g) { g.save(); g.translate(x, y); g.rotate(rot); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.ellipse(0, 0, rx + 3, ry + 3, 0, Math.PI, TAU); g.fill(); g.restore(); }   // стекло не светится, как кристалл
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, Math.PI, TAU); c.closePath(); c.clip();
    c.globalCompositeOperation = 'source-atop';
    // стекло: отражает небо — светлое сверху, темнее и голубее к основанию, внутри видна тёмная кабина
    const gg = c.createLinearGradient(0, -ry, 0, 0); gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(0.4, 'rgba(214,232,252,1)'); gg.addColorStop(1, 'rgba(120,150,196,1)');
    c.fillStyle = gg; c.fillRect(-rx, -ry, rx * 2, ry);
    c.fillStyle = 'rgba(40,50,80,0.25)'; c.beginPath(); c.ellipse(0, 0, rx * 0.62, ry * 0.55, 0, Math.PI, TAU); c.fill();
    // каркас: меридианы и параллели из стальных рёбер
    c.strokeStyle = 'rgba(120,128,142,0.95)'; c.lineWidth = 2.2;
    for (let k = -3; k <= 3; k++) { const px = k / 3.6; c.beginPath(); c.ellipse(0, 0, Math.abs(px) * rx + 0.01, ry, 0, Math.PI, TAU); c.stroke(); }
    for (const h of [0.35, 0.68]) { c.beginPath(); c.ellipse(0, 0, rx * Math.sqrt(1 - h * h), 1, 0, 0, TAU); c.save(); c.translate(0, -h * ry); c.restore(); c.moveTo(-rx * Math.sqrt(1 - h * h), -h * ry); c.lineTo(rx * Math.sqrt(1 - h * h), -h * ry); c.stroke(); }
    c.strokeStyle = 'rgba(210,218,230,0.8)'; c.lineWidth = 0.8;
    for (let k = -3; k <= 3; k++) { const px = k / 3.6; c.beginPath(); c.ellipse(-0.8, -0.8, Math.abs(px) * rx + 0.01, ry, 0, Math.PI * 1.1, Math.PI * 1.5); c.stroke(); }
    // блики: широкая полоса неба и яркая искра
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(-rx * 0.35, -ry * 0.62, rx * 0.28, ry * 0.12, -0.35, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.95)'; c.beginPath(); c.arc(-rx * 0.46, -ry * 0.7, 2.5, 0, TAU); c.fill();
    c.restore();
  },"""

replacement_dc_dome = """  glassdome(c, g, x, y, s, r, o) {
    const [rx, ry, rot] = o || [92, 46, -0.04];
    if (g) { g.save(); g.translate(x, y); g.rotate(rot); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.ellipse(0, 0, rx + 3, ry + 3, 0, Math.PI, TAU); g.fill(); g.restore(); }
    c.save(); c.translate(x, y); c.rotate(rot);
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, Math.PI, TAU); c.closePath(); c.clip();
    c.globalCompositeOperation = 'source-atop';
    // многослойное оптическое стекло купола с отражением горизонта
    const gg = c.createLinearGradient(0, -ry, 0, 0);
    gg.addColorStop(0, 'rgba(255,255,255,0.95)'); gg.addColorStop(0.25, 'rgba(195,225,255,0.85)'); gg.addColorStop(0.65, 'rgba(120,165,220,0.75)'); gg.addColorStop(1, 'rgba(45,70,110,0.9)');
    c.fillStyle = gg; c.fillRect(-rx, -ry, rx * 2, ry);
    // кабина и приборные консоли
    c.fillStyle = 'rgba(25,32,48,0.55)'; c.beginPath(); c.ellipse(0, 0, rx * 0.72, ry * 0.62, 0, Math.PI, TAU); c.fill();
    c.fillStyle = 'rgba(15,20,32,0.7)'; c.fillRect(-rx * 0.45, -ry * 0.28, rx * 0.9, ry * 0.22);
    c.fillStyle = '#4ff5d8'; for (let k = -3; k <= 3; k++) { c.fillRect(k * rx * 0.1, -ry * 0.2, 2.2, 1.8); }
    c.fillStyle = '#ffcf5a'; c.fillRect(-rx * 0.25, -ry * 0.12, 6, 2); c.fillRect(rx * 0.15, -ry * 0.12, 6, 2);
    // преломляющая изумрудно-голубая кромка стекла по контуру (френель)
    c.strokeStyle = 'rgba(79,245,216,0.55)'; c.lineWidth = 3.2;
    c.beginPath(); c.ellipse(0, 0, rx - 1.6, ry - 1.6, 0, Math.PI, TAU); c.stroke();
    // каркас: меридианы и параллели из титановых рёбер
    c.strokeStyle = 'rgba(105,115,135,0.95)'; c.lineWidth = 2.4;
    for (let k = -3; k <= 3; k++) { const px = k / 3.6; c.beginPath(); c.ellipse(0, 0, Math.abs(px) * rx + 0.01, ry, 0, Math.PI, TAU); c.stroke(); }
    for (const h of [0.35, 0.68]) { c.beginPath(); c.ellipse(0, 0, rx * Math.sqrt(1 - h * h), 1, 0, 0, TAU); c.save(); c.translate(0, -h * ry); c.restore(); c.moveTo(-rx * Math.sqrt(1 - h * h), -h * ry); c.lineTo(rx * Math.sqrt(1 - h * h), -h * ry); c.stroke(); }
    c.strokeStyle = 'rgba(225,235,250,0.85)'; c.lineWidth = 0.9;
    for (let k = -3; k <= 3; k++) { const px = k / 3.6; c.beginPath(); c.ellipse(-0.8, -0.8, Math.abs(px) * rx + 0.01, ry, 0, Math.PI * 1.1, Math.PI * 1.5); c.stroke(); }
    // блики: широкая полоса небесного отражения и двойная искра на изгибе стекла
    c.fillStyle = 'rgba(255,255,255,0.65)'; c.beginPath(); c.ellipse(-rx * 0.35, -ry * 0.62, rx * 0.28, ry * 0.12, -0.35, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.98)'; c.beginPath(); c.arc(-rx * 0.46, -ry * 0.7, 2.6, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(-rx * 0.32, -ry * 0.52, 1.4, 0, TAU); c.fill();
    c.restore();
  },"""

target_dc_tree = """  alientree(c, g, x, y, s, r) {
    if (treeSprite(c, ['alien_tree1', 'alien_tree2'], x, y, s, r, 150)) return;   // гриб из Blender
    const h = r.range(70, 90) * s; const bend = r.range(-12, 12) * s;
    c.strokeStyle = hgrad(c, x - 8 * s, x + 8 * s, ['#b28ae0', '#6a3fa0', '#3a1f66']); c.lineWidth = 9 * s; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y + 4); c.quadraticCurveTo(x + bend * 2, y - h * 0.5, x + bend, y - h); c.stroke();
    const cx = x + bend, cy = y - h; const R = 36 * s;
    c.fillStyle = vgrad(c, cy - R * 0.7, cy + R * 0.3, ['#ff8af0', '#c43fb0', '#6a1a60']);
    c.beginPath(); c.moveTo(cx - R, cy + 4 * s); c.quadraticCurveTo(cx - R * 0.95, cy - R * 0.75, cx, cy - R * 0.8); c.quadraticCurveTo(cx + R * 0.95, cy - R * 0.75, cx + R, cy + 4 * s);
    c.quadraticCurveTo(cx, cy - R * 0.15, cx - R, cy + 4 * s); c.fill();
    for (let i = 0; i < 9; i++) {
      const sx = cx + r.range(-R * 0.75, R * 0.75), sy = cy - r.range(R * 0.15, R * 0.6); const sr = r.range(2, 4.5) * s;
      c.fillStyle = '#fff2a0'; circ(c, sx, sy, sr); if (g) { g.fillStyle = 'rgba(255,240,140,0.9)'; circ(g, sx, sy, sr * 2.4); }
    }
    c.strokeStyle = 'rgba(255,140,240,0.7)'; c.lineWidth = 1.2 * s;
    for (let i = 0; i < 7; i++) { const tx = cx - R * 0.85 + i * R * 0.28; const l = r.range(8, 22) * s; c.beginPath(); c.moveTo(tx, cy + 2 * s); c.quadraticCurveTo(tx + 3 * s, cy + l * 0.5, tx, cy + l); c.stroke(); if (g) { g.fillStyle = 'rgba(255,120,240,0.8)'; circ(g, tx, cy + l, 3 * s); } }
  },"""

replacement_dc_tree = """  alientree(c, g, x, y, s, r) {
    const hasSprite = treeSprite(c, ['alien_tree1', 'alien_tree2'], x, y, s, r, 150);
    const h = r.range(70, 90) * s, bend = r.range(-12, 12) * s;
    const cx = x + bend, cy = y - h, R = 36 * s;
    if (!hasSprite) {
      c.save(); const stw = 9 * s;
      c.strokeStyle = hgrad(c, x - stw, x + stw, ['#3a1f66', '#7a42b0', '#b88ef0', '#5a2d8a', '#2a144c']);
      c.lineWidth = stw; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y + 4); c.quadraticCurveTo(x + bend * 1.8, y - h * 0.5, cx, cy); c.stroke();
      c.lineWidth = 1.1 * s;
      for (let fi = -3; fi <= 3; fi++) {
        c.strokeStyle = fi % 2 === 0 ? 'rgba(220,180,255,0.6)' : 'rgba(50,20,90,0.7)';
        c.beginPath(); c.moveTo(x + fi * 1.8 * s, y + 3); c.quadraticCurveTo(x + bend * 1.8 + fi * 1.2 * s, y - h * 0.5, cx + fi * 0.8 * s, cy); c.stroke();
      }
      c.fillStyle = vgrad(c, cy - R * 0.75, cy + R * 0.3, ['#ffaef5', '#d44fc2', '#7a1a70', '#3b0a38']);
      c.beginPath(); c.moveTo(cx - R, cy + 4 * s); c.quadraticCurveTo(cx - R * 0.95, cy - R * 0.75, cx, cy - R * 0.82); c.quadraticCurveTo(cx + R * 0.95, cy - R * 0.75, cx + R, cy + 4 * s); c.quadraticCurveTo(cx, cy - R * 0.15, cx - R, cy + 4 * s); c.closePath(); c.fill();
      c.lineWidth = 0.9 * s; c.strokeStyle = 'rgba(60,10,65,0.65)';
      for (let gi = 0; gi < 16; gi++) { const gx = cx - R * 0.85 + gi * R * 0.11; c.beginPath(); c.moveTo(gx, cy + 3 * s); c.lineTo(cx, cy); c.stroke(); }
      c.restore();
    }
    c.save();
    for (let i = 0; i < 11; i++) {
      const sx = cx + r.range(-R * 0.75, R * 0.75), sy = cy - r.range(R * 0.12, R * 0.65), sr = r.range(2, 4.8) * s;
      c.fillStyle = 'rgba(255,245,160,0.92)'; circ(c, sx, sy, sr);
      c.strokeStyle = 'rgba(255,160,240,0.65)'; c.lineWidth = 0.8 * s; c.beginPath(); c.arc(sx, sy, sr * 1.35, 0, TAU); c.stroke();
      if (g) { g.fillStyle = 'rgba(255,240,140,0.85)'; circ(g, sx, sy, sr * 2.2); }
    }
    c.lineWidth = 1.1 * s;
    for (let i = 0; i < 9; i++) {
      const tx = cx - R * 0.82 + i * R * 0.20 + r.range(-2, 2) * s, l = r.range(12, 32) * s, cur = r.range(-4, 4) * s;
      c.strokeStyle = 'rgba(240,160,255,0.75)'; c.beginPath(); c.moveTo(tx, cy + 2 * s); c.quadraticCurveTo(tx + cur, cy + l * 0.5, tx + cur * 0.6, cy + l); c.stroke();
      c.fillStyle = '#6fffe9'; circ(c, tx + cur * 0.6, cy + l, 1.8 * s);
      if (g) { g.fillStyle = 'rgba(110,255,233,0.7)'; circ(g, tx + cur * 0.6, cy + l, 4.5 * s); }
    }
    c.lineWidth = 1.2 * s; c.strokeStyle = 'rgba(180,120,240,0.7)';
    for (let ri = 0; ri < 5; ri++) {
      const rx = x + (ri - 2) * 5 * s, rlen = (8 + r.range(2, 8)) * s, rdir = ri < 2 ? -1 : 1;
      c.beginPath(); c.moveTo(x, y + 2); c.quadraticCurveTo(rx + rdir * 4 * s, y + 1, rx + rdir * rlen, y + 3); c.stroke();
    }
    c.restore();
  },"""

dc_norm = dc.replace('\r\n', '\n')
assert target_dc_dome.replace('\r\n', '\n') in dc_norm, "target_dc_dome not found"
dc_norm = dc_norm.replace(target_dc_dome.replace('\r\n', '\n'), replacement_dc_dome.replace('\r\n', '\n'), 1)
assert target_dc_tree.replace('\r\n', '\n') in dc_norm, "target_dc_tree not found"
dc_norm = dc_norm.replace(target_dc_tree.replace('\r\n', '\n'), replacement_dc_tree.replace('\r\n', '\n'), 1)
with open('js/decor.js', 'wb') as f:
    f.write(dc_norm.replace('\n', '\r\n').encode('utf-8'))
print("js/decor.js updated!")
