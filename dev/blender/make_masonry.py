"""Фотореалистичная тёсаная кладка по эталонам (мост долины valley_house.png, замки castles.png).

Карта высот и цвета считается в numpy (бесшовно, только numpy — в Blender нет scipy): ряды 16–21 ед., камни разной длины,
шов 2–3 ед. утоплен, у камней фаска 2 ед., бугристая «колотая» лицевая сторона, раковины, сколы углов; цвет — гранит
с крапом, лишайник пятнами на части камней, тёмные потёки, мох в некоторых швах. Blender (Cycles) рендерит это как
настоящий рельеф (≈1,3 млн вершин): тени в швах, объём фасок, шероховатость. Поле с запасом по краям (заворот) —
тени у краёв плитки правильные, текстура бесшовная.

blender -b --python dev/blender/make_masonry.py -- <стиль> [...]     стили: valley, castle, sand, dark, strata, light
Поле считается с шагом 1/2 ед., рендер — блоками в 4 раза подробнее игровой текстуры (dev/blender/hf_render.py):
test-results/blocks/<имя>/b_*.png → python dev/tools/stitch_blocks.py test-results/blocks/<имя> test-results/<имя>_4x.png
→ python dev/make_native.py test-results/<имя>_4x.png <имя> --no-match --lossy --quality 90 (родная ×4 и малая текстура).
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

R = int(os.environ.get('HF_R', '4'))    # точек поля (и пикселей рендера) на единицу мира: 4 — родная ×4 для приближения
UP = int(os.environ.get('HF_UP', '1'))   # дополнительное увеличение при рендере (1 — поле уже в нужном разрешении)
spec2 = importlib.util.spec_from_file_location('hf', os.path.join(HERE, 'hf_render.py'))
hf = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(hf)
STYLES = {
    # мост-акведук и руины долины: светлый серый гранит, крупные камни, лишайник
    'valley': dict(name='stone_valley', seed=11, T=512, hr=(16, 21), wr=(26, 54), joint=2.4, bev=1.3, recess=1.6, tilt=0.7,
                   stone=[(184, 172, 152), (166, 156, 140), (196, 184, 164), (150, 140, 126), (176, 162, 142)],
                   mortar=(88, 76, 60), lichen=0.3, moss=0.24, light=None),   # r23: швы тёплые и не чёрные, камень теплее, фаска −40 %
    # замки на закате: тёплый песчаник-известняк, камни мельче, швы тоньше
    # r29 → v71: камни крупнее и разного размера (критик: «мелкий плоский кирпич 20×12»), больше мха и лишайника
    'castle': dict(name='stone_castle', seed=23, T=512, hr=(19, 31), wr=(30, 74), joint=2.2, bev=1.8, recess=1.8, tilt=0.8,
                   stone=[(178, 170, 158), (164, 156, 145), (190, 182, 168), (152, 144, 134), (172, 166, 156)],
                   mortar=(104, 96, 86), lichen=0.34, moss=0.42, light=dict(col=(1.0, 0.78, 0.58), elev=18, energy=5.2)),   # r23: насыщенность −35 %
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
    # r23: пласты 40–120 ед. разной толщины, трещины редкие (300–500) и косые (10–25°), у каждого пласта карниз сверху
    # (светлый верх, тень под уступом — от настоящего рельефа), крупные пятна тона ±10 L
    # r24 → v44: пласты как в эталоне (≈30 ед.: 24–42), трещины чаще (80–200), карниз сильнее (светлый верх, тень под
    # уступом), снег на кромке почти сплошной и толще, сосулек и инея больше
    # r28 → v61: швы рваные и косые (wob 2.8, warp 6.5, slant 8–32°), глыбы 60–300 — не «кирпичная сетка»
    # r26 → v51: «обои» — сплошная белая нитка снега на каждом ряду; теперь снег пятнами (~⅓ уступов), но толще, ряды
    # разной высоты (22–56), швы между глыбами глубже, камень светлее ~15 % (как в эталоне — голубоватые грани)
    'strata': dict(name='rock_arctic', seed=61, T=1024, TY=512, hr=(22, 56), wr=(60, 300), joint=2.6, bev=3.2, recess=2.8, tilt=0.8,
                   slant=(8, 32), ledge=3.4, mottk=0.2, frostT=1.9,   # v80 (r32: в эталоне 90-й процентиль яркости 111, у нас 54): инея больше
                   stone=[(58, 69, 85), (53, 62, 78), (65, 76, 92), (47, 57, 71), (57, 67, 83)],   # r27: холоднее (−8 % красного)
                   mortar=(13, 15, 20), lichen=0.0, moss=0.0, wob=2.8, rough=1.6, warp=(6.5, 5.5),
                   snow=dict(th=(3.0, 7.5), col=(232, 238, 250), gaps=-0.6, icicles=3.0),   # v80: тонкая почти сплошная полоса снега на каждом уступе и вдвое больше сосулек (эталон), а не толстые «линзы»
                   light=dict(col=(0.82, 0.88, 1.0), elev=32, energy=4.2)),
    # вулкан (критик r26–27: нет крупных плит, лава — пятна): базальтовые плиты 30–70 × 90–260 ед., в трети швов —
    # светящийся расплав (свечение в Blender → слой свечения игры), тёплый свет снизу
    'basalt': dict(name='rock_volcano', seed=71, T=1024, TY=512, hr=(30, 70), wr=(70, 320), joint=2.4, bev=3.0, recess=3.0, tilt=0.8,
                   slant=(8, 32), ledge=3.0, mottk=0.22,
                   stone=[(60, 46, 40), (52, 40, 35), (68, 52, 44), (46, 36, 32), (62, 48, 41)],
                   mortar=(20, 14, 12), lichen=0.0, moss=0.0, wob=2.8, rough=1.7, warp=(6.5, 5.5),
                   lava=dict(thr=0.55, col=(255, 116, 28)), emit=0.45,
                   light=dict(col=(1.0, 0.86, 0.72), elev=32, energy=4.2)),
    # каньон (критик r28: «кирпичная плитка»): охристые пласты песчаника 26–64 ед., глыбы 90–360, швы рваные и косые,
    # пласты разного тона (светлые и красноватые), тёплый закатный свет
    # r31 → v75 (критик: «рваные лоскуты 150×45 с пятнами»): длинные непрерывные пласты 36–80 ед., глыбы 220–700, швы тоньше,
    # почти горизонтальные трещины, пятнистость тона вдвое меньше — как в эталоне canyon.png
    'sandstone': dict(name='rock_canyon', seed=81, T=1024, TY=1024, hr=(36, 80), wr=(220, 700), joint=1.7, bev=2.6, recess=2.0, tilt=0.5,
                      slant=(2, 10), ledge=3.0, mottk=0.11,
                      stone=[(176, 118, 76), (160, 102, 64), (190, 134, 90), (146, 92, 58), (170, 112, 70), (184, 128, 86)],
                      mortar=(92, 56, 34), lichen=0.0, moss=0.0, wob=1.8, rough=1.3, warp=(3.0, 2.5),
                      light=dict(col=(1.0, 0.86, 0.66), elev=30, energy=4.6)),
    # пиратский маяк: побелённый камень, мелкие блоки, светлый раствор
    'light': dict(name='stone_light', seed=51, T=512, hr=(10, 13), wr=(17, 32), joint=1.8, bev=1.5, recess=1.2,
                  stone=[(234, 229, 217), (220, 213, 198), (240, 236, 226), (210, 202, 186), (228, 222, 208)],
                  mortar=(166, 158, 142), lichen=0.06, moss=0.06, light=None),
}


def gnoise(shape, sy, sx, rng):
    """бесшовный гауссов шум (σ в пикселях рендера по y и x), нормирован к σ=1; float32 — экономия памяти при 4×"""
    a = rng.standard_normal(size=shape, dtype=np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * sy) ** 2 + (fx * sx) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def split(total, lo, hi, rng):
    """случайные длины в [lo, hi], сумма ровно total (ряд/столбец ровно на плитку)"""
    while True:
        n = max(1, int(round(total / ((lo + hi) / 2))))
        v = rng.uniform(lo, hi, n); v *= total / v.sum()
        if v.min() >= lo * 0.9 and v.max() <= hi * 1.1: return v


def field(st):
    rng = np.random.default_rng(st['seed']); T = st['T']; TY = st.get('TY', T); NX = T * R; NY = TY * R; SH = (NY, NX)
    yy, xx = (np.mgrid[0:NY, 0:NX].astype(np.float32) + 0.5) / R          # координаты в единицах мира
    H = np.zeros(SH, np.float32); C = np.zeros((NY, NX, 3), np.float32)
    wk = st.get('wob', 1.0); rk = st.get('rough', 1.0)
    wob = (gnoise(SH, 2.5 * R, 2.5 * R, rng) * 0.9 + gnoise(SH, 0.8 * R, 0.8 * R, rng) * 0.25 + gnoise(SH, 9 * R, 9 * R, rng) * (wk - 1)) * min(wk, 1.4)   # «гуляющий» шов, неровные края
    rough = (gnoise(SH, 1.1 * R, 1.1 * R, rng) * 0.12 + gnoise(SH, 3 * R, 3 * R, rng) * 0.3 + gnoise(SH, 8 * R, 8 * R, rng) * 0.45
             + np.abs(gnoise(SH, 2.4 * R, 2.4 * R, rng)) * 0.18 + gnoise(SH, 0.35 * R, 0.35 * R, rng) * 0.05) * rk   # колотая лицевая сторона: грани, бугры, гребни, зерно
    SN = st.get('snow'); LV = st.get('lava')
    E = np.zeros((NY, NX, 3), np.float32) if LV else None
    if LV: lavan = gnoise(SH, 3 * R, 40 * R, rng)   # расплав тянется вдоль шва
    if SN:
        snowv = gnoise(SH, 5 * R, 14 * R, rng); snowg = gnoise(SH, 4 * R, 26 * R, rng); sgrain = gnoise(SH, 0.6 * R, 0.6 * R, rng)
        frost = gnoise(SH, 0.5 * R, 0.5 * R, rng); drip = gnoise(SH, 9 * R, 0.9 * R, rng); gran = gnoise(SH, 0.38 * R, 0.38 * R, rng)
    pits = gnoise(SH, 0.7 * R, 0.7 * R, rng)
    speck = gnoise(SH, 0.45 * R, 0.45 * R, rng); mott = gnoise(SH, 6 * R, 6 * R, rng) * 0.6 + gnoise(SH, 14 * R, 14 * R, rng) * 0.4
    lich = gnoise(SH, 4.5 * R, 4.5 * R, rng); lich2 = gnoise(SH, 1.2 * R, 1.2 * R, rng)
    streak = gnoise(SH, 26 * R, 1.3 * R, rng); mossn = gnoise(SH, 5 * R, 5 * R, rng)
    mortn = gnoise(SH, 0.7 * R, 0.7 * R, rng) * 0.6 + gnoise(SH, 3 * R, 3 * R, rng) * 0.4
    hs = split(TY, *st['hr'], rng); cum = np.concatenate([[0], np.cumsum(hs)])
    stone_cols = np.array(st['stone'], np.float32)
    WP = st.get('warp')
    if WP:                                                   # природные пласты: границы волнистые, вертикальные трещины кривые
        YY = (yy + gnoise(SH, 18 * R, 40 * R, rng) * WP[0] + gnoise(SH, 4 * R, 8 * R, rng) * WP[0] * 0.08) % TY
        XX = xx + gnoise(SH, 5 * R, 14 * R, rng) * WP[1]
    for r in range(len(hs)):
        rows = ((YY >= cum[r]) & (YY < cum[r + 1])) if WP else (yy[:, 0] >= cum[r]) & (yy[:, 0] < cum[r + 1])
        ws = split(T, *st['wr'], rng); cw = np.concatenate([[0], np.cumsum(ws)]); off = rng.uniform(0, T)
        Y = (YY[rows] if WP else yy[rows]) - cum[r]; bh = hs[r]
        SL = st.get('slant'); ang = math.radians(rng.uniform(*SL)) * (1 if rng.random() < 0.5 else -1) if SL else 0.0
        X = ((XX[rows] if WP else xx[rows]) + off + (Y - bh / 2) * math.tan(ang)) % T                  # косые трещины пласта
        b = np.clip(np.searchsorted(cw, X, side='right') - 1, 0, len(ws) - 1); bw = ws[b]; fx = X - cw[b]
        # свойства камня
        nb = len(ws); tone = rng.normal(0, 0.06, nb); kind = rng.integers(0, len(stone_cols), nb)
        lift = rng.uniform(-0.35, 0.35, nb); dome = rng.uniform(0.15, 0.55, nb); has_l = rng.random(nb) < st['lichen'] * 2.2
        chip = rng.integers(0, 6, nb); chr_ = rng.uniform(3, 6.5, nb); bevb = st['bev'] * rng.uniform(0.7, 1.6, nb)
        wc = rng.normal(0, 0.018, nb); jwb = st['joint'] / 2 * rng.uniform(0.85, 1.35, nb)
        tlx = rng.uniform(-1, 1, nb) * st.get('tilt', 0.0); tly = rng.uniform(-1, 1, nb) * st.get('tilt', 0.0)   # наклон грани — камни освещены по-разному
        e = np.minimum(np.minimum(fx, bw - fx), np.minimum(Y, bh - Y)) + wob[rows]
        jw = jwb[b]
        t = np.clip((e - jw) / bevb[b], 0, 1)
        u = 2 * fx / bw - 1; v = 2 * Y / bh - 1
        face = st['recess'] + lift[b] + dome[b] * (1 - u * u) * (1 - v * v) + rough[rows] + np.where(pits[rows] > 2.3, -0.35, 0) + tlx[b] * u + tly[b] * v
        if st.get('ledge'):                                   # карниз вверху пласта и подрезка внизу: светлый верх, тень под уступом
            v01 = np.clip(Y / bh, 0, 1); face = face + st['ledge'] * (1 - np.clip(v01 / 0.3, 0, 1)) ** 2 - 0.6 * st['ledge'] * np.clip((v01 - 0.65) / 0.35, 0, 1) ** 2
        cx = np.where(chip[b] % 2 == 0, 0, bw); cy = np.where(chip[b] < 2, 0, bh)        # скол одного угла (chip 4,5 — без)
        dc = np.hypot(fx - cx, Y - cy); cut = np.where((chip[b] < 4) & (dc < chr_[b]), (1 - dc / chr_[b]) * 1.4, 0)
        hs_ = face * (1 - (1 - t) ** 2) - cut
        mort = 0.15 + mortn[rows] * 0.12
        stone = e > jw
        H[rows] = np.where(stone, np.maximum(hs_, mort), mort)
        # цвет камня
        base = stone_cols[kind[b]] * (1 + tone[b])[:, :, None] if b.ndim == 2 else stone_cols[kind[b]] * ((1 + tone[b])[:, None] if WP else 1)
        base = base * (1 + mott[rows] * st.get('mottk', 0.07))[..., None] * np.stack([1 + wc[b], np.ones_like(wc[b]), 1 - wc[b]], -1)   # чуть теплее/холоднее
        base = base * np.where(speck[rows] > 2.0, 0.84, np.where(speck[rows] < -2.1, 1.08, 1.0))[..., None]
        lk = np.clip((lich[rows] - 0.55) * 2.2, 0, 1) * has_l[b] * (0.6 + 0.4 * (1 - Y / bh)) * (0.75 + 0.25 * np.clip(lich2[rows], -1, 1))
        lcol = np.where((kind[b] % 2 == 0)[..., None], np.array([206, 176, 118], np.float32), np.array([168, 176, 140], np.float32))
        base = base * (1 - lk[..., None] * 0.5) + lcol * lk[..., None] * 0.5
        base = base * (1 - np.clip(streak[rows] - 1.1, 0, 1) * 0.22)[..., None]
        base = base * (1 + (1 - t) * 0.05)[..., None]                       # стёртые светлые кромки
        mc = np.array(st['mortar'], np.float32) * (0.88 + 0.12 * mortn[rows])[..., None]
        mk = np.clip((mossn[rows] - (1.6 - st['moss'] * 4)) * 1.5, 0, 1) * (Y > bh * 0.5) * (st['moss'] > 0)   # мох в нижних швах
        mc = mc * (1 - mk[..., None]) + np.array([60, 80, 38], np.float32) * mk[..., None]
        # мох пятнами на верхних гранях камней (как на мосту эталона): там, где шум мха высок, ближе к верху ряда
        if st['moss'] > 0:
            mk2 = np.clip((mossn[rows] - (1.5 - st['moss'] * 3)) * 1.6, 0, 1) * np.clip(1 - Y / (bh * 0.55), 0, 1)
            mcol = np.array([74, 94, 42], np.float32) * (0.85 + 0.15 * np.clip(lich2[rows], -1, 1))[..., None]
            base = base * (1 - mk2[..., None] * 0.75) + mcol * mk2[..., None] * 0.75
        Cr = np.where(stone[..., None], base, mc); Hr = H[rows]
        if SN:
            # зерно гранита: мелкая «соль с перцем» ±9 %, светлые кристаллы полевого шпата и тёмные — слюды
            gr = gran[rows]; Cr = Cr * np.where(stone, 1 + gr * 0.09, 1)[..., None]
            Cr = Cr * np.where(stone & (gr > 1.9), 1.28, np.where(stone & (gr < -1.9), 0.68, 1.0))[..., None]
            # иней: редкие светлые крупинки по камню; тёмные потёки сырости под снегом
            fr = (frost[rows] > st.get('frostT', 2.75)) & stone; Cr = np.where(fr[..., None], Cr * 0.4 + np.array([200, 214, 234], np.float32) * 0.6, Cr)
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
        if LV:   # светящийся расплав в части швов: сам шов — оранжевый, свечение — в карту излучения
            k = np.clip((lavan[rows] - LV['thr']) * 2.2, 0, 1) * (~stone)
            col = np.array(LV['col'], np.float32)
            Cr = Cr * (1 - k[..., None]) + col * k[..., None]; E[rows] = (col / 255.0) * k[..., None]
        C[rows] = Cr; H[rows] = Hr
    return (H, np.clip(C, 0, 255), E) if LV else (H, np.clip(C, 0, 255))


def render_field(st, H, C):
    if st['light']: mt.LIGHT.update(**st['light'])
    sc = mt.reset()
    T = st['T']; N = T * R; M = 64
    Hp = np.pad(H, M, mode='wrap'); Cp = np.pad(C, ((M, M), (M, M), (0, 0)), mode='wrap'); n = N + 2 * M
    size = n / R / 100.0
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=n, y_subdivisions=n, size=size, calc_uvs=True)
    ob = bpy.context.active_object; me = ob.data
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    # вершины сетки стоят в углах пикселей (n+1 на сторону): высота угла — среднее четырёх соседних пикселей
    # (прежнее «ближайший пиксель» брало рельеф через пиксель — полосы и рябь на гранях)
    ix = np.clip(np.round((co[:, 0] + size / 2) / size * n).astype(int), 0, n)
    iy = np.clip(np.round((size / 2 - co[:, 1]) / size * n).astype(int), 0, n)
    Hc = np.pad(Hp, 1, mode='edge')
    co[:, 2] = 0.25 * (Hc[iy, ix] + Hc[iy + 1, ix] + Hc[iy, ix + 1] + Hc[iy + 1, ix + 1]) / 100.0
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
        st = STYLES[key]; res = field(st); H, C = res[0], res[1]; E = res[2] if len(res) > 2 else None
        hf.render_blocks(mt, st['name'], H, C, E, R2=R, up=UP, light=st['light'], samples=128, emit=st.get('emit', 1.6),
                         hgrain=st.get('hgrain', 0.22), cgrain=st.get('cgrain', 0.6), speck=st.get('speck', 0.006))   # зерно камня в 1–2 текселя
        print('MASONRY', st['name'], flush=True)


main()
