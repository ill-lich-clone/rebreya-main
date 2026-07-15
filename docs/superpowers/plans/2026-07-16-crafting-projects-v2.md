# Crafting Projects v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the independent craft queue with GM-approved craft projects that reserve group resources and progress only through assigned downtime workdays.

**Architecture:** Pure crafting rules calculate eligibility, rank, progress, and resource requirements. `CraftingService` owns project state and durable material-inventory mutations; `DowntimeService` owns request status and dated work slots. The character sheet submits intent, the GM approval transaction creates and links the project, and the calendar calls one project workday at a time.

**Tech Stack:** Foundry VTT v13, dnd5e, ApplicationV2/Handlebars, managed Rebreya compendiums, vanilla ES modules, `node:test`.

## Global Constraints

- Requires the completed Downtime Calendar v2 plan.
- Crafting is limited to nonmagical gear; magical items are rejected.
- A project may contain several outputs only when they use the same required tool.
- Standard progress is 5 gp per eight-hour workday; 9-16 hours use `5.5, 6, 6.5, 7, 7.5, 8, 9, 10` gp.
- Firearm progress is five times mundane progress and requires a blueprint plus tinker's tools.
- Tool proficiency and modifiers do not increase progress.
- Full resources are reserved on GM approval and spent proportionally as work advances.
- Predominant material is measured in pounds and capped by output weight.
- Remaining material value is reserved as the tool-specific `Базовое сырье для Инструменты ...` item from group inventory.
- All 247 named rows from the `Энциклопедия материалов` sheet are represented in `data/materials.json`; source blanks remain null.
- Source spreadsheet ID is `1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk`, tab `Энциклопедия материалов`, rows `1-249`, observed Drive update `2026-07-14T16:02:48.626Z`.
- Crafted output must be a functional managed dnd5e item, intact, unequipped, and not held.
- Repair is absent from this implementation.

---

## File Map

- Create `scripts/data/crafting-rules.js`: pure eligibility, batch, progress, and reservation calculations.
- Create `scripts/data/craft-project-processor.js`: pure project workday/result transitions.
- Create `scripts/data/material-catalog-sync.js`: source-row normalization, stable ID reconciliation, and tool-to-base-material indexing.
- Create `tests/material-catalog-sync.test.mjs`: complete-sheet, stable-ID, and base-material mapping coverage.
- Create `tests/materials-compendium.test.mjs`: managed compendium synchronization and rendered metadata coverage.
- Create `tests/crafting-rules.test.mjs` and `tests/craft-project-processor.test.mjs`.
- Modify `scripts/data/crafting-service.js`: v2 project repository, approval, cancellation, processing, completion, migration.
- Modify `scripts/data/downtime-service.js`: craft request linkage and `activityProcessor` delegation.
- Modify `scripts/data/character-downtime-service.js`: build/validate craft payload and projected workdays.
- Modify `scripts/data/inventory-service.js`: ranked tool resolution, material reservation receipts, functional gear output, durability-ready merge signature.
- Modify `data/materials.json`: add all material rows missing from the source sheet.
- Modify `scripts/data/materials-compendium.js`: retain and display application/aspect metadata.
- Modify `scripts/data/normalizer.js`: normalize nullable source fields and the expanded material metadata.
- Modify `scripts/ui/inventory-app.js`: GM craft approval/editor and project reconciliation controls.
- Modify `templates/inventory-app.hbs`: group project/reservation UI and migration banner.
- Modify `templates/character-downtime-tab.hbs`: batch, hours, owned-workshop, requirements, and projection fields.
- Modify `scripts/integrations/dnd5e-sheet-extensions.js`: bind the existing character downtime form controls.
- Modify `styles/main.css`: compact project form and status styling.
- Modify `data/downtime-activities-teyvankal-v01.json`: mark the existing `craft` activity as project-backed without duplicating rules.
- Modify `tests/crafting-service.test.mjs`, `tests/character-downtime-service.test.mjs`, and `tests/dnd5e-sheet-downtime-tab.test.mjs`.

