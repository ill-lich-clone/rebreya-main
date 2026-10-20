# Grouped Combat Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Codex implements in this chat; Gemini 3.8 Flash High supplies scoped analysis and the final independent review under AGENTS.md.

**Goal:** Добавить world-макрос «Начать сражение», штатное отображение групп dnd5e, настоящий общий ход и отдельные эффекты начала/конца каждого существа.

**Architecture:** Native Combatant каждого существа сохраняется. Application owner планирует логические фазы группы и выполняет их последовательно на active GM с persistent receipts. Узкие adapters подключают штатные эффекты, Rebreya automation, lifecycle и трекер; обычные бои проходят прежний маршрут.

**Tech Stack:** Foundry VTT 13.351, dnd5e 5.2.5, native ESM JavaScript, Node test runner; установленные DAE 13.0.27, Times Up 13.1.9, MIDI-QOL 13.0.61 и Effect Macro 13.0.4. Новые runtime-зависимости не добавляются.

**Spec:** [Утверждённая 2026-10-21 спецификация](../specs/2026-10-20-grouped-combat-start-design.md). При исполнении читать и spec, и этот план.

## Global Constraints

- Только `lich_branch`; перед правками status/branch/fetch и сравнение с `origin/main` и `origin/lich_branch`. Чужой dirty state/опережение remote ветки — остановка по AGENTS.md.
- «У всех участников группы начало хода наступает при входе в группу, конец — при выходе». Свёрнутый UI и массовый forward-jump этого требования не заменяют.
- «Авторские формулы, модификаторы, advantage/disadvantage, выбранный штатный режим видимости броска и правила сообщений сохраняются».
- Сохраняются Actor, Combatant, HP, origin/duration effects, самостоятельные ресурсы и существующие настройки. Нет прямого дополнительного HP-тика затихающего урона.
- «На клиентах нет самостоятельной привилегированной записи world-state». Typed command повторно валидирует authority и live документы на active GM.
- «Приватные `#triggerTurnEvents` не изменяются». Для flagged Combat используется protected `_manageTurnEvents`; сторонние исходники не редактируются.
- `scripts/main.js` — единственный composition root; макрос вызывает `game.rebreyaMain.startCombatFromSelection()`, доступный также через module API.
- Первый runtime-пакет повышает версию с `1.4.396` до `1.4.397`; forwarder содержит только `import "./main.js";`. Если перед исполнением версия уже изменена другой работой, сначала согласовать базу по Git-процессу, затем выбрать следующий patch, а не понизить её.
- Каждый изменённый/новый метод заносится в соответствующий раздел паспорта в итоговом runtime commit. Проверки существующих contracts не ослабляются ради зелёных тестов.
- Каждый task выполняется red → green на focused suite. Единственный итоговый runtime commit/push следует после полной проверки в Task 8; ранние промежуточные task не публикуют непроверенный workflow.

## Review Focus

1. Удаление представителя/Actor или изменение эффекта в открытом save: уже выполненные шаги сохраняются, устаревшая цель не получает чужой эффект — Task 4.
2. Два linked-токена одного Actor: они остаются отдельными ходами; receipt по Actor UUID не должен поглотить отдельный Combatant — Tasks 1 и 4.
3. Ненулевой `CONFIG.time.turnTime`: переход группы не умножает время на число технических участников; roundTime и seconds-based эффекты сохраняются — Task 6.
4. Приватный ActivityOverTime владельца и fixed initiative score: сохраняются выбранный исполнитель/видимость броска и штатные настройки, включая offline owner — Tasks 2 и 5.
5. Закрытие save/dialog или reload между workflow и receipt: неопределённый шаг не считается успешно завершённым и не повторяется автоматически — Tasks 2 и 4.

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `scripts/combat/turn-group-rules.js` (new) | Pure groups, логические позиции, фазы, receipt keys, активное множество Combatant |
| `scripts/integrations/grouped-combat-effects.js` (new) | Capability preflight, provider phase steps и подавление только дублирующих native callbacks |
| `scripts/infrastructure/foundry/grouped-combat-repository.js` (new) | Foundry Document boundary Combat/Combatant/flags и native position writes |
| `scripts/application/grouped-combat-service.js` (new) | Start, membership, serialization, transitions, фазовые receipts/recovery |
| `scripts/infrastructure/foundry/grouped-combat-command-contract.js` (new) | Exact bounded wire-shapes start/transition/resolve commands |
| `scripts/integrations/grouped-combat-runtime.js` (new) | Штатные lifecycle/Next/Previous, native grouping display и локальная камера |
| `scripts/combat/hooks.js`, `scripts/integrations/effectmacro-compat.js` | Сохранение обычных hooks и единый маршрут managed phases |
| Существующие combat owners из Task 3 | Per-member обработка без подмены `game.combat` |
| `scripts/main.js`, `scripts/combat/grapple-macro-service.js` | Composition, публичный ingress и один новый managed макрос |
| `scripts/constants.js`, `scripts/settings.js`, `lang/ru.json` | Client-настройка и русские названия/ошибки |
| `tests/grouped-combat-*.test.mjs`, `tests/helpers/installed-combat-providers.mjs` (new) | Правила, реальные provider contracts, application, runtime и command security |
| `README.md`, `docs/function-passport.md`, manifest/forwarder | API, владельцы поведения и release/cache contract |

