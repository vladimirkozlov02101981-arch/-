"""Exercise the actual installer only in a temporary fixture; production assets stay untouched."""
import importlib.util, json, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('native_pair', Path(__file__).resolve().parents[1] / 'dev' / 'make_native.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)
with tempfile.TemporaryDirectory(prefix='tw-native-pair-') as temp:
    root = Path(temp)
    (root / 'js').mkdir()
    (root / 'assets' / 'tex').mkdir(parents=True)
    (root / 'js' / 'art.js').write_bytes(b"nativeAvail: new Map([]),\r\nhiAvail: new Set(['fixture', 'other']),\r\n")
    old = np.full((16, 16, 3), [80, 90, 100], dtype=np.uint8)
    Image.fromarray(old).save(root / 'assets' / 'tex' / 'fixture.png')
    tool.ROOT = root
    rng = np.random.default_rng(32)
    for turn in range(2):
        source = rng.integers(0, 256, size=(64, 64, 3), dtype=np.uint8)
        Image.fromarray(source).save(root / 'render.png')
        sys.argv = ['make_native.py', str(root / 'render.png'), 'fixture', '--k', '4', '--no-match']
        tool.main()
        decoded = np.asarray(Image.open(root / 'assets' / 'tex' / 'native' / 'fixture.webp').convert('RGB'))
        assert np.array_equal(decoded, source), 'native RGB lost source pixel detail'
        low = np.asarray(Image.open(root / 'assets' / 'tex' / 'fixture.png'))
        expected = np.round(source.reshape(16, 4, 16, 4, 3).mean(axis=(1, 3))).astype(np.uint8)
        assert np.array_equal(low, expected), 'low is not the exact decoded source area average'
        backup = np.asarray(Image.open(root / 'dev' / 'tex-backup' / 'fixture.png'))
        assert np.array_equal(backup, old), 'a subsequent install overwrote the original backup'
    metadata = (root / 'js' / 'art.js').read_text()
    assert "['fixture', 4]" in metadata and "hiAvail: new Set(['other'])" in metadata
    assert b'\r\n' in (root / 'js' / 'art.js').read_bytes()
report = {'passed': True, 'nativeSourcePixelsExact': True, 'decodedBoxPairExact': True, 'backupRetained': True, 'metadataUpdated': True, 'productionAssetsChanged': False}
output = Path(__file__).resolve().parents[1] / 'test-results' / 'native-pair32'
output.mkdir(parents=True, exist_ok=True)
(output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
