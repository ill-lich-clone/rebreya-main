# Summon Lifecycle Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one reusable lifecycle engine for future native Foundry summons while leaving the current Craftsman constructor entirely on its legacy implementation.

**Architecture:** `SummonLifecycleRuntime` registers explicit versioned summon providers through `SpellAutomationRegistry`. A managed pre-use creates an in-memory operation claim; `dnd5e.preSummon` binds that claim to the concrete summon options object; `dnd5e.summonToken` stamps only tokens from that operation; and `dnd5e.postSummon` finalizes only tokens carrying the matching operation ID. The runtime writes a common `summonLink`, links tokens to a controlling effect when present, invokes provider-specific preparation/finalization through a closed contract, and rolls back only tokens created by the failed operation.

**Tech Stack:** Foundry VTT 13, DnD5e 5.2.5 native Summon Activity hooks, Midi-QOL 13.0.61 dependent-document API, existing spell automation registry/bridge, existing `WorldMutationCoordinator` and `SocketCommandBus`, native ES modules, Node.js built-in test runner.

## Global Constraints

- This plan depends on both preceding plans being fully implemented and passing: the spell-automation foundation first, then SpellInstanceRuntime and Melf.
- Work only on `lich_branch`; fetch and inspect the shared worktree before edits. Stop on foreign changes or conflicts.
- Do not migrate, refactor, wrap, reflag, or rewrite Craftsman in this plan.
- Preserve `flags[MODULE_ID].craftsmanConstructor` version 1 and the existing Craftsman `dnd5e.postSummon` listener.
- The new runtime matches only `flags[MODULE_ID].spellAutomation.runtime === "summon"` with an exact registered recipe/version.
- A native summon without the new declaration is an immediate no-op.
- Provider code never receives all scene tokens; it receives only the frozen token list for its operation ID.
- Every created token gets a common `summonLink` with source and controlling-effect UUIDs.
- A provider failure deletes only newly created tokens carrying that operation ID. It never deletes the source Actor, the source Item, a pre-existing token, or a token from another operation.
- No world scans, actor scans, scene scans, timers, repair passes, or document writes during `ready`.
- Claims are bounded and cleared on success, cancellation, failure, and timeout. Timeout cleanup is in-memory only.
- Hook registration is idempotent.
- Current Craftsman tests must pass without changing their expectations.

---

## Public Interfaces and File Map

### New production files

- `scripts/combat/summon-lifecycle-runtime.js`
- `scripts/integrations/summon-lifecycle-socket.js`

### Modified production files

- `scripts/combat/spell-automation-hook-bridge.js`
- `scripts/integrations/spell-automation-hooks.js`
- `scripts/main.js`

### New tests

- `tests/summon-lifecycle-runtime.test.mjs`
- `tests/summon-lifecycle-socket.test.mjs`

### Modified tests

- `tests/spell-automation-hook-bridge.test.mjs`
- `tests/spell-automation-hooks.test.mjs`
- `tests/main-composition-root.test.mjs`
- `tests/craftsman-gadget-hooks.test.mjs`

### Modified verification artifact

- `docs/benchmarks/2026-07-30-spell-runtime-world-load.md`

Provider registration:

```js
moduleApi.registerSummonProvider({
  recipe: "animate-objects",
  version: 1,
  validate(context) {},
  prepareToken(context) {},
  finalizeToken(context) {},
  finalizeSummon(context) {},
  cleanup(context) {}
});
```

Provider context:

```js
{
  operationId,
  declaration,
  activity,
  item,
  sourceActor,
  sourceToken,
  controllingEffect,
  profile,
  summonOptions,
  tokenData,
  token,
  tokens,
  config,
  mutate
}
```

Only the fields relevant to a lifecycle phase are populated.

Common persisted token flag:

```js
flags["rebreya-main"].summonLink = {
  runtime: "summon",
  recipe: "animate-objects",
  version: 1,
  operationId: "operation-id",
  sourceActorUuid: "Actor...",
  sourceTokenUuid: "Scene....Token...",
  sourceItemUuid: "Actor....Item...",
  sourceActivityUuid: "Actor....Item....Activity...",
  controllingEffectUuid: "Actor....ActiveEffect..."
};
```

