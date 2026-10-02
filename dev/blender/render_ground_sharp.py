"""Native 4x ground proof v3; production textures and renderer remain untouched.

python dev/blender/render_ground_sharp.py --prepare
blender -b --python dev/blender/render_ground_sharp.py
python dev/blender/render_ground_sharp.py --previews

v2 (cropfix-v2, test-results/ground-sharp/cropfix-v2/) had sharp but rounded,
uniform granite pebbles with cold blue shadows on flat soil. v3 keeps the
dirt_stones seed-11 layout (positions/sizes of the 380 primary rocks) and
changes what the critic asked for:
- real chipped facets: plane cuts (bisect + fill) give flat faces with hard
  normal discontinuities, plus occasional bedding ledges (layered rock);
- rocks sit deeper in the soil, relative to the local soil height;
- three photographed rock materials per object (granite interior, weathered
  granite block interior, dark basalt fragment) with per-object tone;
- soil from forest_ground_05 (fine crumbly soil without acorns), broader
  physical relief;
- dense gravel through Geometry Nodes instancing (thousands of grains);
- warm soft fill instead of the blue sky fill.
Photo maps only supply material; silhouettes come from geometry. The preview
matches the existing ground palette with one global channel transform,
without sharpening or noise overlays.
"""
from pathlib import Path
import importlib.util
import json
import math
import os
import random
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / 'test-results' / 'ground-sharp' / 'v3'
PBR = ROOT / 'dev' / 'pbr'
SCENE = HERE / 'scenes' / 'sharp_ground_v3.blend'
PERIOD = 512
SCALE = 4
# фото-источники: (роль, ассет, кроп в пикселях 8k-оригинала или None — весь кадр, уменьшенный до 4096)
SOURCES = [
    ('soil', 'forest_ground_05', None),
    ('granite', 'granite_tile_04', (1000, 320, 1800, 1350)),           # одна плита без заводских швов
    ('weathered', 'stone_brick_wall_001', (3000, 2950, 4400, 4300)),   # середина одного блока, без швов кладки
    ('basalt', 'volcanic_rock_tiles', (3640, 4160, 3990, 4500)),       # один тёмный обломок без раствора
]
ROCK_MATS = [('granite', 0.45), ('weathered', 0.35), ('basalt', 0.20)]
try:
    STATS = json.loads((OUT / 'maps' / 'stats.json').read_text())
except Exception:
    STATS = {}
# свет: (r, g, b, сила). Слишком тёплые солнце и заполнение окрашивали всё в оранжевый (насыщенность ~0.7) —
# серые камни эталона нейтральны, поэтому солнце лишь слегка тёплое, заполнение почти нейтральное и мягкое
SUN = (1.0, 0.94, 0.86, 4.2)
FILL = (0.68, 0.66, 0.62, 0.62)


def find(asset, kind):
    files = sorted((PBR / asset).glob(asset + '_' + kind + '_*'))
    if not files:
        raise FileNotFoundError(asset + '/' + kind)
    return files[-1]


def prepare():
    """Decode the 8k sources once, leaving only bounded PNG maps for Blender."""
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    target = OUT / 'maps'
    target.mkdir(parents=True, exist_ok=True)
    stats = {}
    for role, asset, crop in SOURCES:
        for kind in ['diff', 'rough', 'disp']:
            im = Image.open(find(asset, kind))
            im = im.crop(crop) if crop else im.resize((4096, 4096), Image.Resampling.LANCZOS)
            im.save(target / (role + '_' + kind + '.png'))
            print('PREPARED', role, kind, im.size, flush=True)
            if kind == 'diff':
                import numpy as np
                lin = (np.asarray(im.convert('RGB'), dtype=np.float32) / 255) ** 2.2
                stats[role] = {'median_linear': float(np.median(lin @ np.array([0.2126, 0.7152, 0.0722])))}
    (target / 'stats.json').write_text(json.dumps(stats, indent=2))


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
    # 2×2 плитки периода 512 на масштабе обзора — проверка повторов и стыков
    tile = candidate.resize((PERIOD, PERIOD), Image.Resampling.BOX)
    quad = Image.new('RGB', (PERIOD * 2, PERIOD * 2))
    for i in range(2):
        for j in range(2):
            quad.paste(tile, (i * PERIOD, j * PERIOD))
    quad.save(OUT / 'ground-tile2x2.png')
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 19)
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
    draw.text((12, 10), 'Эталонный исходник ×2, увеличение 6.35×', fill='white', font=font)
    draw.text((px + 12, 10), 'Blender v3: реальная геометрия ×4, увеличение 6.35×', fill='white', font=font)
    panel.save(OUT / 'compare-zoom635.png')
    new_crop.save(OUT / 'ground-native-crop.png')
    # эталонная картина (valley_tower, участок почвы) рядом с кандидатом того же видимого масштаба 2.5×
    ref = Image.open(ROOT / 'dev' / 'reference' / 'valley_tower.png').convert('RGB').crop((900, 780, 1300, 990))
    ref = ref.resize((ref.width * 2, ref.height * 2), Image.Resampling.LANCZOS)
    cw = round(ref.width / 2.5 * SCALE / 2.5 * 2.5) // 1
    cand = candidate.crop((0, 0, round(ref.width / 2.5 * SCALE), round(ref.height / 2.5 * SCALE))).resize(ref.size, Image.Resampling.BILINEAR)
    sheet = Image.new('RGB', (ref.width, ref.height * 2 + 60), (25, 25, 25))
    sheet.paste(ref, (0, 30)); sheet.paste(cand, (0, ref.height + 60))
    draw = ImageDraw.Draw(sheet)
    draw.text((10, 6), 'Эталон valley_tower: почва и камни', fill='white', font=font)
    draw.text((10, ref.height + 36), 'Blender v3 (палитра подогнана одной функцией), тот же экранный масштаб', fill='white', font=font)
    sheet.save(OUT / 'compare-reference.png')
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