## Общие формы данных

Это module-owned detached data, не поддельные Foundry Documents:

- `Member = { combatantId, tokenUuid, actorUuid, baseActorId, disposition, initiative, initiativeKey, groupable, defeated }`; `initiative` — finite number либо null; непроверенный `initiativeKey` — null, такой member не группируется.
- `Group = { id, memberIds, initiative }`; ID стабилен при сохранении группы, memberIds — Combatant IDs в стабильном порядке. Существующие разные численные initiative образуют разные группы.
- `Position = { round, groupId }`; `Phase = { kind, round, groupId, memberIds }`, kind — `initiative|combat-start|combat-end|round-start|round-end|turn-start|turn-end|each-turn`.
- `State = { version:1, mode, activateAtRound, revision, groups, current, receipts }`; mode — `pending|active|blocked`. `receipts[stepKey] = { status, operationId }`, status — `running|done|uncertain`. До запуска внешнего workflow записывается running, после подтверждения — done; оставшийся после reload running становится uncertain.
- `EffectStep = { key, provider, combatantId, effectUuid, run }`; `run():Promise<{status:"completed"|"cancelled"}>` существует только в памяти. Receipt key включает Combat ID, round, стабильный group ID, Combatant ID, phase, provider и effect UUID/step ID. Functions/Document references в flags не записываются.
- Result ingress: `{ ok:true, combatId, revision }` либо `{ ok:false, code, details }`. Русское UI-сообщение строится на клиенте из code; отказ не маскируется успешным уведомлением.

### Task 1: Зафиксировать группы и фазовый календарь

**Files:** Create `scripts/combat/turn-group-rules.js`, `tests/grouped-combat-rules.test.mjs`; Modify `module.json`, versioned forwarder и только version expectations в `tests/main-composition-root.test.mjs`.

**Interfaces:** Produce `buildCombatTurnGroups(members, previousGroups=[]) -> Group[]`, `planGroupTransition(state, target, groups) -> Phase[]`, `buildPhaseStepKey(combatId, phase, combatantId, provider, stepId) -> string`, `getActiveGroupMemberIds(state) -> string[]`, `isCombatActorActive(combat,actorOrToken,state) -> boolean` с native individual fallback. Helpers не требуют реальных экземпляров Foundry и тестируются detached fixtures.

- [ ] **1. Написать red tests.** Один baseActor/side/profile + unlinked → одна группа; другой Actor/side/profile, linked, null key и разные ранее установленные initiative → отдельные группы. HP/name не меняют identity. Пример требований:

  ```js
  assert.deepEqual(groups.map(g => g.memberIds), [["a", "b", "c"], ["pc"]]);
  assert.deepEqual(phases.map(p => p.kind), ["turn-end", "each-turn", "turn-start"]);
  assert.notEqual(keyFor("linked-1"), keyFor("linked-2"));
  ```

  `each-turn` содержит всех подходящих участников боя, а per-member start/end — участников соответствующей группы. На границе раунда ожидается end → round-end → round-start → each-turn → start. Backward не создаёт effect phases; forward jump перечисляет реально пересечённые группы.
