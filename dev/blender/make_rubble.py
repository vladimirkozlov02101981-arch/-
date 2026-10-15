"""Фотореалистичная каменистая порода (насыпь из глыб, камней и щебня) для парящих островов Alien и др.

Как в эталоне dev/reference/alien.png: тёмная порода из округло-колотых глыб 20–40 ед., камней 7–14 и щебня 2–4 ед.,
между ними тёмная мелкая крошка; редкие кристаллы-вкрапления (светятся), немного мха на верхних гранях.
Поле высот, цвет и свечение считаются в numpy (бесшовно: ячейки с заворотом), Blender (Cycles) рендерит рельеф
со светом и тенями. Результат: test-results/<имя>_2x.png; затем python dev/make_detail.py test-results/<имя>_2x.png <имя>

blender -b --python dev/blender/make_rubble.py -- [стиль ...]      стили: alien
"""
import importlib.util
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

R = int(os.environ.get('HF_R', '4'))    # точек поля и пикселей рендера на единицу мира (4 — родная ×4)
spec2 = importlib.util.spec_from_file_location('hf', os.path.join(HERE, 'hf_render.py'))
hf = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(hf)
STYLES = {
    'alien': dict(name='dirt_alien', seed=7, T=1024, TY=512,
                  layers=[(32, 0.75, (0.36, 0.62), 0.55), (16, 0.8, (0.34, 0.6), 0.5), (8, 0.85, (0.32, 0.58), 0.45), (4, 0.9, (0.3, 0.55), 0.35)],
                  # r26 → v53: глыбы светлее и контрастнее (эталон: медиана ~30, разброс ~47 — светлые грани на тёмной крошке)
                  rock=[(104, 96, 100), (86, 79, 85), (120, 110, 112), (76, 70, 78), (96, 88, 90), (112, 100, 106)],
                  matrix=(26, 23, 29), moss=(66, 76, 40), moss_k=0.16,
                  crystals=160, crystal_cols=[(150, 110, 255), (90, 210, 255), (210, 120, 255)],
                  light=dict(col=(0.86, 0.88, 1.0), elev=30, energy=4.6)),
}


