# Составной лут — R8

Версия 1.4.262: общий каталог/price reader, prepared graph ingress и GM-only durable подготовка результата в закрытом ChatMessage. Проверка каталога перед новым Item ingress подключена. Публикация того же результата и reference-only drag подключены; UI выбора улучшений ещё не подключён. Установка отдельных усовершенствований остаётся у R4/R7; подготовка graph не вызывает install API и ничего не записывает.

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

Private `cleanCatalogItem(source,id)` удаляет старые document ownership/ID/container/transfer receipts и применяет canonical buildHeldItemWornUpdate(false) к detached данным. Root quantity берётся из descriptor. Installed links полностью перестраиваются на новые child IDs; child quantity1, container/rootItemId, installedUpgrade hostActorId/hostItemId/slotIndex/category, canonical manifest profile и сохранённые upgradeChoices. Getter getItemUpgradeCategory и flags constants переиспользуются из существующего сервиса. Никаких world writes, случайных повторных установок и timestamps внутри builder. Явный custom profile у child отклоняется до подмены flags; input остаётся неизменным.

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

scripts/data/lootgen-catalog-reader.js: createLootgenCatalogReader({model={},gearIndex=[],magicDocuments=[],manifest=[]}) строит detached read-only maps stable IDs. Private index/values/flags/detached/id отвечают за снимки; duplicate identity отклоняется. resolveValueComponent(component) возвращает safe unitValue/priceKnown, canonical manifest upgradeProfile и пустой includedUpgradeSourceIds (каталог не объявляет bundled upgrades). Private modelPrice/magicPrice/present/validNumber/validValue различают неизвестную и явно нулевую цену; unsafe/negative values запрещены. Сохраняется прежний legacy priceGold приоритет, native denomination учитывает pp/gp/ep/sp/cp. Сломанное состояние не вводит новой скидки. Upgrade без managed source document имеет priceKnown:false. Явный сохранённый profile, отличающийся от manifest по canonical profileSignature, даёт UpgradeRuleError unavailable: он не подменяется правилами каталога. describeUpgradeHost также исключает сами upgrade templates.

describeUpgradeHost(component) использует buildUpgradeHostDescriptor на managed gear index либо native magic ItemData: категории/qualifier/capacity не угадываются по названию. Возвращает detached quantity1/unworn/unheld/unattuned descriptor. Host с уже сохранёнными installed links исключается из подбора новых вариантов до явного контракта bundled-price, чтобы не потерять прежний состав. Reader не пишет и не генерирует IDs.

Focused: lootgen-source-catalog, lootgen-catalog-reader, lootgen-type-filters, lootgen-app-context и generator regressions. Native testovyj3/CODEX: index745/manifest91/pool629; три отдельных kavaleriyskaya-pika с maloe-zacharovanie-ostroty, 100+3125=3225 за экземпляр и9675 всего; distinct upgrade instance keys. Обычное окно отрисовало сгенерированные строки/цены после extraction, viewport1292×920. Созданных Actor/Item/Chat нет; QA окно закрыто. Это не приёмка prepare-result/Chat claim.


## Сохраняемый результат мастера — 1.4.259

scripts/application/lootgen-generated-state.js:

- buildLootgenGeneratedState(form,{operationId,lootId,authorId},{catalog,buildItemData,createDocumentId,random=Math.random,now}) читает один catalog snapshot, запускает единственный generateLootgenResult, перепроверяет evaluateItemValue и строит detached ItemData/graphs через существующий builder. Allocator проверяет уникальные Foundry16 IDs во всём результате; rowId детерминирован из operationId/index. Каждая строка получает DTO, полную цену, names/decision/choices upgrades и claimed:false. Composed root не несёт legacy lootgenChat Item marker: обычный create-Item hook не должен отметить строку при появлении одной основы. Plain строки сохраняют прежний marker. World writes отсутствуют.
- readLootgenCatalogFingerprint(descriptors,snapshot) — pure signature referenced компонентов: safe price, compatibility/capacity, source name/type/rank/bargaining, _stats.modifiedTime, manifest decision/profile/capabilities. Source type namespaces разделены, повторные components дедуплицируются, сортировка детерминирована и не зависит от locale. Instance IDs не влияют. В reader gear index запрашиваются modifiedTime и upgrade/template flags. Этот helper подготовлен для повторной проверки перед claim; gate ещё не подключён.
- Private values/flags только нормализуют collections/metadata. Generated state содержит catalogFingerprint, rows, coins, spent/budget/count/time; второй world repository не создаётся.

scripts/application/lootgen-generated-result-service.js:

- LOOTGEN_PREPARE_RESULT_COMMAND="lootgen.prepare-result"; isValidPrepareLootgenPayload(payload) принимает exact {form}, exact normalized form с enableUpgrades:true, safe budget и JSON<=16384. ItemData/effects/лишние поля запрещены.
- LootgenGeneratedResultService({journal,buildState,findMessage,createMessage,activateMessage,coordinator}) — единственный workflow подготовки. prepare({operationId,form},{requesterId,authorId,assertAuthority}) сериализует operationId, связывает form/requester fingerprint и deterministic messageId/lootId. Private #assertMessage проверяет trusted envelope и exact receipt identity; #result возвращает detached current state, сохраняя claimed changes.
- Сначала ищет journal и существующий ChatMessage до random. Prepared journal сохраняет полный state до create; lost acknowledgment читается из сохранённой записи. После message-created preparedState очищается, сохраняется terminal receipt, затем разрешается generationReady. Retry после create/activation/journal ack failure не генерирует повторно; deleted completed message при сохранённом receipt требует ручной сверки. Гарантия использует existing journal retention и durable Chat state. Уникальные ID/чужой author/fingerprint/phase не перезаписываются. assertAuthority вызывается перед каждым write boundary после async reads/build.

Composition в scripts/main.js:

- Один service использует существующий InventoryService.mutationJournal и worldMutationCoordinator. GM-only typed route принимает exact {form,operationId}; внутренний form validator по-прежнему проверяет {form}. Передаёт payload operationId, authenticated requester и реального active-GM author/guard. Public API создаёт новый транспортный request ID для каждой попытки, сохраняя domain operationId, поэтому error cache транспорта не мешает persisted recovery. Public prepareLootgenGeneratedResult(form,{operationId?}) нормализует форму и использует этот route; возвращает {messageId,lootId,state}.
- #readLootgenMessage(messageOrId,{cloneState=true}) сохраняет прежнюю GM author verification и выдаёт detached envelope. Predicate поиска использует cloneState:false: он не копирует большие ItemData каждого сообщения, не изменяя raw state. #findLootgenChatMessage дополнительно исключает v2 drafts, пока generationReady/published не true. Это не даёт незавершённому draft попасть в прежний claim flow.
- #createLootgenChatDocument(state,{messageId,whisper}) — один canonical ChatMessage.create для прежнего createLootgenChatMessage и нового prepared flow. Подготовка использует непустой список GM whispers, поддерживает Foundry collections/Map.values, сохраняет deterministic ID через keepId. Пустой список получателей отклоняется до создания, не превращается в публичную запись.
- #activateLootgenGeneratedMessage(messageId) ставит readiness только после durable receipt, подтверждает update-then-throw readback. Публикации нет. buildLootgenChatContent для unpublished v2 показывает escaped неинтерактивный preview с именами/количеством/value/улучшениями/монетами; никаких claim/drag controls. Legacy content сохраняется.

Focused: lootgen-generated-result-service (retry, concurrency, authority, lost ack, wrong author, deleted result), lootgen-generated-state (full graph/value, profile/price/source stats signatures), group-command-dispatch (actual gateway GM/player/exact payload, canonical private publisher), lootgen-chat (draft escaping/no actions), composite-item-graph/lootgen-catalog-reader (custom profile rejection).

Native read-only QA testovyj3/CODEX: реальные buildLootgenItemData и каталог дали Алебарду3205 + Молот всадника3195, по2 graph nodes, total6400; legacy claim marker отсутствует. Повторное чтение каталога дало тот же fingerprint; modifiedTime доступен у всех745 gear entries. Сохранённый профиль реального шаблона совпадает с manifest. ChatMessage в живом мире не создавались; GM socket/publisher native и полная публикация/claim остаются открытыми.


## Проверка каталога и резервирование строк — 1.4.260

assertLootgenCatalogCurrent(state,catalog) в scripts/application/lootgen-generated-state.js пропускает legacy state; v2 требует сохранённую форму, fingerprint и strict DTO каждой строки. Fresh catalog.load и readLootgenCatalogFingerprint сравниваются без генерации/записей. Несовпадение цены, availability, profile или источника и повреждённый descriptor дают lootgen-result-stale с предложением новой генерации. Ошибка загрузки каталога сохраняется как retryable read failure, а не выдается за изменение правил.

Canonical Chat grantBatch в main вызывает gate из resolveRows({recovering=false}) перед новым inventory receipt. Recovery с существующим receipt пропускает повторную проверку каталога и использует сохранённые trusted ItemData; terminal inventory retry вообще не читает source. Каталог проверяется для всего сохранённого результата перед каждым новым пакетом Item; отдельные монеты не зависят от каталога. InventoryService остаётся владельцем определения recovering и target IDs.

LootClaimService.claimBatch перед новым claim проверяет пересечение доступных rowIds/includeCoins с nonterminal claims. Пересечение даёт lootgen-claim-in-progress до Chat/target writes; тот же claimId продолжает исходную операцию, независимые строки разрешены. После committed skip/failed rows снова доступны по прежнему контракту partial result.

