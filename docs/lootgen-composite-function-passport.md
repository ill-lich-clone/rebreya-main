# Составной лут — R8

Первая часть 1.4.256: pure descriptor, ограниченный выбор улучшенного варианта в генераторе и detached graph builder. UI выбора, authoritative generated state и выдача graph ещё не подключены. Установка отдельных усовершенствований остаётся у R4/R7; подготовка graph не вызывает install API и ничего не записывает.

## Descriptor

`scripts/data/lootgen-item-descriptor.js`:

- `normalizeLootgenItemDescriptor(raw,{legacy=false}={})` возвращает detached v2 `{version,instanceKey,sourceType,sourceId,quantity,isBroken,upgrades,container}`. SourceType только gear/material/magicItem. IDs ограничены длиной и не содержат управляющих символов; quantity — positive safe integer. Составной host — quantity1, до3 upgrades с exact `{instanceKey,sourceId,slotIndex,choices}`, уникальными IDs/slots; choices валидирует общий R7 helper. Любой container до R9 запрещён. Private object/id/exact/fail проверяют форму и возвращают error code invalid-lootgen-descriptor.
- `validateLootgenItemDescriptor(raw)` — strict delegate, не допускает лишние fields/ItemData/effects/цену. Legacy boundary принимает только plain v1/без version, сохраняет количество/broken и строит детерминированный plain instanceKey; новые composition fields не теряются молча.
- `getLootgenAggregationKey(raw)` сохраняет прежний sourceType/sourceId/broken key для plain, а composed key включает физическую instance identity и composition. Два одинаковых улучшенных меча не объединяются.
- Tests: `tests/lootgen-item-descriptor.test.mjs`.

## Варианты внутри бюджета

`chooseLootgenUpgradeVariant({host,remainingValue,form,catalogReader,manifest,random,createInstanceKey,attemptBudget={remaining:2000}})` в `scripts/data/lootgen-upgrade-variants.js` — pure helper existing generator. Reader `describeUpgradeHost(hostRow)` возвращает канонический R4 descriptor из trusted source data; `resolveValueComponent(component)` — прежний R4 value contract. Manifest предоставляет полную availability/profile, не клиентские произвольные эффекты.

Helper исключает candidate/unavailable, фильтрует type/rank, проверяет compatibility/capacity через validateUpgradeInstallation. Конечный pool без повторного выбора одной строки ограничен общим attemptBudget генерации. Выбор damageType из finite R7 whitelist сохраняется в descriptor. Полная цена считается evaluateItemValue; вариант принимается только если помещается в remainingValue. При неудаче остаётся обычный host. Возвращает `{descriptor,value,diagnostics}`; descriptor/value null при plain fallback. Физические IDs выделяются только после принятия варианта, через injected allocator. Не вызывает Foundry API.

`normalizeLootgenForm(raw)` дополнен enableUpgrades=false, upgradeChance=0..100 default0, maxUpgradesPerItem=1..3 default1, upgradeTypes (Материал/Зачарование/Проклятье), upgradeRanks (1..10). Пустые фильтры означают всё доступное, не разрешают unsupported profiles. Template catalog сохраняет эту же форму с прежней версией каталога2.

`generateLootgenResult(options={})` принимает эти поля либо form и зависимости manifest/catalogReader/createInstanceKey. Включённый режим допускает только известные неотрицательные safe prices; budget и quantity защищены от unsafe integer. Coin reserve вычисляется без промежуточного переполнения. После выбора base и broken marker helper оценивает variant до вычитания бюджета. Composed row содержит descriptor, quantity1, stackable=false и полную value/totalValue; следующая top-level попытка может выбрать такой же base с новой identity. Allocator проверяет uniqueness IDs во всём результате. Общая граница2000 попыток включает варианты и повторное заполнение; max40 top-level и max3 upgrades ограничивают materialized graph до160 документов, ниже cap200. Повторы plain stacks не создают дополнительные rows/documents.

Private `aggregateRows` переносит descriptor и использует getLootgenAggregationKey только для составных строк. Disabled branch сохраняет прежние rows/coins/spentValue и последовательность random; allocator не вызывается. UI пока не передаёт enabled mode: для него ещё нужен trusted generation route.

Tests: `tests/lootgen-composite-items.test.mjs`, `lootgen-generator`, `lootgen-template-catalog`, все lootgen regressions.

## Подготовленный graph

`buildCompositeItemGraph(descriptor,{buildBase,buildUpgrade,createDocumentId,manifest=[],actorId=""})` в `scripts/data/composite-item-graph.js` — async, возвращает `{rootItemId,documents,links}`. Callbacks предоставляют trusted detached ItemData из каталога, а не данные пользователя. Manifest обязателен для upgrades: отсутствие/несовместимость отклоняется. Полный набор слотов проверяется до первого вызова upgrade builder. IDs — новые уникальные Foundry16 alphanumeric, назначаются до materialization. Дополнительный actorId предназначен для известного target на стадии ingress preparation; callback buildBase обязан учесть descriptor.isBroken через свой trusted row context.

Private `cleanCatalogItem(source,id)` удаляет старые document ownership/ID/container/transfer receipts и применяет canonical buildHeldItemWornUpdate(false) к detached данным. Root quantity берётся из descriptor. Installed links полностью перестраиваются на новые child IDs; child quantity1, container/rootItemId, installedUpgrade hostActorId/hostItemId/slotIndex/category, canonical manifest profile и сохранённые upgradeChoices. Getter getItemUpgradeCategory и flags constants переиспользуются из существующего сервиса. Никаких world writes, случайных повторных установок и timestamps внутри builder.

Tests: `tests/composite-item-graph.test.mjs`. Интеграция prepared graph в ingress journal/partial recovery и source receipts — следующая часть R8; сам helper не доказывает готовность выдачи.
