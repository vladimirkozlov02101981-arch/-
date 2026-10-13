"""Рендер поля высот и цвета (numpy) в Blender по блокам — для текстур в 4 раза подробнее игровых (родные ×4).

Поле считается с шагом 1/R2 единицы мира (обычно R2 = 2), перед рендером каждый блок плавно увеличивается до 1/(R2·up)
(up = 2 → 4 px на единицу). Мелкую деталь, которой нет в поле, добавляет сам Blender: процедурное зерно цвета и
шероховатость (bump) в мировых координатах — они непрерывны через стыки блоков. Каждый блок рендерится со своим запасом
поля по краям (тени и отражённый свет на стыке правильные); блоки складываются в одно изображение утилитой
dev/tools/stitch_blocks.py (обычный Python, PIL).
HF_RESUME=1 — продолжение после остановки (выключение ПК): готовые блоки (файл читается, размер верный) не рендерятся
заново. Блок пишется сначала во временный b_<by>_<bx>.part.png и переименовывается целиком — прерванный рендер не
оставит битого блока.
"""
import math
import os

import bpy
import numpy as np


def up2(a):
    """увеличение ×2 со сдвигом центров пикселей (билинейно); a — с запасом 1 пиксель по краям, результат без него"""
    def ax(b, axis):
        prev = np.roll(b, 1, axis); nxt = np.roll(b, -1, axis)
        even = 0.75 * b + 0.25 * prev; odd = 0.75 * b + 0.25 * nxt
        sh = list(b.shape); sh[axis] *= 2; out = np.empty(sh, b.dtype)
        idx = [slice(None)] * b.ndim
        idx[axis] = slice(0, None, 2); out[tuple(idx)] = even
        idx[axis] = slice(1, None, 2); out[tuple(idx)] = odd
        return out
    r = ax(ax(a, 0), 1)
    return r[2:-2, 2:-2]


def block_ok(path, B):
    """блок уже готов (для HF_RESUME=1): файл читается и нужного размера"""
    if not os.path.isfile(path): return False
    try:
        img = bpy.data.images.load(path, check_existing=False)
        ok = tuple(img.size) == (B, B) and len(img.pixels) == B * B * 4
        bpy.data.images.remove(img)
        return ok
    except Exception:
        return False


def tex_hash(yy, xx, seed):
    """детерминированный шум 0..1 по глобальным координатам текселя: одинаков в соседних блоках (бесшовно)"""
    v = np.sin(xx * 12.9898 + yy * 78.233 + seed * 37.719) * 43758.5453
    return (v - np.floor(v)).astype(np.float32)