def gnoise(shape, s, rng):
    """бесшовный гауссов шум (σ в пикселях), float32 — экономия памяти при 4×"""
    a = rng.standard_normal(size=shape, dtype=np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * s) ** 2 + (fx * s) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def field(st):
    """насыпь: 4 слоя глыб (ячейки с заворотом), у каждой — купол, срезанный двумя плоскостями (колотые грани);
    считается полосами по 256 строк — память ограничена даже при 4096×2048"""
    rng = np.random.default_rng(st['seed']); T = st['T']; TY = st.get('TY', T); NX = T * R; NY = TY * R; SH = (NY, NX)
    rough = gnoise(SH, 1.2 * R, rng) * 0.25 + gnoise(SH, 3.5 * R, rng) * 0.35 + np.abs(gnoise(SH, 0.6 * R, rng)) * 0.12 + gnoise(SH, 0.3 * R, rng) * 0.06
    H = gnoise(SH, 2 * R, rng) * 0.25 + gnoise(SH, 0.7 * R, rng) * 0.15 + gnoise(SH, 0.3 * R, rng) * 0.06   # крошка между камнями
    ID = np.full(SH, -1, np.int32); TONE = np.zeros(SH, np.int32); DD = np.ones(SH, np.float32)
    rockc = np.array(st['rock'], np.float32); nid = 0
    Xr = ((np.arange(NX, dtype=np.float32) + 0.5) / R)[None, :]
    for (G, p, rr, hk) in st['layers']:
        nx_, ny_ = T // G, TY // G; S2 = (ny_, nx_)
        jx = rng.uniform(0.15, 0.85, S2); jy = rng.uniform(0.15, 0.85, S2); pres = rng.random(S2) < p
        rad = rng.uniform(*rr, S2) * G; sx = rng.uniform(0.75, 1.35, S2); ang = rng.uniform(0, math.pi, S2)
        hgt = rng.uniform(0.7, 1.1, S2) * hk; tone = rng.integers(0, len(rockc), S2); flat = rng.uniform(0.3, 0.75, S2)
        f1a = rng.uniform(0, math.tau, S2); f1s = rng.uniform(0.25, 0.8, S2); f1k = rng.uniform(0.72, 0.95, S2)
        f2a = rng.uniform(0, math.tau, S2); f2s = rng.uniform(0.25, 0.8, S2); f2k = rng.uniform(0.75, 1.0, S2)
        cx = np.floor(Xr / G).astype(np.int32)
        for y0 in range(0, NY, 256):
            y1 = min(NY, y0 + 256); Yb = ((np.arange(y0, y1, dtype=np.float32) + 0.5) / R)[:, None]
            cy = np.floor(Yb / G).astype(np.int32)
            Hb = H[y0:y1]; IDb = ID[y0:y1]; DDb = DD[y0:y1]; TOb = TONE[y0:y1]; rb = rough[y0:y1]
            for oy in (-1, 0, 1):
                for ox in (-1, 0, 1):
                    ix = (cx + ox) % nx_; iy = (cy + oy) % ny_
                    ixb, iyb = np.broadcast_arrays(ix, iy)
                    pr = pres[iyb, ixb]
                    dx = Xr - (cx + ox + jx[iyb, ixb]) * G; dy = Yb - (cy + oy + jy[iyb, ixb]) * G
                    ca = np.cos(ang[iyb, ixb]); sa = np.sin(ang[iyb, ixb])
                    u = (dx * ca + dy * sa) / sx[iyb, ixb]; v = (-dx * sa + dy * ca) * sx[iyb, ixb]
                    rd = rad[iyb, ixb]; d = np.sqrt(u * u + v * v) / rd
                    top = rd * hgt[iyb, ixb]
                    dome = np.sqrt(np.clip(1 - d * d, 0, 1)) ** flat[iyb, ixb] * top
                    # колотые грани: две плоскости срезают купол — плоские площадки с чёткими рёбрами
                    p1 = top * (f1k[iyb, ixb] - f1s[iyb, ixb] * (u * np.cos(f1a[iyb, ixb]) + v * np.sin(f1a[iyb, ixb])) / rd)
                    p2 = top * (f2k[iyb, ixb] - f2s[iyb, ixb] * (u * np.cos(f2a[iyb, ixb]) + v * np.sin(f2a[iyb, ixb])) / rd)
                    h = np.minimum(np.minimum(dome, p1), p2)
                    h = np.where(pr & (d < 1), np.maximum(h, 0) + rb * np.minimum(1, rd / 6), -1e9).astype(np.float32)
                    take = h > Hb
                    Hb[take] = h[take]; IDb[take] = (nid + iyb * nx_ + ixb)[take]; DDb[take] = d[take]; TOb[take] = tone[iyb, ixb][take]
        nid += nx_ * ny_
    # цвет: тон глыбы, светлее к середине грани, темнее у основания; мелкое зерно
    grain = gnoise(SH, 0.45 * R, rng)
    C = rockc[TONE % len(rockc)] * (1.0 + 0.12 * (1 - DD))[..., None] * (1 + grain * 0.06)[..., None]
    jitter = ((np.sin(ID.astype(np.float32) * 12.9898) * 43758.5453) % 1.0).astype(np.float32)
    C *= (0.85 + 0.3 * jitter)[..., None]
    C = np.where((ID < 0)[..., None], np.array(st['matrix'], np.float32) * (1 + grain * 0.08)[..., None], C).astype(np.float32)
    del grain, jitter, TONE, DD
    # мох на верхних гранях (высота растёт вниз по кадру — грань смотрит вверх)
    gy = np.roll(H, -1, 0) - np.roll(H, 1, 0)
    mn = gnoise(SH, 6 * R, rng)
    mk = np.clip((gy * (2.4 / R) - 0.25), 0, 1) * np.clip((mn - 0.6) * 1.2, 0, 1) * st['moss_k'] * 5
    C = C * (1 - mk[..., None]) + np.array(st['moss'], np.float32) * mk[..., None]
    del gy, mn, mk
    # кристаллы-вкрапления: пучки из 3–5 вытянутых ромбов, светятся
    E = np.zeros((NY, NX, 3), np.float32)
    for k in range(st['crystals']):
        x0, y0 = rng.uniform(0, T), rng.uniform(0, TY); col = np.array(st['crystal_cols'][rng.integers(0, len(st['crystal_cols']))], np.float32)
        for j in range(rng.integers(3, 6)):
            a = rng.uniform(0, math.tau); L = rng.uniform(2.5, 7); w = rng.uniform(0.8, 1.6)
            ax, ay = math.cos(a), math.sin(a)
            xs = int((x0 - 9) * R); ys = int((y0 - 9) * R); sz = int(18 * R)
            yy, xx = np.mgrid[ys:ys + sz, xs:xs + sz]; wx = (xx + 0.5) / R - x0; wy = (yy + 0.5) / R - y0
            t = wx * ax + wy * ay; q = -wx * ay + wy * ax
            m = (t > 0) & (t < L) & (np.abs(q) < w * (1 - np.abs(t / L - 0.35) / 0.65))
            if not m.any(): continue
            yi, xi = yy[m] % NY, xx[m] % NX; tt = t[m] / L
            C[yi, xi] = col * (0.5 + 0.5 * (1 - tt))[:, None]
            E[yi, xi] = col / 255.0 * (1.2 - 0.6 * tt)[:, None]
            H[yi, xi] = H[yi, xi] + 0.6
    return H, np.clip(C, 0, 255), E


