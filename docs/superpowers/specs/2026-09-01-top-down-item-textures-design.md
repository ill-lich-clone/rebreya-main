# Уникальные top-down текстуры предметов

**Дата:** 2026-09-01
**Статус:** письменная спецификация подтверждена пользователем
**Среда:** Foundry VTT 13, dnd5e
**Владелец runtime-поведения:** существующий storage/ground-pile контур

## 1. Наблюдаемый результат

Когда управляемый предмет Rebreya из инвентаря выкладывают на сцену через существующий ground-pile workflow, одиночный ground-pile токен использует отдельное изображение этого предмета строго сверху.

- Каждый канонический `gearId` получает собственный top-down ассет.
- Каждый канонический `materialId` получает собственный top-down ассет.
- Рапира и длинный меч, разные виды боеприпасов, материалы и прочие визуально различимые записи не разделяют один ассет.
- Обычная `Item.img` в компендиуме, инвентаре и листах не меняется.
- Несколько предметов в одной куче продолжают использовать существующие category/mixed pile textures без изменения правил.
- Неизвестный Item, Item из другого компендиума, повреждённые identity flags или отсутствующий top-down ассет используют текущий fallback.
- Сундуки, бочки, монеты, журнальные записи и встроенные storage presets сохраняют текущие текстуры и поведение.

## 2. Канонический объём

Живой лист `Общий компендиум снаряжения V0.1` содержит диапазон `A1:N830`:

- 1 строку заголовка;
- 1 пустую строку;
- 828 предметных строк;
- 83 строки типа `Скакуны и транспорт`, которые существующий импортёр намеренно отделяет от Item-каталога;
- 745 строк, импортируемых в `data/gear.json` с уникальными `gearId`.

Лист `Энциклопедия материалов` содержит 272 заполненные строки:

- 2 строки заголовков;
- 270 материалов, импортируемых в `data/materials.json` с уникальными `materialId`.

Текущий обязательный объём — **1015 уникальных ассетов**:

- 745 `gearId`;
- 270 `materialId`.

83 записи транспорта не входят в эту задачу: они не являются Item с `gearId`, не проходят через Item ground-pile workflow и принадлежат отдельному transport pipeline. Если в будущем новый канонический Item появится в `data/gear.json` или `data/materials.json`, проверка покрытия должна завершаться ошибкой до добавления отдельного ассета.

## 3. Границы задачи

### Входит

- Новый manifest уникальных top-down ассетов.
- Пакетный atlas pipeline 5×5.
- Детерминированная нарезка, удаление фона, нормализация и проверки ассетов.
- Чистый runtime-resolver `gearId`/`materialId` → token texture.
- Подключение resolver только к презентации одиночного обычного ground-pile предмета.
- Focused-тесты runtime-выбора, fallback и сохранения существующего поведения.
- Live QA GM и player workflow.
- Обновление паспорта функций, версии модуля и versioned forwarder при реализации.

### Не входит

- Замена `Item.img`.
- Изменение картинок Item в компендиуме, инвентаре или листах.
- Top-down ассеты транспортных Actor-документов.
- Top-down ассеты существ, черт, заклинаний или магических предметов вне канонических gear/material каталогов.
- Новый canvas-drop hook или параллельный ground-pile workflow.
- Изменение правил нескольких предметов, монет, журналов или storage presets.
- Автоматическая массовая миграция существующих токенов сцены.

## 4. Рассмотренные подходы

### 4.1. Уникальный ассет на каждый ID — выбран

Преимущества:

- сохраняет визуальную разницу между близкими предметами;
- позволяет отдельно изображать каждый тип оружия и боеприпаса;
- создаёт полноценный второй визуальный слой канонического снаряжения;
- детерминированно связывается со stable ID.

Цена: 1015 итоговых файлов, 41 первичный atlas и обязательный пакетный QA.

### 4.2. Ассеты по визуальным семействам — отклонён

Уменьшает объём генерации, но стирает разницу между предметами одного семейства и не удовлетворяет требованию отдельного изображения на каждый ID.

