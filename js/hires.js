'use strict';
/* Чёткая карта при приближении.
   Ландшафт хранится 1 пиксель на игровую единицу; при сильном зуме обычное растяжение даёт «мыло» и ступеньки пикселей.
   Видимые участки (плитки 128×128) по мере надобности пересчитываются в 4 раза крупнее:
   1) края (границы слоёв, контур земли) сглаживаются вдоль своего направления — ступеньки превращаются в ровные линии,
      поперёк края добавляется резкость, контур на фоне неба остаётся чётким;
   2) поверх накладывается мелкий рельеф материала из фото-текстуры (4 текселя на единицу) — меняется только светотень;
   3) если у материала есть родной цвет высокого разрешения (TexLib.native), цвет берётся из него, а освещение карты
      переносится отношением L = «нарисованный пиксель» / «пиксель малой текстуры» — так резкими становятся сами края
      камней, швы и трещины, а не только зерно поверх.
   Плитки кэшируются и пересчитываются только там, где ландшафт изменился (взрыв, балка). */
const HIRES_T = 128, HIRES_S = 4, HIRES_P = 5, HIRES_G = 1, HIRES_BUDGET = 160 * 1048576;

class HiResTerrain {
  constructor() {
    this.tiles = new Map(); this.bytes = 0; this.scale = HIRES_S; this.terr = null; this.ver = -1; this.nTouch = 0; this.frame = 0;
    this.det = null; this.detKey = null;
    const w = HIRES_T + 2 * HIRES_P;
    this.src = makeCanvas(w, w); this.sx = this.src.getContext('2d', { willReadFrequently: false });
  }
  /** сколько карт деталей уже загружено — когда приходят новые, плитки пересчитываются */
  hiCount(terr) {
    const tab = terr.texRef ? terr.texRef.tab : [], names = new Set(); let n = 0;
    for (let i = 1; i < tab.length; i++) if (tab[i]) names.add(tab[i].name);
    for (const nm of names) {
      if (TexLib.loadNative && TexLib.loadNative(nm)) { n += 100; continue; }   // родной цвет заменяет старые детали
      if (TexLib.loadHi(nm) || TexLib.hi[nm]) n++; if (TexLib.loadFine(nm) || TexLib.fine[nm]) n++;
    }
    return n;
  }
  sync(terr, scale = this.scale) {
    if (!this.pending) this.pending = new Set();
    const hc = this.hiCount(terr);
    if (terr !== this.terr || hc !== this.hc || scale !== this.scale) { this.scale = scale; this.tiles.clear(); this.bytes = 0; this.gen = new Map(); this.pending.clear(); this.epoch = (this.epoch || 0) + 1; this.hc = hc; this.terr = terr; this.ver = terr.version; this.nTouch = (terr.touches || []).length; return; }
    if (terr.version === this.ver) return;
    const T = terr.touches || [];
    if (T.length === this.nTouch) { this.tiles.clear(); this.bytes = 0; this.gen = new Map(); this.pending.clear(); }   // перерисовка целиком
    else for (let i = this.nTouch; i < T.length; i++) {
      const [x0, y0, x1, y1] = T[i], m = HIRES_P + 1;
      for (let ty = Math.floor((y0 - m) / HIRES_T); ty <= Math.floor((y1 + m) / HIRES_T); ty++)
        for (let tx = Math.floor((x0 - m) / HIRES_T); tx <= Math.floor((x1 + m) / HIRES_T); tx++) { const k = tx + ',' + ty; const tile = this.tiles.get(k); if (tile) this.bytes -= tile.bytes; this.tiles.delete(k); this.gen.set(k, (this.gen.get(k) || 0) + 1); this.pending.delete(k); }
    }
    this.nTouch = T.length; this.ver = terr.version;
  }
  /** фоновые потоки: тяжёлый попиксельный расчёт не тормозит игру */
  pool() {
    if (this.workers !== undefined) return this.workers;
    this.workers = null; this.queue = []; this.busy = 0; this.gen = new Map();
    try {
      const url = URL.createObjectURL(new Blob(['(' + hiresWorkerMain.toString() + ')()'], { type: 'text/javascript' }));
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
      this.workers = [];
      for (let i = 0; i < n; i++) {
        const wk = new Worker(url); wk.idle = true; wk.hiSent = new Set(); wk.fineSent = new Set();
        wk.onmessage = (ev) => this.done(wk, ev.data); wk.onerror = () => { wk.idle = true; };
        this.workers.push(wk);
      }
    } catch (e) { this.workers = null; }
    return this.workers;
  }
  request(sc, tx, ty) {
    const T = HIRES_T, P = HIRES_P, w = T + 2 * P, terr = sc.terrain, key = tx + ',' + ty;
    const wk = this.workers.find(o => o.idle); if (!wk) return false;
    const x0 = tx * T - P, y0 = ty * T - P, sx = this.sx;
    sx.clearRect(0, 0, w, w); sx.drawImage(terr.decor, x0, y0, w, w, 0, 0, w, w); sx.drawImage(terr.canvas, x0, y0, w, w, 0, 0, w, w);
    const src = sx.getImageData(0, 0, w, w).data;
    // твёрдое/воздух: контур сглаживается и там, где за воздухом задняя стена (пещеры, комнаты, уступы со снегом) — не только на фоне неба
    const mk = new Uint8Array(w * w), TM = terr.mask, TW = terr.W, TH = terr.H;
    for (let y = 0; y < w; y++) { const gy = y0 + y; if (gy < 0) continue; for (let x = 0; x < w; x++) { const gx = x0 + x; if (gx < 0 || gx >= TW) continue; mk[y * w + x] = gy >= TH ? 1 : TM[gy * TW + gx]; } }
    // ссылки на текстуры: какой пиксель из какой текстуры (перед — твёрдое, иначе задняя стена)
    const R = terr.texRef, W = sc.W, H = sc.H, ref = new Uint8Array(w * w), tab = {}, lb = new Uint16Array(w * w), transfer = [src.buffer, ref.buffer, mk.buffer, lb.buffer];
    // материал пикселя (как labelAt в js/terrain_gl.js): 0 — воздух, иначе texRef + 1, у переднего твёрдого слоя ещё + 256
    if (R) for (let y = 0; y < w; y++) {
      const gy = y0 + y; if (gy < 0 || gy >= H) continue;
      for (let x = 0; x < w; x++) { const gx = x0 + x; if (gx < 0 || gx >= W || src[(y * w + x) * 4 + 3] < 128) continue; const i = gy * W + gx; lb[y * w + x] = terr.mask[i] ? 257 + R.F[i] : 1 + R.B[i]; }
    }
    let LF = null;
    if (R) for (let y = 0; y < w; y++) {
      const gy = y0 + y; if (gy < 0 || gy >= H) continue;
      for (let x = 0; x < w; x++) {
        const gx = x0 + x; if (gx < 0 || gx >= W) continue;
        const i = gy * W + gx, id = terr.mask[i] ? R.F[i] : R.B[i]; if (!id) continue;
        const e = R.tab[id]; if (!e) continue;
        const nat = TexLib.native && TexLib.native[e.name], low = nat && TexLib.data[e.name];
        // старая серая деталь (hi) была для прежней малой текстуры — с родным цветом не нужна; фото-зерно fine независимо и остаётся
        const hi = !nat && TexLib.hi[e.name], fine = TexLib.fine[e.name]; if (!hi && !fine && !low) continue;
        ref[y * w + x] = id;
        if (!tab[id]) {
          tab[id] = { name: e.name, dx: e.dx, dy: e.dy, k: hi ? hi.w / e.w : 0, nk: low ? nat.k : 0 };
          if (low) { const crop = nativeCrop(nat, tx, ty, e.dx, e.dy); tab[id].crop = crop; transfer.push(crop.d.buffer); }
          if (hi && !wk.hiSent.has(e.name)) { wk.postMessage({ hi }); wk.hiSent.add(e.name); }
          if (fine && !wk.fineSent.has(e.name)) { wk.postMessage({ fine: { name: fine.name, w: fine.w, h: fine.h, scale: fine.scale, d: fine.d, mip: fine.mip } }); wk.fineSent.add(e.name); }
        }
        if (low) {
          // освещение карты в этом пикселе: нарисованный цвет / цвет малой текстуры (то же место, тот же сдвиг)
          if (!LF) { LF = new Float32Array(w * w * 3); transfer.push(LF.buffer); }
          const j = (y * w + x) * 4, u = ((gx + e.dx) % e.w + e.w) % e.w, v = ((gy + e.dy) % e.h + e.h) % e.h, q = (v * low.w + u) * 4, o = (y * w + x) * 3, dd = low.d;
          const lc = src[j] * 0.3 + src[j + 1] * 0.59 + src[j + 2] * 0.11, ld = Math.max(8, dd[q] * 0.3 + dd[q + 1] * 0.59 + dd[q + 2] * 0.11);
          for (let c = 0; c < 3; c++) { const D = dd[q + c], l = D >= 8 ? src[j + c] / D : lc / ld; LF[o + c] = l > 6 ? 6 : l; }   // тёмный канал — по яркости, без выбросов
        }
      }
    }
    // поле освещения не сглаживается: в нём и резкость запекания карты (местный контраст), без неё родной цвет выглядит плоским
    wk.idle = false; this.pending.add(key);
    wk.postMessage({ key, g: this.gen.get(key) || 0, ep: this.epoch, tx, ty, T, S: this.scale, P, G: HIRES_G, src, ref, tab, LF, mk, lb }, transfer);
    return true;
  }
  done(wk, m) {
    wk.idle = true;
    if (m.ep !== this.epoch || (this.gen.get(m.key) || 0) !== m.g) return;   // плитка устарела (взрыв, смена карты, пришли детали)
    this.pending.delete(m.key);
    const N = (HIRES_T + 2 * HIRES_G) * this.scale, cv = makeCanvas(N, N);
    if (m.out) cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.out), N, N), 0, 0);
    const old = this.tiles.get(m.key); if (old) this.bytes -= old.bytes;
    const bytes = N * N * 4; this.tiles.set(m.key, { cv, bytes, used: this.frame, dist: 0 }); this.bytes += bytes;
  }
  /** рисует видимую часть ландшафта; false — увеличение не нужно (рисуется как обычно) */
  draw(c, sc, v, zp) {
    if (zp < 1.15 || typeof window !== 'undefined' && window.__noHiRes) return false;
    if (!this.pool()) return false;
    const terr = sc.terrain; if (!this.gen) this.gen = new Map();
    const vw = Math.max(0, Math.min(sc.W, v.x1) - Math.max(0, v.x0)), vh = Math.max(0, Math.min(sc.H, v.y1) - Math.max(0, v.y0));
    const maxTiles = (Math.ceil(vw / HIRES_T) + 1) * (Math.ceil(vh / HIRES_T) + 1), largeBytes = Math.pow((HIRES_T + 2 * HIRES_G) * 8, 2) * 4;
    const scale = zp > 3.5 && maxTiles * largeBytes <= HIRES_BUDGET ? 8 : HIRES_S;
    this.sync(terr, scale); this.frame++;
    const T = HIRES_T, tx0 = Math.max(0, Math.floor(v.x0 / T)), ty0 = Math.max(0, Math.floor(v.y0 / T)), tx1 = Math.min(Math.ceil(sc.W / T) - 1, Math.floor(v.x1 / T)), ty1 = Math.min(Math.ceil(sc.H / T) - 1, Math.floor(v.y1 / T));
    // сначала плитки ближе к центру экрана
    const cxw = (v.x0 + v.x1) / 2, cyw = (v.y0 + v.y1) / 2, need = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) need.push([tx, ty, Math.hypot((tx + 0.5) * T - cxw, (ty + 0.5) * T - cyw)]);
    need.sort((a, b) => a[2] - b[2]);
    // общие границы в физических пикселях: ни щелей, ни перекрытия полупрозрачных краёв
    const m = c.getTransform(); c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    // Новый кадр показывается сразу; чтение исходников одной плитки распределяется по кадрам.
    let submitted = 0;
    for (const [tx, ty, dist] of need) {
      const key = tx + ',' + ty; let e = this.tiles.get(key);
      if (!e && !this.pending.has(key) && submitted < 1 && this.request(sc, tx, ty)) submitted++;
      const x = tx * T, y = ty * T, w = Math.min(T, sc.W - x), h = Math.min(T, sc.H - y);
      const px0 = Math.round(x * m.a + m.e), py0 = Math.round(y * m.d + m.f), px1 = Math.round((x + w) * m.a + m.e), py1 = Math.round((y + h) * m.d + m.f);
      const dw = px1 - px0, dh = py1 - py0; if (dw <= 0 || dh <= 0) continue;
      // обратное преобразование сохраняет мировые координаты текстуры; кромка даёт соседние тексели фильтру
      const wx = (px0 - m.e) / m.a, wy = (py0 - m.f) / m.d, ww = dw / m.a, wh = dh / m.d;
      if (e) { e.used = this.frame; e.dist = dist; c.drawImage(e.cv, (wx - x + HIRES_G) * this.scale, (wy - y + HIRES_G) * this.scale, ww * this.scale, wh * this.scale, px0, py0, dw, dh); }
      else { c.drawImage(terr.decor, wx, wy, ww, wh, px0, py0, dw, dh); c.drawImage(terr.canvas, wx, wy, ww, wh, px0, py0, dw, dh); }
    }
    c.restore();
    // ограничиваем память по фактическому размеру: плитка ×8 вчетверо больше плитки ×4
    if (this.bytes > HIRES_BUDGET) {
      const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used || b[1].dist - a[1].dist);
      for (const [key, tile] of old) { if (this.bytes <= HIRES_BUDGET) break; this.tiles.delete(key); this.bytes -= tile.bytes; }
    }
    return true;
  }
}

