"""Светлее освещённые грани текстуры (критик r38, замки: «стена — тёплые блики заката на верхне-левых гранях блоков,
p95 112 → 130, R−B бликов около +30»; у нас блики уже тёплые, R−B +43, но тусклые).

python dev/tools/lift_lights.py <родная.webp> <выход.png> [--lift 22] [--lo 70] [--hi 99.5] [--warm 0]
затем: python dev/make_native.py <выход.png> <имя> --no-match --lossy --quality 90   (малая — точное уменьшение родной)

Яркость L' = L + lift·smoothstep(процентиль lo, процентиль hi, L): тени и средние тона прежние, светлые грани светлее —
блоки объёмнее, не «серее». Цвет — множителем L'/L (тон прежний); warm — доля сдвига бликов к тёплому (R вверх, B вниз).
"""
import argparse

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
Y = np.array([0.299, 0.587, 0.114], np.float32)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0, 1); return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--lift', type=float, default=22); ap.add_argument('--lo', type=float, default=70); ap.add_argument('--hi', type=float, default=99.5)
    ap.add_argument('--warm', type=float, default=0.0)
    a = ap.parse_args()
    img = np.asarray(Image.open(a.src).convert('RGB'), dtype=np.float32)
    L = img @ Y; q0, q1 = np.percentile(L, [a.lo, a.hi])
    w = smooth(q0, q1, L)
    out = img * ((L + a.lift * w) / np.maximum(L, 1))[..., None]
    if a.warm:
        out[..., 0] += a.warm * 20 * w; out[..., 2] -= a.warm * 20 * w
    L1 = np.clip(out, 0, 255) @ Y
    print('lift: p50 %.0f → %.0f, p95 %.0f → %.0f, p99 %.0f → %.0f' % (np.percentile(L, 50), np.percentile(L1, 50), np.percentile(L, 95),
          np.percentile(L1, 95), np.percentile(L, 99), np.percentile(L1, 99)))
    Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8)).save(a.out)


if __name__ == '__main__':
    main()
