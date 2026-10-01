// Preload: run project Playwright scripts against the preinstalled Chromium instead of Google Chrome.
const Module = require('module');
const origLoad = Module._load;
let patched = false;
Module._load = function (request, parent, isMain) {
  const mod = origLoad.apply(this, arguments);
  if (request === 'playwright' && !patched) {
    patched = true;
    const launch = mod.chromium.launch.bind(mod.chromium);
    mod.chromium.launch = (opts = {}) => {
      const o = { ...opts };
      delete o.channel;
      o.executablePath = '/opt/pw-browsers/chromium';
      return launch(o);
    };
  }
  return mod;
};
