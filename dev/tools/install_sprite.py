"""Ставит спрайт ×3 из рендера в игру: assets/tex/surface/<имя>.png (как есть, 960) и малую assets/tex/<имя>.png (320) —
уменьшение 3×3 с премультипликацией прозрачности (без тёмной каймы). Прежние файлы — в dev/tex-backup/trees один раз.
python dev/tools/install_sprite.py <папка с рендерами> <имя> [...]"""
import shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
src = Path(sys.argv[1])
for n in sys.argv[2:]:
    bk = ROOT / 'dev/tex-backup/trees'; bk.mkdir(parents=True, exist_ok=True)
    for a, b in ((ROOT / f'assets/tex/{n}.png', bk / f'{n}.png'), (ROOT / f'assets/tex/surface/{n}.png', bk / f'{n}_surface.png')):
        if a.exists() and not b.exists(): shutil.copy(a, b)
    im = Image.open(src / f'{n}.png').convert('RGBA'); W, H = im.size; k = 3
    im.save(ROOT / f'assets/tex/surface/{n}.png', optimize=True)
    a = np.asarray(im).astype(np.float32); al = a[..., 3:4] / 255
    p = np.concatenate([a[..., :3] * al, al * 255], 2).reshape(H // k, k, W // k, k, 4).mean((1, 3))
    out = np.zeros_like(p); m = p[..., 3:4] > 0
    out[..., :3] = np.where(m, p[..., :3] / np.maximum(p[..., 3:4] / 255, 1e-6), 0); out[..., 3] = p[..., 3]
    Image.fromarray(np.clip(np.rint(out), 0, 255).astype(np.uint8)).save(ROOT / f'assets/tex/{n}.png', optimize=True)
    print('INSTALLED', n, im.size, '->', (W // k, H // k))
