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
    deep = tuple(c * 0.55 for c in col)
    o = obj(name, me, mat_glow('crystal', deep, col, 0.55, 0.06, 0.25), sc)
    for p in me.polygons: p.use_smooth = False
    base = lumpy_sphere('base', Vector((0, 0, -2 * U)), 9 * U, seed, 0.25, 0.45); obj('base', base, mt.mat_stone('rockb', (0.12, 0.10, 0.14), (0.30, 0.27, 0.32), rough=0.85, spec=0.2, scale=60, bumpk=1.3), sc)
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
    me = lumpy_sphere(name, Vector((0, 0, 4 * U)), 11 * U, seed, 0.28, 0.62)
    m = mt.mat_stone('lava', (0.05, 0.04, 0.035), (0.20, 0.16, 0.14), rough=0.9, spec=0.15, scale=50, bumpk=1.5)
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.feature = 'DISTANCE_TO_EDGE'; vo.inputs['Scale'].default_value = 3.2
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.018
    mr.inputs['To Min'].default_value = 4.0; mr.inputs['To Max'].default_value = 0.0
    nt.links.new(vo.outputs['Distance'], mr.inputs['Value'])
    if 'Emission Strength' in b.inputs: nt.links.new(mr.outputs['Result'], b.inputs['Emission Strength'])
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (1.0, 0.36, 0.06, 1); break
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
    bm = bmesh.new()
    for i in range(4):
        R = (8 + i * 3.6); pts = [Vector((-4 * U + math.cos(a) * R * U, (i - 1.5) * 2.5 * U, math.sin(a) * R * 0.9 * U)) for a in [math.pi * (0.55 + 0.4 * k / 10) for k in range(11)]]
        rib_tube(bm, pts, [(1.1 - 0.4 * k / 10) * U for k in range(11)], 0, 0, 10, True)
    rib_tube(bm, [Vector(((-16 + 26 * t) * U, -6 * U, (1 + 0.6 * t) * U)) for t in [k / 10 for k in range(11)]], [1.3 * U * (1.4 if k in (0, 10) else 1) for k in range(11)], 0, 0, 12, True)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj(name, me, mt.mat_stone('bone', (0.62, 0.56, 0.46), (0.92, 0.88, 0.80), rough=0.7, spec=0.25, scale=40, bumpk=0.6), sc)
    return sc


def alienplant(name, seed):
    """светящиеся побеги Alien: 3–5 изогнутых стеблей с полупрозрачными бутонами-фонариками"""
    sc, rng = scene(40, ((0.85, 0.85, 1.0), 3.6), seed)
    bm = bmesh.new(); bb = bmesh.new()
    for i in range(rng.randint(3, 5)):
        h = rng.uniform(14, 28); a = rng.uniform(-0.5, 0.5); x0 = rng.uniform(-4, 4)
        pts = [Vector(((x0 + math.sin(a) * h * t * t) * U, rng.uniform(-1, 1) * U * 0, (h * t - 1) * U)) for t in [k / 10 for k in range(11)]]
        rib_tube(bm, pts, [(0.9 - 0.4 * k / 10) * U for k in range(11)], 0, 0, 8, False)
        bmesh.ops.create_uvsphere(bb, u_segments=16, v_segments=12, radius=rng.uniform(2.2, 3.2) * U, matrix=Matrix.Translation(pts[-1] + Vector((0, 0, 1.5 * U))) @ Matrix.Diagonal((1, 1, 1.25, 1)))
    me = bpy.data.meshes.new('stems'); bm.to_mesh(me); bm.free(); obj('stems', me, mat_col('stem', (0.12, 0.42, 0.38), 0.6, 0.3), sc)
    me = bpy.data.meshes.new('buds'); bb.to_mesh(me); bb.free(); obj('buds', me, mat_glow('bud', (0.12, 0.62, 0.56), (0.3, 1.0, 0.85), 0.7, 0.3, 0.2), sc)
    return sc


