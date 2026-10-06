"""Вторая проверка фото-PBR: ориентированное дерево и нейтральный металл.
Blender -b --python dev/blender/weapon_material_refine.py -- bat assault
Геометрия и свет прежние, игровые PNG не изменяет.
"""
import bpy, sys, json, hashlib, math, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'dev'/'blender'))
import wpn_lib as W
import make_weapons2 as models
OUT=ROOT/'test-results'/'weapons-materials-v2'
SOURCES={}

def fingerprint():
    data=[]
    for o in bpy.context.scene.objects:
        if o.type=='MESH': data.append((o.name,[list(v.co) for v in o.data.vertices],[list(p.vertices) for p in o.data.polygons],list(o.location),list(o.rotation_euler),list(o.scale),[(m.name,m.type,getattr(m,'width',0)) for m in o.modifiers]))
    return hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()

def photo_image(folder,channel):
    p=ROOT/'dev'/'pbr'/folder/(folder+'_'+channel+'_-b.jpg')
    key=str(p.relative_to(ROOT))
    im=bpy.data.images.load(str(p),check_existing=True)
    if 'source_width' not in im:
        im['source_width'],im['source_height']=im.size
        im.name=folder+'_'+channel+'_packed4k'
        if channel!='diff': im.colorspace_settings.name='Non-Color'
        im.scale(4096,4096);im.pack()
    SOURCES[key]={'file':key,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'source_size':[im['source_width'],im['source_height']],'packed_size':list(im.size),'channel':channel}
    return im

def frame(name,loc=(0,0,0),rot=0):
    o=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(o)
    o.location=loc;o.rotation_euler=(0,rot,0)
    return o

def coordinates(mat,origin,scale,offset):
    N,L=mat.node_tree.nodes,mat.node_tree.links
    tc=N.new('ShaderNodeTexCoord');tc.object=origin
    sep=N.new('ShaderNodeSeparateXYZ');L.new(tc.outputs['Object'],sep.inputs[0])
    xy=N.new('ShaderNodeCombineXYZ')
    # Фото дерева имеет вертикальные волокна: V вдоль продольной оси модели.
    axes=('Z','X') if mat.name.startswith(('ash','wood')) else ('X','Z')
    for i,axis in enumerate(axes):
        m=N.new('ShaderNodeMath');m.operation='MULTIPLY_ADD';m.inputs[1].default_value=scale[i];m.inputs[2].default_value=offset[i]
        L.new(sep.outputs[axis],m.inputs[0]);L.new(m.outputs[0],xy.inputs[i])
    return xy.outputs[0]

def textures(mat,folder,coords):
    N,L=mat.node_tree.nodes,mat.node_tree.links;t={}
    for ch in ('diff','rough','disp'):
        n=N.new('ShaderNodeTexImage');n.image=photo_image(folder,ch);n.interpolation='Linear';n.extension='EXTEND'
        L.new(coords,n.inputs['Vector']);t[ch]=n
    return t

def set_photo_normal(mat,height,strength):
    N,L=mat.node_tree.nodes,mat.node_tree.links;b=N.get('Principled BSDF')
    # Только геометрическая фаска под фотоheight. Старый Wave/Noise-Bump не участвует.
    bevel=next((n for n in N if n.type=='BEVEL'),None)
    for l in list(b.inputs['Normal'].links): L.remove(l)
    bump=N.new('ShaderNodeBump');bump.inputs['Strength'].default_value=strength;bump.inputs['Distance'].default_value=.00008
    L.new(height,bump.inputs['Height'])
    if bevel:L.new(bevel.outputs['Normal'],bump.inputs['Normal'])
    L.new(bump.outputs['Normal'],b.inputs['Normal'])

