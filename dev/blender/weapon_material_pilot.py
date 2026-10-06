"""Изолированная проверка фото-PBR дерева и металла; игровые PNG не изменяет.
Blender -b --python dev/blender/weapon_material_pilot.py -- bat assault
Сохраняет packed .blend, PNG и сведения об исходных 8K-фотокартах.
"""
import bpy, sys, os, math, json, hashlib, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev' / 'blender'))
import wpn_lib as W
import make_weapons2 as models

OUT = ROOT / 'test-results' / 'weapons-materials'
SOURCES = []

def fingerprint():
    data = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            data.append((o.name, [list(v.co) for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons], list(o.location), list(o.rotation_euler), list(o.scale), [(m.name, m.type, getattr(m, 'width', 0)) for m in o.modifiers]))
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()

def photo_image(folder, channel):
    source = ROOT / 'dev' / 'pbr' / folder / (folder + '_' + channel + '_-b.jpg')
    im = bpy.data.images.load(str(source), check_existing=True)
    source_size = list(im.size)
    im.name = folder + '_' + channel + '_4k_from_8k'
    if channel != 'diff': im.colorspace_settings.name = 'Non-Color'
    # Настоящие 8K исходники остаются в dev/pbr; переносимая сцена использует подробные 4K-карты.
    im.scale(4096, 4096)
    im.pack()
    SOURCES.append({'file': str(source.relative_to(ROOT)), 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'source_size': source_size, 'packed_size': list(im.size), 'channel': channel})
    return im

def apply_photo(mat, folder, tint=(1, 1, 1), rough=(.3, .65), bump=.16, coat=None):
    N, L = mat.node_tree.nodes, mat.node_tree.links
    shader = N.get('Principled BSDF')
    tc = N.new('ShaderNodeTexCoord'); tc.label = 'Object-space photo material'
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (4.0, 4.0, 4.0)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    textures = {}
    for channel in ('diff', 'rough', 'disp'):
        n = N.new('ShaderNodeTexImage'); n.image = photo_image(folder, channel); n.projection = 'BOX'; n.projection_blend = .18; n.interpolation = 'Linear'
        L.new(mp.outputs['Vector'], n.inputs['Vector']); textures[channel] = n
    for socket in ('Base Color', 'Roughness'):
        for link in list(shader.inputs[socket].links): L.remove(link)
    cm = N.new('ShaderNodeVectorMath'); cm.operation = 'MULTIPLY'; cm.inputs[1].default_value = tint
    L.new(textures['diff'].outputs['Color'], cm.inputs[0]); L.new(cm.outputs['Vector'], shader.inputs['Base Color'])
    rm = N.new('ShaderNodeMapRange'); rm.inputs['To Min'].default_value = rough[0]; rm.inputs['To Max'].default_value = rough[1]
    L.new(textures['rough'].outputs['Color'], rm.inputs['Value']); L.new(rm.outputs['Result'], shader.inputs['Roughness'])
    bm = N.new('ShaderNodeBump'); bm.inputs['Strength'].default_value = bump; bm.inputs['Distance'].default_value = .00012
    # Сохраняем прежнюю геометрическую фаску/объём под новой нерегулярной фактурой.
    old_normal = shader.inputs['Normal'].links[0].from_socket if shader.inputs['Normal'].links else None
    if old_normal: L.new(old_normal, bm.inputs['Normal'])
    L.new(textures['disp'].outputs['Color'], bm.inputs['Height']); L.new(bm.outputs['Normal'], shader.inputs['Normal'])
    if coat is not None and 'Coat Weight' in shader.inputs: shader.inputs['Coat Weight'].default_value = coat
    mat['photo_source'] = folder

def pilot(name):
    global SOURCES
    SOURCES = []
    (OUT / 'before').mkdir(parents=True, exist_ok=True); (OUT / 'after').mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / 'assets' / 'tex' / ('wpn_' + name + '.png'), OUT / 'before' / ('wpn_' + name + '.png'))
    sc = W.scene(-16, 32, -12, 12, 16, 384); mats = W.M(); W.M_DARK[0] = mats.dark
    models.HELD[name](mats)
    before = fingerprint()
    if name == 'bat':
        apply_photo(mats.c['ash'], 'wood_table_worn', (1.4, 1.28, 1.1), (.32, .55), .13, .22)
    elif name == 'assault':
        apply_photo(mats.c['gun'], 'metal_plate', (.065, .069, .075), (.28, .52), .12)
        apply_photo(mats.c['steel'], 'metal_plate', (.8, .84, .9), (.22, .42), .10)
    after = fingerprint()
    assert before == after, 'Geometry changed'
    bpy.ops.file.pack_all()
    sc['photo_sources'] = json.dumps(SOURCES)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'after' / ('wpn_' + name + '.blend')))
    W.render(sc, str(OUT / 'after' / ('wpn_' + name + '.png')))
    images = [{'name': i.name, 'size': list(i.size), 'packed': bool(i.packed_file)} for i in bpy.data.images if i.source == 'FILE']
    report = {'id': name, 'geometry_sha256_before': before, 'geometry_sha256_after': after, 'geometry_unchanged': before == after,
              'frame': [-16, 32, -12, 12], 'pixels_per_unit': 16, 'samples': 384, 'device': sc.cycles.device,
              'lighting': 'unchanged studio.exr and three area lights', 'sources': SOURCES, 'images': images,
              'all_images_packed': all(i['packed'] for i in images), 'runtime_installed': False}
    (OUT / 'after' / ('wpn_' + name + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print('PILOT_DONE', name, json.dumps({'geometry_unchanged': report['geometry_unchanged'], 'packed': report['all_images_packed'], 'sources': len(SOURCES)}), flush=True)

if __name__ == '__main__':
    names = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['bat', 'assault']
    for name in names: pilot(name)
