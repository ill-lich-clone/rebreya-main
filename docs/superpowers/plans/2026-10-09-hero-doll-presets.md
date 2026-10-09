# Hero Doll Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Именованные комплекты куклы героя с механически пустыми, удаляемыми силуэтами отсутствующих предметов.

**Architecture:** HeroDollService остаётся владельцем куклы. Новые Actor flags heroDollPresets отделяют сохранённые комплекты и текущие силуэты от canonical heroDoll.slots. ItemInstanceWorkflow получает пакетный путь поверх существующих journal/coordinator, а ItemInstanceDocuments использует прежние field receipts для финального placement и компенсации.

**Tech Stack:** JavaScript ESM, Foundry 13/dnd5e, Handlebars, scoped CSS, Node test runner.

**Spec:** docs/superpowers/specs/2026-10-09-hero-doll-presets-design.md

## Global Constraints

- Все изменения только в lich_branch. Пользователь явно выбрал реализацию здесь самим Codex и поручил переходить к ней сразу после подготовки плана.
- Новых world settings, владельцев куклы, UI document writes и автоматического поиска по имени нет.
- heroDoll.slots содержит только {itemId}; руки куклы независимы от heldHands.
- Item quantity/индивидуальное состояние сохраняются; обычный legacy stack нормализуется существующим instance planner/driver, оригинальный ID остаётся у надетой единицы.
- Силуэты не занимают слот, не создают Item/effects/equipped и сохраняются в комплект только явным Save.
- Новые API/методы документируются; runtime changes требуют version bump и forwarder.

## Review Focus

1. Legacy stack в сохранённом комплекте: повторный Apply не выделяет новую надетую единицу с новым ID (Task 2).
2. Сбой после записи, но до journal checkpoint/finish: restart/retry не дублирует остатки и правильно проверяет receipts (Tasks 1–2).
3. Чужая правка touched field во время компенсации: manual-review сохраняет чужие данные и блокирует следующие операции (Tasks 1–2).
4. Два окна Actor и выбор другого имени без Apply: сохраняется явная семантика выбранного/применённого комплекта (Tasks 2–3).
5. HTML-подобное имя/сломанный img и rerender: escaped text, fallback image, корректная очистка listeners (Task 3).

## Task 1: Пакет экземпляров и placement receipts

**Files:** scripts/application/item-instance-workflow.js; scripts/infrastructure/foundry/item-instance-documents.js; tests/item-instance-batch.test.mjs.

**Interfaces:** ItemInstanceWorkflow.runBatch(intent,context) -> Promise<{operationId,...context value,replayed}>. intent содержит operationId, sourceActorUuid=destinationActorUuid, mode и payload owner-а. context.authorize(actors,intent), assertAuthority(), prepareBatch(actors,{id,fingerprint,intent}) -> {steps,value}; steps — обычные prepared instance records либо plan.kind="placement". Driver поддерживает verify/compensate placement без source Item.

- [x] Добавить integration tests поверх makeInstanceDocumentsFixture: batch placement changes equipped+actor fields; failure before/after equip/placement restores all touched fields; retry after terminal journal failure succeeds; conflict becomes manual-review and later mutations refuse pending record.
- [x] Запустить `node --test tests/item-instance-batch.test.mjs`; ожидать failures из-за отсутствующего runBatch.
- [x] Реализовать runBatch под inventory-organization:<actorId>, journal kind=item-instance-v1 и прежним sender/mode/operationId namespace; планировать все steps до writes. Выполнить create/debit/placement каждого step, затем verify всех receipts; компенсировать в обратном порядке. Проверить terminal retry, authority и fingerprint.
- [x] Расширить ItemInstanceDocuments только placement-only verify/compensate; сохранить остальные instance paths.
- [x] Запустить batch и существующие item-instance workflow/document tests; ожидать 0 failed.

## Task 2: Пресеты и силуэты в HeroDollService

**Files:** scripts/data/hero-doll-service.js; scripts/data/hero-doll-presets.js; scripts/main.js; tests/hero-doll-presets.test.mjs; existing hero-doll tests.

**Interfaces:** pure normalizeHeroDollPresets(raw), captureHeroDollPresetSlots(actor,dollState,presetState), heroDollPresetModified(actor,dollState,presetState) helpers. Flag schema {version:1,presets:[{id,name,slots}],activePresetId,ghosts:{slotId:{itemId,name,img}}}. Service selectPreset(actor,presetId) is presentation-only; createPreset(actor,name), savePreset(actor,presetId), renamePreset(actor,presetId,name), deletePreset(actor,presetId), applyPreset(actor,presetId), clearGhost(actor,slotId) submit typed operations. executePresetMutation(payload,{sender}) is authoritative. Main mutateHeroDollPreset(payload), command hero-doll.preset; payload exact per action with operationId, actorUuid, action and required presetId/name/slotId; apply includes expected preset fingerprint captured on submission.

