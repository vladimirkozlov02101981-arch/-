with open('js/render.js', 'rb') as f:
    content = f.read().decode('utf-8')

# 1. Update drawReflection loop
target1 = """    for (let k = 0; k < depth; k += band) {
      const q = 1 - k / depth, a = 0.42 * q * Math.sqrt(q), dx = (Math.sin(t * 1.6 + k * 0.05) * 0.8 + Math.sin(t * 2.7 + k * 0.17) * 0.45) * (1 + k * 0.03) * this.dpr;   // плавная рябь, отражение гаснет с глубиной
      c.globalAlpha = a; c.drawImage(this.reflCv, 0, depth - k - band, cv.width, band, dx, sy + k, cv.width, band);
    }"""

replacement1 = """    for (let k = 0; k < depth; k += band) {
      const q = 1 - k / depth, a = (0.08 + 0.38 * Math.pow(q, 1.4)) * (0.88 + 0.12 * Math.sin(t * 2.4 + k * 0.08));
      const dx = (Math.sin(t * 1.8 + k * 0.065) * 1.1 + Math.sin(t * 3.1 + k * 0.16) * 0.6 + Math.cos(k * 0.28 - t * 0.9) * 0.35) * (1 + (k / depth) * 1.1) * this.dpr;
      c.globalAlpha = Math.max(0, Math.min(1, a));
      c.drawImage(this.reflCv, 0, depth - k - band, cv.width, band, dx, sy + k, cv.width, band);
    }"""

# Normalize \r\n for matching
content_norm = content.replace('\r\n', '\n')
target1_norm = target1.replace('\r\n', '\n')
assert target1_norm in content_norm, "target1 not found in render.js"
content_norm = content_norm.replace(target1_norm, replacement1.replace('\r\n', '\n'), 1)

# 2. Update glints in drawLiquid
target2 = """      // рябь и солнечные блики: много коротких бликов у поверхности, сгущаются в «солнечную дорожку»
      const sunX = x0 + span * 0.72;
      for (let i = 0; i < 160; i++) {
        const gx = x0 + (((i * 137.5 + Math.floor(t * 0.8 + i * 0.37) * 57.3) % span) + span) % span, gy = wy + 3 + Math.pow((i * 7 % 23) / 23, 1.6) * 60;
        const near = Math.exp(-Math.pow((gx - sunX) / (span * 0.12), 2)), a = (0.12 + 0.55 * near) * (0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.7));
        c.fillStyle = rgba(L.glint || '#ffffff', a); c.fillRect(gx, gy, 3 + (i % 5) * 2 + near * 6, 1 + near * 0.6);
      }"""

replacement2 = """      // рябь и солнечные блики: прерывистые мерцающие эллиптические блики, сгущающиеся в солнечную дорожку
      const sunX = x0 + span * 0.72;
      const glintCol = hex2rgb(L.glint || '#ffffff');
      c.save();
      for (let i = 0; i < 170; i++) {
        const drift = t * (8 + (i % 7) * 2.2);
        const gx = x0 + (((i * 157.3 + drift) % span) + span) % span;
        const depthFrac = Math.pow((i * 11 % 31) / 30, 1.7);
        const waveY = wy + this.wave(gx, tt, (i % 5) * 0.8) * amp;
        const gy = waveY + 2 + depthFrac * 55;
        if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
        const sDist = (gx - sunX) / (span * 0.13);
        const nearSun = Math.exp(-sDist * sDist);
        const phase = t * (2.8 + (i % 4) * 0.9) + gx * 0.04 + i * 1.618;
        const shimmer = Math.sin(phase);
        if (shimmer < 0.15 && nearSun < 0.6) continue;
        const bright = Math.max(0, (shimmer - 0.15) / 0.85);
        const alpha = (0.10 + 0.65 * nearSun) * bright * (1 - depthFrac * 0.75);
        if (alpha <= 0.02) continue;
        const rw = (2.5 + (i % 6) * 1.8 + nearSun * 8) * (0.8 + 0.4 * bright);
        const rh = Math.max(0.6, (0.8 + nearSun * 0.8) * (0.6 + 0.5 * (1 - depthFrac)));
        c.fillStyle = `rgba(${glintCol[0]},${glintCol[1]},${glintCol[2]},${Math.min(1, alpha).toFixed(3)})`;
        c.beginPath();
        c.ellipse(gx, gy, rw, rh, Math.sin(gx * 0.02 + t) * 0.08, 0, TAU);
        c.fill();
        if (nearSun > 0.65 && bright > 0.82 && depthFrac < 0.25) {
          const sparkSize = 1.2 + (bright - 0.82) * 5;
          c.fillStyle = `rgba(255,255,255,${Math.min(0.95, alpha * 1.4).toFixed(2)})`;
          c.beginPath();
          c.arc(gx, gy, sparkSize, 0, TAU);
          c.fill();
        }
      }
      c.restore();"""

target2_norm = target2.replace('\r\n', '\n')
assert target2_norm in content_norm, "target2 not found in render.js"
content_norm = content_norm.replace(target2_norm, replacement2.replace('\r\n', '\n'), 1)

# Ensure CRLF line endings
final_content = content_norm.replace('\n', '\r\n')
with open('js/render.js', 'wb') as f:
    f.write(final_content.encode('utf-8'))
print("js/render.js successfully updated!")
