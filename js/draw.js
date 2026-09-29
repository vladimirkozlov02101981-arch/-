'use strict';
/* =========================================================
   Рисование бойцов, снарядов и анимированных объектов карты
   (общее для хоста и гостя — работает с «видом» объекта)
   ========================================================= */
const INK = '#151515';

function ik2(ax, ay, bx, by, l1, l2, bend) {
  let dx = bx - ax, dy = by - ay; let d = Math.hypot(dx, dy); const maxd = l1 + l2 - 0.01;
  if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; }
  if (d < 0.01) return [ax, ay + l1];
  const a = Math.atan2(dy, dx); const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const ang = a + bend * Math.acos(cosA);
  return [ax + Math.cos(ang) * l1, ay + Math.sin(ang) * l1];
}
function limb(c, ax, ay, kx, ky, bx, by) { c.beginPath(); c.moveTo(ax, ay); c.lineTo(kx, ky); c.lineTo(bx, by); c.stroke(); }

/* ---------- объёмные «мультяшные» детали: свет сверху слева ---------- */
const SKIN = '#f3c8a0', PANTS = '#3c4152', BOOT = '#2c2320', OUTL = 'rgba(28,18,14,0.85)';
/** радиальный градиент шара: блик сверху слева, тень снизу справа */
function ballGrad(c, x, y, r, base, hi = 1.32, lo = 0.6) {
  const g = c.createRadialGradient(x - r * 0.38, y - r * 0.46, r * 0.06, x, y, r * 1.06);
  g.addColorStop(0, css(shadec(base, hi))); g.addColorStop(0.5, css(base)); g.addColorStop(1, css(shadec(base, lo)));
  return g;
}
/** конечность-капсула: контур, основной цвет, блик */
function capsule(c, pts, w, col) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  const path = (dx, dy) => { c.beginPath(); c.moveTo(pts[0][0] + dx, pts[0][1] + dy); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] + dx, pts[i][1] + dy); };
  c.strokeStyle = OUTL; c.lineWidth = w + 1.5; path(0, 0); c.stroke();
  c.strokeStyle = col; c.lineWidth = w; path(0, 0); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.24)'; c.lineWidth = w * 0.34; path(-w * 0.18, -w * 0.2); c.stroke();
}
function boot(c, x, y, face, back) {
  c.fillStyle = OUTL; c.beginPath(); c.ellipse(x + face * 1.2, y - 1.2, 3.4, 2.1, 0, 0, TAU); c.fill();
  c.fillStyle = back ? css(shadec(BOOT, 0.8)) : BOOT; c.beginPath(); c.ellipse(x + face * 1.2, y - 1.3, 2.7, 1.5, 0, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.ellipse(x + face * 0.6, y - 2, 1.3, 0.5, 0, 0, TAU); c.fill();
}
function hand(c, x, y) { c.fillStyle = OUTL; circ(c, x, y, 2.05); c.fillStyle = ballGrad(c, x, y, 1.6, SKIN); circ(c, x, y, 1.45); }

function drawHat(c, hat, col, hx, hy, face) {
  const dark = css(shadec(col, 0.55));
  switch (hat) {
    case 'beret':
      c.fillStyle = OUTL; c.beginPath(); c.ellipse(hx - face * 0.8, hy - 4.8, 7.8, 3.6, -face * 0.22, 0, TAU); c.fill();
      c.fillStyle = ballGrad(c, hx - face * 1.2, hy - 5.4, 7.2, col); c.beginPath(); c.ellipse(hx - face * 0.8, hy - 4.8, 7.1, 3, -face * 0.22, 0, TAU); c.fill();
      c.fillStyle = dark; c.beginPath(); c.ellipse(hx - face * 0.4, hy - 2.4, 6.6, 1.1, -face * 0.1, 0, TAU); c.fill();
      c.fillStyle = '#ffd23a'; circ(c, hx + face * 3.6, hy - 4.6, 1.1); break;
    case 'cap':
      c.fillStyle = OUTL; c.beginPath(); c.arc(hx, hy - 1.6, 7.6, Math.PI, 0); c.fill();
      c.fillStyle = ballGrad(c, hx, hy - 3.6, 7.2, col); c.beginPath(); c.arc(hx, hy - 1.6, 6.9, Math.PI, 0); c.fill();
      c.fillStyle = OUTL; c.beginPath(); c.ellipse(hx + face * 6.8, hy - 1.7, 5.4, 1.9, 0, 0, TAU); c.fill();
      c.fillStyle = dark; c.beginPath(); c.ellipse(hx + face * 6.8, hy - 1.8, 4.8, 1.3, 0, 0, TAU); c.fill();
      c.fillStyle = css(shadec(col, 1.4)); circ(c, hx, hy - 8.4, 1.3); break;
    case 'cowboy':
      c.fillStyle = OUTL; c.beginPath(); c.ellipse(hx, hy - 3.2, 11.4, 2.7, 0, 0, TAU); c.fill();
      c.fillStyle = ballGrad(c, hx, hy - 4, 11, '#8a5a2e', 1.25, 0.65); c.beginPath(); c.ellipse(hx, hy - 3.3, 10.6, 2, 0, 0, TAU); c.fill();
      c.fillStyle = OUTL; rrect(c, hx - 5.6, hy - 12, 11.2, 9.4, 3.4); c.fill();
      c.fillStyle = ballGrad(c, hx - 1, hy - 9, 8, '#9a6634', 1.25, 0.62); rrect(c, hx - 4.9, hy - 11.3, 9.8, 8.2, 3); c.fill();
      c.fillStyle = col; c.fillRect(hx - 4.9, hy - 5.8, 9.8, 1.9); break;
    case 'crown': {
      const g = c.createLinearGradient(hx - 6, hy - 11, hx + 6, hy - 3); g.addColorStop(0, '#fff3a0'); g.addColorStop(0.45, '#ffd23a'); g.addColorStop(1, '#b8860b');
      c.fillStyle = OUTL; c.beginPath(); c.moveTo(hx - 6.4, hy - 2.6); c.lineTo(hx - 6.4, hy - 10.4); c.lineTo(hx - 3.2, hy - 6.8); c.lineTo(hx, hy - 11.6); c.lineTo(hx + 3.2, hy - 6.8); c.lineTo(hx + 6.4, hy - 10.4); c.lineTo(hx + 6.4, hy - 2.6); c.closePath(); c.fill();
      c.fillStyle = g; c.beginPath(); c.moveTo(hx - 5.6, hy - 3.3); c.lineTo(hx - 5.6, hy - 8.6); c.lineTo(hx - 3.2, hy - 5.6); c.lineTo(hx, hy - 10); c.lineTo(hx + 3.2, hy - 5.6); c.lineTo(hx + 5.6, hy - 8.6); c.lineTo(hx + 5.6, hy - 3.3); c.closePath(); c.fill();
      c.fillStyle = col; circ(c, hx, hy - 5.2, 1.3); c.fillStyle = '#fff'; circ(c, hx - 0.4, hy - 5.6, 0.45); break;
    }
    case 'tophat':
      c.fillStyle = OUTL; c.beginPath(); c.ellipse(hx, hy - 4, 9.4, 2.4, 0, 0, TAU); c.fill(); rrect(c, hx - 5.6, hy - 16, 11.2, 12.6, 2); c.fill();
      c.fillStyle = '#26262c'; c.beginPath(); c.ellipse(hx, hy - 4, 8.6, 1.7, 0, 0, TAU); c.fill();
      { const g = c.createLinearGradient(hx - 5, 0, hx + 5, 0); g.addColorStop(0, '#55555f'); g.addColorStop(0.35, '#2a2a31'); g.addColorStop(1, '#141418'); c.fillStyle = g; rrect(c, hx - 4.9, hy - 15.3, 9.8, 11.4, 1.6); c.fill(); }
      c.fillStyle = col; c.fillRect(hx - 4.9, hy - 7.4, 9.8, 2.2); break;
    case 'ushanka':
      c.fillStyle = OUTL; c.beginPath(); c.arc(hx, hy - 1.4, 8, Math.PI, 0); c.fill(); rrect(c, hx - 8.2, hy - 3, 3.8, 8.6, 1.8); c.fill(); rrect(c, hx + 4.4, hy - 3, 3.8, 8.6, 1.8); c.fill();
      c.fillStyle = ballGrad(c, hx, hy - 3.6, 7.6, '#7a6452'); c.beginPath(); c.arc(hx, hy - 1.4, 7.3, Math.PI, 0); c.fill();
      c.fillStyle = '#8f7862'; rrect(c, hx - 7.6, hy - 2.4, 2.8, 7.4, 1.4); c.fill(); rrect(c, hx + 4.8, hy - 2.4, 2.8, 7.4, 1.4); c.fill();
      c.fillStyle = '#9c846c'; rrect(c, hx - 7.4, hy - 3.6, 14.8, 2.8, 1.4); c.fill();
      c.fillStyle = col; circ(c, hx + face * 1.8, hy - 5.6, 1.6); c.fillStyle = 'rgba(255,255,255,0.6)'; circ(c, hx + face * 1.4, hy - 6.1, 0.5); break;
    case 'viking':
      c.fillStyle = OUTL; c.beginPath(); c.arc(hx, hy - 1.4, 7.8, Math.PI, 0); c.fill();
      c.fillStyle = ballGrad(c, hx, hy - 3.6, 7.4, '#a8b0bc'); c.beginPath(); c.arc(hx, hy - 1.4, 7.1, Math.PI, 0); c.fill();
      c.fillStyle = col; c.fillRect(hx - 7.1, hy - 2.8, 14.2, 1.9);
      for (const sd of [-1, 1]) {
        c.fillStyle = OUTL; c.beginPath(); c.moveTo(hx + sd * 6, hy - 3.6); c.quadraticCurveTo(hx + sd * 12.4, hy - 6, hx + sd * 11, hy - 13.4); c.quadraticCurveTo(hx + sd * 9.4, hy - 7.6, hx + sd * 4, hy - 6.2); c.fill();
        const g = c.createLinearGradient(hx + sd * 4, hy - 4, hx + sd * 11, hy - 12); g.addColorStop(0, '#d8c8a0'); g.addColorStop(1, '#fffaf0');
        c.fillStyle = g; c.beginPath(); c.moveTo(hx + sd * 6, hy - 4.2); c.quadraticCurveTo(hx + sd * 11.4, hy - 6.2, hx + sd * 10.6, hy - 12.2); c.quadraticCurveTo(hx + sd * 9, hy - 7.6, hx + sd * 4.4, hy - 6); c.fill();
      }
      break;
    default: { // каска
      const hy2 = hy - 1.6;
      c.fillStyle = OUTL; c.beginPath(); c.arc(hx, hy2 - 0.8, 8.1, Math.PI * 1.02, -0.02); c.closePath(); c.fill();
      c.fillStyle = ballGrad(c, hx - face * 0.4, hy2 - 3.8, 7.8, col); c.beginPath(); c.arc(hx, hy2 - 0.8, 7.4, Math.PI * 1.02, -0.02); c.closePath(); c.fill();
      c.fillStyle = OUTL; rrect(c, hx - 8.6 - (face < 0 ? 1.6 : 0), hy2 - 2.2, 17.2 + 1.6, 3.2, 1.6); c.fill();
      c.fillStyle = dark; rrect(c, hx - 8 - (face < 0 ? 1.6 : 0), hy2 - 1.7, 16 + 1.6, 2.1, 1); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.3; c.lineCap = 'round'; c.beginPath(); c.arc(hx, hy2 - 0.8, 5.2, Math.PI * 1.18, Math.PI * 1.46); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.8)'; circ(c, hx - 3.4, hy2 - 5.8, 0.8);
    }
  }
}

