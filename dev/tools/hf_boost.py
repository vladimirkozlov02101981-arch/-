"""Мелкая деталь родной текстуры (критик r35: «мелкая деталь на 20–50 % ниже эталона»): нерезкая маска по яркости в двух масштабах.

python dev/tools/hf_boost.py <имя> [--a1 0.6] [--s1 1.6] [--a2 0.4] [--s2 5.0] [--clip 60]

- Исходник — прежняя родная assets/tex/native/<имя>.webp; её копия dev/tex-backup/<имя>_native_prehf.webp сохраняется один раз,
  и повторный запуск считает от неё (резкость не накапливается).
- Яркость: L' = L + a1·(L − G(σ1)) + a2·(G(σ1) − G(σ2)) (σ — в пикселях родной, гаусс бесшовный — текстура плиточная), прибавка
  ограничена ±clip; цвет — множителем L'/L, тон не меняется. σ1 ≈ 1,6 px родной — зерно и волокна, σ2 ≈ 5 px (≈1 ед. карты) — деталь,
  видная при обычном масштабе.
- Пишет родную WebP (q90, как make_native --lossy) и малую assets/tex/<имя>.png — точное уменьшение k×k (k = размер родной / малой):
  малая остаётся согласованной с родной (освещение карты LF = нарисованная / малая).
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
    ap.add_argument('name')
    ap.add_argument('--a1', type=float, default=0.6)
    ap.add_argument('--s1', type=float, default=1.6)
    ap.add_argument('--a2', type=float, default=0.4)
    ap.add_argument('--s2', type=float, default=5.0)
    ap.add_argument('--clip', type=float, default=60.0)
    ap.add_argument('--quality', type=int, default=90)
    a = ap.parse_args()
    nat = ROOT / 'assets/tex/native' / f'{a.name}.webp'
    low_p = ROOT / 'assets/tex' / f'{a.name}.png'
    bak = ROOT / 'dev/tex-backup' / f'{a.name}_native_prehf.webp'
    if not bak.exists():
        bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(nat, bak)
    img = np.asarray(Image.open(bak).convert('RGB')).astype(np.float32)
    H, W, _ = img.shape
    lw, lh = Image.open(low_p).size
    k = W // lw
    assert W == lw * k and H == lh * k, 'размеры родной и малой не кратны'
    L = img @ np.array([0.299, 0.587, 0.114], np.float32)
    g1 = ndimage.gaussian_filter(L, a.s1, mode='wrap'); g2 = ndimage.gaussian_filter(L, a.s2, mode='wrap')
    add = np.clip(a.a1 * (L - g1) + a.a2 * (g1 - g2), -a.clip, a.clip)
    out = img * (np.maximum(L + add, 0) / np.maximum(L, 1.0))[..., None]
    out = np.clip(out, 0, 255)
    Image.fromarray(np.rint(out).astype(np.uint8)).save(nat, 'WEBP', quality=a.quality, method=6)
    low = out.reshape(H // k, k, W // k, k, 3).mean((1, 3))
    Image.fromarray(np.clip(np.rint(low), 0, 255).astype(np.uint8)).save(low_p, optimize=True)
    hf0 = float(np.abs(L - ndimage.uniform_filter(L, 3, mode='wrap')).mean())
    L2 = out @ np.array([0.299, 0.587, 0.114], np.float32)
    hf1 = float(np.abs(L2 - ndimage.uniform_filter(L2, 3, mode='wrap')).mean())
    print(a.name, 'HF родной %.2f → %.2f' % (hf0, hf1), 'k', k, 'wrote', nat)


if __name__ == '__main__':
    main()
