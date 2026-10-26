"""Декор карт фотореалистично (Blender, Cycles) вместо векторных рисунков: снеговик, пальма, кактус, сухое дерево.

blender -b --python dev/blender/make_decor.py -- [имя ...]        (без имён — все из DECOR)
Каждый предмет — 3D-сцена сбоку (ортокамера, солнце сверху слева, прозрачный фон), основание — по низу кадра, по центру.
Пишет assets/tex/surface/<имя>.png (подробная версия, K пикселей на единицу мира) и assets/tex/<имя>.png (вдвое меньше,
уменьшение с учётом прозрачности). В игре рисуется treeSprite(…, size) — size = высота кадра в единицах мира (FRAME).
"""
import importlib.util
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

U = 0.01          # 1 ед. мира = 1 см сцены
K = 4             # пикселей на единицу в подробной версии


def scene(frame, light=None, seed=1):
    """кадр frame×frame ед., основание предмета (z=0) — у нижнего края кадра (2 ед. запаса под землю)"""
    sc = mt.reset(); rng = random.Random(seed)
    sc.render.resolution_x = sc.render.resolution_y = frame * K; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True; sc.render.image_settings.color_mode = 'RGBA'; sc.cycles.samples = 128
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    cam = sc.camera; cam.data.ortho_scale = frame * U
    cam.location = (0, -10, frame * U / 2 - 2 * U); cam.rotation_euler = (math.radians(90), 0, 0)
    sun = bpy.data.objects['sun']; ld = bpy.data.lights['sun']
    sun.rotation_euler = Vector((0.5, 0.55, -0.67)).normalized().to_track_quat('-Z', 'Y').to_euler()
    if light: ld.color = light[0]; ld.energy = light[1]
    return sc, rng


def obj(name, me, mat, sc):
    for p in me.polygons: p.use_smooth = True
    me.materials.append(mat); o = bpy.data.objects.new(name, me); o['tone'] = 0.0; sc.collection.objects.link(o); return o


def lumpy_sphere(name, c, r, seed, amp=0.06, squash=1.0):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=r)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in bm.verts:
        p = v.co.copy(); n = p.normalized()
        d = 1 + amp * (noise.noise(n * 2.2 + off) * 0.7 + noise.noise(n * 6 + off) * 0.3)
        v.co = Vector((p.x * d, p.y * d, p.z * d * squash)) + c
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); return me


def mat_snow(name='snow'):
    m, nt, b = mt.principled(name, 0.62, 0.35); b.inputs['Base Color'].default_value = (0.86, 0.9, 0.97, 1)
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.35; break
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 260; nz.inputs['Detail'].default_value = 8
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.35
    nt.links.new(nz.outputs['Fac'], bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    return m


def mat_col(name, col, rough=0.6, spec=0.3, bump=0.0, scale=80):
    m, nt, b = mt.principled(name, rough, spec); b.inputs['Base Color'].default_value = (*mt.lin(col), 1)
    if bump:
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8
        bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = bump
        nt.links.new(nz.outputs['Fac'], bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    return m


def snowman(name, seed):
    """снеговик, как векторный: три кома (радиусы 13, 10, 7,5 ед.), угольки, морковка, шарф, руки-ветки, цилиндр"""
    sc, rng = scene(80, ((0.86, 0.9, 1.0), 4.2), seed)
    snow = mat_snow()
    for i, (z, r) in enumerate(((11, 13), (31, 10), (47, 7.5))):
        obj('ball%d' % i, lumpy_sphere('ball%d' % i, Vector((rng.uniform(-0.6, 0.6) * U, 0, z * U)), r * U, seed + i, 0.05, 0.94), snow, sc)
    coal = mat_col('coal', (0.05, 0.05, 0.05), 0.85, 0.2, 0.6, 400)
    bm = bmesh.new()
    for (x, z) in ((-2.6, 49), (2.6, 49)):
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.1 * U, matrix=Matrix.Translation(Vector((x * U, -6.6 * U, z * U))))
    for i in range(3):
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.2 * U, matrix=Matrix.Translation(Vector((0, -9.6 * U, (26 + i * 5) * U))))
    me = bpy.data.meshes.new('coal'); bm.to_mesh(me); bm.free(); obj('coal', me, coal, sc)
    bm = bmesh.new(); mt._cone(bm, Vector((0, -6.8 * U, 46.5 * U)), Vector((8.5 * U, -9 * U, 45.6 * U)), 1.2 * U, 0.15 * U, 12)
    me = bpy.data.meshes.new('nose'); bm.to_mesh(me); bm.free(); obj('nose', me, mat_col('carrot', (0.95, 0.42, 0.08), 0.55, 0.3, 0.3, 300), sc)
    # шарф: вязаный тор на шее и свисающий конец
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=8.6 * U, radius2=8.2 * U, depth=3.6 * U, matrix=Matrix.Translation(Vector((0, 0, 40.2 * U))))
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(Vector((4.6 * U, -7.4 * U, 35 * U))) @ Matrix.Diagonal((3.4 * U, 1.4 * U, 10 * U, 1)) @ Matrix.Rotation(0.12, 4, 'Y'))
    me = bpy.data.meshes.new('scarf'); bm.to_mesh(me); bm.free(); obj('scarf', me, mat_col('wool', (0.78, 0.12, 0.12), 0.95, 0.15, 0.8, 220), sc)
    # руки-ветки
    bark = mat_col('stick', (0.33, 0.22, 0.13), 0.85, 0.2, 0.5, 200); bm = bmesh.new()
    for sgn, (ex, ez) in ((-1, (-22, 42)), (1, (21, 38))):
        a = Vector((sgn * 8 * U, -2 * U, 32 * U)); b = Vector((ex * U, -3 * U, ez * U)); mt._cone(bm, a, b, 0.8 * U, 0.35 * U, 8)
        m_ = a.lerp(b, 0.7); mt._cone(bm, m_, m_ + Vector((sgn * 3 * U, -0.5 * U, 5 * U)), 0.4 * U, 0.15 * U, 6)
    me = bpy.data.meshes.new('arms'); bm.to_mesh(me); bm.free(); obj('arms', me, bark, sc)
    # цилиндр
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=7 * U, radius2=7 * U, depth=1.2 * U, matrix=Matrix.Translation(Vector((0, 0, 54.2 * U))))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=4.9 * U, radius2=5.2 * U, depth=11 * U, matrix=Matrix.Translation(Vector((0, 0, 60 * U))))
    me = bpy.data.meshes.new('hat'); bm.to_mesh(me); bm.free(); obj('hat', me, mat_col('felt', (0.07, 0.07, 0.08), 0.7, 0.3, 0.3, 150), sc)
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=5.25 * U, radius2=5.25 * U, depth=1.8 * U, matrix=Matrix.Translation(Vector((0, 0, 56.2 * U))))
    me = bpy.data.meshes.new('band'); bm.to_mesh(me); bm.free(); obj('band', me, mat_col('band', (0.55, 0.08, 0.08), 0.6, 0.3), sc)
    return sc


def rib_tube(bm, pts, radii, ribs=0, depth=0.0, seg=36, cap=True):
    """трубка по точкам pts (Vector) с радиусами radii; ribs — число рёбер (кактус), depth — их глубина (доля радиуса)"""
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        q = t.to_track_quat('Z', 'Y'); ring = []
        for j in range(seg):
            a = j / seg * math.tau; r = radii[i] * (1 + depth * math.cos(ribs * a)) if ribs else radii[i]
            ring.append(bm.verts.new(p + q @ Vector((math.cos(a) * r, math.sin(a) * r, 0))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(seg):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % seg], rings[i + 1][(j + 1) % seg], rings[i + 1][j]))
    if cap:                                                   # скруглённая верхушка: купол из колец
        p = pts[-1]; t = (pts[-1] - pts[-2]).normalized(); q = t.to_track_quat('Z', 'Y'); prev = rings[-1]
        for k in range(1, 5):
            a = k / 5 * math.pi / 2; ring = []
            for j in range(seg):
                b = j / seg * math.tau; r = radii[-1] * math.cos(a) * ((1 + depth * math.cos(ribs * b)) if ribs else 1)
                ring.append(bm.verts.new(p + q @ Vector((math.cos(b) * r, math.sin(b) * r, radii[-1] * 0.9 * math.sin(a)))))
            for j in range(seg): bm.faces.new((prev[j], prev[(j + 1) % seg], ring[(j + 1) % seg], ring[j]))
            prev = ring
        top = bm.verts.new(p + t * radii[-1] * 0.9)
        for j in range(seg): bm.faces.new((prev[j], prev[(j + 1) % seg], top))


