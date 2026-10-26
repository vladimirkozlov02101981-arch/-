"""Плющ для кладки (долина, замки, маяк): лист спрайтов — 6 свисающих плетей разной длины, вид сбоку, прозрачный фон.

blender -b --python dev/blender/make_ivy.py
Пишет assets/tex/surface/ivy.png (×4, 768×320) и assets/tex/ivy.png (×1, 192×80; уменьшение ×4 с учётом прозрачности).
Ячейка 32×80 ед., плеть крепится в точке (16, 3) ячейки; длины плетей — IVY_LEN (те же числа в js/terrain_visual.js).
Листья — настоящий плющ (Hedera): 3–5 заострённых лопастей, слегка вогнутые, глянцевые (блик от солнца сверху слева),
приглушённая зелень (насыщенность 35–45 %, как в эталоне), молодые листья у кончика мельче и светлее; стебель с черешками.
"""
import importlib.util
import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

CW, CH, K = 32, 80, 4                         # ячейка в ед. мира, во сколько раз крупнее рендер
IVY_LEN = [22, 30, 40, 52, 64, 76]            # длина плети (ед.) по ячейкам
U = 0.01                                      # 1 ед. мира = 1 см сцены


def leaf_mesh(bm, cl, base, axis, side, size, col, rng):
    """лист плюща: контур из 3–5 лопастей вокруг точки крепления черешка, веером к камере; вогнутость; цвет в углах"""
    nl = rng.choice((3, 5, 5, 5)); tips = []
    spread = math.radians(rng.uniform(70, 100))
    for i in range(nl):
        a = (i / (nl - 1) - 0.5) * 2 * spread if nl > 1 else 0
        ln = (1.0 if i == nl // 2 else 0.72 if abs(i - nl // 2) == 1 else 0.5) * rng.uniform(0.9, 1.08)
        tips.append((a, ln))
    pts = []
    for i, (a, ln) in enumerate(tips):
        pts.append((a, ln))
        if i + 1 < len(tips):                                     # широкие лопасти: плечо, неглубокая выемка, плечо
            a2, ln2 = tips[i + 1]; q = min(ln, ln2); dep = rng.uniform(0.6, 0.72)
            pts += [(a + (a2 - a) * 0.25, ln * 0.86), ((a + a2) / 2, q * dep), (a + (a2 - a) * 0.75, ln2 * 0.86)]
    pts = [(tips[0][0] - 0.5, 0.28)] + pts + [(tips[-1][0] + 0.5, 0.28)]                                # основание «сердечком»
    # плоскость листа — XZ (к камере), ось листа axis; края отогнуты назад — лист выпуклый, блик в середине
    ax = Vector((axis.x, 0, axis.z)).normalized(); px = Vector((ax.z, 0, -ax.x)); twist = rng.uniform(-0.25, 0.25)
    vs = [bm.verts.new(base)]
    for (a, ln) in pts:
        d = ax * math.cos(a) + px * math.sin(a) * side
        r = ln * size
        p = base + d * r + Vector((0, (r / size) ** 2 * size * 0.22 + twist * math.sin(a) * r, 0))
        vs.append(bm.verts.new(p))
    faces = []
    for i in range(1, len(vs) - 1):
        f = bm.faces.new((vs[0], vs[i], vs[i + 1])); faces.append(f)
    k = rng.uniform(0.86, 1.12)
    for f in faces:
        for lp in f.loops:
            edge = (lp.vert.co - base).length / max(1e-6, size)
            c = tuple(min(1.0, v * k * (1.08 - 0.16 * edge)) for v in col)                                   # к краю чуть темнее
            lp[cl] = (*c, 1)


def strand(bm_v, bm_l, cl, x0, L, rng, shades, young):
    """плеть: стебель сверху вниз с покачиванием, листья поочерёдно с двух сторон на черешках"""
    top = Vector((x0, 0, -3 * U))
    sway = rng.uniform(-5, 5) * U; ph = rng.uniform(0, 6.28)
    def P(t):
        return top + Vector((sway * math.sin(t * 2.4 + ph) + sway * 0.6 * t, 0, -L * U * t))
    n = 10; pts = [P(i / n) for i in range(n + 1)]
    for i in range(n):
        r0 = (0.42 - 0.22 * i / n) * U; r1 = (0.42 - 0.22 * (i + 1) / n) * U
        mt._cone(bm_v, pts[i], pts[i + 1], r0, r1, 6)
    t = rng.uniform(0.01, 0.04); side = rng.choice((-1, 1))
    while t < 0.97:
        p = P(t); u = t
        size = (4.8 - 2.1 * u) * rng.uniform(0.85, 1.15) * U
        ang = math.radians(rng.uniform(-60, -20)) if side > 0 else math.radians(rng.uniform(-160, -120))
        stem = Vector((math.cos(ang), 0, math.sin(ang))) * rng.uniform(1.4, 2.8) * U
        b = p + stem + Vector((0, -0.4 * U, 0))
        mt._cone(bm_v, p, b, 0.22 * U, 0.15 * U, 5)                       # черешок
        axis = Vector((math.cos(ang) * 0.7 + rng.uniform(-0.25, 0.25), 0, math.sin(ang) * 0.6 - 0.55))   # наружу и вниз
        col = young if (u > 0.82 and rng.random() < 0.6) else rng.choice(shades)
        leaf_mesh(bm_l, cl, b, axis, side, size, col, rng)
        side = -side; t += rng.uniform(2.1, 3.4) / L


def main():
    sc = mt.reset(); rng = random.Random(77)
    W, H = CW * 6, CH
    sc.render.resolution_x = W * K; sc.render.resolution_y = H * K; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True; sc.render.image_settings.color_mode = 'RGBA'; sc.cycles.samples = 128
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    cam = sc.camera; cam.data.ortho_scale = W * U
    cam.location = (W * U / 2, -10, -H * U / 2); cam.rotation_euler = (math.radians(90), 0, 0)
    sun = bpy.data.objects['sun']; sun.rotation_euler = Vector((0.55, 0.5, -0.67)).normalized().to_track_quat('-Z', 'Y').to_euler()
    shades = [mt.lin(c) for c in ((0.22, 0.29, 0.15), (0.29, 0.37, 0.19), (0.36, 0.43, 0.24), (0.33, 0.38, 0.25), (0.26, 0.33, 0.18))]
    young = mt.lin((0.46, 0.50, 0.26))
    bv = bmesh.new(); bl = bmesh.new(); cl = bl.loops.layers.float_color.new('Col')
    for i, L in enumerate(IVY_LEN):
        strand(bv, bl, cl, (i + 0.5) * CW * U, L, rng, shades, young)
    vm = bpy.data.meshes.new('vine'); bv.to_mesh(vm); bv.free()
    vm.materials.append(mt.mat_stone('vine', (0.20, 0.17, 0.11), (0.34, 0.30, 0.20), rough=0.8, spec=0.2, scale=40, bumpk=0.4))
    for p in vm.polygons: p.use_smooth = True
    ov = bpy.data.objects.new('vine', vm); ov['tone'] = 0.0; sc.collection.objects.link(ov)
    lm = bpy.data.meshes.new('leaves'); bl.to_mesh(lm); bl.free()
    m, nt, b = mt.principled('ivy', 0.38, 0.55)                           # плющ глянцевый
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'; nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.12; break
    lm.materials.append(m); sc.collection.objects.link(bpy.data.objects.new('leaves', lm))
    out = os.path.join(ROOT, 'assets', 'tex', 'surface'); mt.OUT = out; mt.render(sc, 'ivy')
    # ×1: усреднение блоков 4×4 с учётом прозрачности (без тёмной каймы)
    import numpy as np
    im = bpy.data.images.load(os.path.join(out, 'ivy.png')); w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    pre = a.copy(); pre[..., :3] *= a[..., 3:4]
    lo = pre.reshape(h // K, K, w // K, K, 4).mean((1, 3)); al = lo[..., 3:4]
    lo[..., :3] = np.where(al > 1e-4, lo[..., :3] / np.maximum(al, 1e-4), 0)
    small = bpy.data.images.new('ivy_small', w // K, h // K, alpha=True); small.pixels.foreach_set(lo.ravel())
    small.filepath_raw = os.path.join(ROOT, 'assets', 'tex', 'ivy.png'); small.file_format = 'PNG'; small.save()
    print('IVY', W * K, H * K, flush=True)


def save_small(out, name):
    """×1: усреднение блоков K×K с учётом прозрачности (без тёмной каймы)"""
    import numpy as np
    im = bpy.data.images.load(os.path.join(out, name + '.png')); w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    pre = a.copy(); pre[..., :3] *= a[..., 3:4]
    lo = pre.reshape(h // K, K, w // K, K, 4).mean((1, 3)); al = lo[..., 3:4]
    lo[..., :3] = np.where(al > 1e-4, lo[..., :3] / np.maximum(al, 1e-4), 0)
    small = bpy.data.images.new(name + '_small', w // K, h // K, alpha=True); small.pixels.foreach_set(lo.ravel())
    small.filepath_raw = os.path.join(ROOT, 'assets', 'tex', name + '.png'); small.file_format = 'PNG'; small.save()


CREST_W, CREST_H = 256, 40


def crest():
    """v96 (эталон замков: мост и стены поверху заросли плющом клочьями — густо у кромки, местами свисает на 10–30 ед.;
    у нас были только одиночные плети «столбиками»): полоса 256×40 ед., бесшовная по горизонтали, верх кадра = верх стены.
    По кромке — стелющиеся побеги с листьями во все стороны, местами короткие плети вниз (4–30 ед.); плотность клочьями"""
    sc = mt.reset(); rng = random.Random(91)
    W, H = CREST_W, CREST_H
    sc.render.resolution_x = W * K; sc.render.resolution_y = H * K; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True; sc.render.image_settings.color_mode = 'RGBA'; sc.cycles.samples = 128
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    cam = sc.camera; cam.data.ortho_scale = W * U
    cam.location = (W * U / 2, -10, -H * U / 2 + 1 * U); cam.rotation_euler = (math.radians(90), 0, 0)
    sun = bpy.data.objects['sun']; sun.rotation_euler = Vector((0.55, 0.5, -0.67)).normalized().to_track_quat('-Z', 'Y').to_euler()
    shades = [mt.lin(c) for c in ((0.22, 0.29, 0.15), (0.29, 0.37, 0.19), (0.36, 0.43, 0.24), (0.33, 0.38, 0.25), (0.26, 0.33, 0.18))]
    young = mt.lin((0.46, 0.50, 0.26))
    bv = bmesh.new(); bl = bmesh.new(); cl = bl.loops.layers.float_color.new('Col')
    clump = lambda x: 0.5 + 0.5 * math.sin(x * 0.045 + 1.3) * math.sin(x * 0.11 + 0.4)     # клочья по длине стены (период полосы — 256)
    items = []
    x = 0.0
    while x < W:                                                       # стелющиеся побеги вдоль кромки
        L = rng.uniform(14, 40); items.append(('run', x, L, rng.random() * 1e9)); x += L * rng.uniform(0.35, 0.8)
    for _ in range(46):                                                # короткие плети вниз — гуще в клочьях
        x = rng.uniform(0, W)
        if rng.random() > 0.25 + 0.75 * clump(x): continue
        items.append(('hang', x, rng.uniform(4, 30) * (0.5 + clump(x)), rng.random() * 1e9))

    def runner(x0, L, r):
        """побег вдоль кромки: стебель чуть ниже верха, листья вверх, вбок и вниз (как в эталоне — кромка «пушистая»)"""
        y0 = r.uniform(1.0, 3.5)
        pts = [Vector(((x0 + L * t) * U, 0, -(y0 + 1.2 * math.sin(t * 5 + x0)) * U)) for t in [k / 8 for k in range(9)]]
        for i in range(8): mt._cone(bv, pts[i], pts[i + 1], 0.35 * U, 0.3 * U, 5)
        t = r.uniform(0.0, 0.1)
        while t < 1.0:
            p = Vector(((x0 + L * t) * U, 0, -(y0 + 1.2 * math.sin(t * 5 + x0)) * U))
            ang = math.radians(r.choice((r.uniform(40, 140), r.uniform(-150, -30), r.uniform(-30, 30), r.uniform(150, 210))))
            size = r.uniform(2.6, 4.6) * U
            b = p + Vector((math.cos(ang), 0, math.sin(ang))) * r.uniform(1.0, 2.2) * U + Vector((0, -0.3 * U, 0))
            axis = Vector((math.cos(ang) * 0.8, 0, math.sin(ang) * 0.8 - 0.3))
            leaf_mesh(bl, cl, b, axis, r.choice((-1, 1)), size, young if r.random() < 0.12 else r.choice(shades), r)
            t += r.uniform(1.4, 2.6) / L
    for kind, x0, L, seed in items:
        for dx in (-W, 0, W):                                          # бесшовно: края дублируются со сдвигом на период
            if x0 + dx < -40 or x0 + dx > W + 40: continue
            r = random.Random(seed)
            if kind == 'run': runner(x0 + dx, L, r)
            else: strand(bv, bl, cl, (x0 + dx) * U, L, r, shades, young)
    vm = bpy.data.meshes.new('vine'); bv.to_mesh(vm); bv.free()
    vm.materials.append(mt.mat_stone('vine', (0.20, 0.17, 0.11), (0.34, 0.30, 0.20), rough=0.8, spec=0.2, scale=40, bumpk=0.4))
    for p in vm.polygons: p.use_smooth = True
    ov = bpy.data.objects.new('vine', vm); ov['tone'] = 0.0; sc.collection.objects.link(ov)
    lm = bpy.data.meshes.new('leaves'); bl.to_mesh(lm); bl.free()
    m, nt, b = mt.principled('ivy', 0.38, 0.55)
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'; nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.12; break
    lm.materials.append(m); sc.collection.objects.link(bpy.data.objects.new('leaves', lm))
    out = os.path.join(ROOT, 'assets', 'tex', 'surface'); mt.OUT = out; mt.render(sc, 'ivy_crest')
    save_small(out, 'ivy_crest')
    print('IVY_CREST', W * K, H * K, flush=True)


import sys
_args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not _args or 'ivy' in _args: main()
if not _args or 'crest' in _args: crest()
