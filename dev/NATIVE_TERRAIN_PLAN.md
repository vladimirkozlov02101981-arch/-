# Следующий этап: исходный RGB грунта в детальной отрисовке

Статус на 2026-10-01: это согласованный план, реализация **не начата**. `js/art.js`, `js/hires.js` и `dev/build-single.cjs` ради native RGB не менялись. Прицел снайперки, управление мышью, fine-фактура, native-растительность и прочность материалов сохраняются в текущей игре. Root завершает версию14 с поправкой травяной шапки. Новый исходник грунта сначала проходит графическое принятие; затем этот план становится первым этапом следующего чата.

## Что ограничивает нынешнюю чёткость

`TexLib.data` хранит малую цветную текстуру. `HiResTerrain` интерполирует уже освещённый terrain1x, умножает его на серую карту `hi` и RGB-множитель `fine`. Эти множители добавляют поверхность, однако не восстанавливают подробную цветную границу крупного камня из малого исходника.

Сейчас `dirt_valley.png` имеет1024×1024, `hi/dirt_valley.webp`2048×2048, `fine/dirt_valley.webp`2048×2048. `hi` — серый множитель, `fine` — RGB-множитель вокруг128, а не исходный цвет. Новый Blender proof рассчитан на **2048×2048 RGB, период512 игровых единиц,4 исходных текселя на единицу**. TileS8 далее интерполирует этот4×исходник: он не превращает его в8×новые физические детали.

Proof лежит в `test-results/ground-sharp`; первые варианты с неудачными швами каменного материала помечены `*-with-joints.*`. Использовать только окончательный визуально принятый результат. Не принимать более зернистую поверхность за восстановление резких сколов.

## 1. Согласованная пара исходников

1. Принятый high2048 и low512 должны происходить из **одной сцены, одного кадра и одной палитры**. Low — area-downsample ровно4×4 исходных текселей high на каждый low-тексель. Сохранять декодированные пиксели без повторного lossy-сжатия.
2. Период high и low одинаковый:512world. Геометрия/раскладка карты, фон, grade, физические материалы и seed не меняются.
3. Для native metadata проверить `high.w === low.w * k`, `high.h === low.h * k`, одинаковый положительный scale `k`; начальный вариант `k=4`.
4. Нельзя делить terrain, запечённый из прежнего1024 другой сцены, на low512 новой сцены. Старые мягкие формы останутся в восстановленном освещении и дадут ореолы/двойные камни.
5. Включение native и замена production low выполняются вместе. После изменения пары создавать новую сцену/terrain и инвалидировать старые tiles. До визуального принятия production low не менять.

## 2. Формат и загрузка

Добавить отдельные `TexLib.native`, `nativeAvail`, `loadNative(name)`. Не менять смысл `hi`/`fine`. Изначально `nativeAvail` пуст; native-путь тестируется fixture или явным developer opt-in. Опциональный файл: `assets/tex/native/<name>.webp`, lossless RGB. После принятия можно включить сначала одну карту.

Main хранит `{name,w,h,scale,lowW,lowH,d:Uint8ArrayRGB}`. Загружать лениво только материалы нужной сцены. Canvas/ImageData нужны при декодировании; постоянный дополнительный full-size canvas не нужен. После создания RGB освободить декодирующий canvas, не удерживать Image/ImageData в объекте. Ограничить количество/байты main native source через LRU; исходный вариант допускает максимум два RGB2048 source,24MiB.

Текстура должна соответствовать уже загруженной low-паре. Непарные размеры, отсутствующий asset или отсутствие low дают обычный fallback. При появлении ready native увеличить revision/count и очистить hires tiles через существующий epoch. Missing-native не должен ломать старую отрисовку или запуск сцены. Не загрузить все новые full RGB eagerly.

## 3. Освещение и реконструкция цвета

Расчёт в том же encoded RGB пространстве, что существующий bake. Введение linear-light/sRGB преобразований — отдельное изменение, сейчас оно изменило бы согласованные цвета карты.

Для каждого low-пикселя `(gx,gy)` нужного reference-id:

```
C_c = актуальный baked low terrain RGB, unpremultiplied
D_c = paired low texture RGB в её исходной выборке
L_c[gx,gy] = C_c / D_c
finalRGB_c(wx,wy) = nativeRGB_c(wx,wy) * interpolatedL_c(wx,wy)
```

`c` — R/G/B отдельно. Это сохраняет различия тёплого/холодного света и использует настоящий цвет high вместо умножения старого мягкого RGB на серую детализацию. Для native-id старые `hi`/`fine` отключить в первом сравнении: старый `hi` другой сцены и дополнительная fine-зернистость могут скрыть качество нового исходника. Для остальных id сохранить старую ветку.

В тёмных каналах нельзя безусловно делить на0 или очень малое значение. Регуляризовать denominator/ratio и проверить это тестом: для канала с очень малым D использовать устойчивый локальный коэффициент яркости/соседний коэффициент, без NaN/Infinity и цветного выброса. Предел коэффициента выбрать по фактическому bake и сравнениям, не обрезать нормальный gain карты произвольным узким диапазоном. Для нормальных D требуется точная C/D пара. Alpha не участвует в освещении как цвет; getImageData даёт unpremultipliedRGB, worker premultiplied-путь обрабатывает alpha отдельно.