# цветокоррекция фото на материал: насыщенность и яркость (HSV), контраст, линейный множитель RGB.
# Подобрана замером по маске почва/камень (dev/tools/ground_palette.py) к принятому грунту долины
GRADE = {
    'soil': {'sat': 0.60, 'val': 0.74, 'contrast': 0.0, 'tint': (1.0, 0.95, 0.95)},   # контраст по каналам повышал насыщенность — рельеф почвы даёт геометрия
    'rock': {'sat': 0.30, 'val': 1.60, 'contrast': 0.10, 'tint': (1.0, 1.0, 1.03)},
}


def photo_material(bpy, role, repeats, bump_strength, bump_distance, tone=False, grade=None):
    """фото-материал: diffuse/roughness/height→bump; grade — цветокоррекция; tone — случайный оттенок и яркость на объект"""
    m = bpy.data.materials.new('PBR_' + role)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Specular IOR Level'].default_value = 0.2
    coord = nodes.new('ShaderNodeTexCoord')
    scale = nodes.new('ShaderNodeVectorMath')
    scale.operation = 'MULTIPLY'
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
    color = diffuse.outputs['Color']
    by = lambda coll, ident: next(s for s in coll if s.identifier == ident)
    if grade:
        hsv = nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Saturation'].default_value = grade['sat']
        hsv.inputs['Value'].default_value = grade['val']
        links.new(color, hsv.inputs['Color'])
        # контраст вокруг средней яркости фото (а не вокруг 0.5, как Bright/Contrast, — тот гасит тёмное альбедо в ноль):
        # out = c^g · p^(1−g), p — медиана линейной яркости этой карты
        g = 1 + grade['contrast']
        gam = nodes.new('ShaderNodeGamma')
        gam.inputs['Gamma'].default_value = g
        links.new(hsv.outputs['Color'], gam.inputs['Color'])
        pivot = STATS.get(role, {}).get('median_linear', 0.1) * grade['val']
        comp = nodes.new('ShaderNodeMix')
        comp.data_type = 'RGBA'
        comp.blend_type = 'MULTIPLY'
        by(comp.inputs, 'Factor_Float').default_value = 1.0
        links.new(gam.outputs['Color'], by(comp.inputs, 'A_Color'))
        k = pivot ** (1 - g)
        by(comp.inputs, 'B_Color').default_value = (k, k, k, 1)
        bc = comp
        tint = nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.blend_type = 'MULTIPLY'
        by(tint.inputs, 'Factor_Float').default_value = 1.0
        links.new(by(bc.outputs, 'Result_Color'), by(tint.inputs, 'A_Color'))
        by(tint.inputs, 'B_Color').default_value = tuple(grade['tint']) + (1,)
        color = by(tint.outputs, 'Result_Color')
    if tone:
        # оттенок на объект: яркость 0.72…1.12 и лёгкий сдвиг тепла — камни не одинаковые
        info = nodes.new('ShaderNodeObjectInfo')
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (0.78, 0.78, 0.77, 1)
        ramp.color_ramp.elements[1].color = (1.0, 0.98, 0.95, 1)
        links.new(info.outputs['Random'], ramp.inputs['Fac'])
        mul = nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        by(mul.inputs, 'Factor_Float').default_value = 1.0
        links.new(color, by(mul.inputs, 'A_Color'))
        links.new(ramp.outputs['Color'], by(mul.inputs, 'B_Color'))
        color = by(mul.outputs, 'Result_Color')
    links.new(color, bsdf.inputs['Base Color'])
    rough = photo('rough', True)
    links.new(rough.outputs['Color'], bsdf.inputs['Roughness'])
    height = photo('disp', True)
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = bump_strength
    bump.inputs['Distance'].default_value = bump_distance
    links.new(height.outputs['Color'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def chipped_rock(bpy, bmesh, noise, Vector, name, r, sx, sy, sz, seed, sub, family):
    """обломок с настоящими сколами: икосфера с шумом, слоистый уступ по плоскости напластования,
    плоские срезы (bisect + заливка) — у граней скола резкий разрыв нормалей"""
    rr = random.Random(int(seed * 1000) + 101)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    rough = 0.16 if family == 'boulder' else 0.10
    for v in bm.verts:
        p = v.co.normalized()
        d = 1 + rough * noise.noise(p * 1.6 + off) + rough * 0.4 * noise.noise(p * 4.0 + off) + 0.03 * noise.noise(p * 11.0 + off)
        v.co = p * d
    if family == 'fragment' and rr.random() < 0.6:
        # напластование: верх над плоскостью слоя осаживается — получается уступ-полка
        bed = Vector((rr.uniform(-0.35, 0.35), rr.uniform(-0.35, 0.35), 1)).normalized()
        at, step = rr.uniform(-0.15, 0.45), rr.uniform(0.05, 0.12)
        for v in bm.verts:
            s = v.co.dot(bed)
            if s > at:
                v.co -= bed * min(step, (s - at) * 0.9)
    cuts = rr.randint(4, 7) if family == 'fragment' else rr.randint(1, 3)
    for _ in range(cuts):
        nrm = Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-0.25, 1))).normalized()
        dist = rr.uniform(0.55, 0.82) if family == 'fragment' else rr.uniform(0.7, 0.9)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=nrm * dist, plane_no=nrm, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge) and e.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    for v in bm.verts:
        v.co = Vector((v.co.x * r * sx, v.co.y * r * sy, v.co.z * r * sz))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.set_sharp_from_angle(angle=math.radians(36 if family == 'fragment' else 52))
    return me