- [ ] **2. Запустить** `node --test tests/grouped-combat-rules.test.mjs`; увидеть failure новых exports/утверждений, а не синтаксическую ошибку теста.
- [ ] **3. Реализовать pure helpers** с разделением по identity и установленной initiative, стабильными IDs и без `game`, sockets, settings или document writes. Добавить version `1.4.397`, новый тонкий forwarder и путь esmodules; сохранить остальные cache-graph assertions existing test.
- [ ] **4. Повторить focused suite**: все проверки Task 1 PASS. Зафиксировать команды/число passed/failed в execution log плана; product runtime пока не подключать.

### Task 2: Доказать фазовую обработку установленных DAE/Times Up/MIDI/Effect Macro

**Files:** Create `scripts/integrations/grouped-combat-effects.js`, `tests/grouped-combat-provider-contracts.test.mjs`, `tests/helpers/installed-combat-providers.mjs`; Modify `scripts/integrations/effectmacro-compat.js`.

**Interfaces:** Consume `Phase`, `buildPhaseStepKey`. Produce `inspectGroupedCombatSupport({game,Hooks}) -> {supported,issues,providers}`, `createGroupedCombatEffects(dependencies) -> { plan(combat,phase):EffectStep[], installNativeGuards():void }`. `describeInitiative(actor) -> {key,canShare}` входит в этот dnd5e/provider boundary, строится из native unevaluated roll config/terms, без собственного parser формул. Key сравнивает разрешённые native terms и влияющие на результат options (advantage/disadvantage/fixed/minimum/maximum/halflingLucky), исключая flavor и посторонние поля getRollData вроде HP/имени, если они не участвуют в authored formula. Непонятный semantic option даёт canShare:false, а не теряется.

- [ ] **1. Написать red contract tests на фактических обработчиках.** Helper загружает только нужные именованные functions/hook callbacks из локальных исходников через Node VM с явными dependencies; не запускает весь vendor bundle. Roots берутся из `REBREYA_FOUNDRY_APP_ROOT` и `REBREYA_FOUNDRY_DATA_ROOT`; отсутствующий source/несовпавший callback при обязательном локальном запуске — FAIL, не skip. Сначала воспроизвести неправильное native timing при jump, затем проверить desired trace:

  ```js
  assert.deepEqual(startActors, ["a", "b", "c"]);
  assert.deepEqual(endActorsBeforeAdvance, []);
  assert.deepEqual(endActorsAfterAdvance, ["a", "b", "c"]);
  assert.equal(workflowsInFlightAtPhaseCompletion, 0);
  assert.equal(legacyDuplicateCalls, 0);
  ```

  Отдельные cases: DAE четыре specialDuration, repeats и Any, suppressed/disabled, чужой source-actor, transferred/enchantment effects, authored round/turn duration, эффект создан после start. MIDI legacy/ActivityOverTime, save/removal/concentration, Effect Macro onTurnStart/onTurnEnd/onEachTurn/onRound*/onCombat*. Проверить cancellation, несовместимый активный provider и полное unchanged native поведение unflagged Combat.
