// Preload: run project Playwright scripts with an available Chromium browser.
const Module = require('module');
const fs = require('node:fs');
const path = require('node:path');
const origLoad = Module._load;
let patched = false;
Module._load = function (request, parent, isMain) {
  const mod = origLoad.apply(this, arguments);
  if (request === 'playwright' && !patched) {
    patched = true;
    const launch = mod.chromium.launch.bind(mod.chromium);
    const candidates = [mod.chromium.executablePath()];
    if (process.platform === 'win32') {
      for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
        if (!root) continue;
        candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      }
      for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
        if (!root) continue;
        candidates.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      }
    }
    candidates.push('/opt/pw-browsers/chromium');
    const executablePath = process.env.CHROME || candidates.find(p => fs.existsSync(p));
    mod.chromium.launch = (opts = {}) => {
      const o = { ...opts };
      if (executablePath && !o.executablePath) {
        delete o.channel;
        o.executablePath = executablePath;
      }
      return launch(o);
    };
  }
  return mod;
};