### 4.3. Гибрид уникальных и семейных ассетов — отклонён

Сокращает объём работы, но оставляет часть канонического каталога без собственной визуальной идентичности. Семейный fallback разрешён только в уже существующей презентации многопредметных куч, а не для одиночных канонических Item.

## 5. Результаты pilot spike

До фиксации дизайна pipeline был проверен на manifest из 25 записей разных классов: оружие, боеприпасы, доспех, контейнеры, инструменты, расходники и материалы.

Пилот дал следующие результаты:

- FFmpeg, ImageMagick и rembg доступны в рабочей среде;
- первая atlas-генерация была полностью отклонена: значительная часть объектов имела фронтальный или трёхчетвертной ракурс вместо top-down;
- запрос прозрачности непосредственно у генератора дал непрозрачный baked checkerboard и не может считаться alpha pipeline;
- удаление фона со всего atlas одновременно повреждало светлые и тонкие предметы;
- рабочий порядок — сначала фиксированная нарезка, затем matting каждой ячейки отдельно;
- chroma key даёт более предсказуемый край, чем rembg, когда цвет фона не пересекается с палитрой предмета;
- даже после усиления top-down prompt 18 из 25 ячеек прошли техническую проверку исходного bbox, а 7 были отклонены из-за пересечения безопасных gutters;
- техническая валидность размера и alpha не обнаруживает неверный угол камеры, поэтому отдельный visual camera gate обязателен.

Pilot-файлы являются исследовательскими артефактами и не входят в production manifest. Ни одна pilot-ячейка не считается готовым ассетом без повторного прохождения утверждённого pipeline.

## 6. Существующий data flow и владельцы

Существующий маршрут должен быть расширен, а не продублирован:

1. `scripts/integrations/storage-transfer-drop.js` принимает существующий canvas drop и вызывает `dropStorageItemToScene`.
2. `scripts/main.js` оставляет GM-операцию локальной либо передаёт player-операцию через существующий typed socket route активному GM.
3. `scripts/data/storage-command-service.js` авторизует отправителя, разрешает канонический источник, готовит durability, списывает Item с rollback и вызывает ground-pile service.
4. `scripts/data/storage-ground-pile-service.js` остаётся единственным владельцем world-state ground piles, очередей сцены, `mutationId`, merge, create/update/delete и token texture mutation.
5. `scripts/data/storage-pile-presentation.js` синхронно и без world mutation вычисляет имя, texture и category presentation.

`scripts/integrations/storage-token-drop.js` продолжает обслуживать существующее перемещение/пополнение storage-токенов и не становится владельцем нового canvas workflow. `scripts/integrations/storage-ground-pile-frame.js` продолжает только удалять устаревшие Sequencer frames.

## 7. Manifest и структура ассетов

### 7.1. Источник истины

Отслеживаемый JSON manifest является источником истины для asset pipeline. Предлагаемый путь:

`data/top-down-item-assets.json`

Manifest имеет `schemaVersion: 1` и содержит для каждой канонической записи:

- `sourceType`: `gear` или `material`;
- `sourceId`: стабильный `gearId` или `materialId`;
- `name`;
- `sourceRef` при наличии;
- краткое визуальное описание, полученное из канонической записи и вручную уточнённое при необходимости;
- `scaleClass` для согласованного визуального масштаба;
- стабильные `atlasId` и `cellIndex`;
- generation prompt/hash;
- способ удаления фона;
- итоговый `assetPath`;
- хеш итогового файла;
- технический и визуальный QA-статус.

Manifest должен поддерживать безопасный повторный запуск:

- принятые записи не генерируются и не перезаписываются без явного `--force`;
- изменившийся prompt/input hash переводит запись в состояние повторной обработки;
- отклонённые ячейки попадают в отдельные retry-atlases;
- batch/cell assignments принятых записей не перераскладываются при добавлении новых ID;
- частично завершённый batch можно продолжить после остановки.

### 7.2. Итоговые пути

Предлагаемая структура:

