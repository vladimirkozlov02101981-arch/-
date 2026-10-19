"""Снег на уступах породы Арктики (критик r29: «белые плоские полосы читаются как дыры»): объём и меньше полос.

python dev/tools/arctic_snow_relief.py [--keep 0.55] [--seed 7] [--name rock_arctic]

Берёт родную ×4 assets/tex/native/<имя>.webp (прежняя сохраняется в dev/tex-backup/<имя>_native.webp один раз):
- снег = светлые малонасыщенные пиксели; каждый вертикальный отрезок снега в столбце затеняется сверху вниз
  (верх — свет, низ — синеватая тень 0.6), по верхней кромке — блик 1–2 px, лёгкое зерно — снег объёмный, а не плоский;
- камень (не снег) умножается на --rock-tint (оттенок по эталону);
- доля пятен (1 − keep, по умолчанию 65 %) убирается: пятно заполняется камнем прямо над ним (один сдвиг на пятно), края мягкие.
Пишет родную webp (lossy q90, как make_native --lossy) и малую assets/tex/<имя>.png — точное уменьшение 4×4.
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
    ap.add_argument('--name', default='rock_arctic')
    ap.add_argument('--keep', type=float, default=0.35)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--rock-tint', default='1.159,0.944,0.748', help='множители каналов камня (не снега): r,g,b')
    a = ap.parse_args()
    nat = ROOT / 'assets/tex/native' / f'{a.name}.webp'
    bak = ROOT / 'dev/tex-backup' / f'{a.name}_native.webp'
    if not bak.exists():
        bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(nat, bak)
    img = np.asarray(Image.open(bak).convert('RGB')).astype(np.float32)
    H, W, _ = img.shape
    L = img.mean(2); sat = img.max(2) - img.min(2)
    snow = (L > 150) & (sat < 70)
    snow = ndimage.binary_closing(snow, iterations=1)
    lab, n = ndimage.label(snow)
    rng = np.random.default_rng(a.seed)
    drop = np.zeros(n + 1, bool); drop[1:] = rng.random(n) > a.keep
    sizes = ndimage.sum(snow, lab, range(n + 1))
    drop[sizes < 30] = False                      # мелочь (сосульки, иней) не трогаем
    # r31: «линзы снега посреди скалы — как рваная бумага»: убранные пятна заполняются камнем прямо над ними
    # (тот же сдвиг для всего пятна — без полос), края — мягко
    src0 = img.copy(); repl = np.zeros((H, W), np.float32); fill_img = img.copy()
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None or not drop[k]: continue
        ys, xs = sl; hh = ys.stop - ys.start; off = hh + 10
        m = ndimage.binary_dilation(lab[sl] == k, iterations=3)
        yy = (np.arange(ys.start, ys.stop) - off) % H
        patch = src0[yy][:, xs]
        fill_img[sl][m] = patch[m]; repl[sl][m] = 1.0
    repl = ndimage.gaussian_filter(repl, 1.5)
    img = img * (1 - repl[..., None]) + fill_img * repl[..., None]
    snow &= ~(drop[lab] & (lab > 0))
    L = img.mean(2)                               # яркость после заполнения: оттенок камня ложится и на заплатки
    out = img.copy()
    grain = rng.normal(0, 1, (H, W)).astype(np.float32)
    grain = ndimage.gaussian_filter(grain, 1.2) * 6
    # тон по длине шапки: снег то на свету, то в тени соседнего выступа (период 60–200 px родной)
    tone = ndimage.gaussian_filter1d(rng.normal(0, 1, W).astype(np.float32), 40, mode='wrap'); tone /= np.abs(tone).max() + 1e-6
    shadow = np.array([104, 120, 158], np.float32)
    for x in range(W):
        col = snow[:, x]
        if not col.any(): continue
        d = np.diff(np.r_[0, col.astype(np.int8), 0])
        for y0, y1 in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)):
            h = y1 - y0
            if False:
                # зеркальная копия породы над отрезком (с переносом по периоду) + мягкие края
                src = (y0 - 1 - np.arange(h) - 2) % H
                fill = img[src, x]
                out[y0:y1, x] = fill
                for k in (1, 2):
                    for yy, w in ((y0 - k, 0.5 / k), (y1 - 1 + k, 0.5 / k)):
                        yy %= H; out[yy, x] = out[yy, x] * (1 - w) + img[(yy - h - 3) % H, x] * w
                continue
            v = (np.arange(h) + 0.5) / max(h, 1)
            f = np.where(v < 0.22, 1.0, 1.0 - (v - 0.22) / 0.78 * 0.62)[:, None]
            seg = out[y0:y1, x] * (0.84 + 0.06 * tone[x])
            seg = seg * f + shadow * (1 - f)
            if h >= 3: seg[:2] = np.minimum(255, seg[:2] * 1.06 + 6)
            seg += grain[y0:y1, x, None]
            out[y0:y1, x] = seg
            if y1 < H: out[y1 % H, x] *= 0.78       # контактная тень под шапкой
    # v73: оттенок камня по эталону (камень 22/27/37 при прежних 19/29/48): только камень, снег и сосульки — белые
    tint = np.array([float(v) for v in a.rock_tint.split(',')], np.float32)
    w = ndimage.gaussian_filter((~snow).astype(np.float32), 1.0)[..., None]
    w *= np.clip((200 - L[..., None]) / 60, 0, 1)                 # светлый иней и сосульки не трогаем
    out = out * (1 - w) + out * tint * w
    out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    Image.fromarray(out).save(nat, 'WEBP', quality=90, method=6)
    small = out.reshape(H // 4, 4, W // 4, 4, 3).astype(np.float32).mean((1, 3))
    Image.fromarray(np.clip(np.rint(small), 0, 255).astype(np.uint8)).save(ROOT / 'assets/tex' / f'{a.name}.png', optimize=True)
    print('snow blobs', n, 'dropped', int(drop.sum()), 'wrote', nat)


if __name__ == '__main__':
    main()
