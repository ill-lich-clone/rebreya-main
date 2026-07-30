# Spell Automation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the reusable spell-automation registry, normalized hook bridge, and stable interception/area runtime entrypoints without migrating Counterspell or Craftsman.

**Architecture:** A pure `SpellAutomationRegistry` owns immutable versioned recipe declarations keyed by `runtime + recipe + version`. A focused `SpellAutomationHookBridge` extracts a declaration from the document that caused an event, rejects recursive child invocations, builds one normalized context, and dispatches only exact registry matches. A separate hook registrar wires Foundry, DnD5e, and Midi-QOL hooks once. `SpellInterceptionRuntime` and `SpellAreaRuntime` are deliberately inert public entrypoints for later recipes.

**Tech Stack:** Foundry VTT 13, DnD5e 5.2.5, Midi-QOL 13.0.61, native ES modules, Node.js built-in test runner.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main`/`master`.
- Before implementation, run `git status --short --branch`, `git branch --show-current`, `git fetch origin`, and verify `origin/main` is an ancestor of `HEAD`. Stop if there are foreign uncommitted changes or a merge conflict.
- Preserve the existing `SpellAutomationService` Counterspell state machine. It is not registered in the new runtime in this plan.
- Preserve `scripts/combat/craftsman-constructor-service.js` and `scripts/integrations/craftsman-gadget-hooks.js` byte-for-byte.
- Do not scan actors, scenes, items, effects, or tokens during `ready`.
- Do not create, update, or delete Foundry documents during runtime construction or hook registration.
- Hooks must be registered exactly once and perform an automation-flag check before any expensive work.
- Use `WorldMutationCoordinator.runIdempotent` only when a later recipe requests a mutation; the foundation itself performs no mutations.
- Keep Foundry globals injectable in unit tests.
- Every failure of an unmanaged event is fail-open. An explicitly managed pre-use event with an invalid or missing declaration is fail-closed with one user-visible warning.

---

## Public Interfaces and File Map

### New production files

- `scripts/combat/spell-automation-registry.js`
- `scripts/combat/spell-automation-hook-bridge.js`
- `scripts/combat/spell-interception-runtime.js`
- `scripts/combat/spell-area-runtime.js`
- `scripts/integrations/spell-automation-hooks.js`

### Modified production files

- `scripts/main.js`

### New tests

- `tests/spell-automation-registry.test.mjs`
- `tests/spell-automation-hook-bridge.test.mjs`
- `tests/spell-automation-hooks.test.mjs`
- `tests/spell-automation-entrypoints.test.mjs`

### Modified regression tests

- `tests/main-composition-root.test.mjs`

The declaration stored on an Activity or its parent Item is:

```js
flags["rebreya-main"].spellAutomation = {
  runtime: "instance",
  recipe: "melfs-minute-meteors",
  version: 1,
  action: "cast"
};
```

The `action` field is recipe data and is not part of the registry key.

The registry API is:

```js
const registry = new SpellAutomationRegistry();

registry.register({
  runtime: "instance",
  recipe: "melfs-minute-meteors",
  version: 1,
  handlers: {
    preUseActivity(context) {},
    postUseActivity(context) {},
    midiRollComplete(context) {},
    postSummon(context) {},
    activeEffectChanged(context) {},
    measuredTemplateChanged(context) {},
    combatTurnChanged(context) {}
  }
});

registry.resolve({ runtime, recipe, version });
registry.dispatch(eventName, declaration, context);
```

The normalized context shape is:

```js
{
  eventName,
  activity,
  item,
  actor,
  token,
  scene,
  workflow,
  document,
  usageConfig,
  dialogConfig,
  messageConfig,
  results,
  rawArgs,
  declaration,
  operationId,
  isChildInvocation
}
```

Unpopulated fields are `null` or empty objects, not omitted.

---

### Task 1: Verify the Shared Branch and Baseline

**Files:**

- Test only: existing repository

- [ ] **Step 1: Check the shared worktree and fetch the remote**

Run:

```powershell
git status --short --branch
git branch --show-current
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
```

Expected: clean worktree, current branch `lich_branch`, ancestor command exit `0`. Stop and report if any foreign changes or conflicts appear.

- [ ] **Step 2: Run the focused baseline**

Run:

```powershell
node --test tests/spell-automation-service.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs tests/main-composition-root.test.mjs
```

Expected: all tests pass before foundation changes.

---

### Task 2: Implement the Versioned Registry

**Files:**

- Create: `tests/spell-automation-registry.test.mjs`
- Create: `scripts/combat/spell-automation-registry.js`

- [ ] **Step 1: Write failing registry tests**

Cover:

```js
test("registers and resolves an exact runtime recipe version", () => {});
test("rejects malformed declarations and non-function handlers", () => {});
test("rejects a conflicting duplicate key", () => {});
test("returns null for an unknown version", () => {});
test("dispatches only the named handler with a frozen declaration", async () => {});
```

Assert that mutating the caller's original object after registration cannot change the stored declaration.

- [ ] **Step 2: Run the test and verify the expected failure**

Run:

```powershell
node --test tests/spell-automation-registry.test.mjs
```

Expected: FAIL because `scripts/combat/spell-automation-registry.js` does not exist.

- [ ] **Step 3: Add the minimal registry**

Implement:

```js
export const SPELL_AUTOMATION_RUNTIMES = Object.freeze({
  INSTANCE: "instance",
  SUMMON: "summon",
  INTERCEPTION: "interception",
  AREA: "area"
});