def cactus(name, seed):
    """кактус-сагуаро: ребристый ствол 56–70 ед. со скруглённой верхушкой, 1–2 «руки» с коленом, колючки, иногда цветок"""
    sc, rng = scene(90, ((1.0, 0.88, 0.7), 5.0), seed)
    h = rng.uniform(56, 70); R = rng.uniform(5.2, 6.2); bm = bmesh.new()
    n = 24; pts = [Vector((0, 0, (-2 + (h - R) * i / n) * U)) for i in range(n + 1)]
    rib_tube(bm, pts, [R * U * (1.04 - 0.08 * i / n) for i in range(n + 1)], 12, 0.07)
    for sgn in (-1, 1):
        if rng.random() < 0.25: continue
        z0 = h * rng.uniform(0.32, 0.55); ah = h * rng.uniform(0.25, 0.4); r2 = R * 0.72; out = R * rng.uniform(1.9, 2.4)
        arm = []
        for k in range(17):
            if k <= 6:
                a = k / 6 * math.pi / 2
                arm.append(Vector((sgn * (R * 0.3 + (out - R * 0.3) * math.sin(a)), 0, z0 + (out - R * 0.3) * (1 - math.cos(a)))) * U)
            else:
                arm.append(Vector((sgn * out, 0, z0 + (out - R * 0.3) + (k - 6) * ah / 10)) * U)
        rib_tube(bm, arm, [r2 * U] * 17, 10, 0.07)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m, nt, b = mt.principled('cactus', 0.72, 0.25)
    vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 520
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.12
    mr.inputs['To Min'].default_value = 1.0; mr.inputs['To Max'].default_value = 0.0
    nt.links.new(vo.outputs['Distance'], mr.inputs['Value'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    nt.links.new(mr.outputs['Result'], mt.sock(mx.inputs, 'Factor_Float'))
    mt.sock(mx.inputs, 'A_Color').default_value = (*mt.lin((0.30, 0.44, 0.21)), 1); mt.sock(mx.inputs, 'B_Color').default_value = (*mt.lin((0.95, 0.92, 0.78)), 1)
    nt.links.new(mt.sock(mx.outputs, 'Result_Color'), b.inputs['Base Color'])                       # колючки — светлые точки в ареолах
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 120; nz.inputs['Detail'].default_value = 6
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.25
    nt.links.new(nz.outputs['Fac'], bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    obj(name, me, m, sc)
    if rng.random() < 0.5:
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=2.2 * U, matrix=Matrix.Translation(Vector((0.5 * U, -1 * U, (h - R * 0.1) * U))))
        me = bpy.data.meshes.new('flower'); bm.to_mesh(me); bm.free(); obj('flower', me, mat_col('flower', (0.98, 0.42, 0.62), 0.5, 0.3), sc)
    return sc


def palm(name, seed):
    """пальма: изогнутый ствол с кольцами 98–112 ед., крона из 9–11 перистых листьев с поникшими концами, кокосы"""
    sc, rng = scene(170, ((1.0, 0.86, 0.66), 5.0), seed)
    h = rng.uniform(98, 112); bend = rng.uniform(-0.25, 0.25) * h
    P0, P1, P2 = Vector((0, 0, -2)), Vector((bend * 0.15, 0, h * 0.55)), Vector((bend, 0, h))
    Q = lambda t: ((1 - t) ** 2 * P0 + 2 * (1 - t) * t * P1 + t * t * P2) * U
    bm = bmesh.new(); n = 40; pts = [Q(i / n) for i in range(n + 1)]
    radii = [(4.6 - 1.6 * i / n) * U * (1 + 0.07 * (1 - (i % 2))) for i in range(n + 1)]       # кольца-рубцы от старых листьев
    rib_tube(bm, pts, radii, 0, 0, 28, False)
    me = bpy.data.meshes.new('trunk'); bm.to_mesh(me); bm.free()
    obj('trunk', me, mt.mat_stone('palmbark', (0.30, 0.24, 0.18), (0.55, 0.47, 0.37), rough=0.85, spec=0.2, scale=30, bumpk=1.2), sc)
    top = Q(1.0); fl = bmesh.new(); cl = fl.loops.layers.float_color.new('Col')
    greens = [mt.lin(c) for c in ((0.18, 0.36, 0.10), (0.24, 0.44, 0.13), (0.30, 0.50, 0.16), (0.36, 0.54, 0.20))]
    nf = rng.randint(12, 15); rb = bmesh.new()
    for i in range(nf):
        a = (i / nf) * math.tau + rng.uniform(-0.2, 0.2); dead = False
        dirv = Vector((math.cos(a), math.sin(a) * 0.7, 0)).normalized(); L = rng.uniform(48, 64) * U
        lift = rng.uniform(0.25, 1.0) if i % 3 else rng.uniform(0.9, 1.5)        # часть листьев смотрит вверх — крона не «зонтик"

        def F(t, dirv=dirv, L=L, lift=lift):
            return top + dirv * (L * t) + Vector((0, 0, L * (lift * t - 0.75 * t * t)))
        pts = [F(k / 14) for k in range(15)]
        for k in range(14): mt._cone(rb, pts[k], pts[k + 1], 0.55 * U * (1 - k / 15), 0.5 * U * (1 - (k + 1) / 15), 5)
        col = mt.lin((0.52, 0.40, 0.20)) if dead else rng.choice(greens)
        for k in range(1, 40):
            t = k / 40; p = F(t); tg = (F(min(1, t + 0.02)) - F(max(0, t - 0.02))).normalized()
            side = tg.cross(Vector((0, 0, 1)))
            side = side.normalized() if side.length > 0.1 else Vector((1, 0, 0))
            for sg in (-1, 1):
                ll = (13 * (1 - 0.55 * t) + 2.5) * U * rng.uniform(0.85, 1.1)
                d = (side * sg * 0.8 + tg * 0.3 + Vector((0, 0, -0.65))).normalized()
                w = 1.05 * U; nrm = d.cross(tg).normalized() * w
                vs = [fl.verts.new(p - nrm), fl.verts.new(p + nrm), fl.verts.new(p + d * ll + nrm * 0.2), fl.verts.new(p + d * ll - nrm * 0.2)]
                f = fl.faces.new(vs); k2 = rng.uniform(0.85, 1.12); tip = 1 + 0.25 * t
                for lp in f.loops: lp[cl] = (min(1, col[0] * k2 * tip), min(1, col[1] * k2 * tip), min(1, col[2] * k2), 1)
    me = bpy.data.meshes.new('ribs'); rb.to_mesh(me); rb.free(); obj('ribs', me, mat_col('rib', (0.36, 0.40, 0.16), 0.7, 0.2), sc)
    me = bpy.data.meshes.new('fronds'); fl.to_mesh(me); fl.free()
    m, nt, b = mt.principled('frond', 0.5, 0.35)
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'; nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.2; break
    obj('fronds', me, m, sc)
    bm = bmesh.new()
    for j in range(rng.randint(3, 5)):
        c = top + Vector((rng.uniform(-3, 3) * U, rng.uniform(-3, 0) * U, rng.uniform(-6, -3) * U))
        bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=2.6 * U, matrix=Matrix.Translation(c))
    me = bpy.data.meshes.new('nuts'); bm.to_mesh(me); bm.free(); obj('nuts', me, mat_col('coconut', (0.32, 0.24, 0.12), 0.6, 0.3, 0.4, 200), sc)
    return sc


def deadtree(name, seed, charred):
    """сухое дерево 80–95 ед.: ствол и 4 уровня ветвей; в вулкане — обугленное, с тлеющими трещинами"""
    sc, rng = scene(130, ((1.0, 0.72, 0.5), 4.6) if charred else ((1.0, 0.86, 0.66), 5.0), seed)
    bm = bmesh.new(); tips = []
    trunk_top = Vector((rng.uniform(-3, 3) * U, 0, rng.uniform(30, 36) * U))
    mt._cone(bm, Vector((0, 0, -2 * U)), trunk_top, 3.4 * U, 2.2 * U, 14)
    for k in range(rng.randint(2, 3)):
        d = Vector((rng.uniform(-0.8, 0.8), rng.uniform(-0.3, 0.3), 1)).normalized()
        mt._branches(bm, trunk_top, d, rng.uniform(16, 24) * U, 1.9 * U, 3, rng, tips, 0.75, 0.62)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    if charred:
        m = mt.mat_stone('char', (0.05, 0.04, 0.04), (0.16, 0.12, 0.10), rough=0.9, spec=0.15, scale=40, bumpk=1.4)
        nt = m.node_tree; b = nt.nodes['Principled BSDF']
        vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = 45
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.012
        mr.inputs['To Min'].default_value = 3.5; mr.inputs['To Max'].default_value = 0.0
        nt.links.new(vo.outputs['Distance'], mr.inputs['Value'])
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 9; nz.inputs['Detail'].default_value = 3
        mk = nt.nodes.new('ShaderNodeMapRange'); mk.inputs['From Min'].default_value = 0.55; mk.inputs['From Max'].default_value = 0.62
        nt.links.new(nz.outputs['Fac'], mk.inputs['Value'])
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        nt.links.new(mr.outputs['Result'], mul.inputs[0]); nt.links.new(mk.outputs['Result'], mul.inputs[1])
        if 'Emission Strength' in b.inputs: nt.links.new(mul.outputs['Value'], b.inputs['Emission Strength'])
        for key in ('Emission Color', 'Emission'):
            if key in b.inputs: b.inputs[key].default_value = (1.0, 0.32, 0.05, 1); break
    else:
        m = mt.mat_stone('drywood', (0.36, 0.30, 0.24), (0.66, 0.59, 0.50), rough=0.85, spec=0.2, scale=25, bumpk=1.1)
    obj(name, me, m, sc)
    if charred:
        # v93 (эталон вулкана: на концах веток — гроздья тлеющих оранжевых угольков; критик r34: «чёрная вырезка»):
        # на 70 % кончиков по 2–4 светящихся шарика 0,55–1,15 ед. (сердцевина жёлто-оранжевая, край темнее), снизу — оранжевый
        # отсвет лавы на коре (точечный свет у земли)
        eb = [bmesh.new() for _ in range(2)]
        for tp in tips:
            if rng.random() < 0.3: continue                                    # часть кончиков голые: гроздья раздельные, ветки видны
            for _ in range(rng.randint(2, 4)):
                off = Vector((rng.gauss(0, 1.0), rng.gauss(0, 0.6), rng.gauss(0.4, 0.8))) * U
                k = 0 if rng.random() < 0.55 else 1
                bmesh.ops.create_icosphere(eb[k], subdivisions=2, radius=rng.uniform(0.55, 1.15) * U, matrix=Matrix.Translation(tp + off))
        for k, bm_ in enumerate(eb):
            me2 = bpy.data.meshes.new(name + '_e%d' % k); bm_.to_mesh(me2); bm_.free()
            obj(name + '_e%d' % k, me2, mat_glow('ember%d' % k, (0.45, 0.09, 0.01) if k else (0.75, 0.24, 0.02), (1.0, 0.28, 0.03) if k else (1.0, 0.45, 0.06), 0.55 if k else 0.9, 0.6), sc)   # AgX: яркое свечение уходит в белый — умеренная сила, насыщенный цвет
        ld = bpy.data.lights.new('lavaglow', 'POINT'); ld.energy = 4.0; ld.color = (1.0, 0.42, 0.12); ld.shadow_soft_size = 0.2
        lo = bpy.data.objects.new('lavaglow', ld); lo.location = (0, -0.25, -0.05); sc.collection.objects.link(lo)
    return sc


def igloo(name, seed):
    """иглу из снежных блоков: купол R=34 ед. рядами кирпичей со швами, вход-тоннель справа, снег присыпал низ"""
    sc, rng = scene(90, ((0.86, 0.9, 1.0), 4.2), seed)
    R = 34.0; bm = bmesh.new(); rows = 7
    for k in range(rows):
        a0 = k / rows * math.pi / 2; a1 = (k + 1) / rows * math.pi / 2 - 0.012
        r0, r1 = R * math.cos(a0), R * math.cos(a1); z0, z1 = R * math.sin(a0), R * math.sin(a1)
        nb = max(5, int(round(2 * math.pi * r0 / 13))); off = rng.uniform(0, 1)
        for j in range(nb):
            t0 = (j + off) / nb * math.tau + 0.01; t1 = (j + 1 + off) / nb * math.tau - 0.01
            vs = []
            for (r, z) in ((r0, z0), (r1, z1)):
                for t in (t0, t1):
                    vs.append(Vector((math.cos(t) * r, math.sin(t) * r, z)) * U)
            o = [v * 0.94 for v in vs]                                        # толщина блока внутрь
            V = [bm.verts.new(v) for v in vs + o]
            for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6)):
                try: bm.faces.new([V[i] for i in f])
                except ValueError: pass
    # вход: полутоннель справа
    for k in range(9):
        t0 = k / 9 * math.pi + 0.01; t1 = (k + 1) / 9 * math.pi - 0.01
        V = []
        for (xx, rr) in ((R * 0.62, 15), (R * 1.08, 15)):
            for t in (t0, t1): V.append(bm.verts.new(Vector((xx, -math.cos(t) * rr, math.sin(t) * rr)) * U))
        for (xx, rr) in ((R * 0.62, 13.6), (R * 1.08, 13.6)):
            for t in (t0, t1): V.append(bm.verts.new(Vector((xx, -math.cos(t) * rr, math.sin(t) * rr)) * U))
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)):
            try: bm.faces.new([V[i] for i in f])
            except ValueError: pass
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = obj(name, me, mat_snow('blocks'), sc); o.rotation_euler = (0, 0, math.radians(-35))   # вход повёрнут к зрителю
    bv = o.modifiers.new('bev', 'BEVEL'); bv.width = 0.006; bv.segments = 3
    dark = bmesh.new(); bmesh.ops.create_cone(dark, cap_ends=True, segments=32, radius1=12.6 * U, radius2=12.6 * U, depth=2 * U,
                                                matrix=Matrix.Translation(Vector((R * 1.09 * U, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    me2 = bpy.data.meshes.new('door'); dark.to_mesh(me2); dark.free(); obj('door', me2, mat_col('dark', (0.06, 0.08, 0.12), 0.9, 0.1), sc).rotation_euler = (0, 0, math.radians(-35))
    drift = lumpy_sphere('drift', Vector((0, 0, -6 * U)), 44 * U, seed, 0.12, 0.18); obj('drift', drift, mat_snow('drift'), sc)
    return sc


def icecrystal(name, seed):
    """ледяные осколки: 4–6 гранёных призм веером вверх, полупрозрачный лёд (стекло со светлым ядром)"""
    sc, rng = scene(48, ((0.86, 0.9, 1.0), 4.2), seed); sc.cycles.film_transparent_glass = True
    bm = bmesh.new()
    for i in range(rng.randint(4, 6)):
        a = rng.uniform(-0.55, 0.55); L = rng.uniform(12, 26); w = rng.uniform(2.6, 4.6)
        d = Vector((math.sin(a), rng.uniform(-0.3, 0.3), math.cos(a))).normalized()
        base = Vector((rng.uniform(-4, 4), rng.uniform(-2, 2), -1)) * U
        q = d.to_track_quat('Z', 'Y'); ring = []
        for j in range(6):
            t = j / 6 * math.tau + rng.uniform(-0.15, 0.15); ring.append(bm.verts.new(base + q @ Vector((math.cos(t) * w, math.sin(t) * w * 0.8, 0)) * U))
        top = []
        for j in range(6):
            t = j / 6 * math.tau; top.append(bm.verts.new(base + q @ Vector((math.cos(t) * w * 0.85, math.sin(t) * w * 0.7, L * 0.78)) * U))
        tip = bm.verts.new(base + d * L * U)
        for j in range(6):
            bm.faces.new((ring[j], ring[(j + 1) % 6], top[(j + 1) % 6], top[j])); bm.faces.new((top[j], top[(j + 1) % 6], tip))
        bm.faces.new(list(reversed(ring)))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m, nt, b = mt.principled('ice', 0.08, 0.5); b.inputs['Base Color'].default_value = (0.78, 0.92, 1.0, 1)
    for key in ('Transmission Weight', 'Transmission'):
        if key in b.inputs: b.inputs[key].default_value = 0.85; break
    b.inputs['IOR'].default_value = 1.31
    for p in me.polygons: p.use_smooth = False
    me.materials.append(m); o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    return sc


def mat_glow(name, base, emit, strength, rough=0.25, trans=0.0):
    m, nt, b = mt.principled(name, rough, 0.5); b.inputs['Base Color'].default_value = (*mt.lin(base), 1)
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (*mt.lin(emit), 1); break
    if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = strength
    if trans:
        for key in ('Transmission Weight', 'Transmission'):
            if key in b.inputs: b.inputs[key].default_value = trans; break
    return m


def prism(bm, base, d, L, w, sides=6, tip=0.22, rng=None, flat=0.85):
    """гранёная призма с заострённой верхушкой от base по направлению d"""
    q = d.to_track_quat('Z', 'Y'); ring, top = [], []
    for j in range(sides):
        t = j / sides * math.tau + (rng.uniform(-0.12, 0.12) if rng else 0)
        ring.append(bm.verts.new(base + q @ Vector((math.cos(t) * w, math.sin(t) * w * flat, 0))))
        top.append(bm.verts.new(base + q @ Vector((math.cos(t) * w * 0.92, math.sin(t) * w * 0.92 * flat, L * (1 - tip)))))
    apex = bm.verts.new(base + d * L)
    for j in range(sides):
        k = (j + 1) % sides
        bm.faces.new((ring[j], ring[k], top[k], top[j])); bm.faces.new((top[j], top[k], apex))
    bm.faces.new(list(reversed(ring)))


def watertower(name, seed):
    """деревянная водонапорная башня каньона: 4 опоры с раскосами, бак из клёпок с железными обручами, конусная крыша, лестница"""
    sc, rng = scene(180, ((1.0, 0.84, 0.62), 5.2), seed)
    wood = mt.mat_wood('wood', (0.33, 0.22, 0.13), (0.62, 0.45, 0.28)); iron = mat_col('iron', (0.16, 0.13, 0.11), 0.55, 0.45, 0.6, 300)
    bm = bmesh.new()
    legs = [(-26, -12), (26, -12), (-26, 12), (26, 12)]
    for (lx, ly) in legs:
        mt._cone(bm, Vector((lx * U, ly * U, -2 * U)), Vector((lx * 0.8 * U, ly * 0.8 * U, 112 * U)), 2.4 * U, 2.0 * U, 8)
    for k in range(3):                                         # раскосы спереди и сзади
        z0, z1 = k * 36, (k + 1) * 36
        for ly in (-12, 12):
            a = Vector((-25.5 * U, ly * U, z0 * U)); b = Vector((24.5 * U, ly * U, z1 * U)); mt._cone(bm, a, b, 0.9 * U, 0.9 * U, 6)
            a = Vector((25.5 * U, ly * U, z0 * U)); b = Vector((-24.5 * U, ly * U, z1 * U)); mt._cone(bm, a, b, 0.9 * U, 0.9 * U, 6)
        for ly in (-12, 12): mt._cone(bm, Vector((-25 * U, ly * U, z1 * U)), Vector((25 * U, ly * U, z1 * U)), 1.0 * U, 1.0 * U, 6)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=31 * U, radius2=31 * U, depth=2.2 * U, matrix=Matrix.Translation(Vector((0, 0, 112 * U))))
    for j in range(30):                                        # клёпки бака
        t0 = j / 30 * math.tau; t1 = (j + 1) / 30 * math.tau - 0.012; r0 = 28 * U; z0 = 113 * U; z1 = 157 * U
        V = [bm.verts.new(Vector((math.cos(t) * rr, math.sin(t) * rr, z))) for z in (z0, z1) for t in (t0, t1) for rr in (r0,)]
        Vi = [bm.verts.new(Vector((math.cos(t) * r0 * 0.94, math.sin(t) * r0 * 0.94, z))) for z in (z0, z1) for t in (t0, t1)]
        for f in ((0, 1, 3, 2),): bm.faces.new([V[i] for i in f])
        bm.faces.new((Vi[0], Vi[2], Vi[3], Vi[1])); bm.faces.new((V[0], V[2], Vi[2], Vi[0])); bm.faces.new((V[1], Vi[1], Vi[3], V[3]))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=31 * U, radius2=1 * U, depth=16 * U, matrix=Matrix.Translation(Vector((0, 0, 165 * U))))
    for (lx, ly) in ((30, -14),):                              # лестница
        for dx in (-3, 3): mt._cone(bm, Vector(((lx + dx) * U, ly * U, -2 * U)), Vector(((lx + dx) * U, ly * U, 113 * U)), 0.6 * U, 0.6 * U, 6)
        for zz in range(4, 112, 6): mt._cone(bm, Vector(((lx - 3) * U, ly * U, zz * U)), Vector(((lx + 3) * U, ly * U, zz * U)), 0.4 * U, 0.4 * U, 5)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); obj(name, me, wood, sc)
    bm = bmesh.new()
    for z in (118, 135, 152):
        bmesh.ops.create_cone(bm, cap_ends=False, segments=48, radius1=28.6 * U, radius2=28.6 * U, depth=1.4 * U, matrix=Matrix.Translation(Vector((0, 0, z * U))))
    me = bpy.data.meshes.new('hoops'); bm.to_mesh(me); bm.free(); obj('hoops', me, iron, sc)
    return sc


def crystals(name, seed, col):
    """кристаллы Alien: 5–7 светящихся изнутри гранёных призм веером из каменного основания"""
    sc, rng = scene(56, ((0.85, 0.85, 1.0), 3.6), seed)
    bm = bmesh.new()
    for i in range(rng.randint(5, 7)):
        a = (i / 6 - 0.5) * 1.3 + rng.uniform(-0.12, 0.12); L = rng.uniform(14, 30) * (1.3 if abs(a) < 0.25 else 1); w = rng.uniform(2.6, 4.6)
        d = Vector((math.sin(a), rng.uniform(-0.35, 0.35), math.cos(a))).normalized()
        prism(bm, Vector((rng.uniform(-5, 5), rng.uniform(-3, 3), -1)) * U, d, L * U, w * U, 6, 0.24, rng)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = False
    deep = tuple(c * 0.34 for c in col)   # v91: насыщеннее (эталон) — прежние 0.55 и свечение 0.55 давали пастельные «леденцы»
    o = obj(name, me, mat_glow('crystal', deep, col, 0.32, 0.04, 0.3), sc)
    for p in me.polygons: p.use_smooth = False
    base = lumpy_sphere('base', Vector((0, 0, -2 * U)), 9 * U, seed, 0.25, 0.45); obj('base', base, mt.mat_stone('rockb', (0.12, 0.10, 0.14), (0.30, 0.27, 0.32), rough=0.85, spec=0.2, scale=60, bumpk=1.3), sc)
    return sc



def crystals_hang(name, seed, col):
    """v90: кристаллы под сводом острова (эталон Alien: тонкие гранёные призмы остриём вниз, бирюза и пурпур) — 1–3 вытянутые
    призмы почти параллельно, без каменного основания (перевёрнутый веер с основанием выглядел «медузой» с щупальцами).
    Рисуются в игре вверх ногами; цвет насыщенный, сердцевина светится, грани с бликами"""
    sc, rng = scene(56, ((0.85, 0.85, 1.0), 3.6), seed)
    bm = bmesh.new(); n = rng.choice((1, 2, 2, 3))
    for i in range(n):
        a = (i - (n - 1) / 2) * 0.22 + rng.uniform(-0.08, 0.08); L = rng.uniform(26, 44) * (1 if i == n // 2 else rng.uniform(0.5, 0.8)); w = rng.uniform(2.4, 3.8)
        d = Vector((math.sin(a), rng.uniform(-0.25, 0.25), math.cos(a))).normalized()
        prism(bm, Vector(((i - (n - 1) / 2) * 3.2 + rng.uniform(-0.8, 0.8), rng.uniform(-1.5, 1.5), -2)) * U, d, L * U, w * U, 6, 0.2, rng, 0.8)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    deep = tuple(c * 0.32 for c in col)
    obj(name, me, mat_glow('crystal', deep, col, 0.38, 0.05, 0.3), sc)
    for p in me.polygons: p.use_smooth = False
    return sc

def obsidian(name, seed):
    """обсидиан: 3–4 острых осколка вулканического стекла, чёрные с лиловым отливом и бликами"""
    sc, rng = scene(36, ((1.0, 0.7, 0.5), 4.6), seed)
    bm = bmesh.new()
    for i in range(rng.randint(3, 4)):
        a = rng.uniform(-0.5, 0.5); d = Vector((math.sin(a), rng.uniform(-0.3, 0.3), math.cos(a))).normalized()
        prism(bm, Vector((rng.uniform(-6, 6), rng.uniform(-2, 2), -1)) * U, d, rng.uniform(10, 22) * U, rng.uniform(3, 5.5) * U, rng.choice((3, 4, 5)), 0.5, rng, 0.7)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m, nt, b = mt.principled('obsidian', 0.06, 0.9); b.inputs['Base Color'].default_value = (0.012, 0.009, 0.018, 1)
    for key in ('Coat Weight', 'Clearcoat'):
        if key in b.inputs: b.inputs[key].default_value = 0.8; break
    obj(name, me, m, sc)
    for p in me.polygons: p.use_smooth = False
    return sc


def lavarock(name, seed):
    """остывающая лава: бугристый тёмный камень, по трещинам светится"""
    sc, rng = scene(34, ((1.0, 0.7, 0.5), 4.6), seed)
    # v57: бугристее и угловатее; трещины рваные (искажённые шумом), светится лишь треть из них и тоньше — не «панцирь»
    me = lumpy_sphere(name, Vector((0, 0, 4 * U)), 11 * U, seed, 0.42, 0.58)
    m = mt.mat_stone('lava', (0.05, 0.04, 0.035), (0.22, 0.17, 0.15), rough=0.92, spec=0.12, scale=70, bumpk=2.0)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; N_, L_ = nt.nodes, nt.links
    tc = N_.new('ShaderNodeTexCoord'); dn = N_.new('ShaderNodeTexNoise'); dn.inputs['Scale'].default_value = 6; dn.inputs['Detail'].default_value = 6
    L_.new(tc.outputs['Object'], dn.inputs['Vector'])
    mix = N_.new('ShaderNodeVectorMath'); mix.operation = 'MULTIPLY_ADD'; mix.inputs[1].default_value = (0.35, 0.35, 0.35)
    L_.new(dn.outputs['Color'], mix.inputs[0]); L_.new(tc.outputs['Object'], mix.inputs[2])
    vo = N_.new('ShaderNodeTexVoronoi'); vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = 3.2; L_.new(mix.outputs['Vector'], vo.inputs['Vector'])
    mr = N_.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.009
    mr.inputs['To Min'].default_value = 4.0; mr.inputs['To Max'].default_value = 0.0
    L_.new(vo.outputs['Distance'], mr.inputs['Value'])
    mk = N_.new('ShaderNodeTexNoise'); mk.inputs['Scale'].default_value = 2.2; L_.new(tc.outputs['Object'], mk.inputs['Vector'])
    gate = N_.new('ShaderNodeMapRange'); gate.inputs['From Min'].default_value = 0.52; gate.inputs['From Max'].default_value = 0.6
    L_.new(mk.outputs['Fac'], gate.inputs['Value'])
    mul = N_.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; L_.new(mr.outputs['Result'], mul.inputs[0]); L_.new(gate.outputs['Result'], mul.inputs[1])
    if 'Emission Strength' in b.inputs: L_.new(mul.outputs['Value'], b.inputs['Emission Strength'])
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (1.0, 0.30, 0.04, 1); break
    obj(name, me, m, sc)
    return sc


def spike(name, seed):
    """обсидиановый шип 50–70 ед.: гранёный конус, зеркальные грани, по одной грани — раскалённая трещина"""
    sc, rng = scene(84, ((1.0, 0.7, 0.5), 4.6), seed)
    bm = bmesh.new(); prism(bm, Vector((0, 0, -2 * U)), Vector((rng.uniform(-0.08, 0.08), 0, 1)).normalized(), rng.uniform(52, 68) * U, 13 * U, 7, 0.9, rng, 0.8)
    for i in range(2):
        a = rng.choice((-1, 1)) * rng.uniform(0.25, 0.5)
        prism(bm, Vector((rng.uniform(-9, 9), rng.uniform(-3, 3), -2)) * U, Vector((math.sin(a), 0, math.cos(a))).normalized(), rng.uniform(16, 28) * U, rng.uniform(4, 6) * U, 5, 0.8, rng, 0.8)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m, nt, b = mt.principled('obs', 0.1, 0.85); b.inputs['Base Color'].default_value = (0.02, 0.016, 0.026, 1)
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3.5; nz.inputs['Detail'].default_value = 4
    sub = nt.nodes.new('ShaderNodeMath'); sub.operation = 'PINGPONG'; sub.inputs[1].default_value = 0.5
    nt.links.new(nz.outputs['Fac'], sub.inputs[0])
    lt = nt.nodes.new('ShaderNodeMapRange'); lt.inputs['From Min'].default_value = 0.488; lt.inputs['From Max'].default_value = 0.5
    lt.inputs['To Min'].default_value = 0.0; lt.inputs['To Max'].default_value = 2.5
    nt.links.new(sub.outputs['Value'], lt.inputs['Value'])
    if 'Emission Strength' in b.inputs: nt.links.new(lt.outputs['Result'], b.inputs['Emission Strength'])
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (1.0, 0.34, 0.05, 1); break
    obj(name, me, m, sc)
    for p in me.polygons: p.use_smooth = False
    return sc


def skull(name, seed):
    """бычий череп: вытянутая морда с глазницами и ноздрями, рога дугой; выбеленная кость с пылью в углублениях"""
    sc, rng = scene(44, ((1.0, 0.86, 0.66), 5.0), seed)
    bone = mt.mat_stone('bone', (0.62, 0.56, 0.46), (0.92, 0.88, 0.80), rough=0.7, spec=0.25, scale=40, bumpk=0.6)
    head = lumpy_sphere('head', Vector((0, 0, 9 * U)), 7 * U, seed, 0.05, 1.0)
    for v in head.vertices:                                    # широкий лоб, длинная сужающаяся морда вниз
        z = v.co.z - 9 * U
        if z < 0: v.co.z = 9 * U + z * 1.55; v.co.x *= 1 + z / (7 * U) * 0.45; v.co.y *= 1 + z / (7 * U) * 0.25
    obj('head', head, bone, sc)
    bm = bmesh.new()
    for sgn in (-1, 1):
        pts = [Vector((sgn * (5 + 13 * t) * U, -1 * U, (10 + 9 * math.sin(t * 2.4)) * U)) for t in [k / 14 for k in range(15)]]
        rib_tube(bm, pts, [(1.9 - 1.5 * k / 14) * U for k in range(15)], 0, 0, 14, True)
    me = bpy.data.meshes.new('horns'); bm.to_mesh(me); bm.free(); obj('horns', me, mat_col('horn', (0.78, 0.72, 0.60), 0.5, 0.35, 0.3, 120), sc)
    bm = bmesh.new()
    for (x, z, r, y) in ((-3.3, 10.5, 2.1, -4.6), (3.3, 10.5, 2.1, -4.6), (-0.8, 0.6, 0.7, -3.4), (0.8, 0.6, 0.7, -3.4)):   # глазницы и ноздри — углубления
        bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=r * U, matrix=Matrix.Translation(Vector((x * U, y * U, z * U))) @ Matrix.Diagonal((1, 0.6, 1.2, 1)))
    me = bpy.data.meshes.new('holes'); bm.to_mesh(me); bm.free(); obj('holes', me, mat_col('hole', (0.05, 0.04, 0.03), 0.9, 0.1), sc)
    return sc


def bones(name, seed):
    """кости в песке: дуги рёбер и длинная кость"""
    sc, rng = scene(44, ((1.0, 0.86, 0.66), 5.0), seed)
    # v57: рёбра неровные — разной длины, наклона и кривизны, вдоль позвоночника; часть ушла в грунт (ниже z=0)
    bm = bmesh.new()
    for i in range(5):
        R = rng.uniform(10, 14) * (1 - i * 0.06); a0 = rng.uniform(0.06, 0.12); a1 = rng.uniform(0.6, 0.7); sx = -10 + i * 3.6
        kz = rng.uniform(0.85, 1.0); pts = [Vector(((sx + (math.cos(a) - 1) * R * 0.5) * U, (i - 2) * 1.2 * U, (math.sin(a) * R * kz - 0.6) * U)) for a in [math.pi * (a0 + (a1 - a0) * k / 10) for k in range(11)]]
        rib_tube(bm, pts, [(1.0 - 0.45 * k / 10) * U for k in range(11)], 0, 0, 9, True)
    for k in range(9):   # позвонки — бугристые бусины вдоль хребта
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=rng.uniform(0.9, 1.2) * U, matrix=Matrix.Translation(Vector(((-14 + k * 2.4) * U, 1.5 * U, (0.9 + rng.uniform(-0.2, 0.2)) * U))) @ Matrix.Diagonal(Vector((1.0, 0.8, 1.1, 1))))
    rib_tube(bm, [Vector(((-16 + 26 * t) * U, -6 * U, (1 + 0.6 * t) * U)) for t in [k / 10 for k in range(11)]], [1.3 * U * (1.4 if k in (0, 10) else 1) for k in range(11)], 0, 0, 12, True)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj(name, me, mt.mat_stone('bone', (0.62, 0.56, 0.46), (0.92, 0.88, 0.80), rough=0.7, spec=0.25, scale=40, bumpk=0.6), sc)
    return sc


