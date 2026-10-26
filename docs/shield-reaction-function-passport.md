# «Щит»: world Item и очередь реакций

## Владельцы и контракты

`scripts/data/shield-spell-item.js` владеет исходной мировой копией:

- `isManagedShield(item) -> boolean` распознаёт spell по `flags.rebreya-main.shieldReaction.version === 1`, независимо от имени.
- `hasShieldEffect(actor) -> boolean` проверяет неотключённый/неподавленный/неистёкший effect с CPR identifier `shield` либо module marker.
- `buildShieldSpellItem(sourceData,{description=""}={}) -> ItemData` проверяет source Shield/+5 effect references, глубоко копирует весь source, удаляет root `_id`/folder, добавляет имя/marker и только недостающее описание. Embedded IDs и references, resources/scaling/formulas, source metadata и flags сохраняются.
- `ensureWorldShieldSpell({game,coordinator,resolveUuid,itemClass}) -> Promise<Item>` разрешает только active GM и сериализует поиск/create через coordinator key `shield-world-item`. Источник — CPRSpells `RpVLINL74RjPDkC4`, description fallback — dnd5e.spells `z1mx84ONwkXKUZd7`. Существующий marked Item возвращается без update; нет startup миграции всех Actor.
- Composition `importShieldSpell() -> Promise<Item>` в `scripts/main.js` внедряет game/coordinator/fromUuid/Item; публикуется обычным runtime API `game.rebreyaMain` и module API. Это GM API, не player command.

Focused tests: `tests/shield-spell-item.test.mjs`.

## Обычные атаки

Владелец — `MidiReactionAdapter` в `scripts/integrations/midi-reaction-adapter.js`:

- `getShieldAttackContext(workflow,target) -> Promise<context|null>` берёт точный Token/Actor, текущие AC/cover/descriptor modifiers и уже evaluated numeric grants; создаёт сериализуемый snapshot. Для Active Defence берёт готовый `rollResults` по индексу точного Token среди targets с Actor и сравнивает defence total + 5 с `activeDefenceDC`, сохраняя native critical thresholds. Версионная граница — установленный MIDI 13.0.61. Повторного броска бонусных костей нет.
- `canOfferShield(activity,context) -> Promise<boolean>` проверяет marker, native preparation/usage availability, общий reaction ledger, существующий effect и полезность +5 для некритического/non-fumble hit. Изменение текущей базовой КД учитывается относительно snapshot; `magicMissile` допускает отдельный CPR повод без AC-сравнения.
- `filterReactions(reactions,options,triggerType,reactionActivityList) -> Promise<void>` удаляет только непригодные marked activities из обоих native списков; source `options.workflow` формирует `options.rebreyaShieldReaction[tokenUuid]`. При нескольких Token одного Actor snapshots остаются независимыми. Authored reaction conditions сохраняются, включая при MIDI ignore-restrictions setting.
- `choose(data)` проверяет snapshot ровно `data.tokenUuid` до общей карточки/очереди. `attachDialog(dialog)` повторяет проверку выбранного marked Shield до commit/native callback. Остальные native реакции и optional AC formulas/count остаются прежними.
- `initialize()` подключает optional CPR adapter и сохраняет прежний idempotent native socket wrapper. Единственный `midi-qol.ReactionFilter` зарегистрирован в `registerCombatHooks()`; vendor files и глобальные settings не меняются.

Data flow: source MIDI hit → ReactionFilter/snapshot → exact Token native choose → shared managed session → original native use → native effect/slots → existing ledger sync. При КД 10 только итоги 10–14 предлагают «Щит»; равенство новой КД сохраняет попадание.

Focused tests: `tests/midi-reaction-adapter.test.mjs`, `tests/shield-reaction-hooks.test.mjs`; соседние contracts — `tests/managed-reaction-session.test.mjs`, `tests/reaction-chat-lifecycle.test.mjs`.

## CPR Magic Missile

`CprShieldReactionAdapter` в `scripts/integrations/cpr-shield-reaction-adapter.js` — optional compatibility boundary CPR 1.5.44 / MIDI 13.0.61:

- `initialize() -> boolean` оборачивает публичные `chrisPremades.DialogApp.dialog`, prototype render, `chrisPremades.utils.dialogUtils.selectDocumentDialog` и `MidiQOL.completeItemUse` один раз. Только для exact Shield content source selector получает UUID-backed views без `id`: исходный CPR переключается в собственный UUID-режим и возвращает настоящий Item через `fromUuid`. Поэтому world и synthetic Actor с одинаковыми embedded IDs остаются различимы через socket. Отсутствующий CPR — no-op, несовместимый установленный API — явная ошибка.
- `actors()` перечисляет world/synthetic Actors только для точного CPR Shield dialog; `routeDialog(args,receiver) -> Promise<nativeSelection>` проверяет content key `CHRISPREMADES.Macros.MagicMissile.Shield` и полные Item UUID в button names, требует единственного marked Actor, сериализует пересекающиеся CPR запросы одного Actor. Legacy ID-only dialog поддерживается только при однозначности Actor.
- `routeOwnedDialog(args,receiver,actor,items,release)` проводит original выбор на owner через существующий `resolveManagedReaction(kind:"midi-native")`. Native selection возвращается CPR лишь после coordinator commit; pending permission живёт до native use, а abort закрывает только связанные окна. Если параллельный workflow уже применил Shield, native selection shape обеспечивает штатную повторную проверку CPR без второго расхода.
- `routeItemUse(args,receiver) -> Promise<nativeResult>` удерживает shared session до конца original completeItemUse, дедуплицирует одновременный exact-item handoff, возвращает original result/ошибку. Успех очереди требует реально активного Shield effect. Уже защищённая managed копия не кастуется повторно; чужие Item/use и CPR dialogs делегируются без изменения.
- `pending`/`sessions`/`actorRuns` — transient bounded состояние (до 128 Actor handoffs); завершение удаляет pending entry. `log(error)` сообщает только compatibility/операционные ошибки.

CPR продолжает владеть распределением ненулевых стрел, identifier `shield` и обнулением их урона. Сам адаптер не наносит урон, не пишет HP и не списывает slots/реакцию повторно.

Focused tests: `tests/cpr-shield-reaction-adapter.test.mjs`.
