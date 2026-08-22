# Единый импортёр снаряжения и магических предметов

**Статус:** дизайн утверждён пользователем 2026-08-22.

## Цель

Одна команда читает основную Google-таблицу «Ребрея: Оружие, огнестрел и снаряжение» через Google Sheets API, собирает весь sheet-backed контур снаряжения и магических предметов, валидирует связи и типы, показывает содержательный diff и только после явного подтверждения атомарно обновляет runtime-источники модуля.

Наблюдаемый результат: после успешного `--apply` и следующего active-GM sync в Foundry компендиумы материалов, снаряжения, магических предметов и транспорта отражают один согласованный снимок таблицы; прежние stable IDs сохраняются, а частично обновлённый набор каталогов невозможен.

## Границы

### Входит

- общий компендиум снаряжения как базовая карточка предмета;
- обычное оружие и все табличные свойства оружия;
- огнестрел, режимы стрельбы, осечки, перезарядка, дальность и боеприпасы;
- доспехи, взрывчатка, оружейные обвесы и усовершенствования;
- материалы, импланты и транспорт из той же книги;
- магические предметы, включая тип, подтип, слот, редкость, настройку, расходуемость, описание и стоимость;
- сохранение существующих Foundry-enrichment полей и stable IDs через отдельный curated override-каталог;
- dry-run, diff, защита от удалений, транзакционная запись и rollback;
- удаление прежних equipment-импортёров после подтверждённого паритета.

### Не входит

- экономические `goods.json`, `regions.json`, `cities.json` и `reference.json`, которые приходят из другой книги через `tools/import-xlsx.ps1`;
- импорт заклинаний, классов, рас, черт, предысторий и иных не-equipment каталогов;
- запись или исправление ячеек исходной Google-таблицы;
- прямая мутация Foundry world из CLI;
- замена lifecycle или security boundary существующих managed-compendium services.

## Подтверждённые проблемы текущего контура

1. `tools/import-gear.ps1::Convert-ToPlainNumber()` после нескольких частных случаев удаляет все символы, кроме цифр и знаков. Живая ячейка `Общий компендиум снаряжения V0.1!F112` содержит `1/4 фнт`, а текущий `data/gear.json` содержит для «Дротика» `weight: 14`.
2. Источником gear служит tracked XLSX snapshot, хотя локальный service account уже имеет read-only доступ к актуальной Google-таблице.
3. Материалы и gear используют разные PowerShell-импортёры и дублируют чтение XLSX, нормализацию текста, чисел и JSON-запись.
4. Gear-importer читает прошлый `data/gear.json` как enrichment source. Сгенерированный результат одновременно является входом следующего запуска, поэтому чистая воспроизводимость отсутствует.
5. `magicItem.js` является отдельным большим ручным runtime-источником; его 552 записи не проходят через общий equipment pipeline и не имеют явного сохранённого `id` в исходном массиве.
6. Неподдерживаемые значения часто превращаются в `0`/`null` или частично разобранное число вместо ошибки с координатой источника.

## Выбранная архитектура

Используется один Node.js entrypoint `tools/import-equipment.mjs`. Для пользователя и CI это единственная команда. Реализация разделяется на внутренние модули по ответственности, но ни один доменный адаптер не является самостоятельным импортёром и не имеет отдельного CLI.

Высокоуровневый поток:

```text
Google Sheets API
  -> нормализованный строковый снимок диапазонов
  -> доменные адаптеры и joins
  -> единый catalog bundle
  -> schema/cross-catalog validation
  -> diff относительно tracked runtime-источников
  -> dry-run report либо staged transactional apply
```

### Внутренние компоненты

- `tools/import-equipment.mjs` — аргументы CLI, orchestration и exit code.
- `tools/equipment-import/google-sheets-client.mjs` — service-account OAuth, metadata/range reads и bounded retry.
- `tools/equipment-import/snapshot.mjs` — нормализация API response в `string | null`, заполнение пропущенных trailing cells и source coordinates.
- `tools/equipment-import/parsers.mjs` — строгие общие парсеры чисел, цены, веса, dice, дистанций и boolean-like значений.
- `tools/equipment-import/adapters/*.mjs` — внутренние адаптеры каталогов и профильных вкладок.
- `tools/equipment-import/pipeline.mjs` — joins, overrides, catalog bundle и cross-catalog invariants.
- `tools/equipment-import/diff.mjs` — детерминированный create/update/delete/unchanged report и destructive guards.
- `tools/equipment-import/transactional-writer.mjs` — staging, повторная проверка, replace и rollback.

