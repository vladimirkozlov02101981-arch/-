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
  names: ['dirt_valley', 'brick_keep', 'brick_light', 'cave_wall', 'grass_valley', 'tree_oak1', 'tree_oak2', 'tree_oak3', 'tree_pine1', 'tree_pine2', 'tree_birch1', 'bush1', 'bush2'],
  data: {},
  ready: null,
  load() {
    if (this.ready) return this.ready;
    this.ready = Promise.all(this.names.map((n) => new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(im, 0, 0); this.data[n] = { w: c.width, h: c.height, canvas: c, d: x.getImageData(0, 0, c.width, c.height).data };
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