Runtime API:

```js
const runtime = new SummonLifecycleRuntime({
  registry,
  coordinator,
  socketCommandBus,
  operationIdFactory,
  fromUuid,
  addDependent,
  claimTimeoutMs
});

runtime.registerProvider(provider);
runtime.claimPreUse(context);
runtime.bindPreSummon(context);
runtime.prepareSummonToken(context);
runtime.finalizeSummon(context);
runtime.handleSocketMutation(payload, commandContext);
runtime.pendingClaimCount;
```

---

### Task 1: Verify Dependencies and Protected Baseline

**Files:**

- Test only: existing repository

- [ ] **Step 1: Inspect the shared branch**

```powershell
git status --short --branch
git branch --show-current
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git rev-list --left-right --count origin/main...HEAD
```

Expected: clean `lich_branch` and no conflict with current `origin/main`.

- [ ] **Step 2: Run foundation and Craftsman baselines**

```powershell
node --test tests/spell-automation-registry.test.mjs tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs tests/spell-instance-runtime.test.mjs tests/melfs-minute-meteors-recipe.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs
```

Expected: PASS before summon runtime changes.

- [ ] **Step 3: Record protected file hashes**

```powershell
git hash-object scripts/combat/craftsman-constructor-service.js scripts/integrations/craftsman-gadget-hooks.js scripts/data/craftsman-construct-definitions.js
```

Save the three hashes in the implementation notes and compare them in final verification.

---

### Task 2: Implement Provider Registration and Operation Claims

**Files:**

- Create: `tests/summon-lifecycle-runtime.test.mjs`
- Create: `scripts/combat/summon-lifecycle-runtime.js`

- [ ] **Step 1: Write failing provider registration tests**

Cover:

```js
test("registers an explicit summon recipe through the shared registry", () => {});
test("rejects duplicate providers and malformed lifecycle callbacks", () => {});
test("ignores an unmanaged native summon", () => {});
test("ignores the legacy craftsmanConstructor declaration", () => {});
test("returns a frozen provider token list", async () => {});
```

- [ ] **Step 2: Write failing claim tests**

Cover:

```js
test("pre-use creates one operation claim for a managed summon", () => {});
test("repeated pre-use with the same operation id reuses the claim", () => {});
test("preSummon binds the oldest matching activity claim to the options object", () => {});
test("an explicit options operation id wins over FIFO fallback", () => {});
test("parallel activities keep distinct claims", () => {});
test("cancellation and failure clear the claim", () => {});
test("expired claims are removed in memory without document work", () => {});
test("claim count remains bounded", () => {});
```

Use an injected clock. Do not use a real `setInterval`; prune expired claims on access.

- [ ] **Step 3: Run tests and verify the expected failure**

```powershell
node --test tests/summon-lifecycle-runtime.test.mjs
```

Expected: FAIL because the runtime file is missing.

- [ ] **Step 4: Implement provider validation**

Export:

```js
export const SUMMON_LINK_FLAG = "summonLink";

export function buildSummonLink({ declaration, operationId, activity, sourceToken, controllingEffect }) {}
export function readSummonLink(token) {}

export class SummonLifecycleRuntime {
  registerProvider(provider) {}
  claimPreUse(context) {}
  bindPreSummon(context) {}
  prepareSummonToken(context) {}
  finalizeSummon(context) {}
}
```

Allow only these optional provider callbacks:

```js
["validate", "prepareToken", "finalizeToken", "finalizeSummon", "cleanup"]
```

Reject unknown executable lifecycle fields so providers cannot bypass the shared phase ordering.

- [ ] **Step 5: Implement bounded claims**

Maintain:

```js
Map<activityUuid, claim[]>
WeakMap<summonOptions, claim>
Map<operationId, claim>
```

Each claim stores only serializable identifiers, declaration, provider config, timestamps, and the direct Activity reference needed until `postSummon`. Default maximum is 128 pending claims; default lifetime is 5 minutes. Prune on every public lifecycle method.

