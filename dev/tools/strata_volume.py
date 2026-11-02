"""Объём пластов песчаника каньона (критик r37: «пласты без объёма — средние частоты 7,2 при 10,6 у эталона; верхняя треть
пласта светлее на ~18 L; линии напластования вдвое чаще — период ~90 px кадра против ~45 у эталона»).

python dev/tools/strata_volume.py <родная.webp> <выход.png> [--top 0.16] [--bottom 0.12] [--mid 0.42]     (питоном с bpy)
затем: python dev/make_native.py <выход.png> rock_canyon --no-match --lossy --quality 90   (и та же картинка — dirt_canyon)

Карта пластов — из генератора (make_masonry.py field с '_rowmap', как dev/tools/canyon_strata.py): номер ряда и доля
высоты v в ряду, поэтому всё ложится ровно по швам отрендеренной текстуры (поиск швов по яркости давал пятна и полосы).
Верх пласта светлее (top, до v 0,35), низ темнее (bottom, с v 0,72); посередине каждого пласта — вторичная линия
напластования (mid): тёмная бороздка ~1,2 ед. со светлой кромкой под ней (свет сверху), высота линии у каждого пласта своя
(v 0,4–0,6) и плавно гуляет, местами прерывается.
"""
import argparse
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent.parent
Image.MAX_IMAGE_PIXELS = None


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--top', type=float, default=0.16); ap.add_argument('--bottom', type=float, default=0.12)
    ap.add_argument('--mid', type=float, default=0.42); ap.add_argument('--seed', type=int, default=21)
    a = ap.parse_args()
    spec = importlib.util.spec_from_file_location('cs', ROOT / 'dev/tools/canyon_strata.py')
    cs = importlib.util.module_from_spec(spec); spec.loader.exec_module(cs)
    row, v = cs.rowmap()
    img = np.asarray(Image.open(a.src).convert('RGB'), dtype=np.float32)
    assert row.shape == img.shape[:2], (row.shape, img.shape)
    H, W = row.shape; n = int(row.max()) + 1; rng = np.random.default_rng(a.seed)
    # высота пласта в пикселях: медиана по столбцам «сколько пикселей ряда в столбце» — для толщины линии в единицах мира
    hpx = np.ones(n, np.float32)
    for r in range(n):
        cnt = (row == r).sum(0)
        if (cnt > 0).any(): hpx[r] = np.median(cnt[cnt > 0])
    f = 1 + a.top * (1 - smooth(0.0, 0.35, v)) - a.bottom * smooth(0.72, 1.0, v)
    mid = rng.uniform(0.4, 0.6, n).astype(np.float32)[row]
    wob = nd.gaussian_filter1d(rng.standard_normal(W).astype(np.float32), 90, mode='wrap'); wob *= 0.06 / (np.abs(wob).max() + 1e-9)
    brk = nd.gaussian_filter1d(rng.standard_normal(W).astype(np.float32), 40, mode='wrap'); brk = smooth(-0.6, -0.2, brk / (brk.std() + 1e-9))
    dm = (v - mid - wob[None, :]) * hpx[row]                                  # расстояние до линии, px родной (4 на ед.)
    line = np.clip(1 - np.abs(dm + 1.2) / 2.6, 0, 1) ** 1.5                   # тёмная бороздка ~1,2 ед.
    lip = np.clip(1 - np.abs(dm - 2.6) / 1.4, 0, 1)                            # светлая кромка под ней
    f = f * (1 - a.mid * line * brk[None, :]) * (1 + a.mid * 0.45 * lip * brk[None, :])
    out = np.clip(img * f[..., None], 0, 255)
    Y = np.array([0.299, 0.587, 0.114], np.float32); L0 = img @ Y; L1 = out @ Y
    print('strata_volume rows %d, mean L %.1f → %.1f, L95 %.0f → %.0f' % (n, L0.mean(), L1.mean(), np.percentile(L0, 95), np.percentile(L1, 95)))
    Image.fromarray(out.round().astype(np.uint8)).save(a.out)


if __name__ == '__main__':
    main()
