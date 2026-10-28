"""Расплав в швах базальта (критик r29: «оранжевые плоские пятна похожи на дыры»): тонкие светящиеся трещины.

python dev/tools/volcano_lava_cracks.py [--name rock_volcano] [--src 4x.png] [--core 0.26] [--glow 0.5] [--gain 2.62,2.66,2.36]

Родная ×4 assets/tex/native/<имя>.webp (прежняя — dev/tex-backup/<имя>_native.webp, один раз):
- расплав = оранжевые пиксели; в каждом вертикальном отрезке расплава светится только середина (доля core): оранжево-жёлтая
  сердцевина (255/170/60) → красно-оранжевый край, остальное — тёмная остывшая корка с редкими угольками;
- v101 (критик r35: «золотые слитки 7–9×45–90 px»): светится только доля швов glow — отрезками по плавному шуму (seg), прочие
  швы — тёмная корка, как в эталоне;
- v101: игра умножает тексели на усиление темы (themes.js volcano tex.gain ×2,6), и корка с отсветом от этого становились
  жёлто-оранжевыми полосами. Поэтому всё считается в цвете кадра F (камень = исходник × gain) и записывается как F / gain;
- отсвет: камень у сердцевины подкрашивается оранжевым (спадает квадратично);
- dark — яркость камня (v101: 0,92; v109 — 1,1: критик r36 — медиана 26/13/10 при эталоне 34/17/12);
- v109 (критик r36: «губка без плит, расплав — длинные реки»): плиты 60–90 ед. с тёмными швами, расплав в части швов очагами,
  угольки, мелкие поры заделаны.
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
    ap.add_argument('--core', type=float, default=0.26)
    ap.add_argument('--dark', type=float, default=1.1)
    ap.add_argument('--seed', type=int, default=5)
    ap.add_argument('--glow', type=float, default=0.5, help='доля швов с раскалённой сердцевиной')
    ap.add_argument('--seg', type=float, default=36.0, help='размер отрезков свечения вдоль шва (σ шума, px родной)')
    ap.add_argument('--halo', type=float, default=7.0, help='ширина отсвета (σ, px родной)')
    ap.add_argument('--gain', default='2.62,2.66,2.36', help='усиление темы (themes.js volcano tex.gain)')
    ap.add_argument('--contrast', type=float, default=1.3, help='контраст камня вокруг медианы яркости')
    ap.add_argument('--neutral', type=float, default=1.0, help='сила сдвига тона: блики к серому, тени к красно-бурому (0 — нет)')
    ap.add_argument('--crackle', type=float, default=128.0, help='размер ячеек сетки мелких трещин (px родной, 0 — без сетки)')
    ap.add_argument('--crackK', type=float, default=0.3, help='глубина тёмной щели мелких трещин')
    ap.add_argument('--plate', type=float, default=300.0, help='v109: размер многоугольных плит (px родной ≈ /4 ед. карты), 0 — без плит')
    ap.add_argument('--hot', type=float, default=0.38, help='v109: доля швов плит с расплавом')
    ap.add_argument('--embers', type=int, default=420, help='v109: угольков на текстуру')
    ap.add_argument('--pores', type=float, default=0.6, help='v109: насколько заделать мелкие тёмные поры (0–1)')
    ap.add_argument('--src', default=None, help='исходная родная (по умолчанию — резервная копия dev/tex-backup/<имя>_native.webp)')
    a = ap.parse_args()
    nat = ROOT / 'assets/tex/native' / f'{a.name}.webp'
    bak = ROOT / 'dev/tex-backup' / f'{a.name}_native.webp'
    if not bak.exists():
        bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(nat, bak)
    img = np.asarray(Image.open(a.src or bak).convert('RGB')).astype(np.float32)
    gain = np.array([float(v) for v in a.gain.split(',')], np.float32)
    H, W, _ = img.shape
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    lava = (R > 140) & (R - B > 55) & (G > 70)
    lava = ndimage.binary_opening(lava, iterations=1) | (lava & ndimage.binary_dilation(ndimage.binary_opening(lava, iterations=1), iterations=2))
    rng = np.random.default_rng(a.seed)
    if a.contrast != 1 or a.neutral:
        # v101 (критик r35: «нейтральные блики базальта 60/45/40»): в эталоне тени красно-бурые, блики почти серые, контраст выше
        # (σ яркости 21 против 14 в кадре): яркость от медианы ×contrast, зелёный/синий растут к бликам и убывают к теням
        L = img @ np.array([0.299, 0.587, 0.114], np.float32)
        l50, l90 = np.percentile(L[~lava], [50, 90]); l = (L - l50) / max(1.0, l90 - l50)
        s = np.clip((l50 + (L - l50) * a.contrast) / np.maximum(L, 1), 0.4, 2.2)
        up, dn = np.clip(l, 0, 1.5), np.clip(-l, 0, 1)
        cg = 1 + a.neutral * (0.1 + 0.17 * up - 0.12 * dn); cb = 1 + a.neutral * (0.05 + 0.5 * up - 0.4 * dn)
        img = np.where(lava[..., None], img, img * np.stack([s, s * cg, s * cb], -1))
    if a.crackle > 0:
        # v101 (эталон: поверхность плит в мелкой полигональной сетке трещин, как высохший ил): ячейки Вороного ~crackle px
        # родной (≈ crackle/4 ед. карты) с рваными краями (сдвиг координат шумом), тёмная щель и светлая кромка сверху;
        # сетка периодическая — текстура по-прежнему без швов
        from scipy.spatial import cKDTree
        n = int(W * H / a.crackle ** 2)
        P = rng.random((n, 2)) * [W, H]
        PP = np.concatenate([P + [dx, dy] for dx in (-W, 0, W) for dy in (-H, 0, H)])
        def warp(sig, amp):   # плавный периодический сдвиг: крупный — изгиб щели, мелкий — рваный край
            w = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), sig, mode='wrap'); return w * (amp / w.std())
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        q = np.stack([(xx + warp(14, a.crackle * 0.06) + warp(2.5, 1.2)).ravel(), (yy + warp(14, a.crackle * 0.06) + warp(2.5, 1.2)).ravel()], -1)
        dd, _ = cKDTree(PP).query(q, k=2, workers=-1)
        e = (dd[:, 1] - dd[:, 0]).reshape(H, W) * 0.5                       # расстояние до границы ячеек, px
        wv = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), a.crackle * 0.8, mode='wrap')
        wv = np.clip(0.75 + wv / wv.std() * 0.35, 0.25, 1.15)                # где-то щели глубже, где-то едва видны
        cw = 2.6 * wv                                                         # щель 3–6 px родной ≈ 1–2 px кадра
        u = np.clip((e - cw * 0.35) / (cw * 0.65), 0, 1)
        dark = (1 - u * u * (3 - 2 * u)) * a.crackK * np.clip(wv, 0, 1)          # резкая щель: тёмная середина, край ~2 px
        lip = np.clip(1 - np.abs(np.roll(e, 4, 0) - cw - 1.5) / 2.0, 0, 1) * (np.roll(e, 4, 0) > e) * 0.22 * np.clip(wv, 0, 1)
        pil = 0.88 + 0.12 * np.clip(e / (a.crackle * 0.28), 0, 1) ** 0.6        # чешуйка чуть выпуклая: к щели темнее
        f = ((1 - dark + lip) * (1 + (pil - 1) * np.clip(wv, 0, 1)))[..., None]
        img = np.where(lava[..., None], img, img * f)
    if a.pores > 0:
        # v109: мелкие тёмные поры (критик r36: «тёмных пор 14 %», эталон ~10 %) — заделка закрытием по яркости, только мелкие ямки
        L = img @ np.array([0.299, 0.587, 0.114], np.float32)
        Lc = ndimage.grey_closing(L, size=(5, 5), mode='wrap')
        pk = np.clip((Lc - L) / np.maximum(Lc, 1) / 0.35, 0, 1) * a.pores * (~lava)
        img = img + (img * (Lc / np.maximum(L, 1))[..., None] - img) * pk[..., None]
    plate_core = None
    if a.plate > 0:
        # v109 (критик r36; эталон — плиты 60–135 px кадра ≈ 40–85 ед. с тёмными швами 1–3 px, в части швов — расплав короткими
        # отрезками 2–3 очагами): многоугольная сеть плит (Вороной с рваным краем, периодическая), у каждой плиты свой тон,
        # светлая фаска верхней кромки, тёмный шов; расплав — в доле hot швов, сгущённой в очаги
        from scipy.spatial import cKDTree
        n = max(8, int(W * H / a.plate ** 2))
        P = rng.random((n, 2)) * [W, H]
        PP = np.concatenate([P + [dx, dy] for dx in (-W, 0, W) for dy in (-H, 0, H)])
        def warp2(sig, amp):
            w = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), sig, mode='wrap'); return w * (amp / w.std())
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        q = np.stack([(xx + warp2(40, a.plate * 0.07) + warp2(4, 2.0)).ravel(), (yy * 1.35 + warp2(40, a.plate * 0.07) + warp2(4, 2.0)).ravel()], -1)   # плиты шире, чем выше
        PP[:, 1] *= 1.35
        dd, ii = cKDTree(PP).query(q, k=2, workers=-1)
        e = ((dd[:, 1] - dd[:, 0]) * 0.5).reshape(H, W); cid = (ii[:, 0] % n).reshape(H, W)
        tone = 1 + (rng.random(n) - 0.5) * 0.2
        sv = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), a.plate * 0.3, mode='wrap'); sv = np.clip(0.55 + sv / sv.std() * 0.3, 0.15, 1.0)
        sw = 1.6 + 3.2 * sv                                              # полуширина шва 1,6–4,8 px родной (кадр 1–3 px)
        seam = np.clip(1 - e / sw, 0, 1); seam = seam * seam * (3 - 2 * seam)
        lip = np.clip(1 - np.abs(np.roll(e, 5, 0) - sw - 2.0) / 2.5, 0, 1) * (np.roll(e, 5, 0) > e) * 0.16   # светлая фаска сверху от шва
        f = tone[cid] * (1 - 0.86 * seam) * (1 + lip) * (1 - 0.18 * np.clip(1 - e / (sw * 4), 0, 1))         # у шва плита темнее (скругление)
        img = np.where(lava[..., None], img, img * f[..., None])
        # расплав в швах: шум вдоль швов (отрезки) × крупный шум (очаги)
        hs = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), a.plate * 0.12, mode='wrap')
        hf_ = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), a.plate * 1.6, mode='wrap')
        hv = hs / hs.std() + 1.3 * hf_ / hf_.std()
        on = seam > 0.3
        thr = np.quantile(hv[on], 1 - a.hot) if on.any() else 9
        hseg = np.clip((hv - thr) / 0.35, 0, 1)
        hw_ = np.clip(1 - e / (sw * 1.3), 0, 1)                         # раскалённый шов чуть шире тёмного: в кадре 1–3 px
        plate_core = np.clip(hw_ * 1.25 - 0.1, 0, 1) * hseg * (~lava)
        print('plates', n, 'seam px', int(on.sum()), 'hot px', int((plate_core > 0.4).sum()))
    crust = np.array([12, 8, 7], np.float32)                  # остывшая корка (× gain в кадре ≈ 31/21/17 — почти чёрный шов)
    # кайма лужицы (сглаженный край расплава Blender, не прошедший порог): с усилением темы — оранжевый контур «слитка»
    ring = ndimage.binary_dilation(lava, iterations=3) & ~lava
    wr = np.where(ring, np.clip((R - B - 18) / 90, 0, 1), 0)[..., None]
    img = img * (1 - wr) + crust * wr
    F = img * a.dark * gain                                   # цвет кадра
    F[..., 2] *= 1.03
    core = np.zeros((H, W), np.float32)
    crust = crust * gain
    for x in range(W):
        col = lava[:, x]
        if not col.any(): continue
        d = np.diff(np.r_[0, col.astype(np.int8), 0])
        for y0, y1 in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)):
            h = y1 - y0; c = (y0 + y1 - 1) / 2; half = max(0.8, h * a.core / 2)
            yy = np.arange(y0, y1); q = np.clip(1 - np.abs(yy - c) / (half + 0.5), 0, 1)
            core[y0:y1, x] = q
            F[y0:y1, x] = crust * (0.75 + 0.5 * rng.random(h))[:, None]
    # отрезки свечения: плавный шум вдоль швов, порог — по доле glow среди пикселей расплава
    nz = ndimage.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), a.seg, mode='wrap')
    thr = np.quantile(nz[lava], 1 - a.glow) if lava.any() else 0
    seg = np.clip((nz - thr) / (nz.std() * 0.25) + 0.5, 0, 1)
    core = core * seg
    if plate_core is not None: core = np.maximum(core, plate_core)
    core = ndimage.gaussian_filter(core, 0.7)
    k = np.clip(core * 1.6, 0, 1)[..., None]
    hot = np.stack([255 + 0 * core, 95 + 75 * core ** 2, 25 + 35 * core ** 3], -1)
    F = F * (1 - k) + hot * k
    # отсвет на камень: размытая сердцевина, квадратичный спад
    halo = np.clip(ndimage.gaussian_filter(core, a.halo, mode='wrap') * 1.7, 0, 1) ** 1.5   # v109: ореол слабее (2,4 → 1,7): трещины тонкие
    F += halo[..., None] * np.array([110, 36, 6], np.float32) * (1 - k)
    # редкие угольки в корке
    emb = (rng.random((H, W)) > 0.9985) & lava & (core < 0.2)
    F[emb] = [255, 140, 40]
    # v109 (критик r36: угольков 14 → ~30 на 100 тыс. px кадра): тлеющие точки 2–3 px кадра (r 3–6 px родной), чаще у швов
    for _ in range(a.embers):
        cx, cy = rng.random() * W, rng.random() * H
        if plate_core is not None and rng.random() < 0.6:
            for _t in range(12):
                tx, ty = int(rng.random() * W), int(rng.random() * H)
                if seam[ty, tx] > 0.2: cx, cy = tx + rng.normal() * 3, ty + rng.normal() * 3; break
        r = 1.6 + rng.random() * 2.6; R0 = int(r) + 3
        ys = np.arange(int(cy) - R0, int(cy) + R0 + 1) % H; xs = np.arange(int(cx) - R0, int(cx) + R0 + 1) % W
        dy = (np.arange(int(cy) - R0, int(cy) + R0 + 1) - cy)[:, None]; dx = (np.arange(int(cx) - R0, int(cx) + R0 + 1) - cx)[None, :]
        q = np.clip(1 - np.sqrt(dx * dx + dy * dy) / r, 0, 1)[..., None]
        blk = F[np.ix_(ys, xs)]
        F[np.ix_(ys, xs)] = blk * (1 - q ** 0.7) + np.stack([255 + 0 * q[..., 0], 110 + 100 * q[..., 0] ** 2, 30 + 70 * q[..., 0] ** 3], -1) * q ** 0.7
    T = F / gain
    out = np.clip(np.rint(T), 0, 255).astype(np.uint8)
    Image.fromarray(out).save(nat, 'WEBP', quality=90, method=6)
    small = np.clip(T, 0, 255).reshape(H // 4, 4, W // 4, 4, 3).mean((1, 3))
    Image.fromarray(np.clip(np.rint(small), 0, 255).astype(np.uint8)).save(ROOT / 'assets/tex' / f'{a.name}.png', optimize=True)
    print('lava px', int(lava.sum()), 'glow px', int((k[..., 0] > 0.5).sum()), 'wrote', nat)


if __name__ == '__main__':
    main()
