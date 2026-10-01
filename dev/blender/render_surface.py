"""Native fourfold vegetation renders without replacing the original low assets.

blender -b --python dev/blender/render_surface.py -- [grass_valley bush1 bush2]
"""
import importlib.util
from pathlib import Path
import os
import sys

here = Path(__file__).resolve().parent
os.environ['TEX_SCALE'] = '1'
spec = importlib.util.spec_from_file_location('surface_source', here / 'make_textures.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
source.OUT = str(here.parent.parent / 'assets' / 'tex' / 'surface')
original_render = source.render

def render_native(scene, name):
    scene.render.resolution_x *= 4
    scene.render.resolution_y *= 4
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 96
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.025
    print('SURFACE_NATIVE', name, scene.render.resolution_x, scene.render.resolution_y,
          'device', scene.cycles.device, flush=True)
    original_render(scene, name)

source.render = render_native
names = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['grass_valley', 'bush1', 'bush2']
for name in names:
    if name not in {'grass_valley', 'bush1', 'bush2'}:
        raise ValueError('Unsupported surface sprite: ' + name)
    source.LIB[name]()
