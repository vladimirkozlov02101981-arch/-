'use strict';
/* =========================================================
   Разрушаемый ландшафт: маска, материалы, текстурирование,
   разрушение, балки строителя, кодирование для сети
   ========================================================= */

/** удаляем мелкие отколовшиеся куски (и опционально мелкие пустоты) */
function cleanupMask(m, W, H, minSolid = 150, maxHole = 0) {
  const N = W * H; const vis = new Uint8Array(N); const q = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (vis[i]) continue;
    const v = m[i]; let qh = 0, qt = 0; q[qt++] = i; vis[i] = 1; let border = false;
    while (qh < qt) {
      const j = q[qh++]; const x = j % W, y = (j - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      if (x > 0 && !vis[j - 1] && m[j - 1] === v) { vis[j - 1] = 1; q[qt++] = j - 1; }
      if (x < W - 1 && !vis[j + 1] && m[j + 1] === v) { vis[j + 1] = 1; q[qt++] = j + 1; }
      if (y > 0 && !vis[j - W] && m[j - W] === v) { vis[j - W] = 1; q[qt++] = j - W; }
      if (y < H - 1 && !vis[j + W] && m[j + W] === v) { vis[j + W] = 1; q[qt++] = j + W; }
    }
    const kill = v === 1 ? qt < minSolid : (!border && qt < maxHole);
    if (kill) { const nv = v ? 0 : 1; for (let k = 0; k < qt; k++) m[q[k]] = nv; }
  }
}

/* ---------- тайлы шума для текстур (один раз на сессию) ---------- */
let _tiles = null;
function getTiles() {
  if (_tiles) return _tiles;
  const N = 256;
  const t1 = new Float32Array(N * N), t2 = new Float32Array(N * N), t3 = new Float32Array(N * N), tv = new Float32Array(N * N), tg = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    t1[i] = clamp(fbm2(x / 8, y / 8, 11, 3, 32, 32) * 0.95 + 0.5, 0, 1);
    t2[i] = clamp(fbm2(x / 16, y / 16, 23, 3, 16, 16) * 0.95 + 0.5, 0, 1);
    t3[i] = clamp(fbm2(x / 32, y / 32, 37, 4, 8, 8) * 0.95 + 0.5, 0, 1);
    tv[i] = clamp(fbm2(x / 64, y / 64, 53, 2, 4, 4) * 0.95 + 0.5, 0, 1);
    tg[i] = clamp(fbm2(x / 64, y / 2, 71, 3, 4, 128) * 1.1 + 0.5, 0, 1); // волокна дерева
  }
  const P = 128; const peb = new Float32Array(P * P); const pebc = new Uint8Array(P * P);
  const r = makeRng(777);
  for (let k = 0; k < 36; k++) {
    const cx = Math.floor(r() * P), cy = Math.floor(r() * P), rx = r.range(1.6, 4.4), ry = rx * r.range(0.6, 0.95), ci = (r() * 4) | 0;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const u = dx / rx, v = dy / ry; const d2 = u * u + v * v; if (d2 > 1) continue;
      const px = ((cx + dx) % P + P) % P, py = ((cy + dy) % P + P) % P;
      let b = 1.14 - 0.2 * (u + v) - d2 * 0.18; if (d2 > 0.72) b *= 0.72;
      peb[py * P + px] = b; pebc[py * P + px] = ci;
    }
  }
  _tiles = { t1, t2, t3, tv, tg, peb, pebc };
  return _tiles;
}

const COS8 = [1, 0.9238795325, 0.7071067812, 0.3826834324, 0, -0.3826834324, -0.7071067812, -0.9238795325];
const SIN8 = [0, 0.3826834324, 0.7071067812, 0.9238795325, 1, 0.9238795325, 0.7071067812, 0.3826834324];

/* Поверхностные спрайты и векторы сохраняют исходное разрешение при любом зуме.
   Холст 1x нужен только для старого renderer/отражений; native replay его не масштабирует. */
