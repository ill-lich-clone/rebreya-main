# Downtime Constructor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic downtime target-action constructor, then rebuild `Исследование` through constructor data instead of hard-coded one-off behavior.

**Architecture:** Keep the existing downtime item flag format as the storage boundary, but extend it with generic action types and config blocks: `rankChoice`, richer `numericInput`, rank/level-driven `resources`, and `downtimeResult` expressions. The GM inventory editor writes these structures, the character sheet renders and submits concrete selections, and the downtime service snapshots selected values into each request.

**Tech Stack:** Foundry VTT module JavaScript, Handlebars templates, CSS, Node `.test.mjs` tests.

---

### Task 1: Protect Current Behavior With Failing Tests

**Files:**
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `tests/character-downtime-service.test.mjs`
- Modify: `tests/dnd5e-sheet-downtime-tab.test.mjs`
- Modify: `tests/downtime-service.test.mjs`
- Modify: `tests/downtime-compendium.test.mjs`

- [ ] Add a test that opening an existing `optionChoice` action keeps the action type visible as `Выбор варианта` or `Выбор ранга`, not `Проверка`.
- [ ] Add a test that opening an existing `numericInput` action keeps the action type visible as `Числовой ресурс`, not `Проверка`.
- [ ] Add a test that the character downtime numeric input renders `min`, `max`, and `step`, and that submit clamps values to the configured range.
- [ ] Add a test that resource actions can store a rank-dependent cost table and expose the selected computed total in the request snapshot.
- [ ] Add a test that `downtimeResult` editor panels do not render skill/ability choice controls and do render result-source/expression controls.
- [ ] Add a test that threshold rows can be represented with more than the old fixed defaults and preserve labels/outcomes.

### Task 2: Add Generic Action Types To The GM Constructor

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `styles/rebreya.css` or the active module stylesheet if the target classes live elsewhere
- Test: `tests/inventory-app-context.test.mjs`

- [ ] Extend selectable action types with `rankChoice`, `optionChoice`, `numericInput`, and `formulaRoll` while preserving old `check`, `resources`, `downtimeResult`, and `freeform`.
- [ ] Replace the current fallback in `getSelectableDowntimeActionType()` so known non-check action types never degrade to `check`.
- [ ] Render type-specific panels:
  - `check`: existing roll variant editor.
  - `optionChoice`: option rows with add/remove.
  - `rankChoice`: rank range and rank rows `0..10`.
  - `numericInput`: label, min, max, default, step, unit, optional effect target.
  - `resources`: cost constructor.
  - `downtimeResult`: result expression constructor.
- [ ] Read each panel back into the same target-action structure without deleting unknown compatible fields.

### Task 3: Build Rank/Level-Aware Resource Costs

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `scripts/data/character-downtime-service.js`
- Modify: `scripts/data/downtime-service.js`
- Modify: `templates/character-downtime-tab.hbs`
- Test: `tests/character-downtime-service.test.mjs`
- Test: `tests/downtime-service.test.mjs`
- Test: `tests/dnd5e-sheet-downtime-tab.test.mjs`

- [ ] Add resource config fields:
  - `resourceName`
  - `dependsOnRank`
  - `dependsOnLevel`
  - `rankSourceActionId`
  - `levelSource`
  - `rankCosts[]` with `rank`, `baseCost`, `unitCost`, `unitLabel`, `min`, `max`
- [ ] Let the character sheet render the quantity input with the correct min/max from the selected rank row.
- [ ] Clamp submitted resource quantities in service code, not only in HTML.
- [ ] Snapshot selected rank, selected quantity, base cost, unit cost, and computed total into the request.
- [ ] Display computed resource details in the request details dialog.

### Task 4: Add Result Expressions And Dynamic Thresholds

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `scripts/data/downtime-service.js`
- Test: `tests/inventory-app-context.test.mjs`
- Test: `tests/downtime-service.test.mjs`

- [ ] Model `downtimeResult.resultFormula` as a list of terms referencing previous target actions, for example `research-check.total + research-extra-steps.value`.
- [ ] Render a source picker that lists previous target actions and fields such as `total`, `successes`, `value`, `quantity`, and `computedTotal`.
- [ ] Remove skill/ability choice UI from `downtimeResult`.
- [ ] Add `+` and `-` controls for threshold rows.
- [ ] Extend threshold outcomes to include custom text labels and common result presets: `0 фрагментов`, `1 фрагмент`, `2 фрагмента`, `3 фрагмента`, `выдать предмет`, `выдать ресурс`, `заметка мастеру`.
- [ ] Preserve existing thresholds from current compendium data.

### Task 5: Rebuild `Исследование` Through Constructor Data

**Files:**
- Modify: `data/downtime-activities-teyvankal-v01.json`
- Modify: `tests/downtime-compendium.test.mjs`

- [ ] Convert `research-rank` from `optionChoice` to `rankChoice`.
- [ ] Convert extra steps into a resource quantity with `max: 5`.
- [ ] Convert research cost into a rank-dependent resource cost using the rank table.
- [ ] Keep `research-check` as the only roll/check action.
- [ ] Convert `research-result` into a `downtimeResult` that depends on `research-check.total`.
- [ ] Preserve the full copied description text and HTML tables.

### Task 6: Verification And Release Hygiene

**Files:**
- Modify: `module.json`
- Create if needed: versioned `scripts/main-1.4.xx.js`

- [ ] Run targeted failing tests after each task and confirm the expected red/green cycle.
- [ ] Run the full available test suite with Node.
- [ ] Run `git diff --check`.
- [ ] Inspect `git diff` manually.
- [ ] Bump module version only after tests pass.
- [ ] Commit with a meaningful message.
- [ ] Push `lich_branch` to `origin` without force.