Точное разбиение может объединять очень маленькие соседние модули, но не должно возвращать доменную логику в один монолитный файл.

## Источник и авторизация

- Spreadsheet ID по умолчанию: `1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk`.
- Credentials по умолчанию: ignored-файл `tools/google-credentials.json` типа `service_account`.
- OAuth scope: только `https://www.googleapis.com/auth/spreadsheets.readonly`.
- CLI допускает явные `--spreadsheet-id` и `--credentials`, но никогда не печатает private key, JWT, access token, client ID или полный credential object.
- Сначала читается spreadsheet metadata. Обязательные видимые и скрытые листы разрешаются по точному title; guessed/default sheet names запрещены.
- Затем выполняется минимальное число `values.batchGet` запросов с `valueRenderOption=FORMATTED_VALUE` и `majorDimension=ROWS`.
- Повторяются только `429` и временные `5xx`: не более четырёх повторов с bounded exponential backoff и jitter. `400`, `401`, `403`, неизвестный лист и schema mismatch завершают запуск без retry.
- Нормализованный снимок получает SHA-256 fingerprint. В generated source metadata хранится fingerprint и spreadsheet ID, но не timestamp, чтобы одинаковые данные давали одинаковый diff.

## Листы и их роли

Обязательный набор определяется metadata и schema registry:

- `Общий компендиум снаряжения V0.1` — базовые поля всех обычных equipment-записей;
- `_СПРАВОЧНИК_СНАРЯЖЕНИЯ` — source identity и точная маршрутизация базовой строки к профильному листу;
- `Оружие V0.36` и `Оружейные группы` — оружейные характеристики и групповые правила;
- `Огнестрел V0.36` — полная firearm-модель;
- `Улучшения и обвесы V0.2` — attachments и их профильные свойства;
- `Боеприпасы` и metadata-resolved `Особые боеприпасы` — обычные и специальные боеприпасы. Скрытый `Особые боеприпа` является подтверждённым legacy-зеркалом со смещением диапазона: importer принимает его только пока нормализованные матрицы полностью эквивалентны каноническому листу; любое расхождение блокирует импорт как неоднозначный источник;
- `Доспехи V0.1` — armor profile;
- `Взрывчатка V0.0` — explosive profile;
- `Импланты V0.1` — implants catalog;
- `Усовершенствования V0.21` — upgrades catalog;
- `Энциклопедия материалов` — materials catalog;
- `Транспорт V0.1` — transport catalog;
- `Магические предметы V0` — magic items catalog.

`_SYS`, старые и расчётные технические листы не становятся самостоятельными catalog sources. Они могут быть прочитаны только если schema registry фиксирует конкретный проверяемый join, которого нет в канонических листах.

## Строковая граница и типы

### API boundary

После `FORMATTED_VALUE` каждая непустая ячейка обязана быть строкой. Отсутствующая/trailing ячейка становится `null`. Boolean, number, object или array на этой границе считается protocol/schema error; доменные адаптеры никогда не работают со смешанными Google value types.

Каждое значение несёт source context:

```js
{
  spreadsheetId,
  sheetName,
  rowNumber,
  columnName,
  header,
  rawValue
}
```

Ошибка парсинга включает `sheetName`, `rowNumber`, header/column, исходное значение и ожидаемый формат.

### Числа

Общий numeric parser принимает:

- целые и знаковые целые;
- десятичную точку или запятую;
- пробелы как разделители тысяч;
- ASCII fractions `1/4` и mixed fractions `1 1/4`;
- Unicode fractions как минимум `¼`, `½`, `¾`.

Парсер обязан сопоставить всю нормализованную строку. Удаление произвольных символов для получения числа запрещено. `null`, пустая строка, `—` и `-` обрабатываются вызывающим field parser согласно схеме поля.

### Вес

- `фнт`, `фнт.`, формы `фунт/фунта/фунтов` преобразуются в числовые pounds.
- `Незнач.` преобразуется в `0` только в equipment weight.
- прочерк преобразуется в `null`.
- отрицательный вес разрешён только attachment adapter; в обычной карточке это validation error.
- `тонн` разрешены только transport adapter. Внутри они валидируются как `{ value, unit: "ton" }`, а наружу сериализуются в существующий строковый transport contract.
- Исходный текст может сохраняться как `weightText`, когда он нужен presentation/debugging, но authoritative numeric `weight` ordinary gear остаётся `number | null`.

