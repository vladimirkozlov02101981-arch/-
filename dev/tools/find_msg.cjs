const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../../js');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const content = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, i) => {
    if (/стрел|огонь|атак|ход|Ход|Ваш|ваш|фаз|очеред/i.test(l)) {
      if (l.includes('banner') || l.includes('msg') || l.includes('status') || l.includes('toast') || l.includes('tip') || l.includes('hud') || l.includes('turn') || l.includes('notice')) {
        console.log(`${f}:${i+1} ${l.trim()}`);
      }
    }
  });
}