def alienplant(name, seed):
    """v91: светящийся папоротник Alien: 5–8 изогнутых вай с листочками по обе стороны, часть вай закручена «улиткой», на 1–3 —
    маленький светящийся бутон (прежние толстые стебли с большими бледными шарами выглядели игрушечными)"""
    sc, rng = scene(40, ((1.0, 0.88, 0.76), 4.2), seed)
    st = bmesh.new(); lv = bmesh.new(); bb = bmesh.new()
    glow_n = rng.randint(1, 3)
    for i in range(rng.randint(5, 8)):
        h = rng.uniform(12, 26); a = rng.uniform(-0.75, 0.75); x0 = rng.uniform(-3, 3); y0 = rng.uniform(-3, 3)
        curl = rng.random() < 0.45 and i >= glow_n
        pts = []
        for k in range(15):
            t = k / 14; bend = math.sin(a) * h * t * t * 0.9
            pts.append(Vector(((x0 + bend) * U, y0 * U, (h * t * (1 - 0.15 * t * t) - 1) * U)))
        if curl:                                                             # «улитка» на конце вайи
            p = pts[-1]; d = (pts[-1] - pts[-2]).normalized(); sgn = 1 if a >= 0 else -1
            for k in range(1, 9):
                ang = k / 8 * math.pi * 1.6; r_ = 2.2 * (1 - k / 11)
                pts.append(p + Vector((sgn * (1 - math.cos(ang)) * r_, 0, math.sin(ang) * r_)) * U)
        rib_tube(st, pts, [(0.42 * (1 - 0.7 * k / len(pts))) * U for k in range(len(pts))], 0, 0, 8, False)
        for k in range(2, 13):                                               # листочки парами
            t = k / 14; c = pts[k]; d = (pts[k + 1] - pts[k]).normalized()
            for sd in (-1, 1):
                side = d.cross(Vector((0, 1, 0))).normalized() * sd
                dd = (side * 0.8 + d * 0.5).normalized()
                L = (2.8 - 1.6 * t) * rng.uniform(0.85, 1.15)
                leaf_strip(lv, c, dd, d.cross(dd).normalized() if d.cross(dd).length > 1e-6 else Vector((0, 1, 0)), L * U, L * 0.28 * U, 0.25, 4, 0.1)
        if i < glow_n:
            bmesh.ops.create_uvsphere(bb, u_segments=14, v_segments=10, radius=rng.uniform(0.9, 1.3) * U, matrix=Matrix.Translation(pts[-1] + Vector((0, 0, 0.8 * U))) @ Matrix.Diagonal((1, 1, 1.3, 1)))
    me = bpy.data.meshes.new('stems'); st.to_mesh(me); st.free(); obj('stems', me, mat_col('fstem', (0.14, 0.30, 0.20), 0.55, 0.3), sc)
    me = bpy.data.meshes.new('fronds'); lv.to_mesh(me); lv.free()
    m = mat_col('frond', (0.16, 0.36, 0.24), 0.5, 0.35); b = m.node_tree.nodes['Principled BSDF']
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.3; break
    obj('fronds', me, m, sc)
    me = bpy.data.meshes.new('buds'); bb.to_mesh(me); bb.free(); obj('buds', me, mat_glow('bud', (0.2, 0.75, 0.68), (0.35, 1.0, 0.88), 1.2, 0.3, 0.2), sc)
    return sc

