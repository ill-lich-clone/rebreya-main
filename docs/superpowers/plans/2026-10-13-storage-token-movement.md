# Проход через хранилища: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать creature blocking/difficult terrain от постоянных объектов хранения Rebreya.

**Architecture:** Существующая storage integration подписывается на два публичных
dnd5e movement hooks. Один синхронный фильтр удаляет native storage objects из
изменяемого Set через существующий `storageObjectKind()`; состояние мира не меняется.

**Tech Stack:** Foundry VTT 13, dnd5e (проверенный source 5.2.5), native ESM, Node tests.

**Spec:** `docs/superpowers/specs/2026-10-13-storage-token-movement-design.md`

## Global Constraints

- Foundry VTT 13, dnd5e, `statuscounter >= 3.0.4`; новых зависимостей нет.
- Все изменения только в `lich_branch`, без force push и чужих правок.
- Не менять documents/settings, disposition/ownership, права доступа, стены,
  quantity rules, authored formulas и бюджет; ordinary creatures/corpses сохраняются.
- Версия `1.4.373` → `1.4.374`; прежние forwarders сохраняются.
- Обновить профильный раздел `docs/function-passport.md` в том же feature commit.

## Review Focus

- Mixed Set со storage и настоящим противником: противник остаётся.
- Storage marker только на TokenDocument распознаётся без marker на Actor.
- Materialized corpse не становится проходимым предметом по storage-state marker.
- Ground pile/coin/item и chest исключаются независимо от disposition/mover ownership.
- Preview и final, GM и player одинаково используют те же hooks без мутаций мира.

## Task 1: Добавить исключение storage из системных occupied-space расчётов

**Files:**
- Modify: `scripts/integrations/storage-token-hooks.js` — единственный runtime owner.
- Modify: `tests/storage-token-hooks.test.mjs` — behavior tests через зарегистрированные callbacks.
- Modify: `scripts/main.js` — integration import cache URL `?v=1.4.374`.
- Modify: `module.json`, `tests/module-manifest.test.mjs`, `tests/main-composition-root.test.mjs`, `tests/storage-main-registration.test.mjs` — release alignment.
- Create: `scripts/main-1.4.374.js` с единственным `import "./main.js";`.
- Modify: `docs/function-passport.md`, `README.md`; отчёт фиксирует spec/plan и проверки.

**Interfaces:**
- Consumes: `storageObjectKind(target) -> "chest" | "groundPile" | null` из canonical `storage-object-kind.js?v=1.4.360`.
- Consumes: callbacks `dnd5e.determineOccupiedGridSpaceBlocking(gridSpace,movingToken,options,found)`
  и `dnd5e.determineOccupiedGridSpaceDifficult(gridSpace,movingToken,options,found)`; `found: Set<Token5e>`.
- Produces: private `excludeStorageMovementObstacles(gridSpace,movingToken,options,found) -> void`
  удаляет только распознанные native storage tokens; Set identity и остальные inputs сохраняются.
- Produces: `registerStorageTokenHooks()` регистрирует один и тот же callback для обоих hooks;
  остальные существующие registrations/return contract не меняются.

- [x] **Step 1: Write failing regression tests.**
  Через существующий harness получить callbacks обоих точных hook names;
  для player/GM и `preview:true/false` передать Set из chest, token-only storage,
  ground pile, обычного enemy NPC, character, vehicle, corpse и unmarked NPC
  из папки «Хранилища». Assert: остаются ровно последние пять, Set тот же,
  параметры не изменены и update/settings/API calls отсутствуют.
  Повторный callback и пустой Set безопасны, Set без storage не меняется.
- [x] **Step 2: Observe RED.**
  `node --test tests/storage-token-hooks.test.mjs`.
  Expected: callback ещё не зарегистрирован / storage остаётся в Set;
  остальные baseline tests проходят (до edits: 33 focused passed, 0 failed).
- [x] **Step 3: Implement minimal hook integration.**
  Импортировать canonical classifier, объявить private void callback,
  удалять matching elements через `found.delete(token)` и зарегистрировать
  его в существующем `registerStorageTokenHooks()` для обоих public hooks.
  Не патчить Token/TokenLayer prototype и не менять Actor type/права.
- [x] **Step 4: Verify GREEN and existing interaction contracts.**
  `node --test tests/storage-token-hooks.test.mjs tests/storage-object-kind.test.mjs tests/storage-token-drop.test.mjs tests/storage-access.test.mjs`.
  Expected: 0 failed; прежние open/deposit/drop/distance/ownership checks сохранены.
- [x] **Step 5: Version and document.**
  Bump manifest/forwarder to `1.4.374`, обновить только изменённую integration
  cache URL и соответствующие release assertions. Записать hook names,
  classifier/data flow/exclusions/focused tests в паспорт и README.
- [x] **Step 6: Run complete required checks once.**
  `node --test tests/*.test.mjs`; `git diff --check`; `node --check` для каждого
  tracked JS/MJS и нового forwarder; JSON parsing всех tracked JSON через
  `Get-Content -Raw -Encoding UTF8 <file> | ConvertFrom-Json`.
  Expected: 0 test/syntax/JSON/diff failures; skips указывать отдельно.
  Live Foundry проверить только при доступной authenticated test world;
  иначе указать проверенную installed system version и границу live QA.
- [x] **Step 7: Review and finish.**
  Передать компактный diff/spec Gemini для review без tool calls; если CLI
  недоступен/timeout — выполнить отдельный source/spec review и указать fallback.
  Проверить remote/чужие правки, meaningful diff и добавить только task files.
  Commit `fix: exclude storage objects from creature movement obstacles`,
  `git push -u origin lich_branch`; записать spec/plan, commit и checks в отчёте.

## Execution handoff

Native/inline execution и план согласованы пользователем 2026-10-13.
Одна короткая интеграция выполнена без implementer subagents.
