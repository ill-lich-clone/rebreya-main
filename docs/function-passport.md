# Rebreya Main: паспорт функций и подсистем

Этот документ содержит подробные точки реализации, владельцев, data flow и профильные тесты. Начинай с корневого `AGENTS.md`, находи нужный раздел через `rg` и не загружай паспорт целиком без прямой необходимости.

## Контракт актуальности паспорта

`docs/function-passport.md` — обязательная часть реализации, а не историческая заметка. Любое изменение поведения должно в том же commit обновлять соответствующий паспорт ниже.

Обновление обязательно, если изменение:

- добавляет, удаляет, переименовывает или меняет контракт публичного метода `game.rebreyaMain`;
- добавляет или меняет service/repository, владельца данных, world setting, Actor/Item flag или managed pack;
- добавляет или меняет typed socket command, payload, `validate`, `authorize`, active-GM route или mutation journal;
- добавляет hook, ApplicationV2-окно, integration с dnd5e/сторонним модулем или новый refresh scope;
- переносит ответственность между файлами либо меняет последовательность чтения, мутации, компенсации или UI refresh;
- добавляет функциональную область или focused-тест, который становится основным доказательством поведения.

В затронутом паспорте укажи новые методы с сигнатурами, назначение, владельца, путь данных, ограничения и тесты. При удалении функции удали или замени её запись. Внутренний helper документируй только тогда, когда он становится архитектурной точкой входа или меняет границу ответственности. Хронологический changelog здесь не ведётся: документ всегда описывает текущее состояние.

Definition of Done: код, тесты, `README.md` при изменении публичного контракта и затронутые разделы `docs/function-passport.md` согласованы между собой. Изменение без актуализации паспорта считается незавершённым.

Перед commit выполни `git diff --name-only` и `git diff --cached --name-only`. Если изменён функциональный файл в `scripts/`, `data/`, `templates/`, `styles/` или `module.json`, соответствующее изменение `docs/function-passport.md` должно быть в том же staged scope. Исключение — чисто внутренний refactor без изменения контракта, владельца, data flow и точки реализации; это исключение должно быть очевидно из diff.

## Паспорт функций и подсистем

### 1. Composition root и публичный API

- **Зачем:** собрать зависимости один раз, провести Foundry lifecycle и дать макросам стабильную точку входа.
- **Владелец:** `scripts/main.js`; manifest и версия — `module.json`; versioned `scripts/main-<version>.js` является только forwarder к `main.js`.
- **Внешняя поверхность:** `game.rebreyaMain` и `game.modules.get("rebreya-main")?.api` ссылаются на один экземпляр `RebreyaMainModule`.
- **Lifecycle:** `init` регистрирует settings/helpers/types/ранние patches; `setup` подключает socket listener; `ready` создаёт API, hooks, managed packs и runtime-сервисы; `initialize()` выполняет фактическую загрузку.
- **Координационные методы:** `getModel(options)`, `reloadData({ notify, rerender })`, `resetWorldData({ notify })`, `refreshOpenApps()`. `initialize()`, `handleSocketMessage()`, `runInventoryMutation()` и профильные `refresh*Views()` внутренние и не являются обычным macro API.
- **Куда править:** новую доменную операцию сначала реализуй в профильном сервисе; в `main.js` оставь валидацию входа, выбор local/socket route, вызов сервиса и точечный refresh.
- **Нельзя:** создавать второй composition root, помещать расчёты в hooks, регистрировать один hook в нескольких местах или добавлять новую привилегированную операцию в legacy socket switch.
- **Тесты:** `tests/main-composition-root.test.mjs`, `tests/module-manifest.test.mjs`, `tests/main-notifications.test.mjs`.

### 2. Active GM, typed sockets и надёжные мутации

- **Зачем:** сериализовать world-state, исключить двойное исполнение и безопасно выполнять player-инициированные операции на GM.
- **Владельцы:** `scripts/infrastructure/foundry/active-gm.js`, `socket-command-bus.js`, `scripts/application/world-mutation-coordinator.js`, `durable-mutation-journal.js`.
- **Протокол:** `rebreya.command` / `rebreya.command.result`; request коррелируется по `requestId + command + userId`, лимит envelope — 65 536 байт, timeout — 10 секунд.
- **Путь мутации:** UI/API формирует минимальный payload → `SocketCommandBus` проверяет transport sender → `validate` → `authorize` с реальным Foundry User → active GM вызывает `execute` → repository/coordinator сериализует запись → результат возвращается инициатору → composition root запускает scoped refresh.
- **Идемпотентность:** повтор одного operation/request ID возвращает сохранённый результат. Многошаговая операция обязана иметь journal/transaction workflow и terminal state; `reconciliation-required` нельзя удалять автоматически.
- **Куда править:** общую корреляцию — `socket-command-bus.js`; правила доступа — рядом с регистрацией команды; конкурирующую запись — в repository/coordinator; фазы восстановления — в journal/workflow.
- **Нельзя:** доверять `senderId` из payload, делать UI `get setting -> mutate -> set`, выполнять команду на неактивном GM или повторять списание после потерянного acknowledgement.
- **Тесты:** `tests/world-mutation-infrastructure.test.mjs`, `tests/durable-mutation-journal.test.mjs`, `tests/security.test.mjs` и профильный `*-socket.test.mjs`/`*-command-dispatch.test.mjs`.

### 3. Экономика, города, товары и торговые маршруты

