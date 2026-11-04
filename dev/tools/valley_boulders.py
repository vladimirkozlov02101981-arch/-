"""Светлые глыбы в грунте долины (критик r38: «грунт после прореживания — p95 106 при 118–129, σ 29,8 при 33,6–39,4; дальше
не прореживать; добавить 2–3 светлые глыбы 60–100 px в средней части, верх камней +15 L»).

python dev/tools/valley_boulders.py <родная.webp> <выход.png> [--lift 21] [--grow 3] [--scale 1.4] [--sharp 0.5] [--pick x0,x1,y0,y1] [--contrast 1.15]
затем: python dev/make_native.py <выход.png> dirt_valley --no-match --lossy --quality 90

1) валуны — тем же классификатором, что и dev/tools/thin_boulders.py (серые ненасыщенные пятна на малой копии ÷4,
   соприкасающиеся — раздельно по ядрам);
2) верх камней светлее: в каждом валуне освещённые грани (ярче его медианы) поднимаются до +lift L (цвет — множителем,
   тон прежний), тени и кромки не трогаются — объём камня сильнее;
3) grow самых крупных глыб увеличиваются на месте в scale раз (без копий: прежние замечания — «ряд одинаковых шатров»):
   кусок с глыбой, её тенью и кромкой земли увеличивается и кладётся по тому же центру с мягкой маской; деталь,
   потерянную при увеличении, возвращает нерезкая маска (sharp) — родная остаётся чёткой при приближении.
Текстура бесшовная — фильтры и вырезки с заворотом.
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage as nd

Image.MAX_IMAGE_PIXELS = None
Y = np.array([0.299, 0.587, 0.114], np.float32)


def box(a, k):
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, -1).mean((1, 3))


def smooth(e0, e1, x):
    t = np.clip((x - e0) / np.maximum(e1 - e0, 1e-6), 0, 1); return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--lift', type=float, default=21); ap.add_argument('--grow', type=int, default=3)
    ap.add_argument('--scale', type=float, default=1.4); ap.add_argument('--sharp', type=float, default=0.5)
    ap.add_argument('--contrast', type=float, default=1.0, help='общий контраст грунта вокруг среднего (σ 29,5 при 33,6–39,4 у эталона)')
    ap.add_argument('--pick', default='', help='окно «x0,x1,y0,y1» в ед. текстуры (с заворотом): увеличивать крупнейшие глыбы из него')
    ap.add_argument('--L', type=float, default=50); ap.add_argument('--S', type=float, default=0.24); ap.add_argument('--min', type=int, default=150)
    a = ap.parse_args()
    N = np.asarray(Image.open(a.src).convert('RGB'), dtype=np.float32); K = 4
    S = box(N, K); L = S @ Y
    sat = (S.max(2) - S.min(2)) / np.maximum(S.max(2), 1)
    m = (nd.gaussian_filter(L, 2.5, mode='wrap') > a.L) & (nd.gaussian_filter(sat, 2.5, mode='wrap') < a.S)
    m = nd.binary_opening(nd.binary_closing(m, iterations=3), iterations=2)
    core, nc = nd.label(nd.binary_erosion(m, iterations=3))
    idx = nd.distance_transform_edt(core == 0, return_distances=False, return_indices=True)
    lab = np.where(m, core[idx[0], idx[1]], 0)
    area = nd.sum(m, lab, range(1, nc + 1)); sl = nd.find_objects(lab)
    ids = [i for i in range(nc) if area[i] >= a.min and sl[i] is not None]
    print('boulders %d, largest (px малой копии): %s' % (len(ids), sorted((int(area[i]) for i in ids), reverse=True)[:6]))
    out = N.copy(); H, W = L.shape
    LN = N @ Y
    # 2) верх камней светлее
    if a.lift > 0:
        lab4 = np.kron(lab, np.ones((K, K), np.int32))
        med = np.zeros(nc + 1, np.float32)
        med[[i + 1 for i in ids]] = nd.median(LN, lab4, [i + 1 for i in ids])
        ok = np.zeros(nc + 1, bool); ok[[i + 1 for i in ids]] = True
        sel = ok[lab4]
        mk = nd.gaussian_filter(sel.astype(np.float32), 2.0, mode='wrap')
        w = mk * smooth(med[lab4] - 6, med[lab4] + 28, LN) * sel
        Lt = LN + a.lift * w
        out *= (Lt / np.maximum(LN, 1))[..., None]
        top = sel & (LN > med[lab4])
        print('lift: светлые грани камней L %.1f → %.1f' % (LN[top].mean(), (out @ Y)[top].mean()))
    # 3) крупнейшие глыбы — крупнее на месте
    cand = ids
    if a.pick:
        x0, x1, y0, y1 = map(float, a.pick.split(','))
        def inwin(i):
            ys, xs = sl[i]; cx, cy = (xs.start + xs.stop) / 2, (ys.start + ys.stop) / 2   # ед. текстуры (малая копия — 1 px на ед.)
            okx = (x0 <= cx < x1) if x0 <= x1 else (cx >= x0 or cx < x1)
            oky = (y0 <= cy < y1) if y0 <= y1 else (cy >= y0 or cy < y1)
            return okx and oky
        cand = [i for i in ids if inwin(i)]
    big = sorted(cand, key=lambda i: -area[i])[:a.grow]
    for i in big:
        ys, xs = sl[i]; cy, cx = (ys.start + ys.stop) / 2 * K, (xs.start + xs.stop) / 2 * K
        hh, ww = (ys.stop - ys.start) * K, (xs.stop - xs.start) * K
        R0 = int(max(hh, ww) * 0.5 * 1.5 + 24)                                  # кусок с тенью и кромкой земли
        yy = (np.arange(int(cy) - R0, int(cy) + R0)) % (H * K); xx = (np.arange(int(cx) - R0, int(cx) + R0)) % (W * K)
        crop = out[np.ix_(yy, xx)]
        mm = (np.kron(lab, np.ones((K, K), np.int32))[np.ix_(yy, xx)] == i + 1).astype(np.float32)
        mm = np.maximum(mm, nd.shift(mm, (6, 4), order=1) * 0.9)              # тень вниз-вправо (свет сверху слева)
        mm = nd.binary_dilation(mm > 0.3, iterations=6).astype(np.float32)
        Rn = int(R0 * a.scale)
        big_img = np.stack([np.asarray(Image.fromarray(crop[..., c]).resize((2 * Rn, 2 * Rn), Image.LANCZOS)) for c in range(3)], -1)
        big_m = np.asarray(Image.fromarray(mm).resize((2 * Rn, 2 * Rn), Image.BILINEAR))
        if a.sharp > 0:
            bl = nd.gaussian_filter(big_img, (1.6, 1.6, 0))
            big_img = big_img + a.sharp * (big_img - bl)
        al = np.clip(nd.gaussian_filter(big_m, 5) * 1.3, 0, 1)[..., None]
        Y2 = (np.arange(int(cy) - Rn, int(cy) + Rn)) % (H * K); X2 = (np.arange(int(cx) - Rn, int(cx) + Rn)) % (W * K)
        dst = out[np.ix_(Y2, X2)]
        out[np.ix_(Y2, X2)] = dst * (1 - al) + big_img * al
        print('grow: глыба %d×%d px родной → ×%.2f (центр %d, %d)' % (ww, hh, a.scale, cx, cy))
    if a.contrast != 1:
        M = out.reshape(-1, 3).mean(0); out = M + (out - M) * a.contrast
    L1 = out @ Y; L0 = N @ Y
    print('L95 %.0f → %.0f, σL %.1f → %.1f' % (np.percentile(L0, 95), np.percentile(L1, 95), L0.std(), L1.std()))
    Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8)).save(a.out)


if __name__ == '__main__':
    main()
