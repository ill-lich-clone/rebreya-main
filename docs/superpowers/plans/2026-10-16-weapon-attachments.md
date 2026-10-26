# Weapon Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать на вкладке МОДЫ индивидуальный чертёж оружия, установку имеющихся обвесов, платную установку модернизаций и их эффекты с сохранением всего дерева предметов.

**Architecture:** Расширить существующие ItemUpgradeService, ItemInstanceWorkflow, runtime item graph и боевые adapters. По уточнению пользователя craft/calendar workflow не изменяется. Pure правила, проверенные профили и раскладка чертежей выделяются в небольшие профильные файлы; новых владельцев world state, журналов, глобальных hooks и attack engine нет.

**Tech Stack:** JavaScript ESM, Foundry VTT 13, установленная dnd5e 5.2.5, Handlebars/CSS/SVG для панелей, Node test runner; ImageGen для 38 отдельных raster-чертежей. Новые runtime-зависимости не нужны.

**Spec:** [Утверждённая спецификация](../specs/2026-10-16-weapon-attachments-design.md), утверждена 2026-10-16, включая возврат снятых частей, альтернативность обойм и порядок веса. Исходная точка плана — `52ff76e4`, module version `1.4.377`; перед выполнением сверить текущий HEAD и версию.

## Global Constraints

- Крепления: примитивное `top,bottom-1,barrel`; продвинутое/особое `top,bottom-1,bottom-2,side-1,side-2,barrel`; арбалет `top,bottom-1`. «Низ + ствол» занимает один нижний слот и ствол.
- Каталог полный; имеющиеся экземпляры первыми, отсутствующие серые и disabled. Только реальный доступный Item того же Actor; один обвес каждого вида на оружии; носитель `quantity = 1`, из стека компонента выделяется одна единица.
- Обвес: установка бонусным действием, снятие действием. Пересборка: одна новая часть и прямое списание **500 зм** у Actor-владельца; при достигнутом лимите одно снятие без второй оплаты. Неделя по 8 часов — текст правила, без календаря и проектов.
- Три учитываемые модернизации. Улучшенная пистолетная рукоять требует базовую, не занимает лимит, даёт дополнительный +1 до общего +2 и требует отдельные неделю/500 зм. Две обоймы и перечисленные исходником пары стволов/сверловок несовместимы.
- Снятая часть возвращается в инвентарь. Неизвестная цена не становится нулём; 500 зм не прибавляются автоматически к цене продажи. Формулы, charges, choices, quantity rules и фактические receipts сохраняются.
- 13 обвесов + 12 модернизаций исходной выборки реализуются с точными условиями; все 34 огнестрела + 4 арбалета получают индивидуальные чертежи. Новые строки каталога без проверенного правила видны с причиной недоступности.
- Существующие `itemUpgrades`/`installedUpgrade`, API, settings, лимиты обычных усовершенствований и source-профили сохраняют семантику. Новое состояние — отдельная versioned ветвь `weaponMods`.
- Единственная composition root — `scripts/main.js`. Player/неактивный GM направляют privileged intent через typed command active GM; никаких доверенных цен, профилей или ItemData от клиента.
- Перед исполнением: `git status --short --branch`, `git branch --show-current`, `git fetch origin`, сравнение с `origin/main` и `origin/lich_branch`. Работать только в `lich_branch`; при чужих изменениях, ушедшей вперёд remote-ветке или конфликте с main остановиться по AGENTS.md. Создавать worktree только если требуется изоляция, через соответствующий skill; не обходить требование ветки.
- **Каждый runtime/asset commit:** повысить текущий patch в `module.json`, создать соответствующий `scripts/main-<version>.js` только с импортом `main.js`, обновить `esmodules` и затронутые versioned imports. Общий asset-root не сканировать рекурсивно из каждого сервиса; registry/manifest читать один раз на batch по canonical ESM URL.
- **Commit gate R:** focused RED → минимальная реализация → focused GREEN → обновление профильного паспорта/API docs → version/forwarder → полная проверка из раздела 13 → содержательный diff → `git add` только перечисленных файлов задачи → commit → `git push -u origin lich_branch`. Полный успешный вывод не сохранять. Не повторять успешные проверки без новых изменений; после исправлений перепроверять затронутое до commit.
- Пока проверяется этот план, runtime, assets и тесты реализации не изменяются. Способ исполнения выбирает пользователь; Codex выполняет компактные анализы, черновики и проверку результатов.

## Review Focus

1. Необычные модели и переименованные Items: колесцовый пистолет по источнику длинноствольный; арбалет не становится огнестрелом из-за Reload. Проверки — T1.
2. Устаревший каталог, подмена payload и два одновременных клика: повторная авторизация и свежая проверка внутри очереди; максимум одна установка/оплата. Проверки — T3/T5.
3. Обрыв записи, смена active GM и чужая правка: resume/compensation только своих подтверждённых изменений, без дубликатов и overwrite. Проверки — T2/T3/T4/T5.
4. Source edit, prepareData, несколько целей и неизвестные условия: вклад не накапливается, не распространяется на другое оружие и не угадывается. Проверки — T6/T7/T9.
5. GM недоступен, окно закрыто или повторено действие после reload: деньги/согласование/предметы сохраняются, действие и плата не учитываются дважды. Проверки — T3/T5/T7/T9/T12.

## 1. Карта файлов, контракты и зависимости

Новые имена ниже — **планируемые интерфейсы**, а не утверждение об уже существующих методах. В implementation commit новые методы записываются в профильный паспорт; `docs/function-passport.md` остаётся индексом.

