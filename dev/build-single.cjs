'use strict';
/* Сборка игры в один файл dist/Territory-War.html: скрипты, стили, шрифты, картинки и звуки встроены.
   Открывается двойным щелчком без Node.js (игра с компьютером и вдвоём на одном экране).
   Для игры по сети по-прежнему нужен сервер (Играть.cmd / Играть онлайн.cmd).
   Нужен запущенный сервер (npm start) — через браузер PNG-панорамы пережимаются в WebP. */
require('./tools/pw-chromium.cjs');
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const b64 = (p) => fs.readFileSync(path.join(root, p)).toString('base64');
const MIME = { '.ogg': 'audio/ogg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const dataUri = (p) => `data:${MIME[path.extname(p)]};base64,${b64(p)}`;

(async () => {
  const assets = {};
  // панорамы: PNG → WebP через canvas браузера (качество 0.95)
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' });
  try {
    const page = await browser.newPage(); await page.goto(process.env.TEST_URL || 'http://localhost:3000');
    for (const f of fs.readdirSync(path.join(root, 'assets/maps'))) {
      const p = 'assets/maps/' + f;
      if (f.endsWith('.png')) {
        assets[p] = await page.evaluate(async (src) => {
          const im = new Image(); im.src = src; await im.decode();
          const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0);
          return c.toDataURL('image/webp', 0.95);
        }, '/' + p);
      } else assets[p] = dataUri(p);
    }
    // исходные PNG сохраняют цвет, прозрачность и мелкие границы без потерь WebP
    const texDir = path.join(root, 'assets/tex');
    if (fs.existsSync(texDir)) for (const f of fs.readdirSync(texDir)) if (f.endsWith('.png')) {
      const p = 'assets/tex/' + f; assets[p] = dataUri(p);
    }
  } finally { await browser.close(); }
  // карты мелких деталей уже в WebP: сохраняем исходные пиксели без повторного сжатия
  const hiDir = path.join(root, 'assets/tex/hi');
  if (fs.existsSync(hiDir)) for (const f of fs.readdirSync(hiDir)) if (f.endsWith('.webp')) {
    const p = 'assets/tex/hi/' + f; assets[p] = dataUri(p);
  }
  const fineDir = path.join(root, 'assets/tex/fine');
  if (fs.existsSync(fineDir)) for (const f of fs.readdirSync(fineDir)) if (f.endsWith('.webp')) {
    const p = 'assets/tex/fine/' + f; assets[p] = dataUri(p);
  }
  // родной цвет высокого разрешения: WebP как есть, без повторного сжатия
  const nativeDir = path.join(root, 'assets/tex/native');
  if (fs.existsSync(nativeDir)) for (const f of fs.readdirSync(nativeDir)) if (f.endsWith('.webp')) {
    const p = 'assets/tex/native/' + f; assets[p] = dataUri(p);
  }
  const surfaceDir = path.join(root, 'assets/tex/surface');
  if (fs.existsSync(surfaceDir)) for (const f of fs.readdirSync(surfaceDir)) if (f.endsWith('.png')) {
    const p = 'assets/tex/surface/' + f; assets[p] = dataUri(p);
  }
  for (const f of fs.readdirSync(path.join(root, 'assets/sfx'))) if (f.endsWith('.ogg')) assets['assets/sfx/' + f] = dataUri('assets/sfx/' + f);

  // шрифты — прямо в CSS
  const fonts = read('css/fonts.css').replace(/url\(\.\.\/(assets\/fonts\/[^)]+)\)/g, (_, p) => `url(${dataUri(p)})`);
  let html = read('index.html');
  html = html.replace('<link rel="stylesheet" href="css/fonts.css">', `<style>${fonts}</style>`);
  html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>${read('css/style.css')}</style>`);
  html = html.replace(/<link rel="icon" href="assets\/favicon.svg"[^>]*>/, `<link rel="icon" href="${dataUri('assets/favicon.svg')}" type="image/svg+xml">`);
  // пути к ресурсам → встроенные данные
  const patch = {
    'js/art.js': [['img.src = `assets/maps/${id}.png`', 'img.src = ASSET(`assets/maps/${id}.png`)'], ['im.src = `assets/tex/${n}.png`', 'im.src = ASSET(`assets/tex/${n}.png`)'], ['im.src = `assets/tex/hi/${n}.webp`', 'im.src = ASSET(`assets/tex/hi/${n}.webp`)'], ['im.src = `assets/tex/fine/${n}.webp`', 'im.src = ASSET(`assets/tex/fine/${n}.webp`)'], ['im.src = `assets/tex/native/${n}.webp`', 'im.src = ASSET(`assets/tex/native/${n}.webp`)'], ['im.src = `assets/tex/surface/${n}.png`', 'im.src = ASSET(`assets/tex/surface/${n}.png`)']],
    'js/ui.js': [['url("assets/maps/${m.id}.png")', 'url("${ASSET(`assets/maps/${m.id}.png`)}")'], ['img.src = `assets/maps/${m.id}-thumb.webp`', 'img.src = ASSET(`assets/maps/${m.id}-thumb.webp`)']],
    'js/audio.js': [['fetch(`assets/sfx/${n}.ogg`)', 'fetch(ASSET(`assets/sfx/${n}.ogg`))']],
  };
  const boot = `<script>window.__ASSETS=${JSON.stringify(assets)};function ASSET(p){return window.__ASSETS[p]||p;}</script>`;
  html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, p, off) => {
    let src = read(p);
    for (const [a, b] of patch[p] || []) { if (!src.includes(a)) throw new Error(`${p}: не найдено ${a}`); src = src.split(a).join(b); }
    return (p === 'js/util.js' ? boot : '') + `<script>/* ${p} */\n${src.replace(/<\/script/gi, '<\\/script')}</script>`;
  });
  if (/src="js\//.test(html) || /href="css\//.test(html)) throw new Error('остались внешние ссылки');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const out = path.join(root, 'dist/Territory-War.html'); fs.writeFileSync(out, html);
  console.log(out, (fs.statSync(out).size / 1048576).toFixed(1) + ' MB');
})().catch(e => { console.error(e); process.exitCode = 1; });
