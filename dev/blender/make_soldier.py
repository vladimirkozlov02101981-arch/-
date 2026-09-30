"""
Спрайты бойца из 3D-модели (Soldier.glb из примеров three.js: персонаж и анимации Mixamo — бесплатны
для игр; в репозиторий кладутся только отрендеренные кадры).

Запуск:  blender -b --python dev/blender/make_soldier.py -- путь/к/Soldier.glb
Результат: assets/tex/soldier_free.png, soldier_aim.png (+ _mask — визор для цвета команды), soldier.json

Кадр 144×144 px = 2.3 м (рост 1.73 м ≈ 108 px; в игре рисуется ~40 px, запас резкости для увеличения камерой).
Ступни — точка (72, 126). Свет — тот же низкий тёплый «солнце сверху слева», что у текстур карт.
"""
import bpy, math, sys, os, json
import numpy as np
from mathutils import Vector

GLB = sys.argv[-1]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('SOLDIER_OUT') or os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'tex'))
CELL = 144; MPP = 2.3 / CELL; FOOT = (72, 126)
ANGLES = [math.radians(a) for a in range(-90, 91, 15)]          # прицел: −90° вверх … +90° вниз (как в игре, y вниз)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
sc = bpy.context.scene
arm = bpy.data.objects['Character']
root = bpy.data.objects.new('root', None); sc.collection.objects.link(root)
for o in list(bpy.data.objects):
    if o.parent is None and o is not root and o.type != 'CAMERA': o.parent = root
root.rotation_euler = (0, 0, -math.pi / 2)                      # лицом вдоль +X (вправо в кадре): поворачиваем родителя — анимация его не трогает
bpy.context.view_layer.update()
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name == 'Icosphere': o.hide_render = True

sc.render.engine = 'CYCLES'; sc.cycles.samples = 40; sc.cycles.use_denoising = True
try:
    sc.cycles.device = 'CPU'
except Exception: pass
sc.render.resolution_x = CELL; sc.render.resolution_y = CELL; sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'AgX'
try: sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception: pass
cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = 2.3
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (0, -10, 2.3 / 2 - (CELL - FOOT[1]) * MPP); cam.rotation_euler = (math.radians(90), 0, 0)
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.68, 0.9, 1); w.node_tree.nodes['Background'].inputs[1].default_value = 0.45
def sun(energy, col, elev, az):
    d = bpy.data.lights.new('s', 'SUN'); d.energy = energy; d.color = col; d.angle = math.radians(3)
    o = bpy.data.objects.new('s', d); sc.collection.objects.link(o)
    e = math.radians(elev); a = math.radians(az)
    v = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), -math.sin(e)))
    o.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
sun(4.2, (1.0, 0.86, 0.68), 32, -30)      # тёплое солнце слева-спереди сверху
sun(1.6, (0.7, 0.8, 1.0), 20, 150)        # холодный контровой свет справа-сзади: отделяет силуэт от фона

ARM_BONES = [b.name for b in arm.data.bones if any(k in b.name for k in ('Shoulder', 'Arm', 'Hand'))]
pb = arm.pose.bones
def fcurves(act):
    if hasattr(act, 'fcurves'): return list(act.fcurves)          # Blender 4.x
    out = []                                                      # Blender 5: слои → полосы → каналы
    for L in act.layers:
        for st in L.strips:
            for cb in st.channelbags: out.extend(cb.fcurves)
    return out
ARMS_FREE = [True]
def mute_arms(on):
    """руки под ручное управление: кривые рук удаляются из всех действий (отключение кривых в Blender 5 не действует)"""
    if not on or not ARMS_FREE[0]: return
    ARMS_FREE[0] = False
    for act in bpy.data.actions:
        bags = [act] if hasattr(act, 'fcurves') else [cb for L in act.layers for st in L.strips for cb in st.channelbags]
        for bag in bags:
            for fc in [f for f in bag.fcurves if any('"%s"' % n in f.data_path for n in ARM_BONES)]: bag.fcurves.remove(fc)
def empty(name):
    e = bpy.data.objects.new(name, None); sc.collection.objects.link(e); return e
tR, tL, pR, pL = empty('tR'), empty('tL'), empty('pR'), empty('pL')
iks = []
for side, t, p in (('Right', tR, pR), ('Left', tL, pL)):
    c = pb['mixamorig:%sForeArm' % side].constraints.new('IK'); c.target = t; c.pole_target = p; c.chain_count = 2; c.pole_angle = math.radians(-90)
    c.use_tail = True; iks.append(c)