`claimPreUse` copies the operation ID into:

```js
usageConfig.summons ??= {};
usageConfig.summons[MODULE_ID] = {
  operationId,
  runtime: "summon",
  recipe,
  version
};
```

This is the primary correlation path. The activity FIFO is the compatibility fallback if DnD5e normalizes unknown summon-option fields.

- [ ] **Step 6: Run claim tests**

```powershell
node --test tests/summon-lifecycle-runtime.test.mjs tests/spell-automation-registry.test.mjs
```

Expected: PASS for the registration and claim tests written in this task.

- [ ] **Step 7: Commit provider and claim core**

```powershell
git add scripts/combat/summon-lifecycle-runtime.js tests/summon-lifecycle-runtime.test.mjs
git commit -m "feat: add summon lifecycle claims"
```

---

### Task 3: Stamp, Finalize, Link, and Roll Back Summons

**Files:**

- Modify: `tests/summon-lifecycle-runtime.test.mjs`
- Modify: `scripts/combat/summon-lifecycle-runtime.js`

- [ ] **Step 1: Add failing token stamping tests**

Cover:

```js
test("summonToken stamps a complete common summonLink before creation", async () => {});
test("prepareToken can add provider data but cannot replace the common link", async () => {});
test("only the claim bound to the exact options object can stamp token data", async () => {});
test("two operations on one activity stamp different operation ids", async () => {});
test("a provider sees only the current token data and immutable common context", async () => {});
```

- [ ] **Step 2: Add failing finalization and rollback tests**

Cover:

```js
test("postSummon filters created tokens by operation id before calling the provider", async () => {});
test("writes the final summonLink only when token data lost it", async () => {});
test("links every operation token to the controlling effect", async () => {});
test("calls finalizeToken sequentially and finalizeSummon once", async () => {});
test("clears the claim after success", async () => {});
test("provider failure deletes only matching newly created tokens", async () => {});
test("rollback preserves a pre-existing token with another operation id", async () => {});
test("rollback preserves a token whose link was removed by another owner", async () => {});
test("cleanup receives the error and operation token list once", async () => {});
test("a retry with the same operation id is idempotent", async () => {});
```

Scene fixtures must assert the exact ID array passed to `deleteEmbeddedDocuments("Token", ids)`.

- [ ] **Step 3: Run tests and verify the expected failures**

```powershell
node --test tests/summon-lifecycle-runtime.test.mjs
```

Expected: FAIL on unimplemented lifecycle behavior.

- [ ] **Step 4: Implement pre-create token stamping**

`prepareSummonToken`:

1. resolves the options-bound claim;
2. builds the common link;
3. writes it into the mutable `tokenData.flags`;
4. calls `provider.prepareToken` with a deep-cloned/frozen common context;
5. re-applies and validates the common link after the provider returns.

Provider return value is a plain patch merged only into:

```js
{
  name,
  disposition,
  actorLink,
  texture,
  sight,
  detectionModes,
  flags: {
    [MODULE_ID]: {
      provider: {}
    }
  }
}
```

Reject `_id`, `actorId`, arbitrary module flags, and `summonLink` replacement.

- [ ] **Step 5: Implement generic finalization**

Use:

```js
const operationTokens = tokens.filter(
  (token) => readSummonLink(token)?.operationId === claim.operationId
);
```

Freeze a shallow copy before passing it to providers. For each token:

- confirm it still belongs to the current scene and operation;
- ensure the common link is present;
- call `addDependent(controllingEffect, token)` when a controlling effect exists;
- call `finalizeToken`.

Then call `finalizeSummon` once and clear the claim.

- [ ] **Step 6: Implement operation-scoped rollback**

On provider failure:

1. re-filter only the `postSummon` token arguments by current `summonLink.operationId`;
2. group token IDs by their parent Scene;
3. delete only those IDs through the scene;
4. call provider `cleanup`;
5. clear the claim;
6. rethrow/report one lifecycle error.

