"""Фотореалистичная тёсаная кладка по эталонам (мост долины valley_house.png, замки castles.png).

Карта высот и цвета считается в numpy (бесшовно, только numpy — в Blender нет scipy): ряды 16–21 ед., камни разной длины,
шов 2–3 ед. утоплен, у камней фаска 2 ед., бугристая «колотая» лицевая сторона, раковины, сколы углов; цвет — гранит
с крапом, лишайник пятнами на части камней, тёмные потёки, мох в некоторых швах. Blender (Cycles) рендерит это как
настоящий рельеф (≈1,3 млн вершин): тени в швах, объём фасок, шероховатость. Поле с запасом по краям (заворот) —
тени у краёв плитки правильные, текстура бесшовная.

blender -b --python dev/blender/make_masonry.py -- <стиль> [...]     стили: valley, castle
Пишет test-results/<имя>_2x.png (1 ед. мира = 2 px); затем: python dev/make_detail.py test-results/<имя>_2x.png <имя>
"""
import importlib.util
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

R = 2                                   # пикселей рендера на единицу мира (двойное разрешение)
STYLES = {
    # мост-акведук и руины долины: светлый серый гранит, крупные камни, лишайник
    'valley': dict(name='stone_valley', seed=11, T=512, hr=(16, 21), wr=(26, 54), joint=2.8, bev=2.2, recess=2.6,
                   stone=[(176, 174, 166), (160, 158, 151), (190, 186, 175), (146, 143, 136), (168, 162, 150)],
                   mortar=(96, 92, 85), lichen=0.2, moss=0.24, light=None),
    # замки на закате: тёплый песчаник-известняк, камни мельче, швы тоньше
    'castle': dict(name='stone_castle', seed=23, T=512, hr=(14, 18), wr=(24, 46), joint=2.0, bev=1.8, recess=1.5,
                   stone=[(188, 172, 150), (172, 158, 138), (200, 186, 162), (160, 146, 128), (182, 170, 156)],
                   mortar=(116, 106, 92), lichen=0.12, moss=0.1, light=dict(col=(1.0, 0.66, 0.40), elev=14, energy=5.2)),
    # каньон: тёплый песчаник, мелкие блоки, швы с песком, без лишайника и мха
    'sand': dict(name='stone_sand', seed=31, T=512, hr=(11, 14), wr=(19, 36), joint=2.0, bev=1.6, recess=1.4,
                 stone=[(222, 176, 120), (206, 160, 106), (232, 192, 138), (196, 150, 98), (214, 170, 118)],
                 mortar=(158, 120, 80), lichen=0.0, moss=0.0, light=None),
    # вулкан: тёмный базальт, швы почти чёрные
    'dark': dict(name='stone_dark', seed=41, T=512, hr=(10, 13), wr=(17, 32), joint=1.8, bev=1.5, recess=1.4,
                 stone=[(78, 68, 66), (66, 58, 56), (88, 76, 72), (60, 52, 50), (72, 64, 62)],
                 mortar=(30, 25, 23), lichen=0.0, moss=0.0, light=None),
    # арктика: тёмные гранитные пласты 30–64 ед. с длинными глыбами, на кромке каждого пласта — тонкий снег 2–7 ед.
    # с разрывами, под ним мелкие сосульки и тёмные потёки, по камню редкий иней (как в эталоне arctic.png)
    'strata': dict(name='rock_arctic', seed=61, T=1024, hr=(28, 62), wr=(70, 240), joint=1.8, bev=3.6, recess=2.6,
                   stone=[(56, 61, 72), (50, 55, 66), (62, 67, 78), (45, 50, 60), (54, 59, 70)],
                   mortar=(13, 15, 20), lichen=0.0, moss=0.0, wob=1.8, rough=1.35, warp=(3.2, 3.0),
                   snow=dict(th=(1.5, 8.0), col=(232, 238, 250), gaps=-0.8, icicles=1.0),
                   light=dict(col=(0.82, 0.88, 1.0), elev=32, energy=4.2)),
    # пиратский маяк: побелённый камень, мелкие блоки, светлый раствор
    'light': dict(name='stone_light', seed=51, T=512, hr=(10, 13), wr=(17, 32), joint=1.8, bev=1.5, recess=1.2,
                  stone=[(234, 229, 217), (220, 213, 198), (240, 236, 226), (210, 202, 186), (228, 222, 208)],
                  mortar=(166, 158, 142), lichen=0.06, moss=0.06, light=None),
}


