# Half-Giant Tribe Advancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a mandatory six-option Half-Giant tribe choice inside the dnd5e Advancement wizard and configure one owned `Великанье племя` feature without a second dialog or tribe-specific Items.

**Architecture:** Register a hidden module-owned `GiantTribe` Advancement type using dnd5e's exported Advancement and Flow base classes. The race's automatic ItemGrant creates the one feature on the Advancement manager clone; the following GiantTribe step replaces only module-managed feature data on that clone and stores the selected tribe in the Advancement value. Existing race automation retains pure configuration building and legacy repair, but no longer prompts during `createItem` or sheet rendering.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5 Advancement API, ECMAScript modules, Node.js `node:test`, Handlebars system Advancement template.

## Global Constraints

- Work only on branch `lich_branch`; fetch `origin` and stop for unconfirmed foreign changes or main conflicts.
- Preserve one owned `Великанье племя` Item; do not grant six tribe-specific Items.
- Present exactly six choices and require one; do not include a random option.
- Do not depend on dialog z-index, `createItem` timing, or active-owner arbitration for initial selection.
- Preserve unrelated user-authored effects and activities when reconfiguring an existing feature.
- Do not touch the user's concurrent Craftsman changes.
- Finish with diff review, all available tests, a meaningful commit, and a non-force push to `origin/lich_branch`.

---

## File Structure

- Create `scripts/integrations/giant-tribe-advancement.js`: registers and implements the custom dnd5e Advancement and its single-select flow.
- Create `templates/advancement/giant-tribe-flow.hbs`: renders a required placeholder plus the six tribe options.
- Create `tests/giant-tribe-advancement.test.mjs`: unit tests registration, validation, application, switching, and reversal with small fake dnd5e bases.
- Modify `scripts/combat/race-automation-service.js`: expose pure same-item configuration and make legacy repair non-interactive.
- Modify `tests/race-automation-service.test.mjs`: cover no-prompt creation/repair and pure preservation behavior.
- Modify `scripts/data/races-compendium.js`: add the level-zero `GiantTribe` Advancement only to Half-Giants.
- Modify `data/races-teyvankal-v01.json`: stop publishing the old runtime chooser activity.
- Modify `tests/races-compendium.test.mjs`: assert the exact six-option Advancement and absence of the chooser activity.
- Modify `scripts/integrations/dnd5e-sheet-extensions.js`: register the custom type during dnd5e initialization.
- Modify `scripts/main.js` and `tests/module-manifest.test.mjs`: cache-bust and verify the changed integration graph.

---

### Task 1: Pure Same-Item Tribe Configuration

**Files:**
- Modify: `scripts/combat/race-automation-service.js`
- Modify: `tests/race-automation-service.test.mjs`

**Interfaces:**
- Produces: `configureGiantTribeItemData(itemData: object, tribe: string): object`.
- Produces: `isGiantTribeFeature(itemLike: object): boolean` for clone and owned Item lookup.
- Retains: `buildGiantTribeConfiguration(value: string): {tribe,label,effects,activities}|null`.

- [ ] **Step 1: Write failing tests for the configured Item data**

Add tests that pass raw Item data with one unrelated effect/activity and legacy managed entries, then assert:

```js
const configured = configureGiantTribeItemData(source, "storm");
assert.equal(configured.name, "Великанье племя (Штормовой великан)");
assert.equal(configured.flags[MODULE_ID].raceAutomation.giantTribe, "storm");
assert.deepEqual(
  Object.values(configured.system.activities).map(activity => activity.name),
  ["Пользовательская активность", "Штормовой великан: касание"]
);
assert.deepEqual(configured.effects.map(effect => effect.name), ["Пользовательский эффект"]);
assert.throws(() => configureGiantTribeItemData(source, ""), /великанье племя/u);
assert.throws(() => configureGiantTribeItemData(source, "random"), /великанье племя/u);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/race-automation-service.test.mjs`

