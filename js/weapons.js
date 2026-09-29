'use strict';
/* =========================================================
   Арсенал: описания оружия, иконки и спрайты в руках
   mode: charge — зажать для силы; instant — сразу; target — клик по карте;
         tcharge — сначала цель, потом зарядка; drop — положить; place — установить;
         self — применить на себя; active — включить/выключить
   ========================================================= */
const WEAPON_CATS = ['Ракеты', 'Гранаты', 'Огнестрел', 'Взрывчатка', 'С воздуха', 'Снаряжение'];
const WEAPONS = [
  { id: 'assault', name: 'Штурмовая винтовка', cat: 2, ammo: -1, mode: 'instant', desc: 'Очередь из пяти пуль. Прицел можно вести; эффективна на средней дистанции.' },
  { id: 'revolver', name: 'Револьвер «Шериф»', cat: 2, ammo: 3, mode: 'instant', shots: 3, desc: 'Три точных выстрела по 18 урона за ход. Между выстрелами можно сменить цель.' },
  { id: 'plasma', name: 'Плазменная пушка', cat: 0, ammo: 3, mode: 'charge', desc: 'Энергетический шар рикошетит от стен и взрывается при контакте с бойцом или через 3 секунды.' },
  { id: 'autocannon', name: 'Автопушка', cat: 0, ammo: 2, mode: 'instant', desc: 'Три скоростных разрывных снаряда. Небольшая дуга и три отдельных взрыва.' },
  { id: 'tesla', name: 'Тесла-карабин', cat: 2, ammo: 2, mode: 'instant', desc: 'Направленный разряд: 32 урона цели, затем цепь до двух соседей. Сквозь стены не стреляет.' },
  { id: 'repulsor', name: 'Импульсная пушка', cat: 2, ammo: 2, mode: 'instant', desc: 'Конус ударной волны. Отбрасывает противников на ближней дистанции, сохраняя ландшафт.' },
  { id: 'bazooka', name: 'Базука', cat: 0, ammo: -1, mode: 'charge', desc: 'Ракета летит по дуге и сносится ветром. Взрыв при попадании.' },
  { id: 'homing', name: 'Самонаводка', cat: 0, ammo: 2, mode: 'tcharge', desc: 'Кликните по цели и стреляйте. Головка захватывает цель с ошибкой и поворачивает плавно — за угол не залетит.' },
  { id: 'mortar', name: 'Миномёт', cat: 0, ammo: 3, mode: 'charge', desc: 'Тяжёлый снаряд, после взрыва разлетается осколками.' },
  { id: 'drill', name: 'Бур-ракета', cat: 0, ammo: 2, mode: 'charge', desc: 'Пробуривает землю насквозь и взрывается глубоко внутри.' },
  { id: 'salvo', name: 'Ракетный залп', cat: 0, ammo: 1, mode: 'charge', desc: 'Пять ракет подряд с небольшим разбросом.' },
  { id: 'grenade', name: 'Граната', cat: 1, ammo: -1, mode: 'charge', desc: 'Отскакивает от стен и взрывается через 3 секунды.' },
  { id: 'cluster', name: 'Кассетная граната', cat: 1, ammo: 3, mode: 'charge', desc: 'Взрывается и разбрасывает пять мини-бомб.' },
  { id: 'sticky', name: 'Липучка', cat: 1, ammo: 2, mode: 'charge', desc: 'Прилипает к земле или к бойцу и взрывается через 2.5 секунды.' },
  { id: 'molotov', name: 'Коктейль Молотова', cat: 1, ammo: 2, mode: 'charge', desc: 'Разбивается и заливает всё вокруг огнём.' },
  { id: 'blackhole', name: 'Чёрная дыра', cat: 1, ammo: 1, mode: 'charge', desc: 'Открывает сингулярность: затягивает бойцов и пожирает землю.' },
  { id: 'shotgun', name: 'Дробовик', cat: 2, ammo: -1, mode: 'instant', shots: 2, desc: 'Два выстрела за ход. Дробь сильно бьёт вблизи.' },
  { id: 'sniper', name: 'Снайперка', cat: 2, ammo: 3, mode: 'instant', desc: 'Мощный выстрел, хедшот — больше урона. Прицел качается от дыхания: Shift ненадолго задерживает дыхание.' },
  { id: 'minigun', name: 'Миниган', cat: 2, ammo: 2, mode: 'instant', desc: 'Шквал пуль. Прицел можно вести во время стрельбы.' },
  { id: 'flamer', name: 'Огнемёт', cat: 2, ammo: 2, mode: 'instant', desc: 'Струя огня на ближней дистанции, поджигает землю.' },
  { id: 'railgun', name: 'Рельсотрон', cat: 2, ammo: 1, mode: 'instant', desc: 'Луч пробивает землю и всех бойцов на своём пути.' },
  { id: 'dynamite', name: 'Динамит', cat: 3, ammo: 2, mode: 'drop', desc: 'Бросьте под ноги и бегите: мощный взрыв через 4 секунды.' },
  { id: 'mine', name: 'Мина', cat: 3, ammo: 3, mode: 'drop', desc: 'Взводится за 2 секунды и срабатывает, если кто-то подойдёт.' },
  { id: 'robot', name: 'Робо-бомба', cat: 3, ammo: 1, mode: 'drop', desc: 'Шагает вперёд и перепрыгивает препятствия. Повторное нажатие — взрыв.' },
  { id: 'bat', name: 'Бейсбольная бита', cat: 3, ammo: -1, mode: 'instant', desc: 'Удар вблизи: противник улетает далеко-далеко.' },
  { id: 'airstrike', name: 'Авиаудар', cat: 4, ammo: 1, mode: 'target', desc: 'Кликом задаёте курс. Бомбы сбрасываете сами (ЛКМ) — берите упреждение на скорость самолёта и ветер.' },
  { id: 'lightning', name: 'Молния', cat: 4, ammo: 1, mode: 'target', desc: 'Над точкой собирается туча, её сносит ветром. Молния бьёт в самую высокую точку под тучей и перескакивает на соседей.' },
  { id: 'orbital', name: 'Орбитальный лазер', cat: 4, ammo: 1, mode: 'target', desc: 'Спутник наводится с ошибкой. Пока луч прожигает землю, ведите его клавишами A/D.' },
  { id: 'nuke', name: 'Ядерный удар', cat: 4, ammo: 1, mode: 'target', minRound: 3, desc: 'Огромный взрыв. Ракету сносит ветром, разброс около 60 м. Доступен с 3-го раунда.' },
  { id: 'teleport', name: 'Телепорт', cat: 5, ammo: 2, mode: 'target', ends: true, desc: 'Мгновенное перемещение в любую свободную точку. Завершает ход.' },
  { id: 'jetpack', name: 'Джетпак', cat: 5, ammo: 2, mode: 'active', free: true, desc: 'Полёт: W/↑ или пробел — вверх, A/D — в стороны. Ход продолжается.' },
  { id: 'girder', name: 'Балка', cat: 5, ammo: 3, mode: 'place', free: true, desc: 'Постройте стальную балку. R — повернуть. Ход продолжается.' },
  { id: 'medkit', name: 'Аптечка', cat: 5, ammo: 1, mode: 'self', desc: 'Лечит бойца на 35 здоровья.' },
  { id: 'skip', name: 'Пропуск хода', cat: 5, ammo: -1, mode: 'self', ends: true, desc: 'Передать ход сопернику.' },
];
const WEAPON = Object.fromEntries(WEAPONS.map((w, i) => [w.id, Object.assign(w, { idx: i })]));
const CLASSIC = ['bazooka', 'grenade', 'cluster', 'shotgun', 'sniper', 'dynamite', 'mine', 'bat', 'airstrike', 'teleport', 'girder', 'skip'];

