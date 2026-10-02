'use strict';
// Permanent artwork, loaded from the project. No round-dependent generation.
const MapArt = {
  images: new Map(),
  themeMap: { valley: 'valley', desert: 'canyon', arctic: 'arctic', volcano: 'volcano', alien: 'alien', tropical: 'pirate', castle: 'castles', city: 'city' },
  get(id) {
    if (!this.images.has(id)) {
      const img = new Image(); img.src = `assets/maps/${id}.png`; this.images.set(id, img);
    }
    return this.images.get(id);
  },
  softs: new Map(),
  /** дальний план: исходное разрешение, лёгкая резкость (unsharp mask) — чёткая картинка без мыла */
  soft(id) {
    const img = this.get(id);
    if (!img.complete || !img.naturalWidth) return null;
    let s = this.softs.get(id); if (s) return s;
    const W = img.naturalWidth, H = img.naturalHeight;
    s = makeCanvas(W, H); const c = s.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0);   // исходные цвета панорамы без фильтров
    try {
      const bl = makeCanvas(W, H), bc = bl.getContext('2d', { willReadFrequently: true });
      bc.filter = 'blur(1.2px)'; bc.drawImage(s, 0, 0); bc.filter = 'none';
      const A = c.getImageData(0, 0, W, H), Bd = bc.getImageData(0, 0, W, H).data, d = A.data, k = 0.35;
      for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) { const v = d[i + j] + (d[i + j] - Bd[i + j]) * k; d[i + j] = v < 0 ? 0 : v > 255 ? 255 : v; }
      c.putImageData(A, 0, 0);
    } catch (e) { /* без резкости, если холст недоступен для чтения */ }
    this.softs.set(id, s); return s;
  },
  draw(c, id, w, h, pan = 0) {
    const img = this.soft(id);
    if (!img) return false;
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    const k = Math.max(w / img.width, h / img.height) * 1.06;
    const dw = img.width * k, dh = img.height * k;
    c.drawImage(img, (w - dw) / 2 - Math.max(-w * .025, Math.min(w * .025, pan)), (h - dh) * .42, dw, dh);
    return true;
  }
};

/** фотореалистичные бесшовные текстуры карт (рендер Blender, dev/blender/make_textures.py).
    Загружаются сразу при старте; если файла нет — карта рисуется процедурно, как раньше */
