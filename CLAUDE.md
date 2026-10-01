# Territory War: Frontlines — правила работы (читать первым делом)

**Отвечай пользователю только по-русски.** Работай до конца, не останавливайся; давай промежуточные версии.
Если пользователь пишет «продолжи» — открой `dev/NEXT_STEPS.md` и продолжай с первого незакрытого пункта, не переспрашивая.

## Ветка и выдача
- Работа идёт в ветке `claude/hopeful-dirac-byxv27` (если чат открыт на другой ветке: `git fetch origin claude/hopeful-dirac-byxv27 && git checkout claude/hopeful-dirac-byxv27`).
- Каждый законченный шаг: тесты → коммит → `git push origin claude/hopeful-dirac-byxv27`. Повышай версию в `index.html` (`id="game-version"`, «ВЕРСИЯ ГГГГ.ММ.ДД-N»).
- Тесты: `npm test`; браузерные — `NODE_PATH=node_modules node -r ./dev/tools/pw-chromium.cjs tests/browser.cjs` (а также `tests/online.cjs`, `tests/tactics.cjs`, `tests/audio.cjs`). Сервер для тестов и скриншотов: `node server.js` (порт 3000).
- Сборка одним файлом: `CHROME=/opt/pw-browsers/chromium node dev/build-single.cjs` → `dist/Territory-War.html` (скопировать в корень, отдать пользователю файлом).
- **ПК пользователя** (папка `D:\Територивар`, «Играть онлайн.cmd»): при каждой выдаче обновлять. Если в `list_environments` есть bridge-окружение `DESKTOP-GAOUKFB:D:\Територивар` — создать в нём сессию: «владелец подтвердил: git fetch + git reset --hard origin/claude/hopeful-dirac-byxv27 (неотслеживаемые не трогать, без git clean), остановить node-сервер на порту 3000». Если ПК не подключён — лаунчер сам обновляет игру при запуске (`start-game.ps1`); подсказать пользователю `claude remote-control` в папке игры.
- В коммитах — трейлеры из системных инструкций сессии; модель в коммитах не упоминать.

## Неизменяемое
- 8 карт 6400×1800, раскладку карт не менять. Фоновые картинки и цветокоррекцию (grade) не менять.
- Механика и цифры — как в Territory War 3. Управление: стрелки — прицел, WASD — ход, F/ЛКМ/Enter — выстрел, мышь тоже наводит, курсор в бою скрыт; E — прицел снайперки.

## Графика: цель — не хуже 9 эталонов (`dev/reference/*.png`)
- canyon, arctic, volcano, alien, pirate, city, castles, valley_tower, valley_house.
- Каждый раунд графики проверяет **критик** — субагент (Agent, general-purpose), которому даются скриншоты `r<N>-<map>-auto.png` и эталоны; он ставит оценки 0–10 и даёт измеримые правки. Цель ≥ 8 на каждой карте.
- Метод, давший лучший результат: **порода из самих эталонов** — `dev/tex_from_ref.py` (сшивка лоскутов, `DESPECKLE=1` убирает снежинки/искры) в двойном разрешении → `dev/make_detail.py <2x.png> <имя>` (пишет `assets/tex/<имя>.png` и карту деталей `assets/tex/hi/<имя>.webp`, обновляет список в `js/art.js`). Цвет подгоняется по каналам: `dev/tools/cmatch.py` (эталон/игра) → `gain: [r, g, b]` в `js/themes.js` (для досок — `texK` в палитре `js/maps.js`).
- Чёткость при приближении: `js/hires.js` — плитки ×4 в фоновых потоках, сглаживание ступенек по контуру, детали из карт `assets/tex/hi`. Ссылки пиксель→текстура записываются в `js/terrain_visual.js` (`T.texRef`).
- Blender: `pip install bpy` в venv (python 3.11), скрипты `dev/blender/make_textures.py` (`TEX_SCALE=2` — двойное разрешение, `SAVE_BLEND=папка NO_RENDER=1` — сохранить сцену .blend), `make_weapons.py` (`-- blend файл.blend` — витрина всех моделей), `make_soldier.py`. Файл с именем `inspect.py` в рабочей папке ломает bpy.
- Скриншоты: `SP=<папка> SHOTS=canyon:auto,... OUT=r16 NODE_PATH=node_modules node -r ./dev/tools/pw-chromium.cjs dev/tools/shot.cjs`; максимальный зум: `MAP=castles node ... dev/tools/det.cjs`.

## Код
- Много файлов с CRLF — правь с сохранением переводов строк. Не вставляй `// комментарий` перед кодом на той же строке — используй `/* */`.