function makeAmmo(arsenal) {
  const a = {};
  for (const w of WEAPONS) if (arsenal !== 'classic' || CLASSIC.includes(w.id)) a[w.id] = w.ammo;
  return a;
}

/* ---------- рисование оружия в руках (начало координат — рукоять, ствол вдоль +x) ---------- */
function drawHeld(c, id, t = 0) {
  const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  switch (id) {
    case 'assault': R(-11,-2,8,5,'#6d7960'); R(-3,-3,16,5,'#343f43'); R(13,-2,12,2,'#151d22'); R(2,2,4,7,'#556250'); R(-3,-5,7,2,'#85947b'); break;
    case 'revolver': R(-4,-3,8,6,'#bfc9c6'); R(3,-3,15,3,'#879893'); R(-5,2,4,7,'#975f39'); R(-2,-1,5,2,'#505f5e'); break;
    case 'plasma': case 'tesla': case 'repulsor': {
      const col = id === 'plasma' ? '#9df1ff' : id === 'tesla' ? '#b9a1ff' : '#f0e991';
      R(-9,-4,24,8,'#304855'); R(-7,-4,19,1,'#829a9c'); R(-2,4,4,4,'#263437');
      R(12,-5,5,10,'#789492'); R(17,-2,5,4,col);
      c.fillStyle=col; for(let i=0;i<3;i++)c.fillRect(-5+i*5,-2,2,4); break;
    }
    case 'autocannon': R(-11,-5,20,10,'#666653'); R(9,-3,15,6,'#252e30'); R(15,-4,4,8,'#929280'); R(-3,5,5,6,'#343f42'); R(-8,-4,4,8,'#d3ac6b'); break;
    case 'bazooka': case 'homing': case 'drill': case 'mortar': {
      const col = { bazooka: '#4f6b3a', homing: '#dfe6ee', drill: '#d9a21a', mortar: '#3a3f46' }[id];
      const L = id === 'mortar' ? 18 : 22, th = id === 'mortar' ? 6 : 4.6;
      R(-8, -th / 2, L, th, col); R(-8, -th / 2, L, 1.2, 'rgba(255,255,255,0.35)');
      R(L - 9, -th / 2 - 0.8, 2.5, th + 1.6, '#222'); R(-9, -th / 2 - 0.6, 2.2, th + 1.2, '#222');
      if (id === 'homing') { R(2, -th / 2 - 3, 5, 3, '#2a8cff'); }
      if (id === 'drill') { c.fillStyle = '#222'; for (let i = 0; i < 4; i++) c.fillRect(-4 + i * 4, -th / 2, 2, th); }
      R(0, th / 2, 2.5, 3, '#333');
      break;
    }
    case 'salvo': R(-6, -4, 18, 8, '#5a5f3a'); c.fillStyle = '#222'; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.beginPath(); c.arc(12, -2 + j * 4, 1.4, 0, TAU); c.fill(); } R(0, 4, 2.5, 3, '#333'); break;
    case 'shotgun': R(-9, -1.6, 7, 3.6, '#6b4226'); R(-2, -1.8, 18, 2.2, '#2a2a2a'); R(-2, 0.4, 14, 1.8, '#3a3a3a'); R(4, 0.3, 6, 2.6, '#6b4226'); break;
    case 'sniper': R(-10, -1.5, 8, 3.4, '#3a2a1a'); R(-2, -1.4, 26, 2, '#1e1e1e'); R(0, -4.6, 9, 2.8, '#2a2a2a'); c.fillStyle = '#ff3030'; c.fillRect(8.5, -4, 1, 1.6); R(0, 0.6, 2, 3.5, '#2a2a2a'); break;
    case 'minigun': R(-6, -3.5, 10, 7, '#3a3f46'); c.fillStyle = '#1e1e1e'; for (let i = 0; i < 3; i++) c.fillRect(4, -2.6 + i * 2, 13, 1.4); R(-2, 3.5, 3, 3, '#222'); R(2, 2, 3, 3, '#caa23a'); break;
    case 'flamer': R(-8, -2, 20, 3.6, '#5a5a5a'); R(-10, 1.6, 9, 6, '#c0392b'); R(12, -2.6, 3, 4.8, '#222'); c.fillStyle = `rgba(80,160,255,${0.6 + 0.4 * Math.sin(t * 30)})`; c.beginPath(); c.arc(16, -0.2, 1.4, 0, TAU); c.fill(); break;
    case 'railgun': R(-8, -3, 24, 6, '#2c3440'); R(-8, -3, 24, 1.4, '#5a6a80'); c.fillStyle = `rgba(80,240,255,${0.7 + 0.3 * Math.sin(t * 12)})`; for (let i = 0; i < 4; i++) c.fillRect(-4 + i * 5, -1, 3, 2); R(16, -2, 3, 4, '#111'); break;
    case 'bat': c.save(); c.rotate(-0.5); c.fillStyle = '#c8955a'; c.beginPath(); c.moveTo(-2, -1); c.lineTo(20, -2.6); c.quadraticCurveTo(23, 0, 20, 2.6); c.lineTo(-2, 1); c.closePath(); c.fill(); c.fillStyle = '#6b4226'; c.fillRect(-3, -1.2, 5, 2.4); c.restore(); break;
    case 'grenade': case 'cluster': case 'sticky': case 'blackhole': case 'mine': case 'dynamite': case 'molotov': case 'robot':
      c.save(); c.translate(3, 0); c.scale(0.8, 0.8); drawEntityBody(c, { k: { grenade: 'grenade', cluster: 'cluster', sticky: 'sticky', blackhole: 'bholeg', mine: 'mine', dynamite: 'dynamite', molotov: 'molotov', robot: 'robot' }[id], a: 0, f: 3, s: 0 }, t, true); c.restore(); break;
    case 'medkit': R(-1, -5, 11, 8, '#f2f2f2'); R(3, -4, 3, 6, '#e53935'); R(1.5, -2.5, 6, 3, '#e53935'); break;
    case 'skip': R(-1, -16, 1.4, 20, '#8a6a44'); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0.4, -16); c.quadraticCurveTo(7, -14 + Math.sin(t * 6) * 1.5, 12, -15); c.lineTo(12, -9); c.quadraticCurveTo(7, -8 + Math.sin(t * 6 + 1) * 1.5, 0.4, -10); c.closePath(); c.fill(); break;
    case 'girder': R(0, -5, 10, 8, '#3a8fd8'); R(1, -4, 8, 6, '#bfe2ff'); c.strokeStyle = '#3a8fd8'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(2, -1); c.lineTo(8, -1); c.moveTo(2, 1); c.lineTo(6, 1); c.stroke(); break;
    case 'jetpack': break;
    default: // пульт для ударов с воздуха и телепорта
      R(0, -4, 7, 9, '#2a2e36'); R(1, -3, 5, 3.5, id === 'teleport' ? '#b06cff' : '#4ff08a'); c.fillStyle = (t * 3 % 1) < 0.5 ? '#ff4040' : '#801010'; c.fillRect(2.5, 2, 2, 1.6); R(5, -9, 1, 5.5, '#555');
  }
}

