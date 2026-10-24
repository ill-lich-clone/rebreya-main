# Общие ходы существ и макрос начала сражения

Точка входа: `game.rebreyaMain.startCombatFromSelection()`; такой же метод доступен в `game.modules.get("rebreya-main").api`. Managed world-макрос «Начать сражение» находится в существующей папке «Ребрея», `sourceId: start-combat-macro`.

## Владельцы и маршруты

`controlled Token UUID → публичный ingress → active GM / combat.grouped.start → GroupedCombatService → native Combat/Combatant + groupedCombat flag → awaited phase steps → native tracker + локальная камера`.

Кнопки Next/Previous/Next Round и positional `Combat.update` в управляемом бою используют `combat.grouped.transition`. Обычный Combat без module flag сохраняет исходные методы и hooks. Начатый обычный бой получает `mode:pending` до следующего раунда; текущие индивидуальные события не переигрываются.

## Domain: `scripts/combat/turn-group-rules.js`

- `GROUPED_COMBAT_FLAG = "groupedCombat"`; `combatantsOf(combat) -> Combatant[]` нормализует Foundry Collection/array.
- `combatFlagKey(value) -> string` кодирует JSON в ключ без точек и update-directives; Foundry expandObject не превращает UUID внутри receipts/durationAnchors в вложенные пути.
- `buildCombatTurnGroups(members, previousGroups=[]) -> Group[]`: исходный Actor + disposition + подтверждённый native initiative profile + установленное значение инициативы. Linked/character/unverifiable записи индивидуальны; unrolled участник может присоединиться к единственному established score. HP/имя не входят в identity. Stable IDs переиспользуются после удаления представителя.
- `planGroupTransition(state,target,groups,skippedGroupIds=new Set()) -> Phase[]`: end → round-end/round-start при границе → each-turn → start; crossed groups перечисляются последовательно, backward не создаёт effect phases. Полностью defeated intermediate группы при skipDefeated не получают each-turn/start. У `each-turn` свой groupId при общем memberIds; удалённая группа не блокирует следующий живой ход.
- `buildPhaseStepKey(combatId,phase,combatantId,provider,stepId) -> string`: encoded JSON tuple с раундом/group/Combatant/phase/provider/effect, поэтому linked Actor alias не поглощает отдельный ход.
- `getActiveGroupMemberIds(state) -> string[]`, `isCombatActorActive(combat,actorOrToken,state?) -> boolean`: активное множество группы либо native individual fallback. Во время перехода учитывается executionPosition.

Focused: `tests/grouped-combat-rules.test.mjs`.

## Application: `scripts/application/grouped-combat-service.js`

`GroupedCombatService({repository,effects,coordinator,resolveToken,gameProvider,isAuthority,isStorageActor})` — единственный владелец общего хода. `isStorageActor` передаётся из canonical storage-service composition root. `WorldMutationCoordinator` сериализует start по scene, затем любые операции того же Combat по общему ключу; native lifecycle присоединяется к ticket без повторного lock.

| Метод | Контракт |
| --- | --- |
| `isManaged(combat)` | Наличие versioned flag; mode отличает pending от active/blocked |
| `save(combat,state,{receiptKey=null}={})` | Authority/live Combat recheck; полный checkpoint либо partial receipt+revision через repository CAS |
| `eligible(token,sceneId)` | Только same-scene character/npc, без storage/mapObject/system object и actorless tokens |
| `members(combat)` | Live eligible snapshots и native initiative profiles; не доверяет client Member |
| `start(request,{sender})` | GM, exact request/preflight до изменений; idempotent Combatant, native grouped initiative, сохранение раунда/хода/старых scores; новый member открытой группы получает только свой start |
| `transition(request,{sender})` | Exact live target/revision; GM либо OWNER solo character, player может только закончить текущий собственный ход; прунит удалённых участников |
| `runPipeline(combat,state,phases,target,operationId,begin=false)` | Phase checkpoint после планирования сохраняет metadata/anchors; partial running receipt → awaited step → partial done. Native позиции имеют отдельные checkpoints; history/recovery/логический time delta сохранены |
| `observeNativeTransition(combat)` | Promise существующей операции, без повторной очереди и повторных effects |
| `recoverPending(combat,state)` | Остаточный running становится uncertain/blocked перед новым ingress; только подтверждённые done steps можно пропустить при продолжении pending operation |
| `reconcile(combat)` | На active GM после reload/handover под общим lock восстанавливает pending; неоднозначный шаг не повторяет |
| `resolveUncertainStep(request,{sender})` | GM + revision + exact uncertain key; completed сохраняет done, retry разрешает конкретный повтор и продолжение |