for c in iks: c.mute = True                                     # ограничение IK не дотягивает — руки ставим аналитически (ниже)
IK_ON = [False]
def point_bone(name, target):
    """повернуть кость так, чтобы она смотрела из своего начала на точку target (мировые координаты)"""
    p = pb[name]; bpy.context.view_layer.update()
    mw = arm.matrix_world; inv = mw.inverted()
    head = p.head; tgt = inv @ target
    m = p.matrix.copy(); y = m.to_3x3().col[1].normalized(); d = (tgt - head).normalized()
    q = y.rotation_difference(d); r3 = q.to_matrix() @ m.to_3x3()
    nm = r3.to_4x4(); nm.translation = m.translation; p.matrix = nm
    bpy.context.view_layer.update()
def solve_arm(side, target, hint):
    """двухзвенная рука: локоть в плоскости плечо–цель, отогнут в сторону hint"""
    up, fo = pb['mixamorig:%sArm' % side], pb['mixamorig:%sForeArm' % side]
    bpy.context.view_layer.update()
    hd = pb['mixamorig:%sHand' % side]; mw = arm.matrix_world                  # длины — по суставам (у костей Mixamo масштаб позы ×100)
    P = mw @ up.head; a = (mw @ fo.head - P).length; b = (mw @ hd.head - mw @ fo.head).length
    D = target - P; d = min(D.length, (a + b) * 0.999); u = D.normalized()
    v = (hint - u * hint.dot(u)).normalized()
    x = (a * a - b * b + d * d) / (2 * d); y = math.sqrt(max(0.0, a * a - x * x))
    E = P + u * x + v * y
    point_bone('mixamorig:%sArm' % side, E)
    point_bone('mixamorig:%sForeArm' % side, P + u * d)
    point_bone('mixamorig:%sHand' % side, P + u * d + u * 0.1)
def ik(on):
    IK_ON[0] = on
    mute_arms(on)


def world(name):
    return arm.matrix_world @ pb[name].head
def frame_of(action, k, n):
    a = bpy.data.actions[action]; f0, f1 = a.frame_range
    return f0 + (f1 - f0) * k / n
def set_pose(action, fr):
    A = bpy.data.actions[action]
    if arm.animation_data.action != A:
        arm.animation_data.action = A
        if hasattr(A, 'slots') and len(A.slots): arm.animation_data.action_slot = A.slots[0]   # Blender 5: без слота действие не играет
    root.rotation_euler = (0, 0, -math.pi / 2)
    sc.frame_set(int(fr), subframe=fr - int(fr))
    # корень анимации на месте: бёдра по X не уезжают
    bpy.context.view_layer.update()

visor = bpy.data.objects.get('vanguard_visor'); body = bpy.data.objects.get('vanguard_Mesh')
mask_mat = bpy.data.materials.new('maskW'); mask_mat.use_nodes = True
nt = mask_mat.node_tree; nt.nodes.clear(); em = nt.nodes.new('ShaderNodeEmission'); em.inputs[1].default_value = 3; o_ = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], o_.inputs[0])
hold_mat = bpy.data.materials.new('hold'); hold_mat.use_nodes = True
nt = hold_mat.node_tree; nt.nodes.clear(); ho = nt.nodes.new('ShaderNodeHoldout'); o_ = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(ho.outputs[0], o_.inputs[0])

def render_cell(path):
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
def render_mask(path):
    # маска визора: визор светится белым, тело — «дырка» (перекрывает визор там, где он за телом)
    om = [s.material for s in body.material_slots]; ov = [s.material for s in visor.material_slots]
    for s in body.material_slots: s.material = hold_mat
    for s in visor.material_slots: s.link = 'OBJECT'; s.material = mask_mat
    smp = sc.cycles.samples; sc.cycles.samples = 8; dn = sc.cycles.use_denoising; sc.cycles.use_denoising = False
    render_cell(path)
    for s, m in zip(body.material_slots, om): s.material = m
    for s, m in zip(visor.material_slots, ov): s.material = m; s.link = 'DATA'
    sc.cycles.samples = smp; sc.cycles.use_denoising = dn

tmp = os.path.join(OUT, '_frames'); os.makedirs(tmp, exist_ok=True)
cells = []   # (sheet, row, col, file, maskfile)

def aim_targets(a, climb=None):
    """цели кистей: правая — у спускового крючка, левая — на цевье, вдоль линии прицела от плеч"""
    S = (world('mixamorig:RightArm') + world('mixamorig:LeftArm')) / 2
    d = Vector((math.cos(a), 0, -math.sin(a)))
    tR.location = S + d * 0.35 + Vector((0, -0.10, -0.07)); tL.location = S + d * 0.62 + Vector((0, 0.02, -0.05))
    solve_arm('Right', tR.location.copy(), Vector((-0.4, -0.3, -1))); solve_arm('Left', tL.location.copy(), Vector((-0.3, 0.3, -1)))
    return S

