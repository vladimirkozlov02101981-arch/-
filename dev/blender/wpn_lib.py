"""Инструменты для подробных моделей оружия (Blender 5.x, Cycles): детали с фасками, скруглённые профили, винты, рельсы,
насечки и PBR-материалы с потёртостями. Единицы — игровые (1 ед. = 1 см сцены), ось x — вдоль ствола, y игры — вниз
(в сцене z = −y), глубина — ось y сцены (положительное z детали — к камере).
Используется из make_weapons2.py."""
import bpy, bmesh, math, os
from mathutils import Vector

U = 0.01
HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_HDRI = None
for cand in (r'D:\Program Files\Blender Foundation\Blender 5.2\5.2\datafiles\studiolights\world\studio.exr',
             os.path.join(os.path.dirname(bpy.app.binary_path), '5.2', 'datafiles', 'studiolights', 'world', 'studio.exr')):
    if os.path.exists(cand):
        BLENDER_HDRI = cand; break


def use_gpu(sc):
    try:
        pr = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                pr.compute_device_type = kind; pr.get_devices()
                ds = [d for d in pr.devices if d.type == kind]
                if ds:
                    for d in pr.devices: d.use = d.type == kind
                    sc.cycles.device = 'GPU'; return True
            except Exception: pass
    except Exception: pass
    return False