Serialize through:

```js
coordinator.runIdempotent(
  `summon:${scene.uuid}:${operationId}`,
  operationId,
  operation
);
```

- [ ] **Step 7: Run lifecycle tests**

```powershell
node --test tests/summon-lifecycle-runtime.test.mjs tests/world-mutation-infrastructure.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit lifecycle behavior**

```powershell
git add scripts/combat/summon-lifecycle-runtime.js tests/summon-lifecycle-runtime.test.mjs
git commit -m "feat: finalize and rollback managed summons"
```

---

### Task 4: Add a Closed Active-GM Mutation Route

**Files:**

- Create: `tests/summon-lifecycle-socket.test.mjs`
- Create: `scripts/integrations/summon-lifecycle-socket.js`
- Modify: `scripts/combat/summon-lifecycle-runtime.js`

- [ ] **Step 1: Write failing socket tests**

Cover:

```js
test("registers one summon lifecycle command", () => {});
test("validates operation id scene uuid and exact token ids", () => {});
test("rejects arbitrary update paths actor data and foreign flags", () => {});
test("authorizes the source actor owner or a GM", async () => {});
test("the active GM mutates only tokens whose summonLink matches", async () => {});
test("a duplicate command is idempotent", async () => {});
```

- [ ] **Step 2: Run the test and verify the expected failure**

```powershell
node --test tests/summon-lifecycle-socket.test.mjs
```

Expected: FAIL because the integration file is missing.

- [ ] **Step 3: Implement the command**

Export:

```js
export const SUMMON_LIFECYCLE_MUTATION_COMMAND = "summon-lifecycle-mutation";
export function isValidSummonLifecycleMutationPayload(payload) {}
export function registerSummonLifecycleSocketCommand(moduleApi) {}
```

Allowed actions:

```js
["ensure-link", "delete-operation-tokens"]
```

The active GM re-resolves the Scene and every token ID, filters by operation ID and recipe/version, then performs the bounded mutation. Provider-specific actor updates are not accepted over this generic command; future providers must define their own separately authorized commands if needed.

- [ ] **Step 4: Use local-first authority**

If the current client owns the scene/token document, finalize locally. Otherwise request the active GM through the existing `SocketCommandBus`. Never send full token or actor documents over the socket.

- [ ] **Step 5: Run authority tests**

```powershell
node --test tests/summon-lifecycle-socket.test.mjs tests/summon-lifecycle-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit authority routing**

```powershell
git add scripts/integrations/summon-lifecycle-socket.js scripts/combat/summon-lifecycle-runtime.js tests/summon-lifecycle-socket.test.mjs tests/summon-lifecycle-runtime.test.mjs
git commit -m "feat: route summon lifecycle mutations"
```

---

### Task 5: Extend the Shared Bridge With Native Summon Phases

**Files:**

- Modify: `tests/spell-automation-hook-bridge.test.mjs`
- Modify: `scripts/combat/spell-automation-hook-bridge.js`
- Modify: `tests/spell-automation-hooks.test.mjs`
- Modify: `scripts/integrations/spell-automation-hooks.js`

- [ ] **Step 1: Add failing bridge tests**

Cover:

```js
test("normalizes dnd5e.preSummon with the original options object", async () => {});
test("normalizes dnd5e.summonToken with mutable token data", async () => {});
test("normalizes postSummon with only the created token argument list", async () => {});
test("unmanaged and Craftsman summons take the immediate fast path", async () => {});
```

The bridge must preserve object identity for `summonOptions` and `tokenData`; copying either would break claim binding or pre-create stamping.

- [ ] **Step 2: Add failing hook registrar tests**

Extend the expected set with:

```js
["dnd5e.preSummon", "dnd5e.summonToken"]
```

Assert the existing `dnd5e.postSummon` registration remains one new-runtime listener and does not suppress later listeners.

- [ ] **Step 3: Run tests and verify the expected failures**

```powershell
node --test tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs
```

- [ ] **Step 4: Implement bridge methods**

Add:

```js
handlePreSummon(activity, profile, summonOptions) {}
handleSummonToken(activity, profile, tokenData, summonOptions) {}
```

The bridge dispatches to the explicit summon declaration only. `handleSummonToken` is synchronous if all provider preparation is synchronous; reject async `prepareToken` callbacks at provider registration so token data is fully stamped before DnD5e creates it.

- [ ] **Step 5: Register native hooks**

Add:

```js
Hooks.on("dnd5e.preSummon", ...);
Hooks.on("dnd5e.summonToken", ...);
```

Return `true` for unmanaged/Craftsman hooks and after starting any non-blocking post processing.

- [ ] **Step 6: Run hook and runtime tests**

```powershell
node --test tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs tests/summon-lifecycle-runtime.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit bridge extension**

```powershell
git add scripts/combat/spell-automation-hook-bridge.js scripts/integrations/spell-automation-hooks.js tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs
git commit -m "feat: route native summon lifecycle hooks"
```

---

### Task 6: Compose and Expose the Provider Entry Point

**Files:**

- Modify: `scripts/main.js`
- Modify: `tests/main-composition-root.test.mjs`

- [ ] **Step 1: Add failing composition tests**

Assert:

```js
this.summonLifecycleRuntime = new SummonLifecycleRuntime({
  registry: this.spellAutomationRegistry,
  coordinator: this.worldMutationCoordinator,
  socketCommandBus: this.socketCommandBus
});
```

Assert public delegation:

```js
registerSummonProvider(provider) {
  return this.summonLifecycleRuntime.registerProvider(provider);
}
```

Assert `registerSummonLifecycleSocketCommand(this)` runs inside the existing typed socket registration method.

- [ ] **Step 2: Run composition tests and verify the expected failure**

```powershell
node --test tests/main-composition-root.test.mjs
```

- [ ] **Step 3: Wire runtime and diagnostics**

Construct after the shared registry. Extend diagnostics with:

```js
pendingSummonClaims: this.summonLifecycleRuntime.pendingClaimCount
```

Do not register a default production summon provider in this plan. The engine is live through its public provider entrypoint and is proven by tests plus a temporary live provider.

- [ ] **Step 4: Run composition and protected regressions**

```powershell
node --test tests/main-composition-root.test.mjs tests/summon-lifecycle-runtime.test.mjs tests/summon-lifecycle-socket.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit composition**

```powershell
git add scripts/main.js tests/main-composition-root.test.mjs
git commit -m "feat: compose summon lifecycle runtime"
```

---

### Task 7: Prove Craftsman Isolation

**Files:**

- Modify: `tests/craftsman-gadget-hooks.test.mjs`
- Modify: `tests/summon-lifecycle-runtime.test.mjs`

- [ ] **Step 1: Add explicit coexistence tests**

Register both hook sets against the same fake `Hooks` bus. Fire a Craftsman-shaped summon:

```js
flags[MODULE_ID].craftsmanConstructor = {
  kind: "constructSummon",
  version: 1
};
```

Assert:

- the existing constructor `handlePostSummon` receives it exactly once;
- the new runtime creates zero claims;
- the new provider is not invoked;
- no token flags are added by the new runtime;
- no document mutation is attempted.

- [ ] **Step 2: Add the inverse test**

Fire a new `runtime: "summon"` activity. Assert the new runtime handles it and the Craftsman constructor service returns its normal no-op without altering the token.

- [ ] **Step 3: Run all Craftsman tests**

```powershell
node --test tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs tests/craftsman-construct-compendium.test.mjs tests/craftsman-gadget-service.test.mjs
```

Expected: PASS without changing existing expectations.

- [ ] **Step 4: Commit coexistence guards**

```powershell
git add tests/craftsman-gadget-hooks.test.mjs tests/summon-lifecycle-runtime.test.mjs
git commit -m "test: preserve Craftsman summon isolation"
```

---

### Task 8: Live Native Summon and Load Acceptance

**Files:**

- Modify: `docs/benchmarks/2026-07-30-spell-runtime-world-load.md`

