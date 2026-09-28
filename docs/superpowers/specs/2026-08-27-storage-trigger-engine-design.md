# Storage Trigger Engine Design

**Date:** 2026-08-27

**Status:** Approved in chat

## Goal

Add a native Rebreya trigger engine for root and nested storage that can gate opening, react to committed storage events, perform built-in dnd5e actions, and execute active-GM macros without depending on Monk's Active Tile Triggers.

Monk's Active Tile Triggers is a UX reference only. It is not a runtime, optional, or required dependency.

## Observable behavior

A GM can open a dedicated trigger editor for any root storage token or nested container path and configure ordered trigger chains for:

1. `beforeOpen` — may allow or deny opening;
2. `afterOpen` — runs after opening commits;
3. `afterClaim` — runs after a row, coins, or bulk claim commits;
4. `emptied` — runs on the first non-empty to empty transition before a ground pile is deleted.

Chains support `always`, `onceGlobal`, and `oncePerCharacter` repetition. A GM can reset recorded executions. No cooldown mode is included.

## Ownership and boundaries

- Canonical config/runtime data stays inside the storage state for the exact root or nested path.
- A new application/domain trigger service owns schema normalization, compilation, validation, branching, step execution, variables, repeat policy, and durable run receipts.
- `StorageCommandService` remains the sole privileged owner of open/claim orchestration and calls the trigger service at explicit commit boundaries.
- A focused dnd5e adapter owns ability checks, saving throws, item consumption, and damage application.
- A dedicated ApplicationV2 editor owns detached drafts and uses typed GM commands for reads, revisioned saves, and execution reset.
- `scripts/main.js` remains the only composition root and public API/socket registration owner.

The UI must never write token/container flags, execute a GM macro, apply damage, consume an Item, or decide authoritative event context directly.

## Versioned state

Each storage path normalizes an optional trigger section:

```js
{
  version: 1,
  revision: 0,
  chainsByEvent: {
    beforeOpen: [],
    afterOpen: [],
    afterClaim: [],
    emptied: []
  },
  variables: {},
  executionState: {
    onceGlobal: {},
    oncePerCharacter: {},
    runs: {}
  }
}
```

Existing storage normalizes to an empty version-1 section without an eager world write. Config saves increment `revision`. Runtime variable/receipt writes do not rewrite or implicitly upgrade the GM's chain definitions.

IDs for chains and steps are non-empty stable opaque strings. Event keys, repeat modes, step types, branch targets, variable names, and serialized values use exact validators. Unknown versions or step types are preserved for GM inspection but make the affected chain non-executable; they are never silently deleted or skipped. The editor presents such a chain as unsupported and read-only, round-trips its opaque serialized definition unchanged on unrelated saves, and removes it only through an explicit GM delete action.

Execution state is bounded. Terminal run receipts are pruned by a deterministic retention policy after durable once-state and variables are committed. `oncePerCharacter` keys use the authoritative triggering Actor UUID, not a client label or token name.

## Chain model

Each event contains ordered chains. A chain has:

```js
{
  id,
  name,
  enabled,
  repeat: "always" | "onceGlobal" | "oncePerCharacter",
  steps: [],
  entryStepId
}
```

Steps form a validated directed acyclic control-flow structure displayed as nested linear success/failure branches. A step may return a result, continue to one declared next step, end the chain, or deny a deny-capable event. Cycles, missing targets, unreachable required branches, duplicate IDs, and branch targets in another chain are validation errors.

Multiple enabled chains for one event execute in their stored order. A `beforeOpen` denial stops remaining chains and the storage operation. Post-event chain failures stop the affected chain, are reported to the GM, and do not roll back the committed storage mutation. A `onceGlobal` or `oncePerCharacter` execution is recorded only after the chain reaches a normal terminal result, including an intentional denial; runtime failure does not consume the one-time execution.

Character-dependent conditions/actions and `oncePerCharacter` require an authoritative triggering character. If none exists, the affected chain stops with a GM-visible runtime error; under `beforeOpen` that error safely denies gameplay opening.

## Built-in steps

The initial catalog includes:

### Conditions

- character owns an Item matching an authoritative UUID or stable configured identity;
- a persisted storage variable equals, differs from, or numerically compares with a configured serializable value;
- a prior step result matches success, failure, or a configured scalar value.

### dnd5e actions

- roll an ability check or saving throw for the authoritative triggering character against a configured DC;
- consume a validated quantity of a matching Item from that character;
- apply configured damage through the injected dnd5e adapter.

### Presentation

- show a requester dialog;
- create a sanitized chat message;
- show a notification to the requester or GM.

### Control and state

- set or remove a named serializable storage variable;
- branch on success/failure;
- allow the current event;
- deny a deny-capable event with a safe player message;
- finish the current chain.

Only `beforeOpen` is deny-capable. A deny step in another event is rejected by schema validation.

### Macro

The GM selects or drops a `Macro` document into the step. Execution re-resolves the exact Macro UUID on active GM and requires the configured document to still be a Macro accessible to that GM.

The macro receives one deeply frozen context object containing:

- event key, run ID, and step ID;
- root storage Token UUID and canonical nested path;
- initiating user identity;
- authoritative triggering character identity;
- sanitized authoritative claim summary for `afterClaim`;
- detached current variables and prior step results.

The accepted return value is exact serializable data equivalent to:

```js
{
  outcome: "continue" | "deny",
  variables: { key: serializableValue }
}
```

