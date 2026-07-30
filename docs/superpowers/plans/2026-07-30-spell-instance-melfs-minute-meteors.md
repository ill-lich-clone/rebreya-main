# Spell Instance Runtime and Melf's Minute Meteors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a reusable persisted spell-instance runtime and prove it with a complete Midi-QOL automation of Melf's Minute Meteors.

**Architecture:** `SpellInstanceRuntime` stores recipe-neutral state in a module-owned native ActiveEffect attached to the caster and dependent on DnD5e's concentration effect. All state transitions are serialized and idempotent by `actorUuid + instanceId + operationId`, with optimistic `revision` checks. The Melf recipe registers through the foundation registry, creates the instance only after a successful cast, and resolves every meteor as a separate child save Activity workflow and separate 5-foot template.

**Tech Stack:** Foundry VTT 13, DnD5e 5.2.5, Midi-QOL 13.0.61, native ActiveEffect and Activity APIs, existing `WorldMutationCoordinator`, existing `SocketCommandBus`, native ES modules, Node.js built-in test runner.

## Global Constraints

- This plan depends on `2026-07-30-spell-automation-foundation.md` being fully implemented and passing.
- Work only on `lich_branch`; fetch `origin`, verify a clean shared worktree, and stop on foreign changes or conflicts.
- Do not modify the existing Counterspell state machine.
- Do not modify Craftsman constructor files, flags, actors, summon hook, or tests.
- The parent cast can be Counterspelled normally. Child `Meteor Burst` workflows set `usageConfig[MODULE_ID].spellAutomationChild = true`, so they are not new spell casts, spend no spell slot, do not reopen Counterspell, and do not recurse into the Melf recipe.
- Meteor resolution is a Dexterity saving throw, never an attack roll.
- Every meteor gets an independent 5-foot-radius template, save workflow, damage application, and commit.
- `2d6` fire damage is halved on a successful save; Midi-QOL remains authoritative for resistance, immunity, saves, and applied damage.
- Initial cast permits 0, 1, or 2 meteors. Later bonus-action use permits 1 or 2.
- At spell level 3 the pool is 6; each higher slot level adds 2.
- Do not perform a world scan, repair pass, timer, or document write during `ready`.
- A canceled template placement spends no meteor. If the first meteor committed and the second is canceled or fails, the first remains spent and the bonus action remains used.
- Never attempt to roll back damage already applied by Midi-QOL.
- A missing or deleted instance effect makes subsequent release unavailable.
- If instance creation fails after the cast, leave the normal DnD5e concentration effect intact, skip the initial volley, and show exactly one error.

---

## Public Interfaces and File Map

### New production files

- `scripts/combat/spell-instance-runtime.js`
- `scripts/combat/melfs-minute-meteors-recipe.js`
- `scripts/data/melfs-minute-meteors-item.js`
- `scripts/integrations/spell-instance-socket.js`

### Modified production/data files

- `scripts/data/spells-compendium.js`
- `data/rebreya-spells-v01.json`
- `scripts/main.js`

### New tests

- `tests/spell-instance-runtime.test.mjs`
- `tests/spell-instance-socket.test.mjs`
- `tests/melfs-minute-meteors-item.test.mjs`
- `tests/melfs-minute-meteors-recipe.test.mjs`

### Modified tests

- `tests/spells-compendium.test.mjs`
- `tests/main-composition-root.test.mjs`

### New verification artifact

- `docs/benchmarks/2026-07-30-spell-runtime-world-load.md`

The persisted flag is:

```js
flags["rebreya-main"].spellInstance = {
  runtime: "instance",
  recipe: "melfs-minute-meteors",
  version: 1,
  instanceId: "stable-operation-derived-id",
  sourceActorUuid: "Actor...",
  sourceItemUuid: "Actor....Item...",
  sourceActivityUuid: "Actor....Item....Activity...",
  concentrationEffectUuid: "Actor....ActiveEffect...",
  createdOperationId: "operation-id",
  revision: 0,
  state: {
    slotLevel: 3,
    remainingMeteors: 6
  }
};
```

The runtime API is:

```js
const runtime = new SpellInstanceRuntime({
  registry,
  coordinator,
  socketCommandBus,
  fromUuid,
  isActiveGmClient,
  currentUserCanUpdate,
  operationIdFactory
});

runtime.registerRecipe(recipe);
runtime.createInstance(context, initialState);
runtime.readInstance({ actor, recipe, version, instanceId });
runtime.runInstanceOperation({ actor, instanceId, operationId }, operation);
runtime.updateInstance({ actor, instanceId, expectedRevision, state });
runtime.deleteInstance({ actor, instanceId, expectedRevision });
runtime.handleSocketMutation(payload, commandContext);
```

