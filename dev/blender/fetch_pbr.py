"""
Скачивает фотоскан-материалы CC0 с Poly Haven (https://polyhaven.com, лицензия CC0) для карт и оружия.
Запуск (любой python 3, в т.ч. встроенный в Blender):  python dev/blender/fetch_pbr.py [разрешение=4k]
Результат: dev/pbr/<asset>/<asset>_{diff,rough,nor_gl,disp}_<res>.<ext> и dev/pbr/catalog.json (что под какую цель выбрано).
"""
import json, os, sys, urllib.request

RES = sys.argv[1] if len(sys.argv) > 1 else '4k'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pbr')
UA = {'User-Agent': 'TerritoryWar-texture-fetch/1.0'}

# цель → слова для поиска (по убыванию важности); берутся 2 лучших совпадения
TARGETS = {
    'canyon_sandstone': ['sandstone', 'red rock', 'desert rock', 'canyon', 'rock wall'],
    'arctic_granite': ['granite', 'rock wall', 'cliff', 'slate', 'stone wall'],
    'volcano_basalt': ['basalt', 'lava', 'volcanic', 'dark rock', 'black rock'],
    'alien_rock': ['rocky', 'boulder', 'rock ground', 'gravel'],
    'valley_soil': ['forest ground', 'soil', 'dirt', 'mud', 'ground'],
    'castle_brick': ['castle', 'stone brick', 'medieval', 'stone wall', 'brick'],
    'ship_planks': ['old planks', 'wood planks', 'planks', 'weathered wood', 'barn'],
    'city_concrete': ['concrete wall', 'concrete', 'plaster', 'cement'],
    'snow': ['snow'],
    'sand': ['sand', 'beach'],
    'gun_metal': ['metal plate', 'painted metal', 'steel', 'iron', 'rusty metal'],
    'gun_wood': ['wood table', 'walnut', 'oak', 'fine wood', 'wood floor'],
    'rubber': ['rubber', 'leather', 'fabric'],
}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read()

def main():
    os.makedirs(OUT, exist_ok=True)
    assets = json.loads(get('https://api.polyhaven.com/assets?t=textures'))
    def score(aid, a, words):
        text = (aid.replace('_', ' ') + ' ' + ' '.join(a.get('tags', [])) + ' ' + ' '.join(a.get('categories', []))).lower()
        sc = 0
        for i, w in enumerate(words):
            if w in text: sc += (len(words) - i) * (3 if w in aid.replace('_', ' ') else 1)
        return sc
    catalog = {}
    for tgt, words in TARGETS.items():
        ranked = sorted(assets.items(), key=lambda kv: (-score(kv[0], kv[1], words), -kv[1].get('download_count', 0)))
        pick = [aid for aid, a in ranked[:2] if score(aid, a, words) > 0]
        catalog[tgt] = pick
        for aid in pick:
            d = os.path.join(OUT, aid); os.makedirs(d, exist_ok=True)
            files = json.loads(get('https://api.polyhaven.com/files/' + aid))
            for key, name in (('Diffuse', 'diff'), ('Rough', 'rough'), ('nor_gl', 'nor_gl'), ('Displacement', 'disp')):
                try:
                    opts = files[key][RES] if RES in files[key] else files[key][sorted(files[key])[-1]]
                    fmt = 'jpg' if 'jpg' in opts else 'png' if 'png' in opts else list(opts)[0]
                    url = opts[fmt]['url']; path = os.path.join(d, '%s_%s_%s.%s' % (aid, name, RES, fmt))
                    if not os.path.exists(path):
                        open(path, 'wb').write(get(url)); print('OK', tgt, aid, name)
                except Exception as e:
                    print('нет', aid, key, e)
    json.dump(catalog, open(os.path.join(OUT, 'catalog.json'), 'w'), indent=1, ensure_ascii=False)
    print('CATALOG', json.dumps(catalog, ensure_ascii=False))

if __name__ == '__main__':
    main()