Expected: FAIL because `configureGiantTribeItemData` is not exported.

- [ ] **Step 3: Implement pure configuration and remove the generic chooser from selected configurations**

Implement a pure clone-transform that:

```js
export function configureGiantTribeItemData(itemData, value) {
  const configuration = buildGiantTribeConfiguration(value);
  if (!configuration) throw new Error("Не выбрано допустимое великанье племя.");
  const source = typeof itemData?.toObject === "function" ? itemData.toObject() : clone(itemData);
  const preservedEffects = normalizeCollection(source.effects).filter(effect => !isManagedGiantTribeEffect(effect));
  const preservedActivities = Object.values(source.system?.activities ?? {})
    .filter(activity => !isManagedGiantTribeActivity(activity));
  source.name = `${GIANT_TRIBE_ITEM_NAME} (${configuration.label})`;
  foundry.utils.setProperty(source, `flags.${MODULE_ID}.raceAutomation.giantTribe`, configuration.tribe);
  source.effects = [...preservedEffects, ...clone(configuration.effects)];
  source.system.activities = Object.fromEntries(
    [...preservedActivities, ...clone(configuration.activities)].map(activity => [activity._id, activity])
  );
  return source;
}
```

Change `buildGiantTribeConfiguration` so non-Storm tribes produce zero managed activities and Storm produces only `Штормовой великан: касание`.

- [ ] **Step 4: Make owned-item repair non-interactive**

Change `handleCreatedItem` so an unconfigured Giant Tribe feature returns `false` rather than opening a dialog. Change `repairActor` so it normalizes features with a valid saved tribe; for an unconfigured feature it removes only managed legacy effects and activities without renaming it or guessing a tribe. Remove the `chooseGiantTribe` runtime branch. Retain recognition of old `Выбрать племя` and `Применить остаток механики` activities as managed legacy data so repair can delete them.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test tests/race-automation-service.test.mjs`

Expected: all race automation tests pass; no test observes a prompt for an unconfigured feature.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- scripts/combat/race-automation-service.js tests/race-automation-service.test.mjs
git commit -m "refactor(races): configure giant tribe items without dialogs"
```

---

### Task 2: Custom GiantTribe Advancement

**Files:**
- Create: `scripts/integrations/giant-tribe-advancement.js`
- Create: `templates/advancement/giant-tribe-flow.hbs`
- Create: `tests/giant-tribe-advancement.test.mjs`

**Interfaces:**
- Consumes: `configureGiantTribeItemData` and `isGiantTribeFeature` from Task 1.
- Produces: `createGiantTribeAdvancementClasses({SizeAdvancement, AdvancementFlow}): {GiantTribeAdvancement,GiantTribeFlow}` for unit tests.
- Produces: `registerGiantTribeAdvancement(): boolean` for module initialization.

- [ ] **Step 1: Write failing tests for registration and flow data**

Use fake `Advancement` and `AdvancementFlow` base classes and assert:

