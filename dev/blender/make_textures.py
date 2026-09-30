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
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.62, 0.7, 0.85, 1); bg.inputs[1].default_value = 0.45
    # солнце сверху слева (в кадре верх = +Y), чуть со стороны зрителя
    sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 3.3; sd.angle = math.radians(3); sd.color = (1.0, 0.94, 0.84)
    sun = bpy.data.objects.new('sun', sd); sc.collection.objects.link(sun)
    d = Vector((0.55, -0.8, -0.5)).normalized()        # низкое солнце — рельеф читается сильнее
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


def mat_stone(name, dark, light, rough=0.55, moss=0.0, spec=0.45, scale=6.0, bumpk=0.6):
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
        sock(mm.inputs, 'B_Color').default_value = (*lin((0.30, 0.40, 0.14)), 1)
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
    mst = mat_stone('stone', stone_dark, stone_light, rough=0.38, spec=0.55, scale=5, bumpk=0.5)
    # камни: много мелких и средних, немного крупных валунов; наполовину в земле
    count = int(190 * density)
    for i in range(count):
        q = rng.random()
        r = 0.025 + 0.035 * q if q < 0.5 else (0.06 + 0.07 * rng.random() if q < 0.9 else 0.13 + 0.12 * rng.random())
        sz = rng.uniform(0.6, 0.95)
        me = rock_mesh('rock%d' % i, r, rng.uniform(0.9, 1.4), rng.uniform(0.75, 1.05), sz, rng.random() * 100, rough=0.22)
        place(me, mst, rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), 0.045 - r * sz * rng.uniform(0.1, 0.5),
              (0, 0, rng.uniform(0, 6.28)), rng.uniform(-0.3, 0.3), 'rock')
    # крошка
    for i in range(int(520 * density)):
        r = rng.uniform(0.005, 0.014)
        me = rock_mesh('pebble%d' % i, r, 1.2, 1, 0.7, rng.random() * 100, sub=2)
        place(me, mst, rng.uniform(-S / 2, S / 2), rng.uniform(-S / 2, S / 2), 0.05, (0, 0, rng.uniform(0, 6.28)), rng.uniform(-0.4, 0.2), 'peb')
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


def masonry(name, seed, bw, bh, dark, light, mortar, moss=0.0, jitter=1.0):
    """кладка из тёсаного камня: блоки разной длины, неровные, со сколами; глубокий тёмный раствор"""
    sc = reset(); rng = random.Random(seed)
    n = 256
    cols = np.array(mortar)[None, None, :] * (0.6 + 0.7 * fft_noise(n, 0.5, seed + 5))[..., None]
    height_plane('mortar', fft_noise(n, 1.1, seed), 0.01, np.clip(cols, 0, 1) ** 2.2, z0=-0.035)
    bpy.data.objects['mortar'].data.materials.append(mat_vertex_color('mortar', rough=1.0, spec=0.1))
    mst = mat_stone('block', dark, light, rough=0.72, moss=moss, spec=0.3, scale=3.5, bumpk=0.9)
    w, h = bw / 100.0, bh / 100.0
    rows = int(round(S / h)); h = S / rows
    gap = 0.014
    for j in range(rows):
        y = -S / 2 + j * h + h / 2
        widths = []; tot = 0
        while tot < S - 0.6 * w:
            ww = w * rng.uniform(0.7, 1.55); widths.append(ww); tot += ww
        widths[-1] += S - tot                                   # ряд ровно на плитку — бесшовно
        x = -S / 2 + rng.uniform(0, w)
        for ww in widths:
            me = block_mesh((ww - gap) / 2, (h - gap) / 2, 0.04, rng, jitter)
            me.materials.append(mst)
            place(me, mst, x + ww / 2, y, 0.0, (0, 0, rng.uniform(-0.008, 0.008)), rng.uniform(-0.4, 0.35), 'blk')
            x += ww
    render(sc, name)


def slab_wall(name, seed, dark, light, mortar):
    """стена пещеры: плотно уложенные неровные плиты разного размера"""
    sc = reset(); rng = random.Random(seed)
    n = 256
    cols = np.array(mortar)[None, None, :] * (0.6 + 0.6 * fft_noise(n, 0.6, seed))[..., None]
    height_plane('back', fft_noise(n, 1.2, seed + 1), 0.02, np.clip(cols, 0, 1) ** 2.2, z0=-0.05)
    bpy.data.objects['back'].data.materials.append(mat_vertex_color('back', rough=1.0, spec=0.1))
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