/** боец: s — вид (x, y, aim, face, st, rot, wpn, alive, hurt, thrust), an — кэш анимации.
    Собственный дизайн: коренастый мультяшный солдатик с большой головой и каской цвета команды */
function drawSoldier(c, s, team, t, an) {
  const face = s.face || 1; const col = team ? team.color : '#888';
  const colD = css(shadec(col, 0.66));
  const dead = !s.alive;
  c.save(); c.translate(s.x, s.y);
  if ((s.st === 'stand' || s.st === 'walk' || s.st === 'climb') && !dead) { c.fillStyle = 'rgba(10,6,4,0.28)'; c.beginPath(); c.ellipse(0, 0.6, 10, 2.4, 0, 0, TAU); c.fill(); }
  if (s.st === 'fly') { c.translate(0, -18); c.rotate(s.rot); c.translate(0, 18); }
  else if (s.st === 'dead') { c.translate(0, -2); c.rotate(face * 1.45); c.translate(0, 2); }
  const climb = s.st === 'climb';
  const bob = s.st === 'stand' && !dead ? Math.sin(t * 2.4 + s.id) * 0.45 : 0;
  const lean = s.st === 'walk' ? face * 1.2 : 0;
  // реалистичные пропорции: рост ~36 px, голова ~1/7 роста, плечо на высоте GUN_Y
  const hipX = lean * 0.3, hipY = -15.5;
  const nX = lean, nY = -27 + bob;
  let f1, f2;
  if (s.st === 'walk') { const ph = an.walk; f1 = [Math.sin(ph) * 6, -Math.max(0, Math.cos(ph)) * 3.4]; f2 = [Math.sin(ph + Math.PI) * 6, -Math.max(0, Math.cos(ph + Math.PI)) * 3.4]; }
  else if (climb) { const ph = s.y * 0.35; f1 = [2.4, -Math.max(0, Math.sin(ph)) * 3.2]; f2 = [-2.4, -Math.max(0, -Math.sin(ph)) * 3.2]; }
  else if (s.st === 'air' || s.st === 'jet') { f1 = [face * 4.4, -5.6]; f2 = [-face * 2.6, -2]; }
  else if (s.st === 'fly' || s.st === 'dead') { f1 = [6.2, -1]; f2 = [-5.6, -2.2]; }
  else { f1 = [2.9, 0]; f2 = [-2.9, 0]; }
  const k1 = ik2(hipX, hipY, f1[0], f1[1], 8.2, 8, -face), k2 = ik2(hipX, hipY, f2[0], f2[1], 8.2, 8, -face);
  // джетпак / ранец за спиной
  const jet = s.wpn === 'jetpack' || s.st === 'jet';
  if (jet) {
    c.fillStyle = OUTL; rrect(c, -face * 7.5 - 3.5, -27, 7, 14, 2.6); c.fill();
    c.fillStyle = ballGrad(c, -face * 7.5, -21, 6, '#6a7382'); rrect(c, -face * 7.5 - 2.8, -26.3, 5.6, 12.6, 2); c.fill();
    c.fillStyle = '#d0402f'; c.fillRect(-face * 7.5 - 2.8, -22.6, 5.6, 2);
    if (s.thrust) { c.save(); c.globalCompositeOperation = 'lighter'; c.drawImage(glowSprite('#ffa23a'), -face * 7.5 - 6.5, -15, 13, 18 + Math.random() * 7); c.restore(); }
  } else {
    c.fillStyle = OUTL; rrect(c, nX - face * 6 - 3, nY + 0.8, 6, 11, 2.2); c.fill();
    c.fillStyle = ballGrad(c, nX - face * 6, nY + 5, 6, '#5f6b4a'); rrect(c, nX - face * 6 - 2.4, nY + 1.4, 4.8, 9.8, 1.8); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(nX - face * 6 - 2.4, nY + 5, 4.8, 0.8);
  }
  // задняя нога
  capsule(c, [[hipX, hipY], k2, [f2[0], f2[1] - 1.2]], 3.3, css(shadec(PANTS, 0.78)));
  boot(c, f2[0], f2[1], face, true);
  // торс: скруглённый мундир с ремнём
  const th = hipY - nY + 2.6;
  c.fillStyle = OUTL; rrect(c, nX - 5.3, nY - 0.7, 10.6, th + 1.4, 3.6); c.fill();
  { const g = c.createLinearGradient(nX - 5, nY, nX + 5, nY + th); g.addColorStop(0, css(shadec(col, 1.22))); g.addColorStop(0.5, css(col)); g.addColorStop(1, colD); c.fillStyle = g; }
  rrect(c, nX - 4.6, nY, 9.2, th, 3); c.fill();
  // разгрузка: карманы и воротник
  c.fillStyle = css(shadec(col, 0.55)); rrect(c, nX + face * 0.6 - 2.4, nY + th * 0.36, 4.8, 3.4, 0.8); c.fill(); rrect(c, nX + face * 0.6 - 2.4, nY + th * 0.36 + 4, 4.8, 3, 0.8); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(nX + face * 0.6 - 2.2, nY + th * 0.36 + 0.4, 4.4, 0.7);
  c.fillStyle = css(shadec(col, 0.7)); rrect(c, nX - 3.4, nY - 0.6, 6.8, 2.2, 1); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.18)'; rrect(c, nX + face * 1.2 - 0.6, nY + 1.2, 1.2, th - 3.4, 0.6); c.fill();
  c.fillStyle = '#2e2622'; c.fillRect(nX - 4.6, hipY - 1.6, 9.2, 2.3);
  c.fillStyle = '#d8b04a'; c.fillRect(nX + face * 1.4 - 1.1, hipY - 1.5, 2.2, 2.1);
  c.fillStyle = 'rgba(255,255,255,0.22)'; rrect(c, nX - 4.2, nY + 1, 3, th * 0.5, 1.4); c.fill();
  // передняя нога
  capsule(c, [[hipX, hipY], k1, [f1[0], f1[1] - 1.2]], 3.5, PANTS);
  boot(c, f1[0], f1[1], face, false);
  // руки и оружие
  const shX = nX, shY = nY + 3;
  const holding = s.wpn && !dead && s.st !== 'fly' && !climb && s.wpn !== 'jetpack';
  if (holding) {
    const a = s.aim; const dx = Math.cos(a), dy = Math.sin(a);
    const gx = shX + dx * 7.2, gy = shY + dy * 7.2;
    const two = !['grenade', 'cluster', 'sticky', 'blackhole', 'mine', 'dynamite', 'molotov', 'robot', 'medkit', 'skip', 'airstrike', 'lightning', 'orbital', 'nuke', 'teleport', 'girder'].includes(s.wpn);
    const bx = two ? gx + dx * 6.4 : gx + dx * 0.5, by = two ? gy + dy * 6.4 : gy + dy * 0.5 + 1;
    const ke = ik2(shX, shY, bx, by, 6.4, 6.4, face); capsule(c, [[shX, shY], ke, [bx, by]], 2.9, colD); hand(c, bx, by);
    c.save(); c.translate(gx, gy); c.rotate(a); if (face < 0) c.scale(1, -1); drawHeld(c, s.wpn, t); c.restore();
    const kf = ik2(shX, shY, gx, gy, 6.4, 6.4, face); capsule(c, [[shX, shY], kf, [gx, gy]], 3, col); hand(c, gx, gy);
  } else {
    let h1, h2;
    const fX = shX + face * 2.2, bX = shX - face * 2.6;
    if (climb) { const ph = s.y * 0.35; h1 = [shX + 2.6, shY - 11 - Math.sin(ph) * 2.6]; h2 = [shX - 2.6, shY - 11 + Math.sin(ph) * 2.6]; }
    else if (s.st === 'fly' || s.st === 'dead') { h1 = [shX + 9, shY - 6]; h2 = [shX - 9, shY - 5]; }
    else if (s.st === 'air' || s.st === 'jet') { h1 = [fX + face * 5.6, shY - 5.4]; h2 = [bX - face * 4.8, shY - 3.4]; }
    else { const sw = s.st === 'walk' ? Math.sin(an.walk) * 4.2 : Math.sin(t * 2.4 + s.id) * 0.4; h1 = [fX + sw + face * 1.4, shY + 11.4]; h2 = [bX - sw - face * 1, shY + 11.2]; }
    const e2 = ik2(bX, shY, h2[0], h2[1], 6.2, 6.2, face); capsule(c, [[bX, shY], e2, h2], 2.9, colD); hand(c, h2[0], h2[1]);
    const e1 = ik2(fX, shY, h1[0], h1[1], 6.2, 6.2, face); capsule(c, [[fX, shY], e1, h1], 3, col); hand(c, h1[0], h1[1]);
  }
  // голова: реалистичные пропорции — шея, небольшое лицо с носом, каска по размеру
  const hx = nX + face * 0.6, hy = nY - 5.6, R = 4.7;
  c.fillStyle = OUTL; rrect(c, nX - 1.9, nY - 2.6, 3.8, 3.6, 1); c.fill(); c.fillStyle = css(shadec(SKIN, 0.85)); rrect(c, nX - 1.4, nY - 2.4, 2.8, 3.2, 0.8); c.fill();
  c.fillStyle = OUTL; c.beginPath(); c.ellipse(hx, hy, R + 0.7, R * 1.12 + 0.7, 0, 0, TAU); c.fill();
  c.fillStyle = ballGrad(c, hx, hy, R, SKIN, 1.12, 0.78); c.beginPath(); c.ellipse(hx, hy, R, R * 1.12, 0, 0, TAU); c.fill();
  c.fillStyle = css(shadec(SKIN, 0.82)); c.beginPath(); c.ellipse(hx - face * 3.4, hy + 0.6, 1, 1.4, 0, 0, TAU); c.fill();   // ухо
  c.fillStyle = 'rgba(60,40,30,0.18)'; c.beginPath(); c.ellipse(hx + face * 1.6, hy + 3.4, 2.6, 1.3, 0, 0, TAU); c.fill();      // щетина
  c.fillStyle = css(shadec(SKIN, 0.9)); c.beginPath(); c.moveTo(hx + face * 4, hy - 0.2); c.lineTo(hx + face * 5.5, hy + 1.8); c.lineTo(hx + face * 3.8, hy + 2.1); c.closePath(); c.fill();   // нос
  const look = holding ? s.aim : (face > 0 ? 0 : Math.PI);
  const ex = Math.cos(look), ey = Math.sin(look), eyeX = hx + face * 2.4, eyeY = hy - 0.2;
  c.lineCap = 'round';
  if (dead) {
    c.strokeStyle = '#3a2418'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(eyeX - 0.8, eyeY - 0.8); c.lineTo(eyeX + 0.8, eyeY + 0.8); c.moveTo(eyeX + 0.8, eyeY - 0.8); c.lineTo(eyeX - 0.8, eyeY + 0.8); c.stroke();
  } else if (an.blink > 0 || s.hurt > 0) {
    c.strokeStyle = '#3a2418'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(eyeX - 0.9, eyeY + 0.2); c.lineTo(eyeX + 0.9, eyeY + 0.2); c.stroke();
  } else {
    c.fillStyle = '#f4efe8'; c.beginPath(); c.ellipse(eyeX, eyeY, 1.05, 0.72, 0, 0, TAU); c.fill();
    c.fillStyle = '#2a1c16'; circ(c, eyeX + ex * 0.35, eyeY + ey * 0.3, 0.52);
  }
  c.strokeStyle = '#4a2c1c'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(eyeX - 1.1, eyeY - 1.5); c.lineTo(eyeX + 1.2, eyeY - 1.3); c.stroke();   // бровь
  c.strokeStyle = 'rgba(80,40,30,0.7)'; c.lineWidth = 0.5; c.beginPath(); c.moveTo(hx + face * 2.2, hy + 3); c.lineTo(hx + face * 3.8, hy + 2.9); c.stroke();   // рот
  const hat = team ? team.hat : 'helmet';
  c.save(); c.translate(hx, hy); c.scale(0.74, 0.74); drawHat(c, hat, col, 0, hat === 'helmet' || !hat ? -0.6 : -1.8, face); c.restore();
  if (s.hurt > 0 && !dead) { c.globalAlpha = Math.min(0.5, s.hurt * 2.5); c.fillStyle = '#ff3030'; c.beginPath(); c.ellipse(hx, hy, R + 0.6, R * 1.12 + 0.6, 0, 0, TAU); c.fill(); c.globalAlpha = 1; }
  c.restore();
}