def pod(name, seed):
    """v91: вместо светящегося «яйца» (в эталоне его нет) — куртинка люпина: 4–7 цветоносов с колосом мелких цветков (лиловые,
    к верхушке светлее и мельче), у основания пальчатые тёмно-зелёные листья"""
    sc, rng = scene(36, ((1.0, 0.88, 0.76), 4.4), seed)
    st = bmesh.new(); lv = bmesh.new(); fl = [bmesh.new() for _ in range(3)]
    hue = rng.choice(((0.62, 0.32, 0.95), (0.85, 0.35, 0.92), (0.50, 0.40, 1.0)))
    for i in range(rng.randint(4, 7)):
        h = rng.uniform(15, 28); x0 = rng.uniform(-6, 6); y0 = rng.uniform(-3, 3); lean = rng.uniform(-3, 3)
        pts = [Vector(((x0 + lean * t * t) * U, y0 * U, (h * t - 1) * U)) for t in [k / 10 for k in range(11)]]
        rib_tube(st, pts, [(0.42 - 0.2 * k / 10) * U for k in range(11)], 0, 0, 8, False)
        n = int(h * 2.2)
        for f in range(n):                                                   # колос: мутовки цветков по спирали
            t = 0.5 + 0.5 * f / n; ang = f * 2.39996; zr = (1 - (t - 0.5) * 1.5)
            c = Vector(((x0 + lean * t * t) * U, y0 * U, (h * t - 1) * U)); r_ = (1.3 * zr + 0.25) * U
            off = Vector((math.cos(ang), math.sin(ang) * 0.9, 0)) * r_
            k = 0 if t < 0.66 else 1 if t < 0.86 else 2
            M = Matrix.Translation(c + off) @ Matrix.Diagonal(Vector(((0.95 * zr + 0.35) * 1.1 * U, (0.8 * zr + 0.3) * 1.1 * U, (0.7 * zr + 0.3) * 1.1 * U, 1)))
            bmesh.ops.create_icosphere(fl[k], subdivisions=1, radius=1.0, matrix=M)
    for i in range(rng.randint(5, 8)):                                       # пальчатые листья у земли
        cx = rng.uniform(-7, 7); cz = rng.uniform(0.5, 3.0); base = Vector((cx, rng.uniform(-3, 2), cz)) * U
        for q in range(rng.randint(5, 7)):
            a = q / 6 * math.pi + rng.uniform(-0.15, 0.15)
            d = Vector((math.cos(a), rng.uniform(-0.4, 0.2), math.sin(a) * 0.6 + 0.15)).normalized()
            side = d.cross(Vector((0, 1, 0))).normalized() if abs(d.y) < 0.9 else Vector((1, 0, 0))
            leaf_strip(lv, base, d, side, rng.uniform(3.5, 5.5) * U, rng.uniform(0.6, 0.9) * U, 0.35, 5, -0.15)
    me = bpy.data.meshes.new(name + '_s'); st.to_mesh(me); st.free(); obj(name + '_s', me, mat_col('lstem', (0.18, 0.26, 0.10), 0.6, 0.3), sc)
    me = bpy.data.meshes.new(name + '_l'); lv.to_mesh(me); lv.free(); obj(name + '_l', me, mat_col('lleaf', (0.15, 0.24, 0.09), 0.5, 0.35), sc)
    for k, bm_ in enumerate(fl):
        col = tuple(min(1.0, c * (0.62 + 0.22 * k) + 0.1 * k) for c in hue)
        me = bpy.data.meshes.new(name + '_f%d' % k); bm_.to_mesh(me); bm_.free()
        m, nt, b = mt.principled('lup%d' % k, 0.5, 0.3); b.inputs['Base Color'].default_value = (*mt.lin(col), 1)
        for key in ('Subsurface Weight', 'Subsurface'):
            if key in b.inputs: b.inputs[key].default_value = 0.3; break
        obj(name + '_f%d' % k, me, m, sc)
    return sc

def tentacle(name, seed):
    """щупальца Alien: 4 фиолетовых изогнутых отростка с присосками, к кончику светлее"""
    sc, rng = scene(72, ((0.85, 0.85, 1.0), 3.8), seed)
    bm = bmesh.new()
    for i in range(4):
        h = rng.uniform(30, 52); sw = rng.uniform(-14, 14); x0 = (i - 1.5) * 7
        pts = []
        for k in range(21):
            t = k / 20; pts.append(Vector(((x0 + sw * math.sin(t * 3.0) * t) * U, (i % 2 - 0.5) * 3 * U, (h * t - 1) * U)))
        rib_tube(bm, pts, [(3.0 - 2.4 * k / 20) * U for k in range(21)], 0, 0, 16, True)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m = mt.mat_stone('tent', (0.22, 0.09, 0.36), (0.56, 0.30, 0.74), rough=0.45, spec=0.5, scale=30, bumpk=0.5)
    obj(name, me, m, sc)
    return sc


def boulder(name, seed, dark, light, snow=False, moss=0.0):
    """валун с колотыми гранями: ширина 18–30 ед., высота 12–20; snow — шапка снега на верхних гранях"""
    sc, rng = scene(36, ((0.86, 0.9, 1.0), 4.4) if snow else ((1.0, 0.86, 0.66), 5.0), seed)
    me = mt.rock_mesh(name, 9 * U, rng.uniform(1.25, 1.6), rng.uniform(0.8, 1.0), rng.uniform(0.8, 1.05), seed * 1.7, 0.18, 4, 6)
    zmin = min(v.co.z for v in me.vertices)
    for v in me.vertices: v.co.z -= zmin + 2.5 * U                       # чуть утоплен в землю
    m = mt.mat_stone('rock', dark, light, rough=0.8, spec=0.25, scale=14, bumpk=1.2, moss=moss, detail=0.4)
    if snow:
        nt = m.node_tree; b = nt.nodes['Principled BSDF']
        geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Normal'], sep.inputs[0])
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 40; nz.inputs['Detail'].default_value = 5
        ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'MULTIPLY_ADD'; nt.links.new(nz.outputs['Fac'], ad.inputs[0]); ad.inputs[1].default_value = 0.35; nt.links.new(sep.outputs['Z'], ad.inputs[2])
        th = nt.nodes.new('ShaderNodeMapRange'); th.inputs['From Min'].default_value = 0.72; th.inputs['From Max'].default_value = 0.8
        nt.links.new(ad.outputs['Value'], th.inputs['Value'])
        src = b.inputs['Base Color'].links[0].from_socket
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
        nt.links.new(th.outputs['Result'], mt.sock(mx.inputs, 'Factor_Float')); nt.links.new(src, mt.sock(mx.inputs, 'A_Color'))
        mt.sock(mx.inputs, 'B_Color').default_value = (0.86, 0.9, 0.97, 1)
        nt.links.new(mt.sock(mx.outputs, 'Result_Color'), b.inputs['Base Color'])
    obj(name, me, m, sc)
    return sc