- **Зачем:** загрузить каноническую модель мира и рассчитать снабжение, спрос, цены, связи и аналитические snapshots без UI-зависимостей.
- **Владельцы:** чтение/кэш — `scripts/data/repository.js` (`EconomyRepository`); presentation overrides — `scripts/data/city-presentation-overrides.js` и тот же repository; расчёты — `scripts/engine/economy-engine.js`; представления — `scripts/engine/selectors.js`.
- **Источники:** `data/goods.json`, `regions.json`, `cities.json`, `reference.json`, `materials.json`, `gear.json`; 300 базовых city panoramas — tracked WebP в `assets/cities/`. `cities.json` и `tools/import-xlsx.ps1` используют только runtime-путь `modules/rebreya-main/assets/cities/<имя города>.webp`, поэтому public City view не зависит от Foundry Data/assets вне модуля. `normalizeCities()` принимает source-поля `image`/`img` и сохраняет канонический путь в city model вместе с `description`; presentation read model получает оба поля уже из нормализованной модели. Runtime overrides живут в world settings, а не переписывают source JSON. Hidden world setting `cityPresentationOverrides` хранит только непустые отличия `description`/`image` известных городов и возвращается detached после нормализации.
- **Внешние методы:** `getCitySnapshot(cityId)`, `getPublicCitySnapshot(cityId)`, `getPublicEconomySnapshot()`, `getCityPresentation(cityId)`, `updateCityPresentation(cityId, patch = {})`, `resetCityPresentation(cityId, fields = ["description", "image"])`, `getTradeRouteSnapshot(connectionId)`, `getTradeRouteBaseSnapshot(connectionId)`, `getTradeRoutes()`, `hasTradeRouteAnalytics()`, `prepareTradeRouteAnalytics({ rerender })`, `setConnectionActive(connectionId, isActive)`, `updateTradeRouteMetadata(connectionId, patch)`, `getReferenceEntrySnapshot(entryType, entryId)`, `updateReferenceDescription(entryType, entryId, description)`.
- **Presentation repository:** `getCityPresentationOverrides()`, `getCityPresentations()`, `getCityPresentation(cityId)`, `updateCityPresentation(cityId, patch = {})`. Bulk merge читает setting один раз; `null` и пустая строка удаляют override поля и восстанавливают source value; неизвестный `cityId` отклоняется. Публичная mutation проходит только через composition root, где обязан стоять GM authorization boundary.
- **Public read models:** `buildPublicCitySnapshot({ model, city, presentation, traders, tradersError })`, `buildPublicEconomySnapshot(model, cityPresentations = {})`, `selectPublicCityRows(cities, filters)`, `buildPublicFilterOptions(cities, selectedState = "all")` из `scripts/application/public-economy-read-model.js`. Городской `materialRows` включает только материалы с непустым `linkedGoodId`, то есть связанные с обычным товаром городской экономики; material price/weight для оставшихся строк делегирует `getMaterialPriceModifier()` и `applyMarketPrice()` Trader Engine. Общий public economy snapshot остаётся полным и берёт base price/weight из materials и мировой deficit из `model.overview.deficitGoods`. Player projections не содержат production/demand/balance/surplus, процентные modifiers, routes, policies, events или audit.
- **UI:** `scripts/ui/economy-app.js`, `city-app.js`, `trade-routes-app.js`, `trade-route-app.js`, `reference-info-app.js` и одноимённые templates.
- **Куда править:** формулу — engine; нормализацию исходников — repository/data importer; shape карточки — selector/UI; persisted override — composition method + setting/repository.
- **Composition flow:** public reads получают модель/repository presentation и возвращают detached safe read model; ошибка trader summaries локализуется в `tradersError`. `updateCityPresentation`/`resetCityPresentation` отклоняют player до repository access, после authoritative записи вызывают только `refreshCityViews({ cityIds: [cityId] })`; reset с пустым списком разрешённых полей не пишет setting.
- **Нельзя:** считать цену в template/UI, мутировать snapshot или смешивать source data с world override.
- **Тесты:** `tests/city-normalizer.test.mjs` фиксирует перенос source panorama в нормализованную city model; `tests/city-public-assets.test.mjs` проверяет 300 путей и точное множество module-owned WebP без внешней папки Data/assets; `tests/economy-city-connections.test.mjs`, `tests/city-presentation-overrides.test.mjs`, `tests/public-economy-read-model.test.mjs`, профильные tests сервисов/окон, `tests/main-composition-root.test.mjs` для wiring/authorization и `tests/ui-refresh-coordinator.test.mjs` для scoped city refresh.

### 4. Глобальные события и политики государств

- **Зачем:** накладывать датированные модификаторы на города, товары, маршруты, государства и категории торговцев.
- **Владелец:** `scripts/data/global-events-service.js` (`GlobalEventsService`); persisted state — `globalEventsState`, draft — `globalEventsDraft`, политики — `statePolicies`.
- **Чтение:** `getAllGlobalEvents()`, `getActiveGlobalEvents(currentDate)`, `getEventsAffectingCity(cityId, currentDate)`, `getEventsAffectingCityGood(cityId, goodId, currentDate)`, `getEventsAffectingRoute(fromCityId, toCityId, currentDate, connectionId)`, `getEventsAffectingState(stateId, currentDate)`, `getStatePolicies()`, `getEffectiveStatePolicy(stateId, targetStateId, currentDate)`.
- **Мутации:** `createGlobalEvent(data)`, `updateGlobalEvent(id, patch)`, `deleteGlobalEvent(id)`, `duplicateGlobalEvent(id)`, `importDefaultGlobalEventTemplates()`, `updateStatePolicy(stateId, patch)`.
- **UI:** `scripts/ui/global-events-app.js`, `states-app.js`; composition handler `handleGlobalEventsConfigChange()` инвалидирует кэш/обновляет нужные окна.
- **Куда править:** фильтры/эффекты/видимость — `GlobalEventsService`; форму и GM controls — UI/template; настройку — `scripts/main.js` registration и config-change handler.
- **Нельзя:** применять gmOnly event игроку, считать active event без календарной даты или держать modifier cache без полной dataset signature.
- **Тесты:** отдельного global-events-service test сейчас нет. Косвенное покрытие находится в `tests/calendar-transition-coordinator.test.mjs`, `group-context-service.test.mjs`, `trader-service.test.mjs`, `trader-foundry-trade-operations.test.mjs`, `security.test.mjs`. Первое изменение логики `GlobalEventsService` должно добавить отдельный focused-тест.

### 5. Торговцы, покупки, продажи и audit rollback