Recipe contract:

```js
{
  recipe: "melfs-minute-meteors",
  version: 1,
  validateState(state) {},
  buildInitialState(context) {},
  buildEffectData(context, state) {},
  handlers: {
    preUseActivity(context) {},
    postUseActivity(context) {},
    activeEffectChanged(context) {}
  }
}
```

---

### Task 1: Verify Dependency and Capture the Pre-Melf Baseline

**Files:**

- Test only: existing repository
- Create later: `docs/benchmarks/2026-07-30-spell-runtime-world-load.md`

- [ ] **Step 1: Verify Git and foundation**

Run:

```powershell
git status --short --branch
git branch --show-current
git fetch origin
git merge-base --is-ancestor origin/main HEAD
node --test tests/spell-automation-registry.test.mjs tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs tests/spell-automation-entrypoints.test.mjs
```

Expected: clean `lich_branch`, current foundation tests pass.

- [ ] **Step 2: Capture at least 20 warm live world starts before Melf composition**

Use the same Foundry world, browser profile, module set, cache state, and DOM-ready marker for every sample. Discard cold-start setup measurements and record at least 20 warm samples.

Record:

```markdown
## Before SpellInstanceRuntime

- Foundry:
- DnD5e:
- Midi-QOL:
- Rebreya commit:
- DOM-ready marker:
- Warm samples (ms):
- Median (ms):
- World-document writes during quiet ready window:
```

Expected: a reproducible baseline, not a single timing.

---

### Task 2: Implement Persisted Spell Instances

**Files:**

- Create: `tests/spell-instance-runtime.test.mjs`
- Create: `scripts/combat/spell-instance-runtime.js`

- [ ] **Step 1: Write failing state lifecycle tests**

Cover:

```js
test("creates one module-owned ActiveEffect after a successful cast", async () => {});
test("persists recipe version source uuids operation id revision and state", async () => {});
test("links the state effect to the native concentration effect", async () => {});
test("reads only the current actor effects and never scans the world", () => {});
test("returns an existing instance for a repeated create operation id", async () => {});
test("serializes concurrent operations for one instance", async () => {});
test("rejects a stale expected revision without losing state", async () => {});
test("increments revision exactly once per committed update", async () => {});
test("deletes the effect at terminal state", async () => {});
test("a deleted effect blocks later operations", async () => {});
test("instance creation failure leaves concentration untouched", async () => {});
```

Fixtures must count `createEmbeddedDocuments`, `update`, and `deleteEmbeddedDocuments` calls.

- [ ] **Step 2: Run the tests and verify the expected failure**

```powershell
node --test tests/spell-instance-runtime.test.mjs
```

Expected: FAIL because the runtime file is missing.

- [ ] **Step 3: Implement validation and local lookup**

Export:

```js
export const SPELL_INSTANCE_FLAG = "spellInstance";

export function readSpellInstance(effect) {}
export function buildSpellInstanceEffectData(context, declaration, state) {}
export function findSpellInstance(actor, query) {}
```

Rules:

- require positive integer `version` and non-negative integer `revision`;
- validate serializable plain-object `state`;
- match only `actor.effects`;
- never fall back to `game.actors`, canvas tokens, or scene scans;
- preserve unknown recipe state fields through round trips;
- mark the effect `transfer: false`, `disabled: false`, and use the source Item UUID as `origin`.

- [ ] **Step 4: Implement create/update/delete with idempotency**

Use:

```js
const key = `spell-instance:${actor.uuid}:${instanceId}`;
return coordinator.runIdempotent(key, operationId, async () => {
  // Re-read actor.effects inside the lock.
  // Validate expected revision immediately before the write.
  // Perform one create, update, or delete.
});
```

Link dependencies through an injected function whose production default calls:

```js
await globalThis.MidiQOL?.addDependent?.(concentrationEffect, instanceEffect);
```

If `addDependent` is unavailable, write the DnD5e-compatible dependency flag through the supported document API; do not update the normal concentration effect.

- [ ] **Step 5: Run state tests**

