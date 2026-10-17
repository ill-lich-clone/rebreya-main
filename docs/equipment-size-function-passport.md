# Размер оружия и снаряжения

## Чистые правила

Владелец: `scripts/data/equipment-size-rules.js`. Не читает world state и не изменяет входные Item/Actor.

- `EQUIPMENT_SIZES` / `EQUIPMENT_SIZE_LABELS`: шесть категорий предполагаемого владельца и русские подписи; независимы от durability object size.
- `isEquipmentSize(size) -> boolean`: точная проверка категории на границе данных.
- `getEquipmentSize(itemOrData) -> SizeId`: читает module flag `equipmentSize.size`; отсутствующее/некорректное значение означает `med`.
- `shiftEquipmentDamage(formula,steps) -> {formula,supported}`: шкала `0 → 1 → 1d2 → 1d3 → 1d4 → 1d6 → 1d8 → 1d10 → 1d12 → 2d6…`; после блока d6/d8/d10/d12 количество костей удваивается. Простые постоянные слагаемые и `@paths` сохраняются. Несколько костей, неканонические кости и special expressions возвращаются дословно с `supported:false`.
- `inferEquipmentSize(referenceFormula,referenceSize,nextFormula) -> SizeId|null`: однозначный обратный вывод по базовой кости относительно исходного профиля, без угадывания для неоднозначных/нестандартных формул.
- `getEquipmentSizeMultipliers(fromSize,toSize) -> {price,weight}`: цена `1.5 ** steps`, вес `2 ** steps`, без округления; неизвестная категория отвергается.
- `getCreatureTokenFootprint(size) -> {width,height}`: `0.5/1/1/2/3/4` для tiny/sm/med/lg/huge/grg.
- `getWeaponSizeUse(actor,item) -> {improvised,reason}`: оружие своего/меньшего размера разрешено; Small дополнительно разрешает Medium без heavy. Недопустимое сочетание даёт `weapon-too-large`; правило не блокирует Item и не меняет его данные.

Focused coverage: `node --test tests/equipment-size-rules.test.mjs`; исходная таблица 48 значений, продолжение шкалы, свободные формулы, все 36 пар размеров, heavy exception, footprints и пример цены/веса лат.

## Native Item и поле «Подробнее»

`scripts/integrations/equipment-size.js` — dnd5e adapter. `readEquipmentItemData(item)` получает detached source Item, не prepared upgrade/mod проекции. `isEquipmentSizeItem(item)` исключает валютные/Journal Items и естественное оружие. `readEquipmentDamageFormula(part)` сохраняет custom/native base contract.

`buildEquipmentSizeUpdate(item,{size,changes={},source="size"}) -> {update,diagnostics}` синхронно строит один flat Item patch; отдельного Item.update/fetch внутри нет. `equipmentSize:{version:1,size,reference}` хранит исходные base/versatile damage parts, own weight/price и категорию reference. Размер пересчитывает из reference, ручной primary die выводит категорию; сложная/авторская формула свободно сохраняется и становится reference текущей категории. Неизменённые поля полного native submit не считаются авторским override. Grip updates не меняют категорию; `versatileBaseDamageOriginal` масштабируется отдельно от текущей двуручной проекции. Quantity, другие flags, damage types и durability не переписываются.

`EquipmentSizeService(moduleApi,{buildItemUpdate})` в `scripts/application/equipment-size-service.js` получает adapter через injection из composition root. `initialize()` не мигрирует world Items. `preUpdateItem(item,changes,options={})` синхронно нормализует исходное намерение, а `setItemSize(item,size)` проверяет права и применяет один Item patch с `rebreyaEquipmentSize:true`, исключая рекурсию.

`registerEquipmentSizeItemHooks(moduleApi,{Hooks})` идемпотентно подключает только `preUpdateItem`; новых Actor/Token observers нет. `upsertEquipmentSizeField(root,app,moduleApi)` в existing dnd5e sheet integration вставляет один native select шести категорий, учитывает read-only права и вызывает только size service.

Focused coverage: `tests/equipment-size-service.test.mjs`, `tests/dnd5e-sheet-downtime-tab.test.mjs`, `tests/held-items.test.mjs`, `tests/gear-compendium.test.mjs`, `tests/main-composition-root.test.mjs`.