export function spellAutomationKey({ runtime, recipe, version } = {}) {
  // Validate non-empty runtime/recipe and positive integer version.
  // Return `${runtime}:${recipe}:v${version}`.
}

export class SpellAutomationRegistry {
  register(definition) {}
  resolve(declaration) {}
  dispatch(eventName, declaration, context) {}
}
```

Rules:

- copy and freeze the top-level definition and `handlers`;
- reject duplicate keys even if the same object is supplied twice;
- return `{ handled: false, value: undefined }` when a definition has no handler for the event;
- return `{ handled: true, value }` after calling a handler, where `value` is the handler's unwrapped synchronous value or Promise;
- expose no mutable internal `Map`.

- [ ] **Step 4: Run the registry tests**

Run:

```powershell
node --test tests/spell-automation-registry.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```powershell
git add scripts/combat/spell-automation-registry.js tests/spell-automation-registry.test.mjs
git commit -m "feat: add spell automation registry"
```

---

### Task 3: Normalize and Route Hook Context

**Files:**

- Create: `tests/spell-automation-hook-bridge.test.mjs`
- Create: `scripts/combat/spell-automation-hook-bridge.js`

- [ ] **Step 1: Write failing bridge tests**

Cover:

```js
test("reads an activity declaration before the item declaration", () => {});
test("ignores an activity with no new spellAutomation declaration", () => {});
test("ignores legacy craftsmanConstructor flags", () => {});
test("marks spellAutomationChild and spellAutomationBypass as child invocations", () => {});
test("builds the same normalized fields for dnd5e and midi events", () => {});
test("uses an existing operationId or creates one once per invocation", () => {});
test("dispatches an exact recipe and preserves the action field", async () => {});
test("fails closed for an explicitly managed unknown pre-use recipe", async () => {});
test("fails open for an unmanaged event and for non-blocking handler errors", async () => {});
```

Use plain fixture objects; do not install Foundry globals.

- [ ] **Step 2: Run the test and verify the expected failure**

```powershell
node --test tests/spell-automation-hook-bridge.test.mjs
```

Expected: FAIL because the bridge module does not exist.

- [ ] **Step 3: Implement declaration and operation helpers**

Export:

```js
export function readSpellAutomationDeclaration(source) {}
export function isSpellAutomationChildInvocation(usageConfig = {}) {}
export function buildSpellAutomationContext(eventName, rawArgs, options = {}) {}
```

Resolution order:

1. `activity.flags[MODULE_ID].spellAutomation`
2. `activity.item.flags[MODULE_ID].spellAutomation`
3. event document's own module flag

Do not treat the existing Counterspell `kind: "counterspell"` flag or Craftsman flags as new declarations.

Generate operation IDs through an injected `operationIdFactory`; production fallback is:

```js
() => globalThis.foundry?.utils?.randomID?.(16)
  ?? globalThis.crypto?.randomUUID?.()
  ?? `spell-${Date.now()}-${Math.random().toString(36).slice(2)}`
```

- [ ] **Step 4: Implement `SpellAutomationHookBridge`**

Use this public surface:

```js
export class SpellAutomationHookBridge {
  constructor({
    registry,
    operationIdFactory,
    notifyWarning,
    logger
  } = {}) {}

  handlePreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {}
  handlePostUseActivity(activity, usageConfig, results) {}
  handleMidiRollComplete(workflow) {}
  handlePostSummon(activity, profile, tokens, summonOptions) {}
  handleActiveEffectChanged(changeType, effect, changed, options) {}
  handleMeasuredTemplateChanged(changeType, template, changed, options) {}
  handleCombatTurnChanged(combat, prior, current) {}
}
```

`handlePreUseActivity` must remain synchronous for the DnD5e pre-hook contract. Recipe pre-use handlers therefore return `true`/`false` synchronously and may start their own guarded asynchronous continuation. Other bridge methods return promises and catch errors at the hook boundary.