```powershell
node --test tests/spell-instance-runtime.test.mjs tests/world-mutation-infrastructure.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the runtime core**

```powershell
git add scripts/combat/spell-instance-runtime.js tests/spell-instance-runtime.test.mjs
git commit -m "feat: add persisted spell instance runtime"
```

---

### Task 3: Add Authorized Active-GM Mutation Routing

**Files:**

- Create: `tests/spell-instance-socket.test.mjs`
- Create: `scripts/integrations/spell-instance-socket.js`
- Modify: `scripts/combat/spell-instance-runtime.js`

- [ ] **Step 1: Write failing authority tests**

Cover:

```js
test("an owner performs the mutation locally", async () => {});
test("a non-owner requests the active GM once", async () => {});
test("validates the serialized action actor instance revision and operation id", () => {});
test("authorizes only a sender who owns the source actor or is GM", async () => {});
test("the active GM resolves only the payload actor uuid", async () => {});
test("a duplicate socket request is idempotent", async () => {});
test("rejects arbitrary update paths and foreign actor uuids", async () => {});
```

- [ ] **Step 2: Run the test and verify the expected failure**

```powershell
node --test tests/spell-instance-socket.test.mjs
```

Expected: FAIL because the socket integration is missing.

- [ ] **Step 3: Implement a closed mutation protocol**

Export:

```js
export const SPELL_INSTANCE_MUTATION_COMMAND = "spell-instance-mutation";

export function registerSpellInstanceSocketCommand(moduleApi) {}
export function isValidSpellInstanceMutationPayload(payload) {}
```

Allowed actions are exactly:

```js
["create", "replace-state", "delete"]
```

Payloads contain UUIDs, versioned declaration, expected revision, operation ID, and serializable state. They never contain an arbitrary property path, executable code, handler name, or full Actor document.

Register through:

```js
moduleApi.socketCommandBus.register(SPELL_INSTANCE_MUTATION_COMMAND, {
  validate,
  authorize,
  execute
});
```

- [ ] **Step 4: Route runtime mutations**

When the current client can update the actor, call the local coordinator path. Otherwise:

```js
return this.socketCommandBus.request(
  SPELL_INSTANCE_MUTATION_COMMAND,
  payload
);
```

The GM re-resolves `actorUuid` with `fromUuid`, re-validates sender ownership and revision, then uses the same local runtime method.

- [ ] **Step 5: Run authority tests**

```powershell
node --test tests/spell-instance-socket.test.mjs tests/spell-instance-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit authority routing**

```powershell
git add scripts/integrations/spell-instance-socket.js scripts/combat/spell-instance-runtime.js tests/spell-instance-socket.test.mjs tests/spell-instance-runtime.test.mjs
git commit -m "feat: route spell instance mutations"
```

---

### Task 4: Build the Managed Melf Spell Item

**Files:**

- Create: `tests/melfs-minute-meteors-item.test.mjs`
- Create: `scripts/data/melfs-minute-meteors-item.js`
- Modify: `tests/spells-compendium.test.mjs`
- Modify: `scripts/data/spells-compendium.js`
- Modify: `data/rebreya-spells-v01.json`

- [ ] **Step 1: Write failing Item builder tests**

Assert stable 16-character IDs and these activities:

```js
{
  cast: {
    type: "utility",
    activation: { type: "action", value: 1 },
    automation: { runtime: "instance", recipe: "melfs-minute-meteors", version: 1, action: "cast" }
  },
  release: {
    type: "utility",
    activation: { type: "bonus", value: 1 },
    automation: { runtime: "instance", recipe: "melfs-minute-meteors", version: 1, action: "release" }
  },
  burst: {
    type: "save",
    save: { ability: ["dex"], dc: { calculation: "spellcasting" } },
    damage: { onSave: "half", parts: [["2d6", "fire"]] },
    target: { template: { type: "radius", size: "5", units: "ft" } },
    automation: { runtime: "instance", recipe: "melfs-minute-meteors", version: 1, action: "burst" }
  }
}
```

Also assert:

- spell level 3;
- concentration property and 10-minute duration;
- parent cast consumes/scales a spell slot;
- release and burst consume no spell slot;
- burst is not an attack;
- Item and Activity declarations are both present;
- no Craftsman flags.

- [ ] **Step 2: Run the Item tests and verify the expected failure**

```powershell
node --test tests/melfs-minute-meteors-item.test.mjs tests/spells-compendium.test.mjs
```

Expected: FAIL on the missing builder and definition.

- [ ] **Step 3: Implement a module-native Item builder**

Export:

