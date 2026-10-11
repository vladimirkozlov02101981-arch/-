"""Грунт с камнями из Blender — без решётки и зеркальных повторов (замечание критика r23: «грунт — решётка пирамидок»).

blender -b --python dev/blender/make_soil.py -- [стиль ...]        стили: castle, valley
Поле высот и цвета (numpy, бесшовно, 4 точки на единицу мира) → рендер блоками (dev/blender/hf_render.py, HF_RESUME=1 —
продолжить после остановки) → python dev/tools/stitch_blocks.py test-results/blocks/<имя> test-results/<имя>_4x.png →
python dev/make_native.py test-results/<имя>_4x.png <имя> --lossy --quality 90   (без --no-match: распределение цвета
подгоняется к прежней малой текстуре — тон карты при обычном масштабе не меняется).

Как в эталоне dev/reference/castles.png: красно-бурая земля, в ней вросшие камни разного размера, разбросанные случайно
(степенной закон: несколько крупных 14–30 ед., десятки средних, сотни мелких, тысячи камешков); камни колотые — купол,
срезанный 2–3 плоскостями, нижняя часть уходит в землю; земля — комья, тёмные органические пятна, светлые песчинки,
корешки. Свет рендера — тёплый закатный сверху слева, как у карты.
"""
import importlib.util
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)
spec2 = importlib.util.spec_from_file_location('hf', os.path.join(HERE, 'hf_render.py'))
hf = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(hf)

R = int(os.environ.get('HF_R', '4'))
STYLES = {
    # (радиус от, до, ед.; сколько; высота купола в долях радиуса)
    'castle': dict(name='dirt_castle', seed=31, T=1024,
                   stones=[((12, 34), 48, (0.34, 0.52)), ((6, 12), 230, (0.3, 0.5)), ((2.5, 6), 1300, (0.28, 0.55)), ((0.8, 2.5), 9000, (0.3, 0.6))],
                   soil=(84, 56, 36), soil2=(58, 38, 24), sand=(132, 104, 76), stone=[(98, 88, 80), (86, 78, 72), (110, 98, 88), (78, 70, 64), (104, 92, 80)],
                   roots=140, light=dict(col=(1.0, 0.86, 0.68), elev=26, energy=5.0)),
    'valley': dict(name='dirt_valley', seed=41, T=1024,
                   stones=[((14, 30), 22, (0.32, 0.5)), ((6, 14), 150, (0.3, 0.5)), ((2.5, 6), 1200, (0.28, 0.55)), ((0.8, 2.5), 8000, (0.3, 0.6))],
                   soil=(92, 70, 52), soil2=(62, 46, 34), sand=(140, 118, 92), stone=[(118, 112, 104), (104, 98, 92), (132, 124, 112), (96, 90, 84), (124, 112, 98)],
                   roots=170, light=None),
}


