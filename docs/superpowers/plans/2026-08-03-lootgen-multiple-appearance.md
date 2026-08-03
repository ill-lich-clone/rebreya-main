# Lootgen Multiple Appearance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lootgen spend its budget through natural repeated selections driven by per-item package formulas, treat the configured item quantity as a soft target, enforce one copy per magic item, migrate existing templates to an optimal quantity of 4, and make templates deletable.

**Architecture:** Keep spreadsheet-authored multiplicity as catalog data (`multipleAppearance`) and normalize it at the economy-data boundary. Isolate parsing and rolling of integer/dice formulas in a pure module. Replace the generator's post-hoc unbounded stack filler with repeated weighted selection passes that respect budget, package rolls, soft saturation, and magic uniqueness. Keep Foundry UI/template persistence as adapters around the pure generator.

**Tech Stack:** Foundry VTT v13, D&D5e, JavaScript ES modules, Handlebars, Node's built-in test runner, Google Sheets connector.

## Global Constraints

- Work only on `lich_branch`; before implementation re-run `git fetch origin`, verify a clean worktree, branch name, and `HEAD...origin/main`/`HEAD...origin/master` divergence.
- Stop if unrelated uncommitted changes appear or the current main branch introduces conflicts.
- Use test-first changes: add one failing behavior test, run it and inspect the expected failure, then add the smallest production change.
- Preserve package semantics: `Стрелы (20)` with `1` means one catalog package, not one arrow.
- `optimalItemQuantity` is a soft distribution target, never a universal hard cap.
- A specific magic item may appear at most once per generation, including magic consumables.
- Missing, invalid, or non-positive item value never becomes a budget filler; unspent value becomes coins when coins are enabled.
- Do not delete world templates based on guesses. Remove only templates positively identified as Codex-created test data.
- Before completion inspect the full diff, run targeted and full available tests, perform live Foundry QA, commit meaningfully, and push `origin/lich_branch` without force.

---

### Task 1: Introduce and validate the multiple-appearance domain

**Files:**
- Create: `scripts/data/lootgen-multiple-appearance.js`
- Create: `tests/lootgen-multiple-appearance.test.mjs`

- [ ] **Step 1: Add failing parser and roller tests**

Cover positive integers, Russian and Latin dice notation, whitespace/case normalization, blank/invalid/zero fallback, deterministic dice rolling, and package formulas above the soft target.

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLootgenMultipleAppearance,
  rollLootgenMultipleAppearance
} from "../scripts/data/lootgen-multiple-appearance.js";

test("multiple appearance accepts package counts and Russian or Latin dice", () => {
  assert.equal(normalizeLootgenMultipleAppearance(" 2к12 "), "2d12");
  assert.equal(normalizeLootgenMultipleAppearance("1D6"), "1d6");
  assert.equal(normalizeLootgenMultipleAppearance(20), "20");
  assert.equal(normalizeLootgenMultipleAppearance(""), "1");
  assert.equal(normalizeLootgenMultipleAppearance("0"), "1");
  assert.equal(normalizeLootgenMultipleAppearance("garbage"), "1");
});

