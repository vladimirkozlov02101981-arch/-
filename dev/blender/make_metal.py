"""Металл построек из Blender в 4 раза подробнее игровой текстуры: профнастил станции, стальные листы, корпус тарелки.

blender -b --python dev/blender/make_metal.py -- [стиль ...]       стили: station, steel, ufo
Поле высот и цвета (numpy, бесшовно), рендер блоками (dev/blender/hf_render.py) → test-results/blocks/<имя>/ →
python dev/tools/stitch_blocks.py test-results/blocks/<имя> test-results/<имя>_4x.png →
python dev/make_native.py test-results/<имя>_4x.png <имя> --no-match --lossy --quality 90.

profile:'ribs' — вертикальная гофра (период rib ед.), листы sheet[0]×sheet[1] ед. внахлёст (нижний край листа
выступает над следующим), болты по горизонтальным швам на гребнях; 'plates' — гладкие листы с фаской, заклёпки по
периметру. Краска с облупленными местами (грунт, ржавчина), потёки ржавчины вниз от болтов, грязь у нижних кромок,
вмятины. Металл и краска различаются шероховатостью и блеском — их считает Cycles.
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
    'station': dict(name='metal_station', seed=5, T=512, profile='ribs', rib=8, sheet=(128, 96), amp=1.1,
                    paint=(142, 66, 52), primer=(126, 118, 104), rust=(96, 50, 30), chip=0.045, streaks=0.5, dirt=0.3,   # реже сколы: при обычном масштабе 0.07 читались «дырами»
                    light=dict(col=(0.86, 0.9, 1.0), elev=28, energy=4.6)),
    'steel': dict(name='metal_steel', seed=6, T=512, profile='plates', sheet=(64, 32), amp=0.6,
                  paint=(122, 130, 144), primer=(104, 108, 114), rust=(128, 72, 40), chip=0.05, streaks=0.35, dirt=0.25, light=None),
    'ufo': dict(name='metal_ufo', seed=7, T=512, profile='plates', sheet=(48, 24), amp=0.4,
                paint=(156, 163, 181), primer=(120, 126, 140), rust=(98, 104, 120), chip=0.03, streaks=0.2, dirt=0.15,
                light=dict(col=(0.86, 0.88, 1.0), elev=30, energy=4.6)),
}


def gnoise(shape, sy, sx, rng):
    a = rng.standard_normal(size=shape, dtype=np.float32)
    fy = np.fft.fftfreq(shape[0])[:, None]; fx = np.fft.rfftfreq(shape[1])[None, :]
    b = np.fft.irfft2(np.fft.rfft2(a) * np.exp(-2 * math.pi ** 2 * ((fy * sy) ** 2 + (fx * sx) ** 2)), s=shape).astype(np.float32)
    b -= b.mean(); b /= (b.std() + 1e-9); return b


def field(st):
    rng = np.random.default_rng(st['seed']); T = st['T']; N = T * R; SH = (N, N)
    yy, xx = (np.mgrid[0:N, 0:N].astype(np.float32) + 0.5) / R
    sw, sh = st['sheet']
    row = np.floor(yy / sh); fy = yy - row * sh                                   # ряд листов
    off = (row % 2) * (sw / 2)                                                   # листы рядов сдвинуты на полдлины
    colx = np.floor((xx + off) / sw); fx = xx + off - colx * sw
    sid = (row * 97 + colx * 31) % 1009
    H = np.zeros(SH, np.float32)
    if st['profile'] == 'ribs':
        rp = (xx % st['rib']) / st['rib']
        H += st['amp'] * np.sin(rp * 2 * math.pi).astype(np.float32)               # гофра
        H += 0.9 * (1 - fy / sh)                                                     # лист наклонён: верх утоплен под вышестоящий
        H -= np.where(fy < 1.0, 1.2 * (1 - fy), 0)                                   # тень нахлёста
    else:
        e = np.minimum(np.minimum(fx, sw - fx), np.minimum(fy, sh - fy))
        H += st['amp'] * np.clip(e / 1.6, 0, 1)                                      # фаска листа
        H -= np.where(e < 0.5, 0.3, 0)
    dent = gnoise(SH, 14 * R, 14 * R, rng) * 0.35 + gnoise(SH, 4 * R, 4 * R, rng) * 0.08
    H += dent
    # болты / заклёпки
    bolt = np.zeros(SH, np.float32)
    if st['profile'] == 'ribs':
        by = np.array([2.2, sh - 2.5], np.float32); step = st['rib']
        for b0 in by:
            dy = fy - b0; dx = ((xx + step * 0.25) % step) - step / 2
            d = np.sqrt(dx * dx + dy * dy); bolt = np.maximum(bolt, np.clip(1 - d / 0.95, 0, 1))
    else:
        step = 8.0
        e2x = np.minimum(fx, sw - fx); e2y = np.minimum(fy, sh - fy)
        along_x = ((fx + step / 2) % step) - step / 2; along_y = ((fy + step / 2) % step) - step / 2
        d1 = np.sqrt((e2y - 2.2) ** 2 + along_x ** 2); d2 = np.sqrt((e2x - 2.2) ** 2 + along_y ** 2)
        bolt = np.clip(1 - np.minimum(d1, d2) / 0.8, 0, 1)
    H += np.sqrt(bolt) * 0.9
    # цвет: краска, облупленная до грунта и ржавчины; потёки; грязь у нижних кромок
    paint = np.array(st['paint'], np.float32); primer = np.array(st['primer'], np.float32); rust = np.array(st['rust'], np.float32)
    tone = ((np.sin(sid * 12.9898) * 43758.5453) % 1.0).astype(np.float32)
    C = paint * (0.9 + 0.2 * tone)[..., None] * (1 + gnoise(SH, 10 * R, 10 * R, rng) * 0.05)[..., None]
    if st['profile'] == 'ribs':                                                     # выгорание краски на гребнях
        C *= (1 + 0.06 * np.sin(rp * 2 * math.pi))[..., None]
    ch = gnoise(SH, 1.6 * R, 1.6 * R, rng) * 0.6 + gnoise(SH, 6 * R, 6 * R, rng) * 0.4
    chipm = ch > (2.2 - st['chip'] * 10)
    rustm = ch > (2.5 - st['chip'] * 10)
    C = np.where(chipm[..., None], primer, C); C = np.where(rustm[..., None], rust, C)
    H -= chipm * 0.12
    # потёки ржавчины вниз от болтов и швов
    streak = gnoise(SH, 30 * R, 0.9 * R, rng)
    sk = np.clip(streak - (1.6 - st['streaks']), 0, 1) * np.clip(1 - fy / sh, 0.2, 1) * 0.6
    C = C * (1 - sk[..., None]) + rust * sk[..., None]
    dirt = np.clip(fy / sh - 0.6, 0, 1) / 0.4 * st['dirt']
    C = C * (1 - dirt[..., None] * 0.5)
    C = np.where((bolt > 0)[..., None], np.array([70, 68, 66], np.float32) * (0.7 + 0.5 * bolt)[..., None], C)
    C *= (1 + gnoise(SH, 0.4 * R, 0.4 * R, rng) * 0.035)[..., None]
    return H.astype(np.float32), np.clip(C, 0, 255).astype(np.float32)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(STYLES)):
        st = STYLES[key]; H, C = field(st)
        hf.render_blocks(mt, st['name'], H, C, None, R2=R, up=1, light=st.get('light'), samples=128, rough=0.5, spec=0.45, micro=0.05)
        print('METAL', st['name'], flush=True)


main()