def gnoise(shape, s, rng):
    """бесшовный гауссов шум (σ в пикселях), float32"""
    a = rng.standard_normal(size=shape, dtype=np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * s) ** 2 + (fx * s) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def field(st):
    rng = np.random.default_rng(st['seed']); T = st['T']; N = T * R; SH = (N, N)
    # земля: крупные комья, мелкая неровность; тон — пятна сырой/сухой земли и органики
    H = gnoise(SH, 6 * R, rng) * 0.55 + gnoise(SH, 1.6 * R, rng) * 0.22 + gnoise(SH, 0.5 * R, rng) * 0.08
    patch = gnoise(SH, 18 * R, rng) * 0.6 + gnoise(SH, 5 * R, rng) * 0.4
    soil = np.array(st['soil'], np.float32); soil2 = np.array(st['soil2'], np.float32)
    k = np.clip(0.5 + patch * 0.35, 0, 1)[..., None]
    C = soil * (1 - k) + soil2 * k
    C *= (1 + gnoise(SH, 0.35 * R, rng) * 0.07)[..., None]
    del patch, k
    sp = gnoise(SH, 0.25 * R, rng)                                                   # светлые песчинки
    m = sp > 2.3; C[m] = C[m] * 0.4 + np.array(st['sand'], np.float32) * 0.6; H[m] += 0.12
    del sp, m
    # корешки: тонкие тёмные извилистые линии
    for _ in range(st['roots']):
        x, y = rng.uniform(0, T), rng.uniform(0, T); a = rng.uniform(0, math.tau); L = rng.uniform(8, 40); w = rng.uniform(0.25, 0.6)
        steps = int(L * 2)
        for s in range(steps):
            a += rng.normal(0, 0.25); x += math.cos(a) * 0.5; y += math.sin(a) * 0.5 * 0.6 + 0.2
            px, py = int(x * R) % N, int(y * R) % N; r = max(1, int(w * R))
            ys = np.arange(py - r, py + r + 1) % N; xs = np.arange(px - r, px + r + 1) % N
            C[np.ix_(ys, xs)] *= 0.55; H[np.ix_(ys, xs)] += 0.08
    # камни: случайно (без ячеек и зеркал), от крупных к мелким — мелкие не залезают на крупные
    ID = np.zeros(SH, np.int32); stone_c = np.array(st['stone'], np.float32); nid = 1
    PAT = gnoise(SH, 1.4 * R, rng)                                                  # налёт земли и лишайника на камнях
    for (rr, count, hk) in st['stones']:
        for _ in range(count):
            r = rng.uniform(*rr) * rng.uniform(0.85, 1.15); x0, y0 = rng.uniform(0, T), rng.uniform(0, T)
            sx = rng.uniform(0.7, 1.4); ang = rng.uniform(0, math.pi); top = r * rng.uniform(*hk)
            pr = int((r * 1.45) * R) + 2; cx, cy = int(x0 * R), int(y0 * R)
            ys = np.arange(cy - pr, cy + pr + 1); xs = np.arange(cx - pr, cx + pr + 1)
            yy, xx = np.meshgrid((ys + 0.5) / R - y0, (xs + 0.5) / R - x0, indexing='ij')
            ca, sa = math.cos(ang), math.sin(ang)
            u = (xx * ca + yy * sa) / sx; v = (-xx * sa + yy * ca) * sx; d = np.sqrt(u * u + v * v) / r
            dome = np.sqrt(np.clip(1 - d * d, 0, 1)) ** rng.uniform(0.35, 0.8) * top
            h = dome
            for _f in range(rng.integers(3, 6) if r > 10 else rng.integers(2, 4)):    # колотые грани (у крупных — больше)
                fa = rng.uniform(0, math.tau)
                h = np.minimum(h, top * (rng.uniform(0.7, 0.95) - rng.uniform(0.25, 0.8) * (u * math.cos(fa) + v * math.sin(fa)) / r))
            h = h - top * rng.uniform(0.15, 0.4)                                     # нижняя часть в земле
            yi, xi = ys % N, xs % N; sub = np.ix_(yi, xi)
            Hs = H[sub]; take = (d < 1) & (h > Hs) & (ID[sub] == 0)
            if not take.any(): continue
            Hs[take] = h[take]; H[sub] = Hs
            ids = ID[sub]; ids[take] = nid; ID[sub] = ids
            tone = stone_c[rng.integers(0, len(stone_c))] * rng.uniform(0.85, 1.12)
            cc = C[sub]; shade = (0.92 + 0.16 * (1 - d))[..., None]
            cc[take] = (tone * shade)[take]
            pk = np.clip(PAT[sub] * 0.22 + 0.12, 0, 0.42)[..., None]               # пятна налёта — камень не «чистая галька»
            cc[take] = (cc * (1 - pk) + soil * pk)[take]
            # земля прилипла к низу камня и в трещинах
            dirt = take & (h < top * 0.12)
            cc[dirt] = cc[dirt] * 0.55 + soil * 0.45
            C[sub] = cc; nid += 1
    # зерно камня
    g = gnoise(SH, 0.3 * R, rng)
    st_m = ID > 0
    C[st_m] *= (1 + g[st_m] * 0.06)[:, None]; H[st_m] += g[st_m] * 0.03
    # тень-«грязь» у основания камней: земля вокруг камня темнее (сырость, мелкая крошка)
    near = np.zeros(SH, np.float32); near[st_m] = 1
    for _ in range(2): near = (near + np.roll(near, R, 0) + np.roll(near, -R, 0) + np.roll(near, R, 1) + np.roll(near, -R, 1)) / 5
    ring = np.clip(near * 2.2, 0, 1) * (~st_m)
    C *= (1 - ring * 0.28)[..., None]
    return H.astype(np.float32), np.clip(C, 0, 255).astype(np.float32)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(STYLES)):
        st = STYLES[key]; H, C = field(st)
        hf.render_blocks(mt, st['name'], H, C, None, R2=R, up=1, light=st.get('light'), samples=128, rough=0.9, spec=0.15, micro=0.06, hgrain=0.3, cgrain=0.5, speck=0.004,
                         out_dir=os.environ.get('HF_OUT'))   # HF_OUT — другая папка (проба при HF_R=1)
        print('SOIL', st['name'], flush=True)


main()
