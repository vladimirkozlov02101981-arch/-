"""Обшивка корабельного корпуса (пиратская бухта) как в эталоне dev/reference/pirate.png: ровные ряды досок 24 px,
доски 150–330 px со сдвинутыми стыками, тёмные щели 2 px, светлая фаска сверху и тень снизу у каждой доски, длинные волокна
(вытянутость 1:8), у части досок — дуги годичных слоёв, грязь у щелей, пятна, по два болта у каждого торца и редкие гвозди.

Пишет бесшовную текстуру в 4 раза подробнее игровой (4096×3840 = 1024×960 единиц, 40 рядов) и делает из неё родную ×4 и
обычную текстуру: python dev/tools/make_hull_planks.py [имя=wood_hull]   (HULL_K=2 — прежний вариант с картой деталей)
(внутри вызывается dev/make_native.py: assets/tex/native/<имя>.webp и assets/tex/<имя>.png, список nativeAvail в js/art.js).
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
K = int(os.environ.get('HULL_K', '4'))   # пикселей на единицу мира: 4 — родная ×4 (чёткая при приближении), 2 — прежний вариант с картой деталей
W1, ROW, ROWS = 1024, 24, 40
H1 = ROW * ROWS
W, H = W1 * K, H1 * K
rng = np.random.default_rng(606)


def fnoise(sy, sx, seed):
    """бесшовный сглаженный шум, нормирован к σ=1; sy, sx — размеры зерна в пикселях текстуры (вытянутость волокон)"""
    a = np.random.default_rng(seed).normal(size=(H, W)).astype(np.float32)
    a = nd.gaussian_filter(a, (sy, sx), mode='wrap')
    return (a - a.mean()) / (a.std() + 1e-6)


yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
fiber = fnoise(0.7 * K, 7 * K, 1) * 0.6 + fnoise(1.6 * K, 22 * K, 2) * 0.4      # волокна вдоль доски
streak = fnoise(4 * K, 60 * K, 3)                                                 # полосы тона внутри доски
stain = fnoise(26 * K, 48 * K, 4)                                                 # крупные пятна: выгоревшее/грязное
pores = fnoise(0.5 * K, 2.2 * K, 5)
fine = fnoise(0.35 * K, 3.5 * K, 7) * 0.7 + fnoise(0.18 * K, 0.6 * K, 8) * 0.3
dash = fnoise(0.15 * K, 1.4 * K, 9)                                              # поры-штрихи     # волокна и поры в 1–2 текселя (критик r24: обшивка была фактически ×1)
warp = fnoise(10 * K, 40 * K, 6)

DARK = np.array([30, 18, 11], np.float32); MID = np.array([70, 45, 27], np.float32); LIGHT = np.array([122, 86, 52], np.float32)   # контраст шире (эталон: sd 26 против 16)
GAP = np.array([9, 6, 4], np.float32)

img = np.zeros((H, W, 3), np.float32)
edge = np.full((H, W), 99.0, np.float32)        # расстояние до щели (в игровых единицах) — для грязи у стыков
bolts = []
for r in range(ROWS):
    y0 = r * ROW * K; y1 = y0 + ROW * K
    while True:                                                        # 4–6 досок на ряд, сумма — ровно период текстуры
        Ls = rng.uniform(150, 330, rng.integers(4, 7)); Ls *= W1 / Ls.sum()
        if Ls.min() >= 140 and Ls.max() <= 360: break
    off = rng.uniform(0, W1); joints = sorted(((off + np.concatenate([[0], np.cumsum(Ls)[:-1]])) % W1).tolist())
    for j, ja in enumerate(joints):
        jb = joints[(j + 1) % len(joints)] + (W1 if j + 1 == len(joints) else 0)
        L = jb - ja; tone = rng.normal(0, 0.11); warm = rng.normal(0, 0.035); arcs = rng.random() < 0.4
        xs = np.arange(int(np.floor(ja * K)), int(np.ceil(jb * K)))
        cols = xs % W
        sub = (slice(y0, y1), cols)
        fy = (yy[y0:y1][:, :len(xs)] - y0) / K                          # 0..24 поперёк доски
        fx = (xs[None, :] / K - ja).astype(np.float32) * np.ones_like(fy)   # 0..L вдоль доски
        v = 0.5 + tone + fiber[sub] * 0.14 + streak[sub] * 0.09 + stain[sub] * 0.07 + pores[sub] * 0.05 + fine[sub] * 0.12
        # чёткие линии годичных слоёв (≈1–2 текселя) с волной и поры-штрихи: деталь, которая видна только при приближении
        sp = rng.uniform(1.2, 2.4); t = (fy + warp[sub] * 1.5 + fiber[sub] * 0.35) / sp
        dl = np.abs((t - np.floor(t)) - 0.5) * sp * K
        v -= np.clip(1 - dl / 0.9, 0, 1) * rng.uniform(0.06, 0.12)
        v -= (dash[sub] > 2.0) * 0.09
        if arcs:                                                         # «соборные» дуги годичных слоёв
            ph = (fy - ROW / 2 + warp[sub] * 2.5) * 0.55 + ((fx - L * rng.uniform(0.3, 0.7)) / L) ** 2 * rng.uniform(14, 26)
            v += (np.abs(np.sin(ph)) ** 6) * -0.09
        v = np.clip(v, 0, 1)[..., None]
        c = np.where(v < 0.5, DARK + (MID - DARK) * (v / 0.5), MID + (LIGHT - MID) * ((v - 0.5) / 0.5))
        c = c * np.array([1 + warm, 1, 1 - warm], np.float32)
        # фаска: светлая кромка сверху, тень снизу и у торцов; щели
        k = np.ones_like(fy)
        k = np.where((fy >= 1) & (fy < 2.6), 1.16, k)
        k = np.where(fy > ROW - 3.5, 0.62 + (ROW - fy) / 3.5 * 0.38, k)
        ex = np.minimum(fx, L - fx)
        k = k * np.where(ex < 3.5, 0.72 + ex / 3.5 * 0.28, 1)
        c = c * k[..., None]
        gap = (fy < 1.0) | (ex < 0.9)
        c = np.where(gap[..., None], GAP, c)
        img[y0:y1, cols] = c
        edge[y0:y1, cols] = np.minimum(np.minimum(fy, ROW - fy), ex)
        for bx in (ja + 7, jb - 7):                                       # по два болта у торцов
            for by in (7.5, 16.5):
                bolts.append(((bx % W1) * K, (r * ROW + by) * K, 2.3))
        for nx in np.arange(ja + rng.uniform(60, 110), jb - 40, rng.uniform(80, 130)):   # редкие гвозди
            bolts.append(((nx % W1) * K, (r * ROW + ROW / 2 + rng.choice([-5, 5])) * K, 1.2))

grime = np.clip(1 - edge / 5.0, 0, 1) * 0.28                              # грязь и сырость у щелей
img *= (1 - grime)[..., None]
for (bx, by, br) in bolts:
    R = br * K; x0, x1 = int(bx - R * 2.2), int(bx + R * 2.2) + 1; y0, y1 = int(by - R * 2.2), int(by + R * 2.2) + 1
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32); d = np.hypot(gx - bx, gy - by) / R
    cyy, cxx = gy.astype(int) % H, gx.astype(int) % W
    ring = np.clip(1 - np.abs(d - 1.35) / 0.5, 0, 1) * 0.45                # ржавый ореол
    img[cyy, cxx] = img[cyy, cxx] * (1 - ring[..., None]) + np.array([74, 40, 22], np.float32) * ring[..., None]
    head = d < 1
    hl = np.clip(1 - np.hypot(gx - (bx - R * 0.35), gy - (by - R * 0.35)) / (R * 0.75), 0, 1)
    col = np.array([34, 30, 28], np.float32)[None, None] * (0.8 + 0.4 * (1 - d))[..., None] + np.array([96, 88, 78], np.float32) * hl[..., None]
    img[cyy[head], cxx[head]] = col[head]
img = np.clip(img + 0.5, 0, 255).astype(np.uint8)
name = sys.argv[1] if len(sys.argv) > 1 else 'wood_hull'
src = os.path.join(ROOT, 'test-results', '%s_%dx.png' % (name, K)); os.makedirs(os.path.dirname(src), exist_ok=True)
Image.fromarray(img).save(src)
print('WROTE', src, img.shape)
if K == 4: subprocess.run([sys.executable, os.path.join(ROOT, 'dev', 'make_native.py'), src, name, '--no-match', '--lossy', '--quality', '90'], cwd=ROOT, check=True)
else: subprocess.run([sys.executable, os.path.join(ROOT, 'dev', 'make_detail.py'), src, name], cwd=ROOT, check=True)