- **Зачем:** строить ассортимент торговца и проводить денежно-предметные операции идемпотентно и восстанавливаемо.
- **Владельцы:** каталог/ассортимент — `scripts/data/trader-service.js`; durable state/audit — `scripts/infrastructure/foundry/trader-state-repository.js`; транзакции — `scripts/features/trading/trade-transaction-service.js`, `trade-sale-transaction-workflow.js`, `trade-rollback-workflow.js`.
- **Внешние методы:** `isTraderIntegrationAvailable()`, `getCityTraderSummaries(cityId)`, `getTraderSnapshot(cityId, traderKey, options)`, `purchaseTraderItem(cityId, traderKey, itemKey, quantity, options)`, `createTraderSalePreview(cityId, traderKey, dropData)`, `sellTraderItem(cityId, traderKey, preview, quantity, options)`, `updateTraderMetadata(cityId, traderKey, patch)`, `recordTraderAudit(operation)`, `getTradeAuditLog()`, `rollbackTraderAuditEntry(entryId, options)`.
- **Окна:** `openTrader(cityId, traderKey, options = {})`, `openTraderV2(cityId, traderKey, options = {})`, `openTraderSheet(cityId, traderKey, options = {})` обязаны делегировать единственному `scripts/ui/trader-app-v2.js`. Открытие городского торговца и покупка не авторизуются по travel state или текущему местоположению группы; права на Actor и сами transaction commands остаются обязательными.
- **Typed commands:** `trader.purchase`, `trader.sell`; authorization проверяет владение Actor покупателя/продавца. UI сохраняет operation ID при неоднозначном timeout.
- **Куда править:** ассортимент/цены — `TraderService`; фазы debit/create/rollback — trading workflows; persistence и pruning — `TraderStateRepository`; отображение — Trader V2.
- **Нельзя:** создавать второй Trader app, платить/списывать до durable marker, повторять timeout-операцию с новым ID или удалять nonterminal audit rows.
- **Тесты:** `tests/trader-service.test.mjs`, `trader-state-repository.test.mjs`, `trade-purchase-transaction.test.mjs`, `trade-sale-transaction.test.mjs`, `trade-rollback-transaction.test.mjs`, `trader-command-dispatch.test.mjs`, `trader-ui-transaction-lifecycle.test.mjs`.

### 6. Группы и партийный контекст

- **Зачем:** определить активную dnd5e-группу, её участников и единый scope для inventory, календаря, travel, downtime и транспорта.
- **Владельцы:** разрешение контекста — `scripts/data/group-context-service.js`; persisted group state — `scripts/infrastructure/foundry/group-state-repository.js`.
- **Внешние методы:** `getGroupRegistry()`, `getGroupContext(options)`, `registerPartyGroup(groupActorId)`, `setActivePartyGroup(groupActorId)`, `mergeLegacyInventoryIntoGroup(groupActorId)`, `addPartyMember(actorId)`, `removePartyMember(actorId)`, `updatePartyDefaults(patch)`, `updatePartyMember(actorId, patch)`, `updatePartyMemberTool(actorId, toolId, patch)`.
- **UI:** `scripts/ui/groups-app.js`, партийная часть `inventory-app.js`, `party-inventory-crest.js`.
- **Путь данных:** Actor группы + `GroupStateRepository`; операция должна захватить group ID до первого `await` и после ожидания проверить, что scope/authority не сменились.
- **Куда править:** выбор/нормализацию группы — `GroupContextService`; persisted registry/roles — repository; карточки и drag/drop — Groups/Inventory UI.
- **Нельзя:** использовать глобальный active group после `await` без captured scope, хранить дублирующий партийный state в новом месте или разрешать участнику чужой группы мутацию.
- **Тесты:** `tests/group-context-service.test.mjs`, `group-state-repository.test.mjs`, `group-command-dispatch.test.mjs`, `group-inventory-migration.test.mjs`, `groups-app.test.mjs`.

### 7. Партийный инвентарь, валюты и припасы

- **Зачем:** управлять предметами/валютой/припасами активной группы и переносами к персонажам с recovery после частичной записи.
- **Владелец:** `scripts/data/inventory-service.js`; hook reconciliation — `scripts/integrations/inventory-sync.js`; UI — `scripts/ui/inventory-app.js`.
- **Чтение:** `getInventorySnapshot(options)`, `getPartySnapshot(options)`, `getRebreyaToolCatalog()`.
- **Мутации:** `updateInventoryItemQuantity(itemId, nextQuantity)`, `deleteInventoryItem(itemId)`, `takeInventoryItemToCharacter(itemId, options)`, `sellInventoryItem(itemId, quantity)`, `importInventoryDrop(dropData)`, `addModelItemToInventory(sourceType, sourceId, quantity)`, `breakInventoryItemToMaterial(itemId, quantity)`, `addPartySupply(resourceKey, quantity)`, `consumePartySuppliesOneDay(options)`, `updatePartyCurrency(values)`, `convertPartyCurrency(mode)`, `updatePartyMemberTool(actorId, toolId, patch)`, `setPartyMemberEnergy(actorId, currentEnergy)`, `restorePartyMemberEnergy(actorId, days)`.
- **UI-ввод чисел:** `promptNumericValue({ title, label, value, min, step, confirmLabel, allowRelative })` и `promptCurrencyDialog(currency)` создают диалоги с HTML `pattern`, совместимыми с Unicode Sets (`v`); `parseQuantityInputValue(rawValue, fallback, { relative, min })` и `parseCurrencyInputValue(rawValue, fallback)` превращают абсолютный или знаковый ввод в нормализованное значение до вызова API.
- **Typed commands:** `inventory.take`, `inventory.sale`, `inventory.import`, `inventory.currency.update`, `inventory.currency.convert`; каждый payload проходит exact-key validation и group/Actor authorization.
- **Надёжность:** многошаговые переносы используют `inventoryMutationJournal`; terminal marker/receipt отделяется от preview и UI state.
- **Куда править:** экономику переноса — `InventoryService`; Foundry create/update/delete hook — `inventory-sync.js`; форму/drag/drop — `inventory-app.js`; refresh только через `refreshInventoryViews({ actorIds })`.
- **Нельзя:** удалять source Item до доказанного создания target, рендерить все Actor sheets или повторять ambiguous operation с новым mutation ID.
- **Тесты:** `tests/inventory-mutation-recovery.test.mjs`, `inventory-sync-hooks.test.mjs`, `inventory-app-context.test.mjs`, `inventory-header-motion.test.mjs`, `party-inventory-crest.test.mjs`.

### 8. Хранилища, контейнеры и piles на сцене

