"""Выравнивание оттенка крупных пятен родной текстуры (критик r32: «серо-розовые блоки выбиваются из рыжих»).

python dev/tools/tone_even.py <имя> [--k 0.65] [--sigma 40]

Оттенок (отношения R/G и B/G) сглаживается по крупному масштабу (σ в пикселях малой текстуры) и на долю k притягивается
к среднему по всей текстуре; яркость и мелкая фактура не меняются. Пишет родную webp (q90) и малую — точное уменьшение.
Прежняя родная — dev/tex-backup/<имя>_native.webp (один раз).
"""
import argparse, shutil
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent.parent
Image.MAX_IMAGE_PIXELS = None
ap = argparse.ArgumentParser(); ap.add_argument('name'); ap.add_argument('--k', type=float, default=0.65); ap.add_argument('--sigma', type=float, default=40); ap.add_argument('--src', default=None)
a = ap.parse_args()
nat = ROOT / 'assets/tex/native' / f'{a.name}.webp'; bak = ROOT / 'dev/tex-backup' / f'{a.name}_native.webp'
if not bak.exists(): bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(nat, bak)
img = np.asarray(Image.open(a.src or bak).convert('RGB')).astype(np.float32); H, W, _ = img.shape
small = img.reshape(H // 4, 4, W // 4, 4, 3).mean((1, 3)) + 1
rg, bg = small[..., 0] / small[..., 1], small[..., 2] / small[..., 1]
srg, sbg = (ndimage.gaussian_filter(v, a.sigma, mode='wrap') for v in (rg, bg))
mrg, mbg = np.median(rg), np.median(bg)
# множители каналов на крупном масштабе: локальный оттенок → средний (G не меняется, яркость поправляется ниже)
fr = (1 + a.k * (mrg / srg - 1)); fb = (1 + a.k * (mbg / sbg - 1))
up = lambda f: np.kron(f, np.ones((4, 4), np.float32))[:H, :W]
Fr, Fb = up(fr), up(fb)
out = img.copy(); out[..., 0] *= Fr; out[..., 2] *= Fb
L0 = img @ np.array([.3, .59, .11], np.float32); L1 = out @ np.array([.3, .59, .11], np.float32)
out *= (L0 / np.maximum(L1, 1))[..., None]
out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
Image.fromarray(out).save(nat, 'WEBP', quality=90, method=6)
lo = out.reshape(H // 4, 4, W // 4, 4, 3).astype(np.float32).mean((1, 3))
Image.fromarray(np.clip(np.rint(lo), 0, 255).astype(np.uint8)).save(ROOT / 'assets/tex' / f'{a.name}.png', optimize=True)
print('tone_even', a.name, 'rg', round(float(rg.std()), 3), '->', round(float((rg * fr).std()), 3))
