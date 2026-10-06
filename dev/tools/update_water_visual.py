import re

with open('js/terrain_visual.js', 'rb') as f:
    content = f.read().decode('utf-8')

# 1. Update S in buildTerrainVisual
target1 = "sun: G.sun ? hex2rgb(G.sun) : null,"
replacement1 = "sun: G.sun ? hex2rgb(G.sun) : null, hasWaterline: (theme.id === 'tropical' || theme.id === 'castle') && waterY < H, kelpCol: theme.id === 'tropical' ? [32, 58, 26] : [48, 76, 32], waterDeep: theme.liquid && theme.liquid.deep ? hex2rgb(theme.liquid.deep) : [12, 47, 85],"

assert target1 in content, "target1 not found"
content = content.replace(target1, replacement1, 1)

# 2. Update solid pixels shading
target2 = "if (o.emit) { r = o.r * 1.05; g = o.g * 1.02; bl = o.b; }                    // светящиеся окна не темнеют от теней и глубины"
replacement2 = """if (o.emit) { r = o.r * 1.05; g = o.g * 1.02; bl = o.b; }                    // светящиеся окна не темнеют от теней и глубины
        if (S.hasWaterline && !o.emit) {
          const dyw = y - S.waterY;
          if (dyw > -28 && dyw < 28) {
            const wetK = 1 - Math.abs(dyw) / 28;
            const wetDark = 0.24 * wetK;
            r *= (1 - wetDark); g *= (1 - wetDark); bl *= (1 - wetDark);
          }
          if (dd <= 14 && dyw > -18 && dyw < 24 && (mt === 2 || mt === 3 || mt === 4)) {
            const algNoise = tileAt(S.tiles.t1, x * 1.5, y * 2.5, 1, 71);
            const algMask = (1 - Math.abs(dyw - 2) / 22) * (1 - dd / 15);
            if (algNoise > 0.42 && algMask > 0.12) {
              const ak = Math.min(0.72, (algNoise - 0.42) * 2.2 * algMask);
              const kc = S.kelpCol;
              r += (kc[0] - r) * ak;
              g += (kc[1] - g) * ak;
              bl += (kc[2] - bl) * ak;
            }
          }
          if (dyw > 0) {
            const depthK = Math.min(0.65, Math.pow(dyw / 180, 0.85));
            const dt = S.waterDeep;
            r = r * (1 - depthK) + dt[0] * depthK * 0.85;
            g = g * (1 - depthK) + dt[1] * depthK * 0.95;
            bl = bl * (1 - depthK) + dt[2] * depthK * 1.05;
          }
        }"""

assert target2 in content, "target2 not found"
content = content.replace(target2, replacement2, 1)

# 3. Update back pixels shading
target3 = "bpx[j] = o.r * k + tint[0] * 0.12; bpx[j + 1] = o.g * k + tint[1] * 0.12; bpx[j + 2] = o.b * k + tint[2] * 0.14; bpx[j + 3] = 255;"
replacement3 = """let br = o.r * k + tint[0] * 0.12, bg = o.g * k + tint[1] * 0.12, bb = o.b * k + tint[2] * 0.14;
        if (S.hasWaterline && y > S.waterY) {
          const dyw = y - S.waterY;
          const depthK = Math.min(0.72, Math.pow(dyw / 160, 0.85));
          const dt = S.waterDeep;
          br = br * (1 - depthK) + dt[0] * depthK * 0.7;
          bg = bg * (1 - depthK) + dt[1] * depthK * 0.8;
          bb = bb * (1 - depthK) + dt[2] * depthK * 0.9;
        }
        bpx[j] = br; bpx[j + 1] = bg; bpx[j + 2] = bb; bpx[j + 3] = 255;"""

assert target3 in content, "target3 not found"
content = content.replace(target3, replacement3, 1)

# Ensure CRLF line endings
content = content.replace('\r\n', '\n').replace('\n', '\r\n')
with open('js/terrain_visual.js', 'wb') as f:
    f.write(content.encode('utf-8'))
print("js/terrain_visual.js successfully updated!")