Flag schema: `{version:1,mode,activateAtRound,revision,groups,current,receipts,memberStarts}`; transient executionPosition/pendingTransition и durationAnchors также сериализованы. Receipt сохраняет provider, Combatant, effect UUID, phase и operation ID. Executable closures/Document references в flags отсутствуют. История done receipts нужна для rewind→forward; урон и исчезнувшие эффекты назад не восстанавливаются.

При ошибке следующая группа не начинается; повтор macro показывает native DialogV2 с существом/эффектом/фазой и решениями «Шаг уже выполнен», «Повторить шаг», «Отмена». Решение не отменяет уже проведённый workflow.

Focused: `tests/grouped-combat-service.test.mjs` (включая concurrent/stale clicks, native lifecycle ticket, reload/uncertain, group deletion и turnTime).

## Infrastructure и composition

`GroupedCombatRepository({gameProvider})` в `scripts/infrastructure/foundry/grouped-combat-repository.js`:

- `getCombat(id)`, `getActiveCombat(sceneId)`, `createCombat(sceneId)` разрешают scene-linked live Documents.
- `readState(combat)` возвращает detached flag; `writeState(combat,state,{expectedRevision})` проверяет live revision и атомарно заменяет flag через native `==groupedCombat`, удаляя завершённые transient fields и retry receipt.
- `writeReceipt(combat,state,key,{expectedRevision})` проверяет live revision и наличие pending checkpoint, сохраняет только revision и `receipts.==key` native patch. Прочая history/anchors/memberStarts не клонируется и не отправляется. `stateOf` читает live flag для CAS; `progressOptions` помечает active pending writes как `options[MODULE_ID].groupedCombatProgress:true` с render/turnEvents false.
- `isGroupedCombatProgressUpdate(combat,changed,options)` принимает только явно помеченный active pending write одного module flag; разрешает native backend `_id` этого Combat, отвергает position/foreign/mixed fields. Это UI optimization, не authorization bypass.
- `withNativeChanges(combat,operation)` ограничивает внутренний native ingress; `createMissingCombatants(combat,tokens)` не создаёт повторных Token combatants.
- `commitNativePosition(combat,position,options)` сохраняет нативные round/turn и time delta; emits один native pre-change combatTurn/combatRound. `beginCombat(combat,position)` сохраняет native startCombat/encounter recovery и выбирает первую подходящую позицию через combatStart hook.
- `GROUPED_NATIVE_WRITES` — process-local WeakSet для reentrancy, не wire-claim о полномочиях.

`grouped-combat-command-contract.js`: `isValidGroupedCombatStartPayload`, `isValidGroupedCombatTransitionPayload`, `isValidGroupedCombatResolvePayload` — exact plain shapes, trimmed bounded IDs, same-scene unique Token UUID, safe integer round/revision, resolution completed/retry. `registerGroupedCombatCommands(moduleApi)` регистрирует `combat.grouped.start`, `.transition`, `.resolve` с authenticated sender, явным keyed scheduling и application authority checks.

`scripts/main.js` создаёт repository/effects/service один раз, публикует `startCombatFromSelection()`, регистрирует commands/runtime и startup reconcile. Runtime повторяет reconcile при userConnected/updateUser; очередь не прерывает текущую локальную операцию. `GrappleMacroService.syncManagedDocuments()` дополнительно вызывает `buildStartCombatMacroData(folderId,options={})`; остальные шесть sourceId/макросов и unmanaged документы сохраняются.

