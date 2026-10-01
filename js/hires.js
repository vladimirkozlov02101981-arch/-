'use strict';
/* Чёткая карта при приближении.
   Ландшафт хранится 1 пиксель на игровую единицу; при сильном зуме обычное растяжение даёт «мыло» и ступеньки пикселей.
   Видимые участки (плитки 128×128) по мере надобности пересчитываются в 4 раза крупнее:
   1) края (границы слоёв, контур земли) сглаживаются вдоль своего направления — ступеньки превращаются в ровные линии,
      поперёк края добавляется резкость, контур на фоне неба остаётся чётким;
   2) поверх накладывается мелкий рельеф материала из фото-текстуры (4 текселя на единицу) — меняется только светотень.
   Плитки кэшируются и пересчитываются только там, где ландшафт изменился (взрыв, балка). */
const HIRES_T = 128, HIRES_S = 4, HIRES_P = 3, HIRES_G = 1;

class HiResTerrain {
  constructor() {
    this.tiles = new Map(); this.terr = null; this.ver = -1; this.nTouch = 0; this.frame = 0;
    this.det = null; this.detKey = null;
    const w = HIRES_T + 2 * HIRES_P;
    this.src = makeCanvas(w, w); this.sx = this.src.getContext('2d', { willReadFrequently: true });
  }
  /** сколько карт деталей уже загружено — когда приходят новые, плитки пересчитываются */
  hiCount(terr) {
    const tab = terr.texRef ? terr.texRef.tab : [], names = new Set(); let n = 0;
    for (let i = 1; i < tab.length; i++) if (tab[i]) names.add(tab[i].name);
    for (const nm of names) { if (TexLib.loadHi(nm) || TexLib.hi[nm]) n++; }
    return n;
  }
  sync(terr) {
    if (!this.pending) this.pending = new Set();
    const hc = this.hiCount(terr);
    if (terr !== this.terr || hc !== this.hc) { this.tiles.clear(); this.gen = new Map(); this.pending.clear(); this.epoch = (this.epoch || 0) + 1; this.hc = hc; this.terr = terr; this.ver = terr.version; this.nTouch = (terr.touches || []).length; return; }
    if (terr.version === this.ver) return;
    const T = terr.touches || [];
    if (T.length === this.nTouch) { this.tiles.clear(); this.gen = new Map(); this.pending.clear(); }   // перерисовка целиком
    else for (let i = this.nTouch; i < T.length; i++) {
      const [x0, y0, x1, y1] = T[i], m = HIRES_P + 1;
      for (let ty = Math.floor((y0 - m) / HIRES_T); ty <= Math.floor((y1 + m) / HIRES_T); ty++)
        for (let tx = Math.floor((x0 - m) / HIRES_T); tx <= Math.floor((x1 + m) / HIRES_T); tx++) { const k = tx + ',' + ty; this.tiles.delete(k); this.gen.set(k, (this.gen.get(k) || 0) + 1); this.pending.delete(k); }
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
        const wk = new Worker(url); wk.idle = true; wk.hiSent = new Set();
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
    // ссылки на текстуры: какой пиксель из какой текстуры (перед — твёрдое, иначе задняя стена)
    const R = terr.texRef, W = sc.W, H = sc.H, ref = new Uint8Array(w * w), tab = {};
    if (R) for (let y = 0; y < w; y++) {
      const gy = y0 + y; if (gy < 0 || gy >= H) continue;
      for (let x = 0; x < w; x++) {
        const gx = x0 + x; if (gx < 0 || gx >= W) continue;
        const i = gy * W + gx, id = terr.mask[i] ? R.F[i] : R.B[i]; if (!id) continue;
        const e = R.tab[id], hi = e && TexLib.hi[e.name]; if (!hi) continue;
        ref[y * w + x] = id;
        if (!tab[id]) { tab[id] = { name: e.name, dx: e.dx, dy: e.dy, k: hi.w / e.w }; if (!wk.hiSent.has(e.name)) { wk.postMessage({ hi: hi }); wk.hiSent.add(e.name); } }
      }
    }
    wk.idle = false; this.pending.add(key);
    wk.postMessage({ key, g: this.gen.get(key) || 0, ep: this.epoch, tx, ty, T, S: HIRES_S, P, G: HIRES_G, src, ref, tab }, [src.buffer, ref.buffer]);
    return true;
  }
  done(wk, m) {
    wk.idle = true; this.pending.delete(m.key);
    if (m.ep !== this.epoch || (this.gen.get(m.key) || 0) !== m.g) return;   // плитка устарела (взрыв, смена карты, пришли детали)
    const N = (HIRES_T + 2 * HIRES_G) * HIRES_S, cv = makeCanvas(N, N);
    if (m.out) cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.out), N, N), 0, 0);
    this.tiles.set(m.key, { cv, used: this.frame });
  }
  /** рисует видимую часть ландшафта; false — увеличение не нужно (рисуется как обычно) */
  draw(c, sc, v, zp) {
    if (zp < 1.15 || typeof window !== 'undefined' && window.__noHiRes) return false;
    if (!this.pool()) return false;
    const terr = sc.terrain; if (!this.gen) this.gen = new Map(); this.sync(terr); this.frame++;
    const T = HIRES_T, tx0 = Math.max(0, Math.floor(v.x0 / T)), ty0 = Math.max(0, Math.floor(v.y0 / T)), tx1 = Math.min(Math.ceil(sc.W / T) - 1, Math.floor(v.x1 / T)), ty1 = Math.min(Math.ceil(sc.H / T) - 1, Math.floor(v.y1 / T));
    // сначала плитки ближе к центру экрана
    const cxw = (v.x0 + v.x1) / 2, cyw = (v.y0 + v.y1) / 2, need = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) need.push([tx, ty, Math.hypot((tx + 0.5) * T - cxw, (ty + 0.5) * T - cyw)]);
    need.sort((a, b) => a[2] - b[2]);
    // общие границы в физических пикселях: ни щелей, ни перекрытия полупрозрачных краёв
    const m = c.getTransform(); c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    for (const [tx, ty] of need) {
      const key = tx + ',' + ty; let e = this.tiles.get(key);
      if (!e && !this.pending.has(key)) this.request(sc, tx, ty);
      const x = tx * T, y = ty * T, w = Math.min(T, sc.W - x), h = Math.min(T, sc.H - y);
      const px0 = Math.round(x * m.a + m.e), py0 = Math.round(y * m.d + m.f), px1 = Math.round((x + w) * m.a + m.e), py1 = Math.round((y + h) * m.d + m.f);
      const dw = px1 - px0, dh = py1 - py0; if (dw <= 0 || dh <= 0) continue;
      // обратное преобразование сохраняет мировые координаты текстуры; кромка даёт соседние тексели фильтру
      const wx = (px0 - m.e) / m.a, wy = (py0 - m.f) / m.d, ww = dw / m.a, wh = dh / m.d;
      if (e) { e.used = this.frame; c.drawImage(e.cv, (wx - x + HIRES_G) * HIRES_S, (wy - y + HIRES_G) * HIRES_S, ww * HIRES_S, wh * HIRES_S, px0, py0, dw, dh); }
      else { c.drawImage(terr.decor, wx, wy, ww, wh, px0, py0, dw, dh); c.drawImage(terr.canvas, wx, wy, ww, wh, px0, py0, dw, dh); }
    }
    c.restore();
    if (this.tiles.size > 140) {   // память: выбрасываем давно не видимые плитки
      const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < old.length - 110; i++) this.tiles.delete(old[i][0]);
    }
    return true;
  }
}