def render_blocks(mt, name, H, C, E=None, R2=2, up=2, light=None, block=1024, margin=128, samples=128,
                  rough=0.82, spec=0.25, micro=0.08, emit=1.6, out_dir=None, hgrain=0.0, cgrain=0.0, speck=0.0, sss=0.0):
    """H (N2×N2, единицы мира), C (N2×N2×3, sRGB 0..255), E (N2×N2×3 свечение 0..1 или None); бесшовные по краям.
    Пишет out_dir/<name>/b_<by>_<bx>.png (block×block px).
    hgrain / cgrain / speck — деталь в 1–2 текселя (критик r24: «родные» Blender-текстуры были фактически ×2): микрорельеф
    (ед. мира), зерно тона (доля яркости) и доля искр-блёсток (+25 %); считаются по глобальным координатам — без швов.
    sss — доля подповерхностного рассеяния (снег: мягкие голубоватые тени комьев)."""
    R = R2 * up; NY2, NX2 = H.shape; nby = max(1, NY2 * up // block); nbx = max(1, NX2 * up // block)
    B = NX2 * up // nbx; B2 = B // up; M2 = margin // up
    assert NY2 * up // nby == B, 'блоки должны быть квадратными'
    ext = 1 if up > 1 else 0                                   # для увеличения ×2 нужен ещё пиксель запаса
    out_dir = out_dir or os.environ.get('HF_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'test-results', 'blocks')
    od = os.path.join(out_dir, name); os.makedirs(od, exist_ok=True)
    for by in range(nby):
        for bx in range(nbx):
            final = os.path.join(od, 'b_%d_%d.png' % (by, bx))
            if os.environ.get('HF_RESUME') == '1' and block_ok(final, B):
                print('BLOCK', name, by, bx, 'of', nby, nbx, 'skip', flush=True); continue
            if os.environ.get('HF_ONLY') and os.environ['HF_ONLY'] != '%d,%d' % (by, bx): continue   # проба одного блока
            if light: mt.LIGHT.update(**light)
            sc = mt.reset()
            ys = np.arange(by * B2 - M2 - ext, (by + 1) * B2 + M2 + ext) % NY2; xs = np.arange(bx * B2 - M2 - ext, (bx + 1) * B2 + M2 + ext) % NX2
            U = up2 if up > 1 else (lambda a: a)
            Hb = U(H[np.ix_(ys, xs)].astype(np.float32))
            Cb = np.stack([U(C[np.ix_(ys, xs)][..., k].astype(np.float32)) for k in range(3)], -1)
            Eb = np.stack([U(E[np.ix_(ys, xs)][..., k].astype(np.float32)) for k in range(3)], -1) if E is not None else None
            if up == 1 and (hgrain or cgrain or speck):
                YY, XX = np.meshgrid(ys.astype(np.float32), xs.astype(np.float32), indexing='ij')
                def blur(a): return (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5   # зерно 1–2 текселя, не «цифровой» шум
                if hgrain: Hb = Hb + blur(tex_hash(YY, XX, 1) - 0.5) * hgrain
                if cgrain: Cb = Cb * (1 + blur(tex_hash(YY, XX, 2) - 0.5) * cgrain)[..., None]
                if speck: sp = tex_hash(YY, XX, 3) < speck; Cb[sp] *= 1.25
                del YY, XX
            n = Hb.shape[0]                                        # B + 2·margin пикселей
            size = n / R / 100.0
            # блок в мировых координатах: процедурное зерно и bump непрерывны через стыки
            cx = (bx * B + B / 2) / R / 100.0; cy = -(by * B + B / 2) / R / 100.0
            bpy.ops.mesh.primitive_grid_add(x_subdivisions=n, y_subdivisions=n, size=size, calc_uvs=True, location=(cx, cy, 0))
            ob = bpy.context.active_object; me = ob.data
            co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
            # вершины сетки стоят в углах пикселей (n+1 на сторону): высота угла — среднее четырёх соседних пикселей
            # (прежнее «ближайший пиксель» брало рельеф через пиксель — полосы и рябь на гранях)
            ix = np.clip(np.round((co[:, 0] + size / 2) / size * n).astype(int), 0, n)
            iy = np.clip(np.round((size / 2 - co[:, 1]) / size * n).astype(int), 0, n)
            Hc = np.pad(Hb, 1, mode='edge')
            co[:, 2] = 0.25 * (Hc[iy, ix] + Hc[iy + 1, ix] + Hc[iy, ix + 1] + Hc[iy + 1, ix + 1]) / 100.0
            me.vertices.foreach_set('co', co.ravel()); me.update()
            for p in me.polygons: p.use_smooth = True

            def image(nm, arr, srgb):
                img = bpy.data.images.new(nm, n, n, alpha=False); img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
                px = np.ones((n, n, 4), np.float32); px[..., :3] = arr[::-1]; img.pixels.foreach_set(px.ravel()); img.update(); img.pack(); return img
            m, nt, b = mt.principled('hf', rough, spec); N_ = nt.nodes; L = nt.links
            if sss > 0 and 'Subsurface Weight' in b.inputs:
                b.inputs['Subsurface Weight'].default_value = sss
                b.inputs['Subsurface Radius'].default_value = (0.6, 0.8, 1.0)
                b.inputs['Subsurface Scale'].default_value = 3.0 / R / 100.0      # ~3 текселя: рассеяние в комьях, не туман
            tx = N_.new('ShaderNodeTexImage'); tx.image = image('albedo', np.clip(Cb / 255.0, 0, 1), True); tx.interpolation = 'Closest' if up == 1 else 'Linear'
            tc = N_.new('ShaderNodeNewGeometry')                    # мировые координаты: зерно непрерывно через стыки блоков
            # мелкое зерно цвета в мировых координатах: ~3 и ~1,3 текселя (прежние масштабы 520/1900 давали зерно мельче текселя —
            # оно усреднялось сглаживанием рендера, и самой мелкой детали в текстуре не было)
            TX = R * 100.0                                          # текселей на единицу Blender
            n1 = N_.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = TX / 3; n1.inputs['Detail'].default_value = 4; L.new(tc.outputs['Position'], n1.inputs['Vector'])
            n2 = N_.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = TX / 1.3; n2.inputs['Detail'].default_value = 2; L.new(tc.outputs['Position'], n2.inputs['Vector'])
            mix = N_.new('ShaderNodeMath'); mix.operation = 'ADD'; L.new(n1.outputs['Fac'], mix.inputs[0]); L.new(n2.outputs['Fac'], mix.inputs[1])
            mr = N_.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.6; mr.inputs['From Max'].default_value = 1.4
            mr.inputs['To Min'].default_value = 1 - micro; mr.inputs['To Max'].default_value = 1 + micro; L.new(mix.outputs['Value'], mr.inputs['Value'])
            mul = N_.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mt.sock(mul.inputs, 'Factor_Float').default_value = 1.0
            L.new(tx.outputs['Color'], mt.sock(mul.inputs, 'A_Color'))
            cmb = N_.new('ShaderNodeCombineColor'); L.new(mr.outputs['Result'], cmb.inputs[0]); L.new(mr.outputs['Result'], cmb.inputs[1]); L.new(mr.outputs['Result'], cmb.inputs[2])
            L.new(cmb.outputs['Color'], mt.sock(mul.inputs, 'B_Color'))
            L.new(mt.sock(mul.outputs, 'Result_Color'), b.inputs['Base Color'])
            if Eb is not None:
                te = N_.new('ShaderNodeTexImage'); te.image = image('emit', np.clip(Eb, 0, 1), False); te.interpolation = 'Linear'
                for key in ('Emission Color', 'Emission'):
                    if key in b.inputs: L.new(te.outputs['Color'], b.inputs[key]); break
                if 'Emission Strength' in b.inputs: b.inputs['Emission Strength'].default_value = emit
            nz = N_.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = TX / 1.6; nz.inputs['Detail'].default_value = 3; L.new(tc.outputs['Position'], nz.inputs['Vector'])
            bu = N_.new('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.4; bu.inputs['Distance'].default_value = 0.002
            L.new(nz.outputs['Fac'], bu.inputs['Height']); L.new(bu.outputs['Normal'], b.inputs['Normal'])
            me.materials.append(m)
            sc.render.resolution_x = sc.render.resolution_y = B; sc.render.resolution_percentage = 100
            sc.camera.data.ortho_scale = B / R / 100.0; sc.camera.data.clip_end = 50
            sc.camera.location = (cx, cy, 10)
            sc.cycles.samples = samples
            # узкий фильтр пикселя: стандартный Блэкман–Харрис шириной 1,5 px размывал деталь в 1 тексель (критик r24: R ≈ 0.5)
            sc.cycles.filter_width = float(os.environ.get('HF_FILTER', '0.6'))
            if os.environ.get('HF_DENOISE', '0') == '0': sc.cycles.use_denoising = False   # шумоподавление тоже съедало зерно (R 0.65 против 1.2 без него)
            mt.OUT = od; mt.render(sc, 'b_%d_%d.part' % (by, bx))
            os.replace(os.path.join(od, 'b_%d_%d.part.png' % (by, bx)), final)
            print('BLOCK', name, by, bx, 'of', nby, nbx, flush=True)
    mt.LIGHT.update(col=(1.0, 0.85, 0.66), elev=25, energy=5.0)
    return nby, nbx
