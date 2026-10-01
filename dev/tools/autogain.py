"""Подгоняет gain темы по замеру cmatch: новый gain = старый × (эталон/игра). Запуск: SP=... python dev/tools/autogain.py canyon arctic ..."""
import os, re, sys, subprocess, json
TH = {'canyon': "cap: 'cap_sand', gain: ", 'arctic': "cap: 'cap_snow', gain: ", 'volcano': "cap: 'cap_ash', gain: ", 'alien': "glowTex: [90, 235, 255], gain: "}
out = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'cmatch.py')] + sys.argv[1:], capture_output=True, text=True, env=os.environ).stdout
p = 'js/themes.js'; s = open(p, encoding='utf-8', newline='').read()
for line in out.splitlines():
    m = re.match(r'(\w+) ref .* ratio \[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\]', line)
    if not m: continue
    k = TH[m.group(1)]; i = s.index(k) + len(k); j = s.index(']', i) + 1
    old = json.loads(s[i:j]); new = [round(o * float(r), 2) for o, r in zip(old, m.groups()[1:])]
    s = s[:i] + '[%s]' % ', '.join(str(v) for v in new) + s[j:]; print(m.group(1), old, '->', new)
open(p, 'w', encoding='utf-8', newline='').write(s)