- [ ] **2. Запустить red suite** с roots `D:/FoundryVTT/Foundry Virtual Tabletop/resources/app` и `D:/FoundryVTT/Data`; подтвердить ожидаемое нарушение desired trace. Не выдавать synthetic mocks за live проверку.
- [ ] **3. Реализовать adapter.** Times Up expiration проходит существующий `TimesUp.expireEffect`, DAE repeats — `DAE.daeMacro`, legacy MIDI — awaited `MidiQOL.doOverTimeEffect`, Effect Macro — его `utils.hasMacro/callMacro`. Сохранить applicability/source/duration правила и сопоставить native startTurn с логическими фазами без изменения authored effect.
- [ ] **4. Реализовать ожидаемый ActivityOverTime маршрут.** Native `updateCombat` запускает async processing без возврата Promise, поэтому его return не доказывает completion. Phase projection этого проверенного provider contract использует awaited `MidiQOL.socket().executeAsUser("localActivityOverTimeEffect", executorId, {actorUuid,effectUuid,startTurn,options})`; это зарегистрированный внутренний handler установленной версии, а не придуманный public `doActivityOverTimeEffect`. Executor выбирается точно по native wrapper: private/self + active owning player → этот player; иначе текущий active GM. До handoff сохраняются native disabled/suppressed и ActiveAuras ignoreSelf guards, activity resolution/turnChoice и исходные options. Native handler исполняет урон/предмет/потребление/saves/removal. Test сравнивает route с фактическим `doActivityOverTimeEffect`, включая offline owner и ошибки handler.
- [ ] **5. Защитить native callbacks ровно один раз.** Только для active flagged Combat подавить исходный turn-processing провайдера, который уже исполняет adapter; его остальные hooks и неуправляемые бои сохранить. Если callback нельзя уверенно распознать/обойти или workflow нельзя дождаться, preflight возвращает unsupported до world writes. Нельзя заменять общий ход обычными subturns для прохождения проверки.
- [ ] **6. Запустить provider suite до PASS** и `node --test tests/effectmacro-compat.test.mjs tests/decaying-damage.test.mjs`. Отдельно сохранить actual-source route/trace evidence; live damage/save подтверждается ещё раз в Task 8.

### Task 3: Сохранить собственные автоматизации каждого участника

**Files:** Modify `scripts/combat/hooks.js`, `scripts/combat/attack-service.js`, `scripts/combat/rune-knight-automation-service.js`, `scripts/combat/curse-upgrade-automation-service.js`, `scripts/combat/implant-automation-service.js`, `scripts/combat/craftsman-gadget-zone-service.js`, `scripts/automation/weapon-mod-roll-modifiers.js`, `scripts/integrations/implant-automation-hooks.js`, `scripts/integrations/craftsman-gadget-hooks.js`, provider adapter; Create `tests/grouped-combat-automation.test.mjs`; extend affected existing owner tests.

**Interfaces:** Consume `Phase` and active member IDs. Produce additive `handleGroupedCombatPhase(combat, phase):Promise<void>` on attack/Rune Knight/curse upgrade/implant/smoke-zone owners. Existing public handlers keep their signatures and ordinary semantics. Adapter invokes fighter/paladin/sorcerer existing handlers with explicit `{combatant,combatantId,round,turn}`; race any-turn cleanup выполняется один раз на группу.

- [ ] **1. Написать red tests.** Для каждого из трёх NPC проверить reaction refresh, нужные ресурсы/сaves/Rune Knight, source-next-turn paladin, sorcerer cooldown, curse waitingForTurn/obsidian, poison smoke и implant regeneration. `turn` recovery dnd5e — один раз на группу для всех Combatant; `turnStart/turnEnd` — для нужного участника. Для a/b одновременно сохранить независимые прицеливание, пройденную дистанцию и impulse-legs boost; при выходе из группы очистить соответствующего участника. Раскрытие UI и повтор native hook не дают второго срабатывания.
- [ ] **2. Выполнить** `node --test tests/grouped-combat-automation.test.mjs`; убедиться, что текущий representative-only код проваливает нужные assertions.
- [ ] **3. Реализовать owner methods через существующие внутренние операции.** Не подменять `game.combat`, не мутировать native `combat.combatant`, не дублировать расчёты. Для weapon mods добавить общий active-member predicate с fallback native individual; `getWeaponModAimState` получает optional active-members context, сохраняя существующий вызов. Для имплантов учёт текущих distance/boost ведётся по actor/token внутри активной группы; end/reload очищает только свои временные boosts. Rune/curse получают явные entering/leaving members, чтобы не разрешать один эффект всем по представителю.
- [ ] **4. Провести targeted audit** `rg -n 'combat\??\.combatant|combatTurn|combatTurnChange' scripts/combat scripts/automation scripts/integrations` и классифицировать оставшиеся читатели current actor. Actor-specific mutation каждой найденной integration направить в этот же phase pipeline; display-only/default-token lookup оставить прежним. Grapple refresh и иные global turn события выполняются один раз, не на каждого NPC.
- [ ] **5. Запустить новую suite и существующие:** `node --test tests/grouped-combat-automation.test.mjs tests/combat-attack-service.test.mjs tests/fighter-automation-service.test.mjs tests/race-automation-service.test.mjs tests/rune-knight-automation-service.test.mjs tests/paladin-automation-service.test.mjs tests/sorcerer-automation-service.test.mjs tests/curse-upgrade-lifecycle.test.mjs tests/implant-hooks.test.mjs tests/implant-automation-service.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-gadget-zone-service.test.mjs tests/weapon-mod-roll-modifiers.test.mjs`. Внести изменённые owner signatures/data flow в паспорт; не отключать старые tests обычного боя.