const TexLib = {
  names: ['dirt_valley', 'brick_keep', 'brick_light', 'cave_wall', 'grass_valley', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'tree_birch1', 'bush1', 'bush2',
    'rock_canyon', 'dirt_canyon', 'cave_canyon', 'rock_arctic', 'cave_arctic', 'rock_volcano', 'cave_volcano', 'rock_alien', 'dirt_alien', 'cave_alien', 'grass_alien',
    'wood_ship', 'wood_light', 'dirt_tropical', 'grass_tropical', 'concrete_city', 'dirt_castle', 'brick_castle', 'cap_snow', 'cap_sand', 'cap_ash', 'soldier_free', 'soldier_aim', 'haystack1', 'alien_tree1', 'alien_tree2', 'facade_city', 'tree_pine_snow1', 'tree_pine_snow2',
    'wpn_bazooka', 'wpn_rpg', 'wpn_assault', 'wpn_sniper', 'wpn_shotgun', 'wpn_revolver', 'wpn_magnum', 'wpn_uzi', 'wpn_minigun', 'wpn_flamer', 'wpn_autocannon', 'wpn_mortar', 'wpn_homing'],
  data: {},
  ready: null,
  hi: {},
  hiAvail: new Set(['brick_castle', 'brick_keep', 'brick_light', 'cave_wall', 'dirt_alien', 'dirt_canyon', 'dirt_castle', 'facade_city', 'rock_alien', 'rock_arctic', 'rock_volcano', 'wood_ship']),   // какие карты деталей есть в assets/tex/hi (обновляет dev/make_detail.py)
  /** карта мелких деталей текстуры (рендер в двойном разрешении): яркость деталей мельче пикселя карты, 128 = без изменения */
  loadHi(n) {
    if (this.hi[n] !== undefined) return this.hi[n];
    this.hi[n] = null; if (!this.hiAvail.has(n)) return null;
    const im = new Image();
    im.onload = () => {
      try {
        const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, g = new Uint8Array(c.width * c.height);
        for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
        this.hi[n] = { name: n, w: c.width, h: c.height, d: g };
      } catch (e) { /* без деталей */ }
    };
    im.onerror = () => {};
    im.src = `assets/tex/hi/${n}.webp`;
    return null;
  },
  /** родной цвет высокого разрешения: assets/tex/native/<имя>.webp в k раз подробнее малой текстуры, тот же период.
      Малая текстура — точное уменьшение родной (dev/make_native.py), поэтому при приближении цвет берётся из родной,
      а освещение, тени и подпалины карты переносятся отношением «нарисовано / малая текстура» (js/hires.js).
      Загружается лениво — только для материалов карты, которую приближают; давно не нужные (другая карта) выгружаются */
  native: {}, nativeUse: new Map(),
  nativeAvail: new Map([['dirt_valley', 4], ['rock_canyon', 4]]),   // имя → k (обновляет dev/make_native.py)
  loadNative(n) {
    const have = this.native[n];
    if (have !== undefined) { if (have) this.nativeUse.set(n, performance.now()); return have; }
    this.native[n] = null; const k = this.nativeAvail.get(n); if (!k) return null;
    const im = new Image();
    im.onload = () => {
      try {
        const low = this.data[n];
        if (!low || im.naturalWidth !== low.w * k || im.naturalHeight !== low.h * k) return;   // не та пара — обычная отрисовка
        const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, rgb = new Uint8Array(c.width * c.height * 3);
        for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { rgb[i] = d[j]; rgb[i + 1] = d[j + 1]; rgb[i + 2] = d[j + 2]; }
        c.width = c.height = 1;   // холст декодирования больше не нужен
        this.native[n] = { name: n, w: im.naturalWidth, h: im.naturalHeight, k, d: rgb };
        this.nativeUse.set(n, performance.now()); this.trimNative();
      } catch (e) { /* без родного цвета */ }
    };
    im.onerror = () => {};
    im.src = `assets/tex/native/${n}.webp`;
    return null;
  },
  /** выгрузка: только то, что не использовалось 30 с (материалы прежней карты), и не больше восьми в памяти —
      материалы текущей карты используются каждую секунду и не вытесняют друг друга */
  trimNative(keep = 8, idleMs = 30000) {
    const now = performance.now(), live = [...this.nativeUse.entries()].filter(([n]) => this.native[n]).sort((a, b) => b[1] - a[1]);
    live.forEach(([n, t], i) => { if (now - t > idleMs || i >= keep) { delete this.native[n]; this.nativeUse.delete(n); } });
  },
  surfaceHi: {},
  fine: {},
  fineAvail: new Set(['dirt_valley', 'dirt_castle']),
  /** цветные фотодетали: 128 = исходный цвет, 8 текселей на игровую единицу */
  loadFine(n) {
    if (this.fine[n] !== undefined) return this.fine[n];
    this.fine[n] = null; if (!this.fineAvail.has(n)) return null;
    const im = new Image();
    im.onload = () => {
      try {
        const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, rgb = new Uint8Array(c.width * c.height * 3);
        for (let i = 0; i < c.width * c.height; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
        const mw = Math.floor(c.width / 2), mh = Math.floor(c.height / 2), md = new Uint8Array(mw * mh * 3);
        for (let y = 0; y < mh; y++) for (let xx = 0; xx < mw; xx++) for (let channel = 0; channel < 3; channel++) {
          const a = (y * 2 * c.width + xx * 2) * 3 + channel, b = a + c.width * 3;
          md[(y * mw + xx) * 3 + channel] = Math.round((rgb[a] + rgb[a + 3] + rgb[b] + rgb[b + 3]) / 4);
        }
        this.fine[n] = { name: n, w: c.width, h: c.height, scale: 8, d: rgb, mip: { w: mw, h: mh, scale: 4, d: md } };
      } catch (e) { /* без мелких фотодеталей */ }
    };
    im.onerror = () => {};
    im.src = `assets/tex/fine/${n}.webp`;
    return null;
  },
  load() {
    if (this.ready) return this.ready;
    const base = this.names.map((n) => new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(im, 0, 0); this.data[n] = { name: n, w: c.width, h: c.height, canvas: c, d: x.getImageData(0, 0, c.width, c.height).data };
        } catch (e) { /* холст недоступен — без текстуры */ }
        res();
      };
      im.onerror = () => res();
      im.src = `assets/tex/${n}.png`;
    }));
    const surface = ['grass_valley', 'bush1', 'bush2'].map((n) => new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = makeCanvas(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0);
          this.surfaceHi[n] = { name: n, w: c.width, h: c.height, canvas: c, scale: 4 };
        } catch (e) { /* остаётся обычный спрайт */ }
        res();
      };
      im.onerror = () => res();
      im.src = `assets/tex/surface/${n}.png`;
    }));
    this.ready = Promise.all(base.concat(surface));
    return this.ready;
  },
};
TexLib.load();
/* Боец из 3D-модели (кадры отрендерены в Blender, dev/blender/make_soldier.py).
   Лист free: строки — стойка, шаг, бег, лазание; лист aim: строка — угол прицела (−90°…+90° через 15°),
   столбец 0 — стойка, 1…12 — шаг. Светлые пластины брони перекрашиваются в цвет команды. */
