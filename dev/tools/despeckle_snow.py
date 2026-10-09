"""Убирает тёмные крапинки-ямки внутри снега на текстуре породы и в её карте деталей.

python dev/tools/despeckle_snow.py rock_arctic [--k 7] [--thr 55] [--dry папка]

В снегу на уступах (светлые участки после морфологического закрытия) мелкие тёмные точки размером меньше k текселей
заполняются цветом окружающего снега; тёмная порода, трещины и швы между пластами (крупнее k) не меняются.
Текстура бесшовная — фильтры с заворотом. Карта деталей assets/tex/hi/<имя>.webp (в 2 раза крупнее) обрабатывается так же,
в ней ямки ищутся по отклонению от нейтральных 127 там, где на малой текстуре снег.
--dry — записать результат в указанную папку, а не в assets/tex.
"""
import argparse
import os

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def disk(k):
    r = (k - 1) / 2; y, x = np.mgrid[-r:r + 1, -r:r + 1]; return (x * x + y * y) <= r * r + 0.5


def snow_weight(L, k, thr):
    Lc = nd.grey_closing(L, footprint=disk(k), mode='wrap')
    m = np.clip((nd.gaussian_filter(Lc, 2, mode='wrap') - thr) / 30, 0, 1)   # вокруг светлый снег
    pit = np.clip((Lc - L - 6) / 26, 0, 1)                                    # насколько точка темнее окружения
    return nd.gaussian_filter(m * pit, 0.6, mode='wrap'), m


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('name'); ap.add_argument('--k', type=int, default=7)
    ap.add_argument('--thr', type=float, default=55); ap.add_argument('--dry')
    a = ap.parse_args()
    tex = os.path.join(ROOT, 'assets', 'tex', a.name + '.png'); hip = os.path.join(ROOT, 'assets', 'tex', 'hi', a.name + '.webp')
    out = a.dry or os.path.join(ROOT, 'assets', 'tex'); os.makedirs(os.path.join(out, 'hi'), exist_ok=True)
    img = np.asarray(Image.open(tex).convert('RGB')).astype(np.float32)
    L = img @ np.array([0.299, 0.587, 0.114], np.float32)
    w, m = snow_weight(L, a.k, a.thr)
    res = img.copy()
    for c in range(3):
        cc = nd.grey_closing(img[..., c], footprint=disk(a.k), mode='wrap')
        res[..., c] = img[..., c] * (1 - w) + cc * w
    Image.fromarray(np.clip(res + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(out, a.name + '.png'), optimize=True)
    print('texture', a.name, 'changed texels', int((w > 0.2).sum()), 'of', w.size)
    if os.path.exists(hip):
        hi = np.asarray(Image.open(hip).convert('L')).astype(np.float32)
        k2 = a.k * hi.shape[0] // img.shape[0]
        m2 = np.kron(m, np.ones((hi.shape[0] // img.shape[0], hi.shape[1] // img.shape[1]), np.float32))
        hc = nd.grey_closing(hi, footprint=disk(k2 + 1), mode='wrap')
        w2 = nd.gaussian_filter(m2 * np.clip((hc - hi - 6) / 26, 0, 1), 1.2, mode='wrap')
        hr = hi * (1 - w2) + hc * w2
        Image.fromarray(np.clip(hr + 0.5, 0, 255).astype(np.uint8)).convert('RGB').save(os.path.join(out, 'hi', a.name + '.webp'), quality=90, method=6)
        print('detail', a.name, 'changed texels', int((w2 > 0.2).sum()), 'of', w2.size)


if __name__ == '__main__':
    main()
