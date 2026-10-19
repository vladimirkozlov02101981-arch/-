"""Расплав в швах базальта (критик r29: «оранжевые плоские пятна похожи на дыры»): тонкие светящиеся трещины.

python dev/tools/volcano_lava_cracks.py [--name rock_volcano] [--core 0.34] [--dark 1.0]

Родная ×4 assets/tex/native/<имя>.webp (прежняя — dev/tex-backup/<имя>_native.webp, один раз):
- расплав = оранжевые пиксели; в каждом вертикальном отрезке расплава светится только середина (доля core): белёсо-жёлтая
  сердцевина → насыщенный оранжевый, остальное — тёмная остывшая корка с редкими угольками;
- отсвет: камень в 2–14 px от сердцевины подкрашивается оранжевым (спадает квадратично);
- dark < 1 — камень темнее (по cmatch яркость камня уже как в эталоне, по умолчанию 1).
Пишет родную webp (q90) и малую assets/tex/<имя>.png (точное уменьшение 4×4).
"""
import argparse
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent.parent
Image.MAX_IMAGE_PIXELS = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', default='rock_volcano')
    ap.add_argument('--core', type=float, default=0.34)
    ap.add_argument('--dark', type=float, default=1.0)
    ap.add_argument('--seed', type=int, default=5)
    ap.add_argument('--src', default=None, help='исходная родная (по умолчанию — резервная копия dev/tex-backup/<имя>_native.webp)')
    a = ap.parse_args()
    nat = ROOT / 'assets/tex/native' / f'{a.name}.webp'
    bak = ROOT / 'dev/tex-backup' / f'{a.name}_native.webp'
    if not bak.exists():
        bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(nat, bak)
    img = np.asarray(Image.open(a.src or bak).convert('RGB')).astype(np.float32)
    H, W, _ = img.shape
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    lava = (R > 140) & (R - B > 55) & (G > 70)
    lava = ndimage.binary_opening(lava, iterations=1) | (lava & ndimage.binary_dilation(ndimage.binary_opening(lava, iterations=1), iterations=2))
    rng = np.random.default_rng(a.seed)
    out = img * a.dark
    out[..., 2] *= 1.03
    core = np.zeros((H, W), np.float32)
    crust = np.array([34, 20, 15], np.float32)
    for x in range(W):
        col = lava[:, x]
        if not col.any(): continue
        d = np.diff(np.r_[0, col.astype(np.int8), 0])
        for y0, y1 in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)):
            h = y1 - y0; c = (y0 + y1 - 1) / 2; half = max(0.8, h * a.core / 2)
            yy = np.arange(y0, y1); q = np.clip(1 - np.abs(yy - c) / (half + 0.5), 0, 1)
            core[y0:y1, x] = q
            out[y0:y1, x] = crust * (0.8 + 0.4 * rng.random(h))[:, None]
    core = ndimage.gaussian_filter(core, 0.7)
    k = np.clip(core * 1.6, 0, 1)[..., None]
    hot = np.stack([255 + 0 * core, 120 + 120 * core ** 2, 30 + 110 * core ** 3], -1)
    out = out * (1 - k) + hot * k
    # отсвет на камень: размытая сердцевина, квадратичный спад
    halo = ndimage.gaussian_filter(core, 6) * 2.2
    halo = np.clip(halo, 0, 1) ** 1.5
    out += halo[..., None] * np.array([120, 42, 6], np.float32) * (1 - k)
    # редкие угольки в корке
    emb = (rng.random((H, W)) > 0.9985) & lava & (core < 0.2)
    out[emb] = [255, 140, 40]
    out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    Image.fromarray(out).save(nat, 'WEBP', quality=90, method=6)
    small = out.reshape(H // 4, 4, W // 4, 4, 3).astype(np.float32).mean((1, 3))
    Image.fromarray(np.clip(np.rint(small), 0, 255).astype(np.uint8)).save(ROOT / 'assets/tex' / f'{a.name}.png', optimize=True)
    print('lava px', int(lava.sum()), 'wrote', nat)


if __name__ == '__main__':
    main()
