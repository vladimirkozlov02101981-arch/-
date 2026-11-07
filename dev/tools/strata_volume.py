"""Объём пластов песчаника каньона (критик r37: «пласты без объёма — средние частоты 7,2 при 10,6 у эталона; верхняя треть
пласта светлее на ~18 L; линии напластования вдвое чаще — период ~90 px кадра против ~45 у эталона»).

python dev/tools/strata_volume.py <родная.webp> <выход.png> [--top 0.16] [--bottom 0.12] [--mid 0.42] [--split 1.0] [--joints 0.6] [--lipk 1.1]
(питоном с bpy; исходник — родная до v119: git show 5b79e66^:assets/tex/native/rock_canyon.webp)
затем: python dev/make_native.py <выход.png> rock_canyon --no-match --lossy --quality 90   (и та же картинка — dirt_canyon)

Карта пластов — из генератора (make_masonry.py field с '_rowmap', как dev/tools/canyon_strata.py): номер ряда и доля
высоты v в ряду, поэтому всё ложится ровно по швам отрендеренной текстуры (поиск швов по яркости давал пятна и полосы).
Верх пласта светлее (top, до v 0,35), низ темнее (bottom, с v 0,72); посередине каждого пласта — вторичная линия
напластования (mid): тёмная бороздка ~1,2 ед. со светлой кромкой под ней (свет сверху), высота линии у каждого пласта своя
(v 0,4–0,6) и плавно гуляет, местами прерывается.
v123 (критик r38: «ряды 80–100 px → 55–65 px; вертикальные стыки через 100–200 px, 1–2 px, ΔL −40, чтобы ряды делились на
плиты»): split — доля пластов, где вторичная линия становится сплошным швом, а у каждой половины свой светлый верх и тёмный
низ (ряд делится на два); joints — вертикальные стыки в каждом ряду (и в каждой половине) с шагом jmin–jmax px родной,
вразбежку между рядами: впадина 7–11 px родной (глубже к середине; в кадре 1,5–3 px) со светлой фаской слева, слегка волнистая.
"""
import argparse
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = Path(__file__).resolve().parent.parent.parent
Image.MAX_IMAGE_PIXELS = None


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--top', type=float, default=0.16); ap.add_argument('--bottom', type=float, default=0.12)
    ap.add_argument('--mid', type=float, default=0.42); ap.add_argument('--seed', type=int, default=21)
    ap.add_argument('--split', type=float, default=0.0); ap.add_argument('--joints', type=float, default=0.0); ap.add_argument('--lipk', type=float, default=0.45)
    ap.add_argument('--jmin', type=float, default=400); ap.add_argument('--jmax', type=float, default=800)
    a = ap.parse_args()
    spec = importlib.util.spec_from_file_location('cs', ROOT / 'dev/tools/canyon_strata.py')
    cs = importlib.util.module_from_spec(spec); spec.loader.exec_module(cs)
    row, v = cs.rowmap()
    img = np.asarray(Image.open(a.src).convert('RGB'), dtype=np.float32)
    assert row.shape == img.shape[:2], (row.shape, img.shape)
    H, W = row.shape; n = int(row.max()) + 1; rng = np.random.default_rng(a.seed)
    # высота пласта в пикселях: медиана по столбцам «сколько пикселей ряда в столбце» — для толщины линии в единицах мира
    hpx = np.ones(n, np.float32)
    for r in range(n):
        cnt = (row == r).sum(0)
        if (cnt > 0).any(): hpx[r] = np.median(cnt[cnt > 0])
    midr = rng.uniform(0.4, 0.6, n).astype(np.float32); mid = midr[row]
    wob = nd.gaussian_filter1d(rng.standard_normal(W).astype(np.float32), 90, mode='wrap'); wob *= 0.06 / (np.abs(wob).max() + 1e-9)
    brk = nd.gaussian_filter1d(rng.standard_normal(W).astype(np.float32), 40, mode='wrap'); brk = smooth(-0.6, -0.2, brk / (brk.std() + 1e-9))
    rs = np.random.default_rng(a.seed + 100)
    spl = (rs.random(n) < a.split) & (hpx > 160)                               # v123: пласты, разделённые на два ряда
    vs = v - wob[None, :]                                                     # граница половин идёт по той же волнистой линии
    sub = spl[row] & (vs >= mid)                                              # нижняя половина разделённого пласта
    vv = np.where(spl[row], np.where(sub, (vs - mid) / np.maximum(1 - mid, 0.05), vs / np.maximum(mid, 0.05)), v)
    vv = np.clip(vv, 0, 1)
    f = 1 + a.top * (1 - smooth(0.0, 0.35, vv)) - a.bottom * smooth(0.72, 1.0, vv)
    dm = (v - mid - wob[None, :]) * hpx[row]                                  # расстояние до линии, px родной (4 на ед.)
    sr = spl[row]
    gw = np.where(sr, 6.5, 2.6); go = np.where(sr, 3.0, 1.2)                  # у разделённых — шов шире (v129: ~3 ед. — в кадре 2–3 px) и глубже
    line = np.clip(1 - np.abs(dm + go) / gw, 0, 1) ** 1.5                     # тёмная бороздка ~1,2 ед.
    lip = np.clip(1 - np.abs(dm - np.where(sr, 5.0, 2.6)) / np.where(sr, 3.0, 1.4), 0, 1)   # светлая кромка под ней
    bk = np.where(sr, 1.0, brk[None, :]); mk = np.where(sr, 1.75, 1.0)          # у разделённых — сплошной шов
    f = f * (1 - a.mid * mk * line * bk) * (1 + a.mid * np.where(sr, a.lipk, 0.45) * mk * lip * bk)
    warm = (sr * lip * bk).astype(np.float32)                                  # v129 (критик r39: «под щелью тёплая кромка L 150–170, R/B ≈ 2»)
    if a.joints > 0:   # v123: вертикальные стыки плит — в каждом ряду и в каждой половине свои, вразбежку
        seg = row * 2 + sub.astype(np.int64)
        rj = np.random.default_rng(a.seed + 200); nj = 0
        cols = np.arange(W)
        for sg in np.unique(seg):
            m = seg == sg
            ys = np.nonzero(m.any(1))[0]
            if len(ys) < 24: continue
            x = rj.uniform(0, a.jmax)
            while x < W:
                # излом: наклон до ±0,35, случайное блуждание и пара резких сдвигов по высоте ряда; ширина меняется по длине
                hw0 = rj.uniform(3.5, 5.5); sl = rj.uniform(-0.35, 0.35)
                st = rj.normal(0, 0.45, H); st[rj.integers(0, H, 3)] += rj.normal(0, 3.0, 3)
                xs = x + np.cumsum(st) + sl * (np.arange(H) - ys[0])
                hwv = hw0 * np.clip(1 + 0.35 * nd.gaussian_filter1d(rj.standard_normal(H), 6), 0.45, 1.6)
                for y in ys:
                    cx = xs[y]; hw = hwv[y]; x0 = int(np.floor(cx - hw - 4)); xx = np.arange(x0, x0 + int(2 * hw + 9)); xw = xx % W
                    mm = m[y, xw]
                    if not mm.any(): continue
                    d = xx - cx; q = np.clip(1 - np.abs(d) / hw, 0, 1); q = q * q * (3 - 2 * q)
                    lipj = ((d < -hw) & (d > -hw - 3)).astype(np.float32)
                    f[y, xw] = np.where(mm, f[y, xw] * (1 - a.joints * q) * (1 + 0.16 * lipj), f[y, xw])
                nj += 1; x += rj.uniform(a.jmin, a.jmax)
        print('joints %d' % nj)
    out = img * f[..., None]
    out += (np.array([216, 170, 118], np.float32) - out) * (0.45 * warm)[..., None]   # кромка — к светлой кремовой (R/B ≈ 1,8), а не к рыжей
    out = np.clip(out, 0, 255)
    Y = np.array([0.299, 0.587, 0.114], np.float32); L0 = img @ Y; L1 = out @ Y
    print('strata_volume rows %d (split %d, медиана высоты %.0f px родной), mean L %.1f → %.1f, L95 %.0f → %.0f' % (
        n, int(spl.sum()), float(np.median(hpx)), L0.mean(), L1.mean(), np.percentile(L0, 95), np.percentile(L1, 95)))
    Image.fromarray(out.round().astype(np.uint8)).save(a.out)


if __name__ == '__main__':
    main()
