'use strict';
/* Ландшафт на видеокарте (WebGL2): чёткий при любом масштабе сразу, без подгрузки плиток.
   Каждый пиксель экрана считается шейдером прямо из данных карты — так же, как плитки в фоновых потоках js/hires.js:
   1) контур (твёрдое/воздух, в том числе на фоне задней стены) сглаживается вдоль своего направления, поперёк — резкость;
   2) внутри материала цвет берётся из родной текстуры ×4 (TexLib.native) с mip-уровнями — без ряби при отдалении и чётко
      при приближении, а освещение, тени и подпалины карты переносятся отношением «нарисованный пиксель / пиксель малой
      текстуры» (билинейно по соседям того же материала);
   3) остальное — кубическая интерполяция нарисованного цвета (без ореолов).
   Ничего не строится заранее: при любом масштабе и в любом месте карты кадр сразу готов. Изменения ландшафта (воронки,
   балки) обновляют только свою область. Родные текстуры уходят на видеокарту, как только раскодированы (обычно ещё на
   экране настроек боя). Без WebGL2 или на программном рендере работает прежний путь плитками. */
const TGL_PAD = 4, TGL_SLOTS = 6, TGL_STRIP = 256;

const TGL_VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/* направление контура по карте (структурный тензор 3×3 градиентов): как NX/NY/CO в hiresWorkerMain */
const TGL_FLOW_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp usampler2D;
uniform sampler2D tComp; uniform usampler2D tM; uniform ivec2 uSize;
out vec4 fragColor;
vec4 compAt(ivec2 p) { return texelFetch(tComp, clamp(p, ivec2(-4), uSize + 3) + ivec2(4), 0); }
float maskAt(ivec2 p) { if (p.x < 0 || p.x >= uSize.x || p.y < 0) return 0.0; if (p.y >= uSize.y) return 1.0; return texelFetch(tM, p, 0).r > 0u ? 1.0 : 0.0; }
float lum(ivec2 p) { vec4 c = compAt(p); return dot(c.rgb, vec3(0.3, 0.59, 0.11)) + c.a * 0.6 + maskAt(p) * 0.6; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float L[25];
  for (int j = 0; j < 5; j++) for (int i = 0; i < 5; i++) L[j * 5 + i] = lum(p + ivec2(i - 2, j - 2));
  float a = 0.0, b = 0.0, c = 0.0;
  for (int j = 1; j <= 3; j++) for (int i = 1; i <= 3; i++) {
    float gx = L[j * 5 + i + 1] - L[j * 5 + i - 1], gy = L[(j + 1) * 5 + i] - L[(j - 1) * 5 + i];
    a += gx * gx; b += gx * gy; c += gy * gy;
  }
  vec4 r = vec4(0.5, 0.5, 0.0, 0.0);
  float sum = a + c;
  if (sum >= 0.004) {
    float amin = 1.0, amax = 0.0, m0 = maskAt(p); bool mch = false;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      ivec2 q = p + ivec2(i, j); float av = compAt(q).a; amin = min(amin, av); amax = max(amax, av);
      if (maskAt(q) != m0) mch = true;
    }
    if (amax - amin >= 0.25 || mch) {
      float dif = sqrt((a - c) * (a - c) + 4.0 * b * b), th = 0.5 * atan(2.0 * b, a - c);
      r = vec4(cos(th) * 0.5 + 0.5, sin(th) * 0.5 + 0.5, min(1.0, (dif / sum) * min(1.0, sum / 0.03)), 0.0);
    }
  }
  fragColor = r;
}`;

/* пиксель экрана: сглаженный контур, кубическая интерполяция, родной цвет × освещение карты (как в hiresWorkerMain) */
const TGL_MAIN_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp usampler2D;
uniform sampler2D tComp; uniform usampler2D tF; uniform usampler2D tB; uniform usampler2D tM; uniform sampler2D tFlow; uniform sampler2D tIds; uniform sampler2D tLow; uniform sampler2D tFine;
uniform sampler2D tN0; uniform sampler2D tN1; uniform sampler2D tN2; uniform sampler2D tN3; uniform sampler2D tN4; uniform sampler2D tN5;
uniform ivec2 uSize; uniform vec2 uCompSize; uniform vec4 uXf; uniform float uCanvasH;
uniform vec4 uNat[6]; uniform vec4 uLow[6]; uniform vec4 uFine;
out vec4 fragColor;
vec4 bil(vec2 q) { return texture(tComp, (q + 4.5) / uCompSize); }
vec4 compAt(ivec2 p) { return texelFetch(tComp, clamp(p, ivec2(-4), uSize + 3) + ivec2(4), 0); }
int ridAt(ivec2 p) {
  if (p.x < 0 || p.y < 0 || p.x >= uSize.x || p.y >= uSize.y) return 0;
  return int(texelFetch(tM, p, 0).r > 0u ? texelFetch(tF, p, 0).r : texelFetch(tB, p, 0).r);
}
vec4 cw(float t) { float t2 = t * t, t3 = t2 * t; return vec4(-0.5 * t + t2 - 0.5 * t3, 1.0 - 2.5 * t2 + 1.5 * t3, 0.5 * t + 2.0 * t2 - 1.5 * t3, -0.5 * t2 + 0.5 * t3); }
bool catmull(vec2 u, out vec3 res) {
  vec2 b = floor(u); vec2 t = u - b; ivec2 bi = ivec2(b); vec4 wx = cw(t.x), wy = cw(t.y);
  vec3 acc = vec3(0.0), mn = vec3(1.0), mx = vec3(0.0);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec4 c = compAt(bi + ivec2(i - 1, j - 1)); if (c.a < 0.998) return false;
    acc += c.rgb * (wx[i] * wy[j]); mn = min(mn, c.rgb); mx = max(mx, c.rgb);
  }
  res = clamp(acc, mn, mx); return true;
}
vec3 natSample(int s, vec2 tc, vec2 gx, vec2 gy) {
  if (s == 0) return textureGrad(tN0, tc, gx, gy).rgb;
  if (s == 1) return textureGrad(tN1, tc, gx, gy).rgb;
  if (s == 2) return textureGrad(tN2, tc, gx, gy).rgb;
  if (s == 3) return textureGrad(tN3, tc, gx, gy).rgb;
  if (s == 4) return textureGrad(tN4, tc, gx, gy).rgb;
  return textureGrad(tN5, tc, gx, gy).rgb;
}
/* освещение карты в пикселе: нарисованный цвет / цвет малой текстуры (тёмный канал — по яркости, без выбросов) */
vec3 lfAt(ivec2 q, vec4 low, vec2 d) {
  vec4 c = compAt(q); vec3 src = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  vec2 lw = low.zw, t = vec2(q) + d; t -= lw * floor(t / lw);
  vec3 D = texelFetch(tLow, ivec2(low.xy + t), 0).rgb;
  float lc = dot(src, vec3(0.3, 0.59, 0.11)), ld = max(8.0 / 255.0, dot(D, vec3(0.3, 0.59, 0.11)));
  vec3 l = vec3(D.r >= 7.5 / 255.0 ? src.r / D.r : lc / ld, D.g >= 7.5 / 255.0 ? src.g / D.g : lc / ld, D.b >= 7.5 / 255.0 ? src.b / D.b : lc / ld);
  return min(l, vec3(6.0));
}
void main() {
  vec2 w = (vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y) - uXf.zw) / uXf.xy, u = w - 0.5;
  ivec2 li = ivec2(floor(w));
  bool inMap = li.x >= 0 && li.y >= 0 && li.x < uSize.x && li.y < uSize.y;
  vec4 fl = inMap ? texelFetch(tFlow, li, 0) : vec4(0.5, 0.5, 0.0, 0.0);
  float co = fl.z;
  vec4 s;
  if (co > 0.12) {
    // вдоль края — усреднение (ступеньки пропадают), поперёк — резкость
    vec2 n = fl.xy * 2.0 - 1.0, t = vec2(-n.y, n.x) * co;
    s = (bil(u) + 0.8 * (bil(u + 0.55 * t) + bil(u - 0.55 * t)) + 0.5 * (bil(u + 1.15 * t) + bil(u - 1.15 * t))) / 3.6;
    s += 0.7 * co * (s - 0.5 * (bil(u + 0.55 * n) + bil(u - 0.55 * n)));
  } else s = bil(u);
  float a = clamp(s.a, 0.0, 1.0);
  if (a <= 0.003) { fragColor = vec4(0.0); return; }
  vec3 rgb = s.rgb / max(s.a, 1e-4);
  if (co > 0.12) a = clamp((a - 0.5) * 1.7 + 0.5, 0.0, 1.0);   // чёткий контур на фоне неба
  float kb = 0.0; vec3 nat = vec3(0.0);
  int rid = inMap ? ridAt(li) : 0;
  if (rid > 0 && co <= 0.12 && a >= 0.999) {
    vec4 e = texelFetch(tIds, ivec2(rid, 0), 0); int slot = int(e.x + 0.5) - 1;
    if (slot >= 0 && uNat[slot].w > 0.5) {
      vec2 d = e.yz; vec4 low = uLow[slot], ni = uNat[slot];
      ivec2 b = ivec2(floor(u)); vec2 f = u - vec2(b);
      vec3 acc = vec3(0.0); float sw = 0.0;
      for (int j = 0; j < 4; j++) {
        ivec2 q = b + ivec2(j & 1, j >> 1); if (ridAt(q) != rid) continue;
        float k = ((j & 1) == 1 ? f.x : 1.0 - f.x) * ((j >> 1) == 1 ? f.y : 1.0 - f.y);
        acc += lfAt(q, low, d) * k; sw += k;
      }
      vec3 L = sw > 1e-4 ? acc / sw : lfAt(li, low, d);
      vec2 tc = (w + d) * ni.z / ni.xy;
      nat = natSample(slot, tc, vec2(ni.z / (uXf.x * ni.x), 0.0), vec2(0.0, ni.z / (uXf.y * ni.y))) * L;
      if (float(slot) == uFine.x) {   // фото-поры мельче текселя родной текстуры
        vec2 fc = (w + d) * uFine.y / uFine.zw;
        nat *= dot(textureGrad(tFine, fc, vec2(uFine.y / (uXf.x * uFine.z), 0.0), vec2(0.0, uFine.y / (uXf.y * uFine.w))).rgb, vec3(0.299, 0.587, 0.114)) * (255.0 / 128.0);
      }
      // у границы с другим материалом родной цвет плавно переходит в гладкое увеличение
      kb = sw >= 0.999 ? 1.0 : clamp((sw - 0.5) * 2.0, 0.0, 1.0);
    }
  }
  if (kb < 1.0 && co <= 0.12 && s.a >= 0.999) { vec3 cr; if (catmull(u, cr)) rgb = cr; }
  rgb = clamp(mix(rgb, nat, kb), 0.0, 1.0);
  fragColor = vec4(rgb * a, a);
}`;

