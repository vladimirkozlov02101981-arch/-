"""Native 4x ground proof; production textures and renderer remain untouched.

python dev/blender/render_ground_sharp.py --prepare
blender -b --python dev/blender/render_ground_sharp.py
python dev/blender/render_ground_sharp.py --previews

The rock silhouettes come from the periodic dirt_stones meshes. Photo maps
only supply their material. The preview matches the existing ground palette
with a global channel transform, without sharpening or noise overlays.
"""
from pathlib import Path
import importlib.util
import json
import os
import random
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / 'test-results' / 'ground-sharp'
PBR = ROOT / 'dev' / 'pbr'
SCENE = HERE / 'scenes' / 'sharp_ground.blend'
PERIOD = 512
SCALE = 4


def find(asset, kind):
    files = sorted((PBR / asset).glob(asset + '_' + kind + '_*'))
    if not files:
        raise FileNotFoundError(asset + '/' + kind)
    return files[-1]


def prepare():
    """Decode the 8k sources once, leaving only bounded PNG maps for Blender."""
    from PIL import Image
    target = OUT / 'maps'
    target.mkdir(parents=True, exist_ok=True)
    for role, asset in [('soil', 'forest_ground_06'), ('stone', 'granite_tile_04')]:
        for kind in ['diff', 'rough', 'disp']:
            original = find(asset, kind)
            im = Image.open(original)
            if role == 'stone':
                # One photographed tile interior: exclude the manufactured joints.
                im = im.crop((1000, 320, 1800, 1350))
            else:
                im = im.resize((4096, 4096), Image.Resampling.LANCZOS)
            im.save(target / (role + '_' + kind + '.png'))
            print('PREPARED', role, kind, im.size, flush=True)


def previews():
    from PIL import Image, ImageDraw, ImageFont
    import numpy as np
    raw = Image.open(OUT / 'ground-raw.png').convert('RGB')
    a = np.asarray(raw, dtype=np.float32)
    reference = Image.open(ROOT / 'assets' / 'tex' / 'dirt_valley.png').convert('RGB')
    b = np.asarray(reference, dtype=np.float32)
    ra = np.percentile(a.reshape(-1, 3), [10, 50, 90], axis=0)
    rb = np.percentile(b.reshape(-1, 3), [10, 50, 90], axis=0)
    gain = (rb[2] - rb[0]) / np.maximum(ra[2] - ra[0], 1)
    offset = rb[1] - gain * ra[1]
    candidate = Image.fromarray(np.clip(a * gain + offset, 0, 255).round().astype('uint8'))
    candidate.save(OUT / 'ground-palette.png')
    overview = candidate.copy()
    overview.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    overview.save(OUT / 'ground-overview.png')
    # Same 128-world-unit footprint at the user's maximum 6.35x zoom.
    old_hi = Image.open(ROOT / 'test-results' / 'ref-ground' / 'dirt_valley-2x.png').convert('RGB')
    crop_world = (152, 152, 280, 280)
    new_crop = candidate.crop(tuple(v * SCALE for v in crop_world))
    old_crop = old_hi.crop(tuple(v * 2 for v in crop_world))
    px = round(128 * 6.35)
    panel = Image.new('RGB', (px * 2, px + 40), (25, 25, 25))
    panel.paste(old_crop.resize((px, px), Image.Resampling.BILINEAR), (0, 40))
    panel.paste(new_crop.resize((px, px), Image.Resampling.BILINEAR), (px, 40))
    draw = ImageDraw.Draw(panel)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 19)
    draw.text((12, 10), 'Эталонный исходник ×2, увеличение 6.35×', fill='white', font=font)
    draw.text((px + 12, 10), 'Blender: реальная геометрия ×4, увеличение 6.35×', fill='white', font=font)
    panel.save(OUT / 'compare-zoom635.png')
    new_crop.save(OUT / 'ground-native-crop.png')
    # A single global transform is baked into the preview; the raw render is retained.
    report_path = OUT / 'report.json'
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    report.update({
        'palette_gain': gain.tolist(), 'palette_offset': offset.tolist(),
        'raw_mean_rgb': a.mean((0, 1)).tolist(),
        'candidate_mean_rgb': np.asarray(candidate).mean((0, 1)).tolist(),
        'reference_mean_rgb': b.mean((0, 1)).tolist(),
        'sharpness_processing': 'none; native render and one global palette transform',
    })
    report_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('PREVIEWS', OUT, flush=True)