- [x] Добавить regression tests: Actor isolation, CRUD/replay/ownership, empty/duplicate names, explicit save only, missing/sold Item fallback with occupied=false and zero writes on read, same-name Item not substituted, remove/reapply/save cycle, real assignment replacing ghost, changed marker.
- [x] Добавить apply tests: full empty slots, swapping singleton IDs, heldHands preservation, independent equipped untouched, actual compatibility/duplicates rejection, pending journal, stale preset, normalize ordinary legacy stack original ID with unequipped remainder, complex stack rejected, failure+restart without double split.
- [x] Запустить `node --test tests/hero-doll-presets.test.mjs`; ожидать failures из-за отсутствующих методов/силуэтов.
- [x] Реализовать pure projections/validators and service methods. Store missing metadata separately from slots. CRUD/clear-ghost use runBatch placement-only path, preserving unrelated flags. Apply prepares normalization steps via ItemInstanceDocuments.readSource/prepare and planItemInstanceMutation, then one final placement for slots/preset state/affected equipped fields; no per-slot recursive worker calls under the same lock.
- [x] В существующем prepareAssignment очистить заменённый силуэт в тех же receipts; ошибки оставляют его на месте. getActorSnapshot возвращает presets/selected/active/modified и ghost image/title без механической ссылки.
- [x] Зарегистрировать typed route/Main API с keyed scheduling и owner authorization повторно внутри workflow.
- [x] Запустить hero-doll focused tests и batch tests; ожидать 0 failed.

## Task 3: Интерфейс комплектов и отсутствующих вещей

**Files:** scripts/ui/hero-doll-presets-ui.js; scripts/integrations/dnd5e-sheet-extensions.js; templates/hero-doll-tab.hbs; styles/main.css; tests/hero-doll-presets-ui.test.mjs.

**Interfaces:** bindHeroDollPresetControls(panel,{actor,service,rerender,signal}) binds select and preset controls; handleHeroDollPresetAction(action,{actor,service,presetId,slotId,...}) uses DialogV2 for names/delete confirmation and service methods. Existing panel AbortController owns listeners. Existing slot context menu gains clear-ghost callback.

- [x] Добавить behavior tests for select without apply, CRUD/apply dispatch, cancelled dialog, escaped names, pending UI request prevents duplicate new intent, abort/rebind listeners and ghost image fallback. Render actual Handlebars template using existing installed/runtime dependency when available; assert ghost has no data-item-id/open action and controls render for owner.
- [x] Запустить UI tests; ожидать failures из-за отсутствующей реализации.
- [x] Реализовать compact toolbar: select, apply/save, управление через меню (new/rename/delete), modified label; ghost translucent image, title and clear control. Неправомерные мутации отклоняет сервис; readonly UI controls disabled.
- [x] Подключить helper к существующему panel binding; context menu предлагает «Убрать силуэт» вместе с compatible items; существующие click/drop handlers остаются каноническими.
- [x] Запустить focused UI/integration tests; ожидать 0 failed. Проверить live Foundry GM/player/reload/missing-item state на доступной тестовой сессии; при недоступности зафиксировать limitation без правок production world.

## Task 4: Документация, review и выпуск

**Files:** README.md; docs/function-passport.md; docs/item-instance-passport.md; module.json; scripts/main-<new-version>.js; cache queries touched by changes.

- [x] Обновить API/passports, записать data flow, quantity rules, ghosts и focused tests.
- [x] Повысить версию 1.4.363 -> 1.4.364 (если manifest не изменился параллельно), создать import-only forwarder, обновить esmodules и touched runtime import URLs. Все importers изменённого workflow используют согласованный query, чтобы не получить старый runBatch.
- [x] Выполнить независимый review текущего diff против spec и Review Focus; исправить важные findings с RED→GREEN и affected checks. Использовать Gemini с переданным scoped контекстом если CLI command access остаётся недоступен; итоговые решения проверяет Codex.
- [x] Один раз выполнить полный `node --test tests/*.test.mjs`, node --check tracked JS/MJS, parse tracked JSON, git diff --check; ожидать 0 failed/errors. Повторять только affected checks после исправлений.
- [x] Проверить git diff/stat и changed files, commit только файлов задачи, push -u origin lich_branch, clean status. В отчёте spec/plan, commit/version, counts, live QA limits.

## Execution ledger

Progress хранится в .superpowers/sdd/2026-10-09-hero-doll-presets/progress.md. На Windows shell scripts skill заменяются эквивалентными native file/command actions; записи RED/GREEN, rulings и task completion сохраняются. Product commits объединяются после целостной реализации и полной проверки согласно обязательному Git-процессу репозитория.

Самопроверка: все разделы spec покрыты Tasks 1–4; shared interface runBatch.steps -> driver и service -> UI согласованы. User instruction «план и сразу переходи к реализации тут сам» заменяет повторный запрос одобрения плана и выбора executor.
