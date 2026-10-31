# Вдохновение Laaru и общий доброс d20

## Владелец Laaru

`scripts/combat/bardic-inspiration-compat-service.js` адаптирует только
`Compendium.laaru-dnd5-hw.classfeatures.Item.hpLNiGq7y67d2EHA`.
Пакет Laaru и его activities/resources/recovery не изменяются.

- `isLaaruBardicInspirationItem(item) -> boolean`: exact modern `_stats.compendiumSource` или legacy core/dnd5e sourceId; имя не является идентификатором.
- `isGrantActivity(activity) -> boolean`: указанный source плюс исходный grant activity ID `jADU6PX5XlK4kOq8`. Отдельный `2Enk7AiD901iQmfz` только бросает кость.
- `tokenDocument(value)`, `sourceToken(actor)`, `resolveTarget(entry)`: нормализуют Token/TokenDocument/Actor/UUID; source выбирается из synthetic Actor token, единственного controlled или единственного active token. Произвольный token из нескольких не выбирается.
- `bardicEffect(effect)`: распознаёт только `d20Bonus.kind=bardicInspiration`.
- `validateRecipient(actor,target,originToken) -> boolean`: отклоняет себя, отсутствие одной цели, уже действующую bardic die и дистанцию >60 ft на общей сцене. Расстояние между центрами использует square-grid/Chebyshev. Возвращает false при отсутствии общей геометрии (выдача разрешается с ручной проверкой), true при проверенной дистанции. Слышимость ручная.
- `inspirationFormula(item) -> string`: разрешает authored formula исходной feature/roll activity по roll data барда; стандартная отсутствующая scale получает d6/d8/d10/d12 на уровнях 1/5/10/15. Не использует уровень получателя. Неизвестные references/невалидная Roll formula отклоняются.
- `BardicInspirationCompatService(moduleApi=null)`: хранит до 64 transient successful/in-flight native message operations для локальной дедупликации. Постоянная защита находится на самом usage ChatMessage.
- `findBardicInspirationItem(actor)` и `restoreBardicInspiration(actor,{amount=1}={})`: точная Laaru feature; уменьшают `system.uses.spent` без переполнения. Барабан и `isBardicInspirationRestoreItem(item)` сохраняют прежний контракт.
- `#selectedTarget(usageConfig,results={})`: explicit targets → native message dnd5e.targets → текущие user targets; разрешается ровно одна цель. Exact synthetic Actor UUID сохраняется.
- `applyDnd5ePreUseActivity(activity,usageConfig={}) -> boolean`: validates grant recipient до использования и ещё раз на preActivityConsumption; возвращает false с warning без штатного расхода.
- `applyDnd5ePostUseActivity(activity,usageConfig={},results={})`: drum restore либо запрос `bardic.inspiration.grant` после успешного native use с ChatMessage. Item resource повторно не расходуется.
- `canGrantInspiration(payload,{sender}) -> Promise<boolean>`: live source resolution, exact Laaru identity и GM/OWNER source Actor.
- `grantInspiration(payload,context={}) -> Promise<object>`: только active GM; снова проверяет source/activity/sender, exact actor-token match, original message item/activity/target и delta расхода `system.uses.spent`. Pending/complete receipt `flags.rebreya-main.bardicInspirationGrant` на usage ChatMessage делает повтор после удаления/расхода эффекта no-op. Effect создаётся disabled с `d20Bonus.grantPending:true` и становится доступен только после durable complete receipt. Восстановление существующего pending effect сохраняет исходный startTime; `activate(effect)` включает его после подтверждения. Неопределённая pending-выдача без surviving effect требует проверки GM и не создаёт новую кость. Effect создаётся через native embedded document API. Удаляются только истёкшие bardic effects, performer/прочие эффекты сохраняются. Как и штатный расход Foundry, контракт не защищает от OWNER, намеренно переписывающего собственные документы и native usage flags.

## Typed command и data flow

`scripts/infrastructure/foundry/bardic-inspiration-command.js`:

- `isValidBardicInspirationGrant(payload) -> boolean`: exact bounded operationId/sourceItemUuid/activityId/targetActorUuid/sourceTokenUuid/targetTokenUuid; world/synthetic UUID, неизвестные claims/formula/amount запрещены.
- `registerBardicInspirationCommand(commandBus,service)`: регистрирует `bardic.inspiration.grant`, live authorize и execute одного service. Keyed scheduling блокирует source Item/Actor, target Actor/Token, source Token и usage ChatMessage, включая implicit synthetic Actor keys стандартного coordinator.

Data flow: native Laaru use/consumption → usage ChatMessage → typed command bus → authenticated active GM → receipt pending → nontransfer Actor ActiveEffect → receipt complete.
Effect содержит `d20Bonus` (`kind`, `formula`, `mode:add`, `prompt:true`, `deleteOnUse:true`, sourceItemUuid, operationId), duration.startTime/seconds=600. Применение использует существующие владельцы ниже.

## Владельцы доброса

- `scripts/combat/d20-bonus-roll.js`: `appendD20Bonus(roll,bonusRoll,{sign=1}={})` добавляет OperatorTerm/NumericTerm, recomputes formula/total, сохраняет исходные dice/results/options. `isAvailableD20BonusEffect(effect,worldTime=game.time.worldTime)` отбрасывает disabled/transfer/suppressed/expired effects. `runD20BonusOperation(actor,operation)` использует общую WeakMap-очередь для обоих consumers; все импортируют один canonical ESM URL.
- `AttackRollBoostService.applyNativeBuildPost(rolls,config={},message={})`: настоящий `config.workflow` отличает MIDI без сериализации Document в Roll.options. Standalone attack обрабатывается до публикации; MIDI add остаётся на hitsChecked.
- `applyDnd5eRollAttack(rolls,context={})`, `applyMidiHitsChecked(workflow,options={})`, private `#applyMidiHitsChecked`: pending Roll/workflow и общая actor queue исключают гонку fallback/MIDI/повторное расходование. Checked flag снимается при ошибке. `#affordableSources(actor,sources)` повторно проверяет живые effects и резервирует доступный бюджет общих itemUses перед evaluation; неоплаченная кость не входит в Roll. Async `#applyCheckedAttackRollToWorkflow(workflow)` переносит завершённый fallback в MIDI; `#refreshAttackDisplay(workflow)` вызывает native `setAttackRoll` и `displayAttackRoll`, обновляя MIDI persisted flag и cached HTML без нового броска.
- `PerformerAutomationService.applyNativeBuildPost(rolls,config={},message={})` выбирает skill/tool/ability/save/attack и исключает death saves; `applyDnd5eD20Roll(rolls,context={},kind="")` дедуплицирует Roll и сериализует решения по Actor в общей очереди с атаками. `#applyD20Bonuses(roll,context,kind)` предлагает доступные `#d20BonusEffects(actor)` последовательно; local `available()` заново проверяет membership и expiry после prompt/evaluate. Add attack делегируется boost owner, hostile subtract остаётся автоматическим. Effect удаляется после evaluation, до изменения Roll; отказ в удалении не даёт бонуса, исчезнувшая кость оставляет обычный бросок завершаемым. Отклонённые эффекты сохраняются.
- `CurseUpgradeAutomationService.registerNativeSaveWrapper(beforePost=null)`: одна native D20Roll.buildPost-граница; callback из main ожидает performer/attack, затем curse saves определяют outcome, затем оригинальный buildPost публикует финальный результат. No-argument API сохраняется.
- `scripts/combat/hooks.js`: preUse/preActivityConsumption/postUse и прежние fallback hooks. `scripts/main.js`: создание services, command registration и callback composition; повторных владельцев нет.

## Профильные проверки

`tests/bardic-inspiration-compat-service.test.mjs`, `tests/bardic-inspiration-command.test.mjs`, `tests/attack-roll-boost-service.test.mjs`, `tests/performer-automation-service.test.mjs`, `tests/d20-bonus-native.test.mjs`, `tests/d20-bonus-roll.test.mjs`, `tests/curse-upgrade-hooks.test.mjs`.

Покрывают source/activities, уровни и authored scale, pre-use rejection, duration/expiry, одноразовую native consumption/receipt, drum restore, OWNER/GM/token spoofing и synthetic targets; delayed fallback/MIDI accept/decline, evaluation/deletion failure, общий ограниченный бюджет, concurrent rolls, совмещение/отказ эффектов, serialized terms и native ordering до curse/save/message.