`undefined` is normalized to `outcome: "continue"` with no variable changes. Macro results cannot jump to arbitrary step IDs; branching remains explicit in the editor. `deny` is valid only for `beforeOpen`.

Macros run with active-GM authority and can technically perform direct Foundry side effects. Such side effects are outside Rebreya's storage transaction and rollback guarantees.

## Event timing

### Before open

`StorageCommandService.open()` performs live sender, owned-character, scene, visibility, distance, and storage-path validation first. It then executes `beforeOpen` before loot materialization or `unopened → opened` state mutation. Denial or failure leaves storage unopened and returns only a safe denial/error to the requester.

The trusted GM configuration-preparation route is administrative rather than a gameplay open attempt. It bypasses all four trigger events while retaining normal authoritative materialization and path validation, so opening the editor cannot fire a trap or consume a one-time trigger. An ordinary GM `Открыть` action uses the gameplay route and does execute triggers.

### After open

`afterOpen` runs only after the existing open state commit succeeds. It receives the committed state but no hidden generated rows. Failure does not revert opening or generated content.

### After claim

`afterClaim` runs once for an authoritative successful row, coin, or bulk claim outcome. Its context is derived from the committed server result, never the client payload. Cancelled, denied, stale, filtered no-op, and pure retry responses do not create a new logical event run.

### Emptied

The command service detects an authoritative non-empty to empty transition for the exact storage path. `emptied` runs after the state commit and before `StorageGroundPileService` deletes a final root pile. Nested empty containers remain present under their current lifecycle.

## Idempotency and recovery

Every logical run is bound to an exact event fingerprint containing the outer mutation identity, event, root token, canonical path, sender, character, and committed source outcome where applicable. Each step uses its stable chain/step ID in the durable run ledger.

Completed built-in steps and committed variable/once-state writes are not repeated on socket retry or normal recovery. A retry with the same run identity but a different event context is rejected.

There is an unavoidable crash window for arbitrary Macro side effects: if Foundry stops after a macro changes external state but before Rebreya persists its receipt, automatic retry can invoke the macro again. The context therefore includes stable run and step IDs so a macro that performs irreversible external work can implement its own durable idempotency guard. This limitation must be visible in the macro-step help text.

## Authorization and secrecy

- Only a GM may read full trigger configuration, save it, validate Macro references, or reset execution state.
- Player open/claim requests use existing typed commands and cannot submit chain definitions, variables, roll results, Macro UUIDs, or branch outcomes.
- The active GM re-resolves the exact character, storage path, Item, and Macro documents.
- Player responses and notifications must not expose hidden condition text, Macro UUIDs, variables, DCs, branches, Item identities, or stack traces.
- Full trigger configuration must not enter ordinary storage snapshots.
- Trigger bypass is never accepted from a player payload. The administrative bypass exists only as an internal active-GM configuration route.

## Editor UX

Storage configuration shows a compact `Триггеры` section with active-chain count, an `Открыть редактор` action, and `Сбросить срабатывания`.

The editor is a separate wide ApplicationV2 window:

- four event tabs;
- chain selection and create/rename/enable/delete controls;
- ordered step list with drag reorder;
- inspector for the selected step;
- nested success/failure branch presentation;
- Macro picker and Foundry Macro drag/drop;
- inline validation attached to the exact chain and step;
- save/cancel controls and dirty-state close confirmation.

Saving sends the expected revision and full normalized detached definition through one typed GM command. A revision conflict preserves the local draft, reports the conflict, and offers an explicit reload; it never overwrites newer world state.

Reset is a separate typed mutation with its own operation ID and expected storage path. It clears `onceGlobal`, `oncePerCharacter`, and terminal run receipts while preserving definitions and persistent variables. Variable editing/reset is not included in the first UI unless exposed through chain steps or a GM macro.

## Error policy

- Schema or graph errors block saving.
- A missing runtime document stops the affected chain with a GM-visible error.
- `beforeOpen` runtime errors deny opening safely.
- Post-event errors never roll back committed open/claim state.
- Chat/notification presentation failures are logged and do not roll back game-state steps already committed.
- Reset and config save use authoritative path resolution and reject deleted or changed container paths.

## Verification

New focused pure tests cover schema normalization, exact validation, graph compilation, branch execution, variables, repeat modes, reset, pruning, macro return normalization, and malformed/unknown definitions.

Storage integration coverage must prove:

1. pre-open runs after access checks and before materialization/state mutation;
2. denial leaves the storage unopened;
3. after-open observes committed state;
4. after-claim uses authoritative committed outcomes for row, coin, and bulk paths;
5. emptied runs once at the correct root/nested boundary before pile deletion;
6. socket retry and recovery reuse durable run receipts;
7. same mutation/run identity cannot be rebound to another sender, character, token, path, or outcome;
8. player results contain no secret trigger data;
9. editor save/reset commands are GM-only and revisioned;
10. root and nested storage keep independent definitions, variables, and once-state.
11. administrative GM configuration preparation bypasses triggers, while ordinary GM gameplay opening does not;
12. unsupported future definitions survive unrelated editor saves byte-for-byte at their opaque definition boundary.

Focused owner files will include new trigger-service/editor tests plus `tests/storage-service.test.mjs`, `tests/storage-socket.test.mjs`, `tests/storage-main-registration.test.mjs`, `tests/security.test.mjs`, `tests/storage-app.test.mjs`, and composition-root coverage.

Implementation must update the storage section of `docs/function-passport.md` for every added, changed, or removed method. Update the README if a public trigger API is exposed beyond opening the GM editor.
