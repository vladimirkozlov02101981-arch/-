"""Фото-древесина по продольной оси каждой детали. Только кандидаты, игровые PNG не меняет.
Blender -b --python dev/blender/weapon_wood_batch.py -- shotgun bazooka rpg tesla pickaxe skip
"""
import bpy, math, sys, json, hashlib, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'dev'/'blender'))
import weapon_material_refine as R
W,models=R.W,R.models
OUT=ROOT/'test-results'/'weapons-wood'

def wooden_parts(mat):
    parts=[]
    for o in list(bpy.context.scene.objects):
        if o.type!='MESH' or not any(s.material==mat for s in o.material_slots):continue
        p=[o.matrix_world@v.co for v in o.data.vertices]
        mx=sum(v.x for v in p)/len(p);mz=sum(v.z for v in p)/len(p)
        xx=sum((v.x-mx)**2 for v in p);zz=sum((v.z-mz)**2 for v in p);xz=sum((v.x-mx)*(v.z-mz) for v in p)
        angle=.5*math.atan2(2*xz,xx-zz);a,b=math.cos(angle),math.sin(angle)
        along=[(v.x-mx)*a+(v.z-mz)*b for v in p];across=[-(v.x-mx)*b+(v.z-mz)*a for v in p]
        lo,hi=min(along),max(along);length=max(hi-lo,.001);width=max(max(across)-min(across),.001)
        origin=R.frame('wood_axis_'+o.name,(mx+a*lo,0,mz+b*lo),-angle)
        clone=mat.copy();clone.name='wood_photo_'+o.name
        R.wood(clone,origin,(min(7.5,.25/width),min(3.5,.85/length)),(.16,.04),(1.6,1.65,1.7))
        for slot in o.material_slots:
            if slot.material==mat:slot.material=clone
        parts.append({'object':o.name,'axis_radians':angle,'length_m':length,'width_m':width,'photo_axis':'V along longest XZ axis','scale':[min(7.5,.25/width),min(3.5,.85/length)],'offset':[.16,.04]})
    return parts

def model(name):
    R.SOURCES={}
    for stage in ['before','after','installed']:(OUT/stage).mkdir(parents=True,exist_ok=True)
    src=ROOT/'assets'/'tex'/('wpn_'+name+'.png');shutil.copy2(src,OUT/'installed'/src.name)
    sc=W.scene(-16,32,-12,12,16,384);mats=W.M();W.M_DARK[0]=mats.dark;models.HELD[name](mats)
    bpy.context.view_layer.update()
    before=R.fingerprint();W.render(sc,str(OUT/'before'/src.name));parts=wooden_parts(mats.c['wood']);assert parts
    after=R.fingerprint();assert before==after
    bpy.ops.file.pack_all();sc['photo_sources']=json.dumps(list(R.SOURCES.values()));sc['wood_parts']=json.dumps(parts)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'after'/('wpn_'+name+'.blend')));W.render(sc,str(OUT/'after'/src.name))
    images=[{'name':i.name,'size':list(i.size),'packed':bool(i.packed_file)} for i in bpy.data.images if i.source=='FILE']
    report={'id':name,'geometry_unchanged':before==after,'geometry_sha256_before':before,'geometry_sha256_after':after,'parts':parts,'sources':list(R.SOURCES.values()),'images':images,'all_images_packed':all(i['packed'] for i in images),'runtime_installed':False,'runtime_sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'frame':[-16,32,-12,12],'pixels_per_unit':16,'samples':384,'lighting':'same studio.exr and three area lights for fresh before/after','geometry_fix':{'skip':'Flag shaft points upward, touches finial and cloth, fully in frame','tesla':'Upper ceramic insulator starts inside brass case and overlaps copper terminal'}.get(name)}
    (OUT/'after'/('wpn_'+name+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print('WOOD_DONE',name,len(parts),flush=True)

if __name__=='__main__':
    for name in (sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['shotgun','bazooka','rpg','tesla','pickaxe','skip']):model(name)