test("multiple appearance rolls every die deterministically", () => {
  const rolls = [0, 0.49, 0.99];
  assert.equal(rollLootgenMultipleAppearance("3к6", () => rolls.shift()), 10);
  assert.equal(rollLootgenMultipleAppearance("100", () => 0), 100);
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `node --test tests/lootgen-multiple-appearance.test.mjs`

Expected: FAIL because `scripts/data/lootgen-multiple-appearance.js` does not exist.

- [ ] **Step 3: Implement the pure parser and roller**

Use one canonical internal syntax and clamp only pathological input size, not authored package sizes.

```js
const DICE_PATTERN = /^(?<count>\d+)d(?<sides>\d+)$/u;

export function normalizeLootgenMultipleAppearance(value) {
  const source = String(value ?? "").trim().toLowerCase().replaceAll("к", "d");
  if (/^[1-9]\d*$/u.test(source)) return source;
  const match = source.match(DICE_PATTERN);
  if (!match) return "1";
  const count = Number(match.groups.count);
  const sides = Number(match.groups.sides);
  return count > 0 && sides > 0 ? `${count}d${sides}` : "1";
}

export function rollLootgenMultipleAppearance(value, random = Math.random) {
  const formula = normalizeLootgenMultipleAppearance(value);
  if (!formula.includes("d")) return Number(formula);
  const { count, sides } = formula.match(DICE_PATTERN).groups;
  let total = 0;
  for (let index = 0; index < Number(count); index += 1) {
    total += 1 + Math.floor(random() * Number(sides));
  }
  return total;
}
```

- [ ] **Step 4: Run the focused test and commit**

Run: `node --test tests/lootgen-multiple-appearance.test.mjs`

Expected: PASS.

Commit: `git commit -am "feat: add loot multiplicity formulas"` after staging the two new files.

---

### Task 2: Carry multiplicity from the equipment catalog into Lootgen

**Files:**
- Modify: `scripts/data/normalizer.js:60-90,617-669`
- Modify: `scripts/ui/lootgen-app.js:440-567`
- Modify: `tests/normalizer.test.mjs`
- Modify: `tests/lootgen-app-context.test.mjs`
- Modify: `data/gear.json`

- [ ] **Step 1: Add failing normalization and pool-mapping tests**

Assert that aliases from imported tabular data survive as canonical `multipleAppearance`, and that mundane Lootgen rows copy it without converting a missing/non-positive `value` to `1`.

```js
assert.equal(normalized.gear[0].multipleAppearance, "2к12");
assert.equal(normalized.gear[1].multipleAppearance, "1");
```

For the UI source/pool seam, assert a gear record with `value: ""` yields `value: 0`, while `multipleAppearance: "1к6"` reaches the generator row unchanged.

- [ ] **Step 2: Run the focused tests and inspect the expected failures**

Run: `node --test tests/normalizer.test.mjs tests/lootgen-app-context.test.mjs`

Expected: FAIL because `GEAR_FIELD_ALIASES` and normalized gear omit `multipleAppearance`, and `#toValue` forces a minimum of one.

- [ ] **Step 3: Add the catalog field at the normalization boundary**

```js
const GEAR_FIELD_ALIASES = {
  // existing aliases...
  multipleAppearance: ["multipleAppearance", "multipleSpawn", "Множественное появление"]
};

// inside normalizeGear()
multipleAppearance: cleanString(
  getValue(record, GEAR_FIELD_ALIASES.multipleAppearance, "1")
) || "1",
```

Change `#toValue` to return `0` for blank/non-positive values; keep price fallback only when a real positive fallback exists. Add `multipleAppearance: gearItem.multipleAppearance ?? "1"` to mundane pool rows. Materials without authored formulas use `"1"`.

- [ ] **Step 4: Populate local `data/gear.json` coherently**

Add `multipleAppearance` to all 773 equipment records using the same reviewed row classification used for the Google Sheet:

- ready-made packages such as `Стрелы (20)` get `"1"`;
- singular durable gear, weapons, armor, tools, containers, vehicles, implants, upgrades, attachments, and treasures default to `"1"`;
- loose cheap supplies receive contextual formulas such as `"1к4"`, `"1к6"`, or `"2к12"` (`Бумага (один лист)` must be `"2к12"`);
- no record is left blank.

Use a deterministic transformation keyed by stable gear `id`, inspect the resulting JSON diff, and verify record count and ID uniqueness remain unchanged.

- [ ] **Step 5: Run focused tests plus catalog integrity checks and commit**

Run: `node --test tests/normalizer.test.mjs tests/lootgen-app-context.test.mjs tests/crafting-rules.test.mjs tests/gear-compendium.test.mjs`

Expected: PASS.

Commit: `git commit -am "feat: import loot multiplicity metadata"`.

---

### Task 3: Replace unbounded budget filling with repeated natural selection

**Files:**
- Modify: `scripts/data/lootgen-generator.js:39-55,123-381`
- Modify: `tests/lootgen-generator.test.mjs`

- [ ] **Step 1: Extend form normalization with the soft target**

Add a failing assertion that missing and invalid values normalize to 4 and a valid value is clamped to a safe UI range.

```js
assert.equal(normalizeLootgenForm({}).optimalItemQuantity, 4);
assert.equal(normalizeLootgenForm({ optimalItemQuantity: "7" }).optimalItemQuantity, 7);
```

- [ ] **Step 2: Add failing behavior tests for the new selection contract**

Use deterministic random sequences to cover:

- an authored `2к12` package is rolled at selection time and capped only by affordable quantity;
- generation performs another pass when the first pass is below budget;
- a row at or above the soft target remains eligible with lower weight and may receive `+1` when that best fits the remaining budget;
- different item values naturally produce quantities below and above 4;
- a specific magic item never exceeds quantity 1, even when marked stackable/consumable;
- zero-value rows may be selected once but are never multiplied to consume the budget;
- an impossible remainder becomes coins when enabled;
- generation terminates when no positive-value candidate can make progress.

- [ ] **Step 3: Run the focused generator tests and inspect failures**

Run: `node --test tests/lootgen-generator.test.mjs`

Expected: FAIL against the current single-pass selection plus `spendRemainingValueIntoRows()` implementation.

- [ ] **Step 4: Implement repeated weighted passes**

Import `rollLootgenMultipleAppearance`. Remove `spendRemainingValueIntoRows()`. Track quantities by stable `sourceType:sourceId:isBroken` identity and magic IDs in a set.

```js
function candidateWeight(candidate, currentQuantity, optimalQuantity) {
  if (candidate.sourceType === "magicItem") return currentQuantity === 0 ? 1 : 0;
  if (currentQuantity === 0) return 4;
  if (currentQuantity < optimalQuantity) return 2;
  return 0.5;
}

function affordablePackageQuantity(candidate, rolledQuantity, remainingValue) {
  const unitValue = Math.max(0, toInteger(candidate.value, 0));
  if (unitValue <= 0) return Math.max(1, rolledQuantity);
  return Math.min(rolledQuantity, Math.floor(remainingValue / unitValue));
}
```

Each pass makes up to `itemCount` successful candidate selections. Rebuild eligible candidates after every selection because remaining budget, magic uniqueness, and soft saturation weights have changed. Stop after a pass with no progress, no affordable positive-value candidate, or exhausted budget. Apply zero-value candidates at most once per stable identity. Aggregate only after all passes, then convert the real remainder to coins.

- [ ] **Step 5: Run generator and adjacent durability tests and commit**

Run: `node --test tests/lootgen-generator.test.mjs tests/lootgen-durability.test.mjs`

Expected: PASS.

Commit: `git commit -am "feat: generate loot through repeated budget passes"`.

---

### Task 4: Add the optimal quantity setting and migrate saved templates

**Files:**
- Modify: `scripts/ui/lootgen-app.js:252-393,647-676,781-990`
- Modify: `templates/lootgen-app.hbs:38-58`
- Modify: `scripts/data/lootgen-template-catalog.js`
- Modify: `tests/lootgen-template-catalog.test.mjs`
- Modify: `tests/lootgen-type-filters.test.mjs`

- [ ] **Step 1: Add failing UI snapshot and catalog migration tests**

Assert that:

- the form renders `data-field="optimalItemQuantity"` with label `Оптимальное количество предметов`;
- constructor, form collection, template application, and generator call all carry the field;
- a version-1 catalog template without the field becomes version 2 with `optimalItemQuantity: 4`;
- initialization persists the migrated catalog exactly once, so old world data is actually upgraded rather than only normalized in memory.

```js
assert.deepEqual(store.get(), {
  version: 2,
  templates: [{ ...legacyTemplate, form: { ...legacyTemplate.form, optimalItemQuantity: 4 } }]
});
```

- [ ] **Step 2: Run the focused tests and inspect failures**

Run: `node --test tests/lootgen-template-catalog.test.mjs tests/lootgen-type-filters.test.mjs tests/lootgen-app-context.test.mjs`

Expected: FAIL because the field and persisted migration do not exist.

- [ ] **Step 3: Wire the field through UI and generator**

Place the number input beside `itemCount`, with a practical range such as 1-100. Use default 4 in the constructor and `normalizeLootgenForm` as the single canonical clamp. Preserve it in saved/apply snapshots.

- [ ] **Step 4: Persist catalog version 2 migration**

Make catalog initialization/load compare raw and normalized versions and call its injected `set` only when migration is needed. Keep saves/removals serialized through the existing catalog API.

- [ ] **Step 5: Run the focused tests and commit**

Run: `node --test tests/lootgen-template-catalog.test.mjs tests/lootgen-type-filters.test.mjs tests/lootgen-app-context.test.mjs tests/lootgen-generator.test.mjs`

Expected: PASS.

Commit: `git commit -am "feat: add soft loot quantity target"`.

---

### Task 5: Make saved Lootgen templates deletable

**Files:**
- Modify: `templates/lootgen-app.hbs:15-35`
- Modify: `scripts/ui/lootgen-app.js:954-985`
- Modify: `tests/lootgen-type-filters.test.mjs`
- Modify: `tests/lootgen-template-catalog.test.mjs`

- [ ] **Step 1: Add failing delete-control tests**

Assert the template contains `data-action="lootgen-delete-template"`, the app calls the existing `removeLootgenTemplate` API only after confirmation, handles no selection, refreshes the list, and clears a deleted selection.

- [ ] **Step 2: Run the focused tests and inspect failures**

Run: `node --test tests/lootgen-template-catalog.test.mjs tests/lootgen-type-filters.test.mjs`

Expected: FAIL because the catalog API exists but no UI control/listener uses it.

- [ ] **Step 3: Implement the delete button and listener**

Add a compact trash button next to Apply. In the listener resolve the selected template, display its name in a Foundry confirmation dialog, call `moduleApi.removeLootgenTemplate(template.id)`, reset selection, notify success, and rerender.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test tests/lootgen-template-catalog.test.mjs tests/lootgen-type-filters.test.mjs tests/lootgen-app-context.test.mjs`

Expected: PASS.

Commit: `git commit -am "feat: allow deleting lootgen templates"`.

---

### Task 6: Fill and verify the Google Sheet source of truth

**External artifact:**
- Spreadsheet: `Ребрея: Оружие, огнестрел и снаряжение`
- Sheet: `Общий компендиум снаряжения V0.1`
- Range: `M3:M775`

- [ ] **Step 1: Re-read the bounded source rows immediately before writing**

Read `A3:M775` through the Google Sheets connector and verify 773 non-empty item rows, stable names/IDs, header `Множественное появление`, and no concurrent edits in M.

- [ ] **Step 2: Build the reviewed formula vector**

Generate exactly 773 values using the same ID/name classification applied to `data/gear.json`. Manually inspect all non-`1` rows and all names containing an embedded package count such as `(20)` or `(50)`.

- [ ] **Step 3: Batch-write only column M**

Use one coherent spreadsheet batch update for `M3:M775`; do not overwrite other columns or formatting. Preserve the header and existing frozen rows/columns.

- [ ] **Step 4: Re-read and verify the written range**

Verify:

- exactly 773 non-empty formulas;
- every value matches `^(?:[1-9]\d*|[1-9]\d*[кd][1-9]\d*)$`;
- `Стрелы (20)` is `1`;
- `Бумага (один лист)` is `2к12`;
- the formulas match local `data/gear.json` by stable row identity.

Record the spreadsheet write in the final handoff; external sheet edits are not part of the Git commit.

---

### Task 7: Remove only Codex test templates and perform live Foundry QA

**Files:**
- Modify if required by cache policy: `module.json`
- Create if the repository's versioning convention requires it: `scripts/main-1.4.128.js`
- Modify: `tests/module-manifest.test.mjs`

- [ ] **Step 1: Bump the module/cache version using the repository convention**

Add a failing manifest assertion first if the versioned entrypoint/cache-bust convention requires a new `1.4.128` wrapper. Update `module.json` and imports consistently; never hand-edit historical wrappers.

- [ ] **Step 2: Restart/reload Foundry and open Lootgen as GM**

Confirm the new setting defaults to 4 and existing saved templates display 4 after migration.

- [ ] **Step 3: Delete positively identified Codex-created templates**

Use the new UI. Delete only templates whose names/content can be tied to this work (for example an explicit `Codex`/test name created during QA). Leave all user templates intact. Verify deletion survives reload.

- [ ] **Step 4: Run deterministic live scenarios**

Capture screenshots and generated results for:

1. budget 6000, itemCount 7, optimal 5: generation repeats after a low-value first pass instead of stopping near 700;
2. a cheap loose supply can roll below or above 5 naturally;
3. `Стрелы (20)` at formula `1` grants one package, not 20 package rows;
4. one specific magic consumable appears no more than once;
5. a no-value item is not multiplied hundreds of times;
6. an unfillable remainder is converted to coins;
7. save, apply, migrate, and delete a template.

- [ ] **Step 5: Run all available automated checks**

Targeted:

`node --test tests/lootgen-multiple-appearance.test.mjs tests/lootgen-generator.test.mjs tests/lootgen-template-catalog.test.mjs tests/lootgen-type-filters.test.mjs tests/lootgen-app-context.test.mjs tests/normalizer.test.mjs tests/module-manifest.test.mjs`

Full suite:

`node --test tests/*.test.mjs`

If PowerShell wildcard expansion is unreliable, use:

`node --test (Get-ChildItem tests -Filter '*.test.mjs' | ForEach-Object FullName)`

- [ ] **Step 6: Inspect final state, commit, and push**

Run sequentially:

```powershell
git status --short --branch
git diff --check
git diff origin/lich_branch...HEAD --stat
git diff origin/lich_branch...HEAD
git log --oneline origin/lich_branch..HEAD
```

Confirm only intended files changed. Create a final integration/version commit if Task 7 changed files, then:

```powershell
git push origin lich_branch
git status --short --branch
```

Expected: push succeeds without force and the worktree is clean/tracking `origin/lich_branch`.

---

## Completion Criteria

- All 773 spreadsheet rows and corresponding local gear records have a valid multiplicity formula.
- The generator performs repeated budget-aware passes and no longer uses an unbounded quantity filler.
- `optimalItemQuantity` defaults/migrates to 4 but does not act as a hard cap.
- Magic item identity is unique per generated result.
- Zero-value items do not consume budget or inflate stacks; remainder coin behavior is preserved.
- Existing templates migrate persistently and templates can be deleted from the UI.
- Targeted tests, full tests, and live Foundry scenarios pass with screenshots/evidence.
- Changes are committed and pushed to `origin/lich_branch` without force.
