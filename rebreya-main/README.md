# Rebreya Main

Модуль экономической подсистемы сеттинга Rebreya для Foundry VTT.

README описывает **актуальную механику из кода модуля**: окна интерфейса, формулы, роли ГМа/игроков, структуру данных и API.

## 1. Совместимость

- Foundry VTT: `v13` (minimum/verified).
- Основной сценарий: `dnd5e`.
- Module ID: `rebreya-main`.
- Точка входа: `scripts/main.js`.

## 2. Что умеет модуль

- Загружает и нормализует экономические данные мира (`goods/regions/cities/reference/materials/gear`).
- Строит экономическую модель: производство, спрос, дефицит/профицит, самообеспечение, маршруты импорта.
- Отображает окна:
  - экономика мира;
  - экономика города;
  - мировые торговые связи;
  - карточка отдельной связи;
  - государства (налоги/пошлины/описания);
  - глобальные ивенты;
  - партийный склад, группа, крафт, календарь;
  - лавки города;
  - лутген;
  - справочные карточки.
- Ведет состояние мира через world-settings (перекрытия связей, политика государств, состояния торговцев, партия/крафт/календарь, ивенты).
- Синхронизирует world-компендиумы:
  - `world.rebreya-materials`;
  - `world.rebreya-gear`;
  - `world.rebreya-magic-items`.
- Расширяет dnd5e-листы персонажа/предметов (вкладка «Кукла героя», дополнительные поля ранга/слотов и типы предметов).

## 3. Быстрый старт

1. Активируйте модуль в мире.
2. На `ready` модуль загрузит датасет и синхронизирует компендиумы.
3. Откройте панель инструментов сцены:
   - `Экономика` (ГМ);
   - `Инвентарь` (все);
   - `Календарь` (все);
   - `Лутген` (ГМ).
4. В «Экономике» откройте город/связи/государства/ивенты/инвентарь.

## 4. Архитектура

- `scripts/data/importer.js`: загрузка JSON из встроенной папки модуля или custom-пути.
- `scripts/data/normalizer.js`: нормализация и alias-маппинг входных полей.
- `scripts/engine/economy-engine.js`: расчет модели экономики и маршрутов.
- `scripts/data/repository.js`: кэш/пересборка модели и сохранение ручных override-данных.
- `scripts/data/global-events-service.js`: жизненный цикл и модификаторы глобальных ивентов.
- `scripts/data/trader-service.js` + `scripts/engine/trader-engine.js`: генерация и обслуживание лавок.
- `scripts/data/inventory-service.js`: партийный склад/группа/монеты/запасы/энергия.
- `scripts/data/crafting-service.js`: очередь крафта.
- `scripts/data/calendar-service.js`: календарь и лунные фазы.

## 5. Окна и интерфейс

### 5.1 Экономика мира

Файл: `scripts/ui/economy-app.js`

- Сводка по городам и фильтры (поиск, государство, регион, тип, сортировка).
- Кнопки:
  - «Восстановить данные» (сброс ручных правок мира);
  - «Перезагрузить данные»;
  - переходы к связям, государствам, ивентам, инвентарю.
- Отдельные блоки:
  - активные глобальные ивенты;
  - топ дефицитов/профицитов;
  - обзор по государствам/регионам.

### 5.2 Экономика города

Файл: `scripts/ui/city-app.js`

Табы:
- `Обзор`: паспорт города, активные ивенты, критические дефициты/профициты, ключевые связи.
- `Товары`: баланс по каждой товарной позиции.
- `Торговые связи`: импорт/экспорт, переключение активности связи.
- `Торговля`: список городских лавок.
- `Debug`: коэффициенты региона, модификаторы, предупреждения импорта.

### 5.3 Мировые торговые связи

Файл: `scripts/ui/trade-routes-app.js`

- Поиск и фильтры по государству/статусу.
- Сортировки: полезность, доп. цена, имя.
- На карточке связи:
  - toggle on/off;
  - редактирование доп. цены (%);
  - отображение ивент-источников и риск-заметок.

### 5.4 Карточка торговой связи