```js
export const MELFS_MINUTE_METEORS_ID = "melfs-minute-meteors-rebreya";
export const MELFS_MINUTE_METEORS_RECIPE = "melfs-minute-meteors";
export const MELFS_MINUTE_METEORS_VERSION = 1;
export const MELFS_ACTIVITY_IDS = Object.freeze({
  CAST: "melfMeteorsCast1",
  RELEASE: "melfMeteorRel001",
  BURST: "melfMeteorBurst1"
});

export function buildMelfsMinuteMeteorsItem() {}
```

Validate every ID against `/^[A-Za-z0-9]{16}$/u` in tests. Use DnD5e 5.2.5 Activity field shapes copied from current native save/utility activities, not legacy Item action fields.

- [ ] **Step 4: Extend spell definitions without requiring an SRD source**

Add:

```json
{
  "id": "melfs-minute-meteors-rebreya",
  "builder": "melfs-minute-meteors",
  "version": 1
}
```

Keep Counterspell's `sourceIdentifier` route unchanged. `loadSpellDefinitions` must accept either:

```js
{ id, sourceIdentifier }
```

or:

```js
{ id, builder, version }
```

and reject incomplete/unknown definitions.

- [ ] **Step 5: Make spell compendium sync signature-based**

Replace unconditional `Item.implementation.updateDocuments` with `syncFlaggedManagedDocuments` using:

```js
sourceIdFlag: "spellId"
```

Every built Item stores:

```js
flags[MODULE_ID].managed = true;
flags[MODULE_ID].spellId = definition.id;
flags[MODULE_ID].signature = stableSignature;
```

The signature must change when the builder version or generated system/flags data changes. A second identical `sync()` must report `unchanged` and issue zero creates, updates, or deletes. Preserve existing unmanaged spells in the pack; only remove obsolete module-managed spell IDs.

- [ ] **Step 6: Run Item and compendium tests**

```powershell
node --test tests/melfs-minute-meteors-item.test.mjs tests/spells-compendium.test.mjs tests/managed-compendium-sync.test.mjs
```

Expected: PASS, including the original two Counterspell assertions.

- [ ] **Step 7: Commit managed spell data**

```powershell
git add scripts/data/melfs-minute-meteors-item.js scripts/data/spells-compendium.js data/rebreya-spells-v01.json tests/melfs-minute-meteors-item.test.mjs tests/spells-compendium.test.mjs
git commit -m "feat: add managed Melf spell item"
```

---

### Task 5: Implement the Melf Recipe

**Files:**

- Create: `tests/melfs-minute-meteors-recipe.test.mjs`
- Create: `scripts/combat/melfs-minute-meteors-recipe.js`

- [ ] **Step 1: Write failing pool and cast tests**

Cover:

```js
test("builds 6 meteors at slot level 3 and 2 more per higher level", () => {});
test("does not create an instance for a canceled or counterspelled cast", async () => {});
test("creates the instance only after a successful cast", async () => {});
test("offers 0 1 or 2 meteors after the successful cast", async () => {});
test("initial 0 keeps the full pool and consumes no bonus action", async () => {});
test("an instance creation error preserves concentration and skips release", async () => {});
```

Slot-level extraction order:

```js
usageConfig.spell.slot
workflow.castData.castLevel
workflow.itemLevel
item.system.level
```

Normalize to an integer of at least 3.

- [ ] **Step 2: Write failing release tests**

Cover:

```js
test("later release offers 1 or 2 and replays one bonus-action activity", async () => {});
test("canceling the count dialog prevents the bonus-action replay", async () => {});
test("each meteor invokes the burst Activity separately", async () => {});
test("each burst carries spellAutomationChild and the parent operation id", async () => {});
test("two meteors at the same point still produce two workflows", async () => {});
test("a canceled first template spends zero meteors", async () => {});
test("a canceled second template keeps the first commit", async () => {});
test("the final meteor deletes the instance effect", async () => {});
test("loss of concentration blocks later release", async () => {});
test("concurrent releases cannot overspend the pool", async () => {});
test("a repeated operation id cannot apply a second volley", async () => {});
test("a child burst neither consumes a slot nor recursively opens release", async () => {});
test("a post-damage failure never attempts a Midi damage rollback", async () => {});
```

- [ ] **Step 3: Run tests and verify the expected failure**

```powershell
node --test tests/melfs-minute-meteors-recipe.test.mjs
```

Expected: FAIL because the recipe module is missing.

