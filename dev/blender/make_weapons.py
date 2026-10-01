"""
Реалистичное оружие в руках бойца: модели из примитивов (сталь, дерево, краска, резина), тот же тёплый свет, что у карт.
Запуск: blender -b --python dev/blender/make_weapons.py -- [id ...]   → assets/tex/wpn_<id>.png
Кадр: 48×24 игровых единиц (x −16…32, y −12…12), 8 px на единицу; начало координат — рукоять, ствол вдоль +x (как в drawHeld).
Модель строится в сантиметрах сцены = игровых единицах (×0.01 м).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else os.getcwd()
OUT = os.environ.get('WPN_OUT') or os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'tex'))
U = 0.01; PXU = int(os.environ.get('WPN_PXU', 16)); X0, X1, Y0, Y1 = -16, 32, -12, 12

def use_gpu(sc):
    """видеокарта, если есть (на ПК пользователя рендер в десятки раз быстрее)"""
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                pr.compute_device_type = kind; pr.get_devices()
                ds = [d for d in pr.devices if d.type == kind]
                if ds:
                    for d in pr.devices: d.use = d.type == kind
                    sc.cycles.device = 'GPU'; print('GPU', kind, [d.name for d in ds]); return True
            except Exception: pass
    except Exception: pass
    return False

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; gpu = use_gpu(sc)
    sc.cycles.samples = int(os.environ.get('WPN_SAMPLES', 256 if gpu else 96)); sc.cycles.use_denoising = True
    sc.render.resolution_x = (X1 - X0) * PXU; sc.render.resolution_y = (Y1 - Y0) * PXU; sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = 'AgX - Punchy'
    except Exception: pass
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = (X1 - X0) * U
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = ((X0 + X1) / 2 * U, -5, 0); cam.rotation_euler = (math.radians(90), 0, 0)
    # небо как на улице (физическое небо Нишиты): мягкий заполняющий свет и отражения на металле
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; N = w.node_tree.nodes; L = w.node_tree.links
    sky = N.new('ShaderNodeTexSky')
    try: sky.sky_type = 'NISHITA'; sky.sun_elevation = math.radians(35); sky.sun_rotation = math.radians(200); sky.sun_disc = False
    except Exception: pass
    L.new(sky.outputs['Color'], N['Background'].inputs[0]); N['Background'].inputs[1].default_value = 0.35
    # ключевой мягкий свет сверху-спереди, контровой сзади (обводит силуэт), заполняющий снизу
    for en, col, loc, size in ((28.0, (1.0, 0.92, 0.8), (-0.25, -0.9, 0.7), 0.9), (16.0, (0.75, 0.85, 1.0), (0.5, 0.8, 0.35), 0.6), (5.0, (1.0, 0.9, 0.8), (0.1, -0.8, -0.6), 0.8)):
        d = bpy.data.lights.new('a', 'AREA'); d.energy = en; d.color = col; d.size = size
        o = bpy.data.objects.new('a', d); sc.collection.objects.link(o); o.location = loc
        o.rotation_euler = (Vector((0.08, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return sc

def _n(m, kind, **kw):
    n = m.node_tree.nodes.new(kind)
    for k, v in kw.items():
        if k in n.inputs: n.inputs[k].default_value = v
        else: setattr(n, k, v)
    return n

def mat(name, col, metal=0.0, rough=0.5, bump=0.0, scale=40, wear=0.0, bare=(0.62, 0.62, 0.64), dirt=0.35, coat=0.0, scratches=0.0):
    """PBR: неровная шероховатость, микрорельеф, грязь во впадинах, потёртости на рёбрах (под краской — голый металл), царапины"""
    m = bpy.data.materials.new(name); m.use_nodes = True; N = m.node_tree.nodes; L = m.node_tree.links; b = N['Principled BSDF']
    lin = lambda c: (*[x ** 2.2 for x in c], 1)
    tc = _n(m, 'ShaderNodeTexCoord')
    # пятна шероховатости
    nz = _n(m, 'ShaderNodeTexNoise', Scale=scale * 0.25, Detail=6.0, Roughness=0.6); L.new(tc.outputs['Object'], nz.inputs['Vector'])
    rr = _n(m, 'ShaderNodeMapRange'); rr.inputs['To Min'].default_value = rough * 0.75; rr.inputs['To Max'].default_value = min(1, rough * 1.3)
    L.new(nz.outputs['Fac'], rr.inputs['Value'])
    rough_out = rr.outputs['Result']
    # царапины: вытянутый шум — тонкие светлые штрихи с меньшей шероховатостью
    if scratches:
        mp = _n(m, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale * 4, scale * 0.25, scale * 0.25)
        L.new(tc.outputs['Object'], mp.inputs['Vector'])
        sn = _n(m, 'ShaderNodeTexNoise', Scale=3.0, Detail=2.0); L.new(mp.outputs['Vector'], sn.inputs['Vector'])
        sr = _n(m, 'ShaderNodeMapRange'); sr.inputs['From Min'].default_value = 0.62; sr.inputs['From Max'].default_value = 0.7
        L.new(sn.outputs['Fac'], sr.inputs['Value'])
        sc_mul = _n(m, 'ShaderNodeMath', operation='MULTIPLY'); sc_mul.inputs[1].default_value = scratches; L.new(sr.outputs['Result'], sc_mul.inputs[0])
        rmix = _n(m, 'ShaderNodeMix'); rmix.data_type = 'FLOAT'; L.new(sc_mul.outputs[0], rmix.inputs['Factor']); L.new(rough_out, rmix.inputs['A']); rmix.inputs['B'].default_value = 0.18
        rough_out = rmix.outputs['Result']
    # рёбра: «изнутри» AO даёт выпуклости — там краска стёрта
    color_out = None
    base = _n(m, 'ShaderNodeRGB'); base.outputs[0].default_value = lin(col)
    cv = _n(m, 'ShaderNodeTexNoise', Scale=scale * 0.6, Detail=8.0, Roughness=0.62); L.new(tc.outputs['Object'], cv.inputs['Vector'])
    cvr = _n(m, 'ShaderNodeMapRange'); cvr.inputs['To Min'].default_value = 0.72; cvr.inputs['To Max'].default_value = 1.28; L.new(cv.outputs['Fac'], cvr.inputs['Value'])
    cvm = _n(m, 'ShaderNodeVectorMath', operation='SCALE'); L.new(base.outputs[0], cvm.inputs[0]); L.new(cvr.outputs['Result'], cvm.inputs['Scale'])
    color_out = cvm.outputs['Vector']
    metal_out = None
    if wear:
        ao = _n(m, 'ShaderNodeAmbientOcclusion', inside=True, only_local=True); ao.inputs['Distance'].default_value = 0.0025
        inv = _n(m, 'ShaderNodeMath', operation='SUBTRACT'); inv.inputs[0].default_value = 1.0; L.new(ao.outputs['AO'], inv.inputs[1])
        en = _n(m, 'ShaderNodeTexNoise', Scale=scale * 2, Detail=10.0, Roughness=0.7); L.new(tc.outputs['Object'], en.inputs['Vector'])
        em = _n(m, 'ShaderNodeMath', operation='MULTIPLY'); L.new(inv.outputs[0], em.inputs[0]); L.new(en.outputs['Fac'], em.inputs[1])
        ew = _n(m, 'ShaderNodeMapRange'); ew.inputs['From Min'].default_value = 0.30 - wear * 0.2; ew.inputs['From Max'].default_value = 0.34 - wear * 0.2
        L.new(em.outputs[0], ew.inputs['Value'])
        cm = _n(m, 'ShaderNodeMix'); cm.data_type = 'RGBA'; L.new(ew.outputs['Result'], cm.inputs['Factor']); L.new(color_out, cm.inputs[6]); cm.inputs[7].default_value = lin(bare)
        color_out = cm.outputs[2]
        mm = _n(m, 'ShaderNodeMix'); mm.data_type = 'FLOAT'; L.new(ew.outputs['Result'], mm.inputs['Factor']); mm.inputs['A'].default_value = metal; mm.inputs['B'].default_value = 1.0
        metal_out = mm.outputs['Result']
        rm2 = _n(m, 'ShaderNodeMix'); rm2.data_type = 'FLOAT'; L.new(ew.outputs['Result'], rm2.inputs['Factor']); L.new(rough_out, rm2.inputs['A']); rm2.inputs['B'].default_value = 0.28
        rough_out = rm2.outputs['Result']
    # грязь во впадинах
    if dirt:
        ao2 = _n(m, 'ShaderNodeAmbientOcclusion', only_local=True); ao2.inputs['Distance'].default_value = 0.01
        dm = _n(m, 'ShaderNodeMix'); dm.data_type = 'RGBA'; dm.blend_type = 'MULTIPLY'
        dr = _n(m, 'ShaderNodeMapRange'); dr.inputs['To Min'].default_value = 1.0; dr.inputs['To Max'].default_value = 0.0
        L.new(ao2.outputs['AO'], dr.inputs['Value'])
        dk = _n(m, 'ShaderNodeMath', operation='MULTIPLY'); dk.inputs[1].default_value = dirt; L.new(dr.outputs['Result'], dk.inputs[0])
        L.new(dk.outputs[0], dm.inputs['Factor']); L.new(color_out, dm.inputs[6]); dm.inputs[7].default_value = (0.08, 0.06, 0.045, 1)
        color_out = dm.outputs[2]
    L.new(color_out, b.inputs['Base Color']); L.new(rough_out, b.inputs['Roughness'])
    if metal_out: L.new(metal_out, b.inputs['Metallic'])
    else: b.inputs['Metallic'].default_value = metal
    if coat:
        for k in ('Coat Weight', 'Clearcoat'):
            if k in b.inputs: b.inputs[k].default_value = coat; break
    # микрорельеф + скруглённые кромки (узел Bevel)
    bev = _n(m, 'ShaderNodeBevel', samples=8); bev.inputs['Radius'].default_value = 0.0012
    bp = _n(m, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = bump or 0.08; bp.inputs['Distance'].default_value = 0.0004
    fz = _n(m, 'ShaderNodeTexNoise', Scale=scale * 6, Detail=12.0, Roughness=0.65); L.new(tc.outputs['Object'], fz.inputs['Vector'])
    L.new(fz.outputs['Fac'], bp.inputs['Height']); L.new(bev.outputs['Normal'], bp.inputs['Normal']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

PBR = os.path.join(HERE, '..', 'pbr')
def scan(target):
    """фотоскан Poly Haven из dev/pbr (если скачан): словарь путей diff/rough/nor_gl"""
    import json, glob
    try: aid = json.load(open(os.path.join(PBR, 'catalog.json'), encoding='utf-8'))[target][0]
    except Exception: return None
    get = lambda k: (sorted(glob.glob(os.path.join(PBR, aid, '%s_%s_*' % (aid, k)))) or [None])[-1]
    return {'diff': get('diff'), 'rough': get('rough'), 'nor': get('nor_gl')}

def apply_scan(m, target, scale, tint=None, keep_color=True):
    """накладывает скан на материал: кубическая проекция по координатам объекта (без развёртки)"""
    S = scan(target)
    if not S: return m
    N = m.node_tree.nodes; L = m.node_tree.links; b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    def img(path, nc):
        t = N.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(path, check_existing=True); t.projection = 'BOX'; t.projection_blend = 0.3
        if nc: t.image.colorspace_settings.name = 'Non-Color'
        L.new(mp.outputs['Vector'], t.inputs['Vector']); return t
    if S['rough']:
        rr = img(S['rough'], True); mr = N.new('ShaderNodeMapRange'); mr.inputs['To Min'].default_value = 0.15; mr.inputs['To Max'].default_value = 0.85
        L.new(rr.outputs['Color'], mr.inputs['Value']); L.new(mr.outputs['Result'], b.inputs['Roughness'])
    if S['nor']:
        nt = N.new('ShaderNodeNormalMap'); nt.inputs['Strength'].default_value = 0.8; L.new(img(S['nor'], True).outputs['Color'], nt.inputs['Color']); L.new(nt.outputs['Normal'], b.inputs['Normal'])
    if S['diff']:
        dt = img(S['diff'], False)
        if keep_color and b.inputs['Base Color'].is_linked:   # свой цвет × яркость скана (пятна, износ, грязь)
            src = b.inputs['Base Color'].links[0].from_socket
            bw = N.new('ShaderNodeRGBToBW'); L.new(dt.outputs['Color'], bw.inputs['Color'])
            k = N.new('ShaderNodeMath', operation='MULTIPLY') if False else N.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = 2.2
            L.new(bw.outputs['Val'], k.inputs[0])
            vm = N.new('ShaderNodeVectorMath'); vm.operation = 'SCALE'; L.new(src, vm.inputs[0]); L.new(k.outputs[0], vm.inputs['Scale'])
            L.new(vm.outputs['Vector'], b.inputs['Base Color'])
        else:
            L.new(dt.outputs['Color'], b.inputs['Base Color'])
    return m

def wood_mat():
    """орех под лаком: годовые кольца, поры, лаковое покрытие, потёртый лак на рёбрах"""
    m = bpy.data.materials.new('wood'); m.use_nodes = True; N = m.node_tree.nodes; L = m.node_tree.links; b = N['Principled BSDF']
    tc = _n(m, 'ShaderNodeTexCoord'); mp = _n(m, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (6.0, 110.0, 110.0)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    dn = _n(m, 'ShaderNodeTexNoise', Scale=2.0, Detail=4.0); L.new(mp.outputs['Vector'], dn.inputs['Vector'])
    add = _n(m, 'ShaderNodeVectorMath', operation='ADD'); L.new(mp.outputs['Vector'], add.inputs[0]); L.new(dn.outputs['Color'], add.inputs[1])
    w = _n(m, 'ShaderNodeTexWave', wave_type='RINGS', rings_direction='X'); w.inputs['Scale'].default_value = 0.35; w.inputs['Distortion'].default_value = 4.0; w.inputs['Detail'].default_value = 3.0
    L.new(add.outputs['Vector'], w.inputs['Vector'])
    ramp = _n(m, 'ShaderNodeValToRGB'); E = ramp.color_ramp.elements
    E[0].position = 0.2; E[0].color = (0.025, 0.009, 0.003, 1); E[1].position = 0.9; E[1].color = (0.15, 0.058, 0.02, 1)
    L.new(w.outputs['Fac'], ramp.inputs['Fac'])
    pores = _n(m, 'ShaderNodeTexNoise', Scale=60.0, Detail=2.0); L.new(mp.outputs['Vector'], pores.inputs['Vector'])
    pm = _n(m, 'ShaderNodeMix'); pm.data_type = 'RGBA'; pm.blend_type = 'MULTIPLY'; pm.inputs['Factor'].default_value = 0.35
    L.new(ramp.outputs['Color'], pm.inputs[6]); L.new(pores.outputs['Color'], pm.inputs[7])
    L.new(pm.outputs[2], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.38
    for k in ('Coat Weight', 'Clearcoat'):
        if k in b.inputs: b.inputs[k].default_value = 0.5; break
    for k in ('Coat Roughness', 'Clearcoat Roughness'):
        if k in b.inputs: b.inputs[k].default_value = 0.12; break
    bev = _n(m, 'ShaderNodeBevel', samples=8); bev.inputs['Radius'].default_value = 0.0015
    bp = _n(m, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.12; bp.inputs['Distance'].default_value = 0.0003
    L.new(w.outputs['Fac'], bp.inputs['Height']); L.new(bev.outputs['Normal'], bp.inputs['Normal']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

def obj(me, m, name='p'):
    me.materials.append(m); o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    bev = o.modifiers.new('b', 'BEVEL'); bev.width = 0.28 * U; bev.segments = 3; bev.limit_method = 'ANGLE'
    return o

def box(x, y, w, h, d, m, rot=0.0):
    """прямоугольный брусок: x,y — левый-верх в игровых единицах (y вниз), w×h, толщина d"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    me = bpy.data.meshes.new('b'); bm.to_mesh(me); bm.free()
    o = obj(me, m); o.scale = (w * U, d * U, h * U); o.location = ((x + w / 2) * U, 0, -(y + h / 2) * U); o.rotation_euler = (0, rot, 0)
    return o