Файл: `scripts/ui/trade-route-app.js`

- Паспорт маршрута (источник/цель/тип).
- Ручные параметры (описание, доп. цена).
- Глобальная аналитика: что и куда проходит по этой связи.

### 5.5 Государства

Файл: `scripts/ui/states-app.js`

- Редактирование описания государства.
- Поля политики:
  - налог государства;
  - общая пошлина;
  - двусторонние пошлины по выбранным государствам.
- Отдельно показываются эффективные значения с учетом ивентов и их дельта.

### 5.6 Глобальные ивенты

Файл: `scripts/ui/global-events-app.js`

- Список ивентов: поиск, фильтр статуса, действия (редактировать, дублировать, включить/выключить, активировать/деактивировать, удалить).
- Импорт стартовых шаблонов.
- Редактор в формате **пошагового мастера (5 шагов)**:
  - шаг 1: что произошло;
  - шаг 2: где действует (scope);
  - шаг 3: товары/категории;
  - шаг 4: эффекты;
  - шаг 5: даты и продвинутые параметры.
- Есть быстрое создание (30 сек) и черновики.

### 5.7 Инвентарь группы

Файл: `scripts/ui/inventory-app.js`

Табы:
- `Инвентарь`: склад, монеты, дроп предметов, разбор на материалы.
- `Группа`: участники, роли, суточный расход еды/воды, груз, энергия, инструменты.
- `Крафт`: очередь задач, выбор крафтера, прогресс по дням.
- `Календарь`: дата, фазы луны, переход дней/недель/месяцев.

### 5.8 Лавка

Файл: `scripts/ui/trader-app.js`

- Ассортимент лавки (цены, количество, категории).
- Покупка предметов у лавки выбранным персонажем.
- Продажа в лавку drag-and-drop из листа персонажа с предпросмотром цены и налога.
- Редактирование портрета и описания лавочника.

### 5.9 Лутген

Файл: `scripts/ui/lootgen-app.js`

- Параметры генерации: ранги, число строк, бюджет value.
- Источники: снаряжение, материалы, магические предметы, монеты.
- Результат можно переносить в партийный склад построчно или целиком.
- Для ГМа есть шаринг результата в окно-«просмотрщик» через сокет.

### 5.10 Справочная карточка

Файл: `scripts/ui/reference-info-app.js`

- Сводные факты по государству/региону/режиму перемещения.
- Редактируемое описание (ГМ).

### 5.11 Кукла героя (dnd5e)

Файлы: `scripts/integrations/dnd5e-sheet-extensions.js`, `scripts/data/hero-doll-service.js`

- Добавляет вкладку «Кукла героя» на лист персонажа.
- Drag-and-drop экипировки по слотам.
- Поддерживает перенос из партийного склада в инвентарь персонажа и резервирование слотов.

## 6. Экономическая механика

### 6.1 Базовые метрики

Для каждой товарной строки в городе:

- `balance = production - demand`
- `deficit = max(0, demand - production)`
- `surplus = max(0, production - demand)`

Для города/государства/региона:

- `totalProduction = sum(production)`
- `totalDemand = sum(demand)`
- `totalDeficit = sum(deficit)`
- `totalSurplus = sum(surplus)`
- `selfSufficiencyRate = min(totalProduction / totalDemand, 1)` (если спрос > 0, иначе 1)

### 6.2 Локальная цена и импорт

Локальный коэффициент цены для товара:

- если `localSupply <= demand`: `1`
- если `localSupply > demand`: `clamp(demand / localSupply, 0.2, 1)`

Для маршрута считается суммарная наценка пути:

- `totalMarkupPercent = sum(stepMarkupPercent + additionalPricePercent по каждому плечу)`

Финальный ценовой модификатор товара в городе:

- средневзвешенная цена локального предложения + импорта;
- `routePriceModifierPercent = averagePriceMultiplier - 1`;
- `priceModifierPercent = clamp(routePriceModifierPercent + eventPriceModifierPercent, -0.8, +∞)`.

### 6.3 Торговые связи

