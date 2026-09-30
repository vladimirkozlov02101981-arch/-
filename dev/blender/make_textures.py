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
LIGHT = {'col': (1.0, 0.85, 0.66), 'elev': 25, 'energy': 5.0}     # единый свет для всех плиток; для заката меняется


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
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    # камера: сверху, ортографическая, ровно одна плитка
    cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = S
    cam = bpy.data.objects.new('cam', cam_data); sc.collection.objects.link(cam)
    cam.location = (0, 0, 10); cam.rotation_euler = (0, 0, 0); sc.camera = cam
    cam_data.clip_end = 50
    # небо: мягкий рассеянный свет
    w = bpy.data.worlds.new('world'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.55, 0.72, 1.0, 1); bg.inputs[1].default_value = 0.3
    # солнце сверху слева (в кадре верх = +Y), чуть со стороны зрителя
    sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = LIGHT['energy']; sd.angle = math.radians(1.5); sd.color = LIGHT['col']
    sun = bpy.data.objects.new('sun', sd); sc.collection.objects.link(sun)
    e = math.radians(LIGHT['elev']); hz = Vector((0.55, -0.8, 0)).normalized()
    d = Vector((hz.x * math.cos(e), hz.y * math.cos(e), -math.sin(e)))   # низкое солнце сверху слева — длинные тени
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


def lin(c):
    """цвет sRGB 0..1 → линейный (цвета в узлах Blender линейные)"""
    return tuple(v ** 2.2 for v in c)


def mat_stone(name, dark, light, rough=0.55, moss=0.0, spec=0.45, scale=6.0, bumpk=0.6, moss_col=(0.30, 0.40, 0.14)):
    """камень: цвет между dark и light (sRGB) по шуму в координатах объекта и по свойству объекта tone;
    moss > 0 — мох на верхних (к +Y) гранях"""
    dark, light = lin(dark), lin(light)
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
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = bumpk
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
        sock(mm.inputs, 'B_Color').default_value = (*lin(moss_col), 1)
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
    """разрез грунта: рыхлая комковатая земля с крошкой, в ней густо утоплены округлые камни разного размера"""
    sc = reset(); rng = random.Random(seed)
    n = 512
    clod = fft_noise(n, 0.8, seed + 7)
    H = fft_noise(n, 1.5, seed) * 0.5 + fft_noise(n, 1.0, seed + 1) * 0.3 + clod * 0.2
    tone = fft_noise(n, 1.6, seed + 2)
    grit = fft_noise(n, 0.3, seed + 3)
    A = np.array(dirt_a); B = np.array(dirt_b)
    t = np.clip(tone * 0.9 + grit * 0.3 - 0.15, 0, 1)[..., None]
    cols = A * (1 - t) + B * t
    cols *= (0.8 + 0.4 * grit + 0.25 * (clod - 0.5))[..., None]
    height_plane('dirt', H, 0.09, np.clip(cols, 0, 1) ** 2.2)
    mdirt = mat_vertex_color('dirt', rough=0.97, spec=0.15)
    bpy.data.objects['dirt'].data.materials.append(mdirt)
    mst = mat_stone('stone', stone_dark, stone_light, rough=0.75, spec=0.3, scale=5, bumpk=0.9, moss=0.25, moss_col=(0.62, 0.62, 0.46))
    # камни: много мелких и средних, немного крупных валунов; наполовину в земле
    count = int(190 * density)
    for i in range(count):
        q = rng.random()
        r = 0.025 + 0.035 * q if q < 0.5 else (0.06 + 0.07 * rng.random() if q < 0.9 else 0.13 + 0.12 * rng.random())
        sz = rng.uniform(0.6, 0.95)
        me = rock_mesh('rock%d' % i, r, rng.uniform(0.9, 1.4), rng.uniform(0.75, 1.05), sz, rng.random() * 100, rough=0.22)
        place(me, mst, rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), 0.045 - r * sz * rng.uniform(0.1, 0.5),
              (0, 0, rng.uniform(0, 6.28)), rng.uniform(-0.3, 0.3), 'rock')
    # крошка: сотни мелких камешков 0.5–3 см — одним мешем (плотность ~400 на м²)
    bm = bmesh.new()
    import mathutils
    for i in range(int(S * S * 400 * density)):
        r = rng.uniform(0.004, 0.016) * (1.8 if rng.random() < 0.15 else 1)
        m = mathutils.Matrix.Translation((rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), 0.03 + rng.uniform(0, 0.03))) @ \
            mathutils.Matrix.Diagonal((r * rng.uniform(1.0, 1.5), r * rng.uniform(0.8, 1.1), r * 0.7, 1))
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1, matrix=m)
    pm = bpy.data.meshes.new('pebbles'); bm.to_mesh(pm); bm.free()
    for p in pm.polygons: p.use_smooth = True
    pm.materials.append(mat_stone('peb', stone_dark, stone_light, rough=0.75, spec=0.3, scale=40, bumpk=0.4))
    po = bpy.data.objects.new('pebbles', pm); po['tone'] = 0.0; sc.collection.objects.link(po)
    render(sc, name)