Focused: `tests/grouped-combat-repository.test.mjs` (реальные Foundry expandObject/mergeObject), `tests/grouped-combat-commands.test.mjs`, `tests/grapple-macro-service.test.mjs`, `tests/main-composition-root.test.mjs`.

## Provider adapter: `scripts/integrations/grouped-combat-effects.js`

- `inspectGroupedCombatSupport({game,Hooks})` и `createGroupedCombatEffects(dependencies).inspect()` сверяют active provider versions, известные callback contracts и наличие нужных API. Поддержанная база: Foundry 13.351, dnd5e 5.2.5; DAE 13.0.27, Times Up 13.1.9, MIDI-QOL 13.0.61, Effect Macro 13.0.4 при их активности. Незнакомый нужный контракт отклоняет conversion до world writes.
- `describeInitiative(actor) -> {key,canShare}` читает native unevaluated formula/options; authored parts/fixed/advantage сохраняются. Native normalized advantageMode и criticalSuccess/criticalFailure/target включены в semantic signature. configured/flavor не разделяют NPC, неизвестный semantic option выключает объединение конкретной записи.
- `plan(combat,phase,state?) -> EffectStep[]` снимает applicable effects + enchantments, готовит отдельные persistent step keys и awaited closures; authored duration не переписывает. `durationExpired` сопоставляет сохранённый start с логическими группами. `installNativeGuards()` подавляет identified updateCombat turn-provider callbacks active/blocked Combat также на flag writes: Times Up иначе сканирует native durations при каждом receipt. Pending/ordinary Combat и native rest/create/delete hooks сохранены.
- Times Up выполняет expiry своим `expireEffect`, DAE — `daeMacro("each",...,{turn:"startTurn"|"endTurn"})`, включая Any/source specialDuration.
- MIDI legacy — `doOverTimeEffect`; `activityOverTime(actor,effect,startTurn)` разрешает native activity и вызывает зарегистрированный `localActivityOverTimeEffect` через awaited `MidiQOL.socket().executeAsUser`. Private/self выполняет active owner; иначе active GM. Native workflow сохраняет saves, consumption, resistance/temp HP, concentration и RollComplete затихающего урона. Native action-state cleanup также сохраняется.
- Effect Macro — существующие `utils.hasMacro/callMacro/getExecutor`. `ensureOwnerSocket()` регистрирует receipt-bound handler `groupedEffectMacro` через уже установленный socketlib; remote handler никогда не выполняется на GM и проверяет designated player, persisted running receipt, effect и phase. На GM эффекты исполняет локальный coordinator.
- Ограничение: MIDI `autoRerollInitiative` индивидуально перебрасывает участников и разрушает общую инициативу. При включённом mechanic preflight явно отказывает; настройка не выключается и обычный бой не меняется. Поддержка этого mechanic требует отдельного grouped reroll coordinator.

Focused: `tests/grouped-combat-provider-contracts.test.mjs`; `tests/helpers/installed-combat-providers.mjs::loadInstalledFunction(relativeFile,name,globals)` и `loadInstalledClass(relativeFile,name,globals)` исполняют конкретные declarations установленного provider в VM. Native D20Roll constructor/configureModifiers проверяются с минимальным parser/Die harness; тест не подменяет native options plain fixture. Optional roots для source checks: `REBREYA_FOUNDRY_DATA_ROOT`, `REBREYA_FOUNDRY_APP_ROOT`.

## Rebreya owners и native UI

`planRebreyaCombatAutomation(moduleApi,combat,phase)` в `scripts/combat/grouped-turn-automation.js` собирает отдельные owner/member steps; это orchestration, не второй владелец правил.

