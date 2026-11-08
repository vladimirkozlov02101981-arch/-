"""Ночной фасад многоэтажки для города — блочный рендер в настоящем ×4 (hf_render.render_blocks), бесшовная плитка
160×320 ед. (5 окон × 8 этажей, ячейка окна 32×40 ед. — по ней игра гасит и меняет свет окон, terrain_visual.js).

Бетонные панели с потёками и пятнами, выступающие межэтажные пояса, утопленные окна с откосами, рамой, переплётом и
подоконником, кондиционеры под частью окон, водосток. Горящие окна — тёплый/холодный свет комнаты со шторой и силуэтом
мебели (излучение), тёмные — стекло с отражением неба и бликом.

blender -b --python dev/blender/make_facade.py
затем: python dev/tools/stitch_blocks.py test-results/blocks/facade_city <x4.png>; python dev/make_native.py <x4.png> facade_city --no-match --lossy
"""
import importlib.util
import math
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
spec2 = importlib.util.spec_from_file_location('hf', os.path.join(HERE, 'hf_render.py'))
hf = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(hf)

R = 4                      # пикселей на единицу мира (родная ×4)
TW, TH, CW, RH = 160, 320, 32, 40


def gnoise(shape, sy, sx, rng):
    a = rng.standard_normal(size=shape).astype(np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * sy) ** 2 + (fx * sx) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def field(seed=161):
    rng = np.random.default_rng(seed); NY, NX = TH * R, TW * R; SH = (NY, NX)
    yy, xx = (np.mgrid[0:NY, 0:NX].astype(np.float32) + 0.5) / R
    ci = (xx // CW).astype(int); ri = (yy // RH).astype(int); fx = xx % CW; fy = yy % RH
    # стена: бетон с зерном, пятнами и вертикальными потёками
    mott = gnoise(SH, 6 * R, 6 * R, rng) * 0.6 + gnoise(SH, 18 * R, 18 * R, rng) * 0.4
    grain = gnoise(SH, 0.5 * R, 0.5 * R, rng); streak = gnoise(SH, 30 * R, 1.2 * R, rng)
    base = np.array([74, 74, 80], np.float32)
    C = base * (1 + 0.1 * mott + 0.05 * grain)[..., None]
    C = C * (1 - np.clip(streak - 0.6, 0, 1) * 0.25)[..., None]
    H = 0.25 * gnoise(SH, 1.5 * R, 1.5 * R, rng) + 0.08 * grain
    # стыки панелей и межэтажный пояс (выступает, светлее сверху, тень снизу)
    seam = (np.abs(fx - 0.5) < 0.35) & (ri % 2 == 0)
    H = np.where(seam, H - 0.8, H); C = np.where(seam[..., None], C * 0.6, C)
    band = fy < 3.2
    H = np.where(band, H + 1.6, H); C = np.where(band[..., None], C * np.where(fy < 1.0, 1.25, 0.95)[..., None], C)
    # окно: 18×24, утоплено на 3 ед.; рама, переплёт, подоконник
    wx0, wy0, ww, wh = 7.0, 8.5, 18.0, 22.5
    inx = (fx >= wx0) & (fx < wx0 + ww); iny = (fy >= wy0) & (fy < wy0 + wh); win = inx & iny
    lx = (fx - wx0) / ww; ly = (fy - wy0) / wh
    rw = rng.random((TH // RH + 1, TW // CW + 1)); hue = rng.random(rw.shape); curt = rng.random(rw.shape)
    gl = rng.random(rw.shape); slope = 0.8 + rng.random(rw.shape) * 1.2   # v117: блик неба — только у 20 % тёмных окон, наклон свой
    lit = rw[ri, ci] < 0.55
    frame = win & ((lx < 0.06) | (lx > 0.94) | (ly < 0.05) | (ly > 0.95) | (np.abs(lx - 0.5) < 0.045) | (np.abs(ly - 0.38) < 0.035))   # v135 (критик r40: «переплёты 2–3 px»): рама и переплёт толще
    glass = win & ~frame
    sky = np.stack([27 + 45 * (1 - ly), 33 + 48 * (1 - ly), 55 + 60 * (1 - ly)], -1).astype(np.float32)   # v127 (критик r39: «тёмные стёкла (15,18,30) → (31,34,47) с градиентом отражения»)
    diag = (gl[ri, ci] < 0.2) & (((lx * slope[ri, ci] + ly + hue[ri, ci]) % 1.0) < 0.06)
    sky = np.where(diag[..., None], sky + 40, sky)
    warm = np.where((hue[ri, ci] < 0.6)[..., None], np.array([255, 196, 120], np.float32), np.array([200, 222, 255], np.float32))
    inter = warm * (0.52 + 0.42 * ly)[..., None]   # v117 (критик r37: окна L 176–194 при 168 у эталона; верх окна темнее)
    cs_ = np.where(curt[ri, ci] > 0.5, lx < 0.12 + curt[ri, ci] * 0.25, lx > 0.88 - curt[ri, ci] * 0.25)
    inter = np.where(cs_[..., None], inter * 0.6, inter)
    furn = (ly > 0.72) & (np.abs(lx - 0.25 - curt[ri, ci] * 0.5) < 0.11)
    inter = np.where(furn[..., None], inter * 0.3, inter)
    # v135 (критик r40: «светлой площади окон 7 % при 4–4,3 % у эталона; 30–40 % площади горящего окна — силуэты интерьера: шторы,
    # растения, люди, L 60–120»): у каждого горящего окна свой набор — вторая штора, жалюзи, силуэт человека или растения, абажур
    kind = rng.random(rw.shape)[ri, ci]; kx = rng.random(rw.shape)[ri, ci]
    cs2 = (kind < 0.35) & np.where(curt[ri, ci] > 0.5, lx > 0.8 - kx * 0.15, lx < 0.2 + kx * 0.15)          # вторая штора с другой стороны
    blinds = (kind >= 0.35) & (kind < 0.55) & ((ly * 14 % 1.0) < 0.42) & (ly < 0.35 + kx * 0.4)            # жалюзи сверху, опущены не до конца
    pcx = 0.3 + kx * 0.4; pr = (lx - pcx) / 0.12; pq = (ly - 0.55) / 0.2
    person = (kind >= 0.55) & (kind < 0.8) & (((pr * pr + ((ly - 0.47) / 0.09) ** 2) < 1) | ((np.abs(pr) < 1.3 + 0.6 * np.clip(pq, 0, 1)) & (ly > 0.55)))   # голова и плечи
    plant = (kind >= 0.8) & (((lx - pcx) ** 2 / 0.02 + (ly - 0.66) ** 2 / 0.03) < 1) & (ly > 0.5)             # куст в горшке на подоконнике
    inter = np.where(cs2[..., None], inter * 0.55, inter)
    inter = np.where(blinds[..., None], inter * 0.45, inter)
    inter = np.where((person | plant)[..., None], inter * 0.22, inter)
    C = np.where((glass & ~lit)[..., None], sky, C); C = np.where((glass & lit)[..., None], inter, C)
    C = np.where(frame[..., None], np.array([46, 46, 50], np.float32), C)
    H = np.where(glass, -3.0, np.where(frame, -1.6, H))
    sill = inx & (fy >= wy0 + wh) & (fy < wy0 + wh + 1.6)
    H = np.where(sill, H + 1.2, H); C = np.where(sill[..., None], np.array([120, 120, 124], np.float32), C)
    C = np.where((sill & (fy < wy0 + wh + 0.5))[..., None], np.array([178, 180, 186], np.float32), C)   # v127 (критик r39): мокрый блик по кромке подоконника
    # кондиционер под частью окон, водосток у края плитки
    # v117 (критик r37: «кондиционеры — светлые наклейки L 150 под каждым вторым окном»): у 15 % окон.
    # v122 (критик r38: «кондиционеры невидимы — тёмное на тёмном»): светлый корпус шириной с окно со светлой верхней кромкой
    # (на экране p95 ~105), горизонтальная решётка слева, тёмный круг вентилятора с лопастями справа (L 15–20), тень снизу —
    # от рельефа (корпус выступает на 3,2 ед.)
    a0, a1, b0, b1 = wx0 + 0.6, wx0 + ww - 0.6, wy0 + wh + 2.0, wy0 + wh + 8.6
    # v127 (критик r39: «кондиционеры рядами по 4–6 под окнами одного этажа — нужно не больше одного на 3 окна, вразнобой, с подтёком»):
    # в каждом ряду плитки (5 окон) — не больше одного, в 60 % рядов, столбец свой
    nrow, ncol = rw.shape; acc = np.zeros((nrow, ncol), bool); ra = np.random.default_rng(seed + 7)
    for rr_ in range(nrow):
        if ra.random() < 0.6: acc[rr_, int(ra.integers(0, TW // CW))] = True
    ac = acc[ri, ci] & (fx >= a0) & (fx < a1) & (fy >= b0) & (fy < b1)
    acx = (fx - (a1 - 4.6)) / 3.0; acy = (fy - (b0 + b1) / 2) / 3.0; rr = acx * acx + acy * acy; fan = rr < 1
    blade = ((np.arctan2(acy, acx) + 0.9 * np.sqrt(rr)) * 5 / (2 * math.pi)) % 1.0 < 0.38
    slat = 0.82 + 0.18 * (((fy - b0) * 2.2 % 1.0) > 0.45)
    body = np.array([150, 149, 145], np.float32) * slat[..., None]
    body = np.where(((fy - b0) < 0.8)[..., None], np.array([206, 205, 200], np.float32), body)
    body = np.where((((b1 - fy) < 0.6) | ((fx - a0) < 0.5))[..., None], body * 0.6, body)
    fanc = np.where(blade, 46.0, 26.0)[..., None] * np.array([1, 1, 1.05], np.float32)
    fanc = np.where((rr > 0.86)[..., None], np.array([110, 110, 108], np.float32), fanc)
    fanc = np.where((rr < 0.06)[..., None], np.array([90, 90, 90], np.float32), fanc)
    C = np.where(ac[..., None], np.where(fan[..., None], fanc, body), C)
    H = np.where(ac, H + np.where(fan, 2.2, 3.2), H)
    drip = acc[(ri - 1) % (TH // RH), ci] & (np.abs(fx - (a0 + 3.0)) < 0.55 + 0.25 * np.sin(fy * 1.7)) & (fy < 9.5)   # подтёк под блоком (в начале следующей ячейки)
    C = np.where(drip[..., None], C * np.array([0.62, 0.6, 0.6], np.float32) * (0.75 + 0.25 * (fy / 9.5))[..., None], C)
    pipe = np.abs(xx - (TW - 3)) < 1.1
    H = np.where(pipe, H + 1.1 * np.sqrt(np.clip(1 - ((xx - (TW - 3)) / 1.1) ** 2, 0, 1)), H); C = np.where(pipe[..., None], np.array([62, 64, 70], np.float32), C)
    # v120 (критик r37: «сетка одинаковых окон — 2–4 элемента на этаж: решётки, водостоки, кабели, балконы»):
    vr = rng.random(rw.shape)[ri, ci]                                          # своё случайное число у каждого окна
    bars = (vr < 0.12) & glass & ((np.abs(((fx - wx0) % 3.0) - 1.5) < 0.35))           # решётка на 12 % окон: прутья через 3 ед.
    C = np.where(bars[..., None], np.array([34, 33, 32], np.float32), C); H = np.where(bars, H + 2.2, H)
    E = np.where((glass & lit & ~bars)[..., None], inter / 255.0 * 0.9, 0).astype(np.float32)
    bal = (vr > 0.9) & inx & (fy >= wy0 + wh - 1.0) & (fy < wy0 + wh + 1.8)          # балкон на 10 % окон: плита и перила
    rail = (vr > 0.9) & (fx >= wx0 - 1.5) & (fx < wx0 + ww + 1.5) & (fy >= wy0 + wh - 7.0) & (fy < wy0 + wh - 1.0) & ((((fx - wx0) % 2.2) < 0.45) | (fy < wy0 + wh - 6.3))   # ниже точки пробы окна (11, 23) — игра различает горящие окна
    C = np.where(bal[..., None], np.array([92, 90, 88], np.float32), C); H = np.where(bal, H + 4.0, H)
    C = np.where(rail[..., None], np.array([40, 40, 42], np.float32), C); H = np.where(rail, H + 4.5, H); E = np.where(rail[..., None], 0, E)
    rust = (rng.random(rw.shape) < 0.35)[ri, ci] & (np.abs(fx - (wx0 + ww * (0.3 + 0.4 * hue[ri, ci]))) < 1.2 + 0.6 * np.sin(fy * 0.7)) & (fy >= wy0 + wh + 1.6) & (fy < wy0 + wh + 12)
    C = np.where(rust[..., None], C * np.array([0.78, 0.7, 0.62], np.float32) * (0.85 + 0.15 * np.clip((fy - wy0 - wh) / 12, 0, 1))[..., None], C)   # потёки ржавчины под подоконником
    for k in range(2):                                                         # провисшие кабели поперёк плитки
        y0 = rng.uniform(20, TH - 20); sag = rng.uniform(3, 7)
        cy = y0 + sag * 4 * (xx / TW) * (1 - xx / TW)
        cab = np.abs(yy - cy) < 0.45
        C = np.where(cab[..., None], np.array([18, 18, 20], np.float32), C); H = np.where(cab, H + 2.8, H); E = np.where(cab[..., None], 0, E)
    return H.astype(np.float32), np.clip(C, 0, 255), E


def main():
    H, C, E = field()
    hf.render_blocks(mt, 'facade_city', H, C, E, R2=R, up=1, block=640, light=dict(col=(0.62, 0.7, 1.0), elev=35, energy=1.6), samples=128,
                     rough=0.85, spec=0.2, emit=1.2, hgrain=0.1, cgrain=0.3, speck=0.004)
    print('FACADE facade_city', flush=True)


main()
