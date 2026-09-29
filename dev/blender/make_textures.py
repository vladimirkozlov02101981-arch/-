"""
Фотореалистичные бесшовные текстуры для карт Territory War: Frontlines.

Запуск (Blender 4.2+ / 5.x):
    blender -b --python dev/blender/make_textures.py -- [имя ...]

Каждая текстура — настоящая 3D-сцена (грунт с утопленными камнями, кладка из
скруглённых блоков, стена пещеры из плит), отрендеренная Cycles ортокамерой сверху.
Свет — солнце сверху слева (как в игре) плюс мягкий свет неба, поэтому в картинке уже
есть объём, тени и блики. 1 пиксель текстуры = 1 пиксель игрового мира = 1 см сцены.

Бесшовность: рельеф и цвета грунта — периодический шум (FFT), все объекты,
заходящие за край плитки, дублируются со сдвигом на размер плитки.
Результат: assets/tex/<имя>.png
"""
import bpy, bmesh, math, os, random, sys
import numpy as np
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'assets', 'tex'))
PX = 512            # размер плитки в пикселях
S = PX / 100.0      # размер плитки в метрах (1 px = 1 см)


# ---------------------------------------------------------------- сцена
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    for d in prefs.devices: d.use = True
                    sc.cycles.device = 'GPU'
                    break
            except Exception:
                pass
    except Exception:
        pass
    sc.cycles.samples = 128
    sc.cycles.use_denoising = True
    sc.render.resolution_x = PX
    sc.render.resolution_y = PX
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    # камера: сверху, ортографическая, ровно одна плитка
    cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = S
    cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam)
    cam.location = (0, 0, 10); cam.rotation_euler = (0, 0, 0); sc.camera = cam
    cam_data.clip_end = 50
    # небо: мягкий рассеянный свет
    w = bpy.data.worlds.new('world'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.62, 0.7, 0.85, 1); bg.inputs[1].default_value = 0.55
    # солнце сверху слева (в кадре верх = +Y), чуть со стороны зрителя
    sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 4.2; sd.angle = math.radians(6); sd.color = (1.0, 0.95, 0.86)
    sun = bpy.data.objects.new('sun', sd); sc.collection.objects.link(sun)
    d = Vector((0.52, -0.78, -0.62)).normalized()
    sun.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return sc


