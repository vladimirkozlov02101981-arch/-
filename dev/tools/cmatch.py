"""Сравнение средней яркости породы: эталон vs скриншот игры (SP/r15-<map>-auto.png). Отношение ref/game умножается на gain темы в js/themes.js."""
import sys, numpy as np, re
from PIL import Image
import os
U='dev/reference/'; SP=os.environ.get('SP','/tmp')+'/'
M={'canyon':('canyon.png',(0,600,700,950),(0,580,600,800)),
   'arctic':('arctic.png',(0,650,1500,895),(0,620,1440,800)),
   'volcano':('volcano.png',(370,610,1340,985),(200,600,1400,800)),
   'alien':('alien.png',(360,620,1250,780),(100,600,800,780))}
for m in sys.argv[1:]:
    f,rb,gb=M[m]
    ref=np.asarray(Image.open(U+f).convert('RGB').crop(rb)).astype(float).reshape(-1,3).mean(0)
    game=np.asarray(Image.open(SP+os.environ.get('R','r16')+'-%s-auto.png'%m).convert('RGB').crop(gb)).astype(float).reshape(-1,3).mean(0)
    print(m,'ref',ref.round(1),'game',game.round(1),'ratio',(ref/game).round(3))
