# Звуковые записи

Все файлы в этой папке распространяются под лицензией **CC0 1.0 Universal** (общественное достояние). Их можно использовать, изменять и распространять без ограничений. Файлы переименованы; содержимое не изменялось.

Источник сборки: [lavenderdotpet/CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds).

| Файлы | Исходный набор | Автор |
|---|---|---|
| shot1–3, revolver1–2, sniper1–2, shotgun2, cannon1–2, boom4, small1 | 25 CC0 bang SFX | набор «25-CC0-bang-sfx» из сборки выше |
| shotgun1, launch1–2, boom1–3, bounce1–2, rail, zap, ric1–2, switch | Warfork, `sounds/weapons` | Team Forbidden (Warfork), CC0 |
| metal0–3, wood0–3, stone0–3, stepGrass0–3, stepStone0–3, stepSnow0–3, stepWood0–3, land0–3, punch0–3 | Impact Sounds 1.0 | Kenney (www.kenney.nl), CC0 |
| splash1–2 | 100 CC0 SFX | набор «100-CC0-SFX» из сборки выше |
| thunder | 100 CC0 SFX 2 | набор «100-cc0-sfx-2» из сборки выше |

В игре записи проходят через пространственную обработку `js/audio.js`: стереопанораму, затухание с расстоянием, приглушение препятствиями и реверберацию. К взрывам добавляется синтезированный низкочастотный удар. Если запись не загрузилась, используется процедурный синтез.
