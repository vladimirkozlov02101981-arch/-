"""
Рендер бесшовной текстуры карты из фотоскан-материала (Poly Haven, CC0) с настоящим рельефом.
Плоскость с микрорельефом из карты высот (модификатор Displace по плотной сетке), шероховатость и нормали из скана,
свет как в игре (низкое солнце сверху слева + небо). Камера сверху ровно на одну плитку → результат бесшовный.

Запуск (на ПК с Blender и видеокартой):
  blender -b --python dev/blender/render_pbr.py -- <цель> [пикселей=2048] [метров_на_плитку=10.24] [повторов_скана=0]
  цели — ключи dev/pbr/catalog.json (canyon_sandstone, arctic_granite, ...), берётся первый скан.
  Результат: dev/pbr_out/<цель>.webp  (+ сцена dev/blender/scenes/pbr_<цель>.blend, чтобы открыть в Blender)
"""
import bpy, os, sys, json, math, glob
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PBR = os.path.join(HERE, '..', 'pbr'); OUT = os.path.join(HERE, '..', 'pbr_out'); SCN = os.path.join(HERE, 'scenes')

def find(asset, kind):
    f = sorted(glob.glob(os.path.join(PBR, asset, '%s_%s_*' % (asset, kind))))
    return f[-1] if f else None

def gpu(sc):
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                pr.compute_device_type = kind; pr.get_devices()
                if any(d.type == kind for d in pr.devices):
                    for d in pr.devices: d.use = d.type == kind
                    sc.cycles.device = 'GPU'; print('GPU', kind); return
            except Exception: pass
    except Exception: pass

def build(asset, px, tile_m, reps):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; gpu(sc)
    sc.cycles.samples = 256; sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = px
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.quality = 95; sc.render.image_settings.color_mode = 'RGB'
    # плотная сетка: ~1 вершина на 2 пикселя результата
    n = px // 2
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=n, y_subdivisions=n, size=tile_m)
    pl = bpy.context.active_object
    m = bpy.data.materials.new('scan'); m.use_nodes = True; N = m.node_tree.nodes; L = m.node_tree.links; b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (reps, reps, 1)
    L.new(tc.outputs['UV'], mp.inputs['Vector'])
    def img(path, non_color):
        t = N.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(path); t.interpolation = 'Cubic'
        if non_color: t.image.colorspace_settings.name = 'Non-Color'
        L.new(mp.outputs['Vector'], t.inputs['Vector']); return t
    d = find(asset, 'diff'); r = find(asset, 'rough'); nm = find(asset, 'nor_gl'); hp = find(asset, 'disp')
    if d: L.new(img(d, False).outputs['Color'], b.inputs['Base Color'])
    if r: L.new(img(r, True).outputs['Color'], b.inputs['Roughness'])
    if nm:
        nt = N.new('ShaderNodeNormalMap'); L.new(img(nm, True).outputs['Color'], nt.inputs['Color']); L.new(nt.outputs['Normal'], b.inputs['Normal'])
    pl.data.materials.append(m)
    if hp:   # настоящий рельеф: тени от камней и трещин
        tex = bpy.data.textures.new('h', 'IMAGE'); tex.image = bpy.data.images.load(hp); tex.image.colorspace_settings.name = 'Non-Color'
        tex.repeat_x = tex.repeat_y = max(1, int(round(reps)))
        dm = pl.modifiers.new('d', 'DISPLACE'); dm.texture = tex; dm.texture_coords = 'UV'; dm.strength = tile_m / max(1, reps) * 0.06; dm.mid_level = 0.5
    for p in pl.data.polygons: p.use_smooth = True
    # камера сверху ровно на плитку
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = tile_m
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam; cam.location = (0, 0, 20); cd.clip_end = 100
    # свет игры: тёплое низкое солнце сверху слева, мягкое небо
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.72, 1.0, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 4.5; sd.angle = math.radians(1.5); sd.color = (1.0, 0.86, 0.68)
    sun = bpy.data.objects.new('sun', sd); sc.collection.objects.link(sun)
    e = math.radians(28); hz = Vector((0.55, -0.8, 0)).normalized()
    sun.rotation_euler = Vector((hz.x * math.cos(e), hz.y * math.cos(e), -math.sin(e))).to_track_quat('-Z', 'Y').to_euler()
    return sc

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    tgt = argv[0]; px = int(argv[1]) if len(argv) > 1 else 2048; tile_m = float(argv[2]) if len(argv) > 2 else 10.24
    cat = json.load(open(os.path.join(PBR, 'catalog.json'), encoding='utf-8'))
    asset = cat[tgt][0] if isinstance(cat[tgt], list) else cat[tgt]
    reps = float(argv[3]) if len(argv) > 3 and float(argv[3]) > 0 else max(1, round(tile_m / 2.5))
    sc = build(asset, px, tile_m, reps)
    os.makedirs(OUT, exist_ok=True); os.makedirs(SCN, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SCN, 'pbr_%s.blend' % tgt))
    sc.render.filepath = os.path.join(OUT, tgt + '.webp'); bpy.ops.render.render(write_still=True)
    print('WROTE', tgt, asset, px)

main()
