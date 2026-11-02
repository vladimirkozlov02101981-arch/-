"""Прореживает валуны в грунте (критик r36, долина: «валунов 11,5 % — почти вдвое больше эталона; ряд одинаковых "шатров"»:
сшивка из эталона брала один и тот же лоскут с валуном много раз, в том числе зеркально).

python dev/tools/thin_boulders.py <родная.webp> <выход.png> [--keep 0.55] [--seed 3]
затем: python dev/make_native.py <выход.png> <имя> --no-match --lossy --quality 90   (малая — точное уменьшение родной)

1) валуны — серые (ненасыщенные) пятна на малой копии (÷4): сглаженные насыщенность < --S и яркость > --L, компоненты от
   --min px (мелкая галька меньше — остаётся);
2) повторы: отпечаток каждого валуна — яркость рамки 12×12 (и зеркальная); похожие (косинус > --sim, размер ±20 %) — одна
   группа, из группы остаётся один валун;
3) затем убираются случайные валуны, пока их площадь не станет --keep от исходной;
4) место убранного валуна (с тенью — маска расширена) заполняется грунтом без валунов из соседнего места (сдвиг подбирается,
   с заворотом — текстура бесшовна), края мягкие. Работа на родной ×4, чтобы при приближении всё было чётко.
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage as nd

Image.MAX_IMAGE_PIXELS = None


def box(a, k):
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, -1).mean((1, 3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--keep', type=float, default=0.55); ap.add_argument('--seed', type=int, default=3)
    ap.add_argument('--L', type=float, default=50); ap.add_argument('--S', type=float, default=0.24)
    ap.add_argument('--min', type=int, default=150); ap.add_argument('--sim', type=float, default=0.9)
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    N = np.asarray(Image.open(a.src).convert('RGB'), dtype=np.float32); K = 4
    S = box(N, K)                                                          # малая копия для поиска валунов
    L = S @ np.array([0.299, 0.587, 0.114], np.float32)
    sat = (S.max(2) - S.min(2)) / np.maximum(S.max(2), 1)
    m = (nd.gaussian_filter(L, 2.5, mode='wrap') > a.L) & (nd.gaussian_filter(sat, 2.5, mode='wrap') < a.S)
    m = nd.binary_opening(nd.binary_closing(m, iterations=3), iterations=2)
    lab, n = nd.label(m)
    sl = nd.find_objects(lab); area = nd.sum(m, lab, range(1, n + 1))
    ids = [i for i in range(n) if area[i] >= a.min]
    total = float(sum(area[i] for i in ids))
    print('boulders: %d, area %.3f of texture' % (len(ids), total / m.size))
    # отпечатки
    F = []; Fm = []; HW = []
    for i in ids:
        ys, xs = sl[i]; crop = L[ys, xs]
        im = np.asarray(Image.fromarray(crop.astype(np.float32)).resize((12, 12), Image.BILINEAR), np.float32)
        v = im.ravel() - im.mean(); v /= np.linalg.norm(v) + 1e-6
        vm = im[:, ::-1].ravel() - im.mean(); vm /= np.linalg.norm(vm) + 1e-6
        F.append(v); Fm.append(vm); HW.append((ys.stop - ys.start, xs.stop - xs.start))
    F = np.array(F); Fm = np.array(Fm); HW = np.array(HW, np.float32)
    sim = np.maximum(F @ F.T, F @ Fm.T)
    size_ok = (np.abs(HW[:, None, 0] - HW[None, :, 0]) <= 0.2 * HW[:, None, 0] + 1) & (np.abs(HW[:, None, 1] - HW[None, :, 1]) <= 0.2 * HW[:, None, 1] + 1)
    dup = (sim > a.sim) & size_ok; np.fill_diagonal(dup, False)
    parent = list(range(len(ids)))
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for p, q in zip(*np.nonzero(dup)):
        rp, rq = find(p), find(q)
        if rp != rq: parent[rp] = rq
    groups = {}
    for j in range(len(ids)): groups.setdefault(find(j), []).append(j)
    remove = set()
    for g in groups.values():
        if len(g) > 1:
            keep1 = g[rng.integers(len(g))]; remove.update(j for j in g if j != keep1)
    print('duplicate groups: %d, duplicates removed: %d' % (sum(1 for g in groups.values() if len(g) > 1), len(remove)))
    left = total - sum(area[ids[j]] for j in remove)
    order = [j for j in rng.permutation(len(ids)) if j not in remove]
    for j in order:
        if left <= a.keep * total: break
        remove.add(j); left -= area[ids[j]]
    print('removed %d of %d, boulder area %.3f → %.3f' % (len(remove), len(ids), total / m.size, left / m.size))
    # заполнение грунтом
    busy = nd.binary_dilation(m, iterations=5)                              # валуны с тенью и кромкой — не источник
    out = N.copy(); H, W = L.shape; done = 0
    for j in remove:
        i = ids[j]; ys, xs = sl[i]
        y0, y1, x0, x1 = ys.start - 12, ys.stop + 12, xs.start - 12, xs.stop + 12
        yy = np.arange(y0, y1) % H; xx = np.arange(x0, x1) % W
        comp = lab[np.ix_(yy, xx)] == i + 1
        tgt = nd.binary_dilation(comp, iterations=4) | (nd.binary_dilation(comp, iterations=9) & (L[np.ix_(yy, xx)] > 100))   # тень и светлый гребень «шатра»
        tgt = nd.binary_dilation(tgt, iterations=1)
        best, bf = None, 1.0                                               # источник — где меньше всего валунов (по всей текстуре)
        for _ in range(3000):
            dy, dx = rng.integers(0, H), rng.integers(0, W)
            if min(dy, H - dy) < (y1 - y0) and min(dx, W - dx) < (x1 - x0): continue
            f = busy[np.ix_((yy + dy) % H, (xx + dx) % W)].mean()
            if f < bf: best, bf = (dy, dx), f
            if f == 0: break
        if best is None or bf > 0.08: continue
        dy, dx = best
        alpha = nd.gaussian_filter(np.kron(tgt.astype(np.float32), np.ones((K, K), np.float32)), 5)
        alpha = np.clip(alpha * 1.6, 0, 1)[..., None]
        Y = (np.arange(y0 * K, y1 * K)) % (H * K); X = (np.arange(x0 * K, x1 * K)) % (W * K)
        Ys = (Y + dy * K) % (H * K); Xs = (X + dx * K) % (W * K)
        out[np.ix_(Y, X)] = out[np.ix_(Y, X)] * (1 - alpha) + out[np.ix_(Ys, Xs)] * alpha
        sub = busy[np.ix_(yy, xx)]; sub[tgt] = False; busy[np.ix_(yy, xx)] = sub   # убранное место — уже грунт, годится в источник
        done += 1
    print('filled %d' % done)
    S2 = box(out, K); L2 = S2 @ np.array([0.299, 0.587, 0.114], np.float32); sat2 = (S2.max(2) - S2.min(2)) / np.maximum(S2.max(2), 1)
    m2 = (nd.gaussian_filter(L2, 2.5, mode='wrap') > a.L) & (nd.gaussian_filter(sat2, 2.5, mode='wrap') < a.S)
    print('boulder fraction (classifier) %.3f → %.3f' % (m.mean(), m2.mean()))
    Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8)).save(a.out)


if __name__ == '__main__':
    main()
