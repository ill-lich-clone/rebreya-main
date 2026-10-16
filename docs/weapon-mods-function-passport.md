# Оружейные обвесы и модернизированные части

## Установка и typed commands

- `ItemUpgradeService(moduleApi,{getManifest,getWeaponModCatalog=loadWeaponModCatalog})` сохраняет прежние upgrade API. `getWeaponModsProjection(host)` возвращает проверенные live links, diagnostics и полный каталог с реальными свободными itemIds/quantity того же Actor.
- `installWeaponAttachment(host,component,{mountId,operationId,sender,assertAuthority})`, `removeWeaponAttachment(host,componentOrId,{operationId,sender,assertAuthority})` используют существующие InventoryService journal/coordinator, `ItemInstanceWorkflow.runBatch` и `ItemInstanceDocuments`. Под Actor lock повторно читаются host/component; split отделяет ровно одну единицу. Mode/host/mount входят в fingerprint. Patches изменяют только weaponMods, installedWeaponMod и native container; обычные upgrades не меняются. Authority проверяется вокруг каждой записи, потерявший власть GM не компенсирует. Terminal replay не восстанавливает удалённый child.
- `applyWeaponModernization(host,component,{removeItemId,operationId,completionReceipt,...context})` — внутренний completion-only путь: требует серверный `craftingService.verifyWeaponRebuildCompletion`; клиентский boolean/flag не является receipt. Снятие старой части включается в тот же batch, быстрая команда снятия принимает только weaponAttachment.
- Private `#publishWeaponModAction` после durable результата обеспечивает один ChatMessage с детерминированным ID, operationId и native activation `{type:bonus|action,value:1}` в module flag; write-then-throw сверяется по collection, failed publication повторяется без второго install. Отдельный счётчик действий не вводится.
- `weapon-mod-mutation-commands.js:registerWeaponModCommands(moduleApi,bus)` регистрирует `item-mod.attachment.install/remove`, `item-mod.modernization.approve`, `item-mod.activity.use` с exact validators, authenticated sender, OWNER/GM и Actor scheduling. До подключения use handler возвращает unsupported без записей. Approval требует GM и идёт в crafting owner. `isValidWeaponAttachmentInstallPayload`, `isValidWeaponAttachmentRemovePayload`, `isValidWeaponModernizationApprovalPayload`, `isValidWeaponModActivityPayload` исключают произвольные profiles/sender flags.
- Composition wrappers `installWeaponAttachment(payload)`, `removeWeaponAttachment(payload)`, `approveWeaponModernization(payload)` используют privileged gateway одинаково для active/inactive GM и игроков. `registerItemUpgradeFilterHook` скрывает физические installed children через существующий inventory filter.
- Focused: `tests/weapon-mod-mutations.test.mjs`, `tests/weapon-mod-commands.test.mjs`; существующие instance workflow/batch, item upgrades и recovery.

## Физическое дерево, Storage и цена

- `runtime-item-graph.js:getRuntimeWeaponModChildren(host,items)` проверяет обе физические связи, singleton, source identity, непересекающиеся крепления и orphan reverse links без повторной сборки по каталогу. Capture включает children один раз; build remap-ит оба направления и Actor; materialize отвергает изменённые связи при replay. Envelope остаётся RuntimeGraph v1, charges/ammo/effects сохраняются.
- `lootgen-composition.js:normalizeWeaponModComposition(raw,{instanceKeys})` проверяет exact DTO v1 с отдельными attachments/modernizedParts, global identities и mounts. `weaponModComponents(descriptor)` возвращает плоский список без размножения multi-mount child. Нормализаторы композиции/дерева и aggregation key принимают descriptor v3, сохраняют прежние контракты v1/v2, лимиты 200 документов/8 уровней.
- `composite-item-graph.js:buildCompositeItemGraph(raw,{buildBase,buildUpgrade,buildWeaponMod=buildUpgrade,weaponModCatalog,createDocumentId,manifest,actorId})` валидирует v3 по проверенному каталогу до вызова builders компонентов и создаёт detached native links. Для переноса существующих custom Items используется физический snapshot, а не этот builder.
- `storage-container-item-service.js:captureHostData` включает новые компоненты в host graph и исключает их из обычных contents. `prepareItemGraph` учитывает их identities; `storage-container-snapshot.js:normalizeItemRow` запрещает quantity>1 для составного v3.
- `lootgen-prepared-item.js:readLootgenPreparedComposition/buildLootgenPreparedItem` сохраняют marker v2 и runtime v1 с descriptor v3, проверяют количество children и точное совпадение связей корня и графа. Контейнерная валидация охватывает каждый host дерева.
- `item-value.js:evaluateItemValue(descriptor,reader)` для v3 добавляет `weaponModValue`, суммируя каждый реальный компонент один раз. Неизвестная цена/неверный kind отклоняется; global identity/depth/document budgets общие с contents. Точная форма результата v2 сохранена. `lootgen-catalog-reader.js:resolveValueComponent` передаёт source attachment profile для проверки kind.
- `ItemInstanceDocuments.readSource` выставляет `hasWeaponMods`; `planItemInstanceMutation`, `getInventoryDismantleBlockReason` и `isInventoryGraphItem` защищают составное оружие и установленный child от plain/split/dismantle путей. Inventory graph transfer запрещает отдельный перенос child и проверяет связи при recovery.
- Focused: `tests/weapon-mod-transport.test.mjs`, `tests/composite-item-graph.test.mjs`, существующие runtime graph, prepared item, Storage, value, instance/recovery и disarm tests.