def grass_strip(name, seed, cols, flowers, height=0.26, H_PX=80):
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
            if key in b.inputs: b.inputs[key].default_value = 0.15; break
        mats.append(m)
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
    H = 4.0                                                    # высота кадра в метрах (дерево ~3.5 м)
    cam = sc.camera; cam.data.ortho_scale = H
    cam.location = (0, -10, H / 2 - 0.05); cam.rotation_euler = (math.radians(90), 0, 0)
    bm = bmesh.new(); tips = []
    bark_dark, bark_light = ((0.32, 0.25, 0.18), (0.55, 0.45, 0.34)) if kind != 'birch' else ((0.55, 0.53, 0.50), (0.93, 0.92, 0.88))
    if kind == 'oak':
        _cone(bm, Vector((0, 0, -0.1)), Vector((0, 0, 1.35)), 0.2, 0.14, 14)
        for _ in range(4):
            d = Vector((rng.uniform(-0.9, 0.9), rng.uniform(-0.5, 0.5), rng.uniform(0.6, 1.0))).normalized()
            _branches(bm, Vector((0, 0, rng.uniform(1.0, 1.35))), d, rng.uniform(0.55, 0.8), 0.1, 3, rng, tips, 0.75)
        shades = [lin(c) for c in ((0.22, 0.36, 0.10), (0.33, 0.48, 0.14), (0.45, 0.58, 0.18), (0.56, 0.66, 0.24), (0.28, 0.40, 0.12))]
        leaf = dict(R=0.42, n=520, size=0.07, flat=0.8)
    elif kind == 'birch':
        _cone(bm, Vector((0, 0, -0.1)), Vector((0, 0, 2.6)), 0.09, 0.04, 12)
        for i in range(7):
            h = 1.2 + i * 0.22; d = Vector((rng.choice((-1, 1)) * rng.uniform(0.5, 0.9), rng.uniform(-0.4, 0.4), rng.uniform(0.5, 1.0))).normalized()
            _branches(bm, Vector((0, 0, h)), d, rng.uniform(0.35, 0.55), 0.035, 2, rng, tips, 0.6)
        shades = [lin(c) for c in ((0.35, 0.50, 0.16), (0.50, 0.64, 0.22), (0.62, 0.72, 0.30), (0.42, 0.56, 0.18))]
        leaf = dict(R=0.26, n=300, size=0.05, flat=0.9)
    else:  # pine
        _cone(bm, Vector((0, 0, -0.1)), Vector((0, 0, 3.5)), 0.12, 0.02, 12)
        shades = [lin(c) for c in ((0.10, 0.22, 0.12), (0.15, 0.30, 0.16), (0.22, 0.38, 0.20), (0.12, 0.26, 0.13))]
        leaf = dict(R=0.2, n=160, size=0.05, flat=0.35, needle=True)
        for i in range(16):
            h = 0.6 + i * 0.18; wdt = 1.1 * (1 - i / 17) + 0.15
            for a in range(6):
                ang = a / 6 * math.tau + rng.uniform(-0.3, 0.3)
                d = Vector((math.cos(ang) * wdt, math.sin(ang) * wdt * 0.6, -0.12 * wdt))
                _cone(bm, Vector((0, 0, h)), Vector((0, 0, h)) + d, 0.02, 0.006, 6)
                for t in (0.45, 0.8):
                    tips.append(Vector((0, 0, h)) + d * t + Vector((0, 0, 0.03)))
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
    'dirt_valley': lambda: dirt_stones('dirt_valley', 11, (0.50, 0.34, 0.21), (0.33, 0.21, 0.12), (0.26, 0.25, 0.24), (0.62, 0.60, 0.57), density=2.0),
    # тёмная башня и светлая кладка стен и моста
    'brick_keep': lambda: masonry('brick_keep', 21, 32, 16, (0.22, 0.225, 0.235), (0.48, 0.48, 0.49), (0.10, 0.10, 0.10), moss=0.35),
    'brick_light': lambda: masonry('brick_light', 22, 32, 16, (0.42, 0.40, 0.37), (0.74, 0.71, 0.66), (0.17, 0.16, 0.15), moss=0.45),
    # задняя стена пещер
    'cave_wall': lambda: slab_wall('cave_wall', 31, (0.16, 0.16, 0.165), (0.36, 0.36, 0.37), (0.05, 0.05, 0.05)),
    # трава долины: от тёмной у корней до жёлто-зелёной на солнце, полевые цветы
    'grass_valley': lambda: grass_strip('grass_valley', 41, [(0.30, 0.42, 0.12), (0.42, 0.56, 0.16), (0.55, 0.66, 0.22), (0.68, 0.76, 0.30), (0.50, 0.58, 0.20)],
                                        [(0.85, 0.15, 0.12), (0.95, 0.80, 0.18), (0.95, 0.94, 0.88), (0.35, 0.45, 0.95), (0.95, 0.45, 0.65)]),
    # деревья-спрайты: 3 дуба, 2 сосны, берёза
    'tree_oak1': lambda: tree_sprite('tree_oak1', 51, 'oak'), 'tree_oak2': lambda: tree_sprite('tree_oak2', 52, 'oak'), 'tree_oak3': lambda: tree_sprite('tree_oak3', 53, 'oak'),
    'tree_pine1': lambda: tree_sprite('tree_pine1', 61, 'pine'), 'tree_pine2': lambda: tree_sprite('tree_pine2', 62, 'pine'),
    'tree_birch1': lambda: tree_sprite('tree_birch1', 71, 'birch'),
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in (argv or list(LIB)):
        LIB[key]()