- Связь может быть выключена вручную (`CONNECTION_STATES`) или ивентом (`disableRoute`).
- У связи есть ручная доп. цена (`TRADE_ROUTE_OVERRIDES.additionalPricePercent`).
- Аналитика связи строится по фактическому использованию в импортных цепочках.

## 7. Лавки и торговля

### 7.1 Формирование лавок

- Число профильных лавок города: `1 + (ранг города * 2)`.
- Всегда добавляются еще 2 спец-лавки:
  - лавка материалов;
  - лавка магических предметов.
- Ожидаемое число лавок: `profileSlots + 2`.

### 7.2 Бюджет ассортимента по рангу

`TRADER_RANK_VALUE_MAP`:

| Ранг | Бюджет value |
|---|---:|
| 1 | 1 000 |
| 2 | 2 500 |
| 3 | 5 000 |
| 4 | 10 000 |
| 5 | 15 000 |
| 6 | 25 000 |
| 7 | 35 000 |
| 8 | 40 000 |
| 9 | 75 000 |

### 7.3 Приоритет профильной лавки

- `priorityScore = basePriority + profileModifier - effectiveRarityPenalty`
- `effectiveRarityPenalty = max(0, rarityPenalty - floor((max(1, cityRank)-1)/3))`

### 7.4 Ограничение инструментов

При генерации ассортимента инструментальные товары ограничены:

- суммарная доля value инструментов <= `20%` бюджета (`TOOL_VALUE_SHARE_LIMIT = 0.2`).

### 7.5 Цены в лавке

Цена позиции рассчитывается через `applyMarketPrice(basePriceGold, modifierPercent, baseWeight)`:

- `rawPrice = basePriceGold * (1 + modifierPercent)`;
- если `rawPrice >= 0.01`: цена = `rawPrice`;
- если `rawPrice < 0.01`: цена фиксируется в `0.01`, а вес увеличивается пропорционально.

### 7.6 Покупка у лавки

- Игрок выбирает покупателя (Actor).
- Проверяется количество и монеты покупателя.
- Предмет переносится в инвентарь покупателя (со слиянием по sourceType/sourceId).

### 7.7 Продажа в лавку

- Предмет перетаскивается в dropzone.
- Строится предпросмотр:
  - рыночная цена города;
  - налог государства;
  - чистая выплата.
- Формулы:
  - `grossOffer = marketPrice`
  - `tax = grossOffer * taxPercent`
  - `netPayout = grossOffer - tax`

## 8. Партийный склад, группа, энергия

### 8.1 Склад

- Автосоздаваемый actor: `Инвентарь группы Rebreya`.
- Поддержка валют `pp/gp/sp/cp` и конвертации.
- Запасы:
  - еда (`фнт.`);
  - вода (`галлоны`, 1 галлон = 8 фнт веса).

### 8.2 Роли и расход

Роли участников группы:

- `member`: 1 еда/день, 1 вода/день
- `mount`: 4 еда/день, 4 вода/день
- `transport`: 0/0

### 8.3 Энергия

- База: `3` дня.
- `energyMax = max(1, 3 + CON_mod)` (или override).
- При дневном списании, если участнику не хватило еды/воды, энергия уменьшается.
- Восстановление энергии возможно за счет расхода запасов.

## 9. Крафт

### 9.1 Запуск задачи

Для предмета снаряжения:

- требуется материал `~50%` от веса предмета (`min 0.1 lb`);
- при нехватке материала задача не ставится;
- если нужен инструмент и его нет у крафтера, задача блокируется.

### 9.2 Прогресс

- `progressTarget = priceGold * quantity`
- `progressPerDay = max(1, 5 + tool.mod + (tool.prof ? 2 : 0))`

### 9.3 Завершение

- Каждый день прогресс увеличивается.
- По достижении цели предмет добавляется в партийный склад.
- При отмене задачи материал возвращается.

## 10. Календарь

- Формат даты: `YYYY-MM-DD` (UTC).
- Переходы: день/неделя/месяц.
- Лунный цикл: `28.8` дня, вывод текущей фазы.
- При переходе по времени:
  - обновляется активация глобальных ивентов;
  - запускаются суточные циклы (запасы/энергия/крафт, если включено);
  - в начале каждого месяца выполняется обновление ассортимента лавок.

