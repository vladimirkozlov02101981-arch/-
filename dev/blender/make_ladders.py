"""Лестницы из Blender: бесшовный по вертикали участок 28×48 ед. (4 перекладины через 12 ед., первая на 8), вид спереди.

blender -b --python dev/blender/make_ladders.py -- [wood steel steelY]
Пишет assets/tex/ladder_<вид>.png (4 px на единицу: 112×192, прозрачный фон). js/levels.js (ladderSprite) повторяет его
по высоте лестницы в утроенном разрешении — при приближении лестница чёткая. Тень на стене и скобы рисует игра.
wood — тетивы и круглые перекладины из дерева; steel — серая сталь; steelY — сталь, жёлтая краска с облупленными местами.
"""
import importlib.util
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
spec = importlib.util.spec_from_file_location('mt', os.path.join(HERE, 'make_textures.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

U = 0.01; K = 4; W, H = 28, 48; HR = 2 * H                   # рендер двух периодов: из них склеивается бесшовный участок


def painted_steel(name, paint, rough=0.45):
    """сталь под краской: краска (paint, sRGB) с облупленными пятнами голого металла и тёмной грязью в углублениях"""
    m, nt, b = mt.principled(name, rough, 0.5)
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 60; nz.inputs['Detail'].default_value = 8
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.62; mr.inputs['From Max'].default_value = 0.66
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    nt.links.new(mr.outputs['Result'], mt.sock(mx.inputs, 'Factor_Float'))
    mt.sock(mx.inputs, 'A_Color').default_value = (*mt.lin(paint), 1); mt.sock(mx.inputs, 'B_Color').default_value = (*mt.lin((0.36, 0.35, 0.34)), 1)
    nt.links.new(mt.sock(mx.outputs, 'Result_Color'), b.inputs['Base Color'])
    mm = nt.nodes.new('ShaderNodeMapRange'); mm.inputs['To Min'].default_value = 0.0; mm.inputs['To Max'].default_value = 0.9
    nt.links.new(mr.outputs['Result'], mm.inputs['Value']); nt.links.new(mm.outputs['Result'], b.inputs['Metallic'])
    nb = nt.nodes.new('ShaderNodeTexNoise'); nb.inputs['Scale'].default_value = 400; nb.inputs['Detail'].default_value = 6
    bu = nt.nodes.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.2
    nt.links.new(nb.outputs['Fac'], bu.inputs['Height']); nt.links.new(bu.outputs['Normal'], b.inputs['Normal'])
    return m


def ladder(kind):
    sc = mt.reset()
    sc.render.resolution_x = W * K; sc.render.resolution_y = HR * K; sc.render.resolution_percentage = 100
    sc.render.film_transparent = True; sc.render.image_settings.color_mode = 'RGBA'; sc.cycles.samples = 128
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    cam = sc.camera; cam.data.ortho_scale = max(W, HR) * U           # орто-масштаб задаёт бо́льшую сторону кадра (здесь высоту)
    cam.location = (W * U / 2, -10, -HR * U / 2); cam.rotation_euler = (math.radians(90), 0, 0)
    bpy.data.objects['sun'].rotation_euler = Vector((0.5, 0.55, -0.67)).normalized().to_track_quat('-Z', 'Y').to_euler()
    if kind == 'wood':
        mat = mt.mat_wood('wood', (0.36, 0.24, 0.13), (0.70, 0.52, 0.32)); rung_mat = mat
    elif kind == 'steel':
        mat = painted_steel('steel', (0.55, 0.57, 0.6), 0.4); rung_mat = mat
    else:
        mat = painted_steel('steelY', (0.86, 0.66, 0.12), 0.5); rung_mat = mat
    bm = bmesh.new()
    for x0 in (3, 21):                                               # тетивы — длиннее кадра, чтобы участок был бесшовным
        if kind == 'wood':
            bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation(Vector(((x0 + 2) * U, 0, -HR / 2 * U))) @ Matrix.Diagonal((4 * U, 3.2 * U, (HR + 20) * U, 1)))
        else:
            bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=1.7 * U, radius2=1.7 * U, depth=(HR + 20) * U,
                                  matrix=Matrix.Translation(Vector(((x0 + 2) * U, 0, -HR / 2 * U))))
    rungs = bmesh.new()
    for k in range(-1, 9):                                           # перекладины на 8, 20, 32, 44, … (+ соседние за кадром)
        z = -(8 + 12 * k) * U
        bmesh.ops.create_cone(rungs, cap_ends=True, segments=16, radius1=(1.5 if kind == 'wood' else 1.2) * U, radius2=(1.5 if kind == 'wood' else 1.2) * U,
                              depth=18 * U, matrix=Matrix.Translation(Vector((14 * U, -0.6 * U, z))) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    me = bpy.data.meshes.new('rails'); bm.to_mesh(me); bm.free()
    bv = None
    o = bpy.data.objects.new('rails', me); sc.collection.objects.link(o); me.materials.append(mat); o['tone'] = 0.0
    if kind == 'wood':
        bv = o.modifiers.new('bev', 'BEVEL'); bv.width = 0.006; bv.segments = 3
    for p in me.polygons: p.use_smooth = True
    me2 = bpy.data.meshes.new('rungs'); rungs.to_mesh(me2); rungs.free()
    for p in me2.polygons: p.use_smooth = True
    o2 = bpy.data.objects.new('rungs', me2); sc.collection.objects.link(o2); me2.materials.append(rung_mat); o2['tone'] = 0.3
    tmp = os.path.join(ROOT, 'test-results'); mt.OUT = tmp; mt.render(sc, 'ladder_' + kind + '_2p')
    # бесшовный участок: строки y и y+H двух периодов смешиваются с весом y/H — верх и низ участка совпадают
    im = bpy.data.images.load(os.path.join(tmp, 'ladder_' + kind + '_2p.png'))
    a = np.array(im.pixels[:], np.float32).reshape(HR * K, W * K, 4)[::-1]
    top, bot = a[:H * K], a[H * K:]
    w = (np.arange(H * K, dtype=np.float32) / (H * K))[:, None, None]
    t = bot * (1 - w) + top * w
    out = bpy.data.images.new('ladder_' + kind, W * K, H * K, alpha=True)
    out.pixels.foreach_set(t[::-1].ravel()); out.filepath_raw = os.path.join(ROOT, 'assets', 'tex', 'ladder_' + kind + '.png'); out.file_format = 'PNG'; out.save()


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for kind in (argv or ['wood', 'steel', 'steelY']):
        ladder(kind); print('LADDER', kind, flush=True)


main()