| Новый файл | Ответственность |
| --- | --- |
| `data/weapon-mod-rules.json` | Один проверенный профиль эффекта/совместимости на stable ID; source refs и статус поддержки всех строк. |
| `data/weapon-mod-hosts.json` | Stable IDs 38 носителей, семейство, коротко-/длинноствольность, tags модели, требование согласования. |
| `scripts/data/weapon-mod-catalog.js` | Cached загрузка/проверка registry, detached профиль и signature; без записей документов. |
| `scripts/data/weapon-mod-rules.js` | Pure topology, compatibility, duplicates, dependencies, capacity; чтение/проверка link DTO. |
| `scripts/application/weapon-mod-mutation-commands.js` | Exact typed payloads, authorization и регистрация новых команд в существующем bus. |
| `scripts/data/weapon-rebuild-rules.js` | Pure проверка итоговой сборки и точной платы 50000 cp из native кошелька; без календаря и проектов. |
| `scripts/automation/weapon-mod-projections.js` | Вклады source → свойства, вес, дальность, эффективный магазин и passive modifiers. |
| `scripts/automation/weapon-mod-roll-modifiers.js` | Pure условные modifiers/решения для одной атаки/цели. |
| `scripts/data/weapon-mod-activities.js` | Managed native activity definitions с identity physical child; не их исполнение. |
| `data/weapon-blueprints.json`, `assets/weapon-blueprints/<gearId>.png` | Изображения и нормализованные anchors, независимо от игровых правил. |
| `scripts/integrations/weapon-mod-panel.js` | Разметка чертежа/каталога и listeners существующей вкладки; не отдельный Application. |
| `tests/helpers/weapon-mod-fixture.mjs` | Detached DTO и Actor/document harness; сравнение реального состояния, не копия алгоритмов. |
| `docs/weapon-mods-function-passport.md` | Сигнатуры, владельцы, data flow, ограничения и focused tests новых возможностей. |

Изменяемые существующие владельцы перечислены в каждой задаче. Нет массового рефакторинга `main.js`, inventory или attack service. Последовательность: **T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12**. T10 независим от боевой реализации после T1, но его параллельное выполнение требует отдельно выбранного пользователем способа работы.

### Task 1: T1. Проверенные профили, topology и чистые правила

**Files:** Create первые четыре data/catalog/rules файла из карты, fixture и `tests/weapon-mod-rules.test.mjs`, `tests/weapon-mod-catalog.test.mjs`; Modify `docs/function-passport.md`; Create профильный паспорт. `data/gear.json` не переписывать ради дублирования registry.

**Interfaces:** `loadWeaponModCatalog() -> Promise<Catalog>`; `getWeaponModHostDescriptor(item,catalog) -> Host|null`; `readWeaponMods(host,resolveItem,catalog) -> {attachments,modernizedParts,diagnostics}`; `isInstalledWeaponMod(item) -> boolean` только определяет наличие обратной связи, не служит доказательством её валидности; `validateWeaponAttachmentInstallation(host,installed,candidate,{mountId=null}={}) -> {mountIds}`; `validateModernizedPartInstallation(host,parts,candidate,{removeItemId=null,gmApproval=null}={}) -> {countedParts,removeItemId}`. Host содержит `{id,gearId,family,form,modelTags,mountIds,quantity,requiresGmApproval}`; candidate — `{itemId,sourceId,profile,profileSignature,quantity,available}`. Отказы — `WeaponModRuleError(code,details)` с объяснением. Fixture экспортирует `makeHost(gearId,overrides={})`, `makeCandidate(sourceId,overrides={})` и `makeInstalled(sourceId,itemId,mountIds=[])` с этими DTO.

- [x] **1. RED:** `named mounts and duplicate rules`, `pistol grip exception`, `source classification survives rename`, `future catalogue row fails closed`. Точные assertions:
  ```js
  assert.deepEqual(validateWeaponAttachmentInstallation(makeHost('vintovka'), [], makeCandidate('soshki'), {mountId:'bottom-2'}).mountIds, ['bottom-2','barrel']);
  assert.equal(getWeaponModHostDescriptor(renamedWheellock,catalog).form, 'long');
  assert.throws(() => validateWeaponAttachmentInstallation(crossbow,[],makeCandidate('glushitel')), {code:'incompatible'});
  ```
  Дополнительно: ровно 3/6/2 mount IDs; повтор sourceId отклоняется; ствол/сверловка/обоймы конфликтуют; три counted parts + improved grip допустимы только с базовой; итог пары +2 закреплён данными registry, неизвестный tag/profile запрещён. Старая world-копия без attachment profile получает read-only fallback по stable gearId, без name matching/Item.update; отличающийся custom profile сохраняется, но не допускается к новой установке. Baseline fixture фиксирует 13/12 профилей, но runtime не обрезает будущий каталог до 25 строк.
- [x] **2. Run:** `node --test tests/weapon-mod-rules.test.mjs tests/weapon-mod-catalog.test.mjs`; ожидается FAIL на отсутствующем новом интерфейсе/правиле.
- [x] **3. Implement:** exact profiles по approved spec и source refs; коротко-/длинноствольность взять из секций `Огнестрел V0.36!A1:D45`, не из имени. Особым считать явный registry-признак или canonical `spc`; для неизвестного form требовать решение GM. Новые registry rows не дают исполнять чужие arbitrary flags.
- [x] **4. GREEN:** та же команда, затем `node --test tests/item-upgrade-rules.test.mjs tests/item-upgrade-service.test.mjs tests/gear-compendium.test.mjs`. Проверить detached входы, custom profiles и прежние 1–3 слота.
- [x] **5. Commit gate R:** `feat: define verified weapon mod rules`.

### Task 2: T2. Транспорт дерева и стоимость без изменения старых слотов

**Files:** Modify `scripts/data/runtime-item-graph.js`, `scripts/data/lootgen-composition.js`, `scripts/data/lootgen-item-descriptor.js`, `scripts/data/lootgen-prepared-item.js`, `scripts/data/lootgen-source-catalog.js`, `scripts/data/storage-container-snapshot.js`, `scripts/data/storage-container-item-service.js`, `scripts/data/item-value.js`, `scripts/data/item-instance-rules.js`, `scripts/data/inventory-ingress-descriptor.js`, `scripts/application/inventory-graph-transfer.js`, `scripts/infrastructure/foundry/item-instance-documents.js`; Test существующие файлы из шагов2/4 этой задачи.

