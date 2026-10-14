"""Записи оружия и взрывов из прошлых наборов Sonniss (D:/Sonniss-GDC2026/guns) → assets/sfx: одиночные выстрелы и взрывы.
Начало выстрела — по резкому подъёму громкости; хвост (отзвук) сохраняется до следующего выстрела, в конце — плавное затухание."""
import os, subprocess, sys
import numpy as np

G = 'D:/Sonniss-GDC2026/guns/'; OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'sfx') + '/'; SR = 44100


def load(path, ch=1):
    cmd = ['ffmpeg', '-v', 'error', '-i', G + path, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).reshape(-1, ch).copy()


def save(a, name, q=4):
    a = a / max(1e-6, np.abs(a).max()) * 0.89
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(a.shape[1]), '-i', '-', '-c:a', 'libvorbis', '-q:a', str(q), OUT + name + '.ogg'],
                   input=a.astype(np.float32).tobytes(), check=True)
    print(name, round(a.shape[0] / SR, 2), 's', os.path.getsize(OUT + name + '.ogg') // 1024, 'KB')


def onsets(a, thr=0.3, gap=0.12):
    e = np.abs(a).max(1); m = e.max(); w = int(0.004 * SR)
    env = np.convolve(e, np.ones(w) / w, 'same'); idx = []; i = 0
    while i < len(env):
        if env[i] > thr * m:
            idx.append(i); i += int(gap * SR)
            while i < len(env) and env[i] > thr * m * 0.6: i += 1
        else: i += 1
    return idx


def cut(a, i, L, nxt=None, fade=0.35, pre=0.004):
    s = max(0, i - int(pre * SR)); e = s + int(L * SR)
    if nxt is not None: e = min(e, nxt - int(0.01 * SR))
    b = a[s:e].copy(); n = min(len(b) // 2, int(fade * SR)); b[-n:] *= np.linspace(1, 0, n)[:, None] ** 2
    return b


def shots(path, names, L, pick=None, thr=0.3, gap=0.12):
    a = load(path); on = onsets(a, thr, gap); print(os.path.basename(path)[:50], 'onsets', len(on))
    sel = pick or list(range(len(names)))
    for name, k in zip(names, sel):
        save(cut(a, on[k], L, on[k + 1] if k + 1 < len(on) else None), name)


def whole(path, name, L, fade=1.0):
    a = load(path); on = onsets(a, 0.2, 1.0); save(cut(a, on[0], L, None, fade, 0.02), name)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    shots('Super Thump - M3 Grease Gun Recorded Source/STSRC_WoWW2_Wep_SMG_M3_GreaseGun_Submachine_Gun_Single_Shot_X10_Comp_Full.wav', ['shot1', 'shot2', 'shot3'], 0.9, [1, 4, 7], gap=0.25)
    shots('Audiobeast - The London Warehouse Firearms Library/Audiobeast_Small_Room_H&K_416_5.56_Assault_Rifle_05m_LS5_001_Single_Shot_x1.wav', ['shot4'], 0.9, gap=0.6)
    shots('Pole Position Production - Smith & Wesson M29 .44 Magnum/Smith_&_Wesson_M29_.44_Magnum_1.5m_behind_right_clean_Double_shots_x_4.wav', ['revolver1', 'revolver2'], 1.4, [0, 2], gap=0.2)
    shots('Pole Position - Colt Python .357 Magnum/Colt Python 357 Magnum - FIRING - Take 1 - 4m Left - CSS5.wav', ['revolver3'], 1.4, [1], gap=0.4)
    shots('Dramatic Cat - SVD Dragunov/GUNRif_SVD Dragunov 7.62×54R DESIGNED Single Shot Core Long_DRCA_DRAG_Stereo_05.wav', ['sniper1'], 2.4)
    shots('Pole Position Production - Barrett M98B .338 Lapua/Barrett_M98B_.338_Lapua_2m_right_MKH60_clean_Single_shots_x_17.wav', ['sniper2'], 2.2, [3], gap=0.6)
    shots('Pole Position - Lynx 50 Cal Sniper Rifle/Lynx 50 - FIRING - Take 2 - 4m Left - CSS5.wav', ['sniper3'], 2.4, [0], gap=0.6)
    shots('Dramatic Cat - Saiga-12/GUNShotg_Saiga 12 Cal.12 DESIGNED Single Shot Core Long_DRCA_SG12_Stereo.wav', ['shotgun1'], 1.8)
    shots('Audiobeast - The London Warehouse Firearms Library/Audiobeast_Medium_Warehouse_Remington_870_12g_Pump_Action_Shotgun_10m_U87_001_Single_Shot_x8.wav', ['shotgun2'], 1.6, [2], gap=0.9)
    shots('TS Sound - 12 Gauge Shotgun/Shotgun_Fire_Slug_01.wav', ['shotgun3'], 1.6)
    shots('Fascinated Sound - The Gun Locker SFX Pack/Automatic Cannon - MK44 - 03 - Single Shot with Report 03.wav', ['cannon1'], 1.8)
    shots('Pole Position - Lynx 50 Cal Sniper Rifle/Lynx 50 - FIRING - Take 2 - 4m Left - CSS5.wav', ['cannon2'], 1.8, [1], gap=0.6)
    whole('DavidDumais - Explosion SFX Pack/EXPLReal_Medium Realistic Explosion 15_DDUMAIS_NONE.wav', 'boom10', 3.5)
    whole('Stefano Cremona - Explosions/BigExplosion02.wav', 'boom11', 4.0)
    whole('Stefano Cremona - Explosions/DeepExplosion02.wav', 'boom12', 4.0)
    whole('DavidDumais - Explosion SFX Pack/EXPLDsgn_Nuclear Explosion 07_DDUMAIS_NONE.wav', 'nukeboom', 9.0, 3.0)