```text
assets/top-down/items/gear/<gearId>.webp
assets/top-down/items/material/<materialId>.webp
```

Путь строится только из проверенного стабильного ID. Manifest запрещает:

- повтор одного ключа `sourceType:sourceId`;
- повтор одного `assetPath`;
- отсутствие канонического ID;
- лишний активный ID, которого нет в канонических каталогах;
- побайтово одинаковый принятый ассет для разных ID.

### 7.3. Runtime-каталог

Presentation resolver должен быть синхронным, поэтому runtime не загружает manifest через `fetch` во время drop.

Build tool детерминированно генерирует компактный ESM-каталог, например:

`scripts/data/top-down-item-texture-catalog.js`

Он содержит только принятые пары `gear:<id>`/`material:<id>` → module asset path. Тест проверяет, что generated catalog полностью соответствует manifest; вручную его не редактируют.

## 8. Генерация и обработка atlas

### 8.1. Batch layout

- Первичная выборка: 41 atlas 5×5 — 40 полных и один на 15 записей.
- Каждая запись имеет фиксированный `cellIndex` от 0 до 24.
- Ячейки имеют одинаковый размер и безопасную внутреннюю область.
- Между объектами обязательно остаются gutters.
- Неиспользуемые ячейки последнего atlas явно помечаются пустыми в batch plan.
- Исходный atlas перед нарезкой приводится к фиксированному квадратному размеру, делящемуся на пять без остатка.

### 8.2. Визуальный контракт

Стиль наследует текущие `assets/storage/piles/*.png`:

- реалистичное детализированное тёмное фэнтези;
- натуральные металл, дерево, ткань, кожа, камень и стекло;
- читаемый силуэт;
- единая световая модель и детализация;
- без текста, подписей, рамок и декоративных карточек.

Требование top-down является геометрическим, а не стилистическим:

- оптическая ось камеры строго перпендикулярна плоскости земли;
- нет горизонта, фронтального или трёхчетвертного ракурса;
- предмет лежит на земле либо показан своей естественной верхней плоскостью;
- бутылки, фонари, доспехи, мешки и инструменты не стоят вертикально;
- бочка сверху читается как круглая верхняя плоскость;
- сундук или ящик показывается крышкой сверху;
- оружие и боеприпасы лежат плоско;
- тени и свечение не выходят за безопасную область ячейки;
- ни один пиксель объекта не пересекает соседнюю ячейку.

### 8.3. Нарезка и alpha

Порядок обработки фиксирован:

1. Нормализовать atlas к известному размеру.
2. Нарезать его по математически вычисленным координатам через FFmpeg или ImageMagick.
3. Обрабатывать фон отдельно для каждой ячейки.
4. Основной путь — chroma key на контрастном однотонном фоне, выбранном с учётом палитры batch.
5. Alpha-matting/rembg — fallback для ячеек, где chroma key повреждает предмет или оставляет неприемлемый ореол.
6. Обрезать по alpha bounding box с безопасным запасом.
7. Нормализовать визуальный масштаб согласно `scaleClass`.
8. Поместить на прозрачный квадрат 512×512.
9. Сохранить как WebP с alpha.

Целевые scale classes и occupancy должны быть заданы в tool-конфигурации, а не подбираться вручную для каждого запуска. Ручное исключение допускается только как явное поле manifest с причиной.

## 9. Asset QA

### 9.1. Автоматические проверки

Каждый принятый файл обязан пройти:

- путь и filename соответствуют manifest;
- формат WebP;
- размер 512×512;
- присутствует alpha channel;
- изображение не полностью прозрачное;
- alpha bounding box не касается запрещённого края;
- площадь видимых пикселей находится в допустимом диапазоне для `scaleClass`;
- source bounding box не пересекает gutter или соседнюю ячейку;
- отсутствуют дублирующиеся ключи, пути и content hashes;
- файл декодируется ImageMagick и FFmpeg;
- runtime-каталог совпадает с принятыми manifest-записями;
- множество ключей manifest точно покрывает текущие `gearId` и `materialId`.

### 9.2. Обязательная визуальная проверка