**Interfaces:** host flag `{version:1,attachments:[{itemId,sourceId,mountIds}],modernizedParts:[{itemId,sourceId}],approvals:[{sourceId,profileSignature,approvedByUserId}]}` в `weaponMods`; child flag `installedWeaponMod:{version:1,kind,hostActorId,hostItemId,mountIds}` + native `system.container`. Перенос сохраняет существующий RuntimeGraph v1 envelope и все node snapshots, но явно remap/verify обе новые связи. Для сериализованной композиции ввести descriptor **v3**: прежние поля v2 плюс `weaponMods:{version:1,attachments:[{instanceKey,sourceId,mountIds}],modernizedParts:[{instanceKey,sourceId}]}`; обычные v1/v2 продолжают читаться/выдаваться прежним образом. `evaluateItemValue(v3,reader)` добавляет `weaponModValue` и включает его в total; результат v2 сохраняет точную прежнюю форму.

- [x] **1. RED:** `weapon mods survive storage round trip`, `graph remaps every reverse link`, `installed mod cannot split or dismantle`, `v3 counts a multi-mount child once`, `foreign edit blocks recovery`:
  ```js
  assert.equal(roundTrip.weaponMods.attachments[0].mountIds.length, 2);
  assert.equal(targetChild.getFlag('rebreya-main','installedWeaponMod').hostActorId, target.id);
  assert.equal(evaluateItemValue(v3,reader).totalValue, baseCp + upgradeCp + modCp + contentsCp);
  assert.deepEqual(evaluateItemValue(legacyV2,reader), legacyExpected);
  ```
  Закрепить quantity1, unique identities, cap200/depth8, unknown-price, included-component multiset, сохранение charges/choices/ammo, отказ при forged/missing child; terminal replay после удаления цели не создаёт её повторно.
- [x] **2. Run:** `node --test tests/runtime-item-graph.test.mjs tests/runtime-graph-inventory.test.mjs tests/lootgen-item-descriptor.test.mjs tests/item-value.test.mjs tests/storage-container-snapshot.test.mjs`; FAIL на новых edges/v3.
- [x] **3. Implement:** расширить существующие capture/materializer/snapshot normalizers и value traversal, а не создавать второй graph. Согласовать composition keys, prepared-marker validation и inventory identity; native child не должен одновременно считаться contents и mod. Сложный host/child блокировать существующими split/dismantle guards.
- [x] **4. GREEN:** предыдущая команда + `node --test tests/lootgen-prepared-item.test.mjs tests/storage-container-item-service.test.mjs tests/inventory-ingress-descriptor.test.mjs tests/inventory-mutation-recovery.test.mjs tests/item-instance-rules.test.mjs tests/disarm-service.test.mjs`.
- [x] **5. Commit gate R:** `feat: preserve weapon mods in item graphs`.

### Task 3: T3. Каноническая установка, typed commands и действия

**Files:** Modify `scripts/data/item-upgrade-service.js`, `scripts/main.js`, существующий inventory row filter в `scripts/integrations/item-upgrade-sheet.js`; Create command module из карты, `tests/weapon-mod-mutations.test.mjs`, `tests/weapon-mod-commands.test.mjs`; Extend fixture.

**Interfaces:** ItemUpgradeService добавляет `getWeaponModsProjection(host) -> Promise<Projection>`, `installWeaponAttachment(host,component,{mountId=null,operationId})`, `removeWeaponAttachment(host,componentOrId,{operationId})`, `applyWeaponModernization(host,component,{removeItemId=null,operationId,completionReceipt})`. Публичные wrappers принимают ссылки `{actorUuid,hostItemId,componentItemId,mountId?,operationId}`; удаление не принимает mountId. Commands `item-mod.attachment.install`, `item-mod.attachment.remove`, `item-mod.modernization.approve` имеют отдельные exact validators. GM approval payload `{actorUuid,hostItemId,sourceId,profileSignature,operationId}`; authenticated sender всегда задаётся executor. `Projection={host,attachments,modernizedParts,catalogue,diagnostics}`; entries содержат реальные child IDs, sourceId, mounts и статус, без исполняемых клиентских profiles.

Command module экспортирует `registerWeaponModCommands(moduleApi,bus) -> void`, `isValidWeaponAttachmentInstallPayload(payload)`, `isValidWeaponAttachmentRemovePayload(payload)`, `isValidWeaponModernizationApprovalPayload(payload)`. Approval wrapper называется `approveWeaponModernization(payload)`; install/remove wrappers имеют те же имена, что методы service, но принимают serialized payload. Зарезервировать `item-mod.activity.use` и `isValidWeaponModActivityPayload(payload)` для T7/T8: exact `{actorUuid,hostItemId,childItemId,activityId,operationId,decision}`; decision — null или конечный typed object T7/T9. До подключения обработчика возвращать явный unsupported result, без writes. Result mutations сохраняет `{operationId,itemId,sourceRemaining,changed,replayed}`.

Constructor сохраняет прежний `getManifest` и добавляет optional DI `{getWeaponModCatalog=loadWeaponModCatalog}`. Workflow/driver используют уже существующие `InventoryService.mutationJournal` и `mutationCoordinator` (образец фабрики `scripts/data/inventory-service.js:5685`); отдельный journal/coordinator не создаётся. Actor flag approvals — только проекция: действительное GM-согласование сверяется с authenticated audit существующего inventory journal и привязкой host/profileSignature. Поддельный approvedByUserId в Item flags не даёт разрешения. Установленная часть при переносе продолжает действовать; новое согласование требуется для новой установки, а не повторной активации старой.

- [x] **1. RED:** `split and install exactly one`, `same-kind and two writers conflict`, `stale item and forged payload reject before write`, `replay survives reload`, `GM loss never compensates`, `action cards are exactly once`:
  ```js
  assert.equal(source.system.quantity, 2); // исходный stack 3
  assert.equal(actor.items.filter(isInstalledWeaponMod).length, 1);
  assert.equal(installCard.activation.type, 'bonus');
  assert.equal(removeCard.activation.type, 'action');
  assert.equal(replayed.operationId, first.operationId);
  ```
  Проверить same Actor/OWNER, host quantity1, busy project, отсутствующий/чужой Item, конфликт одного mount из all, отмену activity, duplicate request ID с другим fingerprint и поддельный Actor approval без GM audit; ни один отказ не оставляет child/успешную карточку. Старые upgrade exports и state остаются прежними.
