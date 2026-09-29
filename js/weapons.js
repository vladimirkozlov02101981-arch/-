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
  { id: 'magnum', name: 'Магнум', cat: 2, ammo: -1, mode: 'instant', desc: 'Бесконечный патрон. Один точный выстрел: 35 урона, в голову — 50. Пуля почти не падает.' },
  { id: 'uzi', name: 'Узи', cat: 2, ammo: 2, mode: 'instant', desc: 'Очередь из десяти пуль с заметным разбросом. Ствол можно вести во время стрельбы; лучше всего вблизи.' },
  { id: 'acid', name: 'Кислотомёт', cat: 2, ammo: 2, mode: 'instant', desc: 'Ближний бой: струя бьёт лишь на ~28 м. Кислота летит почти прямо и проходит сквозь землю и стены, задевая всех на пути. Урон небольшой; в конце струя опадает.' },
  { id: 'plasma', name: 'Плазменная пушка', cat: 0, ammo: 3, mode: 'charge', desc: 'Энергетический шар рикошетит от стен и взрывается при контакте с бойцом или через 3 секунды.' },
  { id: 'autocannon', name: 'Автопушка', cat: 0, ammo: 2, mode: 'instant', desc: 'Три скоростных разрывных снаряда. Небольшая дуга и три отдельных взрыва.' },
  { id: 'tesla', name: 'Тесла-карабин', cat: 2, ammo: 2, mode: 'instant', desc: 'Направленный разряд: 32 урона цели, затем цепь до двух соседей. Сквозь стены не стреляет.' },
  { id: 'repulsor', name: 'Импульсная пушка', cat: 2, ammo: 2, mode: 'instant', desc: 'Конус ударной волны. Отбрасывает противников на ближней дистанции, сохраняя ландшафт.' },
  { id: 'rpg', name: 'РПГ', cat: 0, ammo: 3, mode: 'instant', desc: 'Ракета летит прямо и без сноса ветром, но закручивается по спирали и примерно через секунду теряет управление. Вблизи смертельна.' },
  { id: 'bazooka', name: 'Базука', cat: 0, ammo: -1, mode: 'charge', desc: 'Ракета летит по дуге и сносится ветром. Взрыв при попадании.' },
  { id: 'homing', name: 'Самонаводка', cat: 0, ammo: 2, mode: 'tcharge', desc: 'Кликните по цели и стреляйте. Головка захватывает цель с ошибкой и поворачивает плавно — за угол не залетит.' },
  { id: 'mortar', name: 'Миномёт', cat: 0, ammo: 3, mode: 'charge', desc: 'Стреляет очень далеко. Мина отскакивает от стен и потолков и взрывается, коснувшись пола. Радиус как у гранаты, урон чуть выше.' },
  { id: 'drill', name: 'Бур-ракета', cat: 0, ammo: 2, mode: 'charge', desc: 'Пробуривает землю насквозь и взрывается глубоко внутри.' },
  { id: 'salvo', name: 'Ракетный залп', cat: 0, ammo: 1, mode: 'charge', desc: 'Пять ракет подряд с небольшим разбросом.' },
  { id: 'grenade', name: 'Граната', cat: 1, ammo: -1, mode: 'charge', desc: 'Отскакивает от стен и взрывается через 3 секунды. R — подкрутка вперёд/назад: после удара граната катится дальше или отскакивает назад.' },
  { id: 'cluster', name: 'Кассетная граната', cat: 1, ammo: 3, mode: 'charge', desc: 'Взрывается и разбрасывает пять мини-бомб.' },
  { id: 'sticky', name: 'Липучка', cat: 1, ammo: 2, mode: 'charge', desc: 'Прилипает к земле или к бойцу и взрывается через 2.5 секунды.' },
  { id: 'molotov', name: 'Коктейль Молотова', cat: 1, ammo: 2, mode: 'charge', desc: 'Разбивается и заливает всё вокруг огнём.' },
  { id: 'blackhole', name: 'Чёрная дыра', cat: 1, ammo: 1, mode: 'charge', desc: 'Открывает сингулярность: затягивает бойцов и пожирает землю.' },
  { id: 'shotgun', name: 'Дробовик', cat: 2, ammo: -1, mode: 'instant', shots: 2, desc: 'Два выстрела за ход. Дробь сильно бьёт вблизи.' },
  { id: 'sniper', name: 'Снайперка', cat: 2, ammo: 3, mode: 'instant', desc: 'Дальний выстрел: 45 урона, в голову — 60. Прицел качается от дыхания: Shift ненадолго задерживает дыхание.' },
  { id: 'minigun', name: 'Миниган', cat: 2, ammo: 2, mode: 'instant', desc: 'Шквал пуль. Прицел можно вести во время стрельбы.' },
  { id: 'flamer', name: 'Огнемёт', cat: 2, ammo: 2, mode: 'instant', desc: 'Струя огня на ближней дистанции, поджигает землю.' },
  { id: 'railgun', name: 'Рельсотрон', cat: 2, ammo: 1, mode: 'instant', desc: 'Луч пробивает землю и всех бойцов на своём пути.' },
  { id: 'dynamite', name: 'Динамит', cat: 3, ammo: 2, mode: 'drop', desc: 'Бросьте под ноги и бегите: мощный взрыв через 4 секунды.' },
  { id: 'mine', name: 'Мина', cat: 3, ammo: 3, mode: 'drop', desc: 'Взводится за 2 секунды и срабатывает, если кто-то подойдёт.' },
  { id: 'robot', name: 'Робо-бомба', cat: 3, ammo: 1, mode: 'drop', desc: 'Шагает вперёд и перепрыгивает препятствия. Повторное нажатие — взрыв.' },
  { id: 'boot', name: 'Ботинок', cat: 3, ammo: -1, mode: 'instant', desc: 'Пинок вплотную: 15 урона, противник улетает почти горизонтально — удобно сбрасывать с обрыва.' },
  { id: 'bat', name: 'Бейсбольная бита', cat: 3, ammo: -1, mode: 'instant', desc: 'Удар вблизи: противник улетает далеко-далеко.' },
  { id: 'airstrike', name: 'Авиаудар', cat: 4, ammo: 1, mode: 'target', desc: 'Кликом задаёте курс. Бомбы сбрасываете сами (ЛКМ) — берите упреждение на скорость самолёта и ветер.' },
  { id: 'lightning', name: 'Молния', cat: 4, ammo: 1, mode: 'target', desc: 'Над точкой собирается туча, её сносит ветром. Молния бьёт в самую высокую точку под тучей и перескакивает на соседей.' },
  { id: 'orbital', name: 'Орбитальный лазер', cat: 4, ammo: 1, mode: 'target', desc: 'Спутник наводится с ошибкой. Пока луч прожигает землю, ведите его клавишами A/D.' },
  { id: 'nuke', name: 'Ядерный удар', cat: 4, ammo: 1, mode: 'target', minRound: 3, desc: 'Огромный взрыв. Ракету сносит ветром, разброс около 60 м. Доступен с 3-го раунда.' },
  { id: 'tpgrenade', name: 'Телепортер', cat: 5, ammo: 2, mode: 'charge', ends: true, desc: 'Бросается как граната. Когда устройство остановится, боец переносится к нему; вокруг расчищается место. Упал в воду — просто пропал. Завершает ход.' },
  { id: 'teleport', name: 'Телепорт', cat: 5, ammo: 2, mode: 'target', ends: true, desc: 'Мгновенное перемещение в любую свободную точку. Завершает ход.' },
  { id: 'jetpack', name: 'Джетпак', cat: 5, ammo: 2, mode: 'active', free: true, desc: 'Полёт: W/↑ или пробел — вверх, A/D — в стороны. Ход продолжается.' },
  { id: 'girder', name: 'Балка', cat: 5, ammo: 3, mode: 'place', free: true, desc: 'Постройте стальную балку. R — повернуть. Ход продолжается.' },
  { id: 'pickaxe', name: 'Кирка', cat: 5, ammo: 4, mode: 'instant', desc: 'Прорубает проход в сторону прицела — можно копать вниз, вверх и вбок. Выручает из ловушек.' },
  { id: 'medkit', name: 'Аптечка', cat: 5, ammo: 1, mode: 'self', desc: 'Лечит бойца на 35 здоровья.' },
  { id: 'skip', name: 'Пропуск хода', cat: 5, ammo: -1, mode: 'self', ends: true, desc: 'Передать ход сопернику.' },
];
// оружие, которому можно задать подкрутку (клавиша R)
const SPIN_WEAPONS = new Set(['grenade', 'cluster', 'tpgrenade']);
const WEAPON = Object.fromEntries(WEAPONS.map((w, i) => [w.id, Object.assign(w, { idx: i })]));
const CLASSIC = ['bazooka', 'grenade', 'cluster', 'shotgun', 'sniper', 'dynamite', 'mine', 'bat', 'airstrike', 'teleport', 'girder', 'skip'];
// набор как в Territory War 3: десять видов оружия оригинала (+ пропуск хода)
const TW3 = ['grenade', 'rpg', 'boot', 'girder', 'pickaxe', 'mortar', 'magnum', 'sniper', 'tpgrenade', 'acid', 'skip'];

