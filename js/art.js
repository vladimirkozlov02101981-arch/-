'use strict';
// Permanent artwork, loaded from the project. No round-dependent generation.
const MapArt = {
  images: new Map(),
  pending: new Map(),
  themeMap: { valley: 'valley', desert: 'canyon', arctic: 'arctic', volcano: 'volcano', alien: 'alien', tropical: 'pirate', castle: 'castles', city: 'city' },
  get(id, priority = 'high') {
    if (!this.images.has(id)) {
      const img = new Image(); img.fetchPriority = priority; img.decoding = 'async'; this.images.set(id, img);
      this.pending.set(id, new Promise(resolve => { img.onload = () => resolve(!!img.naturalWidth); img.onerror = () => resolve(false); }));
      img.src = `assets/maps/${id}.png`;
    }
    const img = this.images.get(id); if (priority === 'high') img.fetchPriority = 'high'; return img;
  },
  load(id, priority = 'high') { this.get(id, priority); return this.pending.get(id); },
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

/** Постоянные текстуры: общие бойцы/оружие и только материалы выбранной карты.
    Отсутствующий файл сохраняет прежнюю запасную отрисовку; медленная загрузка не считается отсутствием. */
const TexLib = {
  names: ['dirt_valley', 'brick_keep', 'brick_light', 'cave_wall', 'grass_valley', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'tree_birch1', 'bush1', 'bush2',
    'rock_canyon', 'dirt_canyon', 'cave_canyon', 'rock_arctic', 'cave_arctic', 'rock_volcano', 'cave_volcano', 'rock_alien', 'dirt_alien', 'cave_alien', 'grass_alien',
    'wood_ship', 'wood_hull', 'stone_valley', 'stone_castle', 'stone_sand', 'stone_dark', 'stone_light', 'ivy', 'snowman1', 'snowman2', 'cactus1', 'cactus2', 'cactus3', 'palm1', 'palm2', 'palm3', 'deadtree1', 'deadtree2', 'deadtree_char1', 'deadtree_char2', 'igloo1', 'icecrystal1', 'icecrystal2', 'watertower1', 'column1', 'column2', 'pot1', 'pot2', 'drygrass1', 'drygrass2', 'drygrass3', 'drygrass4', 'flower1', 'flower2', 'flower3', 'flower4', 'leaf1', 'leaf2', 'leaf3', 'leaf4', 'roots1', 'roots2', 'roots3', 'cottage1', 'lava_surface', 'lantern1', 'crystal_c1', 'crystal_c2', 'crystal_m1', 'crystal_m2', 'obsidian1', 'obsidian2', 'lavarock1', 'lavarock2', 'spike1', 'spike2', 'skull1', 'bones1', 'alienplant1', 'alienplant2', 'pod1', 'tentacle1', 'rock1', 'rock2', 'rock3', 'rockb1', 'rockb2', 'rocksnow1', 'rocksnow2', 'ladder_wood', 'ladder_steel', 'ladder_steelY', 'metal_station', 'metal_steel', 'metal_ufo', 'wood_light', 'dirt_tropical', 'grass_tropical', 'concrete_city', 'dirt_castle', 'brick_castle', 'cap_snow', 'cap_sand', 'cap_ash', 'soldier_free', 'soldier_aim', 'haystack1', 'alien_tree1', 'alien_tree2', 'facade_city', 'tree_pine_snow1', 'tree_pine_snow2',
    // оружие в руках (wpn_*, кадр 48×24 ед.) и метательное в полёте (ent_*, кадр 16×16 ед.) — рендер Blender, dev/blender/make_weapons2.py
    'wpn_assault', 'wpn_revolver', 'wpn_magnum', 'wpn_uzi', 'wpn_acid', 'wpn_plasma', 'wpn_autocannon', 'wpn_tesla', 'wpn_repulsor', 'wpn_rpg', 'wpn_bazooka', 'wpn_homing', 'wpn_mortar', 'wpn_drill', 'wpn_salvo', 'wpn_grenade', 'wpn_cluster', 'wpn_sticky', 'wpn_molotov', 'wpn_blackhole', 'wpn_shotgun', 'wpn_sniper', 'wpn_minigun', 'wpn_flamer', 'wpn_railgun', 'wpn_dynamite', 'wpn_mine', 'wpn_robot', 'wpn_boot', 'wpn_bat', 'wpn_airstrike', 'wpn_lightning', 'wpn_orbital', 'wpn_nuke', 'wpn_tpgrenade', 'wpn_teleport', 'wpn_girder', 'wpn_pickaxe', 'wpn_medkit', 'wpn_skip', 'wpn_jetpack', 'ent_grenade', 'ent_cluster', 'ent_sticky', 'ent_molotov', 'ent_blackhole', 'ent_dynamite', 'ent_mine', 'ent_robot', 'ent_tpgrenade'],
  data: {},
  ready: null,
  commonReady: null,
  pending: new Map(), images: new Map(), surfacePending: new Map(), surfaceImages: new Map(),
  surfaceNames: ['grass_valley', 'grass_alien', 'bush1', 'bush2', 'ivy', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'tree_birch1', 'tree_pine_snow1', 'tree_pine_snow2', 'haystack1', 'alien_tree1', 'alien_tree2', 'snowman1', 'snowman2', 'cactus1', 'cactus2', 'cactus3', 'palm1', 'palm2', 'palm3', 'deadtree1', 'deadtree2', 'deadtree_char1', 'deadtree_char2', 'igloo1', 'icecrystal1', 'icecrystal2', 'watertower1', 'column1', 'column2', 'pot1', 'pot2', 'drygrass1', 'drygrass2', 'drygrass3', 'drygrass4', 'flower1', 'flower2', 'flower3', 'flower4', 'leaf1', 'leaf2', 'leaf3', 'leaf4', 'roots1', 'roots2', 'roots3', 'cottage1', 'lantern1', 'crystal_c1', 'crystal_c2', 'crystal_m1', 'crystal_m2', 'obsidian1', 'obsidian2', 'lavarock1', 'lavarock2', 'spike1', 'spike2', 'skull1', 'bones1', 'alienplant1', 'alienplant2', 'pod1', 'tentacle1', 'rock1', 'rock2', 'rock3', 'rockb1', 'rockb2', 'rocksnow1', 'rocksnow2'],   // версии ×2–4 в assets/tex/surface
  hi: {},
  hiAvail: new Set(['brick_castle', 'brick_light']),   // какие карты деталей есть в assets/tex/hi (обновляет dev/make_detail.py)
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
  nativeAvail: new Map([['brick_keep', 4], ['cap_ash', 4], ['cap_sand', 4], ['cap_snow', 4], ['cave_alien', 4], ['cave_arctic', 4], ['cave_canyon', 4], ['cave_volcano', 4], ['cave_wall', 4], ['concrete_city', 4], ['dirt_canyon', 4], ['dirt_castle', 4], ['dirt_tropical', 4], ['dirt_valley', 4], ['facade_city', 4], ['metal_station', 4], ['metal_steel', 4], ['metal_ufo', 4], ['rock_alien', 4], ['rock_arctic', 4], ['rock_canyon', 4], ['rock_volcano', 4], ['stone_castle', 4], ['stone_dark', 4], ['stone_light', 4], ['stone_sand', 4], ['stone_valley', 4], ['wood_hull', 4], ['wood_light', 4], ['wood_ship', 4]]),   // имя → k (обновляет dev/make_native.py)
  loadNative(n) {
    const have = this.native[n];
    if (have !== undefined) { if (have) this.nativeUse.set(n, performance.now()); return have; }
    this.native[n] = null; const k = this.nativeAvail.get(n); if (!k) return null;
    // родные ×4 — до 50 МБ памяти на материал: на телефонах и слабых устройствах обходимся малой текстурой
    const mem = typeof navigator !== 'undefined' && navigator.deviceMemory, touch = typeof Input !== 'undefined' && Input.isTouch;
    if ((mem && mem < 4) || (touch && !(mem >= 8))) return null;
    let done; this.nativeWait.set(n, new Promise(r => { done = r; }));
    const ready = (img, w, h) => {
      const fin = () => {
        try {
          const low = this.data[n];
          if (!low || w !== low.w * k || h !== low.h * k) { if (img.close) img.close(); return; }   // не та пара — обычная отрисовка
          // видеокарта берёт саму картинку (js/terrain_gl.js); цвет RGB для плиток (запасной путь, js/hires.js) — только когда понадобится
          const nat = { name: n, w, h, k, img, rgb: null };
          Object.defineProperty(nat, 'd', { get() { if (!this.rgb) this.rgb = TexLib.nativeRGB(this.img, this.w, this.h); return this.rgb; } });
          this.native[n] = nat; this.nativeUse.set(n, performance.now()); this.trimNative();
          if (this.onNative) this.onNative(nat);   // сразу на видеокарту (js/terrain_gl.js) — к началу боя она уже там
        } catch (e) { /* без родного цвета */ } finally { done(); }
      };
      // малая текстура (по ней проверяется пара) может ещё грузиться — родную грузим одновременно с ней
      const lowWait = !this.data[n] && this.pending.get(n); if (lowWait) lowWait.then(fin, fin); else fin();
    };
    const src = `assets/tex/native/${n}.webp`;
    const viaImage = () => {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { const go = () => ready(im, im.naturalWidth, im.naturalHeight); if (im.decode) im.decode().then(go, go); else go(); };
      im.onerror = () => done(); im.src = src;
    };
    // раскодирование — в фоне браузера (ImageBitmap): основной поток игры не ждёт, а на видеокарту такая картинка уходит за миллисекунды
    if (typeof createImageBitmap === 'function' && typeof fetch === 'function' && (/^data:/.test(src) || location.protocol !== 'file:')) {
      fetch(src).then(r => r.ok ? r.blob() : Promise.reject(new Error(r.status))).then(b => createImageBitmap(b)).then(bmp => ready(bmp, bmp.width, bmp.height), viaImage);
    } else viaImage();
    return null;
  },
  /** RGB родной текстуры для плиток в фоновых потоках */
  nativeRGB(img, w, h) {
    const c = makeCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { rgb[i] = d[j]; rgb[i + 1] = d[j + 1]; rgb[i + 2] = d[j + 2]; }
    c.width = c.height = 1;   // холст декодирования больше не нужен
    return rgb;
  },
  nativeWait: new Map(),
  /** родные текстуры материалов карты — заранее, пока виден экран загрузки боя: первый кадр сразу чёткий.
      Не дольше ms: медленный диск или сеть не задерживают начало боя (догрузятся по ходу) */
  preloadNatives(names, ms = 6000) {
    const jobs = [];
    // стены пещер рисуются без ссылок на текстуру (T.texRef) — их родные ×4 при приближении не нужны
    for (const n of names || []) if (this.nativeAvail.has(n) && !/^cave_/.test(n)) { this.loadNative(n); const w = this.nativeWait.get(n); if (w && !this.native[n]) jobs.push(w); }
    for (const n of names || []) if (this.fineAvail.has(n)) { this.loadFine(n); const w = this.fineWait.get(n); if (w && !this.fine[n]) jobs.push(w); }   // фото-поры грунта
    if (!jobs.length) return null;   // ждать нечего — бой начинается без лишней паузы
    return Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, ms))]);
  },
  /** карта выбрана на экране настроек: её материалы и родные текстуры грузятся в фоне, пока игрок настраивает бой —
      по «В бой!» ждать почти нечего */
  prefetchMap(id) {
    if (!id || this.prefetchId === id) return;
    let a; try { a = this.mapAssets(id); } catch (e) { return; }
    this.prefetchId = id;
    for (const n of a.names) this.loadOne(n, 'low');
    this.preloadNatives(a.names);
  },
  /** выгрузка: только то, что не использовалось 30 с (материалы прежней карты), и не больше восьми в памяти —
      материалы текущей карты используются каждую секунду и не вытесняют друг друга */
  trimNative(keep = 8, idleMs = 30000) {
    const now = performance.now(), live = [...this.nativeUse.entries()].filter(([n]) => this.native[n]).sort((a, b) => b[1] - a[1]);
    live.forEach(([n, t], i) => { if (now - t > idleMs || i >= keep) { const img = this.native[n].img; if (img && img.close) img.close(); delete this.native[n]; this.nativeUse.delete(n); } });
  },
  surfaceHi: {},
  fine: {},
  fineAvail: new Set(['dirt_valley', 'dirt_castle']),
  /** цветные фотодетали: 128 = исходный цвет, 8 текселей на игровую единицу */
  loadFine(n) {
    if (this.fine[n] !== undefined) return this.fine[n];
    this.fine[n] = null; if (!this.fineAvail.has(n)) return null;
    let done; this.fineWait.set(n, new Promise(r => { done = r; }));
    const ready = (img, w, h) => {
      try {
        // видеокарта берёт саму картинку (яркость считает шейдер); яркость для плиток (js/hires.js) — только когда понадобится
        const f = { name: n, w, h, scale: 8, img }, data = () => f.lum || (f.lum = TexLib.fineLum(img, w, h));
        Object.defineProperty(f, 'd', { get: () => data().d }); Object.defineProperty(f, 'mip', { get: () => data().mip });
        this.fine[n] = f;
      } catch (e) { /* без мелких фотодеталей */ } finally { done(); }
    };
    const src = `assets/tex/fine/${n}.webp`;
    // раскодирование — в фоне браузера, как у родных текстур
    if (typeof createImageBitmap === 'function' && typeof fetch === 'function' && (/^data:/.test(src) || location.protocol !== 'file:')) {
      fetch(src).then(r => r.ok ? r.blob() : Promise.reject(new Error(r.status))).then(b => createImageBitmap(b)).then(bmp => ready(bmp, bmp.width, bmp.height), () => done());
    } else {
      const im = new Image(); im.decoding = 'async';
      im.onload = () => { const go = () => ready(im, im.naturalWidth, im.naturalHeight); if (im.decode) im.decode().then(go, go); else go(); };
      im.onerror = () => done(); im.src = src;
    }
    return null;
  },
  fineWait: new Map(),
  /** яркость фотодеталей (128 = исходный цвет) и её уменьшенная копия с чуть большим контрастом — для плиток */
  fineLum(img, w, h) {
    const c = makeCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const lum = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = lum;
    }
    c.width = c.height = 1;
    const mw = Math.floor(w / 2), mh = Math.floor(h / 2), md = new Uint8Array(mw * mh * 3);
    for (let y = 0; y < mh; y++) for (let xx = 0; xx < mw; xx++) {
      const a = (y * 2 * w + xx * 2) * 3, b = a + w * 3;
      const avg = (rgb[a] + rgb[a + 3] + rgb[b] + rgb[b + 3]) / 4;
      const val = Math.max(0, Math.min(255, Math.round(128 + (avg - 128) * 1.18)));
      const idx = (y * mw + xx) * 3;
      md[idx] = md[idx + 1] = md[idx + 2] = val;
    }
    return { d: rgb, mip: { w: mw, h: mh, scale: 4, d: md } };
  },
  /** A shared in-flight request can be promoted from menu/demo to battle priority. */
  loadOne(n, priority = 'high') {
    if (!this.names.includes(n)) return Promise.resolve(false);
    const have = this.images.get(n); if (have && priority === 'high') have.fetchPriority = 'high';
    if (this.pending.has(n)) return this.pending.get(n);
    const request = new Promise((res) => {
      const im = new Image(); im.fetchPriority = priority; im.decoding = 'async'; this.images.set(n, im);
      im.onload = () => {
        try {
          const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(im, 0, 0); this.data[n] = { name: n, w: c.width, h: c.height, canvas: c, d: x.getImageData(0, 0, c.width, c.height).data };
        } catch (e) { /* холст недоступен — без текстуры */ }
        res(!!this.data[n]);
      };
      im.onerror = () => res(false);
      im.src = `assets/tex/${n}.png`;
    });
    this.pending.set(n, request); return request;
  },
  loadSurface(n, priority = 'high') {
    if (!this.surfaceNames.includes(n)) return Promise.resolve(false);
    const have = this.surfaceImages.get(n); if (have && priority === 'high') have.fetchPriority = 'high';
    if (this.surfacePending.has(n)) return this.surfacePending.get(n);
    const request = new Promise((res) => {
      const im = new Image(); im.fetchPriority = priority; im.decoding = 'async'; this.surfaceImages.set(n, im);
      im.onload = () => {
        try {
          const c = makeCanvas(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0);
          this.surfaceHi[n] = { name: n, w: c.width, h: c.height, canvas: c, scale: 4 };
        } catch (e) { /* остаётся обычный спрайт */ }
        res(!!this.surfaceHi[n]);
      };
      im.onerror = () => res(false);
      im.src = `assets/tex/surface/${n}.png`;
    });
    this.surfacePending.set(n, request); return request;
  },
  commonNames() { return this.names.filter(n => /^soldier_|^wpn_|^ent_/.test(n)); },
  loadCommon(priority = 'low') {
    const requests = this.commonNames().map(n => this.loadOne(n, priority));
    if (!this.commonReady) this.commonReady = Promise.all(requests);
    return this.commonReady;
  },
  /** Full-library compatibility for explicit tooling/tests; never called eagerly. */
  load() {
    if (this.ready) return this.ready;
    this.ready = Promise.all(this.names.map(n => this.loadOne(n)).concat(this.surfaceNames.map(n => this.loadSurface(n))));
    return this.ready;
  },
  mapAssets(id) {
    const map = typeof id === 'object' && id ? id : typeof MAP_BY_ID !== 'undefined' && MAP_BY_ID[id];
    const theme = map && typeof THEMES !== 'undefined' && THEMES[map.theme];
    if (!map || !theme) throw new Error('Не найдена карта для загрузки: ' + String(id));
    const names = new Set(), add = n => { if (typeof n === 'string' && this.names.includes(n)) names.add(n); };
    for (const n of Object.values(theme.ground.tex || {})) add(n);
    for (const shape of map.shapes || []) { add(shape.pal && shape.pal.tex); add(typeof MAT_DEFAULT !== 'undefined' && MAT_DEFAULT[shape.mat] && MAT_DEFAULT[shape.mat].tex); }
    // Floor planks are sampled directly in terrain_visual.js, outside sh.pal.
    if ((map.shapes || []).some(s => ['brick', 'wood'].includes(s.mat))) add('wood_light');
    const trees = { oak: ['tree_oak1', 'tree_oak2', 'tree_oak3'], birch: ['tree_birch1'], pine: ['tree_pine1', 'tree_pine2'], pineSnow: ['tree_pine_snow1', 'tree_pine_snow2'], haystack: ['haystack1'], alientree: ['alien_tree1', 'alien_tree2'],
      snowman: ['snowman1', 'snowman2'], igloo: ['igloo1'], iceCrystal: ['icecrystal1', 'icecrystal2'], cactus: ['cactus1', 'cactus2', 'cactus3'], palm: ['palm1', 'palm2', 'palm3'], deadtree: theme.id === 'volcano' ? ['deadtree_char1', 'deadtree_char2'] : ['deadtree1', 'deadtree2'],
      watertower: ['watertower1'], cottage: ['cottage1'], column: ['column1', 'column2'], pot: ['pot1', 'pot2'], drygrass: ['drygrass1', 'drygrass2', 'drygrass3', 'drygrass4'], crystal: ['crystal_c1', 'crystal_c2', 'crystal_m1', 'crystal_m2'], crystalBig: ['crystal_c1', 'crystal_c2', 'crystal_m1', 'crystal_m2'],
      obsidian: ['obsidian1', 'obsidian2'], lavarock: ['lavarock1', 'lavarock2'], spike: ['spike1', 'spike2'], skull: ['skull1'], bones: ['bones1'],
      alienplant: ['alienplant1', 'alienplant2'], pod: ['pod1'], tentacle: ['tentacle1'], rock: theme.id === 'tropical' ? ['rockb1', 'rockb2'] : ['rock1', 'rock2', 'rock3'], rockSnow: ['rocksnow1', 'rocksnow2'] };   /* декор из Blender: dev/blender/make_decor.py */
    for (const d of map.decor || []) for (const n of trees[d[0]] || []) add(n);
    for (const k of theme.scatter || []) for (const n of trees[k] || []) add(n);   // россыпь по поверхности (камни, кристаллы, кости)
    if (theme.scatterRock) for (const n of ['drygrass1', 'drygrass2', 'drygrass3', 'drygrass4']) add(n);
    if (theme.ground && theme.ground.ceiling === 'crystals') for (const n of ['crystal_c1', 'crystal_c2', 'crystal_m1', 'crystal_m2']) add(n);   // кристаллы на сводах
    if (theme.ground && theme.ground.ceiling === 'roots') for (const n of ['roots1', 'roots2', 'roots3']) add(n);   // корни в пещерах (terrain_visual.js)
    if (theme.liquid && theme.liquid.kind === 'lava') add('lava_surface');   // корка лавы (render.js, drawLiquid)
    if ((map.props || []).some(p => p[0] === 'lantern') || (map.shapes || []).some(s => s.mat === 'wood')) add('lantern1');   // фонари под деревянными потолками (terrain_visual.js) и props
    if (theme.weather === 'leaves') for (const n of ['leaf1', 'leaf2', 'leaf3', 'leaf4']) add(n);   // падающие листья (particles.js, погода)
    if (theme.ground && theme.ground.cap && theme.ground.cap.flowers) for (const n of ['flower1', 'flower2', 'flower3', 'flower4']) add(n);   // полевые цветы (decor.js, wildflowers)   // сухая трава по уступам каньона (decor.js, drygrass)
    if ((map.ladders || []).length) add('ladder_' + (theme.id === 'city' ? 'steelY' : theme.id === 'alien' ? 'steel' : 'wood'));   // лестницы из Blender (как в drawTacticalRoutes)
    // The cap uses these sprites even when a scatter list contains no explicit bush.
    const cap = theme.ground.cap;
    if (cap.blades && !cap.snow && !cap.bushPal) { add('bush1'); add('bush2'); }
    if (cap.blades && !cap.snow && !cap.glowBlades && (map.shapes || []).some(s => s.mat === 'brick')) add('ivy');   // плющ на кладке (как в drawSurfaceDetails)
    const surface = this.surfaceNames.filter(n => names.has(n));   // трава (валлей/замки/Alien), плющ, деревья и кусты — чёткие при приближении
    return { mapId: map.id, names: [...names], surface, panorama: MapArt.themeMap[theme.id] || 'valley' };
  },
  /** Await this before buildVisual/Net.ready; no arbitrary three-second fallback race. */
  loadForMap(id, priority = 'high') {
    let assets; try { assets = this.mapAssets(id); } catch (e) { return Promise.reject(e); }
    const base = this.commonNames().concat(assets.names), jobs = base.map(n => this.loadOne(n, priority));
    jobs.push(...assets.surface.map(n => this.loadSurface(n, priority)), MapArt.load(assets.panorama, priority));
    return Promise.all(jobs).then(results => ({ ...assets, failed: base.concat(assets.surface.map(n => 'surface/' + n), ['maps/' + assets.panorama]).filter((n, i) => !results[i]) }));
  },
};
TexLib.loadCommon('low');
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

