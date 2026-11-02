# «Щит»: world Item и очередь реакций

## Основной источник: компендиум Ребреи

Штатная синхронизация активного GM в `SpellsCompendiumService.sync()` использует запись `{id:"shield-rebreya",sourceIdentifier:"shield"}` и системный пакет `dnd5e.spells` (SRD 2014). `normalizedSourceDefinition(entry)` принимает точный маршрут Shield. `buildManagedSpellEntry(definition,source,options)` сохраняет существующий `spellId` и подписывает в том числе effects и img. Канонический сверщик обновляет ранее созданную карточку в `world.rebreya-spells` по этому ID, сохраняет её UUID и удаляет корневые флаги прежних исполнителей CPR/CAT. Штатные запуск и `reloadData()` сначала синхронизируют заклинания, затем использующие их магические предметы.

## Карточка и GM import

- `buildShieldSpellItem(sourceData,{description=""}={})` из `scripts/data/shield-spell-item.js` находит связанную utility activity и эффект +5 КД в исходной SRD-карточке. Копирует действие, embedded IDs, формулы, ресурсы, источник с лицензией и описание. Активирует эффект, маркирует его и карточку флагом `rebreya-main.shieldReaction.version = 1`. Условия MIDI допускают полезное попадание или урон Magic Missile. В v14 срок задаёт нативный `targetStart`, в v13 `expireV13ShieldAtTurnStart(actor)` удаляет только такие эффекты входящего в ход Actor по прямому `combatTurnChange` на активном GM.
- `isManagedShield(item)` распознаёт маркер на заклинании. `hasShieldEffect(actor)` проверяет действующий эффект с маркером Rebreya, соблюдая disabled/suppressed/expired, и распознаёт ранее применённые эффекты с идентификаторами CPR/CAT.
- `ensureWorldShieldSpell({game,coordinator,resolveUuid,itemClass}) -> Promise<Item>` сохраняет GM API `importShieldSpell()`. При отсутствии ранее созданного отмеченного мирового Item разрешает `Compendium.dnd5e.spells.Item.z1mx84ONwkXKUZd7`. Существующий мировой Item сохраняет внесённые GM изменения. Синхронизация компендиума не заменяет карточки на листах персонажей.

