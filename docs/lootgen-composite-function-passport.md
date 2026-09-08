# Составной лут — R8

Версия 1.4.258: общий source catalog/price reader, ограниченный выбор улучшенного варианта, detached graph builder и durable ingress подготовленного состава. UI выбора улучшений и authoritative generated state ещё не подключены. Установка отдельных усовершенствований остаётся у R4/R7; подготовка graph не вызывает install API и ничего не записывает.

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

`cleanCatalogItem` не оставляет synthetic system.equipped на loot: dnd5e не хранит это поле. Tests: `tests/composite-item-graph.test.mjs`.


## Prepared ingress item

Владелец временного транспорта — scripts/data/lootgen-prepared-item.js. LOOTGEN_COMPOSITION_FLAG="lootgenComposition"; marker не является доказательством доверия.

- buildLootgenPreparedItem(descriptor,{graph,unitValue}) клонирует root, добавляет bounded runtimeItemGraph и exact marker {version:2,descriptor,unitValue,compositionKey}. Цена native root остаётся ценой основы; полная unitValue живёт только в транспортных данных.
- readLootgenPreparedComposition(itemData) возвращает null при отсутствии marker, иначе проверяет DTO, safe nonnegative value, canonical key, quantity1, число/уникальность IDs, root links и child sourceId/container/reverse link/choices. Повреждение даёт invalid-prepared-lootgen-item до записи. Private keyOf канонизирует slots через itemInstanceFingerprint; fail создаёт этот error.
- buildInventoryIngressDescriptor получает полную цену и compositionKey. captureInventoryIngressIdentity добавляет key только composed quantity1, plain identity не меняется. InventoryIngressPlanner.preview/serialize выбирают version2 только для пакета с compositionKey, version1 для остальных. Private versionForRows/validWireIdentity и isValidSerializedInventoryIngressPlan проверяют exact v1/v2 поля, compositionKey<=8192 и наличие composed row в v2; parity сравнивает состав/choices/цену через key.
- getInventoryDismantleBlockReason(itemData) у inventory-ingress-descriptor возвращает причину для graph, host с установленными upgrades и installed child. resolveInventoryDismantleMinimumQuantity/Outputs возвращают null/[] для них. InventoryService.#executeDismantleInventoryItem показывает причину до journal/write: сначала снять upgrades. Независимый разбор одной оболочки не удаляет связанные предметы.

Tests: lootgen-prepared-item, inventory-ingress-descriptor, inventory-ingress-planner.

## Durable graph ingress

InventoryService.commitInventoryIngressBatch(request,{resolveRows,debitRow,grantContainer=null,allowPreparedLootgenGraph=false}) и private #commitLegacyInventoryIngressBatch принимают дополнительный **внутренний** source-adapter option, не wire payload. Только существующий trusted Chat grantBatch в main задаёт true. #assertInventoryIngressGraphSource допускает graph от storage либо lootgen+true+валидный prepared marker; generic direct ingress не получает этого разрешения.

#prepareInventoryIngressTargetReceipts сохраняет graphItemIds вместе с detached ItemData до create. #applyInventoryIngressTargetReceipt перепроверяет IDs и вызывает единственный materializeRuntimeItemGraph; root с graph не merge-кандидат. Journal хранит sourceOrigin/allowPreparedLootgenGraph, composition identity и graph source IDs. Source debit и claimed возможны только после всего graph. Terminal retry возвращает прежний outcome до чтения источника и не воссоздаёт удалённый после выдачи предмет.

buildRuntimeGraphDocuments(graph,operationId,rootData,{actorId=null}) переназначает container/host/child IDs, а также installedUpgrade.hostActorId при известном target. Удаляет временные runtimeItemGraph/lootgenComposition flags: live value затем вычисляется штатно по реальным детям.

materializeRuntimeItemGraph(actor,graph,operationId,rootData,{recoverMissing=false}) сохраняет прежнее поведение runtime transport по умолчанию. Только prepared loot разрешает recoverMissing: сверяет весь предоставленный снимок каждого уже существующего Item (private matchesPreparedValue допускает дополнительные defaults объекта, но сравнивает exact массивы и заданные значения, включая effects), затем создаёт только недостающие IDs. Чужая правка требует graph-manual-review без overwrite/повторного random. Write-then-throw подтверждается readback. Compensation здесь не удаляет partial graph автоматически; неоднозначность остаётся для сверки.

Tests: inventory-mutation-recovery (trusted adapter, journal-before-write, partial child, terminal deletion, dismantle), runtime-item-graph (foreign system/effects edits, default storage behavior), disarm-service regressions. Native QA testovyj3/CODEX: Foundry13.351+dnd5e5.2.5; actual embedded Items, partial root→child, exact retry, changed quantity rejection и правильный hostActorId подтверждены, все QA Actors удалены. Полная проверка GM Chat claim/публикации относится к следующей части R8.


