# Equipment Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать правило размеров оружия/снаряжения [Lich] и предложение изменить удерживаемое оружие при изменении размера существа.

**Architecture:** Один чистый domain-модуль считает размеры, кости, множители и допустимость оружия. Один application owner сохраняет индивидуальный профиль Item и координирует предложение; существующие sheets, combat hooks, ReactionQueueService, цена и transfer paths вызывают этих владельцев. Переход размера не меняет вещи без согласия и не расходует боевые ресурсы.

**Tech Stack:** JavaScript ESM, Foundry VTT 13, установленная dnd5e 5.2.5, существующие Node tests и native Foundry UI; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-17-equipment-size-design.md`.

## Global Constraints

- Изменения только в lich_branch.
- Runtime-изменения потребуют версии 1.4.393 и синхронного versioned forwarder.
- Новых зависимостей нет.
- Размер не связан с размером объекта для прочности и не изменяет его HP.
- Нестандартные формулы всегда можно сохранить.
- Количество не меняется.
- UI не пишет world settings и не выполняет привилегированные мутации.
- Изменение размера Actor не меняет автоматически размер его вещей, их цену или вес.
- Все новые/изменённые методы описываются в профильном паспорте в том же commit; существующие публичные контракты не удаляются.
- Один итоговый runtime commit после полной проверки Task 6; промежуточные задачи заканчиваются проверенным checkpoint без commit, чтобы полная проверка всего runtime выполнялась один раз перед commit.

## Review Focus

1. Native форма присылает неизменённые поля вместе с размером: наличие поля не означает его ручное изменение; отличать значения от фактического исходного Item (Task 2).
2. Versatile/обвесы/улучшения проецируют базовый урон: исходный профиль размера должен учитывать их существующие baselines, не принимать проекцию за новую авторскую формулу (Tasks 2–3).
3. Каталожный Item и экземпляр имеют один source ID, но разные размеры/авторские значения: продажи, возврат из storage и managed sync сохраняют цену и профиль экземпляра (Task 3).
4. Rune Knight обновляет Actor и Token отдельными awaited операциями: один переход даёт один prompt даже при разнесённых событиях, а не только при событиях в одной microtask (Task 5).
5. Пока диалог открыт, оружие/размер/права/Token меняются: старое согласие не записывает данные; следующий настоящий переход снова предлагает изменение, в том числе после отказа (Task 5).

## Карта файлов и данных

Создать `scripts/data/equipment-size-rules.js`, `scripts/application/equipment-size-service.js`, `scripts/integrations/equipment-size.js` и focused-тесты первых двух владельцев. Поле native sheets добавить в существующий `scripts/integrations/dnd5e-sheet-extensions.js`; lifecycle — только в `scripts/main.js` и существующем `scripts/combat/hooks.js`.

Сохранённый `flags.rebreya-main.equipmentSize` — объект `{version:1,size,reference}`. `size` принимает только tiny/sm/med/lg/huge/grg; отсутствие flag эквивалентно med. `reference` содержит категорию исходного профиля, полные native base/versatile damage parts, собственный weight с units и price с denomination. Преобразования хранят авторские слагаемые и восстанавливают исходный профиль без накопленного округления.

Не помещать произвольный reference в недоверенный transport DTO. Для composition, где размер действительно нужно передать отдельно, добавить descriptor v4 с прежними host-полями, обязательными `equipmentSize` (валидная категория) и `weaponMods` (прежняя нормализованная структура, в том числе пустая). Читатели v2/v3 и legacy conversion сохраняют прежние shape/semantics и означают Medium. Физические snapshots сохраняют полный Item flag. Не переводить несвязанные средние descriptors в v4 массово.

### Task 1: Правила размеров и точная шкала

**Files:** Create `scripts/data/equipment-size-rules.js`, `tests/equipment-size-rules.test.mjs`; document in `docs/function-passport.md` с новым профильным `docs/equipment-size-function-passport.md`.

**Interfaces:**
- `getEquipmentSize(itemOrData) -> SizeId`.
- `shiftEquipmentDamage(formula, steps) -> {formula,supported}`; неподдерживаемая строка возвращается дословно.
- `inferEquipmentSize(referenceFormula, referenceSize, nextFormula) -> SizeId|null`.
- `getEquipmentSizeMultipliers(fromSize,toSize) -> {price,weight}`.
- `getWeaponSizeUse(actor,item) -> {improvised:boolean,reason:string|null}`; исключение Small/Medium проверяет native heavy property.

- [ ] **Step 1: Написать failing-тесты с исходной таблицей 8×6.** Проверить все 48 конкретных значений; отдельно `2d12 + 1 step = 4d6`, `4d12 + 1 = 8d6`, `1d2 - 2 = 0` как отсутствие base damage. Проверить `1d8+3 -> 1d10+3`, literal `1`, unsupported `1d8+1d4+@mod`, обратный вывод размера длинного меча и копья, отсутствие изменения при неоднозначности.
- [ ] **Step 2: Запустить `node --test tests/equipment-size-rules.test.mjs`, подтвердить FAIL именно из-за отсутствующей реализации.**
- [ ] **Step 3: Реализовать указанные функции, шесть категорий и продолжение количества костей удвоением после блока d6/d8/d10/d12.** Множители вычислять от разницы индексов; не округлять исходный профиль. Неверные category/числовые данные не превращать в бесконечные значения.
- [ ] **Step 4: Дополнить и запустить тесты всех 36 пар actor/weapon sizes, обоих heavy-вариантов Small/Medium, неизвестного actor size и неизменности входов.** Для med→grg ожидать price=3.375, weight=8; med→sm price=1/1.5, weight=0.5. Ожидать PASS.
- [ ] **Step 5: Записать владельца, сигнатуры и тесты в паспорт.** Сохранить проверенный checkpoint для итогового runtime commit; не публиковать подключённый runtime под старой версией.

### Task 2: Атомарный пересчёт Item и поле «Подробнее»

**Files:** Create `scripts/application/equipment-size-service.js`, `scripts/integrations/equipment-size.js`, `tests/equipment-size-service.test.mjs`; modify `scripts/main.js`, `scripts/integrations/dnd5e-sheet-extensions.js`, `scripts/data/gear-compendium.js`, `module.json`; rename forwarder to `scripts/main-1.4.393.js`; tests `tests/dnd5e-sheet-downtime-tab.test.mjs`, `tests/gear-compendium.test.mjs`, `tests/held-items.test.mjs`, `tests/main-composition-root.test.mjs`.

**Interfaces:**
- `buildEquipmentSizeUpdate(item,{size,changes={},source="size"}) -> {update,diagnostics}` exported from the integration adapter; работает синхронно, без fetch и мутаций документов.
- `EquipmentSizeService(moduleApi,options={})` с `initialize()`, `preUpdateItem(item,changes,options={})`, `setItemSize(item,size)`; последний выполняет одну допустимую Item mutation через канонический patch.
- `registerEquipmentSizeItemHooks(moduleApi,{Hooks=globalThis.Hooks}={}) -> boolean`; идемпотентно подключает Item hooks один раз из composition root.
- `upsertEquipmentSizeField(root,app,moduleApi)` в существующем sheet integration; native select с шестью русскими подписями и read-only состоянием при отсутствии прав.

- [ ] **Step 1: Написать failing-тесты атомарного Item patch и DOM.** Medium longsword 1d8/versatile 1d10, weight 3 lb, price 15 gp при выборе lg получает 1d10/1d12, 6 lb, 22.5 gp; обратный переход точно восстанавливает все значения. Plates 1500 gp/65 lb при grg получают 5062.5 gp/520 lb. Поле добавляется один раз и отсутствует на spell/currency/natural weapon; unsupported formulas не блокируют update.
- [ ] **Step 2: Запустить новые и указанные existing focused-тесты, зафиксировать ожидаемые FAIL новых сценариев.** Не заменять прежние assertions более слабыми.
- [ ] **Step 3: Реализовать reference capture, отличение реального редактирования от неизменённых полей native submit, bidirectional inference и явный одновременный size+damage override.** Существующие flat/nested updates, custom damage parts, denomination, units, flags и quantity сохраняются. Сложная новая формула становится reference в текущем размере; вторичных Item.update в preUpdate hook нет. Учесть `versatileBaseDamageOriginal` и прежние projection baselines, не удваивая их.
- [ ] **Step 4: Подключить select, service и Item hooks; поднять manifest/forwarder до 1.4.393 и синхронизировать canonical ESM queries всех importers изменённых owners.** Catalog defaults остаются Medium; существующий instance reference не заменяется каталогом. Использовать поддерживаемые поля установленной dnd5e 5.2.5, проверенные в её локальном source.
- [ ] **Step 5: Запустить `node --test tests/equipment-size-rules.test.mjs tests/equipment-size-service.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/gear-compendium.test.mjs tests/held-items.test.mjs tests/main-composition-root.test.mjs`.** Добавить assertions для ручного damage→size, одновременных изменений, повторного update, изменения только quantity/price, отсутствия прав и loaded legacy Item без переписывания. Ожидать PASS; обновить паспорт и сохранить checkpoint.

### Task 3: Стоимость, состав, stack identity и переносы

**Files:** Modify `scripts/data/item-value.js`, `scripts/data/lootgen-catalog-reader.js`, `scripts/data/lootgen-composition.js`, `scripts/data/lootgen-item-descriptor.js`, `scripts/data/lootgen-prepared-item.js`, `scripts/data/inventory-ingress-descriptor.js`, `scripts/application/inventory-ingress-planner.js`, `scripts/data/storage-row-stacking.js`, `scripts/data/storage-container-snapshot.js`, `scripts/data/storage-container-item-service.js`, `scripts/data/item-upgrade-service.js`; narrow integration edits in `scripts/data/inventory-service.js` only at its existing item identity/value/materialization paths. Create `tests/equipment-size-transfers.test.mjs`; existing tests: `tests/item-value.test.mjs`, `tests/lootgen-catalog-reader.test.mjs`, `tests/lootgen-item-descriptor.test.mjs`, `tests/inventory-ingress-descriptor.test.mjs`, `tests/inventory-ingress-planner.test.mjs`, `tests/storage-container-snapshot.test.mjs`, `tests/storage-container-item-service.test.mjs`, `tests/item-upgrade-service.test.mjs`.

**Interfaces:** Existing `normalizeLootgenFlatItemDescriptor(raw,options)`, `normalizeLootgenComposition(raw)`, `normalizeLootgenItemDescriptor(raw,options)`, `getLootgenAggregationKey(raw)`, `evaluateItemValue(descriptor,catalogReader)`, `createLootgenCatalogReader(options)`, `buildInventoryIngressDescriptor(itemData,options)` and `storageRowsCanStack(left,right)` retain signatures. Extend their contracts only for validated v4 size; full reference remains in trusted physical Item data.

- [ ] **Step 1: Добавить failing-тесты v4 roundtrip, strict shape/category validation и v2/v3 backward compatibility.** Medium и Large одного source ID не агрегируются; одинаковые compatible sizes сохраняют прежние quantity rules. Legacy missing size совпадает с explicit Medium.
- [ ] **Step 2: Запустить перечисленные focused-тесты, подтвердить FAIL новых сценариев.**
- [ ] **Step 3: Реализовать v4 и authoritative оценку собственного host base value с множителем размера ровно один раз.** На v2/v3 результат полностью прежний. Installed upgrades/weapon mods/container contents считаются прежними владельцами без повторного множителя оболочки. На минимальной денежной единице использовать прежнее округление и overflow validation. Примеры: база 150000 cp ×3.375 =506250 cp; добавленное улучшение 10000 cp даёт total 516250 cp, не 540000 cp. Нельзя принимать присланную клиентом произвольную цену/reference вместо authoritative source.
- [ ] **Step 4: Сохранить size/reference во всех materialization/snapshot/ingress/rebuild путях и добавить категорию в существующую stack identity.** Нельзя сбрасывать пользовательский урон или применять scale второй раз при восстановлении. Раскрывать большой `inventory-service.js` только через relevant rg и диапазоны; новых inventory owners нет.
- [ ] **Step 5: Запустить перечисленные focused-тесты плюс `tests/lootgen-generator.test.mjs` и `tests/lootgen-generated-state.test.mjs`.** Assertions: передача sized weapon, storage drop/claim, reload snapshot, existing custom instance price, upgrades/rebuild и contents preservation, forged size/source mismatch, unchanged budget spending/quantity/unknown-price handling. Ожидать PASS; обновить профильные паспорта и сохранить checkpoint.

### Task 4: Импровизированная атака при несовпадении размеров

**Files:** Modify `scripts/combat/attack-service.js`; tests `tests/combat-attack-service.test.mjs`, `tests/equipment-size-rules.test.mjs`; document in equipment-size passport and combat section.

**Interfaces:** Existing native `applyDnd5eAttackRollConfig(config,dialog,message)` and `applyDnd5eDamageRollConfig(config,dialog,message)` retain signatures. Existing MIDI attack path calls the same `getWeaponSizeUse(actor,item)` and transient attack projection. No persistent `system.type`, damage, property or proficiency mutation.

- [ ] **Step 1: Добавить failing-тесты Medium actor/Large sword: атака разрешена, base 1d4, нет владения от исходного sword; Small/Medium non-heavy обычное, Small/Medium heavy импровизированное.** Tavern Brawler native `actor.getFlag("dnd5e","tavernBrawlerFeat")` сохраняет специальное владение. Проверить ровно этот контракт по установленному dnd5e source.
- [ ] **Step 2: Запустить `node --test tests/combat-attack-service.test.mjs tests/equipment-size-rules.test.mjs`, подтвердить FAIL новых сценариев.**
- [ ] **Step 3: Применить transient improvised projection в существующих native/MIDI attack и damage contexts.** Подменяется только primary base damage и разрешение proficiency; общие modifiers/upgrades/critical rules остаются действующими, соответствующая строка чата объясняет импровизированное применение. Отдельная долгоживущая копия Item или новый attack owner не создаётся.
- [ ] **Step 4: Запустить те же focused-тесты с native/MIDI parity, сменой владельца, отменой атаки и повторным обычным применением.** Assert исходный Item глубоко не изменился, actor размер не менялся, ammo/resources расходуются прежним путём и ровно один раз. Ожидать PASS; обновить паспорт и сохранить checkpoint.

### Task 5: Предложение изменить оружие после изменения размера существа

**Files:** Extend `scripts/application/equipment-size-service.js`, `scripts/combat/hooks.js`, `scripts/main.js`; use existing `scripts/combat/reaction-queue-service.js`, `scripts/integrations/held-items.js`, `scripts/infrastructure/foundry/active-gm.js`. Tests: create `tests/equipment-size-prompts.test.mjs`; extend `tests/rune-knight-automation-service.test.mjs`, `tests/main-composition-root.test.mjs`, appropriate hook assertions in existing combat coverage. Изменять Rune Knight growth/revert только если тест обнаружит реальную необходимость, без нового специфического prompt в классовом service.

**Interfaces:** Extend `EquipmentSizeService` with `captureActorSize(actor)`, `captureTokenSize(token)`, `observeActorSize(actor,{userId=""}={})`, `observeTokenSize(token,{userId=""}={})` and `resizeHeldWeapons({actorUuid,tokenUuid,transitionId,targetSize,weaponIds,recipientUserId}) -> {changed,skipped,reason}`. `initialize()` seeds observed state and enables prompts after startup. Inject `promptDecision(args)` from the existing ReactionQueueService; inject game/UUID/document operations for meaningful unit tests.

- [ ] **Step 1: Написать failing-тесты event sequences.** Rune Knight Actor med→lg, затем отдельный awaited Token 1×1→2×2, плюс ActiveEffect notifications дают ровно один prompt. Revert даёт второй. Manual footprint даёт предложение; 2×2→1×1 показывает выбор из шести категорий, если эффективная категория не разрешает неоднозначность. Texture scale/startup/reload/same-size updates дают ноль prompts.
- [ ] **Step 2: Добавить failing-тесты получателя и held filter.** Active assigned owner получает prompt даже если превращение запустил GM; при offline owner — только active GM; несколько owners/GM выбирают одного; нет GM — допустим локальный owner. Двуручный weapon один раз, два held weapons оба, backpack/equipped-only/natural исключены. Unlinked Token не меняет base Actor или другого Token.
- [ ] **Step 3: Запустить `node --test tests/equipment-size-prompts.test.mjs tests/rune-knight-automation-service.test.mjs tests/main-composition-root.test.mjs`, подтвердить FAIL новых сценариев.**
- [ ] **Step 4: Подключить before/after наблюдение в существующие Actor/Token/ActiveEffect hook owners.** Хранить только bounded runtime transition state по реальному Actor/Token UUID; дедупликация должна объединять разнесённые Actor/Token события одной целевой категории, а не только события одного tick. Нет world lock, startup replay и скрытого изменения категории Actor от footprint.
- [ ] **Step 5: Реализовать один promptDecision с явным forUserId и AbortSignal на переход.** Копия: «Размер {имя} изменился. Изменить размер оружия в руках на {размер}?», кнопки «Изменить оружие» / «Оставить как есть»; при неоднозначном footprint добавить selector. UI только возвращает решение. Application coordinator заново проверяет актуальный переход, ownership, Items и held slots и вызывает `actor.updateEmbeddedDocuments("Item",updates)` один раз, используя Task 2 patch. Отказ/закрытие/timeout не меняют данные и не тратят ресурс.
- [ ] **Step 6: Дополнить и запустить focused-тесты stale/race cases.** Pending lg prompt заменён med transition; старый accept не пишет. Оружие убрано/передано/удалено, Token удалён, recipient потерял ownership — безопасный no-op. Повтор ответа не делает вторую запись; после отказа следующий реальный переход снова вызывает prompt. В согласованном grow/revert тесте кости, вес и цена следуют Item rules и восстанавливаются без drift. Ожидать PASS; обновить паспорт и сохранить checkpoint.

### Task 6: Документация, live QA и завершение

**Files:** Update `README.md`, `docs/function-passport.md`, `docs/equipment-size-function-passport.md`, профильные economy/upgrade passports; verify `module.json`, `scripts/main-1.4.393.js` and changed-owner import URLs.

**Interfaces:** Существующие public API/settings/socket routes остаются доступны; README документирует новое поле, правила свободного редактирования, цены и предложение при росте/уменьшении. Документы описывают текущее реализованное состояние.

- [ ] **Step 1: Проверить spec coverage и добавить недостающие regression assertions до исправления обнаруженных gaps.** Нельзя удалять authored formulas, quantity rules, settings, upgrades или budget spending для упрощения passing tests.
- [ ] **Step 2: Выполнить один полный runtime check перед финальным commit:** `node --test tests/*.test.mjs`; `git diff --check`; `node --check` для всех tracked JS/MJS; parsing всех tracked JSON через `ConvertFrom-Json`. Сохранить passed/failed counts и реальные ошибки без полного успешного лога. После новых правок повторять затронутые проверки.
- [ ] **Step 3: Выполнить live Foundry QA через существующий bridge/browser согласно Foundry skill.** Зафиксировать runtime Foundry build и dnd5e version; проверить «Подробнее», long sword size↔dice, unsupported custom formula save, plates grg price/weight, одну trade/storage передачу, обычную/импровизированную атаку, Rune Knight grow/revert accept и decline. Два разных клиента GM/player нужны для утверждения о remote routing; без них честно отметить ограничение. Не расходовать чужие игровые ресурсы и не менять реальные персонажи ради QA: использовать существующий безопасный test fixture или временный собственный test Actor с последующей очисткой.
- [ ] **Step 4: Провести независимое ревью итогового diff с акцентом на подтверждённую спецификацию, security boundaries, stale prompts, formulas и бюджеты.** Для lightweight review использовать Gemini 3.8 Flash High с узким контекстом; Codex проверяет значимые выводы по исходникам. Ошибки исправить и повторить affected checks.
- [ ] **Step 5: Проверить `git diff --check`, `git diff --stat` и содержательный diff; добавить только файлы задачи, сделать осмысленный commit, `git push -u origin lich_branch`.** Force push запрещён. Финальный отчёт: реальное реализованное поведение, spec/plan paths, checks counts, live limitations и commit.

## Исполнение и статус

План ещё не одобрен и не исполнялся. Рекомендуется Native: Codex выполняет последовательные изменения общих Item/value/hook контрактов в этой сессии; Gemini получает узкие read-only задачи и независимое ревью. Альтернатива — Subagent-driven с отдельным implementer/reviewer на задачу, если пользователь явно выберет её. До финального ревью пользователем продуктовый код и тесты не меняются.
