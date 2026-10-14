# Звуковые записи

Все файлы в этой папке, кроме `stepRock0–2` (CC BY 3.0, см. ниже), распространяются под лицензией **CC0 1.0 Universal** (общественное достояние). Их можно использовать, изменять и распространять без ограничений. Файлы переименованы; содержимое не изменялось.

Источник сборки: [lavenderdotpet/CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds).

| Файлы | Исходный набор | Автор |
|---|---|---|
| shot1–3, revolver1–2, sniper1–2, shotgun2, cannon1–2, boom4, small1 | 25 CC0 bang SFX | набор «25-CC0-bang-sfx» из сборки выше |
| shotgun1, launch1–2, boom1–3, bounce1–2, rail, zap, ric1–2, switch | Warfork, `sounds/weapons` | Team Forbidden (Warfork), CC0 |
| metal0–3, wood0–3, stone0–3, stepGrass0–3, stepStone0–3, stepSnow0–3, stepWood0–3, land0–3, punch0–3 | Impact Sounds 1.0 | Kenney (www.kenney.nl), CC0 |
| stepDirt0–2 | Footsteps on sand/gravel, freesound #319224 (через minetest_game) | worthahep88, CC0 |
| stepSnowR0–4 | Snow footsteps, freesound #94337 (через minetest_game) | Ryding, CC0 |
| stepMetal0–2 | Metal footsteps, freesound #398937 (через minetest_game) | mypantsfelldown, CC0 |
| stepBoard0–2, stepCrunch0–2 | Kenney audio packs (через Pixture) | Kenney, CC0 |
| stepRock0–2 | Footsteps, https://freesound.org/people/Erdie/sounds/41579/ (через minetest_game), перекодировано | **Erdie, CC BY 3.0** |
| splash1–2 | 100 CC0 SFX | набор «100-CC0-SFX» из сборки выше |
| thunder | 100 CC0 SFX 2 | набор «100-cc0-sfx-2» из сборки выше |

## Sonniss GDC 2026 Game Audio Bundle

Файлы `amb_*`, `boom5–9`, `nukeboom`, `ice0–1` вырезаны и сжаты из бесплатного набора [Sonniss GDC 2026](https://gdc.sonniss.com/) (лицензия: без указания авторства, можно использовать в играх; нельзя распространять сами записи как отдельную библиотеку звуков, нельзя использовать для обучения ИИ — https://sonniss.com/gdc-bundle-license/). Обработка — `dev/tools/sonniss_make.py`.

| Файлы | Запись | Автор |
|---|---|---|
| amb_wind, amb_snow | WINDDsgn_EXT, Eye Of The Storm | 344 Audio — Extreme Winds Vol. 1 |
| amb_sea | Medium Waves at Pebble Beach | Just Sound Effects — Rocky Coast of Norway |
| amb_lava | Fire Crackling, Popping, Witch's Cauldron | 344 Audio — Haunting Ambiences Vol. 5 |
| amb_meadow | Meadow Pipits, Insects, Wind through Grass | Just Sound Effects — Highlands of Norway |
| amb_city | City, Madrid, Soft Traffic and Human Activity | Sonik Sound Library — Urban Life |
| amb_space | Roomtone Space Ship Interior Muted | Cinematic Sound Design — Sci-Fi Drones |
| boom5–9 | Fireworks, powerful explosions, near | Ivo Vicic — Fireworks FX |
| ice0–1 | ice block snapping, surface cracking | Alexander Kopeikin — 100 kHz Designed Ice |

В игре записи проходят через пространственную обработку `js/audio.js`: стереопанораму, затухание с расстоянием, приглушение препятствиями и реверберацию. К взрывам добавляется синтезированный низкочастотный удар. Если запись не загрузилась, используется процедурный синтез.

## Прошлые наборы Sonniss GDC (2016, 2020, 2024) — оружие и взрывы

Те же условия лицензии (без указания авторства, не распространять записи отдельно). Нарезка — `dev/tools/guns_make.py`.

| Файлы | Запись | Автор |
|---|---|---|
| shot1–3 | M3 Grease Gun, single shots | Super Thump — M3 Grease Gun Recorded Source (2020) |
| shot4 | H&K 416 5.56, single shot | Audiobeast — The London Warehouse Firearms Library (2016) |
| revolver1–2 | Smith & Wesson M29 .44 Magnum | Pole Position Production (2016) |
| revolver3 | Colt Python .357 Magnum | Pole Position Production (2024) |
| sniper1 | SVD Dragunov 7.62×54R | Dramatic Cat (2024) |
| sniper2 | Barrett M98B .338 Lapua | Pole Position Production (2016) |
| sniper3, cannon2 | Lynx .50 Cal | Pole Position Production (2024) |
| shotgun1 | Saiga-12 | Dramatic Cat (2024) |
| shotgun2 | Remington 870 12g | Audiobeast (2016) |
| shotgun3 | 12 Gauge Shotgun, slug | TS Sound (2016) |
| cannon1 | Automatic Cannon MK44 | Fascinated Sound — The Gun Locker (2016) |
| boom10, nukeboom | Medium Realistic Explosion 15, Nuclear Explosion 07 | David Dumais — Explosion SFX Pack (2024) |
| boom11–12 | BigExplosion02, DeepExplosion02 | Stefano Cremona — Explosions (2020) |