def scene(x0, x1, y0, y1, pxu, samples=None):
    """пустая сцена: ортокамера на кадр [x0,x1]×[y0,y1] игровых единиц, pxu пикселей на единицу, студийный свет"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; gpu = use_gpu(sc)
    sc.cycles.samples = samples or (384 if gpu else 96); sc.cycles.use_denoising = True
    try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception: pass
    sc.render.resolution_x = int((x1 - x0) * pxu); sc.render.resolution_y = int((y1 - y0) * pxu); sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.image_settings.color_depth = '8'
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        try: sc.view_settings.look = 'AgX - Punchy'
        except Exception: pass
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = max(x1 - x0, y1 - y0) * U
    cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = ((x0 + x1) / 2 * U, -5, -(y0 + y1) / 2 * U); cam.rotation_euler = (math.radians(90), 0, 0)
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; N = w.node_tree.nodes; L = w.node_tree.links
    bg = N['Background']
    if BLENDER_HDRI:
        env = N.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(BLENDER_HDRI, check_existing=True)
        mp = N.new('ShaderNodeMapping'); tc = N.new('ShaderNodeTexCoord'); mp.inputs['Rotation'].default_value = (0, 0, math.radians(200))
        L.new(tc.outputs['Generated'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], env.inputs['Vector']); L.new(env.outputs['Color'], bg.inputs['Color'])
        bg.inputs['Strength'].default_value = 0.65
    else:
        bg.inputs['Color'].default_value = (0.35, 0.38, 0.42, 1); bg.inputs['Strength'].default_value = 0.6
    # тот же тёплый свет сверху-слева, что у карт; холодный контровой сзади-справа обводит силуэт; мягкий снизу
    for en, col, loc, size in ((34.0, (1.0, 0.9, 0.78), (-0.35, -0.9, 0.75), 0.8), (22.0, (0.72, 0.84, 1.0), (0.6, 0.85, 0.45), 0.5), (6.0, (1.0, 0.92, 0.84), (0.2, -0.8, -0.65), 0.9)):
        d = bpy.data.lights.new('a', 'AREA'); d.energy = en; d.color = col; d.size = size
        o = bpy.data.objects.new('a', d); sc.collection.objects.link(o); o.location = loc
        o.rotation_euler = (Vector((0.08, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return sc


def render(sc, path):
    os.makedirs(os.path.dirname(path), exist_ok=True); sc.render.filepath = path; bpy.ops.render.render(write_still=True); print('WROTE', path, flush=True)


# ---------------- материалы ----------------
def _n(m, kind, **kw):
    n = m.node_tree.nodes.new(kind)
    for k, v in kw.items():
        if k in n.inputs: n.inputs[k].default_value = v
        else: setattr(n, k, v)
    return n


def _lin(c): return (*[x ** 2.2 for x in c], 1)


def pbr(name, col, metal=0.0, rough=0.5, wear=0.0, bare=(0.6, 0.6, 0.62), dirt=0.3, scratch=0.0, bump=0.06, scale=60, coat=0.0, emit=None, emit_k=0.0, stipple=0.0, aniso=0.0, mottle=0.0):
    """PBR без развёртки: шум шероховатости, царапины вдоль ствола (x), стёртая краска на рёбрах до металла (bare),
    грязь во впадинах, зерно/насечка (stipple), пятна закалки (mottle), свечение (emit)"""
    m = bpy.data.materials.new(name); m.use_nodes = True; N = m.node_tree.nodes; L = m.node_tree.links; b = N['Principled BSDF']
    tc = _n(m, 'ShaderNodeTexCoord')
    nz = _n(m, 'ShaderNodeTexNoise', Scale=scale * 0.25, Detail=6.0, Roughness=0.6); L.new(tc.outputs['Object'], nz.inputs['Vector'])
    rr = _n(m, 'ShaderNodeMapRange'); rr.inputs['To Min'].default_value = rough * 0.72; rr.inputs['To Max'].default_value = min(1, rough * 1.32)
    L.new(nz.outputs['Fac'], rr.inputs['Value']); rough_out = rr.outputs['Result']
    base = _n(m, 'ShaderNodeRGB'); base.outputs[0].default_value = _lin(col)
    cv = _n(m, 'ShaderNodeTexNoise', Scale=scale * 0.6, Detail=8.0, Roughness=0.62); L.new(tc.outputs['Object'], cv.inputs['Vector'])
    cvr = _n(m, 'ShaderNodeMapRange'); cvr.inputs['To Min'].default_value = 0.8; cvr.inputs['To Max'].default_value = 1.2; L.new(cv.outputs['Fac'], cvr.inputs['Value'])
    cvm = _n(m, 'ShaderNodeVectorMath', operation='SCALE'); L.new(base.outputs[0], cvm.inputs[0]); L.new(cvr.outputs['Result'], cvm.inputs['Scale'])
    color_out = cvm.outputs['Vector']
    if mottle:   # пятна цементации/закалки (рамка револьвера, курок)
        mn = _n(m, 'ShaderNodeTexNoise', Scale=scale * 0.9, Detail=3.0, Distortion=2.5); L.new(tc.outputs['Object'], mn.inputs['Vector'])
        mx = _n(m, 'ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'OVERLAY'; mx.inputs['Factor'].default_value = mottle
        L.new(color_out, mx.inputs[6]); L.new(mn.outputs['Color'], mx.inputs[7]); color_out = mx.outputs[2]
    metal_out = None
    if scratch:
        mp = _n(m, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale * 0.2, scale * 5, scale * 5)
        L.new(tc.outputs['Object'], mp.inputs['Vector'])
        sn = _n(m, 'ShaderNodeTexNoise', Scale=2.0, Detail=2.0); L.new(mp.outputs['Vector'], sn.inputs['Vector'])
        sr = _n(m, 'ShaderNodeMapRange'); sr.inputs['From Min'].default_value = 0.68; sr.inputs['From Max'].default_value = 0.71
        L.new(sn.outputs['Fac'], sr.inputs['Value'])
        sk = _n(m, 'ShaderNodeMath', operation='MULTIPLY'); sk.inputs[1].default_value = scratch; L.new(sr.outputs['Result'], sk.inputs[0])
        rm = _n(m, 'ShaderNodeMix'); rm.data_type = 'FLOAT'; L.new(sk.outputs[0], rm.inputs['Factor']); L.new(rough_out, rm.inputs['A']); rm.inputs['B'].default_value = max(0.08, rough * 0.4)
        rough_out = rm.outputs['Result']
        sk2 = _n(m, 'ShaderNodeMath', operation='MULTIPLY'); sk2.inputs[1].default_value = 0.35; L.new(sk.outputs[0], sk2.inputs[0])
        cm = _n(m, 'ShaderNodeMix'); cm.data_type = 'RGBA'; L.new(sk2.outputs[0], cm.inputs['Factor']); L.new(color_out, cm.inputs[6]); cm.inputs[7].default_value = _lin(bare)
        color_out = cm.outputs[2]
    if wear:
        ao = _n(m, 'ShaderNodeAmbientOcclusion', inside=True, only_local=True); ao.inputs['Distance'].default_value = 0.0022
        inv = _n(m, 'ShaderNodeMath', operation='SUBTRACT'); inv.inputs[0].default_value = 1.0; L.new(ao.outputs['AO'], inv.inputs[1])
        en = _n(m, 'ShaderNodeTexNoise', Scale=scale * 2, Detail=10.0, Roughness=0.72); L.new(tc.outputs['Object'], en.inputs['Vector'])
        em = _n(m, 'ShaderNodeMath', operation='MULTIPLY'); L.new(inv.outputs[0], em.inputs[0]); L.new(en.outputs['Fac'], em.inputs[1])
        ew = _n(m, 'ShaderNodeMapRange'); ew.inputs['From Min'].default_value = 0.30 - wear * 0.2; ew.inputs['From Max'].default_value = 0.34 - wear * 0.2
        L.new(em.outputs[0], ew.inputs['Value'])
        cm = _n(m, 'ShaderNodeMix'); cm.data_type = 'RGBA'; L.new(ew.outputs['Result'], cm.inputs['Factor']); L.new(color_out, cm.inputs[6]); cm.inputs[7].default_value = _lin(bare)
        color_out = cm.outputs[2]
        mm = _n(m, 'ShaderNodeMix'); mm.data_type = 'FLOAT'; L.new(ew.outputs['Result'], mm.inputs['Factor']); mm.inputs['A'].default_value = metal; mm.inputs['B'].default_value = 1.0
        metal_out = mm.outputs['Result']
        r2 = _n(m, 'ShaderNodeMix'); r2.data_type = 'FLOAT'; L.new(ew.outputs['Result'], r2.inputs['Factor']); L.new(rough_out, r2.inputs['A']); r2.inputs['B'].default_value = 0.26
        rough_out = r2.outputs['Result']
    if dirt:
        ao2 = _n(m, 'ShaderNodeAmbientOcclusion', only_local=True); ao2.inputs['Distance'].default_value = 0.008
        dr = _n(m, 'ShaderNodeMapRange'); dr.inputs['To Min'].default_value = 1.0; dr.inputs['To Max'].default_value = 0.0; L.new(ao2.outputs['AO'], dr.inputs['Value'])
        dk = _n(m, 'ShaderNodeMath', operation='MULTIPLY'); dk.inputs[1].default_value = dirt; L.new(dr.outputs['Result'], dk.inputs[0])
        dm = _n(m, 'ShaderNodeMix'); dm.data_type = 'RGBA'; dm.blend_type = 'MULTIPLY'
        L.new(dk.outputs[0], dm.inputs['Factor']); L.new(color_out, dm.inputs[6]); dm.inputs[7].default_value = (0.07, 0.055, 0.04, 1)
        color_out = dm.outputs[2]
    L.new(color_out, b.inputs['Base Color']); L.new(rough_out, b.inputs['Roughness'])
    if metal_out: L.new(metal_out, b.inputs['Metallic'])
    else: b.inputs['Metallic'].default_value = metal
    if coat:
        for k in ('Coat Weight', 'Clearcoat'):
            if k in b.inputs: b.inputs[k].default_value = coat; break
    if aniso:
        for k in ('Anisotropic',):
            if k in b.inputs: b.inputs[k].default_value = aniso
    if emit:
        for k in ('Emission Color', 'Emission'):
            if k in b.inputs: b.inputs[k].default_value = _lin(emit); break
        if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = emit_k
    # микрорельеф и скруглённые кромки (узел Bevel); насечка — крупное зерно
    bev = _n(m, 'ShaderNodeBevel', samples=8); bev.inputs['Radius'].default_value = 0.0011
    bp = _n(m, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = bump + stipple; bp.inputs['Distance'].default_value = 0.0004 + stipple * 0.002
    fz = _n(m, 'ShaderNodeTexNoise', Scale=scale * (6 if not stipple else 14), Detail=12.0 if not stipple else 2.0, Roughness=0.65); L.new(tc.outputs['Object'], fz.inputs['Vector'])
    L.new(fz.outputs['Fac'], bp.inputs['Height']); L.new(bev.outputs['Normal'], bp.inputs['Normal']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m


def wood(name='wood', tint=(1.0, 1.0, 1.0), rings=0.7):
    """орех под лаком: волокна вдоль x, поры, лак, потёртости"""
    m = bpy.data.materials.new(name); m.use_nodes = True; N = m.node_tree.nodes; L = m.node_tree.links; b = N['Principled BSDF']
    tc = _n(m, 'ShaderNodeTexCoord'); mp = _n(m, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (5.0, 90.0, 90.0)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    dn = _n(m, 'ShaderNodeTexNoise', Scale=2.2, Detail=5.0); L.new(mp.outputs['Vector'], dn.inputs['Vector'])
    add = _n(m, 'ShaderNodeVectorMath', operation='ADD'); L.new(mp.outputs['Vector'], add.inputs[0]); L.new(dn.outputs['Color'], add.inputs[1])
    w = _n(m, 'ShaderNodeTexWave', wave_type='RINGS', rings_direction='X'); w.inputs['Scale'].default_value = rings; w.inputs['Distortion'].default_value = 5.0; w.inputs['Detail'].default_value = 4.0
    L.new(add.outputs['Vector'], w.inputs['Vector'])
    ramp = _n(m, 'ShaderNodeValToRGB'); E = ramp.color_ramp.elements
    E[0].position = 0.15; E[0].color = tuple(c * t for c, t in zip((0.07, 0.028, 0.011), tint)) + (1,); E[1].position = 0.95; E[1].color = tuple(c * t for c, t in zip((0.17, 0.07, 0.026), tint)) + (1,)
    L.new(w.outputs['Fac'], ramp.inputs['Fac'])
    pores = _n(m, 'ShaderNodeTexNoise', Scale=70.0, Detail=2.0); L.new(mp.outputs['Vector'], pores.inputs['Vector'])
    pm = _n(m, 'ShaderNodeMix'); pm.data_type = 'RGBA'; pm.blend_type = 'MULTIPLY'; pm.inputs['Factor'].default_value = 0.32
    L.new(ramp.outputs['Color'], pm.inputs[6]); L.new(pores.outputs['Color'], pm.inputs[7])
    L.new(pm.outputs[2], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.36
    for k in ('Coat Weight', 'Clearcoat'):
        if k in b.inputs: b.inputs[k].default_value = 0.55; break
    for k in ('Coat Roughness', 'Clearcoat Roughness'):
        if k in b.inputs: b.inputs[k].default_value = 0.1; break
    bev = _n(m, 'ShaderNodeBevel', samples=8); bev.inputs['Radius'].default_value = 0.0014
    bp = _n(m, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.1; bp.inputs['Distance'].default_value = 0.0003
    L.new(w.outputs['Fac'], bp.inputs['Height']); L.new(bev.outputs['Normal'], bp.inputs['Normal']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m


def glass(name='glass', col=(0.6, 0.85, 1.0), dark=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = _lin(col); b.inputs['Roughness'].default_value = 0.03
    for k in ('Transmission Weight', 'Transmission'):
        if k in b.inputs: b.inputs[k].default_value = 1.0 - dark; break
    b.inputs['IOR'].default_value = 1.5
    return m


class M:
    """набор материалов одной модели (создаются по требованию)"""
    def __init__(self): self.c = {}
    def get(self, k, f):
        if k not in self.c: self.c[k] = f()
        return self.c[k]
    # воронёная/чернёная сталь с потёртостями до металла
    @property
    def gun(self): return self.get('gun', lambda: pbr('gun', (0.05, 0.052, 0.056), 0.86, 0.38, wear=0.55, bare=(0.5, 0.5, 0.52), dirt=0.3, scratch=0.15, scale=70))
    @property
    def blued(self): return self.get('blued', lambda: pbr('blued', (0.035, 0.045, 0.07), 1.0, 0.2, wear=0.45, bare=(0.55, 0.55, 0.58), dirt=0.2, scratch=0.1, coat=0.4, scale=80))
    @property
    def steel(self): return self.get('steel', lambda: pbr('steel', (0.5, 0.51, 0.53), 1.0, 0.32, dirt=0.25, scratch=0.25, scale=60))
    @property
    def nickel(self): return self.get('nickel', lambda: pbr('nickel', (0.74, 0.75, 0.76), 1.0, 0.16, dirt=0.15, scratch=0.15, scale=70, aniso=0.4))
    @property
    def poly(self): return self.get('poly', lambda: pbr('poly', (0.035, 0.036, 0.038), 0.0, 0.6, dirt=0.2, stipple=0.12, scale=60))
    @property
    def tan(self): return self.get('tan', lambda: pbr('tan', (0.43, 0.35, 0.24), 0.0, 0.62, dirt=0.35, stipple=0.06, scale=50))
    @property
    def od(self): return self.get('od', lambda: pbr('od', (0.24, 0.27, 0.15), 0.0, 0.62, wear=0.85, bare=(0.48, 0.48, 0.49), dirt=0.45, scale=50))
    @property
    def odgreen(self): return self.get('odgreen', lambda: pbr('odgreen', (0.19, 0.25, 0.13), 0.0, 0.6, dirt=0.3, stipple=0.05, scale=50))
    @property
    def brass(self): return self.get('brass', lambda: pbr('brass', (0.8, 0.6, 0.27), 1.0, 0.28, dirt=0.25, scratch=0.2, scale=60))
    @property
    def copper(self): return self.get('copper', lambda: pbr('copper', (0.82, 0.45, 0.3), 1.0, 0.24, dirt=0.2, scale=60))
    @property
    def rubber(self): return self.get('rubber', lambda: pbr('rubber', (0.04, 0.04, 0.04), 0.0, 0.85, dirt=0.15, stipple=0.08, scale=90))
    @property
    def wood(self): return self.get('wood', lambda: wood())
    @property
    def dark(self): return self.get('dark', lambda: pbr('dark', (0.012, 0.012, 0.013), 0.3, 0.6, dirt=0.0, scale=60))
    @property
    def red(self): return self.get('red', lambda: pbr('red', (0.62, 0.08, 0.05), 0.0, 0.4, wear=0.6, bare=(0.55, 0.55, 0.56), dirt=0.35, scale=40))
    @property
    def white(self): return self.get('white', lambda: pbr('white', (0.82, 0.84, 0.86), 0.0, 0.35, dirt=0.25, scale=40))
    @property
    def yellow(self): return self.get('yellow', lambda: pbr('yellow', (0.88, 0.66, 0.08), 0.0, 0.45, wear=0.6, bare=(0.5, 0.5, 0.5), dirt=0.4, scale=40))
    def glow(self, col, k=12): return self.get('glow' + str(col), lambda: pbr('glow', col, 0.0, 0.25, dirt=0.0, emit=col, emit_k=k, scale=40))
    def glass(self, col=(0.6, 0.85, 1.0), dark=0.0): return self.get('glass' + str(col) + str(dark), lambda: glass('glass', col, dark))


# ---------------- геометрия ----------------
def _obj(me, m, bevel=0.3, seg=3, smooth=True, name='p'):
    me.materials.append(m); o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    for p in me.polygons: p.use_smooth = smooth
    if bevel:
        bv = o.modifiers.new('b', 'BEVEL'); bv.width = bevel * U; bv.segments = seg; bv.limit_method = 'ANGLE'; bv.angle_limit = math.radians(35)
        try: bv.harden_normals = True
        except Exception: pass
    try:
        wn = o.modifiers.new('wn', 'WEIGHTED_NORMAL'); wn.keep_sharp = True
    except Exception: pass
    return o


def fillet(pts, r):
    """скругление углов многоугольника радиусом r (игровые единицы)"""
    if not r: return pts
    out, n = [], len(pts)
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        a, b = (p0 - p1), (p2 - p1)
        la, lb = a.length, b.length
        if la < 1e-6 or lb < 1e-6: out.append(tuple(p1)); continue
        a.normalize(); b.normalize()
        ang = math.acos(max(-1.0, min(1.0, a.dot(b))))
        if ang < 1e-3 or abs(ang - math.pi) < 1e-3: out.append(tuple(p1)); continue
        t = min(r / math.tan(ang / 2), la * 0.45, lb * 0.45)
        s, e = p1 + a * t, p1 + b * t
        k = 5
        for j in range(k + 1):   # квадратичная кривая Безье через угол — мягкое скругление
            u = j / k; q = s * (1 - u) ** 2 + p1 * 2 * u * (1 - u) + e * u * u; out.append((q.x, q.y))
    return out


def prof(pts, d, m, z=0.0, r=0.0, bevel=0.32, seg=3):
    """профиль (силуэт сбоку) по точкам (x, y) игровых единиц, скругление углов r, толщина d, сдвиг к камере z"""
    pts = fillet(pts, r)
    bm = bmesh.new(); vs = [bm.verts.new((x * U, (-d / 2 - z) * U, -y * U)) for x, y in pts]
    try: f = bm.faces.new(vs)
    except ValueError: bm.free(); return None
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in res['geom']:
        if isinstance(v, bmesh.types.BMVert): v.co.y += d * U
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('p'); bm.to_mesh(me); bm.free()
    return _obj(me, m, bevel=bevel, seg=seg, smooth=False)


def box(x, y, w, h, d, m, z=0.0, rot=0.0, bevel=0.22):
    """брусок: x,y — левый-верх (игровые единицы, y вниз), w×h, толщина d, сдвиг к камере z, поворот rot (рад, по часовой)"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    me = bpy.data.meshes.new('b'); bm.to_mesh(me); bm.free()
    o = _obj(me, m, bevel=bevel, smooth=False); o.scale = (w * U, d * U, h * U)
    o.location = ((x + w / 2) * U, -z * U, -(y + h / 2) * U); o.rotation_euler = (0, rot, 0)
    return o


