"""Склейка блоков рендера (dev/blender/hf_render.py) в одно изображение.

python dev/tools/stitch_blocks.py <папка блоков> <выход.png>      (в папке: b_<by>_<bx>.png)
"""
import os
import re
import sys

from PIL import Image


def main(folder, out):
    files = [f for f in os.listdir(folder) if re.match(r'b_\d+_\d+\.png$', f)]
    idx = [tuple(map(int, re.findall(r'\d+', f))) for f in files]
    nby = max(i[0] for i in idx) + 1; nbx = max(i[1] for i in idx) + 1
    first = Image.open(os.path.join(folder, files[0])); B = first.width
    img = Image.new('RGB', (B * nbx, B * nby))
    for f, (by, bx) in zip(files, idx):
        img.paste(Image.open(os.path.join(folder, f)).convert('RGB'), (bx * B, by * B))
    img.save(out); print('STITCH', out, img.size)


if __name__ == '__main__':
    main(*sys.argv[1:3])