/** вырезка родной текстуры для плитки tx,ty (с запасом под билинейную выборку); текстура периодическая — копия по кругу */
function nativeCrop(nat, tx, ty, dx, dy) {
  const k = nat.k, T = HIRES_T, G = HIRES_G;
  const x0 = Math.floor((tx * T - G + dx) * k - 0.5) - 1, y0 = Math.floor((ty * T - G + dy) * k - 0.5) - 1;
  const cw = Math.ceil((T + 2 * G) * k) + 4, ch = cw, W2 = nat.w, H2 = nat.h, s = nat.d, d = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    const sy = (((y0 + y) % H2) + H2) % H2;
    for (let x = 0; x < cw;) {
      const sx = (((x0 + x) % W2) + W2) % W2, run = Math.min(cw - x, W2 - sx), a = (sy * W2 + sx) * 3;
      d.set(s.subarray(a, a + run * 3), (y * cw + x) * 3); x += run;
    }
  }
  return { x0, y0, w: cw, h: ch, d };
}
/** лёгкое сглаживание поля освещения (1-2-1) внутри одного материала: убирает остаток резкости запекания, не размывая тени */
function smoothLight(LF, ref, w) {
  const src = LF.slice(), K = [1, 2, 1];
  for (let y = 1; y < w - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, id = ref[i]; if (!id) continue;
    let r = 0, g = 0, b = 0, s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = i + dy * w + dx; if (ref[j] !== id) continue;
      const k = K[dx + 1] * K[dy + 1]; r += src[j * 3] * k; g += src[j * 3 + 1] * k; b += src[j * 3 + 2] * k; s += k;
    }
    LF[i * 3] = r / s; LF[i * 3 + 1] = g / s; LF[i * 3 + 2] = b / s;
  }
}