Автоматические проверки не могут надёжно доказать угол камеры или правильность конкретного предмета. Поэтому tool генерирует contact sheets с ID и названием вне самих ассетов, а каждая ячейка проходит визуальную проверку:

- действительно ли камера строго сверху;
- соответствует ли изображение конкретному предмету;
- отличается ли оно от близких записей;
- нет ли baked checkerboard, chroma halo, обрезанных деталей или ложной прозрачности;
- согласован ли масштаб;
- не выглядит ли предмет стоящим вертикально.

Любая ячейка, не прошедшая этот gate, получает статус `rejected` и повторно генерируется. Технически валидный файл с неверным ракурсом не может стать runtime-ассетом.

## 10. Runtime resolver

Предлагается новый чистый модуль:

`scripts/data/top-down-item-texture-resolver.js`

Resolver:

1. Принимает storage row.
2. Читает `row.itemData.flags[MODULE_ID]`.
3. Для `sourceType === "gear"` собирает доступные `gearId` и `sourceId` из module flags и канонической storage row; требует хотя бы один стабильный gear ID и отсутствие противоречий между доступными значениями.
4. Для `sourceType === "material"` аналогично собирает `materialId` и `sourceId`; требует хотя бы один стабильный material ID и отсутствие противоречий.
5. При противоречивой identity, неизвестном source type или отсутствии каталожного ключа возвращает `null`.
6. Никогда не изменяет row, Item, token или world-state.
7. Никогда не использует имя Item как identity и не пытается угадывать семейство.

Проверка module-owned flags не позволяет случайно применить ассет к одноимённому Item из другого компендиума. Runtime fallback остаётся защитой от сторонних предметов, старых документов, повреждённых flags и непредвиденной рассинхронизации файлов.

## 11. Интеграция с презентацией ground pile

Изменяется только ветка одиночного обычного предмета в `deriveGroundPilePresentation`:

```text
topDownTexture
  ?? row.img
  ?? row.itemData.img
  ?? existing generic fallback
```

Имя, количество и durability presentation сохраняются.

Ветка `ordinaryRows.length > 1` не вызывает resolver и остаётся дословно эквивалентной текущему поведению:

- одна категория → существующая category pile texture;
- разные категории → `mixed-items.png`.

Монеты, пустые coin piles, journal notes и journal piles остаются на существующих ветках. Built-in storage preset texture не заменяется изображением содержимого.

## 12. Совместимость и world-state

- Stable `gearId`, `materialId`, UUID и document IDs не меняются.
- `Item.img` не изменяется.
- Token texture resolver отделён от Item icon resolver.
- World-state меняет только `StorageGroundPileService`.
- Player drop сохраняет active-GM/socket authorization.
- Existing scene FIFO, `mutationId`, consume rollback и merge idempotency сохраняются.
- Новых flags не вводится; flag migration не нужна.
- Старый токен без top-down texture остаётся валидным и не вызывает автоматической массовой world mutation.
- Новый или повторно созданный одиночный pile получает top-down texture.
- При существующей мутации старой одиночной кучи presentation пересчитывается обычным владельцем.
- Reload сохраняет уже записанную token texture.
- Существующие storage/chest/barrel textures не перезаписываются.
- Второй владелец canvas-drop workflow не создаётся.

## 13. Focused TDD

До implementation code добавляются или изменяются focused-тесты.

### Новый resolver/manifest test contour

Предлагаемые тесты:

- managed gear с согласованным `gearId` получает свой путь;
- два близких gear ID, например рапира и длинный меч, получают разные пути;
- разные ammunition gear IDs получают разные пути;
- managed material получает свой путь;
- gear/material identity conflict возвращает `null`;
- Item из другого компендиума без module-managed identity возвращает `null`;
- неизвестный ID возвращает `null`;
- manifest точно покрывает текущие 745 gear и 270 material IDs;
- нет повторов ключей, путей и принятых content hashes;
- generated runtime catalog соответствует manifest;
- каждый принятый файл существует и проходит техническую валидацию.

