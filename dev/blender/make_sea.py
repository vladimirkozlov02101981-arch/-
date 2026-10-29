"""Поверхность моря для полосы у ватерлинии (тропики/пираты; критик r36: «вода плоская, σL 9,7 при эталоне 25+,
нет гребней и оранжевых отблесков заката»).

Океан Blender (модификатор Ocean, спектр JONSWAP) снимается ортокамерой под углом к воде. Кадр по ширине — ровно один
период океана (spatial_size), поэтому лента бесшовна по горизонтали; в игре (render.js, drawSeaBand) она кладётся
полосами с перспективой: дальние волны у борта мельче, ближние крупнее. Два прохода:
  assets/tex/sea_body.png  — вода с отражением закатного неба, без солнца;
  assets/tex/sea_glint.png — только солнечные блики (небо чёрное); в игре — «осветлением», ярче на дорожке под солнцем.

blender -b --python dev/blender/make_sea.py            (или python с bpy)
SEA_W/SEA_H — размер кадра, SEA_SAMPLES — выборки, SEA_OUT — папка, SEA_ONLY=body|glint — один проход.
"""
import math
import os
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
OUT = Path(os.environ.get('SEA_OUT', HERE.parent.parent / 'assets' / 'tex'))
W = int(os.environ.get('SEA_W', '3072'))
H = int(os.environ.get('SEA_H', '320'))
SAMPLES = int(os.environ.get('SEA_SAMPLES', '96'))
ONLY = os.environ.get('SEA_ONLY', '')
P = 40.0               # период океана, м (ширина кадра)
RES = int(os.environ.get('SEA_RES', '28'))   # сетка БПФ RES² по стороне: 28 → 784 узла на 40 м (5 см)
TILT = math.radians(13)   # угол взгляда к воде
SUN_EL = math.radians(4.5)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False          # без шумоподавления — блики не размываются
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.filter_width = 1.0              # узкий фильтр пикселя — чётко при увеличении
    sc.cycles.max_bounces = 4
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.film_transparent = False
    return sc