def mat_marble(name, seed):
    """выветренный мрамор: тёплый кремовый с прожилками, пыль и копоть глубже (по высоте вниз), мелкие сколы — шероховатость"""
    m, nt, b = mt.principled(name, 0.48, 0.38)
    N, L = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord')
    vein = N.new('ShaderNodeTexWave'); vein.wave_type = 'BANDS'; vein.inputs['Scale'].default_value = 14; vein.inputs['Distortion'].default_value = 9
    vein.inputs['Detail'].default_value = 6; L.new(tc.outputs['Object'], vein.inputs['Vector'])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 40; nz.inputs['Detail'].default_value = 10; L.new(tc.outputs['Object'], nz.inputs['Vector'])
    # v97 (замер эталона каньона: колонны 178/133/101, светлые грани 243/206/158; у нас были белёсые 209/192/183): теплее и темнее
    ramp = N.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (*mt.lin((0.66, 0.48, 0.32)), 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (*mt.lin((0.93, 0.76, 0.54)), 1)
    mix = N.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'; mix.inputs[1].default_value = 0.35; mix.inputs[2].default_value = 0.4
    L.new(vein.outputs['Fac'], mix.inputs[0]); add = N.new('ShaderNodeMath'); add.operation = 'ADD'; L.new(mix.outputs['Value'], add.inputs[0]); L.new(nz.outputs['Fac'], add.inputs[1])
    sc = N.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 0.62; L.new(add.outputs['Value'], sc.inputs[0])
    L.new(sc.outputs['Value'], ramp.inputs['Fac']); L.new(ramp.outputs['Color'], b.inputs['Base Color'])
    chips = N.new('ShaderNodeTexNoise'); chips.inputs['Scale'].default_value = 220; chips.inputs['Detail'].default_value = 12; L.new(tc.outputs['Object'], chips.inputs['Vector'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.28; bu.inputs['Distance'].default_value = 0.002
    L.new(chips.outputs['Fac'], bu.inputs['Height']); L.new(bu.outputs['Normal'], b.inputs['Normal'])
    return m


def mat_weathered(name, seed):
    """выветренный известняк руин долины (v89, r34: «белый цилиндр» — мраморная колонна каньона в долине выбивалась):
    серо-бурый камень с тёмными потёками вниз, лишайник пятнами и мох в нижней трети и в каннелюрах"""
    m, nt, b = mt.principled(name, 0.82, 0.22)
    N, L = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Object'], sep.inputs[0])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 30; nz.inputs['Detail'].default_value = 10; L.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB'); E = ramp.color_ramp.elements
    E[0].position = 0.3; E[0].color = (*mt.lin((0.36, 0.34, 0.30)), 1); E[1].position = 0.72; E[1].color = (*mt.lin((0.66, 0.62, 0.55)), 1)
    L.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    # потёки: вытянутый по вертикали шум, темнит
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (40, 40, 3); L.new(tc.outputs['Object'], mp.inputs['Vector'])
    st = N.new('ShaderNodeTexNoise'); st.inputs['Scale'].default_value = 1.5; st.inputs['Detail'].default_value = 4; L.new(mp.outputs['Vector'], st.inputs['Vector'])
    sk = N.new('ShaderNodeMapRange'); sk.inputs['From Min'].default_value = 0.45; sk.inputs['From Max'].default_value = 0.7
    sk.inputs['To Min'].default_value = 1.0; sk.inputs['To Max'].default_value = 0.55; L.new(st.outputs['Fac'], sk.inputs['Value'])
    dk = N.new('ShaderNodeVectorMath'); dk.operation = 'SCALE'; L.new(ramp.outputs['Color'], dk.inputs[0]); L.new(sk.outputs['Result'], dk.inputs['Scale'])
    # мох и лишайник: пятна по шуму, гуще внизу
    mn = N.new('ShaderNodeTexNoise'); mn.inputs['Scale'].default_value = 9; mn.inputs['Detail'].default_value = 8; L.new(tc.outputs['Object'], mn.inputs['Vector'])
    hz = N.new('ShaderNodeMapRange'); hz.inputs['From Min'].default_value = 0.0; hz.inputs['From Max'].default_value = 0.6
    hz.inputs['To Min'].default_value = 0.25; hz.inputs['To Max'].default_value = -0.15; L.new(sep.outputs['Z'], hz.inputs['Value'])
    ad = N.new('ShaderNodeMath'); ad.operation = 'ADD'; L.new(mn.outputs['Fac'], ad.inputs[0]); L.new(hz.outputs['Result'], ad.inputs[1])
    mm = N.new('ShaderNodeMapRange'); mm.inputs['From Min'].default_value = 0.68; mm.inputs['From Max'].default_value = 0.8; L.new(ad.outputs['Value'], mm.inputs['Value'])
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; L.new(mm.outputs['Result'], mix.inputs['Factor'])
    L.new(dk.outputs['Vector'], mix.inputs['A']); mix.inputs['B'].default_value = (*mt.lin((0.20, 0.24, 0.11)), 1)
    L.new(mix.outputs['Result'], b.inputs['Base Color'])
    chips = N.new('ShaderNodeTexNoise'); chips.inputs['Scale'].default_value = 160; chips.inputs['Detail'].default_value = 12; L.new(tc.outputs['Object'], chips.inputs['Vector'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.45; bu.inputs['Distance'].default_value = 0.003
    L.new(chips.outputs['Fac'], bu.inputs['Height']); L.new(bu.outputs['Normal'], b.inputs['Normal'])
    return m


def column(name, seed):
    """мраморная колонна каньона (как в эталоне): 20 каннелюр, лёгкое сужение кверху, обломанный зубчатый верх с изломом,
    база — тор и плинт, наполовину в земле; выветренный мрамор с прожилками и сколами"""
    sc, rng = scene(96, ((1.0, 0.84, 0.62), 5.2), seed)
    R, H, n, rings, flutes = 9.0, 66.0 + rng.uniform(-6, 4), 240, 48, 20
    teeth = [rng.uniform(0.0, 1.0) ** 0.7 for _ in range(rng.randint(5, 8))]
    def jag(t):
        k = t * len(teeth); i = int(k) % len(teeth); f = k - int(k)
        return teeth[i] * (1 - f) + teeth[(i + 1) % len(teeth)] * f
    amp = rng.uniform(9, 12); tops = [H - jag(i / n) * amp for i in range(n)]
    bm = bmesh.new(); rows = []
    for j in range(rings + 1):
        z = j / rings; row = []
        for i in range(n):
            th = i / n * math.tau; fl = (0.5 + 0.5 * math.cos(flutes * th)) ** 0.7
            r = R * (1 - 0.06 * fl) * (1 - 0.05 * z)
            zz = 4 + (tops[i] - 4) * z
            row.append(bm.verts.new((math.cos(th) * r * U, math.sin(th) * r * U, zz * U)))
        rows.append(row)
    for j in range(rings):
        for i in range(n):
            a, b2, c2, d = rows[j][i], rows[j][(i + 1) % n], rows[j + 1][(i + 1) % n], rows[j + 1][i]
            bm.faces.new((a, b2, c2, d))
    # излом сверху: неровная поверхность скола, центр ниже кромки
    ctr = bm.verts.new((rng.uniform(-2, 2) * U, rng.uniform(-2, 2) * U, (min(tops) + 1.5) * U))
    for i in range(n): bm.faces.new((rows[-1][i], rows[-1][(i + 1) % n], ctr))
    # база: тор и плинт, наполовину в земле
    bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=(R + 2.6) * U, radius2=(R + 2.6) * U, depth=4 * U, matrix=Matrix.Translation(Vector((0, 0, 2.5 * U))))
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(Vector((0, 0, -0.8 * U))) @ Matrix.Diagonal(Vector(((R + 4.5) * 2 * U, (R + 4.5) * 2 * U, 4.6 * U, 1))))
    for v in bm.verts:   # мелкая неровность скола и выветривание кромок
        p = Vector(v.co) / U; d = noise.noise(p * 0.12 + Vector((seed, seed * 2, 0))) * 0.12
        v.co = Vector(v.co) + Vector((p.x, p.y, 0)).normalized() * d * U if (p.x * p.x + p.y * p.y) > 1 else v.co
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); obj(name, me, mat_weathered('limestone', seed) if name.startswith('column_ruin') else mat_marble('marble', seed), sc)
    if not name.startswith('column_ruin'): sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.35   # слабее заливка — светотень, как в эталоне
    return sc


def potjar(name, seed):
    """глиняный кувшин каньона: тело вращения (широкое плечо, узкое горло, отогнутый венчик), терракота с потёртостями,
    тёмный налёт пыли снизу; лежит или стоит — как в эталоне"""
    sc, rng = scene(36, ((1.0, 0.84, 0.62), 5.2), seed)
    prof = [(0.0, 0.0), (4.2, 0.2), (6.6, 2.5), (8.4, 7.5), (8.8, 11.0), (7.6, 15.5), (4.6, 19.5), (3.0, 21.5), (2.8, 23.2), (3.9, 24.6), (4.2, 25.4), (3.2, 25.6)]
    k = rng.uniform(0.9, 1.1); prof = [(r * k, z * rng.uniform(0.96, 1.04) if z else 0.0) for r, z in prof]
    def cr(p0, p1, p2, p3, t):   # Катмулл–Ром: гладкий профиль без граней
        return tuple(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3) for a, b, c, d in zip(p0, p1, p2, p3))
    P = [prof[0]] + prof + [prof[-1]]; smooth = []
    for i in range(1, len(P) - 2):
        for k2 in range(6): smooth.append(cr(P[i - 1], P[i], P[i + 1], P[i + 2], k2 / 6))
    smooth.append(prof[-1])
    n = 128; bm = bmesh.new(); rows = []
    for (r, z) in smooth:
        row = []
        for i in range(n):
            th = i / n * math.tau; w = 1 + noise.noise(Vector((math.cos(th) * 0.8, math.sin(th) * 0.8, z * 0.08)) + Vector((seed, 0, 0))) * 0.035
            row.append(bm.verts.new((math.cos(th) * r * w * U, math.sin(th) * r * w * U, z * U)))
        rows.append(row)
    for j in range(len(rows) - 1):
        for i in range(n): bm.faces.new((rows[j][i], rows[j][(i + 1) % n], rows[j + 1][(i + 1) % n], rows[j + 1][i]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m, nt, b = mt.principled('clay', 0.72, 0.25); N, L = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord'); nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 30; nz.inputs['Detail'].default_value = 8
    L.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.25; ramp.color_ramp.elements[0].color = (*mt.lin((0.62, 0.33, 0.19)), 1)
    ramp.color_ramp.elements[1].position = 0.8; ramp.color_ramp.elements[1].color = (*mt.lin((0.80, 0.50, 0.31)), 1)
    L.new(nz.outputs['Fac'], ramp.inputs['Fac']); L.new(ramp.outputs['Color'], b.inputs['Base Color'])
    ch = N.new('ShaderNodeTexNoise'); ch.inputs['Scale'].default_value = 180; ch.inputs['Detail'].default_value = 10; L.new(tc.outputs['Object'], ch.inputs['Vector'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.3; bu.inputs['Distance'].default_value = 0.002
    L.new(ch.outputs['Fac'], bu.inputs['Height']); L.new(bu.outputs['Normal'], b.inputs['Normal'])
    o = obj(name, me, m, sc)
    o.rotation_euler = (0, 0, rng.uniform(0, math.tau))
    return sc



def barrel(name, seed):
    """бочка (пиратская бухта, критик r34: «у бочек нет обручей и заклёпок»): 18 клёпок-досок с пузом и швами, на каждой свой
    тон и годичные слои вдоль; четыре железных обруча с заклёпками, ржавчина и потёртости; основание — по низу кадра"""
    sc, rng = scene(32, ((1.0, 0.84, 0.62), 5.2), seed)
    Hh, r0, r1, NS, n = 24.0, 7.4, 8.8, 18, 144
    def rad(z):   # пузо: парабола по высоте
        t = z / Hh * 2 - 1; return r0 + (r1 - r0) * (1 - t * t)
    tone = [rng.uniform(0.82, 1.15) for _ in range(NS)]
    bm = bmesh.new(); rows = []; zs = [Hh * k / 48 for k in range(49)]
    col_layer = bm.loops.layers.color.new('Col')
    for z in zs:
        row = []
        for i in range(n):
            th = i / n * math.tau; f = (th / math.tau * NS) % 1.0; groove = 0.05 if (f < 0.04 or f > 0.96) else 0.0
            r = rad(z) * (1 - groove * 0.4) + noise.noise(Vector((math.cos(th) * 2, math.sin(th) * 2, z * 0.3 + seed))) * 0.06
            row.append(bm.verts.new((math.cos(th) * r * U, math.sin(th) * r * U, z * U)))
        rows.append(row)
    for j in range(len(rows) - 1):
        for i in range(n):
            fc = bm.faces.new((rows[j][i], rows[j][(i + 1) % n], rows[j + 1][(i + 1) % n], rows[j + 1][i]))
            st = int((i + 0.5) / n * NS) % NS; k = tone[st]
            for lp in fc.loops: lp[col_layer] = (k * 0.5, k * 0.5, k * 0.5, 1.0)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    # дерево клёпок: волокна вдоль высоты (волна с искажением), тон клёпки — из цвета вершин, грязь и влага к низу
    m, nt, b = mt.principled('stave', 0.62, 0.3); N, L = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord'); wv = N.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'X'
    wv.inputs['Scale'].default_value = 9; wv.inputs['Distortion'].default_value = 7; wv.inputs['Detail'].default_value = 6
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (30, 30, 2.2); L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], wv.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.1; ramp.color_ramp.elements[0].color = (*mt.lin((0.20, 0.12, 0.06)), 1)
    ramp.color_ramp.elements[1].position = 0.9; ramp.color_ramp.elements[1].color = (*mt.lin((0.46, 0.30, 0.16)), 1)
    L.new(wv.outputs['Fac'], ramp.inputs['Fac'])
    at = N.new('ShaderNodeAttribute'); at.attribute_name = 'Col'
    mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mt.sock(mul.inputs, 'Factor_Float').default_value = 1.0
    L.new(ramp.outputs['Color'], mt.sock(mul.inputs, 'A_Color')); L.new(at.outputs['Color'], mt.sock(mul.inputs, 'B_Color'))
    br = N.new('ShaderNodeMath'); br.operation = 'MULTIPLY'; br.inputs[1].default_value = 2.0
    mix2 = N.new('ShaderNodeMix'); mix2.data_type = 'RGBA'; mix2.blend_type = 'MULTIPLY'; mt.sock(mix2.inputs, 'Factor_Float').default_value = 1.0
    L.new(mt.sock(mul.outputs, 'Result_Color'), mt.sock(mix2.inputs, 'A_Color')); mt.sock(mix2.inputs, 'B_Color').default_value = (2.0, 2.0, 2.0, 1)
    L.new(mt.sock(mix2.outputs, 'Result_Color'), b.inputs['Base Color'])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 220; nz.inputs['Detail'].default_value = 8; L.new(tc.outputs['Object'], nz.inputs['Vector'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.35; bu.inputs['Distance'].default_value = 0.002
    L.new(nz.outputs['Fac'], bu.inputs['Height']); L.new(bu.outputs['Normal'], b.inputs['Normal'])
    o = obj(name, me, m, sc); o.rotation_euler = (0, 0, rng.uniform(0, math.tau))
    # обручи: полоса железа прямоугольного сечения по профилю бочки, заклёпки
    iron = mat_col('hoop', (0.13, 0.11, 0.10), 0.5, 0.5, 0.5, 400); ib = iron.node_tree.nodes['Principled BSDF']
    if 'Metallic' in ib.inputs: ib.inputs['Metallic'].default_value = 0.65
    hb = bmesh.new(); rv = bmesh.new()
    for zc in (2.2, 5.0, Hh - 5.0, Hh - 2.2):
        w = 0.9; ring = []
        for zz in (zc - w, zc + w):
            for out in (0.0, 0.32):
                row = []
                for i in range(n):
                    th = i / n * math.tau; r = rad(zz) + 0.06 + out
                    row.append(hb.verts.new((math.cos(th) * r * U, math.sin(th) * r * U, zz * U)))
                ring.append(row)
        lo_in, lo_out, hi_in, hi_out = ring
        for i in range(n):
            i2 = (i + 1) % n
            hb.faces.new((lo_out[i], lo_out[i2], hi_out[i2], hi_out[i]))
            hb.faces.new((hi_out[i], hi_out[i2], hi_in[i2], hi_in[i]))
            hb.faces.new((lo_in[i], lo_in[i2], lo_out[i2], lo_out[i]))
        for q in range(14):
            th = q / 14 * math.tau + rng.uniform(-0.05, 0.05); r = rad(zc) + 0.42
            bmesh.ops.create_icosphere(rv, subdivisions=1, radius=0.32 * U, matrix=Matrix.Translation(Vector((math.cos(th) * r, math.sin(th) * r, zc)) * U))
    me = bpy.data.meshes.new(name + '_h'); hb.to_mesh(me); hb.free(); oh = obj(name + '_h', me, iron, sc)
    for p in me.polygons: p.use_smooth = False
    me = bpy.data.meshes.new(name + '_r'); rv.to_mesh(me); rv.free(); obj(name + '_r', me, mat_col('rivet', (0.30, 0.25, 0.20), 0.4, 0.5), sc)
    return sc

def drygrass(name, seed):
    """пучок сухой травы каньона: 40–70 тонких изогнутых травинок (сужаются к концу, гнутся по ветру), соломенные тона от
    тёмного у корня к светлому (по высоте), редкие колоски на концах; у корня — несколько камешков"""
    sc, rng = scene(36, ((1.0, 0.84, 0.62), 5.2), seed)
    bm = bmesh.new(); lean = rng.uniform(-0.35, 0.35)
    for _ in range(rng.randint(40, 70)):
        a = rng.uniform(-0.8, 0.8) + lean; L = rng.uniform(8, 20); w = rng.uniform(0.3, 0.6)
        x0 = rng.gauss(0, 2.2); y0 = rng.uniform(-3, 3); bend = rng.uniform(0.3, 1.2) * (1 if a > 0 else -1) + lean
        segs = 8; prev = None; px = pz = 0
        for k in range(segs + 1):
            t = k / segs; ang = a * (0.4 + 0.6 * t) + bend * t * t
            px = x0 + math.sin(ang) * L * t; pz = math.cos(ang) * L * t - 0.5; ww = w * (1 - t) ** 0.8 + 0.04
            v1 = bm.verts.new(((px - ww) * U, y0 * U, pz * U)); v2 = bm.verts.new(((px + ww) * U, y0 * U, pz * U))
            if prev: bm.faces.new((prev[0], prev[1], v2, v1))
            prev = (v1, v2)
        if rng.random() < 0.3:   # колосок на конце травинки
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.6 * U, matrix=Matrix.Translation(Vector((px * U, y0 * U, (pz + 0.8) * U))) @ Matrix.Diagonal(Vector((0.7, 0.7, 2.0, 1))))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m, nt, b = mt.principled('straw', 0.78, 0.22); N, Lk = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord'); sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(tc.outputs['Object'], sep.inputs['Vector'])
    mr = N.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = -0.5 * U; mr.inputs['From Max'].default_value = 16 * U
    Lk.new(sep.outputs['Z'], mr.inputs['Value'])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 25; Lk.new(tc.outputs['Object'], nz.inputs['Vector'])
    mx = N.new('ShaderNodeMath'); mx.operation = 'MULTIPLY_ADD'; mx.inputs[1].default_value = 0.35; Lk.new(nz.outputs['Fac'], mx.inputs[0]); Lk.new(mr.outputs['Result'], mx.inputs[2])
    ramp = N.new('ShaderNodeValToRGB'); E = ramp.color_ramp.elements
    # v101 (эталон каньона: пучки серо-оливковые, как полынь, светлые только кончики; соломенно-золотые читались белёсыми)
    E[0].position = 0.05; E[0].color = (*mt.lin((0.27, 0.21, 0.12)), 1); E[1].position = 0.8; E[1].color = (*mt.lin((0.72, 0.64, 0.45)), 1)
    e = E.new(0.42); e.color = (*mt.lin((0.47, 0.40, 0.25)), 1)
    Lk.new(mx.outputs['Value'], ramp.inputs['Fac']); Lk.new(ramp.outputs['Color'], b.inputs['Base Color'])
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.2; break
    obj(name, me, m, sc)
    for p in me.polygons: p.use_smooth = False
    bm = bmesh.new()
    for _ in range(rng.randint(3, 6)):   # камешки у корня
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=rng.uniform(0.7, 1.6) * U, matrix=Matrix.Translation(Vector((rng.gauss(0, 3.5) * U, rng.uniform(-3, 3) * U, -0.7 * U))) @ Matrix.Diagonal(Vector((1.2, 1, 0.75, 1))))
    me = bpy.data.meshes.new(name + '_st'); bm.to_mesh(me); bm.free(); obj(name + '_st', me, mat_col('pebble', (0.56, 0.44, 0.33), 0.8, 0.2, 0.4, 120), sc)
    return sc


FLOWER = {   # вид: (лепестков, длина, ширина, цвет, центр, радиус центра, шероховатость, изгиб чашей)
    'poppy': (4, 3.0, 3.0, (0.78, 0.07, 0.04), (0.07, 0.05, 0.05), 0.75, 0.45, 0.45),
    'buttercup': (5, 1.8, 1.6, (0.95, 0.76, 0.05), (0.78, 0.60, 0.10), 0.5, 0.22, 0.35),
    'daisy': (17, 2.3, 0.55, (0.93, 0.93, 0.90), (0.95, 0.70, 0.08), 0.8, 0.5, 0.12),
    'cornflower': (9, 1.9, 0.85, (0.16, 0.30, 0.86), (0.22, 0.14, 0.48), 0.5, 0.5, 0.2),
    # v91 (критик r34: «в долине одни красные цветы»): флокс, астра, календула — розовые, фиолетовые и оранжевые кучки
    'phlox': (5, 1.7, 1.5, (0.95, 0.38, 0.62), (0.98, 0.85, 0.90), 0.35, 0.4, 0.25),
    'aster': (16, 2.0, 0.42, (0.55, 0.32, 0.88), (0.95, 0.75, 0.15), 0.6, 0.5, 0.1),
    'calendula': (13, 1.9, 0.75, (0.98, 0.52, 0.06), (0.85, 0.38, 0.05), 0.7, 0.45, 0.18),
}


def wildflowers(name, seed, kind):
    """кучка полевых цветов (мак, лютик, ромашка, василёк): 5–9 стеблей с листьями, головки повёрнуты к зрителю и чуть
    вверх, лепестки — тонкие изогнутые пластины с просвечиванием; цвет и форма — по виду"""
    sc, rng = scene(28, ((1.0, 0.95, 0.88), 4.6), seed)
    n_pet, L, W, col, ccol, cr, rough, cup = FLOWER[kind]
    stems, leaves, petals, centers = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    def strip(bm, pts, w0, w1):
        prev = None
        for k, (px, py, pz) in enumerate(pts):
            t = k / (len(pts) - 1); ww = w0 + (w1 - w0) * t
            v1 = bm.verts.new(((px - ww) * U, py * U, pz * U)); v2 = bm.verts.new(((px + ww) * U, py * U, pz * U))
            if prev: bm.faces.new((prev[0], prev[1], v2, v1))
            prev = (v1, v2)
    for _ in range(rng.randint(5, 9)):
        x0 = rng.gauss(0, 3.0); y0 = rng.uniform(-3, 3); h = rng.uniform(8, 17); lean = rng.uniform(-0.25, 0.25); bend = rng.uniform(-0.15, 0.15)
        pts = []
        for k in range(9):
            t = k / 8; pts.append((x0 + math.sin(lean * t + bend * t * t) * h * t, y0, h * t - 0.6))
        strip(stems, pts, 0.28, 0.16)
        for j in range(rng.randint(1, 3)):   # узкие листья у основания
            la = rng.uniform(0.5, 1.1) * (1 if rng.random() < 0.5 else -1); ll = rng.uniform(3.5, 6.5); z0 = rng.uniform(0, h * 0.35)
            lp = [(x0 + math.sin(la * (0.4 + t)) * ll * t, y0 - 0.1, z0 + math.cos(la * (0.4 + t)) * ll * t * 0.8) for t in [i / 6 for i in range(7)]]
            prev = None
            for k, (px, py, pz) in enumerate(lp):
                t = k / 6; ww = 0.75 * math.sin(math.pi * min(1, t * 1.15 + 0.08))
                v1 = leaves.verts.new(((px - ww * 0.3) * U, py * U, (pz - ww) * U)); v2 = leaves.verts.new(((px + ww * 0.3) * U, py * U, (pz + ww) * U))
                if prev: leaves.faces.new((prev[0], prev[1], v2, v1))
                prev = (v1, v2)
        tip = Vector(pts[-1]) * U
        # головка смотрит на зрителя (−y) и вверх; небольшой разворот у каждой
        d = Vector((rng.uniform(-0.35, 0.35), -rng.uniform(0.55, 0.9), rng.uniform(0.35, 0.8))).normalized()
        R = d.to_track_quat('Z', 'Y').to_matrix().to_4x4(); ph = rng.uniform(0, math.tau); k = rng.uniform(0.85, 1.15)
        for i in range(n_pet):
            a = ph + i / n_pet * math.tau + rng.uniform(-0.08, 0.08)
            M = Matrix.Translation(tip) @ R @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(-cup, 4, 'Y') @ Matrix.Translation(Vector((L * 0.55 * k * U, 0, 0))) @ Matrix.Diagonal(Vector((L * 0.5 * k * U, W * 0.5 * k * U, 0.12 * W * U, 1)))
            bmesh.ops.create_uvsphere(petals, u_segments=12, v_segments=8, radius=1, matrix=M)
        bmesh.ops.create_uvsphere(centers, u_segments=16, v_segments=10, radius=1, matrix=Matrix.Translation(tip + d * 0.25 * U) @ R @ Matrix.Diagonal(Vector((cr * U, cr * U, cr * 0.55 * U, 1))))
    for bm, nm, m in ((stems, '_st', mat_col('stem', (0.24, 0.42, 0.13), 0.6, 0.2)), (leaves, '_lf', mat_col('leaf', (0.20, 0.40, 0.12), 0.55, 0.25)),
                      (petals, '_pt', mat_col('petal_' + kind, col, rough, 0.35)), (centers, '_cn', mat_col('center_' + kind, ccol, 0.7, 0.2, 0.4, 260))):
        me = bpy.data.meshes.new(name + nm); bm.to_mesh(me); bm.free(); o = obj(name + nm, me, m, sc)
        if nm in ('_pt', '_lf'):
            b = m.node_tree.nodes['Principled BSDF']
            for key in ('Subsurface Weight', 'Subsurface'):
                if key in b.inputs: b.inputs[key].default_value = 0.3; break
    return sc


def leaf(name, seed, col, lobes, serr):
    """падающий лист для погоды «листья»: контур с лопастями (дуб) или зубчиками (берёза), заострённый кончик, черешок,
    лёгкий изгиб по средней жилке; жилки — рельеф, просвечивание"""
    sc, rng = scene(8, ((1.0, 0.95, 0.88), 4.6), seed)
    L, Wd = 3.2, 1.7
    def half(t):   # t от −1 (основание) до 1 (кончик)
        u = (t + 1) / 2; w = Wd * math.sin(math.pi * u ** 0.85) ** 0.9
        if lobes: w *= 1 + 0.22 * math.sin(u * math.pi * 2 * lobes) * (1 - u * 0.4)
        if serr: w *= 1 + 0.05 * math.sin(u * 90)
        return max(0.0, w)
    bm = bmesh.new(); N, M = 60, 14; grid = []
    for i in range(N + 1):
        t = -1 + 2 * i / N; w = half(t); row = []
        for j in range(M + 1):
            v = -1 + 2 * j / M; x = t * L; z = v * w
            y = 0.35 * (v * v) * w + 0.25 * t * t   # изгиб по жилке и к кончику
            row.append(bm.verts.new((x * U, -y * U, (z + 2) * U)))
        grid.append(row)
    for i in range(N):
        for j in range(M):
            if half(-1 + 2 * (i + 0.5) / N) > 0.02: bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=0.09 * U, radius2=0.06 * U, depth=1.1 * U,
                          matrix=Matrix.Translation(Vector((-(L + 0.5) * U, 0, 2 * U))) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    m, nt, b = mt.principled('leaf_' + name, 0.55, 0.3); N_, Lk = nt.nodes, nt.links
    tc = N_.new('ShaderNodeTexCoord'); nz = N_.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 400; Lk.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = N_.new('ShaderNodeValToRGB'); E = ramp.color_ramp.elements
    E[0].color = (*mt.lin(tuple(c * 0.78 for c in col)), 1); E[1].color = (*mt.lin(tuple(min(1, c * 1.12) for c in col)), 1)
    Lk.new(nz.outputs['Fac'], ramp.inputs['Fac']); Lk.new(ramp.outputs['Color'], b.inputs['Base Color'])
    vein = N_.new('ShaderNodeTexWave'); vein.wave_type = 'BANDS'; vein.inputs['Scale'].default_value = 900; vein.inputs['Distortion'].default_value = 2
    Lk.new(tc.outputs['Object'], vein.inputs['Vector'])
    bu = N_.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.25; Lk.new(vein.outputs['Fac'], bu.inputs['Height']); Lk.new(bu.outputs['Normal'], b.inputs['Normal'])
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.35; break
    o = obj(name, me, m, sc); o.rotation_euler = (0, rng.uniform(-0.5, 0.5), 0)
    return sc


def roots(name, seed):
    """корни, свисающие со свода пещеры: 4–8 сужающихся плетей с изгибами и тонкими отростками, кора с землёй;
    верх — у верхнего края кадра (там свод)"""
    sc, rng = scene(32, ((1.0, 0.95, 0.88), 4.0), seed)
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 0.55 * U; cu.bevel_resolution = 3; cu.use_fill_caps = True
    top = 29.6
    def strand(x, z, L, r0, depth):
        sp = cu.splines.new('NURBS'); n = 10; sp.points.add(n - 1); px, py, pz = x, rng.uniform(-1, 1), z; dx = rng.uniform(-0.3, 0.3)
        pts = []
        for k in range(n):
            t = k / (n - 1); sp.points[k].co = (px * U, py * U, pz * U, 1); sp.points[k].radius = r0 * (1 - 0.85 * t) + 0.05
            pts.append((px, pz, t)); dx = max(-0.7, min(0.7, dx + rng.uniform(-0.35, 0.35)))
            px += dx * L / n; pz -= L / n * rng.uniform(0.8, 1.0); py += rng.uniform(-0.3, 0.3)
        sp.use_endpoint_u = True; sp.order_u = 4
        if depth < 2:
            for (qx, qz, t) in pts[2:-2]:
                if rng.random() < 0.35: strand(qx, qz, L * rng.uniform(0.2, 0.45) * (1 - t), r0 * 0.4, depth + 1)
    for _ in range(rng.randint(4, 8)): strand(rng.gauss(0, 3.5), top, rng.uniform(12, 28), rng.uniform(0.6, 1.2), 0)
    m, nt, b = mt.principled('root', 0.8, 0.2); N, Lk = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord'); nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 160; nz.inputs['Detail'].default_value = 8; Lk.new(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB'); E = ramp.color_ramp.elements; E[0].color = (*mt.lin((0.20, 0.13, 0.08)), 1); E[1].color = (*mt.lin((0.46, 0.32, 0.20)), 1)
    Lk.new(nz.outputs['Fac'], ramp.inputs['Fac']); Lk.new(ramp.outputs['Color'], b.inputs['Base Color'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.5; Lk.new(nz.outputs['Fac'], bu.inputs['Height']); Lk.new(bu.outputs['Normal'], b.inputs['Normal'])
    cu.materials.append(m); o = bpy.data.objects.new(name, cu); o['tone'] = 0.0; sc.collection.objects.link(o)
    return sc


def cottage(name, seed):
    """домик долины: фахверк (белёная штукатурка, тёмные балки с раскосами), каменный цоколь, двускатная черепичная крыша
    фронтоном к зрителю, дощатая дверь, окно с тёплым светом, каменная труба"""
    sc, rng = scene(100, ((1.0, 0.93, 0.82), 4.8), seed)
    def box(bm, x0, x1, y0, y1, z0, z1):
        bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(Vector(((x0 + x1) / 2 * U, (y0 + y1) / 2 * U, (z0 + z1) / 2 * U))) @ Matrix.Diagonal(Vector(((x1 - x0) * U, (y1 - y0) * U, (z1 - z0) * U, 1))))
    def part(nm, bm, mat):
        me = bpy.data.meshes.new(name + nm); bm.to_mesh(me); bm.free(); o = obj(name + nm, me, mat, sc)
        for p in me.polygons: p.use_smooth = False
        return o
    # материалы
    plaster, nt, b = mt.principled('plaster', 0.85, 0.2); N, L = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord'); nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 22; nz.inputs['Detail'].default_value = 12; nz.inputs['Roughness'].default_value = 0.65; L.new(tc.outputs['Object'], nz.inputs['Vector'])
    rp = N.new('ShaderNodeValToRGB'); rp.color_ramp.elements[0].position = 0.35; rp.color_ramp.elements[0].color = (*mt.lin((0.62, 0.56, 0.46)), 1); rp.color_ramp.elements[1].color = (*mt.lin((0.90, 0.85, 0.75)), 1)
    L.new(nz.outputs['Fac'], rp.inputs['Fac']); L.new(rp.outputs['Color'], b.inputs['Base Color'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.35; L.new(nz.outputs['Fac'], bu.inputs['Height']); L.new(bu.outputs['Normal'], b.inputs['Normal'])
    timber = mat_col('timber', (0.24, 0.15, 0.08), 0.75, 0.2, 0.5, 120)
    stone = mat_col('stone', (0.50, 0.47, 0.42), 0.9, 0.15, 0.9, 25)
    door = mat_col('door', (0.36, 0.22, 0.11), 0.7, 0.2, 0.6, 40)
    roof, nt, b = mt.principled('roof', 0.8, 0.2); N, L = nt.nodes, nt.links
    tc = N.new('ShaderNodeTexCoord'); wv = N.new('ShaderNodeTexWave'); wv.inputs['Scale'].default_value = 28; wv.inputs['Distortion'].default_value = 0.6; L.new(tc.outputs['Object'], wv.inputs['Vector'])
    br = N.new('ShaderNodeTexBrick'); br.inputs['Scale'].default_value = 26; br.inputs['Mortar Size'].default_value = 0.03; L.new(tc.outputs['Object'], br.inputs['Vector'])
    br.inputs['Color1'].default_value = (*mt.lin((0.50, 0.24, 0.13)), 1); br.inputs['Color2'].default_value = (*mt.lin((0.38, 0.19, 0.11)), 1); br.inputs['Mortar'].default_value = (*mt.lin((0.15, 0.09, 0.06)), 1)
    L.new(br.outputs['Color'], b.inputs['Base Color'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.6; L.new(br.outputs['Fac'], bu.inputs['Height']); L.new(bu.outputs['Normal'], b.inputs['Normal'])
    glass, nt, b = mt.principled('glass', 0.3, 0.5); b.inputs['Base Color'].default_value = (*mt.lin((1.0, 0.75, 0.40)), 1)
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (*mt.lin((1.0, 0.72, 0.35)), 1); break
    if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = 2.5
    # стены, цоколь, фронтон
    bm = bmesh.new(); box(bm, -38, 38, -18, 18, 4, 40)
    vs = [bm.verts.new((x * U, y * U, z * U)) for (x, y, z) in ((-38, -18, 40), (38, -18, 40), (0, -18, 64), (-38, 18, 40), (38, 18, 40), (0, 18, 64))]
    bm.faces.new((vs[0], vs[1], vs[2])); bm.faces.new((vs[5], vs[4], vs[3]))
    part('_w', bm, plaster)
    bm = bmesh.new(); box(bm, -40, 40, -20, 20, -3, 4)
    for (x0, x1, y0, z0, z1) in ((24, 31, -4, 48, 76),): box(bm, x0, x1, y0, y0 + 7, z0, z1)
    part('_s', bm, stone)
    # балки фахверка на фасаде (и на фронтоне)
    bm = bmesh.new(); f0, f1 = -19.2, -18.0
    for z in (4, 21, 39): box(bm, -38.5, 38.5, f0, f1, z, z + 2)
    for x in (-38, -27.5, -10, 2, 24, 37): box(bm, x - 0.9, x + 0.9, f0, f1, 4, 41)
    def beam(xa, za, xb, zb, w=0.9):
        d = Vector((xb - xa, 0, zb - za)); l = d.length; a = math.atan2(d.z, d.x)
        bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(Vector(((xa + xb) / 2 * U, (f0 + f1) / 2 * U, (za + zb) / 2 * U))) @ Matrix.Rotation(-a, 4, 'Y') @ Matrix.Diagonal(Vector((l * U, (f1 - f0) * U, w * 2 * U, 1))))
    beam(-10, 21, 2, 39); beam(24, 21, 37, 39); beam(-38, 41, 0, 63.5, 1.1); beam(38, 41, 0, 63.5, 1.1); beam(0, 41, 0, 63); beam(-19, 41, 0, 52); beam(19, 41, 0, 52)
    part('_t', bm, timber)
    # крыша: два ската с вылетом, толщина 2
    bm = bmesh.new()
    for sgn in (-1, 1):
        p = [(0, 67), (sgn * 47, 35)]; th = 2.2
        q = [bm.verts.new((x * U, y * U, z * U)) for y in (-24, 24) for (x, z) in (p[0], p[1], (p[1][0], p[1][1] - th), (p[0][0], p[0][1] - th))]
        for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm.faces.new([q[i] for i in (f if sgn > 0 else f[::-1])])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    part('_r', bm, roof)
    bm = bmesh.new(); box(bm, -27, -13, -19.6, -18, 4, 27); part('_d', bm, door)
    bm = bmesh.new(); box(bm, 7, 21, -18.6, -18, 15, 27); part('_g', bm, glass)
    bm = bmesh.new(); box(bm, 6, 22, -19.8, -18.4, 14, 15.2); box(bm, 6, 22, -19.8, -18.4, 26.8, 28); box(bm, 6, 7.2, -19.8, -18.4, 14, 28); box(bm, 20.8, 22, -19.8, -18.4, 14, 28); box(bm, 13.4, 14.6, -19.8, -18.4, 14, 28); box(bm, 5, 23, -21, -18.4, 13, 14.2)
    part('_f', bm, timber)
    # вид на три четверти сверху: сначала поворот вокруг вертикали, потом наклон к зрителю — вертикали остаются вертикальными;
    # дом ставится в кадр по габаритам (основание — на земле, по центру)
    parts = [o for o in sc.collection.objects if o.name.startswith(name)]
    for o in parts: o.rotation_mode = 'ZXY'; o.rotation_euler = (math.radians(9), 0, math.radians(-30)); o.scale = (0.86, 0.86, 0.86)
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in parts for c in o.bound_box]
    x0, x1, z0 = min(p.x for p in pts), max(p.x for p in pts), min(p.z for p in pts)
    for o in parts: o.location = (-(x0 + x1) / 2, 0, -z0 - 0.5 * U)
    return sc


def lantern(name, seed):
    """судовой фонарь: цепь, кованая крышка-пирамида, латунный каркас из четырёх стоек, стёкла, внутри горит свеча
    (тёплое свечение изнутри); верх цепи — у верхнего края кадра (фонарь висит под потолком трюма)"""
    sc, rng = scene(24, ((1.0, 0.85, 0.65), 2.2), seed)
    def box(bm, x0, x1, y0, y1, z0, z1):
        bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(Vector(((x0 + x1) / 2 * U, (y0 + y1) / 2 * U, (z0 + z1) / 2 * U))) @ Matrix.Diagonal(Vector(((x1 - x0) * U, (y1 - y0) * U, (z1 - z0) * U, 1))))
    def part(nm, bm, mat, smooth=True):
        me = bpy.data.meshes.new(name + nm); bm.to_mesh(me); bm.free(); o = obj(name + nm, me, mat, sc)
        for p_ in me.polygons: p_.use_smooth = smooth
        return o
    iron = mat_col('iron', (0.10, 0.09, 0.08), 0.55, 0.5, 0.4, 200)
    brass = mat_col('brass', (0.62, 0.45, 0.20), 0.35, 0.8, 0.3, 300)
    bm = bmesh.new()
    # крепление к потолку: кованая пластина с двумя шляпками гвоздей и крюк; от крюка до крышки — цепь из звеньев-колец
    box(bm, -2.4, 2.4, -1.2, 1.2, 21.2, 22.2)
    for sx in (-1.6, 1.6): bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.38 * U, matrix=Matrix.Translation(Vector((sx * U, -1.2 * U, 21.7 * U))))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.32 * U, radius2=0.32 * U, depth=1.0 * U, matrix=Matrix.Translation(Vector((0, 0, 20.8 * U))))
    for k in range(4):   # звенья цепи — торы, через одно повёрнуты на 90°
        z = 19.9 - k * 0.62
        bmesh.ops.create_cone(bm, cap_ends=False, segments=14, radius1=0.5 * U, radius2=0.5 * U, depth=0.22 * U, matrix=Matrix.Translation(Vector((0, 0, z * U))) @ Matrix.Rotation(math.pi / 2 * (k % 2), 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Diagonal(Vector((0.75, 1.0, 1.0, 1))))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=4.2 * U, radius2=0.6 * U, depth=3.2 * U, matrix=Matrix.Translation(Vector((0, 0, 16.6 * U))) @ Matrix.Rotation(math.pi / 4, 4, 'Z'))
    box(bm, -3.2, 3.2, -3.2, 3.2, 4.6, 5.8)
    part('_i', bm, iron)
    bm = bmesh.new()
    for sx in (-1, 1):
        for sy in (-1, 1): box(bm, sx * 2.9 - 0.35, sx * 2.9 + 0.35, sy * 2.9 - 0.35, sy * 2.9 + 0.35, 5.8, 15.0)
    box(bm, -3.3, 3.3, -3.3, 3.3, 14.6, 15.2); box(bm, -3.3, 3.3, -3.3, 3.3, 5.6, 6.2)
    part('_b', bm, brass, False)
    glass, nt, b = mt.principled('lglass', 0.15, 0.5); b.inputs['Base Color'].default_value = (*mt.lin((1.0, 0.80, 0.48)), 1)
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (*mt.lin((1.0, 0.70, 0.32)), 1); break
    if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = 0.7
    if 'Alpha' in b.inputs: b.inputs['Alpha'].default_value = 0.45
    bm = bmesh.new(); box(bm, -2.8, 2.8, -2.8, 2.8, 6.2, 14.6); part('_g', bm, glass, False)
    wax = mat_col('wax', (0.92, 0.88, 0.78), 0.5, 0.2)
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.8 * U, radius2=0.8 * U, depth=3.2 * U, matrix=Matrix.Translation(Vector((0, 0, 7.8 * U)))); part('_c', bm, wax)
    flame, nt, b = mt.principled('flame', 0.5, 0.0); b.inputs['Base Color'].default_value = (*mt.lin((1.0, 0.8, 0.4)), 1)
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (*mt.lin((1.0, 0.75, 0.35)), 1); break
    if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = 14
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1, matrix=Matrix.Translation(Vector((0, 0, 10.4 * U))) @ Matrix.Diagonal(Vector((0.55 * U, 0.55 * U, 1.3 * U, 1)))); part('_fl', bm, flame)
    lt = bpy.data.lights.new(name + '_pl', 'POINT'); lt.energy = 1.2; lt.color = (1.0, 0.7, 0.35); lt.shadow_soft_size = 0.004
    lo = bpy.data.objects.new(name + '_pl', lt); lo.location = (0, 0, 10.4 * U); sc.collection.objects.link(lo)
    for o in sc.collection.objects:   # поворот: видны две грани
        if o.name.startswith(name) and o.type == 'MESH': o.rotation_euler = (0, 0, math.radians(35))
    return sc