def block_mesh(sx, sy, sz, rng, jitter):
    """неровный тёсаный блок: скруглённый параллелепипед, бугристая лицевая сторона, сколы на углах"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
    me = bpy.data.meshes.new('blk'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(ob)
    sub = ob.modifiers.new('s', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier='s')
    ofs = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))
    chips = [(rng.choice((-1, 1)) * sx, rng.choice((-1, 1)) * sy, rng.uniform(0.25, 0.5) * min(sx, sy)) for _ in range(rng.randint(0, 2))]
    for v in me.vertices:
        p = v.co
        q = Vector((p.x * sx * 2, p.y * sy * 2, p.z * sz * 2))
        top = max(0.0, p.z * 2)                                # 1 на лицевой стороне
        q.z += (noise.noise(q * 14 + ofs) * 0.012 + noise.noise(q * 45 + ofs) * 0.004) * jitter * top
        q.x += noise.noise(q * 8 + ofs) * 0.012 * jitter
        q.y += noise.noise(q * 8 + ofs + Vector((5, 5, 5))) * 0.008 * jitter
        for cx, cy, cr in chips:                               # скол угла
            dd = math.hypot(q.x - cx, q.y - cy)
            if dd < cr and top > 0: q.z -= (1 - dd / cr) * 0.03
        v.co = q
    for p in me.polygons: p.use_smooth = True
    bpy.data.objects.remove(ob)
    return me


def mat_wood(name, dark, light):
    """дерево: вытянутые вдоль доски волокна, сучки, тон доски из свойства tone"""
    dark, light = lin(dark), lin(light)
    m, nt, b = principled(name, 0.7, 0.25)
    N = nt.nodes; L = nt.links
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.6, 22, 1)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3; nz.inputs['Detail'].default_value = 12
    L.new(mp.outputs['Vector'], nz.inputs['Vector'])
    tone = N.new('ShaderNodeAttribute'); tone.attribute_type = 'OBJECT'; tone.attribute_name = 'tone'
    mix = N.new('ShaderNodeMath'); mix.operation = 'MULTIPLY_ADD'
    L.new(nz.outputs['Fac'], mix.inputs[0]); mix.inputs[1].default_value = 0.9; L.new(tone.outputs['Fac'], mix.inputs[2])
    ramp = N.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.25; ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].position = 0.85; ramp.color_ramp.elements[1].color = (*light, 1)
    L.new(mix.outputs[0], ramp.inputs['Fac']); L.new(ramp.outputs['Color'], b.inputs['Base Color'])
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5
    L.new(nz.outputs['Fac'], bump.inputs['Height']); L.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def mat_glow(name, col, strength):
    """светящийся материал (лава в швах, сияние кристаллов)"""
    m, nt, b = principled(name, 0.9, 0.1)
    b.inputs['Base Color'].default_value = (*lin(col), 1)
    for key in ('Emission Color', 'Emission'):
        if key in b.inputs: b.inputs[key].default_value = (*lin(col), 1); break
    if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = strength
    return m


def masonry(name, seed, bw, bh, dark, light, mortar, moss=0.0, jitter=1.0, hrange=None, wrange=(0.7, 1.55),
            mat='stone', moss_col=(0.30, 0.40, 0.14), glow=None, band=0.0, nails=False, depth=0.04, gap_px=1.4):
    """кладка / пласты / доски: ряды блоков разной длины (hrange — разброс высоты ряда в px),
    неровные, со сколами; раствор между ними тёмный или светящийся (glow=(цвет, сила))"""
    sc = reset(); rng = random.Random(seed)
    n = 256
    cols = np.array(mortar)[None, None, :] * (0.6 + 0.7 * fft_noise(n, 0.5, seed + 5))[..., None]
    height_plane('mortar', fft_noise(n, 1.1, seed), 0.01, np.clip(cols, 0, 1) ** 2.2, z0=-0.035)
    bpy.data.objects['mortar'].data.materials.append(mat_glow('glow', *glow) if glow else mat_vertex_color('mortar', rough=1.0, spec=0.1))
    mst = mat_wood('wood', dark, light) if mat == 'wood' else mat_stone('block', dark, light, rough=0.72, moss=moss, spec=0.3, scale=3.5, bumpk=0.9, moss_col=moss_col)
    mnail = mat_stone('nail', (0.12, 0.11, 0.10), (0.35, 0.33, 0.30), rough=0.3, spec=0.8) if nails else None
    w = bw / 100.0
    hs = []; tot = 0
    if hrange:
        while tot < S - hrange[0] / 100.0:
            hh = rng.uniform(*hrange) / 100.0; hs.append(hh); tot += hh
        hs[-1] += S - tot
    else:
        rows = int(round(S / (bh / 100.0))); hs = [S / rows] * rows
    gap = gap_px / 100.0
    y0 = -S / 2
    for j, h in enumerate(hs):
        y = y0 + h / 2; y0 += h
        btone = rng.uniform(-band, band)
        widths = []; tot = 0
        while tot < S - 0.6 * w:
            ww = w * rng.uniform(*wrange); widths.append(ww); tot += ww
        widths[-1] += S - tot                                   # ряд ровно на плитку — бесшовно
        x = -S / 2 + rng.uniform(0, w)
        for ww in widths:
            me = block_mesh((ww - gap) / 2, (h - gap) / 2, depth, rng, jitter)
            me.materials.append(mst)
            place(me, mst, x + ww / 2, y, 0.0, (0, 0, rng.uniform(-0.008, 0.008)), btone + rng.uniform(-0.4, 0.35) * (0.5 if band else 1), 'blk')
            if nails:
                for ex in (-1, 1):
                    nm = rock_mesh('nail', 0.012, 1, 1, 0.5, rng.random() * 9, rough=0.05, sub=2)
                    place(nm, mnail, x + ww / 2 + ex * (ww / 2 - 0.05), y, depth + 0.004, (0, 0, 0), 0.0, 'nail')
            x += ww
    render(sc, name)


def slab_wall(name, seed, dark, light, mortar, glow=None):
    """стена пещеры: плотно уложенные неровные плиты разного размера"""
    sc = reset(); rng = random.Random(seed)
    n = 256
    cols = np.array(mortar)[None, None, :] * (0.6 + 0.6 * fft_noise(n, 0.6, seed))[..., None]
    height_plane('back', fft_noise(n, 1.2, seed + 1), 0.02, np.clip(cols, 0, 1) ** 2.2, z0=-0.05)
    bpy.data.objects['back'].data.materials.append(mat_glow('glow', *glow) if glow else mat_vertex_color('back', rough=1.0, spec=0.1))
    mst = mat_stone('slab', dark, light, rough=0.75, spec=0.3, scale=3, bumpk=1.0)
    k = 9
    for j in range(k):
        for i in range(k):
            x = -S / 2 + (i + 0.5 + rng.uniform(-0.25, 0.25)) * S / k
            y = -S / 2 + (j + 0.5 + rng.uniform(-0.25, 0.25)) * S / k
            r = S / k * rng.uniform(0.5, 0.64)
            me = rock_mesh('slab', r, rng.uniform(1.0, 1.35), rng.uniform(0.75, 1.0), 0.14, rng.random() * 100, rough=0.16)
            place(me, mst, x, y, 0, (0, 0, rng.uniform(0, 6.28)), rng.uniform(-0.35, 0.35), 'slab')
    render(sc, name)


def grass_strip(name, seed, cols, flowers, height=0.26, H_PX=80, glow=None):
    """трава сбоку: густые пучки изогнутых травинок разной высоты и оттенка, полевые цветы.
    Прозрачный фон; по горизонтали бесшовно. Высота кадра H_PX px, низ кадра = корни"""
    sc = reset(); rng = random.Random(seed)
    sc.render.resolution_y = H_PX; sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    cam = sc.camera; hgt = H_PX / 100.0
    cam.location = (0, -6, hgt / 2 - 0.05); cam.rotation_euler = (math.radians(90), 0, 0)
    mats = []
    for c in cols:
        m, nt, b = principled('blade', 0.55, 0.35)
        b.inputs['Base Color'].default_value = (*lin(c), 1)
        for key in ('Subsurface Weight', 'Subsurface'):
            if key in b.inputs: b.inputs[key].default_value = 0.3; break
        for key in ('Transmission Weight', 'Transmission'):
            if key in b.inputs: b.inputs[key].default_value = 0.25; break
        mats.append(m)
    if glow: mats[-1] = mat_glow('bladeglow', *glow)
    # травинки: узкие изогнутые ленты, сужающиеся к кончику
    def blade(x, y, h, lean, w, mi):
        segs = 6; verts = []; faces = []
        for k in range(segs + 1):
            t = k / segs; bend = lean * t * t
            ww = w * (1 - t) ** 0.8
            verts += [(x + bend - ww / 2, y, h * t), (x + bend + ww / 2, y, h * t)]
        for k in range(segs):
            faces.append((2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2))
        me = bpy.data.meshes.new('b'); me.from_pydata(verts, [], faces); me.materials.append(mats[mi])
        for p in me.polygons: p.use_smooth = True
        return me
    count = 4200
    for i in range(count):
        x = rng.uniform(-S / 2, S / 2); y = rng.uniform(-0.25, 0.25)
        clump = 0.5 + 0.5 * math.sin(x * 3.1 + seed) * math.sin(x * 7.3 + 1)
        h = height * rng.uniform(0.35, 1.0) * (0.7 + 0.6 * clump)
        mi = min(len(mats) - 1, int(rng.random() * len(mats) * (0.6 + 0.4 * (y + 0.25) / 0.5)))
        me = blade(0, 0, h, rng.uniform(-0.12, 0.12) * h / height, rng.uniform(0.006, 0.012), mi)
        for dx in (-S, 0, S):
            if abs(x + dx) - 0.2 > S / 2: continue
            ob = bpy.data.objects.new('blade', me); ob.location = (x + dx, y, -0.03); ob.rotation_euler = (0, 0, rng.uniform(-0.6, 0.6))
            sc.collection.objects.link(ob)
    # цветы: стебель + головка
    for i in range(70):
        x = rng.uniform(-S / 2, S / 2); y = rng.uniform(-0.3, -0.05); h = height * rng.uniform(0.5, 1.05)
        col = rng.choice(flowers)
        m, nt, b = principled('fl', 0.5, 0.3); b.inputs['Base Color'].default_value = (*lin(col), 1)
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=rng.uniform(0.012, 0.022))
        me = bpy.data.meshes.new('fh'); bm.to_mesh(me); bm.free(); me.materials.append(m)
        st = blade(0, 0, h, rng.uniform(-0.03, 0.03), 0.004, 0)
        for dx in (-S, 0, S):
            if abs(x + dx) - 0.1 > S / 2: continue
            o1 = bpy.data.objects.new('stem', st); o1.location = (x + dx, y, -0.03); sc.collection.objects.link(o1)
            o2 = bpy.data.objects.new('head', me); o2.location = (x + dx, y, h - 0.03); o2.scale = (1, 1, 0.7); sc.collection.objects.link(o2)
    render(sc, name)


# ---------------------------------------------------------------- деревья (спрайты с прозрачным фоном)
def _cone(bm, p0, p1, r0, r1, seg=10):
    """сужающийся цилиндр ветки от p0 до p1"""
    d = (p1 - p0); L = d.length
    q = d.normalized().to_track_quat('Z', 'Y')
    ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=L)
    for v in ret['verts']:
        v.co = q @ v.co + p0 + d / 2


def _leaf_cluster(bm, col_layer, c, R, n, rng, shades, flat=0.75, size=0.06, needle=False):
    """облако листьев: n маленьких листьев-четырёхугольников внутри эллипсоида радиуса R"""
    for _ in range(n):
        while True:
            v = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
            if v.length <= 1: break
        pos = c + Vector((v.x * R, v.y * R, v.z * R * flat))
        ax = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))).normalized()
        up = ax.cross(Vector((0.3, 0.2, 1))).normalized()
        w = size * (0.25 if needle else 0.55) * rng.uniform(0.7, 1.2); h = size * rng.uniform(0.8, 1.3)
        vs = [bm.verts.new(pos + ax * (sx * w) + up * (sy * h)) for sx, sy in ((-1, -1), (1, -1), (0.3, 1), (-0.3, 1))] if not needle else \
             [bm.verts.new(pos + ax * (sx * w) + up * (sy * h)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        f = bm.faces.new(vs)
        col = rng.choice(shades); k = rng.uniform(0.8, 1.15)
        for loop in f.loops: loop[col_layer] = (col[0] * k, col[1] * k, col[2] * k, 1)


def _branches(bm, p, d, L, r, depth, rng, tips, spread=0.7, taper=0.62):
    """рекурсивные ветви; концы веток собираются в tips (куда сажать листву)"""
    end = p + d * L
    _cone(bm, p, end, r, r * taper)
    if depth == 0:
        tips.append(end); return
    for _ in range(rng.randint(2, 3)):
        nd = (d + Vector((rng.uniform(-spread, spread), rng.uniform(-spread, spread), rng.uniform(-0.1, 0.5)))).normalized()
        _branches(bm, end, nd, L * rng.uniform(0.6, 0.78), r * taper, depth - 1, rng, tips, spread, taper)
    if depth >= 2 and rng.random() < 0.6: tips.append(end)


def tree_sprite(name, seed, kind, px=320):
    sc = reset(); rng = random.Random(seed)
    sc.render.resolution_x = px; sc.render.resolution_y = px; sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    bpy.data.lights['sun'].energy = 4.5
    H = 4.0                                                    # высота кадра в метрах (дерево ~3.5 м)
    cam = sc.camera; cam.data.ortho_scale = H
    cam.location = (0, -10, H / 2 - 0.05); cam.rotation_euler = (math.radians(90), 0, 0)
    bm = bmesh.new(); tips = []
    bark_dark, bark_light = ((0.32, 0.25, 0.18), (0.55, 0.45, 0.34)) if kind != 'birch' else ((0.55, 0.53, 0.50), (0.93, 0.92, 0.88))
    def dome(cx, cz, rx, rz, n, trunk_top, rb):
        """крона-купол: n облаков листвы на поверхности и внутри эллипсоида, к каждому — ветка от ствола"""
        for i in range(n):
            u = rng.uniform(-1, 1); a = rng.uniform(0, math.tau)
            ry = rng.uniform(0.35, 0.95)
            p = Vector((cx + math.cos(a) * rx * math.sqrt(1 - u * u) * ry, math.sin(a) * rx * 0.45 * ry, cz + u * rz * (0.7 if u < 0 else 1.0)))
            tips.append(p)
            if i % 2 == 0:
                _cone(bm, trunk_top + Vector((rng.uniform(-0.05, 0.05), 0, rng.uniform(-0.25, 0.05))), p, rb, rb * 0.3, 7)
    if kind == 'oak':
        top = Vector((0, 0, 1.25))
        _cone(bm, Vector((0, 0, -0.1)), top, 0.22, 0.15, 14)
        for sgn in (-1, 1):                                      # развилка: две толстые ветви
            _cone(bm, top - Vector((0, 0, 0.15)), top + Vector((sgn * 0.55, rng.uniform(-0.1, 0.1), 0.6)), 0.12, 0.07, 10)
        dome(0, 2.15, 1.35, 0.95, 46, top, 0.06)
        shades = [lin(c) for c in ((0.30, 0.44, 0.12), (0.40, 0.56, 0.16), (0.52, 0.66, 0.20), (0.64, 0.74, 0.26), (0.34, 0.48, 0.13), (0.72, 0.78, 0.34))]
        leaf = dict(R=0.36, n=460, size=0.055, flat=0.85)
    elif kind == 'birch':
        _cone(bm, Vector((0, 0, -0.1)), Vector((0, 0, 3.2)), 0.1, 0.035, 12)
        for i in range(26):
            h = rng.uniform(1.4, 3.3); side = rng.choice((-1, 1)); rw = 0.55 * (1 - (h - 1.4) / 2.4) + 0.2
            p = Vector((side * rng.uniform(0.1, rw), rng.uniform(-0.2, 0.2), h))
            tips.append(p); _cone(bm, Vector((0, 0, h - 0.15)), p, 0.025, 0.01, 6)
        shades = [lin(c) for c in ((0.42, 0.58, 0.18), (0.55, 0.70, 0.24), (0.68, 0.78, 0.32), (0.48, 0.62, 0.20))]
        leaf = dict(R=0.24, n=260, size=0.045, flat=0.9)
    elif kind == 'bush':
        H = 1.6; cam.data.ortho_scale = H; cam.location = (0, -10, H / 2 - 0.05)
        top = Vector((0, 0, 0.05))
        dome(0, 0.45, 0.7, 0.42, 26, top, 0.03)
        shades = [lin(c) for c in ((0.24, 0.38, 0.10), (0.34, 0.50, 0.14), (0.46, 0.62, 0.18), (0.58, 0.70, 0.24), (0.30, 0.44, 0.12))]
        leaf = dict(R=0.22, n=260, size=0.04, flat=0.85)
    else:  # pine
        _cone(bm, Vector((0, 0, -0.1)), Vector((0, 0, 3.6)), 0.12, 0.02, 12)
        shades = [lin(c) for c in ((0.12, 0.26, 0.14), (0.18, 0.34, 0.18), (0.26, 0.44, 0.22), (0.14, 0.30, 0.15))]
        leaf = dict(R=0.17, n=150, size=0.05, flat=0.45, needle=True)
        for i in range(20):
            h = 0.55 + i * 0.15; wdt = 1.15 * (1 - i / 21) ** 1.1 + 0.12
            for a in range(7):
                ang = a / 7 * math.tau + rng.uniform(-0.3, 0.3) + i
                d = Vector((math.cos(ang) * wdt, math.sin(ang) * wdt * 0.6, -0.18 * wdt))
                _cone(bm, Vector((0, 0, h)), Vector((0, 0, h)) + d, 0.02, 0.006, 6)
                for t in (0.3, 0.55, 0.8, 1.0):
                    tips.append(Vector((0, 0, h)) + d * t + Vector((0, 0, 0.02 - 0.05 * t)))
    trunk = bpy.data.meshes.new('trunk'); bm.to_mesh(trunk); bm.free()
    mb = mat_stone('bark', bark_dark, bark_light, rough=0.85, spec=0.2, scale=9 if kind != 'birch' else 3, bumpk=1.0)
    trunk.materials.append(mb)
    for p in trunk.polygons: p.use_smooth = True
    ob = bpy.data.objects.new('trunk', trunk); ob['tone'] = 0.0; sc.collection.objects.link(ob)
    # листва: одним мешем, цвет листа — в атрибуте углов
    bm = bmesh.new(); cl = bm.loops.layers.float_color.new('Col')
    for t in tips:
        _leaf_cluster(bm, cl, t, leaf['R'] * rng.uniform(0.8, 1.25), leaf['n'], rng, shades, leaf['flat'], leaf['size'], leaf.get('needle', False))
    lm = bpy.data.meshes.new('leaves'); bm.to_mesh(lm); bm.free()
    m, nt, b = principled('leaf', 0.55, 0.35)
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'Col'
    nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    for key in ('Subsurface Weight', 'Subsurface'):
        if key in b.inputs: b.inputs[key].default_value = 0.25; break
    for key in ('Transmission Weight', 'Transmission'):
        if key in b.inputs: b.inputs[key].default_value = 0.15; break
    lm.materials.append(m)
    lo = bpy.data.objects.new('leaves', lm); sc.collection.objects.link(lo)
    # тень от кроны на землю не нужна (прозрачный фон) — только свет
    render(sc, name)


# ---------------------------------------------------------------- набор (цвета в sRGB)
LIB = {
    # долина и замки: тёмная бурая земля (как в эталоне), серо-бурые обкатанные камни
    'dirt_valley': lambda: dirt_stones('dirt_valley', 11, (0.42, 0.29, 0.19), (0.29, 0.19, 0.125), (0.40, 0.38, 0.35), (0.62, 0.60, 0.56), density=2.0),
    # тёмная башня и светлая кладка стен и моста
    'brick_keep': lambda: masonry('brick_keep', 21, 32, 18, (0.44, 0.42, 0.39), (0.66, 0.63, 0.58), (0.23, 0.21, 0.18), moss=0.55, moss_col=(0.31, 0.35, 0.16), jitter=1.5, depth=0.05, gap_px=2.2),
    'brick_light': lambda: masonry('brick_light', 22, 32, 16, (0.46, 0.44, 0.41), (0.74, 0.71, 0.66), (0.23, 0.21, 0.18), moss=0.5, moss_col=(0.31, 0.35, 0.16), jitter=1.5, depth=0.05, gap_px=2.0),
    # замки на закате: тот же грунт и кладка при низком оранжевом солнце
    'dirt_castle': lambda: (LIGHT.update(col=(1.0, 0.60, 0.31), elev=12, energy=5.5), dirt_stones('dirt_castle', 12, (0.42, 0.29, 0.19), (0.29, 0.19, 0.125), (0.40, 0.38, 0.35), (0.62, 0.60, 0.56), density=2.0), LIGHT.update(col=(1.0, 0.85, 0.66), elev=25, energy=5.0)),
    'brick_castle': lambda: (LIGHT.update(col=(1.0, 0.60, 0.31), elev=12, energy=5.5), masonry('brick_castle', 23, 30, 16, (0.50, 0.44, 0.38), (0.76, 0.68, 0.58), (0.24, 0.20, 0.16), moss=0.5, moss_col=(0.31, 0.35, 0.16), jitter=1.5, depth=0.05, gap_px=2.0), LIGHT.update(col=(1.0, 0.85, 0.66), elev=25, energy=5.0)),
    # задняя стена пещер
    'cave_wall': lambda: slab_wall('cave_wall', 31, (0.16, 0.16, 0.165), (0.36, 0.36, 0.37), (0.05, 0.05, 0.05)),
    # трава долины: от тёмной у корней до жёлто-зелёной на солнце, полевые цветы
    'grass_valley': lambda: grass_strip('grass_valley', 41, [(0.40, 0.54, 0.14), (0.52, 0.66, 0.18), (0.64, 0.76, 0.24), (0.76, 0.84, 0.32), (0.58, 0.68, 0.20)],
                                        [(0.85, 0.15, 0.12), (0.95, 0.80, 0.18), (0.95, 0.94, 0.88), (0.35, 0.45, 0.95), (0.95, 0.45, 0.65)]),
    # деревья-спрайты: 3 дуба, 2 сосны, берёза
    'tree_oak1': lambda: tree_sprite('tree_oak1', 51, 'oak'), 'tree_oak2': lambda: tree_sprite('tree_oak2', 52, 'oak'), 'tree_oak3': lambda: tree_sprite('tree_oak3', 53, 'oak'),
    'tree_pine1': lambda: tree_sprite('tree_pine1', 61, 'pine'), 'tree_pine2': lambda: tree_sprite('tree_pine2', 62, 'pine'),
    'tree_birch1': lambda: tree_sprite('tree_birch1', 71, 'birch'),
    'bush1': lambda: tree_sprite('bush1', 81, 'bush', px=160), 'bush2': lambda: tree_sprite('bush2', 82, 'bush', px=160),
    # ---- каньон: пласты песчаника, песчаная земля, пещеры
    'rock_canyon': lambda: masonry('rock_canyon', 101, 120, 0, (0.56, 0.31, 0.18), (0.86, 0.58, 0.38), (0.30, 0.16, 0.09), hrange=(16, 46), wrange=(0.5, 1.8), band=0.35, jitter=1.6),
    'dirt_canyon': lambda: dirt_stones('dirt_canyon', 102, (0.78, 0.56, 0.34), (0.62, 0.40, 0.22), (0.45, 0.30, 0.20), (0.80, 0.62, 0.44), density=1.2),
    'cave_canyon': lambda: slab_wall('cave_canyon', 103, (0.30, 0.17, 0.10), (0.52, 0.32, 0.20), (0.10, 0.05, 0.03)),
    # ---- ледяной перевал: сланец с инеем на уступах
    'rock_arctic': lambda: masonry('rock_arctic', 111, 110, 0, (0.26, 0.31, 0.40), (0.52, 0.58, 0.68), (0.10, 0.12, 0.16), hrange=(18, 50), wrange=(0.5, 1.8), band=0.25, jitter=1.6, moss=0.6, moss_col=(0.92, 0.95, 1.0)),
    'cave_arctic': lambda: slab_wall('cave_arctic', 113, (0.16, 0.19, 0.25), (0.34, 0.40, 0.50), (0.05, 0.06, 0.08)),
    # ---- вулкан: базальт, в трещинах светится лава
    'rock_volcano': lambda: masonry('rock_volcano', 121, 90, 0, (0.13, 0.10, 0.09), (0.32, 0.25, 0.22), (1.0, 0.45, 0.10), hrange=(16, 44), wrange=(0.5, 1.6), band=0.2, jitter=1.8, glow=((1.0, 0.42, 0.08), 6.0), gap_px=2.2),
    'cave_volcano': lambda: slab_wall('cave_volcano', 123, (0.12, 0.09, 0.08), (0.26, 0.20, 0.17), (1.0, 0.40, 0.08), glow=((1.0, 0.38, 0.06), 2.5)),
    # ---- кристальная планета: фиолетовая порода, светящиеся голубые жилы
    'rock_alien': lambda: masonry('rock_alien', 131, 100, 0, (0.18, 0.12, 0.30), (0.40, 0.28, 0.56), (0.35, 0.95, 1.0), hrange=(18, 46), wrange=(0.5, 1.7), band=0.3, jitter=1.6, glow=((0.30, 0.90, 1.0), 3.0)),
    'dirt_alien': lambda: dirt_stones('dirt_alien', 132, (0.30, 0.20, 0.42), (0.18, 0.12, 0.28), (0.28, 0.20, 0.45), (0.56, 0.44, 0.78), density=1.5),
    'cave_alien': lambda: slab_wall('cave_alien', 133, (0.12, 0.08, 0.20), (0.28, 0.20, 0.40), (0.30, 0.80, 1.0), glow=((0.30, 0.85, 1.0), 1.5)),
    'grass_alien': lambda: grass_strip('grass_alien', 134, [(0.05, 0.28, 0.30), (0.08, 0.40, 0.40), (0.12, 0.52, 0.50), (0.30, 0.90, 0.85)],
                                       [(1.0, 0.45, 0.95), (0.55, 0.95, 1.0)], glow=((0.35, 1.0, 0.90), 2.0)),
    # ---- пиратская бухта: доски корабля, тропическая земля и трава
    'wood_ship': lambda: masonry('wood_ship', 141, 120, 10, (0.30, 0.17, 0.09), (0.58, 0.38, 0.22), (0.10, 0.05, 0.03), wrange=(0.5, 1.6), mat='wood', nails=True, jitter=0.4, depth=0.03, gap_px=1.6),
    'wood_light': lambda: masonry('wood_light', 142, 100, 9, (0.52, 0.36, 0.22), (0.80, 0.62, 0.42), (0.18, 0.10, 0.06), wrange=(0.5, 1.6), mat='wood', nails=True, jitter=0.4, depth=0.03, gap_px=1.4),
    'dirt_tropical': lambda: dirt_stones('dirt_tropical', 143, (0.56, 0.40, 0.26), (0.40, 0.27, 0.16), (0.40, 0.36, 0.30), (0.74, 0.70, 0.62), density=1.4),
    'grass_tropical': lambda: grass_strip('grass_tropical', 144, [(0.28, 0.52, 0.12), (0.40, 0.66, 0.16), (0.54, 0.78, 0.22), (0.66, 0.86, 0.30)],
                                          [(0.95, 0.30, 0.45), (1.0, 0.82, 0.25), (1.0, 0.55, 0.20), (1.0, 1.0, 1.0)]),
    # ---- ночной город: бетонные панели фасадов
    'concrete_city': lambda: masonry('concrete_city', 151, 120, 58, (0.42, 0.42, 0.44), (0.62, 0.62, 0.64), (0.20, 0.20, 0.22), wrange=(0.8, 1.2), jitter=0.3, depth=0.02, gap_px=1.6),
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(LIB)):
        LIB[key]()