### Цена

Цена разбирается в union:

```js
{ kind: "fixed", raw, value, denomination, goldEquivalent }
{ kind: "variable", raw }
null
```

Fixed price принимает только полное число и известную валюту `мм/см/эм/зм/пм` либо `cp/sp/ep/gp/pp`. Авторская формула или диапазон, например `20–1 500 зм (по уровню)` или dice expression, сохраняется как `variable`; извлечение первого числа запрещено. Runtime-поля фиксированной цены получают число, переменная цена сохраняет raw text и `null` вместо выдуманного эквивалента.

### Остальные типы

- rank — целое в разрешённом конкретным каталогом диапазоне либо `null`;
- boolean-like поля — явный whitelist (`TRUE/FALSE`, `1/0`, согласованные русские значения), неизвестное значение ошибочно;
- dice — полный grammar match с нормализацией `к` в runtime `d` только после успешного разбора;
- range, reload, misfire, capacity и weapon property values разбираются отдельными field parsers;
- description и author-facing labels сохраняют текст, Unicode и переносы строк без lossy normalization.

## Identity и joins

### Базовое снаряжение

Общий каталог задаёт базовую запись. `_СПРАВОЧНИК_СНАРЯЖЕНИЯ` предоставляет точный source reference вида `Лист!A<row>` и проверяемые canonical fields. Профильные адаптеры присоединяют weapon/firearm/armor/ammunition/explosive/attachment data по source reference.

Join только по display name запрещён. Нормализованное имя разрешается лишь как диагностический fallback для сообщения об отсутствующей identity mapping и никогда автоматически не принимает решение при записи.

### Stable IDs и overrides

Новый tracked `data/equipment-import-overrides.json` имеет `schemaVersion: 1` и разделы по каталогу. Ключом служит canonical source identity; значение содержит существующий stable `id`, aliases и только whitelisted enrichment fields.

Первичная миграция извлекает IDs и manual enrichment из текущих `data/gear.json`, `data/implants.json`, `data/rebreya-transport-v01.json` и `magicItem.js`. После миграции generated runtime-файлы больше не читаются как enrichment input.

Sheet-owned поля — name, type, price, rank, weight, description и профильные характеристики — override менять не может. Разрешены только поля, которых нет в таблице: stable ID/aliases, Foundry type/subtype/base item/folder, container metadata, hero-doll slots и явно перечисленные presentation/automation hints.

Orphaned override, duplicate stable ID, несколько source identities для одного неразрешённого alias или попытка override sheet-owned поля блокируют импорт.

Для magic items миграция закрепляет текущие slug-based IDs в overrides. Новая запись получает детерминированный ID, не зависящий от порядка строк. Последующее переименование требует alias/identity update и не приводит к молчаливому delete/create.

## Доменные адаптеры

Каждый адаптер принимает нормализованные строки со source context и возвращает typed records плюс diagnostics. Он не читает API, credentials, filesystem или прошлые generated outputs.

- Base gear adapter создаёт common equipment fields и отбрасывает transport rows из `gear.json` только после их успешной маршрутизации в transport catalog.
- Weapon adapter создаёт damage, damage type, group, hand requirements, range и полный набор свойств.
- Firearm adapter создаёт invention year, firearm class, modes, ammo family/properties, reload, misfire, range, strength requirement и additional property values.
- Ammunition, armor, explosive и attachment adapters создают профильные subobjects текущего `gear.json` contract.
- Upgrade adapter строит `upgrades.json` и требует однозначную связь с product/material.
- Materials adapter строит только реальные строки `Энциклопедия материалов`; synthetic-from-goods контур не расширяется, потому что economy workbook вне scope. Если runtime всё ещё требует synthetic entries, они сохраняются только из curated overrides с отдельным source kind.
- Implants и transport adapters сохраняют действующие runtime shapes и stable IDs.
- Magic items adapter генерирует экспорт `MAGIC_ITEMS` в `magicItem.js`, добавляя явный stable `id` и сохраняя ожидаемые `magic-items-compendium.js` поля.

## Catalog bundle и выходы

Pipeline сначала полностью строит единый in-memory bundle:

