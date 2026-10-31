# Bardic Inspiration and Roll Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Автоматизировать подтверждённое вдохновение Laaru и устранить гонку/несохранённый результат общего доброса.

**Architecture:** Сохранить BardicInspirationCompatService владельцем адаптации Laaru, AttackRollBoostService владельцем атак и PerformerAutomationService владельцем generic d20Bonus. На существующей ожидаемой D20Roll.buildPost-границе выполнять добровольные бонусы до публикации результата; для MIDI атак положительный доброс остаётся на hitsChecked. Выдача чужому Actor проходит через typed active-GM command.

**Tech Stack:** Foundry 13, установленный dnd5e 5.2.5 / Laaru 3.99.0, vanilla ESM, Node test runner; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-31-bardic-inspiration-and-roll-boost-design.md` (утверждена).

## Global Constraints

- Только lich_branch; сохранить чужие изменения; task-only commit и push origin lich_branch после проверок.
- Не менять Laaru files/compendium, settings, authored formulas, uses/recovery, subclass consumption и барабан.
- Сохранить repairable-miss/fumble policy атак, кости/штрафы/блокировку «Исполнителя», оружие/ammo/misfire и curse-save outcomes.
- d20Bonus разных источников разрешены совместно; одна bardic die на 600 секунд; d6/d8/d10/d12 на уровнях 1/5/10/15 с приоритетом scale барда.
- Новая автоматизация исключает damage, initiative/death saves и произвольные Roll.
- Перед product edits нужны воспроизводимые failing regressions; не ослаблять старые assertions.
- Runtime changes требуют новой версии, forwarder и esmodules, README и function passport.

## Review Focus

- Повторный event/reconnect после уже потраченной кости не выдаёт её заново: grant receipt и повтор postUse проверяются в Task 3.
- Linked/unlinked Token с одним base Actor не подменяют цель: exact UUID tests в Task 3.
- Пустые/несуществующие scale и авторская формула не дают NaN/неожиданный размер: scale priority/fallback tests в Task 3.
- Нативный бросок без сообщения и повторная инициализация не пропускают/дублируют решение: Task 2.
- Выбор bonus одновременно с curse-save decision сохраняет скорректированный результат до определения save outcome: Task 2.

---

### Task 1: Ожидание операции доброса и сериализуемый Roll

**Files:** Modify `scripts/combat/attack-roll-boost-service.js`; create `scripts/combat/d20-bonus-roll.js` только для реально общей записи бонуса двух сервисов; tests `tests/attack-roll-boost-service.test.mjs`, `tests/d20-bonus-roll.test.mjs`; паспорт combat section.

**Interfaces:** Existing `applyMidiHitsChecked(workflow,options={}) -> Promise<true>`, `applyDnd5eRollAttack(rolls,context={}) -> Promise<true>` preserved. Shared `appendD20Bonus(roll,bonusRoll,{sign=1}={}) -> void` appends evaluated serializable terms without replacing original d20; `isAvailableD20BonusEffect(effect,worldTime) -> boolean` excludes disabled/transfer/expired effects and is shared by both consumers.

- [x] Add failing `MIDI waits for pending fallback on same Roll`: start fallback without await, wait until prompt opens, start MIDI, assert it remains pending; resolve selected d4=4; assert MIDI total=19 vs AC18, hit=true, one prompt and one effect deletion. Decline counterpart retains total15/effect and no second prompt.
- [x] Add failing serialization regression: original d20/results/advantage retained; saved and restored formula/terms/total include the selected bonus. Failed bonus roll does not delete effect or spend item uses.
- [x] Run `node --test tests/attack-roll-boost-service.test.mjs tests/d20-bonus-roll.test.mjs` and inspect failures for specified causes.
- [x] Keep an in-flight Promise keyed by Roll; MIDI awaits it before reconciling. Distinguish pending/completed/failed operations; errors release transient state without an applied marker. Evaluate before consuming; append terms and totals using Foundry Roll term classes rather than only `_total`.
- [x] Re-run focused tests, retaining all existing source selection/combined dice/scale/uses/fumble assertions. Record changed methods in passport with the implementation.

### Task 2: Expected native d20 boundary and generic effect choice

**Files:** Modify `scripts/combat/performer-automation-service.js`, `scripts/combat/attack-roll-boost-service.js`, `scripts/combat/curse-upgrade-automation-service.js`, `scripts/combat/hooks.js`, `scripts/main.js`; tests `tests/performer-automation-service.test.mjs`, `tests/curse-upgrade-hooks.test.mjs`, new `tests/d20-bonus-native.test.mjs`; related passports.

**Interfaces:** `AttackRollBoostService.applyNativeBuildPost(rolls,config={},message={}) -> Promise<true>` suppresses late fallback for config.workflow MIDI attacks, handles standalone attack before chat. `PerformerAutomationService.applyNativeBuildPost(rolls,config={},message={}) -> Promise<true>` handles skill/tool/ability/save and existing subtract attack. Existing `applyDnd5eD20Roll` remains compatible and deduplicates already handled rolls. `registerNativeSaveWrapper(beforePost=null)` preserves no-argument behavior; optional awaited callback executes before `saves.applyNativeBuildPost`, followed by original buildPost.

- [x] Failing tests: delayed skill/save prompt blocks original buildPost; final message/return total include bonus; no duplicate late hooks; no-message rolls still resolve; repeated initialization wraps once. Excluded roll kinds do not consume bardic die.
- [x] Failing coexistence tests: performer+bardic effects can each be selected or declined and jointly used; generic effect duration expires; legacy performer metadata and hostile subtract still work. Curse save sees boosted total before its own decision and retains its explicit forced outcome.
- [x] Run `node --test tests/performer-automation-service.test.mjs tests/d20-bonus-native.test.mjs tests/curse-upgrade-hooks.test.mjs` to confirm intended failures.
- [x] Integrate through existing native wrapper with callback composed in main; pass actual config.workflow to avoid identifying MIDI only from Roll.options. Remove duplicate late mutation paths or make them completed-roll no-ops. Use Task 1 helpers and processing guard for exactly one decision per Roll.
- [x] Preserve promptD20Bonus injection signature for existing tests; present one decision per applicable effect for ordinary tests, leaving nonselected effects intact. Re-run affected suites and update function passports.

### Task 3: Laaru grant, restrictions and authorized GM mutation

**Files:** Modify `scripts/combat/bardic-inspiration-compat-service.js`, `scripts/combat/hooks.js`, `scripts/main.js`; create `scripts/infrastructure/foundry/bardic-inspiration-command.js`; tests `tests/bardic-inspiration-compat-service.test.mjs`, new `tests/bardic-inspiration-command.test.mjs`; README and combat/socket passports.

**Interfaces:** Extend service with `applyDnd5ePreUseActivity(activity,usageConfig={}) -> boolean`, existing `applyDnd5ePostUseActivity(...) -> Promise<true>`, `grantInspiration(payload,context={}) -> Promise<object>`. Export `registerBardicInspirationCommand(commandBus,service)` for typed command `bardic.inspiration.grant`. Payload has bounded operationId, sourceItemUuid, activityId, targetActorUuid, sourceTokenUuid/targetTokenUuid (optional); validator accepts exact keys/UUID types, authority re-resolves and checks sender ownership. No formula/amount from client.

- [x] Failing tests for exact modern/legacy Laaru identity and source-defined grant activity vs roll-only activity; unrelated same-name Item ignored. Existing drum restore tests remain unchanged.
- [x] Failing tests: scale priority and missing-scale levels1/5/10/15 ->1d6/1d8/1d10/1d12; duration600; self/missing target rejected; existing bardic die blocks before consumption; performer effect survives; expired bardic effect replaceable; roll-only activity never grants/spends extra.
- [x] Failing command tests: GM/direct and player request share authority; OWNER source required; spoofed source/activity/token/target rejected; linked/unlinked Actor selection exact; distance>60 rejected with common scene; explicit Actor without common geometry allowed with manual-conditions notice; repeated operation/postUse after effect consumed never regrants.
- [x] Run `node --test tests/bardic-inspiration-compat-service.test.mjs tests/bardic-inspiration-command.test.mjs` and confirm intended failures.
- [x] Grant a nontransfer ActiveEffect with `flags.rebreya-main.d20Bonus` plus bardic kind/source/operation metadata. Resolve die formula against source bard, freezing its value for recipient. Native activity remains sole resource consumer; issue request after native successful use, validate target before use; keep bounded persisted grant receipt on source Item for replay protection, following existing mutation coordinator policy.
- [x] Register one typed command with source/target document scheduling, connect existing pre/postUse hooks, and preserve exact source Item formulas/activities/recovery. If activity metadata must be adapted on owned copies, patch only the exact recognized grant activity and test preservation of the separate roll activity and authored settings.
- [x] Re-run Tasks1–3 focused suites; update README/public behavior and every modified function's current passport.

### Task 4: Version, live verification, complete review and Git delivery

**Files:** Modify `module.json`, replace `scripts/main-1.5.40.js` with versioned forwarder for next free version (recheck branch first), relevant manifest expectations, spec/plan status.

- [x] Increment module version consistently and assert esmodules points to existing forwarder importing only `./main.js`; no runtime references to old forwarder.
- [x] Execute focused native/grant/MIDI cases in available real Foundry session on disposable test documents and clean up created fixtures. Verify exact runtime versions, GM/player boundaries, reload, single registration, preserved drum/performer/resource behavior. Report unavailable live checks explicitly.
- [x] Run full `node --test tests/*.test.mjs` once, summarize passed/failed; run tracked JS/MJS `node --check`, tracked JSON parsing, and `git diff --check`. If an affected check fails, fix and rerun that check; no unnecessary full repeats.
- [x] Request whole-change review with spec and diff; resolve material findings and rerun affected checks. Do not merge/push with unmet spec requirements.
- [x] Inspect `git diff --stat` and substantive diff; stage only task files (including spec/plan/passports), commit meaningful message, `git push -u origin lich_branch`. Report commit, version, test counts, live evidence/limits and spec/plan paths.

## Plan self-review

Spec requirements map to Task1 (race/serialized attack), Task2 (native timing/generic effects), Task3 (grant/contracts/authority), Task4 (release/live/Git). Interface names and helper ownership match across tasks. Review Focus cases have explicit failing tests. No external package, new UI app, global resource migration or changed spell/subclass behavior is planned.


Execution evidence and review rulings: [task report](../reports/2026-10-31-bardic-inspiration-and-roll-boost.md). Final full suite: 5429 passed, 0 failed, 1 skipped; real native grant/skill/save/MIDI card19 verified; QA fixtures removed.
