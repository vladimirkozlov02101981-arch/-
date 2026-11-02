"""Цвет камней грунта по маске (критик r36, замки: «холодная серо-голубая галька; в эталоне тёплые серо-бежевые глыбы с
лишайником»). Тема замков усиливает зелёный и синий (gain [1, 1.45, 1.85] — для рыжей земли), поэтому нейтральные камни
текстуры на экране голубеют; здесь они заранее сдвигаются в тёплую сторону.

python dev/tools/warm_stones.py <родная.png|webp> <маска.png> <выход.png> [--ratio 1,0.56,0.44] [--mix 0.85] [--lichen 0.14] [--seed 4]
затем: python dev/make_native.py <выход.png> dirt_castle --no-match --lossy --quality 90

Маска — камни, как их разложил генератор (dev/blender/make_soil.py, SOIL_MASK=…), того же размера, что и родная.
ratio — цвет камня (отношение каналов) в самой текстуре: на экране ×gain темы — тёплый серо-бежевый эталона (126/110/102);
яркость каждого пикселя прежняя (свет и тени камня из рендера), цвет — ratio, mix — доля замены (остаток — прежний оттенок).
Прежнее «×k» не годилось: синие тени камней после подгонки палитры оставались синими.
lichen — доля площади камней с пятнами лишайника (бледно-серо-зелёные крапины 1–4 ед., как на эталоне).
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage as nd

Image.MAX_IMAGE_PIXELS = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('mask'); ap.add_argument('out')
    ap.add_argument('--ratio', default='1,0.56,0.44'); ap.add_argument('--mix', type=float, default=0.85); ap.add_argument('--lichen', type=float, default=0.14)
    ap.add_argument('--seed', type=int, default=4)
    a = ap.parse_args()
    img = np.asarray(Image.open(a.src).convert('RGB'), dtype=np.float32)
    m = np.asarray(Image.open(a.mask).convert('L'), dtype=np.float32) / 255
    if m.shape != img.shape[:2]:
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(img.shape[1::-1], Image.BILINEAR), np.float32) / 255
    w = np.clip(nd.gaussian_filter(m, 1.0, mode='wrap') * 1.2, 0, 1)[..., None]   # мягкая кромка — без цветного ореола
    ratio = np.array([float(v) for v in a.ratio.split(',')], np.float32); Y = np.array([0.299, 0.587, 0.114], np.float32)
    L0 = img @ Y
    warm = L0[..., None] * ratio / float(ratio @ Y)                         # яркость прежняя — цвет из ratio
    out = img * (1 - w * a.mix) + warm * (w * a.mix)
    if a.lichen > 0:
        rng = np.random.default_rng(a.seed); H, W = m.shape
        g = nd.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 6, mode='wrap')
        g2 = nd.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 1.2, mode='wrap')
        g = (g - g.mean()) / (g.std() + 1e-9); g2 = (g2 - g2.mean()) / (g2.std() + 1e-9)
        sel = m > 0.5
        thr = np.quantile(g[sel], 1 - a.lichen) if sel.any() else 9
        lk = np.clip((g - thr) / 0.4, 0, 1) * np.clip(0.6 + 0.4 * g2, 0, 1) * m * 0.55
        lc = np.array([120, 92, 70], np.float32)                           # до gain темы: на экране бледно-серо-зелёный
        Lo = out @ np.array([0.299, 0.587, 0.114], np.float32)
        out = out * (1 - lk[..., None]) + (lc * (0.6 + 0.6 * Lo / 140)[..., None]) * lk[..., None]
        print('lichen: %.3f of stone area' % ((lk > 0.1).sum() / max(1, sel.sum())))
    print('stones: %.3f of texture' % (m > 0.5).mean())
    Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8)).save(a.out)


if __name__ == '__main__':
    main()
