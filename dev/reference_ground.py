"""Грунт долины и замков из эталонов, с воспроизводимыми картами деталей.

Запуск из любой папки: python dev/reference_ground.py [dirt_valley dirt_castle].
Крупные исходные участки сохраняют форму валунов; не меняет геометрию карт.
"""
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageEnhance

from tex_from_ref import load_sources, quilt
from make_detail import main as make_detail, update_list

ROOT = Path(__file__).resolve().parent.parent
RECIPES = {
    'dirt_valley': {
        'seed': 103,
        'scale': 1.5,
        'lightness': 1.15,
        'sources': {
            'valley_house': [(0, 760, 330, 1024), (330, 755, 650, 1024)],
            'valley_tower': [(415, 840, 690, 992)],
        },
    },
    'dirt_castle': {
        'seed': 113,
        'scale': 1.35,
        'lightness': 1.3,
        'sources': {
            'castles': [(1170, 550, 1480, 810), (1050, 640, 1340, 820), (15, 640, 195, 820)],
        },
    },
}


def build(name):
    recipe = RECIPES[name]
    srcs = []
    for ref, boxes in recipe['sources'].items():
        srcs.extend(load_sources(ROOT / 'dev/reference' / (ref + '.png'), boxes, recipe['scale']))
    a = quilt(srcs, 2048, B=224, O=64, seed=recipe['seed'], cands=48,
              feather=24, mirror=0.4, brightness=10.0, reuse_penalty=0.0)
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    im = ImageEnhance.Color(im).enhance(0.8)
    im = ImageEnhance.Brightness(im).enhance(recipe['lightness'])
    tmp = ROOT / 'test-results/ref-ground'
    tmp.mkdir(parents=True, exist_ok=True)
    path = tmp / (name + '-2x.png')
    im.save(path)
    make_detail(str(path), name, str(ROOT / 'assets/tex'))
    print(name, 'RGB', np.asarray(im).mean((0, 1)).round(1).tolist(), flush=True)


if __name__ == '__main__':
    names = sys.argv[1:] or list(RECIPES)
    for name in names:
        if name not in RECIPES:
            raise SystemExit('Неизвестная текстура: ' + name)
        build(name)
    update_list(str(ROOT / 'assets/tex'), str(ROOT / 'js/art.js'))