def pod(name, seed):
    """светящийся стручок Alien: ребристая капля с подповерхностным свечением"""
    sc, rng = scene(36, ((0.85, 0.85, 1.0), 3.6), seed)
    bm = bmesh.new(); n = 14
    pts = [Vector((0, 0, (13 * (1 - math.cos(math.pi * t)) - 1) * U)) for t in [k / n for k in range(n + 1)]]
    rad = [max(0.4, 9 * math.sin(math.pi * min(0.999, t * 0.98 + 0.01)) ** 0.8) * U for t in [k / n for k in range(n + 1)]]
    rib_tube(bm, pts, rad, 8, 0.08, 40, True)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj(name, me, mat_glow('pod', (0.42, 0.07, 0.38), (1.0, 0.35, 0.85), 0.35, 0.35, 0.0), sc)
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
    ramp = N.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (*mt.lin((0.80, 0.66, 0.48)), 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (*mt.lin((0.99, 0.90, 0.74)), 1)
    mix = N.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'; mix.inputs[1].default_value = 0.35; mix.inputs[2].default_value = 0.4
    L.new(vein.outputs['Fac'], mix.inputs[0]); add = N.new('ShaderNodeMath'); add.operation = 'ADD'; L.new(mix.outputs['Value'], add.inputs[0]); L.new(nz.outputs['Fac'], add.inputs[1])
    sc = N.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = 0.62; L.new(add.outputs['Value'], sc.inputs[0])
    L.new(sc.outputs['Value'], ramp.inputs['Fac']); L.new(ramp.outputs['Color'], b.inputs['Base Color'])
    chips = N.new('ShaderNodeTexNoise'); chips.inputs['Scale'].default_value = 220; chips.inputs['Detail'].default_value = 12; L.new(tc.outputs['Object'], chips.inputs['Vector'])
    bu = N.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.28; bu.inputs['Distance'].default_value = 0.002
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
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); obj(name, me, mat_marble('marble', seed), sc)
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
    E[0].position = 0.05; E[0].color = (*mt.lin((0.36, 0.27, 0.15)), 1); E[1].position = 0.75; E[1].color = (*mt.lin((0.86, 0.74, 0.50)), 1)
    e = E.new(0.4); e.color = (*mt.lin((0.68, 0.53, 0.31)), 1)
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

DECOR = {   # имя → (сцена, seed, кадр в ед.)
    'snowman1': (snowman, 11, 80), 'snowman2': (snowman, 12, 80),
    'cactus1': (cactus, 21, 90), 'cactus2': (cactus, 22, 90), 'cactus3': (cactus, 23, 90),
    'palm1': (palm, 31, 170), 'palm2': (palm, 32, 170), 'palm3': (palm, 33, 170),
    'deadtree1': (lambda n, s: deadtree(n, s, False), 41, 130), 'deadtree2': (lambda n, s: deadtree(n, s, False), 42, 130),
    'deadtree_char1': (lambda n, s: deadtree(n, s, True), 43, 130), 'deadtree_char2': (lambda n, s: deadtree(n, s, True), 44, 130),
    'igloo1': (igloo, 51, 90), 'icecrystal1': (icecrystal, 61, 48), 'icecrystal2': (icecrystal, 62, 48),
    'watertower1': (watertower, 71, 180),
    'column1': (column, 121, 96), 'column2': (column, 122, 96),
    'pot1': (potjar, 131, 36), 'pot2': (potjar, 132, 36),
    'drygrass1': (drygrass, 141, 36), 'drygrass2': (drygrass, 142, 36), 'drygrass3': (drygrass, 143, 36), 'drygrass4': (drygrass, 144, 36),
    'crystal_c1': (lambda n, s: crystals(n, s, (0.35, 0.95, 1.0)), 81, 56), 'crystal_c2': (lambda n, s: crystals(n, s, (0.35, 0.95, 1.0)), 82, 56),
    'crystal_m1': (lambda n, s: crystals(n, s, (1.0, 0.43, 0.96)), 83, 56), 'crystal_m2': (lambda n, s: crystals(n, s, (1.0, 0.43, 0.96)), 84, 56),
    'obsidian1': (obsidian, 91, 36), 'obsidian2': (obsidian, 92, 36), 'lavarock1': (lavarock, 93, 34), 'lavarock2': (lavarock, 94, 34),
    'spike1': (spike, 95, 84), 'spike2': (spike, 96, 84), 'skull1': (skull, 97, 44), 'bones1': (bones, 98, 44),
    'alienplant1': (alienplant, 101, 40), 'alienplant2': (alienplant, 102, 40), 'pod1': (pod, 103, 36), 'tentacle1': (tentacle, 104, 72),
    'rock1': (lambda n, s: boulder(n, s, (0.36, 0.35, 0.33), (0.72, 0.70, 0.66)), 111, 36), 'rock2': (lambda n, s: boulder(n, s, (0.36, 0.35, 0.33), (0.72, 0.70, 0.66)), 112, 36),
    'rock3': (lambda n, s: boulder(n, s, (0.36, 0.35, 0.33), (0.72, 0.70, 0.66), moss=0.5), 113, 36),
    'rockb1': (lambda n, s: boulder(n, s, (0.34, 0.29, 0.23), (0.68, 0.60, 0.50)), 114, 36), 'rockb2': (lambda n, s: boulder(n, s, (0.34, 0.29, 0.23), (0.68, 0.60, 0.50)), 115, 36),
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
