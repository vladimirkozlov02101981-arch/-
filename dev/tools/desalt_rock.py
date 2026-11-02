"""Убирает белую «соль» на тёмной породе (критик r36, Арктика: «меньше белых точек-соли в 1 px»).

python dev/tools/desalt_rock.py <родная.webp> <выход.png> [--k 7] [--thr 22] [--keep 0.15] [--dark 95] [--gain 0.86] [--frost 0.7] [--snowk 1.3] [--icicles 0.14] [--seams 1]
затем: python dev/make_native.py <выход.png> <имя> --no-match --lossy --quality 90   (малая — точное уменьшение родной)

Крупинки — светлые пятнышки уже k пикселей родной текстуры, ярче фона больше чем на thr (белый «цилиндр»: L − открытие L):
там, где фон вокруг тёмный (открытие яркости < dark — порода, а не снег на уступах), их цвет сводится к медиане окрестности,
остаётся доля keep. Остальные пиксели не меняются — зерно и резкость камня (R родной) прежние. Снежные полосы шире k и
светлый фон не трогаются. Текстура бесшовная — фильтры с заворотом.
gain — яркость камня (крупинки поднимали среднюю на ~8 %). frost (критик r36: «иней на гранях»; эталон — светлый налёт на
лицах пластов под снегом): изморозь пятнами у верха каждой плиты, гаснет на frostd пикселей ниже снежной полосы.
snowk — снег на уступах ярче и белее (критик: «p90 снега ≥ 190»). icicles — доля кромок снежных полос с сосульками
(критик: «сосульки под 30 % кромок»; эталон — бахрома под уступами): группами, шаг 4–12 px, длина 6–60 px (1,5–15 ед.),
лёд полупрозрачный — светлая левая грань, голубая правая, капля на кончике; рисуются в родной ×4 — чётко при приближении.
v117 (критик r37): сосулек в 4–5 раз меньше и они длиннее (25–110 px родной, корень 7–13 px), полупрозрачные (0,6–0,8),
под толстыми карнизами; иней — сплошной полосой у верхней грани плиты (не пятнами); seams — вертикальные швы блоков (эталон:
кладка из глыб — шов каждые 300–650 px родной со сдвигом по рядам, 5–7 px, тёмный (12,15,22), светлая кромка слева);
keep 0,45 — светлых крупинок остаётся больше (после полной чистки камень стал «мыльным»: ВЧ 10,1 → 7,6 при 12 у эталона).
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage as nd

Image.MAX_IMAGE_PIXELS = None


def disk(k):
    r = (k - 1) / 2; y, x = np.mgrid[-r:r + 1, -r:r + 1]; return (x * x + y * y) <= r * r + 0.5


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--k', type=int, default=7); ap.add_argument('--keep', type=float, default=0.45); ap.add_argument('--thr', type=float, default=30)
    ap.add_argument('--dark', type=float, default=95)
    ap.add_argument('--gain', type=float, default=0.86); ap.add_argument('--frost', type=float, default=0.7)
    ap.add_argument('--frostd', type=float, default=24); ap.add_argument('--snowL', type=float, default=108)
    ap.add_argument('--snowk', type=float, default=1.3); ap.add_argument('--icicles', type=float, default=0.14); ap.add_argument('--seams', type=int, default=1)
    a = ap.parse_args()
    img = np.asarray(Image.open(a.src).convert('RGB'), dtype=np.float32)
    L = img @ np.array([0.299, 0.587, 0.114], np.float32)
    fp = disk(a.k)
    Lo = nd.grey_opening(L, footprint=fp, mode='wrap')                     # фон без мелких светлых крупинок
    top = L - Lo
    bg = nd.gaussian_filter(Lo, 3, mode='wrap')
    dark = np.clip((a.dark - bg) / 25, 0, 1)                                # тёмная порода вокруг, не снег
    w = np.clip((top - a.thr) / 20, 0, 1) * dark * (1 - a.keep)
    w = np.maximum(w, nd.grey_dilation(w, size=3, mode='wrap') * 0.6)       # кромка крупинки — тоже, без светлого ореола
    base = np.stack([nd.median_filter(img[..., c], size=a.k + 2, mode='wrap') for c in range(3)], -1)
    out = img - (img - base) * w[..., None]
    out *= np.where(dark > 0.5, a.gain, 1 + (a.gain - 1) * dark * 2)[..., None]
    if a.frost > 0:
        H, W = L.shape; rng = np.random.default_rng(5)
        snow = nd.gaussian_filter(L, 4, mode='wrap') > a.snowL               # снежные полосы зернистые — по сглаженной яркости
        d = np.full((H, W), 1e6, np.float32); last = np.full(W, -1e6, np.float32)
        for ps in range(2):                                                # расстояние вниз от снега (с заворотом по вертикали)
            for y in range(H):
                last = np.where(snow[y], y + ps * H, last); d[y] = np.minimum(d[y], y + ps * H - last)
        def gn(sg):
            g = nd.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), sg, mode='wrap'); return (g - g.mean()) / (g.std() + 1e-9)
        patch = np.clip(0.75 + 0.3 * gn(7), 0, 1); grain = gn(0.8)                 # полосой, а не пятнами
        amt = a.frost * np.exp(-d / a.frostd) * (~snow) * patch * np.clip(0.75 + 0.3 * grain, 0, 1.2)
        out = out * (1 - amt[..., None]) + np.array([200, 214, 234], np.float32) * amt[..., None]
        print('frost: mean amount %.3f' % amt.mean())
    Ls = nd.gaussian_filter(L, 4, mode='wrap'); snow = Ls > a.snowL
    if a.snowk != 1:
        m = np.clip((Ls - a.snowL) / 25, 0, 1)[..., None]                  # мягкая маска снега на уступах
        white = np.array([232, 240, 252], np.float32)
        out = out * (1 + (a.snowk - 1) * m) * (1 - 0.25 * m * (a.snowk - 1) / 0.15) + white * 0.25 * m * (a.snowk - 1) / 0.15
    if a.seams:
        H, W = L.shape; rng = np.random.default_rng(13); n = 0
        rock = ~snow
        for _ in range(int(W / 470 * 13)):
            x0, y0 = int(rng.integers(0, W)), int(rng.integers(0, H))
            if not rock[y0, x0]: continue
            ys = [y0]
            for dy in (-1, 1):                                                # вверх и вниз до снега — шов на всю высоту ряда
                y = y0
                while rock[(y + dy) % H, x0] and abs(y + dy - y0) < 400: y += dy
                ys.append(y)
            ya, yb = min(ys), max(ys)
            if yb - ya < 40: continue
            xs = x0 + np.cumsum(rng.normal(0, 0.35, yb - ya + 1)); wd = rng.uniform(6, 10); n += 1   # v121 (критик r38: «чёрные волоски 1–2 px»): мягкая впадина 4–7 px кадра
            for k, y in enumerate(range(ya, yb + 1)):
                cx = xs[k]
                for xx in range(int(cx - wd - 4), int(cx + wd + 3)):
                    dxx = xx - cx; xw = xx % W; yw = y % H
                    if abs(dxx) < wd: q = 1 - abs(dxx) / wd; out[yw, xw] = out[yw, xw] * (1 - 0.42 * q * q * (3 - 2 * q))   # глубже к середине, ΔL −15…−20
                    elif -wd - 4 < dxx <= -wd: out[yw, xw] = np.minimum(255, out[yw, xw] * 1.22 + 4)   # светлая фаска слева (свет сверху слева)
        print('seams: %d' % n)
    if a.icicles > 0:
        H, W = L.shape; rng = np.random.default_rng(9)
        g = nd.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 110, mode='wrap')   # v121: гроздьями (критик r38: «по 1–3 под каждой кромкой» → 4–6 гроздьев, ≥ 60 % кромок без сосулек)
        thick = snow.copy()
        for q in range(1, 15): thick &= np.roll(snow, q, 0)                 # над кромкой ≥ 15 px снега — карниз, а не тонкая полоса
        edge = thick & ~np.roll(snow, -1, 0)                               # снег, под ним порода: нижняя кромка полосы
        ey, ex = np.nonzero(edge)
        thr = np.quantile(g[ey, ex], 1 - a.icicles)
        sel = (g[ey, ex] > thr) & (rng.random(len(ey)) < 1 / 13)
        n = 0
        for y0, x0 in zip(ey[sel], ex[sel]):
            u = rng.random(); Lc = rng.uniform(25, 50) if u < 0.7 else rng.uniform(50, 80) if u < 0.95 else rng.uniform(80, 110)
            w0 = min(13.0, 6.0 + Lc * 0.08); tip = rng.uniform(-0.25, 0.25) * w0; n += 1; op = rng.uniform(0.6, 0.8)
            for k in range(int(Lc) + 1):
                t = k / Lc; hw = w0 / 2 * (1 - t) ** 0.8 + 0.35; cx = x0 + tip * t; y = (y0 + k) % H
                for dx in range(int(-hw - 1), int(hw + 2)):
                    xx = int(round(cx)) + dx; cov = np.clip(hw - abs(xx - cx) + 0.5, 0, 1)
                    if cov <= 0: continue
                    side = (xx - cx) / max(hw, 0.5)                           # −1 лево (свет) … +1 право (тень)
                    col = np.array([200, 225, 245], np.float32) * (1 - max(0, side) * 0.3) + np.array([40, 26, 10], np.float32) * max(0, -side)
                    if abs(xx - (cx - hw * 0.45)) < 0.6: col = np.array([245, 250, 255], np.float32)   # блик 1 px
                    al = op * (0.85 + 0.15 * t) * cov
                    if k >= int(Lc) - 1 and abs(xx - cx) < 1: col = np.array([240, 248, 255], np.float32); al = cov   # капля
                    xw = xx % W; out[y, xw] = out[y, xw] * (1 - al) + col * al
        print('icicles: %d' % n)
    print('desalt: pixels touched %.2f%%, L>150 before %.3f after %.3f' % ((w > 0.05).mean() * 100, (L > 150).mean(),
          ((out @ np.array([0.299, 0.587, 0.114], np.float32)) > 150).mean()))
    Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8)).save(a.out)


if __name__ == '__main__':
    main()
