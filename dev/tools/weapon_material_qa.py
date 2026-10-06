"""Сравнение материалов при одинаковых кадре/камере/геометрии. Только QA, без установки игровых PNG."""
from pathlib import Path
import json, hashlib, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'test-results'/(sys.argv[1] if len(sys.argv)>1 else 'weapons-materials')
names=sorted(p.stem.removeprefix('wpn_') for p in (OUT/'after').glob('wpn_*.png'))
sheet=Image.new('RGB',(1584,432*len(names)),'#233238');draw=ImageDraw.Draw(sheet);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
report={'models':{},'runtime_installed':False}
for i,name in enumerate(names):
    entry={}
    for j,stage in enumerate(['before','after']):
        p=OUT/stage/('wpn_'+name+'.png');im=Image.open(p).convert('RGBA');a=np.array(im)[:,:,3];ys,xs=np.where(a>32)
        entry[stage]={'size':list(im.size),'bbox':[int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())],'edge_alpha':int((a[0]>0).sum()+(a[-1]>0).sum()+(a[:,0]>0).sum()+(a[:,-1]>0).sum()),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
        bg=Image.new('RGBA',im.size,'#3a4d52');bg.alpha_composite(im);sheet.paste(bg.convert('RGB'),(16+j*784,40+i*432));draw.text((16+j*784,8+i*432),name.upper()+' - '+stage.upper(),font=font,fill='white')
    scene=json.loads((OUT/'after'/('wpn_'+name+'.json')).read_text('utf8'));entry['geometry_unchanged']=scene['geometry_unchanged'];entry['packed']=scene['all_images_packed'];entry['runtime_unchanged']=hashlib.sha256((ROOT/'assets'/'tex'/('wpn_'+name+'.png')).read_bytes()).hexdigest()==scene.get('runtime_sha256',entry['before']['sha256']);entry['pass']=entry['after']['size']==[768,384] and entry['after']['edge_alpha']==0 and entry['geometry_unchanged'] and entry['packed'] and entry['runtime_unchanged'];report['models'][name]=entry
sheet.save(OUT/'compare.png');report['pass']=all(e['pass'] for e in report['models'].values());(OUT/'qa.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(report,indent=2));assert report['pass']