def striplight(name, seed):
    """линейный светильник станции Alien под металлическим потолком: тёмный корпус с торцевыми крышками и креплениями,
    светящийся бирюзовый рассеиватель снизу; верх — у верхнего края кадра (потолок)"""
    sc, rng = scene(32, ((0.85, 0.9, 1.0), 2.4), seed)
    def box(bm, x0, x1, y0, y1, z0, z1):
        bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(Vector(((x0 + x1) / 2 * U, (y0 + y1) / 2 * U, (z0 + z1) / 2 * U))) @ Matrix.Diagonal(Vector(((x1 - x0) * U, (y1 - y0) * U, (z1 - z0) * U, 1))))
    hous = mat_col('housing', (0.10, 0.11, 0.14), 0.4, 0.6, 0.3, 300)
    bm = bmesh.new(); box(bm, -14, 14, -2.2, 2.2, 26.0, 28.4); box(bm, -14.6, -13.4, -2.4, 2.4, 25.2, 28.6); box(bm, 13.4, 14.6, -2.4, 2.4, 25.2, 28.6)
    for x in (-9, 9): box(bm, x - 0.6, x + 0.6, -0.6, 0.6, 28.4, 30.2)
    me = bpy.data.meshes.new(name + '_h'); bm.to_mesh(me); bm.free(); o = obj(name + '_h', me, hous, sc)
    for p_ in me.polygons: p_.use_smooth = False
    dif, nt, b = mt.principled('diff', 0.3, 0.2); b.inputs['Base Color'].default_value = (*mt.lin((0.6, 0.95, 1.0)), 1)
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (*mt.lin((0.45, 0.92, 1.0)), 1); break
    if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = 3.0
    bm = bmesh.new(); box(bm, -13.2, 13.2, -1.7, 1.7, 25.3, 26.1); me = bpy.data.meshes.new(name + '_d'); bm.to_mesh(me); bm.free(); obj(name + '_d', me, dif, sc)
    return sc


