# Generic Inventory Item Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать название любого Item в групповом инвентаре ссылкой на однозначный доступный источник в компендиуме или мире, с открытием собственного Item при отсутствии такого источника.

**Architecture:** Один read-only infrastructure resolver определяет источник; существующий module API предоставляет его InventoryApp, а UI открывает native sheet. Маленький data helper сохраняет UUID перед существующей очисткой ItemData. Экономическая классификация, торговый dispatch и владельцы inventory mutations сохраняются.

**Tech Stack:** Foundry VTT 13, dnd5e, JavaScript ESM, ApplicationV2/Handlebars, Node test runner; новых зависимостей нет.

**Spec:** [2026-10-14-inventory-item-links-design.md](../specs/2026-10-14-inventory-item-links-design.md), подтверждена пользователем 2026-10-14; commit `73c6de65`.

## Global Constraints

- «Наличие ссылки не зависит от экономического `sourceType` или списка поддерживаемых торговых каталогов».
- «Если источник отсутствует, удалён, недоступен или не определяется однозначно, открывается собственный Item из инвентаря».
- «Совпадение имени с каталогом ради открытия карточки не превращает ручной Item в каталожный и не подменяет его характеристики».
- «Открытие ссылок не пишет документы, settings, stock или mutation journal»; получение inventory actor использует `create: false`.
- «Общий постоянный кэш и новые hooks для кэша не вводятся»; поиск выполняется по клику и использует индекс Foundry.
- Сохранить `openTradeEntry`, JournalRecord viewer, quantity/formulas/budgets, manual/custom economics, merge/transfer/recovery и `nativeImportSource` authority.
- Работать в чистой `lich_branch`; перед product edits повторить Git preflight. Выполнение — самостоятельно и последовательно в этом чате, Gemini используется для ограниченных черновиков и проверок.
- Один итоговый product commit после полной проверки: промежуточные компоненты не публикуются с прежней версией. План коммитится отдельно. Выпуск `1.4.377`, если перед исполнением версия остаётся `1.4.376`; при другом baseline определить следующий свободный patch и согласованно закрепить его в release-тестах.

## Review Focus

1. Snapshot `sourceId` может быть ID embedded Item: настоящий legacy `<sourceType>Id` должен иметь приоритет над такой подсказкой — Task 1.
2. `linkedGoodId`, container/upgrade IDs не являются исходным документом: поиск не должен совпадать по произвольному `*Id` — Task 1.
3. Единственный мировой `weapon` должен открываться из ручной строки `loot`, без изменения характеристик строки — Tasks 1 и 3.
4. Возобновлённая старая операция использует сохранённый ItemData; новая metadata не добавляется в него задним числом и не ослабляет проверки recovery — Task 2.
5. При асинхронном клике захватываются группа и Item показанной строки; смена active group не переключает поиск на чужой Item — Task 3.

## Files and Interfaces

- Create `scripts/data/item-source-reference.js`: pure UUID provenance/flags projection helpers; tests `tests/item-source-reference.test.mjs`.
- Create `scripts/infrastructure/foundry/item-source-resolver.js`: загрузка и выбор доступного Item; tests `tests/item-source-resolver.test.mjs`.
- Modify `scripts/data/inventory-service.js`: `sanitizeEmbeddedItemData`, direct-document ingress/copy callers, `#loadCraftGearSourceData`, `#buildInventoryEntry`; focused tests в существующих inventory suites.
- Modify `scripts/data/storage-deposit-source.js`: source metadata в свежем `buildItemRow` и flags projection при формировании fallback stack keys; tests `tests/storage-deposit-source.test.mjs`. Storage UI в задачу не входит.
- Modify `scripts/main.js`, `scripts/ui/inventory-app.js`, `templates/inventory-app.hbs`: module API и клики; tests `tests/inventory-app-context.test.mjs`.
- Modify `module.json`, `tests/module-manifest.test.mjs`, incoming runtime imports затронутых владельцев; create `scripts/main-1.4.377.js`. Старые forwarders сохраняются.
- Modify `README.md` (публичный API/inventory), `docs/function-passport.md` (секции 7, 15, 19), этот план (результаты проверок).

### Task 1: Общий resolver и helpers происхождения

**Interfaces:**

