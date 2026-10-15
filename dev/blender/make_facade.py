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
    lit = rw[ri, ci] < 0.55
    frame = win & ((lx < 0.05) | (lx > 0.95) | (ly < 0.04) | (ly > 0.96) | (np.abs(lx - 0.5) < 0.025) | (np.abs(ly - 0.38) < 0.02))
    glass = win & ~frame
    sky = np.stack([18 + 30 * (1 - ly), 22 + 34 * (1 - ly), 40 + 50 * (1 - ly)], -1).astype(np.float32)
    diag = ((lx * 1.3 + ly + hue[ri, ci]) % 1.0) < 0.07
    sky = np.where(diag[..., None], sky + 40, sky)
    warm = np.where((hue[ri, ci] < 0.6)[..., None], np.array([255, 196, 120], np.float32), np.array([200, 222, 255], np.float32))
    inter = warm * (0.7 + 0.35 * ly)[..., None]
    cs_ = np.where(curt[ri, ci] > 0.5, lx < 0.12 + curt[ri, ci] * 0.25, lx > 0.88 - curt[ri, ci] * 0.25)
    inter = np.where(cs_[..., None], inter * 0.6, inter)
    furn = (ly > 0.72) & (np.abs(lx - 0.25 - curt[ri, ci] * 0.5) < 0.11)
    inter = np.where(furn[..., None], inter * 0.3, inter)
    C = np.where((glass & ~lit)[..., None], sky, C); C = np.where((glass & lit)[..., None], inter, C)
    C = np.where(frame[..., None], np.array([46, 46, 50], np.float32), C)
    H = np.where(glass, -3.0, np.where(frame, -1.6, H))
    sill = inx & (fy >= wy0 + wh) & (fy < wy0 + wh + 1.6)
    H = np.where(sill, H + 1.2, H); C = np.where(sill[..., None], np.array([120, 120, 124], np.float32), C)
    # кондиционер под частью окон, водосток у края плитки
    ac = (hue[ri, ci] > 0.72) & (fx >= wx0 + ww * 0.45) & (fx < wx0 + ww * 0.95) & (fy >= wy0 + wh + 2.2) & (fy < wy0 + wh + 8.5)
    H = np.where(ac, H + 3.0, H); C = np.where(ac[..., None], np.array([150, 152, 156], np.float32) * (0.92 + 0.08 * ((xx * 4 % 2) > 1))[..., None], C)
    pipe = np.abs(xx - (TW - 3)) < 1.1
    H = np.where(pipe, H + 1.1 * np.sqrt(np.clip(1 - ((xx - (TW - 3)) / 1.1) ** 2, 0, 1)), H); C = np.where(pipe[..., None], np.array([62, 64, 70], np.float32), C)
    E = np.where((glass & lit)[..., None], inter / 255.0 * 0.9, 0).astype(np.float32)
    return H.astype(np.float32), np.clip(C, 0, 255), E


def main():
    H, C, E = field()
    hf.render_blocks(mt, 'facade_city', H, C, E, R2=R, up=1, block=640, light=dict(col=(0.62, 0.7, 1.0), elev=35, energy=1.6), samples=128,
                     rough=0.85, spec=0.2, emit=1.2, hgrain=0.1, cgrain=0.3, speck=0.004)
    print('FACADE facade_city', flush=True)


main()
