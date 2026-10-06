"""QA выборочных Blender-правок оружия; запуск после install_weapons.py test-results/weapons-fix/after."""
from pathlib import Path
import hashlib, json, re
import numpy as np
from scipy.ndimage import label
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'test-results' / 'weapons-fix'
NAMES = ['bat', 'pickaxe', 'sniper', 'plasma', 'repulsor', 'jetpack']

def stats(path):
    im = Image.open(path).convert('RGBA'); alpha = np.array(im)[:, :, 3]; mask = alpha > 32
    yy, xx = np.where(mask)
    bbox = [int(xx.min()), int(yy.min()), int(xx.max()), int(yy.max())]
    cc, count = label(mask, np.ones((3, 3))); areas = np.bincount(cc.ravel())[1:]
    return {'size': list(im.size), 'bbox_alpha_gt32': bbox,
            'margins_px': [bbox[0], bbox[1], im.width - 1 - bbox[2], im.height - 1 - bbox[3]],
            'edge_any_alpha': int((alpha[:, 0] > 0).sum() + (alpha[:, -1] > 0).sum() + (alpha[0] > 0).sum() + (alpha[-1] > 0).sum()),
            'components_gt64px': sorted([int(a) for a in areas if a >= 64], reverse=True),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

report = {'frame': [-16, 32, -12, 12], 'origin': [0, 0], 'models': {},
          'renderer': 'Blender 5.2 Cycles OPTIX 384 samples',
          'notes': ['Procedural PBR, studio.exr illumination; no photoalbedo added.',
                    'Jetpack is new; previous version used Canvas.']}
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20)
sheet = Image.new('RGB', (1584, 432 * len(NAMES)), '#1d2831')
for i, name in enumerate(NAMES):
    after = OUT / 'after' / ('wpn_' + name + '.png'); a = stats(after)
    entry = {'after': a, 'blend': str(OUT / 'after' / ('wpn_' + name + '.blend'))}
    before = OUT / 'before' / ('wpn_' + name + '.png')
    if before.exists(): entry['before'] = stats(before)
    entry['pass'] = a['size'] == [768, 384] and min(a['margins_px']) >= 4 and a['edge_any_alpha'] == 0 and len(a['components_gt64px']) == 1
    installed = ROOT / 'assets' / 'tex' / ('wpn_' + name + '.png')
    raw = np.array(Image.open(after).convert('RGBA')); actual = np.array(Image.open(installed).convert('RGBA'))
    raw[raw[:, :, 3] == 0] = 0   # install_weapons очищает невидимый RGB, как задумано
    entry['installed_pixels_equal'] = np.array_equal(actual, raw)
    entry['pass'] = bool(entry['pass'] and entry['installed_pixels_equal'])
    report['models'][name] = entry
    pair = Image.new('RGB', (1584, 432), '#1d2831'); pd = ImageDraw.Draw(pair)
    for col, (p, tag) in enumerate(((before, 'BEFORE'), (after, 'AFTER'))):
        x = 16 + col * 784; pd.text((x, 8), name.upper() + ' - ' + tag, fill='white', font=font)
        if p.exists():
            bg = Image.new('RGBA', (768, 384), '#34424c'); bg.alpha_composite(Image.open(p).convert('RGBA')); pair.paste(bg.convert('RGB'), (x, 40))
        else: pd.text((x + 20, 170), 'Previous: Canvas backpack', fill='#a8bacb', font=font)
    pair.save(OUT / ('compare-' + name + '.png')); sheet.paste(pair, (0, i * 432))
sheet.save(OUT / 'compare-all.png')
before_hashes = json.loads((OUT / 'before-hashes.json').read_text(encoding='utf-8'))
changed = {'wpn_' + n + '.png' for n in NAMES}
report['untouched_assets'] = {n: hashlib.sha256((ROOT / 'assets' / 'tex' / n).read_bytes()).hexdigest() == h for n, h in before_hashes.items() if n not in changed}
weapons = (ROOT / 'js' / 'weapons.js').read_text(encoding='utf-8')
ids = re.findall(r"\{ id: '([^']+)'", weapons)
report['coverage'] = {'weapon_ids': len(ids), 'held_png': len(list((ROOT / 'assets' / 'tex').glob('wpn_*.png'))),
                      'flight_png': len(list((ROOT / 'assets' / 'tex').glob('ent_*.png'))),
                      'missing': [n for n in ids if not (ROOT / 'assets' / 'tex' / ('wpn_' + n + '.png')).exists()]}
report['scenes'] = json.loads((OUT / 'after' / 'scenes.json').read_text(encoding='utf-8'))
report['pass'] = all(v['pass'] for v in report['models'].values()) and all(report['untouched_assets'].values()) and not report['coverage']['missing'] and all(not s['images_external'] for s in report['scenes'].values())
(OUT / 'qa.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'pass': report['pass'], 'coverage': report['coverage'], 'unchanged': len(report['untouched_assets']),
                  'margins': {k: v['after']['margins_px'] for k, v in report['models'].items()},
                  'components': {k: v['after']['components_gt64px'] for k, v in report['models'].items()}}, indent=2))
assert report['pass'], 'Weapon QA failed'