## Стоимость, composition и перенос

`normalizeLootgenFlatItemDescriptor(raw,{legacy,allowContainer})`, `normalizeLootgenComposition(raw)` и `normalizeLootgenItemDescriptor(raw,options)` сохраняют strict v2/v3 shapes; v4 требует прежние host-поля, `weaponMods` и точную категорию `equipmentSize`, без произвольного reference/цены. `getLootgenAggregationKey(raw)` отличает non-Medium размер; flat Medium сохраняет legacy key.

`evaluateItemValue(descriptor,catalogReader)` принимает v4 и умножает только host base value на множитель размера с прежней safe-integer copper границей. Upgrades, mods, содержимое и монеты не получают множитель оболочки. Catalog reader сохраняет средние исходные цены; quantity/budget/unknown-price contracts не меняются.

`applyEquipmentSizeToItemData(data,size)` в native adapter строит detached Item через тот же пересчёт. `buildCompositeItemGraph(raw,builders)` применяет размер до построения graph/подписей. `readLootgenPreparedComposition(itemData)` и `validatePreparedContainerGraph(...)` сверяют v4 category с физическими root/node flags и не принимают подмену.

`captureHostData(item,allItems,composition)` в storage container owner переводит изменённый physical размер в composition v4, сохраняя полный Item/reference. `StorageContainerItemService.prepareItemGraph(snapshot,options)` продолжает возвращать captured physical Items без замены каталогом. Snapshot schema v1 не меняется. `storageRowsCanStack(left,right)` различает категории и авторское состояние; Medium с совпадающим исходным профилем эквивалентен legacy unmarked Medium.

`buildInventoryIngressDescriptor(itemData,options)`/`captureInventoryIngressIdentity(descriptor,quantity)` добавляют категорию только для non-Medium. `InventoryIngressPlanner.serialize()`/`isValidSerializedInventoryIngressPlan(plan)` используют план v3 для таких identity, сохраняя прежние v1/v2 wire shapes для остальных. Native unit price/weight читаются из физического Item, не подменяются каталогом.

`itemsCanRepresentSameTransfer(source,accepted)`, `itemsCanMergeInInventory(source,accepted)` и shared private `equipmentSizeProfilesMatch(sourceData,acceptedData)` в InventoryService отвергают разные категории/авторские размерные профили. `captureInventoryTransferIdentity(item)`/`normalizeInventoryTransferIdentity(value)` включают optional non-Medium category; `inventoryTransferIdentityMatches(item,expected)` отвергает stale/malformed size, сохраняя legacy Medium receipts.

Focused: `tests/equipment-size-transfers.test.mjs`, существующие item-value, lootgen descriptor/prepared/generator, composite graph, ingress, storage-container, item-upgrade, inventory-simple-transfer и inventory-mutation-recovery suites. Новые случайные размеры и трата бюджета не добавлены.

## Атака оружием неподходящего размера

Владелец — прежний `CombatAttackService` в `scripts/combat/attack-service.js`. Private `#isImprovisedForSize(actor,item)` переиспользует domain predicate и исключает естественное оружие. `#isAttackProficient(actor,item,options)` не берёт обычное weapon proficiency для oversized Item; учитывает `dnd5e.tavernBrawlerFeat`, сохраняя явные API overrides/includeProficiency.

`applyDnd5eAttackRollConfig(config,dialog,message)` применяет transient `data.prof`, а private `#applyEquipmentSizeAttack(...)` также оборачивает native `dialog.options.buildConfig`, чтобы dnd5e 5.2.5 не восстановила старое владение и не удвоила @prof. Proficiency dice получают прежний native Proficiency.clone term. Тот же dnd5e hook обслуживает MIDI workflow.

`applyDnd5eDamageRollConfig(config,dialog,message)` вызывает private `#applyEquipmentSizeDamage(config,message)`: только primary base part становится 1d4, ability/flat/дополнительные damage parts остаются, затем продолжаются прежние upgrade/критические правила. Managed weapon-mod activities со своим damage owner не подменяются. `#noteImprovisedSize(message)` добавляет одно пояснение в chat flavor. Постоянный Item не меняется; `#buildAttackFlavor(...)` поясняет такое применение и для публичного module attack API.

