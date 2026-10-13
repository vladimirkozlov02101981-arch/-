"""Корка шапки (cap_sand каньона, cap_ash вулкана) из Blender — замечание критика r24: «корка полок — ровная лента».

blender -b --python dev/blender/make_crust.py -- [стиль ...]        стили: sand, ash
Поле высот и цвета (numpy, бесшовно, 4 точки на единицу мира) → рендер блоками (dev/blender/hf_render.py, HF_RESUME=1 —
продолжить после остановки) → python dev/tools/stitch_blocks.py test-results/blocks/<имя> test-results/<имя>_4x.png →
python dev/make_native.py test-results/<имя>_4x.png <имя> --no-match --lossy --quality 90

Как в эталонах dev/reference/canyon.png и volcano.png: верхняя корка уступа — не ровная лента, а сухой наст с трещинами
усыхания (полигоны 20–60 ед.), гравий и камешки разного размера (степенной закон), местами крупные плоские камни, наполовину
утопленные; у пепла вулкана — тёмный пепел с пористыми шлаковыми комками и редкими светлыми чешуйками. Свет — как у остальных
текстур карты (закатный сверху слева).
"""
import importlib.util
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)
spec2 = importlib.util.spec_from_file_location('hf', os.path.join(HERE, 'hf_render.py'))
hf = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(hf)

R = int(os.environ.get('HF_R', '4'))
STYLES = {
    # камни: (радиус от, до, ед.; сколько; высота купола в долях радиуса); cells — средний размер полигонов трещин
    'sand': dict(name='cap_sand', seed=81, T=512, cells=38, crack=(0.55, 0.9),
                 base=(204, 168, 122), base2=(176, 136, 94), dust=(226, 196, 152),
                 stones=[((4, 9), 40, (0.22, 0.38)), ((1.5, 4), 420, (0.28, 0.5)), ((0.5, 1.5), 5200, (0.3, 0.55))],
                 stone_cols=[(150, 98, 64), (168, 120, 84), (124, 92, 70), (186, 146, 108), (110, 74, 52)], light=None),
    'ash': dict(name='cap_ash', seed=91, T=512, cells=46, crack=(0.4, 0.75),
                base=(74, 68, 66), base2=(52, 48, 48), dust=(112, 104, 98),
                stones=[((3, 7), 60, (0.35, 0.6)), ((1.2, 3), 600, (0.35, 0.6)), ((0.4, 1.2), 6000, (0.3, 0.55))],
                stone_cols=[(44, 40, 40), (60, 52, 50), (84, 70, 62), (36, 32, 34), (96, 82, 70)], light=None),
}


def gnoise(shape, s, rng):
    """бесшовный гауссов шум (σ в пикселях), float32"""
    a = rng.standard_normal(size=shape, dtype=np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * s) ** 2 + (fx * s) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def cracks(N, T, cells, seed):
    """трещины усыхания: расстояние до границы ячеек Вороного (бесшовно), ячейки чуть вытянуты и неровны"""
    rng = np.random.default_rng(seed)
    n = max(8, int((T / cells) ** 2))
    pts = rng.uniform(0, T, size=(n, 2)).astype(np.float32)
    # копии точек по краям периода — расстояния бесшовны
    tiles = np.concatenate([pts + np.array([dx, dy], np.float32) * T for dy in (-1, 0, 1) for dx in (-1, 0, 1)])
    out = np.zeros((N, N), np.float32)
    warp_x = gnoise((N, N), 9 * R, rng) * 2.2; warp_y = gnoise((N, N), 9 * R, rng) * 2.2
    for y0 in range(0, N, 128):
        rows = slice(y0, min(N, y0 + 128))
        Y = (np.arange(rows.start, rows.stop, dtype=np.float32)[:, None] + 0.5) / R + warp_y[rows]
        X = (np.arange(N, dtype=np.float32)[None, :] + 0.5) / R + warp_x[rows]
        d1 = np.full(Y.shape, 1e9, np.float32); d2 = np.full(Y.shape, 1e9, np.float32)
        for (px, py) in tiles:
            if px < -cells * 2 or px > T + cells * 2 or py < -cells * 2 or py > T + cells * 2: continue
            d = np.hypot(X - px, Y - py)
            m = d < d1; d2 = np.where(m, d1, np.minimum(d2, d)); d1 = np.where(m, d, d1)
        out[rows] = (d2 - d1) * 0.5   # половина разницы — расстояние до границы ячеек
    return out


