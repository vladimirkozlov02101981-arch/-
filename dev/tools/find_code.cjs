const fs = require('fs');
const path = require('path');

const target = process.argv[2] || 'jet';
const re = new RegExp(target, 'i');
const dir = path.join(__dirname, '../../js');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const content = fs.readFileSync(path.join(dir, f), 'utf8');
  content.split('\n').forEach((l, i) => {
    if (re.test(l)) {
      console.log(`${f}:${i+1}: ${l.trim().slice(0, 160)}`);
    }
  });
}