```js
{
  schemaVersion: 1,
  source: { spreadsheetId, fingerprint },
  catalogs: {
    gear,
    upgrades,
    materials,
    implants,
    transport,
    magicItems
  },
  diagnostics
}
```

После общей валидации bundle сериализуется в существующие runtime-источники:

- `data/gear.json`;
- `data/upgrades.json`;
- `data/materials.json`;
- `data/implants.json`;
- `data/rebreya-transport-v01.json`;
- `magicItem.js` с `export const MAGIC_ITEMS = [...]`.

JSON/JS сериализация использует UTF-8 без BOM, LF, два пробела, стабильный порядок записей и ключей. Generated timestamps отсутствуют.

## Валидация и destructive guards

До diff проверяются:

- обязательные sheets, headers и header row;
- уникальные source identities и stable IDs;
- полное и однозначное присоединение профильных строк;
- field schemas и cross-catalog references;
- отсутствие неиспользованных non-empty профильных строк;
- отсутствие orphaned overrides;
- совместимость runtime shapes с consumers.

Ошибки одного прохода агрегируются до 100 записей, после чего отчёт сообщает число скрытых ошибок. При любой ошибке diff может быть показан только частично, а apply запрещён.

Diff рассчитывается по stable ID и детерминированной signature и показывает для каждого каталога `create`, `update`, `delete`, `unchanged`, identity changes и orphan candidates.

- Любое удаление требует `--allow-removals` вместе с `--apply`.
- Large diff guard срабатывает, если один каталог теряет более 25 записей или более 10% прежних записей, в зависимости от того, какой порог меньше. Для такого применения дополнительно нужен `--allow-large-diff`.
- Обнаруженная смена stable ID для той же canonical source identity является ошибкой и не обходится destructive flags; сначала исправляется identity/alias mapping.
- Пустой обязательный каталог и потеря более 50% строк всегда считаются likely truncation и блокируют apply до исправления источника или схемы.

## CLI и отчёт

```powershell
node tools/import-equipment.mjs
node tools/import-equipment.mjs --apply
node tools/import-equipment.mjs --apply --allow-removals
node tools/import-equipment.mjs --apply --allow-removals --allow-large-diff
```

Без `--apply` команда всегда является dry-run. Неподдерживаемые флаги и конфликтующие аргументы дают non-zero exit code.

Отчёт содержит spreadsheet ID/fingerprint, прочитанные sheets/ranges, counts, warning/error summary и catalog diff. Секреты и полные сырые строки с потенциально чувствительными данными не выводятся. Успешный dry-run возвращает `0`; validation/API failure возвращает non-zero; успешный apply возвращает `0` только после post-write verification.

## Транзакционная запись и rollback

1. Все цели сериализуются в ignored staging directory на том же томе, что workspace.
2. Staged JSON повторно парсится; staged `magicItem.js` импортируется отдельным Node process и проверяется на ожидаемый export.
3. Для каждого существующего target создаётся backup в transaction directory.
4. Targets заменяются staged-файлами через same-volume rename.
5. После замены все targets повторно читаются и сверяются с ожидаемыми hashes.
6. При любой ошибке заменённые targets восстанавливаются из backups; новые targets удаляются только по manifest этой транзакции.
7. Успешная транзакция удаляет staging/backups. Прерванная транзакция оставляет compact recovery manifest и следующий запуск сначала предлагает/выполняет детерминированное восстановление, а не начинает новый apply.

Workspace root, `data/` целиком и не перечисленные manifest-файлы никогда не являются target destructive operation.

## Runtime sync

CLI обновляет только tracked source files. Он не подключается к Foundry world и не обходит active-GM boundary.

Существующие `MaterialsCompendiumService`, `GearCompendiumService`, `MagicItemsCompendiumService` и `TransportCompendiumService` продолжают managed diff sync при lifecycle модуля. Stable module flags (`gearId`, `magicItemId` и профильные equivalents), signature-based update и защита unmanaged документов сохраняются.

Если runtime consumer требует адаптации к новому typed field, изменяется профильный builder, а не общий managed sync lifecycle. Массовый `delete all -> create all` запрещён.

## Тестовая стратегия

### Новый focused owner suite

`tests/equipment-importer.test.mjs` и при разрастании соседние focused-файлы проверяют публичные внутренние контракты pipeline:

- API snapshot принимает formatted string/null и отвергает смешанные scalar types;
- `1/4 фнт`, `¼ фнт`, `½ фнт`, decimals и mixed fractions дают ожидаемые числа;
- `1/4 фнт` даёт `0.25`, а не `14`;
- отрицательный attachment modifier разрешён, отрицательный ordinary weight отклонён;
- transport tons валидируются без преобразования в pounds;
- fixed и variable prices не смешиваются;
- firearm row присоединяет все режимы, reload, misfire, ammo и property values по source identity;
- duplicate/missing/ambiguous joins содержат точную source coordinate;
- existing IDs и whitelisted enrichment переживают повторный импорт;
- sheet-owned override отклоняется;
- magic item получает прежний stable ID независимо от порядка строк;
- removals и large diffs требуют соответствующих flags;
- ошибка замены одного target восстанавливает уже заменённые targets.

Fixtures моделируют полную фактическую форму Sheets API response, но остаются маленькими и hand-checked. Tests внедряют fake sheets client в pipeline и не требуют локальных credentials или сети. Assertions проверяют generated behavior, а не наличие строк в source code.

### Existing focused suites

После миграции обязательно проходят как минимум:

- `tests/gear-import-script.test.mjs` после переноса его behavioral assertions на новый importer;
- `tests/gear-compendium.test.mjs`;
- `tests/gear-catalog-sync.test.mjs`;
- `tests/material-catalog-sync.test.mjs`;
- `tests/materials-data.test.mjs`;
- `tests/materials-compendium.test.mjs`;
- `tests/implants-catalog.test.mjs`;
- `tests/transport-compendium.test.mjs`;
- `tests/transport-actor-builder.test.mjs`;
- `tests/magic-items-compendium.test.mjs`;
- `tests/main-composition-root.test.mjs` при изменении runtime wiring.

### Live и полная проверка

Перед первым apply выполняется live dry-run с ignored service-account credentials. После apply повторный live dry-run обязан показать нулевой diff.

Перед commit выполняются focused tests, затем один полный проход из `AGENTS.md`: `node --test tests/*.test.mjs`, `git diff --check`, syntax check всех tracked JS/MJS и parse check всех tracked JSON.

## Миграция

1. Добавить fixture-driven failing tests для общего pipeline и регрессии `1/4 -> 0.25`.
2. Реализовать API/snapshot/parsers без записи production files.
3. Добавить domain adapters и cross-catalog joins по одному owner contract за раз.
4. Сгенерировать `equipment-import-overrides.json` из текущих IDs/enrichment и проверить его whitelist/orphans.
5. Выполнить live dry-run и сравнить каждый catalog с текущими sources; каждое отличие классифицировать как исправление, новая строка таблицы либо regression.
6. Прогнать `--apply`, existing focused suites и повторный zero-diff dry-run.
7. Удалить `tools/import-gear.ps1` и `tools/import-materials.ps1`, обновить tests/README/passport. `tools/import-xlsx.ps1` оставить как отдельный economy importer другой книги.

## Документация и паспорт

- `README.md` должен описывать одну equipment import command, credentials path, dry-run/apply/removal guards и связь с active-GM runtime sync.
- `docs/function-passport.md` должен заменить XLSX/PowerShell data flow на Google Sheets API pipeline и перечислить новые/изменённые методы, их владельцев, ограничения и focused tests.
- Старые методы удаляются из паспорта вместе с исходниками; паспорт описывает итоговое состояние, а не историю миграции.

## Критерии готовности

- Один CLI импортирует все утверждённые equipment и magic-item каталоги из основной Google-таблицы.
- Локальный service account успешно выполняет live read-only dry-run без утечки credentials.
- Регрессия «Дротик»: source `1/4 фнт` даёт `weight: 0.25`.
- Firearm/weapon/armor/ammunition properties в generated gear соответствуют профильным листам и присоединены по source identity.
- Magic items генерируются тем же pipeline и сохраняют managed UUID через stable IDs.
- Любая schema/type/join ошибка оставляет все runtime sources неизменными.
- Ошибка в середине apply восстанавливает весь прежний набор target files.
- Повторный запуск на неизменившейся таблице даёт byte-stable outputs и zero diff.
- Прежние gear/materials импортёры отсутствуют; economy importer другой книги не затронут.
- Focused и полный test suite проходят, `docs/function-passport.md` и `README.md` отражают новый контракт.