def gravel(bpy, rng, source, Hs, amp, mats):
    """плотная крошка и галька: точки с атрибутами (вариант, масштаб, поворот) + Geometry Nodes instancing.
    У краёв плитки точки повторяются со сдвигом на период — плитка остаётся бесшовной."""
    import bmesh
    from mathutils import noise
    from mathutils import Vector
    S = source.S
    coll = bpy.data.collections.new('gravel_src')   # не в сцене: только источник копий
    variants = []
    for i in range(9):
        role = mats[i % len(mats)]
        me = chipped_rock(bpy, bmesh, noise, Vector, 'grain%d' % i, 1.0, rng.uniform(1.0, 1.45), rng.uniform(0.8, 1.1),
                          rng.uniform(0.55, 0.85), rng.random() * 100, 2, 'fragment' if i % 3 else 'boulder')
        me.materials.append(bpy.data.materials['PBR_' + role])
        ob = bpy.data.objects.new('grain%d' % i, me)
        coll.objects.link(ob)
        variants.append(ob)
    pts, var, scl, rot = [], [], [], []
    n = Hs.shape[0]

    def soil_z(x, y):
        # height_plane: H[i, j] — высота в точке x = i, y = j
        i = int(((x / S) + 0.5) * n) % n
        j = int(((y / S) + 0.5) * n) % n
        return Hs[i, j] * amp

    def add(x, y, r, depth):
        z = soil_z(x, y) - r * depth
        k = rng.randrange(len(variants))
        sc = (r, r, r)
        ro = (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, 6.283))
        for dx in (-S, 0, S):
            for dy in (-S, 0, S):
                px, py = x + dx, y + dy
                if abs(px) - r > S / 2 or abs(py) - r > S / 2:
                    continue
                pts.append((px, py, z)); var.append(k); scl.append(sc); rot.append(ro)

    for _ in range(1300):                     # галька 2.4…9 px
        add(rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), rng.uniform(0.012, 0.045) * (1.25 if rng.random() < 0.12 else 1), rng.uniform(0.2, 0.55))
    for _ in range(7000):                     # крошка 0.8…2.4 px
        add(rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), rng.uniform(0.004, 0.012), rng.uniform(0.1, 0.5))
    me = bpy.data.meshes.new('gravel_pts')
    me.from_pydata(pts, [], [])
    a_var = me.attributes.new('variant', 'INT', 'POINT'); a_var.data.foreach_set('value', var)
    a_scl = me.attributes.new('gscale', 'FLOAT_VECTOR', 'POINT'); a_scl.data.foreach_set('vector', [c for s in scl for c in s])
    a_rot = me.attributes.new('grot', 'FLOAT_VECTOR', 'POINT'); a_rot.data.foreach_set('vector', [c for s in rot for c in s])
    ob = bpy.data.objects.new('gravel', me)
    bpy.context.scene.collection.objects.link(ob)
    ng = bpy.data.node_groups.new('gravel_inst', 'GeometryNodeTree')
    ng.interface.new_socket(name='Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket(name='Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, L = ng.nodes, ng.links
    gin, gout = N.new('NodeGroupInput'), N.new('NodeGroupOutput')
    info = N.new('GeometryNodeCollectionInfo')
    info.inputs['Collection'].default_value = coll
    info.inputs['Separate Children'].default_value = True
    info.inputs['Reset Children'].default_value = True
    inst = N.new('GeometryNodeInstanceOnPoints')
    inst.inputs['Pick Instance'].default_value = True
    av = N.new('GeometryNodeInputNamedAttribute'); av.data_type = 'INT'; av.inputs['Name'].default_value = 'variant'
    asc = N.new('GeometryNodeInputNamedAttribute'); asc.data_type = 'FLOAT_VECTOR'; asc.inputs['Name'].default_value = 'gscale'
    aro = N.new('GeometryNodeInputNamedAttribute'); aro.data_type = 'FLOAT_VECTOR'; aro.inputs['Name'].default_value = 'grot'
    e2r = N.new('FunctionNodeEulerToRotation')
    L.new(gin.outputs[0], inst.inputs['Points'])
    L.new(info.outputs['Instances'], inst.inputs['Instance'])
    L.new(av.outputs['Attribute'], inst.inputs['Instance Index'])
    L.new(asc.outputs['Attribute'], inst.inputs['Scale'])
    L.new(aro.outputs['Attribute'], e2r.inputs['Euler'])
    L.new(e2r.outputs['Rotation'], inst.inputs['Rotation'])
    L.new(inst.outputs['Instances'], gout.inputs[0])
    mod = ob.modifiers.new('gravel', 'NODES')
    mod.node_group = ng
    return len(pts)


def ground_scene(source):
    """dirt_stones seed 11: те же положения и размеры 380 основных камней (тот же порядок вызовов RNG);
    новые параметры (материал, сколы) берутся из отдельного RNG, чтобы раскладка не изменилась"""
    import bmesh
    import bpy
    from mathutils import noise
    import numpy as np
    from mathutils import Vector
    print('STAGE reset/device', flush=True)
    scene = source.reset()
    rng = random.Random(11)
    rng2 = random.Random(1011)
    density = 2.0
    print('STAGE soil', flush=True)
    n = 256
    clod = source.fft_noise(n, 0.8, 18)
    broad = source.fft_noise(n, 2.4, 19)                 # широкий физический рельеф грунта
    height = source.fft_noise(n, 1.5, 11) * 0.38 + source.fft_noise(n, 1.0, 12) * 0.22 + clod * 0.15 + broad * 0.25
    amp = 0.16
    source.height_plane('dirt', height, amp, np.full((n, n, 3), 0.3))
    print('STAGE materials', flush=True)
    soil = photo_material(bpy, 'soil', 2 / (PERIOD / 100), 1.4, 0.006, grade=GRADE['soil'])
    mats = {}
    for role, _ in ROCK_MATS:
        mats[role] = photo_material(bpy, role, 3.0 if role != 'basalt' else 6.0, 0.45, 0.002, tone=True, grade=GRADE['rock'])
    bpy.data.objects['dirt'].data.materials.append(soil)
    count = int(190 * density)
    print('STAGE rocks', count, flush=True)
    hz = height                                           # height_plane: H[i, j] — высота в точке x = i, y = j
    for i in range(count):
        q = rng.random()
        r = 0.025 + 0.035 * q if q < 0.5 else (0.06 + 0.07 * rng.random() if q < 0.9 else 0.13 + 0.12 * rng.random())
        sz = rng.uniform(0.6, 0.95)
        sx, sy = rng.uniform(0.9, 1.4), rng.uniform(0.75, 1.05)
        seed = rng.random() * 100
        rng.randint(2, 6)                                  # прежнее число граней — только чтобы не сдвинуть RNG
        x, y = rng.uniform(-source.S / 2, source.S / 2), rng.uniform(-source.S / 2, source.S / 2)
        rng.uniform(0.1, 0.5)                              # прежняя глубина — RNG
        rot = (0, 0, rng.uniform(0, 6.28))
        tone = rng.uniform(-0.3, 0.3)
        family = 'boulder' if r > 0.13 and rng2.random() < 0.55 else 'fragment'
        pick, acc = rng2.random(), 0.0
        for role, w in ROCK_MATS:
            acc += w
            if pick <= acc:
                break
        me = chipped_rock(bpy, bmesh, noise, Vector, 'rock%d' % i, r, sx, sy, sz, seed,
                          4 if r > 0.1 else 3, family)
        # глубже в грунт относительно его местной высоты: от трети до трёх четвертей высоты камня
        gi = int(((x / source.S) + 0.5) * n) % n
        gj = int(((y / source.S) + 0.5) * n) % n
        z = hz[gi, gj] * amp - r * sz * rng2.uniform(0.3, 0.75)
        tilt = (rng2.uniform(-0.25, 0.25), rng2.uniform(-0.25, 0.25), rot[2])
        source.place(me, mats[role], x, y, z, tilt, tone, 'rock')
    print('STAGE gravel', flush=True)
    grains = gravel(bpy, rng2, source, hz, amp, [r for r, _ in ROCK_MATS])
    print('STAGE geometry complete', grains, 'gravel instances', flush=True)
    return scene, grains


def warm_light(bpy, scene):
    """тёплое низкое солнце сверху слева (как у текстур карт) и мягкий тёплый заполняющий свет вместо голубого неба"""
    world = scene.world
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = FILL[:3] + (1,)
    bg.inputs[1].default_value = FILL[3]
    sun = bpy.data.objects['sun']
    sun.data.energy = SUN[3]
    sun.data.angle = math.radians(4.0)
    sun.data.color = SUN[:3]


def render():
    import bpy
    os.environ['TEX_SCALE'] = '1'
    spec = importlib.util.spec_from_file_location('ground_source', HERE / 'make_textures.py')
    source = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source)
    source.PX = PERIOD
    source.S = PERIOD / 100
    scene, grains = ground_scene(source)
    warm_light(bpy, scene)
    # Limit OptiX to the actual GPU; source.reset also permits a CPU device.
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for device in prefs.devices:
        device.use = device.type == prefs.compute_device_type
    scene.render.resolution_x = scene.render.resolution_y = PERIOD * SCALE
    fast = bool(os.environ.get('GROUND_FAST'))             # быстрый прогон для подгонки палитры: половина разрешения
    scene.render.resolution_percentage = 50 if fast else 100
    scene.cycles.samples = 32 if fast else 96
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.015
    scene.cycles.adaptive_min_samples = 32
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    OUT.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(OUT / 'ground-raw.png')
    meshes = {o.data for o in scene.objects if o.type == 'MESH'}
    vertices = sum(len(me.vertices) for me in meshes)
    report = {
        'version': 3, 'period_world_units': PERIOD, 'native_texels_per_world_unit': SCALE,
        'render_pixels': PERIOD * SCALE, 'unique_mesh_vertices': vertices,
        'mesh_objects': sum(o.type == 'MESH' for o in scene.objects), 'gravel_instances': grains,
        'samples': scene.cycles.samples, 'device': scene.cycles.device,
        'gpu_backend': prefs.compute_device_type,
        'gpu_devices': [d.name for d in prefs.devices if d.use],
        'geometry': 'dirt_stones seed11 layout, density2; chipped facets (bisect+fill), bedding ledges, deeper burial; GN gravel',
        'materials': {'soil': 'forest_ground_05', 'rocks': {r: w for r, w in ROCK_MATS}},
        'light': {'sun': SUN, 'fill': FILL, 'sun_angle_deg': 4.0}, 'grade': GRADE, 'fast': fast,
        'scene': str(SCENE), 'output': str(OUT / 'ground-raw.png'),
    }
    if vertices >= 1500000:
        raise RuntimeError('Prototype vertex budget exceeded: ' + str(vertices))
    SCENE.parent.mkdir(parents=True, exist_ok=True)
    (OUT / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    bpy.ops.wm.save_as_mainfile(filepath=str(SCENE))
    print('GROUND_PROOF', json.dumps(report), flush=True)
    bpy.ops.render.render(write_still=True)
    print('GROUND_RENDER_COMPLETE', scene.render.filepath, flush=True)


if __name__ == '__main__':
    if '--prepare' in sys.argv:
        prepare()
    elif '--previews' in sys.argv:
        previews()
    else:
        render()