- **Зачем:** открывать scene storage, переносить строки/монеты, принимать deposits и поддерживать portable container hierarchy.
- **Владельцы:** orchestration — `scripts/data/storage-service.js`, privileged commands — `storage-command-service.js`, Item operations — `storage-container-item-service.js`, snapshot — `storage-container-snapshot.js`, piles — `storage-ground-pile-service.js`, неизменяемый каталог встроенных прототипов — `builtin-storage-presets.js`, active-GM lifecycle встроенных Actor — `builtin-storage-actor-service.js`.
- **Внешние методы:** `openStorage(tokenUuid, request)`, `getStorageSnapshot(tokenUuid, request)`, `claimStorageRow(tokenUuid, rowId, destination, mutationId, request)`, `claimStorageCoins(tokenUuid, destination, mutationId, request)`, `inspectStorageDepositSource(dragData)`, `depositStorageItem(tokenUuid, source, quantity, mutationId, request)`, `configureStorageToken(tokenUuid, config, request)`, `markStorageActor(actorUuid)`, `addManualStorageItem(tokenUuid, itemUuid, request)`, `removeManualStorageItem(tokenUuid, rowId, request)`, `updateStorageRowQuantity(tokenUuid, rowId, quantity, request)`, `deleteStorageRow(tokenUuid, rowId, request)`, `resetStorageToken(tokenUuid, request)`, `setStorageTextureMode(tokenUuid, mode, request)`, `dropPortableStorageItemToScene(itemUuid, request)`, `dropStorageItemToScene(itemUuid, request)`, `moveStorageTokenToCharacter(tokenUuid, actorUuid, mutationId, request)`, `buildBuiltinStorageActorData(preset, folderId)`, `BuiltinStorageActorService.sync()`.
- **Встроенные Actor:** `buildBuiltinStorageActorData(preset, folderId)` клонирует immutable preset в unlinked NPC prototype с независимым storage state; `sync()` только на active GM создаёт отсутствующие Actor, сохраняет содержимое и пользовательские правки существующих Actor и мигрирует лишь scene-токены с автоматически унаследованным именем. Поток данных: `BUILTIN_STORAGE_PRESETS` → active-GM sync → Actor prototype → guarded scene-token migration.
- **Typed commands:** `storage.open`, `storage.claim-row`, `storage.claim-coins`, `storage.deposit`, `storage.drop-item-to-scene`, `storage.restore-portable`, `storage.token-to-character`.
- **Journal reference rows:** `isStorageJournalRow(row)` identifies a canonical reference-only row `{ rowKind: "journal", rowId, sourceId, sourceType: "journal", name, img, quantity: 1 }`. Snapshot normalization rejects a missing `sourceId`, strips `itemData`, and preserves the reference and row ID through rekeying and portable flags. Portable materialization never resolves or embeds a Journal as an Item; capture restores unclaimed references from stored manual/generated rows into `manualRows`, deduplicated by `rowId`.
- **Integrations/UI:** `scripts/integrations/storage-*.js`; `scripts/ui/storage-app.js`, `storage-transfer-ui.js`, `storage-token-overlay.js`.
- **Куда править:** access — `storage-access.js`; object classification — `storage-object-kind.js`; snapshot shape — snapshot service; document mutation — item/command service; UI-only behavior — UI/integration.
- **Нельзя:** обходить access check, создавать container cycles, доверять drag payload без повторного UUID resolve, смешивать presentation state с authoritative Item quantity, перезаписывать пользовательское имя scene-токена или заменять состояние текстур/содержимое существующего встроенного Actor. В каталог не входят `writing-desk`, `pantry-cupboard`, `storage-bench` и `wooden-crate-*`.
- **Тесты:** весь кластер `tests/storage-*.test.mjs`, особенно `storage-service`, `storage-access`, `storage-socket`, `storage-container-hierarchy`, `storage-deposit-source`, `storage-container-snapshot.test.mjs`, `storage-container-item-service.test.mjs`; каталог и lifecycle встроенных Actor — `tests/builtin-storage-presets.test.mjs`, `tests/builtin-storage-actor-service.test.mjs`.

### 9. Календарь и переходы даты

- **Зачем:** хранить дату/время активной группы и атомарно проводить все доменные стадии пересечённых дней/месяцев.
- **Владельцы:** state patch/read — `scripts/data/calendar-service.js`; многостадийный move/retry/resume — `calendar-transition-coordinator.js`.
- **Внешние методы:** `getCalendarSnapshot()`, `previewCalendarTransition(options)`, `setCalendarTimeOfDay(seconds, options)`, `setCalendarDate(year, month, day, options)`, `shiftCalendarDays(days, options)`, `advanceCalendarDays(days, options)`, `advanceCalendarWeeks(weeks, options)`, `advanceCalendarMonths(months, options)`.
- **Typed commands:** `group.calendar.patch` меняет отдельные поля; `group.calendar.transition` проводит сериализованный переход на active GM.
- **Порядок:** preview без мутации → durable transition claim → calendar persistence → crossed-day downtime/supplies/events/trader stages → terminal precommit/complete → scoped refresh.
- **Куда править:** арифметику/normalization — `CalendarService`; очередность, failover и resume — coordinator; доменный callback — composition root с captured group scope.
- **Нельзя:** проводить daily/monthly side effects при движении назад, глотать незавершённый journal или менять дату напрямую из UI.
- **Тесты:** `tests/calendar-service.test.mjs`, `calendar-transition-coordinator.test.mjs`.

### 10. Downtime, запросы и проекты персонажей