- `collectItemSourceUuids(itemOrData, { sourceUuid = "" } = {}) -> string[]`: уникальные допустимые UUID в порядке metadata, core source, dnd5e source, compendium stats, дополнительный известный source UUID; без Foundry globals и мутаций входа. Внешние actor-Item UUID и non-Item UUID исключаются.
- `preserveItemSourceUuid(itemData, { sourceUuid = "" } = {}) -> detached ItemData`: сохраняет первый допустимый исходный UUID в `flags.rebreya-main.itemSourceUuid`; без источника не добавляет metadata. Это подсказка для просмотра, не authority.
- `stripItemSourceUuidFromFlags(flags = {}) -> detached Flags`: проекция для сравнения stack keys, исключающая только display metadata; пустая namespace, созданная этим полем, не меняет ключ.
- `canViewItem(item, { game = globalThis.game } = {}) -> boolean`: проверяет Item и `testUserPermission(game.user, "OBSERVER")`; для compendium Item также доступность соответствующего Item pack. Подходит и для embedded fallback Item.
- `resolveItemSource(itemOrData, hints = {}, { game = globalThis.game, fromUuid = globalThis.fromUuid } = {}) -> Promise<Item | null>`; hints: `{ sourceUuid, sourceType, sourceId, sourceName }`. Возвращает только внешний standalone world/compendium Item; `null` означает отсутствие безопасного однозначного выбора. Не открывает sheet.

- [ ] **1. Записать focused-тесты helpers и resolver.** Fixtures задают реальные формы UUID, Item Documents с `testUserPermission`, Collection-like world Items и packs с `getIndex/getDocument` spies. Закрепить имена тестов и assertions:
  - `legacy typed identity beats snapshot native id`: alchemy flags `{ sourceType: "alchemyProduct", alchemyProductId: "alchemy-7" }`, hints `sourceId: "embedded-id"` → строго тот alchemy Document; material/gear с typed ID без `sourceType` на кандидате также работают.
  - `arbitrary source type and third-party pack need no registry`: будущий source type/обычный сторонний Item без module flags открываются по идентификатору либо единственному имени.
  - `explicit UUID wins a same-name decoy`: world/compendium UUID выбирает точный Document после rename; malformed, non-Item, Actor Item UUID и удалённый источник не выбираются.
  - `unique name prefers compendium then world across native types`: единственный pack Item предпочитается world Item; ручной loot → world weapon при отсутствии pack match.
  - `ambiguous strongest tier returns null`: два доступных совпадения ID/имени в одном/разных packs или world → `null`, без выбора первого/более слабой цели.
  - `incomplete pack search cannot prove uniqueness`: ошибка доступного pack → `null`, даже если другой pack дал одно совпадение; cold/empty index работает, private/non-Item packs не запрашиваются, недоступные кандидаты исключаются.
  - `unrelated identifier flags do not match`: только совпавший `linkedGoodId`/container ID не выбирает источник.
  - `source helpers preserve detached data`: metadata содержит canonical UUID, actor UUID не сохраняется, вход не изменён, остальные flags и игровые поля равны исходным; сравнение flags с/без metadata одинаково, включая изначально отсутствующий namespace.
- [ ] **2. Запустить `node --test tests/item-source-reference.test.mjs tests/item-source-resolver.test.mjs`.** До реализации новые импорты должны дать RED; причина — отсутствующие owners, не сломанные fixtures.
- [ ] **3. Реализовать helpers в указанных новых файлах.** UUID hints сначала проверяются по доступности pack, затем загружаются и проверяются как настоящие Item. Identity берётся из source flags (`sourceId`/соответствующий нормализованный `<sourceType>Id`) перед snapshot hints; source ID не сравнивается с произвольным document `_id`. Для legacy catalog docs ожидаемый тип определяет соответствующий typed ID без таблицы типов.
- [ ] **4. Реализовать staged lookup.** Приоритет: UUID → ID в packs → ID в мире → точное имя в packs → точное имя в мире. Неоднозначность или невозможность подтвердить уникальность завершают поиск с `null`. `getIndex({ fields: ["name", "type", "flags.rebreya-main"] })`; только Item packs, без `getDocuments()` и собственного кэша. Полные Documents загружаются для проверки matching candidates, не всего каталога.
- [ ] **5. Повторить focused-команду.** Ожидается 0 failed; проверить spies: нет sheet renders, writes/GM socket, скрытых pack reads и полного document scan. Зафиксировать результат в плане.

### Task 2: Сохранение источника без изменения мутаций и recovery

**Interfaces:** consumes helpers Task 1; `sanitizeEmbeddedItemData(itemData, { sourceUuid = "" } = {}) -> detached ItemData` остаётся private и сохраняет прежнее удаление `_id`, `_stats`, folder, sort, ownership. Новая metadata необязательна; saved snapshots не пересобираются.