def gnoise(shape, sy, sx, rng):
    """бесшовный гауссов шум (σ в пикселях рендера по y и x), нормирован к σ=1"""
    a = rng.normal(size=shape)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.fftfreq(shape[1])[None, :]
    b = np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * sy) ** 2 + (fx * sx) ** 2))))
    return (b - b.mean()) / (b.std() + 1e-9)


def split(total, lo, hi, rng):
    """случайные длины в [lo, hi], сумма ровно total (ряд/столбец ровно на плитку)"""
    while True:
        n = max(1, int(round(total / ((lo + hi) / 2))))
        v = rng.uniform(lo, hi, n); v *= total / v.sum()
        if v.min() >= lo * 0.9 and v.max() <= hi * 1.1: return v


def field(st):
    rng = np.random.default_rng(st['seed']); T = st['T']; N = T * R
    yy, xx = (np.mgrid[0:N, 0:N] + 0.5) / R                              # координаты в единицах мира
    H = np.zeros((N, N), np.float32); C = np.zeros((N, N, 3), np.float32)
    wk = st.get('wob', 1.0); rk = st.get('rough', 1.0)
    wob = (gnoise((N, N), 2.5 * R, 2.5 * R, rng) * 0.9 + gnoise((N, N), 0.8 * R, 0.8 * R, rng) * 0.25 + gnoise((N, N), 9 * R, 9 * R, rng) * (wk - 1)) * min(wk, 1.4)   # «гуляющий» шов, неровные края
    rough = (gnoise((N, N), 1.1 * R, 1.1 * R, rng) * 0.12 + gnoise((N, N), 3 * R, 3 * R, rng) * 0.3 + gnoise((N, N), 8 * R, 8 * R, rng) * 0.45
             + np.abs(gnoise((N, N), 2.4 * R, 2.4 * R, rng)) * 0.18) * rk            # колотая лицевая сторона: грани, бугры, гребни
    SN = st.get('snow')
    if SN:
        snowv = gnoise((N, N), 5 * R, 14 * R, rng); snowg = gnoise((N, N), 4 * R, 26 * R, rng); sgrain = gnoise((N, N), 0.6 * R, 0.6 * R, rng)
        frost = gnoise((N, N), 0.5 * R, 0.5 * R, rng); drip = gnoise((N, N), 9 * R, 0.9 * R, rng); gran = gnoise((N, N), 0.38 * R, 0.38 * R, rng)
    pits = gnoise((N, N), 0.7 * R, 0.7 * R, rng)
    speck = gnoise((N, N), 0.45 * R, 0.45 * R, rng); mott = gnoise((N, N), 6 * R, 6 * R, rng) * 0.6 + gnoise((N, N), 14 * R, 14 * R, rng) * 0.4
    lich = gnoise((N, N), 4.5 * R, 4.5 * R, rng); lich2 = gnoise((N, N), 1.2 * R, 1.2 * R, rng)
    streak = gnoise((N, N), 26 * R, 1.3 * R, rng); mossn = gnoise((N, N), 5 * R, 5 * R, rng)
    mortn = gnoise((N, N), 0.7 * R, 0.7 * R, rng) * 0.6 + gnoise((N, N), 3 * R, 3 * R, rng) * 0.4
    hs = split(T, *st['hr'], rng); cum = np.concatenate([[0], np.cumsum(hs)])
    stone_cols = np.array(st['stone'], np.float32)
    WP = st.get('warp')
    if WP:                                                   # природные пласты: границы волнистые, вертикальные трещины кривые
        YY = (yy + gnoise((N, N), 18 * R, 40 * R, rng) * WP[0] + gnoise((N, N), 4 * R, 8 * R, rng) * WP[0] * 0.08) % T
        XX = xx + gnoise((N, N), 5 * R, 14 * R, rng) * WP[1]
    for r in range(len(hs)):
        rows = ((YY >= cum[r]) & (YY < cum[r + 1])) if WP else (yy[:, 0] >= cum[r]) & (yy[:, 0] < cum[r + 1])
        ws = split(T, *st['wr'], rng); cw = np.concatenate([[0], np.cumsum(ws)]); off = rng.uniform(0, T)
        X = ((XX[rows] if WP else xx[rows]) + off) % T; Y = (YY[rows] if WP else yy[rows]) - cum[r]; bh = hs[r]
        b = np.clip(np.searchsorted(cw, X, side='right') - 1, 0, len(ws) - 1); bw = ws[b]; fx = X - cw[b]
        # свойства камня
        nb = len(ws); tone = rng.normal(0, 0.06, nb); kind = rng.integers(0, len(stone_cols), nb)
        lift = rng.uniform(-0.35, 0.35, nb); dome = rng.uniform(0.15, 0.55, nb); has_l = rng.random(nb) < st['lichen'] * 2.2
        chip = rng.integers(0, 6, nb); chr_ = rng.uniform(3, 6.5, nb); bevb = st['bev'] * rng.uniform(0.7, 1.6, nb)
        wc = rng.normal(0, 0.018, nb); jwb = st['joint'] / 2 * rng.uniform(0.85, 1.35, nb)
        e = np.minimum(np.minimum(fx, bw - fx), np.minimum(Y, bh - Y)) + wob[rows]
        jw = jwb[b]
        t = np.clip((e - jw) / bevb[b], 0, 1)
        u = 2 * fx / bw - 1; v = 2 * Y / bh - 1
        face = st['recess'] + lift[b] + dome[b] * (1 - u * u) * (1 - v * v) + rough[rows] + np.where(pits[rows] > 2.3, -0.35, 0)
        cx = np.where(chip[b] % 2 == 0, 0, bw); cy = np.where(chip[b] < 2, 0, bh)        # скол одного угла (chip 4,5 — без)
        dc = np.hypot(fx - cx, Y - cy); cut = np.where((chip[b] < 4) & (dc < chr_[b]), (1 - dc / chr_[b]) * 1.4, 0)
        hs_ = face * (1 - (1 - t) ** 2) - cut
        mort = 0.15 + mortn[rows] * 0.12
        stone = e > jw
        H[rows] = np.where(stone, np.maximum(hs_, mort), mort)
        # цвет камня
        base = stone_cols[kind[b]] * (1 + tone[b])[:, :, None] if b.ndim == 2 else stone_cols[kind[b]] * ((1 + tone[b])[:, None] if WP else 1)
        base = base * (1 + mott[rows] * 0.07)[..., None] * np.stack([1 + wc[b], np.ones_like(wc[b]), 1 - wc[b]], -1)   # чуть теплее/холоднее
        base = base * np.where(speck[rows] > 2.0, 0.84, np.where(speck[rows] < -2.1, 1.08, 1.0))[..., None]
        lk = np.clip((lich[rows] - 0.55) * 2.2, 0, 1) * has_l[b] * (0.6 + 0.4 * (1 - Y / bh)) * (0.75 + 0.25 * np.clip(lich2[rows], -1, 1))
        lcol = np.where((kind[b] % 2 == 0)[..., None], np.array([206, 176, 118], np.float32), np.array([168, 176, 140], np.float32))
        base = base * (1 - lk[..., None] * 0.5) + lcol * lk[..., None] * 0.5
        base = base * (1 - np.clip(streak[rows] - 1.1, 0, 1) * 0.22)[..., None]
        base = base * (1 + (1 - t) * 0.05)[..., None]                       # стёртые светлые кромки
        mc = np.array(st['mortar'], np.float32) * (0.88 + 0.12 * mortn[rows])[..., None]
        mk = np.clip((mossn[rows] - (1.6 - st['moss'] * 4)) * 1.5, 0, 1) * (Y > bh * 0.5) * (st['moss'] > 0)   # мох в нижних швах
        mc = mc * (1 - mk[..., None]) + np.array([60, 80, 38], np.float32) * mk[..., None]
        Cr = np.where(stone[..., None], base, mc); Hr = H[rows]
        if SN:
            # зерно гранита: мелкая «соль с перцем» ±9 %, светлые кристаллы полевого шпата и тёмные — слюды
            gr = gran[rows]; Cr = Cr * np.where(stone, 1 + gr * 0.09, 1)[..., None]
            Cr = Cr * np.where(stone & (gr > 1.9), 1.28, np.where(stone & (gr < -1.9), 0.68, 1.0))[..., None]
            # иней: редкие светлые крупинки по камню; тёмные потёки сырости под снегом
            fr = (frost[rows] > 2.75) & stone; Cr = np.where(fr[..., None], Cr * 0.4 + np.array([200, 214, 234], np.float32) * 0.6, Cr)
            th = SN['th'][0] + (SN['th'][1] - SN['th'][0]) * np.clip(0.45 + 0.5 * snowv[rows], 0, 1) ** 1.3
            Yw = Y + wob[rows] * 0.6
            dk = (Yw >= th) & (Yw < th + 14) & (drip[rows] > 0.9); Cr = np.where(dk[..., None], Cr * 0.82, Cr)
            snow = (Yw < th) & (snowg[rows] > SN['gaps'])
            q = np.clip(Yw / np.maximum(th, 0.5), 0, 1)
            scol = np.array(SN['col'], np.float32) * (1 - 0.2 * q ** 1.5)[..., None] * (1 + sgrain[rows] * 0.035)[..., None]
            scol = scol * np.array([1 - 0.06 * 0, 1, 1], np.float32) - np.stack([q * 14, q * 8, q * 0], -1)   # к низу полосы — голубее
            Cr = np.where(snow[..., None], scol, Cr)
            Hr = np.where(snow, np.maximum(Hr, st['recess'] + 0.6 + 1.1 * (1 - q * q) + sgrain[rows] * 0.08), Hr)
            # сосульки под снегом: группы по 3–7 конусов с шагом 2–5 ед., длина 2–9 (иногда до 16), ширина 0,5–1,4
            xs = []
            for _ in range(int(T / 150 * SN['icicles'])):
                gx = rng.uniform(0, T)
                for k in range(rng.integers(3, 8)): xs.append((gx + k * rng.uniform(2, 5)) % T)
            for xc in xs:
                L = rng.uniform(8, 16) if rng.random() < 0.15 else rng.uniform(2, 9); w = rng.uniform(0.5, 1.4)
                y0 = SN['th'][0] + (SN['th'][1] - SN['th'][0]) * 0.4
                yy_ = Y - y0; m_ = (yy_ >= 0) & (yy_ < L) & (np.abs(X - xc) < w * (1 - yy_ / L))
                if not m_.any(): continue
                Cr = np.where(m_[..., None], Cr * 0.25 + np.array([196, 214, 236], np.float32) * 0.75, Cr)
                Hr = np.where(m_, np.maximum(Hr, st['recess'] + 0.8), Hr)
        C[rows] = Cr; H[rows] = Hr
    return H, np.clip(C, 0, 255)