- [ ] **Step 1: Create only temporary test documents**

In Foundry profile `кодекс` using password `666`, create:

- a GM-owned `Codex — Summon Source` Actor;
- a GM-owned `Codex — Summon Probe` Actor;
- a temporary native Summon Activity with an explicit `runtime: "summon"` declaration;
- a temporary provider registered through `game.rebreyaMain.registerSummonProvider`.

Do not use or edit player characters and do not reuse the Craftsman construct.

- [ ] **Step 2: Verify the successful lifecycle**

The temporary provider should add a harmless provider flag and record phase calls. Verify:

1. pre-use creates one claim;
2. preSummon binds it;
3. token data is stamped before creation;
4. postSummon receives only the operation tokens;
5. every token has the complete common link;
6. controlling-effect deletion cascades to linked tokens when used;
7. claim count returns to zero.

- [ ] **Step 3: Verify scoped rollback**

Create one pre-existing control token. Configure the temporary provider to throw during `finalizeToken`. Verify only newly created operation tokens are deleted and the control token remains.

- [ ] **Step 4: Verify legacy isolation live without invoking a player character**

Inspect the existing Craftsman Activity flag and hook registration only. Do not cast it from a player's character. Confirm no new-runtime claim is created when the legacy activity shape is passed through the diagnostic/test harness.

- [ ] **Step 5: Measure at least 20 warm starts**

Using the same marker and environment as the earlier benchmark, append:

```markdown
## After SummonLifecycleRuntime

- Rebreya commit:
- Warm samples (ms):
- Median (ms):
- Delta from preceding implementation (ms):
- Delta from preceding implementation (%):
- World-document writes during quiet ready window:
- Pending summon claims after ready:
```

Acceptance requires:

```text
median delta <= 50 ms
median delta <= 5%
world-document writes during quiet ready = 0
pending summon claims after ready = 0
```

- [ ] **Step 6: Remove temporary live documents**

Delete only `Codex — Summon Source`, `Codex — Summon Probe`, their temporary Item, tokens, and temporary effects. Confirm player Actors and Craftsman documents were not changed.

- [ ] **Step 7: Commit the benchmark update**

```powershell
git add docs/benchmarks/2026-07-30-spell-runtime-world-load.md
git commit -m "test: verify summon runtime world load"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run the affected suite**

```powershell
node --test tests/spell-automation-registry.test.mjs tests/spell-automation-hook-bridge.test.mjs tests/spell-automation-hooks.test.mjs tests/summon-lifecycle-runtime.test.mjs tests/summon-lifecycle-socket.test.mjs tests/main-composition-root.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-constructor-service.test.mjs tests/craftsman-constructor-activity.test.mjs tests/craftsman-construct-compendium.test.mjs tests/world-mutation-infrastructure.test.mjs
```

- [ ] **Step 2: Run Melf regressions**

```powershell
node --test tests/spell-instance-runtime.test.mjs tests/spell-instance-socket.test.mjs tests/melfs-minute-meteors-item.test.mjs tests/melfs-minute-meteors-recipe.test.mjs tests/spells-compendium.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the complete suite**

```powershell
$testFiles = Get-ChildItem -LiteralPath tests -Filter *.test.mjs | ForEach-Object { $_.FullName }
node --test $testFiles
```

Expected: PASS.

- [ ] **Step 4: Verify protected files and placeholders**

```powershell
git status --short --branch
git diff --check
git diff --exit-code origin/main...HEAD -- scripts/combat/craftsman-constructor-service.js scripts/integrations/craftsman-gadget-hooks.js scripts/data/craftsman-construct-definitions.js
rg -n "TODO|FIXME|placeholder|throw new Error\\(\"not implemented" scripts/combat/summon-lifecycle-runtime.js scripts/integrations/summon-lifecycle-socket.js
```

Compare the protected file hashes with Task 1.

- [ ] **Step 5: Review the complete diff**

```powershell
git diff --stat origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
```

- [ ] **Step 6: Push without force**

```powershell
git push -u origin lich_branch
```

Expected: successful non-force push.