- **Зачем:** хранить доступные недели, заявки, проверки, статусы и долгие проекты участников группы.
- **Владельцы:** authoritative group state — `scripts/data/downtime-service.js`; actor-facing mapping/forms — `character-downtime-service.js`; календарное выполнение — `downtime-scheduler.js`; managed activities — `downtime-compendium.js`.
- **Внешние методы:** `getDowntimeSnapshot(options)`, `getDowntimeActionCatalog()`, `grantDowntimeWeeks(payload)`, `revokeDowntimeWeeks(payload)`, `clearDowntimeHistory()`, `createDowntimeRequest(payload, options)`, `updateDowntimeRequest(payload, options)`, `setDowntimeRequestStatus()`, `setDowntimeRequestChecks()`, `recordDowntimeCheckResult()`, `continueDowntimeProject()`, `closeDowntimeProject()`.
- **UI:** downtime tab через `scripts/integrations/dnd5e-sheet-extensions.js`; общая административная поверхность — `inventory-app.js`.
- **Куда править:** lifecycle/status/storage — `DowntimeService`; character form/context — `CharacterDowntimeService`; crossed-date scheduling — scheduler; definition каталога — data + compendium.
- **Нельзя:** доверять сохранённой preview-цене/длительности после изменения каталога, закрывать unfinished long project как history или мутировать Actor не из captured group.
- **Тесты:** `tests/downtime-service.test.mjs`, `character-downtime-service.test.mjs`, `downtime-scheduler.test.mjs`, `downtime-compendium.test.mjs`, `dnd5e-sheet-downtime-tab.test.mjs`.

### 11. Крафт и долговременные craft projects

- **Зачем:** рассчитывать рецепт/материалы/время, утверждать проект и безопасно списывать материалы/создавать результат.
- **Владельцы:** правила — `scripts/data/crafting-rules.js`; orchestration — `crafting-service.js`; downtime adapter — `craft-downtime-service.js`; дневная обработка — `craft-project-processor.js`.
- **Внешние методы:** `getCraftSnapshot(options)`, `previewCraftDowntimeRequest(payload)`, `getCraftApprovalQuote(input)`, `approveCraftDowntimeRequest(input)`, `queueCraftTask(payload)`, `cancelCraftTask(taskId)`, `processCraftOneDay()`, `pauseCraftProject()`, `resumeCraftProject()`, `cancelCraftProject()`, `reconcileCraftProject()`.
- **Надёжность:** `craftMutationJournal` фиксирует prepared → materials-debited → task-persisted → output-created/committed либо compensated/reconciliation-required.
- **Куда править:** формулу/валидацию — rules; списание/создание/recovery — `CraftingService`; связь с downtime — adapter; календарный progress — processor.
- **Нельзя:** использовать preview как authoritative quote, создавать output до durable debit marker или автоматически удалять reconciliation-required.
- **Тесты:** `tests/crafting-rules.test.mjs`, `crafting-service.test.mjs`, `craft-downtime-service.test.mjs`, `craft-project-processor.test.mjs`.

### 12. Путешествия, карта и транспорт

- **Зачем:** строить маршрут, считать время/прогресс, синхронизировать group token и расходовать топливо конкретного транспорта.
- **Владельцы:** travel state/plan — `scripts/data/travel-service.js`; token projection — `travel-map-service.js`; instance state — `transport-instance-service.js`; fuel — `transport-fuel-service.js`; managed actors — `transport-compendium.js`.
- **Внешние методы:** `getTravelSnapshot()`, `setTravelRoute(payload)`, `setTravelSpeedMultiplier(value)`, `advanceTravelHours(hours, options)`, `clearTravelRoute()`, `getTransportSnapshot(options)`, `importTransportIntoGroup(payload)`, `updateTransportInstanceState(payload)`, `selectTransportFuel(payload)`, `updateTransportFuelConsumption(payload)`, `setActiveTransport(id)`.
- **Typed commands:** `group.travel.replaceState`, `group.transport.replaceState`, `group.transport.importActor`, `group.transport.updateActorState`, `group.transport.selectFuel`, `group.transport.updateFuelConsumption`.
- **Integrations:** `scripts/integrations/transport-group-drop.js`, `transport-vehicle-sheet.js`; данные сети — `data/travel-network.json`.
- **UI:** верхняя сводка Inventory показывает маршрут только при доступном плане; менеджер может очистить сохранённый маршрут ПКМ по карточке через `clearTravelRoute()`.
- **Куда править:** path/timing/progress — TravelService; map coordinates/token — TravelMapService; world Actor instance — TransportInstanceService; consumption — fuel service; sheet/drop — integrations.
- **Нельзя:** хранить запас топлива вторично во flag транспорта, блокировать travel из-за warning расхода, принимать forged canonical identity или применять stale replacement повторно.
- **Тесты:** `tests/travel-*.test.mjs`, `transport-*.test.mjs`.

### 13. Lootgen, шаблоны и выдача из ChatMessage

- **Зачем:** сгенерировать добычу по бюджету, сохранить пользовательский шаблон и выдать строки/монеты ровно один раз.
- **Владельцы:** генерация — `scripts/data/lootgen-generator.js`; template catalog — `lootgen-template-catalog.js`; durability/appearance — профильные `lootgen-*.js`; claims — `scripts/application/loot-claim-service.js`.
- **Внешние методы:** `listLootgenTemplates()`, `getLootgenTemplate(id)`, `saveLootgenTemplate(payload)`, `removeLootgenTemplate(id)`, `generateStorageLoot(form)`, `shareLootgenResult(payload)`, `createLootgenChatMessage(payload, options)`, `claimLootgenChatRow(lootId, rowId, options)`, `claimLootgenChatCoins(lootId, options)`, `claimLootgenChatRowToInventory(lootId, rowId, options)`, `claimLootgenChatAllToInventory(lootId, options)`, `restoreLootgenClearFromChat(messageId)`, `addLootgenRowToInventory(row)`, `addLootgenCoinsToInventory(coins, mutationId)`.
- **UI:** `scripts/ui/lootgen-app.js`, `lootgen-chat.js`, `lootgen-type-filters.js`; authoritative claim state — `flags.rebreya-main.lootgenChat` плюс managed loot Actor.
- **Внутренняя координация:** `handleLootgenChatItemCreated(item, userId)` связывает Foundry create hook с claim state; `unregisterLootgenApp(appKey)` обслуживает registry открытых окон. Не вызывай их как macro API.
- **Куда править:** random/budget fill — generator; save/load schema — catalog; idempotency/recovery — LootClaimService; card interaction — chat UI.
- **Нельзя:** считать текст ChatMessage authoritative inventory, выдавать без claim marker/mutation ID или удалять source раньше target receipt.
- **Тесты:** `tests/lootgen-generator.test.mjs`, `lootgen-template-catalog.test.mjs`, `lootgen-chat.test.mjs`, `loot-claim-service.test.mjs`, остальные `lootgen-*.test.mjs`.