Focused: lootgen-generated-state (legacy/current/price/availability/missing/malformed/read failure), loot-claim-service (prepared/granted reservations, independent item versus pending coins), group-command-dispatch (canonical grant adapter gate/recovery), inventory-mutation-recovery (partial graph with changed catalog guard, IDs and terminal replay).


## Выдача персонажу — 1.4.261

InventoryService.addLootgenRowToCharacterOnce(row,actor,mutationId,{allowPreparedLootgenGraph=false,beforePrepare=null}={}) сохраняет storage default и принимает внутреннее разрешение trusted v2 Chat adapter. Prepared composition без этого разрешения отвергается. Callback beforePrepare вызывается только до нового durable grant; ItemData клонируется из trusted state, graph marker сохраняется в journal, legacy lootgenChat Item marker удаляется. Private #executeInventoryGrantOnce дополнен beforePrepare/preparedLootgenFingerprint; fingerprint включает exact source data/quantity и Actor UUID. Kind, actorId/UUID, folder и fingerprint проверяются до terminal replay; новый получатель или source с прежним ID не допускаются. Persisted targetReceipt.graphItemIds проверяются перед canonical materializer; recoverMissing включается только для valid prepared graph. Storage graph default не меняется.

RebreyaMainModule.claimLootgenChatRowToCharacter(lootId,rowId,actorUuid,{operationId?}) отправляет exact typed lootgen.claim-character {actorUuid,claimId,lootId,rowId}, без ItemData/price. ClaimId — stable domain operation; каждый вызов получает новый transport request ID. Default domain ID включает requester/lootId/rowId/Actor UUID. Private #resolveLootgenCharacterDestination проверяет живого character Actor по canonical UUID resolver, OWNER либо GM и trusted ready v2 Chat; unpublished разрешён только GM. #findLootgenChatMessage(lootId,{allowDraft=false}) сохраняет прежний default и открывает ready draft только явному GM adapter.

Private #grantLootgenCharacterRow вызывается прежним LootClaimService.grantBatch для internal plan {destination:character,actorUuid,requesterId}; разрешает одну строку без coins, повторно проверяет источник/получателя/active GM и вызывает существующий InventoryService с mutationId lootgen-character:<claimId>. Catalog/ownership/authority beforePrepare не выполняются вместо persisted recovery. Source claimed пишется только после полного grant; prepared source claim резервирует строку при сбое. Public exact validation и destination в claim fingerprint блокируют смену получателя.

UI claimLootgenRowToSelf для v2 передаёт только references через API; локально Item не создаёт. Legacy self path сохраняется. Подготовленный draft без кнопок/drag; после публикации той же записи доступны проверяемые выдача и v2 drag route. Окно генерации остаётся открытым.

Focused: group-command-dispatch (OWNER/GM/exact/private access, grant-before-claimed, retry after failure, prepare retry through gateway without reroll), inventory-mutation-recovery (partial graph, changed catalog, target/source conflict, terminal replay, distinct hosts), lootgen-chat (references-only self click), disarm-storage (default storage regression).


## Публикация и перенос из Chat — 1.4.262

RebreyaMainModule.publishLootgenGeneratedResult(lootId) отправляет GM-only typed lootgen.publish-result с exact {lootId}. Private #publishLootgenGeneratedMessage(lootId,assertAuthority) использует ту же loot-claim:<messageId> queue, повторно проверяет trusted ready v2 state, раскрывает whisper:[]/blind:false и перерисовывает тот же document. Readback после ошибки проверяет и published flag, и фактическую видимость; частично применённое обновление повторяется, уже опубликованный результат возвращается без записи. Domain claim state/claimed rows сохраняются, генерация не вызывается.

#buildLootgenInventoryIngressRows теперь единственный row adapter и для preview, и для fresh grantBatch; v2 удаляет legacy lootgenChat Item marker из detached output. claimLootgenChatRow отвергает v2 до source mutation: source acknowledged только LootClaimService.

renderLootgenChatRow показывает экранированные названия upgrades и статус simple-implemented/existing-curse. bindLootgenChatMessage для ready published v2 формирует {type:RebreyaLootgen,version:2,lootId,rowId}, без ItemData/uuid; отсутствующие/claimed rows не перетаскиваются. registerLootgenChatHooks владеет одним дополнительным dropActorSheetData adapter: custom type всегда останавливает native drop, exact payload и character destination передаются в claimLootgenChatRowToCharacter. Неизвестные обычные типы остаются прежним hooks; invalid custom payload подавляется с уведомлением, без создания Item.

Focused: group-command-dispatch (publish before/after/partial fault, same document, GM access, legacy v2 rejection, stripped marker), lootgen-chat (safe drag, malformed custom payload, claimed source, escaped upgrade status), loot-claim-service и inventory-mutation-recovery regressions.