### Task 4: Реализовать application owner и persistent phase receipts

**Files:** Create `scripts/infrastructure/foundry/grouped-combat-repository.js`, `scripts/application/grouped-combat-service.js`, `tests/grouped-combat-service.test.mjs`.

**Interfaces:** Consume rules/provider steps и существующий `WorldMutationCoordinator`. Repository: `getCombat(id)`, `getActiveCombat(sceneId)`, `createCombat(sceneId)`, `readState(combat)`, `writeState(combat,state,{expectedRevision})`, `createMissingCombatants(combat,tokens)`, `commitNativePosition(combat,{round,turn},options)`; async методы возвращают Documents/new revision, input state detached. Service constructor `{repository,effects,coordinator,resolveToken,gameProvider}`; methods `start(request,{sender})`, `transition(request,{sender})`, `observeNativeTransition(combat,previous,current):Promise<void>`, `reconcile(combat)`, `resolveUncertainStep(request,{sender})`, `isManaged(combat)`.

- [ ] **1. Написать red tests с deferred workflow.** Start a/b/c, next PC, round wrap, skip нескольких групп, rewind→forward, два concurrent operation IDs с одной expectedRevision, reload running receipt, сбой на b после completed a, удаление/замена представителя во время save, linked Actor alias и cancel. Проверить:

  ```js
  assert.equal(startCallsForA, 1);
  assert.equal(maxConcurrentTransitions, 1);
  assert.equal(staleTransition.code, "stale-combat");
  assert.equal(reloadedState.mode, "blocked");
  assert.equal(replayedExternalDamage, 0);
  ```

- [ ] **2. Запустить** `node --test tests/grouped-combat-service.test.mjs`; получить ожидаемые failures отсутствующего service/сохранения.
- [ ] **3. Реализовать одну очередь и state machine.** Start key — scene, transition key — Combat; все ingress используют один owner, без вложенного ожидания того же lock. Authority rechecked при выполнении каждого queued запроса. Порядок: validate/preflight → read live revision → plan → завершить leaving phases → commitNativePosition → entering phases → final state. Каждый effect step: running receipt → awaited workflow → done receipt. Перед native write создаётся in-flight ticket; `observeNativeTransition` присоединяется к его completion, не вызывает `transition` повторно и не берёт тот же lock. Native Document update не ждёт completion ticket из своего protected callback; тест моделирует реальный fire-and-forget `_onUpdate` и выявляет возможный цикл ожидания. Новые member/effect IDs повторно разрешаются до конкретного шага. Completed остаётся completed после reorder/rewind/reload; uncertain не запускается автоматически.
- [ ] **4. Реализовать membership правила spec.** Идемпотентное создание Combatant, новый member в открытой группе получает только свой start; в завершённой ждёт следующего start. У обычного начатого Combat mode pending до следующего round boundary. Запись original инициативы/раунда не сбрасывается. Удалённый member больше не получает effects; потеря прав/сцены/документа возвращает конкретную ошибку.
- [ ] **5. Повторить service suite до PASS.** Uncertain recovery показывает operation/member/phase, сохраняет blocked state и требует решения GM; не создавать автоматический replay или интерфейс отмены урона. Повторный macro на blocked Combat открывает native DialogV2 с Actor/effect/phase и решениями «Шаг уже выполнен», «Повторить шаг», «Отмена». Только явное решение active-authorized GM через resolveUncertainStep меняет receipt: completed → done; retry → повтор ровно этого шага и продолжение оставшейся операции; cancel → blocked без writes. Тест отвергает stale resolution и non-GM. Blocked Combat не разрешает незаметно уйти к следующей группе.

