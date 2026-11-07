"""Латунь вместо меди на спрайте Blender (критик r39, пираты: «иллюминаторы медные (142–145,85–89,25–32) — нужна латунь
(170,135,74) с бликом 1–2 px до (250,235,170)»).

python dev/tools/brass_sprite.py porthole1 [--mid 0.6] [--glass 0.47]

- подробная версия assets/tex/surface/<имя>.png; исходник сохраняется один раз в dev/tex-backup/<имя>_surface_precolor.png и
  дальше берётся оттуда (повторный запуск не копит сдвиг);
- металл — тёплые насыщенные пиксели (R > 1,5·B, альфа > 0,5); их цвет — по яркости из шкалы латуни: тень (30,22,8) →
  середина (184,168,92) на доле mid от 95-го процентиля яркости металла → (222,206,126) → блик (246,236,178) у верхних 5 %
  (с поправкой на закатный свет карты — на экране латунь ≈ (165,128,72));
  стекло (ближе glass к центру, доля радиуса), болты в тени и прозрачность прежние; кромка металла смешивается мягко (по насыщенности);
- малая версия assets/tex/<имя>.png — уменьшение ×4 с учётом прозрачности.
"""
import argparse
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
Y = np.array([0.299, 0.587, 0.114], np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('--mid', type=float, default=0.6); ap.add_argument('--glass', type=float, default=0.47); ap.add_argument('--small', type=int, default=4)
    a = ap.parse_args()
    hi = ROOT / 'assets/tex/surface' / (a.name + '.png'); bak = ROOT / 'dev/tex-backup' / (a.name + '_surface_precolor.png')
    if not bak.exists(): bak.parent.mkdir(parents=True, exist_ok=True); shutil.copy(hi, bak)
    im = np.asarray(Image.open(bak).convert('RGBA'), dtype=np.float32)
    rgb, al = im[..., :3], im[..., 3] / 255
    L = rgb @ Y; r, b = rgb[..., 0], rgb[..., 2]
    H_, W_ = L.shape; yy, xx = np.mgrid[0:H_, 0:W_]; rad = np.hypot(xx - (W_ - 1) / 2, yy - (H_ - 1) / 2) / (W_ / 2)
    warm = np.clip((r / np.maximum(b, 1) - 1.3) / 0.6, 0, 1) * (al > 0.5) * np.clip((L - 8) / 10, 0, 1) * np.clip((rad - a.glass) / 0.03, 0, 1)   # стекло (r < glass) не трогать
    q95 = np.percentile(L[warm > 0.5], 95); t = L / q95
    # шкала — с поправкой на закатный свет карты (в кадре R ×0,89, G ×0,74, B ×0,76): на экране середина ≈ (165,128,72)
    stops = [(0.0, (34, 28, 12)), (a.mid, (184, 168, 92)), (0.88, (222, 206, 126)), (1.0, (246, 236, 178)), (1.3, (255, 250, 215))]
    ts = np.array([s[0] for s in stops], np.float32); cs = np.array([s[1] for s in stops], np.float32)
    brass = np.stack([np.interp(t, ts, cs[:, k]) for k in range(3)], -1)
    out = rgb * (1 - warm[..., None]) + brass * warm[..., None]
    res = np.concatenate([np.clip(out, 0, 255), im[..., 3:4]], -1)
    Image.fromarray(res.round().astype(np.uint8), 'RGBA').save(hi)
    F = a.small; h, w = res.shape[0] // F, res.shape[1] // F
    pre = res[:h * F, :w * F].copy(); pre[..., :3] *= pre[..., 3:4] / 255
    lo = pre.reshape(h, F, w, F, 4).mean((1, 3)); A = lo[..., 3:4]
    lo[..., :3] = np.where(A > 0.5, lo[..., :3] / np.maximum(A, 1e-3) * 255, 0)
    Image.fromarray(np.clip(lo, 0, 255).round().astype(np.uint8), 'RGBA').save(ROOT / 'assets/tex' / (a.name + '.png'))
    m = warm > 0.5
    print('%s: металл %d px, цвет %s → %s, L95 %.0f → %.0f' % (a.name, int(m.sum()), rgb[m].mean(0).round(), out[m].mean(0).round(),
          np.percentile(L[m], 95), np.percentile((out @ Y)[m], 95)))


if __name__ == '__main__':
    main()