## 11. Глобальные ивенты: логика

### 11.1 Scope

Ивент может быть на:

- весь мир;
- конкретные государства/регионы/города;
- конкретные товары или товарные категории;
- конкретные маршруты (from -> to).

При сборке payload из мастера:

- если выбран хотя бы 1 город, используются города;
- иначе если выбран хотя бы 1 регион, используются регионы;
- иначе используются государства;
- для товаров: если выбраны товары, категории игнорируются; иначе берутся категории.

### 11.2 Триггер и длительность

- `manual` / `date` / `dateRange`.
- Длительность: `instant` / `untilDisabled` / `dateRange`.

### 11.3 Сложение эффектов

Режимы stacking:

- `stack`: эффекты суммируются;
- `highestOnly`: берется только максимальное значение;
- `lowestOnly`: берется только минимальное;
- `overrideByPriority`: берется один по приоритету/updatedAt.

### 11.4 Режимы числовых эффектов

- `flat`: прибавить абсолютное значение.
- `addPercent`: умножить на `(1 + value)`.
- `multiply`: умножить на `value`.
- `override`: жестко установить значение.

## 12. HELP для мастера: эффекты глобальных ивентов

Список соответствует редактору ивентов.

| Эффект в UI | Влияние | Где видно/применяется |
|---|---|---|
| Производство товаров | Меняет `production` выбранных товаров в зоне ивента. | Экономика города/мира, дефицит/профицит. |
| Спрос на товары | Меняет `demand`. | Экономика города/мира, дефицит/профицит. |
| Цена товаров | Добавляет ценовой модификатор товара. | Импортная аналитика и цены материалов/снаряги через связанный товар. |
| Налоги государства | Меняет `taxPercent` политики государства. | В окне государств (эффективные ставки), в продаже предметов в лавку. |
| Торговые пошлины | Меняет `generalDutyPercent`. | Эффективная ставка в окне государств, наценка импортных маршрутов и витринная цена в лавках (через импортную долю). |
| Двусторонняя пошлина | Меняет bilateral duty с целевыми государствами. | Окно государств + наценка импорта между конкретными парами государств и влияние на цены в лавках при импорте этих товаров. |
| Цена выкупа у торговца | Модификатор цены, по которой лавка выкупает предмет у персонажа. | Sale preview в окне лавки. |
| Цена продажи у торговца | Модификатор витринной цены покупки у лавки. | Список товаров лавки. |
| Размер ассортимента торговцев | Модификатор количества (`stockPercent`). | Объем ассортимента лавки при построении snapshot. |
| Скрыть товары из продажи | Блокирует товар у лавок (`blockedByEvents`). | Позиции скрываются из окна лавки. |
| Сделать товары доступнее | Снимает/ослабляет блокировку доступности (противовес block). | Влияет на доступность у лавок. |
| Редкость товаров | Сдвиг редкости (метаданные/модификатор). | Учитывается в merchant modifiers и отображении. |
| Стоимость маршрутов | Увеличивает/уменьшает наценку связи (`additionalPricePercent`). | Мировые связи, карточка связи, импортные цены. |
| Пропускная способность маршрутов | Меняет `eventRouteCapacityPercent` и лимит импорта по пути. | Показ в карточках маршрутов и прямое ограничение доступного объёма импорта. |
| Полностью перекрыть маршруты | Делает связь неактивной на время действия. | Мировые связи/городские связи. |

Дополнительно в движке есть типы `routeRiskNote`, `merchantRestockMode`, `merchantCategoryBoost`, `selfSufficiencyModifier`, `importNeedMultiplier`:

- `routeRiskNote`: текстовая риск-заметка на связи.
- `merchantCategoryBoost`: доп. буст ассортимента по merchant-фильтрам.
- `importNeedMultiplier`: добавка к спросу через канал importNeed.
- `selfSufficiencyModifier`: влияет на `importNeedMultiplier` товара и итоговую самообеспеченность (включая сводки state/region).
- `merchantRestockMode`: участвует в runtime-сбросе ассортимента (`updated` / `merged` / `frozen`) при месячном обновлении торговцев.

