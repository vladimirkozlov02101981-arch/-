"""Sonniss GDC 2026 → assets/sfx: петли фона (44 с, бесшовный стык 3 с), отдельные разрывы, раскат ядерки, треск льда"""
import subprocess, numpy as np, os, sys
X = 'D:/Sonniss-GDC2026/x/'; OUT = 'D:/Територивар/assets/sfx/'; SR = 44100
def load(name, ss=0, t=None, ch=2):
    f = [n for n in os.listdir(X) if n.startswith(name)][0]
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(ss)] + (['-t', str(t)] if t else []) + ['-i', X + f, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-']
    a = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).reshape(-1, ch)
    return a.copy()
def save(a, name, q=3):
    a = a / max(1e-6, np.abs(a).max()) * 0.89
    p = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(a.shape[1]), '-i', '-', '-c:a', 'libvorbis', '-q:a', str(q), OUT + name + '.ogg'], input=a.astype(np.float32).tobytes(), check=True)
    print(name, a.shape[0] / SR, 's', os.path.getsize(OUT + name + '.ogg') // 1024, 'KB')
def loop(name, src, ss, L=44, X3=3.0, q=2, hp=None):
    a = load(src, ss, L + X3)
    if hp: a = hpf(a, hp)
    n = int(X3 * SR); body = a[:-n].copy(); tail = a[-n:]
    w = np.sin(np.linspace(0, np.pi / 2, n))[:, None] ** 2   # равная мощность
    body[:n] = body[:n] * np.sqrt(w) + tail * np.sqrt(1 - w)
    save(body, name, q)
def hpf(a, f):
    k = np.exp(-2 * np.pi * f / SR); y = np.zeros_like(a); prev = np.zeros(a.shape[1]); px = np.zeros(a.shape[1])
    for i in range(len(a)): prev = k * (prev + a[i] - px); px = a[i]; y[i] = prev
    return y
def onsets(a, thr=0.35, gap=0.5):
    e = np.abs(a).max(1); m = e.max(); idx = []; last = -1e9
    for i in np.where(e > thr * m)[0]:
        if i - last > gap * SR: idx.append(i)
        last = i if i - last > gap * SR else last
    return idx
def shot(a, i, L, pre=0.01, fade=0.6):
    s = max(0, i - int(pre * SR)); b = a[s:s + int(L * SR)].copy(); n = int(fade * SR)
    b[-n:] *= np.linspace(1, 0, n)[:, None] ** 2; return b
loop('amb_snow', 'WINDDsgn_EXT', 70)
loop('amb_wind', 'WINDDsgn_EXT', 128)
loop('amb_sea', 'WATRWave_Medium', 40)
loop('amb_lava', 'FIRECrkl', 50)
loop('amb_meadow', 'AMBSwmp', 20)
loop('amb_city', 'AMBUrbn', 30)
loop('amb_space', 'Roomtone Space', 10)
fw = load('13 Fireworks'); on = onsets(fw)
print('fireworks onsets', [round(i / SR, 2) for i in on])
for k, i in enumerate(on[:4]): save(shot(fw, i, 2.4), 'boom%d' % (5 + k), 4)
nb = load('EffectiveTrailer_Booms'); save(shot(nb, onsets(nb, 0.3)[0], 9.0, fade=4.0), 'nukeboom', 4)
save(load('ice, crack, ice block'), 'ice0', 4); save(load('ice, surface cracking'), 'ice1', 4)
