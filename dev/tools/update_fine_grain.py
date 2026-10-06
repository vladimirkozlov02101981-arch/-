with open('js/art.js', 'rb') as f:
    content = f.read().decode('utf-8')

target = """        const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, rgb = new Uint8Array(c.width * c.height * 3);
        for (let i = 0; i < c.width * c.height; i++) { rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2]; }
        const mw = Math.floor(c.width / 2), mh = Math.floor(c.height / 2), md = new Uint8Array(mw * mh * 3);
        for (let y = 0; y < mh; y++) for (let xx = 0; xx < mw; xx++) for (let channel = 0; channel < 3; channel++) {
          const a = (y * 2 * c.width + xx * 2) * 3 + channel, b = a + c.width * 3;
          md[(y * mw + xx) * 3 + channel] = Math.round((rgb[a] + rgb[a + 3] + rgb[b] + rgb[b + 3]) / 4);
        }
        this.fine[n] = { name: n, w: c.width, h: c.height, scale: 8, d: rgb, mip: { w: mw, h: mh, scale: 4, d: md } };"""

replacement = """        const c = makeCanvas(im.naturalWidth, im.naturalHeight), x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, rgb = new Uint8Array(c.width * c.height * 3);
        for (let i = 0; i < c.width * c.height; i++) {
          const lum = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
          rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = lum;
        }
        const mw = Math.floor(c.width / 2), mh = Math.floor(c.height / 2), md = new Uint8Array(mw * mh * 3);
        for (let y = 0; y < mh; y++) for (let xx = 0; xx < mw; xx++) {
          const a = (y * 2 * c.width + xx * 2) * 3, b = a + c.width * 3;
          const avg = (rgb[a] + rgb[a + 3] + rgb[b] + rgb[b + 3]) / 4;
          const val = Math.max(0, Math.min(255, Math.round(128 + (avg - 128) * 1.18)));
          const idx = (y * mw + xx) * 3;
          md[idx] = md[idx + 1] = md[idx + 2] = val;
        }
        this.fine[n] = { name: n, w: c.width, h: c.height, scale: 8, d: rgb, mip: { w: mw, h: mh, scale: 4, d: md } };"""

content_norm = content.replace('\r\n', '\n')
target_norm = target.replace('\r\n', '\n')
assert target_norm in content_norm, "target not found in art.js"
content_norm = content_norm.replace(target_norm, replacement.replace('\r\n', '\n'), 1)

with open('js/art.js', 'wb') as f:
    f.write(content_norm.replace('\n', '\r\n').encode('utf-8'))
print("js/art.js updated successfully!")