## Общий каталог источников — 1.4.258

scripts/data/lootgen-source-catalog.js теперь владеет подбором кандидатов, ранее находившимся в LootgenApp:

- buildLootgenMundaneCandidate(gearItem,{rank,value,typeLabel,breakable=false}) сохраняет stable sourceId, package multipleAppearance и прежнюю plain stack policy; UI re-export сохраняет контракт импорта.
- buildLootgenGearTypeOptions(model,selectedState={}) исключает upgrade-категории и добавляет материалы как equipment filter.
- buildLootgenMundanePool({model,form,breakableGearIds=new Set()}) сохраняет rank/type/bargaining filters, цены resolveLootgenItemValue, package formula и breakable marker. buildLootgenMagicPool({form,documents=[]}) сохраняет stable magicItemId, rank/type/consumable metadata и прежний приоритет value → legacy priceGold → native price. Оба pure helpers сортируют rank/value без random. Private toNumber/toInteger/parsePriceToGold/normalizeBargainingTag/isBargainingBlocked перенесены из UI.
- readLootgenGearIndex() читает только world gear index и нужные flags/system.type/quantity для durability и upgrade compatibility/capacity. readLootgenMagicDocuments() читает managed magic pack, отсутствие pack даёт []. Ни create/sync, ни UI.
- LootgenSourceCatalog({getModel,getGearIndex=readLootgenGearIndex,getMagicDocuments=readLootgenMagicDocuments,getManifest=loadUpgradeAutomationManifest}) создаётся ровно один раз в main. load(form) параллельно читает нужные источники, нормализует форму и возвращает model/indices, pools, manifest/catalogReader только при enableUpgrades. Gear index также нужен для magic-only upgrades. generate(form,options={}) передаёт trusted pools/manifest/reader единственному generateLootgenResult; options не могут подменить эти зависимости.
- LootgenApp.#generateLoot() теперь вызывает общий service.generate; #getMagicDocuments/#buildGearTypeOptions — delegates. Старые #toValue/#getBreakableGearSourceIds/#buildMundanePool/#buildMagicPool удалены. generateFromForm сохраняет API. RebreyaMainModule.generateStorageLoot больше не создаёт Application: использует тот же сервис для plain rows. До подключения R9 composed storage form отклоняется до записи, чтобы не потерять upgrades. openLootgenApp использует текущий cache key1.4.258 независимо от старой server manifest metadata.

Чистые type helpers normalizeLootgenTypeFilterKey/buildLootgenTypeFilterOptions/isLootgenTypeAllowed/resolveMagicLootgenTypeLabel и private cleanTypeLabel/parseMagicSignature перенесены без изменения поведения в scripts/data/lootgen-type-filters.js. Прежний UI path — только re-export; data больше не зависит от UI.

scripts/data/lootgen-catalog-reader.js: createLootgenCatalogReader({model={},gearIndex=[],magicDocuments=[],manifest=[]}) строит detached read-only maps stable IDs. Private index/values/flags/detached/id отвечают за снимки; duplicate identity отклоняется. resolveValueComponent(component) возвращает safe unitValue/priceKnown, canonical manifest upgradeProfile и пустой includedUpgradeSourceIds (каталог не объявляет bundled upgrades). Private modelPrice/magicPrice/present/validNumber/validValue различают неизвестную и явно нулевую цену; unsafe/negative values запрещены. Сохраняется прежний legacy priceGold приоритет, native denomination учитывает pp/gp/ep/sp/cp. Сломанное состояние не вводит новой скидки. Upgrade без managed source document имеет priceKnown:false.

describeUpgradeHost(component) использует buildUpgradeHostDescriptor на managed gear index либо native magic ItemData: категории/qualifier/capacity не угадываются по названию. Возвращает detached quantity1/unworn/unheld/unattuned descriptor. Host с уже сохранёнными installed links исключается из подбора новых вариантов до явного контракта bundled-price, чтобы не потерять прежний состав. Reader не пишет и не генерирует IDs.

Focused: lootgen-source-catalog, lootgen-catalog-reader, lootgen-type-filters, lootgen-app-context и generator regressions. Native testovyj3/CODEX: index745/manifest91/pool629; три отдельных kavaleriyskaya-pika с maloe-zacharovanie-ostroty, 100+3125=3225 за экземпляр и9675 всего; distinct upgrade instance keys. Обычное окно отрисовало сгенерированные строки/цены после extraction, viewport1292×920. Созданных Actor/Item/Chat нет; QA окно закрыто. Это не приёмка prepare-result/Chat claim.
