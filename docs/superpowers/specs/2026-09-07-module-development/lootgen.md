# Лутген: улучшенные предметы и заполненные контейнеры

Общие ограничения: [основная спецификация](../2026-09-07-module-development-design.md). Запрос 4; этапы R8–R9 после R4. Полный R7 не обязателен: первая выдача использует существующие проклятья и уже реализованное простое подмножество R7. Статус simple-candidate сам по себе не разрешает выдачу.

## Текущие владельцы

scripts/data/lootgen-generator.js — normalizeLootgenForm(), generateLootgenResult(), aggregateRows(); scripts/data/lootgen-template-catalog.js; scripts/ui/lootgen-app.js, lootgen-chat.js; scripts/application/loot-claim-service.js; InventoryService.buildLootgenItemData() и ingress batch. Паспорт: 13.

isLootgenUpgrade() исключает отдельные upgrades из обычной лотереи. Это ограничение сохраняется: улучшение устанавливается на host, а не становится случайной отдельной строкой вместо готового предмета.

aggregateRows() сейчас использует sourceType/sourceId/broken; этого недостаточно для разных upgrades/contents. Claim routes сейчас доверяют source IDs/GM-authored chat state, а не player ItemData — контракт сохранить.

Контейнеры уже существуют: scripts/data/storage-container-snapshot.js (v1, depth limit 8), scripts/data/storage-container-item-service.js, StorageContainerItemService.materializeToActorOnce()/captureFromItem(); StorageService path traversal. Использовать их, не заводить второе дерево nestedLoot.

## R8: предмет с установленными усовершенствованиями

Форма: переключатель «Предметы с усовершенствованиями», вероятность 0..100, максимум улучшений на host в пределах его capacity, фильтр разрешённых типов/рангов. В старых templates флаг выключен; старый результат при тех же random inputs сохраняется.

Предлагаемый versioned result v2 хранит stable row ID и detached descriptor:
{instanceKey,sourceType,sourceId,quantity,isBroken,upgrades:[{sourceId,slotIndex,choices}],container:null|snapshot}.
quantity составной индивидуальной вещи равен 1; одинаковые экземпляры имеют разные instanceKey. Plain stacks сохраняют прежнюю агрегацию. Upgrades не сливаются только по имени или базовому sourceId.

Генерация: выбрать совместимые host и upgrades через rules R4 → посчитать полную цену → принять только если в remaining budget. Не выбирать сначала максимально дорогой base, затем безлимитно навешивать upgrades. Максимум attempts/кандидатов ограничен; отсутствие подходящих upgrades даёт обычный host или диагностируемый пропуск, не infinite retry.

Неизвестные обязательные choices не заполняются произвольно. Для генерации использовать только profiles с валидными default/разрешённым finite choices; иначе исключить variant с причиной. По уточнению пользователя новые сложные upgrades и профили без правила исключаются с пометкой «Усовершенствования нет в реализации». Разрешены существующие проклятья и простые доступные профили R4/R7; известная цена сама по себе не делает сложную механику доступной.

Строка результата показывает базовое имя, установленные улучшения, полную стоимость, описание автоматизации. Chat/сохранение/повторное открытие используют один immutable generated descriptor, не повторный random.

Материализация: создаются host и embedded upgrade children с новыми world IDs, затем согласованные installed links и system.container. Stable catalog IDs не заменяются document IDs. Snapshot/adapter ремапит hostItemId/itemId и не оставляет ссылки на исходный Actor/compendium. Активные эффекты появляются через обычный sync владельца, не через второй набор lootgen effects.

Authoritative выдача заново разрешает descriptor из trusted generated state. Typed payload клиента передаёт только lootId/row IDs/operation ID/выбор назначения. Direct выдача расширяется safe descriptor reference и GM-side validation, не произвольным ItemData. Все row-level claims одного host включают его upgrades.

## R9: заполненные хранилища