def cyl(x, y, L, r, m, z=0.0, seg=40, r2=None, rot=0.0, bevel=0.2, axis='x'):
    """цилиндр от (x,y) длиной L вдоль оси: 'x' — вдоль ствола (rot — наклон), 'z' — на камеру (винт, кнопка, ручка)"""
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r * U, radius2=(r2 if r2 is not None else r) * U, depth=L * U)
    me = bpy.data.meshes.new('c'); bm.to_mesh(me); bm.free()
    o = _obj(me, m, bevel=bevel)
    if axis == 'z':
        o.rotation_euler = (math.radians(90), 0, 0); o.location = (x * U, (-z - L / 2) * U, -y * U)
    else:
        o.rotation_euler = (0, math.pi / 2 + rot, 0)
        # Центр лежит на той же оси, что и поворот: конец (x+L*cos(rot), y+L*sin(rot)).
        o.location = ((x + L / 2 * math.cos(rot)) * U, -z * U, -(y + L / 2 * math.sin(rot)) * U)
    return o


def lathe(x, y, profile, m, z=0.0, rot=0.0, seg=64):
    """Единая поверхность вращения: пары (дистанция, радиус) по общей оси без стыков цилиндров."""
    ca, sa = math.cos(rot), math.sin(rot)
    verts = []
    for t, r in profile:
        for i in range(seg):
            q = math.tau * i / seg; rr = r * math.cos(q)
            verts.append(((x + t * ca + rr * sa) * U, (-z + r * math.sin(q)) * U,
                          (-(y + t * sa) + rr * ca) * U))
    faces = [tuple(range(seg - 1, -1, -1))]
    for row in range(len(profile) - 1):
        for i in range(seg):
            j = (i + 1) % seg; p, n = row * seg, (row + 1) * seg
            faces.append((p + i, p + j, n + j, n + i))
    faces.append(tuple((len(profile) - 1) * seg + i for i in range(seg)))
    me = bpy.data.meshes.new('lathe'); me.from_pydata(verts, [], faces); me.update()
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    o = _obj(me, m, bevel=0, name='lathe')
    me.polygons[0].use_smooth = me.polygons[-1].use_smooth = False
    return o


