"""Пакетная подготовка родных текстур ×4 для чёткой карты при приближении.

python dev/native_batch.py --exemplars          # один раз: образцы из фото-сканов dev/pbr в масштабе игры
python dev/native_batch.py <имя> [<имя> ...]    # увеличение по образцам (dev/exemplar_sr.py) и установка (dev/make_native.py)
python dev/native_batch.py --all                # все материалы из MATERIALS

Исходник — принятая игровая текстура (из dev/tex-backup, если её уже заменяли), поэтому вид карт при обычном
масштабе не меняется. Образцы подбираются по семейству материала; переносится только яркость деталей (--lum),
цвет остаётся от принятой текстуры.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PBR = ROOT / 'dev' / 'pbr'
EX = ROOT / 'test-results' / 'native-try' / 'ex'
OUT = ROOT / 'test-results' / 'native-try'
Image.MAX_IMAGE_PIXELS = None

# фото-образцы: (имя, ассет, кроп в пикселях 8k или None, масштабы). Масштаб подобран так, чтобы зерно и швы были
# соизмеримы с игровыми (≈2.5 мм на тексель при 4 текселях на игровую единицу); два масштаба — шире выбор совпадений
PHOTOS = {
    'soil05': ('forest_ground_05', None, (0.22, 0.12)),
    'soil06': ('forest_ground_06', (2048, 2048, 6144, 6144), (0.3,)),
    'granite': ('granite_tile_04', (1000, 320, 1800, 1350), (0.75, 0.4)),
    'weathered': ('stone_brick_wall_001', (3000, 2950, 6000, 4300), (0.35, 0.2)),
    'rocky03': ('rocky_terrain_03', (2048, 2048, 6144, 6144), (0.3, 0.18)),
    'sandstone': ('sandstone_cracks', None, (0.25, 0.12)),
    'redsand': ('red_sandstone_pavement', None, (0.2, 0.1)),
    'snow1': ('snow_01', None, (0.2, 0.1)),
    'snow2': ('snow_02', None, (0.2,)),
    'volcanic': ('volcanic_rock_tiles', (2048, 2048, 6144, 6144), (0.3, 0.15)),
    'herring': ('volcanic_herringbone_01', None, (0.18,)),
    'planks': ('old_planks_02', None, (0.15, 0.08)),
    'planksdirt': ('wood_planks_dirt', None, (0.15,)),
    'woodworn': ('wood_table_worn', None, (0.2,)),
    'brickred': ('castle_brick_02_red', None, (0.12, 0.07)),
    'bricksto': ('stone_brick_wall_001', None, (0.12, 0.07)),
    'concrete7': ('concrete_wall_007', None, (0.15, 0.08)),
    'concrete8': ('concrete_wall_008', None, (0.15,)),
    'beach': ('damp_beach_sand', None, (0.2, 0.1)),
    'beach2': ('damp_beach_sand_02', None, (0.2,)),
}
RENDERS = [ROOT / 'test-results' / 'ground-sharp' / 'v3' / 'ground-raw.png', ROOT / 'test-results' / 'ground-sharp' / 'cropfix-v2' / 'ground-raw.png']
FAMILY = {
    'soil': ['soil05', 'soil06', 'granite', 'weathered', 'rocky03', '@renders'],
    'sandstone': ['sandstone', 'redsand', 'rocky03', 'weathered', 'granite'],
    'snowrock': ['snow1', 'snow2', 'volcanic', 'granite', 'rocky03'],
    'basalt': ['volcanic', 'herring', 'granite', 'rocky03'],
    'stone': ['granite', 'weathered', 'rocky03', 'volcanic', 'sandstone'],
    'wood': ['planks', 'planksdirt', 'woodworn'],
    'brick': ['brickred', 'bricksto', 'granite', 'weathered'],
    'concrete': ['concrete7', 'concrete8', 'granite'],
    'sand': ['beach', 'beach2', 'sandstone'],
    'snow': ['snow1', 'snow2'],
    'ash': ['volcanic', 'beach', 'concrete7'],
}
MATERIALS = {
    'dirt_valley': 'soil', 'dirt_castle': 'soil', 'dirt_tropical': 'soil', 'dirt_alien': 'basalt', 'dirt_canyon': 'sandstone',
    'rock_canyon': 'sandstone', 'cave_canyon': 'sandstone', 'cave_wall': 'stone',
    'rock_arctic': 'snowrock', 'cave_arctic': 'stone', 'rock_volcano': 'basalt', 'cave_volcano': 'basalt',
    'rock_alien': 'basalt', 'cave_alien': 'stone', 'wood_ship': 'wood', 'wood_light': 'wood',
    'brick_castle': 'brick', 'brick_keep': 'brick', 'brick_light': 'brick', 'concrete_city': 'concrete',
    'cap_snow': 'snow', 'cap_sand': 'sand', 'cap_ash': 'ash',
}


def find(asset):
    files = sorted((PBR / asset).glob(asset + '_diff_*'))
    if not files:
        raise FileNotFoundError(asset)
    return files[-1]


def make_exemplars():
    EX.mkdir(parents=True, exist_ok=True)
    for name, (asset, crop, scales) in PHOTOS.items():
        im = Image.open(find(asset)).convert('RGB')
        if crop:
            im = im.crop(crop)
        for s in scales:
            out = EX / ('%s-%s.png' % (name, str(s).replace('.', '')))
            if out.exists():
                continue
            im.resize((max(64, int(im.width * s)), max(64, int(im.height * s))), Image.Resampling.LANCZOS).save(out)
            print('EXEMPLAR', out.name, flush=True)


def exemplars_for(family):
    files = []
    for key in FAMILY[family]:
        if key == '@renders':
            files += [str(p) for p in RENDERS if p.exists()]
        else:
            files += sorted(str(p) for p in EX.glob(key + '-*.png'))
    return files


def build(name):
    family = MATERIALS[name]
    backup = ROOT / 'dev' / 'tex-backup' / (name + '.png')
    low = backup if backup.exists() else ROOT / 'assets' / 'tex' / (name + '.png')
    w = Image.open(low).width
    out = OUT / ('%s-sr.png' % name)
    cmd = [sys.executable, str(ROOT / 'dev' / 'exemplar_sr.py'), str(low), str(out)] + exemplars_for(family) + \
          ['--stages', '2', '--lum', '--gain', '1.3'] + (['--stride', '3'] if w >= 1024 else [])
    print('SR', name, family, w, flush=True)
    subprocess.run(cmd, check=True)
    subprocess.run([sys.executable, str(ROOT / 'dev' / 'make_native.py'), str(out), name, '--no-match'], check=True)


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--exemplars' in args:
        make_exemplars()
    elif '--all' in args:
        make_exemplars()
        for n in MATERIALS:
            if n != 'dirt_valley':
                build(n)
    else:
        for n in args:
            build(n)
