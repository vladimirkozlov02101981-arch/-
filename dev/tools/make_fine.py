"""Мелкие детали материалов мельче текселя родной ×4 (цель владельца 28.10: «невероятно чётко, без размытостей — как в
реальности, чётче фото эталона при увеличении»): assets/tex/fine/<имя>.webp — бесшовная яркость 1024² (8 текселей на
единицу мира, период 128 ед.), 128 = без изменений. Игра умножает на неё родной цвет материала (terrain_gl.js fineMul, до трёх
материалов карты; плитки js/hires.js — все); при обычном масштабе мип-карта усредняет её в 128 — вид карты не меняется.

python dev/tools/make_fine.py [имя ...]        (без имён — все из MATERIALS); затем имя попадает в TexLib.fineAvail (js/art.js)

Виды деталей (фото взять негде — процедурно, по замерам фото-текстур Poly Haven из прежних версий):
  wood     — волокна вдоль доски (σ 0,4×5 текселя), поры-штрихи, тонкий блеск;
  concrete — зерно цемента (σ 0,6), раковины 1–3 текселя, светлые песчинки;
  rock     — зерно породы, микротрещины;
  sand     — песчинки светлые и тёмные;
  snow     — редкие искры-кристаллы и мягкое зерно;
  moss     — ворс: короткие светлые побеги и тёмные просветы;
  metal    — шлифовка: тонкие горизонтальные риски, редкие точки коррозии.
"""
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
N = 1024
MATERIALS = {
    'wood_hull': ('wood', 0.07), 'wood_ship': ('wood', 0.06), 'wood_light': ('wood', 0.06),
    'facade_city': ('concrete', 0.06), 'concrete_city': ('concrete', 0.07),
    'rock_volcano': ('rock', 0.08), 'stone_dark': ('rock', 0.07), 'rock_alien': ('rock', 0.06), 'rock_canyon': ('rock', 0.07),
    'rock_arctic': ('rock', 0.06), 'stone_castle': ('rock', 0.07), 'stone_valley': ('rock', 0.07), 'stone_light': ('rock', 0.06),
    'dirt_canyon': ('sand', 0.08), 'cap_sand': ('sand', 0.09), 'dirt_tropical': ('sand', 0.08), 'cap_ash': ('sand', 0.08),
    'cap_snow': ('snow', 0.05), 'cap_moss': ('moss', 0.1), 'metal_steel': ('metal', 0.05),
}


def gn(rng, sy, sx):
    """бесшовный гауссов шум σ (по y, по x) в текселях, нормирован к σ=1"""
    a = nd.gaussian_filter(rng.standard_normal((N, N)).astype(np.float32), (sy, sx), mode='wrap')
    return (a - a.mean()) / (a.std() + 1e-9)


def specks(rng, frac, r):
    """редкие пятнышки радиуса r текселей (0..1)"""
    m = (rng.random((N, N)) < frac).astype(np.float32)
    return np.clip(nd.gaussian_filter(m, r, mode='wrap') * (2 * np.pi * r * r), 0, 1)


def make(kind, amp, seed):
    rng = np.random.default_rng(seed)
    if kind == 'wood':
        v = gn(rng, 0.4, 5) * 0.7 + gn(rng, 0.8, 14) * 0.3
        v -= np.clip(gn(rng, 0.45, 2.2) - 2.1, 0, 1.5) * 1.6                      # поры-штрихи
        v += gn(rng, 0.5, 0.5) * 0.25
    elif kind == 'concrete':
        v = gn(rng, 0.6, 0.6) * 0.8 + gn(rng, 1.6, 1.6) * 0.4
        v -= specks(rng, 0.004, 0.9) * 3.5                                          # раковины
        v += specks(rng, 0.006, 0.6) * 1.8                                          # песчинки
    elif kind == 'rock':
        v = gn(rng, 0.6, 0.6) * 0.7 + gn(rng, 1.4, 1.4) * 0.5
        cr = np.abs(gn(rng, 6, 6))
        v -= np.clip(1 - cr / 0.035, 0, 1) * 2.2                                    # микротрещины: изолинии шума — извилистые нити
    elif kind == 'sand':
        v = gn(rng, 0.55, 0.55) * 0.9
        v += specks(rng, 0.012, 0.6) * 2.0 - specks(rng, 0.01, 0.6) * 2.0
    elif kind == 'snow':
        v = gn(rng, 1.0, 1.0) * 0.5
        v += specks(rng, 0.0025, 0.5) * 6.0                                         # искры-кристаллы
    elif kind == 'moss':
        v = gn(rng, 0.5, 0.5) * 0.6 + gn(rng, 1.2, 0.6) * 0.5
        v += np.clip(gn(rng, 1.5, 0.4) - 1.6, 0, 2) * 1.4 - np.clip(-gn(rng, 0.7, 0.7) - 1.9, 0, 2) * 1.8
    elif kind == 'metal':
        v = gn(rng, 0.3, 12) * 0.8 + gn(rng, 0.6, 0.6) * 0.3
        v -= specks(rng, 0.002, 1.0) * 2.5
    else:
        raise ValueError(kind)
    v -= v.mean()
    out = 128 * (1 + amp * v / (v.std() + 1e-9))
    out *= 128 / out.mean()                                                         # среднее — ровно 128 (без сдвига тона)
    return np.clip(out, 0, 255)


def update_art(names):
    p = os.path.join(ROOT, 'js', 'art.js')
    raw = open(p, 'rb').read(); crlf = b'\r\n' in raw
    s = raw.decode('utf-8').replace('\r\n', '\n')
    m = re.search(r"fineAvail: new Set\(\[([^\]]*)\]\)", s)
    have = re.findall(r"'([\w]+)'", m.group(1))
    allv = have + [n for n in names if n not in have]
    s = s.replace(m.group(0), "fineAvail: new Set([" + ", ".join("'%s'" % n for n in allv) + "])")
    open(p, 'wb').write((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))


def main():
    names = sys.argv[1:] or list(MATERIALS)
    od = os.path.join(ROOT, 'assets', 'tex', 'fine'); os.makedirs(od, exist_ok=True)
    for i, n in enumerate(names):
        kind, amp = MATERIALS[n]
        v = make(kind, amp, 1000 + sum(map(ord, n)))
        g = v.round().astype(np.uint8)
        Image.fromarray(np.stack([g, g, g], -1)).save(os.path.join(od, n + '.webp'), 'WEBP', lossless=True, quality=100, method=6)
        print('FINE', n, kind, 'σ %.1f' % v.std(), 'mean %.2f' % v.mean(), os.path.getsize(os.path.join(od, n + '.webp')) // 1024, 'KB', flush=True)
    update_art(names)


if __name__ == '__main__':
    main()