Интерполировать L bilinear по low-grid, только внутри одинакового rid и непрозрачных соседей; при дополнительном сглаживании использовать маску/нормализацию веса. Предпочтительно лёгкое сглаживание не больше1world, не широкое усреднение теней. Source sharpening0.55 и additive-коррекции текущего bake способны оставить остаток албедо в C/D. Поэтому этот L — приближение сохранённого освещения, не физически точное выделение света.

Особенно проверить: тени под травой, цветные корни/потёки, холодный пещерный tint, подсветку кромок, ранее наложенный decor и scorch. Не размывать эти поправки в соседний материал. Если C/D явно недостаточно для additive marks, ограничить eligibility/fallback в таких местах либо хранить освещение/остаточный цвет отдельным bake-полем; не скрывать дефект дополнительным шумом.

## 4. Согласование координат и центров текселей

Production `texAt` использует `(x|0,y|0)` перед modulo. Для неотрицательных integer source-координат это равно floor; при отрицательных дробях это **truncation**, не floor. `texRefId` сохраняет округлённые offset и нормализует их в положительный период. Новую выборку задавать явно и проверять отрицательные/дробные offsets fixture; не переносить незаметно эту неоднозначность в production.

Low-тексель, взятый при integer world `(gx,gy)`, представлен центром `(gx+.5,gy+.5)`. Для согласованной пары с integer offset:

```
lowX = wrap(floor(gx + dx), lowW)
lowY = wrap(floor(gy + dy), lowH)
wrap(a,W) = ((a % W) + W) % W
```

Текущие worker constants: `T=128`, input padding `P=3`, output gutter `G=1`, output scale `S=4/8`.

```
wx = tx*T - G + (X+.5)/S
wy = ty*T - G + (Y+.5)/S
lightingU = P - G + (X+.5)/S - .5
lightingV = P - G + (Y+.5)/S - .5
nativeHX = (wx + dx)*k - .5
nativeHY = (wy + dy)*k - .5
```

Последнее `-.5` означает bilinear-выборку по центрам native-текселей. Важно не смешивать centre и corner sampling: полутексельный сдвиг даёт мягкую или смещённую границу даже у хорошего исходника. Native metadata period/scale проверять против **paired** low размеров, не против прежнего low.

## 5. Ограниченные циклические crops main→worker

Не отправлять полный RGB high каждому worker. Main собирает только source-участки для выходной world-плитки130×130, включая её gutter и halo для bilinear.

```
cropHX0 = floor((tx*T - G + dx)*k - .5)
cropHY0 = floor((ty*T - G + dy)*k - .5)
cropW = ceil((T+2*G)*k) + 2
cropH = ceil((T+2*G)*k) + 2
```

При `k4` это522×522 RGB. Worker выбирает по `(nativeHX-cropHX0,nativeHY-cropHY0)`. Origin хранится в ненормализованных координатах; source-copy выполняется циклически через `wrap`. Переход через левый/верхний/правый/нижний край source обрабатывается row subarray copies, разбитыми на части до конца source-строки; поддержать обе оси и отрицательные origins. Не накладывать blur отдельно на обрезанный crop и не делать resize crop средствами canvas.

Packet содержит crop metadata/ArrayBuffer и low lighting field134²×3Float32 (один общий field на task достаточно, поскольку каждый low-пиксель имеет один выбранный rid). При нескольких native rid/offset нужны отдельные crops с общим lighting field. Transfer buffers текущему worker; main не сохраняет переданные detached arrays. После задачи worker не удерживает crop/full high в persistent cache. У существующего `HI/FINE` cache свой старый путь; новый native cache там не добавлять.

Держать не более четырёх активных worker-задач, лимит crop bytes на packet и суммарно in-flight. Начальная рекомендация:≤2MiB crops/task и≤8MiB crops in-flight; дополнительный rid сверх лимита получает baked fallback. Main native sources≤24MiB. Лимит проверять до выделения большого packet. Старые `hi/fine` для native-материала не отправлять ещё раз. Их уже существующие caches при смене карт — отдельный прежний расход памяти; не считать его автоматически устранённым этим планом.

### Точная дополнительная память

| Буфер | Байты | MiB |
|---|---:|---:|
| Main RGB2048 |12,582,912|12|
| Full RGB2048 main +4 worker-копии (не выбранный путь) |62,914,560|60|
| Full RGB4096 main +4 worker-копии (не выбранный путь) |251,658,240|240|
| Один RGB crop522² |817,452|0.77958|
| Четыре RGB crop522² |3,269,808|3.11833|
| Один lighting134²×3Float32 |215,472|0.20549|
| Четыре lighting fields |861,888|0.82196|
| Main source +4 crops +4 lighting, один материал |16,714,608|15.94029|
| Paired low512: RGBA data +canvas |2,097,152|2|
| Decode canvas2048 (временный, без учёта decoder) |16,777,216|16|

