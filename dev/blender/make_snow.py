"""Снег шапки (cap_snow) из Blender — комья, ямки, зерно и блёстки (замечание критика r24: «снежная плита без зерна»).

blender -b --python dev/blender/make_snow.py -- [стиль ...]        стили: snow
Поле высот и цвета (numpy, бесшовно, 4 точки на единицу мира) → рендер блоками (dev/blender/hf_render.py, HF_RESUME=1 —
продолжить после остановки) → python dev/tools/stitch_blocks.py test-results/blocks/cap_snow test-results/cap_snow_4x.png →
python dev/make_native.py test-results/cap_snow_4x.png cap_snow --no-match --lossy --quality 90   (--no-match: прежняя малая
текстура была почти ровной — подгонка по ней стёрла бы комья; тон шапки задаёт сама игра, текстура даёт только рельеф).

Как в эталоне dev/reference/arctic.png: на срезе снежного наноса — округлые комья разного размера (степенной закон: десятки
крупных 8–18 ед., сотни средних, тысячи мелких), между ними мягкие голубые тени (подповерхностное рассеяние), мелкие ямки,
зернистость наста и редкие блёстки кристаллов. Свет — тот же, что у пластов арктики (make_masonry.py strata): холодный
лунный сверху слева.
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
    # комья: (радиус от, до, ед.; сколько; высота купола в долях радиуса)
    'snow': dict(name='cap_snow', seed=71, T=512,
                 lumps=[((8, 18), 120, (0.42, 0.6)), ((3.5, 8), 760, (0.36, 0.52)), ((1.2, 3.5), 3800, (0.3, 0.45)), ((0.5, 1.2), 14000, (0.25, 0.4))],
                 pits=900, col=(234, 240, 250), col2=(214, 224, 242),
                 light=dict(col=(0.82, 0.88, 1.0), elev=32, energy=4.2)),
}


def gnoise(shape, s, rng):
    """бесшовный гауссов шум (σ в пикселях), float32"""
    a = rng.standard_normal(size=shape, dtype=np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * s) ** 2 + (fx * s) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def smax(a, b, k):
    """мягкий максимум: комья сливаются округлой ложбинкой, без острого шва"""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return a * (1 - h) + b * h + k * h * (1 - h)


def field(st):
    rng = np.random.default_rng(st['seed']); T = st['T']; N = T * R; SH = (N, N)
    # подложка: пологие волны наноса и мелкая неровность
    H = gnoise(SH, 9 * R, rng) * 1.6 + gnoise(SH, 2.5 * R, rng) * 0.45
    for (rr, count, hk) in st['lumps']:
        for _ in range(count):
            r = rng.uniform(*rr); x0, y0 = rng.uniform(0, T), rng.uniform(0, T)
            sx = rng.uniform(0.75, 1.35); ang = rng.uniform(0, math.pi); top = r * rng.uniform(*hk)
            pr = int(r * 1.4 * R) + 2; cx, cy = int(x0 * R), int(y0 * R)
            ys = np.arange(cy - pr, cy + pr + 1); xs = np.arange(cx - pr, cx + pr + 1)
            yy, xx = np.meshgrid((ys + 0.5) / R - y0, (xs + 0.5) / R - x0, indexing='ij')
            ca, sa = math.cos(ang), math.sin(ang)
            u = (xx * ca + yy * sa) / sx; v = (-xx * sa + yy * ca) * sx; d = np.sqrt(u * u + v * v) / r
            dome = np.sqrt(np.clip(1 - d * d, 0, 1)) ** rng.uniform(0.6, 1.1) * top
            sub = np.ix_(ys % N, xs % N)
            base = H[sub]; lift = base[pr, pr] if 0 <= pr < base.shape[0] else base.mean()
            H[sub] = np.where(d < 1, smax(base, lift + dome - top * 0.25, max(0.15, r * 0.18)), base)
    # ямки и следы осыпания
    for _ in range(st['pits']):
        r = rng.uniform(0.6, 2.6); x0, y0 = rng.uniform(0, T), rng.uniform(0, T); dep = r * rng.uniform(0.15, 0.35)
        pr = int(r * R) + 2; cx, cy = int(x0 * R), int(y0 * R)
        ys = np.arange(cy - pr, cy + pr + 1); xs = np.arange(cx - pr, cx + pr + 1)
        yy, xx = np.meshgrid((ys + 0.5) / R - y0, (xs + 0.5) / R - x0, indexing='ij')
        d = np.sqrt(xx * xx + yy * yy) / r
        sub = np.ix_(ys % N, xs % N); H[sub] -= np.where(d < 1, (1 - d * d) ** 2 * dep, 0)
    # зерно наста
    H += gnoise(SH, 0.35 * R, rng) * 0.05 + gnoise(SH, 0.9 * R, rng) * 0.06
    # цвет: почти белый, во впадинах чуть голубее (свет и тени даёт рендер)
    c1 = np.array(st['col'], np.float32); c2 = np.array(st['col2'], np.float32)
    cav = H - (np.roll(H, R * 2, 0) + np.roll(H, -R * 2, 0) + np.roll(H, R * 2, 1) + np.roll(H, -R * 2, 1)) / 4
    k = np.clip(0.5 - cav * 0.8, 0, 1)[..., None]
    C = c1 * (1 - k) + c2 * k
    C *= (1 + gnoise(SH, 4 * R, rng) * 0.02)[..., None]
    return H.astype(np.float32), np.clip(C, 0, 255).astype(np.float32)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(STYLES)):
        st = STYLES[key]; H, C = field(st)
        hf.render_blocks(mt, st['name'], H, C, None, R2=R, up=1, light=st.get('light'), samples=128, rough=0.62, spec=0.5, micro=0.03,
                         hgrain=0.08, cgrain=0.12, speck=0.006, sss=0.35, out_dir=os.environ.get('HF_OUT'))
        print('SNOW', st['name'], flush=True)


main()