def render(sc, name):
    os.makedirs(OUT, exist_ok=True)
    sc.render.filepath = os.path.join(OUT, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('WROTE', sc.render.filepath)


# ---------------------------------------------------------------- шум
def fft_noise(n, beta, seed):
    """периодический (бесшовный) шум n×n со спектром 1/f^beta, нормирован в [0,1]"""
    rng = np.random.default_rng(seed)
    fx = np.fft.fftfreq(n)[:, None]; fy = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / f ** beta
    spec[0, 0] = 0
    a = np.real(np.fft.ifft2(spec))
    a -= a.min(); a /= max(1e-9, a.max())
    return a


# ---------------------------------------------------------------- материалы
def sock(coll, ident):
    for s in coll:
        if s.identifier == ident: return s
    return coll[0]


def principled(name, rough=0.8, spec=0.3):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    for key in ('Specular IOR Level', 'Specular'):
        if key in b.inputs: b.inputs[key].default_value = spec; break
    return m, nt, b


def mat_vertex_color(name, rough=0.9, spec=0.25):
    m, nt, b = principled(name, rough, spec)
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'
    nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    return m


def mat_stone(name, dark, light, rough=0.55, moss=0.0, spec=0.45, scale=6.0):
    """камень: цвет между dark и light по шуму в координатах объекта и по свойству объекта tone;
    moss > 0 — мох на верхних (к +Y) гранях"""
    m, nt, b = principled(name, rough, spec)
    N = nt.nodes; L = nt.links
    tc = N.new('ShaderNodeTexCoord')
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8
    L.new(tc.outputs['Object'], nz.inputs['Vector'])
    tone = N.new('ShaderNodeAttribute'); tone.attribute_type = 'OBJECT'; tone.attribute_name = 'tone'
    mix = N.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'
    L.new(nz.outputs['Fac'], mix.inputs[0]); mix.inputs[1].default_value = 0.6
    L.new(tone.outputs['Fac'], mix.inputs[2])
    ramp = N.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.2; ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = 0.95; ramp.color_ramp.elements[1].color = (*light, 1)
    L.new(mix.outputs[0], ramp.inputs['Fac'])
    col = ramp.outputs['Color']
    # мелкая шероховатость для бампа
    nb = N.new('ShaderNodeTexNoise'); nb.inputs['Scale'].default_value = scale * 12; nb.inputs['Detail'].default_value = 10
    L.new(tc.outputs['Object'], nb.inputs['Vector'])
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35
    L.new(nb.outputs['Fac'], bump.inputs['Height']); L.new(bump.outputs['Normal'], b.inputs['Normal'])
    if moss > 0:
        geo = N.new('ShaderNodeNewGeometry')
        sep = N.new('ShaderNodeSeparateXYZ'); L.new(geo.outputs['Normal'], sep.inputs[0])
        nm = N.new('ShaderNodeTexNoise'); nm.inputs['Scale'].default_value = scale * 1.6; nm.inputs['Detail'].default_value = 6
        L.new(tc.outputs['Object'], nm.inputs['Vector'])
        add = N.new('ShaderNodeMath'); add.operation = 'ADD'
        L.new(sep.outputs['Y'], add.inputs[0]); L.new(nm.outputs['Fac'], add.inputs[1])
        th = N.new('ShaderNodeMapRange'); th.inputs['From Min'].default_value = 1.15 - moss * 0.5; th.inputs['From Max'].default_value = 1.35 - moss * 0.5
        L.new(add.outputs[0], th.inputs['Value'])
        mm = N.new('ShaderNodeMix'); mm.data_type = 'RGBA'
        L.new(th.outputs['Result'], sock(mm.inputs, 'Factor_Float')); L.new(col, sock(mm.inputs, 'A_Color'))
        sock(mm.inputs, 'B_Color').default_value = (0.16, 0.27, 0.05, 1)
        col = sock(mm.outputs, 'Result_Color')
    L.new(col, b.inputs['Base Color'])
    return m


# ---------------------------------------------------------------- геометрия
def height_plane(name, H, amp, colors, z0=0.0, margin=0.3):
    """плоскость S×S (+поля) с бесшовным рельефом H (n×n, 0..1) и цветами вершин"""
    n = H.shape[0]
    step = S / n; k = int(math.ceil(margin / step))
    m = n + 2 * k
    idx = (np.arange(m) - k) % n
    xs = (np.arange(m) - k) * step - S / 2
    Hm = H[np.ix_(idx, idx)]; Cm = colors[np.ix_(idx, idx)]
    X, Y = np.meshgrid(xs, xs, indexing='xy')
    verts = np.stack([X.ravel(), Y.ravel(), (z0 + Hm.T.ravel() * amp)], 1)
    faces = []
    for j in range(m - 1):
        r0 = j * m; r1 = (j + 1) * m
        faces.extend((r0 + i, r0 + i + 1, r1 + i + 1, r1 + i) for i in range(m - 1))
    me = bpy.data.meshes.new(name); me.from_pydata(verts.tolist(), [], faces); me.update()
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    cc = Cm.transpose(1, 0, 2).reshape(-1, 3)
    flat = np.concatenate([cc, np.ones((cc.shape[0], 1))], 1).astype(np.float32).ravel()
    ca.data.foreach_set('color', flat)
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def rock_mesh(name, r, sx, sy, sz, seed, rough=0.28, sub=4):
    """камень: икосфера, сплюснутая и продавленная шумом"""
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in bm.verts:
        p = v.co.normalized()
        d = 1 + rough * noise.noise(p * 1.6 + off) + rough * 0.35 * noise.noise(p * 4.0 + off)
        v.co = Vector((p.x * r * sx * d, p.y * r * sy * d, p.z * r * sz * d))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    return me


def place(me, mat, x, y, z, rot, tone, name='o'):
    """объект и его копии со сдвигом на размер плитки, если он заходит за край"""
    ext = max(abs(v.co.x) for v in me.vertices) + max(abs(v.co.y) for v in me.vertices)
    for dx in (-S, 0, S):
        for dy in (-S, 0, S):
            px, py = x + dx, y + dy
            if abs(px) - ext > S / 2 or abs(py) - ext > S / 2: continue
            ob = bpy.data.objects.new(name, me); ob.location = (px, py, z); ob.rotation_euler = rot
            ob['tone'] = tone
            if not me.materials: me.materials.append(mat)
            bpy.context.scene.collection.objects.link(ob)


# ---------------------------------------------------------------- текстуры
def dirt_stones(name, seed, dirt_a, dirt_b, stone_dark, stone_light, density=1.0):
    """разрез грунта: рыхлая земля с комьями и крошкой, в ней утоплены округлые камни разного размера"""
    sc = reset(); rng = random.Random(seed)
    n = 384
    H = fft_noise(n, 1.4, seed) * 0.7 + fft_noise(n, 0.9, seed + 1) * 0.3
    tone = fft_noise(n, 1.6, seed + 2)
    grit = fft_noise(n, 0.4, seed + 3)
    A = np.array(dirt_a); B = np.array(dirt_b)
    t = np.clip(tone * 0.8 + grit * 0.35 - 0.1, 0, 1)[..., None]
    cols = A * (1 - t) + B * t
    cols *= (0.85 + 0.3 * grit)[..., None]
    height_plane('dirt', H, 0.035, cols ** 2.2)                        # линейные цвета для рендера
    mdirt = mat_vertex_color('dirt', rough=0.95, spec=0.2)
    bpy.data.objects['dirt'].data.materials.append(mdirt)
    mst = mat_stone('stone', stone_dark, stone_light, rough=0.42, spec=0.5, scale=5)
    # камни: много мелких, меньше средних, немного крупных
    count = int(95 * density)
    for i in range(count):
        q = rng.random()
        r = 0.03 + 0.05 * q * q + (0.12 * rng.random() if rng.random() < 0.1 else 0)
        me = rock_mesh('rock%d' % i, r, rng.uniform(0.85, 1.35), rng.uniform(0.7, 1.05), rng.uniform(0.55, 0.9), rng.random() * 100)
        place(me, mst, rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), 0.02 - r * 0.25,
              (0, 0, rng.uniform(0, 6.28)), rng.uniform(-0.25, 0.25), 'rock')
    # крошка: мелкие камешки
    for i in range(int(260 * density)):
        r = rng.uniform(0.006, 0.016)
        me = rock_mesh('pebble%d' % i, r, 1.2, 1, 0.7, rng.random() * 100, sub=2)
        place(me, mst, rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), 0.02, (0, 0, rng.uniform(0, 6.28)), rng.uniform(-0.3, 0.1), 'peb')
    render(sc, name)


