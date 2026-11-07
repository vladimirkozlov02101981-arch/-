"""Кристаллы в новой породе Alien (v91, make_rubble.py: объёмные призмы пучками): в рендере они бледные (AgX уводит яркий
насыщенный цвет в белый) и не светятся в игре. Подкраска по рендеру ×4 до сборки родной текстуры:

python dev/tools/alien_crystals2.py <рендер ×4.png> <выход.png> [белизна рёбер 0–1, v123: 0,6] [перелив 0–1, v133: 0,5] [искры, v133: 0,03]

- кристалл = насыщенные пиксели бирюзового или пурпурно-фиолетового тона пятнами от 150 px (камень серый, его сиреневые
  блики — мелкие крапины и не в счёт);
- внутри каждого пучка яркость от тёмного края к светлой сердцевине (по исходной яркости), тон — бирюза
  (20,110,160)→(175,250,255) или пурпур (110,25,160)→(250,170,255);
- мягкий ореол 5 px на камне вокруг. Сердцевины ярче 150 по max(r,g,b) — в игре светятся (glowTex, glowTex2 в themes.js);
- v102 (критик r35: «кристаллы в породе — плоские наклейки»; в рендере грани пастельные и ровные): каждый пучок режется на
  3–10 граней (ячейки Вороного), грань светлее сверху слева, светлые рёбра между гранями, тёмный край 2 px — гранёный камень.
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

Image.MAX_IMAGE_PIXELS = None


def facets(out_img, mask, c0, c1, rng, white=0.0, irid=0.0, sparkle=0.0):
    """грани пучка: ячейки Вороного по случайным точкам внутри пятна; яркость грани — по её положению (свет сверху слева) и
    случаю, внутри грани лёгкий наклон к свету; рёбра светлые, край пятна тёмный"""
    lab, n = ndimage.label(mask); dist = ndimage.distance_transform_edt(mask)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        reg = lab[sl] == i; ys, xs = np.nonzero(reg); area = len(ys)
        if area < 12: continue
        k = int(np.clip(area / 700 + 3, 3, 10)); pick = rng.choice(area, k, replace=False)
        pts = np.stack([xs[pick], ys[pick]], 1).astype(np.float32)
        d, idx = cKDTree(pts).query(np.stack([xs, ys], 1).astype(np.float32), k=2)
        f = idx[:, 0]; e = (d[:, 1] - d[:, 0]) * 0.5
        cx, cy = xs.mean(), ys.mean(); R = max(2.0, np.sqrt(area / np.pi))
        lit = -((pts[f, 0] - cx) + (pts[f, 1] - cy)) / (R * 1.2)
        t = np.clip(0.42 + 0.38 * lit + 0.36 * (rng.random(k)[f] - 0.5), 0.06, 0.92)
        t += np.clip(-((xs - pts[f, 0]) + (ys - pts[f, 1])) / (R * 2.5), -0.12, 0.12)
        t = np.where(e < 1.4, np.maximum(t, 0.97), t)
        col = c0 * (1 - t[:, None]) + c1 * t[:, None]
        if irid > 0:   # v133 (критик r39: «кристаллы — плоские наклейки; эталон — перелив от голубого к фиолетовому, искры»): у граней свой оттенок
            hue = rng.random(k)[f]                                                # 0 — голубой, 1 — фиолетовый (по граням)
            alt = np.where(hue[:, None] > 0.5, np.array([150, 90, 235], np.float32), np.array([90, 200, 245], np.float32)) * (0.35 + 0.75 * t[:, None])
            col = col * (1 - irid) + alt * irid
        if white > 0:   # v123 (критик r38: «кристаллы в толще бледнее, белые блики p95 190 → 210»): рёбра граней — к белому
            col = np.where((e < 1.4)[:, None], col * (1 - white) + np.array([245, 250, 255], np.float32) * white, col)
        di = dist[sl][reg]; col *= np.where(di < 2.2, 0.4 + 0.6 * di / 2.2, 1.0)[:, None]
        if sparkle > 0:   # искры: белые крапины 1–3 px внутри граней (эталон: блики-«блёстки» по всей друзе)
            sp = (rng.random(area) < sparkle) & (di > 2.5)
            col[sp] = col[sp] * 0.2 + np.array([240, 248, 255], np.float32) * 0.8
        sub = out_img[sl]; sub[reg] = col


def main(src, out, white=0.0, irid=0.0, sparkle=0.0):
    img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    mx = img.max(2); mn = img.min(2); sat = (mx - mn) / np.maximum(mx, 1)
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    # по разнице каналов (v93: гранёные кристаллы в рендере пастельные — насыщенность 0,18–0,27, как у бликов мокрого камня;
    # камень серо-сиреневый: R − G ≈ 8–10, B − G ≈ 12–20, поэтому пороги 15–28 его не задевают; мелкие пятна < 150 px отсекаются)
    cyan = ((G > R + 22) & (B > R + 22)) | ((sat > 0.32) & (mx > 30) & (B >= R) & (G > R + 8))
    mag = ((R > G + 15) & (B > G + 28)) | ((sat > 0.36) & (mx > 30) & (B > G + 10) & (R > G + 4))
    out_img = img.copy(); rng = np.random.default_rng(7)
    for mask, c0, c1, glow in ((cyan, (20, 110, 160), (175, 250, 255), (40, 150, 200)), (mag, (110, 25, 160), (250, 170, 255), (150, 50, 200))):
        mask = ndimage.binary_opening(mask, iterations=1)
        # только крупные пятна (пучки призм — от 28 px в длину): сиреневые блики на мокрых камнях — мелкие крапины
        lab0, n0 = ndimage.label(mask); area = ndimage.sum(mask, lab0, range(n0 + 1)); mask = (area >= 150)[lab0] & mask
        lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=2))
        L = img.mean(2)
        lo = ndimage.minimum(L, lab, range(n + 1)); hi = ndimage.maximum(L, lab, range(n + 1))
        t = np.clip((L - lo[lab]) / np.maximum(hi[lab] - lo[lab], 1), 0, 1) ** 0.75
        sel = mask
        c0a = np.array(c0, np.float32); c1a = np.array(c1, np.float32)
        out_img[sel] = c0a * (1 - t[sel][:, None]) + c1a * t[sel][:, None]
        facets(out_img, mask, c0a, c1a, rng, white, irid, sparkle)
        if sparkle > 0:   # искры чуть крупнее одного пикселя: расширение белых точек
            wm = mask & (out_img.min(2) > 225); wm = ndimage.binary_dilation(wm, iterations=1) & mask
            out_img[wm] = out_img[wm] * 0.35 + np.array([235, 244, 255], np.float32) * 0.65
        halo = ndimage.gaussian_filter(mask.astype(np.float32), 5) * 1.2
        halo = np.clip(halo, 0, 1) * (~mask)
        out_img += (halo ** 1.3)[..., None] * np.array(glow, np.float32) * 0.25
        print('crystals', n, 'px', int(mask.sum()))
    Image.fromarray(np.clip(np.rint(out_img), 0, 255).astype(np.uint8)).save(out)
    print('wrote', out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], *(float(v) for v in sys.argv[3:6]))