def material(bpy, role):
    m = bpy.data.materials.new('PBR_' + role)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Specular IOR Level'].default_value = 0.2
    coord = nodes.new('ShaderNodeTexCoord')
    scale = nodes.new('ShaderNodeVectorMath')
    scale.operation = 'MULTIPLY'
    repeats = 2 / (PERIOD / 100) if role == 'soil' else 3.0
    scale.inputs[1].default_value = (repeats, repeats, repeats)
    links.new(coord.outputs['Object'], scale.inputs[0])

    def photo(kind, non_color=False):
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(OUT / 'maps' / (role + '_' + kind + '.png')))
        if non_color:
            texture.image.colorspace_settings.name = 'Non-Color'
        texture.projection = 'BOX'
        texture.projection_blend = 0.25
        texture.interpolation = 'Linear'
        links.new(scale.outputs['Vector'], texture.inputs['Vector'])
        texture.image.pack()
        return texture

    diffuse = photo('diff')
    links.new(diffuse.outputs['Color'], bsdf.inputs['Base Color'])
    rough = photo('rough', True)
    links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
    height = photo('disp', True)
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.35 if role == 'soil' else 0.3
    bump.inputs['Distance'].default_value = 0.002 if role == 'soil' else 0.0015
    links.new(height.outputs['Color'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def ground_scene(source):
    """The dirt_stones seed/layout, with bounded ground grid and 10x less grit.

    Large rocks consume the same RNG sequence as make_textures.dirt_stones.
    Only the small pebble count is reduced: photo PBR already supplies grain.
    """
    import bmesh
    import bpy
    import numpy as np
    import mathutils
    print('STAGE reset/device', flush=True)
    scene = source.reset()
    rng = random.Random(11)
    density = 2.0
    print('STAGE soil', flush=True)
    n = 256
    clod = source.fft_noise(n, 0.8, 18)
    height = source.fft_noise(n, 1.5, 11) * 0.5 + source.fft_noise(n, 1.0, 12) * 0.3 + clod * 0.2
    tone = source.fft_noise(n, 1.6, 13)
    grit = source.fft_noise(n, 0.3, 14)
    dark = np.array((0.50, 0.35, 0.22))
    light = np.array((0.37, 0.25, 0.155))
    t = np.clip(tone * 0.9 + grit * 0.3 - 0.15, 0, 1)[..., None]
    colors = (dark * (1 - t) + light * t) * (0.8 + 0.4 * grit + 0.25 * (clod - 0.5))[..., None]
    source.height_plane('dirt', height, 0.09, np.clip(colors, 0, 1) ** 2.2)
    bpy.data.objects['dirt'].data.materials.append(source.mat_vertex_color('dirt', rough=0.97, spec=0.15))
    stone = source.mat_stone('stone', (0.46, 0.45, 0.43), (0.74, 0.73, 0.70), rough=0.8, spec=0.25,
                             scale=5, bumpk=1.2, moss=0.2, moss_col=(0.50, 0.50, 0.36), detail=0.55)
    count = int(190 * density)
    print('STAGE rocks', count, flush=True)
    for i in range(count):
        q = rng.random()
        r = 0.025 + 0.035 * q if q < 0.5 else (0.06 + 0.07 * rng.random() if q < 0.9 else 0.13 + 0.12 * rng.random())
        sz = rng.uniform(0.6, 0.95)
        mesh = source.rock_mesh('rock%d' % i, r, rng.uniform(0.9, 1.4), rng.uniform(0.75, 1.05), sz,
                               rng.random() * 100, rough=0.2, sub=5 if r > 0.1 else 4,
                               facets=rng.randint(2, 6))
        source.place(mesh, stone, rng.uniform(-source.S / 2, source.S / 2), rng.uniform(-source.S / 2, source.S / 2),
                     0.045 - r * sz * rng.uniform(0.1, 0.5), (0, 0, rng.uniform(0, 6.28)),
                     rng.uniform(-0.3, 0.3), 'rock')
    # The legacy growing-bmesh loop becomes expensive at 20k grains. Keep 2k
    # actual pebbles here; the 380 primary rock meshes remain unchanged.
    pebble_count = int(source.S * source.S * 40 * density)
    print('STAGE pebbles', pebble_count, flush=True)
    bm = bmesh.new()
    for i in range(pebble_count):
        r = rng.uniform(0.004, 0.016) * (1.8 if rng.random() < 0.15 else 1)
        transform = mathutils.Matrix.Translation((rng.uniform(-source.S / 2, source.S / 2),
                     rng.uniform(-source.S / 2, source.S / 2), 0.03 + rng.uniform(0, 0.03))) @ \
                     mathutils.Matrix.Diagonal((r * rng.uniform(1.0, 1.5), r * rng.uniform(0.8, 1.1), r * 0.7, 1))
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1, matrix=transform)
    mesh = bpy.data.meshes.new('pebbles')
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(stone)
    obj = bpy.data.objects.new('pebbles', mesh)
    obj['tone'] = 0.0
    scene.collection.objects.link(obj)
    print('STAGE geometry complete', flush=True)
    return scene


def render():
    import bpy
    os.environ['TEX_SCALE'] = '1'
    spec = importlib.util.spec_from_file_location('ground_source', HERE / 'make_textures.py')
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    source.PX = PERIOD
    source.S = PERIOD / 100
    original_rock = source.rock_mesh

    def bounded_rock(name, r, sx, sy, sz, seed, rough=0.28, sub=4, facets=0):
        return original_rock(name, r, sx, sy, sz, seed, rough=rough,
                             sub=min(sub, 4 if r > 0.1 else 3), facets=facets)

    source.rock_mesh = bounded_rock

    def proof(scene, name):
        print('STAGE packed PBR materials', flush=True)
        soil = material(bpy, 'soil')
        stone = material(bpy, 'stone')
        for obj in scene.objects:
            if obj.type != 'MESH':
                continue
            obj.data.materials.clear()
            obj.data.materials.append(soil if obj.name.startswith('dirt') else stone)
        # Limit OptiX to the actual GPU; source.reset also permits a CPU device.
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for device in prefs.devices:
            device.use = device.type == prefs.compute_device_type
        scene.render.resolution_x = scene.render.resolution_y = PERIOD * SCALE
        scene.render.resolution_percentage = 100
        scene.cycles.samples = 96
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.015
        scene.cycles.adaptive_min_samples = 32
        scene.cycles.use_denoising = True
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGB'
        scene.render.image_settings.color_depth = '8'
        scene.render.filepath = str(OUT / 'ground-raw.png')
        meshes = {o.data for o in scene.objects if o.type == 'MESH'}
        vertices = sum(len(me.vertices) for me in meshes)
        report = {
            'period_world_units': PERIOD, 'native_texels_per_world_unit': SCALE,
            'render_pixels': PERIOD * SCALE, 'unique_mesh_vertices': vertices,
            'mesh_objects': sum(o.type == 'MESH' for o in scene.objects),
            'samples': scene.cycles.samples, 'device': scene.cycles.device,
            'gpu_backend': prefs.compute_device_type,
            'gpu_devices': [d.name for d in prefs.devices if d.use],
            'geometry': 'dirt_stones seed11, density2, periodic real half-buried rock meshes',
            'pebble_density_per_m2': 40,
            'materials': {'soil': 'forest_ground_06', 'stone': 'granite_tile_04 interior'},
            'scene': str(SCENE), 'output': str(OUT / 'ground-raw.png'),
        }
        if vertices >= 1000000:
            raise RuntimeError('Prototype vertex budget exceeded: ' + str(vertices))
        OUT.mkdir(parents=True, exist_ok=True)
        SCENE.parent.mkdir(parents=True, exist_ok=True)
        (OUT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        bpy.ops.wm.save_as_mainfile(filepath=str(SCENE))
        print('GROUND_PROOF', json.dumps(report), flush=True)
        bpy.ops.render.render(write_still=True)
        print('GROUND_RENDER_COMPLETE', scene.render.filepath, flush=True)

    proof(ground_scene(source), 'dirt_valley')


if __name__ == '__main__':
    if '--prepare' in sys.argv:
        prepare()
    elif '--previews' in sys.argv:
        previews()
    else:
        render()