/* код фонового потока (запускается из строки — работает и в сборке одним файлом) */
function hiresWorkerMain() {
  const HI = {};
  onmessage = (ev) => {
    const m = ev.data; if (m.hi) { HI[m.hi.name] = m.hi; return; }
    const { T, S, P, G: pad, src: sd, tx, ty } = m, w = T + 2 * P, n = w * w, N = (T + 2 * pad) * S;
    const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), L = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = sd[i * 4 + 3] / 255; A[i] = a; if (a > 0) any = true;
      R[i] = sd[i * 4] / 255 * a; G[i] = sd[i * 4 + 1] / 255 * a; B[i] = sd[i * 4 + 2] / 255 * a;
      L[i] = R[i] * 0.3 + G[i] * 0.59 + B[i] * 0.11 + a * 0.6;
    }
    if (!any) { postMessage({ key: m.key, g: m.g, ep: m.ep, out: null }); return; }
    const Jxx = new Float32Array(n), Jxy = new Float32Array(n), Jyy = new Float32Array(n);
    for (let y = 1; y < w - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, gx = L[i + 1] - L[i - 1], gy = L[i + w] - L[i - w];
      Jxx[i] = gx * gx; Jxy[i] = gx * gy; Jyy[i] = gy * gy;
    }
    const NX = new Float32Array(n), NY = new Float32Array(n), CO = new Float32Array(n);
    for (let y = 1; y < w - 1; y++) for (let x = 1; x < w - 1; x++) {
      let a = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = (y + dy) * w + x + dx; a += Jxx[j]; b += Jxy[j]; c += Jyy[j]; }
      const i = y * w + x, sum = a + c; if (sum < 0.004) continue;
      const dif = Math.sqrt((a - c) * (a - c) + 4 * b * b), th = 0.5 * Math.atan2(2 * b, a - c);
      // только контур (рядом есть прозрачность): фактуру породы не трогаем, иначе она «плывёт» как масло
      let amin = 1, amax = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const av = A[(y + dy) * w + x + dx]; if (av < amin) amin = av; if (av > amax) amax = av; }
      if (amax - amin < 0.25) continue;
      NX[i] = Math.cos(th); NY[i] = Math.sin(th); CO[i] = Math.min(1, (dif / sum) * Math.min(1, sum / 0.03));
    }
    const bil = (arr, u, v) => {
      if (u < 0) u = 0; else if (u > w - 1.001) u = w - 1.001; if (v < 0) v = 0; else if (v > w - 1.001) v = w - 1.001;
      const xi = u | 0, yi = v | 0, fx = u - xi, fy = v - yi, i = yi * w + xi;
      return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fy) + (arr[i + w] * (1 - fx) + arr[i + w + 1] * fx) * fy;
    };
    const TK = [0, 0.55, -0.55, 1.15, -1.15], WK = [1, 0.8, 0.8, 0.5, 0.5], WS = 3.6;
    const REF = m.ref, TAB = m.tab, out = new Uint8ClampedArray(N * N * 4);
    // карта деталей: тексель k покрывает [k, k+1) в координатах детали; 128 = 1.0
    const hiAt = (h, cx, cy) => {
      const W2 = h.w, H2 = h.h, d = h.d; cx -= 0.5; cy -= 0.5;
      const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
      const xa = ((x0 % W2) + W2) % W2, xb = (xa + 1) % W2, ya = ((y0 % H2) + H2) % H2, yb = (ya + 1) % H2;
      return ((d[ya * W2 + xa] * (1 - fx) + d[ya * W2 + xb] * fx) * (1 - fy) + (d[yb * W2 + xa] * (1 - fx) + d[yb * W2 + xb] * fx) * fy) / 128;
    };
    for (let Y = 0; Y < N; Y++) {
      const v = P - pad + (Y + 0.5) / S - 0.5, vi = Math.round(v), wy = ty * T - pad + (Y + 0.5) / S;
      for (let X = 0; X < N; X++) {
        const u = P - pad + (X + 0.5) / S - 0.5, li = vi * w + Math.round(u), o = (Y * N + X) * 4, co = CO[li];
        let sr, sg, sb, sa;
        if (co > 0.12) {
          // вдоль края — усреднение (ступеньки пропадают), поперёк — резкость
          const nx = NX[li], ny = NY[li], tx_ = -ny * co, ty_ = nx * co;
          sr = 0; sg = 0; sb = 0; sa = 0;
          for (let k = 0; k < 5; k++) {
            const uu = u + TK[k] * tx_, vv = v + TK[k] * ty_, wk = WK[k];
            sr += bil(R, uu, vv) * wk; sg += bil(G, uu, vv) * wk; sb += bil(B, uu, vv) * wk; sa += bil(A, uu, vv) * wk;
          }
          sr /= WS; sg /= WS; sb /= WS; sa /= WS;
          const q = 0.55, up = u + nx * q, vp = v + ny * q, um = u - nx * q, vm = v - ny * q, ks = 0.7 * co;
          sr += ks * (sr - (bil(R, up, vp) + bil(R, um, vm)) / 2); sg += ks * (sg - (bil(G, up, vp) + bil(G, um, vm)) / 2);
          sb += ks * (sb - (bil(B, up, vp) + bil(B, um, vm)) / 2); sa += ks * (sa - (bil(A, up, vp) + bil(A, um, vm)) / 2);
        } else { sr = bil(R, u, v); sg = bil(G, u, v); sb = bil(B, u, v); sa = bil(A, u, v); }
        let a = sa < 0 ? 0 : sa > 1 ? 1 : sa; if (a <= 0.003) continue;
        let r = sr / a, g = sg / a, b = sb / a;
        if (co > 0.12) a = Math.max(0, Math.min(1, (a - 0.5) * 1.7 + 0.5));   // чёткий контур на фоне неба
        const rid = REF[li];
        if (rid) {   // настоящие детали текстуры мельче пикселя карты (рендер Blender в двойном разрешении)
          const e = TAB[rid], h = HI[e.name];
          if (h) { const wx = tx * T - pad + (X + 0.5) / S, q = hiAt(h, (wx + e.dx) * e.k, (wy + e.dy) * e.k); r *= q; g *= q; b *= q; }
        }
        out[o] = r * 255; out[o + 1] = g * 255; out[o + 2] = b * 255; out[o + 3] = a * 255;
      }
    }
    postMessage({ key: m.key, g: m.g, ep: m.ep, out: out.buffer }, [out.buffer]);
  };
}
