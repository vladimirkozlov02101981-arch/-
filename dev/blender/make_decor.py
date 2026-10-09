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


DECOR = {   # имя → (сцена, seed, кадр в ед.)
    'snowman1': (snowman, 11, 80), 'snowman2': (snowman, 12, 80),
    'cactus1': (cactus, 21, 90), 'cactus2': (cactus, 22, 90), 'cactus3': (cactus, 23, 90),
    'palm1': (palm, 31, 170), 'palm2': (palm, 32, 170), 'palm3': (palm, 33, 170),
    'deadtree1': (lambda n, s: deadtree(n, s, False), 41, 130), 'deadtree2': (lambda n, s: deadtree(n, s, False), 42, 130),
    'deadtree_char1': (lambda n, s: deadtree(n, s, True), 43, 130), 'deadtree_char2': (lambda n, s: deadtree(n, s, True), 44, 130),
    'igloo1': (igloo, 51, 90), 'icecrystal1': (icecrystal, 61, 48), 'icecrystal2': (icecrystal, 62, 48),
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