### Task 1: Complete Material Catalog

**Interfaces:**

- Produces `normalizeMaterialSheetRows(rows): MaterialRecord[]`.
- Produces `mergeMaterialCatalog(existing, incoming): { materials, addedIds, updatedIds }` while preserving matching existing IDs.
- Produces `buildBaseRawMaterialIndex(materials): Map<toolId, materialId>`.

- [ ] **Step 1: Add failing catalog tests**

Use a committed test fixture derived from source rows `1-249` with cells represented as plain values. Assert 247 named records, 202 additions against the current 45-record catalog, unique IDs, preserved IDs for `Сталь` and `Железо`, all 15 tool-specific base materials, `Алхимические реагенты`, nullable fields for `Кости тролля`, decimal parsing for `0,1 фнт`, and retention of application/aspect columns.

```js
assert.equal(sourceMaterials.length, 247);
assert.equal(result.materials.length, 247);
assert.equal(result.addedIds.length, 202);
assert.equal(result.materials.find((row) => row.name === "Сталь").id, "stal");
assert.equal(baseRawByTool.get("tinkers"), result.materials.find((row) => row.name === "Базовое сырье для Инструменты Жестянщика").id);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/material-catalog-sync.test.mjs tests/materials-compendium.test.mjs`

Expected: FAIL because the built-in catalog contains 45 rows and no source reconciliation helper.

- [ ] **Step 3: Implement source normalization and merge**

Parse decorated numeric cells such as `500 зм`, `0,1 фнт`, and plain numbers without altering source text fields. Preserve blank price/weight/rank as `null`. Persist `applications: { upgrade, implant, crafting, alchemy, knowledge }`, `alchemyAspects`, and `source: { spreadsheetId, sheetName, row }`.

```js
export function mergeMaterialCatalog(existing, incoming) {
  const existingByName = new Map(existing.map((row) => [normalizeName(row.name), row]));
  const usedIds = new Set();
  const materials = incoming.map((row) => {
    const previous = existingByName.get(normalizeName(row.name));
    const id = uniqueId(previous?.id || slugifyMaterialId(row.name), usedIds);
    return { ...previous, ...row, id };
  });
  return buildMergeResult(existing, materials);
}
```

- [ ] **Step 4: Update built-in data and compendium rendering**

Generate the deterministic merged JSON, review the 202 additions, and update material signatures/descriptions to include applications and aspects. Rows lacking price/weight remain searchable and openable; automated crafting filters them out with a specific reason.

- [ ] **Step 5: Run material tests and commit**

Run: `node --test tests/material-catalog-sync.test.mjs tests/materials-compendium.test.mjs tests/managed-compendium-sync.test.mjs tests/gear-compendium.test.mjs`

Expected: PASS with exactly 247 built-in material rows.

```bash
git add data/materials.json scripts/data/material-catalog-sync.js scripts/data/materials-compendium.js scripts/data/normalizer.js tests/fixtures/materials-encyclopedia.json tests/material-catalog-sync.test.mjs tests/materials-compendium.test.mjs
git commit -m "feat: import complete Rebreya material encyclopedia"
```

### Task 2: Pure Crafting Rules

**Interfaces:**

- Produces `buildCraftBatch(outputs, gearById): CraftBatch`.
- Produces `resolveDailyProgressGold({ hours, profile, effectiveBaseGold }): number`.
- Produces `calculateMaterialReservation({ totalPriceGold, totalWeightLb, predominantMaterial, baseRawMaterial }): ReservationQuote`.
- Produces `calculateProjectWorkdays({ targetGold, hours, profile, effectiveBaseGold }): number`.
- Produces `validateCraftEligibility({ batch, toolAccess, workshopApproved, blueprintIds }): ValidationResult`.

- [ ] **Step 1: Write failing rule tests**

Cover the full 8-16 hour table, effect scaling, firearm multiplier, batch price/weight/rank aggregation, incompatible-tool rejection, magic exclusion, predominant-material cap, base-raw remainder, and invalid material price.