- [x] **2. Run:** `node --test tests/weapon-mod-mutations.test.mjs tests/weapon-mod-commands.test.mjs`; FAIL.
- [x] **3. Implement:** ItemUpgradeService готовит placement patches и использует существующие `ItemInstanceWorkflow.run/runBatch`, `ItemInstanceDocuments`, inventory journal и Actor queues. В intent добавить mode `weapon-mod-install|weapon-mod-remove` и host/mount IDs: они входят в fingerprint. Для membership явно `planSource(...)->{sameFolder:false}`; для split применять `$target` substitution. Не копировать journal state machine. Уточнение T5 заменяет completion-only prototype на прямую платную установку с journal audit GM. Chat result привязать к тому же operationId: write-then-throw подтверждать readback, failed chat publication повторять без повторной установки. Экономику действий показывать native activation, используя существующий механизм, если он ведётся; новый счётчик action-spent не вводить.
- [x] **4. GREEN:** новые tests + `node --test tests/item-instance-workflow.test.mjs tests/item-instance-batch.test.mjs tests/item-upgrade-service.test.mjs tests/group-command-dispatch.test.mjs tests/inventory-mutation-recovery.test.mjs`. Проверить новую запись после каждого инъецированного сбоя и оба active/inactive GM маршрута.
- [x] **5. Commit gate R:** `feat: install owned weapon attachments durably`.

### Task 4: T4. Перестройка магазина и смена патронов без потерь

**Files:** Modify `scripts/combat/attack-service.js`, `scripts/data/item-upgrade-service.js`, `scripts/data/weapon-mod-rules.js`; Extend `tests/combat-attack-service.test.mjs`, `tests/weapon-mod-mutations.test.mjs`.

**Interfaces:** CombatAttackService добавляет read-only `planWeaponAmmoReconfiguration(actor,host,{capacity,ammunition}) -> {updates,creates,before,after,returned}`. План содержит exact snapshots подходящих stacks и оружия, без записи; ItemUpgradeService включает его в тот же durable batch завершения модернизации. Эффективная capacity отделена от **baseCapacity**, используемой расходом Automatic Fire.

- [x] **1. RED:** `expanded magazine preserves base burst cost`, `shrinking returns overflow once`, `rifling unloads previous ammunition`, `unknown ammo blocks entire change`:
  ```js
  assert.equal(expanded.capacity, 27); assert.equal(expanded.automaticAmmoCost, 18);
  assert.equal(afterMagazine.current, 18); assert.equal(returnedCartridges, 9); // было 27/27
  assert.equal(afterMagazine.current + ammoInventoryAfter, beforeLoaded + ammoInventoryBefore);
  ```
  Тесты создаваемого нового ammo stack, write-then-throw, конфликта чужого stack и сбоя после выдачи overflow: нет двойного возврата, потери или бесплатных выстрелов.
- [x] **2. Run:** `node --test --test-name-pattern="magazine|overflow|rifling|ammo" tests/combat-attack-service.test.mjs tests/weapon-mod-mutations.test.mjs`; FAIL для новых случаев.
- [x] **3. Implement:** планирование без side effects, проверка actual ammo type до журнала, fresh CAS на snapshots. Не перезаписывать базовый Reload или текущий магазин из computed capacity. В batch входят part links, host ammo/name и возврат подходящих физических патронов; при неизвестном источнике отказ до записи.
- [x] **4. GREEN:** `node --test tests/combat-attack-service.test.mjs tests/weapon-mod-mutations.test.mjs tests/environment-automation-service.test.mjs`; прежние aborted pre-roll, one-write jam, batched reload и removed-property tests остаются неизменными.
- [x] **5. Commit gate R:** `feat: reconcile ammunition during weapon rebuilds`.

### Task 5: T5. Прямая платная пересборка без календаря

**Уточнение пользователя:** только списание денег; календарь, проекты, scheduler и craft workflow не изменять. Неделя по 8 часов остаётся текстом настольного правила.

**Files:** Create `scripts/data/weapon-rebuild-rules.js`, `tests/weapon-rebuild-rules.test.mjs`, `tests/weapon-rebuild-mutations.test.mjs`; Modify `scripts/data/item-upgrade-service.js`, `scripts/application/weapon-mod-mutation-commands.js`, `scripts/main.js`, профильный паспорт и README. Имеющиеся craft/calendar services не менять.

**Interfaces:** `buildWeaponRebuildQuote({host,component,parts,removeItemId,gmApproval,currency})` проверяет итоговую сборку и плату 50000 cp, возвращает точные currency before/after. `ItemUpgradeService.installWeaponModernization(host,component,{removeItemId,operationId,approvalReceiptId,...context})` использует T3/T4 batch. Старый completion-only метод становится paid alias и не позволяет обойти плату через forged receipt. Public serialized wrapper и command `item-mod.modernization.install` принимают только ссылки, operationId и optional removal/approval IDs. Approval имеет authenticated GM audit в существующем journal и привязку к этому operationId, host и profile signature; flag не является доказательством.

- [x] **1. RED:** 499/500 зм, смешанные монеты, одна часть за оплату, включённое снятие при лимите, улучшенная рукоять тоже платная, неизвестная покупная цена детали не меняет fee; stale wallet/foreign edit, retry/reload/GM loss не дают второй оплаты или бесплатной части; отмена GM/подтверждения до записей; поддельное согласование не принимается.
- [x] **2. Run:** `node --test tests/weapon-rebuild-rules.test.mjs tests/weapon-rebuild-mutations.test.mjs`; FAIL.
- [x] **3. Implement:** списать кошелёк Actor-владельца оружия и включить ссылки/патроны в один существующий batch с точными before/after. Никаких календарных регистраций, проектов или новых кошельков/journals. Согласование GM не переносится на другой host/profile/операцию.
- [x] **4. GREEN:** новые tests + `node --test tests/weapon-mod-mutations.test.mjs tests/item-instance-batch.test.mjs tests/item-instance-workflow.test.mjs tests/weapon-mod-commands.test.mjs`; прежние craft/calendar tests сохраняются без изменений.
- [x] **5. Commit gate R:** `feat: charge directly for weapon modernizations`.

### Task 6: T6. Не накапливающиеся проекции свойств, веса и пассивных бонусов

**Files:** Create `scripts/automation/weapon-mod-projections.js`, `tests/weapon-mod-projections.test.mjs`; Modify `scripts/automation/item-upgrade-automation-service.js`, `scripts/automation/item-upgrade-projections.js`, `scripts/automation/item-upgrade-roll-modifiers.js`, `scripts/integrations/item-upgrade-roll-adapter.js`; Read/use existing `scripts/data/inventory-weight.js` для проверки общего веса.

