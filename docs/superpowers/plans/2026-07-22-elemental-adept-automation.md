# Elemental Adept Automation Implementation Plan

> **For Codex:** Follow `superpowers:test-driven-development` for each behavior change. Do not alter the user's unrelated work. Execute on `lich_branch`, run focused tests after every green step, then the full suite and live Foundry validation before push.

**Goal:** Turn each owned `Стихийный адепт` feat into an in-place, damage-type-specific feat and apply its spell-only die minimum, resistance bypass, and Midi-QOL absorption bypass.

**Architecture:** Add a focused `ElementalAdeptAutomationService` that owns feat configuration and combat calculations. The Item configuration lifecycle mirrors `magic-weapon-template.js`, while the completed-damage step is chained after Sorcerer rerolls in the existing combat hook. Generated feat data only marks the source feat as runtime-automated; it does not create choice Items.

**Tech stack:** Foundry VTT hooks and documents, dnd5e 5.2.5 roll/damage APIs, Midi-QOL damage calculation hooks, Node's built-in test runner.

---

## Task 1: Define and test owned-feat configuration

**Files:**

- Create: `scripts/combat/elemental-adept-automation-service.js`
- Create: `tests/elemental-adept-automation-service.test.mjs`

### Step 1: Write failing recognition and option tests

Create test fixtures for a character Actor and owned feat Items. Add tests asserting:

- only `type: "feat"` with `system.identifier: "stihiynyy-adept"` is recognized;
- the exported five choices use `acid`, `cold`, `fire`, `lightning`, and `thunder`;
- configured types on sibling feat copies are excluded;
- the current Item's own configured value does not hide itself during repair;
- non-character and compendium Items are ignored.

Run:

```powershell
node --test tests/elemental-adept-automation-service.test.mjs
```

Expected: RED because the service module does not exist.

### Step 2: Implement the minimal model helpers

In the new service module, add:

- stable constants for identifier, supported types, labels, and the Item flag path;
- safe Actor/Item resolution and collection normalization;
- `isElementalAdeptItem`, configured-type aggregation, and available-choice helpers;
- spell-subject and damage-type normalization helpers shared by later combat methods.

Keep helpers independent of browser globals where practical so tests can use plain objects.

Run the focused test and confirm GREEN.

### Step 3: Write failing mutation and lifecycle tests

Add tests asserting:

- the first owned copy receives subtype `general` before prompting;
- later copies receive subtype `minor`, including when the first is unresolved;
- selection mutates the same Item, renames it, retains `stihiynyy-adept`, and writes the configured flag;
- cancellation preserves classification and leaves the Item unresolved;
- a sheet-render repair prompts an unresolved copy;
- already configured copies do not prompt;
- a sixth unresolved copy is deleted when all types are owned;
- an unavailable concurrent selection is rejected and choices are refreshed;
- active player ownership wins over GM prompting, matching magic equipment behavior;
- recursive module update options are ignored.

Run the focused test and confirm RED for missing lifecycle behavior.

### Step 4: Implement configuration and prompt flow

Implement:

- an injected prompt function for tests and a default Foundry `Dialog` select UI;
- current-user/active-owner routing equivalent to `magic-weapon-template.js`;
- per-actor promise serialization plus per-Item pending guards;
- classification update before the prompt;
- choice revalidation immediately before Item update;
- safe unresolved-Item deletion when no choices remain;
- actor-sheet repair that processes unresolved copies sequentially;
- user notifications and fail-safe errors.

Use `flags.rebreya-main.elementalAdept` for configured state and a scoped skip option for service-originated updates.

Run:

```powershell
node --test tests/elemental-adept-automation-service.test.mjs
```

Expected: GREEN.

---

## Task 2: Implement spell damage die minimum through TDD

**Files:**

- Modify: `scripts/combat/elemental-adept-automation-service.js`
- Modify: `tests/elemental-adept-automation-service.test.mjs`

### Step 1: Write failing completed-roll tests

Add fake DamageRoll/Die terms and test:

- active results 1 and 2 become 3 for a selected damage type;
- active result 3+, inactive results, and rerolled/discarded results remain unchanged;
- nested die terms are traversed;
- a mixed fire/radiant roll list adjusts only selected fire rolls;
- non-spell activities, actors without configured copies, and unmatched types are unchanged;
- an Item spell and a spell-tagged non-spell source are both accepted;
- `_evaluateTotal()` refreshes `_total`;
- the parent chat message receives the final serialized rolls only when something changed;
- running the handler twice is idempotent.

Run the focused test and confirm RED.

### Step 2: Implement post-roll adjustment

Add `applyDnd5ePostDamageRoll(rolls, context)`:

- resolve the casting actor from the activity/subject;
- require semantic spell evidence from the activity, Item, roll properties, or spell damage marker;
- process each roll independently using `roll.options.type`/`types`;
- recursively collect die terms and replace only active numeric 1/2 results;
- recompute totals with the native evaluator;
- serialize chat-message writes per message and skip no-op writes.

Run the focused test and confirm GREEN.

---

## Task 3: Implement resistance and absorption bypass through TDD

**Files:**

- Modify: `scripts/combat/elemental-adept-automation-service.js`
- Modify: `tests/elemental-adept-automation-service.test.mjs`

### Step 1: Write failing damage-calculation tests

Test the Midi method with damage descriptions containing Sets:

- matching spell damage adds its type to both `options.ignore.resistance` and `options.ignore.absorption`;
- existing ignore Sets and values are preserved;
- immunity, vulnerability, modification, threshold, and save options are untouched;
- unmatched types and non-spell damage do nothing;
- source actor resolution works through `options.midi.sourceActorUuid` and an injected UUID resolver;
- multiple selected types are handled independently.

