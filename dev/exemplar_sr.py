"""Увеличение игровой текстуры ×k «по образцам» с сохранением принятого вида.

python dev/exemplar_sr.py <малая.png> <выход.png> <образец_×k.png> [<образец_×k.png> ...] [--k 4] [--patch 5] [--stride 2]

Малая текстура (1 тексель на игровую единицу) задаёт крупные формы и цвет. Образцы — настоящие рендеры/фото того же
семейства материалов, уже в k раз подробнее (4 текселя на единицу). Для каждого участка малой текстуры ищется участок
образца с похожей уменьшенной структурой (яркость, нормированная по среднему и разбросу); из образца берётся только
его высокочастотная часть «подробный − сглаженный», масштабированная по контрасту, и накладывается на гладко
увеличенную малую текстуру с мягким перекрытием. Затем обратная проекция: уменьшенный результат в точности равен
исходной малой текстуре, поэтому при обычном масштабе игра выглядит как раньше, а при приближении появляются резкие
края камней, швы и зерно. Без нейросетей, детерминированно; периодичность сохраняется (все сдвиги по кругу).
"""
import argparse
import time

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

Image.MAX_IMAGE_PIXELS = None


def box(a, k):
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, a.shape[2]).mean((1, 3))


def up(a, k):
    """гладкое периодическое увеличение (бикубика по кругу: края плитки тоже согласованы)"""
    h, w, c = a.shape
    pad = 4
    t = np.pad(a, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
    im = [Image.fromarray(t[..., i].astype(np.float32), mode='F').resize(((w + 2 * pad) * k, (h + 2 * pad) * k), Image.Resampling.BICUBIC) for i in range(c)]
    big = np.stack([np.asarray(x, dtype=np.float32) for x in im], -1)
    return big[pad * k:(pad + h) * k, pad * k:(pad + w) * k]


def lum(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


def patches(L, ps, stride, wrap=True):
    """признаки участков ps×ps по яркости: минус среднее, делить на разброс; возвращает признаки, средние, разбросы, координаты"""
    h, w = L.shape
    r = ps // 2
    ys = np.arange(0, h, stride); xs = np.arange(0, w, stride)
    if not wrap:
        ys = ys[(ys >= r) & (ys < h - r)]; xs = xs[(xs >= r) & (xs < w - r)]
    Y, X = np.meshgrid(ys, xs, indexing='ij')
    Y = Y.ravel(); X = X.ravel()
    offs = [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1)]
    F = np.stack([L[(Y + dy) % h, (X + dx) % w] for dy, dx in offs], 1).astype(np.float32)
    mu = F.mean(1, keepdims=True); F -= mu
    sd = np.sqrt((F * F).mean(1, keepdims=True)) + 2.0
    return F / sd, mu[:, 0], sd[:, 0], Y, X


def synth(P, exemplars, k, ps, stride, gain, t0, lum_only=False):
    """один шаг увеличения ×k по образцам (образцы — массивы уже в k раз подробнее P).
    lum_only: переносится только относительная яркость деталей (без цвета образца) — оттенок материала не меняется"""
    feats, where, detail = [], [], []
    for ei, E in enumerate(exemplars):
        E = E[:E.shape[0] // k * k, :E.shape[1] // k * k]
        El = box(E, k)
        if lum_only:
            Lh = lum(E)[..., None]; Ll = lum(up(El, k))[..., None]
            D = np.repeat((Lh - Ll) / np.maximum(Ll, 8.0), 3, axis=2).astype(np.float32)   # относительная деталь
        else:
            D = E - up(El, k)
        F, mu, sd, Y, X = patches(lum(El), ps, 1)
        feats.append(F); where.append(np.stack([np.full_like(Y, ei), Y, X], 1)); detail.append((D, sd, mu))
    F_all = np.concatenate(feats); W_all = np.concatenate(where)
    SD_all = np.concatenate([d[1] for d in detail]); MU_all = np.concatenate([d[2] for d in detail])
    mean = F_all.mean(0); U, S, Vt = np.linalg.svd(F_all[::max(1, len(F_all) // 60000)] - mean, full_matrices=False)
    dims = min(14, Vt.shape[0]); B = Vt[:dims].T
    tree = cKDTree((F_all - mean) @ B)
    Fp, mup, sdp, Yp, Xp = patches(lum(P), ps, stride)
    _, idx = tree.query((Fp - mean) @ B, k=1, workers=-1)
    print('  MATCHED', len(Fp), 'from', len(F_all), round(time.time() - t0, 1), 's', flush=True)
    h, w = P.shape[:2]
    H, Wd = h * k, w * k
    acc = np.zeros((H, Wd, 3), np.float32); wsum = np.zeros((H, Wd), np.float32)
    n = ps * k
    win1 = 0.5 - 0.5 * np.cos(2 * np.pi * (np.arange(n) + 0.5) / n)
    win = (win1[:, None] * win1[None, :]).astype(np.float32) + 1e-3
    ex = W_all[idx]
    scale = ((sdp / np.maximum(mup, 8.0)) / (SD_all[idx] / np.maximum(MU_all[idx], 8.0)) if lum_only else sdp / SD_all[idx]).clip(0.2, 3.0).astype(np.float32) * gain
    r = ps // 2
    for ei, (D, _, __) in enumerate(detail):
        sel = ex[:, 0] == ei
        if not sel.any():
            continue
        ys0 = (Yp[sel] - r) * k; xs0 = (Xp[sel] - r) * k
        ey0 = (ex[sel, 1] - r) * k; exx0 = (ex[sel, 2] - r) * k
        sc = scale[sel]
        hE, wE = D.shape[:2]
        for dy in range(n):
            dyy = (ys0 + dy) % H; eyy = (ey0 + dy) % hE
            for dx in range(n):
                wgt = win[dy, dx]
                dxx = (xs0 + dx) % Wd; exy = (exx0 + dx) % wE
                acc[dyy, dxx] += D[eyy, exy] * (sc[:, None] * wgt)
                wsum[dyy, dxx] += wgt
    base = up(P, k)
    det = acc / np.maximum(wsum, 1e-3)[..., None]
    if lum_only:
        # относительная деталь умножает яркость, масштаб по разбросу уже учтён в относительных единицах
        return np.clip(base * (1 + det), 0, 255)
    return np.clip(base + det, 0, 255)


def backproject(Hi, P, k, iters):
    """уменьшенный результат = исходная малая текстура"""
    for _ in range(iters):
        Hi = np.clip(Hi + up(P - box(Hi, k), k), 0, 255)
    return Hi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('low'); ap.add_argument('out'); ap.add_argument('exemplars', nargs='+')
    ap.add_argument('--k', type=int, default=4); ap.add_argument('--patch', type=int, default=5); ap.add_argument('--stride', type=int, default=2)
    ap.add_argument('--gain', type=float, default=1.0, help='сила переносимых деталей')
    ap.add_argument('--iters', type=int, default=4, help='шаги обратной проекции')
    ap.add_argument('--stages', type=int, default=1, help='2 — два шага ×2 вместо одного ×4 (k=4)')
    ap.add_argument('--lum', action='store_true', help='переносить только яркость деталей (без цвета образцов)')
    a = ap.parse_args()
    k, ps = a.k, a.patch
    t0 = time.time()
    P = np.asarray(Image.open(a.low).convert('RGB'), dtype=np.float32)
    ex = []
    for path in a.exemplars:
        E = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)
        ex.append(E[:E.shape[0] // k * k, :E.shape[1] // k * k])
        print('EXEMPLAR', path, E.shape[1], 'x', E.shape[0], flush=True)
    if a.stages == 2 and k == 4:
        mid_ex = [box(E, 2) for E in ex]
        mid = backproject(synth(P, mid_ex, 2, ps, a.stride, a.gain, t0, a.lum), P, 2, a.iters)
        print('STAGE 1 (x2)', mid.shape[1], 'x', mid.shape[0], round(time.time() - t0, 1), 's', flush=True)
        Hi = synth(mid, ex, 2, ps, a.stride, a.gain, t0, a.lum)
    else:
        Hi = synth(P, ex, k, ps, a.stride, a.gain, t0, a.lum)
    Hi = backproject(Hi, P, k, a.iters)
    err = np.abs(box(Hi, k) - P).mean()
    Image.fromarray(Hi.round().astype(np.uint8)).save(a.out)
    print('DONE', a.out, Hi.shape[1], 'x', Hi.shape[0], 'mean |box(hi) - low| =', round(float(err), 3), round(time.time() - t0, 1), 's', flush=True)


if __name__ == '__main__':
    main()
