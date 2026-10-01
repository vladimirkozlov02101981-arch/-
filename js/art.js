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
  hiAvail: new Set(['brick_castle', 'brick_keep', 'brick_light', 'cave_wall', 'dirt_canyon', 'dirt_castle', 'rock_arctic', 'rock_canyon', 'rock_volcano']),   // какие карты деталей есть в assets/tex/hi (обновляет dev/make_detail.py)
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
  load() {
    if (this.ready) return this.ready;
    this.ready = Promise.all(this.names.map((n) => new Promise((res) => {
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
    })));
    return this.ready;
  },
};
TexLib.load();
/* Боец из 3D-модели (кадры отрендерены в Blender, dev/blender/make_soldier.py).
   Лист free: строки — стойка, шаг, бег, лазание; лист aim: строка — угол прицела (−90°…+90° через 15°),
   столбец 0 — стойка, 1…12 — шаг. Светлые пластины брони перекрашиваются в цвет команды. */
const SoldierArt = {
  CELL: 144, FOOT: [72, 126], MPP: 2.3 / 144, SHOULDER: [72.8, 38.5], K: 0.40,
  FREE: { idle: [0, 8], walk: [1, 12], run: [2, 10], climb: [3, 8] },
  cache: new Map(),
  ok() { return !!(TexLib.data.soldier_free && TexLib.data.soldier_aim); },
  sheet(name, color) {
    const key = name + color; let cv = this.cache.get(key); if (cv) return cv;
    const T = TexLib.data['soldier_' + name]; cv = makeCanvas(T.w, T.h); const c = cv.getContext('2d');
    const img = c.createImageData(T.w, T.h), d = img.data, s = T.d; d.set(s);
    // светлые пластины брони: на шлеме — цвет команды, остальное — полевая олива (как у настоящей формы)
    const [tr, tg, tb] = hex2rgb(color), tl = (tr * 0.3 + tg * 0.59 + tb * 0.11) || 1, OL = [96, 104, 70], ol = OL[0] * 0.3 + OL[1] * 0.59 + OL[2] * 0.11, C = this.CELL, W = T.w;
    for (let j = 0; j < d.length; j += 4) {
      if (s[j + 3] < 8) continue;
      const r = s[j], g = s[j + 1], b = s[j + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const L = r * 0.3 + g * 0.59 + b * 0.11, cy = ((j >> 2) / W | 0) % C, helm = cy < 40, vest = cy >= 46 && cy < 64;
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

