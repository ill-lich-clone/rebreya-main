# Paladin Dogma Automation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Automate paladin dogma choices at paladin levels 3, 5, 9, 13, and 17, plus the independent `Посвящение в догматы паладина` feat choice, and always grant the selected dogma spells as prepared spells.

**Architecture:** Keep the authoritative oath/dogma data in a pure catalog module. Publish every dogma as a readable managed class-feature compendium item. A dedicated automation service reconciles owned paladin class/subclass/feat items, presents constrained checkbox dialogs, resolves every required compendium document before changing the actor, then idempotently grants dogma features and prepared spells. Existing paladin daily preparation explicitly excludes dogma-managed spells.

**Tech Stack:** Foundry VTT v13 document APIs, dnd5e item data, JavaScript ES modules, Node test runner.

---

### Task 1: Add the authoritative dogma catalog

**Files:**
- Create: `scripts/data/paladin-dogmas.js`
- Test: `tests/paladin-dogmas.test.mjs`

**Step 1: Write the failing catalog tests**

Cover:

```js
assert.equal(PALADIN_OATHS.length, 7);
assert.deepEqual(PALADIN_DOGMA_LEVELS, [3, 5, 9, 13, 17]);
for (const oath of PALADIN_OATHS) {
  for (const level of PALADIN_DOGMA_LEVELS) {
    assert.equal(getPaladinDogmas(oath.id, level).length, 2);
  }
}
```

Also assert 70 unique dogma IDs, required tenet text, and RU/EN spell names plus a stable spell identifier.

**Step 2: Run the focused test and verify it fails**

Run: `node --test tests/paladin-dogmas.test.mjs`

Expected: FAIL because the catalog module does not exist.

**Step 3: Implement the catalog**

Export:

```js
export const PALADIN_DOGMA_LEVELS = Object.freeze([3, 5, 9, 13, 17]);
export const PALADIN_OATHS = Object.freeze([...]);
export function getPaladinOath(oathId) {}
export function getPaladinDogmas(oathId, level) {}
export function getPaladinDogma(dogmaId) {}
```

Each oath contains exactly two dogmas at every threshold. Each dogma contains:

```js
{
  id,
  oathId,
  oathName,
  level,
  tenet,
  spell: { identifier, nameEn, nameRu }
}
```

Copy the approved text and spell mapping from the design/source without paraphrasing.

**Step 4: Run the focused test and verify it passes**

Run: `node --test tests/paladin-dogmas.test.mjs`

Expected: PASS.

### Task 2: Publish readable dogma features in the class compendium

**Files:**
- Modify: `scripts/data/classes-compendium.js`
- Modify: `tests/classes-compendium.test.mjs`

**Step 1: Write failing compendium tests**

Assert that the paladin class produces 70 additional `paladinDogma` definitions; each has a stable feature ID, oath/level/spell flags, and a readable description containing the full tenet and linked spell name. Assert non-paladin classes do not receive them.

**Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/classes-compendium.test.mjs`

Expected: FAIL on the new dogma assertions.

**Step 3: Add dogma feature definitions**

Import the catalog and append dogma definitions only for `paladin-rework-v01`. Use stable IDs such as:

```js
paladin-rework-v01::paladinDogma::<dogmaId>
```

Store the complete metadata under `flags.rebreya-main.paladinDogma`, make the feature description readable, place dogmas under oath-specific folders, include dogma metadata in the sync signature, and bump the class-feature template version.

**Step 4: Run the focused tests and verify they pass**

Run: `node --test tests/classes-compendium.test.mjs`

Expected: PASS.

**Step 5: Commit the catalog and compendium layer**

```powershell
git add scripts/data/paladin-dogmas.js scripts/data/classes-compendium.js tests/paladin-dogmas.test.mjs tests/classes-compendium.test.mjs
git commit -m "feat: add paladin dogma catalog"
```

### Task 3: Implement the choice and grant service

**Files:**
- Create: `scripts/combat/paladin-dogma-automation-service.js`
- Create: `tests/paladin-dogma-automation-service.test.mjs`

**Step 1: Write failing service tests**

Cover:

- normal paladin choices occur at reached missing thresholds in ascending order;
- the owned paladin subclass determines the oath;
- every dialog requires one choice and accepts two choices;
- skipped levels are reconciled sequentially;
- the dedication feat first chooses one oath, then one or two level-3 dogmas;
- dedication choices are independent from class choices;
- cancelling a dialog does not mutate actor items or flags;
- all dogma and spell documents resolve before any mutation;
- an unresolved spell warns and prevents that choice from being saved/granted;
- existing spells are reused, marked as dogma spells, and prepared;
- repeated reconciliation is idempotent;
- one spell shared by multiple dogmas retains all source dogma IDs.

Use injected resolvers and chooser functions so unit tests do not depend on Foundry dialogs or compendium globals.

**Step 2: Run the focused tests and verify they fail**

Run: `node --test tests/paladin-dogma-automation-service.test.mjs`

Expected: FAIL because the service does not exist.

**Step 3: Implement the service core**

Create `PaladinDogmaAutomationService` with:

```js
handleCreatedItem(item, options = {}, userId = "")
handleUpdatedItem(item, changed = {}, options = {}, userId = "")
reconcileActor(actor, context = {})
```

Store controller selections under:

```js
flags.rebreya-main.paladinDogmaChoices
```

Store managed provenance under:

```js
flags.rebreya-main.paladinDogma
flags.rebreya-main.paladinDogmaSpell = { dogmaIds: [...] }
```

Default chooser UI uses `DialogV2.wait`: an oath selector where needed, followed by a checkbox list limited to one or two dogmas. Do not require a spellcasting feature. Resolve dogma compendium documents and spells by identifier, then EN/RU name, preferring Rebreya and dnd5e spell compendiums.

Before actor mutations, resolve and prepare all required item data. Clone the dogma feature and spell documents, mark spells always prepared, merge source dogma IDs on reused spells, and suppress recursive hook reconciliation through operation options.

**Step 4: Run the focused tests and verify they pass**

Run: `node --test tests/paladin-dogma-automation-service.test.mjs`

Expected: PASS.

### Task 4: Integrate hooks and protect dogma spells from daily preparation

**Files:**
- Modify: `scripts/combat/paladin-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/paladin-automation-service.test.mjs`
- Modify: `tests/module-manifest.test.mjs`
- Modify: `tests/paladin-dogma-automation-service.test.mjs`

**Step 1: Write failing integration tests**

Assert:

- daily paladin preparation does not classify or unprepare a dogma-managed spell;
- `createItem` and relevant `updateItem` hooks dispatch to the dogma service;
- recursive service operations are ignored;
- main constructs and exposes the dogma service;
- the hook cache-busting import version matches the updated module.

**Step 2: Run focused tests and verify they fail**

Run:

```powershell
node --test tests/paladin-automation-service.test.mjs tests/paladin-dogma-automation-service.test.mjs tests/module-manifest.test.mjs
```

Expected: FAIL on new integration assertions.

**Step 3: Wire the service**

Instantiate `PaladinDogmaAutomationService` in the module. Register owned-item create/update hooks next to the existing paladin automation hooks. Ignore operations carrying the dogma-service recursion guard. Update the hooks import cache suffix.

Change existing paladin daily-preparation detection so an item with `flags.rebreya-main.paladinDogmaSpell` is never treated as a normal managed prepared spell. When a dogma spell is externally unprepared, reconcile it back to prepared without opening a new choice.

**Step 4: Run focused integration tests and verify they pass**

Run the focused command from Step 2.

Expected: PASS.

**Step 5: Commit automation and integration**

```powershell
git add scripts/combat/paladin-dogma-automation-service.js scripts/combat/paladin-automation-service.js scripts/combat/hooks.js scripts/main.js tests/paladin-dogma-automation-service.test.mjs tests/paladin-automation-service.test.mjs tests/module-manifest.test.mjs
git commit -m "feat: automate paladin dogma choices"
```

### Task 5: Verify, review, and publish

**Files:**
- Verify all files changed by Tasks 1–4

**Step 1: Review repository state and diff**

Run:

```powershell
git status --short --branch
git diff origin/lich_branch...HEAD --check
git diff origin/lich_branch...HEAD --stat
```

Confirm `Trace-20260724T044510.json` remains untracked and unstaged.

**Step 2: Run the focused suite**

Run:

```powershell
node --test tests/paladin-dogmas.test.mjs tests/classes-compendium.test.mjs tests/paladin-dogma-automation-service.test.mjs tests/paladin-automation-service.test.mjs tests/module-manifest.test.mjs
```

Expected: PASS.

**Step 3: Run the full available suite**

Run the repository test command from `package.json`, or `node --test tests/*.test.mjs` if no script exists.

Expected: PASS except any already documented, unchanged baseline failure; verify any failure against the pre-change baseline.

**Step 4: Inspect final commits and push**

Run:

```powershell
git log --oneline origin/lich_branch..HEAD
git push origin lich_branch
```

Do not force-push.