Focused: `tests/combat-attack-service.test.mjs` и `tests/equipment-size-rules.test.mjs`; native/MIDI parity, builder rebuild, Tavern Brawler, reordered modifiers/riders, обычная атака после смены владельца/размера и ноль Item writes.

## Макрос и изменение существа

`getHeldEquipmentWeapons(actor)` в native adapter возвращает equipped ordinary weapons с quantity > 0, размещённые в существующих незарезервированных руках; двуручный Item включается один раз. Natural/backpack Items исключены.

`EquipmentSizeService.getCreatureResizePreview(token,size?)` — read-only intent snapshot: UUID конкретного Actor (в том числе synthetic), Token, категория, geometry и SHA-256 подписей source system/flags held Items. `authorizeCreatureResize(payload,sender)` проверяет связку Token→Actor и OWNER на обоих документах. `requestCreatureResize(payload)` направляет intent через privileged gateway при active GM либо owner-local coordinator без GM. `resizeCreature(payload,{senderUserId,assertAuthority})` повторно разрешает UUID, проверяет ownership/expected и рассчитывает footprint с сохранением центра.

`isValidCreatureResizePayload(payload)` и `registerEquipmentSizeCommands(moduleApi,bus)` в `scripts/application/equipment-size-commands.js` — строгая typed command `equipment.resize-creature`, actor-key scheduling; transport не принимает document patches или новые цены. Ожидаемые source signatures не задают результат пересчёта.

`EquipmentSizeService.applyPreparedCreatureResize({actor,token,size,tokenPatch,weaponIds,changeActorSize?,expected?,assertAuthority?})` — доверенный общий владелец Actor→Token→одного Item batch. Стадии без изменений пропускаются. Preflight не снимает сторонний size override. Снимки включают штатное изменение prototypeToken при смене Actor size. Ошибка восстанавливает только собственные поля при совпадении результата; quantity/HP и другие поля не перезаписываются. `resize-failed.unrestored` перечисляет документы, восстановлению которых помешали последующие правки или ошибка записи.

`getResizePromptOwnerIds(actor)` выбирает активных владельцев: назначенный персонажу игрок, инициатор-владелец, затем стабильный ID. Прежний ReactionQueueService выбирает active GM, если владельцев нет. `chooseHeldWeaponResize(actor,token,size,{choice?,preview?})` использует имеющийся выбор либо один promptDecision и после ответа повторно проверяет held Items; отказ ничего не меняет.

`runCreatureSizeMacro({moduleApi,canvas,DialogV2,notify})` в `scripts/integrations/creature-size-macro.js` показывает один native DialogV2: подконтрольный Token, шесть размеров, checkbox held weapons. Отмена/закрытие/отсутствие Token не пишут документы. Публичный `RebreyaMain.resizeCreature(options={})` делегирует адаптеру. `buildCreatureSizeMacroData(folderId,options)` и прежний `GrappleMacroService.syncManagedDocuments()` создают/repair шестой managed macro «Изменить размер» в общей папке «Ребрея», сохраняя чужие одноимённые Macro.

RuneKnightAutomationService: `#chooseGiantMightSize(actor,item,token)` возвращает `{size,weaponChoice?}`; существующий Huge dialog содержит выбор оружия. `#activateGiantMight` сохраняет preview до диалога; только состоявшийся рост предлагает оружие и вызывает `#applyGiantMightGrowth(actor,token,form,{weaponIds,expected})` через общий owner. `#giantMightFormPlan` использует общий footprint helper, сохраняя no-space/level/reach/coordinate contracts. `#restoreGiantMightForm(actor,effect,{offerWeapons=true})` сохраняет прежний conditional restore полей, предлагает оружие при реальном возврате категории и вызывает тот же owner. Ошибка активации подавляет второй запрос оружия и всегда возвращает resource даже при ошибке восстановления формы. Старые эффекты без новых flags поддерживаются; generic updateActor/updateToken/ActiveEffect observers для пересчёта оружия отсутствуют.

Focused: `tests/creature-resize-service.test.mjs`, `tests/creature-size-macro.test.mjs`, `tests/equipment-size-commands.test.mjs`, `tests/grapple-macro-service.test.mjs`, `tests/rune-knight-automation-service.test.mjs`, `tests/reaction-queue-service.test.mjs`, `tests/main-composition-root.test.mjs`.
