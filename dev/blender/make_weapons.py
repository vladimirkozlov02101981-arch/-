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
U = 0.01; PXU = 8; X0, X1, Y0, Y1 = -16, 32, -12, 12

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
    sc.render.resolution_x = (X1 - X0) * PXU; sc.render.resolution_y = (Y1 - Y0) * PXU; sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    try: sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = (X1 - X0) * U
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = ((X0 + X1) / 2 * U, -5, 0); cam.rotation_euler = (math.radians(90), 0, 0)
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.6, 0.72, 0.95, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    for en, col, el, az in ((4.0, (1.0, 0.9, 0.74), 45, 70), (1.6, (0.7, 0.8, 1.0), 15, 120), (2.5, (1.0, 0.95, 0.9), -30, 60)):
        d = bpy.data.lights.new('s', 'SUN'); d.energy = en; d.color = col; d.angle = math.radians(4)
        o = bpy.data.objects.new('s', d); sc.collection.objects.link(o)
        e, a = math.radians(el), math.radians(az)
        o.rotation_euler = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), -math.sin(e))).to_track_quat('-Z', 'Y').to_euler()
    return sc

def mat(name, col, metal=0.0, rough=0.5, bump=0.0, scale=40):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in col], 1); b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    if bump:
        N = m.node_tree.nodes; L = m.node_tree.links
        nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8
        bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = bump
        L.new(nz.outputs['Fac'], bp.inputs['Height']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

def wood_mat():
    m = bpy.data.materials.new('wood'); m.use_nodes = True; N = m.node_tree.nodes; L = m.node_tree.links; b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.03 / U, 0.5 / U, 0.5 / U)
    w = N.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'Z'; w.inputs['Scale'].default_value = 2.5; w.inputs['Distortion'].default_value = 5; w.inputs['Detail Scale'].default_value = 1.5; w.inputs['Detail'].default_value = 6
    L.new(tc.outputs['Generated'] if False else tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], w.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color = (0.035, 0.012, 0.004, 1); ramp.color_ramp.elements[1].color = (0.17, 0.065, 0.02, 1)
    L.new(w.outputs['Fac'], ramp.inputs['Fac']); L.new(ramp.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.42
    bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.15; L.new(w.outputs['Fac'], bp.inputs['Height']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
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

def render(sc, name):
    os.makedirs(OUT, exist_ok=True); sc.render.filepath = os.path.join(OUT, 'wpn_' + name + '.png'); bpy.ops.render.render(write_still=True); print('WROTE', name)

STEEL = lambda: mat('steel', (0.42, 0.43, 0.45), 1.0, 0.32, 0.15, 60)
BLACK = lambda: mat('black', (0.13, 0.135, 0.14), 0.7, 0.42, 0.2, 80)
WOOD = wood_mat
OLIVE = lambda: mat('olive', (0.25, 0.29, 0.16), 0.1, 0.5, 0.25, 50)
RUBBER = lambda: mat('rubber', (0.16, 0.16, 0.15), 0.0, 0.7, 0.3, 90)

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
if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for k in (argv or list(ALL)): ALL[k]()
