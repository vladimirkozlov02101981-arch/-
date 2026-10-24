"""Пласты песчаника каньона как в эталоне (критик r34: «чередование светлых и красных пластов с коркой сверху»): у каждого
пласта светлая обесцвеченная корка сверху и густо-красный низ. Замер эталона по высоте: гребни 125–137/84–103/55–80,
низ пластов 68–93/29–51/8–27; в игре тон был одинаковым по всему пласту (порода v84 + tone_even).

python dev/tools/canyon_strata.py [--src родная.webp]     (запуск питоном с bpy — тем же, что make_masonry.py)

Карта пластов — из того же генератора (make_masonry.py field с '_rowmap': номер ряда и доля высоты), поэтому корка и
красный низ ложатся ровно по швам отрендеренной текстуры. Пишет assets/tex/native/rock_canyon.webp и dirt_canyon.webp
(одна картинка), малые — точное уменьшение 4×4. Исходник — родная до пластов (dev/tex-backup/rock_canyon_strata_native.webp,
не в git: берётся из истории, коммит 27e2d5c).
"""
import argparse
import os
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
Image.MAX_IMAGE_PIXELS = None


def rowmap():
    os.environ['HF_R'] = '4'
    src = (ROOT / 'dev/blender/make_masonry.py').read_text(encoding='utf-8')
    src = src[:src.rindex('\nmain()')]
    ns = {'__file__': str(ROOT / 'dev/blender/make_masonry.py'), '__name__': 'masonry'}
    exec(compile(src, 'make_masonry.py', 'exec'), ns)
    st = dict(ns['STYLES']['sandstone']); st['_rowmap'] = {}
    ns['field'](st)
    return st['_rowmap']['row'], st['_rowmap']['v']


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--src', default=None); a = ap.parse_args()
    nat = ROOT / 'assets/tex/native/rock_canyon.webp'; bak = ROOT / 'dev/tex-backup/rock_canyon_strata_native.webp'
    if not bak.exists():   # исходник — родная до пластов (версия 91) из истории git: повторный запуск не красит пласты дважды
        import subprocess
        bak.write_bytes(subprocess.run(['git', 'show', '27e2d5c:assets/tex/native/rock_canyon.webp'], cwd=ROOT, check=True, capture_output=True).stdout)
    img = np.asarray(Image.open(a.src or bak).convert('RGB')).astype(np.float32)
    row, v = rowmap()
    assert row.shape == img.shape[:2], (row.shape, img.shape)
    rng = np.random.default_rng(5); n = int(row.max()) + 1
    crust = rng.uniform(0.12, 0.3, n).astype(np.float32)                          # толщина корки — доля высоты пласта
    red = np.where(np.arange(n) % 2 == 0, rng.uniform(0.75, 1.0, n), rng.uniform(0.35, 0.6, n)).astype(np.float32)   # пласты через один краснее
    c = crust[row]; wc = 1 - smooth(c * 0.35, c, v); wr = smooth(0.4, 1.0, v) * red[row]
    L = img @ np.array([0.3, 0.59, 0.11], np.float32)
    kc = (L * 1.22) / (0.3 + 0.59 * 0.72 + 0.11 * 0.52); crustc = np.stack([kc, kc * 0.72, kc * 0.52], -1)
    kr = (L * 0.74) / (0.3 + 0.59 * 0.46 + 0.11 * 0.2); redc = np.stack([kr, kr * 0.46, kr * 0.2], -1)
    sp = np.random.default_rng(9).random(L.shape, np.float32)                     # крошка в корке: светлые и тёмные зёрна
    crustc *= np.where(sp > 0.985, 1.2, np.where(sp < 0.012, 0.75, 1.0))[..., None]
    out = img * (1 - wc - wr)[..., None] + crustc * wc[..., None] + redc * wr[..., None]
    out = np.clip(np.rint(out), 0, 255).astype(np.uint8); H, W, _ = out.shape
    lo = out.reshape(H // 4, 4, W // 4, 4, 3).astype(np.float32).mean((1, 3))
    for name in ('rock_canyon', 'dirt_canyon'):
        Image.fromarray(out).save(ROOT / 'assets/tex/native' / f'{name}.webp', 'WEBP', quality=90, method=6)
        Image.fromarray(np.clip(np.rint(lo), 0, 255).astype(np.uint8)).save(ROOT / 'assets/tex' / f'{name}.png', optimize=True)
    print('canyon_strata rows', n, 'L', round(float(L.mean()), 1), '->', round(float((out.astype(np.float32) @ np.array([0.3, 0.59, 0.11], np.float32)).mean()), 1))


if __name__ == '__main__':
    main()