class TerrainSurface {
  constructor(terrain) {
    this.terrain = terrain; this.canvas = makeCanvas(terrain.W, terrain.H); this.ctx = this.canvas.getContext('2d');
    this.commands = []; this.bins = new Map(); this.damage = new Map(); this.sources = new Map(); this.gradients = new WeakMap();
    this.anchorPoint = null; this.size = 128; this.scratch = null; this.nativeSources = new Map();
  }
  anchor(x, y) { this.anchorPoint = x == null ? null : [Math.floor(x), Math.floor(y)]; }
  sprite(canvas, name, filter = 'none') { this.sources.set(canvas, { name, w: canvas.width, h: canvas.height, filter }); }
  recorder() {
    const layer = this, ctx = this.ctx, props = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'globalAlpha', 'globalCompositeOperation', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'filter'];
    let path = [], bounds = null, clips = [], stack = [];
    const point = (x, y) => { if (!bounds) bounds = [x, y, x, y]; else { bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y); } };
    const pathPoint = (kind, a) => {
      if (kind === 'arc') { point(a[0] - a[2], a[1] - a[2]); point(a[0] + a[2], a[1] + a[2]); }
      else if (kind === 'ellipse') { const r = Math.max(a[2], a[3]); point(a[0] - r, a[1] - r); point(a[0] + r, a[1] + r); }
      else if (kind === 'rect' || kind === 'roundRect') { point(a[0], a[1]); point(a[0] + a[2], a[1] + a[3]); }
      else if (kind !== 'closePath') for (let i = 0; i + 1 < a.length; i += 2) point(a[i], a[i + 1]);
    };
    const transformBounds = (b, m, pad) => {
      if (!b) return [0, 0, layer.terrain.W, layer.terrain.H];
      const out = [Infinity, Infinity, -Infinity, -Infinity];
      for (const x of [b[0], b[2]]) for (const y of [b[1], b[3]]) { const xx = m.a * x + m.c * y + m.e, yy = m.b * x + m.d * y + m.f; out[0] = Math.min(out[0], xx - pad); out[1] = Math.min(out[1], yy - pad); out[2] = Math.max(out[2], xx + pad); out[3] = Math.max(out[3], yy + pad); }
      return out;
    };
    const remember = (kind, args) => {
      const m = ctx.getTransform(), state = {};
      for (const key of props) { const value = ctx[key]; state[key] = value && typeof value === 'object' && layer.gradients.has(value) ? layer.gradients.get(value) : value; }
      let b = bounds, source = null;
      if (kind === 'drawImage') {
        const im = args[0]; let x, y, w, h;
        if (args.length === 9) [x, y, w, h] = args.slice(5); else if (args.length === 5) [x, y, w, h] = args.slice(1); else { x = args[1]; y = args[2]; w = im.width; h = im.height; }
        b = [Math.min(x, x + w), Math.min(y, y + h), Math.max(x, x + w), Math.max(y, y + h)]; source = layer.sources.get(im) || null;
      } else if (kind.endsWith('Rect')) { const [x, y, w, h] = args; b = [Math.min(x, x + w), Math.min(y, y + h), Math.max(x, x + w), Math.max(y, y + h)]; }
      else if (args[0] && typeof args[0] === 'object') b = null; // внешний Path2D (процедурная трава без загруженного спрайта)
      const cmd = { kind, args: args.slice(), state, matrix: [m.a, m.b, m.c, m.d, m.e, m.f], path: path.slice(), clips: clips.slice(), anchor: layer.anchorPoint && layer.anchorPoint.slice(), source,
        bounds: transformBounds(b, m, kind === 'stroke' || kind === 'strokeRect' ? Math.max(2, ctx.lineWidth * 2) : 2) };
      const id = layer.commands.length; layer.commands.push(cmd);
      const B = cmd.bounds, S = layer.size;
      for (let y = Math.max(0, Math.floor(B[1] / S)); y <= Math.min(Math.floor(layer.terrain.H / S), Math.floor(B[3] / S)); y++)
        for (let x = Math.max(0, Math.floor(B[0] / S)); x <= Math.min(Math.floor(layer.terrain.W / S), Math.floor(B[2] / S)); x++) { const key = x + ',' + y; let bin = layer.bins.get(key); if (!bin) layer.bins.set(key, bin = []); bin.push(id); }
    };
    const methods = new Set(['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'closePath']);
    return new Proxy(ctx, {
      get(target, key) {
        if (key === 'beginPath') return () => { path = []; bounds = null; target.beginPath(); };
        if (methods.has(key)) return (...args) => { path.push([key, args]); pathPoint(key, args); return target[key](...args); };
        if (key === 'fill' || key === 'stroke' || key === 'fillRect' || key === 'strokeRect' || key === 'drawImage') return (...args) => { remember(key, args); return target[key](...args); };
        if (key === 'save') return () => { stack.push(clips.slice()); target.save(); };
        if (key === 'restore') return () => { clips = stack.length ? stack.pop() : clips; target.restore(); };
        if (key === 'clip') return (...args) => { clips.push({ path: path.slice(), args: args.slice() }); target.clip(...args); };
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => {
          const gradient = target[key](...args), desc = { gradient: key, args, stops: [] };
          const add = gradient.addColorStop.bind(gradient); gradient.addColorStop = (at, color) => { desc.stops.push([at, color]); add(at, color); };
          layer.gradients.set(gradient, desc); return gradient;
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, key, value) { target[key] = value; return true; },
    });
  }
  visible(v) {
    const ids = new Set(), S = this.size;
    for (let y = Math.max(0, Math.floor(v.y0 / S)); y <= Math.min(Math.floor(this.terrain.H / S), Math.floor(v.y1 / S)); y++)
      for (let x = Math.max(0, Math.floor(v.x0 / S)); x <= Math.min(Math.floor(this.terrain.W / S), Math.floor(v.x1 / S)); x++) for (const id of this.bins.get(x + ',' + y) || []) ids.add(id);
    return [...ids].sort((a, b) => a - b);
  }
  replay(c, v) {
    for (const id of this.visible(v)) {
      const cmd = this.commands[id], b = cmd.bounds;
      if (b[0] > v.x1 || b[2] < v.x0 || b[1] > v.y1 || b[3] < v.y0 || cmd.anchor && !this.terrain.isSolid(cmd.anchor[0], cmd.anchor[1])) continue;
      c.save(); c.transform(...cmd.matrix);
      for (const [key, value] of Object.entries(cmd.state)) {
        if (value && value.gradient) { const gradient = c[value.gradient](...value.args); for (const stop of value.stops) gradient.addColorStop(...stop); c[key] = gradient; } else c[key] = value;
      }
      for (const clip of cmd.clips) { c.beginPath(); for (const [method, args] of clip.path) c[method](...args); c.clip(...clip.args); }
      const args = cmd.args.slice();
      if (cmd.kind === 'drawImage' && cmd.source && typeof TexLib !== 'undefined') {
        const high = TexLib.surfaceHi && TexLib.surfaceHi[cmd.source.name];
        if (high && high.canvas) {
          const cacheKey = cmd.source.name + ':' + cmd.source.filter; let cached = this.nativeSources.get(cacheKey);
          if (!cached || cached.original !== high.canvas) {
            let image = high.canvas;
            if (cmd.source.filter !== 'none') { image = makeCanvas(high.canvas.width, high.canvas.height); const ic = image.getContext('2d'); ic.filter = cmd.source.filter; ic.drawImage(high.canvas, 0, 0); }
            cached = { original: high.canvas, image }; this.nativeSources.set(cacheKey, cached);
          }
          args[0] = cached.image;
          if (args.length === 9) { const rx = (high.w || high.canvas.width) / cmd.source.w, ry = (high.h || high.canvas.height) / cmd.source.h; args[1] *= rx; args[2] *= ry; args[3] *= rx; args[4] *= ry; }
          else if (args.length === 3) args.push(cmd.source.w, cmd.source.h);
          c.imageSmoothingQuality = 'high';
        }
      }
      if (cmd.kind === 'fill' || cmd.kind === 'stroke') { c.beginPath(); for (const [method, a] of cmd.path) c[method](...a); }
      c[cmd.kind](...args); c.restore();
    }
  }
  damageTile(tx, ty) {
    const key = tx + ',' + ty; let tile = this.damage.get(key);
    if (!tile) { const canvas = makeCanvas(this.size, this.size); tile = { canvas, ctx: canvas.getContext('2d'), x: tx * this.size, y: ty * this.size }; this.damage.set(key, tile); }
    return tile;
  }
  damageBlast(B) {
    const S = this.size, cells = new Map(), mask = this.terrain.mask, W = this.terrain.W;
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) {
      if (!B.reached[y * B.w + x]) continue;
      const px = B.x0 + x, py = B.y0 + y; if (mask[py * W + px]) continue;
      const tx = Math.floor(px / S), ty = Math.floor(py / S), key = tx + ',' + ty;
      let cell = cells.get(key); if (!cell) { const tile = this.damageTile(tx, ty); cell = { tile, image: tile.ctx.getImageData(0, 0, S, S) }; cells.set(key, cell); }
      cell.image.data[((py - cell.tile.y) * S + px - cell.tile.x) * 4 + 3] = 255;
    }
    for (const cell of cells.values()) cell.tile.ctx.putImageData(cell.image, 0, 0);
  }
  damageLine(x1, y1, x2, y2, r) {
    const S = this.size, W = this.terrain.W, H = this.terrain.H;
    for (let ty = Math.max(0, Math.floor((Math.min(y1, y2) - r - 3) / S)); ty <= Math.min(Math.floor((H - 1) / S), Math.floor((Math.max(y1, y2) + r + 3) / S)); ty++)
      for (let tx = Math.max(0, Math.floor((Math.min(x1, x2) - r - 3) / S)); tx <= Math.min(Math.floor((W - 1) / S), Math.floor((Math.max(x1, x2) + r + 3) / S)); tx++) {
        const tile = this.damageTile(tx, ty), c = tile.ctx; c.save(); c.translate(-tile.x, -tile.y); c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineWidth = r * 2 + 4;
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.restore();
      }
  }
  damagePoints(points) {
    const cells = new Map(), S = this.size, W = this.terrain.W;
    for (const i of points) { const x = i % W, y = Math.floor(i / W), tx = Math.floor(x / S), ty = Math.floor(y / S), key = tx + ',' + ty;
      let cell = cells.get(key); if (!cell) { const tile = this.damageTile(tx, ty); cell = { tile, image: tile.ctx.getImageData(0, 0, S, S) }; cells.set(key, cell); }
      cell.image.data[((y - cell.tile.y) * S + x - cell.tile.x) * 4 + 3] = 255;
    }
    for (const cell of cells.values()) cell.tile.ctx.putImageData(cell.image, 0, 0);
  }
  draw(c, v, scale) {
    if (!this.commands.length) return false;
    if (!this.damage.size) { this.replay(c, v); return true; }
    const x0 = Math.max(0, Math.floor(v.x0)), y0 = Math.max(0, Math.floor(v.y0)), x1 = Math.min(this.terrain.W, Math.ceil(v.x1)), y1 = Math.min(this.terrain.H, Math.ceil(v.y1)), w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return true;
    const pw = Math.max(1, Math.ceil(w * scale)), ph = Math.max(1, Math.ceil(h * scale));
    if (!this.scratch) this.scratch = makeCanvas(pw, ph);
    if (this.scratch.width !== pw || this.scratch.height !== ph) { this.scratch.width = pw; this.scratch.height = ph; }
    const sc = this.scratch.getContext('2d'); sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, pw, ph); sc.setTransform(pw / w, 0, 0, ph / h, -x0 * pw / w, -y0 * ph / h);
    this.replay(sc, { x0, y0, x1, y1 });
    sc.save(); sc.globalCompositeOperation = 'destination-out'; sc.imageSmoothingEnabled = false;
    for (const tile of this.damage.values()) if (tile.x <= x1 && tile.x + this.size >= x0 && tile.y <= y1 && tile.y + this.size >= y0) sc.drawImage(tile.canvas, tile.x, tile.y);
    sc.restore(); c.drawImage(this.scratch, 0, 0, pw, ph, x0, y0, w, h); return true;
  }
}