**Interfaces:** `buildWeaponModContributions({host,mods,context={}}) -> {contributions,diagnostics}` использует проверенные links T1/T3 и вклад с identity `{actorUuid,hostItemId,childItemId,effectKey,projectionVersion}`. В существующем `ItemUpgradeAutomationService.project()` объединяются прежние и новые вклады. Source projection применяется одной restore/apply последовательностью; `systemPatch` не сохраняется поверх authored source.

- [x] **1. RED:** `prepare twice is idempotent`, `source edit and removal restore current values`, `weight modifier order`, `grip dependency yields total two`, `sawed off changes base dice only`:
  ```js
  assert.equal(projected.weightLb, 15); // (base20 + modernDelta2) / 2 + attachments4
  assert.equal(projected.attackBonus, 2); // базовая и улучшенная рукояти
  assert.deepEqual(secondPrepare, firstPrepare);
  ```
  Закрепить kg/lb, нижнюю границу ноль, чужие AE и дополнительные authored damage terms, отдельные нормальную/максимальную дальности, снятие `two`, изменение form до short, half body weight и прежнее усовершенствование уменьшения веса — оно применяется ровно один раз к полученному общему весу. Проверить `buildActorInventoryWeightSnapshot(actor).weightLb === 15` для примера выше, native encumbrance и то, что source-вес каждого child неизменён и восстанавливается после снятия.
- [x] **2. Run:** `node --test tests/weapon-mod-projections.test.mjs`; FAIL.
- [x] **3. Implement:** source → additive modernization weight → body multiplier → physical attachment weight → existing simple-upgrade weight reducer. Root содержит общий вычисленный вес; для доказанно установленного child его derived weight contribution к переносимому весу равен0 через тот же native restore/apply adapter, source weight не записывается. Снятие, invalid link и чужой Item не оставляют нулевой projection. Так native encumbrance и existing inventory-weight не считают компонент повторно; в панели исходный вес компонента читается из source/каталога с пометкой «учтён в оружии». Пассивные операции registry реализовать через существующие capability/WeakMap механизмы. Custom damage formula, которую нельзя корректно преобразовать, возвращает точную диагностику/решение мастера, не переписывается приблизительной формулой.
- [x] **4. GREEN:** новые tests + `node --test tests/item-upgrade-projections.test.mjs tests/item-upgrade-automation-service.test.mjs tests/item-upgrade-roll-adapter.test.mjs tests/item-upgrade-roll-modifiers.test.mjs tests/item-upgrade-absorption.test.mjs`.
- [x] **5. Commit gate R:** `feat: project passive weapon mod effects`.

### Task 7: T7. Прицеливание, положение, видимость и подводный режим

**Files:** Create `scripts/automation/weapon-mod-roll-modifiers.js`, `tests/weapon-mod-roll-modifiers.test.mjs`; Modify `scripts/integrations/item-upgrade-roll-adapter.js`, `scripts/combat/attack-service.js`, `scripts/automation/weapon-mod-projections.js`; Extend existing turn/combat hook owner, не регистрировать второй набор listeners.

**Interfaces:** `evaluateWeaponModAttack({host,attack,target,contributions,conditions}) -> {allowed,attackBonus,rangeMultiplier,ignoreHalfCover,damageRules,diagnostics,needsDecision}`; conditions `{movedFeet,prone,targetVisible,usesProficiency,underwater,aimMode}` содержат known values или `null`. Fixture дополняется `makeAttackCase(sourceId,conditionOverrides={})` с этим input DTO. `CombatAttackService.useWeaponModActivity(activity,usageConfig) -> Promise<result>` исполняет только managed activity T8 и подтверждённые decisions через command T3. Состояние aim привязано к actor/host/combat/round/turn и очищается существующим turn lifecycle.

Decision T7 имеет exact форму `{kind:'attack-conditions',targetUuid,attackMessageId,movedFeet,prone,targetVisible,usesProficiency,underwater,aimMode}`. UUID/message допускают null до выбора цели/создания атаки; movedFeet — null либо конечное неотрицательное число; boolean conditions допускают null; aimMode — null/`collimator`/`scope`. Ответ заполняет только неизвестное: не переопределяет уже известный authoritative факт.

- [x] **1. RED:** `collimator ten versus eleven feet`, `scope requires no movement`, `laser needs sight and proficiency`, `stock and bipod prone rules`, `underwater range is conditional`, `different targets require separate resolution`:
  ```js
  assert.equal(evaluateWeaponModAttack(makeAttackCase('kollimatornyy-pritsel',{movedFeet:10})).allowed, true);
  assert.equal(evaluateWeaponModAttack(makeAttackCase('kollimatornyy-pritsel',{movedFeet:11})).allowed, false);
  assert.equal(evaluateWeaponModAttack(makeAttackCase('opticheskiy-pritsel',{movedFeet:0})).rangeMultiplier, 2);
  assert.equal(evaluateWeaponModAttack(makeAttackCase('lazernyy-tseleukazatel',{targetVisible:true,usesProficiency:false})).attackBonus, 0);
  ```
  Проверить скорость0 после коллиматора, только половинное укрытие, конец хода, reload mid-turn, смену носителя, значения null с decision prompt, отмену и multi-target roll с разными бонусами без глобальной подстановки первого результата.
- [x] **2. Run:** `node --test tests/weapon-mod-roll-modifiers.test.mjs`; FAIL.
- [x] **3. Implement:** до roll известные conditions брать из существующего workflow/движения/статусов. Неизвестные — явный prompt для конкретной атаки; результат не сохранять как глобальное свойство цели. Aim не назначает выдуманную action cost. Использовать существующий cancel/pre-roll/post-roll контракт; условные range/cover modifiers не переписывают source Item.
- [x] **4. GREEN:** новый test + `node --test tests/combat-attack-service.test.mjs tests/item-upgrade-roll-adapter.test.mjs tests/environment-automation-service.test.mjs`.
- [x] **5. Commit gate R:** `feat: apply conditional attachment attack rules`.