def ball(x, y, r, m, z=0.0, sx=1.0, sy=1.0, sz=1.0):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=r * U)
    me = bpy.data.meshes.new('s'); bm.to_mesh(me); bm.free()
    o = _obj(me, m, bevel=0); o.location = (x * U, -z * U, -y * U); o.scale = (sx, sz, sy)
    return o


def torus(x, y, R, r, m, z=0.0, axis='x'):
    bpy.ops.mesh.primitive_torus_add(major_radius=R * U, minor_radius=r * U, major_segments=48, minor_segments=12)
    o = bpy.context.active_object; o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    o.location = (x * U, -z * U, -y * U); o.rotation_euler = (0, math.pi / 2, 0) if axis == 'x' else (math.radians(90), 0, 0)
    return o


def screw(x, y, m, z=1.0, r=0.32, slot=True):
    """винт/заклёпка, смотрящая на камеру"""
    cyl(x, y, 0.25, r, m, z=z + 0.12, seg=20, axis='z', bevel=0.08)
    if slot: box(x - r * 0.8, y - 0.05, r * 1.6, 0.1, 0.1, M_DARK[0] or m, z=z + 0.26, bevel=0)


M_DARK = [None]


def guard(x0, x1, y, h, m, z=0.0, t=0.42, d=0.5):
    """спусковая скоба — U-образная петля (внутри прозрачно): от x0 до x1 под рамкой на уровне y, глубина h"""
    o = [(x0, y), (x0 - 0.2, y + h * 0.45), (x0 + 0.4, y + h), (x1 - 1.0, y + h * 0.95), (x1, y + h * 0.2), (x1 + 0.2, y)]
    i = [(x1 + 0.2 - t, y), (x1 - t, y + h * 0.2), (x1 - 1.0, y + h * 0.95 - t), (x0 + 0.4 + t * 0.4, y + h - t), (x0 - 0.2 + t, y + h * 0.45), (x0 + t, y)]
    return prof(o + i, d, m, z=z, r=0.25, bevel=0.1, seg=2)


