"""Настоящая мелкая фактура для сильного зума, без изменения основных текстур.

Запуск: python -B dev/sharp_detail.py [dirt_valley dirt_castle]
Нужны локальные фотосканы из dev/pbr (Poly Haven, CC0), numpy и Pillow.
Выход: assets/tex/fine/<имя>.webp — lossless RGB2048, 128=множитель1.0.
8 текселей на игровую единицу; период детали256 единиц, независимый от макропороды.
Взяты только высокие частоты фотосканов: никаких случайных зерна или шума.
"""
from pathlib import Path
import sys

sys.dont_write_bytecode = True

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
SIZE = 2048
TEXELS = 8
RADIUS = 6
LIMITS = (.8, 1.22)
STRENGTH = 1.2
CHROMA = .25
RECIPES = {
    'dirt_valley': (('forest_ground_06', .75, (0, 0)),
                    ('rocky_terrain_03', .25, (317, 743))),
    'dirt_castle': (('forest_ground_05', .60, (521, 193)),
                    ('rocky_terrain_03', .40, (941, 127))),
}


def scan_path(name):
    paths = sorted((ROOT / 'dev/pbr' / name).glob(name + '_diff_*'))
    if not paths:
        raise FileNotFoundError(f'Нет локального фотоскана {name}: dev/pbr/{name}/{name}_diff_*')
    return paths[-1]


def wrapped_blur(rgb, radius):
    """Гауссово усреднение только скана с периодическим продолжением за все края."""
    pad = 4 * radius + 4
    padded = np.pad(rgb, ((pad, pad), (pad, pad), (0, 0)), mode='wrap')
    blurred = Image.fromarray(padded).filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(blurred, dtype=np.float32)[pad:-pad, pad:-pad]


def photo_residual(name):
    path = scan_path(name)
    with Image.open(path) as image:
        source_size = image.size
        if min(source_size) < SIZE:
            raise ValueError(f'Фотоскан {path.name} слишком мал: {source_size}, нужно не меньше {SIZE}')
        # Уменьшение полного настоящего8Kскана сохраняет его бесшовность и физические детали.
        rgb = np.asarray(image.convert('RGB').resize((SIZE, SIZE), Image.Resampling.LANCZOS))
    low = wrapped_blur(rgb, RADIUS)
    detail = np.log((rgb.astype(np.float32) + 8) / (low + 8))
    # Микрорельеф передаётся яркостью; слабая цветная компонента сохраняет настоящие вкрапления.
    luma = detail @ np.array([.3, .59, .11], np.float32)
    detail = luma[..., None] * (1 - CHROMA) + detail * CHROMA
    detail -= detail.mean(axis=(0, 1), dtype=np.float64)
    print('SOURCE', name, source_size, path.name, flush=True)
    return detail


def encode(detail):
    # Нормализация нейтрального тона после ограничения не позволяет мелкой фактуре затемнить карту.
    detail = detail * STRENGTH
    lower, upper = np.log(LIMITS)
    for _ in range(4):
        ratio = np.exp(detail)
        detail -= np.log(ratio.mean(axis=(0, 1), dtype=np.float64))
        detail = np.clip(detail, lower, upper)
    pixels = np.clip(np.rint(np.exp(detail) * 128),
                     np.ceil(LIMITS[0] * 128), np.floor(LIMITS[1] * 128)).astype(np.uint8)
    for _ in range(8):
        mean = pixels.mean(axis=(0, 1), dtype=np.float64) / 128
        if np.max(np.abs(mean - 1)) < .00002:
            break
        detail -= np.log(mean)
        pixels = np.clip(np.rint(np.exp(detail) * 128),
                         np.ceil(LIMITS[0] * 128), np.floor(LIMITS[1] * 128)).astype(np.uint8)
    # Проверка хранится в единицах реально закодированной8битной карты.
    ratio = pixels.astype(np.float32) / 128
    if not np.isfinite(ratio).all() or ratio.min() < LIMITS[0] or ratio.max() > LIMITS[1]:
        raise RuntimeError('Некорректный диапазон карты мелких деталей')
    return pixels


def metrics(pixels):
    ratio = pixels.astype(np.float32) / 128
    dx = np.abs(np.diff(ratio, axis=1)).mean()
    dy = np.abs(np.diff(ratio, axis=0)).mean()
    edge_x = np.abs(ratio[:, 0] - ratio[:, -1]).mean()
    edge_y = np.abs(ratio[0] - ratio[-1]).mean()
    return {
        'mean': ratio.mean(axis=(0, 1), dtype=np.float64).round(5).tolist(),
        'std': ratio.std(axis=(0, 1), dtype=np.float64).round(5).tolist(),
        'range': [float(ratio.min()), float(ratio.max())],
        'boundary_vs_normal': [round(float(edge_x / dx), 3), round(float(edge_y / dy), 3)],
    }


def build(name):
    detail = np.zeros((SIZE, SIZE, 3), np.float32)
    for scan, weight, shift in RECIPES[name]:
        part = photo_residual(scan)
        detail += np.roll(part, shift, axis=(0, 1)) * weight
    pixels = encode(detail)
    destination = ROOT / 'assets/tex/fine' / (name + '.webp')
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels, 'RGB').save(destination, lossless=True, method=6, exact=True)
    with Image.open(destination) as stored:
        if not np.array_equal(np.asarray(stored.convert('RGB')), pixels):
            raise RuntimeError('Lossless WebP не сохранил пиксели')
    print('FINE', name, SIZE, 'texels/world', TEXELS, 'bytes', destination.stat().st_size,
          metrics(pixels), flush=True)


if __name__ == '__main__':
    names = sys.argv[1:] or list(RECIPES)
    for name in names:
        if name not in RECIPES:
            raise SystemExit('Неизвестная карта мелкой фактуры: ' + name)
        build(name)