- Additive `handleGroupedCombatPhase(combat,phase)` у CombatAttackService, RuneKnightAutomationService, CurseUpgradeAutomationService, ImplantAutomationService и CraftsmanGadgetZoneService использует их прежние операции. Fighter/paladin/sorcerer получают explicit Combatant context; race/gadget/global cleanup — один вызов на logical turn.
- `CombatAttackService.handleWeaponModTurnChange(combat,{ended=false,activeCombatants=null}={})`, movement/aim conditions и `handleWeaponModTokenMove` понимают всех активных членов. `getWeaponModAimState(host,combat,contributions=[])` сохраняет прежнюю signature, проверяя тот же canonical active-member predicate.
- `CurseUpgradeAutomationService._combatChanged(combat,previous={},current={},context=null)` сохраняет native fallback; grouped контекст задаёт entering/leaving actor и отдельный eventKey начала/конца для обсидиана при одной native позиции. Rune Knight получает explicit current/previous sentinels вместо подмены game.combat.
- `ImplantAutomationService.recordMovement`, grouped phase и `handleCombatEnd` ведут независимые movement/impulse records участников; ordinary counters сохраняются. Smoke zone lifetime идёт один раз, poison — каждому начинающему внутри зоны.
- `registerCombatHooks`, `registerImplantAutomationHooks`, `registerCraftsmanGadgetHooks` не дублируют managed phases через прежние turn callbacks; остальные hooks прежние.

`registerGroupedCombatRuntime(moduleApi,{Hooks,CombatClass,CombatantClass,CombatTrackerClass}) -> disposer` оборачивает native Next/Previous/round/update, protected `_manageTurnEvents`, comparator, grouping key и `renderGroups`. Существующий tracker строит группы и раскрываемые children; отдельный app не создаётся. Регистрация idempotent, disposer восстанавливает прежние методы. Observing lifecycle waiters снимаются при завершении, deleteCombat и dispose. Сброс round до нуля внутри управляемого боя явно отклоняется: сначала завершить бой; backward между начатыми ходами поддержан.

На strict progress update wrapper `_onUpdate` сохраняет native bookkeeping, но process-local WeakSet подавляет `updateCombatantActors` и `Combatant.refreshDynamicRing` в этом стеке. Реальные native positions, финальный/blocked commit и ordinary/mixed updates обновляют окна/rings прежним путём. Проверка использует настоящие Foundry13.351/dnd5e5.2.5 methods в VM: `tests/grouped-combat-progress.test.mjs`; это не live FPS measurement.

Внутренний `requestTransition(combat,target)` объединяет повторную навигацию/positional update того же клиента в один in-flight Promise на Combat. До окончания ожидаемого workflow второй запрос с устаревающей ревизией не отправляется; после resolve/reject следующий запрос разрешён. Другие поля public update сохраняются после ожидания. Серверные revision/security checks для разных клиентов не ослаблены.

`runStartCombatMacro(moduleApi,options={})` снимает controlled UUID и показывает только нужный recovery Dialog. `panToActiveCombatGroup(combat,{canvas,game,enabled})` после подтверждённого start выбирает первого доступного непобеждённого/видимого member, сохраняет scale/targets/control и не переключает scene. Невидимые player токены не дают координат pan.

`SETTINGS_KEYS.COMBAT_AUTO_PAN="combatAutoPan"`, `registerSettings()` — client Boolean default true; localization `REBREYA_MAIN.Settings.CombatAutoPan.Name/Hint`.

Focused: `tests/grouped-combat-automation.test.mjs`, `tests/grouped-combat-runtime.test.mjs` + существующие combat/weapon-mod/implant/gadget/class regression suites.

## Верификация

Живой world/browser сценарий не является выполненной проверкой: пользователь явно разрешил его пропустить. Автоматические tests и provider-source checks не доказывают визуальную и многоклиентскую совместимость внутри запущенного Foundry. План и spec: `docs/superpowers/plans/2026-10-21-grouped-combat-start.md`, `docs/superpowers/specs/2026-10-20-grouped-combat-start-design.md`.