/* ---------- иконки для панели оружия ---------- */
const _iconCache = new Map();
function weaponIcon(id, size = 44) {
  const key = id + size; if (_iconCache.has(key)) return _iconCache.get(key);
  const cv = makeCanvas(size, size); const c = cv.getContext('2d');
  c.translate(size / 2, size / 2); const k = size / 44; c.scale(k, k);
  const glow = (col) => { c.shadowColor = col; c.shadowBlur = 8; };
  switch (id) {
    case 'airstrike':
      c.fillStyle = '#b8c2d0'; c.beginPath(); c.moveTo(-16, -6); c.lineTo(10, -6); c.lineTo(16, -3); c.lineTo(10, 0); c.lineTo(-16, 0); c.closePath(); c.fill();
      c.fillStyle = '#8a95a6'; c.beginPath(); c.moveTo(-4, -4); c.lineTo(-10, -14); c.lineTo(-4, -14); c.lineTo(4, -4); c.closePath(); c.fill(); c.beginPath(); c.moveTo(-16, -6); c.lineTo(-18, -12); c.lineTo(-13, -12); c.lineTo(-10, -6); c.fill();
      c.fillStyle = '#333'; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(-8 + i * 7, 7 + i * 3, 2.2, 3.2, 0, 0, TAU); c.fill(); }
      break;
    case 'lightning': glow('#7fd8ff'); c.fillStyle = '#fff36b'; c.beginPath(); c.moveTo(3, -18); c.lineTo(-9, 2); c.lineTo(-1, 2); c.lineTo(-5, 18); c.lineTo(9, -4); c.lineTo(1, -4); c.lineTo(7, -18); c.closePath(); c.fill(); break;
    case 'orbital':
      c.fillStyle = '#9aa3b5'; c.fillRect(-5, -16, 10, 7); c.fillStyle = '#3a6ad8'; c.fillRect(-15, -15, 9, 5); c.fillRect(6, -15, 9, 5);
      glow('#ff4fd8'); c.fillStyle = 'rgba(255,90,220,0.9)'; c.fillRect(-2, -9, 4, 24); c.fillStyle = '#fff'; c.fillRect(-0.8, -9, 1.6, 24); break;
    case 'nuke':
      c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(0, 0, 17, 0, TAU); c.fill(); c.fillStyle = '#1a1a1a';
      for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 14, a - 0.5, a + 0.5); c.closePath(); c.fill(); }
      c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(0, 0, 4.5, 0, TAU); c.fill(); c.fillStyle = '#1a1a1a'; c.beginPath(); c.arc(0, 0, 3, 0, TAU); c.fill(); break;
    case 'teleport':
      glow('#c07cff'); for (let i = 0; i < 3; i++) { c.strokeStyle = ['#e0b0ff', '#b06cff', '#7a3fd0'][i]; c.lineWidth = 2.5; c.beginPath(); c.arc(0, 0, 15 - i * 5, i, i + 4.5); c.stroke(); } break;
    case 'jetpack':
      c.fillStyle = '#5a6270'; rrect(c, -10, -12, 9, 20, 4); c.fill(); rrect(c, 1, -12, 9, 20, 4); c.fill(); c.fillStyle = '#c0392b'; c.fillRect(-9, -8, 7, 3); c.fillRect(2, -8, 7, 3);
      glow('#ffa23a'); c.fillStyle = '#ffb347'; c.beginPath(); c.moveTo(-9, 8); c.lineTo(-5.5, 18); c.lineTo(-2, 8); c.fill(); c.beginPath(); c.moveTo(2, 8); c.lineTo(5.5, 18); c.lineTo(9, 8); c.fill(); break;
    case 'girder': c.rotate(-0.4); drawGirder(c, 0, 0, 0, 38, 10); break;
    case 'medkit': c.fillStyle = '#f4f4f4'; rrect(c, -14, -10, 28, 22, 4); c.fill(); c.fillStyle = '#e53935'; c.fillRect(-3, -6, 6, 14); c.fillRect(-7, -2, 14, 6); c.fillStyle = '#9aa0a8'; c.fillRect(-5, -14, 10, 4); break;
    case 'skip': c.strokeStyle = '#e8eef6'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 13, 0.6, 5.6); c.stroke(); c.fillStyle = '#e8eef6'; c.beginPath(); c.moveTo(10, -11); c.lineTo(15, -1); c.lineTo(5, -3); c.fill(); c.fillRect(-1.5, -8, 3, 9); c.fillRect(-1.5, -1.5, 8, 3); break;
    default: {
      c.rotate(-0.35); c.scale(1.7, 1.7);
      if (['grenade', 'cluster', 'sticky', 'blackhole', 'mine', 'dynamite', 'molotov', 'robot'].includes(id)) { c.translate(-3, 0); c.scale(1.3, 1.3); }
      else c.translate(-5, 0);
      drawHeld(c, id, 0.3);
    }
  }
  _iconCache.set(key, cv); return cv;
}