Карточка использует установленный SRD 2014 системы dnd5e. System Reference Document 5.1, Wizards of the Coast LLC, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Исходное описание и метаданные берутся из системы при синхронизации. [Исходник Shield в dnd5e 6.0.6](https://github.com/foundryvtt/dnd5e/blob/release-6.0.6/packs/_source/spells/1st-level/shield.yml)

Профильные проверки находятся в `tests/spells-compendium.test.mjs`, `tests/shield-spell-item.test.mjs` и `tests/shield-reaction-hooks.test.mjs`.

## Обычные атаки

Владелец — `MidiReactionAdapter` в `scripts/integrations/midi-reaction-adapter.js`:

- `getShieldAttackContext(workflow,target) -> Promise<context|null>` берёт точный Token/Actor, текущие AC/cover/descriptor modifiers и уже evaluated numeric grants; создаёт сериализуемый snapshot. Для Active Defence берёт готовый `rollResults` по индексу точного Token среди targets с Actor и сравнивает defence total + 5 с `activeDefenceDC`, сохраняя native critical thresholds. Версионная граница — установленный MIDI 13.0.61. Повторного броска бонусных костей нет.
- `canOfferShield(activity,context) -> Promise<boolean>` проверяет marker, native preparation/usage availability, общий reaction ledger, существующий effect и полезность +5 для некритического/non-fumble hit. Изменение текущей базовой КД учитывается относительно snapshot; `magicMissile` допускает отдельный CPR повод без AC-сравнения.
- `filterReactions(reactions,options,triggerType,reactionActivityList) -> Promise<void>` удаляет только непригодные marked activities из обоих native списков; source `options.workflow` формирует `options.rebreyaShieldReaction[tokenUuid]`. При нескольких Token одного Actor snapshots остаются независимыми. Authored reaction conditions сохраняются, включая при MIDI ignore-restrictions setting.
- `choose(data)` проверяет snapshot ровно `data.tokenUuid` до общей карточки/очереди. `attachDialog(dialog)` повторяет проверку выбранного marked Shield до commit/native callback. Остальные native реакции и optional AC formulas/count остаются прежними.
- `initialize()` подключает optional CPR adapter и сохраняет прежний idempotent native socket wrapper. Единственный `midi-qol.ReactionFilter` зарегистрирован в `registerCombatHooks()`; vendor files и глобальные settings не меняются.

Data flow: source MIDI hit → ReactionFilter/snapshot → exact Token native choose → shared managed session → original native use → native effect/slots → existing ledger sync. При КД 10 только итоги 10–14 предлагают «Щит»; равенство новой КД сохраняет попадание.

Focused tests: `tests/midi-reaction-adapter.test.mjs`, `tests/shield-reaction-hooks.test.mjs`; соседние contracts — `tests/managed-reaction-session.test.mjs`, `tests/reaction-chat-lifecycle.test.mjs`.

## Волшебная стрела SRD

Для spell с точным `system.identifier === "magic-missile"` штатная фаза MIDI `reactiondamage` входит в тот же `filterReactions` и точный Token snapshot. `choose()` повторно проверяет ресурс, реакцию и активный «Щит» перед передачей в штатный диалог. Число стрел, броски и адресатов определяет вызывающая activity. Для старых карточек `isShieldReactionItem(item)` также распознаёт CPR identifier shield. `prepareMagicMissileReactions(workflow)` дополняет стандартное условие их подготовленной activity до выбора MIDI, сохраняя авторские условия и данные на диске. Когда карточка распределяет несколько стрел, флаг `workflowOptions.rebreyaMissileShieldPrompt` разрешает окно только на первой стреле каждой цели. Метод `MidiReactionAdapter.applyMagicMissileShield(actor,damages,options)` вызывается из `dnd5e.calculateDamage`, сопоставляет системную карточку урона через `originatingMessage` или `options.midi.itemCardUuid` и обнуляет урон только для владельца действующего эффекта до записи HP. Ручная передача числового урона без источника сохраняется.

## Совместимость с ранее установленным CPR Magic Missile

`CprShieldReactionAdapter` в `scripts/integrations/cpr-shield-reaction-adapter.js` — optional compatibility boundary CPR 1.5.44 / MIDI 13.0.61:

- `initialize() -> boolean` оборачивает публичные `chrisPremades.DialogApp.dialog`, prototype render, `chrisPremades.utils.dialogUtils.selectDocumentDialog` и `MidiQOL.completeItemUse` один раз. Только для exact Shield content source selector получает UUID-backed views без `id`: исходный CPR переключается в собственный UUID-режим и возвращает настоящий Item через `fromUuid`. Поэтому world и synthetic Actor с одинаковыми embedded IDs остаются различимы через socket. Отсутствующий CPR — no-op, несовместимый установленный API — явная ошибка.
- `actors()` перечисляет world/synthetic Actors только для точного CPR Shield dialog; `routeDialog(args,receiver) -> Promise<nativeSelection>` проверяет content key `CHRISPREMADES.Macros.MagicMissile.Shield` и полные Item UUID в button names, требует единственного marked Actor, сериализует пересекающиеся CPR запросы одного Actor. Legacy ID-only dialog поддерживается только при однозначности Actor.
- `routeOwnedDialog(args,receiver,actor,items,release)` проводит original выбор на owner через существующий `resolveManagedReaction(kind:"midi-native")`. Native selection возвращается CPR лишь после coordinator commit; pending permission живёт до native use, а abort закрывает только связанные окна. Если параллельный workflow уже применил Shield, native selection shape обеспечивает штатную повторную проверку CPR без второго расхода.
- `routeItemUse(args,receiver) -> Promise<nativeResult>` удерживает shared session до конца original completeItemUse, дедуплицирует одновременный exact-item handoff, возвращает original result/ошибку. Успех очереди требует реально активного Shield effect. Уже защищённая managed копия не кастуется повторно; чужие Item/use и CPR dialogs делегируются без изменения.
- `pending`/`sessions`/`actorRuns` — transient bounded состояние (до 128 Actor handoffs); завершение удаляет pending entry. `log(error)` сообщает только compatibility/операционные ошибки.

CPR продолжает владеть распределением ненулевых стрел, identifier `shield` и обнулением их урона. Сам адаптер не наносит урон, не пишет HP и не списывает slots/реакцию повторно.

Focused tests: `tests/cpr-shield-reaction-adapter.test.mjs`.