```js
const classes = createGiantTribeAdvancementClasses({ SizeAdvancement, AdvancementFlow });
assert.deepEqual(classes.GiantTribeFlow.prototype.getData.call(flow).choices, {
  hill: "Холмовой великан",
  stone: "Каменный великан",
  frost: "Ледяной великан",
  fire: "Огненный великан",
  cloud: "Облачный великан",
  storm: "Штормовой великан"
});
assert.equal(registerGiantTribeAdvancement(), true);
assert.equal(CONFIG.DND5E.advancementTypes.GiantTribe.validItemTypes.has("race"), true);
assert.equal(CONFIG.DND5E.advancementTypes.GiantTribe.hidden, true);
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/giant-tribe-advancement.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the required single-select flow**

Create `GiantTribeFlow extends AdvancementFlow` using `modules/rebreya-main/templates/advancement/giant-tribe-flow.hbs`. Its context exposes `choices` as the six-label mapping and `selectedTribe` as the stored or retained tribe. The template renders a disabled blank placeholder and a required select named `size`; the Advancement's `apply` validation remains authoritative because the manager submits the embedded form programmatically.

- [ ] **Step 4: Write failing apply/reverse tests**

Construct a clone actor containing one feature matched by `isGiantTribeFeature`. Assert that `apply(0, {size: "frost"})` replaces the same feature ID, stores `value.size === "frost"`, and adds only cold resistance. Assert that applying `cloud` to a configured Storm feature removes Storm damage, preserves unrelated data, and adds the two Cloud effects. Assert that missing/unknown values and a missing feature reject with the Advancement error. Assert `reverse` clears `value.size` and returns `{size: previous}` without creating or deleting tribe Items.

- [ ] **Step 5: Implement the Advancement document**

Implement `GiantTribeAdvancement extends SizeAdvancement` so it inherits dnd5e's validated `configuration.sizes` Set and `value.size` schema. Override metadata order `45`, the dedicated flow, `levels` equal to `[0]`, a selected-label summary, and `automaticApplicationValue()` to always return `false`, preventing dnd5e from silently choosing the first tribe. Implement these methods:

```js
async apply(level, data) {
  const tribe = String(data?.size ?? "").trim();
  if (!GIANT_TRIBE_VALUES.has(tribe)) throw new this.constructor.ERROR("Выберите великанье племя.");
  const feature = this.actor.items.find(isGiantTribeFeature);
  if (!feature) throw new this.constructor.ERROR("Не найдена черта «Великанье племя».");
  const configured = configureGiantTribeItemData(feature, tribe);
  this.actor.items.delete(feature.id);
  this.actor.updateSource({items: [configured]});
  this.updateSource({"value.size": tribe});
}

async restore(level, data) { return this.apply(level, data); }

automaticApplicationValue() { return false; }

async reverse(level) {
  const size = this.value?.size ?? null;
  this.updateSource({"value.size": null});
  return {size};
}
```

- [ ] **Step 6: Run the new test and verify GREEN**

Run: `node --test tests/giant-tribe-advancement.test.mjs tests/race-automation-service.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- scripts/integrations/giant-tribe-advancement.js templates/advancement/giant-tribe-flow.hbs tests/giant-tribe-advancement.test.mjs
git commit -m "feat(races): add giant tribe advancement type"
```

---

### Task 3: Publish the Advancement on Half-Giants

**Files:**
- Modify: `scripts/data/races-compendium.js`
- Modify: `data/races-teyvankal-v01.json`
- Modify: `tests/races-compendium.test.mjs`

**Interfaces:**
- Consumes: registered Advancement type name `GiantTribe`.
- Produces: one level-zero GiantTribe entry in the Half-Giant race's `system.advancement`.

- [ ] **Step 1: Write failing compendium tests**

Assert the generated Half-Giant race contains exactly one entry matching:

```js
{
  type: "GiantTribe",
  title: "Великанье племя",
  level: 0,
  configuration: {sizes: ["hill", "stone", "frost", "fire", "cloud", "storm"]},
  value: {}
}
```

Ignore its stable `_id` in the structural assertion. Assert every other race contains zero GiantTribe entries. Assert the source `Великанье племя` automation has no generic chooser activity.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/races-compendium.test.mjs`

Expected: FAIL because no GiantTribe Advancement is generated and the old chooser still exists.

- [ ] **Step 3: Add the Half-Giant-only builder**

Add a stable builder and append it after the base ItemGrant:

```js
function buildGiantTribeAdvancement(race) {
  return {
    _id: stableHashId(`${race.id}:giant-tribe`, "adv"),
    type: "GiantTribe",
    title: "Великанье племя",
    hint: "Выберите одно великанье племя.",
    level: 0,
    configuration: { sizes: ["hill", "stone", "frost", "fire", "cloud", "storm"] },
    value: {}
  };
}
```