### Task 8: T8. Activities штыка, фонарика и гранатомёта

**Files:** Extend `scripts/data/weapon-mod-activities.js` (identity helper введён в T7), Create `tests/weapon-mod-activities.test.mjs`; Modify `scripts/automation/item-upgrade-automation-service.js`, `scripts/combat/attack-service.js`, `scripts/application/weapon-mod-mutation-commands.js`; Read `scripts/data/magic-items-compendium.js:3942` и `:4191` как существующий образец native light, не переносить туда firearm owner. В текущем CombatAttackService нет общего explosive executor: гранаты используют native dnd5e save/damage Activities с каноническим explosive profile, а существующий CombatAttackService остаётся dispatcher. Неизвестную save ability подтверждает GM, её нельзя угадывать по названию.

**Interfaces:** `buildWeaponModActivities(host,mods) -> ActivityData[]`; ID стабилен для host/child/effect, managed marker `flags.rebreya-main.weaponModActivity={hostItemId,childItemId,sourceId,effectKey}`. T7 `useWeaponModActivity` dispatches `bayonet-attack`, `flashlight-toggle`, `launcher-load`, `launcher-fire`; execution проверяет живую связь и текущую quantity, не доверяет marker как полномочию.

- [x] **1. RED:** `bayonet is spear without thrown`, `flashlight toggles owned light contribution`, `launcher stores and spends six physical grenades`, `managed activity sync preserves foreign activities and uses`:
  ```js
  assert.equal(bayonet.properties.has('thr'), false); assert.equal(bayonet.firearmAmmoSpent, 0);
  assert.deepEqual([light.distance,light.bright,light.dim], [60,30,60]);
  assert.equal(launcher.capacity, 6); assert.equal(load.activation.type, 'action'); assert.equal(fire.range, 90);
  ```
  dim=60 — внешний радиус native Token light; яркий радиус30. Проверить текущую сторону/угол canonical cone renderer, отменённый выстрел, зарядку7-й гранаты, неодинаковые типы гранат, независимость основного магазина, снятие/выключение света и чужую правку Token light без overwrite старым snapshot.
- [x] **2. Run:** `node --test tests/weapon-mod-activities.test.mjs`; FAIL.
- [x] **3. Implement:** activity definitions + idempotent managed sync внутри существующего automation lifecycle. Штык берёт правила canonical spear без thrown; гранатомёт хранит реальные grenade units в native container одного child и использует native explosive Activity. Расход идёт через прежний inventory batch из awaited consume только после native configuration; отмена до подтверждения бесплатна. Фонарик использует Token активного workflow; при нескольких/отсутствующих Tokens запрашивает выбор/показывает причину. Отдельный managed native AmbientLight сохраняет точный конус и любое чужое Token.light: один Token light не может точно совместить слабый круговой свет и сильный конус. Existing lifecycle синхронизирует его позицию/поворот и удаляет только свой source. Удаляются только собственные managed activities; текущие uses и authored overrides сохраняются при повторной sync.
- [x] **4. GREEN:** новый test + `node --test tests/combat-attack-service.test.mjs tests/item-upgrade-automation-service.test.mjs tests/gear-compendium.test.mjs tests/magic-item-runtime.test.mjs`.
- [x] **5. Commit gate R:** `feat: add attachment utility activities`.

### Task 9: T9. Глушители и правила сопротивлений конкретной цели

Уточнение по каноническому `weapon-property-glossary.js` («Разброс»): сверловки используют тот же подтверждённый бросок атаки против КД окружающих существ. Базовый радиус5 фт., сильная сверловка10; слабая добавляет только фактический модификатор характеристики исходной атаки к исходной scatterDamage. Обычные бонусы урона и дополнительный бросок атаки/патроны не добавляются. Для большого Token GM явно выбирает одно занимаемое5-футовое пространство. Это отдельный путь, automatic/semi cones45/30 не меняются. `buildWeaponModScatterPlan` остаётся pure; actual targets/одна native DamageRoll/receipt обслуживает прежний Combat owner. Exact decision `scatter` содержит attackMessageId, primaryTargetUuid (nullable), originPoint (nullable{x,y}), abilityModifier (nullable finite). Pending/rolling/result хранятся в закрытой GM-карточке, native damage application сохраняет владельца HP. Native skill/target receipts тоже закрытые: скрытые наблюдатели не записываются в публичную карточку атаки.

**Files:** Modify `scripts/combat/attack-service.js`, `scripts/combat/curse-upgrade-damage.js`, `scripts/automation/weapon-mod-roll-modifiers.js`; Create `tests/weapon-mod-target-effects.test.mjs`.

**Interfaces:** `buildWeaponModTargetDecision({host,attack,target,conditions}) -> {suppressionCheck,damageRule,needsDecision,diagnostics}` в pure roll module. `damageRule={ignoreNonmagicalResistance,treatNonmagicalImmunityAsResistance}` передаётся существующему packet adapter только для подтверждённой цели/атаки; suppression workflow хранит attack/target/child IDs и result в существующей карточке/operation receipt. Fixture дополняется `makeTargetCase(sourceId,{attackTotal=24,...conditions}={})` с этим input DTO. Decision T9 для commands T3 — exact `{kind:'target-effects',targetUuid,attackMessageId,targetVisible,canHear,hiddenFromTarget,materialTarget}`, где unknown boolean представлен null; здесь UUID/сообщение обязательны. Authoritative executor проверяет их связь с атакой, заполняет только unknown conditions и принимает materialTarget только от authenticated GM.

- [x] **1. RED:** `silencer ammo and thirty feet`, `improved silencer ten feet`, `perception DC uses actual attack total`, `material versus immaterial target`, `save and resistance apply once`:
  ```js
  assert.equal(buildWeaponModTargetDecision(makeTargetCase('glushitel',{attackTotal:24})).suppressionCheck.dc, 22);
  assert.equal(basicSilencer.radiusFeet, 30); assert.equal(improvedSilencer.radiusFeet, 10);
  assert.equal(buildWeaponModTargetDecision(makeTargetCase('razgonshchik-snaryadov',{materialTarget:false})).damageRule.ignoreNonmagicalResistance, false);
  assert.equal(buildWeaponModTargetDecision(makeTargetCase('uplotnitel-snaryadov',{materialTarget:false})).damageRule.treatNonmagicalImmunityAsResistance, true);
  ```
  Закрепить hearing/hidden/target-known null → decision, отсутствие выдуманного creature-type classifier, подходящие патроны, отмену perception prompt, успех/провал проверки, multi-target/associated roll и MIDI/native packet без повторного снятия resistance или полного раскрытия Token всем существам.