### 14. Прочность, разрушение и upgrades

- **Зачем:** нормализовать durability, применить повреждение/поломку/уничтожение и устанавливать upgrades в пределах capacity.
- **Владельцы:** legacy/item durability — `scripts/data/durability-service.js`; native dnd5e objects — `native-object-durability-service.js`; rules — `durability-rules.js`; upgrades — `item-upgrade-service.js`.
- **Внешние методы:** `initializeItem()`, `damageItem()`, `damageDurabilityTarget()`, `resolveDurabilityOutcome()`, `breakItem()`, `destroyItem()`, `getDurability()`, `isBroken()`, `installItemUpgrade(hostItem, upgradeItem, options)`, `removeItemUpgrade()`, `setItemUpgradeCapacity()`.
- **Typed command:** `durability.target.damage`; mutation journal — hidden setting durability journal, зарегистрированный composition root.
- **Integrations/UI:** `scripts/integrations/durability-hooks.js`, `item-upgrade-sheet.js`, `scripts/ui/durability-outcome-dialog.js`.
- **Куда править:** формулы/thresholds — rules; routing native/legacy — integrations; Actor/Item mutation — соответствующий service; sheet controls — integration/UI.
- **Нельзя:** одновременно маршрутизировать Item в native и legacy service, уничтожать без outcome/recovery path или считать UI capacity authoritative.
- **Тесты:** `tests/durability-*.test.mjs`, `native-object-durability-service.test.mjs`, `native-durability-*.test.mjs`, `item-upgrade-service.test.mjs`.

### 15. Managed-компендиумы и каталоги

- **Зачем:** публиковать стабильные world-паки из source data, сохраняя UUID и пользовательские документы.
- **Общий владелец lifecycle:** `scripts/data/managed-compendium-sync.js`; папки/icons/helpers — `compendium-utils.js`.
- **Паки:** materials, gear, magic items, feats, states, backgrounds, race features/races, spells, class features/subclasses/classes, actions, downtime и transport обслуживаются одноимёнными `*-compendium.js`.
- **Публичное открытие документов:** `getMaterialByGoodId(goodId)`, `openMaterialByGoodId(goodId)`, `openMaterialById(materialId, fallbackName)`, `openGearById(gearId, fallbackName)`, `openMagicItemById(magicItemId, fallbackName)`, `openFeatById(featId, fallbackName)`, `openBackgroundById(backgroundId, fallbackName)`, `openStateById(stateId, fallbackName)`, `openTradeEntry(sourceType, sourceId, sourceName)`. `syncFeatsFromWorldCompendium(options)` — internal coordination, не macro API.
- **Источники:** `data/*.json`; magic items — корневой `magicItem.js`; feats — `feat.js` + overrides. Эти runtime-источники не удалять как документы.
- **Инварианты:** уникальный source ID; stable document ID; signature-based update; create missing/update changed/delete only stale managed; unmanaged не удаляется; dependency packs синхронизируются до consumers.
- **Куда править:** shape конкретного Item/Actor — профильный compendium builder; общий diff lifecycle — только managed sync; source content — канонический data-файл и importer/tool.
- **Нельзя:** `delete all -> create all`, менять stable ID без миграции, удалять unmanaged collision или строить UUID до синхронизации dependency pack.
- **Тесты:** `tests/managed-compendium-sync.test.mjs`, `compendium-utils.test.mjs` и профильные `*-compendium.test.mjs`/`*-data.test.mjs`.

### 16. Боевые статусы, реакции, атаки и космология

- **Зачем:** единообразно применять статусы/ресурсы реакции и проводить weapon/firearm/reaction resolution.
- **Владельцы:** статусы — `scripts/combat/status-service.js` + `status-definitions.js`; реакции — `reaction-queue-service.js` + `reaction-capability-index.js`; атаки — `attack-service.js`, roll boosts — `attack-roll-boost-service.js`.
- **Внешние методы:** `getCombatStatusDefinitions()`, `normalizeCombatStatusId(statusInput, fallback)`, `getCombatStatus(actorOrId, statusInput)`, `setCombatStatus(actorOrId, statusInput, options)`, `clearCombatStatus(actorOrId, statusInput, options)`, `setCombatStatusValue(actorOrId, statusInput, value, meta)`, `applyDecayingDamage(actorOrId, amount, options)`, `syncBloodiedStatuses()`, `getReactionState(actorOrId)`, `canUseReaction(actorOrId, requiredUses)`, `refreshReaction(actorOrId, options)`, `consumeReaction(actorOrId, options)`, `rollWeaponAttack()`, `rollFirearmAttack()`, `clearFirearmJam()`, `maintainFirearm()`, `resolveProvokedAttack()`, `resolveParry()`, `resolveInterception()`.
- **Typed command:** `combat.status.set`; environment-status может разрешаться владельцу source Actor, остальные privileged paths проверяют GM/ownership по конкретному контракту.
- **Hooks:** единая регистрация — `scripts/combat/hooks.js`; UI radial effects — `radial-status-effects.js`.
- **Космология:** расчёты Mechanus — `scripts/cosmology/mechanus-rolls.js`; явный нулевой dice count сохраняется как `0`, а advantage/disadvantage d20 всегда заменяет системный keep-результат первым брошенным кубом и отдельным сериализуемым `NumericTerm` `+2`/`-2`. `applyMechanusAveragesToRoll(roll, { enabled })` помечает усреднённые dice terms сериализуемым `options.rebreyaMechanusAverage`, валидирует добавленный advantage term и пересобирает `_formula` и `_total` из `terms`. `registerMechanusRollHooks(moduleApi)` регистрирует `preCreateChatMessage` для финальной границы сохранения и поздние `dnd5e.rollAttack` / `dnd5e.rollDamage` / `dnd5e.rollFormula`: activity rolls повторно нормализуются после `buildPost`, но до того, как MIDI сохранит workflow и отрисует HTML карточки. Внешние методы `getCosmologyState()`, `isMechanusEnabled()`, `setMechanusEnabled(enabled)`, `openCosmologyApp()`; typed command `cosmology.setMechanus`; UI — `scripts/ui/cosmology-app.js`.
- **Куда править:** status data/effects — status service; discovery/queue/ownership dialog — reaction services; attack math/workflow — attack service; registration only in combat hooks.
- **Нельзя:** prompt дважды по MIDI и fallback path, регистрировать hook в сервисе повторно или определять способность только по локализованному имени Item.
- **Тесты:** `tests/combat-status.test.mjs`, `combat-attack-service.test.mjs`, `attack-roll-boost-service.test.mjs`, `reaction-*.test.mjs`, `radial-status-effects.test.mjs`, `cosmology-mechanus-rolls.test.mjs`.

