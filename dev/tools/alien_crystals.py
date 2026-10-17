"""Кристаллы в насыпи Alien (критик r29: «белые пятна-бабочки»): меньше и ярче, как светящиеся кристаллы эталона.

python dev/tools/alien_crystals.py [--name rock_alien] [--keep 0.4] [--seed 3]

Родная ×4 assets/tex/native/<имя>.webp (прежняя — dev/tex-backup/<имя>_native.webp, один раз):
- кристалл = светлые окрашенные пиксели (бледно-сиреневые и мятные значки make_rubble.py);
- доля (1 − keep) убирается: заливка средним камнем вокруг (итеративное расширение по маске);
- оставшиеся — насыщенные: тёмный край → яркая сердцевина (бирюза или пурпур по исходному оттенку), отсвет 6 px.
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


def inpaint(img, mask, it=40):
    out = img.copy(); m = mask.copy()
    for _ in range(it):
        if not m.any(): break
        known = ~m
        s = np.zeros_like(out); c = np.zeros(m.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
            kk = np.roll(known, (dy, dx), (0, 1)); s += np.roll(out, (dy, dx), (0, 1)) * kk[..., None]; c += kk
        fill = m & (c > 0)
        out[fill] = s[fill] / c[fill][:, None]; m &= ~fill
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--name', default='rock_alien')
    ap.add_argument('--keep', type=float, default=0.4)
    ap.add_argument('--seed', type=int, default=3)
    a = ap.parse_args()
    nat = ROOT / 'assets/tex/native' / f'{a.name}.webp'
    bak = ROOT / 'dev/tex-backup' / f'{a.name}_native.webp'
    if not bak.exists():
        bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(nat, bak)
    img = np.asarray(Image.open(bak).convert('RGB')).astype(np.float32)
    H, W, _ = img.shape
    R, G, B = img[..., 0], img[..., 1], img[..., 2]; L = img.mean(2)
    # значки светлее любого камня (L > 175 при медиане 78) и окрашены; камень сам голубовато-серый — без порога яркости маска ловит макушки глыб
    cry = (L > 175) & ((B > R + 6) | (G > R + 12))
    cry = ndimage.binary_dilation(ndimage.binary_fill_holes(ndimage.binary_closing(cry, iterations=2)), iterations=1)
    lab, n = ndimage.label(cry)
    rng = np.random.default_rng(a.seed)
    keep = np.zeros(n + 1, bool); keep[1:] = rng.random(n) < a.keep
    drop = cry & ~keep[lab]
    out = inpaint(img, ndimage.binary_dilation(drop, iterations=1))
    # оставшиеся: оттенок по исходному цвету (зелёный перевес — бирюза, иначе пурпур)
    hue_g = ndimage.mean(G - R, lab, range(n + 1)) > 10
    kmask = cry & keep[lab]
    edt = ndimage.distance_transform_edt(kmask)
    mx = ndimage.maximum(edt, lab, range(n + 1)); q = np.clip(edt / np.maximum(mx[lab], 1), 0, 1)
    cyan = (np.array([20, 110, 170.]), np.array([175, 250, 255.]))
    mag = (np.array([110, 30, 160.]), np.array([250, 175, 255.]))
    for sel, (c0, c1) in ((kmask & hue_g[lab], cyan), (kmask & ~hue_g[lab], mag)):
        qq = q[sel][:, None] ** 0.8
        out[sel] = c0 * (1 - qq) + c1 * qq
    glow = ndimage.gaussian_filter(kmask.astype(np.float32), 6) * 1.6
    out += (np.clip(glow, 0, 1) ** 1.4)[..., None] * np.array([40, 70, 110.]) * (~kmask)[..., None]
    out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    Image.fromarray(out).save(nat, 'WEBP', quality=90, method=6)
    small = out.reshape(H // 4, 4, W // 4, 4, 3).astype(np.float32).mean((1, 3))
    Image.fromarray(np.clip(np.rint(small), 0, 255).astype(np.uint8)).save(ROOT / 'assets/tex' / f'{a.name}.png', optimize=True)
    print('crystals', n, 'kept', int(keep.sum()), 'wrote', nat)


if __name__ == '__main__':
    main()