```js
test("material quote caps predominant material by output weight", () => {
  assert.deepEqual(calculateMaterialReservation({
    totalPriceGold: 100,
    totalWeightLb: 3,
    predominantMaterial: { priceGold: 10, weightLb: 1 },
    baseRawMaterial: { priceGold: 1, weightLb: 0.1 }
  }), {
    materialValueGold: 50,
    predominantMaterialLb: 3,
    predominantMaterialValueGold: 30,
    baseRawMaterialQuantity: 20,
    baseRawWeightLb: 2
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/crafting-rules.test.mjs`

Expected: FAIL because `scripts/data/crafting-rules.js` does not exist.

- [ ] **Step 3: Implement deterministic calculations**

Use integer hours and round gold-value and material-quantity calculations to five decimal places; keep unrounded ratios inside the quote so the final workday can consume residue.

```js
export function resolveDailyProgressGold({ hours = 8, profile = "mundane", effectiveBaseGold = 5 } = {}) {
  const table = new Map([[8, 5], [9, 5.5], [10, 6], [11, 6.5], [12, 7], [13, 7.5], [14, 8], [15, 9], [16, 10]]);
  const base = table.get(Number(hours));
  if (!base) throw new Error("Рабочий день должен длиться от 8 до 16 часов.");
  const profileMultiplier = profile === "firearm" ? 5 : 1;
  return roundGold(base * (Number(effectiveBaseGold) / 5) * profileMultiplier);
}
```

- [ ] **Step 4: Run rules tests and commit**

Run: `node --test tests/crafting-rules.test.mjs`

Expected: PASS.

```bash
git add scripts/data/crafting-rules.js tests/crafting-rules.test.mjs
git commit -m "feat: add project crafting rules"
```

### Task 3: Project Workday Processor

**Interfaces:**

- Consumes a normalized v2 project and daily progress.
- Produces `processCraftProjectWorkday(project, { isoDate, transitionId, dailyProgressGold }): { project, spend, completion }`.
- Produces no Foundry side effects; `spend` contains exact predominant and base-raw material deltas for the service transaction.

- [ ] **Step 1: Write failing processor tests**

Cover partial progress, proportional spend, final rounding residue, already-processed transition, blocked/paused state, and completion exactly once.

```js
const result = processCraftProjectWorkday(project, {
  isoDate: "2026-07-20",
  transitionId: "transition-1",
  dailyProgressGold: 5
});
assert.equal(result.project.progressGold, 5);
assert.equal(result.spend.baseRawMaterialQuantity, 2.5);
assert.equal(result.completion, false);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/craft-project-processor.test.mjs`

Expected: FAIL because the processor does not exist.

- [ ] **Step 3: Implement immutable workday transitions**

Store processed `{ isoDate, transitionId, progressGold, spend }` records on the project. Calculate the day's share from actual progress divided by target, and make the completion day consume all remaining reservation residue.

- [ ] **Step 4: Run processor tests and commit**

Run: `node --test tests/craft-project-processor.test.mjs`

Expected: PASS.

```bash
git add scripts/data/craft-project-processor.js tests/craft-project-processor.test.mjs
git commit -m "feat: process craft project workdays"
```

### Task 4: Inventory Reservation and Functional Output

**Interfaces:**

- Produces `InventoryService.resolveMemberToolAccess(actorId, toolId): Promise<{ rank, source, itemUuid }>`.
- Produces `reserveCraftResourcesOnce(quote, mutationId): Promise<ReservationReceipt[]>` for predominant and base-raw material items.
- Produces `spendCraftReservationOnce(projectId, spend, mutationId): Promise<void>`.
- Produces `releaseCraftReservationOnce(projectId, remaining, mutationId): Promise<void>`.
- Produces `createCraftOutputsOnce(outputs, mutationId): Promise<Item[]>`.

- [ ] **Step 1: Write failing inventory tests**