The bridge must reject a Promise returned by a `preUseActivity` handler as a recipe contract error and fail closed for that explicitly managed use. For asynchronous hook phases it wraps the registry value with `Promise.resolve`.

Child invocations return `true` immediately and are not dispatched. This keeps child save workflows out of Counterspell and out of their own parent recipe.

- [ ] **Step 5: Run the bridge and registry tests**

```powershell
node --test tests/spell-automation-registry.test.mjs tests/spell-automation-hook-bridge.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the bridge**

```powershell
git add scripts/combat/spell-automation-hook-bridge.js tests/spell-automation-hook-bridge.test.mjs
git commit -m "feat: add spell automation hook bridge"
```

---

### Task 4: Add Stable Interception and Area Entrypoints

**Files:**

- Create: `tests/spell-automation-entrypoints.test.mjs`
- Create: `scripts/combat/spell-interception-runtime.js`
- Create: `scripts/combat/spell-area-runtime.js`

- [ ] **Step 1: Write failing entrypoint tests**

Cover:

```js
test("interception runtime exposes a versioned recipe registration entrypoint", () => {});
test("area runtime exposes template region and turn entrypoints", () => {});
test("empty runtimes perform no document lookup or mutation", async () => {});
```

Inject lookup/mutation spies and assert zero calls.

- [ ] **Step 2: Run the test and verify the expected failure**

```powershell
node --test tests/spell-automation-entrypoints.test.mjs
```

Expected: FAIL because both runtime modules are missing.

- [ ] **Step 3: Implement inert runtime shells**

Use:

```js
export class SpellInterceptionRuntime {
  constructor({ registry } = {}) {}
  registerRecipe({ recipe, version, handlers }) {}
}

export class SpellAreaRuntime {
  constructor({ registry } = {}) {}
  registerRecipe({ recipe, version, handlers }) {}
}
```

Each `registerRecipe` delegates to the shared registry with its fixed runtime name. Do not register a default recipe, subscribe to hooks, scan the world, or mutate a document.

- [ ] **Step 4: Run the entrypoint and registry tests**

```powershell
node --test tests/spell-automation-entrypoints.test.mjs tests/spell-automation-registry.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the entrypoints**

```powershell
git add scripts/combat/spell-interception-runtime.js scripts/combat/spell-area-runtime.js tests/spell-automation-entrypoints.test.mjs
git commit -m "feat: add spell runtime entrypoints"
```

---

### Task 5: Register the Shared Hooks Exactly Once

**Files:**

- Create: `tests/spell-automation-hooks.test.mjs`
- Create: `scripts/integrations/spell-automation-hooks.js`

- [ ] **Step 1: Write failing hook-registration tests**

Use an injected fake `Hooks` object and cover:

```js
test("registers every bridge hook once", () => {});
test("a second registration is idempotent", () => {});
test("preUse returns the bridge boolean synchronously", () => {});
test("async hooks report errors without rejecting Foundry hooks", async () => {});
test("postSummon remains available to the separate Craftsman hook", async () => {});
```

Expected hook set:

```js
[
  "dnd5e.preUseActivity",
  "dnd5e.postUseActivity",
  "midi-qol.RollComplete",
  "dnd5e.postSummon",
  "createActiveEffect",
  "updateActiveEffect",
  "deleteActiveEffect",
  "createMeasuredTemplate",
  "updateMeasuredTemplate",
  "deleteMeasuredTemplate",
  "combatTurnChange"
]
```

- [ ] **Step 2: Run the test and verify the expected failure**

```powershell
node --test tests/spell-automation-hooks.test.mjs
```

Expected: FAIL because the hook registrar is missing.

- [ ] **Step 3: Implement the focused registrar**

Export:

```js
export function registerSpellAutomationHooks(moduleApi, {
  Hooks = globalThis.Hooks,
  game = globalThis.game
} = {}) {}
```

Use a game-scoped key such as `${MODULE_ID}.spellAutomationHooksRegistered`. Do not add these registrations to the already large `scripts/combat/hooks.js`.

For asynchronous callbacks, use:

```js
Promise.resolve(operation()).catch((error) => {
  console.error(`${MODULE_ID} | Failed to route spell automation hook.`, error);
});
return true;
```

- [ ] **Step 4: Run hook tests**

