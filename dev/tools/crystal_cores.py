"""Белые сердцевины друз Alien (критик r38: «друзы 60 % голубые с белым ядром»; на эталоне — светящиеся кристаллы с
выбеленной середкой и цветной каймой). Рендер Blender (make_decor.py crystals, вид Standard) даёт ровное насыщенное
свечение — сердцевина не выбеливается.

python dev/tools/crystal_cores.py [--k 0.75] [--lo 70] [--hi 99] [--edge 6] crystal_c1 crystal_c2 ...

- подробная версия assets/tex/surface/<имя>.png (родная, 8 px на ед.), исходник сохраняется один раз в
  dev/tex-backup/<имя>_surface_precore.png и дальше берётся оттуда (повторный запуск не копит белизну);
- в пикселях кристалла (альфа > 0,5) — сдвиг к белому c + (255 − c)·w, w = smoothstep(процентиль lo, процентиль hi яркости)·k,
  только вдали от края силуэта (edge px, мягко) — кайма и тёмные грани остаются цветными;
- малая версия assets/tex/<имя>.png — уменьшение ×4 с учётом прозрачности (как save_pair в make_decor.py).
"""
import argparse
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent.parent


def smooth(e0, e1, x):
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0, 1); return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='+')
    ap.add_argument('--k', type=float, default=0.75); ap.add_argument('--lo', type=float, default=70); ap.add_argument('--hi', type=float, default=99)
    ap.add_argument('--edge', type=float, default=6); ap.add_argument('--small', type=int, default=4)
    a = ap.parse_args()
    for n in a.names:
        hi = ROOT / 'assets/tex/surface' / (n + '.png'); bak = ROOT / 'dev/tex-backup' / (n + '_surface_precore.png')
        if not bak.exists(): bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(hi, bak)
        im = np.asarray(Image.open(bak).convert('RGBA'), dtype=np.float32)
        rgb, al = im[..., :3], im[..., 3] / 255
        L = rgb @ np.array([0.299, 0.587, 0.114], np.float32); m = al > 0.5
        q0, q1 = np.percentile(L[m], [a.lo, a.hi])
        inner = smooth(0, a.edge, nd.distance_transform_edt(m))                # вдали от края силуэта
        w = smooth(q0, q1, L) * a.k * inner * m
        out = rgb + (255 - rgb) * w[..., None]
        res = np.concatenate([np.clip(out, 0, 255), im[..., 3:4]], -1)
        Image.fromarray(res.round().astype(np.uint8), 'RGBA').save(hi)
        F = a.small; h, wd = res.shape[0] // F, res.shape[1] // F
        pre = res[:h * F, :wd * F].copy(); pre[..., :3] *= pre[..., 3:4] / 255
        lo = pre.reshape(h, F, wd, F, 4).mean((1, 3)); A = lo[..., 3:4]
        lo[..., :3] = np.where(A > 0.5, lo[..., :3] / np.maximum(A, 1e-3) * 255, 0)
        Image.fromarray(np.clip(lo, 0, 255).round().astype(np.uint8), 'RGBA').save(ROOT / 'assets/tex' / (n + '.png'))
        Lo = out @ np.array([0.299, 0.587, 0.114], np.float32)
        print('%s: L95 %.0f → %.0f, белых (min канал > 230) %.3f → %.3f' % (n, np.percentile(L[m], 95), np.percentile(Lo[m], 95),
              (rgb[m].min(1) > 230).mean(), (out[m].min(1) > 230).mean()))


if __name__ == '__main__':
    main()