### Task 5: Подключить безопасный старт и managed макрос

**Files:** Create `scripts/infrastructure/foundry/grouped-combat-command-contract.js`, `tests/grouped-combat-commands.test.mjs`; Modify `scripts/main.js`, `scripts/combat/grapple-macro-service.js`, `tests/grapple-macro-service.test.mjs`, `tests/main-composition-root.test.mjs`, application/provider adapters.

**Interfaces:** Produce `isValidGroupedCombatStartPayload`, `isValidGroupedCombatTransitionPayload`, `isValidGroupedCombatResolvePayload`; commands `combat.grouped.start`, `combat.grouped.transition`, `combat.grouped.resolve`. Start exact `{sceneId,tokenUuids,operationId}`. Transition exact `{combatId,expectedRevision,targetRound,targetGroupId,operationId}`. Resolve exact `{combatId,expectedRevision,stepKey,resolution,operationId}`, resolution — `completed|retry`, stepKey — trimmed nonempty ≤2048 и exact live uncertain key. Остальные identifiers — trimmed nonempty ≤128, Token UUID ≤512 и exact `Scene.<id>.Token.<id>`, уникальные tokenUuids; revision/round — safe nonnegative integer. Target — live legal group position, размер selection проверяется по сцене. Public `startCombatFromSelection():Promise<Result>` captures current scene/control once; managed sourceId `start-combat-macro`, name «Начать сражение», command `await game.rebreyaMain?.startCombatFromSelection?.();`.

- [ ] **1. Написать red tests.** GM start, unknown/non-GM sender, чужая/неактивная scene, malformed/extra keys, forged requester/ownership, stale transition, owned solo-PC end turn и запрет NPC-group для player. Selection mixed creature/storage/mapObject/system-object/actorless; пустой выбор без writes. Повтор macro сохраняет Combat ID/round/current/initiatives. Fixed initiative mode, dex tiebreaker, авторский bonus, cancellation/preConfigureInitiative и advantage/disadvantage не теряются.
- [ ] **2. Запустить** `node --test tests/grouped-combat-commands.test.mjs tests/grapple-macro-service.test.mjs`; подтвердить red новых требований и сохранить прежние assertions всех шести макросов.
- [ ] **3. Подключить `this.groupedCombatService` в main и typed bus.** Single-active-GM writes; GM нужен для состава/start и uncertain resolution, end solo PC — OWNER действующего Combatant, общий NPC ход — GM. Public/local и socket routes передают одну и ту же проверку/очередь owner; bus не держит тот же lock до вложенного вызова. Service заново разрешает canonical `isStorageActor`/map object metadata и Actor types, а не доверяет client Member.
- [ ] **4. Реализовать native initiative.** Сравнить unevaluated config/terms/options через `describeInitiative`; null/unverifiable profile остаётся individual. Roll только leader новой однородной группы через native `combat.rollInitiative`, распространить результат без повторного броска, выполнить initiative recovery всех участников ровно один раз. Сохранить существующие разные results как отдельные группы и native chat visibility. Новому member готовой группы присвоить её established initiative без переброса остальных.
- [ ] **5. Добавить макрос в существующий provisioner** и повторить focused suites до PASS. Старейшая «Ребрея» переиспользуется; unmanaged одноимённый Macro не ремонтируется; повтор ready не создаёт дублей. API совпадает в `game.rebreyaMain` и `game.modules.get("rebreya-main").api`.

### Task 6: Подключить штатный lifecycle, кнопки и групповое отображение

**Files:** Create `scripts/integrations/grouped-combat-runtime.js`, `tests/grouped-combat-runtime.test.mjs`; Modify `scripts/main.js`, `scripts/combat/hooks.js`, provider guards и соответствующие existing hook registrations.

**Interfaces:** Consume service/rules, включая `isCombatActorActive` из Task 1. Produce `registerGroupedCombatRuntime(moduleApi,{Hooks,CombatClass,CombatantClass,CombatTrackerClass}) -> disposer` с idempotent регистрацией. Source getters/методы dnd5e группируются только для managed Combat.