- [ ] **Step 4: Implement recipe construction and dialogs**

Export:

```js
export function melfMeteorPool(slotLevel) {
  return 6 + Math.max(0, slotLevel - 3) * 2;
}

export function buildMelfsMinuteMeteorsRecipe({
  instanceRuntime,
  dialog,
  runActivity,
  notifyError,
  logger
} = {}) {}
```

The injected production dialog uses `foundry.applications.api.DialogV2.wait`. It returns:

```js
{ cancelled: boolean, count: 0 | 1 | 2 }
```

Initial mode renders buttons for `0`, `1`, and `2`; later mode renders `1`, `2`, and cancel.

- [ ] **Step 5: Implement the successful-cast handler**

For `action === "cast"` in `postUseActivity`:

1. verify the usage/workflow completed and was not canceled;
2. resolve the caster, source Item/Activity, cast level, and normal concentration effect;
3. call `createInstance`;
4. prompt for initial `0/1/2`;
5. if nonzero, call the same volley executor with `activationMode: "initial"`.

Do not delete or modify the normal concentration effect on failure.

- [ ] **Step 6: Implement deferred bonus-action release**

For `action === "release"` in `preUseActivity`:

```js
void prepareReleaseAndReplay(context);
return false;
```

The continuation:

1. reads the active instance;
2. asks for `1/2`;
3. calls the Release Activity exactly once with:

```js
{
  ...usageConfig,
  [MODULE_ID]: {
    ...usageConfig[MODULE_ID],
    spellAutomationChild: true,
    operationId
  }
}
```

4. only after a truthy completed release use, starts the selected volley.

This makes Midi-QOL/DnD5e own bonus-action enforcement while preventing Counterspell and recipe recursion.

- [ ] **Step 7: Implement one independent child save per meteor**

Resolve the `burst` Activity by stable ID. For each meteor, sequentially call the injected `runActivity`, whose production implementation uses:

```js
await globalThis.MidiQOL.completeActivityUse(burstActivity, {
  midiOptions: {
    configureDialog: false,
    workflowOptions: {
      autoRollDamage: "always",
      autoFastDamage: true
    }
  },
  [MODULE_ID]: {
    spellAutomationChild: true,
    operationId,
    instanceId,
    meteorIndex
  }
});
```

If the installed Midi API expects its config in the second/third argument, adapt the production adapter only; keep the recipe's injected `runActivity(activity, usageConfig)` contract stable.

After each truthy completed workflow:

- re-read the effect;
- decrement `remainingMeteors` by exactly 1;
- increment revision through the runtime;
- delete the effect instead of updating it when the result reaches 0.

Stop before the next meteor on cancellation or error.

- [ ] **Step 8: Run recipe tests**

```powershell
node --test tests/melfs-minute-meteors-recipe.test.mjs tests/spell-instance-runtime.test.mjs tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-service.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit the recipe**

```powershell
git add scripts/combat/melfs-minute-meteors-recipe.js tests/melfs-minute-meteors-recipe.test.mjs
git commit -m "feat: automate Melf meteor volleys"
```

---

### Task 6: Compose the Runtime and Recipe

**Files:**

- Modify: `scripts/main.js`
- Modify: `tests/main-composition-root.test.mjs`

- [ ] **Step 1: Add failing composition assertions**

Assert:

```js
this.spellInstanceRuntime = new SpellInstanceRuntime({
  registry: this.spellAutomationRegistry,
  coordinator: this.worldMutationCoordinator,
  socketCommandBus: this.socketCommandBus
});

this.melfsMinuteMeteorsRecipe = buildMelfsMinuteMeteorsRecipe({
  instanceRuntime: this.spellInstanceRuntime
});

this.spellInstanceRuntime.registerRecipe(this.melfsMinuteMeteorsRecipe);
```

Also assert `registerSpellInstanceSocketCommand(this)` is called from the existing typed socket command registration method.

- [ ] **Step 2: Run the composition test and verify the expected failure**

```powershell
node --test tests/main-composition-root.test.mjs
```

Expected: FAIL on missing composition.

- [ ] **Step 3: Wire the runtime in dependency order**

Construct it after `spellAutomationRegistry` and `socketCommandBus`, before hook registration. Registration must be pure in-memory work and produce no Foundry document writes.

- [ ] **Step 4: Add a public diagnostic snapshot**

Expose read-only diagnostics:

```js
getSpellAutomationDiagnostics() {
  return {
    recipes: this.spellAutomationRegistry.listKeys(),
    activeOperations: this.spellInstanceRuntime.activeOperationCount
  };
}
```

If `listKeys()` was not added in the foundation, add it as a frozen array and cover it in the registry test. Do not expose mutable declarations.

- [ ] **Step 5: Run focused regressions**

```powershell
node --test tests/main-composition-root.test.mjs tests/melfs-minute-meteors-recipe.test.mjs tests/spell-instance-runtime.test.mjs tests/spell-instance-socket.test.mjs tests/spell-automation-service.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit composition**