### 17. Классовые, расовые, feat и spell-автоматизации

- **Зачем:** связывать managed feature declarations с Foundry/dnd5e hooks без логики по одному отображаемому имени.
- **Владельцы:** профильные `scripts/combat/*-automation-service.js`; feat choices — `scripts/automation/feat-choice-service.js`; spell dispatch — `spell-automation-registry.js`, `spell-automation-hook-bridge.js`, `spell-automation-service.js`.
- **Spell instances/summons:** `spell-instance-runtime.js`, `spell-instance-operation-lease.js`, `summon-lifecycle-runtime.js`; typed commands `spell-instance-mutation`, `summon-lifecycle-mutation`.
- **Диагностика/расширение:** `getSpellAutomationDiagnostics()` возвращает состояние registry/runtime; `registerSummonProvider(provider)` подключает внешний summon provider через существующий lifecycle, а не через новый hook.
- **Craftsman:** constructor/gadget/zone/vehicle services; typed command `craftsman.gadget.mutate`; sheet/item hooks находятся в одноимённых integrations.
- **Sorcerer virtual-slot cooldown:** `SorcererAutomationService.handleCombatTurnChange(combat, updateData = {}, updateOptions = {})` владеет арифметикой `remaining`, сохранением Actor flag `sorcererAutomation.virtualSlotCooldowns` и best-effort обновлением связанных chat cards. Data flow: post-update `combatTurnChange(combat, previous, current)` → единственная регистрация в `scripts/combat/hooks.js` → только `isActiveGmClient(game)` для строго forward-перехода → сервис получает `current` с `{ direction: 1 }` → Actor flag сохраняется до `Promise.allSettled` обновлений card. Флаг реакционного заклинания первого уровня становится готовым при следующем ходе владельца и лист получает обновлённое document state.
- **Sorcerer damage parts:** helpers `cloneDamagePart(part = {})`, `serializeDamagePart(part = {})`, `setSpellDamageParts(activity, parts = [])`, `replaceSpellDamageTypes(activity, damageType)` и `appendSpellDamagePart(activity, part)` принадлежат `scripts/combat/sorcerer-automation-service.js`. Data flow: Draconic Dragon Spell, Draconic Ancestral Spell или пассивное Elemental Affinity → runtime `activity.damage.parts` с `part.types: Set` → cast-scoped source `activity.system.damage.parts` и `activity.item.system.damage.parts` с сериализуемым `types: string[]`. Ограничение: не передавать массив в runtime DamageData (`has()`/`first()` принадлежат Set-контракту) и не сохранять Set в document source; бонусные части остаются дедуплицированными по `_id`. Focused tests: `tests/sorcerer-automation-service.test.mjs` — Dragon Spell, Ancestral Spell, Elemental Affinity, совместное применение и несовпадающий тип.
- **Контракт:** primary lookup — identifier/sourceType/runtime flags/recipe+version; имя Item только fallback. Registry определяет runtime, bridge нормализует hook context, service исполняет recipe.
- **Куда править:** declaration/data — compendium definitions; runtime behavior — профильный service/recipe; hook normalization — bridge; registration — combat hooks или профильная integration registration.
- **Нельзя:** встраивать automation только в UI, дублировать dnd5e/MIDI paths, обходить operation lease или привязывать новую механику только к русскому имени. Для cooldown нельзя вызывать сервис из pre-update `combatTurn`/`combatRound`, полагаться на ownership инициатора, tick-ать rewind или регистрировать второго владельца; при отсутствии active GM обработчик безопасно no-op.
- **Тесты:** профильные `tests/*-automation-service.test.mjs`, включая `tests/sorcerer-automation-service.test.mjs` для active-GM post-update cooldown, первого участника нового раунда, отсутствия double tick, rewind, не-владельца и обновления card; `spell-automation-*.test.mjs`, `spell-instance-*.test.mjs`, `summon-lifecycle-*.test.mjs`, `feat-choice-automation.test.mjs`, craftsman cluster.

### 18. Long rest, Quest Log и сторонние integrations

- **Зачем:** подключать внешние lifecycle surfaces через узкие адаптеры, сохраняя доменную логику в сервисах.
- **Long rest:** `scripts/rest/long-rest-pipeline-service.js`; API `registerLongRestStep(definition)`, `runLongRestPipeline(actor, result, config)`, `getRecentLongRestRuns()`; hooks — `scripts/integrations/long-rest-hooks.js`.
- **Quest Log:** `scripts/data/quest-log-service.js` + `scripts/integrations/forien-quest-log.js`; UI enhancements покрываются quest tests/styles.
- **Map objects:** `createMapObjectToken(options)` делегирует `scripts/data/map-object-token-service.js`; macro adapter — `scripts/integrations/map-object-token-macro.js`. Координаты/scene validation принадлежат сервису, prompt/placement interaction — adapter.
- **dnd5e sheets:** `scripts/integrations/dnd5e-sheet-extensions.js`; held items/shield AC, universal belt, implants, upgrades и transport sheet живут в отдельных integrations.
- **Совместимость:** `effectmacro-compat.js`, `smalltime-compat.js`, `sm-airship-compat.js`, `transform-cleanup-compat.js`, `ration-food-conversion.js`; каждый adapter обязан безопасно no-op при отсутствии модуля/API.
- **Куда править:** orchestration шага — domain/pipeline service; перевод внешнего event/payload — integration; DOM sheet injection — профильная integration с idempotent registration.
- **Нельзя:** делать внешний модуль обязательным без manifest contract, патчить глобальный prototype без guard/libWrapper strategy или хранить доменное состояние только в DOM.
- **Тесты:** `tests/long-rest-*.test.mjs`, `quest-log-*.test.mjs` и одноимённые compatibility/integration tests.

