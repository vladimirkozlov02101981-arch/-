"""Палитра кадра грунта по маске почва/камень: медиана sRGB и квантили яркости отдельно для почвы и камней.
python dev/tools/ground_palette.py <raw.png> <mask.png>   (маска: чёрное — почва, белое — камни и галька)
Цели — по принятому грунту долины assets/tex/dirt_valley.png (почва ~65/48/35, камни ~94/88/85)."""
import sys
import numpy as np
from PIL import Image


def measure(raw_path, mask_path):
    raw = Image.open(raw_path).convert('RGB')
    mask = Image.open(mask_path).convert('L').resize(raw.size, Image.Resampling.NEAREST)
    a = np.asarray(raw, dtype=np.float32).reshape(-1, 3)
    m = np.asarray(mask).reshape(-1)
    out = {}
    for name, sel in [('soil', m < 40), ('rock', m > 215)]:
        s = a[sel]
        L = s @ np.array([0.3, 0.59, 0.11])
        mx, mn = s.max(1), s.min(1)
        out[name] = {'share': round(float(sel.mean()), 3), 'median': np.median(s, 0).round(1).tolist(),
                     'L_q10_50_90': np.percentile(L, [10, 50, 90]).round(1).tolist(),
                     'sat_median': round(float(np.median((mx - mn) / np.maximum(mx, 1))), 3)}
    return out


if __name__ == '__main__':
    import json
    print(json.dumps(measure(sys.argv[1], sys.argv[2]), ensure_ascii=False))
