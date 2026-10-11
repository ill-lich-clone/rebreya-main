# Перевязка ран Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить доступную игрокам перевязку с расходом целого личного/группового комплекта, четырьмя исходами проверки в чате, эффектом иммунитета и однократным продолжением лечения.

**Architecture:** Один application-сервис владеет процедурой и использует существующие privileged gateway, world coordinator и inventory mutation journal. Чистые правила отделены от установленного dnd5e и Foundry Documents. UI и managed macro вызывают публичный API и никогда не мутируют инвентарь или пациента напрямую.

**Tech Stack:** Foundry VTT 13, установленный dnd5e 5.2.5, native ESM, DialogV2, ActiveEffect, Node test runner; без новых зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-11-treat-wounds-design.md` с уточнениями пользователя о групповом комплекте, любых HP, эффекте иммунитета, продолжении после успеха и обязательной публикации любой проверки.

## Global Constraints

- Только `lich_branch`; никаких чужих изменений, force push или staging всего дерева.
- Целый неиспользованный комплект из личного либо доступного группового инвентаря: расход ровно 1 штуки, сохранение остального стака.
- Уровень персонажа / ПО NPC 1:1; Сл 10/15/20/25, пороги 5/11/17, бонусы 0/10/30/50.
- Исходы >=5: 4d8; >=0: 2d8; >-5: без эффекта; <=-5: 1d8 чистого колющего урона. Бонус только к лечению.
- Любые текущие HP живой цели допустимы. При успехе сброс только death failures.
- Продолжение: ещё 50 минут, добавление исходного сохранённого лечения один раз, без нового броска/комплекта.
- Native иммунитет 3600 секунд от начала; мировое время двигает Мастер. Повторный старт проверяет фактический срок, а не наличие неубранного документа.
- Каждый выполненный бросок виден в чате при любом исходе, включая ошибку последующего применения. Отмена до броска не публикует вымышленного результата.
- Сохранить существующие contracts и макросы. Версия 1.4.371 повышается вместе с forwarder/esmodules. Обновить паспорт функций и README.

## Review Focus

- Групповой инвентарь: выполнение на GM не должно подменять права исходного игрока правами GM; проверять sender и membership.
- Неизвестный uses либо частично использованный комплект: не расходовать подходящий по имени предмет без доказанной пригодности.
- Двойной клик, два лекаря и потеря socket ack: не повторять бросок/расход/лечение; новый старт не обходится конкурирующим request ID.
- Истёкший эффект и старая карточка: не блокировать новую перевязку истёкшим эффектом, не продолжать старую после нового старта.
- Ошибка после броска или Document write: результат остаётся в чате; recovery не перебрасывает кости и не затирает последующие изменения HP/quantity.

---

### Task 1: Чистые правила и dnd5e boundary

**Files:** Create `scripts/application/treat-wounds-rules.js`, `scripts/integrations/treat-wounds-dnd5e-adapter.js`, `tests/treat-wounds-rules.test.mjs`, `tests/treat-wounds-dnd5e-adapter.test.mjs`.

**Interfaces:**
- `getTreatWoundsTiers(level) -> [{dc,bonus}]`.
- `resolveTreatWoundsOutcome({total,dc,bonus}) -> {kind,formula,bonus,canContinue}`; kind `critical-success|success|failure|critical-failure`.
- `TreatWoundsDnd5eAdapter` exposes `level(actor)`, `isLiving(actor)`, `hasMedicineProficiency(actor)`, `kitState(item) -> {eligible,quantity,reason}`, `rollMedicine(actor,{dc}) -> Promise<Roll|null>`, `rollResult(outcome) -> Promise<Roll|null>`, `applyResult(actor,{kind,amount,operationId})`.

- [ ] Inspect narrow installed dnd5e 5.2.5 source ranges for level/CR, skill roll config and return, uses/spent, death failures, applyDamage and pure damage semantics; inspect existing module damage/roll adapters. Record evidence in spec. Resolve assumptions against actual code before implementation.
- [ ] Write failing rules tests: levels 4/5/10/11/16/17 and CR 0.5; totals dc+5/dc/dc-1/dc-4/dc-5; selected lower tier and custom DC preserve bonus; no natural-1/20 override.
- [ ] Write failing adapter tests: owned Medicine/expertise vs half-proficiency; full/zero HP permitted; dead/undead/construct rejected; kit whole/part-used/quantity 0/unknown uses; apply healing capped and clear failures only; 1d8 damage does not use tier bonus or ordinary piercing resistance.
- [ ] Run `node --test tests/treat-wounds-rules.test.mjs tests/treat-wounds-dnd5e-adapter.test.mjs`; confirm genuine failures before implementing.
- [ ] Implement the defined signatures against verified installed public APIs; gate unsupported system before dnd5e accesses. Roll adapter returns native rolls without uncontrolled duplicate publication.
- [ ] Rerun focused tests and review against spec; update passport for these methods.

### Task 2: Authoritative procedure, inventory debit and continuation

**Files:** Create `scripts/application/treat-wounds-service.js`, `scripts/infrastructure/foundry/treat-wounds-command-contract.js`, `tests/treat-wounds-service.test.mjs`, `tests/treat-wounds-socket.test.mjs`; modify `scripts/data/inventory-service.js` only at existing queue/debit owner.

**Interfaces:**
- `TreatWoundsService({journal,coordinator,inventoryService,adapter,documents,publish,gameProvider})` methods `preview({sourceTokenUuid,targetTokenUuid},context)`, `start({operationId,sourceTokenUuid,targetTokenUuid,kitItemUuid,groupActorId,tierDc,customDc},context)`, `continue({operationId},context)`, `resume({operationId},context)`; continuation addresses the original operation ID.
- `InventoryService.consumeTreatWoundsKitOnce({operationId,sourceActorUuid,kitItemUuid,groupActorId},context)` validates authenticated sender, real source, whole kit and exact one-unit debit; personal debit shares the same guarded owner; group access uses canonical group context policy, not current GM's `.isOwner`.
- `isValidTreatWoundsPayload(action,payload)` checks exact keys, supported action, bounded identifiers, numeric finite DC; `authorizeTreatWoundsSender(action,context)` authenticates user and restricts custom DC to GM. No client roll totals or HP deltas accepted.

- [ ] Inspect canonical group-context permissions, inventory mutation queue/debit receipt and durable journal API through passport/narrow source; use their existing canonical imports and locking order.
- [ ] Write failing service/socket tests: every Review Focus case above, repeat ID with changed fingerprint, simultaneous patients using last kit, simultaneous doctors treating same patient, caller ownership, forged group/kit, no active GM, no target means self through validated selection, unauthorized continuation, continuation of failure and continuation after new start.
- [ ] Pin exact durable behavior: saved native Medicine roll and result roll; publication attempted before effect/HP application; cancelled roll causes no debit/effect; every completed attempt includes debit and 3600-second effect even for ordinary failure. Failed publication preserves the saved result and is retryable without reroll.
- [ ] Pin first heal19 then continuation19 => total38 with current HP cap; saved +10 bonus doubles as part of19; repeated continuation adds0, consumes0, rolls0. Only original sender with live source ownership or GM can continue. Do not delete/reset immunity for continuation.
- [ ] Pin error-after-write recovery: explicit phase/receipt readback prevents repeated deletion, quantity decrement and HP write; ambiguous state returns manual-review, not silent success. Completion of one phase preserves a failed later phase and visible roll.
- [ ] Run `node --test tests/treat-wounds-service.test.mjs tests/treat-wounds-socket.test.mjs` and confirm failures.
- [ ] Implement short authoritative queue sections with no UI wait inside; journal keys `treat-wounds:<operationId>`, stored fingerprint/source/target/kit, roll serialization, phase receipts and continuation receipt. Reserve/check active target operation before rolling; immutable prepared HP/quantity writes compare observed state, refuse conflicting recovery.
- [ ] Create patient ActiveEffect with marker `flags.rebreya-main.treatWounds`, operationId, startTime and duration.seconds=3600. Before new start inspect marked effect expiry; remove only prior expired managed effects through guarded mutation. Use persisted latest procedure identity to invalidate old continuation independently of effect cleanup.
- [ ] Rerun focused tests; update passport. No general inventory refactor.

### Task 3: Foundry dialog, all-outcome chat and managed macro

**Files:** Create `scripts/ui/treat-wounds-dialog.js`, `tests/treat-wounds-dialog.test.mjs`; modify `scripts/main.js`, `scripts/combat/grapple-macro-service.js`, `tests/grapple-macro-service.test.mjs`, `tests/main-composition-root.test.mjs`.

**Interfaces:**
- `resolveTreatWoundsSelection(options) -> {sourceTokenUuid,targetTokenUuid}`.
- `promptTreatWounds(preview) -> Promise<{kitItemUuid,groupActorId,tierDc,customDc}|false>` and `promptTreatWoundsContinuation(record) -> Promise<boolean>` use DialogV2, rejectClose:false, explicit cancellation.
- `buildTreatWoundsChatContent(record) -> string`; `bindTreatWoundsChat(message,html,moduleApi)` binds one safe continuation handler per card rendering.
- Composition API `treatWounds(options={})`, `requestTreatWoundsAction(action,payload)`, `publishTreatWoundsOperation(record)`; all commands registered through existing privileged gateway. Public API/module alias preserve existing object.
- `buildTreatWoundsMacroData(folderId,options={})` adds one managed macro with sourceId `treat-wounds-macro`, command `await game.rebreyaMain?.treatWounds?.();`.

- [ ] Write failing dialog/composition tests: escaped labels; cancel/close no command; tier choices per healer; GM-only custom DC; personal/group kit selection; zero/multiple selected tokens/targets validation; duplicate dialog invocation; all four outcomes in chat; native actor/token speaker; result visible on mutation error; success-only continuation button and one handler after rerender.
- [ ] Extend existing macro tests to expect five managed macros, idempotent repair and unmanaged same-name preservation; update only counts tied to this deliberate addition.
- [ ] Run `node --test tests/treat-wounds-dialog.test.mjs tests/grapple-macro-service.test.mjs tests/main-composition-root.test.mjs` and confirm failures.
- [ ] Implement interfaces. Publisher is active-GM owned, uses one operation-marked ChatMessage with serialized Rolls and native speaker. Repeated publish updates existing card; never performs procedure mutations. Chat continuation calls gateway, disables during await, and confirms 50 minutes in Foundry dialog.
- [ ] Wire initialization to existing managed sync and one chat render hook; preserve all old macro/public API routes. Keep local pending request on timeout to prevent retry with new ID.
- [ ] Rerun focused tests and review spec coverage; document API and function passport in Task 4.

### Task 4: Release, documentation and final verification

**Files:** Modify `module.json`, `README.md`, `docs/function-passport.md`; create focused `docs/treat-wounds-function-passport.md` if needed; rename `scripts/main-1.4.371.js` to `scripts/main-1.4.372.js` if version remains current. Modify these spec/plan documents with confirmed evidence.

- [ ] Recheck current manifest version; bump once from actual current version, update esmodules and import-only forwarder; verify no old entrypoint in runtime manifest. Runtime imports must obey existing cache-busting contracts.
- [ ] Update README macro/API and passport signatures, owners, lifecycle, four outcomes, group source, time accounting, continuation, tests and recovery constraints.
- [ ] Run full `node --test tests/*.test.mjs` once; report passed/failed counts and actual failures. Run `node --check` for tracked JS/MJS, parse tracked JSON, `git diff --check`; rerun affected checks only after corrective edits.
- [ ] Live-check exact Foundry/system build through an existing authenticated world binding: GM/player, self/other patient, full/zero HP, all four outcome cards, group kit debit, continuation once, custom DC permission, reload, expired effect. Use fixture Actors/Items and preserve original world state; never infer compatibility from unit tests. Report unavailable live coverage explicitly.
- [ ] Review scoped diff against spec, including preserved quantity rules and formulas; `git diff --stat` and substantive diff. Fresh independent review via Gemini if its read-only command permission is available; otherwise locally review and report that limitation.
- [ ] Stage only task files, commit meaningful feature change, `git push -u origin lich_branch` without force; report commit, version, tests, limitations, spec and plan paths.

## Execution handoff

Рекомендуется исполнение `executing-plans` в текущей сессии: задачи связаны общим журналом, inventory owner и API; дробление между отдельными implementer-контекстами не нужно. Перед product-правками требуется согласование этого письменного плана согласно AGENTS.md и Superpowers.