### 19. ApplicationV2, templates и scoped refresh

- **Зачем:** отображать snapshots и отправлять commands, не владеть authoritative domain state.
- **Владельцы:** окна — `scripts/ui/*.js`; markup — `templates/*.hbs`; стили — `styles/*.css`; coalescing refresh — `scripts/infrastructure/ui/ui-refresh-coordinator.js`.
- **Открытие через API:** `openEconomyApp`, `openCityApp`, `openWorldTradeRoutesApp`, `openTradeRouteApp`, `openStatesApp`, `openGlobalEventsApp`, `openReferenceInfoApp`, `openInventoryApp`, `openGroupsApp`, `openPartyInventorySheet`, `openLootgenApp`, `openCosmologyApp`, `openStorageApp`, Trader V2 methods.
- **Data flow:** `_prepareContext`/эквивалент получает detached snapshot → template рисует → event handler вызывает public API/typed command → service возвращает authoritative result → `UiRefreshCoordinator` coalesces конкретный scope.
- **City view flow:** `openCityApp(cityId)` загружает City UI через versioned dynamic import, затем использует единственную cached instance. `CityEconomyApp._prepareContext()` повторно применяет `resolveCityViewMode({ isGM, requestedMode })`: player всегда получает только `getPublicCitySnapshot(cityId)`, GM по умолчанию сохраняет analytics/admin context и переключает ту же instance в public mode. Базовое `image` из city snapshot остаётся module-owned URL `modules/rebreya-main/assets/cities/<имя города>.webp` (world override может его заменить); `getFoundryAssetUrl(path)` передаёт в template `publicCityImageUrl` через `foundry.utils.getRoute()` и добавляет версию модуля как cache-bust query. `_onRender()` читает URL из `data-city-image-url` и задаёт hero CSS `background-image`, повторяя рабочий механизм шапки Inventory вместо отдельного `<img>` и его прежнего скрытия при `error`. Описание рисуется один раз, только в нижней вкладке `city`, а не поверх hero. Public tabs whitelisted как `city|market|traders`; `open-trader` делегирует только `moduleApi.openTrader(cityId, traderKey)` без travel authorization.
- **Economy view flow:** `EconomyApp._prepareContext()` для player сразу вызывает `getPublicEconomySnapshot()`, фильтрует только через `selectPublicCityRows`/`buildPublicFilterOptions` и не запрашивает mechanical model, summaries, events или audit; GM сохраняет прежний analytics context. Existing Economy tool в группе Scene Controls видим всем ролям при `showEconomyButton`, тогда как Groups/Cosmology/Lootgen остаются GM-only; карточки вызывают канонический `openCityApp(cityId)`.
- **Travel entrypoints:** кнопки исходного и конечного города в сводке маршрута используют существующий `travel-open-city` handler и вызывают тот же `openCityApp(cityId)`; отдельный listener, City app или проверка текущего местоположения не создаются.
- **Presentation UI adapters:** `resolveCityViewMode({ isGM = false, requestedMode = "admin" } = {})`, `promptCityDescription({ city, dialogClass } = {})`, `openCityImagePicker({ current = "", pickerClass, onSelected, onError } = {})` из `scripts/ui/city-presentation-ui.js`. Они собирают/нормализуют пользовательский ввод, но не пишут setting; GM mutation выполняют composition API `updateCityPresentation`/`resetCityPresentation`.
- **Refresh:** inventory обновляет только inventory и затронутые Actor IDs; downtime — своё окно/листы; cosmology — своё окно; background refresh не поднимает окно и не крадёт focus.
- **Внутренние refresh entrypoints:** `refreshInventoryViews({ actorIds })`, `refreshDowntimeViews({ actorIds })`, `refreshCosmologyViews()`, `refreshCityViews({ cityIds = [] } = {})`, `refreshOpenApps()`. `refreshCityViews` выбирает только канонические instances из единственного `cityApps` cache, пропускает закрытые/свёрнутые окна и рендерит без focus. Entry points вызываются после authoritative mutation result и не являются доменными командами.
- **Куда править:** context shape — UI adapter/selector; markup — HBS; theme/layout — CSS; cross-window scheduling — refresh coordinator/composition helper.
- **Нельзя:** писать world settings из UI, хранить единственную копию state в app instance, вызывать массовый `render()` или создавать parallel app для compatibility entrypoint.
- **Тесты:** `tests/ui-refresh-coordinator.test.mjs` (включая scoped city selection), `tests/main-composition-root.test.mjs`, `tests/city-public-ui.test.mjs`, `tests/economy-public-ui.test.mjs`, `tests/bg3-hotbar-compat.test.mjs`, `background-refresh-focus.test.mjs`, `style-theme.test.mjs` и профильные `*-app-context.test.mjs`/`*-ui.test.mjs`.

### 20. Диагностика и выбор точки реализации

- **Нет API:** проверь manifest entrypoint, ошибки `ready`, `game.modules.get("rebreya-main")?.api` и `tests/main-composition-root.test.mjs`.
- **Не записалось состояние:** найди owner setting/repository, active GM, command validation/authorization, operation ID и journal phase. `reconciliation-required` требует ручной сверки.
- **Не обновился UI:** найди authoritative mutation result и соответствующий `refresh*Views`; не лечи это глобальным render.
- **Не сработала automation:** проверь identifier/sourceType/runtime flags, recipe/version, Actor ownership, dnd5e/MIDI hook и registry diagnostics через `getSpellAutomationDiagnostics()`.
- **Не синхронизировался pack:** проверь active GM, managed/source/signature flags, stable ID collision и dependency order.
- **Как выбрать тест:** owner service → `<owner>.test.mjs`; typed command → `*-socket`/`*-command-dispatch`; recovery → `*-recovery`/transaction; UI → `*-app-context`/`*-ui`; compatibility → одноимённый integration test.
- **Как найти вход:** `rg -n "имяМетода|COMMAND_NAME|flag|hook" scripts tests README.md docs/function-passport.md`; затем читай только найденный service, composition wiring и focused-тест.
