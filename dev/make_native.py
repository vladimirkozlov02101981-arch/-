"""Пара текстур для чёткой карты при приближении: родная ×k и точно согласованная малая.

python dev/make_native.py <рендер.png> <имя> [--k 4] [--match <малая.png>] [--quality 92] [--no-match]

- <рендер.png> — рендер материала в k раз подробнее игровой текстуры (тот же период), например 2048² для периода 512.
- Палитра подгоняется к нынешней игровой текстуре того же имени (или --match): по каналам, квантильной кривой,
  посчитанной на уменьшенной копии — игра запекает свет и тени поверх малой текстуры, поэтому цель — её прежнее
  распределение, а не эталонная картина. Кривая применяется к родной текстуре, затем малая = точное уменьшение k×k.
- Пишет assets/tex/native/<имя>.webp (родная, WebP) и assets/tex/<имя>.png (малая, без потерь). Прежняя малая
  текстура сохраняется в dev/tex-backup/<имя>.png (один раз — откатить можно копированием обратно).
- В js/art.js добавляет имя в TexLib.nativeAvail и убирает из hiAvail: серая деталь была для прежней текстуры (фото-зерно fine остаётся).
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
Image.MAX_IMAGE_PIXELS = None


def box(a, k):
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, 3).mean((1, 3))


def match(native, target_low, k, rounds=2):
    """квантильная кривая по каналам: распределение уменьшенной родной → распределение прежней малой"""
    out = native.astype(np.float32)
    qs = np.linspace(0, 100, 257)
    for _ in range(rounds):
        low = box(out, k)
        for c in range(3):
            src = np.percentile(low[..., c], qs)
            dst = np.percentile(target_low[..., c], qs)
            src = np.maximum.accumulate(src + np.arange(len(src)) * 1e-6)   # строго возрастающая для interp
            out[..., c] = np.interp(out[..., c], src, dst)
    return np.clip(out, 0, 255)


def update_art(name, k):
    p = ROOT / 'js' / 'art.js'
    raw = p.read_bytes(); crlf = b'\r\n' in raw
    s = raw.decode('utf-8').replace('\r\n', '\n')
    m = re.search(r"nativeAvail: new Map\(\[(.*?)\]\)(?=,)", s, re.S)
    entries = dict(re.findall(r"\['(\w+)', (\d+)\]", m.group(1))) if m else {}
    entries[name] = str(k)
    body = ', '.join("['%s', %s]" % (n, v) for n, v in sorted(entries.items()))
    s = re.sub(r"nativeAvail: new Map\(\[.*?\]\)(?=,)", "nativeAvail: new Map([" + body + "])", s, count=1, flags=re.S)
    for key in ('hiAvail',):   # серая деталь была для прежней малой текстуры; фото-зерно fine независимо — остаётся
        mm = re.search(key + r": new Set\(\[([^\]]*)\]\)", s)
        if mm:
            names = [n for n in re.findall(r"'([\w]+)'", mm.group(1)) if n != name]
            s = s.replace(mm.group(0), key + ": new Set([" + ", ".join("'%s'" % n for n in names) + "])")
    p.write_bytes((s.replace('\n', '\r\n') if crlf else s).encode('utf-8'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('render'); ap.add_argument('name')
    ap.add_argument('--k', type=int, default=4); ap.add_argument('--quality', type=int, default=92)
    ap.add_argument('--match', default=None); ap.add_argument('--no-match', action='store_true')
    a = ap.parse_args()
    k, name = a.k, a.name
    native = np.asarray(Image.open(a.render).convert('RGB'), dtype=np.float32)
    if native.shape[0] % k or native.shape[1] % k:
        sys.exit('размер рендера должен делиться на k')
    low_path = ROOT / 'assets' / 'tex' / (name + '.png')
    backup = ROOT / 'dev' / 'tex-backup' / (name + '.png')
    backup.parent.mkdir(parents=True, exist_ok=True)
    if low_path.exists() and not backup.exists():
        shutil.copy2(low_path, backup)
    if not a.no_match:
        ref = Path(a.match) if a.match else (backup if backup.exists() else low_path)
        target = np.asarray(Image.open(ref).convert('RGB'), dtype=np.float32)
        native = match(native, target, k)
    native8 = native.round().astype(np.uint8)
    out = ROOT / 'assets' / 'tex' / 'native' / (name + '.webp')
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(native8).save(out, 'WEBP', quality=a.quality, method=6)
    # малая — точное уменьшение того, что увидит игра после декодирования WebP
    decoded = np.asarray(Image.open(out).convert('RGB'), dtype=np.float32)
    low = box(decoded, k).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(low).save(low_path)
    update_art(name, k)
    print('NATIVE', out, native8.shape[1], 'x', native8.shape[0], round(out.stat().st_size / 1048576, 2), 'MB;',
          'LOW', low_path, low.shape[1], 'x', low.shape[0], '; backup', backup if backup.exists() else '-')


if __name__ == '__main__':
    main()