- [ ] **1. Написать red tests.** Обычные Next/Previous/Next Round/End Turn и прямой native position update не обходят service, не вызывают два lifecycle. Pending→active на round boundary без дубля native последнего end. Unflagged Combat делегируется original methods. Representative deletion, skipDefeated, 0 HP PC, равные initiatives и collision native display key проверяются отдельно. Время: при `roundTime=6`, `turnTime=2` переход группы даёт один logical turn delta, число её участников его не умножает.
- [ ] **2. Запустить** `node --test tests/grouped-combat-runtime.test.mjs` и получить red по перечисленным observable cases.
- [ ] **3. Реализовать native adapters.** Штатная навигация и public `Combat.update` с реальным изменением round/turn выбирают logical target и отправляют transition command. Flag-only/reorder-within-same-group updates не создают нового хода. Внутренний native position write помечен module option и не вызывает рекурсивный ingress. Protected `_manageTurnEvents` для managed Combat ожидает `observeNativeTransition`, затем однократно выпускает `combatTurnChange` с фактической native позицией; для остальных вызывает оригинал. На observing clients completion определяется подтверждённым final state, а не первым изменением turn. Provider/Rebreya guards исключают дубли. Нет повторного глобального `Hooks.callAll` для каждого member. Проверить отсутствие deadlock и повторной очереди при create/delete/reorder Combatant внутри active операции.
- [ ] **4. Реализовать grouping extension.** `getGroupingKey` managed members использует stable logical group ID; comparator сохраняет initiative priority и непрерывность членов; `CombatTracker5e` продолжает строить собственные group rows. Active group получает «Общий ход»; раскрытие/сворачивание не меняет state. Учитывать core skipDefeated без своего правила «HP≤0 значит пропустить». Movement histories очищаются каждому соответствующим native API.
- [ ] **5. Повторить runtime suite до PASS** и affected main/combat/implant/gadget hooks tests. Reload/dispose/register дважды даёт один handler; active GM handover восстанавливает receipts и не запускает завершённые workflows заново.

### Task 7: Автокамера без раскрытия скрытых участников

**Files:** Modify runtime adapter, `scripts/constants.js`, `scripts/settings.js`, `lang/ru.json`, `tests/grouped-combat-runtime.test.mjs`.

**Interfaces:** Produce `panToActiveCombatGroup(combat,{canvas,game,enabled}):Promise<boolean>` и `SETTINGS_KEYS.COMBAT_AUTO_PAN = "combatAutoPan"`, client Boolean setting default true. Localization `REBREYA_MAIN.Settings.CombatAutoPan.Name` — «Камера в начале хода»; `.Hint` — «Перемещать камеру к существу, которое начинает ход в бою Ребреи.»

- [ ] **1. Написать red tests.** Первый start и следующий group start, GM/player, mixed hidden/visible members, чужая scene, canvas not ready, disabled setting и defeated representative. Spy получает только координаты первого доступного непобеждённого видимого member; если такого нет — первого видимого. `animatePan` не получает scale; targets/control/scene.view и socket emit не вызываются.
- [ ] **2. Запустить runtime suite**, подтвердить red новых camera cases.
- [ ] **3. Реализовать локальный post-phase pan** через `canvas.animatePan` только для viewed scene и locally visible token. Клиент наблюдает подтверждённое окончание старта; он не получает координаты скрытых токенов отдельным socket сообщением. Не панорамировать на flag/receipt write, смену представителя или раскрытие строки. При выключении setting обработчик остаётся безопасным no-op.
- [ ] **4. Повторить runtime suite до PASS**; предусмотреть отказ pan как некритичную UI-ошибку, которая не повторяет effect phase.

### Task 8: Полная проверка, живой мир, документация и release

**Files:** Modify `README.md`, `docs/function-passport.md` и профильные паспорта затронутых owners; check manifest/forwarder и изменённые ESM import URLs; update checkboxes/evidence в этом плане.

**Interfaces:** Результат — работающий managed macro/API в мире, совместимый phase pipeline, документированные flags/commands/settings и подтверждённые проверки. Спецификация остаётся acceptance contract.