def field(st):
    rng = np.random.default_rng(st['seed']); T = st['T']; N = T * R; SH = (N, N)
    # наст: пологие бугры и мелкая шероховатость
    H = gnoise(SH, 10 * R, rng) * 0.9 + gnoise(SH, 2.2 * R, rng) * 0.28 + gnoise(SH, 0.5 * R, rng) * 0.06
    patch = gnoise(SH, 16 * R, rng) * 0.6 + gnoise(SH, 4 * R, rng) * 0.4
    b1 = np.array(st['base'], np.float32); b2 = np.array(st['base2'], np.float32)
    k = np.clip(0.5 + patch * 0.32, 0, 1)[..., None]
    C = b1 * (1 - k) + b2 * k
    C *= (1 + gnoise(SH, 0.35 * R, rng) * 0.06)[..., None]
    # трещины усыхания: тёмные бороздки с приподнятыми краями плиток
    dc = cracks(N, T, st['cells'], st['seed'] + 3)
    w0, w1 = st['crack']
    groove = np.clip(1 - dc / w1, 0, 1) ** 1.6
    H -= groove * 0.9; H += np.clip(1 - np.abs(dc - w1 * 1.6) / w1, 0, 1) * 0.12
    C *= (1 - groove * 0.42)[..., None]
    del dc, groove, patch, k
    # камни и гравий: случайно (без сетки), от крупных к мелким — мелкие не залезают на крупные
    ID = np.zeros(SH, np.int32); cols = np.array(st['stone_cols'], np.float32); nid = 1
    for (rr, count, hk) in st['stones']:
        for _ in range(count):
            r = rng.uniform(*rr); x0, y0 = rng.uniform(0, T), rng.uniform(0, T)
            sx = rng.uniform(0.7, 1.4); ang = rng.uniform(0, math.pi); top = r * rng.uniform(*hk)
            pr = int(r * 1.3 * R) + 2; cx, cy = int(x0 * R), int(y0 * R)
            ys = np.arange(cy - pr, cy + pr + 1); xs = np.arange(cx - pr, cx + pr + 1)
            yy, xx = np.meshgrid((ys + 0.5) / R - y0, (xs + 0.5) / R - x0, indexing='ij')
            ca, sa = math.cos(ang), math.sin(ang)
            u = (xx * ca + yy * sa) / sx; v = (-xx * sa + yy * ca) * sx; d = np.sqrt(u * u + v * v) / r
            h = np.sqrt(np.clip(1 - d * d, 0, 1)) ** rng.uniform(0.4, 0.9) * top
            for _f in range(rng.integers(2, 5)):   # колотые грани
                fa = rng.uniform(0, math.tau)
                h = np.minimum(h, top * (rng.uniform(0.75, 0.95) - rng.uniform(0.2, 0.7) * (u * math.cos(fa) + v * math.sin(fa)) / r))
            h = h - top * rng.uniform(0.1, 0.35)
            sub = np.ix_(ys % N, xs % N); Hs = H[sub]
            hh = Hs[pr, pr] + h                       # камень лежит на насте в своей середине
            take = (d < 1) & (ID[sub] == 0) & (hh > Hs)
            if not take.any(): continue
            Hs[take] = hh[take]; H[sub] = Hs
            ids = ID[sub]; ids[take] = nid; ID[sub] = ids
            tone = cols[rng.integers(0, len(cols))] * rng.uniform(0.85, 1.12)
            cc = C[sub]; shade = (0.9 + 0.18 * (1 - d))[..., None]
            cc[take] = (tone * shade)[take]
            C[sub] = cc; nid += 1
    st_m = ID > 0
    g = gnoise(SH, 0.3 * R, rng)
    C[st_m] *= (1 + g[st_m] * 0.08)[:, None]; H[st_m] += g[st_m] * 0.03
    # пыль на камнях сверху и наносы у их подножия
    dust = np.array(st['dust'], np.float32)
    up = np.clip((H - np.roll(H, R, 0)) * 3, 0, 1)
    C = np.where(st_m[..., None], C * (1 - up[..., None] * 0.35) + dust * up[..., None] * 0.35, C)
    near = np.zeros(SH, np.float32); near[st_m] = 1
    for _ in range(2): near = (near + np.roll(near, R, 0) + np.roll(near, -R, 0) + np.roll(near, R, 1) + np.roll(near, -R, 1)) / 5
    ring = np.clip(near * 2, 0, 1) * (~st_m)
    C *= (1 - ring * 0.18)[..., None]
    return H.astype(np.float32), np.clip(C, 0, 255).astype(np.float32)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(STYLES)):
        st = STYLES[key]; H, C = field(st)
        hf.render_blocks(mt, st['name'], H, C, None, R2=R, up=1, light=st.get('light'), samples=128, rough=0.92, spec=0.18, micro=0.05,
                         hgrain=0.12, cgrain=0.4, speck=0.004, out_dir=os.environ.get('HF_OUT'))
        print('CRUST', st['name'], flush=True)


main()
