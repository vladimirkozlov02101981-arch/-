"""Кристаллы в новой породе Alien (v91, make_rubble.py: объёмные призмы пучками): в рендере они бледные (AgX уводит яркий
насыщенный цвет в белый) и не светятся в игре. Подкраска по рендеру ×4 до сборки родной текстуры:

python dev/tools/alien_crystals2.py <рендер ×4.png> <выход.png>

- кристалл = насыщенные пиксели бирюзового или пурпурно-фиолетового тона пятнами от 150 px (камень серый, его сиреневые
  блики — мелкие крапины и не в счёт);
- внутри каждого пучка яркость от тёмного края к светлой сердцевине (по исходной яркости), тон — бирюза
  (20,110,160)→(175,250,255) или пурпур (110,25,160)→(250,170,255);
- мягкий ореол 5 px на камне вокруг. Сердцевины ярче 150 по max(r,g,b) — в игре светятся (glowTex, glowTex2 в themes.js).
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None


def main(src, out):
    img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    mx = img.max(2); mn = img.min(2); sat = (mx - mn) / np.maximum(mx, 1)
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    # по разнице каналов (v93: гранёные кристаллы в рендере пастельные — насыщенность 0,18–0,27, как у бликов мокрого камня;
    # камень серо-сиреневый: R − G ≈ 8–10, B − G ≈ 12–20, поэтому пороги 15–28 его не задевают; мелкие пятна < 150 px отсекаются)
    cyan = ((G > R + 22) & (B > R + 22)) | ((sat > 0.32) & (mx > 30) & (B >= R) & (G > R + 8))
    mag = ((R > G + 15) & (B > G + 28)) | ((sat > 0.36) & (mx > 30) & (B > G + 10) & (R > G + 4))
    out_img = img.copy()
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
        halo = ndimage.gaussian_filter(mask.astype(np.float32), 5) * 1.2
        halo = np.clip(halo, 0, 1) * (~mask)
        out_img += (halo ** 1.3)[..., None] * np.array(glow, np.float32) * 0.35
        print('crystals', n, 'px', int(mask.sum()))
    Image.fromarray(np.clip(np.rint(out_img), 0, 255).astype(np.uint8)).save(out)
    print('wrote', out)


if __name__ == '__main__':
    main(*sys.argv[1:3])