- [ ] **1. Проверить покрытие spec целиком.** Для каждого из 15 acceptance rows указать suite/test либо живой сценарий; отдельные тесты на каждый provider/Actor, а не один общий счётчик. Passing tests с удалёнными assertions не принимаются. Отдать Gemini scoped diff/spec и получить независимый review без credentials/посторонних данных; Codex проверяет замечания в источнике.
- [ ] **2. Подготовить runtime evidence.** Найти реальное подключение Foundry существующим bridge/browser; подтвердить `game.version`, dnd5e version и активные provider versions. Выполнить macro provisioning и один проверяемый сценарий на временных тестовых существах текущего мира, сохранив исходное состояние сцены. Не запускать пользовательский настоящий бой ради QA и не удалять/переписывать существующие Actor/Combat.
- [ ] **3. Выполнить live acceptance.** Три одинаковых unlinked NPC + PC + selected storage/object. У каждого NPC отдельные start/end эффекты, на PC — source-bound эффект от второго NPC; добавить MIDI save/damage и Effect Macro. До действий группы проверить start всех трёх и отсутствие end; одним native Next — end всех трёх до PC start. Проверить native group row/раскрытие, ручные действия второго/третьего, scope камеры GM/player, реальную видимость private ActivityOverTime и отсутствие console errors. Повторить macro, join member, reload между ходами, rewind/forward и ordinary Combat regression. Удалить только явно созданные QA документы после завершения; при недоступном live окружении оставить задачу незавершённой с конкретным blocker, не заявлять совместимость.
- [ ] **4. Обновить документацию.** README: macro/GM permissions, `startCombatFromSelection`, настоящие group phases, camera setting, повторный запуск и uncertain recovery. Паспорт: каждый новый/изменённый метод, owner, data flow, constraints и focused tests; internal provider dependency/версии указать прямо. Новая версия и entrypoint синхронны; один canonical ESM URL для каждого нового owner/изменённого общего import.
- [ ] **5. Запустить обязательную полную проверку один раз после последних runtime правок:**

  ```powershell
  $env:REBREYA_FOUNDRY_APP_ROOT = 'D:/FoundryVTT/Foundry Virtual Tabletop/resources/app'
  $env:REBREYA_FOUNDRY_DATA_ROOT = 'D:/FoundryVTT/Data'
  node --test tests/*.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Test suite failed' }
  git diff --check
  if ($LASTEXITCODE -ne 0) { throw 'Diff check failed' }
  $files = git ls-files '*.js' '*.mjs'
  foreach ($file in $files) { node --check $file; if ($LASTEXITCODE -ne 0) { throw "Syntax: $file" } }
  $jsonFiles = git ls-files '*.json'
  foreach ($file in $jsonFiles) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json -ErrorAction Stop | Out-Null }
  ```

  Stage только task files до tracked-file прохода, чтобы новые JS/MJS тоже вошли в `git ls-files`; отдельно проверить содержательный staged diff. Expected: все tests PASS, 0 failures, каждый node --check/JSON parse успешен. При failure исправить причину и повторить затронутую проверку; если изменились runtime behavior/общие dependencies — повторить соответствующие regression suites.
- [ ] **6. Проверить Git и завершить.** `git diff --check`, `git diff --stat`, содержательный `git diff`/`--cached`; commit только task files, push `origin lich_branch`, затем status и сравнение с remote. Отчёт: version/commit, spec+plan paths, точные passed/failed числа/реальные ошибки, живые Foundry/system versions, проверенные GM/player случаи и оставшиеся ограничения. Не выдавать сохранённый документ или зелёный Node mock за установленный и проверенный макрос.

## Review gate и исполнение

План подготовлен для проверки пользователем. Предлагаемый метод — **Native**: Codex реализует tasks последовательно в этом чате через `executing-plans`, Gemini используется для scoped анализа и независимого финального review. Это сохраняет общий контекст тесно связанных provider/service/lifecycle interfaces и не создаёт отдельный GPT-контекст на каждый task. До утверждения этого плана runtime-код не меняется.

## Execution evidence

Пока выполнено только планирование; runtime tests и live QA по этому плану ещё не запускались. Во время исполнения здесь фиксируются команды, реальные passed/failed числа, изменения release версии и результаты живого сценария.