Это дополнительная CPU-память native-пути. Нынешние output tiles остаются ограничены160MiB: один S4 tile520²RGBA1,081,600bytes≈1.0315MiB, S8 tile1040²RGBA4,326,400bytes≈4.126MiB. Нынешний worker использует ещё11 Float32 input134² массивов,790,064bytes≈.7535MiB/task, исходныйRGBA+ref89,780bytes≈.0856MiB/task. Decoder/ImageData/GPU copies, base terrain/decor, standalone base64 и существующие hi/fine caches учитываются отдельно. Две fine2048 RGB с1024mip, main+4workers, способны занимать150MiB только typed arrays; общий renderer limit160MiB их не покрывает.

## 6. Eligibility, пещеры, разрушения и ошибки

- Начать с принятого dirt-материала одной карты. Остальные текстуры и неготовые native сохраняют прежнюю отрисовку.
- Сохранять current alpha, material/ref выбор, contour CO/NX/NY, glow и output gutter. Native заменяет только RGB подходящего непрозрачного однородного участка; на mixed-id/transparent соседях работает baked contour path. Не интерполировать свет одного материала в другой.
- У refF/refB разные роли: solid→foreground, air с задней стеной→background. После blast нельзя показывать foreground high через дырку; если появилась back-wall, её texture-id/освещение выбираются заново. Не применять dirt native к пещерной wall, если для wall нет своей согласованной пары.
- Ratio строится из свежего baked canvas после carve/scorch, а не первоначальной сцены. Mask/alpha остаются авторитетными. Почернение scorch нельзя отменять заменой high source, уничтоженные пиксели не должны возвращаться.
- Сохранять tile generation/epoch, stale result rejection, invalidation при загрузке материала/scale и touches. Crop из старого epoch не применить после смены карты/разрушения.
- Сейчас `wk.onerror` только снимает idle и может оставить pending. При изменении worker-пути ошибки не скрывать: лог/диагностика, убрать соответствующий pending, освободить job, завершить/заменить неисправный worker либо безопасно оставить обычную отрисовку. Обработать `onmessageerror`, не получать бесконечный pending или молчаливый цикл падений.

## 7. Meaningful проверки и сборка

Добавить самостоятельный native regression fixture или расширить `tests/hires.cjs`, используя настоящий worker и Chromium Canvas на isolated developer HTTP origin. Не использовать вкладку пользователя или file://. Проверки:

1. Neutral matched source сохраняет baked RGB, slow различный R/G/B свет правильно умножает high; нет NaN/выбросов при near-black denominator.
2. Настоящие разноцветные субпиксельные контуры high читаются приS4/S8; source/low centre pairing исключает half-texel phase shift.
3. Periodic wrap, четыре края, углы, negative origins, offsets и дробная phase. Adjacent tiles имеют одинаковые gutter pixels приS4/S8; noninteger camera zoom не создаёт grid/seam.
4. Материальные/alpha transitions: сохранение прежнего silhouette и отсутствие color bleed; missing-native/metadata mismatch дают обычный прежний fallback.
5. Разрушение/scorch, foreground→back-wall, alpha holes, поддержка нового epoch; намеренно задержанный старый результат не применяется.
6. Проверить packet bytes/число задач: ни один postMessage не содержит full2048/4096 RGB; переданные crops detach в main; worker после задач не сохраняет fullRGB source/crops. Лимит packet/in-flight соблюдается, excess-id fallback безопасен.
7. Worker error fixture не остаётся в pending и сообщает ошибку. Все existing hires/surface и sniper tests должны продолжать проходить.
8. Одинаковые fixed scene/camera до/после при2.5× и6.35×: крупные сколы, цвет, шапка, корни, пещеры, scorch, tile seams. Считать выигрыш макроконтуров отдельно от зернистости; критик сравнивает с исходными фото.

В `dev/build-single.cjs` добавить raw lossless embedding `assets/tex/native/*.webp` и точный ASSET patch нового loader. Fail-fast, если исходная строка patch не найдена. После сборки isolated single HTML smoke: все внешние HTTP requests abort иassert0, встроенный native побайтово равен production asset, ready native/paired-low metadata, maxzoom worker, sniper real mouse+shot, ошибки0. Не повторно сжимать high через canvas/WebP при сборке.

## Порядок следующего чата

1. Прочитать актуальные `CLAUDE.md`, `dev/NEXT_STEPS.md`, этот план и результаты последнего графического proof. Подтвердить актуальную ветку/изменения, сохранить снайперку и version14.
2. Завершить графическое принятие нового source с резкими сколами и правильным материалом; не включать rejected proof.
3. Реализовать loader/crops/native worker/tests с пустым nativeAvail и developer fixture. Не менять production low до прохождения проверки.
4. После fixturePASS включить одну approved matched pair, снять игровые before/after и дать независимую оценку.
5. Устранить цвет/lighting/edge/cave/scorch regressions и измерить память/время. Только затем распространять на другие материалы/карты.
6. Выполнить требуемые проверки, standalone isolated smoke, обновить описание реальной детализации/план, commit/push и передать проверенный файл по правилам репозитория.