function makeAmmo(arsenal) {
  const a = {};
  const only = arsenal === 'classic' ? CLASSIC : arsenal === 'tw3' ? TW3 : null;
  for (const w of WEAPONS) if (!only || only.includes(w.id)) a[w.id] = w.ammo;
  return a;
}

/* ---------- рисование оружия в руках (начало координат — рукоять, ствол вдоль +x) ----------
   Каждая деталь — объёмная: градиент сверху вниз, тонкая обводка и блик по верхней грани */
function _shade(hex, k) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
function _part(c, x, y, w, h, col, r = 0.8) {
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, _shade(col, 1.45)); g.addColorStop(0.45, col); g.addColorStop(1, _shade(col, 0.55));
  c.fillStyle = g; rrect(c, x, y, w, h, Math.min(r, h / 2, w / 2)); c.fill();
  c.lineWidth = 0.5; c.strokeStyle = 'rgba(8,10,12,0.75)'; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.28)'; c.fillRect(x + 0.6, y + 0.35, Math.max(0, w - 1.2), Math.min(0.7, h * 0.25));
}
function _wood(c, x, y, w, h, col = '#8a5530') {
  _part(c, x, y, w, h, col, 1.2); c.strokeStyle = 'rgba(40,20,8,0.35)'; c.lineWidth = 0.35;
  c.beginPath(); for (let i = 1; i < 3; i++) { c.moveTo(x + 1, y + h * i / 3); c.quadraticCurveTo(x + w / 2, y + h * i / 3 + 0.6, x + w - 1, y + h * i / 3); } c.stroke();
}
function _grip(c, x, y, w, h, col, tilt = 0.35) {
  c.save(); c.translate(x, y); c.rotate(tilt); _part(c, 0, 0, w, h, col, 1); c.restore();
}
function _muzzle(c, x, y, h) { c.fillStyle = '#0b0d0f'; c.fillRect(x, y, 1.2, h); }
function _tube(c, x, y, w, h, col) {
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, _shade(col, 0.7)); g.addColorStop(0.3, _shade(col, 1.5)); g.addColorStop(0.55, col); g.addColorStop(1, _shade(col, 0.45));
  c.fillStyle = g; rrect(c, x, y, w, h, h / 2.4); c.fill(); c.lineWidth = 0.5; c.strokeStyle = 'rgba(8,10,12,0.75)'; c.stroke();
}
function _glowDot(c, x, y, r, col, a = 1) { c.save(); c.globalAlpha *= a; c.shadowColor = col; c.shadowBlur = 5; c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.restore(); }
function drawHeld(c, id, t = 0) {
  switch (id) {
    case 'assault':
      _wood(c, -12, -2, 9, 5, '#5d6a52'); _part(c, -4, -3.2, 17, 5.2, '#3b464b'); _part(c, 12, -2.2, 12, 2.4, '#1c2428', 0.5); _muzzle(c, 23.5, -2.2, 2.4);
      _grip(c, 1, 1.8, 3.2, 6.5, '#2f3a3d', 0.25); _grip(c, 5.5, 1.5, 3.4, 7, '#4a5646', -0.12); _part(c, -1, -5.3, 9, 2, '#1d2326', 0.4); _part(c, 5, -6.4, 2, 1.4, '#111', 0.2); break;
    case 'uzi':
      _part(c, -5, -3, 15, 5.4, '#2b2f33'); _part(c, 9, -1.8, 7, 2.2, '#16191b', 0.4); _muzzle(c, 15.5, -1.8, 2.2);
      _grip(c, 2, 2, 3.4, 9, '#1f2224', 0.05); _part(c, -8, -2.2, 4, 1.6, '#3a3f44', 0.3); c.fillStyle = 'rgba(255,255,255,0.18)'; for (let i = 0; i < 4; i++) c.fillRect(-2 + i * 3, -2.2, 1, 3.4); break;
    case 'revolver': case 'magnum': {
      const big = id === 'magnum';
      _part(c, -4, -3.4, 9, 6.6, big ? '#9aa4a8' : '#c3ccc8', 1.6); _part(c, 4, -3, big ? 18 : 14, 3.2, big ? '#7d8a90' : '#8f9e99', 0.6); _muzzle(c, big ? 21.6 : 17.6, -3, 3.2);
      if (big) _part(c, 5, -4.4, 16, 1.6, '#6a7479', 0.3);
      _grip(c, -4.5, 2, 4.4, 7.5, big ? '#3a2416' : '#8a5530', 0.35); c.fillStyle = '#2a2f31'; c.beginPath(); c.arc(0.5, -0.2, 1.3, 0, TAU); c.fill(); break;
    }
    case 'plasma': case 'tesla': case 'repulsor': {
      const col = id === 'plasma' ? '#9df1ff' : id === 'tesla' ? '#b9a1ff' : '#f0e991';
      _part(c, -9, -4.2, 22, 8.4, '#33505e', 2); _part(c, 12, -5.2, 6, 10.4, '#7f9a99', 1.5); _part(c, 17.5, -2.4, 5, 4.8, '#243238', 1);
      _grip(c, -2, 3.8, 3.8, 5, '#26343a', 0.3); for (let i = 0; i < 3; i++) _glowDot(c, -4 + i * 5, 0, 1.3, col, 0.7 + 0.3 * Math.sin(t * 8 + i));
      _glowDot(c, 22, 0, 1.8, col, 0.8 + 0.2 * Math.sin(t * 10)); break;
    }
    case 'autocannon': _part(c, -12, -5, 21, 10, '#6c6c56', 2); _part(c, 8, -3, 17, 6, '#262f31', 1); _part(c, 15, -4.2, 4, 8.4, '#9a9a86', 0.8); _muzzle(c, 24.4, -3, 6); _grip(c, -3, 5, 5, 6, '#343f42', 0.2); _part(c, -9, -4, 4, 8, '#d7b06c', 0.8); break;
    case 'rpg':
      _tube(c, -10, -2.6, 26, 5.2, '#4f5b36'); _part(c, 14, -4.6, 9, 9.2, '#7a6a3a', 2.2); c.fillStyle = '#c24b2a'; c.beginPath(); c.moveTo(23, -4.2); c.quadraticCurveTo(29, 0, 23, 4.2); c.closePath(); c.fill();
      _grip(c, -1, 2.4, 3.4, 6, '#2b2f24', 0.2); _grip(c, 6, 2.4, 3.2, 5, '#2b2f24', -0.1); _part(c, 2, -6.4, 5, 3.4, '#1e2224', 0.5); break;
    case 'bazooka': case 'homing': case 'drill': case 'mortar': {
      const col = { bazooka: '#51703b', homing: '#dfe6ee', drill: '#d9a21a', mortar: '#3a3f46' }[id];
      const L = id === 'mortar' ? 19 : 24, th = id === 'mortar' ? 6.4 : 5.2;
      _tube(c, -9, -th / 2, L, th, col); _part(c, L - 11, -th / 2 - 0.9, 3, th + 1.8, '#202326', 0.5); _part(c, -10, -th / 2 - 0.7, 2.6, th + 1.4, '#202326', 0.5);
      if (id === 'homing') { _part(c, 1, -th / 2 - 3.4, 6, 3.2, '#2a8cff', 0.6); _glowDot(c, 6, -th / 2 - 1.8, 0.8, '#9fd4ff'); }
      if (id === 'drill') { c.fillStyle = 'rgba(20,20,20,0.7)'; for (let i = 0; i < 4; i++) c.fillRect(-4 + i * 4, -th / 2, 1.6, th); }
      _grip(c, -0.5, th / 2, 3, 4, '#2c2f33', 0.2); _part(c, 1.5, -th / 2 - 2.6, 4, 2.2, '#1d2124', 0.4); break;
    }
    case 'salvo': _part(c, -6, -4.6, 19, 9.2, '#5c613b', 1.6); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.fillStyle = '#0d0f10'; c.beginPath(); c.arc(12.5, -2.2 + j * 4.4, 1.5, 0, TAU); c.fill(); } _grip(c, 0, 4.6, 3, 4, '#2c2f33', 0.2); break;
    case 'acid':
      _part(c, -8, -3.4, 18, 6.8, '#4d5a3a', 1.6); _tube(c, 9, -2, 13, 4, '#6b7466'); _part(c, 21, -2.8, 3, 5.6, '#2b2f2a', 0.6);
      _tube(c, -12, 3, 9, 7, '#9fd23a'); c.strokeStyle = '#2b3326'; c.lineWidth = 1; c.beginPath(); c.moveTo(-7.5, 3); c.quadraticCurveTo(-4, 1, -2, 3.4); c.stroke();
      _grip(c, 1, 3.4, 3.2, 5, '#2f3528', 0.25); _glowDot(c, 25, 0, 1.5, '#b8ff3a', 0.6 + 0.4 * Math.sin(t * 9)); break;
    case 'boot':
      c.save(); c.rotate(0.15); _part(c, 0, -6, 6.4, 9, '#5a3a22', 1.6); _part(c, 0, 1.6, 13, 4.2, '#4a2e1a', 1.8); _part(c, -0.4, 5, 13.8, 1.6, '#1d1510', 0.5);
      c.strokeStyle = 'rgba(230,210,170,0.8)'; c.lineWidth = 0.5; c.beginPath(); for (let i = 0; i < 3; i++) { c.moveTo(1.4, -4 + i * 2.2); c.lineTo(5, -3 + i * 2.2); } c.stroke(); c.restore(); break;
    case 'pickaxe':
      c.save(); c.rotate(-0.25); _wood(c, -8, -1.1, 24, 2.4, '#8a5a30');
      c.fillStyle = '#9aa2aa'; c.beginPath(); c.moveTo(14, -1); c.quadraticCurveTo(15, -9, 7, -13); c.quadraticCurveTo(13, -8, 13, -1); c.moveTo(14, 1); c.quadraticCurveTo(15, 9, 9, 12); c.quadraticCurveTo(13, 7, 13, 1); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(20,24,28,0.7)'; c.lineWidth = 0.5; c.stroke(); _part(c, 12, -2.4, 4, 4.8, '#6c747c', 0.8); c.restore(); break;
    case 'shotgun': _wood(c, -11, -2, 9, 4.4, '#7a4a28'); _part(c, -2, -2, 19, 2.4, '#2b2d2f', 0.4); _part(c, -2, 0.5, 15, 1.9, '#3a3c3e', 0.4); _wood(c, 4, 0.2, 7, 2.8, '#7a4a28'); _muzzle(c, 16.6, -2, 2.4); _grip(c, -3, 2, 3, 4.5, '#6a3e22', 0.4); break;
    case 'sniper':
      _wood(c, -12, -1.8, 10, 4, '#4a3320'); _part(c, -2, -1.5, 28, 2.1, '#1d1f21', 0.4); _muzzle(c, 25.6, -1.5, 2.1); _tube(c, 0, -5.4, 11, 3.1, '#26292c');
      _part(c, 10.6, -5.8, 1.6, 3.9, '#111', 0.3); _glowDot(c, 11.4, -3.8, 0.6, '#7fe0ff', 0.8); _grip(c, 0, 0.6, 2.4, 4.4, '#2b2d2f', 0.35); _part(c, 14, 0.6, 1, 4.2, '#333', 0.2); break;
    case 'minigun': _part(c, -7, -4, 11, 8, '#3c4148', 2); for (let i = 0; i < 3; i++) _tube(c, 4, -3 + i * 2.1, 14, 1.8, '#26292c'); _part(c, 16, -3.6, 2.2, 7.2, '#51565c', 0.5); _grip(c, -3, 4, 3.2, 3.4, '#222', 0.2); _part(c, 1, 2.4, 4, 3.6, '#c9a23b', 0.6); break;
    case 'flamer': _tube(c, -8, -2.1, 21, 4, '#5e6164'); _part(c, -11, 1.6, 10, 6.4, '#c0392b', 3); _part(c, 12, -2.8, 3.4, 5.4, '#222', 0.5); _glowDot(c, 17, -0.2, 1.4, '#58a8ff', 0.6 + 0.4 * Math.sin(t * 30)); break;
    case 'railgun': _part(c, -9, -3.4, 26, 6.8, '#2c3440', 1.4); for (let i = 0; i < 4; i++) _glowDot(c, -3 + i * 5, 0, 1.1, '#50f0ff', 0.7 + 0.3 * Math.sin(t * 12 + i)); _part(c, 16.5, -2.4, 3.4, 4.8, '#111', 0.5); _grip(c, -2, 3.4, 3.2, 4.4, '#1b2026', 0.3); break;
    case 'bat': c.save(); c.rotate(-0.5); { const g = c.createLinearGradient(0, -3, 0, 3); g.addColorStop(0, '#e7b77a'); g.addColorStop(1, '#a8753e'); c.fillStyle = g; } c.beginPath(); c.moveTo(-2, -1); c.lineTo(20, -2.8); c.quadraticCurveTo(23.5, 0, 20, 2.8); c.lineTo(-2, 1); c.closePath(); c.fill(); c.strokeStyle = 'rgba(40,20,8,0.6)'; c.lineWidth = 0.5; c.stroke(); _part(c, -3.5, -1.3, 5, 2.6, '#5a3620', 0.6); c.restore(); break;
    case 'grenade': case 'cluster': case 'sticky': case 'blackhole': case 'mine': case 'dynamite': case 'molotov': case 'robot': case 'tpgrenade':
      c.save(); c.translate(3, 0); c.scale(0.8, 0.8); drawEntityBody(c, { k: { grenade: 'grenade', cluster: 'cluster', sticky: 'sticky', blackhole: 'bholeg', mine: 'mine', dynamite: 'dynamite', molotov: 'molotov', robot: 'robot', tpgrenade: 'tpg' }[id], a: 0, f: 3, s: 0 }, t, true); c.restore(); break;
    case 'medkit': _part(c, -1, -5, 11, 8.4, '#f2f2f2', 1.4); c.fillStyle = '#e53935'; c.fillRect(3.2, -3.8, 2.6, 6); c.fillRect(1.5, -2.1, 6, 2.6); break;
    case 'skip': _part(c, -1, -16, 1.6, 20, '#8a6a44', 0.4); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0.6, -16); c.quadraticCurveTo(7, -14 + Math.sin(t * 6) * 1.5, 12, -15); c.lineTo(12, -9); c.quadraticCurveTo(7, -8 + Math.sin(t * 6 + 1) * 1.5, 0.6, -10); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 0.4; c.stroke(); break;
    case 'girder': _part(c, 0, -5, 10, 8, '#3a8fd8', 1); c.fillStyle = '#bfe2ff'; c.fillRect(1.2, -3.8, 7.6, 5.6); c.strokeStyle = '#3a8fd8'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(2, -1); c.lineTo(8, -1); c.moveTo(2, 1); c.lineTo(6, 1); c.stroke(); break;
    case 'jetpack': break;
    default: // пульт для ударов с воздуха и телепорта
      _part(c, 0, -4, 7.4, 9.4, '#2a2e36', 1.4); _part(c, 1, -3, 5.4, 3.6, id === 'teleport' ? '#b06cff' : '#4ff08a', 0.6); _glowDot(c, 3.5, 2.8, 0.9, (t * 3 % 1) < 0.5 ? '#ff4040' : '#801010'); _part(c, 5.2, -9.5, 1.2, 5.8, '#555', 0.3);
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
      if (['grenade', 'cluster', 'sticky', 'blackhole', 'mine', 'dynamite', 'molotov', 'robot', 'tpgrenade'].includes(id)) { c.translate(-3, 0); c.scale(1.3, 1.3); }
      else c.translate(-5, 0);
      drawHeld(c, id, 0.3);
    }
  }
  _iconCache.set(key, cv); return cv;
}
