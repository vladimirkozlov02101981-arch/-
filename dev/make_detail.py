"""
Из текстуры двойного разрешения делает:
  assets/tex/<имя>.png      — обычную текстуру (уменьшение 2×2, 1 тексель = 1 игровая единица);
  assets/tex/hi/<имя>.webp  — карту мелких деталей: во сколько раз яркость каждого полупикселя отличается
                              от сглаженной (128 = без изменений). При приближении игра умножает на неё
                              растянутую картинку карты — появляются настоящие песчинки, швы и сколы (js/hires.js).
Запуск: python dev/make_detail.py <текстура_2x.png> <имя> [папка_tex]
"""
import sys, os, numpy as np
from PIL import Image

def main(src, name, out='assets/tex'):
    im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    H, W = im.shape[:2]; H -= H % 2; W -= W % 2; im = im[:H, :W]
    low = im.reshape(H // 2, 2, W // 2, 2, 3).mean((1, 3))
    Image.fromarray(np.clip(low + 0.5, 0, 255).astype(np.uint8)).save(os.path.join(out, name + '.png'))
    L = im @ np.array([0.3, 0.59, 0.11], np.float32); Ll = low @ np.array([0.3, 0.59, 0.11], np.float32)
    # обратно вверх билинейно, с заворотом (текстура бесшовная): центры полупикселей
    def up(a):
        h, w = a.shape; ys = (np.arange(2 * h) + 0.5) / 2 - 0.5; xs = (np.arange(2 * w) + 0.5) / 2 - 0.5
        y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int); fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
        ya, yb = y0 % h, (y0 + 1) % h; xa, xb = x0 % w, (x0 + 1) % w
        return (a[ya][:, xa] * (1 - fx) + a[ya][:, xb] * fx) * (1 - fy) + (a[yb][:, xa] * (1 - fx) + a[yb][:, xb] * fx) * fy
    ratio = (L + 4) / (up(Ll) + 4)
    os.makedirs(os.path.join(out, 'hi'), exist_ok=True)
    Image.fromarray(np.clip(ratio * 128, 0, 255).astype(np.uint8), 'L').save(os.path.join(out, 'hi', name + '.webp'), quality=92, method=6)
    print('DETAIL', name, W, H, 'ratio sd %.3f' % ratio.std())

def update_list(out='assets/tex', js='js/art.js'):
    """список готовых карт деталей в js/art.js (чтобы игра не запрашивала несуществующие файлы)"""
    import re
    names = sorted(f[:-5] for f in os.listdir(os.path.join(out, 'hi')) if f.endswith('.webp'))
    s = open(js, encoding='utf-8', newline='').read()
    s = re.sub(r"hiAvail: new Set\(\[[^\]]*\]\)", "hiAvail: new Set([" + ", ".join("'%s'" % n for n in names) + "])", s)
    open(js, 'w', encoding='utf-8', newline='').write(s)

if __name__ == '__main__':
    main(*sys.argv[1:]); update_list()