def prof(pts, d, m, z=0.0):
    """профиль (силуэт сбоку) по точкам (x, y) игровых единиц, выдавленный на толщину d"""
    bm = bmesh.new(); vs = [bm.verts.new(((x) * U, -d / 2 * U + z * U, -y * U)) for x, y in pts]
    f = bm.faces.new(vs); r = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in r['geom']:
        if isinstance(v, bmesh.types.BMVert): v.co.y += d * U
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('p'); bm.to_mesh(me); bm.free(); o = obj(me, m)
    for p in me.polygons: p.use_smooth = False
    return o

def cyl(x, y, L, r, m, seg=32, r2=None, rot=0.0):
    """цилиндр вдоль +x от точки (x, y) длиной L"""
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r * U, radius2=(r2 if r2 is not None else r) * U, depth=L * U)
    me = bpy.data.meshes.new('c'); bm.to_mesh(me); bm.free()
    o = obj(me, m); o.rotation_euler = (0, math.pi / 2 + rot, 0)
    o.location = ((x + L / 2 * math.cos(rot)) * U, 0, -(y - L / 2 * math.sin(rot)) * U)
    return o

SHOW = {'on': False, 'n': 0}
def render(sc, name):
    if SHOW['on']:   # витрина: модели остаются в сцене, каждая — на своей «полке»
        n = SHOW['n']; dx, z = (n % 3) * 0.56, -(n // 3) * 0.30
        for o in sc.collection.objects:
            if o.type == 'MESH' and not o.get('shelf'): o.location.x += dx; o.location.z += z; o['shelf'] = name
        SHOW['n'] += 1; print('ADDED', name); return
    os.makedirs(OUT, exist_ok=True); sc.render.filepath = os.path.join(OUT, 'wpn_' + name + '.png'); bpy.ops.render.render(write_still=True); print('WROTE', name)

STEEL = lambda: apply_scan(mat('steel', (0.55, 0.56, 0.58), 1.0, 0.32, 0.06, 60, scratches=0.6, dirt=0.25), 'gun_metal', 6.0)
BLACK = lambda: apply_scan(mat('black', (0.07, 0.072, 0.075), 0.85, 0.42, 0.06, 80, wear=0.7, bare=(0.55, 0.55, 0.57), scratches=0.4), 'gun_metal', 6.0)
WOOD = lambda: apply_scan(wood_mat(), 'gun_wood', 5.0, keep_color=False) if scan('gun_wood') else wood_mat()
OLIVE = lambda: apply_scan(mat('olive', (0.28, 0.32, 0.18), 0.0, 0.62, 0.08, 50, wear=0.8, bare=(0.45, 0.45, 0.46), dirt=0.45), 'gun_metal', 4.0)
RUBBER = lambda: apply_scan(mat('rubber', (0.06, 0.06, 0.058), 0.0, 0.78, 0.25, 140, dirt=0.2), 'rubber', 12.0)

def bazooka():
    sc = reset(); ol, st, bl, rb = OLIVE(), STEEL(), BLACK(), RUBBER()
    cyl(-9, 0, 24, 2.6, ol); cyl(-10.5, 0, 1.8, 3.1, bl); cyl(14, 0, 1.6, 3.0, bl)       # труба, казённик, дульный обод
    cyl(-3, 0, 0.8, 2.8, st); cyl(8, 0, 0.8, 2.8, st)                                     # хомуты
    box(-0.5, 2.2, 2.8, 5, 2.2, rb, 0.2); box(6, 2.2, 2.4, 3.6, 2.0, rb, -0.1)            # рукоять, спуск. коробка
    box(1.5, -4.6, 4, 2.0, 1.4, bl); box(2.6, -5.8, 1.6, 1.4, 1.0, st)                   # прицел
    box(-9, 2.2, 6, 1.2, 1.6, rb)                                                         # плечевой упор
    render(sc, 'bazooka')

def rpg():
    sc = reset(); wd, st, bl, ol = WOOD(), STEEL(), BLACK(), OLIVE()
    cyl(-10, 0, 26, 2.3, st); cyl(-4, 0, 10, 2.7, wd)                                     # труба, деревянная накладка
    cyl(-12.5, 0, 2.6, 2.3, st, r2=3.2)                                                   # раструб
    cyl(14, 0, 3, 1.5, ol); cyl(17, 0, 6, 4.4, ol, r2=4.6); cyl(23, 0, 6, 4.6, ol, r2=0.6)   # боевая часть
    box(-1, 2.3, 2.8, 5.5, 2, bl, 0.2); box(6, 2.3, 2.4, 4.4, 2, bl, -0.1); box(2, -5.6, 4, 2.8, 1.2, bl)
    render(sc, 'rpg')

def assault():
    sc = reset(); wd, st, bl = WOOD(), STEEL(), BLACK()
    prof([(-12.5, -1.4), (-3.5, -2.4), (-3.5, 1.0), (-5.5, 1.2), (-12.5, 3.4)], 1.9, wd)                 # приклад
    box(-12.8, -1.6, 0.6, 5.2, 2.1, rb := mat('butt', (0.12, 0.11, 0.1), 0.0, 0.8), 0.05)                # затыльник
    prof([(-4, -2.6), (-3, -3.2), (11, -3.2), (11, 1.6), (-4, 1.6)], 2.4, bl)                             # ствольная коробка
    prof([(-3.2, -3.1), (-2, -3.9), (10, -3.9), (10.6, -3.1)], 2.0, bl)                                  # крышка
    box(4, -2.4, 4, 1.4, 2.6, st)                                                                         # окно выброса
    box(-1, -1.0, 3, 0.8, 2.6, st)                                                                        # переводчик
    prof([(11, -2.6), (18.5, -2.3), (18.5, 1.0), (11, 1.4)], 2.8, wd)                                     # цевьё
    cyl(11, -1.0, 13.5, 0.6, bl); cyl(11, -3.2, 9, 0.5, wd); cyl(23.5, -1.0, 2.2, 0.85, st)            # ствол, газ. трубка, компенсатор
    prof([(5.4, 1.6), (8.6, 1.6), (9.6, 4.6), (11.2, 8.2), (8.2, 9.2), (6.8, 5.4)], 2.0, bl)              # изогнутый магазин
    prof([(0.8, 1.6), (3.4, 1.6), (2.7, 6.8), (0.1, 6.4)], 2.0, wd)                                       # пистолетная рукоять
    prof([(3.4, 1.6), (5.4, 1.6), (5.4, 2.0), (3.8, 3.6), (3.2, 3.6)], 0.6, st)                           # спусковая скоба
    box(21.6, -4.2, 0.8, 1.6, 0.8, bl); box(0.5, -4.6, 2.6, 0.9, 1, bl)                                   # мушка, целик
    render(sc, 'assault')

def sniper():
    sc = reset(); wd, st, bl = WOOD(), STEEL(), BLACK()
    prof([(-13, -1.4), (-3, -1.8), (4, -1.8), (9, -1.4), (9, 0.6), (4, 0.8), (3, 5.4), (0.6, 5.2), (0.2, 1.8), (-4, 1.2), (-13, 3.6)], 2.2, wd)   # ложа с пистолетным хватом
    box(-13.4, -1.6, 0.6, 5.4, 2.3, mat('butt', (0.12, 0.11, 0.1), 0.0, 0.8), 0.07)
    box(-2, -2.4, 9, 1.4, 2.0, bl)                                                        # ствольная коробка
    cyl(8, -1.0, 17.5, 0.62, bl, r2=0.5); cyl(25, -1.0, 2.0, 0.95, st)                   # ствол, тормоз
    cyl(0.5, -4.2, 9, 1.05, bl); cyl(-1.8, -4.2, 2.4, 1.55, bl, r2=1.05); cyl(9.4, -4.2, 2.6, 1.05, bl, r2=1.75)   # оптика
    cyl(4.2, -5.8, 1.2, 0.55, st, rot=-math.pi / 2)                                       # барабан поправок
    box(1.6, -3.4, 1, 1.2, 1.2, st); box(7, -3.4, 1, 1.2, 1.2, st)                       # кольца
    cyl(4.5, -1.4, 2.6, 0.3, st, rot=-0.8); cyl(6.2, 0.6, 0.1, 0.55, st)                   # рукоять затвора
    prof([(1.6, 0.8), (3.6, 0.8), (3.6, 1.2), (2.2, 2.6), (1.6, 2.6)], 0.6, st)          # скоба
    render(sc, 'sniper')

def shotgun():
    sc = reset(); wd, st, bl = WOOD(), STEEL(), BLACK()
    prof([(-12, -1.2), (-2, -2.0), (-2, 1.4), (-1, 5.4), (-3.4, 5.4), (-4.6, 1.8), (-12, 3.4)], 2.1, wd)   # приклад с хватом
    box(-12.4, -1.4, 0.6, 5.0, 2.2, mat('butt', (0.1, 0.1, 0.1), 0.0, 0.85), 0.1)
    prof([(-2, -2.0), (6, -2.0), (6, 1.8), (-2, 1.8)], 2.4, bl)                           # коробка
    box(0.5, -1.2, 3, 1.2, 2.6, st)                                                       # окно
    cyl(6, -1.0, 12, 0.85, st); cyl(6, 1.1, 9.6, 0.72, bl); cyl(17.4, -1.0, 0.8, 0.95, bl)   # ствол, подств. магазин
    prof([(7, 0.0), (13, 0.0), (13, 2.4), (7, 2.4)], 2.8, wd)                             # цевьё-помпа
    for i in range(5): box(7.6 + i * 1.1, 0.1, 0.35, 2.2, 2.9, bl)                        # насечка
    prof([(0.6, 1.8), (3.2, 1.8), (3.2, 2.2), (1.4, 3.6), (0.6, 3.6)], 0.6, st)
    box(16.4, -2.4, 0.5, 0.6, 0.6, st)                                                    # мушка-бусина
    render(sc, 'shotgun')

def revolver():
    sc = reset(); wd, st = WOOD(), mat('nickel', (0.72, 0.74, 0.76), 1.0, 0.22)
    dk = mat('blued', (0.2, 0.22, 0.26), 1.0, 0.3)
    prof([(-4.5, -2.6), (-3, -3.4), (5, -3.4), (5, 1.0), (1, 1.4), (-2, 2.2), (-4.5, 1.4)], 2, st)   # рамка
    cyl(4.5, -1.8, 13.5, 1.05, st); prof([(4.5, -3.3), (18, -3.3), (18, -2.6), (4.5, -2.6)], 1.0, st)  # ствол, планка
    cyl(-1.5, -0.9, 5.0, 2.3, dk, seg=10); 
    for i in range(3): cyl(-1.4 + i * 1.6, -3.3, 1.4, 0.35, st, rot=0)                   # проточки барабана
    prof([(-4.5, 1.2), (-1.4, 1.8), (-1.2, 4.2), (-2.0, 8.4), (-5.4, 8.6), (-5.8, 5.0)], 2.3, wd)   # щёчки
    prof([(-5.2, -2.8), (-4.2, -4.4), (-3.4, -4.2), (-3.8, -2.6)], 0.8, dk)              # курок
    prof([(0, 1.4), (3, 1.2), (2.6, 3.8), (0.2, 3.6)], 0.5, st)                          # скоба
    render(sc, 'revolver')

def magnum():
    sc = reset(); wd = WOOD(); dk = mat('blued', (0.16, 0.17, 0.2), 1.0, 0.26)
    prof([(-4.5, -2.6), (-3, -3.4), (5, -3.4), (5, 1.0), (1, 1.4), (-2, 2.2), (-4.5, 1.4)], 2, dk)
    cyl(4.5, -1.8, 17.5, 1.25, dk); prof([(4.5, -3.6), (22, -3.6), (22, -2.8), (4.5, -2.8)], 1.2, dk)   # ствол с вентилируемой планкой
    for i in range(6): box(6 + i * 2.6, -3.5, 1.2, 0.5, 1.3, mat('v', (0.02, 0.02, 0.02), 0, 0.8))
    cyl(-1.5, -0.9, 5.2, 2.4, dk, seg=10); box(20.8, -4.4, 0.8, 1.0, 0.6, dk)
    prof([(-4.5, 1.2), (-1.4, 1.8), (-1.2, 4.2), (-2.0, 8.8), (-5.6, 9.0), (-6.0, 5.0)], 2.4, mat('rub', (0.08, 0.07, 0.06), 0, 0.75, 0.4, 120))
    prof([(-5.2, -2.8), (-4.2, -4.4), (-3.4, -4.2), (-3.8, -2.6)], 0.8, dk); prof([(0, 1.4), (3, 1.2), (2.6, 3.8), (0.2, 3.6)], 0.5, dk)
    render(sc, 'magnum')

def uzi():
    sc = reset(); bl, st = BLACK(), STEEL(); pk = mat('park', (0.2, 0.2, 0.19), 0.5, 0.6, 0.3, 120)
    prof([(-5, -3), (10, -3), (10, 2.4), (-5, 2.4)], 2.6, pk)                             # короб
    for i in range(5): box(-3 + i * 2.4, -2.6, 0.7, 4.4, 2.8, bl)                          # рёбра крышки
    cyl(10, -1.0, 5.5, 0.6, st); box(9.6, -2.4, 1.4, 3.4, 2.4, bl)                        # ствол, гайка
    prof([(1.6, 2.4), (4.6, 2.4), (4.4, 11), (1.8, 11)], 2.2, bl)                         # рукоять с магазином
    prof([(4.6, 2.4), (7.4, 2.4), (7.4, 2.8), (5.2, 4.4), (4.6, 4.4)], 0.6, st)
    prof([(-5, -2.2), (-11, -2.4), (-11, 1.6), (-10.2, 1.6), (-10.2, -1.4), (-5, -1.2)], 1.4, st)   # складной приклад
    box(-2, -4, 1, 1.2, 1, bl); box(8, -4, 0.8, 1.2, 0.8, bl)
    render(sc, 'uzi')

def minigun():
    sc = reset(); bl, st = BLACK(), STEEL(); ol = OLIVE(); br = mat('brass', (0.75, 0.55, 0.2), 1.0, 0.3)
    prof([(-8, -4), (4, -4), (4, 4), (-8, 4)], 6, ol)                                     # корпус с мотором
    cyl(-10, 0, 2.4, 3.2, bl); cyl(4, 0, 1.6, 3.8, st)
    for yy, dd in ((-2.6, 0.6), (0, 0.4), (2.6, 0.6)): cyl(5.6, yy, 13.5, 0.75, bl)       # стволы
    cyl(10, 0, 0.9, 3.5, st); cyl(18.2, 0, 1.2, 3.7, st)                                  # обоймы блока стволов
    prof([(-4, 4), (-1, 4), (-1.4, 8), (-4.2, 8)], 2.2, bl)                               # рукоять
    prof([(0, 2.4), (5, 2.4), (5, 7.4), (0, 7.4)], 3.6, ol)                               # короб с лентой
    for i in range(4): box(0.4 + i * 1.2, 7.4, 0.8, 1.8, 0.8, br)                         # патроны ленты
    box(-6, -6.2, 8, 1.2, 1.4, bl); box(-6, -5, 1, 1.2, 1.2, bl); box(1, -5, 1, 1.2, 1.2, bl)   # ручка переноски
    render(sc, 'minigun')

def flamer():
    sc = reset(); bl, st = BLACK(), STEEL(); rd = mat('tank', (0.55, 0.1, 0.07), 0.3, 0.4, 0.15, 30)
    cyl(-8, -0.2, 21, 1.8, st); cyl(12.5, -0.2, 3.0, 2.4, bl, r2=2.0)                    # труба, сопло
    for i in range(6): cyl(-4 + i * 2.2, -0.2, 0.6, 2.1, bl)                              # теплоотвод
    cyl(-11, 4.8, 10, 3.0, rd); cyl(-12, 4.8, 1, 2.6, rd, r2=3.0); cyl(-1, 4.8, 1, 3.0, rd, r2=2.6)   # баллон
    cyl(-6.5, 1.6, 1.2, 0.5, st, rot=-math.pi / 2)                                        # кран
    prof([(0, 1.6), (2.8, 1.6), (2.4, 6.4), (-0.2, 6.2)], 2, bl); prof([(8, 1.6), (10.4, 1.6), (10.2, 5.2), (8, 5.2)], 2, bl)
    render(sc, 'flamer')

def autocannon():
    sc = reset(); bl, st = BLACK(), STEEL(); ol = OLIVE(); br = mat('brass', (0.75, 0.55, 0.2), 1.0, 0.3)
    prof([(-12, -4), (-2, -5), (9, -5), (9, 4.4), (-12, 4.4)], 6, ol)                     # казённик
    cyl(9, -1.2, 16, 1.6, bl); cyl(15, -1.2, 4, 2.4, ol); cyl(23.5, -1.2, 2.8, 2.4, st)   # ствол, кожух, дульный тормоз
    for i in range(3): box(24 + i * 0.9, -2.8, 0.4, 3.2, 5, mat('v', (0.02, 0.02, 0.02), 0, 0.8))
    prof([(-3, 4.4), (0, 4.4), (-0.4, 10.4), (-3.2, 10.2)], 2.4, bl)
    prof([(-10, 0), (-5, 0), (-5, 8), (-10, 8)], 5, br)                                   # короб снарядов
    box(-10.5, -6.6, 12, 1.2, 1.6, bl); box(-10, -5.4, 1, 1.4, 1.2, bl); box(0, -5.4, 1, 0.6, 1.2, bl)
    render(sc, 'autocannon')

def mortar():
    sc = reset(); ol, st, bl = OLIVE(), STEEL(), BLACK()
    cyl(-9, 0, 19, 3.2, ol); cyl(-10.5, 0, 2.2, 3.5, bl, r2=2.8); cyl(9.4, 0, 1.2, 3.5, st)
    cyl(0, 0, 1.5, 3.6, st); box(-0.5, 3.2, 3, 5.4, 2.2, bl, 0.15)
    box(3, -5.8, 3.4, 2.4, 1.6, bl); cyl(3.4, -6.8, 2.4, 0.6, st)                         # угломер
    render(sc, 'mortar')

def homing():
    sc = reset(); wt = mat('white', (0.84, 0.86, 0.88), 0.1, 0.35, 0.05, 40); bl, st = BLACK(), STEEL()
    bu = mat('seek', (0.1, 0.35, 0.9), 0.2, 0.2)
    cyl(-9, 0, 24, 2.6, wt); cyl(-10.5, 0, 1.8, 3.1, bl); cyl(14, 0, 1.6, 3.0, bl)
    for xx in (-3, 8): cyl(xx, 0, 0.8, 2.8, st)
    prof([(0.5, -2.4), (7, -2.4), (6.4, -5.8), (1, -5.8)], 2.4, bl); cyl(6.6, -4.1, 1.0, 1.2, bu)   # головка наведения
    box(-0.5, 2.2, 2.8, 5, 2.2, bl, 0.2); box(6, 2.2, 2.4, 3.6, 2.0, bl, -0.1)
    render(sc, 'homing')

ALL = {'bazooka': bazooka, 'rpg': rpg, 'assault': assault, 'sniper': sniper, 'shotgun': shotgun, 'revolver': revolver, 'magnum': magnum, 'uzi': uzi, 'minigun': minigun, 'flamer': flamer, 'autocannon': autocannon, 'mortar': mortar, 'homing': homing}
def showcase(path):
    """все модели в одной сцене .blend — открыть в Blender и посмотреть/доработать (рендер F12)"""
    global reset
    sc = reset(); SHOW['on'] = True
    _reset = reset; reset = lambda: bpy.context.scene
    for k in ALL: ALL[k]()
    reset = _reset
    cam = sc.camera; n = SHOW['n']; rows = (n + 2) // 3; W, H = 3 * 0.56, rows * 0.30
    cam.data.ortho_scale = max(W, H) + 0.06; cam.location = (0.08 + 0.56, -5, -(rows - 1) * 0.30 / 2)
    sc.render.resolution_x = 1800; sc.render.resolution_y = int(1800 * H / W); sc.render.film_transparent = False
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path)); print('SAVED', path)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if argv and argv[0] == 'blend': showcase(argv[1] if len(argv) > 1 else 'weapons.blend')
    else:
        for k in (argv or list(ALL)): ALL[k]()