def wood(mat,origin=None,scale=(7.5,3.5),offset=(.16,.04),tint=(2.25,2.7,3.0)):
    N,L=mat.node_tree.nodes,mat.node_tree.links;b=N.get('Principled BSDF')
    if origin is None:origin=frame('wood_axis',(-.03,0,0),-.34)
    t=textures(mat,'wood_table_001',coordinates(mat,origin,scale,offset))
    for socket in ('Base Color','Roughness'):
        for l in list(b.inputs[socket].links):L.remove(l)
    cm=N.new('ShaderNodeVectorMath');cm.operation='MULTIPLY';cm.inputs[1].default_value=tint
    L.new(t['diff'].outputs['Color'],cm.inputs[0]);L.new(cm.outputs['Vector'],b.inputs['Base Color'])
    rr=N.new('ShaderNodeMapRange');rr.inputs['To Min'].default_value=.35;rr.inputs['To Max'].default_value=.57
    L.new(t['rough'].outputs['Color'],rr.inputs['Value']);L.new(rr.outputs['Result'],b.inputs['Roughness'])
    b.inputs['Coat Weight'].default_value=.18;b.inputs['Coat Roughness'].default_value=.22
    set_photo_normal(mat,t['disp'].outputs['Color'],.13)

def metal(mat,origin):
    N,L=mat.node_tree.nodes,mat.node_tree.links;b=N.get('Principled BSDF')
    t=textures(mat,'metal_plate_02',coordinates(mat,origin,(.3,.75),(.15,.12)))
    color=b.inputs['Base Color'].links[0].from_socket
    rough=b.inputs['Roughness'].links[0].from_socket
    # Фото вариация нейтральная: сохраняем серебро и воронение, локальный износ и кромки.
    bw=N.new('ShaderNodeRGBToBW');L.new(t['diff'].outputs['Color'],bw.inputs[0])
    rng=N.new('ShaderNodeMapRange');rng.inputs['To Min'].default_value=.88;rng.inputs['To Max'].default_value=1.08
    L.new(bw.outputs[0],rng.inputs['Value'])
    cm=N.new('ShaderNodeVectorMath');cm.operation='SCALE';L.new(color,cm.inputs[0]);L.new(rng.outputs['Result'],cm.inputs['Scale']);L.new(cm.outputs['Vector'],b.inputs['Base Color'])
    photoR=N.new('ShaderNodeMapRange');photoR.inputs['To Min'].default_value=.22;photoR.inputs['To Max'].default_value=.47
    L.new(t['rough'].outputs['Color'],photoR.inputs['Value'])
    mix=N.new('ShaderNodeMix');mix.data_type='FLOAT';mix.inputs['Factor'].default_value=.42
    L.new(rough,mix.inputs['A']);L.new(photoR.outputs['Result'],mix.inputs['B']);L.new(mix.outputs['Result'],b.inputs['Roughness'])
    set_photo_normal(mat,t['disp'].outputs['Color'],.09)

def pilot(name):
    global SOURCES;SOURCES={}
    for stage in ['before','after','installed']:(OUT/stage).mkdir(parents=True,exist_ok=True)
    src=ROOT/'assets'/'tex'/('wpn_'+name+'.png');shutil.copy2(src,OUT/'installed'/src.name)
    sc=W.scene(-16,32,-12,12,16,384);mats=W.M();W.M_DARK[0]=mats.dark;models.HELD[name](mats)
    before=fingerprint();W.render(sc,str(OUT/'before'/src.name))
    if name=='bat':wood(mats.c['ash'])
    elif name=='assault':
        origin=frame('metal_world');metal(mats.c['gun'],origin);metal(mats.c['steel'],origin)
    after=fingerprint();assert before==after
    bpy.ops.file.pack_all();sc['photo_sources']=json.dumps(list(SOURCES.values()))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'after'/('wpn_'+name+'.blend')))
    W.render(sc,str(OUT/'after'/src.name))
    images=[{'name':i.name,'size':list(i.size),'packed':bool(i.packed_file)} for i in bpy.data.images if i.source=='FILE']
    report={'id':name,'geometry_sha256_before':before,'geometry_sha256_after':after,'geometry_unchanged':before==after,'frame':[-16,32,-12,12],'pixels_per_unit':16,'samples':384,'device':sc.cycles.device,'lighting':'same studio.exr and three area lights for fresh before/after','sources':list(SOURCES.values()),'images':images,'all_images_packed':all(i['packed'] for i in images),'runtime_installed':False,'runtime_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'wood_wave_removed':name=='bat','neutral_metal_color':name=='assault'}
    (OUT/'after'/('wpn_'+name+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('REFINE_DONE',name,json.dumps({'geometry':before==after,'packed':report['all_images_packed'],'source_count':len(SOURCES)}),flush=True)

if __name__=='__main__':
    for name in (sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['bat','assault']):pilot(name)