def ocean(glint=False):
    me = bpy.data.meshes.new('sea')
    me.from_pydata([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new('sea', me)
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('ocean', 'OCEAN')
    m.geometry_mode = 'GENERATE'
    m.spatial_size = int(P)
    m.repeat_x, m.repeat_y = 3, 1
    m.resolution = RES
    m.spectrum = 'JONSWAP'
    m.fetch_jonswap = 60.0
    m.sharpen_peak_jonswap = 0.4
    m.wind_velocity = float(os.environ.get('SEA_WIND', '4.0'))   # мелкая зыбь: ~20–30 гребней на период
    m.wave_scale = float(os.environ.get('SEA_SCALE', '1.0'))
    m.wave_scale_min = 0.01
    m.choppiness = float(os.environ.get('SEA_CHOP', '0.3'))   # без острых «шатров» на гребнях
    m.wave_alignment = float(os.environ.get('SEA_ALIGN', '0.9'))
    m.wave_direction = math.radians(90)      # гребни поперёк взгляда — в кадре горизонтальные
    m.damping = 0.4
    m.random_seed = 7
    m.time = 3.0
    m.use_normals = False                    # нормали — по итоговой сетке после ряби (гладкое затенение)
    # мелкая рябь поверх зыби: второй океан с периодом P/8 смещает ту же сетку (общий период остаётся P — шов не появляется);
    # без неё вода в увеличении — гладкие «шёлковые дюны» с тонкой каймой
    r = ob.modifiers.new('ripple', 'OCEAN')
    r.geometry_mode = 'DISPLACE'
    r.spatial_size = int(P) // 8
    r.resolution = max(8, RES // 2)
    r.spectrum = 'PHILLIPS'
    r.wind_velocity = float(os.environ.get('SEA_RIPPLE_WIND', '1.6'))
    r.wave_scale = float(os.environ.get('SEA_RIPPLE', '0.22'))
    r.wave_scale_min = 0.005
    r.choppiness = 0.6
    r.wave_alignment = 0.35
    r.wave_direction = math.radians(80)
    r.random_seed = 11
    r.time = 1.0
    r.use_normals = False
    mat = bpy.data.materials.new('water')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.004, 0.017, 0.02, 1)
    # толща воды: рассеянный изнутри бирюзовый свет (эталон: средняя полосы 30/53/57) — не зависит от цвета неба
    b.inputs['Emission Color'].default_value = (0.005, 0.034, 0.044, 1)
    b.inputs['Emission Strength'].default_value = 0.0 if glint else float(os.environ.get('SEA_BODY', '0.45'))   # в проходе бликов — только солнце
    b.inputs['Roughness'].default_value = float(os.environ.get('SEA_ROUGH', '0.16'))   # отражения неба пятнами, а не тонкой каймой
    b.inputs['IOR'].default_value = 1.333
    # отражённый луч, попавший в изнанку соседней волны, давал чёрные «дыры» с резкой кромкой: изнанка светится
    # средним цветом воды (как если бы луч отразился ещё раз)
    if os.environ.get('SEA_BACKFIX', '1') == '1':
        nt = mat.node_tree
        out = nt.nodes['Material Output']
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (0.02, 0.036, 0.036, 1) if not glint else (0, 0, 0, 1)
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
        nt.links.new(b.outputs['BSDF'], mix.inputs[1])
        nt.links.new(em.outputs['Emission'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    xs = [v.co.x for v in ev.data.vertices]
    ys = [v.co.y for v in ev.data.vertices]
    return ob, (min(xs), max(xs), min(ys), max(ys))


def camera(bounds):
    x0, x1, y0, y1 = bounds
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.sensor_fit = 'HORIZONTAL'
    cam.ortho_scale = P                       # ровно один период по ширине — бесшовно
    cam.clip_start, cam.clip_end = 0.1, 400
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.scene.collection.objects.link(ob)
    cx, cy, d = (x0 + x1) / 2, (y0 + y1) / 2, 60
    ob.location = (cx, cy - d * math.cos(TILT), d * math.sin(TILT))
    ob.rotation_euler = (math.pi / 2 - TILT, 0, 0)
    bpy.context.scene.camera = ob


def sky(glint):
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    if glint:
        bg.inputs['Color'].default_value = (0, 0, 0, 1)
        bg.inputs['Strength'].default_value = 0
        return
    s = nt.nodes.new('ShaderNodeTexSky')
    s.sky_type = 'SINGLE_SCATTERING'
    s.sun_disc = False
    s.sun_elevation = SUN_EL
    s.sun_rotation = 0.0
    s.air_density = 1.6                       # закат: больше рассеяния — оранжевее у горизонта
    s.aerosol_density = 2.2
    tint = nt.nodes.new('ShaderNodeMix')                      # закат оранжевее: эталонные отблески ~230/150/80
    tint.data_type = 'RGBA'
    tint.blend_type = 'MULTIPLY'
    tint.inputs['Factor'].default_value = 1.0
    tint.inputs[7].default_value = (1.0, 0.74, 0.5, 1)
    nt.links.new(s.outputs['Color'], tint.inputs[6])
    # ниже горизонта — даль моря, отражающая то же небо (луч, ушедший под горизонт, попал бы в дальнюю воду под скользящим
    # углом): небо по зеркальному направлению (x, y, |z|), чуть темнее. Прежняя «земля» неба давала на обращённых к
    # зрителю склонах тёмные пятна с резкой кромкой
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    az = nt.nodes.new('ShaderNodeMath')
    az.operation = 'ABSOLUTE'
    nt.links.new(sep.outputs['Z'], az.inputs[0])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs['X'], comb.inputs['X'])
    nt.links.new(sep.outputs['Y'], comb.inputs['Y'])
    nt.links.new(az.outputs[0], comb.inputs['Z'])
    nt.links.new(comb.outputs['Vector'], s.inputs['Vector'])
    dim = nt.nodes.new('ShaderNodeMapRange')
    dim.clamp = True
    nt.links.new(sep.outputs['Z'], dim.inputs['Value'])
    dim.inputs['From Min'].default_value, dim.inputs['From Max'].default_value = -0.08, 0.0
    dim.inputs['To Min'].default_value, dim.inputs['To Max'].default_value = 0.6, 1.0
    low = nt.nodes.new('ShaderNodeMix')
    low.data_type = 'RGBA'
    low.blend_type = 'MULTIPLY'
    low.inputs['Factor'].default_value = 1.0
    nt.links.new(tint.outputs[2], low.inputs[6])
    cdim = nt.nodes.new('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        nt.links.new(dim.outputs['Result'], cdim.inputs[k])
    nt.links.new(cdim.outputs['Color'], low.inputs[7])
    nt.links.new(low.outputs[2], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = float(os.environ.get('SEA_SKY', '0.7'))


def sun():
    li = bpy.data.lights.new('sun', 'SUN')
    li.energy = float(os.environ.get('SEA_SUN', '10'))
    li.angle = math.radians(float(os.environ.get('SEA_SUN_ANG', '5')))   # широкое солнце низко у горизонта — искр больше
    li.color = (1.0, 0.56, 0.27)
    ob = bpy.data.objects.new('sun', li)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (SUN_EL - math.pi / 2, 0, 0)   # свет летит навстречу камере (солнце впереди, над горизонтом)


def render(name):
    sc = bpy.context.scene
    sc.render.filepath = str(OUT / (name + '.png'))
    print('SEA', name, W, H, 'samples', SAMPLES, flush=True)
    bpy.ops.render.render(write_still=True)


for kind in ('body', 'glint'):
    if ONLY and ONLY != kind:
        continue
    reset()
    ob, bounds = ocean(kind == 'glint')
    camera(bounds)
    sky(kind == 'glint')
    if kind == 'glint':
        sun()
    render('sea_' + kind)