def render_field(st, H, C, E):
    if st.get('light'): mt.LIGHT.update(**st['light'])
    sc = mt.reset()
    T = st['T']; N = T * R; M = 64
    Hp = np.pad(H, M, mode='wrap'); Cp = np.pad(C, ((M, M), (M, M), (0, 0)), mode='wrap'); Ep = np.pad(E, ((M, M), (M, M), (0, 0)), mode='wrap'); n = N + 2 * M
    size = n / R / 100.0
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=n, y_subdivisions=n, size=size, calc_uvs=True)
    ob = bpy.context.active_object; me = ob.data
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    # вершины сетки стоят в углах пикселей (n+1 на сторону): высота угла — среднее четырёх соседних пикселей
    # (прежнее «ближайший пиксель» брало рельеф через пиксель — полосы и рябь на гранях)
    ix = np.clip(np.round((co[:, 0] + size / 2) / size * n).astype(int), 0, n)
    iy = np.clip(np.round((size / 2 - co[:, 1]) / size * n).astype(int), 0, n)
    Hc = np.pad(Hp, 1, mode='edge')
    co[:, 2] = 0.25 * (Hc[iy, ix] + Hc[iy + 1, ix] + Hc[iy, ix + 1] + Hc[iy + 1, ix + 1]) / 100.0
    me.vertices.foreach_set('co', co.ravel()); me.update()
    for p in me.polygons: p.use_smooth = True

    def image(name, arr):
        img = bpy.data.images.new(name, n, n, alpha=False); img.colorspace_settings.name = 'sRGB' if name == 'albedo' else 'Non-Color'
        px = np.ones((n, n, 4), np.float32); px[..., :3] = arr[::-1]; img.pixels.foreach_set(px.ravel()); img.update(); img.pack(); return img
    m, nt, b = mt.principled('rubble', 0.86, 0.22)
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = image('albedo', Cp / 255.0); tx.interpolation = 'Closest'
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
    te = nt.nodes.new('ShaderNodeTexImage'); te.image = image('emit', Ep); te.interpolation = 'Closest'
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: nt.links.new(te.outputs['Color'], b.inputs[key]); break
    if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = 1.6
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 900; nz.inputs['Detail'].default_value = 6
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.3; bu.inputs['Distance'].default_value = 0.002
    nt.links.new(nz.outputs['Fac'], bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    me.materials.append(m)
    sc.render.resolution_x = sc.render.resolution_y = N; sc.render.resolution_percentage = 100
    sc.camera.data.ortho_scale = T / 100.0; sc.camera.data.clip_end = 50; sc.cycles.samples = 160
    mt.OUT = os.path.join(ROOT, 'test-results'); mt.render(sc, st['name'] + '_2x')
    mt.LIGHT.update(col=(1.0, 0.85, 0.66), elev=25, energy=5.0)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(STYLES)):
        st = STYLES[key]; H, C, E = field(st)
        hf.render_blocks(mt, st['name'], H, C, E, R2=R, up=1, light=st.get('light'), samples=128, rough=0.86, spec=0.22, emit=1.6, hgrain=0.25, cgrain=0.5, speck=0.004)
        print('RUBBLE', st['name'], flush=True)


main()