### `tests/storage-ground-pile-service.test.mjs`

- одиночный managed gear использует top-down texture;
- одиночный material использует top-down texture;
- отсутствие top-down mapping сохраняет текущую Item image;
- merge двух ordinary items сохраняет существующий category/mixed selector;
- после удаления одного Item оставшийся одиночный Item снова получает собственный top-down texture;
- повторный drop с тем же mutation ID остаётся идемпотентным;
- coin-only pile сохраняет текущие coin textures;
- coin merge/legacy repair не затрагиваются;
- reload/refresh presentation не меняет identity и содержимое.

### `tests/builtin-storage-presets.test.mjs`

- все существующие preset IDs и textures остаются прежними;
- сундуки, бочки и ground-pile preset не получают item top-down texture;
- deposit Item в storage preset не заменяет preset token texture.

## 14. Live QA

Live QA выполняется в Foundry VTT 13/dnd5e после автоматических тестов:

1. GM выкладывает на пустую сцену рапиру, длинный меч, два разных вида боеприпасов, ящик и материал.
2. Проверяется отдельная top-down texture каждого одиночного токена и неизменная `Item.img`.
3. Player выполняет те же операции через active-GM socket route.
4. Проверяются permission denial и отсутствие активного GM без обхода авторизации.
5. Два Item объединяются; куча получает существующую category/mixed texture.
6. Один Item забирается; оставшийся снова получает собственную texture.
7. Проверяются повторный drop, reload сцены и reload клиента.
8. Токен удаляется и создаётся повторно; выбирается тот же asset path.
9. Item из стороннего компендиума сохраняет текущий fallback.
10. Проверяются coin piles, legacy coin repair и смешанные номиналы.
11. Item помещается в существующие сундук и бочку; preset textures не меняются.
12. Проверяется отсутствие Sequencer frame regression.

## 15. Документация, версия и поставка

На implementation этапе обязательно:

- обновить раздел storage/ground piles в `docs/function-passport.md` для всех новых и изменённых методов;
- при необходимости обновить README только если меняется публичный API;
- повысить `version` в `module.json`;
- создать новый `scripts/main-<version>.js`, который только импортирует `scripts/main.js`;
- обновить `esmodules` и убедиться, что runtime не ссылается на старую версию;
- выполнить focused-тесты и полный набор проверок из `AGENTS.md`;
- проверить `git diff --check`, `git diff --stat` и содержательный diff;
- коммитить только файлы задачи;
- commit и push выполнять только в `lich_branch`, без force push.

## 16. Критерии готовности

Задача завершена, когда одновременно выполнены условия:

- manifest содержит отдельную принятую запись для каждого текущего `gearId` и `materialId`;
- существуют и валидны все 1015 уникальных прозрачных WebP;
- все принятые изображения визуально проверены как строгий top-down;
- одиночные canonical gear/material ground piles используют собственный ассет;
- Item icons не изменились;
- multi-item, coin, journal и preset presentation не изменились;
- внешний или повреждённый Item использует прежний fallback;
- GM/player live QA пройден;
- focused и full test suites пройдены;
- паспорт функций и версия обновлены;
- изменения закоммичены и отправлены только в `lich_branch`.

## 17. Утверждённое расширение: размеры наземной мебели

Для двенадцати canonical gear items manifest дополнительно хранит ручной размер Scene Token в клетках и режим поворота `cardinal`. Остальные предметы сохраняют прежний размер и полный детерминированный угол.

| `gearId` | Предмет | Ширина × высота |
|---|---|---:|
| `stol-prostoy` | Стол, простой | 2×2 |
| `stol-bolshoy` | Стол, большой | 3×2 |
| `stol-pismennyy` | Стол, письменный | 2×1 |
| `stul` | Стул | 1×1 |
| `skamya` | Скамья | 2×1 |
| `krovat` | Кровать | 1×2 |
| `shkaf` | Шкаф | 2×1 |
| `stellazh` | Стеллаж | 2×1 |
| `verstak` | Верстак | 2×1 |
| `prilavok` | Прилавок | 2×1 |
| `yashchik-derevyannyy` | Ящик, деревянный | 1×1 |
| `korobka-derevyannaya` | Коробка, деревянная | 1×1 |

