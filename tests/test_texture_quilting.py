"""Синтетические регрессии синтеза: python tests/test_texture_quilting.py."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dev.tex_from_ref import _choose_patch, feather_mask, load_sources, quilt


class TextureQuiltingTests(unittest.TestCase):
    def test_exact_dimensions_and_full_coverage(self):
        color = np.array([67, 103, 141], np.float32)
        source = np.broadcast_to(color, (32, 40, 3)).copy()
        for size in (37, 64, 95):
            with self.subTest(size=size):
                tile = quilt([source], size, 12, 5, cands=4, feather=3)
                self.assertEqual(tile.shape, (size, size, 3))
                np.testing.assert_allclose(tile, np.broadcast_to(color, tile.shape), atol=0.0001)

    def test_feather_keeps_solid_mask_at_patch_edges(self):
        # Нулевая подкладка свёртки раньше ослабляла даже полностью новый лоскут.
        np.testing.assert_allclose(feather_mask(np.ones((12, 12), bool), 6), 1, atol=0.000001)

    def test_seed_is_reproducible_and_brightness_stays_bounded(self):
        source = np.random.default_rng(5).uniform(65, 185, (48, 56, 3)).astype(np.float32)
        settings = dict(size=43, B=16, O=5, cands=6, feather=4, brightness=9)
        a = quilt([source], seed=12, **settings)
        np.testing.assert_array_equal(a, quilt([source], seed=12, **settings))
        self.assertFalse(np.array_equal(a, quilt([source], seed=13, **settings)))
        self.assertGreaterEqual(float(a.min()), float(source.min()) - 9 - 0.001)
        self.assertLessEqual(float(a.max()), float(source.max()) + 9 + 0.001)

    def test_wrapped_boundaries_are_normal_texture_transitions(self):
        y, x = np.mgrid[:96, :112]
        rng = np.random.default_rng(40)
        base = 128 + 25 * np.sin(x * .22 + y * .07) + 15 * np.cos(y * .19)
        base += rng.normal(0, 2, base.shape)
        source = np.stack([base * 1.03, base * .97, base * .86], 2).astype(np.float32)
        for seed in (1, 2, 9):
            with self.subTest(seed=seed):
                tile = quilt([source], 173, 32, 12, seed=seed, cands=16, feather=5)
                # Стыки повторённых плиток сравниваются с обычными соседними пикселями.
                horizontal = np.abs(tile[:, 0] - tile[:, -1]).mean()
                vertical = np.abs(tile[0] - tile[-1]).mean()
                self.assertLess(horizontal, np.abs(np.diff(tile, axis=1)).mean() * 1.8)
                self.assertLess(vertical, np.abs(np.diff(tile, axis=0)).mean() * 1.8)

    def test_invalid_crops_and_patch_sizes_explain_the_problem(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source.png'
            Image.new('RGB', (32, 32), (90, 100, 110)).save(path)
            for box in ((-1, 0, 16, 16), (0, 0, 33, 32), (8, 8, 2, 20)):
                with self.subTest(box=box), self.assertRaisesRegex(ValueError, 'invalid source box'):
                    load_sources(path, [box], 1)
            with self.assertRaisesRegex(ValueError, 'too small after scaling'):
                load_sources(path, [(0, 0, 10, 10)], .5)
            with self.assertRaisesRegex(ValueError, 'finite positive'):
                load_sources(path, [(0, 0, 32, 32)], 0)
        with self.assertRaisesRegex(ValueError, 'no source crop can fit a 16x16 patch'):
            quilt([np.ones((8, 8, 3), np.float32)], 40, 16, 4, feather=4)

    def test_reuse_penalty_spreads_equally_matching_source_motifs(self):
        # Все края одинаковые, но узнаваемые детали в центре различаются.
        marks = (132, 136, 140, 144)
        sources = []
        for mark in marks:
            source = np.full((8, 8, 3), 128, np.float32)
            source[4, 4] = mark
            sources.append(source)
        settings = dict(size=24, B=8, O=2, seed=3, cands=64, feather=0, mirror=0, brightness=0)
        random_tile = quilt(sources, reuse_penalty=0, **settings)
        diverse_tile = quilt(sources, reuse_penalty=.6, **settings)
        random_counts = [(random_tile[:, :, 0] == mark).sum() for mark in marks]
        diverse_counts = [(diverse_tile[:, :, 0] == mark).sum() for mark in marks]
        self.assertEqual(sum(diverse_counts), 16)
        self.assertLess(max(diverse_counts) - min(diverse_counts), max(random_counts) - min(random_counts))
        np.testing.assert_array_equal(diverse_tile, quilt(sources, reuse_penalty=.6, **settings))

    def test_diversity_cannot_select_a_bad_overlap(self):
        patch = np.zeros((8, 8, 3), np.float32)
        # Даже большой штраф за частый лучший участок не допускает шов хуже лимита110%.
        candidates = [(1., patch, 0., (0, 0, 0)), (1.09, patch, 0., (1, 0, 0)),
                      (1.11, patch, 0., (2, 0, 0))]
        selected = _choose_patch(candidates, [(0, 0, 0)] * 100, 8, np.random.default_rng(1), .6)
        self.assertEqual(selected[3], (1, 0, 0))
        self.assertLessEqual(selected[0], 1.1)

    def test_legacy_cli_and_environment_options(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source.png', Path(directory) / 'tile.png'
            Image.new('RGB', (32, 32), (90, 100, 110)).save(source)
            env = os.environ.copy()
            for key in ('PATCH_SIZE', 'OVERLAP', 'FEATHER', 'SEED', 'CANDIDATES', 'MIRROR', 'BRIGHTNESS', 'REUSE_PENALTY'):
                env.pop(key, None)
            command = [sys.executable, str(ROOT / 'dev/tex_from_ref.py'), str(source), str(output), '1', '37', '0,0,32,32']
            first = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            with Image.open(output) as image:
                self.assertEqual(image.size, (37, 37))
            env.update(PATCH_SIZE='12', OVERLAP='5', FEATHER='3', SEED='8', CANDIDATES='4', REUSE_PENALTY='0')
            second = subprocess.run(command, env=env, capture_output=True, text=True)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn('patch 12 overlap 5 feather 3 seed 8 candidates 4', second.stdout)
            self.assertIn('reuse-penalty 0.0', second.stdout)


if __name__ == '__main__':
    unittest.main()