/* ---------- класс ландшафта ---------- */
class Terrain {
  constructor(W, H, mask) {
    this.W = W; this.H = H; this.mask = mask;
    this.canvas = makeCanvas(W, H); this.ctx = this.canvas.getContext('2d');
    this.decor = makeCanvas(W, H); this.dctx = this.decor.getContext('2d');
    this.glow = null; this.gctx = null;
    this.surface = null;
    this.scorch = [20, 10, 5];
    this.version = 0; this.touches = [];   // изменённые области (для кэша чёткой карты)
  }
  drawSurfaceNative(c, v, scale = 1) { return this.surface ? this.surface.draw(c, v, Math.max(0.25, scale)) : false; }
  isSolid(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x >= this.W || y < 0) return false;
    if (y >= this.H) return true;
    return this.mask[y * this.W + x] === 1;
  }
  normalAt(x, y, r = 4) {
    let nx = 0, ny = 0; x = Math.round(x); y = Math.round(y);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      if (this.isSolid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
    }
    const l = Math.hypot(nx, ny); if (l < 0.001) return { x: 0, y: -1 };
    return { x: nx / l, y: ny / l };
  }
  materialAt(x,y) {
    x=Math.floor(x);y=Math.floor(y);
    if(x<0||y<0||x>=this.W||y>=this.H||!this.isSolid(x,y))return 0;
    return this.materials ? this.materials[y*this.W+x] || 1 : 1;
  }
  raycast(x0, y0, dx, dy, maxLen, step = 1) {
    for (let d = 0; d <= maxLen; d += step) if (this.isSolid(x0 + dx * d, y0 + dy * d)) return d;
    return -1;
  }
  // Traverse every crossed mask cell; fast bullets cannot skip one-pixel cover.
  segmentHit(x0, y0, x1, y1) {
    const dx=x1-x0,dy=y1-y0,sx=Math.sign(dx),sy=Math.sign(dy);
    let x=Math.floor(x0),y=Math.floor(y0),t=0;
    const tx=dx ? Math.abs(1/dx) : Infinity,ty=dy ? Math.abs(1/dy) : Infinity;
    let nextX=dx ? ((sx>0 ? x+1 : x)-x0)/dx : Infinity;
    let nextY=dy ? ((sy>0 ? y+1 : y)-y0)/dy : Infinity;
    const limit=Math.abs(Math.floor(x1)-x)+Math.abs(Math.floor(y1)-y)+3;
    for(let i=0;i<limit&&t<=1;i++) {
      if(this.isSolid(x,y))return {x:x0+dx*t,y:y0+dy*t,t,material:this.materialAt(x,y)};
      if(nextX<nextY){t=nextX;nextX+=tx;x+=sx;}
      else {t=nextY;nextY+=ty;y+=sy;}
    }
    return null;
  }
  findTop(x, fromY = 0) {
    for (let y = Math.max(0, fromY); y < this.H; y++) if (this.isSolid(x, y)) return y;
    return this.H;
  }
  maskCircle(cx, cy, r) {
    const W = this.W, H = this.H, m = this.mask;
    const y0 = Math.max(0, cy - r), y1 = Math.min(H - 1, cy + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy; const dx = Math.floor(Math.sqrt(r * r - dy * dy));
      const xa = Math.max(0, cx - dx), xb = Math.min(W - 1, cx + dx);
      if (xa <= xb) m.fill(0, y * W + xa, y * W + xb + 1);
    }
  }
  /** стирает на слое все пиксели, которых больше нет в маске (в квадрате вокруг воронки) — края чёткие, без полупрозрачности */
  clearMasked(ctx, cx, cy, r) {
    if (!ctx) return;
    const W = this.W, H = this.H, m = this.mask, x0 = Math.max(0, cx - r - 2), y0 = Math.max(0, cy - r - 2), x1 = Math.min(W, cx + r + 3), y1 = Math.min(H, cy + r + 3);
    const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return;
    let img; try { img = ctx.getImageData(x0, y0, w, h); } catch (e) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill(); ctx.restore(); return; }
    const d = img.data;
    for (let y = 0; y < h; y++) { const row = (y0 + y) * W + x0; for (let x = 0; x < w; x++) if (!m[row + x]) { const dx = x0 + x - cx, dy = y0 + y - cy; if (dx * dx + dy * dy <= (r + 1.5) * (r + 1.5)) d[(y * w + x) * 4 + 3] = 0; } }
    ctx.putImageData(img, x0, y0);
  }
  /** взрыв как настоящая волна: из центра расходятся лучи. В воздухе луч теряет силу с расстоянием, в материале — по его прочности
      (земля и дерево рвутся широко, камень и кирпич дают пролом, бетон и металл — более узкую воронку). Перекрытие, которое не пробито, заслоняет всё за собой:
      помещение по ту сторону не страдает. Шум прочности детерминированный — у обоих игроков воронка одинаковая.
      Возвращает карту достигнутых волной пикселей в квадрате вокруг центра */
  blastRays(cx, cy, r) {
    const W = this.W, H = this.H, m = this.mask, mt = this.materials;
    /* Глубина разрушения: земля, скала, кирпич, дерево, бетон, металл, лёд, кристалл, базальт. */
    const K = [1, 1.12, 0.8, 0.76, 1.1, 0.56, 0.36, 0.8, 0.72, 0.72];
    const x0 = Math.max(0, cx - r - 1), y0 = Math.max(0, cy - r - 1), x1 = Math.min(W, cx + r + 2), y1 = Math.min(H, cy + r + 2), w = x1 - x0, h = y1 - y0;
    const reached = new Uint8Array(Math.max(0, w * h)); if (w <= 0 || h <= 0) return { reached, x0, y0, w, h };
    const rays = Math.ceil(TAU * r * 1.6) + 8, st = 0.7;
    const kill = [];
    for (let a = 0; a < rays; a++) {
      const ang = a / rays * TAU, dx = Math.cos(ang), dy = Math.sin(ang);
      let e = r;
      for (let t = 0; t <= r; t += st) {
        const px = Math.round(cx + dx * t), py = Math.round(cy + dy * t);
        if (px < x0 || px >= x1 || py < y0 || py >= y1) break;
        const i = py * W + px;
        if (m[i]) {
          let hsh = (Math.imul(px >> 2, 73856093) ^ Math.imul(py >> 2, 19349663)) >>> 0; hsh = ((hsh ^ (hsh >>> 13)) * 1274126177) >>> 0;
          const k = mt ? K[mt[i] || 1] || 1 : 1, cost = st / k * (0.8 + 0.4 * ((hsh & 1023) / 1023));
          e -= cost; if (e <= 0) break;
          kill.push(i);
        } else e -= st;
        if (e <= 0) break;
        reached[(py - y0) * w + (px - x0)] = 1;
      }
    }
    for (const i of kill) m[i] = 0;
    return { reached, x0, y0, w, h };
  }
  /** стирает с холста всё, до чего дошла волна и чего больше нет в маске; scorch — опалить уцелевшую кромку рядом с выбитым */
  applyBlast(ctx, B, scorch, col) {
    if (!ctx || !(B.w > 0 && B.h > 0)) return;
    let img; try { img = ctx.getImageData(B.x0, B.y0, B.w, B.h); } catch (e) { return; }
    const d = img.data, m = this.mask, W = this.W, R = B.reached, w = B.w, h = B.h;
    const cleared = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = y * w + x; if (R[q] && !m[(B.y0 + y) * W + B.x0 + x]) { d[q * 4 + 3] = 0; cleared[q] = 1; } }
    if (scorch && col) {
      // копоть: уцелевшие пиксели в 5 px от выбитых темнеют к краю воронки
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const q = y * w + x; if (cleared[q] || !m[(B.y0 + y) * W + B.x0 + x] || d[q * 4 + 3] === 0) continue;
        let best = 9;
        for (let dy = -5; dy <= 5 && best > 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -5; dx <= 5; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; if (cleared[yy * w + xx]) { const dd = Math.abs(dx) + Math.abs(dy); if (dd < best) best = dd; } } }
        if (best > 6) continue;
        const k = 0.85 * (1 - (best - 1) / 6);
        d[q * 4] += (col[0] * 0.5 - d[q * 4]) * k; d[q * 4 + 1] += (col[1] * 0.5 - d[q * 4 + 1]) * k; d[q * 4 + 2] += (col[2] * 0.5 - d[q * 4 + 2]) * k;
      }
    }
    ctx.putImageData(img, B.x0, B.y0);
  }
  carve(cx, cy, r, scorch = true) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r); if (r <= 0) return;
    const B = this.blastRays(cx, cy, r);
    this.applyBlast(this.ctx, B, scorch, this.scorch);
    this.applyBlast(this.dctx, B, false);   // задняя стена и декор — только там, куда дошла волна (за целым перекрытием всё остаётся)
    this.applyBlast(this.gctx, B, false);
    if (this.surface) { this.applyBlast(this.surface.ctx, B, false); this.surface.damageBlast(B); }
    this.touches.push([cx - r - 8, cy - r - 8, cx + r + 8, cy + r + 8]); this.version++;
  }
  carveLine(x1, y1, x2, y2, r) {
    x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2); r = Math.round(r);
    const len = Math.hypot(x2 - x1, y2 - y1); const n = Math.max(1, Math.ceil(len / Math.max(1, r * 0.5)));
    for (let i = 0; i <= n; i++) this.maskCircle(Math.round(x1 + (x2 - x1) * i / n), Math.round(y1 + (y2 - y1) * i / n), r);
    const c = this.ctx; c.save(); c.lineCap = 'round';
    c.globalCompositeOperation = 'destination-out'; c.lineWidth = r * 2;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.globalCompositeOperation = 'source-atop';
    const [sr, sg, sb] = this.scorch;
    c.strokeStyle = `rgba(${sr},${sg},${sb},0.55)`; c.lineWidth = r * 2 + 8; c.stroke();
    c.strokeStyle = `rgba(${sr},${sg},${sb},0.3)`; c.lineWidth = r * 2 + 16; c.stroke();
    c.restore();
    for (const cx of [this.dctx, this.gctx, this.surface && this.surface.ctx]) {
      if (!cx) continue; cx.save(); cx.globalCompositeOperation = 'destination-out'; cx.lineCap = 'round'; cx.lineWidth = r * 2 + 4;
      cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.stroke(); cx.restore();
    }
    if (this.surface) this.surface.damageLine(x1, y1, x2, y2, r);
    this.touches.push([Math.min(x1, x2) - r - 10, Math.min(y1, y2) - r - 10, Math.max(x1, x2) + r + 10, Math.max(y1, y2) + r + 10]); this.version++;
  }
  /** уборка после хода: срезает одиночные пиксели-занозы и мелкие бугорки на поверхностях и убирает висящую крошку
      (мелкие оторванные кусочки) в изменённых областях — по рваному краю воронки бойцы шли рывками.
      Детерминированно по маске: на обоих компьютерах онлайн-игры даёт одинаковый результат */
  tidy(boxes) {
    const W = this.W, H = this.H, m = this.mask, removed = [];
    const kill = (i) => { if (m[i]) { m[i] = 0; removed.push(i); } };
    for (const b of boxes) {
      const x0 = Math.max(1, b[0] | 0), y0 = Math.max(1, b[1] | 0), x1 = Math.min(W - 2, b[2] | 0), y1 = Math.min(H - 2, b[3] | 0);
      if (x1 <= x0 || y1 <= y0) continue;
      for (let pass = 0; pass < 3; pass++) {
        // занозы: твёрдый пиксель, у которого не больше одного твёрдого соседа
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = y * W + x; if (!m[i]) continue;
          if (m[i - 1] + m[i + 1] + m[i - W] + m[i + W] <= 1) kill(i);
        }
        // бугорки шириной 1–2 px и высотой до 3 px на открытой сверху поверхности
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = y * W + x; if (!m[i] || m[i - W]) continue;
          for (const wdt of [1, 2]) {
            if (x + wdt > x1) continue; let ok = true;
            for (let k = 1; k < wdt; k++) if (!m[i + k] || m[i + k - W]) ok = false;
            if (!ok) continue;
            const l = i - 1, r = i + wdt; let h = 0;
            while (h < 4 && !m[l + h * W] && !m[r + h * W]) h++;
            if (h >= 1 && h <= 3) { for (let q = 0; q < h; q++) for (let k = 0; k < wdt; k++) kill(i + q * W + k); break; }
          }
        }
      }
      // крошка: связные кусочки меньше 40 пикселей
      const seen = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x, si = (y - y0) * (x1 - x0 + 1) + x - x0; if (!m[i] || seen[si]) continue;
        const st = [i], comp = []; seen[si] = 1; let big = false;
        while (st.length) {
          const j = st.pop(); comp.push(j); if (comp.length > 40) { big = true; break; }
          const jx = j % W, jy = (j / W) | 0;
          for (const n of [j - 1, j + 1, j - W, j + W]) {
            if (!m[n]) continue; const nx = n % W, ny = (n / W) | 0;
            if (nx < x0 || nx > x1 || ny < y0 || ny > y1) { big = true; break; }   // уходит за область — часть массива
            const sn = (ny - y0) * (x1 - x0 + 1) + nx - x0; if (!seen[sn]) { seen[sn] = 1; st.push(n); }
          }
          if (big) break; void jx; void jy;
        }
        if (!big) for (const j of comp) kill(j);
      }
    }
    if (!removed.length) return 0;
    // стираем убранные пиксели и с картинки ландшафта
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
    for (const i of removed) { const x = i % W, y = (i / W) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    try {
      const img = this.ctx.getImageData(bx0, by0, bw, bh), d = img.data;
      for (const i of removed) { const x = i % W - bx0, y = ((i / W) | 0) - by0; d[(y * bw + x) * 4 + 3] = 0; }
      this.ctx.putImageData(img, bx0, by0);
    } catch (e) { /* без холста (тесты) */ }
    if (this.surface) this.surface.damagePoints(removed);
    this.touches.push([bx0 - 2, by0 - 2, bx1 + 2, by1 + 2]); this.version++;
    return removed.length;
  }
  /** балка строителя: ai — индекс угла 0..7 (шаг 22.5°) */
  addGirder(cx, cy, ai, len = 96, thick = 12) {
    cx = Math.round(cx); cy = Math.round(cy); ai = ((ai % 8) + 8) % 8;
    const ca = COS8[ai], sa = SIN8[ai], hl = len / 2, ht = thick / 2;
    const ex = Math.ceil(Math.abs(ca) * hl + Math.abs(sa) * ht) + 1, ey = Math.ceil(Math.abs(sa) * hl + Math.abs(ca) * ht) + 1;
    for (let y = Math.max(0, cy - ey); y <= Math.min(this.H - 1, cy + ey); y++) {
      for (let x = Math.max(0, cx - ex); x <= Math.min(this.W - 1, cx + ex); x++) {
        const dx = x - cx, dy = y - cy; const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
        if (u >= -hl && u <= hl && v >= -ht && v <= ht) this.mask[y * this.W + x] = 1;
      }
    }
    drawGirder(this.ctx, cx, cy, Math.atan2(sa, ca), len, thick);
    this.touches.push([cx - ex - 4, cy - ey - 4, cx + ex + 4, cy + ey + 4]); this.version++;
  }
  encodeMask() {
    const W = this.W, H = this.H, m = this.mask; const rows = new Array(H);
    for (let y = 0; y < H; y++) {
      let cur = 0, run = 0; const parts = []; const o = y * W;
      for (let x = 0; x < W; x++) { const v = m[o + x]; if (v === cur) run++; else { parts.push(run.toString(36)); cur = v; run = 1; } }
      parts.push(run.toString(36)); rows[y] = parts.join(',');
    }
    return rows.join('|');
  }
  static decodeMask(str, W, H) {
    const m = new Uint8Array(W * H); const rows = str.split('|');
    for (let y = 0; y < H && y < rows.length; y++) {
      const parts = rows[y].split(','); let x = 0, cur = 0; const o = y * W;
      for (const p of parts) { const n = parseInt(p, 36) || 0; if (cur && n > 0) m.fill(1, o + x, o + Math.min(W, x + n)); x += n; cur ^= 1; }
    }
    return m;
  }
}