Add cases for highest actor tool rank, manual party-tool fallback, atomic predominant-plus-base-material reservation, fractional base-material quantities, exact refund, mutation retry, and output built from `world.rebreya-gear` rather than generic loot.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/inventory-mutation-recovery.test.mjs tests/inventory-sync-hooks.test.mjs tests/gear-compendium.test.mjs`

Expected: FAIL on the new reservation and output assertions.

- [ ] **Step 3: Add ranked tool state and reservation receipts**

Extend `updatePartyMemberTool(actorId, toolId, patch)` with nonnegative integer `rank`. Reuse the durable mutation journal and inventory receipts; a multi-resource approval has one root mutation ID and compensates completed substeps in reverse order.

```js
const mutation = await this.moduleApi.durableMutations.run({
  mutationId,
  kind: "craft-reservation",
  steps: [predominantMaterialReservationStep, baseRawMaterialReservationStep]
});
return mutation.receipts;
```

- [ ] **Step 4: Resolve and create functional outputs**

`createCraftOutputsOnce` loads the managed gear source document, clones its complete item data, sets requested quantity and Rebreya source flags, clears equipped/attuned/held state, and passes the result through durability initialization when that service is installed.

- [ ] **Step 5: Run inventory tests and commit**

Run: `node --test tests/inventory-mutation-recovery.test.mjs tests/inventory-sync-hooks.test.mjs tests/gear-compendium.test.mjs tests/group-inventory-migration.test.mjs`

Expected: PASS.

```bash
git add scripts/data/inventory-service.js scripts/constants.js tests/inventory-mutation-recovery.test.mjs tests/inventory-sync-hooks.test.mjs tests/gear-compendium.test.mjs
git commit -m "feat: reserve craft resources and create gear outputs"
```

### Task 5: CraftingService v2 Projects and Legacy Migration

**Interfaces:**

- Produces `getSnapshot({ crafterActorId, search })` with v2 projects and reservation summaries.
- Produces `approveRequest({ requestId, outputs, hoursPerDay, ownedWorkshop, predominantMaterialId, workshopApproval, mutationId })`.
- Produces `processProjectWorkday(projectId, { isoDate, transitionId, mutationId })`.
- Produces `cancelProject(projectId, { mutationId })`, `pauseProject`, and `resumeProject`.
- Existing `queueTask` and `processOneDay` stop being user-facing APIs.

- [ ] **Step 1: Replace queue-oriented tests with failing project tests**

Cover approval revalidation, linked IDs, full reservation, project processing, blocked resource/tool/workshop cases, cancellation refund, completion output, idempotency, and v1 paused-legacy migration.

```js
const project = await service.approveRequest({
  requestId: "request-1",
  outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 1 }],
  hoursPerDay: 8,
  ownedWorkshop: false,
  predominantMaterialId: "steel",
  workshopApproval: { confirmedByUserId: "gm" },
  mutationId: "approve-1"
});
assert.equal(project.status, "active");
assert.equal(project.reservation.baseRawQuantitySpent, 0);
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/crafting-service.test.mjs`

Expected: FAIL because the service still stores queue tasks and debits half item weight immediately.

- [ ] **Step 3: Implement state v2 and approval transaction**

Normalize once at the service boundary. Convert v1 tasks into `paused` projects with `profile: "legacy"`, preserve progress/target, and treat the recorded material debit as reservation. Approval validates current data, reserves resources, creates the project, links the downtime request, and marks its slots approved; compensation reverses partial writes.

- [ ] **Step 4: Implement dated workday processing**

Resolve active effects through `moduleApi.resolveCraftProgressBase(actor, project)` without mutating the recipe. Apply the pure processor, spend its receipt once, persist project state, then create output on completion.

- [ ] **Step 5: Run service tests and commit**

Run: `node --test tests/crafting-service.test.mjs tests/downtime-service.test.mjs tests/durable-mutation-journal.test.mjs`

Expected: PASS.

```bash
git add scripts/data/crafting-service.js scripts/data/downtime-service.js scripts/main.js tests/crafting-service.test.mjs tests/downtime-service.test.mjs
git commit -m "feat: replace craft queue with downtime projects"
```

### Task 6: Character-Sheet Submission Flow

**Interfaces:**

- The `craft` downtime activity provides `craftProject: true`.
- Form payload contains `outputs`, `hoursPerDay`, `ownedWorkshop`, and `predominantMaterialId`.
- Character context exposes `craftQuote`, `projectedDates`, `toolAccess`, and `submitDisabledReason`.

- [ ] **Step 1: Write failing character flow tests**

Assert nonmagical item filtering, batch quantity, incompatible tool rejection, hours bounds, owned-workshop projection, quote display, and request payload persistence.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/character-downtime-service.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/downtime-compendium.test.mjs`