if os.environ.get('SOLDIER_DEBUG'):                            # отладка: несколько кадров с выводом положения кисти
    for (act, fr, aim) in [('Idle', 0, None), ('Walk', 5, None), ('Idle', 0, 0.0), ('Walk', 5, 0.0), ('Idle', 0, -0.8), ('Idle', 0, 0.8), ('Walk', 10, 0.5)]:
        set_pose(act, fr)
        if aim is None: ik(False)
        else:
            ik(True)
            for nme in ARM_BONES: pb[nme].rotation_quaternion = (1, 0, 0, 0)
            aim_targets(aim); bpy.context.view_layer.update()
        print('IK', [(c.is_valid, c.influence, c.mute, c.subtarget) for c in iks], 'Rarm', tuple(round(v, 2) for v in world('mixamorig:RightArm')), 'fore', tuple(round(v, 2) for v in world('mixamorig:RightForeArm')))
        print('DBG', act, fr, aim, 'root', tuple(round(v, 2) for v in root.rotation_euler), 'hand', tuple(round(v, 2) for v in world('mixamorig:RightHand')), 'tgt', tuple(round(v, 2) for v in tR.location))
        render_cell(os.path.join(OUT, 'dbg_%s_%d_%s.png' % (act, fr, aim)))
    sys.exit(0)
meta = {'cell': CELL, 'foot': FOOT, 'mpp': MPP, 'angles': [round(math.degrees(a)) for a in ANGLES], 'free': {}, 'aim': {'rows': len(ANGLES)}}
# ---- без оружия: стойка 8, шаг 12, бег 10, лазание 8
FREE = [('idle', 'Idle', 8), ('walk', 'Walk', 12), ('run', 'Run', 10), ('climb', 'Walk', 8)]
for row, (key, act, n) in enumerate(FREE):
    meta['free'][key] = {'row': row, 'n': n}
    for k in range(n):
        set_pose(act, frame_of(act, k, n))
        if key == 'climb':
            for nme in ARM_BONES: pb[nme].rotation_quaternion = (1, 0, 0, 0)
            ik(True); S = (world('mixamorig:RightArm') + world('mixamorig:LeftArm')) / 2; ph = k / n * math.tau
            tR.location = S + Vector((0.12, -0.12, 0.42 + 0.12 * math.sin(ph))); tL.location = S + Vector((0.12, 0.12, 0.42 - 0.12 * math.sin(ph)))
            solve_arm('Right', tR.location.copy(), Vector((-1, -0.3, 0))); solve_arm('Left', tL.location.copy(), Vector((-1, 0.3, 0)))
        else: ik(False)
        f = os.path.join(tmp, 'free_%d_%d.png' % (row, k)); render_cell(f); fm = os.path.join(tmp, 'freem_%d_%d.png' % (row, k)); render_mask(fm)
        cells.append(('free', row, k, f, fm))
ik(False)
# ---- с оружием: строка = угол прицела, столбец 0 — стойка, 1..12 — шаг
shoulder = None
for row, a in enumerate(ANGLES):
    for col in range(13):
        if col == 0: set_pose('Idle', frame_of('Idle', 0, 8))
        else: set_pose('Walk', frame_of('Walk', col - 1, 12))
        ik(True)
        for nme in ARM_BONES: pb[nme].rotation_quaternion = (1, 0, 0, 0)
        S = aim_targets(a); bpy.context.view_layer.update()
        if shoulder is None: shoulder = S.copy()
        f = os.path.join(tmp, 'aim_%d_%d.png' % (row, col)); render_cell(f); fm = os.path.join(tmp, 'aimm_%d_%d.png' % (row, col)); render_mask(fm)
        cells.append(('aim', row, col, f, fm))
meta['shoulder'] = [round(FOOT[0] + shoulder.x / MPP, 1), round(FOOT[1] - shoulder.z / MPP, 1)]

# ---- сборка листов
def load(p):
    im = bpy.data.images.load(p); a = np.array(im.pixels[:], dtype=np.float32).reshape(CELL, CELL, 4)[::-1]; bpy.data.images.remove(im); return a
def save(arr, path):
    h, w_ = arr.shape[:2]; im = bpy.data.images.new('sheet', w_, h, alpha=True)
    im.pixels[:] = arr[::-1].ravel(); im.filepath_raw = path; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)
for sheet, rows, cols in (('free', len(FREE), 12), ('aim', len(ANGLES), 13)):
    A = np.zeros((rows * CELL, cols * CELL, 4), np.float32); M = np.zeros_like(A)
    for s, r, c, f, fm in cells:
        if s != sheet: continue
        A[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = load(f)
        m = load(fm); M[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = m
    save(A, os.path.join(OUT, 'soldier_%s.png' % sheet)); save(M, os.path.join(OUT, 'soldier_%s_mask.png' % sheet))
json.dump(meta, open(os.path.join(OUT, 'soldier.json'), 'w'))
print('SOLDIER DONE', meta['shoulder'])