- [ ] **1. Добавить поведенческие регрессии.** В `tests/group-inventory-migration.test.mjs` / `tests/inventory-simple-transfer.test.mjs` импорт standalone world Item без module flags сохраняет его UUID; импорт compendium Item сохраняет исходный UUID перед удалением stats. Разделение/копирование сохраняют существующую metadata. Совместимый ingress merge увеличивает количество и сохраняет прежнюю ссылку target; `captureInventoryTransferIdentity` с metadata и без неё равны. Существующий manual economics test сохраняет все assertions.
- [ ] **2. В `tests/storage-deposit-source.test.mjs` проверить provenance и stack-key parity.** Свежая row из standalone world/pack Item сохраняет его исходный UUID. `resolveStorageDepositSource()` для одного и того же Item с metadata и без неё даёт одинаковый `row.stackKey`; остальные flags, system/price/weight и canonical origin продолжают влиять как раньше. В `tests/runtime-graph-inventory.test.mjs` закрепить, что перенос дерева сохраняет уже имеющуюся metadata, legacy prepared recovery не получает её задним числом, а поддельный source UUID не создаёт graph authority.
- [ ] **3. Запустить новые регрессии с `--test-name-pattern` в указанных suites.** Сохранить конкретные RED на потере UUID/stack-key drift; существующие invariants могут проходить до изменений.
- [ ] **4. Подключить helper к существующему sanitizer и direct-document callers.** Передавать `document.uuid` из `#prepareImportedItemIngress`, `buildModelItemData` и других документных импортов, где документ уже загружен. Сведения из source flags/stats захватываются до sanitation только на свежем document-based входе с переданным source UUID; вызовы с уже сериализованным ItemData без этого аргумента сохраняют прежний clone/cleanup и существующую metadata. `#loadCraftGearSourceData()` возвращает detached source data с сохранённым UUID до sanitation, не меняя canonical pack/managed-ID validation. `buildItemRow` в `storage-deposit-source.js` захватывает источник из ещё доступного live Item до сериализации. `buildLootgenItemData(row, { allowPersistedItemData })` переносит эту metadata как обычный flag; ветка persisted `row.itemData` и saved ingress rows не обогащается задним числом.
- [ ] **5. В Storage fallback stack-key projection исключить только display metadata.** Inventory merge/transfer helpers уже выбирают игровые поля: их алгоритмы не переписывать. Не менять `itemInstanceFingerprint`, exact graph snapshots, mutation fingerprints, journal schema/version, `nativeImportSource`, saved rows и правила дебета. Runtime graph продолжает переносить имеющиеся source flags обычным способом.
- [ ] **6. Запустить `node --test tests/item-source-reference.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-simple-transfer.test.mjs tests/storage-deposit-source.test.mjs tests/runtime-graph-inventory.test.mjs tests/inventory-material-quantity.test.mjs`.** Ожидается 0 failed; проверить реальный provenance, merge parity, legacy resume и сохранение всех quantity/economics/authority assertions.

### Task 3: Generic API и клики в InventoryApp

**Interfaces:** public `RebreyaMainModule.resolveItemSource(itemOrData, hints = {}) -> Promise<Item | null>` делегирует Task 1. Новый UI helper `openInventoryItemSource(item, { moduleApi, hints = {} } = {}) -> Promise<"journal" | "sheet" | null>` выбирает источник/fallback и использует прежний `openInventoryItem`; JournalRecord сначала идёт в прежний viewer.

- [ ] **1. Расширить `tests/inventory-app-context.test.mjs`.** Алхимия/custom/manual/future Item получают кнопку `data-action="open-item-source"` с `data-item-id`, source hints остаются доступными; JournalRecord имеет прежний action. Helper передаёт API live Item и hints, открывает выбранный Document ровно один раз; `null`/resolver error открывает разрешённый inventory Item; отказ прав не рендерит sheet. JournalRecord не вызывает resolver.
- [ ] **2. В UI interaction fixture проверить группу.** Handler захватывает `this.inventoryActorId` до `await`, вызывает `getInventoryActor({ create: false, groupActorId })`, берёт именно itemId на этом actor. Смена active group во время ожидания не подменяет документ. Отсутствующий Item даёт сообщение без создания actor. Render/context не вызывает resolver или pack scan.
- [ ] **3. Дополнить snapshot tests.** `canOpenEntry === true` для всех реальных Item, включая алхимию/manual/custom; экономический `sourceType`, source ID, цена/масса/quantity и `canSell/canDismantle` остаются прежними. До изменения продукта новые assertions должны дать RED.
- [ ] **4. Подключить API и UI.** Добавить import и public method в `scripts/main.js`; сохранить `openTradeEntry()` целиком. Снять type whitelist только с `canOpenEntry`, заменить handler/template action на общий путь по live Item. Чтение `#openItemSheet` также не создаёт inventory actor. При отсутствии доступного Item использовать существующие notifications/scoped refresh; новая форма или mutation route не создаётся.
- [ ] **5. Запустить `node --test tests/item-source-resolver.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs tests/storage-app.test.mjs`.** Ожидается 0 failed. Проверить Journal viewer, ordinary Item sheets, manual invariants и исходный baseline из 273 тестов без удаления проверок.

