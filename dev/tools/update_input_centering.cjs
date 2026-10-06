const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../js/input.js');
let s = fs.readFileSync(file, 'utf8');

// 1. Update fireFast
const oldFireFast = `  fireFast(sc, cam, sw, sh, s, cmd, id) {
    const p = predictShot(sc, s, cmd.aim, id);
    if (!p || (cam.sees(p.x, p.y, sw, sh) && cam.sees(s.x, s.y - 20, sw, sh))) { this.send(cmd); return; }
    this.send({ c: 'look', x: Math.round(p.x), y: Math.round(p.y) });
    cam.shot = Object.assign(cam.shotFrame(s.x, s.y - 20, p.x, p.y, sw, sh), { t: 2.2 });   // свой экран не ждёт ответа хоста
    this.pendingShot = { cmd, t: 0, f: cam.shot, p };
  }`;

const newFireFast = `  fireFast(sc, cam, sw, sh, s, cmd, id) {
    const p = predictShot(sc, s, cmd.aim, id);
    const hasPan = !!(cam.manualActive || Math.abs(cam.offsetX || 0) > 3 || Math.abs(cam.offsetY || 0) > 3);
    if (!p || (!hasPan && cam.sees(p.x, p.y, sw, sh) && cam.sees(s.x, s.y - 20, sw, sh))) { this.send(cmd); return; }
    if (hasPan) {
      cam.manualActive = false;
      cam.offsetX = 0;
      cam.offsetY = 0;
    }
    this.send({ c: 'look', x: Math.round(p.x), y: Math.round(p.y) });
    cam.shot = Object.assign(cam.shotFrame(s.x, s.y - 20, p.x, p.y, sw, sh), { t: 2.2 });   // свой экран не ждёт ответа хоста
    this.pendingShot = { cmd, t: 0, f: cam.shot, p, fromPan: hasPan };
  }`;

s = s.replace(oldFireFast.replace(/\r?\n/g, '\r\n'), newFireFast.replace(/\r?\n/g, '\r\n'));
if (!s.includes('fromPan: hasPan')) {
  s = s.replace(oldFireFast.replace(/\r?\n/g, '\n'), newFireFast.replace(/\r?\n/g, '\n'));
}

// 2. Update pendingShot check
const oldPending = `      const seen = cam.sees(ps.p.x, ps.p.y, sw, sh, 0.14) && step < 7;`;
const newPending = `      const seen = !ps.fromPan && ps.p && cam.sees(ps.p.x, ps.p.y, sw, sh, 0.14) && step < 7;`;
s = s.replace(oldPending, newPending);

// 3. Update charge fire and instant fire
const oldChargeFire = `            if (!held) { this.send({ c: 'fire', aim: this.aim, pw: Math.max(0.06, this.power) }); this.cancelCharge(); }`;
const newChargeFire = `            if (!held) {
              const cmd = { c: 'fire', aim: this.aim, pw: Math.max(0.06, this.power) };
              const hasPan = !!(cam.manualActive || Math.abs(cam.offsetX || 0) > 3 || Math.abs(cam.offsetY || 0) > 3);
              if (hasPan) {
                cam.manualActive = false; cam.offsetX = 0; cam.offsetY = 0;
                const home = cam.soldierTarget ? cam.soldierTarget(s, sh) : { x: s.x, y: s.y - 20 };
                cam.shot = Object.assign({ x: home.x, y: home.y, z: cam.z }, { t: 2.2 });
                this.pendingShot = { cmd, t: 0, f: cam.shot, p: { x: s.x, y: s.y }, fromPan: true };
              } else {
                this.send(cmd);
              }
              this.cancelCharge();
            }`;

s = s.replace(oldChargeFire, newChargeFire);

const oldInstantFire = `          if ((mFire || kFire) && !this.pendingShot) { const cmd = { c: 'fire', aim: this.aim, pw: 1 }; if (typeof FAST_SHOT !== 'undefined' && FAST_SHOT[W.id] && cam.sees) this.fireFast(sc, cam, sw, sh, s, cmd, W.id); else this.send(cmd); }`;
const newInstantFire = `          if ((mFire || kFire) && !this.pendingShot) {
            const cmd = { c: 'fire', aim: this.aim, pw: 1 };
            const hasPan = !!(cam.manualActive || Math.abs(cam.offsetX || 0) > 3 || Math.abs(cam.offsetY || 0) > 3);
            if (typeof FAST_SHOT !== 'undefined' && FAST_SHOT[W.id] && cam.sees) {
              this.fireFast(sc, cam, sw, sh, s, cmd, W.id);
            } else if (hasPan) {
              cam.manualActive = false; cam.offsetX = 0; cam.offsetY = 0;
              const home = cam.soldierTarget ? cam.soldierTarget(s, sh) : { x: s.x, y: s.y - 20 };
              cam.shot = Object.assign({ x: home.x, y: home.y, z: cam.z }, { t: 2.2 });
              this.pendingShot = { cmd, t: 0, f: cam.shot, p: { x: s.x, y: s.y }, fromPan: true };
            } else {
              this.send(cmd);
            }
          }`;

s = s.replace(oldInstantFire, newInstantFire);

fs.writeFileSync(file, s, 'utf8');
console.log('Successfully updated input.js camera centering before shot');