Форма: «Заполненные контейнеры», вероятность 0..100, максимальная глубина генерации. Рекомендуемый default 1; UI максимум 3. Existing storage runtime limit 8 не понижается; отдельный generation depth предотвращает взрыв дерева.

В лотерее участвуют только catalog rows, для которых подтверждён container profile и цена оболочки. В первой версии не генерировать динамические triggers, ловушки, рекурсивные templates или Journal rewards. Существующие содержащиеся объекты при переносе не теряются.

Алгоритм:
1. Зарезервировать общий coin budget прежним правилом.
2. Выделить стоимость оболочки и её upgrades.
3. Выделить child sub-budget из остатка родителя; child не получает исходный общий budget повторно.
4. Рекурсивно сгенерировать contents в bounds глубины/числа документов; вернуть неиспользованный остаток родителю.
5. Сформировать canonical storage snapshot один раз. Повторное открытие только читает его, не догенерирует новые вещи.
6. Остаток общего бюджета при includeCoins превращается в валюту; валюта внутри контейнера вычитается из того же общего резерва, не добавляется поверх него.

Инвариант: B = сумма(value всех top-level деревьев) + top-level currencyValue + unusedValue.
value(tree) = shellBase + installedUpgrades + childTrees + internalCurrency.
Каждый физический/денежный компонент участвует ровно один раз, unusedValue>=0. Existing spentValue сохраняет свою семантику стоимости предметных строк; отчёт отдельно отображает общую сумму и остаток, не меняя смысл старого поля.

Пример в единицах value: B=10000; оболочка=1000; upgrade=2000; содержимое=3000; монеты внутри=1000; внешние монеты=3000. Итог 10000. Нельзя повторно прибавить цену child как отдельную строку или второй reserve.

Ограничения: generation depth; общий document count (предлагаемый максимум 200, включая upgrades); safe integer budget; запрет циклов/shared child identity; известная вместимость и вес. Не помещать заведомо невмещающийся лут. Неизвестную жёсткую вместимость для генерации считать неподтверждённым container profile и исключать, а не бесконечной вместимостью. Магические контейнеры соблюдают existing weightlessContents policy.

UI: контейнер — одна забираемая top-level строка, есть preview вложенных вещей и breakdown цены. itemCount по-прежнему ограничивает top-level rows; отдельный общий count ограничивает внутренние документы. quantity контейнера=1; два одинаковых сундука — два экземпляра.

Claim контейнера атомарно охватывает его оставшееся дерево. В Chat нельзя одновременно выдать parent целиком и отдельно child. Доступ к частичному извлечению появляется через existing Storage UI после материализации; дальнейший перенос контейнера включает только оставшееся содержимое. Конкурирующие parent/child операции сериализуются существующей root queue.

Повтор claim/reconnect/удаление already claimed target не регенерируют лут. Старые v1 сообщения остаются readable/claimable; schema upgrade выполняется на boundary без перерасчёта или новых random rolls.

## Файлы и проверки

Изменять generator/form/template catalog, trusted chat serialization и inventory materialization; snapshot/item service только для remapping связей и адаптации уже существующего формата. Новый tests/lootgen-composite-items.test.mjs и tests/lootgen-container-budget.test.mjs.

Existing focused: lootgen-generator, lootgen-template-catalog, lootgen-app-context, lootgen-chat, loot-claim-service, item-upgrade-service, storage-container-snapshot, storage-container-item-service, storage-container-hierarchy, inventory-ingress-descriptor, inventory-mutation-recovery.

Обязательные assertions: fixed random reproducibility; все disabled → legacy parity; B=0/точная цена/нехватка/overflow; coin reserve 0/100; несовместимый upgrade; max capacity; две variant одного host не merge; nested depth; невыданные остатки; child coin counting; unknown price; mutation failure после host create/child create/links/source receipt; retry без новых IDs; hostile descriptor rejection; старый Chat claim.

Live: генерация → Chat → забрать в группу/персонажу → открыть контейнер → достать child → бросить/подобрать контейнер → reload. Количество, стоимость и upgrades сохраняются на каждом шаге.
