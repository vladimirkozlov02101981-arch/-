'use strict';
// Permanent artwork, loaded from the project. No round-dependent generation.
const MapArt = {
  images: new Map(),
  themeMap: { valley: 'valley', desert: 'canyon', arctic: 'arctic', volcano: 'volcano', alien: 'alien', tropical: 'pirate', castle: 'castles', city: 'city' },
  get(id) {
    if (!this.images.has(id)) {
      const img = new Image(); img.src = `assets/maps/${id}.png`; this.images.set(id, img);
    }
    return this.images.get(id);
  },
  softs: new Map(),
  /** дальний план с малой глубиной резкости: чуть размыт и сочнее — передний план «выходит» вперёд, как в CGI-мультфильмах */
  soft(id) {
    const img = this.get(id);
    if (!img.complete || !img.naturalWidth) return null;
    let s = this.softs.get(id); if (s) return s;
    const W = 1200, H = Math.round(img.height * W / img.width);
    s = makeCanvas(W, H); const c = s.getContext('2d');
    c.filter = 'blur(1.6px) saturate(1.16) contrast(1.03)'; c.drawImage(img, 0, 0, W, H); c.filter = 'none';
    this.softs.set(id, s); return s;
  },
  draw(c, id, w, h, pan = 0) {
    const img = this.soft(id);
    if (!img) return false;
    const k = Math.max(w / img.width, h / img.height) * 1.06;
    const dw = img.width * k, dh = img.height * k;
    c.drawImage(img, (w - dw) / 2 - Math.max(-w * .025, Math.min(w * .025, pan)), (h - dh) * .42, dw, dh);
    return true;
  }
};