`StorageGroundPileService` остаётся единственным владельцем TokenDocument create/update. Для перечисленных предметов он записывает отдельные `width` и `height` и сохраняет центр токена при single↔pile transition. Квадратная мебель и вызовы без явно выбранной ориентации получают устойчивый по `rowId` угол только из `0/90/180/270`; клиентский выбор для прямоугольной мебели уточнён в разделе 18. Merge нескольких предметов, coins и storage presets остаются `1×1` с rotation `0`; surviving single item восстанавливает собственный размер и режим поворота.

Чтобы квадратный прозрачный холст не заставлял прямоугольную мебель выглядеть маленькой и не искажал сам рисунок, прямоугольные top-down WebP механически перепаковываются на прозрачный холст с отношением сторон, соответствующим footprint. Изображение масштабируется только равномерно, без изменения пропорций и перерисовки; manifest сохраняет обновлённый asset hash, а техническая QA проверяет alpha, непустой bounding box и безопасные края относительно фактических размеров файла.

Новых world flags, hooks, socket routes и canvas-drop owners не вводится. `Item.img`, stable ID/UUID, authorization, mutation idempotency и fallback сторонних предметов не меняются.

## 18. Утверждённое расширение: выбор ориентации прямоугольной мебели

### 18.1. Наблюдаемое поведение

При переносе на сцену canonical предмета мебели с footprint, у которого `tokenWidth !== tokenHeight`, инициировавший drop клиент после выбора количества показывает диалог ориентации. Пользователь выбирает строго `0°`, `90°`, `180°` или `270°`; только после подтверждения существующий ground-pile workflow расходует источник и создаёт Scene Token.

- `0°` и `180°` используют canonical `tokenWidth × tokenHeight`.
- `90°` и `270°` используют переставленные `tokenHeight × tokenWidth`.
- Точка drop остаётся центром создаваемого токена.
- Текстура равномерно масштабируется так, чтобы после поворота занимать рассчитанный footprint без искажения и уменьшения из-за `texture.fit: "contain"`.
- Кнопка отмены завершает drop без consume, Token creation и socket command.
- Выбранная при создании ориентация считается окончательной. Последующее ручное изменение `TokenDocument.rotation` штатными средствами Foundry является только визуальным и не запускает автоматическую перестановку механических `width`/`height`.

Диалог не показывается для квадратной мебели, прочих gear items, материалов, монет, Journal, portable storage, multi-item piles, built-in storage presets и внешних/повреждённых Item, для которых strict module-owned resolver не вернул rectangular footprint.

### 18.2. Выбранный подход

Выбран простой клиентский диалог до authoritative команды. Canvas preview/ghost placement отклонён как отдельный интерактивный режим, который неоправданно расширяет canvas-drop workflow. Внешний макрос отклонён как ручной второй владелец layout, способный рассинхронизировать rotation, texture scale и механический footprint.

Диалог использует штатный Foundry v13 UI и четыре явных действия. Он показывает название предмета, top-down thumbnail и итоговый размер для каждого направления. По умолчанию выделен `0°`; Enter подтверждает его, Escape и закрытие окна равнозначны отмене. Отдельная Application и новый canvas Hook не создаются.

### 18.3. Data flow и владельцы

Существующий владелец `dropCanvasData` в `scripts/integrations/storage-transfer-drop.js` остаётся единственной точкой перехвата:

1. Разбирает Item или storage-row drag data и определяет сцену/точку.
2. Получает safe inspection источника через существующий `inspectStorageDepositSource()`.
3. Inspection дополнительно возвращает только производный optional placement descriptor: canonical `width`, `height` и `rotationMode`; клиент не передаёт собственные размеры.
4. Запрашивает количество прежним диалогом.
5. Только для `rotationMode === "cardinal"` и `width !== height` запрашивает ориентацию.
6. Передаёт выбранный optional `rotation` через существующий API и существующий socket route:
   - direct Item drop — в payload `dropStorageItemToScene()`;
   - storage-row claim на сцену — в `target` существующего `claimStorageRow()`.