```powershell
git add scripts/main.js tests/main-composition-root.test.mjs
git commit -m "feat: compose Melf spell automation"
```

---

### Task 7: Live Foundry and Midi-QOL Acceptance Test

**Files:**

- Create: `docs/benchmarks/2026-07-30-spell-runtime-world-load.md`

- [ ] **Step 1: Open the requested Foundry profile**

Use profile `кодекс` and password `666`. Do not use, edit, import into, or cast from a player's character.

- [ ] **Step 2: Create an isolated test caster**

Create a new temporary GM-owned Actor such as `Codex — Melf Test`, place its token near a separate temporary target actor/token, and give only the test caster the managed Melf spell from the Rebreya spells compendium.

- [ ] **Step 3: Verify live cast cases**

Check:

1. level-3 cast creates 6 meteors;
2. upcast adds 2 per slot level;
3. initial choices 0, 1, and 2;
4. later choice 1 and 2 consumes one bonus action;
5. two different templates;
6. two templates at the same point remain separate;
7. successful and failed Dexterity saves;
8. fire resistance and immunity;
9. cancel first placement;
10. cancel second placement after first commit;
11. final meteor removes the state effect;
12. losing concentration blocks later release;
13. a nearby temporary caster Counterspells the parent cast;
14. child meteor bursts do not open Counterspell.

Capture console errors and document UUIDs for any failure. Delete only the temporary test actors/tokens created by this task when finished.

- [ ] **Step 4: Repeat the warm-start benchmark after composition**

Record at least 20 warm starts with the same method as Task 1:

```markdown
## After SpellInstanceRuntime and Melf

- Rebreya commit:
- Warm samples (ms):
- Median (ms):
- Delta (ms):
- Delta (%):
- World-document writes during quiet ready window:
```

Acceptance requires both:

```text
median delta <= 50 ms
median delta <= 5%
```

and zero repeated `updateItem`, `updateActiveEffect`, or other world-document writes in the quiet ready window.

- [ ] **Step 5: Diagnose before proceeding if the threshold fails**

Do not average away an outlier or change the marker. Use performance traces and hook/write logging to identify the source, add a failing regression test, fix it, and repeat the same 20-sample comparison.

- [ ] **Step 6: Commit the benchmark record**

```powershell
git add docs/benchmarks/2026-07-30-spell-runtime-world-load.md
git commit -m "test: record spell runtime world load"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run all affected tests**

```powershell
node --test tests/spell-automation-registry.test.mjs tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs tests/spell-instance-runtime.test.mjs tests/spell-instance-socket.test.mjs tests/melfs-minute-meteors-item.test.mjs tests/melfs-minute-meteors-recipe.test.mjs tests/spells-compendium.test.mjs tests/managed-compendium-sync.test.mjs tests/main-composition-root.test.mjs tests/spell-automation-service.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs tests/world-mutation-infrastructure.test.mjs
```

- [ ] **Step 2: Run the complete test suite**

```powershell
$testFiles = Get-ChildItem -LiteralPath tests -Filter *.test.mjs | ForEach-Object { $_.FullName }
node --test $testFiles
```

Expected: PASS.

- [ ] **Step 3: Inspect correctness and protected files**

```powershell
git status --short --branch
git diff --check
git diff --stat origin/main...HEAD
git diff --exit-code origin/main...HEAD -- scripts/combat/craftsman-constructor-service.js scripts/integrations/craftsman-gadget-hooks.js
rg -n "TODO|FIXME|placeholder|throw new Error\\(\"not implemented" scripts/combat/spell-instance-runtime.js scripts/combat/melfs-minute-meteors-recipe.js scripts/data/melfs-minute-meteors-item.js scripts/integrations/spell-instance-socket.js
```

Expected: no protected Craftsman diff and no placeholders.

- [ ] **Step 4: Push without force**

```powershell
git push -u origin lich_branch
```

Expected: successful non-force push.