Gate it by normalized race ID `полувеликаны`. Remove the chooser activity from the source JSON while retaining automation metadata, manual Stone note, and Storm manual-button note.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/races-compendium.test.mjs tests/race-automation-service.test.mjs tests/giant-tribe-advancement.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- scripts/data/races-compendium.js data/races-teyvankal-v01.json tests/races-compendium.test.mjs
git commit -m "feat(races): add tribe choice to half-giant advancement"
```

---

### Task 4: Wire Registration and Cache Busting

**Files:**
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Modify: `scripts/main.js`
- Modify: `tests/module-manifest.test.mjs`

**Interfaces:**
- Consumes: `registerGiantTribeAdvancement()` from Task 2.
- Produces: registered `CONFIG.DND5E.advancementTypes.GiantTribe` before race compendium documents are materialized.

- [ ] **Step 1: Write failing wiring assertions**

Update `tests/module-manifest.test.mjs` to require the new integration import and call inside `extendDnd5eItemTypes`, plus a new cache-bust token on the `dnd5e-sheet-extensions.js` import from `scripts/main.js`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/module-manifest.test.mjs`

Expected: FAIL because registration is not wired.

- [ ] **Step 3: Wire registration**

Import and call `registerGiantTribeAdvancement()` immediately after existing custom Advancement registrations inside `extendDnd5eItemTypes`. Change the main import query to a unique token such as `v=1.4.111-giant-tribe-advancement` and update the exact manifest assertion.

- [ ] **Step 4: Run integration tests and verify GREEN**

Run: `node --test tests/module-manifest.test.mjs tests/giant-tribe-advancement.test.mjs tests/races-compendium.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- scripts/integrations/dnd5e-sheet-extensions.js scripts/main.js tests/module-manifest.test.mjs
git commit -m "feat(races): register giant tribe advancement"
```

---

### Task 5: Full Regression and Live Foundry Verification

**Files:**
- Modify only if a reproduced failure requires a focused fix and new regression test.

**Interfaces:**
- Verifies the complete race-to-feature transaction.

- [ ] **Step 1: Review the complete diff without staging user work**

Run:

```powershell
git status --short --branch
git diff --check
git diff origin/lich_branch...HEAD --stat
git diff origin/lich_branch...HEAD -- scripts tests data docs
```

Expected: only planned Giant Tribe files and commits are present; any concurrent user files remain untouched and unstaged.

- [ ] **Step 2: Run syntax and full regression checks**

Run:

```powershell
node --check scripts/integrations/giant-tribe-advancement.js
node --check scripts/combat/race-automation-service.js
node --check scripts/data/races-compendium.js
node --test tests/*.test.mjs
```

Expected: zero syntax errors and all tests pass.

- [ ] **Step 3: Verify in live Foundry**

On `https://vtt.rebreya.com/`, use actor `Actor.1Z9T8jbHwoAOTyTy` and confirm:

1. Adding Half-Giant opens a visible `Великанье племя` step inside the Advancement window.
2. The step contains exactly six options and no random option.
3. Completion creates one `Великанье племя (<выбор>)` feature and no tribe option Items.
4. Frost applies cold resistance; switching through Modify Choices to Storm removes it and leaves one `1d4` lightning touch activity.
5. No dialog appears underneath the Advancement window.
6. Temporary race, feature, effects, activities, chat messages, and macros are removed and the actor is restored to its initial state.

- [ ] **Step 4: Re-fetch and verify branch safety**

Run:

```powershell
git fetch origin
git status --short --branch
git rev-list --left-right --count origin/main...HEAD
git diff --check
```

Expected: branch is `lich_branch`, no unconfirmed foreign changes exist, and `origin/main` has no commits missing from the branch.

- [ ] **Step 5: Push without force**

```powershell
git push origin lich_branch
```

Expected: `origin/lich_branch` resolves to the same commit as `HEAD`.