Expected: FAIL because the current generic item/numeric actions do not build a project payload.

- [ ] **Step 3: Extend the activity data and service context**

Keep the activity as the library entry point but delegate all computed rules to `crafting-rules.js`. Store source IDs and quantities, never copied price/rank data as authority.

- [ ] **Step 4: Implement compact form controls**

Add output rows with item picker, numeric quantity stepper, remove icon, 8-16 hour stepper, owned-workshop checkbox, predominant-material select, read-only requirement/price/material/date summary, and one submit button. Do not expose start-date controls.

- [ ] **Step 5: Run character tests and commit**

Run: `node --test tests/character-downtime-service.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/downtime-compendium.test.mjs tests/style-theme.test.mjs`

Expected: PASS.

```bash
git add scripts/data/character-downtime-service.js data/downtime-activities-teyvankal-v01.json templates/character-downtime-tab.hbs scripts/integrations/dnd5e-sheet-extensions.js styles/main.css tests/character-downtime-service.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/downtime-compendium.test.mjs
git commit -m "feat: submit craft projects from character downtime"
```

### Task 7: GM Approval and Project Reconciliation UI

**Interfaces:**

- GM approval dialog may change `ownedWorkshop` and `hoursPerDay`, confirms workshop rank, and selects predominant material.
- Group craft tab lists project status, progress, reservation/spend, requirements, dates, and block reason.

- [ ] **Step 1: Add failing inventory app tests**

Cover approval dialog model, resource quote refresh after edits, project controls, migration banner, and absence of `craft-process-day`.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/inventory-app-context.test.mjs tests/crafting-service.test.mjs`

Expected: FAIL on missing v2 controls.

- [ ] **Step 3: Implement approval and project views**

Use existing compact dialogs and icon controls. Approval displays current availability of both material rows and disables confirmation on stale requirements. Project actions are GM-only and call audited service methods.

- [ ] **Step 4: Run UI tests and commit**

Run: `node --test tests/inventory-app-context.test.mjs tests/style-theme.test.mjs tests/crafting-service.test.mjs`

Expected: PASS.

```bash
git add scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs tests/style-theme.test.mjs
git commit -m "feat: approve and inspect craft projects"
```

### Task 8: End-to-End Verification

- [ ] **Step 1: Run the focused suite**

Run: `node --test tests/material-catalog-sync.test.mjs tests/crafting-rules.test.mjs tests/craft-project-processor.test.mjs tests/crafting-service.test.mjs tests/character-downtime-service.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs tests/downtime-service.test.mjs tests/inventory-mutation-recovery.test.mjs tests/inventory-app-context.test.mjs`

Expected: all tests PASS.

- [ ] **Step 2: Run the full suite**

Run: `node --test tests/*.test.mjs`

Expected: all tests PASS.

- [ ] **Step 3: Verify in Foundry**

Submit a mundane batch as player; approve as GM after changing workshop mode; inspect calendar slots; advance partial and completion days; verify proportional reservation spend, output functionality, cancellation refund, incompatible-tool rejection, magic exclusion, firearm blueprint requirement, and a migrated legacy project that remains paused.

- [ ] **Step 4: Commit verification fixes only if needed**

```bash
git add scripts data templates styles tests
git commit -m "test: verify downtime craft projects"
```
