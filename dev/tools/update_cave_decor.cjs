'use strict';
const fs = require('node:fs');
let s = fs.readFileSync('js/terrain_visual.js', 'utf8');

// 1. In drawSurfaceDetails, define isCaveAt
const oldHead = '  const flatTop = (x, y) => T.isSolid(x - 2, y + 3) && T.isSolid(x + 2, y + 3);\r\n  const matAt = (x, y) => mat[y * W + x];';
const newHead = '  const flatTop = (x, y) => T.isSolid(x - 2, y + 3) && T.isSolid(x + 2, y + 3);\r\n  const matAt = (x, y) => mat[y * W + x];\r\n  const isCaveAt = (x, y) => y > 0 && !T.isSolid(x, y - 1) && T.back && T.back[(y - 1) * W + x] > 0;';

if (s.includes(oldHead)) {
  s = s.replace(oldHead, newHead);
  console.log('Added isCaveAt definition');
}

// 2. Suppress outdoor meadow grass on cave floors
const oldMeadow = 'if (y > waterY - 4 || y > beachY || matAt(x, y) !== 1 || !flatTop(x, y)) continue;';
const newMeadow = 'if (y > waterY - 4 || y > beachY || matAt(x, y) !== 1 || !flatTop(x, y) || isCaveAt(x, y)) continue;';

if (s.includes(oldMeadow)) {
  s = s.replace(oldMeadow, newMeadow);
  console.log('Updated meadow check');
}

// 3. Suppress meadow stems on cave floors
const oldStems = 'if (y > waterY - 4 || matAt(x, y) !== 1 || !flatTop(x, y) || hash3(x >> 3, 0, seed + 94) < 0.7 || rng() > 0.22) continue;';
const newStems = 'if (y > waterY - 4 || matAt(x, y) !== 1 || !flatTop(x, y) || isCaveAt(x, y) || hash3(x >> 3, 0, seed + 94) < 0.7 || rng() > 0.22) continue;';

if (s.includes(oldStems)) {
  s = s.replace(oldStems, newStems);
  console.log('Updated stems check');
}

// 4. Suppress cap blades on cave floors (second occurrence of oldMeadow)
if (s.includes(oldMeadow)) {
  s = s.replace(oldMeadow, newMeadow);
  console.log('Updated cap blades check');
}

