"""
Бесшовная текстура породы из эталона: лоскутное шитьё с подбором мягких швов.

Старый запуск сохраняется:
python dev/tex_from_ref.py <эталон.png> <выход.png> <масштаб> <размер> x0,y0,x1,y1 [...]

Дополнительно: --patch, --overlap, --feather, --seed, --candidates,
--mirror (вероятность 0..1), --brightness (максимальный сдвиг яркости 0..255),
--reuse-penalty (штраф за повтор соседнего участка источника 0..1; 0 отключает штраф).
Их значения можно задать через PATCH_SIZE, OVERLAP, FEATHER, SEED, CANDIDATES,
MIRROR, BRIGHTNESS, REUSE_PENALTY. FEATHER — радиус: 24 означает полосу смешивания в 49 px.
DESPECKLE=1 убирает одиночные яркие точки снега/искр до синтеза.
"""
import argparse
import math
import os
import numpy as np
from PIL import Image, ImageFilter

DESPECKLE = os.environ.get('DESPECKLE', '').lower() not in ('', '0', 'false', 'no')


def load_sources(path, boxes, scale):
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('scale must be a finite positive number')
    if not boxes:
        raise ValueError('provide at least one source box: x0,y0,x1,y1')
    with Image.open(path) as image:
        im = image.convert('RGB')
    width, height = im.size
    out = []
    for b in boxes:
        if len(b) != 4 or not (0 <= b[0] < b[2] <= width and 0 <= b[1] < b[3] <= height):
            raise ValueError(f'invalid source box {b}: use x0,y0,x1,y1 within {width}x{height}')
        c = im.crop(b)
        w, h = (round(v * scale) for v in c.size)
        if min(w, h) < 8:
            raise ValueError(f'source box {b} is too small after scaling ({w}x{h}); need at least 8x8')
        if DESPECKLE:
            a = np.asarray(c).astype(np.int16)
            med = np.asarray(c.filter(ImageFilter.MedianFilter(7))).astype(np.int16)
            spot = (a.sum(2) - med.sum(2)) > 45
            a[spot] = med[spot]
            c = Image.fromarray(a.astype(np.uint8))
        c = c.resize((w, h), Image.Resampling.LANCZOS)
        out.append(np.asarray(c).astype(np.float32))
    return out


def min_cut_v(err):
    """Вертикальный шов наименьшей ошибки: для каждой строки — столбец границы."""
    h, w = err.shape
    energy = err.copy()
    for y in range(1, h):
        p = energy[y - 1]
        left, right = np.r_[np.inf, p[:-1]], np.r_[p[1:], np.inf]
        energy[y] += np.minimum(np.minimum(left, p), right)
    path = np.zeros(h, int)
    path[-1] = int(np.argmin(energy[-1]))
    for y in range(h - 2, -1, -1):
        x = path[y + 1]
        lo, hi = max(0, x - 1), min(w, x + 2)
        path[y] = lo + int(np.argmin(energy[y, lo:hi]))
    return path


def feather_mask(mask, radius):
    """Смягчить только границу владения; заполнение за краем маски не затемняет край."""
    out = mask.astype(np.float32)
    if not radius:
        return out
    kernel = np.r_[np.arange(1, radius + 2), np.arange(radius, 0, -1)].astype(np.float32)
    kernel /= kernel.sum()
    for axis in (0, 1):
        padding = [(0, 0)] * 2
        padding[axis] = (radius, radius)
        padded = np.pad(out, padding, mode='edge')
        out = np.apply_along_axis(lambda v: np.convolve(v, kernel, 'valid'), axis, padded)
    return out


def _edge_width(values):
    """Длина уже заполненного непрерывного перекрытия от края лоскута."""
    empty = np.flatnonzero(~values)
    return int(empty[0]) if empty.size else len(values)


def _choose_patch(candidates, used, patch_size, rng, reuse):
    # Сначала ограничить ошибку шва: разнообразие не должно жертвовать качеством стыка.
    best_error = min(item[0] for item in candidates)
    pool = [item for item in candidates if item[0] <= best_error * 1.1 + 1e-6]
    if reuse:
        scored = []
        for item in pool:
            error, _, _, (source, sy, sx) = item
            near = sum(1 for ui, uy, ux in used
                       if ui == source and abs(uy - sy) < patch_size * .6
                       and abs(ux - sx) < patch_size * .6)
            # Формула 27fb7cd с поправкой на среднюю ошибку каналов вместо суммы RGB.
            score = error * (1 + reuse * near) + near * reuse * (40 / 1.8)
            scored.append((score, item))
        best_score = min(score for score, _ in scored)
        pool = [item for score, item in scored if score <= best_score * 1.1 + 1e-6]
    return pool[int(rng.integers(len(pool)))]


