'use strict';
/* =========================================================
   Личные настройки игрока, сохранённые конфигурации, клавиши
   ---------------------------------------------------------
   Набор настроек (snapshot) — всё сразу: параметры боя и оружие, команды, бот, клавиши, звук.
   • base — основной набор игрока («по умолчанию»): грузится при запуске и для каждого нового боя.
   • configs — именованные конфигурации; defaultId — какая из них сейчас основная (или null — основной несохранённый набор).
   • Временный набор боя (лобби по сети у хоста и гостя, выбранная для боя конфигурация) живёт только в UI.work и после
     выхода в главное меню исчезает — base им сам не перезаписывается.
   Хранение: localStorage этого браузера; на ПК с сервером «Играть» ещё и файл profile.json рядом с игрой
   (общий для Chrome, Opera и файла игры на этом ПК).
   ========================================================= */
const PROFILE_KEY = 'tw_profile_v2';

/* ---------- клавиши: по физической клавише (event.code) — раскладка (рус/укр/англ) не важна ---------- */
const KEY_ACTIONS = [
  ['left', 'Идти влево', ['KeyA', 'ArrowLeft']], ['right', 'Идти вправо', ['KeyD', 'ArrowRight']],
  ['up', 'Вверх по лестнице / тяга джетпака', ['KeyW']], ['down', 'Вниз по лестнице', ['KeyS']],
  ['aimUp', 'Прицел выше', ['ArrowUp']], ['aimDown', 'Прицел ниже', ['ArrowDown']], ['precise', 'Точнее прицел / задержать дыхание', ['ShiftLeft', 'ShiftRight']],
  ['jump', 'Прыжок (и прыжок робо-бомбы)', ['Space']], ['fire', 'Выстрел', ['KeyF', 'Enter']],
  ['holster', 'Убрать / вернуть оружие', ['Escape']], ['skip', 'Пропустить ход (сделал всё, что хотел)', ['Backquote', 'KeyP']],
  ['tray', 'Панель оружия', ['Tab']], ['prev', 'Предыдущее оружие', ['KeyQ']], ['next', 'Следующее оружие / оптика снайперки', ['KeyE']],
  ['cat1', 'Ракеты', ['Digit1']], ['cat2', 'Гранаты', ['Digit2']], ['cat3', 'Огнестрел', ['Digit3']], ['cat4', 'Взрывчатка', ['Digit4']], ['cat5', 'С воздуха', ['Digit5']], ['cat6', 'Снаряжение', ['Digit6']],
  ['binoc', 'Бинокль', ['KeyB']], ['camera', 'Камера к бойцу', ['KeyC']], ['rotate', 'Повернуть балку / подкрутка гранаты', ['KeyR']],
  ['menu', 'Меню (пауза) — мышь свободна', ['Backspace']], ['chat', 'Чат (по сети)', ['KeyT']], ['sound', 'Звук вкл/выкл', ['KeyM']],
];
const KEY_DEFAULTS = Object.fromEntries(KEY_ACTIONS.map(([id, , codes]) => [id, codes.slice()]));
function sanitizeKeys(k) {
  const out = {};
  for (const [id] of KEY_ACTIONS) {
    const v = k && Array.isArray(k[id]) ? k[id].filter(c => typeof c === 'string' && /^[A-Za-z0-9]{1,24}$/.test(c)).slice(0, 3) : null;
    out[id] = v && (v.length || Array.isArray(k[id])) ? v : KEY_DEFAULTS[id].slice();
  }
  return out;
}
/** подпись клавиши по её физическому коду */
function keyLabel(code) {
  const M = { Space: 'Пробел', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', Backquote: 'Ё', ShiftLeft: 'Shift', ShiftRight: 'Shift (пр.)', ControlLeft: 'Ctrl', ControlRight: 'Ctrl (пр.)', AltLeft: 'Alt', AltRight: 'Alt (пр.)',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', CapsLock: 'CapsLock' };
  if (M[code]) return M[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}
const Keys = {
  map: sanitizeKeys(null),
  set(k) { this.map = sanitizeKeys(k); this.codes = new Set(Object.values(this.map).flat()); },
  codes: new Set(Object.values(KEY_DEFAULTS).flat()),
  /** зажата ли любая клавиша действия */
  down(id) { const L = this.map[id]; if (!L) return false; for (const c of L) if (Input.keys[c]) return true; return false; },
  /** нажата ли в этом кадре */
  hit(id) { const L = this.map[id]; if (!L) return false; for (const c of L) if (Input.pressed[c]) return true; return false; },
  /** «съесть» нажатие, чтобы другое действие на той же клавише его не увидело */
  eat(id) { for (const c of this.map[id] || []) Input.pressed[c] = false; },
  label(id) { return (this.map[id] || []).map(keyLabel).join(' / ') || '—'; },
};

/* ---------- наборы настроек ---------- */
/** значения по умолчанию при первом запуске — нынешние настройки игрока (перенесены из его браузера 02.10) */
const FACTORY_SNAP = {
  settings: { mapId: 'arctic', perTeam: 4, hp: 100, turnTime: 0, wind: true, arsenal: 'all', ai: 'normal', side: 'random', ammo: null, walk: 'limited', simul: false },
  teams: [{ name: 'Красные', color: '#2fd6e0', hat: 'viking' }, { name: 'Синие', color: '#3d8bff', hat: 'beret' }],
  bot: { name: 'Компьютер', color: '#ff8a2b', hat: 'ushanka' },
  keys: null, sound: { on: true, volume: 0.7 },
};
function snapClean(s) {
  s = s && typeof s === 'object' ? s : {};
  const T = Array.isArray(s.teams) ? s.teams : [];
  const snd = s.sound && typeof s.sound === 'object' ? s.sound : {};
  return {
    settings: sanitizeSettings(s.settings),
    teams: [sanitizeTeam(T[0], FACTORY_SNAP.teams[0]), sanitizeTeam(T[1], FACTORY_SNAP.teams[1])],
    bot: sanitizeTeam(s.bot, FACTORY_SNAP.bot),
    keys: sanitizeKeys(s.keys),
    sound: { on: snd.on !== false, volume: Number.isFinite(+snd.volume) ? clamp(+snd.volume, 0, 1) : 0.7 },
  };
}
const snapCopy = (s) => JSON.parse(JSON.stringify(s));
const snapEqual = (a, b) => JSON.stringify(snapClean(a)) === JSON.stringify(snapClean(b));

const Profile = {
  data: null,
  /** прежний основной набор — до последней смены «по умолчанию»; живёт, пока игрок не вышел в главное меню */
  prev: null,
  saveT: null, remote: null,
  load() {
    let d = null; try { d = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { d = null; }
    if (!d || !d.base) {
      // первый запуск новой версии: прежние сохранённые настройки этого браузера, иначе — значения по умолчанию
      let old = null; try { old = JSON.parse(localStorage.getItem('tw_prefs_v1') || 'null'); } catch (e) { old = null; }
      const base = old && old.settings ? snapClean(Object.assign({}, FACTORY_SNAP, old, { keys: null, sound: FACTORY_SNAP.sound })) : snapClean(FACTORY_SNAP);
      d = { base, configs: [], defaultId: null, t: 0 };
    }
    this.data = this.clean(d);
    this.applyDevice(this.data.base);
  },
  clean(d) {
    const configs = (Array.isArray(d.configs) ? d.configs : []).filter(c => c && c.id && c.data).slice(0, 40)
      .map(c => ({ id: String(c.id).slice(0, 24), name: String(c.name || 'Конфигурация').replace(/[\u0000-\u001f<>]/g, '').slice(0, 28) || 'Конфигурация', data: snapClean(c.data) }));
    const defaultId = configs.some(c => c.id === d.defaultId) ? d.defaultId : null;
    return { base: snapClean(d.base), configs, defaultId, t: +d.t || 0 };
  },
  /** клавиши и звук основного набора действуют сразу (в меню и в бою, если бой начат не с другого набора) */
  applyDevice(s) { Keys.set(s.keys); if (typeof Sfx !== 'undefined' && Sfx.apply) Sfx.apply(s.sound); },
  save() {
    this.data.t = Date.now();
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.data)); } catch (e) { /* без сохранения */ }
    clearTimeout(this.saveT); this.saveT = setTimeout(() => this.push(), 400);
  },
  get base() { return this.data.base; },
  config(id) { return this.data.configs.find(c => c.id === id) || null; },
  /** основной набор целиком заменяется (галочка «по умолчанию» или правки связанного с ним набора) */
  setBase(s, id) { this.data.base = snapClean(snapCopy(s)); if (id !== undefined) this.data.defaultId = id && this.config(id) ? id : null; this.save(); },
  createConfig(name, s) {
    const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    this.data.configs.push({ id, name: String(name).slice(0, 28) || 'Конфигурация', data: snapClean(snapCopy(s)) }); this.save(); return id;
  },
  saveConfig(id, s) { const c = this.config(id); if (!c) return false; c.data = snapClean(snapCopy(s)); this.save(); return true; },
  renameConfig(id, name) { const c = this.config(id); if (!c || !name) return false; c.name = String(name).slice(0, 28); this.save(); return true; },
  deleteConfig(id) { this.data.configs = this.data.configs.filter(c => c.id !== id); if (this.data.defaultId === id) this.data.defaultId = null; if (this.prev && this.prev.defaultId === id) this.prev.defaultId = null; this.save(); },
  /** «Использовать по умолчанию»: набор становится основным, прежний основной запоминается для возврата */
  makeDefault(s, id) {
    this.prev = { base: snapCopy(this.data.base), defaultId: this.data.defaultId };
    this.setBase(s, id || null);
  },
  /** снята галочка: пока прежний основной можно вернуть — вернуть его */
  undoDefault() {
    if (!this.prev) return false;
    this.data.base = snapClean(this.prev.base); this.data.defaultId = this.prev.defaultId && this.config(this.prev.defaultId) ? this.prev.defaultId : null;
    this.prev = null; this.save(); return true;
  },
  /** выход в главное меню (выбор режима): прежний основной больше не восстанавливается */
  forgetPrev() { this.prev = null; },
  /* ---------- файл profile.json на ПК с сервером (общий для всех браузеров этого ПК) ---------- */
  base_url() {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return null;   // автотесты не трогают настоящий профиль игрока
    if (/^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return '';
    if (typeof Net !== 'undefined' && Net.localBase) return Net.localBase;
    return null;
  },
  async pull() {
    if (typeof Net !== 'undefined' && Net.fromFile && Net.fromFile()) { try { await Net.probeLocal(); } catch (e) { /* */ } }
    const b = this.base_url(); if (b === null) return false;
    try {
      const r = await fetch(b + '/profile', { cache: 'no-store' }); if (!r.ok) return false;
      const d = await r.json();
      if (d && d.base && (+d.t || 0) > (this.data.t || 0)) {
        this.data = this.clean(d);
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.data)); } catch (e) { /* */ }
        this.applyDevice(this.data.base); return true;
      }
      if (!d || !d.base || (+d.t || 0) < (this.data.t || 0)) this.push();
    } catch (e) { /* сервер без профиля — только этот браузер */ }
    return false;
  },
  push() {
    const b = this.base_url(); if (b === null) return;
    try { fetch(b + '/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.data) }).catch(() => {}); } catch (e) { /* */ }
  },
};
