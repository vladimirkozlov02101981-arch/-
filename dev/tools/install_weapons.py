"""Переносит рендеры оружия (dev/blender/make_weapons2.py → test-results/weapons2) в assets/tex.
python dev/tools/install_weapons.py [папка]
PNG пересохраняются без потерь с оптимизацией (прозрачность сохраняется); прозрачные поля по краю не обрезаются —
кадр должен остаться 48×24 ед. (и 16×16 ед. у ent_*), иначе предмет сместится в руке."""
import glob, os, sys
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'test-results', 'weapons2')
DST = os.path.join(ROOT, 'assets', 'tex')
total = 0
for p in sorted(glob.glob(os.path.join(SRC, 'wpn_*.png')) + glob.glob(os.path.join(SRC, 'ent_*.png'))):
    im = Image.open(p).convert('RGBA')
    # полностью прозрачным пикселям — нулевой цвет: так PNG сжимается заметно лучше
    px = im.load(); w, h = im.size
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0: px[x, y] = (0, 0, 0, 0)
    out = os.path.join(DST, os.path.basename(p)); im.save(out, optimize=True); total += os.path.getsize(out)
    print('INSTALLED', os.path.basename(p), im.size, os.path.getsize(out) // 1024, 'KB')
print('TOTAL', total // 1024, 'KB')