def leaf_strip(bm, base, d, side, L, W, fold=0.25, seg=6, curl=0.15):
    """лист: полоса вдоль средней жилки от base по направлению d (side — направление ширины), края приподняты (fold),
    кончик загнут (curl); ширина по синусу — заострённый овал"""
    up = d.cross(side).normalized(); rows = []
    for k in range(seg + 1):
        t = k / seg; w = W * math.sin(math.pi * min(0.999, 0.04 + t * 0.96)) ** 0.75
        c = base + d * (L * t) + up * (curl * L * t * t)
        rows.append([bm.verts.new(c - side * w + up * (fold * w)), bm.verts.new(c), bm.verts.new(c + side * w + up * (fold * w))])
    for k in range(seg):
        for m in range(2): bm.faces.new((rows[k][m], rows[k][m + 1], rows[k + 1][m + 1], rows[k + 1][m]))


def alienbush(name, seed, tip):
    """v91: соцветия Alien как в эталоне — пышный куст из 3–6 шаров-соцветий (как гортензия): сотни мелких четырёхлепестковых
    цветков на тёмно-зелёных листьях (прежний «куст из бусин» был игрушечным). tip — оттенок соцветий: розово-пурпурный или
    сине-фиолетовый; светлые цветки чуть светятся (под ночным светом карты соцветия не гаснут)"""
    sc, rng = scene(40, ((1.0, 0.88, 0.76), 4.4), seed)
    lv = bmesh.new()
    for _ in range(rng.randint(70, 95)):                                   # листья: заострённые овалы из-под соцветий наружу
        a = rng.uniform(0.12, math.pi - 0.12); rr = rng.uniform(3, 12)
        base = Vector((math.cos(a) * rr * 1.15, rng.uniform(-3.5, 3.5), math.sin(a) * rr * 0.5 + rng.uniform(-0.5, 1.0))) * U
        d = Vector((math.cos(a) * 1.2 + rng.uniform(-0.4, 0.4), rng.uniform(-0.6, 0.3), math.sin(a) * 0.8 + rng.uniform(-0.1, 0.4))).normalized()
        side = d.cross(Vector((rng.uniform(-0.3, 0.3), 1, rng.uniform(-0.3, 0.3)))).normalized()
        L = rng.uniform(4.0, 7.0); leaf_strip(lv, base, d, side, L * U, L * rng.uniform(0.2, 0.3) * U, 0.3, 6, rng.uniform(-0.25, 0.1))
    me = bpy.data.meshes.new(name + '_l'); lv.to_mesh(me); lv.free()
    leaf = mat_col('aleaf', (0.09, 0.15, 0.06), 0.5, 0.35, 0.3, 300)
    b = leaf.node_tree.nodes['Principled BSDF']
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.15; break
    obj(name + '_l', me, leaf, sc)
    shades = [tuple(c * k for c in tip) for k in (0.42, 0.62, 0.85)]
    fl = [bmesh.new() for _ in shades]; core = bmesh.new()
    heads = rng.randint(3, 6)
    for h in range(heads):
        a = (h + 0.5) / heads * (math.pi - 0.7) + 0.35 + rng.uniform(-0.15, 0.15); rr = rng.uniform(6.5, 10)
        c0 = Vector((math.cos(a) * rr * 1.15, rng.uniform(-2.5, 1.0), math.sin(a) * rr * 0.75 + 3.5)); R = rng.uniform(4.0, 5.8)
        n = int(R * R * 4.2)
        for f in range(n):                                                   # цветки по полусфере соцветия (точки Фибоначчи)
            zz = 1 - (f + 0.5) / n * 1.25
            if zz < -0.25: continue
            r_ = math.sqrt(max(0.0, 1 - zz * zz)); ph = f * 2.39996
            nrm = Vector((math.cos(ph) * r_, math.sin(ph) * r_ * 0.8 - 0.35, zz)).normalized()
            p = c0 + nrm * R * rng.uniform(0.92, 1.05)
            t1 = nrm.cross(Vector((0, 0, 1)) if abs(nrm.z) < 0.9 else Vector((1, 0, 0))).normalized(); t2 = nrm.cross(t1)
            k = 2 if (nrm.z > 0.35 and rng.random() < 0.6) else (0 if rng.random() < 0.35 else 1)
            ps = rng.uniform(0.5, 0.68); rot = rng.uniform(0, math.pi / 2)
            for q in range(4):                                               # четыре лепестка крестом
                ang = rot + q * math.pi / 2; off = (t1 * math.cos(ang) + t2 * math.sin(ang)) * ps * 0.85
                M = Matrix.Translation((p + off) * U) @ nrm.to_track_quat('Z', 'Y').to_matrix().to_4x4() @ Matrix.Diagonal(Vector((ps * U, ps * U, ps * 0.35 * U, 1)))
                bmesh.ops.create_icosphere(fl[k], subdivisions=1, radius=1.0, matrix=M)
            if rng.random() < 0.45: bmesh.ops.create_icosphere(core, subdivisions=1, radius=ps * 0.2 * U, matrix=Matrix.Translation((p + nrm * 0.12) * U))
    for k, bm_ in enumerate(fl):
        me = bpy.data.meshes.new(name + '_f%d' % k); bm_.to_mesh(me); bm_.free()
        m, nt, b = mt.principled('petal%d' % k, 0.55, 0.3); b.inputs['Base Color'].default_value = (*mt.lin(shades[k]), 1)
        for key in ('Subsurface Weight', 'Subsurface'):
            if key in b.inputs: b.inputs[key].default_value = 0.12; break
        if k == 2:
            for key in ('Emission Color', 'Emission'):
                if key in b.inputs: b.inputs[key].default_value = (*mt.lin(tip), 1); break
            if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = 0.18
        obj(name + '_f%d' % k, me, m, sc)
    me = bpy.data.meshes.new(name + '_c'); core.to_mesh(me); core.free(); obj(name + '_c', me, mat_col('fcore', (0.8, 0.66, 0.5), 0.5, 0.3), sc)
    return sc


