"""Поверхность лавы (бесшовная плитка 1024×1024 → assets/tex/lava_surface.png): остывшие плиты корки (тёмные, шероховатые),
между ними — светящиеся трещины расплава (раскалённая сердцевина → оранжевый → тёмный край), местами горячие участки,
где корка тонкая. Ячейки Вороного и шум — периодические, плитка повторяется без шва."""
import numpy as np
from PIL import Image
import os

N, CELLS, SEED = 1024, 26, 7
rng = np.random.default_rng(SEED)


def pnoise(n, freq, seed):
    """периодический шум: сумма синусоид со случайными фазами по целым частотам (плитка без шва)"""
    r = np.random.default_rng(seed); y, x = np.mgrid[0:n, 0:n] / n * 2 * np.pi; out = np.zeros((n, n))
    for _ in range(24):
        kx, ky = r.integers(-freq, freq + 1, 2)
        if kx == 0 and ky == 0: continue
        out += np.sin(kx * x + ky * y + r.uniform(0, 2 * np.pi)) / np.hypot(kx, ky)
    return (out - out.min()) / (out.max() - out.min())


def fbm(n, seed):
    return sum(pnoise(n, f, seed + i) * a for i, (f, a) in enumerate([(3, 0.5), (7, 0.25), (15, 0.15), (31, 0.1)]))


# ячейки Вороного на торе: F1, F2 — расстояния до ближайших центров (с повтором по краям)
pts = rng.uniform(0, N, (CELLS, 2))
y, x = np.mgrid[0:N, 0:N].astype(np.float32)
warp = (fbm(N, 11) - 0.5) * 40 + (pnoise(N, 45, 12) - 0.5) * 7, (fbm(N, 23) - 0.5) * 40 + (pnoise(N, 45, 24) - 0.5) * 7   # рваные края
xw, yw = x + warp[0], y + warp[1]
F1 = np.full((N, N), 1e9, np.float32); F2 = np.full((N, N), 1e9, np.float32)
for px, py in pts:
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            d = np.hypot(xw - px - ox, yw - py - oy)
            F2 = np.where(d < F1, F1, np.minimum(F2, d)); F1 = np.minimum(F1, d)
edge = F2 - F1                                   # 0 на границе плит


def blur_wrap(a, sig):
    f = np.fft.fftfreq(N); g = np.exp(-2 * (np.pi * sig) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def cells(n, seed):
    p = np.random.default_rng(seed).uniform(0, N, (n, 2)); a = np.full((N, N), 1e9, np.float32); b = a.copy()
    for px, py in p:
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d = np.hypot(xw - px - ox, yw - py - oy); b = np.where(d < a, a, np.minimum(b, d)); a = np.minimum(a, d)
    return b - a


grain = blur_wrap(rng.standard_normal((N, N)), 1.1); grain = (grain - grain.mean()) / grain.std()
sub = np.exp(-(cells(110, 5) / 1.4) ** 2) * 0.4 * np.clip(edge / 30, 0, 1)            # мелкие трещины внутри плит
crack = np.exp(-(edge / (3.2 + 4 * fbm(N, 41))) ** 2)          # ширина трещины меняется вдоль неё
halo = np.exp(-(edge / 22) ** 2) * 0.35
hot = np.clip((fbm(N, 57) - 0.62) * 4, 0, 1) * (1 - np.clip(F1 / 60, 0, 1) * 0.5)   # тонкая корка — светится сама
rough = np.clip(fbm(N, 77) * 0.6 + pnoise(N, 63, 91) * 0.2 + grain * 0.12 + 0.1, 0, 1.2)
crust = np.stack([38 + 34 * rough, 22 + 18 * rough, 18 + 12 * rough], -1)          # остывшая базальтовая корка
glowv = np.clip(crack + halo * (0.8 + 0.4 * fbm(N, 99)) + hot * 0.7 + sub, 0, 1.4)
ramp = lambda v: np.stack([np.interp(v, [0, 0.25, 0.6, 1.0, 1.4], c) for c in ([0, 150, 245, 255, 255], [0, 30, 110, 210, 245], [0, 5, 20, 90, 170])], -1)
col = crust * (1 - np.clip(glowv * 1.6, 0, 1))[..., None] + ramp(glowv)
img = np.clip(col, 0, 255).astype(np.uint8)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'tex', 'lava_surface.png')
Image.fromarray(img, 'RGB').save(out); print('saved', out, img.shape, 'glow share', round(float((glowv > 0.3).mean()), 3))
