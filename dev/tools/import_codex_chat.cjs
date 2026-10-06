const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const codexPath = 'C:/Users/black/.codex/sessions/2026/10/03/rollout-2026-10-03T10-27-43-01a100a9-6261-7301-8026-2a4fb4c5b9bb.jsonl';
const outDir = path.join(__dirname, '../../dev/imported-chat/chatgpt-codex');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log('Reading session file...');
const raw = fs.readFileSync(codexPath, 'utf8');
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
const lines = raw.split('\n');

const transcriptLines = [
  '# Переписка ChatGPT Codex — «Игровые механики и баланс: продолжить територивар»',
  '',
  `**Дата сессии**: 2026-10-03 — 2026-10-05  `,
  `**Идентификатор сессии**: \`01a100a9-6261-7301-8026-2a4fb4c5b9bb\`  `,
  `**Исходный файл**: \`${codexPath}\`  `,
  `**SHA-256**: \`${sha256}\`  `,
  `**Всего строк в исходном JSONL**: ${lines.length}`,
  '',
  '---',
  ''
];

let turnIndex = 1;
let userCount = 0;
let assistantCount = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  try {
    const o = JSON.parse(line);
    if (o.type === 'response_item') {
      const payload = o.payload;
      if (!payload) continue;
      if (payload.role === 'user') {
        const contents = (payload.content || []).filter(c => c.type === 'input_text').map(c => c.text);
        for (const text of contents) {
          if (!text || text.startsWith('<external_codex_apps') || text.startsWith('# AGENTS.md instructions') || text.startsWith('Planned action') || text.startsWith('The following is the Codex agent history') || text.startsWith('Assess the exact') || text.startsWith('Reviewed Codex session')) continue;
          userCount++;
          transcriptLines.push(`### Пользователь (шаг ${turnIndex++})`);
          transcriptLines.push('');
          transcriptLines.push(text.trim());
          transcriptLines.push('');
        }
      } else if (payload.role === 'assistant') {
        const contents = (payload.content || []).filter(c => c.type === 'output_text').map(c => c.text);
        for (const text of contents) {
          if (!text.trim()) continue;
          assistantCount++;
          transcriptLines.push(`### Codex (ассистент)`);
          transcriptLines.push('');
          transcriptLines.push(text.trim());
          transcriptLines.push('');
        }
      }
    } else if (o.type === 'event_msg') {
      if (o.payload?.type === 'agent_error' || (o.payload?.type === 'task_completed' && o.payload?.status === 'error')) {
        transcriptLines.push(`> [!WARNING] **Системное событие**: ${o.payload?.message || o.payload?.error || 'Ошибка исполнения'}`);
        transcriptLines.push('');
      }
    }
  } catch (e) {}
}

fs.writeFileSync(path.join(outDir, 'transcript.md'), transcriptLines.join('\n'), 'utf8');

const contextContent = `# Контекст импорта ChatGPT Codex

Дата импорта: 05.10.2026.
Источник: сессия ChatGPT Codex \`01a100a9-6261-7301-8026-2a4fb4c5b9bb\` (\`rollout-2026-10-03T10-27-43-01a100a9-6261-7301-8026-2a4fb4c5b9bb.jsonl\`).

## Краткая хронология и результаты работы Codex
- **03.10.2026**: создание изолированной копии \`D:\\Територивар1\`, доработка управления, нумерации бойцов, прицелов и текстов.
- **Версии 29, 30, 31**:
  - Настройка первого хода независимо от стороны карты (random, team1, team2).
  - Устранение артефактов ходьбы раненых без дрожи корпуса.
  - Камера: устранение рывков при зуме и стрелках, слежение за атаками, отпускание ПКМ-бинокля плавно догоняет снаряд.
  - Учёт дыма, искр, осколков и могилок после атаки.
- **Прерывание сессии (05.10.2026)**:
  В момент финального запроса пользователя о доработке HUD (убрать «Действие…» и «Отступайте!», профессиональный дизайн плашки смены хода, убрать иконки арсенала/меню, вернуть крупный самолёт-бомбардировщик, центровка до выстрела при сдвиге стрелками, оптимизация задержки после атаки) сессия Codex остановилась из-за исчерпания недельного лимита («You’ve hit your usage limit»).

## Передача в текущий чат (Antigravity)
Все требования пользователя из последнего сообщения Codex подхвачены, импортированы и завершаются в данной копии с последующим переносом в основную папку \`D:\\Територивар\`.
`;

fs.writeFileSync(path.join(outDir, 'CONTEXT.md'), contextContent, 'utf8');

const manifest = {
  importedAt: new Date().toISOString(),
  sessionId: '01a100a9-6261-7301-8026-2a4fb4c5b9bb',
  sourceFile: codexPath,
  sha256: sha256,
  fileSize: fs.statSync(codexPath).size,
  userMessagesCount: userCount,
  assistantMessagesCount: assistantCount,
  totalLines: lines.length
};

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log('Import completed successfully:', manifest);
