"""Оттенок камня в родной текстуре без снега (Арктика: канальный gain темы красил бы и снег в желтоватый).

python dev/tools/rock_tint.py <рендер ×4.png> <выход.png> --tint 1,0.82,0.71 [--snowL 140] [--snowSat 0.25]

Снег — светлые малонасыщенные пиксели (яркость выше snowL, насыщенность ниже snowSat), переход мягкий (±25 по яркости);
всё остальное умножается на tint. Дальше — dev/make_native.py <выход.png> <имя> --no-match --lossy.
"""
import argparse

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--tint', default='1,0.82,0.71'); ap.add_argument('--snowL', type=float, default=140); ap.add_argument('--snowSat', type=float, default=0.25)
    a = ap.parse_args()
    img = np.asarray(Image.open(a.src).convert('RGB')).astype(np.float32)
    L = img.mean(2); mx = img.max(2); mn = img.min(2); sat = (mx - mn) / np.maximum(mx, 1)
    snow = np.clip((L - (a.snowL - 25)) / 50, 0, 1) * np.clip((a.snowSat + 0.08 - sat) / 0.16, 0, 1)
    tint = np.array([float(v) for v in a.tint.split(',')], np.float32)
    k = snow[..., None] + (1 - snow[..., None]) * tint
    Image.fromarray(np.clip(np.rint(img * k), 0, 255).astype(np.uint8)).save(a.out)
    print('rock_tint snow share', round(float((snow > 0.5).mean()), 3), 'wrote', a.out)


if __name__ == '__main__':
    main()