// 5. Cave floor details
const caveBlock = [
  '  // --- Декоративная отделка пещер: кромка ±4 px, сколы углов, гравий и редкая трава/мох ---',
  '  if (T.back) {',
  '    const isCaveFloor = (x, y) => y > 0 && !T.isSolid(x, y - 1) && T.back[(y - 1) * W + x] > 0;',
  '    // 1. Сколы углов и микро-кромка ±4 px на уступах и полу пещер',
  '    for (let k = 0; k < tops.length; k += 2) {',
  '      const x = tops[k], y = tops[k + 1];',
  '      if (y > waterY - 4 || !isCaveFloor(x, y)) continue;',
  '      const mAt = matAt(x, y);',
  '      if (mAt !== 1 && mAt !== 2 && mAt !== 12 && mAt !== 3) continue;',
  '      if (hash3(x >> 2, y & 7, seed + 101) < 0.28) {',
  '        const cw = 3 + ((hash3(x, y, seed + 102) * 5) | 0);',
  '        const ch = 1.5 + hash3(x >> 1, y, seed + 103) * 2.5;',
  '        const dir = hash3(x, y, seed + 104) < 0.5 ? -1 : 1;',
  '        c.fillStyle = \'rgba(20,16,12,0.38)\';',
  '        c.beginPath();',
  '        c.moveTo(x - cw * 0.5, y + 0.5);',
  '        c.lineTo(x + cw * 0.5, y + 0.5);',
  '        c.lineTo(x + dir * cw * 0.2, y + ch);',
  '        c.closePath();',
  '        c.fill();',
  '        c.fillStyle = mAt === 2 ? \'#8a8276\' : mAt === 12 ? \'#746e62\' : \'#725e4c\';',
  '        c.beginPath();',
  '        c.moveTo(x - cw * 0.5, y);',
  '        c.lineTo(x + cw * 0.5, y);',
  '        c.lineTo(x + dir * cw * 0.1, y - ch * 0.7);',
  '        c.closePath();',
  '        c.fill();',
  '      }',
  '    }',
  '    // 2. Гравий и осыпи на полу пещер',
  '    const cavePebs = [\'#3e362e\', \'#4a4238\', \'#584e42\', \'#63594c\', \'#2c2620\', \'#6e6556\'];',
  '    for (let k = 0; k < tops.length; k += 2) {',
  '      const x = tops[k], y = tops[k + 1];',
  '      if (y > waterY - 4 || !isCaveFloor(x, y) || !flatTop(x, y)) continue;',
  '      if (rng() < 0.045) {',
  '        const grw = 1.2 + rng() * 2.8, grh = grw * (0.5 + rng() * 0.35);',
  '        const col = rng.pick(cavePebs);',
  '        c.fillStyle = \'rgba(10,8,6,0.35)\';',
  '        c.beginPath();',
  '        c.ellipse(x + 0.7, y + 1.2, grw * 1.15, grh * 0.6, 0, 0, TAU);',
  '        c.fill();',
  '        c.fillStyle = col;',
  '        c.beginPath();',
  '        c.ellipse(x, y - grh * 0.3, grw, grh, (rng() - 0.5) * 0.6, 0, TAU);',
  '        c.fill();',
  '        if (grw > 2.2) {',
  '          c.fillStyle = \'rgba(255,255,255,0.18)\';',
  '          c.fillRect(x - 0.5, y - grh * 0.6, 1, 0.8);',
  '        }',
  '      }',
  '    }',
  '    // 3. Подземный мох / трава с неравным шагом',
  '    let nextMossX = -1;',
  '    const mossCols = [\'#3a4e28\', \'#4c6232\', \'#5c743e\', \'#6e854a\'];',
  '    for (let k = 0; k < tops.length; k += 2) {',
  '      const x = tops[k], y = tops[k + 1];',
  '      if (x < nextMossX || y > waterY - 4 || !isCaveFloor(x, y) || !flatTop(x, y)) continue;',
  '      nextMossX = x + 18 + rng() * 36;',
  '      if (rng() < 0.4) {',
  '        const mw = 3 + rng() * 5, mh = 1.5 + rng() * 2;',
  '        c.fillStyle = \'rgba(10,14,6,0.25)\';',
  '        c.beginPath(); c.ellipse(x, y + 1, mw * 1.1, mh * 0.5, 0, 0, TAU); c.fill();',
  '        c.fillStyle = rng.pick(mossCols);',
  '        c.beginPath(); c.ellipse(x, y - mh * 0.3, mw, mh, 0, 0, TAU); c.fill();',
  '        const nb = 2 + ((rng() * 3) | 0);',
  '        c.strokeStyle = rng.pick(mossCols); c.lineWidth = 0.8;',
  '        for (let j = 0; j < nb; j++) {',
  '          const bh = 2.5 + rng() * 4.5, bx = x + (rng() - 0.5) * mw * 1.4;',
  '          c.beginPath(); c.moveTo(bx, y); c.lineTo(bx + (rng() - 0.5) * 2, y - bh); c.stroke();',
  '        }',
  '      }',
  '    }',
  '  }'
].join('\r\n');

const target = '    } else if (kind === \'crystals\' && rng() < 0.035) {\r\n      const len = 5 + rng() * 10; const col = rng() < 0.5 ? \'#5ff4ff\' : \'#ff6ef6\';\r\n      c.fillStyle = col; c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x + 2, y); c.lineTo(x + 1.5, y + len * 0.7); c.lineTo(x, y + len); c.lineTo(x - 1.5, y + len * 0.7); c.closePath(); c.fill();\r\n      c.fillStyle = \'rgba(255,255,255,0.6)\'; c.fillRect(x - 1, y, 0.8, len * 0.6);\r\n      if (gc) { gc.fillStyle = col; gc.globalAlpha = 0.6; gc.beginPath(); gc.arc(x, y + len * 0.5, 5, 0, TAU); gc.fill(); gc.globalAlpha = 1; }\r\n    }\r\n  }\r\n}';
const replacement = '    } else if (kind === \'crystals\' && rng() < 0.035) {\r\n      const len = 5 + rng() * 10; const col = rng() < 0.5 ? \'#5ff4ff\' : \'#ff6ef6\';\r\n      c.fillStyle = col; c.beginPath(); c.moveTo(x - 2, y); c.lineTo(x + 2, y); c.lineTo(x + 1.5, y + len * 0.7); c.lineTo(x, y + len); c.lineTo(x - 1.5, y + len * 0.7); c.closePath(); c.fill();\r\n      c.fillStyle = \'rgba(255,255,255,0.6)\'; c.fillRect(x - 1, y, 0.8, len * 0.6);\r\n      if (gc) { gc.fillStyle = col; gc.globalAlpha = 0.6; gc.beginPath(); gc.arc(x, y + len * 0.5, 5, 0, TAU); gc.fill(); gc.globalAlpha = 1; }\r\n    }\r\n  }\r\n' + caveBlock + '\r\n}';

if (s.includes(target)) {
  s = s.replace(target, replacement);
  fs.writeFileSync('js/terrain_visual.js', s, 'utf8');
  console.log('Successfully updated cave floor decor in terrain_visual.js');
} else {
  console.log('target not found');
}