## 13. Компендиумы

### 13.1 Материалы

- Пак: `world.rebreya-materials`.
- Тип документов: `Item` (`loot`).
- Синхронизация на инициализации и на перезагрузке данных.

### 13.2 Немагическое снаряжение

- Пак: `world.rebreya-gear`.
- Классификация в `weapon/equipment/tool/consumable/loot` с dnd5e-совместимыми subtype/baseItem.
- Для предметов выставляются служебные flags Rebreya (rank, material, slot, subtype и т.д.).

### 13.3 Магические предметы

- Пак: `world.rebreya-magic-items`.
- Источник: `magicItem.js`.
- В flags сохраняются `magicItemId`, `rank`, `value`, `rarity`, `itemSlot`, `heroDollSlots` и др.

## 14. Настройки модуля

World settings:

- `showEconomyButton`: показывать кнопку экономики.
- `debugMode`: расширенные debug-данные.
- `dataSourceMode`: `builtin` или `custom`.
- `customDataPath`: путь к пользовательским JSON.
- `displayPrecision`: точность отображения чисел.
- `globalEventsEnabled`: включить подсистему ивентов.
- `globalEventsNotifications`: уведомления по ивентам.
- `globalEventsAutoRecalc`: пересборка модели при смене ивентов.
- `globalEventsShowPublic`: видимость публичных ивентов игрокам.
- `globalEventsDebug`: debug-лог модификаторов ивентов.

Скрытые state settings (хранилище runtime):

- `traderState`, `partyState`, `craftState`, `calendarState`;
- `connectionStates`, `tradeRouteOverrides`, `statePolicies`, `referenceNotes`;
- `globalEventsState`, `globalEventsDraft`.

## 15. Права доступа

### Только ГМ

- Глобальные ивенты (окно и редактирование).
- Лутген (генерация и перенос результатов).
- Сброс/восстановление world override-данных.
- Управление партийным state (большинство операций склада/группы/крафта).

### Игроки (при наличии прав на актеров/предметы)

- Открытие склад/календарь/часть UI окон.
- Торговля в лавке выбранным персонажем.
- Просмотр публичных ивентов (если включено в настройках и ивент не `gmOnly`).

## 16. API для макросов (`game.rebreyaMain`)

Примеры:

```js
// Экономика
await game.rebreyaMain.openEconomyApp();
await game.rebreyaMain.openCityApp("city-id");

// Глобальные ивенты
await game.rebreyaMain.openGlobalEventsApp();
await game.rebreyaMain.createGlobalEvent(payload);

// Инвентарь и календарь
await game.rebreyaMain.openInventoryApp({ tab: "inventory" });
await game.rebreyaMain.advanceCalendarDays(1, { consumeSupplies: true, applyEnergy: true, processCraft: true });

// Лавки
await game.rebreyaMain.openTrader("city-id", "shop-food-store");

// Лутген
await game.rebreyaMain.openLootgenApp({ newWindow: true });
```

### 16.1 Полный каталог методов API

Объект API доступен как:

- `game.rebreyaMain`
- `game.modules.get("rebreya-main")?.api`

Группы методов:

- Экономика и окна:
  - `getModel(options?)`
  - `reloadData(options?)`
  - `resetWorldData(options?)`
  - `refreshOpenApps()`
  - `openEconomyApp()`
  - `openCityApp(cityId)`
  - `openWorldTradeRoutesApp()`
  - `openTradeRouteApp(connectionId)`
  - `openStatesApp()`
  - `openReferenceInfoApp(entryType, entryId)`
