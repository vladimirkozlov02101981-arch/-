"""
Бесшовная текстура породы из эталонного кадра (синтез «лоскутным шитьём», Efros–Freeman image quilting).
Берутся чистые участки эталона (без лестниц, бойцов, декора), масштабируются к масштабу игры
(пикселей эталона на игровую единицу) и сшиваются в бесшовную плитку: каждый лоскут подбирается так,
чтобы его край совпадал с уже уложенными, шов проводится по линии наименьшей разницы.

Запуск: python dev/tex_from_ref.py <эталон.png> <выход.png> <масштаб> <размер> x0,y0,x1,y1 [x0,y0,x1,y1 ...]
"""
import sys, numpy as np
from PIL import Image

def load_sources(path, boxes, scale):
    im = Image.open(path).convert('RGB'); out = []
    for b in boxes:
        c = im.crop(b); w, h = c.size
        c = c.resize((max(8, round(w * scale)), max(8, round(h * scale))), Image.LANCZOS)
        out.append(np.asarray(c).astype(np.float32))
    return out

def min_cut_v(err):
    """вертикальный шов наименьшей ошибки: для каждой строки — столбец границы"""
    h, w = err.shape; E = err.copy()
    for y in range(1, h):
        p = E[y - 1]; l = np.r_[np.inf, p[:-1]]; r = np.r_[p[1:], np.inf]
        E[y] += np.minimum(np.minimum(l, p), r)
    path = np.zeros(h, int); path[-1] = int(np.argmin(E[-1]))
    for y in range(h - 2, -1, -1):
        x = path[y + 1]; lo, hi = max(0, x - 1), min(w, x + 2)
        path[y] = lo + int(np.argmin(E[y, lo:hi]))
    return path

def quilt(srcs, size, B, O, seed=1, cands=500):
    rng = np.random.default_rng(seed); S = B - O; n = size // S; size = n * S
    out = np.zeros((size, size, 3), np.float32); filled = np.zeros((size, size), bool)
    def idx(y, x): return (np.arange(y, y + B) % size)[:, None], (np.arange(x, x + B) % size)[None, :]
    for gy in range(n):
        for gx in range(n):
            y, x = gy * S, gx * S; iy, ix = idx(y, x)
            tgt = out[iy, ix]; m = filled[iy, ix]
            best = [];
            for _ in range(cands):
                s = srcs[rng.integers(len(srcs))]; H, W = s.shape[:2]
                if H < B or W < B: continue
                sy, sx = rng.integers(0, H - B + 1), rng.integers(0, W - B + 1)
                p = s[sy:sy + B, sx:sx + B]
                e = ((p - tgt) ** 2).sum(2)[m].mean() if m.any() else rng.random()
                best.append((e, p))
            best.sort(key=lambda t: t[0]); lim = best[0][0] * 1.1 + 1e-6
            ok = [p for e, p in best if e <= lim]; p = ok[rng.integers(len(ok))]
            # маска: где класть новый лоскут (шов по линии наименьшей разницы в перекрытиях)
            mask = np.ones((B, B), bool)
            if m.any():
                d = ((p - tgt) ** 2).sum(2)
                if m[:, :O].all():   # левое перекрытие
                    cut = min_cut_v(d[:, :O])
                    for r in range(B): mask[r, :cut[r]] = False
                if m[:O, :].all():   # верхнее
                    cut = min_cut_v(d[:O, :].T)
                    for c in range(B): mask[:cut[c], c] &= False
                if m[:, B - O:].all():   # правое (замыкание по кругу)
                    cut = min_cut_v(d[:, B - O:][:, ::-1])
                    for r in range(B): mask[r, B - cut[r]:] = False
                if m[B - O:, :].all():   # нижнее
                    cut = min_cut_v(d[B - O:, :][::-1].T)
                    for c in range(B): mask[B - cut[c]:, c] = False
                mask |= ~m
            # мягкий шов в 2 пикселя
            mk = mask.astype(np.float32)
            k = np.array([1, 2, 3, 2, 1], np.float32); k /= k.sum()
            mk = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 0, mk)
            mk = np.apply_along_axis(lambda v: np.convolve(v, k, 'same'), 1, mk)
            mk = np.where(m, mk, 1.0)[..., None]
            out[iy, ix] = tgt * (1 - mk) + p * mk; filled[iy, ix] = True
    return out

if __name__ == '__main__':
    ref, dst, scale, size = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
    boxes = [tuple(int(v) for v in a.split(',')) for a in sys.argv[5:]]
    srcs = load_sources(ref, boxes, scale)
    B = int(np.clip(min(min(s.shape[:2]) for s in srcs) * 0.6, 40, 110)); O = B // 4
    img = quilt(srcs, size, B, O)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS).save(dst)
    print('WROTE', dst, 'patch', B, 'overlap', O)