function drawGirder(c, cx, cy, ang, len, thick) {
  c.save(); c.translate(cx, cy); c.rotate(ang);
  const hl = len / 2, ht = thick / 2;
  const g = c.createLinearGradient(0, -ht, 0, ht);
  g.addColorStop(0, '#ffb347'); g.addColorStop(0.45, '#e0661f'); g.addColorStop(1, '#8a3510');
  c.fillStyle = g; c.fillRect(-hl, -ht, len, thick);
  c.fillStyle = 'rgba(40,14,4,0.75)';
  const n = Math.floor(len / 14);
  for (let i = 0; i < n; i++) {
    const x0 = -hl + 4 + i * 14;
    c.beginPath();
    if (i % 2) { c.moveTo(x0, -ht + 3); c.lineTo(x0 + 10, -ht + 3); c.lineTo(x0 + 5, ht - 3); }
    else { c.moveTo(x0, ht - 3); c.lineTo(x0 + 10, ht - 3); c.lineTo(x0 + 5, -ht + 3); }
    c.closePath(); c.fill();
  }
  c.strokeStyle = '#4a1d08'; c.lineWidth = 1.5; c.strokeRect(-hl + 0.75, -ht + 0.75, len - 1.5, thick - 1.5);
  c.fillStyle = 'rgba(255,230,180,0.6)'; c.fillRect(-hl + 1, -ht + 1, len - 2, 1.2);
  c.fillStyle = '#5a2308';
  for (const x of [-hl + 3, hl - 3]) for (const y of [-ht + 3, ht - 3]) { c.beginPath(); c.arc(x, y, 1.1, 0, TAU); c.fill(); }
  c.restore();
}