Входной индекс: [паспорт функций](function-passport.md), раздел 14. Правила: [утверждённая спецификация](superpowers/specs/2026-10-16-weapon-attachments-design.md).

## Каталог и носители

Владелец: `scripts/data/weapon-mod-catalog.js`; источники: `data/gear.json`, `data/weapon-mod-rules.json`, `data/weapon-mod-hosts.json`.

- `buildWeaponModCatalog(gear,definitions,hosts) -> {rows,hosts}` проверяет уникальные stable IDs, source joins, типы правил и известные compatibility tags; future source без правила сохраняется видимым unavailable. Возвращает detached профили с исходным attachment signature; source данные не меняет.
- `loadWeaponModCatalog() -> Promise<Catalog>` объединяет три versioned read-only fetch в cached Promise; ошибки сбрасывают Promise для повтора. Не сканирует assets и не пишет settings/Items.
- `getWeaponModCandidate(item,catalog)` возвращает `{itemId,sourceId,quantity,profile,profileSignature,available,legacyOverride,reason}`. Source — только `gearId`; отсутствие старого stored attachment допускает каталог, отличающийся custom профиль сохраняется без новой установки. Нет name fallback.
- `getWeaponModHostDescriptor(item,catalog)` возвращает `{id,gearId,family,form,baseForm,modelTags,mountIds,quantity,requiresGmApproval}` либо null. Канонические source rows различают primitive/advanced/crossbow и short/long; колесцовый пистолет long. Удаление текущего Reload исключает magazine-fed tag. Native неизвестный firearm получает family fallback и необходимость решения GM; обычный неизвестный weapon не становится огнестрелом по имени.
- Focused: `tests/weapon-mod-catalog.test.mjs`, `tests/weapon-mod-rules.test.mjs`.

## Pure правила и проверка сохранённых связей

Владелец: `scripts/data/weapon-mod-rules.js`; Foundry globals отсутствуют.

- `WeaponModRuleError(code,details={})` сообщает объяснимый отказ incompatible/invalid-quantity/slot-conflict/duplicate-mod/capacity/missing-dependency/unavailable/gm-approval-required.
- `weaponModFlag(item,key)` читает flag без записи; `weaponModProfileSignature(profile)` канонизирует object keys. `isInstalledWeaponMod(item)` распознаёт синтаксическую обратную связь/container; это не подтверждение авторизации/валидности.
- `validateWeaponAttachmentInstallation(host,installed,candidate,{mountId=null}={}) -> {mountIds}` требует singleton host, доступную целую единицу, verified profile, совместимость и уникальность вида. oneOf занимает одно свободное место в topology order; all занимает по одному месту каждой категории. Для bottom+barrel выбранный bottom закрепляется, второй остаётся свободен. Повреждённые/перекрывающиеся installed mounts отклоняются до выбора.
- `validateModernizedPartInstallation(host,parts,candidate,{removeItemId=null,gmApproval=null}={}) -> {countedParts,removeItemId}` проверяет итоговую сборку, зависимости, исключающие пары, максимум3 counted parts, improved-grip exception и GM requirement. Бесплатное включённое снятие допускается при достигнутом лимите; оно не оставляет orphan dependency. Crossbows не являются носителями modernizedPart.
- `readWeaponMods(host,resolveItem,catalog) -> {attachments,modernizedParts,diagnostics}` читает weaponMods v1 и возвращает только реальные children с quantity1, exact Actor/host/container/reverse links, source signatures и допустимыми полными mount sets/частями. Все исторические flags сохраняются, invalid entries получают diagnostics без эффекта. Проверка прежней установленной части не требует повторного GM approval после переноса.
- Новый state не переиспользует `itemUpgrades`/`installedUpgrade` и не меняет 1–3 слота обычных усовершенствований. Runtime mutation/effect APIs не публикуются на этом этапе.
- Focused: `tests/weapon-mod-rules.test.mjs`, `tests/weapon-mod-catalog.test.mjs`; compatibility regressions: item-upgrade-rules/service, gear-compendium.