def render_field(st, H, C):
    if st['light']: mt.LIGHT.update(**st['light'])
    sc = mt.reset()
    T = st['T']; N = T * R; M = 64
    Hp = np.pad(H, M, mode='wrap'); Cp = np.pad(C, ((M, M), (M, M), (0, 0)), mode='wrap'); n = N + 2 * M
    size = n / R / 100.0
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=n, y_subdivisions=n, size=size, calc_uvs=True)
    ob = bpy.context.active_object; me = ob.data
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    ix = np.clip(np.round((co[:, 0] + size / 2) / size * n - 0.5).astype(int), 0, n - 1)
    iy = np.clip(np.round((size / 2 - co[:, 1]) / size * n - 0.5).astype(int), 0, n - 1)   # строки массива — сверху вниз
    co[:, 2] = Hp[iy, ix] / 100.0
    me.vertices.foreach_set('co', co.ravel()); me.update()
    for p in me.polygons: p.use_smooth = True
    img = bpy.data.images.new('albedo', n, n, alpha=False); img.colorspace_settings.name = 'sRGB'   # цветовое пространство — до пикселей
    px = np.ones((n, n, 4), np.float32); px[..., :3] = Cp[::-1] / 255.0          # у картинки Blender строки снизу вверх
    img.pixels.foreach_set(px.ravel()); img.update(); img.pack()
    m, nt, b = mt.principled('masonry', 0.82, 0.25)
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img; tx.interpolation = 'Closest'
    nt.links.new(tx.outputs['Color'], b.inputs['Base Color'])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 900; nz.inputs['Detail'].default_value = 6
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.25; bu.inputs['Distance'].default_value = 0.002
    nt.links.new(nz.outputs['Fac'], bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    me.materials.append(m)
    sc.render.resolution_x = sc.render.resolution_y = N; sc.render.resolution_percentage = 100
    sc.camera.data.ortho_scale = T / 100.0; sc.camera.data.clip_end = 50
    sc.cycles.samples = 160
    mt.OUT = os.path.join(ROOT, 'test-results'); mt.render(sc, st['name'] + '_2x')
    mt.LIGHT.update(col=(1.0, 0.85, 0.66), elev=25, energy=5.0)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(STYLES)):
        st = STYLES[key]; H, C = field(st); render_field(st, H, C); print('MASONRY', st['name'], flush=True)


main()
