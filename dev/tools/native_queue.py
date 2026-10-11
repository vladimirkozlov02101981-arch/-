"""Очередь родных текстур ×4 для нескольких параллельных процессов (каждый берёт следующий свободный материал).

python dev/tools/native_queue.py <имя> [<имя> ...]      — запускать 2–3 копии с одним и тем же списком
Захват — файл test-results/native-try/locks/<имя>.lock (создаётся атомарно); готовые и занятые пропускаются.
Сборка материала — dev/native_batch.py (увеличение по образцам и установка с потерями).
После остановки (выключение ПК): python dev/tools/native_queue.py --clear-stale — снимает захваты материалов без готовой
родной текстуры (assets/tex/native/<имя>.webp); запускать один раз, пока копии очереди не работают.
"""
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('nb', ROOT / 'dev' / 'native_batch.py')
nb = importlib.util.module_from_spec(spec); spec.loader.exec_module(nb)
LOCKS = ROOT / 'test-results' / 'native-try' / 'locks'; LOCKS.mkdir(parents=True, exist_ok=True)

if sys.argv[1:2] == ['--clear-stale']:
    for p in sorted(LOCKS.glob('*.lock')):
        if not (ROOT / 'assets' / 'tex' / 'native' / (p.stem + '.webp')).exists():
            p.unlink(); print('QUEUE unlock', p.stem)
    sys.exit(0)

for name in sys.argv[1:]:
    try:
        fd = os.open(LOCKS / (name + '.lock'), os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.write(fd, str(os.getpid()).encode()); os.close(fd)
    except FileExistsError:
        continue
    print('QUEUE take', name, os.getpid(), flush=True)
    nb.build(name)
    print('QUEUE done', name, flush=True)