7. Active GM повторно разрешает live source, выводит canonical presentation и принимает rotation только для rectangular cardinal furniture. Клиентский placement descriptor не является authoritative.
8. `StorageGroundPileService` остаётся единственным владельцем TokenDocument create/update и рассчитывает итоговые rotation, width, height, x/y и texture scale одной pure layout-функцией.

Новый socket route, второй canvas-drop owner и прямые world mutations из UI не вводятся. Exact payload validators расширяются только optional cardinal rotation и отклоняют нецелые, произвольные и нечисловые значения. Старый payload без rotation остаётся валидным и использует прежний детерминированный cardinal fallback, поэтому программные вызовы и mixed persisted state не требуют миграции.

### 18.4. Layout и merge

Pure layout принимает canonical presentation и итоговый cardinal rotation. Для нечётной четверти оборота он переставляет стороны. Так как rectangular WebP уже имеет canonical aspect ratio, при `90°/270°` базовый `textureScale` умножается на `max(width / height, height / width)`; после поворота mesh совпадает с осевым механическим footprint. Для `0°/180°` используется базовый scale.

При создании `x/y` рассчитываются от точки drop и итоговых сторон. При обновлении существующего одиночного furniture token центр сохраняется тем же center-preserving правилом, которое уже использует `#writePile()`.

Выбор из нового диалога применяется только при создании нового ground token. Если drop попадает в существующую кучу:

- multi-item или coin presentation сохраняет прежние `1×1`, scale `1`, rotation `0`;
- surviving/stacked single rectangular furniture сохраняет текущую cardinal rotation существующего токена и пересчитывает согласованный layout из неё;
- выбранная в диалоге ориентация не переориентирует существующий token;
- duplicate retry с тем же mutation ID не меняет layout повторно.

Новых persisted flags не требуется: согласованные `rotation`, `width`, `height` и texture scale уже сохраняются в TokenDocument. Stable gear/material IDs, UUID, `Item.img`, storage flags и manifest schema не меняются.

### 18.5. Ошибки и совместимость

- Закрытие/отмена orientation dialog не считается ошибкой и сохраняет источник.
- Ошибка inspection, авторизации, socket или создания проходит через существующий error/rollback path.
- Active GM игнорирует optional rotation для square/non-furniture presentation и не доверяет клиентским размерам.
- Отсутствующий top-down asset или strict identity продолжает использовать текущий fallback без orientation dialog.
- Portable containers, сундуки, бочки, монеты, Journal и built-in storage textures не меняются.
- Player drop сохраняет controlled-character distance check, sender authorization и active-GM execution.

### 18.6. Focused TDD и приёмка

До production code добавляется focused coverage:

- `storage-transfer-drop`: rectangular Item и storage row вызывают orientation prompt после quantity; cancel не вызывает command; square/external/coin/Journal routes prompt не вызывают;
- storage module API и socket validators: optional `0|90|180|270` проходит, остальные значения отклоняются, старый payload остаётся валидным;
- `storage-command-service`: active GM передаёт только проверенную ориентацию и сохраняет прежние authorization/rollback contracts;
- `storage-ground-pile-service`: `0/180` создают canonical footprint, `90/270` переставляют стороны и компенсируют scale, центр совпадает с drop point;
- merge/retry: существующая single furniture orientation сохраняется, multi-item pile сбрасывается к прежней presentation, duplicate не меняет layout;
- coin piles, fallback и built-in storage presets проходят прежние regression tests.

После реализации обновляются соответствующий раздел `docs/function-passport.md`, `module.json` и versioned forwarder. Выполняются focused tests и полный набор проверок из `AGENTS.md`. Live Foundry QA в этом этапе не запускается по текущему указанию пользователя; ручная проверка GM/player drop, cancel, reload и четырёх ориентаций остаётся отдельным последующим шагом.