- Города/связи/государства:
  - `getCitySnapshot(cityId)`
  - `getTradeRouteSnapshot(connectionId)`
  - `getTradeRouteBaseSnapshot(connectionId)`
  - `getTradeRoutes()`
  - `hasTradeRouteAnalytics()`
  - `prepareTradeRouteAnalytics(options?)`
  - `setConnectionActive(connectionId, isActive)`
  - `updateTradeRouteMetadata(connectionId, patch)`
  - `getStatePolicies()`
  - `getEffectiveStatePolicy(stateId, targetStateId?, currentDate?)`
  - `updateStatePolicy(stateId, patch)`
  - `updateReferenceDescription(entryType, entryId, description)`
- Глобальные ивенты:
  - `handleGlobalEventsConfigChange()`
  - `getAllGlobalEvents()`
  - `getActiveGlobalEvents(currentDate?)`
  - `getEventsAffectingCity(cityId, currentDate?)`
  - `getEventsAffectingCityGood(cityId, goodId, currentDate?)`
  - `getEventsAffectingRoute(fromCityId, toCityId, currentDate?, connectionId?)`
  - `getEventsAffectingState(stateId, currentDate?)`
  - `createGlobalEvent(data)`
  - `updateGlobalEvent(id, patch)`
  - `deleteGlobalEvent(id)`
  - `duplicateGlobalEvent(id)`
  - `importDefaultGlobalEventTemplates()`
  - `openGlobalEventsApp()`
- Лавки:
  - `isTraderIntegrationAvailable()`
  - `getCityTraderSummaries(cityId)`
  - `getTraderSnapshot(cityId, traderKey, options?)`
  - `openTrader(cityId, traderKey, options?)`
  - `openTraderSheet(cityId, traderKey, options?)`
  - `purchaseTraderItem(cityId, traderKey, itemKey, quantity, options?)`
  - `createTraderSalePreview(cityId, traderKey, dropData)`
  - `sellTraderItem(cityId, traderKey, preview, quantity)`
  - `updateTraderMetadata(cityId, traderKey, patch)`
- Инвентарь/группа:
  - `openInventoryApp(options?)`
  - `openPartyInventorySheet()`
  - `getInventorySnapshot(options?)`
  - `getPartySnapshot(options?)`
  - `addPartyMember(actorId)`
  - `removePartyMember(actorId)`
  - `updatePartyDefaults(patch)`
  - `updatePartyMember(actorId, patch)`
  - `updatePartyMemberTool(actorId, toolId, patch?)`
  - `setPartyMemberEnergy(actorId, currentEnergy)`
  - `restorePartyMemberEnergy(actorId, days?)`
  - `updateInventoryItemQuantity(itemId, nextQuantity)`
  - `deleteInventoryItem(itemId)`
  - `importInventoryDrop(dropData)`
  - `addModelItemToInventory(sourceType, sourceId, quantity?)`
  - `breakInventoryItemToMaterial(itemId, quantity?)`
  - `addPartySupply(resourceKey, quantity)`
  - `consumePartySuppliesOneDay(options?)`
  - `updatePartyCurrency(values)`
  - `convertPartyCurrency(mode?)`
  - `getRebreyaToolCatalog()`
- Крафт:
  - `getCraftSnapshot(options?)`
  - `queueCraftTask(payload?)`
  - `cancelCraftTask(taskId)`
  - `processCraftOneDay()`
- Календарь:
  - `getCalendarSnapshot()`
  - `setCalendarDate(year, month, day)`
  - `advanceCalendarDays(days?, options?)`
  - `advanceCalendarWeeks(weeks?, options?)`
  - `advanceCalendarMonths(months?, options?)`
- Лутген:
  - `openLootgenApp(options?)`
  - `shareLootgenResult(payload)`
  - `unregisterLootgenApp(appKey)`
- Открытие справочных записей:
  - `getMaterialByGoodId(goodId)`
  - `openMaterialByGoodId(goodId)`
  - `openMaterialById(materialId, fallbackName?)`
  - `openGearById(gearId, fallbackName?)`
  - `openMagicItemById(magicItemId, fallbackName?)`
  - `openTradeEntry(sourceType, sourceId, sourceName?)`

## 17. Структура данных

Основные файлы `data/`:

- `goods.json`
- `regions.json`
- `cities.json`
- `reference.json`
- `materials.json`
- `gear.json`