- [x] **2. Run:** `node --test tests/weapon-mod-target-effects.test.mjs`; FAIL.
- [x] **3. Implement:** after confirmed attack roll добавить проверку для конкретного слышащего наблюдателя; rounding половины следует общему правилу dnd5e. Решение о материальности запрашивает GM, если достоверного признака нет. При отсутствующем GM сохранить pending решение без применения спорного эффекта; повтор/отмена не создают новый выстрел, расход или проверку. Не заменять весь damage engine и не менять глобальные resistances цели.
- [x] **4. GREEN:** новый test + `node --test tests/curse-upgrade-damage.test.mjs tests/item-upgrade-absorption.test.mjs tests/combat-attack-service.test.mjs`.
- [x] **5. Commit gate R:** `feat: resolve suppression and ammunition resistance effects`.

### Task 10: T10. Полный набор индивидуальных чертежей

**Files:** Create `data/weapon-blueprints.json`, `assets/weapon-blueprints/<gearId>.png` для 38 baseline hosts и трёх явно подписанных family fallback; `tests/weapon-blueprints.test.mjs`. Modify catalog loader T1 для cached blueprint metadata, без изменения `Item.img` и авторских иконок.

**Interfaces:** `getWeaponBlueprint(gearId,family,manifest) -> {img,anchors,fallback}`; manifest `{version:1,entries:[{gearId,img,anchors:{[mountId]:{x,y}}}],fallbacks:{primitive,advanced,crossbow}}`. x/y — конечные числа 0…1 относительно изображения. Координаты рамок задаёт layout семейства T11, стрелки идут к anchors конкретного чертежа.

- [x] **1. RED:** `every known host has an individual blueprint`, `anchors match supported mounts`, `fallback is only for unknown host`: coverage всех текущих firearm/crossbow IDs; отсутствие файла/anchor, дубликаты gearId и одинаковые hashes известных изображений отклоняются. Не фиксировать 38 как вечный runtime максимум.
- [x] **2. Run:** `node --test tests/weapon-blueprints.test.mjs`; FAIL на отсутствующих assets/manifest.
- [x] **3. Implement:** прочитать ImageGen skill перед генерацией; создать по одному индивидуальному raster-чертежу на оружие в едином стиле, горизонтальный вид, светлые линии, прозрачный фон, без подписей/рамок/стрелок. Промпты учитывать существующую форму и особенности оружия, не переименовывать один силуэт 38 раз. Вести compact manifest выполнения по gearId и сохранять исходные tool outputs. Назначить anchors после визуальной проверки каждого изображения. Не требовать от модели генерации текста интерфейса и не выполнять Python-редактирование картинок.
- [x] **4. GREEN:** test + визуальная контактная таблица всех 38 изображений и проверка отличимости/ориентации. Автоматический hash не заменяет эту проверку. Manifest читается один раз; runtime не сканирует файловую систему ради каждого листа.
- [x] **5. Commit gate R:** `feat: add individual weapon blueprint artwork`.

### Task 11: T11. Чертёж и полный каталог в существующей вкладке МОДЫ

**Files:** Create `scripts/integrations/weapon-mod-panel.js`, `tests/weapon-mod-panel.test.mjs`; Modify `scripts/integrations/item-upgrade-sheet.js`, `scripts/integrations/dnd5e-sheet-extensions.js`, `templates/item-mods-tab.hbs`, `styles/main.css`, `lang/ru.json`; Test `tests/item-upgrade-service.test.mjs`, `tests/item-sheet-branding.test.mjs`, `tests/module-manifest.test.mjs`.

**Interfaces:** `buildWeaponModCatalogView({catalog,host,installed,inventory,kind,mountId=null,isOwner}) -> Entry[]`, где Entry `{sourceId,name,img,ownedQuantity,instances,available,reason,availabilityRank}`; availabilityRank0=owned/available, 1=owned/blocked, 2=missing. Авторский rank предмета не переписывается. `renderWeaponModPanel(root,host,projection,blueprint)` и `bindWeaponModPanel(root,app,moduleApi)` подключаются из текущего render/bind owner. Delegated handlers не множатся при повторном render; async sequence guard подавляет устаревшие projection ответы.

- [x] **1. RED:** `catalogue owned first but never grants missing item`, `different source instances remain selectable`, `mount links show one physical child`, `mods order preserves old panel`, `stale render does not restore old slots`:
  ```js
  assert.deepEqual(view.map(row=>row.availabilityRank), [0,1,2]);
  assert.equal(view.find(row=>row.ownedQuantity===0).available, false);
  assert.equal(missingChoiceCreateCalls, 0); assert.equal(dragAndClickOwnerMethod, 'installWeaponAttachment');
  ```
  Проверить все13/12 строки в соответствующих меню, disabled reasons, quantity, legacy removal-only UI, права просмотра, held/busy компоненты, two-bottom selection, отмену выбора экземпляра и формы пересборки, неизменённые старые capacity/slots/settings.
- [x] **2. Run:** `node --test tests/weapon-mod-panel.test.mjs`; FAIL.
- [x] **3. Implement:** фон/оружие/стрелки/слоты отдельными слоями; нормализованные SVG lines, HTML buttons с labels, keyboard focus и текстовыми причинами. ПКМ и ЛКМ пустого слота открывают один каталог; ЛКМ занятого открывает Item, ПКМ предлагает снять/доступную activity. Модернизация показывает плату 500 зм и сразу вызывает paid install T5; при достигнутом лимите предлагает одну снимаемую часть. GM-согласование только для особого оружия; календарных форм/проектов нет. Вторая рамка all-модуля содержит ссылочный маркер, не вторую самостоятельную карточку. Установленные children скрыть existing inventory filter одним общим предикатом, сохранив legacy exports.
- [x] **4. GREEN:** `node --test tests/weapon-mod-panel.test.mjs tests/item-upgrade-service.test.mjs tests/item-sheet-branding.test.mjs tests/module-manifest.test.mjs`. Проверен изолированный DOM render480/820 для каждой topology; live Foundry world недоступен (порт30000 не слушает, T12 фиксирует ограничение). drag/drop, ПКМ, ЛКМ и resize не перекрывают слоты и прежние усовершенствования.
- [x] **5. Commit gate R:** `feat: add blueprint attachment controls to item mods`.