Test the native fallback:

- only `ignore.resistance` is added;
- ambiguous source attribution fails open without guessing;
- Midi-tagged calls are not processed twice by the native fallback.

Run the focused test and confirm RED.

### Step 2: Implement damage-calculation methods

Add:

- `applyMidiPreCalculateDamage(actor, damages, options)`;
- `applyDnd5ePreCalculateDamage(actor, damages, options)`;
- Set-safe ignore merging that tolerates absent or boolean ignore configurations;
- strict source actor and spell attribution;
- a per-options marker preventing duplicate fallback handling.

Run the focused test and confirm GREEN.

---

## Task 4: Register hooks and preserve Sorcerer ordering

**Files:**

- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/elemental-adept-automation-service.test.mjs`
- Modify: `tests/sorcerer-automation-service.test.mjs` only if the existing hook-order fixture is the tighter regression location

### Step 1: Write failing registration and ordering tests

Test that registration installs exactly one handler for:

- `createItem`;
- supported actor-sheet render hooks;
- `midi-qol.dnd5ePreCalculateDamage`;
- `dnd5e.preCalculateDamage`.

Test the existing `dnd5e.rollDamage` orchestration with both services:

1. Sorcerer Empowered Spell finishes its async reroll.
2. Elemental Adept applies the 1/2 minimum to the final rerolled result.
3. The resulting chat update contains both effects.

Run focused tests and confirm RED.

### Step 2: Wire the service

In `scripts/main.js`:

- import and instantiate `ElementalAdeptAutomationService`;
- register its Item/sheet/damage-calculation hooks during ready setup.

In `scripts/combat/hooks.js`:

- detect the service;
- change the existing `dnd5e.rollDamage` callback into one promise chain that awaits Sorcerer post-damage handling before Elemental Adept;
- retain error isolation so either service failing does not block normal dnd5e behavior.

Do not add a second independent `dnd5e.rollDamage` listener.

Run:

```powershell
node --test tests/elemental-adept-automation-service.test.mjs tests/sorcerer-automation-service.test.mjs
```

Expected: GREEN.

---

## Task 5: Mark generated feat data as runtime-automated

**Files:**

- Modify: `tools/apply-feat-automation.mjs`
- Modify: `cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-items.json`
- Modify: `cherty-v08-foundry-2014-import-pack/cherty-v08-foundry-2014-bundle.json`
- Modify: `docs/feat-automation-report.md`
- Modify: `tests/feats-compendium.test.mjs`

### Step 1: Write failing data assertions

Add assertions that `stihiynyy-adept`:

- remains one repeatable source feat;
- has no `ItemChoice` advancement and no generated choice-option Items;
- has full/runtime automation metadata describing the Elemental Adept service.

Run:

```powershell
node --test tests/feats-compendium.test.mjs
```

Expected: RED while the source remains marked manual.

### Step 2: Add curated runtime metadata and regenerate

Extend the feat automation generator with a narrow runtime-automation entry for `stihiynyy-adept`. It must suppress generic inferred activities/effects if they would misrepresent the passive behavior, while leaving the source description and repeatability intact.

Run:

```powershell
node tools/apply-feat-automation.mjs
node --test tests/feats-compendium.test.mjs tests/feat-choice-automation.test.mjs
```

Review the generated diff to ensure only intended Elemental Adept/report changes occurred. Revert or fix any unrelated generator churn before proceeding.

Expected: GREEN; no Elemental Adept choice-option documents.

---

## Task 6: Verification, live Foundry test, and delivery

**Files:**

- Modify if needed: `README.md` automation table
- Verify all files changed above

### Step 1: Run static and focused verification

```powershell
node --check scripts/combat/elemental-adept-automation-service.js
node --check scripts/combat/hooks.js
node --check scripts/main.js
node --test tests/elemental-adept-automation-service.test.mjs tests/feats-compendium.test.mjs tests/feat-choice-automation.test.mjs tests/sorcerer-automation-service.test.mjs
git diff --check
```

### Step 2: Run the complete suite

```powershell
node --test tests/*.test.mjs
```

Expected: all tests pass with no cancellations or unhandled rejections.

### Step 3: Validate in the live world

Open `https://vtt.rebreya.com/` with the supplied Codex profile and test actor `Actor.1Z9T8jbHwoAOTyTy`:

1. Add `Стихийный адепт` and choose fire.
2. Confirm the same Item becomes `Стихийный адепт: Огонь` and remains a general feat.
3. Add it again; confirm fire is hidden and the new copy is minor.
4. Cancel once, reopen the sheet, and confirm repair prompt returns.
5. Cast matching and non-matching spell damage from the spellbook and an alternate source such as a scroll/item.
6. Confirm matching dice display 1/2 as 3 in chat and unrelated damage is unchanged.
7. Combine with Empowered Spell and confirm final rerolled 1/2 values still become 3.
8. Apply matching damage to targets with resistance and Midi absorption; confirm both are ignored while immunity is retained.

Restore only temporary test changes made to the actor unless the user asks to keep them.

### Step 4: Review and publish

```powershell
git status --short --branch
git diff --stat origin/lich_branch...HEAD
git diff origin/lich_branch...HEAD
git add <only Elemental Adept files>
git diff --cached --check
git commit -m "feat(feats): automate elemental adept"
git push origin lich_branch
```

Do not force push. Confirm `lich_branch` is not behind `origin/main` or `origin/lich_branch` immediately before the push.
