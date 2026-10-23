# Круговая атака: паспорт функций

## Чистые правила

Владелец `scripts/combat/whirlwind-attack.js`, canonical cache key `?v=1.5.1`.

- `buildWhirlwindActivity(item,baseActivity?) -> object|null`: melee weapon с `lchWhirl` получает native attack `lchWhirlAttack01` «Круговая атака»; исходная attack/damage/consumption сохраняется. Marker `flags.rebreya-main.whirlwindAttack={version:1,sourceActivityId}`. MIDI `attackRollPerTarget="never"`; нового turn tracker нет.
- `isWhirlwindActivity(activity) -> boolean`: managed marker + weapon + действующий `lchWhirl`.
- `whirlwindActivityUpdates(item) -> object`: dotted updates; сравнивает проецируемые поля с учётом schema defaults, не перезаписывает чужой ID, удаляет только managed activity при снятии свойства.
- `routeWhirlwindConsumption(activity,updates) -> boolean`: native activityConsumption переносит `uses.spent` в исходную activity того же Item. Native consumed/refund deltas относятся к исходному ресурсу; repair не возвращает расход.
- `collectWhirlwindTargets(source,tokens,reachFeet,measure) -> Token[]`: все Actor-backed токены, кроме исходного, без disposition filter. Measure возвращает футы; blocked sentinel/NaN исключаются.
- `whirlwindHitTargets(targets,roll) -> Token[]`: один total против каждой КД, natural fumble/critical. Используется native report, не подменяет MIDI hits.
- `whirlwindEffectTargets(workflow) -> Token[]|null`: обычная атака — null, круговая — выбранный поражённый token UUID; linked Actor copies различаются.
- `markWhirlwindDamageRolls(config,targetUuid?)`: сериализуемые properties `rebreyaWhirlHalf` и `rebreyaWhirlTarget:<token UUID>` для extra. Формулы и critical dice неизменны.
- `buildWhirlwindDamagePackets({baseDamage=[],extraDamage=[],selectedTargetUuid,targetUuid}) -> object[]`: base ×0.5 всем, extra ×0.5 выбранному токену, без раннего округления.
- `applyWhirlwindDamage(actor,damages,options={}) -> boolean`: только маркированные пакеты, target из MIDI/native options, WeakSet от повторного callback одного packet object. Выполняется до native resistance/immunity/rounding.
- `registerWhirlwindNativeTargetOptions(ElementClass?)`: идемпотентный adapter damage-application для круговой; отдельные entries/options по tokenUuid, Actor UUID descriptor contract, настоящий Actor в native calculator/applyDamage. Обычный tray сохраняет native path. Основан на dnd5e 5.2.5, требует live QA при обновлении системы.

## Runtime owner

`CombatAttackService` в `scripts/combat/attack-service.js`:

- `repairWhirlwindActivities(document) -> Promise<{updated}>`: Item/Actor.items, только доступные для обновления weapons. Вызывается из существующих render и item-update callbacks; internal option `rebreya-main.whirlwindSync` предотвращает рекурсию.
- `getMeleeReachFeet(item,options={}) -> number`: прежний size base + natural racial/Rune Knight + weapon bonus; заменяет private `#resolveFinalMeleeReachFeet` без изменения обычной атаки.
- `prepareWhirlwindUse(activity,usageConfig={},messageConfig={}) -> boolean`: source token из workflow/Actor/единственного controlled или active token на сцене. MIDI computeDistance с walls/elevation либо storage distance/collision fallback; use-scoped targets, без изменения user.targets. Пустая область отменяет действие до расхода. Снимок sourceTokenUuid/targetUuids; native descriptors хранят Actor `uuid` и отдельный `tokenUuid`.
- `resolveWhirlwindHits(workflow) -> Promise<boolean>`: сохраняет готовые MIDI hits/EC/cover/reactions. При autoCheckHit=none вызывает штатный checkHits перед damage; raw AC не подменяет MIDI.
- `chooseWhirlwindEffectTarget(workflow) -> Promise<boolean>`: одна hit target автоматически, несколько — DialogV2. Закрытие отменяет только extra effects; selectedTargetUuid хранится в текущем workflow.
- `prepareWhirlwindExtraDamage(workflow,config) -> boolean`: последний MIDI preDamageRoll callback маркирует дополнительные configs адресной половиной.
- `applyWhirlwindDamage(actor,damages,options)` и `routeWhirlwindConsumption(activity,updates)` делегируют одноимённым rules helpers.
- `scopeWhirlwindEffects(workflow,restore=false) -> boolean`: preApplyDynamicEffects временно ограничивает hit sets выбранной целью; postApplyDynamicEffects/preAbort восстанавливает исходные damage hits.
- `reportWhirlwindAttack(rolls,context) -> Promise<void>`: native hit/miss report без раскрытия КД, escaped имена, снимок hitTokenUuids в связанную usage card.
- `prepareWhirlwindDamageCard(config,message)`: native damage наследует hit snapshot исходной card вместо ручных targets, существующий MIDI workflow не сбрасывает.

Изменённые `applyDnd5ePreUseActivity`, `applyDnd5eAttackRollConfig`, `applyDnd5ePostAttackRoll`, `applyDnd5eDamageRollConfig` подключают новые helpers только для managed activity и сохраняют ordinary weapon path.

`registerCombatHooks(moduleApi)` в `scripts/combat/hooks.js` — единственный registration owner: preTargetingV2, hitsChecked, preDamageRoll, pre/postApplyDynamicEffects/preAbort, preCalculateDamage, activityConsumption и прежние sheet/item hooks. Существующий guard исключает повторную регистрацию.

## Проекция каталога и дополнительные эффекты

`createDnd5eItemData()` в `scripts/data/gear-compendium.js`: каталог с `lchWhirl` получает ordinary и whirlwind melee activities с includeBase; template version 26 обновляет managed catalog. Авторские activities/формулы сохраняются при runtime repair.

`RogueAutomationService.applyMidiPreDamageRoll`/`targetActorsFromWorkflow`: Sneak Attack и Cunning Strike только выбранной hit target, bonus damage маркируется; собственный лимит Sneak Attack сохраняется. `FighterAutomationService` и `PaladinAutomationService.targetActorsFromWorkflow` используют тот же selected-target helper.

`RaceAutomationService.targetListFromWorkflow`, `#handleKeenEye`, `#handleSurpriseAttack`, `#handleCelestialDamage`, `#applyDamage` сохраняют selected-token scope и native multiplier 0.5 для круговой. Существующий socket applyTargetDamage передаёт boolean halfDamage, нормализуемый в 0.5/1; Fury of the Small использует общий маркированный roll path.

`RuneKnightAutomationService.#prepareFireRune`, `#applyGiantMightDamage`, `#applyPendingFireRune`: выбранная цель и маркированные bonus rolls. Урон кандалов в последующие ходы остаётся прежним.

## Проверки

`tests/whirlwind-attack.test.mjs`: projection/repair/collision, все фракции/reach, один total, отсутствие нового лимита, адресность linked tokens, native Actor/Token tray contract, исходный ресурс, временный effects scope, сохранение MIDI hits/manual-hit setting и card snapshot.

`tests/whirlwind-native-damage.test.mjs`: настоящий установленный dnd5e calculator из source map (при отсутствии установки явно skipped), mixed/odd damage, resistance/immunity/critical totals, native targeting; MIDI respectProperties contract.

Регрессии владельцев: rogue/race/rune-knight automation suites. Смежные suites: combat attack, gear, fighter, paladin, module manifest.