def quilt(srcs, size, B, O, seed=1, cands=64, feather=24, mirror=0.35, brightness=12.0, reuse_penalty=0.6):
    if not isinstance(size, int) or not isinstance(B, int) or not isinstance(O, int):
        raise ValueError('size, patch and overlap must be integers')
    if not (4 <= B < size and 1 <= O < B):
        raise ValueError('use size > patch >= 4 and 1 <= overlap < patch')
    if not isinstance(cands, int) or cands < 1:
        raise ValueError('candidates must be a positive integer')
    if not isinstance(feather, int) or not 0 <= feather <= B:
        raise ValueError('feather radius must be an integer between 0 and patch size')
    if not math.isfinite(mirror) or not 0 <= mirror <= 1:
        raise ValueError('mirror probability must be between 0 and 1')
    if not math.isfinite(brightness) or not 0 <= brightness <= 255:
        raise ValueError('brightness adjustment must be between 0 and 255')
    if not math.isfinite(reuse_penalty) or not 0 <= reuse_penalty <= 1:
        raise ValueError('reuse penalty must be between 0 and 1')
    usable = []
    for source in srcs:
        s = np.asarray(source, dtype=np.float32)
        if s.ndim != 3 or s.shape[2] != 3 or not np.isfinite(s).all():
            raise ValueError('each source must be a finite RGB image array')
        if min(s.shape[:2]) >= B:
            usable.append(s)
    if not usable:
        raise ValueError(f'no source crop can fit a {B}x{B} patch; enlarge the crop or lower --patch')

    rng = np.random.default_rng(seed)
    # Равномерные шаги не больше B-O: точный размер без растяжения и узких остатков.
    n = math.ceil(size / (B - O))
    positions = np.rint(np.arange(n) * size / n).astype(int)
    out = np.zeros((size, size, 3), np.float32)
    filled = np.zeros((size, size), bool)
    used = []
    rows = np.arange(B)[:, None]
    columns = np.arange(B)[None, :]
    for y in positions:
        # Каждый ряд замыкается по кольцу независимо, поэтому сетка швов не выстраивается в столбцы.
        shift = int(rng.integers(size))
        for base_x in positions:
            x = (int(base_x) + shift) % size
            iy, ix = (rows + y) % size, (columns + x) % size
            tgt, m = out[iy, ix], filled[iy, ix]
            has_overlap = m.any()
            target_overlap = tgt[m] if has_overlap else None
            target_mean = float(target_overlap.mean()) if has_overlap else 0.0
            best = []
            for _ in range(cands):
                source = int(rng.integers(len(usable)))
                s = usable[source]
                height, width = s.shape[:2]
                sy, sx = int(rng.integers(height - B + 1)), int(rng.integers(width - B + 1))
                p = s[sy:sy + B, sx:sx + B]
                if rng.random() < mirror:
                    p = p[:, ::-1]
                adjustment = 0.0
                if has_overlap:
                    overlap = p[m]
                    # Одинаковая поправка каналов сохраняет цвет и мелкие детали камня.
                    adjustment = float(np.clip(target_mean - overlap.mean(), -brightness, brightness))
                    error = float(np.square(np.clip(overlap + adjustment, 0, 255) - target_overlap).mean())
                else:
                    error = float(rng.random())
                best.append((error, p, adjustment, (source, sy, sx)))
            _, p, adjustment, location = _choose_patch(best, used, B, rng, reuse_penalty)
            used.append(location)
            p = np.clip(p + adjustment, 0, 255)
            mask = np.ones((B, B), bool)
            if has_overlap:
                error = np.square(p - tgt).sum(2)
                full_columns, full_rows = m.all(0), m.all(1)
                left, right = _edge_width(full_columns), _edge_width(full_columns[::-1])
                top, bottom = _edge_width(full_rows), _edge_width(full_rows[::-1])
                # Реальная ширина перекрытия зависит от сдвига ряда и точного размера плитки.
                for side, width in (('left', left), ('right', right), ('top', top), ('bottom', bottom)):
                    width = min(width, B // 2)
                    if not width:
                        continue
                    if side == 'left':
                        cut = min_cut_v(error[:, :width])
                        mask &= columns > cut[:, None]
                    elif side == 'right':
                        cut = min_cut_v(error[:, -width:][:, ::-1])
                        mask &= columns < B - 1 - cut[:, None]
                    elif side == 'top':
                        cut = min_cut_v(error[:width, :].T)
                        mask &= rows > cut[None, :]
                    else:
                        cut = min_cut_v(error[-width:, :][::-1].T)
                        mask &= rows < B - 1 - cut[None, :]
                mask |= ~m
            alpha = np.where(m, feather_mask(mask, feather), 1.0)[..., None]
            out[iy, ix] = tgt * (1 - alpha) + p * alpha
            filled[iy, ix] = True
    if not filled.all():
        raise RuntimeError('quilting left an unfilled area')
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('reference')
    parser.add_argument('destination')
    parser.add_argument('scale', type=float)
    parser.add_argument('size', type=int)
    parser.add_argument('boxes', nargs='+', help='x0,y0,x1,y1')
    for flag, env, kind, default in (
        ('patch', 'PATCH_SIZE', int, None), ('overlap', 'OVERLAP', int, None),
        ('feather', 'FEATHER', int, 24), ('seed', 'SEED', int, 1),
        ('candidates', 'CANDIDATES', int, 64), ('mirror', 'MIRROR', float, 0.35),
        ('brightness', 'BRIGHTNESS', float, 12.0),
        ('reuse-penalty', 'REUSE_PENALTY', float, 0.6),
    ):
        parser.add_argument('--' + flag, type=kind, default=os.environ.get(env, default))
    args = parser.parse_args()
    try:
        boxes = [tuple(int(v) for v in box.split(',')) for box in args.boxes]
        srcs = load_sources(args.reference, boxes, args.scale)
        largest = max(min(s.shape[:2]) for s in srcs)
        patch = args.patch if args.patch is not None else min(args.size - 1, largest, max(8, min(110, int(largest * 0.6))))
        overlap = args.overlap if args.overlap is not None else max(1, patch // 4)
        radius = min(args.feather, patch) if args.feather == 24 else args.feather
        img = quilt(srcs, args.size, patch, overlap, seed=args.seed, cands=args.candidates,
                    feather=radius, mirror=args.mirror, brightness=args.brightness, reuse_penalty=args.reuse_penalty)
        Image.fromarray(np.clip(np.rint(img), 0, 255).astype(np.uint8)).save(args.destination)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print('WROTE', args.destination, 'patch', patch, 'overlap', overlap,
          'feather', radius, 'seed', args.seed, 'candidates', args.candidates, 'reuse-penalty', args.reuse_penalty)


if __name__ == '__main__':
    main()