DECOR = {   # имя → (сцена, seed, кадр в ед.)
    'snowman1': (snowman, 11, 80), 'snowman2': (snowman, 12, 80),
    'cactus1': (cactus, 21, 90), 'cactus2': (cactus, 22, 90), 'cactus3': (cactus, 23, 90),
    'palm1': (palm, 31, 170), 'palm2': (palm, 32, 170), 'palm3': (palm, 33, 170),
    'deadtree1': (lambda n, s: deadtree(n, s, False), 41, 130), 'deadtree2': (lambda n, s: deadtree(n, s, False), 42, 130),
    'deadtree_char1': (lambda n, s: deadtree(n, s, True), 43, 130), 'deadtree_char2': (lambda n, s: deadtree(n, s, True), 44, 130),
    'igloo1': (igloo, 51, 90), 'icecrystal1': (icecrystal, 61, 48), 'icecrystal2': (icecrystal, 62, 48),
    'watertower1': (watertower, 71, 180),
    'column1': (column, 121, 96), 'column2': (column, 122, 96), 'column_ruin1': (column, 123, 96), 'column_ruin2': (column, 124, 96),
    'pot1': (potjar, 131, 36), 'pot2': (potjar, 132, 36),
    'barrel1': (barrel, 133, 32), 'barrel2': (barrel, 134, 32),
    'drygrass1': (drygrass, 141, 36), 'drygrass2': (drygrass, 142, 36), 'drygrass3': (drygrass, 143, 36), 'drygrass4': (drygrass, 144, 36),
    'crystal_c1': (lambda n, s: crystals(n, s, (0.35, 0.95, 1.0)), 81, 56), 'crystal_c2': (lambda n, s: crystals(n, s, (0.35, 0.95, 1.0)), 82, 56),
    'crystal_m1': (lambda n, s: crystals(n, s, (1.0, 0.43, 0.96)), 83, 56), 'crystal_m2': (lambda n, s: crystals(n, s, (1.0, 0.43, 0.96)), 84, 56),
    'crystal_h1': (lambda n, s: crystals_hang(n, s, (0.3, 0.92, 1.0)), 85, 56), 'crystal_h2': (lambda n, s: crystals_hang(n, s, (0.3, 0.92, 1.0)), 86, 56),
    'crystal_h3': (lambda n, s: crystals_hang(n, s, (0.95, 0.35, 1.0)), 87, 56), 'crystal_h4': (lambda n, s: crystals_hang(n, s, (0.62, 0.42, 1.0)), 88, 56),
    'obsidian1': (obsidian, 91, 36), 'obsidian2': (obsidian, 92, 36), 'lavarock1': (lavarock, 93, 34), 'lavarock2': (lavarock, 94, 34),
    'spike1': (spike, 95, 84), 'spike2': (spike, 96, 84), 'skull1': (skull, 97, 44), 'bones1': (bones, 98, 44),
    'alienplant1': (alienplant, 101, 40), 'alienplant2': (alienplant, 102, 40), 'pod1': (pod, 103, 36), 'tentacle1': (tentacle, 104, 72),
    'rock1': (lambda n, s: boulder(n, s, (0.36, 0.35, 0.33), (0.72, 0.70, 0.66)), 111, 36), 'rock2': (lambda n, s: boulder(n, s, (0.36, 0.35, 0.33), (0.72, 0.70, 0.66)), 112, 36),
    'rock3': (lambda n, s: boulder(n, s, (0.36, 0.35, 0.33), (0.72, 0.70, 0.66), moss=0.5), 113, 36),
    'rockb1': (lambda n, s: boulder(n, s, (0.34, 0.29, 0.23), (0.68, 0.60, 0.50)), 114, 36), 'rockb2': (lambda n, s: boulder(n, s, (0.34, 0.29, 0.23), (0.68, 0.60, 0.50)), 115, 36),
    'flower1': (lambda n, s: wildflowers(n, s, 'poppy'), 151, 28), 'flower2': (lambda n, s: wildflowers(n, s, 'buttercup'), 152, 28),
    'flower3': (lambda n, s: wildflowers(n, s, 'daisy'), 153, 28), 'flower4': (lambda n, s: wildflowers(n, s, 'cornflower'), 154, 28),
    'flower5': (lambda n, s: wildflowers(n, s, 'phlox'), 155, 28), 'flower6': (lambda n, s: wildflowers(n, s, 'aster'), 156, 28),
    'flower7': (lambda n, s: wildflowers(n, s, 'calendula'), 157, 28),
    'leaf1': (lambda n, s: leaf(n, s, (0.33, 0.55, 0.15), 3.5, False), 161, 8), 'leaf2': (lambda n, s: leaf(n, s, (0.88, 0.70, 0.16), 0, True), 162, 8),
    'leaf3': (lambda n, s: leaf(n, s, (0.86, 0.40, 0.11), 2.5, False), 163, 8), 'leaf4': (lambda n, s: leaf(n, s, (0.55, 0.47, 0.22), 0, True), 164, 8),
    'roots1': (roots, 171, 32), 'roots2': (roots, 172, 32), 'roots3': (roots, 173, 32),
    'cottage1': (cottage, 181, 100),
    'lantern1': (lantern, 191, 24),
    'striplight1': (striplight, 201, 32),
    'alienbush1': (lambda n, s: alienbush(n, s, (0.95, 0.32, 0.95)), 211, 40), 'alienbush2': (lambda n, s: alienbush(n, s, (0.62, 0.38, 1.0)), 212, 40),
    'rocksnow1': (lambda n, s: boulder(n, s, (0.20, 0.23, 0.29), (0.48, 0.53, 0.62), snow=True), 116, 36), 'rocksnow2': (lambda n, s: boulder(n, s, (0.20, 0.23, 0.29), (0.48, 0.53, 0.62), snow=True), 117, 36),
}


def save_pair(name):
    """подробная версия уже записана рендером; малая — уменьшение ×2 с учётом прозрачности"""
    hi = os.path.join(ROOT, 'assets', 'tex', 'surface', name + '.png')
    im = bpy.data.images.load(hi); w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4); pre = a.copy(); pre[..., :3] *= a[..., 3:4]
    lo = pre.reshape(h // 2, 2, w // 2, 2, 4).mean((1, 3)); al = lo[..., 3:4]
    lo[..., :3] = np.where(al > 1e-4, lo[..., :3] / np.maximum(al, 1e-4), 0)
    small = bpy.data.images.new(name + '_small', w // 2, h // 2, alpha=True); small.pixels.foreach_set(lo.ravel())
    small.filepath_raw = os.path.join(ROOT, 'assets', 'tex', name + '.png'); small.file_format = 'PNG'; small.save()


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for name in (argv or list(DECOR)):
        fn, seed, frame = DECOR[name]
        sc = fn(name, seed); mt.OUT = os.path.join(ROOT, 'assets', 'tex', 'surface'); mt.render(sc, name)
        save_pair(name); print('DECOR', name, frame * K, flush=True)


main()
