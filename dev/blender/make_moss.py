"""Бархатный мох шапки Alien (cap_moss) из Blender — критик r36: «мох — соломенные пряди; в эталоне бархатные подушки,
светлые верхушки ~130/110/70».

blender -b --python dev/blender/make_moss.py        (или python с bpy)
Поле высот и цвета (numpy, бесшовно, 4 точки на единицу мира) → рендер блоками (dev/blender/hf_render.py, HF_RESUME=1 —
продолжить после остановки) → python dev/tools/stitch_blocks.py test-results/blocks/cap_moss test-results/cap_moss_4x.png →
python dev/make_native.py test-results/cap_moss_4x.png cap_moss --no-match --lossy --quality 90

Как в эталоне dev/reference/alien.png: моховой ковёр из плотных подушек 2–7 ед. (купола со своим оттенком — оливковые,
золотистые, зеленоватые), между ними тёмные щели, по куполам — густой ворс побегов 0,25–0,5 ед.
Шапка Alien тонкая (6–10 ед.), поэтому подушки мелкие: в высоту шапки их помещается две-три. В игре текстура задаёт
только яркость (terrain_visual.js: q = яркость / средняя), цвет — из шапки; на видеокарте при приближении — родная ×4.
"""
import importlib.util
import math
import os

import bpy  # noqa: F401
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)
spec2 = importlib.util.spec_from_file_location('hf', os.path.join(HERE, 'hf_render.py'))
hf = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(hf)

R = int(os.environ.get('HF_R', '4'))
T = int(os.environ.get('MOSS_T', '512'))
SEED = 131
TONES = [(92, 98, 56), (130, 118, 70), (104, 110, 60), (146, 128, 76), (78, 92, 52), (118, 104, 64)]


def gnoise(shape, s, rng):
    """бесшовный гауссов шум (σ в пикселях), float32"""
    a = rng.standard_normal(size=shape, dtype=np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * s) ** 2 + (fx * s) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def field():
    rng = np.random.default_rng(SEED); N = T * R; SH = (N, N)
    H = gnoise(SH, 6 * R, rng) * 0.35 - 1.2                     # подложка ниже подушек — щели тёмные и глубокие
    C = np.empty((N, N, 3), np.float32); C[:] = (40, 42, 22)
    TOP = np.full(SH, -9.0, np.float32)
    tones = np.array(TONES, np.float32)
    # подушки: от крупных к мелким, купола «максимумом» — плотный ковёр с щелями
    for (r0, r1, count) in ((4.0, 7.0, int(T * T / 60)), (2.2, 4.0, int(T * T / 22)), (1.0, 2.2, int(T * T / 9))):
        for _ in range(count):
            r = rng.uniform(r0, r1); x0, y0 = rng.uniform(0, T), rng.uniform(0, T); top = r * rng.uniform(0.45, 0.7)
            sx = rng.uniform(0.8, 1.3); pr = int(r * 1.15 * R) + 2; cx, cy = int(x0 * R), int(y0 * R)
            ys = np.arange(cy - pr, cy + pr + 1); xs = np.arange(cx - pr, cx + pr + 1)
            yy, xx = np.meshgrid((ys + 0.5) / R - y0, (xs + 0.5) / R - x0, indexing='ij')
            d = np.sqrt((xx / sx) ** 2 + (yy * sx) ** 2) / r
            h = np.sqrt(np.clip(1 - d * d, 0, 1)) ** 0.7 * top
            sub = np.ix_(ys % N, xs % N); cur = TOP[sub]
            take = (d < 1) & (h > cur)
            if not take.any():
                continue
            cur[take] = h[take]; TOP[sub] = cur
            k = rng.random(); t = tones[rng.integers(0, len(tones))] * rng.uniform(0.86, 1.12)
            lit = (0.8 + 0.32 * (1 - d) - 0.12 * (xx + yy) / (r * 1.4))[..., None]   # купол: светлее верх-лево и середина
            cc = C[sub]; cc[take] = (t * lit)[take]; C[sub] = cc
    H = np.maximum(H, TOP)
    rim = np.clip(1 - TOP / 0.6, 0, 1) * (TOP > -8)              # у основания купола — тень щели
    C *= (1 - 0.45 * rim)[..., None]
    # ворс: густые побеги-«звёздочки» 0,25–0,5 ед. (точечный шум — случайные уколы, свёрнутые с конусом через БПФ) и зерно
    # тона; без него подушки — гладкие камни
    imp = (rng.random(SH, dtype=np.float32) < 0.22).astype(np.float32) * rng.uniform(0.6, 1.0, SH).astype(np.float32)
    k = np.zeros(SH, np.float32); rr = 0.45 * R
    yy, xx = np.meshgrid(np.fft.fftfreq(N) * N, np.fft.fftfreq(N) * N, indexing='ij')
    k[:] = np.clip(1 - np.hypot(yy, xx) / rr, 0, 1) ** 1.5
    pile = np.fft.irfft2(np.fft.rfft2(imp) * np.fft.rfft2(k), s=SH).astype(np.float32)
    pile -= pile.mean(); pile /= pile.std() + 1e-9
    del imp, k, yy, xx
    H += pile * 0.16 + gnoise(SH, 0.9 * R, rng) * 0.06
    C *= (1 + pile * 0.14)[..., None]
    return H.astype(np.float32), np.clip(C, 0, 255).astype(np.float32)


def main():
    H, C = field()
    hf.render_blocks(mt, 'cap_moss', H, C, None, R2=R, up=1, samples=int(os.environ.get('MOSS_SAMPLES', '96')), rough=0.95,
                     spec=0.12, micro=0.06, hgrain=0.08, cgrain=0.3, speck=0.002, out_dir=os.environ.get('HF_OUT'))
    print('MOSS cap_moss', flush=True)


main()