class TerrainGL {
  /** null — WebGL2 нет, мало памяти текстур или рендер программный (тогда плитки в фоновых потоках быстрее) */
  static create() {
    if (typeof document === 'undefined' || typeof window === 'undefined' || window.__noTerrainGL) return null;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl || gl.getParameter(gl.MAX_TEXTURE_SIZE) < 8192 || gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 14) return null;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info'), name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) && !window.__forceTerrainGL) return null;
      return new TerrainGL(cv, gl);
    } catch (e) { console.warn('TerrainGL', e); return null; }
  }
  constructor(cv, gl) {
    this.cv = cv; this.gl = gl; this.lost = false; this.broken = false; this.natCache = new Map();
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; this.terr = null; this.tex = null; this.slots = []; this.natCache = new Map(); }, false);
    cv.addEventListener('webglcontextrestored', () => { try { this.init(); this.lost = false; } catch (err) { this.broken = true; } }, false);
    this.init();
  }
  init() {
    const gl = this.gl;
    this.pFlow = this.program(TGL_FLOW_FS); this.pMain = this.program(TGL_MAIN_FS);
    this.vao = gl.createVertexArray(); this.fb = gl.createFramebuffer();
    this.uFlow = this.locations(this.pFlow, ['tComp', 'tM', 'uSize']);
    this.uMain = this.locations(this.pMain, ['tComp', 'tF', 'tB', 'tM', 'tFlow', 'tIds', 'tLow', 'tFine', 'tN0', 'tN1', 'tN2', 'tN3', 'tN4', 'tN5', 'uSize', 'uCompSize', 'uXf', 'uCanvasH', 'uNat', 'uLow', 'uFine']);
    this.dummy = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.dummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    this.dummyU = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.dummyU);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.terr = null; this.tex = null; this.slots = []; this.fineSlot = -1; this.scratchCv = null;
  }
  program(fs) {
    const gl = this.gl, p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, TGL_VS], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('шейдер ландшафта: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('шейдер ландшафта: ' + gl.getProgramInfoLog(p));
    return p;
  }
  locations(p, names) { const o = {}; for (const n of names) o[n] = this.gl.getUniformLocation(p, n); return o; }
  texture(w, h, internal, filter, wrap, levels = 1) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
  }
  /** родная текстура материала на видеокарте (с mip-уровнями); раскодированная картинка уходит туда за миллисекунды */
  nativeTexture(nat) {
    if (this.lost || this.broken || !nat) return null;
    const have = this.natCache.get(nat.name); if (have && have.nat === nat) return have.tex;
    const gl = this.gl, levels = 1 + Math.floor(Math.log2(Math.max(nat.w, nat.h)));
    if (have) gl.deleteTexture(have.tex);
    const tex = this.texture(nat.w, nat.h, gl.RGBA8, gl.LINEAR, gl.REPEAT, levels);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (nat.img) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nat.w, nat.h, gl.RGBA, gl.UNSIGNED_BYTE, nat.img);
    else {   // без картинки — из массива RGB (по полосам, чтобы не держать второй большой массив)
      const rows = 256, buf = new Uint8Array(nat.w * rows * 4), d = nat.d;
      for (let y = 0; y < nat.h; y += rows) {
        const h = Math.min(rows, nat.h - y);
        for (let i = 0, j = y * nat.w * 3, n = nat.w * h; i < n; i++, j += 3) { buf[i * 4] = d[j]; buf[i * 4 + 1] = d[j + 1]; buf[i * 4 + 2] = d[j + 2]; buf[i * 4 + 3] = 255; }
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y, nat.w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf, 0);
      }
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    this.natCache.set(nat.name, { nat, tex });
    // выгруженные из памяти (материалы прежних карт) — освобождаем и на видеокарте
    for (const [n, e] of this.natCache) if (!TexLib.native[n] && !(this.slots || []).some(s => s.name === n)) { gl.deleteTexture(e.tex); this.natCache.delete(n); }
    return tex;
  }
  /** освободить текстуры прежней карты */
  free() {
    const gl = this.gl;
    if (this.tex) for (const t of Object.values(this.tex)) gl.deleteTexture(t);
    for (const s of this.slots || []) if (s.fineTex) gl.deleteTexture(s.fineTex);
    this.tex = null; this.slots = []; this.terr = null; this.fineSlot = -1;
  }
  /** новая карта: цвет, ссылки на текстуры, направление контура, малые текстуры материалов (родные — по мере загрузки) */
  bind(sc) {
    const gl = this.gl, terr = sc.terrain, W = terr.W, H = terr.H, R = terr.texRef;
    this.free();
    const t = this.tex = {};
    t.comp = this.texture(W + 2 * TGL_PAD, H + 2 * TGL_PAD, gl.RGBA8, gl.LINEAR, gl.CLAMP_TO_EDGE);
    t.F = this.texture(W, H, gl.R8UI, gl.NEAREST, gl.CLAMP_TO_EDGE); t.B = this.texture(W, H, gl.R8UI, gl.NEAREST, gl.CLAMP_TO_EDGE); t.M = this.texture(W, H, gl.R8UI, gl.NEAREST, gl.CLAMP_TO_EDGE);
    t.flow = this.texture(W, H, gl.RGBA8, gl.NEAREST, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.flow, 0);
    const okFb = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!okFb) { this.free(); this.broken = true; return false; }
    // материалы с родным цветом (у каждой карты их не больше пяти)
    const names = [];
    for (let i = 1; i < R.tab.length; i++) { const e = R.tab[i]; if (e && TexLib.nativeAvail && TexLib.nativeAvail.has(e.name) && TexLib.data[e.name] && !names.includes(e.name) && names.length < TGL_SLOTS) names.push(e.name); }
    this.slots = names.map(name => ({ name, low: TexLib.data[name], nat: null, tex: null, fine: null, fineTex: null, place: null }));
    const ids = new Float32Array(256 * 4);
    for (let i = 1; i < R.tab.length && i < 256; i++) { const e = R.tab[i]; if (!e) continue; ids[i * 4] = names.indexOf(e.name) + 1; ids[i * 4 + 1] = e.dx; ids[i * 4 + 2] = e.dy; }
    t.ids = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t.ids);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 1, 0, gl.RGBA, gl.FLOAT, ids);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // малые текстуры — в один атлас (по ним считается освещение карты)
    const AW = 4096; let ax = 0, ay = 0, rowH = 0;
    for (const s of this.slots) { const L = s.low; if (ax + L.w > AW) { ax = 0; ay += rowH; rowH = 0; } s.place = [ax, ay, L.w, L.h]; ax += L.w; rowH = Math.max(rowH, L.h); }
    t.low = this.texture(AW, Math.max(1, ay + rowH), gl.RGBA8, gl.NEAREST, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const s of this.slots) { const L = s.low, d = L.d; gl.texSubImage2D(gl.TEXTURE_2D, 0, s.place[0], s.place[1], L.w, L.h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(d.buffer, d.byteOffset, d.length)); }
    this.terr = terr; this.W = W; this.H = H;
    this.upload(0, 0, W, H);
    this.ver = terr.version; this.nTouch = (terr.touches || []).length;
    if (gl.getError() !== gl.NO_ERROR) { this.free(); this.broken = true; return false; }   // не хватило памяти видеокарты — плитки
    return true;
  }
  scratch(w, h) {
    if (!this.scratchCv) this.scratchCv = makeCanvas(w, h);
    if (this.scratchCv.width !== w || this.scratchCv.height !== h) { this.scratchCv.width = w; this.scratchCv.height = h; }
    return this.scratchCv;
  }
  /** перенос области карты на видеокарту (цвет, ссылки, маска) и пересчёт направления контура рядом */
  upload(x0, y0, x1, y1) {
    const gl = this.gl, terr = this.terr, W = this.W, H = this.H, R = terr.texRef;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0, h = y1 - y0;
    for (let y = y0; y < y1; y += TGL_STRIP) {
      const sh = Math.min(TGL_STRIP, y1 - y), cv = this.scratch(w, sh), x = cv.getContext('2d');
      // задняя стена и декор, поверх — ландшафт (как исходник плиток hires.js)
      x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, sh);
      x.drawImage(terr.decor, x0, y, w, sh, 0, 0, w, sh); x.drawImage(terr.canvas, x0, y, w, sh, 0, 0, w, sh);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.comp); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0 + TGL_PAD, y + TGL_PAD, w, sh, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    // ссылки на текстуры и маска — прямо из массивов карты, без копирования
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
    for (const [tex, arr] of [[this.tex.F, R.F], [this.tex.B, R.B], [this.tex.M, terr.mask]]) { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RED_INTEGER, gl.UNSIGNED_BYTE, arr, 0); }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.flow(x0 - 3, y0 - 3, x1 + 3, y1 + 3);
  }
  flow(x0, y0, x1, y1) {
    const gl = this.gl, u = this.uFlow;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.W, x1); y1 = Math.min(this.H, y1); if (x1 <= x0 || y1 <= y0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, this.W, this.H);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0); gl.disable(gl.BLEND);
    gl.useProgram(this.pFlow);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.comp); gl.uniform1i(u.tComp, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.M); gl.uniform1i(u.tM, 1);
    gl.uniform2i(u.uSize, this.W, this.H);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** изменения ландшафта с прошлого кадра — только их области (как HiResTerrain.sync) */
  sync(terr) {
    if (terr.version === this.ver) return;
    const T = terr.touches || [];
    if (T.length === this.nTouch) this.upload(0, 0, this.W, this.H);   // перерисовка целиком
    else for (let i = this.nTouch; i < T.length; i++) { const b = T[i]; this.upload(b[0] - 1, b[1] - 1, b[2] + 2, b[3] + 2); }
    this.nTouch = T.length; this.ver = terr.version;
  }
  /** родные текстуры и фото-поры материалов карты — как только загрузились (заодно отмечают материал «в работе») */
  natives() {
    const gl = this.gl;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i], nat = TexLib.loadNative ? TexLib.loadNative(s.name) : null;
      if (nat && nat !== s.nat && nat.w === s.low.w * nat.k && nat.h === s.low.h * nat.k) { s.tex = this.nativeTexture(nat); s.nat = s.tex ? nat : null; }
      if (TexLib.fineAvail && TexLib.fineAvail.has(s.name) && !s.fineTex) {
        const f = TexLib.loadFine(s.name);
        if (f) {
          // сама картинка (яркость считает шейдер); без неё — массив яркости
          s.fineTex = this.texture(f.w, f.h, gl.RGBA8, gl.LINEAR, gl.REPEAT, 1 + Math.floor(Math.log2(Math.max(f.w, f.h))));
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          if (f.img) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, f.img);
          else { const d = f.d, buf = new Uint8Array(f.w * f.h * 4); for (let k = 0, j = 0; k < buf.length; k += 4, j += 3) { buf[k] = d[j]; buf[k + 1] = d[j + 1]; buf[k + 2] = d[j + 2]; buf[k + 3] = 255; } gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, buf, 0); }
          gl.generateMipmap(gl.TEXTURE_2D); s.fine = f; if (this.fineSlot < 0) this.fineSlot = i;
        }
      }
    }
  }
  /** заранее, пока виден экран загрузки: всё нужное для первого кадра уже на видеокарте */
  prepare(sc) {
    if (this.lost || this.broken || !sc || !sc.terrain || !sc.terrain.texRef) return;
    try { if (sc.terrain !== this.terr && !this.bind(sc)) return; this.sync(sc.terrain); this.natives(); } catch (e) { console.warn('TerrainGL', e); this.broken = true; }
  }
  /** рисует видимую часть ландшафта; false — пусть рисует прежний путь */
  draw(c, sc, v, zp) {
    if (this.lost || this.broken || zp < 1.15 || window.__noHiRes) return false;
    const terr = sc.terrain; if (!terr || !terr.texRef || !terr.canvas) return false;
    try {
      if (terr !== this.terr && !this.bind(sc)) return false;
      this.sync(terr); this.natives();
      const gl = this.gl, cv = c.canvas, m = c.getTransform(), u = this.uMain, W = this.W, H = this.H;
      if (this.cv.width !== cv.width || this.cv.height !== cv.height) { this.cv.width = cv.width; this.cv.height = cv.height; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cv.width, cv.height); gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      // только прямоугольник карты на экране
      const px0 = Math.max(0, Math.floor(m.e - 2)), px1 = Math.min(cv.width, Math.ceil(m.e + W * m.a + 2)), py0 = Math.max(0, Math.floor(m.f - 2)), py1 = Math.min(cv.height, Math.ceil(m.f + H * m.d + 2));
      if (px1 <= px0 || py1 <= py0) return true;
      gl.enable(gl.SCISSOR_TEST); gl.scissor(px0, cv.height - py1, px1 - px0, py1 - py0);
      gl.useProgram(this.pMain);
      const bindT = (unit, tex, loc, dummy) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex || dummy || this.dummy); gl.uniform1i(loc, unit); };
      bindT(0, this.tex.comp, u.tComp); bindT(1, this.tex.F, u.tF, this.dummyU); bindT(2, this.tex.B, u.tB, this.dummyU); bindT(3, this.tex.M, u.tM, this.dummyU);
      bindT(4, this.tex.flow, u.tFlow); bindT(5, this.tex.ids, u.tIds); bindT(6, this.tex.low, u.tLow);
      const fs = this.fineSlot >= 0 ? this.slots[this.fineSlot] : null, fineOk = !!(fs && fs.fineTex && fs.fine); bindT(7, fineOk && fs.fineTex, u.tFine);
      const nat = new Float32Array(TGL_SLOTS * 4), low = new Float32Array(TGL_SLOTS * 4);
      for (let i = 0; i < TGL_SLOTS; i++) {
        const s = this.slots[i]; bindT(8 + i, s && s.tex, u['tN' + i]);
        if (!s) continue;
        low.set(s.place, i * 4);
        if (s.tex && s.nat) nat.set([s.nat.w, s.nat.h, s.nat.k, 1], i * 4);
      }
      gl.uniform4fv(u.uNat, nat); gl.uniform4fv(u.uLow, low);
      gl.uniform4f(u.uFine, fineOk ? this.fineSlot : -1, fineOk ? fs.fine.scale : 1, fineOk ? fs.fine.w : 1, fineOk ? fs.fine.h : 1);
      gl.uniform2i(u.uSize, W, H); gl.uniform2f(u.uCompSize, W + 2 * TGL_PAD, H + 2 * TGL_PAD);
      gl.uniform4f(u.uXf, m.a, m.d, m.e, m.f); gl.uniform1f(u.uCanvasH, cv.height);
      gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.disable(gl.SCISSOR_TEST);
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.drawImage(this.cv, 0, 0); c.restore();
      return true;
    } catch (e) { console.warn('TerrainGL', e); this.broken = true; return false; }
  }
}
