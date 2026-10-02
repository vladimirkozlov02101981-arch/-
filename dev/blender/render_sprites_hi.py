"""Те же спрайты деревьев/стогов/грибов, что в make_textures.py, но в K раз подробнее (по умолчанию 4).

blender -b --python dev/blender/render_sprites_hi.py -- [имя ...]     (без имён — все из SPRITES)
SPRITE_OUT=<папка> — куда писать (по умолчанию test-results/sprites-hi; в assets/tex переносить после проверки)
SPRITE_K=<k>       — во сколько раз крупнее

Сцены детерминированы (те же seed), камера и кадр те же — меняется только разрешение, поэтому в игре дерево
рисуется на том же месте и того же размера, но при приближении остаётся чётким.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)
mt.OUT = os.environ.get('SPRITE_OUT') or os.path.join(ROOT, 'test-results', 'sprites-hi')
K = int(os.environ.get('SPRITE_K', '4'))

# имя → (функция, seed, вид, исходный размер кадра)
SPRITES = {
    'tree_oak1': ('tree', 51, 'oak', 320), 'tree_oak2': ('tree', 52, 'oak', 320), 'tree_oak3': ('tree', 53, 'oak', 320),
    'tree_pine1': ('tree', 61, 'pine', 320), 'tree_pine2': ('tree', 62, 'pine', 320),
    'tree_birch1': ('tree', 71, 'birch', 320),
    'tree_pine_snow1': ('tree', 63, 'pine_snow', 320), 'tree_pine_snow2': ('tree', 64, 'pine_snow', 320),
    'haystack1': ('hay', 91, None, 200),
    'alien_tree1': ('alien', 301, None, 560), 'alien_tree2': ('alien', 302, None, 560),
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    os.makedirs(mt.OUT, exist_ok=True)
    for name in (argv or list(SPRITES)):
        kind, seed, sub, px = SPRITES[name]
        k = K if kind != 'alien' else min(K, 3)                 # грибы и так крупные: ×3 хватает
        if kind == 'tree':
            mt.tree_sprite(name, seed, sub, px=px * k)
        elif kind == 'hay':
            mt.haystack_sprite(name, seed, px=px * k)
        else:
            mt.alien_mushroom(name, seed, px=px * k)
        print('SPRITE', name, px * k, flush=True)


main()