def rail(x0, x1, y, m, z=0.0, d=1.6):
    """планка Пикатинни: основание и зубцы"""
    box(x0, y + 0.35, x1 - x0, 0.55, d, m, z=z)
    x = x0 + 0.3
    while x < x1 - 0.5:
        box(x, y - 0.1, 0.55, 0.5, d * 0.95, m, z=z, bevel=0.06); x += 1.0


def grooves(x0, x1, y0, y1, n, m, z, vertical=True, w=0.25):
    """тёмные канавки/прорези на поверхности (насечка цевья, рёбра, окна)"""
    for i in range(n):
        if vertical:
            xx = x0 + (x1 - x0) * (i + 0.5) / n; box(xx - w / 2, y0, w, y1 - y0, 0.12, m, z=z, bevel=0)
        else:
            yy = y0 + (y1 - y0) * (i + 0.5) / n; box(x0, yy - w / 2, x1 - x0, w, 0.12, m, z=z, bevel=0)


def tube_path(points, r, m, z=0.0):
    """изогнутый шланг/провод через точки (x, y) игровых единиц"""
    cu = bpy.data.curves.new('h', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r * U; cu.bevel_resolution = 6; cu.resolution_u = 16
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(points) - 1)
    for bp, (x, y) in zip(sp.bezier_points, points):
        bp.co = (x * U, -z * U, -y * U); bp.handle_left_type = bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new('h', cu); cu.materials.append(m); bpy.context.scene.collection.objects.link(o)
    return o