### Task 12: T12. Проверка полного цикла, документация и итоговое ревью

**Files:** Modify `README.md`, `docs/weapon-mods-function-passport.md`, `docs/function-passport.md`; при обнаруженных дефектах менять только затронутые владельцы/их focused tests. Создать `docs/weapon-mods-verification.md` с runtime версиями, проверенными сценариями и оставшимися реальными ограничениями.

**Interfaces:** Пользовательский API T3/T5, граф T2, эффекты T6–T9, assets T10 и UI T11; отдельного runtime API для QA не добавлять.

- [x] **1. Verify contract coverage:** сопоставить каждое требование spec§1–9 с тестом/проверенным live сценарием. В отчёте явно перечислить все25 profile IDs и 38 blueprint IDs; у каждого — подтверждённая механика или точное условие запроса решения GM. Не объявлять description-only карточку автоматизацией. Матрица: `docs/weapon-mods-verification.md`.
- [ ] **2. Live Foundry:** прочитать профильные existing/live-UI references Foundry skill, определить фактический build и dnd5e, открыть существующий доступный Foundry world через Browser/поддержанный bridge. Проверить OWNER player и active/inactive GM, три topology, обычные enhancements, split3→2+1, два mount одного child, штык/свет/гранаты, aim/conditions, глушители/resistance, немедленную пересборку за500 зм, отказ499 зм, замену при лимите, модернизацию нового полученного оружия через тот же платный обработчик, transfer/Storage/reload, pending approval при потере GM без календарных проектов. Использовать отдельные собственные QA Actors; записать их IDs и удалить только созданные для проверки объекты.
- [x] **3. Fix and recheck:** для каждого реального дефекта сначала regression RED, затем минимальное исправление и focused GREEN. Не обходить тесты удалением цены, authored formulas, количества, эффекта или recovery. Если live Foundry недоступен, сохранить исходники/автоматические результаты и сообщить конкретное ограничение; не отмечать live QA выполненным. Native port30000 не слушает, Browser ERR_CONNECTION_REFUSED, bridge отсутствует; пункт2 остаётся непроверенным. Runtime/source/isolated DOM результаты сохранены, настоящие QA world documents не создавались.
- [x] **4. Documentation and final checks:** README описывает действия, типы креплений, owned-first/серые записи, отдельный лимит, стоимость и длительность, approval и API. Паспорт описывает текущее состояние и профильные tests. Выполнить раздел13; запросить независимое correctness review по `superpowers:requesting-code-review`, проверить замечания и повторить затронутые проверки после исправлений. Gemini contribution оставить компактной и проверенной. Review:0 Critical/7 Important, все исправлены одним проходом; final full4767 pass/0 fail/1 skip, focused226/226,1003 JS/MJS и58 JSON valid.
- [x] **5. Final commit gate:** если затронут runtime — R с новым patch; для docs-only — diff/ссылки без bump. `docs: document and verify weapon mod workflows`. Push, проверить clean `lich_branch` и `HEAD...origin/lich_branch = 0 0`. Итоговый отчёт: spec/plan, commits, реальные passed/failed, live evidence и ограничения; не переносить незавершённую задачу в новый чат. Runtime `4bc7eb1d`, v389 отправлен; full/static/focused evidence сохранены. Task12 завершена с предусмотренным планом явным ограничением: live-сценарии пункта2 не выполнены и не отмечены выполненными. Последующее уточнение отчёта — docs-only.

## 13. Общие проверки перед runtime commit

```powershell
node --test tests/*.test.mjs
git diff --check
$taskJsFiles = git ls-files '*.js' '*.mjs'
foreach ($taskFile in $taskJsFiles) { node --check $taskFile; if ($LASTEXITCODE -ne 0) { throw "Syntax: $taskFile" } }
$taskJsonFiles = git ls-files '*.json'
foreach ($taskFile in $taskJsonFiles) { Get-Content -Raw -Encoding UTF8 $taskFile | ConvertFrom-Json | Out-Null }
git diff --stat
git diff
```

Для ещё не tracked новых JS/MJS/JSON выполнить те же проверки явно до добавления; `git ls-files` их не включает. До commit сверить и staged diff: `git diff --cached --check`, `git diff --cached --stat`, `git diff --cached`. Сохранять только passed/failed и реальные ошибки, не полный успешный log. Полные проверки выполняются один раз на конкретный подготовленный runtime commit; новые изменения после него требуют затронутых перепроверок и свежей итоговой проверки перед следующим commit.

## 14. Самопроверка плана и handoff

| Требования спецификации | Задачи |
| --- | --- |
| Результат/чертёж/порядок панели/каталог | T1,T10,T11,T12 |
| Крепления/совместимость/duplicates/физические экземпляры | T1,T2,T3 |
| Действия/одна платная пересборка/создание/снятие/согласование | T3,T4,T5,T8 |
| Все исходные25 механик, условия и current source projection | T1,T4,T6,T7,T8,T9 |
| Сохранность, value, quantity, charges, ammo, receipts и recovery | T2,T3,T4,T5,T6 |
| Индивидуальные38 assets, scoped hooks, cache/version/docs/live QA | T10,T11,T12, gate R |

План готовится к пользовательскому review. Рекомендуемый способ — **Native:** Codex ведёт исследования, черновики, проверки и реализацию в этой сессии; один независимый review всей ветки перед завершением. Причина: задачи тесно связаны схемой links, транзакциями, журналами и общими adapters; многократная передача этих интерфейсов увеличивает стоимость и риск рассогласования. Альтернатива — **Subagent-driven:** отдельный implementer и reviewer каждой задачи, затем whole-branch review; дороже по контексту, с независимой проверкой каждого этапа. В обоих случаях применять глобальные правила AGENTS.md и не менять product code до утверждения плана и выбора исполнения.