```powershell
node --test tests/spell-automation-hooks.test.mjs tests/spell-automation-hook-bridge.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit hook registration**

```powershell
git add scripts/integrations/spell-automation-hooks.js tests/spell-automation-hooks.test.mjs
git commit -m "feat: register shared spell automation hooks"
```

---

### Task 6: Compose the Foundation Without Touching Legacy Automations

**Files:**

- Modify: `scripts/main.js`
- Modify: `tests/main-composition-root.test.mjs`

- [ ] **Step 1: Add failing composition assertions**

Assert that `RebreyaMainModule` constructs:

```js
moduleApi.spellAutomationRegistry
moduleApi.spellAutomationHookBridge
moduleApi.spellInterceptionRuntime
moduleApi.spellAreaRuntime
```

Also assert the source registers `registerSpellAutomationHooks(moduleApi)` in the `ready` block independently of `registerCombatHooks` and `registerCraftsmanGadgetHooks`.

- [ ] **Step 2: Run the composition test and verify the expected failure**

```powershell
node --test tests/main-composition-root.test.mjs
```

Expected: FAIL on the missing imports/composition.

- [ ] **Step 3: Wire the constructor**

Add imports and construct in dependency order:

```js
this.spellAutomationRegistry = new SpellAutomationRegistry();
this.spellInterceptionRuntime = new SpellInterceptionRuntime({
  registry: this.spellAutomationRegistry
});
this.spellAreaRuntime = new SpellAreaRuntime({
  registry: this.spellAutomationRegistry
});
this.spellAutomationHookBridge = new SpellAutomationHookBridge({
  registry: this.spellAutomationRegistry
});
```

Keep:

```js
this.spellAutomationService = COUNTERSPELL_AUTOMATION_ENABLED
  ? new SpellAutomationService(this)
  : null;
```

unchanged.

- [ ] **Step 4: Register the new focused hooks**

In the `ready` block, add a separate guarded call:

```js
try {
  registerSpellAutomationHooks(moduleApi);
}
catch (error) {
  console.error(`${MODULE_ID} | Failed to register spell automation hooks.`, error);
}
```

Do not move or edit the Craftsman registration block.

- [ ] **Step 5: Run focused regressions**

```powershell
node --test tests/main-composition-root.test.mjs tests/spell-automation-hooks.test.mjs tests/spell-automation-service.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit composition**

```powershell
git add scripts/main.js tests/main-composition-root.test.mjs
git commit -m "feat: compose spell automation foundation"
```

---

### Task 7: Verify Foundation Performance Invariants

**Files:**

- Modify: `tests/spell-automation-hook-bridge.test.mjs`
- Modify: `tests/spell-automation-hooks.test.mjs`

- [ ] **Step 1: Add no-work fast-path assertions**

Instrument registry resolution, document lookup, timers, and mutation spies. Dispatch 1,000 unmanaged activities:

```js
for (let index = 0; index < 1_000; index += 1) {
  assert.equal(bridge.handlePreUseActivity({ flags: {} }, {}, {}, {}), true);
}
```

Assert:

- zero registry dispatch calls;
- zero document lookups;
- zero mutations;
- zero timers;
- zero notifications.

- [ ] **Step 2: Add source-level ready invariants**

Read the new runtime files and assert they contain none of:

```js
["game.actors", "game.scenes", "setInterval(", "updateEmbeddedDocuments(", "createEmbeddedDocuments("]
```

This is a guardrail, not the live performance acceptance test.

- [ ] **Step 3: Run the foundation suite**

```powershell
node --test tests/spell-automation-registry.test.mjs tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs tests/spell-automation-entrypoints.test.mjs tests/main-composition-root.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit performance guards**

```powershell
git add tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs
git commit -m "test: guard spell automation fast paths"
```

---

### Task 8: Final Foundation Verification

- [ ] **Step 1: Run all directly affected tests**

```powershell
node --test tests/spell-automation-registry.test.mjs tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs tests/spell-automation-entrypoints.test.mjs tests/main-composition-root.test.mjs tests/spell-automation-service.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs tests/world-mutation-infrastructure.test.mjs
```

- [ ] **Step 2: Run the complete test suite**

```powershell
$testFiles = Get-ChildItem -LiteralPath tests -Filter *.test.mjs | ForEach-Object { $_.FullName }
node --test $testFiles
```

Expected: PASS.

- [ ] **Step 3: Inspect the final diff**

```powershell
git status --short --branch
git diff --check
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- scripts/combat/spell-automation-registry.js scripts/combat/spell-automation-hook-bridge.js scripts/combat/spell-interception-runtime.js scripts/combat/spell-area-runtime.js scripts/integrations/spell-automation-hooks.js scripts/main.js
git diff --exit-code origin/main...HEAD -- scripts/combat/craftsman-constructor-service.js scripts/integrations/craftsman-gadget-hooks.js
```

Expected: clean diff check and no Craftsman changes.

- [ ] **Step 4: Push without force**

```powershell
git push -u origin lich_branch
```

Expected: successful non-force push.