/* код фонового потока (запускается из строки — работает и в сборке одним файлом); тот же расчёт, что шейдер js/terrain_gl.js */
function hiresWorkerMain() {
  const HI = {}, FINE = {};
  // веса Гаусса окна 5×5 структурного тензора (σ = 1.5)
  const WG = new Float32Array(25); for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) WG[j * 5 + i] = Math.exp(-((i - 2) * (i - 2) + (j - 2) * (j - 2)) / 4.5);
  const IND = new Float32Array(49);
  onmessage = (ev) => {
    const m = ev.data; if (m.hi) { HI[m.hi.name] = m.hi; return; } if (m.fine) { FINE[m.fine.name] = m.fine; return; }
    const { T, S, P, G: pad, src: sd, tx, ty } = m, LB = m.lb, w = T + 2 * P, n = w * w, N = (T + 2 * pad) * S;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = sd[i * 4 + 3] / 255; A[i] = a; if (a > 0) any = true;
      R[i] = sd[i * 4] / 255 * a; G[i] = sd[i * 4 + 1] / 255 * a; B[i] = sd[i * 4 + 2] / 255 * a;
    }
    if (!any) { postMessage({ key: m.key, g: m.g, ep: m.ep, out: null }); return; }
    // направление края — только у края: контур на фоне воздуха (TY 2) или граница материалов и слоёв (TY 1); структурный
    // тензор градиентов Собеля в окне 5×5 с весами Гаусса по полю «альфа» или «тот же материал» (как TGL_FLOW_FS)
    const NX = new Float32Array(n), NY = new Float32Array(n), CO = new Float32Array(n), TY = new Uint8Array(n);
    for (let y = 4; y < w - 4; y++) for (let x = 4; x < w - 4; x++) {
      const i = y * w + x, l0 = LB[i];
      let amin = 1, amax = 0, lch = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = i + dy * w + dx, av = A[j]; if (av < amin) amin = av; if (av > amax) amax = av; if (LB[j] !== l0) lch = true; }
      const ae = amax - amin >= 0.25; if (!ae && !lch) continue;
      for (let j = 0; j < 7; j++) for (let k = 0; k < 7; k++) { const q = (y + j - 3) * w + x + k - 3; IND[j * 7 + k] = ae ? A[q] : LB[q] === l0 ? 1 : 0; }
      let a = 0, b = 0, c = 0;
      for (let j = 1; j <= 5; j++) for (let k = 1; k <= 5; k++) {
        const q = j * 7 + k;
        const gx = IND[q - 6] + 2 * IND[q + 1] + IND[q + 8] - IND[q - 8] - 2 * IND[q - 1] - IND[q + 6];
        const gy = IND[q + 6] + 2 * IND[q + 7] + IND[q + 8] - IND[q - 8] - 2 * IND[q - 7] - IND[q - 6];
        const wg = WG[(j - 1) * 5 + k - 1]; a += wg * gx * gx; b += wg * gx * gy; c += wg * gy * gy;
      }
      const sum = a + c; if (sum < 0.05) continue;
      const dif = Math.sqrt((a - c) * (a - c) + 4 * b * b), th = 0.5 * Math.atan2(2 * b, a - c);
      NX[i] = Math.cos(th); NY[i] = Math.sin(th); CO[i] = Math.min(1, (dif / sum) * Math.min(1, sum)); TY[i] = ae ? 2 : 1;
    }
    const bil = (arr, u, v) => {
      if (u < 0) u = 0; else if (u > w - 1.001) u = w - 1.001; if (v < 0) v = 0; else if (v > w - 1.001) v = w - 1.001;
      const xi = u | 0, yi = v | 0, fx = u - xi, fy = v - yi, i = yi * w + xi;
      return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fy) + (arr[i + w] * (1 - fx) + arr[i + w + 1] * fx) * fy;
    };
    const labelAt = (x, y) => x < 0 || y < 0 || x >= w || y >= w ? 0 : LB[y * w + x];
    // Catmull-Rom внутри непрозрачного материала: интерполяция исходных цветов, без усиления шума
    const CI = new Int16Array(N), CW = new Float32Array(N * 4), CRGB = new Float64Array(3);
    for (let q = 0; q < N; q++) {
      const u = P - pad + (q + 0.5) / S - 0.5, i = Math.floor(u), t = u - i, t2 = t * t, t3 = t2 * t, j = q * 4;
      CI[q] = i; CW[j] = -0.5 * t + t2 - 0.5 * t3; CW[j + 1] = 1 - 2.5 * t2 + 1.5 * t3; CW[j + 2] = 0.5 * t + 2 * t2 - 1.5 * t3; CW[j + 3] = -0.5 * t2 + 0.5 * t3;
    }
    const cubicRGB = (X, Y) => {
      const xi = CI[X], yi = CI[Y], cx = X * 4, cy = Y * 4;
      let r = 0, g = 0, b = 0, r0 = 1, g0 = 1, b0 = 1, r1 = 0, g1 = 0, b1 = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const i = (yi + y - 1) * w + xi + x - 1; if (A[i] !== 1) return false;
        const weight = CW[cx + x] * CW[cy + y], rr = R[i], gg = G[i], bb = B[i];
        r += rr * weight; g += gg * weight; b += bb * weight;
        r0 = Math.min(r0, rr); g0 = Math.min(g0, gg); b0 = Math.min(b0, bb); r1 = Math.max(r1, rr); g1 = Math.max(g1, gg); b1 = Math.max(b1, bb);
      }
      // локальный диапазон не допускает светлых/тёмных ореолов вокруг контрастных камней
      CRGB[0] = Math.max(r0, Math.min(r1, r)); CRGB[1] = Math.max(g0, Math.min(g1, g)); CRGB[2] = Math.max(b0, Math.min(b1, b)); return true;
    };
    const TAB = m.tab, out = new Uint8ClampedArray(N * N * 4);
    // карта деталей: тексель k покрывает [k, k+1) в координатах детали; 128 = 1.0
    const hiAt = (h, cx, cy) => {
      const W2 = h.w, H2 = h.h, d = h.d; cx -= 0.5; cy -= 0.5;
      const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
      const xa = ((x0 % W2) + W2) % W2, xb = (xa + 1) % W2, ya = ((y0 % H2) + H2) % H2, yb = (ya + 1) % H2;
      return ((d[ya * W2 + xa] * (1 - fx) + d[ya * W2 + xb] * fx) * (1 - fy) + (d[yb * W2 + xa] * (1 - fx) + d[yb * W2 + xb] * fx) * fy) / 128;
    };
    // независимый период цветных фотодеталей; нейтральный RGB128 сохраняет крупные формы и освещение
    const fineAt = (f, cx, cy, channel) => {
      const W2 = f.w, H2 = f.h, d = f.d; cx -= 0.5; cy -= 0.5;
      const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
      const xa = ((x0 % W2) + W2) % W2, xb = (xa + 1) % W2, ya = ((y0 % H2) + H2) % H2, yb = (ya + 1) % H2;
      const a = (ya * W2 + xa) * 3 + channel, b = (ya * W2 + xb) * 3 + channel, c = (yb * W2 + xa) * 3 + channel, e = (yb * W2 + xb) * 3 + channel;
      return ((d[a] * (1 - fx) + d[b] * fx) * (1 - fy) + (d[c] * (1 - fx) + d[e] * fx) * fy) / 128;
    };
    /** запись материала с родным цветом (или null) */
    const natOf = (L) => { const rid = L > 256 ? L - 257 : L - 1, e = rid > 0 ? TAB[rid] : null; return e && e.crop ? e : null; };
    /** родной цвет материала e в точке карты wx, wy → NRGB (с фото-порами мельче текселя) */
    const NRGB = new Float64Array(3);
    const natRGB = (e, wx, wy) => {
      const cr = e.crop, hx = (wx + e.dx) * e.nk - 0.5 - cr.x0, hy = (wy + e.dy) * e.nk - 0.5 - cr.y0;
      const xi = Math.floor(hx), yi = Math.floor(hy), fx = hx - xi, fy = hy - yi, cd = cr.d, cw = cr.w;
      if (S > e.nk * 1.05) {   /* v107: при увеличении — бикубика Катмулла–Рома, как в шейдере (natCR): зерно резкое, без «мыла» */
        const ax = [fx * (-0.5 + fx * (1 - 0.5 * fx)), 1 + fx * fx * (-2.5 + 1.5 * fx), fx * (0.5 + fx * (2 - 1.5 * fx)), fx * fx * (-0.5 + 0.5 * fx)];
        const ay = [fy * (-0.5 + fy * (1 - 0.5 * fy)), 1 + fy * fy * (-2.5 + 1.5 * fy), fy * (0.5 + fy * (2 - 1.5 * fy)), fy * fy * (-0.5 + 0.5 * fy)];
        let r = 0, g = 0, b = 0;
        for (let j = 0; j < 4; j++) { const row = ((yi + j - 1) * cw + xi - 1) * 3, wy = ay[j]; for (let i = 0; i < 4; i++) { const q = row + i * 3, k = wy * ax[i]; r += cd[q] * k; g += cd[q + 1] * k; b += cd[q + 2] * k; } }
        NRGB[0] = Math.max(0, r / 255); NRGB[1] = Math.max(0, g / 255); NRGB[2] = Math.max(0, b / 255);
      } else {
        const p00 = (yi * cw + xi) * 3, p01 = p00 + 3, p10 = p00 + cw * 3, p11 = p10 + 3;
        for (let c = 0; c < 3; c++) NRGB[c] = ((cd[p00 + c] * (1 - fx) + cd[p01 + c] * fx) * (1 - fy) + (cd[p10 + c] * (1 - fx) + cd[p11 + c] * fx) * fy) / 255;
      }
      const fine = FINE[e.name], f = fine && S <= 4 && fine.mip ? fine.mip : fine;
      if (f) { const cx = (wx + e.dx) * f.scale, cy = (wy + e.dy) * f.scale; NRGB[0] *= fineAt(f, cx, cy, 0); NRGB[1] *= fineAt(f, cx, cy, 1); NRGB[2] *= fineAt(f, cx, cy, 2); }
    };
    // освещение карты (LF — с родным цветом) или нарисованный цвет: билинейно по соседям того же материала L
    // (на границе материалов стороны не смешиваются); 0 — соседей этого материала нет
    const LF = m.LF, LRGB = new Float64Array(3);
    const sameAt = (u, v, L, lf) => {
      const xi = Math.floor(u), yi = Math.floor(v), fx = u - xi, fy = v - yi;
      let s = 0; LRGB[0] = LRGB[1] = LRGB[2] = 0;
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
        const xx = xi + dx, yy = yi + dy; if (labelAt(xx, yy) !== L) continue;
        const i = yy * w + xx, k = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) + 1e-3;
        if (lf) { LRGB[0] += LF[i * 3] * k; LRGB[1] += LF[i * 3 + 1] * k; LRGB[2] += LF[i * 3 + 2] * k; }
        else { const ia = 1 / Math.max(A[i], 1e-4); LRGB[0] += R[i] * ia * k; LRGB[1] += G[i] * ia * k; LRGB[2] += B[i] * ia * k; }
        s += k;
      }
      if (s > 0) { LRGB[0] /= s; LRGB[1] /= s; LRGB[2] /= s; }
      return s;
    };
    /** цвет материала L в точке (u, v окна; wx, wy карты) → CRGB: родной × освещение карты или нарисованный цвет */
    const colOf = (L, u, v, wx, wy) => {
      const e = natOf(L) && LF ? natOf(L) : null;
      let s = sameAt(u, v, L, !!e);
      if (s === 0) {   // плавная граница прошла за пиксель: ближайшие пиксели того же материала
        const xi = Math.floor(u), yi = Math.floor(v); LRGB[0] = LRGB[1] = LRGB[2] = 0;
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
          const xx = xi + dx, yy = yi + dy; if (labelAt(xx, yy) !== L) continue;
          const i = yy * w + xx, k = 1 / (0.1 + (xx - u) * (xx - u) + (yy - v) * (yy - v));
          if (e) { LRGB[0] += LF[i * 3] * k; LRGB[1] += LF[i * 3 + 1] * k; LRGB[2] += LF[i * 3 + 2] * k; }
          else { const ia = 1 / Math.max(A[i], 1e-4); LRGB[0] += R[i] * ia * k; LRGB[1] += G[i] * ia * k; LRGB[2] += B[i] * ia * k; }
          s += k;
        }
        if (s > 0) { LRGB[0] /= s; LRGB[1] /= s; LRGB[2] /= s; }
      }
      if (e) { natRGB(e, wx, wy); CRGB[0] = NRGB[0] * LRGB[0]; CRGB[1] = NRGB[1] * LRGB[1]; CRGB[2] = NRGB[2] * LRGB[2]; }
      else { CRGB[0] = LRGB[0]; CRGB[1] = LRGB[1]; CRGB[2] = LRGB[2]; }
    };
    const ka = Math.max(1.7, S * 0.9), kl = Math.max(1, S), CA = new Float64Array(3);
    for (let Y = 0; Y < N; Y++) {
      const v = P - pad + (Y + 0.5) / S - 0.5, vi = Math.round(v), wy = ty * T - pad + (Y + 0.5) / S;
      for (let X = 0; X < N; X++) {
        const u = P - pad + (X + 0.5) / S - 0.5, li = vi * w + Math.round(u), o = (Y * N + X) * 4, co = CO[li], typ = co > 0.12 ? TY[li] : 0;
        const wx = tx * T - pad + (X + 0.5) / S;
        let r, g, b, a;
        if (typ === 2) {
          // контур на фоне воздуха: вдоль края — до ±3 пикселей карты (ступеньки пропадают), поперёк — резкость; переход —
          // около пикселя экрана; внутри — родная фактура материала до самого края
          const nx = NX[li], ny = NY[li], tx_ = -ny * 3 * co, ty_ = nx * 3 * co;
          let L0 = 0, best = 1e9;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.round(u) + dx, yy = vi + dy, j = yy * w + xx; if (xx < 0 || yy < 0 || xx >= w || yy >= w || A[j] < 0.5) continue; const dd = (xx - u) * (xx - u) + (yy - v) * (yy - v); if (dd < best) { best = dd; L0 = LB[j]; } }
          const e = L0 && LF ? natOf(L0) : null;
          let sr = 0, sg = 0, sb = 0, sa = 0, pr = 0, pg = 0, pb = 0, pa = 0, gs = 0, lr = 0, lg = 0, lb = 0, la = 0;
          for (let k = -4; k <= 4; k++) {
            const f = k / 4, gk = 1 - 0.6 * f * f, uu = u + f * tx_, vv = v + f * ty_, ca = bil(A, uu, vv);
            sr += gk * bil(R, uu, vv); sg += gk * bil(G, uu, vv); sb += gk * bil(B, uu, vv); sa += gk * ca;
            const up = uu + nx * 0.55, vp = vv + ny * 0.55, um = uu - nx * 0.55, vm = vv - ny * 0.55;
            pr += gk * (bil(R, up, vp) + bil(R, um, vm)); pg += gk * (bil(G, up, vp) + bil(G, um, vm)); pb += gk * (bil(B, up, vp) + bil(B, um, vm)); pa += gk * (bil(A, up, vp) + bil(A, um, vm));
            if (e && ca > 0.02 && sameAt(uu, vv, L0, true) > 0) { lr += gk * ca * LRGB[0]; lg += gk * ca * LRGB[1]; lb += gk * ca * LRGB[2]; la += gk * ca; }
            gs += gk;
          }
          sr /= gs; sg /= gs; sb /= gs; sa /= gs; const ks = 0.7 * co, h = 0.5 / gs;
          sr += ks * (sr - pr * h); sg += ks * (sg - pg * h); sb += ks * (sb - pb * h); sa += ks * (sa - pa * h);
          a = sa < 0 ? 0 : sa > 1 ? 1 : sa; if (a <= 0.003) continue;
          r = sr / a; g = sg / a; b = sb / a;
          a = Math.max(0, Math.min(1, (a - 0.5) * ka + 0.5));
          if (e && la > 1e-3) { natRGB(e, wx, wy); r = NRGB[0] * lr / la; g = NRGB[1] * lg / la; b = NRGB[2] * lb / la; }
        } else if (typ === 1) {
          // граница материалов внутри ландшафта: плавная кривая по доле материала вдоль края, цвет сторон не смешивается
          const nx = NX[li], ny = NY[li], tx_ = -ny * 3 * co, ty_ = nx * 3 * co, LA = LB[li];
          let LBo = 0, cA = 0, gs = 0;
          for (let k = -4; k <= 4; k++) {
            const f = k / 4, gk = 1 - 0.6 * f * f, uu = u + f * tx_, vv = v + f * ty_, xi = Math.floor(uu), yi = Math.floor(vv), fx = uu - xi, fy = vv - yi;
            for (let j = 0; j < 4; j++) {
              const L = labelAt(xi + (j & 1), yi + (j >> 1));
              if (L === LA) cA += gk * ((j & 1) ? fx : 1 - fx) * ((j >> 1) ? fy : 1 - fy); else if (!LBo && L) LBo = L;
            }
            gs += gk;
          }
          a = bil(A, u, v); a = a < 0 ? 0 : a > 1 ? 1 : a; if (a <= 0.003) continue;
          const tA = LBo ? Math.max(0, Math.min(1, 0.5 + (cA / gs - 0.5) * kl)) : 1;
          colOf(LA, u, v, wx, wy); r = CRGB[0]; g = CRGB[1]; b = CRGB[2];
          if (tA < 0.999) { CA[0] = r; CA[1] = g; CA[2] = b; colOf(LBo, u, v, wx, wy); r = CRGB[0] + (CA[0] - CRGB[0]) * tA; g = CRGB[1] + (CA[1] - CRGB[1]) * tA; b = CRGB[2] + (CA[2] - CRGB[2]) * tA; }
        } else {
          let sr, sg, sb, sa = bil(A, u, v);
          if (sa >= 0.999 && cubicRGB(X, Y)) { sr = CRGB[0]; sg = CRGB[1]; sb = CRGB[2]; }
          else { sr = bil(R, u, v); sg = bil(G, u, v); sb = bil(B, u, v); }
          a = sa < 0 ? 0 : sa > 1 ? 1 : sa; if (a <= 0.003) continue;
          r = sr / a; g = sg / a; b = sb / a;
          const L = LB[li], rid = L > 256 ? L - 257 : L - 1, e = rid > 0 ? TAB[rid] : null;
          if (e) {
            if (e.crop) {
              // родной цвет высокого разрешения × освещение карты; у границы с другим материалом родной цвет плавно переходит
              // в гладкое увеличение (без этого граница шла ступеньками по пикселям карты)
              if (a >= 0.999 && LF) {
                const same = sameAt(u, v, L, true);
                natRGB(e, wx, wy);
                const kb = same >= 0.999 ? 1 : Math.max(0, Math.min(1, (same - 0.5) * 2));
                if (same > 0) { r += (NRGB[0] * LRGB[0] - r) * kb; g += (NRGB[1] * LRGB[1] - g) * kb; b += (NRGB[2] * LRGB[2] - b) * kb; }
              }
            } else {   // настоящие детали текстуры мельче пикселя карты (рендер Blender в двойном разрешении)
              const h = HI[e.name], fine = FINE[e.name], f = fine && S <= 4 && fine.mip ? fine.mip : fine;
              if (h) { const q = hiAt(h, (wx + e.dx) * e.k, (wy + e.dy) * e.k); r *= q; g *= q; b *= q; }
              if (f) { const cx = (wx + e.dx) * f.scale, cy = (wy + e.dy) * f.scale; r *= fineAt(f, cx, cy, 0); g *= fineAt(f, cx, cy, 1); b *= fineAt(f, cx, cy, 2); }
            }
          }
        }
        out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255; out[o + 3] = a * 255;
      }
    }
    postMessage({ key: m.key, g: m.g, ep: m.ep, out: out.buffer }, [out.buffer]);
  };
}