const SoldierArt = {
  CELL: 144, FOOT: [72, 126], MPP: 2.3 / 144, SHOULDER: [72.8, 38.5], K: 0.40, HAT_S: 0.56, HAT_DY: 3.6,
  FREE: { idle: [0, 8], walk: [1, 12], run: [2, 10], climb: [3, 8] },
  cache: new Map(),
  ok() { return !!(TexLib.data.soldier_free && TexLib.data.soldier_aim); },
  /** верх головы в кадре (пиксели клетки). Ищется по кадрам без оружия, где руки ниже головы; кадры с прицелом
      (столбец 0 — стойка, 1…12 — шаг) и лазание повторяют позу тела этих кадров */
  head(sheet, row, fr) {
    let r = row, f = fr, f2 = -1;
    if (sheet === 'aim') { r = fr > 0 ? 1 : 0; f = fr > 0 ? fr - 1 : 0; }
    else if (row === 3) { const j = fr * 1.5; r = 1; f = Math.floor(j) % 12; if (j % 1) f2 = (f + 1) % 12; }
    const a = this.headAt(r, f); if (f2 < 0) return a;
    const b = this.headAt(r, f2); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  },
  headAt(r, f) {
    const key = r * 16 + f; let h = this.heads.get(key); if (h) return h;
    const T = TexLib.data.soldier_free, C = this.CELL, W = T.w, d = T.d, at = (x, y) => d[((r * C + y) * W + f * C + x) * 4 + 3] > 40;
    let top = -1, x0 = C, x1 = -1;
    for (let y = 0; y < C && top < 0; y++) for (let x = 0; x < C; x++) if (at(x, y)) { top = y; break; }
    if (top < 0) top = 18;
    for (let y = top; y < Math.min(C, top + 8); y++) for (let x = 0; x < C; x++) if (at(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    h = { x: x1 >= x0 ? (x0 + x1) / 2 : this.FOOT[0] + 6, y: top }; this.heads.set(key, h); return h;
  },
  heads: new Map(),
  /** bare — без каски цвета команды: шапку рисуем поверх, голова под ней в полевой оливе */
  sheet(name, color, bare = false) {
    const key = name + color + (bare ? ':bare' : ''); let cv = this.cache.get(key); if (cv) return cv;
    const T = TexLib.data['soldier_' + name]; cv = makeCanvas(T.w, T.h); const c = cv.getContext('2d');
    const img = c.createImageData(T.w, T.h), d = img.data, s = T.d; d.set(s);
    // светлые пластины брони: на шлеме — цвет команды, остальное — полевая олива (как у настоящей формы)
    const [tr, tg, tb] = hex2rgb(color), tl = (tr * 0.3 + tg * 0.59 + tb * 0.11) || 1, OL = [96, 104, 70], ol = OL[0] * 0.3 + OL[1] * 0.59 + OL[2] * 0.11, C = this.CELL, W = T.w;
    for (let j = 0; j < d.length; j += 4) {
      if (s[j + 3] < 8) continue;
      const r = s[j], g = s[j + 1], b = s[j + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const L = r * 0.3 + g * 0.59 + b * 0.11, cy = ((j >> 2) / W | 0) % C, helm = !bare && cy < 40, vest = cy >= 46 && cy < 64;
      if (helm && L > 25) {                                                   // шлем целиком — насыщенный цвет команды (с фактурой и светом модели)
        const f = Math.min(1.5, L / tl * 1.25); d[j] = tr * f; d[j + 1] = tg * f; d[j + 2] = tb * f; continue;
      }
      if (mx < 40 || r < g || g < b || (mx - mn) / mx < 0.14) continue;
      if (vest) { const f = L / tl * 1.05, k = 0.85; d[j] = r + (tr * f - r) * k; d[j + 1] = g + (tg * f - g) * k; d[j + 2] = b + (tb * f - b) * k; continue; }   // нагрудные пластины — тоже цвет команды
      const k = Math.min(1, ((mx - mn) / mx - 0.14) * 5) * (helm ? 0.9 : 0.8);
      const T3 = helm ? [tr, tg, tb] : OL, f = L / (helm ? tl : ol) * (helm ? 1.0 : 0.95);
      d[j] = r + (T3[0] * f - r) * k; d[j + 1] = g + (T3[1] * f - g) * k; d[j + 2] = b + (T3[2] * f - b) * k;
    }
    c.putImageData(img, 0, 0); this.cache.set(key, cv); return cv;
  },
};