def masonry(name, seed, bw, bh, dark, light, mortar, moss=0.0, jitter=0.1, round_=0.35):
    """кладка: скруглённые неровные блоки со сколами, утопленный раствор. bw/bh — размер блока в px"""
    sc = reset(); rng = random.Random(seed)
    n = 256
    Hm = fft_noise(n, 1.1, seed)
    gm = fft_noise(n, 0.5, seed + 5)
    cols = np.array(mortar)[None, None, :] * (0.7 + 0.5 * gm)[..., None]
    height_plane('mortar', Hm, 0.01, cols ** 2.2, z0=-0.03)
    bpy.data.objects['mortar'].data.materials.append(mat_vertex_color('mortar', rough=1.0, spec=0.1))
    mst = mat_stone('block', dark, light, rough=0.6, moss=moss, spec=0.35, scale=4)
    w, h = bw / 100.0, bh / 100.0
    rows = int(round(S / h)); cols_n = int(round(S / w))
    gap = 0.012
    for j in range(rows):
        off = (w * 0.5) if j % 2 else 0
        for i in range(cols_n):
            x = -S / 2 + off + i * w + w / 2; y = -S / 2 + j * h + h / 2
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1)
            bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
            me = bpy.data.meshes.new('blk'); bm.to_mesh(me); bm.free()
            ob = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(ob)
            sub = ob.modifiers.new('s', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
            bpy.context.view_layer.objects.active = ob; ob.select_set(True)
            bpy.ops.object.modifier_apply(modifier='s')
            sx = (w - gap) / 2; sy = (h - gap) / 2; sz = 0.04
            ofs = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))
            for v in me.vertices:
                p = v.co.copy()
                # подушка: края скругляются, поверхность неровная, сколы на углах
                q = Vector((p.x * sx * 2, p.y * sy * 2, p.z * sz * 2))
                d = noise.noise(q * 18 + ofs) * jitter * 0.02 + noise.noise(q * 60 + ofs) * 0.002
                q.z += d + (0.006 if p.z > 0 else 0)
                q.x += noise.noise(q * 9 + ofs) * jitter * 0.01
                q.y += noise.noise(q * 9 + ofs + Vector((5, 5, 5))) * jitter * 0.01
                v.co = q
            for p in me.polygons: p.use_smooth = True
            me.materials.append(mst)
            bpy.data.objects.remove(ob)
            place(me, mst, x, y, 0.0, (0, 0, rng.uniform(-0.01, 0.01)), rng.uniform(-0.35, 0.3), 'blk')
    render(sc, name)