/* ---------- тела снарядов ---------- */
function drawRocketShape(c, body, nose, len, th, t, flame) {
  c.fillStyle = body; rrect(c, -len * 0.55, -th / 2, len, th, th / 2.4); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(-len * 0.5, -th / 2 + 0.6, len * 0.8, th * 0.22);
  c.fillStyle = nose; c.beginPath(); c.moveTo(len * 0.45, -th / 2); c.quadraticCurveTo(len * 0.62, -th * 0.2, len * 0.72, 0); c.quadraticCurveTo(len * 0.62, th * 0.2, len * 0.45, th / 2); c.closePath(); c.fill();
  c.fillStyle = '#2a2a2a'; c.beginPath(); c.moveTo(-len * 0.55, -th / 2); c.lineTo(-len * 0.7, -th * 1.1); c.lineTo(-len * 0.35, -th / 2); c.fill();
  c.beginPath(); c.moveTo(-len * 0.55, th / 2); c.lineTo(-len * 0.7, th * 1.1); c.lineTo(-len * 0.35, th / 2); c.fill();
  if (flame) { c.save(); c.globalCompositeOperation = 'lighter'; const f = 6 + Math.sin(t * 60) * 2; c.drawImage(glowSprite(flame), -len * 0.55 - f * 1.6, -f * 0.6, f * 1.8, f * 1.2); c.restore(); }
}
function drawEntityBody(c, e, t, held) {
  switch (e.k) {
    case 'bullet': c.fillStyle='#ffe7a4'; c.fillRect(-4,-.7,8,1.4); break;
    case 'plasma':
      c.save(); c.shadowColor='#73eaff'; c.shadowBlur=18; c.fillStyle='#80e6ff'; circ(c,0,0,6); c.fillStyle='#fff'; circ(c,-1,-1,3);
      c.strokeStyle='#ba9bff';c.lineWidth=1.5;c.beginPath();c.ellipse(0,0,10,4,t*6,0,TAU);c.stroke();c.restore();break;
    case 'rocket': drawRocketShape(c, '#5f7a45', '#d33', 15, 5, t, '#ffae3a'); break;
    case 'homing': drawRocketShape(c, '#e6edf5', '#2a7cff', 15, 5, t, e.s ? '#7fd0ff' : '#ffae3a'); break;
    case 'mini': drawRocketShape(c, '#8a8f5a', '#e5a02a', 10, 3.5, t, '#ffae3a'); break;
    case 'nukem': c.scale(2.2, 2.2); drawRocketShape(c, '#e8e8e8', '#e8c43a', 16, 6, t, '#ffd070'); c.fillStyle = '#222'; circ(c, -1, 0, 1.8); break;
    case 'drill': {
      drawRocketShape(c, '#d9a21a', '#777', 14, 5, t, e.s ? null : '#ffae3a');
      c.fillStyle = '#8a8f99'; c.beginPath(); c.moveTo(6, -3); c.lineTo(13, 0); c.lineTo(6, 3); c.closePath(); c.fill();
      c.strokeStyle = '#444'; c.lineWidth = 0.8; for (let i = 0; i < 3; i++) { const o = ((t * 30 + i * 2.3) % 7); c.beginPath(); c.moveTo(6 + o, -3 + o * 0.42); c.lineTo(6 + o + 1.5, 3 - o * 0.42); c.stroke(); }
      break;
    }
    case 'mortar': c.fillStyle = '#3a3f46'; c.beginPath(); c.ellipse(0, 0, 6.5, 3.6, 0, 0, TAU); c.fill(); c.fillStyle = '#c9a23a'; c.fillRect(-1.5, -3.5, 2.2, 7); c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(-4, -2.4, 7, 1); break;
    case 'frag': case 'bomblet': c.fillStyle = e.k === 'frag' ? '#5a4a3a' : '#2a2a2a'; circ(c, 0, 0, e.k === 'frag' ? 2.2 : 2.8); c.fillStyle = '#ff5a2a'; circ(c, 0.6, -0.6, 0.9); break;
    case 'bomb': c.fillStyle = '#3a4a2a'; c.beginPath(); c.ellipse(0, 0, 6.5, 3.3, 0, 0, TAU); c.fill(); c.fillStyle = '#222'; c.beginPath(); c.moveTo(-5, 0); c.lineTo(-9, -3.5); c.lineTo(-9, 3.5); c.closePath(); c.fill(); break;
    case 'grenade': case 'cluster': {
      c.rotate(e.a || 0);
      c.fillStyle = e.k === 'grenade' ? '#3f5a2a' : '#8a2a2a'; c.beginPath(); c.ellipse(0, 0.5, 4.2, 5, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-4, 0.5); c.lineTo(4, 0.5); c.moveTo(0, -4.4); c.lineTo(0, 5.4); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.3)'; circ(c, -1.5, -1.5, 1.2);
      c.fillStyle = '#8a8f99'; c.fillRect(-1.6, -6.4, 3.2, 2.2); c.fillRect(1, -6, 3.4, 1);
      c.strokeStyle = '#b8bec8'; c.lineWidth = 0.7; c.beginPath(); c.arc(-2.4, -6, 1.3, 0, TAU); c.stroke();
      break;
    }
    case 'sticky': {
      const blink = held ? 0 : (Math.sin(t * (e.f < 1 ? 30 : 12)) > 0);
      c.fillStyle = '#46b83a'; c.beginPath(); c.ellipse(0, 0, 4.8, 4, 0, 0, TAU); c.fill();
      c.fillStyle = '#7ee06a'; circ(c, -1.5, -1.3, 1.4); c.fillStyle = '#2f8a2a'; circ(c, 2.5, 3, 1.5); circ(c, -3, 3.2, 1);
      c.fillStyle = blink ? '#ff3a3a' : '#7a1010'; circ(c, 1, -1, 1.1);
      break;
    }
    case 'molotov': {
      c.rotate(e.a || 0);
      c.fillStyle = 'rgba(120,70,20,0.9)'; rrect(c, -3, -3, 6.5, 9, 2); c.fill(); c.fillRect(-1.2, -7, 2.4, 4.5);
      c.fillStyle = 'rgba(255,200,120,0.5)'; c.fillRect(-2, -1, 1.2, 5);
      c.fillStyle = '#e8dcc0'; c.fillRect(-1.6, -9, 3.2, 2.6);
      c.save(); c.globalCompositeOperation = 'lighter'; const f = 4 + Math.sin(t * 40) * 1.2; c.drawImage(glowSprite('#ffa22a'), -f, -9 - f * 1.6, f * 2, f * 2.2); c.restore();
      break;
    }
    case 'bholeg': {
      const g = c.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, 5); g.addColorStop(0, '#f0c0ff'); g.addColorStop(0.5, '#8a3aff'); g.addColorStop(1, '#2a0a4a');
      c.fillStyle = g; circ(c, 0, 0, 5);
      c.strokeStyle = 'rgba(220,180,255,0.8)'; c.lineWidth = 0.9; c.beginPath(); c.arc(0, 0, 3.2, t * 6, t * 6 + 2.4); c.stroke();
      break;
    }
    case 'dynamite': {
      for (let i = -1; i <= 1; i++) { c.fillStyle = i ? '#c42a2a' : '#d93a3a'; rrect(c, i * 3.1 - 1.5, -6, 3, 11, 1); c.fill(); }
      c.fillStyle = '#2a2a2a'; c.fillRect(-5, -2, 10, 2); c.fillRect(-5, 2, 10, 1.4);
      c.strokeStyle = '#5a4a3a'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(0, -6); c.quadraticCurveTo(2, -9, 3.5, -9.5); c.stroke();
      if (!held) { c.save(); c.globalCompositeOperation = 'lighter'; const f = 3 + Math.random() * 2; c.drawImage(glowSprite('#ffe06a'), 3.5 - f, -9.5 - f, f * 2, f * 2); c.restore(); }
      break;
    }
    case 'mine': {
      c.fillStyle = '#3a3e36'; c.beginPath(); c.ellipse(0, 1, 6.5, 2.2, 0, 0, TAU); c.fill();
      c.fillStyle = '#4e5448'; c.beginPath(); c.arc(0, 1, 4.6, Math.PI, 0); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(-3, -1.8, 2.5, 1);
      const rate = e.s === 2 ? 14 : e.s === 1 ? 2 : 6; const on = held || Math.sin(t * rate * Math.PI) > 0.2;
      const lc = e.s === 0 ? '#ffd23a' : '#ff2a2a';
      c.fillStyle = on ? lc : '#3a1010'; circ(c, 0, -2.2, 1.2);
      if (on && !held) { c.save(); c.globalCompositeOperation = 'lighter'; c.drawImage(glowSprite(lc), -6, -8.2, 12, 12); c.restore(); }
      break;
    }
    case 'robot': {
      const dir = e.a >= 0 ? 1 : -1; const walk = e.s ? 0 : Math.sin((e.x || 0) * 0.35);
      c.scale(dir, 1);
      c.strokeStyle = '#3a3e46'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-2, -4); c.lineTo(-2 + walk * 2.5, 0); c.moveTo(2, -4); c.lineTo(2 - walk * 2.5, 0); c.stroke();
      c.fillStyle = '#9aa3b5'; rrect(c, -5.5, -13, 11, 9.5, 2.5); c.fill();
      c.fillStyle = '#c0392b'; circ(c, -2.5, -8, 2.4); c.fillStyle = '#222'; c.fillRect(-3, -9, 1, 2); c.fillRect(-3.5, -8.5, 2, 1);
      c.fillStyle = '#1a2a3a'; c.fillRect(1, -11.5, 4, 3); c.fillStyle = '#5ff4ff'; c.fillRect(2.5, -10.8, 1.5, 1.6);
      c.strokeStyle = '#555'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(0, -13); c.lineTo(1, -17); c.stroke();
      c.fillStyle = (Math.sin(t * 16) > 0) ? '#ff3030' : '#601010'; circ(c, 1, -17.5, 1.2);
      break;
    }
    case 'crate': {
      if (e.v) {
        c.strokeStyle = 'rgba(240,240,240,0.8)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(-8, -8); c.lineTo(-15, -30); c.moveTo(8, -8); c.lineTo(15, -30); c.moveTo(0, -9); c.lineTo(0, -34); c.stroke();
        c.fillStyle = '#e8e8e8'; c.beginPath(); c.moveTo(-20, -28); c.quadraticCurveTo(0, -52, 20, -28); c.quadraticCurveTo(0, -34, -20, -28); c.fill();
        c.fillStyle = e.s ? '#3a7ad8' : '#d83a3a'; c.beginPath(); c.moveTo(-7, -31.5); c.quadraticCurveTo(0, -48, 7, -31.5); c.quadraticCurveTo(0, -33.5, -7, -31.5); c.fill();
      }
      c.fillStyle = '#b07a3a'; c.fillRect(-9, -9, 18, 18);
      c.fillStyle = '#8a5a2a'; c.fillRect(-9, -3.5, 18, 1.3); c.fillRect(-9, 3, 18, 1.3);
      c.strokeStyle = '#5a3a1a'; c.lineWidth = 1.6; c.strokeRect(-8.2, -8.2, 16.4, 16.4);
      c.beginPath(); c.moveTo(-8, -8); c.lineTo(8, 8); c.stroke();
      if (e.s === 0) { c.fillStyle = '#fff'; c.fillRect(-4.5, -2, 9, 4.6); c.fillRect(-2.2, -4.4, 4.6, 9); c.fillStyle = '#e53935'; c.fillRect(-3.5, -1, 7, 2.6); c.fillRect(-1.3, -3.4, 2.6, 7); }
      else { c.fillStyle = '#ffd23a'; c.font = `bold 11px ${FONT_TITLE}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', 0, 0.5); }
      break;
    }
    case 'tomb': {
      c.fillStyle = '#8a8f99'; c.beginPath(); c.moveTo(-6.5, 8); c.lineTo(-6.5, -4); c.arc(0, -4, 6.5, Math.PI, 0); c.lineTo(6.5, 8); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(-5, -4, 2, 11);
      c.fillStyle = '#5a5f69'; c.fillRect(-0.9, -7, 1.8, 9); c.fillRect(-3, -4.6, 6, 1.8);
      c.fillStyle = e.teamColor || '#fff'; c.fillRect(-6.5, 5, 13, 2);
      break;
    }
    case 'storm': {
      const grow = clamp((1.7 - (e.f || 0)) / 0.9, 0.25, 1); const R = 26 + 44 * grow;
      c.strokeStyle = 'rgba(170,190,230,0.45)'; c.lineWidth = 1; c.beginPath();
      for (let i = 0; i < 16; i++) { const rx = -R + (i / 15) * 2 * R + ((t * 90 + i * 17) % 12); const ry = R * 0.25 + ((t * 420 + i * 37) % 180); c.moveTo(rx, ry); c.lineTo(rx - 3, ry + 13); }
      c.stroke();
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; c.fillStyle = i % 2 ? '#39404f' : '#2b303d'; circ(c, Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.28, R * 0.44); }
      const g = c.createLinearGradient(0, -R * 0.6, 0, R * 0.4); g.addColorStop(0, '#6b7488'); g.addColorStop(1, '#343a48');
      c.fillStyle = g; circ(c, -R * 0.22, -R * 0.18, R * 0.5); circ(c, R * 0.28, -R * 0.22, R * 0.44); circ(c, 0, -R * 0.02, R * 0.46);
      break;
    }
    case 'jet': {
      c.scale(e.a > 1.5 || e.a < -1.5 ? -1 : 1, 1); c.scale(1.6, 1.6);
      c.fillStyle = '#6f7a8a'; c.beginPath(); c.moveTo(-22, -3); c.lineTo(14, -4); c.quadraticCurveTo(24, -2, 26, 0); c.quadraticCurveTo(22, 2, 14, 3); c.lineTo(-22, 3); c.closePath(); c.fill();
      c.fillStyle = '#56606e'; c.beginPath(); c.moveTo(-2, 0); c.lineTo(-12, 12); c.lineTo(-6, 12); c.lineTo(6, 1); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(-18, -2); c.lineTo(-24, -12); c.lineTo(-19, -12); c.lineTo(-12, -2); c.closePath(); c.fill();
      c.fillStyle = '#9fd0ff'; c.beginPath(); c.ellipse(10, -3.5, 5, 2, 0, 0, TAU); c.fill();
      c.save(); c.globalCompositeOperation = 'lighter'; c.drawImage(glowSprite('#ffa23a'), -34, -5, 14, 10); c.restore();
      break;
    }
  }
}
const ADDITIVE_KINDS = new Set(['fire', 'flame', 'bhole', 'orbital']);
function drawEntity(c, e, t, sc) {
  if (ADDITIVE_KINDS.has(e.k)) return;
  c.save(); c.translate(e.x, e.y);
  const rot = ['rocket', 'homing', 'mini', 'nukem', 'drill', 'mortar', 'bomb'].includes(e.k);
  if (rot) c.rotate(e.a || 0);
  if (e.k === 'tomb' && sc) e.teamColor = sc.teams[e.team] ? sc.teams[e.team].color : '#fff';
  drawEntityBody(c, e, t, false);
  c.restore();
  if ((e.k === 'grenade' || e.k === 'cluster' || e.k === 'sticky' || e.k === 'dynamite' || e.k === 'bholeg') && e.f > 0 && e.f < 60) {
    c.save(); c.font = `12px ${FONT_TITLE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    textOutlined(c, String(Math.ceil(e.f)), e.x, e.y - 13, e.f < 1.5 ? '#ff5a4a' : '#fff', 'rgba(0,0,0,0.8)', 3); c.restore();
  }
}
function drawEntityAdditive(c, e, t, sc) {
  switch (e.k) {
    case 'storm': if (Math.sin(t * 23 + e.id) > 0.93 || (e.f < 0.4 && Math.random() < 0.3)) { c.globalAlpha = 0.8; c.drawImage(glowSprite('#bfe0ff'), e.x - 70, e.y - 40, 140, 80); c.globalAlpha = 1; } break;
    case 'fire': { const s = (e.v || 100) / 100 * (7 + Math.sin(t * 20 + e.id) * 1.5); const k = clamp(e.f / 1.5, 0.3, 1);
      c.globalAlpha = k; c.drawImage(glowSprite('#ff7a1a'), e.x - s * 1.4, e.y - s * 2.2, s * 2.8, s * 2.6);
      c.drawImage(glowSprite('#ffe06a'), e.x - s * 0.6, e.y - s * 1.3, s * 1.2, s * 1.4); c.globalAlpha = 1; break; }
    case 'flame': { const k = clamp(e.f / 0.55, 0, 1); const s = 4 + (1 - k) * 9; const col = k > 0.6 ? '#fff0a0' : k > 0.3 ? '#ffa22a' : '#e8401a';
      c.globalAlpha = Math.min(1, k * 1.8); c.drawImage(glowSprite(col), e.x - s, e.y - s, s * 2, s * 2); c.globalAlpha = 1; break; }
    case 'bhole': {
      const g = (e.v || 0) / 100; const R = 10 + g * 16;
      c.drawImage(glowSprite('#8a3aff'), e.x - R * 5, e.y - R * 5, R * 10, R * 10);
      c.save(); c.translate(e.x, e.y);
      for (let i = 0; i < 3; i++) { c.save(); c.rotate(t * (3 + i) + i * 2); c.scale(1, 0.35); c.strokeStyle = ['rgba(220,160,255,0.8)', 'rgba(140,90,255,0.6)', 'rgba(255,255,255,0.7)'][i]; c.lineWidth = 3 - i * 0.7; c.beginPath(); c.arc(0, 0, R * (1.6 + i * 0.45), 0, TAU * 0.8); c.stroke(); c.restore(); }
      c.restore(); break;
    }
    case 'orbital': {
      if (e.s === 0) {
        const bl = Math.sin(t * 20) > 0; c.strokeStyle = bl ? 'rgba(255,60,220,0.95)' : 'rgba(255,60,220,0.4)'; c.lineWidth = 2;
        c.beginPath(); c.arc(e.x, e.v, 22, 0, TAU); c.moveTo(e.x - 30, e.v); c.lineTo(e.x + 30, e.v); c.moveTo(e.x, e.v - 30); c.lineTo(e.x, e.v + 30); c.stroke();
        c.strokeStyle = 'rgba(255,90,230,0.25)'; c.lineWidth = 1; c.beginPath(); c.moveTo(e.x, e.v - 3000); c.lineTo(e.x, e.v); c.stroke();
      } else {
        const w = 14 + Math.sin(t * 50) * 3;
        const g = c.createLinearGradient(e.x - w * 2, 0, e.x + w * 2, 0); g.addColorStop(0, 'rgba(255,40,200,0)'); g.addColorStop(0.3, 'rgba(255,60,210,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,0.95)'); g.addColorStop(0.7, 'rgba(255,60,210,0.55)'); g.addColorStop(1, 'rgba(255,40,200,0)');
        c.fillStyle = g; c.fillRect(e.x - w * 2, e.v - 4000, w * 4, 4000);
        c.drawImage(glowSprite('#ff5ae0'), e.x - 60, e.v - 60, 120, 120);
      }
      break;
    }
  }
}

/* ---------- анимированные объекты карт ---------- */
function drawProps(c, sc, t, additive) {
  for (const p of sc.props || []) {
    if (!p.alive) continue;
    switch (p.kind) {
      case 'windmill': if (additive) break; {
        const hx = p.x, hy = p.y - 101; c.save(); c.translate(hx, hy); c.rotate(t * 0.7);
        for (let i = 0; i < 4; i++) {
          c.rotate(TAU / 4); c.fillStyle = '#5a3a22'; c.fillRect(-1.2, 0, 2.4, 52);
          c.fillStyle = 'rgba(245,235,215,0.92)'; c.fillRect(1.5, 12, 10, 40);
          c.strokeStyle = 'rgba(90,60,30,0.6)'; c.lineWidth = 0.8; for (let k = 16; k < 52; k += 8) { c.beginPath(); c.moveTo(1.5, k); c.lineTo(11.5, k); c.stroke(); }
        }
        c.fillStyle = '#3a2a1a'; circ(c, 0, 0, 3.4); c.restore(); break;
      }
      case 'flag': if (additive) break; {
        const h = p.o.h || 60; const col = p.o.team !== undefined && sc.teams[p.o.team] ? sc.teams[p.o.team].color : (p.o.color || '#c33');
        c.strokeStyle = '#3a2a1a'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - h); c.stroke();
        const wind = sc.turn ? sc.turn.wind : 0; const dir = wind < -5 ? -1 : 1; const L = 26, H = 16;
        c.fillStyle = col; c.beginPath(); c.moveTo(p.x, p.y - h);
        for (let i = 0; i <= 8; i++) { const u = i / 8; c.lineTo(p.x + dir * u * L, p.y - h + Math.sin(t * 6 + u * 5 + p.seed) * 2.4 * u); }
        for (let i = 8; i >= 0; i--) { const u = i / 8; c.lineTo(p.x + dir * u * L, p.y - h + H + Math.sin(t * 6 + u * 5 + p.seed) * 2.4 * u); }
        c.closePath(); c.fill();
        if (p.o.skull) { c.fillStyle = '#fff'; circ(c, p.x + dir * 12, p.y - h + 7, 3.4); c.fillRect(p.x + dir * 12 - 2, p.y - h + 9, 4, 3); c.fillStyle = '#111'; circ(c, p.x + dir * 12 - 1.2, p.y - h + 6.5, 0.9); circ(c, p.x + dir * 12 + 1.2, p.y - h + 6.5, 0.9); }
        break;
      }
      case 'torch': {
        const f = 1 + Math.sin(t * 18 + p.seed) * 0.15 + Math.sin(t * 31 + p.seed) * 0.1;
        if (!additive) { c.fillStyle = '#5a3a22'; c.fillRect(p.x - 1.5, p.y - 22, 3, 22); c.fillStyle = '#3a2a1a'; c.fillRect(p.x - 3, p.y - 24, 6, 3); }
        else { c.drawImage(glowSprite('#ff8a2a'), p.x - 14 * f, p.y - 40 * f, 28 * f, 30 * f); c.drawImage(glowSprite('#fff0a0'), p.x - 4, p.y - 32, 8, 10); }
        break;
      }
      case 'fire': {
        const f = 1 + Math.sin(t * 17 + p.seed) * 0.15;
        if (!additive) { c.fillStyle = '#4a4e56'; c.fillRect(p.x - 7, p.y - 18, 14, 18); c.fillStyle = '#2a2e36'; c.fillRect(p.x - 7.5, p.y - 19, 15, 2); }
        else { c.drawImage(glowSprite('#ff7a1a'), p.x - 16 * f, p.y - 44 * f, 32 * f, 30 * f); c.drawImage(glowSprite('#ffd35a'), p.x - 7, p.y - 32, 14, 14); }
        break;
      }
      case 'lamp': if (additive) { const hx = p.x + 15, hy = p.y - 80; c.drawImage(glowSprite('#ffe7a8'), hx - 22, hy - 16, 44, 32); const g = c.createLinearGradient(0, hy, 0, p.y); g.addColorStop(0, 'rgba(255,231,168,0.22)'); g.addColorStop(1, 'rgba(255,231,168,0)'); c.fillStyle = g; c.beginPath(); c.moveTo(hx - 4, hy); c.lineTo(hx + 4, hy); c.lineTo(hx + 34, p.y); c.lineTo(hx - 34, p.y); c.closePath(); c.fill(); } break;
      case 'neon': {
        const on = Math.sin(t * 2 + p.seed) > -0.92 || Math.random() < 0.3;
        c.save(); c.font = `bold 20px ${FONT_TITLE}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        if (!additive) { c.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.3)'; c.fillText(p.o.text || 'НЕОН', p.x, p.y - 43); }
        else if (on) { c.shadowColor = p.o.color; c.shadowBlur = 16; c.fillStyle = p.o.color; c.fillText(p.o.text || 'НЕОН', p.x, p.y - 43); c.fillText(p.o.text || 'НЕОН', p.x, p.y - 43); }
        c.restore(); break;
      }
      case 'beacon': if (additive && Math.sin(t * 3 + p.seed) > 0.3) { c.drawImage(glowSprite('#ff3030'), p.x - 12, p.y - 12, 24, 24); c.fillStyle = '#fff'; circ(c, p.x, p.y, 1.4); } break;
    }
  }
}
