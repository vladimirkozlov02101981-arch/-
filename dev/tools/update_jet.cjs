const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../js/draw.js');
let s = fs.readFileSync(file, 'utf8');

const startStr = "    case 'jet': {";
const endStr = "      break;\n    }";
const endStrCRLF = "      break;\r\n    }";

const idx = s.indexOf(startStr);
const endIdx = s.indexOf(endStrCRLF, idx) !== -1 ? s.indexOf(endStrCRLF, idx) : s.indexOf(endStr, idx);

if (idx === -1 || endIdx === -1) {
  console.error('Target not found', { idx, endIdx });
  process.exit(1);
}

const matchEnd = s.indexOf('}', endIdx) + 1;

const newJet = `    case 'jet': {
      c.scale(e.a > 1.5 || e.a < -1.5 ? -1 : 1, 1);
      c.scale(2.6, 2.6);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.drawImage(glowSprite('#ffaa3a'), -42, -5, 20, 10);
      c.drawImage(glowSprite('#ff5a1a'), -48, -4, 18, 8);
      c.restore();
      c.fillStyle = '#3a424e'; c.fillRect(-28, -6, 22, 5);
      c.fillStyle = '#262c35'; c.fillRect(-28, 1, 20, 4);
      c.fillStyle = '#4c5563'; c.beginPath(); c.moveTo(-16, -3); c.lineTo(-28, -18); c.lineTo(-18, -18); c.lineTo(4, -3); c.closePath(); c.fill();
      c.fillStyle = '#3f4754'; c.beginPath(); c.moveTo(-24, -2); c.lineTo(-34, -14); c.lineTo(-26, -14); c.lineTo(-18, -2); c.closePath(); c.fill();
      c.fillStyle = '#647082'; c.beginPath(); c.moveTo(-32, -4); c.lineTo(16, -5); c.quadraticCurveTo(32, -2, 36, 0); c.quadraticCurveTo(32, 2, 16, 4); c.lineTo(-32, 4); c.quadraticCurveTo(-35, 0, -32, -4); c.closePath(); c.fill();
      c.fillStyle = '#4a5361'; c.beginPath(); c.moveTo(-30, 0); c.lineTo(16, 1); c.quadraticCurveTo(30, 1, 35, 0); c.lineTo(16, 4); c.lineTo(-32, 4); c.closePath(); c.fill();
      c.fillStyle = '#ffd166'; c.fillRect(-6, -4, 3.5, 8);
      c.fillStyle = '#566070'; c.beginPath(); c.moveTo(-12, 1); c.lineTo(-24, 18); c.lineTo(-15, 18); c.lineTo(8, 2); c.closePath(); c.fill();
      c.fillStyle = '#2ecc71'; c.fillRect(-23, 17, 3, 2);
      c.fillStyle = '#a6d8ff'; c.beginPath(); c.moveTo(14, -4.5); c.lineTo(24, -3); c.lineTo(22, -1); c.lineTo(14, -1.5); c.closePath(); c.fill();
      c.fillStyle = '#ffffff'; c.fillRect(17, -3.5, 4, 1.2);
      c.strokeStyle = '#2d333b'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-14, 3.5); c.lineTo(6, 3.5); c.stroke();
      break;
    }`;

s = s.slice(0, idx) + newJet + s.slice(matchEnd);
fs.writeFileSync(file, s, 'utf8');
console.log('Successfully updated draw.js jet model');