def slab_wall(name, seed, dark, light, mortar):
    """стена пещеры: плотно уложенные плоские плиты разного размера"""
    sc = reset(); rng = random.Random(seed)
    n = 256
    cols = np.array(mortar)[None, None, :] * (0.6 + 0.6 * fft_noise(n, 0.6, seed))[..., None]
    height_plane('back', fft_noise(n, 1.2, seed + 1), 0.02, cols ** 2.2, z0=-0.05)
    bpy.data.objects['back'].data.materials.append(mat_vertex_color('back', rough=1.0, spec=0.1))
    mst = mat_stone('slab', dark, light, rough=0.7, spec=0.3, scale=3)
    k = 6
    for j in range(k):
        for i in range(k):
            x = -S / 2 + (i + 0.5 + rng.uniform(-0.25, 0.25)) * S / k
            y = -S / 2 + (j + 0.5 + rng.uniform(-0.25, 0.25)) * S / k
            r = S / k * rng.uniform(0.5, 0.62)
            me = rock_mesh('slab', r, rng.uniform(1.0, 1.3), rng.uniform(0.8, 1.05), 0.12, rng.random() * 100, rough=0.12)
            place(me, mst, x, y, 0, (0, 0, rng.uniform(0, 6.28)), rng.uniform(-0.3, 0.3), 'slab')
    render(sc, name)


# ---------------------------------------------------------------- набор
LIB = {
    # долина и замки: тёплая бурая земля, серые обкатанные камни
    'dirt_valley': lambda: dirt_stones('dirt_valley', 11, (0.42, 0.27, 0.16), (0.30, 0.19, 0.11), (0.20, 0.19, 0.18), (0.58, 0.56, 0.52)),
    # тёмная башня (P_KEEP 32×16) и светлая кладка стен и моста (P_STONE 32×16)
    'brick_keep': lambda: masonry('brick_keep', 21, 32, 16, (0.13, 0.135, 0.15), (0.36, 0.37, 0.39), (0.08, 0.08, 0.085), moss=0.35),
    'brick_light': lambda: masonry('brick_light', 22, 32, 16, (0.36, 0.34, 0.31), (0.70, 0.67, 0.62), (0.16, 0.155, 0.15), moss=0.45),
    # задняя стена пещер
    'cave_wall': lambda: slab_wall('cave_wall', 31, (0.10, 0.10, 0.105), (0.27, 0.27, 0.28), (0.03, 0.03, 0.03)),
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(LIB)):
        LIB[key]()