`reference.json` хранит, в том числе, режимы транспорта, служебную статистику импорта и предупреждения.

## 18. Импорт данных

Скрипты в `tools/`:

- `import-xlsx.ps1` — основной импорт экономики в `goods/regions/cities/reference`.
- `import-materials.ps1` — импорт материалов + синтетические материалы для отсутствующих goods.
- `import-gear.ps1` — импорт снаряжения (включая `shopSubtype`) в `gear.json`.

Примеры запуска:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\import-xlsx.ps1 -WorkbookPath "D:\path\economy.xlsx" -OutputDir ".\data"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\import-materials.ps1 -WorkbookPath "D:\path\materials.xlsx" -GoodsPath ".\data\goods.json" -OutputPath ".\data\materials.json"
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\import-gear.ps1 -WorkbookPath "D:\path\gear.xlsx" -MaterialsPath ".\data\materials.json" -OutputPath ".\data\gear.json"
```

Подробности по колонкам импорта предметов: `docs/foundry-item-fields.md`.

## 19. Важные ограничения текущей версии

- В репозитории есть интеграционный файл `scripts/integrations/item-piles-dnd5e.js`; если он не вызван из `main.js`, интеграция не активируется автоматически.
- Импорт в текущей модели считается покомпонентно для каждого города; глобальная конкуренция городов за один и тот же экспортный излишек источника пока не симулируется.

## 20. Диагностика

Если интерфейс работает некорректно:

- Проверьте, что модуль активирован и `game.rebreyaMain` существует.
- Нажмите «Перезагрузить данные» в окне экономики.
- Проверьте world settings источника данных (`builtin/custom`).
- Смотрите консоль Foundry: большинство ошибок логируются с префиксом `rebreya-main | ...`.

### 20.1 Ошибка `You must define at least one entry in config.buttons`

Симптом:

- не открывается создание/редактирование в «Глобальных ивентах»;
- в консоли ошибка `Failed to open global event editor ... config.buttons`.

Причина:

- несовместимая конфигурация диалога (разный формат `buttons` для разных классов Dialog).

Проверка/решение:

- убедиться, что используется актуальный `scripts/ui/global-events-app.js`, где кнопки редактора формируются через адаптер `buildEditorDialogButtons(...)`;
- перезапустить Foundry после обновления файла;
- если мир открывался долго без перезагрузки клиента, закрыть и заново открыть браузерную вкладку Foundry.

### 20.2 Лутген не добавляет магические предметы

Проверьте по порядку:

- в лутгене включен флаг `Магические предметы`;
- `magicPercent` больше `0` (при `0` шанс магии нулевой);
- диапазон рангов (`Мин/Макс`) пересекается с рангами в магическом компендиуме;
- существует и заполнен компендиум `world.rebreya-magic-items` (после `Перезагрузить данные` в экономике);
- бюджет `value` достаточно большой для выбранных рангов.

Важно:

- если в выбранном диапазоне нет доступных предметов (с учетом фильтров/бюджета), генератор берет только доступные обычные позиции или завершает подбор.

### 20.3 Почему в описании магпредмета не видно `value`

Это не обязательно ошибка.

- В лутгене используется поле `flags.rebreya-main.value` (или fallback от цены).
- В карточке магпредмета строка «Оценка» показывается от `priceGold` и может отсутствовать, если у источника `priceGold = 0`/пусто.
- Поэтому отсутствие «Оценки» в тексте описания и расчет `value` в лутгене могут расходиться.

Практика:

- для прозрачности экономики держите заполненным `value`/`priceGold` в исходнике `magicItem.js`.

### 20.4 Быстрая проверка синхронизации магического компендиума

1. Откройте «Экономика» -> «Перезагрузить данные».
2. Проверьте наличие пака `world.rebreya-magic-items`.
3. Откройте любой магический предмет и убедитесь, что у него есть флаги `rebreya-main.magicItemId`, `rank`, `value`.

---

README поддерживается как рабочая документация к текущей кодовой базе. При изменении механик обновляйте этот файл синхронно с кодом.