### Task 4: Документация, выпуск и итоговая проверка

**Interfaces:** публикует release `1.4.377` и оба API через существующий `game.rebreyaMain` / `module.api`; старые versioned forwarders и чужие стабильные cache keys сохраняются.

- [ ] **1. Перед manifest edit закрепить новую версию и loadable forwarder в `tests/module-manifest.test.mjs`.** Ожидаемый RED — прежняя `1.4.376`/отсутствующий новый файл. Сохранить проверки всех прежних forwarders и единого URL stateful clock/inventory owners; не ослаблять regex/assertions ради прохождения.
- [ ] **2. Повысить `module.json` и создать forwarder из одной строки `import "./main.js";`.** Обновить incoming imports изменённых owners и согласованный clock/inventory runtime graph до нового cache key. Для новых helpers использовать один canonical URL во всех импортерах. Не переписывать старые forwarders и не обновлять не связанное с изменением содержимое каталогов/автоматизаций.
- [ ] **3. Обновить паспорт и README.** Записать сигнатуры helpers/resolver/UI owner, порядок выбора источника, права, отсутствие mutation authority, сохранение source metadata и focused tests. Описать public `resolveItemSource` и кликабельность любого inventory Item. Паспорт описывает финальный код.
- [ ] **4. Запустить release/focused checks.** `node --test tests/module-manifest.test.mjs tests/inventory-transfer-imports.test.mjs` плюс affected suites после новых изменений; ожидается 0 failed и один fresh URL каждого stateful owner.
- [ ] **5. Выполнить независимую проверку финального diff.** Проверяющий сверяет source priority, permissions, ambiguity, source preservation, manual economics и legacy/recovery contracts со спецификацией. Gemini используется для ограниченных проверок; заключительный независимый reviewer проверяет весь product diff. Проверить важные замечания по оригинальному коду; исправления закреплять regression test до product edit.
- [ ] **6. Проверить живой Foundry, если доступен.** Алхимия; unique world custom; произвольный pack Item; duplicate name; отсутствующий источник; JournalRecord; доступ игрока. Если активного тестового мира/доступа нет, зафиксировать ограничение без заявления о live QA.
- [ ] **7. Выполнить один полный прогон перед product commit.** `node --test tests/*.test.mjs`, `git diff --check`; tracked JS/MJS через `node --check`, tracked JSON через `ConvertFrom-Json`. Новые JS/MJS включить отдельным syntax check либо explicit staging перед tracked enumeration. Сохранить passed/failed/skipped counts и реальные ошибки; повторять только affected checks после исправлений.
- [ ] **8. Проверить содержательный `git diff`, `git diff --stat`, stage только файлы этой задачи и `git diff --cached --check`.** Повторить Git preflight при изменившемся remote/working tree; чужие изменения или remote lich ahead останавливают публикацию. Commit: `fix: resolve source links for all inventory items`; `git push -u origin lich_branch`, без force push. Проверить чистое состояние и совпадение с remote.
- [ ] **9. Дополнить этот план отчётом.** Spec/plan paths, product commit, версия, команды и counts, вклад Gemini/reviewer, пределы live QA; объяснить пользователю именно итоговое поведение.

## Pre-implementation Evidence

- Baseline: `lich_branch`, HEAD `73c6de65`; проверенное расхождение с origin/main — 49 commits ahead, 0 behind; remote lich совпадает. До записи этого плана working tree была чистой. Повторить fetch/preflight перед правками.
- `node --test tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs tests/storage-app.test.mjs` — 273 passed, 0 failed до product edits.
- Gemini проверил design/spec и supplied identity owners: display metadata не входит в inventory merge/transfer projections; Storage fallback stack keys используют raw flags. Эти выводы сверены с исходным кодом. Строгие prepared graph snapshots не ослабляются.
- Проверены [Foundry v13 CompendiumCollection](https://foundryvtt.com/api/v13/classes/foundry.documents.collections.CompendiumCollection.html) (`visible`, `getIndex({ fields })`, `getDocument`) и [Foundry v13 Item](https://foundryvtt.com/api/v13/classes/foundry.documents.Item.html) (`testUserPermission`, наследование прав embedded Item и role permissions compendium).

## Execution Report

Заполняется при выполнении после подтверждения плана. Product edits ещё не начаты.
